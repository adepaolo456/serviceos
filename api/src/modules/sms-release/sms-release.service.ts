import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmsNumberReleaseRequest } from './entities/sms-number-release-request.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { SmsMessage } from '../sms/sms-message.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';

/**
 * Activity context surfaced to ServiceOS admin BEFORE releasing a number,
 * so the operator never makes a destructive Twilio call blindly.
 */
export interface SmsReleaseActivityContext {
  sms_enabled: boolean;
  current_assigned_number: string | null;
  number_matches_request: boolean;
  inbound_count_total: number;
  outbound_count_total: number;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  messages_last_7d: number;
}

export interface SmsReleaseRequestDetail {
  request: SmsNumberReleaseRequest;
  tenant: { id: string; name: string; slug: string } | null;
  requested_by: { id: string; email: string } | null;
  reviewed_by: { id: string; email: string } | null;
  activity: SmsReleaseActivityContext;
}

@Injectable()
export class SmsReleaseService {
  private readonly logger = new Logger(SmsReleaseService.name);

  constructor(
    @InjectRepository(SmsNumberReleaseRequest)
    private requestRepo: Repository<SmsNumberReleaseRequest>,
    @InjectRepository(TenantSettings)
    private settingsRepo: Repository<TenantSettings>,
    @InjectRepository(SmsMessage)
    private smsMessageRepo: Repository<SmsMessage>,
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Tenant side
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Tenant requests removal of their currently assigned SMS number.
   *
   * Concurrency safety: relies on the partial unique index
   * `uniq_sms_release_pending_per_number` so two simultaneous requests for the
   * same (tenant, number) cannot both succeed at the database level.
   */
  async createReleaseRequest(
    tenantId: string,
    requestedByUserId: string,
  ): Promise<SmsNumberReleaseRequest> {
    const settings = await this.settingsRepo.findOne({
      where: { tenant_id: tenantId },
    });
    if (!settings || !settings.sms_phone_number) {
      throw new BadRequestException('No SMS number is currently assigned to this tenant.');
    }

    const number = settings.sms_phone_number;

    // Soft pre-check (the unique index is the real guarantee)
    const existingPending = await this.requestRepo.findOne({
      where: { tenant_id: tenantId, sms_phone_number: number, status: 'pending' },
    });
    if (existingPending) {
      return existingPending;
    }

    try {
      const created = this.requestRepo.create({
        tenant_id: tenantId,
        sms_phone_number: number,
        status: 'pending',
        requested_by_user_id: requestedByUserId,
        requested_at: new Date(),
      });
      return await this.requestRepo.save(created);
    } catch (err: any) {
      // Postgres unique violation from the partial unique index → race; return the existing pending row.
      if (err?.code === '23505') {
        const existing = await this.requestRepo.findOne({
          where: { tenant_id: tenantId, sms_phone_number: number, status: 'pending' },
        });
        if (existing) return existing;
        throw new ConflictException('A removal request is already pending for this number.');
      }
      throw err;
    }
  }

  /**
   * Returns the active pending release request for the tenant (if any) and
   * the most recent finalized one — used to drive the tenant settings UI.
   */
  async getTenantStatus(tenantId: string): Promise<{
    pending: SmsNumberReleaseRequest | null;
    latest: SmsNumberReleaseRequest | null;
  }> {
    const [pending, latest] = await Promise.all([
      this.requestRepo.findOne({
        where: { tenant_id: tenantId, status: 'pending' },
        order: { created_at: 'DESC' },
      }),
      this.requestRepo.findOne({
        where: { tenant_id: tenantId },
        order: { created_at: 'DESC' },
      }),
    ]);
    return { pending, latest };
  }

  /**
   * Tenant cancels their own pending request. Multi-tenant safe — only flips
   * rows that belong to the calling tenant AND are still pending.
   */
  async cancelOwnRequest(
    tenantId: string,
    requestId: string,
  ): Promise<SmsNumberReleaseRequest> {
    const result = await this.requestRepo
      .createQueryBuilder()
      .update(SmsNumberReleaseRequest)
      .set({
        status: 'rejected',
        review_notes: 'Cancelled by tenant',
        reviewed_at: new Date(),
        updated_at: new Date(),
      })
      .where('id = :id AND tenant_id = :tenantId AND status = :status', {
        id: requestId,
        tenantId,
        status: 'pending',
      })
      .execute();

    if (!result.affected || result.affected === 0) {
      throw new NotFoundException('No pending request found for this tenant.');
    }
    return this.requestRepo.findOneOrFail({ where: { id: requestId } });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ServiceOS Admin side
  // ───────────────────────────────────────────────────────────────────────────

  async listForAdmin(status?: string): Promise<Array<{
    request: SmsNumberReleaseRequest;
    tenant_name: string;
    requested_by_email: string | null;
    activity_summary: { last_outbound_at: Date | null; messages_last_7d: number };
  }>> {
    const qb = this.requestRepo
      .createQueryBuilder('r')
      .orderBy('r.created_at', 'DESC')
      .limit(200);

    if (status) {
      qb.where('r.status = :status', { status });
    }

    const requests = await qb.getMany();
    if (requests.length === 0) return [];

    const tenantIds = Array.from(new Set(requests.map((r) => r.tenant_id)));
    const userIds = Array.from(new Set(requests.map((r) => r.requested_by_user_id)));

    const [tenants, users] = await Promise.all([
      this.tenantRepo
        .createQueryBuilder('t')
        .select(['t.id', 't.name'])
        .where('t.id IN (:...ids)', { ids: tenantIds })
        .getMany(),
      this.userRepo
        .createQueryBuilder('u')
        .select(['u.id', 'u.email'])
        .where('u.id IN (:...ids)', { ids: userIds })
        .getMany(),
    ]);
    const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));
    const userMap = new Map(users.map((u) => [u.id, u.email]));

    // Activity summary per tenant — kept lightweight for the list view.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activityRows = await this.smsMessageRepo
      .createQueryBuilder('m')
      .select('m.tenant_id', 'tenant_id')
      .addSelect("MAX(CASE WHEN m.direction = 'outbound' THEN m.created_at END)", 'last_outbound_at')
      .addSelect('COUNT(*) FILTER (WHERE m.created_at >= :since)', 'messages_last_7d')
      .where('m.tenant_id IN (:...ids)', { ids: tenantIds })
      .setParameter('since', sevenDaysAgo)
      .groupBy('m.tenant_id')
      .getRawMany();

    const activityMap = new Map(
      activityRows.map((row) => [
        row.tenant_id,
        {
          last_outbound_at: row.last_outbound_at ? new Date(row.last_outbound_at) : null,
          messages_last_7d: Number(row.messages_last_7d || 0),
        },
      ]),
    );

    return requests.map((r) => ({
      request: r,
      tenant_name: tenantMap.get(r.tenant_id) || '—',
      requested_by_email: userMap.get(r.requested_by_user_id) || null,
      activity_summary: activityMap.get(r.tenant_id) || {
        last_outbound_at: null,
        messages_last_7d: 0,
      },
    }));
  }

  /**
   * Detailed view for the admin review modal — includes the full activity
   * context the operator needs before releasing the number.
   */
  async getDetailForAdmin(requestId: string): Promise<SmsReleaseRequestDetail> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');

    const [tenant, settings, requester, reviewer, activityRow] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: request.tenant_id } }),
      this.settingsRepo.findOne({ where: { tenant_id: request.tenant_id } }),
      this.userRepo.findOne({ where: { id: request.requested_by_user_id } }),
      request.reviewed_by_user_id
        ? this.userRepo.findOne({ where: { id: request.reviewed_by_user_id } })
        : Promise.resolve(null),
      this.smsMessageRepo
        .createQueryBuilder('m')
        .select("COUNT(*) FILTER (WHERE m.direction = 'inbound')", 'inbound_count_total')
        .addSelect("COUNT(*) FILTER (WHERE m.direction = 'outbound')", 'outbound_count_total')
        .addSelect("MAX(CASE WHEN m.direction = 'inbound' THEN m.created_at END)", 'last_inbound_at')
        .addSelect("MAX(CASE WHEN m.direction = 'outbound' THEN m.created_at END)", 'last_outbound_at')
        .addSelect('COUNT(*) FILTER (WHERE m.created_at >= :since)', 'messages_last_7d')
        .where('m.tenant_id = :tenantId', { tenantId: request.tenant_id })
        .setParameter('since', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .getRawOne(),
    ]);

    const currentNumber = settings?.sms_phone_number || null;
    const activity: SmsReleaseActivityContext = {
      sms_enabled: !!settings?.sms_enabled,
      current_assigned_number: currentNumber,
      number_matches_request: currentNumber === request.sms_phone_number,
      inbound_count_total: Number(activityRow?.inbound_count_total || 0),
      outbound_count_total: Number(activityRow?.outbound_count_total || 0),
      last_inbound_at: activityRow?.last_inbound_at ? new Date(activityRow.last_inbound_at) : null,
      last_outbound_at: activityRow?.last_outbound_at ? new Date(activityRow.last_outbound_at) : null,
      messages_last_7d: Number(activityRow?.messages_last_7d || 0),
    };

    return {
      request,
      tenant: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug } : null,
      requested_by: requester ? { id: requester.id, email: requester.email } : null,
      reviewed_by: reviewer ? { id: reviewer.id, email: reviewer.email } : null,
      activity,
    };
  }

  /**
   * Admin rejects the request without touching Twilio.
   */
  async reject(
    requestId: string,
    reviewerUserId: string,
    notes: string | undefined,
  ): Promise<SmsNumberReleaseRequest> {
    const result = await this.requestRepo
      .createQueryBuilder()
      .update(SmsNumberReleaseRequest)
      .set({
        status: 'rejected',
        reviewed_by_user_id: reviewerUserId,
        reviewed_at: new Date(),
        review_notes: notes || null,
        updated_at: new Date(),
      })
      .where('id = :id AND status = :status', { id: requestId, status: 'pending' })
      .execute();

    if (!result.affected || result.affected === 0) {
      throw new ConflictException('Request is no longer pending.');
    }
    return this.requestRepo.findOneOrFail({ where: { id: requestId } });
  }

  /**
   * Admin approves and triggers the actual Twilio release.
   *
   * STRICT ORDERING:
   *   1. Atomic conditional UPDATE on status='pending' → only one admin click wins.
   *   2. Verify the tenant's *current* sms_phone_number still matches the request.
   *   3. Resolve Twilio IncomingPhoneNumber SID via REST.
   *   4. Twilio DELETE (provider release).
   *   5. ONLY THEN clear tenant_settings.sms_phone_number + sms_enabled=false.
   *   6. Mark request released.
   *
   * Failure modes:
   *   • mismatch / not pending → request marked failed, tenant assignment intact.
   *   • SID lookup or DELETE fails → request marked failed, tenant assignment intact.
   *   • Twilio DELETE succeeded but DB cleanup failed → request marked failed
   *     with released_at set + failure_reason indicating reconcile is required.
   *     The number is gone from Twilio so retrying release would 404 — admin
   *     uses /reconcile to clear the orphaned tenant_settings row.
   */
  async releaseAndApprove(
    requestId: string,
    reviewerUserId: string,
    notes: string | undefined,
  ): Promise<SmsNumberReleaseRequest> {
    // Step 1: Atomic claim of the request — concurrent admin clicks lose here.
    // We cannot move to a non-final state and back, so we keep status='pending'
    // for now and only flip after the Twilio call resolves. Instead we use a
    // sentinel by checking reviewed_at: claim by setting reviewed_by + reviewed_at
    // ONLY where reviewed_at IS NULL AND status='pending'.
    const claim = await this.requestRepo
      .createQueryBuilder()
      .update(SmsNumberReleaseRequest)
      .set({
        reviewed_by_user_id: reviewerUserId,
        reviewed_at: new Date(),
        review_notes: notes || null,
        updated_at: new Date(),
      })
      .where(
        'id = :id AND status = :status AND reviewed_at IS NULL',
        { id: requestId, status: 'pending' },
      )
      .execute();

    if (!claim.affected || claim.affected === 0) {
      throw new ConflictException(
        'Request is no longer pending or is already being processed.',
      );
    }

    const request = await this.requestRepo.findOneOrFail({ where: { id: requestId } });

    // Step 2: Verify current tenant assignment still matches.
    const settings = await this.settingsRepo.findOne({
      where: { tenant_id: request.tenant_id },
    });
    if (!settings) {
      return this.markFailed(requestId, 'tenant_settings_missing');
    }
    if (settings.sms_phone_number !== request.sms_phone_number) {
      return this.markFailed(
        requestId,
        `number_changed: current=${settings.sms_phone_number ?? 'null'} request=${request.sms_phone_number}`,
      );
    }

    // Step 3 + 4: Provider release via shared platform Twilio creds.
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    if (!accountSid || !authToken) {
      return this.markFailed(requestId, 'twilio_not_configured');
    }
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const apiBase = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
    const headers = { Authorization: `Basic ${auth}` };

    let phoneSid: string;
    try {
      const lookupQs = new URLSearchParams({
        PhoneNumber: request.sms_phone_number,
        PageSize: '1',
      });
      const lookupRes = await fetch(
        `${apiBase}/IncomingPhoneNumbers.json?${lookupQs}`,
        { headers },
      );
      const lookupData = await lookupRes.json().catch(() => ({}));
      if (!lookupRes.ok) {
        return this.markFailed(
          requestId,
          `twilio_lookup_failed: ${(lookupData as any)?.message || lookupRes.status}`,
        );
      }
      const found = (lookupData as any)?.incoming_phone_numbers?.[0];
      if (!found?.sid) {
        return this.markFailed(requestId, 'twilio_number_not_found');
      }
      phoneSid = found.sid;
    } catch (err: any) {
      return this.markFailed(requestId, `twilio_lookup_error: ${err.message}`);
    }

    try {
      const delRes = await fetch(
        `${apiBase}/IncomingPhoneNumbers/${phoneSid}.json`,
        { method: 'DELETE', headers },
      );
      // Twilio returns 204 on successful release. Treat any 2xx as success.
      if (!delRes.ok) {
        const errBody = await delRes.json().catch(() => ({}));
        return this.markFailed(
          requestId,
          `twilio_release_failed: ${(errBody as any)?.message || delRes.status}`,
        );
      }
    } catch (err: any) {
      return this.markFailed(requestId, `twilio_release_error: ${err.message}`);
    }

    // Step 5: Clear tenant assignment — provider release already succeeded.
    // From this point on, ANY failure must surface released_at so the operator
    // can reconcile, because Twilio billing has already stopped.
    const releasedAt = new Date();
    try {
      const cleanupResult = await this.settingsRepo
        .createQueryBuilder()
        .update(TenantSettings)
        .set({
          sms_phone_number: null,
          sms_enabled: false,
          quotes_sms_enabled: false,
          updated_at: releasedAt,
        })
        .where('tenant_id = :tenantId AND sms_phone_number = :number', {
          tenantId: request.tenant_id,
          number: request.sms_phone_number,
        })
        .execute();

      if (!cleanupResult.affected || cleanupResult.affected === 0) {
        // Tenant_settings number was changed between our verify and cleanup.
        // Twilio is already released, so we cannot un-release. Surface for reconcile.
        await this.requestRepo.update(
          { id: requestId },
          {
            status: 'failed',
            released_at: releasedAt,
            provider_phone_sid: phoneSid,
            failure_reason: 'twilio_released_but_tenant_settings_changed_during_cleanup',
            updated_at: new Date(),
          },
        );
        return this.requestRepo.findOneOrFail({ where: { id: requestId } });
      }

      // Step 6: Mark request released.
      await this.requestRepo.update(
        { id: requestId },
        {
          status: 'released',
          released_at: releasedAt,
          provider_phone_sid: phoneSid,
          updated_at: new Date(),
        },
      );
      this.logger.log(
        `SMS number ${request.sms_phone_number} (sid=${phoneSid}) released for tenant ${request.tenant_id}`,
      );
      return this.requestRepo.findOneOrFail({ where: { id: requestId } });
    } catch (err: any) {
      this.logger.error(
        `Twilio released ${request.sms_phone_number} (sid=${phoneSid}) but DB cleanup failed for tenant ${request.tenant_id}: ${err.message}`,
      );
      await this.requestRepo.update(
        { id: requestId },
        {
          status: 'failed',
          released_at: releasedAt,
          provider_phone_sid: phoneSid,
          failure_reason: `twilio_released_but_db_cleanup_failed: ${err.message}`,
          updated_at: new Date(),
        },
      );
      throw new InternalServerErrorException(
        'Twilio number was released but tenant settings cleanup failed. Manual reconcile required.',
      );
    }
  }

  /**
   * Reconcile a request that is in the rare state where Twilio release
   * succeeded but tenant_settings cleanup failed. Idempotent.
   */
  async reconcile(requestId: string): Promise<SmsNumberReleaseRequest> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'failed' || !request.released_at) {
      throw new BadRequestException(
        'Reconcile is only valid for failed requests where Twilio release already happened.',
      );
    }

    await this.settingsRepo
      .createQueryBuilder()
      .update(TenantSettings)
      .set({
        sms_phone_number: null,
        sms_enabled: false,
        quotes_sms_enabled: false,
        updated_at: new Date(),
      })
      .where('tenant_id = :tenantId AND sms_phone_number = :number', {
        tenantId: request.tenant_id,
        number: request.sms_phone_number,
      })
      .execute();

    await this.requestRepo.update(
      { id: requestId },
      {
        status: 'released',
        failure_reason: `${request.failure_reason || ''} | reconciled_at=${new Date().toISOString()}`,
        updated_at: new Date(),
      },
    );
    return this.requestRepo.findOneOrFail({ where: { id: requestId } });
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async markFailed(
    requestId: string,
    reason: string,
  ): Promise<SmsNumberReleaseRequest> {
    await this.requestRepo.update(
      { id: requestId },
      {
        status: 'failed',
        failure_reason: reason,
        updated_at: new Date(),
      },
    );
    this.logger.warn(`SMS release request ${requestId} failed: ${reason}`);
    return this.requestRepo.findOneOrFail({ where: { id: requestId } });
  }
}
