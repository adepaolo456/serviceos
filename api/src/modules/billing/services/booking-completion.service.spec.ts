/**
 * Silent-error-swallow audit — BookingCompletionService negative-path
 * tests for sites #1 (asset lookup) and #3 (chain creation).
 *
 * Both tests assert that a forced mid-transaction failure rolls back
 * cleanly and the caller sees the error instead of a silent 200 with
 * rentalChainId=null.
 */

jest.mock('../../../common/utils/job-number.util', () => ({
  issueNextJobNumber: jest
    .fn()
    .mockResolvedValue('MOCK-JOB-NUM'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { BookingCompletionService } from './booking-completion.service';
import { Job } from '../../jobs/entities/job.entity';
import { Asset } from '../../assets/entities/asset.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { RentalChain } from '../../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../../rental-chains/entities/task-chain-link.entity';
import { TenantSettings } from '../../tenant-settings/entities/tenant-settings.entity';

interface Harness {
  service: BookingCompletionService;
  trxJobRepo: Record<string, jest.Mock>;
  trxAssetRepo: Record<string, jest.Mock>;
  trxInvoiceRepo: Record<string, jest.Mock>;
  trxLineItemRepo: Record<string, jest.Mock>;
  trxChainRepo: Record<string, jest.Mock>;
  trxLinkRepo: Record<string, jest.Mock>;
  trxTenantSettingsRepo: Record<string, jest.Mock>;
  trxQuery: jest.Mock;
  commitCalled: jest.Mock;
}

async function buildHarness(): Promise<Harness> {
  const commitCalled = jest.fn();

  const trxJobRepo = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((x: any) =>
      Promise.resolve({ ...x, id: `mock-${x.job_type ?? 'job'}-id` }),
    ),
    create: jest.fn((x: any) => x),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    })),
  };
  const trxAssetRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const trxInvoiceRepo = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) =>
      Promise.resolve({ ...x, id: 'mock-invoice-id' }),
    ),
    update: jest.fn(),
  };
  const trxLineItemRepo = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'mock-li-id' })),
  };
  const trxChainRepo = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'mock-chain-id' })),
  };
  const trxLinkRepo = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'mock-link-id' })),
    update: jest.fn(),
  };
  const trxTenantSettingsRepo = {
    findOne: jest.fn().mockResolvedValue({ pre_assignment_disabled: false }),
  };
  const trxQuery = jest.fn().mockResolvedValue([{ num: 42 }]);

  const trx: any = {
    getRepository: (e: unknown) => {
      if (e === Job) return trxJobRepo;
      if (e === Asset) return trxAssetRepo;
      if (e === Invoice) return trxInvoiceRepo;
      if (e === InvoiceLineItem) return trxLineItemRepo;
      if (e === RentalChain) return trxChainRepo;
      if (e === TaskChainLink) return trxLinkRepo;
      if (e === TenantSettings) return trxTenantSettingsRepo;
      throw new Error(`unmocked trx repo: ${(e as any)?.name}`);
    },
    query: trxQuery,
  };

  const dataSource = {
    transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) => {
      const result = await cb(trx as EntityManager);
      commitCalled();
      return result;
    }),
    getRepository: (e: unknown) => {
      if (e === TenantSettings) return trxTenantSettingsRepo;
      throw new Error(`unmocked ds repo: ${(e as any)?.name}`);
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BookingCompletionService,
      { provide: getRepositoryToken(Job), useValue: {} },
      { provide: getRepositoryToken(Asset), useValue: {} },
      { provide: getRepositoryToken(Invoice), useValue: {} },
      { provide: getRepositoryToken(InvoiceLineItem), useValue: {} },
      { provide: getRepositoryToken(RentalChain), useValue: {} },
      { provide: getRepositoryToken(TaskChainLink), useValue: {} },
      { provide: getRepositoryToken(TenantSettings), useValue: {} },
      { provide: DataSource, useValue: dataSource },
    ],
  }).compile();

  return {
    service: module.get(BookingCompletionService),
    trxJobRepo,
    trxAssetRepo,
    trxInvoiceRepo,
    trxLineItemRepo,
    trxChainRepo,
    trxLinkRepo,
    trxTenantSettingsRepo,
    trxQuery,
    commitCalled,
  };
}

const baseParams = {
  tenantId: 'tenant-1',
  customerId: 'cust-1',
  dumpsterSize: '20yd',
  serviceType: 'dumpster_rental',
  deliveryDate: '2026-04-10',
  pickupDate: '2026-04-24',
  rentalDays: 14,
  siteAddress: { street: '1 Main', city: 'X', state: 'Y', zip: '00000' } as any,
  basePrice: 100,
  distanceSurcharge: 0,
  totalPrice: 100,
};

describe('BookingCompletionService — silent-error-swallow fixes', () => {
  // Site #1: asset lookup DB error must propagate + roll back the tx.
  it('site #1 (asset lookup): throws when assetRepo.findOne errors, tx does not commit', async () => {
    const h = await buildHarness();
    h.trxAssetRepo.findOne.mockRejectedValue(new Error('DB offline'));

    await expect(h.service.completeBooking(baseParams)).rejects.toThrow('DB offline');

    // Rollback proof: the transaction callback threw, so commitCalled
    // was never reached (our mocked dataSource.transaction only calls
    // commitCalled after the callback resolves).
    expect(h.commitCalled).not.toHaveBeenCalled();
    // And no chain write happened.
    expect(h.trxChainRepo.save).not.toHaveBeenCalled();
  });

  // Site #3 negative: chain save throws → error bubbles up, tx rolls back.
  it('site #3 (chain creation): throws when rentalChainRepo.save errors, tx does not commit', async () => {
    const h = await buildHarness();
    h.trxAssetRepo.findOne.mockResolvedValue({ id: 'asset-1', identifier: 'A-1' });
    h.trxChainRepo.save.mockRejectedValue(new Error('chain DB error'));

    await expect(h.service.completeBooking(baseParams)).rejects.toThrow('chain DB error');

    expect(h.commitCalled).not.toHaveBeenCalled();
    // Chain save was attempted once but rejected; link writes never happen.
    expect(h.trxLinkRepo.save).not.toHaveBeenCalled();
  });

  // Site #3 positive-rollback: force mid-tx failure AFTER preceding
  // writes (delivery + pickup + invoice + line item already saved).
  // Assert tx rollback signalled — commitCalled never invoked.
  it('site #3 rollback: preceding writes happen but commit does not when chain save fails', async () => {
    const h = await buildHarness();
    h.trxAssetRepo.findOne.mockResolvedValue({ id: 'asset-1', identifier: 'A-1' });
    h.trxChainRepo.save.mockRejectedValue(new Error('chain save failed'));

    await expect(h.service.completeBooking(baseParams)).rejects.toThrow('chain save failed');

    // Preceding writes did run (asset update, 2 job saves, invoice save, line item save).
    expect(h.trxAssetRepo.update).toHaveBeenCalled();
    expect(h.trxJobRepo.save).toHaveBeenCalled();
    expect(h.trxInvoiceRepo.save).toHaveBeenCalled();
    expect(h.trxLineItemRepo.save).toHaveBeenCalled();

    // But the transaction did NOT commit (rollback semantics).
    expect(h.commitCalled).not.toHaveBeenCalled();
  });
});
