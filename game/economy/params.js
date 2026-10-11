// @ts-nocheck — plain JS data, kept loose on purpose
// The economy sandbox's (Sandbox 7's) catalogue of parameters: every number the valley runs on, as the policies people
// choose (HEARTS, prices, trading) and the world's own rules (needs, bodies, rot, land, harvests, weather), each with its
// range and a plain sentence; and the config cards a config is made of. Shared by the page (src/lib/sandbox-8) and the
// API, which checks every card a MIP (a MaiaCity improvement proposal) puts in against it.

import { DEFAULT_CODE } from './rules-code.js';

export { DEFAULT_CODE };
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
	// ---- policies: trading ----
	{ key: 'haggleMax', view: 'policy', section: 'Trading', label: 'Haggling', unit: '%', min: 0, max: 100, step: 5, value: 100, say: (v) => (v ? `When prices don't meet, an aven may give in up to ${v}% of its own price.` : 'No haggling: a deal happens only at the seller\'s price.') },
	{ key: 'clearHours', view: 'policy', section: 'Trading', label: 'Market clears every', unit: 'hours', min: 0.25, max: 24, step: 0.25, value: 1, say: (v) => `Every ${v} hour${v === 1 ? '' : 's'} each good's asks and bids are matched, the cheapest seller with the buyer who pays most, while a deal can be struck. There is no market place.` },
	{ key: 'reserveDays', view: 'policy', section: 'Trading', label: 'Starting stock target', unit: 'days', min: 1, max: 14, step: 1, value: 3, reset: true, say: (v) => `Each aven starts out wanting ${v} days of food and water in store (its brain changes this every morning).` },

	// ---- world: the avens ----
	{ key: 'avens', view: 'world', section: 'Avens', label: 'Avens', unit: 'avens', min: 2, max: 10, step: 1, value: 10, reset: true, say: (v) => `${v} avens live in the valley, each on its own land.` },
	{ key: 'startDays', view: 'world', section: 'Avens', label: 'Starting rations', unit: 'days', min: 0, max: 30, step: 1, value: 2, reset: true, say: (v) => `Each aven starts with ${v} days of every need in store, plus its first harvest.` },
	{ key: 'rebirthDays', view: 'world', section: 'Avens', label: 'Rebirth after', unit: 'days', min: 1, max: 120, step: 1, value: 7, say: (v) => `An aven that dies loses everything it held and is reborn ${v} day${v === 1 ? '' : 's'} later on its own land, with the starting HEARTS and nothing in store; its brain remembers.` },
	{ key: 'walk', view: 'world', section: 'Avens', label: 'Walking speed', unit: 'units an hour', min: 20, max: 20000, step: 10, value: 600, say: (v) => `After a deal the buyer walks over to fetch what it bought, at ${n(v)} units an hour (the valley is 1,200 wide), slower when weak. Only a picture: the goods are its as soon as the deal is struck.` },
	// ---- world: needs and bodies ----
	{ key: 'needWater', view: 'world', section: 'Needs and bodies', label: 'Water a day', unit: 'units', min: 0, max: 20, step: 1, value: 3, say: (v) => `Every aven drinks ${v} WATER a night.` },
	{ key: 'needFood', view: 'world', section: 'Needs and bodies', label: 'Each food a day', unit: 'units', min: 0, max: 20, step: 1, value: 2, say: (v) => `Every aven eats ${v} each of FRUITS, VEGETABLES, LEGUMES and CHICKEN a night.` },
	{ key: 'waterDays', view: 'world', section: 'Needs and bodies', label: 'Days without water', unit: 'days', min: 0, max: 30, step: 1, value: 2, say: (v) => `With no water at all an aven lives through ${v} day${v === 1 ? '' : 's'} and dies the next.` },
	{ key: 'foodDays', view: 'world', section: 'Needs and bodies', label: 'Days without food', unit: 'days', min: 0, max: 120, step: 1, value: 21, say: (v) => `With no food at all an aven lives ${v} days.` },
	{ key: 'mendWater', view: 'world', section: 'Needs and bodies', label: 'Water recovery', unit: 'points a night', min: 0, max: 100, step: 1, value: 34, say: (v) => `A night with all its water refills the water reserve by ${v} of 100.` },
	{ key: 'healthMax', view: 'world', section: 'Needs and bodies', label: 'Health', unit: 'points', min: 1, max: 100, step: 1, value: 100, say: (v) => `Health runs from ${v} down to 0, where an aven dies; it is the lower of the two reserves unless the body rule keeps its own.` },
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
	// ---- world: fields (Samuel, 2026-10-10: every aven an entrepreneur: what it grows, and how much, is its own decision) ----
	{ key: 'fieldsOn', view: 'world', section: 'Fields', label: 'Own fields', unit: '0 = off, 1 = on', min: 0, max: 1, step: 1, value: 0, reset: true, say: (v) => (v ? 'Every aven farms its own fields: it starts with none and decides which to open and what to plant, which field to level up and which crop to change, paying the Maia City Coop for each.' : 'The land decides what each aven grows (no fields of its own).') },
	{ key: 'field1', view: 'world', section: 'Fields', label: 'A first field', unit: 'HEARTS', min: 0, max: 100000, step: 10, value: 300, say: (v) => `Every aven starts without a field: opening its first costs ${n(v)} HEARTS, paid to the Maia City Coop.` },
	{ key: 'field2', view: 'world', section: 'Fields', label: 'A second field', unit: 'HEARTS', min: 0, max: 100000, step: 10, value: 800, say: (v) => `Opening a second field costs ${n(v)} HEARTS, paid to the Maia City Coop.` },
	{ key: 'field3', view: 'world', section: 'Fields', label: 'A third field', unit: 'HEARTS', min: 0, max: 100000, step: 10, value: 1500, say: (v) => `Opening a third field costs ${n(v)} HEARTS, paid to the Maia City Coop.` },
	{ key: 'plotSpread', view: 'world', section: 'Fields', label: 'Plots differ by', unit: '± %', min: 0, max: 100, step: 1, value: 15, reset: true, say: (v) => (v ? `Each aven's three plots are dealt their own price, up to ${v}% above or below, and what a field costs to open also depends on its crop (as dear as levelling that crop up).` : 'Every plot costs the same to open, whatever its crop.') },
	{ key: 'level2', view: 'world', section: 'Fields', label: 'Level 2 yields', unit: '% of level 1', min: 100, max: 500, step: 5, value: 130, say: (v) => `A field at level 2 yields ${v}% of what it does at level 1.` },
	{ key: 'level3', view: 'world', section: 'Fields', label: 'Level 3 yields', unit: '% of level 1', min: 100, max: 500, step: 5, value: 160, say: (v) => `A field at level 3 yields ${v}% of what it does at level 1.` },
	{ key: 'holdDays', view: 'world', section: 'Fields', label: 'A crop is kept at least', unit: 'days', min: 0, max: 120, step: 1, value: 0, say: (v) => (v ? `A crop, once planted, stays in its field at least ${v} days before it can be changed.` : 'A field\'s crop can be changed any time.') },
	{ key: 'fieldEvery', view: 'world', section: 'Fields', label: 'Field decisions every', unit: 'days', min: 0, max: 30, step: 0.5, value: 0, say: (v) => (v ? `An aven decides about its fields at most once every ${v} days.` : 'An aven may decide about its fields on any full ask.') },
	{ key: 'fieldReserve', view: 'world', section: 'Fields', label: 'Keep for food', unit: 'days', min: 0, max: 60, step: 1, value: 0, say: (v) => (v ? `An aven can only open or level up a field if it still has ${v} days of the food it buys left in HEARTS afterwards.` : 'An aven may spend its last HEARTS on fields.') },
	{ key: 'fieldHorizon', view: 'world', section: 'Fields', label: 'Field options reckoned over', unit: 'days', min: 7, max: 120, step: 1, value: 14, say: (v) => `Every field option is reckoned over the next ${v} days: what it yields while it grows and after, what it costs to keep, and what it costs now, with the days it takes to pay back.` },
	{ key: 'fieldStart', view: 'world', section: 'Fields', label: 'Start with a field', unit: '0 = no, 1 = yes, 2 = yes, paid', min: 0, max: 2, step: 1, value: 0, reset: true, say: (v) => (v ? `Every aven starts with one field already grown, at level 1: the crops dealt in turn round the valley, so each good is grown on two avens' land from day 1${v === 2 ? '; each pays its price (as opening a first field of its crop on its plot) to the Maia City Coop as the world begins' : ''}.` : 'Every aven starts without a field.') },
	{ key: 'fieldChange', view: 'world', section: 'Fields', label: 'Changing a crop costs', unit: '0 = nothing, 1 = as opening the field', min: 0, max: 1, step: 1, value: 0, say: (v) => (v ? "Changing a field's crop costs as much as opening that field with the new crop, paid to the Maia City Coop." : "Changing a field's crop costs nothing (it starts again at level 1).") },
	{ key: 'fieldTurn', view: 'world', section: 'Fields', label: 'Fields decided', unit: '0 = all at once, 1 = one a turn', min: 0, max: 1, step: 1, value: 0, say: (v) => (v ? 'An aven decides about one of its fields a turn, each in turn, seeing the moves made since.' : 'An aven decides about all its fields at once.') },
	{ key: 'fieldPriceDays', view: 'world', section: 'Fields', label: 'Field options priced on', unit: 'days of average (0 = today)', min: 0, max: 60, step: 1, value: 0, say: (v) => (v ? `Field options are reckoned on each crop's average market price over the last ${v} days (today's shown beside it).` : "Field options are reckoned on today's price.") },
	{ key: 'postedShown', view: 'world', section: 'Trading', label: 'Price shown and kept', unit: '0 = last traded, 1 = posted', min: 0, max: 1, step: 1, value: 0, say: (v) => (v ? 'Where a good has a posted price, that is its price everywhere: on the board, in the charts, in its history and to the brains, traded or not.' : 'A good\'s price is its last traded one (a good nobody sells keeps the last price it traded at).') },
	{ key: 'fieldClose', view: 'world', section: 'Fields', label: 'Fields can be closed', unit: '0 = no, 1 = yes', min: 0, max: 1, step: 1, value: 0, say: (v) => (v ? 'An aven can close a field: its keep stops, and the land can be opened again later at the price of opening it.' : 'A field, once opened, is kept for good.') },
	{ key: 'fieldLevels', view: 'world', section: 'Fields', label: 'Fields can be levelled up', unit: '0 = no, 1 = yes', min: 0, max: 1, step: 1, value: 1, say: (v) => (v ? 'A field can be levelled up to 2 and 3 (capex2/3, more keep, more yield).' : 'Fields stay at level 1.') },
	{ key: 'fieldCash', view: 'world', section: 'Fields', label: 'Field options as cash-flow plans', unit: '0 = no, 1 = yes, 2 = yes, closing and waiting too', min: 0, max: 2, step: 1, value: 0, say: (v) => (v ? `Whatever the forecast, every field option is also reckoned as a cash-flow plan, day by day: what the aven holds, pays now, buys as food each day at today's prices once its stores run out, and what its fields bring in and cost. It says how low its HEARTS would fall, when the option is earned back and whether it would run out of money for food before it pays (an option that starves it counts as losing all it holds)${v >= 2 ? '. Closing a field and not opening one are reckoned the same way: their net counts the food the aven could not buy, so closing the field that feeds it shows what it costs' : ''}; the market shows each crop's harvest over the last week against its need.` : 'Field options are reckoned by the forecast alone.') },
	{ key: 'coopShare', view: 'world', section: 'Fields', label: 'COOP pays its members', unit: '% of its balance a night', min: 0, max: 100, step: 0.5, value: 0, say: (v) => (v ? `Each night the Maia City Coop pays ${v}% of what it holds back to the living avens, in equal shares.` : 'The Maia City Coop keeps what it is paid (money only flows in).') },
	{ key: 'forecast', view: 'world', section: 'Fields', label: 'Field forecast', unit: '0 = need ÷ fields, 1 = supply after its own move, 2 = the valley\'s balance, 3 = 1 with 2\'s information, 4 = only what the valley lacks, 5 = 4 on real harvests, with what it eats, 6 = 5 with a cash-flow plan and the harvest trend', min: 0, max: 6, step: 1, value: 0, say: (v) => (v === 6 ? "As 5, and every option is reckoned as a cash-flow plan, day by day: what the aven holds, what it pays now, the food it buys each day at today's prices (after its stores), its fields' income and keep. Each option says how low its HEARTS would fall, when it is earned back, and whether it would run out of money for food before it pays (and what that costs its health); the market shows each crop's harvest over the last week against its need." : v === 5 ? "A field option earns today's posted price on what the valley will really lack (its need against what it actually harvested lately, plus the others' fields still growing) or on what the aven eats of it itself, whichever is more; the rest is worth nothing. With forecast 2's information." : v === 4 ? "A field option earns today's posted price only on the units the valley will still lack once every other planted field has grown: what it grows beyond the valley's need is worth nothing, since nobody eats more than they need. Each option shows that, with forecast 2's information." : v === 3 ? "A field option is priced at its own crop's posted price, moved by how far the valley's supply of it changes until its fields have grown, the option itself counted; each option shows the coverage it leaves, the aven sees what its own last field moves earned against keeping, and what the valley did with its fields in the last day." : v === 2 ? "A field option is priced at the market's price level, shaped by how much of each crop the valley will grow against what it needs once every planted field and the option itself have grown; each option shows that coverage, the aven sees what its own last field moves earned against keeping, and what the valley did with its fields in the last day." : v ? "A field option is priced at today's price, moved by how far the valley's supply changes until its fields have grown, the option itself counted: today's price already holds today's shortage." : "A field option is priced at today's price scaled by how far the valley's planted fields fall short of its need (or outgrow it), from a quarter to four times.") },
	{ key: 'fieldLevel', view: 'world', section: 'Fields', label: 'Field forecast 2 valued at', unit: '0 = the middle price, 1 = what the valley spends', min: 0, max: 1, step: 1, value: 0, say: (v) => (v ? 'Field forecast 2 values a unit at what the valley actually spent on goods over the last day, per unit it needs a day (before its first trade, a day\'s minting per unit of a day\'s needs): a level that falls only if the valley stops buying, not when a few goods sit at the price floor.' : 'Field forecast 2 values a unit at the middle of the goods\' prices today.') },
	{ key: 'levelDays', view: 'world', section: 'Fields', label: 'A level-up grows in', unit: 'days', min: 0, max: 60, step: 1, value: 3, say: (v) => `A field levelled up reaches its new yield over ${v} days.` },
	// WATER: a well: quick to dig, plenty of units, cheap to keep
	{ key: 'cap_water', view: 'world', section: 'Fields', label: 'A WATER field', unit: 'units a day at level 1', min: 0, max: 200, step: 0.5, value: 12, reset: true, say: (v) => `A WATER field gives about ${v} a day at level 1.` },
	{ key: 'ramp_water', view: 'world', section: 'Fields', label: 'WATER grows in', unit: 'days', min: 0, max: 90, step: 1, value: 2, say: (v) => `WATER planted (or changed to) takes ${v} days to give its full yield.` },
	{ key: 'capex2_water', view: 'world', section: 'Fields', label: 'WATER to level 2', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 250, say: (v) => `Levelling a WATER field up to 2 costs ${n(v)} HEARTS.` },
	{ key: 'capex3_water', view: 'world', section: 'Fields', label: 'WATER to level 3', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 600, say: (v) => `Levelling a WATER field up to 3 costs ${n(v)} HEARTS.` },
	{ key: 'opex1_water', view: 'world', section: 'Fields', label: 'WATER at level 1', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 1, say: (v) => `A WATER field at level 1 costs ${v} HEARTS a night.` },
	{ key: 'opex2_water', view: 'world', section: 'Fields', label: 'WATER at level 2', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 4, say: (v) => `A WATER field at level 2 costs ${v} HEARTS a night.` },
	{ key: 'opex3_water', view: 'world', section: 'Fields', label: 'WATER at level 3', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 8, say: (v) => `A WATER field at level 3 costs ${v} HEARTS a night.` },
	// FRUITS: an orchard: slow to grow, rots fast
	{ key: 'cap_fruits', view: 'world', section: 'Fields', label: 'A FRUITS field', unit: 'units a day at level 1', min: 0, max: 200, step: 0.5, value: 9.5, reset: true, say: (v) => `A FRUITS field gives about ${v} a day at level 1.` },
	{ key: 'ramp_fruits', view: 'world', section: 'Fields', label: 'FRUITS grows in', unit: 'days', min: 0, max: 90, step: 1, value: 7, say: (v) => `FRUITS planted (or changed to) takes ${v} days to give its full yield.` },
	{ key: 'capex2_fruits', view: 'world', section: 'Fields', label: 'FRUITS to level 2', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 350, say: (v) => `Levelling a FRUITS field up to 2 costs ${n(v)} HEARTS.` },
	{ key: 'capex3_fruits', view: 'world', section: 'Fields', label: 'FRUITS to level 3', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 800, say: (v) => `Levelling a FRUITS field up to 3 costs ${n(v)} HEARTS.` },
	{ key: 'opex1_fruits', view: 'world', section: 'Fields', label: 'FRUITS at level 1', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 2, say: (v) => `A FRUITS field at level 1 costs ${v} HEARTS a night.` },
	{ key: 'opex2_fruits', view: 'world', section: 'Fields', label: 'FRUITS at level 2', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 5, say: (v) => `A FRUITS field at level 2 costs ${v} HEARTS a night.` },
	{ key: 'opex3_fruits', view: 'world', section: 'Fields', label: 'FRUITS at level 3', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 10, say: (v) => `A FRUITS field at level 3 costs ${v} HEARTS a night.` },
	// VEGETABLES: a garden: a season to grow
	{ key: 'cap_vegetables', view: 'world', section: 'Fields', label: 'A VEGETABLES field', unit: 'units a day at level 1', min: 0, max: 200, step: 0.5, value: 10, reset: true, say: (v) => `A VEGETABLES field gives about ${v} a day at level 1.` },
	{ key: 'ramp_vegetables', view: 'world', section: 'Fields', label: 'VEGETABLES grows in', unit: 'days', min: 0, max: 90, step: 1, value: 4, say: (v) => `VEGETABLES planted (or changed to) takes ${v} days to give its full yield.` },
	{ key: 'capex2_vegetables', view: 'world', section: 'Fields', label: 'VEGETABLES to level 2', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 300, say: (v) => `Levelling a VEGETABLES field up to 2 costs ${n(v)} HEARTS.` },
	{ key: 'capex3_vegetables', view: 'world', section: 'Fields', label: 'VEGETABLES to level 3', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 700, say: (v) => `Levelling a VEGETABLES field up to 3 costs ${n(v)} HEARTS.` },
	{ key: 'opex1_vegetables', view: 'world', section: 'Fields', label: 'VEGETABLES at level 1', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 2, say: (v) => `A VEGETABLES field at level 1 costs ${v} HEARTS a night.` },
	{ key: 'opex2_vegetables', view: 'world', section: 'Fields', label: 'VEGETABLES at level 2', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 5, say: (v) => `A VEGETABLES field at level 2 costs ${v} HEARTS a night.` },
	{ key: 'opex3_vegetables', view: 'world', section: 'Fields', label: 'VEGETABLES at level 3', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 9, say: (v) => `A VEGETABLES field at level 3 costs ${v} HEARTS a night.` },
	// LEGUMES: a field of pulses: they keep, cheap to farm
	{ key: 'cap_legumes', view: 'world', section: 'Fields', label: 'A LEGUMES field', unit: 'units a day at level 1', min: 0, max: 200, step: 0.5, value: 9.5, reset: true, say: (v) => `A LEGUMES field gives about ${v} a day at level 1.` },
	{ key: 'ramp_legumes', view: 'world', section: 'Fields', label: 'LEGUMES grows in', unit: 'days', min: 0, max: 90, step: 1, value: 5, say: (v) => `LEGUMES planted (or changed to) takes ${v} days to give its full yield.` },
	{ key: 'capex2_legumes', view: 'world', section: 'Fields', label: 'LEGUMES to level 2', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 250, say: (v) => `Levelling a LEGUMES field up to 2 costs ${n(v)} HEARTS.` },
	{ key: 'capex3_legumes', view: 'world', section: 'Fields', label: 'LEGUMES to level 3', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 600, say: (v) => `Levelling a LEGUMES field up to 3 costs ${n(v)} HEARTS.` },
	{ key: 'opex1_legumes', view: 'world', section: 'Fields', label: 'LEGUMES at level 1', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 1, say: (v) => `A LEGUMES field at level 1 costs ${v} HEARTS a night.` },
	{ key: 'opex2_legumes', view: 'world', section: 'Fields', label: 'LEGUMES at level 2', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 3, say: (v) => `A LEGUMES field at level 2 costs ${v} HEARTS a night.` },
	{ key: 'opex3_legumes', view: 'world', section: 'Fields', label: 'LEGUMES at level 3', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 7, say: (v) => `A LEGUMES field at level 3 costs ${v} HEARTS a night.` },
	// CHICKEN: a coop: feed costs most, few units, rots fastest
	{ key: 'cap_chicken', view: 'world', section: 'Fields', label: 'A CHICKEN field', unit: 'units a day at level 1', min: 0, max: 200, step: 0.5, value: 9, reset: true, say: (v) => `A CHICKEN field gives about ${v} a day at level 1.` },
	{ key: 'ramp_chicken', view: 'world', section: 'Fields', label: 'CHICKEN grows in', unit: 'days', min: 0, max: 90, step: 1, value: 5, say: (v) => `CHICKEN planted (or changed to) takes ${v} days to give its full yield.` },
	{ key: 'capex2_chicken', view: 'world', section: 'Fields', label: 'CHICKEN to level 2', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 400, say: (v) => `Levelling a CHICKEN field up to 2 costs ${n(v)} HEARTS.` },
	{ key: 'capex3_chicken', view: 'world', section: 'Fields', label: 'CHICKEN to level 3', unit: 'HEARTS once', min: 0, max: 100000, step: 10, value: 900, say: (v) => `Levelling a CHICKEN field up to 3 costs ${n(v)} HEARTS.` },
	{ key: 'opex1_chicken', view: 'world', section: 'Fields', label: 'CHICKEN at level 1', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 2, say: (v) => `A CHICKEN field at level 1 costs ${v} HEARTS a night.` },
	{ key: 'opex2_chicken', view: 'world', section: 'Fields', label: 'CHICKEN at level 2', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 6, say: (v) => `A CHICKEN field at level 2 costs ${v} HEARTS a night.` },
	{ key: 'opex3_chicken', view: 'world', section: 'Fields', label: 'CHICKEN at level 3', unit: 'HEARTS a night', min: 0, max: 10000, step: 1, value: 11, say: (v) => `A CHICKEN field at level 3 costs ${v} HEARTS a night.` },
	// ---- world: weather ----
	{ key: 'dryChance', view: 'world', section: 'Weather', label: 'Dry spells', unit: '% of nights', min: 0, max: 100, step: 0.5, value: 2.5, say: (v) => (v ? `A dry spell begins about one night in ${Math.round(100 / v)}.` : 'No dry spells.') },
	{ key: 'dryMin', view: 'world', section: 'Weather', label: 'Shortest dry spell', unit: 'days', min: 1, max: 60, step: 1, value: 3, say: (v) => `A dry spell lasts at least ${v} days.` },
	{ key: 'dryMax', view: 'world', section: 'Weather', label: 'Longest dry spell', unit: 'days', min: 1, max: 120, step: 1, value: 7, say: (v) => `A dry spell lasts at most ${v} days.` },
	{ key: 'dryWells', view: 'world', section: 'Weather', label: 'Wells in a dry spell', unit: '%', min: 0, max: 100, step: 5, value: 55, say: (v) => `In a dry spell wells give about ${v}% (±15%) and no rain falls.` },
	{ key: 'rainChance', view: 'world', section: 'Weather', label: 'Rain', unit: '% of nights', min: 0, max: 100, step: 1, value: 33, say: (v) => `It rains ${v}% of the other nights.` },
	{ key: 'rainMax', view: 'world', section: 'Weather', label: 'Rain barrel', unit: 'units', min: 0, max: 20, step: 1, value: 2, say: (v) => `A rainy night fills every land's barrel with 1 to ${v} WATER.` }
];

function n(/** @type {number} */ v) {
	return v.toLocaleString('en-US');
}

/** the catalogue's default values, by key */
export const DEFAULT_PARAMS = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));

/** a value for a key, checked against its range: the clamped number, or null when the key is unknown or not a number */
export function checkParam(key, value) {
	const p = PARAMS.find((q) => q.key === key);
	const v = Number(value);
	if (!p || value === null || value === '' || !Number.isFinite(v)) return null;
	return Math.min(p.max, Math.max(p.min, v));
}

// ─────────────────────────────── config cards ───────────────────────────────
// A config is a list of cards, and a MIP proposes cards. A policy or world card holds the values of one section of the
// catalogue and the code of its rules (rules-code.js: the default when the card has none of its own); resource and
// recipe cards hold their JSON. A MIP's card is always complete, so accepting it puts it into the config as it stands.

export const CARD_KINDS = ['policy', 'world', 'resource', 'recipe'];

/** the catalogue's sections, each one card: its id, kind and name */
export const SECTIONS = [
	{ id: 'hearts', kind: 'policy', name: 'HEARTS' },
	{ id: 'trading', kind: 'policy', name: 'Trading' },
	{ id: 'brains', kind: 'policy', name: 'Brains' },
	{ id: 'avens', kind: 'world', name: 'Avens' },
	{ id: 'bodies', kind: 'world', name: 'Needs and bodies' },
	{ id: 'rot', kind: 'world', name: 'Rot' },
	{ id: 'land', kind: 'world', name: 'Land and production' },
	{ id: 'harvests', kind: 'world', name: 'Harvests' },
	{ id: 'weather', kind: 'world', name: 'Weather' },
	{ id: 'fields', kind: 'world', name: 'Fields' }
];
/** which card a param belongs to */
export const CARD_OF = Object.fromEntries(PARAMS.map((p) => [p.key, SECTIONS.find((s) => s.name === p.section)?.id]));

/** the catalogue as cards, with its default values and the code of its rules */
export function defaultCards() {
	return SECTIONS.map((s) => ({ ...s, description: '', values: Object.fromEntries(PARAMS.filter((p) => CARD_OF[p.key] === s.id).map((p) => [p.key, p.value])), code: DEFAULT_CODE[s.id] ?? '' }));
}

/** a section card's code as it runs: its own, else its rules' default (rules-code.js) */
export const codeOf = (card) => (card?.code?.trim() ? card.code : (DEFAULT_CODE[card?.id] ?? ''));
/** a config's cards with every rule written out: each section card without code of its own gets its default, and a
 * section the config lacks is added, so a world keeps its whole rulebook with it */
export function fullCards(cards) {
	const out = (cards ?? []).map((c) => (SECTIONS.some((s) => s.id === c.id) && !c.code?.trim() ? { ...c, code: DEFAULT_CODE[c.id] ?? '' } : c));
	for (const d of defaultCards()) if (!out.some((c) => c.id === d.id)) out.push({ ...d, values: {} });
	return out;
}

/** every value a config's cards hold, the catalogue's default where none does */
export function paramsOf(cards) {
	const out = { ...DEFAULT_PARAMS };
	for (const c of cards ?? []) for (const [k, v] of Object.entries(c?.values ?? {})) if (k in out && Number.isFinite(Number(v))) out[k] = Number(v);
	return out;
}

const CARD_ID = /^[a-z][a-z0-9_-]{1,40}$/;
const MAX_CODE = 20000;
const MAX_DATA = 50000;

/**
 * One card, checked and cleaned: { card } or { error } in a sentence. Values are checked against the catalogue (and
 * clamped to their range); code is kept as text (it runs only in the QuickJS sandbox, never on the server).
 */
export function checkCard(raw) {
	const id = String(raw?.id ?? '').trim();
	if (!CARD_ID.test(id)) return { error: `A card's id is lowercase letters, digits, - and _, 2 to 41 long (got "${id}").` };
	const kind = raw?.kind;
	if (!CARD_KINDS.includes(kind)) return { error: `Card ${id}: its kind is one of ${CARD_KINDS.join(', ')}.` };
	const name = String(raw?.name ?? '').trim().slice(0, 80) || id;
	const description = String(raw?.description ?? '').trim().slice(0, 4000);
	const values = {};
	for (const [k, v] of Object.entries(raw?.values ?? {})) {
		const ok = checkParam(k, v);
		if (ok == null) return { error: `Card ${id}: ${k} is not a value the valley has (or ${JSON.stringify(v)} is not a number).` };
		values[k] = ok;
	}
	const data = raw?.data == null ? undefined : raw.data;
	if (data !== undefined && (typeof data !== 'object' || JSON.stringify(data).length > MAX_DATA)) return { error: `Card ${id}: its data is a JSON object of at most ${MAX_DATA} characters.` };
	const code = String(raw?.code ?? '');
	if (code.length > MAX_CODE) return { error: `Card ${id}: its code is at most ${MAX_CODE} characters.` };
	return { card: { id, kind, name, description, values, ...(data !== undefined ? { data } : {}), code } };
}

/** a config's cards after a MIP: each card put in replaces the one with its id (or joins at the end), removed ones go */
export function applyCards(cards, put = [], remove = []) {
	const out = (cards ?? []).filter((c) => !remove.includes(c.id)).map((c) => put.find((p) => p.id === c.id) ?? c);
	for (const p of put) if (!out.some((c) => c.id === p.id)) out.push(p);
	return out;
}

// ─────────────────────────────── card code ───────────────────────────────
// A card's code is JavaScript run in the page's QuickJS sandbox (src/lib/sandbox-8/sandbox.js): no page, no network,
// no keys, 8 MB and a few milliseconds a call. It exports hooks, named below; the valley calls each one at its moment
// with one argument: what the hook names, `valley` ({ day, values, weather, prices, avens, ... }) and `value`, what an
// earlier card's hook made of it (the section card that owns a rule runs first; its own code, else the default in
// rules-code.js). A hook returns plain JSON, which the valley checks and keeps within bounds.

/** the hooks a card's code may export: which card owns it, when it runs, what it is given, and what it returns */
export const HOOKS = [
	{ name: 'mint', card: 'hearts', when: 'each night, for each living aven', given: '{ aven, valley, value }', returns: 'the HEARTS this aven is given tonight' },
	{ name: 'decay', card: 'hearts', when: 'each night, for each aven', given: '{ aven, valley, value }', returns: 'the HEARTS this aven loses tonight, at most what it holds' },
	{ name: 'want', card: 'trading', when: 'whenever the market looks, for each aven and good', given: '{ aven, good, valley, value }', returns: 'the units it wants to buy, whole' },
	{ name: 'spare', card: 'trading', when: 'whenever the market looks, for each aven and good', given: '{ aven, good, valley, value }', returns: 'the units it can sell, whole, at most its stock' },
	{ name: 'haggle', card: 'trading', when: "when a seller's price and a buyer's limit meet in the book", given: '{ good, ask, bid, sellerFlex, buyerFlex, valley, value }', returns: 'the price of the deal in HEARTS, or null: no deal' },
	{ name: 'match', card: 'trading', when: 'each time the market clears, for each good, again and again until it answers null', given: '{ good, sellers, buyers (each { id, name, price, qty, flex, hearts }, in no order), valley, value }', returns: '{ seller, buyer } (ids): the next two to strike a deal, or null: the round ends for this good' },
	{ name: 'price', card: 'trading', when: 'each time the market clears, once for each good, after its trades (only where the Trading card exports it: the market then clears at a posted price)', given: '{ good, price (the posted price it cleared at; null before the first round), inherited (on the first call, price null: the good\'s last price in the world this one follows, else null), previous (on the first call: every good\'s last price there, for its relative prices; else null), prices (every good\'s posted price as this round began: the whole price level), opening (true in the day\'s first round, when the night\'s harvest is all on offer and nothing of it traded yet), demand (units wanted at it), need (the part of demand buyers need to live through tomorrow, filled first), supply (units offered at it), traded, valley, value }', returns: 'the posted price for the next round, in HEARTS (above 0): everyone trades at it, the long side shared out pro rata; demand above supply should raise it, supply above demand lower it' },
	{ name: 'capex', card: 'fields', when: 'when an aven levels a field up', given: '{ good, level (the level it goes to: 2 or 3), valley, value }', returns: 'what it costs, in HEARTS (paid to the Maia City Coop)' },
	{ name: 'opex', card: 'fields', when: 'each night, for each field', given: '{ good, level, valley, value }', returns: 'what the field costs that night, in HEARTS (paid to the Maia City Coop); a field its aven can\'t pay for gives nothing that night' },
	{ name: 'rebirth', card: 'avens', when: 'each morning, for each dead aven', given: '{ aven, dead (days since it died), valley, value }', returns: 'the HEARTS it is reborn with now, or -1: not yet' },
	{ name: 'need', card: 'bodies', when: 'each night, for each aven and good', given: '{ aven, good, valley, value }', returns: 'the units it eats or drinks tonight, whole' },
	{ name: 'body', card: 'bodies', when: 'each night, for each living aven, after it ate', given: '{ aven, need, short, valley, value }', returns: '{ water, food }: its two reserves, 0-100, and if it keeps its own, health (0 to healthMax, else the lower reserve, scaled) and memo (a small object, handed back as aven.memo the next night); at 0 in any of them it dies' },
	{ name: 'rot', card: 'rot', when: 'each night, for each aven and good', given: '{ aven, good, dice, valley, value }', returns: 'the units of the good that rot tonight, whole, at most its stock' },
	{ name: 'harvest', card: 'harvests', when: 'each morning, for each good an aven grows', given: '{ aven, good, capacity, dice, valley, value }', returns: '{ qty, kind } (kind: normal, bad, rich or dry), or a number of units' },
	{ name: 'weather', card: 'weather', when: 'each night, once for the valley', given: '{ weather, day, dice, valley, value }', returns: '{ dry (days of dry spell left), dryFrom, rain (units each barrel catches) }' },
	{ name: 'events', card: 'avens', when: 'each night, once for the valley, after the weather', given: '{ valley, value (the events earlier cards posted) }', returns: "the night's events for the activity feed: value with yours added, each { kind (a word), aven? (its name), changes: [a sentence, or { label, to, from?, unit? }], meta? (a small object) }, at most 20" },
	{ name: 'see', card: 'brains', when: 'each time an aven decides, before its brain is asked', given: '{ aven, day, weather, market, history (last 7 days), others, brain (its character, wants, trials, lessons, deaths), valley, value }', returns: 'the state its brain decides on: one JSON object' },
	{ name: 'ask', card: 'brains', when: 'each time an aven decides', given: '{ aven, day, full, anchors (per good: side, mine (its price as the day began), market, afford; older worlds anchor on these), market, wants, spares, character, valley, value }', returns: '{ ask_<good> (goods it grows), bid_<good> (goods it buys), flex?, and any decision of its own (a lowercase key, at most 8: its answer is kept as aven.choices[key], read by every hook) }: each { type: score or number (a number: a brain that writes numbers, Qwen, names any value; a decision model, d1, picks on criteria and levels as for a score; not for flex), instructions, criteria (2-10), levels (the price, or the share it gives in, each option stands for), label? (what the answer sets, as the activity feed says it, e.g. lowest it accepts for WATER), unit? }' },
	{ name: 'prompt', card: 'brains', when: 'each time a chat model (Qwen) is asked for an aven', given: '{ aven, valley, value }', returns: 'what the model is told first, a text' },
	{ name: 'traits', card: 'brains', when: 'when a world opens, and whenever its values change', given: '{ valley, value }', returns: "{ dials: [{ key, label, low, high, min, max }] (its character, at most 8), wants: [{ key, label, unit, min, max }] (what it keeps in stock, at most 6), score: what its trials optimise, a sentence }: the page shows every brain from this, its trials change only these, and only these reach the ask hook's character" },
	{ name: 'score', card: 'brains', when: "each night, for each living aven's trial", given: '{ aven, gained (HEARTS since last night), short (units it went without), valley, value }', returns: 'the day\'s score: its trials keep a change only if the score goes up' }
];
export const HOOK_NAMES = HOOKS.map((h) => h.name);
