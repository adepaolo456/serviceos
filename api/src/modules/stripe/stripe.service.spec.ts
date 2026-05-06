/**
 * Arc K Phase 1A Step 0 — Stripe PaymentIntent metadata enrichment.
 *
 * Three tests verify the contract that PI metadata carries tenantId at
 * creation time, and that the payment_intent.payment_failed webhook
 * handler resolves tenantId via metadata-first / invoice-fallback.
 *
 *   #1 chargeInvoice puts tenantId in pi.metadata
 *   #2 webhook payment_intent.payment_failed prefers pi.metadata.tenantId
 *   #3 webhook payment_intent.payment_failed falls back to invoice.tenant_id when metadata.tenantId is absent (legacy PIs)
 *
 * The metadata-first resolution is the foundation for Sentry tenant
 * tagging wired in Step 2 — it lets the webhook handler tag events
 * without an extra DB round-trip on PIs created since Step 0.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { StripeService } from './stripe.service';
import { InvoiceService } from '../billing/services/invoice.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';
import { StripeEvent } from './entities/stripe-event.entity';

interface Harness {
  service: StripeService;
  invoiceRepo: { findOne: jest.Mock; update: jest.Mock };
  paymentRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  notifRepo: { save: jest.Mock; create: jest.Mock };
  customerRepo: { findOne: jest.Mock; update: jest.Mock };
  tenantRepo: { findOne: jest.Mock; update: jest.Mock };
  // PR-C2-pre — stripeEventRepo uses createQueryBuilder().insert()...
  // chain. Tests control execute() return per-case via stripeEventQb.
  stripeEventRepo: { createQueryBuilder: jest.Mock };
  stripeEventQb: {
    insert: jest.Mock;
    into: jest.Mock;
    values: jest.Mock;
    orIgnore: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };
  stripeMock: {
    paymentIntents: { create: jest.Mock };
    paymentMethods: { list: jest.Mock };
    refunds: { create: jest.Mock };
    customers: { create: jest.Mock };
    subscriptions: { create: jest.Mock };
    webhooks: { constructEvent: jest.Mock };
  };
  // PR-C1c — InvoiceService.reconcileBalance / isFullyRefunded are the
  // canonical writer + helper Sites 1 + 2 now call. Tests assert the
  // call shape; the helper bodies are independently tested in
  // invoice.service.spec.ts (PR-C1c-pre).
  invoiceService: {
    reconcileBalance: jest.Mock;
    isFullyRefunded: jest.Mock;
  };
  logPaymentFailedAlertSpy: jest.SpyInstance;
}

async function buildHarness(): Promise<Harness> {
  const stubRepo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn().mockImplementation((x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
  });

  const invoiceRepo = stubRepo();
  const paymentRepo = stubRepo();
  const notifRepo = stubRepo();
  const customerRepo = stubRepo();
  const tenantRepo = stubRepo();
  const planRepo = stubRepo();

  // PR-C2-pre — stripeEventRepo for webhook event-id dedup. Default
  // execute() = first-occurrence (raw + identifiers populated). Tests
  // override per-case via stripeEventQb.execute.mockResolvedValueOnce().
  const stripeEventQb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({
      raw: [{ id: 'evt-row-uuid' }],
      identifiers: [{ id: 'evt-row-uuid' }],
      generatedMaps: [],
    }),
  };
  const stripeEventRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(stripeEventQb),
  };

  const dataSource = {
    query: jest.fn().mockResolvedValue([{ cnt: '0' }]),
  };

  // PR-C1c — InvoiceService mock. Default: isFullyRefunded → false
  // (partial-refund path). Tests override per-case.
  const invoiceService = {
    reconcileBalance: jest.fn().mockResolvedValue(undefined),
    isFullyRefunded: jest.fn().mockResolvedValue(false),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StripeService,
      { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
      { provide: getRepositoryToken(Customer), useValue: customerRepo },
      { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
      { provide: getRepositoryToken(Payment), useValue: paymentRepo },
      { provide: getRepositoryToken(Notification), useValue: notifRepo },
      { provide: getRepositoryToken(SubscriptionPlan), useValue: planRepo },
      { provide: getRepositoryToken(StripeEvent), useValue: stripeEventRepo },
      { provide: DataSource, useValue: dataSource },
      { provide: InvoiceService, useValue: invoiceService },
    ],
  }).compile();

  const service = module.get(StripeService);

  // Replace the internal Stripe client with a mock — the real client is
  // instantiated in the constructor with a placeholder API key. We only
  // mock the methods exercised by the tests in this file.
  const stripeMock = {
    paymentIntents: { create: jest.fn() },
    paymentMethods: { list: jest.fn() },
    refunds: { create: jest.fn() },
    customers: { create: jest.fn() },
    subscriptions: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  };
  (service as any).stripe = stripeMock;

  // Spy on the private logPaymentFailedAlert so tests can assert it's
  // called with the expected tenantId without exercising its DB logic.
  const logPaymentFailedAlertSpy = jest
    .spyOn(service as any, 'logPaymentFailedAlert')
    .mockResolvedValue(undefined);

  return {
    service,
    invoiceRepo: invoiceRepo as any,
    paymentRepo: paymentRepo as any,
    notifRepo: notifRepo as any,
    customerRepo: customerRepo as any,
    tenantRepo: tenantRepo as any,
    stripeEventRepo: stripeEventRepo as any,
    stripeEventQb: stripeEventQb as any,
    stripeMock,
    invoiceService,
    logPaymentFailedAlertSpy,
  };
}

describe('StripeService — Arc K Phase 1A Step 0 (PI metadata.tenantId)', () => {
  beforeEach(() => {
    // Ensure no STRIPE_WEBHOOK_SECRET is set so handleWebhook takes the
    // dev-mode JSON.parse branch (skipping signature verification — we're
    // testing the post-verification handler logic).
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  // ── #1 chargeInvoice puts tenantId in pi.metadata ────────────────────
  it('1. chargeInvoice — paymentIntents.create is called with metadata.tenantId === invoice.tenant_id', async () => {
    const h = await buildHarness();
    const TENANT = 'tenant-A';
    const INVOICE_ID = 'inv-1';

    h.invoiceRepo.findOne.mockResolvedValue({
      id: INVOICE_ID,
      tenant_id: TENANT,
      customer_id: 'cust-1',
      status: 'open',
      balance_due: '100.00',
      total: '100.00',
      job_id: 'job-1',
    });
    h.customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      tenant_id: TENANT,
      stripe_customer_id: 'cus_existing',
    });
    h.tenantRepo.findOne.mockResolvedValue({ id: TENANT, stripe_connect_id: null });
    h.paymentRepo.find.mockResolvedValue([]);
    h.stripeMock.paymentMethods.list.mockResolvedValue({
      data: [{ id: 'pm_1', card: { last4: '4242' } }],
    });
    h.stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_test_1' });

    await h.service.chargeInvoice(TENANT, INVOICE_ID);

    expect(h.stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [piArgs] = h.stripeMock.paymentIntents.create.mock.calls[0];
    expect(piArgs.metadata).toEqual(
      expect.objectContaining({
        invoiceId: INVOICE_ID,
        tenantId: TENANT,
      }),
    );
  });

  // ── #2 webhook prefers metadata.tenantId ─────────────────────────────
  it('2. handleWebhook payment_intent.payment_failed — prefers pi.metadata.tenantId when present', async () => {
    const h = await buildHarness();
    const METADATA_TENANT = 'tenant-from-metadata';
    const INVOICE_TENANT = 'tenant-from-invoice';

    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-1',
      tenant_id: INVOICE_TENANT,
    });

    const event = {
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          metadata: { invoiceId: 'inv-1', tenantId: METADATA_TENANT },
          last_payment_error: { message: 'card_declined' },
        },
      },
    };
    const payload = Buffer.from(JSON.stringify(event));

    await h.service.handleWebhook(payload, 'sig-not-checked-in-dev-mode');

    expect(h.logPaymentFailedAlertSpy).toHaveBeenCalledTimes(1);
    expect(h.logPaymentFailedAlertSpy).toHaveBeenCalledWith(
      METADATA_TENANT,
      'inv-1',
      'card_declined',
    );
    // Defensive: confirm the invoice tenant_id was NOT used.
    expect(h.logPaymentFailedAlertSpy).not.toHaveBeenCalledWith(
      INVOICE_TENANT,
      expect.anything(),
      expect.anything(),
    );
  });

  // ── #3 webhook falls back to invoice.tenant_id when metadata absent ──
  it('3. handleWebhook payment_intent.payment_failed — falls back to invoice.tenant_id for legacy PIs', async () => {
    const h = await buildHarness();
    const INVOICE_TENANT = 'legacy-pi-invoice-tenant';

    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-legacy',
      tenant_id: INVOICE_TENANT,
    });

    // Legacy PI: metadata has no tenantId field.
    const event = {
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          metadata: { invoiceId: 'inv-legacy' },
          last_payment_error: { message: 'insufficient_funds' },
        },
      },
    };
    const payload = Buffer.from(JSON.stringify(event));

    await h.service.handleWebhook(payload, 'sig-not-checked-in-dev-mode');

    expect(h.logPaymentFailedAlertSpy).toHaveBeenCalledTimes(1);
    expect(h.logPaymentFailedAlertSpy).toHaveBeenCalledWith(
      INVOICE_TENANT,
      'inv-legacy',
      'insufficient_funds',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// PR-C1b-1 — Stripe outbound idempotency keys for 4 P0 write sites
//
// Closes the Stripe provider-level retry duplicate-money-movement gap
// flagged by PR #13 (PR-C audit) and reframed by the PR-C1b audit
// (docs/audits/2026-04-30-stripe-idempotency-audit.md). Every P0 site
// now passes a deterministic idempotency key derived from already-
// persisted DB identifiers, with non-prod env prefix to avoid Stripe
// sandbox cache contamination across test runs.
// ──────────────────────────────────────────────────────────────────────
describe('StripeService — PR-C1b-1 idempotency keys', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_GIT_SHA = process.env.GIT_SHA;
  const ORIGINAL_VERCEL_SHA = process.env.VERCEL_GIT_COMMIT_SHA;

  beforeEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    // Deterministic env so the helper produces a fixed prefix:
    // expected key = `test-abcdef12-${parts.join(':')}`.
    process.env.NODE_ENV = 'test';
    process.env.GIT_SHA = 'abcdef12';
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
    if (ORIGINAL_GIT_SHA === undefined) {
      delete process.env.GIT_SHA;
    } else {
      process.env.GIT_SHA = ORIGINAL_GIT_SHA;
    }
    if (ORIGINAL_VERCEL_SHA !== undefined) {
      process.env.VERCEL_GIT_COMMIT_SHA = ORIGINAL_VERCEL_SHA;
    }
  });

  // ── Test 1 — Site 3 chargeInvoice ────────────────────────────────────
  it('1. chargeInvoice — paymentIntents.create receives idempotencyKey "tenant-{t}:charge:invoice-{i}:balance-{cents}"', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-3',
      tenant_id: 't-1',
      customer_id: 'cust-3',
      status: 'open',
      balance_due: '100.00',
      total: '100.00',
      job_id: 'job-3',
    });
    h.customerRepo.findOne.mockResolvedValue({
      id: 'cust-3',
      tenant_id: 't-1',
      stripe_customer_id: 'cus_existing',
    });
    h.tenantRepo.findOne.mockResolvedValue({ id: 't-1', stripe_connect_id: null });
    h.paymentRepo.find.mockResolvedValue([]);
    h.stripeMock.paymentMethods.list.mockResolvedValue({
      data: [{ id: 'pm_1', card: { last4: '4242' } }],
    });
    h.stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_test_1' });

    await h.service.chargeInvoice('t-1', 'inv-3');

    expect(h.stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [, options] = h.stripeMock.paymentIntents.create.mock.calls[0];
    expect(options).toEqual(
      expect.objectContaining({
        idempotencyKey: 'test-abcdef12-tenant-t-1:charge:invoice-inv-3:balance-10000',
      }),
    );
  });

  // ── Test 2 — Site 2 refundInvoice (full refund, no prior) ────────────
  it('2. refundInvoice (full refund, no prior) — refunds.create receives idempotencyKey with "cumulative-0-{cents}"', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-2',
      tenant_id: 't-1',
      total: '150.00',
      job_id: 'job-2',
    });
    h.paymentRepo.findOne.mockResolvedValue({
      id: 'pay-2',
      invoice_id: 'inv-2',
      stripe_payment_intent_id: 'pi_existing',
      refunded_amount: 0,
    });
    h.tenantRepo.findOne.mockResolvedValue({ id: 't-1', stripe_connect_id: null });
    h.stripeMock.refunds.create.mockResolvedValue({ id: 're_test_2', amount: 15000 });
    h.paymentRepo.find.mockResolvedValue([]);

    await h.service.refundInvoice('t-1', 'inv-2');

    expect(h.stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    const [, options] = h.stripeMock.refunds.create.mock.calls[0];
    expect(options).toEqual(
      expect.objectContaining({
        idempotencyKey:
          'test-abcdef12-tenant-t-1:refund:invoice-inv-2:payment-pay-2:cumulative-0-15000',
      }),
    );
  });

  // ── Test 3 — Site 2 refundInvoice (partial on top of prior partial) ──
  it('3. refundInvoice (partial on top of prior $50) — cumulative reflects payment.refunded_amount snapshot', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-2',
      tenant_id: 't-1',
      total: '150.00',
      job_id: 'job-2',
    });
    h.paymentRepo.findOne.mockResolvedValue({
      id: 'pay-2',
      invoice_id: 'inv-2',
      stripe_payment_intent_id: 'pi_existing',
      refunded_amount: '50.00', // prior partial already applied
    });
    h.tenantRepo.findOne.mockResolvedValue({ id: 't-1', stripe_connect_id: null });
    h.stripeMock.refunds.create.mockResolvedValue({ id: 're_test_3', amount: 5000 });
    h.paymentRepo.find.mockResolvedValue([]);

    await h.service.refundInvoice('t-1', 'inv-2', 50);

    const [, options] = h.stripeMock.refunds.create.mock.calls[0];
    expect(options).toEqual(
      expect.objectContaining({
        idempotencyKey:
          'test-abcdef12-tenant-t-1:refund:invoice-inv-2:payment-pay-2:cumulative-5000-5000',
      }),
    );
  });

  // ── Test 4 — Site 4 subscribe ────────────────────────────────────────
  it('4. subscribe — subscriptions.create receives idempotencyKey "tenant-{t}:subscribe:tier-{tier}:cycle-{cycle}"', async () => {
    const h = await buildHarness();
    h.tenantRepo.findOne.mockResolvedValue({
      id: 't-1',
      name: 'Acme',
      peak_driver_count: 5,
      stripe_customer_id: 'cus_existing',
    });
    // SubscriptionPlan repo lookup
    const planRepo = (h.service as any).planRepo;
    planRepo.findOne = jest.fn().mockResolvedValue({
      tier: 'pro',
      is_active: true,
      stripe_price_id_monthly: 'price_monthly_pro',
      stripe_price_id_annual: 'price_annual_pro',
      enabled_modules: { dispatch: true },
    });
    h.stripeMock.subscriptions.create.mockResolvedValue({ id: 'sub_test' });

    await h.service.subscribe('t-1', 'pro', 'monthly');

    expect(h.stripeMock.subscriptions.create).toHaveBeenCalledTimes(1);
    const [, options] = h.stripeMock.subscriptions.create.mock.calls[0];
    expect(options).toEqual(
      expect.objectContaining({
        idempotencyKey: 'test-abcdef12-tenant-t-1:subscribe:tier-pro:cycle-monthly',
      }),
    );
  });

  // ── Test 5 — StripeIdempotencyError surfaces with logging, no DB writes ──
  it('5. StripeIdempotencyError on refunds.create surfaces to caller, logs key+method+tenantId+payloadKeys, no DB writes after throw', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-2',
      tenant_id: 't-1',
      total: '150.00',
      job_id: 'job-2',
    });
    h.paymentRepo.findOne.mockResolvedValue({
      id: 'pay-2',
      invoice_id: 'inv-2',
      stripe_payment_intent_id: 'pi_existing',
      refunded_amount: 0,
    });
    h.tenantRepo.findOne.mockResolvedValue({ id: 't-1', stripe_connect_id: null });

    const idempotencyError = Object.assign(new Error('conflict'), {
      type: 'StripeIdempotencyError',
    });
    h.stripeMock.refunds.create.mockRejectedValue(idempotencyError);

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(h.service.refundInvoice('t-1', 'inv-2')).rejects.toThrow(
      'conflict',
    );

    // Surfaced log fired with the expected shape.
    expect(errSpy).toHaveBeenCalledWith(
      '[stripe-idempotency] Conflict on key reuse with different payload',
      expect.objectContaining({
        idempotencyKey:
          'test-abcdef12-tenant-t-1:refund:invoice-inv-2:payment-pay-2:cumulative-0-15000',
        method: 'refunds.create',
        tenantId: 't-1',
        payloadKeys: expect.arrayContaining([
          'payment_intent',
          'metadata',
        ]),
      }),
    );

    // No DB writes after the Stripe throw.
    expect(h.paymentRepo.save).not.toHaveBeenCalled();
    expect(h.invoiceRepo.update).not.toHaveBeenCalled();
    expect(h.notifRepo.save).not.toHaveBeenCalled();
    // PR-C1c — canonical writer also not invoked when Stripe rejects.
    // (Vacuously true post-PR-C1c since chargeInvoice/refundInvoice no
    // longer reach reconcileBalance on error, but worth pinning.)
    expect(h.invoiceService.reconcileBalance).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });
});

// ──────────────────────────────────────────────────────────────────────
// PR-C1c — Sites 1 + 2 sync bypass replacements
//
// Closes the synchronous half of the reconcileBalance() bypass arc
// (PR #19 audit, docs/audits/2026-04-30-reconcilebalance-bypass-audit.md).
// chargeInvoice and refundInvoice no longer write invoice columns
// directly; they call the canonical InvoiceService.reconcileBalance()
// (PR-C1c-pre, PR #20). refundInvoice additionally stamps voided_at
// before reconcileBalance when isFullyRefunded() is true, so the
// canonical writer's voided_at-keyed branch produces 'voided' status.
//
// Sites 3 + 4 (webhook handlers) remain bypassed pending PR-C2's
// stripe_events event-id dedup table.
// ──────────────────────────────────────────────────────────────────────
describe('StripeService — PR-C1c sync bypass replacements (Sites 1 + 2)', () => {
  beforeEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.GIT_SHA = 'abcdef12';
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  // ── Site 1 — chargeInvoice success calls reconcileBalance ────────────
  it('1. chargeInvoice success — invoiceService.reconcileBalance called once with invoiceId; no direct invoiceRepo.update for amount_paid/balance_due/status', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-1',
      tenant_id: 't-1',
      customer_id: 'cust-1',
      status: 'open',
      balance_due: '100.00',
      total: '100.00',
      job_id: 'job-1',
    });
    h.customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      tenant_id: 't-1',
      stripe_customer_id: 'cus_existing',
    });
    h.tenantRepo.findOne.mockResolvedValue({ id: 't-1', stripe_connect_id: null });
    h.paymentRepo.find.mockResolvedValue([]);
    h.stripeMock.paymentMethods.list.mockResolvedValue({
      data: [{ id: 'pm_1', card: { last4: '4242' } }],
    });
    h.stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_test_1' });

    await h.service.chargeInvoice('t-1', 'inv-1');

    // Canonical writer was invoked exactly once with the invoiceId.
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledTimes(1);
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledWith('inv-1');
    // The bypass shape (writing amount_paid/balance_due/status directly)
    // is gone — the only invoiceRepo.update path remaining for refunds is
    // the voided_at stamp, which chargeInvoice never invokes.
    expect(h.invoiceRepo.update).not.toHaveBeenCalled();
  });

  // ── Site 2 — refundInvoice partial refund: no voided_at stamp ────────
  it('2. refundInvoice partial — isFullyRefunded=false; NO voided_at stamp; reconcileBalance called', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-2',
      tenant_id: 't-1',
      total: '150.00',
      job_id: 'job-2',
    });
    h.paymentRepo.findOne.mockResolvedValue({
      id: 'pay-2',
      invoice_id: 'inv-2',
      stripe_payment_intent_id: 'pi_existing',
      refunded_amount: 0,
    });
    h.tenantRepo.findOne.mockResolvedValue({ id: 't-1', stripe_connect_id: null });
    h.stripeMock.refunds.create.mockResolvedValue({ id: 're_test', amount: 5000 });
    h.paymentRepo.find.mockResolvedValue([]);
    // Default isFullyRefunded mock returns false → partial-refund path.
    h.invoiceService.isFullyRefunded.mockResolvedValue(false);

    await h.service.refundInvoice('t-1', 'inv-2', 50);

    expect(h.invoiceService.isFullyRefunded).toHaveBeenCalledTimes(1);
    expect(h.invoiceService.isFullyRefunded).toHaveBeenCalledWith('inv-2');
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledTimes(1);
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledWith('inv-2');
    // No voided_at stamp on partial — the only invoiceRepo.update path
    // in refundInvoice (voided_at) was NOT triggered.
    expect(h.invoiceRepo.update).not.toHaveBeenCalled();
  });

  // ── Site 2 — refundInvoice full refund: voided_at stamped first ──────
  it('3. refundInvoice full refund — isFullyRefunded=true; invoiceRepo.update({voided_at:Date}) BEFORE reconcileBalance', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-3',
      tenant_id: 't-1',
      total: '100.00',
      job_id: 'job-3',
    });
    h.paymentRepo.findOne.mockResolvedValue({
      id: 'pay-3',
      invoice_id: 'inv-3',
      stripe_payment_intent_id: 'pi_existing',
      refunded_amount: 0,
    });
    h.tenantRepo.findOne.mockResolvedValue({ id: 't-1', stripe_connect_id: null });
    h.stripeMock.refunds.create.mockResolvedValue({ id: 're_test', amount: 10000 });
    h.paymentRepo.find.mockResolvedValue([]);
    // Full refund path → helper returns true.
    h.invoiceService.isFullyRefunded.mockResolvedValue(true);

    await h.service.refundInvoice('t-1', 'inv-3');

    // 1. isFullyRefunded called.
    expect(h.invoiceService.isFullyRefunded).toHaveBeenCalledTimes(1);
    expect(h.invoiceService.isFullyRefunded).toHaveBeenCalledWith('inv-3');
    // 2. voided_at stamped on the invoice row.
    expect(h.invoiceRepo.update).toHaveBeenCalledTimes(1);
    expect(h.invoiceRepo.update).toHaveBeenCalledWith(
      'inv-3',
      expect.objectContaining({ voided_at: expect.any(Date) }),
    );
    // 3. reconcileBalance called.
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledTimes(1);
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledWith('inv-3');
    // Ordering: voided_at stamp must precede reconcileBalance so the
    // canonical writer's voided_at-keyed branch produces 'voided' status.
    const stampOrder = h.invoiceRepo.update.mock.invocationCallOrder[0];
    const reconcileOrder = h.invoiceService.reconcileBalance.mock.invocationCallOrder[0];
    expect(stampOrder).toBeLessThan(reconcileOrder);
  });
});

// ── PR-C2-pre — webhook event-id dedup ────────────────────────────────────
//
// Tests verify the dedup block at handleWebhook entry point. Per audit D-3,
// dedup happens AFTER signature verify and BEFORE the switch — duplicate
// events return early without reaching any case handler.
//
// Test 0: InsertResult shape pin-down — handler treats `raw` and/or
//         `identifiers` populated as inserted=true; both empty as duplicate.
//         If TypeORM upgrade changes shape, this test breaks before
//         production silently regresses.
// Test 1: First-occurrence event processed (handler runs).
// Test 2: Duplicate dropped at entry point (handler skipped + warn log).
// Test 3: account.updated with NULL tenant_id accepted (D-1 best-effort).
// Test 4: Same event_id, different tenants → distinct (compound index keys).
// Test 5: Signature failure prevents dedup INSERT (denial-of-webhook prevention).
// Test 6: Money event with no derivable tenant_id throws (locked Option A).

describe('StripeService — PR-C2-pre webhook event dedup', () => {
  beforeEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  // ── #0 InsertResult shape pin-down ──────────────────────────────────
  it('handler proceeds when raw is populated; returns early when both raw and identifiers empty', async () => {
    const h = await buildHarness();

    // First call: raw populated, identifiers empty → inserted=true → handler runs
    h.stripeEventQb.execute.mockResolvedValueOnce({
      raw: [{ id: 'evt-row-uuid' }],
      identifiers: [],
      generatedMaps: [],
    });

    const event1 = {
      id: 'evt_first',
      type: 'account.updated',
      data: { object: { id: 'acct_a', charges_enabled: true, payouts_enabled: true } },
    };
    await h.service.handleWebhook(Buffer.from(JSON.stringify(event1)), 'sig');
    expect(h.tenantRepo.update).toHaveBeenCalledTimes(1);

    // Second call: both raw and identifiers empty → inserted=false → handler skipped
    h.tenantRepo.update.mockClear();
    h.stripeEventQb.execute.mockResolvedValueOnce({
      raw: [],
      identifiers: [],
      generatedMaps: [],
    });

    const event2 = {
      id: 'evt_dup',
      type: 'account.updated',
      data: { object: { id: 'acct_b', charges_enabled: true, payouts_enabled: true } },
    };
    await h.service.handleWebhook(Buffer.from(JSON.stringify(event2)), 'sig');
    expect(h.tenantRepo.update).not.toHaveBeenCalled();
  });

  // ── #1 First-occurrence event is processed ────────────────────────────
  it('processes a new webhook event end-to-end', async () => {
    const h = await buildHarness();
    h.stripeEventQb.execute.mockResolvedValueOnce({
      raw: [{ id: 'evt-row' }],
      identifiers: [{ id: 'evt-row' }],
      generatedMaps: [],
    });

    const event = {
      id: 'evt_new',
      type: 'account.updated',
      data: { object: { id: 'acct_x', charges_enabled: true, payouts_enabled: true } },
    };
    const result = await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    // Dedup INSERT was attempted with correct values
    expect(h.stripeEventQb.values).toHaveBeenCalledWith({
      event_id: 'evt_new',
      event_type: 'account.updated',
      tenant_id: null, // account.updated → null per D-1
    });
    // Handler ran (account.updated case → tenantRepo.update)
    expect(h.tenantRepo.update).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ received: true });
  });

  // ── #2 Duplicate dropped at entry point ───────────────────────────────
  it('drops duplicate webhook events at entry point with warn log', async () => {
    const h = await buildHarness();
    // CONFLICT: both raw and identifiers empty
    h.stripeEventQb.execute.mockResolvedValueOnce({
      raw: [],
      identifiers: [],
      generatedMaps: [],
    });
    const loggerSpy = jest.spyOn((h.service as any).logger, 'warn');

    const event = {
      id: 'evt_dup',
      type: 'account.updated',
      data: { object: { id: 'acct_y', charges_enabled: true, payouts_enabled: true } },
    };
    const result = await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    // Handler did NOT run
    expect(h.tenantRepo.update).not.toHaveBeenCalled();
    // Warn log emitted with event.id + event.type
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate webhook event ignored: evt_dup (account.updated)'),
    );
    // Still returns receipt to Stripe (200) so it doesn't retry forever
    expect(result).toEqual({ received: true });
  });

  // ── #3 account.updated with NULL tenant_id accepted ───────────────────
  it('handles account.updated events with null tenant_id (D-1 best-effort)', async () => {
    const h = await buildHarness();
    h.stripeEventQb.execute.mockResolvedValueOnce({
      raw: [{ id: 'evt-row' }],
      identifiers: [{ id: 'evt-row' }],
      generatedMaps: [],
    });

    const event = {
      id: 'evt_acct',
      type: 'account.updated',
      data: { object: { id: 'acct_z', charges_enabled: true, payouts_enabled: true } },
    };
    await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    // Dedup row tenant_id = null (per D-1 — Connect events have no payload tenant)
    expect(h.stripeEventQb.values).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: null }),
    );
    // Handler proceeds (account update applied)
    expect(h.tenantRepo.update).toHaveBeenCalledTimes(1);
  });

  // ── #4 Same event_id, different tenants → distinct ────────────────────
  it('treats same event_id with different tenant_ids as distinct dedup rows', async () => {
    const h = await buildHarness();
    // Mock can't enforce uniqueness — that's PG's job. Here we verify the
    // implementation passes the correct tenant_id per event without caching
    // the first call's value.
    h.stripeEventQb.execute.mockResolvedValue({
      raw: [{ id: 'evt-row' }],
      identifiers: [{ id: 'evt-row' }],
      generatedMaps: [],
    });

    const event1 = {
      id: 'evt_shared_id',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_1',
          metadata: { tenantId: 'tenant_A', invoiceId: 'inv_a' },
          last_payment_error: { message: 'card declined' },
        },
      },
    };
    const event2 = {
      id: 'evt_shared_id',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_2',
          metadata: { tenantId: 'tenant_B', invoiceId: 'inv_b' },
          last_payment_error: { message: 'card declined' },
        },
      },
    };
    h.invoiceRepo.findOne.mockResolvedValue({ id: 'inv_a', tenant_id: 'tenant_A' });

    await h.service.handleWebhook(Buffer.from(JSON.stringify(event1)), 'sig');
    await h.service.handleWebhook(Buffer.from(JSON.stringify(event2)), 'sig');

    // Both inserts attempted with different tenant_ids
    const valuesCalls = h.stripeEventQb.values.mock.calls;
    expect(valuesCalls).toHaveLength(2);
    expect(valuesCalls[0][0]).toEqual(
      expect.objectContaining({ event_id: 'evt_shared_id', tenant_id: 'tenant_A' }),
    );
    expect(valuesCalls[1][0]).toEqual(
      expect.objectContaining({ event_id: 'evt_shared_id', tenant_id: 'tenant_B' }),
    );
  });

  // ── #5 Signature failure prevents dedup INSERT (CRITICAL) ─────────────
  it('rejects bad signature before dedup INSERT runs (denial-of-webhook prevention)', async () => {
    const h = await buildHarness();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    h.stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    await expect(
      h.service.handleWebhook(Buffer.from('{}'), 'bad_sig'),
    ).rejects.toThrow(/Invalid webhook signature/);

    // CRITICAL: dedup INSERT must NOT have run. If it did, an attacker could
    // pollute stripe_events with junk event_ids to make real events drop.
    expect(h.stripeEventRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  // ── #6 Money event with no derivable tenant_id throws ────────────────
  it('throws on payment_intent.succeeded with no derivable tenant_id (locked Option A)', async () => {
    const h = await buildHarness();
    // Empty metadata: no tenantId, no invoiceId — orphan PI
    const event = {
      id: 'evt_orphan_pi',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_orphan', metadata: {} } },
    };

    await expect(
      h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig'),
    ).rejects.toThrow(/Cannot resolve tenant for payment_intent\.succeeded/);

    // CRITICAL: throw happens BEFORE dedup INSERT — no row written, Stripe
    // will retry, error surfaces in Sentry.
    expect(h.stripeEventRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

// ── arcV Phase 2 — Site 3 (payment_intent.succeeded → reconcileBalance) ──────
//
// Three tests covering the Site 3 webhook handler bypass replacement.
// Sites 3 + 4 ship together per audit safety rule (partial conversion would
// unmask the duplicate-payment bug rather than fix it); commits are split
// for review-time clarity but merge atomically.

describe('StripeService — arcV Phase 2 Site 3 (payment_intent.succeeded → reconcileBalance)', () => {
  beforeEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  // Case 1 — happy path: bypass replaced by reconcileBalance
  it('1. payment_intent.succeeded — invoiceService.reconcileBalance called once with pi.metadata.invoiceId; no direct invoiceRepo.update', async () => {
    const h = await buildHarness();
    const event = {
      id: 'evt_arcv_p2_site3_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_arcv_p2_1',
          metadata: { tenantId: 't-1', invoiceId: 'inv-1' },
        },
      },
    };

    await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledTimes(1);
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledWith('inv-1');
    // Bypass shape is gone: no direct invoiceRepo.update for money columns.
    expect(h.invoiceRepo.update).not.toHaveBeenCalled();
  });

  // Case 2 — defensive no-op when invoiceId metadata is absent
  it('2. payment_intent.succeeded — handler no-ops when pi.metadata.invoiceId is missing (reconcileBalance NOT called)', async () => {
    const h = await buildHarness();
    // tenantId provided so the entry-point dedup tenant resolution succeeds
    // and the handler reaches the case block (D-3 + Option A locked path).
    const event = {
      id: 'evt_arcv_p2_site3_2',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_arcv_p2_2',
          metadata: { tenantId: 't-1' /* no invoiceId */ },
        },
      },
    };

    await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    expect(h.invoiceService.reconcileBalance).not.toHaveBeenCalled();
    expect(h.invoiceRepo.update).not.toHaveBeenCalled();
  });

  // Case 3 — error propagation: reconcileBalance failure surfaces to Stripe
  it('3. payment_intent.succeeded — when reconcileBalance throws, error propagates from handleWebhook (Stripe sees 5xx → retries)', async () => {
    const h = await buildHarness();
    h.invoiceService.reconcileBalance.mockRejectedValueOnce(new Error('reconcile blew up'));

    const event = {
      id: 'evt_arcv_p2_site3_3',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_arcv_p2_3',
          metadata: { tenantId: 't-1', invoiceId: 'inv-3' },
        },
      },
    };

    await expect(
      h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig'),
    ).rejects.toThrow(/reconcile blew up/);
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledTimes(1);
    expect(h.invoiceService.reconcileBalance).toHaveBeenCalledWith('inv-3');
  });
});

// ── arcV Phase 2 — Site 4 V1 (paymentRepo.findOne dedup guard) ──────────────
//
// Four tests covering the Site 4 internal dedup guard added per audit § D-4
// (defense-in-depth for money-movement). The entry-point stripe_events INSERT
// covers the common path; this guard covers crash-mid-handler / dedup-bug /
// concurrent-delivery TOCTOU scenarios. Tenant-scoped lookup matches the
// partial unique index idx_payments_tenant_pi_unique from arcV Phase 1.
//
// This commit adds the V1 dedup guard but leaves the V2 bypass write intact;
// V2 lands in the next commit. Tests here assert only V1-scope behavior so
// they remain valid through V2.

describe('StripeService — arcV Phase 2 Site 4 V1 (paymentRepo.findOne dedup guard)', () => {
  beforeEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  const buildSession = (overrides: Record<string, any> = {}) => ({
    id: 'cs_test_arcv_p2',
    payment_status: 'paid',
    amount_total: 10000,
    payment_intent: 'pi_arcv_p2_4',
    metadata: { tenantId: 't-1', invoiceId: 'inv-4' },
    ...overrides,
  });

  // Case 4 — happy path: no existing payment → save runs
  it('4. checkout.session.completed — paymentRepo.save called once with expected fields when no existing payment matches (tenant, pi_id)', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValueOnce({ id: 'inv-4', tenant_id: 't-1', total: '100.00' });
    h.paymentRepo.findOne.mockResolvedValueOnce(null); // dedup miss

    const event = {
      id: 'evt_arcv_p2_site4v1_4',
      type: 'checkout.session.completed',
      data: { object: buildSession() },
    };
    await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    expect(h.paymentRepo.findOne).toHaveBeenCalledWith({
      where: { tenant_id: 't-1', stripe_payment_intent_id: 'pi_arcv_p2_4' },
    });
    expect(h.paymentRepo.save).toHaveBeenCalledTimes(1);
    expect(h.paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 't-1',
      invoice_id: 'inv-4',
      amount: 100,
      payment_method: 'stripe_checkout',
      stripe_payment_intent_id: 'pi_arcv_p2_4',
      status: 'completed',
    }));
  });

  // Case 5 — dedup hit: existing payment found → save SKIPPED + warn logged
  it('5. checkout.session.completed — paymentRepo.save SKIPPED + warn logged when existing payment matches (tenant, pi_id)', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValueOnce({ id: 'inv-5', tenant_id: 't-1', total: '100.00' });
    h.paymentRepo.findOne.mockResolvedValueOnce({
      id: 'existing-payment-uuid',
      tenant_id: 't-1',
      invoice_id: 'inv-5',
      stripe_payment_intent_id: 'pi_arcv_p2_5',
    });
    const warnSpy = jest.spyOn((h.service as any).logger, 'warn');

    const event = {
      id: 'evt_arcv_p2_site4v1_5',
      type: 'checkout.session.completed',
      data: {
        object: buildSession({
          payment_intent: 'pi_arcv_p2_5',
          metadata: { tenantId: 't-1', invoiceId: 'inv-5' },
        }),
      },
    };
    await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    expect(h.paymentRepo.findOne).toHaveBeenCalledWith({
      where: { tenant_id: 't-1', stripe_payment_intent_id: 'pi_arcv_p2_5' },
    });
    expect(h.paymentRepo.save).not.toHaveBeenCalled();
    expect(h.paymentRepo.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Site 4 dedup hit: payment for stripe_payment_intent_id=pi_arcv_p2_5'),
    );
  });

  // Case 6 — null payment_intent: dedup lookup skipped, save still runs
  it('6. checkout.session.completed — paymentRepo.save runs when paymentIntentId is null (no dedup possible; preserves existing nullable handling)', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValueOnce({ id: 'inv-6', tenant_id: 't-1', total: '50.00' });

    const event = {
      id: 'evt_arcv_p2_site4v1_6',
      type: 'checkout.session.completed',
      data: {
        object: buildSession({
          payment_intent: null,
          metadata: { tenantId: 't-1', invoiceId: 'inv-6' },
          amount_total: 5000,
        }),
      },
    };
    await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    // findOne MUST NOT be called when paymentIntentId is null —
    // the conditional in the source skips the lookup entirely.
    expect(h.paymentRepo.findOne).not.toHaveBeenCalled();
    expect(h.paymentRepo.save).toHaveBeenCalledTimes(1);
    expect(h.paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      stripe_payment_intent_id: null,
      tenant_id: 't-1',
      invoice_id: 'inv-6',
    }));
  });

  // Case 7 — multi-tenant safety: dedup findOne is tenant-scoped
  it('7. checkout.session.completed — paymentRepo.findOne is tenant-scoped (cross-tenant pi_id collision would not skip save)', async () => {
    const h = await buildHarness();
    h.invoiceRepo.findOne.mockResolvedValueOnce({ id: 'inv-7', tenant_id: 't-2', total: '100.00' });
    h.paymentRepo.findOne.mockResolvedValueOnce(null);

    const event = {
      id: 'evt_arcv_p2_site4v1_7',
      type: 'checkout.session.completed',
      data: {
        object: buildSession({
          payment_intent: 'pi_shared_xyz',
          metadata: { tenantId: 't-2', invoiceId: 'inv-7' },
        }),
      },
    };
    await h.service.handleWebhook(Buffer.from(JSON.stringify(event)), 'sig');

    // The where clause MUST carry tenant_id — this is what makes the lookup
    // match the partial unique index idx_payments_tenant_pi_unique and
    // prevents a cross-tenant pi_id collision from blocking a legitimate
    // save in this tenant's namespace.
    expect(h.paymentRepo.findOne).toHaveBeenCalledWith({
      where: { tenant_id: 't-2', stripe_payment_intent_id: 'pi_shared_xyz' },
    });
    expect(h.paymentRepo.save).toHaveBeenCalledTimes(1);
  });
});
