// Overlays for the battling, gathering, crafting, voyager, player and tech
// pages, running INSIDE the game page. Each is a draggable panel that shows
// only on its page; none of them touches the game's own DOM beyond adding
// the panel, so a game layout change cannot break them.
//
// Formulas come from the advisor (lib/ship-items.js, lib/droids.js,
// lib/tech.js, lib/materials.js), restated here in ES2017 so the file can be
// concatenated into the injected script and the extension.
//
// installMorePages(ctx) -> [{ tick, stop }, ...]
//   ctx: { cfg, log, makeDraggable, lsPrefix, getStoreById, t }

function installMorePages(ctx) {
  var log = ctx.log;
  var makeDraggable = ctx.makeDraggable;
  var getStoreById = ctx.getStoreById;
  var LS = ctx.lsPrefix;
  var t = ctx.t || function (k, v) { return String(k).replace(/\{(\w+)\}/g, function (m, x) { return v && x in v ? v[x] : m; }); };

  // --- shared helpers ------------------------------------------------------
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function dur(ms) {
    var m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 60) return t("{m}m", { m: m });
    var h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d) return t("{d}d {h}h", { d: d, h: h % 24 });
    return t("{h}h", { h: h }) + (m % 60 ? t("{m}m", { m: m % 60 < 10 ? "0" + (m % 60) : m % 60 }) : "");
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function state(id) { var s = getStoreById(id); return s ? s.$state : null; }
  function skills() { var us = state("UserStore"); return (us && us.player && us.player.skills) || {}; }
  // epoch seconds or milliseconds -> milliseconds
  function toMs(v) { var n = num(v); return n > 0 && n < 1e11 ? n * 1000 : n; }
  function plural(n, one, many, vars) { return t(n === 1 ? one : many, Object.assign({ n: n }, vars || {})); }
  var linkStyle = "color:#8ecbff;cursor:pointer;text-decoration:underline;pointer-events:auto";
  function link(act, text, attrs) { return "<span data-act='" + act + "'" + (attrs || "") + " style='" + linkStyle + "'>" + text + "</span>"; }
  var AMBER = "color:#ffab40", GREEN = "color:#69f0ae", RED = "color:#ff6f60", DIM = "opacity:.7";

  // A draggable panel that renders `lines()` on its page only. Returns the
  // module object page-core expects.
  function makePanelModule(opts) {
    var panel = null, lastAt = 0;
    function ensure() {
      if (panel && document.body.contains(panel)) return;
      panel = document.createElement("div");
      panel.id = opts.id;
      panel.style.cssText = [
        "position:fixed", "z-index:2147483000", "display:none",
        "font:12px/1.4 Rubik,sans-serif", "color:#fff", "background:rgba(10,20,40,0.85)",
        "border:1px solid rgba(255,255,255,0.25)", "border-radius:10px", "padding:7px 11px",
        "cursor:move", "user-select:none", "white-space:nowrap", "max-width:620px",
        "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
      ].join(";");
      panel.addEventListener("click", function (e) {
        var el = e.target;
        while (el && el !== panel && !(el.getAttribute && el.getAttribute("data-act"))) el = el.parentNode;
        var a = el && el !== panel && el.getAttribute("data-act");
        if (!a) return;
        e.stopPropagation();
        if (opts.onAction) { opts.onAction(a, el); render(true); }
      });
      makeDraggable(panel, LS + opts.id + "Pos", null, function () {
        panel.style.left = "auto"; panel.style.top = "auto"; panel.style.right = "auto"; panel.style.bottom = "auto";
        if (opts.side === "left") {
          // Bottom-left: clear the game's side drawer and sit just above the
          // chat footer, away from the page content on the right.
          var drawer = document.querySelector(".q-drawer");
          var left = 12 + (drawer ? Math.round(drawer.getBoundingClientRect().width) : 0);
          var footer = document.querySelector(".q-footer");
          var fb = 12;
          if (footer) { var fr = footer.getBoundingClientRect(); if (fr.height > 0 && fr.top > 0) fb = Math.round(window.innerHeight - fr.top) + 12; }
          panel.style.left = left + "px"; panel.style.bottom = fb + "px";
          return;
        }
        var pill = document.getElementById("soEngineAlertBtn");
        var bottom = 12;
        if (pill) { var r = pill.getBoundingClientRect(); if (r.height > 0) bottom = Math.round(window.innerHeight - r.top) + 8; }
        panel.style.right = "12px"; panel.style.bottom = bottom + "px";
      });
      document.body.appendChild(panel);
    }
    function render(force) {
      if (!panel) return;
      if (!opts.onPage()) { panel.style.display = "none"; return; }
      var lines;
      try { lines = opts.lines(); } catch (e) { log("error", { where: opts.id, error: String(e) }); lines = null; }
      if (!lines || !lines.length) { panel.style.display = "none"; return; }
      var html = lines.join("<br>");
      if (force || panel.innerHTML !== html) panel.innerHTML = html;
      panel.style.display = "block";
    }
    return {
      tick: function (ex) {
        ensure();
        if (opts.observe) { try { opts.observe(ex); } catch (e) { log("error", { where: opts.id + " observe", error: String(e) }); } }
        if (!opts.onPage()) { render(); return; }
        var now = Date.now();
        if (now - lastAt < (opts.everyMs || 1000)) return;
        lastAt = now;
        render();
      },
      stop: function () { if (panel && panel.parentNode) panel.parentNode.removeChild(panel); panel = null; },
      render: render,
    };
  }
  // Observed-rate tracker persisted in localStorage: counts events and sums
  // amounts since a start time, for "per hour" figures.
  function makeTally(key, fields) {
    var tl = null;
    function load() {
      if (tl) return tl;
      try { tl = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { tl = null; }
      if (!tl || typeof tl.startedAt !== "number") tl = fresh();
      return tl;
    }
    function fresh() { var o = { startedAt: Date.now(), n: 0, lastSig: null, sums: {} }; for (var i = 0; i < fields.length; i++) o.sums[fields[i]] = 0; return o; }
    function save() { try { localStorage.setItem(key, JSON.stringify(tl)); } catch (e) {} }
    return {
      get: load,
      reset: function () { tl = fresh(); save(); },
      // add one event, once per distinct signature; the first event after a
      // fresh start only records the signature (it happened before the start)
      add: function (sig, amounts) {
        load();
        if (sig === tl.lastSig) return false;
        var first = tl.lastSig === null;
        tl.lastSig = sig;
        if (!first) { tl.n += 1; for (var k in amounts) tl.sums[k] = (tl.sums[k] || 0) + num(amounts[k]); }
        save();
        return !first;
      },
      hours: function () { load(); return Math.max(Date.now() - tl.startedAt, 60000) / 3600000; },
    };
  }
  function countdown(atMs) {
    var left = atMs - Date.now();
    return left <= 0 ? "<span style='" + GREEN + "'>" + t("now") + "</span>" : "<b>" + (left < 3600000 ? mmss(left) : dur(left)) + "</b>";
  }
  function sinceText(startedAt) {
    return t("Since {t}", { t: new Date(startedAt).toLocaleTimeString("en-GB", { hour12: false }).slice(0, 5) });
  }

  // --- battling --------------------------------------------------------------
  var battleTally = makeTally(LS + "battleTally", ["credits", "xp", "wins"]);
  var lastBattleReward = null;
  var battling = makePanelModule({
    id: "soBattlePanel",
    onPage: function () { return /#\/battling/.test(location.hash); },
    onAction: function (a) { if (a === "reset") battleTally.reset(); },
    observe: function () {
      var b = state("BattleStore");
      var lr = b && b.lastReward;
      if (!lr || lr === lastBattleReward) return;
      lastBattleReward = lr;
      var sim = lr.simulation || {};
      var win = sim.win === "player";
      var sig = [b.currentNPC, b.currentNPCLevel, lr.amount, lr.xp, sim.win, sim.mob && sim.mob.hull].join("|");
      battleTally.add(sig, { credits: lr.name === "credits" ? num(lr.amount) : 0, xp: num(lr.xp), wins: win ? 1 : 0 });
    },
    lines: function () {
      var b = state("BattleStore");
      if (!b) return null;
      var lines = [];
      lines.push("<b>" + t("Battling") + "</b> " + (b.isBattling ? esc(b.currentNPC || "?") + " <b>L" + num(b.currentNPCLevel) + "</b>" : "<span style='" + DIM + "'>" + t("idle") + "</span>") +
        (b.isBattling && num(b.nextActionAt) > 0 ? " · " + t("next action in {t}", { t: countdown(num(b.nextActionAt)) }) : "") +
        (num(b.offlineActionsExpiresAt) ? " · " + t("offline actions expire in {t}", { t: countdown(toMs(b.offlineActionsExpiresAt)) }) : ""));
      var lr = b.lastReward, sim = lr && lr.simulation;
      if (lr && sim) {
        var win = sim.win === "player";
        var clones = Array.isArray(sim.clones) ? sim.clones : [];
        var alive = clones.filter(function (c) { return c && (c.alive !== false) && num(c.hp) > 0; }).length;
        var lowest = null;
        for (var i = 0; i < clones.length; i++) { var c = clones[i]; if (!c || !num(c.maxHp)) continue; var pct = num(c.hp) / num(c.maxHp); if (lowest === null || pct < lowest) lowest = pct; }
        lines.push("<b>" + t("Last fight") + "</b> <span style='" + (win ? GREEN : RED) + "'>" + (win ? t("WIN") : t("LOSS")) + "</span>" +
          (lr.name === "credits" ? " · " + t("+{n} credits", { n: fmt(num(lr.amount)) }) : lr.name ? " · +" + fmt(num(lr.amount)) + " " + esc(lr.name) : "") +
          " · " + t("+{n} XP", { n: fmt(num(lr.xp)) }) +
          (clones.length ? " · " + t("clones {a}/{b}", { a: alive, b: clones.length }) + (lowest !== null ? " · " + t("lowest HP {p}%", { p: Math.round(lowest * 100) }) : "") : "") +
          (sim.mob ? " · " + t("NPC hit {a}% / dodge {b}%", { a: num(sim.mob.hitChance), b: num(sim.mob.dodgeChance) }) : ""));
      }
      var tl = battleTally.get(), h = battleTally.hours();
      lines.push("<b>" + sinceText(tl.startedAt) + "</b> " + plural(tl.n, "{n} fight", "{n} fights") +
        (tl.n ? " · " + t("win rate {p}", { p: "<b>" + Math.round(100 * tl.sums.wins / tl.n) + "%</b>" }) + " · " + t("{n} credits/h", { n: fmt(tl.sums.credits / h) }) + " · " + t("{n} XP/h", { n: fmt(tl.sums.xp / h) }) + " · " + t("{n} fights/h", { n: (tl.n / h).toFixed(1) }) : "") +
        " " + link("reset", t("reset")));
      return lines;
    },
  });

  // --- gathering -------------------------------------------------------------
  var DROID_BASE_DODGE = 50, DODGE_CAP = 100, MANEUVER_RATIO = 0.5;
  function droidDodge(m, mod) { return Math.min(DODGE_CAP, DROID_BASE_DODGE + num(m) * MANEUVER_RATIO + num(mod)); }
  function nonDamageModValue(item, modName) {
    var bonuses = (item && item.bonuses) || [];
    if (bonuses.indexOf(modName) < 0) return 0;
    return bonuses.length <= 1 ? 10 : 5;
  }
  function dodgeModBonus() {
    var ship = state("ShipStore") || {};
    return nonDamageModValue(ship.laser_slot, "Droids dodge chance") + nonDamageModValue(ship.probes_slot, "Droids dodge chance");
  }
  var gatherTally = makeTally(LS + "gatherTally", ["amount", "xp", "lost"]);
  var lastGatherReward = null;
  var gatherResource = null;
  var gathering = makePanelModule({
    id: "soGatherPanel",
    onPage: function () { return /#\/gathering/.test(location.hash); },
    onAction: function (a) { if (a === "reset") gatherTally.reset(); },
    observe: function () {
      var g = state("GatherStore");
      var lr = g && g.lastReward;
      if (!lr || lr === lastGatherReward) return;
      lastGatherReward = lr;
      var stats = Array.isArray(lr.statistics) ? lr.statistics : [];
      var lost = stats.filter(function (d) { return d && d.alive === false; }).length;
      var sig = [lr.name, lr.amount, lr.xp, stats.map(function (d) { return d && d.ore; }).join(",")].join("|");
      if (gatherTally.add(sig, { amount: num(lr.amount), xp: num(lr.xp), lost: lost })) gatherResource = lr.name || gatherResource;
    },
    lines: function () {
      var g = state("GatherStore");
      if (!g) return null;
      var lines = [];
      var body = g.currentGatheringBody;
      var q = body ? num(body.nodeQuality) : 0;
      lines.push("<b>" + t("Gathering") + "</b> " + (g.isGathering && body ? esc(body.type || "?") + " · <b style='" + (q >= 90 ? "color:#ffa726" : "") + "'>" + esc(body.nodeType || "?") + " " + q + "%</b>" : "<span style='" + DIM + "'>" + t("idle") + "</span>") +
        (g.isGathering && num(g.nextActionAt) > 0 ? " · " + t("next action in {t}", { t: countdown(num(g.nextActionAt)) }) : "") +
        (num(g.offlineActionsExpiresAt) ? " · " + t("offline actions expire in {t}", { t: countdown(toMs(g.offlineActionsExpiresAt)) }) : ""));
      var lr = g.lastReward;
      if (lr) {
        var stats = Array.isArray(lr.statistics) ? lr.statistics : [];
        var alive = stats.filter(function (d) { return d && d.alive; }).length;
        lines.push("<b>" + t("Last haul") + "</b> +" + fmt(num(lr.amount)) + " " + esc(lr.name || "") + " · " + t("+{n} XP", { n: fmt(num(lr.xp)) }) +
          (stats.length ? " · " + t("droids back {a}/{b}", { a: "<b style='" + (alive < stats.length ? AMBER : "") + "'>" + alive, b: stats.length + "</b>" }) : ""));
      }
      // droid survival from the advisor's dodge model
      var us = state("UserStore");
      var droids = (us && us.player && Array.isArray(us.player.droids)) ? us.player.droids : [];
      if (droids.length) {
        var mod = dodgeModBonus();
        var cap = Math.max(0, (DODGE_CAP - DROID_BASE_DODGE - mod) / MANEUVER_RATIO);
        var expected = 0, capped = 0, minDodge = 100;
        for (var i = 0; i < droids.length; i++) {
          var d = droidDodge(droids[i].maneuverability, mod);
          expected += d / 100;
          if (d >= DODGE_CAP - 1e-9) capped++;
          if (d < minDodge) minDodge = d;
        }
        lines.push("<b>" + t("Droids") + "</b> " + droids.length + " · " + t("expected back {n} per action", { n: "<b>" + expected.toFixed(1) + "</b>" }) + " · " + t("dodge {p}%", { p: Math.round(minDodge) }) + (capped ? " · " + t("{n} at the 100% cap", { n: capped }) : "") +
          " · " + t("dodge mods +{n}%", { n: mod }) + " · " + t("maneuverability cap {n}", { n: Math.round(cap) }) + (droids.every(function (x) { return num(x.maneuverability) >= cap; }) ? " <span style='" + DIM + "'>" + t("(all droids past it: a dodge mod recraft to 'Rare Resource drop chance' costs nothing)") + "</span>" : ""));
      }
      var tl = gatherTally.get(), h = gatherTally.hours();
      lines.push("<b>" + sinceText(tl.startedAt) + "</b> " + plural(tl.n, "{n} action", "{n} actions") +
        (tl.n ? " · " + t("{n} {res}/h", { n: fmt(tl.sums.amount / h), res: esc(gatherResource || "") }) + " · " + t("{n} XP/h", { n: fmt(tl.sums.xp / h) }) + " · " + t("droids lost {n}", { n: tl.sums.lost }) : "") +
        " " + link("reset", t("reset")));
      return lines;
    },
  });

  // --- crafting --------------------------------------------------------------
  // NPC drop table (constant, from the advisor): material -> where it farms.
  var DROPS = {
    "bones": "brutes / Belt", "ectoplasm": "spectres / Nebula", "frost shard": "glacials / Icy Planet",
    "cog": "machiners / Asteroid", "flame": "scorchers / Gas Planet", "slime": "toxoids / Crystal Planet",
    "horn": "miners / Rocky Planet", "condensed sand": "dusters / Comet",
  };
  function normName(s) { return String(s == null ? "" : s).toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim(); }
  function craftStocks() {
    var stocks = {};
    var cur = state("CurrencyStore") || {};
    for (var k in cur) if (typeof cur[k] === "number") stocks[normName(k)] = cur[k];
    var mat = state("MaterialsStore") || {};
    var list = Array.isArray(mat.materialsList) ? mat.materialsList : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].item && list[i].item.name) stocks[normName(list[i].item.name)] = num(list[i].quantity);
    return stocks;
  }
  // What one craft of a blueprint needs, and what is missing from stock.
  function blueprintNeeds(bp, stocks) {
    var item = bp && bp.item;
    if (!item) return null;
    var needs = [];
    (item.currency_use || []).forEach(function (c) { if (c && c.normalCurrency) needs.push({ name: normName(c.normalCurrency), amount: num(c.amount), kind: "currency" }); });
    (item.material_use || []).forEach(function (m) { if (m && m.material) needs.push({ name: normName(m.material), amount: num(m.amount), kind: "material" }); });
    if (num(item.scraps_use) > 0) needs.push({ name: "metal scrap", amount: num(item.scraps_use), kind: "material" });
    var missing = needs.filter(function (n) { return (stocks[n.name] || 0) < n.amount; }).map(function (n) { return { name: n.name, short: n.amount - (stocks[n.name] || 0) }; });
    return { name: item.name, rarity: item.rarity, needs: needs, missing: missing, craftable: missing.length === 0 && needs.length > 0 };
  }
  var craftCache = { sig: null, out: null };
  function craftSummary() {
    var c = state("CraftStore");
    if (!c || !Array.isArray(c.blueprints)) return null;
    var stocks = craftStocks();
    var sig = JSON.stringify([c.blueprints.length, c.selectedBlueprint, stocks]);
    if (sig === craftCache.sig) return craftCache.out;
    var craftable = 0, total = 0, blockers = {};
    var selected = null;
    for (var i = 0; i < c.blueprints.length; i++) {
      var bp = c.blueprints[i];
      var r = blueprintNeeds(bp, stocks);
      if (!r) continue;
      total++;
      if (r.craftable) craftable++;
      for (var m = 0; m < r.missing.length; m++) {
        var b = blockers[r.missing[m].name] || (blockers[r.missing[m].name] = { count: 0, maxShort: 0 });
        b.count++;
        if (r.missing[m].short > b.maxShort) b.maxShort = r.missing[m].short;
      }
      if (c.selectedBlueprint && (bp._id === c.selectedBlueprint || (bp.item && bp.item._id === c.selectedBlueprint))) selected = r;
    }
    var top = Object.keys(blockers).map(function (k) { return { name: k, count: blockers[k].count, maxShort: blockers[k].maxShort }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);
    craftCache = { sig: sig, out: { craftable: craftable, total: total, blockers: top, selected: selected } };
    return craftCache.out;
  }
  var crafting = makePanelModule({
    id: "soCraftPanel",
    everyMs: 2000,
    onPage: function () { return /#\/crafting/.test(location.hash); },
    lines: function () {
      var s = craftSummary();
      if (!s) return null;
      var lines = [];
      lines.push("<b>" + t("Crafting") + "</b> " + t("{a} of {b} blueprints craftable now with what you hold", { a: "<b>" + s.craftable + "</b>", b: s.total }));
      if (s.blockers.length) {
        lines.push("<span style='" + DIM + "'>" + t("most blocking:") + "</span> " + s.blockers.map(function (b) {
          return "<b>" + esc(b.name) + "</b> (" + plural(b.count, "{n} blueprint", "{n} blueprints") + ", " + t("up to {n} short", { n: fmt(b.maxShort) }) + (DROPS[b.name] ? ", " + t("farm {where}", { where: esc(DROPS[b.name]) }) : "") + ")";
        }).join(" · "));
      }
      if (s.selected) {
        lines.push("<b>" + t("Selected") + "</b> " + esc(s.selected.name) + ": " + (s.selected.craftable ? "<span style='" + GREEN + "'>" + t("craftable") + "</span>" :
          "<span style='" + AMBER + "'>" + t("missing {list}", { list: s.selected.missing.map(function (m) { return esc(m.name) + " " + fmt(m.short) + (DROPS[m.name] ? " (" + esc(DROPS[m.name]) + ")" : ""); }).join(", ") }) + "</span>"));
      }
      return lines;
    },
  });

  // --- voyager -----------------------------------------------------------------
  var voyager = makePanelModule({
    id: "soVoyagerPanel",
    onPage: function () { return /#\/voyager/.test(location.hash); },
    lines: function () {
      var v = state("Voyager");
      if (!v) return null;
      var fuel = num(v.current_fuel), max = num(v.max_fuel), jumps = num(v.max_jumps);
      // The store's `timer` is the REDUCTION in seconds off a 30-minute base:
      // the page itself prints 30 - timer/60 minutes as "Timer per jump".
      var timer = Math.max(0, 30 * 60 - num(v.timer));
      // Fuel per jump is charged server-side and the client has no formula
      // for it, so the panel reports the tank and never guesses a cost.
      var lines = [];
      lines.push("<b>" + t("Voyager") + "</b> " + t("fuel {n}", { n: "<b style='" + (max > 0 && fuel < max * 0.2 ? AMBER : "") + "'>" + (fuel < 100 ? fuel.toFixed(1) : fmt(fuel)) + " / " + fmt(max) + "</b>" }) +
        " · " + t("max {n} jumps", { n: jumps }) +
        (timer > 0 ? " · " + t("{t} per jump", { t: dur(timer * 1000) }) : "") +
        " · " + t("reward bonus +{n}%", { n: num(v.reward_bonus) }) + (num(skills().voyager_reward_boost) ? " " + t("(tech +{n}%)", { n: num(skills().voyager_reward_boost) }) : ""));
      var plan = Array.isArray(v.planning) ? v.planning : [];
      var queue = Array.isArray(v.queue) ? v.queue : [];
      if (plan.length) {
        // distance along the planned waypoints, like the store's totalPlanning
        var ex = state("ExploreStore") || {};
        var px = num(v.current_x) || num(ex.currentSystem && ex.currentSystem.coordinate_x), py = num(v.current_y) || num(ex.currentSystem && ex.currentSystem.coordinate_y);
        var dist = 0;
        for (var i = 0; i < plan.length; i++) {
          var wx = num(plan[i].destination_x), wy = num(plan[i].destination_y);
          dist += Math.sqrt(Math.pow((wx - px) * 10, 2) + Math.pow((wy - py) * 10, 2));
          px = wx; py = wy;
        }
        lines.push("<b>" + t("Planned") + "</b> " + plural(plan.length, "{n} jump", "{n} jumps") + " · " + t("{n} ly", { n: Math.round(dist) }) + (timer > 0 ? " · ~" + dur(plan.length * timer * 1000) : ""));
      } else if (queue.length) {
        var pending = queue.filter(function (q) { return q && q.status !== "reached"; });
        var qdist = 0;
        for (var j = 0; j < queue.length; j++) qdist += num(queue[j].distance);
        var lastEta = num(queue[queue.length - 1].eta);
        lines.push("<b>" + t("Queued") + "</b> " + plural(queue.length, "{n} jump", "{n} jumps") + " · " + t("{n} ly", { n: Math.round(qdist) }) +
          " · " + t("{n} pending", { n: pending.length }) + (lastEta > Date.now() ? " · " + t("ETA {t}", { t: countdown(lastEta) }) : pending.length ? "" : " · <span style='" + GREEN + "'>" + t("finished") + "</span>"));
      } else {
        lines.push("<span style='" + DIM + "'>" + t("No expedition planned. Fuel refills from warp capsules; a Korin pet makes enhanced ones.") + "</span>");
      }
      return lines;
    },
  });

  // --- player (ship items) ----------------------------------------------------
  var RARITY_MULT = { normal: 1, uncommon: 1.1, rare: 1.25, unique: 1.5, epic: 1.75, legendary: 2 };
  var SLOT_SKILL = { weapon_slot: "battling", shield_slot: "battling", laser_slot: "gathering", probes_slot: "gathering", engine_slot: "exploring", sensors_slot: "exploring" };
  function valueMaxForLevel(craftLevel, rarity, level) { return Math.round(10 * (1.3 + craftLevel / 100) * (RARITY_MULT[rarity] || 1) * level); }
  function skillLevels() {
    var b = state("BattleStore") || {}, g = state("GatherStore") || {}, e = state("ExploreStore") || {}, c = state("CraftStore") || {};
    return { battling: num(b.battling_level), gathering: num(g.gathering_level), exploring: num(e.exploring_level), crafting: num(c.crafting_level) };
  }
  var player = makePanelModule({
    id: "soPlayerPanel",
    side: "left",
    everyMs: 2000,
    onPage: function () { return /#\/player/.test(location.hash); },
    lines: function () {
      var ship = state("ShipStore");
      if (!ship) return null;
      var lv = skillLevels();
      var lines = ["<b>" + t("Ship items") + "</b> <span style='" + DIM + "'>" + t("item level is set at craft time from the matching skill; value cap = 10 × (1.3 + crafting/100) × rarity × level") + "</span>"];
      var mod = dodgeModBonus();
      var us = state("UserStore");
      var droids = (us && us.player && Array.isArray(us.player.droids)) ? us.player.droids : [];
      var cap = Math.max(0, (DODGE_CAP - DROID_BASE_DODGE - mod) / MANEUVER_RATIO);
      var allPastCap = droids.length > 0 && droids.every(function (d) { return num(d.maneuverability) >= cap; });
      for (var slot in SLOT_SKILL) {
        var it = ship[slot];
        if (!it) continue;
        var skill = SLOT_SKILL[slot], skillLevel = lv[skill];
        var behind = skillLevel - num(it.level);
        var capNow = valueMaxForLevel(lv.crafting, it.rarity, num(it.level));
        var capRecraft = valueMaxForLevel(lv.crafting, it.rarity, skillLevel);
        var pct = capNow > 0 ? Math.round(100 * num(it.value) / capNow) : 0;
        var notes = [];
        if (behind > 0) notes.push("<span style='" + (behind >= 10 ? AMBER : DIM) + "'>" + plural(behind, "{n} level behind {skill} {lvl}; recraft cap {cap}", "{n} levels behind {skill} {lvl}; recraft cap {cap}", { skill: t(skill), lvl: skillLevel, cap: fmt(capRecraft) }) + "</span>");
        else notes.push("<span style='" + GREEN + "'>" + t("at skill level") + "</span>");
        var mods = (it.bonuses || []);
        if ((slot === "laser_slot" || slot === "probes_slot") && mods.indexOf("Droids dodge chance") >= 0 && allPastCap) notes.push("<span style='" + AMBER + "'>" + t("dodge mod adds nothing: droids are past the cap, recraft to 'Rare Resource drop chance'") + "</span>");
        lines.push("&nbsp;&nbsp;<b>" + t(slot.replace("_slot", "")) + "</b> L" + num(it.level) + " " + esc(it.rarity || "") + " · " + t("value {v} / cap {c} ({p}%)", { v: fmt(num(it.value)), c: fmt(capNow), p: pct }) +
          (mods.length ? " · " + t("mods: {list}", { list: mods.map(esc).join(", ") }) : "") + " · " + notes.join(" · "));
      }
      return lines;
    },
  });

  // --- tech (skills) ------------------------------------------------------------
  var TECH_MAX = 100;
  var TECH_LOCKED = { base_module_efficiency_boost: 1, dungeon_reward_boost: 1, dungeon_battle_boost: 1, dungeon_gather_boost: 1, dungeon_craft_boost: 1, dungeon_explore_boost: 1 };
  function costNext(level) { return 2 * (level + 1); }
  function coresToMax(level) { return Math.max(0, TECH_MAX * (TECH_MAX + 1) - level * (level + 1)); }
  var tech = makePanelModule({
    id: "soTechPanel",
    everyMs: 2000,
    onPage: function () { return /#\/tech/.test(location.hash); },
    lines: function () {
      var sk = skills();
      var cur = state("CurrencyStore") || {};
      var cores = num(cur.quantum_cores);
      var list = [];
      for (var k in sk) {
        if (TECH_LOCKED[k] || typeof sk[k] !== "number") continue;
        var L = num(sk[k]);
        list.push({ key: k, level: L, next: L < TECH_MAX ? costNext(L) : 0, toMax: coresToMax(L) });
      }
      if (!list.length) return null;
      var totalToMax = list.reduce(function (s, x) { return s + x.toMax; }, 0);
      // cheapest way to spend the cores you hold: always the lowest next cost
      var pool = cores, bought = {};
      var work = list.map(function (x) { return { key: x.key, level: x.level }; }).filter(function (x) { return x.level < TECH_MAX; });
      for (var guard = 0; guard < 10000 && work.length; guard++) {
        var best = null;
        for (var i = 0; i < work.length; i++) if (!best || costNext(work[i].level) < costNext(best.level)) best = work[i];
        var c = costNext(best.level);
        if (c > pool) break;
        pool -= c; best.level += 1; bought[best.key] = (bought[best.key] || 0) + 1;
        if (best.level >= TECH_MAX) work = work.filter(function (x) { return x !== best; });
      }
      var lines = [];
      lines.push("<b>" + t("Tech") + "</b> " + t("{n} quantum cores", { n: fmt(cores) }) + " · " + t("{n} to max every unlocked skill", { n: fmt(totalToMax) }) + " · " + t("next level costs 2 × (level + 1)"));
      var cheapest = list.filter(function (x) { return x.next > 0; }).sort(function (a, b) { return a.next - b.next; }).slice(0, 4);
      lines.push("<span style='" + DIM + "'>" + t("cheapest next levels:") + "</span> " + cheapest.map(function (x) { return esc(x.key.replace(/_/g, " ")) + " L" + x.level + " → " + x.next; }).join(" · "));
      var keys = Object.keys(bought);
      lines.push(keys.length
        ? "<b>" + t("Your cores buy") + "</b> " + keys.map(function (k) { return "+" + bought[k] + " " + esc(k.replace(/_/g, " ")); }).join(", ") + " <span style='" + DIM + "'>" + t("(cheapest levels first)") + "</span>"
        : "<span style='" + DIM + "'>" + t("Not enough cores for the cheapest next level") + "</span>");
      var far = list.slice().sort(function (a, b) { return b.toMax - a.toMax; }).slice(0, 3);
      lines.push("<span style='" + DIM + "'>" + t("furthest from max:") + "</span> " + far.map(function (x) { return esc(x.key.replace(/_/g, " ")) + " L" + x.level + " " + t("({n} cores)", { n: fmt(x.toMax) }); }).join(" · "));
      return lines;
    },
  });

  return [battling, gathering, crafting, voyager, player, tech];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { installMorePages };
}
