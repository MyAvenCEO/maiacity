/**
 * SANDBOX 6 · FOOD AND WATER — what a village eats and drinks, in kilograms and litres, and what its hexes grow.
 *
 * The valley's calendar is the master clock's (game/time.ts, game/policy.hearts.json): a month of thirty days, a year
 * of twelve months. Out in maiaCITY a real day is a month, so a year takes twelve real days and a food forest grows
 * full in four real months. The valley runs that calendar faster, ten years in ten minutes of play (at 1×): a year a
 * minute, a month in 5 s, a week in about 1.2 s. Its people still walk at their own pace.
 *
 * Food. A person eats about 10 kg a week, the European diet of our land-use table (vegetables, fruit, legumes, seeds
 * and nuts, eggs, chicken, fish), all counted together in kg. It grows in the hexes: every hex with a house is a food
 * forest round it and a growing dome inside, and it grows a share of what the people living there eat. A tenth in its
 * first year, two tenths in its second, … all of it in its tenth; then more each year, up to half again as much from
 * its fifteenth year on, and so it stays.
 *
 * Until a village grows enough, it buys the rest, by itself: from your villages joined to it by a trade route that
 * have more than they eat (5 gold a kg), and what they cannot spare from the world beyond the valley (10 gold a kg).
 * A village keeps two weeks of food in store; what a store holds beyond a quarter year spoils.
 *
 * Water. A person uses 150 L a day: 3 L to drink, 97 L at home (showering, cooking, washing) and 50 L for the crops
 * of the hex. Wells give it, piped straight to the village's tanks: a well is a borehole giving 2 L a second, enough
 * for about 1,150 people. Tanks hold four weeks.
 *
 * Plain numbers and pure functions: the simulation (./sim.js) calls them, the page shows them.
 */

/** the master clock's calendar: days in a month, months in a year */
export const MONTH_DAYS = 30, YEAR_MONTHS = 12;
/** seconds of play: a year (ten years in ten minutes), a month, a day, a week */
export const YEAR = 60, MONTH = YEAR / YEAR_MONTHS, DAY = MONTH / MONTH_DAYS, WEEK = 7 * DAY;

/** what a person eats a week, kg (the European land-use table) */
export const DIET = { vegetables: 4.62, fruits: 1.4, legumes: 0.7, 'seeds, nuts and oats': 2.15, eggs: 0.42, chicken: 0.2, 'fish and seafood': 0.38 };
/** all of it together: about 10 kg a person a week */
export const FOOD_KG = Object.values(DIET).reduce((a, b) => a + b, 0);

/** what a person uses a day, litres */
export const WATER_USE = { drinking: 3, home: 97, crops: 50 };
/** all of it together: 150 L a person a day */
export const WATER_L = Object.values(WATER_USE).reduce((a, b) => a + b, 0);
/** what a well gives a day: a borehole at 2 L a second */
export const WELL_L = 2 * 86400;

/** what a kg of food costs a village: from another village of yours, or from the world beyond the valley, in gold */
export const PRICE = { village: 5, world: 10 };
/** weeks of food a village keeps in store (it buys up to this), and the most a store holds before the rest spoils */
export const KEEP = 2, MOST = 13;
/** weeks of water a village's tanks hold */
export const TANK = 4;

/**
 * The share of what its people eat that a hex's food forest grows in its nth year (counted from 0 for the first):
 * 10% in the first, 20% in the second, … 100% in the tenth, then up to 150% in the fifteenth, and steady after.
 * @param {number} age years since it was planted
 */
export const forestShare = (age) => Math.min(1.5, 0.1 * (Math.floor(Math.max(0, age)) + 1));

/** the valley's date at a time of play, on the master clock's calendar: its year and its month, from 1 @param {number} t */
export function calendar(t) {
	const year = Math.floor(t / YEAR) + 1;
	return { year, month: Math.floor((t - (year - 1) * YEAR) / MONTH) + 1 };
}
