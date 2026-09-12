// The galaxy overlay's voyager summary and session recording, against a
// captured expedition (test/fixtures/game-state.json, "voyagerRunning").
// The game's Voyager page prints "Exploring XP gain" as
// floor((sum reward + sum taxed) / 20); the overlay applies that per waypoint.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { installDom, ctxFor, storesFor } = require("./helpers/dom-stub.js");
const { installGalaxyInfo } = require("../lib/page-galaxy.js");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "game-state.json"), "utf8"));

function galaxyWith(voyagerState) {
  installDom("#/galaxy");
  const fx = Object.assign({}, fixture, { voyager: voyagerState });
  const base = storesFor(fx);
  const ctx = ctxFor(fx, {
    getStoreById: base,
    getStore: () => base("ExploreStore"),
  });
  return { g: installGalaxyInfo(ctx), store: base("Voyager").$state };
}

test("voyager summary: reached waypoints, XP from gross dust / 20, ETA", () => {
  const { g } = galaxyWith(fixture.voyagerRunning);
  const s = g.voyager();
  assert.equal(s.total, 3);
  assert.equal(s.reached, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.dust, 30561 + 10187 + 30496 + 10165);   // gross, tax included
  assert.equal(s.net, 30561 + 30496);
  assert.equal(s.xp, Math.floor((30561 + 10187) / 20) + Math.floor((30496 + 10165) / 20)); // 2037 + 2033
  assert.equal(s.xp, 4070);
  assert.equal(s.perJumpXp, 2035);
  assert.equal(s.eta, 1789197084400);
});

test("voyager summary: nothing queued gives null", () => {
  const { g } = galaxyWith(fixture.voyager);
  assert.equal(g.voyager(), null);
});

test("session records each reached waypoint once, and picks up later ones", () => {
  const { g, store } = galaxyWith(fixture.voyagerRunning);
  g.trackVoyager();
  let voy = g.session().voy;
  assert.equal(voy.jumps, 2);
  assert.equal(voy.xp, 4070);
  assert.equal(voy.dust, 81409);
  assert.equal(voy.net, 61057);
  // same state again: nothing double-counted
  g.trackVoyager();
  assert.equal(g.session().voy.jumps, 2);
  // the third waypoint arrives
  store.queue[2] = Object.assign({}, store.queue[2], { status: "reached", cosmic_dust_reward: 30000, cosmic_dust_reward_taxed: 10000 });
  g.trackVoyager();
  voy = g.session().voy;
  assert.equal(voy.jumps, 3);
  assert.equal(voy.xp, 4070 + 2000);
  assert.deepEqual(voy.ids, ["W1", "W2", "W3"]);
  // a fresh expedition reusing coordinates but with new ids counts again
  store.queue = [{ _id: "W9", destination_x: 2271, destination_y: 4782, status: "reached", cosmic_dust_reward: 20, cosmic_dust_reward_taxed: 0, eta: 1 }];
  g.trackVoyager();
  assert.equal(g.session().voy.jumps, 4);
  assert.equal(g.session().voy.xp, 6070 + 1);
});
