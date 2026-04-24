/**
 * Silent-error-swallow audit — QuotesController negative-path test for
 *   site #23  create() — customer-by-email lookup must propagate
 *
 * Previously the catch masked DB errors as "no customer" and silently
 * unlinked the quote. Now a DB failure surfaces as a 500.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { QuotesController } from './quotes.controller';
import { Quote } from './quote.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { SmsService } from '../sms/sms.service';
import { SmsOptOutService } from '../sms/sms-opt-out.service';

describe('QuotesController — silent-error-swallow fixes', () => {
  // Site #23 negative: customerRepo.findOne throws → create() throws.
  it('site #23 (create customer lookup): throws when customerRepo.findOne errors', async () => {
    const customerRepo: any = {
      findOne: jest.fn().mockRejectedValue(new Error('customer lookup DB error')),
    };
    const quoteRepo: any = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ ...x, id: 'q-1' })),
    };
    const tenantRepo: any = {
      findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'T' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuotesController],
      providers: [
        { provide: getRepositoryToken(Quote), useValue: quoteRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: NotificationsService, useValue: { send: jest.fn() } },
        {
          provide: TenantSettingsService,
          useValue: {
            getSettings: jest.fn().mockResolvedValue({
              tenant_id: 'tenant-1',
              quote_expiration_hours: 48,
              quote_templates: {},
            }),
          },
        },
        { provide: SmsService, useValue: { sendSms: jest.fn() } },
        { provide: SmsOptOutService, useValue: {} },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    const controller = module.get(QuotesController);

    await expect(
      controller.create('tenant-1', 'user-1', {
        customerEmail: 'x@y.com',
        assetSubtype: '20yd',
        basePrice: 100,
      }),
    ).rejects.toThrow('customer lookup DB error');
  });
});
