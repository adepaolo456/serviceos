import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository, In, Not, DataSource, EntityManager } from 'typeorm';
import { Asset } from './entities/asset.entity';
import { Job } from '../jobs/entities/job.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { getTenantToday } from '../../common/utils/tenant-date.util';
import {
  CreateAssetDto,
  UpdateAssetDto,
  ListAssetsQueryDto,
  RetireAssetDto,
} from './dto/asset.dto';
import { escapeRegex, getSubtypePrefix } from './subtype-prefix.util';
import { TERMINAL_JOB_STATUSES } from '../../common/constants/job-statuses';

// Name of the unique index added by
// migrations/2026-04-23-assets-tenant-asset-type-identifier-unique-index.sql.
// Postgres surfaces this string in the `constraint` field of the 23505 error,
// which is how we distinguish "duplicate asset number" from any other unique
// violation on this table. Keep in sync with the migration.
const ASSET_UNIQUE_CONSTRAINT = 'assets_tenant_asset_type_identifier_unique';

// Nested payload shape attached to each Asset in the findAll response.
// Drives the Deployed table's Customer / Address / Days Out / Overdue
// render. Nullable throughout to absorb the defense-in-depth case where
// a deployed asset has no active chain (DB invariant should prevent it).
export interface ActiveChainPayload {
  id: string;
  drop_off_date: string;
  rental_days: number;
  customer: {
    id: string;
    type: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    billing_address: Record<string, any> | null;
  } | null;
}

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private assetsRepository: Repository<Asset>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(RentalChain)
    private rentalChainsRepository: Repository<RentalChain>,
    // DataSource is a globally-registered provider by `TypeOrmModule.forRoot`.
    // Used only by `loadTenantTimezone` to read `tenant_settings` without
    // requiring `TenantSettings` to be added to this module's
    // `TypeOrmModule.forFeature([...])` list. Mirrors the
    // `JobsService.loadTenantTimezone` pattern.
    private dataSource: DataSource,
  ) {}

  /**
   * PR-B Surface 1 — pessimistic-write lock on an asset row. Acquires a
   * row-level FOR UPDATE lock inside the caller-supplied TX manager so
   * concurrent reservation flows serialize at the asset row instead of
   * racing on a stale read. Caller owns the TX boundary; the helper
   * never resolves a manager from `this`. tenant_id is required in the
   * WHERE clause — multi-tenant safety standing rule.
   */
  async lockAssetRow(
    manager: EntityManager,
    assetId: string,
    tenantId: string,
  ): Promise<Asset> {
    const asset = await manager.getRepository(Asset).findOne({
      where: { id: assetId, tenant_id: tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }

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

    // Default-exclude retired. Honor includeRetired=true as opt-in; an
    // explicit status=retired filter also implies the user wants retired
    // rows (skips the exclusion). Covered by the partial index added in
    // migrations/2026-04-23-add-assets-retired-fields.sql.
    const wantsRetired =
      query.includeRetired === true || query.status === 'retired';
    if (!wantsRetired) {
      qb.andWhere('a.status != :retiredStatus', { retiredStatus: 'retired' });
    }

    qb.orderBy('a.created_at', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    // Enrich each asset with its active rental chain + customer for the
    // Deployed-table UI (customer name, address, drop-off date, rental
    // days → Days Out + overdue flag). One active chain per asset is
    // enforced by the `rental_chain_active_requires_asset` DB invariant,
    // so a LEFT JOIN yields at most one row per asset — no DISTINCT and
    // no row multiplication needed. Tenant scoping is explicit on both
    // joined tables as defense-in-depth; the FKs alone are not trusted.
    const assetIds = data.map((a) => a.id);
    const chainMap = new Map<string, ActiveChainPayload>();
    if (assetIds.length > 0) {
      const chains = await this.rentalChainsRepository
        .createQueryBuilder('rc')
        .leftJoinAndSelect('rc.customer', 'c', 'c.tenant_id = :tenantId', {
          tenantId,
        })
        .where('rc.tenant_id = :tenantId', { tenantId })
        .andWhere('rc.status = :active', { active: 'active' })
        .andWhere('rc.asset_id IN (:...assetIds)', { assetIds })
        .getMany();

      for (const rc of chains) {
        const cust = rc.customer;
        chainMap.set(rc.asset_id, {
          id: rc.id,
          drop_off_date: rc.drop_off_date,
          rental_days: rc.rental_days,
          customer: cust
            ? {
                id: cust.id,
                type: cust.type,
                first_name: cust.first_name ?? null,
                last_name: cust.last_name ?? null,
                company_name: cust.company_name ?? null,
                billing_address:
                  (cust.billing_address as Record<string, any> | null) ?? null,
              }
            : null,
        });
      }
    }

    const enriched = data.map((a) => ({
      ...a,
      active_chain: chainMap.get(a.id) ?? null,
    }));

    return {
      data: enriched,
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

    // Retired assets are read-only. Unretire is the only legal transition
    // back to an editable state (service-only in v1 — no HTTP route).
    // This guard plus the DTO-level removal of 'retired' from IsIn closes
    // the "metadata-less retire" backdoor that existed before Item 4.
    if (asset.status === 'retired') {
      throw new ConflictException({
        error: 'asset_retired',
        message:
          'Cannot edit a retired asset. Unretire it first if changes are needed.',
      });
    }

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

  // Retire an asset. Captures actor + reason + optional notes. Blocks if
  // the asset is currently in active use — any non-terminal job (via
  // asset_id or drop_off_asset_id) or any active rental chain.
  //
  // jobs.pick_up_asset_id is deliberately NOT checked — it's historical
  // driver-app metadata, not a "currently in use" signal, and has no FK
  // to assets.id (verified against prod). Hard-delete DOES check it
  // (integrity), but retire is only about active work.
  //
  // Uses live joins against jobs (the authoritative truth); there is no
  // denormalized pointer column on assets after Item 5 removed the
  // drifting `current_job_id`.
  async retire(
    tenantId: string,
    assetId: string,
    userId: string,
    dto: RetireAssetDto,
  ): Promise<Asset> {
    const asset = await this.assetsRepository.findOne({
      where: { id: assetId, tenant_id: tenantId },
    });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    if (asset.status === 'retired') {
      throw new ConflictException({
        error: 'already_retired',
        message: 'This asset is already retired.',
      });
    }

    const activeJobCount = await this.jobsRepository
      .createQueryBuilder('j')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('(j.asset_id = :assetId OR j.drop_off_asset_id = :assetId)', {
        assetId,
      })
      .andWhere('j.status NOT IN (:...terminal)', {
        terminal: TERMINAL_JOB_STATUSES,
      })
      .getCount();

    // Positive filter against the authoritative "open chain" signal.
    // Rental-chain lifecycle uses status='active' as the single source
    // of truth for an open chain (see rental-chains.service.ts and
    // jobs.service.ts:3361). Completed/cancelled/any-future-terminal
    // state naturally falls out without us maintaining a terminal set.
    const activeChainCount = await this.rentalChainsRepository
      .createQueryBuilder('rc')
      .where('rc.tenant_id = :tenantId', { tenantId })
      .andWhere('rc.asset_id = :assetId', { assetId })
      .andWhere('rc.status = :active', { active: 'active' })
      .getCount();

    if (activeJobCount > 0 || activeChainCount > 0) {
      throw new ConflictException({
        error: 'asset_in_use',
        message: `Cannot retire an asset currently in active use (${activeJobCount} active job(s), ${activeChainCount} active chain(s)). Complete or reassign the linked work first.`,
      });
    }

    asset.status = 'retired';
    asset.retired_at = new Date();
    asset.retired_by = userId;
    asset.retired_reason = dto.reason;
    asset.retired_notes = dto.notes ?? null;
    return this.assetsRepository.save(asset);
  }

  // Service-only (no HTTP route in v1). Clears all retire metadata and
  // sets the asset back to 'available'. Owner-scoped by caller.
  async unretire(tenantId: string, assetId: string): Promise<Asset> {
    const asset = await this.assetsRepository.findOne({
      where: { id: assetId, tenant_id: tenantId },
    });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    if (asset.status !== 'retired') {
      throw new ConflictException({
        error: 'not_retired',
        message: 'Asset is not retired.',
      });
    }
    asset.status = 'available';
    asset.retired_at = null;
    asset.retired_by = null;
    asset.retired_reason = null;
    asset.retired_notes = null;
    return this.assetsRepository.save(asset);
  }

  // Permanent deletion. Blocks if ANY reference exists across 4 columns:
  // jobs.asset_id, jobs.drop_off_asset_id, jobs.pick_up_asset_id,
  // rental_chains.asset_id. jobs.pick_up_asset_id has NO DB FK (verified
  // against prod), so the app-layer count is the only protection for
  // that column — the FK `ON DELETE NO ACTION` safety net covers the
  // other three.
  //
  // Race: the ref-count check and the DELETE are not atomic; a
  // concurrent INSERT could slip a reference in between. The 23503
  // translator below catches the FK case; pick_up_asset_id writes that
  // race in would orphan (acceptable — column is dead schema per
  // driver.controller.ts:89).
  async hardDelete(tenantId: string, assetId: string): Promise<void> {
    const asset = await this.assetsRepository.findOne({
      where: { id: assetId, tenant_id: tenantId },
    });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    const [jobAssetRefs, jobDropOffRefs, jobPickUpRefs, chainRefs] =
      await Promise.all([
        this.jobsRepository.count({
          where: { tenant_id: tenantId, asset_id: assetId },
        }),
        this.jobsRepository.count({
          where: { tenant_id: tenantId, drop_off_asset_id: assetId },
        }),
        this.jobsRepository.count({
          where: { tenant_id: tenantId, pick_up_asset_id: assetId },
        }),
        this.rentalChainsRepository.count({
          where: { tenant_id: tenantId, asset_id: assetId },
        }),
      ]);
    const jobRefs = jobAssetRefs + jobDropOffRefs + jobPickUpRefs;
    const totalRefs = jobRefs + chainRefs;
    if (totalRefs > 0) {
      throw new ConflictException({
        error: 'asset_has_references',
        message: `This asset has ${totalRefs} historical reference(s) and cannot be permanently deleted. Retire it instead.`,
        references: { jobs: jobRefs, rental_chains: chainRefs },
      });
    }

    try {
      await this.assetsRepository.delete({ id: assetId, tenant_id: tenantId });
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const driverError = (err as any).driverError;
        if (driverError?.code === '23503') {
          throw new ConflictException({
            error: 'asset_has_references',
            message:
              'This asset was referenced by another operation before deletion completed. Retire it instead.',
          });
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
        excluded: ['reserved', 'deployed', 'on_site', 'in_transit', 'full_staged', 'maintenance', 'retired'],
      })
      .andWhere('a.needs_dump = false')
      // "Not referenced by any active job" — derived from the authoritative
      // jobs table. Supported by partial index idx_jobs_tenant_asset_id_active
      // and idx_jobs_tenant_drop_off_asset_id_active. Replaces the former
      // denormalized `a.current_job_id IS NULL` check (Item 5 — that column
      // drifted in prod and produced silent miscounts).
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM jobs j
          WHERE (j.asset_id = a.id OR j.drop_off_asset_id = a.id)
            AND j.tenant_id = a.tenant_id
            AND j.status NOT IN (:...terminalActive)
        )`,
        { terminalActive: [...TERMINAL_JOB_STATUSES] },
      )
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
      // Defensive: retired assets should never be awaiting a dump, but
      // filter explicitly so a stale full_staged flag on a retired row
      // can't leak into the yard's dump-run list.
      .andWhere('a.status != :retiredStatus', { retiredStatus: 'retired' })
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
   *                            AND NOT EXISTS (active job referencing asset))
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
    // Retired assets are excluded unconditionally — they do not
    // contribute to yard capacity, projections, or dispatch decisions.
    const assets = await this.assetsRepository.find({
      where: { tenant_id: tenantId, subtype, status: Not('retired') },
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
    // filter used by `findAvailable` above.
    //
    // "Not referenced by any active job" is derived from the jobs
    // table (Item 5 — the former denormalized `current_job_id` column
    // drifted in prod). Scope the active-refs fetch to this subtype
    // via an inner join against assets so we don't pull refs for
    // subtypes we aren't projecting.
    const activeRefIds = new Set(
      (
        await this.jobsRepository
          .createQueryBuilder('j')
          .select([
            'j.asset_id AS asset_id',
            'j.drop_off_asset_id AS drop_off_asset_id',
          ])
          .innerJoin(
            'assets',
            'ref_a',
            '(ref_a.id = j.asset_id OR ref_a.id = j.drop_off_asset_id) AND ref_a.tenant_id = j.tenant_id AND ref_a.subtype = :subtype',
            { subtype },
          )
          .where('j.tenant_id = :tenantId', { tenantId })
          .andWhere('j.status NOT IN (:...terminalActive)', {
            terminalActive: [...TERMINAL_JOB_STATUSES],
          })
          .getRawMany<{
            asset_id: string | null;
            drop_off_asset_id: string | null;
          }>()
      )
        .flatMap((r) => [r.asset_id, r.drop_off_asset_id])
        .filter((x): x is string => !!x),
    );
    const availableNow = assets.filter(
      (a) =>
        a.status === 'available' &&
        !a.needs_dump &&
        !activeRefIds.has(a.id),
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
