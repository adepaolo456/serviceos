"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Building,
  Calendar,
} from "lucide-react";
import { api } from "@/lib/api";

interface Customer {
  id: string;
  type: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  billing_address: Record<string, string> | null;
  notes: string;
  tags: string[];
  lead_source: string;
  total_jobs: number;
  lifetime_revenue: number;
  is_active: boolean;
  created_at: string;
}

interface Job {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  scheduled_date: string;
  total_price: number;
}

interface JobsResponse {
  data: Job[];
  meta: { total: number };
}

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  total: number;
  balance_due: number;
  created_at: string;
}

interface InvoicesResponse {
  data: Invoice[];
  meta: { total: number };
}

const statusColor: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  confirmed: "bg-blue-500/10 text-blue-400",
  dispatched: "bg-purple-500/10 text-purple-400",
  en_route: "bg-orange-500/10 text-orange-400",
  in_progress: "bg-brand/10 text-brand",
  completed: "bg-emerald-500/10 text-emerald-400",
  cancelled: "bg-red-500/10 text-red-400",
  draft: "bg-zinc-500/10 text-zinc-400",
  sent: "bg-blue-500/10 text-blue-400",
  paid: "bg-brand/10 text-brand",
  overdue: "bg-red-500/10 text-red-400",
  void: "bg-zinc-500/10 text-zinc-400",
};

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [c, j, i] = await Promise.all([
          api.get<Customer>(`/customers/${id}`),
          api.get<JobsResponse>(`/jobs?customerId=${id}&limit=50`),
          api.get<InvoicesResponse>(`/invoices?customerId=${id}&limit=50`),
        ]);
        setCustomer(c);
        setJobs(j.data);
        setInvoices(i.data);
      } catch {
        /* handled by api client */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="py-10">
        <div className="mb-6 h-4 w-36 animate-pulse rounded bg-white/5" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="h-14 w-14 animate-pulse rounded-2xl bg-white/5" />
              <div className="space-y-2">
                <div className="h-5 w-32 animate-pulse rounded bg-white/5" />
                <div className="h-3 w-20 animate-pulse rounded bg-white/5" />
              </div>
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-4 w-full animate-pulse rounded bg-white/5" />
              ))}
            </div>
          </div>
          <div className="lg:col-span-2 space-y-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-dark-card border border-[#1E2D45] p-6">
                <div className="h-5 w-24 animate-pulse rounded bg-white/5 mb-4" />
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="h-4 w-full animate-pulse rounded bg-white/5" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex items-center justify-center py-32 text-muted">
        Customer not found
      </div>
    );
  }

  const addr = customer.billing_address;

  return (
    <div>
      <Link
        href="/customers"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Customers
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Customer info card */}
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 lg:col-span-1">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand font-display text-xl font-bold">
              {customer.first_name[0]}
              {customer.last_name[0]}
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-white">
                {customer.first_name} {customer.last_name}
              </h1>
              {customer.company_name && (
                <p className="text-sm text-muted">{customer.company_name}</p>
              )}
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  customer.type === "commercial"
                    ? "bg-blue-500/10 text-blue-400"
                    : "bg-brand/10 text-brand"
                }`}
              >
                {customer.type}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 text-xs ${
                  customer.is_active ? "text-brand" : "text-red-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${customer.is_active ? "bg-brand" : "bg-red-500"}`}
                />
                {customer.is_active ? "Active" : "Inactive"}
              </span>
            </div>

            {customer.email && (
              <div className="flex items-center gap-3 text-sm">
                <Mail className="h-4 w-4 text-muted" />
                <span className="text-foreground">{customer.email}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone className="h-4 w-4 text-muted" />
                <span className="text-foreground">{customer.phone}</span>
              </div>
            )}
            {addr && (addr.street || addr.city) && (
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="h-4 w-4 text-muted" />
                <span className="text-foreground">
                  {[addr.street, addr.city, addr.state, addr.zip]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            )}
            {customer.lead_source && (
              <div className="flex items-center gap-3 text-sm">
                <Building className="h-4 w-4 text-muted" />
                <span className="text-foreground capitalize">
                  {customer.lead_source}
                </span>
              </div>
            )}
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-muted" />
              <span className="text-foreground">
                Since {new Date(customer.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[#1E2D45] pt-6">
            <div>
              <p className="text-2xl font-display font-bold text-white">
                {customer.total_jobs}
              </p>
              <p className="text-xs text-muted mt-1">Total Jobs</p>
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-white tabular-nums">
                ${Number(customer.lifetime_revenue).toLocaleString()}
              </p>
              <p className="text-xs text-muted mt-1">Lifetime Revenue</p>
            </div>
          </div>

          {customer.notes && (
            <div className="mt-6 border-t border-[#1E2D45] pt-6">
              <p className="text-xs font-medium uppercase tracking-wider text-muted mb-2">
                Notes
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {customer.notes}
              </p>
            </div>
          )}
        </div>

        {/* Jobs & invoices */}
        <div className="space-y-6 lg:col-span-2">
          {/* Jobs */}
          <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1E2D45]">
              <h2 className="font-display text-base font-semibold text-white">
                Jobs ({jobs.length})
              </h2>
            </div>
            {jobs.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted">
                No jobs yet
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1E2D45]">
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Job #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      Price
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-[#1E2D45] last:border-0 transition-colors hover:bg-dark-card-hover"
                    >
                      <td className="px-6 py-3.5 font-medium text-white">
                        {job.job_number}
                      </td>
                      <td className="px-6 py-3.5 text-foreground capitalize">
                        {job.service_type || job.job_type}
                      </td>
                      <td className="px-6 py-3.5 text-foreground">
                        {job.scheduled_date || "—"}
                      </td>
                      <td className="px-6 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[job.status] || "bg-zinc-500/10 text-zinc-400"}`}
                        >
                          {job.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right text-foreground tabular-nums">
                        {job.total_price
                          ? `$${Number(job.total_price).toLocaleString()}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Invoices */}
          <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1E2D45]">
              <h2 className="font-display text-base font-semibold text-white">
                Invoices ({invoices.length})
              </h2>
            </div>
            {invoices.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted">
                No invoices yet
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1E2D45]">
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Invoice #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      Total
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-[#1E2D45] last:border-0 transition-colors hover:bg-dark-card-hover"
                    >
                      <td className="px-6 py-3.5 font-medium text-white">
                        {inv.invoice_number}
                      </td>
                      <td className="px-6 py-3.5 text-foreground">
                        {new Date(inv.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[inv.status] || "bg-zinc-500/10 text-zinc-400"}`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right text-foreground tabular-nums">
                        ${Number(inv.total).toLocaleString()}
                      </td>
                      <td className="px-6 py-3.5 text-right text-foreground tabular-nums">
                        ${Number(inv.balance_due).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
