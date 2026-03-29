import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import type { Request, Response } from 'express';
import { User } from '../auth/entities/user.entity';
import { Job } from '../jobs/entities/job.entity';
import { TimeEntry } from './time-entry.entity';

@ApiTags('Team')
@ApiBearerAuth()
@Controller('team')
export class TeamController {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(TimeEntry) private timeRepo: Repository<TimeEntry>,
    @InjectRepository(Job) private jobsRepo: Repository<Job>,
  ) {}

  @Get()
  async list(@Req() req: Request, @Query('weekOf') weekOf?: string) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    const users = await this.usersRepo.find({
      where: { tenant_id: tenantId },
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

    const hoursMap: Record<string, { totalHours: number; entries: number }> = {};
    for (const e of entries) {
      hoursMap[e.userId] = { totalHours: Number(e.totalHours) || 0, entries: Number(e.entries) };
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
    const user = await this.usersRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!user) return null;
    return {
      id: user.id, firstName: user.first_name, lastName: user.last_name,
      email: user.email, phone: user.phone, role: user.role,
      isActive: user.is_active, employeeStatus: user.employee_status,
      hireDate: user.hire_date, payRate: user.pay_rate, payType: user.pay_type,
      overtimeRate: user.overtime_rate, vehicleInfo: user.vehicle_info,
      emergencyContact: user.emergency_contact, createdAt: user.created_at,
    };
  }

  @Patch(':id')
  async updateEmployee(
    @Req() req: Request, @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    const update: Record<string, unknown> = {};
    if (body.firstName !== undefined) update.first_name = body.firstName;
    if (body.lastName !== undefined) update.last_name = body.lastName;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.role !== undefined) update.role = body.role;
    if (body.payRate !== undefined) update.pay_rate = body.payRate;
    if (body.payType !== undefined) update.pay_type = body.payType;
    if (body.overtimeRate !== undefined) update.overtime_rate = body.overtimeRate;
    if (body.hireDate !== undefined) update.hire_date = body.hireDate;
    if (body.vehicleInfo !== undefined) update.vehicle_info = body.vehicleInfo;
    if (body.emergencyContact !== undefined) update.emergency_contact = body.emergencyContact;
    if (body.isActive !== undefined) update.is_active = body.isActive;
    if (body.employeeStatus !== undefined) update.employee_status = body.employeeStatus;

    await this.usersRepo.update({ id, tenant_id: tenantId }, update);
    return this.getEmployee(req, id);
  }

  // Clock in/out
  @Post('clock-in')
  async clockIn(@Req() req: Request, @Body() body: { location?: Record<string, unknown> }) {
    const user = req.user as { tenantId: string; sub: string };
    const entry = this.timeRepo.create({
      tenant_id: user.tenantId, user_id: user.sub,
      clock_in: new Date(), clock_in_location: body.location || null,
      status: 'pending',
    });
    return this.timeRepo.save(entry);
  }

  @Post('clock-out')
  async clockOut(@Req() req: Request, @Body() body: { location?: Record<string, unknown>; breakMinutes?: number }) {
    const user = req.user as { tenantId: string; sub: string };
    const entry = await this.timeRepo.findOne({
      where: { user_id: user.sub, tenant_id: user.tenantId, clock_out: undefined as unknown as null },
      order: { clock_in: 'DESC' },
    });
    if (!entry) return { error: 'No active clock-in found' };

    const clockOut = new Date();
    const breakMin = body.breakMinutes || 0;
    const totalMs = clockOut.getTime() - new Date(entry.clock_in).getTime() - breakMin * 60000;
    const totalHours = Math.round((totalMs / 3600000) * 100) / 100;

    await this.timeRepo.update(entry.id, {
      clock_out: clockOut, clock_out_location: body.location || null,
      break_minutes: breakMin, total_hours: Math.max(0, totalHours),
    });
    return this.timeRepo.findOne({ where: { id: entry.id } });
  }

  // Timesheet
  @Get('timesheet/:userId')
  async getTimesheet(@Req() req: Request, @Param('userId') userId: string, @Query('weekOf') weekOf?: string) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    const monday = weekOf || this.getMonday(new Date());
    const sunday = this.addDays(monday, 6);

    const entries = await this.timeRepo.find({
      where: {
        tenant_id: tenantId, user_id: userId,
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
    await this.timeRepo.update(id, { status: 'approved', approved_by: user.sub });
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
      this.jobsRepo.count({ where: { tenant_id: tenantId, assigned_driver_id: userId, status: 'completed' } }),
      this.jobsRepo.createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.assigned_driver_id = :userId', { userId })
        .andWhere('j.status = :status', { status: 'completed' })
        .andWhere('j.updated_at >= :weekAgo', { weekAgo })
        .getCount(),
    ]);

    return { monthJobs, weekJobs, avgPerDay: Math.round((monthJobs / 30) * 10) / 10 };
  }

  // Payroll export
  @Get('timesheet/export/csv')
  async exportPayroll(@Req() req: Request, @Res() res: Response, @Query('weekOf') weekOf?: string) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    const monday = weekOf || this.getMonday(new Date());
    const sunday = this.addDays(monday, 6);

    const users = await this.usersRepo.find({ where: { tenant_id: tenantId, is_active: true } });
    const entries = await this.timeRepo.find({
      where: { tenant_id: tenantId, clock_in: Between(new Date(monday), new Date(sunday + 'T23:59:59')) },
    });

    const byUser: Record<string, number> = {};
    for (const e of entries) byUser[e.user_id] = (byUser[e.user_id] || 0) + Number(e.total_hours);

    let csv = 'Employee Name,Role,Pay Rate,Regular Hours,Overtime Hours,Gross Pay,Week Of\n';
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
    res.setHeader('Content-Disposition', `attachment; filename=payroll-${monday}.csv`);
    res.send(csv);
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
