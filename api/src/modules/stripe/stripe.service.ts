import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Stripe from 'stripe';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';
import { StripeEvent } from './entities/stripe-event.entity';
import { buildStripeIdempotencyKey } from './idempotency.util';
import { InvoiceService } from '../billing/services/invoice.service';

@Injectable()
export class StripeService {
  private stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    @InjectRepository(Notification) private notifRepo: Repository<Notification>,
    @InjectRepository(SubscriptionPlan) private planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(StripeEvent) private stripeEventRepo: Repository<StripeEvent>,
    private dataSource: DataSource,
    // PR-C1c: invoiceService.reconcileBalance() is the canonical writer
    // for invoice.amount_paid / balance_due / status / paid_at. Sites 1 + 2
    // (chargeInvoice / refundInvoice sync paths) call it instead of writing
    // invoice columns directly. Sites 3 + 4 (webhook handlers) remain
    // bypassed pending PR-C2's stripe_events event-id dedup table.
    private invoiceService: InvoiceService,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', { apiVersion: '2024-12-18.acacia' as any });
  }

  /** Expose the Stripe client for modules that need direct API access (e.g. Checkout Sessions). */
  getClient(): Stripe {
    return this.stripe;
  }

  /**
   * Arc J.1 — thin refund-API helper for the cancellation orchestrator.
   *
   * Purpose: `refundInvoice` re-derives invoice state, picks the most
   * recent payment, and writes notifications — all redundant when the
   * orchestrator already has the right Payment row loaded and its own
   * audit trail. This method is the thin call: ONE Stripe API call,
   * tenant-scoped via `stripe_connect_id`, no DB writes, no
   * notifications. The orchestrator wraps the result in its
   * post-commit transaction.
   *
   * Throws if Stripe rejects the create call. Caller is expected to
   * catch and route the failure into a `stripe_failed` audit row.
   */
  async createRefundForPaymentIntent(
    tenantId: string,
    paymentIntentId: string,
    amount: number,
    metadata: Record<string, string>,
    idempotencyKey?: string,
  ): Promise<{ refundId: string; refundedAmount: number }> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const payload = {
      payment_intent: paymentIntentId,
      amount: Math.round(amount * 100),
      metadata,
    };
    const requestOptions: Stripe.RequestOptions = {
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(tenant?.stripe_connect_id
        ? { stripeAccount: tenant.stripe_connect_id }
        : {}),
    };
    try {
      const refund = await this.stripe.refunds.create(payload, requestOptions);
      return { refundId: refund.id, refundedAmount: refund.amount / 100 };
    } catch (err: any) {
      if (
        err?.type === 'StripeIdempotencyError' ||
        err?.code === 'idempotency_error'
      ) {
        console.error(
          '[stripe-idempotency] Conflict on key reuse with different payload',
          {
            idempotencyKey,
            method: 'refunds.create',
            tenantId,
            payloadKeys: Object.keys(payload),
          },
        );
      }
      throw err;
    }
  }

  async onboardConnect(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    let accountId = tenant.stripe_connect_id;
    if (!accountId) {
      const account = await this.stripe.accounts.create({
        type: 'standard',
        email: undefined,
        metadata: { tenantId, tenantName: tenant.name },
      });
      accountId = account.id;
      await this.tenantRepo.update(tenantId, { stripe_connect_id: accountId });
    }

    const link = await this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL || 'https://app.rentthisapp.com'}/settings?tab=billing&stripe=refresh`,
      return_url: `${process.env.FRONTEND_URL || 'https://app.rentthisapp.com'}/settings?tab=billing&stripe=success`,
      type: 'account_onboarding',
    });

    return { url: link.url, accountId };
  }

  async getConnectStatus(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    if (!tenant.stripe_connect_id) {
      return { connected: false, onboarded: false, accountId: null };
    }

    try {
      const account = await this.stripe.accounts.retrieve(tenant.stripe_connect_id);
      const onboarded = account.charges_enabled && account.payouts_enabled;
      if (onboarded && !tenant.stripe_onboarded) {
        await this.tenantRepo.update(tenantId, { stripe_onboarded: true });
      }
      return { connected: true, onboarded, accountId: tenant.stripe_connect_id, email: account.email };
    } catch {
      return { connected: true, onboarded: false, accountId: tenant.stripe_connect_id };
    }
  }

  async getOrCreateStripeCustomer(tenantId: string, customerId: string): Promise<string> {
    const customer = await this.customerRepo.findOne({ where: { id: customerId, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');

    if (customer.stripe_customer_id) return customer.stripe_customer_id;

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const stripeCustomer = await this.stripe.customers.create({
      name: `${customer.first_name} ${customer.last_name}`,
      email: customer.email || undefined,
      phone: customer.phone || undefined,
      metadata: { customerId: customer.id, tenantId },
    }, tenant?.stripe_connect_id ? { stripeAccount: tenant.stripe_connect_id } : undefined);

    await this.customerRepo.update(customerId, { stripe_customer_id: stripeCustomer.id });
    return stripeCustomer.id;
  }

  async createSetupIntent(tenantId: string, customerId: string) {
    const stripeCustomerId = await this.getOrCreateStripeCustomer(tenantId, customerId);
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });

    const intent = await this.stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      metadata: { customerId, tenantId },
    }, tenant?.stripe_connect_id ? { stripeAccount: tenant.stripe_connect_id } : undefined);

    return { clientSecret: intent.client_secret, setupIntentId: intent.id };
  }

  async chargeInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId, tenant_id: tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'paid') throw new BadRequestException('Invoice already paid');

    const stripeCustomerId = await this.getOrCreateStripeCustomer(tenantId, invoice.customer_id);
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const amount = Math.round(Number(invoice.balance_due) * 100);

    if (amount <= 0) throw new BadRequestException('No balance due');

    const feePercent = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || 2.9);
    const appFee = Math.round(amount * (feePercent / 100));

    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card',
      }, tenant?.stripe_connect_id ? { stripeAccount: tenant.stripe_connect_id } : undefined);

      if (!paymentMethods.data.length) throw new BadRequestException('No card on file. Customer needs to add a payment method.');

      // PR-C1b-1: Stripe idempotency. Balance-keying distinguishes
      // "retry the same charge" (Stripe replays cached response — safe
      // dedup) from "balance changed, new charge attempt" (new key
      // fires — correctly takes the new charge). Pure invoice-keyed
      // shape would silently dedupe a legitimate retry-after-card-fix.
      const idempotencyKey = buildStripeIdempotencyKey([
        'tenant-' + tenantId,
        'charge',
        'invoice-' + invoiceId,
        'balance-' + amount,
      ]);
      const piPayload: Stripe.PaymentIntentCreateParams = {
        amount,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethods.data[0].id,
        off_session: true,
        confirm: true,
        metadata: { invoiceId, tenantId },
        ...(tenant?.stripe_connect_id ? {
          application_fee_amount: appFee,
          transfer_data: { destination: tenant.stripe_connect_id },
        } : {}),
      };
      const piOptions: Stripe.RequestOptions = {
        idempotencyKey,
        ...(tenant?.stripe_connect_id
          ? { stripeAccount: tenant.stripe_connect_id }
          : {}),
      };
      let pi: Stripe.PaymentIntent;
      try {
        pi = await this.stripe.paymentIntents.create(piPayload, piOptions);
      } catch (innerErr: any) {
        if (
          innerErr?.type === 'StripeIdempotencyError' ||
          innerErr?.code === 'idempotency_error'
        ) {
          console.error(
            '[stripe-idempotency] Conflict on key reuse with different payload',
            {
              idempotencyKey,
              method: 'paymentIntents.create',
              tenantId,
              payloadKeys: Object.keys(piPayload),
            },
          );
        }
        throw innerErr;
      }

      // Create payment record first
      await this.paymentRepo.save(this.paymentRepo.create({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        amount: Number(invoice.balance_due),
        payment_method: `card_${paymentMethods.data[0].card?.last4 || '****'}`,
        stripe_payment_intent_id: pi.id,
        status: 'completed',
      }));

      // PR-C1c: redirect to canonical reconcileBalance() writer.
      // The paymentRepo.save above records the new payment row;
      // reconcileBalance reads all completed payments (including
      // this one) and produces the correct amount_paid / balance_due
      // / status / paid_at per the canonical contract. See
      // docs/audits/2026-04-30-reconcilebalance-bypass-audit.md.
      await this.invoiceService.reconcileBalance(invoiceId);

      await this.notifRepo.save(this.notifRepo.create({
        tenant_id: tenantId, job_id: invoice.job_id, channel: 'automation', type: 'payment_collected',
        recipient: 'system', body: JSON.stringify({ invoiceId, amount: Number(invoice.balance_due), paymentIntentId: pi.id }),
        status: 'logged', sent_at: new Date(),
      }));

      return { success: true, paymentIntentId: pi.id };
    } catch (err: any) {
      await this.notifRepo.save(this.notifRepo.create({
        tenant_id: tenantId, job_id: invoice.job_id, channel: 'automation', type: 'payment_failed',
        recipient: 'system', body: JSON.stringify({ invoiceId, error: err.message }),
        status: 'logged', sent_at: new Date(),
      }));
      // Phase 6: Alert admin of failed payment
      await this.logPaymentFailedAlert(tenantId, invoiceId, err.message);
      throw new BadRequestException(`Payment failed: ${err.message}`);
    }
  }

  async refundInvoice(tenantId: string, invoiceId: string, amount?: number) {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId, tenant_id: tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    // Find the payment with stripe_payment_intent_id
    const payment = await this.paymentRepo.findOne({
      where: { invoice_id: invoiceId },
      order: { applied_at: 'DESC' },
    });
    if (!payment?.stripe_payment_intent_id) throw new BadRequestException('No payment to refund');

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const refundAmount = amount ? Math.round(amount * 100) : undefined;

    // PR-C1b-1: Stripe idempotency. Cumulative discriminator prevents
    // silent dedup of legitimate identical-amount partial refunds.
    // `prevRefundedCents` snapshot at call time + this refund's `cents`
    // makes each subsequent partial refund a unique key.
    const prevRefundedCents = Math.round(
      Number(payment.refunded_amount || 0) * 100,
    );
    const refundCents =
      refundAmount ??
      Math.max(
        Math.round(Number(invoice.total) * 100) - prevRefundedCents,
        0,
      );
    const idempotencyKey = buildStripeIdempotencyKey([
      'tenant-' + tenantId,
      'refund',
      'invoice-' + invoiceId,
      'payment-' + payment.id,
      'cumulative-' + prevRefundedCents + '-' + refundCents,
    ]);
    const refundPayload: Stripe.RefundCreateParams = {
      payment_intent: payment.stripe_payment_intent_id,
      ...(refundAmount ? { amount: refundAmount } : {}),
      metadata: { invoiceId, tenantId },
    };
    const refundOptions: Stripe.RequestOptions = {
      idempotencyKey,
      ...(tenant?.stripe_connect_id
        ? { stripeAccount: tenant.stripe_connect_id }
        : {}),
    };
    let refund: Stripe.Refund;
    try {
      refund = await this.stripe.refunds.create(refundPayload, refundOptions);
    } catch (err: any) {
      if (
        err?.type === 'StripeIdempotencyError' ||
        err?.code === 'idempotency_error'
      ) {
        console.error(
          '[stripe-idempotency] Conflict on key reuse with different payload',
          {
            idempotencyKey,
            method: 'refunds.create',
            tenantId,
            payloadKeys: Object.keys(refundPayload),
          },
        );
      }
      throw err;
    }

    const refundedAmount = refund.amount / 100;

    // Update payment
    payment.refunded_amount = Math.round((Number(payment.refunded_amount || 0) + refundedAmount) * 100) / 100;
    await this.paymentRepo.save(payment);

    // PR-C1c: stamp voided_at on full refund per C-2 (audit doc),
    // then redirect to canonical reconcileBalance() writer. The
    // payment.refunded_amount update at line ~348-349 above is what
    // reconcileBalance() reads to compute net totalPaid (PR-C1c-pre
    // math fix at invoice.service.ts:987). Stamping voided_at BEFORE
    // reconcileBalance lets the canonical writer's voided_at-keyed
    // branch produce 'voided' status; without the stamp,
    // fully-refunded invoices would fall into 'open' status. See
    // docs/audits/2026-04-30-reconcilebalance-bypass-audit.md
    // Phase 1 Critical Finding #2. Partial refunds leave voided_at
    // null and let reconcileBalance set status to 'partial' via its
    // 0 < amount_paid < total branch.
    if (await this.invoiceService.isFullyRefunded(invoiceId)) {
      await this.invoiceRepo.update(invoiceId, { voided_at: new Date() });
    }
    await this.invoiceService.reconcileBalance(invoiceId);

    await this.notifRepo.save(this.notifRepo.create({
      tenant_id: tenantId, job_id: invoice.job_id, channel: 'automation', type: 'refund_processed',
      recipient: 'system', body: JSON.stringify({ invoiceId, refundId: refund.id, amount: refundedAmount }),
      status: 'logged', sent_at: new Date(),
    }));

    return { success: true, refundId: refund.id, refundedAmount };
  }

  async handleWebhook(payload: Buffer, signature: string) {
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event: Stripe.Event;

    try {
      event = endpointSecret
        ? this.stripe.webhooks.constructEvent(payload, signature, endpointSecret)
        : JSON.parse(payload.toString()) as Stripe.Event;
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    // PR-C2-pre: webhook event-id dedup at entry point.
    // Per audit D-3 (docs/audits/2026-04-30-pr-c2-webhook-dedup-audit.md):
    // INSERT ... ON CONFLICT DO NOTHING RETURNING id is the canonical
    // first-occurrence detector. Duplicate events return early without
    // reaching the switch. Money-movement event tenant resolution uses
    // the locked Option A inline fallback chain (metadata.tenantId →
    // metadata.invoiceId → invoice.tenant_id → throw).
    let dedupTenantId: string | null = null;
    if (event.type.startsWith('payment_intent.')) {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.tenantId) {
        dedupTenantId = pi.metadata.tenantId;
      } else if (pi.metadata?.invoiceId) {
        const inv = await this.invoiceRepo.findOne({ where: { id: pi.metadata.invoiceId } });
        if (inv) dedupTenantId = inv.tenant_id;
      }
      if (!dedupTenantId) {
        throw new InternalServerErrorException(
          `Cannot resolve tenant for ${event.type}: no metadata.tenantId or resolvable invoiceId in event ${event.id}`,
        );
      }
    } else if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      dedupTenantId = session.metadata?.tenantId ?? null;
      if (!dedupTenantId) {
        throw new InternalServerErrorException(
          `Cannot resolve tenant for checkout.session.completed: no metadata.tenantId in event ${event.id}`,
        );
      }
    } else if (event.type === 'account.updated') {
      // Per audit D-1: best-effort dedup for Connect platform events
      // (no payload-derivable tenant_id). Future hardening: issue #33.
      dedupTenantId = null;
    } else {
      // Unhandled event type: best-effort dedup with NULL tenant_id.
      // The switch will no-op for unknown events anyway; logging here for
      // visibility into events Stripe sends that we don't handle.
      this.logger.warn(`Unhandled webhook event type: ${event.type} (${event.id}) — dedup with NULL tenant_id`);
      dedupTenantId = null;
    }

    const dedup = await this.stripeEventRepo
      .createQueryBuilder()
      .insert()
      .into(StripeEvent)
      .values({ event_id: event.id, event_type: event.type, tenant_id: dedupTenantId })
      .orIgnore()
      .returning(['id'])
      .execute();

    // TypeORM 0.3.x InsertResult shape varies on Postgres .orIgnore().returning():
    // successful insert populates `raw` (and may populate `identifiers`); on
    // CONFLICT both are empty. Check both to be safe — covered by Test 0.
    const inserted = (dedup.raw?.length ?? 0) > 0 || (dedup.identifiers?.length ?? 0) > 0;
    if (!inserted) {
      this.logger.warn(`Duplicate webhook event ignored: ${event.id} (${event.type})`);
      return { received: true };
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        // arcV Phase 2 (audit § 9.2 PR-C2 contract): replace bypass write with
        // reconcileBalance — sole writer of money columns per Invoice Rule #1.
        // The chargeInvoice path that produced this PI already wrote the
        // Payment row, so reconcileBalance has the data it needs. No internal
        // dedup guard at Site 3 because chargeInvoice is single-call
        // synchronous (audit § D-4: webhook path is the at-least-once threat
        // surface, not chargeInvoice).
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata.invoiceId) {
          await this.invoiceService.reconcileBalance(pi.metadata.invoiceId);
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata.invoiceId) {
          const failedInv = await this.invoiceRepo.findOne({ where: { id: pi.metadata.invoiceId } });
          if (failedInv) {
            // §K.3 (Arc K Phase 1A Step 0): prefer pi.metadata.tenantId — set on PIs
            // created by chargeInvoice since this commit. Fall back to invoice
            // tenant_id for legacy PIs created before metadata enrichment. This
            // resolution pattern is also the foundation for Sentry tenant tagging
            // wired in Step 2.
            const tenantId = pi.metadata.tenantId ?? failedInv.tenant_id;
            // Phase 6: Alert admin of failed payment
            await this.logPaymentFailedAlert(
              tenantId,
              pi.metadata.invoiceId,
              pi.last_payment_error?.message || 'Unknown error',
            );
          }
        }
        break;
      }
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.invoiceId && session.payment_status === 'paid') {
          const invId = session.metadata.invoiceId;
          const tId = session.metadata.tenantId;
          const inv = await this.invoiceRepo.findOne({ where: { id: invId } });
          if (inv) {
            const paidAmount = (session.amount_total || 0) / 100;
            const paymentIntentId =
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id ?? null;
            // arcV Phase 2 (audit § D-4): defense-in-depth dedup guard.
            // The entry-point stripe_events INSERT (PR-C2-pre, line 436)
            // covers the common path; this internal guard covers
            // crash-mid-handler / dedup-bug / concurrent-delivery TOCTOU
            // scenarios for money-movement. Tenant-scoped to match the
            // partial unique index idx_payments_tenant_pi_unique
            // (arcV Phase 1) and CLAUDE.md MULTI-TENANT SAFE.
            const existingPayment = paymentIntentId
              ? await this.paymentRepo.findOne({
                  where: { tenant_id: tId, stripe_payment_intent_id: paymentIntentId },
                })
              : null;
            if (existingPayment) {
              this.logger.warn(
                `Site 4 dedup hit: payment for stripe_payment_intent_id=${paymentIntentId} ` +
                `already exists (tenant=${tId}, invoice=${invId}); skipping save.`,
              );
            } else {
              await this.paymentRepo.save(this.paymentRepo.create({
                tenant_id: tId,
                invoice_id: invId,
                amount: paidAmount,
                payment_method: 'stripe_checkout',
                stripe_payment_intent_id: paymentIntentId,
                status: 'completed',
                applied_at: new Date(),
                notes: `Stripe Checkout Session ${session.id}`,
              }));
            }
            const allPayments = await this.paymentRepo.find({ where: { invoice_id: invId, status: 'completed' } });
            const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);
            const balanceDue = Math.max(Math.round((Number(inv.total) - totalPaid) * 100) / 100, 0);
            await this.invoiceRepo.update(invId, {
              status: balanceDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'open',
              amount_paid: Math.round(totalPaid * 100) / 100,
              balance_due: balanceDue,
              paid_at: balanceDue <= 0 ? new Date() : null,
            });
          }
        }
        break;
      }
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        if (account.charges_enabled && account.payouts_enabled) {
          await this.tenantRepo.update({ stripe_connect_id: account.id } as any, { stripe_onboarded: true });
        }
        break;
      }
    }

    return { received: true };
  }

  private async logPaymentFailedAlert(tenantId: string, invoiceId: string, errorMessage: string) {
    try {
      const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId }, relations: ['customer'] });
      if (!invoice) return;

      const customerName = invoice.customer
        ? `${invoice.customer.first_name} ${invoice.customer.last_name}`
        : 'Unknown';

      const alertMessage = `Payment failed for ${customerName} — Invoice #${invoice.invoice_number} ($${Number(invoice.balance_due).toFixed(2)}): ${errorMessage}`;
      const href = `/invoices/${invoiceId}`;

      // Dedup: check if same alert already sent in last 24 hours
      const recent = await this.dataSource.query(
        `SELECT COUNT(*) as cnt FROM notifications
         WHERE tenant_id = $1 AND type = 'payment_failed' AND channel = 'admin_email'
         AND body LIKE $2 AND created_at > NOW() - INTERVAL '24 hours'`,
        [tenantId, `%${invoiceId}%`],
      );
      if (Number(recent[0]?.cnt) > 0) return;

      // Rate limit: max 5 admin emails per hour
      const hourCount = await this.dataSource.query(
        `SELECT COUNT(*) as cnt FROM notifications
         WHERE tenant_id = $1 AND type IN ('admin_alert', 'payment_failed') AND channel IN ('email', 'admin_email')
         AND created_at > NOW() - INTERVAL '1 hour'`,
        [tenantId],
      );
      if (Number(hourCount[0]?.cnt) >= 5) return;

      // Get admin email
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
      const adminEmail = (tenant as any)?.website_email;
      if (!adminEmail) return;

      // Log as notification for dedup tracking and delivery
      await this.dataSource.query(
        `INSERT INTO notifications (id, tenant_id, channel, type, recipient, subject, body, status, sent_at, created_at)
         VALUES (gen_random_uuid(), $1, 'admin_email', 'payment_failed', $2, $3, $4, 'delivered', NOW(), NOW())`,
        [tenantId, adminEmail, `Payment Failed: Invoice #${invoice.invoice_number}`, alertMessage],
      );

      this.logger.warn(`Payment failed alert: ${alertMessage}`);
    } catch (err) {
      this.logger.error(`Failed to log payment alert: ${err}`);
    }
  }

  async getPlans() {
    return this.planRepo.find({ where: { is_active: true }, order: { price_per_driver_monthly: 'ASC' } });
  }

  async getSubscription(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const plan = await this.planRepo.findOne({ where: { tier: tenant.subscription_tier, is_active: true } });

    return {
      tier: tenant.subscription_tier,
      status: tenant.subscription_status,
      peakDriverCount: tenant.peak_driver_count,
      activeDriverCount: tenant.billable_driver_count,
      pricePerDriver: plan ? Number(plan.price_per_driver_monthly) : 0,
      monthlyCost: (tenant.peak_driver_count || 1) * (plan ? Number(plan.price_per_driver_monthly) : 0),
      stripeSubscriptionId: tenant.stripe_subscription_id,
      trialEndsAt: tenant.trial_ends_at,
      subscriptionStartedAt: tenant.subscription_started_at,
      subscriptionEndsAt: tenant.subscription_ends_at,
    };
  }

  async subscribe(tenantId: string, tier: string, billingCycle: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const plan = await this.planRepo.findOne({ where: { tier, is_active: true } });
    if (!plan) throw new BadRequestException('Invalid plan');

    const priceId = billingCycle === 'annual' ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly;
    const quantity = Math.max(tenant.peak_driver_count, 1);

    let stripeCustomerId = tenant.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        name: tenant.name,
        metadata: { tenantId, type: 'tenant' },
      });
      stripeCustomerId = customer.id;
      await this.tenantRepo.update(tenantId, { stripe_customer_id: stripeCustomerId });
    }

    if (priceId) {
      // PR-C1b-1: Stripe idempotency. Coexists with the existing
      // `if (!stripeCustomerId)` guard above — guard catches the
      // "customer already exists" duplicate; this key catches the
      // orthogonal "Stripe call succeeded but DB write missed" race
      // (line 465 update happens AFTER the create). Subscriptions are
      // platform-account (no Connect routing here), so the options
      // object holds the idempotency key alone.
      const subscribeIdempotencyKey = buildStripeIdempotencyKey([
        'tenant-' + tenantId,
        'subscribe',
        'tier-' + tier,
        'cycle-' + billingCycle,
      ]);
      const subscribePayload: Stripe.SubscriptionCreateParams = {
        customer: stripeCustomerId,
        items: [{ price: priceId, quantity }],
        metadata: { tenantId, tier },
      };
      let subscription: Stripe.Subscription;
      try {
        subscription = await this.stripe.subscriptions.create(
          subscribePayload,
          { idempotencyKey: subscribeIdempotencyKey },
        );
      } catch (err: any) {
        if (
          err?.type === 'StripeIdempotencyError' ||
          err?.code === 'idempotency_error'
        ) {
          console.error(
            '[stripe-idempotency] Conflict on key reuse with different payload',
            {
              idempotencyKey: subscribeIdempotencyKey,
              method: 'subscriptions.create',
              tenantId,
              payloadKeys: Object.keys(subscribePayload),
            },
          );
        }
        throw err;
      }

      await this.tenantRepo.update(tenantId, {
        subscription_tier: tier,
        subscription_status: 'active',
        stripe_subscription_id: subscription.id,
        subscription_started_at: new Date(),
        enabled_modules: plan.enabled_modules,
      });
    } else {
      await this.tenantRepo.update(tenantId, {
        subscription_tier: tier,
        subscription_status: 'active',
        subscription_started_at: new Date(),
        enabled_modules: plan.enabled_modules,
      });
    }

    return { tier, quantity, status: 'active' };
  }

  async cancelSubscription(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant?.stripe_subscription_id) throw new BadRequestException('No active subscription');

    await this.stripe.subscriptions.update(tenant.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    await this.tenantRepo.update(tenantId, { subscription_status: 'cancelled' });
    return { message: 'Subscription will cancel at end of billing period' };
  }

  async getBillingPortalUrl(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant?.stripe_customer_id) throw new BadRequestException('No Stripe customer');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL || 'https://app.rentthisapp.com'}/settings?tab=billing`,
    });

    return { url: session.url };
  }

  async updateDriverCount(tenantId: string, increment: boolean) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return;

    const newCount = increment
      ? (tenant.billable_driver_count || 0) + 1
      : Math.max(0, (tenant.billable_driver_count || 0) - 1);

    const updates: Record<string, unknown> = { billable_driver_count: newCount };

    if (increment && newCount > (tenant.peak_driver_count || 0)) {
      updates.peak_driver_count = newCount;

      if (tenant.stripe_subscription_id) {
        try {
          const sub = await this.stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
          if (sub.items.data.length > 0) {
            await this.stripe.subscriptionItems.update(sub.items.data[0].id, { quantity: newCount });
          }
        } catch { /* Stripe may not be configured yet */ }
      }
    }

    await this.tenantRepo.update(tenantId, updates);
  }

  async seedPlans() {
    const plans = [
      { tier: 'starter', price_per_driver_monthly: 149, price_per_driver_annual: 129, features: ['CRM', 'Jobs', 'Dispatch', 'Invoicing', 'Assets'], enabled_modules: ['crm', 'jobs', 'dispatch', 'invoicing', 'assets'] },
      { tier: 'pro', price_per_driver_monthly: 199, price_per_driver_annual: 179, features: ['All Starter', 'Driver App', 'Customer Portal', 'Website Builder', 'Reporting', 'Dump Slips'], enabled_modules: ['crm', 'jobs', 'dispatch', 'invoicing', 'assets', 'driver_app', 'customer_portal', 'website_builder', 'reporting', 'dump_slips', 'weight_tickets', 'overage_items', 'dump_locations', 'asset_pins', 'notifications'] },
      { tier: 'enterprise', price_per_driver_monthly: 249, price_per_driver_annual: 219, features: ['All Pro', 'White Label', 'API Access', 'Multi-Yard', 'Advanced Reporting'], enabled_modules: ['crm', 'jobs', 'dispatch', 'invoicing', 'assets', 'driver_app', 'customer_portal', 'website_builder', 'reporting', 'dump_slips', 'weight_tickets', 'overage_items', 'dump_locations', 'asset_pins', 'notifications', 'white_label', 'api_access', 'multi_yard', 'advanced_reporting', 'accounting_integrations'] },
    ];

    for (const p of plans) {
      const existing = await this.planRepo.findOne({ where: { tier: p.tier } });
      if (existing) {
        await this.planRepo.update(existing.id, p as any);
      } else {
        await this.planRepo.save(this.planRepo.create(p as Partial<SubscriptionPlan>));
      }
    }
    return { message: 'Plans seeded', count: plans.length };
  }
}
