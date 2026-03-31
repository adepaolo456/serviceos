import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quote } from './quote.entity';
import { TenantId, CurrentUser, Public } from '../../common/decorators';

@ApiTags('Quotes')
@ApiBearerAuth()
@Controller('quotes')
export class QuotesController {
  constructor(
    @InjectRepository(Quote) private quoteRepo: Repository<Quote>,
  ) {}

  @Post()
  async create(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() body: {
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      deliveryAddress?: Record<string, string>;
      assetSubtype: string;
      basePrice: number;
      includedTons?: number;
      rentalDays?: number;
      overageRate?: number;
      extraDayRate?: number;
    },
  ) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.quoteRepo.count({ where: { tenant_id: tenantId } });
    const quoteNumber = `QT-${dateStr}-${String(count + 1).padStart(3, '0')}`;

    const quote = this.quoteRepo.create({
      tenant_id: tenantId,
      quote_number: quoteNumber,
      customer_name: body.customerName || null,
      customer_email: body.customerEmail || null,
      customer_phone: body.customerPhone || null,
      delivery_address: body.deliveryAddress || null,
      asset_subtype: body.assetSubtype,
      base_price: body.basePrice,
      included_tons: body.includedTons || 0,
      rental_days: body.rentalDays || 14,
      overage_rate: body.overageRate || 0,
      extra_day_rate: body.extraDayRate || 0,
      total_quoted: body.basePrice,
      status: 'sent',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      created_by: userId,
    } as Partial<Quote>);

    return this.quoteRepo.save(quote);
  }

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const qb = this.quoteRepo.createQueryBuilder('q')
      .where('q.tenant_id = :tenantId', { tenantId })
      .orderBy('q.created_at', 'DESC')
      .take(Number(limit) || 50);

    if (status) qb.andWhere('q.status = :status', { status });

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { total } };
  }

  @Post(':id/send-email')
  async sendEmail(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const quote = await this.quoteRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!quote) return { error: 'Quote not found' };

    // Log the email (actual sending comes later with SendGrid/SES)
    await this.quoteRepo.update(id, { status: 'sent' });

    return { success: true, message: `Quote email logged for ${quote.customer_email}`, quoteNumber: quote.quote_number };
  }

  @Public()
  @Get(':id/book')
  async bookFromQuote(@Param('id', ParseUUIDPipe) id: string) {
    const quote = await this.quoteRepo.findOne({ where: { id } });
    if (!quote) return { error: 'Quote not found' };
    if (new Date() > quote.expires_at) return { expired: true, message: 'This quote has expired' };
    return { quote, valid: true };
  }
}
