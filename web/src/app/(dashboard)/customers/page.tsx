"use client";

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/components/booking-provider";
import {
  Plus, Search, Users, MoreHorizontal, Trash2, Phone as PhoneIcon,
  Mail, Briefcase, FileText, ArrowUpDown, Pencil,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import Dropdown from "@/components/dropdown";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

/* ---- Types ---- */

interface Customer {
  id: string;
  type: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  total_jobs: number;
  lifetime_revenue: number;
  is_active: boolean;
}

interface CustomersResponse {
  data: Customer[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/* ---- Helpers ---- */

import { formatPhone, formatCurrency } from "@/lib/utils";

const fmtPhone = formatPhone;
const fmtMoney = (n: number) => formatCurrency(n);

/* ---- Filters ---- */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "residential", label: "Residential" },
  { key: "commercial", label: "Commercial" },
] as const;

type SortKey = "name" | "revenue" | "jobs" | "type";
type SortDir = "asc" | "desc";

/* ── UI Labels ── */
const CUSTOMER_LABELS = {
  customerCreatedSuccess: "Customer created successfully",
  continueToBooking: "Continue to Booking",
  viewCustomer: "View Customer",
  returnToCustomers: "Return to Customers",
  saveCustomerOnly: "Save Customer Only",
  saveAndSchedule: "Save & Schedule Job",
  saveCustomer: "Save Customer",
  saveAndContinue: "Save & Continue to Scheduling",
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
  continueCreatingCustomer: "Continue Creating New Customer",
  viewExistingCustomer: "View Existing Customer",
  cancelCreateCustomer: "Cancel",
  checkingDuplicate: "Checking for existing customers...",
  bookingCreatedSuccess: "Customer created and job scheduled",
  paymentSucceeded: "Payment processed successfully",
  paymentFailed: "Payment could not be processed",
  bookingUnpaid: "Job scheduled — invoice unpaid",
  continueAsNewCustomer: "Continue as new customer",
  existingCustomerSelected: "Existing customer selected",
};

/* ---- Page ---- */

export default function CustomersPage() {
  const router = useRouter();
  const { openWizard } = useBooking();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Auto-open SlideOver when navigated with ?new=true
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "true") {
      setPanelOpen(true);
      window.history.replaceState({}, "", "/customers");
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (search) params.set("search", search);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await api.get<CustomersResponse>(`/customers?${params}`);
      setCustomers(res.data);
      setTotal(res.meta.total);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [page, search, typeFilter]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => { setPage(1); }, [search, typeFilter]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try { await api.delete(`/customers/${id}`); toast("success", "Deleted"); fetchCustomers(); }
    catch { toast("error", "Failed to delete"); }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Client-side sort (on current page)
  const sorted = [...customers].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name": return dir * (`${a.first_name} ${a.last_name}`).localeCompare(`${b.first_name} ${b.last_name}`);
      case "revenue": return dir * (Number(a.lifetime_revenue) - Number(b.lifetime_revenue));
      case "jobs": return dir * (a.total_jobs - b.total_jobs);
      case "type": return dir * a.type.localeCompare(b.type);
      default: return 0;
    }
  });

  const thStyle: React.CSSProperties = {
    padding: "10px 20px",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "var(--t-text-muted)",
    cursor: "pointer",
    userSelect: "none",
    transition: "color 0.15s ease",
    whiteSpace: "nowrap",
  };

  const SortHeader = ({ label, sortKeyName, align }: { label: string; sortKeyName: SortKey; align?: string }) => (
    <th
      style={{ ...thStyle, textAlign: align === "right" ? "right" : "left" }}
      onClick={() => toggleSort(sortKeyName)}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {sortKey === sortKeyName && <ArrowUpDown style={{ width: 12, height: 12, color: "var(--t-accent)" }} />}
      </span>
    </th>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-1px",
            color: "var(--t-frame-text)",
            lineHeight: 1.2,
          }}>
            Customers
          </h1>
          <p style={{ marginTop: 2, fontSize: 14, color: "var(--t-frame-text-muted)" }}>{total} total</p>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            backgroundColor: "var(--t-accent)",
            color: "var(--t-accent-on-accent)",
            fontSize: 14,
            fontWeight: 600,
            padding: "10px 20px",
            borderRadius: 24,
            border: "none",
            cursor: "pointer",
            transition: "opacity 0.15s ease",
          }}
        >
          <Plus style={{ width: 16, height: 16 }} /> New Customer
        </button>
      </div>

      {/* Search + Filters */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }} className="sm:!flex-row sm:!items-center">
        <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
          <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--t-frame-text-muted)" }} />
          <input
            type="text"
            placeholder="Search name, phone, email, address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              backgroundColor: "var(--t-frame-hover)",
              border: "1px solid var(--t-frame-border)",
              borderRadius: 24,
              padding: "10px 40px 10px 38px",
              fontSize: 14,
              color: "var(--t-frame-text)",
              outline: "none",
              transition: "border-color 0.15s ease",
            }}
          />
          {search && (
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--t-frame-text-muted)" }}>
              {total} result{total !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              style={{
                padding: "8px 16px",
                borderRadius: 24,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                transition: "all 0.15s ease",
                backgroundColor: typeFilter === f.key ? "var(--t-accent-soft)" : "var(--t-frame-hover)",
                color: typeFilter === f.key ? "var(--t-accent)" : "var(--t-frame-text-muted)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{
        backgroundColor: "var(--t-bg-card)",
        border: "1px solid var(--t-border)",
        borderRadius: 14,
        overflow: "hidden",
      }}>
        <div className="table-scroll">
          <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
                <SortHeader label="Customer" sortKeyName="name" />
                <SortHeader label="Type" sortKeyName="type" />
                <th style={{ ...thStyle, cursor: "default" }}>Phone</th>
                <th style={{ ...thStyle, cursor: "default" }}>Email</th>
                <SortHeader label="Jobs" sortKeyName="jobs" align="right" />
                <SortHeader label="Revenue" sortKeyName="revenue" align="right" />
                <th style={{ ...thStyle, textAlign: "center", cursor: "default" }}>Status</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={8} style={{ padding: "8px 20px" }}><div className="skeleton" style={{ height: 48, borderRadius: 8 }} /></td></tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "64px 20px" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                      <Users style={{ width: 48, height: 48, color: "var(--t-text-muted)", opacity: 0.2, marginBottom: 12 }} />
                      <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)", marginBottom: 4 }}>
                        {search ? "No matches" : "No customers yet"}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--t-text-muted)", marginBottom: 16 }}>
                        {search ? `No results for "${search}"` : "Add your first customer"}
                      </p>
                      {!search && (
                        <button
                          onClick={() => setPanelOpen(true)}
                          style={{
                            backgroundColor: "var(--t-accent)",
                            color: "var(--t-accent-on-accent)",
                            fontSize: 13,
                            fontWeight: 600,
                            padding: "8px 20px",
                            borderRadius: 24,
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          New Customer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/customers/${c.id}`)}
                    style={{
                      borderBottom: "1px solid var(--t-border)",
                      cursor: "pointer",
                      transition: "background 0.15s ease",
                    }}
                    className="hover:bg-dark-card-hover"
                  >
                    {/* Avatar + Name */}
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{
                          display: "flex",
                          width: 32,
                          height: 32,
                          flexShrink: 0,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "50%",
                          fontSize: 12,
                          fontWeight: 700,
                          backgroundColor: "var(--t-accent-soft)",
                          color: "var(--t-accent)",
                        }}>
                          {c.first_name?.[0]}{c.last_name?.[0]}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontWeight: 500, color: "var(--t-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.first_name} {c.last_name}
                          </p>
                          {c.company_name && (
                            <p style={{ fontSize: 11, color: "var(--t-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.company_name}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* Type */}
                    <td style={{ padding: "14px 20px" }}>
                      <span style={{
                        fontSize: 12,
                        color: "var(--t-text-muted)",
                        textTransform: "capitalize",
                      }}>
                        {c.type}
                      </span>
                    </td>
                    {/* Phone */}
                    <td style={{ padding: "14px 20px" }} onClick={(e) => e.stopPropagation()}>
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            color: "var(--t-text-muted)",
                            textDecoration: "none",
                            transition: "color 0.15s ease",
                            fontSize: 14,
                          }}
                          className="hover:!text-[var(--t-accent)]"
                        >
                          <PhoneIcon style={{ width: 12, height: 12 }} />{fmtPhone(c.phone)}
                        </a>
                      ) : <span style={{ color: "var(--t-text-muted)" }}>&mdash;</span>}
                    </td>
                    {/* Email */}
                    <td style={{ padding: "14px 20px" }} onClick={(e) => e.stopPropagation()}>
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          style={{
                            color: "var(--t-text-muted)",
                            textDecoration: "none",
                            transition: "color 0.15s ease",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                            maxWidth: 180,
                            fontSize: 14,
                          }}
                          className="hover:!text-[var(--t-accent)]"
                        >
                          {c.email}
                        </a>
                      ) : <span style={{ color: "var(--t-text-muted)" }}>&mdash;</span>}
                    </td>
                    {/* Jobs */}
                    <td style={{ padding: "14px 20px", textAlign: "right", color: "var(--t-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                      {c.total_jobs}
                    </td>
                    {/* Revenue */}
                    <td style={{ padding: "14px 20px", textAlign: "right", fontWeight: 500, color: "var(--t-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtMoney(c.lifetime_revenue)}
                    </td>
                    {/* Status */}
                    <td style={{ padding: "14px 20px", textAlign: "center" }}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        color: c.is_active ? "var(--t-accent)" : "var(--t-text-muted)",
                      }}>
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          backgroundColor: c.is_active ? "var(--t-accent)" : "var(--t-text-muted)",
                          opacity: c.is_active ? 1 : 0.5,
                        }} />
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {/* Actions */}
                    <td style={{ padding: "6px 8px" }} onClick={(e) => e.stopPropagation()}>
                      <Dropdown align="right" trigger={
                        <button style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          backgroundColor: "transparent",
                          border: "none",
                          color: "var(--t-text-muted)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }} className="hover:bg-dark-card-hover hover:!text-[var(--t-text-primary)]">
                          <MoreHorizontal style={{ width: 16, height: 16 }} />
                        </button>
                      }>
                        <button onClick={() => router.push(`/customers/${c.id}`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-dark-card-hover" style={{ color: "var(--t-text-primary)" }}>
                          <Users style={{ width: 14, height: 14, color: "var(--t-text-muted)" }} /> View Details
                        </button>
                        <button onClick={() => router.push(`/customers/${c.id}`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-dark-card-hover" style={{ color: "var(--t-text-primary)" }}>
                          <Pencil style={{ width: 14, height: 14, color: "var(--t-text-muted)" }} /> Edit
                        </button>
                        <button onClick={() => openWizard({ customerId: c.id })} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-dark-card-hover" style={{ color: "var(--t-text-primary)" }}>
                          <Briefcase style={{ width: 14, height: 14, color: "var(--t-text-muted)" }} /> Create Job
                        </button>
                        <button onClick={() => router.push(`/invoices`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-dark-card-hover" style={{ color: "var(--t-text-primary)" }}>
                          <FileText style={{ width: 14, height: 14, color: "var(--t-text-muted)" }} /> Send Invoice
                        </button>
                        <div style={{ borderTop: "1px solid var(--t-border)" }} />
                        <button onClick={() => handleDelete(c.id, `${c.first_name} ${c.last_name}`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm" style={{ color: "var(--t-error)" }}>
                          <Trash2 style={{ width: 14, height: 14 }} /> Delete
                        </button>
                      </Dropdown>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 14,
          color: "var(--t-frame-text-muted)",
        }}>
          <span>Showing {(page - 1) * 25 + 1}&ndash;{Math.min(page * 25, total)} of {total}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                padding: "6px 16px",
                borderRadius: 24,
                backgroundColor: "transparent",
                border: "1px solid var(--t-frame-border)",
                color: "var(--t-frame-text)",
                fontSize: 13,
                fontWeight: 500,
                cursor: page === 1 ? "default" : "pointer",
                opacity: page === 1 ? 0.4 : 1,
                transition: "all 0.15s ease",
              }}
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * 25 >= total}
              style={{
                padding: "6px 16px",
                borderRadius: 24,
                backgroundColor: "transparent",
                border: "1px solid var(--t-frame-border)",
                color: "var(--t-frame-text)",
                fontSize: 13,
                fontWeight: 500,
                cursor: page * 25 >= total ? "default" : "pointer",
                opacity: page * 25 >= total ? 0.4 : 1,
                transition: "all 0.15s ease",
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Create Slide-over */}
      <SlideOver open={panelOpen} onClose={() => { setPanelOpen(false); }} title="New Customer">
        <NewCustomerForm onClose={() => setPanelOpen(false)} onOrchestrated={(result) => {
          setPanelOpen(false);
          fetchCustomers();
          switch (result.status) {
            case "customer_only":
              toast("success", CUSTOMER_LABELS.customerCreatedSuccess);
              router.push(`/customers/${result.customerId}`);
              break;
            case "payment_succeeded":
              toast("success", CUSTOMER_LABELS.bookingCreatedSuccess);
              router.push(`/customers/${result.customerId}`);
              break;
            case "booking_created":
            case "invoice_unpaid":
              toast("success", CUSTOMER_LABELS.bookingUnpaid);
              router.push(result.invoiceId ? `/invoices/${result.invoiceId}` : `/customers/${result.customerId}`);
              break;
            case "payment_failed":
              toast("error", CUSTOMER_LABELS.paymentFailed);
              router.push(result.invoiceId ? `/invoices/${result.invoiceId}` : `/customers/${result.customerId}`);
              break;
          }
        }} />
      </SlideOver>
    </div>
  );
}

/* ============================================================
   Create Customer Form
   ============================================================ */

type NextStep = "save" | "schedule";

interface OrchestrationResult {
  customerId: string;
  jobId?: string;
  invoiceId?: string;
  status: "customer_only" | "booking_created" | "invoice_unpaid" | "payment_succeeded" | "payment_failed";
  nextAction: string;
}

interface DuplicateMatch { id: string; first_name: string; last_name: string; email: string; phone: string; matchField: "email" | "phone" }

function NewCustomerForm({ onOrchestrated, onClose }: { onOrchestrated: (result: OrchestrationResult) => void; onClose: () => void }) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [billingAddress, setBillingAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [nextStep, setNextStep] = useState<NextStep>("schedule");

  // Customer autocomplete
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{ id: string; first_name: string; last_name: string; email: string; phone: string; billing_address?: Record<string, any> }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Duplicate detection (fallback safety)
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatch | null>(null);
  const [duplicateChecked, setDuplicateChecked] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  // Scheduling fields (visible when nextStep === "schedule")
  const [schedDumpsterSize, setSchedDumpsterSize] = useState("");
  const [schedDeliveryDate, setSchedDeliveryDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [schedPickupDate, setSchedPickupDate] = useState("");
  const [schedPickupTBD, setSchedPickupTBD] = useState(false);
  const [schedSiteAddress, setSchedSiteAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [schedBillingSameAsSite, setSchedBillingSameAsSite] = useState(true);
  const [schedPaymentMethod, setSchedPaymentMethod] = useState<"card" | "cash" | "check">("card");
  const [sizeOptions, setSizeOptions] = useState<{ id: string; asset_subtype: string; base_price: number; rental_period_days?: number }[]>([]);
  const [pickupManuallySet, setPickupManuallySet] = useState(false);
  const [sizesLoading, setSizesLoading] = useState(false);

  // Customer autocomplete search
  const handleNameSearch = useCallback((first: string, last: string) => {
    const q = `${first} ${last}`.trim();
    if (q.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      api.get<{ id: string; first_name: string; last_name: string; email: string; phone: string; billing_address?: Record<string, any> }[]>(`/customers/search?q=${encodeURIComponent(q)}&limit=5`)
        .then(results => { setSearchResults(results); setShowDropdown(results.length > 0); })
        .catch(() => { setSearchResults([]); setShowDropdown(false); });
    }, 250);
  }, []);

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
    setShowDropdown(false);
    setDuplicateChecked(true); // skip duplicate warning for existing customer
  };

  const clearSelectedCustomer = () => {
    if (selectedCustomerId) { setSelectedCustomerId(null); setDuplicateChecked(false); }
  };

  // Close dropdown on click outside
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  // Fetch tenant-scoped size options when scheduling is selected
  useEffect(() => {
    if (nextStep !== "schedule") return;
    if (sizeOptions.length > 0) return; // already fetched
    setSizesLoading(true);
    api.get<{ data: { id: string; asset_subtype: string; base_price: number; rental_period_days?: number }[] }>("/pricing?limit=100")
      .then((res) => {
        const opts = res.data || [];
        setSizeOptions(opts);
        // Clear selection if previously selected size is no longer available
        if (schedDumpsterSize && !opts.some(o => o.asset_subtype === schedDumpsterSize)) {
          setSchedDumpsterSize("");
        }
      })
      .catch(() => setSizeOptions([]))
      .finally(() => setSizesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextStep]);

  // Auto-calculate pickup date from delivery date + rental period
  useEffect(() => {
    if (pickupManuallySet || schedPickupTBD || !schedDeliveryDate || !schedDumpsterSize) return;
    const sizeOpt = sizeOptions.find(o => o.asset_subtype === schedDumpsterSize);
    const days = sizeOpt?.rental_period_days || 14;
    const d = new Date(schedDeliveryDate);
    d.setDate(d.getDate() + days);
    setSchedPickupDate(d.toISOString().split("T")[0]);
  }, [schedDeliveryDate, schedDumpsterSize, sizeOptions, schedPickupTBD, pickupManuallySet]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    backgroundColor: "var(--t-bg-card)",
    border: "1px solid var(--t-border)",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 14,
    color: "var(--t-text-primary)",
    outline: "none",
    transition: "border-color 0.15s ease",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--t-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: 6,
  };

  const sectionStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--t-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    paddingTop: 16,
    paddingBottom: 8,
    borderTop: "1px solid var(--t-border)",
    marginTop: 16,
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate scheduling fields when scheduling is selected
    if (nextStep === "schedule") {
      if (!schedDumpsterSize || !schedDeliveryDate || (!schedPickupDate && !schedPickupTBD)) {
        setError(CUSTOMER_LABELS.schedulingRequired);
        return;
      }
    }

    // Duplicate detection — check before creating (skip if already confirmed)
    if (!duplicateChecked) {
      const normalizedPhone = phone.replace(/\D/g, "");
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedPhone || normalizedEmail) {
        setCheckingDuplicate(true);
        try {
          // Check by phone first, then email
          for (const [field, val] of [["phone", normalizedPhone], ["email", normalizedEmail]] as const) {
            if (!val) continue;
            const res = await api.get<{ data: { id: string; first_name: string; last_name: string; email: string; phone: string }[]; meta: { total: number } }>(`/customers?search=${encodeURIComponent(val)}&limit=1`);
            if (res.meta.total > 0) {
              const match = res.data[0];
              // Verify it's an actual match (not a fuzzy substring hit)
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

    setSaving(true);
    try {
      const addr = billingAddress.street ? { street: billingAddress.street, city: billingAddress.city, state: billingAddress.state, zip: billingAddress.zip, lat: billingAddress.lat, lng: billingAddress.lng } : undefined;
      const siteAddr = schedBillingSameAsSite ? billingAddress : schedSiteAddress;

      const result = await api.post<OrchestrationResult>("/bookings/create-with-booking", {
        ...(selectedCustomerId ? { customerId: selectedCustomerId } : {}),
        type,
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        companyName: type === "commercial" ? companyName || undefined : undefined,
        billingAddress: addr,
        notes: notes || undefined,
        tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
        leadSource: leadSource || undefined,
        intent: nextStep === "schedule" ? "schedule_job" : "customer_only",
        ...(nextStep === "schedule" ? {
          dumpsterSize: schedDumpsterSize,
          deliveryDate: schedDeliveryDate,
          pickupDate: schedPickupTBD ? undefined : schedPickupDate,
          pickupTBD: schedPickupTBD,
          siteAddress: siteAddr.street ? { street: siteAddr.street, city: siteAddr.city, state: siteAddr.state, zip: siteAddr.zip, lat: siteAddr.lat, lng: siteAddr.lng } : undefined,
          paymentMethod: schedPaymentMethod,
        } : {}),
        idempotencyKey,
        confirmedCreateDespiteDuplicate: duplicateChecked,
      });

      onOrchestrated(result);
    } catch (err: unknown) {
      // Handle backend duplicate detection
      const errData = (err as { response?: { data?: { code?: string; existingCustomerId?: string } } })?.response?.data;
      if (errData?.code === "DUPLICATE_CUSTOMER" && errData.existingCustomerId) {
        try {
          const res = await api.get<{ data: { id: string; first_name: string; last_name: string; email: string; phone: string }[]; meta: { total: number } }>(`/customers?search=${encodeURIComponent(email || phone)}&limit=1`);
          if (res.data.length > 0) {
            setDuplicateMatch({ ...res.data[0], matchField: email ? "email" : "phone" });
            return;
          }
        } catch { /* fall through to generic error */ }
      }
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div style={{
          backgroundColor: "var(--t-error-soft)",
          border: "1px solid var(--t-border)",
          borderRadius: 10,
          padding: "12px 16px",
          fontSize: 13,
          color: "var(--t-error)",
        }}>
          {error}
        </div>
      )}

      {/* Contact Info */}
      <p style={{ ...sectionStyle, borderTop: "none", marginTop: 0, paddingTop: 0 }}>Contact Info</p>

      <div>
        <label style={labelStyle}>Type</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {(["residential", "commercial"] as const).map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              style={{
                padding: "10px 0",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                textTransform: "capitalize",
                border: type === t ? "none" : "1px solid var(--t-border)",
                backgroundColor: type === t ? "var(--t-accent)" : "transparent",
                color: type === t ? "var(--t-accent-on-accent)" : "var(--t-text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}>
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
            <span>{CUSTOMER_LABELS.existingCustomerSelected}</span>
            <button type="button" onClick={() => { clearSelectedCustomer(); setFirstName(""); setLastName(""); setEmail(""); setPhone(""); }} style={{ background: "none", border: "none", color: "var(--t-accent)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>&times;</button>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>First Name</label>
            <input value={firstName} onChange={e => { setFirstName(e.target.value); clearSelectedCustomer(); handleNameSearch(e.target.value, lastName); }} required style={inputStyle} placeholder="Jane" autoComplete="off" />
          </div>
          <div>
            <label style={labelStyle}>Last Name</label>
            <input value={lastName} onChange={e => { setLastName(e.target.value); clearSelectedCustomer(); handleNameSearch(firstName, e.target.value); }} required style={inputStyle} placeholder="Smith" autoComplete="off" />
          </div>
        </div>
        {showDropdown && searchResults.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, backgroundColor: "var(--t-bg-card)", border: "1px solid var(--t-border)", borderRadius: 10, marginTop: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", maxHeight: 220, overflowY: "auto" }}>
            {searchResults.map(c => (
              <button key={c.id} type="button" onClick={() => selectExistingCustomer(c)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid var(--t-border)", backgroundColor: "transparent", cursor: "pointer", fontSize: 13 }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--t-frame-hover)")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}>
                <div style={{ fontWeight: 600, color: "var(--t-text-primary)" }}>{c.first_name} {c.last_name}</div>
                {(c.phone || c.email) && (
                  <div style={{ fontSize: 11, color: "var(--t-text-muted)", marginTop: 2 }}>
                    {c.phone}{c.phone && c.email ? " · " : ""}{c.email}
                  </div>
                )}
              </button>
            ))}
            <button type="button" onClick={() => setShowDropdown(false)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", backgroundColor: "transparent", cursor: "pointer", fontSize: 13, color: "var(--t-accent)", fontWeight: 600 }}>
              {CUSTOMER_LABELS.continueAsNewCustomer}
            </button>
          </div>
        )}
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

      <div>
        <label style={labelStyle}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "none" }} placeholder="Internal notes..." />
      </div>

      {/* After Creating — next step selector */}
      <div style={{ marginTop: 8 }}>
        <label style={labelStyle}>{CUSTOMER_LABELS.nextStep}</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {([
            { key: "schedule" as const, label: CUSTOMER_LABELS.saveAndSchedule },
            { key: "save" as const, label: CUSTOMER_LABELS.saveCustomerOnly },
          ]).map(opt => (
            <button key={opt.key} type="button" onClick={() => setNextStep(opt.key)}
              style={{
                padding: "10px 0",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                border: nextStep === opt.key ? "none" : "1px solid var(--t-border)",
                backgroundColor: nextStep === opt.key ? "var(--t-accent)" : "transparent",
                color: nextStep === opt.key ? "var(--t-accent-on-accent)" : "var(--t-text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scheduling Details — visible when Save & Schedule Job selected */}
      {nextStep === "schedule" && (
        <>
          <p style={sectionStyle}>{CUSTOMER_LABELS.schedulingDetails}</p>

          <div>
            <label style={labelStyle}>{CUSTOMER_LABELS.dumpsterSize}</label>
            <select value={schedDumpsterSize} onChange={e => setSchedDumpsterSize(e.target.value)} disabled={sizesLoading} style={{ ...inputStyle, appearance: "none", opacity: sizesLoading ? 0.5 : 1 }}>
              <option value="">{sizesLoading ? CUSTOMER_LABELS.loadingSizes : sizeOptions.length === 0 ? CUSTOMER_LABELS.noSizesAvailable : CUSTOMER_LABELS.selectSize}</option>
              {sizeOptions.map(opt => (
                <option key={opt.id} value={opt.asset_subtype}>{opt.asset_subtype} — {formatCurrency(opt.base_price)}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>{CUSTOMER_LABELS.deliveryDate}</label>
              <input type="date" value={schedDeliveryDate} onChange={e => setSchedDeliveryDate(e.target.value)} onClick={e => (e.target as HTMLInputElement).showPicker?.()} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{CUSTOMER_LABELS.pickupDate}</label>
              <input type="date" value={schedPickupDate} onChange={e => { setSchedPickupDate(e.target.value); setPickupManuallySet(true); }} onClick={e => { if (!schedPickupTBD) (e.target as HTMLInputElement).showPicker?.(); }} disabled={schedPickupTBD} style={{ ...inputStyle, opacity: schedPickupTBD ? 0.5 : 1 }} />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--t-text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={schedPickupTBD} onChange={e => { setSchedPickupTBD(e.target.checked); if (e.target.checked) setSchedPickupDate(""); }} />
            {CUSTOMER_LABELS.pickupTBD}
          </label>

          <div>
            <label style={labelStyle}>{CUSTOMER_LABELS.siteAddress}</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--t-text-muted)", cursor: "pointer", marginBottom: 8 }}>
              <input type="checkbox" checked={schedBillingSameAsSite} onChange={e => setSchedBillingSameAsSite(e.target.checked)} />
              {CUSTOMER_LABELS.billingSameAsSite}
            </label>
            {!schedBillingSameAsSite && (
              <AddressAutocomplete value={schedSiteAddress} onChange={setSchedSiteAddress} placeholder="Search site address..." />
            )}
          </div>

          <div>
            <label style={labelStyle}>{CUSTOMER_LABELS.paymentMethod}</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {([
                { key: "card" as const, label: CUSTOMER_LABELS.creditCard },
                { key: "cash" as const, label: CUSTOMER_LABELS.cash },
                { key: "check" as const, label: CUSTOMER_LABELS.check },
              ]).map(opt => (
                <button key={opt.key} type="button" onClick={() => setSchedPaymentMethod(opt.key)}
                  style={{
                    padding: "10px 0",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    border: schedPaymentMethod === opt.key ? "none" : "1px solid var(--t-border)",
                    backgroundColor: schedPaymentMethod === opt.key ? "var(--t-accent)" : "transparent",
                    color: schedPaymentMethod === opt.key ? "var(--t-accent-on-accent)" : "var(--t-text-muted)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Duplicate warning */}
      {duplicateMatch && (
        <div style={{
          backgroundColor: "var(--t-accent-soft)",
          border: "1px solid var(--t-accent)",
          borderRadius: 10,
          padding: "16px",
          fontSize: 13,
        }}>
          <p style={{ fontWeight: 600, color: "var(--t-text-primary)", marginBottom: 4 }}>{CUSTOMER_LABELS.duplicateCustomerFound}</p>
          <p style={{ color: "var(--t-text-muted)", marginBottom: 2 }}>
            {duplicateMatch.first_name} {duplicateMatch.last_name}
          </p>
          <p style={{ color: "var(--t-text-muted)", marginBottom: 12, fontSize: 12 }}>
            {duplicateMatch.matchField === "email" ? CUSTOMER_LABELS.matchingEmail : CUSTOMER_LABELS.matchingPhone}: {duplicateMatch.matchField === "email" ? duplicateMatch.email : duplicateMatch.phone}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button type="button" onClick={() => { setDuplicateMatch(null); setDuplicateChecked(true); }}
              style={{ width: "100%", padding: "10px 0", borderRadius: 24, fontSize: 13, fontWeight: 600, backgroundColor: "var(--t-accent)", color: "var(--t-accent-on-accent)", border: "none", cursor: "pointer" }}>
              {CUSTOMER_LABELS.continueCreatingCustomer}
            </button>
            <button type="button" onClick={() => { onClose(); router.push(`/customers/${duplicateMatch.id}`); }}
              style={{ width: "100%", padding: "10px 0", borderRadius: 24, fontSize: 13, fontWeight: 600, backgroundColor: "transparent", color: "var(--t-text-primary)", border: "1px solid var(--t-border)", cursor: "pointer" }}>
              {CUSTOMER_LABELS.viewExistingCustomer}
            </button>
            <button type="button" onClick={() => setDuplicateMatch(null)}
              style={{ fontSize: 12, color: "var(--t-text-muted)", backgroundColor: "transparent", border: "none", cursor: "pointer" }}>
              {CUSTOMER_LABELS.cancelCreateCustomer}
            </button>
          </div>
        </div>
      )}

      <button type="submit" disabled={saving || checkingDuplicate}
        style={{
          width: "100%",
          backgroundColor: "var(--t-accent)",
          color: "var(--t-accent-on-accent)",
          fontSize: 14,
          fontWeight: 700,
          padding: "14px 0",
          borderRadius: 24,
          border: "none",
          cursor: saving || checkingDuplicate ? "default" : "pointer",
          opacity: saving || checkingDuplicate ? 0.5 : 1,
          transition: "opacity 0.15s ease",
          marginTop: 8,
        }}>
        {checkingDuplicate ? CUSTOMER_LABELS.checkingDuplicate : saving ? CUSTOMER_LABELS.creatingCustomer : nextStep === "schedule" ? CUSTOMER_LABELS.saveAndContinue : CUSTOMER_LABELS.saveCustomer}
      </button>
    </form>
  );
}
