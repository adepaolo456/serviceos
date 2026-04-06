"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
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
        <NewCustomerForm onSuccess={(id, nextStep) => {
          setPanelOpen(false);
          fetchCustomers();
          toast("success", CUSTOMER_LABELS.customerCreatedSuccess);
          if (nextStep === "schedule") {
            openWizard({ customerId: id });
          } else {
            router.push(`/customers/${id}`);
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

function NewCustomerForm({ onSuccess }: { onSuccess: (customerId: string, nextStep: NextStep) => void }) {
  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [billingAddress, setBillingAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [serviceAddresses, setServiceAddresses] = useState<AddressValue[]>([]);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [nextStep, setNextStep] = useState<NextStep>("save");

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
    setError(""); setSaving(true);
    try {
      const addr = billingAddress.street ? { street: billingAddress.street, city: billingAddress.city, state: billingAddress.state, zip: billingAddress.zip, lat: billingAddress.lat, lng: billingAddress.lng } : undefined;
      const created = await api.post<{ id: string }>("/customers", {
        type, firstName, lastName,
        email: email || undefined,
        phone: phone || undefined,
        companyName: type === "commercial" ? companyName || undefined : undefined,
        billingAddress: addr,
        notes: notes || undefined,
        tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
        leadSource: leadSource || undefined,
      });
      onSuccess(created.id, nextStep);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create"); }
    finally { setSaving(false); }
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>First Name</label>
          <input value={firstName} onChange={e => setFirstName(e.target.value)} required style={inputStyle} placeholder="Jane" />
        </div>
        <div>
          <label style={labelStyle}>Last Name</label>
          <input value={lastName} onChange={e => setLastName(e.target.value)} required style={inputStyle} placeholder="Smith" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Phone</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} placeholder="(508) 631-8884" />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} placeholder="jane@example.com" />
        </div>
      </div>

      {/* Address */}
      <p style={sectionStyle}>Billing Address</p>
      <AddressAutocomplete value={billingAddress} onChange={setBillingAddress} placeholder="Search address..." />

      {/* Service Addresses */}
      <p style={sectionStyle}>Service Addresses</p>
      {serviceAddresses.map((addr, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <AddressAutocomplete value={addr} onChange={(v) => setServiceAddresses(prev => { const n = [...prev]; n[i] = v; return n; })} placeholder={`Service address ${i + 1}`} />
          </div>
          <button type="button" onClick={() => setServiceAddresses(prev => prev.filter((_, j) => j !== i))}
            style={{
              padding: 8,
              color: "var(--t-text-muted)",
              backgroundColor: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              marginTop: 4,
              transition: "color 0.15s ease",
            }}>
            &times;
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setServiceAddresses(prev => [...prev, { street: "", city: "", state: "", zip: "", lat: null, lng: null }])}
        style={{ fontSize: 12, color: "var(--t-accent)", backgroundColor: "transparent", border: "none", cursor: "pointer", textAlign: "left", transition: "opacity 0.15s ease" }}>
        + Add service address
      </button>

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
            { key: "save" as const, label: CUSTOMER_LABELS.saveCustomerOnly },
            { key: "schedule" as const, label: CUSTOMER_LABELS.saveAndSchedule },
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

      <button type="submit" disabled={saving}
        style={{
          width: "100%",
          backgroundColor: "var(--t-accent)",
          color: "var(--t-accent-on-accent)",
          fontSize: 14,
          fontWeight: 700,
          padding: "14px 0",
          borderRadius: 24,
          border: "none",
          cursor: saving ? "default" : "pointer",
          opacity: saving ? 0.5 : 1,
          transition: "opacity 0.15s ease",
          marginTop: 8,
        }}>
        {saving ? CUSTOMER_LABELS.creatingCustomer : nextStep === "schedule" ? CUSTOMER_LABELS.saveAndContinue : CUSTOMER_LABELS.saveCustomer}
      </button>
    </form>
  );
}
