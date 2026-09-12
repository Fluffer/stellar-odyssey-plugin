// The battling, gathering, crafting, voyager, player and tech panels against
// the captured game state (test/fixtures/game-state.json).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { installDom, ctxFor } = require("./helpers/dom-stub.js");
const { installMorePages } = require("../lib/page-more.js");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "game-state.json"), "utf8"));

function panelOn(hash, id) {
  const dom = installDom(hash);
  const realNow = Date.now;
  Date.now = () => fixture.now;
  try {
    const ctx = ctxFor(fixture);
    const mods = installMorePages(ctx);
    for (const m of mods) m.tick(null);
    const panel = dom.body.children.find(c => c.id === id);
    assert.ok(panel, id + " exists");
    assert.equal(panel.style.display, "block", id + " shown on " + hash);
    // every other panel stays hidden
    for (const c of dom.body.children) if (c.id !== id) assert.equal(c.style.display, "none", c.id + " hidden on " + hash);
    return { html: panel.innerHTML, mods, dom, ctx };
  } finally {
    Date.now = realNow;
  }
}

test("battling panel: NPC, countdowns, last fight, session tally", () => {
  const { html, mods, dom, ctx } = panelOn("#/battling", "soBattlePanel");
  assert.match(html, /Battling<\/b> dusters <b>L703<\/b>/);
  assert.match(html, /next action in <b>12:45<\/b>/);            // 1789191414308 - now = 764 s
  assert.match(html, /offline actions expire in <b>3d 0h<\/b>/);  // 1789450553 s vs now
  assert.match(html, /Last fight<\/b> <span style='color:#69f0ae'>WIN<\/span> · \+398\.6K credits · \+340 XP · clones 2\/2 · lowest HP 51% · NPC hit 46% \/ dodge 44%/);
  // the first observed reward only seeds the tally; a second distinct one counts
  assert.match(html, /0 fights/);
  const bs = ctx.getStoreById("BattleStore").$state;
  bs.lastReward = Object.assign({}, bs.lastReward, { amount: 400000, simulation: Object.assign({}, bs.lastReward.simulation, { win: "mob" }) });
  const realNow = Date.now; Date.now = () => fixture.now + 2000;
  try { for (const m of mods) m.tick(null); } finally { Date.now = realNow; }
  const panel = dom.body.children.find(c => c.id === "soBattlePanel");
  assert.match(panel.innerHTML, /1 fight · win rate <b>0%<\/b>/);
  assert.match(panel.innerHTML, /LOSS/);
});

test("gathering panel: node, last haul, droid survival, tally", () => {
  const { html } = panelOn("#/gathering", "soGatherPanel");
  assert.match(html, /Gathering<\/b> Comet · <b style='color:#ffa726'>crystal 100%<\/b>/);
  assert.match(html, /next action in <b>13:14<\/b>/);
  assert.match(html, /Last haul<\/b> \+1\.15M diamond · \+120 XP · droids back <b style='color:#ffab40'>6\/7<\/b>/);
  // 7 droids at maneuverability 35 with +20% from two lone dodge mods: 50 + 17.5 + 20 = 87.5% each
  assert.match(html, /Droids<\/b> 7 · expected back <b>6\.1<\/b> per action · dodge 88% · dodge mods \+20% · maneuverability cap 60/);
  assert.doesNotMatch(html, /all droids past it/);
});

test("crafting panel: craftable count, blockers with farm spots, selected blueprint", () => {
  const { html } = panelOn("#/crafting", "soCraftPanel");
  // BP0 needs carbon/flame/scrap: all in stock. BP1 needs 40 ectoplasm (7 held) and 20 frost shards (7 held). BP2 needs 10 ectoplasm.
  assert.match(html, /<b>1<\/b> of 3 blueprints craftable now/);
  assert.match(html, /<b>ectoplasm<\/b> \(2 blueprints, up to 33 short, farm spectres \/ Nebula\)/);
  assert.match(html, /<b>frost shard<\/b> \(1 blueprint, up to 13 short, farm glacials \/ Icy Planet\)/);
  assert.match(html, /Selected<\/b> Create Epic weapon blueprint: <span style='color:#ffab40'>missing ectoplasm 33 \(spectres \/ Nebula\), frost shard 13 \(glacials \/ Icy Planet\)<\/span>/);
});

test("voyager panel: fuel per jump and idle state", () => {
  const { html } = panelOn("#/voyager", "soVoyagerPanel");
  // store timer 1156 is the reduction off a 30-minute base: 1800 - 1156 = 644 s, the page's "10m 44s";
  // fuel per jump is charged server-side, so the panel reports the tank and never guesses a cost
  assert.match(html, /fuel <b style='color:#ffab40'>5\.5 \/ 114<\/b> · max 3 jumps · 10m per jump · reward bonus \+20% \(tech \+19%\)/);
  assert.doesNotMatch(html, /jumps of fuel/);
  assert.match(html, /No expedition planned/);
});

test("player panel: levels behind the matching skill, value caps, dodge-mod note", () => {
  const { html } = panelOn("#/player", "soPlayerPanel");
  // weapon L95 legendary at crafting 65: cap = round(10 * 1.95 * 2 * 95) = 3705; battling 96 -> 1 level behind, recraft cap 3744
  assert.match(html, /<b>weapon<\/b> L95 legendary · value 3\.6K \/ cap 3\.7K \(96%\) · mods: electromagnetic · <span style='opacity:\.7'>1 level behind battling 96; recraft cap 3\.7K<\/span>/);
  // engine L66 vs exploring 67
  assert.match(html, /<b>engine<\/b> L66 legendary [^<]*<span style='opacity:\.7'>1 level behind exploring 67/);
  // laser L91 vs gathering 92; droids (35) are below the maneuverability cap (60), so no recraft note
  assert.match(html, /<b>laser<\/b> L91 legendary [^<]*<span style='opacity:\.7'>1 level behind gathering 92/);
  assert.doesNotMatch(html, /dodge mod adds nothing/);
});

test("tech panel: cores to max, cheapest levels, what the cores buy", () => {
  const { html } = panelOn("#/tech", "soTechPanel");
  assert.match(html, /Tech<\/b> 149 quantum cores/);
  // cheapest next level: voyager_reward_boost L19 -> 2*20 = 40 cores
  assert.match(html, /cheapest next levels:<\/span> voyager reward boost L19 → 40/);
  // 149 cores: 40 (L19->20), 42 (L20->21), 44 (L21->22) = 126, next 46 too many
  assert.match(html, /Your cores buy<\/b> \+3 voyager reward boost/);
  // furthest from max: voyager_reward_boost L19 -> 10100 - 380 = 9720 cores; total over all unlocked skills 81.7K
  assert.match(html, /furthest from max:<\/span> voyager reward boost L19 \(9\.7K cores\)/);
  assert.match(html, /81\.7K to max every unlocked skill/);
});
