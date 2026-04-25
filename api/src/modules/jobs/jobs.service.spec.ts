/**
 * JobsService.changeStatus test coverage — two generations of concerns:
 *
 * Phase B (silent-error-swallow audit — already shipped):
 *   site #26  failed-trip invoice reversal must propagate
 *   site #27  chain-type-change handler must propagate
 *   site #28  auto-close chain must propagate
 *   site #30  admin-override audit log must propagate
 *
 * Phase 1 (status override restoration — this spec file's additions):
 *   1. Admin override positive — audit row written, status updated
 *   2. Empty/whitespace reason rejected with override_reason_required:
 *   3. Transactional rollback — audit insert failure prevents commit
 *      (supersedes Phase B site #30's propagation-only assertion)
 *   4. Same-status no-op — unchanged job returned, no audit row
 *   5. Admin bypasses VALID_TRANSITIONS — backward transition succeeds
 *   6. Dispatcher role — no longer bypasses; hits VALID_TRANSITIONS gate
 *   + driver regression guard — valid forward transition still works
 *
 * NOTE on controller-level @Roles: the decorator is declarative NestJS
 * metadata and not unit-testable at the service layer. Per the Phase 1
 * sign-off we defend at the service by tightening the admin bypass
 * (owner/admin only; dispatcher/driver fall into the VALID_TRANSITIONS
 * gate). Controller-level coverage is the team lifecycle suite's
 * pattern for analogous routes.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { JobsService } from './jobs.service';
import { Job } from './entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { ClientPricingOverride } from '../pricing/entities/client-pricing-override.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Route } from '../dispatch/entities/route.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { BillingIssue } from '../billing/entities/billing-issue.entity';
import { CreditMemo } from '../billing/entities/credit-memo.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { JobPricingAudit } from './entities/job-pricing-audit.entity';
import { BillingService } from '../billing/billing.service';
import { BillingIssueDetectorService } from '../billing/services/billing-issue-detector.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PricingService } from '../pricing/pricing.service';
import { RentalChainsService } from '../rental-chains/rental-chains.service';
import { AlertService } from '../alerts/services/alert.service';
import { DispatchCreditEnforcementService } from '../dispatch/dispatch-credit-enforcement.service';

function makeJob(partial: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    job_type: 'delivery',
    status: 'in_progress',
    asset_id: 'asset-1',
    customer_id: 'cust-1',
    asset: { id: 'asset-1', subtype: '20yd' },
    customer: null,
    job_number: 'J-1',
    service_type: 'dumpster_rental',
    service_address: { lat: 1, lng: 2 },
    is_failed_trip: false,
    ...partial,
  } as any as Job;
}

interface Harness {
  service: JobsService;
  jobsRepository: any;
  notifRepo: any;
  invoiceRepo: any;
  taskChainLinkRepo: any;
  rentalChainRepo: any;
  billingService: any;
  rentalChainsService: any;
  billingIssueDetector: any;
  autoCloseSpy: jest.SpyInstance;
  // Phase 1 additions — the transaction wrap around save + audit
  // needs observable spies so we can assert commit-vs-rollback.
  transactionCommit: jest.Mock;
  txJobSave: jest.Mock;
  txNotifCreate: jest.Mock;
  txNotifSave: jest.Mock;
}

async function buildHarness(jobOverrides: Partial<Job> = {}): Promise<Harness> {
  const job = makeJob(jobOverrides);

  const jobsRepository: any = {
    save: jest.fn((x: any) => Promise.resolve(x)),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(job),
      getMany: jest.fn().mockResolvedValue([]),
    })),
    manager: {
      getRepository: () => ({ findOne: jest.fn().mockResolvedValue(null) }),
    },
  };
  const assetRepo: any = { findOne: jest.fn(), update: jest.fn(), find: jest.fn() };
  const notifRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn(),
  };
  const invoiceRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  };
  const taskChainLinkRepo: any = { findOne: jest.fn().mockResolvedValue(null) };
  const rentalChainRepo: any = { findOne: jest.fn() };

  const billingService: any = {
    voidInternalInvoice: jest.fn(),
    createInternalInvoice: jest.fn(),
  };
  const rentalChainsService: any = {
    handleTypeChange: jest.fn(),
  };
  const billingIssueDetector: any = {
    detectAllForInvoice: jest.fn(),
    detectMissingInvoice: jest.fn(),
  };
  const notificationsService: any = { send: jest.fn() };
  const pricingService: any = { calculate: jest.fn() };
  const alertService: any = {};
  const dispatchCreditEnforcement: any = {};

  // Phase 1 — transaction mock matching billing.service.spec.ts:91-94
  // pattern. Callback runs with a stub EntityManager whose
  // getRepository(Job|Notification) returns trx-scoped spies; commit
  // fires only on callback completion (not on throw). Existing
  // assertions that go through the un-trx-scoped notifRepo.save /
  // jobsRepository.save still pass because we route both repos to
  // the same mocks — the visible call count remains accurate.
  const transactionCommit = jest.fn();
  const txJobSave = jest.fn((x: any) => Promise.resolve(x));
  const txNotifCreate = jest.fn((x: any) => x);
  const txNotifSave = jest.fn().mockResolvedValue(undefined);
  const dataSource: any = {
    transaction: jest.fn(
      async (cb: (em: EntityManager) => Promise<unknown>) => {
        const trxJob = { save: txJobSave };
        const trxNotif = { save: txNotifSave, create: txNotifCreate };
        const trx: any = {
          getRepository: (entity: unknown) => {
            if (entity === Job) return trxJob;
            if (entity === Notification) return trxNotif;
            throw new Error(
              `unmocked trx repo: ${(entity as { name?: string })?.name ?? '?'}`,
            );
          },
        };
        const result = await cb(trx as EntityManager);
        transactionCommit();
        return result;
      },
    ),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      JobsService,
      { provide: getRepositoryToken(Job), useValue: jobsRepository },
      { provide: getRepositoryToken(Asset), useValue: assetRepo },
      { provide: getRepositoryToken(PricingRule), useValue: {} },
      { provide: getRepositoryToken(ClientPricingOverride), useValue: {} },
      { provide: getRepositoryToken(Notification), useValue: notifRepo },
      { provide: getRepositoryToken(Customer), useValue: {} },
      { provide: getRepositoryToken(Route), useValue: {} },
      { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
      { provide: getRepositoryToken(BillingIssue), useValue: {} },
      { provide: getRepositoryToken(CreditMemo), useValue: {} },
      { provide: getRepositoryToken(RentalChain), useValue: rentalChainRepo },
      { provide: getRepositoryToken(TaskChainLink), useValue: taskChainLinkRepo },
      { provide: getRepositoryToken(DumpTicket), useValue: {} },
      { provide: getRepositoryToken(JobPricingAudit), useValue: {} },
      { provide: BillingService, useValue: billingService },
      { provide: BillingIssueDetectorService, useValue: billingIssueDetector },
      { provide: RentalChainsService, useValue: rentalChainsService },
      { provide: NotificationsService, useValue: notificationsService },
      { provide: PricingService, useValue: pricingService },
      { provide: AlertService, useValue: alertService },
      { provide: DataSource, useValue: dataSource },
      { provide: DispatchCreditEnforcementService, useValue: dispatchCreditEnforcement },
    ],
  }).compile();

  const service = module.get(JobsService);

  // Stub autoCloseChainIfTerminal (private method) so tests #26/#27/#30
  // that transition to cancelled-or-similar don't hit its internal DB
  // calls. Individual tests override this when they target #28.
  const autoCloseSpy = jest
    .spyOn(service as any, 'autoCloseChainIfTerminal')
    .mockResolvedValue(undefined);

  return {
    service,
    jobsRepository,
    notifRepo,
    invoiceRepo,
    taskChainLinkRepo,
    rentalChainRepo,
    billingService,
    rentalChainsService,
    billingIssueDetector,
    autoCloseSpy,
    transactionCommit,
    txJobSave,
    txNotifCreate,
    txNotifSave,
  };
}

describe('JobsService — silent-error-swallow fixes in changeStatus', () => {
  // Site #26: failed-trip reversal must propagate.
  // Phase 1 — overrideReason is now required when admin changes status.
  it('site #26 (failed-trip reversal): throws when billingService.voidInternalInvoice errors', async () => {
    const h = await buildHarness({
      status: 'in_progress',
      is_failed_trip: true,
    });
    h.invoiceRepo.find.mockResolvedValue([
      {
        id: 'inv-1',
        status: 'open',
        line_items: [{ name: 'Failed trip charge' }],
      },
    ]);
    h.billingService.voidInternalInvoice.mockRejectedValue(
      new Error('void failed'),
    );

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'completed', overrideReason: 'test' } as any,
        'admin',
      ),
    ).rejects.toThrow('void failed');
  });

  // Site #27: chain type change must propagate.
  it('site #27 (handleTypeChange): throws when rentalChainsService.handleTypeChange errors', async () => {
    const h = await buildHarness({ status: 'pending' });
    h.rentalChainsService.handleTypeChange.mockRejectedValue(
      new Error('chain sync failed'),
    );

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        {
          status: 'cancelled',
          jobType: 'exchange',
          previousJobType: 'delivery',
          overrideReason: 'test',
        } as any,
        'admin',
      ),
    ).rejects.toThrow('chain sync failed');
  });

  // Site #28: auto-close chain must propagate.
  it('site #28 (autoCloseChainIfTerminal): throws when autoClose helper errors', async () => {
    const h = await buildHarness({ status: 'in_progress' });
    h.autoCloseSpy.mockRejectedValue(new Error('chain close failed'));

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'cancelled', overrideReason: 'test' } as any,
        'admin',
      ),
    ).rejects.toThrow('chain close failed');
  });

  // Site #30: admin override audit log. Phase 1 subsumes this — the
  // transactional rollback test (#3 below) asserts the same propagation
  // PLUS the commit-never-reached invariant. Kept here as a smoke check
  // that audit-write failures are still observable via the trx-scoped
  // Notification repo.
  //
  // Arc 1 — scenario changed from `in_progress → completed` (now classified
  // as sanctioned-forward, so no audit row is written) to `completed →
  // confirmed` which remains a genuine out-of-flow admin correction. The
  // audit-error propagation invariant being tested is unchanged.
  it('site #30 (admin override audit): propagates when trx notif save errors', async () => {
    const h = await buildHarness({ status: 'completed' });
    h.txNotifSave.mockRejectedValue(new Error('audit save failed'));

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'confirmed', overrideReason: 'test' } as any,
        'admin',
      ),
    ).rejects.toThrow('audit save failed');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Phase 1 — status override scope
// ──────────────────────────────────────────────────────────────────────

describe('JobsService.changeStatus — Phase 1 override scope', () => {
  // ── #1 — Admin override positive ─────────────────────────────────────
  // Arc 1 — scenario changed from `en_route → arrived` (now sanctioned-forward,
  // no audit row) to `en_route → pending`, a genuine out-of-flow correction.
  // The invariants under test — status saved via the trx repo, audit row
  // written inside the transaction, commit fires — are unchanged.
  it('1. admin override positive — status updated AND audit row written inside transaction', async () => {
    const h = await buildHarness({ status: 'en_route', job_type: 'pickup' });

    await h.service.changeStatus(
      'tenant-1',
      'job-1',
      { status: 'pending', overrideReason: 'Rolled back after mis-dispatch' } as any,
      'owner',
      'u-owner',
      'Owner',
    );

    // Save happened through the trx-scoped Job repo (proves transaction opened).
    expect(h.txJobSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
    // Audit row created inside the transaction with expected shape + trimmed reason.
    expect(h.txNotifCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'automation',
        type: 'status_override',
        body: expect.stringContaining('"from":"en_route"'),
      }),
    );
    const body = JSON.parse(h.txNotifCreate.mock.calls[0][0].body);
    expect(body).toEqual({
      from: 'en_route',
      to: 'pending',
      overriddenBy: 'owner',
      reason: 'Rolled back after mis-dispatch',
    });
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  // ── #2 — Empty / whitespace reason rejected ──────────────────────────
  // Arc 1 — scenario changed from `en_route → arrived` (sanctioned-forward,
  // gate bypassed) to `en_route → pending` (genuine out-of-flow). The
  // reason-required invariant being tested is unchanged.
  it('2. empty whitespace reason — throws override_reason_required: before any write', async () => {
    const h = await buildHarness({ status: 'en_route' });

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'pending', overrideReason: '   ' } as any,
        'admin',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // No transaction opened → no writes attempted.
    expect(h.transactionCommit).not.toHaveBeenCalled();
    expect(h.txJobSave).not.toHaveBeenCalled();
    expect(h.txNotifCreate).not.toHaveBeenCalled();
  });

  it('2b. missing reason — throws with override_reason_required: prefix', async () => {
    const h = await buildHarness({ status: 'en_route' });

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'pending' } as any,
        'owner',
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^override_reason_required:/),
    });
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // ── #3 — Transactional rollback ──────────────────────────────────────
  // Arc 1 — scenario changed from `en_route → arrived` (sanctioned, no audit
  // row) to `en_route → pending` (genuine override). The save+audit atomicity
  // invariant is unchanged.
  it('3. transactional rollback — audit insert failure prevents commit (supersedes #30)', async () => {
    const h = await buildHarness({ status: 'en_route', job_type: 'pickup' });
    h.txNotifSave.mockRejectedValue(new Error('audit insert failed'));

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'pending', overrideReason: 'oops' } as any,
        'admin',
      ),
    ).rejects.toThrow('audit insert failed');

    // Job save ran INSIDE the transaction (proves save + audit are a unit)…
    expect(h.txJobSave).toHaveBeenCalled();
    // …but the tx never committed, so that save rolls back too.
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // ── #4 — Same-status no-op ───────────────────────────────────────────
  it('4. same-status no-op — returns unchanged job, no audit row, no transaction', async () => {
    const h = await buildHarness({ status: 'arrived', job_type: 'pickup' });

    const result = await h.service.changeStatus(
      'tenant-1',
      'job-1',
      { status: 'arrived', overrideReason: 'noop' } as any,
      'owner',
    );

    expect(result.status).toBe('arrived');
    expect(h.transactionCommit).not.toHaveBeenCalled();
    expect(h.txNotifCreate).not.toHaveBeenCalled();
    expect(h.txJobSave).not.toHaveBeenCalled();
  });

  // ── #5 — Admin bypasses VALID_TRANSITIONS ────────────────────────────
  it('5. admin bypasses VALID_TRANSITIONS — en_route → pending backward transition succeeds', async () => {
    const h = await buildHarness({ status: 'en_route', job_type: 'pickup' });
    // en_route → pending is NOT in VALID_TRANSITIONS. Non-admin would be
    // rejected at the gate; admin bypasses.

    await h.service.changeStatus(
      'tenant-1',
      'job-1',
      { status: 'pending', overrideReason: 'Dispatched early by mistake' } as any,
      'owner',
      'u-owner',
      'Owner',
    );

    expect(h.txJobSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
    const body = JSON.parse(h.txNotifCreate.mock.calls[0][0].body);
    expect(body.from).toBe('en_route');
    expect(body.to).toBe('pending');
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  // ── #6 — Dispatcher hits VALID_TRANSITIONS gate (service-layer defense) ─
  // Controller-level @Roles guard is the primary gate; this test verifies
  // the service-layer tightening (dispatcher removed from admin bypass)
  // means dispatcher now falls through to VALID_TRANSITIONS validation.
  it('6. dispatcher role — en_route → pending rejected by VALID_TRANSITIONS (was bypassed pre-Phase 1)', async () => {
    const h = await buildHarness({ status: 'en_route', job_type: 'pickup' });

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'pending' } as any,
        'dispatcher',
      ),
    ).rejects.toThrow(/Cannot transition from 'en_route' to 'pending'/);

    expect(h.transactionCommit).not.toHaveBeenCalled();
    expect(h.txJobSave).not.toHaveBeenCalled();
  });

  // Regression guard — driver forward transitions must still work after
  // Phase 1's tightening; the driver app would break otherwise.
  it('regression: driver role — valid forward transition en_route → arrived succeeds without reason or audit row', async () => {
    const h = await buildHarness({ status: 'en_route', job_type: 'pickup' });

    await h.service.changeStatus(
      'tenant-1',
      'job-1',
      { status: 'arrived' } as any,
      'driver',
    );

    expect(h.txJobSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'arrived' }),
    );
    // Not an admin → audit write skipped inside the transaction.
    expect(h.txNotifCreate).not.toHaveBeenCalled();
    // Commit fires — the transaction wraps non-admin save too; only the
    // audit-row branch is admin-gated.
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  // ── #7/#8/#9 — Phase 1.7: override-to-Unassigned clears driver ──
  // Status↔driver coupling fix. Admin override whose target raw status
  // maps to the "Unassigned" display bucket (pending, confirmed) must
  // null assigned_driver_id atomically with the status save — otherwise
  // deriveDisplayStatus's object-form live-driver branch keeps the UI
  // stuck on "Assigned".

  it('7. override to Unassigned (confirmed) — clears assigned_driver_id atomically', async () => {
    const h = await buildHarness({
      status: 'dispatched',
      assigned_driver_id: 'driver-1',
      job_type: 'pickup',
    } as Partial<Job>);

    await h.service.changeStatus(
      'tenant-1',
      'job-1',
      { status: 'confirmed', overrideReason: 'rollback' } as any,
      'owner',
    );

    expect(h.txJobSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', assigned_driver_id: null }),
    );
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  it('8. override to Assigned (dispatched) — leaves assigned_driver_id intact', async () => {
    const h = await buildHarness({
      status: 'en_route',
      assigned_driver_id: 'driver-1',
      job_type: 'pickup',
    } as Partial<Job>);

    await h.service.changeStatus(
      'tenant-1',
      'job-1',
      { status: 'dispatched', overrideReason: 'rewind' } as any,
      'owner',
    );

    expect(h.txJobSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dispatched', assigned_driver_id: 'driver-1' }),
    );
  });

  it('9. override to Unassigned (pending) — also clears driver', async () => {
    const h = await buildHarness({
      status: 'dispatched',
      assigned_driver_id: 'driver-1',
      job_type: 'delivery',
    } as Partial<Job>);

    await h.service.changeStatus(
      'tenant-1',
      'job-1',
      { status: 'pending', overrideReason: 'reset' } as any,
      'owner',
    );

    expect(h.txJobSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', assigned_driver_id: null }),
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // Arc 1 — transition-aware override gate
  // ──────────────────────────────────────────────────────────────────────
  // Option A (see arc1-phase0-audit-report.md): the reason-required gate and
  // the `status_override` audit row both fire ONLY when the transition is NOT
  // in VALID_TRANSITIONS[previousStatus]. An admin doing a sanctioned forward
  // step is operationally identical to a driver doing the same step — no
  // reason demanded, no override audit row. Genuine out-of-flow corrections
  // still require a reason and still produce an audit row (covered by the
  // pre-existing Phase 1 tests above).

  describe('Arc 1 — transition-aware override gate', () => {
    // #A1 — Field-test reproduction: owner is the assigned driver on a
    // confirmed job, taps "On My Way". `confirmed → en_route` is a legal
    // forward edge after the VALID_TRANSITIONS enlargement, so no reason is
    // required and no override audit row is written.
    it('A1. owner + assigned driver + sanctioned forward (confirmed → en_route) — success, no reason, no audit row', async () => {
      const h = await buildHarness({
        status: 'confirmed',
        assigned_driver_id: 'u-owner',
        job_type: 'delivery',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'en_route' } as any,
        'owner',
        'u-owner',
        'Owner',
      );

      expect(h.txJobSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'en_route' }),
      );
      expect(h.txNotifCreate).not.toHaveBeenCalled();
      expect(h.transactionCommit).toHaveBeenCalledTimes(1);
    });

    // #A2 — The signal is transition legality, not who owns the job. An owner
    // who is NOT the assigned driver, doing a sanctioned forward step, gets
    // the same no-reason treatment. (Prevents the gate from drifting back
    // toward a capacity check.)
    it('A2. owner + NOT assigned driver + sanctioned forward — success, no reason, no audit row', async () => {
      const h = await buildHarness({
        status: 'en_route',
        assigned_driver_id: 'someone-else',
        job_type: 'pickup',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'arrived' } as any,
        'owner',
        'u-owner',
        'Owner',
      );

      expect(h.txJobSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'arrived' }),
      );
      expect(h.txNotifCreate).not.toHaveBeenCalled();
      expect(h.transactionCommit).toHaveBeenCalledTimes(1);
    });

    // #A3 — Phase 1.7 invariant preserved: genuine backward override with
    // reason still writes the audit row. (Complements the pre-existing #1/#5
    // tests — this one pins the post-Arc-1 classification from the positive
    // side, asserting that a non-sanctioned transition remains classified as
    // an override.)
    it('A3. owner + backward (non-sanctioned) + reason — success with audit row', async () => {
      const h = await buildHarness({ status: 'completed', job_type: 'pickup' });

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'confirmed', overrideReason: 'fixing dispatcher mistake' } as any,
        'owner',
      );

      expect(h.txJobSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'confirmed' }),
      );
      expect(h.txNotifCreate).toHaveBeenCalledTimes(1);
      const body = JSON.parse(h.txNotifCreate.mock.calls[0][0].body);
      expect(body).toEqual({
        from: 'completed',
        to: 'confirmed',
        overriddenBy: 'owner',
        reason: 'fixing dispatcher mistake',
      });
    });

    // #A4 — Phase 1.7 invariant preserved: genuine backward override without
    // reason still throws override_reason_required.
    it('A4. owner + backward (non-sanctioned) + NO reason — throws override_reason_required', async () => {
      const h = await buildHarness({ status: 'completed', job_type: 'pickup' });

      await expect(
        h.service.changeStatus(
          'tenant-1',
          'job-1',
          { status: 'confirmed' } as any,
          'owner',
        ),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/^override_reason_required:/),
      });
      expect(h.txJobSave).not.toHaveBeenCalled();
      expect(h.transactionCommit).not.toHaveBeenCalled();
    });

    // #A5 — Admin cancel from the web cancel modal sends `cancellationReason`
    // but NOT `overrideReason`. Because `cancelled` is in every non-terminal
    // VALID_TRANSITIONS entry, the transition is sanctioned forward and the
    // reason gate is skipped. `cancellationReason` is persisted through its
    // own dedicated column (unrelated to the override audit row).
    it('A5. admin cancel via cancel-modal payload (cancellationReason only) — success, no override audit row', async () => {
      const h = await buildHarness({ status: 'confirmed', job_type: 'delivery' });

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'cancelled', cancellationReason: 'customer request' } as any,
        'admin',
      );

      expect(h.txJobSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled' }),
      );
      // Sanctioned forward → no `status_override` notification even though
      // the actor is admin and the status changed. The `cancellationReason`
      // capture lives in its own column and is not the override audit row.
      expect(h.txNotifCreate).not.toHaveBeenCalled();
    });

    // #A6 — Newly legal forward edge: `confirmed → en_route` for a regular
    // driver-role user. Before the VALID_TRANSITIONS enlargement, the driver
    // app's "On My Way" tap from a confirmed job would have been rejected at
    // the VALID_TRANSITIONS gate.
    it('A6. driver + confirmed → en_route (newly legal forward edge) — success', async () => {
      const h = await buildHarness({
        status: 'confirmed',
        assigned_driver_id: 'u-driver',
        job_type: 'delivery',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'en_route' } as any,
        'driver',
        'u-driver',
      );

      expect(h.txJobSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'en_route' }),
      );
      expect(h.txNotifCreate).not.toHaveBeenCalled();
      expect(h.transactionCommit).toHaveBeenCalledTimes(1);
    });

    // #A7 — Newly legal forward edge: `pending → en_route`. Rare in practice
    // (jobs normally walk through `confirmed` first) but the driver app's
    // STATUS_FLOW at driver-app/app/job/[id].tsx:105 maps this transition.
    it('A7. driver + pending → en_route (newly legal forward edge) — success', async () => {
      const h = await buildHarness({
        status: 'pending',
        assigned_driver_id: 'u-driver',
        job_type: 'delivery',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'en_route' } as any,
        'driver',
        'u-driver',
      );

      expect(h.txJobSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'en_route' }),
      );
      expect(h.txNotifCreate).not.toHaveBeenCalled();
      expect(h.transactionCommit).toHaveBeenCalledTimes(1);
    });
  });
});
