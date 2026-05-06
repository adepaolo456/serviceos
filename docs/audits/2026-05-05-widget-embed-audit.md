---
arc: arcT
phase: 0
date: 2026-05-05
target: widget embed (iframe "Website not found" + CORS Allow-Origin mismatch)
branch: arcT-widget-embed-audit (from main @ d1dc448)
verdict: **Bug 1 partial / Bug 2 FALSIFIED / Bug 3 surfaced — RECOMMEND DO NOT START arcU AS SCOPED**
writes_performed: this audit doc only
predecessors: arcQ (widget public-API rebrand), arcR (legacy host cleanup)
---

# arcT — Phase 0: Widget embed audit

## Summary

Two bugs were reported post-arcR:
1. iframe inside the widget overlay renders "Website not found"
2. `api.rentthisapp.com/public/tenant/:slug` returns CORS `Access-Control-Allow-Origin` set to a tenant subdomain rather than the requesting origin

Read-only audit across `web/public/widget.js`, `web/public/widget-test.html`, `api/src/main.ts` (CORS), `api/src/modules/public/`, `web/src/middleware.ts`, `web/src/app/site/*`, plus live runtime tests against `api.rentthisapp.com` and `app.rentthisapp.com`.

Findings:

- **Bug 1 (iframe "Website not found"):** the *mechanism* the report names — iframe loads from `app.rentthisapp.com` instead of the tenant subdomain — is true at the code level (`widget.js:90` hardcoded). But that URL returns HTTP 200 in prod and the page's slug-from-query-param resolution path works correctly when given a slug that resolves. **Symptom not reproducible against current prod.** Most likely the symptom was caused by a slug mismatch at the time of capture (see § 4 + § 7), which has since auto-resolved.
- **Bug 2 (CORS Allow-Origin mismatch): FALSIFIED.** Production CORS for `/public/*` correctly reflects the request `Origin` header. The reported behavior ("Allow-Origin always = tenant subdomain") is not what `api.rentthisapp.com` does today. Verified against three different `Origin` values; all reflected accurately.
- **Bug 3 (NEW, surfaced during audit):** `widget-test.html:31` documents the embed snippet as `<script src="https://api.rentthisapp.com/widget.js" …>`. `api.rentthisapp.com/widget.js` returns **404**. The file lives only at `app.rentthisapp.com/widget.js`. Tenants following the published example get a broken embed. Cosmetic miss from arcN/O host-cutover.

Verdict: **the originally-scoped arcU (fix Bug 1 + Bug 2) is malformed.** Bug 2 doesn't exist as described, Bug 1 is not currently reproducible, and the actually-broken thing on this surface is Bug 3 (1 line of HTML). Recommendation in § 7.

## 1. Repo state

| Field | Value |
|---|---|
| Branch base | `main` @ `d1dc448` (arcS retroactive closure) |
| Audit branch | `arcT-widget-embed-audit` |
| Tracked changes | this audit doc only |
| Working tree (pre-audit) | clean against `origin/main` |

No source code changes. Only `docs/audits/2026-05-05-widget-embed-audit.md` is written.

## 2. Bug 1 — iframe "Website not found"

### 2.1 Code trace

`web/public/widget.js`:
```
4    var API = 'https://api.rentthisapp.com';
5    var APP = 'https://app.rentthisapp.com';
…
12   var slug = scriptTag.getAttribute('data-slug');
…
25   fetch(API + '/public/tenant/' + slug + '/widget-config')
…
88   var iframe = document.createElement('iframe');
89   iframe.id = 'rentthisapp-widget-iframe';
90   iframe.src = APP + '/site/book?slug=' + encodeURIComponent(slug) + '&embed=true';
```

The iframe `src` is **always** `https://app.rentthisapp.com/site/book?slug=<dataSlug>&embed=true`. The host literal is a fixed constant — there is no env-var or config-driven decision; arcN/O established `app.rentthisapp.com` as the canonical host and arcQ reaffirmed it.

This is the suspected-cause path the bug report named: iframe loads at `app.rentthisapp.com`, not the tenant subdomain.

### 2.2 Slug resolution path inside the iframe

The iframe URL is served by Next.js (web project) and passes through `web/src/middleware.ts`:

- Hostname is `app.rentthisapp.com` (a *reserved* subdomain — `extractSlugFromHost` at `web/src/lib/tenant/extractSlugFromHost.ts:36` returns `null` for `'app'`)
- `middleware.ts:29` short-circuits with `NextResponse.next()` — no rewrite
- Path `/site/book?slug=…&embed=true` matches `web/src/app/site/book/page.tsx`

Inside `web/src/app/site/layout.tsx:104-114` (`useResolveSlug`):
1. **Query param `?slug=` wins.** Reads from `useSearchParams()`. Returns the slug if present.
2. Else `extractSlugFromHost(window.location.hostname)`.
3. Else `"demo"` fallback.

So when the iframe loads `app.rentthisapp.com/site/book?slug=rent-this-dumpster&embed=true`, the slug resolves to `"rent-this-dumpster"` from the query param. `TenantProvider` then fetches `${API}/public/tenant/rent-this-dumpster` (`tenant-context.tsx:22`).

**This path is functional.** "Website not found" only renders if `tenant === null` after `loading === false` (`layout.tsx:17`), which happens when the fetch returns a non-OK response.

### 2.3 Runtime verification — current prod

```
curl 'https://app.rentthisapp.com/site/book?slug=rent-this-dumpster&embed=true'
→ HTTP/2 200, x-matched-path: /site/book, x-vercel-cache: PRERENDER (or HIT)
```

```
curl 'https://api.rentthisapp.com/public/tenant/rent-this-dumpster' \
  -H 'Origin: https://app.rentthisapp.com'
→ HTTP/2 200
   access-control-allow-origin: https://app.rentthisapp.com
   {"name":"Rent This Dumpster","slug":"rent-this-dumpster",…}
```

The exact iframe→API call returns 200 and the tenant resolves. **The reported symptom is not reproducible against current prod.**

### 2.4 Why the symptom likely occurred at the time of report

The `widget-test.html` snippet at line 57 hardcodes `data-slug="rent-this-dumpster"` (the short slug). Per `docs/audits/2026-05-04-dead-tenant-ef0aa720-audit.md` § 3, on 2026-05-04 the live tenant's DB slug was `rent-this-dumpster-mnbxs4jm` — a *different* slug. If the bug was reported between arcR (2026-05-05) and the slug rename (which must have happened between 2026-05-04 and now), then `/public/tenant/rent-this-dumpster` would have returned 404, `tenant` would have been null, and `layout.tsx:17` would have rendered "Website not found".

Confirmation: `https://api.rentthisapp.com/public/tenant/rent-this-dumpster-mnbxs4jm` **still returns 404** today (the old long slug is gone). The active DB slug is now `rent-this-dumpster`.

This is consistent with a transient symptom that has self-resolved as the tenant slug was simplified.

### 2.5 Files in scope

| File | Lines | Role |
|---|---|---|
| `web/public/widget.js` | 4–5, 12, 25, 88–90 | iframe.src host + slug + widget-config fetch |
| `web/public/widget-test.html` | 57 | live `data-slug` (relative `/widget.js`) |
| `web/src/middleware.ts` | 11–43 | tenant subdomain rewrite (skips `app.rentthisapp.com`) |
| `web/src/lib/tenant/extractSlugFromHost.ts` | 13, 36–57 | reserved-subdomain logic |
| `web/src/app/site/layout.tsx` | 17, 92–114 | "Website not found" string + slug resolution priority |
| `web/src/app/site/tenant-context.tsx` | 17–26 | tenant fetch (`r.ok ? r.json() : null`) |
| `api/src/modules/public/public.controller.ts` | 51–56 | `GET /public/tenant/:slug` route |
| `api/src/modules/public/public.service.ts` | 29–33, 35–52 | `findTenant` (filters by `slug` AND `is_active = true`); `getTenantBySlug` (filters by `website_enabled`) |

## 3. Bug 2 — CORS Allow-Origin mismatch (FALSIFIED)

### 3.1 Code trace

`api/src/main.ts`:
```
19   const allowedOrigins = [ … 'https://app.rentthisapp.com', … ];
29   const tenantSubdomainRegex = /^https:\/\/[a-z0-9-]+\.rentthisapp\.com$/;
31   app.enableCors((req, cb) => {
32     const url = (req as { url?: string }).url || '';
33     // Public endpoints — widget.js fetches these from arbitrary tenant domains.
34     // No credentials, any origin.
35     if (url.startsWith('/public/')) {
36       return cb(null, { origin: true, credentials: false });
37     }
38     // Authenticated endpoints — strict allowlist with credentials.
39     cb(null, { origin: (origin, originCb) => { … }, credentials: true });
52   });
```

`origin: true` in `cors` options is documented to **reflect the request `Origin` header** in the response. There is no per-tenant or per-slug origin computation anywhere in the API for `/public/*` routes. (`getWidgetConfig` at `public.service.ts:369` reads `origin` only to enforce `allowed_widget_domains` ACL — it does not compute a response header.)

So the *code* says: any origin, reflected, no credentials, for any `/public/*` URL.

### 3.2 Runtime verification — three origins, all reflected accurately

| Request `Origin` header | Response `Access-Control-Allow-Origin` |
|---|---|
| `https://app.rentthisapp.com` | `https://app.rentthisapp.com` |
| `https://example.com` | `https://example.com` |
| `https://rent-this-dumpster.rentthisapp.com` | `https://rent-this-dumpster.rentthisapp.com` |

In every case the header reflects the request origin. **The reported behavior does not occur in current prod.** The hypothesis "Allow-Origin always = tenant subdomain" is falsified.

### 3.3 Minor CORS oddity (incidental — NOT Bug 2's mechanism)

The response also includes `access-control-allow-credentials: true` even on `/public/*` routes, which `main.ts:36` configures as `credentials: false`. The OPTIONS preflight further returns `access-control-allow-origin: *` together with `access-control-allow-credentials: true` (a CORS spec contradiction; browsers ignore credentials when origin is `*`).

Likely cause: Vercel's edge or `@nestjs/platform-express`'s CORS-default merging is layering an `Allow-Credentials: true` header that the per-request callback isn't suppressing. This does **not** break browser usage of these endpoints (`tenant-context.tsx:22` issues plain non-credentialed `fetch()`, so the wildcard preflight is acceptable).

This is a minor hygiene finding, not the reported Bug 2. Optional follow-up; not in arcU's scope unless explicitly added.

### 3.4 Files in scope

| File | Lines | Role |
|---|---|---|
| `api/src/main.ts` | 17–52 | `enableCors` per-request callback (the entire CORS surface) |
| `api/src/modules/public/public.service.ts` | 369–377 | `allowed_widget_domains` ACL — read of `Origin` is for authorization, not header computation |

## 4. Bug 3 — `widget-test.html` docs embed snippet 404s (NEW)

`web/public/widget-test.html:31`:
```
<pre>&lt;script src="https://api.rentthisapp.com/widget.js" data-slug="rent-this-dumpster"&gt;&lt;/script&gt;</pre>
```

This is the **embed code shown to tenants on the test page**. It instructs them to load `widget.js` from `api.rentthisapp.com`.

Runtime verification:
```
curl -I https://api.rentthisapp.com/widget.js
→ HTTP/2 404
   {"message":"Cannot GET /widget.js","error":"Not Found","statusCode":404}

curl -I https://app.rentthisapp.com/widget.js
→ HTTP/2 200, content-type: application/javascript
```

`widget.js` is a static asset of the **web** project (`web/public/widget.js`), served at `app.rentthisapp.com/widget.js`. It is not exposed by the API. Tenants who copy the snippet at line 31 verbatim will see a script-load failure and no widget at all.

The arcQ closure note (§ 6) explicitly defers `widget-test.html:31` to "arcQ′" — but arcQ′ was never spawned, and arcR cleaned up legacy hosts elsewhere without revisiting this line. The current literal `https://api.rentthisapp.com/widget.js` was put in place by arcN's host migration (legacy `serviceos-web-zeta.vercel.app` → `api.rentthisapp.com`); arcN flipped the host but didn't notice that the file isn't actually served from the new host.

**Severity:** anyone embedding from the documented snippet gets a non-functional widget. Mitigated only by the fact that "zero tenants embedded" still holds (per arcQ § 2 — `marketplace_integrations` rows = 0). Pre-launch impact: **blocks any tenant adoption that uses the published embed example**.

## 5. Causation analysis

The original bug report posited: *"CORS failure may cascade into the iframe load failure."*

Based on the evidence:

| Question | Answer | Evidence |
|---|---|---|
| Does Bug 1 cascade from Bug 2? | **No.** | Bug 2 doesn't exist — CORS reflects origin correctly. Cascade premise is moot. |
| Are Bugs 1 and 2 independent? | **Bug 2 is not real; Bug 1 is currently not reproducible.** | § 2.3, § 3.2 |
| What's actually broken on this surface today? | **Bug 3** (`widget-test.html:31` 404 docs example). | § 4 |
| What likely caused the originally-reported "Website not found"? | A slug mismatch (DB slug `…-mnbxs4jm` while embed used `rent-this-dumpster`), now self-resolved. | § 2.4 |

So the right framing is: **the bugs as scoped to arcU are not the bugs that need fixing.** The real, currently-reproducible bug on this surface is the docs-snippet 404, plus the minor CORS-credentials hygiene from § 3.3.

## 6. Cross-cutting risks

Surfaces that share `widget.js`'s `APP`/`API` constants or `/public/*` CORS:

| Surface | Path | Depends on | Notes |
|---|---|---|---|
| Hosted-quote page | `web/src/app/quote/[token]/page.tsx:48` | `/public/tenant/quote/:token` + CORS | Lives on a tenant subdomain in prod; same CORS rule reflects origin. Working. |
| Tenant homepage | `web/src/app/site/page.tsx:21` | `/public/tenant/:slug/services` | Tenant-subdomain origin — reflects. Working. |
| Tenant booking page (standalone) | `web/src/app/site/book/page.tsx:70,106,180` | `/public/tenant/:slug/{quote,services,booking}` | Same. |
| Tenant context | `web/src/app/site/tenant-context.tsx:22` | `/public/tenant/:slug` | Same. |
| Widget iframe (booking page in embed mode) | `web/src/app/site/book/page.tsx` (`embed=true`) | The page itself + `/public/*` fetches | Iframe origin is `app.rentthisapp.com` per widget.js:90; tested in § 2.3. Working today. |

Other `/public/*` consumers in the API (`portal-auth`, `stripe`, `marketplace`, `subscriptions`, `automation`, `demos`) are **not** under the `/public/` URL prefix — `main.ts:35` only relaxes CORS for paths *starting* with `/public/`. They use the strict allowlist. The relaxed-CORS blast radius is bounded to the 6 `public/tenant/:slug/…` endpoints. No cross-cutting CORS risk beyond that.

No other iframe constructors anywhere in `web/src` (grep confirmed). `widget.js` is the only embed surface.

**Conclusion: cross-cutting risk is low.** No other consumers are at risk from the issues in §§ 2–4.

## 7. Recommended fix plan (for any follow-up arc; **not** arcU as scoped)

Given that Bug 2 is falsified and Bug 1 is not currently reproducible, **arcU as originally scoped (fix iframe-host + fix CORS) is malformed and should not start.** Recommendations, in priority order:

### Recommendation A — narrow follow-up: fix Bug 3 (docs snippet 404)

- **Scope:** flip `web/public/widget-test.html:31` literal from `https://api.rentthisapp.com/widget.js` to `https://app.rentthisapp.com/widget.js`. One file, one line.
- **Arc size:** trivial (S). 1 PR. Could fold into the next docs/cleanup PR rather than a standalone arc.
- **Risk:** none. Cosmetic correction of a published example to match the actual deployed asset URL.
- **Suggested arc name:** **arcU-widget-embed-docs-fix** (scope-renamed from "arcU implementation") or fold into a future hygiene arc.

### Recommendation B — close arcU as moot for the original two bugs

- **Bug 1 ("Website not found"):** capture this audit's finding (slug mismatch as the likely root cause) and document that the arcK→present slug rename auto-resolved it. No code change required.
- **Bug 2 (CORS mismatch):** document as "not reproducible; original observation is inconsistent with current prod CORS behavior; closing without fix."
- **Arc size:** zero code (closure-docs only, no arcU PR).

### Recommendation C — optional small hygiene (deferred)

- **CORS credentials oddity** (§ 3.3): `Allow-Credentials: true` on `/public/*` despite `credentials: false` config. Investigate whether NestJS or Vercel is overriding, decide whether to suppress. Low priority — does not affect current consumers (all use non-credentialed `fetch`).
- **Arc size:** S. Investigation-first; possibly no fix required if behavior is intentional or framework-default.

### Risk summary for any of the above

- No env-var changes required.
- No DNS or Vercel project changes required.
- No DB migrations.
- Zero current embeds (`marketplace_integrations` empty per arcQ § 2) — even a more invasive change would have zero blast radius today.

## 8. Open questions

1. **Was the original bug report observed against prod, a preview, or local dev?** The audit-thread context says prod, but the symptom is not reproducible against prod now. If it was observed against a preview deploy, that preview may have had stale code or a different slug.
2. **Was widget-test.html line 31's `api.rentthisapp.com/widget.js` ever functional?** Worth confirming before changing — if there was once a Vercel rewrite or alias that proxied `/widget.js` from API host to web host, removing the line might unbreak something elsewhere. (No such rewrite found in `api/vercel.json` or `web/next.config.ts`.)
3. **Is the CORS `Allow-Credentials: true` on `/public/*` an intentional Vercel-default override, or an actual bug in the per-request callback shape?** Worth a 10-minute investigation; outcome decides whether § 3.3 needs a code change.
4. **Should iframe-loads-from-app-host vs. iframe-loads-from-tenant-subdomain be re-litigated at all?** Currently `app.rentthisapp.com` is the chosen host. There may be cookie-isolation or branding reasons to revisit, but those are *features*, not bug fixes — out of arcT scope and not appropriate for arcU as a bug-fix arc.

## 9. Compliance with audit charter

- [x] No source code changes.
- [x] No DB writes.
- [x] No commits to `main`.
- [x] No PR opened.
- [x] No env-var changes.
- [x] No DNS / Vercel project changes.
- [x] Findings + recommended fix plan + estimated implementation size produced.
- [x] Audit doc committed only to branch `arcT-widget-embed-audit` (this commit).

## 10. Report-back summary

- **Branch:** `arcT-widget-embed-audit`
- **Audit doc:** `docs/audits/2026-05-05-widget-embed-audit.md`
- **Commit SHA:** *(see commit message — single commit on the audit branch)*
- **One-paragraph summary:** Bug 1's iframe-src code mechanism is real but the "Website not found" symptom is not currently reproducible — most likely a slug-mismatch artifact that has self-resolved. Bug 2 (CORS Allow-Origin mismatch) is **falsified**; prod CORS reflects request origin correctly. A new Bug 3 surfaced: the docs embed snippet at `widget-test.html:31` instructs tenants to load `widget.js` from `api.rentthisapp.com`, which 404s. **Recommended:** do **not** start arcU as scoped (it would build a fix for a non-existent CORS bug and an irreproducible iframe symptom). Either close arcU as moot and spawn a tiny `arcU-docs-fix` to flip the one HTML literal, or fold Bug 3 into a future hygiene arc.
- **Blockers:** none for the audit itself. Recommendation needs Anthony's approval before any arcU action.
- **Recommend proceeding to arcU?** **No** — re-scope or close as moot. Bug 3 is real but trivial.
