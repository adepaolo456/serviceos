"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCustomerAutocomplete, type CustomerSearchAddress } from "@/lib/use-customer-autocomplete";
import CustomerAutocompleteDropdown from "@/components/customer-autocomplete-dropdown";
import { formatCurrency, formatDumpsterSize } from "@/lib/utils";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { useActiveOnsiteDumpsters, type OnsiteDumpster } from "@/lib/use-active-onsite-dumpsters";
import { useCreditEnforcement } from "@/lib/use-credit-enforcement";
import { CreditEnforcementBanner } from "@/components/credit-enforcement-banner";
import { useQuickQuote } from "@/components/quick-quote-provider";
import { useToast } from "@/components/toast";

/* ── Types ── */

export type NextStep = "save" | "schedule";

export interface OrchestrationResult {
  customerId: string;
  jobId?: string;
  invoiceId?: string;
  status: "customer_only" | "booking_created" | "invoice_unpaid" | "payment_succeeded" | "payment_failed";
  nextAction: string;
}

// Extended with optional row fields carried from the /customers?search
// spread in the 400 branch AND from the 409 existing_customer payload
// (Commit A). These let "Use this customer" call selectExistingCustomer
// with billing_address + service_addresses so the form prefills fully.
interface DuplicateMatch {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  matchField: "email" | "phone";
  company_name?: string | null;
  type?: "residential" | "commercial";
  billing_address?: Record<string, unknown> | null;
  service_addresses?: Record<string, unknown>[] | null;
  // Layer 3 — true when existing customer has portal_password_hash set.
  // Drives the "Log in to customer portal" vs "View Existing Customer"
  // label swap in the duplicate warning card. Optional for graceful
  // degradation if Commit C (backend) ever rolls back.
  has_portal_access?: boolean;
}

/* ── Labels ── */

export const NEW_CUSTOMER_LABELS = {
  customerCreatedSuccess: "Customer created successfully",
  continueToBooking: "Save and schedule",
  viewCustomer: "View Customer",
  returnToCustomers: "Return to Customers",
  saveCustomerOnly: "Save Customer Only",
  saveAndSchedule: "Save & Schedule Job",
  saveCustomer: "Save Customer",
  saveAndContinue: "Save and schedule",
  nextStep: "After Creating",
  creatingCustomer: "Creating customer...",
  schedulingDetails: "Scheduling Details",
  dumpsterSize: "Dumpster Size",
  deliveryDate: "Delivery Date",
  pickupDate: "Pickup Date",
  pickupTBD: "Pickup TBD",
  siteAddress: "Site Address",
  billingSameAsSite: "Same as billing address",
  paymentMethod: "Payment Method",
  creditCard: "Credit Card",
  cash: "Cash",
  check: "Check",
  selectSize: "Select size",
  selectPaymentMethod: "Select payment method",
  schedulingRequired: "Please fill in all required scheduling fields",
  noSizesAvailable: "No sizes available",
  loadingSizes: "Loading sizes...",
  duplicateCustomerFound: "Possible duplicate customer found",
  matchingEmail: "Matching email",
  matchingPhone: "Matching phone",
  continueCreatingCustomer: "Create new customer anyway",
  viewExistingCustomer: "View Existing Customer",
  loginToCustomerPortal: "Log in to customer portal",
  loginToCustomerPortalToast: "This customer has portal access — they can log in to manage their rental",
  cancelCreateCustomer: "Keep reviewing",
  checkingDuplicate: "Checking for existing customers...",
  bookingCreatedSuccess: "Customer created and job scheduled",
  paymentSucceeded: "Payment processed successfully",
  paymentFailed: "Payment could not be processed",
  bookingUnpaid: "Job scheduled — invoice unpaid",
  continueAsNewCustomer: "Continue as new customer",
  existingCustomerSelected: "Existing customer selected",
  // Decision step labels (Quick Quote existing customer with active dumpsters)
  activeDumpstersFound: "Active dumpsters at this site",
  newRental: "New Rental",
  newRentalDesc: "Deliver an additional dumpster",
  exchangeDumpster: "Exchange",
  exchangeDumpsterDesc: "Swap an existing dumpster",
  selectDumpsterToExchange: "Select dumpster to exchange",
  loadingActiveDumpsters: "Checking for active dumpsters...",
  decisionRequired: "Please choose New Rental or Exchange before continuing",
  exchangeSelectionRequired: "Please select a dumpster to exchange",
};

/* ── Props ── */

interface SchedulePrefill {
  dumpsterSize?: string;
  lockSiteAddress?: boolean;
  siteAddress?: { street: string; city: string; state: string; zip: string; lat?: number | null; lng?: number | null };
}

interface NewCustomerFormProps {
  onOrchestrated: (result: OrchestrationResult) => void;
  onClose: () => void;
  /** When true, hides scheduling fields and forces customer-only creation */
  forceCustomerOnly?: boolean;
  /** Prefill scheduling fields from Quick Quote context */
  initialSchedule?: SchedulePrefill;
}

/* ── Component ── */

export default function NewCustomerForm({ onOrchestrated, onClose, forceCustomerOnly, initialSchedule }: NewCustomerFormProps) {
  const router = useRouter();
  // Strategy B Commit 3 — seed firstName/lastName/email/phone from the
  // Quick Quote pendingQuoteSnapshot on mount. Gated on !!initialSchedule
  // to prevent cross-surface leakage: NCF is also mounted from
  // (dashboard)/customers/page.tsx for "Add Customer" with no
  // initialSchedule prop, and under Position 2 (Commit 2.5 d61923c) the
  // snapshot can survive an abandoned QQ flow. Without this gate the
  // customers-page form would prefill from stale QQ state.
  // hasQuoteContext is true only in the QQ-flow mount (provider.tsx
  // passes initialSchedule={pendingSchedule}); customers-page omits the
  // prop, so the gate resolves false and the seed no-ops. Hook must run
  // BEFORE useState so lazy initializers can read pendingQuoteSnapshot.
  const { pendingQuoteSnapshot } = useQuickQuote();
  const { toast } = useToast();
  const hasQuoteContext = !!initialSchedule;
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [firstName, setFirstName] = useState(() =>
    hasQuoteContext ? (pendingQuoteSnapshot?.customerFields?.firstName ?? "") : "",
  );
  const [lastName, setLastName] = useState(() =>
    hasQuoteContext ? (pendingQuoteSnapshot?.customerFields?.lastName ?? "") : "",
  );
  const [email, setEmail] = useState(() =>
    hasQuoteContext ? (pendingQuoteSnapshot?.customerFields?.email ?? "") : "",
  );
  const [phone, setPhone] = useState(() =>
    hasQuoteContext ? (pendingQuoteSnapshot?.customerFields?.phone ?? "") : "",
  );
  const [companyName, setCompanyName] = useState("");
  const [billingAddress, setBillingAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [nextStep, setNextStep] = useState<NextStep>(forceCustomerOnly ? "save" : "schedule");
  const siteAddressLocked = !!(initialSchedule?.lockSiteAddress && initialSchedule?.siteAddress);

  // Customer autocomplete
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Phase 4 — credit-control booking-flow enforcement.
  // Only meaningful when an existing customer is selected AND the
  // form is in scheduling mode. New customers (no selectedCustomerId)
  // get state === 'unknown' from the hook so no enforcement triggers.
  const creditEnforcement = useCreditEnforcement(selectedCustomerId);
  const {
    setQuery: setCustomerQuery,
    results: searchResults,
    isOpen: showDropdown,
    open: openDropdown,
    close: closeDropdown,
    containerRef: dropdownRef,
    reset: resetCustomerSearch,
  } = useCustomerAutocomplete();
  const [customerServiceSites, setCustomerServiceSites] = useState<AddressValue[]>([]);

  // Duplicate detection (fallback safety)
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatch | null>(null);
  const [duplicateChecked, setDuplicateChecked] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  // Scheduling fields (visible when nextStep === "schedule" and not forceCustomerOnly)
  const [schedDumpsterSize, setSchedDumpsterSize] = useState(initialSchedule?.dumpsterSize || "");
  const [schedDeliveryDate, setSchedDeliveryDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [schedPickupDate, setSchedPickupDate] = useState("");
  const [schedPickupTBD, setSchedPickupTBD] = useState(false);
  const [schedSiteAddress, setSchedSiteAddress] = useState<AddressValue>(
    initialSchedule?.siteAddress
      ? { street: initialSchedule.siteAddress.street, city: initialSchedule.siteAddress.city, state: initialSchedule.siteAddress.state, zip: initialSchedule.siteAddress.zip, lat: initialSchedule.siteAddress.lat ?? null, lng: initialSchedule.siteAddress.lng ?? null }
      : { street: "", city: "", state: "", zip: "", lat: null, lng: null },
  );
  const [schedBillingSameAsSite, setSchedBillingSameAsSite] = useState(!initialSchedule?.siteAddress);
  const [schedPaymentMethod, setSchedPaymentMethod] = useState<"card" | "cash" | "check">("card");
  const [sizeOptions, setSizeOptions] = useState<{ id: string; asset_subtype: string; base_price: number; rental_period_days?: number }[]>([]);
  const [pickupManuallySet, setPickupManuallySet] = useState(false);
  const [sizesLoading, setSizesLoading] = useState(false);

  const showScheduling = !forceCustomerOnly && nextStep === "schedule";
  const isQuickQuoteMode = !!initialSchedule;
  const formatAddr = (a: AddressValue) => [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
  // Track which site source is active: "quote" | "saved-{index}" | "billing" | "new"
  const [siteSource, setSiteSource] = useState<string>(initialSchedule?.siteAddress ? "quote" : "billing");
  const hasQuoteAddress = !!(initialSchedule?.siteAddress?.street);
  // Only show site picker in Quick Quote flow (when initialSchedule is present)
  const hasSavedSites = !!(initialSchedule && selectedCustomerId && customerServiceSites.length > 0);
  const showSitePicker = hasQuoteAddress || hasSavedSites;

  const selectSite = (addr: AddressValue, source: string) => {
    setSchedSiteAddress(addr);
    setSchedBillingSameAsSite(false);
    setSiteSource(source);
    // Reset workflow decision when site changes
    setWorkflowDecision(null);
    setExchangeSelection(null);
  };

  // Customer section collapse (Quick Quote existing customer only)
  const [customerCollapsed, setCustomerCollapsed] = useState(false);

  // Workflow decision state (Quick Quote existing customer only)
  const [workflowDecision, setWorkflowDecision] = useState<"new_rental" | "exchange" | null>(null);
  const [exchangeSelection, setExchangeSelection] = useState<string | null>(null); // rentalChainId

  // Active dumpster detection at selected site (Quick Quote mode only)
  const detectionSiteAddr = schedSiteAddress.street && schedSiteAddress.city && schedSiteAddress.state
    ? { street: schedSiteAddress.street, city: schedSiteAddress.city, state: schedSiteAddress.state, zip: schedSiteAddress.zip }
    : undefined;
  const { hasActiveOnsite, dumpsters: activeDumpsters, isLoading: dumpsterCheckLoading } = useActiveOnsiteDumpsters({
    customerId: isQuickQuoteMode ? (selectedCustomerId ?? undefined) : undefined,
    siteAddress: detectionSiteAddr,
    enabled: isQuickQuoteMode && !!selectedCustomerId && showScheduling,
  });

  // Smart default: auto-select Exchange when active dumpsters are detected
  useEffect(() => {
    if (dumpsterCheckLoading || !hasActiveOnsite || activeDumpsters.length === 0) return;
    // Only default if no decision has been made yet (null = fresh state)
    if (workflowDecision !== null) return;
    setWorkflowDecision("exchange");
    if (activeDumpsters.length === 1) {
      setExchangeSelection(activeDumpsters[0].rentalChainId);
    }
  }, [dumpsterCheckLoading, hasActiveOnsite, activeDumpsters, workflowDecision]);

  // Mirror the pre-migration behavior: the dropdown appears whenever a
  // fetch returns results, and hides when results drain. The call site —
  // not the hook — owns this decision, per the extraction contract.
  useEffect(() => {
    if (searchResults.length > 0) openDropdown();
    else closeDropdown();
  }, [searchResults, openDropdown, closeDropdown]);

  const selectExistingCustomer = (c: typeof searchResults[0]) => {
    setSelectedCustomerId(c.id);
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setEmail(c.email || "");
    setPhone(c.phone || "");
    if (c.billing_address) {
      const addr = c.billing_address as Record<string, any>;
      setBillingAddress({
        street: addr.street || "",
        city: addr.city || "",
        state: addr.state || "",
        zip: addr.zip || "",
        lat: addr.lat != null ? Number(addr.lat) : null,
        lng: addr.lng != null ? Number(addr.lng) : null,
      });
    }
    // Store saved service sites for scheduling site picker
    if (c.service_addresses && c.service_addresses.length > 0) {
      setCustomerServiceSites(c.service_addresses.map((a: Record<string, any>) => ({
        street: a.street || "", city: a.city || "", state: a.state || "", zip: a.zip || "",
        lat: a.lat != null ? Number(a.lat) : null, lng: a.lng != null ? Number(a.lng) : null,
      })));
    } else {
      setCustomerServiceSites([]);
    }
    // Reset the hook: clears query + results + isOpen and aborts any
    // in-flight fetch. Keeps the input fields populated via setFirstName/
    // setLastName above. If the user later edits the name, the onChange
    // pipes through setCustomerQuery and a fresh fetch cycle runs.
    resetCustomerSearch();
    setDuplicateChecked(true);
    setCustomerCollapsed(true);
  };

  const clearSelectedCustomer = () => {
    if (selectedCustomerId) { setSelectedCustomerId(null); setDuplicateChecked(false); setCustomerServiceSites([]); setCustomerCollapsed(false); }
  };

  // Fetch tenant-scoped size options when scheduling is selected
  useEffect(() => {
    if (!showScheduling) return;
    if (sizeOptions.length > 0) return;
    setSizesLoading(true);
    api.get<{ data: { id: string; asset_subtype: string; base_price: number; rental_period_days?: number }[] }>("/pricing?limit=100")
      .then((res) => {
        const opts = res.data || [];
        setSizeOptions(opts);
        if (schedDumpsterSize && !opts.some(o => o.asset_subtype === schedDumpsterSize)) {
          setSchedDumpsterSize("");
        }
      })
      .catch(() => setSizeOptions([]))
      .finally(() => setSizesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScheduling]);

  // Auto-calculate pickup date
  useEffect(() => {
    if (pickupManuallySet || schedPickupTBD || !schedDeliveryDate || !schedDumpsterSize) return;
    const sizeOpt = sizeOptions.find(o => o.asset_subtype === schedDumpsterSize);
    const days = sizeOpt?.rental_period_days ?? 14;
    const d = new Date(schedDeliveryDate);
    d.setDate(d.getDate() + days);
    setSchedPickupDate(d.toISOString().split("T")[0]);
  }, [schedDeliveryDate, schedDumpsterSize, sizeOptions, schedPickupTBD, pickupManuallySet]);

  const compact = true; // tighter spacing for all modes
  const inputStyle: React.CSSProperties = {
    width: "100%", backgroundColor: "var(--t-bg-card)", border: "1px solid var(--t-border)",
    borderRadius: 10, padding: compact ? "8px 14px" : "10px 16px", fontSize: 14, color: "var(--t-text-primary)",
    outline: "none", transition: "border-color 0.15s ease",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600, color: "var(--t-text-muted)",
    textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: compact ? 4 : 6,
  };
  const sectionStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: "var(--t-text-muted)", textTransform: "uppercase",
    letterSpacing: "0.5px", paddingTop: compact ? 10 : 16, paddingBottom: compact ? 6 : 8,
    borderTop: "1px solid var(--t-border)", marginTop: compact ? 10 : 16,
  };
  const formGap = compact ? 10 : 16;

  const effectiveIntent = forceCustomerOnly ? "customer_only" : (nextStep === "schedule" ? "schedule_job" : "customer_only");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (showScheduling) {
      if (!schedDumpsterSize || !schedDeliveryDate || (!schedPickupDate && !schedPickupTBD)) {
        setError(NEW_CUSTOMER_LABELS.schedulingRequired);
        return;
      }
      // Block submission if active dumpsters exist but no decision made
      if (isQuickQuoteMode && selectedCustomerId && hasActiveOnsite && !workflowDecision) {
        setError(NEW_CUSTOMER_LABELS.decisionRequired);
        return;
      }
      if (workflowDecision === "exchange" && !exchangeSelection) {
        setError(NEW_CUSTOMER_LABELS.exchangeSelectionRequired);
        return;
      }
    }

    // Duplicate detection
    if (!duplicateChecked) {
      const normalizedPhone = phone.replace(/\D/g, "");
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedPhone || normalizedEmail) {
        setCheckingDuplicate(true);
        try {
          for (const [field, val] of [["phone", normalizedPhone], ["email", normalizedEmail]] as const) {
            if (!val) continue;
            const res = await api.get<{ data: { id: string; first_name: string; last_name: string; email: string; phone: string; has_portal_access?: boolean }[]; meta: { total: number } }>(`/customers?search=${encodeURIComponent(val)}&limit=1`);
            if (res.meta.total > 0) {
              const match = res.data[0];
              const matchedPhone = field === "phone" && match.phone?.replace(/\D/g, "") === normalizedPhone;
              const matchedEmail = field === "email" && match.email?.trim().toLowerCase() === normalizedEmail;
              if (matchedPhone || matchedEmail) {
                setDuplicateMatch({ ...match, matchField: field });
                setCheckingDuplicate(false);
                return;
              }
            }
          }
        } catch { /* proceed if check fails */ }
        setCheckingDuplicate(false);
      }
      setDuplicateChecked(true);
    }

    // For forceCustomerOnly + existing customer: skip API call, return immediately
    if (forceCustomerOnly && selectedCustomerId) {
      onOrchestrated({ customerId: selectedCustomerId, status: "customer_only", nextAction: "schedule" });
      return;
    }

    setSaving(true);
    try {
      const addr = billingAddress.street ? { street: billingAddress.street, city: billingAddress.city, state: billingAddress.state, zip: billingAddress.zip, lat: billingAddress.lat, lng: billingAddress.lng } : undefined;
      const siteAddr = schedBillingSameAsSite ? billingAddress : schedSiteAddress;

      // Phase 4B — backend is server-authoritative for credit
      // enforcement and audit trail. The follow-up PATCH from
      // Phase 4A is removed because the orchestration service now
      // accepts creditOverride + placementNotes in the DTO and writes
      // the audit note to the new job's placement_notes inside the
      // same transaction as the booking creation.
      const creditOverridePayload = creditEnforcement.overrideActive
        ? { reason: creditEnforcement.overrideReason }
        : undefined;

      const result = await api.post<OrchestrationResult>("/bookings/create-with-booking", {
        ...(selectedCustomerId ? { customerId: selectedCustomerId } : {}),
        type, firstName, lastName,
        email: email || undefined,
        phone: phone || undefined,
        companyName: type === "commercial" ? companyName || undefined : undefined,
        billingAddress: addr,
        notes: notes || undefined,
        tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
        leadSource: leadSource || undefined,
        intent: effectiveIntent,
        ...(showScheduling ? {
          dumpsterSize: schedDumpsterSize,
          deliveryDate: schedDeliveryDate,
          pickupDate: schedPickupTBD ? undefined : schedPickupDate,
          pickupTBD: schedPickupTBD,
          siteAddress: siteAddr.street ? { street: siteAddr.street, city: siteAddr.city, state: siteAddr.state, zip: siteAddr.zip, lat: siteAddr.lat, lng: siteAddr.lng } : undefined,
          paymentMethod: schedPaymentMethod,
          ...(workflowDecision === "exchange" && exchangeSelection ? { jobType: "exchange", exchangeRentalChainId: exchangeSelection } : {}),
        } : {}),
        idempotencyKey,
        confirmedCreateDespiteDuplicate: duplicateChecked,
        creditOverride: creditOverridePayload,
      });

      onOrchestrated(result);
    } catch (err: unknown) {
      // api.ts attaches parsed body as err.body and HTTP status as err.status
      // (api.ts:51-64). Prior code read err.response?.data (axios shape) — dead
      // code that never matched. This rewrite fixes the 400 pre-submit branch
      // AND adds 409 duplicate_email handling (backend Commit A f46cab2).
      const typedErr = err as Error & { status?: number; body?: unknown };
      const body = typedErr.body as
        | {
            code?: string;
            existingCustomerId?: string;
            existing_customer_id?: string;
            existing_customer_name?: string;
            existing_customer?: {
              id: string;
              first_name: string | null;
              last_name: string | null;
              company_name: string | null;
              email: string | null;
              phone: string | null;
              type?: "residential" | "commercial";
              billing_address?: Record<string, unknown> | null;
              service_addresses?: Record<string, unknown>[] | null;
              has_portal_access?: boolean;
            };
          }
        | undefined;

      // Case 1: Backend 409 duplicate_email — full customer row attached.
      // Populate duplicateMatch directly, no round-trip needed.
      if (
        typedErr.status === 409 &&
        body?.code === "duplicate_email" &&
        body.existing_customer
      ) {
        const ec = body.existing_customer;
        setDuplicateMatch({
          id: ec.id,
          first_name: ec.first_name || "",
          last_name: ec.last_name || "",
          email: ec.email || "",
          phone: ec.phone || "",
          matchField: "email",
          company_name: ec.company_name,
          type: ec.type,
          billing_address: ec.billing_address,
          service_addresses: ec.service_addresses,
          has_portal_access: ec.has_portal_access,
        });
        return;
      }

      // Case 2: Backend 400 DUPLICATE_CUSTOMER (pre-submit guardrail).
      // Fetch full row via /customers?search= to populate the warning card.
      // This path was broken before — prior code read err.response?.data which
      // never matched; the card only appeared via NCF's independent pre-submit
      // check at L321-346. Now this branch also works as originally intended.
      if (
        typedErr.status === 400 &&
        body?.code === "DUPLICATE_CUSTOMER" &&
        body.existingCustomerId
      ) {
        try {
          const res = await api.get<{
            data: {
              id: string;
              first_name: string;
              last_name: string;
              email: string;
              phone: string;
              billing_address?: Record<string, unknown>;
              service_addresses?: Record<string, unknown>[];
              has_portal_access?: boolean;
            }[];
            meta: { total: number };
          }>(`/customers?search=${encodeURIComponent(email || phone)}&limit=1`);
          if (res.data.length > 0) {
            setDuplicateMatch({
              ...res.data[0],
              matchField: email ? "email" : "phone",
            });
            return;
          }
        } catch {
          /* fall through to generic error */
        }
      }

      setError(err instanceof Error ? err.message : "Failed to create");
    } finally { setSaving(false); }
  };

  const submitLabel = checkingDuplicate
    ? NEW_CUSTOMER_LABELS.checkingDuplicate
    : saving
    ? NEW_CUSTOMER_LABELS.creatingCustomer
    : forceCustomerOnly
    ? (selectedCustomerId ? "Continue with Selected Customer" : NEW_CUSTOMER_LABELS.saveAndContinue)
    : isQuickQuoteMode
    ? NEW_CUSTOMER_LABELS.continueToBooking
    : nextStep === "schedule"
    ? NEW_CUSTOMER_LABELS.saveAndContinue
    : NEW_CUSTOMER_LABELS.saveCustomer;

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: formGap }}>
      {error && (
        <div style={{ backgroundColor: "var(--t-error-soft)", border: "1px solid var(--t-border)", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "var(--t-error)" }}>
          {error}
        </div>
      )}

      {/* Customer section — collapsed summary or full form */}
      {customerCollapsed && firstName.trim() && lastName.trim() ? (
        <div style={{ backgroundColor: "var(--t-bg-card)", border: "1px solid var(--t-border)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t-text-primary)" }}>{firstName} {lastName}</div>
            {formatAddr(billingAddress) && <div style={{ fontSize: 12, color: "var(--t-text-muted)", marginTop: 2 }}>{formatAddr(billingAddress)}</div>}
            {phone && <div style={{ fontSize: 12, color: "var(--t-text-muted)", marginTop: 1 }}>{phone}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => setCustomerCollapsed(false)}
              style={{ fontSize: 12, fontWeight: 600, color: "var(--t-accent)", background: "none", border: "none", cursor: "pointer" }}>
              Edit
            </button>
            {selectedCustomerId && (
              <button type="button" onClick={() => { clearSelectedCustomer(); setFirstName(""); setLastName(""); setEmail(""); setPhone(""); }}
                style={{ fontSize: 12, fontWeight: 600, color: "var(--t-text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                &times;
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Contact Info */}
          <p style={{ ...sectionStyle, borderTop: "none", marginTop: 0, paddingTop: 0 }}>Contact Info</p>

          <div>
            <label style={labelStyle}>Type</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {(["residential", "commercial"] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  style={{ padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600, textTransform: "capitalize", border: type === t ? "none" : "1px solid var(--t-border)", backgroundColor: type === t ? "var(--t-accent)" : "transparent", color: type === t ? "var(--t-accent-on-accent)" : "var(--t-text-muted)", cursor: "pointer", transition: "all 0.15s ease" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {type === "commercial" && (
            <div>
              <label style={labelStyle}>Company</label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} style={inputStyle} placeholder="Acme Construction" />
            </div>
          )}

          <div style={{ position: "relative" }} ref={dropdownRef}>
            {selectedCustomerId && (
              <div style={{ backgroundColor: "var(--t-accent-soft)", borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 12, color: "var(--t-accent)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{NEW_CUSTOMER_LABELS.existingCustomerSelected}</span>
                <button type="button" onClick={() => { clearSelectedCustomer(); setFirstName(""); setLastName(""); setEmail(""); setPhone(""); }} style={{ background: "none", border: "none", color: "var(--t-accent)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>&times;</button>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>First Name</label>
                <input value={firstName} onChange={e => { setFirstName(e.target.value); clearSelectedCustomer(); setCustomerQuery(`${e.target.value} ${lastName}`.trim()); }} required style={inputStyle} placeholder="Jane" autoComplete="off" />
              </div>
              <div>
                <label style={labelStyle}>Last Name</label>
                <input value={lastName} onChange={e => { setLastName(e.target.value); clearSelectedCustomer(); setCustomerQuery(`${firstName} ${e.target.value}`.trim()); }} required style={inputStyle} placeholder="Smith" autoComplete="off" />
              </div>
            </div>
            <CustomerAutocompleteDropdown
              results={searchResults}
              isLoading={false}
              isOpen={showDropdown}
              onSelect={selectExistingCustomer}
              onContinueAsNew={closeDropdown}
              labels={{ continueAsNew: NEW_CUSTOMER_LABELS.continueAsNewCustomer }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Phone</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} placeholder="(555) 555-5555" />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} placeholder="jane@example.com" />
            </div>
          </div>

          {/* Address */}
          <p style={sectionStyle}>Billing Address</p>
          <AddressAutocomplete value={billingAddress} onChange={setBillingAddress} placeholder="Search address..." />

          {/* Account */}
          <p style={sectionStyle}>Account</p>
          <div>
            <label style={labelStyle}>Lead Source</label>
            <select value={leadSource} onChange={e => setLeadSource(e.target.value)} style={{ ...inputStyle, appearance: "none" }}>
              <option value="">Select source</option>
              <option value="phone">Phone Call</option>
              <option value="website">Website</option>
              <option value="marketplace">RentThis Marketplace</option>
              <option value="referral">Referral</option>
              <option value="google">Google</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Tags</label>
            <input value={tags} onChange={e => setTags(e.target.value)} style={inputStyle} placeholder="VIP, Contractor, Repeat Customer (comma-separated)" />
          </div>
        </>
      )}

      {/* Next step selector — hidden in forceCustomerOnly and Quick Quote modes */}
      {!forceCustomerOnly && !isQuickQuoteMode && (
        <div style={{ marginTop: 8 }}>
          <label style={labelStyle}>{NEW_CUSTOMER_LABELS.nextStep}</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {([
              { key: "schedule" as const, label: NEW_CUSTOMER_LABELS.saveAndSchedule },
              { key: "save" as const, label: NEW_CUSTOMER_LABELS.saveCustomerOnly },
            ]).map(opt => (
              <button key={opt.key} type="button" onClick={() => { setNextStep(opt.key); if (opt.key === "schedule" && firstName.trim() && lastName.trim()) setCustomerCollapsed(true); }}
                style={{ padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600, border: nextStep === opt.key ? "none" : "1px solid var(--t-border)", backgroundColor: nextStep === opt.key ? "var(--t-accent)" : "transparent", color: nextStep === opt.key ? "var(--t-accent-on-accent)" : "var(--t-text-muted)", cursor: "pointer", transition: "all 0.15s ease" }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scheduling Details */}
      {showScheduling && (
        <>
          <p style={sectionStyle}>{NEW_CUSTOMER_LABELS.schedulingDetails}</p>
          <div>
            <label style={labelStyle}>{NEW_CUSTOMER_LABELS.dumpsterSize}</label>
            <select value={schedDumpsterSize} onChange={e => setSchedDumpsterSize(e.target.value)} disabled={sizesLoading} style={{ ...inputStyle, appearance: "none", opacity: sizesLoading ? 0.5 : 1 }}>
              <option value="">{sizesLoading ? NEW_CUSTOMER_LABELS.loadingSizes : sizeOptions.length === 0 ? NEW_CUSTOMER_LABELS.noSizesAvailable : NEW_CUSTOMER_LABELS.selectSize}</option>
              {sizeOptions.map(opt => (
                <option key={opt.id} value={opt.asset_subtype}>{opt.asset_subtype} — {formatCurrency(opt.base_price)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>{NEW_CUSTOMER_LABELS.deliveryDate}</label>
              <input type="date" value={schedDeliveryDate} onChange={e => setSchedDeliveryDate(e.target.value)} onClick={e => (e.target as HTMLInputElement).showPicker?.()} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{NEW_CUSTOMER_LABELS.pickupDate}</label>
              <input type="date" value={schedPickupDate} onChange={e => { setSchedPickupDate(e.target.value); setPickupManuallySet(true); }} onClick={e => { if (!schedPickupTBD) (e.target as HTMLInputElement).showPicker?.(); }} disabled={schedPickupTBD} style={{ ...inputStyle, opacity: schedPickupTBD ? 0.5 : 1 }} />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--t-text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={schedPickupTBD} onChange={e => { setSchedPickupTBD(e.target.checked); if (e.target.checked) setSchedPickupDate(""); }} />
            {NEW_CUSTOMER_LABELS.pickupTBD}
          </label>
          <div>
            <label style={labelStyle}>{NEW_CUSTOMER_LABELS.siteAddress}</label>
            {showSitePicker ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {/* Quote address option */}
                {hasQuoteAddress && (
                  <button type="button" onClick={() => selectSite(
                    { street: initialSchedule!.siteAddress!.street, city: initialSchedule!.siteAddress!.city, state: initialSchedule!.siteAddress!.state, zip: initialSchedule!.siteAddress!.zip, lat: initialSchedule!.siteAddress!.lat ?? null, lng: initialSchedule!.siteAddress!.lng ?? null },
                    "quote",
                  )}
                    style={{ width: "100%", textAlign: "left", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer", border: siteSource === "quote" ? "2px solid var(--t-accent)" : "1px solid var(--t-border)", backgroundColor: siteSource === "quote" ? "var(--t-accent-soft)" : "var(--t-bg-card)", color: "var(--t-text-primary)", transition: "all 0.15s ease" }}>
                    {formatAddr({ street: initialSchedule!.siteAddress!.street, city: initialSchedule!.siteAddress!.city, state: initialSchedule!.siteAddress!.state, zip: initialSchedule!.siteAddress!.zip, lat: null, lng: null })}
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--t-accent)" }}>From quote</span>
                  </button>
                )}
                {/* Saved service sites */}
                {hasSavedSites && customerServiceSites.map((site, i) => (
                  <button key={i} type="button" onClick={() => selectSite(site, `saved-${i}`)}
                    style={{ width: "100%", textAlign: "left", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer", border: siteSource === `saved-${i}` ? "2px solid var(--t-accent)" : "1px solid var(--t-border)", backgroundColor: siteSource === `saved-${i}` ? "var(--t-accent-soft)" : "var(--t-bg-card)", color: "var(--t-text-primary)", transition: "all 0.15s ease" }}>
                    {formatAddr(site)}
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--t-text-muted)" }}>Saved site</span>
                  </button>
                ))}
                {/* Option to enter a new address */}
                <button type="button" onClick={() => { setSiteSource("new"); setSchedBillingSameAsSite(false); setSchedSiteAddress({ street: "", city: "", state: "", zip: "", lat: null, lng: null }); }}
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--t-accent)", backgroundColor: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: "4px 0" }}>
                  + Enter different address
                </button>
                {siteSource === "new" && (
                  <AddressAutocomplete value={schedSiteAddress} onChange={a => setSchedSiteAddress(a)} placeholder="Search site address..." />
                )}
              </div>
            ) : (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--t-text-muted)", cursor: "pointer", marginBottom: 8 }}>
                  <input type="checkbox" checked={schedBillingSameAsSite} onChange={e => { setSchedBillingSameAsSite(e.target.checked); setSiteSource(e.target.checked ? "billing" : "new"); }} />
                  {NEW_CUSTOMER_LABELS.billingSameAsSite}
                </label>
                {!schedBillingSameAsSite && (
                  <AddressAutocomplete value={schedSiteAddress} onChange={setSchedSiteAddress} placeholder="Search site address..." />
                )}
              </>
            )}
          </div>

          {/* Workflow decision — active dumpsters at site (Quick Quote existing customer only) */}
          {isQuickQuoteMode && selectedCustomerId && showScheduling && dumpsterCheckLoading && (
            <p style={{ fontSize: 13, color: "var(--t-text-muted)" }}>{NEW_CUSTOMER_LABELS.loadingActiveDumpsters}</p>
          )}
          {isQuickQuoteMode && selectedCustomerId && showScheduling && !dumpsterCheckLoading && hasActiveOnsite && activeDumpsters.length > 0 && (
            <div>
              <label style={labelStyle}>{NEW_CUSTOMER_LABELS.activeDumpstersFound}</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button type="button" onClick={() => { setWorkflowDecision("new_rental"); setExchangeSelection(null); }}
                  style={{ padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600, border: workflowDecision === "new_rental" ? "none" : "1px solid var(--t-border)", backgroundColor: workflowDecision === "new_rental" ? "var(--t-accent)" : "transparent", color: workflowDecision === "new_rental" ? "var(--t-accent-on-accent)" : "var(--t-text-muted)", cursor: "pointer", transition: "all 0.15s ease", textAlign: "center" }}>
                  {NEW_CUSTOMER_LABELS.newRental}
                </button>
                <button type="button" onClick={() => { setWorkflowDecision("exchange"); if (activeDumpsters.length === 1) setExchangeSelection(activeDumpsters[0].rentalChainId); }}
                  style={{ padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600, border: workflowDecision === "exchange" ? "none" : "1px solid var(--t-border)", backgroundColor: workflowDecision === "exchange" ? "var(--t-accent)" : "transparent", color: workflowDecision === "exchange" ? "var(--t-accent-on-accent)" : "var(--t-text-muted)", cursor: "pointer", transition: "all 0.15s ease", textAlign: "center" }}>
                  {NEW_CUSTOMER_LABELS.exchangeDumpster}
                </button>
              </div>
              {/* Exchange dumpster picker */}
              {workflowDecision === "exchange" && (
                <div style={{ marginTop: 8 }}>
                  <label style={labelStyle}>{NEW_CUSTOMER_LABELS.selectDumpsterToExchange}</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {activeDumpsters.map((d) => (
                      <label key={d.rentalChainId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: exchangeSelection === d.rentalChainId ? "2px solid var(--t-accent)" : "1px solid var(--t-border)", backgroundColor: exchangeSelection === d.rentalChainId ? "var(--t-accent-soft)" : "var(--t-bg-card)", cursor: "pointer", transition: "all 0.15s ease" }}>
                        <input type="radio" name="exchangeDumpster" checked={exchangeSelection === d.rentalChainId} onChange={() => setExchangeSelection(d.rentalChainId)} style={{ accentColor: "var(--t-accent)" }} />
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t-text-primary)" }}>{formatDumpsterSize(d.size)}</span>
                          {d.assetIdentifier && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--t-text-muted)" }}>#{d.assetIdentifier}</span>}
                          <span style={{ display: "block", fontSize: 11, color: "var(--t-text-muted)", marginTop: 2 }}>Delivered {d.deliveredAt}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label style={labelStyle}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "none" }} placeholder="Driver notes, placement instructions..." />
          </div>

          <div>
            <label style={labelStyle}>{NEW_CUSTOMER_LABELS.paymentMethod}</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {([
                { key: "card" as const, label: NEW_CUSTOMER_LABELS.creditCard },
                { key: "cash" as const, label: NEW_CUSTOMER_LABELS.cash },
                { key: "check" as const, label: NEW_CUSTOMER_LABELS.check },
              ]).map(opt => (
                <button key={opt.key} type="button" onClick={() => setSchedPaymentMethod(opt.key)}
                  style={{ padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600, border: schedPaymentMethod === opt.key ? "none" : "1px solid var(--t-border)", backgroundColor: schedPaymentMethod === opt.key ? "var(--t-accent)" : "transparent", color: schedPaymentMethod === opt.key ? "var(--t-accent-on-accent)" : "var(--t-text-muted)", cursor: "pointer", transition: "all 0.15s ease" }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Duplicate warning */}
      {duplicateMatch && (
        <div style={{ backgroundColor: "var(--t-accent-soft)", border: "1px solid var(--t-accent)", borderRadius: 10, padding: "16px", fontSize: 13 }}>
          <p style={{ fontWeight: 600, color: "var(--t-text-primary)", marginBottom: 4 }}>{NEW_CUSTOMER_LABELS.duplicateCustomerFound}</p>
          <p style={{ color: "var(--t-text-muted)", marginBottom: 2 }}>{duplicateMatch.first_name} {duplicateMatch.last_name}</p>
          <p style={{ color: "var(--t-text-muted)", marginBottom: 12, fontSize: 12 }}>
            {duplicateMatch.matchField === "email" ? NEW_CUSTOMER_LABELS.matchingEmail : NEW_CUSTOMER_LABELS.matchingPhone}: {duplicateMatch.matchField === "email" ? duplicateMatch.email : duplicateMatch.phone}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button type="button" onClick={() => {
              selectExistingCustomer({
                id: duplicateMatch.id,
                // account_id is not available in the DuplicateMatch shape
                // (the /customers?search endpoint that produces it doesn't
                // return it). NCF does not render account_id — it only
                // prefills fields and submits with customerId. Empty-string
                // placeholder satisfies the CustomerSearchResult contract
                // used by the shared autocomplete without adding a new
                // backend field or widening DuplicateMatch.
                account_id: "",
                first_name: duplicateMatch.first_name,
                last_name: duplicateMatch.last_name,
                email: duplicateMatch.email,
                phone: duplicateMatch.phone,
                billing_address: (duplicateMatch.billing_address ?? null) as CustomerSearchAddress | null,
                service_addresses: (duplicateMatch.service_addresses ?? null) as CustomerSearchAddress[] | null,
              });
              setDuplicateMatch(null);
            }}
              style={{ width: "100%", padding: "10px 0", borderRadius: 24, fontSize: 13, fontWeight: 600, backgroundColor: "var(--t-accent)", color: "var(--t-accent-on-accent)", border: "none", cursor: "pointer" }}>
              Use this customer
            </button>
            <button type="button" onClick={() => { setDuplicateMatch(null); setDuplicateChecked(true); }}
              style={{ width: "100%", padding: "10px 0", borderRadius: 24, fontSize: 13, fontWeight: 600, backgroundColor: "transparent", color: "var(--t-text-primary)", border: "1px solid var(--t-border)", cursor: "pointer" }}>
              {NEW_CUSTOMER_LABELS.continueCreatingCustomer}
            </button>
            <button type="button" onClick={() => {
              // Layer 3 — fire portal-framing toast BEFORE navigation so
              // route-level state cleanup can't kill it. Toast only when
              // the customer has portal access; non-portal path stays
              // identical to pre-Commit-D behavior.
              if (duplicateMatch.has_portal_access) {
                toast("success", NEW_CUSTOMER_LABELS.loginToCustomerPortalToast);
              }
              onClose();
              router.push(`/customers/${duplicateMatch.id}`);
            }}
              style={{ width: "100%", padding: "10px 0", borderRadius: 24, fontSize: 13, fontWeight: 600, backgroundColor: "transparent", color: "var(--t-text-primary)", border: "1px solid var(--t-border)", cursor: "pointer" }}>
              {duplicateMatch.has_portal_access
                ? NEW_CUSTOMER_LABELS.loginToCustomerPortal
                : NEW_CUSTOMER_LABELS.viewExistingCustomer}
            </button>
            <button type="button" onClick={() => setDuplicateMatch(null)}
              style={{ fontSize: 12, color: "var(--t-text-muted)", backgroundColor: "transparent", border: "none", cursor: "pointer" }}>
              {NEW_CUSTOMER_LABELS.cancelCreateCustomer}
            </button>
          </div>
        </div>
      )}

      {/* Spacer so sticky bar doesn't cover last form fields */}
      <div style={{ height: 72 }} />

      {/* Sticky bottom CTA bar */}
      <div style={{
          position: "sticky", bottom: -24, left: -24, right: -24,
          marginLeft: -24, marginRight: -24,
          backgroundColor: "var(--t-bg-secondary)",
          borderTop: "1px solid var(--t-border)",
          padding: "12px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ fontSize: 12, color: "var(--t-text-muted)", minWidth: 0 }}>
            {schedDumpsterSize && <span style={{ fontWeight: 600, color: "var(--t-text-primary)" }}>{formatDumpsterSize(schedDumpsterSize)}</span>}
            {workflowDecision === "exchange" && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--t-accent)", fontWeight: 600 }}>EXCHANGE</span>}
            {workflowDecision === "new_rental" && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--t-text-muted)", fontWeight: 600 }}>NEW RENTAL</span>}
          </div>
          <button type="submit" disabled={saving || checkingDuplicate || (showScheduling && !!selectedCustomerId && creditEnforcement.shouldBlockSubmit)}
            style={{ backgroundColor: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontSize: 14, fontWeight: 700, padding: "12px 28px", borderRadius: 24, border: "none", cursor: (saving || checkingDuplicate || (showScheduling && !!selectedCustomerId && creditEnforcement.shouldBlockSubmit)) ? "default" : "pointer", opacity: (saving || checkingDuplicate || (showScheduling && !!selectedCustomerId && creditEnforcement.shouldBlockSubmit)) ? 0.5 : 1, transition: "opacity 0.15s ease", whiteSpace: "nowrap" }}>
            {submitLabel}
          </button>
        </div>
        {/* Phase 4 — credit-control booking enforcement banner.
            Only meaningful when an existing customer is selected and
            we're in scheduling mode. The banner renders nothing in
            normal/loading/unknown states, so it's safe to mount
            unconditionally — the hook gates internally on customerId. */}
        {showScheduling && selectedCustomerId && (
          <div className="px-6 pb-4">
            <CreditEnforcementBanner enforcement={creditEnforcement} />
          </div>
        )}
    </form>
  );
}
