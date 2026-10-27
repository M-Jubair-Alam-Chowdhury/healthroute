"use client";

/**
 * GLUE PAGE — the only new logic in this demo.
 * your text -> model (/predict) -> specialty -> hospital-api (/hospitals?department=) -> map module.
 * Neither hospital-api nor hospital-map-module is modified.
 */
import { useCallback, useEffect, useState } from "react";
import { HospitalMapModule } from "@/components/hospital-map";
import type { Hospital } from "@/lib/types";
import { normalizeDept } from "@/lib/models";

const MODEL_API = process.env.NEXT_PUBLIC_MODEL_API ?? "http://localhost:8001";
const HOSPITAL_API = process.env.NEXT_PUBLIC_HOSPITAL_API ?? "http://localhost:8000";

type Pred = { label: string; score?: number };

// Tolerant of different /predict response shapes (see normalizeDept in src/lib/models.ts).
const normalize = (p: any): Pred[] => normalizeDept(p)?.departments ?? [];

const EXAMPLES = [
  "I have chest pain and my heart feels like it is racing",
  "my child has a high fever and a cough",
  "severe headache, dizziness and numbness in my arm",
  "pain when urinating and lower back pain",
  "blurry vision and red itchy eyes",
];

function Dot({ ok }: { ok: boolean | null }) {
  const color = ok === null ? "#9ca3af" : ok ? "#16a34a" : "#dc2626";
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9999, background: color, marginRight: 6 }} />;
}

export default function SymptomsPage() {
  const [text, setText] = useState(EXAMPLES[0]);
  const [preds, setPreds] = useState<Pred[]>([]);
  const [dept, setDept] = useState<string | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[] | undefined>();
  const [departments, setDepartments] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelUp, setModelUp] = useState<boolean | null>(null);
  const [apiUp, setApiUp] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${MODEL_API}/`).then((r) => setModelUp(r.ok)).catch(() => setModelUp(false));
    fetch(`${HOSPITAL_API}/departments`)
      .then((r) => r.json())
      .then((d: { name: string }[]) => { setApiUp(true); setDepartments(d.map((x) => x.name)); })
      .catch(() => setApiUp(false));
  }, []);

  const loadHospitals = useCallback(async (department: string) => {
    setError(null);
    setDept(department);
    const url = `${HOSPITAL_API}/hospitals?department=${encodeURIComponent(department)}`;
    setLog((l) => [...l, `GET ${url}`]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`hospital-api answered ${res.status}`);
    const rows: any[] = await res.json();
    if (rows.length === 0) {
      setHospitals(undefined);
      setError(`hospital-api has no hospitals for "${department}". Does your model's label match a name from /departments?`);
      return;
    }
    // The conversion: API shape -> map module shape.
    setHospitals(
      rows.map((h) => ({
        id: String(h.id),
        name: h.display_name,
        latitude: h.lat,
        longitude: h.lng,
        address: h.address ?? undefined,
        department,
      }))
    );
    setLog((l) => [...l, `-> ${rows.length} hospitals converted and passed to <HospitalMapModule hospitals={...}/>`]);
  }, []);

  async function run() {
    setBusy(true); setError(null); setLog([]); setPreds([]); setHospitals(undefined); setDept(null);
    try {
      setLog([`POST ${MODEL_API}/predict  {"text": "${text.slice(0, 40)}..."}`]);
      const res = await fetch(`${MODEL_API}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`model answered ${res.status}`);
      const raw = await res.json();
      const p = normalize(raw);
      if (!p.length) throw new Error("Could not find specialties in the model response (see normalize() in this file).");
      setPreds(p);
      setLog((l) => [...l, `-> model says (${raw?.mode ?? "single"}): ${p.map((x) => x.label).join(", ")}`]);
      await loadHospitals(p[0].label);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 60px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>HealthAI Navigator — developer view (status + raw flow)</h1>
      <p style={{ color: "#555", margin: "4px 0 14px", fontSize: 14 }}>
        <Dot ok={modelUp} />model API ({MODEL_API}) &nbsp;&nbsp;
        <Dot ok={apiUp} />hospital API ({HOSPITAL_API}) {apiUp && `· ${departments.length} departments`}
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{ width: "100%", padding: 10, fontSize: 15, border: "1px solid #ccc", borderRadius: 8, boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => setText(ex)} style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #ddd", background: "#f7f7f7", borderRadius: 9999, cursor: "pointer" }}>
            {ex.length > 34 ? ex.slice(0, 34) + "…" : ex}
          </button>
        ))}
      </div>
      <button onClick={run} disabled={busy || !text.trim()} style={{ padding: "9px 18px", fontSize: 15, borderRadius: 8, border: 0, background: "#0f766e", color: "#fff", cursor: "pointer" }}>
        {busy ? "Working…" : "Find hospitals"}
      </button>

      {error && <p style={{ color: "#b91c1c", background: "#fef2f2", padding: 10, borderRadius: 8, marginTop: 12, fontSize: 14 }}>{error}</p>}

      {preds.length > 0 && (
        <div style={{ margin: "14px 0", fontSize: 14 }}>
          <b>Model’s top specialties</b> (click one to switch):
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {preds.map((p) => (
              <button
                key={p.label}
                onClick={() => loadHospitals(p.label).catch((e) => setError(String(e.message ?? e)))}
                style={{ padding: "6px 12px", borderRadius: 8, cursor: "pointer", border: p.label === dept ? "2px solid #0f766e" : "1px solid #ccc", background: p.label === dept ? "#ecfdf5" : "#fff" }}
              >
                {p.label}{p.score !== undefined && ` · ${Math.round(p.score * 100)}%`}
                {departments.length > 0 && !departments.some((d) => d.toLowerCase() === p.label.toLowerCase()) && " ⚠ not in API"}
              </button>
            ))}
          </div>
        </div>
      )}

      {log.length > 0 && (
        <pre style={{ background: "#f4f4f5", padding: 10, borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap", margin: "10px 0" }}>{log.join("\n")}</pre>
      )}

      {hospitals && (
        <div style={{ marginTop: 14 }}>
          <HospitalMapModule hospitals={hospitals} limit={10} height="h-[75dvh] md:h-[640px]" />
        </div>
      )}
    </main>
  );
}
