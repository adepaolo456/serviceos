/**
 * Arc K Phase 1A Step 2 — Sentry NestJS module wrapper.
 *
 * Imports the upstream SentryModule.forRoot() (auto-wires request
 * lifecycle hooks) and registers SentryGlobalFilter as a global
 * exception filter. Unhandled exceptions reach this filter, which
 * forwards them to Sentry. The beforeSend hook (sentry.config.ts +
 * before-send.ts) decides whether the event is tagged + delivered or
 * dropped via the untagged-event guard.
 *
 * The filter wraps NestJS' BaseExceptionFilter — existing client-
 * facing error response shapes are preserved.
 */

import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule as UpstreamSentryModule } from '@sentry/nestjs/setup';

@Module({
  imports: [UpstreamSentryModule.forRoot()],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class SentryModule {}
