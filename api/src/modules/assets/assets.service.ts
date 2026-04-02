import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Asset } from './entities/asset.entity';
import { Job } from '../jobs/entities/job.entity';
import {
  CreateAssetDto,
  UpdateAssetDto,
  ListAssetsQueryDto,
} from './dto/asset.dto';

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private assetsRepository: Repository<Asset>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
  ) {}

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
      weight_capacity: dto.weightCapacity,
      daily_rate: dto.dailyRate,
      notes: dto.notes,
      metadata: dto.metadata,
    });
    return this.assetsRepository.save(asset);
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
    if (dto.weightCapacity !== undefined)
      asset.weight_capacity = dto.weightCapacity;
    if (dto.dailyRate !== undefined) asset.daily_rate = dto.dailyRate;
    if (dto.notes !== undefined) asset.notes = dto.notes;
    if (dto.metadata !== undefined) asset.metadata = dto.metadata;

    return this.assetsRepository.save(asset);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const asset = await this.findOne(tenantId, id);
    await this.assetsRepository.remove(asset);
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

  async getAvailability(
    tenantId: string,
    subtype: string,
    date?: string,
  ) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];

    // Count assets by status
    const assets = await this.assetsRepository.find({
      where: { tenant_id: tenantId, subtype },
    });

    const total = assets.length;
    const deployed = assets.filter((a) => a.status === 'on_site' || a.status === 'deployed').length;
    const reserved = assets.filter((a) => a.status === 'reserved').length;
    const inTransit = assets.filter((a) => a.status === 'in_transit').length;
    const maintenance = assets.filter((a) => a.status === 'maintenance').length;
    const availableNow = assets.filter((a) => a.status === 'available').length;

    // Count pickup jobs scheduled between now and target date
    let pickupsBeforeDate = 0;
    if (targetDate > todayStr) {
      const pickups = await this.jobsRepository
        .createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.job_type = :type', { type: 'pickup' })
        .andWhere('j.status NOT IN (:...excluded)', { excluded: ['completed', 'cancelled'] })
        .andWhere('j.scheduled_date >= :today', { today: todayStr })
        .andWhere('j.scheduled_date <= :target', { target: targetDate })
        .getCount();
      pickupsBeforeDate = pickups;
    }

    // Count delivery/exchange jobs booked for dates between now and target
    let reservedForDate = 0;
    if (targetDate > todayStr) {
      const futureBookings = await this.jobsRepository
        .createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.job_type IN (:...types)', { types: ['delivery', 'exchange'] })
        .andWhere('j.status NOT IN (:...excluded)', { excluded: ['completed', 'cancelled'] })
        .andWhere('j.scheduled_date > :today', { today: todayStr })
        .andWhere('j.scheduled_date <= :target', { target: targetDate })
        .getCount();
      reservedForDate = futureBookings;
    }

    const availableOnDate = Math.max(0, availableNow + pickupsBeforeDate - reservedForDate);

    return {
      subtype,
      date: targetDate,
      total,
      deployed,
      reserved,
      inTransit,
      maintenance,
      availableNow,
      pickupsBeforeDate,
      reservedForDate,
      availableOnDate,
    };
  }
}
