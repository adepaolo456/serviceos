/**
 * Phase 2c Follow-Up + Post-Phase-2c Tier A #2 — minimal coverage of
 * the service's two fail-fast guards:
 *   - updateChain's expected_pickup_date NO_SCHEDULED_PICKUP guard
 *     (shipped in commit 5a658cc)
 *   - createExchange's NO_SCHEDULED_PICKUP_FOR_EXCHANGE guard
 *     (this prompt)
 *
 * Scope: the two guards plus one happy-path sanity check per method.
 * The surrounding service has many other paths (createChain,
 * handleTypeChange, getLifecycle, etc.) that are intentionally NOT
 * covered here — that's a follow-up audit, not the bug fix this spec
 * exists for.
 */

// Top-level mock for the non-DI job-number utility used inside
// createExchange's transaction. updateChain doesn't call this util,
// so the mock has no effect on the existing updateChain tests.
jest.mock('../../common/utils/job-number.util', () => ({
  issueNextJobNumber: jest.fn().mockResolvedValue('MOCK-JOB-NUM'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { RentalChainsService } from './rental-chains.service';
import { RentalChain } from './entities/rental-chain.entity';
import { TaskChainLink } from './entities/task-chain-link.entity';
import { Job } from '../jobs/entities/job.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { Customer } from '../customers/entities/customer.entity';
import { PricingService } from '../pricing/pricing.service';
import { BillingService } from '../billing/billing.service';

// ── Shared test harness ────────────────────────────────────────────
// Both describe blocks (updateChain + createExchange) use identical
// TestingModule + DataSource.transaction plumbing. Extracted into a
// single factory so the two suites can't drift from one another.

interface Harness {
  service: RentalChainsService;
  chainRepo: { findOne: jest.Mock; save: jest.Mock };
  linkRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  customerRepo: { findOne: jest.Mock };
  pricingService: { calculate: jest.Mock };
  dataSource: {
    transaction: jest.Mock;
    getRepository: (entity: unknown) => unknown;
  };
  trxChainRepo: { findOne: jest.Mock; save: jest.Mock };
  trxLinkRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  trxJobRepo: {
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  trxCustomerRepo: { findOne: jest.Mock };
  trxTenantSettingsRepo: { findOne: jest.Mock };
}

async function buildHarness(): Promise<Harness> {
  const chainRepo = { findOne: jest.fn(), save: jest.fn() };
  const linkRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
  const customerRepo = { findOne: jest.fn() };
  const pricingService = { calculate: jest.fn() };
  // After Phase 1 (manager-overload refactor), createExchange resolves
  // ALL repos through the active EntityManager — including chain,
  // link, customer, tenant-settings — so the trx-side mocks now mirror
  // the same surface as their default-side counterparts.
  const trxChainRepo = { findOne: jest.fn(), save: jest.fn() };
  const trxLinkRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    update: jest.fn(),
    create: jest.fn((x: unknown) => x),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    })),
  };
  const trxJobRepo = {
    update: jest.fn(),
    create: jest.fn((x: Record<string, unknown>) => x),
    save: jest.fn((x: Record<string, unknown>) =>
      Promise.resolve({ ...x, id: `mock-${x.job_type as string}-id` }),
    ),
  };
  const trxCustomerRepo = { findOne: jest.fn() };
  const trxTenantSettingsRepo = { findOne: jest.fn() };

  const trxGetRepository = (entity: unknown) => {
    if (entity === RentalChain) return trxChainRepo;
    if (entity === TaskChainLink) return trxLinkRepo;
    if (entity === Job) return trxJobRepo;
    if (entity === Customer) return trxCustomerRepo;
    if (entity === TenantSettings) return trxTenantSettingsRepo;
    throw new Error(
      `unmocked trx repo: ${(entity as { name?: string })?.name ?? '?'}`,
    );
  };

  const dataSource = {
    transaction: jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => {
      const trx = { getRepository: trxGetRepository };
      return cb(trx);
    }),
    // Non-transactional repos pulled via dataSource.getRepository(...)
    // (used by other code paths; createExchange now goes via the
    // manager argument so this is no longer hit on that path).
    getRepository: (entity: unknown) => {
      if (entity === Customer) return customerRepo;
      throw new Error(
        `unmocked non-trx repo: ${(entity as { name?: string })?.name ?? '?'}`,
      );
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RentalChainsService,
      { provide: getRepositoryToken(RentalChain), useValue: chainRepo },
      { provide: getRepositoryToken(TaskChainLink), useValue: linkRepo },
      { provide: getRepositoryToken(Job), useValue: { update: jest.fn() } },
      {
        provide: getRepositoryToken(TenantSettings),
        useValue: { findOne: jest.fn() },
      },
      { provide: DataSource, useValue: dataSource },
      { provide: PricingService, useValue: pricingService },
      { provide: BillingService, useValue: {} },
    ],
  }).compile();

  const service = module.get<RentalChainsService>(RentalChainsService);
  return {
    service,
    chainRepo,
    linkRepo,
    customerRepo,
    pricingService,
    dataSource,
    trxChainRepo,
    trxLinkRepo,
    trxJobRepo,
    trxCustomerRepo,
    trxTenantSettingsRepo,
  };
}

// ── updateChain suite ──────────────────────────────────────────────

describe('RentalChainsService.updateChain — date fail-fast guards', () => {
  const tenantId = 'tenant-1';
  const chainId = 'chain-1';
  const baseChain = {
    id: chainId,
    tenant_id: tenantId,
    drop_off_date: '2026-04-01',
    expected_pickup_date: '2026-04-15',
    status: 'active',
  };

  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it('throws ConflictException with NO_SCHEDULED_PICKUP code AND leaves the chain row unchanged when no scheduled pickup link exists', async () => {
    h.chainRepo.findOne.mockResolvedValue({ ...baseChain });
    h.trxLinkRepo.findOne.mockResolvedValue(null);

    await expect(
      h.service.updateChain(tenantId, chainId, {
        expected_pickup_date: '2026-05-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    h.chainRepo.findOne.mockResolvedValue({ ...baseChain });
    h.trxLinkRepo.findOne.mockResolvedValue(null);
    let captured: ConflictException | null = null;
    try {
      await h.service.updateChain(tenantId, chainId, {
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

    // Write-ordering guard: zero side effects on the failed path.
    expect(h.trxChainRepo.save).not.toHaveBeenCalled();
    expect(h.trxJobRepo.update).not.toHaveBeenCalled();
    expect(h.trxLinkRepo.save).not.toHaveBeenCalled();
  });

  it('happy path: updates chain expected_pickup_date AND linked pickup job scheduled_date when a scheduled pickup link exists', async () => {
    h.chainRepo.findOne.mockResolvedValue({ ...baseChain });

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
    h.trxLinkRepo.findOne
      .mockResolvedValueOnce(pickupLink)
      .mockResolvedValueOnce(deliveryLink);

    await h.service.updateChain(tenantId, chainId, {
      expected_pickup_date: '2026-05-01',
    });

    expect(h.trxLinkRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'link-pickup',
        scheduled_date: '2026-05-01',
      }),
    );
    expect(h.trxJobRepo.update).toHaveBeenCalledWith(
      { id: 'job-pickup', tenant_id: tenantId },
      { scheduled_date: '2026-05-01' },
    );
    expect(h.trxJobRepo.update).toHaveBeenCalledWith(
      { id: 'job-delivery', tenant_id: tenantId },
      { rental_end_date: '2026-05-01' },
    );
    expect(h.trxChainRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: chainId,
        expected_pickup_date: '2026-05-01',
      }),
    );
  });

  // ── Tier A #3: drop_off_date branch ──────────────────────────────

  it('throws ConflictException with NO_SCHEDULED_DELIVERY code AND leaves the chain row unchanged when no scheduled delivery link exists', async () => {
    h.chainRepo.findOne.mockResolvedValue({ ...baseChain });
    // Tier A #3 guard's scheduled-filtered lookup returns null → throw.
    h.trxLinkRepo.findOne.mockResolvedValueOnce(null);

    let captured: ConflictException | null = null;
    try {
      await h.service.updateChain(tenantId, chainId, {
        drop_off_date: '2026-04-05',
      });
    } catch (e) {
      captured = e as ConflictException;
    }
    expect(captured).not.toBeNull();
    expect(captured).toBeInstanceOf(ConflictException);
    expect(captured.getStatus()).toBe(409);
    expect(captured.getResponse()).toEqual({
      code: 'NO_SCHEDULED_DELIVERY',
      message:
        'Cannot update drop-off date: this rental chain has no scheduled delivery. The delivery may have been cancelled or completed; reopen it or cancel the chain first.',
    });

    // Write-ordering guard: zero side effects on the failed path.
    expect(h.trxChainRepo.save).not.toHaveBeenCalled();
    expect(h.trxLinkRepo.save).not.toHaveBeenCalled();
    expect(h.trxLinkRepo.update).not.toHaveBeenCalled();
    expect(h.trxJobRepo.update).not.toHaveBeenCalled();
    expect(h.trxJobRepo.save).not.toHaveBeenCalled();
  });

  it('happy path: updates chain drop_off_date AND linked delivery job scheduled_date when a scheduled delivery link exists', async () => {
    h.chainRepo.findOne.mockResolvedValue({ ...baseChain });

    const deliveryLink = {
      id: 'link-delivery',
      job_id: 'job-delivery',
      rental_chain_id: chainId,
      task_type: 'drop_off',
      status: 'scheduled',
      scheduled_date: '2026-04-01',
      sequence_number: 1,
    };
    // Two findOne calls inside the transaction on the drop-off path:
    //   1. Tier A #3 guard's scheduled-filtered lookup
    //   2. Existing unfiltered lookup (line ~443) that feeds the
    //      downstream-shift / rental_end_date logic
    // Both return the same scheduled delivery link in this happy path.
    h.trxLinkRepo.findOne
      .mockResolvedValueOnce(deliveryLink)
      .mockResolvedValueOnce(deliveryLink);
    // No downstream links to shift — the find() call at line ~460
    // returns empty so the downstream walk is a no-op.
    h.trxLinkRepo.find.mockResolvedValue([]);

    await h.service.updateChain(tenantId, chainId, {
      drop_off_date: '2026-04-05',
      shift_downstream: false,
    });

    // (1) Delivery link saved with new date.
    expect(h.trxLinkRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'link-delivery',
        scheduled_date: '2026-04-05',
      }),
    );
    // (2) Delivery job scheduled_date + rental_start_date synced.
    expect(h.trxJobRepo.update).toHaveBeenCalledWith(
      { id: 'job-delivery', tenant_id: tenantId },
      { scheduled_date: '2026-04-05', rental_start_date: '2026-04-05' },
    );
    // (3) Chain row persisted with new drop_off_date.
    expect(h.trxChainRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: chainId,
        drop_off_date: '2026-04-05',
      }),
    );
  });
});

// ── createExchange suite ───────────────────────────────────────────

describe('RentalChainsService.createExchange — NO_SCHEDULED_PICKUP_FOR_EXCHANGE fail-fast', () => {
  const tenantId = 'tenant-1';
  const chainId = 'chain-1';
  // Used in the service_address inheritance assertion (Phase 8 regression fix).
  const DELIVERY_ADDRESS = { street: '123 Main St', city: 'Brockton', state: 'MA', zip: '02301' };
  const baseChain = {
    id: chainId,
    tenant_id: tenantId,
    customer_id: 'cust-1',
    asset_id: null,
    drop_off_date: '2026-04-01',
    expected_pickup_date: '2026-04-15',
    dumpster_size: '20-yard',
    status: 'active',
  };
  const dto = {
    exchange_date: '2026-04-10',
    override_pickup_date: '2026-04-24',
    dumpster_size: '20-yard',
  };

  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();

    // After Phase 1 (manager-overload refactor), createExchange reads
    // chain/delivery-link/customer through the active EntityManager
    // (the dataSource.transaction-supplied trx in the no-manager call
    // path). Mocks live on the trx-side repos.
    h.trxChainRepo.findOne.mockResolvedValue({ ...baseChain });
    // trxLinkRepo.findOne is called twice — once for the delivery
    // link (task_type='drop_off'), once for the currently-scheduled
    // pickup (task_type='pick_up' status='scheduled'). Route by query
    // so individual tests can override the pickup branch.
    h.trxLinkRepo.findOne.mockImplementation(async (opts: any) => {
      if (opts?.where?.task_type === 'drop_off') {
        // Phase 8 regression fix — service_address feeds BOTH the
        // pricing coord extract AND inheritance onto new exchange +
        // replacement pickup jobs.
        return {
          id: 'link-delivery',
          job: { service_address: DELIVERY_ADDRESS },
        };
      }
      // Default for the pick_up lookup; tests override per scenario.
      return null;
    });
    h.trxCustomerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      tenant_id: tenantId,
      type: 'residential',
    });
    h.pricingService.calculate.mockResolvedValue({
      breakdown: { total: 100, basePrice: 100 },
    });
  });

  it('throws ConflictException with NO_SCHEDULED_PICKUP_FOR_EXCHANGE code AND leaves chain state unchanged when no scheduled pickup link exists', async () => {
    // pick_up lookup returns null → guard fires. Default mock in
    // beforeEach already does this, but kept explicit for clarity.
    h.trxLinkRepo.findOne.mockImplementation(async (opts: any) => {
      if (opts?.where?.task_type === 'drop_off') {
        return { id: 'link-delivery', job: { service_address: DELIVERY_ADDRESS } };
      }
      return null;
    });

    await expect(
      h.service.createExchange(tenantId, chainId, dto),
    ).rejects.toBeInstanceOf(ConflictException);

    // Re-run to inspect the locked error body.
    let captured: ConflictException | null = null;
    try {
      await h.service.createExchange(tenantId, chainId, dto);
    } catch (e) {
      captured = e as ConflictException;
    }
    expect(captured).not.toBeNull();
    expect(captured.getStatus()).toBe(409);
    expect(captured.getResponse()).toEqual({
      code: 'NO_SCHEDULED_PICKUP_FOR_EXCHANGE',
      message:
        'Cannot schedule exchange: this rental chain has no scheduled pickup to replace. Reopen the cancelled pickup or cancel the chain first.',
    });

    // CRITICAL — write-ordering guard. The guard fires before any
    // write inside the transaction. Assert no chain/link/job writes
    // were persisted on the failed path.
    expect(h.trxChainRepo.save).not.toHaveBeenCalled();
    expect(h.trxLinkRepo.save).not.toHaveBeenCalled();
    expect(h.trxLinkRepo.update).not.toHaveBeenCalled();
    expect(h.trxJobRepo.update).not.toHaveBeenCalled();
    expect(h.trxJobRepo.save).not.toHaveBeenCalled();
  });

  it('happy path: guard passes and the transaction proceeds to cancel the current pickup when a scheduled pickup link exists', async () => {
    // In-transaction pickup-link lookup returns a real link → guard
    // passes and the cancel-old-pickup write fires at step 1 of the
    // transaction. We assert that write (proves the guard did NOT
    // short-circuit); we do not attempt to assert the full exchange-
    // creation contract (out of scope per the prompt's guidance).
    const currentPickupLink = {
      id: 'link-pickup',
      job_id: 'job-pickup',
      rental_chain_id: chainId,
      task_type: 'pick_up',
      status: 'scheduled',
      scheduled_date: '2026-04-15',
      sequence_number: 2,
      previous_link_id: null,
    };
    h.trxLinkRepo.findOne.mockImplementation(async (opts: any) => {
      if (opts?.where?.task_type === 'drop_off') {
        return { id: 'link-delivery', job: { service_address: DELIVERY_ADDRESS } };
      }
      return currentPickupLink;
    });

    // The downstream writes may or may not complete — extensive
    // mocking of issueNextJobNumber + chain save etc. is out of scope.
    // We only care that the guard was bypassed, proven by the cancel-
    // old-pickup save firing.
    await h.service.createExchange(tenantId, chainId, dto).catch(() => {
      /* downstream write failures after the guard are not this test's concern */
    });

    // Step 1 of the transaction: cancel the old pickup.
    expect(h.trxLinkRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'link-pickup',
        status: 'cancelled',
      }),
    );
    // Step 1b: mark the old pickup job cancelled (tenant-scoped).
    expect(h.trxJobRepo.update).toHaveBeenCalledWith(
      { id: 'job-pickup', tenant_id: tenantId },
      expect.objectContaining({
        status: 'cancelled',
        cancellation_reason: 'exchange_replacement',
      }),
    );

    // Phase 8 regression fix — both the new exchange job and its
    // replacement pickup job must inherit service_address from the
    // delivery link so dispatch/jobs/driver tiles render "Line 2: Address".
    expect(h.trxJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ job_type: 'exchange', service_address: DELIVERY_ADDRESS }),
    );
    expect(h.trxJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ job_type: 'pickup', service_address: DELIVERY_ADDRESS }),
    );
  });

  // ── Manager-overload (Phase 1 — orchestration delegation prereq) ──

  it('manager overload: when an EntityManager is passed, createExchange does NOT open its own transaction (joins the caller transaction instead)', async () => {
    const currentPickupLink = {
      id: 'link-pickup',
      job_id: 'job-pickup',
      rental_chain_id: chainId,
      task_type: 'pick_up',
      status: 'scheduled',
      scheduled_date: '2026-04-15',
      sequence_number: 2,
      previous_link_id: null,
    };
    h.trxLinkRepo.findOne.mockImplementation(async (opts: any) => {
      if (opts?.where?.task_type === 'drop_off') {
        return { id: 'link-delivery', job: { service_address: DELIVERY_ADDRESS } };
      }
      return currentPickupLink;
    });

    // Synthesize an outer-caller manager that proxies to the same
    // trx-side mocks the harness already exposes. If createExchange
    // honors the manager param, every getRepository call reaches the
    // trx-side mocks via THIS proxy, and the harness's
    // dataSource.transaction stub is NEVER invoked.
    const outerManager = {
      getRepository: (entity: unknown) => {
        if (entity === RentalChain) return h.trxChainRepo;
        if (entity === TaskChainLink) return h.trxLinkRepo;
        if (entity === Job) return h.trxJobRepo;
        if (entity === Customer) return h.trxCustomerRepo;
        if (entity === TenantSettings) return h.trxTenantSettingsRepo;
        throw new Error('unmocked entity');
      },
    };

    await h.service
      .createExchange(tenantId, chainId, dto, outerManager as any)
      .catch(() => {
        /* downstream pricing/billing mocks are not this test's concern */
      });

    // The contract proof: when a manager is supplied, the service
    // MUST NOT open its own dataSource.transaction. Any regression
    // that re-introduces an inner transaction would commit
    // independently regardless of the caller's outer rollback —
    // exactly the bug class this overload exists to prevent.
    expect(h.dataSource.transaction).not.toHaveBeenCalled();

    // And the canonical exchange writes still fire (delegation works,
    // it just uses the supplied manager's repos).
    expect(h.trxJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ job_type: 'exchange' }),
    );
    expect(h.trxJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ job_type: 'pickup' }),
    );
  });
});

// ── Asset-for-activation guard suite ──────────────────────────────
// Mirrors the DB CHECK `rental_chain_active_requires_asset` at the
// service layer. Two create-path tests + two update-path tests.

describe('RentalChainsService — chain activation requires asset_id', () => {
  const tenantId = 'tenant-1';
  const chainId = 'chain-1';
  const EXPECTED_MESSAGE =
    'chain_activation_requires_asset: Cannot activate rental chain without an asset assigned';

  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it('createChain: throws BadRequestException when dto.asset_id is missing (zero DB writes)', async () => {
    let captured: BadRequestException | null = null;
    try {
      await h.service.createChain(tenantId, {
        customer_id: 'cust-1',
        drop_off_date: '2026-04-01',
        dumpster_size: '20yd',
        // asset_id intentionally omitted
      });
    } catch (e) {
      captured = e as BadRequestException;
    }
    expect(captured).not.toBeNull();
    expect(captured).toBeInstanceOf(BadRequestException);
    expect(captured.getStatus()).toBe(400);
    expect(captured.message).toBe(EXPECTED_MESSAGE);

    // Guard fires before any chain / link / job write.
    expect(h.chainRepo.save).not.toHaveBeenCalled();
    expect(h.trxChainRepo.save).not.toHaveBeenCalled();
    expect(h.trxJobRepo.save).not.toHaveBeenCalled();
  });

  it('createChain: guard passes when dto.asset_id is present (chainRepo.save reached)', async () => {
    // Happy-path side: downstream job creation needs full mocking that
    // is out of scope for a guard test. We only need to prove the
    // guard did NOT short-circuit, which is true iff `chainRepo.save`
    // is reached. The base harness doesn't expose `chainRepo.create`
    // (only findOne/save) because the other suites don't exercise the
    // non-trx create; add it here so `this.chainRepo.create(...)`
    // returns the payload verbatim.
    (h.chainRepo as unknown as { create: jest.Mock }).create = jest.fn(
      (x: unknown) => x,
    );
    h.chainRepo.save.mockImplementation(async (c: unknown) => ({
      ...(c as Record<string, unknown>),
      id: 'new-chain-id',
    }));

    await h.service
      .createChain(tenantId, {
        customer_id: 'cust-1',
        asset_id: 'asset-1',
        drop_off_date: '2026-04-01',
        dumpster_size: '20yd',
        rental_days: 14,
      })
      .catch(() => {
        // Downstream job creation may fail due to harness scope
        // (Job repo is mocked minimally). Guard-bypass is proven by
        // chainRepo.save being called below; downstream failures are
        // not this test's concern.
      });

    expect(h.chainRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: tenantId,
        customer_id: 'cust-1',
        asset_id: 'asset-1',
        status: 'active',
      }),
    );
  });

  it('updateChain: throws BadRequestException when transitioning to status=active on a chain with no asset_id (zero writes)', async () => {
    h.chainRepo.findOne.mockResolvedValue({
      id: chainId,
      tenant_id: tenantId,
      asset_id: null,
      drop_off_date: '2026-04-01',
      expected_pickup_date: '2026-04-15',
      status: 'cancelled',
    });

    let captured: BadRequestException | null = null;
    try {
      await h.service.updateChain(tenantId, chainId, {
        status: 'active',
      });
    } catch (e) {
      captured = e as BadRequestException;
    }
    expect(captured).not.toBeNull();
    expect(captured).toBeInstanceOf(BadRequestException);
    expect(captured.getStatus()).toBe(400);
    expect(captured.message).toBe(EXPECTED_MESSAGE);

    // Zero side effects on the failed path.
    expect(h.trxChainRepo.save).not.toHaveBeenCalled();
  });

  it('updateChain: guard passes when transitioning to status=active on a chain that has asset_id (chain saved with active)', async () => {
    h.chainRepo.findOne.mockResolvedValue({
      id: chainId,
      tenant_id: tenantId,
      asset_id: 'asset-1',
      drop_off_date: '2026-04-01',
      expected_pickup_date: '2026-04-15',
      status: 'cancelled',
    });

    await h.service.updateChain(tenantId, chainId, {
      status: 'active',
    });

    expect(h.trxChainRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: chainId,
        asset_id: 'asset-1',
        status: 'active',
      }),
    );
  });
});
