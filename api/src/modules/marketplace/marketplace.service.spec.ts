/**
 * MarketplaceService.accept() — SSoT refactor coverage.
 *
 * The pre-refactor `accept()` ran four independent writes on the
 * default datasource (customer save → job number issuance → job save
 * → booking save). A throw between any two left partial state behind:
 * an orphan customer; an orphan job pointing at a still-pending
 * booking; a job_number burned for a booking that ultimately rejected.
 *
 * Post-refactor every write happens inside one
 * `dataSource.transaction(...)` block, with job creation delegated to
 * `JobsService.create` carrying the outer manager. These tests defend:
 *
 *   1. Pre-TX validation (404 / 400) fires BEFORE the transaction
 *      callback runs — so the cheap path stays cheap.
 *   2. JobsService.create is called with the outer manager — proving
 *      its writes join the same TX (manager-identity check).
 *   3. Each in-TX throw point (customer create, jobs.create, post-create
 *      project, booking save) leaves the TX uncommitted — rollback
 *      proof relies on the harness's `commitCalled` spy.
 *   4. Pricing fields are projected via post-create UPDATE (not via
 *      CreateJobDto) so JobsService.create's auto-invoice gate
 *      (delivery + total_price>0) does not trip.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import { MarketplaceService } from './marketplace.service';
import { MarketplaceBooking } from './entities/marketplace-booking.entity';
import { MarketplaceIntegration } from './entities/marketplace-integration.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingService } from '../pricing/pricing.service';
import { JobsService } from '../jobs/jobs.service';

interface Harness {
  service: MarketplaceService;
  // Default-datasource bookings repo — used by the pre-TX validation.
  bookingsRepo: { findOne: jest.Mock };
  // TX-bound spies. The dataSource.transaction mock routes
  // manager.getRepository(<entity>) calls to these.
  trxBookingRepo: Record<string, jest.Mock>;
  trxCustomerRepo: Record<string, jest.Mock>;
  trxJobRepo: Record<string, jest.Mock>;
  // JobsService.create spy — the test asserts its 3rd arg is the
  // same manager passed into the dataSource.transaction callback.
  jobsCreate: jest.Mock;
  // Tracks the EntityManager that JobsService.create received, so the
  // manager-identity assertion can compare against the trx instance.
  jobsCreateReceivedManager: { value: EntityManager | undefined };
  trxManager: EntityManager;
  // Fires only when the dataSource.transaction callback resolves
  // successfully — never on rollback. The negative-path tests assert
  // commitCalled was NOT invoked.
  commitCalled: jest.Mock;
}

function makeBookingRow(overrides: Partial<MarketplaceBooking> = {}): MarketplaceBooking {
  return {
    id: 'bk-1',
    tenant_id: 'tenant-1',
    marketplace_booking_id: 'rt-12345',
    listing_type: 'dumpster_rental',
    asset_subtype: '20yd',
    customer_name: 'Jane Doe',
    customer_email: 'jane@example.com',
    customer_phone: '+15555550100',
    service_address: { street: '1 Main', city: 'X', state: 'Y', zip: '00000' },
    requested_date: '2026-05-10',
    rental_days: 7,
    special_instructions: 'leave near garage',
    quoted_price: 250,
    marketplace_fee: 25,
    net_price: 225,
    status: 'pending',
    job_id: null as unknown as string,
    rejection_reason: null as unknown as string,
    processed_at: null as unknown as Date,
    created_at: new Date('2026-05-01T00:00:00Z'),
    updated_at: new Date('2026-05-01T00:00:00Z'),
    ...(overrides as object),
  } as unknown as MarketplaceBooking;
}

async function buildHarness(
  bookingOverrides: Partial<MarketplaceBooking> = {},
): Promise<Harness> {
  const baseBooking = makeBookingRow(bookingOverrides);

  const trxBookingRepo: Record<string, jest.Mock> = {
    // Re-read inside TX returns the same row by default; tests
    // override per-case (e.g., undefined for the concurrent-delete
    // defensive branch).
    findOne: jest.fn().mockResolvedValue({ ...baseBooking }),
    save: jest.fn((x: any) => Promise.resolve(x)),
  };
  const trxCustomerRepo: Record<string, jest.Mock> = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) =>
      Promise.resolve({ ...x, id: 'cust-new-1' }),
    ),
  };
  const trxJobRepo: Record<string, jest.Mock> = {
    update: jest.fn(),
    findOne: jest.fn().mockResolvedValue({
      id: 'job-new-1',
      tenant_id: 'tenant-1',
      job_type: 'delivery',
      status: 'confirmed',
      base_price: 250,
      total_price: 250,
      marketplace_booking_id: 'rt-12345',
    }),
  };

  const trxManager = {
    getRepository: (e: unknown) => {
      if (e === MarketplaceBooking) return trxBookingRepo;
      if (e === Customer) return trxCustomerRepo;
      if (e === Job) return trxJobRepo;
      throw new Error(`unmocked trx repo: ${(e as any)?.name}`);
    },
  } as unknown as EntityManager;

  const commitCalled = jest.fn();

  const dataSource = {
    transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) => {
      const result = await cb(trxManager);
      commitCalled();
      return result;
    }),
  };

  const jobsCreateReceivedManager: { value: EntityManager | undefined } = {
    value: undefined,
  };
  const jobsCreate = jest.fn(
    async (_tenantId: string, _dto: unknown, manager?: EntityManager) => {
      jobsCreateReceivedManager.value = manager;
      return {
        id: 'job-new-1',
        tenant_id: 'tenant-1',
        job_number: 'D-1001',
        job_type: 'delivery',
        status: 'pending',
        customer_id: 'cust-new-1',
      } as unknown as Job;
    },
  );

  // Default-datasource bookingsRepo — used by the pre-TX
  // findOne validation in accept().
  const bookingsRepo = {
    findOne: jest.fn().mockResolvedValue({ ...baseBooking }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MarketplaceService,
      { provide: getRepositoryToken(MarketplaceBooking), useValue: bookingsRepo },
      { provide: getRepositoryToken(MarketplaceIntegration), useValue: {} },
      { provide: getRepositoryToken(Customer), useValue: {} },
      { provide: getRepositoryToken(Job), useValue: {} },
      { provide: getRepositoryToken(Asset), useValue: {} },
      { provide: getRepositoryToken(Tenant), useValue: {} },
      { provide: PricingService, useValue: {} },
      { provide: JobsService, useValue: { create: jobsCreate } },
      { provide: DataSource, useValue: dataSource },
    ],
  }).compile();

  return {
    service: module.get(MarketplaceService),
    bookingsRepo,
    trxBookingRepo,
    trxCustomerRepo,
    trxJobRepo,
    jobsCreate,
    jobsCreateReceivedManager,
    trxManager,
    commitCalled,
  };
}

describe('MarketplaceService.accept()', () => {
  describe('pre-TX validation', () => {
    it('throws NotFoundException without opening a TX when booking is missing', async () => {
      const h = await buildHarness();
      h.bookingsRepo.findOne.mockResolvedValue(null);

      await expect(h.service.accept('tenant-1', 'bk-missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      // No transaction opened — pre-check fails first.
      expect(h.jobsCreate).not.toHaveBeenCalled();
      expect(h.commitCalled).not.toHaveBeenCalled();
      expect(h.trxBookingRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException without opening a TX when booking already accepted', async () => {
      const h = await buildHarness();
      h.bookingsRepo.findOne.mockResolvedValue(
        makeBookingRow({ status: 'accepted' }),
      );

      await expect(h.service.accept('tenant-1', 'bk-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(h.jobsCreate).not.toHaveBeenCalled();
      expect(h.commitCalled).not.toHaveBeenCalled();
    });
  });

  describe('happy path — single committed TX', () => {
    it('creates customer, delegates to JobsService.create with the outer manager, projects fields, saves booking, commits exactly once', async () => {
      const h = await buildHarness();

      const result = await h.service.accept('tenant-1', 'bk-1');

      // Customer was created (no pre-existing match).
      expect(h.trxCustomerRepo.findOne).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1', email: 'jane@example.com' },
      });
      expect(h.trxCustomerRepo.save).toHaveBeenCalledTimes(1);

      // JobsService.create was called once, and the 3rd arg IS the
      // exact manager handed to the transaction callback. This is
      // the manager-identity proof: jobs.create's writes join this TX.
      expect(h.jobsCreate).toHaveBeenCalledTimes(1);
      expect(h.jobsCreateReceivedManager.value).toBe(h.trxManager);

      // CreateJobDto carried the booking-mappable fields, but did NOT
      // carry basePrice / totalPrice / assetSubtype — those are the
      // fields whose presence would trip the auto-invoice gate inside
      // _createInTx. The post-create UPDATE is responsible for prices.
      const dtoArg = h.jobsCreate.mock.calls[0][1] as Record<string, unknown>;
      expect(dtoArg).toMatchObject({
        customerId: 'cust-new-1',
        jobType: 'delivery',
        serviceType: 'dumpster_rental',
        scheduledDate: '2026-05-10',
        rentalDays: 7,
        source: 'marketplace',
      });
      expect(dtoArg.basePrice).toBeUndefined();
      expect(dtoArg.totalPrice).toBeUndefined();
      expect(dtoArg.assetSubtype).toBeUndefined();

      // Post-create projection — fields not on CreateJobDto.
      expect(h.trxJobRepo.update).toHaveBeenCalledWith(
        { id: 'job-new-1', tenant_id: 'tenant-1' },
        {
          marketplace_booking_id: 'rt-12345',
          status: 'confirmed',
          base_price: 250,
          total_price: 250,
        },
      );

      // Booking projection — accepted + job_id linked + processed_at.
      expect(h.trxBookingRepo.save).toHaveBeenCalledTimes(1);
      const savedBooking = h.trxBookingRepo.save.mock.calls[0][0];
      expect(savedBooking.status).toBe('accepted');
      expect(savedBooking.job_id).toBe('job-new-1');
      expect(savedBooking.processed_at).toBeInstanceOf(Date);

      // Single TX, single commit, returned shape.
      expect(h.commitCalled).toHaveBeenCalledTimes(1);
      expect(result.booking.status).toBe('accepted');
      expect(result.customer.id).toBe('cust-new-1');
      expect(result.job?.id).toBe('job-new-1');
    });

    it('reuses the existing customer when (tenant_id, email) match', async () => {
      const h = await buildHarness();
      h.trxCustomerRepo.findOne.mockResolvedValue({
        id: 'cust-existing-1',
        tenant_id: 'tenant-1',
        email: 'jane@example.com',
      });

      const result = await h.service.accept('tenant-1', 'bk-1');

      // No new customer save when the existing row is hit.
      expect(h.trxCustomerRepo.save).not.toHaveBeenCalled();
      expect(result.customer.id).toBe('cust-existing-1');
      // jobs.create still received customerId='cust-existing-1'.
      const dtoArg = h.jobsCreate.mock.calls[0][1] as Record<string, unknown>;
      expect(dtoArg.customerId).toBe('cust-existing-1');
      expect(h.commitCalled).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-throw-point rollback', () => {
    it('does not commit when customer save throws — rollback proof', async () => {
      const h = await buildHarness();
      h.trxCustomerRepo.save.mockRejectedValue(new Error('customer DB offline'));

      await expect(h.service.accept('tenant-1', 'bk-1')).rejects.toThrow(
        'customer DB offline',
      );

      expect(h.commitCalled).not.toHaveBeenCalled();
      expect(h.jobsCreate).not.toHaveBeenCalled();
      expect(h.trxBookingRepo.save).not.toHaveBeenCalled();
    });

    it('does not commit when JobsService.create throws — rollback proof, no orphan customer', async () => {
      const h = await buildHarness();
      h.jobsCreate.mockRejectedValue(new Error('asset reservation conflict'));

      await expect(h.service.accept('tenant-1', 'bk-1')).rejects.toThrow(
        'asset reservation conflict',
      );

      // Customer save WAS attempted (and the in-memory mock resolved),
      // but the TX never committed — so on a real DB the customer
      // INSERT would roll back. The booking write never happened.
      expect(h.trxCustomerRepo.save).toHaveBeenCalledTimes(1);
      expect(h.commitCalled).not.toHaveBeenCalled();
      expect(h.trxJobRepo.update).not.toHaveBeenCalled();
      expect(h.trxBookingRepo.save).not.toHaveBeenCalled();
    });

    it('does not commit when post-create job UPDATE throws — rollback proof', async () => {
      const h = await buildHarness();
      h.trxJobRepo.update.mockRejectedValue(new Error('job update failed'));

      await expect(h.service.accept('tenant-1', 'bk-1')).rejects.toThrow(
        'job update failed',
      );

      expect(h.jobsCreate).toHaveBeenCalledTimes(1);
      expect(h.commitCalled).not.toHaveBeenCalled();
      expect(h.trxBookingRepo.save).not.toHaveBeenCalled();
    });

    it('does not commit when booking save throws — rollback proof', async () => {
      const h = await buildHarness();
      h.trxBookingRepo.save.mockRejectedValue(new Error('booking save failed'));

      await expect(h.service.accept('tenant-1', 'bk-1')).rejects.toThrow(
        'booking save failed',
      );

      // Every preceding write was attempted but the TX did not commit.
      expect(h.trxCustomerRepo.save).toHaveBeenCalledTimes(1);
      expect(h.jobsCreate).toHaveBeenCalledTimes(1);
      expect(h.trxJobRepo.update).toHaveBeenCalledTimes(1);
      expect(h.commitCalled).not.toHaveBeenCalled();
    });
  });

  describe('defensive in-TX re-read', () => {
    it('throws NotFoundException if the booking disappeared between pre-TX check and TX open', async () => {
      const h = await buildHarness();
      // Pre-TX read finds the row…
      h.bookingsRepo.findOne.mockResolvedValue(makeBookingRow());
      // …but the manager-bound re-read inside the TX returns null
      // (concurrent delete window).
      h.trxBookingRepo.findOne.mockResolvedValue(null);

      await expect(h.service.accept('tenant-1', 'bk-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.jobsCreate).not.toHaveBeenCalled();
      expect(h.commitCalled).not.toHaveBeenCalled();
    });
  });

  // Concurrency arc — Surface 3. The unique constraint
  // idx_customers_tenant_email_unique on customers (tenant_id, lower(email))
  // protects data integrity at the DB layer; these tests cover the
  // app-side error envelope that recovers the existing customer instead
  // of surfacing a 500 to the race-loser.
  describe('concurrency — Surface 3 customer dedup race', () => {
    it('catches unique-violation on customer save, retries findOne, returns existing customer, accept() succeeds', async () => {
      const h = await buildHarness();

      // Race scenario: initial findOne returns null (parallel TX has not
      // yet committed); customer save throws unique violation (parallel
      // TX committed in between); retry findOne returns the parallel
      // TX's committed customer.
      const existingCustomer = {
        id: 'cust-parallel-1',
        tenant_id: 'tenant-1',
        email: 'jane@example.com',
      };
      h.trxCustomerRepo.findOne
        .mockResolvedValueOnce(null) // initial find (no row yet)
        .mockResolvedValueOnce(existingCustomer); // retry find (parallel TX committed)

      // Build a unique-violation matching the Postgres SQLSTATE 23505
      // shape that TypeORM's QueryFailedError carries.
      const uniqueViolation = new QueryFailedError(
        'INSERT INTO customers ...',
        [],
        new Error(
          'duplicate key value violates unique constraint "idx_customers_tenant_email_unique"',
        ),
      );
      (uniqueViolation as QueryFailedError & { code: string }).code = '23505';
      h.trxCustomerRepo.save.mockRejectedValueOnce(uniqueViolation);

      const result = await h.service.accept('tenant-1', 'bk-1');

      // findOne was called twice — initial + retry-after-violation.
      expect(h.trxCustomerRepo.findOne).toHaveBeenCalledTimes(2);
      // save attempted once and threw; not retried.
      expect(h.trxCustomerRepo.save).toHaveBeenCalledTimes(1);
      // jobsService.create proceeded with the existing customer's id —
      // proves the recovery path threads the right id forward.
      expect(h.jobsCreate).toHaveBeenCalledTimes(1);
      const dtoArg = h.jobsCreate.mock.calls[0][1] as Record<string, unknown>;
      expect(dtoArg.customerId).toBe('cust-parallel-1');
      // The TX still committed exactly once — recovery joined the same
      // outer transaction.
      expect(h.commitCalled).toHaveBeenCalledTimes(1);
      expect(result.customer.id).toBe('cust-parallel-1');
    });

    it('rethrows the original QueryFailedError if retry findOne returns null (defensive)', async () => {
      const h = await buildHarness();

      // Pathological invariant violation: unique constraint fires but
      // retry sees null. Should never happen; if it does, the original
      // error must surface (not be swallowed as a synthesized null).
      h.trxCustomerRepo.findOne
        .mockResolvedValueOnce(null) // initial
        .mockResolvedValueOnce(null); // retry — invariant violated

      const uniqueViolation = new QueryFailedError(
        'INSERT INTO customers ...',
        [],
        new Error('duplicate key value violates unique constraint'),
      );
      (uniqueViolation as QueryFailedError & { code: string }).code = '23505';
      h.trxCustomerRepo.save.mockRejectedValueOnce(uniqueViolation);

      await expect(h.service.accept('tenant-1', 'bk-1')).rejects.toBe(
        uniqueViolation,
      );
      expect(h.commitCalled).not.toHaveBeenCalled();
    });

    it('rethrows non-23505 QueryFailedError unchanged (does not catch broader)', async () => {
      const h = await buildHarness();
      h.trxCustomerRepo.findOne.mockResolvedValueOnce(null);

      // FK violation (23503) is a different constraint class; the catch
      // must not swallow it.
      const fkViolation = new QueryFailedError(
        'INSERT INTO customers ...',
        [],
        new Error('insert or update on table "customers" violates foreign key constraint'),
      );
      (fkViolation as QueryFailedError & { code: string }).code = '23503';
      h.trxCustomerRepo.save.mockRejectedValueOnce(fkViolation);

      await expect(h.service.accept('tenant-1', 'bk-1')).rejects.toBe(fkViolation);
      // No retry findOne attempted (only the initial one).
      expect(h.trxCustomerRepo.findOne).toHaveBeenCalledTimes(1);
      expect(h.commitCalled).not.toHaveBeenCalled();
    });
  });
});
