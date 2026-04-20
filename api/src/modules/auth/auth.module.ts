import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PasswordResetService } from './services/password-reset.service';
// GoogleStrategy removed — using manual OAuth flow for serverless compatibility
import { User } from './entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Tenant,
      TenantSettings,
      PasswordResetToken,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'serviceos-dev-secret'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PasswordResetService],
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
