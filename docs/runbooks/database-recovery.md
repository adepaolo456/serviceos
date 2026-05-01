# Database Recovery Runbook

> Use when database state is corrupted, lost, or accidentally mutated.
> Always halt writes BEFORE recovery actions. Do not race the recovery against ongoing API writes.

## Supabase backup state

**Current assumption:** Supabase Pro plan provides automated backups and Point-in-Time Recovery (PITR). **Verify exact retention and PITR window in the Supabase dashboard before relying on a recovery window.** Plans, retention windows, and PITR availability change over time; runbooks age.

Backup location: managed by Supabase, accessible via dashboard → Project Settings → Database → Backups.

**Project ID:** `voczrzbdukgdrirmlgfw`
**URL:** https://supabase.com/dashboard/project/voczrzbdukgdrirmlgfw/database/backups

## Recovery scenarios

### Scenario 1: Single table corruption

Symptoms: failing query, mismatched counts, RLS policy unexpectedly removing rows, foreign key violations.

1. **Identify corruption.** Capture the failing query + result so you can verify recovery later.
2. **Halt API writes.** Either deploy maintenance mode (if configured) OR revert recent migration that introduced the corruption.
3. **Capture pre-recovery state:**
```sql
CREATE TABLE recovery_<table>_<YYYYMMDD> AS SELECT * FROM <table>;
```
4. **From Supabase dashboard, restore the affected table from backup.** This requires Supabase support for table-level restore on Pro plan; PITR is the self-serve path.
5. **Verify with read-only queries.** Same queries that failed in step 1 should now succeed.
6. **Re-enable API writes.** Deploy without maintenance flag.
7. **Document in `docs/incidents/<date>-<slug>.md`.**

### Scenario 2: Full database loss

Symptoms: Supabase project shows DB unavailable, schema missing, complete data loss.

1. **Halt all API/web writes.** Pause Vercel project (Settings → General → Pause).
2. **From Supabase dashboard:** Project Settings → Database → Backups → Restore to a new project (preserves the lost project's state for forensics).
3. **Verify schema matches main branch entity definitions:**
```bash
cd ~/serviceos/api
npm run typeorm:check 2>&1 | head -50
```
4. **Re-run any post-restoration migrations** not in the backup. Use `api/migrations/` directory + Supabase migration history.
5. **Verify with smoke tests:** customer login, invoice load, payment flow, dispatch board, driver app login.
6. **Re-enable API/web** by un-pausing Vercel project.

### Scenario 3: Logical corruption (bad migration, accidental UPDATE)

Symptoms: data is "wrong" but schema is intact. Examples: bulk UPDATE that overwrote tenant_id, migration that backfilled wrong defaults, deleted rows that shouldn't have been deleted.

1. **Identify time of corruption** from commit log, change history, or `audit_log` table if applicable.
2. **PITR to T-1 minute before corruption** via Supabase dashboard → Database → Backups → Point-in-Time → restore to new project.
3. **Diff post-restoration vs pre-corruption** to identify what data was lost between T-1 and now:
```sql
-- Run on the restored project to get the "good" state
COPY (SELECT * FROM <affected_table>) TO '/tmp/good_state.csv' WITH CSV HEADER;
-- Compare against current production state
```
4. **Manual reconciliation** of any data created/modified between T-1 and now that needs to be preserved.
5. **Decide:** restore to production, or migrate verified-good data into existing production. Restoring to production is faster but loses any legitimate work since T-1.

## Test the recovery procedure (quarterly)

Once per quarter, before the next quarter starts:

1. Spin up a new Supabase project OR a local Postgres instance.
2. Restore from a Supabase backup file (download dump from Backups dashboard).
3. Run schema check + smoke tests on the restored DB.
4. **Document time elapsed** — how long does recovery actually take, end to end?
5. **Update this runbook** with anything learned (e.g., "PITR took 8 minutes for 2GB of data").

## Known recovery time

| Test date | Scenario | Time elapsed | Notes |
|---|---|---|---|
| (To be filled in after first quarterly test) | | | |

## Critical data NOT in primary DB (recoverable from elsewhere)

- **Stripe subscription state** — recoverable via Stripe API (`stripe.subscriptions.list`)
- **Stripe Connect account state** — recoverable via Stripe API (`stripe.accounts.retrieve`)
- **Twilio message logs** — lost on Twilio side after retention window (~30 days for trial, longer for paid)
- **Vercel deploy history** — recoverable via Vercel dashboard (independent of DB)
- **GitHub repo** — independent of DB
- **Sentry events** — independent of DB, retained per Sentry plan

## Critical data NOT recoverable if primary DB lost

- **In-flight invoices not yet paid via Stripe** — manual reconstruction from job + line item history if possible
- **SMS opt-out preferences** — must be re-collected from customers (regulatory exposure here)
- **Customer portal magic-link tokens** — reissue, customers re-authenticate
- **Driver app session tokens** — drivers must log in again

## Standing rules during database recovery

- **Capture state before mutating.** Always `CREATE TABLE recovery_<table>_<date> AS SELECT * FROM <table>` before reconciliation writes.
- **One person runs SQL at a time.** No concurrent writes during recovery.
- **Verify by reading, not by trusting.** Re-run the failing query after recovery; do not assume "the restore worked."
- **Document every SQL statement run** during recovery in the incident report.
- **Two-person approval** for any DELETE or UPDATE during recovery.
- **No speculative fixes.** Reproduce or root-cause first.
