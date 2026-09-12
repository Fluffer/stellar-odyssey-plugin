// Locks the alert timeline: a heads-up before ready, then one escalating
// stage per step counted from the moment the cooldown reaches 0; each stage
// once per cycle, no catch-up bursts, and no alert for a cycle that was
// already over when the plugin joined it.

const test = require("node:test");
const assert = require("node:assert/strict");
const { stageAt, maxStage, createTracker, intensityFor, normalizeConfig } = require("../lib/schedule");

const CFG = { leadMs: 10000, stepMs: 5000, afterMs: 30000 };

test("defaults: lead 10 s, step 5 s, after 30 s", () => {
  assert.deepEqual(normalizeConfig({}), CFG);
  assert.deepEqual(normalizeConfig(undefined), CFG);
});

test("maxStage: heads-up plus one reminder per step after ready", () => {
  assert.equal(maxStage(CFG), 6);                                        // T-10, then T+5 .. T+30
  assert.equal(maxStage({ leadMs: 10000, stepMs: 5000, afterMs: 0 }), 0); // heads-up only
  assert.equal(maxStage({ leadMs: 10000, stepMs: 5000, afterMs: 12000 }), 2); // T+5, T+10
});

test("stageAt: heads-up at T-lead, escalation counted from ready", () => {
  assert.equal(stageAt(60000, CFG), -1);
  assert.equal(stageAt(10001, CFG), -1);
  assert.equal(stageAt(10000, CFG), 0);
  assert.equal(stageAt(5000, CFG), 0);   // no second alert before ready
  assert.equal(stageAt(0, CFG), 0);      // nothing new at ready itself
  assert.equal(stageAt(-4999, CFG), 0);
  assert.equal(stageAt(-5000, CFG), 1);  // 5 s after ready
  assert.equal(stageAt(-9999, CFG), 1);
  assert.equal(stageAt(-10000, CFG), 2);
  assert.equal(stageAt(-30000, CFG), 6);
  assert.equal(stageAt(-999999, CFG), 6); // capped
});

test("tracker: full cycle fires each stage exactly once, at the right moment", () => {
  const t = createTracker(CFG);
  const ready = 1000000;
  const fired = [];
  for (let now = ready - 300000; now <= ready + 60000; now += 250) {
    const r = t.update(ready, now);
    if (r.fire !== null) fired.push({ stage: r.fire, at: now - ready });
  }
  assert.deepEqual(fired.map(f => f.stage), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(fired.map(f => f.at), [-10000, 5000, 10000, 15000, 20000, 25000, 30000]);
});

test("tracker: after=0 gives the heads-up only", () => {
  const t = createTracker({ leadMs: 10000, stepMs: 5000, afterMs: 0 });
  const ready = 1000000;
  const fired = [];
  for (let now = ready - 20000; now <= ready + 120000; now += 250) {
    const r = t.update(ready, now);
    if (r.fire !== null) fired.push(r.fire);
  }
  assert.deepEqual(fired, [0]);
});

test("tracker: missed ticks fire only the latest due stage, no catch-up burst", () => {
  const t = createTracker(CFG);
  const ready = 1000000;
  assert.equal(t.update(ready, ready - 60000).fire, null);
  assert.equal(t.update(ready, ready + 7000).fire, 1);   // skipped the heads-up
  assert.equal(t.update(ready, ready + 8000).fire, null);
  assert.equal(t.update(ready, ready + 22000).fire, 4);  // skipped 2 and 3
});

test("tracker: joining a cycle whose engine is already ready stays silent", () => {
  const t = createTracker(CFG);
  const ready = 1000000;
  const r = t.update(ready, ready + 1000);
  assert.equal(r.newCycle, true);
  assert.equal(r.fire, null);
  for (let now = ready + 1000; now <= ready + 60000; now += 1000) {
    assert.equal(t.update(ready, now).fire, null);
  }
});

test("tracker: joining inside the heads-up window fires it at once", () => {
  const t = createTracker(CFG);
  const ready = 1000000;
  assert.equal(t.update(ready, ready - 4000).fire, 0);
});

test("tracker: a new jump starts a fresh cycle", () => {
  const t = createTracker(CFG);
  const ready1 = 1000000;
  assert.equal(t.update(ready1, ready1 - 10000).fire, 0);
  assert.equal(t.update(ready1, ready1 + 5000).fire, 1);
  // Player jumps: the game publishes a new ready time 300 s out.
  const ready2 = ready1 + 300000;
  const r = t.update(ready2, ready1 + 7000);
  assert.equal(r.newCycle, true);
  assert.equal(r.fire, null);
  assert.equal(t.update(ready2, ready2 - 10000).fire, 0);
  assert.equal(t.update(ready2, ready2).fire, null);
  assert.equal(t.update(ready2, ready2 + 5000).fire, 1);
});

test("tracker: sub-2s jitter in the ready time is the same cycle", () => {
  const t = createTracker(CFG);
  const ready = 1000000;
  assert.equal(t.update(ready, ready - 10000).fire, 0);
  const r = t.update(ready + 1500, ready - 9000);
  assert.equal(r.newCycle, false);
  assert.equal(r.fire, null);
  assert.equal(t.update(ready + 1500, ready + 1500 + 5000).fire, 1);
});

test("tracker: unusable readings fire nothing", () => {
  const t = createTracker(CFG);
  assert.equal(t.update(0, 5).fire, null);
  assert.equal(t.update(undefined, 5).fire, null);
  assert.equal(t.update(null, 5).fire, null);
  assert.equal(t.update(NaN, 5).fire, null);
});

test("intensity grows with the stage and is bounded", () => {
  let prev = intensityFor(0, 1);
  assert.equal(prev.beeps, 1);
  for (let s = 1; s <= 8; s++) {
    const it = intensityFor(s, 1);
    assert.ok(it.beeps >= prev.beeps);
    assert.ok(it.freqHz > prev.freqHz);
    assert.ok(it.gain >= prev.gain);
    assert.ok(it.beepSec >= prev.beepSec);
    prev = it;
  }
  assert.ok(prev.beeps <= 6);
  assert.ok(prev.gain <= 0.6);
  assert.equal(intensityFor(0, 1).wave, "triangle");
  assert.equal(intensityFor(2, 1).wave, "square");
  assert.equal(intensityFor(3, 0).gain, 0);            // volume 0 mutes
  assert.equal(intensityFor(3, 5).gain, intensityFor(3, 1).gain); // volume clamped to 1
});
