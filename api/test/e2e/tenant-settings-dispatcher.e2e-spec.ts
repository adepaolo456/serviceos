/**
 * Tier 1 #10 — GET /tenant-settings role widening.
 *
 * Phase 1 widened GET /tenant-settings from @Roles('admin','owner') to
 * @Roles('dispatcher','admin','owner') so dispatcher users can load the
 * settings page in read-only mode and see the banner. This test guards
 * against someone reverting that change (which would silently 403
 * dispatcher users out of the settings page).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { getTestApp, closeTestApp } from '../helpers/test-app';
import { resetDb } from '../helpers/reset';
import { registerTenant, uniq } from '../helpers/factories';
import { mintToken } from '../helpers/jwt';

describe('GET /tenant-settings role widening (Tier 1 #10)', () => {
  let app: INestApplication;
  let ds: DataSource;

  let tenantId: string;
  let ownerToken: string;
  let adminToken: string;
  let dispatcherToken: string;
  let driverToken: string;

  beforeAll(async () => {
    ({ app, ds } = await getTestApp());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(async () => {
    await resetDb(ds);

    const owner = await registerTenant(app);
    tenantId = owner.tenantId;
    ownerToken = owner.accessToken;

    const fakeId = () => `22222222-2222-2222-2222-${uniq().replace(/[^0-9a-f]/g, '').padEnd(12, '0').slice(0, 12)}`;
    adminToken = mintToken(app, {
      sub: fakeId(),
      email: `admin-${uniq()}@example.test`,
      role: 'admin',
      tenantId,
    });
    dispatcherToken = mintToken(app, {
      sub: fakeId(),
      email: `disp-${uniq()}@example.test`,
      role: 'dispatcher',
      tenantId,
    });
    driverToken = mintToken(app, {
      sub: fakeId(),
      email: `driver-${uniq()}@example.test`,
      role: 'driver',
      tenantId,
    });
  });

  it('owner → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-settings')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant_id).toBe(tenantId);
  });

  it('admin → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant_id).toBe(tenantId);
  });

  it('dispatcher → 200 (read-only, for the settings-page banner)', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-settings')
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant_id).toBe(tenantId);
  });

  it('driver → 403 (below dispatcher in role hierarchy)', async () => {
    await request(app.getHttpServer())
      .get('/tenant-settings')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(403);
  });
});
