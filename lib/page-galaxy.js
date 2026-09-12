// Galaxy-map information overlay, running INSIDE the game page.
//
// Adds, on the galaxy page only:
//   1. a hover tag over any map cell: system, distance, fuel cost, fuel left;
//   2. the nearest unexplored cell (marked on the map, with a "center" link);
//   3. a ring on systems you discovered yourself;
//   4. session statistics from the game's own per-jump reward object, with
//      the average fuel per jump and a low-fuel warning;
//   5. points of interest: dots for habitable / portal / dungeon / starter
//      systems, and the active rune of the current system with its expiry;
//   6. your bookmarks and your squadron's space stations with distance,
//      direction, fuel cost and (for stations) whether you are in range.
//
// Same rules as page-core.js: ES2017 only, no Node APIs, plain function
// declarations, because this file's text is concatenated into the injected
// script and the extension's content script.
//
// How the map is read. The galaxy is a Konva stage inside the GalaxyMapCanvas
// Vue component; its vue-konva wrapper exposes getNode(), which hands back the
// stage. Stage -> Layer -> Group(scale = zoom) -> planet Images and Texts. A
// cell (cx, cy) sits at world (cx * 50, -cy * 30) inside the group; the units
// are re-derived from a coordinate label whenever possible. Cells that the
// game draws as "?" are exactly the cells missing from the component's
// `systems` prop, so "unexplored" here means "not in that map".

function installGalaxyInfo(ctx) {
  var cfg = ctx.cfg;
  var log = ctx.log;
  var makeDraggable = ctx.makeDraggable;
  var getStore = ctx.getStore;
  var getStoreById = ctx.getStoreById || function () { return null; };
  var LS_SESSION = ctx.lsPrefix + "session";
  var LS_PANEL_POS = ctx.lsPrefix + "galaxyPos";
  var LS_PREFS = ctx.lsPrefix + "galaxyPrefs";
  var LS_NODES = ctx.lsPrefix + "nodes";
  // "Rich" gathering node: quality at or above this (percent).
  var NODE_MIN = Number.isFinite(Number(cfg.nodeMinQuality)) && Number(cfg.nodeMinQuality) > 0 ? Number(cfg.nodeMinQuality) : 90;
  var NODES_MAX_ENTRIES = 5000;

  var UNIT_FALLBACK = { x: 50, y: 30 };
  // The planet image sits above the coordinate label: its centre is ~0.35
  // cell above the label's y, the visible centre of the cell ~0.25.
  var CELL_VISUAL_OFFSET = 0.25;
  var PLANET_OFFSET = 0.35;
  var CONFIRM_LY = 100; // the game asks for confirmation beyond this distance
  // Squadron space station reach: base + per-level extension, in ly (game
  // constants spaceStationBaseRangeExtend / spaceStationRangeExtend).
  var STATION_BASE_RANGE_LY = 100, STATION_RANGE_PER_LEVEL_LY = 10;
  var POI = [
    { key: "habitable", test: function (s) { return !!s.habitable; }, color: "#4dd0e1", label: "habitable" },
    { key: "portal", test: function (s) { return !!s.has_portal; }, color: "#b388ff", label: "portal" },
    { key: "dungeon", test: function (s) { return !!s.dungeon; }, color: "#ff5252", label: "dungeon" },
    { key: "starter", test: function (s) { return !!s.starter; }, color: "#ffffff", label: "starter" },
  ];

  var st = { stage: null, canvas: null, layer: null, marker: null, marks: null, marksKey: null, nodesVersion: 0, unit: null, tipCell: null, lastRewards: null, finder: null, finderKey: null, finderSys: null,
    world: null, routeGroup: null, trailGroup: null, route: null, routeKey: null, trailKey: null, census: null, censusKey: null, censusSys: null, domHandlers: null, cooldownMs: 300000, prevCooldown: null };
  // Longest single hop the route planner will plan, in ly. The game asks for
  // confirmation above CONFIRM_LY, so stay under it by default.
  var MAX_HOP_LY = Number(cfg.maxHopLy) > 0 ? Number(cfg.maxHopLy) : CONFIRM_LY - 1;
  var panel = null, tip = null;

  // --- preferences -------------------------------------------------------
  var prefs = (function () {
    var p = { mine: true, poi: true, nodes: true, trail: true, bookmarks: false, stations: false };
    try { Object.assign(p, JSON.parse(localStorage.getItem(LS_PREFS) || "{}")); } catch (e) {}
    return p;
  })();
  function savePrefs() { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (e) {} }

  // --- helpers ----------------------------------------------------------
  function onGalaxyPage() { return /#\/galaxy/.test(location.hash); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function dur(ms) {
    var m = Math.floor(ms / 60000);
    return m < 60 ? m + "m" : Math.floor(m / 60) + "h" + (m % 60 < 10 ? "0" : "") + (m % 60) + "m";
  }
  function mmssLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s >= 3600) return Math.floor(s / 3600) + "h" + (Math.floor(s / 60) % 60 < 10 ? "0" : "") + (Math.floor(s / 60) % 60) + "m";
    return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }
  function compass(dx, dy) {
    if (!dx && !dy) return "here";
    var dirs = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
    var a = Math.atan2(dy, dx);
    return dirs[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function short(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function idOf(v) { return v && typeof v === "object" ? (v._id || v.id || "") : (v || ""); }
  var myId = null;
  function userId() {
    if (myId) return myId;
    try { var us = getStoreById("UserStore"); var s = us && us.$state; myId = s ? (s.uid || s._id || (s.player && s.player._id) || null) : null; } catch (e) {}
    return myId;
  }
  function isMine(sys) { var me = userId(); return !!(me && idOf(sys.discovered_by) === me); }
  // Squadron mates: UserStore.squadron.members is [{ _id, username }, ...].
  var squadCache = { at: 0, ids: null };
  function squadIds() {
    if (squadCache.ids && Date.now() - squadCache.at < 60000) return squadCache.ids;
    var ids = {};
    try {
      var us = getStoreById("UserStore");
      var sq = us && us.$state && us.$state.squadron;
      var list = sq && Array.isArray(sq.members) ? sq.members : [];
      for (var i = 0; i < list.length; i++) { var id = idOf(list[i]); if (id) ids[id] = true; }
      if (sq && sq.leader) { var lid = idOf(sq.leader); if (lid) ids[lid] = true; }
    } catch (e) {}
    squadCache = { at: Date.now(), ids: ids };
    return ids;
  }
  function isSquad(sys) { var id = idOf(sys.discovered_by); return !!(id && id !== userId() && squadIds()[id]); }
  function poiOf(sys) { var out = []; for (var i = 0; i < POI.length; i++) if (POI[i].test(sys)) out.push(POI[i]); return out; }

  // --- finding the map --------------------------------------------------
  function walkComponents(fn) {
    var root = document.getElementById("q-app");
    if (!root || !root._vnode) return;
    var seen = new Set();
    var done = false;
    (function walk(vnode, depth) {
      if (!vnode || depth > 40 || done) return;
      var i = vnode.component;
      if (i && !seen.has(i)) {
        seen.add(i);
        if (fn(i) === true) { done = true; return; }
        if (i.subTree) walk(i.subTree, depth + 1);
      }
      if (Array.isArray(vnode.children)) for (var k = 0; k < vnode.children.length; k++) walk(vnode.children[k], depth + 1);
    })(root._vnode, 0);
  }
  function findParts() {
    var canvas = null, stage = null;
    walkComponents(function (i) {
      var name = (i.type && (i.type.name || i.type.__name)) || "";
      if (name === "GalaxyMapCanvas" && !canvas) canvas = i;
      if (!stage && i.exposed && i.exposed.getNode && i.exposed.getStage) {
        try { var n = i.exposed.getNode(); if (n && n.getClassName && n.getClassName() === "Stage") stage = n; } catch (e) {}
      }
      return !!(canvas && stage);
    });
    return { canvas: canvas, stage: stage };
  }
  function stageAlive(stage) {
    try { var c = stage.container(); return !!(c && c.isConnected); } catch (e) { return false; }
  }
  function ensureParts() {
    if (!onGalaxyPage()) { teardownMap(); return false; }
    if (st.stage && stageAlive(st.stage) && st.canvas && !st.canvas.isUnmounted) return true;
    teardownMap();
    var p = findParts();
    if (!p.stage || !p.canvas) return false;
    st.stage = p.stage;
    st.canvas = p.canvas;
    attachStage();
    log("galaxy", { map: "attached" });
    return true;
  }
  function teardownMap() {
    if (st.stage) {
      try { st.stage.off(".soEngineAlert"); } catch (e) {}
      try { if (st.layer) st.layer.destroy(); } catch (e) {}
    }
    if (st.domHandlers) {
      try {
        st.domHandlers.el.removeEventListener("contextmenu", st.domHandlers.contextmenu, true);
        st.domHandlers.el.removeEventListener("click", st.domHandlers.click, true);
      } catch (e) {}
      st.domHandlers = null;
    }
    st.stage = null; st.canvas = null; st.layer = null; st.marker = null; st.marks = null; st.marksKey = null;
    st.world = null; st.routeGroup = null; st.trailGroup = null; st.routeKey = null; st.trailKey = null; st.census = null; st.censusKey = null;
    st.finder = null; st.finderKey = null;
    hideTip();
  }

  // --- geometry ---------------------------------------------------------
  function geometry() {
    var layer = st.stage.getLayers()[0];
    if (!layer) return null;
    var group = layer.getChildren()[0];
    if (!group) return null;
    var g = group.absolutePosition();
    var s = group.getAbsoluteScale().x;
    if (!s) return null;
    if (!st.unit) {
      var texts = st.stage.find("Text");
      for (var i = 0; i < texts.length; i++) {
        var m = /^\[(\d+), (\d+)\]$/.exec(texts[i].text());
        if (!m) continue;
        var p = texts[i].absolutePosition();
        var ux = (p.x - g.x) / (Number(m[1]) * s), uy = (g.y - p.y) / (Number(m[2]) * s);
        if (ux > 1 && uy > 1) { st.unit = { x: ux, y: uy }; break; }
      }
      if (!st.unit) return { gx: g.x, gy: g.y, s: s, ux: UNIT_FALLBACK.x * s, uy: UNIT_FALLBACK.y * s, provisional: true };
    }
    return { gx: g.x, gy: g.y, s: s, ux: st.unit.x * s, uy: st.unit.y * s };
  }
  function cellToPx(geo, cx, cy, offset) { return { x: geo.gx + cx * geo.ux, y: geo.gy - (cy + (offset === undefined ? CELL_VISUAL_OFFSET : offset)) * geo.uy }; }
  function pxToCell(geo, x, y) { return { x: Math.round((x - geo.gx) / geo.ux), y: Math.round((geo.gy - y) / geo.uy - CELL_VISUAL_OFFSET) }; }

  function props() { return (st.canvas && st.canvas.props) || {}; }
  function shipCell() { var p = props(); return { x: num(p.currentX), y: num(p.currentY) }; }
  // Same formula as the game's calculateDistance prop: 10 ly per cell per axis.
  function distLy(a, b) { var dx = Math.abs(a.x - b.x) * 10, dy = Math.abs(a.y - b.y) * 10; return Math.sqrt(dx * dx + dy * dy); }
  function fuelCost(ly) { return ly * (1 - num(props().fuelEfficiencyBonus) / 100); }
  function coordsOf(sys) { return sys ? { x: num(sys.coordinate_x), y: num(sys.coordinate_y) } : null; }

  // --- map attachment: hover, marker, marks ----------------------------
  function attachStage() {
    var stage = st.stage;
    stage.on("mousemove.soEngineAlert", onMove);
    stage.on("mouseleave.soEngineAlert", hideTip);
    stage.on("mousedown.soEngineAlert", hideTip);
    stage.on("wheel.soEngineAlert", function () { st.unit = null; hideTip(); });
    // Right-click (or Shift+click) a cell: plan a route there; the same cell
    // again clears it. Plain DOM listeners on the map container, so they work
    // whatever the game does with Konva's own events.
    var container = stage.container();
    function routeAtClient(clientX, clientY) {
      var geo = geometry();
      if (!geo) return;
      var rect = container.getBoundingClientRect();
      var cell = pxToCell(geo, clientX - rect.left, clientY - rect.top);
      if (st.route && st.route.dest.x === cell.x && st.route.dest.y === cell.y) clearRoute();
      else setRoute(cell);
    }
    st.domHandlers = {
      el: container,
      contextmenu: function (e) { e.preventDefault(); routeAtClient(e.clientX, e.clientY); },
      click: function (e) { if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); routeAtClient(e.clientX, e.clientY); } },
    };
    container.addEventListener("contextmenu", st.domHandlers.contextmenu, true);
    container.addEventListener("click", st.domHandlers.click, true);
    try {
      if (window.Konva && window.Konva.Layer) {
        st.layer = new window.Konva.Layer({ listening: false });
        // World group: mirrors the map group's position and zoom, so shapes
        // drawn in world units follow the map on pan/zoom for free.
        st.world = new window.Konva.Group({ listening: false });
        st.trailGroup = new window.Konva.Group({ listening: false });
        st.routeGroup = new window.Konva.Group({ listening: false });
        st.world.add(st.trailGroup);
        st.world.add(st.routeGroup);
        st.layer.add(st.world);
        st.marks = new window.Konva.Group({ listening: false });
        st.layer.add(st.marks);
        st.marker = new window.Konva.Circle({ radius: 20, stroke: "#ffd54f", strokeWidth: 3, dash: [8, 5], listening: false, visible: false });
        st.layer.add(st.marker);
        stage.add(st.layer);
      }
    } catch (e) { log("error", { where: "konva layer", error: String(e) }); }
  }
  // World-unit helpers: the map group's unit per cell is geo.ux / geo.s.
  function worldUnit(geo) { return { x: geo.ux / geo.s, y: geo.uy / geo.s }; }
  function cellToWorld(geo, cx, cy, offset) { var u = worldUnit(geo); return { x: cx * u.x, y: -(cy + (offset === undefined ? CELL_VISUAL_OFFSET : offset)) * u.y }; }
  function syncWorld(geo) {
    if (!st.world) return;
    st.world.position({ x: geo.gx, y: geo.gy });
    st.world.scale({ x: geo.s, y: geo.s });
  }
  function onMove() {
    if (!st.stage) return;
    var pos = st.stage.getPointerPosition();
    if (!pos) return;
    var geo = geometry();
    if (!geo) return;
    var cell = pxToCell(geo, pos.x, pos.y);
    var rect = st.stage.container().getBoundingClientRect();
    showTip(cell, rect.left + pos.x, rect.top + pos.y);
    syncWorld(geo);
    updateMarker(geo);
    updateMarks(geo);
  }
  function updateMarker(geo) {
    if (!st.marker) return;
    var f = st.finder;
    if (!f) { if (st.marker.visible()) { st.marker.visible(false); st.layer.batchDraw(); } return; }
    geo = geo || geometry();
    if (!geo) return;
    var p = cellToPx(geo, f.x, f.y);
    st.marker.position(p);
    st.marker.radius(Math.min(geo.ux, geo.uy) * 0.42);
    st.marker.visible(true);
    st.layer.batchDraw();
  }
  // Rings on your own discoveries and coloured dots for points of interest,
  // rebuilt only when the view or the loaded systems change.
  function updateMarks(geo) {
    if (!st.marks || !window.Konva) return;
    geo = geo || geometry();
    if (!geo) return;
    var sys = props().systems || {};
    var key = [Math.round(geo.gx), Math.round(geo.gy), geo.s, Object.keys(sys).length, sys === st.marksSys ? 1 : 0, prefs.mine ? 1 : 0, prefs.poi ? 1 : 0, prefs.nodes ? 1 : 0, st.nodesVersion, userId() || ""].join("|");
    if (key === st.marksKey) return;
    st.marksKey = key;
    st.marksSys = sys;
    st.marks.destroyChildren();
    if (prefs.mine || prefs.poi || prefs.nodes) {
      var W = st.stage.width(), H = st.stage.height();
      var r = Math.min(geo.ux, geo.uy);
      for (var k in sys) {
        var s = sys[k];
        var c = cellToPx(geo, num(s.coordinate_x), num(s.coordinate_y), PLANET_OFFSET);
        if (c.x < -r || c.x > W + r || c.y < -r || c.y > H + r) continue;
        if (prefs.mine) {
          var ring = isMine(s) ? "#69f0ae" : isSquad(s) ? "#4fc3f7" : null;
          if (ring) st.marks.add(new window.Konva.Circle({ x: c.x, y: c.y, radius: r * 0.3, stroke: ring, strokeWidth: Math.max(1, r * 0.02), opacity: 0.5, listening: false }));
        }
        if (prefs.nodes && isRich(num(s.coordinate_x), num(s.coordinate_y))) {
          // Orange diamond at the planet's top-left: a known node >= NODE_MIN%.
          var d = r * 0.13;
          st.marks.add(new window.Konva.Rect({ x: c.x - r * 0.24, y: c.y - r * 0.24, width: d, height: d, offsetX: d / 2, offsetY: d / 2, rotation: 45, fill: "#ffa726", stroke: "#000", strokeWidth: 1, listening: false }));
        }
        if (prefs.poi) {
          var pois = poiOf(s);
          for (var i = 0; i < pois.length; i++) {
            st.marks.add(new window.Konva.Circle({ x: c.x + r * 0.2 + i * r * 0.14, y: c.y - r * 0.24, radius: r * 0.06, fill: pois[i].color, stroke: "#000", strokeWidth: 1, listening: false }));
          }
        }
      }
    }
    st.layer.batchDraw();
  }

  // --- hover tag --------------------------------------------------------
  function ensureTip() {
    if (tip && document.body.contains(tip)) return;
    tip = document.createElement("div");
    tip.id = "soEngineAlertTip";
    tip.style.cssText = [
      "position:fixed", "z-index:2147483001", "pointer-events:none", "display:none",
      "font:12px/1.35 Rubik,sans-serif", "color:#fff", "background:rgba(10,20,40,0.92)",
      "border:1px solid rgba(255,255,255,0.25)", "border-radius:8px", "padding:6px 9px",
      "white-space:nowrap", "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    ].join(";");
    document.body.appendChild(tip);
  }
  function hideTip() { if (tip) tip.style.display = "none"; st.tipCell = null; }
  function showTip(cell, clientX, clientY) {
    ensureTip();
    var p = props();
    var ship = shipCell();
    var sys = (p.systems || {})[cell.x + "," + cell.y];
    var head, body;
    var here = cell.x === ship.x && cell.y === ship.y;
    if (sys) {
      var flags = poiOf(sys).map(function (x) { return x.label; });
      if (isMine(sys)) flags.push("discovered by you");
      else if (sys.discovered_by && sys.discovered_by.username) flags.push("by " + esc(sys.discovered_by.username) + (isSquad(sys) ? " (squadron)" : ""));
      head = "<b>" + esc(sys.name || "?") + "</b> <span style='opacity:.75'>[" + cell.x + ", " + cell.y + "] · " + esc(sys.star || "") + (flags.length ? " · " + flags.join(", ") : "") + "</span>";
    } else {
      head = "<b style='color:#ffd54f'>Unexplored</b> <span style='opacity:.75'>[" + cell.x + ", " + cell.y + "]</span>";
    }
    var nodesLine = "";
    if (sys) {
      var ni = nodeInfo(cell.x, cell.y);
      if (ni) {
        nodesLine = (ni.q >= NODE_MIN ? "<span style='color:#ffa726'>◆</span> " : "") + "bodies: " + bodiesText(ni) +
          " <span style='opacity:.6'>(seen " + dur(Date.now() - (ni.t || Date.now())) + " ago)</span>";
      } else {
        var gb = num(sys.gathering_bodies);
        nodesLine = (gb > 0 ? gb + " gathering bod" + (gb === 1 ? "y" : "ies") : "no gathering bodies") + " <span style='opacity:.6'>(details unknown until visited)</span>";
      }
    }
    if (here) {
      body = "<span style='opacity:.75'>you are here · fuel " + fmt(num(p.currentFuel)) + "</span>";
    } else {
      var ly = distLy(ship, cell);
      var cost = fuelCost(ly);
      var fuel = num(p.currentFuel);
      var after = fuel - cost;
      var dx = cell.x - ship.x, dy = cell.y - ship.y;
      body = Math.round(ly) + " ly " + compass(dx, dy) + " · fuel " + cost.toFixed(1) + " → " + Math.max(0, after).toFixed(0) + " left";
      if (after < 0) body += " · <b style='color:#ff6f60'>not enough fuel</b>";
      else if (cost > 0) body += " · " + Math.floor(fuel / cost) + " jumps like this";
      if (ly > CONFIRM_LY) body += " · <span style='color:#ffd54f'>over " + CONFIRM_LY + " ly, needs confirm</span>";
    }
    tip.innerHTML = head + "<br>" + body + (nodesLine ? "<br>" + nodesLine : "");
    tip.style.display = "block";
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var x = clientX + 16, y = clientY + 18;
    if (x + w > window.innerWidth - 8) x = clientX - w - 12;
    if (y + h > window.innerHeight - 8) y = clientY - h - 12;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    st.tipCell = cell;
  }

  // --- nearest unexplored ---------------------------------------------
  // Search area: the box spanned by the loaded systems, widened to whatever
  // is on screen right now. Both are exactly the cells the game draws as
  // either a system or a "?" - so "unexplored" here matches what you see.
  function searchBox(geo) {
    var sys = props().systems || {};
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var k in sys) {
      var parts = k.split(",");
      var x = Number(parts[0]), y = Number(parts[1]);
      if (!isFinite(x) || !isFinite(y)) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (geo && st.stage) {
      var W = st.stage.width(), H = st.stage.height();
      var vx0 = Math.ceil((0 - geo.gx) / geo.ux), vx1 = Math.floor((W - geo.gx) / geo.ux);
      var vy0 = Math.ceil((geo.gy - H) / geo.uy - CELL_VISUAL_OFFSET), vy1 = Math.floor(geo.gy / geo.uy - CELL_VISUAL_OFFSET);
      if (vx1 - vx0 < 400 && vy1 - vy0 < 400) {
        if (vx0 < minX) minX = vx0; if (vx1 > maxX) maxX = vx1; if (vy0 < minY) minY = vy0; if (vy1 > maxY) maxY = vy1;
      }
    }
    if (!isFinite(minX)) return null;
    return { minX: Math.max(1, minX), maxX: maxX, minY: Math.max(1, minY), maxY: maxY };
  }
  function computeFinder() {
    var p = props();
    var sys = p.systems || {};
    var ship = shipCell();
    var geo = geometry();
    var box = searchBox(geo);
    var key = ship.x + "," + ship.y + "|" + Object.keys(sys).length + "|" + (sys === st.finderSys ? 1 : 0) + "|" + (box ? [box.minX, box.minY, box.maxX, box.maxY].join(",") : "-");
    if (key === st.finderKey && st.finder !== undefined) return st.finder;
    st.finderKey = key;
    st.finderSys = sys;
    var best = null, count = 0;
    if (box) {
      for (var cx = box.minX; cx <= box.maxX; cx++) {
        for (var cy = box.minY; cy <= box.maxY; cy++) {
          if (sys[cx + "," + cy]) continue;
          if (cx === ship.x && cy === ship.y) continue;
          count++;
          var d = distLy(ship, { x: cx, y: cy });
          if (!best || d < best.ly) best = { x: cx, y: cy, ly: d };
        }
      }
    }
    if (best) { best.count = count; best.dx = best.x - ship.x; best.dy = best.y - ship.y; best.fuel = fuelCost(best.ly); }
    st.finder = best;
    return best;
  }
  function centerOn(x, y) {
    try {
      var store = getStore();
      if (!store) return;
      store.camera_x = x;
      store.camera_y = y;
      log("galaxy", { center: [x, y] });
    } catch (e) { log("error", { where: "centerOn", error: String(e) }); }
  }

  // --- session stats ----------------------------------------------------
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_SESSION) || "null");
      if (s && typeof s.startedAt === "number") return Object.assign(newSession(), s);
    } catch (e) {}
    return newSession();
  }
  function newSession() { return { startedAt: Date.now(), jumps: 0, newSystems: 0, dust: 0, xp: 0, fuelSpent: 0, ly: 0, moves: 0, trail: [], lastSig: null }; }
  function saveSession() { try { localStorage.setItem(LS_SESSION, JSON.stringify(session)); } catch (e) {} }
  var session = loadSession();
  function resetSession() { session = newSession(); saveSession(); st.lastRewards = null; st.trailKey = null; lastPos = null; log("galaxy", { session: "reset" }); render(); }
  // Called every tick from page-core with the ExploreStore state.
  function trackRewards(ex) {
    var lr = ex && ex.lastRewards;
    if (!lr || typeof lr !== "object") return;
    if (lr === st.lastRewards) return;
    st.lastRewards = lr;
    var cs = ex.currentSystem || {};
    var sig = [cs._id || "", cs.coordinate_x, cs.coordinate_y, lr.cosmic_dust, lr.xp_gain, lr.newSystem ? 1 : 0].join("|");
    if (sig === session.lastSig) return;
    if (session.lastSig === null) {
      // First reading of a fresh session is the jump that happened before
      // the session started: remember it so it is not counted later, but
      // do not count it now.
      session.lastSig = sig;
      saveSession();
      return;
    }
    session.lastSig = sig;
    session.jumps += 1;
    if (lr.newSystem) session.newSystems += 1;
    session.dust += num(lr.cosmic_dust);
    session.xp += num(lr.xp_gain);
    saveSession();
    log("jump", { newSystem: !!lr.newSystem, dust: num(lr.cosmic_dust), xp: num(lr.xp_gain), sessionJumps: session.jumps });
  }
  // Distance and fuel are measured from the ship's position changing, not
  // from the reward event: the reward object lands a moment before the
  // position does, so measuring there reads zero for part of the jumps.
  var lastPos = null;
  function trackPosition(ex) {
    var c = coordsOf(ex && ex.currentSystem);
    if (!c || !(c.x > 0) || !(c.y > 0)) return;
    var moved = lastPos && (lastPos.x !== c.x || lastPos.y !== c.y);
    if (moved) {
      var ly = distLy(lastPos, c);
      session.ly += ly;
      session.fuelSpent += fuelCost(ly);
      session.moves += 1;
    }
    // Trail: every distinct position this session, in order.
    if (!Array.isArray(session.trail)) session.trail = [];
    var t = session.trail, tl = t.length ? t[t.length - 1] : null;
    if (!tl || tl[0] !== c.x || tl[1] !== c.y) {
      t.push([c.x, c.y]);
      if (t.length > 500) t.splice(0, t.length - 500);
      saveSession();
    } else if (moved) {
      saveSession();
    }
    lastPos = c;
  }
  // Average fuel per jump this session; falls back to the nearest unexplored
  // cell's cost, then to one plain 10 ly hop.
  function avgJumpFuel() {
    if (session.moves > 0 && session.fuelSpent > 0) return session.fuelSpent / session.moves;
    if (st.finder && st.finder.fuel > 0) return st.finder.fuel;
    return fuelCost(10);
  }
  function fuelInfo() {
    var fuel = num(props().currentFuel);
    var avg = avgJumpFuel();
    var jumps = avg > 0 ? Math.floor(fuel / avg) : null;
    return { fuel: fuel, total: num(props().totalFuel), avg: avg, jumps: jumps, low: avg > 0 && fuel < 2 * avg };
  }
  function lowFuel() { return !!(st.canvas && !st.canvas.isUnmounted && fuelInfo().low); }

  // --- rune -------------------------------------------------------------
  function runeInfo(ex) {
    var cs = ex && ex.currentSystem;
    var r = cs && cs.active_rune;
    if (!r || !r.rune_name) return null;
    var exp = r.expires_at;
    var t = typeof exp === "number" ? (exp < 1e12 ? exp * 1000 : exp) : (exp ? Date.parse(exp) : NaN);
    return { name: r.rune_name, body: r.body_name, expiresAt: isFinite(t) ? t : null };
  }

  // --- remembered gathering nodes ----------------------------------------
  // The map (and the game's bbox API) only carry a COUNT of gathering bodies
  // per system; node type and quality are known for the current system, for
  // bookmarked systems, and for any system seen while the plugin runs. Those
  // are remembered in localStorage keyed by "x,y": { q: best quality, n:
  // [[type, quality], ...], t: when seen }.
  var nodesDb = (function () {
    try { var d = JSON.parse(localStorage.getItem(LS_NODES) || "{}"); return d && typeof d === "object" ? d : {}; } catch (e) { return {}; }
  })();
  var nodesDirty = false;
  function saveNodes() {
    if (!nodesDirty) return;
    nodesDirty = false;
    try {
      var keys = Object.keys(nodesDb);
      if (keys.length > NODES_MAX_ENTRIES) {
        keys.sort(function (a, b) { return (nodesDb[a].t || 0) - (nodesDb[b].t || 0); });
        for (var i = 0; i < keys.length - NODES_MAX_ENTRIES; i++) delete nodesDb[keys[i]];
      }
      localStorage.setItem(LS_NODES, JSON.stringify(nodesDb));
    } catch (e) {}
  }
  function rememberSystem(sys) {
    if (!sys || !Array.isArray(sys.bodies)) return;
    var c = coordsOf(sys);
    if (!c || !(c.x > 0) || !(c.y > 0)) return;
    var n = [], all = [], q = 0;
    for (var i = 0; i < sys.bodies.length; i++) {
      var b = sys.bodies[i];
      if (!b) continue;
      var qual = b.hasNodes ? num(b.nodeQuality) : 0;
      // every body: [type, node type or "", node quality]
      all.push([String(b.type || "?"), b.hasNodes ? String(b.nodeType || "?") : "", qual]);
      if (!b.hasNodes) continue;
      n.push([String(b.nodeType || "?"), qual]);
      if (qual > q) q = qual;
    }
    var key = c.x + "," + c.y;
    var prev = nodesDb[key];
    var sig = JSON.stringify(all);
    if (prev && prev.sig === sig) return;
    nodesDb[key] = { q: q, n: n, b: all, sig: sig, t: Date.now() };
    nodesDirty = true;
  }
  // "Gas Planet, Asteroid (rocky 3%), Belt" for a remembered system.
  function bodiesText(e) {
    if (!Array.isArray(e.b)) return e.n.length ? "nodes: " + nodesText(e) : "no gathering nodes";
    return e.b.map(function (p) {
      var s = esc(p[0]);
      if (p[1]) s += " (<span style='" + (p[2] >= NODE_MIN ? "color:#ffa726;font-weight:bold" : "") + "'>" + esc(p[1]) + " " + Math.round(p[2]) + "%</span>)";
      return s;
    }).join(", ");
  }
  function nodeInfo(x, y) { return nodesDb[x + "," + y] || null; }
  function isRich(x, y) { var e = nodeInfo(x, y); return !!(e && e.q >= NODE_MIN); }
  function nodesText(e) {
    return e.n.map(function (p) { return esc(p[0]) + " " + Math.round(p[1]) + "%"; }).join(", ");
  }
  // Nearest remembered rich system (anywhere) and how many rich ones sit in
  // the loaded/visible systems.
  function richSummary() {
    var ship = shipCell();
    var sys = props().systems || {};
    var nearest = null, inView = 0, total = 0;
    for (var k in nodesDb) {
      var e = nodesDb[k];
      if (!e || e.q < NODE_MIN) continue;
      total++;
      var parts = k.split(",");
      var c = { x: Number(parts[0]), y: Number(parts[1]) };
      if (sys[k]) inView++;
      if (c.x === ship.x && c.y === ship.y) continue;
      var d = distLy(ship, c);
      if (!nearest || d < nearest.ly) nearest = { x: c.x, y: c.y, ly: d, q: e.q, dx: c.x - ship.x, dy: c.y - ship.y, fuel: fuelCost(d) };
    }
    return { nearest: nearest, inView: inView, total: total };
  }

  // --- bookmarks and stations -----------------------------------------
  function placesList(kind) {
    var p = props();
    var ship = shipCell();
    var out = [];
    var list = kind === "bookmarks" ? (p.bookmarks || []) : (p.spaceStations || []);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var sys = kind === "bookmarks" ? it.system : it.system_parked;
      var c = coordsOf(sys);
      if (!c) continue;
      var ly = distLy(ship, c);
      var entry = { x: c.x, y: c.y, ly: ly, fuel: fuelCost(ly), dx: c.x - ship.x, dy: c.y - ship.y };
      if (kind === "bookmarks") {
        entry.name = (sys && sys.name) || "?";
        entry.note = it.description || "";
      } else {
        entry.name = it.name || (sys && sys.name) || "station";
        entry.rangeLy = STATION_BASE_RANGE_LY + num(it.range) * STATION_RANGE_PER_LEVEL_LY;
        entry.inRange = ly <= entry.rangeLy;
      }
      out.push(entry);
    }
    out.sort(function (a, b) { return a.ly - b.ly; });
    return out;
  }

  // --- route planner ----------------------------------------------------
  // Straight line from the ship to the destination, cut into hops no longer
  // than MAX_HOP_LY, each waypoint rounded to a cell. Fuel is linear in
  // distance, so the total is (nearly) the direct cost; the point of the
  // plan is the hop count, the waypoints and the time.
  function planRoute(dest) {
    var ship = shipCell();
    if (!dest || (dest.x === ship.x && dest.y === ship.y)) return null;
    var total = distLy(ship, dest);
    var n = Math.max(1, Math.ceil(total / MAX_HOP_LY));
    var hops, ly, ok = false;
    for (var attempt = 0; attempt < 4 && !ok; attempt++, n++) {
      hops = []; ly = 0; ok = true;
      var prev = ship;
      for (var i = 1; i <= n; i++) {
        var p = i === n ? { x: dest.x, y: dest.y } : { x: Math.round(ship.x + (dest.x - ship.x) * i / n), y: Math.round(ship.y + (dest.y - ship.y) * i / n) };
        if (p.x === prev.x && p.y === prev.y) continue;
        var d = distLy(prev, p);
        if (d > MAX_HOP_LY + 1e-9) { ok = false; break; }
        ly += d;
        hops.push({ x: p.x, y: p.y, ly: d, fuel: fuelCost(d) });
        prev = p;
      }
    }
    return { dest: dest, hops: hops, ly: ly, fuel: fuelCost(ly), jumps: hops.length };
  }
  function setRoute(cell) {
    st.route = planRoute(cell);
    st.routeKey = null;
    if (st.route) log("galaxy", { route: [cell.x, cell.y], jumps: st.route.jumps });
    render();
  }
  function clearRoute() { st.route = null; st.routeKey = null; render(); }
  function updateRoute(geo) {
    if (!st.routeGroup) return;
    var r = st.route;
    var ship = shipCell();
    var key = r ? [r.dest.x, r.dest.y, ship.x, ship.y, geo.s].join("|") : "-";
    if (key === st.routeKey) return;
    st.routeKey = key;
    st.routeGroup.destroyChildren();
    if (!r) { st.layer.batchDraw(); return; }
    // Re-plan from the current position so the drawn route follows the ship.
    if (r.hops.length && (r.hops[0].fromX !== ship.x || r.hops[0].fromY !== ship.y)) {
      var fresh = planRoute(r.dest);
      if (!fresh) { st.route = null; st.layer.batchDraw(); return; }
      st.route = r = fresh;
      r.hops[0].fromX = ship.x; r.hops[0].fromY = ship.y;
    }
    var u = worldUnit(geo);
    var pts = [];
    var w0 = cellToWorld(geo, ship.x, ship.y);
    pts.push(w0.x, w0.y);
    for (var i = 0; i < r.hops.length; i++) { var w = cellToWorld(geo, r.hops[i].x, r.hops[i].y); pts.push(w.x, w.y); }
    st.routeGroup.add(new window.Konva.Line({ points: pts, stroke: "#8ecbff", strokeWidth: u.y * 0.05, dash: [u.y * 0.3, u.y * 0.18], opacity: 0.9, listening: false, lineCap: "round", lineJoin: "round" }));
    for (var j = 0; j < r.hops.length; j++) {
      var wp = cellToWorld(geo, r.hops[j].x, r.hops[j].y);
      var last = j === r.hops.length - 1;
      st.routeGroup.add(new window.Konva.Circle({ x: wp.x, y: wp.y, radius: u.y * (last ? 0.16 : 0.1), fill: last ? "#8ecbff" : "rgba(142,203,255,0.5)", stroke: "#0b1830", strokeWidth: u.y * 0.03, listening: false }));
      st.routeGroup.add(new window.Konva.Text({ x: wp.x + u.y * 0.2, y: wp.y - u.y * 0.45, text: String(j + 1), fontSize: u.y * 0.3, fontFamily: "Rubik", fontStyle: "bold", fill: "#8ecbff", listening: false }));
    }
    st.layer.batchDraw();
  }
  function routeSummary() {
    var r = st.route;
    if (!r) return null;
    var fuel = num(props().currentFuel);
    return { dest: r.dest, jumps: r.jumps, ly: r.ly, fuel: r.fuel, left: fuel - r.fuel, enough: fuel >= r.fuel, timeMs: r.jumps * st.cooldownMs };
  }

  // --- direction census -----------------------------------------------------
  // Which compass direction holds the most unexplored cells in the loaded
  // and visible area: a hint for where to head next.
  function computeCensus(geo) {
    var ship = shipCell();
    var sys = props().systems || {};
    var box = searchBox(geo);
    var key = [ship.x, ship.y, Object.keys(sys).length, sys === st.censusSys ? 1 : 0, box ? [box.minX, box.minY, box.maxX, box.maxY].join(",") : "-"].join("|");
    if (key === st.censusKey) return st.census;
    st.censusKey = key;
    st.censusSys = sys;
    var dirs = {}, top = null;
    if (box) {
      for (var bx = box.minX; bx <= box.maxX; bx++) for (var by = box.minY; by <= box.maxY; by++) {
        if (sys[bx + "," + by] || (bx === ship.x && by === ship.y)) continue;
        var dname = compass(bx - ship.x, by - ship.y);
        dirs[dname] = (dirs[dname] || 0) + 1;
      }
      for (var k in dirs) if (!top || dirs[k] > dirs[top]) top = k;
    }
    st.census = { dirs: dirs, top: top };
    return st.census;
  }

  // --- session trail --------------------------------------------------------
  function updateTrail(geo) {
    if (!st.trailGroup) return;
    var tr = session.trail || [];
    var key = (prefs.trail ? tr.length : -1) + "|" + geo.s;
    if (key === st.trailKey) return;
    st.trailKey = key;
    st.trailGroup.destroyChildren();
    if (prefs.trail && tr.length > 1) {
      var u = worldUnit(geo);
      var pts = [];
      for (var i = 0; i < tr.length; i++) { var w = cellToWorld(geo, tr[i][0], tr[i][1], PLANET_OFFSET); pts.push(w.x, w.y); }
      st.trailGroup.add(new window.Konva.Line({ points: pts, stroke: "#4dd0e1", strokeWidth: u.y * 0.06, opacity: 0.45, listening: false, lineCap: "round", lineJoin: "round" }));
      for (var j = 0; j < tr.length; j++) {
        var wp = cellToWorld(geo, tr[j][0], tr[j][1], PLANET_OFFSET);
        st.trailGroup.add(new window.Konva.Circle({ x: wp.x, y: wp.y, radius: u.y * 0.07, fill: "#4dd0e1", opacity: 0.5, listening: false }));
      }
    }
    st.layer.batchDraw();
  }

  // --- panel ------------------------------------------------------------
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return;
    panel = document.createElement("div");
    panel.id = "soEngineAlertGalaxy";
    panel.style.cssText = [
      "position:fixed", "z-index:2147483000", "display:none",
      "font:12px/1.4 Rubik,sans-serif", "color:#fff", "background:rgba(10,20,40,0.85)",
      "border:1px solid rgba(255,255,255,0.25)", "border-radius:10px", "padding:7px 11px",
      "cursor:move", "user-select:none", "white-space:nowrap", "max-width:560px",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    ].join(";");
    panel.addEventListener("click", function (e) {
      var el = e.target;
      while (el && el !== panel && !(el.getAttribute && el.getAttribute("data-act"))) el = el.parentNode;
      var a = el && el !== panel && el.getAttribute("data-act");
      if (!a) return;
      e.stopPropagation();
      if (a === "center") centerOn(Number(el.getAttribute("data-x")), Number(el.getAttribute("data-y")));
      else if (a === "route") setRoute({ x: Number(el.getAttribute("data-x")), y: Number(el.getAttribute("data-y")) });
      else if (a === "clearroute") clearRoute();
      else if (a === "reset") resetSession();
      else if (a === "pref") { var k = el.getAttribute("data-k"); prefs[k] = !prefs[k]; savePrefs(); st.marksKey = null; st.trailKey = null; render(); }
    });
    makeDraggable(panel, LS_PANEL_POS, null, function () {
      // Default: right edge, stacked above the on/off pill.
      var pill = document.getElementById("soEngineAlertBtn");
      var bottom = 12;
      if (pill) { var r = pill.getBoundingClientRect(); if (r.height > 0) bottom = Math.round(window.innerHeight - r.top) + 8; }
      panel.style.left = "auto"; panel.style.top = "auto"; panel.style.right = "12px"; panel.style.bottom = bottom + "px";
    });
    document.body.appendChild(panel);
  }
  var linkStyle = "color:#8ecbff;cursor:pointer;text-decoration:underline;pointer-events:auto";
  function link(act, text, attrs) { return "<span data-act='" + act + "'" + (attrs || "") + " style='" + linkStyle + "'>" + text + "</span>"; }
  function centerLink(x, y, text) { return link("center", text || "center", " data-x='" + x + "' data-y='" + y + "'") + " " + link("route", "route", " data-x='" + x + "' data-y='" + y + "'"); }
  function prefLink(key, text) { return link("pref", (prefs[key] ? "☑ " : "☐ ") + text, " data-k='" + key + "'"); }
  function placeLine(e, extra) {
    var cells = Math.max(Math.abs(e.dx), Math.abs(e.dy));
    return "<b>" + esc(short(e.name, 16)) + "</b> [" + e.x + ", " + e.y + "] · " + (cells ? cells + " " + compass(e.dx, e.dy) + " · " + Math.round(e.ly) + " ly · fuel " + e.fuel.toFixed(1) : "here") + (extra || "") + " " + centerLink(e.x, e.y);
  }
  function routeLine() {
    var r = routeSummary();
    if (!r) return "<b style='color:#8ecbff'>Route</b> <span style='opacity:.7'>right-click (or Shift+click) any cell on the map to plan a route there, or use a <u>route</u> link above</span>";
    var style = r.enough ? "" : "color:#ff6f60;font-weight:bold";
    return "<b style='color:#8ecbff'>Route</b> to [" + r.dest.x + ", " + r.dest.y + "] · " + r.jumps + " jump" + (r.jumps === 1 ? "" : "s") + " · " + Math.round(r.ly) + " ly · <span style='" + style + "'>fuel " + r.fuel.toFixed(1) + (r.enough ? " → " + Math.max(0, r.left).toFixed(0) + " left" : " (not enough)") + "</span>" +
      " · ~" + dur(r.timeMs) + " <span style='opacity:.7'>at " + Math.round(st.cooldownMs / 1000) + "s per jump</span> " + link("clearroute", "clear");
  }
  function censusText() {
    var c = st.census;
    return c && c.top ? " · most unexplored: <b>" + c.top + "</b> (" + c.dirs[c.top] + ")" : "";
  }
  function render(ex) {
    if (!panel) return;
    if (!onGalaxyPage() || !st.canvas) { panel.style.display = "none"; return; }
    var lines = [];
    // nearest unexplored
    var f = st.finder;
    if (f) {
      var cells = Math.max(Math.abs(f.dx), Math.abs(f.dy));
      lines.push("<b style='color:#ffd54f'>Nearest unexplored</b> [" + f.x + ", " + f.y + "] · " + cells + " cell" + (cells > 1 ? "s" : "") + " " + compass(f.dx, f.dy) +
        " · " + Math.round(f.ly) + " ly · fuel " + f.fuel.toFixed(1) + " " + centerLink(f.x, f.y) +
        "<br><span style='opacity:.7'>" + f.count + " unexplored in view or loaded" + censusText() + "</span>");
    } else {
      lines.push("<b style='color:#ffd54f'>Nearest unexplored</b> <span style='opacity:.7'>none in view or loaded</span>");
    }
    // fuel
    var fi = fuelInfo();
    var fuelStyle = fi.low ? "color:#ffab40;font-weight:bold" : "";
    lines.push("<b>Fuel</b> <span style='" + fuelStyle + "'>" + fmt(fi.fuel) + (fi.total ? " / " + fmt(fi.total) : "") + "</span> · avg jump " + fi.avg.toFixed(1) +
      (fi.jumps !== null ? " → <span style='" + fuelStyle + "'>~" + fi.jumps + " jump" + (fi.jumps === 1 ? "" : "s") + " left</span>" : "") +
      (fi.low ? " <span style='color:#ffab40'>⚠ low</span>" : ""));
    // rune
    var rune = runeInfo(ex);
    if (rune) {
      var left = rune.expiresAt !== null ? rune.expiresAt - Date.now() : null;
      lines.push("<b style='color:#b388ff'>Rune</b> " + esc(rune.name) + (rune.body ? " on " + esc(rune.body) : "") +
        (left === null ? "" : left > 0 ? " · expires in " + mmssLeft(left) : " · <span style='color:#ff6f60'>expired</span>"));
    }
    // session
    var elapsed = Date.now() - session.startedAt;
    var hours = Math.max(elapsed, 60000) / 3600000;
    var perJump = session.jumps ? session.dust / session.jumps : 0;
    lines.push("<b>Session</b> " + dur(elapsed) + " · " + session.jumps + " jump" + (session.jumps === 1 ? "" : "s") + " · " + session.newSystems + " new" +
      " · dust " + fmt(session.dust) + " <span style='opacity:.7'>(" + fmt(session.dust / hours) + "/h · " + fmt(perJump) + "/jump)</span>" +
      " · XP " + fmt(session.xp) + " " + link("reset", "reset"));
    // rich gathering nodes
    var rich = richSummary();
    if (rich.nearest) {
      var rn = rich.nearest;
      var rcells = Math.max(Math.abs(rn.dx), Math.abs(rn.dy));
      lines.push("<b style='color:#ffa726'>◆ Nodes ≥" + NODE_MIN + "%</b> nearest known [" + rn.x + ", " + rn.y + "] (" + Math.round(rn.q) + "%) · " + rcells + " " + compass(rn.dx, rn.dy) +
        " · " + Math.round(rn.ly) + " ly · fuel " + rn.fuel.toFixed(1) + " " + centerLink(rn.x, rn.y) +
        " <span style='opacity:.7'>· " + rich.inView + " in view, " + rich.total + " known</span>");
    } else {
      lines.push("<b style='color:#ffa726'>◆ Nodes ≥" + NODE_MIN + "%</b> <span style='opacity:.7'>none known yet: quality is learned from systems you visit and your bookmarks</span>");
    }
    // route
    lines.push(routeLine());
    // marks
    lines.push("<span style='opacity:.85'>Marks: " + prefLink("mine", "discoveries") + " " + prefLink("poi", "points of interest") + " " + prefLink("nodes", "nodes ≥" + NODE_MIN + "%") +
      " " + prefLink("trail", "session trail") +
      " <span style='opacity:.7'>(<span style='color:#69f0ae'>◯</span> mine <span style='color:#4fc3f7'>◯</span> squadron · " + POI.map(function (p) { return "<span style='color:" + p.color + "'>●</span> " + p.label; }).join(" ") + " <span style='color:#ffa726'>◆</span> rich nodes)</span></span>");
    // bookmarks
    var bms = placesList("bookmarks");
    lines.push(prefLink("bookmarks", "<b>Bookmarks</b> (" + bms.length + ")"));
    if (prefs.bookmarks) {
      if (!bms.length) lines.push("<span style='opacity:.7'>&nbsp;&nbsp;none</span>");
      for (var i = 0; i < bms.length; i++) lines.push("&nbsp;&nbsp;" + placeLine(bms[i], bms[i].note ? " <span style='opacity:.7'>" + esc(short(bms[i].note, 24)) + "</span>" : ""));
    }
    // stations
    var sts = placesList("stations");
    var inRange = sts.filter(function (s) { return s.inRange; }).length;
    lines.push(prefLink("stations", "<b>Squadron stations</b> (" + sts.length + (sts.length ? ", " + inRange + " in range" : "") + ")"));
    if (prefs.stations) {
      if (!sts.length) lines.push("<span style='opacity:.7'>&nbsp;&nbsp;none</span>");
      for (var j = 0; j < Math.min(sts.length, 6); j++) {
        var s = sts[j];
        lines.push("&nbsp;&nbsp;" + placeLine(s, s.inRange ? " · <span style='color:#69f0ae'>in range</span>" : " · <span style='opacity:.7'>range " + s.rangeLy + " ly</span>"));
      }
      if (sts.length > 6) lines.push("<span style='opacity:.7'>&nbsp;&nbsp;… " + (sts.length - 6) + " more</span>");
    }
    var html = lines.join("<br>");
    if (panel.innerHTML !== html) panel.innerHTML = html;
    panel.style.display = "block";
  }

  // --- tick ---------------------------------------------------------------
  var lastFinderAt = 0;
  function learnNodes(ex) {
    if (ex && ex.currentSystem) rememberSystem(ex.currentSystem);
    var bms = props().bookmarks;
    if (Array.isArray(bms)) for (var i = 0; i < bms.length; i++) rememberSystem(bms[i] && bms[i].system);
    if (nodesDirty) { st.nodesVersion = (st.nodesVersion || 0) + 1; saveNodes(); }
  }
  function tick(ex) {
    trackRewards(ex);
    trackPosition(ex);
    learnNodes(ex);
    ensurePanel();
    if (!ensureParts()) { render(ex); return; }
    // Cooldown length, learned from each new timer the game publishes (a
    // fresh value well in the future is a jump's cooldown plus travel time).
    if (ex && typeof ex.engineCooldown === "number" && ex.engineCooldown !== st.prevCooldown) {
      var ahead = ex.engineCooldown - Date.now();
      if (st.prevCooldown !== null && ahead > 30000 && ahead < 30 * 60000) st.cooldownMs = ahead;
      st.prevCooldown = ex.engineCooldown;
    }
    var now = Date.now();
    var geo = geometry();
    if (geo) syncWorld(geo);
    if (now - lastFinderAt > 1000) { lastFinderAt = now; computeFinder(); if (geo) computeCensus(geo); }
    updateMarker(geo);
    updateMarks(geo);
    if (geo) { updateRoute(geo); updateTrail(geo); }
    render(ex);
  }

  function stop() {
    teardownMap();
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
    panel = null; tip = null;
  }

  return {
    tick: tick,
    stop: stop,
    session: function () { return session; },
    resetSession: resetSession,
    finder: function () { return st.finder; },
    fuel: fuelInfo,
    lowFuel: lowFuel,
    places: placesList,
    nodes: function () { return nodesDb; },
    rich: richSummary,
    route: routeSummary,
    setRoute: setRoute,
    clearRoute: clearRoute,
    census: function () { return st.census; },
    cooldownMs: function () { return st.cooldownMs; },
    prefs: prefs,
    centerOn: centerOn,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { installGalaxyInfo };
}
