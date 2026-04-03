import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SuperAdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboard();
  }

  @Get('tenants')
  async listTenants(
    @Query('search') search?: string,
    @Query('tier') tier?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listTenants({
      search,
      tier,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('tenants/:id')
  async getTenant(@Param('id') id: string) {
    const tenant = await this.adminService.getTenantDetail(id);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  @Patch('tenants/:id')
  async updateTenant(
    @Param('id') id: string,
    @Body()
    body: {
      subscriptionTier?: string;
      subscriptionStatus?: string;
      isActive?: boolean;
    },
  ) {
    return this.adminService.updateTenant(id, body);
  }

  @Get('subscriptions')
  async getSubscriptions() {
    return this.adminService.getSubscriptions();
  }

  @Post('seed-demo-tenant')
  @HttpCode(HttpStatus.CREATED)
  async seedDemoTenant(
    @Body() body: { name: string; admin_email: string; admin_password: string },
  ) {
    return this.adminService.seedDemoTenant(body);
  }

  @Post('delete-demo-tenant')
  @HttpCode(HttpStatus.OK)
  async deleteDemoTenant(@Body() body: { tenant_id: string }) {
    return this.adminService.deleteDemoTenant(body.tenant_id);
  }
}
