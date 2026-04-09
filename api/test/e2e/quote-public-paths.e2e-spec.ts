/**
 * Tier 1 #7, #8 — public quote path.
 *
 * Two regression guards in one file:
 *   1. The canonical token-keyed public quote path still works. This is
 *      the path tenant websites and customer emails link to, so it has
 *      to be 100% reliable.
 *   2. The legacy @Public() GET /quotes/:id/book endpoint stays gone
 *      (deleted in Phase 2). If someone re-adds it, this test fails.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { getTestApp, closeTestApp } from '../helpers/test-app';
import { resetDb } from '../helpers/reset';
import { registerTenant, createQuote } from '../helpers/factories';

describe('Public quote paths (Tier 1 #7, #8)', () => {
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

  it('canonical GET /public/tenant/quote/:token returns active quote data', async () => {
    const owner = await registerTenant(app);
    const quote = await createQuote(app, owner.accessToken, {
      assetSubtype: '20yd',
      basePrice: 750,
      customerName: 'Public Path Customer',
    });

    expect(quote.token).toBeTruthy();

    const res = await request(app.getHttpServer()).get(
      `/public/tenant/quote/${quote.token}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.quote).toBeTruthy();
    expect(res.body.quote.size).toBe('20yd');
    expect(res.body.branding).toBeTruthy();
    expect(res.body.branding.companyName).toBeTruthy();
    expect(res.body.branding.slug).toBe(owner.tenantSlug);
  });

  it('canonical public path returns 404 for unknown token', async () => {
    await registerTenant(app); // ensures there's at least one tenant
    const res = await request(app.getHttpServer()).get(
      '/public/tenant/quote/this-token-does-not-exist',
    );
    expect(res.status).toBe(404);
  });

  it('legacy GET /quotes/:id/book endpoint is gone (Phase 2 deletion)', async () => {
    // Create a real quote so we have a valid UUID to try. If Phase 2
    // regressed, the endpoint would have returned 200 with quote data.
    // With the endpoint deleted, Nest's router returns 404.
    const owner = await registerTenant(app);
    const quote = await createQuote(app, owner.accessToken);

    const res = await request(app.getHttpServer()).get(
      `/quotes/${quote.id}/book`,
    );
    expect(res.status).toBe(404);
  });
});
