import { PartialType } from '@nestjs/swagger';
import { CreateTermsTemplateDto } from './create-terms-template.dto';

export class UpdateTermsTemplateDto extends PartialType(CreateTermsTemplateDto) {}
