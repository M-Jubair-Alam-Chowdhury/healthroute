"use client";

/**
 * Hospital map screen, opened from the care SDK's result screen ("Open suggested Hospitals").
 * Same layout/behaviour as the demo HTML's map screen (hai.css), but with the real data:
 * hospital-api rows for the predicted department + the teammates' Leaflet map + live location.
 */
import "@/app/hai.css";
import { useEffect, useMemo, useState } from "react";
import { LeafletMapView } from "@/components/hospital-map/LeafletMapView";
import { useUserLocation } from "@/components/hospital-map/useUserLocation";
import { fetchRoute } from "@/components/hospital-map/route-service";
import { googleDirectionsUrl, haversineKm } from "@/lib/geo";
import type { Hospital, HospitalWithDistance, RouteResult } from "@/lib/types";
import { fetchAllHospitals, fetchHospitalsCovering, fetchHospitalsFor, type Scope } from "@/lib/models";

const MAP_LIMIT = 6;

type Load =
  | { status: "loading" }
  | { status: "error"; msg: string }
  | { status: "empty" }
  | { status: "done"; note: string; rows: Hospital[] };

/**
 * labels = the model's top-3 departments, best first.
 *   scope "primary": hospitals with labels[0] only
 *   scope "all":     hospitals that offer ALL the labels (or, if none do, the ones offering the most)
 *   scope "any":     any hospital (the model was unsure)
 */
export default function HospitalMapScreen({ labels, scope, onClose }: { labels: string[]; scope: Scope; onClose: () => void }) {
  const loc = useUserLocation(false);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selId, setSelId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const key = labels.join("|") + "#" + scope;

  useEffect(() => {
    loc.requestGeolocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    setLoad({ status: "loading" });
    (async () => {
      try {
        let rows: Hospital[] = [];
        let note = "";
        if (scope === "primary") {
          rows = await fetchHospitalsFor(labels[0]);
          note = `Showing hospitals for ${labels[0]}. `;
        } else if (scope === "all") {
          const r = await fetchHospitalsCovering(labels);
          rows = r.rows;
          note =
            r.matched === r.total
              ? `Showing hospitals that offer all of ${labels.join(", ")}. `
              : `No hospital offers all of ${labels.join(", ")}; showing those that offer the most (${r.matched} of ${r.total}). `;
        } else {
          rows = await fetchAllHospitals();
          note = "Showing any nearby hospital. ";
        }
        if (!live) return;
        if (rows.length) return setLoad({ status: "done", note, rows });
        if (live) setLoad({ status: "empty" });
      } catch (e: any) {
        if (live)
          setLoad({
            status: "error",
            msg: /fetch/i.test(String(e?.message)) ? "I couldn't reach the hospital service. Is it running?" : String(e?.message ?? e),
          });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const list = useMemo<HospitalWithDistance[]>(() => {
    const pos = loc.position;
    if (!pos || load.status !== "done") return [];
    return load.rows
      .map((h) => ({ ...h, distanceKm: haversineKm(pos, { lat: h.latitude, lng: h.longitude }) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAP_LIMIT);
  }, [load, loc.position]);
  const sel = list.find((h) => h.id === selId) ?? null;

  const pick = (id: string | null) => {
    setSelId(id);
    setRoute(null);
  };
  function directions() {
    if (!sel || !loc.position) return;
    const from = loc.position;
    const to = { lat: sel.latitude, lng: sel.longitude };
    window.open(googleDirectionsUrl(from, to, "driving"), "_blank", "noopener");
    fetchRoute(from, to, "driving", false).then(setRoute).catch(() => {});
  }

  const note = load.status === "done" ? load.note : "";
  const mInfo =
    load.status === "loading"
      ? "Finding hospitals…"
      : load.status === "error"
        ? load.msg
        : load.status === "empty"
          ? scope === "any"
            ? "No hospitals are listed yet."
            : `No hospitals are listed for ${scope === "all" ? labels.join(", ") : labels[0]} yet.`
          : !loc.position
            ? "Detecting your location…"
            : !sel
              ? note + "Tap a hospital pin, or use the nearest one."
              : route
                ? `${sel.name} · ${route.distanceKm.toFixed(1)} km · about ${Math.max(1, Math.round(route.durationMin))} min by car`
                : `${sel.name} selected · about ${sel.distanceKm.toFixed(1)} km away`;

  return (
    <div className="hai-root hai-full">
      <div id="app">
        <div id="mapScr" style={{ display: "flex" }}>
          <div className="mtop">
            <button id="mClose" aria-label="Close map" onClick={onClose}>
              ✕
            </button>
            <button id="mNear" disabled={!list.length} onClick={() => pick(list[0]?.id ?? null)}>
              Open location of the nearest hospital
            </button>
          </div>
          <div className={"mbody" + (sel ? " hai-sel" : "")}>
            {loc.position && list.length > 0 && (
              <LeafletMapView
                userLocation={loc.position}
                hospitals={list}
                selectedId={selId}
                route={route}
                onSelectHospital={(id) => pick(id)}
              />
            )}
          </div>
          <div id="mInfo">{mInfo}</div>
          <div className="mbot">
            <button id="mChange" disabled={!sel} onClick={() => pick(null)}>
              Change hospital choice
            </button>
            <button id="mDir" disabled={!sel} onClick={directions}>
              Open in Google Maps for direction
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
