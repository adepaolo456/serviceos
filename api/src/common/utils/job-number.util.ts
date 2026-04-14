import { EntityManager } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

/**
 * Issue the next tenant-scoped sequential job number.
 *
 * Format: `<prefix>-<sequence>` where prefix is one of
 *   D = delivery, P = pickup, X = exchange, J = fallback (unknown type)
 * and sequence is an integer drawn from `tenants.next_job_sequence`.
 *
 * Atomicity: the SQL executes a single `UPDATE ... RETURNING` that
 * increments the counter and hands back the value that was present
 * *before* the increment. Two concurrent calls never see the same
 * number — Postgres serializes the row update. If the caller is
 * inside a transaction and rolls back, the skipped sequence number
 * is discarded; gapless issuance is NOT required.
 *
 * Call sites inside a transactional flow should pass the outer
 * transaction's `EntityManager` so the read-your-writes guarantee
 * holds within that transaction.
 *
 * Historical `JOB-YYYYMMDD-...` values are never touched — this
 * generator only issues numbers for brand-new jobs. The display
 * helper `formatJobNumber()` in the web package renders both shapes.
 *
 * This function lives in `common/utils` (rather than on any single
 * service) because `JobsService`, `RentalChainsService`,
 * `PublicService`, `MarketplaceService`, etc. all need to issue job
 * numbers and a module-level helper avoids the circular-dependency
 * web that an inter-service call would create.
 */
export async function issueNextJobNumber(
  manager: EntityManager,
  tenantId: string,
  jobType: string,
): Promise<string> {
  const prefix =
    jobType === 'delivery'
      ? 'D'
      : jobType === 'pickup'
        ? 'P'
        : jobType === 'exchange'
          ? 'X'
          : 'J';
  // The `- 1` in RETURNING yields the pre-increment value, so the
  // very first call for a tenant whose next_job_sequence starts at
  // 1001 returns 1001 (producing e.g. "D-1001"), and the next call
  // returns 1002. Postgres evaluates the RETURNING expression over
  // the NEW row, hence the explicit subtraction.
  const rows = await manager.query(
    `UPDATE tenants
       SET next_job_sequence = next_job_sequence + 1
     WHERE id = $1::uuid
     RETURNING next_job_sequence - 1 AS issued_sequence`,
    [tenantId],
  );
  const issued = rows?.[0]?.issued_sequence;
  if (issued == null) {
    throw new NotFoundException(`Tenant ${tenantId} not found`);
  }
  return `${prefix}-${issued}`;
}
