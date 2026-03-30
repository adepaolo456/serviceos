import { Controller, Get, Patch, Param, Body, Query, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentUser, TenantId } from '../../common/decorators';
import { Job } from '../jobs/entities/job.entity';

@ApiTags('Driver')
@ApiBearerAuth()
@Controller('driver')
export class DriverController {
  constructor(
    @InjectRepository(Job) private jobRepo: Repository<Job>,
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
    @Body() body: { status: string; signatureUrl?: string; dropOffAssetPin?: string; pickUpAssetPin?: string; dropOffAssetId?: string; pickUpAssetId?: string },
  ) {
    const job = await this.jobRepo.findOne({
      where: { id, tenant_id: tenantId, assigned_driver_id: userId },
    });
    if (!job) throw new NotFoundException('Job not found or not assigned to you');

    const now = new Date();
    const updates: Record<string, unknown> = { status: body.status };

    switch (body.status) {
      case 'en_route': updates.en_route_at = now; break;
      case 'arrived': updates.arrived_at = now; break;
      case 'in_progress':
        if (!job.rental_start_date) {
          updates.rental_start_date = now.toISOString().split('T')[0];
          if (job.rental_days) {
            const end = new Date(now);
            end.setDate(end.getDate() + (job.rental_days || 7));
            updates.rental_end_date = end.toISOString().split('T')[0];
          }
        }
        break;
      case 'completed': updates.completed_at = now; break;
    }

    if (body.dropOffAssetPin) updates.drop_off_asset_pin = body.dropOffAssetPin;
    if (body.pickUpAssetPin) updates.pick_up_asset_pin = body.pickUpAssetPin;
    if (body.dropOffAssetId) updates.drop_off_asset_id = body.dropOffAssetId;
    if (body.pickUpAssetId) updates.pick_up_asset_id = body.pickUpAssetId;

    await this.jobRepo.update({ id, tenant_id: tenantId }, updates);

    // Log on-my-way notification when status changes to en_route
    if (body.status === 'en_route') {
      const jobWithCustomer = await this.jobRepo.findOne({
        where: { id },
        relations: ['customer'],
      });
      if (jobWithCustomer?.customer) {
        // In the future, send actual SMS/email here
        console.log(`[driver] On-my-way notification: ${jobWithCustomer.customer.first_name} ${jobWithCustomer.customer.last_name} — driver ${userId} en route to job ${id}`);
      }
    }

    // Handle signature on completion
    if (body.signatureUrl) {
      await this.jobRepo.update({ id, tenant_id: tenantId }, { signature_url: body.signatureUrl });
    }

    return this.jobRepo.findOne({ where: { id }, relations: ['customer', 'asset'] });
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
}
