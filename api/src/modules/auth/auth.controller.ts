import {
  Controller,
  Post,
  Get,
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
      const scope = encodeURIComponent('email profile');
      const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
      return res.redirect(url);
    } catch (err) {
      console.error('Google OAuth init error:', err);
      return res.redirect(
        'https://serviceos-web-zeta.vercel.app/login?error=oauth_init_failed',
      );
    }
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl =
      this.configService.get<string>('APP_URL') ||
      'https://serviceos-web-zeta.vercel.app';

    try {
      const code = (req.query as Record<string, string>).code;
      if (!code) {
        res.redirect(`${frontendUrl}/login?error=no_code`);
        return;
      }

      const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID', '');
      const clientSecret = this.configService.get<string>(
        'GOOGLE_CLIENT_SECRET',
        '',
      );
      const callbackUrl =
        this.configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'https://serviceos-api.vercel.app/auth/google/callback';

      // Exchange code for tokens
      const tokenRes = await fetch(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: callbackUrl,
            grant_type: 'authorization_code',
          }),
        },
      );
      const tokens = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
      };
      if (!tokens.access_token) {
        res.redirect(
          `${frontendUrl}/login?error=token_exchange_failed`,
        );
        return;
      }

      // Get user info
      const userRes = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      const profile = (await userRes.json()) as {
        id: string;
        email: string;
        given_name?: string;
        family_name?: string;
        name?: string;
      };

      if (!profile.email) {
        res.redirect(`${frontendUrl}/login?error=no_email`);
        return;
      }

      const result = await this.authService.googleLogin({
        googleId: profile.id,
        email: profile.email,
        firstName: profile.given_name || profile.name || '',
        lastName: profile.family_name || '',
      });

      res.redirect(
        `${frontendUrl}/auth/callback?token=${result.accessToken}&refresh=${result.refreshToken}&new=${result.isNew ? '1' : '0'}`,
      );
    } catch (err) {
      console.error('Google OAuth error:', err);
      res.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }
  }
}
