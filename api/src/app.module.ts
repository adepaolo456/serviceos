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
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { AdminModule } from './modules/admin/admin.module';
import { DemosModule } from './modules/demos/demos.module';
import { DemoRequest } from './modules/demos/demo-request.entity';
import { YardsModule } from './modules/yards/yards.module';
import { Yard } from './modules/yards/yard.entity';
import { NotesModule } from './modules/notes/notes.module';
import { CustomerNote } from './modules/notes/note.entity';
import { TeamModule } from './modules/team/team.module';
import { PortalModule } from './modules/portal/portal.module';
import { PublicModule } from './modules/public/public.module';
import { TimeEntry } from './modules/team/time-entry.entity';
import { JwtAuthGuard } from './common/guards';
import { Tenant } from './modules/tenants/entities/tenant.entity';
import { User } from './modules/auth/entities/user.entity';
import { PasswordResetToken } from './modules/auth/entities/password-reset-token.entity';
import { Customer } from './modules/customers/entities/customer.entity';
import { Asset } from './modules/assets/entities/asset.entity';
import { Job } from './modules/jobs/entities/job.entity';
import { PricingRule } from './modules/pricing/entities/pricing-rule.entity';
import { PricingTemplate } from './modules/pricing/entities/pricing-template.entity';
import { Invoice } from './modules/billing/entities/invoice.entity';
import { InvoiceLineItem } from './modules/billing/entities/invoice-line-item.entity';
import { InvoiceRevision } from './modules/billing/entities/invoice-revision.entity';
import { Payment } from './modules/billing/entities/payment.entity';
import { CreditMemo } from './modules/billing/entities/credit-memo.entity';
import { BillingIssue } from './modules/billing/entities/billing-issue.entity';
import { JobCost } from './modules/billing/entities/job-cost.entity';
import { RentalChain } from './modules/rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from './modules/rental-chains/entities/task-chain-link.entity';
import { ClientPricingOverride } from './modules/pricing/entities/client-pricing-override.entity';
import { SurchargeTemplate } from './modules/pricing/entities/surcharge-template.entity';
import { ClientSurchargeOverride } from './modules/pricing/entities/client-surcharge-override.entity';
import { TermsTemplate } from './modules/pricing/entities/terms-template.entity';
import { TenantFee } from './modules/pricing/entities/tenant-fee.entity';
import { PricingSnapshot } from './modules/pricing/entities/pricing-snapshot.entity';
import { JobPricingAudit } from './modules/jobs/entities/job-pricing-audit.entity';
import { Route } from './modules/dispatch/entities/route.entity';
import { Notification } from './modules/notifications/entities/notification.entity';
import { NotificationPreference } from './modules/notifications/entities/notification-preference.entity';
import { ClientNotificationOverride } from './modules/notifications/entities/client-notification-override.entity';
import { ScheduledNotification } from './modules/notifications/entities/scheduled-notification.entity';
import { MarketplaceBooking } from './modules/marketplace/entities/marketplace-booking.entity';
import { MarketplaceIntegration } from './modules/marketplace/entities/marketplace-integration.entity';
import { AutomationModule } from './modules/automation/automation.module';
import { DriverModule } from './modules/driver/driver.module';
import { DumpLocationsModule } from './modules/dump-locations/dump-locations.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { Quote } from './modules/quotes/quote.entity';
import { SmsModule } from './modules/sms/sms.module';
import { SmsMessage } from './modules/sms/sms-message.entity';
import { SmsReleaseModule } from './modules/sms-release/sms-release.module';
import { SmsNumberReleaseRequest } from './modules/sms-release/entities/sms-number-release-request.entity';
import { DeliveryZone } from './modules/pricing/entities/delivery-zone.entity';
import { DumpLocation, DumpLocationRate, DumpLocationSurcharge } from './modules/dump-locations/entities/dump-location.entity';
import { DumpTicket } from './modules/dump-locations/entities/dump-ticket.entity';
import { SubscriptionPlan } from './modules/subscriptions/entities/subscription-plan.entity';
import { RentalChainsModule } from './modules/rental-chains/rental-chains.module';
import { LegacyBackfillModule } from './modules/legacy-backfill/legacy-backfill.module';
import { MapboxModule } from './modules/mapbox/mapbox.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { TenantSettingsModule } from './modules/tenant-settings/tenant-settings.module';
import { AiModule } from './modules/ai/ai.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { SetupChecklist } from './modules/onboarding/entities/setup-checklist.entity';
import { TenantSettings } from './modules/tenant-settings/entities/tenant-settings.entity';
import { AiSuggestionLog } from './modules/ai/entities/ai-suggestion-log.entity';
import { RateLimitLog } from './common/entities/rate-limit-log.entity';
import { HelpAnalyticsEvent } from './modules/analytics/entities/help-analytics-event.entity';
import { CreditAuditModule } from './modules/credit-audit/credit-audit.module';
import { CreditAuditEvent } from './modules/credit-audit/credit-audit-event.entity';
import { CreditCollectionEvent } from './modules/credit-audit/credit-collection-event.entity';
import { PermissionModule } from './modules/permissions/permission.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { Alert } from './modules/alerts/entities/alert.entity';

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
          entities: [
            Tenant,
            User,
            PasswordResetToken,
            Customer,
            Asset,
            Job,
            PricingRule,
            PricingTemplate,
            Invoice,
            InvoiceLineItem,
            InvoiceRevision,
            Payment,
            CreditMemo,
            BillingIssue,
            JobCost,
            RentalChain,
            TaskChainLink,
            ClientPricingOverride,
            SurchargeTemplate,
            ClientSurchargeOverride,
            TermsTemplate,
            Route,
            Notification,
            NotificationPreference,
            ClientNotificationOverride,
            ScheduledNotification,
            MarketplaceBooking,
            MarketplaceIntegration,
            DemoRequest,
            Yard,
            CustomerNote,
            TimeEntry,
            DumpLocation,
            DumpLocationRate,
            DumpLocationSurcharge,
            DumpTicket,
            SubscriptionPlan,
            Quote,
            SmsMessage,
            SmsNumberReleaseRequest,
            DeliveryZone,
            TenantFee,
            PricingSnapshot,
            JobPricingAudit,
            SetupChecklist,
            TenantSettings,
            AiSuggestionLog,
            RateLimitLog,
            HelpAnalyticsEvent,
            CreditAuditEvent,
            CreditCollectionEvent,
            Alert,
          ],
          synchronize: isTest,
          ssl: isTest ? false : { rejectUnauthorized: false },
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
