import { Module, Global } from '@nestjs/common';
import { MapboxService } from './mapbox.service';

@Global()
@Module({
  providers: [MapboxService],
  exports: [MapboxService],
})
export class MapboxModule {}
