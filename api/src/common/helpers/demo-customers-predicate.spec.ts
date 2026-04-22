import {
  DEMO_TAG_LITERAL,
  excludeDemoByCustomerIdDollar,
  excludeDemoByCustomerIdNamed,
  excludeDemoCustomers,
} from './demo-customers-predicate';

describe('demo-customers-predicate', () => {
  describe('excludeDemoCustomers (DIRECT)', () => {
    it("returns NOT (c.tags @> '[\"demo\"]'::jsonb) for alias 'c'", () => {
      expect(excludeDemoCustomers('c')).toBe(
        `NOT (c.tags @> ${DEMO_TAG_LITERAL})`,
      );
    });

    it("returns the predicate with a 'customer' alias", () => {
      expect(excludeDemoCustomers('customer')).toBe(
        `NOT (customer.tags @> ${DEMO_TAG_LITERAL})`,
      );
    });

    it('is stable across calls (no whitespace drift)', () => {
      expect(excludeDemoCustomers('c')).toBe(excludeDemoCustomers('c'));
    });
  });

  describe('excludeDemoByCustomerIdNamed (INDIRECT)', () => {
    const out = excludeDemoByCustomerIdNamed('i.customer_id', 'tid');

    it('emits NOT EXISTS with demo_c alias, tenant-scoped, tag-filtered', () => {
      expect(out).toContain('NOT EXISTS');
      expect(out).toContain('demo_c.id = i.customer_id');
      expect(out).toContain('demo_c.tenant_id = :tid');
      expect(out).toContain(`demo_c.tags @> ${DEMO_TAG_LITERAL}`);
    });

    it("uses 'demo_c' as the subquery alias — not 'c' / 'customer' / 'customers'", () => {
      expect(out).toContain('FROM customers demo_c');
      expect(/\bFROM customers c\b/.test(out)).toBe(false);
      expect(/\bFROM customers customer\b/.test(out)).toBe(false);
      expect(/\bFROM customers customers\b/.test(out)).toBe(false);
    });

    it('is stable across calls (no whitespace drift)', () => {
      expect(excludeDemoByCustomerIdNamed('i.customer_id', 'tid')).toBe(
        excludeDemoByCustomerIdNamed('i.customer_id', 'tid'),
      );
    });
  });

  describe('excludeDemoByCustomerIdDollar (INDIRECT, raw SQL)', () => {
    const out = excludeDemoByCustomerIdDollar('i.customer_id', 1);

    it('uses $1 instead of a named parameter', () => {
      expect(out).toContain('demo_c.tenant_id = $1');
      // no :namedParam style — the `::jsonb` cast uses a double-colon, which
      // is not a parameter marker, so we match on ` :word` to avoid false hits.
      expect(out).not.toMatch(/\s:[A-Za-z_]/);
    });

    it('emits NOT EXISTS with demo_c alias and tag filter', () => {
      expect(out).toContain('NOT EXISTS');
      expect(out).toContain('demo_c.id = i.customer_id');
      expect(out).toContain('FROM customers demo_c');
      expect(out).toContain(`demo_c.tags @> ${DEMO_TAG_LITERAL}`);
    });

    it('is stable across calls (no whitespace drift)', () => {
      expect(excludeDemoByCustomerIdDollar('i.customer_id', 1)).toBe(
        excludeDemoByCustomerIdDollar('i.customer_id', 1),
      );
    });
  });

  describe('global bans', () => {
    it("no helper emits 'NOT IN'", () => {
      const outputs = [
        excludeDemoCustomers('c'),
        excludeDemoCustomers('customer'),
        excludeDemoByCustomerIdNamed('i.customer_id', 'tid'),
        excludeDemoByCustomerIdNamed('j.customer_id', 'tenantId'),
        excludeDemoByCustomerIdDollar('i.customer_id', 1),
        excludeDemoByCustomerIdDollar('p.customer_id', 2),
      ];
      for (const out of outputs) {
        expect(out).not.toMatch(/\bNOT IN\b/);
      }
    });
  });
});
