import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  UpdateQuoteTemplatesDto,
} from './dto/tenant-settings.dto';
import { normalizePhone } from '../../common/utils/phone';

@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);

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
    userRole: string,
  ): Promise<TenantSettings> {
    // Field-level gating: only owner may mutate SMS-sensitive fields
    if (dto.sms_enabled !== undefined && userRole !== 'owner') {
      throw new ForbiddenException('Only the account owner can modify SMS settings');
    }

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
    userRole: string,
  ): Promise<TenantSettings> {
    // Field-level gating: only owner may mutate SMS-sensitive fields
    const touchesSmsFields =
      dto.sms_phone_number !== undefined ||
      dto.quotes_sms_enabled !== undefined ||
      dto.quote_follow_up_enabled !== undefined;
    if (touchesSmsFields && userRole !== 'owner') {
      throw new ForbiddenException('Only the account owner can modify SMS settings');
    }

    await this.getSettings(tenantId);
    const update: Record<string, unknown> = {};
    if (dto.sms_phone_number !== undefined) {
      if (dto.sms_phone_number === null || dto.sms_phone_number === '') {
        update.sms_phone_number = null;
      } else {
        const normalized = normalizePhone(dto.sms_phone_number);
        if (!normalized) throw new BadRequestException('Invalid SMS phone number');
        update.sms_phone_number = normalized;
      }
    }
    if (dto.quote_follow_up_enabled !== undefined) update.quote_follow_up_enabled = dto.quote_follow_up_enabled;
    if (dto.quote_follow_up_delay_hours !== undefined) update.quote_follow_up_delay_hours = dto.quote_follow_up_delay_hours;
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

  async updateQuoteTemplates(
    tenantId: string,
    dto: UpdateQuoteTemplatesDto,
    userRole: string,
  ): Promise<TenantSettings> {
    // Quote templates include SMS body content — owner-only
    if (userRole !== 'owner') {
      throw new ForbiddenException('Only the account owner can modify SMS templates');
    }
    await this.getSettings(tenantId);
    if (dto.quote_templates !== undefined) {
      await this.settingsRepo.update({ tenant_id: tenantId }, { quote_templates: dto.quote_templates, updated_at: new Date() } as any);
    }
    return this.settingsRepo.findOneOrFail({ where: { tenant_id: tenantId } });
  }

  /**
   * Auto-provision an SMS-capable Twilio number for the tenant.
   * Uses platform Twilio credentials. Tenant never needs a Twilio account.
   */
  async provisionSmsNumber(tenantId: string): Promise<{ success: boolean; phoneNumber?: string; error?: string }> {
    const settings = await this.getSettings(tenantId);

    // Guard: already has a number
    if (settings.sms_phone_number) {
      return { success: true, phoneNumber: settings.sms_phone_number };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    if (!accountSid || !authToken) {
      return { success: false, error: 'SMS provisioning is not available at this time' };
    }

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const apiBase = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
    const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' };

    try {
      // 1. Search for available US local SMS-capable number
      const searchParams = new URLSearchParams({ SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: '1' });
      const searchRes = await fetch(`${apiBase}/AvailablePhoneNumbers/US/Local.json?${searchParams}`, { headers });
      const searchData = await searchRes.json();

      if (!searchRes.ok || !searchData.available_phone_numbers?.length) {
        this.logger.error(`No available numbers: ${JSON.stringify(searchData)}`);
        return { success: false, error: 'No SMS numbers available right now. Please try again later.' };
      }

      const numberToBuy = searchData.available_phone_numbers[0].phone_number;

      // 2. Purchase the number + configure inbound SMS webhook
      const apiDomain = process.env.API_DOMAIN || 'serviceos-api.vercel.app';
      const webhookUrl = `https://${apiDomain}/automation/sms/inbound`;

      const buyParams = new URLSearchParams({
        PhoneNumber: numberToBuy,
        SmsUrl: webhookUrl,
        SmsMethod: 'POST',
      });

      const buyRes = await fetch(`${apiBase}/IncomingPhoneNumbers.json`, {
        method: 'POST', headers, body: buyParams.toString(),
      });
      const buyData = await buyRes.json();

      if (!buyRes.ok) {
        this.logger.error(`Number purchase failed: ${JSON.stringify(buyData)}`);
        return { success: false, error: 'Unable to provision a number right now. Please try again later.' };
      }

      const assignedNumber = buyData.phone_number;

      // 3. Save to tenant settings — conditional update prevents duplicate assignment from race
      const result = await this.settingsRepo.createQueryBuilder()
        .update(TenantSettings)
        .set({ sms_phone_number: assignedNumber, updated_at: new Date() })
        .where('tenant_id = :tenantId AND (sms_phone_number IS NULL OR sms_phone_number = \'\')', { tenantId })
        .execute();

      if (!result.affected || result.affected === 0) {
        // Another request already assigned a number — the purchased number is now orphaned
        // Log for manual cleanup but don't fail the user
        this.logger.warn(`Provisioned ${assignedNumber} for tenant ${tenantId} but another number was already assigned. Orphaned number needs manual release.`);
        const current = await this.getSettings(tenantId);
        return { success: true, phoneNumber: current.sms_phone_number! };
      }

      this.logger.log(`Provisioned SMS number ${assignedNumber} for tenant ${tenantId}`);
      return { success: true, phoneNumber: assignedNumber };

    } catch (err: any) {
      this.logger.error(`SMS provisioning error for tenant ${tenantId}: ${err.message}`);
      return { success: false, error: 'Unable to provision a number right now. Please try again later.' };
    }
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
