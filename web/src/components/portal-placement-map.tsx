"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { portalApi } from "@/lib/portal-api";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { MapPin, Check, Loader2, Navigation } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface Props {
  jobId: string;
  serviceAddress: { lat?: number; lng?: number; street?: string } | null;
}

export default function PortalPlacementMap({ jobId, serviceAddress }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  const centerLat = serviceAddress?.lat ? Number(serviceAddress.lat) : 42.08;
  const centerLng = serviceAddress?.lng ? Number(serviceAddress.lng) : -71.02;

  useEffect(() => {
    portalApi.get<{
      placement_lat: number | null;
      placement_lng: number | null;
      placement_pin_notes: string | null;
    }>(`/portal/jobs/${jobId}/placement`)
      .then((data) => {
        if (data.placement_lat != null && data.placement_lng != null) {
          setLat(data.placement_lat);
          setLng(data.placement_lng);
          setHasExisting(true);
          setSaved(true);
        }
        if (data.placement_pin_notes) setNotes(data.placement_pin_notes);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [jobId]);

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN || !loaded) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [lng ?? centerLng, lat ?? centerLat],
      zoom: 17.5,
      maxZoom: 18,
    });

    const marker = new mapboxgl.Marker({ draggable: true, color: "#FACC15", scale: 1.15 })
      .setLngLat([lng ?? centerLng, lat ?? centerLat])
      .addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLngLat();
      setLat(pos.lat);
      setLng(pos.lng);
      setSaved(false);
    });

    map.on("click", (e) => {
      marker.setLngLat(e.lngLat);
      setLat(e.lngLat.lat);
      setLng(e.lngLat.lng);
      setSaved(false);
    });

    mapRef.current = map;
    markerRef.current = marker;
    return () => { map.remove(); };
  }, [loaded]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await portalApi.patch(`/portal/jobs/${jobId}/placement`, {
        placement_lat: lat,
        placement_lng: lng,
        placement_pin_notes: notes || null,
      });
      setSaved(true);
      setHasExisting(true);
    } catch { /* silent */ }
    finally { setSaving(false); }
  }, [jobId, lat, lng, notes, saving]);

  if (!MAPBOX_TOKEN) return null;

  return (
    <div
      className="rounded-[24px] overflow-hidden"
      style={{
        border: `2px solid ${saved ? "var(--t-accent)" : "var(--t-border)"}`,
        background: "var(--t-bg-card)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        transition: "border-color 0.3s",
      }}
    >
      {/* Header — Phase B10: tighter mobile padding, saved pill wraps beneath title block */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: saved ? "var(--t-accent)" : "var(--t-accent-soft)" }}
            >
              {saved
                ? <Check className="h-5 w-5" style={{ color: "var(--t-accent-on-accent, #fff)" }} />
                : <MapPin className="h-5 w-5" style={{ color: "var(--t-accent)" }} />}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold truncate" style={{ color: "var(--t-text-primary)" }}>
                {label("portal_placement_title", "Drop Location")}
              </h3>
              <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--t-text-muted)" }}>
                {label("portal_placement_subtitle", "Choose exactly where you want the dumpster placed")}
              </p>
            </div>
          </div>
          {saved && (
            <span
              className="flex shrink-0 items-center gap-1.5 text-[10px] sm:text-xs font-bold px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full"
              style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent, #fff)" }}
            >
              <Check className="h-3.5 w-3.5" /> {label("portal_placement_saved", "Saved")}
            </span>
          )}
        </div>
      </div>

      {/* Map — dominant, shorter on mobile for better scroll balance */}
      {!loaded ? (
        <div className="h-64 sm:h-96 flex items-center justify-center" style={{ background: "#1a1a2e", color: "var(--t-text-muted)" }}>
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div ref={mapContainer} className="h-64 sm:h-96 w-full" />
      )}

      {/* Controls */}
      {loaded && (
        <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">
          <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--t-text-muted)" }}>
            {label("portal_placement_helper", "Drag the pin or tap the map to set where the dumpster should be placed.")}
          </p>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--t-text-primary)" }}>
              {label("portal_placement_notes_label", "Notes for the driver")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
              placeholder={label("portal_placement_notes_placeholder", "e.g., left side of driveway, behind garage, near the fence")}
              rows={2}
              className="w-full rounded-[16px] border px-3 sm:px-4 py-2.5 sm:py-3 text-sm outline-none resize-none focus:border-[var(--t-accent)] transition-colors"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input, var(--t-bg-card))" }}
            />
          </div>

          {/* Save action — Phase B10: stacks on mobile, inline on desktop */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <button
              onClick={handleSave}
              disabled={saving || (lat == null)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-full px-5 sm:px-6 py-3 text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-all active:scale-[0.98]"
              style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent, #fff)" }}
            >
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> {label("portal_placement_saving", "Saving...")}</>
                : saved ? <><Check className="h-4 w-4" /> {label("portal_placement_saved_cta", "Drop Location Saved")}</>
                : <><Navigation className="h-4 w-4" /> {label("portal_placement_save", "Save Drop Location")}</>}
            </button>
            <p className="text-[11px] text-center sm:text-right leading-snug" style={{ color: "var(--t-text-muted)" }}>
              {label("portal_placement_editable_hint", "You can update this anytime before delivery")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
