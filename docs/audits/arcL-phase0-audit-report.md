---
arc: arcL
phase: 0
date: 2026-05-04
target: shorten tenant slug `rent-this-dumpster-mnbxs4jm` → `rent-this-dumpster`
project: ServiceOS (Supabase project voczrzbdukgdrirmlgfw)
branch: main @ 696b960080fff870e235f81f53926d794d300a67
verdict: **C — NEEDS CODE CHANGE FIRST (small, low-risk)**
writes_performed: none
---

# arcL — Phase 0 audit: shorten tenant slug

## Summary

The slug rename from `rent-this-dumpster-mnbxs4jm` → `rent-this-dumpster` is **safe at
the data layer** (zero persisted slug-bearing URLs exist anywhere in the DB) and safe
at the platform layer (`*.rentthisapp.com` is wildcard-routed, so the new subdomain
just-works). It is **not** A — three files hardcode the literal old slug and would
silently regress without a code change first.

Verdict: **C — NEEDS CODE CHANGE FIRST.** Specifically: a tiny PR replacing three
hardcoded slug occurrences (seed controller × 2, widget-test page, two doc files),
*then* the manual DB UPDATE.

No redirect plumbing is needed — no customer-facing surface has persisted a
slug-bearing URL.

## 1. Repo state

| Field | Value |
|---|---|
| Branch | `main` |
| HEAD | `696b960080fff870e235f81f53926d794d300a67` |
| Tracked changes | none |
| Untracked | `.claude/worktrees/`, prior arc audit reports/deliverables |

## 2. Active tenant + target availability

```sql
SELECT id, name, slug, is_active, onboarding_status, created_at, updated_at
FROM public.tenants
WHERE slug IN ('rent-this-dumpster-mnbxs4jm','rent-this-dumpster')
   OR lower(slug) = lower('rent-this-dumpster');
```

| id | name | slug | is_active | onboarding_status |
|---|---|---|---|---|
| `822481be-039e-481a-b5c4-21d9e002f16c` | Rent This Dumpster | `rent-this-dumpster-mnbxs4jm` | true | `in_progress` |

- **Target slug `rent-this-dumpster` is FREE** — zero rows match it.
- DB has exactly one tenant total (per CLAUDE.md "Production tenant: Rent This Dumpster (`822481be`)"). No risk of cross-tenant collision.
- Where the suffix came from: `auth.service.ts:103` appends `-${Date.now().toString(36)}` on signup-time slug collisions. `mnbxs4jm` is just an unfortunate base36 timestamp — no semantic meaning, safe to drop.

## 3. Slug DB constraints / indexes

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint c JOIN pg_class t …
SELECT indexname, indexdef FROM pg_indexes WHERE tablename='tenants';
```

| Object | Definition |
|---|---|
| Constraint `UQ_2310ecc5cb8be427097154b18fc` | `UNIQUE (slug)` |
| Index `UQ_2310ecc5cb8be427097154b18fc` | `CREATE UNIQUE INDEX … ON tenants USING btree (slug)` |
| Index `PK_53be67a04681c66b87ee27c9321` | `PRIMARY KEY (id)` |

- Uniqueness is **case-sensitive** plain btree — no `lower(slug)` index.
- In practice never matters: signup-side regex `/^[a-z0-9-]+$/` (`auth.service.ts:94`,
  `tenant-settings.dto.ts:60`) enforces lowercase, and `extractSlugFromHost` lowercases
  hostnames before lookup. So mixed-case insertions are blocked at the entry point.
- Adding a `CREATE UNIQUE INDEX … (lower(slug))` would be defense-in-depth but is **out
  of scope for this arc** (per "Do not touch RLS expansion / FK coverage / OAuth").

## 4. Code slug-usage map

### 4a. Slug-bearing URL builders (production-relevant)

| Location | Pattern | Slug source | Risk |
|---|---|---|---|
| `api/src/modules/quotes/quotes.controller.ts:37–39` | `https://${slug}.${TENANT_DOMAIN}/site/book?quote=…` | `tenant.slug` (dynamic at send) | **None** — regenerated every render |
| `api/src/modules/quotes/quotes.controller.ts:462,694,732` | callers of the builder | `tenant.slug` | None — dynamic |
| `web/src/middleware.ts` + `web/src/lib/tenant/extractSlugFromHost.ts` | parses subdomain → slug, looks up tenant | hostname → API | None — parses whatever slug arrives |
| `api/src/modules/public/public.controller.ts:51,58,65,78,89,100` | `:slug/*` REST routes | request param → `findTenant(slug)` | None — dynamic |
| `api/src/modules/public/public.service.ts:29–31` | `findTenant(slug)` resolves by `slug + is_active` | dynamic | None |

All slug-bearing URL paths are dynamic. After the slug changes, every newly-rendered
URL uses the new slug automatically.

### 4b. Slug-bearing URL builders that DO NOT use slug (confirmed)

| Builder | What it uses | Slug-bearing? |
|---|---|---|
| `api/src/modules/quotes/quotes.controller.ts:129–132` `buildViewQuoteUrl(token)` | `WEB_DOMAIN` env, token only | **No** — `https://${WEB_DOMAIN}/quote/${token}` |
| `api/src/modules/stripe/stripe.service.ts:116,117,714` (refresh / return / billing portal) | `FRONTEND_URL` env | **No** |
| `api/src/modules/auth/services/password-reset.service.ts:94` | `APP_URL` (`app.rentthisapp.com`) | **No** — reserved subdomain, not a slug |
| `api/src/modules/auth/auth.controller.ts:376,407` | `app.rentthisapp.com` | **No** |
| `api/src/modules/portal/portal.service.ts:1170` | `FRONTEND_URL` | **No** |

OAuth, magic-link, password reset, Stripe Connect, and customer portal all live under
the **reserved** `app.` subdomain (per `extractSlugFromHost.ts:13`) — none of them are
slug-bearing. Per arc charter, none of those are touched.

### 4c. Hardcoded literal `rent-this-dumpster-mnbxs4jm` in source

| File | Line(s) | Severity | Notes |
|---|---|---|---|
| `api/src/modules/admin/seed.controller.ts` | 83, 303 | **MUST FIX** | Admin seed endpoints; `findOne({where:{slug:'rent-this-dumpster-mnbxs4jm'}})`. Silently no-ops after rename. |
| `web/public/widget-test.html` | 31, 57 | **SHOULD FIX** | Developer/QA test page for the embeddable widget; would 404 against the API after rename. Not customer-deployed. |
| `docs/feature-inventory.md` | 186, 198 | low (doc) | Stale references — should be updated for hygiene. |
| `docs/arc-state.md` | 163 | low (doc) | Same. |
| `api/.claude/settings.local.json` | 68 | low (local) | Claude permission allowlist for a curl test; not deployed. |
| `api/coverage/lcov-report/...html` | 1370, 1590 | n/a | Auto-generated coverage; ignore. |

The `seed.controller.ts` hits are the reason this is **C, not A**. After a pure DB
rename, the seed endpoint silently becomes a no-op (no error — just `findOne` returns
null and the whole seed routine short-circuits). Surgical fix: replace literal with
the new slug, or better, derive from a single `SEED_TENANT_SLUG` constant.

### 4d. Slug returned in API responses (dynamic, no action needed)

| Endpoint / response | Source |
|---|---|
| `auth.service.ts:176, 364` (signin/signup payload) | `user.tenant.slug` — read fresh |
| `admin.service.ts:162, 195` (tenant list / detail) | dynamic |
| `public.service.ts:40, 440` (tenant info, hosted quote) | dynamic |
| `sms-release.service.ts:276` | dynamic |
| Web `web/src/app/site/{book,page}.tsx` and `(dashboard)/settings/page.tsx` | reads `profile.tenant.slug` from API |

All dynamic. Frontend will pick up the new slug on next page load.

### 4e. `portal_slug` (different field)

`tenant_settings.portal_slug` is a **separate** customer-portal slug with its own
uniqueness check at `tenant-settings.service.ts:375–381`. Not affected by `tenants.slug`
changes. Out of scope.

## 5. DB-wide stored slug-reference sweep

The arc charter's strongest test was: are there persisted rendered outputs (notification
bodies, SMS payloads, audit metadata, settings JSONB, Stripe events, marketplace
configs) that contain the literal slug suffix `mnbxs4jm`?

Method: ILIKE `%mnbxs4jm%` against **every** `text`, `varchar`, `jsonb`, `json` column
in the `public` schema:

```sql
DO $$
DECLARE r record; cnt int;
BEGIN
  CREATE TEMP TABLE _slug_hits(tbl text, col text, hits int);
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public'
      AND data_type IN ('text','character varying','jsonb','json')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text ILIKE %L',
                   r.table_name, r.column_name, '%mnbxs4jm%') INTO cnt;
    IF cnt > 0 THEN INSERT INTO _slug_hits VALUES (r.table_name, r.column_name, cnt); END IF;
  END LOOP;
END $$;
SELECT * FROM _slug_hits;
```

Result:

| tbl | col | hits |
|---|---|---|
| `tenants` | `slug` | 1 |

**Exactly one hit, and it is the slug column itself.** No other persisted column carries
the suffix.

Specifically confirmed zero hits in:

- `notifications.body` (rendered email/SMS body — 32 historical rows, none mention `mnbxs4jm`)
- `notifications.subject`, `notifications.recipient`, `notifications.error_message`
- `sms_messages.body` (and the rest — 0 rows total)
- `scheduled_notifications.*` (0 rows total)
- `stripe_events.*` (0 rows total — no Stripe metadata to worry about)
- `marketplace_integrations.*` (0 rows total)
- `tenant_settings.*` (logo URL, support email, quote_templates JSONB, etc.)
- `invoices.*` (billing_address, terms_text, summary_of_work, dispute_notes, pricing_rule_snapshot)
- `payments.*` (notes, reference_number, refund_provider_status)
- `user_audit_log.action`, `user_audit_log.metadata`
- `quotes` does **not** persist `booking_url` at all — confirmed via `information_schema` (no such column). The `booking_url` field returned to the dashboard at `quotes.controller.ts:698` is computed at API render time from `tenant.slug + token`.

### Comm/log row counts (context)

| Table | Rows |
|---|---|
| `notifications` | 32 |
| `sms_messages` | 0 |
| `scheduled_notifications` | 0 |
| `stripe_events` | 0 |
| `marketplace_integrations` | 0 |
| `user_audit_log` | 3 |

32 historical notifications exist; none contain the slug suffix in any column. This
proves the slug-bearing booking URL has never been persisted into outbound comm
records. Pre-launch tenant.

## 6. Customer-facing URL classification

For each slug-bearing URL pattern, classified per arc charter 4(A/B):

| URL pattern | Slug position | Class A: regenerated dynamically | Class B: persisted | Verdict |
|---|---|---|---|---|
| Hosted quote book URL `https://{slug}.rentthisapp.com/site/book?quote=…` | subdomain | ✅ rebuilt every send via `buildTenantBookingUrl(tenant.slug, token)` | ❌ not stored — `quotes` table has no `booking_url` column | **A — dynamic** |
| Hosted quote view URL `https://{WEB_DOMAIN}/quote/{token}` | n/a — not slug-bearing | ✅ token-only | ❌ | **A — slug-free** |
| Public API `/public/tenant/{slug}/...` | path | ✅ web layer reads `tenant.slug` per render | ❌ | **A — dynamic** |
| Stripe Connect refresh/return URLs | n/a — not slug-bearing | ✅ FRONTEND_URL only | n/a | **A — slug-free** |
| Customer portal links | n/a — `app.rentthisapp.com` (reserved) | ✅ | n/a | **A — slug-free** |
| Password reset / magic link | n/a — `app.rentthisapp.com` | ✅ | n/a | **A — slug-free** |
| Widget snippet `data-slug="..."` | embedded in 3rd-party HTML | ❌ — copied at install time | ✅ on customer's site | Class B in theory; **0 deployments today** (no `marketplace_integrations` rows, widget-test.html only) |

Every Class A pattern auto-corrects on slug change. The single Class B candidate (the
widget snippet) has no production deployments yet — the only place it appears is the
internal `widget-test.html` developer page.

## 7. Redirect / backward-compat recommendation

**No redirect plumbing required.**

Justification:
- DB-wide sweep shows zero persisted slug-bearing URLs anywhere outside `tenants.slug`.
- 32 historical notifications were sent without slug-bearing content.
- No widget integrations exist (`marketplace_integrations.count = 0`).
- Pre-launch state (per arc context: "next pre-launch polish item").
- Vercel wildcard `*.rentthisapp.com` covers both old and new subdomains via the same
  cert; the OLD subdomain `rent-this-dumpster-mnbxs4jm.rentthisapp.com` will simply
  resolve to a 404-from-API after rename, which is the correct customer-facing
  behavior for an unknown slug.

If Anthony has personally tested the old `rent-this-dumpster-mnbxs4jm.rentthisapp.com`
subdomain in shared screenshots / Slack DMs / email previews, those external
references will break. That is acceptable pre-launch.

## 8. Slug collision and validation

- **Collision:** `rent-this-dumpster` is not present in `tenants.slug` for any row. Free.
- **Format:** target conforms to `SLUG_FORMAT = /^[a-z0-9-]+$/` (`extractSlugFromHost.ts:14`)
  and to the `auth.service.ts` slugifier rules. Valid.
- **Mutability:** `Tenant` entity exposes `slug` as a plain `@Column`, not a `readonly`
  field. No application-level guard prevents UPDATE. (Slug edit is not exposed in the
  product UI today, but DB UPDATE is structurally allowed.)
- **Case sensitivity:** unique constraint is case-sensitive. Not a concern in practice
  because regex enforces lowercase at insert.
- **Recommendation on `lower(slug)` index:** out of scope for this arc; flag as a
  future hygiene pass.

## 9. Risk findings

| Risk | Status |
|---|---|
| Hardcoded slug becomes stale in seed controller | **MUST FIX in code** (`seed.controller.ts:83,303`) |
| Hardcoded slug in widget test page | **SHOULD FIX in code** (`web/public/widget-test.html`) |
| Stale doc references | low — fix as hygiene |
| Outbound emails/SMS containing old slug-bearing URL | **None** — DB sweep returned 0 hits in `notifications.body`/`sms_messages.body` |
| Stripe metadata with old slug | **None** — 0 `stripe_events`, Stripe URL builders don't use slug |
| Marketplace integrations with old slug | **None** — 0 rows |
| Vercel domain provisioning | **Not needed** — `*.rentthisapp.com` wildcard already covers the new subdomain |
| OAuth / auth tied to slug | **None** — auth lives under reserved `app.` subdomain |
| Slug collision | **None** — target is free |
| Multi-tenant safety | **Safe** — only one tenant in DB; UPDATE is row-scoped by `WHERE slug='rent-this-dumpster-mnbxs4jm'` |

## 10. Verdict

**C — NEEDS CODE CHANGE FIRST.**

Reasoning:
- Not A: three source files hardcode the literal old slug.
- Not B: no persisted URLs anywhere — no redirect needed.
- Not D: no auth/OAuth/marketplace/domain blocker.
- C: small code PR fixes the hardcodes, then a one-line manual SQL UPDATE finishes it.

## 11. Proposed Phase 1 plan (NOT executed; awaiting approval)

### Phase 1a — single small code branch (do this first)

Target files (smallest possible diff):

1. **`api/src/modules/admin/seed.controller.ts`** — replace literal at lines 83 and 303.
   Two equivalent options:
   - **Option 1 (smallest diff)**: change literal `'rent-this-dumpster-mnbxs4jm'` →
     `'rent-this-dumpster'` (× 2). Simple. Couples seed to slug value.
   - **Option 2 (cleaner)**: hoist a `const SEED_TENANT_SLUG = 'rent-this-dumpster';`
     at the top of the file, replace both literals with the constant. One edit point
     for any future rename.
   - Prefer Option 2 for hygiene per CLAUDE.md ("DERIVED STATE / SSOT").

2. **`web/public/widget-test.html`** — lines 31 and 57: update `data-slug` attribute
   in both the documentation snippet and the live test snippet.

3. **`docs/feature-inventory.md`** lines 186, 198 — update slug references.

4. **`docs/arc-state.md`** line 163 — update slug references.

5. **`api/.claude/settings.local.json`** line 68 — optional; permission allowlist for a
   curl test; can be left until next session.

Skip:
- `api/coverage/lcov-report/...html` — auto-generated, regenerated on next test run.
- `arcK-phase0-audit-report.md` — historical record, should NOT be retro-edited.
- `repomix-output.xml` — build artifact, ignore.

CLAUDE.md compliance:
- Single-purpose branch (slug rename).
- No registry / multi-tenant / billing / dispatch surface touched.
- Surgical 6-line diff (Option 2) or 3-line diff (Option 1).
- No auto-commit, no auto-push.

### Phase 1b — manual Supabase SQL (run AFTER Phase 1a is merged + API redeployed)

```sql
-- arcL Phase 1b: shorten Rent This Dumpster tenant slug.
-- Preflight + idempotent + safe-on-rerun.
BEGIN;

-- Preflight 1: target slug must be free.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'rent-this-dumpster') THEN
    RAISE EXCEPTION 'Target slug rent-this-dumpster is already taken — abort';
  END IF;
END $$;

-- Preflight 2: source slug must exist on exactly one tenant.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.tenants WHERE slug = 'rent-this-dumpster-mnbxs4jm';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 tenant with slug rent-this-dumpster-mnbxs4jm, found %', n;
  END IF;
END $$;

-- Preflight 3: confirm we are touching the production tenant 822481be.
DO $$
DECLARE expected_id constant uuid := '822481be-039e-481a-b5c4-21d9e002f16c';
        actual_id uuid;
BEGIN
  SELECT id INTO actual_id FROM public.tenants WHERE slug = 'rent-this-dumpster-mnbxs4jm';
  IF actual_id <> expected_id THEN
    RAISE EXCEPTION 'Tenant id mismatch: expected %, got %', expected_id, actual_id;
  END IF;
END $$;

-- Apply rename.
UPDATE public.tenants
SET slug = 'rent-this-dumpster',
    updated_at = NOW()
WHERE slug = 'rent-this-dumpster-mnbxs4jm';

-- Postflight 1: exactly one tenant now has the new slug.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.tenants WHERE slug = 'rent-this-dumpster';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Postflight failed: expected 1 tenant with new slug, found %', n;
  END IF;
END $$;

-- Postflight 2: old slug is fully retired.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.tenants WHERE slug = 'rent-this-dumpster-mnbxs4jm';
  IF n <> 0 THEN
    RAISE EXCEPTION 'Postflight failed: old slug still present on % rows', n;
  END IF;
END $$;

-- Postflight 3: confirm tenant id is unchanged (nothing else moved).
SELECT id, name, slug, updated_at
FROM public.tenants
WHERE id = '822481be-039e-481a-b5c4-21d9e002f16c';

COMMIT;
```

Per CLAUDE.md "DB migrations: Supabase SQL editor BEFORE API deploy. Always." — but
in this case the code change is independent of TypeORM `synchronize`: the slug column
already exists, no schema change. So the safe order is:

1. Land the code PR.
2. Deploy API (`cd api && vercel --prod --build-env VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD)`).
3. Run the SQL above in Supabase SQL editor.

Reverse order (SQL first, code later) would briefly break `seed.controller.ts` admin
endpoint; but since seed is admin-only and currently unused customer-facing, this is
not a hard blocker. Recommend code-first for cleanliness.

### Phase 1c — verification

After SQL completes:

- Visit `https://rent-this-dumpster.rentthisapp.com/` → should render tenant landing.
- Visit `https://rent-this-dumpster-mnbxs4jm.rentthisapp.com/` → expect 404 from API
  (`findTenant` returns null → 404). This is the desired post-rename behavior.
- Open any existing quote in the dashboard, click "send" again, confirm the regenerated
  `booking_url` uses the new subdomain.
- Confirm `tenant_settings`-driven URLs (portal, etc.) are unchanged.

### Rollback considerations

- Phase 1a (code): standard `git revert` or revert PR.
- Phase 1b (SQL): inverse UPDATE
  ```sql
  UPDATE public.tenants
  SET slug = 'rent-this-dumpster-mnbxs4jm', updated_at = NOW()
  WHERE id = '822481be-039e-481a-b5c4-21d9e002f16c'
    AND slug = 'rent-this-dumpster';
  ```
  Idempotent. The original suffix `mnbxs4jm` is meaningless (just a base36
  `Date.now()`), so reverting to it is purely cosmetic.

## 12. Compliance with audit charter

- [x] No code changes
- [x] No DB writes (every `execute_sql` was `SELECT` / read-only `DO` block creating temp tables)
- [x] No commit
- [x] No push
- [x] No migration written
- [x] Verdict produced (C)
- [x] Active tenant + target availability confirmed
- [x] DB constraints/indexes inspected
- [x] Code slug usage mapped (URL builders, route params, hardcoded literals, response payloads)
- [x] DB stored-slug sweep across **every** text/varchar/jsonb column for `mnbxs4jm`
- [x] Notification/SMS body columns specifically swept
- [x] Stripe / portal / payment URL builders inspected
- [x] Class-A vs Class-B URL classification produced
- [x] Redirect/no-redirect strategy recommended (no redirect needed)
- [x] Stopped at Phase 0
