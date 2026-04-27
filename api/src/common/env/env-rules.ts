export type EnvCategory =
  | 'auth'
  | 'database'
  | 'payments'
  | 'comms'
  | 'maps'
  | 'observability'
  | 'app-urls'
  | 'oauth';

export type EnvClassification = 'critical' | 'important' | 'optional';

export type EnvRule = {
  name: string;
  category: EnvCategory;
  classification: EnvClassification;
  impact: string;
  forbiddenInProd?: string[];
  invalidIfProd?: (value: string) => boolean;
  minLengthInProd?: number;
  pairWith?: string;
};

export const ENV_RULES: EnvRule[] = [
  {
    name: 'DATABASE_URL',
    category: 'database',
    classification: 'critical',
    impact: 'database connection unavailable; service cannot run',
  },

  {
    name: 'JWT_SECRET',
    category: 'auth',
    classification: 'critical',
    impact:
      'auth tokens cannot be signed/verified securely; default value lets attackers forge tokens',
    forbiddenInProd: ['serviceos-dev-secret'],
    minLengthInProd: 32,
  },
  {
    name: 'CRON_SECRET',
    category: 'auth',
    classification: 'critical',
    impact:
      'scheduled cron jobs (overdue scan, quote follow-ups) refuse to run',
    minLengthInProd: 16,
  },

  {
    name: 'STRIPE_SECRET_KEY',
    category: 'payments',
    classification: 'critical',
    impact:
      'all payment operations fail at runtime; placeholder fallback hides the misconfiguration',
    forbiddenInProd: ['sk_test_placeholder'],
    // PILOT MODE (April 2026): Stripe Connect is not yet live; sk_test_* is
    // intentional in production during the pilot. When real-money billing
    // launches (Stripe Connect onboarding complete), uncomment the line below
    // to enforce sk_live_* in production. Tracked in backlog as:
    // "Re-enable Stripe live-key enforcement when real-money billing launches."
    // invalidIfProd: (v) => v.startsWith('sk_test_'),
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    category: 'payments',
    classification: 'critical',
    impact:
      'Stripe webhook signature verification rejects all events; invoice reconciliation breaks',
  },

  {
    name: 'TWILIO_ACCOUNT_SID',
    category: 'comms',
    classification: 'critical',
    impact:
      'all outbound SMS silently no-ops; inbound Twilio webhook signature check fails',
    pairWith: 'TWILIO_AUTH_TOKEN',
  },
  {
    name: 'TWILIO_AUTH_TOKEN',
    category: 'comms',
    classification: 'critical',
    impact:
      'all outbound SMS silently no-ops; inbound Twilio webhook signature check fails',
    pairWith: 'TWILIO_ACCOUNT_SID',
  },
  {
    name: 'TWILIO_PHONE_NUMBER',
    category: 'comms',
    classification: 'critical',
    impact: 'SMS sends fail with empty "from" number',
  },
  {
    name: 'RESEND_API_KEY',
    category: 'comms',
    classification: 'critical',
    impact:
      'all transactional email (password reset, receipts, quotes) silently fails',
  },

  {
    name: 'SENTRY_HASH_SALT',
    category: 'observability',
    classification: 'critical',
    impact:
      'PII scrubber uses empty salt → deterministic hashes → hashable PII leaks into Sentry events',
  },
  {
    name: 'SENTRY_DSN_API',
    category: 'observability',
    classification: 'important',
    impact:
      'Sentry SDK no-ops; no error tracking. This is the documented rollback path so absence is acceptable',
  },

  {
    name: 'MAPBOX_TOKEN',
    category: 'maps',
    classification: 'important',
    impact:
      'address autocomplete and geocoding disabled; jobs can still be booked with manual addresses',
  },

  {
    name: 'GOOGLE_CLIENT_ID',
    category: 'oauth',
    classification: 'important',
    impact: 'Google OAuth login disabled; password login still works',
    pairWith: 'GOOGLE_CLIENT_SECRET',
  },
  {
    name: 'GOOGLE_CLIENT_SECRET',
    category: 'oauth',
    classification: 'important',
    impact: 'Google OAuth login disabled; password login still works',
    pairWith: 'GOOGLE_CLIENT_ID',
  },

  {
    name: 'APP_URL',
    category: 'app-urls',
    classification: 'critical',
    impact:
      'password reset / Google OAuth callback URLs fall back to hardcoded defaults; preview deploys silently link to production',
  },
  {
    name: 'FRONTEND_URL',
    category: 'app-urls',
    classification: 'critical',
    impact:
      'Stripe return URLs and portal links fall back to hardcoded production values',
  },
  {
    name: 'WEB_DOMAIN',
    category: 'app-urls',
    classification: 'critical',
    impact:
      'quote links and SMS body links fall back to hardcoded production values',
  },
];
