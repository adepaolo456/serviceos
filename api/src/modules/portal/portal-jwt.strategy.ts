import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

interface PortalJwtPayload {
  sub: string;
  tenantId: string;
  type: 'portal';
}

@Injectable()
export class PortalJwtStrategy extends PassportStrategy(Strategy, 'portal-jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'serviceos-dev-secret'),
    });
  }

  validate(payload: PortalJwtPayload) {
    if (payload.type !== 'portal') return null;
    return {
      customerId: payload.sub,
      tenantId: payload.tenantId,
    };
  }
}
