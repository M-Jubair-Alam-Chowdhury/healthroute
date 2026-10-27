/**
 * Geo helpers — Haversine distance, formatting and travel-time estimation.
 */
import type { LatLng, TravelMode } from "./types";

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two coordinates in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** "850 m" / "2.4 km" */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** "9 min" / "1 hr 25 min" */
export function formatDuration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

/** Average city speeds used when no routing engine is available. */
const MODE_SPEED_KMH: Record<TravelMode, number> = {
  driving: 24,
  walking: 4.8,
  bicycling: 15,
  transit: 22,
};

/** Transit overhead (waiting + transfers) added to the estimate, in minutes. */
const TRANSIT_OVERHEAD_MIN = 6;

/** Rough duration estimate from a straight-line distance (demo fallback only). */
export function estimateDurationMin(distanceKm: number, mode: TravelMode): number {
  const base = (distanceKm / MODE_SPEED_KMH[mode]) * 60;
  return mode === "transit" ? base + TRANSIT_OVERHEAD_MIN : base;
}

/** Free deep link that opens real Google Maps turn-by-turn navigation (no API key needed). */
export function googleDirectionsUrl(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode = "driving"
): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** OSRM public demo routing (no key, CORS-enabled) — used in Demo Mode. */
export function osrmRouteUrl(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode
): string {
  // The public OSRM demo server only exposes the driving profile; other
  // modes reuse the driving geometry and scale the duration estimate.
  const profile = "driving";
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  return `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false`;
}
