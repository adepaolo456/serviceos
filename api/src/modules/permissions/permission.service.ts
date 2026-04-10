import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';

/**
 * Phase 10 — Tenant-configurable RBAC for credit-control actions.
 *
 * Resolves permissions for a given user role against the tenant's
 * `settings.team_permissions` JSONB config. Owner always has full
 * access. Missing config falls back to defaults that exactly match
 * the pre-Phase-10 hardcoded behavior.
 *
 * Backend-authoritative — frontend uses resolved permissions for
 * UX only.
 */

export const PERMISSION_KEYS = [
  'credit_policy_edit',
  'credit_hold_manage',
  'booking_override',
  'dispatch_override',
  'credit_audit_view',
  'credit_analytics_view',
  'credit_queue_manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface TeamPermissions {
  admin: Record<string, boolean>;
  dispatcher: Record<string, boolean>;
  office: Record<string, boolean>;
}

const DEFAULT_TEAM_PERMISSIONS: TeamPermissions = {
  admin: {
    credit_policy_edit: true,
    credit_hold_manage: true,
    booking_override: true,
    dispatch_override: true,
    credit_audit_view: true,
    credit_analytics_view: true,
    credit_queue_manage: true,
  },
  dispatcher: {
    credit_policy_edit: false,
    credit_hold_manage: false,
    booking_override: false,
    dispatch_override: false,
    credit_audit_view: false,
    credit_analytics_view: false,
    credit_queue_manage: false,
  },
  office: {
    credit_policy_edit: false,
    credit_hold_manage: false,
    booking_override: false,
    dispatch_override: false,
    credit_audit_view: false,
    credit_analytics_view: false,
    credit_queue_manage: false,
  },
};

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  /**
   * Check a single permission for a user role in a tenant.
   *
   * Resolution:
   *   1. owner → always true
   *   2. Load config from tenants.settings.team_permissions[role]
   *   3. Config key exists → return it
   *   4. Config missing → return default
   *   5. Unknown role → false
   */
  async hasPermission(
    tenantId: string,
    userRole: string,
    permission: PermissionKey,
  ): Promise<boolean> {
    if (userRole === 'owner') return true;

    const config = await this.loadConfig(tenantId);
    const roleConfig = config[userRole as keyof TeamPermissions];
    if (!roleConfig) return false;

    return roleConfig[permission] ?? this.getDefault(userRole, permission);
  }

  /**
   * Get all resolved permissions for a user role.
   */
  async getPermissions(
    tenantId: string,
    userRole: string,
  ): Promise<Record<string, boolean>> {
    if (userRole === 'owner') {
      return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));
    }

    const config = await this.loadConfig(tenantId);
    const roleConfig = config[userRole as keyof TeamPermissions];
    const result: Record<string, boolean> = {};

    for (const key of PERMISSION_KEYS) {
      if (roleConfig && key in roleConfig) {
        result[key] = !!roleConfig[key];
      } else {
        result[key] = this.getDefault(userRole, key);
      }
    }

    return result;
  }

  /**
   * Update team permissions config. Owner-only. Returns merged config.
   */
  async updatePermissions(
    tenantId: string,
    patch: Partial<TeamPermissions>,
  ): Promise<TeamPermissions> {
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
    });
    if (!tenant) throw new Error('Tenant not found');

    const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
    const current = (settings.team_permissions as TeamPermissions | undefined) ?? { ...DEFAULT_TEAM_PERMISSIONS };

    const next: TeamPermissions = {
      admin: { ...current.admin, ...patch.admin },
      dispatcher: { ...current.dispatcher, ...patch.dispatcher },
      office: { ...current.office, ...patch.office },
    };

    await this.tenantRepo.update(tenantId, {
      settings: { ...settings, team_permissions: next } as any,
    });

    return next;
  }

  private async loadConfig(tenantId: string): Promise<Partial<TeamPermissions>> {
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: ['id', 'settings'],
    });
    if (!tenant) return {};
    const raw = (tenant.settings as Record<string, unknown> | null)?.team_permissions;
    if (!raw || typeof raw !== 'object') return {};
    return raw as Partial<TeamPermissions>;
  }

  private getDefault(role: string, key: string): boolean {
    const defaults = DEFAULT_TEAM_PERMISSIONS[role as keyof TeamPermissions];
    if (!defaults) return false;
    return defaults[key] ?? false;
  }
}
