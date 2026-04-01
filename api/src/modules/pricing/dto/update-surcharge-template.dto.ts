import { PartialType } from '@nestjs/swagger';
import { CreateSurchargeTemplateDto } from './create-surcharge-template.dto';

export class UpdateSurchargeTemplateDto extends PartialType(CreateSurchargeTemplateDto) {}
