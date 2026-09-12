// Copied from ../advisor/public/lab-math.js - keep in sync with the advisor.
// Shared laboratory chain math. Loaded by lib/lab.js (engine, via require)
// and by the GUI's app.js (via a <script> tag, as window.LabMath) so the
// planner runs the same code on the server and in the browser.
//
// Game rules (in-game wiki text, client bundle):
//   - A building consumes `input` units of EACH listed input per produced
//     unit and yields `output` units.
//   - Timer per unit = max(5, timer - 0.1 * level) seconds.
//   - Level k costs 1,150,000 * k credits.
//   - Speed multiplier x2..x10 divides the time and multiplies EVERY input
//     of that queue by SPEED_INPUT_MULT[x - 1].
//   - One queue per building (serial); the slot pool is global.
//   - Inputs are consumed at queue time; production keeps running while
//     unclaimed; Claim has a 10-minute cooldown per queue.
//
// Wrapped in a function: in the browser every one of these files is a classic
// <script> sharing ONE global scope, so a top-level `function levelCost` here
// and another in a sibling file silently overwrite each other (lab-math's
// 1.15M x level was replaced by base-math's module curve at call time).
// Only window.LabMath / module.exports leave this scope.
(function () {
const SPEED_INPUT_MULT = [1, 2.6, 4.5, 7, 10.5, 15.4, 22.7, 33.8, 50.9, 77.7];
const LEVEL_COST_BASE = 1150000;
const TIMER_FLOOR = 5;
const TIMER_STEP = 0.1;
const CLAIM_COOLDOWN_MIN = 10;

function normName(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

// Live LaboratoryStore.buildings -> chain graph. A building produces ONE
// product (produce[0]); inputs keep their kind so the GUI can label them.
function buildChain(buildings) {
  const list = (buildings || []).map(b => ({
    name: b.building,
    level: b.level || 0,
    timer: b.timer || 0,
    input: b.input || 0,
    output: b.output || 1,
    product: normName((b.produce || [])[0]),
    inputs: [
      ...(b.currency_use || []).map(n => ({ name: normName(n), kind: "currency" })),
      ...(b.material_use || []).map(n => ({ name: normName(n), kind: "material" })),
    ],
  })).filter(b => b.name && b.product);
  const byProduct = {};
  // Keep the first building for each product; duplicates are ignored
  for (const b of list) if (!byProduct[b.product]) byProduct[b.product] = b;
  return { list, byProduct };
}

// Expand demands through the chain. Existing stock of an intermediate is
// consumed first (once - `remaining` is mutated as we go); the shortfall is
// produced and its inputs demanded in turn. Names no building produces are
// raw and accumulate in `raw`. `opts.netTopLevel` (default true) controls
// whether a demand's own product is netted against stock; when false the
// demand is treated as additional units on top of stock, though the stock
// of everything the demand needs (its inputs, at depth > 0) is still netted.
function expand(chain, demands, stocks, opts) {
  const netTopLevel = !(opts && opts.netTopLevel === false);
  const remaining = {};
  for (const [k, v] of Object.entries(stocks || {})) remaining[normName(k)] = Math.max(0, Number(v) || 0);
  const runs = {}, gross = {}, raw = {};
  const inProgress = new Set();
  const need = (product, units, depth) => {
    if (units <= 0 || depth > 32) return;
    const b = chain.byProduct[product];
    if (!b) { raw[product] = (raw[product] || 0) + units; return; }
    if (inProgress.has(product)) { raw[product] = (raw[product] || 0) + units; return; } // cycle: treat as raw
    gross[product] = (gross[product] || 0) + units;
    const have = (netTopLevel || depth > 0) ? (remaining[product] || 0) : 0;
    const use = Math.min(have, units);
    if (use > 0) remaining[product] = have - use;
    const toProduce = units - use;
    const batches = Math.ceil(Math.max(0, toProduce) / b.output);
    runs[b.name] = (runs[b.name] || 0) + batches;
    if (batches > 0) {
      inProgress.add(product);
      for (const inp of b.inputs) need(inp.name, batches * b.input, depth + 1);
      inProgress.delete(product);
    }
  };
  for (const d of demands || []) need(normName(d.product), Number(d.units) || 0, 0);
  return { runs, gross, raw };
}

// Longest path from a product down to raw inputs. Memoised with an
// in-progress set so a cycle among buildings is treated as raw (depth 0)
// at the point of recursion, rather than recursing forever.
function stageOf(chain, product) {
  const memo = {};
  const visiting = new Set();
  const walk = (p) => {
    const b = chain.byProduct[p];
    if (!b) return 0;
    if (memo[p] !== undefined) return memo[p];
    if (visiting.has(p)) return 0; // cycle: treat as raw, do not recurse
    visiting.add(p);
    let deepest = 0;
    for (const inp of b.inputs) deepest = Math.max(deepest, walk(inp.name));
    visiting.delete(p);
    memo[p] = deepest + 1;
    return memo[p];
  };
  return walk(normName(product));
}

// Stock left after paying a bundle of products (e.g. the base-founding
// cost). Returns a NEW object; the input `stocks` is not mutated.
function stocksAfterBundle(stocks, bundle) {
  const after = { ...(stocks || {}) };
  for (const b of bundle || []) {
    const name = normName(b.product);
    after[name] = Math.max(0, (after[name] || 0) - (Number(b.units) || 0));
  }
  return after;
}

function timerAt(baseTimer, level) {
  return Math.max(TIMER_FLOOR, (baseTimer || 0) - TIMER_STEP * (level || 0));
}
function levelCost(k) {
  return LEVEL_COST_BASE * k;
}
// Levels left until the timer hits the floor (0.1 s each).
function levelsToFloor(baseTimer, level) {
  const total = Math.round(((baseTimer || 0) - TIMER_FLOOR) / TIMER_STEP);
  return Math.max(0, total - (level || 0));
}
// Credits for the next n levels starting after `level`: sum 1.15M * k.
function costToFloor(level, n) {
  if (n <= 0) return 0;
  return LEVEL_COST_BASE * (n * level + (n * (n + 1)) / 2);
}
// The level at which a building's timer reaches the 5 s floor; levels past
// it buy nothing.
function floorLevel(baseTimer) {
  return Math.max(0, Math.round(((baseTimer || 0) - TIMER_FLOOR) / TIMER_STEP));
}
// Credits to take a building from level `from` to level `to` (0 if to <= from).
function upgradeCost(from, to) {
  return costToFloor(from || 0, Math.max(0, (to || 0) - (from || 0)));
}
// How many whole levels above `level` a `budget` of credits buys.
function levelsAffordable(level, budget) {
  const b = Number(budget);
  if (!isFinite(b) || b <= 0) return 0;
  let n = 0;
  while (costToFloor(level, n + 1) <= b && n < 100000) n++;
  return n;
}

// Core plan: expansion + per-building timing + raw coverage + the two chain
// estimates. Pure; `opts.levelOverrides` / `opts.speed` let ROI and speed
// analysis re-run it with one building changed. The demanded product's own
// stock is netted unless `opts.netTopLevel === false`.
function planCore(chain, demands, stocks, opts) {
  opts = opts || {};
  const freeSlots = Math.max(1, opts.freeSlots || 1);
  const overrides = opts.levelOverrides || {};
  const speed = opts.speed || null;
  const stockOf = {};
  for (const [k, v] of Object.entries(stocks || {})) stockOf[normName(k)] = Math.max(0, Number(v) || 0);

  // Speed multiplies the inputs of specified buildings: fold it into the expansion
  // by scaling those buildings' `input` before expanding. Two shapes:
  // `{ buildings: [...], x }` (one multiplier for a group, used by the ROI
  // and speed analysis) or `{ byBuilding: { name: x } }` (the emulator, a
  // multiplier per building). x1 is "no multiplier" and is skipped.
  const speedOf = {};
  if (speed) {
    if (speed.byBuilding) {
      for (const [n, x] of Object.entries(speed.byBuilding)) {
        const xi = Math.min(10, Math.max(1, Math.floor(Number(x) || 1)));
        if (xi > 1) speedOf[n] = xi;
      }
    } else {
      const list = Array.isArray(speed.buildings) ? speed.buildings : (speed.building ? [speed.building] : []);
      const xi = Math.min(10, Math.max(1, Math.floor(Number(speed.x) || 1)));
      if (xi > 1) for (const n of list) speedOf[n] = xi;
    }
  }
  const speedList = Object.keys(speedOf);
  const chainUsed = speedList.length ? {
    list: chain.list.map(b => speedOf[b.name]
      ? { ...b, input: b.input * SPEED_INPUT_MULT[speedOf[b.name] - 1] }
      : b),
    byProduct: {},
  } : chain;
  if (speedList.length) for (const b of chainUsed.list) if (!chainUsed.byProduct[b.product]) chainUsed.byProduct[b.product] = b;

  const ex = expand(chainUsed, demands, stockOf, { netTopLevel: opts.netTopLevel !== false });

  const buildings = chainUsed.list.map(b => {
    const level = overrides[b.name] !== undefined ? overrides[b.name] : b.level;
    const unitsToRun = ex.runs[b.name] || 0;
    const timerNow = timerAt(b.timer, level);
    const div = speedOf[b.name] || 1;
    const seconds = unitsToRun * timerNow / div;
    const inputs = b.inputs.map(inp => {
      const needed = unitsToRun * b.input;
      const stock = stockOf[inp.name] || 0;
      return {
        name: inp.name, kind: inp.kind, perUnit: b.input, needed, stock,
        short: Math.max(0, needed - stock),
        coverage: needed > 0 ? stock / needed : 1,
      };
    });
    return {
      name: b.name, stage: stageOf(chainUsed, b.product), level, unitsToRun, timerNow,
      speedX: div, seconds, hours: seconds / 3600, inputs,
    };
  });

  const raw = Object.entries(ex.raw).map(([name, needed]) => {
    const stock = stockOf[name] || 0;
    const coverage = needed > 0 ? stock / needed : 1;
    const units = (demands || []).reduce((s, d) => s + (Number(d.units) || 0), 0);
    return { name, needed, stock, coverage, unitsSupported: needed > 0 ? Math.floor(coverage * units) : units };
  }).sort((a, b) => a.coverage - b.coverage);

  const shortRaw = raw.filter(r => r.coverage < 1);
  const binding = shortRaw.length ? { name: shortRaw[0].name, coverage: shortRaw[0].coverage } : null;

  // Stages: max within a stage (parallel queues), waves when the stage has
  // more buildings than free slots.
  const stageMap = {};
  for (const b of buildings) {
    if (b.unitsToRun <= 0) continue;
    (stageMap[b.stage] = stageMap[b.stage] || []).push(b);
  }
  let hoursSequential = 0;
  for (const list of Object.values(stageMap)) {
    const longest = Math.max(...list.map(b => b.hours));
    hoursSequential += longest * Math.ceil(list.length / freeSlots);
  }
  let critical = null, maxHours = 0, maxStage = 0;
  for (const b of buildings) {
    if (b.unitsToRun > 0) maxStage = Math.max(maxStage, b.stage);
    if (b.hours > maxHours) { maxHours = b.hours; critical = b.name; }
  }
  const critStage = critical ? buildings.find(b => b.name === critical).stage : 0;
  const hoursPipelined = critical ? maxHours + Math.max(0, maxStage - critStage) * (CLAIM_COOLDOWN_MIN / 60) : 0;

  return {
    buildings, raw, gross: ex.gross, binding, critical,
    hoursSequential, hoursPipelined, freeSlots,
    ready: buildings.length > 0 && shortRaw.length === 0,
  };
}

// Full target plan: core + upgrade ROI (per building, +1 level, full
// recompute) + the critical GROUP (every building tied at the maximum
// hours: upgrading one of them alone saves nothing, so the group row is
// the honest answer) + speed options for the group (full recompute so a
// shifted bottleneck is reflected).
const TIE_EPS = 1e-9;
function planTarget(chain, demands, stocks, opts) {
  opts = opts || {};
  const base = planCore(chain, demands, stocks, opts);
  const running = base.buildings.filter(b => b.unitsToRun > 0);
  const maxHours = running.reduce((m, b) => Math.max(m, b.hours), 0);
  const criticalGroup = base.critical ? running.filter(b => b.hours >= maxHours - TIE_EPS).map(b => b.name) : [];

  const overridesPlus = (names) => {
    const o = { ...(opts.levelOverrides || {}) };
    for (const n of names) {
      const b = base.buildings.find(x => x.name === n);
      o[n] = (b ? b.level : 0) + 1;
    }
    return o;
  };

  const upgradeRoi = running
    .map(b => {
      const src = chain.list.find(x => x.name === b.name);
      const up = planCore(chain, demands, stocks, { ...opts, levelOverrides: overridesPlus([b.name]) });
      const hoursSaved = Math.max(0, base.hoursPipelined - up.hoursPipelined);
      const nextLevelCost = levelCost(b.level + 1);
      const ltf = levelsToFloor(src ? src.timer : 0, b.level);
      return {
        name: b.name, level: b.level, nextLevelCost,
        hoursSaved: hoursSaved < TIE_EPS ? 0 : hoursSaved,
        creditsPerHourSaved: hoursSaved > TIE_EPS ? nextLevelCost / hoursSaved : null,
        levelsToFloor: ltf, costToFloor: costToFloor(b.level, ltf),
      };
    })
    .sort((a, b) => {
      if (a.creditsPerHourSaved === null && b.creditsPerHourSaved === null) return 0;
      if (a.creditsPerHourSaved === null) return 1;
      if (b.creditsPerHourSaved === null) return -1;
      return a.creditsPerHourSaved - b.creditsPerHourSaved;
    });

  let groupRoi = null;
  if (criticalGroup.length) {
    const up = planCore(chain, demands, stocks, { ...opts, levelOverrides: overridesPlus(criticalGroup) });
    const cost = criticalGroup.reduce((s, n) => s + levelCost(base.buildings.find(x => x.name === n).level + 1), 0);
    const hoursSaved = Math.max(0, base.hoursPipelined - up.hoursPipelined);
    groupRoi = {
      buildings: criticalGroup, cost,
      hoursSaved: hoursSaved < TIE_EPS ? 0 : hoursSaved,
      creditsPerHourSaved: hoursSaved > TIE_EPS ? cost / hoursSaved : null,
    };
  }

  let speed = null;
  if (criticalGroup.length) {
    const options = [];
    for (let x = 2; x <= 10; x++) {
      const fast = planCore(chain, demands, stocks, { ...opts, speed: { buildings: criticalGroup, x } });
      const extra = {};
      let affordable = true;
      for (const name of criticalGroup) {
        const before = base.buildings.find(b => b.name === name);
        const after = fast.buildings.find(b => b.name === name);
        for (const inp of after.inputs) {
          const was = before.inputs.find(i => i.name === inp.name);
          extra[inp.name] = (extra[inp.name] || 0) + inp.needed - (was ? was.needed : 0);
          if (inp.coverage < 1) affordable = false;
        }
      }
      options.push({
        x, inputMult: SPEED_INPUT_MULT[x - 1], hours: fast.hoursPipelined,
        hoursSaved: Math.max(0, base.hoursPipelined - fast.hoursPipelined),
        affordable,
        extraInputs: Object.entries(extra).map(([name, e]) => ({ name, extra: e })),
      });
    }
    speed = { buildings: criticalGroup, options };
  }

  return { ...base, upgradeRoi, criticalGroup, groupRoi, speed };
}


// ---- production emulator ----
// "How long does a given amount take, and what do upgrades do to that?"
// A scenario is a per-building level map and a per-building speed map laid
// over the live chain; the answer is the baseline plan (live levels, no
// speed) next to the scenario plan, with the credits the levels cost.
//
// Stock of everything the chain itself produces, zeroed: "from scratch"
// timing, as if no intermediate were on the shelf. Raw resources keep their
// stock so coverage still says what you can afford.
function stripIntermediates(chain, stocks) {
  const out = { ...(stocks || {}) };
  for (const b of chain.list) out[b.product] = 0;
  return out;
}

// Scenario levels never fall below the live level (a building cannot be
// downgraded) and never exceed the floor level (nothing to gain past it).
function clampScenarioLevels(chain, levels) {
  const out = {};
  for (const b of chain.list) {
    const live = b.level || 0;
    const raw = levels && levels[b.name] !== undefined ? Number(levels[b.name]) : live;
    const want = isFinite(raw) ? Math.floor(raw) : live;
    const cap = Math.max(live, floorLevel(b.timer));
    out[b.name] = Math.min(cap, Math.max(live, want));
  }
  return out;
}

// scenario: { levels: {name: level}, speeds: {name: x}, useStock: bool }
// opts:     planCore options (freeSlots, netTopLevel)
function emulateProduction(chain, demands, stocks, scenario, opts) {
  scenario = scenario || {};
  opts = opts || {};
  const stockUsed = scenario.useStock === false ? stripIntermediates(chain, stocks) : (stocks || {});
  const levels = clampScenarioLevels(chain, scenario.levels);
  const speeds = {};
  for (const [n, x] of Object.entries(scenario.speeds || {})) {
    const xi = Math.min(10, Math.max(1, Math.floor(Number(x) || 1)));
    if (xi > 1) speeds[n] = xi;
  }
  const base = planCore(chain, demands, stockUsed, opts);
  const plan = planCore(chain, demands, stockUsed, { ...opts, levelOverrides: levels, speed: { byBuilding: speeds } });

  let upgradeCostTotal = 0;
  const buildings = chain.list.map(src => {
    const b0 = base.buildings.find(x => x.name === src.name);
    const b1 = plan.buildings.find(x => x.name === src.name);
    // A level on a building this product never runs buys nothing here, so
    // it is not billed: the total is the price of the rows on screen.
    const cost = b1.unitsToRun > 0 ? upgradeCost(src.level || 0, levels[src.name]) : 0;
    upgradeCostTotal += cost;
    const extraInputs = b1.inputs.map(i => {
      const was = b0.inputs.find(w => w.name === i.name);
      return { name: i.name, extra: i.needed - (was ? was.needed : 0) };
    }).filter(e => e.extra > 0);
    return {
      name: src.name, stage: b1.stage, unitsToRun: b1.unitsToRun,
      levelNow: src.level || 0, level: levels[src.name], floorLevel: floorLevel(src.timer),
      levelsBought: levels[src.name] - (src.level || 0), upgradeCost: cost,
      speedX: b1.speedX,
      timerNow: b0.timerNow, timer: b1.timerNow,
      hoursNow: b0.hours, hours: b1.hours,
      inputs: b1.inputs, extraInputs,
      critical: false,
    };
  });
  const running = buildings.filter(b => b.unitsToRun > 0);
  const maxHours = running.reduce((m, b) => Math.max(m, b.hours), 0);
  for (const b of running) b.critical = maxHours > 0 && b.hours >= maxHours - TIE_EPS;

  const hoursSaved = Math.max(0, base.hoursPipelined - plan.hoursPipelined);
  return {
    buildings, levels, speeds, base, plan,
    hoursNow: base.hoursPipelined, hours: plan.hoursPipelined,
    hoursSequentialNow: base.hoursSequential, hoursSequential: plan.hoursSequential,
    hoursSaved: hoursSaved < TIE_EPS ? 0 : hoursSaved,
    upgradeCost: upgradeCostTotal,
    creditsPerHourSaved: hoursSaved > TIE_EPS && upgradeCostTotal > 0 ? upgradeCostTotal / hoursSaved : null,
    binding: plan.binding, ready: plan.ready,
    criticalGroup: running.filter(b => b.critical).map(b => b.name),
  };
}

// Greedy spend of `budget` credits on levels: the chain time only drops when
// EVERY building tied at the top gets faster, so each step lifts the whole
// critical group by one level. Stops when the next group step is
// unaffordable, when a member of the group sits at its floor (that building
// can go no faster, so the chain cannot either), or when nothing runs.
// `startLevels` seeds the walk (the emulator's current scenario) so the
// budget is spent on top of what is already set. Speeds are left as given.
function spendOnChain(chain, demands, stocks, opts, budget, startLevels, speeds) {
  opts = opts || {};
  const levels = clampScenarioLevels(chain, startLevels);
  const floorOf = {};
  for (const b of chain.list) floorOf[b.name] = floorLevel(b.timer);
  const speedOpt = { byBuilding: speeds || {} };
  const run = () => planCore(chain, demands, stocks, { ...opts, levelOverrides: levels, speed: speedOpt });
  let spent = 0, steps = 0;
  let last = run();
  const hoursBefore = last.hoursPipelined;
  const b = Number(budget);
  if (isFinite(b) && b > 0) {
    for (;;) {
      const running = last.buildings.filter(x => x.unitsToRun > 0);
      const maxHours = running.reduce((m, x) => Math.max(m, x.hours), 0);
      const group = running.filter(x => x.hours >= maxHours - TIE_EPS).map(x => x.name);
      if (!group.length) break;
      if (group.some(n => levels[n] >= floorOf[n])) break;
      const cost = group.reduce((s, n) => s + levelCost(levels[n] + 1), 0);
      if (spent + cost > b) break;
      for (const n of group) levels[n] += 1;
      spent += cost;
      steps++;
      last = run();
      if (steps > 20000) break;
    }
  }
  return { levels, spent, steps, hoursBefore, hoursAfter: last.hoursPipelined };
}

const LabMath = {
  SPEED_INPUT_MULT, LEVEL_COST_BASE, TIMER_FLOOR, TIMER_STEP, CLAIM_COOLDOWN_MIN,
  normName, buildChain, expand, stageOf, stocksAfterBundle,
  timerAt, levelCost, levelsToFloor, costToFloor, floorLevel, upgradeCost, levelsAffordable,
  planCore, planTarget,
  stripIntermediates, clampScenarioLevels, emulateProduction, spendOnChain,
};
if (typeof module !== "undefined" && module.exports) module.exports = LabMath;
if (typeof window !== "undefined") window.LabMath = LabMath;
})();
