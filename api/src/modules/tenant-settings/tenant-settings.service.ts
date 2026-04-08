import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { TenantSettings } from './entities/tenant-settings.entity';
import {
  UpdateTenantSettingsDto,
  UpdateBrandingDto,
  UpdateOperationsDto,
  UpdateNotificationConfigDto,
  UpdateQuoteSettingsDto,
} from './dto/tenant-settings.dto';

@Injectable()
export class TenantSettingsService {
  constructor(
    @InjectRepository(TenantSettings)
    private settingsRepo: Repository<TenantSettings>,
  ) {}

  async getSettings(tenantId: string): Promise<TenantSettings> {
    let settings = await this.settingsRepo.findOne({
      where: { tenant_id: tenantId },
    });

    if (!settings) {
      const created = this.settingsRepo.create({ tenant_id: tenantId });
      settings = await this.settingsRepo.save(created);
    }

    return settings;
  }

  async updateSettings(
    tenantId: string,
    dto: UpdateTenantSettingsDto,
  ): Promise<TenantSettings> {
    await this.getSettings(tenantId); // ensure row exists

    if (dto.portal_slug !== undefined) {
      await this.validatePortalSlug(tenantId, dto.portal_slug);
    }

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        update[key] = value;
      }
    }
    update.updated_at = new Date();

    await this.settingsRepo.update({ tenant_id: tenantId }, update);
    return this.settingsRepo.findOneOrFail({ where: { tenant_id: tenantId } });
  }

  async updateBranding(
    tenantId: string,
    dto: UpdateBrandingDto,
  ): Promise<TenantSettings> {
    await this.getSettings(tenantId);

    const update: Record<string, unknown> = {};
    if (dto.brand_color !== undefined) update.brand_color = dto.brand_color;
    if (dto.logo_url !== undefined) update.logo_url = dto.logo_url;
    if (dto.portal_name !== undefined) update.portal_name = dto.portal_name;
    if (dto.support_email !== undefined) update.support_email = dto.support_email;
    if (dto.support_phone !== undefined) update.support_phone = dto.support_phone;
    update.updated_at = new Date();

    await this.settingsRepo.update({ tenant_id: tenantId }, update);
    return this.settingsRepo.findOneOrFail({ where: { tenant_id: tenantId } });
  }

  async updateOperations(
    tenantId: string,
    dto: UpdateOperationsDto,
  ): Promise<TenantSettings> {
    await this.getSettings(tenantId);

    const update: Record<string, unknown> = {};
    if (dto.default_rental_period_days !== undefined)
      update.default_rental_period_days = dto.default_rental_period_days;
    if (dto.failed_trip_fee !== undefined)
      update.failed_trip_fee = dto.failed_trip_fee;
    if (dto.time_change_cutoff_hours !== undefined)
      update.time_change_cutoff_hours = dto.time_change_cutoff_hours;
    update.updated_at = new Date();

    await this.settingsRepo.update({ tenant_id: tenantId }, update);
    return this.settingsRepo.findOneOrFail({ where: { tenant_id: tenantId } });
  }

  async updateNotificationConfig(
    tenantId: string,
    dto: UpdateNotificationConfigDto,
  ): Promise<TenantSettings> {
    await this.getSettings(tenantId);

    const update: Record<string, unknown> = {};
    if (dto.email_sender_name !== undefined)
      update.email_sender_name = dto.email_sender_name;
    if (dto.sms_enabled !== undefined) update.sms_enabled = dto.sms_enabled;
    if (dto.email_enabled !== undefined) update.email_enabled = dto.email_enabled;
    update.updated_at = new Date();

    await this.settingsRepo.update({ tenant_id: tenantId }, update);
    return this.settingsRepo.findOneOrFail({ where: { tenant_id: tenantId } });
  }

  async updateQuoteSettings(
    tenantId: string,
    dto: UpdateQuoteSettingsDto,
  ): Promise<TenantSettings> {
    await this.getSettings(tenantId);
    const update: Record<string, unknown> = {};
    if (dto.quote_expiration_days !== undefined) update.quote_expiration_days = dto.quote_expiration_days;
    if (dto.hot_quote_view_threshold !== undefined) update.hot_quote_view_threshold = dto.hot_quote_view_threshold;
    if (dto.follow_up_recency_minutes !== undefined) update.follow_up_recency_minutes = dto.follow_up_recency_minutes;
    if (dto.expiring_soon_hours !== undefined) update.expiring_soon_hours = dto.expiring_soon_hours;
    if (dto.quotes_email_enabled !== undefined) update.quotes_email_enabled = dto.quotes_email_enabled;
    if (dto.quotes_sms_enabled !== undefined) update.quotes_sms_enabled = dto.quotes_sms_enabled;
    if (dto.default_quote_delivery_method !== undefined) update.default_quote_delivery_method = dto.default_quote_delivery_method;
    update.updated_at = new Date();
    await this.settingsRepo.update({ tenant_id: tenantId }, update);
    return this.settingsRepo.findOneOrFail({ where: { tenant_id: tenantId } });
  }

  private async validatePortalSlug(
    tenantId: string,
    slug: string,
  ): Promise<void> {
    const existing = await this.settingsRepo.findOne({
      where: { portal_slug: slug, tenant_id: Not(tenantId) },
    });
    if (existing) {
      throw new ConflictException('Portal slug is already taken by another tenant');
    }
  }
}
