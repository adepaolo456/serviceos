"use client";

import { Mail, MessageSquare, Loader2, AlertTriangle } from "lucide-react";
import {
  QUOTE_SEND_LABELS,
  deliveryButtonLabel,
  deliveryMethodLabel,
  type DeliveryMethod,
} from "@/lib/quote-send-labels";

export interface SmsPreviewState {
  valid: boolean;
  reason?: string;
  body: string;
  recipient: string | null;
  from_number: string | null;
  character_count: number;
}

interface QuoteSendPanelProps {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  onCustomerNameChange: (v: string) => void;
  onCustomerEmailChange: (v: string) => void;
  onCustomerPhoneChange: (v: string) => void;

  deliveryMethod: DeliveryMethod;
  onDeliveryMethodChange: (m: DeliveryMethod) => void;

  emailChannelAvailable: boolean;
  smsChannelAvailable: boolean;
  tenantSmsNumber: string | null;

  smsPreview: SmsPreviewState | null;
  smsPreviewLoading: boolean;

  onSend: () => void;
  onCancel: () => void;
  sending: boolean;

  /** Hide the customer name/email/phone inputs (used when fields are already in the parent context) */
  hideCustomerFields?: boolean;
}

/**
 * Reusable inline send panel: delivery method selector + recipient inputs
 * + SMS preview + final CTA. Used by:
 *   - quick-quote-drawer (create + send)
 *   - quotes detail re-send action
 *
 * The parent owns send execution; this component is purely presentational +
 * exposes change handlers.
 */
export default function QuoteSendPanel(props: QuoteSendPanelProps) {
  const {
    customerName,
    customerEmail,
    customerPhone,
    onCustomerNameChange,
    onCustomerEmailChange,
    onCustomerPhoneChange,
    deliveryMethod,
    onDeliveryMethodChange,
    emailChannelAvailable,
    smsChannelAvailable,
    tenantSmsNumber,
    smsPreview,
    smsPreviewLoading,
    onSend,
    onCancel,
    sending,
    hideCustomerFields = false,
  } = props;

  const wantEmail = deliveryMethod === "email" || deliveryMethod === "both";
  const wantSms = deliveryMethod === "sms" || deliveryMethod === "both";

  // Final-CTA disabled rules
  const missingName = !customerName;
  const missingEmail = wantEmail && !customerEmail;
  const missingPhone = wantSms && !customerPhone;
  const smsBlockedByTenant = wantSms && !smsChannelAvailable;
  const emailBlockedByTenant = wantEmail && !emailChannelAvailable;
  const noChannelChosen = !wantEmail && !wantSms;
  const ctaDisabled =
    sending ||
    noChannelChosen ||
    missingName ||
    missingEmail ||
    missingPhone ||
    smsBlockedByTenant ||
    emailBlockedByTenant;

  return (
    <div
      className="rounded-[14px] border p-3 space-y-3 animate-fade-in"
      style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
    >
      {/* Delivery method selector */}
      <div>
        <p
          className="text-[10px] font-semibold uppercase tracking-wide mb-1.5"
          style={{ color: "var(--t-text-muted)" }}
        >
          {QUOTE_SEND_LABELS.deliveryMethodTitle}
        </p>
        <div className="flex gap-1.5">
          {(["email", "sms", "both"] as DeliveryMethod[]).map((m) => {
            const isActive = deliveryMethod === m;
            const isDisabled =
              (m === "email" && !emailChannelAvailable) ||
              (m === "sms" && !smsChannelAvailable) ||
              (m === "both" && (!emailChannelAvailable || !smsChannelAvailable));
            return (
              <button
                key={m}
                type="button"
                onClick={() => !isDisabled && onDeliveryMethodChange(m)}
                disabled={isDisabled}
                title={
                  isDisabled
                    ? m === "sms"
                      ? !tenantSmsNumber
                        ? QUOTE_SEND_LABELS.smsTenantNumberMissing
                        : QUOTE_SEND_LABELS.smsTenantDisabled
                      : QUOTE_SEND_LABELS.emailQuoteDisabled
                    : undefined
                }
                className="flex-1 rounded-full px-3 py-1.5 text-[11px] font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isActive ? "var(--t-accent)" : "var(--t-bg-secondary)",
                  color: isActive ? "var(--t-accent-on-accent)" : "var(--t-text-primary)",
                  borderColor: isActive ? "var(--t-accent)" : "var(--t-border)",
                }}
              >
                {deliveryMethodLabel(m)}
              </button>
            );
          })}
        </div>
        {!emailChannelAvailable && !smsChannelAvailable && (
          <div
            className="mt-2 flex items-start gap-1.5 text-[11px]"
            style={{ color: "var(--t-warning)" }}
          >
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>Neither email nor SMS quote delivery is enabled in tenant settings.</span>
          </div>
        )}
      </div>

      {/* Customer fields */}
      {!hideCustomerFields && (
        <div className="space-y-2">
          <input
            value={customerName}
            onChange={(e) => onCustomerNameChange(e.target.value)}
            placeholder="Name *"
            className="w-full rounded-[10px] border px-3 py-1.5 text-sm outline-none focus:border-[var(--t-accent)]"
            style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
          />
          {wantEmail && (
            <input
              value={customerEmail}
              onChange={(e) => onCustomerEmailChange(e.target.value)}
              placeholder="Email *"
              type="email"
              className="w-full rounded-[10px] border px-3 py-1.5 text-sm outline-none focus:border-[var(--t-accent)]"
              style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
            />
          )}
          {wantSms && (
            <div>
              <input
                value={customerPhone}
                onChange={(e) => onCustomerPhoneChange(e.target.value)}
                placeholder="Phone * (e.g. (508) 555-1234)"
                type="tel"
                className="w-full rounded-[10px] border px-3 py-1.5 text-sm outline-none focus:border-[var(--t-accent)]"
                style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
              />
              {missingPhone && (
                <p className="mt-1 text-[10px]" style={{ color: "var(--t-warning)" }}>
                  {QUOTE_SEND_LABELS.smsRequiresValidCustomerPhone}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* SMS preview */}
      {wantSms && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--t-text-muted)" }}
            >
              {QUOTE_SEND_LABELS.smsPreviewLabel}
            </p>
            {smsPreview?.from_number && (
              <p className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
                {QUOTE_SEND_LABELS.smsFromLabel}{" "}
                <span className="font-mono">{smsPreview.from_number}</span>
              </p>
            )}
          </div>
          <div
            className="rounded-[10px] border p-2.5 text-[12px] leading-relaxed font-mono whitespace-pre-wrap min-h-[60px] flex items-start"
            style={{
              background: "var(--t-bg-secondary)",
              borderColor: "var(--t-border)",
              color: "var(--t-text-primary)",
            }}
          >
            {smsPreviewLoading ? (
              <span className="flex items-center gap-2 text-[var(--t-text-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                {QUOTE_SEND_LABELS.smsPreviewLoading}
              </span>
            ) : smsPreview && smsPreview.body ? (
              smsPreview.body
            ) : (
              <span className="text-[var(--t-text-muted)]">—</span>
            )}
          </div>
          {smsPreview && (
            <p className="mt-1 text-[10px]" style={{ color: "var(--t-text-muted)" }}>
              {smsPreview.character_count} {QUOTE_SEND_LABELS.smsCharacterCount}
            </p>
          )}
        </div>
      )}

      {/* CTA + Cancel */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSend}
          disabled={ctaDisabled}
          className="flex-1 flex items-center justify-center gap-2 rounded-full py-2 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : wantSms && !wantEmail ? (
            <MessageSquare className="h-4 w-4" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
          {sending ? QUOTE_SEND_LABELS.sending : deliveryButtonLabel(deliveryMethod)}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="rounded-full px-3 py-2 text-[12px] font-medium transition-colors hover:bg-[var(--t-bg-card-hover)] disabled:opacity-50"
          style={{ color: "var(--t-text-muted)", background: "transparent", border: "none" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
