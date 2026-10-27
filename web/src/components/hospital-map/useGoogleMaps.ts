"use client";

/**
 * useGoogleMaps — loads the Google Maps JavaScript API exactly once per page
 * and resolves when `window.google.maps` is ready. Returns `null` while loading
 * or when no API key is provided (the module then falls back to Demo Mode).
 */
import { useEffect, useState } from "react";

declare global {
  interface Window {
    google?: typeof google;
    __gmapsPromise?: Promise<typeof google>;
  }
}

const LIBRARIES = ["places"];

export function useGoogleMaps(apiKey?: string) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = Boolean(apiKey);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let cancelled = false;

    // Reuse an in-flight/completed load so multiple hook instances share it.
    const loader: Promise<typeof google> =
      window.google?.maps
        ? Promise.resolve(window.google)
        : (window.__gmapsPromise ??=
            new Promise<typeof google>((resolve, reject) => {
              const script = document.createElement("script");
              script.src =
                `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey!)}` +
                `&libraries=${LIBRARIES.join(",")}&loading=async`;
              script.async = true;
              script.onerror = () =>
                reject(new Error("Failed to load the Google Maps JavaScript API."));
              script.onload = () => {
                // With `loading=async` the global may appear slightly after onload.
                const check = () => {
                  if (window.google?.maps) resolve(window.google);
                  else setTimeout(check, 50);
                };
                check();
              };
              document.head.appendChild(script);
            }));

    loader
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, apiKey]);

  return { ready: ready && enabled, error, enabled };
}
