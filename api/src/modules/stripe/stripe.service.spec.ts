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
  paymentRepo: { find: jest.Mock; save: jest.Mock; create: jest.Mock };
  notifRepo: { save: jest.Mock; create: jest.Mock };
  customerRepo: { findOne: jest.Mock; update: jest.Mock };
  tenantRepo: { findOne: jest.Mock };
  stripeMock: {
    paymentIntents: { create: jest.Mock };
    paymentMethods: { list: jest.Mock };
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
