import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import {
  CreateJobDto,
  UpdateJobDto,
  ListJobsQueryDto,
  ChangeStatusDto,
  CalendarQueryDto,
  UpdateJobAssetDto,
} from './dto/job.dto';
// `import type` because UpdateScheduledDateDto is a plain
// interface (no class-validator decorators). With NestJS +
// isolatedModules + emitDecoratorMetadata, a runtime import of
// a type-only symbol trips TS1272 on the @Body() decorator's
// metadata emission.
import type { UpdateScheduledDateDto } from './dto/update-scheduled-date.dto';
import { CancelWithFinancialsDto } from './dto/cancel-with-financials.dto';
import { TenantId, CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import {
  DispatchCreditEnforcementService,
  type DispatchAction,
} from '../dispatch/dispatch-credit-enforcement.service';

@ApiTags('Jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly dispatchCreditEnforcement: DispatchCreditEnforcementService,
  ) {}

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

  @Get('active-onsite')
  @ApiOperation({ summary: 'Get active on-site dumpsters for a customer at a site' })
  getActiveOnsite(
    @TenantId() tenantId: string,
    @Query('customerId') customerId: string,
    @Query('street') street?: string,
    @Query('city') city?: string,
    @Query('state') state?: string,
    @Query('zip') zip?: string,
  ) {
    const address = street && city && state
      ? { street, city, state, zip }
      : undefined;
    return this.jobsService.getActiveOnsite(tenantId, customerId, address);
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

  @Get(':id/cascade-preview')
  @ApiOperation({ summary: 'Preview what would be affected if this task were deleted' })
  getCascadePreview(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.jobsService.getCascadePreview(tenantId, id);
  }

  // Static PATCH routes MUST come before :id parameterized routes
  @Patch('bulk-reorder')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner', 'dispatcher')
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

  /**
   * Phase 15 — Connected Job Lifecycle (read-only).
   *
   * Returns the full rental-chain context for this job: chain
   * summary, all sibling jobs ordered by scheduled_date ASC, and
   * active alerts (chain-level + per-job) inlined. Consumed
   * exclusively by the Job Detail page's Connected Job Lifecycle
   * panel. Kept as a dedicated endpoint (rather than inlining on
   * GET /jobs/:id) so the base job fetch stays lean — spec rule:
   * "NOT bloat the base job detail fetch".
   */
  @Get(':id/lifecycle-context')
  @ApiOperation({ summary: 'Get the full rental chain lifecycle context for a job (Phase 15)' })
  getLifecycleContext(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.jobsService.getLifecycleContext(tenantId, id);
  }

  /**
   * Cancellation Orchestrator Phase 1 — read-only impact preview.
   *
   * Returns the lifecycle + billing context that a future UI layer
   * (confirmation modals, bulk-cancel warnings) would use to tell
   * the operator exactly what a cancellation will affect before
   * they commit. Strictly read-only: no mutations, no notifications,
   * no audit rows.
   *
   * Authorization mirrors the actual cancellation path
   * (`PATCH :id/status`), which is unguarded beyond the base auth
   * middleware — any authenticated tenant user can change a job's
   * status, so the preview is correspondingly open. Tenant scoping
   * lives on every underlying query via @TenantId().
   */
  @Get(':id/cancellation-context')
  @ApiOperation({
    summary:
      'Preview the lifecycle + billing impact of cancelling a job (read-only, no mutations)',
  })
  getCancellationContext(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.jobsService.getCancellationContext(tenantId, id);
  }

  /**
   * Phase 16.1 — edit a delivery, pickup, or exchange job's
   * scheduled date from the Connected Job Lifecycle panel.
   * Single consolidated endpoint that replaces Phase 16's
   * pickup-only PUT /jobs/:id/pickup-date.
   *
   * The handler branches on `job.job_type` after loading the
   * job:
   *   - delivery → updates chain.drop_off_date + chain rental_days
   *   - pickup   → updates chain.expected_pickup_date + chain rental_days
   *   - exchange → job-only write (no chain mutation)
   *
   * All three branches write the reschedule audit trio on the
   * job (rescheduled_at / from_date / reason / by_customer=false)
   * to encode the "Manual Override" state on existing fields.
   * See JobsService.updateScheduledDate for full rules.
   *
   * RBAC: dispatcher+ (route-level). Tenant-scoped via the
   * global JwtAuthGuard + @TenantId().
   */
  @Put(':id/scheduled-date')
  @UseGuards(RolesGuard)
  @Roles('dispatcher')
  @ApiOperation({ summary: 'Update a delivery/pickup/exchange job\'s scheduled date and sync the chain (Phase 16.1)' })
  updateScheduledDate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body: UpdateScheduledDateDto,
  ) {
    // Phase B1 — actor is now structured so updateScheduledDate can
    // distinguish operator edits from customer portal edits. This
    // call preserves exact Phase 16.1 behavior (operator type +
    // canonical reason string).
    return this.jobsService.updateScheduledDate(tenantId, id, body, {
      type: 'operator',
      userId,
      reason: 'operator_override_lifecycle_panel',
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a job' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    // Phase B9 — dispatch enforcement is applied inside
    // `JobsService.update` whenever this PATCH includes a non-null
    // `assignedDriverId`. The generic update endpoint does NOT
    // support `creditOverride` (dispatch board uses `/assign` for
    // overrides); pass null so prepay blocks bubble up as 403.
    return this.jobsService.update(tenantId, id, dto, {
      userId,
      userRole,
      creditOverride: null,
    });
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change job status' })
  async changeStatus(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto & { creditOverride?: { reason?: string } },
    @CurrentUser('role') userRole: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
  ) {
    // Phase 5 — dispatch credit enforcement for status transitions.
    // Phase B9 — 'dispatched' added as a belt-and-suspenders entry so a
    // direct single-job transition to 'dispatched' via this controller
    // path also runs through the hold gate. Mapped to 'assignment' so
    // the existing tenant `block_actions.assignment` policy covers it
    // without introducing a new DispatchAction type. NOTE: this does
    // NOT close the `DispatchService.sendRoutes` path, which transitions
    // jobs directly through the service and is intentionally out of
    // scope for Phase B9.
    const ENFORCED_STATUSES: Record<string, DispatchAction> = {
      en_route: 'en_route',
      arrived: 'arrived',
      completed: 'completed',
      dispatched: 'assignment',
    };
    const action = ENFORCED_STATUSES[dto.status];
    if (action) {
      const job = await this.jobsService.findOne(tenantId, id);
      const enforcement = await this.dispatchCreditEnforcement.enforceForDispatch({
        tenantId,
        customerId: job.customer_id ?? null,
        userId,
        userRole,
        action,
        creditOverride: dto.creditOverride ?? null,
      });
      // If override was applied, write audit note to job.
      if (enforcement.overrideNote) {
        const currentNotes = job.placement_notes || '';
        const separator = currentNotes ? '\n' : '';
        await this.jobsService.updateNotes(tenantId, id, {
          placement_notes: currentNotes + separator + enforcement.overrideNote,
        });
      }
    }
    return this.jobsService.changeStatus(tenantId, id, dto, userRole, userId, userEmail);
  }

  /**
   * Arc J.1 — cancel a job with per-invoice financial decisions.
   *
   * Funnels every cancellation through a single atomic transaction:
   * job state change + per-invoice void/refund/memo/keep + audit row
   * per decision. Stripe API calls fire AFTER commit, each in its own
   * small post-commit transaction so payment-status update + result
   * audit row land atomically together.
   *
   * RBAC: owner|admin only — refund authority is restricted, dispatcher
   * cannot issue refunds. PATCH /:id/status remains the path for
   * non-financial cancellations (zero-dollar jobs, modal fallback).
   *
   * NOTE on rate limiting: standing rule § Anthony memory entry 8
   * recommends 10/hour per user on this endpoint. The codebase does
   * NOT currently have @nestjs/throttler wired (verified by grep). A
   * follow-up arc should add it; documenting here so the rate-limit
   * gap doesn't get lost.
   */
  @Post(':id/cancel-with-financials')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  @ApiOperation({
    summary:
      'Arc J.1 — cancel a job with per-invoice financial decisions (void/refund/credit/keep)',
  })
  async cancelWithFinancials(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelWithFinancialsDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @CurrentUser('email') userEmail: string,
  ) {
    return this.jobsService.cancelJobWithFinancials(
      tenantId,
      id,
      dto,
      userId,
      userRole,
      userEmail,
    );
  }

  @Patch(':id/asset')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner', 'dispatcher')
  @ApiOperation({
    summary:
      'Phase 11A — correct a job\'s asset assignment. Tenant-scoped, conflict-guarded, audited, and re-runs inventory sync when the job is already completed.',
  })
  async changeAsset(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobAssetDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
  ) {
    return this.jobsService.changeAsset(tenantId, id, dto, userId, userEmail);
  }

  @Patch(':id/assign')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner', 'dispatcher')
  @ApiOperation({ summary: 'Assign or unassign driver and/or asset' })
  async assign(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser('role') userRole: string,
    @CurrentUser('id') userId: string,
  ) {
    // Phase B9 — dispatch enforcement lives inside
    // `JobsService.assignJob` so both this endpoint and the generic
    // `PATCH /jobs/:id` update path funnel through the same gate.
    // Pass the actor context (user + optional credit override) so
    // the service can record overrides on the audit trail.
    return this.jobsService.assignJob(tenantId, id, body, {
      userId,
      userRole,
      creditOverride:
        (body.creditOverride as { reason?: string } | null) ?? null,
    });
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
  @UseGuards(RolesGuard)
  @Roles('dispatcher')
  @ApiOperation({
    summary:
      'Phase B7 — dispatcher-driven reschedule. Thin wrapper over the canonical updateScheduledDate path for chain-linked jobs; narrowed fallback for standalone jobs. Same role gate as /jobs/:id/scheduled-date.',
  })
  reschedule(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scheduledDate: string; reason?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.jobsService.rescheduleJob(tenantId, id, body, userId);
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

  @Post('exchange-from-rental')
  @ApiOperation({ summary: 'Create exchange job directly from a rental chain (standalone/legacy)' })
  exchangeFromRental(
    @TenantId() tenantId: string,
    @Body() body: { rentalChainId: string; scheduledDate: string; timeWindow?: string; newAssetSubtype?: string; exchangeFee?: number },
  ) {
    return this.jobsService.exchangeFromRental(tenantId, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  @ApiOperation({ summary: 'Cascade delete (cancel) a job with related entities' })
  async deleteJob(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body: {
      deletePickup?: boolean;
      voidInvoices?: { invoiceId: string; void: boolean }[];
      voidReason?: string;
    },
  ) {
    return this.jobsService.cascadeDelete(tenantId, id, userId, body);
  }

  @Post('dump-run')
  @ApiOperation({ summary: 'Create a dump run job for staged containers' })
  createDumpRun(
    @TenantId() tenantId: string,
    @Body() body: { assetIds: string[]; dumpLocationId?: string; scheduledDate: string; timeWindow?: string; assignedDriverId?: string; notes?: string },
  ) {
    return this.jobsService.createDumpRun(tenantId, body);
  }

  // Driver Task V1 — internal one-off operational task for a driver
  // (bring truck to repair shop, yard errand, etc). Reuses the jobs
  // table with `job_type = 'driver_task'` so the dispatch board and
  // driver route work without new scaffolding. See
  // `JobsService.createDriverTask` for scope notes.
  @Post('driver-task')
  @ApiOperation({ summary: 'Create an internal driver task (V1)' })
  createDriverTask(
    @TenantId() tenantId: string,
    @Body()
    body: {
      title: string;
      assignedDriverId?: string | null;
      scheduledDate: string;
      timeWindow?: string;
      serviceAddress?: Record<string, unknown> | null;
      notes?: string | null;
    },
  ) {
    return this.jobsService.createDriverTask(tenantId, body);
  }
}
