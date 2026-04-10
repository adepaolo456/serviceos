"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { portalApi } from "@/lib/portal-api";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { MapPin, Check, Loader2 } from "lucide-react";
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

  const centerLat = serviceAddress?.lat ? Number(serviceAddress.lat) : 42.08;
  const centerLng = serviceAddress?.lng ? Number(serviceAddress.lng) : -71.02;

  // Fetch existing placement
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
        }
        if (data.placement_pin_notes) setNotes(data.placement_pin_notes);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [jobId]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN || !loaded) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [lng ?? centerLng, lat ?? centerLat],
      zoom: 17,
    });

    const marker = new mapboxgl.Marker({ draggable: true, color: "#22C55E" })
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
    } catch { /* silent */ }
    finally { setSaving(false); }
  }, [jobId, lat, lng, notes, saving]);

  if (!MAPBOX_TOKEN) return null;

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--t-border)" }}>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4" style={{ color: "var(--t-accent)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
            {lat != null ? label("portal_placement_edit", "Edit Drop Location") : label("portal_placement_set", "Set Drop Location")}
          </span>
        </div>
        {saved && <span className="text-xs font-medium" style={{ color: "var(--t-accent)" }}><Check className="h-3 w-3 inline mr-1" />Saved</span>}
      </div>

      {!loaded ? (
        <div className="h-48 flex items-center justify-center" style={{ color: "var(--t-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          <div ref={mapContainer} className="h-56 w-full" />
          <div className="px-4 py-3 space-y-3">
            <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
              {label("portal_placement_helper", "Drag the pin or tap the map to set where the dumpster should be placed.")}
            </p>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
              placeholder={label("portal_placement_notes_placeholder", "Notes for the driver (e.g., left side of driveway, behind garage)")}
              rows={2}
              className="w-full rounded-[12px] border px-3 py-2 text-xs outline-none resize-none"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input, var(--t-bg-card))" }}
            />
            <button
              onClick={handleSave}
              disabled={saving || (lat == null)}
              className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {saving ? label("portal_placement_saving", "Saving...") : label("portal_placement_save", "Save Drop Location")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
