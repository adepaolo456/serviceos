import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateTermsTemplateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  client_type?: string;

  @IsString()
  template_body: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
