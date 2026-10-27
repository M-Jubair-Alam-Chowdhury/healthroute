/**
 * The three back-end services the UI talks to.
 *
 *   1. DEPARTMENT model  (your DistilBERT)   POST {MODEL_API}/predict   {text}
 *                                            -> {"mode":"single"|"multi"|"unsure","top3_sum":0.768,
 *                                                "departments":[["Respiratory",0.619],["Cardiology",0.096],...]}
 *                                               (the format of select_departments() in calibrate_thresholds_2.ipynb;
 *                                                the old {"top3":[{label,score}]} shape is still accepted)
 *   2. EMERGENCY flag    (a dummy service)   POST {RISK_API}/risk       {text, sex}
 *                                            -> {"emergency": true | false}
 *   3. hospital-api      (teammates')        GET  {HOSPITAL_API}/hospitals?department=X
 *
 * ── Where the risk model plugs in ─────────────────────────────────────────────
 * Set NEXT_PUBLIC_RISK_API in web/.env.local to the address of the emergency-flag service
 * (leave it empty and the UI simply never shows the emergency note).
 * If your service uses different field names, change only predictRisk() below.
 */
import type { Hospital } from "./types";

export const MODEL_API = process.env.NEXT_PUBLIC_MODEL_API || "http://localhost:8001";
export const HOSPITAL_API = process.env.NEXT_PUBLIC_HOSPITAL_API || "http://localhost:8000";
export const RISK_API = process.env.NEXT_PUBLIC_RISK_API || "";

export type Pred = { label: string; score?: number };
/** single = one department · multi = three departments · unsure = not sure (the three closest are still listed) */
export type DeptMode = "single" | "multi" | "unsure";
export type DeptResult = { mode: DeptMode; top3Sum?: number; departments: Pred[] };

/** Tolerant of a few response shapes — adjust here if your /predict differs. */
export function normalizeDept(p: any): DeptResult | null {
  const arr = p?.departments ?? p?.top3 ?? p?.top_3 ?? p?.predictions ?? p?.results ?? (Array.isArray(p) ? p : null);
  let items: Pred[] = [];
  if (arr) {
    items = arr
      .map((x: any): Pred =>
        typeof x === "string"
          ? { label: x }
          : Array.isArray(x) // select_departments() gives [name, probability] pairs
            ? { label: x[0], score: x[1] }
            : { label: x.label ?? x.specialty ?? x.department ?? x.class ?? x.name, score: x.score ?? x.probability ?? x.confidence }
      )
      .filter((x: Pred) => x.label);
  } else {
    const one = p?.label ?? p?.specialty ?? p?.department;
    if (one) items = [{ label: one, score: p?.score }];
  }
  if (!items.length) return null;
  const mode: DeptMode = p?.mode === "multi" || p?.mode === "unsure" ? p.mode : "single"; // old shape: top item only
  return { mode, top3Sum: p?.top3_sum, departments: items };
}

/** Model 1 — department. Throws if the service can't be reached or returns nothing usable. */
export async function predictDepartment(text: string): Promise<DeptResult> {
  const res = await fetch(`${MODEL_API}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`The department model answered ${res.status}.`);
  const out = normalizeDept(await res.json());
  if (!out) throw new Error("The department model's answer had no departments (see normalizeDept() in src/lib/models.ts).");
  return out;
}

export type RiskResult =
  | { status: "ok"; emergency: boolean }
  | { status: "not-connected" }
  | { status: "error" };

/** Model 2 — emergency flag (a dummy service). Never throws: a missing/failed one must not block the department result. */
export async function predictRisk(text: string, sex: "Female" | "Male"): Promise<RiskResult> {
  if (!RISK_API) return { status: "not-connected" };
  try {
    const res = await fetch(`${RISK_API}/risk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sex: sex.toLowerCase() }),
    });
    if (!res.ok) return { status: "error" };
    const j = await res.json();
    if (j?.emergency != null) return { status: "ok", emergency: j.emergency === true || String(j.emergency).toLowerCase() === "true" };
    if (j?.risk != null) return { status: "ok", emergency: String(j.risk).toLowerCase() === "high" }; // older risk service
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** hospital-api rows -> the map module's Hospital shape. */
export async function fetchHospitalsFor(department: string): Promise<Hospital[]> {
  const res = await fetch(`${HOSPITAL_API}/hospitals?department=${encodeURIComponent(department)}`);
  if (!res.ok) throw new Error(`The hospital service answered ${res.status}.`);
  const rows: any[] = await res.json();
  return rows.map((h) => ({
    id: String(h.id),
    name: h.display_name,
    latitude: h.lat,
    longitude: h.lng,
    address: h.address ?? undefined,
    department,
  }));
}

/** What the person asked for on the result screen. */
export type Scope = "primary" | "all" | "any";

/**
 * Hospitals that offer ALL the given departments ("take the safer step" / "multi" mode).
 * hospital-api does the matching:  GET /hospitals?department=A&department=B&department=C&match=most
 * ("most" = every department if any hospital has all of them, otherwise the best available).
 * `matched` is how many of the departments those hospitals offer; matched < total means nobody has them all.
 */
export async function fetchHospitalsCovering(labels: string[]): Promise<{ rows: Hospital[]; matched: number; total: number }> {
  const qs = labels.map((l) => `department=${encodeURIComponent(l)}`).join("&");
  const res = await fetch(`${HOSPITAL_API}/hospitals?${qs}&match=most`);
  if (!res.ok) throw new Error(`The hospital service answered ${res.status}.`);
  const rows: any[] = await res.json();
  if (rows.length && rows[0].matched == null) {
    throw new Error("The hospital service is an old version (no multi-department matching). Please use the updated hospital-api.");
  }
  const matched = rows.reduce((m, h) => Math.max(m, h.matched ?? 0), 0);
  return {
    rows: rows.map((h) => ({
      id: String(h.id),
      name: h.display_name,
      latitude: h.lat,
      longitude: h.lng,
      address: h.address ?? undefined,
      department: labels.join(", "),
    })),
    matched,
    total: labels.length,
  };
}

/** Any hospital at all (the model was unsure): GET /hospitals with no filter. */
export async function fetchAllHospitals(): Promise<Hospital[]> {
  const res = await fetch(`${HOSPITAL_API}/hospitals`);
  if (!res.ok) throw new Error(`The hospital service answered ${res.status}.`);
  const rows: any[] = await res.json();
  return rows.map((h) => ({
    id: String(h.id),
    name: h.display_name,
    latitude: h.lat,
    longitude: h.lng,
    address: h.address ?? undefined,
  }));
}
