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
	trading: `// Trading: what an aven wants to buy, what it can spare, who meets whom when the market clears, and the price they
// strike
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

// who meets next when the market clears: the cheapest seller and the buyer who pays most (null: the round ends)
export function match({ good, sellers, buyers }) {
  const seller = [...sellers].sort((x, y) => x.price - y.price)[0];
  const buyer = [...buyers].sort((x, y) => y.price - x.price).find((b) => b.id !== seller?.id);
  return seller && buyer ? { seller: seller.id, buyer: buyer.id } : null;
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
	brains: `// Brains: what each aven's brain sees, what it is asked (and the price each answer stands for), what a chat model is
// told first, and how a day counts in its trials
const GOODS = ['water', 'fruits', 'vegetables', 'legumes', 'chicken'];
const LABEL = { water: 'WATER', fruits: 'FRUITS', vegetables: 'VEGETABLES', legumes: 'LEGUMES', chicken: 'CHICKEN' };
const SHORT = { water: 30, food: 6 }; // what a unit gone short costs a day's score, in HEARTS: water kills, food waits
const needs = (v) => Object.fromEntries(GOODS.map((g) => [g, g === 'water' ? v.needWater : v.needFood]));
const needOf = (aven, g, v) => aven.need?.[g] ?? needs(v)[g];
const rotOf = (g, v) => v['rot_' + g] / 100;
const cents = (x) => Math.max(0.01, Math.round(x * 100) / 100);

// the state a brain decides on: its own books and what it can see of the valley, nothing else
export function see({ aven: a, day, weather, market, history, others, brain, valley }) {
  const v = valley.values;
  const need = needs(v);
  const y = a.yesterday;
  const buys = GOODS.filter((g) => !a.grows.includes(g));
  const priced = buys.every((g) => market[g].price != null);
  const cost = priced ? buys.reduce((n, g) => n + needOf(a, g, v) * market[g].price, 0) : 0;
  return {
    game: \`\${valley.avens.length} avens trade food and water for HEARTS. Each needs \${need.water} WATER and \${need.fruits} each of FRUITS, VEGETABLES, LEGUMES and CHICKEN every day. With no water at all an aven lives through \${v.waterDays} days; with no food at all it lives \${v.foodDays} days, so water is by far the most urgent need and a day short of food is no emergency. Supply is only just above need, so shortages are common. Every aven mints \${v.mint} HEARTS a day and every HEART decays \${v.decay}% a year, so hoarded HEARTS shrink. There are no set prices: every aven names its own in HEARTS. Every \${v.clearHours} hour\${v.clearHours === 1 ? '' : 's'} the market matches each good's cheapest seller with the buyer who pays most, while the seller's price is within the buyer's limit (or close enough to haggle). The market price is just the average actually traded over the last day. Goal: survive and end with the most HEARTS.\`,
    day,
    me: a.name,
    hearts: a.hearts,
    health: \`\${a.health} of \${v.healthMax}; at 0 I die\`,
    body_reserves: { water: Math.round(a.body.water), food: Math.round(a.body.food) },
    i_grow_per_day_on_average: a.produce,
    my_harvest_last_night: a.harvest,
    harvests_vary: \`about ±\${v.swing}% a night; \${v.badChance}% of nights a bad harvest (30–60%), \${v.richChance}% a rich one\`,
    // what it takes to stay alive: how long it lasts on its own stock, and what a day's missing needs cost at the market
    survival: {
      days_my_stock_lasts: Object.fromEntries(GOODS.map((g) => [g, needOf(a, g, v) ? Math.floor(a.stock[g] / needOf(a, g, v)) : null])),
      short_tonight_unless_i_buy: Object.fromEntries(GOODS.filter((g) => a.stock[g] < needOf(a, g, v)).map((g) => [g, needOf(a, g, v) - a.stock[g]])),
      water_reserve: \`\${Math.round(a.body.water)} of 100; at 0 I die. With no water at all I last \${v.waterDays} days\`,
      food_reserve: \`\${Math.round(a.body.food)} of 100; at 0 I die. With no food at all I last \${v.foodDays} days\`,
      cost_of_one_day_of_what_i_must_buy_at_market_price: priced ? Math.round(cost * 100) / 100 : 'not known yet: some of it has never been traded',
      days_my_hearts_last_at_that_cost: cost ? Math.floor(a.hearts / cost) : null
    },
    share_that_rots_each_night: Object.fromEntries(GOODS.map((g) => [g, rotOf(g, v)])),
    // what rots in its store tonight unless it sells (or eats) it, and what that is worth at the clearing price
    rots_tonight_unless_sold: Object.fromEntries(GOODS.filter((g) => rotOf(g, v) && a.stock[g] > needOf(a, g, v)).map((g) => [g, rotsTonight(a, g, v, market[g].price)])),
    water: weather.dry ? \`dry spell for \${weather.dry} more nights: wells give only about \${v.dryWells}%, no rain\` : \`normal; \${v.dryChance}% of nights a dry spell of \${v.dryMin}–\${v.dryMax} days starts and wells give only about \${v.dryWells}%\`,
    rain_barrel: \`\${v.rainChance}% of nights it rains and my barrel catches 1–\${v.rainMax} WATER (never in a dry spell)\`,
    stock: a.stock,
    need_per_day: need,
    days_of_stock_wanted: a.keep ? { water: a.keep.water, food: a.keep.food } : a.reserveDays,
    my_asking_prices: a.ask,
    my_buying_limits: a.bid,
    how_far_i_give_in_haggling: a.flex,
    yesterday: y ? { sold: y.sold, bought: y.bought, went_short_of: y.short, rotted: y.rotted ?? {} } : null,
    // the market board: per good, the price, the last week, and who offers and wants how much right now
    market: Object.fromEntries(GOODS.map((g) => {
      const m = market[g];
      return [g, {
        market_price: m.price,
        market_price_last_7_days: history.map((r) => r.price[g]),
        average_traded_last_7_days: history.map((r) => r.avg[g]),
        units_traded_last_7_days: history.map((r) => r.units[g]),
        offered_now: m.supply,
        wanted_now: m.demand,
        sellers_asking: m.sells.map((o) => \`\${o.name}: \${o.qty} at \${o.price}\`),
        buyers_offering: m.wants.map((o) => \`\${o.name}: \${o.qty} up to \${o.price}\`)
      }];
    })),
    others: others.map((o) => ({ name: o.name, alive: o.alive, hearts: o.hearts, grows: o.grows, asking: o.alive ? o.ask : null })),
    // who it is and what it learned, in this world: its character, wants, trials, lessons, deaths
    my_brain: brain ?? undefined
  };
}

// free prices: an aven names any price it likes, every time it is asked; no anchor on its own last price, no daily cap,
// no ceiling. A brain that writes numbers (Qwen) answers the price itself; a decision model (d1) picks on a scale, a
// tenth to ten times the clearing price, else (never traded) 0.1 to 100,000 HEARTS a unit, and a score between two
// options stands for a price between them
const WIDE = [0.1, 0.5, 2, 10, 50, 250, 1000, 5000, 25000, 100000];
const SPREAD = [0.1, 0.2, 0.35, 0.5, 0.7, 1, 1.4, 2, 4, 10];
function priceLevels(market) {
  if (market == null) return { levels: WIDE.map(cents), criteria: WIDE.map((p) => \`\${p} HEARTS a unit\`) };
  const levels = SPREAD.map((f) => cents(market * f));
  return { levels, criteria: SPREAD.map((f, i) => \`\${levels[i]} HEARTS a unit (\${f === 1 ? 'the clearing price' : \`\${f}× the clearing price\`})\`) };
}
// what rots in a store tonight unless it is sold: what it holds beyond tonight's own need, times the share that rots,
// and what that is worth at the clearing price
function rotsTonight(a, g, v, price) {
  const units = Math.floor(Math.max(0, a.stock[g] - needOf(a, g, v)) * rotOf(g, v));
  return { units, hearts: price == null ? null : Math.round(units * price * 100) / 100 };
}
const FREE = 'Name any price you like, in HEARTS a unit: there is no floor and no ceiling, and you may change it every time you are asked.';

// the typed questions each morning: a selling price per good it grows, a buying limit per good it buys (each a number:
// \`levels\` is the scale a decision model picks it on), and (on a full ask) how far it gives in when haggling
export function ask({ aven: a, full, market, wants, spares, character, valley }) {
  const v = valley.values;
  const q = {};
  for (const g of a.grows) {
    const m = market[g];
    const sold = a.yesterday ? a.yesterday.sold[g] : 0;
    const rot = rotOf(g, v);
    const r = rotsTonight(a, g, v, m.price);
    const lv = priceLevels(m.price);
    q['ask_' + g] = {
      type: 'number',
      instructions: \`You grow \${LABEL[g]} and hold \${a.stock[g]} (you need \${needOf(a, g, v)} a day yourself and can spare \${spares[g]}). \${m.price == null ? 'Nobody has traded it yet, so there is no clearing price' : \`Its clearing price (the average traded over the last day) is \${m.price} HEARTS\`}; right now \${m.supply} are offered and \${m.demand} wanted across the valley (see the market's 7-day history and what the other sellers ask). Yesterday you sold \${sold}\${rot ? \`; \${Math.round(rot * 100)}% of what you keep rots each night: unless you sell them, \${r.units} of your \${a.stock[g]} rot tonight\${r.hearts != null ? \` (\${r.hearts} HEARTS at the clearing price, lost)\` : ''}\` : '; it keeps'}. Price it yourself to earn the most HEARTS: high when it is scarce and wanted, low enough to sell what would otherwise rot.\${character.greed} \${FREE} What is the lowest price you sell \${LABEL[g]} at?\`,
      // what the answer sets, as the activity feed says it
      label: v.haggleMax > 0 ? \`sells \${LABEL[g]} at\` : \`lowest it accepts for \${LABEL[g]}\`,
      unit: 'HEARTS',
      criteria: lv.criteria,
      levels: lv.levels
    };
  }
  for (const g of GOODS) {
    if (a.grows.includes(g)) continue;
    const m = market[g];
    const n = needOf(a, g, v);
    const rot = rotOf(g, v);
    const lv = priceLevels(m.price);
    // how soon it dies without the good: water first, food far later
    const deadline = g === 'water'
      ? \`Without water you die: your water reserve is \${Math.round(a.body.water)} of 100 and with none at all you last \${v.waterDays} days, so water is your most urgent need.\`
      : \`Your food reserve is \${Math.round(a.body.food)} of 100; with no food at all you still last \${v.foodDays} days, so food is far less urgent than water.\`;
    q['bid_' + g] = {
      type: 'number',
      instructions: \`You don't grow \${LABEL[g]} and must buy it: you need \${n} a day, hold \${a.stock[g]} (\${a.stock[g] < n ? \`short by \${n - a.stock[g]} tonight unless you buy\` : \`enough for \${Math.floor(a.stock[g] / n)} days\`}) and want \${wants[g]} more\${rot ? \`; \${Math.round(rot * 100)}% of a stock rots each night, so what you hold beyond your needs is lost\` : ''}. \${deadline} You hold \${Math.round(a.hearts)} HEARTS. \${m.price == null ? 'Nobody has traded it yet, so there is no clearing price' : \`Its clearing price (the average traded over the last day) is \${m.price}\`}; \${m.supply} are offered and \${m.demand} wanted (see the 7-day history and what sellers ask). Survival first, then keep the most HEARTS: pay up when you are about to go short, pay little when you are well stocked.\${character.thrift} \${FREE} What is the most you pay for \${LABEL[g]}?\`,
      label: v.haggleMax > 0 ? \`pays \${LABEL[g]} up to\` : \`most it pays for \${LABEL[g]}\`,
      unit: 'HEARTS',
      criteria: lv.criteria,
      levels: lv.levels
    };
  }
  if (full && v.haggleMax > 0) {
    const flexes = [0, 0.1, 0.25, 0.5, 1].map((f) => Math.round(f * v.haggleMax) / 100);
    q.flex = {
      type: 'score',
      instructions: \`When a buyer's limit and a seller's price don't meet, how far should you give in to strike the deal?\${character.haggle}\`,
      label: 'gives in up to',
      criteria: flexes.map((f, i) => (i ? \`Give in up to \${Math.round(f * 100)}%\` : 'Never give in')),
      levels: flexes
    };
  }
  return q;
}

// what a chat model (Qwen) is told before the state and the questions
export function prompt({ aven }) {
  return \`You decide for \${aven.name}, one of the avens in a trading game. Read its state, then answer every question by picking the option that serves it best: survive first, then end with the most HEARTS. Act as the character in my_brain, and learn from its trials, lessons and deaths. Reply with one JSON object only: for each question key, the number or key of the option you pick (where a question asks for a number, the number itself; where asked to write, a short text). /no_think\`;
}

// what the aven's brain is, so the page shows any brain the same way: the dials of its character (each with its range
// and what its two ends mean), the wants it keeps in stock, and what its trials optimise (the score below, in words).
// Its trials change only these, and only these reach its asks (as \`character\`)
export function traits({ valley }) {
  const dials = [
    { key: 'greed', label: 'Greed', low: 'prices low to sell all it grows', high: 'asks high and waits for a buyer who pays', min: 0, max: 10 },
    { key: 'thrift', label: 'Thrift', low: 'pays what it takes to get its needs', high: 'pays as little as it can', min: 0, max: 10 }
  ];
  if (valley.values.haggleMax > 0) dials.push({ key: 'haggle', label: 'Haggling', low: 'gives in quickly to strike a deal', high: 'hardly gives in', min: 0, max: 10 });
  return {
    dials,
    wants: [
      { key: 'water', label: 'Water in stock', unit: 'days', min: 1, max: 10 },
      { key: 'food', label: 'Food in stock', unit: 'days', min: 1, max: 10 }
    ],
    score: \`HEARTS gained a day, less \${SHORT.water} for each unit of water and \${SHORT.food} for each unit of food gone short\`
  };
}

// a day's score in its trials: HEARTS gained, less what going short cost; a trial is kept only if it raises the score
export function score({ gained, short }) {
  return gained - Object.entries(short).reduce((n, [g, q]) => n + q * SHORT[g === 'water' ? 'water' : 'food'], 0);
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
