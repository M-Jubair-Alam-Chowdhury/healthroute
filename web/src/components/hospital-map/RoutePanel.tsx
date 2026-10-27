"use client";

/**
 * RoutePanel — floating panel shown when a hospital is selected.
 * Lets the user compare travel modes and jump into real Google Maps
 * turn-by-turn navigation (free deep link, no API key required).
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bike,
  Bus,
  Car,
  ExternalLink,
  Footprints,
  Loader2,
  Navigation,
  X,
} from "lucide-react";
import { formatDistance, formatDuration, googleDirectionsUrl } from "@/lib/geo";
import type { HospitalWithDistance, LatLng, RouteResult, TravelMode } from "@/lib/types";

const MODES: { value: TravelMode; label: string; Icon: typeof Car }[] = [
  { value: "driving", label: "Drive", Icon: Car },
  { value: "walking", label: "Walk", Icon: Footprints },
  { value: "transit", label: "Transit", Icon: Bus },
  { value: "bicycling", label: "Bike", Icon: Bike },
];

const SOURCE_LABEL: Record<RouteResult["source"], string> = {
  "google-directions": "Google Directions API",
  osrm: "OSRM (demo routing)",
  estimate: "Straight-line estimate",
};

export interface RoutePanelProps {
  hospital: HospitalWithDistance;
  userLocation: LatLng;
  route: RouteResult | null;
  routeLoading: boolean;
  travelMode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
  onClear: () => void;
}

export function RoutePanel({
  hospital,
  userLocation,
  route,
  routeLoading,
  travelMode,
  onModeChange,
  onClear,
}: RoutePanelProps) {
  return (
    <div
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-[600] mx-auto max-w-md rounded-xl border bg-card/95 p-3.5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:inset-x-auto sm:left-3 sm:w-[360px]"
      role="region"
      aria-label={`Route to ${hospital.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">
            Route to selected hospital
          </p>
          <h3 className="mt-0.5 line-clamp-1 text-sm font-bold">{hospital.name}</h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClear}
          aria-label="Clear route and deselect hospital"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* travel mode switcher */}
      <div className="mt-2.5 grid grid-cols-4 gap-1" role="tablist" aria-label="Travel mode">
        {MODES.map(({ value, label, Icon }) => {
          const active = value === travelMode;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onModeChange(value)}
              className={`flex h-8 flex-col items-center justify-center gap-0 rounded-md text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "bg-teal-600 text-white"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
              aria-label={`${label} mode`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      {/* distance + duration */}
      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-muted/70 px-3 py-2">
        {routeLoading || !route ? (
          <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
            {routeLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-teal-700" aria-hidden />
                Finding the best route…
              </>
            ) : (
              <>Route will appear here</>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 text-sm">
              <span className="font-bold text-teal-700">{formatDistance(route.distanceKm)}</span>
              <span className="flex items-center gap-1 font-semibold">
                {formatDuration(route.durationMin)}
              </span>
            </div>
            <Badge variant="outline" className="hidden text-[10px] font-normal text-muted-foreground sm:inline-flex">
              {SOURCE_LABEL[route.source]}
            </Badge>
          </>
        )}
      </div>

      <Button
        type="button"
        asChild
        className="mt-2.5 h-9 w-full gap-2 bg-teal-600 font-semibold text-white hover:bg-teal-700"
      >
        <a
          href={googleDirectionsUrl(
            userLocation,
            { lat: hospital.latitude, lng: hospital.longitude },
            travelMode
          )}
          target="_blank"
          rel="noreferrer"
          aria-label={`Start turn-by-turn navigation to ${hospital.name} in Google Maps`}
        >
          <Navigation className="h-4 w-4" aria-hidden />
          Navigate in Google Maps
          <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </a>
      </Button>
    </div>
  );
}
