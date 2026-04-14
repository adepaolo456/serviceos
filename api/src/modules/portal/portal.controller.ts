import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { PortalAuthGuard } from './portal.guard';
import { PortalService } from './portal.service';
import { ServiceRequestDto, ChangePickupDateDto, UpdatePortalProfileDto, SignAgreementDto, ChangePasswordDto } from './portal.dto';
import type { Request } from 'express';

interface PortalUser {
  customerId: string;
  tenantId: string;
}

@Controller('portal')
@UseGuards(PortalAuthGuard)
export class PortalController {
  constructor(private portalService: PortalService) {}

  @Get('rentals')
  getRentals(@Req() req: Request) {
    const user = req.user as PortalUser;
    return this.portalService.getRentals(user.customerId, user.tenantId);
  }

  @Get('invoices')
  getInvoices(@Req() req: Request) {
    const user = req.user as PortalUser;
    return this.portalService.getInvoices(user.customerId, user.tenantId);
  }

  @Get('invoices/:id')
  getInvoiceDetail(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as PortalUser;
    return this.portalService.getInvoiceDetail(user.customerId, user.tenantId, id);
  }

  @Post('request')
  submitRequest(@Req() req: Request, @Body() dto: ServiceRequestDto) {
    const user = req.user as PortalUser;
    return this.portalService.submitServiceRequest(user.customerId, user.tenantId, dto);
  }

  // Canonical route — "Change Pickup Date" is the user-facing
  // framing; the underlying behavior is identical to the legacy
  // /extend route, which is preserved below as a backward-compat
  // alias for older portal clients still in the wild.
  @Post('rentals/:id/change-pickup-date')
  changePickupDate(@Req() req: Request, @Param('id') id: string, @Body() dto: ChangePickupDateDto) {
    const user = req.user as PortalUser;
    return this.portalService.changePickupDate(user.customerId, user.tenantId, id, dto.newEndDate);
  }

  // Backward-compatible alias. Do not remove without a portal
  // client audit — older bundles still POST to /extend.
  @Post('rentals/:id/extend')
  extendRentalLegacyAlias(@Req() req: Request, @Param('id') id: string, @Body() dto: ChangePickupDateDto) {
    const user = req.user as PortalUser;
    return this.portalService.changePickupDate(user.customerId, user.tenantId, id, dto.newEndDate);
  }

  @Post('rentals/:id/early-pickup')
  earlyPickup(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as PortalUser;
    return this.portalService.requestEarlyPickup(user.customerId, user.tenantId, id);
  }

  @Get('profile')
  getProfile(@Req() req: Request) {
    const user = req.user as PortalUser;
    return this.portalService.getProfile(user.customerId, user.tenantId);
  }

  @Patch('profile')
  updateProfile(@Req() req: Request, @Body() dto: UpdatePortalProfileDto) {
    const user = req.user as PortalUser;
    return this.portalService.updateProfile(user.customerId, user.tenantId, dto);
  }

  @Post('profile/change-password')
  changePassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    const user = req.user as PortalUser;
    return this.portalService.changePassword(user.customerId, user.tenantId, dto.currentPassword, dto.newPassword);
  }

  @Post('agreements/:jobId/sign')
  signAgreement(@Req() req: Request, @Param('jobId') jobId: string, @Body() dto: SignAgreementDto) {
    const user = req.user as PortalUser;
    return this.portalService.signAgreement(user.customerId, user.tenantId, jobId, dto.signatureUrl);
  }

  @Patch('rentals/:id/reschedule')
  async rescheduleRental(@Req() req: Request, @Param('id') id: string, @Body() body: { scheduledDate: string; reason?: string }) {
    const user = req.user as PortalUser;
    return this.portalService.rescheduleRental(user.customerId, user.tenantId, id, body);
  }

  @Get('dashboard')
  getDashboard(@Req() req: Request) {
    const user = req.user as PortalUser;
    return this.portalService.getDashboard(user.customerId, user.tenantId);
  }

  @Get('account-summary')
  getAccountSummary(@Req() req: Request) {
    const user = req.user as PortalUser;
    return this.portalService.getAccountSummary(user.customerId, user.tenantId);
  }

  @Get('pricing/estimate')
  getPricingEstimate(@Req() req: Request, @Query() query: { size: string; lat?: string; lng?: string; days?: string }) {
    const user = req.user as PortalUser;
    return this.portalService.getPricingEstimate(user.tenantId, user.customerId, {
      size: query.size,
      lat: query.lat ? parseFloat(query.lat) : undefined,
      lng: query.lng ? parseFloat(query.lng) : undefined,
      rentalDays: query.days ? parseInt(query.days) : undefined,
    });
  }

  @Post('report-issue')
  reportIssue(@Req() req: Request, @Body() body: { jobId?: string; reason: string; notes?: string }) {
    const user = req.user as PortalUser;
    return this.portalService.reportIssue(user.customerId, user.tenantId, body);
  }

  @Patch('jobs/:id/placement')
  updatePlacement(@Req() req: Request, @Param('id') id: string, @Body() body: {
    placement_lat?: number | null;
    placement_lng?: number | null;
    placement_pin_notes?: string | null;
  }) {
    const user = req.user as PortalUser;
    return this.portalService.updatePlacement(user.customerId, user.tenantId, id, body);
  }

  @Get('jobs/:id/placement')
  getPlacement(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as PortalUser;
    return this.portalService.getPlacement(user.customerId, user.tenantId, id);
  }

  @Post('payments/prepare')
  preparePayment(@Req() req: Request, @Body() body: { invoiceId: string; amount?: number }) {
    const user = req.user as PortalUser;
    return this.portalService.createPaymentIntent(user.customerId, user.tenantId, body.invoiceId, body.amount);
  }
}
