// @ts-nocheck — plain JS data, kept loose on purpose
// The rulebook as code (Samuel, 2026-10-09): every mechanic of the valley is a hook in a config card's code, run in the
// page's QuickJS sandbox (src/lib/sandbox-8/sandbox.js), never in the page itself. Below is each section card's default
// code: the valley's own rules, written out. A config card with code of its own runs that instead (a MIP changes it,
// like anything else), and any other card exporting the same hook is given what the rule made of it as `value`.
// The engine (src/lib/sandbox-8/economy.js) keeps the same rules natively, only as the fallback for a hook that fails
// or a page where QuickJS can't load; scripts/sandbox-8-rules.mjs checks the two agree.
//
// Every hook gets one argument with `valley` ({ day, values (every param by key), weather, prices, avens, ... }) and
// what the hook names; `dice` are numbers in [0, 1) drawn from the world's seeded dice, so a world plays the same way
// again from its seed. A hook returns plain JSON.

export const DEFAULT_CODE = {
	hearts: `// HEARTS: what each living aven is given each night, and what each balance loses
export function mint({ aven, valley }) {
  return valley.values.mint;
}

export function decay({ aven, valley }) {
  const perNight = Math.round((valley.values.decay / 100 / 365) * 1e7) / 1e7;
  return aven.hearts * perNight;
}
`,
	trading: `// Trading: what an aven wants to buy, what it can spare, and the price when a seller and a buyer meet
const need = (good, values) => (good === 'water' ? values.needWater : values.needFood);

// a good it doesn't grow: up to its stock target, in days of need (its brain's wants, else the starting target)
export function want({ aven, good, valley }) {
  if (aven.grows.includes(good)) return 0;
  const days = aven.keep?.[good === 'water' ? 'water' : 'food'] ?? aven.reserveDays;
  return Math.max(0, need(good, valley.values) * days - aven.stock[good]);
}

// a good it grows: everything above two days of its own need
export function spare({ aven, good, valley }) {
  if (!aven.grows.includes(good)) return 0;
  return Math.max(0, aven.stock[good] - need(good, valley.values) * 2);
}

// the seller's price when the buyer's limit reaches it; else each gives in up to its own flexibility and, if the gap
// closes, they settle halfway between what each will still accept; null: no deal
export function haggle({ ask, bid, sellerFlex, buyerFlex }) {
  if (ask <= bid) return ask;
  const floor = ask * (1 - sellerFlex);
  const ceiling = bid * (1 + buyerFlex);
  if (floor > ceiling) return null;
  return Math.max(0.01, Math.round(((Math.max(floor, bid) + Math.min(ceiling, ask)) / 2) * 100) / 100);
}
`,
	avens: `// Avens: when the dead come back, and with what (-1: not yet)
export function rebirth({ aven, dead, valley }) {
  return dead >= valley.values.rebirthDays ? valley.values.startHearts : -1;
}
`,
	bodies: `// Needs and bodies: what each aven eats and drinks a night, and what that does to its two reserves (0-100; it dies
// when either reaches 0)
export function need({ aven, good, valley }) {
  return good === 'water' ? valley.values.needWater : valley.values.needFood;
}

// short: the units of each good it went without tonight; need: what it needed of each
export function body({ aven, short, need, valley }) {
  const v = valley.values;
  // health lost per missing unit, so that with none at all it lives through \`days\` days and dies the night after
  const hurt = (n, days) => (n ? Math.round((100 / (n * (days + 0.5))) * 1000) / 1000 : 0);
  const foods = ['fruits', 'vegetables', 'legumes', 'chicken'];
  const water = short.water ?? 0;
  const food = foods.reduce((n, g) => n + (short[g] ?? 0), 0);
  const foodNeed = foods.reduce((n, g) => n + need[g], 0);
  const clamp = (x) => Math.min(100, Math.max(0, x));
  return {
    water: clamp(aven.body.water + (water ? -hurt(need.water, v.waterDays) * water : v.mendWater)),
    food: clamp(aven.body.food + (food ? -hurt(foodNeed, v.foodDays) * food : v.mendFood))
  };
}
`,
	rot: `// Rot: the units of a good that rot tonight in an aven's store (a share of it, the remainder by chance)
export function rot({ aven, good, dice, valley }) {
  const held = aven.stock[good];
  const x = held * (valley.values['rot_' + good] / 100);
  return Math.min(held, Math.floor(x) + (dice[0] < x % 1 ? 1 : 0));
}
`,
	land: `// Land and production: how land is dealt out is set when a world is made (the values of this card); no hook yet
`,
	harvests: `// Harvests: what an aven's land gives each morning, about its capacity: now and then a bad (30-60%) or a rich
// (130-160%) night, and WATER low in a dry spell
export function harvest({ aven, good, capacity, dice, valley }) {
  const v = valley.values;
  if (good === 'water' && valley.weather.dry) {
    return { qty: Math.max(0, Math.round(capacity * Math.max(0, v.dryWells / 100 - 0.15 + dice[1] * 0.3))), kind: 'dry' };
  }
  const swing = v.swing / 100;
  let f, kind;
  if (dice[0] < v.badChance / 100) (f = 0.3 + dice[1] * 0.3), (kind = 'bad');
  else if (dice[0] > 1 - v.richChance / 100) (f = 1.3 + dice[1] * 0.3), (kind = 'rich');
  else (f = 1 - swing + (dice[1] + dice[2]) * swing), (kind = 'normal');
  return { qty: Math.max(0, Math.round(capacity * f)), kind };
}
`,
	weather: `// Weather, valley-wide, each night: now and then a dry spell begins (wells run low, no rain); otherwise some nights
// it rains and every land's barrel catches a little WATER
export function weather({ weather, day, dice, valley }) {
  const v = valley.values;
  const w = { ...weather };
  if (w.dry) w.dry -= 1;
  else if (dice[0] < v.dryChance / 100) {
    const lo = Math.min(v.dryMin, v.dryMax);
    w.dry = lo + Math.floor(dice[1] * (Math.max(v.dryMin, v.dryMax) - lo + 1));
    w.dryFrom = day;
  }
  w.rain = !w.dry && v.rainMax > 0 && dice[2] < v.rainChance / 100 ? 1 + Math.floor(dice[3] * v.rainMax) : 0;
  return w;
}
`
};
