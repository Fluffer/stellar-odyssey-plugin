// The engine-cooldown alert as it runs INSIDE the game page.
//
// Shared by two delivery paths:
//   - lib/injected.js evaluates it in the Steam client over the DevTools
//     protocol (plugin.js is the host);
//   - build-extension.js bundles it into extension/content.js, a browser
//     extension content script for the web version of the game.
//
// So: ES2017 only, no require/import, no Node APIs. The source text of this
// file is concatenated into other scripts; `installEngineAlert` must stay a
// plain function declaration. It calls installGalaxyInfo (lib/page-galaxy.js),
// which is concatenated alongside.
//
// installEngineAlert(SCHED, cfg, VERSION, LS_ENABLED) -> api
//   SCHED      the exports of lib/schedule.js
//   cfg        { leadMs, stepMs, afterMs, volume, pollMs, button, console, galaxy }
//   VERSION    plugin version string, used by the host to detect stale installs
//   LS_ENABLED localStorage key for the on/off choice
// The api is also stored on window.__soEngineAlert. Installing again first
// stops the previous instance.

function installEngineAlert(SCHED, cfg, VERSION, LS_ENABLED) {
  var GLOBAL = "__soEngineAlert";
  var LS_PREFIX = LS_ENABLED.replace(/enabled$/, "");
  // Language: English keys, Simplified Chinese catalogue (lib/i18n.js).
  var I18N = typeof createI18n === "function" ? createI18n(LS_PREFIX + "lang") : {
    t: function (k, v) { return String(k).replace(/\{(\w+)\}/g, function (m, x) { return v && x in v ? v[x] : m; }); },
    lang: function () { return "en"; }, setLang: function () {}, toggle: function () {}, langs: ["en"],
  };
  var t = I18N.t;
  var prev = window[GLOBAL];
  if (prev && typeof prev.stop === "function") { try { prev.stop(); } catch (e) {} }

  var events = [];
  function log(type, data) {
    var ev = Object.assign({ t: Date.now(), type: type }, data || {});
    events.push(ev);
    if (events.length > 200) events.splice(0, events.length - 200);
    if (cfg.console && typeof console !== "undefined") {
      try { console.log("[EngineAlert]", type, JSON.stringify(data || {})); } catch (e) {}
    }
  }

  // --- on/off ------------------------------------------------------------
  var enabled = (function () {
    try { var v = localStorage.getItem(LS_ENABLED); return v === null ? true : v === "1"; }
    catch (e) { return true; }
  })();
  function setEnabled(on, source) {
    enabled = !!on;
    try { localStorage.setItem(LS_ENABLED, enabled ? "1" : "0"); } catch (e) {}
    log("toggle", { enabled: enabled, source: source || "api" });
    render();
    return enabled;
  }

  // --- game state -------------------------------------------------------
  var store = null;
  function findPinia() {
    var all = document.querySelectorAll("*");
    var el = null;
    for (var i = 0; i < all.length; i++) { if (all[i].__vue_app__) { el = all[i]; break; } }
    if (!el) return null;
    var pinia = el.__vue_app__.config.globalProperties.$pinia;
    return pinia && pinia._s ? pinia : null;
  }
  function getStoreById(id) {
    var pinia = findPinia();
    return pinia ? (pinia._s.get(id) || null) : null;
  }
  function findStore() { return getStoreById("ExploreStore"); }
  function getState() {
    if (!store) store = findStore();
    if (!store) return null;
    var s = store.$state;
    if (!s) { store = null; return null; }
    return s;
  }

  // --- audio ------------------------------------------------------------
  var ctx = null;
  function getCtx() {
    if (!ctx || ctx.state === "closed") {
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  // Rising burst of beeps; count, pitch, loudness and length grow with stage.
  function play(stage) {
    try {
      var c = getCtx();
      var it = SCHED.intensityFor(stage, cfg.volume);
      var t = c.currentTime + 0.02;
      for (var i = 0; i < it.beeps; i++) {
        var osc = c.createOscillator();
        var g = c.createGain();
        osc.type = it.wave;
        osc.frequency.value = it.freqHz * (1 + 0.05 * i);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(it.gain, t + 0.01);
        g.gain.setValueAtTime(it.gain, t + it.beepSec - 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + it.beepSec);
        osc.connect(g).connect(c.destination);
        osc.start(t);
        osc.stop(t + it.beepSec + 0.01);
        t += it.beepSec + it.gapSec;
      }
      return { ok: c.state === "running", state: c.state, beeps: it.beeps };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // --- draggable overlays ----------------------------------------------
  // makeDraggable(el, lsKey, onClick, defaultPlace): the element can be
  // dragged anywhere; the position is remembered under lsKey. A press that
  // moves less than a few pixels is a click (onClick, may be null). While no
  // position is saved, defaultPlace(el) is applied on every tick so the
  // element follows the game's layout (footer growing, page changes).
  var draggables = [];
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function savedPos(lsKey) {
    try {
      var p = JSON.parse(localStorage.getItem(lsKey) || "null");
      return p && typeof p.x === "number" && typeof p.y === "number" ? p : null;
    } catch (e) { return null; }
  }
  function placeEl(d) {
    var el = d.el;
    if (!el || !document.body.contains(el)) return;
    // Never touch an element mid-drag: the tick would snap it back to its
    // default spot before the release had a chance to save the new one.
    if (d.dragging) return;
    var p = savedPos(d.lsKey);
    if (p) {
      var w = el.offsetWidth || 200, h = el.offsetHeight || 30;
      el.style.left = clamp(p.x, 0, Math.max(0, window.innerWidth - w)) + "px";
      el.style.top = clamp(p.y, 0, Math.max(0, window.innerHeight - h)) + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    } else if (d.defaultPlace) {
      d.defaultPlace(el);
    }
  }
  function makeDraggable(el, lsKey, onClick, defaultPlace) {
    var d = { el: el, lsKey: lsKey, defaultPlace: defaultPlace };
    draggables.push(d);
    var drag = null;
    el.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      var r = el.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, x: r.left, y: r.top, moved: false, target: e.target };
      d.dragging = true;
      e.preventDefault();
    });
    window.addEventListener("mousemove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      drag.x = clamp(drag.ox + dx, 0, window.innerWidth - el.offsetWidth);
      drag.y = clamp(drag.oy + dy, 0, window.innerHeight - el.offsetHeight);
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.left = drag.x + "px";
      el.style.top = drag.y + "px";
    });
    window.addEventListener("mouseup", function () {
      if (!drag) return;
      var dd = drag; drag = null;
      d.dragging = false;
      if (dd.moved) {
        // Save where the drag put it, not where a tick may have moved it.
        var pos = { x: Math.round(dd.x), y: Math.round(dd.y) };
        try { localStorage.setItem(lsKey, JSON.stringify(pos)); } catch (err) {}
        el.style.right = "auto"; el.style.bottom = "auto";
        el.style.left = pos.x + "px"; el.style.top = pos.y + "px";
        log("moved", { what: el.id, x: pos.x, y: pos.y });
      } else if (onClick) {
        onClick(dd.target);
      }
    });
    window.addEventListener("resize", function () { placeEl(d); });
    placeEl(d);
  }
  function placeAll() { for (var i = 0; i < draggables.length; i++) placeEl(draggables[i]); }

  // --- button -----------------------------------------------------------
  // Default spot: right edge, above whatever the game stacks in the
  // bottom-right corner (the chat footer everywhere, the minimap on the
  // galaxy page), so it never covers the chat's Send button.
  var LS_POS = LS_PREFIX + "pos";
  var btn = null;
  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var sec = String(s % 60);
    return Math.floor(s / 60) + ":" + (sec.length < 2 ? "0" + sec : sec);
  }
  function placeButtonDefault(el) {
    var top = window.innerHeight;
    var stack = document.querySelectorAll(".q-footer, .galaxy-minimap");
    for (var i = 0; i < stack.length; i++) {
      var r = stack[i].getBoundingClientRect();
      if (r.height > 0 && r.top > 0 && r.right > window.innerWidth - 320 && r.top < top) top = r.top;
    }
    var bottom = Math.round(window.innerHeight - top) + 12;
    el.style.left = "auto";
    el.style.top = "auto";
    el.style.right = "12px";
    el.style.bottom = bottom + "px";
  }
  function ensureButton() {
    if (!cfg.button || !document.body) return;
    if (btn && document.body.contains(btn)) return;
    btn = document.createElement("div");
    btn.id = "soEngineAlertBtn";
    btn.title = t("Engine cooldown alert - click to switch on/off, drag to move");
    btn.style.cssText = [
      "position:fixed", "z-index:2147483000",
      "font:13px/1.2 Rubik,sans-serif", "color:#fff", "background:rgba(10,20,40,0.85)",
      "border:1px solid rgba(255,255,255,0.25)", "border-radius:16px", "padding:6px 12px",
      "cursor:pointer", "user-select:none", "white-space:nowrap",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    ].join(";");
    btn.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(btn);
    makeDraggable(btn, LS_POS, function () { setEnabled(!enabled, "button"); }, placeButtonDefault);
    render();
  }
  // Language button: a small pill glued to the left of the alert pill.
  var langBtn = null;
  function ensureLangButton() {
    if (!cfg.button || !document.body || I18N.langs.length < 2) return;
    if (langBtn && document.body.contains(langBtn)) return;
    langBtn = document.createElement("div");
    langBtn.id = "soEngineAlertLang";
    langBtn.style.cssText = [
      "position:fixed", "z-index:2147483000",
      "font:12px/1.2 Rubik,sans-serif", "color:#fff", "background:rgba(10,20,40,0.85)",
      "border:1px solid rgba(255,255,255,0.25)", "border-radius:14px", "padding:5px 9px",
      "cursor:pointer", "user-select:none", "white-space:nowrap",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    ].join(";");
    langBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      I18N.toggle();
      log("lang", { lang: I18N.lang() });
      render();
    });
    document.body.appendChild(langBtn);
  }
  function placeLangButton() {
    if (!langBtn || !btn) return;
    var r = btn.getBoundingClientRect();
    if (!(r.width > 0)) { langBtn.style.display = "none"; return; }
    langBtn.style.display = "block";
    langBtn.style.left = Math.max(0, Math.round(r.left - langBtn.offsetWidth - 6)) + "px";
    langBtn.style.top = Math.round(r.top + (r.height - langBtn.offsetHeight) / 2) + "px";
  }
  function render() {
    if (!btn) return;
    var txt;
    if (!enabled) txt = "🔕 " + t("Engine alert OFF");
    else if (!status.loaded) txt = "🔔 " + t("Engine alert ON");
    else if (status.remainingMs > 0) txt = "🔔 " + t("Engine alert ON") + " · " + t("ready in {t}", { t: mmss(status.remainingMs) });
    else txt = "🔔 " + t("Engine alert ON") + " · " + t("engine ready");
    if (btn.textContent !== txt) btn.textContent = txt;
    btn.style.opacity = enabled ? "1" : "0.6";
    btn.title = t("Engine cooldown alert - click to switch on/off, drag to move");
    if (langBtn) {
      var lt = I18N.lang() === "zh" ? "EN" : "中文";
      if (langBtn.textContent !== lt) langBtn.textContent = lt;
      langBtn.title = t("Switch language");
      placeLangButton();
    }
    // Low fuel (galaxy overlay): amber pill so it shows on every page.
    var low = false;
    try { low = !!(galaxy && galaxy.lowFuel && galaxy.lowFuel()); } catch (e) {}
    var bg = low ? "rgba(120,70,0,0.9)" : "rgba(10,20,40,0.85)";
    if (btn.style.background !== bg) btn.style.background = bg;
  }

  // --- galaxy map overlay ----------------------------------------------
  var galaxy = null;
  if (cfg.galaxy !== false && typeof installGalaxyInfo === "function") {
    try {
      galaxy = installGalaxyInfo({
        cfg: cfg, log: log, makeDraggable: makeDraggable, lsPrefix: LS_PREFIX, t: t,
        getStore: function () { getState(); return store; },
        getStoreById: getStoreById,
      });
    } catch (e) { log("error", { where: "galaxy", error: String(e) }); }
  }

  // --- other page overlays (pets, laboratory) ----------------------------
  // Each is a plain function concatenated alongside; each returns
  // { tick, stop }. The advisor's math modules arrive as PetMath / LabMath
  // globals of the bundle scope (see lib/injected.js / build-extension.js).
  var pages = [];
  if (cfg.pages !== false) {
    var pageCtx = { cfg: cfg, log: log, makeDraggable: makeDraggable, lsPrefix: LS_PREFIX, getStoreById: getStoreById, t: t,
      MergeMath: typeof MergeMath !== "undefined" ? MergeMath : null };
    try {
      if (typeof installPetsInfo === "function" && typeof PetMath !== "undefined") pages.push(installPetsInfo(Object.assign({ PetMath: PetMath }, pageCtx)));
    } catch (e) { log("error", { where: "pets", error: String(e) }); }
    try {
      if (typeof installLabInfo === "function" && typeof LabMath !== "undefined") pages.push(installLabInfo(Object.assign({ LabMath: LabMath }, pageCtx)));
    } catch (e) { log("error", { where: "lab", error: String(e) }); }
    try {
      if (typeof installMorePages === "function") pages = pages.concat(installMorePages(pageCtx));
    } catch (e) { log("error", { where: "more pages", error: String(e) }); }
  }

  // --- watcher ----------------------------------------------------------
  var tracker = SCHED.createTracker(cfg);
  var status = { loaded: false, remainingMs: null, stage: -1, cycleEnd: null, travelling: false };
  function tick() {
    ensureButton();
    ensureLangButton();
    placeAll();
    var s = getState();
    if (galaxy) { try { galaxy.tick(s); } catch (e) { log("error", { where: "galaxy tick", error: String(e) }); } }
    for (var pi = 0; pi < pages.length; pi++) { try { pages[pi].tick(s); } catch (e) { log("error", { where: "page tick", error: String(e) }); } }
    if (!s || !s.engineCooldownLoaded) { status.loaded = false; render(); return; }
    var now = Date.now();
    var r = tracker.update(s.engineCooldown, now);
    status = {
      loaded: true, remainingMs: r.remainingMs, stage: tracker._state.lastStage,
      cycleEnd: s.engineCooldown, travelling: !!s.isTravelling,
    };
    if (r.newCycle) log("cycle", { readyAt: s.engineCooldown, remainingMs: r.remainingMs, silent: tracker._state.lastStage >= 0 });
    if (r.fire !== null) {
      if (enabled) {
        var audio = play(r.fire);
        log("alert", { stage: r.fire, remainingMs: r.remainingMs, audio: audio });
      } else {
        log("alert", { stage: r.fire, remainingMs: r.remainingMs, muted: true });
      }
    }
    render();
  }
  log("installed", { version: VERSION, cfg: cfg, enabled: enabled });
  var timer = setInterval(tick, cfg.pollMs);
  try { tick(); } catch (e) { log("error", { error: String(e) }); }

  // Plays every stage once, softest to loudest, so the escalation can be heard.
  function demo() {
    var n = SCHED.maxStage(cfg);
    var spacing = 1500;
    var _loop = function (k) {
      setTimeout(function () { var a = play(k); log("demo", { stage: k, audio: a }); }, k * spacing);
    };
    for (var k = 0; k <= n; k++) _loop(k);
    return { stages: n + 1, durationMs: (n + 1) * spacing };
  }

  var api = {
    version: VERSION,
    cfg: cfg,
    installedAt: Date.now(),
    drain: function () { return events.splice(0); },
    status: function () { return Object.assign({ enabled: enabled }, status); },
    setEnabled: setEnabled,
    play: play,
    demo: demo,
    galaxy: galaxy,
    pages: pages,
    i18n: I18N,
    stop: function () {
      clearInterval(timer);
      if (ctx) { try { ctx.close(); } catch (e) {} }
      if (galaxy) { try { galaxy.stop(); } catch (e) {} }
      for (var pi = 0; pi < pages.length; pi++) { try { pages[pi].stop(); } catch (e) {} }
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
      if (langBtn && langBtn.parentNode) langBtn.parentNode.removeChild(langBtn);
      btn = null; langBtn = null;
      delete window[GLOBAL];
    },
  };
  window[GLOBAL] = api;
  return api;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { installEngineAlert };
}
