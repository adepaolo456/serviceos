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
import { AssetsService } from './assets.service';
import {
  CreateAssetDto,
  UpdateAssetDto,
  ListAssetsQueryDto,
} from './dto/asset.dto';
import { TenantId } from '../../common/decorators';

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
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an asset' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.assetsService.remove(tenantId, id);
  }
}
