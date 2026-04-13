import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { Job } from '../jobs/entities/job.entity';
import { Invoice } from '../billing/entities/invoice.entity';

@ApiTags('Portal Activity')
@ApiBearerAuth()
@Controller('portal-activity')
@UseGuards(RolesGuard)
@Roles('admin', 'owner', 'dispatcher')
export class PortalActivityController {
  constructor(
    @InjectRepository(Job) private readonly jobRepo: Repository<Job>,
    @InjectRepository(Invoice) private readonly invoiceRepo: Repository<Invoice>,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Portal activity summary counts for dashboard tile.' })
  async getSummary(@TenantId() tenantId: string) {
    const today = new Date().toISOString().split('T')[0];

    const rows = await this.jobRepo.query(
      `SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE j.created_at::date = $2)::int as today,
        COUNT(*) FILTER (WHERE inv.id IS NOT NULL AND inv.balance_due > 0 AND inv.status NOT IN ('paid','voided'))::int as awaiting_payment,
        COUNT(*) FILTER (WHERE inv.id IS NOT NULL AND (inv.balance_due <= 0 OR inv.status = 'paid'))::int as paid_ready,
        COUNT(*) FILTER (WHERE inv.id IS NULL)::int as no_invoice
      FROM jobs j
      LEFT JOIN invoices inv ON inv.job_id = j.id AND inv.tenant_id = j.tenant_id
      WHERE j.tenant_id = $1
        AND j.source = 'portal'
        AND j.status NOT IN ('completed', 'cancelled', 'voided')`,
      [tenantId, today],
    );

    const r = rows[0] || {};
    return {
      total: Number(r.total ?? 0),
      today: Number(r.today ?? 0),
      awaiting_payment: Number(r.awaiting_payment ?? 0),
      paid_ready: Number(r.paid_ready ?? 0),
    };
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Portal-originated jobs list with payment status.' })
  async getJobs(
    @TenantId() tenantId: string,
    @Query() query: { filter?: string; page?: string; limit?: string },
  ) {
    const page = parseInt(query.page || '1');
    const limit = Math.min(parseInt(query.limit || '25'), 100);
    const offset = (page - 1) * limit;

    let paymentFilter = '';
    if (query.filter === 'awaiting_payment') {
      paymentFilter = "AND inv.id IS NOT NULL AND inv.balance_due > 0 AND inv.status NOT IN ('paid','voided')";
    } else if (query.filter === 'paid_ready') {
      paymentFilter = "AND (inv.id IS NULL OR inv.balance_due <= 0 OR inv.status = 'paid')";
    } else if (query.filter === 'net_terms') {
      paymentFilter = "AND c.payment_terms IS NOT NULL AND c.payment_terms NOT IN ('due_on_receipt', 'cod')";
    }

    const [rows, countResult] = await Promise.all([
      this.jobRepo.query(
        `SELECT
          j.id, j.job_number, j.job_type, j.status, j.asset_subtype,
          j.scheduled_date, j.rental_days, j.total_price, j.created_at,
          j.service_address,
          j.rescheduled_by_customer, j.rescheduled_at,
          j.rescheduled_from_date, j.rescheduled_reason,
          c.id as customer_id, c.first_name, c.last_name, c.payment_terms,
          inv.id as invoice_id, inv.balance_due, inv.status as invoice_status
        FROM jobs j
        LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
        LEFT JOIN invoices inv ON inv.job_id = j.id AND inv.tenant_id = j.tenant_id
        WHERE j.tenant_id = $1
          AND j.source = 'portal'
          AND j.status NOT IN ('completed', 'cancelled', 'voided')
          ${paymentFilter}
        ORDER BY j.created_at DESC
        LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset],
      ),
      this.jobRepo.query(
        `SELECT COUNT(*)::int as total
        FROM jobs j
        LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
        LEFT JOIN invoices inv ON inv.job_id = j.id AND inv.tenant_id = j.tenant_id
        WHERE j.tenant_id = $1
          AND j.source = 'portal'
          AND j.status NOT IN ('completed', 'cancelled', 'voided')
          ${paymentFilter}`,
        [tenantId],
      ),
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    const data = rows.map((r: any) => {
      const hasInvoice = !!r.invoice_id;
      const isPaid = hasInvoice && (Number(r.balance_due) <= 0 || r.invoice_status === 'paid');
      const isNetTerms = r.payment_terms && !['due_on_receipt', 'cod'].includes(r.payment_terms);

      return {
        id: r.id,
        job_number: r.job_number,
        job_type: r.job_type,
        status: r.status,
        asset_subtype: r.asset_subtype,
        scheduled_date: r.scheduled_date,
        total_price: Number(r.total_price ?? 0),
        created_at: r.created_at,
        customer_id: r.customer_id,
        customer_name: r.first_name && r.last_name ? `${r.first_name} ${r.last_name}` : null,
        payment_status: isPaid ? 'paid' : hasInvoice ? 'awaiting_payment' : 'no_invoice',
        is_net_terms: isNetTerms,
        balance_due: Number(r.balance_due ?? 0),
        // Phase B4 — reschedule trio surfaced so the portal
        // activity page (and any consumer of this endpoint) can
        // see that a customer moved a date. Additive — existing
        // consumers that don't read these fields are unaffected.
        rescheduled_by_customer: !!r.rescheduled_by_customer,
        rescheduled_at: r.rescheduled_at,
        rescheduled_from_date: r.rescheduled_from_date,
        rescheduled_reason: r.rescheduled_reason,
      };
    });

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}
