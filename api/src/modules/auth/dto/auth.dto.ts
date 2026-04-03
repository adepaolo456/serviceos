import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  IsIn,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Acme Dumpsters' })
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @ApiProperty({ example: 'dumpster_rental' })
  @IsString()
  @IsNotEmpty()
  businessType: string;

  @ApiProperty({ example: 'owner@acme.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ example: '555-123-4567' })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'owner@acme.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({ description: 'Tenant ID — required if user belongs to multiple tenants' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class LookupTenantsDto {
  @ApiProperty({ example: 'owner@acme.com' })
  @IsEmail()
  email: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class InviteUserDto {
  @ApiProperty({ example: 'driver@acme.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ enum: ['admin', 'dispatcher', 'driver', 'viewer'] })
  @IsString()
  @IsIn(['admin', 'dispatcher', 'driver', 'viewer'])
  role: string;

  @ApiPropertyOptional({ example: '555-987-6543' })
  @IsOptional()
  @IsString()
  phone?: string;
}
