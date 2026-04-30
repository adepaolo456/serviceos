/**
 * AssetsService.lockAssetRow — PR-B Surface 1 helper coverage.
 *
 * The helper is the shared primitive used by JobsService._createInTx
 * (and, in a follow-up sprint, by other reservation surfaces) to
 * pessimistically lock an asset row inside a caller-supplied TX. The
 * race it closes is two _createInTx callers reading the same asset
 * before either INSERTed a job — both succeeded because no DB unique
 * protected (tenant_id, asset_id). The lock makes the second caller
 * block until the first commits; the post-lock conflict re-check at
 * the call site then surfaces a clean BadRequestException.
 *
 * These tests defend the helper's contract:
 *   1. Returns the row when it exists in tenant scope.
 *   2. Throws NotFoundException for a missing asset id.
 *   3. Throws NotFoundException for cross-tenant access (asset exists
 *      but tenant_id mismatches) — multi-tenant safety standing rule.
 *   4. Passes `lock: { mode: 'pessimistic_write' }` to findOne — locks
 *      the contract against a future maintainer dropping the lock.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { AssetsService } from './assets.service';
import { Asset } from './entities/asset.entity';
import { Job } from '../jobs/entities/job.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';

interface Harness {
  service: AssetsService;
  // findOne spy on the manager-bound asset repo. The helper resolves
  // its repo via `manager.getRepository(Asset)`, so this is the spy
  // that observes every lock query.
  trxAssetFindOne: jest.Mock;
  // EntityManager stub passed positionally into lockAssetRow so the
  // test asserts the helper never reaches into `this` for a manager.
  trxManager: EntityManager;
}

async function buildHarness(): Promise<Harness> {
  const trxAssetFindOne = jest.fn();
  const trxAsset = { findOne: trxAssetFindOne };
  const trxManager = {
    getRepository: (entity: unknown) => {
      if (entity === Asset) return trxAsset;
      throw new Error(
        `unmocked trx repo: ${(entity as { name?: string })?.name ?? '?'}`,
      );
    },
  } as unknown as EntityManager;

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AssetsService,
      // Bare repos — only required so AssetsService's constructor
      // boots. The helper under test never touches them.
      { provide: getRepositoryToken(Asset), useValue: {} },
      { provide: getRepositoryToken(Job), useValue: {} },
      { provide: getRepositoryToken(RentalChain), useValue: {} },
      { provide: DataSource, useValue: {} },
    ],
  }).compile();

  return {
    service: module.get(AssetsService),
    trxAssetFindOne,
    trxManager,
  };
}

describe('AssetsService.lockAssetRow', () => {
  it('returns the locked asset when (id, tenant_id) match', async () => {
    const h = await buildHarness();
    const lockedAsset = {
      id: 'asset-1',
      tenant_id: 'tenant-1',
      status: 'available',
    } as unknown as Asset;
    h.trxAssetFindOne.mockResolvedValueOnce(lockedAsset);

    const result = await h.service.lockAssetRow(
      h.trxManager,
      'asset-1',
      'tenant-1',
    );

    expect(result).toBe(lockedAsset);
    expect(h.trxAssetFindOne).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when the asset id does not exist', async () => {
    const h = await buildHarness();
    h.trxAssetFindOne.mockResolvedValueOnce(null);

    await expect(
      h.service.lockAssetRow(h.trxManager, 'asset-missing', 'tenant-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException for cross-tenant access (asset exists in a different tenant)', async () => {
    const h = await buildHarness();
    // Tenant-mismatch is realised at the DB layer: findOne with
    // tenant_id in the WHERE clause returns null when the asset
    // belongs to another tenant. The helper surfaces 404 — never
    // 200, never a leak — preserving the multi-tenant safety rule.
    h.trxAssetFindOne.mockResolvedValueOnce(null);

    await expect(
      h.service.lockAssetRow(h.trxManager, 'asset-1', 'tenant-other'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('issues findOne with tenant_id in the WHERE clause and pessimistic_write lock', async () => {
    const h = await buildHarness();
    h.trxAssetFindOne.mockResolvedValueOnce({
      id: 'asset-1',
      tenant_id: 'tenant-1',
    } as unknown as Asset);

    await h.service.lockAssetRow(h.trxManager, 'asset-1', 'tenant-1');

    // The single positional arg to findOne is the FindOneOptions object.
    // Pin both the WHERE shape (tenant_id MUST be present — multi-tenant
    // standing rule) and the lock mode (pessimistic_write — the whole
    // point of the helper).
    expect(h.trxAssetFindOne).toHaveBeenCalledWith({
      where: { id: 'asset-1', tenant_id: 'tenant-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('resolves the repo from the supplied manager, never from `this`', async () => {
    const h = await buildHarness();
    const lockedAsset = {
      id: 'asset-1',
      tenant_id: 'tenant-1',
    } as unknown as Asset;
    h.trxAssetFindOne.mockResolvedValueOnce(lockedAsset);

    // Spy on the manager's getRepository to prove the helper used the
    // caller-supplied manager (caller owns the TX boundary).
    const getRepoSpy = jest.spyOn(h.trxManager, 'getRepository');

    await h.service.lockAssetRow(h.trxManager, 'asset-1', 'tenant-1');

    expect(getRepoSpy).toHaveBeenCalledWith(Asset);
  });
});
