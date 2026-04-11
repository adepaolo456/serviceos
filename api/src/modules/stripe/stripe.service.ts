import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Stripe from 'stripe';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';

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
    private dataSource: DataSource,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', { apiVersion: '2024-12-18.acacia' as any });
  }

  /** Expose the Stripe client for modules that need direct API access (e.g. Checkout Sessions). */
  getClient(): Stripe {
    return this.stripe;
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
      refresh_url: `${process.env.FRONTEND_URL || 'https://serviceos-web-zeta.vercel.app'}/settings?tab=billing&stripe=refresh`,
      return_url: `${process.env.FRONTEND_URL || 'https://serviceos-web-zeta.vercel.app'}/settings?tab=billing&stripe=success`,
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

      const pi = await this.stripe.paymentIntents.create({
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
      }, tenant?.stripe_connect_id ? { stripeAccount: tenant.stripe_connect_id } : undefined);

      // Create payment record first
      await this.paymentRepo.save(this.paymentRepo.create({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        amount: Number(invoice.balance_due),
        payment_method: `card_${paymentMethods.data[0].card?.last4 || '****'}`,
        stripe_payment_intent_id: pi.id,
        status: 'completed',
      }));

      // Derive invoice state from payments
      const allPayments = await this.paymentRepo.find({ where: { invoice_id: invoiceId, status: 'completed' } });
      const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      const balanceDue = Math.max(Math.round((Number(invoice.total) - totalPaid) * 100) / 100, 0);
      await this.invoiceRepo.update(invoiceId, {
        status: balanceDue <= 0 ? 'paid' : 'partial',
        amount_paid: Math.round(totalPaid * 100) / 100,
        balance_due: balanceDue,
        paid_at: balanceDue <= 0 ? new Date() : null,
      });

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

    const refund = await this.stripe.refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      ...(refundAmount ? { amount: refundAmount } : {}),
      metadata: { invoiceId, tenantId },
    }, tenant?.stripe_connect_id ? { stripeAccount: tenant.stripe_connect_id } : undefined);

    const refundedAmount = refund.amount / 100;

    // Update payment
    payment.refunded_amount = Math.round((Number(payment.refunded_amount || 0) + refundedAmount) * 100) / 100;
    await this.paymentRepo.save(payment);

    // Derive invoice state from payments (accounting for refunds)
    const allPayments = await this.paymentRepo.find({ where: { invoice_id: invoiceId, status: 'completed' } });
    const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount) - Number(p.refunded_amount || 0), 0);
    const balanceDue = Math.max(Math.round((Number(invoice.total) - totalPaid) * 100) / 100, 0);
    const newStatus = totalPaid <= 0 ? 'voided' : balanceDue <= 0 ? 'paid' : 'partial';
    await this.invoiceRepo.update(invoiceId, {
      amount_paid: Math.round(totalPaid * 100) / 100,
      balance_due: balanceDue,
      status: newStatus,
    });

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

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata.invoiceId) {
          // Derive from payments — the payment record should already exist from chargeInvoice
          const payments = await this.paymentRepo.find({ where: { invoice_id: pi.metadata.invoiceId, status: 'completed' } });
          const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
          const inv = await this.invoiceRepo.findOne({ where: { id: pi.metadata.invoiceId } });
          if (inv) {
            const balanceDue = Math.max(Math.round((Number(inv.total) - totalPaid) * 100) / 100, 0);
            await this.invoiceRepo.update(pi.metadata.invoiceId, {
              status: balanceDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'open',
              amount_paid: Math.round(totalPaid * 100) / 100,
              balance_due: balanceDue,
              paid_at: balanceDue <= 0 ? new Date() : null,
            });
          }
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata.invoiceId) {
          const failedInv = await this.invoiceRepo.findOne({ where: { id: pi.metadata.invoiceId } });
          if (failedInv) {
            // Phase 6: Alert admin of failed payment
            await this.logPaymentFailedAlert(
              failedInv.tenant_id,
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
            await this.paymentRepo.save(this.paymentRepo.create({
              tenant_id: tId,
              invoice_id: invId,
              amount: paidAmount,
              payment_method: 'stripe_checkout',
              status: 'completed',
              applied_at: new Date(),
              notes: `Stripe Checkout Session ${session.id}`,
            }));
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
      const subscription = await this.stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [{ price: priceId, quantity }],
        metadata: { tenantId, tier },
      });

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
      return_url: `${process.env.FRONTEND_URL || 'https://serviceos-web-zeta.vercel.app'}/settings?tab=billing`,
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
