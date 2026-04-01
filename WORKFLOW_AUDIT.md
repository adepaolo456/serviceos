# ServiceOS Workflow Audit

> Generated 2026-03-31 — READ-ONLY audit, no files modified.

---

## Table of Contents

1. [Directory Trees](#1-directory-trees)
2. [Workflow 1: Job Lifecycle](#2-workflow-1-job-lifecycle)
3. [Workflow 2: Dispatch → Driver Handoff](#3-workflow-2-dispatch--driver-handoff)
4. [Workflow 3: Tenant Website → Booking → Job](#4-workflow-3-tenant-website--booking--job)
5. [Workflow 4: Invoice → Payment via Portal](#5-workflow-4-invoice--payment-via-portal)
6. [Workflow 5: Asset Status Tracking](#6-workflow-5-asset-status-tracking)
7. [Broken Imports & Missing Endpoints](#7-broken-imports--missing-endpoints)
8. [Cross-Cutting Issues](#8-cross-cutting-issues)
9. [Summary Scoreboard](#9-summary-scoreboard)

---

## 1. Directory Trees

### api/src

```
api/src/
├── main.ts
├── app.module.ts
├── app.controller.ts
├── app.service.ts
├── app.controller.spec.ts
├── common/
│   ├── decorators/index.ts
│   └── guards/index.ts
└── modules/
    ├── admin/
    │   ├── admin.controller.ts
    │   ├── admin.guard.ts
    │   ├── admin.module.ts
    │   ├── admin.service.ts
    │   └── seed.controller.ts
    ├── analytics/
    │   ├── analytics.controller.ts
    │   ├── analytics.module.ts
    │   ├── analytics.service.ts
    │   └── dto/analytics.dto.ts
    ├── assets/
    │   ├── assets.controller.ts
    │   ├── assets.module.ts
    │   ├── assets.service.ts
    │   ├── dto/asset.dto.ts
    │   └── entities/asset.entity.ts
    ├── auth/
    │   ├── auth.controller.ts
    │   ├── auth.module.ts
    │   ├── auth.service.ts
    │   ├── jwt.strategy.ts
    │   ├── google.strategy.ts
    │   ├── dto/auth.dto.ts
    │   └── entities/user.entity.ts
    ├── automation/
    │   ├── automation.controller.ts
    │   ├── automation.module.ts
    │   ├── automation.service.ts
    │   └── entities/automation-log.entity.ts
    ├── billing/
    │   ├── billing.controller.ts
    │   ├── billing.module.ts
    │   ├── billing.service.ts
    │   ├── billing.utils.ts
    │   ├── bookings.controller.ts
    │   ├── dto/billing.dto.ts
    │   └── entities/
    │       ├── invoice.entity.ts
    │       └── payment.entity.ts
    ├── customers/
    │   ├── customers.controller.ts
    │   ├── customers.module.ts
    │   ├── customers.service.ts
    │   ├── dto/customer.dto.ts
    │   └── entities/customer.entity.ts
    ├── demos/
    │   ├── demo-request.entity.ts
    │   ├── demos.controller.ts
    │   └── demos.module.ts
    ├── dispatch/
    │   ├── dispatch.controller.ts
    │   ├── dispatch.module.ts
    │   ├── dispatch.service.ts
    │   ├── dto/dispatch.dto.ts
    │   └── entities/route.entity.ts
    ├── driver/
    │   ├── driver.controller.ts
    │   └── driver.module.ts
    ├── dump-locations/
    │   ├── dump-locations.controller.ts
    │   ├── dump-locations.module.ts
    │   ├── dump-locations.service.ts
    │   └── entities/
    │       ├── dump-location.entity.ts
    │       └── dump-ticket.entity.ts
    ├── jobs/
    │   ├── jobs.controller.ts
    │   ├── jobs.module.ts
    │   ├── jobs.service.ts
    │   ├── dto/job.dto.ts
    │   └── entities/job.entity.ts
    ├── marketplace/
    │   ├── marketplace.controller.ts
    │   ├── marketplace.module.ts
    │   ├── marketplace.service.ts
    │   ├── dto/marketplace.dto.ts
    │   └── entities/marketplace-booking.entity.ts
    ├── notes/
    │   ├── note.entity.ts
    │   ├── notes.controller.ts
    │   └── notes.module.ts
    ├── notifications/
    │   ├── notifications.controller.ts
    │   ├── notifications.module.ts
    │   ├── notifications.service.ts
    │   ├── dto/notifications.dto.ts
    │   └── entities/notification.entity.ts
    ├── portal/
    │   ├── portal.controller.ts
    │   ├── portal-auth.controller.ts
    │   ├── portal.module.ts
    │   ├── portal.service.ts
    │   ├── portal.dto.ts
    │   ├── portal.guard.ts
    │   └── portal-jwt.strategy.ts
    ├── pricing/
    │   ├── pricing.controller.ts
    │   ├── pricing.module.ts
    │   ├── pricing.service.ts
    │   ├── pricing.utils.ts
    │   ├── dto/pricing.dto.ts
    │   └── entities/
    │       ├── pricing-rule.entity.ts
    │       ├── delivery-zone.entity.ts
    │       └── pricing-template.entity.ts
    ├── public/
    │   ├── public.controller.ts
    │   ├── public.module.ts
    │   └── public.service.ts
    ├── quotes/
    │   ├── quote.entity.ts
    │   ├── quotes.controller.ts
    │   └── quotes.module.ts
    ├── reporting/
    │   ├── reporting.controller.ts
    │   ├── reporting.module.ts
    │   └── reporting.service.ts
    ├── stripe/
    │   ├── stripe.controller.ts
    │   ├── stripe.module.ts
    │   └── stripe.service.ts
    ├── subscriptions/
    │   ├── subscriptions.controller.ts
    │   ├── subscriptions.module.ts
    │   ├── subscriptions.service.ts
    │   └── entities/subscription-plan.entity.ts
    ├── team/
    │   ├── team.controller.ts
    │   ├── team.module.ts
    │   └── time-entry.entity.ts
    ├── tenants/
    │   └── entities/tenant.entity.ts
    └── yards/
        ├── yards.controller.ts
        ├── yards.module.ts
        └── yard.entity.ts
```

### web/src

```
web/src/
├── middleware.ts
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── favicon.ico
│   ├── login/page.tsx
│   ├── register/page.tsx
│   ├── demo/page.tsx
│   ├── auth/callback/page.tsx
│   ├── onboarding/
│   │   ├── layout.tsx
│   │   └── plan/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # Home/dashboard
│   │   ├── jobs/page.tsx
│   │   ├── jobs/[id]/page.tsx
│   │   ├── customers/page.tsx
│   │   ├── customers/[id]/page.tsx
│   │   ├── dispatch/page.tsx
│   │   ├── invoices/page.tsx
│   │   ├── invoices/[id]/page.tsx
│   │   ├── assets/page.tsx
│   │   ├── vehicles/page.tsx
│   │   ├── vehicles/[id]/page.tsx
│   │   ├── team/page.tsx
│   │   ├── team/[id]/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── pricing/page.tsx
│   │   ├── analytics/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── marketplace/page.tsx
│   │   ├── dump-locations/page.tsx
│   │   └── book/page.tsx
│   ├── (portal)/
│   │   ├── layout.tsx
│   │   └── portal/
│   │       ├── page.tsx                # Portal home
│   │       ├── login/page.tsx
│   │       ├── invoices/page.tsx
│   │       ├── rentals/page.tsx
│   │       ├── profile/page.tsx
│   │       └── request/page.tsx
│   ├── admin/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── tenants/page.tsx
│   │   ├── tenants/[id]/page.tsx
│   │   ├── demos/page.tsx
│   │   └── subscriptions/page.tsx
│   └── site/
│       ├── layout.tsx
│       ├── tenant-context.tsx
│       ├── page.tsx                    # Tenant website home
│       ├── book/page.tsx               # Public booking wizard
│       └── confirmation/page.tsx
├── components/
│   ├── sidebar.tsx
│   ├── sidebar-context.tsx
│   ├── notification-bell.tsx
│   ├── quick-view.tsx
│   ├── address-autocomplete.tsx
│   ├── skeletons.tsx
│   ├── dropdown.tsx
│   ├── slide-over.tsx
│   ├── keyboard-shortcuts.tsx
│   ├── theme-provider.tsx
│   └── toast.tsx
└── lib/
    ├── api.ts                          # Dashboard API client
    ├── portal-api.ts                   # Portal API client
    ├── use-modules.ts
    └── utils.ts
```

---

## 2. Workflow 1: Job Lifecycle

**Flow: Create → Schedule → Dispatch → Driver Completes → Invoice → Payment**

### 2.1 Create — COMPLETE

| Item | Status | Details |
|------|--------|---------|
| `POST /jobs` | Exists | Creates job with auto-generated number (`JOB-YYYYMMDD-NNN`) |
| Auto-pricing | Exists | Looks up `PricingRule` by asset subtype, applies customer discount |
| Auto-booking invoice | Exists | Creates a `paid` invoice for delivery jobs with a price |
| Frontend create form | Exists | SlideOver panel on `/jobs` page |
| Entity fields | Complete | `status: 'pending'`, all pricing/scheduling/address fields |

### 2.2 Schedule — MOSTLY COMPLETE

| Item | Status | Details |
|------|--------|---------|
| `PATCH /jobs/:id/reschedule` | Exists | Tracks reason, old date, updates linked pickups |
| `POST /jobs/:id/schedule-next` | Exists | Creates child jobs (pickup, exchange, dump-and-return) |
| `GET /jobs/calendar` | Exists | Returns jobs by date range |
| Frontend calendar view | **MISSING** | No calendar page; dispatch page partially covers this |
| Frontend reschedule/schedule-next UI | **MISSING** | Endpoints exist but no buttons/forms in job detail page |

### 2.3 Dispatch — MOSTLY COMPLETE

| Item | Status | Details |
|------|--------|---------|
| `GET /dispatch/board` | Exists | Full board with drivers, their jobs, unassigned pool |
| `PATCH /jobs/:id/assign` | Exists | Auto-transitions `pending` → `confirmed` on driver assignment |
| `POST /routes` / `PATCH /routes/:id/reorder` | Exists | Route creation and reordering |
| Frontend dispatch board | Exists | Full DnD Kanban with Mapbox map, auto-refresh, search/filters |
| Route lifecycle management | **MISSING** | Route never transitions to `active`/`completed`; `actual_start_time`/`actual_end_time` never set |
| Route optimization | **MISSING** | "Optimize Routes" button renders but has no `onClick` handler |

### 2.4 Driver Completes — MOSTLY COMPLETE

| Item | Status | Details |
|------|--------|---------|
| `PATCH /driver/jobs/:id/status` | Exists | Handles en_route → arrived → in_progress → completed/failed |
| `PATCH /driver/jobs/:id/photos` | Exists | Appends photos to job |
| `PATCH /driver/jobs/:id/stage-at-yard` | Exists | Marks container as `full_staged` at yard |
| Failed trip automation | Exists | Creates replacement job + failure charge invoice |
| Pickup completion invoice | Exists | Auto-generates final charges (extra days, disposal) |
| Driver mobile app/UI | **MISSING** | API endpoints exist but no frontend consumer |
| Dump slip submission endpoint | **MISSING** | `dump_*` entity fields exist but no `PATCH /driver/jobs/:id/dump-slip` |
| Customer notifications | **STUB ONLY** | `en_route` notification is `console.log`; no SMS/email |

### 2.5 Invoice — INCOMPLETE

| Item | Status | Details |
|------|--------|---------|
| `POST /invoices/from-job/:jobId` | Exists | Generates invoice from completed job |
| `POST /invoices/:id/send` | Exists | Transitions draft → sent (status flag only) |
| Invoice list + detail frontend | Exists | Full UI with status tabs, line items, send/void buttons |
| Email delivery on send | **MISSING** | Just a status flag update, no email |
| Overdue detection | **MISSING** | `overdue` status never auto-set; no cron/scheduler |
| `viewed_at` tracking | **MISSING** | Field exists, nothing sets it |
| Consistent creation pattern | **BROKEN** | Invoices created via BillingService, JobsService inline, AND raw SQL — 3 different patterns |
| `billing.utils.ts` helper | **UNUSED** | Written but never wired into any service |

### 2.6 Payment — INCOMPLETE

| Item | Status | Details |
|------|--------|---------|
| `POST /payments` (manual) | Exists | Records payment, updates invoice balance, transitions to `paid` |
| `POST /stripe/charge-invoice/:invoiceId` | Exists | Charges saved card via Stripe Connect with platform fee |
| `POST /stripe/refund/:invoiceId` | Exists | Full and partial refunds |
| Stripe webhooks | Exists | Handles `payment_intent.succeeded` / `payment_intent.payment_failed` |
| Frontend record payment form | Exists | On invoice detail page |
| Stripe charges → Payment records | **MISSING** | `chargeInvoice()` updates invoice but does NOT create a `Payment` record |
| Refund records | **MISSING** | Refunds update invoice only, not payments table |
| Receipt/confirmation email | **MISSING** | No post-payment notification |
| Partial payment (Stripe) | **MISSING** | Only manual `createPayment` supports partial; Stripe path does not |

---

## 3. Workflow 2: Dispatch → Driver Handoff

**Flow: Kanban assign → driver app receives → status updates sync**

### 3.1 Kanban Assignment — COMPLETE

| Item | Status | Details |
|------|--------|---------|
| Drag-and-drop assignment | Exists | Cross-column moves with optimistic UI and rollback |
| Job reordering | Exists | `PATCH /jobs/bulk-reorder` for same-column reorder |
| Route creation/reorder | Exists | API endpoints wired, but decoupled from job assignment |
| Driver column collapse | Exists | Preferences persisted to server |
| Map overlay | Exists | Mapbox GL with job pins |

### 3.2 Driver Receives Assignments — MISSING

| Item | Status | Details |
|------|--------|---------|
| `GET /driver/today` | Exists | Returns today's jobs ordered by route_order |
| `GET /driver/jobs` | Exists | Filtered list with pagination |
| Push notifications on assignment | **MISSING** | No WebSocket, SSE, FCM, or push integration |
| "Send Routes to Drivers" button | **DEAD UI** | Button renders, no `onClick` handler |
| `dispatched` status transition | **MISSING** | `VALID_TRANSITIONS` defines `confirmed → dispatched` but nothing triggers it |
| Driver mobile app | **MISSING** | No frontend exists for driver endpoints |

### 3.3 Status Updates Sync — PARTIALLY COMPLETE

| Item | Status | Details |
|------|--------|---------|
| Driver status update API | Exists | `PATCH /driver/jobs/:id/status` for en_route/arrived/in_progress/completed/failed |
| Dispatch board polling | Exists | 30-second `setInterval` refresh |
| Real-time sync (WebSocket/SSE) | **MISSING** | Status changes only visible after next poll |
| Duplicate logic | **BUG** | Driver controller has inline status logic that bypasses `VALID_TRANSITIONS`, `AutomationLog`, and pickup-completion invoice creation in `JobsService.changeStatus()` |
| GPS/location tracking | **MISSING** | No endpoints for driver location or ETA |
| Customer "on the way" notification | **STUB** | `console.log` placeholder; `on_the_way` template exists but is never used |

---

## 4. Workflow 3: Tenant Website → Booking → Job

**Flow: Tenant site loads → customer browses services → books → job auto-created**

### 4.1 Tenant Site Resolution — EXISTS (limited)

| Item | Status | Details |
|------|--------|---------|
| `GET /public/tenant/:slug` | Exists | Returns tenant branding, checks `is_active` and `website_enabled` |
| Query-param routing | Exists | `/site?slug=xxx` pattern |
| Subdomain routing | **MISSING** | No `acme.serviceos.com` style; only `?slug=` query param |

### 4.2 Service Display — COMPLETE

| Item | Status | Details |
|------|--------|---------|
| `GET /public/tenant/:slug/services` | Exists | Returns pricing rules grouped by service type |
| Frontend service cards | Exists | Displays base price, rental days, delivery fee |

### 4.3 Public Booking — CRITICALLY BROKEN

| Item | Status | Details |
|------|--------|---------|
| `POST /public/tenant/:slug/booking` | Exists | Creates customer + job + invoice in one call |
| **Frontend ↔ API field mismatch** | **CRITICAL** | Frontend sends `deliveryDate`, backend reads `scheduledDate`; frontend sends `address`, backend reads `serviceAddress`; frontend sends `serviceId`, backend reads `assetSubtype`/`serviceType` — **jobs created with null dates and addresses** |
| Payment processing | **MISSING** | Invoice marked `paid` with `payment_method: 'card'` but no Stripe integration; money never collected |
| Confirmation email | **MISSING** | UI says "You'll receive a confirmation email shortly" — no email sent |
| Availability check | **MISSING** | Can overbook assets (dashboard flow checks availability; public flow does not) |
| Pickup job creation | **MISSING** | Only delivery job created; dashboard flow creates both |
| Asset assignment | **MISSING** | Dashboard flow auto-assigns; public flow does not |
| DTO validation | **MISSING** | Body is `Record<string, unknown>` — no class-validator decorators |
| Transaction safety | **MISSING** | Customer + Job + Invoice creation not wrapped in DB transaction |

### 4.4 Dashboard Booking — MOSTLY COMPLETE

| Item | Status | Details |
|------|--------|---------|
| `POST /bookings/complete` | Exists | Auto-assigns asset, creates delivery + pickup jobs, creates invoice |
| `POST /pricing/calculate` | Exists | Live pricing calculator |
| `GET /assets/availability` | Exists | Projected availability by date |
| Frontend 4-step wizard | Exists | Quote → Customer → Schedule → Confirm |
| Stripe payment processing | **TODO** | Explicit `// TODO: Process Stripe payment if card` in code |
| Confirmation email | **TODO** | Explicit `// TODO: Send confirmation email` in code |

### 4.5 Marketplace Booking — INCOMPLETE

| Item | Status | Details |
|------|--------|---------|
| `POST /marketplace/bookings` (webhook) | Exists | Receives external bookings |
| `PATCH /marketplace/bookings/:id/accept` | Exists | Creates customer + job on accept |
| `GET /marketplace/availability` / `pricing` | Exists | Public availability and pricing endpoints |
| Dashboard UI for marketplace | **PLACEHOLDER** | Page shows "Coming soon" only |
| Invoice on accept | **MISSING** | Job created but no invoice |
| Notification on new booking | **MISSING** | No alert to tenant |
| Webhook callback | **MISSING** | No callback to marketplace on accept/reject |

### 4.6 Quotes → Booking — INCOMPLETE

| Item | Status | Details |
|------|--------|---------|
| `POST /quotes` | Exists | Creates a quote |
| `POST /quotes/:id/send-email` | **STUB** | Logs email, doesn't send it |
| `GET /quotes/:id/book` | Exists | Validates quote for booking |
| Quote → Job conversion | **MISSING** | Validation endpoint exists but no actual conversion logic; `booked_job_id` field never populated |

---

## 5. Workflow 4: Invoice → Payment via Portal

**Flow: Customer logs in → views invoices → pays**

### 5.1 Portal Authentication — COMPLETE

| Item | Status | Details |
|------|--------|---------|
| `POST /portal/auth/login` | Exists | Email/password with bcrypt, returns JWT (7-day expiry) |
| `POST /portal/auth/register` | Exists | Sets password on existing customer record |
| `PortalAuthGuard` + `PortalJwtStrategy` | Exists | Validates `type: 'portal'` in JWT payload |
| Frontend login page | Exists | Email/password form with error handling |
| Magic link auth | **STUB** | Returns canned message; no email sent, no verification endpoint |

### 5.2 Invoice Viewing — MOSTLY COMPLETE

| Item | Status | Details |
|------|--------|---------|
| `GET /portal/invoices` | Exists | Lists invoices for logged-in customer |
| `GET /portal/invoices/:id` | Exists | Returns invoice + associated payments |
| Frontend invoice list | Exists | Shows number, status, due date, total, balance due |
| Invoice detail view | Exists | Shows line items and summary |
| Payment history display | **NOT FETCHED** | Detail view uses list data, never calls `GET /portal/invoices/:id` — payment history invisible |
| Invoice PDF download | **MISSING** | Common expectation, not implemented |

### 5.3 Payment — COMPLETELY UNIMPLEMENTED

| Item | Status | Details |
|------|--------|---------|
| "Pay" button | **DEAD UI** | Button renders with amount but has no `onClick` handler |
| Portal payment endpoint | **MISSING** | No `POST /portal/invoices/:id/pay` or Checkout Session creation |
| Stripe.js frontend integration | **MISSING** | No `@stripe/stripe-js` or `@stripe/react-stripe-js` in portal |
| Card saving flow for customers | **MISSING** | `createSetupIntent()` exists but behind admin auth only |
| Payment confirmation | **MISSING** | No email/notification after payment |

### 5.4 Other Portal Features

| Item | Status | Details |
|------|--------|---------|
| Rental management | Exists | List, extend, early-pickup, reschedule endpoints + UI |
| Profile management | Exists | View/edit profile, change password |
| Agreement signing | Exists | `POST /portal/agreements/:jobId/sign` |
| Notification preferences | **DEAD UI** | Checkboxes exist, "Save" button has no handler, no backend endpoint |
| Extend/Early Pickup on home | **DEAD UI** | Buttons on portal home page have no `onClick` handlers |

---

## 6. Workflow 5: Asset Status Tracking

**Flow: Available → Reserved → In-Transit → Deployed/On-Site → Returned/Available**

### 6.1 Asset Entity

| Field | Purpose | Auto-Updated? |
|-------|---------|---------------|
| `status` | Current state (available, on_site, in_transit, maintenance, retired, reserved, deployed) | **NO** — only `stageAtYard` sets `full_staged` |
| `current_job_id` | Active job FK | **NO** — only set by `createDumpRun` |
| `current_location_type` | yard / customer_site / in_transit | **NO** — only set by `stageAtYard` |
| `needs_dump` | Container needs emptying | **NO** — only set by `stageAtYard` |
| `staged_at`, `staged_from_job_id`, `staged_waste_type` | Yard staging metadata | Yes (via `stageAtYard`) |

### 6.2 What Exists

| Item | Status | Details |
|------|--------|---------|
| Asset CRUD | Exists | Full create/read/update/delete with status filtering |
| Manual status update | Exists | `PATCH /assets/:id` accepts any status |
| `stageAtYard` | Exists | Correctly sets `full_staged` with yard metadata |
| Availability projection | Exists | `GET /assets/availability` estimates future counts from job data |
| Utilization stats | Exists | `GET /assets/utilization` groups by current status |
| Frontend asset grid | Exists | Lists assets with status badges, inline create/edit |

### 6.3 What's MISSING — The Core Lifecycle Is Manual-Only

| Expected Automation | Status | Impact |
|---------------------|--------|--------|
| Asset → `reserved` when assigned to job | **MISSING** | Same asset can be assigned to multiple jobs |
| Asset → `in_transit` when delivery dispatched/en_route | **MISSING** | Status stays `available` during delivery |
| Asset → `deployed`/`on_site` when delivery completed | **MISSING** | Asset still shows `available` while at customer site |
| Asset → `available` when pickup completed | **MISSING** | Asset stays in previous status after return |
| Asset status revert on job cancellation | **MISSING** | Cancelled jobs leave asset in wrong state |
| Asset status revert on job failure | **MISSING** | Failed jobs don't touch asset |
| Exchange: old asset → available, new asset → deployed | **MISSING** | Neither asset updated |
| Dump run completion → assets `available` | **MISSING** | Assets stay `full_staged` after dump |
| `current_job_id` set on delivery | **MISSING** | Only set by `createDumpRun` |
| Double-booking prevention | **MISSING** | `findAvailable` returns assets already assigned to active jobs |

### 6.4 Additional Issues

- `full_staged` is set in code but not listed in the DTO `@IsIn` validator — cannot be filtered via normal CRUD
- `current_location_type` never updated to `customer_site` on delivery or back to `yard` on pickup
- Yards module provides CRUD but has no FK link to asset location tracking
- Frontend derives deployed info from `asset.metadata` fields that the backend never populates

---

## 7. Broken Imports & Missing Endpoints

### 7.1 Frontend Calling Missing API Endpoints

| Frontend Page | Call | Issue |
|---------------|------|-------|
| `/jobs/[id]/page.tsx` | `DELETE /jobs/:id` | **No `@Delete()` endpoint exists in `jobs.controller.ts`** — "Delete Job" button always returns 404 |

### 7.2 Broken TypeScript Imports

**None found.** All `@/lib/*` and `@/components/*` imports resolve to existing files with matching exports.

### 7.3 Notable Unused API Endpoints (no frontend consumer)

These exist in API controllers but are never called from any frontend page:

| Category | Endpoints |
|----------|-----------|
| Driver app | `GET /driver/today`, `GET /driver/jobs`, `PATCH /driver/jobs/:id/status`, `/photos`, `/stage-at-yard` |
| Notifications | `POST /notifications/send`, `GET /notifications/templates`, `GET /notifications` |
| Route management | `POST /routes`, `GET /routes/:id`, `PATCH /routes/:id/reorder` |
| Dispatch | `GET /dispatch/unassigned` |
| Jobs | `GET /jobs/unassigned`, `GET /jobs/calendar`, `POST /jobs/:id/schedule-next`, `POST /jobs/dump-run`, `PATCH /jobs/:id/stage-at-yard` |
| Portal (called but not all) | `GET /portal/invoices/:id`, `POST /portal/request`, extend/early-pickup/sign endpoints |
| Marketplace | All endpoints — frontend page is "Coming soon" placeholder |
| Quotes | `POST /quotes/:id/send-email`, `GET /quotes/:id/book` |
| Team | `GET /team/locations`, clock-in/out, timesheet approve/export |
| Assets | `GET /assets/available/:type`, `GET /assets/utilization`, `GET /assets/:id`, `DELETE /assets/:id` |
| Pricing templates | All CRUD endpoints |

---

## 8. Cross-Cutting Issues

### 8.1 No Event Bus / Domain Events
Status transitions trigger inline side effects (invoice creation, replacement jobs) rather than publishing events. This makes workflows brittle and hard to extend.

### 8.2 No Notification Delivery System
- `NotificationsService` queues to DB with `status: 'queued'` but no background worker ever delivers them
- `en_route` SMS is `console.log`
- Invoice `sent` does not email
- Payment confirmation does not notify
- Entity has `overdue_notified_at` and `overdue_notification_count` but nothing populates them

### 8.3 No Background Job Processing
Required for: overdue invoice detection, rental expiry monitoring, notification delivery, dump run scheduling. None exist.

### 8.4 Inconsistent Invoice Creation
Three patterns coexist:
1. `BillingService.createInvoice()` — proper service method
2. `JobsService` inline via `this.invoiceRepository.save()` — bypasses billing logic
3. `JobsService` raw SQL `this.jobsRepository.query('INSERT INTO invoices...')` — bypasses TypeORM entirely

`billing.utils.ts` provides a standalone helper that is never used by any service.

### 8.5 Driver Controller Duplicates JobsService Logic
`PATCH /driver/jobs/:id/status` has inline status-update logic that:
- Does NOT enforce `VALID_TRANSITIONS` (driver could jump from `pending` to `completed`)
- Does NOT log to `AutomationLog`
- Does NOT create pickup-completion invoices
- Does NOT handle `cancelled` status

### 8.6 No Transaction Wrapping
Multi-entity operations (customer + job + invoice creation in public booking, marketplace accept, etc.) are not wrapped in DB transactions. Partial failures leave orphaned records.

---

## 9. Summary Scoreboard

| Workflow | Rating | Key Blocker |
|----------|--------|-------------|
| **Job Create** | COMPLETE | — |
| **Job Schedule** | 75% | No calendar UI, no reschedule/schedule-next frontend actions |
| **Job Dispatch** | 80% | Route lifecycle unmanaged, optimize button is dead |
| **Driver Completes** | 70% | No driver app, no real notifications, duplicate logic |
| **Invoice** | 60% | No email sending, no overdue cron, scattered creation |
| **Payment** | 50% | Stripe payments skip Payment table, no receipts |
| **Dispatch → Driver Handoff** | 40% | No push notifications, no `dispatched` transition, no driver UI, "Send Routes" is dead button |
| **Tenant Website → Booking** | 30% | **CRITICAL: field name mismatch creates broken jobs**, no payment, no email, no availability check |
| **Portal → Payment** | 20% | **Pay button is a no-op**, no Stripe frontend, no portal payment endpoint |
| **Asset Tracking** | 15% | **Entire auto-lifecycle is missing** — all status transitions are manual only |

### Critical Issues (must fix)

1. **Public booking field mismatch** — `deliveryDate`/`address`/`serviceId` vs `scheduledDate`/`serviceAddress`/`assetSubtype` — creates jobs with null dates/addresses
2. **Portal "Pay" button is dead** — no `onClick`, no portal payment endpoint, no Stripe.js
3. **`DELETE /jobs/:id` returns 404** — frontend calls it but no API endpoint exists
4. **Asset double-booking** — no reservation on assignment; `findAvailable` returns already-assigned assets
5. **Driver controller bypasses VALID_TRANSITIONS** — drivers can make invalid status jumps
6. **Stripe payments don't create Payment records** — payment history is incomplete
