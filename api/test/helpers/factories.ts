/**
 * Factory helpers for Tier 1 E2E tests.
 *
 * Every factory either hits the real HTTP endpoint (so the full guard +
 * controller + service + repo stack is exercised) or writes directly via
 * the DataSource when no endpoint exists. No ORM repositories are used
 * here — raw SQL for direct writes keeps the helpers decoupled from
 * entity constructor quirks.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';

let uniqueCounter = 0;

/** Returns a unique identifier suffix — collision-free across a single test run. */
export function uniq(): string {
  uniqueCounter += 1;
  return `${Date.now()}-${uniqueCounter}`;
}

export interface RegisteredTenant {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  email: string;
  accessToken: string;
}

/**
 * Register a new tenant via `POST /auth/register`. Exercises the real
 * signup path — the thing we want to regression-guard for Phase 2 #3
 * (pre-create tenant_settings). Returns the credentials the rest of the
 * test can use.
 */
export async function registerTenant(
  app: INestApplication,
  overrides: Partial<{
    email: string;
    companyName: string;
    businessType: string;
  }> = {},
): Promise<RegisteredTenant> {
  const suffix = uniq();
  const payload = {
    companyName: overrides.companyName ?? `Test Co ${suffix}`,
    businessType: overrides.businessType ?? 'dumpster',
    email: overrides.email ?? `owner-${suffix}@example.test`,
    password: 'password12',
    firstName: 'Test',
    lastName: 'Owner',
  };

  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send(payload);

  if (res.status !== 201) {
    throw new Error(
      `registerTenant failed: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }

  return {
    tenantId: res.body.tenant.id,
    tenantSlug: res.body.tenant.slug,
    userId: res.body.user.id,
    email: res.body.user.email,
    accessToken: res.body.accessToken,
  };
}

/**
 * Create a customer under the given tenant via `POST /customers`.
 */
export async function createCustomer(
  app: INestApplication,
  ownerToken: string,
  overrides: Partial<{ firstName: string; lastName: string; email: string }> = {},
): Promise<{ id: string }> {
  const suffix = uniq();
  const res = await request(app.getHttpServer())
    .post('/customers')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      firstName: overrides.firstName ?? 'Jane',
      lastName: overrides.lastName ?? `Doe${suffix}`,
      email: overrides.email ?? `customer-${suffix}@example.test`,
    });

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `createCustomer failed: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id };
}

/**
 * Create a quote under the given tenant via `POST /quotes`. No pricing
 * rule lookup is triggered — the caller passes basePrice directly, which
 * is the supported API surface and does not require a pre-seeded pricing
 * catalog. Returns the full quote body so tests can read `token`.
 */
export async function createQuote(
  app: INestApplication,
  ownerToken: string,
  overrides: Partial<{
    customerName: string;
    customerEmail: string;
    assetSubtype: string;
    basePrice: number;
  }> = {},
): Promise<{ id: string; token: string; [k: string]: any }> {
  const suffix = uniq();
  const res = await request(app.getHttpServer())
    .post('/quotes')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      customerName: overrides.customerName ?? `Quote Customer ${suffix}`,
      customerEmail:
        overrides.customerEmail ?? `quote-${suffix}@example.test`,
      assetSubtype: overrides.assetSubtype ?? '20yd',
      basePrice: overrides.basePrice ?? 500,
    });

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `createQuote failed: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }
  return res.body;
}

/**
 * Create a pickup job (job_type != 'delivery') so the jobs service does
 * NOT auto-create an invoice. The test can then manually insert an
 * invoice at whatever status it wants to exercise the dispatch-board
 * payment-gating query.
 */
export async function createPickupJob(
  app: INestApplication,
  ownerToken: string,
  customerId: string,
  scheduledDate: string,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/jobs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      customerId,
      jobType: 'pickup',
      scheduledDate,
    });

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `createPickupJob failed: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id };
}

/**
 * Insert an invoice row directly, linked to a job, at a caller-chosen
 * status. Used by the dispatch payment-gating test to exercise the real
 * query rule (`dispatch.service.ts:39`) without going through the full
 * billing service.
 *
 * Returns the new invoice id so the test can transition status later.
 */
export async function insertInvoiceForJob(
  ds: DataSource,
  args: {
    tenantId: string;
    customerId: string;
    jobId: string;
    status: 'draft' | 'open' | 'partial' | 'paid' | 'void';
    subtotal?: number;
    total?: number;
    amountPaid?: number;
    balanceDue?: number;
  },
): Promise<{ id: string }> {
  const subtotal = args.subtotal ?? 500;
  const total = args.total ?? subtotal;
  const amountPaid = args.amountPaid ?? (args.status === 'paid' ? total : 0);
  const balanceDue = args.balanceDue ?? total - amountPaid;

  const rows = await ds.query(
    `INSERT INTO invoices (
       tenant_id, invoice_number, status, customer_id, customer_type,
       invoice_date, due_date, subtotal, total, amount_paid, balance_due, job_id
     )
     VALUES (
       $1,
       (SELECT COALESCE(MAX(invoice_number), 0) + 1 FROM invoices WHERE tenant_id = $1),
       $2, $3, 'residential', CURRENT_DATE, CURRENT_DATE, $4, $5, $6, $7, $8
     )
     RETURNING id`,
    [
      args.tenantId,
      args.status,
      args.customerId,
      subtotal,
      total,
      amountPaid,
      balanceDue,
      args.jobId,
    ],
  );
  return { id: rows[0].id };
}
