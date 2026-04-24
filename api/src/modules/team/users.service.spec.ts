/**
 * UsersService — team lifecycle negative + positive paths.
 *
 * Covers the 10-test matrix from Phase 1 sign-off, plus bonus test #12
 * (PATCH /team/:id Owner-role footgun closure, tested at the controller's
 * guard layer by exercising the validation branch in UsersService-less
 * isolation — see §bonus below).
 *
 * Bonus #11 (DB-trigger defense-in-depth) intentionally skipped: the
 * `synchronize: true` test DB only materializes entity-decorator columns;
 * it does NOT run the migration that installs the trigger. Adding it
 * would require either the docker-compose e2e harness or a bespoke
 * trigger-sync — both well outside the ~40-line-per-bonus-test budget.
 * The trigger is still exercised manually in Supabase via the post-apply
 * verification queries (see migration 2026-04-24-users-soft-delete-and-audit.sql).
 *
 * Harness mirrors billing.service.spec.ts:24-130:
 *   - mocked repos for User + UserAuditLog
 *   - mocked DataSource with a transaction wrapper that invokes the
 *     callback then calls the `transactionCommit` spy on success only
 *   - the callback receives a stub `EntityManager` whose `findOne`,
 *     `update`, `insert` route to trx-scoped mocks
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { UsersService } from './users.service';
import { User } from '../auth/entities/user.entity';
import { UserAuditLog } from './entities/user-audit-log.entity';

interface Harness {
  service: UsersService;
  usersRepo: {
    findOne: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  auditRepo: { insert: jest.Mock };
  transactionCommit: jest.Mock;
  trxFindOne: jest.Mock;
  trxUpdate: jest.Mock;
  trxInsert: jest.Mock;
  dataSource: { transaction: jest.Mock };
}

async function buildHarness(): Promise<Harness> {
  const usersRepo = {
    findOne: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const auditRepo = { insert: jest.fn() };

  const transactionCommit = jest.fn();
  const trxFindOne = jest.fn();
  const trxUpdate = jest.fn();
  const trxInsert = jest.fn();

  const trx: Partial<EntityManager> = {
    findOne: trxFindOne as EntityManager['findOne'],
    update: trxUpdate as EntityManager['update'],
    insert: trxInsert as EntityManager['insert'],
  };

  const dataSource = {
    transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) => {
      const result = await cb(trx as EntityManager);
      transactionCommit();
      return result;
    }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      UsersService,
      { provide: getRepositoryToken(User), useValue: usersRepo },
      { provide: getRepositoryToken(UserAuditLog), useValue: auditRepo },
      { provide: getDataSourceToken(), useValue: dataSource },
    ],
  }).compile();

  return {
    service: module.get(UsersService),
    usersRepo,
    auditRepo,
    transactionCommit,
    trxFindOne,
    trxUpdate,
    trxInsert,
    dataSource,
  };
}

describe('UsersService — Phase 1 team lifecycle', () => {
  // ── #1 — Deactivate positive ────────────────────────────────────────────
  it('1. deactivate positive — admin deactivates dispatcher', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-disp',
      role: 'dispatcher',
      is_active: true,
      deleted_at: null,
    });
    h.usersRepo.update.mockResolvedValue({ affected: 1 });

    const result = await h.service.deactivateUser('t-1', 'u-disp', 'u-admin');

    expect(result.is_active).toBe(false);
    expect(h.usersRepo.update).toHaveBeenCalledWith(
      { id: 'u-disp', tenant_id: 't-1' },
      { is_active: false, refresh_token_hash: null },
    );
    expect(h.auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 't-1',
        actor_id: 'u-admin',
        target_id: 'u-disp',
        action: 'deactivated',
      }),
    );
  });

  // ── #2 — Deactivate negative (last-owner service-layer guard) ───────────
  it('2. deactivate negative — throws cannot_remove_last_owner on last owner', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-owner',
      role: 'owner',
      is_active: true,
      deleted_at: null,
    });
    h.usersRepo.count.mockResolvedValue(0);

    await expect(
      h.service.deactivateUser('t-1', 'u-owner', 'u-owner'),
    ).rejects.toMatchObject({
      response: { error: 'cannot_remove_last_owner' },
    });
    expect(h.usersRepo.update).not.toHaveBeenCalled();
    expect(h.auditRepo.insert).not.toHaveBeenCalled();
  });

  // ── #3 — Delete positive ────────────────────────────────────────────────
  it('3. delete positive — sets deleted_at, logs action=deleted', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-disp',
      role: 'dispatcher',
      is_active: true,
      deleted_at: null,
    });
    h.usersRepo.update.mockResolvedValue({ affected: 1 });

    const result = await h.service.softDeleteUser('t-1', 'u-disp', 'u-admin');

    expect(result.deleted_at).toBeInstanceOf(Date);
    const updateCall = h.usersRepo.update.mock.calls[0][1];
    expect(updateCall.deleted_at).toBeInstanceOf(Date);
    expect(updateCall.is_active).toBe(false);
    expect(updateCall.refresh_token_hash).toBe(null);
    expect(h.auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deleted' }),
    );
  });

  // ── #4 — Delete negative (last-owner) ────────────────────────────────────
  it('4. delete negative — throws cannot_remove_last_owner on last owner', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-owner',
      role: 'owner',
      is_active: true,
      deleted_at: null,
    });
    h.usersRepo.count.mockResolvedValue(0);

    await expect(
      h.service.softDeleteUser('t-1', 'u-owner', 'u-owner'),
    ).rejects.toMatchObject({
      response: { error: 'cannot_remove_last_owner' },
    });
    expect(h.usersRepo.update).not.toHaveBeenCalled();
  });

  // ── #5 — Reactivate positive ────────────────────────────────────────────
  it('5. reactivate positive — restores is_active, logs action=reactivated', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-disp',
      role: 'dispatcher',
      is_active: false,
      deleted_at: null,
    });
    h.usersRepo.update.mockResolvedValue({ affected: 1 });

    const result = await h.service.reactivateUser('t-1', 'u-disp', 'u-admin');

    expect(result.is_active).toBe(true);
    expect(h.usersRepo.update).toHaveBeenCalledWith(
      { id: 'u-disp', tenant_id: 't-1' },
      { is_active: true },
    );
    expect(h.auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reactivated' }),
    );
  });

  // ── #6 — Owner transfer positive ────────────────────────────────────────
  it('6. owner transfer positive — atomic role swap + audit row', async () => {
    const h = await buildHarness();
    h.trxFindOne
      // current owner lookup
      .mockResolvedValueOnce({
        id: 'u-owner',
        tenant_id: 't-1',
        role: 'owner',
        is_active: true,
        deleted_at: null,
      })
      // new owner (admin) lookup
      .mockResolvedValueOnce({
        id: 'u-admin',
        tenant_id: 't-1',
        role: 'admin',
        is_active: true,
        deleted_at: null,
      });

    const result = await h.service.transferOwnership(
      't-1',
      'u-owner',
      'u-admin',
      'u-owner',
    );

    expect(result).toEqual({ previousOwnerId: 'u-owner', newOwnerId: 'u-admin' });
    // Demote + promote + audit — all 3 writes in the transaction.
    expect(h.trxUpdate).toHaveBeenCalledWith(User, 'u-owner', { role: 'admin' });
    expect(h.trxUpdate).toHaveBeenCalledWith(User, 'u-admin', { role: 'owner' });
    expect(h.trxInsert).toHaveBeenCalledWith(
      UserAuditLog,
      expect.objectContaining({ action: 'owner_transferred' }),
    );
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  // ── #7 — Owner transfer rollback ────────────────────────────────────────
  it('7. owner transfer rollback — audit insert failure prevents commit', async () => {
    const h = await buildHarness();
    h.trxFindOne
      .mockResolvedValueOnce({
        id: 'u-owner',
        tenant_id: 't-1',
        role: 'owner',
        is_active: true,
        deleted_at: null,
      })
      .mockResolvedValueOnce({
        id: 'u-admin',
        tenant_id: 't-1',
        role: 'admin',
        is_active: true,
        deleted_at: null,
      });
    h.trxInsert.mockRejectedValue(new Error('audit insert failed'));

    await h.service
      .transferOwnership('t-1', 'u-owner', 'u-admin', 'u-owner')
      .catch(() => { /* expected */ });

    // Role swaps ran inside the transaction (pre-rollback)…
    expect(h.trxUpdate).toHaveBeenCalledTimes(2);
    // …but the tx never committed, so those writes roll back.
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // ── #8 — Auth invalidation ──────────────────────────────────────────────
  // Deactivate nulls refresh_token_hash. The caller's next refresh attempt
  // then fails in AuthService.refreshToken (see auth.service.ts:309 —
  // `if (!user || !user.refresh_token_hash)` returns 401). Access tokens
  // continue up to their 15m TTL; we do NOT attempt to prove the 15m
  // expiry here, only that the revocation write lands.
  it('8. auth invalidation — deactivate nulls refresh_token_hash', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-disp',
      role: 'dispatcher',
      is_active: true,
      deleted_at: null,
    });
    h.usersRepo.update.mockResolvedValue({ affected: 1 });

    await h.service.deactivateUser('t-1', 'u-disp', 'u-admin');

    const updateArg = h.usersRepo.update.mock.calls[0][1];
    expect(updateArg.refresh_token_hash).toBeNull();
  });

  // ── #9 — Tenant scoping ─────────────────────────────────────────────────
  it('9. tenant scoping — foreign-tenant user not found', async () => {
    const h = await buildHarness();
    // Repo returns null because the WHERE filters tenant_id = 't-A' but
    // the target belongs to tenant B — simulates the real query.
    h.usersRepo.findOne.mockResolvedValue(null);

    await expect(
      h.service.deactivateUser('t-A', 'u-in-tenant-B', 'u-admin'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.usersRepo.update).not.toHaveBeenCalled();
  });

  // ── #10 — Role enforcement (service-layer surrogate) ────────────────────
  // The RolesGuard is declarative NestJS metadata; it's exercised by
  // controller-level e2e tests, not unit tests. The equivalent
  // authorization guard inside UsersService is the owner-only check on
  // transferOwnership. Verify a non-Owner caller is rejected with 403
  // before any DB hit — same defensive posture as the RolesGuard.
  it('10. role enforcement — non-Owner cannot initiate ownership transfer', async () => {
    const h = await buildHarness();

    await expect(
      h.service.transferOwnership('t-1', 'u-owner', 'u-admin', 'u-admin'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.dataSource.transaction).not.toHaveBeenCalled();
  });

  // ── #12 (bonus) — PATCH /team/:id footgun closure ───────────────────────
  // Exercises the service-layer invariant that backs the controller
  // tightening: even if a future caller wires PATCH to go through
  // UsersService, `assertNotLastOwner` prevents the role change that
  // would strand the tenant ownerless.
  it('12. PATCH footgun — assertNotLastOwner rejects owner→admin when last', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-owner',
      role: 'owner',
      is_active: true,
      deleted_at: null,
    });
    h.usersRepo.count.mockResolvedValue(0);

    await expect(
      h.service.assertNotLastOwner('t-1', 'u-owner'),
    ).rejects.toMatchObject({
      response: { error: 'cannot_remove_last_owner' },
    });
  });

  // ── Non-Owner target is a no-op for assertNotLastOwner ───────────────────
  it('assertNotLastOwner — no-op when target is not an Owner', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-disp',
      role: 'dispatcher',
      is_active: true,
      deleted_at: null,
    });

    await expect(h.service.assertNotLastOwner('t-1', 'u-disp')).resolves.toBeUndefined();
    // Never consults count — the role check short-circuits.
    expect(h.usersRepo.count).not.toHaveBeenCalled();
  });

  it('assertNotLastOwner — passes when another active Owner exists', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue({
      id: 'u-owner-A',
      role: 'owner',
      is_active: true,
      deleted_at: null,
    });
    h.usersRepo.count.mockResolvedValue(1);

    await expect(
      h.service.assertNotLastOwner('t-1', 'u-owner-A'),
    ).resolves.toBeUndefined();
  });

  // ── Guard against BadRequestException swallowing NotFoundException ─────
  it('deactivateUser — NotFound when target belongs to a different tenant', async () => {
    const h = await buildHarness();
    h.usersRepo.findOne.mockResolvedValue(null);

    await expect(
      h.service.deactivateUser('t-1', 'u-missing', 'u-admin'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Ownership transfer rejects self-transfer (useless work; clear error).
  it('transferOwnership — rejects self-transfer', async () => {
    const h = await buildHarness();

    await expect(
      h.service.transferOwnership('t-1', 'u-owner', 'u-owner', 'u-owner'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
