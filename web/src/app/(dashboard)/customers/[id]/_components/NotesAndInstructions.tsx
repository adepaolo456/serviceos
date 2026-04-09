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

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
      <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)] mb-3">
        {L.sections.notes}
      </h3>

      <div className="space-y-4">
        {/* Driver instructions — rendered FIRST because they're
            operationally load-bearing */}
        <section>
          <div className="flex items-center gap-2 mb-1.5">
            <Truck className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
            <h4 className="text-xs font-semibold text-[var(--t-text-primary)]">
              {L.fields.driverInstructionsHeading}
            </h4>
          </div>
          <p className="text-[10px] text-[var(--t-text-muted)] mb-2">
            {L.fields.driverInstructionsDescription}
          </p>
          {data.driverInstructions ? (
            <div
              className="rounded-[12px] border px-3 py-2.5 text-sm whitespace-pre-wrap"
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
            <p className="text-xs text-[var(--t-text-muted)] italic">
              {L.empty.noDriverInstructions}
            </p>
          )}
        </section>

        {/* Internal notes — existing timeline, office-only */}
        <section className="border-t border-[var(--t-border)] pt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
            <h4 className="text-xs font-semibold text-[var(--t-text-primary)]">
              {L.fields.internalNotesHeading}
            </h4>
          </div>
          <p className="text-[10px] text-[var(--t-text-muted)] mb-2">
            {L.fields.internalNotesDescription}
          </p>
          {data.internal.length === 0 ? (
            <p className="text-xs text-[var(--t-text-muted)] italic">
              {L.empty.noInternalNotes}
            </p>
          ) : (
            <div className="space-y-1.5">
              {data.internal.slice(0, 5).map((note) => (
                <div
                  key={note.id}
                  className="rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] px-3 py-2"
                >
                  <p className="text-xs text-[var(--t-text-primary)] whitespace-pre-wrap">
                    {note.content}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--t-text-muted)]">
                    {note.authorName || "—"} ·{" "}
                    {new Date(note.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
              {data.internal.length > 5 && (
                <p className="text-[10px] text-[var(--t-text-muted)] text-center pt-1">
                  {data.internal.length - 5} more in Advanced → Notes
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
