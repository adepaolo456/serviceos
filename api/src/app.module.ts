import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { AssetsModule } from './modules/assets/assets.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { BillingModule } from './modules/billing/billing.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { JwtAuthGuard } from './common/guards';
import { Tenant } from './modules/tenants/entities/tenant.entity';
import { User } from './modules/auth/entities/user.entity';
import { Customer } from './modules/customers/entities/customer.entity';
import { Asset } from './modules/assets/entities/asset.entity';
import { Job } from './modules/jobs/entities/job.entity';
import { PricingRule } from './modules/pricing/entities/pricing-rule.entity';
import { Invoice } from './modules/billing/entities/invoice.entity';
import { Payment } from './modules/billing/entities/payment.entity';
import { Route } from './modules/dispatch/entities/route.entity';
import { Notification } from './modules/notifications/entities/notification.entity';
import { MarketplaceBooking } from './modules/marketplace/entities/marketplace-booking.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('DATABASE_URL') || process.env.DATABASE_URL;
        if (!url) {
          console.error('DATABASE_URL is not set. Available env keys:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('JWT') || k.includes('VERCEL')).join(', '));
        }
        return {
          type: 'postgres',
          url,
          entities: [
            Tenant,
            User,
            Customer,
            Asset,
            Job,
            PricingRule,
            Invoice,
            Payment,
            Route,
            Notification,
            MarketplaceBooking,
          ],
          synchronize: true,
          ssl: {
            rejectUnauthorized: false,
          },
        };
      },
    }),
    AuthModule,
    CustomersModule,
    AssetsModule,
    JobsModule,
    PricingModule,
    BillingModule,
    AnalyticsModule,
    DispatchModule,
    NotificationsModule,
    MarketplaceModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
