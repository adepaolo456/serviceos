import { validateEnv } from './env-validator';

const PROD_BASE: NodeJS.ProcessEnv = {
  VERCEL_ENV: 'production',
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@host:5432/db',
  JWT_SECRET: 'a'.repeat(48),
  CRON_SECRET: 'cron-secret-32-chars-minimum',
  STRIPE_SECRET_KEY: 'sk_live_abc123',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
  TWILIO_ACCOUNT_SID: 'AC' + 'x'.repeat(32),
  TWILIO_AUTH_TOKEN: 'twilio-auth-token-value',
  TWILIO_PHONE_NUMBER: '+15555555555',
  RESEND_API_KEY: 're_abc123',
  SENTRY_HASH_SALT: 'sentry-salt-value',
  APP_URL: 'https://app.rentthisapp.com',
  FRONTEND_URL: 'https://app.rentthisapp.com',
  WEB_DOMAIN: 'app.rentthisapp.com',
};

describe('validateEnv', () => {
  let exitSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  function loggedLines(): string[] {
    return [
      ...consoleSpy.mock.calls.map((args) => String(args[0])),
      ...consoleLogSpy.mock.calls.map((args) => String(args[0])),
    ];
  }

  it('passes silently in production when all Critical vars are valid', () => {
    expect(() => validateEnv({ ...PROD_BASE })).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    const lines = loggedLines();
    expect(lines.some((l) => l.startsWith('[EnvValidator] OK'))).toBe(true);
    expect(lines.some((l) => l.includes('CRITICAL'))).toBe(false);
  });

  it('exits in production when a Critical var is missing', () => {
    const env = { ...PROD_BASE };
    delete env.STRIPE_WEBHOOK_SECRET;
    expect(() => validateEnv(env)).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const lines = loggedLines();
    expect(
      lines.some(
        (l) =>
          l.includes('CRITICAL') &&
          l.includes('missing=STRIPE_WEBHOOK_SECRET'),
      ),
    ).toBe(true);
  });

  it('exits in preview when a Critical var is missing', () => {
    const env: NodeJS.ProcessEnv = {
      ...PROD_BASE,
      VERCEL_ENV: 'preview',
    };
    delete env.RESEND_API_KEY;
    expect(() => validateEnv(env)).toThrow('exit:1');
    const lines = loggedLines();
    expect(
      lines.some(
        (l) =>
          l.includes('env=preview') && l.includes('missing=RESEND_API_KEY'),
      ),
    ).toBe(true);
  });

  it('does not exit in development when a Critical var is missing, but logs CRITICAL', () => {
    const env: NodeJS.ProcessEnv = {
      VERCEL_ENV: 'development',
      NODE_ENV: 'development',
    };
    expect(() => validateEnv(env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    const lines = loggedLines();
    expect(
      lines.some(
        (l) =>
          l.includes('WARNING') &&
          l.includes('missing=DATABASE_URL'),
      ),
    ).toBe(true);
  });

  it('rejects forbidden default JWT_SECRET in production', () => {
    const env = { ...PROD_BASE, JWT_SECRET: 'serviceos-dev-secret' };
    expect(() => validateEnv(env)).toThrow('exit:1');
    const lines = loggedLines();
    expect(
      lines.some(
        (l) =>
          l.includes('CRITICAL') &&
          l.includes('forbidden_value=JWT_SECRET'),
      ),
    ).toBe(true);
  });

  it('rejects too-short JWT_SECRET in production', () => {
    const env = { ...PROD_BASE, JWT_SECRET: 'short' };
    expect(() => validateEnv(env)).toThrow('exit:1');
    const lines = loggedLines();
    expect(
      lines.some(
        (l) => l.includes('too_short=JWT_SECRET') && l.includes('min=32'),
      ),
    ).toBe(true);
  });

  it('accepts sk_test_* STRIPE_SECRET_KEY in production during pilot mode', () => {
    const env = { ...PROD_BASE, STRIPE_SECRET_KEY: 'sk_test_real_value' };
    expect(() => validateEnv(env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('rejects sk_test_placeholder STRIPE_SECRET_KEY in production', () => {
    const env = { ...PROD_BASE, STRIPE_SECRET_KEY: 'sk_test_placeholder' };
    expect(() => validateEnv(env)).toThrow('exit:1');
    const lines = loggedLines();
    expect(
      lines.some((l) =>
        l.includes('forbidden_value=STRIPE_SECRET_KEY'),
      ),
    ).toBe(true);
  });

  it('does not exit when STRIPE_SECRET_KEY is sk_test_placeholder in development', () => {
    const env: NodeJS.ProcessEnv = {
      VERCEL_ENV: 'development',
      NODE_ENV: 'development',
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
    };
    expect(() => validateEnv(env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('fails on Twilio pair mismatch in production (SID without TOKEN)', () => {
    const env = { ...PROD_BASE };
    delete env.TWILIO_AUTH_TOKEN;
    expect(() => validateEnv(env)).toThrow('exit:1');
    const lines = loggedLines();
    expect(
      lines.some(
        (l) =>
          l.includes('CRITICAL') &&
          (l.includes('TWILIO_ACCOUNT_SID') ||
            l.includes('TWILIO_AUTH_TOKEN')),
      ),
    ).toBe(true);
  });

  it('warns (no exit) on Google pair mismatch — Important classification', () => {
    const env = { ...PROD_BASE, GOOGLE_CLIENT_ID: 'client-id-value' };
    expect(() => validateEnv(env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    const lines = loggedLines();
    expect(
      lines.some(
        (l) =>
          l.includes('WARNING') &&
          (l.includes('GOOGLE_CLIENT_ID') ||
            l.includes('GOOGLE_CLIENT_SECRET')),
      ),
    ).toBe(true);
  });

  it('warns (no exit) when an Important var is missing in production', () => {
    const env = { ...PROD_BASE };
    delete env.MAPBOX_TOKEN;
    expect(() => validateEnv(env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    const lines = loggedLines();
    expect(
      lines.some(
        (l) =>
          l.includes('WARNING') && l.includes('missing=MAPBOX_TOKEN'),
      ),
    ).toBe(true);
  });

  it('is silent when NODE_ENV=test', () => {
    validateEnv({ NODE_ENV: 'test' });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('never logs an env-var value', () => {
    const env = {
      ...PROD_BASE,
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      JWT_SECRET: 'serviceos-dev-secret',
    };
    expect(() => validateEnv(env)).toThrow('exit:1');
    const allLogged = loggedLines().join('\n');
    expect(allLogged).not.toContain('sk_test_placeholder');
    expect(allLogged).not.toContain('serviceos-dev-secret');
    // env=production is part of the structured log format (metadata, not a
    // secret value), so VERCEL_ENV and NODE_ENV are excluded from the check.
    const SECRET_KEYS = Object.keys(PROD_BASE).filter(
      (k) => k !== 'VERCEL_ENV' && k !== 'NODE_ENV',
    );
    for (const k of SECRET_KEYS) {
      const value = PROD_BASE[k];
      if (typeof value === 'string' && value.length >= 8) {
        expect(allLogged).not.toContain(value);
      }
    }
  });
});
