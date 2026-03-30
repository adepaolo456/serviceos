import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
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
import { TenantId } from '../../common/decorators';

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
  ) {
    return this.jobsService.changeStatus(tenantId, id, dto);
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
}
