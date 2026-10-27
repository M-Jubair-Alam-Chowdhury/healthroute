"use client";

/**
 * HealthAI Navigator — main page = the Care Anatomy SDK (public/care/*) + the real services.
 *
 *   3D body + symptoms ──(body-selection-submit)──► CareModels.run ──► department model (POST /predict)
 *                                                                  └─► risk model       (POST /risk)
 *   <care-result-screen> shows department + risk
 *   "Open suggested Hospitals" ──(care-open-hospitals)──► <HospitalMapScreen> (hospital-api + Leaflet map)
 *
 * This file replaces the SDK's own index.html (kept at public/care/index.sdk-original.html). The SDK files
 * themselves are untouched. Service addresses come from web/.env.local.
 */
import "./care-host.css";
import { useEffect, useState } from "react";
import BootScreen from "@/components/BootScreen";
import HospitalMapScreen from "@/components/HospitalMapScreen";
import { MODEL_API, RISK_API, type Scope } from "@/lib/models";

const CARE = "/care";
const SCRIPTS = [`${CARE}/body-selector.js`, `${CARE}/care-models.js`, `${CARE}/care-result.js`, `${CARE}/care-pages.js`];
// models-inline.js (6 MB base64 fallback for file:// use) is deliberately not loaded: the .glb files are served over HTTP.

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[data-care="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.dataset.care = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}
let sdk: Promise<void> | null = null;
const loadSdk = () => (sdk ??= SCRIPTS.reduce((p, s) => p.then(() => loadScript(s)), Promise.resolve()));

type Hosp = { department: string; departments?: string[]; scope?: Scope; top3?: { label: string }[] };

export default function Page() {
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [hosp, setHosp] = useState<Hosp | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("care-root");
    return () => document.documentElement.classList.remove("care-root");
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    loadSdk()
      .then(() => {
        setReady(true);
        const w = window as any;
        const q = (s: string) => document.querySelector(s) as any;
        const el = q("health-body-selector"), result = q("care-result-screen");
        const header = q("care-app-header"), pages = q("care-info-page");
        w.CareModels.configure({ modelApi: MODEL_API, riskApi: RISK_API });

        let lastInput: any = null, runId = 0;
        async function analyse(input: any) {
          lastInput = input;
          const mine = ++runId;
          result.showLoading();
          const res = await w.CareModels.run(input);
          if (mine !== runId) return; // person went back / started again
          if (res.ok) result.showResult(res);
          else
            result.showError(`The department model didn't respond (${res.errors.predict ?? "not connected"}). Please check that the model server is running, then try again.`);
        }
        const onOpenPage = (e: any) => pages.show(e.detail.page);
        const onSubmit = (e: any) => analyse({ text: e.detail.aiPromptText, sex: e.detail.anatomicalProfile });
        const onRetry = () => lastInput && analyse(lastInput);
        const onBack = () => { runId++; };
        const onHospitals = (e: any) => setHosp(e.detail);
        const onAlert = (e: any) => {
          e.detail.handled = true;
          e.detail.message = "Demo only: the real app would send your alert, current description and location to your emergency contacts.";
        };
        header.addEventListener("care-open-page", onOpenPage);
        el.addEventListener("body-selection-submit", onSubmit);
        result.addEventListener("care-result-retry", onRetry);
        result.addEventListener("care-result-back", onBack);
        result.addEventListener("care-open-hospitals", onHospitals);
        el.addEventListener("care-emergency-alert", onAlert);
        off = () => {
          header.removeEventListener("care-open-page", onOpenPage);
          el.removeEventListener("body-selection-submit", onSubmit);
          result.removeEventListener("care-result-retry", onRetry);
          result.removeEventListener("care-result-back", onBack);
          result.removeEventListener("care-open-hospitals", onHospitals);
          el.removeEventListener("care-emergency-alert", onAlert);
        };
      })
      .catch((e) => setLoadErr(String(e.message ?? e)));
    return () => off?.();
  }, []);

  // The result screen says what the person chose: best department only, hospitals with all three, or any hospital.
  const labels = hosp ? (hosp.departments?.length ? hosp.departments : [hosp.department, ...(hosp.top3 ?? []).map((t) => t.label)]).filter((v: string, i: number, a: string[]) => v && a.indexOf(v) === i) : [];
  const scope: Scope = hosp?.scope ?? "primary";

  return (
    <>
      <care-app-header></care-app-header>
      <health-body-selector
        emergency-number="999"
        model-src-female={`${CARE}/models/basic_human_female.glb`}
        model-src-male={`${CARE}/models/basic_male_model.glb`}
        model-pose-female="12"
        model-pose-male="12"
        three-src={`${CARE}/vendor/three.module.js`}
      ></health-body-selector>
      <care-result-screen emergency-number="999"></care-result-screen>
      <care-info-page></care-info-page>
      {!booted && <BootScreen sdkReady={ready} loadErr={loadErr} onDone={() => setBooted(true)} />}
      {hosp && <HospitalMapScreen labels={labels} scope={scope} onClose={() => setHosp(null)} />}
    </>
  );
}
