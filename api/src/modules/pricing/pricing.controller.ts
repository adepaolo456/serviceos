import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingService } from './pricing.service';
import {
  CreatePricingRuleDto,
  UpdatePricingRuleDto,
  ListPricingRulesQueryDto,
  CalculatePriceDto,
} from './dto/pricing.dto';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantId } from '../../common/decorators';
import { haversineDistance } from './pricing.utils';

@ApiTags('Pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    @InjectRepository(DeliveryZone) private zoneRepo: Repository<DeliveryZone>,
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a pricing rule' })
  create(@TenantId() tenantId: string, @Body() dto: CreatePricingRuleDto) {
    return this.pricingService.create(tenantId, dto);
  }

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate price for a job' })
  calculate(@TenantId() tenantId: string, @Body() dto: CalculatePriceDto) {
    return this.pricingService.calculate(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List pricing rules' })
  findAll(
    @TenantId() tenantId: string,
    @Query() query: ListPricingRulesQueryDto,
  ) {
    return this.pricingService.findAll(tenantId, query);
  }

  // ── Static routes MUST come before :id parameterized routes ──

  @Get('pricing-templates')
  @ApiOperation({ summary: 'List pricing templates' })
  listTemplates(@TenantId() tenantId: string) {
    return this.pricingService.listTemplates(tenantId);
  }

  @Post('pricing-templates')
  @ApiOperation({ summary: 'Create pricing template' })
  createTemplate(@TenantId() tenantId: string, @Body() body: Record<string, unknown>) {
    return this.pricingService.createTemplate(tenantId, body);
  }

  @Patch('pricing-templates/:id')
  @ApiOperation({ summary: 'Update pricing template' })
  updateTemplate(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.pricingService.updateTemplate(tenantId, id, body);
  }

  @Delete('pricing-templates/:id')
  @ApiOperation({ summary: 'Delete pricing template' })
  deleteTemplate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.pricingService.deleteTemplate(tenantId, id);
  }

  // ── Delivery Zones ──

  @Get('delivery-zones')
  @ApiOperation({ summary: 'List delivery zones' })
  async listZones(@TenantId() tenantId: string) {
    return this.zoneRepo.find({ where: { tenant_id: tenantId }, order: { sort_order: 'ASC' } });
  }

  @Post('delivery-zones')
  @ApiOperation({ summary: 'Create delivery zone' })
  async createZone(@TenantId() tenantId: string, @Body() body: { zoneName: string; minMiles: number; maxMiles: number; surcharge: number; sortOrder?: number }) {
    return this.zoneRepo.save(this.zoneRepo.create({
      tenant_id: tenantId, zone_name: body.zoneName,
      min_miles: body.minMiles, max_miles: body.maxMiles,
      surcharge: body.surcharge, sort_order: body.sortOrder || 0,
    }));
  }

  @Patch('delivery-zones/:id')
  @ApiOperation({ summary: 'Update delivery zone' })
  async updateZone(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const updates: Record<string, unknown> = {};
    if (body.zoneName !== undefined) updates.zone_name = body.zoneName;
    if (body.minMiles !== undefined) updates.min_miles = body.minMiles;
    if (body.maxMiles !== undefined) updates.max_miles = body.maxMiles;
    if (body.surcharge !== undefined) updates.surcharge = body.surcharge;
    if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;
    if (body.isActive !== undefined) updates.is_active = body.isActive;
    await this.zoneRepo.update({ id, tenant_id: tenantId }, updates);
    return this.zoneRepo.findOne({ where: { id, tenant_id: tenantId } });
  }

  @Delete('delivery-zones/:id')
  @ApiOperation({ summary: 'Delete delivery zone' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteZone(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.zoneRepo.delete({ id, tenant_id: tenantId });
  }

  @Get('calculate-distance')
  @ApiOperation({ summary: 'Calculate distance and delivery zone' })
  async calculateDistance(
    @TenantId() tenantId: string,
    @Query('destLat') destLat: string,
    @Query('destLng') destLng: string,
  ) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant?.yard_latitude || !tenant?.yard_longitude) {
      return { error: 'Yard location not configured', distanceMiles: null, zone: null, outsideServiceArea: false };
    }

    const dist = haversineDistance(
      Number(tenant.yard_latitude), Number(tenant.yard_longitude),
      Number(destLat), Number(destLng),
    );
    const distRounded = Math.round(dist * 10) / 10;

    // Distance-band model: first 15 miles free, then $25 per 5-mile band (ceiling)
    const distanceBand = this.pricingService.calculateDistanceCharge(
      Number(tenant.yard_latitude), Number(tenant.yard_longitude),
      Number(destLat), Number(destLng),
    );

    // Legacy — no longer used for pricing. Distance-band model in PricingService replaces this.
    const zones = await this.zoneRepo.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC' } });
    const matchedZone = zones.find(z => distRounded >= Number(z.min_miles) && distRounded < Number(z.max_miles));
    const maxZone = zones.length > 0 ? Math.max(...zones.map(z => Number(z.max_miles))) : 0;

    return {
      distanceMiles: distRounded,
      distanceCharge: distanceBand.distanceCharge,
      bands: distanceBand.bands,
      extraMiles: distanceBand.extraMiles,
      freeRadius: 15,
      zone: matchedZone ? { id: matchedZone.id, name: matchedZone.zone_name, surcharge: Number(matchedZone.surcharge) } : null,
      outsideServiceArea: maxZone > 0 && distRounded >= maxZone,
    };
  }

  // ── Parameterized :id routes MUST come LAST ──

  @Get(':id')
  @ApiOperation({ summary: 'Get a pricing rule by ID' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pricingService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a pricing rule' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePricingRuleDto,
  ) {
    return this.pricingService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a pricing rule (soft)' })
  async remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.pricingService.remove(tenantId, id);
    return { message: 'Pricing rule deleted' };
  }
}
