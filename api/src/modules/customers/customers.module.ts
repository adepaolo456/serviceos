import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { MapboxModule } from '../mapbox/mapbox.module';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, Invoice]), MapboxModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
