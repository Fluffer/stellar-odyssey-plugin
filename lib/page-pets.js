// Pets-page overlay, running INSIDE the game page.
//
// The game's own pet cards show XP, food and XP per hour. This adds what
// they leave out, using the advisor's pet math (lib/pet-math.js, the game's
// exact formulas):
//   - time to the next level for every pet (active and in the store);
//   - whether one more XP-boost level is worth it: hours saved and the cost
//     (paid in EACH of the 16 common resources) against your scarcest one;
//   - a small panel: pet food stock, daily burn and days left, and the
//     scarcest resource that caps boost upgrades.
//
// Same rules as the other page files: ES2017, no Node APIs, plain function
// declaration; concatenated into the injected script and the extension.
//
// installPetsInfo(ctx) -> { tick(), stop() }
//   ctx: { cfg, log, makeDraggable, lsPrefix, getStoreById, PetMath }

function installPetsInfo(ctx) {
  var log = ctx.log;
  var makeDraggable = ctx.makeDraggable;
  var getStoreById = ctx.getStoreById;
  var PM = ctx.PetMath;
  var LS_PANEL_POS = ctx.lsPrefix + "petsPos";
  var CARD_CLASS = "soPetInfo";

  var panel = null;
  var last = { sig: null, model: null };

  function onPage() { return /#\/pets/.test(location.hash); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function hoursText(h) {
    if (h === null || h === undefined || !isFinite(h)) return "never";
    if (h <= 0) return "now";
    var d = Math.floor(h / 24), r = h % 24;
    return d > 0 ? d + "d " + r + "h" : r + "h";
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function state(id) { var s = getStoreById(id); return s ? s.$state : null; }

  // --- model ------------------------------------------------------------
  function readModel() {
    var ps = state("PetsStore");
    if (!ps || !Array.isArray(ps.pets)) return null;
    var us = state("UserStore") || {};
    var prem = state("PremiumStore") || {};
    var cur = state("CurrencyStore") || {};
    var mat = state("MaterialsStore") || {};
    var techSkill = num(us.player && us.player.skills && us.player.skills.pets_base_xp_boost);
    var premiumActive = !!prem.active;
    var slots = Array.isArray(ps.petSlots) ? ps.petSlots : [];
    var slotOf = {};
    for (var i = 0; i < slots.length; i++) if (slots[i] && slots[i].pet) slotOf[slots[i].pet] = slots[i];
    var minResource = Infinity, scarcest = null;
    for (var r = 0; r < PM.PET_COMMON_RESOURCES.length; r++) {
      var name = PM.PET_COMMON_RESOURCES[r];
      var amount = num(cur[name]);
      if (amount < minResource) { minResource = amount; scarcest = name; }
    }
    var food = 0;
    var list = Array.isArray(mat.materialsList) ? mat.materialsList : [];
    for (var m = 0; m < list.length; m++) if (list[m] && list[m].item && list[m].item.name === "pet food") { food = num(list[m].quantity); break; }
    var sig = JSON.stringify([techSkill, premiumActive, minResource, food, ps.pets.map(function (p) { return [p._id, p.level, p.current_xp, p.xpboost, p.food]; }), slots.map(function (s) { return [s.pet, s.autofeed, s.autofeed_limit]; })]);
    if (sig === last.sig) return last.model;
    var pets = ps.pets.map(function (p) {
      var slot = slotOf[p._id] || null;
      var equipped = !!slot;
      var autofeed = slot ? !!slot.autofeed : false;
      var limit = slot ? (num(slot.autofeed_limit) || PM.PET_FOOD_FLOOR) : PM.PET_FOOD_FLOOR;
      var boost = num(p.xpboost), level = num(p.level), xp = num(p.current_xp), fd = num(p.food);
      var hours = PM.petHoursToNextLevel(level, xp, boost, fd, autofeed, limit, techSkill, premiumActive);
      var hoursPlus = PM.petHoursToNextLevel(level, xp, boost + 1, fd, autofeed, limit, techSkill, premiumActive);
      var cost = PM.petXpBoostCost(boost);
      return {
        id: p._id, name: p.name, level: level, equipped: equipped,
        xpPerHour: PM.petXpPerHour(level, boost, fd, techSkill, premiumActive),
        hours: hours, hoursPlus: hoursPlus, saved: isFinite(hours) && isFinite(hoursPlus) ? hours - hoursPlus : null,
        cost: cost, affordable: minResource >= cost, limit: limit, autofeed: autofeed,
      };
    });
    var burnPerDay = 0;
    for (var k = 0; k < pets.length; k++) if (pets[k].equipped) burnPerDay += 24 / ((100 - pets[k].limit) / 5 + 1);
    last.sig = sig;
    last.model = { pets: pets, food: food, burnPerDay: burnPerDay, foodDays: burnPerDay > 0 ? Math.floor(food / burnPerDay) : null, scarcest: scarcest, minResource: minResource === Infinity ? 0 : minResource, techSkill: techSkill, premiumActive: premiumActive };
    return last.model;
  }

  // --- card lines ------------------------------------------------------
  function findCards(names) {
    var out = [];
    var els = document.querySelectorAll("div, span, b");
    for (var i = 0; i < els.length; i++) {
      var n = els[i].childNodes[0];
      if (!n || n.nodeType !== 3) continue;
      var text = n.textContent.trim();
      if (!names[text]) continue;
      var card = els[i], hops = 0;
      while (card && !(card.classList && card.classList.contains("q-card")) && hops < 12) { card = card.parentElement; hops++; }
      if (!card) continue;
      var active = /Unequip pet/.test(card.textContent);
      out.push({ name: text, card: card, active: active });
    }
    return out;
  }
  function lineFor(p, active) {
    var parts = [];
    if (active) parts.push("next level in <b>" + hoursText(p.hours) + "</b>");
    else parts.push("if equipped: <b>" + p.xpPerHour + " XP/h</b> · next level in <b>" + hoursText(p.hours) + "</b>");
    if (p.saved !== null) {
      parts.push("+1 boost saves <b>" + hoursText(p.saved) + "</b> · " + fmt(p.cost) + " each " +
        (p.affordable ? "<span style='color:#69f0ae'>✓ affordable</span>" : "<span style='color:#ffab40'>✗ short</span>"));
    }
    return parts.join(" · ");
  }
  function updateCards(model) {
    var names = {};
    var byName = {};
    for (var i = 0; i < model.pets.length; i++) { names[model.pets[i].name] = true; byName[model.pets[i].name] = model.pets[i]; }
    var cards = findCards(names);
    var seen = [];
    for (var c = 0; c < cards.length; c++) {
      var p = byName[cards[c].name];
      if (!p) continue;
      var card = cards[c].card;
      var el = card.querySelector(":scope > ." + CARD_CLASS);
      if (!el) {
        el = document.createElement("div");
        el.className = CARD_CLASS;
        el.style.cssText = "margin:6px 8px 8px;padding:6px 8px;font:12px/1.35 Rubik,sans-serif;color:#dfe8f5;background:rgba(10,20,40,0.55);border:1px solid rgba(142,203,255,0.25);border-radius:8px;white-space:normal";
        card.appendChild(el);
      }
      var html = lineFor(p, cards[c].active);
      if (el.innerHTML !== html) el.innerHTML = html;
      seen.push(el);
    }
    // drop lines whose card vanished or moved
    var all = document.querySelectorAll("." + CARD_CLASS);
    for (var a = 0; a < all.length; a++) if (seen.indexOf(all[a]) < 0) all[a].parentNode.removeChild(all[a]);
  }

  // --- panel ------------------------------------------------------------
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return;
    panel = document.createElement("div");
    panel.id = "soPetsPanel";
    panel.style.cssText = [
      "position:fixed", "z-index:2147483000", "display:none",
      "font:12px/1.4 Rubik,sans-serif", "color:#fff", "background:rgba(10,20,40,0.85)",
      "border:1px solid rgba(255,255,255,0.25)", "border-radius:10px", "padding:7px 11px",
      "cursor:move", "user-select:none", "white-space:nowrap", "max-width:560px",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    ].join(";");
    makeDraggable(panel, LS_PANEL_POS, null, function () {
      var pill = document.getElementById("soEngineAlertBtn");
      var bottom = 12;
      if (pill) { var r = pill.getBoundingClientRect(); if (r.height > 0) bottom = Math.round(window.innerHeight - r.top) + 8; }
      panel.style.left = "auto"; panel.style.top = "auto"; panel.style.right = "12px"; panel.style.bottom = bottom + "px";
    });
    document.body.appendChild(panel);
  }
  function render(model) {
    if (!panel) return;
    if (!onPage() || !model) { panel.style.display = "none"; return; }
    var lines = [];
    lines.push("<b>Pet food</b> " + fmt(model.food) + " · burn " + model.burnPerDay.toFixed(1) + "/day" +
      (model.foodDays !== null ? " → <b" + (model.foodDays < 7 ? " style='color:#ffab40'" : "") + ">" + model.foodDays + " days</b>" : ""));
    lines.push("<b>Boost upgrades</b> capped by <b>" + esc(model.scarcest || "?") + "</b> (" + fmt(model.minResource) + " in stock) · pet tech skill " + model.techSkill + "%" + (model.premiumActive ? " · premium +10%" : ""));
    // best next boost: largest hours saved among equipped, affordable pets
    var best = null;
    for (var i = 0; i < model.pets.length; i++) {
      var p = model.pets[i];
      if (!p.equipped || !p.affordable || p.saved === null) continue;
      if (!best || p.saved > best.saved) best = p;
    }
    lines.push(best
      ? "<b>Best boost now</b> " + esc(best.name) + ": +1 saves " + hoursText(best.saved) + " for " + fmt(best.cost) + " of each resource"
      : "<span style='opacity:.7'>No affordable boost on an equipped pet right now</span>");
    var html = lines.join("<br>");
    if (panel.innerHTML !== html) panel.innerHTML = html;
    panel.style.display = "block";
  }

  var lastAt = 0;
  function tick() {
    ensurePanel();
    if (!onPage()) { render(null); return; }
    var now = Date.now();
    if (now - lastAt < 1000) return;
    lastAt = now;
    var model = readModel();
    if (!model) { render(null); return; }
    try { updateCards(model); } catch (e) { log("error", { where: "pets cards", error: String(e) }); }
    render(model);
  }
  function stop() {
    var all = document.querySelectorAll("." + CARD_CLASS);
    for (var a = 0; a < all.length; a++) all[a].parentNode.removeChild(all[a]);
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }
  return { tick: tick, stop: stop, model: readModel };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { installPetsInfo };
}
