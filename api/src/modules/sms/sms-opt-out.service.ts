import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SmsOptOut } from './sms-opt-out.entity';

/**
 * Shared SMS suppression service. Single source of truth for tenant-scoped
 * opt-out state. All reads and writes key on (tenant_id, phone_e164) —
 * callers must normalize the phone to E.164 before calling.
 *
 * Consumed by:
 *   - SmsService.sendSms()              (quote send, resend, follow-up cron)
 *   - NotificationsService.processOne() (generic notifications SMS path)
 *   - QuotesController.resolveChannels()(proactive UI blocked-reason gate)
 *   - AutomationService.handleInboundSms() (STOP/START state updates)
 *
 * Never throws in normal operation — inbound webhook callers rely on
 * best-effort behavior so Twilio webhook retries don't double-log.
 */
@Injectable()
export class SmsOptOutService {
  private readonly logger = new Logger(SmsOptOutService.name);

  constructor(
    @InjectRepository(SmsOptOut) private repo: Repository<SmsOptOut>,
  ) {}

  /**
   * Returns true iff a row exists for (tenantId, phoneE164) where
   * opted_in_at IS NULL — i.e. the number is currently suppressed for that
   * tenant. Callers MUST pass an E.164-normalized phone.
   */
  async isOptedOut(tenantId: string, phoneE164: string): Promise<boolean> {
    if (!tenantId || !phoneE164) return false;
    const row = await this.repo.findOne({
      where: {
        tenant_id: tenantId,
        phone_e164: phoneE164,
        opted_in_at: IsNull(),
      },
      select: ['id'],
    });
    return !!row;
  }

  /**
   * Record an opt-out. Idempotent upsert on the unique
   * (tenant_id, phone_e164) index. Re-STOP from an already-opted-out number
   * bumps opted_out_at / opted_out_via_message_id and clears opted_in_at.
   *
   * messageId is the inbound sms_messages.id that triggered the opt-out (for
   * audit / cross-reference). Nullable so non-webhook callers (future) can
   * still record an opt-out without a triggering message row.
   */
  async recordOptOut(
    tenantId: string,
    phoneE164: string,
    messageId: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(SmsOptOut)
      .values({
        tenant_id: tenantId,
        phone_e164: phoneE164,
        opted_out_at: now,
        opted_out_via_message_id: messageId,
        opted_in_at: null,
      })
      .orUpdate(
        ['opted_out_at', 'opted_out_via_message_id', 'opted_in_at', 'updated_at'],
        ['tenant_id', 'phone_e164'],
      )
      .setParameter('updated_at', now)
      .execute();
  }

  /**
   * Record an opt-in. Updates the existing row's opted_in_at without
   * clearing opted_out_at (audit history preserved). If no row exists for
   * (tenantId, phoneE164), this is a silent no-op — you cannot opt back in
   * to a suppression that never existed.
   */
  async recordOptIn(tenantId: string, phoneE164: string): Promise<void> {
    const now = new Date();
    await this.repo
      .createQueryBuilder()
      .update(SmsOptOut)
      .set({ opted_in_at: now, updated_at: now })
      .where('tenant_id = :tenantId AND phone_e164 = :phone AND opted_in_at IS NULL', {
        tenantId,
        phone: phoneE164,
      })
      .execute();
  }
}
