import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository, In, DataSource } from 'typeorm';
import { Asset } from './entities/asset.entity';
import { Job } from '../jobs/entities/job.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { getTenantToday } from '../../common/utils/tenant-date.util';
import {
  CreateAssetDto,
  UpdateAssetDto,
  ListAssetsQueryDto,
} from './dto/asset.dto';
import { escapeRegex, getSubtypePrefix } from './subtype-prefix.util';

// Name of the unique index added by
// migrations/2026-04-23-assets-tenant-asset-type-identifier-unique-index.sql.
// Postgres surfaces this string in the `constraint` field of the 23505 error,
// which is how we distinguish "duplicate asset number" from any other unique
// violation on this table. Keep in sync with the migration.
const ASSET_UNIQUE_CONSTRAINT = 'assets_tenant_asset_type_identifier_unique';

// Phase B — job statuses that mean "job is no longer consuming inventory
// for projection purposes". Terminal states (completed/cancelled) plus
// failed and needs_reschedule — both of which leave the asset in a
// distinct physical state but are no longer committing new capacity
// against the projection window.
const TERMINAL_JOB_STATUSES = [
  'completed',
  'cancelled',
  'failed',
  'needs_reschedule',
] as const;

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private assetsRepository: Repository<Asset>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    // DataSource is a globally-registered provider by `TypeOrmModule.forRoot`.
    // Used only by `loadTenantTimezone` to read `tenant_settings` without
    // requiring `TenantSettings` to be added to this module's
    // `TypeOrmModule.forFeature([...])` list. Mirrors the
    // `JobsService.loadTenantTimezone` pattern.
    private dataSource: DataSource,
  ) {}

  /**
   * Phase B — tenant-local timezone resolver. Mirrors
   * `JobsService.loadTenantTimezone`. Fallback is `undefined` so
   * `getTenantToday()` uses its canonical default of America/New_York.
   */
  private async loadTenantTimezone(
    tenantId: string,
  ): Promise<string | undefined> {
    const repo = this.dataSource.getRepository(TenantSettings);
    const s = await repo.findOne({ where: { tenant_id: tenantId } });
    return s?.timezone ?? undefined;
  }

  async create(tenantId: string, dto: CreateAssetDto): Promise<Asset> {
    const asset = this.assetsRepository.create({
      tenant_id: tenantId,
      asset_type: dto.assetType,
      subtype: dto.subtype,
      identifier: dto.identifier,
      status: dto.status ?? 'available',
      condition: dto.condition,
      current_location_type: dto.currentLocationType,
      current_location: dto.currentLocation,
      notes: dto.notes,
      metadata: dto.metadata,
    });
    try {
      return await this.assetsRepository.save(asset);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  /**
   * Max-suffix-plus-one allocator. Scopes by (tenant_id, asset_type,
   * identifier LIKE prefix-%), parses standard-format identifiers in JS
   * (so non-standard deviants like "SPECIAL-UNIT" are ignored without
   * corrupting the max), and returns `{prefix}-{nn}` zero-padded to width
   * 2, widening to 3 once a tenant crosses 99 of one prefix.
   *
   * Intentionally NOT cached. Cheap query (small result set per prefix);
   * correctness under concurrent creates is enforced by the DB unique
   * index — two callers can both see "10-07" as next; second POST gets
   * 409 and the client increments.
   */
  async getNextAssetNumber(
    tenantId: string,
    assetType: string,
    subtype: string,
  ): Promise<string> {
    const prefix = getSubtypePrefix(subtype);

    const rows = await this.assetsRepository
      .createQueryBuilder('a')
      .select('a.identifier', 'identifier')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.asset_type = :assetType', { assetType })
      .andWhere('a.identifier LIKE :pattern', { pattern: `${prefix}-%` })
      .getRawMany<{ identifier: string }>();

    const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d{2,3})$`);
    const suffixes = rows
      .map((r) => r.identifier.match(pattern))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => parseInt(m[1], 10))
      .filter((n) => Number.isFinite(n));

    const nextSuffix = (suffixes.length === 0 ? 0 : Math.max(...suffixes)) + 1;
    const width = nextSuffix >= 100 ? 3 : 2;
    return `${prefix}-${String(nextSuffix).padStart(width, '0')}`;
  }

  // Translate Postgres unique-violation on the asset-number index into a
  // structured ConflictException the frontend can disambiguate from other
  // conflicts. Re-throws anything else unchanged so callers see the
  // original error.
  private translateUniqueViolation(err: unknown): void {
    if (!(err instanceof QueryFailedError)) return;
    const driverError = (err as any).driverError;
    if (driverError?.code !== '23505') return;
    const constraint = driverError?.constraint || '';
    const detail = driverError?.detail || '';
    if (
      constraint === ASSET_UNIQUE_CONSTRAINT ||
      detail.includes(ASSET_UNIQUE_CONSTRAINT)
    ) {
      throw new ConflictException({
        error: 'duplicate_asset_number',
        message:
          'An asset with this number already exists. Please choose another.',
      });
    }
  }

  async findAll(tenantId: string, query: ListAssetsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.assetsRepository
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId });

    if (query.type) {
      qb.andWhere('a.asset_type = :type', { type: query.type });
    }

    if (query.subtype) {
      qb.andWhere('a.subtype = :subtype', { subtype: query.subtype });
    }

    if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }

    qb.orderBy('a.created_at', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(tenantId: string, id: string): Promise<Asset> {
    const asset = await this.assetsRepository.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!asset) {
      throw new NotFoundException(`Asset ${id} not found`);
    }
    return asset;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateAssetDto,
  ): Promise<Asset> {
    const asset = await this.findOne(tenantId, id);

    if (dto.assetType !== undefined) asset.asset_type = dto.assetType;
    if (dto.subtype !== undefined) asset.subtype = dto.subtype;
    if (dto.identifier !== undefined) asset.identifier = dto.identifier;
    if (dto.status !== undefined) asset.status = dto.status;
    if (dto.condition !== undefined) asset.condition = dto.condition;
    if (dto.currentLocationType !== undefined)
      asset.current_location_type = dto.currentLocationType;
    if (dto.currentLocation !== undefined)
      asset.current_location = dto.currentLocation;
    if (dto.notes !== undefined) asset.notes = dto.notes;
    if (dto.metadata !== undefined) asset.metadata = dto.metadata;

    try {
      return await this.assetsRepository.save(asset);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const asset = await this.findOne(tenantId, id);

    try {
      await this.assetsRepository.remove(asset);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const driverError = (err as any).driverError;
        const code = driverError?.code;
        const constraint = driverError?.constraint || '';
        const detail = driverError?.detail || '';
        const message = err.message || '';

        if (code === '23503') {
          // assigned to jobs
          if (
            constraint === 'FK_8d31aa61b1949bfb81bd846e101' ||
            detail.includes('FK_8d31aa61b1949bfb81bd846e101') ||
            message.includes('FK_8d31aa61b1949bfb81bd846e101')
          ) {
            throw new ConflictException(
              'Cannot delete this asset — it is assigned to one or more jobs. Reassign or complete those jobs first.'
            );
          }

          // part of rental chains
          if (
            constraint === 'FK_9e43ca6dfec21fa9362e13ac189' ||
            detail.includes('FK_9e43ca6dfec21fa9362e13ac189') ||
            message.includes('FK_9e43ca6dfec21fa9362e13ac189')
          ) {
            throw new ConflictException(
              'Cannot delete this asset — it is part of an active rental chain.'
            );
          }

          // Fallback for any unknown FK constraint on assets
          throw new ConflictException(
            'Cannot delete this asset — it is still referenced by other records.'
          );
        }
      }
      throw err;
    }
  }

  async findAvailable(tenantId: string, assetType: string): Promise<Asset[]> {
    return this.assetsRepository
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.asset_type = :assetType', { assetType })
      .andWhere('a.status NOT IN (:...excluded)', {
        excluded: ['reserved', 'deployed', 'on_site', 'in_transit', 'full_staged', 'maintenance'],
      })
      .andWhere('a.needs_dump = false')
      .andWhere('a.current_job_id IS NULL')
      .orderBy('a.created_at', 'DESC')
      .getMany();
  }

  async getUtilizationStats(
    tenantId: string,
  ): Promise<{ status: string; count: number }[]> {
    return this.assetsRepository
      .createQueryBuilder('a')
      .select('a.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where('a.tenant_id = :tenantId', { tenantId })
      .groupBy('a.status')
      .getRawMany();
  }

  async getAwaitingDump(tenantId: string): Promise<Asset[]> {
    return this.assetsRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.yard', 'yard')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('(a.status = :staged OR a.needs_dump = true)', { staged: 'full_staged' })
      .orderBy('a.staged_at', 'ASC', 'NULLS LAST')
      .getMany();
  }

  async addHistory(assetId: string, tenantId: string, event: {
    event: string;
    actor_id?: string;
    actor_role?: string;
    job_id?: string;
    yard_id?: string;
    yard_name?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const asset = await this.assetsRepository.findOne({ where: { id: assetId, tenant_id: tenantId } });
    if (!asset) return;
    const history = Array.isArray(asset.operational_history) ? [...asset.operational_history] : [];
    history.push({ ...event, timestamp: new Date().toISOString() });
    // Keep last 50 entries
    if (history.length > 50) history.splice(0, history.length - 50);
    await this.assetsRepository.update(assetId, { operational_history: history } as any);
  }

  /**
   * Public dispatcher for projected availability.
   *
   * When `subtype` is a non-empty string, returns the single
   * subtype's availability object (the pre-existing response shape,
   * unchanged). When `subtype` is omitted or empty, returns an
   * array of availability objects — one per distinct subtype in
   * the tenant's asset inventory, ordered ascending by subtype for
   * deterministic rendering. Consumers that previously fired N
   * parallel per-subtype calls (Assets page projection table, the
   * booking-flow per-pill signal) can switch to the array form to
   * guarantee consistent numbers across subtypes and reduce DB
   * round-trips on the client side.
   *
   * Multi-subtype path delegates to
   * `calculateAvailabilityForSubtype` per subtype — the same
   * helper the single-subtype path uses — so both paths share
   * identical formula, filters, warnings, and exchange-subtype
   * resolution logic. No shortcut logic, no merged query, no
   * duplicated math.
   */
  async getAvailability(
    tenantId: string,
    subtype: string | undefined,
    date?: string,
    options: { confirmedOnly?: boolean } = {},
  ) {
    if (subtype && subtype.trim().length > 0) {
      return this.calculateAvailabilityForSubtype(
        tenantId,
        subtype,
        date,
        options,
      );
    }

    // Multi-subtype path — source subtypes from DISTINCT
    // `assets.subtype` scoped to this tenant. Nulls are excluded
    // (they cannot be projected against). Ordering is ASC so
    // consumer UIs stay stable between calls.
    const rows = await this.assetsRepository
      .createQueryBuilder('a')
      .select('DISTINCT a.subtype', 'subtype')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.subtype IS NOT NULL')
      .orderBy('a.subtype', 'ASC')
      .getRawMany<{ subtype: string | null }>();

    const subtypes = rows
      .map((r) => r.subtype)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);

    // Sequential await — tenants have ~3–6 subtypes, so pipeline
    // depth matters less than predictable connection usage. Each
    // helper call runs a handful of tenant-scoped queries; running
    // them sequentially keeps peak DB load bounded.
    const results = [];
    for (const st of subtypes) {
      results.push(
        await this.calculateAvailabilityForSubtype(
          tenantId,
          st,
          date,
          options,
        ),
      );
    }
    return results;
  }

  /**
   * Phase B — Projected asset availability for a target date.
   *
   * Formula:
   *
   *   base_available   = COUNT(assets.status = 'available'
   *                            AND subtype = :subtype
   *                            AND needs_dump = false
   *                            AND current_job_id IS NULL)
   *   outgoing_count   = COUNT(jobs.job_type IN ('delivery','exchange')
   *                            AND jobs.asset_subtype = :subtype
   *                            AND jobs.scheduled_date <= :targetDate
   *                            AND jobs.status NOT IN (TERMINAL_JOB_STATUSES))
   *   incoming_count   = COUNT(jobs.job_type = 'pickup'
   *                            AND jobs.asset_subtype = :subtype
   *                            AND jobs.scheduled_date <= :targetDate
   *                            AND jobs.status NOT IN (TERMINAL_JOB_STATUSES))
   *   projected        = max(0, base_available + incoming_count - outgoing_count)
   *
   * Key decisions (vs. the pre-Phase-B implementation):
   * - Uses `getTenantToday(tz)` for today rather than UTC rollover.
   * - Job queries are subtype-filtered by `job.asset_subtype` (not by
   *   joining through `asset.subtype`, because under Phase B2
   *   `asset_id` may be null pre-completion).
   * - Status exclusion set widens to include `failed` and
   *   `needs_reschedule` (previously only completed/cancelled).
   * - Date filter is symmetric: `scheduled_date <= :target` on both
   *   sides. No `>= today` lower bound — past-due active jobs count
   *   as committed inventory, which matches operational reality.
   * - Base excludes `reserved` (legacy pre-B2 state) to avoid
   *   double-counting with the delivery in the outgoing set.
   * - Exchange is counted delivery-side only; pickup-side subtype
   *   requires rental-chain traversal which is deferred to a later
   *   phase. A warning is emitted when exchanges are present.
   * - `dump_run` / `dump_and_return` are ignored (net-zero at day
   *   granularity).
   *
   * `confirmedOnly=true` additionally excludes `pending` jobs from
   * both the outgoing and incoming sets — a conservative view for
   * planning use cases that only want firmly-committed capacity.
   */
  private async calculateAvailabilityForSubtype(
    tenantId: string,
    subtype: string,
    date?: string,
    options: { confirmedOnly?: boolean } = {},
  ) {
    const { confirmedOnly = false } = options;

    // Tenant-local today — replaces the UTC-rollover bug. After 8pm
    // Eastern, `new Date().toISOString().split('T')[0]` would return
    // tomorrow's date in the tenant's local frame. `getTenantToday`
    // resolves via tenant_settings.timezone.
    const tz = await this.loadTenantTimezone(tenantId);
    const todayStr = getTenantToday(tz);
    const targetDate = date || todayStr;

    // Fetch all assets matching subtype for the informational counts
    // (deployed/reserved/in_transit/maintenance) that the old response
    // shape returns. The strict base filter is applied in-memory on
    // this fetched list so we don't hit the DB twice.
    const assets = await this.assetsRepository.find({
      where: { tenant_id: tenantId, subtype },
    });

    const total = assets.length;
    const deployed = assets.filter(
      (a) => a.status === 'on_site' || a.status === 'deployed',
    ).length;
    const reserved = assets.filter((a) => a.status === 'reserved').length;
    const inTransit = assets.filter((a) => a.status === 'in_transit').length;
    const maintenance = assets.filter((a) => a.status === 'maintenance').length;

    // Strict base filter — status='available' AND not pending dump
    // AND not referentially held by any job. Matches the stricter
    // filter used by `findAvailable` above and excludes every known
    // "out of inventory" condition without trusting any single flag.
    const availableNow = assets.filter(
      (a) =>
        a.status === 'available' &&
        !a.needs_dump &&
        !a.current_job_id,
    ).length;

    // Expand the terminal set with `pending` when the caller wants
    // only firmly-committed capacity.
    const excludedStatuses: string[] = [
      ...TERMINAL_JOB_STATUSES,
      ...(confirmedOnly ? ['pending'] : []),
    ];

    // Outgoing — deliveries + exchange (drop-off side).
    //
    // Delivery: filtered by the denormalized `j.asset_subtype` column
    // which is always populated at booking time for deliveries.
    //
    // Exchange (drop-off side): production data shows `asset_subtype`
    // is NULL on most exchange rows, so the primary resolution path
    // is the `drop_off_asset_id` → `assets.subtype` join. Falls back
    // to `j.asset_subtype` when no drop-off asset is pre-assigned
    // (covers the `asset_subtype` set / `drop_off_asset_id` null
    // case). Exchanges where NEITHER resolves are excluded — an
    // exchange with no committed drop-off subtype cannot contribute
    // a known size to the projection.
    const outgoingJobs = await this.jobsRepository
      .createQueryBuilder('j')
      .leftJoin(
        'assets',
        'dropoff_asset',
        'dropoff_asset.id = j.drop_off_asset_id',
      )
      .select([
        'j.id',
        'j.job_number',
        'j.scheduled_date',
        'j.status',
        'j.job_type',
      ])
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere(
        '((j.job_type = :deliveryType AND j.asset_subtype = :subtype) OR (j.job_type = :exchangeType AND COALESCE(dropoff_asset.subtype, j.asset_subtype) = :subtype))',
        {
          deliveryType: 'delivery',
          exchangeType: 'exchange',
          subtype,
        },
      )
      .andWhere('j.status NOT IN (:...excluded)', {
        excluded: excludedStatuses,
      })
      .andWhere('j.scheduled_date IS NOT NULL')
      .andWhere('j.scheduled_date <= :target', { target: targetDate })
      .orderBy('j.scheduled_date', 'ASC')
      .getMany();

    // Incoming — pickups + exchange (pickup side). Before this fix
    // exchange pickup-side was entirely absent from incoming, which
    // undercounted returning inventory.
    //
    // Pickup: filtered by `j.asset_subtype` (denorm reliable for
    // pure pickups).
    //
    // Exchange (pickup side): primary resolution via `asset_id` →
    // `assets.subtype` (confirmed present on 4 of 5 production
    // exchanges), falling back to `j.asset_subtype` for the rare
    // asset_id-null case. Exchanges where NEITHER resolves are
    // excluded.
    const incomingJobs = await this.jobsRepository
      .createQueryBuilder('j')
      .leftJoin('assets', 'pickup_asset', 'pickup_asset.id = j.asset_id')
      .select([
        'j.id',
        'j.job_number',
        'j.scheduled_date',
        'j.status',
        'j.job_type',
      ])
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere(
        '((j.job_type = :pickupType AND j.asset_subtype = :subtype) OR (j.job_type = :exchangeType AND COALESCE(pickup_asset.subtype, j.asset_subtype) = :subtype))',
        {
          pickupType: 'pickup',
          exchangeType: 'exchange',
          subtype,
        },
      )
      .andWhere('j.status NOT IN (:...excluded)', {
        excluded: excludedStatuses,
      })
      .andWhere('j.scheduled_date IS NOT NULL')
      .andWhere('j.scheduled_date <= :target', { target: targetDate })
      .orderBy('j.scheduled_date', 'ASC')
      .getMany();

    const outgoingCount = outgoingJobs.length;
    const incomingCount = incomingJobs.length;
    const projectedAvailable = Math.max(
      0,
      availableNow + incomingCount - outgoingCount,
    );

    // Stale past-due count — active delivery/exchange jobs with
    // scheduled_date strictly before today. Mirrors the outgoing
    // subtype-resolution rules (delivery via asset_subtype,
    // exchange via drop_off_asset join with asset_subtype
    // fallback) so the reported count matches what is actually
    // included in outgoing_count.
    const stalePastDue = await this.jobsRepository
      .createQueryBuilder('j')
      .leftJoin(
        'assets',
        'dropoff_asset',
        'dropoff_asset.id = j.drop_off_asset_id',
      )
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere(
        '((j.job_type = :deliveryType AND j.asset_subtype = :subtype) OR (j.job_type = :exchangeType AND COALESCE(dropoff_asset.subtype, j.asset_subtype) = :subtype))',
        {
          deliveryType: 'delivery',
          exchangeType: 'exchange',
          subtype,
        },
      )
      .andWhere('j.status NOT IN (:...excluded)', {
        excluded: excludedStatuses,
      })
      .andWhere('j.scheduled_date IS NOT NULL')
      .andWhere('j.scheduled_date < :today', { today: todayStr })
      .getCount();

    // Deterministic warnings. Strings are plain English, contain no
    // PII, and are safe to render directly in an operator UI.
    const warnings: string[] = [];
    if (reserved > 0) {
      warnings.push(
        `${reserved} asset(s) in subtype '${subtype}' are marked 'reserved' (legacy pre-B2 state) and are excluded from base_available. Their linked delivery jobs are already counted in outgoing_count — including reserved in the base would double-subtract.`,
      );
    }
    if (stalePastDue > 0) {
      warnings.push(
        `${stalePastDue} active delivery/exchange job(s) have scheduled_date before today (${todayStr}). They are included in outgoing_count as committed capacity, but likely represent stale data that should be completed or cancelled.`,
      );
    }

    // Lightweight mapper for job breakdown in the response
    const mapJob = (j: Job) => ({
      id: j.id,
      job_number: j.job_number,
      scheduled_date: j.scheduled_date,
      status: j.status,
      job_type: j.job_type,
    });

    return {
      // ── Backward-compat fields (existing response shape) ──
      // The projection endpoint has been returning this exact shape
      // since before Phase B. Preserved verbatim so any existing
      // consumer (frontend widgets, dispatch board, tests) doesn't
      // break. New canonical field names below.
      subtype,
      date: targetDate,
      total,
      deployed,
      reserved,
      inTransit,
      maintenance,
      availableNow,
      // Legacy name kept — value now matches the corrected formula.
      // Before Phase B this counted pickups between today and target;
      // after Phase B it counts every active pickup with
      // scheduled_date <= target (including past-due, which is
      // correct — past-due pickups still represent committed
      // incoming capacity).
      pickupsBeforeDate: incomingCount,
      // Legacy name kept — value now matches the corrected formula.
      reservedForDate: outgoingCount,
      availableOnDate: projectedAvailable,

      // ── Phase B canonical fields ──
      target_date: targetDate,
      base_available: availableNow,
      outgoing_count: outgoingCount,
      incoming_count: incomingCount,
      projected_available: projectedAvailable,
      reserved_count: reserved,
      confirmed_only: confirmedOnly,
      outgoing_jobs: outgoingJobs.map(mapJob),
      incoming_jobs: incomingJobs.map(mapJob),
      warnings,
    };
  }
}
