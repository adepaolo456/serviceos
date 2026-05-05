---
title: arcN — `api.rentthisapp.com` Provisioning (Phase 0 audit + execution plan)
phase: 0 (read-only audit + plan only)
date: 2026-05-05
project: ServiceOS — Vercel team `team_Pl6PH3JCzmLiKMrUTTCadwI7`
predecessors:
  - arcL (slug rename, customer-facing equivalent on web side)
  - arcM (project-board reconciliation — closing the new arcN card via Pre-launch polish milestone)
mutations_in_this_doc: none
files_written: docs/audits/2026-05-05-arcN-api-domain-cutover-plan.md (this file only)
verdict: B + C — small code change first, then env-var config; phase-gated execution
---

# arcN — `api.rentthisapp.com` Provisioning

## Context

ServiceOS production API runs at `serviceos-api.vercel.app`. Customer-facing
URLs (quotes, OAuth callback, Stripe webhook, embeddable widget, marketplace
webhook) embed this Vercel auto-host. Pre-launch we want the API on
`api.rentthisapp.com` so external surfaces match the customer-facing brand
(arcL closed the analogous slug-side polish; this is the API-side equivalent).

This phase: read-only audit + execution plan. No DNS changes, no Vercel
domain changes, no OAuth/provider edits, no deploys, no code modifications.
Execution is split into phase-gated steps (§ 7 below), each with explicit
STOP + report + Anthony-approval boundaries.

## Verdict: **B + C** — small code change first, then env-var config

Driver-app fix DEFERRED to a separate later arc (Expo mobile app —
`serviceos-api.vercel.app` stays as a permanent alias so installed driver
phones keep working).

---

## 1. Repo state

| Field | Value |
|---|---|
| Branch | `main` |
| HEAD | `763358d` (arcM closure commit) |
| Working tree | clean — only legacy untracked artifacts (arcJ1/arcK/arcL audit reports + `.claude/worktrees/`) |

## 2. Current API hosting + domain map

### Vercel projects (team `team_Pl6PH3JCzmLiKMrUTTCadwI7`)

| Project | id | Domains attached |
|---|---|---|
| `serviceos-api` | `prj_F5igRgwn3kAEzlD5f7ZxKM0xI5XP` | `serviceos-api.vercel.app` + 2 internal Vercel hosts. **No `api.rentthisapp.com`.** |
| `serviceos-web` | `prj_IGnjm6LEWY2Zbsw7mYRdBjoBQm3B` | `*.rentthisapp.com` (wildcard), `app.rentthisapp.com`, `rentthisapp.com`, `www.rentthisapp.com`, legacy `serviceos-web-zeta.vercel.app`, + 2 internal |

The wildcard `*.rentthisapp.com` lives on the **web** project. We need to
attach `api.rentthisapp.com` to the **API** project. Per Vercel: a
more-specific subdomain on a different project succeeds without conflicting
with the wildcard owner — but a pre-existing explicit attachment elsewhere
would block. **Pre-flight gate (Phase 1b):** `vercel domains inspect
api.rentthisapp.com --scope=team_Pl6PH3JCzmLiKMrUTTCadwI7` to confirm clean
slate.

### DNS

GoDaddy hosts `rentthisapp.com`. Production already serves
`app.rentthisapp.com`, `rentthisapp.com`, `www.rentthisapp.com`, and arbitrary
`*.rentthisapp.com` (verified live during arcL Phase 1c). The wildcard
CNAME at GoDaddy is sufficient; no new DNS record needed for
`api.rentthisapp.com` because Vercel's wildcard cert + edge routing covers
it. Vercel will auto-provision an additional ACM cert for the explicit
attachment.

## 3. Code findings (PR-1 scope)

All paths absolute under `/Users/Anthony_1/serviceos/`.

### 3a. Hardcoded URL literals — **must change**

| File:Line | Current | Action |
|---|---|---|
| `web/public/widget.js:1` | `https://serviceos-api.vercel.app` | → `https://api.rentthisapp.com` |
| `web/src/app/(dashboard)/settings/page.tsx:852` | widget snippet `https://serviceos-web-zeta.vercel.app/widget.js` shown to tenants | → `https://api.rentthisapp.com/widget.js` (or read from `NEXT_PUBLIC_API_URL`) |
| `api/src/modules/auth/auth.controller.ts:389,437` | OAuth `redirect_uri` literal fallback `https://serviceos-api.vercel.app/auth/google/callback` | → `https://api.rentthisapp.com/auth/google/callback` (env var stays primary; literal is the safety fallback) |
| `driver-app/src/api.ts:4` | `const API_BASE = 'https://serviceos-api.vercel.app';` | **DEFERRED** to a later arc |

### 3b. Env-var fallback defaults — **flip the default literal**

These already read env vars, but the fallback string still points at old
hosts. Updating the default makes local dev / preview-without-env behave
correctly.

| File | Var | Old default | New default |
|---|---|---|---|
| `web/src/lib/api.ts` | `NEXT_PUBLIC_API_URL` | `https://serviceos-api.vercel.app` | `https://api.rentthisapp.com` |
| `web/src/lib/portal-api.ts` | `NEXT_PUBLIC_API_URL` | same | same |
| `web/src/app/quote/[token]/page.tsx` | `NEXT_PUBLIC_API_URL` | same | same |
| `web/src/app/site/page.tsx` | `NEXT_PUBLIC_API_URL` | same | same |
| `web/src/app/login/page.tsx` (×2) | `NEXT_PUBLIC_API_URL` | same | same |
| `api/src/modules/tenant-settings/tenant-settings.service.ts:328–329` | `API_DOMAIN` | `serviceos-api.vercel.app` | `api.rentthisapp.com` |
| `api/src/modules/quotes/quotes.controller.ts:38` | `TENANT_DOMAIN` | `serviceos.com` (**wrong today**) | `rentthisapp.com` |
| `api/src/modules/quotes/quotes.controller.ts:130,880` | `WEB_DOMAIN` | `serviceos-web-zeta.vercel.app` | `app.rentthisapp.com` |
| `api/src/modules/stripe/stripe.service.ts:116,117,714` | `FRONTEND_URL` | `https://serviceos-web-zeta.vercel.app` | `https://app.rentthisapp.com` |

> **Note on `TENANT_DOMAIN` default `serviceos.com`:** latent bug, not a
> behavior-change risk. Quote-booking link emission requires `TENANT_DOMAIN`
> to be a domain Anthony actually owns. arcL Phase 0 swept all
> `notifications.body` rows for slug-bearing URLs and found zero — confirming
> no production quote with a slug-bearing booking URL has ever been
> persisted. Flipping the default is purely additive.

### 3c. CORS allowlist — cosmetic clean-up (non-blocking)

| File:Lines | Action |
|---|---|
| `api/src/main.ts:19–28` | Drop legacy `https://serviceos-web-zeta.vercel.app` and orphan `https://serviceos.vercel.app` / `https://www.serviceos.vercel.app` entries **after web deploy verifies on `app.rentthisapp.com` only**. The tenant-subdomain regex `/^https:\/\/[a-z0-9-]+\.rentthisapp\.com$/` is correct as-is. **`api.rentthisapp.com` is the destination, not an origin — does NOT go in the allowlist.** |
| `api/api/index.js:3` | Legacy serverless shim with hardcoded ALLOWED_ORIGIN. Out of scope for arcN — leave untouched (deletion is a separate refactor). |

## 4. Env vars to set in Vercel (before deploy)

### API project (`prj_F5igRgwn3kAEzlD5f7ZxKM0xI5XP`)

| Var | Value | Targets |
|---|---|---|
| `GOOGLE_CALLBACK_URL` | `https://api.rentthisapp.com/auth/google/callback` | Production |
| `API_DOMAIN` | `api.rentthisapp.com` | Production |
| `TENANT_DOMAIN` | `rentthisapp.com` | Production |
| `WEB_DOMAIN` | `app.rentthisapp.com` | Production |
| `FRONTEND_URL` | `https://app.rentthisapp.com` | Production |

Existing `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, `CRON_SECRET`, `TWILIO_*`,
`SENTRY_DSN_API` remain unchanged.

### Web project (`prj_IGnjm6LEWY2Zbsw7mYRdBjoBQm3B`)

| Var | Value | Targets |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.rentthisapp.com` | Production |

`NEXT_PUBLIC_*` vars are baked at build time — Web project must redeploy
after this var is set.

## 5. External provider checklist

### Google Cloud Console — OAuth client redirect URIs
**Add** `https://api.rentthisapp.com/auth/google/callback` alongside the
existing `https://serviceos-api.vercel.app/auth/google/callback`. Multiple
URIs allowed; keep both during transition. Remove old after smoke test.

> **Atomicity:** new URI MUST be registered BEFORE the API deploy that
> emits `redirect_uri=api.rentthisapp.com/...`. Otherwise Google rejects
> the OAuth init.

### Stripe Dashboard — webhook endpoint
**Edit existing endpoint URL** from
`https://serviceos-api.vercel.app/stripe/webhook` to
`https://api.rentthisapp.com/stripe/webhook`. **Do NOT create a new
endpoint** — that would generate a new `whsec_*` and break signature
verification until `STRIPE_WEBHOOK_SECRET` is rotated. Editing preserves
the secret.

> **Per-endpoint secret trap:** every Stripe webhook endpoint has its own
> `whsec_*`. The current code verifies against a single
> `STRIPE_WEBHOOK_SECRET`. Edit-in-place is the only safe move; create-new
> requires dual-secret verification code (out of scope).

### Twilio
`sms_messages` count = 0 (verified arcL Phase 0): no provisioned numbers.
`API_DOMAIN` env var fix is enough — new tenant numbers register webhooks
against `https://api.rentthisapp.com/automation/sms/inbound` on
provisioning. **No batch update needed.**

### Resend / Sentry / Marketplace
- Resend: send-only, no webhook. No-op.
- Sentry: DSN-based, host-agnostic. No-op.
- `marketplace_integrations` count = 0. No-op.

---

## 6. Pre-launch invariants (preserved)

- Old `serviceos-api.vercel.app` stays attached to the API project as an
  alias indefinitely. Required for driver-app deferral and as the
  rollback target.
- `app.rentthisapp.com` keeps serving the Next.js dashboard.
- Tenant subdomain wildcard (`*.rentthisapp.com`) keeps routing to the web
  project — uninterrupted.
- Sentry release pinning continues via `--build-env VERCEL_GIT_COMMIT_SHA`
  per CLAUDE.md.

---

## 7. Phase-gated execution sequence

> **Each phase has its own STOP + report + Anthony-approval gate.** Each
> phase prompt is a separate copy-paste; do NOT pre-stage commands for
> later phases. Each phase prompt waits for the previous phase's report.

### Phase 1a — PR-1 code change (Claude Code)

**Actor:** Claude Code.
**Inputs:** repo at `main` @ `763358d`, clean tree.
**Steps:**
1. Branch: `arc/N-api-domain-cutover-code`.
2. Apply edits per § 3a + § 3b (hardcoded literals + env-var fallback flips). Skip driver-app, `api/api/index.js`, CORS allowlist legacy entries.
3. `git diff --stat` → confirm only the listed files touched.
4. Commit via tmpfile (no AI trailer, per arcL/arcM hygiene).
5. Push; `gh pr create` with `--body-file`; `gh pr merge --squash --admin --delete-branch`.
6. Fast-forward local main; capture squash SHA.

**Stop:** STOP after merge.
**Report:** PR number, squash SHA, files changed, line count.
**Gate to next phase:** Anthony reviews diff link + SHA, replies "Phase 1b go".

### Phase 1b — Vercel pre-flight domain inspect (Claude Code, read-only)

**Actor:** Claude Code.
**Steps:**
```
vercel domains inspect api.rentthisapp.com --scope=team_Pl6PH3JCzmLiKMrUTTCadwI7
```
**Stop:** STOP regardless of outcome.
**Report:** raw inspect output.
**Decision matrix:**
- If "domain is not registered" or shows ownership by `serviceos` team only → SAFE, Anthony replies "Phase 1c go".
- If shows existing attachment to **`serviceos-web`** project → expected (wildcard); confirm only via UI that explicit `api.rentthisapp.com` is NOT set on web. If clean of explicit attachment, SAFE.
- If shows ownership by **another team or any explicit attachment to `serviceos-web`** → **STOP, do not auto-resolve.** Surface to Anthony for triage.

### Phase 1c — Env vars + OAuth URI register (Anthony, manual)

**Actor:** Anthony in Vercel UI + Google Cloud Console.
**Claude Code: NO actions this phase.**
**Anthony's checklist:**
1. Vercel → `serviceos-api` project → Settings → Environment Variables → add/update for **Production**:
   - `GOOGLE_CALLBACK_URL=https://api.rentthisapp.com/auth/google/callback`
   - `API_DOMAIN=api.rentthisapp.com`
   - `TENANT_DOMAIN=rentthisapp.com`
   - `WEB_DOMAIN=app.rentthisapp.com`
   - `FRONTEND_URL=https://app.rentthisapp.com`
2. Vercel → `serviceos-web` project → Settings → Environment Variables → add for **Production**:
   - `NEXT_PUBLIC_API_URL=https://api.rentthisapp.com`
3. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client → Authorized redirect URIs → **Add** `https://api.rentthisapp.com/auth/google/callback`. **Keep** existing `https://serviceos-api.vercel.app/auth/google/callback`.

**Anthony's report to Claude Code:** "Phase 1c done — env + OAuth registered."

### Phase 1d — API deploy with Sentry pinning (Claude Code)

**Actor:** Claude Code.
**Pre-condition:** Anthony confirmed Phase 1c done.
**Steps:**
```
cd /Users/Anthony_1/serviceos/api
vercel --prod --build-env VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD) --yes
```
**Stop:** STOP when deploy `readyState: READY`.
**Report:** deployment id (`dpl_...`), production URL, build time, Sentry release SHA confirmed in build log.
**Gate:** Anthony replies "Phase 1e go" only after confirming current API still healthy on `serviceos-api.vercel.app`.

### Phase 1e — Domain attach + cert wait (Anthony, manual)

**Actor:** Anthony in Vercel UI.
**Claude Code: NO actions this phase.**
**Anthony's checklist:**
1. Vercel → `serviceos-api` project → Settings → Domains → "Add Domain".
2. Enter `api.rentthisapp.com`. If Vercel prompts about the wildcard owner, accept the explicit-subdomain attachment (more-specific routing wins).
3. Wait for ACM cert provisioning (typically 30s–2min). Status should go from "Pending" → "Valid Configuration" with a green check.

**Anthony's report:** "Phase 1e done — `api.rentthisapp.com` attached, cert valid."

### Phase 1f — Read-only smoke (Claude Code)

**Actor:** Claude Code.
**Pre-condition:** Anthony confirmed Phase 1e.
**Steps:**
```bash
# 9a — API reachable on new host with TLS
curl -sI https://api.rentthisapp.com/ | head -3

# 9b — Old host still works (alias intact)
curl -sI https://serviceos-api.vercel.app/ | head -3

# 9c — Public tenant API at new host
curl -s https://api.rentthisapp.com/public/tenant/rent-this-dumpster | jq '.slug'
```
**Stop:** STOP regardless of outcome.
**Report:** for each: HTTP status, TLS state, body hash or first 100 bytes.
**Pass criteria:**
- 9a: HTTP 401 (NestJS auth) or 404 (root unrouted), valid TLS, NOT 5xx/525/cert error.
- 9b: same shape as 9a.
- 9c: `"slug": "rent-this-dumpster"`.
**On any failure:** STOP, do not auto-rollback. Surface to Anthony.

### Phase 1g — Stripe webhook edit (Anthony, manual)

**Actor:** Anthony in Stripe Dashboard.
**Claude Code: NO actions this phase.**
**Anthony's checklist:**
1. Stripe Dashboard → Developers → Webhooks.
2. Click the existing endpoint pointing at `https://serviceos-api.vercel.app/stripe/webhook`.
3. Click "Update details" → change URL to `https://api.rentthisapp.com/stripe/webhook`. **Save.**
4. **CRITICAL: edit-in-place only.** Do NOT click "Add an endpoint" — that creates a new `whsec_*` and breaks signature verification.
5. Verify the endpoint is still `enabled` and has the same event subscriptions.

**Anthony's report:** "Phase 1g done — Stripe endpoint URL edited, secret unchanged."

### Phase 1h — Web redeploy verification (Claude Code)

**Actor:** Claude Code.
**Pre-condition:** Anthony has either pushed a Web change OR triggered a redeploy on Vercel to bake the new `NEXT_PUBLIC_API_URL`. Web project auto-deploys on `git push` per CLAUDE.md.
**Steps:**
1. List recent web deployments via Vercel MCP `list_deployments` for `prj_IGnjm6LEWY2Zbsw7mYRdBjoBQm3B`.
2. Curl `https://app.rentthisapp.com/_next/static/chunks/...` headers OR fetch the bundled JS that includes the API URL constant and grep for the new host.
3. Smoke: `curl -sI https://app.rentthisapp.com/login | head -3`.
**Stop:** STOP.
**Report:** latest web deployment id + ready state, evidence that the new `NEXT_PUBLIC_API_URL` is baked into the deployed bundle.
**Gate:** Anthony replies "Phase 1i go".

### Phase 1i — End-to-end smoke (mixed)

**Actor split:**
- **Anthony:** Stripe webhook trigger + OAuth login (browser).
- **Claude Code:** tenant-subdomain curl.

**Anthony's actions:**
1. Stripe webhook round-trip (highest-risk gate):
   ```
   stripe trigger payment_intent.succeeded \
     --override-webhook-endpoint https://api.rentthisapp.com/stripe/webhook
   ```
   Expected: 200 from API; row appears in `payments` (or `stripe_events` dedup table after PR-C2-pre).
2. OAuth login E2E:
   - Open `https://app.rentthisapp.com/login` → click "Sign in with Google" → complete flow → land authenticated.
   - Failure modes: `redirect_uri_mismatch` (Google not updated), CORS error.

**Claude Code's actions (after Anthony's manual checks):**
```bash
# 12c — tenant subdomain still works (sanity)
curl -sI https://rent-this-dumpster.rentthisapp.com/ | head -3
```

**Stop:** STOP.
**Report:** Stripe HTTP status + `payments` row evidence; OAuth login result; tenant-subdomain HTTP status.
**On any failure:** STOP, do not auto-rollback. Surface specifics.

### Phase 1j — Closure docs commit (Claude Code)

**Actor:** Claude Code.
**Pre-condition:** Phase 1i fully passed.
**Note:** removing the old Google OAuth redirect URI is a manual Anthony step (Google Console UI), not part of this phase.

**Claude Code's actions:**
1. Branch: `docs/arcN-api-domain-closure`.
2. Edits:
   - `docs/arc-state.md` § 11 — prepend dated entry summarizing arcN closure (board card, PR-1 SHA, deploy id, OAuth/Stripe/Twilio updates done, lessons learned).
   - This audit doc gets a closure footnote (not the body) noting actual SHAs and deploy ids.
3. Project board: create arcN card in `Pre-launch polish` milestone (#6), status Done, retroactive (same pattern as arcL/rebrand-stack cards from arcM § 3a/3b).
4. Standard arcL/arcM hygiene: tmpfile commit msg, no AI trailer, `gh pr create --body-file`, `gh pr merge --squash --admin --delete-branch`.

**Stop:** STOP after merge.
**Report:** PR number, squash SHA, board card link, arc-state.md updated, OAuth-cleanup todo flagged for Anthony.

---

## 8. Smoke tests (consolidated reference)

```bash
# 9a — new host reachable + TLS
curl -sI https://api.rentthisapp.com/ | head -3

# 9b — old host alias intact
curl -sI https://serviceos-api.vercel.app/ | head -3

# 9c — public tenant API resolves on new host
curl -s https://api.rentthisapp.com/public/tenant/rent-this-dumpster | jq '.slug'

# 12a — Stripe webhook signature round-trip (HIGHEST RISK, manual)
stripe trigger payment_intent.succeeded \
  --override-webhook-endpoint https://api.rentthisapp.com/stripe/webhook

# 12b — OAuth login (manual browser)
# https://app.rentthisapp.com/login → Google → authenticate

# 12c — tenant subdomain unaffected
curl -sI https://rent-this-dumpster.rentthisapp.com/ | head -3
```

## 9. Rollback plan

| Phase | Failure mode | Rollback |
|---|---|---|
| 1a (PR-1 merge) | tests/build fail | `git revert <squash-sha>`; push |
| 1c (env vars) | wrong value | edit env var back; redeploy |
| 1d (API deploy) | build fails | Vercel auto-keeps previous prod; redeploy from previous SHA |
| 1e (domain attach) | cert won't provision / 525 | detach `api.rentthisapp.com` from API project; old `serviceos-api.vercel.app` continues serving |
| 1f (smoke fails) | 5xx or cert error on new host | detach domain (1e rollback); investigate |
| 1g (Stripe edit) | webhooks 400 silently | re-edit Stripe endpoint URL back to `serviceos-api.vercel.app/stripe/webhook` |
| 1c OAuth | login broken | remove new URI from Google; revert `GOOGLE_CALLBACK_URL` env; redeploy |
| 1h (Web redeploy) | web fails to call new API | revert `NEXT_PUBLIC_API_URL` on Web; redeploy Web |
| 1i (E2E smoke) | any | per individual failure above |

**Single-command rollback:** detach `api.rentthisapp.com` from the API
project at Vercel. Stops external traffic to the new host immediately;
old `serviceos-api.vercel.app` continues serving without interruption.

## 10. NOT in scope

- driver-app (Expo mobile) — separate later arc.
- Magic-link implementation, Google OAuth tenant selector UI, RLS expansion, FK coverage migration (per arcN charter).
- Removing legacy `api/api/index.js` — separate refactor.
- Cleaning legacy CORS allowlist entries beyond cosmetic note in § 3c.
- Unblocking PR-C2 / arcL follow-ups / unrelated backlog items.
- Renaming app domains.
- Production env var changes outside the 6 listed in § 4.
- Removing the old API domain — it stays as a permanent alias (driver-app + rollback insurance).

## 11. Critical files (PR-1)

- `/Users/Anthony_1/serviceos/web/public/widget.js`
- `/Users/Anthony_1/serviceos/web/src/app/(dashboard)/settings/page.tsx`
- `/Users/Anthony_1/serviceos/web/src/lib/api.ts`
- `/Users/Anthony_1/serviceos/web/src/lib/portal-api.ts`
- `/Users/Anthony_1/serviceos/web/src/app/quote/[token]/page.tsx`
- `/Users/Anthony_1/serviceos/web/src/app/site/page.tsx`
- `/Users/Anthony_1/serviceos/web/src/app/login/page.tsx`
- `/Users/Anthony_1/serviceos/api/src/modules/auth/auth.controller.ts`
- `/Users/Anthony_1/serviceos/api/src/modules/tenant-settings/tenant-settings.service.ts`
- `/Users/Anthony_1/serviceos/api/src/modules/quotes/quotes.controller.ts`
- `/Users/Anthony_1/serviceos/api/src/modules/stripe/stripe.service.ts`

(Reuses existing env-var-reading patterns in each file; no new utilities introduced.)

## 12. Verification checklist (end-to-end)

- [ ] Phase 1a — PR-1 merged via squash; commit SHA recorded.
- [ ] Phase 1b — `vercel domains inspect api.rentthisapp.com` shows clean slate (no prior explicit attachment).
- [ ] Phase 1c — 5 API + 1 Web env vars set on Production. Google OAuth has both old and new URIs.
- [ ] Phase 1d — API redeployed; deploy id captured; Sentry release pinned to PR-1 squash SHA.
- [ ] Phase 1e — `api.rentthisapp.com` attached to API project; ACM cert ready.
- [ ] Phase 1f — smoke 9a / 9b / 9c pass.
- [ ] Phase 1g — Stripe endpoint URL edited in-place; secret preserved.
- [ ] Phase 1h — Web redeployed with new `NEXT_PUBLIC_API_URL` baked in; deployment id captured.
- [ ] Phase 1i — Stripe webhook round-trip succeeds (HIGHEST RISK GATE); OAuth login E2E succeeds; tenant subdomain unchanged.
- [ ] Phase 1j — arcN closure docs PR merged; arc-state.md § 11 entry; Pre-launch polish board card created (Done).
- [ ] (Manual, post-Phase-1j) — old Google OAuth redirect URI removed from Console after one full smoke pass.
- [ ] Old `serviceos-api.vercel.app` retained as alias on API project (driver-app + rollback insurance).

---

## 13. Audit charter compliance (Phase 0)

- [x] Read-only Phase 0 audit + plan only
- [x] No DNS changes
- [x] No Vercel domain changes
- [x] No OAuth/provider edits
- [x] No deploys
- [x] No code modifications
- [x] No commits, no pushes
- [x] Verdict produced (B + C)
- [x] Code/config URL findings inventoried
- [x] External provider checklist produced
- [x] Phase-gated cutover sequence with explicit STOP/report/approval boundaries (1a–1j)
- [x] Smoke tests defined
- [x] Rollback plan defined
- [x] Manual steps Anthony must do enumerated (per phase)
- [x] Single deliverable: this audit doc

---

## Closure footnote (appended 2026-05-05 at Phase 1j)

arcN closed end-to-end. Recording actual identifiers from the live execution
so this audit doc can stand alone as the durable record.

| Phase | Identifier | Notes |
|---|---|---|
| 1a — PR-1 squash SHA | `6eca8962c51bcc1fcc9c0655bb012ad662cd752b` | PR [#90](https://github.com/adepaolo456/serviceos/pull/90), 11 files, +17/−17 |
| 1d — API deploy id | `dpl_AP5vcFB7rAFv6RJ5qPNpt7kUi9dq` | Sentry release pinned to `6eca896`, build 17s |
| 1e — Domain attached | `api.rentthisapp.com` → `serviceos-api` (`prj_F5igRgwn3kAEzlD5f7ZxKM0xI5XP`) | Vercel UI; cert via existing wildcard `*.rentthisapp.com` |
| 1f — Smoke pass | new host 401, old host 401, `/public/tenant/rent-this-dumpster` 200 with correct slug, TLSv1.3 / Let's Encrypt R13 / h2 / verify ok | Cosmetic CORS reflection from legacy shim noted (out of arcN scope) |
| 1g — Stripe webhook URL edit | **SKIPPED / DEFERRED** | No Live Stripe endpoint exists pre-launch; deferred to a separate audit-first arc. Route confirmed at `POST /stripe/webhook` (`api/src/modules/stripe/stripe.controller.ts:7,89`); single secret reader at `api/src/modules/stripe/stripe.service.ts:384` |
| 1h — Web redeploy id (post-env-var bake) | `dpl_Dm187nj9K8mzXJUL7JN9mft42UMH` | `action: redeploy`, `originalDeploymentId: dpl_4EhpAqnp7HzL4FCxH3PLhtYsnaXv`. Bundle grep: 6 `api.rentthisapp.com` hits, 0 `serviceos-api.vercel.app` hits. |
| 1i — OAuth login E2E | PASS (browser, fresh incognito) | App rendered authenticated dashboard, tenant data correct, sidebar brand "RentThisApp", no console / CORS / `redirect_uri_mismatch` errors |
| 1i — Tenant subdomain | HTTP/2 200, TLS valid | `https://rent-this-dumpster.rentthisapp.com/` |
| 1i — API on new host | `slug: "rent-this-dumpster"` | `https://api.rentthisapp.com/public/tenant/rent-this-dumpster` |
| 1j — Closure docs PR | (this commit) | arc-state.md §11 entry + this footnote + project board updates |

### Manual TODO post-closure (Anthony)

Remove the old `https://serviceos-api.vercel.app/auth/google/callback`
redirect URI from the ServiceOS OAuth client in Google Cloud Console
(project `rock-baton-393311`). One full smoke pass has succeeded
(Phase 1i), so the old URI is no longer needed. Manual UI step.

### Permanent retention (out of charter "do not remove old API domain")

`serviceos-api.vercel.app` remains attached to the `serviceos-api`
project as an alias indefinitely. Required for the deferred driver-app
arc (Expo mobile app shipped with the literal hardcoded; old host serves
those installed phones until a separate Expo rebuild + URL flip ships).
Also serves as the rollback target if `api.rentthisapp.com` ever needs
to be detached.
