import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  check() {
    return {
      status: 'ok',
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      timestamp: new Date().toISOString(),
    };
  }
}
