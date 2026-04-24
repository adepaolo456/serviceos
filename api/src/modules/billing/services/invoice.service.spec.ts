/**
 * Phase 1.8 — InvoiceService.sendInvoice test coverage.
 *
 * Rewrite of the previously-broken `sendInvoice` method (Constraint 2
 * violation: stamped sent_at before awaiting Resend). Four tests
 * exercise the locked contract from sign-off:
 *
 *   #1 Success path — resend delivered → transactional stamp, commit fires once
 *   #2 No customer email — throws invoice_send_no_email BEFORE any Resend call
 *   #3 Email provider failure — throws invoice_send_email_failed AND invoice.update NEVER called (Constraint 2 proof)
 *   #4 Role gate — driver role throws invoice_send_requires_admin before any DB touch
 *
 * Harness mirrors the established Phase B pattern (see
 * billing.service.spec.ts:91-94). `transactionCommit` spy wired so we
 * can assert rollback-vs-commit on the Constraint 2 path.
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { InvoiceService } from './invoice.service';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { InvoiceRevision } from '../entities/invoice-revision.entity';
import { Payment } from '../entities/payment.entity';
import { CreditMemo } from '../entities/credit-memo.entity';
import { JobCost } from '../entities/job-cost.entity';
import { Job } from '../../jobs/entities/job.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { TaskChainLink } from '../../rental-chains/entities/task-chain-link.entity';
import { PriceResolutionService } from '../../pricing/services/price-resolution.service';
import { NotificationsService } from '../../notifications/notifications.service';

interface Harness {
  service: InvoiceService;
  invoiceRepo: { findOne: jest.Mock; update: jest.Mock };
  notificationsService: { send: jest.Mock };
  transactionCommit: jest.Mock;
  txInvoiceUpdate: jest.Mock;
  dataSourceQuery: jest.Mock;
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    tenant_id: 'tenant-1',
    invoice_number: 1015,
    total: '250.00',
    due_date: '2026-05-01',
    customer_id: 'cust-1',
    customer: {
      id: 'cust-1',
      first_name: 'Jamie',
      last_name: 'Rivera',
      email: 'jamie@example.com',
    },
    ...overrides,
  };
}

async function buildHarness(
  invoiceOverrides: Record<string, unknown> = {},
): Promise<Harness> {
  const invoice = makeInvoice(invoiceOverrides);

  const invoiceRepo = {
    findOne: jest.fn().mockResolvedValue(invoice),
    update: jest.fn(),
  };
  const revisionRepo = { find: jest.fn().mockResolvedValue([]) };
  const notificationsService = {
    send: jest.fn(),
  };
  const priceResolution = { resolvePrice: jest.fn() };

  const stubRepo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
  });

  const transactionCommit = jest.fn();
  const txInvoiceUpdate = jest.fn();
  const dataSourceQuery = jest.fn().mockResolvedValue([{ count: '0' }]);

  const dataSource: any = {
    query: dataSourceQuery,
    transaction: jest.fn(
      async (cb: (em: EntityManager) => Promise<unknown>) => {
        const trx: any = {
          getRepository: (entity: unknown) => {
            if (entity === Invoice) return { update: txInvoiceUpdate };
            throw new Error(
              `unmocked trx repo in sendInvoice: ${(entity as { name?: string })?.name ?? '?'}`,
            );
          },
        };
        const result = await cb(trx as EntityManager);
        transactionCommit();
        return result;
      },
    ),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      InvoiceService,
      { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
      { provide: getRepositoryToken(InvoiceLineItem), useValue: stubRepo() },
      { provide: getRepositoryToken(InvoiceRevision), useValue: revisionRepo },
      { provide: getRepositoryToken(Payment), useValue: stubRepo() },
      { provide: getRepositoryToken(CreditMemo), useValue: stubRepo() },
      { provide: getRepositoryToken(JobCost), useValue: stubRepo() },
      { provide: getRepositoryToken(Job), useValue: stubRepo() },
      { provide: getRepositoryToken(Customer), useValue: stubRepo() },
      { provide: getRepositoryToken(TaskChainLink), useValue: stubRepo() },
      { provide: PriceResolutionService, useValue: priceResolution },
      { provide: NotificationsService, useValue: notificationsService },
      { provide: DataSource, useValue: dataSource },
    ],
  }).compile();

  return {
    service: module.get(InvoiceService),
    invoiceRepo,
    notificationsService,
    transactionCommit,
    txInvoiceUpdate,
    dataSourceQuery,
  };
}

describe('InvoiceService.sendInvoice — Phase 1.8', () => {
  // ── #1 Success path ────────────────────────────────────────────────────
  it('1. success — awaits Resend, then transactional stamp of sent_at + sent_method; commit fires once', async () => {
    const h = await buildHarness();
    h.notificationsService.send.mockResolvedValue({
      id: 'notif-1',
      status: 'delivered',
      external_id: 'resend-xyz',
    });

    await h.service.sendInvoice(
      'tenant-1',
      'inv-1',
      'email',
      'user-admin',
      'admin',
    );

    // Resend was awaited BEFORE any invoice.update write.
    expect(h.notificationsService.send).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        channel: 'email',
        type: 'invoice_sent',
        recipient: 'jamie@example.com',
      }),
    );
    // Transactional stamp ran and committed.
    expect(h.txInvoiceUpdate).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ sent_method: 'email' }),
    );
    expect(h.txInvoiceUpdate.mock.calls[0][1].sent_at).toBeInstanceOf(Date);
    expect(h.transactionCommit).toHaveBeenCalledTimes(1);
  });

  // ── #2 No customer email ────────────────────────────────────────────────
  it('2. no customer email — throws invoice_send_no_email; Resend NOT called; no transaction', async () => {
    const h = await buildHarness({ customer: { id: 'c', email: null, first_name: 'X', last_name: 'Y' } });

    await expect(
      h.service.sendInvoice('tenant-1', 'inv-1', 'email', 'user-admin', 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.notificationsService.send).not.toHaveBeenCalled();
    expect(h.txInvoiceUpdate).not.toHaveBeenCalled();
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // ── #3 Email provider failure — CRITICAL Constraint 2 proof ─────────────
  it('3. email provider failure — throws AND invoice.update NEVER called (Constraint 2)', async () => {
    const h = await buildHarness();
    // Resend returned failure — NotificationsService.send returns a
    // Notification row with status='failed' (not a throw).
    h.notificationsService.send.mockResolvedValue({
      id: 'notif-1',
      status: 'failed',
      error_message: 'Resend 500',
    });

    await expect(
      h.service.sendInvoice('tenant-1', 'inv-1', 'email', 'user-admin', 'admin'),
    ).rejects.toBeInstanceOf(HttpException);

    // The Notification row exists (NotificationsService owns the audit),
    // but invoice.sent_at MUST stay null — no transactional stamp.
    expect(h.notificationsService.send).toHaveBeenCalledTimes(1);
    expect(h.txInvoiceUpdate).not.toHaveBeenCalled();
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });

  // ── #4 Role gate ────────────────────────────────────────────────────────
  it('4. role gate — driver role throws invoice_send_requires_admin BEFORE any DB touch', async () => {
    const h = await buildHarness();

    await expect(
      h.service.sendInvoice('tenant-1', 'inv-1', 'email', 'user-driver', 'driver'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // No lookup, no Resend, no write.
    expect(h.invoiceRepo.findOne).not.toHaveBeenCalled();
    expect(h.notificationsService.send).not.toHaveBeenCalled();
    expect(h.txInvoiceUpdate).not.toHaveBeenCalled();
    expect(h.transactionCommit).not.toHaveBeenCalled();
  });
});
