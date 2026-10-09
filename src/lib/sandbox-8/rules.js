// @ts-nocheck — plain JS game state, kept loose on purpose
// Every number the valley runs on, in one place, so it can be played with: the policies people choose (HEARTS,
// prices, trading) and the world's own rules (needs, bodies, rot, land, harvests, weather). The Policies and World
// views list them in plain words; a change applies at once, or on the next Reset where it shapes the valley itself.
// The page holds one valley, so the live values sit in one shared object, RULES.

export const GOODS = ['water', 'fruits', 'vegetables', 'legumes', 'chicken'];
/** @type {Record<string, string>} */
export const GOOD_LABEL = { water: 'WATER', fruits: 'FRUITS', vegetables: 'VEGETABLES', legumes: 'LEGUMES', chicken: 'CHICKEN' };

/**
 * One parameter. `say` turns a value into a plain sentence; `reset` means it only takes effect on Reset.
 * @typedef {{ key: string, view: 'policy' | 'world', section: string, label: string, unit: string, min: number, max: number, step: number, value: number, reset?: boolean, say: (v: number) => string }} Param
 */

/** @type {Param[]} */
export const PARAMS = [
	// ---- policies: HEARTS ----
	{ key: 'startHearts', view: 'policy', section: 'HEARTS', label: 'Starting HEARTS', unit: 'HEARTS', min: 0, max: 1000000, step: 100, value: 1000, reset: true, say: (v) => `Every aven starts with ${n(v)} HEARTS.` },
	{ key: 'mint', view: 'policy', section: 'HEARTS', label: 'Minting', unit: 'HEARTS a day', min: 0, max: 10000, step: 1, value: 24, say: (v) => `Every living aven is given ${n(v)} new HEARTS each night.` },
	{ key: 'decay', view: 'policy', section: 'HEARTS', label: 'Decay', unit: '% a year', min: 0, max: 100, step: 0.5, value: 7, say: (v) => `Every balance shrinks by ${v}% a year, charged nightly (${(v / 365).toFixed(3)}% a night), so hoarded HEARTS melt.` },
	// ---- policies: prices ----
	{ key: 'startPrice', view: 'policy', section: 'Prices', label: 'Starting price', unit: 'HEARTS a unit', min: 0.01, max: 100000, step: 1, value: 10, reset: true, say: (v) => `Every good starts at ${n(v)} HEARTS a unit.` },
	{ key: 'priceDays', view: 'policy', section: 'Prices', label: 'Market speed', unit: 'days', min: 0.1, max: 60, step: 0.1, value: 2, say: (v) => `The market price follows wanted against offered with no cap; it takes ${v} day${v === 1 ? '' : 's'} to move by their full ratio (twice as much wanted as offered: ×2 in ${v} day${v === 1 ? '' : 's'}).` },
	{ key: 'tradePull', view: 'policy', section: 'Prices', label: 'Pull of real trades', unit: '%', min: 0, max: 100, step: 5, value: 30, say: (v) => `Each night the market price moves ${v}% of the way to that day's average traded price.` },
	{ key: 'askMin', view: 'policy', section: 'Prices', label: 'Lowest own price', unit: '× market', min: 0.01, max: 1, step: 0.05, value: 0.25, say: (v) => `An aven may price as low as ${v}× the market price.` },
	{ key: 'askMax', view: 'policy', section: 'Prices', label: 'Highest own price', unit: '× market', min: 1, max: 100, step: 0.5, value: 4, say: (v) => `An aven may price as high as ${v}× the market price.` },
	// ---- policies: trading ----
	{ key: 'haggleMax', view: 'policy', section: 'Trading', label: 'Haggling', unit: '%', min: 0, max: 100, step: 5, value: 100, say: (v) => (v ? `When prices don't meet, an aven may give in up to ${v}% of its own price.` : 'No haggling: a deal happens only at the seller\'s price.') },
	{ key: 'meetHours', view: 'policy', section: 'Trading', label: 'Time between deals', unit: 'hours', min: 0.25, max: 48, step: 0.25, value: 1, say: (v) => `Two avens haggle at most once every ${v} hour${v === 1 ? '' : 's'}.` },
	{ key: 'marketHours', view: 'policy', section: 'Trading', label: 'Market visit', unit: 'hours', min: 0.5, max: 24, step: 0.5, value: 3, say: (v) => `An aven that goes to the market square stays ${v} hours, trading with everyone there.` },
	{ key: 'reserveDays', view: 'policy', section: 'Trading', label: 'Starting stock target', unit: 'days', min: 1, max: 14, step: 1, value: 3, reset: true, say: (v) => `Each aven starts out wanting ${v} days of food and water in store (its brain changes this every morning).` },

	// ---- world: the avens ----
	{ key: 'avens', view: 'world', section: 'Avens', label: 'Avens', unit: 'avens', min: 2, max: 10, step: 1, value: 10, reset: true, say: (v) => `${v} avens live in the valley, each on its own land.` },
	{ key: 'startDays', view: 'world', section: 'Avens', label: 'Starting rations', unit: 'days', min: 0, max: 30, step: 1, value: 2, reset: true, say: (v) => `Each aven starts with ${v} days of every need in store, plus its first harvest.` },
	{ key: 'walk', view: 'world', section: 'Avens', label: 'Walking speed', unit: 'units an hour', min: 20, max: 2000, step: 10, value: 260, say: (v) => `An aven walks ${v} units an hour (the valley is 1,200 wide); slower when weak.` },
	// ---- world: needs and bodies ----
	{ key: 'needWater', view: 'world', section: 'Needs and bodies', label: 'Water a day', unit: 'units', min: 0, max: 20, step: 1, value: 3, say: (v) => `Every aven drinks ${v} WATER a night.` },
	{ key: 'needFood', view: 'world', section: 'Needs and bodies', label: 'Each food a day', unit: 'units', min: 0, max: 20, step: 1, value: 2, say: (v) => `Every aven eats ${v} each of FRUITS, VEGETABLES, LEGUMES and CHICKEN a night.` },
	{ key: 'waterDays', view: 'world', section: 'Needs and bodies', label: 'Days without water', unit: 'days', min: 0, max: 30, step: 1, value: 2, say: (v) => `With no water at all an aven lives through ${v} day${v === 1 ? '' : 's'} and dies the next.` },
	{ key: 'foodDays', view: 'world', section: 'Needs and bodies', label: 'Days without food', unit: 'days', min: 0, max: 120, step: 1, value: 21, say: (v) => `With no food at all an aven lives ${v} days.` },
	{ key: 'mendWater', view: 'world', section: 'Needs and bodies', label: 'Water recovery', unit: 'points a night', min: 0, max: 100, step: 1, value: 34, say: (v) => `A night with all its water refills the water reserve by ${v} of 100.` },
	{ key: 'mendFood', view: 'world', section: 'Needs and bodies', label: 'Food recovery', unit: 'points a night', min: 0, max: 100, step: 1, value: 5, say: (v) => `A night with all its food refills the food reserve by ${v} of 100.` },
	// ---- world: rot ----
	{ key: 'rot_water', view: 'world', section: 'Rot', label: 'WATER', unit: '% a night', min: 0, max: 100, step: 1, value: 0, say: (v) => (v ? `${v}% of stored WATER is lost each night.` : 'WATER keeps for ever.') },
	{ key: 'rot_fruits', view: 'world', section: 'Rot', label: 'FRUITS', unit: '% a night', min: 0, max: 100, step: 1, value: 25, say: (v) => `${v}% of stored FRUITS rot each night.` },
	{ key: 'rot_vegetables', view: 'world', section: 'Rot', label: 'VEGETABLES', unit: '% a night', min: 0, max: 100, step: 1, value: 15, say: (v) => `${v}% of stored VEGETABLES rot each night.` },
	{ key: 'rot_legumes', view: 'world', section: 'Rot', label: 'LEGUMES', unit: '% a night', min: 0, max: 100, step: 1, value: 5, say: (v) => `${v}% of stored LEGUMES (with nuts and seeds) rot each night.` },
	{ key: 'rot_chicken', view: 'world', section: 'Rot', label: 'CHICKEN', unit: '% a night', min: 0, max: 100, step: 1, value: 30, say: (v) => `${v}% of stored CHICKEN (with eggs) rots each night.` },
	// ---- world: land and production ----
	{ key: 'overWater', view: 'world', section: 'Land and production', label: 'Water over need', unit: '%', min: -50, max: 300, step: 1, value: 10, reset: true, say: (v) => `Wells and rain together give about ${v}% ${v >= 0 ? 'more' : 'less'} WATER than the valley drinks (±5%).` },
	{ key: 'overFood', view: 'world', section: 'Land and production', label: 'Food over need', unit: '%', min: -50, max: 300, step: 1, value: 17, reset: true, say: (v) => `Each food is grown about ${v}% ${v >= 0 ? 'more' : 'less'} than the valley eats (±7%, and a little more for food that rots fast).` },
	{ key: 'uneven', view: 'world', section: 'Land and production', label: 'Unevenness', unit: '0 = even', min: 0, max: 10, step: 0.5, value: 2, reset: true, say: (v) => (v ? `A good's harvest is split unevenly between its growers: at ${v}, the biggest grower can make up to ${Math.round((0.25 + v) / 0.25)}× the smallest.` : 'A good\'s harvest is split evenly between its growers.') },
	{ key: 'oneGood', view: 'world', section: 'Land and production', label: 'Grow one good', unit: '% of avens', min: 0, max: 100, step: 5, value: 30, reset: true, say: (v) => `About ${v}% of avens grow a single good.` },
	{ key: 'threeGoods', view: 'world', section: 'Land and production', label: 'Grow three goods', unit: '% of avens', min: 0, max: 100, step: 5, value: 30, reset: true, say: (v) => `About ${v}% grow three goods; the rest grow two.` },
	{ key: 'growers', view: 'world', section: 'Land and production', label: 'Growers per good', unit: 'at least', min: 1, max: 10, step: 1, value: 2, reset: true, say: (v) => `Every good has at least ${v} grower${v === 1 ? '' : 's'}.` },
	// ---- world: harvests ----
	{ key: 'swing', view: 'world', section: 'Harvests', label: 'Harvest swing', unit: '±%', min: 0, max: 100, step: 1, value: 25, say: (v) => `A normal night's harvest is its land's capacity ±${v}%.` },
	{ key: 'badChance', view: 'world', section: 'Harvests', label: 'Bad harvests', unit: '% of nights', min: 0, max: 100, step: 1, value: 5, say: (v) => `${v}% of nights a field gives a bad harvest (30–60%).` },
	{ key: 'richChance', view: 'world', section: 'Harvests', label: 'Rich harvests', unit: '% of nights', min: 0, max: 100, step: 1, value: 5, say: (v) => `${v}% of nights a field gives a rich harvest (130–160%).` },
	// ---- world: weather ----
	{ key: 'dryChance', view: 'world', section: 'Weather', label: 'Dry spells', unit: '% of nights', min: 0, max: 100, step: 0.5, value: 2.5, say: (v) => (v ? `A dry spell begins about one night in ${Math.round(100 / v)}.` : 'No dry spells.') },
	{ key: 'dryMin', view: 'world', section: 'Weather', label: 'Shortest dry spell', unit: 'days', min: 1, max: 60, step: 1, value: 3, say: (v) => `A dry spell lasts at least ${v} days.` },
	{ key: 'dryMax', view: 'world', section: 'Weather', label: 'Longest dry spell', unit: 'days', min: 1, max: 120, step: 1, value: 7, say: (v) => `A dry spell lasts at most ${v} days.` },
	{ key: 'dryWells', view: 'world', section: 'Weather', label: 'Wells in a dry spell', unit: '%', min: 0, max: 100, step: 5, value: 55, say: (v) => `In a dry spell wells give about ${v}% (±15%) and no rain falls.` },
	{ key: 'rainChance', view: 'world', section: 'Weather', label: 'Rain', unit: '% of nights', min: 0, max: 100, step: 1, value: 33, say: (v) => `It rains ${v}% of the other nights.` },
	{ key: 'rainMax', view: 'world', section: 'Weather', label: 'Rain barrel', unit: 'units', min: 0, max: 20, step: 1, value: 2, say: (v) => `A rainy night fills every land's barrel with 1 to ${v} WATER.` }
];

const n = (/** @type {number} */ v) => v.toLocaleString('en-US');

/** the live values, by key */
export const RULES = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));
export const DEFAULTS = { ...RULES };

/** what one aven needs to eat and drink each day; kept in step with RULES @type {Record<string, number>} */
export const NEED = { water: 3, fruits: 2, vegetables: 2, legumes: 2, chicken: 2 };
/** the share of a stock that rots each night; kept in step with RULES @type {Record<string, number>} */
export const ROT = { water: 0, fruits: 0.25, vegetables: 0.15, legumes: 0.05, chicken: 0.3 };

function sync() {
	NEED.water = RULES.needWater;
	for (const g of ['fruits', 'vegetables', 'legumes', 'chicken']) NEED[g] = RULES.needFood;
	for (const g of Object.keys(ROT)) ROT[g] = RULES[`rot_${g}`] / 100;
}

/** set one rule (clamped to its range) */
export function setRule(key, value) {
	const p = PARAMS.find((q) => q.key === key);
	if (!p || !Number.isFinite(value)) return;
	RULES[key] = Math.min(p.max, Math.max(p.min, value));
	sync();
}

/** set many at once, e.g. from a saved set; unknown keys are ignored */
export function setRules(values) {
	for (const [k, v] of Object.entries(values ?? {})) setRule(k, Number(v));
}

/** back to the defaults */
export function resetRules() {
	setRules(DEFAULTS);
}

/** the rules that differ from their defaults */
export function changedRules() {
	return Object.fromEntries(Object.entries(RULES).filter(([k, v]) => v !== DEFAULTS[k]));
}

sync();
