import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { Yard } from './yard.entity';

@ApiTags('Yards')
@ApiBearerAuth()
@Controller('yards')
export class YardsController {
  constructor(
    @InjectRepository(Yard)
    private repo: Repository<Yard>,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    return this.repo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { is_primary: 'DESC', created_at: 'ASC' },
    });
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: {
      name: string;
      address?: Record<string, string>;
      lat?: number;
      lng?: number;
      isPrimary?: boolean;
    },
  ) {
    const tenantId = (req.user as { tenantId: string }).tenantId;

    // If setting as primary, unset existing primary
    if (body.isPrimary) {
      await this.repo.update(
        { tenant_id: tenantId, is_primary: true },
        { is_primary: false },
      );
    }

    // If this is the first yard, make it primary
    const count = await this.repo.count({
      where: { tenant_id: tenantId, is_active: true },
    });

    const yard = this.repo.create({
      tenant_id: tenantId,
      name: body.name,
      address: body.address,
      lat: body.lat,
      lng: body.lng,
      is_primary: body.isPrimary || count === 0,
    });
    return this.repo.save(yard);
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      address?: Record<string, string>;
      lat?: number;
      lng?: number;
    },
  ) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    await this.repo.update(
      { id, tenant_id: tenantId },
      {
        ...(body.name && { name: body.name }),
        ...(body.address && { address: body.address }),
        ...(body.lat !== undefined && { lat: body.lat }),
        ...(body.lng !== undefined && { lng: body.lng }),
      },
    );
    return this.repo.findOne({ where: { id, tenant_id: tenantId } });
  }

  @Patch(':id/primary')
  async setPrimary(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    await this.repo.update(
      { tenant_id: tenantId, is_primary: true },
      { is_primary: false },
    );
    await this.repo.update(
      { id, tenant_id: tenantId },
      { is_primary: true },
    );
    return this.repo.findOne({ where: { id, tenant_id: tenantId } });
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    await this.repo.update(
      { id, tenant_id: tenantId },
      { is_active: false },
    );
    return { success: true };
  }
}
