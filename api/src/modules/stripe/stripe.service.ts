import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';

@Injectable()
export class StripeService {
  private stripe: Stripe;

  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(AutomationLog) private logRepo: Repository<AutomationLog>,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', { apiVersion: '2024-12-18.acacia' as any });
  }

  // --- Connect Onboarding ---

  async onboardConnect(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    let accountId = tenant.stripe_connect_id;
    if (!accountId) {
      const account = await this.stripe.accounts.create({
        type: 'standard',
        email: undefined, // will be filled during onboarding
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

  // --- Customer Management ---

  async getOrCreateStripeCustomer(tenantId: string, customerId: string): Promise<string> {
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
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

  // --- Setup Intent (save card for later) ---

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

  // --- Charge Invoice ---

  async chargeInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId, tenant_id: tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'paid') throw new BadRequestException('Invoice already paid');

    const stripeCustomerId = await this.getOrCreateStripeCustomer(tenantId, invoice.customer_id);
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const amount = Math.round(Number(invoice.balance_due) * 100); // cents

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

      await this.invoiceRepo.update(invoiceId, {
        status: 'paid',
        amount_paid: invoice.total,
        balance_due: 0,
        paid_at: new Date(),
        stripe_payment_intent_id: pi.id,
        stripe_charge_id: pi.latest_charge as string,
        payment_method: `card_${paymentMethods.data[0].card?.last4 || '****'}`,
      } as any);

      await this.logRepo.save(this.logRepo.create({
        tenant_id: tenantId, job_id: invoice.job_id, type: 'payment_collected', status: 'success',
        details: { invoiceId, amount: Number(invoice.balance_due), paymentIntentId: pi.id },
      }));

      return { success: true, paymentIntentId: pi.id };
    } catch (err: any) {
      await this.logRepo.save(this.logRepo.create({
        tenant_id: tenantId, job_id: invoice.job_id, type: 'payment_failed', status: 'failed',
        details: { invoiceId, error: err.message },
      }));
      throw new BadRequestException(`Payment failed: ${err.message}`);
    }
  }

  // --- Refund ---

  async refundInvoice(tenantId: string, invoiceId: string, amount?: number) {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId, tenant_id: tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.stripe_payment_intent_id) throw new BadRequestException('No payment to refund');

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const refundAmount = amount ? Math.round(amount * 100) : undefined; // full refund if not specified

    const refund = await this.stripe.refunds.create({
      payment_intent: invoice.stripe_payment_intent_id,
      ...(refundAmount ? { amount: refundAmount } : {}),
      metadata: { invoiceId, tenantId },
    }, tenant?.stripe_connect_id ? { stripeAccount: tenant.stripe_connect_id } : undefined);

    const refundedAmount = refund.amount / 100;
    await this.invoiceRepo.update(invoiceId, {
      stripe_refund_id: refund.id,
      amount_paid: Number(invoice.amount_paid) - refundedAmount,
      balance_due: Number(invoice.balance_due) + refundedAmount,
      status: refundedAmount >= Number(invoice.total) ? 'void' : 'sent',
    } as any);

    await this.logRepo.save(this.logRepo.create({
      tenant_id: tenantId, job_id: invoice.job_id, type: 'refund_processed', status: 'success',
      details: { invoiceId, refundId: refund.id, amount: refundedAmount },
    }));

    return { success: true, refundId: refund.id, refundedAmount };
  }

  // --- Webhook ---

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
          await this.invoiceRepo.update(pi.metadata.invoiceId, { status: 'paid', paid_at: new Date(), stripe_payment_intent_id: pi.id } as any);
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata.invoiceId) {
          await this.invoiceRepo.update(pi.metadata.invoiceId, { notes: `Payment failed: ${pi.last_payment_error?.message || 'Unknown error'}` } as any);
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
}
