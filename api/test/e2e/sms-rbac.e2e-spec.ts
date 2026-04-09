/**
 * Tier 1 #3, #4, #5, #6 — SMS RBAC regression guard for Phase 1.
 *
 * Phase 1 shipped field-level gating that restricts SMS-sensitive
 * mutations to role=owner only. This suite exercises every gate that
 * was landed:
 *   - POST /tenant-settings/sms/provision-number  (owner-only)
 *   - PATCH /tenant-settings/notifications        (sms_enabled owner-only)
 *   - PATCH /tenant-settings/quotes               (sms fields owner-only)
 *   - PATCH /tenant-settings/quote-templates      (owner-only)
 *   - PUT /notifications/preferences/:type        (sms_enabled owner-only)
 *   - POST /notifications/test                    (phone channel owner-only)
 *
 * RolesGuard uses a role hierarchy (owner=5, admin=4, dispatcher=3,
 * driver=2). The class-level @Roles('admin','owner') floor means
 * dispatcher/driver hit 403 at the RolesGuard level before the service
 * field-level check runs. That's fine — both layers of defense are
 * exercised here because admin tokens pass RolesGuard and then hit the
 * service-level 403 for SMS fields specifically.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { getTestApp, closeTestApp } from '../helpers/test-app';
import { resetDb } from '../helpers/reset';
import { registerTenant, uniq } from '../helpers/factories';
import { mintToken } from '../helpers/jwt';

describe('SMS RBAC — Phase 1 field-level gating (Tier 1 #3, #4, #5, #6)', () => {
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

    // Register a real owner via the real signup path — this also
    // pre-creates tenant_settings, so the PATCH endpoints under test
    // have a row to mutate.
    const owner = await registerTenant(app);
    tenantId = owner.tenantId;
    ownerToken = owner.accessToken;

    // Mint admin/dispatcher/driver tokens for the same tenant. JwtStrategy
    // does not lookup users in the DB, so these tokens authenticate as if
    // real users in that tenant exist with those roles — exactly the
    // surface the guards protect.
    const fakeId = () => `11111111-1111-1111-1111-${uniq().replace(/[^0-9a-f]/g, '').padEnd(12, '0').slice(0, 12)}`;
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

  describe('POST /tenant-settings/sms/provision-number', () => {
    it('owner is not blocked by the role guard', async () => {
      // We don't assert 200 — without Twilio creds the service may return
      // a 200 with success=false, or a 500. We only assert the guard
      // doesn't reject with 403, which is what Phase 1 locked down.
      const res = await request(app.getHttpServer())
        .post('/tenant-settings/sms/provision-number')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      expect(res.status).not.toBe(403);
    });

    it('admin → 403', async () => {
      await request(app.getHttpServer())
        .post('/tenant-settings/sms/provision-number')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(403);
    });

    it('dispatcher → 403', async () => {
      await request(app.getHttpServer())
        .post('/tenant-settings/sms/provision-number')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({})
        .expect(403);
    });

    it('driver → 403', async () => {
      await request(app.getHttpServer())
        .post('/tenant-settings/sms/provision-number')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({})
        .expect(403);
    });
  });

  describe('PATCH /tenant-settings/notifications (sms_enabled field gating)', () => {
    it('owner can toggle sms_enabled', async () => {
      const res = await request(app.getHttpServer())
        .patch('/tenant-settings/notifications')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sms_enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.sms_enabled).toBe(true);
    });

    it('admin cannot toggle sms_enabled → 403 from service-level check', async () => {
      await request(app.getHttpServer())
        .patch('/tenant-settings/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sms_enabled: true })
        .expect(403);
    });

    it('admin CAN mutate non-SMS fields (email_enabled)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/tenant-settings/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email_enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.email_enabled).toBe(true);
    });
  });

  describe('PATCH /tenant-settings/quotes (SMS field gating)', () => {
    it('owner can set sms_phone_number', async () => {
      const res = await request(app.getHttpServer())
        .patch('/tenant-settings/quotes')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sms_phone_number: '+15085551234' });
      expect(res.status).toBe(200);
      expect(res.body.sms_phone_number).toBe('+15085551234');
    });

    it('admin cannot set sms_phone_number → 403', async () => {
      await request(app.getHttpServer())
        .patch('/tenant-settings/quotes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sms_phone_number: '+15085551234' })
        .expect(403);
    });

    it('admin cannot set quotes_sms_enabled → 403', async () => {
      await request(app.getHttpServer())
        .patch('/tenant-settings/quotes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quotes_sms_enabled: true })
        .expect(403);
    });

    it('admin cannot set quote_follow_up_enabled → 403', async () => {
      await request(app.getHttpServer())
        .patch('/tenant-settings/quotes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quote_follow_up_enabled: true })
        .expect(403);
    });

    it('admin CAN mutate non-SMS quote fields (quote_expiration_days)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/tenant-settings/quotes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quote_expiration_days: 45 });
      expect(res.status).toBe(200);
      expect(Number(res.body.quote_expiration_days)).toBe(45);
    });
  });

  describe('PATCH /tenant-settings/quote-templates (whole endpoint owner-only)', () => {
    it('owner can update templates', async () => {
      const res = await request(app.getHttpServer())
        .patch('/tenant-settings/quote-templates')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ quote_templates: { quote_sms_body: 'Custom body' } });
      expect(res.status).toBe(200);
    });

    it('admin → 403', async () => {
      await request(app.getHttpServer())
        .patch('/tenant-settings/quote-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quote_templates: { quote_sms_body: 'Custom body' } })
        .expect(403);
    });
  });

  describe('PUT /notifications/preferences/:type (sms_enabled field gating)', () => {
    it('owner can set sms_enabled preference', async () => {
      const res = await request(app.getHttpServer())
        .put('/notifications/preferences/booking_confirmation')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sms_enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.sms_enabled).toBe(true);
    });

    it('admin cannot set sms_enabled preference → 403', async () => {
      await request(app.getHttpServer())
        .put('/notifications/preferences/booking_confirmation')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sms_enabled: true })
        .expect(403);
    });

    it('admin CAN set email_enabled preference', async () => {
      const res = await request(app.getHttpServer())
        .put('/notifications/preferences/booking_confirmation')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email_enabled: false });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /notifications/test (phone channel owner-only)', () => {
    it('admin sending phone test → 403', async () => {
      await request(app.getHttpServer())
        .post('/notifications/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phone: '+15085551234', type: 'test' })
        .expect(403);
    });

    it('admin sending email test is not 403', async () => {
      // May succeed or fail downstream depending on Resend creds — we
      // only assert the gate doesn't reject admin for the email channel.
      const res = await request(app.getHttpServer())
        .post('/notifications/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'test@example.test', type: 'test' });
      expect(res.status).not.toBe(403);
    });

    it('owner sending phone test is not 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/notifications/test')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ phone: '+15085551234', type: 'test' });
      expect(res.status).not.toBe(403);
    });
  });
});
