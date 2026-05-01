# Incident Response Runbook

> Use when production is degraded or down. Fast triage first, root cause second.
> When in doubt, halt writes and ask. A 30-min outage with clean state beats a 2-hour outage with corrupted billing data.

## Severity levels

- **SEV-1** (critical): production down, customers can't access platform, money flows broken, billing accuracy compromised
- **SEV-2** (high): partial outage, single tenant affected, SMS/email failing for all tenants, dispatch board broken
- **SEV-3** (medium): non-critical feature broken, workaround available, single endpoint failing
- **SEV-4** (low): cosmetic issue, no customer impact

## SEV-1 immediate actions (in order, do not skip)

1. **Confirm scope.** Hit production URL. Can you log in? Can a customer load their portal? Can a driver load the app?
2. **Check Vercel deployment status.** https://vercel.com/adepaolo456s-projects — is the latest deploy green or red?
3. **Check Supabase health.** https://supabase.com/dashboard/project/voczrzbdukgdrirmlgfw — DB up? CPU/memory pinned?
4. **Check Stripe dashboard.** https://dashboard.stripe.com — webhook endpoints healthy? Recent webhook delivery failures?
5. **Recent deploy suspect?** ROLLBACK first, investigate after. Code can be re-deployed; corrupted DB state cannot be unrolled cheaply.
6. **DB suspect?** Halt writes (deploy maintenance flag OR pause Vercel project), escalate to Supabase support.
7. **Communicate to affected tenants.** Direct phone/SMS for SEV-1 — do NOT rely on in-app banner during an outage. Owner Anthony's phone is the channel.

## Rollback procedures

### Rollback web (auto-deploys on push)

```bash
cd ~/serviceos
git revert <bad-sha> --no-edit
git push origin main
# Vercel auto-deploys the revert. Check https://vercel.com for green status.
```

### Rollback API (manual deploy required)

```bash
cd ~/serviceos
git revert <bad-sha> --no-edit
git push origin main
cd api
vercel --prod --build-env VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD)
```

The `--build-env VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD)` flag is REQUIRED for Sentry release pinning. Without it, Sentry releases tag as `cli-deploy-<UTC-ts>-no-sha` and incident attribution breaks.

### Rollback DB migration

DB migrations are NOT auto-reverted on git revert. Each migration in `api/migrations/` should have a corresponding rollback noted in its comments.

```sql
-- Apply rollback SQL via Supabase SQL editor
-- Sequence:
-- 1. API revert FIRST (so code stops referencing the migrated schema)
-- 2. Verify API is on the pre-migration commit
-- 3. Run rollback SQL
-- 4. Verify schema with: SELECT * FROM information_schema.tables WHERE table_schema='public';
```

If the migration introduced a NOT NULL column without a default, rollback is straightforward (DROP COLUMN). If it backfilled data, capture the pre-migration state from a Supabase backup BEFORE rolling back.

## Provider escalation contacts

| Provider | Console | Support |
|---|---|---|
| Stripe | dashboard.stripe.com | Dashboard chat (24/7), 1-888-963-8955 |
| Twilio | console.twilio.com | help.twilio.com |
| Supabase | supabase.com/dashboard | supabase.com/dashboard/support |
| Vercel | vercel.com/dashboard | vercel.com/help |
| Mapbox | account.mapbox.com | support@mapbox.com |
| Resend | resend.com/dashboard | support@resend.com |

## Phantom-paid recovery procedure (Apr 29 incident template)

If invoices show paid status without corresponding Payment rows:

1. **Identify affected invoices:**
```sql
-- Phantom-paid: invoice marked paid but no completed Payment rows exist
-- Net-paid math per PR #20: SUM(payments.amount - COALESCE(payments.refunded_amount, 0))
SELECT i.id, i.tenant_id, i.amount_paid, i.balance_due, i.status, i.customer_id,
       (SELECT COALESCE(SUM(p.amount - COALESCE(p.refunded_amount, 0)), 0)
        FROM payments p
        WHERE p.invoice_id = i.id AND p.status = 'completed') AS actual_net_paid
FROM invoices i
WHERE i.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.invoice_id = i.id
      AND p.status = 'completed'
      AND (p.amount - COALESCE(p.refunded_amount, 0)) > 0
  )
ORDER BY i.created_at DESC;
```

2. **Identify producer.** Most likely candidates (in order of historical likelihood):
   - `seed.controller.ts:saveInv` direct write with status=paid + no Payment row (closed Apr 29 via prod env gate: `NODE_ENV === 'production' && SEED_ENABLED unset && SEED_SECRET unset`)
   - Cancellation race in `JobsService.remove()` mid-transaction failure
   - Webhook bypass write at `stripe.service.ts` Site 4 — identified in PR #22 audit; pending PR-C2. This path is masked today but must not be considered closed until PR-C2 ships.
   - Direct `invoiceRepo`/invoice field writes bypassing canonical `reconcileBalance()`: sync Sites 1 + 2 closed in PR #21; webhook Sites 3 + 4 remain pending PR-C2.

3. **Reconcile.** For each affected invoice, run `reconcileBalance()` via admin endpoint OR direct SQL update setting `amount_paid = SUM(payments.amount - COALESCE(payments.refunded_amount, 0))` for completed payments, then derived `balance_due = total - amount_paid`, `status = ...` per invoice rules.

4. **Verify.** Re-run query from step 1, should return 0 rows.

5. **Document.** Log incident in `docs/incidents/<date>-<slug>.md` for future reference. Include: timeline, root cause, affected invoice IDs, reconciliation SQL run, prevention measures.

## Communication template

For SEV-1/SEV-2 affecting customer-visible flows:

> **Subject: [Service Disruption] Brief description**
>
> We've identified an issue affecting [scope: e.g., new bookings / payment processing / SMS notifications]. Estimated impact: [duration: e.g., next 30 minutes].
>
> We're actively working on resolution and will send updates every 30 minutes until resolved.
>
> If you're blocked from a critical workflow, reply to this message and we'll prioritize your case.
>
> [Owner name + direct contact]

## Post-incident

1. **Write incident report:** timeline, root cause, customer impact, mitigation steps, prevention measures.
2. **File issue with `type:bug-from-prod` label** so it shows up in P0 review next session.
3. **Update CLAUDE.md** if a new operational rule emerges (e.g., "do not direct-write invoice status").
4. **Add to `docs/incidents/` directory** with the date-slug filename pattern.
5. **Cross-link in `docs/arc-state.md` Update log** so future-Claude sees this incident in session-start context.

## What to capture in the incident report

- **When did it start?** First customer report timestamp + first internal detection timestamp.
- **When did it end?** Mitigation deployed timestamp + verified-clean timestamp.
- **What broke?** Specific code path, table, integration.
- **Why?** Direct cause + contributing factors.
- **Who was affected?** Tenant count, customer count, $ impact if money-flow related.
- **What did we do?** Step-by-step actions taken, including dead ends.
- **What should we do differently?** Process improvements, code changes, monitoring additions.

## Standing rules during incident response

- **Do NOT make speculative fixes.** Reproduce or root-cause first. Speculative fixes during incidents make follow-up worse.
- **Do NOT bypass audit gates** even under pressure. The phantom-paid Apr 29 incident was investigated read-only first; reconciliation only after producer was confirmed.
- **Communicate progress every 30 min** to affected tenants during SEV-1.
- **Capture state before mutating** during recovery (backup affected rows to a `recovery_<date>` table before reconciling).
- **Two-person rule for production DB writes** during recovery: state the SQL, get explicit "approved" before running.
