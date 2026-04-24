/**
 * Phase 1.8.1 — Invoice email template (pure function).
 *
 * Builds { subject, html } for the invoice send/resend email. Tables-
 * based layout, inline styles, max 600px, email-client-safe.
 *
 * GUARDRAIL 2 — Pay Now DEFERRED. 9/11 customers in production lack
 * portal credentials, so a "Pay Now" button would send 82% of
 * recipients to a login dead-end. This template has NO portalUrl
 * parameter, NO button, NO `/portal` or `/pay` URL. For unpaid
 * invoices it renders a contact CTA ("Please contact us to arrange
 * payment.") with the tenant's phone + email instead.
 *
 * GUARDRAIL 3 — Purity. This file imports only entity TYPES for the
 * function signature. No services, no env, no DB, no side effects.
 *
 * GUARDRAIL 4 — No silent fallback. Throws on missing tenant,
 * customer, or empty line items on a non-zero-total invoice.
 */

import type { Invoice } from '../entities/invoice.entity';
import type { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import type { Tenant } from '../../tenants/entities/tenant.entity';
import type { Customer } from '../../customers/entities/customer.entity';

// HTML-escape every dynamic value before interpolation. Covers the
// standard OWASP entity set. String coercion handles number inputs
// (invoice numbers, amounts) safely.
const esc = (s: string | number | null | undefined): string => {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
};

const money = (n: number | string): string => `$${Number(n).toFixed(2)}`;

// Inline style constants. Kept short; email clients like Gmail strip
// <style> blocks, so every style attribute is explicit.
const WRAPPER_STYLE =
  'margin:0;padding:24px 12px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937;';
const CARD_STYLE =
  'max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;';
const HEADER_STYLE =
  'padding:28px 24px;text-align:center;color:#ffffff;font-size:20px;font-weight:700;';
const BODY_STYLE = 'padding:24px;font-size:14px;line-height:1.5;color:#1f2937;';
const TABLE_STYLE =
  'width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;';
const MUTED_STYLE = 'color:#6b7280;font-size:12px;';
const FOOTER_STYLE =
  'padding:20px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;line-height:1.6;';
const CTA_BLOCK_STYLE =
  'margin:20px 0;padding:18px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;text-align:center;';

export interface BuildInvoiceEmailInput {
  invoice: Invoice;
  tenant: Tenant | null;
  customer: Customer | null;
  lineItems: InvoiceLineItem[];
  balanceDue: number;
}

export function buildInvoiceEmail(input: BuildInvoiceEmailInput): {
  subject: string;
  html: string;
} {
  const { invoice, tenant, customer, lineItems, balanceDue } = input;

  // Guardrail 4 — fail loudly on required-data absence. The caller
  // (sendInvoice) relies on these errors to avoid stamping sent_at on
  // a malformed send.
  if (!tenant) {
    throw new Error(
      'buildInvoiceEmail: tenant is required (relation failed to load)',
    );
  }
  if (!tenant.name) {
    throw new Error(
      'buildInvoiceEmail: tenant.name is required (corrupt tenant row)',
    );
  }
  if (!customer) {
    throw new Error(
      'buildInvoiceEmail: customer is required (relation failed to load)',
    );
  }
  if (Number(invoice.total) > 0 && lineItems.length === 0) {
    throw new Error(
      'buildInvoiceEmail: line items are required when invoice total > 0',
    );
  }

  const tenantName = tenant.name;
  const brandColor = tenant.website_primary_color || '#2ECC71';
  const logoUrl = tenant.website_logo_url || null;
  const firstName = customer.first_name || 'there';
  const customerEmail = customer.email || '';

  const subject = `Invoice #${invoice.invoice_number} from ${tenantName}`;

  // Header — logo image if present, text fallback otherwise. No broken
  // <img> tag when logo is null per Guardrail 4.
  const headerInner = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(tenantName)}" style="max-height:40px;max-width:200px;display:block;margin:0 auto;" />`
    : `<span style="color:#ffffff;">${esc(tenantName)}</span>`;

  // Line items table body — each row rendered from the injected list.
  // Right-align the number columns per email-client convention.
  const lineItemRows = lineItems
    .map((li) => {
      const qty = Number(li.quantity);
      const unit = Number(li.unit_rate);
      const amt = Number(li.amount);
      return (
        `<tr>` +
        `<td style="padding:8px;border-bottom:1px solid #e5e7eb;">${esc(li.name)}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${qty}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${esc(money(unit))}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${esc(money(amt))}</td>` +
        `</tr>`
      );
    })
    .join('');

  const subtotal = Number(invoice.total);
  const amountPaid = Number(invoice.amount_paid || 0);
  const balanceStyle =
    balanceDue > 0 ? 'font-weight:700;color:#b45309;' : 'color:#1f2937;';

  // Conditional CTA — only when there's a balance. Copy LOCKED by
  // sign-off: "Please contact us to arrange payment." + phone + email.
  // No payment link, no "Pay Now", no "/portal" anywhere.
  const ctaBlock =
    balanceDue > 0
      ? (
          `<div style="${CTA_BLOCK_STYLE}">` +
          `<div style="font-size:16px;font-weight:700;color:#92400e;margin-bottom:6px;">Balance Due: ${esc(money(balanceDue))}</div>` +
          `<div style="color:#78350f;margin-bottom:8px;">Please contact us to arrange payment.</div>` +
          (tenant.website_phone
            ? `<div style="${MUTED_STYLE}color:#78350f;">Phone: ${esc(tenant.website_phone)}</div>`
            : '') +
          (tenant.website_email
            ? `<div style="${MUTED_STYLE}color:#78350f;">Email: ${esc(tenant.website_email)}</div>`
            : '') +
          `</div>`
        )
      : '';

  // Footer — graceful null handling per Guardrail 4. Omit fields
  // that are null rather than rendering "null" text.
  const addr = (tenant.address as
    | { street?: string; city?: string; state?: string; zip?: string }
    | null) ?? null;
  const addrLine = addr
    ? [addr.street, [addr.city, addr.state].filter(Boolean).join(', '), addr.zip]
        .filter(Boolean)
        .join(' · ')
    : '';

  const footerLines = [
    `<strong>${esc(tenantName)}</strong>`,
    tenant.website_phone ? `Phone: ${esc(tenant.website_phone)}` : '',
    tenant.website_email ? `Email: ${esc(tenant.website_email)}` : '',
    tenant.website_service_area
      ? `Service area: ${esc(tenant.website_service_area)}`
      : '',
    addrLine ? esc(addrLine) : '',
  ].filter(Boolean).join('<br />');

  const html =
    `<div style="${WRAPPER_STYLE}">` +
    `<div style="${CARD_STYLE}">` +
    // 1. Header band
    `<div style="${HEADER_STYLE}background:${esc(brandColor)};">${headerInner}</div>` +
    // 2-3. Greeting + summary
    `<div style="${BODY_STYLE}">` +
    `<p style="margin:0 0 8px 0;">Hi ${esc(firstName)},</p>` +
    `<p style="margin:0 0 16px 0;">Here's your invoice from ${esc(tenantName)}.</p>` +
    // 4. Invoice details
    `<table style="${TABLE_STYLE}" role="presentation">` +
    `<tr><td style="${MUTED_STYLE}padding:4px 0;">Invoice #</td><td style="padding:4px 0;text-align:right;">${esc(invoice.invoice_number)}</td></tr>` +
    (invoice.invoice_date
      ? `<tr><td style="${MUTED_STYLE}padding:4px 0;">Issued</td><td style="padding:4px 0;text-align:right;">${esc(String(invoice.invoice_date))}</td></tr>`
      : '') +
    (invoice.due_date
      ? `<tr><td style="${MUTED_STYLE}padding:4px 0;">Due</td><td style="padding:4px 0;text-align:right;">${esc(String(invoice.due_date))}</td></tr>`
      : '') +
    `<tr><td style="${MUTED_STYLE}padding:4px 0;">Status</td><td style="padding:4px 0;text-align:right;text-transform:capitalize;">${esc(invoice.status)}</td></tr>` +
    `</table>` +
    // 5. Line items table
    `<table style="${TABLE_STYLE}" role="presentation">` +
    `<thead><tr style="background:#f9fafb;">` +
    `<th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Description</th>` +
    `<th style="padding:8px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;">Qty</th>` +
    `<th style="padding:8px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;">Unit</th>` +
    `<th style="padding:8px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;">Amount</th>` +
    `</tr></thead>` +
    `<tbody>${lineItemRows}</tbody>` +
    `</table>` +
    // 6. Totals
    `<table style="${TABLE_STYLE}" role="presentation">` +
    `<tr><td style="padding:4px 0;">Subtotal</td><td style="padding:4px 0;text-align:right;">${esc(money(subtotal))}</td></tr>` +
    `<tr><td style="padding:4px 0;">Amount paid</td><td style="padding:4px 0;text-align:right;">${esc(money(amountPaid))}</td></tr>` +
    `<tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;${balanceStyle}">Balance due</td><td style="padding:6px 0;text-align:right;border-top:1px solid #e5e7eb;${balanceStyle}">${esc(money(balanceDue))}</td></tr>` +
    `</table>` +
    // 7. Conditional CTA (contact-us copy only; no payment link)
    ctaBlock +
    `</div>` + // end body
    // 8. Footer
    `<div style="${FOOTER_STYLE}">${footerLines}</div>` +
    // 9. Legal line
    `<div style="padding:12px 24px;${MUTED_STYLE}text-align:center;">This invoice was sent to ${esc(customerEmail)} by ${esc(tenantName)}.</div>` +
    `</div>` + // end card
    `</div>`; // end wrapper

  return { subject, html };
}
