/**
 * Tier 1 #5 (new) — dispatch board payment-gated visibility.
 *
 * The rule (per api/src/modules/dispatch/dispatch.service.ts:39):
 *
 *     .andWhere(
 *       '(inv.id IS NULL OR inv.status IN (:...paidStatuses))',
 *       { paidStatuses: ['paid', 'partial'] },
 *     )
 *
 * A job is visible on the dispatch board when EITHER:
 *   - it has no linked invoice (manual/legacy jobs), OR
 *   - it has a linked invoice whose status is 'paid' or 'partial'.
 *
 * Jobs with invoices in other statuses (e.g. 'open', 'draft') are hidden
 * until the invoice transitions. This test exercises the real query
 * against a real Postgres — it does NOT reimplement the rule in JS.
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

describe('Dispatch board payment gating (Tier 1 #5 — new)', () => {
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

  it('a job with an unpaid invoice is hidden, and appears once the invoice is paid', async () => {
    const owner = await registerTenant(app);
    const customer = await createCustomer(app, owner.accessToken);
    const job = await createPickupJob(
      app,
      owner.accessToken,
      customer.id,
      today(),
    );

    // Link an unpaid ('open') invoice to this job.
    const invoice = await insertInvoiceForJob(ds, {
      tenantId: owner.tenantId,
      customerId: customer.id,
      jobId: job.id,
      status: 'open',
      subtotal: 500,
      total: 500,
      amountPaid: 0,
      balanceDue: 500,
    });

    // Hidden
    let res = await request(app.getHttpServer())
      .get(`/dispatch/board?date=${today()}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    let jobs = flattenBoard(res.body);
    expect(jobs.find((j) => j.id === job.id)).toBeFalsy();

    // Transition invoice → paid (the real reconcileBalance path would
    // flip status; this test uses a direct UPDATE to isolate the
    // dispatch query under test from the payment machinery).
    await ds.query(
      `UPDATE invoices
         SET status = 'paid', amount_paid = total, balance_due = 0
         WHERE id = $1`,
      [invoice.id],
    );

    // Visible
    res = await request(app.getHttpServer())
      .get(`/dispatch/board?date=${today()}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    jobs = flattenBoard(res.body);
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

  it('a draft invoice also hides the job', async () => {
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
    expect(jobs.find((j) => j.id === job.id)).toBeFalsy();
  });
});
