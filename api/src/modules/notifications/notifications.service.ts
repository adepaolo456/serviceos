import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import {
  SendNotificationDto,
  ListNotificationsQueryDto,
} from './dto/notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationsRepository: Repository<Notification>,
  ) {}

  async send(
    tenantId: string,
    dto: SendNotificationDto,
  ): Promise<Notification> {
    const notification = this.notificationsRepository.create({
      tenant_id: tenantId,
      channel: dto.channel,
      type: dto.type,
      recipient: dto.recipient,
      subject: dto.subject,
      body: dto.body,
      job_id: dto.jobId,
      customer_id: dto.customerId,
      status: 'queued',
    });
    return this.notificationsRepository.save(notification);
  }

  async findAll(tenantId: string, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.notificationsRepository
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.job', 'job')
      .leftJoinAndSelect('n.customer', 'customer')
      .where('n.tenant_id = :tenantId', { tenantId });

    if (query.channel) {
      qb.andWhere('n.channel = :channel', { channel: query.channel });
    }

    if (query.type) {
      qb.andWhere('n.type = :type', { type: query.type });
    }

    if (query.status) {
      qb.andWhere('n.status = :status', { status: query.status });
    }

    if (query.jobId) {
      qb.andWhere('n.job_id = :jobId', { jobId: query.jobId });
    }

    qb.orderBy('n.created_at', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  getTemplates() {
    return [
      {
        type: 'booking_confirmation',
        channels: ['sms', 'email'],
        variables: [
          '{customerName}',
          '{jobNumber}',
          '{serviceType}',
          '{scheduledDate}',
          '{scheduledWindow}',
          '{serviceAddress}',
        ],
        sms: 'Hi {customerName}, your {serviceType} is confirmed for {scheduledDate} between {scheduledWindow}. Job #{jobNumber}. Reply STOP to opt out.',
        email: {
          subject: 'Booking Confirmed - Job #{jobNumber}',
          body: 'Hi {customerName},\n\nYour {serviceType} has been confirmed.\n\nDate: {scheduledDate}\nTime Window: {scheduledWindow}\nAddress: {serviceAddress}\nJob #: {jobNumber}\n\nThank you for your business!',
        },
      },
      {
        type: 'on_the_way',
        channels: ['sms', 'push'],
        variables: ['{customerName}', '{driverName}', '{eta}', '{jobNumber}'],
        sms: 'Hi {customerName}, {driverName} is on the way! ETA: {eta}. Job #{jobNumber}.',
        push: '{driverName} is en route to your location. ETA: {eta}.',
      },
      {
        type: 'pickup_reminder',
        channels: ['sms', 'email'],
        variables: [
          '{customerName}',
          '{assetType}',
          '{pickupDate}',
          '{jobNumber}',
        ],
        sms: 'Hi {customerName}, reminder: your {assetType} is scheduled for pickup on {pickupDate}. Please ensure clear access. Job #{jobNumber}.',
        email: {
          subject: 'Pickup Reminder - {pickupDate}',
          body: 'Hi {customerName},\n\nThis is a reminder that your {assetType} is scheduled for pickup on {pickupDate}.\n\nPlease ensure the area is accessible for our driver.\n\nJob #: {jobNumber}\n\nQuestions? Reply to this email.',
        },
      },
      {
        type: 'overdue_alert',
        channels: ['sms', 'email'],
        variables: [
          '{customerName}',
          '{invoiceNumber}',
          '{amountDue}',
          '{dueDate}',
        ],
        sms: 'Hi {customerName}, invoice {invoiceNumber} for ${amountDue} was due on {dueDate}. Please remit payment at your earliest convenience.',
        email: {
          subject: 'Overdue Invoice - {invoiceNumber}',
          body: 'Hi {customerName},\n\nThis is a reminder that invoice {invoiceNumber} for ${amountDue} was due on {dueDate}.\n\nPlease remit payment at your earliest convenience to avoid service interruption.\n\nThank you.',
        },
      },
      {
        type: 'invoice_sent',
        channels: ['email'],
        variables: [
          '{customerName}',
          '{invoiceNumber}',
          '{totalAmount}',
          '{dueDate}',
        ],
        email: {
          subject: 'Invoice {invoiceNumber} - ${totalAmount}',
          body: 'Hi {customerName},\n\nPlease find your invoice details below.\n\nInvoice #: {invoiceNumber}\nAmount: ${totalAmount}\nDue Date: {dueDate}\n\nThank you for your business!',
        },
      },
    ];
  }
}
