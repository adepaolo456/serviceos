/**
 * Dispatch board visibility (Phase B8 — payment gate removed).
 *
 * Prior to Phase B8 the dispatch board hid jobs whose linked invoice was
 * not in `('paid', 'partial')`. That gate has been deleted in
 * `api/src/modules/dispatch/dispatch.service.ts` (see Phase B8 comment on
 * `getDispatchBoard` / `getUnassigned`). Credit enforcement now happens
 * at assign/en_route/arrived/completed time via
 * `dispatch-credit-enforcement.service.ts`, not as a visibility filter.
 *
 * Contract under test: the dispatch board returns every scheduled job
 * for the tenant on the requested date, regardless of linked-invoice
 * status. This suite locks in that contract so the gate cannot come
 * back without an explicit test change.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { getTestApp, closeTestApp } from '../helpers/test-app';
import { resetDb } from '../helpers/reset';
import {
  registerTenant,
  createCustomer,
  createPickupJob,
  insertInvoiceForJob,
} from '../helpers/factories';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function flattenBoard(body: any): Array<{ id: string }> {
  const drivers = Array.isArray(body?.drivers) ? body.drivers : [];
  const unassigned = Array.isArray(body?.unassigned) ? body.unassigned : [];
  const driverJobs = drivers.flatMap((d: any) =>
    Array.isArray(d?.jobs) ? d.jobs : [],
  );
  return [...unassigned, ...driverJobs];
}

describe('Dispatch board visibility (Phase B8 — payment gate removed)', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ({ app, ds } = await getTestApp());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  it('a job with no linked invoice is visible on the board (manual/legacy path)', async () => {
    const owner = await registerTenant(app);
    const customer = await createCustomer(app, owner.accessToken);
    const job = await createPickupJob(
      app,
      owner.accessToken,
      customer.id,
      today(),
    );

    const res = await request(app.getHttpServer())
      .get(`/dispatch/board?date=${today()}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    const jobs = flattenBoard(res.body);
    expect(jobs.find((j) => j.id === job.id)).toBeTruthy();
  });

  it('a job with an unpaid (open) invoice is visible on the board', async () => {
    const owner = await registerTenant(app);
    const customer = await createCustomer(app, owner.accessToken);
    const job = await createPickupJob(
      app,
      owner.accessToken,
      customer.id,
      today(),
    );

    await insertInvoiceForJob(ds, {
      tenantId: owner.tenantId,
      customerId: customer.id,
      jobId: job.id,
      status: 'open',
      subtotal: 500,
      total: 500,
      amountPaid: 0,
      balanceDue: 500,
    });

    const res = await request(app.getHttpServer())
      .get(`/dispatch/board?date=${today()}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    const jobs = flattenBoard(res.body);
    expect(jobs.find((j) => j.id === job.id)).toBeTruthy();
  });

  it('partial payment status also makes the job visible', async () => {
    const owner = await registerTenant(app);
    const customer = await createCustomer(app, owner.accessToken);
    const job = await createPickupJob(
      app,
      owner.accessToken,
      customer.id,
      today(),
    );

    await insertInvoiceForJob(ds, {
      tenantId: owner.tenantId,
      customerId: customer.id,
      jobId: job.id,
      status: 'partial',
      subtotal: 500,
      total: 500,
      amountPaid: 250,
      balanceDue: 250,
    });

    const res = await request(app.getHttpServer())
      .get(`/dispatch/board?date=${today()}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const jobs = flattenBoard(res.body);
    expect(jobs.find((j) => j.id === job.id)).toBeTruthy();
  });

  it('a draft invoice does not hide the job', async () => {
    const owner = await registerTenant(app);
    const customer = await createCustomer(app, owner.accessToken);
    const job = await createPickupJob(
      app,
      owner.accessToken,
      customer.id,
      today(),
    );

    await insertInvoiceForJob(ds, {
      tenantId: owner.tenantId,
      customerId: customer.id,
      jobId: job.id,
      status: 'draft',
    });

    const res = await request(app.getHttpServer())
      .get(`/dispatch/board?date=${today()}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const jobs = flattenBoard(res.body);
    expect(jobs.find((j) => j.id === job.id)).toBeTruthy();
  });

  it('a voided invoice does not hide the job', async () => {
    const owner = await registerTenant(app);
    const customer = await createCustomer(app, owner.accessToken);
    const job = await createPickupJob(
      app,
      owner.accessToken,
      customer.id,
      today(),
    );

    await insertInvoiceForJob(ds, {
      tenantId: owner.tenantId,
      customerId: customer.id,
      jobId: job.id,
      status: 'void',
      subtotal: 500,
      total: 500,
      amountPaid: 0,
      balanceDue: 0,
    });

    const res = await request(app.getHttpServer())
      .get(`/dispatch/board?date=${today()}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const jobs = flattenBoard(res.body);
    expect(jobs.find((j) => j.id === job.id)).toBeTruthy();
  });
});
