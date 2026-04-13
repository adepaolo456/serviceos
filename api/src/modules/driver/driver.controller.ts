import { Controller, Get, Patch, Param, Body, Query, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentUser, TenantId } from '../../common/decorators';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { JobsService } from '../jobs/jobs.service';

@ApiTags('Driver')
@ApiBearerAuth()
@Controller('driver')
export class DriverController {
  constructor(
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    private jobsService: JobsService,
  ) {}

  @Get('today')
  @ApiOperation({ summary: 'Get today\'s jobs for the authenticated driver' })
  async getToday(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    const today = new Date().toISOString().split('T')[0];
    return this.jobRepo.createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'c')
      .leftJoinAndSelect('j.asset', 'a')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.assigned_driver_id = :userId', { userId })
      .andWhere('j.scheduled_date = :today', { today })
      .orderBy('j.route_order', 'ASC', 'NULLS LAST')
      .addOrderBy('j.scheduled_window_start', 'ASC', 'NULLS LAST')
      .getMany();
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Get all jobs for the authenticated driver' })
  async getJobs(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const qb = this.jobRepo.createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'c')
      .leftJoinAndSelect('j.asset', 'a')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.assigned_driver_id = :userId', { userId });

    if (status) qb.andWhere('j.status = :status', { status });
    if (dateFrom) qb.andWhere('j.scheduled_date >= :dateFrom', { dateFrom });
    if (dateTo) qb.andWhere('j.scheduled_date <= :dateTo', { dateTo });

    return qb.orderBy('j.scheduled_date', 'DESC')
      .addOrderBy('j.route_order', 'ASC', 'NULLS LAST')
      .take(50)
      .getMany();
  }

  @Patch('jobs/:id/status')
  @ApiOperation({ summary: 'Driver updates job status' })
  async updateStatus(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string; signatureUrl?: string; dropOffAssetPin?: string; pickUpAssetPin?: string; dropOffAssetId?: string; pickUpAssetId?: string; reason?: string },
  ) {
    // Verify the job is assigned to this driver
    const job = await this.jobRepo.findOne({
      where: { id, tenant_id: tenantId, assigned_driver_id: userId },
    });
    if (!job) throw new NotFoundException('Job not found or not assigned to you');

    // Driver-captured METADATA (pins and signature) are not asset
    // identity and carry no validation semantics — they continue as
    // direct writes. Asset IDENTITY (`drop_off_asset_id`) is Phase
    // 14 routed through the canonical JobsService path below so the
    // active-assignment conflict guard, `asset_change_history`
    // audit trail, tenant-scoped asset validation, and inventory
    // sync all run — closing the audit bypass flagged in the
    // asset coverage audit.
    const extras: Record<string, unknown> = {};
    if (body.dropOffAssetPin) extras.drop_off_asset_pin = body.dropOffAssetPin;
    if (body.pickUpAssetPin) extras.pick_up_asset_pin = body.pickUpAssetPin;
    if (body.signatureUrl) extras.signature_url = body.signatureUrl;
    // `pick_up_asset_id` is currently dead schema — written by
    // legacy driver-app builds but never read by business logic
    // (confirmed by the asset coverage audit). Preserved as a
    // direct write for backward compatibility so older driver
    // builds do not silently stop populating it, but NOT routed
    // through the audited path because there is no downstream
    // truth to protect today. Revisit when Phase 2 wires a reader.
    if (body.pickUpAssetId) extras.pick_up_asset_id = body.pickUpAssetId;

    if (Object.keys(extras).length > 0) {
      await this.jobRepo.update({ id, tenant_id: tenantId }, extras);
    }

    // Delegate status + drop-off asset identity to JobsService.
    // Drivers have no authority to override active-assignment
    // conflicts (`overrideAssetConflict` is deliberately NOT
    // forwarded); a conflicting drop-off assignment fails loudly
    // with a 400 the driver app can surface to the operator.
    const updated = await this.jobsService.changeStatus(
      tenantId,
      id,
      {
        status: body.status,
        cancellationReason: body.reason,
        ...(body.dropOffAssetId
          ? {
              dropOffAssetId: body.dropOffAssetId,
              assetChangeReason: 'driver_drop_off_confirmation',
            }
          : {}),
      } as any,
      'driver',
      userId,
      null,
    );

    // Log on-my-way notification when status changes to en_route
    if (body.status === 'en_route' && updated.customer) {
      console.log(`[driver] On-my-way notification: ${updated.customer.first_name} ${updated.customer.last_name} — driver ${userId} en route to job ${id}`);
    }

    return updated;
  }

  @Patch('jobs/:id/photos')
  @ApiOperation({ summary: 'Add a photo to a job' })
  async addPhoto(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { photo: string; type: string },
  ) {
    const job = await this.jobRepo.findOne({
      where: { id, tenant_id: tenantId, assigned_driver_id: userId },
    });
    if (!job) throw new NotFoundException('Job not found or not assigned to you');

    const photos = Array.isArray(job.photos) ? [...job.photos] : [];
    photos.push({
      uri: body.photo.startsWith('data:') ? body.photo : `data:image/jpeg;base64,${body.photo}`,
      type: body.type || 'other',
      takenAt: new Date().toISOString(),
    });

    await this.jobRepo.update({ id, tenant_id: tenantId }, { photos });
    return { message: 'Photo added', count: photos.length };
  }

  @Patch('jobs/:id/stage-at-yard')
  @ApiOperation({ summary: 'Stage a picked-up container at the yard' })
  async stageAtYard(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { wasteType?: string; notes?: string; yardId?: string },
  ) {
    const job = await this.jobRepo.findOne({
      where: { id, tenant_id: tenantId, assigned_driver_id: userId },
      relations: ['asset'],
    });
    if (!job) throw new NotFoundException('Job not found or not assigned to you');

    // Update job
    await this.jobRepo.update(id, { dump_disposition: 'staged' });

    // Update asset if exists
    if (job.asset_id) {
      const updateData: any = {
        status: 'full_staged',
        staged_at: new Date(),
        staged_from_job_id: id,
        staged_waste_type: body.wasteType || null,
        staged_notes: body.notes || null,
        needs_dump: true,
        current_location_type: 'yard',
      };
      if (body.yardId) updateData.yard_id = body.yardId;
      await this.assetRepo.update(job.asset_id, updateData);

      // Add operational history
      const asset = await this.assetRepo.findOne({ where: { id: job.asset_id } });
      if (asset) {
        const history = Array.isArray(asset.operational_history) ? [...asset.operational_history] : [];
        history.push({
          event: 'yard_drop',
          timestamp: new Date().toISOString(),
          actor_id: userId,
          actor_role: 'driver',
          job_id: id,
          yard_id: body.yardId || undefined,
          details: { wasteType: body.wasteType, notes: body.notes },
        });
        if (history.length > 50) history.splice(0, history.length - 50);
        await this.assetRepo.update(job.asset_id, { operational_history: history } as any);
      }
    }

    return this.jobRepo.findOne({ where: { id }, relations: ['asset', 'customer'] });
  }
}
