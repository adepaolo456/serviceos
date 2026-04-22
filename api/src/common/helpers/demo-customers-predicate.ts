/**
 * Demo-customer exclusion predicates.
 *
 * Single source of truth for removing demo-tagged customers from analytics
 * aggregates. Apply ONLY to dashboard / KPI / reporting surfaces. Never
 * apply to operational lists, per-customer detail pages, driver productivity
 * metrics, or data-integrity audits — those must remain inclusive.
 *
 * Schema anchor: customers.tags is jsonb NOT NULL DEFAULT '[]'::jsonb with
 * GIN index idx_customers_tags_gin (tags jsonb_path_ops).
 *
 * Narrowing-only contract: these predicates REMOVE rows. They never widen
 * access. Callers must still apply tenant_id scoping themselves — this
 * helper does not replace that.
 *
 * Pattern rules (locked Phase 2a):
 *   - DIRECT (customers joined in query): use excludeDemoCustomers(alias)
 *   - INDIRECT: use excludeDemoByCustomerId{Named,Dollar} — emits NOT EXISTS
 *   - NOT IN is banned (NULL-semantics and schema-drift safety)
 *   - The subquery alias is always 'demo_c' to prevent collision with outer
 *     query aliases (c, customer, cu, customers)
 */

export const DEMO_TAG_LITERAL = `'["demo"]'::jsonb`;

/**
 * Predicate for queries that already have customers joined.
 *   usage: qb.andWhere(excludeDemoCustomers('c'))
 *   usage: `WHERE ${excludeDemoCustomers('customer')} AND ...`
 */
export function excludeDemoCustomers(customerAlias: string): string {
  return `NOT (${customerAlias}.tags @> ${DEMO_TAG_LITERAL})`;
}

/**
 * Predicate for queries that aggregate over a customer-linked table
 * (invoices, jobs, payments, dump_tickets, rental_chains, etc.) WITHOUT
 * joining customers. Named-parameter form for QueryBuilder.
 *
 *   usage:
 *     qb.andWhere(excludeDemoByCustomerIdNamed('i.customer_id', 'tenantId'),
 *                 { tenantId });
 */
export function excludeDemoByCustomerIdNamed(
  fkExpr: string,
  tenantIdParam: string,
): string {
  return `NOT EXISTS (
    SELECT 1 FROM customers demo_c
    WHERE demo_c.id = ${fkExpr}
      AND demo_c.tenant_id = :${tenantIdParam}
      AND demo_c.tags @> ${DEMO_TAG_LITERAL}
  )`;
}

/**
 * Dollar-sign form for raw SQL via dataSource.query().
 *
 *   usage:
 *     `WHERE i.tenant_id = $1 AND ${excludeDemoByCustomerIdDollar('i.customer_id', 1)}`
 */
export function excludeDemoByCustomerIdDollar(
  fkExpr: string,
  tenantIdDollarIndex: number,
): string {
  return `NOT EXISTS (
    SELECT 1 FROM customers demo_c
    WHERE demo_c.id = ${fkExpr}
      AND demo_c.tenant_id = $${tenantIdDollarIndex}
      AND demo_c.tags @> ${DEMO_TAG_LITERAL}
  )`;
}
