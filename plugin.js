#!/usr/bin/env node
// Stellar Odyssey engine-cooldown alert plugin - host process.
//
// Finds the running game, installs the in-page watcher (lib/injected.js) over
// the DevTools protocol, then keeps a connection open to print what the
// watcher does and to re-install it after a page reload. The tones play from
// the game itself; this process is only the installer and the log.

const { CDP, evalInPage, discoverGame } = require("./lib/cdp");
const { normalizeConfig, maxStage, intensityFor } = require("./lib/schedule");
const inj = require("./lib/injected");
const { spawn } = require("child_process");

const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 22 || typeof WebSocket === "undefined") {
  console.error("Node.js 22 or newer is required (built-in WebSocket). Found " + process.version + ".");
  process.exit(1);
}

// --- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  const o = { lead: 10, step: 5, after: 30, volume: 0.5, poll: 250, hostBeep: true, button: true, galaxy: true, pages: true, nodeMin: 90, cmd: "run" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--lead") o.lead = Number(next());
    else if (a === "--step") o.step = Number(next());
    else if (a === "--after") o.after = Number(next());
    else if (a === "--volume") o.volume = Number(next());
    else if (a === "--poll") o.poll = Number(next());
    else if (a === "--no-host-beep") o.hostBeep = false;
    else if (a === "--no-button") o.button = false;
    else if (a === "--no-galaxy") o.galaxy = false;
    else if (a === "--no-pages") o.pages = false;
    else if (a === "--node-min") o.nodeMin = Number(next());
    else if (a === "--on") o.cmd = "on";
    else if (a === "--off") o.cmd = "off";
    else if (a === "--test-sound") o.cmd = "test-sound";
    else if (a === "--stop") o.cmd = "stop";
    else if (a === "--status") o.cmd = "status";
    else if (a === "--help" || a === "-h") o.cmd = "help";
    else { console.error("unknown option: " + a); o.cmd = "help"; }
  }
  return o;
}

const HELP = [
  "Stellar Odyssey engine-cooldown alert",
  "",
  "  node plugin.js [options]       install the alert in the running game and keep watching",
  "  node plugin.js --test-sound    play every alert stage once (softest to loudest), then exit",
  "  node plugin.js --status        show what is installed in the game and the current countdown",
  "  node plugin.js --on | --off    switch the alert on/off (same as the in-game button)",
  "  node plugin.js --stop          remove the alert from the game",
  "",
  "Options (seconds unless noted):",
  "  --lead N        heads-up this long before the engine is ready           (default 10)",
  "  --step N        after ready, escalate every N seconds                    (default 5)",
  "  --after N       keep escalating for N seconds after ready; 0 = heads-up only (default 30)",
  "  --volume V      0..1                                                    (default 0.5)",
  "  --poll MS       how often the in-game watcher checks the timer, in ms   (default 250)",
  "  --no-button     do not draw the on/off button in the game",
  "  --no-galaxy     no galaxy-map overlay (hover tag, nearest unexplored, session stats)",
  "  --node-min Q    mark systems with a known gathering node of at least Q percent (default 90)",
  "  --no-pages      no pets-page and laboratory-page overlays",
  "  --no-host-beep  no console-beep fallback when in-game audio is unavailable",
].join("\n");

const args = parseArgs(process.argv.slice(2));
if (args.cmd === "help") { console.log(HELP); process.exit(0); }
for (const k of ["lead", "step", "after", "volume", "poll", "nodeMin"]) {
  if (!Number.isFinite(args[k]) || args[k] < 0) { console.error("--" + k + " must be a non-negative number"); process.exit(1); }
}
if (args.step === 0) { console.error("--step must be > 0"); process.exit(1); }

const cfg = Object.assign(normalizeConfig({
  leadMs: args.lead * 1000, stepMs: args.step * 1000, afterMs: args.after * 1000,
}), { volume: Math.min(1, args.volume), pollMs: Math.max(50, args.poll), button: args.button, galaxy: args.galaxy, pages: args.pages, nodeMinQuality: args.nodeMin });

// --- output ---------------------------------------------------------------
function hhmmss(ms) {
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}
function fmtRemaining(ms) {
  if (ms === null || ms === undefined) return "?";
  const s = Math.round(ms / 1000);
  return s >= 0 ? "T-" + s + "s" : "T+" + (-s) + "s";
}
function say(msg) { console.log("[" + hhmmss(Date.now()) + "] " + msg); }

function describeStage(stage) {
  const it = intensityFor(stage, cfg.volume);
  const label = stage === 0 ? (cfg.leadMs / 1000) + "s before ready" : (stage * cfg.stepMs / 1000) + "s after ready";
  return "stage " + stage + " (" + label + "): " + it.beeps + " beep" + (it.beeps > 1 ? "s" : "") + " @ " + Math.round(it.freqHz) + " Hz";
}

// Console beep through PowerShell when the page could not play (audio context
// suspended, e.g. before the game's first click after a reload).
function hostBeep(stage) {
  if (!args.hostBeep) return;
  const it = intensityFor(stage, 1);
  const script = Array.from({ length: it.beeps }, (_, i) =>
    "[console]::beep(" + Math.round(it.freqHz * (1 + 0.05 * i)) + "," + Math.round(it.beepSec * 1000) + ")").join("; ");
  try {
    spawn("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore", windowsHide: true }).on("error", () => {});
  } catch (_) {}
}

function printEvent(ev) {
  if (ev.type === "cycle") {
    if (ev.silent) say("engine already ready (timer from " + hhmmss(ev.readyAt) + "); waiting for the next jump");
    else say("cooldown running: ready in " + Math.round(ev.remainingMs / 1000) + "s at " + hhmmss(ev.readyAt));
  } else if (ev.type === "alert" || ev.type === "demo") {
    const a = ev.audio || {};
    const tag = ev.type === "demo" ? "demo" : fmtRemaining(ev.remainingMs);
    if (ev.muted) say(tag + "  " + describeStage(ev.stage) + " - alert is OFF, not played");
    else if (a.ok) say(tag + "  " + describeStage(ev.stage));
    else {
      say(tag + "  " + describeStage(ev.stage) + " - in-game audio unavailable (" + (a.error || a.state) + "); " + (args.hostBeep ? "console beep instead" : "no fallback"));
      hostBeep(ev.stage);
    }
  } else if (ev.type === "installed") {
    say("installed in game (v" + ev.version + "); heads-up " + (cfg.leadMs / 1000) + "s before ready, then every " + (cfg.stepMs / 1000) + "s for " + (cfg.afterMs / 1000) + "s after ready (" + (maxStage(cfg) + 1) + " stages), volume " + cfg.volume + "; alert is " + (ev.enabled ? "ON" : "OFF"));
  } else if (ev.type === "toggle") {
    say("alert switched " + (ev.enabled ? "ON" : "OFF") + (ev.source === "button" ? " (in-game button)" : ""));
  } else if (ev.type === "error") {
    say("in-game error: " + ev.error);
  }
}

// --- connection -----------------------------------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function connect() {
  let lastReason = null;
  for (;;) {
    const { url, reason } = await discoverGame();
    if (url) {
      const cdp = new CDP(url);
      try {
        await cdp.open();
        await cdp.send("Runtime.enable");
        return cdp;
      } catch (e) {
        cdp.close();
        say("connect failed: " + e.message + "; retrying");
      }
    } else if (reason !== lastReason) {
      say("game not found: " + reason + "; retrying every 5s");
      lastReason = reason;
    }
    await sleep(5000);
  }
}

async function install(cdp) {
  const r = await evalInPage(cdp, inj.buildInstallScript(cfg));
  if (r.error) throw new Error("install failed: " + r.error);
  return JSON.parse(r.value);
}

async function poll(cdp) {
  const r = await evalInPage(cdp, inj.POLL);
  if (r.error) throw new Error(r.error);
  return r.value ? JSON.parse(r.value) : null;
}

async function runWatch() {
  say("looking for the game...");
  for (;;) {
    const cdp = await connect();
    let closed = false;
    cdp.onclose = () => { closed = true; };
    say("connected to the game");
    let lastStatusLine = 0;
    try {
      await install(cdp);
      while (!closed) {
        const p = await poll(cdp);
        if (p === null) {
          say("watcher missing (page reloaded?); re-installing");
          await install(cdp);
          continue;
        }
        for (const ev of p.events) {
          printEvent(ev);
          if (ev.type === "cycle") lastStatusLine = Date.now();
        }
        const st = p.status;
        const now = Date.now();
        if (st.loaded && st.remainingMs !== null && now - lastStatusLine >= 60000) {
          lastStatusLine = now;
          const r = st.remainingMs;
          if (r > cfg.leadMs) say("ready in " + Math.round(r / 1000) + "s" + (st.travelling ? " (travelling)" : ""));
        }
        await sleep(1000);
      }
    } catch (e) {
      say("connection lost: " + e.message);
    }
    cdp.close();
    say("reconnecting in 3s (the alert keeps running inside the game meanwhile)");
    await sleep(3000);
  }
}

async function once(fn) {
  const { url, reason } = await discoverGame();
  if (!url) { console.error("game not found: " + reason); process.exit(2); }
  const cdp = new CDP(url);
  await cdp.open();
  await cdp.send("Runtime.enable");
  try { await fn(cdp); } finally { cdp.close(); }
}

async function runTestSound() {
  await once(async (cdp) => {
    await install(cdp);
    const r = await evalInPage(cdp, inj.DEMO);
    if (r.error) throw new Error(r.error);
    const d = JSON.parse(r.value);
    say("playing " + d.stages + " stages, one every 1.5s:");
    const until = Date.now() + d.durationMs + 1000;
    while (Date.now() < until) {
      const p = await poll(cdp);
      if (p) for (const ev of p.events) if (ev.type !== "installed" && ev.type !== "cycle") printEvent(ev);
      await sleep(500);
    }
    say("done; the alert stays installed in the game (run without --test-sound to keep watching, --stop to remove)");
  });
}

async function runStatus() {
  await once(async (cdp) => {
    const r = await evalInPage(cdp, inj.STATUS);
    if (r.error) throw new Error(r.error);
    const s = JSON.parse(r.value);
    if (!s.installed) { console.log("not installed in the game"); return; }
    const st = s.status;
    console.log("installed v" + s.version + "; alert is " + (st.enabled ? "ON" : "OFF") + "; heads-up " + (s.cfg.leadMs / 1000) + "s before ready, then every " + (s.cfg.stepMs / 1000) + "s for " + (s.cfg.afterMs / 1000) + "s after ready, volume " + s.cfg.volume);
    if (!st.loaded) console.log("engine timer not loaded yet");
    else console.log("engine " + (st.remainingMs > 0 ? "ready in " + Math.round(st.remainingMs / 1000) + "s" : "ready") + "; ready at " + hhmmss(st.cycleEnd) + "; last stage fired: " + st.stage + (st.travelling ? "; travelling" : ""));
  });
}

async function runStop() {
  await once(async (cdp) => {
    const r = await evalInPage(cdp, inj.STOP);
    if (r.error) throw new Error(r.error);
    const s = JSON.parse(r.value);
    console.log(s.stopped ? "removed from the game" : "nothing to stop: " + s.reason);
  });
}

function runToggle(on) {
  return once(async (cdp) => {
    const r = await evalInPage(cdp, inj.setEnabledScript(on));
    if (r.error) throw new Error(r.error);
    const s = JSON.parse(r.value);
    if (s.error) { console.log("not installed in the game (run node plugin.js first)"); return; }
    console.log("alert is now " + (s.enabled ? "ON" : "OFF"));
  });
}

const main = {
  run: runWatch, "test-sound": runTestSound, status: runStatus, stop: runStop,
  on: () => runToggle(true), off: () => runToggle(false),
}[args.cmd];
main().catch((e) => { console.error(e.message || e); process.exit(1); });
