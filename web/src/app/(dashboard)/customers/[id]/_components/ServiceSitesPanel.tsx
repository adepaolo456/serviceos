"use client";

import { MapPin } from "lucide-react";
import MapboxMap from "@/components/mapbox-map";
import { CUSTOMER_DASHBOARD_LABELS } from "@/lib/customer-dashboard-labels";
import type {
  DashboardServiceSite,
  DashboardServiceSitesState,
} from "@/lib/customer-dashboard-types";

/**
 * Service sites panel — primary address + saved sites, each with a
 * geocode health badge. Map preview (existing MapboxMap component)
 * renders pins for any sites with valid coordinates.
 *
 * The interactive drop-pin feature is explicitly out of scope per the
 * pass brief; this component only renders the placeholder read-only map.
 */
export default function ServiceSitesPanel({
  data,
}: {
  data: DashboardServiceSitesState;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS;
  const sites = data.all;

  const mapPins = sites
    .filter((s) => s.hasCoordinates && s.address.lat && s.address.lng)
    .map((s, i) => ({
      id: `svc-${i}`,
      lat: Number(s.address.lat),
      lng: Number(s.address.lng),
      type: "customer" as const,
      label: String(i + 1),
      popupContent: {
        title: s.address.street || L.fields.savedSite,
        subtitle: [s.address.city, s.address.state, s.address.zip]
          .filter(Boolean)
          .join(", "),
      },
    }));

  // Show map only for multi-site customers. A single-site map is a
  // redundant pin for the address rendered immediately below it.
  const showMap = sites.length >= 2 && mapPins.length > 0;

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)] mb-2">
        {L.sections.serviceSites}
      </h3>

      {sites.length === 0 ? (
        <p className="py-2 text-xs text-[var(--t-text-muted)]">
          {L.empty.noServiceSites}
        </p>
      ) : (
        <>
          {showMap && (
            <div className="mb-2">
              <MapboxMap
                markers={mapPins}
                style={{ height: 120, width: "100%" }}
                interactive={false}
                showControls={false}
              />
            </div>
          )}

          <div className="space-y-1.5">
            {sites.map((site, idx) => (
              <SiteRow
                key={`site-${idx}`}
                site={site}
                isPrimary={idx === 0}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SiteRow({
  site,
  isPrimary,
}: {
  site: DashboardServiceSite;
  isPrimary: boolean;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS;
  const addr = site.address;
  const line1 = addr.street || "—";
  const line2 = [addr.city, addr.state, addr.zip].filter(Boolean).join(", ");

  return (
    <div className="flex items-start justify-between gap-2 rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] px-2.5 py-1.5">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--t-text-muted)]" />
        <div className="min-w-0">
          <p className="text-xs text-[var(--t-text-primary)] truncate">
            {line1}
          </p>
          <p className="text-[10px] text-[var(--t-text-muted)] truncate">
            {line2 || "—"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {isPrimary && (
          <span className="rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--t-text-primary)]">
            {L.fields.primary}
          </span>
        )}
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            color: site.hasCoordinates
              ? "var(--t-accent)"
              : "var(--t-warning)",
            background: site.hasCoordinates
              ? "var(--t-accent-soft, rgba(34,197,94,0.08))"
              : "var(--t-warning-soft, rgba(234,179,8,0.08))",
          }}
        >
          {site.hasCoordinates
            ? L.fields.verified
            : L.fields.needsVerification}
        </span>
      </div>
    </div>
  );
}
