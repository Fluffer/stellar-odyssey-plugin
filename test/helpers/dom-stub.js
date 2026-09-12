// Minimal DOM / browser stand-in for exercising the page overlays in Node.
// Enough for panels: createElement, appendChild, innerHTML, style, contains.

function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(), className: "", id: "", style: {}, children: [], childNodes: [], parentNode: null, _html: "", textContent: "",
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
}

// Installs globals (document, window, location, localStorage) and returns
// the body so tests can find panels by id.
function installDom(hash) {
  const body = makeEl("body");
  const store = {};
  global.document = { body, createElement: makeEl, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
  global.window = { innerWidth: 1600, innerHeight: 900 };
  global.location = { hash };
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  return { body, store };
}

// getStoreById over a fixture shaped like test/fixtures/game-state.json.
function storesFor(fx) {
  const map = {
    PetsStore: fx.pets, UserStore: fx.user, PremiumStore: fx.premium, CurrencyStore: fx.currency,
    MaterialsStore: { materialsList: fx.materials }, LaboratoryStore: fx.lab,
    ShipStore: fx.ship, BattleStore: Object.assign({ battling_level: fx.levels && fx.levels.battling }, fx.battle),
    GatherStore: Object.assign({ gathering_level: fx.levels && fx.levels.gathering }, fx.gather),
    ExploreStore: { exploring_level: fx.levels && fx.levels.exploring },
    CraftStore: fx.craft, Voyager: fx.voyager,
    CatalystStore: { catalysts: fx.catalysts || [] },
  };
  return (id) => (map[id] ? { $state: map[id] } : null);
}

function ctxFor(fx, extra) {
  return Object.assign({
    cfg: {}, log: () => {}, lsPrefix: "test.", getStoreById: storesFor(fx),
    makeDraggable: (el, key, onClick, place) => { if (place) place(el); },
  }, extra);
}

module.exports = { makeEl, installDom, storesFor, ctxFor };
