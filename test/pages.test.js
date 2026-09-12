// Exercises the pets and laboratory page overlays against a captured game
// state (test/fixtures/game-state.json, taken live on 2026-09-12) with a
// minimal DOM stand-in. Locks the numbers the overlays print so a change in
// the shared math, or in how the game state is read, shows up here.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "game-state.json"), "utf8"));
const PetMath = require("../lib/pet-math.js");
const LabMath = require("../lib/lab-math.js");
const { installPetsInfo } = require("../lib/page-pets.js");
const { installLabInfo } = require("../lib/page-lab.js");

// --- tiny DOM stand-in --------------------------------------------------
function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(), className: "", id: "", style: {}, children: [], childNodes: [], parentNode: null,
    _html: "", textContent: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    get innerText() { return this._html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " "); },
    get classList() { const self = this; return { contains: (c) => self.className.split(/\s+/).includes(c) }; },
    appendChild(c) { c.parentNode = this; this.children.push(c); this.childNodes.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; },
    querySelector(sel) { const cls = sel.replace(":scope > .", "").replace(".", ""); return this.children.find(c => c.className === cls) || null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30 }; },
    contains(c) { return this.children.includes(c) || this.children.some(x => x.contains && x.contains(c)); },
    addEventListener() {},
    getAttribute() { return null; },
  };
  return el;
}
function installDom(hash) {
  const body = makeEl("body");
  // One active pet card (Dragon) and one store card (Owl), shaped like the game's.
  const dragonCard = makeEl("div"); dragonCard.className = "q-card"; dragonCard.textContent = "Dragon Level: 14 ... Unequip pet";
  const dragonName = makeEl("div"); dragonName.childNodes = [{ nodeType: 3, textContent: "Dragon" }]; dragonName.parentElement = dragonCard;
  const owlCard = makeEl("div"); owlCard.className = "q-card condensed_card"; owlCard.textContent = "Owl Level: 15 Equip";
  const owlName = makeEl("div"); owlName.childNodes = [{ nodeType: 3, textContent: "Owl" }]; owlName.parentElement = owlCard;
  const inserted = [];
  global.document = {
    body,
    createElement: (t) => { const e = makeEl(t); inserted.push(e); return e; },
    querySelectorAll: (sel) => (sel === "div, span, b" ? [dragonName, owlName] : sel.startsWith(".") ? inserted.filter(e => e.className === sel.slice(1) && e.parentNode) : []),
    getElementById: () => null,
  };
  global.window = { innerWidth: 1600, innerHeight: 900 };
  global.location = { hash };
  const store = {};
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  return { body, dragonCard, owlCard };
}
function stores(fx) {
  const map = {
    PetsStore: fx.pets, UserStore: fx.user, PremiumStore: fx.premium, CurrencyStore: fx.currency,
    MaterialsStore: { materialsList: fx.materials }, LaboratoryStore: fx.lab,
  };
  return (id) => (map[id] ? { $state: map[id] } : null);
}
function ctxFor(fx, extra) {
  return Object.assign({
    cfg: {}, log: () => {}, lsPrefix: "test.", getStoreById: stores(fx),
    makeDraggable: (el, key, onClick, place) => { if (place) place(el); },
  }, extra);
}

test("pets overlay: model, card lines and panel from the captured state", () => {
  const dom = installDom("#/pets");
  const pets = installPetsInfo(ctxFor(fixture, { PetMath }));
  const model = pets.model();
  const dragon = model.pets.find(p => p.name === "Dragon");
  assert.equal(dragon.equipped, true);
  assert.equal(dragon.xpPerHour, 27);          // the game's own card prints 27
  assert.equal(dragon.hours, 32);
  assert.equal(dragon.hoursPlus, 27);
  assert.equal(dragon.saved, 5);
  assert.equal(dragon.cost, PetMath.petXpBoostCost(1));
  assert.equal(dragon.cost, 7500000);           // boost 1 -> 2: floor(7.5m * 1.5^0)
  assert.equal(dragon.affordable, true);        // only the 16 common resources count, all above 7.5M
  assert.equal(model.scarcest, "ammonia");      // 63.1M is the lowest of the 16 common resources
  assert.equal(model.food, 1895);
  assert.equal(Math.round(model.burnPerDay * 10) / 10, 17.5); // 8 equipped pets, limit 50 -> 24/11 h each
  assert.equal(model.foodDays, 108);
  const owl = model.pets.find(p => p.name === "Owl");
  assert.equal(owl.equipped, true);
  const roller = model.pets.find(p => p.name === "Roller");
  assert.equal(roller.equipped, false);
  assert.equal(roller.cost, PetMath.petXpBoostCost(0));
  // tick renders the card lines and the panel
  pets.tick();
  const dragonLine = dom.dragonCard.children.find(c => c.className === "soPetInfo");
  assert.ok(dragonLine, "active card gets a line");
  assert.match(dragonLine.innerHTML, /next level in <b>1d 8h<\/b>/);
  assert.match(dragonLine.innerHTML, /\+1 boost saves <b>5h<\/b> · 7\.5M each/);
  const owlLine = dom.owlCard.children.find(c => c.className === "soPetInfo");
  assert.ok(owlLine, "store card gets a line");
  assert.match(owlLine.innerHTML, /if equipped: <b>\d+ XP\/h<\/b>/);
  const panel = dom.body.children.find(c => c.id === "soPetsPanel");
  assert.ok(panel && panel.style.display === "block");
  assert.match(panel.innerHTML, /Pet food<\/b> 1\.9K · burn 17\.5\/day → <b>108 days<\/b>/);
  assert.match(panel.innerHTML, /capped by <b>ammonia<\/b>/);
  assert.match(panel.innerHTML, /Best boost now<\/b> /);
  // leaving the page hides the panel
  global.location.hash = "#/galaxy";
  pets.tick();
  assert.equal(panel.style.display, "none");
});

test("lab overlay: queue rows and the capsule plan from the captured state", () => {
  const dom = installDom("#/laboratory");
  const realNow = Date.now;
  Date.now = () => fixture.now;
  try {
    const lab = installLabInfo(ctxFor(fixture, { LabMath }));
    const rows = lab.queue();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, "Energetic Fusion Center");
    assert.equal(rows[0].done, Math.floor((fixture.now - 1789186100941) / 22000)); // 206 units after 4549 s
    assert.equal(rows[0].claimable, rows[0].done);
    assert.equal(rows[0].claimReady, true);     // last claim was at queue time, > 10 min ago
    assert.equal(rows[0].finished, false);
    const plan = lab.plan();
    assert.equal(plan.slots, 10);               // premium 6 + 4 bought
    assert.equal(plan.freeSlots, 8);
    assert.equal(plan.capsules, 56);
    const c = plan.core;
    assert.equal(c.ready, true);                // 10 capsules on top of stock: intermediates in stock cover it
    assert.equal(c.binding, null);
    assert.ok(c.hoursPipelined > 0);
    lab.tick();
    const panel = dom.body.children.find(x => x.id === "soLabPanel");
    assert.ok(panel && panel.style.display === "block");
    assert.match(panel.innerHTML, /Queue<\/b> 2 \/ 10 slots · <span style='color:#ffab40'>⚠ 8 idle<\/span>/);
    assert.match(panel.innerHTML, /Energetic Fusion Center<\/b> 206\/1000 · collect 206 <span style='color:#69f0ae'>claim ready<\/span>/);
    assert.match(panel.innerHTML, /<b>10<\/b> .*warp capsules on top of 56 in stock · <span style='color:#69f0ae'>resources cover it<\/span>/);
    assert.match(panel.innerHTML, /critical: <b>Module Assembly Plant<\/b>/);
    assert.match(panel.innerHTML, /runs: Module Assembly Plant 100 \(45m\) · Fuel Lab 100 \(45m\) · Space Capsule Complex 10 \(5m\)/);
  } finally {
    Date.now = realNow;
  }
});
