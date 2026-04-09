/**
 * Tier 1 #1, #2, #16 — signup flow.
 *
 * Regression guards the two signup paths (email/password + Google OAuth
 * new-user branch) against losing the Phase-2 fix that pre-creates the
 * `tenant_settings` row at signup. Also asserts owner role assignment
 * and slug collision handling.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { getTestApp, closeTestApp } from '../helpers/test-app';
import { resetDb } from '../helpers/reset';
import { registerTenant, uniq } from '../helpers/factories';
import { AuthService } from '../../src/modules/auth/auth.service';

describe('Signup — tenant_settings pre-creation + owner role (Tier 1 #1, #2, #16)', () => {
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

  describe('POST /auth/register (email/password)', () => {
    it('creates tenant + user + tenant_settings rows atomically', async () => {
      const suffix = uniq();
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          companyName: `Atomic Co ${suffix}`,
          businessType: 'dumpster',
          email: `atomic-${suffix}@example.test`,
          password: 'password12',
          firstName: 'Atomic',
          lastName: 'Owner',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('owner');
      expect(res.body.tenant.id).toBeTruthy();
      expect(res.body.accessToken).toBeTruthy();

      const tenantId = res.body.tenant.id;

      // Tenant row
      const tenants = await ds.query(
        'SELECT id, name, business_type FROM tenants WHERE id = $1',
        [tenantId],
      );
      expect(tenants).toHaveLength(1);
      expect(tenants[0].business_type).toBe('dumpster');

      // User row with owner role
      const users = await ds.query(
        'SELECT id, role, tenant_id FROM users WHERE tenant_id = $1',
        [tenantId],
      );
      expect(users).toHaveLength(1);
      expect(users[0].role).toBe('owner');

      // tenant_settings row — the thing the Phase 2 fix pre-creates
      const settings = await ds.query(
        `SELECT sms_enabled, email_enabled, default_rental_period_days,
                brand_color, quote_expiration_days, sms_phone_number, support_email
         FROM tenant_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(settings).toHaveLength(1);
      expect(settings[0].sms_enabled).toBe(false);
      expect(settings[0].email_enabled).toBe(false);
      expect(Number(settings[0].default_rental_period_days)).toBe(14);
      expect(settings[0].brand_color).toBe('#22C55E');
      expect(Number(settings[0].quote_expiration_days)).toBe(30);
      expect(settings[0].sms_phone_number).toBeNull();
      expect(settings[0].support_email).toBeNull();
    });

    it('first authenticated GET /tenant-settings returns a row without lazy-create race', async () => {
      // Register
      const tenant = await registerTenant(app);

      // Immediately hit /tenant-settings with the fresh token — no prior
      // call has touched the settings row. Before Phase 2 #3 landed, this
      // call would trigger lazy-create; now it should find the pre-created
      // row. Either way it should 200; the value of this test is: if someone
      // deletes the pre-create AND breaks the lazy fallback, this catches it.
      const res = await request(app.getHttpServer())
        .get('/tenant-settings')
        .set('Authorization', `Bearer ${tenant.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant_id).toBe(tenant.tenantId);
      // Defaults round-trip through the API
      expect(res.body.sms_enabled).toBe(false);
      expect(res.body.email_enabled).toBe(false);
    });

    it('handles slug collision on duplicate company name', async () => {
      const sharedName = `Dupe Co ${uniq()}`;

      const first = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          companyName: sharedName,
          businessType: 'dumpster',
          email: `dupe-1-${uniq()}@example.test`,
          password: 'password12',
          firstName: 'First',
          lastName: 'Owner',
        });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          companyName: sharedName,
          businessType: 'dumpster',
          email: `dupe-2-${uniq()}@example.test`,
          password: 'password12',
          firstName: 'Second',
          lastName: 'Owner',
        });
      expect(second.status).toBe(201);

      expect(second.body.tenant.slug).not.toBe(first.body.tenant.slug);
      // Second tenant's slug should start with the same base
      const base = first.body.tenant.slug;
      expect(second.body.tenant.slug.startsWith(base)).toBe(true);
    });
  });

  describe('AuthService.googleLogin() new-user branch', () => {
    it('pre-creates tenant_settings for Google-signup tenants (parity with register)', async () => {
      // Both services live inside AuthModule, so we need strict:false to
      // resolve them across the module tree from the app root context.
      const authService = app.get(AuthService, { strict: false });
      const jwtService = app.get(JwtService, { strict: false });

      const email = `google-${uniq()}@example.test`;
      const result = await authService.googleLogin({
        googleId: `google-id-${uniq()}`,
        email,
        firstName: 'Google',
        lastName: 'User',
      });

      expect(result.isNew).toBe(true);
      expect(result.accessToken).toBeTruthy();

      // Decode the JWT to get the tenantId without querying users by email
      // (avoids any assumption about email casing / trimming rules).
      const decoded = jwtService.decode(result.accessToken) as {
        tenantId: string;
      };
      expect(decoded.tenantId).toBeTruthy();

      // tenant_settings exists for the new tenant
      const settings = await ds.query(
        'SELECT sms_enabled, email_enabled, brand_color FROM tenant_settings WHERE tenant_id = $1',
        [decoded.tenantId],
      );
      expect(settings).toHaveLength(1);
      expect(settings[0].sms_enabled).toBe(false);
      expect(settings[0].email_enabled).toBe(false);
      expect(settings[0].brand_color).toBe('#22C55E');
    });
  });
});
