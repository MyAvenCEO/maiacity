/**
 * SANDBOX 6 · FOOD AND WATER — what a village eats and drinks, in kilograms and litres, and what its hexes grow.
 *
 * The valley's calendar is the master clock's (game/time.ts, game/policy.hearts.json): a month of thirty days, a year
 * of twelve months, and at 1× it runs as fast: a real day is a month, a year takes twelve real days (a day 48 min, a
 * week about 5.6 h), so a food forest grows full in four real months. Faster, a real day is a year (12×) or ten
 * years (120×), and everything in the valley, its people's walking too, runs that much faster with it (SPEEDS).
 *
 * Food. A person eats about 10 kg a week, the European diet of our land-use table (vegetables, fruit, legumes, seeds
 * and nuts, eggs, chicken, fish), all counted together in kg. It grows in the hexes: every hex with a house is a food
 * forest round it and a growing dome inside, and it grows a share of what the people living there eat. A tenth in its
 * first year, two tenths in its second, … all of it in its tenth; then more each year, up to half again as much from
 * its fifteenth year on, and so it stays.
 *
 * Until a village grows enough, it buys the rest as its people eat it, by itself: from your villages joined to it by a
 * trade route that have more than two weeks put by (5 € a kg), and what they cannot spare from the world market
 * (10 € a kg: 100 € for a person's week, a tenth of a gold). What its forests grow beyond what its people eat goes
 * into its store; what a store holds beyond a quarter year spoils.
 *
 * Water. A person uses 150 L a day: 3 L to drink, 97 L at home (showering, cooking, washing) and 50 L for the crops
 * of the hex. The crops' 50 L are the home's greywater, cleaned in the hex's reed beds and used again, so a village
 * needs 100 L of fresh water a person a day. Rain gives it: every dome's roof catches what falls on it into its
 * village's tanks. A great dome of 150 m roofs about 71 m² for each of its 248 beds, and 800 mm a year (as round
 * Munich), nine tenths of it caught, give a bed about 140 L a day: half again what it needs over a year, more in the
 * wet summer and less in the dry winter, when its tanks, four weeks of it, carry it through. Where they run dry, a
 * village buys what its rain does not give from the world market as its people use it (2 € a m³).
 *
 * Plain numbers and pure functions: the simulation (./sim.js) calls them, the page shows them.
 */

/** the master clock's calendar, in days: a day, a week, a month of thirty days, a year of twelve months */
export const DAY = 1, WEEK = 7 * DAY, MONTH_DAYS = 30, YEAR_MONTHS = 12, MONTH = MONTH_DAYS * DAY, YEAR = YEAR_MONTHS * MONTH;
/** how fast the valley's calendar runs, days a second of play at 1×: the master clock's, a day in 48 real minutes
 * (game/time.ts) */
export const PACE = 1 / 2880;
/** the simulation's pace, play seconds a real second: ten years in ten real minutes, a year a real minute */
export const SIM_SPEED = YEAR / 60 / PACE;
/** the clock's speeds: how much of the calendar a real day holds */
export const SPEEDS = [
	{ s: 1, short: '1 mo', about: 'a month a real day, the master clock' },
	{ s: 12, short: '1 yr', about: 'a year a real day' },
	{ s: 120, short: '10 yr', about: 'ten years a real day' }
];

/** what a person eats a week, kg (the European land-use table) */
export const DIET = { vegetables: 4.62, fruits: 1.4, legumes: 0.7, 'seeds, nuts and oats': 2.15, eggs: 0.42, chicken: 0.2, 'fish and seafood': 0.38 };
/** all of it together: about 10 kg a person a week */
export const FOOD_KG = Object.values(DIET).reduce((a, b) => a + b, 0);

/** what a person uses a day, litres */
export const WATER_USE = { drinking: 3, home: 97, crops: 50 };
/** all of it together: 150 L a person a day */
export const WATER_L = Object.values(WATER_USE).reduce((a, b) => a + b, 0);
/** what a person needs a day of fresh water, litres: all of it but the crops', which take the home's greywater again */
export const FRESH_L = WATER_L - WATER_USE.crops;
/** rain a year, mm (round Munich), and the share of it a dome's roof catches into its tanks */
export const RAIN_MM = 800, CATCH = 0.9;
/** the roof each bed has, m²: a great dome of 150 m over its 248 beds */
export const ROOF_BED = (Math.PI * 75 ** 2) / 248;
/** what a bed's roof catches a day, litres, over a year: about 140 L */
export const RAIN_L = (ROOF_BED * RAIN_MM * CATCH) / YEAR;
/** the months' names: the valley's year starts in January */
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** how much of a year's average rain falls in each month, January first (Munich: dry winters, wet summers) */
export const RAIN_MONTH = [0.6, 0.575, 0.75, 0.85, 1.35, 1.5625, 1.5625, 1.475, 1.025, 0.8, 0.7625, 0.6875];

/** what a kg of food costs a village, in euros (HEARTs): from another village of yours, or from the world market */
export const PRICE = { village: 5, world: 10 };
/** what a litre of water costs from the world market, in euros: 2 € a m³ */
export const WATER_PRICE = 0.002;
/** weeks of food a village keeps in store before it sells to your others, and the most a store holds before the rest
 * spoils */
export const KEEP = 2, MOST = 13;
/** weeks of fresh water a village's tanks hold for each bed */
export const TANK = 4;
/** the cistern a new village starts with, full, litres: four weeks for eight people, and the least its tanks hold */
export const CISTERN = FRESH_L * 7 * TANK * 8;

/**
 * The share of what its people eat that a hex's food forest grows in its nth year (counted from 0 for the first):
 * 10% in the first, 20% in the second, … 100% in the tenth, then up to 150% in the fifteenth, and steady after.
 * @param {number} age years since it was planted
 */
export const forestShare = (age) => Math.min(1.5, 0.1 * (Math.floor(Math.max(0, age)) + 1));

/** the valley's date after so many days of its calendar: its year, its month and its day, from 1 @param {number} days */
export function calendar(days) {
	const year = Math.floor(days / YEAR) + 1, inYear = days - (year - 1) * YEAR, month = Math.floor(inYear / MONTH) + 1;
	return { year, month, day: Math.floor(inYear - (month - 1) * MONTH) + 1 };
}
/** the hour a valley's first day begins at: a new valley wakes at eight in the morning, not in the dark */
export const WAKE = 8;
/** the valley's clock after so many days of its calendar: its date, and its hour of day (0 to 24), a valley's first day
 * begun at WAKE. It runs with the calendar, so at every speed @param {number} days */
export function clockOf(days) {
	const d = days + WAKE / 24;
	return { ...calendar(d), hour: (d - Math.floor(d)) * 24 };
}
