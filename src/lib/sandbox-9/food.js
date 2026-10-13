// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · FOOD — the food forests' yields in units of 1,000 kcal of the village diet, with their protein: outdoors
 * by age (the maturity ramp) and by the season's weather, under glass by the months since planting and the month's
 * light (about half the outside light: the glass and its cells), and the winter food LED light can add.
 *
 * Every number is a catalog record { v, u, src, est }, read by the engine once at genesis (./genesis.js constants).
 * They come from /mnt/project-files/theos/sandbox-8/food-research.md (2026-10-13), which reads the sources through
 * search summaries and marks its own numbers as estimates.
 */
import { DAYS_IN_MONTH, FOOD } from './primitives.js';
import { exp, pow } from './dmath.js';
import { polar } from './rng.js';

const n = (v, u, src, est = false) => ({ v, u, src, est });
const R = 'food-research.md (2026-10-13)';

/** the food forest outdoors (Munich), a m² of forest */
export const OUTDOOR = {
	kcalM2Year: n(800, 'kcal grown a m² a year at maturity (organic, planted for the diet, LER 1.1)', `${R} §6: 800 (range 400–950); measured NL/BE food forests 95, the best-documented mature garden (Scotland) 520. Was ~1,030`, true),
	loss: n(0.15, 'share of the harvest lost in storage, processing and the kitchen', `${R} §6 and the physics audit: 10–20 %`, true),
	ramp: n([0.46, 0.48, 0.53, 0.59, 0.63, 0.68, 0.73, 0.78, 0.84, 0.89, 0.92, 0.96, 0.97, 0.99, 1], 'share of the mature output by year since planting (year 1 first; 1 from year 15)', `${R} §2: annual layers bear at once, nuts and chestnuts in 10–15 years (estimate)`, true),
	lerYoung: n(1.0, 'the layers’ land equivalent ratio before year 8 (1.1 from year 15, a straight line between)', `${R} §2: the stack ramps from 1.0 to 1.1`, true),
	lerMature: n(1.1, 'the layers’ land equivalent ratio at maturity', `${R} §1: 1.1 (range 1.0–1.3); the code had 1.3`, true),
	rainSlope: n(0.5, 'harvest lost a unit of April–September rain shortfall', `${R} §3: a 40 % shortfall gives −20 % on a monoculture, the 2018 cereal loss (estimate)`, true),
	buffer: n(0.7, 'the forest’s damping of the rain term', `${R} §3 (range 0.6–1.0)`, true),
	sunSlope: n(0.3, 'harvest gained a unit of April–September sun above normal (when rain is ≥ 80 %)', `${R} §3 (range 0.2–0.5)`, true),
	floor: n(0.5, 'lowest weather factor', `${R} §3`, true),
	cap: n(1.15, 'highest weather factor', `${R} §3`, true),
	frostP: n(0.15, 'chance of a late frost a year', `${R} §3: apples −40 % in 2017 (range 0.1–0.25)`, true),
	frostLoss: n(0.4, 'share of fruit and nuts lost in a frost year', `${R} §3 (range 0.2–0.6)`, true),
	treeShare: n(0.54, 'share of the diet’s calories from fruit, nuts and chestnuts', `${R}: nuts 23 %, chestnuts 17 %, fruit 14 %`),
	nutShare: n(0.4, 'share of the diet’s calories from nuts and chestnuts (alternate bearing)', `${R}: nuts 23 %, chestnuts 17 %`),
	bearingSigma: n(0.2, 'lognormal σ a year of the nuts’ and chestnuts’ crop (alternate bearing)', `${R} §3 (range 0.1–0.3)`, true),
	proteinPer1000: n((26 / 800) * 1000, 'g of protein per 1,000 kcal', `${R} §6: 26 g a m² outdoors for 800 kcal`, true)
};

/** the months the LED top-up lights (November to February) */
const LED_MONTHS = [10, 11, 0, 1];
const APRIL_1 = DAYS_IN_MONTH.slice(0, 3).reduce((a, x) => a + x, 0);

/** inside light by month, mol of PAR a m² a day (Jan first) */
const MOL = [4.3, 7.6, 12.0, 17.3, 19.6, 21.5, 21.2, 18.4, 13.7, 8.5, 4.6, 3.1];

/** the food forest under glass (two Dome120 food domes a living hex), a m² of it */
export const INDOOR = {
	kcalM2Year: n(1050, 'kcal grown a m² a year at maturity, no lamps (diet mix, LER 1.1)', `${R} §4 and §6: 1,050 (range 600–1,500); 2,000 if planted for calories (bananas, cassava, sweet potato) with little protein. Was ~1,810`, true),
	loss: n(0.15, 'share of the harvest lost in storage, processing and the kitchen', `${R} §6`, true),
	ramp: n([0.8, 1], 'share of the mature output in year 1, then from year 2', `${R} §2: bananas, papaya, roots bear in 4–18 months (estimate)`, true),
	light: n(0.53, 'share of the outside light under the glass and its cells', `${R} §4: the dome model lets in 634 of Munich’s 1,190 kWh/m² a year`),
	molByMonth: n(MOL, 'mol of light a m² a day inside, by month', `${R} §4: the dome model’s monthly shares, 7.3 mol a kWh`),
	lightPower: n(0.85, 'output ∝ light to this power', `${R} §4: 1 % more light gives 0.7–1 % more yield (Marcelis et al. 2006)`, true),
	darkMol: n(4, 'mol a m² a day below which a 24 °C canopy grows nothing', `${R} §4 (range 3–6, estimate)`, true),
	ledMol: n(12, 'mol a m² a day the LED top-up raises November–February to', `${R} §4`, true),
	ledKwhPer1000: n(400, 'kWh of LED light per 1,000 kcal of extra food in the dome', `${R} §4: ~400 in the dome forest (range 200–600); ~100 in a room built for lamps`, true),
	heatKwhM2Year: n(150, 'kWh of heat a m² a year at 24 °C with a planted canopy', `${R} §4: 150 (range 90, our dome model, to 300); venting the canopy’s water costs heat`, true),
	proteinPer1000: n((34 / 1050) * 1000, 'g of protein per 1,000 kcal', `${R} §6: 34 g a m² under glass for 1,050 kcal`, true)
};

/** a food forest's share of its mature yield at `ageYears` since planting, with its layers' land equivalent ratio */
export function outdoorShare(ageYears) {
	const r = OUTDOOR.ramp.v;
	if (!(ageYears >= 0)) return 0;
	const y = Math.floor(ageYears);
	const ler = OUTDOOR.lerYoung.v + (OUTDOOR.lerMature.v - OUTDOOR.lerYoung.v) * Math.min(1, Math.max(0, (y + 1 - 8) / 7));
	return r[Math.min(r.length - 1, y)] * (ler / OUTDOOR.lerMature.v);
}

/** the food domes' share of their mature yield `days` after planting */
export function indoorShare(days) {
	const r = INDOOR.ramp.v;
	if (!(days >= 0)) return 0;
	return r[Math.min(r.length - 1, Math.floor(days / 365))];
}

/**
 * The season's weather factor outdoors: April–September rain R and sun S as shares of normal (the forest damps the
 * rain term), clamped
 */
export function outdoorWeather(sun, rain) {
	const O = OUTDOOR;
	const f = 1 - O.rainSlope.v * O.buffer.v * Math.max(0, 1 - rain) + O.sunSlope.v * (sun - 1) * (rain >= 0.8 ? 1 : 0);
	return Math.min(O.cap.v, Math.max(O.floor.v, f));
}

/** this year's tree crop factor: a late frost on fruit and nuts, and the nuts' alternate bearing (two uniforms u1, z) */
export function treeYear(u, z) {
	const O = OUTDOOR;
	const frost = u < O.frostP.v ? 1 - O.frostLoss.v * O.treeShare.v : 1;
	const s = O.bearingSigma.v;
	const bear = 1 + O.nutShare.v * (exp(s * z - (s * s) / 2) - 1);
	return frost * bear;
}

/** the indoor light's output index by month (an average day of the year = 1), without and with the LED top-up */
export const INDOOR_INDEX = (() => {
	const p = INDOOR.lightPower.v, dark = INDOOR.darkMol.v, led = INDOOR.ledMol.v;
	const g = MOL.map((m) => (m >= dark ? pow(m, p) : 0));
	const gl = MOL.map((m, i) => (LED_MONTHS.includes(i) ? Math.max(g[i], pow(led, p)) : g[i]));
	const tot = g.reduce((a, x, i) => a + x * DAYS_IN_MONTH[i], 0);
	return { base: g.map((x) => (x * 365) / tot), led: gl.map((x) => (x * 365) / tot), norm: tot / 365 };
})();

/**
 * The food domes' output index today (an average day of the year = 1): the month's inside light times this month's
 * sun against its normal (`sunF`), to the power 0.85, nothing below 4 mol; with the LED top-up (`led`) November to
 * February are lit up to 12 mol whatever the sun. Returns [without, with] the lamps.
 */
export function indoorIndex(m, sunF, led) {
	const p = INDOOR.lightPower.v, mol = MOL[m] * sunF;
	const g = mol >= INDOOR.darkMol.v ? pow(mol, p) / INDOOR_INDEX.norm : 0;
	const gl = led && LED_MONTHS.includes(m) ? Math.max(g, pow(INDOOR.ledMol.v, p) / INDOOR_INDEX.norm) : g;
	return [g, gl];
}

/**
 * The food's weather of the day (called by ./energy.js calendar, after the month's weather and the shocks): the
 * outdoor season's factor from April–September sun and rain as shares of normal (the season so far while it runs; from
 * October to March the last full season's), and the year's tree crop (late frost, the nuts' alternate bearing), drawn
 * each 1 January from a random stream of its own seeded by the world's seed (so an experiment's pair gets the same
 * crop years). Setting `weather: false` gives 1 for both.
 */
export function foodSeason(w) {
	const t = w.today, m = t.month;
	const fs = (w.foodWx ??= { sw: 0, ss: 0, rw: 0, rr: 0, f: 1, last: 1, tree: 1, year: -1, rs: ((w.cfg.seed >>> 0) ^ 0x2545f491) >>> 0 || 1 });
	if (w.cfg.weather === false) {
		t.outWx = 1;
		t.treeF = 1;
		return;
	}
	const year = Math.floor(w.day / 365);
	if (fs.year !== year) {
		fs.year = year;
		const u = () => {
			fs.rs = (fs.rs + 0x6d2b79f5) >>> 0;
			let x = fs.rs;
			x = Math.imul(x ^ (x >>> 15), x | 1);
			x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
			return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
		};
		const u1 = u();
		fs.tree = treeYear(u1, polar(u));
		fs.frost = u1 < OUTDOOR.frostP.v;
	}
	if (m >= 3 && m <= 8) {
		if (m === 3 && w.day % 365 === APRIL_1) fs.sw = fs.ss = fs.rw = fs.rr = 0;
		fs.sw += t.sunShare;
		fs.ss += t.sunShare * t.sunF;
		fs.rw += t.rainF;
		fs.rr += t.rainF * t.rainShock;
		fs.sun = fs.ss / fs.sw;
		fs.rain = fs.rr / fs.rw;
		fs.f = outdoorWeather(fs.sun, fs.rain);
		if (m === 8) fs.last = fs.f;
	} else fs.f = fs.last;
	t.outWx = fs.f;
	t.treeF = fs.tree;
}

/**
 * kcal a person a day the food domes give by month at maturity (after losses), with and without the LED top-up, for
 * `m2` of food forest under glass and `people`
 */
export function indoorMonths(m2, people) {
	const day = (INDOOR.kcalM2Year.v * (1 - INDOOR.loss.v) * m2) / 365 / people;
	return {
		withoutLight: INDOOR_INDEX.base.map((x) => x * day),
		withLight: INDOOR_INDEX.led.map((x) => x * day),
		ledKwhPer1000: INDOOR.ledKwhPer1000.v,
		ledKwhM2Year: (INDOOR_INDEX.led.reduce((a, x, i) => a + (x - INDOOR_INDEX.base[i]) * DAYS_IN_MONTH[i], 0) / 365) * INDOOR.kcalM2Year.v * (INDOOR.ledKwhPer1000.v / 1000)
	};
}
export { FOOD };
