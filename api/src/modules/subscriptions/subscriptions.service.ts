import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { Tenant } from '../tenants/entities/tenant.entity';

const PLANS: Record<string, { name: string; price: number }> = {
  starter: { name: 'ServiceOS Starter', price: 9900 },
  professional: { name: 'ServiceOS Professional', price: 24900 },
  business: { name: 'ServiceOS Business', price: 49900 },
};

@Injectable()
export class SubscriptionsService {
  private stripe: Stripe;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY', ''),
    );
  }

  async selectTrialPlan(tenantId: string, plan: string) {
    if (!PLANS[plan]) throw new BadRequestException('Invalid plan');
    const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await this.tenantsRepository.update(tenantId, {
      subscription_tier: plan,
      subscription_status: 'trialing',
      trial_ends_at: trialEnds,
    });
    return {
      tier: plan,
      status: 'trialing',
      trialEndsAt: trialEnds.toISOString(),
    };
  }

  async getSubscription(tenantId: string) {
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) throw new BadRequestException('Tenant not found');

    return {
      tier: tenant.subscription_tier || 'trial',
      status: tenant.subscription_status || 'trialing',
      stripeCustomerId: tenant.stripe_customer_id || null,
    };
  }

  async createCheckoutSession(
    tenantId: string,
    plan: string,
    userEmail: string,
  ) {
    const planConfig = PLANS[plan];
    if (!planConfig) throw new BadRequestException('Invalid plan');

    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) throw new BadRequestException('Tenant not found');

    // Get or create Stripe customer
    let customerId = tenant.stripe_customer_id;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: userEmail,
        name: tenant.name,
        metadata: { tenantId },
      });
      customerId = customer.id;
      await this.tenantsRepository.update(tenantId, {
        stripe_customer_id: customerId,
      });
    }

    // Create a price on-the-fly (in production, use pre-created price IDs)
    const price = await this.stripe.prices.create({
      currency: 'usd',
      unit_amount: planConfig.price,
      recurring: { interval: 'month' },
      product_data: { name: planConfig.name },
    });

    const appUrl =
      this.configService.get<string>('APP_URL') ||
      'https://app.rentthisapp.com';

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${appUrl}/settings?billing=success`,
      cancel_url: `${appUrl}/settings?billing=cancelled`,
      metadata: { tenantId, plan },
    });

    return { url: session.url };
  }

  async createPortalSession(tenantId: string) {
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant?.stripe_customer_id) {
      throw new BadRequestException(
        'No Stripe customer found. Subscribe to a plan first.',
      );
    }

    const appUrl =
      this.configService.get<string>('APP_URL') ||
      'https://app.rentthisapp.com';

    const session = await this.stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${appUrl}/settings`,
    });

    return { url: session.url };
  }

  async handleWebhook(body: Buffer, signature: string) {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
      '',
    );

    let event: Stripe.Event;
    if (webhookSecret) {
      event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret,
      );
    } else {
      event = JSON.parse(body.toString()) as Stripe.Event;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenantId;
        const plan = session.metadata?.plan;
        if (tenantId && plan) {
          await this.tenantsRepository.update(tenantId, {
            subscription_tier: plan,
            subscription_status: 'active',
            stripe_customer_id:
              typeof session.customer === 'string'
                ? session.customer
                : session.customer?.id,
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer.id;

        const tenant = await this.tenantsRepository.findOne({
          where: { stripe_customer_id: customerId },
        });
        if (tenant) {
          const statusMap: Record<string, string> = {
            active: 'active',
            past_due: 'past_due',
            canceled: 'cancelled',
            unpaid: 'unpaid',
            trialing: 'trialing',
          };
          await this.tenantsRepository.update(tenant.id, {
            subscription_status:
              statusMap[subscription.status] || subscription.status,
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer.id;

        const tenant = await this.tenantsRepository.findOne({
          where: { stripe_customer_id: customerId },
        });
        if (tenant) {
          await this.tenantsRepository.update(tenant.id, {
            subscription_tier: 'trial',
            subscription_status: 'cancelled',
          });
        }
        break;
      }
    }

    return { received: true };
  }
}
