/**
 * Silent-error-swallow audit — BillingService negative-path tests for:
 *   site #16  createInvoice — chain-resolution query must propagate
 *   site #18  editInvoice — audit-log write must propagate
 *   site #19  editInvoice — size-change cascade must roll back
 *   site #21  voidInternalInvoice — credit-memo write must roll back
 *
 * Fix A coverage — createInternalInvoice Shape #2 (memory rule #1
 * invariant gate; bypass closed at helper boundary):
 *   - paid + payment block: invoice via reconcileBalance, Payment row written
 *   - paid + no payment block: throws payment_required_for_paid_status
 *   - paid + mismatched amount: throws and outer transaction NOT committed
 *   - default open status: unchanged, no Payment row, no reconcile
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

import { BillingService } from './billing.service';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { Payment } from './entities/payment.entity';
import { CreditMemo } from './entities/credit-memo.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoiceService } from './services/invoice.service';

interface Harness {
  service: BillingService;
  invoicesRepository: any;
  lineItemRepo: any;
  notifRepo: any;
  dataSourceQuery: jest.Mock;
  transactionCommit: jest.Mock;
  trxInvoiceRepo: any;
  trxLineItemRepo: any;
  trxPaymentRepo: any;
  trxCreditMemoRepo: any;
  trxQuery: jest.Mock;
  pricingRepo: any;
  jobsRepository: any;
  assetRepo: any;
  invoiceServiceMock: { reconcileBalance: jest.Mock };
}

async function buildHarness(): Promise<Harness> {
  const transactionCommit = jest.fn();
  const dataSourceQuery = jest.fn();

  const invoicesRepository: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'mock-inv-id' })),
    update: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
  };
  const lineItemRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'mock-li-id' })),
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
  };
  const notifRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
  const pricingRepo: any = { findOne: jest.fn() };
  const jobsRepository: any = { findOne: jest.fn() };
  const assetRepo: any = { findOne: jest.fn() };

  const trxInvoiceRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'mock-inv-id' })),
    update: jest.fn(),
    findOne: jest.fn((opts: any) =>
      Promise.resolve({ id: opts?.where?.id ?? 'mock-inv-id', tenant_id: opts?.where?.tenant_id ?? 'tenant-1' }),
    ),
  };
  const trxLineItemRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'mock-li-id' })),
  };
  const trxPaymentRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'mock-pay-id' })),
  };
  const trxCreditMemoRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn(),
  };
  const trxQuery = jest.fn();

  const trx: Partial<EntityManager> & { getRepository: any; query: any } = {
    getRepository: (e: unknown) => {
      if (e === Invoice) return trxInvoiceRepo;
      if (e === InvoiceLineItem) return trxLineItemRepo;
      if (e === Payment) return trxPaymentRepo;
      if (e === CreditMemo) return trxCreditMemoRepo;
      if (e === Job) return jobsRepository;
      if (e === Asset) return assetRepo;
      if (e === PricingRule) return pricingRepo;
      if (e === Notification) return notifRepo;
      throw new Error(`unmocked trx repo: ${(e as any)?.name}`);
    },
    query: trxQuery,
  };

  const dataSource: any = {
    query: dataSourceQuery,
    transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) => {
      const result = await cb(trx as EntityManager);
      transactionCommit();
      return result;
    }),
    getRepository: () => {
      throw new Error('unexpected dataSource.getRepository in this test');
    },
  };

  const invoiceServiceMock = { reconcileBalance: jest.fn().mockResolvedValue(undefined) };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BillingService,
      { provide: getRepositoryToken(Invoice), useValue: invoicesRepository },
      { provide: getRepositoryToken(InvoiceLineItem), useValue: lineItemRepo },
      { provide: getRepositoryToken(Payment), useValue: {} },
      { provide: getRepositoryToken(Job), useValue: jobsRepository },
      { provide: getRepositoryToken(Notification), useValue: notifRepo },
      { provide: getRepositoryToken(Asset), useValue: assetRepo },
      { provide: getRepositoryToken(PricingRule), useValue: pricingRepo },
      { provide: DataSource, useValue: dataSource },
      { provide: NotificationsService, useValue: { send: jest.fn() } },
      { provide: InvoiceService, useValue: invoiceServiceMock },
    ],
  }).compile();

  return {
    service: module.get(BillingService),
    invoicesRepository,
    lineItemRepo,
    notifRepo,
    dataSourceQuery,
    transactionCommit,
    trxInvoiceRepo,
    trxLineItemRepo,
    trxPaymentRepo,
    trxCreditMemoRepo,
    trxQuery,
    pricingRepo,
    jobsRepository,
    assetRepo,
    invoiceServiceMock,
  };
}

describe('BillingService — silent-error-swallow fixes', () => {
  // Site #16: createInvoice chain resolution query must propagate.
  it('site #16 (createInvoice): throws when task_chain_links lookup errors', async () => {
    const h = await buildHarness();
    // First dataSource.query is getNextInvoiceNumber → mock success.
    // Second call is the task_chain_links lookup → mock reject.
    h.dataSourceQuery
      .mockResolvedValueOnce([{ num: 100 }])
      .mockRejectedValueOnce(new Error('chain lookup DB error'));

    await expect(
      h.service.createInvoice('tenant-1', {
        customerId: 'cust-1',
        jobId: 'job-1',
        lineItems: [{ description: 'x', quantity: 1, unitPrice: 10, amount: 10 }],
      }),
    ).rejects.toThrow('chain lookup DB error');
  });

  // Site #18: editInvoice audit log write must propagate.
  it('site #18 (editInvoice): throws when audit log notifRepo.save errors', async () => {
    const h = await buildHarness();
    h.invoicesRepository.findOne.mockResolvedValue({
      id: 'inv-1',
      tenant_id: 'tenant-1',
      status: 'open',
      summary_of_work: 'old notes',
      line_items: [],
    });
    h.notifRepo.save.mockRejectedValue(new Error('audit write failed'));

    await expect(
      h.service.editInvoice('tenant-1', 'inv-1', { notes: 'new notes' }, 'u1', 'User One'),
    ).rejects.toThrow('audit write failed');
  });

  // Site #19 negative: editInvoice size-change cascade throws must propagate.
  it('site #19 (editInvoice cascade): throws when cascade internals error', async () => {
    const h = await buildHarness();
    h.invoicesRepository.findOne.mockResolvedValue({
      id: 'inv-1',
      tenant_id: 'tenant-1',
      status: 'open',
      job_id: 'job-1',
      total: 100,
      line_items: [],
    });
    h.notifRepo.save.mockResolvedValue(undefined);
    h.pricingRepo.findOne.mockRejectedValue(new Error('pricing repo DB error'));

    await expect(
      h.service.editInvoice(
        'tenant-1',
        'inv-1',
        { newAssetSubtype: '30yd' },
        'u1',
        'User One',
      ),
    ).rejects.toThrow('pricing repo DB error');
  });

  // Site #19 rollback: assert transaction did not commit.
  it('site #19 (editInvoice cascade): transaction commit NOT reached when cascade fails', async () => {
    const h = await buildHarness();
    h.invoicesRepository.findOne.mockResolvedValue({
      id: 'inv-1',
      tenant_id: 'tenant-1',
      status: 'open',
      job_id: 'job-1',
      total: 100,
      line_items: [],
    });
    h.notifRepo.save.mockResolvedValue(undefined);
    h.pricingRepo.findOne.mockRejectedValue(new Error('pricing repo DB error'));

    await h.service
      .editInvoice('tenant-1', 'inv-1', { newAssetSubtype: '30yd' }, 'u1', 'User One')
      .catch(() => { /* expected */ });

    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // Site #21 negative: voidInternalInvoice credit memo save throws must propagate.
  it('site #21 (voidInternalInvoice): throws when credit memo save errors', async () => {
    const h = await buildHarness();
    h.invoicesRepository.findOneBy.mockResolvedValue({
      id: 'inv-1',
      tenant_id: 'tenant-1',
      status: 'open',
      customer_id: 'cust-1',
      total: 500,
    });
    h.trxQuery.mockResolvedValue([{ num: 7 }]);
    h.trxCreditMemoRepo.save.mockRejectedValue(new Error('credit memo failed'));

    await expect(
      h.service.voidInternalInvoice('inv-1', 'tenant-1', 'test void'),
    ).rejects.toThrow('credit memo failed');
  });

  // Site #21 rollback: assert tx opened, invoice UPDATE ran inside tx,
  // but commit never reached (so the UPDATE is semantically rolled back).
  it('site #21 (voidInternalInvoice): tx commit NOT reached when credit memo fails (invoice UPDATE rolls back)', async () => {
    const h = await buildHarness();
    h.invoicesRepository.findOneBy.mockResolvedValue({
      id: 'inv-1',
      tenant_id: 'tenant-1',
      status: 'open',
      customer_id: 'cust-1',
      total: 500,
    });
    h.trxQuery.mockResolvedValue([{ num: 7 }]);
    h.trxCreditMemoRepo.save.mockRejectedValue(new Error('credit memo failed'));

    await h.service
      .voidInternalInvoice('inv-1', 'tenant-1', 'test void')
      .catch(() => { /* expected */ });

    // UPDATE on the trx-scoped invoice repo ran (inside the tx)...
    expect(h.trxInvoiceRepo.update).toHaveBeenCalled();
    // ...but the tx never committed, so the UPDATE would roll back.
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });
});

describe('BillingService.createInternalInvoice — Fix A (Shape #2 invariant gate)', () => {
  // Happy path: paid + payment block. Invoice inserts open, Payment row
  // written, reconcileBalance called inside the same tx. Commit reached.
  it('paid + payment block: writes Payment row and calls reconcileBalance inside the transaction', async () => {
    const h = await buildHarness();
    h.dataSourceQuery.mockResolvedValue([{ num: 4242 }]);

    await h.service.createInternalInvoice('tenant-1', {
      customerId: 'cust-1',
      jobId: 'job-1',
      source: 'booking',
      invoiceType: 'rental',
      status: 'paid',
      paymentMethod: 'card',
      lineItems: [
        { description: 'Rental', quantity: 1, unitPrice: 100, amount: 100 },
      ],
      notes: 'Paid at time of booking',
      payment: {
        amount: 100,
        payment_method: 'card',
      },
    });

    // Insert: status='open' (memory rule #1 — never direct-write 'paid')
    expect(h.trxInvoiceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open', paid_at: null }),
    );
    // Subtotal/total update: amount_paid stays 0, reconcile derives final state
    expect(h.trxInvoiceRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mock-inv-id' }),
      expect.objectContaining({ subtotal: 100, total: 100, amount_paid: 0, balance_due: 100 }),
    );
    // Payment row written via tx-scoped repo
    expect(h.trxPaymentRepo.save).toHaveBeenCalledTimes(1);
    expect(h.trxPaymentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        invoice_id: 'mock-inv-id',
        amount: 100,
        payment_method: 'card',
        status: 'completed',
      }),
    );
    // reconcileBalance called with the same EntityManager so it joins the tx
    expect(h.invoiceServiceMock.reconcileBalance).toHaveBeenCalledTimes(1);
    expect(h.invoiceServiceMock.reconcileBalance).toHaveBeenCalledWith(
      'mock-inv-id',
      expect.anything(),
    );
    // Outer transaction committed
    expect(h.transactionCommit).toHaveBeenCalled();
  });

  // Validation gate fires BEFORE any DB write — no transaction, no inserts.
  it('paid + no payment block: throws payment_required_for_paid_status before any DB write', async () => {
    const h = await buildHarness();

    await expect(
      h.service.createInternalInvoice('tenant-1', {
        customerId: 'cust-1',
        source: 'booking',
        invoiceType: 'rental',
        status: 'paid',
        lineItems: [
          { description: 'Rental', quantity: 1, unitPrice: 100, amount: 100 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(h.dataSourceQuery).not.toHaveBeenCalled();
    expect(h.trxInvoiceRepo.save).not.toHaveBeenCalled();
    expect(h.trxLineItemRepo.save).not.toHaveBeenCalled();
    expect(h.trxPaymentRepo.save).not.toHaveBeenCalled();
    expect(h.invoiceServiceMock.reconcileBalance).not.toHaveBeenCalled();
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // Mismatched amount throws AFTER total is computed but inside the
  // transaction. Commit must NOT be reached so the invoice + line-item
  // writes roll back.
  it('paid + mismatched amount: throws and outer transaction is NOT committed', async () => {
    const h = await buildHarness();
    h.dataSourceQuery.mockResolvedValue([{ num: 4243 }]);

    await expect(
      h.service.createInternalInvoice('tenant-1', {
        customerId: 'cust-1',
        source: 'booking',
        invoiceType: 'rental',
        status: 'paid',
        lineItems: [
          { description: 'Rental', quantity: 1, unitPrice: 100, amount: 100 },
        ],
        payment: {
          amount: 200,
          payment_method: 'card',
        },
      }),
    ).rejects.toThrow('payment_amount_must_match_invoice_total');

    // Invoice and line items DID write inside the transaction…
    expect(h.trxInvoiceRepo.save).toHaveBeenCalledTimes(1);
    expect(h.trxLineItemRepo.save).toHaveBeenCalledTimes(1);
    // …but the Payment write never happened and reconcile was not called…
    expect(h.trxPaymentRepo.save).not.toHaveBeenCalled();
    expect(h.invoiceServiceMock.reconcileBalance).not.toHaveBeenCalled();
    // …and the outer transaction never committed, so all preceding
    // writes roll back as a unit (the partial-state class Fix A closes).
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // Default flow (no status, or status:'open') is unchanged by Fix A.
  it("default 'open' flow: unchanged — no Payment row, no reconcile", async () => {
    const h = await buildHarness();
    h.dataSourceQuery.mockResolvedValue([{ num: 4245 }]);

    await h.service.createInternalInvoice('tenant-1', {
      customerId: 'cust-1',
      source: 'failed_trip',
      invoiceType: 'failure_charge',
      status: 'open',
      lineItems: [
        { description: 'Failed pickup charge', quantity: 1, unitPrice: 150, amount: 150 },
      ],
    });

    expect(h.trxInvoiceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open', paid_at: null }),
    );
    expect(h.trxInvoiceRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mock-inv-id' }),
      expect.objectContaining({ subtotal: 150, total: 150, amount_paid: 0, balance_due: 150 }),
    );
    expect(h.trxPaymentRepo.save).not.toHaveBeenCalled();
    expect(h.invoiceServiceMock.reconcileBalance).not.toHaveBeenCalled();
    expect(h.transactionCommit).toHaveBeenCalled();
  });
});
