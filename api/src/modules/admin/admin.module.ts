import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SeedController } from './seed.controller';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { DumpLocation, DumpLocationRate, DumpLocationSurcharge } from '../dump-locations/entities/dump-location.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { DeliveryZone } from '../pricing/entities/delivery-zone.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, User, Job, Customer, Asset, Invoice, DumpLocation, DumpLocationRate, DumpLocationSurcharge, DumpTicket, DeliveryZone])],
  controllers: [AdminController, SeedController],
  providers: [AdminService],
})
export class AdminModule {}
