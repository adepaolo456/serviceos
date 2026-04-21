import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RateLimitLog } from './entities/rate-limit-log.entity';

/**
 * CommonModule houses infrastructure entities and providers that don't belong
 * to any specific domain module. Currently registers RateLimitLog, which is
 * consumed via raw SQL by common/rate-limiter.ts and needs a forFeature() home
 * so it's picked up by autoLoadEntities at bootstrap.
 *
 * @Global so any module can @InjectRepository(RateLimitLog) without importing
 * CommonModule explicitly (matches the access pattern of shared infra).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RateLimitLog])],
  exports: [TypeOrmModule],
})
export class CommonModule {}
