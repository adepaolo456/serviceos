import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DemoRequest } from './demo-request.entity';
import { Public } from '../../common/decorators';
import { SuperAdminGuard } from '../admin/admin.guard';

@ApiTags('Demos')
@Controller('demos')
export class DemosController {
  constructor(
    @InjectRepository(DemoRequest)
    private repo: Repository<DemoRequest>,
  ) {}

  @Post()
  @Public()
  async create(
    @Body()
    body: {
      name: string;
      email: string;
      phone?: string;
      companyName: string;
      businessType?: string;
      fleetSize?: string;
      message?: string;
    },
  ) {
    const req = this.repo.create({
      name: body.name,
      email: body.email,
      phone: body.phone,
      company_name: body.companyName,
      business_type: body.businessType,
      fleet_size: body.fleetSize,
      message: body.message,
      status: 'new',
    });
    await this.repo.save(req);
    // TODO: Send notification email to adepaolo456@gmail.com via Resend
    console.log(`[DEMO REQUEST] ${body.name} <${body.email}> - ${body.companyName}`);
    return { success: true, message: 'Demo request submitted' };
  }

  @Get()
  @UseGuards(SuperAdminGuard)
  async list(@Query('status') status?: string) {
    const where: Record<string, string> = {};
    if (status) where.status = status;
    const [data, total] = await this.repo.findAndCount({
      where,
      order: { created_at: 'DESC' },
    });
    return { data, meta: { total } };
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    await this.repo.update(id, { status: body.status });
    return this.repo.findOne({ where: { id } });
  }
}
