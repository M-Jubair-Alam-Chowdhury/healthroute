/* HealthRoute AI - shell pieces around the symptom form (appearance only, no logic of the form lives here).
 *
 *   <care-app-header>   teal hero band shown above the form. Events (bubble, composed):
 *                         care-open-page  detail = { page: "how" | "terms" }
 *   <care-info-page>    full-screen simple page.   el.show("how" | "terms");  el.hide();
 *                         care-page-close           fired when the person goes back
 *
 * Look and tokens follow care-result.js (teal hero, rounded white sheet), --care-accent, prefers-color-scheme or theme="light|dark".
 */
(function () {
  "use strict";

  var TOKENS = `
  :host{--ac:var(--care-accent,#0b8f7e);--sheet:#fff;--s1:#eaf0ed;--ink:#14302b;--mute:#5b756e;--line:#dce6e2;--acsoft:#e0f2ee;--acline:#a9d8cf;
    --hero1:#0d9886;--hero2:#066256;--heroink:#fff;--heromute:rgba(255,255,255,.78);--warn:#c97a00;--warnbg:#fbebcf;--danger:#cf3a2e;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
  @media(prefers-color-scheme:dark){:host(:not([theme="light"])){--ac:var(--care-accent-dark,#3fcdb5);--sheet:#1a2624;--s1:#0f1816;--ink:#e8f2ef;--mute:#92aaa3;--line:#2a3b37;--acsoft:#1c3a35;--acline:#2f5c54;
    --hero1:#1f4540;--hero2:#122420;--heroink:#f1faf7;--heromute:rgba(232,242,239,.72);--warn:#ffb84a;--warnbg:#3a2d12;--danger:#ff7a6e}}
  :host([theme="dark"]){--ac:var(--care-accent-dark,#3fcdb5);--sheet:#1a2624;--s1:#0f1816;--ink:#e8f2ef;--mute:#92aaa3;--line:#2a3b37;--acsoft:#1c3a35;--acline:#2f5c54;
    --hero1:#1f4540;--hero2:#122420;--heroink:#f1faf7;--heromute:rgba(232,242,239,.72);--warn:#ffb84a;--warnbg:#3a2d12;--danger:#ff7a6e}
  *{box-sizing:border-box}
  button{font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
  :focus-visible{outline:3px solid color-mix(in srgb,var(--ac) 70%,#fff);outline-offset:3px}`;

  var ECG = '<svg viewBox="0 0 84 48" aria-hidden="true"><path d="M2 26 H20 L27 26 L33 8 L42 42 L49 17 L54 26 H82" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var BACK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

  /* =============================== HEADER =============================== */
  var HEADER_CSS = TOKENS + `
  :host{display:block;position:relative;z-index:1;height:var(--hdr,84px);flex:none;overflow:hidden;color:var(--heroink);
    background:linear-gradient(160deg,var(--hero1),var(--hero2));padding-top:env(safe-area-inset-top,0px);height:calc(var(--hdr,84px) + env(safe-area-inset-top,0px))}
  :host::before,:host::after{content:"";position:absolute;border-radius:50%;border:1.5px solid rgba(255,255,255,.14);pointer-events:none}
  :host::before{width:300px;height:300px;right:-110px;top:-150px}
  :host::after{width:200px;height:200px;left:-80px;bottom:-120px}
  .wrap{position:relative;z-index:1;max-width:480px;height:100%;margin:0 auto;padding:10px 18px 40px;display:flex;flex-direction:column;justify-content:center}
  .row{display:flex;align-items:center;gap:8px}
  .logo{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.16);box-shadow:0 0 0 1px rgba(255,255,255,.25) inset}
  .logo svg{width:22px;height:13px}
  .brand,.pill{white-space:nowrap}
  .brand{font-weight:800;font-size:17px;letter-spacing:-.005em}
  .sp{flex:1}
  .pill{border:0;border-radius:999px;padding:8px 13px;background:rgba(255,255,255,.16);color:var(--heroink);font-size:13px;font-weight:700;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:background .15s,transform .12s}
  .pill:hover{background:rgba(255,255,255,.26)}.pill:active{transform:scale(.96)}
  h1{margin:0;font-size:clamp(22px,3.4vh,27px);font-weight:850;letter-spacing:-.02em;line-height:1.1}
    @media(max-width:380px){.brand{font-size:14px}.pill{padding:7px 10px;font-size:12.5px}.logo{width:30px;height:30px}}`;

  var HEADER_HTML = `
  <div class="wrap">
    <div class="row">
      <span class="logo">${ECG}</span><span class="brand">HealthRoute AI</span><span class="sp"></span>
      <button class="pill" data-page="how">How to use</button>
      <button class="pill" data-page="terms">Terms</button>
    </div>
  </div>`;

  class CareAppHeader extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = "<style>" + HEADER_CSS + "</style>" + HEADER_HTML;
      this.shadowRoot.addEventListener("click", function (e) {
        var b = e.target.closest("[data-page]"); if (!b) return;
        this.dispatchEvent(new CustomEvent("care-open-page", { bubbles: true, composed: true, detail: { page: b.getAttribute("data-page") } }));
      }.bind(this));
    }
  }

  /* =============================== INFO PAGES =============================== */
  var PAGE_CSS = TOKENS + `
  :host{display:none;position:fixed;inset:0;z-index:60}
  :host([open]){display:block}
  .root{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--s1);animation:rise .4s cubic-bezier(.2,.8,.2,1)}
  @keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
  .hero{position:relative;flex:none;overflow:hidden;color:var(--heroink);background:linear-gradient(160deg,var(--hero1),var(--hero2));padding-top:env(safe-area-inset-top,0px)}
  .hero::before,.hero::after{content:"";position:absolute;border-radius:50%;border:1.5px solid rgba(255,255,255,.14);pointer-events:none}
  .hero::before{width:300px;height:300px;right:-110px;top:-150px}.hero::after{width:200px;height:200px;left:-80px;bottom:-120px}
  .hwrap{position:relative;max-width:560px;margin:0 auto;padding:14px 22px 46px}
  .back{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:8px 14px 8px 10px;background:rgba(255,255,255,.16);color:var(--heroink);font-size:13.5px;font-weight:700;backdrop-filter:blur(6px)}
  .back:active{transform:scale(.96)}
  .eyebrow{margin:22px 0 4px;font-size:13.5px;font-weight:600;color:var(--heromute)}
  h1{margin:0;font-size:clamp(28px,4.4vh,38px);font-weight:850;letter-spacing:-.025em;line-height:1.05}
  .body:focus{outline:none}
  .body{position:relative;z-index:1;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;margin-top:-26px;background:var(--sheet);border-radius:28px 28px 0 0;-webkit-overflow-scrolling:touch}
  .bwrap{max-width:560px;margin:0 auto;padding:26px 22px calc(28px + env(safe-area-inset-bottom,0px))}
  .lead{margin:0 0 20px;font-size:16px;line-height:1.5;color:var(--mute)}
  /* how-to steps */
  ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
  li.step{display:flex;gap:14px;align-items:flex-start;padding:14px;border-radius:20px;background:var(--s1);border:1px solid var(--line)}
  .num{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--ac);color:var(--sheet);font-weight:850;font-size:15px}
  .step h3{margin:2px 0 3px;font-size:16.5px;font-weight:800;letter-spacing:-.01em}
  .step p{margin:0;font-size:14.5px;line-height:1.45;color:var(--mute)}
  /* terms sections */
  section.t{margin:0 0 20px}
  section.t h2{margin:0 0 6px;font-size:17px;font-weight:800;letter-spacing:-.01em}
  section.t p{margin:0;font-size:14.5px;line-height:1.55;color:var(--mute)}
  .note{display:flex;gap:12px;align-items:flex-start;margin:22px 0 0;padding:14px 16px;border-radius:18px;background:var(--warnbg);color:var(--ink);font-size:14px;line-height:1.45;font-weight:600}
  .note.sos{background:color-mix(in srgb,var(--danger) 12%,var(--sheet))}
  .note b{color:var(--danger)}
  .cta{display:flex;align-items:center;justify-content:center;width:100%;margin-top:22px;min-height:54px;border:0;border-radius:18px;background:var(--ac);color:var(--sheet);font-weight:800;font-size:16.5px}
  .cta:active{transform:scale(.98)}
  .upd{margin:18px 0 0;text-align:center;font-size:12px;color:var(--mute)}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

  var PAGES = {
    how: {
      eyebrow: "A quick guide",
      title: "How to use",
      html: `
      <p class="lead">It takes about a minute. Tell us where you feel discomfort and we suggest the right department and how urgent it may be.</p>
      <ol>
        <li class="step"><span class="num">1</span><div><h3>Choose Male or Female</h3><p>Use the switch at the top of the body so the figure matches you.</p></div></li>
        <li class="step"><span class="num">2</span><div><h3>Tap where it hurts</h3><p>Tap any part of the body, then pick what it feels like: pain, burning, numbness and more. Drag to turn the body, pinch to zoom, or press <b>Turn</b> to see the back.</p></div></li>
        <li class="step"><span class="num">3</span><div><h3>Use Inside for things you can't point to</h3><p>Chest tightness, heartburn, bones and joints? Open <b>Inside</b> and tap the everyday phrases that fit. No organ names needed.</p></div></li>
        <li class="step"><span class="num">4</span><div><h3>Add details (optional)</h3><p>Set how strong it is, when it started, or write your own note in the box at the bottom.</p></div></li>
        <li class="step"><span class="num">5</span><div><h3>Press the arrow to send</h3><p>You will see the suggested department, your risk level, and nearby hospitals to open on the map.</p></div></li>
      </ol>
      <div class="note sos"><span><b>Emergency?</b> Press the red <b>SOS</b> button at any time to call your local emergency number.</span></div>
      <button class="cta" data-close>Got it</button>`
    },
    terms: {
      eyebrow: "Please read",
      title: "Terms & Conditions",
      html: `
      <p class="lead">By using HealthRoute AI you agree to the points below. They are written to be short and clear.</p>
      <section class="t"><h2>1. Not medical advice</h2><p>HealthRoute AI gives general guidance only. It does not diagnose, treat or replace a doctor. Results are suggestions and can be wrong.</p></section>
      <section class="t"><h2>2. Emergencies</h2><p>If you think you or someone else is in danger, call your local emergency number straight away. Do not wait for results from this app.</p></section>
      <section class="t"><h2>3. Your information</h2><p>What you select and type is sent to our analysis services to produce your result. Please do not enter your name, phone number or other identifying details in the note box.</p></section>
      <section class="t"><h2>4. Accuracy</h2><p>The department and risk level come from automated models. They may not suit every person or condition. Always check with a qualified health professional.</p></section>
      <section class="t"><h2>5. Hospitals and maps</h2><p>Suggested hospitals are a convenience. We do not guarantee availability, opening hours or quality of care.</p></section>
      <section class="t"><h2>6. Responsible use</h2><p>Use the app for yourself or someone you are helping with their consent. Do not misuse, copy or attempt to disrupt the service.</p></section>
      <section class="t"><h2>7. Changes</h2><p>We may update these terms from time to time. Continuing to use the app means you accept the updated terms.</p></section>
      <button class="cta" data-close>I understand</button>`
    }
  };

  var PAGE_HTML = `
  <div class="root">
    <header class="hero"><div class="hwrap">
      <button class="back" data-close aria-label="Back">${BACK}Back</button>
      <p class="eyebrow"></p><h1></h1>
    </div></header>
    <main class="body" tabindex="-1"><div class="bwrap"></div></main>
  </div>`;

  class CareInfoPage extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = "<style>" + PAGE_CSS + "</style>" + PAGE_HTML;
      this.shadowRoot.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) this.hide(); }.bind(this));
      this.shadowRoot.addEventListener("keydown", function (e) { if (e.key === "Escape") this.hide(); }.bind(this));
    }
    show(page) {
      var p = PAGES[page]; if (!p) return;
      var $ = function (s) { return this.shadowRoot.querySelector(s); }.bind(this);
      $(".eyebrow").textContent = p.eyebrow; $("h1").textContent = p.title; $(".bwrap").innerHTML = p.html;
      $(".body").scrollTop = 0;
      this.setAttribute("open", ""); this._from = document.activeElement;
      $(".body").focus({ preventScroll: true });
    }
    hide() {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new CustomEvent("care-page-close", { bubbles: true, composed: true }));
      if (this._from && this._from.focus) try { this._from.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  if (!customElements.get("care-app-header")) customElements.define("care-app-header", CareAppHeader);
  if (!customElements.get("care-info-page")) customElements.define("care-info-page", CareInfoPage);
})();
