import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
// Manual OAuth flow — no passport AuthGuard needed for Google
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { PasswordResetService } from './services/password-reset.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  InviteUserDto,
  LookupTenantsDto,
} from './dto/auth.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { Public, CurrentUser, TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { checkRateLimit } from '../../common/rate-limiter';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new tenant and owner account' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';
    const rateResult = await checkRateLimit(
      this.dataSource,
      ip,
      '/auth/login',
      10,
      15,
    );
    if (!rateResult.allowed) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Too many requests. Try again later.',
          retryAfter: rateResult.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tenant settings' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Body()
    body: {
      companyName?: string;
      businessType?: string;
      address?: Record<string, string>;
      serviceRadius?: number;
      yardLatitude?: number;
      yardLongitude?: number;
      yardAddress?: Record<string, string>;
    },
  ) {
    return this.authService.updateTenantProfile(tenantId, body);
  }

  @Get('preferences')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user preferences' })
  async getPreferences(@CurrentUser('id') userId: string) {
    return this.authService.getPreferences(userId);
  }

  @Patch('preferences')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user preferences' })
  async updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.authService.updatePreferences(userId, body);
  }

  @Post('clock-in')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clock in (driver app)' })
  async clockIn(@CurrentUser('id') userId: string) {
    await this.authService.clockIn(userId);
    return { ok: true };
  }

  @Post('clock-out')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clock out (driver app)' })
  async clockOut(@CurrentUser('id') userId: string) {
    await this.authService.clockOut(userId);
    return { ok: true };
  }

  @Patch('location')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user GPS location (driver app)' })
  async updateLocation(
    @CurrentUser('id') userId: string,
    @Body() body: { latitude: number; longitude: number; statusText?: string },
  ) {
    await this.authService.updateLocation(userId, body);
    return { ok: true };
  }

  @Post('invite')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Invite a user to your tenant (admin+)' })
  inviteUser(@Body() dto: InviteUserDto, @TenantId() tenantId: string) {
    return this.authService.inviteUser(dto, tenantId);
  }

  /**
   * Self-serve forgot-password. Always responds 200 { ok: true } regardless
   * of whether the email exists, whether the account is active, or whether
   * a rate limit was hit — prevents account enumeration. Structured audit
   * events log the differentiating outcome for ops visibility.
   *
   * Response latency is floored at 200ms (matches lookupTenants pattern at
   * L225) so attackers can't distinguish outcomes via timing.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const start = Date.now();
    const floor = 200;

    const normalizedEmail = this.authService.normalizeEmail(dto.email);
    const ip = this.extractClientIp(req);

    const emailCheck = await checkRateLimit(
      this.dataSource,
      normalizedEmail,
      '/auth/forgot-password',
      3,
      60,
      'email',
    );
    const ipCheck = await checkRateLimit(
      this.dataSource,
      ip,
      '/auth/forgot-password',
      10,
      60,
      'ip',
    );

    if (!emailCheck.allowed || !ipCheck.allowed) {
      this.logger.log(
        JSON.stringify({
          event: 'audit.password_reset.request_rate_limited',
          email: normalizedEmail,
          ip,
          email_limit_hit: !emailCheck.allowed,
          ip_limit_hit: !ipCheck.allowed,
        }),
      );
      await this.sleepUntil(start + floor);
      return res.json({ ok: true });
    }

    try {
      const user =
        await this.authService.findUserByEmailForPasswordReset(normalizedEmail);

      if (user && user.is_active) {
        const rawToken = await this.passwordResetService.createToken(
          user,
          'self-serve',
          ip,
        );
        await this.passwordResetService.sendResetEmail(user, rawToken);
      } else if (user && !user.is_active) {
        this.logger.log(
          JSON.stringify({
            event: 'audit.password_reset.request_blocked_inactive',
            user_id: user.id,
            tenant_id: user.tenant_id,
          }),
        );
      } else {
        this.logger.log(
          JSON.stringify({
            event: 'audit.password_reset.request_no_account',
            email: normalizedEmail,
            ip,
          }),
        );
      }
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          event: 'audit.password_reset.request_error',
          email: normalizedEmail,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      // Still silent success — don't leak error shape to attackers.
    }

    await this.sleepUntil(start + floor);
    return res.json({ ok: true });
  }

  /**
   * Redeem a reset token and set a new password. Wrapped service-side in
   * a DB transaction (token burn + password update + refresh_token_hash
   * nulling — all-or-nothing). On success, issues fresh access+refresh
   * tokens for auto-login (operator Lock 11).
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Redeem a password reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    const ip = this.extractClientIp(req);

    const ipCheck = await checkRateLimit(
      this.dataSource,
      ip,
      '/auth/reset-password',
      10,
      60,
      'ip',
    );
    if (!ipCheck.allowed) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'rate_limited',
          retryAfter: ipCheck.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.passwordResetService.redeemAndApply(
      dto.token,
      dto.newPassword,
    );
    return this.authService.generateTokensForUser(user.id);
  }

  private extractClientIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown'
    );
  }

  private async sleepUntil(targetMs: number) {
    const delay = targetMs - Date.now();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  @Public()
  @Post('lookup-tenants')
  @ApiOperation({
    summary: 'Look up tenants for an email (timing-safe, rate-limited)',
  })
  async lookupTenants(
    @Body() dto: LookupTenantsDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const start = Date.now();
    const floor = 200;

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';

    const rateResult = await checkRateLimit(
      this.dataSource,
      ip,
      '/auth/lookup-tenants',
      10,
      1,
    );

    if (!rateResult.allowed) {
      // Wait for timing floor before returning 429
      const elapsed = Date.now() - start;
      if (elapsed < floor) {
        await new Promise((r) => setTimeout(r, floor - elapsed));
      }
      return res.status(429).set('X-RateLimit-Remaining', '0').json({
        statusCode: 429,
        message: 'Too many requests. Try again later.',
        retryAfter: rateResult.retryAfterSeconds,
      });
    }

    const result = await this.authService.lookupTenants(dto.email);

    // Timing floor is inside lookupTenants, but add header
    return res
      .status(200)
      .set('X-RateLimit-Remaining', String(rateResult.remaining))
      .json(result);
  }

  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  googleLogin(@Req() req: Request, @Res() res: Response) {
    try {
      const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID') || '';
      const frontendUrl =
        this.configService.get<string>('APP_URL') ||
        'https://app.rentthisapp.com';

      if (!clientId || clientId === 'not-configured') {
        return res.redirect(`${frontendUrl}/login?error=google_not_configured`);
      }

      // Pass tenant_id through OAuth state parameter
      const tenantId = (req.query as Record<string, string>).tenant_id || '';
      const statePayload = JSON.stringify({ tenantId });
      const state = Buffer.from(statePayload).toString('base64');

      const callbackUrl =
        this.configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'https://api.rentthisapp.com/auth/google/callback';
      const params = new URLSearchParams({
        client_id: clientId.trim(),
        redirect_uri: callbackUrl.trim(),
        response_type: 'code',
        scope: 'email profile',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return res.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Google OAuth init error:', msg);
      const fallbackFrontend =
        this.configService.get<string>('APP_URL') ||
        'https://app.rentthisapp.com';
      return res.redirect(
        `${fallbackFrontend}/login?error=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl = (
      this.configService.get<string>('APP_URL') ||
      'https://serviceos-web-zeta.vercel.app'
    ).trim();

    try {
      const code = (req.query as Record<string, string>).code;
      if (!code) {
        return res.redirect(`${frontendUrl}/login?error=no_code`);
      }

      const clientId = (
        this.configService.get<string>('GOOGLE_CLIENT_ID') || ''
      ).trim();
      const clientSecret = (
        this.configService.get<string>('GOOGLE_CLIENT_SECRET') || ''
      ).trim();
      const callbackUrl = (
        this.configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'https://api.rentthisapp.com/auth/google/callback'
      ).trim();

      if (!clientSecret) {
        return res.redirect(`${frontendUrl}/login?error=google_secret_missing`);
      }

      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      });
      const tokens = (await tokenRes.json()) as Record<string, unknown>;

      if (!tokens.access_token) {
        console.error('Google token exchange failed:', JSON.stringify(tokens));
        return res.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
      }

      // Get user info
      const userRes = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      );
      const profile = (await userRes.json()) as Record<string, string>;

      if (!profile.email) {
        return res.redirect(`${frontendUrl}/login?error=no_email`);
      }

      // OIDC security: Google confirms email ownership via verified_email.
      // Without this check, users can sign in with an unverified secondary
      // email on their Google account (impersonation vector). The
      // /oauth2/v2/userinfo endpoint returns this flag even without the
      // openid scope.
      const verifiedEmail = (profile as Record<string, unknown>).verified_email;
      if (verifiedEmail !== true && verifiedEmail !== 'true') {
        return res.redirect(`${frontendUrl}/login?error=email_not_verified`);
      }

      // Under Option A (email unique per platform) tenant is derived from
      // the user record server-side; the state-embedded tenantId is no
      // longer passed through.
      const result = await this.authService.googleLogin({
        googleId: profile.id || '',
        email: profile.email,
        firstName: profile.given_name || profile.name || '',
        lastName: profile.family_name || '',
      });

      return res.redirect(
        `${frontendUrl}/auth/callback?token=${result.accessToken}&refresh=${result.refreshToken}&new=${result.isNew ? '1' : '0'}`,
      );
    } catch (err) {
      // Defensively extract the error code from whatever shape NestJS
      // exception filters leave on the thrown value. UnauthorizedException
      // ({ error: 'X' }) surfaces as err.response.error in raw form or as
      // err.response.message after filter transform. Fall back through
      // the plausible locations.
      const e = err as {
        response?: { error?: unknown; message?: unknown };
        error?: unknown;
        message?: unknown;
      };
      const rawCode =
        (typeof e?.response?.error === 'string'
          ? e.response.error
          : undefined) ??
        (typeof e?.response?.message === 'string'
          ? e.response.message
          : undefined) ??
        (typeof e?.error === 'string' ? e.error : undefined) ??
        (typeof e?.message === 'string' ? e.message : undefined);

      // Whitelist known codes — arbitrary error strings in the URL would
      // pollute analytics/referrers and may open an XSS vector if the
      // frontend ever rendered the raw param. Unknown → generic code.
      const KNOWN_CODES = new Set([
        'no_account_found',
        'account_deactivated',
        'email_not_verified',
        'no_email',
        'token_exchange_failed',
        'userinfo_failed',
      ]);
      const errorCode =
        rawCode && KNOWN_CODES.has(rawCode) ? rawCode : 'oauth_failed';

      console.error('[OAuth callback error]', { rawCode, err });

      return res.redirect(`${frontendUrl}/login?error=${errorCode}`);
    }
  }
}
