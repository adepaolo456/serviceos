import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YardsController } from './yards.controller';
import { Yard } from './yard.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Yard])],
  controllers: [YardsController],
  exports: [TypeOrmModule],
})
export class YardsModule {}
