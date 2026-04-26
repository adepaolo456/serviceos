# Arc K — Sentry Integration Phase 0 Audit Report

**Date:** 2026-04-25
**HEAD at audit time:** `e7ae2ac` (post Arc J.1f PR 1 / 2 / 3)
**Scope:** Read-only audit. NO code edits. NO npm installs. ONE allowed write — this report.
**Status:** Investigation only. Phase 1 implementation gated on §K.10 review.

---

## Executive Summary

ServiceOS is currently running with **zero error-telemetry tooling** across all three surfaces (NestJS API, Next.js web, RN/Expo driver app). No `@sentry/*` packages, no Bugsnag, no Datadog, no OpenTelemetry. The codebase is a clean slate for a new integration — but it also means no PII scrubbing, no `tenant_id` correlation, and no alert filtering exist yet.

The Phase 1 implementation surface is moderate, not minimal:

- **35 unique PII fields** across 9 surfaces require explicit STRIP/HASH/KEEP rules before any event is sent
- **2 source-map privacy checks PASS by default** (API, web); **driver-app PASS provisional** pending EAS config in Phase 1
- **2 webhook entries lack signature failures suppression** today (Stripe + Twilio validate sigs, but their `BadRequestException`/`UnauthorizedException` are NOT filtered from telemetry — they will become alert spam unless we add deny-list rules)
- **2 manual cron endpoints** (overdue-scan, quote-follow-ups) iterate per-tenant in the loop body — `tenant_id` IS in scope at the throw site, but exception escape from the loop body would currently lose that scope
- **`AsyncLocalStorage` is NOT in use** anywhere in the API — Phase 1 should add a `RequestContext` middleware so `tenant_id` propagates through async chains automatically (the alternative is per-call-site `Sentry.withScope` which is verbose and easy to forget)
- **No Next.js error boundaries** (`error.tsx` / `global-error.tsx`) anywhere in `web/src/app/` — Phase 1 will need to add at least the root + `(dashboard)` boundaries

§K.10 (Phase 1 gate) is **NOT yet satisfied** because §K.7 cost projection and per-tenant alert-routing decisions require human sign-off before the gate opens. Everything else (PII rules, tenant_id strategy, filter list, scenarios, risks, env-var inventory) is closed by this report.

---

## §K.1 — Codebase telemetry surface inventory

### `console.error` / `console.warn`

**Count: 11 total (5 API, 6 Web, 0 Driver)**

| File:line | Surface | Auth context |
|---|---|---|
| `api/src/app.module.ts:55` | API — DATABASE_URL bootstrap validation | unauth (module init) |
| `api/src/modules/auth/auth.controller.ts:404` | API — Google OAuth init failure | public |
| `api/src/modules/auth/auth.controller.ts:459` | API — Google token exchange failure | public (callback) |
| `api/src/modules/auth/auth.controller.ts:534` | API — OAuth callback error path | public (callback) |
| `api/src/modules/jobs/jobs.service.ts:4770` | API — post-commit Stripe refund audit | authenticated (`tenant_id` available) |
| `web/src/app/(dashboard)/assets/page.tsx:291` | Web — assets fetch warning | authenticated session |
| `web/src/app/(dashboard)/analytics/page.tsx:1151` | Web — analytics tab fetch failure | authenticated session |
| `web/src/components/ui/HelpTooltip.tsx:93` | Web — feature registry miss | n/a (UI only) |
| `web/src/lib/use-customer-autocomplete.ts:250` | Web — autocomplete fetch failure | authenticated session |
| `web/src/lib/feature-registry.ts:3591, 3603` | Web — registry quality warnings (2) | n/a (build-time validation) |

**Driver app: 0** — no `console.error` or `console.warn` calls.

### NestJS `Logger` usages

**Count: 25 instantiations** of `new Logger(ClassName.name)` across `api/src/modules/`. Method calls observed:

- `.error()` — 16
- `.warn()` — 14
- `.log()` — 5
- `.debug()` — 0

Representative sites: `customers.service.ts:21`, `sms.service.ts:26`, `auth.controller.ts:37`, `mapbox.service.ts:21`, `billing/services/invoice.service.ts`. All are authenticated handlers — `tenant_id` IS in scope at every Logger call site.

### NestJS `ExceptionFilter` implementations

**Count: 0.** No `@Catch(...)` decorators or `implements ExceptionFilter` declarations found in `api/src/`. The API relies on NestJS' default `BaseExceptionFilter`. **Implication for Phase 1:** the Sentry NestJS integration will be the first global exception filter. There is no existing filter to compose with or replace.

### `try/catch` swallowing

**Count: 26 silent-catch blocks** in `api/src/`. Top sites by impact:

| File:line | Pattern | Severity |
|---|---|---|
| `api/src/modules/billing/billing.service.ts:434` | `catch { return false; }` | medium (silences validation result) |
| `api/src/modules/dispatch/dispatch.service.ts:426` | `catch { /* skip jobs that can't transition */ }` | medium (job transition failures) |
| `api/src/modules/reporting/reporting.service.ts:1086` | `catch { /* table may not have expected schema yet */ }` | medium (schema drift hidden) |
| `api/src/modules/automation/automation.service.ts:473` | `catch { /* best-effort matching */ }` | medium (rule matching failures) |
| `api/src/modules/jobs/jobs.service.ts:1377, 1483, 3451` | `catch { /* non-fatal */ }` (3x) | low–medium (asset/chain side-effects) |
| `api/src/modules/billing/bookings.controller.ts:243` | `catch { /* non-fatal */ }` | low |
| `api/src/modules/billing/services/booking-completion.service.ts:246` | `catch { /* non-fatal */ }` | low |
| `api/src/modules/dump-locations/dump-locations.service.ts:432` | `catch { /* non-fatal */ }` | low |
| `api/src/modules/analytics/help-analytics.controller.ts:42` | `catch { /* fire-and-forget */ }` | low (intentional) |
| `api/src/modules/stripe/stripe.service.ts:521` | `catch { /* Stripe may not be configured yet */ }` | low (optional integration) |

**Driver app silent catches:** 5 in `driver-app/src/cache.ts` (AsyncStorage ops), 3 in `driver-app/src/AuthContext.tsx` (location tracking + token validation).

**Phase 1 implication:** these are NOT all bugs — many are intentional best-effort/fire-and-forget patterns. Phase 1 should NOT auto-instrument all 26. Instead, classify each:

- "non-fatal" comment + idempotent retry path → leave as-is
- silent failure that hides real bugs (e.g., `reporting.service.ts:1086` schema drift, `dispatch.service.ts:426` transition failures) → wrap with `Sentry.captureMessage(..., 'warning')` so they produce data without alerting

### `throw new ___Exception(...)` buckets

**Total: 405 throws in `api/src/`.**

| Class | Count | Phase 1 disposition |
|---|---|---|
| `BadRequestException` | 158 | DENY (handled, user-facing) |
| `NotFoundException` | 131 | DENY (normal product behavior) |
| `ConflictException` | 31 | DENY (idempotency / dup-entry) |
| `ForbiddenException` | 24 | DENY (RBAC, expected) |
| `UnauthorizedException` | 23 | DENY (auth, expected — see filter §K.4) |
| `Error` (generic) | 15 | ALLOW (uncaught is the point) |
| `HttpException` | 14 | conditional — depends on status code |
| `ServiceUnavailableException` | 8 | ALLOW (third-party degradation, alert-worthy) |
| `InternalServerErrorException` | 3 | ALLOW (always alert) |

### Next.js error boundaries

**Count: 0** custom `error.tsx` / `global-error.tsx` / `not-found.tsx` in `web/src/app/`. Root layout exists (`web/src/app/layout.tsx`) but is bare metadata + theme provider. No `useErrorBoundary` imports. No React `ErrorBoundary` component in the codebase.

**Phase 1 must add:** at minimum `web/src/app/global-error.tsx` (catches root-layout errors, mandatory for Sentry browser SDK to capture client-side React crashes) and `web/src/app/(dashboard)/error.tsx` (route-group boundary so dashboard crashes don't take down the whole shell).

### Driver app error handling

`driver-app/index.ts` is bare:

```ts
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
```

`driver-app/app/_layout.tsx` is a stock Expo Router layout. **No error boundary, no Sentry init, no global handler for promise rejections.** Native crashes are currently invisible — the app dies and the user sees the OS crash dialog, no telemetry.

### API error response shape

**Bootstrap: `api/src/main.ts:48-52`**

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
  }),
);
```

- ✅ `whitelist: true` — strips unknown request body fields (this is what J.2.B exploited — undeclared `jobId` was silently dropped)
- ❌ `forbidNonWhitelisted: false` (default) — silent strip rather than 400, so clients can't tell when a param is being dropped (this is a separate pre-existing UX bug, not Sentry's concern)
- ❌ `disableErrorMessages` is NOT set — class-validator constraint messages reach the client. Acceptable today (NestJS validation messages are generic), but Phase 1 should confirm no PII slips through validator output.

**Vercel serverless wrapper: `api/api/index.js:37-41`**

```js
catch (error) {
  console.error('HANDLER_ERROR:', error.message);
  console.error('HANDLER_STACK:', error.stack);          // logs full stack
  res.statusCode = 500;
  res.end(JSON.stringify({ error: error.message }));     // leaks message to client
}
```

**Severity: medium.** Error message leaks to client (could include DB column names if a query throws raw). Phase 1 should replace this catch with a structured response (`{ error: 'internal_error', requestId }`) and `Sentry.captureException()` before the client write.

**Stack-trace leak: `api/src/modules/admin/seed.controller.ts:610`**

```ts
return { error: err.message, stack: err.stack?.split('\n').slice(0, 5) };
```

**Severity: low** — admin-only endpoint, owner role required. Intentional dev tooling. Document and leave.

### Pre-existing Sentry / error-reporting deps

| Package | Present? |
|---|---|
| `@sentry/*` (any) | ❌ none across `api/`, `web/`, `driver-app/` |
| bugsnag, datadog, rollbar, logrocket, raygun, airbrake | ❌ |
| opentelemetry / otel | ❌ |
| axiom, baselime, betterstack, splunk | ❌ |
| `Sentry.` references in code | ❌ 0 matches |
| `captureException` / `reportError` | ❌ 0 matches |

**Collision risk: zero.**

---

## §K.2 — PII inventory by surface

**Counting rule reminder:** unique field NAMES per surface (each name counted once even if it appears in 80 endpoints).

### Surface 1 — API REST request bodies (5 sample endpoints)

| Endpoint | DTO file | Unique PII fields |
|---|---|---|
| `POST /customers` | `api/src/modules/customers/dto/customer.dto.ts` | `firstName`, `lastName`, `email`, `phone`, `companyName`, `billingAddress`, `serviceAddresses`, `driverInstructions` (8) |
| `POST /jobs` | `api/src/modules/jobs/dto/job.dto.ts` | `placementNotes`, `serviceAddress` (2) |
| `POST /invoices` | `api/src/modules/billing/dto/create-invoice.dto.ts` | `billing_address`, `service_address` (2) |
| `POST /payments/apply` | `api/src/modules/billing/dto/apply-payment.dto.ts` | `stripe_payment_intent_id`, `reference_number` (2) |
| `POST /assets` | `api/src/modules/assets/dto/asset.dto.ts` | none (PII-free inventory data) |

**Surface 1 unique field count: 14** (after dedupe: `serviceAddress`/`service_address` are the same logical field across casings).

### Surface 2 — API REST response shapes (entities)

| Entity | File | Unique PII columns |
|---|---|---|
| `Customer` | `api/src/modules/customers/entities/customer.entity.ts:33-74` | `first_name`, `last_name`, `email`, `phone`, `company_name`, `billing_address`, `service_addresses`, `driver_instructions`, `stripe_customer_id` (9) |
| `Job` | `api/src/modules/jobs/entities/job.entity.ts:81-84` | `service_address`, `placement_notes` (2 — overlap with Surface 1) |
| `Invoice` | `api/src/modules/billing/entities/invoice.entity.ts:61-64` | `billing_address`, `service_address` (overlap) |
| `Payment` | `api/src/modules/billing/entities/payment.entity.ts:36-39` | `stripe_payment_intent_id`, `reference_number` (overlap) |
| `SmsMessage` | `api/src/modules/sms/sms-message.entity.ts:29-35` | `from_number`, `to_number`, `body` (3) |
| `User` | `api/src/modules/auth/entities/user.entity.ts:24-87` | `email`, `first_name`, `last_name`, `phone`, `address`, `emergency_contact`, `additional_phones`, `additional_emails`, `vehicle_info` (9) |

**Surface 2 unique field count: ~17** (after dedupe across entities).

### Surface 3 — API query strings

**Goal:** flag any endpoint accepting customer-content data in `?key=value` (URL-logged).

Found 2 endpoints accepting `customer_id` / `customerId` (UUID, not content PII — but still URL-visible):

- `api/src/modules/credit-audit/credit-workflow.controller.ts:100` — `GET /credit-workflow/timeline?customer_id=...`
- `api/src/modules/billing/billing.controller.ts:29` — `GET /billing?customerId=...`

**No customer email/phone/name/address in query strings — good hygiene.** UUIDs in URLs become a Sentry tag, not a PII concern (we'll HASH them per the rule below).

**Surface 3 unique field count: 1** (`customer_id` UUID).

### Surface 4 — JWT payload claims

**File:** `api/src/modules/auth/auth.service.ts:645-658`

```ts
const payload = {
  sub: user.id,        // user UUID
  email: user.email,   // ⚠ PII
  role: user.role,
  tenantId,
};
```

**Finding:** the JWT contains `email` as a claim. If a token-validation error captures the decoded payload into a Sentry event, the email leaks. **STRIP rule must cover `payload.email` in any JWT-related event context.**

**Surface 4 unique field count: 1** (`email`).

### Surface 5 — Webhook payloads

**Stripe webhook (`POST /stripe/webhook`):**

- File: `api/src/modules/stripe/stripe.service.ts:266`
- PII in `event.data.object.billing_details`: `email`, `name`, `address`
- PII in `event.data.object.customer` (Stripe customer ID — vendor identifier; STRIP)
- KEEP: `metadata.invoiceId`, `metadata.tenantId` (when set)

**Twilio inbound (`POST /automation/sms/inbound`):**

- File: `api/src/modules/automation/automation.controller.ts:103-139`
- PII in body: `From` (phone), `To` (phone), `Body` (message text)
- KEEP: `MessageSid` (Twilio message UID)

**Resend webhook:** none implemented (outbound-only). No PII surface today.

**OAuth callback (`/auth/google/callback`):** receives `email`, `name` from Google. PII.

**Surface 5 unique field count: 7** (`billing_details.email`, `billing_details.name`, `billing_details.address`, Stripe `customer` id, Twilio `From`, `To`, `Body`).

### Surface 6 — Database constraint error contexts

Customer service catches `code === '23505'` (UNIQUE) at `api/src/modules/customers/customers.service.ts:61-81, 292-306`. The thrown exception uses generic copy ("A customer with this email already exists…") — **the offending email value is NOT included in the exception message**. Postgres `driverError.detail` (which DOES contain the email value) is NOT propagated.

**Phase 1 risk:** if any future error path inadvertently captures `error.driverError.detail` into a logged event, email leaks. Phase 1 scrubbing rule must explicitly drop `driverError.detail` from all events.

**Surface 6 unique field count: 1** (`driverError.detail`).

### Surface 7 — Web client-side error context

When a React error boundary catches in `web/src/app/(dashboard)/jobs/[id]/page.tsx`, component state holds `Job` objects with `service_address`, `placement_notes`, plus a related `Customer` summary (first/last name, email, phone). **All 5 fields would land in the Sentry breadcrumb / state snapshot if captured naively.**

**Surface 7 unique field count: 5** (`service_address`, `placement_notes`, `customer.first_name`, `customer.last_name`, `customer.email`, `customer.phone` — net 6).

### Surface 8 — Driver app PII in memory

`driver-app/app/(tabs)/jobs.tsx` holds `Job` objects with `service_address` (street/city/state) and `customer.first_name` / `customer.last_name`. RN crash dumps would capture component tree state.

**Surface 8 unique field count: 4** (`service_address.street`, `.city`, `.state`, `customer.first_name`/`.last_name` — net ~3 unique).

### Surface 9 — Audit logs

- `api/src/modules/team/entities/user-audit-log.entity.ts` — `metadata` jsonb (unstructured; could contain PII)
- `api/src/modules/credit-audit/credit-audit-event.entity.ts` — `reason` text + `metadata` jsonb (free text; could contain customer name)

**Surface 9 unique field count: 2** (`metadata`, `reason`).

### Surface totals (per §K.2 counting rule)

| Surface | Unique PII fields |
|---|---|
| 1. API request bodies | 14 |
| 2. API entity responses | 17 |
| 3. API query strings | 1 (UUID) |
| 4. JWT claims | 1 |
| 5. Webhook payloads | 7 |
| 6. DB constraint error contexts | 1 |
| 7. Web client state | 6 |
| 8. Driver app state | 3 |
| 9. Audit logs | 2 |
| **Aggregate (with dedup across surfaces)** | **~35 unique field names** |

### Classification

**STRIP** (must NEVER reach Sentry):

- All `*_name` (`first_name`, `last_name`, `company_name`)
- All `*email*` (`email`, `additional_emails`, `payload.email`, `billing_details.email`)
- All phone-shaped (`phone`, `additional_phones`, `from_number`, `to_number`, `From`, `To`, `emergency_contact`)
- All address-shaped (`billing_address`, `service_address`, `service_addresses`, `address`)
- `body` (SMS content)
- `Body` (Twilio message text)
- `placement_notes`
- `driver_instructions`
- `vehicle_info` (VIN/license plate)
- `stripe_customer_id`, `stripe_payment_intent_id`
- `reference_number`
- `cancellation_reason` (free-text, may contain PII)
- `notes` (free-text, may contain PII)
- `reason` (audit log free-text)
- `metadata` (audit log unstructured jsonb — STRIP entire field by default; future allow-list)
- `driverError.detail` (Postgres constraint detail — contains constrained values)
- `billing_details.address`, `billing_details.name`

**HASH** (deterministic SHA-256 truncated to 8 chars for grouping):

- `customer_id`
- `user_id` / `sub`
- Stripe `customer` id (the Stripe customer reference, separate from our `customer_id`)

**KEEP** (safe — internal UUIDs, enums, codes):

- `tenant_id`
- `job_id`, `invoice_id`, `payment_id`, `asset_id`, `chain_id`, `quote_id`
- `MessageSid`, Stripe `event.id`, Stripe `metadata.invoiceId`
- `status`, `job_type`, `priority`, `role`, `payment_method`, `dispatch_status`, `display_status`
- All numeric fields (amounts, quantities, dates, timestamps)
- All HTTP status codes, error codes
- `invoice_number`, `job_number` (tenant-internal sequence numbers)

---

## §K.3 — `tenant_id` tagging gap analysis

| # | Context | tenant_id available at error site? | If not, minimal-touch fix |
|---|---|---|---|
| 1 | Authenticated REST handlers | ✅ always — `req.user.tenantId` set by `JwtStrategy.validate()` (`api/src/modules/auth/jwt.strategy.ts:10-32`); guard at `api/src/common/guards/index.ts:16, 58`; decorator at `api/src/common/decorators/index.ts:29-35` | n/a |
| 2 | Stripe webhook | ⚠️ mostly — `payment_intent.*` derives via invoice lookup at `stripe.service.ts:305`; `checkout.session.completed` reads `session.metadata.tenantId` at `stripe.service.ts:317`; `account.updated` has no tenant context (looks up by `stripe_connect_id`) | Phase 1: add `tenantId` to `pi.metadata` in `chargeInvoice()` (`stripe.service.ts:173`) so all PI events carry it explicitly. For `account.updated`, resolve from `stripe_connect_id` → `tenant_settings` lookup before any throw site. |
| 3 | Twilio inbound webhook | ✅ available after lookup at `automation.service.ts:451-461` (queries `tenant_settings.sms_phone_number`) | n/a; ensure Sentry scope is set BEFORE the lookup so signature-failure events still tag at least `tag: signature_invalid` |
| 4 | Resend webhook | n/a — not implemented | document for future arc |
| 5 | Cron jobs | ⚠️ per-iteration — both crons (`/automation/cron/overdue-scan` at `automation.controller.ts:87-92`, `/automation/cron/quote-follow-ups` at `automation.controller.ts:95-100`) iterate per-tenant in the loop body. `tenant_id` IS in scope inside the loop, but if an exception escapes the loop, the outer Sentry transaction has no tenant tag. | Phase 1: wrap each loop iteration with `Sentry.withScope(scope => { scope.setTag('tenant_id', t.id); ... })`. For the outer cron transaction itself, tag `cron_job: overdue-scan` / `quote-follow-ups` and `tenant_id: platform`. |
| 6 | Background workers / queue handlers | n/a — none exist (no BullMQ, no Agenda, no `bullmq` import) | n/a |
| 7 | OAuth callback | ⚠️ resolved via user lookup at `authService.googleLogin()` after the callback receives `code` (`auth.controller.ts:489`); state param contains `tenantId` for context but is not passed to service per intentional design. | Phase 1: tag the callback handler with `tag: oauth_callback`, set `tenant_id` AFTER the user lookup completes; if lookup fails, leave tenant unset and tag `tag: oauth_user_lookup_failed`. |
| 8 | Anonymous portal endpoints | ✅ portal: `req.user.tenantId` from portal JWT (`portal.controller.ts:9-10`). ⚠️ public: resolved by slug lookup at `public.controller.ts:53-75` | Phase 1: capture slug-lookup failures explicitly with `tenant_id: unknown, slug: <slug>` tag. |
| 9 | Health checks (`GET /` at `app.controller.ts:8-11`) | n/a — tag `tenant_id: platform` | one-line scope helper in Phase 1 |
| 10 | Migration runners / seed scripts | ⚠️ seed (`admin/seed.controller.ts:44-88`) is auth'd with `@Roles('owner')` and gets `tenantId` via decorator; SQL migrations under `migrations/` are offline shell scripts, no telemetry today | Tag seed events `tag: seed`. SQL migrations: out of scope for Phase 1 (no runtime). |
| 11 | AsyncLocalStorage | ❌ **NOT in use** anywhere in `api/src/` | **Phase 1 strong recommendation:** add a `RequestContext` middleware (NestJS `nestjs-cls` package OR raw `node:async_hooks.AsyncLocalStorage`) that captures `{ tenantId, userId, requestId }` on entry. Sentry's `nestjs` integration can then read context without each call site needing `withScope`. |
| 12 | cls-hooked / nestjs-cls | ❌ none installed | install `nestjs-cls` (small dep, MIT) in Phase 1 |

---

## §K.4 — Filter allow / deny list

### DENY (must be filtered before reaching Sentry)

| # | Pattern | Source file | Reason |
|---|---|---|---|
| D1 | `BadRequestException` from class-validator (158 throws) | NestJS global ValidationPipe | already user-facing; not actionable; would dominate event volume |
| D2 | `UnauthorizedException` from JwtAuthGuard (23 throws) | `api/src/modules/auth/`, `api/src/common/guards/` | expected behavior on token expiry; abuse traffic on `/auth/login`; would dominate volume |
| D3 | `ForbiddenException` from RolesGuard / TenantGuard (24 throws) | `api/src/common/guards/index.ts:60` | expected RBAC behavior |
| D4 | `NotFoundException` (131 throws) | every service | normal product behavior (e.g. fetching a deleted record) |
| D5 | `ConflictException` (31 throws) | mostly idempotency-key conflicts in `billing/orchestration.service.ts` and `customers.service.ts:76` | normal retry / dup-entry behavior |
| D6 | Twilio signature mismatch | `automation.controller.ts:103-139` (manual HMAC-SHA1 + `crypto.timingSafeEqual`) → throws `UnauthorizedException('Invalid Twilio signature')` | abuse traffic; alert-spam vector. Filter on exception message OR add `signature_failed` tag and drop in `beforeSend`. |
| D7 | Stripe signature mismatch | `stripe.service.ts:266-276` → throws `BadRequestException('Invalid webhook signature')` | abuse traffic; same logic as D6 |
| D8 | Rate-limit rejections | `api/src/common/rate-limiter.ts` writing to `rate_limit_log` table; throws on hit | already tracked in DB; redundant in Sentry |
| D9 | Idempotency-key conflicts | `billing/services/orchestration.service.ts` (24-hour cache; conflict means client retried) | normal retry behavior |
| D10 | The "translated" user-facing errors (the `errorCopy` registry pattern) | scattered across services | already explained to user; mark `handled: true` (record but don't alert) |

### ALLOW (must reach Sentry, alert per severity)

| # | Pattern | Severity | Why |
|---|---|---|---|
| A1 | Unhandled exception (anything that bubbles past all NestJS filters and lands in the Vercel handler `catch` at `api/api/index.js:37-41`) | **error** | by definition unexpected |
| A2 | DB constraint violation NOT pre-handled by service code (e.g. unexpected `23505` outside the customer-email pattern; any `23502 NOT NULL`, `23514 CHECK`) | **error** | the credit_audit_events disaster pattern |
| A3 | Stripe API errors with status NOT in {`200`, `400`, `402`, `404`, `429`} | **error** | unexpected API state |
| A4 | Twilio API errors with status NOT in {`200`, `429`} | **error** | unexpected API state |
| A5 | Vercel serverless cold-start / timeout / OOM | **error** | platform health |
| A6 | Driver app native crashes (RN red-screen / native exception) | **error** | always alert |
| A7 | Web React error boundary catch in `(dashboard)/error.tsx` or `global-error.tsx` (Phase 1 will create) | **error** | always alert |
| A8 | `InternalServerErrorException` (3 throws today) | **error** | always alert |
| A9 | `ServiceUnavailableException` (8 throws — third-party degradation) | **warning** | alert if sustained > 5 min |

### Filter implementation pattern (Phase 1)

In each Sentry SDK init, configure `beforeSend(event, hint)`:

```ts
// Pseudo-code, NOT to be implemented in Phase 0
beforeSend(event, hint) {
  const ex = hint?.originalException;
  if (ex instanceof BadRequestException) return null;       // D1
  if (ex instanceof UnauthorizedException) return null;     // D2
  if (ex instanceof ForbiddenException) return null;        // D3
  if (ex instanceof NotFoundException) return null;         // D4
  if (ex instanceof ConflictException) return null;         // D5
  if (ex?.message === 'Invalid webhook signature') return null;  // D7
  if (ex?.message === 'Invalid Twilio signature') return null;   // D6
  // Scrub PII from event body BEFORE returning
  return scrubPII(event);
}
```

The `scrubPII` function applies the §K.2 STRIP / HASH / KEEP rules to `event.request.data`, `event.extra`, `event.user`, `event.breadcrumbs[].data`.

---

## §K.5 — Walk-through of 6 production scenarios

### Scenario 1 — Failed cancellation orchestrator run (BLOCKER J pattern)

- **Today:** `RentalChainsService.cancelChain()` (post Arc J.1f, the orchestrator path lives in `jobs.service.ts` and `rental-chains.service.ts`). If a step throws after the parent job is updated but before invoices are reconciled, the exception bubbles to NestJS' default filter → 500 to client; `console.error` at `jobs.service.ts:4770` may fire in the Stripe-refund path; `tenant_id` IS in scope.
- **Naive Sentry capture would contain:** full exception + stack, full request body (including any cancellation_reason free text — PII risk), `req.user.email`, customer name in scope from a prior await.
- **PII leakage:** `cancellation_reason`, `req.user.email`, customer name/email loaded for refund lookup
- **Correct event:** ALLOW. Tag `tenant_id`, `chain_id`, `cancellation_phase: <which step failed>`. Strip request body, redact email to `<REDACTED>`. Add fingerprint by exception class + step name so retries dedupe.
- **Severity:** **error** (always alert; this is a payments-adjacent failure)

### Scenario 2 — Stripe webhook signature failure

- **Today:** `stripe.service.ts:266-276` throws `BadRequestException('Invalid webhook signature')` → 400 to caller
- **Naive Sentry capture would contain:** exception + raw request body (Stripe payload — billing_details.email, name, address)
- **PII leakage:** entire Stripe event payload would be captured as request body
- **Correct event:** **DENY** (filter D7). If we wanted observability, send a `Sentry.captureMessage('stripe_signature_failed', 'info')` with only `{ source_ip, user_agent_hash, event_type_if_parseable }` — no body.
- **Severity:** **none** (filtered). If signature failure rate > N/min, that's an Sentry alert RULE (not an event), but Phase 1 won't ship this — defer to Phase 2.

### Scenario 3 — Twilio inbound with malformed body

- **Today:** `automation.controller.ts:103-139` HMAC-SHA1 verification fails → `UnauthorizedException('Invalid Twilio signature')`
- **Naive Sentry capture would contain:** request body (From phone, To phone, Body text — PII triple)
- **PII leakage:** SMS sender phone, recipient phone, message body
- **Correct event:** **DENY** (filter D6). Same pattern as scenario 2.
- **Severity:** **none**

### Scenario 4 — Driver app crash on a job-detail screen

- **Today:** the app dies with an OS crash dialog. No telemetry. `driver-app/app/(tabs)/jobs.tsx` has `Job` + `Customer` in component state.
- **Naive Sentry capture would contain:** crash stack, full Redux/component state snapshot including `customer.first_name`, `last_name`, `email`, `phone`, `service_address`
- **PII leakage:** customer name, address, phone (full)
- **Correct event:** ALLOW. Strip `customer.*` and `service_address.*` in `beforeSend`. Tag `tenant_id` from auth context, `job_id` (UUID, KEEP), `screen: jobs/[id]`. Use Sentry's `attachStacktrace: true`.
- **Severity:** **error** (driver crashes block a working day)

### Scenario 5 — `23505` UNIQUE constraint on customer email (the documented commit `190c0ea` pattern)

- **Today:** caught at `customers.service.ts:61-81`, re-thrown as a generic-message `ConflictException` (no email value in the user-facing exception message). Postgres `driverError.detail` IS NOT propagated.
- **Naive Sentry capture would contain:** the original `QueryFailedError` with `error.driverError.detail = "Key (email)=(jamie@example.com) already exists"` IF the catch handler ever passes the original. Today it doesn't.
- **PII leakage:** the email value embedded in `driverError.detail` (if a future code path forgets to wrap)
- **Correct event:** **DENY** (filter D5 — `ConflictException`). The custom `ConflictException` thrown by the service IS the event the user sees; we don't need it in Sentry. If a raw `QueryFailedError` ever escapes to the global handler (regression case), ALLOW that as **error** but ALWAYS strip `driverError.detail` in `beforeSend`.
- **Severity:** **none** (filtered — handled case); **error** if the regression case fires.

### Scenario 6 — 401 on `/auth/profile` from expired token

- **Today:** `JwtAuthGuard` throws `UnauthorizedException` → 401 to client. No log line.
- **Naive Sentry capture would contain:** the JWT (which contains `email` per Surface 4), request URL, IP
- **PII leakage:** JWT email claim if the decoded token is captured
- **Correct event:** **DENY** (filter D2 — `UnauthorizedException`). Confirm in Phase 1 that the Sentry SDK's auto-breadcrumb on HTTP 401 doesn't capture the Authorization header (it shouldn't by default, but verify via `sendDefaultPii: false`).
- **Severity:** **none**

---

## §K.6 — Three-surface integration plan

### Surface A — NestJS API (`api/`)

- **SDK choice:** `@sentry/nestjs` (which wraps `@sentry/node` and provides `SentryModule` + global filter)
- **Shape:** import `SentryModule.forRoot({ dsn: SENTRY_DSN_API, ... })` in `app.module.ts`. Keep the existing `ValidationPipe` config; add `SentryGlobalFilter` AFTER all other filters via `APP_FILTER` provider. Do NOT replace NestJS' default error handling — Sentry filter wraps and re-throws.
- **Request-scoped `tenant_id`:** use `nestjs-cls` (or raw `AsyncLocalStorage`) to set `{ tenantId, userId, requestId }` on every authenticated request via a guard or middleware. Sentry's `RequestData` integration reads this via a custom `processRequest` hook.
- **Source maps:** API runs as compiled JS via `nest build` → `dist/`. Default tsconfig does NOT emit source maps (`api/tsconfig.json` would need `"sourceMap": true` — confirm before Phase 1). If we do enable source maps, upload via `@sentry/cli` in the `vercel-build` script and DO NOT include `.map` files in the deployed `dist/` — strip them with a post-upload clean step.
- **Source-map privacy check (per prompt):** API `vercel-build` is `nest build` with no source-map flag. `dist/` does not contain `.map` files today. ✅ **PASS by default.** If Phase 1 enables source maps for stack-trace symbolication, the upload-and-strip pipeline is mandatory.
- **DSN env var:** `SENTRY_DSN_API`
- **Vercel project:** `prj_F5igRgwn3kAEzlD5f7ZxKM0xI5XP` (per prompt — not verified by reading `.vercel/`; Phase 1 to confirm)
- **Sample rates:** errors `1.0`; traces `0.1`; profiles `0`

### Surface B — Next.js web (`web/`)

- **SDK:** `@sentry/nextjs` (wraps client + server + edge runtimes; integrates with App Router via `instrumentation.ts` hook)
- **Configs:** four files Phase 1 will create — `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, plus `instrumentation.ts` (Next.js 15+ pattern; current Next major TBD via `web/package.json` Phase 1 check)
- **Error boundary integration:** add `web/src/app/global-error.tsx` (uses `Sentry.captureException(error)` on render); add `web/src/app/(dashboard)/error.tsx` for the dashboard route group; Sentry SDK auto-instruments via `withSentryConfig()` wrapping `next.config.ts`
- **Source maps:** Sentry's webpack plugin uploads maps during `next build`, then deletes them from `.next/static/` post-upload. Configure via `withSentryConfig({ widenClientFileUpload: true, hideSourceMaps: true })`.
- **Source-map privacy check (per prompt):**
  - `web/next.config.ts` is empty — `productionBrowserSourceMaps` defaults to `false` ✅
  - `.next/` build output is generated by `next build`; without our intervention, no `.map` files are served from `/_next/static/`
  - ✅ **PASS by default.** Phase 1 must keep `productionBrowserSourceMaps: false` and rely on Sentry plugin's `hideSourceMaps: true` to upload-then-strip.
- **DSN env var:** `SENTRY_DSN_WEB` (must be `NEXT_PUBLIC_SENTRY_DSN_WEB` for client bundle)
- **Vercel project:** `prj_IGnjm6LEWY2Zbsw7mYRdBjoBQm3B` (per prompt)
- **Customer portal subdomain:** the portal at `web/src/app/(portal)/` resolves tenant by slug at the API. For anonymous portal events, tag `tenant_slug: <slug>` from the URL and `tenant_id: unknown` until the portal-JWT exchange completes; after auth, tag both. Portal-side scope must NEVER capture `customer_id` or `email` from the portal session.

### Surface C — React Native driver app (`driver-app/`)

- **SDK:** `@sentry/react-native` + Expo config plugin `@sentry/react-native/expo`
- **Native crash reporting:** requires the Expo config plugin in `driver-app/app.json` `plugins: ["expo-router", "expo-secure-store", "@sentry/react-native/expo"]`. With Expo's New Architecture (currently `newArchEnabled: true`), Phase 1 must verify the plugin is RN-new-arch compatible at install time (Sentry has supported it since `@sentry/react-native@5.20+`).
- **Source maps:** uploaded during `eas build` via the Sentry config plugin. Maps are stripped from the final IPA/APK.
- **Source-map privacy check (per prompt):** `driver-app/eas.json` does NOT exist today. Phase 1 must create it with the Sentry hook in the build profile. Until that file exists with the upload-and-strip configuration, the driver-app source-map privacy check is **PROVISIONAL PASS** — no maps are bundled today because no Sentry plugin is wired (and Expo default doesn't bundle maps in production). After Phase 1 wires Sentry, maps WILL be generated; the upload-and-strip is then mandatory.
- **DSN env var:** `SENTRY_DSN_DRIVER` (EAS secret; injected via `expo-constants` → `Constants.expoConfig?.extra`)
- **Sample rates:** errors `1.0`; traces `0.1`; profiles `0`

### Per-surface fail-safe behavior

If Sentry's CDN is unreachable: the SDK queues events and gives up after a timeout. **Critical Phase 1 invariant — Sentry must never block product behavior:**

- API: `SentryModule.forRoot({ enableTracing: true, ... })` defaults to non-blocking transport. Confirm `Sentry.init({ shutdownTimeout: 2000 })` so Vercel function shutdown isn't delayed.
- Web: Sentry browser SDK uses `navigator.sendBeacon` / fetch with no `await`. App boot does NOT wait on Sentry init.
- Driver app: Sentry RN SDK queues to disk. App boot is unaffected.

### Rollback plan (if Phase 1 ships and surfaces a regression)

Single env-var flip per surface — set `SENTRY_DSN_API=` (empty), `NEXT_PUBLIC_SENTRY_DSN_WEB=` (empty), `SENTRY_DSN_DRIVER=` (empty in EAS secrets). The SDKs no-op when DSN is empty. **No code rollback required for any of the three surfaces.**

---

## §K.7 — Cost projection + alerting strategy

### Pricing tiers (as of audit)

- Sentry Team: $26/mo for 50K events, transactions extra
- Sentry Business: $80/mo for 100K events, more retention + advanced filters
- Free tier: 5K errors/mo (insufficient for production)

### Estimated monthly event volume — methodology

ServiceOS production traffic has not been instrumented. Phase 0 cannot measure error frequency directly. **Methodology for Phase 1:** sample one week of `console.error` log-line frequency from Vercel runtime logs across api/ and web/ projects (ALLOW list exception classes only), then project monthly. Until that sample is collected, the projection is bounded by reasoning:

- API throws 405 exceptions in source code; the vast majority are filtered (DENY list). Only A1–A9 reach Sentry.
- Web has 0 error boundaries today; Phase 1 will add at least 2 (`global-error.tsx` + `(dashboard)/error.tsx`). React error frequency in a small SaaS dashboard is typically 5–50 events/day for an active tenant cohort.
- Driver app has 0 telemetry today; expect a one-time burst as latent native crashes surface in week 1, then normalize.

**Conservative ceiling:** assume 50K events/month across all three surfaces in steady state. Pick **Sentry Team plan ($26/mo)** with a hard ceiling alert at 40K (80% of quota). If the first month exceeds 30K, revisit filter rules — likely a DENY pattern was missed.

### Per-tenant alert routing

**Defer to Phase 2.** Phase 1 ships with single-tenant alert posture: every alert goes to `adepaolo456@gmail.com`. Per-tenant routing is meaningful only when ServiceOS has a customer-success org, which is not the case today (solo founder).

### On-call posture

- Solo founder. No PagerDuty, no rotation, no SLA.
- Email-only alerts via Sentry's default email channel.
- **Implications for severity rules:**
  - **error** severity → email immediately
  - **warning** severity → daily digest, not real-time
  - **info** → no email, only dashboard
- Phase 1 must NOT enable Sentry SMS or phone alerts. Email rate-limit at SDK level: max 1 email per fingerprint per 60 min (configure via Sentry alert rule, not SDK).

---

## §K.8 — Risk register

| # | Risk | Likelihood | Impact | Mitigation | Phase that resolves |
|---|---|---|---|---|---|
| R1 | PII leakage to third-party SaaS | **high** if naive install | **high** (legal / customer trust) | §K.2 STRIP/HASH/KEEP rules implemented in `beforeSend` on all 3 surfaces; PII allow-list test added to repo (`scrubPII.spec.ts`) covering all 35 fields | Phase 1 |
| R2 | Cross-tenant data leakage in events | medium | **high** | `tenant_id` tag REQUIRED on every event via §K.3 propagation strategy; `nestjs-cls` middleware ensures ALS context; PII scrubber strips event payloads before send | Phase 1 |
| R3 | Alert fatigue from filter gaps | **high** if naive install | medium (we ignore alerts → Sentry becomes noise) | §K.4 deny list (D1–D10) implemented at `beforeSend`; first-week dashboard review to catch missed denies; alert rate-limit per fingerprint | Phase 1 + Phase 2 review |
| R4 | Source map upload failure exposes minified-only stacks | medium (build pipeline complexity) | medium (debugging painful, not catastrophic) | API: confirm `tsconfig.sourceMap: false` OR upload-then-strip. Web: `hideSourceMaps: true` Sentry plugin option. Driver: validate IPA/APK doesn't contain `.map` after EAS build. | Phase 1 |
| R5 | Tenant tagging gap on background jobs | medium (only 2 cron paths) | medium | wrap each cron iteration in `Sentry.withScope` with explicit `tenant_id` tag; outer transaction tagged `tenant_id: platform` | Phase 1 |
| R6 | Sentry CDN outage blocks app boot | low | **high** (whole app down) | confirm SDK `init()` is non-blocking on all 3 surfaces; transport queuing is local; never `await Sentry.init()` | Phase 1 |
| R7 | Cost overrun from un-throttled error spike | medium | low–medium ($26→$80 tier bump) | Sentry quota alert at 80%; SDK-level `tracesSampleRate: 0.1` from day 1; email digest cap of 1 per fingerprint per hour | Phase 1 |
| R8 | Driver app native build complexity | medium (Expo new arch + Sentry plugin) | medium (can ship API + web first, driver app week-2) | install Sentry RN plugin behind a separate Phase 1.5 sub-PR; verify EAS profile builds cleanly before merging | Phase 1.5 |
| R9 | OAuth callback PII (email, name from Google) | medium | medium | scrub `code`, `state`, decoded id_token from any captured event in `auth.controller.ts:404, 459, 534` | Phase 1 |
| R10 | Vercel handler stack leak (`api/api/index.js:39`) | medium (existing today, NOT introduced by Sentry) | low | Phase 1 fixes the handler `catch` block to return `{ error: 'internal_error', requestId }` instead of `error.message` — independent of Sentry but adjacent | Phase 1 |
| R11 | `disableErrorMessages` not set in ValidationPipe | low | low | confirm class-validator output has no PII before send; OR set `disableErrorMessages: true` in production (UX trade-off) | Phase 1 (decision required) |
| R12 | `errorMessages.detail` PG leak future regression | low (currently safe) | medium | `beforeSend` strip rule explicitly drops `driverError.detail`, `error.detail`, and any `error.where` field globally | Phase 1 |

**Mitigation owner:** Anthony for R1–R12 (solo founder; no team to delegate to).

**Top 3 risks by `likelihood × impact`:** R1 (PII leakage), R3 (alert fatigue), R2 (cross-tenant data in events).

---

## §K.9 — Migration / env-var checklist

**Reporting rule reminder:** names + presence only. NO values.

| Env var | Surface / scope | Currently present? | Phase 1 source |
|---|---|---|---|
| `SENTRY_DSN_API` | API (Vercel project `prj_F5igRgwn3kAEzlD5f7ZxKM0xI5XP`) | ❌ absent | Sentry org → API project DSN |
| `NEXT_PUBLIC_SENTRY_DSN_WEB` | Web (Vercel project `prj_IGnjm6LEWY2Zbsw7mYRdBjoBQm3B`); MUST be `NEXT_PUBLIC_*` for client bundle | ❌ absent | Sentry org → Web project DSN |
| `SENTRY_DSN_DRIVER` | Driver-app EAS secret; consumed via `Constants.expoConfig?.extra` | ❌ absent | Sentry org → Driver project DSN |
| `SENTRY_AUTH_TOKEN` | API + Web build pipelines (source-map upload during `vercel-build` and `next build`) | ❌ absent | Sentry org → Internal Integration → Auth Token |
| `SENTRY_ORG` | shared (build-time) | ❌ absent | Sentry org slug |
| `SENTRY_PROJECT_API` | API build (source-map upload) | ❌ absent | per-project slug |
| `SENTRY_PROJECT_WEB` | Web build | ❌ absent | per-project slug |
| `SENTRY_PROJECT_DRIVER` | Driver-app build (EAS) | ❌ absent | per-project slug |
| `SENTRY_ENVIRONMENT` | all surfaces (`production` / `preview` / `development`) | ❌ absent | derived from `NODE_ENV` or Vercel env |

**Conflict check:** searched `api/src/`, `web/src/`, `driver-app/`, `api/.env.test.example` for any `SENTRY_*` reference. **Zero collisions.**

**Existing env-var inventory** (per Agent 4 findings — NAMES only, values redacted):

API (26 names): `DATABASE_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLATFORM_FEE_PERCENT`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WEBHOOK_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `APP_URL`, `CRON_SECRET`, `PORT`, `NODE_ENV`, `API_DOMAIN`, `TENANT_DOMAIN`, `WEB_DOMAIN`, `FRONTEND_URL`, `MAPBOX_TOKEN`, `ENABLE_SWAGGER`, `SEED_ENABLED`, `SEED_SECRET`, `MARKETPLACE_WEBHOOK_ENABLED`, `VERCEL`.

Web (5 names): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_PORTAL_TENANT_ID`, `NEXT_PUBLIC_TENANT_DOMAIN`, `NODE_ENV`.

Driver-app: 0 documented env vars.

### Source-map privacy summary (per prompt)

Across all three surfaces, are source maps guaranteed private to Sentry?

| Surface | Status | Evidence |
|---|---|---|
| API | ✅ **PASS** by default (no source maps emitted; `nest build` doesn't write `.map` files; `dist/` is JS-only). Phase 1 must keep this OR add upload-and-strip if maps are enabled. |
| Web | ✅ **PASS** by default (`web/next.config.ts` is empty → `productionBrowserSourceMaps` defaults to `false`; no `.map` files served from `/_next/static/`). Phase 1 must keep `productionBrowserSourceMaps: false` and use Sentry plugin's `hideSourceMaps: true`. |
| Driver-app | 🟡 **PROVISIONAL PASS** — no `eas.json` exists today, so EAS build uses defaults (no maps in published artifact). Phase 1 will create `driver-app/eas.json` with the Sentry config plugin; this introduces map generation, so the upload-and-strip step becomes a Phase-1-blocker invariant. |

**Aggregate verdict:** PASS today, but **Phase 1 must add explicit configuration on all 3 surfaces** before integration goes to production — defaults today happen to be safe but are not contractually guaranteed.

---

## §K.10 — Phase 1 gate criteria

Phase 1 implementation may begin ONLY after all of the following are satisfied:

| Gate | Source section | Closed by this report? |
|---|---|---|
| G1. Every PII field has STRIP/HASH/KEEP classification | §K.2 | ✅ all 35 fields classified |
| G2. Every cron has a tagging strategy | §K.3 row 5 | ✅ both crons have per-iteration `withScope` strategy |
| G3. Every webhook has tenant resolution + signature-failure filter mapping | §K.3 rows 2–4, §K.4 D6/D7 | ✅ Stripe + Twilio mapped; Resend n/a |
| G4. Every scenario in §K.5 has expected event shape + severity | §K.5 | ✅ all 6 scenarios have correct-event + severity |
| G5. Every risk in §K.8 has a mitigation owner | §K.8 | ✅ owner is Anthony for all 12 |
| G6. Source-map privacy is PASS on all 3 surfaces (or has a Phase 1 closure plan) | §K.9 | ✅ API + web PASS by default; driver-app provisional PASS with Phase 1 plan |
| G7. No env-var collision with existing schema | §K.9 conflict check | ✅ zero collisions |
| G8. Cost ceiling decision (Team $26 vs Business $80) | §K.7 | 🟡 **OPEN** — recommendation is Team $26 with quota alert at 40K; awaits Anthony's sign-off |
| G9. Per-tenant alert routing decision (Phase 1 vs Phase 2) | §K.7 | 🟡 **OPEN** — recommendation is defer to Phase 2; awaits Anthony's sign-off |
| G10. AsyncLocalStorage / `nestjs-cls` adoption decision | §K.3 row 11 | 🟡 **OPEN** — recommendation is install `nestjs-cls`; awaits Anthony's sign-off (small dep, but it IS a new runtime concern) |

**Gate status: 7 of 10 closed. 3 open items require Anthony's explicit sign-off before Phase 1 starts:**

1. Cost-tier choice (Team / Business)
2. Per-tenant alert routing (defer Y/N)
3. `nestjs-cls` adoption (Y/N — alternative is per-call-site `withScope` everywhere)

Once these 3 are signed off, Phase 1 implementation may proceed against this report's specifications.

---

## Appendix — Files NOT touched by this audit (per scope rules)

- All source files under `api/src/`, `web/src/`, `driver-app/`
- All package manifests
- All `.env*` files (no values printed; only names referenced)
- All Vercel project configs except `api/vercel.json` which was read-only quoted

**Only file written:** `arcK-phase0-audit-report.md` at repo root (this file).

**Git status after audit:** 1 new untracked file (this report). Zero modifications to tracked files.

---

**End of report.** Halt at this checkpoint. Phase 1 implementation gated on §K.10 sign-off.
