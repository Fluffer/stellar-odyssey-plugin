// Chrome DevTools Protocol client + game discovery.
//
// Taken from the advisor (../advisor/lib/cdp.js) so the plugin is
// self-contained. Discovery enumerates every listening TCP port with its
// owning process, tries the most game-like candidates first and confirms a
// candidate by asking the page whether it exposes the game's Pinia stores.

const http = require("http");
const { execSync } = require("child_process");

class CDP {
  constructor(url) {
    this.url = url;
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.onclose = null;
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    this.ws.onclose = () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error("CDP closed"));
      }
      this.pending.clear();
      if (this.onclose) this.onclose();
    };
  }
  open() {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("CDP connect timeout")), 8000);
      this.ws.onopen = () => { clearTimeout(timer); res(); };
      this.ws.onerror = () => { clearTimeout(timer); rej(new Error("WS error")); };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

// Evaluate an expression in the page. Returns { value } or { error }.
async function evalInPage(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    includeCommandLineAPI: true,
    timeout: 8000,
  });
  if (res.exceptionDetails) {
    const ex = res.exceptionDetails;
    return { error: (ex.exception && ex.exception.description) || ex.text || "exception" };
  }
  return { value: res.result.value };
}

// One PowerShell round-trip: every listening TCP port joined to its owning
// process. Lines are "port|pid|name|hasWindow|path".
const PS_LISTENERS =
  'powershell -NoProfile -Command "' +
  "$c=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue; " +
  "$m=@{}; foreach($p in Get-Process){ $m[[int]$p.Id]=$p }; " +
  "foreach($x in $c){ $p=$m[[int]$x.OwningProcess]; if($p){ " +
  "$pa=''; try{ $pa=$p.Path }catch{}; $w=0; if($p.MainWindowTitle){ $w=1 }; " +
  "Write-Output ('{0}|{1}|{2}|{3}|{4}' -f $x.LocalPort,$p.Id,$p.ProcessName,$w,$pa) } }" +
  '"';

function listListeners() {
  let out = "";
  try {
    out = execSync(PS_LISTENERS, { encoding: "utf8", timeout: 15000 });
  } catch (_) { return []; }
  const seen = new Set();
  const rows = [];
  for (const raw of out.split(/\r?\n/)) {
    const parts = raw.trim().split("|");
    if (parts.length < 5) continue;
    const port = parseInt(parts[0], 10);
    if (!port || seen.has(port)) continue;
    seen.add(port);
    rows.push({
      port,
      pid: parts[1],
      name: parts[2] || "",
      hasWindow: parts[3] === "1",
      path: parts.slice(4).join("|"),
    });
  }
  return rows;
}

// Lower tier == more likely to be the game. Tier 0 (exact process name) is
// trusted without a page check; every other tier has to prove itself.
function tierOf(row) {
  if (/^stellar odyssey$/i.test(row.name)) return 0;
  if (/stellar[ _-]*odyssey/i.test(row.path) || /stellar[ _-]*odyssey/i.test(row.name)) return 1;
  if (/[\/]steamapps[\/]/i.test(row.path)) return 2;
  if (row.hasWindow && /\.exe$/i.test(row.path)) return 3;
  return -1;
}

async function pageIsGame(wsUrl) {
  let cdp = null;
  try {
    cdp = new CDP(wsUrl);
    await cdp.open();
    const r = await evalInPage(cdp, "(()=>{try{" +
      "const el=[...document.querySelectorAll('*')].find(e=>e.__vue_app__);" +
      "if(!el)return false;" +
      "const pinia=el.__vue_app__.config.globalProperties.$pinia;if(!pinia)return false;" +
      "const ids=[...pinia._s.keys()];" +
      "return ids.includes('ExploreStore')&&ids.includes('ShipStore');" +
      "}catch(e){return false}})()");
    return r.value === true;
  } catch (_) {
    return false;
  } finally {
    if (cdp) cdp.close();
  }
}

// Returns { url, reason }. url is null on failure; reason names the stage.
async function discoverGame() {
  const rows = listListeners();
  if (!rows.length) {
    return { url: null, reason: "could not enumerate listening ports (PowerShell/Get-NetTCPConnection blocked?)" };
  }
  const candidates = rows
    .map(r => ({ ...r, tier: tierOf(r) }))
    .filter(r => r.tier >= 0)
    .sort((a, b) => a.tier - b.tier || a.port - b.port)
    .slice(0, 32);
  if (!candidates.length) {
    return { url: null, reason: "no windowed application is listening on a TCP port (is the game running?)" };
  }
  let sawCdp = false;
  for (const c of candidates) {
    const targets = await fetchJson(`http://127.0.0.1:${c.port}/json/list`);
    if (!Array.isArray(targets)) continue;
    sawCdp = true;
    for (const page of targets.filter(t => t.type === "page" && t.webSocketDebuggerUrl)) {
      if (c.tier === 0) return { url: page.webSocketDebuggerUrl, reason: null };
      if (await pageIsGame(page.webSocketDebuggerUrl)) return { url: page.webSocketDebuggerUrl, reason: null };
    }
  }
  return {
    url: null,
    reason: sawCdp
      ? "a debug port is open but no page on it is the game (logged in and past the loading screen?)"
      : "no debug port found (the game opens one on its own - is it running? if it is, pin a port with %command% --remote-debugging-port=8788 in the Steam launch options)",
  };
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

module.exports = { CDP, evalInPage, discoverGame, listListeners, tierOf, pageIsGame, fetchJson };
