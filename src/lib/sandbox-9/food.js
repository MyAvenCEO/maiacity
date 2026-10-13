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
import { DIET as DIET6, HENS } from '../sandbox-7/specs.js';
import { exp, pow } from './dmath.js';
import { polar } from './rng.js';

const n = (v, u, src, est = false) => ({ v, u, src, est });
const R = 'food-research.md (2026-10-13)';
const FB = 'food-best.md (2026-10-13)';

/** the food forest outdoors (Munich), a m² of forest */
export const OUTDOOR = {
	kcalM2Year: n(800, 'kcal grown a m² a year at maturity for Sandbox 6’s diet, the hens’ feed included (organic, LER 1.1): the research’s reference. The engine computes each diet’s own from its groups (dietFacts)', `${R} §6: 800 (range 400–950); measured NL/BE food forests 95, the best-documented mature garden (Scotland) 520. Was ~1,030`, true),
	loss: n(0.15, 'share of the harvest lost in storage, processing and the kitchen', `${R} §6 and the physics audit: 10–20 %`, true),
	ramp: n([0.46, 0.48, 0.53, 0.59, 0.63, 0.68, 0.73, 0.78, 0.84, 0.89, 0.92, 0.96, 0.97, 0.99, 1], 'share of the mature output by year since planting (year 1 first; 1 from year 15)', `${R} §2: annual layers bear at once, nuts and chestnuts in 10–15 years (estimate)`, true),
	lerYoung: n(1.0, 'the layers’ land equivalent ratio before year 8 (1.1 from year 15, a straight line between)', `${R} §2: the stack ramps from 1.0 to 1.1`, true),
	lerMature: n(1.1, 'the layers’ land equivalent ratio at maturity', `${R} §1: 1.1 (range 1.0–1.3); the code had 1.3`, true),
	rainSlope: n(0.5, 'harvest lost a unit of April–September rain shortfall', `${R} §3: a 40 % shortfall gives −20 % on a monoculture, the 2018 cereal loss (estimate)`, true),
	buffer: n(1.0, 'damping of the rain term (1: none)', `${FB} §5: the alley mosaic is mostly annual crops, so a dry year gives × 0.8 rain-fed (the closed forest of food-research.md damped it to 0.7)`, true),
	irrigCut: n(0.25, 'share of the rain shortfall’s loss left with irrigation', `${FB} §5: a dry year × 0.95 irrigated against × 0.8 rain-fed`, true),
	irrigMaxMm: n(200, 'mm of irrigation a season at most', `${FB} §4: dry years need 100–200 mm (150,000–300,000 m³ on 150.7 ha) from the gravel aquifer or tanks`, true),
	irrigKwhM3: n(0.4, 'kWh of electricity a m³ of irrigation water', 'lifting ~30 m from the gravel aquifer and drip at ~1.5 bar with a 60 % pump: 0.2–0.4 kWh a m³ (estimate, the high end)', true),
	netShare: n(0.92, 'share of the outdoor food land that grows food', `${FB} §3: 8 % for tracks, sheds, ponds and hedges (range 0.88–0.95)`, true),
	leyShare: n(20 / 150.7, 'share of the outdoor food land under a grass-clover ley (compost for the glass, forage for the hens)', `${FB} §3 and §5: 20 ha of the village's 150.7 ha (range 10–30 ha)`, true),
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
	kcalM2Year: n(1050, 'kcal grown a m² a year at maturity for Sandbox 6’s diet, no lamps (LER 1.1): the research’s reference; the engine computes each diet’s own (dietFacts)', `${R} §4 and §6: 1,050 (range 600–1,500); 2,000 if planted for calories (bananas, cassava, sweet potato) with little protein. Was ~1,810`, true),
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
export function outdoorShare(ageYears, r = OUTDOOR.ramp.v) {
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
 * The season's weather factor outdoors: April–September rain R and sun S as shares of normal, clamped; with irrigation
 * (setting irrigation, the default) the rain shortfall costs a quarter of what it costs rain-fed
 */
export function outdoorWeather(sun, rain, irrigated = false) {
	const O = OUTDOOR;
	const dry = O.rainSlope.v * O.buffer.v * Math.max(0, 1 - rain) * (irrigated ? O.irrigCut.v : 1);
	const f = 1 - dry + O.sunSlope.v * (sun - 1) * (rain >= 0.8 || irrigated ? 1 : 0);
	return Math.min(O.cap.v, Math.max(O.floor.v, f));
}

/** this year's tree crop factor: a late frost on fruit and nuts, and the nuts' alternate bearing (a uniform u, a normal
 * z), for a diet whose outdoor calories come treeShare from trees and nutShare from nuts and chestnuts */
export function treeYear(u, z, treeShare = OUTDOOR.treeShare.v, nutShare = OUTDOOR.nutShare.v) {
	const O = OUTDOOR;
	const frost = u < O.frostP.v ? 1 - O.frostLoss.v * treeShare : 1;
	const s = O.bearingSigma.v;
	const bear = 1 + nutShare * (exp(s * z - (s * s) / 2) - 1);
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
		fs.tree = treeYear(u1, polar(u), w.c.treeShare, w.c.nutShare);
		fs.frost = u1 < OUTDOOR.frostP.v;
	}
	t.irrigM3 = 0;
	if (m >= 3 && m <= 8) {
		if (m === 3 && w.day % 365 === APRIL_1) fs.sw = fs.ss = fs.rw = fs.rr = fs.irr = 0;
		fs.sw += t.sunShare;
		fs.ss += t.sunShare * t.sunF;
		fs.rw += t.rainF;
		fs.rr += t.rainF * t.rainShock;
		fs.sun = fs.ss / fs.sw;
		fs.rain = fs.rr / fs.rw;
		const irr = w.c.irrigation !== false;
		fs.f = outdoorWeather(fs.sun, fs.rain, irr);
		// irrigation: today's rain shortfall on the land that grows food, up to the season's most (mm); its pumps run
		// on electricity in the basics class (./coops.js plan)
		if (irr) {
			const mm = Math.min(Math.max(0, OUTDOOR.irrigMaxMm.v - (fs.irr ?? 0)), ((w.c.rainMm ?? 800) / 365) * t.rainF * Math.max(0, 1 - t.rainShock));
			fs.irr = (fs.irr ?? 0) + mm;
			t.irrigM3 = (mm / 1000) * (w.c.outNetM2 ?? 0);
		}
		if (m === 8) fs.last = fs.f;
	} else fs.f = fs.last;
	t.outWx = fs.f;
	t.treeF = fs.tree;
}

/**
 * kcal a person a day the food domes give by month at maturity (after losses), with and without the LED top-up, for
 * `m2` of food forest under glass and `people`
 */
export function indoorMonths(m2, people, kcalM2Year = INDOOR.kcalM2Year.v) {
	const day = (kcalM2Year * (1 - INDOOR.loss.v) * m2) / 365 / people;
	return {
		withoutLight: INDOOR_INDEX.base.map((x) => x * day),
		withLight: INDOOR_INDEX.led.map((x) => x * day),
		ledKwhPer1000: INDOOR.ledKwhPer1000.v,
		ledKwhM2Year: (INDOOR_INDEX.led.reduce((a, x, i) => a + (x - INDOOR_INDEX.base[i]) * DAYS_IN_MONTH[i], 0) / 365) * kcalM2Year * (INDOOR.ledKwhPer1000.v / 1000)
	};
}

// ── the diets, and the land a person's diet takes ─────────────────────────────────────────────────────────────────
const SRC6 = 'src/lib/sandbox-7/specs.js DIET (Sandbox 6)';
const USDA = 'USDA FoodData Central (food-best.md [N1])';
/**
 * What a person eats a day: grams of each group (legumes dry, nuts and seeds as kernels, the rest fresh), with kcal and
 * g of protein a kg, and € a kg wholesale (for food bought at the border in the diet's own mix).
 *
 * 'samuel' (the default; Samuel 2026-10-13 06:20, amounts from food-best.md §2): legumes first (175 g dry: soy, faba,
 * peas, lupins, lentils), 600 g of sweet potato (outdoors in summer, and under glass with yam), 500 g of vegetables,
 * 600 g of fruit and berries, 85 g of nuts and seeds (mostly annual seed crops: sunflower, linseed, hemp, pumpkin; a few
 * hazel and walnut rows; no chestnuts), one egg and 40 g of chicken a day, with the hens' feed grown too; no potatoes
 * or grains. 2,233 kcal and 89 g of protein a day. 175 g of dry legumes is above EAT-Lancet's 75 g reference and at
 * the top of its ranges (dry beans, lentils and peas 0–100 g plus soy 0–50 g), about twice the Blue Zones' cup of
 * cooked beans (~90 g dry); 85 g of nuts and seeds is a little above EAT-Lancet's 0–75 g. Under glass grow sweet
 * potato and yam, vegetables and fruit (bananas, papaya): legumes and seeds gain nothing there and stay outside
 * (food-best.md §2).
 *
 * 'sandbox6': Sandbox 6's diet as it was (potatoes and Jerusalem artichokes for roots, 220 g of chestnuts), for the
 * comparison scenario F02.
 */
export const DIETS = {
	samuel: {
		label: 'Samuel’s diet: legumes first, sweet potato and yam, vegetables, fruit, nuts and seeds, an egg and some chicken',
		src: 'Samuel 2026-10-13 06:20; amounts food-best.md §2; EAT-Lancet (Willett et al. 2019) ranges, Blue Zones (Buettner) for legumes; kcal and protein ' + USDA,
		groups: {
			legumes: { label: 'Legumes (soy, faba beans, peas, lupins, lentils), dry', g: 175, kcal: 3400, protein: 230, eur: 1.5 },
			sweetPotato: { label: 'Sweet potato (and yam under glass)', g: 600, kcal: 860, protein: 16, eur: 1.2 },
			vegetables: { label: 'Vegetables and greens', g: 500, kcal: 300, protein: 15, eur: 1.2 },
			fruit: { label: 'Fruit and berries (apples, pears, berries outdoors; bananas, papaya under glass)', g: 600, kcal: 550, protein: 4, eur: 1.25 },
			nutsSeeds: { label: 'Nuts and seeds (sunflower, linseed, hemp, pumpkin; some hazel and walnut), kernels', g: 85, kcal: 6000, protein: 180, eur: 3.5 },
			eggs: { label: 'Eggs (one a day)', g: 50, kcal: 1430, protein: 125, eur: 3 },
			chicken: { label: 'Chicken (280 g a week)', g: 40, kcal: 1500, protein: 200, eur: 4.5 }
		},
		// the hens' feed (Sandbox 6's HENS): its roots are sweet potato, its nuts are seeds
		feed: { legumes: HENS.mix.legumes, nutsSeeds: HENS.mix.nuts, sweetPotato: HENS.mix.roots },
		// what grows in place of a group that does not grow there, by kcal (none: every group grows outdoors)
		swapOut: {},
		swapIn: {},
		// grown outdoors only: the glass goes to the crops it gains most on (food-best.md §2); the hens live outside on
		// the ley, so the eggs, the chicken and their feed count outdoors
		notUnderGlass: ['legumes', 'nutsSeeds'],
		hensOutside: true
	},
	sandbox6: {
		label: 'Sandbox 6’s diet: legumes, nuts, chestnuts, potatoes and other roots, vegetables, fruit, eggs and chicken',
		src: SRC6,
		groups: Object.fromEntries(Object.entries(DIET6).map(([k, d]) => [k, { ...d, eur: { legumes: 1.5, nuts: 7, chestnuts: 3, roots: 0.4, vegetables: 1.2, fruit: 1.25, eggs: 3, chicken: 4.5 }[k] }])),
		feed: { ...HENS.mix },
		swapOut: {},
		swapIn: { chestnuts: 'roots' },
		notUnderGlass: []
	}
};

/** which groups are trees (they bear after years: the ramp, late frost) and which of them bear in alternate years; the
 * nuts and seeds of Samuel's diet are mostly annual seed crops, full from year 1 (food-best.md §5) */
const TREE = { nuts: true, chestnuts: true, fruit: true };
const ALTERNATE = { nuts: true, chestnuts: true };

/** a yield record with its evidence grade (food-best.md: M-PR measured and peer-reviewed, M-S official statistics or a
 * state trial, M-G grey literature, C a claim, Mod a model, E an estimate); est: true unless measured */
const y = (v, grade, src) => ({ v, u: 't/ha a year', grade, src, est: !/^M/.test(grade) });

/**
 * Yields, t a ha a year, organic, mature, as a sole crop (legumes dry, nuts and seeds as kernels, chestnuts in shell, the
 * rest fresh); under glass at 24 °C with ~53 % of the light, no lamps. The layers' land equivalent ratio is 1.0: the
 * outdoor land is an alley mosaic (strips of legumes and seed crops between fruit and nut rows), and a ratio above 1
 * has never been measured in a food forest (food-best.md §5).
 *
 * 'average': food-research.md's measured averages (German and European statistics and trials).
 * 'best': food-best.md's best practice (the top quarter of measured farms and gardens, with each grade).
 * The setting foodYields 'ramp' (the default) grows the average in years 1–5 and the best practice from year 10, a
 * straight line between, as the growers learn (food-best.md §5: top yields are a skill that takes 5–10 years).
 */
export const YIELDS = {
	average: {
		label: 'Measured averages: organic yields from German and European statistics and trials (food-research.md)',
		grade: 'measured (statistics, trials) outdoors; scaled estimates under glass',
		ler: { young: 1, mature: 1, indoor: 1 },
		out: {
			legumes: y(2.5, 'M-S', `${R}: faba bean 2.9–3.2, field pea 2.5 organic (range 1.5–3.2)`),
			roots: y(22, 'M-S', `${R}: Bavarian organic potatoes 19–25 (range 19–34)`),
			sweetPotato: y(20, 'M-S', 'LWG Bamberg trials 2016–17 (Hedrich and Rascher 2018, orgprints.org/38303): Beauregard 19.3 t/ha marketable; LFA MV Gülzow 2018 26–69 total (one trial site each)'),
			nutsSeeds: y(1.0, 'M-S', `${FB} §5: nuts and seeds, measured average 1.0 (hazel 0.45–0.9, sunflower kernels 1.4–2.1)`),
			nuts: y(1.0, 'M-S', `${R}: hazel 0.45–0.9 average, walnut ~0.85 (range 0.5–1.8)`),
			chestnuts: y(2.0, 'M-S', `${R}: 1.0–1.5 Italian average, 2.2–2.8 mature grafted orchards (range 1.0–2.8)`),
			vegetables: y(29, 'M-S', `${R}: German organic vegetables 2025 (range 20–35)`),
			fruit: y(18, 'M-S', `${R}: apples 22–28 organic estimate, berries 4–12 (range 12–25)`)
		},
		in: {
			legumes: y(2.0, 'E', `${R}: pigeon pea and dry beans 1.2–2.5 under the dome's light`),
			roots: y(20, 'E', `${R}: sweet potato and cassava under glass`),
			sweetPotato: y(20, 'E', `${R}: 15–25 under the dome's light`),
			nuts: y(1.0, 'E', R),
			vegetables: y(60, 'E', `${R}: several crops a year, 30–100`),
			fruit: y(25, 'E', `${R}: bananas 18–28, papaya 30–60`)
		}
	},
	best: {
		label: 'Best practice: the top quarter of measured farms and gardens (food-best.md)',
		grade: 'measured parts (statistics, peer-reviewed beds) scaled by estimate; every value graded',
		ler: { young: 1, mature: 1, indoor: 1 },
		out: {
			legumes: y(3.5, 'E', `${FB} §5: Bavarian organic 2.9–3.2, conventional 3.75–4.1 (M-S); 3.5 for the top quarter is an estimate (range 2.5–4.5)`),
			roots: y(22, 'M-S', `${R}: potatoes as average (not in food-best.md)`),
			sweetPotato: y(20, 'M-S', `${FB} §5: one trial site each, Bamberg and Gülzow (range 10–35)`),
			nutsSeeds: y(1.4, 'M-S', `${FB} §5: sunflower kernels 1.4–2.1, Marchfeld hazel 3–4 t in shell; hybrid hazel 0.9 (M-PR) (range 1.0–2.0)`),
			nuts: y(1.4, 'M-S', `${FB} §5 (range 1.0–2.0)`),
			chestnuts: y(2.0, 'M-S', `${R}: as average (not in food-best.md)`),
			vegetables: y(50, 'E', `${FB} §5: peer-reviewed bed yields 5.9–6.0 kg/m² (M-PR) × 0.8 for paths (range 29–70)`),
			fruit: y(25, 'E', `${FB} §5: German apples 26.5–35.9 conventional × the organic factor (range 18–40)`)
		},
		in: {
			legumes: y(3.5, 'E', `${FB} §5: NASA soy scaled (range 2.0–4.5)`),
			roots: y(20, 'E', `${R}: as average (not in food-best.md)`),
			sweetPotato: y(30, 'E', `${FB} §5: scaled from Biosphere 2 (M-PR) (range 15–45)`),
			nuts: y(1.0, 'E', `${R}: as average`),
			vegetables: y(150, 'E', `${FB} §5: Dutch tomatoes 410–480 (M-S), a mixed basket without CO₂ far less (range 60–400)`),
			fruit: y(35, 'E', `${FB} §5: Canary and Almería yields × the dome's light (range 25–60)`)
		}
	}
};
/** the yields' first year of the best practice under foodYields 'ramp' (the average to year 5, a straight line to
 * year 10) */
export const SKILL_YEARS = { from: 5, to: 10 };

const yearOf = (g) => (g * 365) / 1000;

/**
 * A diet on a yield set: what a person's year takes, kg grown of each group (with the hens' feed), the m² a person
 * needs outdoors and under glass at maturity (no losses; the layers' LER at maturity), and what a m² gives: kcal eaten
 * a year (the eggs and chicken included, the feed they took counted as land), protein a 1,000 kcal eaten, € a 1,000
 * kcal bought, and the share of the outdoor calories from trees (late frost) and from nuts (alternate bearing). The
 * engine's food unit is 1,000 kcal of this diet as eaten.
 */
export function dietFacts(dietKey = 'samuel', yieldKey = 'average') {
	// the ramp's mature yields are the best practice's
	const D = DIETS[dietKey] ?? DIETS.samuel, Yd = YIELDS[yieldKey === 'ramp' ? 'best' : yieldKey] ?? YIELDS.average;
	const G = D.groups;
	let kcal = 0, protein = 0, eur = 0;
	for (const d of Object.values(G)) (kcal += (d.g / 1000) * d.kcal), (protein += (d.g / 1000) * d.protein), (eur += (d.g / 1000) * d.eur);
	const feedKg = ((G.eggs ? yearOf(G.eggs.g) * HENS.eggsFeed : 0) + (G.chicken ? yearOf(G.chicken.g) * HENS.meatFeed : 0)) * (1 - HENS.forage);
	// kg a year of each plant group a person needs grown (what they eat, and the hens' share of the feed)
	const grown = {};
	for (const [k, d] of Object.entries(G)) if (k !== 'eggs' && k !== 'chicken') grown[k] = yearOf(d.g) + feedKg * (D.feed[k] ?? 0);
	const place = (where) => {
		const t = Yd[where], swap = where === 'out' ? D.swapOut : D.swapIn, ler = where === 'out' ? Yd.ler.mature : Yd.ler.indoor;
		const kg = {};
		const skip = (k) => where === 'in' && ((D.notUnderGlass ?? []).includes(k) || (D.hensOutside && (k === 'eggs' || k === 'chicken')));
		for (const [k, x0] of Object.entries(grown)) {
			if (skip(k)) continue;
			// under glass with the hens outside, a crop grows only what people eat of it
			const x = where === 'in' && D.hensOutside ? yearOf(G[k].g) : x0;
			if (t[k]) kg[k] = (kg[k] ?? 0) + x;
			else if (swap[k] && t[swap[k]]) kg[swap[k]] = (kg[swap[k]] ?? 0) + (x * G[k].kcal) / G[swap[k]].kcal;
		}
		const m2 = {};
		for (const [k, x] of Object.entries(kg)) m2[k] = x / (t[k].v * 0.1) / ler;
		const total = Object.values(m2).reduce((a, b) => a + b, 0);
		// the calories a person eats from what grows here (the swapped crops at their own kcal), and protein
		let eatK = 0, eatP = 0, treeK = 0, nutK = 0;
		for (const [k, d] of Object.entries(G)) {
			if (skip(k)) continue;
			const to = t[k] ? k : swap[k] && t[swap[k]] ? swap[k] : null;
			if (!to && k !== 'eggs' && k !== 'chicken') continue;
			const kc = (d.g / 1000) * d.kcal;
			eatK += kc;
			eatP += to && to !== k ? ((d.g / 1000) * d.kcal * G[to].protein) / G[to].kcal : (d.g / 1000) * d.protein;
			if (TREE[to ?? k]) treeK += kc;
			if (ALTERNATE[to ?? k]) nutK += kc;
		}
		return { kg, m2, total, kcalM2Year: (eatK * 365) / total, proteinPer1000: (eatP / eatK) * 1000, treeShare: treeK / eatK, nutShare: nutK / eatK };
	};
	const out = place('out'), inn = place('in');
	return { diet: dietKey, yields: yieldKey, label: D.label, kcalDay: kcal, proteinDay: protein, eurPer1000: (eur / kcal) * 1000, grown, feedKg, out, in: inn };
}

/** people a village's food land feeds at maturity in an average year, after the harvest's losses */
export function peopleFed(f, outM2, inM2) {
	// by calories, at the yields of the land split by the diet's groups (./food.js splitYields): the glass grows only
	// part of the diet (sweet potato, vegetables, fruit), so its people are the calories it gives over a person's year,
	// and the outdoor land's are what it grows of the rest (the sum is the people the land feeds by group)
	const year = f.kcalDay * 365, y = splitYields(f, outM2, inM2);
	return { out: (outM2 * (1 - OUTDOOR.loss.v) * y.out) / year, in: (inM2 * (1 - INDOOR.loss.v) * y.in) / year, get all() { return this.out + this.in; } };
}

/**
 * People a village's food land feeds by the diet's groups (food-best.md's way): the glass grows its groups (sweet
 * potato, vegetables, fruit) for as many people as the outdoor land grows the rest for (legumes, nuts and seeds, the
 * hens' feed); glass beyond that cannot grow the outdoor groups and feeds no one more, and outdoor land beyond it
 * grows the whole diet. After the harvest's losses, at maturity, an average year. (The engine itself counts food as
 * calories: a dome's sweet potato counts in full against a person's need, as if people ate more of it in place of
 * beans, so its calories feed more people than this count does.)
 */
export function peopleFedByGroup(f, outM2, inM2) {
	const glass = new Set(Object.keys(f.in.kg));
	const lIn = f.in.total / (1 - INDOOR.loss.v);
	const lRest = Object.entries(f.out.m2).reduce((a, [k, m2]) => a + (glass.has(k) ? 0 : m2), 0) / (1 - OUTDOOR.loss.v);
	const lAll = f.out.total / (1 - OUTDOOR.loss.v);
	const nOut = lRest > 0 ? outM2 / lRest : Infinity, nIn = lIn > 0 ? inM2 / lIn : 0;
	const pair = Math.min(nOut, nIn);
	const more = nIn < nOut ? Math.max(0, outM2 - pair * lRest) / lAll : 0;
	return { all: pair + more, paired: pair, bind: nIn < nOut ? 'the glass' : 'the outdoor land', landOutRest: lRest, landIn: lIn };
}

/**
 * What a m² of the village's food land grows when the land is split by the diet's groups (./food.js
 * peopleFedByGroup): outdoors the groups the glass does not grow (legumes, nuts and seeds, the hens' feed) for the
 * people the glass grows for, and the whole diet on the land left; under glass its groups for those people. kcal a
 * year before the harvest's losses, a net m² outdoors and a m² under glass, and protein (g) a 1,000 kcal of each. The
 * engine grows its food at these yields, so its calories feed the people this count feeds.
 */
export function splitYields(f, outM2, inM2) {
	const d = peopleFedByGroup(f, outM2, inM2);
	if (!(outM2 > 0) || !(inM2 > 0)) return { out: f.out.kcalM2Year, in: f.in.kcalM2Year, protOut: f.out.proteinPer1000, protIn: f.in.proteinPer1000, byGroup: d };
	// a person's day of the glass's groups (kcal and protein, as eaten), and of the rest
	const inKcal = (f.in.kcalM2Year * f.in.total) / 365, inProt = (inKcal * f.in.proteinPer1000) / 1000;
	const restKcal = f.kcalDay - inKcal, restProt = f.proteinDay - inProt;
	const more = d.all - d.paired;
	const outKcal = d.paired * restKcal + more * f.kcalDay, outProt = d.paired * restProt + more * f.proteinDay;
	return {
		out: (outKcal * 365) / (1 - OUTDOOR.loss.v) / outM2,
		in: (d.paired * inKcal * 365) / (1 - INDOOR.loss.v) / inM2,
		protOut: outKcal > 0 ? (outProt / outKcal) * 1000 : f.out.proteinPer1000,
		protIn: f.in.proteinPer1000,
		byGroup: d
	};
}

/**
 * The growers' skill by year of the run (year 1 first), as a share of the mature yields: 1 every year for 'average'
 * and 'best'; for 'ramp' the average's kcal a m² over the best practice's to year 5, a straight line to 1 at year 10
 * (outdoors and under glass apart).
 */
export function skillRamp(dietKey, yieldKey, outM2, inM2) {
	if (yieldKey !== 'ramp') return { out: [1], in: [1] };
	const a = dietFacts(dietKey, 'average'), b = dietFacts(dietKey, 'best');
	// the village's own yields when its land is split by the diet's groups (./food.js splitYields)
	const sa = splitYields(a, outM2, inM2), sb = splitYields(b, outM2, inM2);
	const ramp = (r) => Array.from({ length: SKILL_YEARS.to }, (_, i) => (i + 1 <= SKILL_YEARS.from ? r : r + ((1 - r) * (i + 1 - SKILL_YEARS.from)) / (SKILL_YEARS.to - SKILL_YEARS.from)));
	return { out: ramp(sa.out / sb.out), in: ramp(sa.in / sb.in) };
}
/** this year's skill factor of a world, outdoors ('out') or under glass ('in') */
export const skillOf = (w, where, day = w.day) => {
	const r = w.c.skill?.[where];
	return r ? r[Math.min(r.length - 1, Math.floor(day / 365))] : 1;
};

/**
 * A food forest's share of its mature yield by age for a diet: the annual layers (legumes, roots, vegetables, seeds)
 * bear in full from year 1; the trees (fruit, nuts, chestnuts) follow food-research.md's ramp for its tree part (its
 * whole-forest ramp less the annual 46 %, over the trees' 54 %), with the layers' LER (1.0 before year 8, 1.1 from 15)
 */
export const TREE_RAMP = OUTDOOR.ramp.v.map((r) => (r - 0.46) / 0.54);
export function rampFor(treeShare) {
	return OUTDOOR.ramp.v.map((_, y) => 1 - treeShare + treeShare * TREE_RAMP[y]);
}
export { FOOD };
