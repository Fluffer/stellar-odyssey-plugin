// Alert schedule for the engine cooldown. Pure functions, no DOM, no Node
// APIs: this file is loaded by the Node host (tests) AND its source text is
// embedded into the script injected into the game page, so keep it ES2017
// and free of require/import.
//
// Timeline (defaults: lead 10 s, step 5 s, after 30 s):
//   stage 0  at T-10 s   heads-up: the softest alert, once
//   stage 1  at T+5 s    the engine has been ready for 5 s
//   stage 2  at T+10 s   louder
//   ...
//   stage N  at T+after  last reminder; nothing more until the next jump
//
// The escalation counts from the moment the cooldown reaches 0, not from the
// heads-up: stage k (k >= 1) fires k*step seconds after ready.
//
// A stage fires once per cooldown cycle. If ticks were missed (page busy,
// host reconnecting) only the latest due stage fires - no catch-up bursts.

function normalizeConfig(cfg) {
  var c = cfg || {};
  var leadMs = Number.isFinite(c.leadMs) ? Math.max(0, c.leadMs) : 10000;
  var stepMs = Number.isFinite(c.stepMs) && c.stepMs > 0 ? c.stepMs : 5000;
  var afterMs = Number.isFinite(c.afterMs) ? Math.max(0, c.afterMs) : 30000;
  return { leadMs: leadMs, stepMs: stepMs, afterMs: afterMs };
}

// Highest stage index for a config: the heads-up plus one reminder per step
// that fits into the after-ready window.
function maxStage(cfg) {
  var c = normalizeConfig(cfg);
  return Math.floor(c.afterMs / c.stepMs);
}

// Stage due at `remainingMs` (engineCooldown - now; positive while cooling),
// or -1 when the alert window has not opened yet.
function stageAt(remainingMs, cfg) {
  var c = normalizeConfig(cfg);
  if (remainingMs > c.leadMs) return -1;
  if (remainingMs > -c.stepMs) return 0;
  return Math.min(Math.floor(-remainingMs / c.stepMs), maxStage(c));
}

// Two readings closer than this are the same cooldown cycle (server resync
// jitter), not a new jump.
var SAME_CYCLE_TOLERANCE_MS = 2000;

// Tracks one cooldown cycle at a time and says which stage to fire on each
// tick. Usage: t = createTracker(cfg); t.update(engineCooldownMs, nowMs) ->
// { fire: stage|null, remainingMs, newCycle }.
function createTracker(cfg) {
  var c = normalizeConfig(cfg);
  var state = { cycleEnd: null, lastStage: -1 };

  function update(engineCooldown, now) {
    if (typeof engineCooldown !== "number" || !(engineCooldown > 0)) {
      return { fire: null, remainingMs: null, newCycle: false };
    }
    var remaining = engineCooldown - now;
    var newCycle = false;
    if (state.cycleEnd === null || Math.abs(engineCooldown - state.cycleEnd) > SAME_CYCLE_TOLERANCE_MS) {
      newCycle = true;
      state.cycleEnd = engineCooldown;
      // Joining a cycle whose engine is already ready (plugin started late,
      // or the game still shows the previous jump's timer) is not news to
      // the player: consume it silently.
      state.lastStage = remaining <= 0 ? maxStage(c) : -1;
    } else {
      state.cycleEnd = engineCooldown;
    }
    var stage = stageAt(remaining, c);
    var fire = null;
    if (stage > state.lastStage) {
      state.lastStage = stage;
      fire = stage;
    }
    return { fire: fire, remainingMs: remaining, newCycle: newCycle };
  }

  return { update: update, config: c, _state: state };
}

// Sound intensity for a stage: more beeps, higher, louder, longer.
function intensityFor(stage, volume) {
  var v = typeof volume === "number" ? Math.max(0, Math.min(1, volume)) : 0.5;
  var s = Math.max(0, stage);
  return {
    beeps: Math.min(1 + s, 6),
    freqHz: 620 + s * 90,
    gain: Math.min(0.12 + s * 0.08, 0.6) * v,
    beepSec: 0.12 + Math.min(s, 5) * 0.02,
    gapSec: 0.09,
    // From the "ready" stage on, use a harsher waveform so it cuts through.
    wave: s >= 2 ? "square" : "triangle",
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeConfig, maxStage, stageAt, createTracker, intensityFor, SAME_CYCLE_TOLERANCE_MS };
}
