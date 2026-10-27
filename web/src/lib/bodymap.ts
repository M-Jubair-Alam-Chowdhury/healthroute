/** Body-map shapes & symptom list — ported 1:1 from Symptom-input-demo-1.html */
const E = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
const R = (cx: number, y: number, w: number, h: number) =>
  `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2.5}"/>`;

type Item = [string, string];
const P = (n: string, f: (s: number) => string, L: number): Item[] =>
  [-1, 1].map((s) => [(s === L ? "Left " : "Right ") + n, f(s)] as Item);

export type ViewKey = "front" | "back" | "head" | "hands" | "feet";

export const VIEWS: Record<ViewKey, { t: string; bg?: string; items: () => Item[] }> = {
  front: {
    t: "Front",
    items: () => [
      ["Head", E(100, 30, 20, 24)], ["Neck", R(100, 59, 16, 14)], ["Chest", R(100, 74, 64, 42)],
      ["Abdomen", R(100, 118, 56, 40)], ["Pelvis", R(100, 160, 60, 26)],
      ...P("shoulder", (s) => E(100 + s * 38, 78, 11, 10), 1),
      ...P("upper arm", (s) => R(100 + s * 52, 90, 16, 48), 1),
      ...P("forearm", (s) => R(100 + s * 58, 140, 15, 48), 1),
      ...P("hand", (s) => E(100 + s * 62, 206, 10, 15), 1),
      ...P("thigh", (s) => R(100 + s * 15, 190, 26, 68), 1),
      ...P("knee", (s) => E(100 + s * 15, 268, 13, 11), 1),
      ...P("shin", (s) => R(100 + s * 15, 282, 22, 62), 1),
      ...P("foot", (s) => E(100 + s * 15, 360, 14, 9), 1),
    ],
  },
  back: {
    t: "Back",
    items: () => [
      ["Back of head", E(100, 30, 20, 24)], ["Neck", R(100, 59, 16, 14)], ["Upper back", R(100, 74, 64, 42)],
      ["Lower back", R(100, 118, 56, 40)], ["Buttocks", R(100, 160, 60, 26)],
      ...P("shoulder", (s) => E(100 + s * 38, 78, 11, 10), -1),
      ...P("upper arm", (s) => R(100 + s * 52, 90, 16, 48), -1),
      ...P("forearm", (s) => R(100 + s * 58, 140, 15, 48), -1),
      ...P("hand", (s) => E(100 + s * 62, 206, 10, 15), -1),
      ...P("hamstring", (s) => R(100 + s * 15, 190, 26, 68), -1),
      ...P("knee", (s) => E(100 + s * 15, 268, 13, 11), -1),
      ...P("calf", (s) => R(100 + s * 15, 282, 22, 62), -1),
      ...P("heel", (s) => E(100 + s * 15, 360, 14, 9), -1),
    ],
  },
  head: {
    t: "Head",
    bg: '<ellipse class="bg" cx="100" cy="205" rx="74" ry="108"/>',
    items: () => [
      ["Scalp", E(100, 112, 56, 30)], ["Forehead", R(100, 142, 96, 30)], ["Nose", E(100, 235, 10, 24)],
      ["Mouth", E(100, 282, 22, 9)], ["Chin", E(100, 310, 20, 12)],
      ...P("eye", (s) => E(100 + s * 30, 196, 17, 9), 1),
      ...P("ear", (s) => E(100 + s * 76, 208, 9, 22), 1),
      ...P("cheek", (s) => E(100 + s * 42, 252, 20, 17), 1),
    ],
  },
  hands: {
    t: "Hands",
    items: () => [
      ...P("fingers", (s) => R(100 + s * 52, 110, 54, 62), 1),
      ...P("palm", (s) => E(100 + s * 52, 215, 30, 40), 1),
      ...P("thumb", (s) => E(100 + s * 14, 212, 9, 24), 1),
      ...P("wrist", (s) => R(100 + s * 52, 262, 30, 34), 1),
    ],
  },
  feet: {
    t: "Feet",
    items: () => [
      ...P("ankle", (s) => R(100 + s * 45, 140, 28, 56), 1),
      ...P("foot", (s) => E(100 + s * 45, 268, 30, 62), 1),
      ...P("toes", (s) => E(100 + s * 45, 344, 28, 16), 1),
      ...P("heel", (s) => E(100 + s * 45, 214, 16, 14), 1),
    ],
  },
};

export const SYM = ["Pain", "Aching", "Burning", "Numbness", "Tingling", "Itching", "Swelling", "Weakness", "Stiffness", "Rash", "Bleeding"];

/** SVG markup for the current view (regions highlighted when selected / pending). */
export function bodySvg(view: ViewKey, sex: "Female" | "Male", selected: string[], pend: string | null): string {
  const v = VIEWS[view];
  const tf = sex === "Male" && (view === "front" || view === "back") ? ' transform="translate(-6 0) scale(1.06 1)"' : "";
  const regions = v
    .items()
    .map(([l, sh]) => {
      const k = l.toLowerCase();
      const cls = selected.includes(k) ? " on" : pend === k ? " pend" : "";
      return `<g class="r${cls}" data-l="${l}"><title>${l}</title>${sh}</g>`;
    })
    .join("");
  return (v.bg || "") + `<g${tf}>` + regions + "</g>";
}
