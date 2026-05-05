---
title: arcR — stale legacy host fallback cleanup audit
phase: 0 (read-only audit; no mutations)
date: 2026-05-05
predecessors: arcQ closed at PR #103 squash `e9cd7dc` (widget public-API rename)
verdict: SAFE WITH CAVEATS — 13 hygiene sites + 2 functional regressions surfaced; 8 retention paths confirmed out of scope
mutations_in_this_doc: none
---

# arcR — stale legacy host fallback cleanup audit

## Goal

arcR is the deferred arcQ § 3a stale fallback cleanup. Re-grep the codebase
fresh, broaden the sweep beyond the 8 sites arcQ remembered, and propose
a Phase 1a diff plan. **Re-grep surfaced 2 functional regressions caused
by arcQ's incomplete scope** — those are higher-priority than hygiene.

## 1. Re-grep results (4 patterns × 3 trees, excluding `node_modules` / `dist` / `.next` / `coverage` / audit docs)

### 1a. `serviceos-api.vercel.app`

| File:Line | Context | In/Out scope |
|---|---|---|
| `web/src/app/site/tenant-context.tsx:5` | `NEXT_PUBLIC_API_URL \|\| "https://serviceos-api.vercel.app"` | **IN** |
| `web/src/app/site/book/page.tsx:11` | same | **IN** |
| `web/src/app/register/page.tsx:91` | same | **IN** |
| `web/src/app/(dashboard)/invoices/page.tsx:504` | same (export endpoint) | **IN** |
| `api/src/modules/mapbox/mapbox.service.ts:47` | `Referer: 'https://serviceos-api.vercel.app'` | **OUT** (arcQ § 3b — Mapbox free-tier domain whitelisting) |
| `api/src/modules/mapbox/mapbox.service.ts:189` | same | **OUT** (same reason) |
| `driver-app/src/api.ts:4` | `const API_BASE = 'https://serviceos-api.vercel.app';` (Expo mobile) | **OUT** (arcN charter — driver-app deferred to separate cycle) |
| `api/.claude/settings.local.json` (multiple) | local Claude permission allowlist | **OUT** (not deployed, not source) |
| `api/coverage/lcov-report/**` (multiple) | auto-generated test coverage HTML | **OUT** (auto-regenerated on test run) |

### 1b. `serviceos-web-zeta.vercel.app`

| File:Line | Context | In/Out scope |
|---|---|---|
| `api/src/modules/portal/portal.service.ts:1170` | `FRONTEND_URL \|\| 'https://serviceos-web-zeta.vercel.app'` | **IN** |
| `api/src/modules/subscriptions/subscriptions.service.ts:93` | same | **IN** |
| `api/src/modules/subscriptions/subscriptions.service.ts:119` | same | **IN** |
| `api/src/modules/automation/automation.service.ts:424` | `WEB_DOMAIN \|\| 'serviceos-web-zeta.vercel.app'` | **IN** |
| `web/public/widget-test.html:31` | `<script src="https://serviceos-web-zeta.vercel.app/widget.js" …>` (test page docs snippet) | **IN** |
| `api/src/main.ts:22` | CORS allowlist entry | **OUT** (arcQ § 3b — intentional multi-host CORS) |
| `api/api/index.js:3` | legacy serverless shim `ALLOWED_ORIGIN` | **OUT** (arcQ § 3b — intentional shim) |
| `web/src/lib/tenant/extractSlugFromHost.ts:18` | `ROOT_DOMAINS` array | **OUT** (arcQ § 3b — intentional multi-domain tenant routing) |

### 1c. `serviceos.io`

**Zero hits.** PR #82 already replaced the only known site (`api.serviceos.io/marketplace/bookings`) with a Coming Soon state.

### 1d. broader `serviceos.com` sweep — caught **4 NEW drift sites** arcQ did not remember

| File:Line | Context | In/Out scope |
|---|---|---|
| `web/src/app/quote/[token]/page.tsx:80` | `${branding.slug}.${process.env.NEXT_PUBLIC_TENANT_DOMAIN \|\| "serviceos.com"}` (tenant subdomain URL builder) | **IN — drift** |
| `web/src/app/site/layout.tsx:84` | `Powered by <a href="https://serviceos.com">RentThisApp</a>` (visible footer href on non-embed) | **IN — drift** |
| `web/src/app/site/confirmation/page.tsx:36` | same Powered-by href (embed-mode footer) | **IN — drift** |
| `web/src/app/site/book/page.tsx:515` | same Powered-by href (embed-mode footer) | **IN — drift** |

The Powered-by hrefs are a **customer-facing branding bug**: the visible link text says "RentThisApp" but `href` points to `https://serviceos.com` (a domain Anthony does not own). arcN missed these; arcR catches them.

### 1e. **CRITICAL — 2 functional regressions caused by arcQ's incomplete scope**

arcQ Phase 1a renamed widget.js LISTENER from `serviceos-{close,booking-complete}` → `rentthisapp-*`, but the SENDER sites in `web/src/app/site/` were OUT of arcQ scope (which was strictly `web/public/widget.js` + `web/public/widget-test.html`). Result:

| File:Line | Sender code (still emits OLD event type) | Listener (renamed in arcQ) |
|---|---|---|
| `web/src/app/site/confirmation/page.tsx:34` | `window.parent.postMessage({ type: "serviceos-close" }, "*")` (Close button on embedded iframe) | widget.js gate at line 134 now `'rentthisapp-close'` |
| `web/src/app/site/book/page.tsx:210` | `window.parent.postMessage({ type: "serviceos-booking-complete", jobNumber }, "*")` (booking complete) | widget.js gate at line 129 now `'rentthisapp-booking-complete'` |

**Effect:** Neither postMessage will ever satisfy the listener after arcQ. Embedded-iframe Close button no-ops; booking-complete callback never fires. **This breaks the embedded widget contract.**

**Live impact today: zero** — `marketplace_integrations = 0`, no tenant has `allowed_widget_domains` populated (verified during arcQ Phase 0). Nothing embeds the widget today, so no postMessage round-trip ever happens. **But the moment a tenant embeds, both close-button and booking-complete are silently broken.** Cheapest-moment heuristic from arcQ § 7 applies: fix now while embeds = 0.

These two sites are **not stale-host hygiene** — they're a regression patch. They belong in arcR Phase 1a alongside the hygiene fixes because the diff is similarly small and the audit-already-found-them framing keeps scope tight.

## 2. Cross-reference vs arcQ § 3a's remembered list

| arcQ § 3a remembered | Re-verified | Notes |
|---|---|---|
| api/src subscriptions ×2 | ✓ both still present at lines 93, 119 | line numbers stable |
| api/src automation | ✓ at line 424 | stable |
| api/src portal | ✓ at line 1170 | stable |
| web/src site/tenant-context | ✓ at line 5 | stable |
| web/src site/book/page | ✓ at line 11 | stable |
| web/src register/page | ✓ at line 91 | stable |
| web/src (dashboard)/invoices/page | ✓ at line 504 | stable |
| widget-test.html line 31 | ✓ | stable |

arcQ counted **"3 API + 4 web = 7 fallback sites"** but the actual count is **4 API + 4 web = 8** (subscriptions × 2 = 2 sites, not 1). Plus widget-test.html = 9. arcR confirms 9, not 8 as arcQ claimed.

## 3. Drift detection — sites NOT in arcQ § 3a

**4 new drift sites + 2 functional regressions = 6 sites arcR caught that arcQ missed.**

- `web/src/app/quote/[token]/page.tsx:80` — `NEXT_PUBLIC_TENANT_DOMAIN` fallback to `serviceos.com` (web-side analog of api/src/modules/quotes/quotes.controller.ts:38 that arcN PR #90 fixed; web missed)
- `web/src/app/site/layout.tsx:84` — Powered-by href
- `web/src/app/site/confirmation/page.tsx:36` — Powered-by href (embed mode)
- `web/src/app/site/book/page.tsx:515` — Powered-by href (embed mode)
- `web/src/app/site/confirmation/page.tsx:34` — postMessage `serviceos-close` (regression from arcQ)
- `web/src/app/site/book/page.tsx:210` — postMessage `serviceos-booking-complete` (regression from arcQ)

## 4. Per-site canonical truth

| Surface | Env var | Canonical fallback |
|---|---|---|
| Web → API URL | `NEXT_PUBLIC_API_URL` | `https://api.rentthisapp.com` |
| API → Frontend URL | `FRONTEND_URL` | `https://app.rentthisapp.com` |
| API → Web domain | `WEB_DOMAIN` | `app.rentthisapp.com` (no scheme — see arcN PR #90 quotes.controller.ts:130 precedent) |
| Tenant subdomain root | `NEXT_PUBLIC_TENANT_DOMAIN` (web), `TENANT_DOMAIN` (api) | `rentthisapp.com` (no scheme) |
| Powered-by marketing href | n/a (literal) | `https://rentthisapp.com` (apex) |
| postMessage event type | n/a (literal) | `rentthisapp-{close,booking-complete}` per arcQ |

Verified vs `api/src/common/env/env-rules.ts` declarations (`APP_URL`, `FRONTEND_URL`, `WEB_DOMAIN` all canonical) and arcN PR #90 fallbacks already-flipped at adjacent sites.

## 5. Proposed Phase 1a diff plan

### 5a. Hygiene fallback flips (9 sites)

| # | File:Line | Surface | Old | New | Confidence |
|---|---|---|---|---|---|
| 1 | `api/src/modules/portal/portal.service.ts:1170` | `FRONTEND_URL` fallback | `'https://serviceos-web-zeta.vercel.app'` | `'https://app.rentthisapp.com'` | high |
| 2 | `api/src/modules/subscriptions/subscriptions.service.ts:93` | same | same | same | high |
| 3 | `api/src/modules/subscriptions/subscriptions.service.ts:119` | same | same | same | high |
| 4 | `api/src/modules/automation/automation.service.ts:424` | `WEB_DOMAIN` fallback | `'serviceos-web-zeta.vercel.app'` (no scheme) | `'app.rentthisapp.com'` | high |
| 5 | `web/src/app/site/tenant-context.tsx:5` | `NEXT_PUBLIC_API_URL` fallback | `"https://serviceos-api.vercel.app"` | `"https://api.rentthisapp.com"` | high |
| 6 | `web/src/app/site/book/page.tsx:11` | same | same | same | high |
| 7 | `web/src/app/register/page.tsx:91` | same | same | same | high |
| 8 | `web/src/app/(dashboard)/invoices/page.tsx:504` | same | same | same | high |
| 9 | `web/public/widget-test.html:31` | docs snippet host | `https://serviceos-web-zeta.vercel.app/widget.js` | `https://api.rentthisapp.com/widget.js` (matches arcN-updated dashboard snippet at settings/page.tsx:852) | high |

### 5b. Drift caught by arcR re-grep (4 sites)

| # | File:Line | Surface | Old | New | Confidence |
|---|---|---|---|---|---|
| 10 | `web/src/app/quote/[token]/page.tsx:80` | `NEXT_PUBLIC_TENANT_DOMAIN` fallback | `"serviceos.com"` | `"rentthisapp.com"` | high (analog of arcN PR #90 fix) |
| 11 | `web/src/app/site/layout.tsx:84` | Powered-by href | `https://serviceos.com` | `https://rentthisapp.com` | high |
| 12 | `web/src/app/site/confirmation/page.tsx:36` | same (embed mode) | same | same | high |
| 13 | `web/src/app/site/book/page.tsx:515` | same (embed mode) | same | same | high |

### 5c. Functional regression patches from arcQ incompleteness (2 sites)

| # | File:Line | Surface | Old | New | Confidence |
|---|---|---|---|---|---|
| 14 | `web/src/app/site/confirmation/page.tsx:34` | postMessage event type | `"serviceos-close"` | `"rentthisapp-close"` | high (must match widget.js listener) |
| 15 | `web/src/app/site/book/page.tsx:210` | postMessage event type | `"serviceos-booking-complete"` | `"rentthisapp-booking-complete"` | high (must match widget.js listener) |

### Total line delta estimate

- **15 sites** across **12 files** (book/page.tsx and confirmation/page.tsx each have 2 separate sites; subscriptions.service.ts has 2 separate sites).
- Approximate +15 / −15 in-place literal substitutions.
- Single PR, single squash. Same shape as arcN PR #90.

## 6. Risk assessment

| Site category | Production reachability | What breaks if literal renders |
|---|---|---|
| Hygiene fallbacks (9) | Reachable only if env var unset (Vercel prod has them set per arcN) | Cosmetic; old vercel.app aliases still resolve |
| TENANT_DOMAIN drift (1) | Reachable on quote-share UI when `NEXT_PUBLIC_TENANT_DOMAIN` unset on web | Bad URL embedded in customer-shared link |
| Powered-by drift (3) | **Always reachable** (literal hardcoded) | Customer clicking footer lands on `serviceos.com` (Anthony does not own) |
| postMessage regressions (2) | Reachable when widget is embedded on a 3rd-party site | **Embedded close button + booking-complete callback both no-op silently** |

The Powered-by drift and postMessage regressions are higher-priority than the env-var fallback cosmetic; they affect actual user behavior the moment the relevant code path executes.

## 7. Out of scope (per arcQ § 3b retention rules)

| Site | Retention rule |
|---|---|
| `api/src/main.ts:22` (CORS allowlist) | intentional multi-host CORS support |
| `api/api/index.js:3` (legacy serverless shim) | intentional |
| `web/src/lib/tenant/extractSlugFromHost.ts:18` (ROOT_DOMAINS) | intentional multi-domain tenant routing |
| `api/src/modules/mapbox/mapbox.service.ts:47, 189` (Referer header) | Mapbox free-tier domain whitelisting requires the literal |
| `driver-app/src/api.ts:4` (Expo mobile baseURL) | per arcN charter — driver-app deferred to separate cycle; old host stays as alias indefinitely |
| `api/.claude/settings.local.json` (Claude permission allowlist) | not deployed, not source |
| `api/coverage/lcov-report/*.html` (auto-generated coverage) | auto-regenerates on test run; not source of truth |
| Internal `serviceos` code-name references (module names, repo name, DB schemas, internal class names) | per CLAUDE.md "Brand split" — internal naming stays `serviceos` until post-launch |

**8 retention sites confirmed out of scope.**

## 8. Verdict: **SAFE WITH CAVEATS**

- **Hygiene** (9 sites): clean fallback-default flips, no ambiguity. Flip and ship.
- **Drift** (4 sites): clean once Anthony confirms the canonical fallbacks (`rentthisapp.com` for TENANT_DOMAIN, `https://rentthisapp.com` for Powered-by hrefs). Both seem unambiguous.
- **Functional regressions** (2 sites): patches arcQ's incompleteness. Bundling into arcR is cleanest because the rename target is identical to arcQ Phase 1a's listener target. Alternative: split into a separate small "arcQ post-fix" arc — but bundling is lower-overhead.

**Should arcR Phase 1a proceed?** Yes — recommend one bundled PR for all 15 sites. The 2 postMessage regressions are the priority; the 13 cosmetic fixes ride along with negligible additional risk.

## Decisions Anthony needs before Phase 0 board card

1. **Bundle the 2 postMessage regressions into arcR, OR split into a separate "arcQ post-fix" arc?** Recommended: bundle (single PR, single squash, same hygiene; postMessage rename is mechanically identical to the hygiene flips).
2. **Confirm canonical fallbacks** in the per-site canonical-truth table (§ 4): `rentthisapp.com` for TENANT_DOMAIN, `https://rentthisapp.com` (apex) for Powered-by hrefs. Both seem unambiguous given arcN/arcL precedent.

No source code, branch, commit, push, or board card mutation in this audit.

---

## Closure footnote (appended 2026-05-05 at Phase 1c)

arcR closed end-to-end. Recording actual identifiers from the live execution.

| Phase | Identifier | Notes |
|---|---|---|
| 0 | board card #104 | created in Ready, all 7 fields set; bundle decision approved + canonical fallbacks confirmed |
| 1a — PR-1 squash SHA | `526997de171d00b5ea43cf1886ecc09872205ac2` | PR [#105](https://github.com/adepaolo456/serviceos/pull/105), 11 files, +15/−15 |
| 1a — files touched | 11 (3 API + 8 web/) | exactly the planned scope; no drift |
| 1a — typecheck | API `nest build` clean, web `tsc --noEmit` clean | both silent on stdout/stderr |
| 1a — `Tracks #104` phrasing | dodged GitHub auto-close ✓ | issue #104 stayed OPEN with `closedAt: null` through Phase 1a + 1b — **second arc** to demonstrate the workaround successfully (after arcQ #101) |
| API deploy id | `dpl_yyjy9abF5eDvdrRLpZYoSgmufFQT` | Sentry release pinned to `526997d` via `--build-env VERCEL_GIT_COMMIT_SHA` |
| Web auto-deploy id | `dpl_Ec84r5T6wQ9ZXezj4Jz8rb5d31JC` | `serviceos-c0lkrq5l3-adepaolo456s-projects.vercel.app`, READY at 35s build, 2m post-PR-merge |
| 1b — bundle verification | 10/10 token criteria pass + postMessage contract verified | scorecard below |
| 1c — closure docs PR | (this commit) | arc-state.md §11 entry + this footnote + flip #104 Done |

### Phase 1b verification scorecard

**Diff stat:** 11 files, +15/−15. Matches Phase 1a plan exactly (no drift).

**API smoke:**

```
$ curl -s https://api.rentthisapp.com/health | jq
{
  "status": "ok",
  "commit": null,
  "timestamp": "2026-05-05T16:40:24.671Z"
}
```

`commit: null` is acceptable per arcO § 1c.1 (`?? null` → `|| null` operator change; runtime lambda env exposes empty string, not the SHA — Sentry release tag remains `526997d` from build-time injection).

**Web bundle coverage:** 5 routes fetched cache-busted (`/site/book`, `/register`, `/quote/test-token`, `/site/confirmation`, `/login`). 14 unique chunks discovered + downloaded. `/(dashboard)/invoices` substituted with `/login` because dashboard requires JWT (literal swap at `invoices/page.tsx:504` ships in dashboard chunks; coverage left for manual TODO).

**NEW token grep (must be ≥ 1 across deployed bundle):**

| NEW token | Required | Files | Occurrences |
|---|---|---:|---:|
| `https://api.rentthisapp.com` | ≥ 1 | 7 | **10** ✓ |
| `rentthisapp-close` | ≥ 1 | 2 | **2** ✓ |
| `rentthisapp-booking-complete` | ≥ 1 | 2 | **2** ✓ |
| `https://rentthisapp.com` | ≥ 1 | 3 | **3** ✓ |

**OLD token grep (must be 0 across deployed bundle):**

| OLD token | Required | Files | Occurrences |
|---|---|---:|---:|
| `https://serviceos-api.vercel.app` | 0 | 0 | **0** ✓ |
| `https://serviceos-web-zeta.vercel.app` | 0 | 0 | **0** ✓ |
| `serviceos.com` | 0 | 0 | **0** ✓ |
| `serviceos-close` | 0 | 0 | **0** ✓ |
| `serviceos-booking-complete` | 0 | 0 | **0** ✓ |
| `serviceos.io` | 0 | 0 | **0** ✓ (PR #82 cleanup intact) |

ROOT_DOMAINS retention allowance not consumed: `extractSlugFromHost.ts` is server-only middleware code, not bundled into client chunks. Zero hits is the expected and clean result.

**postMessage contract verification (sender ↔ listener round-trip):**

| Side | Source | Events present |
|---|---|---|
| LISTENER | `widget.js` (arcQ-renamed) | `rentthisapp-close` = 1, `rentthisapp-booking-complete` = 1 |
| SENDER `rentthisapp-close` | `chunk_10.js` | confirmation/page chunk |
| SENDER `rentthisapp-booking-complete` | `chunk_12.js` | book/page chunk |

Listener and sender event types match — iframe round-trip intact end-to-end. arcQ + arcR jointly close the cross-file public-API rename that arcQ's narrow scope had left half-done.

**widget-test.html embed-snippet check:**

| Snippet | Required | Hits |
|---|---|---:|
| `https://api.rentthisapp.com/widget.js` (new) | ≥ 1 | **1** ✓ |
| `https://serviceos-web-zeta.vercel.app/widget.js` (old) | 0 | **0** ✓ |

**10/10 strict pass on bundle grep. 2/2 strict pass on postMessage contract. 2/2 strict pass on widget-test.html.**

### `Tracks #N` workaround validated for the second arc

arcQ was the first arc to use `Tracks #N` in a work-PR body to dodge GitHub's eager auto-close detector. arcR is the second. Verified: issue #104 was `closed: false, closedAt: null` immediately before this Phase 1c project-Status flip, then closed precisely when the flip fired the auto-close-on-Done workflow per arcM § 6.5. Two consecutive arcs make the workaround the standing pattern. Use `Tracks #N` or `Part of #N` in work-PR bodies; reserve `Closes #N` for the closure-docs PR body.

### `git add -A` near-miss + recovery

First commit attempt during Phase 1a swept untracked prior-arc clutter (audit reports from arcJ1/K/L, the embedded `.claude/worktrees/` directory, `docs/audits/2026-04-28-*.md` files) into staging. The `warning: adding embedded git repository` output flagged the over-broad add; recovered cleanly via `git reset --soft HEAD~1` then `git reset` to clear index, then explicit `git add <file1> <file2> …` for only the 11 in-scope files. **Future arc commits should use explicit file paths** until the legacy untracked artifacts get their own cleanup arc. They've been hovering since arcO and warrant a separate decision (commit / gitignore / remove).

### Final closure result

**arcR closed.** Stale legacy host fallback cleanup landed cleanly across `api/` and `web/`. The bonus 2 postMessage sender fixes salvaged a silently-broken iframe contract before the first embed lands. Bundle grep + postMessage contract verification confirm no regressions in the deployed web build. API + web both READY with Sentry pinned. Card #104 flipped to Done; auto-close fires per arcM § 6.5.
