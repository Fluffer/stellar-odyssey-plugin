# Stellar Odyssey Plugin

A browser extension (and Steam-client injector) that adds information overlays to the
game **Stellar Odyssey**: an engine-cooldown sound alert, a galaxy-map overlay with
route planning, and panels on the pets, laboratory, battling, gathering, crafting,
voyager, player and tech pages. It only reads the game's state; it never sends anything
to the game server and never plays the game for you.

## Quick start in Microsoft Edge

The game runs in the browser at **https://steam.stellarodyssey.app/** (the same game as
the Steam client, on the Steam realm). The extension loads itself every time you open
that page.

1. **Get the files.** Download this repository (green *Code* button → *Download ZIP*)
   and unzip it somewhere permanent, for example `C:\Games\stellar-odyssey-plugin`.
   Edge loads the extension from that folder, so do not delete or move it afterwards.
2. **Open the extensions page.** In Edge go to `edge://extensions`.
3. **Turn on Developer mode.** The switch is in the left column (or bottom-left).
4. **Load the extension.** Click **Load unpacked** and choose the `extension` folder
   inside the unzipped files (the one containing `manifest.json`).
5. **Play.** Open https://steam.stellarodyssey.app/ and log in. Once the game has loaded
   you will see a small pill at the bottom right: `🔔 Engine alert ON · ready in 4:52`.

That is all. Nothing runs outside the browser.

### What you get

- **Engine alert.** A sound 10 seconds before the engine cooldown reaches 0, then a
  louder one every 5 seconds once the engine is ready, until you jump. Click the pill
  to switch it off or on; drag it to move it. The pill turns amber when fuel is low.
- **Galaxy map.** Hover any cell for distance and fuel cost; the nearest unexplored
  cell is ringed; right-click (or Shift+click) any cell to plan a route with numbered
  hops, total fuel and time; rings on your own and your squadron's discoveries; dots for
  habitable, portal, dungeon and starter systems; an orange diamond on systems with a
  gathering node at 90% or better that you have seen; your bookmarks and squadron
  stations with distances; session statistics; a trail of where you have been.
- **Pets.** Time to the next level on every pet card and whether the next XP boost is
  worth buying; pet-food days left.
- **Laboratory.** Idle queue slots, claim-cooldown readiness, and the warp-capsule
  chain plan: what binds, what runs, how long.
- **Battling, gathering, crafting, voyager, player, tech.** A panel on each page with
  countdowns, last results, running rates, what you can craft and what blocks it, ship
  item levels behind your skills, and how far each tech skill is from max.

Every panel can be dragged; positions and switches are remembered in the browser.
Details of each feature are further down in this file.

### Language: English or 简体中文

A small button sits to the left of the alert pill: **中文** switches every overlay to
Simplified Chinese, **EN** switches back. The choice is remembered. A browser whose
language is Chinese starts in Chinese. The game's own terms (跃迁舱, 宇宙尘, 量子核心,
信用点, 机器人, 克隆体, 中队 ...) follow the game's zh-CN wording, the same choice the
advisor makes. Numbers, coordinates, compass directions and system, pet, skill and
material names stay as the game shows them.

To add another language, add a catalogue object to `lib/i18n.js` next to `SO_ZH` and
extend `langs` in `createI18n`; the test suite checks that every rendered string has a
translation and that no entry is stale.

### Updating

Download the new ZIP, replace the files in the same folder, then on `edge://extensions`
click the **reload** icon on the extension's card and reload the game page.

### Changing the alert timing or volume

Edit the first line of `extension/content.js` (the `DEFAULTS` values: `leadMs`,
`stepMs`, `afterMs` in milliseconds, `volume` 0..1) and reload the extension. Or, with
Node.js installed, run `node build-extension.js --lead 15 --volume 0.8` to rebuild it.

### Troubleshooting

- *No pill appears*: make sure the extension card on `edge://extensions` is switched on
  and shows no error, then reload the game page. The pill only appears once the game
  has loaded past the login screen.
- *No sound*: browsers only allow sound after you have clicked somewhere in the page.
  Click anywhere in the game once.
- *A panel is in the way*: drag it. Each panel remembers where you put it.
- *It also works in Google Chrome* the same way, at `chrome://extensions`.

---

The rest of this file describes each feature in detail and the Steam-client variant.

## Features in detail

The two core features:

- an **engine-cooldown alert**: a sound 10 seconds before the engine cooldown reaches
  0, then, once the engine is ready, a louder reminder every 5 seconds until you jump,
  with a draggable on/off button in the game window;
- a **galaxy-map overlay**: a hover tag with distance and fuel cost for any cell, the
  nearest unexplored cell marked on the map, rings on your own discoveries, dots for
  points of interest, the active rune's expiry, your bookmarks and squadron stations
  at a distance, a low-fuel warning, and session statistics (jumps, new systems, dust
  and XP per hour).

It comes in two forms that share the same code:

| Where you play | What to use | Starts by itself? |
| --- | --- | --- |
| Web version at https://steam.stellarodyssey.app/ in Edge or Chrome | the **browser extension** in `extension/` | yes, loads with the page |
| Steam client | `node plugin.js` (injects into the running game) | no, run it after starting the game |

Nothing is sent to the game server, no game file is touched, and no command is issued to
the game: it reads one timer, makes noise, and adds one button.

## What you hear

Default timeline (lead 10 s, step 5 s, after 30 s):

| When | Stage | Sound |
| --- | --- | --- |
| 10 s before ready | 0 | 1 soft beep, 620 Hz (heads-up) |
| 5 s after ready | 1 | 2 beeps, higher and louder |
| 10 s after ready | 2 | 3-beep rising burst, square wave |
| 15 s after ready | 3 | 4 beeps, higher and louder |
| 20, 25, 30 s after ready | 4..6 | up to 6 beeps, rising pitch and loudness |

The escalation counts from the moment the cooldown reaches 0, not from the heads-up.
Each stage fires once per cooldown. After the last stage the plugin goes quiet until
you jump again, which starts the next cycle. With `after` set to 0 you get the heads-up
only.

If the plugin starts while the engine is already ready it stays silent for that cycle:
you already know.

## The in-game button

A small pill reads `🔔 Engine alert ON · ready in 3:39` (or `engine ready`) and counts
down. **Click** it to switch the alert off (`🔕 Engine alert OFF`) and again to switch it
on. **Drag** it to move it anywhere. Both the on/off choice and the position are stored
in the game page's localStorage, so they survive restarts of the game, the browser and
the plugin.

By default the button sits at the right edge just above the chat footer, and above the
minimap on the galaxy page. If it is still in the way somewhere, drag it.

While off, the watcher keeps tracking cycles silently, so switching it back on never
triggers a burst of missed alerts.

## The galaxy-map overlay

On the galaxy page only. Everything comes from data the map page already holds; the
overlay never calls the game's API.

- **Hover tag.** Hold the mouse over any cell: system name, coordinates, star type and
  flags (habitable, portal, dungeon, starter), or "Unexplored"; then distance in light
  years and direction, the fuel that jump costs, the fuel left after it, how many jumps
  of that size the tank holds, and a warning when the jump is over 100 ly (the game asks
  for confirmation there) or unaffordable. Fuel cost is distance × (1 − fuel efficiency
  bonus), the same formula the bots use.
- **Nearest unexplored.** A dashed yellow ring marks the closest cell the game shows as
  "?" among the cells on screen or loaded around you. The panel lists it with cells,
  direction, light years and fuel, how many unexplored cells are in that area, and a
  **center** link that pans the map to it (it sets the game's own camera position,
  nothing else).
- **Session.** Counted from the game's per-jump reward object: elapsed time, jumps, new
  systems discovered, cosmic dust received (net, after squadron tax) with dust per hour
  and per jump, and exploring XP. Stored in the page's localStorage so it survives
  reloads; **reset** starts a fresh session. A jump that happened before the session
  started is not counted.
- **Fuel.** Current fuel, the average fuel one of your jumps costs this session (before
  any jump: the nearest unexplored cell's cost), and how many such jumps are left. Below
  two jumps the line turns amber and the alert button turns amber on every page.
- **Discoveries.** A thin green ring around every system you discovered yourself and a
  light-blue ring around systems discovered by a squadron mate (from the member list
  in the game's user state). The hover tag says "discovered by you" or names the
  discoverer, with "(squadron)" where it applies.
- **Points of interest.** Small dots next to the planet: teal habitable, purple portal,
  red dungeon, white starter. The hover tag lists them by name.
- **Rune.** When the system you are in has an active rune: its name, the body it is on,
  and a countdown to its expiry.
- **Rich gathering nodes and system bodies.** An orange diamond at the planet's top-left
  marks a system with a known gathering node at 90% or better (`--node-min` changes
  the threshold), and the panel names the nearest known one with a center link. The
  hover tag lists the system's bodies, for example "Belt (icy 93%), Belt (icy 1%), Gas
  Planet", with rich nodes highlighted and when the data was seen.
  Limitation: the map and the game's own bounding-box API only carry a *count* of
  gathering bodies per system. Body details and node quality are known for the system
  you are in, for your bookmarks, and for every system you have been in while the
  plugin was running; the plugin remembers those in the page's localStorage (up to
  5,000 systems). For everything else the tag says "N gathering bodies (details
  unknown until visited)". Node quality can change over time, so an old reading may
  be stale; the tag shows its age.
- **Route planner.** **Right-click** any cell on the map, or **Shift+click** it, or click
  a **route** link next to a bookmark, station, rich node or the nearest unexplored
  cell, and the overlay draws the hops to get there: a straight line cut into jumps no
  longer than 99 ly, so none of them triggers the game's confirmation, with numbered
  waypoints. The panel shows jumps, light years, fuel, fuel left afterwards (red if it
  does not reach) and an estimated time from your cooldown length, which is learned
  from the timers the game publishes. Right-click the destination again, or click
  **clear**, to drop it. `maxHopLy` in the config changes the hop limit. While the
  game's own "new system discovered" card is open its backdrop covers the map, so close
  that first.
- **Where to head.** The nearest-unexplored line also says which compass direction
  holds the most unexplored cells in the loaded area, for example "most unexplored:
  SW (18)".
- **Session trail.** A faint cyan line through every system you visited this session,
  with a dot per stop, so gaps and backtracking in a sweep are visible. Resetting the
  session clears it.
- **Bookmarks** and **squadron stations.** Two collapsible lists, each entry with
  coordinates, cells and direction, light years, fuel cost and a **center** link. A
  station also shows whether you are inside its reach (100 ly plus 10 ly per station
  level, the game's own constants). Click the list header to expand or collapse.

The two mark types and the two lists can be switched on and off in the panel; the
choice is remembered. The panel is draggable like the alert button; by default it sits
just above it. `--no-galaxy` (host) or `node build-extension.js --no-galaxy` leaves the
overlay out.

How it reads the map: the galaxy is a Konva stage inside the game's GalaxyMapCanvas
component, and its Vue wrapper exposes the stage object. Cells sit at fixed world units
inside the map group (50 wide, 30 high, re-derived from a coordinate label at runtime),
so the overlay can convert between mouse position and cell and draw its marker on its
own Konva layer. Cells the game draws as "?" are exactly the cells missing from the
component's `systems` prop.

## The pets-page overlay

The game's pet cards show XP, food and XP per hour. The overlay adds a line to every
card, active slots and store alike, using the advisor's pet math (the game's exact
formulas, copied into `lib/pet-math.js`):

- **time to the next level** with the food cycle and auto-feed threshold modelled;
- **whether one more XP-boost level pays off**: hours saved, the cost per resource (the
  boost is paid in each of the 16 common resources), and a tick or cross for whether
  your scarcest resource covers it;
- for pets in the store: the XP per hour they would earn if equipped.

A small panel shows pet food in stock, the daily burn from your auto-feed thresholds
and how many days that lasts (amber under a week), which resource caps boost upgrades,
and the single best boost to buy now (largest hours saved among affordable, equipped
pets).

## The laboratory-page overlay

The game's queue statistics show progress and "ready to collect". The panel adds the
advisor's chain planner (`lib/lab-math.js`):

- **Queue health**: slots in use, idle slots (amber), and per running queue the units
  done, units collectable, whether the 10-minute claim cooldown is over or how long it
  has left, and when the queue finishes.
- **Plan** for N warp capsules on top of your stock (− / + links, remembered): which
  raw resource binds and by how much, what is short, the chain time both pipelined
  (claim and re-queue every 10 minutes) and sequential, the critical building, and
  what each building has to run.

## Panels on the other pages

Each is a draggable panel that appears only on its page and reads the game's state
without touching its layout:

- **Battling.** Current NPC and level, countdown to the next action and to the offline
  action expiry; the last fight (win or loss, credits and XP, clones alive and the
  lowest clone HP, the NPC's hit and dodge chance); and a running tally since a start
  time you can reset: fights, win rate, credits per hour, XP per hour, fights per hour.
  The tally counts fights as they happen; it cannot read the game's own statistics.
- **Gathering.** The body and node you are on with its quality, the same countdowns,
  the last haul with droids that came back, the advisor's droid survival model
  (expected droids back per action from 50% base dodge + maneuverability ÷ 2 + dodge
  mods, the maneuverability cap, and a note when a dodge mod has become worthless),
  and a tally with resources per hour and droids lost.
- **Crafting.** How many blueprints you could craft right now with what you hold, the
  materials that block the most blueprints with where they farm (NPC and body type
  from the advisor's drop table), and for the selected blueprint what is missing.
- **Voyager.** The fuel tank (amber under 20%), the jump limit, the real time per jump
  (the store's `timer` is a reduction off a 30-minute base, exactly as the page
  computes it), the reward bonus with your tech skill, and the planned expedition's
  jumps, distance and time, or the running one's pending jumps and ETA. Fuel per jump
  is charged by the server and the client holds no formula for it, so the panel never
  guesses a fuel cost.
- **Player.** Sits bottom-left by default, clear of the item cards. For each ship item:
  level, rarity, value against the craft-time value cap,
  its mods, how many levels behind the matching skill it is with the cap a recraft would
  reach, and a warning when a droid-dodge mod adds nothing because every droid is past
  the cap.
- **Tech.** Quantum cores in stock, cores to max every unlocked skill, the cheapest
  next levels, what your cores buy if spent cheapest-first, and the skills furthest
  from max. The advisor's battle-simulated ranking of the four combat skills is not
  here: it needs the simulator, which is too heavy to run in the page.

All page overlays only appear on their page. `cfg.pages = false` (extension) or
`--no-pages` (host) leaves them out. They are tested against a game state captured
live in `test/fixtures/game-state.json`.

## Browser extension (web version)

1. Open `edge://extensions` (or `chrome://extensions`), switch on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder of this project.
3. Open or reload https://steam.stellarodyssey.app/. The button appears once the game
   has loaded.

That is all; there is no process to start. The extension is a single content script
(`extension/content.js`) that runs in the game page. It logs what it does to the
browser's DevTools console with an `[EngineAlert]` prefix.

Browsers only allow sound after you have clicked somewhere in the page. You do that
anyway when you play, so in practice the first alert always sounds.

### Changing the timing or volume

Rebuild the content script with new defaults and reload the extension:

```
node build-extension.js --lead 15 --step 5 --after 60 --volume 0.8
```

Or override without rebuilding, from the game page's DevTools console, then reload the
page:

```js
localStorage.setItem("soEngineAlert.cfg", JSON.stringify({ leadMs: 15000, volume: 0.8 }))
```

Keys: `leadMs`, `stepMs`, `afterMs`, `volume` (0..1), `pollMs`, `button` (false hides
the button).

## Steam client (`plugin.js`)

The Steam build is an Electron app whose renderer is a Chromium page, and it opens a
DevTools port on every start. `plugin.js` finds that port, evaluates the same page
script in the game, and stays connected to print what it does and to re-install it
after a page reload.

Requirements: Windows (game discovery uses PowerShell), Node.js 22 or newer, no npm
dependencies, the game running and logged in.

```
node plugin.js
```

Output looks like:

```
[11:20:01] looking for the game...
[11:20:03] connected to the game
[11:20:03] installed in game (v1.2.0); heads-up 10s before ready, then every 5s for 30s after ready (7 stages), volume 0.5; alert is ON
[11:20:03] cooldown running: ready in 257s at 11:24:20
[11:24:10] T-10s  stage 0 (10s before ready): 1 beep @ 620 Hz
[11:24:25] T+5s  stage 1 (5s after ready): 2 beeps @ 710 Hz
[11:24:30] T+10s  stage 2 (10s after ready): 3 beeps @ 800 Hz
[11:24:33] cooldown running: ready in 300s at 11:29:33
```

The watcher lives in the game page, so it keeps running even if you close the host,
until the game is restarted. Use `--stop` to remove it explicitly.

Other commands:

```
node plugin.js --test-sound    play every stage once, softest to loudest, then exit
node plugin.js --status        installed? on or off? how long until the engine is ready
node plugin.js --on            switch the alert on (same as the in-game button)
node plugin.js --off           switch the alert off
node plugin.js --stop          remove the watcher and the button from the game
```

Options (seconds unless noted):

| Option | Default | Meaning |
| --- | --- | --- |
| `--lead N` | 10 | heads-up this long before ready |
| `--step N` | 5 | after ready, escalate every N seconds |
| `--after N` | 30 | keep escalating for N seconds after ready; 0 = heads-up only |
| `--volume V` | 0.5 | 0..1, applied on top of the per-stage loudness |
| `--poll MS` | 250 | how often the watcher reads the timer, milliseconds |
| `--no-button` | off | install without the in-game on/off button |
| `--no-host-beep` | off | disable the console-beep fallback (see below) |

Re-running `node plugin.js` with different options replaces the installed watcher.

If the game page cannot play (its audio context is suspended until the page has had a
click after a reload), the watcher still logs the alert and the host plays the same beep
pattern through the Windows console beep instead. `--no-host-beep` turns that off.

To start the host together with the game, a Steam launch-option wrapper
(`launch.cmd %command%`) can start it alongside the game without touching the game
folder. That wrapper is not part of this project yet.

### Why not inside the Steam client's own files

The client is one `app.asar` archive that Steam replaces on every update, so a patched
archive would be undone by the next patch and flagged by Steam's file verification. The
plugin therefore injects into the *running* game instead.

## How it reads the timer

`ExploreStore.engineCooldown` in the game's Pinia state is the epoch time in
milliseconds at which the engine becomes ready; the game's own `engineReady` is
`engineCooldownLoaded && engineCooldown < now`. The watcher reads that value every
`pollMs` and computes remaining = `engineCooldown - Date.now()`. The web version and the
Steam client are the same Vue app, so this works identically in both.

Two details from the bots project carry over:

- Right after a jump the value can read stale for about a second (it still shows the
  previous, already-expired timer). That timer is treated as an already-finished cycle
  and stays silent; the new value, when it arrives, starts the new cycle.
- While the ship is in flight the value already points past the arrival, so the
  countdown includes the travel time. That is what you want: it counts to the moment
  you can actually jump.

A new value more than 2 seconds away from the current one is a new cycle. Smaller
changes (server resync) update the deadline without re-firing stages. If ticks were
missed, only the latest due stage fires: no catch-up bursts.

## Files

| File | Purpose |
| --- | --- |
| `extension/manifest.json` | Browser extension manifest (Manifest V3, content script in the page's main world) |
| `extension/content.js` | Generated by `build-extension.js`; the whole alert bundled for the browser |
| `build-extension.js` | Builds `extension/content.js` from the shared modules with the given defaults |
| `plugin.js` | Steam-client host: discovery, install, log, reconnect; `--test-sound`, `--status`, `--on`, `--off`, `--stop` |
| `lib/page-core.js` | The alert as it runs inside the game page: timer polling, Web Audio tones, on/off button, the drag helper. Shared by both forms |
| `lib/page-galaxy.js` | The galaxy-map overlay: map access through the Konva stage, hover tag, nearest-unexplored marker, session stats. Shared by both forms |
| `lib/page-pets.js` | The pets-page overlay: per-card time-to-level and boost advice, pet-food panel |
| `lib/page-lab.js` | The laboratory-page overlay: queue health and the warp-capsule chain plan |
| `lib/page-more.js` | The battling, gathering, crafting, voyager, player and tech panels |
| `lib/i18n.js` | Overlay strings: English keys, Simplified Chinese catalogue, and the lookup runtime with the language switch |
| `test/i18n.test.js` | Every rendered string has a translation, no stale entries, placeholders match, the runtime switches and remembers |
| `test/more-pages.test.js`, `test/helpers/dom-stub.js` | Those six panels against the captured state; the shared DOM stand-in |
| `lib/pet-math.js`, `lib/lab-math.js` | The advisor's shared pet and laboratory math, copied from `../advisor/public/`; keep in sync |
| `test/pages.test.js`, `test/fixtures/game-state.json` | Pets and lab overlays run against a captured game state with a minimal DOM stand-in |
| `lib/schedule.js` | Pure alert timeline: stages, per-cycle tracker, intensity per stage |
| `lib/injected.js` | Wraps the shared page code for the DevTools path and provides the host's poll/toggle/stop expressions |
| `lib/cdp.js` | DevTools protocol client and game discovery (from the advisor) |
| `test/schedule.test.js` | Locks the timeline behaviour |

After editing `lib/page-core.js`, `lib/page-galaxy.js` or `lib/schedule.js`, run
`node build-extension.js` again and reload the extension; `plugin.js` picks the change
up on its next start.

## Tests

```
node --test
```

Uses only `node:test`, no dependencies.

## License

MIT, see `LICENSE`.

## Disclaimer

Unofficial fan tool, not affiliated with or endorsed by the developer of Stellar
Odyssey. It only reads the game's page state, plays sounds and draws its own panels;
use at your own risk.
