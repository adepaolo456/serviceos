/**
 * Centralized quote template defaults + rendering.
 * Single source of truth for all template strings and placeholder replacement.
 */

export const QUOTE_TEMPLATE_DEFAULTS: Record<string, string> = {
  quote_email_subject: 'Your Quote from {company_name} — {dumpster_size} Dumpster',
  quote_email_body: 'Hi {customer_name},\n\nHere\'s your quote for a {dumpster_size} dumpster rental:\n\nTotal: {quote_price}\n\nView your full quote: {quote_link}\n\nThis quote is valid until {expires_at}.\n\nQuestions? Call us at {company_phone} or email {company_email}.\n\n— {company_name}',
  quote_sms_body: '{company_name}: Your {dumpster_size} dumpster quote is {quote_price}. View: {quote_link}',
  followup_email_subject: 'Following up on your quote — {company_name}',
  followup_email_body: 'Hi {customer_name},\n\nJust following up on your {dumpster_size} dumpster quote for {quote_price}.\n\nReady to book? {quote_link}\n\nQuestions? Call {company_phone}.\n\n— {company_name}',
  followup_sms_body: '{company_name}: Still need a {dumpster_size} dumpster? Your {quote_price} quote is ready: {quote_link}',
  expiration_email_subject: 'Your quote expires soon — {company_name}',
  expiration_email_body: 'Hi {customer_name},\n\nYour {dumpster_size} dumpster quote for {quote_price} expires on {expires_at}.\n\nBook now before it expires: {quote_link}\n\n— {company_name}',
  expiration_sms_body: '{company_name}: Your {dumpster_size} quote for {quote_price} expires soon. Book now: {quote_link}',
};

/**
 * Resolve a template: tenant override if present, otherwise default.
 */
export function getTemplate(
  key: string,
  tenantTemplates: Record<string, string> | null | undefined,
): string {
  return tenantTemplates?.[key] || QUOTE_TEMPLATE_DEFAULTS[key] || '';
}

/**
 * Render a template string by replacing {placeholders} with context values.
 * Unknown placeholders remain unchanged. Missing context values render as empty string.
 * No eval, no script execution.
 */
export function renderTemplate(
  template: string,
  context: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const val = context[key];
    if (val === undefined || val === null) return '';
    return String(val);
  });
}
