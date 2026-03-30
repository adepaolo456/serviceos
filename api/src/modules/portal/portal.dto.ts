import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsIn, IsNumber, IsDateString } from 'class-validator';

export class PortalLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class PortalMagicLinkDto {
  @IsEmail()
  email!: string;
}

export class PortalRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class ServiceRequestDto {
  @IsString()
  @IsOptional()
  serviceType?: string;

  @IsString()
  @IsIn(['10yd', '15yd', '20yd', '30yd', '40yd'])
  size!: string;

  @IsOptional()
  serviceAddress?: Record<string, any>;

  @IsDateString()
  preferredDate!: string;

  @IsNumber()
  @IsOptional()
  rentalDays?: number;

  @IsString()
  @IsOptional()
  instructions?: string;
}

export class ExtendRentalDto {
  @IsDateString()
  newEndDate!: string;
}

export class UpdatePortalProfileDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsOptional()
  billingAddress?: Record<string, any>;

  @IsOptional()
  serviceAddresses?: Record<string, any>[];
}

export class SignAgreementDto {
  @IsString()
  @IsNotEmpty()
  signatureUrl!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
