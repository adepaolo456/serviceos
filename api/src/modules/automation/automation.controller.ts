import { Controller, Get, Post, Param, Body, Header, Req, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { AutomationService } from './automation.service';
import { TenantId, Public } from '../../common/decorators';

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

@ApiTags('Automation')
@ApiBearerAuth()
@Controller('automation')
export class AutomationController {
  constructor(
    private readonly automationService: AutomationService,
    private readonly configService: ConfigService,
  ) {}

  private assertCronAuthorized(req: Request): void {
    const cronSecret = this.configService.get<string>('CRON_SECRET');
    if (!cronSecret) {
      throw new InternalServerErrorException('CRON_SECRET not configured');
    }
    // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
    const authHeader = (req.headers.authorization || '') as string;
    const prefix = 'Bearer ';
    if (!authHeader.startsWith(prefix)) {
      throw new UnauthorizedException('Missing cron secret');
    }
    const provided = authHeader.slice(prefix.length);
    if (!timingSafeStringEqual(provided, cronSecret)) {
      throw new UnauthorizedException('Invalid cron secret');
    }
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Get overdue jobs for the tenant' })
  getOverdue(@TenantId() tenantId: string) {
    return this.automationService.getOverdueJobs(tenantId);
  }

  @Post('overdue/scan')
  @ApiOperation({ summary: 'Manually trigger overdue scan' })
  scanOverdue(@TenantId() tenantId: string) {
    return this.automationService.scanOverdueRentals(tenantId);
  }

  @Post('overdue/:jobId/notify')
  @ApiOperation({ summary: 'Send overdue notification for a job' })
  notifyOverdue(@TenantId() tenantId: string, @Param('jobId') jobId: string) {
    return this.automationService.sendOverdueNotification(tenantId, jobId);
  }

  @Post('overdue/:jobId/action')
  @ApiOperation({ summary: 'Take action on an overdue job' })
  actionOverdue(
    @TenantId() tenantId: string,
    @Param('jobId') jobId: string,
    @Body() body: { action: string; days?: number },
  ) {
    return this.automationService.acknowledgeOverdue(tenantId, jobId, body.action, body.days);
  }

  @Post('send-overdue-reminders')
  @ApiOperation({ summary: 'Send reminder emails for overdue invoices' })
  sendOverdueReminders(@TenantId() tenantId: string) {
    return this.automationService.sendOverdueReminders(tenantId);
  }

  @Get('log')
  @ApiOperation({ summary: 'Get automation log' })
  getLog(@TenantId() tenantId: string) {
    return this.automationService.getLog(tenantId);
  }

  @Public()
  @Get('cron/overdue-scan')
  @ApiOperation({ summary: 'Cron: scan all tenants for overdue rentals' })
  async cronOverdueScan(@Req() req: Request) {
    this.assertCronAuthorized(req);
    return this.automationService.scanOverdueRentals();
  }

  @Public()
  @Get('cron/quote-follow-ups')
  @ApiOperation({ summary: 'Cron: send automatic quote follow-up emails' })
  async cronQuoteFollowUps(@Req() req: Request) {
    this.assertCronAuthorized(req);
    return this.automationService.processQuoteFollowUps();
  }

  @Public()
  @Post('sms/inbound')
  @Header('Content-Type', 'text/xml')
  @ApiOperation({ summary: 'Twilio inbound SMS webhook' })
  async smsInbound(@Req() req: Request, @Body() body: Record<string, string>) {
    // Validate Twilio signature (HMAC-SHA1 over URL + sorted param key+value pairs)
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    if (!authToken) {
      throw new InternalServerErrorException('TWILIO_AUTH_TOKEN not configured');
    }
    const signature = (req.headers['x-twilio-signature'] || '') as string;
    if (!signature) {
      throw new UnauthorizedException('Missing Twilio signature');
    }

    // Prefer explicit webhook URL from env (must match the URL configured in Twilio console).
    // Fall back to reconstructing from the request, which may differ behind Vercel's proxy.
    const configuredUrl = this.configService.get<string>('TWILIO_WEBHOOK_URL');
    const webhookUrl = configuredUrl
      || `https://${req.headers.host}${req.originalUrl || req.url || ''}`;

    const params = body || {};
    const sortedData = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + String(params[key] ?? ''), '');

    const computed = crypto
      .createHmac('sha1', authToken)
      .update(webhookUrl + sortedData)
      .digest('base64');

    if (!timingSafeStringEqual(signature, computed)) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    await this.automationService.handleInboundSms(body);
    return '<Response></Response>';
  }
}
