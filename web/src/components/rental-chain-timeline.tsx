"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface ChainLink {
  id: string;
  job_id: string;
  sequence_number: number;
  task_type: string;
  status: string;
  scheduled_date: string;
  completed_at: string | null;
  job?: { id: string; job_number: string; asset?: { identifier: string } | null };
}

interface RentalChain {
  id: string;
  status: string;
  dumpster_size: string;
  drop_off_date: string;
  expected_pickup_date: string;
  actual_pickup_date: string | null;
  rental_days: number;
  links: ChainLink[];
}

const TYPE_LABELS: Record<string, string> = {
  drop_off: "Drop Off",
  delivery: "Delivery",
  exchange: "Exchange",
  pick_up: "Pick Up",
  pickup: "Pick Up",
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  completed: { bg: "var(--t-accent-soft)", text: "var(--t-accent)", border: "var(--t-accent)" },
  scheduled: { bg: "var(--t-bg-elevated)", text: "var(--t-text-muted)", border: "var(--t-border)" },
  in_progress: { bg: "rgba(59,130,246,0.08)", text: "#3b82f6", border: "#3b82f6" },
  cancelled: { bg: "var(--t-error-soft)", text: "var(--t-error)", border: "var(--t-error)" },
};

export default function RentalChainTimeline({
  chainId,
  currentJobId,
}: {
  chainId: string;
  currentJobId?: string;
}) {
  const [chain, setChain] = useState<RentalChain | null>(null);

  useEffect(() => {
    api.get<RentalChain>(`/rental-chains/${chainId}`).then(setChain).catch(() => {});
  }, [chainId]);

  if (!chain || !chain.links?.length) return null;

  const sorted = [...chain.links].sort((a, b) => a.sequence_number - b.sequence_number);
  const activeLinks = sorted.filter(l => l.status !== "cancelled");

  return (
    <div
      className="rounded-[20px] border p-4 mb-6 overflow-x-auto"
      style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>
          Rental Chain
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{
          background: chain.status === "active" ? "var(--t-accent-soft)" : "var(--t-bg-elevated)",
          color: chain.status === "active" ? "var(--t-accent)" : "var(--t-text-muted)",
        }}>
          {chain.status}
        </span>
        <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>
          {chain.dumpster_size} &middot; {chain.rental_days} day rental
        </span>
      </div>

      <div className="flex items-center gap-0 min-w-max">
        {activeLinks.map((link, i) => {
          const isCurrent = link.job_id === currentJobId;
          const colors = STATUS_COLORS[link.status] || STATUS_COLORS.scheduled;
          const date = link.scheduled_date
            ? new Date(link.scheduled_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "—";

          return (
            <div key={link.id} className="flex items-center">
              <Link
                href={`/jobs/${link.job_id}`}
                className={`flex flex-col items-center p-3 rounded-[14px] border-2 transition-all hover:opacity-80 ${isCurrent ? "scale-105 shadow-lg" : ""}`}
                style={{
                  borderColor: isCurrent ? "var(--t-accent)" : colors.border,
                  background: isCurrent ? "var(--t-accent-soft)" : colors.bg,
                  minWidth: 100,
                }}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: colors.text }}>
                  {TYPE_LABELS[link.task_type] || link.task_type}
                </span>
                <span className="text-xs font-medium" style={{ color: "var(--t-text-primary)" }}>
                  {date}
                </span>
                <span className="text-[10px] capitalize mt-0.5" style={{ color: colors.text }}>
                  {link.status}
                </span>
                {link.job?.asset?.identifier && (
                  <span className="text-[9px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                    {link.job.asset.identifier}
                  </span>
                )}
              </Link>
              {i < activeLinks.length - 1 && (
                <div className="w-8 h-0.5 shrink-0" style={{ background: "var(--t-border)" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
