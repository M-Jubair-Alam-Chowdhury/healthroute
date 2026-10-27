"use client";

/**
 * LeafletMapView — the zero-config "Demo Mode" renderer.
 *
 * Used automatically when no Google Maps API key is configured. Renders
 * OpenStreetMap tiles and lets the rest of the module behave identically
 * (markers, selection, routing, fit-bounds) so the demo works out of the box
 * and can be swapped to Google Maps in production by adding one env var.
 */
import "leaflet/dist/leaflet.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker, Polyline as LeafletPolyline } from "leaflet";
import type { LatLng, HospitalWithDistance, RouteResult } from "@/lib/types";

export interface MapHandle {
  flyToUser: () => void;
  fitAll: () => void;
}

export interface MapRendererProps {
  userLocation: LatLng;
  hospitals: HospitalWithDistance[];
  selectedId: string | null;
  route: RouteResult | null;
  onSelectHospital: (id: string) => void;
  onMapClick?: (position: LatLng) => void;
}

export const LeafletMapView = forwardRef<MapHandle, MapRendererProps>(
  function LeafletMapView({ userLocation, hospitals, selectedId, route, onSelectHospital, onMapClick }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LeafletMap | null>(null);
    const leafletRef = useRef<typeof import("leaflet") | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const markersRef = useRef<Map<string, LeafletMarker>>(new Map());
    const userMarkerRef = useRef<LeafletMarker | null>(null);
    const routeLinesRef = useRef<LeafletPolyline[]>([]);
    const clickCbRef = useRef(onMapClick);
    const selectCbRef = useRef(onSelectHospital);
    const [ready, setReady] = useState(false);

    clickCbRef.current = onMapClick;
    selectCbRef.current = onSelectHospital;

    /* ---------------------------------------------------------- init once */
    useEffect(() => {
      let cancelled = false;
      (async () => {
        const L = await import("leaflet");
        if (cancelled || !containerRef.current || mapRef.current) return;
        leafletRef.current = L;

        const map = L.map(containerRef.current, {
          center: [userLocation.lat, userLocation.lng],
          zoom: 13,
          zoomControl: true,
          attributionControl: true,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        }).addTo(map);

        map.on("click", (e) => {
          clickCbRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
        });

        mapRef.current = map;

        // Keep the map correctly sized whenever its container changes size
        // (fullscreen toggles, Map/List view switches, window resizes) —
        // without this, tiles and markers misalign after a resize.
        const ro = new ResizeObserver(() => {
          const el = containerRef.current;
          if (!el || (el.offsetWidth === 0 && el.offsetHeight === 0)) return; // container hidden
          mapRef.current?.invalidateSize();
        });
        ro.observe(containerRef.current);
        resizeObserverRef.current = ro;

        setReady(true);
      })();

      return () => {
        cancelled = true;
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;
        mapRef.current?.remove();
        mapRef.current = null;
        markersRef.current.clear();
        userMarkerRef.current = null;
        routeLinesRef.current = [];
      };
       
    }, []);

    /* ------------------------------------------------------- user marker */
    useEffect(() => {
      const L = leafletRef.current;
      const map = mapRef.current;
      if (!ready || !L || !map) return;

      const icon = L.divIcon({
        className: "hm-user-wrapper",
        html: `<div class="hm-user-dot"><span class="hm-user-dot__pulse"></span></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      if (!userMarkerRef.current) {
        userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
          icon,
          zIndexOffset: 1000,
          keyboard: false,
          interactive: false,
        }).addTo(map);
      } else {
        userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      }
    }, [ready, userLocation]);

    /* --------------------------------------------------- hospital markers */
    useEffect(() => {
      const L = leafletRef.current;
      const map = mapRef.current;
      if (!ready || !L || !map) return;

      // Recreate markers whenever the result set changes (e.g. new location).
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();

      hospitals.forEach((h, index) => {
        const selected = h.id === selectedId;
        const html =
          `<div class="hm-pin${h.isEmergency ? " hm-pin--emergency" : ""}${selected ? " hm-pin--selected" : ""}">` +
          `<span>${index + 1}</span></div>`;
        const marker = L.marker([h.latitude, h.longitude], {
          icon: L.divIcon({
            className: "hm-pin-wrapper",
            html,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          }),
          title: h.name,
          riseOnHover: true,
          zIndexOffset: selected ? 800 : 0,
        });
        marker.bindTooltip(h.name, { direction: "top", offset: [0, -14] });
        marker.on("click", () => selectCbRef.current(h.id));
        marker.addTo(map);
        markersRef.current.set(h.id, marker);
      });

      // Frame everything on first render of a result set.
      if (hospitals.length > 0) {
        const points = hospitals.map((h) => [h.latitude, h.longitude] as [number, number]);
        points.push([userLocation.lat, userLocation.lng]);
        map.fitBounds(L.latLngBounds(points), {
          paddingTopLeft: [48, 88],
          paddingBottomRight: [48, 48],
          maxZoom: 14,
          animate: true,
        });
      }
       
    }, [ready, hospitals]);

    /* ------------------------------------------------- highlight selected */
    useEffect(() => {
      const L = leafletRef.current;
      const map = mapRef.current;
      if (!ready || !L || !map) return;

      hospitals.forEach((h, index) => {
        const marker = markersRef.current.get(h.id);
        if (!marker) return;
        const selected = h.id === selectedId;
        const html =
          `<div class="hm-pin${h.isEmergency ? " hm-pin--emergency" : ""}${selected ? " hm-pin--selected" : ""}">` +
          `<span>${index + 1}</span></div>`;
        marker.setIcon(
          L.divIcon({
            className: "hm-pin-wrapper",
            html,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          })
        );
        marker.setZIndexOffset(selected ? 800 : 0);
      });

      if (selectedId) {
        const h = hospitals.find((x) => x.id === selectedId);
        if (h) {
          const points: [number, number][] = [
            [userLocation.lat, userLocation.lng],
            [h.latitude, h.longitude],
          ];
          if (route) points.push(...route.coordinates);
          map.fitBounds(L.latLngBounds(points), {
            paddingTopLeft: [48, 88],
            paddingBottomRight: [48, 200],
            maxZoom: 15,
            animate: true,
          });
        }
      }
    }, [ready, selectedId, route, hospitals, userLocation]);

    /* -------------------------------------------------------- route line */
    useEffect(() => {
      const L = leafletRef.current;
      const map = mapRef.current;
      if (!ready || !L || !map) return;

      routeLinesRef.current.forEach((l) => l.remove());
      routeLinesRef.current = [];

      if (route && route.coordinates.length > 1) {
        const casing = L.polyline(route.coordinates, {
          color: "#ffffff",
          weight: 9,
          opacity: 0.9,
          interactive: false,
        }).addTo(map);
        const line = L.polyline(route.coordinates, {
          color: "#0d9488",
          weight: 5,
          opacity: 0.95,
          interactive: false,
        }).addTo(map);
        routeLinesRef.current = [casing, line];
      }
    }, [ready, route]);

    /* -------------------------------------------------------- map handle */
    useImperativeHandle(ref, () => ({
      flyToUser: () => {
        mapRef.current?.flyTo([userLocation.lat, userLocation.lng], 14, { duration: 0.8 });
      },
      fitAll: () => {
        const L = leafletRef.current;
        const map = mapRef.current;
        if (!L || !map || hospitals.length === 0) return;
        const points = hospitals.map((h) => [h.latitude, h.longitude] as [number, number]);
        points.push([userLocation.lat, userLocation.lng]);
        map.fitBounds(L.latLngBounds(points), {
          paddingTopLeft: [48, 88],
          paddingBottomRight: [48, 48],
          maxZoom: 14,
        });
      },
    }));

    return (
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label="Interactive hospital map (OpenStreetMap demo mode)"
      />
    );
  }
);
