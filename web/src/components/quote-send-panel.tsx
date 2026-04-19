"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Mail, MessageSquare, Loader2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import {
  QUOTE_SEND_LABELS,
  deliveryButtonLabel,
  deliveryMethodLabel,
  type DeliveryMethod,
} from "@/lib/quote-send-labels";

interface CustomerSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  company_name?: string;
  email: string;
  phone?: string;
}

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

  // Type-ahead autocomplete on the Name input. Pattern matches the
  // canonical inline-search shape used by BookingWizard
  // (booking-wizard.tsx:234,507-530): inline useRef debounce primitive,
  // 300ms, try/catch swallow, dual-state (results + showSuggestions),
  // q.length<2 early-out. All prefill data flows through the existing
  // onCustomer*Change props — no new panel callbacks added.
  const [nameQuery, setNameQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (nameQuery.trim().length < 2) {
      setSearchResults([]);
      setShowSuggestions(false);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.get<CustomerSearchResult[]>(
          `/customers/search?q=${encodeURIComponent(nameQuery.trim())}&limit=5`,
        );
        setSearchResults(results);
        // Focus guard: skip opening the dropdown if the user has moved
        // focus away (e.g., clicked Email) while this fetch was in
        // flight. Prevents the race where click-outside closes the
        // dropdown and the resolving fetch then re-opens it.
        if (document.activeElement === inputRef.current) {
          setShowSuggestions(true);
        }
      } catch {
        setSearchResults([]);
        setShowSuggestions(false);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [nameQuery]);

  // Click-outside close — canonical pattern mirroring
  // booking-wizard.tsx:332-339 and new-customer-form.tsx:246-252.
  // Gated on showSuggestions so the document listener only attaches
  // while the dropdown is open.
  useEffect(() => {
    if (!showSuggestions) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSuggestions]);

  const handleNameInputChange = useCallback(
    (value: string) => {
      onCustomerNameChange(value);
      setNameQuery(value);
    },
    [onCustomerNameChange],
  );

  const handleSelectSuggestion = useCallback(
    (customer: CustomerSearchResult) => {
      onCustomerNameChange(`${customer.first_name} ${customer.last_name}`.trim());
      onCustomerEmailChange(customer.email ?? '');
      onCustomerPhoneChange(customer.phone ?? '');
      setShowSuggestions(false);
      setNameQuery('');
      setSearchResults([]);
    },
    [onCustomerNameChange, onCustomerEmailChange, onCustomerPhoneChange],
  );

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
          <div ref={containerRef} className="relative">
            <input
              ref={inputRef}
              value={customerName}
              onChange={(e) => handleNameInputChange(e.target.value)}
              placeholder="Name *"
              className="w-full rounded-[10px] border px-3 py-1.5 text-sm outline-none focus:border-[var(--t-accent)]"
              style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
            />
            {showSuggestions && (
              <div
                className="absolute left-0 right-0 top-full mt-1 z-10 rounded-md shadow-lg max-h-64 overflow-y-auto"
                style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)" }}
              >
                {searchLoading && (
                  <div
                    className="px-3 py-2 flex items-center gap-2 text-sm"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                )}
                {!searchLoading && searchResults.length === 0 && nameQuery.trim().length >= 2 && (
                  <div
                    className="px-3 py-2 text-sm"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    No customers found
                  </div>
                )}
                {!searchLoading && searchResults.length > 0 && (
                  <ul>
                    {searchResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectSuggestion(c)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--t-bg-card-hover)]"
                        >
                          <div style={{ color: "var(--t-text-primary)" }}>
                            {`${c.first_name} ${c.last_name}`.trim()}
                          </div>
                          <div className="text-xs" style={{ color: "var(--t-text-muted)" }}>
                            {c.email}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
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
