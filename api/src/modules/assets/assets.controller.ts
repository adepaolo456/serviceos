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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import {
  CreateAssetDto,
  UpdateAssetDto,
  ListAssetsQueryDto,
} from './dto/asset.dto';
import { TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';

@ApiTags('Assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

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

  @Get('availability')
  @ApiOperation({ summary: 'Get projected asset availability for a date' })
  getAvailability(
    @TenantId() tenantId: string,
    @Query('subtype') subtype: string,
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
      subtype || '20yd',
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
