import { Controller, Post, Body } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { PortalService } from './portal.service';
import { PortalLoginDto, PortalMagicLinkDto, PortalRegisterDto } from './portal.dto';

@Controller('portal/auth')
export class PortalAuthController {
  constructor(private portalService: PortalService) {}

  @Public()
  @Post('login')
  login(@Body() dto: PortalLoginDto) {
    return this.portalService.login(dto.email, dto.password);
  }

  @Public()
  @Post('register')
  register(@Body() dto: PortalRegisterDto) {
    return this.portalService.register(dto.email, dto.password);
  }

  @Public()
  @Post('magic-link')
  magicLink(@Body() dto: PortalMagicLinkDto) {
    return this.portalService.magicLink(dto.email);
  }
}
