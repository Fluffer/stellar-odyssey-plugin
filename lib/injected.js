// Builds the script that plugin.js evaluates INSIDE the Steam client's page.
//
// The game is an Electron app, so its renderer is a Chromium page: the host
// (plugin.js) evaluates this script there over the DevTools protocol. The
// page-side behaviour itself lives in lib/page-core.js (shared with the
// browser extension); this file only wraps it with the schedule module and
// the configuration, and provides the small expressions the host uses to
// poll, toggle and stop it.

const fs = require("fs");
const path = require("path");

const PLUGIN_VERSION = "1.3.0";
const GLOBAL = "__soEngineAlert";
// localStorage key for the on/off choice; the game's profile keeps
// localStorage across restarts, so the toggle position survives.
const LS_ENABLED = "soEngineAlert.enabled";

const SCHEDULE_SRC = fs.readFileSync(path.join(__dirname, "schedule.js"), "utf8");
const CORE_SRC = fs.readFileSync(path.join(__dirname, "page-core.js"), "utf8");
const GALAXY_SRC = fs.readFileSync(path.join(__dirname, "page-galaxy.js"), "utf8");
const PETS_SRC = fs.readFileSync(path.join(__dirname, "page-pets.js"), "utf8");
const LAB_SRC = fs.readFileSync(path.join(__dirname, "page-lab.js"), "utf8");
const MORE_SRC = fs.readFileSync(path.join(__dirname, "page-more.js"), "utf8");
const I18N_SRC = fs.readFileSync(path.join(__dirname, "i18n.js"), "utf8");
const PET_MATH_SRC = fs.readFileSync(path.join(__dirname, "pet-math.js"), "utf8");
const LAB_MATH_SRC = fs.readFileSync(path.join(__dirname, "lab-math.js"), "utf8");

// The advisor's math files export through module.exports (Node) or a
// window global (browser). Wrapping each in a scope with a fake `module`
// captures the exports as a bundle-local variable without touching window.
function moduleShim(name, src) {
  return `var ${name} = (function () { var module = { exports: {} }; ${src}\n; return module.exports; })();`;
}
// Everything shared by the DevTools path and the extension build, in order.
function sharedSources() {
  return [
    I18N_SRC,
    moduleShim("PetMath", PET_MATH_SRC),
    moduleShim("LabMath", LAB_MATH_SRC),
    GALAXY_SRC, PETS_SRC, LAB_SRC, MORE_SRC, CORE_SRC,
  ].join("\n");
}

function pageConfig(cfg) {
  return {
    leadMs: cfg.leadMs, stepMs: cfg.stepMs, afterMs: cfg.afterMs,
    volume: cfg.volume, pollMs: cfg.pollMs,
    button: cfg.button !== false, console: !!cfg.console, galaxy: cfg.galaxy !== false,
    nodeMinQuality: Number.isFinite(cfg.nodeMinQuality) ? cfg.nodeMinQuality : 90,
    pages: cfg.pages !== false,
  };
}

function buildInstallScript(cfg) {
  return `(() => {
  const SCHED = (function () { const module = { exports: {} }; ${SCHEDULE_SRC}\n; return module.exports; })();
  ${sharedSources()}
  const api = installEngineAlert(SCHED, ${JSON.stringify(pageConfig(cfg))}, ${JSON.stringify(PLUGIN_VERSION)}, ${JSON.stringify(LS_ENABLED)});
  return JSON.stringify({ installed: true, version: api.version, enabled: api.status().enabled });
})()`;
}

// Expression: event log + status if the current version is installed, else null.
const POLL = `(() => {
  const p = window.${GLOBAL};
  if (!p || p.version !== ${JSON.stringify(PLUGIN_VERSION)}) return null;
  return JSON.stringify({ events: p.drain(), status: p.status() });
})()`;

const STATUS = `(() => {
  const p = window.${GLOBAL};
  return JSON.stringify(p ? { installed: true, version: p.version, cfg: p.cfg, status: p.status() } : { installed: false });
})()`;

const STOP = `(() => {
  const p = window.${GLOBAL};
  if (!p) return JSON.stringify({ stopped: false, reason: "not installed" });
  p.stop();
  return JSON.stringify({ stopped: true });
})()`;

const DEMO = `(() => {
  const p = window.${GLOBAL};
  if (!p) return JSON.stringify({ error: "not installed" });
  return JSON.stringify(p.demo());
})()`;

function setEnabledScript(on) {
  return `(() => {
    const p = window.${GLOBAL};
    if (!p) return JSON.stringify({ error: "not installed" });
    return JSON.stringify({ enabled: p.setEnabled(${on ? "true" : "false"}, "host") });
  })()`;
}

module.exports = {
  PLUGIN_VERSION, GLOBAL, LS_ENABLED, SCHEDULE_SRC, CORE_SRC, GALAXY_SRC, PETS_SRC, LAB_SRC, sharedSources, pageConfig,
  buildInstallScript, POLL, STATUS, STOP, DEMO, setEnabledScript,
};
