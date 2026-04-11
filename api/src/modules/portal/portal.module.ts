import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { PortalAuthController } from './portal-auth.controller';
import { PortalController } from './portal.controller';
import { PortalActivityController } from './portal-activity.controller';
import { PortalService } from './portal.service';
import { PortalJwtStrategy } from './portal-jwt.strategy';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingModule } from '../pricing/pricing.module';
import { BillingModule } from '../billing/billing.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, Job, Invoice, Payment, Tenant]),
    PricingModule,
    BillingModule,
    StripeModule,
    PassportModule.register({ defaultStrategy: 'portal-jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'serviceos-dev-secret'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [PortalAuthController, PortalController, PortalActivityController],
  providers: [PortalService, PortalJwtStrategy],
})
export class PortalModule {}
