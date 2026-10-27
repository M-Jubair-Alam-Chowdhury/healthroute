/* Care Anatomy SDK — embeddable anatomical input component.
 * Version: 0.13.0
 * A single-screen, phone-first flow: tap the body, add strength / timing / inside-the-body hints, continue. Built around an
 * interactive 3D human model (turn, zoom, tap to select) with a 2D fallback.
 * Region IDs and the handoff payload are shared by both renderers.
 * Input UI only: not a diagnostic tool or a validated medical atlas.
 */
(() => {
  "use strict";
  const VERSION = "0.13.0";
  const SCHEMA_VERSION = "1.1";

  /* ====================================================================
   * 1. ROUTING HINTS (body system -> specialty hints for doctor search)
   *    NOT a diagnosis. Have clinicians review this table before launch.
   * ==================================================================== */
  const SYSTEMS = {
    neuro:         { label: "Head & nervous system",   specialties: ["Neurology", "Neurosurgery"] },
    eye:           { label: "Eyes",                    specialties: ["Ophthalmology"] },
    ent:           { label: "Ear, nose & throat",      specialties: ["ENT (Otolaryngology)"] },
    dental:        { label: "Mouth, teeth & jaw",      specialties: ["Dentistry", "Oral & maxillofacial surgery"] },
    endocrine:     { label: "Endocrine / hormones",    specialties: ["Endocrinology"] },
    cardio:        { label: "Heart & circulation",     specialties: ["Cardiology"] },
    resp:          { label: "Lungs & airways",         specialties: ["Pulmonology / chest medicine"] },
    breast:        { label: "Breast & chest wall",     specialties: ["Breast clinic / general surgery"] },
    gi:            { label: "Digestive system",        specialties: ["Gastroenterology", "General surgery"] },
    anorectal:     { label: "Anus & rectum",           specialties: ["Colorectal surgery", "General surgery"] },
    urinary:       { label: "Urinary system",          specialties: ["Urology", "Nephrology"] },
    genitourinary: { label: "Genital & urinary area",  specialties: ["Urology", "Gynecology"] },
    female_repro:  { label: "Female reproductive",     specialties: ["Gynecology & obstetrics"] },
    male_repro:    { label: "Male reproductive",       specialties: ["Urology"] },
    msk:           { label: "Bones, joints & muscles", specialties: ["Orthopedics", "Physical medicine & rehabilitation", "Rheumatology"] },
    general:       { label: "General / unspecified",   specialties: ["General physician (internal medicine)"] }
  };

  /* ====================================================================
   * 2. GEOMETRY HELPERS
   * ==================================================================== */
  const n1 = v => Math.round(v * 10) / 10;
  const pt = (x, y) => n1(x) + " " + n1(y);
  const poly = pts => "M" + pts.map(p => pt(p[0], p[1])).join("L") + "Z";
  const ell = (cx, cy, rx, ry) =>
    `M${pt(cx - rx, cy)}A${n1(rx)} ${n1(ry)} 0 1 0 ${pt(cx + rx, cy)}A${n1(rx)} ${n1(ry)} 0 1 0 ${pt(cx - rx, cy)}Z`;
  const rr = (x, y, w, h, r) =>
    `M${pt(x + r, y)}H${n1(x + w - r)}Q${pt(x + w, y)} ${pt(x + w, y + r)}V${n1(y + h - r)}Q${pt(x + w, y + h)} ${pt(x + w - r, y + h)}H${n1(x + r)}Q${pt(x, y + h)} ${pt(x, y + h - r)}V${n1(y + r)}Q${pt(x, y)} ${pt(x + r, y)}Z`;

  // Catmull-Rom -> cubic Bezier spline through points.
  function spline(pts, closed) {
    const n = pts.length;
    const g = i => closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    let d = "M" + pt(pts[0][0], pts[0][1]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      d += "C" + pt(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6) + " " +
                 pt(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6) + " " + pt(p2[0], p2[1]);
    }
    return d + (closed ? "Z" : "");
  }
  // A limb / digit as a smooth closed outline around stations [x, y, halfWidth].
  function tube(st, capA = 0.5, capB = 0.9) {
    const L = [], R = [];
    st.forEach((s, i) => {
      const a = st[Math.max(0, i - 1)], b = st[Math.min(st.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
      L.push([s[0] + ty * s[2], s[1] - tx * s[2]]);
      R.push([s[0] - ty * s[2], s[1] + tx * s[2]]);
    });
    const f = st[0], l = st[st.length - 1];
    const a = st[Math.min(1, st.length - 1)], b = st[Math.max(0, st.length - 2)];
    let t0x = f[0] - a[0], t0y = f[1] - a[1], m0 = Math.hypot(t0x, t0y) || 1;
    let t1x = l[0] - b[0], t1y = l[1] - b[1], m1 = Math.hypot(t1x, t1y) || 1;
    const c0 = [f[0] + t0x / m0 * f[2] * capA, f[1] + t0y / m0 * f[2] * capA];
    const c1 = [l[0] + t1x / m1 * l[2] * capB, l[1] + t1y / m1 * l[2] * capB];
    return spline([...L, c1, ...R.reverse(), c0], true);
  }
  function capsule(x1, y1, x2, y2, w) {
    const r = w / 2, dx = x2 - x1, dy = y2 - y1, m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m * r, ny = dx / m * r;
    return `M${pt(x1 + nx, y1 + ny)}L${pt(x2 + nx, y2 + ny)}A${n1(r)} ${n1(r)} 0 0 0 ${pt(x2 - nx, y2 - ny)}L${pt(x1 - nx, y1 - ny)}A${n1(r)} ${n1(r)} 0 0 0 ${pt(x1 + nx, y1 + ny)}Z`;
  }
  const mirrorPt = p => [300 - p[0], p[1]];
  // Symmetric closed outline from a half list that starts & ends on the centreline.
  const fullFromHalf = half => half.concat(half.slice(1, -1).reverse().map(mirrorPt));
  // Full polygon from a half polygon (x >= 150) so centre regions have no seam.
  function fp(pts) {
    const all = pts.concat(pts.slice().reverse().map(mirrorPt)), out = [];
    all.forEach(p => { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); });
    const f = out[0], l = out[out.length - 1];
    if (out.length > 1 && f[0] === l[0] && f[1] === l[1]) out.pop();
    return poly(out);
  }
  const MIRROR = "translate(300 0) scale(-1 1)";
  const both = inner => inner + `<g transform="${MIRROR}">${inner}</g>`;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ====================================================================
   * 3. REGION CATALOGUE  (stable IDs — extends the 0.2 ID set)
   *    left / right always mean the PATIENT's own left / right.
   * ==================================================================== */
  const LAYERS = ["external", "internal", "skeleton"];
  const REG = Object.create(null);
  const LIST = { external: [], internal: [], skeleton: [] };
  const GROUPS = Object.create(null);

  function reg(layer, id, label, category, system, members) {
    const e = { id, label, category, layer, systems: [].concat(system || "general") };
    if (members) { e.members = members; GROUPS[id] = members; }
    REG[id] = e; LIST[layer].push(e);
  }
  function pair(layer, name, tpl, category, system) {
    ["left", "right"].forEach(s => reg(layer, `${s}-${name}`,
      tpl.replace("{Side}", cap(s)).replace("{side}", s), category.replace("{Side}", cap(s)), system));
  }
  const sides = (names) => ["left", "right"].reduce((a, s) => a.concat(names.map(n => `${s}-${n}`)), []);

  (function buildCatalogue() {
    const E = "external", I = "internal", S = "skeleton";
    /* ---- external body ---- */
    reg(E, "head", "Head (whole head)", "Head", "neuro",
      ["scalp", "forehead", "back-of-head", ...sides(["temple", "ear", "eye", "cheek"]), "nose", "mouth", "chin", "jaw"]);
    reg(E, "face", "Face (whole face)", "Head", "general",
      ["forehead", ...sides(["temple", "eye", "cheek", "ear"]), "nose", "mouth", "chin", "jaw"]);
    reg(E, "scalp", "Scalp / top of head", "Head", "neuro");
    reg(E, "forehead", "Forehead", "Head", "neuro");
    reg(E, "back-of-head", "Back of head", "Head", "neuro");
    pair(E, "temple", "{Side} temple", "Head", "neuro");
    pair(E, "eye", "{Side} eye", "Face", "eye");
    pair(E, "ear", "{Side} ear", "Face", "ent");
    reg(E, "nose", "Nose", "Face", "ent");
    pair(E, "cheek", "{Side} cheek", "Face", "general");
    reg(E, "mouth", "Mouth / lips", "Face", ["dental", "ent"]);
    reg(E, "chin", "Chin", "Face", "dental");
    reg(E, "jaw", "Jaw", "Face", ["dental", "msk"]);
    reg(E, "neck", "Neck", "Neck", ["msk", "ent"]);
    reg(E, "throat", "Throat", "Neck", "ent");

    pair(E, "shoulder", "{Side} shoulder", "{Side} arm", "msk");
    pair(E, "armpit", "{Side} armpit", "{Side} arm", ["general", "breast"]);
    pair(E, "upper-arm", "{Side} upper arm", "{Side} arm", "msk");
    pair(E, "elbow", "{Side} elbow", "{Side} arm", "msk");
    pair(E, "forearm", "{Side} forearm", "{Side} arm", "msk");
    pair(E, "wrist", "{Side} wrist", "{Side} hand", "msk");
    ["left", "right"].forEach(s => reg(E, `${s}-hand`, `${cap(s)} hand (whole hand)`, `${cap(s)} hand`, "msk",
      [`${s}-wrist`, `${s}-palm`, `${s}-back-of-hand`, `${s}-thumb`, `${s}-index-finger`, `${s}-middle-finger`, `${s}-ring-finger`, `${s}-little-finger`]));
    pair(E, "palm", "{Side} palm", "{Side} hand", "msk");
    pair(E, "back-of-hand", "Back of {side} hand", "{Side} hand", "msk");
    pair(E, "thumb", "{Side} thumb", "{Side} hand", "msk");
    pair(E, "index-finger", "{Side} index finger", "{Side} hand", "msk");
    pair(E, "middle-finger", "{Side} middle finger", "{Side} hand", "msk");
    pair(E, "ring-finger", "{Side} ring finger", "{Side} hand", "msk");
    pair(E, "little-finger", "{Side} little finger", "{Side} hand", "msk");

    reg(E, "chest", "Chest (ribs & chest wall)", "Torso", ["cardio", "resp"]);
    pair(E, "breast", "{Side} breast", "Torso", "breast");
    reg(E, "sternum", "Breastbone / sternum", "Torso", ["cardio", "msk"]);
    reg(E, "upper-abdomen", "Upper abdomen (all)", "Torso", "gi",
      ["upper-abdomen-center", "left-upper-abdomen", "right-upper-abdomen"]);
    reg(E, "upper-abdomen-center", "Upper abdomen — center", "Torso", "gi");
    pair(E, "upper-abdomen", "Upper abdomen — {side} side", "Torso", "gi");
    pair(E, "flank", "{Side} flank (side of abdomen)", "Torso", ["urinary", "gi"]);
    reg(E, "navel", "Navel / around belly button", "Torso", "gi");
    reg(E, "lower-abdomen", "Lower abdomen (all)", "Torso", "gi",
      ["lower-abdomen-center", "left-lower-abdomen", "right-lower-abdomen"]);
    reg(E, "lower-abdomen-center", "Lower abdomen — center", "Torso", ["gi", "urinary"]);
    pair(E, "lower-abdomen", "Lower abdomen — {side} side", "Torso", ["gi", "urinary"]);
    reg(E, "pelvis", "Pelvis (whole area)", "Pelvis", "genitourinary",
      ["left-groin", "right-groin", "genital-region", "left-hip", "right-hip"]);
    pair(E, "hip", "{Side} hip", "{Side} leg", "msk");
    pair(E, "groin", "{Side} groin", "Pelvis", ["gi", "urinary"]);
    reg(E, "genital-region", "External genital region", "Pelvis", "genitourinary");

    reg(E, "upper-back", "Upper back", "Back", "msk");
    reg(E, "mid-back", "Middle back", "Back", "msk");
    reg(E, "lower-back", "Lower back", "Back", "msk");
    pair(E, "scapula", "{Side} shoulder blade", "Back", "msk");
    reg(E, "tailbone", "Tailbone", "Back", "msk");
    pair(E, "buttock", "{Side} buttock", "Back", "msk");
    reg(E, "anal-region", "Anal region", "Back", "anorectal");

    pair(E, "thigh-front", "{Side} front thigh", "{Side} leg", "msk");
    pair(E, "thigh-back", "{Side} back thigh", "{Side} leg", "msk");
    pair(E, "knee", "{Side} knee", "{Side} leg", "msk");
    pair(E, "back-of-knee", "Back of {side} knee", "{Side} leg", "msk");
    pair(E, "shin", "{Side} shin", "{Side} leg", "msk");
    pair(E, "calf", "{Side} calf", "{Side} leg", "msk");
    pair(E, "achilles", "{Side} Achilles tendon", "{Side} foot", "msk");
    pair(E, "ankle", "{Side} ankle", "{Side} foot", "msk");
    ["left", "right"].forEach(s => {
      reg(E, `${s}-foot`, `${cap(s)} foot (whole foot)`, `${cap(s)} foot`, "msk",
        [`${s}-ankle`, `${s}-foot-top`, `${s}-sole`, `${s}-heel`, `${s}-big-toe`, `${s}-second-toe`, `${s}-third-toe`, `${s}-fourth-toe`, `${s}-little-toe`]);
    });
    pair(E, "foot-top", "Top of {side} foot", "{Side} foot", "msk");
    pair(E, "sole", "{Side} sole", "{Side} foot", "msk");
    pair(E, "heel", "{Side} heel", "{Side} foot", "msk");
    pair(E, "big-toe", "{Side} big toe", "{Side} foot", "msk");
    pair(E, "second-toe", "{Side} second toe", "{Side} foot", "msk");
    pair(E, "third-toe", "{Side} third toe", "{Side} foot", "msk");
    pair(E, "fourth-toe", "{Side} fourth toe", "{Side} foot", "msk");
    pair(E, "little-toe", "{Side} little toe", "{Side} foot", "msk");
    ["left", "right"].forEach(s => reg(E, `${s}-other-toes`, `Other ${s} toes`, `${cap(s)} foot`, "msk",
      [`${s}-second-toe`, `${s}-third-toe`, `${s}-fourth-toe`, `${s}-little-toe`]));

    /* ---- internal organs ---- */
    reg(I, "brain", "Brain", "Head", "neuro");
    reg(I, "eyes", "Eyes (eyeballs)", "Head", "eye");
    reg(I, "sinuses", "Sinuses", "Head", "ent");
    reg(I, "teeth", "Teeth", "Head", "dental");
    reg(I, "larynx", "Larynx / voice box", "Neck", "ent");
    reg(I, "thyroid", "Thyroid", "Neck", "endocrine");
    reg(I, "trachea", "Trachea / windpipe", "Chest", "resp");
    reg(I, "esophagus", "Esophagus / food pipe", "Chest", "gi");
    reg(I, "heart", "Heart", "Chest", "cardio");
    reg(I, "left-lung", "Left lung", "Chest", "resp");
    reg(I, "right-lung", "Right lung", "Chest", "resp");
    reg(I, "left-breast-tissue", "Left breast tissue", "Chest", "breast");
    reg(I, "right-breast-tissue", "Right breast tissue", "Chest", "breast");
    reg(I, "liver", "Liver", "Upper abdomen", "gi");
    reg(I, "gallbladder", "Gallbladder", "Upper abdomen", "gi");
    reg(I, "stomach", "Stomach", "Upper abdomen", "gi");
    reg(I, "pancreas", "Pancreas", "Upper abdomen", ["gi", "endocrine"]);
    reg(I, "spleen", "Spleen", "Upper abdomen", "general");
    reg(I, "adrenal-glands", "Adrenal glands", "Back / abdomen", "endocrine");
    reg(I, "right-kidney", "Right kidney", "Back / abdomen", "urinary");
    reg(I, "left-kidney", "Left kidney", "Back / abdomen", "urinary");
    reg(I, "small-intestine", "Small intestine", "Abdomen", "gi");
    reg(I, "large-intestine", "Large intestine / colon", "Abdomen", "gi");
    reg(I, "appendix", "Appendix", "Lower abdomen", "gi");
    reg(I, "ureters", "Ureters", "Pelvis", "urinary");
    reg(I, "bladder", "Urinary bladder", "Pelvis", "urinary");
    reg(I, "rectum", "Rectum", "Pelvis", ["gi", "anorectal"]);
    reg(I, "uterus", "Uterus (womb)", "Pelvis", "female_repro");
    reg(I, "ovaries", "Ovaries", "Pelvis", "female_repro");
    reg(I, "fallopian-tubes", "Fallopian tubes", "Pelvis", "female_repro");
    reg(I, "prostate", "Prostate", "Pelvis", "male_repro");
    reg(I, "testes", "Testes", "Pelvis", "male_repro");

    /* ---- skeleton ---- */
    reg(S, "skull", "Skull", "Head", ["neuro", "msk"]);
    reg(S, "jawbone", "Jawbone (mandible)", "Head", ["dental", "msk"]);
    reg(S, "cervical-spine", "Neck spine (cervical)", "Spine", "msk");
    reg(S, "thoracic-spine", "Upper & mid spine (thoracic)", "Spine", "msk");
    reg(S, "lumbar-spine", "Lower spine (lumbar)", "Spine", "msk");
    reg(S, "sacrum", "Sacrum", "Spine", "msk");
    reg(S, "coccyx", "Tailbone (coccyx)", "Spine", "msk");
    reg(S, "sternum-bone", "Breastbone (sternum)", "Chest", "msk");
    pair(S, "ribs", "{Side} ribs", "Chest", ["msk", "resp"]);
    pair(S, "clavicle", "{Side} collarbone", "{Side} arm", "msk");
    pair(S, "scapula-bone", "{Side} shoulder blade (bone)", "{Side} arm", "msk");
    pair(S, "humerus", "{Side} upper arm bone (humerus)", "{Side} arm", "msk");
    pair(S, "radius", "{Side} radius (forearm, thumb side)", "{Side} arm", "msk");
    pair(S, "ulna", "{Side} ulna (forearm, little-finger side)", "{Side} arm", "msk");
    pair(S, "wrist-bones", "{Side} wrist bones", "{Side} hand", "msk");
    pair(S, "hand-bones", "{Side} hand bones (palm)", "{Side} hand", "msk");
    pair(S, "finger-bones", "{Side} finger & thumb bones", "{Side} hand", "msk");
    pair(S, "hip-bone", "{Side} hip bone (pelvis)", "Pelvis", "msk");
    pair(S, "femur", "{Side} thigh bone (femur)", "{Side} leg", "msk");
    pair(S, "patella", "{Side} kneecap", "{Side} leg", "msk");
    pair(S, "tibia", "{Side} shin bone (tibia)", "{Side} leg", "msk");
    pair(S, "fibula", "{Side} fibula", "{Side} leg", "msk");
    pair(S, "ankle-bones", "{Side} ankle & heel bones", "{Side} foot", "msk");
    pair(S, "foot-bones", "{Side} foot bones", "{Side} foot", "msk");
    pair(S, "toe-bones", "{Side} toe bones", "{Side} foot", "msk");
    pair(S, "shoulder-joint", "{Side} shoulder joint", "Joints", "msk");
    pair(S, "elbow-joint", "{Side} elbow joint", "Joints", "msk");
    pair(S, "wrist-joint", "{Side} wrist joint", "Joints", "msk");
    pair(S, "hip-joint", "{Side} hip joint", "Joints", "msk");
    pair(S, "knee-joint", "{Side} knee joint", "Joints", "msk");
    pair(S, "ankle-joint", "{Side} ankle joint", "Joints", "msk");
  })();

  /* ====================================================================
   * 4. HAND & FOOT SHAPES (local coordinates, reused by every view)
   *    Hand: wrist at (0,0), fingers point +y, thumb on +x (lateral).
   *    Foot: ankle at (0,0), toes point +y, big toe on -x (medial).
   * ==================================================================== */
  const HAND = (() => {
    const palm = spline([[0, -4], [9.5, -3], [12.5, 12], [14.8, 28], [14, 38], [0, 40.5], [-14, 38], [-14.8, 28], [-12.5, 12], [-9.5, -3]], true);
    const defs = [["index-finger", 10.6, 29, 6.3, 2.6], ["middle-finger", 3.7, 32, 6.5, 0.8], ["ring-finger", -3.1, 29, 6.1, -1.4], ["little-finger", -9.6, 23, 5.3, -3.8]];
    const digits = {};
    defs.forEach(([k, x0, len, w, dx]) => {
      digits[k] = {
        d: tube([[x0, 35, w / 2], [x0 + dx * 0.5, 35 + len * 0.5, w / 2 * 0.97], [x0 + dx, 35 + len, w / 2 * 0.85]], 0, 0.9),
        base: [x0, 36], tip: [x0 + dx, 35 + len], w, len, dx
      };
    });
    const tst = [[10, 12, 6], [14, 22, 5.6], [17.5, 32, 5], [20, 42, 4.4]];
    digits.thumb = { d: tube(tst, 0.2, 0.9), base: [10, 10], tip: [20, 42], w: 9, len: 40, dx: 16 };
    const order = ["thumb", "index-finger", "middle-finger", "ring-finger", "little-finger"];
    const stub = tube([[0, -34, 9.6], [0, -2, 9.8]], 0, 0);
    const wristRegion = poly([[-14, -16], [14, -16], [14, 3], [-14, 3]]);
    // surface detail (strokes)
    const nails = order.map(k => { const d = digits[k]; const w = d.w * 0.6; return rr(d.tip[0] - w / 2 - (k === "thumb" ? 0.5 : 0), d.tip[1] - 6.2, w, 5.2, 1.8); }).join("");
    const palmar = "M-12.8 20 Q-1 15 11.6 21M-12.4 29 Q0 23.5 9 15M8.4 3 Q3 17 9.4 31" +
      defs.map(([k, x0, len, w, dx]) => [0.34, 0.68].map(f => `M${n1(x0 + dx * f - w * 0.3)} ${n1(36 + len * f)}L${n1(x0 + dx * f + w * 0.3)} ${n1(36 + len * f)}`).join("")).join("") ;
    const dorsal = defs.map(([k, x0]) => `M${n1(x0 - 2.6)} 35.4Q${n1(x0)} 33.2 ${n1(x0 + 2.6)} 35.4M${n1(x0)} 4L${n1(x0)} 31`).join("") +
      "M-8 2Q-4 18 -8 31";
    return { palm, digits, order, stub, wristRegion, nails, palmar, dorsal };
  })();

  const FOOT = (() => {
    const top = spline([[-11, -4], [11, -4], [14, 8], [17, 22], [20.5, 34], [22.5, 44], [10, 50], [-6, 50], [-17, 48], [-16, 36], [-13, 22], [-12, 8]], true);
    const plantar = spline([[-9, -20], [0, -23], [10, -20], [13, -8], [14.5, 6], [17, 22], [20.5, 34], [22.5, 44], [10, 50], [-6, 50], [-17, 48], [-16, 36], [-12, 24], [-10, 12], [-10.5, 0], [-11, -10]], true);
    const toeDef = [
      ["big-toe", [[-11, 42, 6.4], [-11, 56, 6], [-10.6, 68, 5.4]], 12],
      ["second-toe", [[-0.8, 44, 3.9], [0, 55, 3.7], [0.5, 65, 3.2]], 7.4],
      ["third-toe", [[6.4, 45, 3.5], [7.2, 54, 3.3], [7.6, 61, 2.9]], 6.6],
      ["fourth-toe", [[12.4, 46, 3.3], [13.4, 53, 3.1], [14, 58, 2.7]], 6],
      ["little-toe", [[18.6, 47, 2.9], [19.8, 52, 2.7], [20.6, 56, 2.4]], 5.2]
    ];
    const toes = {};
    toeDef.forEach(([k, st, w]) => { toes[k] = { d: tube(st, 0, 0.9), st, w, tip: st[st.length - 1] }; });
    const order = toeDef.map(t => t[0]);
    const stub = tube([[0, -34, 11], [0, -2, 11.4]], 0, 0);
    const ankleRegion = poly([[-16, -36], [16, -36], [16, 6], [-16, 6]]);
    const nails = order.map(k => { const t = toes[k]; const w = t.w * 0.62; return rr(t.tip[0] - w / 2, t.tip[1] - 5.4, w, 4.4, 1.6); }).join("");
    const dorsal = "M-7 4Q-6 22 -8 40M0 4Q1 22 1 42M7 4Q9 22 11 42M-12 14Q0 10 12 14";
    const plantarLines = "M-8 8Q0 4 9 8M-9 28Q2 22 14 30M-3 36Q4 41 11 37";
    return { top, plantar, toes, order, stub, ankleRegion, nails, dorsal, plantarLines,
      heelRegion: poly([[-24, -34], [30, -34], [30, 4], [-24, 4]]), soleRegion: poly([[-24, 4], [30, 4], [30, 47], [-24, 47]]) };
  })();

  /* ====================================================================
   * 5. BODY SILHOUETTE  (female / male)
   *    Everything is authored for the viewer's-right half (x >= 150) and
   *    mirrored for the other side. In FRONT view the viewer's-right half is
   *    the patient's LEFT; in BACK view it is the patient's RIGHT.
   * ==================================================================== */
  function dims(sex) {
    const F = sex === "female";
    const hs = F ? 0.96 : 1;
    return {
      F,
      head: [[150, 20], [162, 21.5], [171, 29], [175.5, 42], [176, 56], [174.5, 70], [170, 84], [162, 94], [150, 99.5]].map(p => [150 + (p[0] - 150) * hs, p[1]]),
      neckHW: F ? 14.4 : 16.4,
      torso: F
        ? [[150, 110], [166, 112], [178, 119], [192, 125], [205, 131], [208, 142], [202, 160], [198, 184], [196, 210], [193, 236], [191, 253], [196, 272], [204, 292], [209, 308], [211, 325], [202, 333], [180, 339], [150, 341]]
        : [[150, 110], [167, 112], [180, 119], [196, 125], [212, 131], [216, 142], [210, 160], [204, 184], [201, 210], [198, 236], [196, 254], [199, 272], [204, 292], [207, 308], [208, 325], [198, 333], [178, 339], [150, 341]],
      arm: F
        ? [[207, 138, 17.5], [214, 160, 17.5], [221, 190, 16], [228, 225, 14.2], [233, 248, 12.4], [240, 272, 13.6], [247, 305, 10.6], [253, 334, 8.8]]
        : [[212, 138, 19], [219, 160, 19], [225, 190, 17.5], [231, 225, 15.5], [236, 248, 13.5], [242, 272, 15], [249, 305, 11.5], [255, 334, 9.5]],
      leg: F
        ? [[205, 300], [210, 314], [212, 330], [209, 364], [202, 402], [194, 430], [191, 446], [190, 462], [191, 480], [189, 508], [184, 540], [180, 565], [179, 582], [175, 592], [169.5, 595.5], [164, 592], [159, 582], [160, 560], [162, 525], [160, 492], [159, 468], [159, 448], [159, 428], [156, 396], [153, 362], [152, 342], [158, 318], [180, 300]]
        : [[204, 298], [207, 312], [209, 330], [207, 364], [201, 402], [194, 430], [191.5, 446], [191, 462], [192, 480], [190, 508], [185, 540], [181, 565], [180, 582], [176, 592], [170, 595.5], [164, 592], [159, 582], [160, 560], [162, 525], [160, 492], [159, 468], [158, 448], [158, 428], [156, 396], [153, 362], [152, 342], [158, 318], [180, 300]],
      handTF: `translate(${F ? 253 : 255} 334) rotate(-9) scale(${F ? 0.94 : 1})`,
      footTF: "translate(171.5 586) scale(1 0.55)",
      heel: tube([[169.5, 574, 10.5], [169.5, 596, 13.2], [169.5, 610, 12.4]], 0, 0.9)
    };
  }

  function bodyParts(sex, view) {
    const D = dims(sex);
    const head = spline(fullFromHalf(D.head), true);
    const neck = tube([[150, 88, D.neckHW], [150, 106, D.neckHW], [150, 124, D.neckHW + 1.5]], 0, 0);
    const torso = spline(fullFromHalf(D.torso), true);
    const ear = ell(178.4, 65, 3.6, 7.2);
    const arm = tube(D.arm, 0.3, 0.9);
    const leg = spline(D.leg, true);
    const handDs = [HAND.palm, ...HAND.order.map(k => HAND.digits[k].d)];
    const P = { D, sym: [head, neck, torso], coreSide: [ear, leg], armSide: [arm], side: [ear, arm, leg], loc: [{ tf: D.handTF, ds: handDs }] };
    if (view === "back") { P.side.push(D.heel); P.coreSide.push(D.heel); }
    else P.loc.push({ tf: D.footTF, ds: [FOOT.top, ...FOOT.order.map(k => FOOT.toes[k].d)] });
    return P;
  }

  function clipDefs(P) {
    const paths = a => a.map(d => `<path d="${d}"/>`).join("");
    return `<clipPath id="c-core">${paths(P.sym)}${paths(P.coreSide)}</clipPath>` +
      `<clipPath id="c-arm">${paths(P.armSide)}</clipPath>` +
      `<clipPath id="c-body">${paths(P.sym)}${paths(P.coreSide)}${paths(P.armSide)}</clipPath>`;
  }

  function silhouetteMarkup(P, extraClass, K, filterId) {
    const mk = cls => {
      const side = P.side.map(d => `<path class="${cls}" d="${d}"/>`).join("") +
        P.loc.map(l => `<g transform="${l.tf}">${l.ds.map(d => `<path class="${cls}" d="${d}"/>`).join("")}</g>`).join("");
      return P.sym.map(d => `<path class="${cls}" d="${d}"/>`).join("") + both(side);
    };
    return `<g class="sil ${extraClass || ""}"><g fill="${K.shade}" stroke="${K.shade}" stroke-width="2.4" stroke-linejoin="round">${mk("ss")}</g><g fill="url(#skin)" filter="url(#${filterId || "lit"})">${mk("sf")}</g></g>`;
  }

  /* ====================================================================
   * 6. EXTERNAL REGION GEOMETRY (viewer's-right half, absolute coords)
   * ==================================================================== */
  function extGeo(sex, view) {
    const D = dims(sex), front = view === "front", G = [];
    const add = (k, key, shapes, tf) => G.push({ k, key, shapes, tf });
    const mid = (key, shapes) => add("full", key, shapes);
    const pr = (key, shapes, tf) => add("pair", key, shapes, tf);
    const c = (d, clip, eo) => ({ d, clip, eo });

    // ---- head & neck ----
    if (front) {
      mid("scalp", [c(fp([[150, 4], [204, 4], [204, 50], [191, 48], [177, 41], [163, 36.5], [150, 35.5]]), "core")]);
      mid("forehead", [c(fp([[150, 35.5], [163, 36.5], [177, 41], [178, 51], [150, 51]]), "core")]);
      pr("temple", [c(poly([[177, 41], [191, 48], [204, 50], [204, 66], [184, 66], [172, 57], [178, 51]]), "core")]);
      pr("cheek", [c(poly([[159, 64], [173, 60], [179, 70], [176, 82], [164, 84], [159, 78]]), "core")]);
      mid("nose", [c(fp([[150, 51], [157, 56], [159, 67], [158, 77], [150, 80]]), "core")]);
      mid("mouth", [c(fp([[150, 80], [159, 81], [163, 86], [159, 91], [150, 92]]), "core")]);
      mid("jaw", [c(fp([[163, 86], [176, 82], [181, 86], [178, 94], [169, 101], [160, 100], [160, 96]]), "core")]);
      mid("chin", [c(fp([[150, 92], [159, 91], [160, 96], [160, 100], [150, 102]]), "core")]);
      pr("eye", [c(ell(163, 57, 9.5, 6.2), "core")]);
      pr("ear", [c(ell(178.6, 65, 4.4, 8.4), "core")]);
      mid("throat", [c(fp([[150, 99], [158.5, 99], [158.5, 127], [150, 127]]), "core")]);
      mid("neck", [c(fp([[158.5, 99], [182, 99], [182, 127], [158.5, 127]]), "core")]);
    } else {
      mid("scalp", [c(fp([[150, 4], [204, 4], [204, 42], [150, 42]]), "core")]);
      mid("back-of-head", [c(fp([[150, 42], [204, 42], [204, 88], [150, 88]]), "core")]);
      pr("ear", [c(ell(178.6, 65, 4.4, 8.4), "core")]);
      mid("neck", [c(fp([[150, 88], [190, 88], [190, 127], [150, 127]]), "core")]);
    }

    // ---- torso ----
    pr("shoulder", [c(poly([[202, 108], [300, 108], [300, 166], [202, 166]]), "body")]);
    if (front) {
      mid("chest", [c(fp([[155, 127], [202, 127], [202, 166], [196, 166], [196, 198], [214, 198], [214, 224], [155, 224]]) + ell(176, 196, 17.5, 15.5) + ell(124, 196, 17.5, 15.5), "core", true)]);
      mid("sternum", [c(fp([[150, 129], [155, 129], [155, 222], [150, 226]]), "core")]);
      pr("breast", [c(ell(176, 196, 17.5, 15.5), "core")]);
      pr("armpit", [c(poly([[196, 166], [216, 166], [216, 198], [196, 198]]), "body")]);
      mid("upper-abdomen-center", [c(fp([[150, 224], [168, 224], [168, 256], [150, 256]]), "core")]);
      pr("upper-abdomen", [c(poly([[168, 224], [216, 224], [216, 256], [168, 256]]), "core")]);
      mid("navel", [c(fp([[150, 256], [168, 256], [168, 282], [150, 282]]), "core")]);
      pr("flank", [c(poly([[168, 256], [216, 256], [216, 282], [168, 282]]), "core")]);
      mid("lower-abdomen-center", [c(fp([[150, 282], [168, 282], [168, 310], [150, 310]]), "core")]);
      pr("lower-abdomen", [c(poly([[168, 282], [192, 282], [192, 310], [168, 310]]), "core")]);
      pr("hip", [c(poly([[192, 282], [216, 282], [216, 338], [192, 338]]), "core")]);
      pr("groin", [c(poly([[162, 310], [192, 310], [192, 338], [162, 338]]), "core")]);
      mid("genital-region", [c(fp([[150, 310], [162, 310], [162, 338], [150, 338]]), "core")]);
      pr("thigh-front", [c(poly([[150, 338], [216, 338], [216, 420], [150, 420]]), "core")]);
      pr("knee", [c(poly([[150, 420], [216, 420], [216, 464], [150, 464]]), "core")]);
      pr("shin", [c(poly([[150, 464], [216, 464], [216, 558], [150, 558]]), "core")]);
      pr("ankle", [c(poly([[150, 558], [216, 558], [216, 594], [150, 594]]), "core")]);
    } else {
      mid("upper-back", [c(fp([[150, 127], [204, 127], [204, 214], [150, 214]]) + poly([[160, 143], [180, 141], [196, 143], [194, 164], [188, 186], [178, 196], [166, 176]]) + poly([[160, 143], [180, 141], [196, 143], [194, 164], [188, 186], [178, 196], [166, 176]].map(mirrorPt)), "core", true)]);
      pr("scapula", [c(poly([[160, 143], [180, 141], [196, 143], [194, 164], [188, 186], [178, 196], [166, 176]]), "core")]);
      mid("mid-back", [c(fp([[150, 214], [216, 214], [216, 248], [150, 248]]), "core")]);
      mid("lower-back", [c(fp([[150, 248], [216, 248], [216, 286], [150, 286]]), "core")]);
      mid("tailbone", [c(fp([[150, 286], [158, 286], [156, 302], [150, 312]]), "core")]);
      pr("buttock", [c(poly([[150, 312], [156, 302], [158, 286], [216, 286], [216, 346], [150, 346], [150, 338], [155, 338], [155, 320], [150, 320]]), "core")]);
      mid("anal-region", [c(fp([[150, 320], [155, 320], [155, 338], [150, 338]]), "core")]);
      pr("thigh-back", [c(poly([[150, 346], [216, 346], [216, 420], [150, 420]]), "core")]);
      pr("back-of-knee", [c(poly([[150, 420], [216, 420], [216, 464], [150, 464]]), "core")]);
      pr("calf", [c(poly([[150, 464], [216, 464], [216, 558], [178, 558], [178, 538], [166, 538], [166, 558], [150, 558]]), "core")]);
      pr("achilles", [c(poly([[166, 538], [178, 538], [178, 594], [166, 594]]), "core")]);
      pr("ankle", [c(poly([[150, 558], [166, 558], [166, 594], [150, 594]]) + poly([[178, 558], [216, 558], [216, 594], [178, 594]]), "core")]);
      pr("heel", [c(poly([[150, 594], [216, 594], [216, 626], [150, 626]]), "core")]);
    }

    // ---- arms ----
    pr("upper-arm", [c(poly([[216, 166], [300, 166], [300, 238], [205, 238], [205, 198], [216, 198]]), "arm")]);
    pr("elbow", [c(poly([[205, 238], [300, 238], [300, 264], [205, 264]]), "arm")]);
    pr("forearm", [c(poly([[205, 264], [300, 264], [300, 322], [205, 322]]), "arm")]);
    pr("wrist", [c(poly([[205, 322], [300, 322], [300, 346], [205, 346]]), "arm")]);

    // ---- hands ----
    pr(front ? "palm" : "back-of-hand", [c(HAND.palm)], D.handTF);
    HAND.order.forEach(k => pr(k, [c(HAND.digits[k].d)], D.handTF));

    // ---- feet (front: top of foot + toes; back: heel handled above) ----
    if (front) {
      pr("foot-top", [c(FOOT.top)], D.footTF);
      FOOT.order.forEach(k => pr(k, [c(FOOT.toes[k].d)], D.footTF));
    }
    return G;
  }

  /* ====================================================================
   * 7. REALISM LAYER  (skin tones, lighting, shading, face, hair, briefs)
   * ==================================================================== */
  /* Figure style. Default = natural (face + hair). figure="clinical" = faceless anatomical figure. */
  const FIGURE = { face: true, hair: true };
  const SKIN = {
    natural: { label: "Natural", base: "#d9b8a0", mid: "#c69f86", shade: "#8c6650", lip: "#b07a6e", brow: "#4a3123", hair: "#3b271b" },
    light:  { label: "Light",  base: "#f1cbae", mid: "#e2b293", shade: "#b97f62", lip: "#c4766b", brow: "#6b4a35", hair: "#5a3d2b" },
    fair:   { label: "Fair",   base: "#e8b995", mid: "#d6a07c", shade: "#a8704f", lip: "#b86a60", brow: "#4a3123", hair: "#3b271b" },
    medium: { label: "Medium", base: "#d3a078", mid: "#bf8761", shade: "#8f5b3b", lip: "#a65b50", brow: "#33211a", hair: "#2a1b14" },
    tan:    { label: "Tan",    base: "#b98259", mid: "#a46c45", shade: "#774a2d", lip: "#8d4a42", brow: "#2a1a13", hair: "#20150f" },
    brown:  { label: "Brown",  base: "#8d5d41", mid: "#774b32", shade: "#52301f", lip: "#6e3a34", brow: "#1f130e", hair: "#17100c" },
    deep:   { label: "Deep",   base: "#5f3b2b", mid: "#4d2f22", shade: "#321e15", lip: "#4d2a28", brow: "#150d09", hair: "#110b08" }
  };

  function realismDefs(K) {
    return `<linearGradient id="skin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${K.mid}"/><stop offset=".2" stop-color="${K.base}"/><stop offset=".5" stop-color="${K.base}"/><stop offset=".8" stop-color="${K.base}"/><stop offset="1" stop-color="${K.mid}"/></linearGradient>` +
      `<linearGradient id="skinV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".1"/></linearGradient>` +
      `<radialGradient id="iris" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#9a6a3f"/><stop offset=".6" stop-color="#5b371d"/><stop offset="1" stop-color="#22140b"/></radialGradient>` +
      `<linearGradient id="lipG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K.lip}"/><stop offset="1" stop-color="${K.lip}" stop-opacity=".82"/></linearGradient>` +
      `<linearGradient id="hairG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${K.hair}"/><stop offset=".5" stop-color="#5a4636" stop-opacity=".9"/><stop offset="1" stop-color="${K.hair}"/></linearGradient>` +
      `<linearGradient id="fabric" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a9b4c2"/><stop offset="1" stop-color="#7f8b9b"/></linearGradient>` +
      `<filter id="lit" filterUnits="userSpaceOnUse" x="0" y="0" width="300" height="650" color-interpolation-filters="sRGB">` +
        `<feGaussianBlur in="SourceAlpha" stdDeviation="4.4" result="b"/>` +
        `<feDiffuseLighting in="b" surfaceScale="5" diffuseConstant="1.22" lighting-color="#ffffff" result="d"><feDistantLight azimuth="235" elevation="58"/></feDiffuseLighting>` +
        `<feSpecularLighting in="b" surfaceScale="5" specularConstant=".42" specularExponent="24" lighting-color="#fff4e6" result="s"><feDistantLight azimuth="235" elevation="50"/></feSpecularLighting>` +
        `<feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="4" result="n"/>` +
        `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 .12 -.03" result="n2"/>` +
        `<feBlend in="SourceGraphic" in2="d" mode="multiply" result="m"/>` +
        `<feComposite in="m" in2="s2" operator="arithmetic" k1="0" k2="1" k3=".3" k4="0" result="o"/>` +
        `<feComposite in="n2" in2="SourceAlpha" operator="in" result="n3"/>` +
        `<feMerge result="mm"><feMergeNode in="o"/><feMergeNode in="n3"/></feMerge>` +
        `<feComposite in="mm" in2="SourceAlpha" operator="in"/>` +
      `</filter>` +
      `<filter id="litD" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
        `<feGaussianBlur in="SourceAlpha" stdDeviation="1.7" result="b"/>` +
        `<feDiffuseLighting in="b" surfaceScale="3" diffuseConstant="1.2" lighting-color="#fff" result="d"><feDistantLight azimuth="235" elevation="58"/></feDiffuseLighting>` +
        `<feBlend in="SourceGraphic" in2="d" mode="multiply" result="m"/><feComposite in="m" in2="SourceAlpha" operator="in"/>` +
      `</filter>` +
      `<filter id="soft" filterUnits="userSpaceOnUse" x="0" y="0" width="300" height="650"><feGaussianBlur stdDeviation=".95"/></filter>` +
      `<filter id="softer" filterUnits="userSpaceOnUse" x="0" y="0" width="300" height="650"><feGaussianBlur stdDeviation="2.2"/></filter>` +
      `<filter id="organLit" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
        `<feGaussianBlur in="SourceAlpha" stdDeviation="2.1" result="b"/>` +
        `<feDiffuseLighting in="b" surfaceScale="4" diffuseConstant="1.2" lighting-color="#fff" result="d"><feDistantLight azimuth="235" elevation="55"/></feDiffuseLighting>` +
        `<feSpecularLighting in="b" surfaceScale="4" specularConstant=".5" specularExponent="18" lighting-color="#fff" result="s"><feDistantLight azimuth="235" elevation="48"/></feSpecularLighting>` +
        `<feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>` +
        `<feBlend in="SourceGraphic" in2="d" mode="multiply" result="m"/>` +
        `<feComposite in="m" in2="s2" operator="arithmetic" k1="0" k2="1" k3=".35" k4="0" result="o"/>` +
        `<feComposite in="o" in2="SourceAlpha" operator="in"/>` +
      `</filter>`;
  }

  // Everything that makes the figure look real. Drawn UNDER the clickable regions.
  function realism(sex, view, K) {
    const D = dims(sex), F = D.F, front = view === "front";
    const sh = `stroke="${K.shade}"`;
    let hs = "", cs = "", hl = "";
    if (front) {
      hs += "M168 94Q161 108 156 124M168 336Q180 316 200 298";
      hs += "M154 128Q172 121 190 129Q198 132 206 131";
      hl += "M154 124.6Q172 117.6 190 125.6Q198 128.6 206 127.6";
      cs += "M147 127Q150 130.4 153 127";
      if (!F) {
        cs += "M146.5 111L150 113.8L153.5 111M150 226L150 306";
        hs += "M158 187Q178 198 200 179M166 227Q170 258 166 292M150.5 240Q158 241.8 166 240M150.5 254Q158 255.8 166 254M150.5 277Q158 278.6 166 277";
        hl += "M160 150C180 148 194 156 200 168M170 214Q176 210 184 214";
      } else {
        cs += "M150 226L150 300";
        hs += "M157 186Q163 208 180 209Q197 207 199 187";
        hl += "M162 178Q178 168 194 178";
      }
      hs += "M208 140Q226 160 222 186M227 196Q229 222 233 246M224 246Q233 252 244 249";
      hs += "M166 350Q170 395 172 424M190 352Q192 392 186 422M170 468Q172 512 169 556M162 566Q171 570 181 566";
      hl += "M176 352Q180 392 178 420M174 470Q177 510 174 552";
    } else {
      hs += "M154 100Q172 116 200 130M158 180Q166 220 160 252M153 348Q176 354 204 346";
      hs += "M170 352Q172 392 170 418M162 440Q173 443 185 440M164 472Q175 500 170 536M184 470Q187 500 178 536";
      hs += "M166 540L167 588M178 540L177 588M208 140Q226 160 222 186M227 196Q229 222 233 246M224 246Q233 252 244 249M158 296Q164 300 170 296";
      hl += "M172 356Q176 392 174 416M170 476Q174 504 172 530";
      cs += "M150 126L150 304M150 304L150 342";
    }
    let fine = ell(172, 441, 9, 10.5);
    let body = `<g filter="url(#soft)" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<g ${sh} stroke-width="1.5" stroke-opacity=".42">${both(`<path d="${hs}"/>${front ? `<path d="${fine}" stroke-opacity=".55"/>` : ""}`)}<path d="${cs}"/></g>` +
      `<g stroke="#fff" stroke-width="1.3" stroke-opacity=".26">${both(`<path d="${hl}"/>`)}</g></g>`;
    if (front) body += `<g fill="${K.shade}" fill-opacity=".55" filter="url(#soft)"><path d="${ell(150, 266, 2.1, 3.4)}"/></g>`;
    // soft shadow under chin / neck
    body += `<g filter="url(#softer)" fill="${K.shade}" fill-opacity=".38"><path d="${ell(150, 104, 18, 6)}"/></g>`;
    // briefs (neutral, keeps the model modest)
    const brief = front
      ? "M150 303Q178 308 207 297L211 326Q186 322 161 345L150 347Z"
      : "M150 299Q178 304 207 295L211 330Q186 342 156 358L150 358Z";
    body += `<g clip-path="url(#c-core)">${both(`<path d="${brief}" fill="url(#fabric)" stroke="#6c7889" stroke-width=".8"/><path d="${front ? "M150 306Q178 311 207 300" : "M150 302Q178 307 207 298"}" fill="none" stroke="#5f6b7c" stroke-width="1.4" stroke-opacity=".7"/>`)}</g>`;
    // hands & feet
    let loc = `<g transform="${D.handTF}" fill="none" stroke="${K.shade}" stroke-opacity=".5" stroke-width=".7" stroke-linecap="round"><path d="${front ? HAND.palmar : HAND.dorsal}"/>`;
    if (!front) loc += `<path d="${HAND.nails}" fill="#f1c3b8" fill-opacity=".85" stroke="${K.shade}" stroke-opacity=".55"/>`;
    loc += `</g>`;
    if (front) loc += `<g transform="${D.footTF}" fill="none" stroke="${K.shade}" stroke-opacity=".5" stroke-width=".7"><path d="${FOOT.nails}" fill="#f1c3b8" fill-opacity=".85"/><path d="${FOOT.dorsal}"/></g>`;
    body += both(loc);
    // ear shading
    if (FIGURE.face) body += both(`<path d="${ell(178.4, 65, 3.6, 7.2)}" fill="${K.shade}" fill-opacity=".2"/><path d="M177.6 61.2Q180.6 64.4 178.6 69" fill="none" stroke="${K.shade}" stroke-opacity=".5" stroke-width=".5"/>`);
    if (front) {
      const EYE = "M155.4 58.2C158 55.2 161 54.2 164 54.3C167.4 54.4 170.6 55.4 172.2 56.8C170 59 166.6 59.8 163.6 59.7C160.4 59.6 157.2 59.4 155.4 58.2Z";
      const browPath = F
        ? "M154.8 49.2C158 46.6 162 45.3 165.6 45.4C169.2 45.5 172.2 47 174.6 50C172 48.8 169.2 48 165.9 47.9C162.2 47.9 158.4 49.4 154.8 50.8Z"
        : "M154.6 48.6C158 46.6 163 45.9 167 46.3C170.4 46.7 172.8 48 174.4 50C172 49.8 169.4 49.1 166.6 49C162.6 48.9 158.4 50.4 154.6 52Z";
      const face =
        // soft eye socket / under-eye shading
        `<path d="M153.6 52.8Q163.6 48.4 173 52.6" fill="none" stroke="${K.shade}" stroke-opacity=".22" stroke-width="2.2" filter="url(#soft)"/>` +
        `<path d="M154.6 61.4Q163.6 64.8 171.4 61" fill="none" stroke="${K.shade}" stroke-opacity=".2" stroke-width="1.8" filter="url(#soft)"/>` +
        // eye
        `<clipPath id="eyeClip"><path d="${EYE}"/></clipPath>` +
        `<path d="${EYE}" fill="#efe9e1"/>` +
        `<g clip-path="url(#eyeClip)"><circle cx="164.2" cy="57" r="3.1" fill="url(#iris)"/><circle cx="164.2" cy="57" r="3.1" fill="none" stroke="#1d120a" stroke-opacity=".55" stroke-width=".45"/><circle cx="164.2" cy="57" r="1.25" fill="#0d0704"/><circle cx="165.2" cy="55.9" r=".75" fill="#fff" fill-opacity=".9"/>` +
        `<path d="M150 52.8H176V56.1H150Z" fill="#2a170d" fill-opacity=".3" filter="url(#soft)"/></g>` +
        `<path d="M155.4 58.2C158 55.2 161 54.2 164 54.3C167.4 54.4 170.6 55.4 172.2 56.8" fill="none" stroke="#21120a" stroke-width="${F ? 1.15 : 1}" stroke-linecap="round"/>` +
        (F ? `<path d="M170.4 55.7Q172.8 54.2 174.5 54.6" fill="none" stroke="#21120a" stroke-width=".7" stroke-linecap="round"/>` : "") +
        `<path d="M156.6 59.2C160 60.6 166 60.7 171 58.6" fill="none" stroke="${K.shade}" stroke-opacity=".38" stroke-width=".55"/>` +
        `<path d="M156 55.4C159 51.8 164.6 51 170.6 53.4" fill="none" stroke="${K.shade}" stroke-opacity=".38" stroke-width=".7" filter="url(#soft)"/>` +
        `<ellipse cx="156" cy="58.2" rx=".9" ry=".6" fill="#d9a198" fill-opacity=".75"/>` +
        // eyebrow (soft copy + crisp copy)
        `<path d="${browPath}" fill="${K.brow}" fill-opacity=".5" filter="url(#soft)"/><path d="${browPath}" fill="${K.brow}" fill-opacity=".82"/>` +
        // nose
        `<path d="M156.4 56C157.4 62 158.2 68 159.4 73.6" fill="none" stroke="${K.shade}" stroke-opacity=".28" stroke-width="1.6" filter="url(#soft)"/>` +
        `<path d="M150.8 58.5L150.8 72.5" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2.4" filter="url(#soft)"/>` +
        `<ellipse cx="152.4" cy="75.8" rx="2.3" ry="1.7" fill="#fff" fill-opacity=".16" filter="url(#soft)"/>` +
        `<path d="M159.6 73.4C161.6 75.6 161.4 78.4 159 79.4C157.2 80 154.6 79.8 152.8 78.6" fill="none" stroke="${K.shade}" stroke-opacity=".5" stroke-width=".8" stroke-linecap="round"/>` +
        `<path d="M158.6 74.4C160.6 76 160.2 78.4 158.4 79" fill="${K.shade}" fill-opacity=".1" stroke="none" filter="url(#soft)"/>` +
        `<ellipse cx="155.4" cy="78.5" rx="1.9" ry=".85" fill="#3a1f17" fill-opacity=".5"/>` +
        `<path d="M150 80.2Q155 81.2 158.4 79.8" fill="none" stroke="${K.shade}" stroke-opacity=".3" stroke-width="1.4" filter="url(#soft)"/>` +
        `<path d="M151.4 81.2L151.6 83.2" fill="none" stroke="${K.shade}" stroke-opacity=".18" stroke-width="1" filter="url(#soft)"/>` +
        // cheek warmth
        `<ellipse cx="165.6" cy="70.5" rx="7" ry="4.6" fill="#d97b73" fill-opacity="${F ? .09 : .05}" filter="url(#soft)"/>` +
        // lips
        `<path d="M150 83.9C151.4 82.6 153.2 82.4 154.8 82.9C157 83.2 159.2 84.3 160.5 85.6C157.6 86.4 154 86.7 150 86.5Z" fill="url(#lipG)"/>` +
        `<path d="M150 86.5C154 86.7 157.6 86.4 160.5 85.6C158.8 88.8 155.2 91 150 91.2Z" fill="url(#lipG)" fill-opacity=".94"/>` +
        `<ellipse cx="153.4" cy="88.7" rx="3.2" ry=".95" fill="#fff" fill-opacity=".24" filter="url(#soft)"/>` +
        `<path d="M150 86.5C154 86.8 157.8 86.5 160.8 85.5" fill="none" stroke="#3a1c17" stroke-opacity=".55" stroke-width=".55" stroke-linecap="round"/>` +
        `<path d="M152.4 93.4Q157.4 94.8 161 92.6" fill="none" stroke="${K.shade}" stroke-opacity=".25" stroke-width="1.2" filter="url(#soft)"/>`;
      if (FIGURE.face) body += both(face);
      if (FIGURE.hair) {
        if (F) body += both(`<path d="M150 14.8C169.5 14.8 184 26.5 185.4 47C186.4 65 184.8 82 188.2 98C190.4 112 194 124 192.4 138C191.6 146 188.4 152 184.4 156.4C181 159 177.2 157.6 175.4 154C176 142 176.6 128 175 114C174 104 172.6 96 170.6 88C174.4 79 176.2 68 176.4 57C176.6 46 173.4 38 166.4 33.2C161 29.6 155 28 150 28.2Z" fill="url(#hairG)"/>` +
          `<path d="M150 28.2C155 28 161 29.6 166.4 33.2C173.4 38 176.6 46 176.4 57" fill="none" stroke="#2a1b13" stroke-opacity=".4" stroke-width="1.8" filter="url(#soft)"/>` +
          `<path d="M156 17.2C170 19 181.4 30 183.4 48" fill="none" stroke="#fff" stroke-opacity=".24" stroke-width="2.6" stroke-linecap="round" filter="url(#soft)"/>` +
          `<path d="M185.6 78C187 98 190.6 116 191.4 136" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2.2" stroke-linecap="round" filter="url(#soft)"/>` +
          `<path d="M152 17.6C168 19 180 30 182 50M155 22C169 25 178.6 35 180.2 53M177 72C178.6 92 182.4 112 184 142" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width=".7"/>` +
          `<path d="M160 19.6C172 24 181 36 183 60C184 80 186.6 100 188.6 124M166.6 33C174 41 178 52 178.4 70C178.8 92 181 118 180.6 146" fill="none" stroke="#1d120b" stroke-opacity=".3" stroke-width=".7"/>`);
        else body += both(`<path d="M150 15.2C165 15.2 175.8 21.6 177.6 34C178.2 40 177.8 46 176.8 52.6L175.2 56.6C174.8 50.6 174.2 45.6 172.6 42C171 38.8 169 38.4 167 36.8C164.6 34.8 162 33.5 158.8 32.7C156 32 153 31.6 150 31.6Z" fill="url(#hairG)"/>` +
          `<path d="M150 31.6C153 31.6 156 32 158.8 32.7C162 33.5 164.6 34.8 167 36.8" fill="none" stroke="#2a1b13" stroke-opacity=".22" stroke-width="1.1" filter="url(#soft)"/>` +
          `<path d="M153 16.6C165 17.8 174 23.6 176 35M151.4 20.4C163 22.4 171.6 28.6 174.2 39M156 17.6C167 19.8 174.6 26 176.4 37M159 21C167 24.4 172.4 30 174 38" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width=".7"/><path d="M154 22.4C162 25.4 168.6 31 171.6 38M150.6 25.4C157.6 28.4 163 32 167 36.8" fill="none" stroke="#1d120b" stroke-opacity=".26" stroke-width=".6"/>`);
      }
    } else {
      if (FIGURE.hair) {
        if (F) body += both(`<path d="M150 15.8C168 15.8 182 26 184 46C185.5 64 187 90 191 118C194 140 194 170 190 196C184 206 170 210 150 210Z" fill="url(#hairG)"/><path d="M150 17L150 208" fill="none" stroke="#1d120b" stroke-opacity=".3" stroke-width=".7"/><path d="M154 20C170 26 180 44 182 66C184 94 188 126 189 160M160 22C173 32 180 52 181 76" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width=".8"/><path d="M158 24C172 36 178 60 180 90C181 120 184 150 185 184" fill="none" stroke="#1d120b" stroke-opacity=".28" stroke-width=".7"/>`);
        else body += both(`<path d="M150 15.2C167 15.2 180 25 180.6 44C181 58 179 70 175 80C168 87 160 89 150 89Z" fill="url(#hairG)"/><path d="M152 18C167 21 177 32 178.6 50M152 30C166 36 175 48 176 64M152 44C163 50 171 60 172 74" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width=".8"/>`);
      }
    }
    // ground shadow
    const ground = `<g filter="url(#softer)" fill="#000" fill-opacity=".18"><path d="${ell(150, 634, 74, 5)}"/></g>`;
    return { under: body, ground };
  }

  /* ====================================================================
   * 8. INTERNAL ORGANS  (front view; patient's right = viewer's left)
   *    shape: {d, t?:tubeWidth, cls?}   tone: [fill, stroke, fillOpacity?]
   * ==================================================================== */
  function organGeo(sex) {
    const F = sex === "female", O = [];
    const o = (id, tone, shapes) => O.push({ id, tone, shapes: shapes.map(s => typeof s === "string" ? { d: s } : s) });
    const T_LUNG = ["#e6b6b8", "#b07f86"], T_PINK = ["#e19a9c", "#a8606a"], T_GUT = ["#e2a98f", "#a96d56"], T_UR = ["#ead58d", "#b19b55"];

    o("esophagus", ["#d99aa0", "#a8656d"], [{ d: "M150 108L150.4 150Q153 200 160 238", t: 5.2 }]);
    o("right-lung", T_LUNG, ["M147 130C146 122 138 120 132 126C122 138 110 162 108 190C107 204 114 214 128 215C140 216 148 212 148 204Z"]);
    o("left-lung", T_LUNG, ["M153 130C154 122 162 120 168 126C178 138 190 162 192 190C193 204 186 216 172 217C162 218 154 212 153 204Z"]);
    o("trachea", ["#c9d5e4", "#8296ae"], ["M145.5 111L154.5 111L154.5 158L170 171L168 177L150 166L132 177L130 171L145.5 158Z",
      { d: "M146 118H154M146 124H154M146 130H154M146 136H154M146 142H154M146 148H154M146 154H154", cls: "ln" }]);
    o("larynx", ["#dcd5c2", "#a49b84"], ["M144 97L156 97L157.5 107Q150 113 142.5 107Z", { d: "M150 98L150 108", cls: "ln" }]);
    o("thyroid", ["#c97a70", "#8e4a43"], ["M138 113Q133 121 140 127Q145 125 147 119L153 119Q155 125 160 127Q167 121 162 113Q156 115 150 113Q144 115 138 113Z"]);
    o("heart", ["#d2495a", "#8f2437"], ["M141 182C139 172 150 166 158 170C164 166 176 168 178 180C180 194 176 210 168 224C160 218 150 206 144 196C142 192 141 188 141 182Z",
      { d: "M150 168C150 160 160 156 164 164L162 170", cls: "ln" }]);
    o("spleen", ["#a4576c", "#6f3345"], ["M184 232C192 228 197 236 196 250C195 260 188 262 185 252Z"]);
    o("pancreas", ["#e6c58a", "#a98b4f"], ["M136 277C148 270 164 272 178 264L186 264C188 270 182 278 168 282C156 286 144 288 136 288C132 284 133 279 136 277Z"]);
    o("right-kidney", ["#b3566a", "#74293f"], ["M120 252C111 254 109 270 115 284C119 291 128 289 128 281C124 277 124 266 128 260C126 255 124 252 120 252Z"]);
    o("left-kidney", ["#b3566a", "#74293f"], ["M180 248C189 250 191 266 185 280C181 287 172 285 172 277C176 273 176 262 172 256C174 251 177 248 180 248Z"]);
    o("adrenal-glands", ["#e4c25a", "#a98a2a"], ["M121 244Q127 237 135 243L132 248Q127 244 123 250Z", "M179 240Q173 233 165 239L168 244Q173 240 177 246Z"]);
    o("stomach", ["#e59aa0", "#a8606a"], ["M158 236C164 227 180 225 187 235C195 247 190 267 177 277C167 283 153 281 147 273C146 267 152 267 156 263C160 257 158 247 156 244Z",
      { d: "M164 240Q175 244 180 256", cls: "ln" }]);
    o("liver", ["#a2523f", "#6a2e22"], ["M98 232C100 222 118 216 140 218C160 220 178 226 184 236C172 244 158 246 148 250C140 256 132 262 120 262C106 260 98 246 98 232Z",
      { d: "M142 220Q144 236 140 250", cls: "ln" }]);
    o("gallbladder", ["#7fa86a", "#4e7240"], ["M127 256C124 262 126 271 131 273C136 271 137 262 134 256Z"]);
    o("small-intestine", T_PINK, [{ d: "M128 284H172Q179 287.5 172 291H128Q121 294.5 128 298H172Q179 301.5 172 305H130Q123 308.5 130 312H166", t: 6.4 }]);
    o("large-intestine", T_GUT, [{ d: "M118 308L118 276Q118 266 128 268Q150 284 172 268Q182 266 182 276L182 300Q182 312 172 314Q162 316 156 324", t: 8.5 }]);
    o("appendix", T_GUT, [{ d: "M118 310Q111 318 115 326", t: 3.6 }]);
    o("ureters", T_UR, [{ d: "M130 286Q134 298 142 309M170 282Q166 296 158 309", t: 2.6 }]);
    o("rectum", T_GUT, ["M147 318L153 318L152.6 337L147.4 337Z"]);
    o("bladder", T_UR, ["M138 311C138 303 162 303 162 311C162 322 156 328 150 328C144 328 138 322 138 311Z"]);
    if (F) {
      o("uterus", ["#d97f8c", "#9c4a5a"], ["M142 288C142 280 158 280 158 288L156 300Q150 306 144 300Z"]);
      o("fallopian-tubes", ["#e8a9a4", "#aa6e6a"], [{ d: "M143 289Q134 281 128 291M157 289Q166 281 172 291", t: 2.6 }]);
      o("ovaries", ["#f0b8a8", "#b87a6c"], [ell(127, 295, 6, 4.2), ell(173, 295, 6, 4.2)]);
    } else {
      o("prostate", ["#d98a8a", "#9a5252"], [ell(150, 331, 8.5, 5.5)]);
      o("testes", ["#d7ab92", "#9b7058"], [ell(143, 352, 5.4, 7.6), ell(157, 352, 5.4, 7.6)]);
    }
    o("left-breast-tissue", ["#f1d6a2", "#bd9b5e", 0.62], [ell(178, 198, 16, 14)]);
    o("right-breast-tissue", ["#f1d6a2", "#bd9b5e", 0.62], [ell(122, 198, 16, 14)]);
    // head organs
    o("brain", ["#eab5ba", "#b27c84"], ["M128 52C125 38 132 28 144 26C150 25 150 25 156 26C168 28 175 38 172 52C170 59 164 62 160 62L140 62C136 62 130 59 128 52Z",
      "M136 62Q150 74 164 62Q162 71 150 73Q138 71 136 62Z", "M146.5 63L146.5 80L153.5 80L153.5 63Z",
      { d: "M150 26L150 61M137 36Q142 44 138 54M163 36Q158 44 162 54", cls: "ln" }]);
    o("sinuses", ["#bfe0f2", "#6fa5c8"], ["M140 47Q150 40 160 47Q150 51 140 47Z", ell(150, 58, 3, 7), ell(139, 72, 8, 6.5), ell(161, 72, 8, 6.5)]);
    o("eyes", ["#f6f3ec", "#a89f90"], [ell(137, 57, 7, 6.5), ell(163, 57, 7, 6.5), { d: ell(137, 57, 3.5, 3.5) + ell(163, 57, 3.5, 3.5), cls: "iris" }]);
    let teeth = "";
    [0, 1, 2, 3].forEach(i => {
      const dx = 1.6 + i * 3.4, w = 3.1 - i * 0.1;
      teeth += rr(150 + dx, 82 + i * 0.35, w, 4.6, 1.2) + rr(150 - dx - w, 82 + i * 0.35, w, 4.6, 1.2);
      teeth += rr(150 + dx, 87.4 + i * 0.35, w, 4.2, 1.2) + rr(150 - dx - w, 87.4 + i * 0.35, w, 4.2, 1.2);
    });
    o("teeth", ["#fffdf4", "#b3aa94"], [teeth]);
    return O;
  }

  /* ====================================================================
   * 9. SKELETON  (k: "full" drawn once, "mid" half mirrored, "pair" per side)
   * ==================================================================== */
  function boneGeo(sex, view) {
    const D = dims(sex), front = view === "front", B = [];
    const BONE = ["#f2ead6", "#b5a880"];
    const add = (k, key, shapes, extra) => B.push(Object.assign({ k, key, tone: BONE, shapes: shapes.map(s => typeof s === "string" ? { d: s } : s) }, extra || {}));

    // skull & jaw
    const skullHalf = [[150, 18], [164, 19], [173, 27], [177, 40], [176, 54], [172, 64], [166, 70], [163, 78], [158, 86], [150, 88]];
    add("full", "skull", [spline(fullFromHalf(skullHalf), true),
      { d: ell(138, 56, 7, 6) + ell(162, 56, 7, 6), cls: "hole" },
      { d: poly([[150, 62], [154, 70], [150, 74], [146, 70]]), cls: "hole" },
      { d: rr(141, 79, 18, 5, 2), cls: "tooth" }, { d: "M143 36Q150 33 157 36M130 44Q135 40 143 42M170 44Q165 40 157 42", cls: "ln" }]);
    add("full", "jawbone", ["M130 76L131 92Q150 108 169 92L170 76L164 78L162 90Q150 98 138 90L136 78Z"]);

    // spine
    let cv = "", tv = "", lv = "";
    for (let i = 0; i < 7; i++) cv += rr(150 - (11 + i * 0.3) / 2, 101 + i * 3.8, 11 + i * 0.3, 3.2, 1.2);
    for (let i = 0; i < 12; i++) tv += rr(150 - (13 + i * 0.55) / 2, 129 + i * 7.7, 13 + i * 0.55, 6.4, 2);
    for (let i = 0; i < 5; i++) lv += rr(150 - (22 + i * 0.5) / 2, 224 + i * 9.4, 22 + i * 0.5, 8, 2.4);
    add("full", "cervical-spine", [cv]);
    add("full", "thoracic-spine", [tv]);
    add("full", "lumbar-spine", [lv]);
    add("full", "sacrum", [spline([[139, 270], [150, 267], [161, 270], [159, 288], [154, 306], [150, 312], [146, 306], [141, 288]], true)]);
    add("full", "coccyx", ["M147.5 313L152.5 313L151.4 326L148.6 326Z"]);

    // thorax
    if (front) add("full", "sternum-bone", ["M143.5 130Q150 127.5 156.5 130L158 142L155.5 148L156 206L152.5 218L147.5 218L144 206L144.5 148L142 142Z"]);
    const ys = [134, 141, 149, 157, 165, 173, 181, 189, 196, 203, 210, 216];
    const ws = [22, 30, 38, 43, 47, 49, 50, 49, 46, 42, 34, 27];
    const ribs = ys.map((y0, i) => {
      const w = ws[i];
      const end = i < 7 ? [157, y0 + 26 + i * 1.2] : i < 10 ? [150 + w * 0.42, y0 + 20 + (i - 7) * 1.5] : [150 + w * 0.5, y0 + 10];
      return { d: spline([[156, y0], [150 + w * 0.55, y0 - 2.6], [150 + w, y0 + 8], [150 + w * 0.76, y0 + 19 + i * 0.5], end]), t: 3 };
    });
    add("pair", "ribs", ribs);
    add("pair", "clavicle", [{ d: "M153 128Q168 122 182 128Q194 133 206 130", t: 4.4 }]);
    if (!front) add("pair", "scapula-bone", ["M162 144L194 142Q202 138 206 142L204 152L198 168L188 192L178 196L168 176Z", { d: "M164 150L198 160", cls: "ln" }]);

    // arm
    add("pair", "humerus", [capsule(213, 152, 232, 240, 8.5), ell(210, 146, 8.5, 8.5), ell(233, 246, 10, 6)]);
    add("pair", "radius", [capsule(238, 258, 257, 330, 5.2), ell(238, 254, 4.4, 3), ell(257, 333, 6.5, 4.5)]);
    add("pair", "ulna", [capsule(232, 254, 248, 328, 5.4), ell(232, 250, 6, 7), ell(249, 331, 3.6, 3.6)]);
    // hand bones (hand-local space)
    const metas = [[7, 9, 10.6, 35], [2.4, 9, 3.7, 35], [-2.6, 9, -3.1, 35], [-7.5, 9, -9.6, 35]].map(m => capsule(m[0], m[1], m[2], m[3], 4.2)).concat([capsule(6, 4, 14, 19, 5)]);
    let phal = "";
    HAND.order.forEach(k => {
      const g = HAND.digits[k];
      if (k === "thumb") { phal += capsule(14.6, 20.5, 19.4, 32, 4.6) + capsule(20, 33.6, 23.8, 43.6, 4.2); return; }
      const bx = g.base[0], by = 36, tx = g.tip[0], ty = g.tip[1];
      [[0.04, 0.38], [0.43, 0.69], [0.73, 0.97]].forEach(([a, b]) => { phal += capsule(bx + (tx - bx) * a, by + (ty - by) * a, bx + (tx - bx) * b, by + (ty - by) * b, g.w * 0.62); });
    });
    add("pair", "wrist-bones", [spline([[-9, -2], [0, -4.5], [9, -2], [11.5, 8], [0, 11.5], [-11.5, 8]], true)], { tf: D.handTF });
    add("pair", "hand-bones", metas, { tf: D.handTF });
    add("pair", "finger-bones", [phal], { tf: D.handTF });

    // pelvis
    add("pair", "hip-bone", ["M155 272C170 258 196 258 207 275C211 290 205 306 195 316C190 322 187 328 185 336L180 352L170 357L162 350L160 338C156 328 153 316 154 300Z",
      "M152 330L162 336L163 351L152 351Z", { d: ell(171, 339, 6, 8.5), cls: "hole" }, { d: "M160 276Q178 270 200 280", cls: "ln" }]);

    // leg
    add("pair", "femur", [capsule(191, 322, 176, 430, 10), capsule(197, 327, 188, 316, 7), ell(188, 313, 8.5, 8.5), ell(199, 325, 6.5, 8), ell(175, 433, 12.5, 7.5)]);
    if (front) add("pair", "patella", [ell(172, 441, 6.5, 8)]);
    add("pair", "tibia", [capsule(172, 450, 167, 576, 8), ell(171, 447, 12, 4.8), ell(163, 579, 4, 5.4)]);
    add("pair", "fibula", [capsule(184, 454, 181, 578, 4.4), ell(184, 451, 3.8, 5), ell(182, 581, 3.8, 6)]);
    if (front) {
      add("pair", "ankle-bones", [spline([[-8, -3], [9, -3], [12, 10], [8, 20], [-6, 20], [-10, 10]], true)], { tf: D.footTF });
      const mt = [[-9, 18, -11, 44, 5.2], [-1, 18, -0.8, 45, 4.4], [6, 18, 6.4, 45, 4], [12, 18, 12.4, 46, 3.8], [18, 18, 18.6, 47, 3.6]].map(m => capsule(m[0], m[1], m[2], m[3], m[4]));
      let tp = "";
      FOOT.order.forEach(k => {
        const st = FOOT.toes[k].st, bx = st[0][0], by = st[0][1] + 3, tx = st[2][0], ty = st[2][1];
        const segs = k === "big-toe" ? [[0.02, 0.48], [0.54, 0.98]] : [[0.02, 0.36], [0.4, 0.68], [0.72, 0.98]];
        segs.forEach(([a, b]) => { tp += capsule(bx + (tx - bx) * a, by + (ty - by) * a, bx + (tx - bx) * b, by + (ty - by) * b, FOOT.toes[k].w * 0.58); });
      });
      add("pair", "foot-bones", mt, { tf: D.footTF });
      add("pair", "toe-bones", [tp], { tf: D.footTF });
    } else {
      add("pair", "ankle-bones", [ell(169.5, 596, 8.5, 10)]);
    }

    // joints (translucent overlays)
    const J = (key, cx, cy, rx, ry) => add("pair", key, [ell(cx, cy, rx, ry)], { joint: true });
    J("shoulder-joint", 210, 146, 12, 11); J("elbow-joint", 234, 250, 12, 9); J("wrist-joint", 254, 337, 10.5, 7);
    J("hip-joint", 189, 314, 12, 12); J("knee-joint", 173, 441, 16, 15); J("ankle-joint", 171, 584, 12, 8);
    return B;
  }

  /* ====================================================================
   * 10. SVG RENDERER
   * ==================================================================== */
  const VIEWBOX = { front: "0 0 300 650", back: "0 0 300 650", head: "86 6 128 118", hands: "0 0 300 470", feet: "0 0 300 470" };

  const SVG_CSS = `
    .ss{vector-effect:non-scaling-stroke}
    .faint{opacity:.5}
    .hit{fill:#2f6fb0;fill-opacity:.015;stroke:#1d4a75;stroke-opacity:.14;stroke-width:.7;cursor:pointer;transition:fill-opacity .12s}
    svg.guides .hit{fill-opacity:.07;stroke-opacity:.55}
    .hit path{vector-effect:non-scaling-stroke}
    .hit:hover{fill:#2c9bec;fill-opacity:.42}
    .hit.grp-on{fill:var(--accent,#0876d9);fill-opacity:.3}
    .hit.selected{fill:var(--accent,#0876d9);fill-opacity:.74;stroke:#06508f;stroke-opacity:1;stroke-width:1.2}
    .dl{fill:none;stroke:#3b2417;stroke-opacity:.34;stroke-width:.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
    .dl .nail{fill:#f1c3b8;fill-opacity:.85;stroke-opacity:.45}
    .organ,.bone{--tone:var(--t0);--toneS:var(--s0);fill:var(--tone);stroke:var(--toneS);fill-opacity:var(--o0,1);stroke-width:.9;stroke-linejoin:round;cursor:pointer}
    .organ path,.bone path{vector-effect:non-scaling-stroke}
    .organ,.bone{filter:url(#organLit)}
    .organ:hover,.bone:hover{--tone:#8ec9f4;--toneS:#2a78b8;fill-opacity:1}
    .organ.selected,.bone.selected{--tone:#e0455c;--toneS:#9a2338;fill-opacity:1}
    .bone.selected{--tone:var(--accent,#0876d9);--toneS:#06508f}
    .bone .ln,.organ .ln{fill:none;stroke:var(--toneS);stroke-width:.8;opacity:.65;pointer-events:none;stroke-linecap:round}
    .bone .hole{fill:#6f6850;stroke:none}.bone .tooth{fill:#fffdf4;stroke:#b5a880;stroke-width:.5}
    .organ .iris{fill:#4a6f94;stroke:none}
    .tb-o{fill:none;stroke:var(--toneS);stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
    .tb-i{fill:none;stroke:var(--tone);stroke-linecap:round;stroke-linejoin:round;stroke-opacity:1}
    .tb-o,.tb-i{stroke-width:inherit}
    .joint{fill:#6aa7da;fill-opacity:.1;stroke:#3f86c9;stroke-opacity:.9;stroke-dasharray:2.4 2;stroke-width:1;cursor:pointer}
    .joint path{vector-effect:non-scaling-stroke}
    .joint:hover{fill-opacity:.4}.joint.selected{fill:var(--accent,#0876d9);fill-opacity:.7;stroke:#06508f;stroke-dasharray:none}
    .caption{font:600 9px Inter,system-ui,sans-serif;fill:#6f8399;letter-spacing:.04em}
    .lr{font:700 11px Inter,system-ui,sans-serif;fill:#7f9cb8}
    .cell-cap{font:600 8.5px Inter,system-ui,sans-serif;fill:#54728f;letter-spacing:.05em}
    .note{font:8px Inter,system-ui,sans-serif;fill:#7b93ab}`;

  function shapeMarkup(s, toneVars) {
    if (s.t) return `<path class="tb-o" d="${s.d}" style="stroke-width:${n1(s.t + 2.2)}"/><path class="tb-i" d="${s.d}" style="stroke-width:${s.t}"/>`;
    const clip = s.clip ? ` clip-path="url(#c-${s.clip})"` : "";
    const eo = s.eo ? ` fill-rule="evenodd"` : "";
    return `<path${s.cls ? ` class="${s.cls}"` : ""} d="${s.d}"${clip}${eo}/>`;
  }
  function regionGroup(id, inner, cls, st, style) {
    const e = REG[id];
    if (!e) return "";
    const on = st.selected.has(id) ? " selected" : (st.groupOn.has(id) ? " grp-on" : "");
    return `<g data-region="${id}" class="${cls}${on}"${style ? ` style="${style}"` : ""} aria-hidden="true"><title>${esc(e.label)}</title>${inner}</g>`;
  }
  const toneStyle = t => `--t0:${t[0]};--s0:${t[1]}${t[2] ? `;--o0:${t[2]}` : ""}`;

  function externalLayer(sex, view, st) {
    const halfSide = view === "back" ? "right" : "left", other = halfSide === "left" ? "right" : "left";
    let out = "";
    extGeo(sex, view === "back" ? "back" : "front").forEach(def => {
      const wrap = x => def.tf ? `<g transform="${def.tf}">${x}</g>` : x;
      const inner = wrap(def.shapes.map(shapeMarkup).join(""));
      if (def.k === "full") out += regionGroup(def.key, inner, "hit", st);
      else {
        out += regionGroup(`${halfSide}-${def.key}`, inner, "hit", st);
        out += regionGroup(`${other}-${def.key}`, `<g transform="${MIRROR}">${inner}</g>`, "hit", st);
      }
    });
    return out;
  }
  function organLayer(sex, st) {
    return organGeo(sex).map(o => regionGroup(o.id, o.shapes.map(shapeMarkup).join(""), "organ", st, toneStyle(o.tone))).join("");
  }
  function boneLayer(sex, view, st) {
    const halfSide = view === "back" ? "right" : "left", other = halfSide === "left" ? "right" : "left";
    let out = "";
    boneGeo(sex, view === "back" ? "back" : "front").forEach(def => {
      const wrap = x => def.tf ? `<g transform="${def.tf}">${x}</g>` : x;
      const inner = wrap(def.shapes.map(shapeMarkup).join(""));
      const cls = def.joint ? "joint" : "bone", style = def.joint ? "" : toneStyle(def.tone);
      if (def.k === "full") out += regionGroup(def.key, inner, cls, st, style);
      else if (def.k === "mid") out += regionGroup(def.key, inner + `<g transform="${MIRROR}">${inner}</g>`, cls, st, style);
      else {
        out += regionGroup(`${halfSide}-${def.key}`, inner, cls, st, style);
        out += regionGroup(`${other}-${def.key}`, `<g transform="${MIRROR}">${inner}</g>`, cls, st, style);
      }
    });
    return out;
  }

  /* ---- hands / feet detail view ---- */
  function detailMarkup(sex, mode, view, st) {
    const isHands = view === "hands";
    const sil = (inner, S, tf) => `<g transform="${tf}"><g class="${mode === "skeleton" ? "faint" : ""}"><g fill="${st.K.shade}" stroke="${st.K.shade}" stroke-width="2.4" stroke-linejoin="round">${inner("ss")}</g><g fill="url(#skin)" filter="url(#litD)">${inner("sf")}</g></g></g>`;
    let out = "", defs = "";
    const cells = [];
    if (mode === "external") {
      if (isHands) [["right", "palmar", 0, 0], ["left", "palmar", 1, 0], ["right", "dorsal", 0, 1], ["left", "dorsal", 1, 1]].forEach(c => cells.push(c));
      else [["right", "dorsal", 0, 0], ["left", "dorsal", 1, 0], ["right", "plantar", 0, 1], ["left", "plantar", 1, 1]].forEach(c => cells.push(c));
    } else {
      [["right", "bones", 0, 0], ["left", "bones", 1, 0]].forEach(c => cells.push(c));
    }
    const S = mode === "external" ? (isHands ? 1.9 : 2.05) : (isHands ? 2.3 : 2.3);
    const bones = mode === "skeleton" ? boneGeo(sex, "front") : [];
    const boneShapes = key => (bones.find(b => b.key === key) || { shapes: [] }).shapes;

    cells.forEach(([side, surface, col, row]) => {
      const cx = col ? 222 : 78;
      let cy, mirror;
      if (mode === "external") {
        cy = isHands ? (row ? 316 : 88) : (row ? 312 : 96);
        if (!isHands && surface === "plantar") cy = 312;
        mirror = isHands ? (surface === "palmar" ? side === "right" : side === "left") : (surface === "dorsal" ? side === "right" : side === "left");
      } else {
        cy = isHands ? 130 : 150;
        mirror = side === "right";
      }
      const tf = `translate(${cx} ${cy}) scale(${mirror ? -S : S} ${S})`;
      const label = mode === "external"
        ? `${side.toUpperCase()} ${isHands ? (surface === "palmar" ? "PALM SIDE" : "BACK OF HAND") : (surface === "dorsal" ? "TOP OF FOOT" : "SOLE")}`
        : `${side.toUpperCase()} ${isHands ? "HAND" : "FOOT"} BONES`;
      const capY = mode === "external" ? (row ? (isHands ? 234 : 256) : 14) : 14;
      out += `<text class="cell-cap" x="${cx}" y="${capY}" text-anchor="middle">${label}</text>`;
      let inner = "";
      if (isHands) {
        const sh = k => HAND.digits[k].d;
        const silParts = c => HAND.stub && [HAND.stub, HAND.palm, ...HAND.order.map(sh)].map(d => `<path class="${c}" d="${d}"/>`).join("");
        out += sil(silParts, S, tf);
        if (mode === "external") {
          const palmKey = surface === "palmar" ? "palm" : "back-of-hand";
          inner += regionGroup(`${side}-wrist`, `<path d="${HAND.stub}"/>`, "hit", st);
          inner += regionGroup(`${side}-${palmKey}`, `<path d="${HAND.palm}"/>`, "hit", st);
          HAND.order.forEach(k => { inner += regionGroup(`${side}-${k}`, `<path d="${sh(k)}"/>`, "hit", st); });
          const lines = surface === "palmar" ? `<path d="${HAND.palmar}"/>` : `<path d="${HAND.dorsal}"/><path class="nail" d="${HAND.nails}"/>`;
          out += `<g transform="${tf}">${inner}<g class="dl">${lines}</g></g>`;
        } else {
          const mk = (key, cls) => regionGroup(`${side}-${key}`, boneShapes(key).map(shapeMarkup).join(""), "bone", st, toneStyle(["#f2ead6", "#b5a880"]));
          inner = mk("wrist-bones") + mk("hand-bones") + mk("finger-bones");
          out += `<g transform="${tf}">${inner}</g>`;
        }
      } else {
        const toeD = k => FOOT.toes[k].d;
        if (mode === "external") {
          const base = surface === "dorsal" ? FOOT.top : FOOT.plantar;
          const silParts = c => [surface === "dorsal" ? FOOT.stub : "", base, ...FOOT.order.map(toeD)].filter(Boolean).map(d => `<path class="${c}" d="${d}"/>`).join("");
          out += sil(silParts, S, tf);
          if (surface === "dorsal") {
            inner += regionGroup(`${side}-ankle`, `<path d="${FOOT.stub}"/>`, "hit", st);
            inner += regionGroup(`${side}-foot-top`, `<path d="${FOOT.top}"/>`, "hit", st);
          } else {
            const cid = `c-plantar-${side}`;
            defs += `<clipPath id="${cid}"><path d="${FOOT.plantar}"/></clipPath>`;
            inner += regionGroup(`${side}-heel`, `<path d="${FOOT.heelRegion}" clip-path="url(#${cid})"/>`, "hit", st);
            inner += regionGroup(`${side}-sole`, `<path d="${FOOT.soleRegion}" clip-path="url(#${cid})"/>`, "hit", st);
          }
          FOOT.order.forEach(k => { inner += regionGroup(`${side}-${k}`, `<path d="${toeD(k)}"/>`, "hit", st); });
          const lines = surface === "dorsal" ? `<path d="${FOOT.dorsal}"/><path class="nail" d="${FOOT.nails}"/>` : `<path d="${FOOT.plantarLines}"/>`;
          out += `<g transform="${tf}">${inner}<g class="dl">${lines}</g></g>`;
        } else {
          const silParts = c => [FOOT.top, ...FOOT.order.map(toeD)].map(d => `<path class="${c}" d="${d}"/>`).join("");
          out += sil(silParts, S, tf);
          const mk = key => regionGroup(`${side}-${key}`, boneShapes(key).map(shapeMarkup).join(""), "bone", st, toneStyle(["#f2ead6", "#b5a880"]));
          out += `<g transform="${tf}">${mk("ankle-bones")}${mk("foot-bones")}${mk("toe-bones")}</g>`;
        }
      }
    });
    out += `<text class="note" x="150" y="${mode === "external" ? 466 : 300}" text-anchor="middle">${mode === "external" ? "Left / right = the patient's own left / right" : ""}</text>`;
    return { out, defs };
  }

  /* ---- main entry ---- */
  function buildSVG(opts) {
    const sex = opts.sex === "male" ? "male" : "female";
    const mode = LAYERS.includes(opts.mode) ? opts.mode : "external";
    let view = opts.view in VIEWBOX ? opts.view : "front";
    if (mode === "internal" && (view === "back" || view === "hands" || view === "feet")) view = "front";
    const K = SKIN[opts.skin] || SKIN.medium;
    const st = { selected: opts.selected || new Set(), groupOn: opts.groupOn || new Set(), K };
    let body = "", defs = realismDefs(K);
    if (view === "hands" || view === "feet") {
      const d = detailMarkup(sex, mode, view, st);
      body = d.out; defs += d.defs;
    } else {
      const bv = view === "back" ? "back" : "front";
      const P = bodyParts(sex, bv);
      defs += clipDefs(P);
      const photo = mode === "external" && opts.photo && /^(https?:|data:image\/|\/|\.\/|\.\.\/|[\w-]+[\w./-]*$)/i.test(opts.photo) ? opts.photo : "";
      if (photo) {
        body += `<image href="${esc(photo)}" x="0" y="0" width="300" height="650" preserveAspectRatio="xMidYMid meet"/>`;
      } else {
        const R = realism(sex, bv, K);
        body += R.ground + silhouetteMarkup(P, mode === "external" ? "" : "faint", K, "lit");
        if (mode === "external") body += R.under;
      }
      if (mode === "external") body += externalLayer(sex, bv, st);
      else if (mode === "internal") body += organLayer(sex, st);
      else body += boneLayer(sex, bv, st);
      if (view !== "head") {
        const mark = (x, t) => `<text class="lr" x="${x}" y="40" text-anchor="middle">${t}</text>`;
        body += bv === "front" ? mark(22, "R") + mark(278, "L") : mark(22, "L") + mark(278, "R");
        body += `<text class="caption" x="150" y="12" text-anchor="middle">${sex.toUpperCase()} · ${bv.toUpperCase()} VIEW</text>`;
      }
    }
    const label = `${sex} ${view} ${mode} body map`;
    return { view, svg: `<svg class="${opts.guides ? "guides" : ""}" viewBox="${VIEWBOX[view]}" role="group" aria-label="${esc(label)}. Use the region list for keyboard and screen-reader access."><defs>${defs}</defs>${body}</svg>` };
  }

  /* ====================================================================
   * 12. 3D MODEL BUILDER  (three.js is injected as THREE)
   *     World units = canvas pixels (1 px ~ 3 mm). +X = patient's LEFT,
   *     +Y = up, +Z = front of the body. The floor is Y = 0.
   *     The 2D region geometry above is re-used to label every vertex, so
   *     2D and 3D share exactly the same region IDs.
   * ==================================================================== */
  const GROUND = 620;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const gauss = (y, m, s, a) => a * Math.exp(-((y - m) * (y - m)) / (2 * s * s));
  const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

  /* ---- SVG path -> polylines (supports the M L H V C Q A Z commands used above) ---- */
  function parsePath(d, seg) {
    seg = seg || 10;
    const tok = d.match(/[MLHVCQAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
    const out = []; let cur = null, i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0;
    const num = () => parseFloat(tok[i++]);
    while (i < tok.length) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
      if (cmd === "M") { x = num(); y = num(); sx = x; sy = y; cur = { pts: [[x, y]], closed: false }; out.push(cur); cmd = "L"; }
      else if (cmd === "L") { x = num(); y = num(); cur.pts.push([x, y]); }
      else if (cmd === "H") { x = num(); cur.pts.push([x, y]); }
      else if (cmd === "V") { y = num(); cur.pts.push([x, y]); }
      else if (cmd === "C") {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
        for (let k = 1; k <= seg; k++) { const t = k / seg, u = 1 - t; cur.pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]); }
        x = x3; y = y3;
      } else if (cmd === "Q") {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num();
        for (let k = 1; k <= seg; k++) { const t = k / seg, u = 1 - t; cur.pts.push([u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2]); }
        x = x2; y = y2;
      } else if (cmd === "A") {
        let rx = Math.abs(num()), ry = Math.abs(num()); num(); const la = num(), sw = num(), x2 = num(), y2 = num();
        const dx = (x - x2) / 2, dy = (y - y2) / 2, lam = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
        if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
        const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx) / (rx * rx * dy * dy + ry * ry * dx * dx));
        const co = (la === sw ? -1 : 1) * Math.sqrt(sq), cxp = co * rx * dy / ry, cyp = -co * ry * dx / rx;
        const cx = cxp + (x + x2) / 2, cy = cyp + (y + y2) / 2;
        const a1 = Math.atan2((dy - cyp) / ry, (dx - cxp) / rx);
        let da = Math.atan2((-dy - cyp) / ry, (-dx - cxp) / rx) - a1;
        if (!sw && da > 0) da -= 2 * Math.PI; else if (sw && da < 0) da += 2 * Math.PI;
        const n = Math.max(6, Math.round(seg * 1.5));
        for (let k = 1; k <= n; k++) { const a = a1 + da * k / n; cur.pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
        x = x2; y = y2;
      } else if (cmd === "Z") { cur.closed = true; x = sx; y = sy; i += 0; if (i < tok.length && !/[A-Za-z]/.test(tok[i])) { cmd = "L"; cur = { pts: [[x, y]], closed: false }; out.push(cur); } }
      else i++;
    }
    return out.filter(r => r.pts.length > 1);
  }
  const inRing = (pts, x, y) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const ringBox = pts => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }); return [x0, y0, x1, y1]; };

  /* ---- transform strings ("translate() rotate() scale()") -> 2D affine ---- */
  function tfParse(str) {
    let m = [1, 0, 0, 1, 0, 0];
    const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    (str || "").replace(/(translate|rotate|scale)\(([^)]*)\)/g, (_, f, a) => {
      const v = a.trim().split(/[\s,]+/).map(Number);
      if (f === "translate") m = mul(m, [1, 0, 0, 1, v[0], v[1] || 0]);
      else if (f === "rotate") { const r = v[0] * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); m = mul(m, [c, s, -s, c, 0, 0]); }
      else m = mul(m, [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]);
      return "";
    });
    return m;
  }
  const tfPt = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

  /* ---- region mapper: canvas (x, y) -> region id, using the 2D polygons ---- */
  const MAPPERS = {};
  function getMapper(sex, view) {
    const key = sex + view;
    if (MAPPERS[key]) return MAPPERS[key];
    const P = bodyParts(sex, view);
    const polys = ds => { const a = []; ds.forEach(d => parsePath(d, 8).forEach(r => { a.push({ pts: r.pts, bb: ringBox(r.pts) }); a.push({ pts: r.pts.map(p => [300 - p[0], p[1]]), bb: ringBox(r.pts.map(p => [300 - p[0], p[1]])) }); })); return a; };
    const clips = { core: polys(P.sym.concat(P.coreSide)), arm: polys(P.armSide) };
    clips.body = clips.core.concat(clips.arm);
    const inside = (set, x, y) => set.some(r => x >= r.bb[0] && x <= r.bb[2] && y >= r.bb[1] && y <= r.bb[3] && inRing(r.pts, x, y));
    const halfSide = view === "back" ? "right" : "left", other = halfSide === "left" ? "right" : "left";
    const entries = extGeo(sex, view).filter(d => !d.tf).map(def => ({
      def, shapes: def.shapes.map(s => {
        const rings = parsePath(s.d, 8).map(r => r.pts);
        return { rings, bb: ringBox([].concat(...rings)), clip: s.clip };
      })
    }));
    const hit = (sh, x, y) => {
      if (x < sh.bb[0] || x > sh.bb[2] || y < sh.bb[1] || y > sh.bb[3]) return false;
      let c = false; sh.rings.forEach(r => { if (inRing(r, x, y)) c = !c; });
      return c;
    };
    const cache = new Map();
    const lookup = (x, y) => {
      const k = Math.round(x * 2) * 4096 + Math.round(y * 2);
      if (cache.has(k)) return cache.get(k);
      let res = null;
      for (let e = entries.length - 1; e >= 0 && !res; e--) {
        const { def, shapes } = entries[e];
        for (const sh of shapes) {
          if (sh.clip && !inside(clips[sh.clip], x, y)) continue;
          if (def.k === "full") { if (hit(sh, x, y)) { res = def.key; break; } }
          else if (hit(sh, x, y)) { res = `${halfSide}-${def.key}`; break; }
          else if (hit(sh, 300 - x, y)) { res = `${other}-${def.key}`; break; }
        }
      }
      cache.set(k, res); return res;
    };
    return (MAPPERS[key] = { lookup });
  }

  /* ---- mesh helpers ---- */
  const sideOfX = X => (X >= 0 ? "left" : "right");        // patient's left = +X
  function geomFrom(THREE, pos, idx, extra) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    if (extra && extra.front) g.setAttribute("front", new THREE.BufferAttribute(new Uint8Array(extra.front), 1));
    return g;
  }
  // Rings: {c:[X,Y,Z], u:[..], v:[..], r1, r2f, r2b, n}. u x v must point along the loft axis.
  function loft(THREE, rings, seg, o) {
    o = o || {};
    const R = rings.length, pos = [], front = [], idx = [];
    for (let i = 0; i < R; i++) {
      const r = rings[i], n = r.n || o.n || 2.4;
      for (let j = 0; j < seg; j++) {
        const t = 2 * Math.PI * j / seg, c = Math.cos(t), s = Math.sin(t);
        const kb = r.bump ? r.bump(t) : 1;
        const a = r.r1 * sgnPow(c, 2 / n) * kb, b = (s >= 0 ? r.r2f : r.r2b) * sgnPow(s, 2 / n) * kb;
        pos.push(r.c[0] + r.u[0] * a + r.v[0] * b, r.c[1] + r.u[1] * a + r.v[1] * b, r.c[2] + r.u[2] * a + r.v[2] * b);
        front.push(s >= 0 ? 1 : 0);
      }
    }
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg, a = i * seg + j, b = i * seg + j2, c = (i + 1) * seg + j, d = (i + 1) * seg + j2;
      idx.push(a, b, c, b, d, c);
    }
    const cap = (ring, base, top) => {
      const ci = pos.length / 3; pos.push(ring.c[0], ring.c[1], ring.c[2]); front.push(1);
      for (let j = 0; j < seg; j++) { const j2 = (j + 1) % seg; if (top) idx.push(ci, base + j2, base + j); else idx.push(ci, base + j, base + j2); }
    };
    if (o.capTop) cap(rings[0], 0, true);
    if (o.capBottom) cap(rings[R - 1], (R - 1) * seg, false);
    return geomFrom(THREE, pos, idx, { front });
  }
  function mirrorGeo(g) {
    const m = g.clone(), p = m.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
    const ix = m.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    m.index.needsUpdate = true; m.computeVertexNormals();
    return m;
  }
  function weld(THREE, g) {
    const p = g.attributes.position, map = new Map(), pos = [], idx = [], fr = [], remap = new Array(p.count);
    const f = g.attributes.front;
    for (let i = 0; i < p.count; i++) {
      const k = Math.round(p.getX(i) * 50) + "," + Math.round(p.getY(i) * 50) + "," + Math.round(p.getZ(i) * 50);
      let id = map.get(k);
      if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(p.getX(i), p.getY(i), p.getZ(i)); fr.push(f ? f.getX(i) : (p.getZ(i) >= 0 ? 1 : 0)); }
      remap[i] = id;
    }
    if (g.index) g.index.array.forEach(v => idx.push(remap[v])); else for (let i = 0; i < p.count; i++) idx.push(remap[i]);
    const out = [];
    for (let i = 0; i < idx.length; i += 3) if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) out.push(idx[i], idx[i + 1], idx[i + 2]);
    return geomFrom(THREE, pos, out, { front: fr });
  }
  // Extrude 2D polylines (canvas coords, optional affine tf) into a bevelled 3D slab.
  function extrude(THREE, d, tf, zc, depth, bevel, tfm) {
    const M = tf ? tfParse(tf) : null, parts = [];
    parsePath(d, 8).forEach(r => {
      if (!r.closed && r.pts.length < 3) return;
      const pts = r.pts.map(p => { const q = M ? tfPt(M, p) : p; return new THREE.Vector2(q[0] - 150, GROUND - q[1]); });
      if (pts.length < 3) return;
      const sh = new THREE.Shape(pts), bs = Math.min(bevel, depth * 0.9 + 1);
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bs, bevelSize: bs, bevelOffset: -bs, bevelSegments: 3, steps: 1, curveSegments: 4 });
      g.translate(0, 0, -depth / 2 + zc);
      parts.push(weld(THREE, g));
    });
    return parts;
  }
  function mergeGeos(THREE, list) {
    if (list.length === 1) return list[0];
    const pos = [], idx = [], fr = []; let off = 0;
    list.forEach(g => {
      const p = g.attributes.position, f = g.attributes.front;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); fr.push(f ? f.getX(i) : 1); }
      g.index.array.forEach(v => idx.push(v + off)); off += p.count;
    });
    return geomFrom(THREE, pos, idx, { front: fr });
  }
  function sphereGeo(THREE, cx, cy, cz, rx, ry, rz, seg) {
    const g = new THREE.SphereGeometry(1, seg || 16, Math.max(8, (seg || 16) / 2));
    g.scale(rx, ry, rz); g.translate(cx, cy, cz); return weld(THREE, g);
  }
  // Dense Catmull-Rom through arrays of numbers
  function catmullDense(pts, per) {
    const out = [], n = pts.length, k = pts[0].length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      for (let s = 0; s < per; s++) {
        const t = s / per, t2 = t * t, t3 = t2 * t, q = [];
        for (let c = 0; c < k; c++) q.push(0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
        out.push(q);
      }
    }
    out.push(pts[n - 1].slice()); return out;
  }
  const atY = (poly, y) => {           // poly sorted by y (index 1); returns interpolated array
    if (y <= poly[0][1]) return poly[0];
    for (let i = 1; i < poly.length; i++) if (poly[i][1] >= y) { const a = poly[i - 1], b = poly[i], t = (y - a[1]) / ((b[1] - a[1]) || 1); return a.map((v, c) => lerp(v, b[c], t)); }
    return poly[poly.length - 1];
  };

  /* ---- body profile functions shared by the external model, organs and bones ---- */
  function profiles(sex) {
    const D = dims(sex), F = D.F;
    const torso = catmullDense(D.torso.slice(), 8);
    const head = catmullDense(D.head.slice(), 8);
    const wT = y => Math.max(0, atY(torso, y)[0] - 150);
    const wH = y => Math.max(0, atY(head, y)[0] - 150);
    const kd = y => 0.54 + 0.24 * smooth((y - 126) / 50);
    const zf = y => kd(y) * wT(y) + gauss(y, 190, 24, F ? 1.5 : 3.5) + gauss(y, 266, 16, F ? 2 : 3.5);
    const zb = y => kd(y) * wT(y) + gauss(y, 170, 30, 3) - gauss(y, 252, 14, 3) + gauss(y, 314, 16, F ? 11 : 7);
    return { D, F, wT, wH, zf, zb, headCz: 4, headF: 1.1, headB: 1.34 };
  }
  function headZ(Pf, x, y) {            // z of the head surface (front) at canvas-offset x (|x| from centreline), y
    const hw = Pf.wH(y) || 1, a = Math.min(1, Math.abs(x) / hw), n = 2.3;
    const c = Math.pow(a, n / 2), s = Math.sqrt(Math.max(0, 1 - c * c));
    return Pf.headCz + Pf.headF * hw * Math.pow(s, 2 / n);
  }

  /* ---- anatomy helpers ---- */
  const angDiff = (t, t0) => { let d = (t - t0) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
  const lobe = (t, t0, sg) => { const d = angDiff(t, t0); return Math.exp(-(d * d) / (2 * sg * sg)); };
  const lobe2 = (t, t0, sg) => lobe(t, Math.PI / 2 - t0, sg) + lobe(t, Math.PI / 2 + t0, sg);     // symmetric pair about the front
  const lobeB2 = (t, t0, sg) => lobe(t, 1.5 * Math.PI - t0, sg) + lobe(t, 1.5 * Math.PI + t0, sg); // symmetric pair about the back
  const vnoise = (x, y, z) => {                       // cheap smooth value noise in [0,1]
    const h = (i, j, k) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
             L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
  };
  // Rings along a 3D polyline. radii(i,t01) -> [r1, r2f, r2b]; v is the "front" hint vector.
  function ringsAlong(pts, radii, hint, bump, n) {
    const out = [], L = pts.length;
    for (let i = 0; i < L; i++) {
      const a = pts[Math.min(L - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      let tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2]; const m = Math.hypot(tx, ty, tz) || 1; tx /= m; ty /= m; tz /= m;
      const h = hint || [0, 0, 1], dp = h[0] * tx + h[1] * ty + h[2] * tz;
      let vx = h[0] - tx * dp, vy = h[1] - ty * dp, vz = h[2] - tz * dp; const vm = Math.hypot(vx, vy, vz) || 1; vx /= vm; vy /= vm; vz /= vm;
      const ux = vy * tz - vz * ty, uy = vz * tx - vx * tz, uz = vx * ty - vy * tx;   // u = v x a
      const r = radii(i, i / Math.max(1, L - 1), pts[i]);
      out.push({ c: pts[i], u: [ux, uy, uz], v: [vx, vy, vz], r1: r[0], r2f: r[1], r2b: r[2], n: n || 2.2, bump: bump ? (t => bump(t, i / Math.max(1, L - 1), pts[i])) : null });
    }
    return out;
  }
  const rodrigues = (v, axis, ang) => {            // rotate v around unit axis
    const c = Math.cos(ang), s = Math.sin(ang), d = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
    const cx = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
    return [v[0] * c + cx[0] * s + axis[0] * d * (1 - c), v[1] * c + cx[1] * s + axis[1] * d * (1 - c), v[2] * c + cx[2] * s + axis[2] * d * (1 - c)];
  };

  /* ====================================================================
   * 12b. SCULPTED EXTERNAL BODY  (muscle / bone landmarks, sex differences)
   * ==================================================================== */
  function buildExternal(THREE, sex, skinName) {
    const Pf = profiles(sex), D = Pf.D, F = Pf.F, Mu = F ? 0.45 : 1, K = SKIN[skinName] || SKIN.medium;
    const W = (x, y, z) => [x - 150, GROUND - y, z || 0];
    const items = [];
    const add = (geom, base, o) => items.push(Object.assign({ geom, base, mirror: false }, o || {}));
    const X = [1, 0, 0], Z = [0, 0, 1], PI = Math.PI;
    const col = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
    const skin = col(K.base), hair = col(F ? "#3d2316" : "#2a1b13"), fabric = col(F ? "#aab3c2" : "#8f9aab"), nail = [Math.min(1, skin[0] * 1.08 + 0.05), skin[1] * 0.92 + 0.03, skin[2] * 0.92 + 0.03];
    const g = gauss;

    /* ---- head ---- */
    const headBump = y => t => 1
      + (F ? 0.045 : 0.035) * lobe2(t, 0.95, 0.27) * g(y, 63, 6, 1)                       // cheekbones
      + (F ? 0.015 : 0.05) * lobe(t, PI / 2, 0.8) * g(y, 50.5, 3, 1)                      // brow ridge
      - 0.03 * lobe2(t, 0.5, 0.22) * g(y, 58, 5, 1)                                        // eye sockets
      + 0.025 * lobe(t, PI / 2, 0.5) * g(y, 84, 7, 1)                                      // muzzle
      + (F ? 0.03 : 0.07) * lobe(t, PI / 2, F ? 0.28 : 0.42) * g(y, 96, 4, 1)              // chin
      + (F ? -0.035 : 0.06) * (lobe(t, 0.14, 0.3) + lobe(t, PI - 0.14, 0.3)) * g(y, 88, 7, 1)  // jaw angle: slim (F) / strong (M)
      + (F ? 0.03 : 0.005) * lobe(t, PI / 2, 0.7) * g(y, 41, 8, 1)                         // forehead
      - 0.02 * (lobe(t, 0.35, 0.3) + lobe(t, PI - 0.35, 0.3)) * g(y, 50, 6, 1);            // temples
    const hr = [];
    for (let y = 20; y <= 99.4; y += 2) { const hw = Math.max(0.6, Pf.wH(y)); hr.push({ c: W(150, y, Pf.headCz), u: X, v: Z, r1: hw, r2f: hw * Pf.headF, r2b: hw * Pf.headB, n: 2.3, bump: headBump(y) }); }
    hr.push({ c: W(150, 99.9, Pf.headCz), u: X, v: Z, r1: 0.4, r2f: 0.4, r2b: 0.4 });
    add(loft(THREE, hr, 56, { capTop: true }), skin);

    /* ---- neck ---- */
    const neckBump = y => t => 1 + 0.045 * lobe2(t, 0.9, 0.28) * g(y, 108, 18, 1) + (F ? 0 : 0.07) * lobe(t, PI / 2, 0.12) * g(y, 110, 4, 1) + 0.05 * lobe(t, 1.5 * PI, 0.9) * smooth((y - 100) / 20);
    const nr = []; for (let y = 86; y <= 128; y += 2.5) nr.push({ c: W(150, y, -1), u: X, v: Z, r1: D.neckHW * (y > 116 ? 1 + (y - 116) / 34 : 1), r2f: D.neckHW * 0.94, r2b: D.neckHW * 0.98, n: 2.1, bump: neckBump(y) });
    add(loft(THREE, nr, 36), skin);

    /* ---- torso (male: pecs/abs/lats, female: bust/waist/hips) ---- */
    const torsoBump = y => t => {
      let k = 1;
      k += (F ? 0.40 : 0.2) * lobe2(t, F ? 0.56 : 0.6, F ? 0.30 : 0.34) * g(y, F ? 199 : 173, F ? 15 : 16, 1);
      if (!F) k += 0.035 * lobe2(t, 0.55, 0.3) * g(y, 189, 4, 1);                                     // pec lower border
      const abs = (y > 224 && y < 304) ? 1 : 0, row = 0.5 + 0.5 * Math.cos((y - 233) * 2 * PI / 15.5);
      k += 0.022 * Mu * abs * (lobe2(t, 0.24, 0.11) + lobe2(t, 0.46, 0.11)) * (0.35 + 0.65 * row);   // rectus abdominis
      k -= 0.03 * (F ? 0.6 : 1) * abs * lobe(t, PI / 2, 0.06);                                       // linea alba
      k += (F ? 0.035 : 0.01) * lobe(t, PI / 2, 0.55) * g(y, 288, 14, 1);                           // lower belly
      k -= 0.05 * lobe(t, PI / 2, 0.06) * g(y, 266, 2.5, 1);                                          // navel
      k += 0.03 * lobe2(t, 0.95, 0.2) * g(y, 130, 4, 1);                                              // clavicles
      k += 0.05 * Mu * (lobe(t, -0.35, 0.4) + lobe(t, PI + 0.35, 0.4)) * g(y, 190, 28, 1);          // lats
      k -= 0.03 * lobe(t, 1.5 * PI, 0.08) * ((y > 130 && y < 300) ? 1 : 0);                          // spine groove
      k += 0.045 * lobeB2(t, 0.55, 0.28) * g(y, 165, 18, 1);                                          // scapulae
      k += 0.03 * Mu * lobeB2(t, 0.28, 0.12) * g(y, 245, 28, 1);                                      // erector spinae
      k += (F ? 0.11 : 0.075) * lobeB2(t, 0.6, 0.38) * g(y, 318, 18, 1);                              // gluteals
      k -= 0.09 * lobe(t, 1.5 * PI, 0.1) * g(y, 322, 14, 1);                                          // gluteal cleft
      if (F) k += 0.03 * (lobe(t, 0.05, 0.3) + lobe(t, PI - 0.05, 0.3)) * g(y, 310, 18, 1);           // hips
      return k;
    };
    const tr = [];
    for (let y = 112; y <= 339.5; y += 2.4) { const w = Pf.wT(y); if (w < 1.5) continue; tr.push({ c: W(150, y, 0), u: X, v: Z, r1: w, r2f: Math.max(2, Pf.zf(y)), r2b: Math.max(2, Pf.zb(y)), n: y > 290 ? 2.5 : 2.7, bump: torsoBump(y) }); }
    tr.push({ c: W(150, 341, 0), u: X, v: Z, r1: 0.5, r2f: 0.5, r2b: 0.5 });
    add(loft(THREE, tr, 72, { capTop: true }), skin);

    /* ---- arms ---- */
    const armBump = y => t => {
      let k = 1;
      k += 0.15 * Mu * lobe(t, 0.15, 1.0) * g(y, 152, 16, 1);                    // deltoid
      k += 0.09 * Mu * lobe(t, PI / 2, 0.7) * g(y, 205, 17, 1);                  // biceps
      k += 0.075 * Mu * lobe(t, 1.5 * PI, 0.8) * g(y, 198, 20, 1);               // triceps
      k += 0.10 * lobe(t, 1.5 * PI, 0.5) * g(y, 250, 4, 1);                      // olecranon
      k += 0.07 * lobe(t, 0.3, 0.9) * g(y, 272, 14, 1);                          // forearm extensors
      k += 0.06 * lobe(t, PI / 2 + 0.4, 0.9) * g(y, 268, 12, 1);                 // flexors
      return k;
    };
    const ap = catmullDense(D.arm, 6), apts = [], ar = [];
    ap.forEach(s => apts.push([s[0] - 150, GROUND - s[1], 0.045 * (s[1] - 138)]));
    const a0 = [apts[1][0] - apts[0][0], apts[1][1] - apts[0][1]], a0m = Math.hypot(a0[0], a0[1]);
    const capPts = []; for (let k = 4; k >= 1; k--) capPts.push([apts[0][0] - a0[0] / a0m * ap[0][2] * 0.55 * k / 4, apts[0][1] - a0[1] / a0m * ap[0][2] * 0.55 * k / 4, apts[0][2]]);
    const allA = capPts.concat(apts);
    const armRings = ringsAlong(allA, (i, t, p) => {
      const si = Math.max(0, i - 4), s = ap[Math.min(ap.length - 1, si)], fore = smooth((s[1] - 240) / 40);
      const cf = i < 4 ? Math.cos((4 - i) / 5 * PI / 2) : 1;
      return [s[2] * cf, s[2] * lerp(0.95, 0.78, fore) * cf, s[2] * lerp(0.95, 0.82, fore) * cf];
    }, Z, (t, tt, p) => armBump(GROUND - p[1])(t), 2.1);
    add(loft(THREE, armRings, 36, { capTop: true }), skin, { mirror: true });

    /* ---- legs ---- */
    const iB = D.leg.findIndex(p => p[1] >= 591.9);
    const outer = D.leg.slice(0, iB), inner = D.leg.slice(iB + 3, D.leg.length - 2).reverse();
    const oD = catmullDense(outer.map(p => [p[0], p[1]]), 6), iD = catmullDense(inner.map(p => [p[0], p[1]]), 6);
    const legBump = y => t => {
      let k = 1;
      k += 0.10 * Mu * lobe(t, PI / 2, 0.8) * g(y, 385, 28, 1) + 0.06 * Mu * lobe(t, 0.5, 0.5) * g(y, 392, 26, 1);   // quadriceps
      k += 0.05 * lobe(t, PI - 0.15, 0.6) * g(y, 365, 24, 1);                                                          // adductors
      k += 0.06 * Mu * lobe(t, 1.5 * PI, 0.9) * g(y, 385, 28, 1);                                                      // hamstrings
      k += 0.05 * lobe(t, PI / 2, 0.35) * g(y, 440, 7, 1) + 0.04 * (lobe(t, 0, 0.4) + lobe(t, PI, 0.4)) * g(y, 442, 10, 1);   // knee
      k += 0.15 * Mu * (lobe(t, 1.5 * PI - 0.45, 0.45) * 1.15 + lobe(t, 1.5 * PI + 0.45, 0.45)) * g(y, 495, 20, 1);    // calf
      k -= 0.06 * lobe(t, 1.5 * PI, 0.3) * g(y, 556, 10, 1);                                                           // Achilles groove
      k += 0.11 * lobe(t, PI, 0.3) * g(y, 581, 5, 1) + 0.12 * lobe(t, 0, 0.3) * g(y, 583, 5, 1);                      // malleoli
      if (F) k += 0.055 * (lobe(t, 0, 0.9) + lobe(t, PI / 2, 1.2) + lobe(t, 1.5 * PI, 1.2)) * g(y, 330, 22, 1);        // thigh fullness
      return k;
    };
    const legRing = (y, scale) => {
      const xo = atY(oD, y)[0], xi = y < iD[0][1] ? iD[0][0] : atY(iD, y)[0];
      const r1 = (xo - xi) / 2 * (scale || 1), cx = (xo + xi) / 2;
      const calf = gauss(y, 500, 26, 0.2), shin = smooth((y - 450) / 30) * (1 - smooth((y - 560) / 30));
      return { c: W(cx, y, lerp(0, -3, shin)), u: X, v: Z, r1, r2f: r1 * (0.98 - 0.16 * shin), r2b: r1 * (0.98 + calf + 0.1 * shin), n: 2.2, bump: legBump(y) };
    };
    const lg = []; for (let y = 298; y <= 592; y += 2.6) lg.push(legRing(y)); lg.push({ ...legRing(592), c: W((atY(oD, 592)[0] + iD[iD.length - 1][0]) / 2, 598, -2), r1: 7, r2f: 7, r2b: 7, bump: null });
    add(loft(THREE, lg, 36), skin, { mirror: true });

    /* ---- clothing: shorts (both) + bust band (female) ---- */
    const bt = []; for (let y = 303; y <= 339.5; y += 2.4) { const w = Pf.wT(y); if (w < 1.5) continue; bt.push({ c: W(150, y, 0), u: X, v: Z, r1: w + 1, r2f: Pf.zf(y) + 1, r2b: Pf.zb(y) + 1, n: 2.5, bump: torsoBump(y) }); }
    add(loft(THREE, bt, 72), fabric, { fabric: true });
    const bl = []; for (let y = 298; y <= 354; y += 2.6) { const r = legRing(y, 1.04); r.r1 += 0.8; r.r2f += 1.1; r.r2b += 1.1; bl.push(r); }
    add(loft(THREE, bl, 36), fabric, { mirror: true, fabric: true });
    if (F) {
      const bb = []; for (let y = 168; y <= 223; y += 2.2) { const w = Pf.wT(y); bb.push({ c: W(150, y, 0), u: X, v: Z, r1: w + 0.9, r2f: Pf.zf(y) + 0.9, r2b: Pf.zb(y) + 0.9, n: 2.7, bump: torsoBump(y) }); }
      add(loft(THREE, bb, 72), fabric, { fabric: true, bra: true });
    }

    /* ---- ears ---- */
    extrude(THREE, ell(178.2, 65, 3.0, 6.0), "", Pf.headCz - 3.0, 2.0, 1.2).forEach(g2 => add(g2, skin, { mirror: true }));

    /* ---- hands (lofted palm, jointed curled fingers, nails) ---- */
    buildHand(THREE, D, F, skin, nail).forEach(h => add(h.geom, h.base, { mirror: true, fixedKey: h.key }));

    /* ---- feet ---- */
    buildFoot(THREE, Pf, skin).forEach(f => add(f.geom, skin, { mirror: true, foot: f }));

    /* ---- hair ---- */
    const hairY = [[0, 35.6], [10, 36.4], [18, 39.5], [24, 45], [28, 55], [40, 82]], seg = 64;
    const hh = [], yEnd = F ? 262 : 73;
    for (let y = 16.8; y <= yEnd; y += (y < 75 ? 1.5 : 3)) {
      let c = W(150, y, Pf.headCz), r1, r2f, r2b;
      if (y <= 73) { const hw = Math.max(0.6, Pf.wH(y + 3.2)); r1 = hw * 1.045; r2f = hw * Pf.headF * 1.045; r2b = hw * Pf.headB * 1.055; if (!F && y < 45) { r1 *= 1.02; r2b *= 1.02; } }
      else {
        const tt = smooth((y - 73) / 55), hw = Math.max(0.6, Pf.wH(73 + 3.2));
        const endTaper = y > yEnd - 22 ? Math.cos((y - (yEnd - 22)) / 22 * PI / 2 * 0.98) : 1;
        c = W(150, y, lerp(Pf.headCz, 0, tt));
        r1 = lerp(hw * 1.07, Math.max(10, Pf.wT(y) * 0.9), tt) * endTaper;
        r2f = lerp(hw * Pf.headF * 1.07, 2, smooth((y - 72) / 10)) * endTaper;
        r2b = lerp(hw * Pf.headB * 1.08, Pf.zb(Math.max(y, 126)) + 5.5, tt) * endTaper;
      }
      const yy = y, hb = F ? (t => 1 + 0.035 * Math.sin(yy * 0.11) * (yy > 75 ? 1 : 0) + 0.05 * lobe(t, PI / 2 + 0.3, 0.9) * g(yy, 30, 9, 1))
                           : (t => 1 + 0.15 * lobe(t, PI / 2 - 0.35, 0.8) * g(yy, 27, 10, 1) + 0.03 * lobe2(t, 1.3, 0.5) * g(yy, 36, 8, 1) - 0.15 * smooth((yy - 52) / 10) * (1 - 0.85 * lobe(t, 1.5 * PI, 0.95)));
      hh.push({ c, u: X, v: Z, r1, r2f, r2b, n: 2.3, bump: hb });
    }
    const hairG = loft(THREE, hh, seg, { capTop: true });
    { const p = hairG.attributes.position, fr = hairG.attributes.front;
      for (let i = 0; i < hh.length * seg; i++) {
        if (!fr.getX(i)) continue;
        const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), yc = GROUND - py, ax = Math.abs(px);
        if (yc > 73) continue;
        let hl = hairY[hairY.length - 1][1]; for (let k = 1; k < hairY.length; k++) if (ax <= hairY[k][0]) { const a = hairY[k - 1], b = hairY[k]; hl = lerp(a[1], b[1], (ax - a[0]) / (b[0] - a[0])); break; }
        const f = 1 - 0.1 * smooth((yc - hl + 2.5) / 6);
        if (f < 1) p.setXYZ(i, px * f, py, (pz - Pf.headCz) * f + Pf.headCz);
      }
      hairG.computeVertexNormals(); }
    if (FIGURE.hair) add(hairG, hair, { hair: true });

    /* ---- true surface sampler (used to place face features / hair locks exactly) ---- */
    const sMeshes = [items[0], items[1], items[2], items[3]].map(it => { const m = new THREE.Mesh(it.geom, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(); return m; });
    if (F) { const bra = items.find(it => it.bra); if (bra) { const m = new THREE.Mesh(bra.geom, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(); sMeshes.push(m); } }
    const rcz = new THREE.Raycaster();
    const surfaceAt = (xc, yc) => { rcz.set(new THREE.Vector3(xc, GROUND - yc, 400), new THREE.Vector3(0, 0, -1)); const h = rcz.intersectObjects(sMeshes, false); return h.length ? h[0].point.z : Pf.headCz; };
    if (F && FIGURE.hair) {   // long hair: two front locks that frame the face and fall over the shoulders
      const path = [[177, 42, 7], [178.5, 58, 4.5], [177, 76, 3.5], [181, 98, 3], [189, 122, 3.5], [191, 150, 3.5], [187, 180, 4], [185, 210, 4], [188, 236, 3]];
      const pts = catmullDense(path.map(p => [p[0], p[1], p[2]]), 6).map(p => { const zs = surfaceAt(p[0] - 150, p[1]); return [p[0] - 150 + (p[1] > 100 ? 2.2 * Math.sin(p[1] * 0.07) : 0), GROUND - p[1], Math.max(zs + 1.4, p[2] + 3)]; });
      const rings = ringsAlong(pts, (i, t) => { const w = lerp(5.0, 10.5, smooth(t * 1.7)) * (t > 0.86 ? Math.cos((t - 0.86) / 0.14 * PI / 2 * 0.97) : 1); return [Math.max(0.5, w), Math.max(0.5, w * 0.3), 1.0]; }, [0, 0, 1], null, 2.2);
      add(loft(THREE, rings, 14, { capTop: true, capBottom: true }), hair, { hair: true, mirror: true });
    }
    return { items, K, Pf, D, skin, hair, nail, surfaceAt };
  }

  /* ---- a hand: lofted palm + 4 curled fingers + thumb + nails (right-half coords; mirrored later) ---- */
  function buildHand(THREE, D, F, skin, nail) {
    const out = [], s = F ? 0.94 : 1, hm = tfParse(D.handTF), HW = (xl, yl, zl) => { const q = tfPt(hm, [xl, yl]); return [q[0] - 150, GROUND - q[1], zl * s]; };
    // palm
    const ys = []; for (let y = -6; y <= 39; y += 3) ys.push(y);
    const pr = ringsAlong(ys.map(y => HW(0, y, 0)), (i, t) => {
      const y = ys[i], w = lerp(9.6, 14.6, smooth((y + 4) / 30)) * (y > 30 ? 0.97 : 1), th = lerp(6.4, 4.6, smooth((y + 4) / 32));
      return [w * s, th * s * 1.05, th * s * 0.95];
    }, [0, 0, 1], (t, tt, p) => { const yl = ys[Math.round(tt * (ys.length - 1))]; return 1 + 0.3 * lobe(t, 0.65, 0.45) * gauss(yl, 18, 8, 1) + 0.12 * lobe(t, PI_ + 0.3, 0.5) * gauss(yl, 24, 8, 1); }, 2.7);
    out.push({ geom: loft(THREE, pr, 28, { capBottom: true }), base: skin, key: "palm|back-of-hand" });
    const fingers = [["index-finger", 10.6, 29, 6.3, 2.6, [10, 26, 18]], ["middle-finger", 3.7, 32, 6.5, 0.8, [12, 30, 20]], ["ring-finger", -3.1, 29, 6.1, -1.4, [14, 32, 22]], ["little-finger", -9.6, 23, 5.3, -3.8, [16, 34, 24]]];
    fingers.forEach(([key, x0, len, w, dx, curl]) => {
      let d = [dx, len, 0]; const m = Math.hypot(d[0], d[1]); d = [d[0] / m, d[1] / m, 0];
      const L = [len * 0.46, len * 0.30, len * 0.24]; let p = [x0, 35.5, 0]; const chain = [p.slice()]; let ang = 0;
      L.forEach((l, i) => { ang += curl[i] * Math.PI / 180; const dd = rodrigues(d, [1, 0, 0], ang); p = [p[0] + dd[0] * l, p[1] + dd[1] * l, p[2] + dd[2] * l]; chain.push(p.slice()); });
      const dense = catmullDense(chain, 5);
      const rings = ringsAlong(dense.map(q => HW(q[0], q[1], q[2])), (i, t) => {
        const tp = Math.cos(Math.max(0, i - (dense.length - 4)) / 3 * 1.2), kn = 1 + 0.07 * (Math.exp(-Math.pow((t - 0.46) / 0.05, 2)) + Math.exp(-Math.pow((t - 0.76) / 0.05, 2)));
        const r = w / 2 * (1 - 0.16 * t) * kn * (i >= dense.length - 3 ? Math.max(0.35, tp) : 1) * s;
        return [r, r * 0.9, r * 0.82];
      }, [0, 0, 1], null, 2.2);
      out.push({ geom: loft(THREE, rings, 14, { capBottom: true }), base: skin, key });
      const tipW = HW(chain[3][0], chain[3][1], chain[3][2]), bkW = [0, 0, -1];
      out.push({ geom: sphereGeo(THREE, tipW[0], tipW[1] + 1.4, tipW[2] - w * 0.3 * s, w * 0.30 * s, 2.7 * s, 0.9 * s, 10), base: nail, key });
    });
    // thumb
    const tdirs = [[0.45, 1, 0.55], [0.3, 1, 0.5], [0.2, 1, 0.55]], tl = [14, 12, 11]; let tp = [10, 12, 0]; const tch = [tp.slice()];
    tdirs.forEach((d, i) => { const m = Math.hypot(...d); tp = [tp[0] + d[0] / m * tl[i], tp[1] + d[1] / m * tl[i], tp[2] + d[2] / m * tl[i]]; tch.push(tp.slice()); });
    const td = catmullDense(tch, 5), trg = ringsAlong(td.map(q => HW(q[0], q[1], q[2])), (i, t) => { const r = lerp(6.1, 4.5, t) * (i >= td.length - 3 ? 0.78 : 1) * s; return [r, r * 0.92, r * 0.85]; }, [0, 0, 1], null, 2.2);
    out.push({ geom: loft(THREE, trg, 16, { capBottom: true }), base: skin, key: "thumb" });
    const tt = HW(tch[3][0], tch[3][1], tch[3][2]);
    out.push({ geom: sphereGeo(THREE, tt[0], tt[1] + 1.4, tt[2] - 3.4 * s, 3.2 * s, 3.2 * s, 1 * s, 10), base: nail, key: "thumb" });
    return out;
  }
  const PI_ = Math.PI;

  function buildFoot(THREE, Pf, skin) {
    // Local foot space: ankle at origin, +yl toward the toes, big toe on -x. Origin placed under the leg.
    const OX = 20.5, rot = 0.14, out = [];
    const plantar = parsePath(FOOT.plantar, 10)[0].pts;
    const scanX = yl => { let lo = 1e9, hi = -1e9; for (let i = 0; i < plantar.length; i++) { const a = plantar[i], b = plantar[(i + 1) % plantar.length]; if ((a[1] - yl) * (b[1] - yl) <= 0 && a[1] !== b[1]) { const x = a[0] + (b[0] - a[0]) * (yl - a[1]) / (b[1] - a[1]); lo = Math.min(lo, x); hi = Math.max(hi, x); } } return [lo, hi]; };
    const hY = yl => yl < -16 ? lerp(8, 22, smooth((yl + 23) / 7)) : yl < 6 ? lerp(22, 25, smooth((yl + 16) / 22)) : yl < 30 ? lerp(25, 17, smooth((yl - 6) / 24)) : lerp(17, 11, smooth((yl - 30) / 20));
    const toLocal = (xl, yl, Y) => { const c = Math.cos(rot), s = Math.sin(rot); return [OX + xl * c + yl * s, Y, -xl * s + yl * c]; };
    const rings = [];
    for (let yl = -22.5; yl <= 49; yl += 2.2) {
      let [lo, hi] = scanX(yl); if (!isFinite(lo)) continue;
      const w = (hi - lo) / 2, xc = (lo + hi) / 2, h = hY(yl), edge = yl < -19 ? Math.sqrt(Math.max(0.05, (yl + 23) / 4)) : 1;
      const cen = toLocal(xc, yl, h / 2);
      const c = Math.cos(rot), s = Math.sin(rot);
      rings.push({ c: cen, u: [c, 0, -s], v: [0, 1, 0], r1: Math.max(0.5, w * edge), r2f: Math.max(0.5, h / 2 * edge), r2b: Math.max(0.5, h / 2 * edge), n: 3 });
    }
    // orientation: u x v must follow the axis (+Z local). u=(c,0,-s), v=Y -> u x v = (c,0,-s)x(0,1,0) = (s, 0, c)... ok
    const g = loft(THREE, rings, 24, { capBottom: true });
    const p = g.attributes.position; const lab = [];
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i) - OX, Zv = p.getZ(i), c = Math.cos(rot), s = Math.sin(rot);
      const xl = X * c - Zv * s, yl = X * s + Zv * c, Y = p.getY(i), top = g.attributes.front.getX(i);
      lab.push(yl < -8 && Y < 18 ? "heel" : top ? (yl < -4 ? "ankle" : "foot-top") : (yl < 4 ? "heel" : "sole"));
    }
    out.push({ geom: g, key: null, labels: lab });
    FOOT.order.forEach(k => {
      const t = FOOT.toes[k], st = t.st, r = [];
      const dense = catmullDense(st, 5);
      const hT = 7.2;
      dense.forEach((q, i) => {
        const a = dense[Math.min(dense.length - 1, i + 1)], b = dense[Math.max(0, i - 1)];
        const taper = i > dense.length - 4 ? Math.cos((i - (dense.length - 4)) / 3 * 1.1) : 1;
        const c = Math.cos(rot), s = Math.sin(rot), cen = toLocal(q[0], q[1], hT * 0.55 + 1);
        r.push({ c: cen, u: [c, 0, -s], v: [0, 1, 0], r1: q[2] * taper, r2f: Math.max(0.5, q[2] * 0.85 * taper), r2b: Math.max(0.5, (hT * 0.55 + 1) * taper), n: 2.4 });
      });
      out.push({ geom: loft(THREE, r, 14, { capBottom: true }), key: k });
    });
    return out;
  }

  /* ---- bone / organ helpers ---- */
  const footPoint = (xl, yl, Y) => { const rot = 0.14, c = Math.cos(rot), s = Math.sin(rot); return [20.5 + xl * c + yl * s, Y, -xl * s + yl * c]; };

  function longBone(THREE, p0, p1, r, rEnd0, rEnd1, n) {
    // p0,p1 in canvas coords (x,y,z). Loft along the line with bulged ends.
    const rings = [], a = [p1[0] - p0[0], -(p1[1] - p0[1])], L = Math.hypot(a[0], a[1]), ax = a[0] / L, ay = a[1] / L;
    const steps = Math.max(6, Math.round(L / 3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, rr = r * (1 + (rEnd0 - 1) * Math.pow(1 - t, 6) + (rEnd1 - 1) * Math.pow(t, 6));
      rings.push({ c: [lerp(p0[0], p1[0], t) - 150, GROUND - lerp(p0[1], p1[1], t), lerp(p0[2] || 0, p1[2] || 0, t)], u: [-ay, ax, 0], v: [0, 0, 1], r1: rr, r2f: rr, r2b: rr, n: 2 });
    }
    return loft(THREE, rings, 12, { capTop: true, capBottom: true });
  }
  function tubeAlong(THREE, pts3, radius, seg) {
    const curve = new THREE.CatmullRomCurve3(pts3.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(curve, Math.max(12, pts3.length * 2), radius, seg || 8, false);
    return weld(THREE, g);
  }
  function pathPoints3(d, zFn, step) {
    const rings = parsePath(d, 10), out = [];
    rings.forEach(r => {
      const pts = []; let acc = 0, last = null;
      r.pts.forEach((p, i) => { if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= (step || 2.5) || i === r.pts.length - 1) { pts.push(p); last = p; } });
      out.push(pts.map((p, i) => { const t = i / Math.max(1, pts.length - 1); return [p[0] - 150, GROUND - p[1], zFn(p[0], p[1], t, i)]; }));
    });
    return out;
  }
  const bendZ = (g, fn) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + fn(p.getX(i) + 150, GROUND - p.getY(i), p.getZ(i))); return g; };

  function buildOrgans(THREE, sex, Pf) {
    const out = []; // {id, geoms:[], tone}
    const Z = {
      "right-lung": [-2, 46, 7], "left-lung": [-2, 46, 7], trachea: [2, 8, 2.5], larynx: [3, 12, 3], thyroid: [7, 8, 2.5], heart: [11, 32, 9],
      spleen: [-22, 16, 5], pancreas: [-12, 12, 4], "right-kidney": [-24, 20, 6], "left-kidney": [-24, 20, 6], "adrenal-glands": [-24, 6, 2],
      stomach: [10, 22, 6], liver: [8, 40, 9], gallbladder: [8, 10, 3.5], rectum: [-10, 12, 4], bladder: [12, 24, 7], uterus: [4, 18, 6],
      ovaries: [2, 8, 3], prostate: [-2, 14, 5], testes: [4, 12, 4.5], "left-breast-tissue": [19, 14, 6], "right-breast-tissue": [19, 14, 6],
      sinuses: [18, 4, 1.6], teeth: [24, 4, 1.2]
    };
    const TZ = { esophagus: -8, "small-intestine": 12, "large-intestine": 5, appendix: 6, ureters: -18, "fallopian-tubes": 4 };
    organGeo(sex).forEach(o => {
      const geoms = [];
      if (o.id === "brain") {
        [[2, 38, 9], [-14, 22, 5], [-6, 9, 3]].forEach((zz, i) => extrude(THREE, o.shapes[i].d, "", zz[0], zz[1], zz[2]).forEach(g => geoms.push(g)));
      } else if (o.id === "eyes") {
        [-1, 1].forEach(s => geoms.push(sphereGeo(THREE, s * 13, GROUND - 57, headZ(Pf, 13, 57) - 4, 6.2, 6.2, 6.2, 20)));
      } else {
        o.shapes.forEach(s => {
          if (s.cls === "ln" || s.cls === "iris") return;
          if (s.t) {
            pathPoints3(s.d, (x, y, t, i) => (TZ[o.id] || 0) + (o.id === "small-intestine" ? 5 * Math.sin(i * 0.55) : o.id === "large-intestine" ? 3 * Math.sin(i * 0.3) : 0), 3).forEach(pts => { if (pts.length > 1) geoms.push(tubeAlong(THREE, pts, s.t * 0.52, 8)); });
          } else {
            const z = Z[o.id] || [0, 10, 3];
            extrude(THREE, s.d, "", z[0], z[1], z[2]).forEach(g => geoms.push(g));
          }
        });
      }
      if (geoms.length) out.push({ id: o.id, geoms, tone: o.tone });
    });
    return out;
  }

  function buildBones(THREE, sex, Pf) {
    const D = Pf.D, out = [];           // {key, pair, geoms, joint}
    const B = {}; boneGeo(sex, "back").forEach(b => { B[b.key] = b; }); boneGeo(sex, "front").forEach(b => { B[b.key] = b; });
    const zs = y => -lerp(4, 0.56 * Pf.zb(y), smooth((y - 105) / 40));
    const add = (key, geoms, pair, joint) => out.push({ key, geoms: [].concat(geoms), pair: !!pair, joint: !!joint });
    const dShapes = (key, zc, depth, bev, tf, zFn) => { const gs = []; B[key].shapes.forEach(s => { if (s.cls === "hole" || s.cls === "ln" || s.cls === "tooth" || s.t) return; extrude(THREE, s.d, tf || B[key].tf || "", zc, depth, bev).forEach(g => { if (zFn) bendZ(g, zFn); gs.push(g); }); }); return gs; };

    // skull & jaw
    const sr = []; for (let y = 18; y <= 88; y += 2.4) { const hw = Math.max(0.5, Pf.wH(y)) * 0.93; sr.push({ c: [0, GROUND - y, Pf.headCz], u: [1, 0, 0], v: [0, 0, 1], r1: hw * (y > 70 ? 0.8 : 1), r2f: hw * Pf.headF * (y > 70 ? 0.85 : 0.96), r2b: hw * Pf.headB, n: 2.3 }); }
    sr.push({ c: [0, GROUND - 88.5, Pf.headCz], u: [1, 0, 0], v: [0, 0, 1], r1: 0.4, r2f: 0.4, r2b: 0.4 });
    const sk = [loft(THREE, sr, 36, { capTop: true })];
    sk.push(sphereGeo(THREE, 13, GROUND - 56, headZ(Pf, 13, 56) - 1, 6.3, 5.6, 4, 12), sphereGeo(THREE, -13, GROUND - 56, headZ(Pf, 13, 56) - 1, 6.3, 5.6, 4, 12));
    add("skull", sk, false);
    add("jawbone", dShapes("jawbone", 0, 6, 2.2, "", (x, y, z) => Pf.headCz + 18 - 0.02 * (x - 150) * (x - 150)), false);
    // spine
    const vert = (y, w, h, kind) => {
      const g = new THREE.CylinderGeometry(w * 0.46, w * 0.5, h, 12); g.translate(0, 0, 0);
      const z = zs(y + h / 2); const gg = weld(THREE, g); gg.translate(0, GROUND - (y + h / 2), z);
      const sp = new THREE.BoxGeometry(2.2, h * 0.85, 7); sp.translate(0, GROUND - (y + h / 2) - 1, z - w * 0.5 - 2.5);
      const tp = new THREE.BoxGeometry(w * 1.45, h * 0.35, 2.6); tp.translate(0, GROUND - (y + h / 2), z - w * 0.34);
      return [gg, weld(THREE, sp), weld(THREE, tp)];
    };
    const sg = { c: [], t: [], l: [] };
    for (let i = 0; i < 7; i++) vert(101 + i * 3.8, 11 + i * 0.3, 3.2).forEach(g => sg.c.push(g));
    for (let i = 0; i < 12; i++) vert(129 + i * 7.7, 13 + i * 0.55, 6.4).forEach(g => sg.t.push(g));
    for (let i = 0; i < 5; i++) vert(224 + i * 9.4, 22 + i * 0.5, 8).forEach(g => sg.l.push(g));
    add("cervical-spine", sg.c, false); add("thoracic-spine", sg.t, false); add("lumbar-spine", sg.l, false);
    add("sacrum", dShapes("sacrum", 0, 12, 4, "", (x, y) => zs(270) - 6 + (y - 270) * 0.34), false);
    add("coccyx", dShapes("coccyx", 0, 5, 1.6, "", (x, y) => zs(270) - 6 + (y - 270) * 0.4 + 6), false);
    add("sternum-bone", dShapes("sternum-bone", 0, 5, 1.8, "", (x, y) => Pf.zf(y) * 0.9 - 0.5), false);
    // ribs (tubes that wrap from the spine to the sternum)
    const ribs = []; const ys = [134, 141, 149, 157, 165, 173, 181, 189, 196, 203, 210, 216];
    B.ribs.shapes.forEach((s, i) => {
      const y0 = ys[i], Af = Pf.zf(y0 + 10) * 0.82, Ab = Pf.zb(y0 + 10) * 0.8;
      pathPoints3(s.d, (x, y, t) => ((Af + Ab) / 2) * -Math.cos(Math.PI * t) + (Af - Ab) / 2, 2.2).forEach(pts => { if (pts.length > 2) ribs.push(tubeAlong(THREE, pts, 1.7, 7)); });
    });
    add("ribs", ribs, true);
    // clavicle
    const cl = []; pathPoints3(B.clavicle.shapes[0].d, (x, y, t) => lerp(Pf.zf(130) * 0.86, 2, smooth(t)), 3).forEach(pts => cl.push(tubeAlong(THREE, pts, 2.2, 8)));
    add("clavicle", cl, true);
    add("scapula-bone", dShapes("scapula-bone", 0, 3, 1.4, "", (x, y) => -Pf.zb(y) * 0.76 + 0.011 * Math.pow(Math.abs(x - 150) - 28, 2) - 4), true);
    // arm bones
    const hum = [longBone(THREE, [213, 152, 0], [232, 240, 0], 4.1, 1.15, 1.35), sphereGeo(THREE, 210 - 150, GROUND - 146, 0, 8.5, 8.5, 8.5, 14), sphereGeo(THREE, 233 - 150, GROUND - 246, 0, 10, 6, 6.5, 12)];
    add("humerus", hum, true);
    add("radius", [longBone(THREE, [238, 258, 2], [257, 330, 2], 2.5, 1.3, 1.9), sphereGeo(THREE, 238 - 150, GROUND - 254, 2, 4.4, 3, 4.4, 10)], true);
    add("ulna", [longBone(THREE, [232, 254, -2], [248, 328, -2], 2.6, 1.8, 1.2), sphereGeo(THREE, 232 - 150, GROUND - 250, -2, 6, 7, 6, 10)], true);
    add("wrist-bones", dShapes("wrist-bones", 0, 8, 3), true);
    add("hand-bones", dShapes("hand-bones", 0, 3.6, 1.5), true);
    add("finger-bones", dShapes("finger-bones", 0, 3, 1.2), true);
    // pelvis
    add("hip-bone", dShapes("hip-bone", 0, 8, 3, "", (x, y) => -Pf.zb(Math.min(y, 300)) * 0.5 + 0.5 * Math.min(60, Math.abs(x - 150)) * 0.6 - 4 + Math.max(0, y - 322) * 1.0), true);
    // leg bones
    add("femur", [longBone(THREE, [191, 322, 0], [176, 430, 0], 5, 1.1, 1.5), longBone(THREE, [197, 327, 0], [188, 316, 0], 3.4, 1, 1), sphereGeo(THREE, 188 - 150, GROUND - 313, 0, 8.5, 8.5, 8.5, 14), sphereGeo(THREE, 199 - 150, GROUND - 325, 0, 6.5, 8, 6.5, 12), sphereGeo(THREE, 175 - 150, GROUND - 433, 0, 12.5, 7.5, 9, 14)], true);
    add("patella", [sphereGeo(THREE, 172 - 150, GROUND - 441, 12.5, 6.5, 8, 3.2, 12)], true);
    add("tibia", [longBone(THREE, [172, 450, -2], [167, 576, -2], 3.9, 1.5, 1.2), sphereGeo(THREE, 171 - 150, GROUND - 447, -2, 12, 4.8, 9, 14), sphereGeo(THREE, 163 - 150, GROUND - 579, -2, 4, 5.4, 4, 10)], true);
    add("fibula", [longBone(THREE, [184, 454, -4], [181, 578, -4], 2.2, 1.5, 1.3), sphereGeo(THREE, 184 - 150, GROUND - 451, -4, 3.8, 5, 3.8, 10), sphereGeo(THREE, 182 - 150, GROUND - 581, -4, 3.8, 6, 3.8, 10)], true);
    // foot bones (in the foot's own local axes)
    const fbones = [], tarsal = sphereGeo(THREE, 0, 0, 0, 1, 1, 1, 10);
    const P3 = (xl, yl, Y) => footPoint(xl, yl, Y);
    const seg3 = (a, b, r) => { const p0 = P3(a[0], a[1], a[2]), p1 = P3(b[0], b[1], b[2]); return tubeAlong(THREE, [p0, p1], r, 6); };
    add("ankle-bones", [sphereGeo(THREE, ...(P3(0, 4, 14)), 11, 9, 14, 12), sphereGeo(THREE, ...(P3(0, -10, 8)), 8, 7, 8, 10)], true);
    const mtX = [[-9, -11], [-1, -0.8], [6, 6.4], [12, 12.4], [18, 18.6]];
    add("foot-bones", mtX.map((m, i) => seg3([m[0], 18, 9], [m[1], 44, 4 + i * 0], 2.1)), true);
    const tb = [];
    FOOT.order.forEach(k => { const st = FOOT.toes[k].st, n = k === "big-toe" ? 2 : 3; for (let i = 0; i < n; i++) { const a = i / n + 0.03, b = (i + 1) / n - 0.03; const f = t => [lerp(st[0][0], st[2][0], t), lerp(st[0][1] + 2, st[2][1], t), 4.5]; tb.push(seg3(f(a), f(b), 1.7)); } });
    add("toe-bones", tb, true);
    // joints (translucent pick spheres)
    const J = (key, cx, cy, rx, ry, z) => add(key, [sphereGeo(THREE, cx - 150, GROUND - cy, z || 0, rx, ry, (rx + ry) / 2 + 1, 14)], true, true);
    J("shoulder-joint", 210, 146, 12, 11); J("elbow-joint", 234, 250, 12, 9); J("wrist-joint", 254, 337, 10.5, 7);
    J("hip-joint", 189, 314, 12, 12, -2); J("knee-joint", 173, 441, 16, 15); J("ankle-joint", 171, 584, 12, 8, -2);
    return out;
  }

  /* ---- face: eyes with lids, brows, nose, lips ---- */
  function irisTexture() {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = 512; c.height = 256;
    const x = c.getContext("2d"); if (!x) return null;
    const g0 = x.createLinearGradient(0, 0, 0, 256); g0.addColorStop(0, "#efe7de"); g0.addColorStop(0.5, "#f6f1ea"); g0.addColorStop(1, "#e9dfd5");
    x.fillStyle = g0; x.fillRect(0, 0, 512, 256);
    const cx = 128, cy = 128;
    // iris: warm brown with radial streaks, darker limbal ring, bright inner ring around the pupil
    const ir = x.createRadialGradient(cx, cy, 8, cx, cy, 36);
    ir.addColorStop(0, "#2a160a"); ir.addColorStop(0.28, "#8a5a2c"); ir.addColorStop(0.62, "#6a3f1c"); ir.addColorStop(0.9, "#3e2410"); ir.addColorStop(1, "#1c0f07");
    x.fillStyle = ir; x.beginPath(); x.arc(cx, cy, 36, 0, 6.3); x.fill();
    x.strokeStyle = "rgba(190,130,70,.35)"; x.lineWidth = 1;
    for (let a = 0; a < 6.28; a += 0.12) { x.beginPath(); x.moveTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12); x.lineTo(cx + Math.cos(a + 0.05) * 33, cy + Math.sin(a + 0.05) * 33); x.stroke(); }
    x.fillStyle = "#060302"; x.beginPath(); x.arc(cx, cy, 13, 0, 6.3); x.fill();
    x.fillStyle = "rgba(255,255,255,.92)"; x.beginPath(); x.arc(cx + 13, cy - 13, 6, 0, 6.3); x.fill();
    x.fillStyle = "rgba(255,255,255,.35)"; x.beginPath(); x.arc(cx - 12, cy + 14, 4, 0, 6.3); x.fill();
    return c;
  }

  function buildFace(THREE, Pf, ext, root, pick, meshes, prep) {
    const F = Pf.F, skin = ext.skin, hairC = ext.hair, PI = Math.PI, sz = ext.surfaceAt;
    const lipC = (c => [c.r, c.g, c.b])(new THREE.Color(ext.K.lip)), shadeC = (c => [c.r, c.g, c.b])(new THREE.Color(ext.K.shade));
    const mkProp = (geom, color, region, rough, tex, clr) => {
      prep(geom); const mat = new THREE.MeshPhysicalMaterial({ color, roughness: rough == null ? 0.5 : rough, map: tex || null, clearcoat: clr || 0, clearcoatRoughness: 0.12 });
      const mesh = new THREE.Mesh(geom, mat); mesh.castShadow = true; mesh.userData = { kind: "prop", region, baseColor: new THREE.Color(color) };
      root.add(mesh); if (region) pick.push(mesh); meshes.push(mesh); return mesh;
    };
    const rgb = (a, m) => new THREE.Color(Math.min(1, a[0] * (m || 1)), Math.min(1, a[1] * (m || 1)), Math.min(1, a[2] * (m || 1)));
    const ic = irisTexture(), itex = ic ? new THREE.CanvasTexture(ic) : null; if (itex && THREE.SRGBColorSpace) itex.colorSpace = THREE.SRGBColorSpace;
    const eyeX = F ? 9.5 : 10.0, eyeY = 58.4, R = F ? 4.5 : 4.35, ez = sz(eyeX, eyeY) - 1.5;
    const tubeArc = (pts, r) => tubeAlong(THREE, pts, r, 6);
    const onSphere = (s, ph, el, rr) => [s * eyeX + s * Math.sin(ph) * Math.cos(el) * rr, GROUND - eyeY + Math.sin(el) * rr, ez + Math.cos(ph) * Math.cos(el) * rr];
    [-1, 1].forEach(s => {
      const side = s > 0 ? "left" : "right", cy = GROUND - eyeY;
      const eg = new THREE.SphereGeometry(R, 36, 24); eg.translate(s * eyeX, cy, ez);
      mkProp(eg, 0xffffff, `${side}-eye`, 0.18, itex, 0.7);
      const lid = (alpha, half, r) => { const lg = new THREE.SphereGeometry(r, 26, 12, 0, 2 * PI, 0, half); lg.rotateX(alpha); lg.translate(s * eyeX, cy, ez); return lg; };
      const upper = mkProp(weld(THREE, lid(0.69, 0.66, R + 0.28)), rgb(skin), `${side}-eye`, 0.55);
      const lower = mkProp(weld(THREE, lid(2.40, 0.36, R + 0.28)), rgb(skin, 0.98), `${side}-eye`, 0.55);
      [upper, lower].forEach(m => { m.material.side = THREE.DoubleSide; });
      // lash line, lid crease and tear duct
      const lash = [], crease = [];
      for (let k = 0; k <= 14; k++) { const ph = (-64 + k * 9.2) * PI / 180; lash.push(onSphere(s, ph, 12 * PI / 180, R + 0.3)); crease.push(onSphere(s, ph * 0.9, 42 * PI / 180, R + 0.4)); }
      mkProp(tubeArc(lash, F ? 0.42 : 0.3), 0x1a0e09, null, 0.6);
      mkProp(tubeArc(crease, 0.26), rgb(skin, 0.80), null, 0.6);
      if (F) { // soft lower lashes
        const ll = []; for (let k = 0; k <= 10; k++) ll.push(onSphere(s, (-46 + k * 9.2) * PI / 180, -21 * PI / 180, R + 0.3)); mkProp(tubeArc(ll, 0.1), 0x6a4636, null, 0.6);
      }
      mkProp(sphereGeo(THREE, ...onSphere(s, -1.02, -0.02, R - 0.1), 0.9, 0.7, 0.8, 8), rgb([skin[0] * 1.02, skin[1] * 0.78, skin[2] * 0.8]), null, 0.5);
      // brow: tapered, shaped
      const bp = [], bn = 12;
      for (let i = 0; i <= bn; i++) {
        const t = i / bn, x = 3.4 + t * (F ? 18.5 : 18), arch = Math.sin(Math.min(1, t * 1.1) * PI * 0.92);
        const y = F ? 51.0 - arch * 2.7 + t * 2.0 : 52.0 - arch * 1.0 + t * 0.9;
        bp.push([s * x, GROUND - y, sz(x, y) + 0.5]);
      }
      const brows = ringsAlong(bp, (i) => { const t = i / bn, th = F ? 1.05 * (1 - 0.72 * t * t) : 1.45 * (1 - 0.5 * t * t * t); return [Math.max(0.28, th), Math.max(0.3, th * 0.75), 0.5]; }, [0, 0, 1], null, 2);
      const brow = mkProp(loft(THREE, brows, 8, { capTop: true, capBottom: true }), rgb(hairC, 0.92), null, 0.65);
    });
    // nose: narrow bridge, refined tip and soft alae
    const prof = F ? [[55, 2.5, 0.8], [60, 2.8, 2.3], [65, 3.1, 4.2], [69, 3.4, 5.6], [72.5, 4.2, 6.7], [75, 4.5, 5.9], [76.8, 3.1, 2.8]]
                   : [[55, 2.8, 0.8], [60, 3.1, 2.6], [65, 3.4, 4.9], [69, 3.7, 6.4], [73, 4.7, 7.4], [75.4, 4.5, 6.0], [77.2, 3.1, 2.9]];
    const dn = catmullDense(prof, 4), nr = dn.map(q => ({ c: [0, GROUND - q[0], sz(0, q[0]) - 2], u: [1, 0, 0], v: [0, 0, 1], r1: q[1], r2f: q[2] + 2, r2b: 2, n: 2.2 }));
    const aY = F ? 74 : 74.6, aX = F ? 3.9 : 4.5;
    const noseG = [loft(THREE, nr, 22, { capBottom: true }), sphereGeo(THREE, aX, GROUND - aY, sz(aX, aY) + 0.9, 2.1, 2.1, 2.2, 10), sphereGeo(THREE, -aX, GROUND - aY, sz(aX, aY) + 0.9, 2.1, 2.1, 2.2, 10)];
    const nose = mkProp(mergeGeos(THREE, noseG), rgb(skin), "nose", 0.55); nose.material.color.setRGB(skin[0] * 1.03, skin[1] * 0.97, skin[2] * 0.97); nose.userData.baseColor = nose.material.color.clone();
    [-1, 1].forEach(s => mkProp(sphereGeo(THREE, s * 2.3, GROUND - 75.9, sz(2.3, 75.5) + 3.0, 1.35, 0.7, 1.2, 8), 0x2b1510, null, 0.8));
    // lips: cupid's bow, fuller lower lip, gentle smile
    const pf = F ? 1.2 : 0.96, yMouth = 86.2;
    const lipRings = (yc, rv, rz, bow) => {
      const pts = [], rad = [];
      for (let i = 0; i <= 22; i++) {
        const x = -8.4 + i * 16.8 / 22, a = Math.abs(x) / 8.4, y = yc - 1.5 * a * a * a - (bow ? 0 : -0.15 * a * a) - (bow ? 0.5 * Math.exp(-Math.pow(x / 1.1, 2)) : 0);
        pts.push([x, GROUND - y, sz(Math.abs(x), y) + 0.35]);
        let k = Math.sqrt(Math.max(0.02, 1 - a * a * 0.9));
        if (bow) k *= 0.8 + 0.3 * Math.exp(-Math.pow((Math.abs(x) - 2.4) / 1.5, 2)) - 0.25 * Math.exp(-Math.pow(x / 0.9, 2)); else k *= 1 + 0.12 * Math.exp(-Math.pow(x / 3, 2));
        rad.push(k);
      }
      return ringsAlong(pts, (i) => [rv * rad[i], rz * rad[i] + 0.4, 1], [0, 0, 1], null, 2);
    };
    mkProp(loft(THREE, lipRings(yMouth - 1.3, 1.4 * pf, 1.7 * pf, true), 16, { capTop: true, capBottom: true }), rgb(lipC, F ? 1.02 : 0.96), "mouth", 0.34, null, 0.55);
    mkProp(loft(THREE, lipRings(yMouth + 2.1, 1.95 * pf, 2.2 * pf, false), 16, { capTop: true, capBottom: true }), rgb(lipC, F ? 1.08 : 1.0), "mouth", 0.3, null, 0.6);
    const seam = []; for (let i = 0; i <= 16; i++) { const x = -8.1 + i * 16.2 / 16, a = Math.abs(x) / 8.4, y = yMouth + 0.25 - 1.5 * a * a * a; seam.push([x, GROUND - y, sz(Math.abs(x), y) + 1.2]); }
    mkProp(tubeArc(seam, 0.3), shadeC.length ? new THREE.Color(shadeC[0] * 0.45, shadeC[1] * 0.3, shadeC[2] * 0.3) : 0x3a1612, null, 0.7);
  }

  /* ====================================================================
   * 13. SCENE ASSEMBLY  (labels every vertex with a region id)
   * ==================================================================== */
  function build3D(THREE, o) {
    const sex = o.sex === "male" ? "male" : "female", mode = LAYERS.includes(o.mode) ? o.mode : "external", skinName = SKIN[o.skin] ? o.skin : "medium";
    const K = SKIN[skinName];
    const names = [""], nidx = { "": 0 };
    const nid = id => (id in nidx ? nidx[id] : (nidx[id] = names.push(id) - 1));
    const root = new THREE.Group(), pick = [], regionVerts = new Map(), meshes = [];
    const mapF = getMapper(sex, "front"), mapB = getMapper(sex, "back");
    const near = (map, x, y) => { let r = map.lookup(x, y); if (r) return r; for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [3, 0], [-3, 0], [0, 3], [0, -3]]) { r = map.lookup(x + dx, y + dy); if (r) return r; } return ""; };
    const track = (mesh, labels) => {
      const per = new Map();
      for (let i = 0; i < labels.length; i++) { const id = names[labels[i]]; if (!id) continue; if (!per.has(id)) per.set(id, []); per.get(id).push(i); }
      per.forEach((idx, id) => { if (!regionVerts.has(id)) regionVerts.set(id, []); regionVerts.get(id).push({ mesh, idx }); });
    };
    let bump = null;
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"), im = x && x.createImageData(256, 256);
      if (x) {
      for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 70; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
      x.putImageData(im, 0, 0); bump = new THREE.CanvasTexture(c); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; }
    }
    let hairBump = null;
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas"); c.width = 256; c.height = 256; const x = c.getContext("2d");
      if (x) { x.fillStyle = "#808080"; x.fillRect(0, 0, 256, 256); for (let i = 0; i < 700; i++) { const px = Math.random() * 256, v = 90 + Math.random() * 90; x.strokeStyle = `rgb(${v},${v},${v})`; x.lineWidth = 0.6 + Math.random() * 1.4; x.beginPath(); x.moveTo(px, 0); x.lineTo(px + (Math.random() - 0.5) * 6, 256); x.stroke(); }
        hairBump = new THREE.CanvasTexture(c); hairBump.wrapS = hairBump.wrapT = THREE.RepeatWrapping; }
    }
    const prep = g => {
      g.computeVertexNormals();
      const p = g.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i)) * 0.03; uv[i * 2 + 1] = p.getY(i) * 0.03; }
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); return g;
    };
    const meta = { names, K, sex, mode };

    if (mode === "external") {
      const ext = buildExternal(THREE, sex, skinName), Pf = ext.Pf, F = Pf.F;
      const skinMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.52, metalness: 0, sheen: 0.7, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffc9a8), clearcoat: 0.05, bumpMap: bump, bumpScale: 0.16, envMapIntensity: 0.55 });
      const fabMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
      const hairMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.04, bumpMap: hairBump, bumpScale: 0.9, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x9a7a5a) });
      const tint = (id, X, Y, Z, it) => {
        const n1 = vnoise(X * 0.07 + 3, Y * 0.07, Z * 0.07), n2 = vnoise(X * 0.35, Y * 0.35 + 9, Z * 0.35);
        if (it.hair) { const st = 0.72 + 0.55 * vnoise(X * 0.55, Y * 0.07, Z * 0.55); return [st, st, st]; }
        if (it.fabric) { const f = 1 + (n2 - 0.5) * 0.08; return [f, f, f]; }
        let m = 1 + (n1 - 0.5) * 0.07 + (n2 - 0.5) * 0.035, r = 1, g = 1, b = 1;
        if (/cheek|nose|ear|mouth/.test(id)) { r *= 1.07; g *= 0.95; b *= 0.95; }
        if (/knee|elbow|finger|thumb|toe|heel|palm/.test(id)) { r *= 1.04; g *= 0.95; b *= 0.94; }
        if (/shin|ankle|foot|calf|achilles/.test(id)) m *= 0.97;
        if (/chest|sternum|neck|throat|shoulder|breast/.test(id)) { r *= 1.03; b *= 1.02; }
        if (/eye/.test(id)) { r *= 0.96; g *= 0.93; b *= 0.93; }
        return [m * r, m * g, m * b];
      };
      ext.items.forEach(it => {
        const list = it.mirror ? [it.geom, mirrorGeo(it.geom)] : [it.geom];
        list.forEach(g => {
          prep(g);
          const p = g.attributes.position, fr = g.attributes.front, n = p.count, labels = new Uint16Array(n), col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), f = fr ? fr.getX(i) : 1, side = sideOfX(X);
            let id;
            if (it.foot) id = `${side}-${it.foot.key || it.foot.labels[i]}`;
            else if (it.fixedKey) { const k = it.fixedKey === "palm|back-of-hand" ? (Z >= 0 ? "palm" : "back-of-hand") : it.fixedKey; id = `${side}-${k}`; }
            else id = near(f ? mapF : mapB, f ? X + 150 : 150 - X, GROUND - Y);
            labels[i] = nid(id);
            const tt = tint(id, X, Y, Z, it);
            col[i * 3] = it.base[0] * tt[0]; col[i * 3 + 1] = it.base[1] * tt[1]; col[i * 3 + 2] = it.base[2] * tt[2];
          }
          g.setAttribute("color", new THREE.BufferAttribute(col, 3));
          if (it.hair) { const uvh = g.attributes.uv; for (let i = 0; i < n; i++) uvh.setXY(i, (p.getX(i) + p.getZ(i)) * 0.23, p.getY(i) * 0.012); uvh.needsUpdate = true; }
          const mesh = new THREE.Mesh(g, it.fabric ? fabMat : it.hair ? hairMat : skinMat);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData = { kind: "skin", labels, baseArr: col.slice() };
          root.add(mesh); pick.push(mesh); meshes.push(mesh); track(mesh, labels);
        });
      });
      if (FIGURE.face) buildFace(THREE, Pf, ext, root, pick, meshes, prep);
    } else {
      // ghost body so the organs / bones sit "inside" a person
      const ext = buildExternal(THREE, sex, skinName);
      const ghost = new THREE.MeshStandardMaterial({ color: new THREE.Color(K.base), transparent: true, opacity: 0.13, depthWrite: false, roughness: 0.9, side: THREE.DoubleSide });
      ext.items.filter(it => !it.fabric && !it.hair).forEach(it => {
        (it.mirror ? [it.geom, mirrorGeo(it.geom)] : [it.geom]).forEach(g => { g.computeVertexNormals(); const m = new THREE.Mesh(g, ghost); m.renderOrder = 5; m.userData = { kind: "ghost" }; root.add(m); });
      });
      const Pf = ext.Pf;
      const mkMat = (hex, rough, clear, opacity) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness: rough, clearcoat: clear, clearcoatRoughness: 0.35, transparent: opacity != null && opacity < 1, opacity: opacity == null ? 1 : opacity });
      if (mode === "internal") {
        buildOrgans(THREE, sex, Pf).forEach(o => {
          const merged = prep(mergeGeos(THREE, o.geoms.map(g => { if (!g.index) { g = weld(THREE, g); } return g; })));
          const mesh = new THREE.Mesh(merged, mkMat(o.tone[0], 0.45, 0.5, o.tone[2]));
          mesh.userData = { kind: "organ", region: o.id, baseColor: new THREE.Color(o.tone[0]) };
          root.add(mesh); pick.push(mesh); meshes.push(mesh);
        });
      } else {
        buildBones(THREE, sex, Pf).forEach(b => {
          const sidesList = b.pair ? ["left", "right"] : [""];
          sidesList.forEach(sd => {
            const geoms = b.geoms.map(g => { g = g.index ? g : weld(THREE, g); return sd === "right" ? mirrorGeo(g) : g; });
            const merged = prep(mergeGeos(THREE, geoms.map(g => { const c = g.clone(); if (!c.attributes.front) c.setAttribute("front", new THREE.BufferAttribute(new Uint8Array(c.attributes.position.count).fill(1), 1)); return c; })));
            const id = b.pair ? `${sd}-${b.key}` : b.key;
            const mat = b.joint ? new THREE.MeshStandardMaterial({ color: 0x6aa7da, transparent: true, opacity: 0.28, roughness: 0.4, depthWrite: false }) : mkMat("#efe5cc", 0.62, 0.15);
            const mesh = new THREE.Mesh(merged, mat);
            mesh.userData = { kind: b.joint ? "joint" : "bone", region: id, baseColor: mat.color.clone(), baseOpacity: mat.opacity };
            if (b.joint) mesh.renderOrder = 6;
            root.add(mesh); pick.push(mesh); meshes.push(mesh);
          });
        });
      }
    }
    const sc = sex === "female" ? 0.95 : 1; root.scale.setScalar(sc); meta.scale = sc;
    return { group: root, pick, regionVerts, names, meshes, meta };
  }

  // Select the label belonging to the vertex with the greatest barycentric
  // weight at the actual ray hit. Kept pure so boundary behavior is regression-tested.
  function dominantTriangleLabel(labels, weights) {
    let best = 0;
    for (let i = 1; i < 3; i++) if (weights[i] > weights[best]) best = i;
    return labels[best] || 0;
  }

  /* ====================================================================
   * 14. 3D VIEWER  (rotate 360°, zoom, pan, pick regions)
   * ==================================================================== */
  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
  let threePromise = null;
  function loadThree(url) {
    if (!threePromise || url) threePromise = import(/* webpackIgnore: true */ url || THREE_URL);
    return threePromise;
  }

  // Hosts can supply their own three.js build: CareAnatomy.useThree(THREE)
  function useThree(T) { threePromise = Promise.resolve(T); }

  const PRESETS = {
    front: { az: 0, el: 0.06, dist: 1380, t: [0, 312, 0] },
    back: { az: Math.PI, el: 0.06, dist: 1380, t: [0, 312, 0] },
    left: { az: Math.PI / 2, el: 0.06, dist: 1380, t: [0, 312, 0] },
    right: { az: -Math.PI / 2, el: 0.06, dist: 1380, t: [0, 312, 0] },
    head: { az: 0, el: 0.04, dist: 250, t: [0, 556, 6] },
    hands: { az: 0, el: 0.2, dist: 620, t: [0, 292, 10] },
    feet: { az: 0.35, el: 0.5, dist: 520, t: [0, 24, 20] }
  };

  function createViewer(THREE, cb) {
    cb = cb || {};
    const reserve = { top: 12, bottom: 22 };
    const dom = document.createElement("div");
    dom.className = "viewer3d";
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    if (renderer.shadowMap) { renderer.shadowMap.enabled = true; if (THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    const canvas = renderer.domElement;
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;cursor:grab;-webkit-tap-highlight-color:transparent";
    canvas.setAttribute("aria-hidden", "true");
    dom.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 5, 8000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xaab6c8, 1.0));
    const key = new THREE.DirectionalLight(0xfff0de, 2.2); key.position.set(90, 1500, 700); key.target.position.set(0, 300, 0); scene.add(key, key.target);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.normalBias = 1.4;
    Object.assign(key.shadow.camera, { left: -430, right: 430, top: 520, bottom: -140, near: 200, far: 2600 });
    try {   // soft studio environment for natural skin / eye reflections
      const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
      const sg = new THREE.SphereGeometry(1500, 32, 16), cols = [], pa = sg.attributes.position;
      for (let i = 0; i < pa.count; i++) { const h = pa.getY(i) / 1500, c = new THREE.Color().setRGB(0.55, 0.6, 0.68).lerp(new THREE.Color(1, 1, 1), clamp(h * 0.5 + 0.55, 0, 1)); cols.push(c.r, c.g, c.b); }
      sg.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      es.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      [[0, 900, 600, 900, 500], [-1000, 300, 300, 300, 600], [900, 400, -300, 400, 500]].forEach(([x, y, z, w, h]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.9, 3.7), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 300, 0); es.add(m); });
      scene.environment = pm.fromScene(es, 0.04).texture; pm.dispose();
    } catch (e) { /* environment is optional */ }
    const fill = new THREE.DirectionalLight(0xdbe7ff, 0.8); fill.position.set(-600, 300, 500); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.0); rim.position.set(0, 420, -900); scene.add(rim);
    const floorItems = [];
    // floor + contact shadow
    try {
      const fc = document.createElement("canvas"); fc.width = fc.height = 256; const fx = fc.getContext("2d");
      if (fx) {
        const g = fx.createRadialGradient(128, 128, 8, 128, 128, 126);
        g.addColorStop(0, "rgba(40,60,90,.38)"); g.addColorStop(0.45, "rgba(40,60,90,.14)"); g.addColorStop(1, "rgba(40,60,90,0)");
        fx.fillStyle = g; fx.fillRect(0, 0, 256, 256);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(230, 64), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, depthWrite: false }));
        floor.rotation.x = -Math.PI / 2; floor.position.y = 0.4; scene.add(floor); floorItems.push(floor);
      }
    } catch (e) { /* optional */ }
    const ring = new THREE.Mesh(new THREE.RingGeometry(150, 152, 96), new THREE.MeshBasicMaterial({ color: 0x8fb0d0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.6; scene.add(ring); floorItems.push(ring);

    const S = { az: 0, el: 0.06, dist: 1380, t: new THREE.Vector3(0, 312, 0) };
    let pendId = null, userMoved = false, model = null, dirty = true, anim = null, auto = false, running = true, last = 0, hoverId = null, hoverReq = null, presetName = "front", moved = false;
    const state = { sel: new Set(), grp: new Set() };
    const painted = new Map();           // id -> state code
    const ACC = new THREE.Color(0x0d9a86), HOV = new THREE.Color(0x5fd8c4);
    const rc = new THREE.Raycaster();

    function place() {
      // Free orbit: yaw (az) and pitch (el) are unbounded, so the body can be turned 360 degrees in both directions.
      camera.quaternion.setFromEuler(new THREE.Euler(-S.el, S.az, 0, "YXZ"));
      camera.position.set(0, 0, S.dist).applyQuaternion(camera.quaternion).add(S.t);
      const up = Math.cos(S.el) > 0.3; floorItems.forEach(f => { f.visible = up; });
    }
    function resize() {
      const w = Math.max(1, dom.clientWidth), h = Math.max(1, dom.clientHeight);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
      if (!userMoved && FULL.includes(presetName)) goTo(presetName, false);
    }
    let ro = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(resize); ro.observe(dom); }

    function viewName() {
      if (presetName === "head" || presetName === "hands" || presetName === "feet") return presetName;
      if (Math.cos(S.el) < 0.5) return "custom";
      let a = ((S.az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (a < Math.PI / 4 || a >= 7 * Math.PI / 4) return "front";
      if (a < 3 * Math.PI / 4) return "left";
      if (a < 5 * Math.PI / 4) return "back";
      return "right";
    }
    let lastReported = "";
    const report = () => { const n = viewName(); if (n !== lastReported) { lastReported = n; cb.onView && cb.onView(n, S.az); } };

    const FULL = ["front", "back", "left", "right"];
    function fitFull(p0, sc) {       // frame the whole body inside the free area of the viewport
      const h = Math.max(200, dom.clientHeight || 600), avail = Math.max(120, h - reserve.top - reserve.bottom);
      const bodyH = 612 * sc * 1.05, w = Math.max(120, dom.clientWidth || 360);
      let visible = h / (avail / bodyH);                      // world units visible vertically
      const needV = (300 * sc) / (w / h);                     // units needed vertically so a 300-wide body fits the width
      if (visible < needV) visible = needV;
      const ppu = h / visible, fov = camera.fov * Math.PI / 180;
      const dist = (visible / 2) / Math.tan(fov / 2);
      const yc = reserve.top + avail / 2, off = (yc - h / 2) / ppu;     // body centre sits this many units below screen centre
      return { ...p0, dist, t: [0, 306 * sc + off, 0] };
    }
    function goTo(name, animate) {
      const p0 = PRESETS[name]; if (!p0) return;
      const sc = (model && model.meta && model.meta.scale) || 1, p1 = FULL.includes(name) ? fitFull(p0, sc) : p0, p = { ...p1, t: FULL.includes(name) ? p1.t : [p1.t[0] * sc, p1.t[1] * sc, p1.t[2] * sc], dist: FULL.includes(name) ? p1.dist : p1.dist * sc };
      presetName = name; userMoved = false;
      let az = p.az; const cur = S.az; az += Math.round((cur - az) / (2 * Math.PI)) * 2 * Math.PI;   // shortest turn
      const el = p.el + Math.round((S.el - p.el) / (2 * Math.PI)) * 2 * Math.PI;
      const to = { az, el, dist: p.dist, t: new THREE.Vector3(...p.t) };
      if (animate === false) { S.az = to.az; S.el = to.el; S.dist = to.dist; S.t.copy(to.t); dirty = true; report(); return; }
      anim = { t0: performance.now(), dur: 650, from: { az: S.az, el: S.el, dist: S.dist, t: S.t.clone() }, to };
    }
    function zoom(f) { S.dist = clamp(S.dist * f, 90, 2600); dirty = true; }
    function setAuto(v) { auto = !!v; dirty = true; }

    /* --- picking --- */
    function regionAt(clientX, clientY) {
      if (!model) return null;
      const r = canvas.getBoundingClientRect();
      rc.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = rc.intersectObjects(model.pick, false)[0];
      if (!hit) return null;
      const ud = hit.object.userData;
      if (ud.kind === "skin") {
        const g = hit.object.geometry, f = hit.face, ids = [f.a, f.b, f.c];
        // Resolve the tapped triangle as a surface patch, not by whichever vertex
        // happens to be microscopically closest to the ray. Nearest-vertex picking
        // caused region-name flicker along boundaries and on differently tessellated models.
        const labs = ids.map(i => ud.labels[i]);
        // Always resolve the actual tap position within the triangle. A previous
        // majority shortcut returned the repeated vertex label even when the user
        // tapped directly beside the third vertex, producing visibly wrong names.
        const p = hit.object.worldToLocal(hit.point.clone());
        const a = new THREE.Vector3().fromBufferAttribute(g.attributes.position, ids[0]);
        const b = new THREE.Vector3().fromBufferAttribute(g.attributes.position, ids[1]);
        const c = new THREE.Vector3().fromBufferAttribute(g.attributes.position, ids[2]);
        const bary = THREE.Triangle.getBarycoord(p, a, b, c, new THREE.Vector3());
        const direct = model.meta && model.meta.regionAtPoint ? model.meta.regionAtPoint(p.x, p.y, p.z) : null;
        if (direct && model.regionVerts.has(direct)) return direct;
        const label = dominantTriangleLabel(labs, [bary.x, bary.y, bary.z]);
        return model.names[label] || null;
      }
      return ud.region || null;
    }

    /* --- highlighting --- */
    function codeFor(id) { return id === hoverId && !state.sel.has(id) ? (state.sel.has(id) ? 2 : 1) : state.sel.has(id) ? 2 : state.grp.has(id) ? 3 : (id === hoverId ? 1 : 0); }
    const tmp = new THREE.Color();
    const adjOf = mesh => {
      if (mesh.userData.adj) return mesh.userData.adj;
      const ix = mesh.geometry.index.array, n = mesh.geometry.attributes.position.count, adj = new Array(n);
      for (let i = 0; i < ix.length; i += 3) for (let k = 0; k < 3; k++) { const a = ix[i + k], b = ix[i + (k + 1) % 3]; (adj[a] || (adj[a] = [])).push(b); (adj[b] || (adj[b] = [])).push(a); }
      return (mesh.userData.adj = adj);
    };
    const tintOf = code => (code === 1 || code === 4 ? HOV : ACC), wOf = code => (code === 2 ? 0.74 : code === 4 ? 0.66 : code === 3 ? 0.4 : code === 1 ? 0.5 : 0);
    function resetMesh(m) { const attr = m.geometry.attributes.color; attr.array.set(m.userData.baseArr); attr.needsUpdate = true; }
    function paintSkin(id, code, pass) {
      const ents = model.regionVerts.get(id); if (!ents) return;
      const tint = tintOf(code), w = wOf(code);
      ents.forEach(({ mesh, idx }) => {
        const attr = mesh.geometry.attributes.color, b = mesh.userData.baseArr, labels = mesh.userData.labels, myLabel = labels[idx[0]];
        if (pass === 1) {          // soft halo around the region
          const adj = adjOf(mesh), rw = w * 0.42;
          for (let k = 0; k < idx.length; k++) { const nb = adj[idx[k]]; if (!nb) continue; for (let q = 0; q < nb.length; q++) { const j = nb[q]; if (labels[j] === myLabel) continue; const o = j * 3; attr.setXYZ(j, lerp(b[o], tint.r, rw), lerp(b[o + 1], tint.g, rw), lerp(b[o + 2], tint.b, rw)); } }
        } else {
          for (let k = 0; k < idx.length; k++) { const i = idx[k], o = i * 3; attr.setXYZ(i, lerp(b[o], tint.r, w), lerp(b[o + 1], tint.g, w), lerp(b[o + 2], tint.b, w)); }
        }
        attr.needsUpdate = true;
      });
    }
    function paintProp(id, code) {
      const props = model.propMap.get(id); if (!props) return;
      const tint = tintOf(code), w = wOf(code);
      props.forEach(m => {
        const bc = m.userData.baseColor, mat = m.material;
        if (!w) { mat.color.copy(bc); if (mat.emissive) mat.emissive.setRGB(0, 0, 0); if (m.userData.baseOpacity != null) mat.opacity = m.userData.baseOpacity; }
        else { tmp.copy(bc).lerp(tint, w); mat.color.copy(tmp); if (mat.emissive) mat.emissive.copy(tint).multiplyScalar(0.16 * w); if (m.userData.kind === "joint") mat.opacity = 0.62; }
      });
    }
    function applyState() {
      if (!model) return;
      const want = new Map();
      state.grp.forEach(id => want.set(id, 3));
      state.sel.forEach(id => want.set(id, 2));
      if (hoverId && !state.sel.has(hoverId)) want.set(hoverId, 1);
      if (pendId && !state.sel.has(pendId)) want.set(pendId, 4);
      const skinDirty = new Set();
      painted.forEach((c, id) => { const e = model.regionVerts.get(id); if (e) e.forEach(x => skinDirty.add(x.mesh)); if (!want.has(id)) paintProp(id, 0); });
      want.forEach((c, id) => { const e = model.regionVerts.get(id); if (e) e.forEach(x => skinDirty.add(x.mesh)); });
      skinDirty.forEach(resetMesh);
      want.forEach((c, id) => paintSkin(id, c, 1));
      want.forEach((c, id) => { paintSkin(id, c, 2); paintProp(id, c); });
      painted.clear(); want.forEach((c, id) => painted.set(id, c));
      dirty = true;
    }

    async function setModel(opts) {
      cb.onLoading && cb.onLoading(true);
      await new Promise(r => setTimeout(r, 30));
      const built = opts.glb ? await buildGLB(THREE, opts.glb, opts) : build3D(THREE, opts);
      if (model) {
        scene.remove(model.group);
        model.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      }
      built.propMap = new Map();
      built.meshes.forEach(m => { const id = m.userData.region; if (id) { if (!built.propMap.has(id)) built.propMap.set(id, []); built.propMap.get(id).push(m); } });
      model = built; scene.add(model.group); painted.clear(); applyState(); dirty = true;
      cb.onLoading && cb.onLoading(false);
    }

    /* --- input --- */
    const ptrs = new Map(); let down = null, pinch = 0;
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    canvas.addEventListener("pointerdown", e => {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, btn: e.button, shift: e.shiftKey, touch: e.pointerType !== "mouse" };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); down && (down.moved = 99); }
      anim = null; userMoved = true; canvas.style.cursor = "grabbing"; cb.onInteract && cb.onInteract();
    });
    canvas.addEventListener("pointermove", e => {
      const p = ptrs.get(e.pointerId);
      if (!p) {
        if (e.pointerType === "mouse" && !hoverReq) hoverReq = requestAnimationFrame(() => {
          hoverReq = null; const id = regionAt(e.clientX, e.clientY);
          if (id !== hoverId) { hoverId = id; applyState(); canvas.style.cursor = id ? "pointer" : "grab"; cb.onHover && cb.onHover(id); }
        });
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 1) {
        down.moved += Math.abs(dx) + Math.abs(dy);
        if (down.moved > 4) {
          if (presetName === "head" || presetName === "hands" || presetName === "feet") presetName = "custom";
          if (down.btn === 2 || down.shift) pan(dx, dy);
          else { S.az -= dx * 0.0075 * (Math.cos(S.el) >= 0 ? 1 : -1); S.el += dy * 0.0065; }
          dirty = true;
        }
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) S.dist = clamp(S.dist * pinch / d, 90, 2600);
        pinch = d; pan(dx / 2, dy / 2); dirty = true;
      }
    });
    function pan(dx, dy) {
      const r = new THREE.Vector3(), u = new THREE.Vector3();
      camera.updateMatrixWorld(); r.setFromMatrixColumn(camera.matrixWorld, 0); u.setFromMatrixColumn(camera.matrixWorld, 1);
      const k = S.dist * 0.0011;
      S.t.addScaledVector(r, -dx * k).addScaledVector(u, dy * k);
      S.t.y = clamp(S.t.y, -50, 700); S.t.x = clamp(S.t.x, -300, 300); S.t.z = clamp(S.t.z, -300, 300);
    }
    const end = e => {
      const had = ptrs.delete(e.pointerId); canvas.style.cursor = "grab";
      if (!had) return;
      if (ptrs.size === 0 && down && e.type === "pointerup" && down.moved < (down.touch ? 14 : 6) && performance.now() - down.t < 800 && down.btn === 0) {
        const id = regionAt(e.clientX, e.clientY); if (id && cb.onPick) cb.onPick(id, e.clientX, e.clientY);
      }
      if (ptrs.size === 0) { down = null; pinch = 0; report(); }
    };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { if (hoverId) { hoverId = null; applyState(); cb.onHover && cb.onHover(null); } });
    canvas.addEventListener("wheel", e => { e.preventDefault(); cb.onInteract && cb.onInteract(); S.dist = clamp(S.dist * Math.exp(e.deltaY * 0.0030), 90, 2600); dirty = true; }, { passive: false });

    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      const dt = Math.min(0.25, (now - (last || now)) / 1000); last = now;
      if (anim) {
        const k = smooth((now - anim.t0) / anim.dur);
        S.az = lerp(anim.from.az, anim.to.az, k); S.el = lerp(anim.from.el, anim.to.el, k);
        S.dist = lerp(anim.from.dist, anim.to.dist, k); S.t.lerpVectors(anim.from.t, anim.to.t, k);
        dirty = true; if (k >= 1) { anim = null; report(); }
      }
      if (auto && !down) { S.az += dt * 0.6; presetName = presetName === "head" || presetName === "hands" || presetName === "feet" ? "custom" : presetName; dirty = true; report(); }
      if (dirty) { place(); renderer.render(scene, camera); dirty = false; cb.onTurn && cb.onTurn(S.az, S.el); }
    }
    requestAnimationFrame(frame);
    resize();
    return {
      dom, setModel, goTo, zoom, setAuto, resize, scene,
      setReserve(t, b) { reserve.top = t; reserve.bottom = b; if (!userMoved && FULL.includes(presetName)) goTo(presetName, false); dirty = true; },
      get auto() { return auto; },
      get view() { return viewName(); },
      get elevationDeg() { return Math.round(((S.el * 180 / Math.PI) % 360 + 360) % 360); },
      get azimuthDeg() { return Math.round(((S.az * 180 / Math.PI) % 360 + 360) % 360); },
      setPending(id) { pendId = id || null; applyState(); },
      setSelection(sel, grp) { state.sel = new Set(sel); state.grp = new Set(grp); applyState(); },
      pause() { running = false; }, resume() { if (!running) { running = true; last = 0; requestAnimationFrame(frame); } dirty = true; },
      dispose() { running = false; ro && ro.disconnect(); renderer.dispose(); }
    };
  }

  /* ====================================================================
   * 10b. YOUR OWN 3D MODEL (.glb)
   *      Reads a standing human mesh, fits it to the SDK body size and
   *      labels every vertex with the SDK's region polygons, so tapping,
   *      highlighting and the whole UI work on your model.
   * ==================================================================== */
  const GLB_H = 584;                                   // body height in SDK units
  const GLB_POSE = { relaxed: 0, a: 33, t: 78 };       // degrees the arms are rotated down for LABELLING only (mesh is untouched)
  const CT = { 5120: [1, 127], 5121: [1, 255], 5122: [2, 32767], 5123: [2, 65535], 5125: [4, 1], 5126: [4, 1] };
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  function parseGLB(buf) {
    const dv = new DataView(buf);
    if (dv.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error("This is not a .glb file (binary glTF). Export / convert your model to .glb.");
    let off = 12, json = null, bin = null;
    while (off + 8 <= dv.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true); off += 8;
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, len)));
      else if (type === 0x004e4942 && !bin) bin = new Uint8Array(buf, off, len);
      off += len;
    }
    if (!json) throw new Error("Invalid .glb (no JSON chunk)");
    return { J: json, bin: bin || new Uint8Array(0) };
  }
  function readAccessor(G, i, asIndex) {
    const { J, bin } = G, a = J.accessors[i], n = NCOMP[a.type], [bytes, maxv] = CT[a.componentType];
    const out = asIndex ? new Uint32Array(a.count) : new Float32Array(a.count * n);
    if (a.bufferView == null) return out;
    const bv = J.bufferViews[a.bufferView], base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * bytes;
    const dv = new DataView(bin.buffer), ct = a.componentType, norm = !!a.normalized && ct !== 5126;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const o = base + k * stride + c * bytes; let v;
      switch (ct) { case 5126: v = dv.getFloat32(o, true); break; case 5125: v = dv.getUint32(o, true); break; case 5123: v = dv.getUint16(o, true); break;
        case 5122: v = dv.getInt16(o, true); break; case 5121: v = dv.getUint8(o); break; default: v = dv.getInt8(o); }
      if (norm) v = Math.max(v / maxv, -1);
      out[asIndex ? k : k * n + c] = v;
    }
    return out;
  }
  const m4mul = (a, b) => { const r = new Array(16); for (let c = 0; c < 4; c++) for (let q = 0; q < 4; q++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + q] * b[c * 4 + k]; r[c * 4 + q] = s; } return r; };
  const m4trs = (t, q, s) => { const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1]; };
  const nodeM = n => n.matrix ? n.matrix.slice() : m4trs(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1]);
  const rotYM = deg => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };

  /** Pure geometry step (no three.js): positions/normals/uvs/indices in SDK units + per-vertex region labels. Exported for tests. */
  /** Face / head labelling from the model's OWN proportions (the generic region polygons put the eyes, mouth and chin at the wrong
   *  height on these models). Anchors are the chin and the crown in SDK units; eyes ~44 %, nose ~35 %, mouth ~19 % of the head height. */
  const HEAD_CHIN = { female: 498, male: 505 };
  function headModel(parts, sex, chinOverride) {
    let top = -1e30; parts.forEach(({ P }) => { for (let i = 1; i < P.length; i += 3) if (P[i] > top) top = P[i]; });
    const chin = Number(chinOverride) || HEAD_CHIN[sex], h = top - chin; if (!(h > 20)) return null;
    let hw = 0, z0 = 1e30, z1 = -1e30;
    parts.forEach(({ P }) => { for (let i = 0; i < P.length; i += 3) { const v = (P[i + 1] - chin) / h; if (v > 0.3 && v < 0.8) { hw = Math.max(hw, Math.abs(P[i])); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); } } });
    return { chin, top, h, hw: hw || h * 0.45, zc: (z0 + z1) / 2, dz: Math.max(1, (z1 - z0) / 2) };
  }
  /** Arm labelling for relaxed (hanging) arms, from the model's own arm length: shoulder joint -> fingertips, measured in SDK units. */
  const ARM_SPAN = { female: { top: 459, tip: 256 }, male: { top: 440, tip: 238 } };
  function armLabel(sex, X, Y) {
    const A = ARM_SPAN[sex]; if (!A) return null;
    const L = A.top - A.tip, ax = Math.abs(X);
    if (Y > A.top - 0.06 * L || Y < A.tip - 4) return null;                    // shoulder / trapezius stay with the body polygons
    const edge = sex === "male" ? (Y < 400 ? 63 + 0.32 * (400 - Y) : 66) : 57;   // torso / hip edge at this height
    if (sex === "male" && edge > 95) { if (ax <= 95) return null; } else if (ax <= Math.min(edge, 95)) return null;
    const t = (A.top - Y) / L, side = X < 0 ? "right" : "left";
    return side + (t < 0.37 ? "-upper-arm" : t < 0.47 ? "-elbow" : t < 0.71 ? "-forearm" : t < 0.78 ? "-wrist" : "-hand");
  }
  function headLabel(M, X, Y, Z) {
    if (!M || Y < M.chin) return null;
    const v = (Y - M.chin) / M.h, u = Math.abs(X) / M.hw, side = X < 0 ? "right" : "left";
    const ang = Math.atan2(Math.abs(X) / M.hw, (Z - M.zc) / M.dz) * 180 / Math.PI;   // 0 = straight ahead, 90 = side, 180 = behind
    if (v >= 0.9) return "scalp";
    if (ang > 118) return v >= 0.2 ? "back-of-head" : "neck";
    if (ang > 56) {                                                                 // side of the head
      if (v >= 0.64) return side + "-temple";
      if (v >= 0.3 && ang >= 72) return side + "-ear";
      return v >= 0.3 ? side + "-cheek" : "jaw";
    }
    if (v >= 0.62) return u > 0.62 ? side + "-temple" : "forehead";                 // front of the face
    if (v >= 0.37) { if (u < 0.1 && v < 0.6) return "nose"; return u > 0.62 ? side + "-temple" : u >= 0.1 ? side + "-eye" : "forehead"; }
    if (v >= 0.27) return u < 0.2 ? "nose" : side + "-cheek";
    if (v >= 0.12) return u < 0.32 ? "mouth" : u < 0.7 ? side + "-cheek" : "jaw";
    return u < 0.34 ? "chin" : "jaw";
  }

  function prepareGLB(buf, o) {
    o = o || {};
    const sex = o.sex === "male" ? "male" : "female";
    // The supplied female GLB uses a downward-positive vertical axis (head at
    // minimum source Y). Normalize it once, before bounds, labels, and picking.
    const invertY = sex === "female";
    const G = parseGLB(buf), J = G.J, prims = [];
    const walk = (ni, parent) => {
      const n = J.nodes[ni], m = m4mul(parent, nodeM(n));
      if (n.mesh != null) J.meshes[n.mesh].primitives.forEach(p => { if ((p.mode == null ? 4 : p.mode) === 4 && p.attributes && p.attributes.POSITION != null) prims.push({ p, m }); });
      (n.children || []).forEach(c => walk(c, m));
    };
    const root = rotYM(Number(o.rotateY) || 0);
    if (J.nodes && J.nodes.length) { const sc = J.scenes && J.scenes[J.scene || 0]; (sc && sc.nodes ? sc.nodes : J.nodes.map((_, i) => i).filter(i => !J.nodes.some(n => (n.children || []).includes(i)))).forEach(i => walk(i, root)); }
    if (!prims.length) throw new Error("No mesh found in this .glb");
    // 1) bake node transforms
    let mnx = 1e30, mny = 1e30, mnz = 1e30, mxx = -1e30, mxy = -1e30, mxz = -1e30;
    const parts = prims.map(({ p, m }) => {
      const P = readAccessor(G, p.attributes.POSITION), N = p.attributes.NORMAL != null ? readAccessor(G, p.attributes.NORMAL) : null;
      const U = p.attributes.TEXCOORD_0 != null ? readAccessor(G, p.attributes.TEXCOORD_0) : null;
      const I = p.indices != null ? readAccessor(G, p.indices, true) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
      // A reflection changes triangle winding. Reverse each triangle so front
      // faces and raycasting remain correct after the female axis normalization.
      if (invertY) for (let t = 0; t < I.length; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        const X = m[0] * x + m[4] * y + m[8] * z + m[12], rawY = m[1] * x + m[5] * y + m[9] * z + m[13], Y = invertY ? -rawY : rawY, Z = m[2] * x + m[6] * y + m[10] * z + m[14];
        P[i] = X; P[i + 1] = Y; P[i + 2] = Z;
        if (X < mnx) mnx = X; if (X > mxx) mxx = X; if (Y < mny) mny = Y; if (Y > mxy) mxy = Y; if (Z < mnz) mnz = Z; if (Z > mxz) mxz = Z;
        if (N) { const a = N[i], b = N[i + 1], c = N[i + 2]; const nx = m[0] * a + m[4] * b + m[8] * c, ny0 = m[1] * a + m[5] * b + m[9] * c, ny = invertY ? -ny0 : ny0, nz = m[2] * a + m[6] * b + m[10] * c, l = Math.hypot(nx, ny, nz) || 1; N[i] = nx / l; N[i + 1] = ny / l; N[i + 2] = nz / l; }
      }
      return { P, N, U, I, material: p.material };
    });
    const Hm = mxy - mny; if (!(Hm > 0)) throw new Error("The model has no height");
    // 2) fit to SDK size: feet on the floor, centred on the legs
    const k = GLB_H / Hm, lowY = mny + Hm * 0.3;
    let lx0 = 1e30, lx1 = -1e30, lz0 = 1e30, lz1 = -1e30;
    parts.forEach(({ P }) => { for (let i = 0; i < P.length; i += 3) if (P[i + 1] < lowY) { lx0 = Math.min(lx0, P[i]); lx1 = Math.max(lx1, P[i]); lz0 = Math.min(lz0, P[i + 2]); lz1 = Math.max(lz1, P[i + 2]); } });
    const cx = lx1 > lx0 ? (lx0 + lx1) / 2 : (mnx + mxx) / 2, cz = lz1 > lz0 ? (lz0 + lz1) / 2 : (mnz + mxz) / 2;
    parts.forEach(({ P }) => { for (let i = 0; i < P.length; i += 3) { P[i] = (P[i] - cx) * k; P[i + 1] = (P[i + 1] - mny) * k + 2; P[i + 2] = (P[i + 2] - cz) * k; } });
    // 3) normals for meshes that have none (area-weighted)
    parts.forEach(pt => {
      if (pt.N) return; const { P, I } = pt, N = (pt.N = new Float32Array(P.length));
      for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        [a, b, c].forEach(q => { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }); }
      for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
    });
    // 4) label every vertex with the SDK region polygons
    const mapF = getMapper(sex, "front"), mapB = getMapper(sex, "back");
    const legX = alignLegs(parts, mapF);          // lines each leg up with the SDK leg (splayed, very wide or very slim legs still land on thigh / knee / shin / ankle)
    const drop = (GLB_POSE[o.pose] != null ? GLB_POSE[o.pose] : Number(o.pose) || 0) * Math.PI / 180, cs = Math.cos(drop), sn = Math.sin(drop);
    const PX = 58, PY = GLB_H * 0.8, cache = new Map(), RING = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [3, 0], [-3, 0], [0, 3], [0, -3], [6, 0], [-6, 0], [0, 6], [0, -6], [10, 0], [-10, 0], [0, 10], [0, -10]];
    const lookup = (map, x, y) => { let r = map.lookup(x, y); if (r) return r; for (let i = 0; i < RING.length; i++) { r = map.lookup(x + RING[i][0], y + RING[i][1]); if (r) return r; } return ""; };
    const HM = o.headAnchors === false ? null : headModel(parts, sex, o.headChin);
    const names = [""], nidx = { "": 0 }, nid = id => (id in nidx ? nidx[id] : (nidx[id] = names.push(id) - 1));
    parts.forEach(pt => {
      const { P, N } = pt, n = P.length / 3, labels = (pt.labels = new Uint16Array(n));
      for (let i = 0; i < n; i++) {
        let X = P[i * 3], Y = P[i * 3 + 1]; const front = P[i * 3 + 2] >= 0;
        if (drop && Math.abs(X) > GLB_H * 0.145 && Y > GLB_H * 0.42) {       // arm held out: bring it down to the SDK's relaxed arm for lookup
          const sgn = X < 0 ? -1 : 1, dx = Math.abs(X) - PX, dy = Y - PY;
          X = sgn * (PX + dx * cs + dy * sn); Y = PY - dx * sn + dy * cs;
        }
        if (legX) X = legX(X, Y);
        const cx2 = front ? X + 150 : 150 - X, cy = GROUND - Y, key = Math.round(cx2 * 2) * 100000 + Math.round(cy * 2) * 2 + (front ? 1 : 0);
        let id = cache.get(key); if (id === undefined) { id = lookup(front ? mapF : mapB, cx2, cy); cache.set(key, id); }
        if (!id) {                      // hands and feet are separate parts in the SDK, so they are not in the polygons: label them by position
          const side = X < 0 ? "right" : "left";
          if (Y < 46) id = side + "-foot";
          else if (Math.abs(X) > 50 && Y > 170 && Y < 300) id = side + "-hand";
        }
        const hl = headLabel(HM, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) || (HM && armLabel(sex, P[i * 3], P[i * 3 + 1])); if (hl) id = hl;
        labels[i] = nid(id);
      }
    });
    fillLabels(parts, nid);                          // every vertex ends up in a region, so every part of the body can be selected
    // Resolve a tap from the actual surface hit coordinate, not a triangle's
    // interpolated vertex labels. This prevents labels bleeding across elbows,
    // wrists, hips, knees, and other boundaries when mesh tessellation differs.
    const regionAtPoint = (x0, y0, z0) => {
      let X = x0, Y = y0;
      if (drop && Math.abs(X) > GLB_H * 0.145 && Y > GLB_H * 0.42) {
        const sgn = X < 0 ? -1 : 1, dx = Math.abs(X) - PX, dy = Y - PY;
        X = sgn * (PX + dx * cs + dy * sn); Y = PY - dx * sn + dy * cs;
      }
      if (legX) X = legX(X, Y);
      const front = z0 >= 0, cx2 = front ? X + 150 : 150 - X, cy = GROUND - Y;
      let id = lookup(front ? mapF : mapB, cx2, cy);
      if (!id) {
        // Small local search only: do not use a whole-body nearest region, which
        // can turn a tap on a finger into a wrist/arm or a foot into a shin.
        for (const [dx, dy] of [[1.5,0],[-1.5,0],[0,1.5],[0,-1.5],[3,0],[-3,0],[0,3],[0,-3]]) {
          id = lookup(front ? mapF : mapB, cx2 + dx, cy + dy); if (id) break;
        }
      }
      if (!id && Y < 46) id = (X < 0 ? "right" : "left") + "-foot";
      if (!id && Math.abs(X) > 50 && Y > 170 && Y < 300) id = (X < 0 ? "right" : "left") + "-hand";
      return headLabel(HM, x0, y0, z0) || (HM && armLabel(sex, x0, y0)) || id || null;
    };
    return { G, parts, names, sex, height: Hm, regionAtPoint, source: { width: (mxx - mnx) * k, depth: (mxz - mnz) * k } };
  }

  /** Leg alignment. Per height band the model's inner / outer leg edge is stretched onto the SDK leg's edges, so the
   *  labelling does not depend on how wide, slim or splayed the legs of the model are. Returns (X, Y) -> X, or null. */
  function alignLegs(parts, map) {
    const BAND = 6, TOP = 262, LIM = 100, nb = Math.ceil(TOP / BAND), ARM = /arm|elbow|wrist|hand|shoulder/;
    const buckets = [[], []];                                     // [left side (+X), right side (-X)] -> per band list of |X|
    for (let s = 0; s < 2; s++) for (let b = 0; b < nb; b++) buckets[s].push([]);
    parts.forEach(({ P }) => { for (let i = 0; i < P.length; i += 3) { const Y = P[i + 1], X = P[i]; if (Y >= TOP || Y < 0 || Math.abs(X) >= LIM) continue; buckets[X < 0 ? 1 : 0][Math.floor(Y / BAND)].push(Math.abs(X)); } });
    const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
    const mod = [[], []], sdk = [];
    for (let b = 0; b < nb; b++) {
      const cy = GROUND - (b + 0.5) * BAND; let A = 1e9, B = -1e9;
      for (let dx = 1; dx < LIM; dx++) { const r = map.lookup(150 + dx, cy); if (r && !ARM.test(r)) { if (dx < A) A = dx; if (dx > B) B = dx; } }
      sdk.push(B > A ? [A, B] : null);
      for (let s = 0; s < 2; s++) { const a = buckets[s][b].sort((x, y) => x - y); mod[s].push(a.length >= 12 ? [pct(a, 0.03), pct(a, 0.97)] : null); }
    }
    const ok = b => sdk[b] && mod[0][b] && mod[1][b] && mod[0][b][1] - mod[0][b][0] > 3 && mod[1][b][1] - mod[1][b][0] > 3;
    const good = []; for (let b = 0; b < nb; b++) if (ok(b)) good.push(b);
    if (good.length < 6) return null;
    const lerpBand = (arr, f) => { let b0 = Math.floor(f), t = f - b0; b0 = clamp(b0, 0, nb - 1); const b1 = Math.min(nb - 1, b0 + 1); return arr[b0] + (arr[b1] - arr[b0]) * t; };
    const fill = fn => { const out = new Array(nb); for (let b = 0; b < nb; b++) { let lo = -1, hi = -1; for (let q = good.length - 1; q >= 0; q--) if (good[q] <= b) { lo = good[q]; break; } for (let q = 0; q < good.length; q++) if (good[q] >= b) { hi = good[q]; break; } if (lo < 0) lo = hi; if (hi < 0) hi = lo; out[b] = lo === hi ? fn(lo) : fn(lo) + (fn(hi) - fn(lo)) * (b - lo) / (hi - lo); } return out; };
    const mA = [fill(b => mod[0][b][0]), fill(b => mod[1][b][0])], mB = [fill(b => mod[0][b][1]), fill(b => mod[1][b][1])], sA = fill(b => sdk[b][0]), sB = fill(b => sdk[b][1]);
    const sm = a => a.map((_, i) => (a[Math.max(0, i - 1)] + a[i] * 2 + a[Math.min(nb - 1, i + 1)]) / 4);   // light smoothing
    const MA = mA.map(sm), MB = mB.map(sm), SA = sm(sA), SB = sm(sB);
    return (X, Y) => {
      if (Y >= TOP || Y < 0 || Math.abs(X) >= LIM) return X;
      const s = X < 0 ? 1 : 0, f = Y / BAND - 0.5, a = lerpBand(MA[s], f), b = lerpBand(MB[s], f), A = lerpBand(SA, f), B = lerpBand(SB, f);
      const t = clamp((Math.abs(X) - a) / Math.max(1, b - a), -0.05, 1.05);
      return (X < 0 ? -1 : 1) * (A + t * (B - A));
    };
  }

  /** Gives every unlabelled vertex the label of its nearest labelled neighbour (along the surface first, then in space). */
  function fillLabels(parts, nid) {
    let todo = 0; parts.forEach(pt => { for (let i = 0; i < pt.labels.length; i++) if (!pt.labels[i]) todo++; });
    if (!todo) return;
    parts.forEach(pt => {                                           // 1) spread along mesh edges (multi-source breadth-first)
      const { I, labels } = pt, n = labels.length, deg = new Uint32Array(n + 1);
      for (let t = 0; t < I.length; t++) deg[I[t] + 1] += 2;
      for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
      const adj = new Uint32Array(deg[n]), pos = deg.slice(0, n);
      for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; adj[pos[a]++] = b; adj[pos[b]++] = a; }
      let q = []; for (let i = 0; i < n; i++) if (labels[i]) q.push(i);
      while (q.length) { const nx = []; for (let h = 0; h < q.length; h++) { const v = q[h]; for (let e = deg[v]; e < deg[v + 1]; e++) { const u = adj[e]; if (!labels[u]) { labels[u] = labels[v]; nx.push(u); } } } q = nx; }
    });
    let left = 0; parts.forEach(pt => { for (let i = 0; i < pt.labels.length; i++) if (!pt.labels[i]) left++; });
    if (!left) return;
    const cand = [], step = Math.max(1, Math.ceil(parts.reduce((n, pt) => n + pt.labels.length, 0) / 6000));   // at most ~6000 reference points
    parts.forEach(pt => { for (let i = 0; i < pt.labels.length; i += step) if (pt.labels[i]) cand.push([pt.P[i * 3], pt.P[i * 3 + 1], pt.P[i * 3 + 2], pt.labels[i]]); });
    if (!cand.length) return;
    parts.forEach(pt => {                                           // 2) loose pieces (eyes, teeth, hair cards...): nearest labelled point in space
      for (let i = 0; i < pt.labels.length; i++) if (!pt.labels[i]) {
        const x = pt.P[i * 3], y = pt.P[i * 3 + 1], z = pt.P[i * 3 + 2]; let best = 0, bd = 1e30;
        for (let c = 0; c < cand.length; c++) { const d = (cand[c][0] - x) ** 2 + (cand[c][1] - y) ** 2 + (cand[c][2] - z) ** 2; if (d < bd) { bd = d; best = cand[c][3]; } }
        pt.labels[i] = best;
      }
    });
  }

  async function buildGLB(THREE, buf, o) {
    o = o || {};
    const pre = prepareGLB(buf, o), { G, parts, names } = pre, J = G.J, K = SKIN.natural;
    const group = new THREE.Group(), pick = [], meshes = [], regionVerts = new Map();
    const texCache = new Map();
    const getTex = async ti => {
      if (ti == null || o.debug) return null; if (texCache.has(ti)) return texCache.get(ti);
      let t = null;
      try {
        const img = J.images && J.images[J.textures[ti].source];
        if (img && img.bufferView != null && typeof createImageBitmap === "function") {
          const bv = J.bufferViews[img.bufferView], bytes = new Uint8Array(G.bin.buffer, G.bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
          const bmp = await createImageBitmap(new Blob([bytes], { type: img.mimeType || "image/png" }), { imageOrientation: "none" });
          t = new THREE.Texture(bmp); t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
        }
      } catch (e) { t = null; }
      texCache.set(ti, t); return t;
    };
    const mats = new Map();
    for (const pt of parts) {
      const mi = pt.material, key = mi == null ? -1 : mi;
      if (!mats.has(key)) {
        const gm = mi != null ? J.materials[mi] : null, pbr = (gm && gm.pbrMetallicRoughness) || {}, bc = pbr.baseColorFactor || [1, 1, 1, 1];
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: pbr.roughnessFactor != null ? Math.max(0.35, pbr.roughnessFactor) : 0.7, metalness: Math.min(0.15, pbr.metallicFactor || 0), side: gm && gm.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
        const map = pbr.baseColorTexture ? await getTex(pbr.baseColorTexture.index) : null;
        if (map) mat.map = map; else if (pbr.baseColorFactor) mat.color = new THREE.Color(bc[0], bc[1], bc[2]); else mat.color = new THREE.Color(K.base);   // no colour in the file: neutral skin tone
        if (gm && gm.alphaMode === "BLEND") { mat.transparent = true; mat.opacity = bc[3]; mat.depthWrite = false; } else if (gm && gm.alphaMode === "MASK") mat.alphaTest = gm.alphaCutoff != null ? gm.alphaCutoff : 0.5;
        mats.set(key, mat);
      }
    }
    parts.forEach(pt => {
      const g = new THREE.BufferGeometry(), n = pt.P.length / 3, col = new Float32Array(n * 3).fill(1);
      if (o.debug) { const c = new THREE.Color(); for (let i = 0; i < n; i++) { const l = pt.labels[i]; if (!l) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.12; continue; } c.setHSL(((l * 47) % 360) / 360, 0.65, 0.55); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } }
      g.setAttribute("position", new THREE.BufferAttribute(pt.P, 3)); g.setAttribute("normal", new THREE.BufferAttribute(pt.N, 3));
      if (pt.U) g.setAttribute("uv", new THREE.BufferAttribute(pt.U, 2)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(pt.I, 1));
      const mesh = new THREE.Mesh(g, mats.get(pt.material == null ? -1 : pt.material));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { kind: "skin", labels: pt.labels, baseArr: col.slice() };
      group.add(mesh); pick.push(mesh); meshes.push(mesh);
      const per = new Map();
      for (let i = 0; i < pt.labels.length; i++) { const id = names[pt.labels[i]]; if (!id) continue; if (!per.has(id)) per.set(id, []); per.get(id).push(i); }
      per.forEach((idx, id) => { if (!regionVerts.has(id)) regionVerts.set(id, []); regionVerts.get(id).push({ mesh, idx }); });
    });
    return { group, pick, regionVerts, names, meshes, meta: { names, K, sex: pre.sex, mode: "external", scale: 1, custom: true, regionAtPoint: pre.regionAtPoint } };
  }

  /* ====================================================================
   * 11. WEB COMPONENT  <health-body-selector>
   *     Full-screen figure  +  a dock that collects everything:
   *       areas (tap the body)  ·  Strength  ·  Started  ·  Inside  ·  Note  ->  Continue
   * ==================================================================== */
  /* ====================================================================
   * Model calls. Both are JSON POSTs with Content-Type: application/json
   *   POST {MODEL_API}/predict  { "text": "chest pain; left hand tingling;" }
   *   POST {RISK_API}/risk      { "text": "chest pain; left hand tingling;", "sex": "female" }
   * ==================================================================== */
  const trimBase = u => String(u || "").trim().replace(/\/+$/, "");
  function buildRequests(o) {
    const text = String(o.text || "").trim(), out = [];
    if (trimBase(o.modelApi)) out.push({ key: "predict", url: trimBase(o.modelApi) + "/predict", body: { text } });
    if (trimBase(o.riskApi)) out.push({ key: "risk", url: trimBase(o.riskApi) + "/risk", body: { text, sex: o.sex === "female" ? "female" : "male" } });
    return out;
  }
  async function postJson(url, body, timeoutMs, fetchImpl) {
    const f = fetchImpl || (typeof fetch === "function" ? fetch : null); if (!f) throw new Error("fetch is not available");
    const ctl = typeof AbortController === "function" ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const r = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { throw e && e.name === "AbortError" ? new Error("timed out") : e; }
    finally { if (timer) clearTimeout(timer); }
  }
  /** Calls the configured services in parallel; one failing never blocks the other. */
  async function analyze(o) {
    const requests = buildRequests(o), t = o.timeoutMs || 20000;
    const settled = await Promise.allSettled(requests.map(r => postJson(r.url, r.body, t, o.fetchImpl)));
    const res = { requests, predict: null, risk: null, errors: { predict: null, risk: null }, ok: true };
    settled.forEach((x, i) => { const k = requests[i].key; if (x.status === "fulfilled") res[k] = x.value; else { res.errors[k] = String(x.reason && x.reason.message || x.reason); res.ok = false; } });
    return res;
  }

  const SYMPTOMS = ["Pain", "Aching", "Burning", "Numbness", "Tingling", "Itching", "Swelling", "Weakness", "Stiffness", "Rash", "Bleeding"];
  const DURATIONS = ["Just now", "Today", "1–3 days", "About a week", "A few weeks", "Over a month", "Comes and goes"];
  const DUR_SHORT = { "Just now": "Just now", "Today": "Today", "1–3 days": "1–3 days", "About a week": "~1 week", "A few weeks": "Weeks", "Over a month": "1+ month", "Comes and goes": "On & off" };
  const sevWord = n => (n <= 3 ? "Mild" : n <= 6 ? "Moderate" : n <= 8 ? "Strong" : "Severe");

  /* "Inside the body" — everyday wording, no organ names needed.
   * [id, what the person sees, body systems, related organ ids (hint only)] */
  const INSIDE = [
    { id: "chest", label: "Chest", sub: "heart & lungs", ic: "lungs", items: [
      ["chest-tight", "Chest tightness or pressure", ["cardio", "resp"], ["heart", "left-lung", "right-lung"]],
      ["heartbeat", "Racing or skipping heartbeat", ["cardio"], ["heart"]],
      ["breath", "Short of breath", ["resp", "cardio"], ["left-lung", "right-lung", "heart"]],
      ["cough", "Cough or wheeze", ["resp"], ["left-lung", "right-lung", "trachea"]]] },
    { id: "tummy", label: "Tummy", sub: "stomach & gut", ic: "stomach", items: [
      ["nausea", "Nausea or vomiting", ["gi"], ["stomach"]],
      ["heartburn", "Heartburn or sour taste", ["gi"], ["esophagus", "stomach"]],
      ["bloating", "Bloating or gas", ["gi"], ["small-intestine", "large-intestine"]],
      ["cramps", "Belly cramps", ["gi"], ["small-intestine", "large-intestine"]],
      ["constipation", "Constipation", ["gi"], ["large-intestine", "rectum"]],
      ["loose", "Loose stools", ["gi"], ["large-intestine"]],
      ["blood-stool", "Blood in stool", ["gi", "anorectal"], ["large-intestine", "rectum"]],
      ["appetite", "Loss of appetite", ["gi"], ["stomach"]],
      ["pelvic", "Pelvic or lower belly pain", ["gi", "genitourinary"], ["bladder", "large-intestine"]]] },
    { id: "urine", label: "Urine", sub: "kidneys & bladder", ic: "drop", items: [
      ["pee-burn", "Burning when peeing", ["urinary"], ["bladder"]],
      ["pee-often", "Peeing very often", ["urinary"], ["bladder"]],
      ["pee-blood", "Blood in urine", ["urinary"], ["left-kidney", "right-kidney", "bladder"]],
      ["pee-hard", "Hard to pee", ["urinary"], ["bladder"]],
      ["kidney-side", "Ache in the side or back", ["urinary"], ["left-kidney", "right-kidney"]]] },
    { id: "head", label: "Head & nerves", sub: "brain", ic: "brain", items: [
      ["dizzy", "Dizzy or faint", ["neuro", "cardio"], ["brain", "heart"]],
      ["foggy", "Confused or foggy", ["neuro"], ["brain"]],
      ["one-side", "Weak or numb on one side", ["neuro"], ["brain"]],
      ["vision", "Vision changes", ["neuro", "eye"], ["brain", "eyes"]]] },
    { id: "throat", label: "Throat", sub: "swallowing & voice", ic: "throat", items: [
      ["swallow", "Hard or painful to swallow", ["ent", "gi"], ["esophagus", "larynx"]],
      ["voice", "Hoarse or lost voice", ["ent"], ["larynx"]],
      ["neck-lump", "Lump in the neck", ["endocrine", "ent"], ["thyroid"]]] },
    { id: "bones", label: "Bones & joints", sub: "and muscles", ic: "bone", items: [
      ["bone-ache", "Deep ache in a bone", ["msk"], ["left-femur", "right-femur", "left-tibia", "right-tibia", "left-humerus", "right-humerus"]],
      ["bone-night", "Bone pain that wakes me at night", ["msk"], []],
      ["joint-swell", "Swollen or stiff joints", ["msk"], ["left-knee-joint", "right-knee-joint", "left-hip-joint", "right-hip-joint", "left-shoulder-joint", "right-shoulder-joint"]],
      ["joint-lock", "Joint clicks, locks or gives way", ["msk"], ["left-knee-joint", "right-knee-joint"]],
      ["spine-pain", "Neck or back stiffness", ["msk", "neuro"], ["cervical-spine", "thoracic-spine", "lumbar-spine"]],
      ["injury", "Fall or injury, maybe a break", ["msk"], []],
      ["muscle-cramp", "Muscle cramps or spasms", ["msk"], []],
      ["muscle-weak", "Muscles feel weak", ["msk", "neuro"], []]] },
    { id: "repro-f", label: "Women's health", sub: "periods, pregnancy", ic: "female", sex: "female", items: [
      ["period", "Period problems", ["female_repro"], ["uterus", "ovaries"]],
      ["pregnant", "Pregnancy concern", ["female_repro"], ["uterus"]],
      ["discharge", "Unusual discharge or bleeding", ["female_repro"], ["uterus", "ovaries"]]] },
    { id: "repro-m", label: "Men's health", sub: "prostate, testicles", ic: "male", sex: "male", items: [
      ["prostate", "Weak flow or prostate trouble", ["male_repro", "urinary"], ["prostate", "bladder"]],
      ["testicle", "Testicle pain or swelling", ["male_repro"], ["testes"]]] },
    { id: "whole", label: "Whole body", sub: "fever, tiredness", ic: "thermo", items: [
      ["fever", "Fever or chills", ["general"], []],
      ["tired", "Very tired or weak", ["general"], []],
      ["thirst", "Very thirsty", ["endocrine", "general"], []],
      ["weight", "Weight change without trying", ["endocrine", "general"], []],
      ["sweats", "Night sweats", ["general"], []]] }
  ];
  const INSIDE_ITEM = new Map();
  INSIDE.forEach(g => g.items.forEach(([id, label, systems, organs]) => INSIDE_ITEM.set(id, { id, label, systems, organs, group: g })));
  const insideGroups = sex => INSIDE.filter(g => !g.sex || g.sex === sex);

  const IC = {
    turn: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    head: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.2 3.3-6.5 7.5-6.5s7.5 2.3 7.5 6.5"/>',
    hand: '<path d="M8.5 13V6.2a1.5 1.5 0 0 1 3 0V11m0-5.3a1.5 1.5 0 0 1 3 0V11m0-3.8a1.5 1.5 0 0 1 3 0v7.3a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.5-1.6l1.7 2"/>',
    foot: '<path d="M8 3.5c2.6 0 3.5 2 3.5 5 0 3 1.2 4.3 4 5.2 2.3.8 3 2 3 3.8V19a1.5 1.5 0 0 1-1.5 1.5h-9A2.5 2.5 0 0 1 5.5 18c0-2.2.2-4 .6-6.4C6.5 8 6 3.5 8 3.5z"/>',
    gauge: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 17l3.5-5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    inside: '<path d="M12 20s-7-4.3-7-9.7A4 4 0 0 1 12 8a4 4 0 0 1 7 2.3C19 15.7 12 20 12 20z"/>',
    note: '<path d="M4 20l4.2-1L19 8.2 15.8 5 5 15.8z"/><path d="M13.5 6.5l3 3"/>',
    organs: '<path d="M8.5 4C6.5 5 5.4 7 5.4 10v10h13.2V10c0-3-1.1-5-3.1-6"/><path d="M12 6.5v12M8.2 10.2h7.6M8.2 13.6h7.6"/>',
    lungs: '<path d="M12 4v8M12 8c-1.2-2-3.4-2.8-5.2-1.6C4.8 8 4 12 4 16c0 2.4 2 3.4 4 2.4 2.2-1.1 4-3 4-6.4M12 8c1.2-2 3.4-2.8 5.2-1.6 2 1.6 2.8 5.6 2.8 9.6 0 2.4-2 3.4-4 2.4-2.2-1.1-4-3-4-6.4"/>',
    stomach: '<path d="M9 3.5c0 3-3 3.4-3 7.2 0 5 3.2 8.8 8 8.8 3.2 0 5.4-1.8 5.4-4.2 0-3-3.4-3.2-5.4-4.4-1.8-1.1-2-3-2-5.6"/>',
    drop: '<path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/>',
    brain: '<path d="M9.5 5a3 3 0 0 0-3.2 3 3 3 0 0 0-2 2.8 3 3 0 0 0 2 2.8 3 3 0 0 0 3.2 4.4H11V5zM14.5 5a3 3 0 0 1 3.2 3 3 3 0 0 1 2 2.8 3 3 0 0 1-2 2.8 3 3 0 0 1-3.2 4.4H13V5z"/>',
    throat: '<path d="M9 3.5h6v5.2l2.2 3.3V20H6.8v-8l2.2-3.3z"/><path d="M12 11v5"/>',
    bone: '<path d="M8.6 15.4l6.8-6.8"/><circle cx="6.6" cy="15.4" r="2"/><circle cx="8.6" cy="17.4" r="2"/><circle cx="15.4" cy="6.6" r="2"/><circle cx="17.4" cy="8.6" r="2"/>',
    female: '<circle cx="12" cy="9" r="4.2"/><path d="M12 13.2v7M8.8 17.2h6.4"/>',
    male: '<circle cx="10" cy="14" r="4.2"/><path d="M13 11l6-6M14.2 5H19v4.8"/>',
    thermo: '<path d="M10 14.2V5.2a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    dot: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="8" opacity=".35"/>'
  };
  const icon = (n, s) => `<svg class="ic" width="${s || 20}" height="${s || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
  const INFO_TEXT = "This tool records what you report and does not diagnose. In an emergency, call your local emergency number. Avoid entering names or other identifying details.";
  // "Head (whole head)" -> "Head",  "Scalp / top of head" -> "Scalp"
  const spoken = id => { const f = REG[id]; return f ? f.label.replace(/\s*\([^)]*\)/g, "").split(" / ")[0].trim() : String(id); };
  const lc = s => s.charAt(0).toLowerCase() + s.slice(1);

  const CSS = `
    :host{display:block;height:var(--care-height,100dvh);min-height:460px;
      --ac:var(--care-accent,#0b8f7e);--accent:var(--ac);--acink:#fff;--acsoft:#e0f2ee;--acline:#a9d8cf;
      --s1:#eaf0ed;--s2:#ccd9d5;--sheet:#fff;--ink:#14302b;--mute:#5b756e;--line:#dce6e2;--danger:#cf3a2e;
      background:var(--s2);color:var(--ink);font:15px/1.4 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;-webkit-text-size-adjust:100%}
    @media(prefers-color-scheme:dark){:host(:not([theme="light"])){--ac:var(--care-accent-dark,#3fcdb5);--acink:#052019;--acsoft:#1c3a35;--acline:#2f5c54;--s1:#22332f;--s2:#0f1816;--sheet:#1a2624;--ink:#e8f2ef;--mute:#92aaa3;--line:#2a3b37}}
    :host([theme="dark"]){--ac:var(--care-accent-dark,#3fcdb5);--acink:#052019;--acsoft:#1c3a35;--acline:#2f5c54;--s1:#22332f;--s2:#0f1816;--sheet:#1a2624;--ink:#e8f2ef;--mute:#92aaa3;--line:#2a3b37}
    *{box-sizing:border-box}
    button,textarea{font:inherit;color:inherit}
    button{cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    button:focus-visible,a:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
    .app{position:relative;height:100%;max-width:480px;margin:0 auto;display:flex;flex-direction:column;overflow:hidden;background:var(--s2)}

    /* ---- figure stage ---- */
    .stage{position:relative;flex:1;min-height:0;background:radial-gradient(120% 80% at 50% 38%,var(--s1),var(--s2))}
    .canvas,.viewer3d{position:absolute;inset:0}
    .svgwrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:64px 8px 34px}
    .svgwrap svg{height:100%;width:auto;max-width:100%}
    .svgwrap .caption,.svgwrap .lr{display:none}
    .svgwrap .hit{stroke-opacity:.05}
    .svgwrap .hit:hover{fill:var(--ac);fill-opacity:.3}
    .svgwrap .hit.selected{fill:var(--ac);fill-opacity:.62;stroke:var(--ac);stroke-opacity:1}
    .loading{position:absolute;inset:0;z-index:4;display:grid;place-items:center;pointer-events:none}
    .spinner{width:30px;height:30px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--ac);animation:spin .9s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .hud{position:absolute;z-index:3;top:calc(10px + env(safe-area-inset-top,0px));left:12px;right:12px;display:flex;align-items:center;gap:8px;pointer-events:none}
    .hud>*{pointer-events:auto}
    .glass{background:color-mix(in srgb,var(--sheet) 80%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,var(--line) 80%,transparent)}
    .who{display:flex;padding:3px;gap:2px;border-radius:999px}
    .who button{border:0;background:none;color:var(--mute);min-height:36px;padding:0 13px;border-radius:999px;font-weight:700;font-size:14px}
    .who button[aria-pressed="true"]{background:var(--ink);color:var(--sheet)}
    .sp{flex:1}
    .roundbtn{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;padding:0;color:var(--mute)}
    .sosbtn{height:42px;padding:0 16px;border:0;border-radius:999px;background:var(--danger);color:#fff;font-weight:800;font-size:14px;letter-spacing:.03em;box-shadow:0 4px 14px rgba(207,58,46,.35)}
    .rail{position:absolute;z-index:3;right:10px;top:calc(68px + env(safe-area-inset-top,0px));display:flex;flex-direction:column;align-items:flex-end;gap:10px}
    .insidebtn{position:relative;width:76px;padding:10px 4px 9px;border:0;border-radius:22px;background:linear-gradient(160deg,var(--ac),color-mix(in srgb,var(--ac) 70%,#000));color:var(--acink);display:flex;flex-direction:column;align-items:center;gap:1px;box-shadow:0 8px 22px color-mix(in srgb,var(--ac) 45%,transparent);animation:ring 2.6s ease-out 3 1s}
    .insidebtn b{font-size:15px;font-weight:800;line-height:1.1;margin-top:3px}
    .insidebtn i{font-style:normal;font-size:9.5px;font-weight:700;opacity:.9;letter-spacing:.01em}
    .insidebtn em{position:absolute;top:-6px;right:-6px;min-width:24px;height:24px;border-radius:12px;background:var(--ink);color:var(--sheet);font-style:normal;font-size:12px;font-weight:800;display:grid;place-items:center;padding:0 6px;border:2px solid var(--s1)}
    @keyframes ring{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ac) 55%,transparent)}70%,100%{box-shadow:0 0 0 16px transparent}}
    .turnbtn{width:52px;padding:7px 0 6px;border-radius:16px;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10.5px;font-weight:700;color:var(--mute)}
    .turnbtn:disabled{opacity:.4;cursor:default}
    .side{position:absolute;z-index:2;bottom:30px;font-size:12px;font-weight:800;color:var(--mute);opacity:.75;pointer-events:none}
    .side.l{left:14px}.side.r{right:14px}
    .tipchip{position:absolute;z-index:3;left:50%;transform:translateX(-50%);top:calc(60px + env(safe-area-inset-top,0px));max-width:60%;padding:5px 13px;border-radius:999px;font-weight:700;font-size:13px;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tipchip[hidden]{display:none}

    /* ---- dock ---- */
    .dock{position:relative;z-index:5;flex:none;margin-top:-20px;background:var(--sheet);border-radius:26px 26px 0 0;box-shadow:0 -10px 34px rgba(10,35,30,.14);padding:12px 0 calc(12px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:8px}
    .finds{display:flex;gap:8px;align-items:center;min-height:46px;padding:0 14px;overflow-x:auto;scrollbar-width:none}
    .finds::-webkit-scrollbar{display:none}
    .prompt{display:flex;align-items:center;gap:9px;color:var(--mute);font-weight:600;font-size:15px}
    .prompt .ic{color:var(--ac);animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{50%{transform:scale(1.25);opacity:.6}}
    .find.in{background:var(--ac);border-color:var(--ac);color:var(--acink)}
    .find.in i,.find.in .fx{color:var(--acink);opacity:.85}
    .find{flex:none;display:inline-flex;align-items:center;background:var(--acsoft);border:1px solid var(--acline);border-radius:16px;min-height:46px}
    .fbody{border:0;background:none;text-align:left;padding:4px 4px 4px 13px;display:flex;flex-direction:column;justify-content:center;max-width:210px;min-height:44px}
    .fbody b{font-size:14px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fbody i{font-style:normal;font-size:12px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fx{width:36px;height:44px;border:0;background:none;color:var(--mute);display:grid;place-items:center;padding:0}
    .addons{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 14px}
    .add{min-height:52px;border-radius:16px;border:1px solid var(--line);background:var(--sheet);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 2px;color:var(--mute);font-weight:700;font-size:11.5px;min-width:0}
    .add .t{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .add[data-set="true"]{background:var(--acsoft);border-color:var(--acline);color:var(--ink)}
    .add[data-set="true"] .ic{color:var(--ac)}
    .go{margin:0 14px;min-height:52px;border:0;border-radius:18px;background:var(--ac);color:var(--acink);font-weight:800;font-size:16.5px;display:flex;align-items:center;justify-content:center;gap:9px}
    .go:disabled{background:var(--line);color:var(--mute);cursor:default}
    .comp{margin:0 12px;display:flex;gap:8px;align-items:flex-end;border:1px solid var(--line);border-radius:24px;padding:6px 6px 6px 16px;background:var(--sheet)}
    .comp:focus-within{border-color:var(--ac)}
    .comp textarea{flex:1;border:0;outline:0;background:none;color:inherit;font:inherit;font-size:16px;resize:none;max-height:96px;min-height:24px;padding:8px 0}
    .comp .go{margin:0;width:44px;min-height:44px;height:44px;border-radius:50%;flex:none}
    .chip{touch-action:manipulation;user-select:none;-webkit-user-select:none}

    /* ---- sheet ---- */
    .sheet{position:absolute;z-index:7;left:0;right:0;bottom:0;max-height:86%;display:flex;flex-direction:column;background:var(--sheet);border-radius:26px 26px 0 0;box-shadow:0 -12px 40px rgba(10,35,30,.25);
      padding:0 14px calc(14px + env(safe-area-inset-bottom,0px));transform:translateY(106%);visibility:hidden;transition:transform .22s ease,visibility 0s .22s}
    .sheet.top{bottom:auto;top:0;border-radius:0 0 26px 26px;padding:calc(6px + env(safe-area-inset-top,0px)) 14px 14px;transform:translateY(-106%)}
    .sheet.open{transform:none;visibility:visible;transition:transform .22s ease}
    .grab{width:38px;height:4px;border-radius:4px;background:var(--line);margin:8px auto 0;flex:none}
    .sheet.top .grab{display:none}
    .sh-head{display:flex;align-items:center;gap:6px;min-height:50px;flex:none}
    .sh-title{flex:1;margin:0;font-size:18px;font-weight:800;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .txt{min-height:40px;padding:0 10px;border:0;background:none;font-weight:800;font-size:14.5px;color:var(--ac);border-radius:10px}
    .txt.danger{color:var(--danger)}
    .txt.back{padding:0 6px 0 0;display:flex;align-items:center;color:var(--mute)}
    .txt[hidden]{display:none}
    .sh-body{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    .panel{display:none}
    .sheet[data-p="feel"] .p-feel,.sheet[data-p="strength"] .p-strength,.sheet[data-p="started"] .p-started,.sheet[data-p="inside"] .p-inside,.sheet[data-p="note"] .p-note,.sheet[data-p="info"] .p-info{display:block}
    .chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:8px}
    .chip{min-height:46px;padding:0 2px;border-radius:15px;border:1.5px solid var(--line);background:var(--sheet);font-weight:700;font-size:14px;white-space:nowrap}
    .chip[aria-pressed="true"]{background:var(--ac);border-color:var(--ac);color:var(--acink)}
    .chips.wide{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
    .chips.wide .chip{min-height:50px;text-align:left;padding:6px 12px;font-size:14px;line-height:1.25;white-space:normal}
    .chips.list{grid-template-columns:1fr 1fr}
    .sev-read{display:flex;align-items:baseline;gap:10px;margin:2px 0 10px}
    .sev-read b{font-size:34px;line-height:1;letter-spacing:-.02em}
    .sev-read span{color:var(--mute);font-weight:700}
    .bars{display:grid;grid-template-columns:repeat(10,1fr);gap:5px;align-items:end;height:84px}
    .bar{border:0;border-radius:8px;padding:0;background:var(--line);height:calc(26px + var(--i)*5.8px);position:relative;transition:background .12s}
    .bar[data-on="true"]{background:hsl(calc(150 - var(--i)*14.5) 62% 46%)}
    .bar[aria-pressed="true"]::after{content:"";position:absolute;left:50%;bottom:-9px;width:6px;height:6px;border-radius:50%;background:var(--ink);transform:translateX(-50%)}
    .scale{display:flex;justify-content:space-between;color:var(--mute);font-size:12px;font-weight:700;margin-top:14px}
    .in-hint{margin:0 0 10px;color:var(--mute);font-weight:600;font-size:14px}
    .sysgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .sys{position:relative;min-height:90px;padding:8px 4px 7px;border-radius:18px;border:1.5px solid var(--line);background:var(--sheet);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;text-align:center}
    .sys .ic{color:var(--ac);margin-bottom:3px}
    .sys b{font-size:13.5px;line-height:1.15}
    .sys i{font-style:normal;font-size:11px;color:var(--mute);font-weight:600;line-height:1.2}
    .sys[data-n]{background:var(--acsoft);border-color:var(--acline)}
    .sys em{position:absolute;top:6px;right:6px;min-width:22px;height:22px;border-radius:11px;background:var(--ac);color:var(--acink);font-style:normal;font-size:12px;font-weight:800;display:grid;place-items:center;padding:0 6px}
    .p-info p{margin:4px 0 10px;color:var(--ink);font-size:15px}
    textarea{width:100%;min-height:120px;max-height:40vh;resize:none;padding:12px 14px;border:1.5px solid var(--line);border-radius:16px;background:var(--sheet);font-size:16px;line-height:1.4}
    textarea:focus{outline:none;border-color:var(--ac)}
    textarea::placeholder{color:var(--mute)}
    .link{border:0;background:none;color:var(--mute);font-weight:700;min-height:40px;margin-top:8px;padding:0 4px;text-decoration:underline;text-underline-offset:3px}
    .link[hidden]{display:none}

    .out{display:none;position:absolute;left:12px;right:12px;bottom:calc(200px + env(safe-area-inset-bottom,0px));z-index:9;max-height:40%;overflow:auto;margin:0;padding:12px;border-radius:14px;background:var(--ink);color:var(--sheet);font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap}
    .toast{position:absolute;z-index:9;left:50%;bottom:calc(200px + env(safe-area-inset-bottom,0px));transform:translate(-50%,6px);opacity:0;pointer-events:none;background:var(--ink);color:var(--sheet);padding:9px 18px;border-radius:999px;font-weight:700;font-size:14px;transition:opacity .15s,transform .15s}
    .toast.on{opacity:1;transform:translate(-50%,0)}
    .sos{display:none;position:absolute;inset:0;z-index:10;align-items:flex-end;background:rgba(5,20,16,.6)}
    .sos.show{display:flex}
    .sos .box{width:100%;display:flex;flex-direction:column;gap:10px;background:var(--sheet);border-radius:26px 26px 0 0;padding:20px 16px calc(16px + env(safe-area-inset-bottom,0px))}
    .sos h2{margin:0;color:var(--danger);font-size:21px}
    .sos p{margin:0;color:var(--mute)}
    .big{min-height:54px;border-radius:16px;border:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16.5px;text-decoration:none}
    .big.call{background:var(--danger);color:#fff}
    .big.alert{background:transparent;border:2px solid var(--danger);color:var(--danger)}
    .big.plain{background:var(--s1);color:var(--ink)}
    .msg{min-height:18px;font-size:13px}
    /* ---- 0.13 additions ---- */
    .hintchip{position:absolute;z-index:2;left:50%;bottom:34px;transform:translateX(-50%);padding:8px 16px;border-radius:999px;font-weight:700;font-size:13.5px;color:var(--ink);pointer-events:none;white-space:nowrap;animation:hintfloat 2.6s ease-in-out infinite}
    .hintchip[hidden]{display:none}
    @keyframes hintfloat{50%{transform:translateX(-50%) translateY(-5px)}}
    .finds{padding:0 12px;min-height:0}
    .finds[hidden]{display:none}
    .find{min-height:38px;border-radius:14px}
    .fbody{min-height:36px;padding:2px 2px 2px 12px;max-width:190px}
    .fbody b{font-size:13.5px}.fbody i{font-size:11.5px}
    .fx{width:32px;height:36px}
    .fx:hover{color:var(--danger)}
    .closebtn{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:var(--s1);color:var(--ink);display:grid;place-items:center;padding:0;transition:background .15s,transform .12s}
    .closebtn:hover{background:var(--acsoft)}
    .closebtn:active{transform:scale(.92)}
    .feel-hint{margin:0 0 10px;color:var(--mute);font-weight:600;font-size:13.5px}
    .chip,.sys,.add,.find .fbody{transition:transform .1s,background .15s,border-color .15s}
    .chip:active,.sys:active{transform:scale(.96)}
    .chip[aria-pressed="true"]::before{content:"✓ ";font-weight:800}
    .sys:hover{border-color:var(--acline)}
    .comp{box-shadow:0 1px 0 rgba(10,35,30,.04);transition:border-color .15s,box-shadow .15s}
    .comp:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 22%,transparent)}
    .go{transition:transform .1s,background .15s}
    .go:not(:disabled):active{transform:scale(.92)}
    .go.busy{pointer-events:none}
    .go.busy svg{display:none}
    .go.busy::after{content:"";width:18px;height:18px;border-radius:50%;border:2.5px solid color-mix(in srgb,var(--acink) 35%,transparent);border-top-color:var(--acink);animation:spin .8s linear infinite}
    .toast.err{background:var(--danger);color:#fff}
    @media(max-width:370px){.who button{padding:0 10px;font-size:13px}.sosbtn{padding:0 13px}.go{font-size:15.5px}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
    /* ---- 0.14 look & feel: matches the result screens (appearance only, no behaviour) ---- */
    .stage::before,.stage::after{content:"";position:absolute;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--ac) 22%,transparent);pointer-events:none}
    .stage::before{width:320px;height:320px;left:50%;top:46%;transform:translate(-50%,-50%)}
    .stage::after{width:210px;height:210px;left:50%;top:46%;transform:translate(-50%,-50%);border-color:color-mix(in srgb,var(--ac) 14%,transparent)}
    .stage{background:radial-gradient(90% 60% at 50% 42%,color-mix(in srgb,var(--ac) 14%,var(--s1)),var(--s2))}
    .who{box-shadow:0 6px 18px -8px rgba(10,50,44,.35)}
    .who button[aria-pressed="true"]{background:linear-gradient(160deg,var(--ac),color-mix(in srgb,var(--ac) 68%,#000));color:var(--acink);box-shadow:0 4px 12px color-mix(in srgb,var(--ac) 40%,transparent)}
    .roundbtn{box-shadow:0 6px 18px -8px rgba(10,50,44,.35)}
    .turnbtn{box-shadow:0 6px 18px -8px rgba(10,50,44,.35)}
    .hintchip{display:flex;align-items:center;gap:8px;box-shadow:0 10px 24px -10px rgba(10,50,44,.4)}
    .hintchip::before{content:"";flex:none;width:9px;height:9px;border-radius:50%;background:var(--ac);box-shadow:0 0 0 4px color-mix(in srgb,var(--ac) 25%,transparent)}
    .dock{margin-top:-24px;border-radius:28px 28px 0 0;padding-top:16px;box-shadow:0 -14px 36px rgba(10,50,44,.16)}
    .dock::before{content:"";position:absolute;top:6px;left:50%;width:38px;height:4px;border-radius:4px;background:var(--line);transform:translateX(-50%)}
    .comp{border-width:1.5px;border-color:var(--acline);background:var(--s1);box-shadow:0 8px 20px -12px rgba(10,50,44,.45)}
    .comp:focus-within{background:var(--sheet)}
    .comp textarea::placeholder{font-size:13px;font-weight:600;letter-spacing:-.01em}
    @media(max-width:380px){.comp textarea::placeholder{font-size:11.5px}}
    .comp .go:not(:disabled){background:linear-gradient(160deg,var(--ac),color-mix(in srgb,var(--ac) 68%,#000));box-shadow:0 6px 14px color-mix(in srgb,var(--ac) 40%,transparent)}
    .go{box-shadow:0 8px 20px -8px color-mix(in srgb,var(--ac) 55%,transparent)}
    .go:disabled{box-shadow:none}
    .find{box-shadow:0 4px 12px -6px rgba(10,50,44,.35)}
    .add{background:var(--s1)}
    .add[data-set="true"]{background:var(--acsoft)}
    .sheet{box-shadow:0 -16px 44px rgba(10,50,44,.28)}
    .sh-title{font-size:19px;letter-spacing:-.01em}
    .chip,.sys{box-shadow:0 2px 0 color-mix(in srgb,var(--line) 70%,transparent)}
    .chip[aria-pressed="true"],.sys[data-n]{box-shadow:none}
    .sys{background:var(--s1)}
    .sys .ic{padding:7px;box-sizing:content-box;border-radius:50%;background:var(--acsoft)}
    .sys[data-n] .ic{background:var(--sheet)}
    .sheet.top{background:var(--sheet)}
    ${SVG_CSS}`;

  if (typeof customElements !== "undefined" && typeof HTMLElement !== "undefined") {
    class HealthBodySelector extends HTMLElement {
      static get observedAttributes() { return ["renderer", "three-src", "submit-label", "show-output", "single-select", "emergency-number", "layer", "figure", "model-src", "model-src-female", "model-src-male", "model-rotate", "model-pose", "model-pose-female", "model-pose-male", "model-debug"]; }
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.sex = "male"; this.mode = "external"; this.view = "front"; this.az = 0;
        this.ents = []; this.areas = new Map();        // id -> { id, syms:Set, view }
        this.inside = new Set();       // ids from INSIDE
        this.severity = null; this.duration = ""; this.note = "";
        this.panel = ""; this.openArea = null; this.insideTab = ""; this.el = 0; this.hover = null; this.sides = "";
        this.viewer = null; this.fallback = false; this.fallbackReason = ""; this.loading = true; this.modelKey = ""; this.pendingInit = false; this.photos = {};
        this._built = false; this._t = {};
        this.glbs = {}; this.glbUrl = {}; this.glbRev = 0; this._bad = new WeakSet(); this._failedUrl = {}; this._custom = false;
      }
      connectedCallback() {
        if (!this._built) this.build();
        if (this.viewer) this.viewer.resume(); else this.initViewer();
        this.watchKeyboard();
      }
      disconnectedCallback() { if (this.viewer) this.viewer.pause(); this.unwatchKeyboard(); }
      attributeChangedCallback(name) {
        if (!this._built) return;
        if (name === "emergency-number") this.renderSos();
        else if (name === "submit-label") this.renderDock();
        else if (name === "layer") { const l = this.getAttribute("layer"); if (LAYERS.includes(l) && l !== this.mode) { this.mode = l; this.afterModelChange(); } }
        else if (name === "figure") { this.applyFigure(); this.modelKey = ""; this.afterModelChange(); }
        else if (name.startsWith("model-")) this.reloadModel();
      }
      get single() { return this.hasAttribute("single-select"); }
      get emergencyNumber() { return (this.getAttribute("emergency-number") || "999").replace(/[^\d+*#]/g, ""); }
      get skin() { return "natural"; }
      applyFigure() { FIGURE.face = FIGURE.hair = this.getAttribute("figure") !== "clinical"; }
      /** Optional photo slot for the 2D fallback (kept for backward compatibility) */
      setFigureImages(map) { Object.keys(map || {}).forEach(sx => Object.keys(map[sx] || {}).forEach(v => { this.photos[`${sx}-${v}`] = map[sx][v]; })); if (this._built && this.fallback) this.renderStage(); }

      /* ---------- your own 3D model (.glb) ---------- */
      /** Use your own model. src = URL | File | Blob | ArrayBuffer;  sex = "female" | "male" | "all" (default). Resolves true when it is on screen. */
      async loadModel(src, sex) {
        const slot = sex === "female" || sex === "male" ? sex : "all";
        if (src == null) { delete this.glbs[slot]; delete this.glbUrl[slot]; }
        else { try { this.glbs[slot] = await this._toBuffer(src); delete this.glbUrl[slot]; } catch (e) { console.error("[care-anatomy] could not read the model:", e); if (this._built) this.toast("Could not read that file"); return false; } }
        await this.reloadModel(); return this._custom;
      }
      async _toBuffer(src) {
        if (src instanceof ArrayBuffer) return src;
        if (typeof src === "string") { const r = await fetch(src); if (!r.ok) throw new Error(`HTTP ${r.status} for ${src}`); return r.arrayBuffer(); }
        if (src && src.arrayBuffer) return src.arrayBuffer();
        throw new Error("Unsupported model source");
      }
      async glbFor(sex) {
        for (const slot of [sex, "all"]) {
          const attr = slot === "all" ? "model-src" : "model-src-" + slot, url = this.getAttribute(attr);
          if (url && this.glbUrl[slot] !== url && !this._failedUrl[url]) {
            try {
              this.glbs[slot] = await this._toBuffer(url);
              this.glbUrl[slot] = url;
            } catch (e) {
              this._failedUrl[url] = true;
              // The two supplied models are also bundled as base64. This fallback
              // works when the demo is opened from file://, when a host forgets
              // to publish /models, or when relative asset URLs are rewritten.
              const embedded = globalThis.CARE_ANATOMY_EMBEDDED_GLB && globalThis.CARE_ANATOMY_EMBEDDED_GLB[slot];
              if (embedded) {
                try {
                  const raw = atob(embedded), bytes = new Uint8Array(raw.length);
                  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                  this.glbs[slot] = bytes.buffer;
                  this.glbUrl[slot] = url;
                  console.info(`[care-anatomy] loaded bundled ${slot} model after URL fetch failed`);
                } catch (decodeError) {
                  console.error(`[care-anatomy] bundled ${slot} model could not be decoded`, decodeError);
                }
              }
              if (!this.glbs[slot]) {
                console.warn("[care-anatomy] could not load model", url, e);
                if (this._built) this.toast("Could not load the 3D model file");
              }
            }
          }
          if (!url && this.glbUrl[slot]) { delete this.glbs[slot]; delete this.glbUrl[slot]; }
          const b = this.glbs[slot]; if (b && !this._bad.has(b)) return b;
        }
        return null;
      }
      async reloadModel() { this.glbRev++; this.modelKey = ""; await this.syncModel(); }

      /* ---------- build ---------- */
      build() {
        this._built = true; this.applyFigure();
        const l0 = this.getAttribute("layer"); if (LAYERS.includes(l0)) this.mode = l0;
        this.shadowRoot.innerHTML = `<style>${CSS}</style>
        <div class="app">
          <div class="stage">
            <div class="canvas"></div>
            <div class="hud">
              <div class="who glass" role="group" aria-label="Body type"></div><span class="sp"></span>
              <button type="button" class="roundbtn glass" data-act="info" aria-label="Safety note">${icon("info", 22)}</button>
              <button type="button" class="sosbtn" data-act="sos" aria-label="Emergency">SOS</button>
            </div>
            <div class="rail" role="group" aria-label="Body view"></div>
            <span class="side l" aria-hidden="true"></span><span class="side r" aria-hidden="true"></span>
            <div class="tipchip glass" hidden></div>
            <div class="hintchip glass" role="note">Tap the body where it hurts</div>
            <div class="loading"><div class="spinner" role="status" aria-label="Loading"></div></div>
          </div>
          <div class="dock">
            <div class="finds" hidden aria-label="Selected areas"></div>
            <div class="comp"><textarea rows="1" maxlength="2000" placeholder="Describe your symptoms, or tap the body…" aria-label="Describe your symptoms"></textarea><button type="button" class="go" data-act="go" aria-label="Send" disabled>${icon("arrow", 20)}</button></div>
          </div>
          <div class="sheet" role="dialog" aria-modal="false">
            <div class="grab"></div>
            <div class="sh-head"><button type="button" class="txt back" data-act="inback" hidden aria-label="Back to all areas">${icon("back", 20)}All</button><h2 class="sh-title"></h2><button type="button" class="closebtn" data-act="closesheet" aria-label="Close">${icon("x", 20)}</button></div>
            <div class="sh-body">
              <div class="panel p-feel"><p class="feel-hint">How does it feel? Tap to select, tap again to remove.</p><div class="chips">${SYMPTOMS.map(s => `<button type="button" class="chip" data-act="sym" data-v="${s}" aria-pressed="false">${s}</button>`).join("")}</div></div>
              <div class="panel p-strength">
                <div class="sev-read"><b class="sn">–</b><span class="sl">Tap a bar</span></div>
                <div class="bars">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button type="button" class="bar" style="--i:${n - 1}" data-act="sev" data-v="${n}" aria-label="${n} out of 10" aria-pressed="false" data-on="false"></button>`).join("")}</div>
                <div class="scale"><span>Mild</span><span>Severe</span></div>
                <button type="button" class="link" data-act="sevclear" hidden>Not sure</button>
              </div>
              <div class="panel p-started"><div class="chips wide">${DURATIONS.map(d => `<button type="button" class="chip" data-act="dur" data-v="${d}" aria-pressed="false">${d}</button>`).join("")}</div></div>
              <div class="panel p-inside"><div class="in-home"><p class="in-hint">Tap what fits. No need to know organ names.</p><div class="sysgrid"></div></div><div class="chips wide inchips" hidden></div></div>
              <div class="panel p-info"><p>${INFO_TEXT}</p></div>
            </div>
          </div>
          <pre class="out" role="status"></pre><div class="toast" role="status"></div>
          <div class="sos"><div class="box" role="dialog" aria-modal="true" aria-label="Emergency">
            <h2>Emergency</h2><p>If you or someone near you is in danger, call now.</p>
            <a class="big call" data-act="call"></a>
            <button type="button" class="big alert" data-act="alert">Send emergency alert</button>
            <p class="msg" role="status"></p>
            <button type="button" class="big plain" data-act="sosclose">Close</button>
          </div></div>
        </div>`;
        const $ = s => this.shadowRoot.querySelector(s);
        this.$ = { app: $(".app"), stage: $(".stage"), canvas: $(".canvas"), who: $(".who"), rail: $(".rail"), sideL: $(".side.l"), sideR: $(".side.r"), tip: $(".tipchip"), hint: $(".hintchip"), finds: $(".finds"),
          loading: $(".loading"), dock: $(".dock"), go: $(".go"), sheet: $(".sheet"), title: $(".sh-title"), body: $(".sh-body"),
          chips: [...this.shadowRoot.querySelectorAll("[data-act=sym]")], sn: $(".sn"), sl: $(".sl"), bars: [...this.shadowRoot.querySelectorAll(".bar")], sevClear: $("[data-act=sevclear]"),
          durs: [...this.shadowRoot.querySelectorAll("[data-act=dur]")], back: $("[data-act=inback]"), inhome: $(".in-home"), sysgrid: $(".sysgrid"), inchips: $(".inchips"), ta: $(".comp textarea"),
          out: $(".out"), toast: $(".toast"), sos: $(".sos"), call: $("[data-act=call]"), msg: $(".sos .msg") };
        const root = this.shadowRoot;
        root.addEventListener("click", e => { const t = e.target.closest("[data-act]"); if (t && !t.disabled) this.act(t.dataset.act, t.dataset.v); });
        root.addEventListener("pointerdown", e => { if (this.panel && !e.target.closest(".sheet,.dock,.sos,.hud,.rail")) this.closeSheet(); });
        root.addEventListener("keydown", e => { if (e.key === "Escape") { this.closeSheet(); this.closeSos(); } });
        this.$.out.addEventListener("click", () => { this.$.out.style.display = "none"; });
        this.$.ta.addEventListener("input", () => { this.syncFromText(); this.grow(); this.changed(); });
        this.$.ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.submit(); } });
        // 2D fallback: tap / hover on a region
        this.$.canvas.addEventListener("click", e => { const g = e.target.closest("[data-region]"); if (g) this.onTap(g.dataset.region, e.clientX, e.clientY); });
        this.$.canvas.addEventListener("pointerover", e => { if (e.pointerType !== "mouse") return; const g = e.target.closest("[data-region]"); this.setHover(g ? g.dataset.region : null); });
        this.$.canvas.addEventListener("pointerleave", () => this.setHover(null));
        this.renderSos(); this.renderAll();
      }

      /* ---------- actions ---------- */
      act(a, v) {
        switch (a) {
          case "sex":
            if (v !== this.sex) {
              this.sex = v; this.view = "front"; this.dropWrongSexInside();
              // A body-type switch starts from a known upright front view instead
              // of inheriting a prior free-orbit / upside-down camera angle.
              if (this.viewer) this.viewer.goTo("front", false);
              this.afterModelChange(); this.renderRail(); this.updateSides();
            }
            break;
          case "turn": this.gotoView(this.view === "front" ? "back" : "front"); break;
          case "open": if (this.panel === v) { this.closeSheet(); break; } if (v === "inside") this.insideTab = ""; this.openSheet(v); break;
          case "closesheet": this.closeSheet(); break;
          case "editarea": if (REG[v]) { this.openArea = v; this.openSheet("feel"); } break;
          case "rmarea": this.deselect(v); break;
          case "rminside": this.unpick("inchip", v); break;
          case "info": this.openSheet("info"); break;
          case "sym": this.toggle("sym", v); break;
          case "sev": this.severity = this.severity === Number(v) ? null : Number(v); this.changed(); break;
          case "sevclear": this.severity = null; this.changed(); break;
          case "dur": this.duration = this.duration === v ? "" : v; this.changed(); if (this.duration) setTimeout(() => { if (this.panel === "started") this.closeSheet(); }, 220); break;
          case "intab": this.insideTab = v; this.renderSheet(); this.$.body.scrollTop = 0; break;
          case "inback": this.insideTab = ""; this.renderSheet(); break;
                    case "inchip": this.toggle("inchip", v); break;
          case "go": this.submit(); break;
          case "sos": this.openSos(); break;
          case "sosclose": this.closeSos(); break;
          case "alert": this.sendAlert(); break;
        }
      }
      gotoView(v) {
        if (this.viewDisabled(v)) return;
        this.closeSheet(); this.view = v;
        if (this.viewer) this.viewer.goTo(v); else this.renderStage();
        this.renderRail(); this.updateSides();
      }
      viewDisabled(k) { return !this.viewer && this.mode === "internal" && (k === "back" || k === "hands" || k === "feet"); }
      afterModelChange() {
        if (this.viewer) this.syncModel(); else this.renderStage();
        this.renderAll(); this.emitChange();
      }
      dropWrongSexInside() { [...this.inside].forEach(id => { const g = INSIDE_ITEM.get(id).group; if (g.sex && g.sex !== this.sex) this.inside.delete(id); }); if (!insideGroups(this.sex).some(g => g.id === this.insideTab)) this.insideTab = ""; }

      /* ---------- sheet ---------- */
      openSheet(panel, y) {
        this.panel = panel;
        const sh = this.$.sheet;
        sh.dataset.p = panel;
        let top = false;           // keep the symptom sheet off the part the finger just tapped
        if (panel === "feel" && typeof y === "number") { const r = this.$.stage.getBoundingClientRect(); top = r.height > 0 && (y - r.top) / r.height > 0.56; }
        sh.classList.toggle("top", top); this.$.app.dataset.sheet = top ? "top" : "bottom";
        sh.style.bottom = top ? "" : this.$.dock.offsetHeight + "px";   // the sheet sits right above the text box, so the typed text stays visible
        this.renderSheet();
        requestAnimationFrame(() => sh.classList.add("open"));
        this.renderGoPill();
      }
      closeSheet() {
        if (!this.panel) return;
        this.pruneOpen();
        this.panel = ""; this.openArea = null; this.$.sheet.classList.remove("open"); delete this.$.app.dataset.sheet;
        if (this.shadowRoot.activeElement === this.$.ta) this.$.ta.blur();
        this.changed();
      }
      renderSheet() {
        const p = this.panel; if (!p) return;
        const titles = { feel: this.openArea ? spoken(this.openArea) : "", strength: "How strong is it?", started: "When did it start?", inside: "Inside the body", note: "Anything else?", info: "Good to know" };
        this.$.title.textContent = titles[p] || "";
        if (p === "feel") { const a = this.areas.get(this.openArea); this.$.chips.forEach(c => c.setAttribute("aria-pressed", String(!!a && a.syms.has(c.dataset.v)))); }
        if (p === "strength") {
          const n = this.severity;
          this.$.sn.textContent = n == null ? "–" : `${n}/10`; this.$.sl.textContent = n == null ? "Tap a bar" : sevWord(n);
          this.$.bars.forEach((b, i) => { b.dataset.on = String(n != null && i < n); b.setAttribute("aria-pressed", String(n === i + 1)); });
          this.$.sevClear.hidden = n == null;
        }
        if (p === "started") this.$.durs.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === this.duration)));
        if (p === "inside") {
          const groups = insideGroups(this.sex), g = groups.find(x => x.id === this.insideTab), home = !g;
          this.$.back.hidden = home; this.$.inhome.hidden = !home; this.$.inchips.hidden = home;
          if (g) this.$.title.textContent = g.label;
          this.$.sysgrid.innerHTML = groups.map(x => { const n = x.items.filter(i => this.inside.has(i[0])).length; return `<button type="button" class="sys" data-act="intab" data-v="${x.id}"${n ? ` data-n="${n}"` : ""}>${n ? `<em>${n}</em>` : ""}${icon(x.ic, 28)}<b>${x.label}</b><i>${x.sub}</i></button>`; }).join("");
          if (g) this.$.inchips.innerHTML = g.items.map(i => `<button type="button" class="chip" data-act="inchip" data-v="${i[0]}" aria-pressed="${this.inside.has(i[0])}">${i[1]}</button>`).join("");
        } else this.$.back.hidden = true;
      }
      renderGoPill() { /* reserved for future use */ }

      /* ---------- selection ---------- */
      onTap(id, x, y) {
        if (!REG[id]) return;
        if (this.shadowRoot.activeElement === this.$.ta) this.$.ta.blur();
        // Tapping a part that is already selected re-opens it; the x on its chip removes it.
        if (this.areas.has(id)) { this.openArea = id; this.openSheet("feel", y); return; }
        // Several parts can be selected at once: a part stays selected until it is double-tapped.
        if (!this.areas.has(id)) { if (this.single) { this.areas.clear(); this.ents = this.ents.filter(e => e.k !== "a"); } this.areas.set(id, { id, syms: new Set(), view: this.view }); }
        this.openArea = id; this.openSheet("feel", y); this.changed();
      }
      /* Remove one body part completely: its highlight, its symptoms and the matching text in the box. */
      deselect(id) {
        const a = this.areas.get(id); if (!a) return;
        this.ents = this.ents.filter(e => {
          if (e.k === "a" && e.id === id) { this.$.ta.value = this.$.ta.value.replace(e.p, "").replace(/\s{2,}/g, " ").replace(/^\s+/, ""); return false; }
          return true;
        });
        this.areas.delete(id);
        if (this.openArea === id) {
          this.openArea = null; this.panel = ""; this.$.sheet.classList.remove("open"); delete this.$.app.dataset.sheet;
        }
        this.grow(); this.changed();
      }
      /* The text box is the single source of truth: every choice is written into it as "left knee pain;"
         and anything deleted from the text is un-selected again. One tap chooses, a double tap removes. */
      phrase(kind, v) { return kind === "sym" ? `${lc(spoken(this.openArea))} ${v.toLowerCase()};` : `${lc(INSIDE_ITEM.get(v).label)};`; }
      toggle(kind, v) {   // one tap chooses, tapping it again removes it
        const on = kind === "sym" ? !!(this.areas.get(this.openArea) && this.areas.get(this.openArea).syms.has(v)) : this.inside.has(v);
        if (on) this.unpick(kind, v); else this.pick(kind, v);
      }
      pick(kind, v) {
        const ta = this.$.ta;
        if (kind === "sym") { const a = this.areas.get(this.openArea); if (!a || a.syms.has(v)) return; a.syms.add(v); this.ents.push({ k: "a", id: this.openArea, v, p: this.phrase(kind, v) }); }
        else { if (this.inside.has(v)) return; this.inside.add(v); this.ents.push({ k: "i", v, p: this.phrase(kind, v) }); }
        const e = this.ents[this.ents.length - 1];
        ta.value = (ta.value.trim() ? ta.value.trim() + " " : "") + e.p; this.grow(); this.changed();
      }
      unpick(kind, v) {
        const i = this.ents.findIndex(e => kind === "sym" ? e.k === "a" && e.id === this.openArea && e.v === v : e.k === "i" && e.v === v);
        if (i < 0) return;
        const e = this.ents.splice(i, 1)[0];
        if (e.k === "a") { const a = this.areas.get(e.id); if (a) a.syms.delete(e.v); } else this.inside.delete(e.v);
        this.$.ta.value = this.$.ta.value.replace(e.p, "").replace(/\s{2,}/g, " ").replace(/^\s+/, ""); this.grow(); this.changed();
      }
      syncFromText() {
        const t = this.$.ta.value.toLowerCase();
        this.ents = this.ents.filter(e => {
          if (t.includes(e.p)) return true;
          if (e.k === "a") { const a = this.areas.get(e.id); if (a) a.syms.delete(e.v); } else this.inside.delete(e.v);
          return false;
        });
        this.note = this.$.ta.value;
      }
      pruneOpen() { /* selected parts are kept even without a symptom; double tap removes them */ }
      grow() { const ta = this.$.ta; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 96) + "px"; this.note = ta.value; }
      typedOnly() { let t = this.$.ta ? this.$.ta.value : ""; this.ents.forEach(e => { t = t.replace(e.p, ""); }); return t.replace(/\s{2,}/g, " ").trim(); }
      
      changed() { this.syncScene(); this.renderDock(); this.renderRail(); if (this.panel) this.renderSheet(); this.emitChange(); }
      groupOn() { const s = new Set(); this.areas.forEach((_, id) => (GROUPS[id] || []).forEach(m => s.add(m))); return s; }
      syncScene() {
        if (this.viewer) this.viewer.setSelection(this.areas.keys(), this.groupOn());
        else if (this.fallback) this.renderStage();
      }
      reset() {
        this.areas.clear(); this.inside.clear(); this.ents = []; this.severity = null; this.duration = ""; this.note = ""; this.openArea = null;
        if (this._built) { this.$.ta.value = ""; this.grow(); this.closeSheet(); if (this.viewer) this.viewer.goTo("front"); }
        this.view = "front"; this.changed();
      }

      /* ---------- rendering ---------- */
      renderAll() { this.renderWho(); this.renderRail(); this.renderDock(); this.renderStage(); this.updateSides(); if (this.panel) this.renderSheet(); }
      renderWho() {
        this.$.who.innerHTML = [["male", "Male"], ["female", "Female"]].map(([k, l]) => `<button type="button" data-act="sex" data-v="${k}" aria-pressed="${this.sex === k}">${l}</button>`).join("");
      }
      renderRail() {
        const R = this.$.rail, n = this.inside.size;
        let btn = R.querySelector(".insidebtn");
        if (!btn) {
          R.innerHTML = `<button type="button" class="insidebtn" data-act="open" data-v="inside" aria-label="Inside the body: organs and bones">${icon("organs", 28)}<b>Inside</b><i>organs &amp; bones</i></button>`
            + `<button type="button" class="turnbtn glass" data-act="turn" aria-label="Turn the body around">${icon("turn", 22)}<span>Turn</span></button>`;
          btn = R.querySelector(".insidebtn");
        }
        let em = btn.querySelector("em");
        if (n) { if (!em) { em = document.createElement("em"); btn.prepend(em); } em.textContent = n; } else if (em) em.remove();
        R.querySelector(".turnbtn").disabled = this.viewDisabled("back");
      }
      renderDock() {
        const $ = this.$;
        $.go.disabled = !!this._sending || !$.ta.value.trim(); $.go.classList.toggle("busy", !!this._sending);
        this.renderFinds();
        $.hint.hidden = this.areas.size > 0 || this.inside.size > 0 || !!$.ta.value.trim();
      }
      renderFinds() {
        const F = this.$.finds, items = [];
        this.areas.forEach(a => items.push(`<span class="find"><button type="button" class="fbody" data-act="editarea" data-v="${a.id}"><b>${spoken(a.id)}</b><i>${a.syms.size ? [...a.syms].join(", ") : "Tap to choose"}</i></button><button type="button" class="fx" data-act="rmarea" data-v="${a.id}" aria-label="Remove ${spoken(a.id)}">${icon("x", 16)}</button></span>`));
        this.inside.forEach(id => { const i = INSIDE_ITEM.get(id); items.push(`<span class="find"><button type="button" class="fbody" data-act="open" data-v="inside"><b>${i.label}</b><i>Inside · ${i.group.label}</i></button><button type="button" class="fx" data-act="rminside" data-v="${id}" aria-label="Remove ${i.label}">${icon("x", 16)}</button></span>`); });
        const html = items.join("");
        if (F._html !== html) { F._html = html; F.innerHTML = html; }
        F.hidden = !items.length;
      }
      setHover(id) { if (id === this.hover) return; this.hover = id; const t = this.$.tip; t.hidden = !id; t.textContent = id ? spoken(id) : ""; }
      updateSides() {
        let m;
        if (this.viewer) { const c = Math.cos(this.az); m = Math.cos(this.el) < 0.5 ? "" : c > 0.45 ? "front" : c < -0.45 ? "back" : ""; }
        else m = this.view === "back" ? "back" : (this.view === "hands" || this.view === "feet") ? "" : "front";
        if (m === this.sides) return; this.sides = m;
        this.$.sideL.textContent = m === "front" ? "R" : m === "back" ? "L" : "";
        this.$.sideR.textContent = m === "front" ? "L" : m === "back" ? "R" : "";
      }
      renderStage() {
        const st = this.$.canvas;
        if (this.viewer) {
          if (this.viewer.dom.parentNode !== st) { st.textContent = ""; st.appendChild(this.viewer.dom); }
          this.$.loading.style.display = this.loading ? "grid" : "none"; return;
        }
        if (!this.fallback) return;
        this.$.loading.style.display = "none";
        const photo = this.photos[`${this.sex}-${this.view === "back" ? "back" : "front"}`] || "";
        const m = buildSVG({ sex: this.sex, mode: this.mode, view: this.view, selected: new Set(this.areas.keys()), groupOn: this.groupOn(), skin: this.skin, photo });
        st.innerHTML = `<div class="svgwrap">${m.svg}</div>`;
      }

      /* ---------- 3D viewer ---------- */
      async initViewer() {
        if (this.pendingInit || this.viewer || this.fallback) return;
        this.pendingInit = true;
        await new Promise(r => setTimeout(r, 0));   // lets the host call CareAnatomy.useThree(THREE) first
        try {
          if (this.getAttribute("renderer") === "2d") throw new Error("2D renderer requested");
          const probe = document.createElement("canvas");
          if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("WebGL is not available");
          const THREE = await loadThree(this.getAttribute("three-src"));
          this.viewer = createViewer(THREE, {
            onPick: (id, x, y) => this.onTap(id, x, y),
            onHover: id => this.setHover(id && REG[id] ? id : null),
            onView: (name, az) => { this.view = name; this.az = az; this.updateSides(); },
            onTurn: (az, el) => { this.az = az; this.el = el; this.updateSides(); },
            onLoading: v => { this.loading = v; this.$.loading.style.display = v ? "grid" : "none"; }
          });
          this.viewer.setReserve(64, 34);   // room for the floating controls on top and the dock below
          this.renderStage(); this.renderRail();
          await this.syncModel();
        } catch (err) { this.useFallback(err); }
        this.pendingInit = false;
      }
      useFallback(err) {
        this.fallback = true; this.fallbackReason = String(err && err.message || err); this.viewer = null; this.loading = false;
        this.renderAll();
      }
      async syncModel() {
        if (!this.viewer) return;
        const glb = this.mode === "external" ? await this.glbFor(this.sex) : null;
        const rot = this.getAttribute("model-rotate") || "";
        const pose = this.getAttribute("model-pose-" + this.sex) || this.getAttribute("model-pose") || "relaxed";
        const dbg = this.hasAttribute("model-debug");
        const key = [this.sex, this.mode, this.skin, glb ? this.glbRev : 0, glb ? rot + pose + dbg : ""].join("|");
        if (key === this.modelKey) return;
        this.modelKey = key;
        const opts = { sex: this.sex, mode: this.mode, skin: this.skin, glb, rotateY: Number(rot) || 0, pose, debug: dbg };
        try { await this.viewer.setModel(opts); this._custom = !!glb; }
        catch (err) {
          if (!glb) { this.useFallback(err); return; }
          console.error("[care-anatomy] could not use your 3D model, showing the built-in body instead:", err);
          this._bad.add(glb); this._custom = false; this.toast("Could not use that 3D model");
          try { await this.viewer.setModel({ ...opts, glb: null }); } catch (e2) { this.useFallback(e2); return; }
        }
        this.syncScene();
      }

      /* ---------- keyboard-aware height (phones) ---------- */
      watchKeyboard() {
        const vv = typeof window !== "undefined" && window.visualViewport; if (!vv || this._vv) return;
        this._vv = () => {
          const open = window.innerHeight - vv.height > 120;
          if (open) { this.style.height = vv.height + "px"; this.style.transform = `translateY(${vv.offsetTop}px)`; }
          else { this.style.removeProperty("height"); this.style.removeProperty("transform"); }
        };
        vv.addEventListener("resize", this._vv); vv.addEventListener("scroll", this._vv);
      }
      unwatchKeyboard() { const vv = typeof window !== "undefined" && window.visualViewport; if (vv && this._vv) { vv.removeEventListener("resize", this._vv); vv.removeEventListener("scroll", this._vv); } this._vv = null; }

      /* ---------- send / emergency ---------- */
      toast(text, ms, isErr) { const t = this.$.toast; t.textContent = text; t.classList.toggle("err", !!isErr); t.classList.add("on"); clearTimeout(this._t.toast); this._t.toast = setTimeout(() => t.classList.remove("on"), ms || 1600); }
      /** Host can set the two model services from code: el.setApiEndpoints({ modelApi, riskApi }) */
      setApiEndpoints(o) { this._api = Object.assign(this._api || {}, o || {}); }
      get apiConfig() { const a = this._api || {}; return { modelApi: a.modelApi || this.getAttribute("model-api") || "", riskApi: a.riskApi || this.getAttribute("risk-api") || "" }; }
      async submit() {
        const text = this.buildAIText(); if (!text || this._sending) return;
        this.closeSheet();
        const report = this.getReport();
        this.dispatchEvent(new CustomEvent("body-selection-submit", { bubbles: true, composed: true, detail: report }));
        const cfg = this.apiConfig;
        if (!cfg.modelApi && !cfg.riskApi) {            // no services configured: the host handles body-selection-submit itself
          if (this.hasAttribute("show-output")) this.showOut("Text sent to the AI:\n\n" + text, 7000); else this.toast("Sent");
          return;
        }
        this._sending = true; this.renderDock();
        let res;
        try { res = await analyze({ text, sex: this.sex, modelApi: cfg.modelApi, riskApi: cfg.riskApi }); }
        finally { this._sending = false; this.renderDock(); }
        this.dispatchEvent(new CustomEvent("care-analysis-result", { bubbles: true, composed: true, detail: Object.assign({ report }, res) }));
        if (this.hasAttribute("show-output")) this.showOut("Sent to the models:\n" + res.requests.map(r => `POST ${r.url}\n${JSON.stringify(r.body)}`).join("\n") + "\n\nResult:\n" + JSON.stringify({ predict: res.predict, risk: res.risk, errors: res.errors }, null, 2), 15000);
        if (res.ok) this.toast("Sent"); else this.toast("Could not reach the analysis service. Check your connection and tap send to try again.", 4200, true);
      }
      showOut(text, ms) { const o = this.$.out; o.textContent = text; o.style.display = "block"; clearTimeout(this._t.out); this._t.out = setTimeout(() => { o.style.display = "none"; }, ms); }
      renderSos() { const n = this.emergencyNumber; this.$.call.href = "tel:" + n; this.$.call.textContent = n ? `Call ${n}` : "Call emergency number"; }
      openSos() { this.closeSheet(); this.$.msg.textContent = ""; this.$.sos.classList.add("show"); this.$.call.focus(); }
      closeSos() { if (!this.$.sos.classList.contains("show")) return; this.$.sos.classList.remove("show"); this.shadowRoot.querySelector(".sosbtn").focus(); }
      sendAlert() {
        // The host app decides how an alert is delivered: it sets detail.handled = true (and optionally detail.message).
        const detail = { report: this.getReport(), handled: false, message: "" };
        this.dispatchEvent(new CustomEvent("care-emergency-alert", { bubbles: true, composed: true, detail }));
        this.$.msg.textContent = detail.handled ? (detail.message || "Emergency alert sent.") : `Alerts are not set up in this app. Please call ${this.emergencyNumber || "your local emergency number"}.`;
      }

      /* ---------- data out ---------- */
      buildAIText() { return this.$.ta ? this.$.ta.value.trim() : ""; }
      emitChange() { this.dispatchEvent(new CustomEvent("body-selection-change", { bubbles: true, composed: true, detail: this.getReport() })); }
      getReport() {
        const regions = [...this.areas.values()].map(a => {
          const f = REG[a.id], side = a.id.startsWith("left-") ? "left" : a.id.startsWith("right-") ? "right" : "unspecified";
          const o = { id: a.id, label: f.label, category: f.category, side, anatomyMode: f.layer, view: a.view, bodySystems: f.systems, symptoms: [...a.syms] };
          if (f.members) o.includes = f.members.slice();
          return o;
        });
        const concerns = [...this.inside].map(id => { const i = INSIDE_ITEM.get(id); return { id, label: i.label, group: i.group.label, bodySystems: i.systems, possibleOrgans: i.organs }; });
        const systems = [...new Set(regions.flatMap(r => r.bodySystems).concat(concerns.flatMap(c => c.bodySystems)))];
        const specialties = [...new Set(systems.flatMap(s => (SYSTEMS[s] || SYSTEMS.general).specialties))];
        return {
          schemaVersion: SCHEMA_VERSION, sdkVersion: VERSION, source: "care-anatomy-selector",
          anatomicalProfile: this.sex, anatomicalLayer: this.mode, bodyView: this.view,
          cameraAzimuthDeg: this.viewer ? this.viewer.azimuthDeg : null, cameraElevationDeg: this.viewer ? this.viewer.elevationDeg : null, renderer: this.viewer ? "webgl-3d" : "svg-2d", customModel: this._custom,
          sideConvention: "left/right are the patient's own left/right",
          selectedRegions: regions,
          internalConcerns: concerns,
          bodySystems: systems,
          routingHints: { note: "Hints for doctor/hospital search only — not a diagnosis. Review mapping with clinicians.", specialties },
          reportedSymptoms: [...new Set(regions.flatMap(r => r.symptoms))], onsetOrDuration: this.duration || null, severity: this.severity,
          additionalDetails: this.typedOnly() || null,
          aiPromptText: this.buildAIText(), generatedAt: new Date().toISOString(),
          disclaimer: "User-reported input only; not a diagnosis."
        };
      }
    }
    if (!customElements.get("health-body-selector")) customElements.define("health-body-selector", HealthBodySelector);
  }

  // Small public surface (handy for tests / server-side previews).
  const api = { version: VERSION, schemaVersion: SCHEMA_VERSION, regions: REG, layers: LIST, groups: GROUPS, systems: SYSTEMS, buildSVG, svgCss: SVG_CSS, skinTones: SKIN, build3D, buildGLB, prepareGLB, createViewer, loadThree, useThree, getMapper, inside: INSIDE, dominantTriangleLabel, buildRequests, analyze };
  (typeof globalThis !== "undefined" ? globalThis : window).CareAnatomy = api;
})();
