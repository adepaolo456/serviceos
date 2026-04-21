import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class TestNotificationDto {
  @ApiPropertyOptional({ example: 'ops@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+15085551234' })
  @IsOptional()
  @IsString()
  phone?: string;
}
