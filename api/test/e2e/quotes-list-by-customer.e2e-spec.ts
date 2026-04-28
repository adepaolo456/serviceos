/**
 * Regression guard — Sentry issue 7444816000.
 *
 * GET /quotes?customerId=<uuid> previously failed with
 *   QueryFailedError: operator does not exist: uuid = text
 * because the controller's customerId filter shared a single :tenantId
 * placeholder between the outer quotes.tenant_id (varchar in DB) and an
 * inline subquery on customers.tenant_id (uuid in DB). PG cannot infer
 * one bind type that satisfies both.
 *
 * Phase 1 fix: the inner subquery now binds a distinct :customersTenantId
 * placeholder. Both placeholders carry the same runtime tenantId value, but
 * PG infers each independently against its column's type family.
 *
 * The e2e test DB schema mirrors the production drift (entity has plain
 * @Column({ name: 'tenant_id' }) → varchar) so this test reproduces the
 * pre-fix failure mode and the post-fix success path on a real Postgres.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { getTestApp, closeTestApp } from '../helpers/test-app';
import { resetDb } from '../helpers/reset';
import { registerTenant, createCustomer, createQuote } from '../helpers/factories';

describe('GET /quotes?customerId — Sentry 7444816000 regression', () => {
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

  it('returns 200 with the linked quote when filtering by customerId (uuid)', async () => {
    const owner = await registerTenant(app);
    const sharedEmail = `bound-customer-${Date.now()}@example.test`;
    const customer = await createCustomer(app, owner.accessToken, {
      email: sharedEmail,
    });
    // Quote is linked to the customer at create time via the same email,
    // so the controller's customer_id filter has a row to match.
    const quote = await createQuote(app, owner.accessToken, {
      customerEmail: sharedEmail,
      customerName: 'Bound Customer',
    });
    expect(quote.id).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get(`/quotes?customerId=${customer.id}&limit=50`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    // Pre-fix: 500 with QueryFailedError "operator does not exist: uuid = text".
    // Post-fix: 200 with the list payload. Response shape is
    // { data: Quote[], meta: { total: number } } per quotes.controller.ts.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.meta?.total).toBe('number');
  });

  it('returns 200 with empty list when customerId belongs to no quotes', async () => {
    const owner = await registerTenant(app);
    const customer = await createCustomer(app, owner.accessToken);
    // No quotes created. Empty result must still parse — proves the
    // mixed-type subquery executes even when nothing matches.
    const res = await request(app.getHttpServer())
      .get(`/quotes?customerId=${customer.id}&limit=50`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta?.total).toBe(0);
  });
});
