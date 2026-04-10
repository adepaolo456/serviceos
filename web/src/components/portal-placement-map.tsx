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
    <div className="rounded-[20px] border overflow-hidden" style={{ borderColor: saved ? "var(--t-accent)" : "var(--t-border)", background: "var(--t-bg-card)", transition: "border-color 0.3s" }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: saved ? "var(--t-accent-soft)" : "var(--t-bg-elevated, var(--t-bg-card))" }}>
            {saved ? <Check className="h-4 w-4" style={{ color: "var(--t-accent)" }} /> : <MapPin className="h-4 w-4" style={{ color: "var(--t-accent)" }} />}
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--t-text-primary)" }}>
              {hasExisting ? label("portal_placement_edit", "Edit Drop Location") : label("portal_placement_set", "Set Drop Location")}
            </p>
            <p className="text-[11px]" style={{ color: "var(--t-text-muted)" }}>
              {label("portal_placement_subtitle", "Show the driver exactly where to place it")}
            </p>
          </div>
        </div>
        {saved && (
          <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
            <Check className="h-3 w-3" /> {label("portal_placement_saved", "Saved")}
          </span>
        )}
      </div>

      {/* Map */}
      {!loaded ? (
        <div className="h-52 flex items-center justify-center" style={{ background: "var(--t-bg-elevated, var(--t-bg-card))", color: "var(--t-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div ref={mapContainer} className="h-52 w-full" style={{ borderTop: "1px solid var(--t-border)", borderBottom: "1px solid var(--t-border)" }} />
      )}

      {/* Controls */}
      {loaded && (
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
            {label("portal_placement_helper", "Drag the pin or tap the map to set where the dumpster should be placed.")}
          </p>
          <textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
            placeholder={label("portal_placement_notes_placeholder", "Notes for the driver (e.g., left side of driveway, behind garage)")}
            rows={2}
            className="w-full rounded-[14px] border px-4 py-2.5 text-sm outline-none resize-none focus:border-[var(--t-accent)]"
            style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input, var(--t-bg-card))" }}
          />
          <div className="flex items-center justify-between">
            <button
              onClick={handleSave}
              disabled={saving || (lat == null)}
              className="flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
              style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent, #fff)" }}
            >
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {label("portal_placement_saving", "Saving...")}</>
                : saved ? <><Check className="h-3.5 w-3.5" /> {label("portal_placement_saved", "Saved")}</>
                : <><Navigation className="h-3.5 w-3.5" /> {label("portal_placement_save", "Save Drop Location")}</>}
            </button>
            <p className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
              {label("portal_placement_editable_hint", "You can update this anytime before delivery")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
