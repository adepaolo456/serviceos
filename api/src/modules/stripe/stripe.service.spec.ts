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
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';

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
  tenantRepo: { findOne: jest.Mock };
  stripeMock: {
    paymentIntents: { create: jest.Mock };
    paymentMethods: { list: jest.Mock };
    refunds: { create: jest.Mock };
    customers: { create: jest.Mock };
    subscriptions: { create: jest.Mock };
    webhooks: { constructEvent: jest.Mock };
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

  const dataSource = {
    query: jest.fn().mockResolvedValue([{ cnt: '0' }]),
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
      { provide: DataSource, useValue: dataSource },
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
    stripeMock,
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

    errSpy.mockRestore();
  });
});
