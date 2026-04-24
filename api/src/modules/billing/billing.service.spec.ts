/**
 * Silent-error-swallow audit — BillingService negative-path tests for:
 *   site #16  createInvoice — chain-resolution query must propagate
 *   site #18  editInvoice — audit-log write must propagate
 *   site #19  editInvoice — size-change cascade must roll back
 *   site #21  voidInternalInvoice — credit-memo write must roll back
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

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

interface Harness {
  service: BillingService;
  invoicesRepository: any;
  lineItemRepo: any;
  notifRepo: any;
  dataSourceQuery: jest.Mock;
  transactionCommit: jest.Mock;
  trxInvoiceRepo: any;
  trxCreditMemoRepo: any;
  trxQuery: jest.Mock;
  pricingRepo: any;
  jobsRepository: any;
  assetRepo: any;
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
    update: jest.fn(),
  };
  const trxCreditMemoRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn(),
  };
  const trxQuery = jest.fn();

  const trx: Partial<EntityManager> & { getRepository: any; query: any } = {
    getRepository: (e: unknown) => {
      if (e === Invoice) return trxInvoiceRepo;
      if (e === CreditMemo) return trxCreditMemoRepo;
      // For cascadeSizeChange: return stubs that may reject per test.
      if (e === InvoiceLineItem) return lineItemRepo;
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
    trxCreditMemoRepo,
    trxQuery,
    pricingRepo,
    jobsRepository,
    assetRepo,
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
