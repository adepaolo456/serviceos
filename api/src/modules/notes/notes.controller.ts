import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { CustomerNote } from './note.entity';

@ApiTags('Notes')
@ApiBearerAuth()
@Controller('customers')
export class NotesController {
  constructor(
    @InjectRepository(CustomerNote)
    private repo: Repository<CustomerNote>,
  ) {}

  @Get(':id/notes')
  async list(@Req() req: Request, @Param('id') customerId: string) {
    const tenantId = (req.user as { tenantId: string }).tenantId;
    return this.repo.find({
      where: { tenant_id: tenantId, customer_id: customerId },
      order: { created_at: 'DESC' },
    });
  }

  @Post(':id/notes')
  async create(
    @Req() req: Request,
    @Param('id') customerId: string,
    @Body() body: { content: string; type?: string },
  ) {
    const user = req.user as { tenantId: string; sub: string; email: string };
    const note = this.repo.create({
      tenant_id: user.tenantId,
      customer_id: customerId,
      content: body.content,
      type: body.type || 'manual',
      author_id: user.sub,
      author_name: user.email,
    });
    return this.repo.save(note);
  }
}
