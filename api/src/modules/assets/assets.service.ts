import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from './entities/asset.entity';
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
    return this.assetsRepository.find({
      where: {
        tenant_id: tenantId,
        asset_type: assetType,
        status: 'available',
      },
      order: { created_at: 'DESC' },
    });
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
}
