import { Injectable, Logger } from '@nestjs/common';

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';

interface GeoResult {
  lat: number;
  lng: number;
  fullAddress: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface DriveResult {
  distance_miles: number;
  duration_minutes: number;
}

@Injectable()
export class MapboxService {
  private readonly logger = new Logger(MapboxService.name);

  private get token() {
    return MAPBOX_TOKEN;
  }

  /**
   * Forward geocode an address string → lat/lng.
   */
  async geocodeAddress(address: string): Promise<GeoResult | null> {
    if (!this.token || !address) return null;
    try {
      const params = new URLSearchParams({
        q: address,
        access_token: this.token,
        country: 'US',
        limit: '1',
        types: 'address',
        language: 'en',
      });
      const res = await fetch(
        `https://api.mapbox.com/search/geocode/v6/forward?${params}`,
      );
      if (!res.ok) {
        if (res.status === 401) this.logger.error('Mapbox token invalid');
        return null;
      }
      const data = await res.json();
      const f = data.features?.[0];
      if (!f) return null;

      const ctx = f.properties?.context || {};
      return {
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        fullAddress: f.properties?.full_address || address,
        city: ctx.place?.name,
        state: ctx.region?.region_code,
        zip: ctx.postcode?.name,
      };
    } catch (err) {
      this.logger.warn(`Geocode failed for "${address}": ${err}`);
      return null;
    }
  }

  /**
   * Reverse geocode lat/lng → address.
   */
  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<{ address: string; city: string; state: string; zip: string } | null> {
    if (!this.token) return null;
    try {
      const params = new URLSearchParams({
        longitude: String(lng),
        latitude: String(lat),
        access_token: this.token,
        types: 'address',
        limit: '1',
      });
      const res = await fetch(
        `https://api.mapbox.com/search/geocode/v6/reverse?${params}`,
      );
      if (!res.ok) return null;
      const data = await res.json();
      const f = data.features?.[0];
      if (!f) return null;

      const ctx = f.properties?.context || {};
      return {
        address: f.properties?.name || f.properties?.full_address || '',
        city: ctx.place?.name || '',
        state: ctx.region?.region_code || '',
        zip: ctx.postcode?.name || '',
      };
    } catch (err) {
      this.logger.warn(`Reverse geocode failed: ${err}`);
      return null;
    }
  }

  /**
   * Calculate driving distance and duration between two points.
   * Falls back to haversine if Mapbox fails.
   */
  async calculateDriveDistance(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ): Promise<DriveResult | null> {
    // Try Mapbox Directions API
    if (this.token) {
      try {
        const coords = `${originLng},${originLat};${destLng},${destLat}`;
        const res = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${this.token}&overview=false`,
        );
        if (res.ok) {
          const data = await res.json();
          const route = data.routes?.[0];
          if (route) {
            return {
              distance_miles:
                Math.round((route.distance / 1609.34) * 10) / 10,
              duration_minutes: Math.round((route.duration / 60) * 10) / 10,
            };
          }
        }
      } catch (err) {
        this.logger.warn(`Drive distance API failed, using haversine: ${err}`);
      }
    }

    // Fallback: haversine straight-line distance
    const miles = this.haversine(originLat, originLng, destLat, destLng);
    return {
      distance_miles: Math.round(miles * 10) / 10,
      duration_minutes: Math.round(miles * 2 * 10) / 10, // rough estimate: 30mph avg
    };
  }

  /**
   * Optimize a route: given stops, return optimal ordering.
   * First stop = origin (yard), last stop = return to yard.
   */
  async optimizeRoute(
    stops: { lat: number; lng: number; id: string }[],
  ): Promise<{
    optimized_order: string[];
    total_distance_miles: number;
    total_duration_minutes: number;
  } | null> {
    if (!this.token || stops.length < 2) return null;
    try {
      const coords = stops
        .map((s) => `${s.lng},${s.lat}`)
        .join(';');
      const res = await fetch(
        `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coords}?access_token=${this.token}&source=first&destination=last&roundtrip=false`,
      );
      if (!res.ok) return null;
      const data = await res.json();
      const trip = data.trips?.[0];
      if (!trip) return null;

      const waypoints = data.waypoints || [];
      const order = waypoints
        .sort(
          (a: { waypoint_index: number }, b: { waypoint_index: number }) =>
            a.waypoint_index - b.waypoint_index,
        )
        .map(
          (_: unknown, idx: number) =>
            stops[
              waypoints.find(
                (w: { waypoint_index: number }) => w.waypoint_index === idx,
              )?.original_index ?? idx
            ]?.id,
        )
        .filter(Boolean);

      return {
        optimized_order: order,
        total_distance_miles:
          Math.round((trip.distance / 1609.34) * 10) / 10,
        total_duration_minutes:
          Math.round((trip.duration / 60) * 10) / 10,
      };
    } catch (err) {
      this.logger.warn(`Route optimization failed: ${err}`);
      return null;
    }
  }

  /**
   * Haversine straight-line distance in miles (fallback).
   */
  haversine(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 3959;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
