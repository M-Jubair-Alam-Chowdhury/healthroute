/* <care-result-screen> - the screen that follows the symptom form.
 *
 *   const el = document.querySelector("care-result-screen");
 *   el.showLoading();                                  // animated "analysing" screen
 *   el.showResult({ predict, risk });                  // predict = { mode:"single|multi|unsure", top3_sum, departments:[[name,prob],...] }
 *                                                      //           (old { top3:[{label,score}] } also works)
 *                                                      // risk    = { emergency: true|false }   (optional; old { risk:"High" } counts as emergency)
 *   el.showError("message");                           // friendly retry screen
 *   el.hide();
 *
 * What the person reads:
 *   single : "The most likely department related to your symptoms is X. Even though ..., it might also be Y and Z."
 *            buttons: hospitals for X only  |  the safer step (hospitals with all three)
 *   multi  : "Your symptoms are most likely related to X, Y and Z. We couldn't pinpoint ..."  -> hospitals with all three
 *   unsure : "Your symptoms were not enough to make suggestions." (no departments)  -> back to the 3D input | any nearby hospital
 *   emergency flag set: a red "The symptoms might be an emergency." banner (with a call button) on top.
 *
 * Events (all bubble, composed):
 *   care-open-hospitals  detail = { department, mode, departments:[top 3 names], scope, emergency, top3 }
 *                        scope: "primary" (best department only) | "all" (hospitals offering all three) | "any" (any nearby hospital)
 *   care-result-back     the person wants to edit the symptoms
 *   care-result-retry    the person wants to run the analysis again
 *
 * Attributes: emergency-number="999" (the call button), theme="light|dark" (or follows the system), --care-accent.
 */
(function () {
  "use strict";

  var MESSAGES = ["Reading your symptoms…", "Matching the right department…", "Putting your results together…"];

  var CSS = `
  :host{--ac:var(--care-accent,#0b8f7e);--acink:#fff;--sheet:#fff;--s1:#eaf0ed;--ink:#14302b;--mute:#5b756e;--line:#dce6e2;
    --hero1:#0d9886;--hero2:#066256;--heroink:#fff;--heromute:rgba(255,255,255,.8);--chip:#e3f4ef;--chipink:#06594e;--card:#f4f8f6;
    --em:#c62d20;--embg:#fdeceb;--emline:#f3bdb8;
    display:none;position:fixed;inset:0;z-index:50;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);
    -webkit-font-smoothing:antialiased}
  :host([open]){display:block}
  @media(prefers-color-scheme:dark){:host(:not([theme="light"])){--ac:var(--care-accent-dark,#3fcdb5);--acink:#052019;--sheet:#1a2624;--s1:#0f1816;--ink:#e8f2ef;--mute:#92aaa3;--line:#2a3b37;
    --hero1:#1f4540;--hero2:#122420;--heroink:#f1faf7;--heromute:rgba(232,242,239,.76);--chip:#21423b;--chipink:#9cf0de;--card:#1f2d2a;
    --em:#ff8a7e;--embg:#3d1d1a;--emline:#6b2d27}}
  :host([theme="dark"]){--ac:var(--care-accent-dark,#3fcdb5);--acink:#052019;--sheet:#1a2624;--s1:#0f1816;--ink:#e8f2ef;--mute:#92aaa3;--line:#2a3b37;
    --hero1:#1f4540;--hero2:#122420;--heroink:#f1faf7;--heromute:rgba(232,242,239,.76);--chip:#21423b;--chipink:#9cf0de;--card:#1f2d2a;
    --em:#ff8a7e;--embg:#3d1d1a;--emline:#6b2d27}
  *{box-sizing:border-box}
  .root{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--s1);animation:rise .45s cubic-bezier(.2,.8,.2,1)}
  @keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
  button{font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
  a{color:inherit}
  :focus-visible{outline:3px solid color-mix(in srgb,var(--ac) 70%,#fff);outline-offset:3px}

  /* ---------- states ---------- */
  .view{display:none;flex:1;min-height:0;flex-direction:column}
  [data-state="loading"] .v-loading,[data-state="result"] .v-result,[data-state="error"] .v-error{display:flex}

  /* ---------- RESULT ---------- */
  .hero{flex:none;position:relative;overflow:hidden;background:linear-gradient(160deg,var(--hero1),var(--hero2));color:var(--heroink);text-align:center;
    padding:calc(12px + env(safe-area-inset-top,0px)) 22px 44px}
  .hero::before,.hero::after{content:"";position:absolute;border-radius:50%;border:1.5px solid rgba(255,255,255,.14);pointer-events:none}
  .hero::before{width:300px;height:300px;right:-110px;top:-150px}.hero::after{width:200px;height:200px;left:-80px;bottom:-120px}
  .back{position:absolute;left:14px;top:calc(10px + env(safe-area-inset-top,0px));z-index:3;display:flex;align-items:center;gap:6px;border:0;border-radius:999px;
    padding:8px 14px 8px 10px;background:rgba(255,255,255,.16);color:var(--heroink);font-size:13.5px;font-weight:700;backdrop-filter:blur(6px)}
  .back:active{transform:scale(.96)}
  .badge{width:46px;height:46px;margin:6px auto 8px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.16);
    box-shadow:0 0 0 1px rgba(255,255,255,.28) inset,0 0 0 7px rgba(255,255,255,.07);position:relative;z-index:1}
  .badge svg{width:24px;height:24px}
  .eyebrow{margin:0 0 2px;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--heromute);position:relative;z-index:1}
  .title{margin:0;font-size:clamp(21px,3.5vh,27px);font-weight:850;letter-spacing:-.02em;line-height:1.1;position:relative;z-index:1}

  .sheet{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--sheet);margin-top:-26px;border-radius:26px 26px 0 0;position:relative;z-index:2}
  .scroll{flex:1;min-height:0;overflow:auto;padding:20px 22px 26px;-webkit-mask-image:linear-gradient(#000 calc(100% - 22px),transparent);mask-image:linear-gradient(#000 calc(100% - 22px),transparent);-webkit-overflow-scrolling:touch}
  .inner{max-width:560px;margin:0 auto}

  .alert{display:flex;align-items:center;gap:12px;margin:0 0 18px;padding:12px 14px;border-radius:16px;background:var(--embg);color:var(--em);border:1.5px solid var(--emline)}
  .alert[hidden]{display:none}
  .alert svg{flex:none;width:28px;height:28px}
  .alert b{flex:1;font-size:15.5px;line-height:1.3}
  .alert a{flex:none;text-decoration:none;border-radius:999px;padding:8px 14px;background:var(--em);color:var(--embg);font-weight:800;font-size:13.5px}
  .alert a[hidden]{display:none}

  .lead{margin:0 0 10px;font-size:clamp(18px,2.8vh,22px);line-height:1.55;font-weight:700;letter-spacing:-.01em;text-wrap:pretty}
  .sub{margin:0 0 16px;font-size:15px;line-height:1.55;color:var(--mute);text-wrap:pretty}
  .dp{display:inline;padding:.06em .45em .1em;border-radius:.6em;background:var(--chip);color:var(--chipink);font-weight:800;-webkit-box-decoration-break:clone;box-decoration-break:clone}
  .dp.main{background:var(--ac);color:var(--acink)}

  .cards{list-style:none;margin:0 0 6px;padding:0;display:flex;flex-direction:column;gap:10px}
  .card{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:16px;background:var(--card);border:1.5px solid transparent}
  .card.main{border-color:color-mix(in srgb,var(--ac) 55%,transparent);background:color-mix(in srgb,var(--ac) 9%,var(--card))}
  .card .n{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--chip);color:var(--chipink);font-weight:850;font-size:13px;margin-top:1px}
  .card.main .n{background:var(--ac);color:var(--acink)}
  .card h3{margin:0;font-size:16px;font-weight:800;letter-spacing:-.01em;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}
  .card h3 small{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
  .card p{margin:2px 0 0;font-size:13.5px;line-height:1.45;color:var(--mute)}

  .tips{margin:0 0 6px;padding:14px 16px;border-radius:16px;background:var(--card);font-size:14.5px;line-height:1.5;color:var(--mute)}
  .tips b{color:var(--ink)}

  .actions{flex:none;padding:14px 22px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);background:var(--sheet);text-align:center}
  .htext{margin:0 auto 12px;max-width:44ch;font-size:15px;font-weight:650;line-height:1.4;color:var(--ink);text-wrap:balance}
  .htext:empty{display:none}
  .hbtns{display:flex;flex-direction:column;gap:9px;width:100%;max-width:420px;margin:0 auto;align-items:stretch}
  .mapbtn{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:54px;padding:9px 18px;border-radius:18px;text-align:left;
    border:1.5px solid var(--line);background:var(--sheet);color:var(--ink);font-weight:800;font-size:16px;transition:transform .15s,box-shadow .15s;
    box-shadow:0 8px 22px -12px rgba(10,50,44,.5)}
  .mapbtn:hover{box-shadow:0 12px 26px -12px rgba(10,50,44,.55)}.mapbtn:active{transform:scale(.97)}
  .mapbtn svg{flex:none;width:26px;height:26px}
  .mapbtn .bt{display:flex;flex-direction:column;gap:1px;min-width:0}.mapbtn .bt small{font-size:12px;font-weight:600;color:var(--mute);line-height:1.25}
  .mapbtn.go{background:var(--ac);color:var(--acink);border-color:transparent}.mapbtn.go .bt small{color:inherit;opacity:.85}
  .mapbtn.alt{background:transparent;box-shadow:none;border-style:dashed}.mapbtn.alt:hover{background:var(--card)}
  .fine{margin:11px auto 0;font-size:11.5px;color:var(--mute);max-width:40ch;line-height:1.4}

  .shown .badge{animation:pop .5s cubic-bezier(.2,.9,.3,1.3) both}
  .shown .inner>*,.shown .cards>*{animation:up .5s cubic-bezier(.2,.8,.2,1) both}
  .shown .cards>*:nth-child(2){animation-delay:.1s}.shown .cards>*:nth-child(3){animation-delay:.2s}
  @keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
  @keyframes up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

  /* ---------- LOADING / ERROR ---------- */
  .v-loading,.v-error{background:linear-gradient(170deg,var(--hero1),var(--hero2));color:var(--heroink);align-items:center;justify-content:center;text-align:center;
    padding:calc(24px + env(safe-area-inset-top,0px)) 28px calc(24px + env(safe-area-inset-bottom,0px))}
  .pulse{position:relative;width:188px;height:188px;display:grid;place-items:center;margin-bottom:34px}
  .pulse b{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,255,255,.55);animation:ring 2.6s cubic-bezier(.2,.6,.3,1) infinite}
  .pulse b:nth-child(2){animation-delay:.85s}.pulse b:nth-child(3){animation-delay:1.7s}
  @keyframes ring{from{transform:scale(.42);opacity:.9}to{transform:scale(1.12);opacity:0}}
  .core{position:relative;width:112px;height:112px;border-radius:50%;background:rgba(255,255,255,.14);display:grid;place-items:center;backdrop-filter:blur(4px);
    box-shadow:0 0 0 1px rgba(255,255,255,.25) inset}
  .core svg{width:84px;height:48px;overflow:visible}
  .ecg{fill:none;stroke:var(--heroink);stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:260;stroke-dashoffset:260;animation:draw 2.1s linear infinite}
  @keyframes draw{0%{stroke-dashoffset:260}60%{stroke-dashoffset:0}100%{stroke-dashoffset:-260}}
  .ltitle{margin:0 0 10px;font-size:clamp(23px,3.6vh,29px);font-weight:850;letter-spacing:-.015em}
  .lmsg{height:26px;margin:0;font-size:16.5px;font-weight:600;color:var(--heromute);position:relative;width:100%}
  .lmsg span{position:absolute;left:0;right:0;opacity:0;transform:translateY(8px);transition:opacity .45s,transform .45s}
  .lmsg span.on{opacity:1;transform:none}
  .bar{margin:26px auto 0;width:min(240px,64vw);height:5px;border-radius:5px;background:rgba(255,255,255,.2);overflow:hidden}
  .bar i{display:block;width:40%;height:100%;border-radius:5px;background:var(--heroink);animation:slide 1.5s ease-in-out infinite}
  @keyframes slide{from{transform:translateX(-110%)}to{transform:translateX(280%)}}
  .slow{margin:18px 0 0;font-size:13.5px;color:var(--heromute);opacity:0;transition:opacity .6s;min-height:20px}.slow.on{opacity:1}
  .ghost{margin-top:26px;border:1.5px solid rgba(255,255,255,.4);background:transparent;color:var(--heroink);border-radius:999px;padding:10px 22px;font-weight:700;font-size:14.5px}
  .solid{border:0;background:var(--heroink);color:var(--hero2);border-radius:18px;padding:15px 30px;font-weight:800;font-size:16px;min-width:200px}
  .v-error .eicon{width:76px;height:76px;border-radius:50%;background:rgba(255,255,255,.16);display:grid;place-items:center;margin-bottom:22px}
  .v-error p{margin:0 0 24px;max-width:30ch;line-height:1.45;color:var(--heromute);font-size:15.5px}
  .v-error .btns{display:flex;flex-direction:column;gap:2px;align-items:center}
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  @media (max-height:560px){.pulse{width:130px;height:130px;margin-bottom:18px}.core{width:80px;height:80px}.core svg{width:56px}.badge{display:none}.hero{padding-bottom:44px}}
  `;

  var IC = {
    pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg>',
    stetho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v6a4 4 0 008 0V3"/><path d="M5 3h2M13 3h2"/><path d="M10 13v2a5 5 0 0010 0v-1"/><circle cx="20" cy="12" r="2"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8.5v5M8.5 11h5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.1"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="pin"><path d="M12 1.6C7.3 1.6 3.6 5.2 3.6 9.8c0 6 8.4 12.6 8.4 12.6s8.4-6.6 8.4-12.6c0-4.6-3.7-8.2-8.4-8.2z"/></clipPath></defs><g clip-path="url(#pin)"><rect x="0" y="0" width="24" height="24" fill="#34a853"/><path d="M0 0H12L3 14.5H0z" fill="#fbbc04"/><path d="M0 0H14L12 7.2 3.6 9.8 0 8z" fill="#ea4335"/><path d="M14 0H24V15L12 11 12 7.2z" fill="#4285f4"/></g><circle cx="12" cy="9.8" r="3.1" fill="#fff"/></svg>',
    body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.6"/><path d="M12 8.5v6.5M7 10.5l5-1.5 5 1.5M9 21l3-6 3 6"/></svg>',
    near: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
  };

  var HTML = `
  <div class="root" data-state="idle">
    <!-- LOADING -->
    <section class="view v-loading" role="status" aria-live="polite" aria-label="Analysing your symptoms">
      <div class="pulse"><b></b><b></b><b></b>
        <div class="core"><svg viewBox="0 0 84 48" aria-hidden="true"><path class="ecg" d="M2 26 H20 L27 26 L33 8 L42 42 L49 17 L54 26 H82"/></svg></div></div>
      <h2 class="ltitle">Analysing your symptoms</h2>
      <p class="lmsg" id="lmsg"></p>
      <div class="bar"><i></i></div>
      <p class="slow" id="slow"></p>
      <button class="ghost" data-act="back">Cancel</button>
    </section>

    <!-- ERROR -->
    <section class="view v-error" role="alert">
      <div class="eicon"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.1"/></svg></div>
      <h2 class="ltitle">We couldn't finish</h2>
      <p id="emsg">The analysis service didn't respond. Please check your connection and try again.</p>
      <div class="btns"><button class="solid" data-act="retry">Try again</button><button class="ghost" data-act="back">Edit symptoms</button></div>
    </section>

    <!-- RESULT -->
    <section class="view v-result" aria-live="polite">
      <header class="hero">
        <button class="back" data-act="back" aria-label="Back to symptoms"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Edit</button>
        <div class="badge" id="badge"></div>
        <p class="eyebrow" id="eyebrow">Your result</p>
        <h1 class="title" id="title"></h1>
      </header>
      <div class="sheet">
        <div class="scroll"><div class="inner">
          <div class="alert" id="alert" role="alert" hidden>${IC.warn}<b>The symptoms might be an emergency.</b><a id="call" href="tel:999">Call 999</a></div>
          <div id="body"></div>
        </div></div>
        <footer class="actions">
          <p class="htext" id="htext"></p>
          <div class="hbtns" id="hbtns"></div>
          <p class="fine">This is guidance, not a medical diagnosis. If you feel unsafe, contact emergency services.</p>
        </footer>
      </div>
    </section>
  </div>`;

  /* short plain-language descriptions, matched on the department name (works for spelling variants) */
  var DESCS = [
    [/\bent\b|otolaryn|ear,? nose/i, "Ear, nose and throat: ear pain, blocked nose, sore throat, hearing problems."],
    [/cardio/i, "Heart and blood vessels: chest pain, palpitations, blood pressure."],
    [/neuro/i, "Brain and nerves: headache, dizziness, numbness, seizures."],
    [/respir|pulmon|chest med/i, "Lungs and airways: cough, wheezing, breathing difficulty."],
    [/infect/i, "Infections such as fever, flu, typhoid, dengue or stomach bugs."],
    [/h(a)?emat/i, "Blood health: anaemia, easy bruising, clotting problems."],
    [/endocr|nutrition|diabet|thyroid/i, "Hormones, diabetes, thyroid, weight and nutrition."],
    [/gastro|hepat|digest|liver/i, "Stomach, bowel and liver: stomach pain, vomiting, loose stools."],
    [/rheum|ortho|musculo|bone/i, "Joints, bones and muscles: joint pain, swelling, stiffness, back pain."],
    [/nephro|uro|kidney/i, "Kidneys, bladder and urinary problems, such as painful or frequent urination."],
    [/derm|skin/i, "Skin, hair and nails: rashes, itching, acne, moles."],
    [/ophthal|\beye\b/i, "Eyes and vision: redness, eye pain, blurred vision."],
    [/dent|oral|maxillo/i, "Teeth, gums and mouth: toothache, swollen gums."],
    [/gyn|obstet|women|maternal/i, "Women’s reproductive health, periods and pregnancy."],
    [/p(a)?ediatr|child/i, "Health care for babies and children."],
    [/psych|mental/i, "Mental health: mood, anxiety, sleep and stress."],
    [/emergen|trauma|critical/i, "Urgent and life-threatening problems and injuries."],
    [/general|internal|family|primary/i, "General health problems and a first check-up."]
  ];
  function descOf(name) { for (var i = 0; i < DESCS.length; i++) if (DESCS[i][0].test(name)) return DESCS[i][1]; return "Specialist care for this area of health."; }

  /* predict (any accepted shape) -> { mode, departments:[{label,score}] } or null */
  function norm(p) {
    if (!p) return null;
    var arr = p.departments || p.top3 || p.top_3 || p.predictions || p.results || (Array.isArray(p) ? p : null);
    if (!arr || !arr.length) return null;
    var items = arr.map(function (x) {
      if (typeof x === "string") return { label: x };
      if (Array.isArray(x)) return { label: x[0], score: x[1] };
      return { label: x.label || x.specialty || x.department || x.name, score: x.score != null ? x.score : x.probability };
    }).filter(function (x) { return x.label; });
    if (!items.length) return null;
    return { mode: p.mode === "multi" || p.mode === "unsure" ? p.mode : "single", top3Sum: p.top3_sum, departments: items };
  }
  function isEmergency(r) {
    if (!r) return false;
    if (r.emergency != null) return r.emergency === true || String(r.emergency).toLowerCase() === "true";
    return String(r.risk || "").toLowerCase() === "high"; // older risk service
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pill(name, main) { return '<span class="dp' + (main ? " main" : "") + '">' + esc(name) + "</span>"; }
  function joinNames(names, main) {
    var p = names.map(function (n, i) { return pill(n, main && i === 0); });
    return p.length < 2 ? p.join("") : p.slice(0, -1).join(", ") + " and " + p[p.length - 1];
  }
  function card(name, desc, cls, tag, n) {
    return '<li class="card ' + cls + '"><span class="n">' + n + '</span><div><h3>' + esc(name) + (tag ? "<small>" + tag + "</small>" : "") + "</h3><p>" + esc(desc) + "</p></div></li>";
  }
  function btn(cls, act, scope, icon, title, sub) {
    return '<button class="mapbtn ' + cls + '" data-act="' + act + '"' + (scope ? ' data-scope="' + scope + '"' : "") + ">" + icon +
      '<span class="bt"><span>' + esc(title) + "</span>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span></button>";
  }

  /* everything that depends on the mode */
  function view(mode, names) {
    if (mode === "single") return {
      icon: IC.stetho, eyebrow: "Your result", title: "Most likely department",
      body: '<p class="lead">The most likely department related to your symptoms is ' + pill(names[0], true) + ".</p>" +
        (names.length > 1 ? '<p class="sub">Even though this is the most likely department, your symptoms might also be related to ' + joinNames(names.slice(1)) + ".</p>" : "") +
        '<ul class="cards">' + names.map(function (n, i) { return card(n, descOf(n), i ? "" : "main", i ? "Also possible" : "Most likely", i + 1); }).join("") + "</ul>",
      htext: "We have some suggested hospitals for you. Open maps to view them.",
      btns: btn("go", "hospitals", "primary", IC.pin, "Open maps", "Hospitals with " + names[0]) +
        (names.length > 1 ? btn("alt", "hospitals", "all", IC.pin, "Take the safer step", "Hospitals with all three departments") : "")
    };
    if (mode === "multi") return {
      icon: IC.pulse, eyebrow: "Your result", title: "Possible departments",
      body: '<p class="lead">Your symptoms are most likely related to ' + joinNames(names) + ".</p>" +
        '<p class="sub">We couldn’t pinpoint the department which is related to your symptoms.</p>' +
        '<ul class="cards">' + names.map(function (n, i) { return card(n, descOf(n), "", "", i + 1); }).join("") + "</ul>",
      htext: "We have some suggested hospitals for you, each of which has all the three departments. Open maps to view them.",
      btns: btn("go", "hospitals", "all", IC.pin, "Open maps", "Hospitals with all three departments")
    };
    return {
      icon: IC.search, eyebrow: "Your result", title: "We need a bit more detail",
      body: '<p class="lead">Your symptoms were not enough to make suggestions.</p>' +
        '<p class="sub">Try using the 3D input system and more specific symptoms.</p>' +
        '<div class="tips"><b>Tip:</b> tap the part of the body that hurts, then choose what you feel. Add how strong it is and when it started.</div>',
      htext: "",
      btns: btn("go", "back", "", IC.body, "Use the 3D input", "Describe your symptoms more precisely") +
        btn("alt", "hospitals", "any", IC.near, "Show any nearby hospital", "Not specific to a department")
    };
  }

  class CareResultScreen extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = "<style>" + CSS + "</style>" + HTML;
      var $ = this.q = function (s) { return this.shadowRoot.querySelector(s); }.bind(this);
      this.root = $(".root"); this._t = {}; this._data = null;
      this.shadowRoot.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]"); if (!b) return; var a = b.getAttribute("data-act");
        if (a === "back") { this._stopTimers(); this._emit("care-result-back"); this.hide(); }
        else if (a === "retry") this._emit("care-result-retry");
        else if (a === "hospitals" && this._data) this._emit("care-open-hospitals", Object.assign({}, this._data, { scope: b.getAttribute("data-scope") || "primary" }));
      }.bind(this));
    }
    _emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail: detail || {} })); }
    _state(s) { this.root.setAttribute("data-state", s); this.setAttribute("open", ""); }
    _stopTimers() { clearInterval(this._t.msg); clearTimeout(this._t.slow); }

    /* ---- public API ---- */
    hide() { this._stopTimers(); this.removeAttribute("open"); this.root.setAttribute("data-state", "idle"); }

    showLoading() {
      this._stopTimers(); this._state("loading");
      var box = this.q("#lmsg"), slow = this.q("#slow"), i = 0;
      slow.className = "slow"; slow.textContent = "";
      box.innerHTML = MESSAGES.map(function (m) { return "<span>" + m + "</span>"; }).join("");
      var spans = box.children, step = function () { for (var k = 0; k < spans.length; k++) spans[k].classList.toggle("on", k === i % spans.length); i++; };
      step(); this._t.msg = setInterval(step, 2000);
      this._t.slow = setTimeout(function () { slow.textContent = "Still working, this can take a few seconds."; slow.classList.add("on"); }, 8000);
    }

    showError(message) {
      this._stopTimers(); this._state("error");
      if (message) this.q("#emsg").textContent = message;
    }

    showResult(res) {
      var pr = norm(res && res.predict);
      if (!pr) { this.showError("We got no answer from the analysis. Please try again."); return; }
      this._stopTimers();
      var mode = pr.mode, deps = pr.departments.slice(0, 3), names = deps.map(function (d) { return d.label; });
      var emergency = isEmergency(res.risk);
      this._data = { department: names[0], mode: mode, departments: names, emergency: emergency, top3_sum: pr.top3Sum,
                     top3: deps.map(function (d) { return { label: d.label, score: d.score }; }) };

      var v = view(mode, names);
      this.q("#badge").innerHTML = v.icon;
      this.q("#eyebrow").textContent = v.eyebrow;
      this.q("#title").textContent = v.title;
      this.q("#body").innerHTML = v.body;
      this.q("#htext").textContent = v.htext;
      this.q("#hbtns").innerHTML = v.btns;

      this.q("#alert").hidden = !emergency;
      var num = this.getAttribute("emergency-number"), call = this.q("#call");
      call.hidden = !num; if (num) { call.href = "tel:" + num; call.textContent = "Call " + num; }

      var vw = this.q(".v-result"); vw.classList.remove("shown");
      this._state("result"); this.q(".scroll").scrollTop = 0;
      void vw.offsetWidth; vw.classList.add("shown");
    }
  }
  if (!customElements.get("care-result-screen")) customElements.define("care-result-screen", CareResultScreen);
})();
