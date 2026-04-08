"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, FileCheck, Mail, Copy, ExternalLink, Loader2, ChevronRight, Flame, Phone } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { formatCurrency, formatDumpsterSize } from "@/lib/utils";
import { getFeatureLabel } from "@/lib/feature-registry";
import SlideOver from "@/components/slide-over";

interface Quote {
  id: string;
  quote_number: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  delivery_address: Record<string, string> | null;
  asset_subtype: string;
  base_price: number;
  distance_surcharge: number;
  total_quoted: number;
  included_tons: number;
  rental_days: number;
  overage_rate: number;
  extra_day_rate: number;
  status: string;
  derived_status: string;
  token: string | null;
  expires_at: string;
  booked_job_id: string | null;
  created_at: string;
  created_by: string | null;
  booking_url?: string;
  view_count?: number;
  first_viewed_at?: string | null;
  last_viewed_at?: string | null;
  is_hot?: boolean;
  follow_up_priority?: "needs_follow_up" | "stale" | null;
  expires_urgency?: "expires_today" | "expiring_soon" | null;
  hours_until_expiry?: number;
  auto_follow_up_sent_at?: string | null;
  last_sent_at?: string | null;
}

interface Summary {
  totalSent: number;
  viewed: number;
  converted: number;
  open: number;
  expired: number;
  draft: number;
  conversionRate: number;
  rangeDays: number;
}

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "converted", label: "Converted" },
  { key: "expired", label: "Expired" },
  { key: "draft", label: "Drafts" },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: "var(--t-bg-elevated)", text: "var(--t-text-muted)" },
  sent: { bg: "var(--t-accent-soft)", text: "var(--t-accent)" },
  open: { bg: "var(--t-accent-soft)", text: "var(--t-accent)" },
  converted: { bg: "var(--t-success-soft, rgba(34,197,94,0.1))", text: "var(--t-success, #22c55e)" },
  expired: { bg: "var(--t-error-soft)", text: "var(--t-error)" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {status}
    </span>
  );
}

function formatAddr(addr: Record<string, string> | null): string {
  if (!addr) return "—";
  return [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ");
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(d: string | null): string {
  if (!d) return "";
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function QuotesPage() {
  const { toast } = useToast();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      params.set("limit", "100");
      const res = await api.get<{ data: Quote[]; meta: { total: number } }>(`/quotes?${params}`);
      setQuotes(res.data);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [statusFilter, search]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const [hotQuotes, setHotQuotes] = useState<Quote[]>([]);
  const [statsRange, setStatsRange] = useState("30d");

  useEffect(() => {
    api.get<Summary>(`/quotes/summary?range=${statsRange}`).then(setSummary).catch(() => {});
  }, [statsRange]);

  useEffect(() => {
    api.get<{ data: Quote[] }>("/quotes?hot=true&limit=10").then((r) => setHotQuotes(r.data || [])).catch(() => {});
  }, []);

  const openDetail = async (q: Quote) => {
    try {
      const detail = await api.get<Quote>(`/quotes/${q.id}`);
      setSelectedQuote(detail);
    } catch {
      setSelectedQuote(q);
    }
    setDetailOpen(true);
  };

  const handleResend = async (quoteId: string) => {
    setResending(quoteId);
    try {
      await api.post(`/quotes/${quoteId}/resend`, {});
      toast("success", "Quote re-sent");
      fetchQuotes();
    } catch {
      toast("error", "Failed to re-send");
    } finally {
      setResending(null);
    }
  };

  const copyBookingLink = (q: Quote) => {
    if (q.booking_url || q.token) {
      const url = q.booking_url || `quote token: ${q.token}`;
      navigator.clipboard.writeText(url).then(() => toast("success", "Link copied"));
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-text-primary)" }}>
            {getFeatureLabel("quotes_page")}
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: "var(--t-text-muted)" }}>
            Track sent quotes and conversion pipeline
          </p>
        </div>
      </div>

      {/* Conversion Dashboard */}
      {summary && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--t-text-primary)" }}>
              Quote Conversion
            </h2>
            <div className="flex gap-1">
              {(["7d", "30d", "90d"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setStatsRange(r)}
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    background: statsRange === r ? "var(--t-accent)" : "var(--t-bg-card)",
                    color: statsRange === r ? "var(--t-accent-on-accent)" : "var(--t-text-muted)",
                    border: statsRange === r ? "none" : "1px solid var(--t-border)",
                  }}
                >
                  {r === "7d" ? "7 days" : r === "30d" ? "30 days" : "90 days"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Sent", value: summary.totalSent, color: "var(--t-accent)" },
              { label: "Viewed", value: summary.viewed, color: "var(--t-warning)" },
              { label: "Booked", value: summary.converted, color: "var(--t-success, #22c55e)" },
              { label: "Conversion", value: `${summary.conversionRate}%`, color: "var(--t-accent)" },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-[14px] border p-4"
                style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)" }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-text-muted)" }}>
                  {s.label}
                </p>
                <p className="text-[22px] font-bold mt-1" style={{ color: s.color }}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hot Quotes + Follow-Up */}
      {hotQuotes.length > 0 ? (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="h-4 w-4" style={{ color: "var(--t-warning)" }} />
            <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--t-text-primary)" }}>
              Hot Quotes
            </h2>
            <span className="text-[11px] font-medium rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--t-warning-soft, rgba(234,179,8,0.1))", color: "var(--t-warning)" }}>
              {hotQuotes.length}
            </span>
          </div>
          <div className="grid gap-2">
            {hotQuotes.map((q) => {
              const isUrgent = q.follow_up_priority === "needs_follow_up";
              const isStale = q.follow_up_priority === "stale";
              const expiresToday = q.expires_urgency === "expires_today";
              const expiringSoon = q.expires_urgency === "expiring_soon";
              const highlightBorder = isUrgent || expiresToday;
              return (
                <div
                  key={q.id}
                  className="flex items-center justify-between rounded-[12px] border px-4 py-3"
                  style={{
                    backgroundColor: isUrgent ? "var(--t-warning-soft, rgba(234,179,8,0.06))" : expiresToday ? "var(--t-error-soft, rgba(239,68,68,0.04))" : "var(--t-bg-card)",
                    borderColor: highlightBorder ? (expiresToday && !isUrgent ? "var(--t-error)" : "var(--t-warning)") : "var(--t-border)",
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate" style={{ color: "var(--t-text-primary)" }}>
                        {q.customer_name || "Unknown"}
                      </span>
                      <span className="text-[11px] font-medium" style={{ color: "var(--t-text-muted)" }}>
                        {formatDumpsterSize(q.asset_subtype)}
                      </span>
                      {isUrgent && (
                        <span className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--t-warning)", color: "#fff" }}>
                          Viewing Now
                        </span>
                      )}
                      {isStale && (
                        <span className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--t-bg-elevated, #e5e7eb)", color: "var(--t-text-muted)" }}>
                          Stale
                        </span>
                      )}
                      {expiresToday && (
                        <span className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--t-error)", color: "#fff" }}>
                          Expires Today
                        </span>
                      )}
                      {expiringSoon && !expiresToday && (
                        <span className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--t-warning-soft, rgba(234,179,8,0.15))", color: "var(--t-warning)" }}>
                          Expiring Soon
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                      <span className="font-semibold" style={{ color: "var(--t-accent)" }}>
                        {formatCurrency(Number(q.total_quoted))}
                      </span>
                      <span>{q.view_count ?? 0} views</span>
                      {q.last_viewed_at && <span>{timeAgo(q.last_viewed_at)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {q.customer_phone && (
                      <a
                        href={`tel:${q.customer_phone}`}
                        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
                        style={isUrgent
                          ? { backgroundColor: "var(--t-accent)", color: "var(--t-accent-on-accent)" }
                          : { border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }
                        }
                        title="Call"
                      >
                        <Phone className="h-3 w-3" /> Call
                      </a>
                    )}
                    <button
                      onClick={() => handleResend(q.id)}
                      disabled={resending === q.id}
                      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50"
                      style={isUrgent && !q.customer_phone
                        ? { backgroundColor: "var(--t-accent)", color: "var(--t-accent-on-accent)" }
                        : { border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }
                      }
                      title="Resend Quote"
                    >
                      <Mail className="h-3 w-3" /> {resending === q.id ? "..." : "Resend"}
                    </button>
                    {q.token && (
                      <a
                        href={`/quote/${q.token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-[var(--t-bg-card-hover)]"
                        style={{ borderColor: "var(--t-border)", color: "var(--t-accent)" }}
                        title="View hosted quote"
                      >
                        <ExternalLink className="h-3 w-3" /> View
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-[12px] border px-4 py-3 text-center" style={{ backgroundColor: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>No active follow-ups right now</p>
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--t-text-muted)" }} />
          <input
            type="text"
            placeholder="Search by name, email, or quote #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-full border pl-9 pr-4 py-2 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
            style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
          />
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                background: statusFilter === f.key ? "var(--t-accent)" : "var(--t-bg-card)",
                color: statusFilter === f.key ? "var(--t-accent-on-accent)" : "var(--t-text-muted)",
                border: `1px solid ${statusFilter === f.key ? "var(--t-accent)" : "var(--t-border)"}`,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--t-text-muted)" }} />
        </div>
      ) : quotes.length === 0 ? (
        <div className="rounded-[14px] border p-12 text-center" style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)" }}>
          <FileCheck className="h-10 w-10 mx-auto mb-3" style={{ color: "var(--t-text-muted)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
            {statusFilter !== "all" ? "No quotes match this filter" : "No quotes yet"}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>
            {statusFilter === "all" ? "Quotes you send from Quick Quote will appear here" : "Try a different filter"}
          </p>
        </div>
      ) : (
        <div className="rounded-[14px] border overflow-hidden" style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
                {["Quote #", "Customer", "Address", "Size", "Amount", "Status", "Created", ""].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr
                  key={q.id}
                  className="cursor-pointer transition-colors"
                  style={{ borderBottom: "1px solid var(--t-border)" }}
                  onClick={() => openDetail(q)}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: "var(--t-accent)" }}>
                    {q.quote_number}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--t-text-primary)" }}>
                    {q.customer_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[200px] truncate" style={{ color: "var(--t-text-muted)" }}>
                    {formatAddr(q.delivery_address)}
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: "var(--t-text-primary)" }}>
                    {q.asset_subtype}
                  </td>
                  <td className="px-4 py-3 font-semibold" style={{ color: "var(--t-text-primary)" }}>
                    {formatCurrency(Number(q.total_quoted))}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={q.derived_status} />
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--t-text-muted)" }}>
                    {formatDate(q.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="h-4 w-4" style={{ color: "var(--t-text-muted)" }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Quote Detail SlideOver */}
      <SlideOver open={detailOpen} onClose={() => setDetailOpen(false)} title={getFeatureLabel("quote_detail")}>
        {selectedQuote && (
          <div className="space-y-5">
            {/* Status + Quote # */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-medium" style={{ color: "var(--t-accent)" }}>
                {selectedQuote.quote_number}
              </span>
              <StatusBadge status={selectedQuote.derived_status} />
            </div>

            {/* Customer */}
            <div className="rounded-[14px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--t-text-muted)" }}>Customer</p>
              <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>{selectedQuote.customer_name || "—"}</p>
              {selectedQuote.customer_email && <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>{selectedQuote.customer_email}</p>}
              {selectedQuote.customer_phone && <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>{selectedQuote.customer_phone}</p>}
            </div>

            {/* Pricing */}
            <div className="rounded-[14px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--t-text-muted)" }}>Quote Details</p>
              <div className="space-y-1.5 text-[13px]" style={{ color: "var(--t-text-muted)" }}>
                <div className="flex justify-between"><span>Dumpster</span><span style={{ color: "var(--t-text-primary)" }}>{selectedQuote.asset_subtype}</span></div>
                <div className="flex justify-between"><span>Base price</span><span style={{ color: "var(--t-text-primary)" }}>{formatCurrency(Number(selectedQuote.base_price))}</span></div>
                {Number(selectedQuote.distance_surcharge) > 0 && (
                  <div className="flex justify-between"><span>Distance surcharge</span><span style={{ color: "var(--t-warning)" }}>{formatCurrency(Number(selectedQuote.distance_surcharge))}</span></div>
                )}
                <div className="flex justify-between"><span>Rental period</span><span style={{ color: "var(--t-text-primary)" }}>{selectedQuote.rental_days} days</span></div>
                <div className="flex justify-between"><span>Included tonnage</span><span style={{ color: "var(--t-text-primary)" }}>{Number(selectedQuote.included_tons)} tons</span></div>
                <div className="flex justify-between"><span>Overage rate</span><span style={{ color: "var(--t-text-primary)" }}>{formatCurrency(Number(selectedQuote.overage_rate))}/ton</span></div>
                <div className="flex justify-between pt-2 font-bold" style={{ borderTop: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}>
                  <span>Total</span><span style={{ color: "var(--t-accent)" }}>{formatCurrency(Number(selectedQuote.total_quoted))}</span>
                </div>
              </div>
            </div>

            {/* Address */}
            {selectedQuote.delivery_address && (
              <div className="rounded-[14px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Delivery Address</p>
                <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{formatAddr(selectedQuote.delivery_address)}</p>
              </div>
            )}

            {/* Timestamps */}
            <div className="rounded-[14px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--t-text-muted)" }}>Timeline</p>
              <div className="space-y-1 text-xs" style={{ color: "var(--t-text-muted)" }}>
                <div className="flex justify-between"><span>Created</span><span>{formatDate(selectedQuote.created_at)}</span></div>
                <div className="flex justify-between"><span>Expires</span><span>{formatDate(selectedQuote.expires_at)}</span></div>
                {selectedQuote.booked_job_id && (
                  <div className="flex justify-between"><span>Converted to booking</span><span style={{ color: "var(--t-success, #22c55e)" }}>Yes</span></div>
                )}
              </div>
            </div>

            {/* Linked booking */}
            {selectedQuote.booked_job_id && (
              <a
                href={`/jobs/${selectedQuote.booked_job_id}`}
                className="flex items-center gap-2 rounded-[14px] border p-3 text-sm font-medium transition-colors hover:bg-[var(--t-bg-card-hover)]"
                style={{ borderColor: "var(--t-border)", color: "var(--t-accent)" }}
              >
                <ExternalLink className="h-4 w-4" /> View linked booking
              </a>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {selectedQuote.derived_status !== "converted" && selectedQuote.customer_email && (
                <button
                  onClick={() => handleResend(selectedQuote.id)}
                  disabled={resending === selectedQuote.id}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold border transition-colors hover:bg-[var(--t-bg-card-hover)] disabled:opacity-50"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                >
                  {resending === selectedQuote.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Re-send
                </button>
              )}
              {selectedQuote.booking_url && (
                <button
                  onClick={() => copyBookingLink(selectedQuote)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold border transition-colors hover:bg-[var(--t-bg-card-hover)]"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                >
                  <Copy className="h-4 w-4" /> Copy Link
                </button>
              )}
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
