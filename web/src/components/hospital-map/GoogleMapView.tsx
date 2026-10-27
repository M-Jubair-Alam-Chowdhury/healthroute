"use client";

/**
 * GoogleMapView — the production renderer used when a Google Maps API key
 * is provided (via the `apiKey` prop or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
 *
 * Implements the same contract as LeafletMapView so HospitalMapModule can
 * swap providers transparently:
 *   - numbered hospital markers (red = 24/7 emergency)
 *   - pulsing user-location dot
 *   - route polyline drawn from the shared RouteResult
 *   - click-to-select, fit-bounds and fly-to-user behaviour
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useGoogleMaps } from "./useGoogleMaps";
import type { MapHandle, MapRendererProps } from "./LeafletMapView";
import type { HospitalWithDistance } from "@/lib/types";

/** Teal accent used for routes/selection so brand colours stay consistent. */
const ROUTE_COLOR = "#0d9488";
const EMERGENCY_COLOR = "#dc2626";
const STANDARD_COLOR = "#0f766e";

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  {
    featureType: "poi.medical",
    elementType: "labels",
    stylers: [{ visibility: "on" }, { color: "#b91c1c" }],
  },
  {
    featureType: "transit.station.bus",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
];

/** Numbered circular marker as an SVG data-URL. */
function markerIcon(rank: number, emergency: boolean, selected: boolean): google.maps.Icon {
  const color = emergency ? EMERGENCY_COLOR : STANDARD_COLOR;
  const r = selected ? 17 : 15;
  const halo = selected
    ? `<circle cx="18" cy="18" r="19.5" fill="${color}" fill-opacity="0.22"/>` +
      `<circle cx="18" cy="18" r="17.5" fill="none" stroke="${color}" stroke-width="1.5"/>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 36 36">` +
    `${halo}<circle cx="18" cy="18" r="${r}" fill="${color}" stroke="#ffffff" stroke-width="3"/>` +
    `<text x="18" y="23" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${rank}</text>` +
    `</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    size: new google.maps.Size(40, 40),
    origin: new google.maps.Point(0, 0),
    anchor: new google.maps.Point(20, 20),
  };
}

export const GoogleMapView = forwardRef<MapHandle, MapRendererProps & { apiKey: string }>(
  function GoogleMapView({ apiKey, userLocation, hospitals, selectedId, route, onSelectHospital, onMapClick }, ref) {
    const { ready, error } = useGoogleMaps(apiKey);
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.Map | null>(null);
    const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
    const userMarkerRef = useRef<google.maps.Marker | null>(null);
    const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
    const routeLinesRef = useRef<google.maps.Polyline[]>([]);
    const [mapInit, setMapInit] = useState(false);

    /* ------------------------------------------------------------ init */
    useEffect(() => {
      if (!ready || !containerRef.current || mapRef.current) return;
      const map = new google.maps.Map(containerRef.current, {
        center: userLocation,
        zoom: 13,
        clickableIcons: false,
        styles: MAP_STYLES,
        mapTypeControl: false,
        streetViewControl: false,
        // The module ships its own app-style fullscreen (map + sidebar + route
        // panel together), so Google's canvas-only control stays off.
        fullscreenControl: false,
      });
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (e.latLng) onMapClick?.({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
      mapRef.current = map;
      infoWindowRef.current = new google.maps.InfoWindow();
      // Flag readiness outside the synchronous effect body (React compiler rule).
      const timer = setTimeout(() => setMapInit(true), 0);
      return () => clearTimeout(timer);
    }, [ready]);

    /* ------------------------------------------------------- user marker */
    useEffect(() => {
      const map = mapRef.current;
      if (!mapInit || !map) return;

      if (!userMarkerRef.current) {
        userMarkerRef.current = new google.maps.Marker({
          position: userLocation,
          map,
          zIndex: 1000,
          title: "Your location",
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: "#2563eb",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
        });
      } else {
        userMarkerRef.current.setPosition(userLocation);
      }
    }, [mapInit, userLocation]);

    /* --------------------------------------------------- hospital markers */
    useEffect(() => {
      const map = mapRef.current;
      if (!mapInit || !map) return;

      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();

      hospitals.forEach((h, index) => {
        const marker = new google.maps.Marker({
          position: { lat: h.latitude, lng: h.longitude },
          map,
          title: h.name,
          zIndex: h.id === selectedId ? 800 : 10 + hospitals.length - index,
          icon: markerIcon(index + 1, Boolean(h.isEmergency), h.id === selectedId),
        });
        marker.addListener("click", () => onSelectHospital(h.id));
        markersRef.current.set(h.id, marker);
      });

      if (hospitals.length > 0) {
        const bounds = new google.maps.LatLngBounds();
        hospitals.forEach((h) => bounds.extend({ lat: h.latitude, lng: h.longitude }));
        bounds.extend(userLocation);
        map.fitBounds(bounds, 56);
      }
       
    }, [mapInit, hospitals]);

    /* ------------------------------------------- selection + route view */
    useEffect(() => {
      const map = mapRef.current;
      const infoWindow = infoWindowRef.current;
      if (!mapInit || !map) return;

      // Re-style markers for the current selection.
      hospitals.forEach((h, index) => {
        const marker = markersRef.current.get(h.id);
        if (!marker) return;
        const selected = h.id === selectedId;
        marker.setIcon(markerIcon(index + 1, Boolean(h.isEmergency), selected));
        marker.setZIndex(selected ? 800 : 10 + hospitals.length - index);
      });

      // Show a compact info window for the selected hospital.
      if (infoWindow) {
        if (selectedId) {
          const h: HospitalWithDistance | undefined = hospitals.find((x) => x.id === selectedId);
          const marker = h ? markersRef.current.get(h.id) : undefined;
          if (h && marker) {
            const emergency = h.isEmergency ? '<span style="background:#dc2626;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:700;margin-left:6px">24/7</span>' : "";
            infoWindow.setContent(
              `<div style="font-family:inherit;min-width:180px;max-width:260px">` +
              `<div style="font-weight:700;color:#0f172a;margin-bottom:2px">${h.name}${emergency}</div>` +
              `<div style="font-size:12px;color:#475569">${h.department ?? "Hospital"} · ${h.distanceKm.toFixed(1)} km away</div>` +
              (h.phone ? `<div style="font-size:12px;margin-top:4px"><a href="tel:${h.phone}" style="color:#0d9488;font-weight:600">${h.phone}</a></div>` : "") +
              `</div>`
            );
            infoWindow.open({ map, anchor: marker });
          }
        } else {
          infoWindow.close();
        }
      }

      // Frame user + selected (+ route) without zooming in too far.
      if (selectedId) {
        const h = hospitals.find((x) => x.id === selectedId);
        if (h) {
          const bounds = new google.maps.LatLngBounds();
          bounds.extend(userLocation);
          bounds.extend({ lat: h.latitude, lng: h.longitude });
          if (route) route.coordinates.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
          map.fitBounds(bounds, 64);
        }
      }
    }, [mapInit, selectedId, route, hospitals, userLocation]);

    /* -------------------------------------------------------- route line */
    useEffect(() => {
      const map = mapRef.current;
      if (!mapInit || !map) return;

      routeLinesRef.current.forEach((l) => l.setMap(null));
      routeLinesRef.current = [];

      if (route && route.coordinates.length > 1) {
        const path = route.coordinates.map(([lat, lng]) => ({ lat, lng }));
        const casing = new google.maps.Polyline({
          path,
          map,
          strokeColor: "#ffffff",
          strokeWeight: 9,
          strokeOpacity: 0.9,
          clickable: false,
          zIndex: 1,
        });
        const line = new google.maps.Polyline({
          path,
          map,
          strokeColor: ROUTE_COLOR,
          strokeWeight: 5,
          strokeOpacity: 0.95,
          clickable: false,
          zIndex: 2,
        });
        routeLinesRef.current = [casing, line];
      }
    }, [mapInit, route]);

    /* -------------------------------------------------------- map handle */
    useImperativeHandle(ref, () => ({
      flyToUser: () => {
        mapRef.current?.panTo(userLocation);
        mapRef.current?.setZoom(14);
      },
      fitAll: () => {
        const map = mapRef.current;
        if (!map || hospitals.length === 0) return;
        const bounds = new google.maps.LatLngBounds();
        hospitals.forEach((h) => bounds.extend({ lat: h.latitude, lng: h.longitude }));
        bounds.extend(userLocation);
        map.fitBounds(bounds, 56);
      },
    }));

    if (error) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-muted p-6 text-center">
          <p className="text-sm text-destructive">
            Google Maps failed to load: {error}
            <br />
            <span className="text-muted-foreground">
              Check the API key and that Maps JavaScript API is enabled.
            </span>
          </p>
        </div>
      );
    }

    if (!ready) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
            <p className="text-sm">Loading Google Maps…</p>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label="Interactive hospital map (Google Maps)"
      />
    );
  }
);
