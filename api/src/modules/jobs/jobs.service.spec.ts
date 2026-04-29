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
import { Payment } from '../billing/entities/payment.entity';
import { CreditAuditEvent } from '../credit-audit/credit-audit-event.entity';
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
import { CreditAuditService } from '../credit-audit/credit-audit.service';
import { StripeService } from '../stripe/stripe.service';
import { MapboxService } from '../mapbox/mapbox.service';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';

function makeJob(partial: Partial<Job> = {}): Job {
  const base = {
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
  } as Record<string, unknown>;
  // Arc H — match the production findOne shape: when assigned_driver_id is set,
  // findOne also populates the `assigned_driver` relation via
  // `leftJoinAndSelect('j.assigned_driver', 'assigned_driver')`. Tests that
  // omitted this relation hid the TypeORM relation-FK reconciliation bug class
  // (see archH-phase0-audit-report § 3) — `Repository.save(entity)` on an
  // entity with both the FK and the loaded relation will rehydrate the FK
  // from the relation, silently overwriting an explicit `null`. Without the
  // relation, the test mock just records what the in-memory entity looked
  // like and the bug stays invisible.
  if (base.assigned_driver_id && !base.assigned_driver) {
    base.assigned_driver = { id: base.assigned_driver_id };
  }
  return base as unknown as Job;
}

interface Harness {
  service: JobsService;
  jobsRepository: any;
  notifRepo: any;
  invoiceRepo: any;
  taskChainLinkRepo: any;
  rentalChainRepo: any;
  creditMemoRepo: any;
  paymentRepo: any;
  billingService: any;
  rentalChainsService: any;
  billingIssueDetector: any;
  creditAuditService: any;
  stripeService: any;
  autoCloseSpy: jest.SpyInstance;
  // Phase 1 additions — the transaction wrap around save + audit
  // needs observable spies so we can assert commit-vs-rollback.
  transactionCommit: jest.Mock;
  txJobSave: jest.Mock;
  txNotifCreate: jest.Mock;
  txNotifSave: jest.Mock;
  // Arc H — Bug 1 fix issues the FK null via Repository.update(criteria,
  // partial) AFTER the save, to bypass TypeORM's relation-FK reconciliation.
  // Distinct mock so tests can assert the update call directly.
  txJobUpdate: jest.Mock;
  // Arc J.1 — trx-bound spies for the cancellation orchestrator. The
  // transaction mock routes Invoice / CreditMemo / Payment /
  // CreditAuditEvent repository.getRepository() calls to these spies so
  // cancelJobWithFinancials assertions can target the trx-scoped writes
  // directly (proves atomicity).
  txInvoiceUpdate: jest.Mock;
  txCreditMemoCreate: jest.Mock;
  txCreditMemoSave: jest.Mock;
  txPaymentUpdate: jest.Mock;
  txPaymentFindOne: jest.Mock;
  txAuditCreate: jest.Mock;
  txAuditSave: jest.Mock;
  // Fix B — cascadeDelete trx-bound spies for tables newly written
  // inside the transaction wrapper (Asset / TaskChainLink / RentalChain).
  // The trx mock routes manager.getRepository(<entity>) calls to these
  // so Fix B assertions can target trx-scoped reads/writes directly.
  txAssetFindOne: jest.Mock;
  txAssetUpdate: jest.Mock;
  txTaskChainLinkDelete: jest.Mock;
  txTaskChainLinkFind: jest.Mock;
  txRentalChainUpdate: jest.Mock;
  txInvoiceFindOne: jest.Mock;
  // Fix C — JobsService.create trx-bound spies for the in-TX reads
  // (pricing resolution + customer discount + tenant settings rental
  // days) plus the jobs INSERT and the createInternalInvoice manager
  // identity check.
  txPricingFindOne: jest.Mock;
  txClientPricingGetOne: jest.Mock;
  txCustomerFindOne: jest.Mock;
  txTenantSettingsFindOne: jest.Mock;
  txJobSaveSpy: jest.Mock;
  // Track every transaction opened, in order. cancelJobWithFinancials
  // opens 1 main + N post-commit (one per refund_paid → Stripe call),
  // so this lets J4b/J4c assert the post-commit pattern.
  transactionInvocationCount: () => number;
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
    update: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
  };
  const taskChainLinkRepo: any = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
  };
  const rentalChainRepo: any = { findOne: jest.fn() };
  // Arc J.1 — un-trx-scoped repos used by the cancellation orchestrator
  // for the pre-transaction load (linkedInvoices) and the helper's
  // resolveRefundProviderStatusForAudit fallback.
  const creditMemoRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ id: 'memo-default', ...x })),
  };
  const paymentRepo: any = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
    save: jest.fn((x: any) => Promise.resolve(x)),
  };
  const creditAuditService: any = {
    record: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn(),
  };
  const stripeService: any = {
    createRefundForPaymentIntent: jest
      .fn()
      .mockResolvedValue({ refundId: 're_test', refundedAmount: 0 }),
    getClient: jest.fn(),
  };

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
  const txJobUpdate = jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
  const txNotifCreate = jest.fn((x: any) => x);
  const txNotifSave = jest.fn().mockResolvedValue(undefined);
  // Arc J.1 — trx-bound spies for cancellation orchestrator paths.
  // Defaults are happy-path; individual J-suite tests override.
  //
  // NOTE on the create+save chain: `txCreditMemoCreate` returns its
  // input UNCHANGED (no id auto-injection) so that `txCreditMemoSave`
  // is the single source of truth for the saved row's id. Tests that
  // need a deterministic id override `txCreditMemoSave.mockImplementation`.
  const txInvoiceUpdate = jest
    .fn()
    .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
  const txInvoiceFindOne = jest.fn().mockResolvedValue(null);
  const txCreditMemoCreate = jest.fn((x: any) => x);
  const txCreditMemoSave = jest.fn((x: any) =>
    Promise.resolve({ id: 'memo-default', ...x }),
  );
  const txPaymentUpdate = jest
    .fn()
    .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
  const txPaymentFindOne = jest.fn();
  const txAuditCreate = jest.fn((x: any) => x);
  const txAuditSave = jest.fn((x: any) =>
    Promise.resolve({ id: 'audit-default', ...x }),
  );
  // Fix B — cascadeDelete trx-bound spies (Asset / TaskChainLink /
  // RentalChain). Default returns are happy-path no-ops; individual
  // tests override.
  const txAssetFindOne = jest.fn().mockResolvedValue(null);
  const txAssetUpdate = jest
    .fn()
    .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
  const txTaskChainLinkDelete = jest
    .fn()
    .mockResolvedValue({ affected: 0, raw: [] });
  const txTaskChainLinkFind = jest.fn().mockResolvedValue([]);
  const txRentalChainUpdate = jest
    .fn()
    .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
  // Fix C — JobsService.create trx-bound spies. Pricing resolution +
  // discount + tenant settings reads run inside the TX; jobs INSERT and
  // createInternalInvoice receive the trx manager.
  const txPricingFindOne = jest.fn().mockResolvedValue(null);
  const txClientPricingGetOne = jest.fn().mockResolvedValue(null);
  const txCustomerFindOne = jest.fn().mockResolvedValue(null);
  const txTenantSettingsFindOne = jest
    .fn()
    .mockResolvedValue({ default_rental_period_days: 14 });
  const txJobSaveSpy = jest.fn((x: any) =>
    Promise.resolve({ id: 'mock-job-id', ...x }),
  );
  // Arc J.1 — counts every dataSource.transaction(...) entry. The
  // cancellation orchestrator opens 1 main tx + 1 post-commit tx per
  // refund_paid Stripe call, so J4b/J4c can assert exact invocation
  // counts to verify the post-commit pattern is in place.
  let transactionInvocations = 0;
  const dataSource: any = {
    transaction: jest.fn(
      async (cb: (em: EntityManager) => Promise<unknown>) => {
        transactionInvocations += 1;
        // Fix B — cascadeDelete now reads/deletes through the trx Job
        // repo (pickup findOne, driver_task delete) so trxJob exposes
        // findOne + delete in addition to save/update.
        // Fix C — JobsService.create now also goes through this trx Job
        // repo: jobsRepo.create + jobsRepo.save inside _createInTx. The
        // create method delegates to txJobSaveSpy (separate spy) so Fix
        // C tests can target the create-path save without colliding with
        // changeStatus's txJobSave assertions.
        const trxJob = {
          save: jest.fn(async (x: any) => {
            // Route create-shape entities (no id, fresh INSERT) to the
            // Fix-C-specific spy; route changeStatus-shape (existing
            // entity passed back through) to txJobSave.
            if (x && !x.id) return txJobSaveSpy(x);
            return txJobSave(x);
          }),
          update: txJobUpdate,
          findOne: jest.fn().mockResolvedValue(null),
          delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
          create: jest.fn((x: any) => x),
        };
        const trxNotif = { save: txNotifSave, create: txNotifCreate };
        const trxInvoice = {
          update: txInvoiceUpdate,
          findOne: txInvoiceFindOne,
        };
        const trxCreditMemo = {
          create: txCreditMemoCreate,
          save: txCreditMemoSave,
        };
        const trxPayment = {
          update: txPaymentUpdate,
          findOne: txPaymentFindOne,
        };
        const trxAudit = { create: txAuditCreate, save: txAuditSave };
        const trxAsset = {
          findOne: txAssetFindOne,
          update: txAssetUpdate,
        };
        const trxTaskChainLink = {
          delete: txTaskChainLinkDelete,
          find: txTaskChainLinkFind,
        };
        const trxRentalChain = {
          update: txRentalChainUpdate,
        };
        // Fix C — pricing resolution + discount + tenant settings reads.
        const trxPricing = { findOne: txPricingFindOne };
        const trxClientPricing = {
          createQueryBuilder: jest.fn(() => ({
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getOne: txClientPricingGetOne,
          })),
        };
        const trxCustomer = { findOne: txCustomerFindOne };
        const trxTenantSettings = { findOne: txTenantSettingsFindOne };
        const trx: any = {
          getRepository: (entity: unknown) => {
            if (entity === Job) return trxJob;
            if (entity === Notification) return trxNotif;
            if (entity === Invoice) return trxInvoice;
            if (entity === CreditMemo) return trxCreditMemo;
            if (entity === Payment) return trxPayment;
            if (entity === CreditAuditEvent) return trxAudit;
            if (entity === Asset) return trxAsset;
            if (entity === TaskChainLink) return trxTaskChainLink;
            if (entity === RentalChain) return trxRentalChain;
            if (entity === PricingRule) return trxPricing;
            if (entity === ClientPricingOverride) return trxClientPricing;
            if (entity === Customer) return trxCustomer;
            if (entity === TenantSettings) return trxTenantSettings;
            throw new Error(
              `unmocked trx repo: ${(entity as { name?: string })?.name ?? '?'}`,
            );
          },
          // Fix C — issueNextJobNumber (called via generateJobNumber from
          // _createInTx) issues a raw UPDATE … RETURNING via manager.query.
          // Stub returns the unwrapped rows shape the helper expects
          // (`[[{ issued_sequence: N }]]` is the nested-tuple form;
          // `[{ issued_sequence: N }]` is the flat form — the helper
          // handles both at job-number.util.ts:69-70).
          query: jest.fn().mockResolvedValue([{ issued_sequence: 1 }]),
        };
        const result = await cb(trx as EntityManager);
        transactionCommit();
        return result;
      },
    ),
    // The legacy cascadeDelete path uses `dataSource.manager` directly
    // (un-trx-scoped) — route those calls to the un-trx repos so the
    // cascadeDelete smoke test's assertions still target observable
    // mocks.
    manager: {
      getRepository: (entity: unknown) => {
        if (entity === Invoice) return invoiceRepo;
        if (entity === CreditMemo) return creditMemoRepo;
        if (entity === Payment) return paymentRepo;
        if (entity === CreditAuditEvent)
          return { create: jest.fn((x: any) => x), save: jest.fn() };
        throw new Error(
          `unmocked manager repo: ${(entity as { name?: string })?.name ?? '?'}`,
        );
      },
    },
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
      { provide: getRepositoryToken(CreditMemo), useValue: creditMemoRepo },
      { provide: getRepositoryToken(Payment), useValue: paymentRepo },
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
      { provide: CreditAuditService, useValue: creditAuditService },
      { provide: StripeService, useValue: stripeService },
      // Pre-existing harness gap: JobsService gained a MapboxService
      // dependency but the spec didn't backfill the mock; every test
      // previously failed at TestingModule.compile(). Minimal stub
      // covers the only methods touched (softGeocodeAndMerge).
      { provide: MapboxService, useValue: { softGeocodeAndMerge: jest.fn(async (x: any) => x) } },
      // Fix C — TenantSettings repo is read inside _createInTx via
      // manager.getRepository(TenantSettings). The token must be
      // registered in the module so JobsService boots; the actual reads
      // go through the trx mock above (txTenantSettingsFindOne).
      { provide: getRepositoryToken(TenantSettings), useValue: {} },
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
    creditMemoRepo,
    paymentRepo,
    billingService,
    rentalChainsService,
    billingIssueDetector,
    creditAuditService,
    stripeService,
    autoCloseSpy,
    transactionCommit,
    txJobSave,
    txJobUpdate,
    txNotifCreate,
    txNotifSave,
    txInvoiceUpdate,
    txCreditMemoCreate,
    txCreditMemoSave,
    txPaymentUpdate,
    txPaymentFindOne,
    txAuditCreate,
    txAuditSave,
    txAssetFindOne,
    txAssetUpdate,
    txTaskChainLinkDelete,
    txTaskChainLinkFind,
    txRentalChainUpdate,
    txInvoiceFindOne,
    txPricingFindOne,
    txClientPricingGetOne,
    txCustomerFindOne,
    txTenantSettingsFindOne,
    txJobSaveSpy,
    transactionInvocationCount: () => transactionInvocations,
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
    // Arc H — Bug 1 fix issues the FK null via Repository.update(criteria, partial)
    // after the Repository.save(entity) to bypass TypeORM's relation-FK
    // reconciliation. Assert the update call directly; the save assertion above
    // remains valid for the status change.
    expect(h.txJobUpdate).toHaveBeenCalledWith(
      { id: 'job-1', tenant_id: 'tenant-1' },
      { assigned_driver_id: null },
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
    // Arc H — see test #7 for the rationale: the FK null is persisted via
    // a separate column-only Repository.update call after the save.
    expect(h.txJobUpdate).toHaveBeenCalledWith(
      { id: 'job-1', tenant_id: 'tenant-1' },
      { assigned_driver_id: null },
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

  // ──────────────────────────────────────────────────────────────────────
  // Arc H — driver-clear hygiene
  // ──────────────────────────────────────────────────────────────────────
  // Covers Bug 1 (override-to-Unassigned actually nulls the FK in the DB
  // write, not just on the in-memory entity), Bug 2 (terminal-target overrides
  // also clear the driver), and the negative cases that prove the gate is
  // bounded (sanctioned-forward steps, needs_reschedule). See
  // archH-phase0-audit-report.md.

  describe('Arc H — driver-clear hygiene', () => {
    // #H1 — Bug 1 reproduction: override `dispatched → confirmed` (a target
    // in CLEAR_DRIVER_TARGETS) by an admin issues the column-only update so
    // the FK null actually persists, bypassing TypeORM's relation-FK
    // reconciliation. (The pre-existing test #7 also asserts this; H1 is a
    // standalone coverage point so a future refactor of #7 doesn't lose it.)
    it('H1. override dispatched → confirmed by owner — issues column-only FK update', async () => {
      const h = await buildHarness({
        status: 'dispatched',
        assigned_driver_id: 'u-driver',
        job_type: 'delivery',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'confirmed', overrideReason: 'roll back' } as any,
        'owner',
      );

      expect(h.txJobUpdate).toHaveBeenCalledWith(
        { id: 'job-1', tenant_id: 'tenant-1' },
        { assigned_driver_id: null },
      );
      expect(h.txJobUpdate).toHaveBeenCalledTimes(1);
    });

    // #H2 — Bug 2 reproduction: override `dispatched → cancelled` by an admin
    // (the override-modal cancel path) also clears the driver. Pre-Arc-H the
    // UNASSIGNED_TARGETS set didn't include `cancelled`, so this never fired.
    it('H2. override dispatched → cancelled by admin — clears the driver via update', async () => {
      const h = await buildHarness({
        status: 'dispatched',
        assigned_driver_id: 'u-driver',
        job_type: 'pickup',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'cancelled', overrideReason: 'customer no-show' } as any,
        'admin',
      );

      expect(h.txJobUpdate).toHaveBeenCalledWith(
        { id: 'job-1', tenant_id: 'tenant-1' },
        { assigned_driver_id: null },
      );
    });

    // #H3 — Web cancel-modal payload (`{status:'cancelled', cancellationReason}`,
    // no `overrideReason`). The transition is sanctioned-forward (cancelled
    // is in VALID_TRANSITIONS[confirmed]), so the override-reason gate is
    // skipped per Arc 1, but the driver-clear should still fire because the
    // target is in CLEAR_DRIVER_TARGETS.
    it('H3. cancel-modal payload by admin — clears the driver via update without overrideReason', async () => {
      const h = await buildHarness({
        status: 'confirmed',
        assigned_driver_id: 'u-driver',
        job_type: 'delivery',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'cancelled', cancellationReason: 'customer request' } as any,
        'admin',
      );

      expect(h.txJobUpdate).toHaveBeenCalledWith(
        { id: 'job-1', tenant_id: 'tenant-1' },
        { assigned_driver_id: null },
      );
    });

    // #H4 — Defensive negative: a sanctioned forward step targeting a status
    // NOT in CLEAR_DRIVER_TARGETS leaves the driver intact. Arrived is the
    // canonical "still actively executing" state.
    it('H4. en_route → arrived by driver — does NOT issue an FK update', async () => {
      const h = await buildHarness({
        status: 'en_route',
        assigned_driver_id: 'u-driver',
        job_type: 'pickup',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'arrived' } as any,
        'driver',
        'u-driver',
      );

      expect(h.txJobUpdate).not.toHaveBeenCalled();
    });

    // #H5 — Per the Arc H guardrail: `needs_reschedule` is NOT terminal.
    // Dispatch still owns those jobs and needs the assignment for rerouting.
    it('H5. override dispatched → needs_reschedule by owner — does NOT issue an FK update', async () => {
      const h = await buildHarness({
        status: 'dispatched',
        assigned_driver_id: 'u-driver',
        job_type: 'delivery',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'needs_reschedule', overrideReason: 'customer asked' } as any,
        'owner',
      );

      expect(h.txJobUpdate).not.toHaveBeenCalled();
    });

    // #H6 — A genuine override (admin, target in CLEAR_DRIVER_TARGETS, NOT
    // sanctioned-forward) writes BOTH the override audit row (Phase 1.7
    // invariant from Arc 1) AND the FK update. The two side effects co-fire
    // inside the same save-transaction.
    it('H6. genuine override fires both audit row and FK update inside one transaction', async () => {
      const h = await buildHarness({
        status: 'completed',
        assigned_driver_id: 'u-driver',
        job_type: 'pickup',
      } as Partial<Job>);

      await h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'confirmed', overrideReason: 'mistakenly completed' } as any,
        'owner',
      );

      // Audit row from Arc 1 still writes.
      expect(h.txNotifCreate).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'status_override' }),
      );
      // Plus the Arc H column-only FK null.
      expect(h.txJobUpdate).toHaveBeenCalledWith(
        { id: 'job-1', tenant_id: 'tenant-1' },
        { assigned_driver_id: null },
      );
      // Atomic — single committed transaction.
      expect(h.transactionCommit).toHaveBeenCalledTimes(1);
    });

    // #H7 — Drift guard: assert CLEAR_DRIVER_TARGETS membership is exactly
    // {pending, confirmed, cancelled, completed}. Catches accidental
    // additions (especially `needs_reschedule` or `failed`, both of which
    // would re-introduce the persisted-state-vs-request-shape divergence
    // documented above the constant) or accidental removals. The constant
    // is module-private; we assert it indirectly by exercising every
    // membership case end-to-end.
    it('H7. CLEAR_DRIVER_TARGETS contains the right members (drift guard)', async () => {
      // Each tuple: [previousStatus, dtoStatus, expectedClear].
      // dtoStatus enumerates statuses the system writes; expectedClear marks
      // whether the FK update should fire. Job type is `delivery` so none of
      // the per-type completion gates (dump-slip for pickup/exchange/removal,
      // drop-off-asset for exchange) intercept the test path.
      //
      // `failed` is NOT in CLEAR_DRIVER_TARGETS — the service rewrites
      // `dto.status='failed'` to `job.status='needs_reschedule'` before
      // save, so the persisted row would be needs_reschedule (driver-
      // preserved). Including failed in the set would diverge driver-clear
      // outcomes between two request shapes producing the identical row.
      // Negative coverage for `needs_reschedule` already proves the
      // persisted-state rule (#H5 plus the case below).
      const cases: Array<[string, string, boolean]> = [
        ['dispatched', 'pending', true],
        ['dispatched', 'confirmed', true],
        ['dispatched', 'cancelled', true],
        ['in_progress', 'completed', true],
        ['dispatched', 'en_route', false],
        ['en_route', 'arrived', false],
        ['arrived', 'in_progress', false],
        ['dispatched', 'needs_reschedule', false],
      ];

      for (const [previousStatus, dtoStatus, expectedClear] of cases) {
        const h = await buildHarness({
          status: previousStatus,
          assigned_driver_id: 'u-driver',
          job_type: 'delivery',
        } as Partial<Job>);

        await h.service.changeStatus(
          'tenant-1',
          'job-1',
          { status: dtoStatus, overrideReason: 'drift-guard' } as any,
          'owner',
        );

        if (expectedClear) {
          expect(h.txJobUpdate).toHaveBeenCalledWith(
            { id: 'job-1', tenant_id: 'tenant-1' },
            { assigned_driver_id: null },
          );
        } else {
          expect(h.txJobUpdate).not.toHaveBeenCalled();
        }
      }
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Arc J.1 — cancellation orchestrator (cancelJobWithFinancials)
//
// Invariant locks (the J-suite is responsible for these):
//   • Every cancellation produces ≥ 1 credit_audit_events row, written
//     through the threaded-manager path so it is atomic with the rest
//     of the transaction (J1, J1b, J10).
//   • Per-invoice decisions follow a four-branch contract:
//     void_unpaid | refund_paid | credit_memo | keep_paid (J2-J6).
//   • Partial-payment auto-voids the unpaid balance as part of the
//     paid-portion decision (J7).
//   • Atomic rollback when ANY decision fails (J8 — Lock 2 mock pattern).
//   • DTO validation rejects bad combos (J9, J11, J12).
//   • Stripe API call lives AFTER commit, in its OWN post-commit
//     transaction so the payment-status update + result audit row are
//     atomic with each other (J4, J4b, J4c — Lock 3).
//   • Card payments without stripe_payment_intent_id route to the
//     manual_required path with no Stripe call (J5).
// ──────────────────────────────────────────────────────────────────────

describe('JobsService.cancelJobWithFinancials — Arc J.1', () => {
  // Shared helper: wires a job + invoice loadout for a one-decision
  // scenario. Tests override the specifics (decision type, payment
  // shape, etc.) per-case.
  async function buildCancelHarness(opts: {
    job?: Partial<Job>;
    linkedInvoices?: Array<Partial<Invoice> & { id: string }>;
    payment?: any;
  } = {}) {
    const h = await buildHarness({
      status: 'confirmed',
      ...opts.job,
    });
    // Tenant-scoped job load inside the orchestrator goes through
    // jobsRepository.findOne. The pre-existing harness mock returns
    // null; replace per test.
    h.jobsRepository.findOne.mockResolvedValue({
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: 'confirmed',
      job_number: 'J-1',
      job_type: 'delivery',
      customer_id: 'cust-1',
      asset_id: 'asset-1',
      ...opts.job,
    });

    // Direct invoices via job_id.
    h.invoiceRepo.find.mockResolvedValue(opts.linkedInvoices ?? []);
    h.taskChainLinkRepo.findOne.mockResolvedValue(null);

    if (opts.payment) {
      h.txPaymentFindOne.mockResolvedValue(opts.payment);
      h.paymentRepo.findOne.mockResolvedValue(opts.payment);
    }
    return h;
  }

  // ── J1: zero-dollar single-invoice → cancellation_no_financials ──────
  it('J1. single zero-dollar invoice — Step 2 skipped, no financial helper called, single cancellation_no_financials audit row', async () => {
    const h = await buildCancelHarness({
      linkedInvoices: [
        {
          id: 'inv-1',
          tenant_id: 'tenant-1',
          job_id: 'job-1',
          customer_id: 'cust-1',
          invoice_number: 1001,
          status: 'paid',
          total: 0,
          amount_paid: 0,
          balance_due: 0,
        } as any,
      ],
    });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      { cancellationReason: 'r', invoiceDecisions: [] },
      'u-owner',
      'owner',
      'Owner',
    );

    // (a) NO financial helper writes (no invoice update via trx, no
    //     credit memo, no payment update).
    expect(h.txInvoiceUpdate).not.toHaveBeenCalled();
    expect(h.txCreditMemoSave).not.toHaveBeenCalled();
    expect(h.txPaymentUpdate).not.toHaveBeenCalled();

    // (b) Job saved with cancelled status.
    expect(h.txJobSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );

    // (c) ONE credit_audit_events row of type cancellation_no_financials.
    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0][0]).toEqual(
      expect.objectContaining({
        eventType: 'cancellation_no_financials',
        metadata: expect.objectContaining({
          invoice_count: 1,
          reason_no_financials: 'all_invoices_zero_value',
        }),
      }),
    );

    // (d) Audit row written via threaded-manager path (second arg
    //     present + has getRepository).
    expect(auditCalls[0][1]).toBeDefined();
    expect(typeof auditCalls[0][1].getRepository).toBe('function');

    // (e) Transaction committed exactly once (main only — no Stripe).
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  // ── J1b: zero linked invoices → cancellation_no_financials variant ──
  it('J1b. job with zero linked invoices — single cancellation_no_financials audit row with no_linked_invoices', async () => {
    const h = await buildCancelHarness({ linkedInvoices: [] });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      { cancellationReason: 'r', invoiceDecisions: [] },
      'u-owner',
      'owner',
      'Owner',
    );

    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0][0]).toEqual(
      expect.objectContaining({
        eventType: 'cancellation_no_financials',
        metadata: expect.objectContaining({
          invoice_count: 0,
          reason_no_financials: 'no_linked_invoices',
        }),
      }),
    );
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  // ── J2: void_unpaid on unpaid invoice ────────────────────────────────
  it('J2. void_unpaid on unpaid invoice — invoice voided, no memo, audit row cancellation_void_unpaid', async () => {
    const inv = {
      id: 'inv-1',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1002,
      status: 'open',
      total: 500,
      amount_paid: 0,
      balance_due: 500,
    };
    const h = await buildCancelHarness({ linkedInvoices: [inv as any] });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-1', decision: 'void_unpaid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    expect(h.txInvoiceUpdate).toHaveBeenCalledWith(
      { id: 'inv-1', tenant_id: 'tenant-1' },
      expect.objectContaining({
        status: 'voided',
        balance_due: 0,
      }),
    );
    expect(h.txCreditMemoSave).not.toHaveBeenCalled();
    expect(h.txPaymentUpdate).not.toHaveBeenCalled();

    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0][0]).toEqual(
      expect.objectContaining({
        eventType: 'cancellation_void_unpaid',
        metadata: expect.objectContaining({
          invoice_id: 'inv-1',
          amount_paid_at_decision: 0,
          balance_due_at_decision: 500,
          unpaid_balance_voided: 0,
          paid_portion_decision: null,
          paid_portion_amount: null,
        }),
      }),
    );
    expect(auditCalls[0][1]).toBeDefined();
    expect(typeof auditCalls[0][1].getRepository).toBe('function');
  });

  // ── J3: credit_memo on fully-paid invoice ────────────────────────────
  it('J3. credit_memo on fully-paid invoice — memo with amount_paid (not total), invoice voided, audit row cancellation_credit_memo', async () => {
    const inv = {
      id: 'inv-3',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1003,
      status: 'paid',
      total: 1000,
      amount_paid: 1000,
      balance_due: 0,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [inv as any],
      payment: {
        id: 'pay-3',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-3',
        amount: 1000,
        payment_method: 'card',
        stripe_payment_intent_id: 'pi_test_card',
        refunded_amount: 0,
      },
    });
    h.txCreditMemoSave.mockImplementation((x: any) =>
      Promise.resolve({ id: 'memo-3', ...x }),
    );

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-3', decision: 'credit_memo' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    expect(h.txCreditMemoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        original_invoice_id: 'inv-3',
        amount: 1000,
        status: 'issued',
      }),
    );
    expect(h.txCreditMemoSave).toHaveBeenCalled();

    expect(h.txInvoiceUpdate).toHaveBeenCalledWith(
      { id: 'inv-3', tenant_id: 'tenant-1' },
      expect.objectContaining({ status: 'voided', balance_due: 0 }),
    );

    // No Stripe call on credit_memo — refund-vs-credit are distinct.
    expect(h.stripeService.createRefundForPaymentIntent).not.toHaveBeenCalled();

    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    expect(auditCalls[0][0]).toEqual(
      expect.objectContaining({
        eventType: 'cancellation_credit_memo',
        metadata: expect.objectContaining({
          paid_portion_decision: 'credit_memo',
          paid_portion_amount: 1000,
          unpaid_balance_voided: 0,
          credit_memo_id: 'memo-3',
        }),
      }),
    );
  });

  // ── J4: refund_paid card with PI → Stripe call after commit ──────────
  it('J4. refund_paid on card payment WITH stripe_payment_intent_id — payment updated inside-tx, Stripe call AFTER commit, success audit row', async () => {
    const inv = {
      id: 'inv-4',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1004,
      status: 'paid',
      total: 750,
      amount_paid: 750,
      balance_due: 0,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [inv as any],
      payment: {
        id: 'pay-4',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-4',
        amount: 750,
        payment_method: 'card',
        stripe_payment_intent_id: 'pi_card_4',
        refunded_amount: 0,
      },
    });
    h.stripeService.createRefundForPaymentIntent.mockResolvedValue({
      refundId: 're_test_4',
      refundedAmount: 750,
    });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-4', decision: 'refund_paid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // Arc J.1f-bug2 — inside-tx call writes refund_provider_status ONLY.
    // refunded_amount is deferred to the post-commit success handler
    // (asserted in J4d). Exact-payload match catches accidental future
    // re-introduction of refunded_amount on the deferred path.
    expect(h.txPaymentUpdate).toHaveBeenNthCalledWith(
      1,
      { id: 'pay-4', tenant_id: 'tenant-1' },
      { refund_provider_status: 'pending_stripe' },
    );

    // Stripe API called AFTER main-tx commit with the loaded PI.
    expect(h.stripeService.createRefundForPaymentIntent).toHaveBeenCalledWith(
      'tenant-1',
      'pi_card_4',
      750,
      expect.objectContaining({ invoiceId: 'inv-4' }),
    );

    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    // 2 calls: 1 inside main tx (pending_stripe) + 1 post-commit (stripe_succeeded).
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[1][0]).toEqual(
      expect.objectContaining({
        eventType: 'cancellation_refund_paid',
        metadata: expect.objectContaining({
          refund_provider_status: 'stripe_succeeded',
          stripe_refund_id: 're_test_4',
        }),
      }),
    );
  });

  // ── J4b (Lock 3): post-commit Stripe success uses its own transaction ──
  it('J4b. Stripe success path uses post-commit transaction — exactly 2 dataSource.transaction invocations', async () => {
    const inv = {
      id: 'inv-4b',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1005,
      status: 'paid',
      total: 100,
      amount_paid: 100,
      balance_due: 0,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [inv as any],
      payment: {
        id: 'pay-4b',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-4b',
        amount: 100,
        payment_method: 'card',
        stripe_payment_intent_id: 'pi_card_4b',
        refunded_amount: 0,
      },
    });
    h.stripeService.createRefundForPaymentIntent.mockResolvedValue({
      refundId: 're_test_4b',
      refundedAmount: 100,
    });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-4b', decision: 'refund_paid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // Lock 3: 1 main + 1 post-commit success transaction = 2 total.
    expect(h.transactionInvocationCount()).toBe(2);
  });

  // ── J4c (Lock 3): post-commit Stripe failure uses its own transaction ──
  it('J4c. Stripe failure path uses post-commit transaction with stripe_failed status + error metadata', async () => {
    const inv = {
      id: 'inv-4c',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1006,
      status: 'paid',
      total: 200,
      amount_paid: 200,
      balance_due: 0,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [inv as any],
      payment: {
        id: 'pay-4c',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-4c',
        amount: 200,
        payment_method: 'card',
        stripe_payment_intent_id: 'pi_card_4c',
        refunded_amount: 0,
      },
    });
    h.stripeService.createRefundForPaymentIntent.mockRejectedValue(
      new Error('stripe network down'),
    );

    const result = await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-4c', decision: 'refund_paid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // Lock 3: 1 main + 1 post-commit failure transaction = 2 total.
    expect(h.transactionInvocationCount()).toBe(2);

    // Post-commit tx wrote stripe_failed.
    expect(h.txPaymentUpdate).toHaveBeenCalledWith(
      { id: 'pay-4c', tenant_id: 'tenant-1' },
      { refund_provider_status: 'stripe_failed' },
    );

    // Failure-state audit row populated.
    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    const failedAudit = auditCalls.find(
      (c) =>
        c[0].metadata?.refund_provider_status === 'stripe_failed',
    );
    expect(failedAudit).toBeDefined();
    expect(failedAudit![0].metadata.stripe_error_message).toContain(
      'stripe network down',
    );

    // Surfaced to operator.
    expect(result.stripeFailures).toHaveLength(1);
    expect(result.stripeFailures[0]).toEqual(
      expect.objectContaining({
        invoice_id: 'inv-4c',
        payment_id: 'pay-4c',
        error: expect.stringContaining('stripe network down'),
      }),
    );

    // Job IS still cancelled — Stripe failure does NOT roll back.
    expect(h.txJobSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  // ── J4d (Arc J.1f-bug2): post-commit Stripe success writes refunded_amount ──
  // Locks the column-semantics contract: stripe_succeeded ALWAYS pairs with
  // refunded_amount = actual moved amount. Inside-tx call writes status only
  // (pending_stripe with no refunded_amount); post-commit call writes both.
  it('J4d. post-commit Stripe success — refunded_amount + stripe_succeeded written together', async () => {
    const inv = {
      id: 'inv-4d',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 10052,
      status: 'paid',
      total: 600,
      amount_paid: 600,
      balance_due: 0,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [inv as any],
      payment: {
        id: 'pay-4d',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-4d',
        amount: 600,
        payment_method: 'card',
        stripe_payment_intent_id: 'pi_card_4d',
        refunded_amount: 0,
      },
    });
    h.stripeService.createRefundForPaymentIntent.mockResolvedValue({
      refundId: 're_test_4d',
      refundedAmount: 600,
    });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-4d', decision: 'refund_paid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // Inside-tx (1st call): pending_stripe ONLY, no refunded_amount.
    expect(h.txPaymentUpdate).toHaveBeenNthCalledWith(
      1,
      { id: 'pay-4d', tenant_id: 'tenant-1' },
      { refund_provider_status: 'pending_stripe' },
    );

    // Post-commit (2nd call): stripe_succeeded + refunded_amount = intent.amount.
    expect(h.txPaymentUpdate).toHaveBeenNthCalledWith(
      2,
      { id: 'pay-4d', tenant_id: 'tenant-1' },
      {
        refund_provider_status: 'stripe_succeeded',
        refunded_amount: 600,
      },
    );
  });

  // ── J5: refund_paid card WITHOUT PI → manual_required, no Stripe call ──
  it('J5. refund_paid on card payment WITHOUT stripe_payment_intent_id — marked manual_required, NO Stripe call, audit row cancellation_refund_paid', async () => {
    const inv = {
      id: 'inv-5',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1007,
      status: 'paid',
      total: 300,
      amount_paid: 300,
      balance_due: 0,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [inv as any],
      payment: {
        id: 'pay-5',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-5',
        amount: 300,
        payment_method: 'card',
        stripe_payment_intent_id: null,
        refunded_amount: 0,
      },
    });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-5', decision: 'refund_paid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // Arc J.1f-bug2 — inside-tx call writes refund_provider_status ONLY.
    // refunded_amount stays 0 because no money has moved; the operator
    // will refund manually in the Stripe Dashboard later. The intended-
    // refund value is preserved in audit metadata (paid_portion_amount).
    expect(h.txPaymentUpdate).toHaveBeenNthCalledWith(
      1,
      { id: 'pay-5', tenant_id: 'tenant-1' },
      { refund_provider_status: 'manual_required' },
    );

    // Audit metadata still carries the intended-refund amount so a
    // future operator-completes flow can recover the value without
    // polluting payments.refunded_amount.
    const j5AuditParams = (h.creditAuditService.record as jest.Mock).mock
      .calls[0][0];
    expect(j5AuditParams).toEqual(
      expect.objectContaining({
        eventType: 'cancellation_refund_paid',
        metadata: expect.objectContaining({
          paid_portion_amount: 300,
          paid_portion_decision: 'refund_paid',
          refund_provider_status: 'manual_required',
        }),
      }),
    );

    expect(h.stripeService.createRefundForPaymentIntent).not.toHaveBeenCalled();
    // No post-commit tx since no Stripe call.
    expect(h.transactionInvocationCount()).toBe(1);
  });

  // ── J5b (Arc J.1f-bug2): cash refund → manual_completed writes amount immediately ──
  // Cash refunds are presumed instant by ops (the operator hands the cash
  // back at the time of cancellation). Unlike `manual_required` (card with
  // no PI, deferred to a manual Stripe Dashboard refund) and `pending_stripe`
  // (deferred to post-commit), `manual_completed` writes refunded_amount in
  // the inside-tx update.
  it('J5b. refund_paid with cash payment — manual_completed status WITH refunded_amount written immediately', async () => {
    const inv = {
      id: 'inv-5b',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 10071,
      status: 'paid',
      total: 425,
      amount_paid: 425,
      balance_due: 0,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [inv as any],
      payment: {
        id: 'pay-5b',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-5b',
        amount: 425,
        payment_method: 'cash',
        stripe_payment_intent_id: null,
        refunded_amount: 0,
      },
    });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-5b', decision: 'refund_paid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // Cash refund — refunded_amount written immediately, status manual_completed.
    expect(h.txPaymentUpdate).toHaveBeenNthCalledWith(
      1,
      { id: 'pay-5b', tenant_id: 'tenant-1' },
      {
        refund_provider_status: 'manual_completed',
        refunded_amount: 425,
      },
    );
    expect(h.stripeService.createRefundForPaymentIntent).not.toHaveBeenCalled();
    expect(h.transactionInvocationCount()).toBe(1);
  });

  // ── J6: keep_paid on fully-paid invoice ──────────────────────────────
  it('J6. keep_paid on fully-paid invoice — no payment update, no memo, audit row records reason', async () => {
    const inv = {
      id: 'inv-6',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1008,
      status: 'paid',
      total: 200,
      amount_paid: 200,
      balance_due: 0,
    };
    const h = await buildCancelHarness({ linkedInvoices: [inv as any] });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [
          {
            invoice_id: 'inv-6',
            decision: 'keep_paid',
            reason: 'customer kept service',
          },
        ],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    expect(h.txPaymentUpdate).not.toHaveBeenCalled();
    expect(h.txCreditMemoSave).not.toHaveBeenCalled();
    // balance_due is 0 → no auto-void → no invoice update either.
    expect(h.txInvoiceUpdate).not.toHaveBeenCalled();

    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    expect(auditCalls[0][0]).toEqual(
      expect.objectContaining({
        eventType: 'cancellation_keep_paid',
        metadata: expect.objectContaining({
          decision_reason: 'customer kept service',
          paid_portion_decision: 'keep_paid',
          paid_portion_amount: 200,
          unpaid_balance_voided: 0,
        }),
      }),
    );
  });

  // ── J7: partial-payment + credit_memo → memo for $400, balance voided ─
  it('J7. partial-payment ($1000 total, $400 paid, $600 balance) + credit_memo — memo for $400 + auto-void $600 + single audit row', async () => {
    const inv = {
      id: 'inv-7',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1009,
      status: 'partial',
      total: 1000,
      amount_paid: 400,
      balance_due: 600,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [inv as any],
      payment: {
        id: 'pay-7',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-7',
        amount: 400,
        payment_method: 'card',
        stripe_payment_intent_id: 'pi_card_7',
        refunded_amount: 0,
      },
    });
    h.txCreditMemoSave.mockImplementation((x: any) =>
      Promise.resolve({ id: 'memo-7', ...x }),
    );

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-7', decision: 'credit_memo' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // Memo for $400 (amount_paid), NOT $1000 (total).
    expect(h.txCreditMemoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        original_invoice_id: 'inv-7',
        amount: 400,
      }),
    );

    // Single invoice update voids the invoice + zeros the balance
    // (auto-void of the unpaid $600 happens in the same write).
    expect(h.txInvoiceUpdate).toHaveBeenCalledTimes(1);
    expect(h.txInvoiceUpdate).toHaveBeenCalledWith(
      { id: 'inv-7', tenant_id: 'tenant-1' },
      expect.objectContaining({ status: 'voided', balance_due: 0 }),
    );

    // ONE audit row — paid + unpaid halves merged into one event.
    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0][0]).toEqual(
      expect.objectContaining({
        eventType: 'cancellation_credit_memo',
        metadata: expect.objectContaining({
          paid_portion_decision: 'credit_memo',
          paid_portion_amount: 400,
          unpaid_balance_voided: 600,
          credit_memo_id: 'memo-7',
        }),
      }),
    );

    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  // ── J8 (Lock 2): rollback on second-decision failure ─────────────────
  // Two paid invoices, both `credit_memo` decisions. First memo save
  // resolves (no-op for the rollback assertion); second memo save
  // rejects with "forced rollback test"; the entire transaction
  // rolls back. Lock-2 mock pattern preserved exactly:
  //   creditMemoRepo.save = jest.fn()
  //     .mockResolvedValueOnce(memo1)
  //     .mockRejectedValueOnce(new Error('forced rollback test'));
  it('J8. mixed decisions — rollback when one fails, no audit rows persisted, no commit', async () => {
    const invPaidA = {
      id: 'inv-8a',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1010,
      status: 'paid',
      total: 500,
      amount_paid: 500,
      balance_due: 0,
    };
    const invPaidB = {
      id: 'inv-8b',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1011,
      status: 'paid',
      total: 700,
      amount_paid: 700,
      balance_due: 0,
    };
    const h = await buildCancelHarness({
      linkedInvoices: [invPaidA as any, invPaidB as any],
    });

    // Lock 2 — exact mock pattern: first save resolves, second rejects.
    const memo1 = { id: 'memo-1', original_invoice_id: 'inv-8a', amount: 500, status: 'issued' };
    h.txCreditMemoSave
      .mockReset()
      .mockResolvedValueOnce(memo1)
      .mockRejectedValueOnce(new Error('forced rollback test'));

    await expect(
      h.service.cancelJobWithFinancials(
        'tenant-1',
        'job-1',
        {
          cancellationReason: 'r',
          invoiceDecisions: [
            { invoice_id: 'inv-8a', decision: 'credit_memo' },
            { invoice_id: 'inv-8b', decision: 'credit_memo' },
          ],
        },
        'u-owner',
        'owner',
        'Owner',
      ),
    ).rejects.toThrow('forced rollback test');

    // Transaction never committed.
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // ── J9: DTO validation — keep_paid without reason rejected ───────────
  // Note: this exercises the SERVICE-layer guard. The class-validator
  // DTO layer 1 runs at the controller before this method is reached;
  // the orchestrator's eligibility check is layer 2 and is what this
  // test asserts. (DTO-layer rejection is enforced by ValidationPipe
  // outside the service unit.)
  it('J9. keep_paid without reason — service-layer guard rejects with keep_paid_reason_required', async () => {
    const inv = {
      id: 'inv-9',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1012,
      status: 'paid',
      total: 100,
      amount_paid: 100,
      balance_due: 0,
    };
    const h = await buildCancelHarness({ linkedInvoices: [inv as any] });

    await expect(
      h.service.cancelJobWithFinancials(
        'tenant-1',
        'job-1',
        {
          cancellationReason: 'r',
          invoiceDecisions: [
            { invoice_id: 'inv-9', decision: 'keep_paid' },
          ],
        },
        'u-owner',
        'owner',
        'Owner',
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^keep_paid_reason_required:/),
    });

    expect(h.transactionCommit).not.toHaveBeenCalled();
    expect(h.txJobSave).not.toHaveBeenCalled();
  });

  // ── J10: threaded-manager — audit save inside trx, NOT this.repo ─────
  it('J10. audit row written via threaded manager — not via the un-trx-scoped repo', async () => {
    const inv = {
      id: 'inv-10',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1013,
      status: 'open',
      total: 50,
      amount_paid: 0,
      balance_due: 50,
    };
    const h = await buildCancelHarness({ linkedInvoices: [inv as any] });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'r',
        invoiceDecisions: [{ invoice_id: 'inv-10', decision: 'void_unpaid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    const auditCalls = (h.creditAuditService.record as jest.Mock).mock.calls;
    // Every call is invoked WITH a manager (second arg). Proves
    // threaded-manager use inside the orchestrator.
    expect(auditCalls.length).toBeGreaterThan(0);
    for (const call of auditCalls) {
      expect(call[1]).toBeDefined();
      expect(typeof call[1].getRepository).toBe('function');
    }
  });

  // ── J11: void_unpaid rejected when amount_paid > 0 ───────────────────
  it('J11. void_unpaid rejected when invoice has amount_paid > 0 — service-layer guard 400', async () => {
    const inv = {
      id: 'inv-11',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1014,
      status: 'paid',
      total: 100,
      amount_paid: 100,
      balance_due: 0,
    };
    const h = await buildCancelHarness({ linkedInvoices: [inv as any] });

    await expect(
      h.service.cancelJobWithFinancials(
        'tenant-1',
        'job-1',
        {
          cancellationReason: 'r',
          invoiceDecisions: [
            { invoice_id: 'inv-11', decision: 'void_unpaid' },
          ],
        },
        'u-owner',
        'owner',
        'Owner',
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^decision_invalid_for_paid_invoice:/),
    });

    expect(h.transactionCommit).not.toHaveBeenCalled();
    expect(h.txInvoiceUpdate).not.toHaveBeenCalled();
  });

  // ── J12: paid-portion decisions rejected when amount_paid == 0 ──────
  it('J12. refund_paid|credit_memo|keep_paid rejected when invoice has amount_paid == 0 — service-layer guard 400', async () => {
    const inv = {
      id: 'inv-12',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1015,
      status: 'open',
      total: 100,
      amount_paid: 0,
      balance_due: 100,
    };
    const h = await buildCancelHarness({ linkedInvoices: [inv as any] });

    await expect(
      h.service.cancelJobWithFinancials(
        'tenant-1',
        'job-1',
        {
          cancellationReason: 'r',
          invoiceDecisions: [
            { invoice_id: 'inv-12', decision: 'refund_paid' },
          ],
        },
        'u-owner',
        'owner',
        'Owner',
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^decision_invalid_for_unpaid_invoice:/),
    });

    expect(h.transactionCommit).not.toHaveBeenCalled();
    expect(h.txPaymentUpdate).not.toHaveBeenCalled();
  });

  // ── J13 (Arc J.1f-bug1): orchestrator clears assigned_driver_id ──────
  // Mirrors Arc H's CLEAR_DRIVER_TARGETS coupling for the override-status
  // path. cancelled is unconditionally a driver-clearing target. Column-
  // only update bypasses TypeORM's relation-FK reconciliation.
  it('J13. cancelJobWithFinancials clears assigned_driver_id via column-only update', async () => {
    const inv = {
      id: 'inv-13',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 10131,
      status: 'open',
      total: 500,
      amount_paid: 0,
      balance_due: 500,
    };
    const h = await buildCancelHarness({
      job: { assigned_driver_id: 'driver-1' as any },
      linkedInvoices: [inv as any],
    });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'J13 driver-clear test',
        invoiceDecisions: [{ invoice_id: 'inv-13', decision: 'void_unpaid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // Column-only update with both id + tenant_id in WHERE,
    // assigned_driver_id: null in SET. Mirrors Arc H pattern.
    expect(h.txJobUpdate).toHaveBeenCalledWith(
      { id: 'job-1', tenant_id: 'tenant-1' },
      { assigned_driver_id: null },
    );
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  it('J13b. cancelJobWithFinancials skips driver-clear when no driver was attached', async () => {
    const inv = {
      id: 'inv-13b',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 10132,
      status: 'open',
      total: 500,
      amount_paid: 0,
      balance_due: 500,
    };
    const h = await buildCancelHarness({
      // No assigned_driver_id on job.
      linkedInvoices: [inv as any],
    });

    await h.service.cancelJobWithFinancials(
      'tenant-1',
      'job-1',
      {
        cancellationReason: 'J13b no-op test',
        invoiceDecisions: [{ invoice_id: 'inv-13b', decision: 'void_unpaid' }],
      },
      'u-owner',
      'owner',
      'Owner',
    );

    // No driver was attached → no column-only update fired.
    expect(h.txJobUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assigned_driver_id: null }),
    );
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Arc J.1 — cascadeDelete smoke test (helper-extraction regression lock)
//
// cascadeDelete previously inlined invoice.update + creditMemo.save
// directly. Arc J.1 routes those writes through
// applyFinancialDecisionTx with a `credit_memo` decision and the
// `cascadeDeleteOverrideAmount` knob (which preserves "memo for full
// invoice total" semantics — different from the orchestrator's
// `credit_memo` decision, which uses amount_paid).
//
// Fix B — cascadeDelete now wraps its body in `dataSource.transaction`,
// so every read/write (including `applyFinancialDecisionTx`'s invoice
// update + credit-memo insert) goes through the trx-scoped repos. The
// smoke test below targets the trx-scoped mocks accordingly. The pre-
// Fix-B assertions on the un-trx-scoped `creditMemoRepo.save` were
// locking the bug shape verbatim (helper called with the bare
// `this.dataSource.manager`); they are correctly retargeted here.
// ──────────────────────────────────────────────────────────────────────

describe('JobsService.cascadeDelete — Arc J.1 helper-extraction smoke test', () => {
  it('void+memo path still produces voidedInvoices and creditMemos shape (memo amount = invoice total)', async () => {
    const h = await buildHarness({ status: 'pending' });

    // Single linked invoice opted into voiding via the legacy
    // `voidInvoices` opt-in array. Fix B: invoice findOne now goes
    // through the trx-scoped repo.
    h.txInvoiceFindOne.mockResolvedValue({
      id: 'inv-cd-1',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 999,
      total: 250,
      amount_paid: 0,
      balance_due: 250,
    });

    // Fix B: credit memo save runs through the trx-scoped repo because
    // `applyFinancialDecisionTx` now receives the outer TX manager.
    h.txCreditMemoSave.mockImplementation((x: any) =>
      Promise.resolve({ id: 'memo-cd-1', amount: x.amount, ...x }),
    );

    const result = await h.service.cascadeDelete(
      'tenant-1',
      'job-1',
      'u-owner',
      {
        voidInvoices: [{ invoiceId: 'inv-cd-1', void: true }],
        voidReason: 'Cancelled in test',
      },
    );

    // External shape preserved: voidedInvoices entry includes invoice_number,
    // creditMemos entry includes id + amount, and the cascadeDelete-specific
    // memo amount equals the invoice TOTAL (not amount_paid).
    expect(result.voidedInvoices).toEqual([
      { id: 'inv-cd-1', invoice_number: 999 },
    ]);
    expect(result.creditMemos).toEqual([{ id: 'memo-cd-1', amount: 250 }]);

    // Memo created via the trx-scoped repo with amount = invoice total.
    expect(h.txCreditMemoSave).toHaveBeenCalled();
    const savedMemo = h.txCreditMemoSave.mock.calls[0][0];
    expect(savedMemo.amount).toBe(250);
    expect(savedMemo.original_invoice_id).toBe('inv-cd-1');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Fix B — cascadeDelete transaction wrapper
//
// Before Fix B, cascadeDelete made 9 direct DB writes (across jobs,
// assets, task_chain_links, rental_chains) plus 1 delegated write set
// (via applyFinancialDecisionTx for invoice voids/credit memos), all
// committing independently. The PR2 incident produced 4 phantom-paid
// invoices because L1695's `UPDATE jobs SET status='cancelled'`
// committed before L1693's TypeError aborted the rest of the body.
//
// Fix B wraps the body in a single `dataSource.transaction` so every
// write commits or rolls back as a unit, and threads the outer TX
// manager into `applyFinancialDecisionTx` so its writes join the same
// transaction (was bug at pre-Fix-B L1823: passed bare
// `this.dataSource.manager` instead of the TX manager).
// ──────────────────────────────────────────────────────────────────────

describe('JobsService.cascadeDelete — Fix B (transaction wrapper)', () => {
  // Test 1 — Happy path commits all intended writes.
  it('happy path: opens one transaction, writes job cancel through trx repo, commits', async () => {
    const h = await buildHarness({
      status: 'pending',
      assigned_driver_id: undefined,
      assigned_driver: undefined,
      asset_id: undefined,
      linked_job_ids: [],
    });

    const result = await h.service.cascadeDelete(
      'tenant-1',
      'job-1',
      'u-owner',
    );

    // Exactly one transaction opened
    expect(h.transactionInvocationCount()).toBe(1);
    // Job cancel UPDATE went through the trx-scoped repo
    expect(h.txJobUpdate).toHaveBeenCalledWith(
      { id: 'job-1', tenant_id: 'tenant-1' },
      expect.objectContaining({ status: 'cancelled', cancelled_at: expect.any(Date) }),
    );
    // Outer transaction committed (callback returned successfully)
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
    expect(result.deletedTasks).toEqual([{ id: 'job-1', job_number: 'J-1' }]);
  });

  // Test 2 — Mid-body throw rolls back. THE load-bearing test.
  it('mid-body throw: applyFinancialDecisionTx error rolls back the earlier job-cancel update (commit NOT reached)', async () => {
    const h = await buildHarness({
      status: 'pending',
      assigned_driver_id: undefined,
      assigned_driver: undefined,
      asset_id: undefined,
      linked_job_ids: [],
    });

    h.txInvoiceFindOne.mockResolvedValue({
      id: 'inv-throw-1',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 1234,
      total: 500,
      amount_paid: 500,
      balance_due: 0,
    });
    // Force applyFinancialDecisionTx to throw mid-body, AFTER the job
    // cancel UPDATE has already gone through the trx-scoped repo.
    jest
      .spyOn(h.service as any, 'applyFinancialDecisionTx')
      .mockRejectedValue(new BadRequestException('payment_not_found'));

    await expect(
      h.service.cascadeDelete('tenant-1', 'job-1', 'u-owner', {
        voidInvoices: [{ invoiceId: 'inv-throw-1', void: true }],
      }),
    ).rejects.toThrow(BadRequestException);

    // Pre-throw write DID happen inside the transaction…
    expect(h.txJobUpdate).toHaveBeenCalledWith(
      { id: 'job-1', tenant_id: 'tenant-1' },
      expect.objectContaining({ status: 'cancelled' }),
    );
    // …but the transaction never committed, so Postgres rolls back the
    // job UPDATE. This is the partial-state class Fix B closes.
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // Test 3 — applyFinancialDecisionTx receives the real TX manager.
  // Locks the L1823 first-arg swap from `this.dataSource.manager` to
  // the trx manager.
  it('applyFinancialDecisionTx is called with the trx manager, NOT dataSource.manager', async () => {
    const h = await buildHarness({
      status: 'pending',
      assigned_driver_id: undefined,
      assigned_driver: undefined,
      asset_id: undefined,
      linked_job_ids: [],
    });

    h.txInvoiceFindOne.mockResolvedValue({
      id: 'inv-trx-1',
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      customer_id: 'cust-1',
      invoice_number: 555,
      total: 100,
      amount_paid: 0,
      balance_due: 100,
    });

    const helperSpy = jest
      .spyOn(h.service as any, 'applyFinancialDecisionTx')
      .mockResolvedValue({
        voided: true,
        unpaidBalanceVoided: 0,
        creditMemoId: 'memo-trx',
        creditMemoAmount: 100,
        refundIntent: null,
        auditEventType: 'cancellation_credit_memo',
        auditMetadata: {},
      });

    await h.service.cascadeDelete('tenant-1', 'job-1', 'u-owner', {
      voidInvoices: [{ invoiceId: 'inv-trx-1', void: true }],
    });

    expect(helperSpy).toHaveBeenCalledTimes(1);
    const firstArg = helperSpy.mock.calls[0][0] as any;
    // The trx manager is the EntityManager-shaped object the
    // dataSource.transaction callback received. It exposes
    // `getRepository`; the bare `dataSource.manager` is a different
    // object. Asserting `getRepository(Invoice)` returns the trx
    // invoice mock (not the un-trx invoiceRepo) proves we're holding
    // the TX manager.
    expect(typeof firstArg.getRepository).toBe('function');
    const invoiceRepoFromArg = firstArg.getRepository(Invoice);
    // The trx Invoice repo has `findOne: txInvoiceFindOne`; the
    // un-trx invoiceRepo has its own `findOne` jest.fn. They are
    // distinct object identities.
    expect(invoiceRepoFromArg.findOne).toBe(h.txInvoiceFindOne);
  });

  // Test 4 — Fix A regression coverage: options default-arg still
  // handles undefined.
  it('Fix A regression: cascadeDelete called without options does NOT throw TypeError on options.deletePickup', async () => {
    const h = await buildHarness({
      status: 'pending',
      assigned_driver_id: undefined,
      assigned_driver: undefined,
      asset_id: undefined,
      linked_job_ids: [],
    });

    // Call with no options arg at all — pre-Fix-A this threw
    // `TypeError: Cannot read properties of undefined (reading 'deletePickup')`
    // at the L1693-equivalent options.deletePickup access.
    const result = await h.service.cascadeDelete(
      'tenant-1',
      'job-1',
      'u-owner',
    );

    // No TypeError; the call completes and the transaction commits.
    expect(result.deletedTasks).toEqual([{ id: 'job-1', job_number: 'J-1' }]);
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Fix C — JobsService.create transaction wrapper
//
// Before Fix C, JobsService.create made 2 direct DB writes (jobs INSERT
// at L394 + assets UPDATE at L398 for asset reservation) plus 1
// delegated write set (createInternalInvoice at L426 — Fix-A-extended
// but called WITHOUT a manager argument, so the helper opened its own
// internal TX). A throw between the jobs INSERT and the asset UPDATE
// left an orphan job with asset_id set but the asset still 'available'
// — the partial-state class analogous to the one Fix B closed for
// cascadeDelete. A throw after a successful invoice commit left the
// invoice/Payment row durable while jobs/asset state could fail
// independently.
//
// Fix C wraps the body in a single dataSource.transaction so every
// write commits or rolls back as a unit, threads the outer manager
// through generateJobNumber + getTenantRentalDays + createInternalInvoice,
// and converts every read inside _createInTx to manager.getRepository(X)
// for read-your-writes consistency.
// ──────────────────────────────────────────────────────────────────────

describe('JobsService.create — Fix C (transaction wrapper)', () => {
  // Minimal CreateJobDto for the happy path.
  const baseDto = {
    customerId: 'cust-1',
    jobType: 'delivery' as const,
    serviceType: 'dumpster_rental',
    scheduledDate: '2026-05-01',
    serviceAddress: { street: '123 Main', city: 'Austin', state: 'TX', zip: '78701' },
    basePrice: 500,
    totalPrice: 500,
  } as any;

  // Test 1 — Happy path commits everything in one TX.
  it('happy path: opens one transaction, jobs INSERT goes through trx repo, commits', async () => {
    const h = await buildHarness();
    h.billingService.hasInvoice = jest.fn().mockResolvedValue(false);
    h.billingService.createInternalInvoice = jest
      .fn()
      .mockResolvedValue({ id: 'inv-fixC-1' });

    const result = await h.service.create('tenant-1', baseDto);

    // Exactly one transaction opened
    expect(h.transactionInvocationCount()).toBe(1);
    // jobs INSERT went through the trx-scoped Job repo (txJobSaveSpy
    // is the entity-without-id branch in the trxJob.save dispatcher)
    expect(h.txJobSaveSpy).toHaveBeenCalled();
    // Outer transaction committed (callback returned successfully)
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
    // Returned the saved job
    expect(result).toEqual(expect.objectContaining({ id: 'mock-job-id' }));
  });

  // Test 2 — Asset reservation throw rolls back prior jobs INSERT (load-bearing).
  it('mid-body throw: assetRepo.update error rolls back the earlier jobs INSERT (commit NOT reached)', async () => {
    const h = await buildHarness();
    // Pre-TX validation needs to see the asset (otherwise it throws
    // NotFoundException before the TX opens — that's the wrong code
    // path to test). Stub the bare assetRepo.findOne to return a valid
    // tenant-scoped asset so we proceed into _createInTx.
    h.billingService.hasInvoice = jest.fn().mockResolvedValue(false);
    h.billingService.createInternalInvoice = jest.fn();
    (h as any).assetRepo = (h as any).assetRepo ?? {};
    // Note: harness exposes the bare assetRepo via the shared `assetRepo`
    // mock used at module-init time. Configure findOne directly.
    const buildHarnessThis = h as any;
    buildHarnessThis.assetRepo = buildHarnessThis.assetRepo;
    // Use the module's bare assetRepo (it's the one wired into
    // JobsService at construction). Reach in via the harness's
    // `service` to find it isn't trivial; instead mock the asset
    // existence check by using assignedDriverId path that doesn't need
    // pre-TX validation. Drop assetId so pre-TX validation skips, then
    // simulate the in-TX assetRepo.update by setting savedJob.asset_id
    // via the txJobSaveSpy override.
    h.txJobSaveSpy.mockImplementationOnce(async (x: any) =>
      Promise.resolve({ id: 'mock-job-id', ...x, asset_id: 'asset-1' }),
    );
    // Force the trx-scoped asset reservation UPDATE to throw mid-call
    // AFTER the trx-scoped jobs INSERT has already gone through.
    h.txAssetUpdate.mockRejectedValueOnce(
      new Error('asset_update_db_error_simulated'),
    );

    // No assetId in DTO → pre-TX validation skipped. Inside _createInTx,
    // the jobs INSERT uses the txJobSaveSpy override which simulates a
    // saved job WITH asset_id, triggering the asset reservation branch
    // that calls assetRepo.update (trx-scoped) → throws.
    await expect(
      h.service.create('tenant-1', baseDto),
    ).rejects.toThrow('asset_update_db_error_simulated');

    // Pre-throw write DID happen inside the transaction…
    expect(h.txJobSaveSpy).toHaveBeenCalled();
    // …but the transaction never committed, so Postgres rolls back the
    // jobs INSERT. This is the partial-state class Fix C closes.
    expect(h.transactionCommit).not.toHaveBeenCalled();
    // The Fix-B-untouched behavior: the auto-invoice path was never
    // reached because assetRepo.update threw before it.
    expect(h.billingService.createInternalInvoice).not.toHaveBeenCalled();
  });

  // Test 3 — createInternalInvoice receives the trx manager, NOT bare
  // dataSource.manager. Locks the L426 third-arg swap against future regression.
  it('createInternalInvoice is called with the trx manager (not dataSource.manager)', async () => {
    const h = await buildHarness();
    h.billingService.hasInvoice = jest.fn().mockResolvedValue(false);
    const helperSpy = jest
      .fn()
      .mockResolvedValue({ id: 'inv-fixC-3' });
    h.billingService.createInternalInvoice = helperSpy;

    await h.service.create('tenant-1', baseDto);

    expect(helperSpy).toHaveBeenCalledTimes(1);
    // Three positional args: tenantId, params, manager.
    const [arg0, arg1, arg2] = helperSpy.mock.calls[0];
    expect(arg0).toBe('tenant-1');
    expect(arg1).toEqual(
      expect.objectContaining({ status: 'paid', source: 'booking' }),
    );
    // The third arg is the trx manager — exposes getRepository, and
    // calling getRepository(Invoice) returns the Fix-B-wired trx
    // invoice mock (txInvoiceFindOne identity), proving we're holding
    // the TX manager and not the bare dataSource.manager.
    expect(typeof (arg2 as any).getRepository).toBe('function');
    const invoiceRepoFromArg = (arg2 as any).getRepository(Invoice);
    expect(invoiceRepoFromArg.findOne).toBe(h.txInvoiceFindOne);
  });

  // Test 4 — Public signature unchanged. No `manager?` fan-out.
  it('public create signature: 2 declared params (tenantId, dto), no optional manager', async () => {
    const h = await buildHarness();
    h.billingService.hasInvoice = jest.fn().mockResolvedValue(false);
    h.billingService.createInternalInvoice = jest
      .fn()
      .mockResolvedValue({ id: 'inv-fixC-4' });

    // Function.length counts non-default, non-rest params before the
    // first param with a default value. Public create has exactly 2.
    expect(h.service.create.length).toBe(2);

    // Calling with exactly 2 args works (no missing-arg error).
    await expect(h.service.create('tenant-1', baseDto)).resolves.toBeDefined();
  });
});
