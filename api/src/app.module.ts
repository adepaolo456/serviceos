import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
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
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { AdminModule } from './modules/admin/admin.module';
import { DemosModule } from './modules/demos/demos.module';
import { YardsModule } from './modules/yards/yards.module';
import { NotesModule } from './modules/notes/notes.module';
import { TeamModule } from './modules/team/team.module';
import { PortalModule } from './modules/portal/portal.module';
import { PublicModule } from './modules/public/public.module';
import { JwtAuthGuard } from './common/guards';
import { AutomationModule } from './modules/automation/automation.module';
import { DriverModule } from './modules/driver/driver.module';
import { DumpLocationsModule } from './modules/dump-locations/dump-locations.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { SmsModule } from './modules/sms/sms.module';
import { SmsReleaseModule } from './modules/sms-release/sms-release.module';
import { RentalChainsModule } from './modules/rental-chains/rental-chains.module';
import { LegacyBackfillModule } from './modules/legacy-backfill/legacy-backfill.module';
import { MapboxModule } from './modules/mapbox/mapbox.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { TenantSettingsModule } from './modules/tenant-settings/tenant-settings.module';
import { AiModule } from './modules/ai/ai.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { CreditAuditModule } from './modules/credit-audit/credit-audit.module';
import { PermissionModule } from './modules/permissions/permission.module';
import { AlertsModule } from './modules/alerts/alerts.module';

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
        // In test mode (NODE_ENV=test), bootstrap the schema directly from
        // entity metadata via synchronize, and disable SSL for local Docker
        // Postgres. Production/dev paths are unchanged.
        const isTest = process.env.NODE_ENV === 'test';
        return {
          type: 'postgres',
          url,
          autoLoadEntities: true,
          synchronize: isTest,
          ssl: isTest ? false : { rejectUnauthorized: false },
        };
      },
    }),
    CommonModule,
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
    SubscriptionsModule,
    AdminModule,
    DemosModule,
    YardsModule,
    NotesModule,
    TeamModule,
    PortalModule,
    PublicModule,
    AutomationModule,
    DriverModule,
    DumpLocationsModule,
    ReportingModule,
    StripeModule,
    QuotesModule,
    SmsModule,
    SmsReleaseModule,
    RentalChainsModule,
    LegacyBackfillModule,
    MapboxModule,
    OnboardingModule,
    TenantSettingsModule,
    AiModule,
    GeocodingModule,
    CreditAuditModule,
    PermissionModule,
    AlertsModule,
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
