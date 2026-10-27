"use client";

/**
 * useUserLocation — resolves the visitor's position with a graceful fallback chain:
 *   1. Browser Geolocation API (asks permission)
 *   2. Fallback to the Dhaka city centre (the app's primary market)
 *   3. Manual override — `setManualLocation()` for presets or map clicks
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng, UserLocationState } from "@/lib/types";

const DHAKA_CENTER: LatLng = { lat: 23.8103, lng: 90.4125 };

export function useUserLocation(autoDetect = true) {
  const [state, setState] = useState<UserLocationState>({
    position: null,
    status: "idle",
    label: "Location not set",
  });
  const watchIdRef = useRef<number | null>(null);

  const requestGeolocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({
        position: DHAKA_CENTER,
        status: "fallback",
        label: "Geolocation unsupported — using Dhaka centre",
      });
      return;
    }

    setState((s) => ({ ...s, status: "locating", label: "Detecting your location…" }));

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          status: "granted",
          label: "Live location detected",
        });
      },
      () => {
        setState({
          position: DHAKA_CENTER,
          status: "denied",
          label: "Permission denied — using Dhaka centre",
        });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }, []);

  const setManualLocation = useCallback((position: LatLng, label: string) => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState({ position, status: "manual", label });
  }, []);

  useEffect(() => {
    if (!autoDetect) return;
    // Deferred so the "locating" state update happens outside the effect body
    // (avoids cascading synchronous renders during hydration).
    const timer = setTimeout(() => requestGeolocation(), 0);
    return () => {
      clearTimeout(timer);
      if (watchIdRef.current !== null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [autoDetect, requestGeolocation]);

  return { ...state, requestGeolocation, setManualLocation };
}
