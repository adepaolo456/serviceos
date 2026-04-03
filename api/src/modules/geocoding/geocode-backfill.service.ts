import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { MapboxService } from '../mapbox/mapbox.service';
import {
  isValidCoordinatePair,
  hasValidServiceCoordinates,
  buildAddressString,
} from '../../common/helpers/coordinate-validator';

export interface BackfillOptions {
  tenant_id: string;
  batch_size?: number;
  dry_run?: boolean;
  include_jobs?: boolean;
  include_customers?: boolean;
  skip_verified?: boolean;
}

export interface BackfillResult {
  tenant_id: string;
  dry_run: boolean;
  jobs: { total_scanned: number; already_valid: number; geocoded: number; failed: number; skipped_verified: number };
  customers: { total_scanned: number; already_valid: number; geocoded: number; failed: number; skipped_verified: number };
  failures: Array<{ record_type: string; record_id: string; address: string; error: string }>;
}

@Injectable()
export class GeocodeBackfillService {
  private readonly logger = new Logger(GeocodeBackfillService.name);

  constructor(
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    private mapbox: MapboxService,
  ) {}

  async backfill(opts: BackfillOptions): Promise<BackfillResult> {
    const batchSize = opts.batch_size || 50;
    const dryRun = opts.dry_run ?? true;
    const skipVerified = opts.skip_verified ?? true;

    const result: BackfillResult = {
      tenant_id: opts.tenant_id,
      dry_run: dryRun,
      jobs: { total_scanned: 0, already_valid: 0, geocoded: 0, failed: 0, skipped_verified: 0 },
      customers: { total_scanned: 0, already_valid: 0, geocoded: 0, failed: 0, skipped_verified: 0 },
      failures: [],
    };

    if (opts.include_jobs !== false) {
      await this.backfillJobs(opts.tenant_id, batchSize, dryRun, skipVerified, result);
    }

    if (opts.include_customers !== false) {
      await this.backfillCustomers(opts.tenant_id, batchSize, dryRun, skipVerified, result);
    }

    return result;
  }

  private async backfillJobs(
    tenantId: string,
    batchSize: number,
    dryRun: boolean,
    skipVerified: boolean,
    result: BackfillResult,
  ) {
    const jobs = await this.jobRepo.find({
      where: { tenant_id: tenantId },
      select: ['id', 'service_address', 'tenant_id'],
      take: batchSize * 10, // scan up to 10x batch for candidates
    });

    for (const job of jobs) {
      result.jobs.total_scanned++;
      const addr = job.service_address as Record<string, unknown> | null;

      if (hasValidServiceCoordinates(addr)) {
        result.jobs.already_valid++;
        continue;
      }

      // Check if manually verified (coordinates_verified flag in JSONB)
      if (skipVerified && addr?.coordinates_verified === true) {
        result.jobs.skipped_verified++;
        continue;
      }

      const addrStr = buildAddressString(addr);
      if (!addrStr) {
        result.jobs.failed++;
        result.failures.push({
          record_type: 'job', record_id: job.id,
          address: JSON.stringify(addr), error: 'No geocodable address string',
        });
        continue;
      }

      const geo = await this.mapbox.geocodeAddress(addrStr);
      if (!geo || !isValidCoordinatePair(geo.lat, geo.lng)) {
        result.jobs.failed++;
        result.failures.push({
          record_type: 'job', record_id: job.id,
          address: addrStr, error: geo ? 'Geocode returned invalid coordinates' : 'Mapbox geocode failed',
        });
        continue;
      }

      if (!dryRun) {
        const updated = { ...addr, lat: geo.lat, lng: geo.lng, geocoded_at: new Date().toISOString(), geocode_source: 'mapbox' };
        await this.jobRepo
          .createQueryBuilder()
          .update(Job)
          .set({ service_address: updated as any })
          .where('id = :id AND tenant_id = :tenantId', { id: job.id, tenantId })
          .execute();
      }
      result.jobs.geocoded++;

      if (result.jobs.geocoded >= batchSize) break;
    }
  }

  private async backfillCustomers(
    tenantId: string,
    batchSize: number,
    dryRun: boolean,
    skipVerified: boolean,
    result: BackfillResult,
  ) {
    const customers = await this.customerRepo.find({
      where: { tenant_id: tenantId },
      select: ['id', 'billing_address', 'tenant_id'],
      take: batchSize * 10,
    });

    for (const cust of customers) {
      result.customers.total_scanned++;
      const addr = cust.billing_address as Record<string, unknown> | null;

      if (hasValidServiceCoordinates(addr)) {
        result.customers.already_valid++;
        continue;
      }

      if (skipVerified && addr?.coordinates_verified === true) {
        result.customers.skipped_verified++;
        continue;
      }

      const addrStr = buildAddressString(addr);
      if (!addrStr) {
        result.customers.failed++;
        result.failures.push({
          record_type: 'customer', record_id: cust.id,
          address: JSON.stringify(addr), error: 'No geocodable address string',
        });
        continue;
      }

      const geo = await this.mapbox.geocodeAddress(addrStr);
      if (!geo || !isValidCoordinatePair(geo.lat, geo.lng)) {
        result.customers.failed++;
        result.failures.push({
          record_type: 'customer', record_id: cust.id,
          address: addrStr, error: geo ? 'Geocode returned invalid coordinates' : 'Mapbox geocode failed',
        });
        continue;
      }

      if (!dryRun) {
        const updated = { ...addr, lat: geo.lat, lng: geo.lng, geocoded_at: new Date().toISOString(), geocode_source: 'mapbox' };
        await this.customerRepo
          .createQueryBuilder()
          .update(Customer)
          .set({ billing_address: updated as any })
          .where('id = :id AND tenant_id = :tenantId', { id: cust.id, tenantId })
          .execute();
      }
      result.customers.geocoded++;

      if (result.customers.geocoded >= batchSize) break;
    }
  }

  /**
   * Returns records that still need manual review after backfill.
   */
  async getFailedRecords(tenantId: string, limit = 50): Promise<Array<{
    record_type: string;
    record_id: string;
    address: string | null;
    last_geocode_attempt: string | null;
  }>> {
    // Jobs with missing coordinates
    const jobs = await this.jobRepo
      .createQueryBuilder('j')
      .select(['j.id', 'j.service_address'])
      .where('j.tenant_id = :tenantId', { tenantId })
      .take(limit)
      .getMany();

    return jobs
      .filter(j => !hasValidServiceCoordinates(j.service_address as Record<string, unknown>))
      .map(j => ({
        record_type: 'job',
        record_id: j.id,
        address: buildAddressString(j.service_address as Record<string, unknown>),
        last_geocode_attempt: (j.service_address as Record<string, unknown>)?.geocoded_at as string || null,
      }));
  }
}
