import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DispatchService } from './dispatch.service';
import {
  DispatchBoardQueryDto,
  CreateRouteDto,
  ReorderDto,
} from './dto/dispatch.dto';
import { TenantId } from '../../common/decorators';

@ApiTags('Dispatch')
@ApiBearerAuth()
@Controller()
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get('dispatch/board')
  @ApiOperation({ summary: 'Get dispatch board for a date' })
  getBoard(
    @TenantId() tenantId: string,
    @Query() query: DispatchBoardQueryDto,
  ) {
    return this.dispatchService.getDispatchBoard(tenantId, query.date);
  }

  @Get('dispatch/unassigned')
  @ApiOperation({ summary: 'Get all unassigned jobs' })
  getUnassigned(@TenantId() tenantId: string) {
    return this.dispatchService.getUnassigned(tenantId);
  }

  @Post('routes')
  @ApiOperation({ summary: 'Create a route for a driver and date' })
  createRoute(@TenantId() tenantId: string, @Body() dto: CreateRouteDto) {
    return this.dispatchService.createRoute(tenantId, dto);
  }

  @Get('routes/:id')
  @ApiOperation({ summary: 'Get a route with ordered jobs' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dispatchService.findOneRoute(tenantId, id);
  }

  @Patch('routes/:id/reorder')
  @ApiOperation({ summary: 'Reorder jobs within a route' })
  reorder(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderDto,
  ) {
    return this.dispatchService.reorderRoute(tenantId, id, dto);
  }

  @Post('dispatch/optimize')
  @ApiOperation({ summary: 'Optimize route order for a driver on a date' })
  optimize(
    @TenantId() tenantId: string,
    @Body() body: { driverId: string; date: string },
  ) {
    return this.dispatchService.optimizeRoute(tenantId, body.driverId, body.date);
  }

  @Post('dispatch/send-routes')
  @ApiOperation({ summary: 'Dispatch routes to drivers' })
  sendRoutes(
    @TenantId() tenantId: string,
    @Body() body: { driverIds: string[]; date: string },
  ) {
    return this.dispatchService.sendRoutes(tenantId, body.driverIds, body.date);
  }
}
