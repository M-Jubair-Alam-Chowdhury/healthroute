/**
 * Route service — resolves a route between the user and a hospital.
 *
 * Priority:
 *   1. Google Directions API (when a Google Maps key is active)
 *   2. OSRM public routing API (no key — powers Demo Mode)
 *   3. Straight-line estimate (last-resort offline fallback)
 */
import {
  estimateDurationMin,
  haversineKm,
  osrmRouteUrl,
} from "@/lib/geo";
import type { LatLng, RouteResult, TravelMode } from "@/lib/types";

function googleTravelMode(mode: TravelMode): google.maps.TravelMode {
  switch (mode) {
    case "driving":
      return google.maps.TravelMode.DRIVING;
    case "walking":
      return google.maps.TravelMode.WALKING;
    case "transit":
      return google.maps.TravelMode.TRANSIT;
    case "bicycling":
      return google.maps.TravelMode.BICYCLING;
  }
}

async function routeWithGoogle(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode
): Promise<RouteResult | null> {
  if (typeof window === "undefined" || !window.google?.maps) return null;
  try {
    const service = new window.google.maps.DirectionsService();
    const result = await service.route({
      origin,
      destination,
      travelMode: googleTravelMode(mode),
    });
    const route = result.routes[0];
    const leg = route.legs[0];
    if (!route.overview_path || !leg?.distance || !leg.duration) return null;
    return {
      travelMode: mode,
      distanceKm: leg.distance.value / 1000,
      durationMin: leg.duration.value / 60,
      coordinates: route.overview_path.map((p) => [p.lat(), p.lng()] as [number, number]),
      source: "google-directions",
    };
  } catch {
    return null; // fall through to OSRM
  }
}

async function routeWithOsrm(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode
): Promise<RouteResult | null> {
  try {
    const response = await fetch(osrmRouteUrl(origin, destination, mode));
    if (!response.ok) return null;
    const data = await response.json();
    if (data.code !== "Ok" || !data.routes?.[0]) return null;

    const osrmRoute = data.routes[0];
    const distanceKm = osrmRoute.distance / 1000;
    // The OSRM demo server only runs the driving profile; scale durations
    // for the other travel modes so the demo still feels realistic.
    const durationMin =
      mode === "driving" ? osrmRoute.duration / 60 : estimateDurationMin(distanceKm, mode);

    return {
      travelMode: mode,
      distanceKm,
      durationMin,
      coordinates: osrmRoute.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
      ),
      source: "osrm",
    };
  } catch {
    return null;
  }
}

export async function fetchRoute(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode,
  googleEnabled: boolean
): Promise<RouteResult> {
  if (googleEnabled) {
    const googleRoute = await routeWithGoogle(origin, destination, mode);
    if (googleRoute) return googleRoute;
  }

  const osrmRoute = await routeWithOsrm(origin, destination, mode);
  if (osrmRoute) return osrmRoute;

  // Offline / blocked-network fallback: straight line + speed estimate.
  const distanceKm = haversineKm(origin, destination);
  return {
    travelMode: mode,
    distanceKm,
    durationMin: estimateDurationMin(distanceKm, mode),
    coordinates: [
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ],
    source: "estimate",
  };
}
