/**
 * Shared coordinate validation helpers.
 * Used across pricing, jobs, geocoding, and backfill flows.
 */

/**
 * Returns true if lat/lng represent a valid, usable coordinate pair.
 * Rejects: null, undefined, NaN, out-of-range, and (0,0) which is
 * the Gulf of Guinea — never a valid service address for this system.
 */
export function isValidCoordinatePair(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  if (lat == null || lng == null) return false;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/**
 * Checks whether a JSONB address record (as stored on jobs/customers)
 * contains valid, usable service coordinates.
 */
export function hasValidServiceCoordinates(
  address: Record<string, unknown> | null | undefined,
): boolean {
  if (!address) return false;
  return isValidCoordinatePair(
    address.lat != null ? Number(address.lat) : null,
    address.lng != null ? Number(address.lng) : null,
  );
}

/**
 * Extracts lat/lng from a JSONB address object.
 * Returns null if coordinates are missing or invalid.
 */
export function extractCoordinates(
  address: Record<string, unknown> | null | undefined,
): { lat: number; lng: number } | null {
  if (!address) return null;
  const lat = address.lat != null ? Number(address.lat) : null;
  const lng = address.lng != null ? Number(address.lng) : null;
  if (!isValidCoordinatePair(lat, lng)) return null;
  return { lat: lat!, lng: lng! };
}

/**
 * Builds a full address string from a JSONB address object for geocoding.
 */
export function buildAddressString(
  address: Record<string, unknown> | null | undefined,
): string | null {
  if (!address) return null;
  const parts = [address.street, address.city, address.state, address.zip].filter(Boolean);
  return parts.length >= 2 ? parts.join(', ') : null;
}

/** Geocode metadata shape for auditing and tracking */
export interface GeocodeMetadata {
  geocoded_at: string;
  geocode_source: 'stored' | 'mapbox' | 'manual';
  geocode_status: 'valid' | 'geocoded' | 'failed' | 'invalid';
  geocode_confidence?: string;
  geocode_error?: string;
  coordinates_verified: boolean;
}
