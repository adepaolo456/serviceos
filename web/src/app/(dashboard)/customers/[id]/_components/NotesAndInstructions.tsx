"use client";

import { MessageSquare, Truck } from "lucide-react";
import { CUSTOMER_DASHBOARD_LABELS } from "@/lib/customer-dashboard-labels";
import type { DashboardNotes } from "@/lib/customer-dashboard-types";

/**
 * Notes & driver instructions — clearly separated. Internal notes are
 * the existing customer_notes timeline (office-only). Driver
 * instructions is a dedicated free-text field on the customer record
 * (new in Pass 1) surfaced to the driver app.
 *
 * Customer-visible notes are intentionally omitted — the brief flagged
 * that bucket as "future use" and no backend field exists for it yet.
 */
export default function NotesAndInstructions({
  data,
}: {
  data: DashboardNotes;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS;

  const PREVIEW_COUNT = 3;

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)] mb-2">
        {L.sections.notes}
      </h3>

      <div className="space-y-3">
        {/* Driver instructions — rendered FIRST because they're
            operationally load-bearing. The green card IS the signal;
            when present, no subheading is needed. */}
        <section>
          <div className="flex items-center gap-1.5 mb-1">
            <Truck className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
              {L.fields.driverInstructionsHeading}
            </h4>
          </div>
          {data.driverInstructions ? (
            <div
              className="rounded-[12px] border px-2.5 py-2 text-xs whitespace-pre-wrap"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--t-accent) 25%, transparent)",
                background:
                  "var(--t-accent-soft, rgba(34,197,94,0.05))",
                color: "var(--t-text-primary)",
              }}
            >
              {data.driverInstructions}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--t-text-muted)] italic">
              {L.empty.noDriverInstructions}
            </p>
          )}
        </section>

        {/* Internal notes — existing timeline, office-only */}
        <section className="border-t border-[var(--t-border)] pt-2">
          <div className="flex items-center gap-1.5 mb-1">
            <MessageSquare className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
              {L.fields.internalNotesHeading}
            </h4>
          </div>
          {data.internal.length === 0 ? (
            <p className="text-[11px] text-[var(--t-text-muted)] italic">
              {L.empty.noInternalNotes}
            </p>
          ) : (
            <div className="space-y-1">
              {data.internal.slice(0, PREVIEW_COUNT).map((note) => (
                <div
                  key={note.id}
                  className="rounded-[10px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] px-2.5 py-1.5"
                >
                  <p className="text-xs text-[var(--t-text-primary)] whitespace-pre-wrap">
                    {note.content}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--t-text-muted)]">
                    {note.authorName || "—"} ·{" "}
                    {new Date(note.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
              {data.internal.length > PREVIEW_COUNT && (
                <p className="text-[10px] text-[var(--t-text-muted)] text-center pt-0.5">
                  {data.internal.length - PREVIEW_COUNT} more in Advanced → Notes
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
