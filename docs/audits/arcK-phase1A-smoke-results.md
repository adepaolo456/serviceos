# Arc K Phase 1A — §K.5 Smoke Validation Results

**Date:** 2026-04-25
**HEAD at smoke run:** `5628994` (Step 4 PII scrubber commit)
**Verification mode:** structural (synthetic exceptions composed and run through `beforeSend`)
**Live preview:** deferred per Halt Gate 2 mitigation; the 24-hour post-prod observation window is the field check

Source-of-truth tests: `api/src/common/sentry/smoke.spec.ts` (7/7 passing).

The 6th §K.5 scenario (driver app crash on a job-detail screen) is purely client-side and is deferred to Phase 1C. Phase 1A covers 5 of 6 scenarios.

---

## Summary

| # | Scenario | Predicted (§K.5) | Actual (composed) | PASS / FAIL |
|---|---|---|---|---|
| 1 | Failed cancellation orchestrator run | ALLOW + scrub `cancellation_reason` + hash `customer_id` + tag `tenant_id`; severity **error** | Delivered. `cancellation_reason` → `[REDACTED]`. `customer_id` → 64-char hex. `job_id`, `chain_id`, `tenant_id` preserved. `event.tags.tenant_id` set. `untaggedEventDrops` unchanged. | ✅ **PASS** |
| 2 | Stripe webhook signature failure | DENY (filter D7); no event sent | `beforeSend` returns `null`. `event.data.object.billing_details` PII never reaches scrubber/tag layer. Counter **not** bumped. | ✅ **PASS** |
| 3 | Twilio inbound signature failure | DENY (filter D6); no event sent | `beforeSend` returns `null` for `UnauthorizedException('Invalid Twilio signature')`. `From`/`To`/`Body` PII never reaches scrubber/tag layer. Counter **not** bumped. | ✅ **PASS** |
| 3a | Twilio post-signature payload-processing failure (boundary check) | ALLOW (A-class, NOT D6); deliver with `From`/`To`/`Body` STRIPPED + `scope=platform` tag | Delivered. `From`/`To`/`Body` → `[REDACTED]`. `MessageSid` preserved. `event.tags.scope = platform`. Confirms D6 is not over-broad. | ✅ **PASS** |
| 4 | Driver app crash on job-detail screen | (deferred to Phase 1C) | n/a — client-side surface | — |
| 5 | 23505 UNIQUE constraint regression case | ALLOW (A2 — raw `QueryFailedError` escape); strip `driverError.detail`; tag `tenant_id`; severity **error** | Delivered. `email`, `first_name`, `last_name`, `phone` → `[REDACTED]`. Nested `extra.sql_error.driverError` → `[REDACTED]`. `tenant_id` preserved + tag set. `untaggedEventDrops` unchanged. The HANDLED case (service-layer `ConflictException`) is filtered separately by D5/D9. | ✅ **PASS** |
| 6 | 401 on `/auth/profile` from expired token | DENY (filter D2); no event sent | `beforeSend` returns `null` for `UnauthorizedException`. `Authorization` header (potentially containing JWT with `email` claim per §K.2 surface 4) never reaches scrubber/tag. Counter **not** bumped. | ✅ **PASS** |

**Cross-scenario invariant:** running all 5 scenarios sequentially through `beforeSend` produces `untaggedEventDrops = 0` (final `it()` in `smoke.spec.ts`).

---

## Per-scenario detail

### #1 — Failed cancellation orchestrator run

**Composed exception**

```ts
new InternalServerErrorException(
  'Cancellation step failed: post-commit refund audit threw',
)
```

Mirrors the BLOCKER J pattern: a post-commit step in the rental-chains cancellation flow throws past the catch boundary. `InternalServerErrorException` is matched by allow rule **A8** (always alert).

**Composed event payload** (synthetic — no real customer)

```ts
{
  request: {
    method: 'POST',
    url: '/jobs/abc/cancel',
    data: {
      job_id: '550e8400-…99',
      chain_id: '550e8400-…100',
      cancellation_reason: 'Customer Maria Santos requested cancellation; their phone is 5551234',
      customer_id: 'cust-real-uuid',
      tenant_id: TENANT_UUID,
    },
  },
}
```

**Pipeline trace**

1. **Filter** (`shouldDropEvent`) — `InternalServerErrorException` does not match D1–D10 → not denied
2. **Scrub** (`scrubEvent`) — `cancellation_reason` ∈ `STRIP_FIELDS` → `[REDACTED]`. `customer_id` ∈ `HASH_FIELDS` → `sha256(${TENANT_UUID}:cust-real-uuid:${SALT})` (64-char hex). `job_id`/`chain_id`/`tenant_id` not in any rule → preserved.
3. **Tag** — CLS has `tenant_id=TENANT_UUID` → `event.tags.tenant_id = TENANT_UUID`
4. **Guard** — tag set → event delivered

**Severity:** **error** (delivered, alert per A8)

**Field-presence proof:** `expect(data.cancellation_reason).toBe(REDACTED)`, `expect((data.customer_id as string).length).toBe(64)`, `expect(data.tenant_id).toBe(TENANT_UUID)` — all in `smoke.spec.ts:#K.5 #1`.

---

### #2 — Stripe webhook signature failure

**Composed exception**

```ts
new BadRequestException('Invalid webhook signature')
```

Exact source: `api/src/modules/stripe/stripe.service.ts:275` — thrown by `handleWebhook` when `stripe.webhooks.constructEvent` throws on signature mismatch.

**Composed event payload includes** the Stripe billing_details PII triple to prove the filter drops BEFORE PII can leak: `billing_details: { email, name, address }`, `customer: 'cus_spoofed'`.

**Pipeline trace**

1. **Filter** — `BadRequestException` matches **D1**. Message `'Invalid webhook signature'` also matches **D7** (intentional duplicate per audit). → DENIED
2. `beforeSend` returns `null` immediately. Scrub/tag/guard layers never run.

**Severity:** **none** (filtered — abuse-traffic suppression).

**Counter:** filter-drops do NOT bump `untaggedEventDrops`. Verified at `smoke.spec.ts:#K.5 #2`.

---

### #3 — Twilio inbound webhook signature failure

**Composed exception**

```ts
new UnauthorizedException('Invalid Twilio signature')
```

Exact source: `api/src/modules/automation/automation.controller.ts:134` — thrown by the HMAC-SHA1 timing-safe comparison.

**Composed event payload** includes the Twilio PII triple `From`/`To`/`Body` to prove the filter drops BEFORE PII can leak.

**Pipeline trace**

1. **Filter** — `UnauthorizedException` matches **D2**. Message `'Invalid Twilio signature'` also matches **D6** (intentional duplicate). → DENIED
2. `beforeSend` returns `null` immediately.

**Severity:** **none** (filtered — abuse-traffic suppression).

**Boundary clarification (per Step 5 prompt):** D6 is restricted to the signature-failure path. Post-signature payload-processing failures (e.g., schema drift in the Twilio body parsing logic) must reach Sentry as ALLOW events — verified by an additional boundary test (`§K.5 #3 boundary check: payload-processing failure (post-signature) is NOT silenced by D6`). That test composes a generic `Error('Twilio inbound payload schema drift…')` and confirms the event delivers with `From`/`To`/`Body` STRIPPED and `event.tags.scope = 'platform'`.

D6 is not over-broad: only the literal `UnauthorizedException` thrown at the signature check is suppressed.

---

### #5 — 23505 UNIQUE constraint regression case

**Composed exception**

```ts
class QueryFailedErrorFake extends Error {
  code = '23505';
  constraint = 'idx_customers_tenant_email_unique';
  driverError = {
    detail: 'Key (email)=(jamie.real@example.com) already exists.',
    code: '23505',
  };
}
```

This is the REGRESSION case. The HANDLED case is the `ConflictException` thrown by `customers.service.ts:61-81` after catching `code === '23505'` — that's filter D5/D9 territory and is silenced as "user-facing handled."

The regression case is a future code path that forgets to wrap, letting the raw TypeORM `QueryFailedError` (with PII in `driverError.detail`) bubble to the global filter.

**Composed event payload** includes the raw email value in both `request.data.email` and `extra.sql_error.driverError.detail` to verify both surfaces are scrubbed.

**Pipeline trace**

1. **Filter** — `QueryFailedErrorFake` is not a NestJS exception subclass; matches no D-rule → not denied (matches **A2**)
2. **Scrub** — `email`, `first_name`, `last_name`, `phone` ∈ `STRIP_FIELDS` → `[REDACTED]`. Nested `extra.sql_error.driverError` ∈ `STRIP_FIELDS` → whole-subtree `[REDACTED]`. `tenant_id` preserved.
3. **Tag** — CLS has `tenant_id` → `event.tags.tenant_id` set
4. **Guard** — tag set → event delivered

**Severity:** **error** (delivered, alert per A2 — unexpected DB constraint violation indicates a real bug).

**Field-presence proof:** all 4 PII fields → `[REDACTED]`. Nested `driverError` → `[REDACTED]`. `tenant_id` preserved + tagged. Counter unchanged. Verified at `smoke.spec.ts:#K.5 #5`.

---

### #6 — 401 on `/auth/profile` from expired token

**Composed exception**

```ts
new UnauthorizedException()
```

Source: `JwtAuthGuard` rejecting an expired/invalid token.

**Composed event payload** includes a synthetic `Authorization: Bearer eyJ…` header to test the worst-case PII risk (JWT contains `email` claim per §K.2 surface 4).

**Pipeline trace**

1. **Filter** — `UnauthorizedException` matches **D2** → DENIED
2. `beforeSend` returns `null`. Authorization header never reaches scrubber.

**Severity:** **none** (filtered — expected behavior on token expiry).

**Note:** Sentry SDK config has `sendDefaultPii: false` in `sentry.config.ts`, so the SDK's own auto-capture path also doesn't gather Authorization headers. Defense-in-depth.

---

## `untaggedEventDrops` counter behavior across all 5 scenarios

| Scenario | Pipeline outcome | Expected counter delta | Observed |
|---|---|---|---|
| #1 ALLOW + delivered | filter pass → scrub → tag set → guard pass | 0 | 0 ✅ |
| #2 DENY (D7) | filter drops, scrub/tag/guard skipped | 0 | 0 ✅ |
| #3 DENY (D6) | filter drops, scrub/tag/guard skipped | 0 | 0 ✅ |
| #3a ALLOW post-sig | filter pass → scrub → tag (scope=platform) → guard pass | 0 | 0 ✅ |
| #5 ALLOW + delivered | filter pass → scrub → tag set → guard pass | 0 | 0 ✅ |
| #6 DENY (D2) | filter drops, scrub/tag/guard skipped | 0 | 0 ✅ |

The counter is reserved for genuine guard-drops (event survives filter, has no `tenant_id` and no `scope=platform`). None of the 5 §K.5 scenarios are expected to produce that condition. Production observability: `untaggedEventDrops > 0` in Vercel runtime logs is a halt signal.

---

## Coverage gaps explicitly out of scope for Phase 1A

- **Scenario #4 (driver app crash):** client-side, deferred to Phase 1C.
- **Live runtime smoke against Sentry preview:** deferred at Halt Gate 2 due to Vercel SSO + bypass-token-on-POST friction. Replaced by 24-hour post-prod observation window per Step 5 mitigation.
- **`@sentry/cli` source-map upload validation:** deferred to Phase 1A.5 (separate authorized arc).
- **Stripe webhook CLS wrapping verification:** flagged for Phase 1B audit per Step 5 deviation follow-up #2.

---

## Conclusion

All 5 in-scope §K.5 scenarios match audit prediction structurally. The two ALLOW scenarios deliver tagged + scrubbed events; the three DENY scenarios short-circuit at the filter without exposing PII to downstream layers. The Twilio boundary check confirms D6 is not over-broad — post-signature processing failures still reach Sentry as actionable events.

Phase 1A's structural defenses for §K.8 risks R1 (PII leakage) and R3 (alert fatigue) are wired and verified. R2 (cross-tenant data leakage) is structurally impossible given the CLS-only `tenant_id` source rule + `tenant_id`-bound HASH function.

The remaining Phase 1A work is Phase 1A.5 (`@sentry/cli` source-map upload) and the post-prod 24-hour observation window. After both, Phase 1A is closed.
