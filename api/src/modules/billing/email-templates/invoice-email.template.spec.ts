/**
 * Phase 1.8.1 — Pure unit tests for buildInvoiceEmail.
 *
 * No DB, no services, no mocks, no harness. The template is a pure
 * function; its tests are the simplest in the suite.
 *
 * Coverage (8 tests, locked per sign-off):
 *   1. Paid invoice (balanceDue=0)     — NO CTA block, NO forbidden phrases
 *   2. Unpaid invoice (balanceDue>0)   — CTA present with phone/email, NO payment link
 *   3. No logo fallback                — text header, no <img>
 *   4. HTML escape                     — malicious first_name is entity-encoded
 *   5. Line items render               — 3 rows appear in correct order
 *   6. Missing tenant throws           — Guardrail 4
 *   7. Missing customer throws         — Guardrail 4
 *   8. Empty line items + total>0      — Guardrail 4 throws (no placeholder row)
 */

import { buildInvoiceEmail } from './invoice-email.template';
import type { Invoice } from '../entities/invoice.entity';
import type { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import type { Tenant } from '../../tenants/entities/tenant.entity';
import type { Customer } from '../../customers/entities/customer.entity';

const tenant = {
  id: 't-1',
  name: 'Rent This Dumpster',
  slug: 'rent-this-dumpster',
  website_logo_url: null,
  website_primary_color: '#2ECC71',
  website_phone: '5086318884',
  website_email: 'adepaolo456@gmail.com',
  website_service_area: 'South Shore, MA',
  address: { street: '14 Copper Beech Circle', city: 'West Bridgewater', state: 'MA', zip: '02379' },
} as unknown as Tenant;

const customer = {
  id: 'c-1',
  first_name: 'Anthony',
  last_name: 'DePaolo',
  email: 'adepaolo456@gmail.com',
} as unknown as Customer;

const lineItem = (overrides: Partial<InvoiceLineItem> = {}) =>
  ({
    id: 'li-1',
    name: '15yd Dumpster Rental',
    quantity: 1,
    unit_rate: 750,
    amount: 750,
    sort_order: 0,
    ...overrides,
  }) as unknown as InvoiceLineItem;

const invoice = (overrides: Partial<Invoice> = {}) =>
  ({
    id: 'inv-1',
    invoice_number: 1009,
    invoice_date: '2026-04-15',
    due_date: '2026-04-30',
    status: 'open',
    total: 750,
    amount_paid: 0,
    balance_due: 750,
    ...overrides,
  }) as unknown as Invoice;

// Forbidden phrases per COPY LOCK — the template must never render a
// clickable-payment affordance while Pay Now is deferred.
const FORBIDDEN = [
  'Click here to pay',
  'Pay online',
  'Pay securely',
  'Pay now',
  '/portal',
  '/pay',
];

describe('buildInvoiceEmail — Phase 1.8.1', () => {
  // ── #1 Paid invoice ──
  it('1. paid invoice (balanceDue=0) — NO CTA block, NO forbidden phrases', () => {
    const { html } = buildInvoiceEmail({
      invoice: invoice({ status: 'paid', amount_paid: 750, balance_due: 0 }),
      tenant,
      customer,
      lineItems: [lineItem()],
      balanceDue: 0,
    });
    expect(html).not.toContain('Balance Due: $750');
    expect(html).not.toContain('Please contact us to arrange payment.');
    for (const phrase of FORBIDDEN) {
      expect(html).not.toContain(phrase);
    }
  });

  // ── #2 Unpaid invoice ──
  it('2. unpaid invoice (balanceDue>0) — CTA with contact copy + phone/email, NO payment link', () => {
    const { html } = buildInvoiceEmail({
      invoice: invoice(),
      tenant,
      customer,
      lineItems: [lineItem()],
      balanceDue: 750,
    });
    expect(html).toContain('Balance Due: $750.00');
    expect(html).toContain('Please contact us to arrange payment.');
    expect(html).toContain('5086318884');
    expect(html).toContain('adepaolo456@gmail.com');
    for (const phrase of FORBIDDEN) {
      expect(html).not.toContain(phrase);
    }
    // Extra belt-and-suspenders on payment links specifically.
    expect(html).not.toMatch(/<a[^>]+href=["'][^"']*(portal|pay|stripe)/i);
  });

  // ── #3 No logo fallback ──
  it('3. no logo — header uses tenant name text, renders no <img> tag', () => {
    const { html } = buildInvoiceEmail({
      invoice: invoice(),
      tenant: { ...tenant, website_logo_url: null } as unknown as Tenant,
      customer,
      lineItems: [lineItem()],
      balanceDue: 750,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('Rent This Dumpster');
  });

  // ── #4 HTML escape ──
  it('4. HTML escape — malicious first_name and line item description are entity-encoded', () => {
    const { html } = buildInvoiceEmail({
      invoice: invoice(),
      tenant,
      customer: { ...customer, first_name: "<script>alert('x')</script>" } as unknown as Customer,
      lineItems: [lineItem({ name: '<img src=x onerror=alert(1)>' })],
      balanceDue: 750,
    });
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  // ── #5 Line items render ──
  it('5. line items render — 3 rows appear in order with correct descriptions and amounts', () => {
    const items = [
      lineItem({ name: 'Dumpster Rental', unit_rate: 500, amount: 500, sort_order: 0 }),
      lineItem({ id: 'li-2', name: 'Delivery Fee', unit_rate: 100, amount: 100, sort_order: 1 }),
      lineItem({ id: 'li-3', name: 'Weight Overage', unit_rate: 150, amount: 150, sort_order: 2 }),
    ];
    const { html } = buildInvoiceEmail({
      invoice: invoice({ total: 750 }),
      tenant,
      customer,
      lineItems: items,
      balanceDue: 750,
    });
    expect(html).toContain('Dumpster Rental');
    expect(html).toContain('Delivery Fee');
    expect(html).toContain('Weight Overage');
    expect(html).toContain('$500.00');
    expect(html).toContain('$100.00');
    expect(html).toContain('$150.00');
    // Order check: Dumpster Rental appears before Delivery Fee.
    expect(html.indexOf('Dumpster Rental')).toBeLessThan(html.indexOf('Delivery Fee'));
    expect(html.indexOf('Delivery Fee')).toBeLessThan(html.indexOf('Weight Overage'));
  });

  // ── #6 Missing tenant throws ──
  it('6. missing tenant — throws clear error (Guardrail 4)', () => {
    expect(() =>
      buildInvoiceEmail({
        invoice: invoice(),
        tenant: null,
        customer,
        lineItems: [lineItem()],
        balanceDue: 750,
      }),
    ).toThrow(/tenant.*required/i);
  });

  // ── #7 Missing customer throws ──
  it('7. missing customer — throws clear error (Guardrail 4)', () => {
    expect(() =>
      buildInvoiceEmail({
        invoice: invoice(),
        tenant,
        customer: null,
        lineItems: [lineItem()],
        balanceDue: 750,
      }),
    ).toThrow(/customer.*required/i);
  });

  // ── #8 Empty line items with total > 0 throws ──
  it('8. empty line items with total > 0 — throws (Guardrail 4, no silent placeholder row)', () => {
    expect(() =>
      buildInvoiceEmail({
        invoice: invoice({ total: 750 }),
        tenant,
        customer,
        lineItems: [],
        balanceDue: 750,
      }),
    ).toThrow(/line items.*required/i);
  });
});
