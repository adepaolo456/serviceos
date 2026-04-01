"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Loader2 } from "lucide-react";

export interface AddressValue {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  formatted?: string;
}

interface Props {
  value?: Partial<AddressValue>;
  onChange: (address: AddressValue) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
// Bias toward Brockton MA
const PROXIMITY = "-71.0184,42.0834";

interface MapboxFeature {
  properties: {
    full_address?: string;
    name?: string;
    name_preferred?: string;
    context?: {
      place?: { name?: string };
      region?: { name?: string; region_code?: string };
      postcode?: { name?: string };
      district?: { name?: string };
      country?: { name?: string };
    };
  };
  geometry: {
    coordinates: [number, number]; // [lng, lat]
  };
}

function parseFeature(f: MapboxFeature): AddressValue {
  const ctx = f.properties.context || {};
  return {
    street: f.properties.name || f.properties.name_preferred || "",
    city: ctx.place?.name || "",
    state: ctx.region?.region_code || ctx.region?.name || "",
    zip: ctx.postcode?.name || "",
    lat: f.geometry.coordinates[1], // Mapbox: [lng, lat]
    lng: f.geometry.coordinates[0],
    formatted: f.properties.full_address || "",
  };
}

export default function AddressAutocomplete({
  value,
  onChange,
  placeholder = "Start typing an address...",
  label,
  className,
}: Props) {
  const [inputValue, setInputValue] = useState(
    value?.formatted ||
      [value?.street, value?.city, value?.state, value?.zip]
        .filter(Boolean)
        .join(", ") ||
      "",
  );
  const [suggestions, setSuggestions] = useState<MapboxFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch suggestions
  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!MAPBOX_TOKEN || query.length < 3) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: query,
          access_token: MAPBOX_TOKEN,
          country: "US",
          types: "address",
          limit: "5",
          proximity: PROXIMITY,
          language: "en",
        });
        const res = await fetch(
          `https://api.mapbox.com/search/geocode/v6/forward?${params}`,
        );
        const data = await res.json();
        const features: MapboxFeature[] = data.features || [];
        setSuggestions(features);
        setOpen(features.length > 0);
        setHighlightIdx(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounced input handler
  const handleInputChange = (text: string) => {
    setInputValue(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(text), 300);
  };

  // Select a suggestion
  const selectSuggestion = (feature: MapboxFeature) => {
    const parsed = parseFeature(feature);
    setInputValue(parsed.formatted || "");
    setSuggestions([]);
    setOpen(false);
    onChange(parsed);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1,
      );
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Click outside closes dropdown
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Sync external value changes
  useEffect(() => {
    if (value?.formatted) {
      setInputValue(value.formatted);
    } else if (value?.street) {
      setInputValue(
        [value.street, value.city, value.state, value.zip]
          .filter(Boolean)
          .join(", "),
      );
    }
  }, [value?.formatted, value?.street, value?.city, value?.state, value?.zip]);

  const inputClass =
    className ||
    "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] pl-10 pr-4 py-3 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";

  return (
    <div ref={containerRef}>
      {label && (
        <label className="block text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: "var(--t-text-muted)" }}>
          {label}
        </label>
      )}
      <div className="relative">
        {loading ? (
          <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin pointer-events-none" style={{ color: "var(--t-text-muted)" }} />
        ) : (
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 pointer-events-none" style={{ color: "var(--t-text-muted)" }} />
        )}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          className={inputClass}
          autoComplete="off"
        />

        {/* Suggestions dropdown */}
        {open && suggestions.length > 0 && (
          <div
            className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-[14px] border shadow-xl"
            style={{
              background: "var(--t-bg-secondary)",
              borderColor: "var(--t-border)",
              boxShadow: "0 20px 40px var(--t-shadow)",
            }}
          >
            {suggestions.map((feature, idx) => {
              const parsed = parseFeature(feature);
              const isHighlighted = idx === highlightIdx;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => selectSuggestion(feature)}
                  className="flex w-full flex-col px-4 py-2.5 text-left transition-colors"
                  style={{
                    background: isHighlighted
                      ? "var(--t-bg-card-hover)"
                      : "transparent",
                    borderTop:
                      idx > 0
                        ? "1px solid var(--t-border)"
                        : "none",
                  }}
                  onMouseEnter={() => setHighlightIdx(idx)}
                >
                  <span
                    className="text-sm font-medium"
                    style={{ color: "var(--t-text-primary)" }}
                  >
                    {parsed.street || feature.properties.full_address}
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {[parsed.city, parsed.state, parsed.zip]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </button>
              );
            })}
            <div
              className="px-4 py-1.5 text-right"
              style={{
                borderTop: "1px solid var(--t-border)",
                background: "var(--t-bg-elevated)",
              }}
            >
              <span
                className="text-[9px] font-medium uppercase tracking-wider"
                style={{ color: "var(--t-text-muted)" }}
              >
                Powered by Mapbox
              </span>
            </div>
          </div>
        )}

        {/* No results */}
        {open && suggestions.length === 0 && inputValue.length >= 3 && !loading && (
          <div
            className="absolute left-0 right-0 z-50 mt-1 rounded-[14px] border px-4 py-3 text-sm"
            style={{
              background: "var(--t-bg-secondary)",
              borderColor: "var(--t-border)",
              color: "var(--t-text-muted)",
            }}
          >
            No addresses found
          </div>
        )}
      </div>
      {!MAPBOX_TOKEN && (
        <p className="mt-1 text-[10px]" style={{ color: "var(--t-text-muted)" }}>
          Address autocomplete unavailable
        </p>
      )}
    </div>
  );
}
