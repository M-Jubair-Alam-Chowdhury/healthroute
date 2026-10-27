/**
 * HealthAI Navigator — Hospital Map Module
 * Shared type definitions used by the module, the demo API and the UI.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Raw hospital record — this is the shape your database should send. */
export interface Hospital {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Optional enrichment fields — all have sensible fallbacks in the UI. */
  address?: string;
  department?: string;
  phone?: string;
  /** true → 24/7 emergency services (rendered with a red badge + marker). */
  isEmergency?: boolean;
  rating?: number;
  beds?: number;
}

/** Hospital enriched with straight-line distance from the user (computed by the module/API). */
export interface HospitalWithDistance extends Hospital {
  /** Straight-line (Haversine) distance in kilometres. */
  distanceKm: number;
}

export type TravelMode = "driving" | "walking" | "transit" | "bicycling";

/** Result of a routing request (Google Directions API or OSRM demo routing). */
export interface RouteResult {
  travelMode: TravelMode;
  /** Route distance in kilometres. */
  distanceKm: number;
  /** Estimated travel time in minutes. */
  durationMin: number;
  /** Ordered polyline of the route as [lat, lng] pairs. */
  coordinates: [number, number][];
  /** Where this route came from — surfaced in the UI so users know what to trust. */
  source: "google-directions" | "osrm" | "estimate";
}

/** Payload returned by GET /api/hospitals?lat=&lng=&limit= */
export interface HospitalsApiResponse {
  hospitals: HospitalWithDistance[];
  count: number;
  origin: LatLng;
  source: "mock-db" | "external";
}

export type MapProvider = "google" | "osm-demo";

export interface UserLocationState {
  position: LatLng | null;
  /** How the current position was resolved. */
  status: "idle" | "locating" | "granted" | "denied" | "fallback" | "manual";
  label: string;
}
