# 0003 — Stripe as sole payment provider

**Status:** accepted
**Date:** 2026-04-30

## Context

ServiceOS handles money: invoices, deposits, overage charges, refunds, recurring billing (planned), per-tenant payouts (Stripe Connect, planned). The choice of payment provider determines the API surface, fees, supported geographies, dispute handling, fraud detection, and the developer experience for everything money-flow related.

The choice was: which payment provider, and do we support multiple providers from day one?

## Options considered

### Option A: Stripe only
Use Stripe for all payment processing. Use Stripe Connect for tenant payouts when implemented.

Pros: best-in-class developer experience, comprehensive API, strong webhook reliability, excellent dispute handling, Connect supports the "platform paying tenants" model we need, mature SDKs in every language we use
Cons: Stripe takes 2.9% + $0.30 per transaction; if a tenant is in a country Stripe doesn't support, we can't onboard them

### Option B: Stripe + alternatives behind an abstraction layer
Implement a `PaymentProvider` interface, support Stripe today, allow swap-in of Square/Braintree/Adyen later via tenant config.

Pros: flexibility, no vendor lock-in, can match per-tenant preferences
Cons: significant upfront engineering (interface + implementation + per-provider quirks), every payment feature must be implemented N times, reduces depth of any single integration, more surface area for bugs

### Option C: Stripe + Square (US small business)
Many US small business owners are already on Square. Support both natively.

Pros: meets some tenants where they already are
Cons: doubles the engineering surface, doubles the support surface, doesn't actually unblock anything strategic — we're a SaaS, not a payment processor

## Decision

**Option A — Stripe only.** No abstraction layer. Stripe SDK is used directly throughout `api/src/modules/billing/` and `api/src/modules/stripe/`.

Specifically:
- All payment processing via Stripe Payment Intents API.
- All future tenant payouts via Stripe Connect (Express or Standard accounts per tenant).
- Stripe webhooks are the source of truth for payment state changes (with idempotency keys + event-id dedup).
- Idempotency keys on every Stripe outbound call (closed in PR #17 for 4 P0 sites).
- No `PaymentProvider` interface, no abstraction layer — direct Stripe SDK usage.

Rationale:

1. **Stripe is best-in-class.** Developer experience, documentation, error messages, webhook reliability, dispute handling — all top-tier. Building against Stripe is faster than building an abstraction.
2. **No premature abstraction.** Until we have a concrete second provider with a concrete reason, abstracting is engineering debt with no payoff. The cost of abstraction is paid every PR; the benefit is hypothetical.
3. **Stripe Connect is essential.** When we onboard tenants and need to pay them their share of marketplace bookings, Connect is the only option that handles compliance (1099 reporting, KYC) for us. Building this from scratch with Square or anyone else is months of work.
4. **The 2.9% + $0.30 is acceptable.** At our pricing tiers ($149/$299/$499/custom), payment processing is a single-digit-percent line item, not a margin killer. We can revisit if a customer demands lower fees AND is willing to integrate against a different provider.

## Consequences

**Locked in:**
- Direct Stripe SDK usage in `api/src/modules/billing/` and `api/src/modules/stripe/`.
- Stripe webhook endpoint at `/stripe/webhook` is the source of truth for payment state.
- Idempotency keys on every outbound Stripe call (mutating endpoints) — see PR #17.
- Stripe Connect for tenant payouts (when implemented).
- Webhook event-id dedup table (`stripe_events`) per PR #22 audit (PENDING in PR-C2-pre).

**Left open:**
- Tenant payouts (Connect onboarding flow) — not yet implemented; ADR may be needed when designed.
- Recurring billing for long-term rentals — not yet implemented; will use Stripe Subscriptions.
- Save card on file (Stripe Elements) — frontend work deferred.
- Tax handling — currently no tax on customer invoices per CLAUDE.md invoice rules. If tax is added, Stripe Tax is the natural integration.

**Reversal cost:**
- Switching providers is a multi-month project. Every Stripe API call is now coupled to Stripe-specific data structures (PaymentIntent, Customer, Charge, Refund, Webhook event types). Migrating to a different provider would require: re-implementing the billing module against the new provider's SDK, re-doing webhook handling, re-doing idempotency, re-doing dispute handling, migrating existing customer payment methods (vendor lock for saved cards), retraining ops team.
- Estimated 6-12 weeks of engineering for a full migration. We would only reverse if Stripe became unavailable in a critical market, raised fees significantly, or had a sustained reliability problem.

## Related

- CLAUDE.md — invoice rules (`reconcileBalance()` is canonical writer; idempotency required on Stripe calls)
- PR #17 — Stripe idempotency keys (4 P0 sites)
- PR #18 — Stripe idempotency audit
- PR #19, PR #20, PR #21 — reconcileBalance bypass remediation (PR-C arc)
- PR #22 — webhook event-id dedup audit
- `docs/runbooks/incident-response.md` — Stripe is in the provider escalation list
