# 0001 — Monorepo structure (NestJS + Next.js + shared root)

**Status:** accepted
**Date:** 2026-04-30

## Context

ServiceOS needs a backend API (multi-tenant business logic, Stripe integration, dispatch, billing, notifications) and at least three frontend surfaces (main tenant web app, customer portal, driver app — currently web; eventually native mobile). All three frontends consume the same API and share types, validation rules, and feature-flag definitions.

The choice was: separate repos per surface, or a single monorepo containing API + all frontends + shared code.

## Options considered

### Option A: Separate repos per surface
- `serviceos-api` (NestJS)
- `serviceos-web` (Next.js — main app)
- `serviceos-portal` (Next.js — customer portal)
- `serviceos-driver` (React Native or Next.js)
- `serviceos-shared` (TypeScript types, validation, feature registry)

Pros: clear boundary, smaller per-repo CI surface, separate deploy independence, each repo fits one developer's mental model
Cons: cross-repo coordination cost (a contract change requires PRs in 3-4 repos), version drift on shared types, slower iteration, complex local dev setup, harder to refactor across boundaries

### Option B: Monorepo with shared root
- Single `serviceos` repo containing `api/`, `web/`, future `portal/`, future `driver/`, plus shared code at root
- One CI pipeline, one PR for cross-cutting changes, one local dev environment

Pros: atomic cross-surface changes (API contract + frontend consumer in one PR), no version drift, faster iteration, easier refactoring, single source of truth for types and feature registry
Cons: larger CI surface (mitigated by path-filtered checks), repo grows over time, requires care to keep code modular

### Option C: Polyrepo with shared package via npm
- Separate repos but shared types published as private npm package
- `serviceos-shared` published, consumed by all surfaces

Pros: clear boundary like Option A, but with shared types
Cons: still need version bumps + republish for every shared change, all the cross-repo coordination cost of Option A, plus the publishing overhead

## Decision

**Option B — monorepo with shared root.** Single `serviceos` repo containing `api/` (NestJS) + `web/` (Next.js) + future surfaces. Shared code (TypeScript types, feature registry, theme tokens) lives at the root or in shared packages within the monorepo.

Rationale:

1. **Solo founder mode.** Cross-repo coordination cost is paid every time a contract changes. With one developer, that cost is pure overhead — the boundary doesn't protect anyone, it just slows shipping.
2. **Atomic cross-cutting changes.** Adding a new feature with API + frontend changes is one PR, one review, one merge. With separate repos, it's at minimum 2 PRs that must merge in a specific order.
3. **No version drift.** Types are imported directly from source, not from a published package. A breaking change to a type is caught at compile time in every consumer immediately.
4. **CI is path-filtered.** `api unit tests` only runs on `api/**` changes. Docs PRs don't trigger code checks. Web changes don't trigger API tests. The monorepo's CI cost is bounded.

## Consequences

**Locked in:**
- Single `serviceos` repo at `github.com/adepaolo456/serviceos`
- Single deploy target per surface (api, web each deploy from this repo)
- All future surfaces (portal, driver app, admin app) live in this repo
- Shared code lives at root or in workspace packages — never re-published

**Left open:**
- Internal package boundaries (e.g., `packages/shared-types/`, `packages/feature-registry/`) can be added later without leaving the monorepo
- Driver app could be React Native or Next.js — either way it lives here
- If a true public-API consumer emerges (third-party integration), we could publish a typed client package without splitting the monorepo

**Reversal cost:**
- Splitting the monorepo later is doable but expensive. Estimated 1-2 weeks of work to extract API into its own repo, plus ongoing coordination cost forever after.
- We would only reverse if the team grew to a size where merge conflicts on the monorepo became a meaningful drag (probably 8+ developers).

## Related

- CLAUDE.md — operational rules reference monorepo paths (`~/serviceos`, `api/**`, `web/**`)
- ADR 0002 — multi-tenant architecture (app-layer tenant filtering and shared tenant-context patterns live in `api/`)
- ADR 0003 — Stripe as sole payment provider (Stripe SDK lives in `api/`)
