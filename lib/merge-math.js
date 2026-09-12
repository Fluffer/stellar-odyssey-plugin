// Catalyst merge planning, ported from the advisor (lib/merges.js) minus
// the pull-from-gear merges (those need the effective value of installed
// catalysts, which the advisor computes from full gear analysis).
//
// Game rules (advisor constants, from the game bundle):
//   - 5 catalysts of the same stat, rarity and activity merge into one of
//     the next rarity; result range = min(100, avg(input ranges) + bonus),
//     bonus = 5 + floor(craftingLevel / 10).
//   - success chance = base(rarity) + 0.1 * craftingLevel, capped at 100;
//   - cost in quantum cores per merge, plus an optional protect cost that
//     keeps the inputs on failure.
//   - a legendary merged with legendaries stays legendary (range rises).
// Only merges that stay on the perfect-legendary path (range 100 reachable
// with the bonus propagating one tier per step) are suggested.
//
// ES2017, no Node APIs: concatenated into the injected script and the
// extension through a module shim; also loaded by the tests.

(function () {
var RARITIES = ["normal", "uncommon", "rare", "unique", "epic", "legendary"];
var MERGE_CHANCE = { normal: 100, uncommon: 75, rare: 60, unique: 45, epic: 30, legendary: 20 };
var MERGE_COST = { normal: 0, uncommon: 27, rare: 31, unique: 37, epic: 43, legendary: 50 };
var PROTECT_COST = { normal: 0, uncommon: 50, rare: 100, unique: 200, epic: 500, legendary: 1000 };
var MERGE_RANGE_BONUS = 5;
var CRAFT_LEVEL_MERGE_BONUS = 0.1;
var GROUP = 5;

function mergeRangeBonus(craftLevel) { return MERGE_RANGE_BONUS + Math.floor((craftLevel || 0) / 10); }
function mergeSuccessChance(rarity, craftLevel) { return Math.min(100, (MERGE_CHANCE[rarity] || 50) + (craftLevel || 0) * CRAFT_LEVEL_MERGE_BONUS); }
function nextRarity(rarity) { var i = RARITIES.indexOf(rarity); return RARITIES[Math.min(i + 1, RARITIES.length - 1)]; }
function activityOf(c) { return c.activity || "default"; }
function avgRange(g) { var s = 0; for (var i = 0; i < g.length; i++) s += g[i].range; return s / g.length; }

// The game's planCatalystMergeGroups: form groups of 5 using the WEAKEST
// catalysts that still reach avg + bonus >= target (saves high ranges).
function planCatalystMergeGroups(items, bonus, target, size) {
  target = target === undefined ? 100 : target;
  size = size || GROUP;
  var s = items.slice().sort(function (a, b) { return b.range - a.range; });
  var n = Math.floor(s.length / size);
  if (n < 1) return { groups: [], leftover: s };
  var need = size * Math.max(0, target - bonus);
  var groups = [];
  while (groups.length < n) {
    var grp = [], sum = 0;
    while (grp.length < size) {
      var remaining = size - grp.length - 1;
      var topSum = 0;
      for (var k = 0; k < remaining; k++) topSum += s[k].range;
      var proj = function (idx) { return topSum + (idx < remaining ? s[remaining].range : s[idx].range); };
      var pick = 0;
      if (proj(0) >= need - sum) {
        for (var j = s.length - 1; j >= 0; j--) { if (proj(j) >= need - sum) { pick = j; break; } }
      }
      var c = s.splice(pick, 1)[0];
      grp.push(c);
      sum += c.range;
    }
    groups.push(grp.sort(function (a, b) { return b.range - a.range; }));
  }
  return { groups: groups, leftover: s };
}

// Minimum RESULT range a merge into rarity rIdx must reach to stay on the
// perfect-legendary path (the bonus propagates one tier per step).
function tierThreshold(rIdx, bonus) { return Math.max(0, 100 - (RARITIES.length - 1 - rIdx) * bonus); }

// planMerges(pool, craftLevel) -> plans sorted by value, one per (stat, activity):
//   { stat, activity, steps: [{ from, to, chance, qc, protectQc, recommendProtect,
//     groups: [{ ids, inputs, result }] }], chainGoal, projectedLegendaries, perfectCount }
function planMerges(pool, craftLevel) {
  var bonus = mergeRangeBonus(craftLevel);
  var byKey = {};
  for (var i = 0; i < pool.length; i++) {
    var c = pool[i];
    if (!c || c.onMarket || c.locked || c.equippedOn) continue;
    var key = c.stat + "|" + activityOf(c);
    (byKey[key] = byKey[key] || []).push(c);
  }
  var plans = [];
  Object.keys(byKey).forEach(function (key) {
    var parts = key.split("|"), stat = parts[0], act = parts[1];
    var list = byKey[key];
    var tiers = {};
    RARITIES.forEach(function (r) { tiers[r] = list.filter(function (c) { return c.rarity === r; }); });
    var steps = [];
    for (var ri = 0; ri < RARITIES.length; ri++) {
      var rarity = RARITIES[ri], next = nextRarity(rarity);
      if (tiers[rarity].length < GROUP) continue;
      var perfecting = rarity === "legendary";
      var planned = planCatalystMergeGroups(tiers[rarity], bonus);
      var usable = planned.groups.filter(function (g) {
        var res = Math.min(100, avgRange(g) + bonus);
        if (perfecting) { var best = Math.max.apply(null, g.map(function (c) { return c.range; })); return res >= 100 && res > best - 0.001; }
        return res >= tierThreshold(RARITIES.indexOf(next), bonus);
      });
      if (!usable.length) continue;
      var chance = Math.round(mergeSuccessChance(rarity, craftLevel) * 10) / 10;
      var cost = MERGE_COST[rarity], protect = PROTECT_COST[rarity];
      var p = chance / 100;
      steps.push({
        from: rarity, to: perfecting ? "legendary" : next, chance: chance,
        qc: cost, protectQc: protect, recommendProtect: cost > 0 && (cost / p) > (cost + protect),
        groups: usable.map(function (g) {
          return { ids: g.map(function (c) { return c._id; }), inputs: g.map(function (c) { return c.range; }), result: Math.round(Math.min(100, avgRange(g) + bonus) * 10) / 10 };
        }),
      });
      var resultRarity = perfecting ? "legendary" : next;
      // Consume the merged inputs first, then add the projected results: for a
      // legendary-to-legendary merge both live in the same tier.
      tiers[rarity] = planned.leftover.concat(planned.groups.filter(function (g) { return usable.indexOf(g) < 0; }).reduce(function (a, g) { return a.concat(g); }, []));
      tiers[resultRarity] = tiers[resultRarity].concat(usable.map(function (g) { return { _id: "projected", stat: stat, rarity: resultRarity, range: Math.min(100, avgRange(g) + bonus) }; }));
    }
    if (!steps.length) return;
    var legendaries = tiers.legendary.map(function (c) { return Math.round(c.range * 10) / 10; });
    var bestLeg = legendaries.length ? Math.max.apply(null, legendaries) : null;
    var chainGoal;
    if (bestLeg !== null) chainGoal = { rarity: "legendary", range: bestLeg, perfect: bestLeg >= 100 };
    else {
      var bestRes = 0, bestTo = null;
      steps.forEach(function (s) { s.groups.forEach(function (g) { if (g.result > bestRes) { bestRes = g.result; bestTo = s.to; } }); });
      chainGoal = bestTo ? { rarity: bestTo, range: bestRes, perfect: false } : null;
    }
    plans.push({
      stat: stat, activity: act, steps: steps, chainGoal: chainGoal,
      projectedLegendaries: legendaries,
      perfectCount: legendaries.filter(function (r) { return r >= 100; }).length,
      merges: steps.reduce(function (n, s) { return n + s.groups.length; }, 0),
      qcTotal: steps.reduce(function (n, s) { return n + s.groups.length * s.qc; }, 0),
    });
  });
  plans.sort(function (a, b) { return (b.perfectCount - a.perfectCount) || (b.projectedLegendaries.length - a.projectedLegendaries.length) || (b.merges - a.merges); });
  return plans;
}

var MergeMath = {
  RARITIES: RARITIES, MERGE_CHANCE: MERGE_CHANCE, MERGE_COST: MERGE_COST, PROTECT_COST: PROTECT_COST,
  mergeRangeBonus: mergeRangeBonus, mergeSuccessChance: mergeSuccessChance, nextRarity: nextRarity,
  planCatalystMergeGroups: planCatalystMergeGroups, tierThreshold: tierThreshold, planMerges: planMerges,
};
if (typeof module !== "undefined" && module.exports) module.exports = MergeMath;
if (typeof window !== "undefined") window.SoMergeMath = MergeMath;
})();
