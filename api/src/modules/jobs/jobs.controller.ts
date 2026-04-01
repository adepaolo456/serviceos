import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import {
  CreateJobDto,
  UpdateJobDto,
  ListJobsQueryDto,
  ChangeStatusDto,
  CalendarQueryDto,
} from './dto/job.dto';
import { TenantId, CurrentUser } from '../../common/decorators';

@ApiTags('Jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new job' })
  create(@TenantId() tenantId: string, @Body() dto: CreateJobDto) {
    return this.jobsService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List jobs with filters and pagination' })
  findAll(@TenantId() tenantId: string, @Query() query: ListJobsQueryDto) {
    return this.jobsService.findAll(tenantId, query);
  }

  @Get('unassigned')
  @ApiOperation({ summary: 'Get unassigned jobs' })
  findUnassigned(@TenantId() tenantId: string) {
    return this.jobsService.findUnassigned(tenantId);
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Get jobs for calendar view by date range' })
  findByDateRange(
    @TenantId() tenantId: string,
    @Query() query: CalendarQueryDto,
  ) {
    return this.jobsService.findByDateRange(
      tenantId,
      query.date,
      query.days ?? 7,
    );
  }

  // Static PATCH routes MUST come before :id parameterized routes
  @Patch('bulk-reorder')
  @ApiOperation({ summary: 'Bulk reorder jobs within a route' })
  bulkReorder(
    @TenantId() tenantId: string,
    @Body() body: { jobIds: string[] },
  ) {
    return this.jobsService.bulkReorder(tenantId, body.jobIds);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a job by ID' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.jobsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a job' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.jobsService.update(tenantId, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change job status' })
  changeStatus(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser('role') userRole: string,
  ) {
    return this.jobsService.changeStatus(tenantId, id, dto, userRole);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Assign or unassign driver and/or asset' })
  assign(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.jobsService.assignJob(tenantId, id, body);
  }

  @Post(':id/schedule-next')
  @ApiOperation({ summary: 'Schedule follow-up task from a completed job' })
  scheduleNext(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { type: string; scheduledDate: string; timeWindow?: string; newAssetSubtype?: string },
  ) {
    return this.jobsService.scheduleNextTask(tenantId, id, body);
  }

  @Patch(':id/reschedule')
  @ApiOperation({ summary: 'Reschedule a job' })
  reschedule(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scheduledDate: string; reason?: string; source?: string; timeWindow?: string },
  ) {
    return this.jobsService.rescheduleJob(tenantId, id, body);
  }

  @Patch(':id/stage-at-yard')
  @ApiOperation({ summary: 'Stage container at yard (dispatcher)' })
  stageAtYard(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { wasteType?: string; notes?: string },
  ) {
    return this.jobsService.stageAtYard(tenantId, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete (cancel) a job' })
  async deleteJob(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const job = await this.jobsService.findOne(tenantId, id);
    if (!job) throw new NotFoundException('Job not found');
    if (['completed', 'in_progress', 'en_route', 'arrived'].includes(job.status)) {
      throw new BadRequestException('Cannot delete a job that is in progress or completed');
    }
    if (job.asset_id) {
      await this.jobsService.updateAssetStatus(job.asset_id, 'available');
    }
    await this.jobsService.softDelete(tenantId, id);
    return { message: 'Job deleted successfully' };
  }

  @Post('dump-run')
  @ApiOperation({ summary: 'Create a dump run job for staged containers' })
  createDumpRun(
    @TenantId() tenantId: string,
    @Body() body: { assetIds: string[]; dumpLocationId?: string; scheduledDate: string; timeWindow?: string; assignedDriverId?: string; notes?: string },
  ) {
    return this.jobsService.createDumpRun(tenantId, body);
  }
}
