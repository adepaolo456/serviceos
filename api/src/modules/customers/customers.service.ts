import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  ListCustomersQueryDto,
} from './dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
  ) {}

  private generateAccountId(): string {
    const r = () => Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const p = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `${p}-${r()}-${r()}`;
  }

  async create(tenantId: string, dto: CreateCustomerDto): Promise<Customer> {
    const customer = this.customersRepository.create({
      tenant_id: tenantId,
      account_id: this.generateAccountId(),
      type: dto.type ?? 'residential',
      company_name: dto.companyName,
      first_name: dto.firstName,
      last_name: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      billing_address: dto.billingAddress,
      service_addresses: dto.serviceAddresses,
      notes: dto.notes,
      tags: dto.tags,
      lead_source: dto.leadSource,
    });
    return this.customersRepository.save(customer);
  }

  async findAll(tenantId: string, query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.customersRepository
      .createQueryBuilder('c')
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

    qb.orderBy('c.created_at', 'DESC').skip(skip).take(limit);

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

  async findOne(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.customersRepository.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
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
      customer.billing_address = dto.billingAddress;
    if (dto.serviceAddresses !== undefined)
      customer.service_addresses = dto.serviceAddresses;
    if (dto.notes !== undefined) customer.notes = dto.notes;
    if (dto.tags !== undefined) customer.tags = dto.tags;
    if (dto.leadSource !== undefined) customer.lead_source = dto.leadSource;
    if (dto.pricingTier !== undefined) customer.pricing_tier = dto.pricingTier;
    if (dto.discountPercentage !== undefined) customer.discount_percentage = dto.discountPercentage;
    if (dto.exemptExtraDayCharges !== undefined) customer.exempt_extra_day_charges = dto.exemptExtraDayCharges;
    if (dto.customPricing !== undefined) customer.custom_pricing = dto.customPricing;
    if (dto.pricingNotes !== undefined) customer.pricing_notes = dto.pricingNotes;

    return this.customersRepository.save(customer);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const customer = await this.findOne(tenantId, id);
    await this.customersRepository.remove(customer);
  }
}
