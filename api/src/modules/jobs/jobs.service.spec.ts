/**
 * Silent-error-swallow audit — JobsService negative-path tests for:
 *   site #26  changeStatus → failed-trip invoice reversal must propagate
 *   site #27  changeStatus → chain-type-change handler must propagate
 *   site #28  changeStatus → auto-close chain must propagate
 *   site #30  changeStatus → admin-override audit log must propagate
 *
 * Each test uses the same minimal harness and drives changeStatus
 * to the specific site, forcing the downstream call to throw.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { JobsService } from './jobs.service';
import { Job } from './entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { ClientPricingOverride } from '../pricing/entities/client-pricing-override.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Route } from '../dispatch/entities/route.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { BillingIssue } from '../billing/entities/billing-issue.entity';
import { CreditMemo } from '../billing/entities/credit-memo.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { JobPricingAudit } from './entities/job-pricing-audit.entity';
import { BillingService } from '../billing/billing.service';
import { BillingIssueDetectorService } from '../billing/services/billing-issue-detector.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PricingService } from '../pricing/pricing.service';
import { RentalChainsService } from '../rental-chains/rental-chains.service';
import { AlertService } from '../alerts/services/alert.service';
import { DispatchCreditEnforcementService } from '../dispatch/dispatch-credit-enforcement.service';

function makeJob(partial: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    job_type: 'delivery',
    status: 'in_progress',
    asset_id: 'asset-1',
    customer_id: 'cust-1',
    asset: { id: 'asset-1', subtype: '20yd' },
    customer: null,
    job_number: 'J-1',
    service_type: 'dumpster_rental',
    service_address: { lat: 1, lng: 2 },
    is_failed_trip: false,
    ...partial,
  } as any as Job;
}

interface Harness {
  service: JobsService;
  jobsRepository: any;
  notifRepo: any;
  invoiceRepo: any;
  taskChainLinkRepo: any;
  rentalChainRepo: any;
  billingService: any;
  rentalChainsService: any;
  billingIssueDetector: any;
  autoCloseSpy: jest.SpyInstance;
}

async function buildHarness(jobOverrides: Partial<Job> = {}): Promise<Harness> {
  const job = makeJob(jobOverrides);

  const jobsRepository: any = {
    save: jest.fn((x: any) => Promise.resolve(x)),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(job),
      getMany: jest.fn().mockResolvedValue([]),
    })),
    manager: {
      getRepository: () => ({ findOne: jest.fn().mockResolvedValue(null) }),
    },
  };
  const assetRepo: any = { findOne: jest.fn(), update: jest.fn(), find: jest.fn() };
  const notifRepo: any = {
    create: jest.fn((x: any) => x),
    save: jest.fn(),
  };
  const invoiceRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  };
  const taskChainLinkRepo: any = { findOne: jest.fn().mockResolvedValue(null) };
  const rentalChainRepo: any = { findOne: jest.fn() };

  const billingService: any = {
    voidInternalInvoice: jest.fn(),
    createInternalInvoice: jest.fn(),
  };
  const rentalChainsService: any = {
    handleTypeChange: jest.fn(),
  };
  const billingIssueDetector: any = {
    detectAllForInvoice: jest.fn(),
    detectMissingInvoice: jest.fn(),
  };
  const notificationsService: any = { send: jest.fn() };
  const pricingService: any = { calculate: jest.fn() };
  const alertService: any = {};
  const dispatchCreditEnforcement: any = {};

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      JobsService,
      { provide: getRepositoryToken(Job), useValue: jobsRepository },
      { provide: getRepositoryToken(Asset), useValue: assetRepo },
      { provide: getRepositoryToken(PricingRule), useValue: {} },
      { provide: getRepositoryToken(ClientPricingOverride), useValue: {} },
      { provide: getRepositoryToken(Notification), useValue: notifRepo },
      { provide: getRepositoryToken(Customer), useValue: {} },
      { provide: getRepositoryToken(Route), useValue: {} },
      { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
      { provide: getRepositoryToken(BillingIssue), useValue: {} },
      { provide: getRepositoryToken(CreditMemo), useValue: {} },
      { provide: getRepositoryToken(RentalChain), useValue: rentalChainRepo },
      { provide: getRepositoryToken(TaskChainLink), useValue: taskChainLinkRepo },
      { provide: getRepositoryToken(DumpTicket), useValue: {} },
      { provide: getRepositoryToken(JobPricingAudit), useValue: {} },
      { provide: BillingService, useValue: billingService },
      { provide: BillingIssueDetectorService, useValue: billingIssueDetector },
      { provide: RentalChainsService, useValue: rentalChainsService },
      { provide: NotificationsService, useValue: notificationsService },
      { provide: PricingService, useValue: pricingService },
      { provide: AlertService, useValue: alertService },
      { provide: DataSource, useValue: {} },
      { provide: DispatchCreditEnforcementService, useValue: dispatchCreditEnforcement },
    ],
  }).compile();

  const service = module.get(JobsService);

  // Stub autoCloseChainIfTerminal (private method) so tests #26/#27/#30
  // that transition to cancelled-or-similar don't hit its internal DB
  // calls. Individual tests override this when they target #28.
  const autoCloseSpy = jest
    .spyOn(service as any, 'autoCloseChainIfTerminal')
    .mockResolvedValue(undefined);

  return {
    service,
    jobsRepository,
    notifRepo,
    invoiceRepo,
    taskChainLinkRepo,
    rentalChainRepo,
    billingService,
    rentalChainsService,
    billingIssueDetector,
    autoCloseSpy,
  };
}

describe('JobsService — silent-error-swallow fixes in changeStatus', () => {
  // Site #26: failed-trip reversal must propagate.
  it('site #26 (failed-trip reversal): throws when billingService.voidInternalInvoice errors', async () => {
    const h = await buildHarness({
      status: 'in_progress',
      is_failed_trip: true,
    });
    h.invoiceRepo.find.mockResolvedValue([
      {
        id: 'inv-1',
        status: 'open',
        line_items: [{ name: 'Failed trip charge' }],
      },
    ]);
    h.billingService.voidInternalInvoice.mockRejectedValue(
      new Error('void failed'),
    );

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'completed' } as any,
        'admin',
      ),
    ).rejects.toThrow('void failed');
  });

  // Site #27: chain type change must propagate.
  it('site #27 (handleTypeChange): throws when rentalChainsService.handleTypeChange errors', async () => {
    const h = await buildHarness({ status: 'pending' });
    h.rentalChainsService.handleTypeChange.mockRejectedValue(
      new Error('chain sync failed'),
    );

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        {
          status: 'cancelled',
          jobType: 'exchange',
          previousJobType: 'delivery',
        } as any,
        'admin',
      ),
    ).rejects.toThrow('chain sync failed');
  });

  // Site #28: auto-close chain must propagate.
  it('site #28 (autoCloseChainIfTerminal): throws when autoClose helper errors', async () => {
    const h = await buildHarness({ status: 'in_progress' });
    // Override the default spy for this test — let it throw so we
    // verify the changeStatus code no longer swallows the error.
    h.autoCloseSpy.mockRejectedValue(new Error('chain close failed'));

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'cancelled' } as any,
        'admin',
      ),
    ).rejects.toThrow('chain close failed');
  });

  // Site #30: admin override audit log must propagate.
  it('site #30 (admin override audit): throws when notifRepo.save errors', async () => {
    const h = await buildHarness({ status: 'in_progress' });
    h.notifRepo.save.mockRejectedValue(new Error('audit save failed'));

    await expect(
      h.service.changeStatus(
        'tenant-1',
        'job-1',
        { status: 'completed' } as any,
        'admin',
      ),
    ).rejects.toThrow('audit save failed');
  });
});
