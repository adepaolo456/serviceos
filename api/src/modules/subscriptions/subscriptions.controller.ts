import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  Headers,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SubscriptionsService } from './subscriptions.service';
import { Public } from '../../common/decorators';

@ApiTags('Subscriptions')
@Controller('billing')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('subscription')
  @ApiBearerAuth()
  async getSubscription(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.subscriptionsService.getSubscription(user.tenantId);
  }

  @Post('create-checkout-session')
  @ApiBearerAuth()
  async createCheckout(
    @Req() req: Request,
    @Body() body: { plan: string },
  ) {
    const user = req.user as { tenantId: string; email: string };
    return this.subscriptionsService.createCheckoutSession(
      user.tenantId,
      body.plan,
      user.email,
    );
  }

  @Get('portal')
  @ApiBearerAuth()
  async portal(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.subscriptionsService.createPortalSession(user.tenantId);
  }

  @Post('webhook')
  @Public()
  @HttpCode(200)
  async webhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ) {
    // Raw body is needed for webhook verification
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const body = rawBody || Buffer.from(JSON.stringify(req.body));
    const result = await this.subscriptionsService.handleWebhook(
      body,
      signature,
    );
    res.json(result);
  }
}
