import { Controller, Get, Post, Param, Body, Query, Req, Headers, RawBody } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { StripeService } from './stripe.service';
import { TenantId, Public } from '../../common/decorators';

@ApiTags('Stripe')
@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Get('subscription')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current subscription details' })
  subscription(@TenantId() tid: string) {
    return this.stripeService.getSubscription(tid);
  }

  @Post('subscribe')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe to a plan' })
  subscribe(@TenantId() tid: string, @Body() body: { tier: string; billingCycle?: string }) {
    return this.stripeService.subscribe(tid, body.tier, body.billingCycle || 'monthly');
  }

  @Post('cancel-subscription')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel subscription at end of period' })
  cancelSubscription(@TenantId() tid: string) {
    return this.stripeService.cancelSubscription(tid);
  }

  @Get('billing-portal')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Stripe billing portal URL' })
  billingPortal(@TenantId() tid: string) {
    return this.stripeService.getBillingPortalUrl(tid);
  }

  @Get('plans')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get available subscription plans' })
  plans() {
    return this.stripeService.getPlans();
  }

  @Public()
  @Post('seed-plans')
  @ApiOperation({ summary: 'Seed subscription plans (run once)' })
  seedPlans() {
    return this.stripeService.seedPlans();
  }

  @Post('connect/onboard')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start Stripe Connect onboarding' })
  onboard(@TenantId() tid: string) {
    return this.stripeService.onboardConnect(tid);
  }

  @Get('connect/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Stripe Connect status' })
  status(@TenantId() tid: string) {
    return this.stripeService.getConnectStatus(tid);
  }

  @Post('setup-intent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create setup intent to save card' })
  setupIntent(@TenantId() tid: string, @Body() body: { customerId: string }) {
    return this.stripeService.createSetupIntent(tid, body.customerId);
  }

  @Post('charge-invoice/:invoiceId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Charge customer card for an invoice' })
  chargeInvoice(@TenantId() tid: string, @Param('invoiceId') invoiceId: string) {
    return this.stripeService.chargeInvoice(tid, invoiceId);
  }

  @Post('refund/:invoiceId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Process refund for a paid invoice' })
  refund(@TenantId() tid: string, @Param('invoiceId') invoiceId: string, @Body() body: { amount?: number }) {
    return this.stripeService.refundInvoice(tid, invoiceId, body.amount);
  }

  @Public()
  @Post('webhook')
  @ApiOperation({ summary: 'Stripe webhook handler' })
  async webhook(@Body() payload: Buffer, @Headers('stripe-signature') signature: string) {
    return this.stripeService.handleWebhook(payload, signature || '');
  }
}
