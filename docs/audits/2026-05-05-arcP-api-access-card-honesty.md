---
title: arcP — API Access card honesty cleanup
phase: 0 (read-only audit; no mutations)
date: 2026-05-05
predecessors: arcO closed at PR #97 squash `8e26bd8` (small pre-launch cleanup batch)
verdict: SAFE — web-only, no API/DB/env changes. 4 isolated edits in one file.
mutations_in_this_doc: none
---

# arcP — API Access card honesty cleanup

## Goal

Convert the two existing "API Access" / "API Key" cards in Settings to a
clear **Coming Soon / disabled** state. Remove the fake `rta_live_*` key
derived from `tenant.id`. Preserve card location for future real API-key
auth work. **Do NOT build real API key auth in this arc.**

## 1. Current-state inventory

**Two surfaces** in `web/src/app/(dashboard)/settings/page.tsx` render the
same fake key derived from the tenant UUID — confirmed mid-flight:

### Surface A — Integrations tab (`IntegrationsTab`, lines 366–407)

| Line | Current code | Notes |
|---|---|---|
| 367 | `const [showKey, setShowKey] = useState(false);` | local toggle for eye-icon reveal |
| 369 | `const tenantId = profile?.tenant.id \|\| "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";` | placeholder fallback when profile missing |
| 370 | `const apiKey = \`rta_live_${tenantId.replace(/-/g, "").slice(0, 24)}\`;` | **fake-key derivation: strip hyphens from UUID, take first 24 chars, prefix `rta_live_`** ← matches memory |
| 373 | `copyToClipboard` helper | real clipboard write; no network |
| 396–407 | "API Key" card (title + eye toggle + copy button) | Eye/Copy buttons functional but operate on fake string |

> The card on lines 386–393 just above shows the raw `tenantId` UUID with a copy button under "RentThis.com Marketplace → Tenant ID" — that's a **legitimate** integration field (it's how the marketplace identifies the tenant), and is **out of arcP scope.**

### Surface B — Account tab (within `AccountTab`, lines 731–789)

| Line | Current code | Notes |
|---|---|---|
| 731 | `const [showApiKey, setShowApiKey] = useState(false);` | local toggle |
| 742 | `const apiKey = profile?.tenant.id ? \`rta_live_${profile.tenant.id.replace(/-/g, "").slice(0, 24)}\` : "rta_live_...";` | same fake-key derivation; different `useState` name |
| 772–789 | "API Access" card with input + Regenerate Key + API Docs buttons | **Regenerate Key (line 785) and API Docs (line 786) buttons have NO `onClick` handlers — pure UI stubs** |

## 2. Backend orphan check

```bash
grep -rn "api_key|apiKey|api-key|regenerate" api/src --include="*.ts"
```

Result: **zero** matches in any `@Controller` / `@Get`/`@Post` decorator
context relating to public API keys. The only `apiKey` hits are the
internal `RESEND_API_KEY` field in `api/src/modules/notifications/services/resend.service.ts:6,10,15,34` — completely unrelated (Resend's SDK
secret).

**No backend route exists. No fetch/axios calls fire from either Settings
card. The Eye toggle is local React state; the Copy button hits the
browser's clipboard API only; Regenerate and API Docs are pure UI stubs
with no handlers at all.**

This confirms the framing in PR #83's commit message: *"the displayed key
remains deterministically derived from tenant.id with no backend auth."*

## 3. UI mockup / copy decisions

### Reuse pattern: Webhook URL card (PR #82, lines 410–423)

The webhook card just below the API Key card (Surface A) already implements
the right pattern:
- Body copy: *"Coming soon — marketplace webhook endpoints are not enabled for self-service yet."*
- Input: `<code className="… opacity-60">Coming soon</code>` (muted, no value)
- Button: `disabled aria-disabled="true" title="Contact support…" className="… opacity-50 cursor-not-allowed"`

Reuse the same opacity-muted input + disabled-button shape for arcP.

### Final copy (Surface A — Integrations tab "API Key" card)

| Element | Old | New |
|---|---|---|
| Title | API Key | API Key |
| Body | "Use this key for API authentication" | "Coming soon — API keys for integrations are not available yet." |
| Code/value | `rta_live_************************` masked or fake key revealed | `Coming soon` (muted, opacity-60) |
| Eye toggle | functional | **remove** (no value to reveal) |
| Copy button | functional | **remove** (no value to copy) |

### Final copy (Surface B — Account tab "API Access" card)

| Element | Old | New |
|---|---|---|
| Title | API Access | API Access |
| Subtitle (new) | — | small muted line: "Coming soon — API keys are not available yet." |
| Input | masked/revealable fake key | `<input readOnly value="API keys coming soon" disabled aria-disabled="true" className="… opacity-60 cursor-not-allowed" />` |
| Eye toggle | functional | **remove** |
| Regenerate Key button | stub (no onClick) | **remove** (cleanest layout) |
| API Docs button | stub (no onClick) | **remove** (no docs to link to) |

**Buttons: remove rather than disable.** The Regenerate/API Docs buttons in
Surface B have zero behavior already; removing them eliminates dead UI.
The Eye toggles in both surfaces serve no purpose without a real value.

### Badge

Optional small "Coming soon" text indicator (matches existing pattern at
line 428: `<span className="text-[11px] font-semibold text-[var(--t-text-muted)]">Coming Soon</span>`). Inline near each title; no new component
needed.

## 4. Code change preview

| File | Approx Δ | Notes |
|---|---|---|
| `web/src/app/(dashboard)/settings/page.tsx` | ~50 lines deleted, ~20 lines added (net ~−30) | Single file. Touches Surface A (lines 366–407) and Surface B (lines 731–789). |

**Out of code scope:** no new components, no new lucide-react icon
imports, no API changes, no DB migrations, no new tenant-settings
endpoints, no env vars. Removes `Eye`, `EyeOff`, and possibly `Key`
imports if they become unused after the surgery (only if they're not
referenced elsewhere — verify in Phase 1a).

## 5. Multi-vertical / multi-tenant correctness

- The placeholder treatment is universal — no `business_type` branching needed (per CLAUDE.md multi-vertical rule, this isn't waste/dumpster-specific).
- After the change, **no UUID-shaped string is rendered** on either card. The fake-key derivation goes away entirely along with the `tenantId.replace(/-/g, "").slice(0, 24)` substring construction. The `tenantId` const on Surface A line 369 is still needed for the **Marketplace Tenant ID** field at line 388 (which is legitimate and out of scope).
- No tenant data leaks remain in the API Access cards.
- No registry override needed — none of these strings are user-facing labels in the registry sense; they're inline copy. (CLAUDE.md "NO REGISTRY BYPASS" rule applies to feature labels; ad-hoc card copy stays inline per existing precedent at lines 410, 769, etc.)

## 6. Verification plan for Phase 1

1. **DOM scan after deploy.** Load `/settings` → both Integrations and Account tabs → for each tab, view-source / inspect the API Access card region. Confirm:
   - No literal `rta_live_` substring in the rendered DOM under the API Access cards.
   - No 32-hex-character substring (would indicate a UUID derivation surviving).
   - Disabled/muted styling renders per design system.
2. **Functional check.** Eye/Copy/Regenerate buttons either gone or have no clickable behavior (cursor: not-allowed; no clipboard fires; no console errors).
3. **No new network requests.** DevTools Network tab during the Settings page load does not show any new endpoint hit (since arcP is purely a removal).
4. **Other Settings tabs unaffected.** Smoke-check the rest of Settings (Profile, Website, Quotes, Billing, etc.) renders identically.

## 7. Out of scope (recorded explicitly)

- **Real API key auth system** — deferred to a future integration-readiness arc. Will require: `tenant_api_keys` (or equivalent) table; bcrypt-hashed keys; canonical `rta_live_*` prefix convention; per-key scopes; key create/list/revoke UI; `JwtAuthGuard`-equivalent middleware (or new `ApiKeyGuard`); audit log entries; rate limiting per key; public docs.
- **`support@rentthisapp.com` contact link** — depends on the support mailbox being provisioned (per memory; not yet live). The "Contact support" copy from the webhook card at line 417 is acceptable to mirror only if the mailbox stands up, otherwise omit.
- **Marketplace Tenant ID field** at lines 386–393 (Surface A) — legitimate integration field, out of arcP scope.
- **Webhook URL card** at lines 410–423 (Surface A) — already correctly handled in PR #82; arcP reuses the pattern but doesn't re-touch this card.
- **2FA "Coming soon"** at line 769 — already correctly handled, out of scope.

## 8. Phase plan

| Phase | Owner | Action |
|---|---|---|
| **0** (this doc) | Claude Code | Audit doc only; no board card created in Phase 0 (Anthony explicitly held that mutation back). |
| 1a | Claude Code | Single-file code change → PR → squash-merge. Web auto-deploys on merge. |
| 1b | Claude Code | Post-deploy `/settings` spot-check (DOM scan for leaks; basic render verification on both tabs). |
| 1c | Claude Code | Closure docs PR (`arc-state.md` §11 entry + audit closure footnote) + flip board card Ready → Done (assuming Phase 0 board card lands separately). |

> Note: arcO introduced "card created at scoping (Phase 0, Ready)" as the workflow refinement. arcP follows the same pattern *if* Anthony approves the Phase 0 board card creation as a follow-up step — the audit charter for arcP explicitly held that mutation. If we skip it, arcP reverts to the arcL/arcM/arcN retroactive-Done pattern.

## Verdict: **SAFE**

- Single web-only file. No API / DB / env / domain / OAuth / Stripe touch.
- No backend route to remove (orphan check confirmed zero).
- Reuses existing in-file webhook coming-soon treatment as the visual precedent.
- Memory's anticipation matched current code: fake key IS UUID-derived, exactly as flagged.
- No ambiguous decisions remain that need Anthony's input before Phase 0 board-card creation.

---

## Closure footnote (appended 2026-05-05 at Phase 1c)

arcP closed end-to-end. Recording actual identifiers from the live execution.

| Phase | Identifier | Notes |
|---|---|---|
| 1a — PR-1 squash SHA | `0896084319bdd105195a218284b6193f8648f9f5` | PR [#99](https://github.com/adepaolo456/serviceos/pull/99), 1 file, +13/−23 |
| 1a — files touched | `web/src/app/(dashboard)/settings/page.tsx` | only file; both `IntegrationsTab` and `AccountTab` API cards converted; `Eye, EyeOff` dropped from lucide import |
| 1a — typecheck | `tsc --noEmit` clean | pre-commit |
| Web auto-deploy id | `dpl_2AZHLWJ7jJEEHK8TpUZfayS3zkUe` | READY at `2026-05-05T15:06:21Z`, 3 seconds post-merge |
| 1b — bundle verification | 15 dashboard chunks scanned, 1.2MB total | scorecard below |
| 1c — closure docs PR | (this commit) | arc-state.md §11 entry + this footnote + flip #98 Done |

### Phase 1b verification scorecard

| Criterion | Required | Actual | Chunks with hits |
|---|---|---|---|
| `rta_live_` | 0 | **0** ✓ | none |
| `tenant.id.replace` | 0 | **0** ✓ | none |
| `tenantId.replace` | 0 | **0** ✓ | none |
| `API keys coming soon` | ≥ 1 | **2** ✓ | `04g2l6_tp_08-` |
| `Coming soon — API keys` | ≥ 1 | **2** ✓ | `04g2l6_tp_08-` |
| 32-hex UUID-stripped substring | informational | **0** ✓ | none |
| Other Settings tabs intact | non-zero | Profile=4, Website=4, Quotes=5, Billing=31, Integrations=1, Account=12, Notifications=9 | spread across chunks |

The "2" count for each new copy string corresponds exactly to the two converted surfaces (IntegrationsTab + AccountTab), both rendering from the same dashboard page chunk `04g2l6_tp_08-`.

### Phase 1b debugging detour (recovered, no impact on results)

Two transient issues during Phase 1b verification, both procedural, neither affecting the production deploy or the verification verdict:

- **PATH corruption after `vercel inspect`** in the same Bash session caused `command not found` for `curl`/`ls`/`head`/`wc` in subsequent calls. Recovered by setting an explicit `PATH` at the top of follow-up calls and falling back to absolute paths.
- **Initial chunk-download loop** used `for c in $MULTILINE_VAR` which produced 0-byte output files (entire multi-line string treated as one iteration item). Diagnostic clue: per-criterion grep returned 0 hits for known-good control strings like "Profile". Re-ran with `while IFS= read -r line; do … done < heredoc.txt` and got proper chunk content (1.2MB across 15 chunks).

Lessons recorded in `arc-state.md` §11 for future arcs.

### Per-item closure status

1. **IntegrationsTab "API Key" card** — fake-key derivation removed, Eye + Copy buttons removed, body shows "API keys coming soon" muted. Verified via deployed bundle.
2. **AccountTab "API Access" card** — fake-key derivation removed, Eye toggle + Regenerate Key + API Docs buttons removed, input shows "API keys coming soon" disabled. Verified via deployed bundle.
3. **`Eye, EyeOff` lucide-react import** — dropped (now unused after both cards lose the toggle). Typecheck clean.

### Permanent retention

No long-running aliases, env vars, or infrastructure introduced. arcP was a pure removal of fake credential-shaped UI; the future real API-key auth arc will reintroduce real key management in a deliberate location.

### Manual TODO post-closure (Anthony)

Browser-only DOM verification (CLI can't authenticate). Load `/settings` as authenticated tenant; switch through Integrations and Account tabs; confirm both API Access cards render the disabled Coming Soon states with no Eye/Copy/Regenerate/API Docs buttons; confirm DevTools Network shows zero requests to `*regenerate*`/`*api-keys*`/`*api-docs*`; confirm DOM has no `rta_live_…` or 32-hex UUID-stripped substring in either card region.
