// Brains: what each aven's brain sees, what it is asked (and the price each answer stands for), what a chat model is
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
    game: `${valley.avens.length} avens trade food and water for HEARTS. Each needs ${need.water} WATER and ${need.fruits} each of FRUITS, VEGETABLES, LEGUMES and CHICKEN every day. With no water at all an aven lives through ${v.waterDays} days; with no food at all it lives ${v.foodDays} days, so water is by far the most urgent need and a day short of food is no emergency. Supply is only just above need, so shortages are common. Every aven mints ${v.mint} HEARTS a day and every HEART decays ${v.decay}% a year, so hoarded HEARTS shrink. There are no set prices: every aven names its own in HEARTS. Every ${v.clearHours} hour${v.clearHours === 1 ? '' : 's'} the market matches each good's cheapest seller with the buyer who pays most, while the seller's price is within the buyer's limit (or close enough to haggle). The market price is just the average actually traded over the last day. Goal: survive and end with the most HEARTS.`,
    day,
    me: a.name,
    hearts: a.hearts,
    health: `${a.health} of ${v.healthMax}; at 0 I die`,
    body_reserves: { water: Math.round(a.body.water), food: Math.round(a.body.food) },
    i_grow_per_day_on_average: a.produce,
    my_harvest_last_night: a.harvest,
    harvests_vary: `about ±${v.swing}% a night; ${v.badChance}% of nights a bad harvest (30–60%), ${v.richChance}% a rich one`,
    // what it takes to stay alive: how long it lasts on its own stock, and what a day's missing needs cost at the market
    survival: {
      days_my_stock_lasts: Object.fromEntries(GOODS.map((g) => [g, needOf(a, g, v) ? Math.floor(a.stock[g] / needOf(a, g, v)) : null])),
      short_tonight_unless_i_buy: Object.fromEntries(GOODS.filter((g) => a.stock[g] < needOf(a, g, v)).map((g) => [g, needOf(a, g, v) - a.stock[g]])),
      water_reserve: `${Math.round(a.body.water)} of 100; at 0 I die. With no water at all I last ${v.waterDays} days`,
      food_reserve: `${Math.round(a.body.food)} of 100; at 0 I die. With no food at all I last ${v.foodDays} days`,
      cost_of_one_day_of_what_i_must_buy_at_market_price: priced ? Math.round(cost * 100) / 100 : 'not known yet: some of it has never been traded',
      days_my_hearts_last_at_that_cost: cost ? Math.floor(a.hearts / cost) : null
    },
    share_that_rots_each_night: Object.fromEntries(GOODS.map((g) => [g, rotOf(g, v)])),
    // what rots in its store tonight unless it sells (or eats) it, and what that is worth at the clearing price
    rots_tonight_unless_sold: Object.fromEntries(GOODS.filter((g) => rotOf(g, v) && a.stock[g] > needOf(a, g, v)).map((g) => [g, rotsTonight(a, g, v, market[g].price)])),
    water: weather.dry ? `dry spell for ${weather.dry} more nights: wells give only about ${v.dryWells}%, no rain` : `normal; ${v.dryChance}% of nights a dry spell of ${v.dryMin}–${v.dryMax} days starts and wells give only about ${v.dryWells}%`,
    rain_barrel: `${v.rainChance}% of nights it rains and my barrel catches 1–${v.rainMax} WATER (never in a dry spell)`,
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
        sellers_asking: m.sells.map((o) => `${o.name}: ${o.qty} at ${o.price}`),
        buyers_offering: m.wants.map((o) => `${o.name}: ${o.qty} up to ${o.price}`)
      }];
    })),
    others: others.map((o) => ({ name: o.name, alive: o.alive, hearts: o.hearts, grows: o.grows, asking: o.alive ? o.ask : null })),
    // who it is and what it learned, in this world: its character, wants, trials, lessons, deaths
    my_brain: brain ?? undefined
  };
}

// prices: an aven names its price every time it decides, on a scale (d1) or as a number held within it (Qwen) from a
// quarter to four times its own price as the day began, "keep it" in the middle, so a price never compounds within a
// day but goes anywhere over days. Where the market trades beyond that, its price is one more option. No price yet
// (never priced, or just reborn): around the market's price, else FIRST. No cap from its HEARTS.
const FIRST = [0.5, 1, 2, 4, 8, 15, 30, 60, 120, 250];
const MOVES = [0.25, 0.35, 0.5, 0.7, 1, 1.4, 2, 2.8, 4];
function priceLevels({ mine, market }) {
  const base = mine ?? market;
  if (base == null) return { levels: FIRST.map(cents), criteria: FIRST.map((p) => `${cents(p)} HEARTS a unit`) };
  const what = mine != null ? 'my price this morning' : 'the market price';
  const opts = MOVES.map((f) => ({ p: cents(base * f), say: f === 1 ? `keep ${what}` : `${f}× ${what}` }));
  if (market != null && (market < opts[0].p || market > opts[opts.length - 1].p)) opts.push({ p: cents(market), say: 'what it traded at over the last day' });
  opts.sort((x, y) => x.p - y.p);
  return { levels: opts.map((o) => o.p), criteria: opts.map((o) => `${o.p} HEARTS a unit (${o.say})`) };
}
// what it is told about its price: where it stood this morning, and how far it may move it today
const range = (an, lv) => `${an.mine != null ? `Your price this morning was ${an.mine} HEARTS. ` : ''}Name your price in HEARTS a unit, anywhere from ${lv.levels[0]} to ${lv.levels[lv.levels.length - 1]} today.`;
// what rots in a store tonight unless it is sold: what it holds beyond tonight's own need, times the share that rots,
// and what that is worth at the clearing price
function rotsTonight(a, g, v, price) {
  const units = Math.floor(Math.max(0, a.stock[g] - needOf(a, g, v)) * rotOf(g, v));
  return { units, hearts: price == null ? null : Math.round(units * price * 100) / 100 };
}

// the typed questions each morning: a selling price per good it grows, a buying limit per good it buys (each a number:
// `levels` is the scale a decision model picks it on, and the engine holds a named number within it), and (on a full ask) how far it gives in when haggling
export function ask({ aven: a, full, anchors, market, wants, spares, character, valley }) {
  const v = valley.values;
  const q = {};
  for (const g of a.grows) {
    const m = market[g];
    const sold = a.yesterday ? a.yesterday.sold[g] : 0;
    const rot = rotOf(g, v);
    const r = rotsTonight(a, g, v, m.price);
    const lv = priceLevels(anchors[g]);
    q['ask_' + g] = {
      type: 'number',
      instructions: `You grow ${LABEL[g]} and hold ${a.stock[g]} (you need ${needOf(a, g, v)} a day yourself and can spare ${spares[g]}). ${m.price == null ? 'Nobody has traded it yet, so there is no clearing price' : `Its clearing price (the average traded over the last day) is ${m.price} HEARTS`}; right now ${m.supply} are offered and ${m.demand} wanted across the valley (see the market's 7-day history and what the other sellers ask). Yesterday you sold ${sold}${rot ? `; ${Math.round(rot * 100)}% of what you keep rots each night: unless you sell them, ${r.units} of your ${a.stock[g]} rot tonight${r.hearts != null ? ` (${r.hearts} HEARTS at the clearing price, lost)` : ''}` : '; it keeps'}. Price it yourself to earn the most HEARTS: high when it is scarce and wanted, low enough to sell what would otherwise rot.${character.greed} ${range(anchors[g], lv)} What is the lowest price you sell ${LABEL[g]} at?`,
      // what the answer sets, as the activity feed says it
      label: v.haggleMax > 0 ? `sells ${LABEL[g]} at` : `lowest it accepts for ${LABEL[g]}`,
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
    const lv = priceLevels(anchors[g]);
    // how soon it dies without the good: water first, food far later
    const deadline = g === 'water'
      ? `Without water you die: your water reserve is ${Math.round(a.body.water)} of 100 and with none at all you last ${v.waterDays} days, so water is your most urgent need.`
      : `Your food reserve is ${Math.round(a.body.food)} of 100; with no food at all you still last ${v.foodDays} days, so food is far less urgent than water.`;
    q['bid_' + g] = {
      type: 'number',
      instructions: `You don't grow ${LABEL[g]} and must buy it: you need ${n} a day, hold ${a.stock[g]} (${a.stock[g] < n ? `short by ${n - a.stock[g]} tonight unless you buy` : `enough for ${Math.floor(a.stock[g] / n)} days`}) and want ${wants[g]} more${rot ? `; ${Math.round(rot * 100)}% of a stock rots each night, so what you hold beyond your needs is lost` : ''}. ${deadline} You hold ${Math.round(a.hearts)} HEARTS. ${m.price == null ? 'Nobody has traded it yet, so there is no clearing price' : `Its clearing price (the average traded over the last day) is ${m.price}`}; ${m.supply} are offered and ${m.demand} wanted (see the 7-day history and what sellers ask). Survival first, then keep the most HEARTS: pay up when you are about to go short, pay little when you are well stocked.${character.thrift} ${range(anchors[g], lv)} What is the most you pay for ${LABEL[g]}?`,
      label: v.haggleMax > 0 ? `pays ${LABEL[g]} up to` : `most it pays for ${LABEL[g]}`,
      unit: 'HEARTS',
      criteria: lv.criteria,
      levels: lv.levels
    };
  }
  if (full && v.haggleMax > 0) {
    const flexes = [0, 0.1, 0.25, 0.5, 1].map((f) => Math.round(f * v.haggleMax) / 100);
    q.flex = {
      type: 'score',
      instructions: `When a buyer's limit and a seller's price don't meet, how far should you give in to strike the deal?${character.haggle}`,
      label: 'gives in up to',
      criteria: flexes.map((f, i) => (i ? `Give in up to ${Math.round(f * 100)}%` : 'Never give in')),
      levels: flexes
    };
  }
  return q;
}

// what a chat model (Qwen) is told before the state and the questions
export function prompt({ aven }) {
  return `You decide for ${aven.name}, one of the avens in a trading game. Read its state, then answer every question by picking the option that serves it best: survive first, then end with the most HEARTS. Act as the character in my_brain, and learn from its trials, lessons and deaths. Reply with one JSON object only: for each question key, the number or key of the option you pick (where a question asks for a number, the number itself; where asked to write, a short text). /no_think`;
}

// what the aven's brain is, so the page shows any brain the same way: the dials of its character (each with its range
// and what its two ends mean), the wants it keeps in stock, and what its trials optimise (the score below, in words).
// Its trials change only these, and only these reach its asks (as `character`)
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
    score: `HEARTS gained a day, less ${SHORT.water} for each unit of water and ${SHORT.food} for each unit of food gone short`
  };
}

// a day's score in its trials: HEARTS gained, less what going short cost; a trial is kept only if it raises the score
export function score({ gained, short }) {
  return gained - Object.entries(short).reduce((n, [g, q]) => n + q * SHORT[g === 'water' ? 'water' : 'food'], 0);
}
