/**
 * Phase 2c Follow-Up — minimal coverage of `updateChain`'s
 * `expected_pickup_date` fail-fast path.
 *
 * Scope: only the fail-fast and the corresponding happy path. The
 * surrounding service has many other paths (createChain,
 * createExchange, handleTypeChange, getLifecycle, etc.) that are
 * intentionally NOT covered here — that's a follow-up audit, not
 * the bug fix this spec exists for.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { RentalChainsService } from './rental-chains.service';
import { RentalChain } from './entities/rental-chain.entity';
import { TaskChainLink } from './entities/task-chain-link.entity';
import { Job } from '../jobs/entities/job.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { PricingService } from '../pricing/pricing.service';
import { BillingService } from '../billing/billing.service';

describe('RentalChainsService.updateChain — expected_pickup_date fail-fast', () => {
  const tenantId = 'tenant-1';
  const chainId = 'chain-1';
  const baseChain = {
    id: chainId,
    tenant_id: tenantId,
    drop_off_date: '2026-04-01',
    expected_pickup_date: '2026-04-15',
    status: 'active',
  };

  let service: RentalChainsService;
  let chainRepo: { findOne: jest.Mock; save: jest.Mock };
  let trxChainRepo: { save: jest.Mock };
  let trxLinkRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let trxJobRepo: { update: jest.Mock };

  beforeEach(async () => {
    chainRepo = { findOne: jest.fn(), save: jest.fn() };
    trxChainRepo = { save: jest.fn() };
    trxLinkRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
    trxJobRepo = { update: jest.fn() };

    const dataSource = {
      transaction: jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => {
        const trx = {
          getRepository: (entity: unknown) => {
            if (entity === RentalChain) return trxChainRepo;
            if (entity === TaskChainLink) return trxLinkRepo;
            if (entity === Job) return trxJobRepo;
            throw new Error(
              `unmocked repo for entity: ${(entity as { name?: string })?.name ?? '?'}`,
            );
          },
        };
        return cb(trx);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalChainsService,
        { provide: getRepositoryToken(RentalChain), useValue: chainRepo },
        {
          provide: getRepositoryToken(TaskChainLink),
          useValue: { findOne: jest.fn(), find: jest.fn(), save: jest.fn() },
        },
        { provide: getRepositoryToken(Job), useValue: { update: jest.fn() } },
        {
          provide: getRepositoryToken(TenantSettings),
          useValue: { findOne: jest.fn() },
        },
        { provide: DataSource, useValue: dataSource },
        { provide: PricingService, useValue: {} },
        { provide: BillingService, useValue: {} },
      ],
    }).compile();

    service = module.get<RentalChainsService>(RentalChainsService);
  });

  it('throws ConflictException with NO_SCHEDULED_PICKUP code AND leaves the chain row unchanged when no scheduled pickup link exists', async () => {
    // Pre-transaction chain lookup returns the chain.
    chainRepo.findOne.mockResolvedValue({ ...baseChain });
    // Inside the transaction, the pickup-link lookup returns null —
    // this is the fail-fast condition.
    trxLinkRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateChain(tenantId, chainId, {
        expected_pickup_date: '2026-05-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Re-run to inspect the locked error body. (rejects.toMatchObject
    // can't peek into ConflictException's response shape on the same
    // assertion as toBeInstanceOf.)
    chainRepo.findOne.mockResolvedValue({ ...baseChain });
    trxLinkRepo.findOne.mockResolvedValue(null);
    let captured: ConflictException | null = null;
    try {
      await service.updateChain(tenantId, chainId, {
        expected_pickup_date: '2026-05-01',
      });
    } catch (e) {
      captured = e as ConflictException;
    }
    expect(captured).not.toBeNull();
    expect(captured.getStatus()).toBe(409);
    expect(captured.getResponse()).toEqual({
      code: 'NO_SCHEDULED_PICKUP',
      message:
        'Cannot update pickup date: this rental chain has no scheduled pickup. Schedule an exchange or reopen the cancelled pickup first.',
    });

    // CRITICAL — write-ordering guard. The chain row must NOT have
    // been persisted (the bug being fixed was the chain row drifting
    // out of sync with the job row when the pickup link was missing).
    expect(trxChainRepo.save).not.toHaveBeenCalled();
    // Same goes for the linked job's scheduled_date.
    expect(trxJobRepo.update).not.toHaveBeenCalled();
    // And the pickup link itself.
    expect(trxLinkRepo.save).not.toHaveBeenCalled();
  });

  it('happy path: updates chain expected_pickup_date AND linked pickup job scheduled_date when a scheduled pickup link exists', async () => {
    chainRepo.findOne.mockResolvedValue({ ...baseChain });

    const pickupLink = {
      id: 'link-pickup',
      job_id: 'job-pickup',
      rental_chain_id: chainId,
      task_type: 'pick_up',
      status: 'scheduled',
      scheduled_date: '2026-04-15',
      sequence_number: 2,
    };
    const deliveryLink = {
      id: 'link-delivery',
      job_id: 'job-delivery',
      rental_chain_id: chainId,
      task_type: 'drop_off',
      status: 'scheduled',
      scheduled_date: '2026-04-01',
      sequence_number: 1,
    };
    // Inside the transaction the pickup-link lookup fires first,
    // then the delivery-link lookup for the rental_end_date sync.
    trxLinkRepo.findOne
      .mockResolvedValueOnce(pickupLink)
      .mockResolvedValueOnce(deliveryLink);

    await service.updateChain(tenantId, chainId, {
      expected_pickup_date: '2026-05-01',
    });

    // (1) Pickup link saved with new date.
    expect(trxLinkRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'link-pickup',
        scheduled_date: '2026-05-01',
      }),
    );
    // (2) Pickup job scheduled_date synced — tenant-scoped.
    expect(trxJobRepo.update).toHaveBeenCalledWith(
      { id: 'job-pickup', tenant_id: tenantId },
      { scheduled_date: '2026-05-01' },
    );
    // (3) Delivery job rental_end_date synced.
    expect(trxJobRepo.update).toHaveBeenCalledWith(
      { id: 'job-delivery', tenant_id: tenantId },
      { rental_end_date: '2026-05-01' },
    );
    // (4) Chain row persisted with new expected_pickup_date.
    expect(trxChainRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: chainId,
        expected_pickup_date: '2026-05-01',
      }),
    );
  });
});
