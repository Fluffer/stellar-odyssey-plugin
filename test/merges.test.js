// Catalyst merge planning (lib/merge-math.js, ported from the advisor) and
// the crafting panel's merge lines, against the fixture's catalyst pool.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const MergeMath = require("../lib/merge-math.js");
const { installDom, ctxFor } = require("./helpers/dom-stub.js");
const { installMorePages } = require("../lib/page-more.js");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "game-state.json"), "utf8"));

test("merge rules: bonus, chance, thresholds", () => {
  assert.equal(MergeMath.mergeRangeBonus(65), 11);            // 5 + floor(65/10)
  assert.equal(MergeMath.mergeSuccessChance("rare", 65), 66.5); // 60 + 0.1 * 65
  assert.equal(MergeMath.mergeSuccessChance("normal", 65), 100);
  assert.equal(MergeMath.nextRarity("epic"), "legendary");
  assert.equal(MergeMath.nextRarity("legendary"), "legendary");
  assert.equal(MergeMath.tierThreshold(3, 11), 78);            // unique must reach 78 to end at 100
  assert.equal(MergeMath.tierThreshold(1, 11), 56);
});

test("planMerges: the weakest five that still stay on the perfect path, one plan per stat", () => {
  const plans = MergeMath.planMerges(fixture.catalysts, 65);
  assert.equal(plans.length, 1, "only defense qualifies: fuel_efficiency normals are too weak, one epic is on the market");
  const p = plans[0];
  assert.equal(p.stat, "defense");
  assert.equal(p.activity, "default");
  assert.equal(p.steps.length, 1);
  const s = p.steps[0];
  assert.equal(s.from, "rare");
  assert.equal(s.to, "unique");
  assert.equal(s.chance, 66.5);
  assert.equal(s.qc, 31);
  assert.equal(s.protectQc, 100);
  assert.equal(s.recommendProtect, false);                     // 31 / 0.665 = 46.6 < 131
  assert.equal(s.groups.length, 1);
  assert.deepEqual(s.groups[0].inputs, [90, 88, 85, 84, 80]);  // the 40 is left over
  assert.equal(s.groups[0].result, 96.4);                       // avg 85.4 + 11
  assert.deepEqual(p.chainGoal, { rarity: "unique", range: 96.4, perfect: false });
  assert.equal(p.merges, 1);
  assert.equal(p.qcTotal, 31);
});

test("planMerges: legendaries merge only towards a perfect 100", () => {
  const legs = [96, 97, 98, 99, 95].map((r, i) => ({ _id: "L" + i, stat: "defense", rarity: "legendary", range: r, activity: "default" }));
  const plans = MergeMath.planMerges(legs, 65);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].steps[0].to, "legendary");
  assert.equal(plans[0].steps[0].groups[0].result, 100);
  assert.equal(plans[0].perfectCount, 1);
  const weak = legs.map(c => Object.assign({}, c, { range: 60 }));
  assert.equal(MergeMath.planMerges(weak, 65).length, 0, "60s would not reach 100");
});

test("crafting panel shows the recommended merges", () => {
  const dom = installDom("#/crafting");
  const mods = installMorePages(ctxFor(fixture, { MergeMath }));
  for (const m of mods) m.tick(null);
  const panel = dom.body.children.find(c => c.id === "soCraftPanel");
  assert.ok(panel && panel.style.display === "block");
  assert.match(panel.innerHTML, /Merges<\/b> <b>1<\/b> recommended · 31 quantum cores in total <span style='color:#69f0ae'>\(you hold 149\)<\/span> · merge bonus \+11/);
  assert.match(panel.innerHTML, /<b>defense<\/b> · 1× rare → unique · ranges 90\/88\/85\/84\/80 → <b>96\.4<\/b> · 66\.5% chance · 31 QC <span style='opacity:\.7'>→ unique 96\.4<\/span>/);
});
