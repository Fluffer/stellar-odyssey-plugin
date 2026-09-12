// Laboratory-page overlay, running INSIDE the game page.
//
// The game's queue statistics already show progress and "ready to collect".
// This adds, from the advisor's chain math (lib/lab-math.js):
//   - the chain planner for a warp-capsule target: which raw resource binds
//     and by how much, the critical building, and the chain time both
//     pipelined (claim and re-queue every 10 min) and sequential;
//   - what each building has to run for that target (units, hours);
//   - queue health: idle slots, per-queue claim-cooldown readiness, the time
//     each queue finishes.
//
// Same rules as the other page files: ES2017, no Node APIs, plain function
// declaration; concatenated into the injected script and the extension.
//
// installLabInfo(ctx) -> { tick(), stop() }
//   ctx: { cfg, log, makeDraggable, lsPrefix, getStoreById, LabMath }

function installLabInfo(ctx) {
  var log = ctx.log;
  var makeDraggable = ctx.makeDraggable;
  var getStoreById = ctx.getStoreById;
  var LM = ctx.LabMath;
  var LS_PANEL_POS = ctx.lsPrefix + "labPos";
  var LS_TARGET = ctx.lsPrefix + "labTarget";
  var CLAIM_COOLDOWN_MS = 10 * 60000;
  var PRODUCT = "warp capsule";

  var panel = null;
  var target = (function () { var v = Number(localStorage.getItem(LS_TARGET)); return v > 0 ? Math.floor(v) : 10; })();
  var last = { sig: null, plan: null };

  function onPage() { return /#\/laboratory/.test(location.hash); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function hoursText(h) {
    if (!isFinite(h)) return "never";
    var mins = Math.round(h * 60);
    if (mins < 60) return mins + "m";
    var d = Math.floor(mins / 1440), hh = Math.floor((mins % 1440) / 60), mm = mins % 60;
    return (d ? d + "d " : "") + hh + "h" + (mm < 10 ? "0" : "") + mm + "m";
  }
  function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function state(id) { var s = getStoreById(id); return s ? s.$state : null; }

  // --- stocks and plan ----------------------------------------------------
  function readStocks() {
    var stocks = {};
    var cur = state("CurrencyStore") || {};
    for (var k in cur) if (typeof cur[k] === "number") stocks[LM.normName(k)] = cur[k];
    var mat = state("MaterialsStore") || {};
    var list = Array.isArray(mat.materialsList) ? mat.materialsList : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].item && list[i].item.name) stocks[LM.normName(list[i].item.name)] = num(list[i].quantity);
    return stocks;
  }
  function queueSlots() {
    var prem = state("PremiumStore") || {}, us = state("UserStore") || {};
    return (prem.active ? 6 : 4) + num(us.additionalQueueSlots);
  }
  function readPlan() {
    var lab = state("LaboratoryStore");
    if (!lab || !Array.isArray(lab.buildings) || !lab.buildings.length) return null;
    var stocks = readStocks();
    var queue = Array.isArray(lab.labQueue) ? lab.labQueue : [];
    var slots = queueSlots();
    var freeSlots = Math.max(0, slots - queue.length);
    var sig = JSON.stringify([target, slots, queue.length, lab.buildings.map(function (b) { return [b.building, b.level, b.timer, b.input, b.output]; }), stocks]);
    if (sig === last.sig) return last.plan;
    var chain = LM.buildChain(lab.buildings);
    var core = LM.planCore(chain, [{ product: PRODUCT, units: target }], stocks, { freeSlots: freeSlots, netTopLevel: false });
    last.sig = sig;
    last.plan = { core: core, slots: slots, freeSlots: freeSlots, capsules: stocks[PRODUCT] || 0 };
    return last.plan;
  }
  function queueRows() {
    var lab = state("LaboratoryStore");
    if (!lab) return [];
    var byId = {};
    (lab.buildings || []).forEach(function (b) { if (b._id) byId[b._id] = b.building; });
    var now = Date.now();
    return (lab.labQueue || []).map(function (q) {
      var timerMs = num(q.timer) * 1000;
      var done = timerMs > 0 ? Math.min(num(q.total), Math.floor((now - num(q.startDate)) / timerMs)) : 0;
      var claimable = Math.max(0, done - num(q.claimed));
      var claimReadyAt = num(q.lastClaimDate) + CLAIM_COOLDOWN_MS;
      return {
        name: byId[q.building] || "queue",
        total: num(q.total), done: done, claimable: claimable,
        claimReady: now >= claimReadyAt, claimIn: claimReadyAt - now,
        endsIn: num(q.endDate) - now, finished: done >= num(q.total),
        speed: num(q.multiplier) || 1,
      };
    });
  }

  // --- panel ------------------------------------------------------------
  var linkStyle = "color:#8ecbff;cursor:pointer;text-decoration:underline;pointer-events:auto";
  function link(act, text, attrs) { return "<span data-act='" + act + "'" + (attrs || "") + " style='" + linkStyle + "'>" + text + "</span>"; }
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return;
    panel = document.createElement("div");
    panel.id = "soLabPanel";
    panel.style.cssText = [
      "position:fixed", "z-index:2147483000", "display:none",
      "font:12px/1.4 Rubik,sans-serif", "color:#fff", "background:rgba(10,20,40,0.85)",
      "border:1px solid rgba(255,255,255,0.25)", "border-radius:10px", "padding:7px 11px",
      "cursor:move", "user-select:none", "white-space:nowrap", "max-width:600px",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    ].join(";");
    panel.addEventListener("click", function (e) {
      var el = e.target;
      while (el && el !== panel && !(el.getAttribute && el.getAttribute("data-act"))) el = el.parentNode;
      var a = el && el !== panel && el.getAttribute("data-act");
      if (!a) return;
      e.stopPropagation();
      if (a === "target") {
        var step = Number(el.getAttribute("data-step")) || 0;
        target = Math.max(1, target + step);
        try { localStorage.setItem(LS_TARGET, String(target)); } catch (err) {}
        last.sig = null;
        render(true);
      }
    });
    makeDraggable(panel, LS_PANEL_POS, null, function () {
      var pill = document.getElementById("soEngineAlertBtn");
      var bottom = 12;
      if (pill) { var r = pill.getBoundingClientRect(); if (r.height > 0) bottom = Math.round(window.innerHeight - r.top) + 8; }
      panel.style.left = "auto"; panel.style.top = "auto"; panel.style.right = "12px"; panel.style.bottom = bottom + "px";
    });
    document.body.appendChild(panel);
  }
  function render(force) {
    if (!panel) return;
    if (!onPage()) { panel.style.display = "none"; return; }
    var plan = readPlan();
    if (!plan) { panel.style.display = "none"; return; }
    var lines = [];
    // queue health
    var rows = queueRows();
    var idle = plan.freeSlots;
    lines.push("<b>Queue</b> " + rows.length + " / " + plan.slots + " slots" +
      (idle > 0 ? " · <span style='color:#ffab40'>⚠ " + idle + " idle</span>" : " · all busy"));
    for (var i = 0; i < rows.length; i++) {
      var q = rows[i];
      lines.push("&nbsp;&nbsp;<b>" + esc(q.name) + "</b> " + q.done + "/" + q.total + (q.speed > 1 ? " x" + q.speed : "") +
        " · collect " + q.claimable + (q.claimable > 0 ? (q.claimReady ? " <span style='color:#69f0ae'>claim ready</span>" : " · claim in " + mmss(q.claimIn)) : "") +
        (q.finished ? " · <span style='color:#69f0ae'>finished</span>" : " · ends in " + hoursText(q.endsIn / 3600000)));
    }
    // chain plan
    var c = plan.core;
    lines.push("<b>Plan</b> " + link("target", "−", " data-step='-5'") + " <b>" + target + "</b> " + link("target", "+", " data-step='5'") + " warp capsules on top of " + fmt(plan.capsules) + " in stock" +
      (c.ready ? " · <span style='color:#69f0ae'>resources cover it</span>" : ""));
    if (c.binding) {
      lines.push("&nbsp;&nbsp;<span style='color:#ffab40'>binding:</span> <b>" + esc(c.binding.name) + "</b> covers " + Math.round(c.binding.coverage * 100) + "%" +
        (c.raw.length ? " · short: " + c.raw.filter(function (r) { return r.coverage < 1; }).slice(0, 3).map(function (r) { return esc(r.name) + " " + fmt(r.short !== undefined ? r.short : r.needed - r.stock); }).join(", ") : ""));
    }
    lines.push("&nbsp;&nbsp;time <b>" + hoursText(c.hoursPipelined) + "</b> pipelined (claim + re-queue every 10 min) · " + hoursText(c.hoursSequential) + " sequential" +
      (c.critical ? " · critical: <b>" + esc(c.critical) + "</b>" : ""));
    var runs = c.buildings.filter(function (b) { return b.unitsToRun > 0; }).sort(function (a, b) { return b.hours - a.hours; }).slice(0, 4);
    if (runs.length) lines.push("&nbsp;&nbsp;runs: " + runs.map(function (b) { return esc(b.name) + " " + fmt(b.unitsToRun) + " (" + hoursText(b.hours) + ")"; }).join(" · "));
    var html = lines.join("<br>");
    if (panel.innerHTML !== html || force) panel.innerHTML = html;
    panel.style.display = "block";
  }

  var lastAt = 0;
  function tick() {
    ensurePanel();
    if (!onPage()) { render(); return; }
    var now = Date.now();
    if (now - lastAt < 1000) return;
    lastAt = now;
    try { render(); } catch (e) { log("error", { where: "lab", error: String(e) }); }
  }
  function stop() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }
  return { tick: tick, stop: stop, plan: readPlan, queue: queueRows };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { installLabInfo };
}
