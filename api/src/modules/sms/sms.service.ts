import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmsMessage } from './sms-message.entity';
import { SmsOptOutService } from './sms-opt-out.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { normalizePhone } from '../../common/utils/phone';

export interface SendSmsParams {
  tenantId: string;
  to: string;
  body: string;
  source?: string;
  sourceId?: string;
  customerId?: string;
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @InjectRepository(SmsMessage) private messageRepo: Repository<SmsMessage>,
    private settingsService: TenantSettingsService,
    private optOutService: SmsOptOutService,
  ) {}

  /**
   * Send an SMS via the tenant's assigned number using the platform Twilio account.
   * Logs outbound messages to sms_messages table.
   * Returns success/failure — never throws.
   */
  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const { tenantId, to, body, source, sourceId, customerId } = params;

    // 1. Load tenant settings
    const settings = await this.settingsService.getSettings(tenantId);

    if (!settings.sms_enabled) {
      return { success: false, error: 'SMS not enabled for this tenant' };
    }

    if (!settings.sms_phone_number) {
      return { success: false, error: 'No SMS phone number assigned to this tenant' };
    }

    // 2. Normalize + validate
    const normalizedTo = normalizePhone(to);
    if (!normalizedTo) {
      return { success: false, error: 'Invalid recipient phone number' };
    }

    // 2a. Suppression gate — tenant-scoped opt-out check.
    // Runs before body validation and before the Twilio call so suppressed
    // sends never touch the provider. Writes a best-effort audit row to
    // sms_messages with status='suppressed' so operators can see the attempt.
    if (await this.optOutService.isOptedOut(tenantId, normalizedTo)) {
      try {
        const suppressed = this.messageRepo.create({
          tenant_id: tenantId,
          customer_id: customerId || null,
          quote_id: sourceId && source?.includes('quote') ? sourceId : null,
          direction: 'outbound',
          from_number: settings.sms_phone_number,
          to_number: normalizedTo,
          body: body || '',
          provider: 'twilio',
          provider_message_sid: null,
          status: 'suppressed',
          source_type: source || null,
        });
        await this.messageRepo.save(suppressed);
      } catch (err: any) {
        this.logger.warn(
          `Failed to log suppressed SMS audit row for ${normalizedTo} (${tenantId}): ${err.message}`,
        );
        // Suppression still succeeds — audit logging is best-effort.
      }
      this.logger.warn(
        `SMS suppressed for ${normalizedTo} (tenant ${tenantId}): customer opted out`,
      );
      return { success: false, error: 'customer_opted_out' };
    }

    if (!body || !body.trim()) {
      return { success: false, error: 'Message body is empty' };
    }

    // 3. Send via platform Twilio account, using tenant's assigned number as From
    const fromNumber = settings.sms_phone_number;

    try {
      // Direct Twilio REST API call using platform credentials + tenant's From number
      const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
      const authToken = process.env.TWILIO_AUTH_TOKEN || '';

      if (!accountSid || !authToken) {
        return { success: false, error: 'Platform Twilio not configured' };
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const twilioParams = new URLSearchParams({
        To: normalizedTo,
        From: fromNumber,
        Body: body,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: twilioParams.toString(),
      });

      const data = await res.json();

      if (!res.ok) {
        this.logger.error(`SMS failed to ${normalizedTo}: ${data.message || res.statusText}`);
        return { success: false, error: data.message || `HTTP ${res.status}` };
      }

      // 4. Log outbound message
      const message = this.messageRepo.create({
        tenant_id: tenantId,
        customer_id: customerId || null,
        quote_id: sourceId && source?.includes('quote') ? sourceId : null,
        direction: 'outbound',
        from_number: fromNumber,
        to_number: normalizedTo,
        body,
        provider: 'twilio',
        provider_message_sid: data.sid || null,
        status: 'sent',
        source_type: source || null,
      });
      await this.messageRepo.save(message);

      this.logger.log(`SMS sent to ${normalizedTo} from ${fromNumber} (${tenantId}): ${data.sid}`);
      return { success: true, messageId: data.sid };

    } catch (err: any) {
      this.logger.error(`SMS failed to ${normalizedTo}: ${err.message}`);
      return { success: false, error: err.message };
    }

    // TODO: Add consent/opt-out check before sending (future)
  }
}
