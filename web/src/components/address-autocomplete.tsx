"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin } from "lucide-react";

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

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

let scriptLoaded = false;
let scriptLoading = false;
const callbacks: (() => void)[] = [];

function loadGoogleMaps(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  if (scriptLoading) return new Promise((resolve) => callbacks.push(resolve));

  scriptLoading = true;
  return new Promise((resolve) => {
    callbacks.push(resolve);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      callbacks.forEach((cb) => cb());
      callbacks.length = 0;
    };
    script.onerror = () => {
      scriptLoading = false;
    };
    document.head.appendChild(script);
  });
}

function parsePlace(place: google.maps.places.PlaceResult): AddressValue {
  const components = place.address_components || [];
  const get = (type: string) =>
    components.find((c) => c.types.includes(type))?.long_name || "";
  const getShort = (type: string) =>
    components.find((c) => c.types.includes(type))?.short_name || "";

  const streetNumber = get("street_number");
  const route = get("route");

  return {
    street: streetNumber ? `${streetNumber} ${route}` : route,
    city: get("locality") || get("sublocality_level_1") || get("administrative_area_level_2"),
    state: getShort("administrative_area_level_1"),
    zip: get("postal_code"),
    lat: place.geometry?.location?.lat() ?? null,
    lng: place.geometry?.location?.lng() ?? null,
    formatted: place.formatted_address || "",
  };
}

export default function AddressAutocomplete({
  value,
  onChange,
  placeholder = "Start typing an address...",
  label,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [inputValue, setInputValue] = useState(
    value?.formatted || [value?.street, value?.city, value?.state, value?.zip].filter(Boolean).join(", ") || ""
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;
    loadGoogleMaps().then(() => setReady(true));
  }, []);

  const initAutocomplete = useCallback(() => {
    if (!ready || !inputRef.current || autocompleteRef.current) return;

    const ac = new google.maps.places.Autocomplete(inputRef.current, {
      types: ["address"],
      componentRestrictions: { country: "us" },
      fields: ["address_components", "geometry", "formatted_address"],
    });

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place.address_components) return;
      const parsed = parsePlace(place);
      setInputValue(parsed.formatted || "");
      onChange(parsed);
    });

    autocompleteRef.current = ac;
  }, [ready, onChange]);

  useEffect(() => {
    initAutocomplete();
  }, [initAutocomplete]);

  const inputClass = className ||
    "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] pl-10 pr-4 py-3 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";

  return (
    <div>
      {label && (
        <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={placeholder}
          className={inputClass}
          autoComplete="off"
        />
      </div>
      {!GOOGLE_MAPS_KEY && (
        <p className="mt-1 text-[10px] text-muted">Address autocomplete unavailable</p>
      )}
    </div>
  );
}
