/**
 * Centralized labels + helpers for the quote send flow (Email / SMS / Both).
 *
 * Single source of truth — every quote send UI must import from here so we
 * never end up with scattered hardcoded JSX strings.
 */

export type DeliveryMethod = "email" | "sms" | "both";

export const QUOTE_SEND_LABELS = {
  // Section / field titles
  deliveryMethodTitle: "Delivery Method",
  smsRecipientLabel: "Send to",
  smsPreviewLabel: "SMS Preview",
  smsPreviewLoading: "Rendering preview...",
  smsFromLabel: "From",
  smsCharacterCount: "characters",

  // Delivery method options
  deliveryMethodEmail: "Email",
  deliveryMethodSms: "SMS",
  deliveryMethodBoth: "Email + SMS",

  // Send buttons
  sendQuoteByEmail: "Send Quote by Email",
  sendQuoteBySms: "Send Quote by SMS",
  sendQuoteByEmailAndSms: "Send Quote by Email + SMS",

  // Status / outcome messages
  sending: "Sending...",
  smsSendSuccess: "Quote sent by SMS",
  emailSendSuccess: "Quote sent by email",
  bothSendSuccess: "Quote sent by email + SMS",
  smsSendFailed: "SMS send failed",
  emailSendFailed: "Email send failed",
  smsSendPartialSuccess: "Email sent — SMS failed",
  emailSendPartialSuccess: "SMS sent — email failed",
  noChannelAttempted: "No delivery channel was attempted",

  // Blocked-channel reasons (UI inline + tooltip)
  smsUnavailable: "SMS unavailable",
  smsRequiresValidCustomerPhone: "A valid customer phone number is required to send by SMS.",
  smsTenantDisabled: "SMS is not enabled for your tenant.",
  smsTenantNumberMissing: "No SMS number is assigned to your tenant. Get a number in Settings.",
  smsQuoteDisabled: "Quote SMS is not enabled in tenant settings.",
  emailUnavailable: "Email unavailable",
  emailQuoteDisabled: "Quote email is not enabled in tenant settings.",
  emailNoCustomerEmail: "No customer email on file.",
  invalidCustomerPhone: "Customer phone number is invalid.",
  smsCustomerOptedOut: "Customer has opted out of SMS",
};

/** Map a delivery method to its human label. */
export function deliveryMethodLabel(m: DeliveryMethod): string {
  if (m === "email") return QUOTE_SEND_LABELS.deliveryMethodEmail;
  if (m === "sms") return QUOTE_SEND_LABELS.deliveryMethodSms;
  return QUOTE_SEND_LABELS.deliveryMethodBoth;
}

/** Map a delivery method to the primary CTA label. */
export function deliveryButtonLabel(m: DeliveryMethod): string {
  if (m === "email") return QUOTE_SEND_LABELS.sendQuoteByEmail;
  if (m === "sms") return QUOTE_SEND_LABELS.sendQuoteBySms;
  return QUOTE_SEND_LABELS.sendQuoteByEmailAndSms;
}

/**
 * Translate a backend channel-blocked `reason` into a user-facing string.
 * Returns null if the reason is unknown — caller may render the raw reason
 * for debugging in that case.
 */
export function deliveryReasonLabel(reason: string | undefined | null): string | null {
  if (!reason) return null;
  switch (reason) {
    case "tenant_sms_disabled":
      return QUOTE_SEND_LABELS.smsTenantDisabled;
    case "tenant_sms_number_missing":
      return QUOTE_SEND_LABELS.smsTenantNumberMissing;
    case "tenant_quotes_sms_disabled":
      return QUOTE_SEND_LABELS.smsQuoteDisabled;
    case "no_customer_phone":
      return QUOTE_SEND_LABELS.smsRequiresValidCustomerPhone;
    case "invalid_customer_phone":
      return QUOTE_SEND_LABELS.invalidCustomerPhone;
    case "customer_opted_out":
      return QUOTE_SEND_LABELS.smsCustomerOptedOut;
    case "tenant_quotes_email_disabled":
      return QUOTE_SEND_LABELS.emailQuoteDisabled;
    case "no_customer_email":
      return QUOTE_SEND_LABELS.emailNoCustomerEmail;
    case "empty_sms_body":
    case "empty_body":
      return "Rendered message body is empty.";
    default:
      return null;
  }
}
