# Architecture Decision Records (ADRs)

Lightweight log of non-audit-grade architectural decisions. For audit-grade decisions on billing, race, and money-flow correctness, see `docs/audits/`.

## When to write an ADR

Write an ADR when:

- Choosing a vendor, library, or service that we'd be hard to switch from later
- Architectural patterns that future code should follow (e.g., multi-tenant filtering posture)
- Significant trade-offs we made consciously (e.g., monorepo vs separate repos)
- Decisions a future contributor (or future-Claude / future-self) would ask "why did we do it this way?"

Don't write an ADR when:

- The decision is captured in CLAUDE.md operational rules (those are standing rules, not architectural decisions)
- The decision is captured in an audit doc (those are durable correctness decisions on billing/race issues)
- The decision is reversible cheaply (e.g., button color, naming a variable)
- The decision is genuinely small and uncontroversial

## Format

Each ADR is one markdown file: `NNNN-slug.md` where NNNN is sequential, zero-padded to 4 digits.

Each file has these sections:

- **Status**: proposed / accepted / deprecated / superseded
- **Date**: when accepted
- **Context**: what triggered the decision (the situation forcing the choice)
- **Options considered**: what alternatives were on the table
- **Decision**: what we chose and why
- **Consequences**: what does this lock in, what does it leave open, what would it cost to reverse

ADRs are durable. Once accepted, an ADR is not edited. If the decision changes, write a new ADR that supersedes the old one (mark the old one's status as `superseded by NNNN`).

## Index

| # | Title | Status | Date |
|---|---|---|---|
| 0001 | [Monorepo structure (NestJS + Next.js + shared root)](0001-monorepo-structure.md) | accepted | 2026-04-30 |
| 0002 | [Multi-tenant architecture (JWT-derived tenant_id, app-layer filtering, RLS defense-in-depth)](0002-multi-tenant-architecture.md) | accepted | 2026-04-30 |
| 0003 | [Stripe as sole payment provider](0003-stripe-as-sole-payment-provider.md) | accepted | 2026-04-30 |

## Cadence

ADRs are written when an architectural decision is made. Not on a schedule. The right test: when you're about to make a non-trivial choice, ask "would future-me (or a contractor) want to know why we chose this?" — if yes, write an ADR.

## References

- Inspired by Michael Nygard's ADR template (2011) — https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- Composes with: `docs/audits/` (billing/race correctness), CLAUDE.md (operational rules), `docs/runbooks/` (incident procedures), `docs/arc-state.md` (forward-looking arc state)
