import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from './entities/alert.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { Job } from '../jobs/entities/job.entity';
import { BillingIssue } from '../billing/entities/billing-issue.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { AlertsController } from './controllers/alerts.controller';
import { AlertService } from './services/alert.service';
import { AlertDetectorService } from './services/alert-detector.service';
import { ReportingModule } from '../reporting/reporting.module';

/**
 * Phase 14 — Alerts / Exceptions module.
 *
 * Registers the new `alerts` table entity and wires the two
 * services. Imports ReportingModule so AlertDetectorService can
 * inject ReportingService for the LOW_MARGIN_CHAIN detector
 * (which reuses getLifecycleReport rather than duplicating
 * financial math — see Phase 14 non-goals).
 *
 * Reads (but does not own) RentalChain, Job, BillingIssue, and
 * DumpTicket. Those entities are declared here via
 * TypeOrmModule.forFeature solely so @InjectRepository works
 * inside AlertDetectorService; their canonical modules still own
 * writes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Alert,
      RentalChain,
      Job,
      BillingIssue,
      DumpTicket,
      // Phase B3 — AlertDetectorService loads tenant_settings.timezone
      // once per detection run to make day-boundary detectors
      // (overdue_rental, low_margin_chain) tenant-tz-aware.
      TenantSettings,
    ]),
    ReportingModule,
  ],
  controllers: [AlertsController],
  providers: [AlertService, AlertDetectorService],
  exports: [AlertService],
})
export class AlertsModule {}
