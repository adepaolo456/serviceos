import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators';
import { COMMIT_SHA } from './build-info';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  check() {
    return {
      status: 'ok',
      commit: COMMIT_SHA,
      timestamp: new Date().toISOString(),
    };
  }
}
