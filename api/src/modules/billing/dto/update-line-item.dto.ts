import { PartialType } from '@nestjs/swagger';
import { CreateLineItemDto } from './create-line-item.dto';

export class UpdateLineItemDto extends PartialType(CreateLineItemDto) {}
