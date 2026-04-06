import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quote } from './quote.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { QuotesController } from './quotes.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Quote, Tenant]),
    NotificationsModule,
  ],
  controllers: [QuotesController],
})
export class QuotesModule {}
