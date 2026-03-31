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
} from '@nestjs/common';
// Manual OAuth flow — no passport AuthGuard needed for Google
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  InviteUserDto,
} from './dto/auth.dto';
import { Public, CurrentUser, TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
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
  login(@Body() dto: LoginDto) {
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
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Google OAuth callback error:', msg, err);
      return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(msg.slice(0, 100))}`);
    }
  }
}
