"use client";

/**
 * HealthAI Navigator — the UI from Symptom-input-demo-1.html, ported to React.
 *
 *  body map / symptom chips / text box  ->  [dept model] + [risk model]  ->  chat-style result
 *  ->  hospital map (teammates' LeafletMapView with real hospitals from hospital-api)
 *
 * The DOM structure, class names and CSS (hai.css) come from the demo HTML.
 */
import "../hai.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { LeafletMapView } from "@/components/hospital-map/LeafletMapView";
import { useUserLocation } from "@/components/hospital-map/useUserLocation";
import { fetchRoute } from "@/components/hospital-map/route-service";
import { googleDirectionsUrl, haversineKm } from "@/lib/geo";
import type { Hospital, HospitalWithDistance, RouteResult } from "@/lib/types";
import { SYM, VIEWS, bodySvg, type ViewKey } from "@/lib/bodymap";
import { fetchAllHospitals, fetchHospitalsCovering, fetchHospitalsFor, predictDepartment, predictRisk, type DeptMode, type RiskResult } from "@/lib/models";

const EMERGENCY = "999"; // set per country
const MAP_LIMIT = 6; // the demo shows six hospitals (A–F)

type Ent = { r: string; s: string; p: string };
type Ai =
  | { status: "loading" }
  | { status: "error"; msg: string }
  | { status: "done"; dept: string; mode: DeptMode; risk: RiskResult; hospitals: number };

const clean = (t: string) => t.replace(/\s{2,}/g, " ").replace(/^\s+/, "");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function Page() {
  // ---- input screen state (same model as the demo's `st`) ----
  const [view, setView] = useState<ViewKey>("front");
  const [sex, setSex] = useState<"Female" | "Male">("Female");
  const [ent, setEnt] = useState<Ent[]>([]);
  const [pend, setPend] = useState<string | null>(null);
  const [pendSym, setPendSym] = useState<string | null>(null);
  const [pop, setPop] = useState<null | "sym" | "info">(null);
  const [hover, setHover] = useState("");
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ---- result thread ----
  const [thread, setThread] = useState<null | { user: string; ai: Ai }>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  // ---- map screen ----
  const loc = useUserLocation(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);

  // ---- SOS ----
  const [sosOpen, setSosOpen] = useState(false);
  const [sosMsg, setSosMsg] = useState("");

  // auto-grow textarea (demo's grow())
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 96) + "px";
  }, [text, thread]);

  // click outside closes popovers (regions handle their own clicks)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".pop,#symBtn,#info,[data-l]")) setPop(null);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, []);

  // ---------------------------------------------------------------- input logic
  function add(r: string, s: string) {
    const p = `${r} ${s};`;
    setEnt((e) => [...e, { r, s, p }]);
    setText((t) => clean((t.trim() ? t.trim() + " " : "") + p));
    setPend(null);
    setPendSym(null);
    setPop(null);
    setHover("");
  }
  function untog(r: string) {
    const gone = ent.filter((x) => x.r === r);
    setText((t) => clean(gone.reduce((acc, x) => acc.replace(x.p, ""), t)));
    setEnt((e) => e.filter((x) => x.r !== r));
    setHover("");
  }
  function commit(sym: string) {
    const s = sym.toLowerCase();
    if (pend) return add(pend, s);
    setPendSym(pendSym === s ? null : s);
    setPop(null);
    setHover("");
  }
  function onSvgClick(e: React.MouseEvent) {
    const g = (e.target as Element).closest("[data-l]");
    if (!g) return;
    e.stopPropagation();
    const r = g.getAttribute("data-l")!.toLowerCase();
    setHover("");
    if (pendSym) return add(r, pendSym);
    if (ent.some((x) => x.r === r)) return untog(r);
    if (pend === r) {
      setPend(null);
      setPop(null);
    } else {
      setPend(r);
      setPop("sym");
    }
  }
  function onSvgOver(e: React.MouseEvent) {
    const g = (e.target as Element).closest("[data-l]");
    setHover(g ? g.getAttribute("data-l")! : "");
  }
  function onText(v: string) {
    const t = v.toLowerCase();
    setEnt((e) => e.filter((x) => t.includes(x.p)));
    setText(v);
  }
  const togglePop = (which: "sym" | "info") => setPop((p) => (p === which ? null : which));

  const hint = hover || (pendSym ? `${cap(pendSym)}: now tap a body part` : pend ? `${cap(pend)} selected` : "");
  const svg = bodySvg(view, sex, ent.map((e) => e.r), pend);

  // ---------------------------------------------------------------- send -> models
  async function sendMsg(t: string) {
    setText("");
    setEnt([]);
    setPend(null);
    setPendSym(null);
    setHover("");
    setHospitals([]);
    setThread({ user: t, ai: { status: "loading" } });
    try {
      const [pred, risk] = await Promise.all([predictDepartment(t), predictRisk(t, sex)]);
      const names = pred.departments.map((d) => d.label);
      const dept = names.join(", ");
      // single -> best department only; multi -> hospitals offering all three; unsure -> any hospital
      const rows =
        pred.mode === "single" ? await fetchHospitalsFor(names[0]) : pred.mode === "multi" ? (await fetchHospitalsCovering(names)).rows : await fetchAllHospitals();
      setHospitals(rows);
      setThread({ user: t, ai: { status: "done", dept, mode: pred.mode, risk, hospitals: rows.length } });
    } catch (e: any) {
      const m = String(e?.message ?? e);
      setThread({
        user: t,
        ai: {
          status: "error",
          msg: /fetch/i.test(m)
            ? "I couldn't reach the analysis service. Please check that the model and hospital servers are running, then try again."
            : m,
        },
      });
    }
  }

  // ---------------------------------------------------------------- map logic
  const list = useMemo<HospitalWithDistance[]>(() => {
    const pos = loc.position;
    if (!pos) return [];
    return hospitals
      .map((h) => ({ ...h, distanceKm: haversineKm(pos, { lat: h.latitude, lng: h.longitude }) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAP_LIMIT);
  }, [hospitals, loc.position]);
  const sel = list.find((h) => h.id === selId) ?? null;

  function openMap() {
    setSelId(null);
    setRoute(null);
    if (!loc.position) loc.requestGeolocation();
    setMapOpen(true);
  }
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
  const mInfo = !loc.position
    ? "Detecting your location…"
    : !sel
      ? "Tap a hospital pin, or use the nearest one."
      : route
        ? `${sel.name} · ${route.distanceKm.toFixed(1)} km · about ${Math.max(1, Math.round(route.durationMin))} min by car`
        : `${sel.name} selected · about ${sel.distanceKm.toFixed(1)} km away`;

  // ---------------------------------------------------------------- render
  const inThread = thread !== null;
  return (
    <div className="hai-root">
      <div id="app">
        <div className="top">
          <div className="seg" id="sex">
            {(["Female", "Male"] as const).map((s) => (
              <button key={s} className={sex === s ? "on" : ""} onClick={() => setSex(s)}>
                {s}
              </button>
            ))}
          </div>
          <button id="symBtn" aria-expanded={pop === "sym"} onClick={() => togglePop("sym")}>
            <span>Symptom</span>
            <span>▾</span>
          </button>
          <button id="info" aria-label="Safety note" onClick={() => togglePop("info")}>
            i
          </button>
          <button
            id="sosBtn"
            aria-label="Emergency"
            onClick={(e) => {
              e.stopPropagation();
              setSosOpen(true);
            }}
          >
            SOS
          </button>
        </div>
        <div className={"pop" + (pop === "sym" ? " show" : "")} id="symPop">
          <p id="popT">{pend ? cap(pend) + ": pick what you feel" : "Pick a symptom"}</p>
          <div className="chips" id="symChips">
            {SYM.map((s) => (
              <button key={s} className="chip" onClick={() => commit(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className={"pop" + (pop === "info" ? " show" : "")} id="infoPop">
          <p style={{ color: "var(--h-ink)", margin: 0 }}>
            This tool records what you report and does not diagnose. In an emergency, call your local emergency number.
            Avoid entering identifying details.
          </p>
        </div>

        {!inThread && (
          <>
            <div className="map">
              <div id="hint">{hint}</div>
              <span className="side" style={{ left: 10 }}>R</span>
              <span className="side" style={{ right: 10 }}>L</span>
              <svg
                id="svg"
                viewBox="0 0 200 400"
                preserveAspectRatio="xMidYMid meet"
                onClick={onSvgClick}
                onMouseOver={onSvgOver}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
            <div className="views" id="views">
              {(Object.entries(VIEWS) as [ViewKey, (typeof VIEWS)[ViewKey]][]).map(([k, x]) => (
                <button
                  key={k}
                  className={k === view ? "on" : ""}
                  onClick={() => {
                    setView(k);
                    setHover("");
                  }}
                >
                  {x.t}
                </button>
              ))}
            </div>
          </>
        )}

        {inThread && thread && (
          <div id="thread" style={{ display: "flex" }}>
            <button className="plain2" id="tBack" onClick={() => setThread(null)}>
              ← Body map
            </button>
            <div className="b me">{thread.user}</div>
            <AiBubble ai={thread.ai} onMap={openMap} />
          </div>
        )}

        {!inThread && (
          <div className="comp">
            <textarea
              id="ta"
              ref={taRef}
              rows={1}
              value={text}
              placeholder="Describe your symptoms, or tap the body…"
              onChange={(e) => onText(e.target.value)}
              onFocus={() => setPop(null)}
            />
            <button id="send" aria-label="Send" disabled={!text.trim()} onClick={() => sendMsg(text.trim())}>
              ↑
            </button>
          </div>
        )}

        {mapOpen && (
          <div id="mapScr" style={{ display: "flex" }}>
            <div className="mtop">
              <button id="mClose" aria-label="Close map" onClick={() => setMapOpen(false)}>
                ✕
              </button>
              <button id="mNear" disabled={!list.length} onClick={() => pick(list[0]?.id ?? null)}>
                Open location of the nearest hospital
              </button>
            </div>
            <div className={"mbody" + (sel ? " hai-sel" : "")}>
              {loc.position && (
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
        )}

        <div id="sos" style={{ display: sosOpen ? "flex" : "none" }}>
          <div className="sheet">
            <h2>Emergency</h2>
            <p>If you or someone near you is in danger, call now.</p>
            <a id="sosCall" className="big call" href={"tel:" + EMERGENCY}>
              Call emergency number
            </a>
            <button
              id="sosSend"
              className="big alert"
              onClick={() =>
                setSosMsg(
                  "Demo only: the real app would send your alert, current description and location to your emergency contacts."
                )
              }
            >
              Send emergency alert
            </button>
            <p id="sosMsg" className="msg">{sosMsg}</p>
            <button
              id="sosX"
              className="big plain"
              onClick={() => {
                setSosOpen(false);
                setSosMsg("");
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AiBubble({ ai, onMap }: { ai: Ai; onMap: () => void }) {
  if (ai.status === "loading") return <div className="b ai">…</div>;
  if (ai.status === "error") return <div className="b ai">{ai.msg}</div>;

  const r = ai.risk;
  const names = ai.dept.split(", ");
  return (
    <div className="b ai">
      {r.status === "ok" && r.emergency && (
        <>
          <b style={{ color: "#d33427" }}>The symptoms might be an emergency.</b>{" "}
        </>
      )}
      {ai.mode === "single" ? (
        <>
          The most likely department related to your symptoms is <b>{names[0]}</b>.
          {names.length > 1 && <> Even though this is the most likely department, your symptoms might also be related to <b>{names.slice(1).join(" and ")}</b>.</>}{" "}
        </>
      ) : ai.mode === "multi" ? (
        <>
          Your symptoms are most likely related to <b>{names.slice(0, -1).join(", ")} and {names[names.length - 1]}</b>. We couldn’t pinpoint the department which is
          related to your symptoms.{" "}
        </>
      ) : (
        <>Your symptoms were not enough to make suggestions. Try using the 3D input system and more specific symptoms.{" "}</>
      )}
      {ai.hospitals > 0 ? (
        <>
          We have some recommended hospitals. Open maps to see their locations.
          <br />
          <button className="mapbtn" id="tMap" onClick={onMap}>
            <svg width="40" height="40" viewBox="-16 -34 32 36">
              <path d="M0 0C-3-8-13-16-13-27a13 13 0 0 1 26 0C13-16 3-8 0 0z" fill="#d93025" />
              <circle cy="-27" r="6" fill="#fff" />
            </svg>
            Open nearby hospital locations
          </button>
        </>
      ) : (
        <>We couldn’t find hospitals for that department in our list yet.</>
      )}
    </div>
  );
}
