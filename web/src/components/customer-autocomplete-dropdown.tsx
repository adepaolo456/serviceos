"use client";

/**
 * Presentational dropdown for the shared customer autocomplete.
 *
 * Stateless. Purely a function of its props. Consumed by NCF, BW, and QSP.
 * customer-picker-drawer does NOT use this component — it renders results
 * inline in its SlideOver body (structurally different; see the drawer for
 * its own rendering).
 *
 * Rendering rules:
 *   - Returns null when !isOpen.
 *   - When isLoading && labels.loading → render loading row.
 *   - When !isLoading && results.length > 0 → render result rows.
 *   - No empty-state rendering (preserves existing 3-site behavior:
 *     hide dropdown when there are no results).
 *   - "Continue as new customer" row renders iff onContinueAsNew AND
 *     labels.continueAsNew are both provided.
 *   - Each interactive row uses `onMouseDown={(e) => e.preventDefault()}`
 *     so clicking a row does not blur the input before the click fires
 *     (preserves QSP's focus-retention technique).
 *
 * Label sourcing: all user-visible strings come from the `labels` prop.
 * The dropdown imports no label registry. Call sites decide their label
 * source — today that's local constants at each site; a follow-up can
 * migrate those to `getFeatureLabel` without touching this component.
 */

import { getCustomerDisplayName } from "@/lib/use-customer-autocomplete";
import type {
  CustomerSearchAddress,
  CustomerSearchResult,
} from "@/lib/use-customer-autocomplete";

export interface CustomerAutocompleteDropdownLabels {
  /** Shown when isLoading && isOpen. Omit to suppress the loading row.
   * `ReactNode` so consumers can include icons (e.g. <Loader2 /> +
   * text) without coupling the dropdown to any icon library. */
  loading?: React.ReactNode;
  /** Label for the "Continue as new customer" row. Required together
   * with onContinueAsNew. ReactNode for the same reason as `loading`. */
  continueAsNew?: React.ReactNode;
}

export interface CustomerAutocompleteDropdownProps {
  results: CustomerSearchResult[];
  isLoading: boolean;
  isOpen: boolean;

  onSelect: (customer: CustomerSearchResult) => void;
  onContinueAsNew?: () => void;

  labels?: CustomerAutocompleteDropdownLabels;
  className?: string;
}

function formatAddressSummary(a: CustomerSearchAddress | null | undefined): string {
  if (!a) return "";
  return [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
}

export default function CustomerAutocompleteDropdown({
  results,
  isLoading,
  isOpen,
  onSelect,
  onContinueAsNew,
  labels,
  className,
}: CustomerAutocompleteDropdownProps) {
  if (!isOpen) return null;

  const showLoading = isLoading && !!labels?.loading;
  const showResults = !isLoading && results.length > 0;
  const showContinueAsNew = !!onContinueAsNew && !!labels?.continueAsNew;

  if (!showLoading && !showResults && !showContinueAsNew) return null;

  return (
    <div
      className={
        className ??
        "absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[10px] border shadow-lg"
      }
      style={{
        backgroundColor: "var(--t-bg-card)",
        borderColor: "var(--t-border)",
      }}
    >
      {showLoading && (
        <div
          className="flex items-center gap-2 px-3 py-2 text-sm"
          style={{ color: "var(--t-text-muted)" }}
        >
          {labels?.loading}
        </div>
      )}

      {showResults && (
        <ul className="max-h-64 overflow-y-auto">
          {results.map((c) => {
            const secondary = [c.phone, c.email].filter(Boolean).join(" · ");
            const addr = formatAddressSummary(c.billing_address ?? null);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(c)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--t-bg-card-hover)]"
                  style={{ borderBottom: "1px solid var(--t-border)" }}
                >
                  <div
                    style={{
                      color: "var(--t-text-primary)",
                      fontWeight: 600,
                    }}
                  >
                    {getCustomerDisplayName(c)}
                  </div>
                  {secondary && (
                    <div
                      style={{
                        color: "var(--t-text-muted)",
                        fontSize: 11,
                        marginTop: 2,
                      }}
                    >
                      {secondary}
                    </div>
                  )}
                  {addr && (
                    <div
                      style={{
                        color: "var(--t-text-muted)",
                        fontSize: 11,
                      }}
                    >
                      {addr}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {showContinueAsNew && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onContinueAsNew}
          className="block w-full px-3 py-2 text-left text-sm font-semibold"
          style={{
            color: "var(--t-accent)",
            borderTop: showResults ? "1px solid var(--t-border)" : undefined,
          }}
        >
          {labels?.continueAsNew}
        </button>
      )}
    </div>
  );
}
