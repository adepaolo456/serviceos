/**
 * Between-test database reset. Enumerates all user tables in the public
 * schema and truncates them with CASCADE + RESTART IDENTITY. Cheaper and
 * more reliable than per-test transaction rollback in NestJS + supertest.
 */
import { DataSource } from 'typeorm';

export async function resetDb(ds: DataSource): Promise<void> {
  const rows: Array<{ tablename: string }> = await ds.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT LIKE 'sql_%'
  `);
  if (rows.length === 0) return;
  const quoted = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await ds.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}
