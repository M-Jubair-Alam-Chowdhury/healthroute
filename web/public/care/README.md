# Care Anatomy SDK

A drop-in web component that lets a person show **where they feel discomfort** on a realistic, rotatable 3D body and describe it in one screen. It hands a clean, structured result to your next module (e.g. finding the nearest doctors and hospitals). No build step, no framework.

```html
<health-body-selector></health-body-selector>
<script src="body-selector.js"></script>
<script>
  document.querySelector("health-body-selector")
    .addEventListener("body-selection-submit", e => findCare(e.detail));
</script>
```

## Bundled male and female body models

The demo loads two GLB files directly (the **Male** view is shown first):
- `models/basic_male_model.glb` – Male view
- `models/basic_human_female.glb` – Female view

Every vertex of both models is labelled with one of the SDK's anatomical region IDs, so **every part of the body can be tapped**, highlighted and passed into the symptom-intake flow. Pose hints (`model-pose-male="12"`, `model-pose-female="t"`) only affect region labelling, not the visible pose. The labeller also lines each leg up with the SDK leg (so wide, slim or splayed legs still map to thigh / knee / shin / ankle) and gives any leftover vertex the region of its nearest neighbour, so no patch is unselectable.

**These are optimised copies of the supplied files** (made with `tools/optimize_glb.py`):
- *Male:* the original is 43.9 MB / 1.41 M triangles, far too dense for phones and for tap hit-testing. The bundled copy is welded and reduced to ~179 k triangles (~5 mm detail, 4.3 MB).
- *Female:* the original is a rigged mesh stored vertically squashed (the rig stretches it back). The SDK ignores rigs, so the correction (x10.93, y26.45, z10.25, estimated from the skeleton) is baked in and the rig data removed.
Regenerate with other settings, e.g. `python3 tools/optimize_glb.py original.glb models/basic_male_model.glb --cell 0.002` (more detail, bigger file). Then re-run `models-inline.js` generation (see below) and `node tests/test-models.js`.

Keep the entire project folder when deploying, including `models/` and `models-inline.js`. The inline file holds byte-for-byte base64 fallbacks of both models: if relative GLB fetches fail (e.g. opened from `file://`), the component decodes the bundled model and continues. Normal deployments should still publish `models/` and serve over HTTP(S). Three.js is loaded from jsDelivr unless you supply `three-src`. Meshes without colour data are drawn in a neutral skin tone.

### Model credits (CC BY 4.0 – attribution required)
- **Basic male model** by ToxicSmoke – https://sketchfab.com/3d-models/basic-male-model-af32da689e234a26aaf2d267618cadc5 – licence CC-BY-4.0
- **Base Female – Game Ready – Rigged – Low Poly** by the original model author (retain the source file’s embedded attribution/licence metadata; verify its licence before commercial deployment).
Both were modified (mesh optimised / re-scaled) as described above. Keep this credit wherever the models are shown.

## Look & feel update (0.14.0, appearance only)
- The form now sits under a teal hero header (`<care-app-header>`) and slides up with a rounded top edge, like the result screens. The body area has soft rings, teal Male/Female and send buttons, a rounded dock and tinted cards. No form logic was changed.
- New file `care-pages.js` adds `<care-app-header>` and `<care-info-page>`. The header's **How to use** and **Terms** buttons open two simple pages (`pages.show("how" | "terms")`). Edit their text in the `PAGES` object at the top of that file; the Terms text is a plain template and should be reviewed before publishing.

## What the person sees (0.10.0)
**One screen, no steps.** The body fills the screen; everything else is a tap away.
1. **Tap the body** where it hurts. A small sheet opens: tap what it feels like (Pain, Burning, Numbness… one or several), then **Done**. Each area appears as a chip in the dock (tap to edit, × to remove).
2. **Inside** (big teal button, top right) – *for things that are not on the skin, with no organ knowledge needed.* The person picks a friendly card (Chest, Tummy, Urine, Head & nerves, Throat, **Bones & joints**, Women's / Men's health, Whole body) and taps everyday phrases ("Chest tightness or pressure", "Heartburn or sour taste", "Deep ache in a bone", "Swollen or stiff joints"…). Behind the scenes every phrase carries body systems and related organ / bone ids for the AI and for routing. A badge on the button and an "Inside" chip in the dock show what was picked.
3. **Optional tiles** under the chips: **Strength** (ten tappable bars), **Started** (Just now … Over a month, Comes and goes), **Note** (free text).
4. **Continue** sends everything. `detail.aiPromptText` is a plain-language summary, e.g. `Area: left knee (pain). Inside the body: swollen or stiff joints; neck or back stiffness. Strength: 6 out of 10 (moderate). Started: 1–3 days. Extra details: …`

**Moving the body (3D):** one finger drags the figure **left / right and up / down, a full 360° in both directions** (over the top, underneath, upside-down); two fingers zoom and move it. The **Turn** button flips front / back and snaps the body upright again. Pinch to zoom in on hands, feet or face.

Other controls: **Male / Female** (top left; opens on Male), **i** safety note, **SOS** emergency sheet. The component makes **no decisions**: it never flags an emergency by itself (that is the backend's job). The only emergency feature is the manual **SOS** button, which calls the emergency number.

### Attributes (all optional)
| Attribute | What it does |
|---|---|
| `figure="clinical"` | faceless anatomical figure (default is the natural figure with eyes, brows, nose, mouth and hair) |
| `single-select` | allow only one body area (a new tap replaces the old one) |
| `emergency-number="999"` | number dialled by the SOS button (default `999`; set per country) |
| `model-api="https://…"` | base URL of the department model; Send calls `POST {model-api}/predict` |
| `risk-api="https://…"` | base URL of the risk model; Send calls `POST {risk-api}/risk` |
| `submit-label="Continue"` | text of the final button |
| `show-output` | demo only: after Continue, shows the text that was handed to the AI |
| `layer="internal"` or `"skeleton"` | start with organs or bones instead of the body surface (no on-screen switch) |
| `theme="light"` / `"dark"` | force a theme (default follows the phone) |
| `renderer="2d"` | force the 2D fallback (also used automatically if WebGL / three.js is unavailable) |
| `three-src="/path/three.module.js"` | self-host three.js (r160) instead of the CDN; or call `CareAnatomy.useThree(THREE)` |

Theming: `health-body-selector { --care-accent: #0b8f7e; --care-height: 100dvh; }`
The component fills `--care-height` (default: the full screen height). Put it in a container with a fixed height to embed it.

### Model calls (new in 0.13.0)
When Send is pressed the text in the box goes to two services as JSON `POST` requests with `Content-Type: application/json`:
```
POST {MODEL_API}/predict   { "text": "chest pain; left hand tingling;" }
POST {RISK_API}/risk       { "text": "chest pain; left hand tingling;", "sex": "female" }
```
`/predict` answers `{ "mode": "single" | "multi" | "unsure", "top3_sum": 0.768, "departments": [["Respiratory", 0.619], ["Cardiology", 0.096], ["Infectious disease", 0.053]] }`: `single` = one department, `multi` = three departments, `unsure` = not sure (the three closest are still listed). The older `{ "top3": [{ "label", "score" }] }` shape is still accepted (shown as one department). `<care-result-screen>` renders all three modes and `care-open-hospitals` carries `{ department, mode, departments, ... }`.

`sex` is `"female"` or `"male"` (the Male / Female switch). Set the base URLs with the `model-api` / `risk-api` attributes or from code: `el.setApiEndpoints({ modelApi, riskApi })`. Leave one empty to skip that call. Both run in parallel, time out after 20 s, and one failing never blocks the other. The services must allow your site's origin (CORS) and be served over HTTPS in production. Run `node tests/test-api.js` to check the contract.

### Events
- `care-analysis-result` – both calls finished. `detail = { report, predict, risk, errors: { predict, risk }, ok, requests }`; `predict` / `risk` hold the JSON each service returned (or `null` on failure, with the reason in `errors`). Use it to open your result screen.
- `body-selection-change` – live `detail` report whenever anything changes.
- `body-selection-submit` – final report when the person presses Continue.
- `care-emergency-alert` – the person pressed **Send emergency alert**. Deliver the alert yourself, then set `event.detail.handled = true` (and optionally `event.detail.message`). If nothing sets `handled`, the sheet tells the person alerts are not set up and to call the number instead.

### New in the report
`internalConcerns: [{ id, label, group, bodySystems, possibleOrgans }]` (organ ids are hints, not a diagnosis), `selectedRegions[].symptoms`. Inside concerns also feed `bodySystems` and `routingHints.specialties`. `severity`, `onsetOrDuration`, `additionalDetails` are filled from Strength, Started and Note.

## Use your own 3D model (.glb)
The SDK can show any standing human 3D model instead of the built-in body. Every tap, highlight, strength / inside / note feature keeps working.

**1. Get a model (check the licence first).** For a health app you need a licence that allows commercial use. Prefer CC0 or CC-BY (keep the credit). Avoid "NonCommercial" and "NoDerivatives".
- **MakeHuman** (free, CC0 output) – realistic adult bodies, male and female, standing in an A/T pose. Export to .glb with Blender.
- **Sketchfab** – search "human body base mesh" / "realistic man" / "realistic woman", filter *Downloadable* and the licence; download the *glTF / GLB* format.
- **Mixamo** (free Adobe account) – realistic rigged characters in T-pose (FBX; convert to .glb in Blender).
- **Ready Player Me** – quick avatars as .glb (stylised faces; read their terms).
- **Paid, most realistic:** CGTrader / TurboSquid / Renderpeople / Character Creator / Daz. Look for "A-pose or T-pose, game-ready, GLB".
- Not for the outside body but useful later for inside views: **Z-Anatomy** and **BodyParts3D** (CC-BY-SA).

**2. Check the model.** One person, standing, facing the camera, arms down or straight out (A-pose / T-pose), feet on the floor, Y is up. Ideally under 60,000 triangles and textures up to 2048 px so phones stay smooth. Not .glb? Open it in free **Blender** → *File → Export → glTF 2.0 (.glb)*.

**3. Try it in 1 minute (no code).** Put the .glb next to `index.html`, serve the folder (`python3 -m http.server`, then open `http://localhost:8000/index.html?dev`) and use the small panel at the top-left: choose the file, set *Arms* (down / A-pose / T-pose) and *Turn* if the model looks at the wrong side. Tick *show region colours* to see how the model is divided into regions – boundaries should sit on the right body parts.

**4. Install it for real.**
```html
<health-body-selector model-src="/models/human.glb" model-pose="a"></health-body-selector>
<!-- different models: model-src-female="/models/woman.glb" model-src-male="/models/man.glb" -->
```
| Attribute | Meaning |
|---|---|
| `model-src` / `model-src-female` / `model-src-male` | URL of the .glb (same origin or CORS-enabled) |
| `model-pose` | arms of your model: `relaxed` (down, default) · `a` (≈45° out) · `t` (straight out) |
| `model-rotate` | `0 / 90 / 180 / 270` – turn the model if it faces the wrong way |
| `model-debug` | colour every region (for checking the fit) |

From code: `await el.loadModel(fileOrUrlOrArrayBuffer, "female" | "male" | "all")`. If a file cannot be read, the built-in body is shown again. Organs / bones layers (`layer="internal"`) always use the built-in body.

**How the fit works / limits.** Your model is scaled to the SDK body height, centred, and every vertex is matched to the SDK's body-region map by its position (front / back decided by the surface direction). Skins, clothes and hair are labelled by where they are. It is an approximation: regions follow average proportions, so very stylised or unusual bodies can be off by a few centimetres. Animation / rigging is ignored (the pose stored in the file is used). Only embedded .glb textures are read (no external image files).

## About the 3D body
Default style (0.10.0) is a **natural figure** (face and hair, neutral skin tone, smaller ears); `figure="clinical"` removes the face and hair. It is still procedurally generated, not a scan. For photographic realism a licensed, scanned 3D model (GLB) is required; the vertex-labelling approach (2D region polygons re-used in 3D) can be adapted to map one.

Procedurally generated and sculpted in code (not a scan): male and female builds with muscle / bone landmarks, a designed face (eyes with irises and lids, brows, nose, lips, a gentle smile), hair, hands, feet, plus see-through Organs and Bones layers. About 190 selectable regions share the same IDs in 3D and 2D. For scan-level realism a licensed 3D model would be needed.

---

## Release notes

## What's new in 0.13.0
- **Input only, no decisions.** The automatic red "call now" strip and `urgentFlag` in the report are gone, as are the hidden urgency flags on the Inside items. The manual **SOS** button (call + `care-emergency-alert`) is unchanged.
- **Close (x) button** at the top right of every sheet (Inside, body-part symptoms, safety note). The Inside button also toggles the sheet closed; tapping outside and Esc still work.
- **Two model calls** wired in: `/predict` and `/risk` (see *Model calls*), plus the `care-analysis-result` event, a spinner on the send button and a clear retry message on failure.
- **Easier to use:** one tap picks a symptom or Inside phrase and a second tap removes it (the hidden double-tap is gone, and selected chips show a check mark); selected body parts and Inside picks appear as removable chips above the text box (tap a chip to edit it, x to remove it); tapping an already selected body part re-opens it instead of silently removing it; a floating hint "Tap the body where it hurts" shows until something is chosen.
- **Polish:** soft press/hover animations, focus ring on the text box, tidier chip row.
- Report: `urgentFlag` removed. Everything else is unchanged.

## What's new in 0.12.0 (v4 fixes)
- **Female arms fixed (and the model now faces the front like the male).** The female model was a T-pose (arms straight out, right-angled to the body). The arms are now baked down to a relaxed pose like the male (`tools/pose_arms_down.py`, `--angle 78`); use `model-pose-female="12"`. The original T-pose file is not shipped.
- **Multi-select body parts.** Tap as many body parts as you like; each stays highlighted even if you have not picked a symptom yet. **Tap a selected part again to un-select it** (its symptoms and text in the box are removed too). `single-select` still limits it to one part.
- **Wrong region names fixed (both bodies).** Face regions (forehead, eyes, nose, mouth, chin, cheeks, jaw, ears, temples, scalp, back of head) and the arm segments (upper arm, elbow, forearm, wrist, hand) are now labelled from each model's own proportions, so tapping the mouth says "Mouth" and not "Chin". Anchors live in `HEAD_CHIN` and `ARM_SPAN` in `body-selector.js`; for your own models pass `headAnchors: false` to `prepareGLB` options to use the generic polygon map only.
- **Symptom picking like the demo.** Tap a body part, the symptom list opens. **One tap on a symptom selects it** and writes it into the text box ("left knee pain;"); **a double tap removes it**. Deleting text from the box un-selects it too. **Done, Remove and the x chips are gone**; tap outside the sheet to close it.
- **Text box instead of Continue.** The dock is now a text box with a send arrow (Enter also sends). Strength / Started / Note tiles were removed; the person can simply type them. `aiPromptText` is the exact box content, `additionalDetails` is only what the person typed themselves.

## What's new in 0.11.0
- **Bring your own 3D model:** `model-src` (.glb) with automatic fit and region mapping, pose / rotate options, a region-colour debug view and a `?dev` panel in `index.html` (see *Use your own 3D model*).

## What's new in 0.10.0
- **Face and hair are back, redrawn:** almond eyes with iris and lashes, tapered brows (finer for female, fuller for male), shaded nose, natural lips, long flowing hair (female) or short hair with a natural hairline (male). `figure="clinical"` keeps the faceless version.
- **Free 360° rotation** up / down as well as left / right in 3D (unbounded pitch; horizontal drag direction follows the body when it is upside-down; floor hides when seen from below).
- **Inside moved to the main rail** as a prominent button; Head / Hands / Feet shortcuts removed (pinch to zoom instead).
- **Inside redesigned** as system cards plus a new **Bones & joints (and muscles)** group (`possibleOrgans` use skeleton ids).
- Dock now has three tiles (Strength, Started, Note) plus an "Inside" chip.
- Report: new `cameraElevationDeg`.

## What's new in 0.9.0 — redesign
- **New interface:** full-screen figure, floating controls, a thumb rail (Turn / Head / Hands / Feet) and a bottom dock with area chips, four add-on tiles and one Continue button. New mint-teal look, light and dark.
- **Strength, Started and Note are back** (ten-bar strength picker, one-tap timing chips, free text) as optional add-ons instead of a long form.
- **Inside the body without picking organs:** everyday-language phrases mapped to body systems and related organs (`internalConcerns`).
- **Emergency strip** for strength 8+, bleeding and urgent inside items; SOS sheet and safety note unchanged.
- **Figure:** faceless clinical style by default (no doll face or helmet hair, smaller ears, neutral skin tone, softer grain). `figure="detailed"` restores the old face.
- Selection highlight is now the brand teal in both 3D and 2D.

## What's new in 0.8.0 — one-screen phone interface
- **Rebuilt around the simple demo flow.** Removed: the 3-step wizard, search box, "browse all body parts" list, organ helper panel, strength slider, "when did it start" chips, preview box, Organs / Bones switch, zoom / spin / reset buttons and the explanatory text blocks.
- **Big body.** The 3D body now fills the whole screen between the top bar and the controls (about 82–88 % of the map height on every phone size tested; before it was a 205–300 px window). The camera also fits the body to the screen width.
- **Symptom + body part build the description.** Tap either first. The text box fills itself and stays editable; edits keep the selection in sync.
- **Finger-friendly 3D:** one-finger drag only turns the body sideways (no accidental tilting), bigger tap tolerance, no double-tap reset (use **Front**), the tapped part is outlined while the person chooses a symptom, R / L labels follow the turn.
- **Popovers stay clear of the finger** (symptom list opens on the opposite half of the screen from the tap).
- **SOS** (call + alert event) and **safety note** are always one tap away.
- **Keyboard-aware:** the view row hides while typing and the layout follows the on-screen keyboard.
- Dark mode follows the phone. 2D fallback uses the same screen.
- Payload: unchanged shape. `aiPromptText` is now the text-box content; `selectedRegions[].symptoms` is new; `severity` and `onsetOrDuration` are `null` (they are no longer asked; the person can write them in the text box). `additionalDetails` is the part the person typed themselves.

## What's new in 0.7.0
- **New guided interface** (3 steps, big touch targets, sticky Next on phones, no clutter). Removed: JSON box, copy / download buttons (now `show-output`), duplicate view buttons, region list wall.
- **Skin colour picker removed**; one fixed natural tone (the "Fair" tone).
- **New face and hair:** open, expressive eyes with iris detail, lids and lashes, shaped brows, refined nose, defined lips with a gentle smile, stronger jaw (male) / softer cheek and jaw line (female), styled short hair (male) and long hair with face-framing locks (female), strand texture.
- Soft highlight halo around selected areas, smarter body framing, steeper studio light.
- Payload unchanged except: `severity` is `null` until the person sets it, and `skinToneDisplay` is gone.

## What's new in 0.6.0 — sculpted, human-looking 3D bodies
- **Real anatomy instead of a smooth mannequin:** muscle and bone landmarks are modelled into the surface (deltoids, biceps / triceps, forearm muscles, elbows, clavicles, ribcage, scapulae, spine groove, glutes, quadriceps, knees, calves, Achilles groove, ankle bones, navel).
- **Proper male / female differences:** men have broader shoulders, a V-shaped torso, pectorals, defined abdominals, thicker neck, brow ridge, stronger jaw and chin, larger hands / feet, short hair. Women have narrower shoulders, a defined waist, bust, wider hips and fuller thighs, a softer face with fuller lips and longer lashes, and long hair. Women are also ~5% shorter. Women wear a bandeau top, both wear shorts, which still map to the right regions.
- **Face:** nose with bridge and nostrils, lips with a mouth line, eyeballs with irises, upper and lower eyelids, lashes, shaped brows, cheekbones, ears.
- **Hands & feet:** lofted palm, jointed and slightly curled fingers with knuckles and nails, thumb; feet with arches, ankle bones and toes with nails.
- **Skin:** per-vertex colour variation (flushed cheeks / knuckles / knees, natural mottling), micro bump, sheen; soft shadows, studio reflections, contact shadow.
- The picking / region IDs / payload are unchanged from 0.5.0.
- Still a procedurally generated model (not a scan). For true photographic realism, a licensed scanned model is needed.

## What's new in 0.5.0 — interactive 3D human model
The flat 2D figure is replaced by a real-time **3D human model** you can rotate 360°, zoom and pan.
- **Controls:** drag to rotate, mouse wheel / pinch to zoom, right-drag or two-finger drag to pan, double-click to reset. Buttons: Front, Back, Left side, Right side, Head, Hands, Feet (animated camera moves), zoom +/-, auto-rotate 360°, reset.
- **Pick any part:** hover shows the part name; click / tap selects it. Selection highlights the exact surface patch on the 3D body. Everything else is unchanged: same region IDs, region list, search, symptoms, severity, groups (e.g. `left-hand`), `body-selection-change` / `body-selection-submit` events, and the same JSON handoff.
- **Three layers in 3D:** External body (skin tones, face, hair, hands, feet, neutral shorts), Internal organs, and Bones & joints, each inside a see-through body. The profile (female / male) and skin tone controls still apply.
- **Payload additions:** `bodyView` is now one of `front | back | left | right | head | hands | feet`, plus `cameraAzimuthDeg` and `renderer` (`webgl-3d` or `svg-2d`).
- **How picking works:** every 3D vertex is labelled with a region ID by re-using the 2D region polygons (front and back maps), with custom rules for hands, feet, face and joints. So 2D and 3D share one source of truth.
- **Requires WebGL + three.js.** three.js (r160) loads from a CDN by default. To self-host / work offline either set `three-src="/path/three.module.js"` on the element, or `import * as THREE from "three"; CareAnatomy.useThree(THREE);` before the element connects. If WebGL or three.js is unavailable, the component automatically falls back to the 2D body map (also forceable with `renderer="2d"`).
- **Honest limit:** the 3D body is a *procedurally generated* human model (smooth lofted anatomy, built in code), not a scanned or sculpted photoreal asset, and organs / bones are simplified. For a scan-quality person you would need a licensed 3D model (GLB); the region labelling approach here can be re-used to map it, but loading external GLB models is not included yet.
- The 2D photo slot, `setFigureImages`, from 0.4.0 still works in the 2D fallback.

## What's new in 0.4.0 (realistic rendering)
- **Realistic figure.** Skin-toned bodies with studio-style lighting (soft shading, specular highlight, subtle skin grain), anatomical shadows (collarbones, muscle lines, knees, shins), real-looking eyes, brows, lips, ears, hair, nails and neutral briefs. Organs and bones are shaded 3D-style with natural colors.
- **Skin tone picker** (Light, Fair, Medium, Tan, Brown, Deep) and an optional **Region guides** toggle. By default the region outlines are very faint so the figure reads cleanly; hover shows the part name.
- **Real photo / render slot.** A vector drawing cannot be a photograph. To get a true photographic look, supply licensed photos or 3D renders (of consenting models, with usage rights) and the component draws them as the base image, keeping every clickable region on top:
  ```js
  const el = document.querySelector("health-body-selector");
  el.setFigureImages({ female: { front: "img/f-front.jpg", back: "img/f-back.jpg" },
                       male:   { front: "img/m-front.jpg", back: "img/m-back.jpg" } });
  // or attributes: photo-female-front="..." photo-female-back="..." photo-male-front="..." photo-male-back="..."
  ```
  Shoot / render each image in the **anatomical pose** (standing, arms slightly away from the body, palms forward) on a 300 x 650 canvas (ratio 6:13), and align it using the guide PNGs in `templates/`. Regions are only as accurate as the alignment, so check by turning on *Region guides*. Photo mode applies to the External layer, Front / Back views.
- Skin tone is display-only and is **not** added to the AI payload except as `skinToneDisplay`; ignore it for clinical logic.

## What's new in 0.3.0 (anatomy rewrite)
- **New anatomy engine.** Proportioned (~7.5-head) male and female figures with real contours: head, ears, neck, shoulders, torso, arms, hands, pelvis, legs and feet. Female and male differ in shoulder / waist / hip / neck width and surface detail.
- **Three layers:** *External body*, *Internal organs* (brain, eyes, sinuses, teeth, larynx, thyroid, trachea, esophagus, heart, lungs, breast tissue, liver, gallbladder, stomach, pancreas, spleen, adrenals, kidneys, small & large intestine, appendix, ureters, bladder, rectum; uterus / ovaries / tubes for the female profile, prostate / testes for the male profile) and *Bones & joints* (skull, jaw, spine by segment, sacrum, coccyx, ribs, sternum, collarbones, shoulder blades, arm / hand / pelvis / leg / foot bones, six joints per side).
- **Five views:** Front, Back, Head close-up, Hands (palm + back, both sides), Feet (top + sole, both sides). Every finger and toe is its own region.
- **~190 selectable regions.** External now includes forehead, temples, cheeks, chin, jaw, nose, mouth, ears, eyes, throat, armpits, all nine abdominal regions, flanks, hips, groin, scapulae, mid back, tailbone, buttocks, anal region, back of knee, Achilles tendon, heel, sole and individual fingers / toes. All 0.2 region IDs still exist.
- **Left / right fixed.** In 0.2 the "left" regions were drawn on the viewer's left in the front view (i.e. the patient's right). Now `left-*` / `right-*` always mean the **patient's own** side, and the picture is labelled R / L.
- **Handoff payload (schema 1.1, additive).** Each selected region gains `bodySystems`, group regions (e.g. `left-hand`) carry `includes`, and the report gains `bodySystems`, `sideConvention` and `routingHints.specialties` to drive the doctor / hospital search.

## Routing hints
`SYSTEMS` at the top of `body-selector.js` maps body systems to specialty names (Cardiology, Neurology, Orthopedics...). They are hints for the *next* step (finding doctors / hospitals), not a diagnosis; have clinicians review the table. Real "nearest doctor" logic, geolocation and emergency red-flag handling belong in your next module.

## Files
- `index.html` — local demo page
- `body-selector.js` — reusable `<health-body-selector>` Web Component
- `models/`, `models-inline.js` — bundled GLB models and their base64 fallback
- `tools/optimize_glb.py` — reduces / corrects a GLB for the SDK (needs numpy)
- `tests/test-models.js` — `node tests/test-models.js`
- `tests/test-api.js` — `node tests/test-api.js` (the /predict and /risk calls)

## Run locally
Open `index.html` in a modern browser. Clipboard access may require localhost or HTTPS.

## Embed in a website
Host `body-selector.js` on your own trusted HTTPS domain, then add:

```html
<script src="https://YOUR-DOMAIN/body-selector.js" defer></script>
<health-body-selector allow-multiple theme="clinical"></health-body-selector>
```

`YOUR-DOMAIN` is a placeholder. This package does not publish or host a CDN.

## Receive structured data
```js
const selector = document.querySelector('health-body-selector');
selector.addEventListener('body-selection-change', (event) => {
  // Live draft changes. Avoid sending every keystroke to a server.
  const draft = event.detail;
});

selector.addEventListener('body-selection-submit', async (event) => {
  const report = event.detail; // complete, versioned handoff payload
  // Persist using your own authenticated, encrypted backend.
  // Example: await fetch('/api/intake', {
  //   method: 'POST',
  //   headers: {'Content-Type':'application/json'},
  //   body: JSON.stringify(report)
  // });
});
```

The `event.detail` object contains:
- `schemaVersion`
- `source`
- `anatomicalProfile`
- `anatomicalLayer` (`external` | `internal` | `skeleton`)
- `bodyView`
- `selectedRegions` (stable IDs, labels, side, category, `anatomyMode`, `view`, `bodySystems`, optional `includes`)
- `bodySystems`, `routingHints`, `sideConvention`
- `reportedSymptoms`
- `onsetOrDuration`
- `severity`
- `additionalDetails`
- `generatedAt`
- `disclaimer`

## Integration notes
- The component uses Shadow DOM to isolate most styles from the host website.
- It emits `body-selection-change` as a bubbling, composed `CustomEvent`.
- `allow-multiple` enables selecting multiple body regions. Without it, selecting a new region replaces the previous region.
- `theme` is reserved for host integration; customize the accent with CSS custom property `--care-accent` on the element.
- For React, listen to the native event using a ref and `addEventListener` in an effect.
- For React Native, use a WebView wrapper or build a native UI that sends the same JSON schema.
- Do not pass identifying or health data to third parties without a lawful basis, consent where required, and appropriate security controls.

## Current prototype limitations
This is a functional UI and data-event prototype, not a validated anatomical atlas or medical device. The figures are hand-built schematic vector drawings with realistic proportions, but organs and bones are simplified, not to scale, and organ / bone views are front-facing only for organs (no back view). Genital and anal regions are zones only, deliberately not drawn explicitly. Before clinical use, have the drawings, region IDs, specialty mapping and symptom triage reviewed by qualified clinicians, and consider age / body-variation options (children, pregnancy, different body types). The component does not diagnose disease.

## Input handoff contract
Pressing **Send** (the arrow) emits `body-selection-submit` with the complete structured report. The component does not silently write health data to browser storage or send it to a third party. The host app is responsible for authenticated persistence, access control, retention/deletion policy, and securely forwarding the report to the next step. The report includes a `schemaVersion` so downstream code can validate and evolve the format.

### Coordinate normalization and anatomical tap selection (v2 fix)

The female GLB supplied for this build has its vertical axis reversed relative to the SDK's world convention. `prepareGLB()` now normalizes that model's Y axis before calculating bounds, normals, region labels, or rendering, and reverses triangle winding to preserve correct face culling and ray hits. The male model is left unchanged. For external GLBs, tap selection now resolves the actual ray-hit position against the same front/back anatomical polygons used by the 2D selector; triangle vertex labels are only a fallback if no polygon region covers the hit. The regression test checks top/head, bottom/foot, front/chest, back/torso, and left/right hip point queries for both models.
