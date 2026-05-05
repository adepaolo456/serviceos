# ServiceOS — Feature Inventory

> Single source of truth for "what does ServiceOS do today vs what's coming."
> Customer-facing capability axis (NOT code module axis).
> Updated end-of-session when feature status flips.

## Status legend

- ✅ **Shipped** — live in production today
- 🚧 **In progress** — active development, has milestone target
- 📋 **Planned** — committed to ship, not yet started
- 💡 **Considering** — on roadmap, not committed
- ❌ **Out of scope / deactivated**

## Composes with

- `docs/arc-state.md` — narrative state (active arc, PR queue, learnings)
- `docs/runbooks/` — incident procedures
- `docs/decisions/` — Architecture Decision Records
- `docs/audits/` — durable correctness decisions on billing/race issues
- GitHub Issues + Projects — operational tactical status (shipping Day 4 Stage 2)
- CLAUDE.md — operational rules

## TOC

1. [Customer & Job Management](#1-customer--job-management)
2. [Dispatching & Routing](#2-dispatching--routing)
3. [Driver Mobile App](#3-driver-mobile-app)
4. [Billing, Invoicing & Payments](#4-billing-invoicing--payments)
5. [Inventory & Asset Management](#5-inventory--asset-management)
6. [Marketplace Integration (RentThis)](#6-marketplace-integration-rentthis)
7. [Notifications & Automation](#7-notifications--automation)
8. [Reporting & Analytics](#8-reporting--analytics)
9. [Tenant & Multi-Tenant Infrastructure](#9-tenant--multi-tenant-infrastructure)
10. [Vertical Support](#10-vertical-support)
11. [Pricing & Business Rules](#11-pricing--business-rules)
12. [AI Features (Phase 4)](#12-ai-features-phase-4)
13. [Operational Tooling](#13-operational-tooling)
14. [Update log](#14-update-log)

---

## 1. Customer & Job Management

- ✅ CRM (customers, leads, job history)
- ✅ Job creation (manual + booking wizard)
- ✅ Scheduling calendar with drag-and-drop dispatching
- ✅ Quick Quote → Book Now flow with saved service-site selection
- ✅ Smart Exchange Detection (auto-defaults to Exchange when active dumpster on-site)
- ✅ Add Customer flow (unified SlideOver, default Save & Schedule Job, customer autocomplete with debounced search, inline scheduling, duplicate detection backend fallback)
- 🚧 Customer autocomplete canonical extraction — 3 drifting impls today (quote-send-panel 250ms, booking-wizard 300ms, new-customer-form 300ms; only QSP uses blur-close)
- 📋 Customer portal magic-link improvements (backlog item B)

---

## 2. Dispatching & Routing

- ✅ Dispatch board (drag-drop via dnd-kit, QuickView panel)
- ✅ Multi-stop route planning via Mapbox
- ✅ Driver assignment + bulk select + bulk assign
- ✅ Real-time tracking (Mapbox map)
- ✅ In-column reorder + stop numbering
- ✅ Load bars + imbalance detection (HEAVY/SPREAD/IMBAL)
- ✅ Route time summary
- ✅ Collapsible unassigned rail
- ✅ State rollback on failed assignments
- ✅ Card hierarchy (L1 size+type, L2 address promoted, L3 customer+meta demoted)
- ✅ Single neutral state chip (OVERDUE > FAILED > AT YARD > YARD STOP)
- ✅ Role guards on assign + bulk-reorder (dispatcher+)
- ✅ Dispatch billing warnings/context from linked invoices and rental chains
- 📋 Tenant-configurable dispatch payment enforcement via Credit Control settings (off by default unless enabled)
- 💡 Route optimization (automated, not just visual) — Phase 4 AI

---

## 3. Driver Mobile App

- ✅ Job list with status updates
- ✅ GPS navigation (Google Maps for driver navigation only)
- ✅ "On My Way" SMS notifications (per-tenant Twilio trial today)
- ✅ Photo uploads (before/after)
- ✅ Digital signatures
- ✅ Offline mode (basic)
- ✅ Driver-owned execution states (arrived, in_progress) per Apr 6 lifecycle redesign
- ✅ Override modal (adjacent-only state transitions, reason required, logged in driver_notes)
- 📋 Driver branding (per-tenant SMS/email customization, customer-facing notification branding) — Phase 2
- 💡 PWA / mobile-tablet responsive
- 💡 Voice notes auto-transcription — Phase 4 AI

---

## 4. Billing, Invoicing & Payments

- ✅ Invoice system v2 (13 DB tables, cascade engine, 3-tier pricing, rental chain manager, auto-overage, billing issue detection, revision audit trail, credit memos, COGS/profit, 40+ endpoints, 7 frontend pages)
- ✅ Automated invoicing
- ✅ Payment processing (Stripe, direct SDK usage per ADR 0003)
- ✅ Deposits + overage charges
- ✅ Customer payment portal (login + toPortalJob mapper + deriveCustomerTimeline + formatRentalTitle)
- ✅ Credit memos
- ✅ Billing issues engine (detector-backed alerts and guided resolution flows)
- ✅ Pricing engine Phase 2 (config versioning, exchange logic, multi-yard, commercial vs residential rental policies, tenant_fees CRUD, pricing_snapshots persistence)
- ✅ Jobs pricing lock (`hasPricingRelevantChanges()` detector, recalc only on address/yard/subtype/service_type/rental changes, audit trail via job_pricing_audit table, used_locked_snapshot flag)
- ✅ Idempotent Stripe outbound calls — 4 P0 sites closed in PR #17
- ✅ Canonical `reconcileBalance()` writer (PR #19 audit + PR #20 math fix + PR #21 sync Sites 1+2 closure)
- ✅ Refund-flow `voided_at` stamping on full refund (PR #21)
- ✅ Net-paid math: `SUM(payments.amount - COALESCE(payments.refunded_amount, 0))` per PR #20
- ✅ All invoices ship as `'open'` (never `'draft'`)
- ✅ Distance surcharge folded into rental line item (single line, internal snapshot preserved for reporting)
- ✅ Phantom-paid producer closed Apr 29 (seed.controller.ts:saveInv prod env gate)
- 🚧 Webhook event-id dedup table + entry-point INSERT...ON CONFLICT DO NOTHING (PR-C2-pre, next implementation)
- 🚧 Sites 3+4 webhook bypass replacements + Site 4 internal `paymentRepo.findOne` guard (PR-C2)
- 🚧 Pessimistic invoice-row lock for chargeInvoice/refundInvoice (PR-C1d)
- 📋 Recurring billing for long-term rentals (will use Stripe Subscriptions per ADR 0003)
- 📋 Save card on file (Stripe Elements, frontend work deferred)
- 📋 4 P1 Stripe sites idempotency (customers.create, setupIntents.create, etc.)
- 💡 Accounting integrations (QuickBooks Online + Xero) — Phase 2
- ❌ No tax on customer invoices (per CLAUDE.md invoice rule; revisit if Stripe Tax integration triggered)

---

## 5. Inventory & Asset Management

- ✅ Track dumpsters / assets
- ✅ Status tracking (available, in-use, maintenance)
- ✅ Location tracking (yard vs customer site)
- ✅ Unique ID tagging
- 💡 QR / RFID tagging (mentioned in original product vision, not yet implemented)

---

## 6. Marketplace Integration (RentThis)

- ✅ Marketplace scaffold in production code: MarketplaceModule (controller/service/DTOs/entities), `marketplace_bookings` and `marketplace_integrations` tables, `jobs.marketplace_booking_id` wiring
- ✅ Public endpoint opt-in gating
- ✅ Accept transactionality
- ✅ Marketplace customer dedup envelope cleanup
- 📋 RentThis-facing marketplace product topology
- 📋 Public listing/feed surface
- 📋 Booking sync hardening
- 📋 Fee accounting
- 📋 Tenant opt-in/enablement UX
- 📋 Customer-facing marketplace UX
- 💡 Distance/radius pricing replication for marketplace listings

---

## 7. Notifications & Automation

- ✅ SMS confirmations (per-tenant Twilio trial `+15084338777`)
- ✅ Email confirmations (Resend, from `noreply@rentthis.com`)
- ✅ "On the way" alerts
- ✅ Pickup reminders
- ✅ Overdue rental alerts
- ✅ Path A SMS active in prod (quote send + cron automation per Apr 28 audit correction)
- ✅ SmsOptOut bug fix (`af296ca`)
- ✅ Twilio signature verification on inbound webhooks
- ✅ Quote follow-up + hosted quote + hot quotes + conversion dashboard
- 🚧 Production SMS (A2P 10DLC + Twilio upgrade decision) — currently blocked
- 📋 Notification settings UI (per-event SMS/email toggles) — Phase 2
- 📋 Driver branding (per-tenant SMS/email templates) — Phase 2

---

## 8. Reporting & Analytics

- ✅ Revenue dashboards
- ✅ Utilization rates
- ✅ Driver performance
- ✅ Profit per job
- ✅ Demo-customer exclusion across analytics (Phase 2a, `demo-customers-predicate.ts` helper, 8/8 tests passed)
- ✅ AR Outstanding (replaces AR Aging per Phase B2)
- ✅ Conversion dashboard
- ✅ Driver productivity reports
- ✅ Invoice exports (CSV)
- 💡 Advanced reports module (custom report builder, saved filters, scheduled exports, P&L by job/route) — Phase 2
- 💡 Demand heatmaps — Phase 4 AI
- 💡 Revenue forecasting — Phase 4 AI
- 💡 Cost-per-job calculations (real-time COGS attribution) — Phase 4 AI

---

## 9. Tenant & Multi-Tenant Infrastructure

- ✅ Multi-tenant data isolation: JWT-derived tenant_id, app-layer filtering primary (no TenantGuard class exists today; CLS/context mechanisms propagate tenant context across async boundaries — see ADR 0002)
- ✅ Row Level Security on 56/56 public tables (6 with explicit policies, rest default-deny for non-bypassing roles); NestJS API connects through bypassing/superuser-equivalent role so RLS is defense-in-depth for direct Supabase / PostgREST / client paths, not the primary runtime enforcement for the API
- ✅ Wildcard subdomain routing on Vercel (`rentthisapp.com`); `rent-this-dumpster.rentthisapp.com` verified
- ✅ Middleware routes tenant subdomains to `/site?slug=X` (`baabde0`); reserves app/www/api/admin
- ✅ OAuth Option A (`aa5dc8c`) — email-unique-per-platform, no auto-create, verified_email check, normalizeEmail at 9 sites
- ✅ Password reset (`eb6d8ba`) — hybrid admin+user flow, SHA-256 tokens, 60-min expiry, single-use, atomic redeemAndApply, rate-limited (3/hr email + 10/hr IP + 200ms timing floor + admin trigger 5/hr)
- ✅ Tenant settings CRUD (quote behavior controls, quote_templates JSONB, SMS config, sms_enabled, sms_phone_number) — Phase 14
- ✅ Tenant timezone via tenant_settings.timezone + shared YYYY-MM-DD helpers + useTenantTimezone() hook
- ✅ Role guards (RBAC: owner > admin > dispatcher > driver > viewer hierarchical via RolesGuard)
- ✅ Cross-tenant data fixes (Apr 8+20 security sprint)
- 🚧 Wildcard DNS config for `rentthisapp.com` (Vercel side live, GoDaddy DNS pending)
- 📋 **Username/password authentication for non-email users** (drivers + office staff) — **PRE-LAUNCH BLOCKER, P0**
- 📋 Second-tenant onboarding playbook
- 📋 Google OAuth tenant selector UI (deferred until tenant 2 onboarded)
- ✅ Tenant slug shortened — `rent-this-dumpster-mnbxs4jm` → `rent-this-dumpster` (arcL, PR #85 `8ca250c`, deploy `dpl_2yeDZe5ocTc6AuJz5VNaeKALAaMK`, 2026-05-04)
- 💡 RLS threat-model decision doc (defense-in-depth-only vs primary API enforcement) — open follow-up in arc-state.md
- 💡 Quotes RLS policy outlier review (`current_setting('app.tenant_id')`, public role, ALL policy) vs canonical auth.jwt tenant pattern
- 💡 Optional FORCE ROW LEVEL SECURITY evaluation on the 6 policied tables

---

## 10. Vertical Support

- ✅ Dumpster rental (live tenant: Rent This Dumpster, `822481be`)
- 💡 Portable storage (PODs) — multi-vertical strategy
- 💡 Portable restrooms — multi-vertical strategy
- 💡 Landscaping — multi-vertical strategy

---

## 11. Pricing & Business Rules

- ✅ Final pricing (Apr 2026): 10yd=$650/1t, 15yd=$750/2t, 20yd=$850/3t, all 14-day
- ✅ Tonnage overage charges ($185/ton prorated)
- ✅ Extra days billing ($10/day)
- ✅ Distance: 15mi free from yard (30 William Hooke Ln, Taunton MA, geocoded `41.905629, -71.081290`); +$25 per 5mi band
- ✅ Distance surcharge folded into rental line item (single line, internal snapshot preserved)
- ✅ Surcharges = separate line items (non-distance)
- ✅ Dump costs → `job_costs` only (not customer invoice)
- ✅ Invoice balance derived from payments
- ✅ Commercial vs residential billing differences
- ✅ Configurable pricing rules per tenant
- ✅ Exchange logic (pickup container determines tonnage allowance)
- ✅ Multi-yard support
- ✅ Pricing config versioning (draft/published, immutable revision IDs, partial unique index)
- ✅ Tenant fees CRUD
- ✅ Pricing snapshots (preview vs persist flag)
- ❌ 30yd / 40yd pricing — DEACTIVATED
- ❌ Legacy zone / per-mile pricing — DISABLED

---

## 12. AI Features (Phase 4)

All Phase 4 AI features are 💡 considering — none committed yet.

- 💡 Route optimizer (multi-stop with traffic + time windows + driver preferences)
- 💡 Smart SMS auto-responder
- 💡 Voice booking (voice-to-job intake)
- 💡 Revenue forecasting
- 💡 Demand heatmaps
- 💡 Cost-per-job calculations (real-time COGS attribution)
- 💡 OCR for dump tickets
- 💡 Predictive scheduling
- 💡 AI dispatch assistant (conversational interface for dispatchers)
- 💡 Photo damage detection (pre/post photos analyzed)
- 💡 Voice notes auto-transcription

---

## 13. Operational Tooling

- ✅ Help Center + HelpTooltip
- ✅ Help analytics (6 tracking events, registry-enforced)
- ✅ Feature registry (`web/src/lib/feature-registry.ts`, 35 features, 13 categories) — single source of truth for user-facing labels
- ✅ Global theme system (semantic CSS tokens in `globals.css`, ~30 utility classes, all 31 pages converted, zero hardcoded colors outside theme file)
- ✅ Sentry release pinning via `--build-env VERCEL_GIT_COMMIT_SHA`
- ✅ `deriveDisplayStatus()` in `web/src/lib/job-status.ts` (job lifecycle display logic)
- ✅ Pre-commit hook (AI-attribution check)
- ✅ Tenant settings UI: Quotes tab (rules, delivery, templates, SMS config, follow-up toggle)
- ✅ Admin Guide
- 📋 Admin tooling (full tenant admin panel, user management, billing/subscription controls, audit log viewer) — Phase 2
- 📋 GPS / fleet management (real-time vehicle tracking, geofencing, driver hours-of-service) — Phase 2
- 📋 E-sign integration (DocuSign / HelloSign-style) — Phase 2
- 📋 Permits module (municipal permit tracking + expiration alerts + document storage) — Phase 2

---

## 14. Update log

Date-stamped entries appended at top. Each entry shows what changed in this file since the previous entry.

### 2026-04-30 (Day 4 morning, this entry — initial creation)

- Initial creation of feature-inventory.md
- 13 customer-facing capability sections snapshot at PR #25 merge (HEAD `e04930c`)
- Multi-tenant section uses corrected ADR 0002 framing: no TenantGuard class exists; app-layer filtering primary; RLS 56/56 with 6 explicit policies, defense-in-depth for non-API paths
- Marketplace section reflects scaffold-exists state (not "NOT BUILT")
- Username/password auth for non-email users flagged as PRE-LAUNCH BLOCKER (P0) under Multi-tenant section
- Phase 4 AI features all marked 💡 (none committed)
- All ✅ Shipped items reflect production state through PR #25
- All 🚧 In progress items map to current PR-C arc deliverables (PR-C2-pre, PR-C2, PR-C1d)
