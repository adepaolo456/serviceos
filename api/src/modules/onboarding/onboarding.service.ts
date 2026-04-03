import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SetupChecklist } from './entities/setup-checklist.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Yard } from '../yards/yard.entity';
import { Asset } from '../assets/entities/asset.entity';
import {
  VALID_STEP_KEYS,
  STEP_ORDER,
  STEP_CATEGORIES,
  StepKey,
  ChecklistItem,
  ProgressResponse,
} from './dto/onboarding.dto';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(SetupChecklist)
    private checklistRepo: Repository<SetupChecklist>,
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantSettings)
    private settingsRepo: Repository<TenantSettings>,
    @InjectRepository(PricingRule)
    private pricingRuleRepo: Repository<PricingRule>,
    @InjectRepository(Yard)
    private yardRepo: Repository<Yard>,
    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,
  ) {}

  async deriveStepCompletion(tenantId: string): Promise<Record<string, boolean>> {
    const [tenant, settings, pricingCount, yardCount, vehicleCount] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: tenantId } }),
      this.settingsRepo.findOne({ where: { tenant_id: tenantId } }),
      this.pricingRuleRepo.count({ where: { tenant_id: tenantId, is_active: true } }),
      this.yardRepo.count({ where: { tenant_id: tenantId, is_active: true } }),
      this.assetRepo.count({ where: { tenant_id: tenantId } }),
    ]);

    const driverRate = settings?.driver_hourly_rate ? Number(settings.driver_hourly_rate) : 0;

    return {
      company_info: !!(tenant?.name && settings?.support_email),
      pricing: pricingCount > 0,
      yards: yardCount > 0,
      vehicles: vehicleCount > 0,
      labor_rates: driverRate > 0,
      notifications: !!(settings?.sms_enabled || settings?.email_enabled),
      portal: !!(settings?.portal_slug),
    };
  }

  private async ensureChecklistSeeded(tenantId: string): Promise<void> {
    const count = await this.checklistRepo.count({ where: { tenant_id: tenantId } });
    if (count === 0) {
      const items = VALID_STEP_KEYS.map((key) =>
        this.checklistRepo.create({ tenant_id: tenantId, step_key: key, status: 'pending' }),
      );
      await this.checklistRepo.save(items);
    }
  }

  async syncChecklistFromData(tenantId: string): Promise<void> {
    await this.ensureChecklistSeeded(tenantId);
    const derived = await this.deriveStepCompletion(tenantId);
    const rows = await this.checklistRepo.find({ where: { tenant_id: tenantId } });

    for (const row of rows) {
      const dataExists = derived[row.step_key] ?? false;

      if (dataExists && row.status === 'pending') {
        await this.checklistRepo.update(row.id, {
          status: 'auto_completed',
          completed_at: new Date(),
          completed_by: null,
        });
      } else if (!dataExists && row.status === 'auto_completed' && row.completed_by === null) {
        await this.checklistRepo.update(row.id, {
          status: 'pending',
          completed_at: null,
          completed_by: null,
        });
      }
    }
  }

  async getChecklist(tenantId: string): Promise<ChecklistItem[]> {
    await this.syncChecklistFromData(tenantId);
    const rows = await this.checklistRepo.find({ where: { tenant_id: tenantId } });
    const derived = await this.deriveStepCompletion(tenantId);

    const rowMap = new Map(rows.map((r) => [r.step_key, r]));

    return STEP_ORDER.map((stepKey) => {
      const row = rowMap.get(stepKey);
      const category = STEP_CATEGORIES[stepKey];

      let status: ChecklistItem['status'] = row?.status as ChecklistItem['status'] || 'pending';

      if (row?.status === 'skipped') {
        status = 'skipped';
      } else if (derived[stepKey]) {
        status = row?.status === 'completed' ? 'completed' : 'auto_completed';
      }

      return {
        stepKey,
        status,
        completedAt: row?.completed_at || null,
        completedBy: row?.completed_by || null,
        required: category === 'required',
        category,
      };
    });
  }

  async updateChecklistStep(
    tenantId: string,
    stepKey: string,
    status: 'completed' | 'skipped',
    userId: string,
  ): Promise<ChecklistItem> {
    if (!VALID_STEP_KEYS.includes(stepKey as StepKey)) {
      throw new BadRequestException(
        `Invalid step_key. Must be one of: ${VALID_STEP_KEYS.join(', ')}`,
      );
    }

    await this.ensureChecklistSeeded(tenantId);

    const row = await this.checklistRepo.findOne({
      where: { tenant_id: tenantId, step_key: stepKey },
    });

    if (!row) {
      throw new BadRequestException('Checklist step not found');
    }

    if (status === 'completed') {
      await this.checklistRepo.update(row.id, {
        status: 'completed',
        completed_at: new Date(),
        completed_by: userId,
      });
    } else {
      await this.checklistRepo.update(row.id, {
        status: 'skipped',
        completed_at: null,
        completed_by: null,
      });
    }

    await this.syncChecklistFromData(tenantId);
    await this.checkOnboardingComplete(tenantId);

    const updated = await this.checklistRepo.findOne({
      where: { tenant_id: tenantId, step_key: stepKey },
    });
    const category = STEP_CATEGORIES[stepKey as StepKey];

    return {
      stepKey: stepKey as StepKey,
      status: updated!.status as ChecklistItem['status'],
      completedAt: updated!.completed_at,
      completedBy: updated!.completed_by,
      required: category === 'required',
      category,
    };
  }

  private async checkOnboardingComplete(tenantId: string): Promise<void> {
    const requiredKeys: StepKey[] = ['company_info', 'pricing', 'yards'];
    const rows = await this.checklistRepo.find({ where: { tenant_id: tenantId } });
    const rowMap = new Map(rows.map((r) => [r.step_key, r]));

    const allRequiredDone = requiredKeys.every((key) => {
      const row = rowMap.get(key);
      return row && ['completed', 'auto_completed', 'skipped'].includes(row.status);
    });

    if (allRequiredDone) {
      await this.tenantRepo.update(tenantId, {
        onboarding_status: 'completed',
        onboarding_completed_at: new Date(),
      });
    }
  }

  async getOnboardingProgress(tenantId: string): Promise<ProgressResponse> {
    await this.syncChecklistFromData(tenantId);
    const steps = await this.getChecklist(tenantId);

    const completed = steps.filter(
      (s) => s.status === 'completed' || s.status === 'auto_completed',
    ).length;
    const skipped = steps.filter((s) => s.status === 'skipped').length;
    const total = steps.length;
    const percentage = Math.round(((completed + skipped) / total) * 100);

    const requiredKeys: StepKey[] = ['company_info', 'pricing', 'yards'];
    const requiredComplete = requiredKeys.every((key) => {
      const step = steps.find((s) => s.stepKey === key);
      return step && ['completed', 'auto_completed'].includes(step.status);
    });

    // Update tenant onboarding_status if in_progress
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (tenant && tenant.onboarding_status === 'pending' && (completed + skipped) > 0) {
      await this.tenantRepo.update(tenantId, {
        onboarding_status: 'in_progress',
        onboarding_started_at: new Date(),
      });
    }

    return { total, completed, skipped, percentage, requiredComplete, steps };
  }

  async resetChecklist(tenantId: string): Promise<void> {
    await this.checklistRepo.update(
      { tenant_id: tenantId },
      { status: 'pending', completed_at: null, completed_by: null },
    );
    await this.tenantRepo.update(tenantId, {
      onboarding_status: 'pending',
      onboarding_started_at: null,
      onboarding_completed_at: null,
    });
  }
}
