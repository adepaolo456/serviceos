import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DemosController } from './demos.controller';
import { DemoRequest } from './demo-request.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DemoRequest])],
  controllers: [DemosController],
})
export class DemosModule {}
