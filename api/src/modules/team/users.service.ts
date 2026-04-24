import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { UserAuditLog, UserAuditAction } from './entities/user-audit-log.entity';

// Minimal return shape for the employee after a lifecycle action. The
// controller re-serializes into the TeamMember wire format; this shape
// is only what the service needs to prove the change landed.
export interface LifecycleResult {
  id: string;
  is_active: boolean;
  deleted_at: Date | null;
  role: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(UserAuditLog)
    private readonly auditRepo: Repository<UserAuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // Invariants
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Service-layer mirror of the DB trigger
   * `users_tenant_requires_active_owner`. Fails-fast with a clean 400 when
   * the target is the last active Owner. Matches the rental-chains
   * `assertAssetForActivation` pattern at rental-chains.service.ts:94.
   *
   * Only throws when `targetUserId` is currently an active non-deleted
   * Owner AND no other active non-deleted Owner exists in the tenant.
   * Non-Owner targets pass through unconditionally — callers don't need
   * to check the target's role before invoking this.
   */
  async assertNotLastOwner(
    tenantId: string,
    targetUserId: string,
  ): Promise<void> {
    const target = await this.usersRepo.findOne({
      where: { id: targetUserId, tenant_id: tenantId },
      select: ['id', 'role', 'is_active', 'deleted_at'],
    });
    if (!target) return;
    if (target.role !== 'owner') return;
    if (!target.is_active) return;
    if (target.deleted_at) return;

    const otherActiveOwners = await this.usersRepo.count({
      where: {
        tenant_id: tenantId,
        id: Not(targetUserId),
        role: 'owner',
        is_active: true,
        deleted_at: IsNull(),
      },
    });

    if (otherActiveOwners === 0) {
      throw new BadRequestException({
        error: 'cannot_remove_last_owner',
        message: 'Tenant must have at least one active owner',
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Lifecycle actions
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Deactivate an employee. Nulls `refresh_token_hash` so existing refresh
   * attempts fail (access token continues up to its 15m TTL; forced logout
   * on next refresh). Matches Option B from sign-off — cheaper than a
   * per-request DB check on the JWT strategy.
   */
  async deactivateUser(
    tenantId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<LifecycleResult> {
    const target = await this.loadTargetForMutation(tenantId, targetUserId);

    await this.assertNotLastOwner(tenantId, targetUserId);

    // Narrow-catch rationale (Phase B): `update()` does not throw on
    // zero-row-affected, so we check `affected` explicitly and raise
    // NotFound. Any other error (DB connection, trigger violation) is
    // intentionally propagated — do NOT wrap in try/catch here.
    const result = await this.usersRepo.update(
      { id: targetUserId, tenant_id: tenantId },
      { is_active: false, refresh_token_hash: null } as Partial<User>,
    );
    if (result.affected === 0) {
      throw new NotFoundException({ error: 'user_not_found' });
    }

    await this.writeAudit(tenantId, actorUserId, targetUserId, 'deactivated', {
      previous_role: target.role,
    });

    return {
      id: targetUserId,
      is_active: false,
      deleted_at: null,
      role: target.role,
    };
  }

  async reactivateUser(
    tenantId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<LifecycleResult> {
    const target = await this.loadTargetForMutation(tenantId, targetUserId);

    if (target.deleted_at) {
      // Deleted users are terminal via UI. Do not allow reactivation of a
      // soft-deleted record — they'd need to be restored by a different path.
      throw new BadRequestException({ error: 'user_deleted' });
    }

    const result = await this.usersRepo.update(
      { id: targetUserId, tenant_id: tenantId },
      { is_active: true } as Partial<User>,
    );
    if (result.affected === 0) {
      throw new NotFoundException({ error: 'user_not_found' });
    }

    await this.writeAudit(tenantId, actorUserId, targetUserId, 'reactivated', {
      role: target.role,
    });

    return {
      id: targetUserId,
      is_active: true,
      deleted_at: null,
      role: target.role,
    };
  }

  /**
   * Soft-delete (sets `deleted_at`). Permanently hides the user from the UI
   * but preserves the row so jobs / audit / historical data stay intact.
   * Also deactivates and nulls refresh_token_hash — a deleted user is also
   * inactive.
   */
  async softDeleteUser(
    tenantId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<LifecycleResult> {
    const target = await this.loadTargetForMutation(tenantId, targetUserId);

    await this.assertNotLastOwner(tenantId, targetUserId);

    const now = new Date();
    const result = await this.usersRepo.update(
      { id: targetUserId, tenant_id: tenantId },
      {
        deleted_at: now,
        is_active: false,
        refresh_token_hash: null,
      } as Partial<User>,
    );
    if (result.affected === 0) {
      throw new NotFoundException({ error: 'user_not_found' });
    }

    await this.writeAudit(tenantId, actorUserId, targetUserId, 'deleted', {
      previous_role: target.role,
    });

    return {
      id: targetUserId,
      is_active: false,
      deleted_at: now,
      role: target.role,
    };
  }

  /**
   * Transfer ownership atomically. Demotes the current Owner to `admin`,
   * promotes the target to `owner`, and writes the audit row — all inside a
   * single transaction. Matches the password-reset pattern at
   * password-reset.service.ts:146-206.
   *
   * Eligibility (enforced, not just UI-hinted):
   *   - Caller MUST be the current Owner themselves (authorization)
   *   - Current Owner and new Owner must both belong to `tenantId`
   *   - New Owner must currently be an active, non-deleted `admin`
   */
  async transferOwnership(
    tenantId: string,
    currentOwnerId: string,
    newOwnerId: string,
    actorUserId: string,
  ): Promise<{ previousOwnerId: string; newOwnerId: string }> {
    if (currentOwnerId === newOwnerId) {
      throw new BadRequestException({ error: 'ineligible_owner_target' });
    }
    // Authorization: only the current Owner themselves may initiate.
    if (actorUserId !== currentOwnerId) {
      throw new ForbiddenException({ error: 'only_owner_can_transfer' });
    }

    return await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(User, {
        where: { id: currentOwnerId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current || current.deleted_at) {
        throw new NotFoundException({ error: 'user_not_found' });
      }
      if (current.role !== 'owner' || !current.is_active) {
        throw new BadRequestException({ error: 'current_user_not_active_owner' });
      }

      const next = await manager.findOne(User, {
        where: { id: newOwnerId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!next || next.deleted_at) {
        throw new NotFoundException({ error: 'user_not_found' });
      }
      // Transfer eligibility: admin only (dispatcher must go admin first).
      if (next.role !== 'admin' || !next.is_active) {
        throw new BadRequestException({ error: 'ineligible_owner_target' });
      }

      await manager.update(User, current.id, { role: 'admin' } as Partial<User>);
      await manager.update(User, next.id, { role: 'owner' } as Partial<User>);

      // Audit insert is inside the transaction so rollback on any later
      // failure (mocked in the rollback test) undoes the role swaps too.
      await manager.insert(UserAuditLog, {
        tenant_id: tenantId,
        actor_id: actorUserId,
        target_id: current.id,
        action: 'owner_transferred' as UserAuditAction,
        metadata: { from: current.id, to: next.id },
      });

      return { previousOwnerId: current.id, newOwnerId: next.id };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Narrow-catch rationale (Phase B): a lookup miss on the target is a
   * 404, surfaced with a stable error code. Any other error from the repo
   * (connection, constraint) propagates so the controller's
   * filter can decide on 500 vs 400.
   */
  private async loadTargetForMutation(
    tenantId: string,
    targetUserId: string,
  ): Promise<Pick<User, 'id' | 'role' | 'is_active' | 'deleted_at'>> {
    const target = await this.usersRepo.findOne({
      where: { id: targetUserId, tenant_id: tenantId },
      select: ['id', 'role', 'is_active', 'deleted_at'],
    });
    if (!target) {
      throw new NotFoundException({ error: 'user_not_found' });
    }
    return target;
  }

  private async writeAudit(
    tenantId: string,
    actorId: string | null,
    targetId: string,
    action: UserAuditAction,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditRepo.insert({
      tenant_id: tenantId,
      actor_id: actorId,
      target_id: targetId,
      action,
      metadata,
    });
  }
}
