// Copied from ../advisor/public/pet-math.js - keep in sync with the advisor.
// Shared pet XP/food/boost-cost formulas. Loaded by advisor-core.js (the
// engine, via require) and by the GUI's app.js (via a <script> tag, as
// window.PetMath) so the game math is defined exactly once.
//
// Exact formulas from the game source (PetsPage chunk + shared constants):
//   XP to reach the next level:  petXpTarget(L) = floor(100 * 1.31^(L-1))
//   Hourly XP while equipped:    ceil((5 + xpboost) * (1 + techSkill/100)
//                                     * (1 + level/10) * (1 + premium/100)
//                                     * food/100)
//     premium bonus = +10% while the subscription is active.
//   XP-boost upgrade cost:       floor(7.5m * 1.5^(b-1)) paid in EACH of the
//                                16 common resources (the gems count too).
//   Food: -5% per hour while equipped, floored at 50% without auto-feed.
//     Auto-feed (premium, per slot) refills to 100% the moment the next
//     decay would drop the pet below the slot's threshold.
//   Unequipped pets: food frozen, no XP gain.
//   Slot is occupied iff slot.pet is set (server keeps a stale pet id only
//   while empty - getAvailableSlot filters on !pet).
//
// Wrapped in a function: in the browser every one of these files is a classic
// <script> sharing ONE global scope, so a top-level `function levelCost` here
// and another in a sibling file silently overwrite each other (lab-math's
// 1.15M x level was replaced by base-math's module curve at call time).
// Only window.PetMath / module.exports leave this scope.
(function () {
const PET_XP_GROW = 1.31;
const PET_PREMIUM_BONUS = 10;
const PET_FOOD_DECAY = 5;
const PET_FOOD_FLOOR = 50;
const PET_BOOST_COST_BASE = 7.5e6;
const PET_BOOST_COST_GROW = 1.5;
const PET_COMMON_RESOURCES = [
  "copper", "gold", "platinum", "silver", "carbon", "nitrogen",
  "sulfur", "water", "ammonia", "helium", "hydrogen", "methane",
  "diamond", "emerald", "ruby", "sapphire",
];

function petXpTarget(level) {
  return Math.floor(100 * Math.pow(PET_XP_GROW, level - 1));
}

// Cost to raise a pet's xpboost from `fromBoost` to +1, in EACH resource.
function petXpBoostCost(fromBoost) {
  return Math.floor(PET_BOOST_COST_BASE * Math.pow(PET_BOOST_COST_GROW, fromBoost - 1));
}

// Cumulative cost of every common resource to go from `from` to `to` boost.
function petXpBoostCostCumulative(from, to) {
  let total = 0;
  for (let b = from; b < to; b++) total += petXpBoostCost(b);
  return total;
}

function petXpPerHour(level, boost, food, techSkill, premiumActive) {
  return Math.ceil(
    (5 + boost) *
    (1 + techSkill / 100) *
    (1 + level / 10) *
    (1 + (premiumActive ? PET_PREMIUM_BONUS : 0) / 100) *
    food / 100
  );
}

// Simulate hourly XP grants with the food cycle (decay + auto-feed refill)
// until the pet reaches its next level. Returns whole hours.
function petHoursToNextLevel(level, currentXp, boost, food, autofeed, autofeedLimit, techSkill, premiumActive) {
  const target = petXpTarget(level);
  let xp = currentXp;
  if (xp >= target) return 0;
  let f = food;
  let hours = 0;
  while (xp < target) {
    xp += petXpPerHour(level, boost, f, techSkill, premiumActive);
    hours++;
    if (hours > 200000) return Infinity;
    if (autofeed && autofeedLimit <= 100) {
      f = (f - PET_FOOD_DECAY < autofeedLimit) ? 100 : f - PET_FOOD_DECAY;
    } else {
      f = Math.max(PET_FOOD_FLOOR, f - PET_FOOD_DECAY);
    }
  }
  return hours;
}

// Steady-state average food over one auto-feed/floor cycle (display info).
function petAvgFood(food, autofeed, autofeedLimit) {
  const lows = autofeed && autofeedLimit <= 100 ? autofeedLimit : PET_FOOD_FLOOR;
  let f = food, sum = 0, n = 0;
  for (let i = 0; i < 30; i++) {
    sum += f; n++;
    if (autofeed && autofeedLimit <= 100) {
      f = (f - PET_FOOD_DECAY < autofeedLimit) ? 100 : f - PET_FOOD_DECAY;
    } else {
      f = Math.max(PET_FOOD_FLOOR, f - PET_FOOD_DECAY);
    }
    if (f === food && i > 0) break;
  }
  return Math.round((sum / n) * 10) / 10;
}

const PetMath = {
  PET_XP_GROW, PET_PREMIUM_BONUS, PET_FOOD_DECAY, PET_FOOD_FLOOR,
  PET_BOOST_COST_BASE, PET_BOOST_COST_GROW, PET_COMMON_RESOURCES,
  petXpTarget, petXpBoostCost, petXpBoostCostCumulative, petXpPerHour,
  petHoursToNextLevel, petAvgFood,
};
if (typeof module !== "undefined" && module.exports) module.exports = PetMath;
if (typeof window !== "undefined") window.PetMath = PetMath;
})();
