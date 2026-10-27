"use client";

/**
 * Loading screen. Stays on top until all four are ready:
 *   1. the app scripts (the care SDK)            -> `sdkReady`, set by page.tsx
 *   2. the 3D body (.glb models)                 -> waitForBody()
 *   3. the department model service              -> waitForService(MODEL_API)
 *   4. the hospital service                      -> waitForService(HOSPITAL_API)
 * A service that is still asleep after a minute does not block the app: it opens anyway and the
 * normal "try again" screens handle it. After 8 s a "Continue anyway" button lets the person skip the wait
 * (useful while a server is simply not started).
 */
import "./boot.css";
import { useEffect, useRef, useState } from "react";
import { HOSPITAL_API, MODEL_API } from "@/lib/models";
import { waitForBody, waitForService } from "@/lib/boot";

const MIN_SHOW_MS = 900; // never flash: a screen that appears for a blink looks like a glitch
const FADE_MS = 500;

type Key = "app" | "body" | "model" | "hosp";
const STEPS: { key: Key; label: string }[] = [
  { key: "app", label: "Loading the app" },
  { key: "body", label: "Preparing the 3D body" },
  { key: "model", label: "Waking up the symptom analysis" },
  { key: "hosp", label: "Connecting to hospital data" },
];

export default function BootScreen({ sdkReady, loadErr, onDone }: { sdkReady: boolean; loadErr: string | null; onDone: () => void }) {
  const [done, setDone] = useState<Record<Key, boolean>>({ app: false, body: false, model: false, hosp: false });
  const [leaving, setLeaving] = useState(false);
  const [waited, setWaited] = useState(0); // seconds, to explain a slow wake-up
  const t0 = useRef(Date.now());
  const cancelled = useRef(false);
  const mark = (k: Key) => setDone((d: Record<Key, boolean>) => (d[k] ? d : { ...d, [k]: true }));

  useEffect(() => {
    cancelled.current = false;
    const stop = () => cancelled.current;
    waitForService(MODEL_API, { isCancelled: stop }).then(() => !stop() && mark("model"));
    waitForService(HOSPITAL_API, { isCancelled: stop }).then(() => !stop() && mark("hosp"));
    const clock = setInterval(() => setWaited(Math.floor((Date.now() - t0.current) / 1000)), 1000);
    return () => {
      cancelled.current = true;
      clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    if (!sdkReady) return;
    mark("app");
    waitForBody(25000, () => cancelled.current).then(() => !cancelled.current && mark("body"));
  }, [sdkReady]);

  const all = done.app && done.body && done.model && done.hosp;
  useEffect(() => {
    if (!all) return;
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - t0.current));
    const a = setTimeout(() => setLeaving(true), wait);
    const b = setTimeout(onDone, wait + FADE_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const active = STEPS.find((s) => !done[s.key])?.key;
  const count = STEPS.filter((s) => done[s.key]).length;
  const waitingOnServer = active === "model" || active === "hosp";
  const skip = () => {
    mark("model");
    mark("hosp");
  };
  const note =
    active === "model" || active === "hosp"
      ? waited >= 6
        ? "Servers can take up to a minute to wake up the first time. Thanks for waiting."
        : "Almost there…"
      : active === "body"
        ? "Getting the 3D body ready…"
        : "Starting up…";

  return (
    <div className={"boot" + (leaving ? " leave" : "")} role="status" aria-live="polite" aria-label="Loading HealthAI Navigator">
      <div className="boot-card">
        <div className="boot-logo" aria-hidden="true">
          <b />
          <b />
          <b />
          <div className="boot-core">
            <svg viewBox="0 0 84 48">
              <path className="boot-ecg" d="M2 26 H20 L27 26 L33 8 L42 42 L49 17 L54 26 H82" />
            </svg>
          </div>
        </div>
        <h1 className="boot-title">HealthAI Navigator</h1>
        <p className="boot-tag">Describe your symptoms, find the right department and a hospital near you.</p>

        {loadErr ? (
          <div className="boot-err" role="alert">
            <p>The app couldn’t start ({loadErr}). Please check your connection and try again.</p>
            <button onClick={() => window.location.reload()}>Try again</button>
          </div>
        ) : (
          <>
            <ul className="boot-steps">
              {STEPS.map((s) => (
                <li key={s.key} className={done[s.key] ? "done" : active === s.key ? "active" : ""}>
                  <span className="boot-dot">
                    <svg viewBox="0 0 12 12" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 6.4l2.3 2.3 4.7-5" />
                    </svg>
                  </span>
                  {s.label}
                </li>
              ))}
            </ul>
            <div className="boot-bar" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={count}>
              <i style={{ width: `${Math.max(8, (count / STEPS.length) * 100)}%` }} />
            </div>
            <p className="boot-note">{note}</p>
            {waitingOnServer && waited >= 8 && (
              <button className="boot-skip" onClick={skip}>
                Continue anyway
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
