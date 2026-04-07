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
  service_sites: { total_scanned: number; already_valid: number; geocoded: number; failed: number };
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

    // Diagnostic: test geocoding availability before scanning records
    let testGeoError: string | null = null;
    let testGeo: { lat: number; lng: number } | null = null;
    try {
      testGeo = await this.mapbox.geocodeAddress('1 Main Street, Boston, MA');
    } catch (err) {
      testGeoError = err instanceof Error ? err.message : String(err);
    }
    const testMsg = testGeo ? 'OK (' + testGeo.lat + ',' + testGeo.lng + ')' : 'FAILED — ' + (testGeoError || 'returned null');
    this.logger.log('Geocode availability test: ' + testMsg);

    const result: BackfillResult & { _diagnostic?: Record<string, unknown> } = {
      tenant_id: opts.tenant_id,
      dry_run: dryRun,
      jobs: { total_scanned: 0, already_valid: 0, geocoded: 0, failed: 0, skipped_verified: 0 },
      customers: { total_scanned: 0, already_valid: 0, geocoded: 0, failed: 0, skipped_verified: 0 },
      service_sites: { total_scanned: 0, already_valid: 0, geocoded: 0, failed: 0 },
      failures: [],
      _diagnostic: {
        mapbox_available: !!testGeo,
        mapbox_token_set: !!process.env.MAPBOX_TOKEN,
        mapbox_token_length: (process.env.MAPBOX_TOKEN || '').length,
        mapbox_token_prefix: (process.env.MAPBOX_TOKEN || '').slice(0, 10),
        test_geocode_result: testGeo ? `${testGeo.lat},${testGeo.lng}` : null,
        test_geocode_error: testGeoError,
        test_raw_response: await this.testGeocodeRaw(),
      },
    };

    if (opts.include_jobs !== false) {
      await this.backfillJobs(opts.tenant_id, batchSize, dryRun, skipVerified, result);
    }

    if (opts.include_customers !== false) {
      await this.backfillCustomers(opts.tenant_id, batchSize, dryRun, skipVerified, result);
      await this.backfillServiceSites(opts.tenant_id, batchSize, dryRun, result);
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

  private async backfillServiceSites(
    tenantId: string,
    batchSize: number,
    dryRun: boolean,
    result: BackfillResult,
  ) {
    // Find customers with service_addresses that have at least one entry
    const customers = await this.customerRepo.find({
      where: { tenant_id: tenantId },
      select: ['id', 'service_addresses', 'tenant_id'],
      take: batchSize * 10,
    });

    for (const cust of customers) {
      const sites = cust.service_addresses as Record<string, unknown>[] | null;
      if (!sites || !Array.isArray(sites) || sites.length === 0) continue;

      let anyUpdated = false;
      const updatedSites = [...sites];

      for (let i = 0; i < updatedSites.length; i++) {
        const site = updatedSites[i];
        result.service_sites.total_scanned++;

        if (hasValidServiceCoordinates(site)) {
          result.service_sites.already_valid++;
          continue;
        }

        const addrStr = buildAddressString(site);
        if (!addrStr) {
          result.service_sites.failed++;
          result.failures.push({
            record_type: 'service_site', record_id: `${cust.id}[${i}]`,
            address: JSON.stringify(site), error: 'No geocodable address string',
          });
          continue;
        }

        const geo = await this.mapbox.geocodeAddress(addrStr);
        if (!geo || !isValidCoordinatePair(geo.lat, geo.lng)) {
          result.service_sites.failed++;
          result.failures.push({
            record_type: 'service_site', record_id: `${cust.id}[${i}]`,
            address: addrStr, error: geo ? 'Geocode returned invalid coordinates' : 'Mapbox geocode failed',
          });
          continue;
        }

        if (!dryRun) {
          updatedSites[i] = { ...site, lat: geo.lat, lng: geo.lng, geocoded_at: new Date().toISOString(), geocode_source: 'mapbox' };
          anyUpdated = true;
        }
        result.service_sites.geocoded++;
      }

      // Persist the entire updated array if any sites were geocoded
      if (anyUpdated && !dryRun) {
        await this.customerRepo
          .createQueryBuilder()
          .update(Customer)
          .set({ service_addresses: updatedSites as any })
          .where('id = :id AND tenant_id = :tenantId', { id: cust.id, tenantId })
          .execute();
      }
    }
  }

  /** Raw geocode test — bypasses MapboxService to capture full HTTP response */
  private async testGeocodeRaw(): Promise<string> {
    const token = process.env.MAPBOX_TOKEN || '';
    if (!token) return 'NO_TOKEN';
    try {
      const params = new URLSearchParams({ q: '1 Main Street, Boston, MA', access_token: token, country: 'US', limit: '1', types: 'address' });
      const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`, {
        headers: { 'Referer': 'https://serviceos-api.vercel.app' },
      });
      const body = await res.text();
      return `HTTP ${res.status}: ${body.slice(0, 300)}`;
    } catch (err) {
      return `FETCH_ERROR: ${err instanceof Error ? err.message : String(err)}`;
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
