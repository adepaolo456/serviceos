import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingIssue } from '../entities/billing-issue.entity';
import { Invoice } from '../entities/invoice.entity';
import { Job } from '../../jobs/entities/job.entity';
import {
  CLOSED_INVOICE_STATUSES,
  DUMP_ELIGIBLE_JOB_TYPES,
  LEGACY_CUTOFF_DATE,
  PAYMENT_RELATED_ISSUE_TYPES,
  TERMINAL_INVOICE_STATUSES,
} from '../helpers/billing-issue-cleanup-rules';
import {
  BillingAuditReport,
  BulkCleanupPreview,
  BulkCleanupResult,
  BulkCleanupScope,
  BulkCleanupScopeKind,
} from '../dto/billing-audit.dto';

/**
 * Phase 6 — billing-issues audit + controlled cleanup service.
 *
 * READ paths:
 *   - getAuditReport(tenantId)
 *       Single tenant-scoped audit aggregating every billing_issues
 *       row by type, age, invoice state, era, and headline insights.
 *       O(N) per tenant; intended for admin usage, not hot-path.
 *
 *   - previewBulkCleanup(tenantId, scope)
 *       Returns counts + sample IDs for a deterministic stale rule.
 *       Pure read — does not mutate.
 *
 * WRITE paths:
 *   - executeBulkCleanup(tenantId, userId, scope)
 *       Runs the same deterministic rule as the preview, updates
 *       matching `billing_issues` rows to status='auto_resolved',
 *       stamps `resolution_category='legacy_cleanup'`, records
 *       resolved_by + resolved_at + a forensic resolution_reason.
 *       Tenant-scoped, idempotent (re-running clears nothing
 *       already resolved), single batched UPDATE per call.
 *
 * NEVER touched:
 *   - Invoice rows (status, amount_paid, balance_due) — only
 *     `InvoiceService.reconcileBalance()` is allowed to write those.
 *   - Job lifecycle / status.
 *   - Payment rows.
 *   - The blocked predicate.
 *
 * Multi-tenant safety:
 *   Every query starts with `bi.tenant_id = :tenantId`. Every join
 *   includes `<alias>.tenant_id = bi.tenant_id` belt-and-suspenders.
 *   No cross-tenant joins. The controller layer enforces admin
 *   role + tenant context via the existing @TenantId() decorator.
 */
@Injectable()
export class BillingAuditService {
  constructor(
    @InjectRepository(BillingIssue)
    private readonly issueRepo: Repository<BillingIssue>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
  ) {}

  /* ───────────────────────────────────────────────────────────── */
  /* AUDIT REPORT                                                  */
  /* ───────────────────────────────────────────────────────────── */

  async getAuditReport(tenantId: string): Promise<BillingAuditReport> {
    // Single tenant-scoped scan. Acceptable because:
    //   1. This is an admin tool, not a hot-path operator endpoint.
    //   2. Tenant-scoped, so worst case is one tenant's billing_issues.
    //   3. We need every row anyway to compute the headline insights
    //      (duplicates, dangling references, missing invoice links).
    // Joins to invoices and jobs are LEFT JOINs scoped on tenant_id
    // so a missing referent doesn't drop the issue row from the audit.
    const rows = await this.issueRepo
      .createQueryBuilder('bi')
      .leftJoin(
        'invoices',
        'inv',
        'inv.id = bi.invoice_id AND inv.tenant_id = bi.tenant_id',
      )
      .leftJoin(
        'jobs',
        'j',
        'j.id = bi.job_id AND j.tenant_id = bi.tenant_id',
      )
      .where('bi.tenant_id = :tenantId', { tenantId })
      .select([
        'bi.id AS bi_id',
        'bi.issue_type AS bi_issue_type',
        'bi.status AS bi_status',
        'bi.created_at AS bi_created_at',
        'bi.invoice_id AS bi_invoice_id',
        'bi.job_id AS bi_job_id',
        'inv.status AS inv_status',
        'inv.balance_due AS inv_balance_due',
        'j.id AS j_id',
        'j.job_type AS j_job_type',
        'j.status AS j_status',
        'j.created_at AS j_created_at',
      ])
      .getRawMany<{
        bi_id: string;
        bi_issue_type: string;
        bi_status: string;
        bi_created_at: Date;
        bi_invoice_id: string | null;
        bi_job_id: string | null;
        inv_status: string | null;
        inv_balance_due: string | null;
        j_id: string | null;
        j_job_type: string | null;
        j_status: string | null;
        j_created_at: Date | null;
      }>();

    const now = Date.now();
    const cutoffDate = new Date(LEGACY_CUTOFF_DATE).getTime();

    const report: BillingAuditReport = {
      tenant_id: tenantId,
      generated_at: new Date().toISOString(),
      legacy_cutoff: LEGACY_CUTOFF_DATE,
      totals: {
        all: rows.length,
        open: 0,
        auto_resolved: 0,
        manually_resolved: 0,
        dismissed: 0,
      },
      by_type: {},
      by_age: { lt_7d: 0, lt_30d: 0, lt_90d: 0, gte_90d: 0 },
      by_invoice_state: {
        unpaid: 0,
        paid: 0,
        partial: 0,
        voided: 0,
        zero_balance: 0,
        no_invoice: 0,
      },
      by_era: { legacy: 0, post_correction: 0, unknown: 0 },
      insights: {
        should_have_auto_resolved: 0,
        duplicates_on_same_job: 0,
        completed_unpaid_on_paid_invoice: 0,
        paid_invoice_with_open_issues: 0,
        dangling_job_reference: 0,
        missing_invoice_link: 0,
      },
      classification_summary: {
        valid: 0,
        stale_candidate: 0,
        needs_review: 0,
      },
    };

    // For duplicate detection — keyed by `${job_id}::${issue_type}`.
    const openByJobAndType = new Map<string, number>();

    for (const row of rows) {
      // Status totals
      switch (row.bi_status) {
        case 'open':
          report.totals.open++;
          break;
        case 'auto_resolved':
          report.totals.auto_resolved++;
          break;
        case 'manually_resolved':
          report.totals.manually_resolved++;
          break;
        case 'dismissed':
          report.totals.dismissed++;
          break;
      }

      // Type breakdown — counts EVERY status, not just open, so the
      // operator can see how many of each type were ever raised.
      report.by_type[row.bi_issue_type] =
        (report.by_type[row.bi_issue_type] ?? 0) + 1;

      // Age buckets are scoped to OPEN issues only — resolved issues
      // don't need age tracking, the operator cares about backlog.
      if (row.bi_status === 'open') {
        const ageDays = (now - new Date(row.bi_created_at).getTime()) / 86_400_000;
        if (ageDays < 7) report.by_age.lt_7d++;
        else if (ageDays < 30) report.by_age.lt_30d++;
        else if (ageDays < 90) report.by_age.lt_90d++;
        else report.by_age.gte_90d++;
      }

      // Invoice state breakdown — open issues only.
      if (row.bi_status === 'open') {
        if (!row.inv_status && !row.bi_invoice_id) {
          report.by_invoice_state.no_invoice++;
        } else if (!row.inv_status && row.bi_invoice_id) {
          // Issue points at an invoice that no longer exists.
          report.by_invoice_state.no_invoice++;
        } else {
          const balance = Number(row.inv_balance_due ?? 0);
          if (balance <= 0) report.by_invoice_state.zero_balance++;
          switch (row.inv_status) {
            case 'paid':
              report.by_invoice_state.paid++;
              break;
            case 'partial':
              report.by_invoice_state.partial++;
              break;
            case 'voided':
              report.by_invoice_state.voided++;
              break;
            default:
              if (balance > 0) report.by_invoice_state.unpaid++;
              break;
          }
        }
      }

      // Era buckets — open issues only, by linked job created_at.
      if (row.bi_status === 'open') {
        if (!row.j_created_at) {
          report.by_era.unknown++;
        } else if (new Date(row.j_created_at).getTime() < cutoffDate) {
          report.by_era.legacy++;
        } else {
          report.by_era.post_correction++;
        }
      }

      // Insights — open issues only.
      if (row.bi_status === 'open') {
        const wouldClearByPass = this.shouldHaveAutoResolved(
          row.bi_issue_type,
          row.inv_status,
          Number(row.inv_balance_due ?? 0),
          row.j_status,
          row.j_job_type,
          row.bi_invoice_id !== null && row.inv_status === null,
        );
        if (wouldClearByPass) {
          report.insights.should_have_auto_resolved++;
        }

        if (
          row.bi_issue_type === 'completed_unpaid' &&
          row.inv_status &&
          TERMINAL_INVOICE_STATUSES.includes(row.inv_status)
        ) {
          report.insights.completed_unpaid_on_paid_invoice++;
        }

        const balance = Number(row.inv_balance_due ?? 0);
        if (
          row.inv_status &&
          (CLOSED_INVOICE_STATUSES.includes(row.inv_status) || balance <= 0)
        ) {
          report.insights.paid_invoice_with_open_issues++;
        }

        if (row.bi_job_id && !row.j_id) {
          report.insights.dangling_job_reference++;
        }

        // Issue types that meaningfully need an invoice link but don't have one.
        if (
          !row.bi_invoice_id &&
          ['past_due_payment', 'completed_unpaid', 'price_mismatch'].includes(
            row.bi_issue_type,
          )
        ) {
          report.insights.missing_invoice_link++;
        }

        // Duplicate detection — track per (job_id, issue_type)
        if (row.bi_job_id) {
          const key = `${row.bi_job_id}::${row.bi_issue_type}`;
          openByJobAndType.set(key, (openByJobAndType.get(key) ?? 0) + 1);
        }

        // Classification — valid / stale_candidate / needs_review
        const classification = this.classifyOpenIssue(
          row.bi_issue_type,
          row.inv_status,
          balance,
          row.j_status,
          row.j_job_type,
          row.j_created_at,
          cutoffDate,
        );
        report.classification_summary[classification]++;
      }
    }

    // Duplicates count = number of (job_id, issue_type) keys with > 1 open issue.
    for (const count of openByJobAndType.values()) {
      if (count > 1) report.insights.duplicates_on_same_job += count - 1;
    }

    return report;
  }

  /* ───────────────────────────────────────────────────────────── */
  /* CLASSIFICATION                                                */
  /* ───────────────────────────────────────────────────────────── */

  /**
   * Returns true if an OPEN issue matches the predicate that
   * `BillingIssueDetectorService.resolveStaleIssues` would clear on
   * its next pass. Used by the audit to flag rows that "should have"
   * been cleared but are still open — usually because the 60s
   * cooldown blocked the cleanup pass or `getSummary` wasn't called
   * recently enough to trigger it.
   *
   * Mirrors the SQL predicates in resolveStaleIssues Pass 1–5
   * verbatim. Keep in lockstep when editing.
   */
  private shouldHaveAutoResolved(
    issueType: string,
    invStatus: string | null,
    balance: number,
    jobStatus: string | null,
    jobType: string | null,
    invoiceMissing: boolean,
  ): boolean {
    // Pass 1: past_due_payment cleared when balance ≤0 OR invoice in (paid, voided)
    if (issueType === 'past_due_payment') {
      if (balance <= 0) return true;
      if (invStatus && CLOSED_INVOICE_STATUSES.includes(invStatus)) return true;
    }
    // Pass 2: price_mismatch cleared when invoice closed
    if (issueType === 'price_mismatch') {
      if (invStatus && CLOSED_INVOICE_STATUSES.includes(invStatus)) return true;
    }
    // Pass 3: missing_dump_slip cleared when job not dump-eligible
    if (issueType === 'missing_dump_slip') {
      if (jobType && !DUMP_ELIGIBLE_JOB_TYPES.includes(jobType)) return true;
    }
    // Pass 4: completed_unpaid cleared when balance ≤0 OR invoice in
    // (paid, partial, voided)
    if (issueType === 'completed_unpaid') {
      if (balance <= 0) return true;
      if (invStatus && TERMINAL_INVOICE_STATUSES.includes(invStatus)) return true;
      // Pass 5: completed_unpaid cleared when job no longer completed
      if (jobStatus && jobStatus !== 'completed') return true;
    }
    // Invoice missing entirely (issue points at deleted invoice).
    // resolveStaleIssues does NOT cover this case — audit-only insight.
    if (invoiceMissing) return false;
    return false;
  }

  /**
   * Classify an open issue into one of three buckets. Used for the
   * audit report's `classification_summary`. Determinstic — same
   * inputs always produce the same bucket.
   */
  private classifyOpenIssue(
    issueType: string,
    invStatus: string | null,
    balance: number,
    jobStatus: string | null,
    jobType: string | null,
    jobCreatedAt: Date | null,
    cutoffMs: number,
  ): 'valid' | 'stale_candidate' | 'needs_review' {
    // STALE: payment-related issue with paid/zero-balance invoice
    if (PAYMENT_RELATED_ISSUE_TYPES.includes(issueType)) {
      if (balance <= 0) return 'stale_candidate';
      if (invStatus && TERMINAL_INVOICE_STATUSES.includes(invStatus)) {
        return 'stale_candidate';
      }
    }
    // STALE: price_mismatch on closed invoice
    if (
      issueType === 'price_mismatch' &&
      invStatus &&
      CLOSED_INVOICE_STATUSES.includes(invStatus)
    ) {
      return 'stale_candidate';
    }
    // STALE: missing_dump_slip on non-dump job
    if (
      issueType === 'missing_dump_slip' &&
      jobType &&
      !DUMP_ELIGIBLE_JOB_TYPES.includes(jobType)
    ) {
      return 'stale_candidate';
    }
    // STALE: completed_unpaid where job is no longer completed
    if (
      issueType === 'completed_unpaid' &&
      jobStatus &&
      jobStatus !== 'completed'
    ) {
      return 'stale_candidate';
    }

    // NEEDS REVIEW: legacy-era job with no deterministic stale rule match
    if (jobCreatedAt && new Date(jobCreatedAt).getTime() < cutoffMs) {
      return 'needs_review';
    }

    // NEEDS REVIEW: voided invoice (operator may need to investigate)
    if (invStatus === 'voided') {
      return 'needs_review';
    }

    // Otherwise the issue is presumed valid and actionable.
    return 'valid';
  }

  /* ───────────────────────────────────────────────────────────── */
  /* BULK CLEANUP                                                  */
  /* ───────────────────────────────────────────────────────────── */

  async previewBulkCleanup(
    tenantId: string,
    scope: BulkCleanupScope,
  ): Promise<BulkCleanupPreview> {
    const { sql, params, description } = this.buildBulkCleanupPredicate(scope);
    const qb = this.issueRepo
      .createQueryBuilder('bi')
      .where('bi.tenant_id = :tenantId', { tenantId })
      .andWhere('bi.status = :openStatus', { openStatus: 'open' })
      .andWhere(sql, params);

    const matched = await qb.getCount();
    const samples = await qb.select('bi.id', 'id').limit(25).getRawMany<{ id: string }>();

    return {
      scope,
      matched_count: matched,
      sample_ids: samples.map((s) => s.id),
      rule_description: description,
    };
  }

  async executeBulkCleanup(
    tenantId: string,
    userId: string,
    scope: BulkCleanupScope,
  ): Promise<BulkCleanupResult> {
    const { sql, params, description } = this.buildBulkCleanupPredicate(scope);

    // Build the inner SELECT of matching IDs first, then UPDATE only
    // those rows. This pattern works around TypeORM's UPDATE-with-JOIN
    // limitations and keeps the predicate identical to the preview.
    const innerQb = this.issueRepo
      .createQueryBuilder('bi')
      .select('bi.id')
      .where('bi.tenant_id = :tenantId', { tenantId })
      .andWhere('bi.status = :openStatus', { openStatus: 'open' })
      .andWhere(sql, params);

    const result = await this.issueRepo
      .createQueryBuilder()
      .update(BillingIssue)
      .set({
        status: 'auto_resolved',
        resolved_at: () => 'NOW()',
        resolved_by: userId,
        resolution_reason: `legacy_cleanup:${scope.kind}`,
        resolution_category: 'legacy_cleanup',
      })
      .where(`id IN (${innerQb.getQuery()})`)
      .setParameters(innerQb.getParameters())
      .execute();

    return {
      scope,
      resolved_count: result.affected ?? 0,
      executed_at: new Date().toISOString(),
      executed_by: userId,
    };
  }

  /**
   * Single source of truth for bulk-cleanup predicates. Both preview
   * and execute call this helper, so the count operators see in the
   * preview is exactly the count that gets resolved on execute.
   *
   * The exhaustiveness check on `BulkCleanupScopeKind` enforces that
   * adding a new kind to the DTO union forces a corresponding case
   * here at compile time.
   */
  private buildBulkCleanupPredicate(scope: BulkCleanupScope): {
    sql: string;
    params: Record<string, unknown>;
    description: string;
  } {
    const kind: BulkCleanupScopeKind = scope.kind;

    switch (kind) {
      case 'paid_invoice_payment_issues':
        return {
          sql: `bi.issue_type IN (:...payment_types) AND EXISTS (
                  SELECT 1 FROM invoices inv
                  WHERE inv.id = bi.invoice_id
                    AND inv.tenant_id = bi.tenant_id
                    AND inv.status IN (:...closed_statuses)
                )`,
          params: {
            payment_types: PAYMENT_RELATED_ISSUE_TYPES,
            closed_statuses: CLOSED_INVOICE_STATUSES,
          },
          description:
            'Resolve open payment-related issues (past_due_payment, completed_unpaid) whose linked invoice is in (paid, voided).',
        };

      case 'zero_balance_payment_issues':
        return {
          sql: `bi.issue_type IN (:...payment_types) AND EXISTS (
                  SELECT 1 FROM invoices inv
                  WHERE inv.id = bi.invoice_id
                    AND inv.tenant_id = bi.tenant_id
                    AND inv.balance_due <= 0
                )`,
          params: { payment_types: PAYMENT_RELATED_ISSUE_TYPES },
          description:
            'Resolve open payment-related issues whose linked invoice has zero or negative balance_due.',
        };

      case 'completed_unpaid_now_paid':
        return {
          sql: `bi.issue_type = :completed_unpaid AND EXISTS (
                  SELECT 1 FROM invoices inv
                  WHERE inv.id = bi.invoice_id
                    AND inv.tenant_id = bi.tenant_id
                    AND inv.status IN (:...terminal_statuses)
                )`,
          params: {
            completed_unpaid: 'completed_unpaid',
            terminal_statuses: TERMINAL_INVOICE_STATUSES,
          },
          description:
            'Resolve open completed_unpaid issues whose linked invoice is now in (paid, partial, voided).',
        };

      case 'missing_dump_slip_non_dump':
        return {
          sql: `bi.issue_type = :missing_dump_slip AND EXISTS (
                  SELECT 1 FROM jobs j
                  WHERE j.id = bi.job_id
                    AND j.tenant_id = bi.tenant_id
                    AND j.job_type NOT IN (:...dump_eligible)
                )`,
          params: {
            missing_dump_slip: 'missing_dump_slip',
            dump_eligible: DUMP_ELIGIBLE_JOB_TYPES,
          },
          description:
            'Resolve open missing_dump_slip issues on jobs whose job_type is not in the dump-eligible set.',
        };

      case 'legacy_stale_only': {
        const cutoff = scope.legacy_cutoff ?? LEGACY_CUTOFF_DATE;
        // Validate the date string up front so we don't pass garbage
        // into the bound parameter.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
          throw new BadRequestException(
            `legacy_cutoff must be a YYYY-MM-DD date string (got: ${cutoff})`,
          );
        }
        // The legacy scope is the union of every other deterministic
        // stale rule, additionally filtered to legacy-era jobs only.
        // We do NOT bulk-clean post-correction issues — those may
        // signal a current-system regression that needs operator
        // attention.
        return {
          sql: `EXISTS (
                  SELECT 1 FROM jobs j
                  WHERE j.id = bi.job_id
                    AND j.tenant_id = bi.tenant_id
                    AND j.created_at < :legacy_cutoff
                ) AND (
                  -- Pass 1 / past_due_payment on closed invoice
                  (bi.issue_type = :past_due_payment AND EXISTS (
                    SELECT 1 FROM invoices inv
                    WHERE inv.id = bi.invoice_id
                      AND inv.tenant_id = bi.tenant_id
                      AND (inv.balance_due <= 0 OR inv.status IN (:...closed_statuses))
                  ))
                  OR
                  -- Pass 4 / completed_unpaid on terminal invoice
                  (bi.issue_type = :completed_unpaid AND EXISTS (
                    SELECT 1 FROM invoices inv
                    WHERE inv.id = bi.invoice_id
                      AND inv.tenant_id = bi.tenant_id
                      AND (inv.balance_due <= 0 OR inv.status IN (:...terminal_statuses))
                  ))
                  OR
                  -- Pass 3 / missing_dump_slip on non-dump job
                  (bi.issue_type = :missing_dump_slip AND EXISTS (
                    SELECT 1 FROM jobs j2
                    WHERE j2.id = bi.job_id
                      AND j2.tenant_id = bi.tenant_id
                      AND j2.job_type NOT IN (:...dump_eligible)
                  ))
                )`,
          params: {
            legacy_cutoff: cutoff,
            past_due_payment: 'past_due_payment',
            completed_unpaid: 'completed_unpaid',
            missing_dump_slip: 'missing_dump_slip',
            closed_statuses: CLOSED_INVOICE_STATUSES,
            terminal_statuses: TERMINAL_INVOICE_STATUSES,
            dump_eligible: DUMP_ELIGIBLE_JOB_TYPES,
          },
          description: `Resolve every deterministically-stale issue (paid invoice, zero balance, terminal invoice, non-dump job) on jobs created before ${cutoff}. Post-correction-era issues are NOT touched.`,
        };
      }

      default: {
        // Exhaustiveness check — adding a new kind to the union
        // without handling it here is a compile-time error.
        const _exhaustive: never = kind;
        throw new BadRequestException(`Unknown bulk cleanup scope: ${_exhaustive}`);
      }
    }
  }
}
