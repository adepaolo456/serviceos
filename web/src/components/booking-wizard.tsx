"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Plus, Loader2, MapPin, Check, ToggleLeft, ToggleRight } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/utils";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { useActiveOnsiteDumpsters } from "@/lib/use-active-onsite-dumpsters";
import { getFeatureLabel, getFeatureTooltip } from "@/lib/feature-registry";
import { useCreditEnforcement } from "@/lib/use-credit-enforcement";
import { CreditEnforcementBanner } from "@/components/credit-enforcement-banner";
import { useQuickQuote } from "@/components/quick-quote-provider";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface InitialSchedule {
  dumpsterSize?: string;
  deliveryDate?: string;
  pickupDate?: string | null;
  pickupTBD?: boolean;
  siteAddress?: { street: string; city: string; state: string; zip: string; lat?: number | null; lng?: number | null };
  paymentMethod?: "card" | "cash" | "check";
  lockSiteAddress?: boolean;
}

interface BookingWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete?: (createdJobId?: string) => void;
  prefillCustomerId?: string;
  prefillDate?: string;
  initialSchedule?: InitialSchedule;
  /** Slide-over origin side. Default 'right' preserves established UX
   *  for the 4 BookingProvider consumers (jobs page, customers list,
   *  customer detail, dashboard hotkey). Quick Quote → Book Now passes
   *  'left' to keep its flow continuous with the left-anchored quote
   *  drawer. */
  side?: 'left' | 'right';
}

interface CustomerSearchResult {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  company_name?: string;
  email: string;
  phone: string;
  type?: string;
  billing_address?: AddressFields;
  service_addresses?: AddressFields[];
  customer_preferences?: { additionalContacts?: ContactRow[] };
}

interface AddressFields {
  street: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  lat?: number | null;
  lng?: number | null;
}

interface ContactRow {
  name?: string;
  value: string;
  role: string;
}

interface PricingOption {
  id: string;
  asset_subtype: string;
  base_price: number;
  included_tons?: number;
  overage_per_ton?: number;
  rental_period_days?: number;
}

interface PriceQuote {
  base_price: number;
  weight_allowance: number;
  overage_rate: number;
  total: number;
  distanceMiles: number;
  distanceCharge: number;
}

interface AvailabilityResponse {
  availableOnDate: number;
  availableNow: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const CONTACT_ROLES = ["Accounting", "Site Contact", "Property Manager", "General"];
const RENTAL_LENGTHS = [7, 14, 21, 30];
const PRIORITIES = ["Normal", "First Stop", "Last Stop", "AM Only", "PM Only"];

const INPUT_CLASS =
  "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";

const LABEL_CLASS = "block text-[11px] font-semibold uppercase tracking-wide mb-1";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getNextBusinessDay(offset = 1): string {
  const d = new Date();
  let added = 0;
  while (added < offset) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="relative flex items-center py-1.5">
      <div className="flex-1 h-px" style={{ backgroundColor: "var(--t-border)" }} />
      <span
        className="px-3 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--t-text-muted)" }}
      >
        {label}
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: "var(--t-border)" }} />
    </div>
  );
}

function TileButton({
  selected,
  onClick,
  title,
  subtitle,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-[20px] border px-4 py-2.5 text-left transition-colors"
      style={{
        backgroundColor: selected ? "var(--t-accent-soft)" : "var(--t-bg-card)",
        borderColor: selected ? "var(--t-accent)" : "var(--t-border)",
      }}
    >
      <span className="block text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
        {title}
      </span>
      <span className="block text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
        {subtitle}
      </span>
    </button>
  );
}

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1.5">
      {[1, 2, 3].map((s) => (
        <div
          key={s}
          className="h-2 w-2 rounded-full transition-colors"
          style={{
            backgroundColor: s <= step ? "var(--t-accent)" : "var(--t-text-muted)",
            opacity: s <= step ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function BookingWizard({
  open,
  onClose,
  onComplete,
  prefillCustomerId,
  prefillDate,
  initialSchedule,
  side = 'right',
}: BookingWizardProps) {
  const { toast } = useToast();
  // Strategy B Commit 2 — read pendingQuoteSnapshot via context (not a
  // prop) so the 4+ non-QQD BW entry points compile and no-op safely.
  // When BW is mounted outside QuickQuoteProvider, context default has
  // pendingQuoteSnapshot: null and the seed block below skips entirely.
  const { pendingQuoteSnapshot } = useQuickQuote();
  const [step, setStep] = useState(1);

  // Step 1 — Customer
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [clientType, setClientType] = useState<"residential" | "commercial" | "">("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [additionalContacts, setAdditionalContacts] = useState<ContactRow[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [serviceAddressMode, setServiceAddressMode] = useState<"same" | "different" | "existing">("same");
  const [selectedAddressIdx, setSelectedAddressIdx] = useState(0);
  const [newServiceAddress, setNewServiceAddress] = useState<AddressFields>({ street: "", city: "", state: "", zip: "" });
  const [siteAddressLocked, setSiteAddressLocked] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2 — Billing address
  const [billingAddress, setBillingAddress] = useState<AddressFields>({ street: "", street2: "", city: "", state: "", zip: "", county: "" });

  // Step 3 — Schedule
  const [taskType, setTaskType] = useState<"drop_off" | "delivery" | "exchange">("drop_off");
  const [dumpsterSize, setDumpsterSize] = useState("");
  // Exchange state
  const [activeRentals, setActiveRentals] = useState<Array<{ id: string; dumpster_size: string; drop_off_date: string; asset_id: string | null; customer_id: string; status: string; links?: Array<{ job_id: string; task_type: string; status: string }>; asset?: { id: string; identifier: string } | null }>>([]);
  const [selectedRentalForExchange, setSelectedRentalForExchange] = useState<string>("");
  const [exchangeReplacementSize, setExchangeReplacementSize] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(prefillDate || getNextBusinessDay());
  const [rentalLength, setRentalLength] = useState(14);
  const [priority, setPriority] = useState("Normal");
  const [autoSchedulePickup, setAutoSchedulePickup] = useState(true);
  const [driverNotes, setDriverNotes] = useState("");
  const [pricingOptions, setPricingOptions] = useState<PricingOption[]>([]);
  const [priceQuote, setPriceQuote] = useState<PriceQuote | null>(null);
  const [availability, setAvailability] = useState<number | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendInvoiceNow, setSendInvoiceNow] = useState(false);
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState<"card" | "cash" | "check" | "invoice">("invoice");
  const [rentalsLoading, setRentalsLoading] = useState(false);

  // Phase 4 — credit-control booking-flow enforcement.
  // Re-evaluates live whenever the selected customer changes. The hook
  // owns the override state; the banner renders the warn/block UI; we
  // gate the submit buttons on `shouldBlockSubmit` and append the
  // audit override note to placementNotes when an override is active.
  // New customers (no selectedCustomer.id) get state === 'unknown' so
  // no enforcement triggers — they have no credit history yet.
  const creditEnforcement = useCreditEnforcement(selectedCustomer?.id);

  // Smart exchange detection
  const [jobTypeManuallySet, setJobTypeManuallySet] = useState(false);
  const [exchangeAutoDetected, setExchangeAutoDetected] = useState(false);

  // Derive structured site address for detection hook
  const detectionAddress = (() => {
    let addr: AddressFields | undefined;
    if (serviceAddressMode === "different" && newServiceAddress.street) {
      addr = newServiceAddress;
    } else if (serviceAddressMode === "existing" && selectedCustomer?.service_addresses?.length) {
      addr = selectedCustomer.service_addresses[selectedAddressIdx];
    } else if (serviceAddressMode === "same" && billingAddress.street) {
      addr = billingAddress;
    }
    // Require at least street + city + state for confident matching
    if (!addr || !addr.street || !addr.city || !addr.state) return undefined;
    return { street: addr.street, city: addr.city, state: addr.state, zip: addr.zip || "" };
  })();

  // Active onsite detection hook
  const {
    hasActiveOnsite: detectedOnsite,
    dumpsters: detectedDumpsters,
    isLoading: detectionLoading,
  } = useActiveOnsiteDumpsters({
    customerId: selectedCustomer?.id,
    siteAddress: detectionAddress,
    enabled: open,
  });

  // Auto-default job type based on detection (only when not manually overridden)
  useEffect(() => {
    if (detectionLoading) return;
    if (jobTypeManuallySet) return;

    if (detectedOnsite && detectedDumpsters.length > 0) {
      setTaskType("exchange");
      setExchangeAutoDetected(true);
      // Load detected dumpsters into active rentals for the exchange picker
      // We still need the full rental chain data for exchange submission,
      // so also fetch rental chains when entering step 3
    } else if (!detectedOnsite && !jobTypeManuallySet) {
      setTaskType("drop_off");
      setExchangeAutoDetected(false);
    }
  }, [detectedOnsite, detectedDumpsters, detectionLoading, jobTypeManuallySet]);

  // Lock body scroll
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  // Click outside search dropdown
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setFirstName("");
      setLastName("");
      setCompanyName("");
      setClientType("");
      setEmail("");
      setPhone("");
      setAdditionalContacts([]);
      setSelectedCustomer(null);
      setSearchResults([]);
      setShowDropdown(false);
      setServiceAddressMode("same");
      setSelectedAddressIdx(0);
      setNewServiceAddress({ street: "", city: "", state: "", zip: "" });
      setBillingAddress({ street: "", street2: "", city: "", state: "", zip: "", county: "" });
      setTaskType("drop_off");
      setActiveRentals([]);
      setSelectedRentalForExchange("");
      setExchangeReplacementSize("");
      setDumpsterSize(initialSchedule?.dumpsterSize || "");
      setDeliveryDate(initialSchedule?.deliveryDate || prefillDate || getNextBusinessDay());
      setRentalLength(14);
      setPriority("Normal");
      setAutoSchedulePickup(initialSchedule?.pickupTBD ? false : true);
      setDriverNotes("");
      setPriceQuote(null);
      setAvailability(null);
      setSubmitting(false);
      setRentalsLoading(false);
      setPreferredPaymentMethod(initialSchedule?.paymentMethod || "invoice");
      setJobTypeManuallySet(false);
      setExchangeAutoDetected(false);
      // Hydrate from initialSchedule if provided
      const locked = !!(initialSchedule?.lockSiteAddress && initialSchedule?.siteAddress);
      setSiteAddressLocked(locked);
      if (initialSchedule?.siteAddress) {
        setServiceAddressMode("different");
        setNewServiceAddress({
          street: initialSchedule.siteAddress.street,
          city: initialSchedule.siteAddress.city,
          state: initialSchedule.siteAddress.state,
          zip: initialSchedule.siteAddress.zip,
          lat: initialSchedule.siteAddress.lat,
          lng: initialSchedule.siteAddress.lng,
        });
      }
      // Strategy B Commit 2 — seed Step 1 customer fields from
      // pendingQuoteSnapshot.customerFields when user typed Name/Email/
      // Phone in the QQD Send Quote panel before Book Now. Existing-
      // customer path wins: when prefillCustomerId is set, the effect
      // at L407-414 loads server data via selectCustomer() and we
      // skip the snapshot seed entirely. Snapshot data is NEVER set
      // as selectedCustomer — it represents typed-but-not-selected
      // input, and the inline customer-search dropdown remains active
      // on subsequent typing. Placement (end of the reset block,
      // after clearing setters) means React batches the seed values
      // last — the seeded values win over the preceding empty-string
      // resets. Step Back does not re-seed (step is not in this
      // effect's deps). "Clear" does not re-seed (Clear calls setters
      // directly; no dep of this effect changes).
      const snapshotFields = pendingQuoteSnapshot?.customerFields;
      if (!prefillCustomerId && snapshotFields) {
        if (snapshotFields.firstName) setFirstName(snapshotFields.firstName);
        if (snapshotFields.lastName) setLastName(snapshotFields.lastName);
        if (snapshotFields.email) setEmail(snapshotFields.email);
        if (snapshotFields.phone) setPhone(snapshotFields.phone);
      }
    }
    // pendingQuoteSnapshot and prefillCustomerId intentionally omitted
    // from deps: adding them would re-fire this effect on snapshot
    // changes or prefillCustomerId resolution, which would wipe user
    // edits on Step 1. Snapshot is read as initial state at open→true
    // (mount-equivalent). prefillCustomerId has its own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillDate, initialSchedule]);

  // Prefill customer
  useEffect(() => {
    if (open && prefillCustomerId) {
      api.get<CustomerSearchResult>(`/customers/${prefillCustomerId}`)
        .then((c) => selectCustomer(c))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillCustomerId]);

  // Fetch pricing options on step 3
  useEffect(() => {
    if (step === 3) {
      api.get<{ data: PricingOption[] }>("/pricing?limit=100")
        .then((res) => {
          const opts = res.data || [];
          setPricingOptions(opts);
          if (opts.length > 0 && !dumpsterSize) {
            setDumpsterSize(opts[0].asset_subtype);
            // Initialize rental length from tenant pricing rule
            if (opts[0].rental_period_days) setRentalLength(opts[0].rental_period_days);
          }
        })
        .catch(() => {});
      // Fetch active rentals for customer (needed for exchange submission path)
      if (selectedCustomer?.id) {
        setRentalsLoading(true);
        api.get<any[]>(`/rental-chains?customerId=${selectedCustomer.id}&status=active`)
          .then((chains) => {
            const active = (Array.isArray(chains) ? chains : []).filter(
              (c: any) => c.status === "active" && !c.actual_pickup_date,
            );
            setActiveRentals(active);
            // If exchange was auto-detected and exactly 1 rental, auto-select it
            if (!jobTypeManuallySet && detectedOnsite && active.length === 1) {
              setSelectedRentalForExchange(active[0].id);
            }
          })
          .catch(() => setActiveRentals([]))
          .finally(() => setRentalsLoading(false));
      } else {
        setActiveRentals([]);
        setRentalsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Sync rental length from pricing rule when effective size changes
  useEffect(() => {
    if (!pricingOptions.length) return;
    const effectiveSize = taskType === "exchange" ? (exchangeReplacementSize || dumpsterSize) : dumpsterSize;
    const rule = pricingOptions.find((p) => p.asset_subtype === effectiveSize);
    if (rule?.rental_period_days) setRentalLength(rule.rental_period_days);
  }, [dumpsterSize, exchangeReplacementSize, taskType, pricingOptions]);

  // Re-quote when options change
  const fetchQuote = useCallback(async () => {
    const svcAddr = resolvedServiceAddress();
    if (!dumpsterSize || !deliveryDate || !svcAddr.lat || !svcAddr.lng) return;
    setQuoteLoading(true);
    try {
      const isExchange = taskType === "exchange" && selectedRentalForExchange;
      const exchangeRental = isExchange ? activeRentals.find((r) => r.id === selectedRentalForExchange) : null;
      const calcSize = isExchange ? (exchangeReplacementSize || dumpsterSize) : dumpsterSize;
      const res = await api.post<{ breakdown: { basePrice: number; total: number; includedTons: number; overagePerTon: number; distanceMiles: number; distanceSurcharge: number } }>("/pricing/calculate", {
        serviceType: "dumpster_rental",
        assetSubtype: calcSize,
        jobType: isExchange ? "exchange" : "delivery",
        customerLat: svcAddr.lat,
        customerLng: svcAddr.lng,
        rentalDays: rentalLength,
        // Include customerId when a customer is selected so the backend
        // applies any matching client_pricing_overrides (base_price only
        // in the current Pass 1 scope). Falls back to global pricing
        // when no customer is selected or no override exists.
        ...(selectedCustomer?.id ? { customerId: selectedCustomer.id } : {}),
        ...(isExchange && exchangeRental ? {
          exchange_context: {
            pickup_asset_subtype: exchangeRental.dumpster_size,
            dropoff_asset_subtype: calcSize,
          },
        } : {}),
      });
      const quote: PriceQuote = {
        base_price: res.breakdown.basePrice,
        total: res.breakdown.total,
        weight_allowance: res.breakdown.includedTons,
        overage_rate: res.breakdown.overagePerTon,
        distanceMiles: res.breakdown.distanceMiles,
        distanceCharge: res.breakdown.distanceSurcharge,
      };
      setPriceQuote(quote);
    } catch {
      setPriceQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [dumpsterSize, rentalLength, deliveryDate, newServiceAddress.lat, newServiceAddress.lng, billingAddress.lat, billingAddress.lng, serviceAddressMode, selectedCustomer, selectedAddressIdx]);

  useEffect(() => {
    if (step === 3 && dumpsterSize) fetchQuote();
  }, [step, dumpsterSize, rentalLength, deliveryDate, taskType, selectedRentalForExchange, exchangeReplacementSize, fetchQuote]);

  // Fetch availability (exchange-aware: use replacement size when in exchange mode)
  const availabilitySize = taskType === "exchange" ? (exchangeReplacementSize || dumpsterSize) : dumpsterSize;
  useEffect(() => {
    if (step === 3 && availabilitySize && deliveryDate) {
      api.get<AvailabilityResponse>(`/assets/availability?subtype=${encodeURIComponent(availabilitySize)}&date=${deliveryDate}`)
        .then((r) => setAvailability(r.availableOnDate))
        .catch(() => setAvailability(null));
    }
  }, [step, availabilitySize, deliveryDate]);

  /* ---- Customer search ---- */
  const searchCustomers = useCallback((fn: string, ln: string) => {
    const q = `${fn} ${ln}`.trim();
    if (q.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get<CustomerSearchResult[]>(`/customers/search?q=${encodeURIComponent(q)}&limit=5`);
        setSearchResults(Array.isArray(res) ? res : []);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      }
    }, 300);
  }, []);

  const selectCustomer = (c: CustomerSearchResult) => {
    setSelectedCustomer(c);
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setCompanyName(c.company_name || "");
    setClientType((c.type as "residential" | "commercial") || "");
    setEmail(c.email || "");
    setPhone(c.phone || "");
    setAdditionalContacts(c.customer_preferences?.additionalContacts || []);
    const b = c.billing_address;
    setBillingAddress({
      street: b?.street ?? "",
      street2: b?.street2 ?? "",
      city: b?.city ?? "",
      state: b?.state ?? "",
      zip: b?.zip ?? "",
      county: b?.county ?? "",
    });
    // Customer change = new decision context — reset manual override
    setJobTypeManuallySet(false);
    setExchangeAutoDetected(false);
    // When a quote-sourced address is locked, do NOT auto-switch to the customer's
    // saved addresses. Keep the quote address active; customer addresses will be
    // shown as selectable alternatives in the UI.
    if (!siteAddressLocked && c.service_addresses && c.service_addresses.length > 0) {
      setServiceAddressMode("existing");
      setSelectedAddressIdx(0);
    }
    setShowDropdown(false);
  };

  /* ---- Validation ---- */
  const step1Valid = firstName.trim() && lastName.trim() && clientType && email.trim() && phone.trim();
  const step2Valid = !!(
    billingAddress.street.trim() &&
    billingAddress.city.trim() &&
    billingAddress.state.trim() &&
    billingAddress.zip.trim()
  );

  /* ---- Resolve service address for step 3 display ---- */
  const resolvedServiceAddress = (): AddressFields => {
    if (selectedCustomer && serviceAddressMode === "existing" && selectedCustomer.service_addresses?.length) {
      return selectedCustomer.service_addresses[selectedAddressIdx];
    }
    if (serviceAddressMode === "different") return newServiceAddress;
    return billingAddress;
  };

  const formatAddr = (a: AddressFields) =>
    [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");

  /* ---- Submit ---- */
  const exchangeReady = taskType !== "exchange" || !!selectedRentalForExchange;

  const handleSubmit = async (collectPayment: boolean) => {
    // Belt-and-suspenders: block exchange submit without a selected rental
    if (taskType === "exchange" && !selectedRentalForExchange) {
      toast("error", "Select a dumpster to exchange");
      return;
    }
    setSubmitting(true);
    const svcAddr = resolvedServiceAddress();
    const pickupDateStr = addDays(deliveryDate, rentalLength);
    const resolvedMethod = collectPayment ? "card" : preferredPaymentMethod === "card" ? "card" : preferredPaymentMethod;
    try {
      // Exchange path — schedule exchange via JobsService
      if (taskType === "exchange" && selectedRentalForExchange) {
        const rental = activeRentals.find((r) => r.id === selectedRentalForExchange);
        // Find the best parent job: prefer completed delivery, then any job in the chain
        const deliveryLink = rental?.links?.find((l) => l.task_type === "drop_off" && l.status === "completed");
        const anyLink = rental?.links?.find((l) => !!l.job_id);
        const parentJobId = deliveryLink?.job_id || anyLink?.job_id;

        let createdJobId: string | undefined;
        if (parentJobId) {
          // Chain-based exchange: use existing schedule-next flow
          const res = await api.post<{ jobs: Array<{ id: string }> }>(`/jobs/${parentJobId}/schedule-next`, {
            type: "exchange",
            scheduledDate: deliveryDate,
            timeWindow: "any",
            newAssetSubtype: exchangeReplacementSize || dumpsterSize,
            exchangeFee: priceQuote?.total || priceQuote?.base_price || 0,
          });
          createdJobId = res.jobs?.[0]?.id;
        } else {
          // Standalone/legacy rental: create exchange directly from rental chain
          const res = await api.post<{ jobs: Array<{ id: string }> }>("/jobs/exchange-from-rental", {
            rentalChainId: rental?.id,
            scheduledDate: deliveryDate,
            timeWindow: "any",
            newAssetSubtype: exchangeReplacementSize || dumpsterSize,
            exchangeFee: priceQuote?.total || priceQuote?.base_price || 0,
          });
          createdJobId = res.jobs?.[0]?.id;
        }
        toast("success", "Exchange scheduled successfully");
        onComplete?.(createdJobId);
        onClose();
        return;
      }

      // Phase 4B — backend is server-authoritative for credit
      // enforcement and the override audit trail. We no longer build
      // the override note client-side; we just forward the operator's
      // typed reason in `creditOverride.reason`. The backend validates
      // role + tenant policy from JWT (NOT from the payload), builds
      // the audit note from the JWT user + ISO timestamp, and writes
      // it to the new job's placement_notes via
      // BookingCompletionService.
      const creditOverridePayload = creditEnforcement.overrideActive
        ? { reason: creditEnforcement.overrideReason }
        : undefined;

      // Standard delivery path — existing BookingCompletionService flow
      const billingAddressPayload = {
        street: billingAddress.street,
        street2: billingAddress.street2 || undefined,
        city: billingAddress.city,
        state: billingAddress.state,
        zip: billingAddress.zip,
        county: billingAddress.county || undefined,
      };
      const bookingResult = await api.post<{ deliveryJob: { id: string }; pickupJob: { id: string }; invoice: { id: string } }>("/bookings/complete", {
        customerId: selectedCustomer?.id || undefined,
        billingAddress: billingAddressPayload,
        customer: selectedCustomer ? undefined : {
          firstName,
          lastName,
          companyName: companyName || undefined,
          type: clientType || "residential",
          email,
          phone,
          billingAddress: billingAddressPayload,
          additionalContacts: additionalContacts.length > 0 ? additionalContacts : undefined,
          county: billingAddress.county || undefined,
        },
        serviceType: "dumpster_rental",
        assetSubtype: dumpsterSize,
        serviceAddress: { street: svcAddr.street, city: svcAddr.city, state: svcAddr.state, zip: svcAddr.zip, lat: svcAddr.lat, lng: svcAddr.lng },
        deliveryDate,
        pickupDate: autoSchedulePickup ? pickupDateStr : pickupDateStr,
        rentalDays: rentalLength,
        placementNotes: driverNotes || undefined,
        basePrice: priceQuote?.base_price || 0,
        deliveryFee: priceQuote?.distanceCharge || 0,
        taxAmount: 0,
        totalPrice: priceQuote?.total || priceQuote?.base_price || 0,
        paymentMethod: resolvedMethod,
        sendInvoiceNow: resolvedMethod === "invoice" && sendInvoiceNow ? true : undefined,
        creditOverride: creditOverridePayload,
      });
      toast("success", "Booking created successfully");
      onComplete?.(bookingResult.deliveryJob?.id);
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className={`fixed inset-0 z-50 flex ${side === 'left' ? 'justify-start' : 'justify-end'}`}>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      {/* Panel */}
      <div
        className={`relative w-full max-w-2xl shadow-2xl ${side === 'left' ? 'animate-slide-in-left rounded-r-[20px]' : 'animate-slide-in-right rounded-l-[20px]'} flex flex-col`}
        style={{ backgroundColor: "var(--t-bg-secondary)", ...(side === 'left' ? { borderRight: "1px solid var(--t-border)" } : { borderLeft: "1px solid var(--t-border)" }) }}
      >
        {/* Header */}
        <div
          className="flex h-14 items-center justify-between px-6 shrink-0"
          style={{ borderBottom: "1px solid var(--t-border)" }}
        >
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--t-text-primary)" }}>
            New Booking
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors duration-150"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress */}
        <ProgressDots step={step} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 pb-3">
          {/* ============================== STEP 1 ============================== */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Customer name with search */}
              <div ref={searchRef} className="relative">
                <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Customer Name</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => {
                      setFirstName(e.target.value);
                      if (!selectedCustomer) searchCustomers(e.target.value, lastName);
                    }}
                    className={INPUT_CLASS}
                    style={{ color: "var(--t-text-primary)" }}
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      if (!selectedCustomer) searchCustomers(firstName, e.target.value);
                    }}
                    className={INPUT_CLASS}
                    style={{ color: "var(--t-text-primary)" }}
                  />
                </div>

                {/* Search dropdown */}
                {showDropdown && searchResults.length > 0 && (
                  <div
                    className="absolute left-0 right-0 z-[9999] mt-1 overflow-hidden rounded-[14px] border shadow-xl"
                    style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)" }}
                  >
                    {searchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomer(c)}
                        className="flex w-full flex-col px-4 py-2.5 text-left transition-colors"
                        style={{ borderBottom: "1px solid var(--t-border)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      >
                        <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                          {c.first_name} {c.last_name}
                        </span>
                        {c.company_name && (
                          <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>{c.company_name}</span>
                        )}
                        {c.billing_address && (
                          <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>
                            {formatAddr(c.billing_address)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Existing / New badge */}
              {selectedCustomer ? (
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium"
                    style={{ backgroundColor: "var(--t-accent-soft)", color: "var(--t-accent)" }}
                  >
                    <Check className="h-3 w-3" /> Existing customer &mdash; {selectedCustomer.account_id}
                  </span>
                  <button
                    type="button"
                    className="text-xs underline"
                    style={{ color: "var(--t-text-muted)" }}
                    onClick={() => {
                      setSelectedCustomer(null);
                      setFirstName("");
                      setLastName("");
                      setCompanyName("");
                      setClientType("");
                      setEmail("");
                      setPhone("");
                      setAdditionalContacts([]);
                      setServiceAddressMode("same");
                      setJobTypeManuallySet(false);
                      setExchangeAutoDetected(false);
                    }}
                  >
                    {getFeatureLabel("booking_wizard_step1_change_customer")}
                  </button>
                </div>
              ) : (firstName.trim() || lastName.trim()) ? (
                <span
                  className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
                  style={{ backgroundColor: "var(--t-accent-soft)", color: "var(--t-accent)", opacity: 0.7 }}
                >
                  New customer will be created
                </span>
              ) : null}

              {/* Company */}
              <div>
                <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Company Name</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className={INPUT_CLASS}
                  style={{ color: "var(--t-text-primary)" }}
                />
              </div>

              {/* Client type */}
              <div>
                <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Client Type</label>
                <div className="flex gap-3">
                  <TileButton
                    selected={clientType === "residential"}
                    onClick={() => setClientType("residential")}
                    title="Residential"
                    subtitle="Homeowner / tenant"
                  />
                  <TileButton
                    selected={clientType === "commercial"}
                    onClick={() => setClientType("commercial")}
                    title="Commercial"
                    subtitle="Contractor / business"
                  />
                </div>
              </div>

              {/* Contact */}
              <SectionDivider label="Contact" />
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Email</label>
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={INPUT_CLASS}
                    style={{ color: "var(--t-text-primary)" }}
                  />
                </div>
                <div className="flex-1">
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Phone</label>
                  <input
                    type="tel"
                    placeholder="(555) 555-5555"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={INPUT_CLASS}
                    style={{ color: "var(--t-text-primary)" }}
                  />
                </div>
              </div>

              {/* Additional contacts */}
              {additionalContacts.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Contact info"
                    value={c.value}
                    onChange={(e) => {
                      const copy = [...additionalContacts];
                      copy[i] = { ...copy[i], value: e.target.value };
                      setAdditionalContacts(copy);
                    }}
                    className={`${INPUT_CLASS} flex-1`}
                    style={{ color: "var(--t-text-primary)" }}
                  />
                  <select
                    value={c.role}
                    onChange={(e) => {
                      const copy = [...additionalContacts];
                      copy[i] = { ...copy[i], role: e.target.value };
                      setAdditionalContacts(copy);
                    }}
                    className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-3 text-sm outline-none"
                    style={{ color: "var(--t-text-primary)" }}
                  >
                    {CONTACT_ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setAdditionalContacts(additionalContacts.filter((_, j) => j !== i))}
                    className="rounded-full p-2 transition-colors"
                    style={{ color: "var(--t-error)" }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setAdditionalContacts([...additionalContacts, { value: "", role: "General" }])}
                className="flex items-center gap-1.5 text-sm font-medium"
                style={{ color: "var(--t-accent)" }}
              >
                <Plus className="h-4 w-4" /> Add contact
              </button>

              {/* Service address */}
              <SectionDivider label="Service Address" />

              {/* Locked quote address — show it as active, customer addresses as alternatives */}
              {siteAddressLocked && serviceAddressMode === "different" ? (
                <div className="space-y-2">
                  <div
                    className="w-full rounded-[20px] border px-4 py-3"
                    style={{ backgroundColor: "var(--t-accent-soft)", borderColor: "var(--t-accent)" }}
                  >
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0" style={{ color: "var(--t-accent)" }} />
                      <div>
                        <span className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
                          {formatAddr(newServiceAddress)}
                        </span>
                        <span className="ml-2 text-[11px] font-semibold uppercase" style={{ color: "var(--t-accent)" }}>
                          From quote
                        </span>
                      </div>
                    </div>
                  </div>
                  {selectedCustomer?.service_addresses && selectedCustomer.service_addresses.length > 0 && (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-wide pt-1" style={{ color: "var(--t-text-muted)" }}>
                        Or use a saved address
                      </p>
                      {selectedCustomer.service_addresses.map((addr, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => { setSiteAddressLocked(false); setServiceAddressMode("existing"); setSelectedAddressIdx(i); }}
                          className="w-full rounded-[20px] border px-4 py-3 text-left transition-colors"
                          style={{ backgroundColor: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--t-accent)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--t-border)"; }}
                        >
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 shrink-0" style={{ color: "var(--t-text-muted)" }} />
                            <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>{formatAddr(addr)}</span>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ) : selectedCustomer && selectedCustomer.service_addresses && selectedCustomer.service_addresses.length > 0 ? (
                <div className="space-y-2">
                  {selectedCustomer.service_addresses.map((addr, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setServiceAddressMode("existing"); setSelectedAddressIdx(i); }}
                      className="w-full rounded-[20px] border px-4 py-3 text-left transition-colors"
                      style={{
                        backgroundColor: serviceAddressMode === "existing" && selectedAddressIdx === i ? "var(--t-accent-soft)" : "var(--t-bg-card)",
                        borderColor: serviceAddressMode === "existing" && selectedAddressIdx === i ? "var(--t-accent)" : "var(--t-border)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 shrink-0" style={{ color: "var(--t-text-muted)" }} />
                        <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>
                          {formatAddr(addr)}
                        </span>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setServiceAddressMode("different")}
                    className="flex items-center gap-1.5 text-sm font-medium"
                    style={{ color: "var(--t-accent)" }}
                  >
                    <Plus className="h-4 w-4" /> Add new service address
                  </button>
                  {serviceAddressMode === "different" && (
                    <div className="mt-3">
                      <AddressAutocomplete
                        label="New Service Address"
                        value={newServiceAddress}
                        onChange={(a) => { setNewServiceAddress({ street: a.street, city: a.city, state: a.state, zip: a.zip, lat: a.lat, lng: a.lng }); if (siteAddressLocked) setSiteAddressLocked(false); }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="svc_addr"
                      checked={serviceAddressMode === "same"}
                      onChange={() => setServiceAddressMode("same")}
                      className="accent-[var(--t-accent)]"
                    />
                    <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>Same as billing address</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="svc_addr"
                      checked={serviceAddressMode === "different"}
                      onChange={() => setServiceAddressMode("different")}
                      className="accent-[var(--t-accent)]"
                    />
                    <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>Different service address</span>
                  </label>
                  {serviceAddressMode === "different" && (
                    <div className="mt-2">
                      <AddressAutocomplete
                        label="Service Address"
                        value={newServiceAddress}
                        onChange={(a) => { setNewServiceAddress({ street: a.street, city: a.city, state: a.state, zip: a.zip, lat: a.lat, lng: a.lng }); if (siteAddressLocked) setSiteAddressLocked(false); }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Continue */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={!step1Valid}
                  onClick={() => setStep(2)}
                  className="w-full rounded-full py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: "var(--t-accent)", color: "#fff" }}
                >
                  {getFeatureLabel("booking_wizard_step1_continue_to_billing")}
                </button>
              </div>
            </div>
          )}

          {/* ============================== STEP 2 ============================== */}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold" style={{ color: "var(--t-text-primary)" }}>
                Billing Address
              </h3>

              {selectedCustomer && !selectedCustomer.billing_address && (
                <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
                  No billing address on file for this customer — please enter one. It will be saved to the customer for next time.
                </p>
              )}

              {/* Street */}
              <AddressAutocomplete
                label="Street"
                value={{ street: billingAddress.street, city: billingAddress.city, state: billingAddress.state, zip: billingAddress.zip }}
                onChange={(a) =>
                  setBillingAddress((prev) => ({
                    ...prev,
                    street: a.street,
                    city: a.city,
                    state: a.state,
                    zip: a.zip,
                  }))
                }
              />

              {/* Street 2 */}
              <div>
                <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Street 2</label>
                <input
                  type="text"
                  placeholder="Apt, suite, unit (optional)"
                  value={billingAddress.street2 || ""}
                  onChange={(e) => setBillingAddress((prev) => ({ ...prev, street2: e.target.value }))}
                  className={INPUT_CLASS}
                  style={{ color: "var(--t-text-primary)" }}
                />
              </div>

              {/* City / State / Zip */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>City</label>
                  <input
                    type="text"
                    value={billingAddress.city}
                    onChange={(e) => setBillingAddress((prev) => ({ ...prev, city: e.target.value }))}
                    className={INPUT_CLASS}
                    style={{ color: "var(--t-text-primary)" }}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>State</label>
                  <select
                    value={billingAddress.state}
                    onChange={(e) => setBillingAddress((prev) => ({ ...prev, state: e.target.value }))}
                    className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                    style={{ color: "var(--t-text-primary)" }}
                  >
                    <option value="">--</option>
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Zip</label>
                  <input
                    type="text"
                    value={billingAddress.zip}
                    onChange={(e) => setBillingAddress((prev) => ({ ...prev, zip: e.target.value }))}
                    className={INPUT_CLASS}
                    style={{ color: "var(--t-text-primary)" }}
                  />
                </div>
              </div>

              {/* County */}
              <div className="w-1/3">
                <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>County</label>
                <input
                  type="text"
                  value={billingAddress.county || ""}
                  onChange={(e) => setBillingAddress((prev) => ({ ...prev, county: e.target.value }))}
                  className={INPUT_CLASS}
                  style={{ color: "var(--t-text-primary)" }}
                />
              </div>

              {/* Navigation */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 rounded-full py-3 text-sm font-semibold border"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={!step2Valid}
                  className="flex-1 rounded-full py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: "var(--t-accent)", color: "#fff" }}
                >
                  {getFeatureLabel("booking_wizard_step2_continue_to_schedule")}
                </button>
              </div>
            </div>
          )}

          {/* ============================== STEP 3 ============================== */}
          {step === 3 && (
            <div className="space-y-3">
              {/* Service address header */}
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--t-text-muted)" }}>
                <MapPin className="h-3.5 w-3.5" />
                <span>{formatAddr(resolvedServiceAddress())}</span>
              </div>

              <h3 className="text-base font-semibold" style={{ color: "var(--t-text-primary)" }}>
                {taskType === "exchange" ? "Schedule Exchange" : "Schedule Delivery"}
              </h3>

              {/* Task type */}
              <div>
                <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Job Type</label>
                <div className="flex gap-3">
                  <TileButton
                    selected={taskType === "drop_off"}
                    onClick={() => { setTaskType("drop_off"); setSelectedRentalForExchange(""); setJobTypeManuallySet(true); setExchangeAutoDetected(false); }}
                    title="New Delivery"
                    subtitle="Deliver dumpster"
                  />
                  {(activeRentals.length > 0 || detectedOnsite) && (
                    <TileButton
                      selected={taskType === "exchange"}
                      onClick={() => {
                        setTaskType("exchange");
                        setJobTypeManuallySet(true);
                        if (activeRentals.length === 1) setSelectedRentalForExchange(activeRentals[0].id);
                      }}
                      title="Exchange"
                      subtitle="Swap existing dumpster"
                    />
                  )}
                </div>
                {/* Auto-detection helper message */}
                {exchangeAutoDetected && taskType === "exchange" && (
                  <p
                    className="mt-1.5 text-xs"
                    style={{ color: "var(--t-accent)" }}
                  >
                    {getFeatureTooltip("exchange_detection")}
                  </p>
                )}
              </div>

              {/* Exchange: active rentals on site */}
              {taskType === "exchange" && rentalsLoading && (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--t-text-muted)" }} />
                  <span className="text-sm" style={{ color: "var(--t-text-muted)" }}>Loading active rentals...</span>
                </div>
              )}
              {taskType === "exchange" && !rentalsLoading && activeRentals.length > 0 && (
                <div className="space-y-2">
                  <SectionDivider label="Dumpster Being Removed" />
                  {activeRentals.length === 1 ? (
                    <div
                      className="rounded-[20px] border px-4 py-2.5"
                      style={{ backgroundColor: "var(--t-accent-soft)", borderColor: "var(--t-accent)" }}
                    >
                      <span className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
                        {activeRentals[0].dumpster_size?.replace("yd", " Yard") || "Unknown"} Dumpster
                      </span>
                      {activeRentals[0].asset?.identifier && (
                        <span className="ml-2 text-xs" style={{ color: "var(--t-text-muted)" }}>
                          #{activeRentals[0].asset.identifier}
                        </span>
                      )}
                      <span className="block text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                        Delivered {activeRentals[0].drop_off_date}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activeRentals.map((rental) => (
                        <button
                          key={rental.id}
                          type="button"
                          onClick={() => setSelectedRentalForExchange(rental.id)}
                          className="w-full rounded-[20px] border px-4 py-2.5 text-left transition-colors"
                          style={{
                            backgroundColor: selectedRentalForExchange === rental.id ? "var(--t-accent-soft)" : "var(--t-bg-card)",
                            borderColor: selectedRentalForExchange === rental.id ? "var(--t-accent)" : "var(--t-border)",
                          }}
                        >
                          <span className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
                            {rental.dumpster_size?.replace("yd", " Yard") || "Unknown"} Dumpster
                          </span>
                          {rental.asset?.identifier && (
                            <span className="ml-2 text-xs" style={{ color: "var(--t-text-muted)" }}>
                              #{rental.asset.identifier}
                            </span>
                          )}
                          <span className="block text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                            Delivered {rental.drop_off_date}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Replacement size */}
                  {selectedRentalForExchange && (
                    <>
                      <SectionDivider label="Replacement Dumpster" />
                      <div>
                        <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Replacement Size</label>
                        <select
                          value={exchangeReplacementSize || dumpsterSize}
                          onChange={(e) => setExchangeReplacementSize(e.target.value)}
                          className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                          style={{ color: "var(--t-text-primary)" }}
                        >
                          {pricingOptions.map((p) => (
                            <option key={p.id} value={p.asset_subtype}>
                              {p.asset_subtype} — {formatCurrency(p.base_price)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}

              <SectionDivider label={taskType === "exchange" ? "Exchange Details" : "Booking Details"} />

              {/* Dumpster size — hidden when exchange (replacement size chosen above) */}
              {taskType !== "exchange" && (
                <div>
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Dumpster Size</label>
                  <select
                    value={dumpsterSize}
                    onChange={(e) => setDumpsterSize(e.target.value)}
                    className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                    style={{ color: "var(--t-text-primary)" }}
                  >
                    {pricingOptions.map((p) => (
                      <option key={p.id} value={p.asset_subtype}>
                        {p.asset_subtype} — {formatCurrency(p.base_price)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Date + Rental + Priority */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Delivery Date</label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className={INPUT_CLASS}
                    style={{ color: "var(--t-text-primary)" }}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Rental Length</label>
                  <select
                    value={rentalLength}
                    onChange={(e) => setRentalLength(Number(e.target.value))}
                    className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                    style={{ color: "var(--t-text-primary)" }}
                  >
                    {(RENTAL_LENGTHS.includes(rentalLength) ? RENTAL_LENGTHS : [rentalLength, ...RENTAL_LENGTHS].sort((a, b) => a - b)).map((d) => (
                      <option key={d} value={d}>{d} days</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                    style={{ color: "var(--t-text-primary)" }}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Inventory */}
              {availability !== null && (
                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--t-text-muted)" }}>
                  <Box className="h-4 w-4" style={{ color: availability > 0 ? "var(--t-accent)" : "var(--t-error)" }} />
                  <span>
                    {taskType === "exchange"
                      ? `${getFeatureTooltip("exchange_availability")}: ${availability} ${availabilitySize} on ${deliveryDate}`
                      : `${availability} ${availabilitySize} available on ${deliveryDate}`}
                  </span>
                </div>
              )}

              {/* Auto-schedule pickup */}
              <div className="flex items-center justify-between rounded-[20px] border px-4 py-2.5" style={{ borderColor: "var(--t-border)", backgroundColor: "var(--t-bg-card)" }}>
                <div>
                  <span className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>Auto-schedule pickup</span>
                  {autoSchedulePickup && deliveryDate && (
                    <span className="block text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                      Pickup: {addDays(deliveryDate, rentalLength)}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => setAutoSchedulePickup(!autoSchedulePickup)}>
                  {autoSchedulePickup ? (
                    <ToggleRight className="h-7 w-7" style={{ color: "var(--t-accent)" }} />
                  ) : (
                    <ToggleLeft className="h-7 w-7" style={{ color: "var(--t-text-muted)" }} />
                  )}
                </button>
              </div>

              {/* Driver notes */}
              <div>
                <label className={LABEL_CLASS} style={{ color: "var(--t-text-muted)" }}>Driver Notes</label>
                <textarea
                  placeholder="Optional notes for the driver..."
                  value={driverNotes}
                  onChange={(e) => setDriverNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)] resize-none"
                  style={{ color: "var(--t-text-primary)" }}
                />
              </div>

              {/* Price quote */}
              <div
                className="rounded-[20px] border p-3 space-y-1.5"
                style={{ borderColor: "var(--t-border)", backgroundColor: "var(--t-bg-card)" }}
              >
                <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-text-muted)" }}>
                  Price Quote
                </h4>
                {quoteLoading ? (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--t-text-muted)" }} />
                  </div>
                ) : priceQuote ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "var(--t-text-muted)" }}>Base price</span>
                      <span style={{ color: "var(--t-text-primary)" }}>{formatCurrency(priceQuote.base_price)}</span>
                    </div>
                    {priceQuote.distanceCharge > 0 ? (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: "var(--t-text-muted)" }}>Distance charge ({priceQuote.distanceMiles} mi)</span>
                        <span style={{ color: "var(--t-warning)" }}>{formatCurrency(priceQuote.distanceCharge)}</span>
                      </div>
                    ) : priceQuote.distanceMiles > 0 ? (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: "var(--t-text-muted)" }}>Delivery distance</span>
                        <span style={{ color: "var(--t-accent)" }}>{priceQuote.distanceMiles} mi (Free — within 15 mi)</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "var(--t-text-muted)" }}>Weight allowance</span>
                      <span style={{ color: "var(--t-text-primary)" }}>{priceQuote.weight_allowance} tons</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "var(--t-text-muted)" }}>Overage rate</span>
                      <span style={{ color: "var(--t-text-primary)" }}>{formatCurrency(priceQuote.overage_rate)}/ton</span>
                    </div>
                    <div className="h-px my-1" style={{ backgroundColor: "var(--t-border)" }} />
                    <div className="flex justify-between text-sm font-bold">
                      <span style={{ color: "var(--t-text-primary)" }}>Total</span>
                      <span style={{ color: "var(--t-accent)" }}>{formatCurrency(priceQuote.total)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>Select options to see pricing</p>
                )}
              </div>

              {/* Send invoice option */}
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sendInvoiceNow}
                  onChange={(e) => setSendInvoiceNow(e.target.checked)}
                  className="rounded"
                  style={{ accentColor: "var(--t-accent)" }}
                />
                <span className="text-sm" style={{ color: "var(--t-text-secondary)" }}>
                  Send invoice to customer now
                </span>
              </label>

              {/* Footer buttons */}
              {/* Phase 4 — credit-control booking enforcement banner.
                  Renders nothing in normal/loading/unknown states.
                  Yellow warning in warn state, red block in block state.
                  When the operator applies an override the banner
                  switches to a green confirmation card and the submit
                  buttons re-enable below. */}
              <CreditEnforcementBanner enforcement={creditEnforcement} />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-full px-4 py-3 text-sm font-semibold border"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={submitting || !exchangeReady || creditEnforcement.shouldBlockSubmit}
                  onClick={() => handleSubmit(false)}
                  className="flex-1 rounded-full py-3 text-sm font-semibold border transition-opacity disabled:opacity-50"
                  style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}
                >
                  {submitting ? "Creating..." : "Create invoice"}
                </button>
                <button
                  type="button"
                  disabled={submitting || !exchangeReady || creditEnforcement.shouldBlockSubmit}
                  onClick={() => handleSubmit(true)}
                  className="flex-1 rounded-full py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
                  style={{ backgroundColor: "var(--t-accent)", color: "#fff" }}
                >
                  {submitting ? "Creating..." : "Create + collect payment"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-export for convenience — not used as a standalone icon but referenced in step 3
function Box(props: React.SVGProps<SVGSVGElement> & { className?: string; style?: React.CSSProperties }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
