import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  HttpException,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import {
  CreateAssetDto,
  UpdateAssetDto,
  ListAssetsQueryDto,
  NextAssetNumberQueryDto,
} from './dto/asset.dto';
import { TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { checkRateLimit } from '../../common/rate-limiter';

@ApiTags('Assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly dataSource: DataSource,
  ) {}

  // IP-keyed rate limit — matches the pattern in portal-auth.controller.ts.
  // 60/min is generous enough for UI-triggered suggestion fetches on
  // subtype change but still bounds misuse. Shared NAT'd office IPs could
  // hit this ceiling with many concurrent dispatchers; revisit to key by
  // user_id if that materializes.
  private async enforceRateLimit(
    req: Request,
    endpoint: string,
    max: number,
    windowMinutes: number,
  ): Promise<void> {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';
    const result = await checkRateLimit(
      this.dataSource,
      ip,
      endpoint,
      max,
      windowMinutes,
    );
    if (!result.allowed) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Too many requests. Try again later.',
          retryAfter: result.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new asset' })
  create(@TenantId() tenantId: string, @Body() dto: CreateAssetDto) {
    return this.assetsService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List assets with filters and pagination' })
  findAll(@TenantId() tenantId: string, @Query() query: ListAssetsQueryDto) {
    return this.assetsService.findAll(tenantId, query);
  }

  @Get('next-number')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'dispatcher')
  @ApiOperation({
    summary:
      'Suggest the next standard-format asset identifier for a given asset_type + subtype',
  })
  async getNextNumber(
    @TenantId() tenantId: string,
    @Query() query: NextAssetNumberQueryDto,
    @Req() req: Request,
  ): Promise<{ suggested: string }> {
    await this.enforceRateLimit(req, '/assets/next-number', 60, 1);
    const suggested = await this.assetsService.getNextAssetNumber(
      tenantId,
      query.assetType,
      query.subtype,
    );
    return { suggested };
  }

  @Get('availability')
  @ApiOperation({
    summary:
      'Get projected asset availability — single subtype (object) or all subtypes (array when omitted)',
  })
  getAvailability(
    @TenantId() tenantId: string,
    // When omitted, the service returns an array covering every
    // distinct asset subtype for the tenant. When provided, the
    // service returns the original single-object response shape
    // for that subtype. No silent default — the old `|| '20yd'`
    // fallback was removed because it masked the multi-subtype
    // path and gave the wrong answer for tenants without a 20yd
    // subtype.
    @Query('subtype') subtype?: string,
    @Query('date') date?: string,
    // Phase B — when `true`, exclude pending jobs from both outgoing
    // and incoming sets. Default `false` keeps the existing optimistic
    // behavior for backward compatibility. String comparison because
    // query params arrive as strings; any value other than the literal
    // `"true"` is treated as false so we don't silently flip when a
    // client sends `?confirmedOnly=0` or similar.
    @Query('confirmedOnly') confirmedOnly?: string,
  ) {
    return this.assetsService.getAvailability(
      tenantId,
      subtype,
      date,
      { confirmedOnly: confirmedOnly === 'true' },
    );
  }

  @Get('awaiting-dump')
  @ApiOperation({ summary: 'Get assets awaiting dump, grouped by yard' })
  async getAwaitingDump(@TenantId() tenantId: string) {
    const assets = await this.assetsService.getAwaitingDump(tenantId);
    return { data: assets };
  }

  @Get('available/:type')
  @ApiOperation({ summary: 'Get available assets by type' })
  findAvailable(@TenantId() tenantId: string, @Param('type') type: string) {
    return this.assetsService.findAvailable(tenantId, type);
  }

  @Get('utilization')
  @ApiOperation({ summary: 'Get asset utilization stats grouped by status' })
  getUtilization(@TenantId() tenantId: string) {
    return this.assetsService.getUtilizationStats(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an asset by ID' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assetsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an asset' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assetsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an asset' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.assetsService.remove(tenantId, id);
  }
}
