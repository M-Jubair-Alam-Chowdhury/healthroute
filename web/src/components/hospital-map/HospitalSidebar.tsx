"use client";

/**
 * HospitalSidebar — the ranked "nearest N" list driven by the data your
 * database returns. Clicking an item selects the hospital on the map and
 * triggers routing; each item exposes call and navigate affordances.
 */
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Car,
  Crosshair,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Star,
} from "lucide-react";
import { DEMO_LOCATIONS } from "@/lib/hospitals-data";
import { estimateDurationMin, formatDistance } from "@/lib/geo";
import type { LatLng, TravelMode } from "@/lib/types";
import type { UserLocationState } from "@/lib/types";

export interface HospitalSidebarProps {
  hospitals: HospitalWithDistance[] | [];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  activeRouteDistanceKm: number | null;
  travelMode: TravelMode;
  userLocation: UserLocationState & { requestGeolocation: () => void; setManualLocation: (p: LatLng, label: string) => void };
  limit: number;
  showSimulations: boolean;
  onSelect: (id: string) => void;
}

export function HospitalSidebar({
  hospitals,
  loading,
  error,
  selectedId,
  activeRouteDistanceKm,
  travelMode,
  userLocation,
  limit,
  showSimulations,
  onSelect,
}: HospitalSidebarProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the selected item in view when selection changes from the map side.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-hospital-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* ---------------------------------------------------- list header */}
      <div className="border-b px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">
            Nearest {limit} hospitals
          </h2>
          <Badge variant="secondary" className="gap-1 font-normal">
            <MapPin className="h-3 w-3" aria-hidden />
            {hospitals.length > 0 ? `${hospitals.length} found` : "—"}
          </Badge>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Crosshair
            className={`h-3.5 w-3.5 shrink-0 ${
              userLocation.status === "granted"
                ? "text-emerald-600"
                : userLocation.status === "locating"
                  ? "animate-pulse text-amber-600"
                  : "text-muted-foreground"
            }`}
            aria-hidden
          />
          <span className="truncate" title={userLocation.label}>
            {userLocation.label}
          </span>
        </p>

        {showSimulations && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={userLocation.requestGeolocation}
                aria-label="Detect my location with GPS"
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden />
                My GPS
              </Button>
              {DEMO_LOCATIONS.map((loc) => (
                <Button
                  key={loc.label}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() =>
                    userLocation.setManualLocation(
                      { lat: loc.lat, lng: loc.lng },
                      `Simulated location — ${loc.label}`
                    )
                  }
                  aria-label={`Simulate location in ${loc.label}`}
                >
                  {loc.label}
                </Button>
              ))}
            </div>
            {(userLocation.status === "denied" || userLocation.status === "fallback") && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Tip: tap anywhere on the map to set your location manually.
              </p>
            )}
          </div>
        )}
      </div>

      {/* -------------------------------------------------------- the list */}
      <div className="min-h-0 flex-1">
        {loading && (
          <ul className="space-y-2 p-3" aria-busy="true" aria-label="Loading hospitals">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex gap-3 rounded-lg border p-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="w-full space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && error && (
          <div className="m-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Couldn&apos;t load hospitals</p>
              <p className="text-xs opacity-80">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && hospitals.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <MapPin className="h-8 w-8 opacity-40" aria-hidden />
            <p className="text-sm">No hospitals found within the search radius.</p>
            <p className="text-xs">Try another location or widen the radius.</p>
          </div>
        )}

        {!loading && !error && hospitals.length > 0 && (
          <ul
            ref={listRef}
            className="hm-scroll space-y-2 overflow-y-auto p-3 max-h-full"
            aria-label={`Nearest ${hospitals.length} hospitals, sorted by distance`}
          >
            {hospitals.map((h, index) => {
              const selected = h.id === selectedId;
              const etaKm = selected && activeRouteDistanceKm !== null ? activeRouteDistanceKm : h.distanceKm;
              const eta =
                selected && activeRouteDistanceKm !== null
                  ? null // exact time comes from the route panel
                  : estimateDurationMin(h.distanceKm, travelMode);
              return (
                <li key={h.id} data-hospital-id={h.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(h.id)}
                    aria-pressed={selected}
                    aria-label={`Hospital ${index + 1}: ${h.name}, ${formatDistance(h.distanceKm)} away${h.isEmergency ? ", 24/7 emergency" : ""}`}
                    className={`w-full rounded-xl border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "border-teal-600 bg-teal-600/[0.06] shadow-sm ring-1 ring-teal-600/40"
                        : "border-border bg-background hover:border-teal-600/40 hover:bg-accent/60"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                          h.isEmergency ? "bg-red-600" : "bg-teal-700"
                        } ${selected ? "ring-2 ring-offset-2 ring-teal-600/50" : ""}`}
                      >
                        {index + 1}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-sm font-semibold leading-tight">
                            {h.name}
                          </p>
                          {h.isEmergency && (
                            <Badge className="shrink-0 bg-red-600 hover:bg-red-600" variant="default">
                              24/7
                            </Badge>
                          )}
                        </div>

                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {h.department ?? "General hospital"}
                          {h.rating ? (
                            <span className="ml-1.5 inline-flex items-center gap-0.5">
                              <Star className="inline h-3 w-3 fill-amber-400 text-amber-400" aria-hidden />
                              {h.rating.toFixed(1)}
                            </span>
                          ) : null}
                        </p>

                        <p className="mt-1.5 flex items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 font-medium text-teal-700">
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                            {formatDistance(h.distanceKm)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Car className="h-3.5 w-3.5" aria-hidden />
                            {eta !== null ? `~${Math.max(1, Math.round(eta))} min` : `${formatDistance(etaKm)} route`}
                          </span>
                        </p>

                        <div className="mt-2.5 flex items-center gap-2">
                          {h.phone && (
                            <a
                              href={`tel:${h.phone.replace(/[^+\d]/g, "")}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-foreground/80 transition-colors hover:border-teal-600/50 hover:text-teal-700"
                              aria-label={`Call ${h.name}`}
                            >
                              <Phone className="h-3.5 w-3.5" aria-hidden />
                              Call
                            </a>
                          )}
                          <span
                            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                              selected
                                ? "bg-teal-600 text-white"
                                : "bg-secondary text-secondary-foreground"
                            }`}
                          >
                            <Navigation className="h-3.5 w-3.5" aria-hidden />
                            {selected ? "Routing" : "Route"}
                          </span>
                          {selected && (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-teal-700" aria-label="Computing route" />
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
