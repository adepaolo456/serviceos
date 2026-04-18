/**
 * pg decimal coercion investigation — pure unit tests for the
 * `Number(row[0]?.field) || 0` pattern used ~60 times in
 * `reporting.service.ts` to convert node-postgres NUMERIC/BIGINT
 * string returns into JS numbers for wire-DTO emission.
 *
 * Investigation-only spec. NO database connection. NO TypeORM. NO
 * production code modified. Each test pins a specific boundary in
 * the coercion pipeline so we can answer:
 *   1. Where does `Number()` return NaN, and is the `|| 0` fallback
 *      the right behavior?
 *   2. Where does `Number()` lose precision (above 2^53)?
 *   3. Is the `|| 0` ever silently wrong (i.e., does it mask a
 *      legitimate negative-or-zero value)?
 *
 * Naming: `.spec.ts` to match the project's
 * `testRegex: ".*\\.spec\\.ts$"` (jest config in api/package.json).
 *
 * If any of these assertions ever flip, the report finding (see
 * /tmp/pg-decimal-coercion-finding.md at investigation time) needs
 * to be revisited.
 */

const coerce = (raw: unknown): number => Number(raw) || 0;

describe('pg decimal coercion — Number(raw) || 0', () => {
  describe('typical pg-driver returns (NUMERIC/BIGINT as string)', () => {
    test('SUM(numeric) typical money string → exact number', () => {
      expect(coerce('1234567.89')).toBe(1234567.89);
    });

    test('COUNT(*) bigint string → integer', () => {
      expect(coerce('42')).toBe(42);
    });

    test('COALESCE(SUM(...), 0) returning "0" → 0', () => {
      expect(coerce('0')).toBe(0);
    });

    test('COALESCE(SUM(...), 0) returning "0.00" → 0', () => {
      expect(coerce('0.00')).toBe(0);
    });
  });

  describe('NULL / missing-row boundaries', () => {
    test('SUM with no matching rows (NULL) → 0', () => {
      // Number(null) === 0; `|| 0` is redundant but harmless here.
      expect(coerce(null)).toBe(0);
    });

    test('row[0] undefined (empty result set, optional-chained) → 0', () => {
      // Number(undefined) === NaN; `|| 0` collapses NaN to 0. This is
      // the load-bearing case for the `|| 0` fallback.
      expect(coerce(undefined)).toBe(0);
    });
  });

  describe('precision boundaries', () => {
    test('value just below MAX_SAFE_INTEGER → exact', () => {
      const safe = '9007199254740991'; // 2^53 - 1
      expect(coerce(safe)).toBe(9007199254740991);
    });

    test('value above MAX_SAFE_INTEGER → silent precision loss', () => {
      // Documents the theoretical risk surface: pg returns NUMERIC
      // as string to preserve precision; `Number()` collapses it
      // back into a 64-bit float. For money columns capped at
      // numeric(p, s) where p ≤ 14 this is unreachable today.
      const overflow = '9007199254740993'; // 2^53 + 1
      expect(coerce(overflow)).toBe(9007199254740992); // NOT 993
    });
  });

  describe("|| 0 fallback semantics — when it matters and when it doesn't", () => {
    test('negative SUM (refunds > collections) survives the || 0 fallback', () => {
      // -100.5 is truthy under `||`, so it passes through unchanged.
      // This is the exact reason `|| 0` is safe for refund/credit
      // columns: only NaN and 0 are masked.
      expect(coerce('-100.50')).toBe(-100.5);
    });

    test('garbage string (schema invariant violated) → silently 0', () => {
      // If the DB ever returned a non-numeric string in a numeric
      // column (only possible under schema corruption), `|| 0` would
      // mask it as 0 with no observability. Documented risk; not
      // reachable on the current schema.
      expect(coerce('not-a-number')).toBe(0);
    });
  });
});
