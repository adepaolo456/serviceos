import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThan, DataSource, IsNull } from 'typeorm';
import type { Request, Response } from 'express';
import { User } from '../auth/entities/user.entity';
import { Job } from '../jobs/entities/job.entity';
import { TimeEntry } from './time-entry.entity';
import { RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { checkRateLimit } from '../../common/rate-limiter';
import { PasswordResetService } from '../auth/services/password-reset.service';
import { UsersService } from './users.service';

@ApiTags('Team')
@ApiBearerAuth()
@Controller('team')
export class TeamController {
  private readonly logger = new Logger(TeamController.name);

  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(TimeEntry) private timeRepo: Repository<TimeEntry>,
    @InjectRepository(Job) private jobsRepo: Repository<Job>,
    private readonly dataSource: DataSource,
    private readonly passwordResetService: PasswordResetService,
    private readonly usersService: UsersService,
  ) {}

  @Get('locations')
  async locations(@Req() req: Request) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const drivers = await this.usersRepo.find({
      where: {
        tenant_id: tenantId,
        role: 'driver',
        current_location_updated_at: MoreThan(tenMinAgo),
      },
    });
    return drivers.map((d) => ({
      id: d.id,
      firstName: d.first_name,
      lastName: d.last_name,
      latitude: d.current_latitude ? Number(d.current_latitude) : null,
      longitude: d.current_longitude ? Number(d.current_longitude) : null,
      updatedAt: d.current_location_updated_at,
      statusText: d.current_status_text,
    }));
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('weekOf') weekOf?: string,
    @Query('includeDeactivated') includeDeactivated?: string,
  ) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    // Default: live, active users only. `includeDeactivated=true` surfaces
    // inactive users (but still hides soft-deleted). Mirrors the Assets
    // `includeRetired` pattern at web assets page line 422.
    const showInactive = includeDeactivated === 'true';
    const where: Record<string, unknown> = {
      tenant_id: tenantId,
      deleted_at: IsNull(),
    };
    if (!showInactive) {
      where.is_active = true;
    }
    const users = await this.usersRepo.find({
      where,
      order: { role: 'ASC', first_name: 'ASC' },
    });

    // Get this week's hours
    const monday = weekOf || this.getMonday(new Date());
    const sunday = this.addDays(monday, 6);

    const entries = await this.timeRepo
      .createQueryBuilder('t')
      .select('t.user_id', 'userId')
      .addSelect('SUM(t.total_hours)', 'totalHours')
      .addSelect('COUNT(*)', 'entries')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.clock_in >= :start', { start: monday })
      .andWhere('t.clock_in <= :end', { end: sunday + 'T23:59:59' })
      .groupBy('t.user_id')
      .getRawMany();

    const hoursMap: Record<string, { totalHours: number; entries: number }> =
      {};
    for (const e of entries) {
      hoursMap[e.userId] = {
        totalHours: Number(e.totalHours) || 0,
        entries: Number(e.entries),
      };
    }

    return {
      data: users.map((u) => ({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        isActive: u.is_active,
        employeeStatus: u.employee_status || 'active',
        hireDate: u.hire_date,
        payRate: u.pay_rate,
        payType: u.pay_type,
        vehicleInfo: u.vehicle_info,
        weekHours: hoursMap[u.id]?.totalHours || 0,
        weekEntries: hoursMap[u.id]?.entries || 0,
      })),
      weekOf: monday,
    };
  }

  @Get(':id')
  async getEmployee(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    // Always exclude soft-deleted rows. A deleted user has no UI surface.
    const user = await this.usersRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!user) return null;
    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.is_active,
      employeeStatus: user.employee_status,
      hireDate: user.hire_date,
      payRate: user.pay_rate,
      payType: user.pay_type,
      overtimeRate: user.overtime_rate,
      vehicleInfo: user.vehicle_info,
      emergencyContact: user.emergency_contact,
      createdAt: user.created_at,
      driverRates: user.driver_rates,
      permissions: user.permissions,
      additionalPhones: user.additional_phones,
      additionalEmails: user.additional_emails,
      smsOptIn: user.sms_opt_in,
      address: user.address,
    };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  async updateEmployee(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const caller = req.user as { sub: string; tenantId: string; role: string };
    const tenantId = caller.tenantId;

    // Tightening #1: isActive may not flow through the generic PATCH.
    // Callers must use POST /team/:id/deactivate or /reactivate so the
    // lifecycle invariants (last-owner guard, refresh-token invalidation,
    // audit log) can't be skipped.
    if (body.isActive !== undefined) {
      throw new BadRequestException({
        error: 'is_active_via_dedicated_endpoint',
      });
    }

    // Tightening #2 + #3: role change on the Owner needs both the
    // last-owner invariant AND the "only the Owner themselves may initiate"
    // authorization, so it can't be used to bypass the transfer-ownership
    // endpoint.
    if (body.role !== undefined) {
      const target = await this.usersRepo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        select: ['id', 'role', 'is_active'],
      });
      if (!target) throw new NotFoundException({ error: 'user_not_found' });

      const targetIsOwner = target.role === 'owner' && target.is_active;
      const newRole = body.role as string;

      if (targetIsOwner && newRole !== 'owner') {
        if (caller.sub !== target.id) {
          // Per sign-off (3): only the Owner themselves may relinquish.
          throw new ForbiddenException({ error: 'cannot_modify_owner_role' });
        }
        // Even the Owner themselves can't demote themselves via PATCH —
        // that path would skip the atomic transfer. Redirect them.
        throw new BadRequestException({ error: 'ownership_transfer_required' });
      }
    }

    const update: Record<string, unknown> = {};
    if (body.firstName !== undefined) update.first_name = body.firstName;
    if (body.lastName !== undefined) update.last_name = body.lastName;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.role !== undefined) update.role = body.role;
    if (body.payRate !== undefined) update.pay_rate = body.payRate;
    if (body.payType !== undefined) update.pay_type = body.payType;
    if (body.overtimeRate !== undefined)
      update.overtime_rate = body.overtimeRate;
    if (body.hireDate !== undefined) update.hire_date = body.hireDate;
    if (body.vehicleInfo !== undefined) update.vehicle_info = body.vehicleInfo;
    if (body.emergencyContact !== undefined)
      update.emergency_contact = body.emergencyContact;
    if (body.employeeStatus !== undefined)
      update.employee_status = body.employeeStatus;
    if (body.driverRates !== undefined) update.driver_rates = body.driverRates;
    if (body.permissions !== undefined) update.permissions = body.permissions;
    if (body.additionalPhones !== undefined)
      update.additional_phones = body.additionalPhones;
    if (body.additionalEmails !== undefined)
      update.additional_emails = body.additionalEmails;
    if (body.smsOptIn !== undefined) update.sms_opt_in = body.smsOptIn;
    if (body.address !== undefined) update.address = body.address;

    const result = await this.usersRepo.update(
      { id, tenant_id: tenantId, deleted_at: IsNull() },
      update,
    );
    if (result.affected === 0) {
      throw new NotFoundException({ error: 'user_not_found' });
    }
    return this.getEmployee(req, id);
  }

  // ── Lifecycle endpoints ──────────────────────────────────────────────────
  // All four delegate to UsersService which enforces: tenant scoping,
  // last-owner invariant, audit logging, refresh-token invalidation. Route
  // guards here handle the role-level authorization (`admin` or `owner`).

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: { id: string; tenantId: string },
  ) {
    return this.usersService.deactivateUser(actor.tenantId, id, actor.id);
  }

  @Post(':id/reactivate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: { id: string; tenantId: string },
  ) {
    return this.usersService.reactivateUser(actor.tenantId, id, actor.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: { id: string; tenantId: string },
  ) {
    return this.usersService.softDeleteUser(actor.tenantId, id, actor.id);
  }

  // Ownership transfer can only be initiated by the current Owner (per
  // sign-off, authorization enforced in UsersService.transferOwnership).
  // Admin role is still required to pass RolesGuard; an admin calling it
  // for someone else's Owner account will be rejected with
  // `only_owner_can_transfer`.
  @Post(':id/transfer-ownership')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  async transferOwnership(
    @Param('id', ParseUUIDPipe) currentOwnerId: string,
    @Body() body: { newOwnerId?: string },
    @CurrentUser() actor: { id: string; tenantId: string },
  ) {
    if (!body.newOwnerId) {
      throw new BadRequestException({ error: 'new_owner_id_required' });
    }
    return this.usersService.transferOwnership(
      actor.tenantId,
      currentOwnerId,
      body.newOwnerId,
      actor.id,
    );
  }

  // Clock in/out
  @Post('clock-in')
  async clockIn(
    @Req() req: Request,
    @Body() body: { location?: Record<string, unknown> },
  ) {
    const user = req.user as { tenantId: string; sub: string };
    const entry = this.timeRepo.create({
      tenant_id: user.tenantId,
      user_id: user.sub,
      clock_in: new Date(),
      clock_in_location: body.location || null,
      status: 'pending',
    });
    return this.timeRepo.save(entry);
  }

  @Post('clock-out')
  async clockOut(
    @Req() req: Request,
    @Body() body: { location?: Record<string, unknown>; breakMinutes?: number },
  ) {
    const user = req.user as { tenantId: string; sub: string };
    const entry = await this.timeRepo.findOne({
      where: {
        user_id: user.sub,
        tenant_id: user.tenantId,
        clock_out: undefined as unknown as null,
      },
      order: { clock_in: 'DESC' },
    });
    if (!entry) return { error: 'No active clock-in found' };

    const clockOut = new Date();
    const breakMin = body.breakMinutes || 0;
    const totalMs =
      clockOut.getTime() -
      new Date(entry.clock_in).getTime() -
      breakMin * 60000;
    const totalHours = Math.round((totalMs / 3600000) * 100) / 100;

    await this.timeRepo.update(entry.id, {
      clock_out: clockOut,
      clock_out_location: body.location || null,
      break_minutes: breakMin,
      total_hours: Math.max(0, totalHours),
    });
    return this.timeRepo.findOne({ where: { id: entry.id } });
  }

  // Timesheet
  @Get('timesheet/:userId')
  async getTimesheet(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Query('weekOf') weekOf?: string,
  ) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    const monday = weekOf || this.getMonday(new Date());
    const sunday = this.addDays(monday, 6);

    const entries = await this.timeRepo.find({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        clock_in: Between(new Date(monday), new Date(sunday + 'T23:59:59')),
      },
      order: { clock_in: 'ASC' },
    });

    const totalHours = entries.reduce((s, e) => s + Number(e.total_hours), 0);
    const regularHours = Math.min(totalHours, 40);
    const overtimeHours = Math.max(0, totalHours - 40);

    return { weekOf: monday, entries, totalHours, regularHours, overtimeHours };
  }

  @Patch('timesheet/:id/approve')
  async approveEntry(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { sub: string; tenantId: string };
    await this.timeRepo.update(id, {
      status: 'approved',
      approved_by: user.sub,
    });
    return this.timeRepo.findOne({ where: { id } });
  }

  // Performance
  @Get(':id/performance')
  async getPerformance(@Req() req: Request, @Param('id') userId: string) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86400000);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    const [monthJobs, weekJobs] = await Promise.all([
      this.jobsRepo.count({
        where: {
          tenant_id: tenantId,
          assigned_driver_id: userId,
          status: 'completed',
        },
      }),
      this.jobsRepo
        .createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.assigned_driver_id = :userId', { userId })
        .andWhere('j.status = :status', { status: 'completed' })
        .andWhere('j.updated_at >= :weekAgo', { weekAgo })
        .getCount(),
    ]);

    return {
      monthJobs,
      weekJobs,
      avgPerDay: Math.round((monthJobs / 30) * 10) / 10,
    };
  }

  // Payroll export
  @Get('timesheet/export/csv')
  async exportPayroll(
    @Req() req: Request,
    @Res() res: Response,
    @Query('weekOf') weekOf?: string,
  ) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    const monday = weekOf || this.getMonday(new Date());
    const sunday = this.addDays(monday, 6);

    const users = await this.usersRepo.find({
      where: { tenant_id: tenantId, is_active: true },
    });
    const entries = await this.timeRepo.find({
      where: {
        tenant_id: tenantId,
        clock_in: Between(new Date(monday), new Date(sunday + 'T23:59:59')),
      },
    });

    const byUser: Record<string, number> = {};
    for (const e of entries)
      byUser[e.user_id] = (byUser[e.user_id] || 0) + Number(e.total_hours);

    let csv =
      'Employee Name,Role,Pay Rate,Regular Hours,Overtime Hours,Gross Pay,Week Of\n';
    for (const u of users) {
      const total = byUser[u.id] || 0;
      const rate = Number(u.pay_rate) || 0;
      const otRate = Number(u.overtime_rate) || rate * 1.5;
      const regular = Math.min(total, 40);
      const ot = Math.max(0, total - 40);
      const gross = Math.round((regular * rate + ot * otRate) * 100) / 100;
      csv += `"${u.first_name} ${u.last_name}","${u.role}",${rate},${regular.toFixed(2)},${ot.toFixed(2)},${gross.toFixed(2)},"${monday}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payroll-${monday}.csv`,
    );
    res.send(csv);
  }

  /**
   * Admin-triggered password reset. Mints the same token that self-serve
   * forgot-password uses, then sends the identical reset email. Admin
   * never sets a password directly — the user goes through the normal
   * redemption flow. Rate-limited per admin user (not per target) so
   * one admin can't spam multiple users' inboxes. Tenant-scoped lookup
   * prevents cross-tenant triggers.
   */
  @Post(':id/trigger-password-reset')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  async triggerPasswordReset(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentUser() adminUser: { id: string; tenantId: string },
    @Req() req: Request,
  ) {
    const limitCheck = await checkRateLimit(
      this.dataSource,
      adminUser.id,
      '/team/trigger-password-reset',
      5,
      60,
      'email',
    );
    if (!limitCheck.allowed) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'rate_limited',
          retryAfter: limitCheck.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const targetUser = await this.usersRepo.findOne({
      where: { id: userId, tenant_id: adminUser.tenantId },
      select: ['id', 'tenant_id', 'email', 'first_name', 'is_active'],
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    if (!targetUser.is_active) {
      throw new BadRequestException({ error: 'user_deactivated' });
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';

    const rawToken = await this.passwordResetService.createToken(
      targetUser,
      `admin:${adminUser.id}`,
      ip,
    );
    await this.passwordResetService.sendResetEmail(targetUser, rawToken);

    this.logger.log(
      JSON.stringify({
        event: 'audit.password_reset.admin_triggered',
        admin_user_id: adminUser.id,
        target_user_id: targetUser.id,
        tenant_id: targetUser.tenant_id,
      }),
    );

    return { ok: true };
  }

  private getMonday(d: Date): string {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
  }

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }
}
