/* Care Anatomy - model runner (mock + real).
 *
 *   CareModels.configure({ modelApi, riskApi })   // leave both empty => built-in MOCK models are used
 *   const { predict, risk, errors, ok } = await CareModels.run({ text, sex });
 *
 * Output formats (the contract the result screen expects):
 *   predict -> { "mode": "single" | "multi" | "unsure", "top3_sum": 0.768,
 *                "departments": [ ["Respiratory", 0.619], ["Cardiology", 0.096], ... ] }
 *              (the format of select_departments() in calibrate_thresholds_2.ipynb; each department may also be
 *               { "label", "score" }. The old { "top3": [ { label, score }, ... ] } shape is still accepted.)
 *   risk    -> { "emergency": true | false }        (a dummy flag, not an AI model; the older { "risk": "High" } counts as emergency)
 *
 * REAL models:  POST {modelApi}/predict {text}        POST {riskApi}/risk {text, sex}
 * MOCK models:  two small keyword-based stand-ins with a fake delay, so the loading screen can be tested.
 * To plug in your real models later, only call CareModels.configure(...) with their base URLs
 * (or replace mockPredict / mockRisk below). Nothing else in the UI changes.
 */
(function (root) {
  "use strict";

  var cfg = { modelApi: "", riskApi: "", timeoutMs: 20000, mockDelayMs: [1800, 3200] };

  /* ------------------------------ MOCK MODEL 1: department ------------------------------ */
  var DEPARTMENTS = [
    ["Cardiology",       /chest|heart|palpitat|pressure|left (arm|hand)|tighten|breath/],
    ["Neurology",        /head|migraine|dizz|numb|tingl|seizure|faint|vision|memory|tremor/],
    ["Gastroenterology", /stomach|tummy|abdom|belly|nausea|vomit|heartburn|diarrh|constipat|bowel|liver/],
    ["Orthopedics",      /knee|bone|joint|back|neck|shoulder|ankle|hip|fracture|sprain|swollen|stiff|muscle/],
    ["Pulmonology",      /cough|lung|wheez|asthma|breath|phlegm|short of breath/],
    ["ENT",              /throat|ear|nose|sinus|tonsil|hearing|hoarse|swallow/],
    ["Dermatology",      /skin|rash|itch|acne|mole|hives|burn|blister/],
    ["Urology",          /urine|urinat|kidney|bladder|prostate/],
    ["Gynecology",       /period|pregnan|pelvic|vagin|menstru|breast/],
    ["General Medicine", /./]
  ];
  function mockPredict(text) {
    var t = String(text || "").toLowerCase();
    var scored = DEPARTMENTS.slice(0, -1).map(function (d) {
      var hits = (t.match(new RegExp(d[1].source, "g")) || []).length;
      return { label: d[0], hits: hits };
    }).sort(function (a, b) { return b.hits - a.hits; });
    var top = scored.filter(function (s) { return s.hits > 0; }).slice(0, 3);
    var fill = ["General Medicine", "Cardiology", "Neurology", "Orthopedics"];
    for (var i = 0; top.length < 3 && i < fill.length; i++)
      if (!top.some(function (s) { return s.label === fill[i]; })) top.push({ label: fill[i], hits: 0 });
    var base = top[0].hits ? 0.9 : 0.55, out = [];
    top.forEach(function (s, k) { out.push([s.label, Math.max(0.05, +(base - k * (top[0].hits ? 0.27 : 0.18)).toFixed(2))]); });
    // same rule as the real model (thresholds from calibrate_thresholds_2.ipynb)
    var sum = Math.min(1, +out.reduce(function (a, d) { return a + d[1]; }, 0).toFixed(3)); // mock scores are not true probabilities
    var mode = out[0][1] >= MOCK_TH.high ? "single" : sum >= MOCK_TH.top3_min ? "multi" : "unsure";
    return { mode: mode, top3_sum: sum, departments: out };
  }
  var MOCK_TH = { high: 0.66, top3_min: 0.71 };

  /* Any accepted predict shape -> { mode, top3Sum, departments:[{label,score}] }  (null if unusable) */
  function normalizePredict(p) {
    if (!p) return null;
    var arr = p.departments || p.top3 || p.top_3 || p.predictions || p.results || (Array.isArray(p) ? p : null);
    if (!arr || !arr.length) return null;
    var items = arr.map(function (x) {
      if (typeof x === "string") return { label: x };
      if (Array.isArray(x)) return { label: x[0], score: x[1] };
      return { label: x.label || x.specialty || x.department || x.name, score: x.score != null ? x.score : x.probability };
    }).filter(function (x) { return x.label; });
    if (!items.length) return null;
    var mode = p.mode === "multi" || p.mode === "unsure" || p.mode === "single" ? p.mode : "single"; // old shape: top item only
    return { mode: mode, top3Sum: p.top3_sum, departments: items };
  }

  /* ------------------------------ MOCK MODEL 2: emergency flag (a dummy, not an AI model) ------------------------------ */
  var EMERGENCY_WORDS = /chest pain|crushing|can'?t breathe|cannot breathe|short of breath|difficulty breathing|faint|unconscious|seizure|stroke|paraly|severe bleeding|bleeding heavily|worst (headache|pain)|suicid|overdose|poison|choking/;
  function mockRisk(text) {
    var t = String(text || "").toLowerCase();
    return { emergency: EMERGENCY_WORDS.test(t) || /strength: (9|10) out of 10/.test(t) };
  }

  /* ------------------------------ plumbing ------------------------------ */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function mockDelay() { var d = cfg.mockDelayMs; return d[0] + Math.random() * (d[1] - d[0]); }

  function realCall(url, body) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, cfg.timeoutMs);
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal })
      .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
      .catch(function (e) { throw new Error(e && e.name === "AbortError" ? "timed out" : (e && e.message) || "failed"); })
      .finally(function () { clearTimeout(timer); });
  }
  function base(u) { return String(u).replace(/\/+$/, ""); }

  function run(o) {
    var text = String((o && o.text) || "").trim(), sex = o && o.sex === "female" ? "female" : "male";
    var useMock = !cfg.modelApi && !cfg.riskApi;
    var p = useMock ? wait(mockDelay()).then(function () { return mockPredict(text); })
                    : cfg.modelApi ? realCall(base(cfg.modelApi) + "/predict", { text: text }) : Promise.resolve(null);
    var r = useMock ? wait(mockDelay()).then(function () { return mockRisk(text); })
                    : cfg.riskApi ? realCall(base(cfg.riskApi) + "/risk", { text: text, sex: sex }) : Promise.resolve(null);
    return Promise.allSettled([p, r]).then(function (x) {
      var out = { predict: null, risk: null, errors: { predict: null, risk: null }, mock: useMock };
      if (x[0].status === "fulfilled") out.predict = x[0].value; else out.errors.predict = x[0].reason.message;
      if (x[1].status === "fulfilled") out.risk = x[1].value; else out.errors.risk = x[1].reason.message;
      out.ok = !!normalizePredict(out.predict); // the emergency flag is optional: without it the result just shows no emergency note
      return out;
    });
  }

  root.CareModels = { configure: function (o) { Object.assign(cfg, o || {}); }, run: run, normalizePredict: normalizePredict, mockPredict: mockPredict, mockRisk: mockRisk };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CareModels;
})(typeof globalThis !== "undefined" ? globalThis : window);
