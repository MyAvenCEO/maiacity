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

/** the food forest outdoors (Munich), a m² of forest */
export const OUTDOOR = {
	kcalM2Year: n(800, 'kcal grown a m² a year at maturity for Sandbox 6’s diet, the hens’ feed included (organic, LER 1.1): the research’s reference. The engine computes each diet’s own from its groups (dietFacts)', `${R} §6: 800 (range 400–950); measured NL/BE food forests 95, the best-documented mature garden (Scotland) 520. Was ~1,030`, true),
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
 * The season's weather factor outdoors: April–September rain R and sun S as shares of normal (the forest damps the
 * rain term), clamped
 */
export function outdoorWeather(sun, rain) {
	const O = OUTDOOR;
	const f = 1 - O.rainSlope.v * O.buffer.v * Math.max(0, 1 - rain) + O.sunSlope.v * (sun - 1) * (rain >= 0.8 ? 1 : 0);
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
const USDA = 'USDA FoodData Central (food-research.md [N1])';
/**
 * What a person eats a day: grams of each group (legumes dry, nuts and seeds as kernels, the rest fresh), with kcal and
 * g of protein a kg, and € a kg wholesale (for food bought at the border in the diet's own mix).
 *
 * 'samuel' (the default, Samuel 2026-10-13 06:20): "Healthy diet is just fruits vegetables legumes chicken and eggs incl
 * seeds and nuts", without potatoes, wheat or other grains: legumes the main source, sweet potato (outdoors in summer
 * and under glass) and yam (under glass only) for roots, vegetables, fruit and berries, nuts and seeds (seeds more than
 * nuts: nut trees are the most land-hungry), a few chestnuts, eggs and chicken at Sandbox 6's amounts with the hens'
 * feed grown too. 150 g of dry legumes a day is the top of the EAT-Lancet ranges (dry beans, lentils and peas 0–100 g
 * plus soy 0–50 g; its reference is 75 g, 50 g of nuts) and about twice the Blue Zones' cup of cooked beans (~90 g dry):
 * above common advice, within the planetary health diet's own ranges. 75 g of nuts and seeds is the top of EAT-Lancet's
 * 0–75 g. The day comes to ~2,220 kcal and ~77 g of protein; a person who eats the 2,240 kcal of need eats a little more
 * of the same mix.
 *
 * 'sandbox6': Sandbox 6's diet as it was (potatoes and Jerusalem artichokes for roots, 220 g of chestnuts), for the
 * comparison scenario F02.
 */
export const DIETS = {
	samuel: {
		label: 'Samuel’s diet: legumes first, sweet potato and yam, vegetables, fruit, nuts and seeds, eggs and chicken',
		src: 'Samuel 2026-10-13 06:20; amounts: EAT-Lancet (Willett et al. 2019) ranges, Blue Zones (Buettner) for legumes; kcal and protein ' + USDA,
		groups: {
			legumes: { label: 'Legumes (faba beans, peas, lentils, lupins, beans), dry', g: 150, kcal: 3400, protein: 220, eur: 1.5 },
			sweetPotato: { label: 'Sweet potato', g: 450, kcal: 860, protein: 16, eur: 1.1 },
			yam: { label: 'Yam (under glass only)', g: 150, kcal: 1180, protein: 15, eur: 1.6 },
			nuts: { label: 'Tree nuts (hazel, walnut), kernels', g: 40, kcal: 6400, protein: 150, eur: 7 },
			seeds: { label: 'Seeds (sunflower, pumpkin, hemp), kernels', g: 35, kcal: 5800, protein: 230, eur: 2.8 },
			chestnuts: { label: 'Sweet chestnuts (a few)', g: 50, kcal: 1960, protein: 24, eur: 3 },
			vegetables: { label: 'Vegetables and greens', g: 500, kcal: 300, protein: 15, eur: 1.2 },
			fruit: { label: 'Fruit and berries (apples, pears, berries outdoors; bananas, papaya under glass)', g: 600, kcal: 600, protein: 5, eur: 1.25 },
			eggs: { label: 'Eggs (about 3 a week)', g: 25, kcal: 1430, protein: 125, eur: 3 },
			chicken: { label: 'Chicken (about 210 g a week)', g: 30, kcal: 1500, protein: 200, eur: 4.5 }
		},
		// the hens' feed (Sandbox 6's HENS): its roots are sweet potato, its nuts are seeds
		feed: { legumes: HENS.mix.legumes, seeds: HENS.mix.nuts, sweetPotato: HENS.mix.roots },
		// what grows in place of a group that does not grow there, by kcal
		swapOut: { yam: 'sweetPotato' },
		swapIn: { chestnuts: 'sweetPotato' }
	},
	sandbox6: {
		label: 'Sandbox 6’s diet: legumes, nuts, chestnuts, potatoes and other roots, vegetables, fruit, eggs and chicken',
		src: SRC6,
		groups: Object.fromEntries(Object.entries(DIET6).map(([k, d]) => [k, { ...d, eur: { legumes: 1.5, nuts: 7, chestnuts: 3, roots: 0.4, vegetables: 1.2, fruit: 1.25, eggs: 3, chicken: 4.5 }[k] }])),
		feed: { ...HENS.mix },
		swapOut: {},
		swapIn: { chestnuts: 'roots' }
	}
};

/** which groups are trees (they bear after years: the ramp, late frost) and which of them bear in alternate years */
const TREE = { nuts: true, chestnuts: true, fruit: true };
const ALTERNATE = { nuts: true, chestnuts: true };

/**
 * Yields, t a ha a year, organic, mature, as a sole crop (legumes dry, nuts and seeds as kernels, chestnuts in shell, the
 * rest fresh); under glass at 24 °C with ~53 % of the light, no lamps. 'average': food-research.md's diet groups (§ "Diet
 * groups for the engine"), with the crops it does not list marked as estimates.
 */
export const YIELDS = {
	average: {
		label: 'Average good practice: organic yields from German and European statistics and trials (food-research.md)',
		grade: 'measured (statistics, trials) outdoors; scaled estimates under glass',
		ler: { young: OUTDOOR.lerYoung.v, mature: OUTDOOR.lerMature.v, indoor: OUTDOOR.lerMature.v },
		out: {
			legumes: n(2.5, 't/ha dry', `${R}: faba bean 2.9–3.2, field pea 2.5 organic (range 1.5–3.2)`),
			roots: n(22, 't/ha', `${R}: Bavarian organic potatoes 19–25 (range 19–34)`),
			sweetPotato: n(20, 't/ha', 'LWG Bamberg trials 2016–17 (Hedrich and Rascher 2018, orgprints.org/38303): Beauregard 19.3 t/ha marketable, 35–55 total; LFA MV Gülzow 2018 26–69 total. Organic, all roots eaten: 20 (range 15–35)', true),
			nuts: n(1.0, 't/ha kernels', `${R}: hazel 0.45–0.9 average, walnut ~0.85 (range 0.5–1.8)`),
			seeds: n(1.4, 't/ha kernels', `${R}: sunflower seed 2.0–3.0 t/ha, kernels ~1.4–2.1 (~70 % kernel)`, true),
			chestnuts: n(2.0, 't/ha in shell', `${R}: 1.0–1.5 Italian average, 2.2–2.8 mature grafted orchards (range 1.0–2.8)`),
			vegetables: n(29, 't/ha', `${R}: German organic vegetables 2025 (range 20–35)`),
			fruit: n(18, 't/ha', `${R}: apples 22–28 organic estimate, berries 4–12 (range 12–25)`)
		},
		in: {
			legumes: n(2.0, 't/ha dry', `${R}: pigeon pea and dry beans 1.2–2.5 under the dome's light (estimate)`, true),
			roots: n(20, 't/ha', `${R}: sweet potato and cassava under glass (estimate)`, true),
			sweetPotato: n(20, 't/ha', `${R}: 15–25 under the dome's light (estimate)`, true),
			yam: n(10, 't/ha', 'no source for yam under glass at 48° N: tropical fields 8–30 t/ha (FAO world average ~9), at the dome’s ~0.5 of their light (estimate, range 6–15)', true),
			nuts: n(1.0, 't/ha kernels', `${R} (estimate)`, true),
			seeds: n(1.4, 't/ha kernels', `${R}: sunflower "possible as a summer crop" (estimate)`, true),
			vegetables: n(60, 't/ha', `${R}: several crops a year, 30–100 (estimate)`, true),
			fruit: n(25, 't/ha', `${R}: bananas 18–28, papaya 30–60 (estimate)`, true)
		}
	}
};

const yearOf = (g) => (g * 365) / 1000;

/**
 * A diet on a yield set: what a person's year takes, kg grown of each group (with the hens' feed), the m² a person
 * needs outdoors and under glass at maturity (no losses; the layers' LER at maturity), and what a m² gives: kcal eaten
 * a year (the eggs and chicken included, the feed they took counted as land), protein a 1,000 kcal eaten, € a 1,000
 * kcal bought, and the share of the outdoor calories from trees (late frost) and from nuts (alternate bearing). The
 * engine's food unit is 1,000 kcal of this diet as eaten.
 */
export function dietFacts(dietKey = 'samuel', yieldKey = 'average') {
	const D = DIETS[dietKey] ?? DIETS.samuel, Yd = YIELDS[yieldKey] ?? YIELDS.average;
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
		for (const [k, x] of Object.entries(grown)) {
			if (t[k]) kg[k] = (kg[k] ?? 0) + x;
			else if (swap[k] && t[swap[k]]) kg[swap[k]] = (kg[swap[k]] ?? 0) + (x * G[k].kcal) / G[swap[k]].kcal;
		}
		const m2 = {};
		for (const [k, x] of Object.entries(kg)) m2[k] = x / (t[k].v * 0.1) / ler;
		const total = Object.values(m2).reduce((a, b) => a + b, 0);
		// the calories a person eats from what grows here (the swapped crops at their own kcal), and protein
		let eatK = 0, eatP = 0, treeK = 0, nutK = 0;
		for (const [k, d] of Object.entries(G)) {
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
	return { out: (outM2 * (1 - OUTDOOR.loss.v)) / f.out.total, in: (inM2 * (1 - INDOOR.loss.v)) / f.in.total, get all() { return this.out + this.in; } };
}

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
