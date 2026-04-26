/**
 * Arc K Phase 1A Step 2 — Sentry SDK initialization.
 *
 * IMPORT THIS FILE BEFORE @nestjs/core in api/src/main.ts.
 *
 * Sentry's auto-instrumentation patches modules at require time. If the
 * Nest core is loaded before Sentry.init(), the auto-instrumentation
 * misses the framework's request lifecycle. The standard NestJS
 * pattern is therefore to put init() in a separate file and import it
 * at the very top of main.ts.
 *
 * If SENTRY_DSN_API is empty (e.g., local dev, CI, or rollback path),
 * the SDK no-ops cleanly — no events sent, no errors thrown.
 */

import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

import { buildSentryInitOptions, SENTRY_ENABLED } from './sentry.config';

if (SENTRY_ENABLED) {
  Sentry.init({
    ...buildSentryInitOptions(),
    integrations: [nodeProfilingIntegration()],
  });
}
