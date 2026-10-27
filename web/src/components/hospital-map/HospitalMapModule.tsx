"use client";

/**
 * HospitalMapModule — the drop-in map module for HealthAI Navigator.
 *
 * DATA FLOW
 *   your database  ──▶  GET /api/hospitals?lat&lng&limit
 *        │                       │
 *        │                       ▼
 *        │            nearest N hospitals (name, lat, lng, …)
 *        │                       ▼
 *   user location  ──▶  numbered markers + ranked sidebar
 *                              │
 *                    user picks a hospital
 *                              ▼
 *                    route (Google Directions / OSRM)
 *                    + distance, duration, travel modes
 *
 * PROVIDERS
 *   • Google Maps (production)  — pass `apiKey` or set
 *     NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in your environment.
 *   • OpenStreetMap demo mode   — zero configuration, used automatically
 *     when no key is present so the module always works out of the box.
 *
 * MOBILE UX
 *   Phones get an app-style experience instead of a cramped split:
 *   • a Map / List switcher — each view gets the module's full height
 *   • one-tap fullscreen (native Fullscreen API where available, with a
 *     fixed inset-0 fallback that also works on iOS Safari)
 *   • big floating map controls (fullscreen / recenter / view all)
 *   • picking a hospital from the list jumps straight to the map so the
 *     route is visible immediately
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Crosshair,
  Hospital,
  LayoutList,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Scan,
  ShieldCheck,
} from "lucide-react";
import { DHAKA_CENTER } from "@/lib/hospitals-data";
import { haversineKm } from "@/lib/geo";
import type {
  Hospital,
  HospitalWithDistance,
  LatLng,
  RouteResult,
  TravelMode,
} from "@/lib/types";
import { useUserLocation } from "./useUserLocation";
import { useGoogleMaps } from "./useGoogleMaps";
import { fetchRoute } from "./route-service";
import { GoogleMapView } from "./GoogleMapView";
import { LeafletMapView, type MapHandle } from "./LeafletMapView";
import { HospitalSidebar } from "./HospitalSidebar";
import { RoutePanel } from "./RoutePanel";

export interface HospitalMapModuleProps {
  /** Google Maps JS API key. Falls back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, then to OSM demo mode. */
  apiKey?: string;
  /** Your database endpoint returning { hospitals: [...] }. Default: "/api/hospitals". */
  apiUrl?: string;
  /** Skip the API and pass hospital records straight from your database. */
  hospitals?: Hospital[];
  /** Number of nearest hospitals to show. Default 10. */
  limit?: number;
  /** Search radius in km sent to the API. Default 25. */
  radiusKm?: number;
  /** Initial map centre while GPS resolves. Default: Dhaka city centre. */
  initialCenter?: LatLng;
  /** CSS height for the module. Default: tall app-style canvas — "h-[85dvh] md:h-[80vh] md:min-h-[600px]". Pass e.g. "h-[500px]" to override. */
  height?: string;
  /** Show demo preset-location chips (handy for presentations). Default true. */
  allowLocationSimulation?: boolean;
  /** Allow tapping the map to set the user's location. Default true. */
  allowMapPick?: boolean;
  /** Fire as soon as the visitor selects a hospital (great for analytics). */
  onSelectHospital?: (hospital: HospitalWithDistance) => void;
  className?: string;
}

export function HospitalMapModule({
  apiKey,
  apiUrl = "/api/hospitals",
  hospitals: hospitalsProp,
  limit = 10,
  radiusKm = 25,
  initialCenter = DHAKA_CENTER,
  height = "h-[85dvh] md:h-[80vh] md:min-h-[600px]",
  allowLocationSimulation = true,
  allowMapPick = true,
  onSelectHospital,
  className,
}: HospitalMapModuleProps) {
  /* ------------------------------------------------------------ provider */
  const effectiveApiKey = apiKey ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const googleEnabled = Boolean(effectiveApiKey);
  const { ready: googleReady } = useGoogleMaps(effectiveApiKey);

  /* --------------------------------------------------------- user locale */
  const userLocation = useUserLocation(true);
  const position = userLocation.position ?? initialCenter;

  /* ---------------------------------------------------------- data state */
  const [hospitals, setHospitals] = useState<HospitalWithDistance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const mapHandleRef = useRef<MapHandle>(null);
  const selectCallbackRef = useRef(onSelectHospital);
  selectCallbackRef.current = onSelectHospital;

  /* ------------------------------------------- mobile layout & fullscreen */
  const containerRef = useRef<HTMLElement | null>(null);
  /** Phones get a full-height view switcher instead of a cramped split. */
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  /** App-style fullscreen: fixed inset-0 overlay (works everywhere, incl.
   *  iOS Safari) layered on the native Fullscreen API where supported. */
  const [isFullscreen, setFullscreen] = useState(false);

  const enterFullscreen = useCallback(async () => {
    setMobileView("map");
    setFullscreen(true);
    try {
      const el = containerRef.current;
      if (el?.requestFullscreen && !document.fullscreenElement) {
        await el.requestFullscreen(); // hide browser chrome where supported
      }
    } catch {
      /* Native fullscreen unavailable (e.g. iOS Safari) — the CSS overlay already covers it. */
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    setFullscreen(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    void (isFullscreen ? exitFullscreen() : enterFullscreen());
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // Sync when the browser leaves native fullscreen on its own (Esc / Android back).
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Esc exits CSS-only fullscreen; lock the page behind it while immersive mode is on.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void exitFullscreen();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen, exitFullscreen]);

  /* ------------------------------------------- load hospitals (DB → UI) */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let list: HospitalWithDistance[];

        if (hospitalsProp) {
          // Data injected directly by the host page — compute distance client-side.
          list = hospitalsProp
            .map((h) => ({
              ...h,
              distanceKm: haversineKm(position, { lat: h.latitude, lng: h.longitude }),
            }))
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, limit);
        } else {
          const params = new URLSearchParams({
            lat: String(position.lat),
            lng: String(position.lng),
            limit: String(limit),
            radius: String(radiusKm),
          });
          const response = await fetch(`${apiUrl}?${params.toString()}`);
          if (!response.ok) throw new Error(`API responded ${response.status}`);
          const data = await response.json();
          list = (data.hospitals ?? []).map((h: HospitalWithDistance) => ({
            ...h,
            distanceKm:
              h.distanceKm ??
              haversineKm(position, { lat: h.latitude, lng: h.longitude }),
          }));
        }

        if (!cancelled) {
          setHospitals(list);
          setSelectedId(null);
          setRoute(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unknown error contacting the hospital service."
          );
          setHospitals([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [position, apiUrl, limit, radiusKm, hospitalsProp]);

  /* ------------------------------------------- selection & route effect */
  const selectedHospital = useMemo(
    () => hospitals.find((h) => h.id === selectedId) ?? null,
    [hospitals, selectedId]
  );

  useEffect(() => {
    if (!selectedHospital) {
      setRoute(null);
      setRouteLoading(false);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);

    fetchRoute(
      position,
      { lat: selectedHospital.latitude, lng: selectedHospital.longitude },
      travelMode,
      googleEnabled && googleReady
    )
      .then((r) => {
        if (!cancelled) setRoute(r);
      })
      .catch(() => {
        if (!cancelled) setRoute(null);
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedHospital, travelMode, position, googleEnabled, googleReady]);

  /* -------------------------------------------------------- interactions */
  const handleSelect = useCallback(
    (id: string) => {
      const next = selectedId === id ? null : id; // tap again to deselect
      if (next) {
        const h = hospitals.find((x) => x.id === next);
        if (h) selectCallbackRef.current?.(h);
        // Phones: jump straight to the map so the route is immediately visible.
        setMobileView((v) => (v === "list" ? "map" : v));
      }
      setSelectedId(next);
    },
    [hospitals, selectedId]
  );

  const handleMapClick = useCallback(
    (p: LatLng) => {
      if (!allowMapPick) return;
      userLocation.setManualLocation(p, "Manual map pin");
    },
    [allowMapPick, userLocation]
  );

  /* ------------------------------------------------------------- render */
  const providerChip = googleEnabled
    ? { label: "Google Maps", tone: "bg-emerald-600" }
    : { label: "Demo mode · OpenStreetMap", tone: "bg-amber-500" };

  return (
    <section
      ref={containerRef}
      className={
        isFullscreen
          ? `fixed inset-0 z-[1000] flex flex-col overflow-hidden bg-card shadow-2xl ${className ?? ""}`
          : `flex min-h-[520px] ${height} flex-col overflow-hidden rounded-2xl border bg-card shadow-sm ${className ?? ""}`
      }
      aria-label="Hospital map module"
    >
      {/* ------------------------------------------------------ top bar */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-2.5 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
            <Hospital className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">
              HealthAI Navigator — Nearby Hospitals
            </p>
            <p className="truncate text-[11px] text-white/75">
              {limit} closest options · live routing from your location
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white sm:inline-flex ${providerChip.tone}`}
            title={
              googleEnabled
                ? "Rendering with the Google Maps JavaScript API"
                : "No API key detected — running the zero-config OpenStreetMap demo. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to switch."
            }
          >
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {providerChip.label}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Expand the module to fullscreen"}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            )}
            <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            onClick={() => mapHandleRef.current?.fitAll()}
            aria-label="Zoom out to show all nearby hospitals"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">View all</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            onClick={() => mapHandleRef.current?.flyToUser()}
            aria-label="Recenter the map on my location"
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">My location</span>
          </Button>
        </div>
      </header>

      {/* ------------------------- phones: full-height Map / List switcher */}
      <div
        className="flex shrink-0 gap-1.5 border-b bg-muted/60 p-2 md:hidden"
        role="tablist"
        aria-label="Switch between map and hospital list"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mobileView === "map"}
          onClick={() => setMobileView("map")}
          className={`relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            mobileView === "map"
              ? "bg-teal-600 text-white shadow-sm"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          <MapIcon className="h-4 w-4" aria-hidden />
          Map
          {route && mobileView === "list" && (
            <span
              className="absolute right-2.5 top-1/2 h-2 w-2 -translate-y-1/2 animate-pulse rounded-full bg-amber-400"
              title="Route active — switch to the map to see it"
              aria-hidden
            />
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileView === "list"}
          onClick={() => setMobileView("list")}
          className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            mobileView === "list"
              ? "bg-teal-600 text-white shadow-sm"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          <LayoutList className="h-4 w-4" aria-hidden />
          List
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
              mobileView === "list" ? "bg-white/25 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            {hospitals.length > 0 ? hospitals.length : "—"}
          </span>
        </button>
      </div>

      {/* ----------------------------------------------- sidebar + map body */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          className={`order-2 border-t md:order-1 md:flex md:w-[360px] md:flex-none md:border-r md:border-t-0 lg:w-[380px] ${
            mobileView === "list" ? "flex min-h-0 flex-1 flex-col" : "hidden"
          }`}
        >
          <HospitalSidebar
            hospitals={hospitals}
            loading={loading}
            error={error}
            selectedId={selectedId}
            activeRouteDistanceKm={route?.distanceKm ?? null}
            travelMode={travelMode}
            userLocation={userLocation}
            limit={limit}
            showSimulations={allowLocationSimulation}
            onSelect={handleSelect}
          />
        </aside>

        <div
          className={`relative order-1 md:order-2 md:h-auto md:block md:flex-1 ${
            mobileView === "map" ? "min-h-0 flex-1" : "hidden"
          }`}
        >
          {loading && hospitals.length === 0 ? (
            <div className="absolute inset-0 z-[700] flex flex-col items-center justify-center gap-3 bg-muted/60 backdrop-blur-[2px]">
              <Skeleton className="h-10 w-10 rounded-full" />
              <p className="text-sm font-medium text-muted-foreground">
                Finding hospitals near you…
              </p>
            </div>
          ) : null}

          {googleEnabled ? (
            <GoogleMapView
              ref={mapHandleRef}
              apiKey={effectiveApiKey!}
              userLocation={position}
              hospitals={hospitals}
              selectedId={selectedId}
              route={route}
              onSelectHospital={handleSelect}
              onMapClick={handleMapClick}
            />
          ) : (
            <LeafletMapView
              ref={mapHandleRef}
              userLocation={position}
              hospitals={hospitals}
              selectedId={selectedId}
              route={route}
              onSelectHospital={handleSelect}
              onMapClick={handleMapClick}
            />
          )}

          {/* floating controls — big touch targets, available in every layout */}
          <div className="absolute right-2 top-11 z-[620] flex flex-col gap-1.5">
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Expand the map to fullscreen"}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur transition-all hover:bg-white hover:text-teal-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isFullscreen ? (
                <Minimize2 className="h-5 w-5" aria-hidden />
              ) : (
                <Maximize2 className="h-5 w-5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => mapHandleRef.current?.flyToUser()}
              title="My location"
              aria-label="Recenter the map on my location"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur transition-all hover:bg-white hover:text-teal-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Crosshair className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => mapHandleRef.current?.fitAll()}
              title="View all hospitals"
              aria-label="Zoom out to show all nearby hospitals"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur transition-all hover:bg-white hover:text-teal-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Scan className="h-5 w-5" aria-hidden />
            </button>
          </div>

          {/* route summary panel (over the map) */}
          {selectedHospital && (
            <RoutePanel
              hospital={selectedHospital}
              userLocation={position}
              route={route}
              routeLoading={routeLoading}
              travelMode={travelMode}
              onModeChange={setTravelMode}
              onClear={() => setSelectedId(null)}
            />
          )}

          {/* attribution / provider note */}
          <div className="pointer-events-none absolute right-2 top-2 z-[650] rounded-md bg-white/85 px-2 py-1 text-[10px] font-medium text-slate-600 shadow-sm backdrop-blur">
            {googleEnabled
              ? "Powered by Google"
              : "Map data © OpenStreetMap · Routing by OSRM"}
          </div>

          {error && (
            <div className="pointer-events-auto absolute left-1/2 top-3 z-[700] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive backdrop-blur">
              <AlertCircle className="h-4 w-4" aria-hidden />
              Hospital service unavailable — retrying on next location change
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
