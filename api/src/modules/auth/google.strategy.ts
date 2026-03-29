import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET', '');
    const callbackURL =
      configService.get<string>('GOOGLE_CALLBACK_URL') ||
      'https://serviceos-api.vercel.app/auth/google/callback';

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      name?: { givenName?: string; familyName?: string };
      emails?: Array<{ value: string; verified?: boolean }>;
      displayName?: string;
    },
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value || '';
    const firstName = profile.name?.givenName || profile.displayName || '';
    const lastName = profile.name?.familyName || '';

    done(null, {
      googleId: profile.id,
      email,
      firstName,
      lastName,
    });
  }
}
