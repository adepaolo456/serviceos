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
// Phase B1 — PortalService reads from these two tables to locate the
// active pickup job for a customer-initiated extend / early-pickup /
// reschedule. The actual mutation is delegated to JobsService.
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { PricingModule } from '../pricing/pricing.module';
import { BillingModule } from '../billing/billing.module';
import { StripeModule } from '../stripe/stripe.module';
// Phase B1 — PortalService delegates all scheduling mutations to
// JobsService.updateScheduledDate to eliminate the duplicate
// scheduling logic that previously caused the epoch-fallback bug,
// the ghost-pickup-job bug, and the chain-out-of-sync bug.
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      Job,
      Invoice,
      Payment,
      Tenant,
      RentalChain,
      TaskChainLink,
    ]),
    PricingModule,
    BillingModule,
    StripeModule,
    JobsModule,
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
