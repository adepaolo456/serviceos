/**
 * Arc K Phase 1A Step 2 — Sentry SDK configuration.
 *
 * DSN, environment, sample rates. The beforeSend hook is wired
 * separately from before-send.ts. This file does NOT import
 * @sentry/nestjs at module load time — it only exports config
 * primitives. Sentry.init() is called from instrument.ts which
 * is imported BEFORE AppModule boot in main.ts.
 *
 * §K.7 (audit): errors 100%, traces 10%, profiles 0% under the
 * Sentry Team plan ($26/mo) with a 40K-event/month quota alert.
 */

import { COMMIT_SHA } from '../../build-info';
import { beforeSend } from './before-send';

export const SENTRY_DSN = process.env.SENTRY_DSN_API ?? '';
export const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT ?? 'production';

/**
 * Whether Sentry is enabled. If DSN is empty, the SDK no-ops cleanly
 * (no events sent, no errors thrown). This is also the rollback path:
 * clear SENTRY_DSN_API and the SDK silences itself.
 */
export const SENTRY_ENABLED = SENTRY_DSN.length > 0;

/**
 * Build the init options object. Kept as a function so instrument.ts
 * can call it once at module load and tests can inspect the shape
 * without performing real init.
 */
export function buildSentryInitOptions() {
  return {
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    enabled: SENTRY_ENABLED,
    // arcZ (#121, 2026-05-06): tag runtime events with release matching the
    // sentry-cli source-map upload release name, so source maps auto-apply
    // to runtime stack traces. COMMIT_SHA comes from arcY's build-info.ts
    // (overwritten by vercel-build before nest build). See #122 / arcY for
    // the upstream primitive.
    release: COMMIT_SHA,
    // §K.7: errors 100%, traces 10%, profiles 0%.
    tracesSampleRate: 0.1,
    profilesSampleRate: 0,
    // §K.5 + §K.4: every event is filtered/scrubbed/tagged by beforeSend.
    // If neither tenant_id nor scope=platform is derivable from CLS,
    // the event is dropped (untagged-event guard).
    beforeSend,
    // Vercel function lifecycle: drain pending events on shutdown
    // without blocking longer than 2s.
    shutdownTimeout: 2000,
    // Don't auto-capture request data — beforeSend handles tagging
    // explicitly; PII scrubbing in Step 4 will require deterministic
    // control over what enters the event.
    sendDefaultPii: false,
  };
}
