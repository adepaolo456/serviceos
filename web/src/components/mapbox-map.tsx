"use client";

import { useRef, useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useTheme } from "@/components/theme-provider";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const DEFAULT_CENTER: [number, number] = [-71.0184, 42.0834]; // Brockton MA
const DEFAULT_ZOOM = 10;

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  type?: "drop_off" | "pick_up" | "exchange" | "relocate" | "dump_and_return" | "yard" | "asset" | "customer" | "delivery" | "pickup" | "dump_run";
  status?: "scheduled" | "in_progress" | "completed" | "cancelled";
  popupContent?: {
    title: string;
    subtitle?: string;
    details?: { label: string; value: string }[];
    actionLabel?: string;
    actionUrl?: string;
  };
}

export interface MapboxMapProps {
  markers?: MapMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  style?: React.CSSProperties;
  onMarkerClick?: (marker: MapMarker) => void;
  fitBounds?: boolean;
  interactive?: boolean;
  showControls?: boolean;
  showYardPin?: { lat: number; lng: number; label?: string };
}

const TYPE_COLORS: Record<string, string> = {
  drop_off: "#22C55E",
  delivery: "#22C55E",
  pick_up: "#EF4444",
  pickup: "#EF4444",
  exchange: "#F59E0B",
  relocate: "#8B5CF6",
  dump_and_return: "#6366F1",
  dump_run: "#6366F1",
  yard: "#22C55E",
  asset: "#3B82F6",
  customer: "#22C55E",
};

const STATUS_OVERRIDES: Record<string, string> = {
  in_progress: "#3B82F6",
  completed: "#6B7280",
  cancelled: "#9CA3AF",
};

const STYLES = {
  dark: "mapbox://styles/mapbox/dark-v11",
  light: "mapbox://styles/mapbox/light-v11",
};

export default function MapboxMap({
  markers = [],
  center,
  zoom = DEFAULT_ZOOM,
  className = "",
  style,
  onMarkerClick,
  fitBounds = true,
  interactive = true,
  showControls = true,
  showYardPin,
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const mapCenter: [number, number] = center
      ? [center.lng, center.lat]
      : DEFAULT_CENTER;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLES[theme] || STYLES.dark,
      center: mapCenter,
      zoom,
      interactive,
      attributionControl: false,
    });

    if (showControls && interactive) {
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    }

    map.on("load", () => setReady(true));

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme switch
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(STYLES[theme] || STYLES.dark);
  }, [theme]);

  // Update markers
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Yard pin
    if (showYardPin) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:34px;height:34px;border-radius:50%;background:#3B82F6;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);";
      el.textContent = "🏠";
      const m = new mapboxgl.Marker(el)
        .setLngLat([showYardPin.lng, showYardPin.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setHTML(
            `<strong>${showYardPin.label || "Yard"}</strong>`,
          ),
        )
        .addTo(mapRef.current);
      markersRef.current.push(m);
    }

    // Data markers
    const bounds = new mapboxgl.LngLatBounds();
    let hasValidBounds = false;

    for (const marker of markers) {
      if (!marker.lat || !marker.lng) continue;

      const color =
        (marker.status && STATUS_OVERRIDES[marker.status]) ||
        marker.color ||
        (marker.type && TYPE_COLORS[marker.type]) ||
        "#22C55E";

      const size = marker.type === "yard" ? 34 : 30;

      const el = document.createElement("div");
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:transform 0.15s;`;
      el.textContent = marker.label || "";

      if (marker.status === "in_progress") {
        el.style.animation = "mapPulse 1.5s ease infinite";
      }

      el.addEventListener("mouseenter", () => {
        el.style.transform = "scale(1.15)";
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "scale(1)";
      });

      // Popup
      let popup: mapboxgl.Popup | undefined;
      if (marker.popupContent) {
        const pc = marker.popupContent;

        let html = `<div style="font-family:system-ui,-apple-system,sans-serif;padding:8px 4px;min-width:160px;background:var(--t-bg-elevated);color:var(--t-text-primary)">`;
        html += `<strong style="font-size:14px">${pc.title}</strong>`;
        if (pc.subtitle)
          html += `<br><span style="font-size:12px;color:var(--t-text-muted)">${pc.subtitle}</span>`;
        if (pc.details?.length) {
          html += '<div style="margin-top:8px;font-size:12px">';
          for (const d of pc.details) {
            html += `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0"><span style="color:var(--t-text-muted)">${d.label}</span><span style="font-weight:500">${d.value}</span></div>`;
          }
          html += "</div>";
        }
        if (pc.actionLabel && pc.actionUrl) {
          html += `<a href="${pc.actionUrl}" style="display:inline-block;margin-top:8px;font-size:12px;color:var(--t-accent);text-decoration:none;font-weight:600">${pc.actionLabel} →</a>`;
        }
        html += "</div>";

        popup = new mapboxgl.Popup({
          offset: 12,
          closeButton: false,
          maxWidth: "280px",
        }).setHTML(html);
      }

      const m = new mapboxgl.Marker(el)
        .setLngLat([marker.lng, marker.lat])
        .addTo(mapRef.current!);

      if (popup) m.setPopup(popup);

      if (onMarkerClick) {
        el.addEventListener("click", () => onMarkerClick(marker));
      }

      markersRef.current.push(m);
      bounds.extend([marker.lng, marker.lat]);
      hasValidBounds = true;
    }

    if (showYardPin) {
      bounds.extend([showYardPin.lng, showYardPin.lat]);
      hasValidBounds = true;
    }

    // Fit bounds
    if (fitBounds && hasValidBounds && markers.length > 0) {
      mapRef.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 14,
        duration: 500,
      });
    }
  }, [markers, showYardPin, theme, fitBounds, onMarkerClick]);

  if (!MAPBOX_TOKEN) {
    return (
      <div
        className={className}
        style={{
          ...style,
          background: "var(--t-bg-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--t-text-muted)",
          fontSize: 13,
          borderRadius: 20,
        }}
      >
        Map unavailable — Mapbox token not configured
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes mapPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); }
          50% { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
        }
        .mapboxgl-popup-content {
          background: var(--t-bg-elevated) !important;
          border-radius: 12px !important;
          padding: 8px 12px !important;
          box-shadow: 0 4px 20px var(--t-shadow) !important;
          border: 1px solid var(--t-border) !important;
        }
        .mapboxgl-popup-tip {
          border-top-color: var(--t-bg-elevated) !important;
        }
        .mapboxgl-popup-close-button { color: var(--t-text-muted) !important; }
      `}</style>
      <div
        ref={containerRef}
        className={className}
        style={{ borderRadius: 20, overflow: "hidden", ...style }}
      />
    </>
  );
}
