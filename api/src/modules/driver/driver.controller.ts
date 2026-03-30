import { Controller, Get, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
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
    @Body() body: { status: string },
  ) {
    const job = await this.jobRepo.findOne({
      where: { id, tenant_id: tenantId, assigned_driver_id: userId },
    });
    if (!job) throw new Error('Job not found or not assigned to you');

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

    await this.jobRepo.update({ id, tenant_id: tenantId }, updates);
    return this.jobRepo.findOne({ where: { id }, relations: ['customer', 'asset'] });
  }
}
