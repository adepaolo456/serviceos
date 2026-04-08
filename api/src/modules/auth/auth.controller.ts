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
} from '@nestjs/common';
// Manual OAuth flow — no passport AuthGuard needed for Google
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  InviteUserDto,
  LookupTenantsDto,
} from './dto/auth.dto';
import { Public, CurrentUser, TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { checkRateLimit } from '../../common/rate-limiter';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
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
        { statusCode: 429, message: 'Too many requests. Try again later.', retryAfter: rateResult.retryAfterSeconds },
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
  async updatePreferences(@CurrentUser('id') userId: string, @Body() body: Record<string, unknown>) {
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

  @Public()
  @Post('lookup-tenants')
  @ApiOperation({ summary: 'Look up tenants for an email (timing-safe, rate-limited)' })
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
      return res
        .status(429)
        .set('X-RateLimit-Remaining', '0')
        .json({
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
        'https://serviceos-web-zeta.vercel.app';

      if (!clientId || clientId === 'not-configured') {
        return res.redirect(
          `${frontendUrl}/login?error=google_not_configured`,
        );
      }

      // Pass tenant_id through OAuth state parameter
      const tenantId = (req.query as Record<string, string>).tenant_id || '';
      const statePayload = JSON.stringify({ tenantId });
      const state = Buffer.from(statePayload).toString('base64');

      const callbackUrl =
        this.configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'https://serviceos-api.vercel.app/auth/google/callback';
      const params = new URLSearchParams({
        client_id: clientId.trim(),
        redirect_uri: callbackUrl.trim(),
        response_type: 'code',
        scope: 'email profile',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Google OAuth init error:', msg);
      return res.redirect(
        `https://serviceos-web-zeta.vercel.app/login?error=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl =
      (this.configService.get<string>('APP_URL') ||
      'https://serviceos-web-zeta.vercel.app').trim();

    try {
      const code = (req.query as Record<string, string>).code;
      if (!code) {
        return res.redirect(`${frontendUrl}/login?error=no_code`);
      }

      const clientId = (this.configService.get<string>('GOOGLE_CLIENT_ID') || '').trim();
      const clientSecret = (this.configService.get<string>('GOOGLE_CLIENT_SECRET') || '').trim();
      const callbackUrl = (
        this.configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'https://serviceos-api.vercel.app/auth/google/callback'
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
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = (await userRes.json()) as Record<string, string>;

      if (!profile.email) {
        return res.redirect(`${frontendUrl}/login?error=no_email`);
      }

      // Extract tenant_id from OAuth state
      let oauthTenantId = '';
      const stateParam = (req.query as Record<string, string>).state;
      if (stateParam) {
        try {
          const decoded = JSON.parse(Buffer.from(stateParam, 'base64').toString());
          oauthTenantId = decoded.tenantId || '';
        } catch { /* ignore invalid state */ }
      }

      const result = await this.authService.googleLogin({
        googleId: profile.id || '',
        email: profile.email,
        firstName: profile.given_name || profile.name || '',
        lastName: profile.family_name || '',
        tenantId: oauthTenantId,
      });

      return res.redirect(
        `${frontendUrl}/auth/callback?token=${result.accessToken}&refresh=${result.refreshToken}&new=${result.isNew ? '1' : '0'}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Google OAuth callback error:', msg, err);
      return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(msg.slice(0, 100))}`);
    }
  }
}
