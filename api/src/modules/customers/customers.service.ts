import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository, SelectQueryBuilder } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { REVENUE_STATUSES } from '../../common/constants/revenue-statuses';
import { Invoice } from '../billing/entities/invoice.entity';
import { MapboxService } from '../mapbox/mapbox.service';
import {
  hasValidServiceCoordinates,
  buildAddressString,
  isValidCoordinatePair,
} from '../../common/helpers/coordinate-validator';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  ListCustomersQueryDto,
} from './dto/customer.dto';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    private mapboxService: MapboxService,
  ) {}

  private generateAccountId(): string {
    const r = () => Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const p = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `${p}-${r()}-${r()}`;
  }

  async create(tenantId: string, dto: CreateCustomerDto): Promise<Customer> {
    // Soft geocode billing address and service sites before saving
    const billingAddress = await this.mapboxService.softGeocodeAndMerge(dto.billingAddress as Record<string, any> | undefined);
    const serviceAddresses = await this.mapboxService.softGeocodeAndMergeList(dto.serviceAddresses as Record<string, any>[] | undefined);

    const customer = this.customersRepository.create({
      tenant_id: tenantId,
      account_id: this.generateAccountId(),
      type: dto.type ?? 'residential',
      company_name: dto.companyName,
      first_name: dto.firstName,
      last_name: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      billing_address: billingAddress,
      service_addresses: serviceAddresses,
      notes: dto.notes,
      driver_instructions: dto.driverInstructions ?? null,
      tags: dto.tags,
      lead_source: dto.leadSource,
    });
    try {
      return await this.customersRepository.save(customer);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const driverError = (err as any).driverError;
        const code = driverError?.code;
        const constraint = driverError?.constraint || '';
        const detail = driverError?.detail || '';
        const message = err.message || '';

        if (
          code === '23505' &&
          (
            constraint === 'idx_customers_tenant_email_unique' ||
            detail.includes('idx_customers_tenant_email_unique') ||
            message.includes('idx_customers_tenant_email_unique')
          )
        ) {
          throw new ConflictException(
            'A customer with this email already exists for this tenant.'
          );
        }
      }
      throw err;
    }
  }

  // Live-compute rollups for total_jobs and lifetime_revenue. The stored
  // `customers.total_jobs` and `customers.lifetime_revenue` columns are
  // denormalized and are not maintained by any service write path
  // (verified by audit). Rather than trying to maintain them correctly
  // across every job/invoice write site, we compute on read from the
  // authoritative tables.
  //
  // Shared semantics with reporting.service.ts via REVENUE_STATUSES —
  // both surfaces MUST agree on what counts as booked revenue. If they
  // drift, the /customers page and the reporting "top customers" widget
  // will report different numbers for the same customer.
  //
  // Tenant scoping is hard-required — every subquery filters by both
  // customer_id AND tenant_id. customer_id alone would be a cross-tenant
  // leak vector.
  private applyRollupSelects(
    qb: SelectQueryBuilder<Customer>,
  ): SelectQueryBuilder<Customer> {
    return qb
      .addSelect(
        `(SELECT COUNT(*)::int FROM jobs j
          WHERE j.customer_id = c.id
            AND j.tenant_id = c.tenant_id)`,
        'rollup_total_jobs',
      )
      .addSelect(
        `(SELECT COALESCE(SUM(i.total), 0) FROM invoices i
          WHERE i.customer_id = c.id
            AND i.tenant_id = c.tenant_id
            AND i.status = ANY(:revenueStatuses))`,
        'rollup_lifetime_revenue',
      )
      .setParameter('revenueStatuses', [...REVENUE_STATUSES]);
  }

  async findAll(tenantId: string, query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.customersRepository
      .createQueryBuilder('c')
      // Layer 3 — load portal_password_hash (select:false on the entity)
      // solely to compute the derived has_portal_access boolean below.
      // The hash itself is stripped from the response via destructure-
      // and-omit before returning — never emitted over the wire.
      .addSelect('c.portal_password_hash')
      .where('c.tenant_id = :tenantId', { tenantId });

    if (query.type) {
      qb.andWhere('c.type = :type', { type: query.type });
    }

    if (query.search) {
      qb.andWhere(
        `(
          c.first_name ILIKE :search OR
          c.last_name ILIKE :search OR
          c.email ILIKE :search OR
          c.phone ILIKE :search OR
          c.company_name ILIKE :search
        )`,
        { search: `%${query.search}%` },
      );
    }

    // Count comes from a clone of the filtered QB — getRawAndEntities()
    // has no `...AndCount` variant. Clone BEFORE the rollup addSelects,
    // pagination, and ordering so the count query stays cheap.
    const total = await qb.clone().getCount();

    this.applyRollupSelects(qb);
    qb.orderBy('c.created_at', 'DESC').skip(skip).take(limit);

    const { entities, raw } = await qb.getRawAndEntities();

    // Destructure-and-omit: pulls portal_password_hash out of each row
    // so it cannot accidentally leak via spread, and replaces it with
    // the derived has_portal_access boolean. Consumers that don't know
    // about the new field simply ignore it (additive change).
    //
    // Rollups are merged per row from the raw result:
    // - rollup_total_jobs comes back as string from the raw query;
    //   explicit Number() preserves integer shape (frontend sorts on it).
    // - rollup_lifetime_revenue comes back as a decimal string from pg;
    //   leave as-is to match the existing decimal-string response shape
    //   (frontend already uses Number(c.lifetime_revenue) to parse).
    const data = entities.map((entity, idx) => {
      const { portal_password_hash, ...rest } = entity;
      return {
        ...rest,
        total_jobs: Number(raw[idx].rollup_total_jobs),
        lifetime_revenue: raw[idx].rollup_lifetime_revenue,
        has_portal_access: !!portal_password_hash,
      };
    });

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

  async search(tenantId: string, q: string, limit: number = 5) {
    if (!q || q.trim().length === 0) {
      return [];
    }

    const qb = this.customersRepository
      .createQueryBuilder('c')
      .select([
        'c.id',
        'c.account_id',
        'c.first_name',
        'c.last_name',
        'c.company_name',
        'c.type',
        'c.email',
        'c.phone',
        'c.billing_address',
        'c.service_addresses',
      ])
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere(
        `(
          c.first_name ILIKE :search OR
          c.last_name ILIKE :search OR
          c.company_name ILIKE :search
        )`,
        { search: `%${q.trim()}%` },
      )
      .orderBy('c.last_name', 'ASC')
      .addOrderBy('c.first_name', 'ASC')
      .take(limit);

    return qb.getMany();
  }

  async findOne(tenantId: string, id: string): Promise<Customer> {
    // QueryBuilder variant so we can attach the rollup addSelects that
    // override stored total_jobs / lifetime_revenue with live-computed
    // values. Same semantics as findAll — deliberately so the list and
    // detail surfaces never disagree on counts/revenue.
    const qb = this.customersRepository
      .createQueryBuilder('c')
      .where('c.id = :id', { id })
      .andWhere('c.tenant_id = :tenantId', { tenantId });

    this.applyRollupSelects(qb);

    const { entities, raw } = await qb.getRawAndEntities();
    const customer = entities[0];
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    // Phase B — the stored `customers.total_jobs` and
    // `customers.lifetime_revenue` columns were dropped after Phase A
    // soak proved live-compute was stable. Since those fields no
    // longer exist on the Customer entity, we return a spread object
    // (same pattern findAll uses per row) and cast to Customer so the
    // function signature is preserved. The response body shape is
    // unchanged — API consumers still see total_jobs (integer) and
    // lifetime_revenue (decimal string) on the JSON payload, now
    // derived 100% from live query rather than stored + override.
    return {
      ...customer,
      total_jobs: Number(raw[0].rollup_total_jobs),
      lifetime_revenue: raw[0].rollup_lifetime_revenue,
    } as Customer;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);

    if (dto.type !== undefined) customer.type = dto.type;
    if (dto.companyName !== undefined) customer.company_name = dto.companyName;
    if (dto.firstName !== undefined) customer.first_name = dto.firstName;
    if (dto.lastName !== undefined) customer.last_name = dto.lastName;
    if (dto.email !== undefined) customer.email = dto.email;
    if (dto.phone !== undefined) customer.phone = dto.phone;
    if (dto.billingAddress !== undefined)
      customer.billing_address = await this.mapboxService.softGeocodeAndMerge(dto.billingAddress as Record<string, any> | undefined) as Record<string, any>;
    if (dto.serviceAddresses !== undefined)
      customer.service_addresses = await this.mapboxService.softGeocodeAndMergeList(dto.serviceAddresses as Record<string, any>[] | undefined) as Record<string, any>[];
    if (dto.notes !== undefined) customer.notes = dto.notes;
    if (dto.driverInstructions !== undefined)
      customer.driver_instructions = dto.driverInstructions;
    if (dto.tags !== undefined) customer.tags = dto.tags;
    if (dto.leadSource !== undefined) customer.lead_source = dto.leadSource;
    if (dto.pricingTier !== undefined) customer.pricing_tier = dto.pricingTier;
    if (dto.discountPercentage !== undefined) customer.discount_percentage = dto.discountPercentage;
    if (dto.exemptExtraDayCharges !== undefined) customer.exempt_extra_day_charges = dto.exemptExtraDayCharges;
    if (dto.customPricing !== undefined) customer.custom_pricing = dto.customPricing;
    if (dto.pricingNotes !== undefined) customer.pricing_notes = dto.pricingNotes;

    try {
      return await this.customersRepository.save(customer);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const driverError = (err as QueryFailedError & {
          driverError?: { code?: string; constraint?: string; detail?: string; message?: string };
        }).driverError;
        const targetConstraint = 'idx_customers_tenant_email_unique';
        const matchesConstraint =
          driverError?.constraint === targetConstraint ||
          !!driverError?.detail?.includes(targetConstraint) ||
          !!driverError?.message?.includes(targetConstraint);
        if (driverError?.code === '23505' && matchesConstraint) {
          throw new ConflictException(
            'This email is already in use by another customer in your account. Please use a different email.',
          );
        }
      }
      throw err;
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const customer = await this.findOne(tenantId, id);

    try {
      await this.customersRepository.remove(customer);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const driverError = (err as any).driverError;
        const code = driverError?.code;
        const constraint = driverError?.constraint || '';
        const detail = driverError?.detail || '';
        const message = err.message || '';

        if (code === '23503') {
          // associated jobs
          if (
            constraint === 'FK_61855f3e378cc40ce4144d045b5' ||
            detail.includes('FK_61855f3e378cc40ce4144d045b5') ||
            message.includes('FK_61855f3e378cc40ce4144d045b5')
          ) {
            throw new ConflictException(
              'Cannot delete this customer — they have associated jobs. Resolve or reassign them first.'
            );
          }

          // associated invoices
          if (
            constraint === 'FK_65e3145f317bd655481d3f96c74' ||
            detail.includes('FK_65e3145f317bd655481d3f96c74') ||
            message.includes('FK_65e3145f317bd655481d3f96c74')
          ) {
            throw new ConflictException(
              'Cannot delete this customer — they have associated invoices. Resolve or reassign them first.'
            );
          }

          // associated credit memos
          if (
            constraint === 'FK_36ecace98d90a4d3eadc11b00bc' ||
            detail.includes('FK_36ecace98d90a4d3eadc11b00bc') ||
            message.includes('FK_36ecace98d90a4d3eadc11b00bc')
          ) {
            throw new ConflictException(
              'Cannot delete this customer — they have associated credit memos. Resolve them first.'
            );
          }

          // associated rental chains
          if (
            constraint === 'FK_4bb01524546f83a6f47ac24a775' ||
            detail.includes('FK_4bb01524546f83a6f47ac24a775') ||
            message.includes('FK_4bb01524546f83a6f47ac24a775')
          ) {
            throw new ConflictException(
              'Cannot delete this customer — they have associated rental chains. Resolve or reassign them first.'
            );
          }

          // notification history (two FKs grouped)
          if (
            constraint === 'FK_b55350bc786b052e8523f313b9a' ||
            constraint === 'FK_81f3d5b9d93fa0823bbddaa8b9c' ||
            detail.includes('FK_b55350bc786b052e8523f313b9a') ||
            detail.includes('FK_81f3d5b9d93fa0823bbddaa8b9c') ||
            message.includes('FK_b55350bc786b052e8523f313b9a') ||
            message.includes('FK_81f3d5b9d93fa0823bbddaa8b9c')
          ) {
            throw new ConflictException(
              'Cannot delete this customer — they have notification history on record.'
            );
          }

          // configured overrides (three FKs grouped)
          if (
            constraint === 'FK_5885eeae184b2a384c06a1c022e' ||
            constraint === 'FK_1356177a6ba6f83b6d48f30c18f' ||
            constraint === 'FK_31330554bb861090485fd2672fc' ||
            detail.includes('FK_5885eeae184b2a384c06a1c022e') ||
            detail.includes('FK_1356177a6ba6f83b6d48f30c18f') ||
            detail.includes('FK_31330554bb861090485fd2672fc') ||
            message.includes('FK_5885eeae184b2a384c06a1c022e') ||
            message.includes('FK_1356177a6ba6f83b6d48f30c18f') ||
            message.includes('FK_31330554bb861090485fd2672fc')
          ) {
            throw new ConflictException(
              'Cannot delete this customer — they have configured pricing or notification overrides. Remove those first.'
            );
          }

          // associated customer notes
          if (
            constraint === 'fk_customer_notes_customer_id' ||
            detail.includes('fk_customer_notes_customer_id') ||
            message.includes('fk_customer_notes_customer_id')
          ) {
            throw new ConflictException(
              'Cannot delete this customer — they have notes on record. Remove those first.'
            );
          }

          // Fallback for any unknown FK constraint on customers
          throw new ConflictException(
            'Cannot delete this customer — they have related records. Resolve them first.'
          );
        }
      }
      throw err;
    }
  }

  async getCustomerBalance(tenantId: string, customerId: string) {
    const result = await this.invoiceRepository
      .createQueryBuilder('i')
      .select('COALESCE(SUM(i.balance_due), 0)', 'balance')
      .addSelect('COUNT(*)::int', 'unpaid_count')
      .where('i.customer_id = :customerId', { customerId })
      .andWhere('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.status NOT IN (:...excluded)', { excluded: ['voided', 'draft'] })
      .andWhere('i.balance_due > 0')
      .getRawOne();

    return {
      balance: Number(result?.balance ?? 0),
      unpaid_count: Number(result?.unpaid_count ?? 0),
    };
  }

}
