import { Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { DumpLocationsService } from './dump-locations.service';
import { TenantId, CurrentUser } from '../../common/decorators';

@ApiTags('Dump Locations')
@ApiBearerAuth()
@Controller()
export class DumpLocationsController {
  constructor(private readonly service: DumpLocationsService) {}

  // Dump Locations CRUD
  @Get('dump-locations')
  findAll(@TenantId() tid: string) { return this.service.findAll(tid); }

  @Get('dump-locations/recommend')
  recommend(@TenantId() tid: string, @Query('lat') lat: string, @Query('lng') lng: string) { return this.service.recommend(tid, Number(lat), Number(lng)); }

  @Get('dump-locations/:id')
  findOne(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.findOne(tid, id); }

  @Post('dump-locations')
  create(@TenantId() tid: string, @Body() body: Record<string, unknown>) { return this.service.create(tid, body); }

  @Patch('dump-locations/:id')
  update(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) { return this.service.update(tid, id, body); }

  @Delete('dump-locations/:id')
  remove(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.remove(tid, id); }

  // Rates
  @Get('dump-locations/:id/rates')
  getRates(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.getRates(tid, id); }

  @Post('dump-locations/:id/rates')
  addRate(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) { return this.service.addRate(tid, id, body); }

  @Patch('dump-locations/:id/rates/:rateId')
  updateRate(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string, @Param('rateId', ParseUUIDPipe) rateId: string, @Body() body: Record<string, unknown>) { return this.service.updateRate(rateId, body); }

  @Delete('dump-locations/:id/rates/:rateId')
  removeRate(@TenantId() tid: string, @Param('rateId', ParseUUIDPipe) rateId: string) { return this.service.removeRate(rateId); }

  // Surcharges
  @Get('dump-locations/:id/surcharges')
  getSurcharges(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.getSurcharges(tid, id); }

  @Post('dump-locations/:id/surcharges')
  addSurcharge(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) { return this.service.addSurcharge(tid, id, body); }

  @Patch('dump-locations/:id/surcharges/:surchargeId')
  updateSurcharge(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string, @Param('surchargeId', ParseUUIDPipe) sid: string, @Body() body: Record<string, unknown>) { return this.service.updateSurcharge(sid, body); }

  @Delete('dump-locations/:id/surcharges/:surchargeId')
  removeSurcharge(@TenantId() tid: string, @Param('surchargeId', ParseUUIDPipe) sid: string) { return this.service.removeSurcharge(sid); }

  // Dump Slips (on jobs)
  @Post('jobs/:id/dump-slip')
  submitDumpSlip(@TenantId() tid: string, @CurrentUser('id') uid: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) { return this.service.submitDumpSlip(tid, id, body, uid); }

  @Get('jobs/:id/dump-slip')
  getDumpSlip(@TenantId() tid: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.getDumpSlip(tid, id); }

  @Post('jobs/:id/dump-slip/review')
  @ApiOperation({ summary: 'Review/finalize dump slip' })
  reviewDumpSlip(@TenantId() tid: string, @CurrentUser('id') uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.reviewDumpSlip(tid, id, uid); }

  @Patch('dump-tickets/:ticketId')
  @ApiOperation({ summary: 'Edit dump ticket with audit trail and financial recalculation' })
  updateDumpTicket(
    @TenantId() tid: string,
    @CurrentUser('id') uid: string,
    @CurrentUser('role') role: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: Record<string, unknown>,
  ) { return this.service.updateDumpTicket(tid, ticketId, body, uid, role); }

  @Post('dump-tickets/:ticketId/void')
  @ApiOperation({ summary: 'Void a dump ticket and remove billing impact' })
  voidDumpTicket(
    @TenantId() tid: string,
    @CurrentUser('id') uid: string,
    @CurrentUser('role') role: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: { reason: string },
  ) { return this.service.voidDumpTicket(tid, ticketId, body.reason || 'Voided by admin', uid, role); }
}
