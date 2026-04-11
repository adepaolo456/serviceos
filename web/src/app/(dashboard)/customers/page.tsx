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
import NewCustomerForm, { NEW_CUSTOMER_LABELS, type OrchestrationResult } from "@/components/new-customer-form";

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
// Labels now imported from @/components/new-customer-form

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
        <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setTypeFilter(f.key)}
              style={{ padding: "5px 14px", borderRadius: 18, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", transition: "all 0.15s ease", backgroundColor: typeFilter === f.key ? "var(--t-accent)" : "transparent", color: typeFilter === f.key ? "#fff" : "var(--t-text-muted)" }}>
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
        <NewCustomerForm onClose={() => setPanelOpen(false)} onOrchestrated={(result: OrchestrationResult) => {
          setPanelOpen(false);
          fetchCustomers();
          switch (result.status) {
            case "customer_only":
              toast("success", NEW_CUSTOMER_LABELS.customerCreatedSuccess);
              router.push(`/customers/${result.customerId}`);
              break;
            case "payment_succeeded":
              toast("success", NEW_CUSTOMER_LABELS.bookingCreatedSuccess);
              router.push(`/customers/${result.customerId}`);
              break;
            case "booking_created":
            case "invoice_unpaid":
              toast("success", NEW_CUSTOMER_LABELS.bookingUnpaid);
              router.push(result.invoiceId ? `/invoices/${result.invoiceId}` : `/customers/${result.customerId}`);
              break;
            case "payment_failed":
              toast("error", NEW_CUSTOMER_LABELS.paymentFailed);
              router.push(result.invoiceId ? `/invoices/${result.invoiceId}` : `/customers/${result.customerId}`);
              break;
          }
        }} />
      </SlideOver>
    </div>
  );
}

/* ============================================================
   Create Customer Form — extracted to @/components/new-customer-form.tsx
   ============================================================ */
