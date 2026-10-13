// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE RECORDS — what Proposition 3 is judged on, written every day, per person, never as an average.
 *
 * Every day: each person's share of each basic (food, water, energy, a bed) against need; the person-days short;
 * the owner-only cohort's two tests (strict: today's Law 5 dividends alone pay today's basic bundle; normal: the
 * person met every basic and still holds MIND); each decile's living-standard index (what its people consumed,
 * valued at base-year prices: by holdings, and by Aven output); the physics ceiling per good (what the plants could
 * give a person today if nothing but physics bound); and the binding-limit badge of each good.
 *
 * Arrays grow by doubling, so a world can run as long as it likes; ./prop3.js reads them.
 */
import { BASICS, CONSUMER, COMPUTE, ENERGY, FOOD, WATER, G, LIMIT, LIMIT_NAMES, BED, PHYSICAL, GOODS_, SPRING, WOOD, STEEL, GLASS, PANEL, GOOD_IDS, CLASS } from './consts.js';
import { capDayOf, plantCapDay } from './genesis.js';
import { DAYS_IN_MONTH, CHIPS, BORDER } from './primitives.js';
import { monthOf } from './energy.js';
import { reserveEur, IMPORT_KINDS } from './border.js';
import { indoorMonths, dietFacts, peopleFed, DIETS, YIELDS } from './food.js';

const SERIES = {
	minMet: 4, // the lowest share of need met by anyone, per basic
	shortN: 4, // how many people were short (< 98 %) of each basic
	shortAny: 1, // how many people were short of any basic
	strict: 1, // owner-only: the lowest ratio of today's dividends to today's basic bundle
	strictMed: 1, // owner-only: the median of that ratio
	ownerMet: 1, // owner-only: the lowest share of a basic met
	ownerHoldDays: 1, // owner-only: the lowest holding, in days of today's basic bundle
	decH: 10, // living standard (R at base-year prices a day) by holdings decile
	decA: 10, // living standard by Aven output decile
	decHx: 10, // the same without Aven services (compute): basics, goods and spring time only
	decAx: 10,
	decHE: 10, // a person's own energy use (kWh a day) by holdings decile
	decAE: 10,
	decHW: 10, // holdings (R) by holdings decile
	Lmin: 1, // the lowest living standard of anyone
	Lmean: 1,
	Lceil: 1, // the capacity ceiling of the living standard: satiation where the plants standing today allow it, a person (mean)
	LceilX: 1, // the same without Aven services
	unpaidR: 1, // goods and energy delivered today that were not paid for (R): a rule breach, reported
	ceil: G, // physics ceiling per good, a person a day (in the good's unit)
	badge: G, // binding limit per good (LIMIT codes)
	pbar: G, // expected price per good, R
	ePP: 1, // all electricity used, a person a day (kWh)
	surplusPP: 1, // surplus energy (R&D, storage, curtailed), a person a day
	exportPP: 1, // electricity exported across the border for accelerators (the euro reserve, paper §11.4), a person a day
	rdKwh: 1, // R&D energy delivered
	N: 1,
	basicCostR: 1,
	divMeanR: 1,
	holdMeanR: 1,
	ownerShort: 1, // owner-only people short (< 98 %) of any basic
	ownerL: 1, // owner-only: mean living standard
	cons: G, // what a person got of each good, on average (the good's unit a day): real consumption
	limitMin: 4 // the lowest ratio of anyone's limit (the most they could pay a unit) to the expected price, per basic
};

/** start the records of a world */
export function initRecords(w) {
	const cap = 512;
	// counters are exact and never capped; the lists beside them keep only the first examples
	const rec = { n: 0, cap, shortPD: new Float64Array(4), shortAnyPD: 0, personShort: new Int32Array(w.Nmax), worst: { met: Infinity, i: -1, day: -1, g: -1 }, mindViolations: [], mindDayGoods: 0, mindDayGoodsBy: new Float64Array(4), mindDays: 0, strictDays: 0, normalFail: [], normalFailPD: 0 };
	for (const [k, width] of Object.entries(SERIES)) rec[k] = new Float32Array(cap * width);
	rec.width = SERIES;
	w.rec = rec;
	// the yearly tables (living standards by tenth, the village's food and energy, the border's ledger): sums kept as
	// the days run, so reading them is cheap at any time (./records.js livingYears, villageYears, borderYears)
	rec.years = [];
	rec.shortYear = new Int32Array(w.Nmax).fill(-1);
}

/** the living-standard measures of the yearly table, a person: their sums over the year's person-days */
const LIV = ['kcal', 'protein', 'homeM2', 'waterL', 'homeKwh', 'avenH', 'goodsKg', 'pondH'];
const TENTHS = { poorest: 0, middle: 4, richest: 9 };

function newYear(w, y) {
	return {
		year: y + 1,
		days: 0,
		// [tenth 0..9, everyone 10] × measures: sums over person-days, and person-days
		liv: new Float64Array(11 * LIV.length),
		pd: new Float64Array(11),
		short: new Float64Array(11), // people short of a basic on at least one day this year, by their tenth that day
		shortAll: 0,
		food: { outdoors: 0, indoors: 0, imported: 0, eaten: 0, led: 0, unpicked: 0, lost: 0, rotted: 0 },
		season: { weather: 1, tree: 1, frost: false },
		indoorMonth: new Float64Array(12),
		monthDays: new Float64Array(12),
		peopleDays: 0,
		energy: { solar: 0, geothermal: 0, battery: 0, basics: 0, running: 0, building: 0, rd: 0, export: 0, storage: 0, curtailed: 0, heatPump: 0 },
		badges: new Float64Array(G * 32),
		imp: Object.fromEntries(IMPORT_KINDS.map((k) => [k, 0])),
		impEur: Object.fromEntries(IMPORT_KINDS.map((k) => [k, 0])),
		exportKwh: 0,
		exportEur: 0,
		exportBy: new Float64Array(G),
		sharedDrawn: 0,
		reserveEur: 0,
		reserveMin: Infinity,
		sharedEur: 0,
		impShortDays: 0,
		solarKwp: 0,
		people: 0,
		drawStart: w.border?.drawShared ?? 0
	};
}

/** add today to this year's sums (called from recordDay) */
function yearDay(w, protD) {
	const rec = w.rec, y = Math.floor(w.day / 365);
	let Y = rec.years[y];
	if (!Y) Y = rec.years[y] = newYear(w, y);
	const N = w.N, c = w.c, t = w.today, nL = LIV.length;
	Y.days++;
	Y.peopleDays += N;
	const homeM2 = c.homeM2PerBed;
	for (let i = 0; i < N; i++) {
		const o = i * G, d = w.decH[i];
		const f = w.q[o + FOOD];
		const v = [f * 1000, f * protD, w.q[o + BED] * homeM2, w.q[o + WATER], w.q[o + ENERGY], w.q[o + COMPUTE], w.q[o + GOODS_], w.q[o + SPRING]];
		for (let m = 0; m < nL; m++) (Y.liv[d * nL + m] += v[m]), (Y.liv[10 * nL + m] += v[m]);
		Y.pd[d]++;
		Y.pd[10]++;
		let short = false;
		for (let b = 0; b < 4; b++) if (w.q[o + b] / c.need[b] < 0.98) short = true;
		if (short && w.day > 0 && rec.shortYear[i] !== y) {
			rec.shortYear[i] = y;
			Y.short[d]++;
			Y.shortAll++;
		}
	}
	const m = monthOf(w.day);
	Y.food.outdoors += t.foodOut ?? 0;
	Y.food.indoors += t.foodIn ?? 0;
	Y.food.imported += t.imp?.food ?? 0;
	Y.food.led += t.ledUnits ?? 0;
	Y.food.unpicked += t.unpicked ?? 0;
	Y.food.lost += t.foodLost ?? 0;
	Y.food.rotted += t.rotted[FOOD] - (t.foodLost ?? 0);
	Y.food.eaten += t.eaten[FOOD];
	// the outdoor season's weather factor (its last value: April–September once September is over) and the tree crop
	Y.season.weather = t.outWx ?? 1;
	Y.season.tree = t.treeF ?? 1;
	Y.season.frost = !!w.foodWx?.frost;
	Y.indoorMonth[m] += (t.foodIn ?? 0) / Math.max(1, N);
	Y.monthDays[m]++;
	const h = t.harvest, E = Y.energy;
	E.solar += h.solar;
	E.geothermal += h.geo;
	E.battery += h.battery;
	E.basics += t.use[CLASS.basics];
	E.running += t.use[CLASS.running];
	E.building += t.use[CLASS.building];
	E.rd += t.use[CLASS.rd];
	E.export += t.exportKwh ?? 0;
	E.storage += t.use[CLASS.storage];
	E.curtailed += t.curtailed;
	E.heatPump += t.heatPumpKwh ?? 0;
	for (let g = 0; g < G; g++) Y.badges[g * 32 + (w.badge[g] | 0)]++;
	if (t.imp) for (const k of IMPORT_KINDS) (Y.imp[k] += t.imp[k] ?? 0), (Y.impEur[k] += t.impEur[k] ?? 0);
	Y.exportKwh += t.exportKwh ?? 0;
	Y.exportEur += (t.exportKwh ?? 0) * c.eurPerKwh;
	if (t.exportBy) for (let g = 0; g < G; g++) Y.exportBy[g] += t.exportBy[g];
	if ((t.impShort ?? 0) > 1e-9) Y.impShortDays++;
	Y.reserveEur = reserveEur(w);
	Y.reserveMin = Math.min(Y.reserveMin, Y.reserveEur);
	Y.sharedEur = w.border.shared;
	Y.sharedDrawn = w.border.drawShared - Y.drawStart;
	let kwp = 0;
	for (const co of w.coops) if (co.alive && co.good === ENERGY) for (const pl of co.plants) if (pl.tech === 'solar') kwp += Math.max(0, pl.cap - pl.worn);
	Y.solarKwp = kwp;
	Y.people = N;
}

function grow(rec) {
	const cap = rec.cap * 2;
	for (const [k, width] of Object.entries(SERIES)) {
		const a = new Float32Array(cap * width);
		a.set(rec[k]);
		rec[k] = a;
	}
	rec.cap = cap;
}

/**
 * Write today's records. `q` holds what each person got of each good today (w.q, N × G), `w.basicCost[i]` what
 * the full basic bundle cost that person today at the prices they paid.
 */
export function recordDay(w) {
	const rec = w.rec, N = w.N, c = w.c, d = rec.n;
	if (d >= rec.cap) grow(rec);
	// protein a unit of the food eaten today: the food sellers' stores' mix, by what each sold
	let pu = 0, ps = 0;
	for (const co of w.coops) if (co.alive && co.good === FOOD && co.sold > 0) (pu += co.sold), (ps += co.sold * (co.protD ?? c.protImp));
	const protD = pu > 0 ? ps / pu : c.protImp;
	const need = c.need, p0 = c.p0g;
	const minMet = [Infinity, Infinity, Infinity, Infinity];
	const shortN = [0, 0, 0, 0];
	let Lmin = Infinity, Lsum = 0, shortAny = 0;
	const decL = new Float64Array(20), decLx = new Float64Array(20), decE = new Float64Array(20), decW = new Float64Array(10), decN = new Float64Array(20);
	let strictMin = Infinity, ownerMet = Infinity, ownerHold = Infinity;
	const ratios = [];
	let divSum = 0, holdSum = 0, ownerShort = 0, ownerL = 0, ownerN = 0;
	const limMin = [Infinity, Infinity, Infinity, Infinity], cons = new Float64Array(G);
	for (let i = 0; i < N; i++) {
		const o = i * G;
		let m = Infinity, short = false;
		for (let b = 0; b < 4; b++) {
			const x = w.q[o + b] / need[b];
			if (x < minMet[b]) minMet[b] = x;
			if (x < 0.98) {
				shortN[b]++;
				if (w.day > 0) rec.shortPD[b]++;
				short = true;
			}
			if (x < m) m = x;
			if (w.day > 0 && x < rec.worst.met) rec.worst = { met: x, i, day: w.day, g: b };
			const lr = w.pbar[b] > 0 ? w.limit[i * 4 + b] / w.pbar[b] : Infinity;
			if (lr < limMin[b]) limMin[b] = lr;
		}
		for (const g of CONSUMER) cons[g] += w.q[o + g];
		w.met[i] = m;
		if (short) shortAny++;
		if (short && w.day > 0) {
			rec.shortAnyPD++;
			rec.personShort[i]++;
		}
		// the living-standard index L = Σ q_g · p0_g · Q_g (world model 1). The quality index Q_g is held at 1 for every
		// good: this engine's innovation (./coops.js learn) lowers what a unit takes to make (inputs, energy, land), it
		// does not make a better unit, so there is no quality ladder to read Q_g from. The index is therefore read with
		// and without Aven services (Lx), which are most of it
		let L = 0;
		for (const g of CONSUMER) L += w.q[o + g] * p0[g];
		const Lx = L - w.q[o + COMPUTE] * p0[COMPUTE];
		w.L[i] = L;
		Lsum += L;
		if (L < Lmin) Lmin = L;
		const dh = w.decH[i], da = 10 + w.decA[i];
		decL[dh] += L;
		decL[da] += L;
		decLx[dh] += Lx;
		decLx[da] += Lx;
		decE[dh] += w.q[o + ENERGY];
		decE[da] += w.q[o + ENERGY];
		decW[dh] += w.wealth[i];
		decN[dh]++;
		decN[da]++;
		divSum += w.div[i];
		holdSum += w.wealth[i];
		if (w.owner[i]) {
			const r = w.basicCost[i] > 0 ? w.div[i] / w.basicCost[i] : 0;
			ratios.push(r);
			if (r < strictMin) strictMin = r;
			if (m < ownerMet) ownerMet = m;
			const hd = w.basicCost[i] > 0 ? w.wealth[i] / w.basicCost[i] : 0;
			if (hd < ownerHold) ownerHold = hd;
			if (w.day > 0 && (m < 0.98 || !(w.wealth[i] > 0))) {
				rec.normalFailPD++;
				if (rec.normalFail.length < 200) rec.normalFail.push({ day: w.day, i, met: m, hold: w.wealth[i] });
			}
			if (m < 0.98) ownerShort++;
			ownerL += L;
			ownerN++;
		}
	}
	for (let b = 0; b < 4; b++) {
		rec.minMet[d * 4 + b] = minMet[b];
		rec.shortN[d * 4 + b] = shortN[b];
		rec.limitMin[d * 4 + b] = limMin[b];
	}
	for (let g = 0; g < G; g++) rec.cons[d * G + g] = cons[g] / N;
	rec.ownerShort[d] = ownerShort;
	rec.shortAny[d] = shortAny;
	rec.ownerL[d] = ownerN ? ownerL / ownerN : NaN;
	ratios.sort((a, b) => a - b);
	rec.strict[d] = ratios.length ? strictMin : NaN;
	rec.strictMed[d] = ratios.length ? ratios[ratios.length >> 1] : NaN;
	rec.ownerMet[d] = ratios.length ? ownerMet : NaN;
	rec.ownerHoldDays[d] = ratios.length ? ownerHold : NaN;
	for (let x = 0; x < 10; x++) {
		rec.decH[d * 10 + x] = decN[x] ? decL[x] / decN[x] : NaN;
		rec.decA[d * 10 + x] = decN[10 + x] ? decL[10 + x] / decN[10 + x] : NaN;
		rec.decHx[d * 10 + x] = decN[x] ? decLx[x] / decN[x] : NaN;
		rec.decAx[d * 10 + x] = decN[10 + x] ? decLx[10 + x] / decN[10 + x] : NaN;
		rec.decHE[d * 10 + x] = decN[x] ? decE[x] / decN[x] : NaN;
		rec.decAE[d * 10 + x] = decN[10 + x] ? decE[10 + x] / decN[10 + x] : NaN;
		rec.decHW[d * 10 + x] = decN[x] ? decW[x] / decN[x] : NaN;
	}
	rec.Lmin[d] = Lmin;
	rec.Lmean[d] = Lsum / N;
	// the physics ceiling and the badges
	// a good's ceiling is the capacity standing today only while physics (or the closed border) stops it from growing
	// (its binding limit is land, water, energy, a material, ore, sand, nature, accelerators …); a good held back by
	// built capacity, demand, a treasury or an empty slot could be built up, so its ceiling is satiation. Otherwise a
	// city that let its plants wear down would lower its own ceiling and pass "within 5 % of the ceiling"
	const ceil = physicsCeiling(w);
	let Lc = 0, cComp = 0;
	for (const g of CONSUMER) {
		const sat = g === BED ? 1 : c.sat[g];
		const x = (PHYSICAL.includes(w.badge[g]) ? Math.min(sat, ceil[g]) : sat) * p0[g];
		Lc += x;
		if (g === COMPUTE) cComp = x;
	}
	rec.Lceil[d] = Lc;
	rec.LceilX[d] = Lc - cComp;
	rec.unpaidR[d] = w.unpaidR - (w.unpaidPrev ?? 0);
	w.unpaidPrev = w.unpaidR;
	for (let g = 0; g < G; g++) {
		rec.ceil[d * G + g] = ceil[g];
		rec.badge[d * G + g] = w.badge[g];
		rec.pbar[d * G + g] = w.pbar[g];
	}
	let mindToday = false;
	for (const b of BASICS)
		if (w.badge[b] === LIMIT.mind && ceil[b] >= need[b] && w.day > 0) {
			rec.mindDayGoods++;
			rec.mindDayGoodsBy[b]++;
			mindToday = true;
			if (rec.mindViolations.length < 500) rec.mindViolations.push({ day: w.day, good: b, minMet: minMet[b] });
		}
	if (mindToday) rec.mindDays++;
	if (w.day > 0) {
		let ok = ratios.length > 0;
		for (const r of ratios) if (!(r >= 1)) ok = false;
		if (ok) rec.strictDays++;
	}
	const t = w.today;
	yearDay(w, protD);
	// the electricity the city used (the export across the border for accelerators is not use: it is its own series)
	let used = 0;
	for (let cl = 0; cl < 4; cl++) used += t.use[cl];
	rec.ePP[d] = used / N;
	rec.exportPP[d] = (t.exportKwh ?? 0) / N;
	rec.surplusPP[d] = t.surplusKwh / N;
	rec.rdKwh[d] = t.use[3];
	rec.N[d] = N;
	rec.basicCostR[d] = t.basicCostR;
	rec.divMeanR[d] = divSum / N;
	rec.holdMeanR[d] = holdSum / N;
	rec.n = d + 1;
}

/**
 * The capacity ceiling of each good today, a person a day (the mean over people, not any one person's ceiling): what
 * the plants standing today could give if nothing but physics bound them (no price, no MIND). Food: the forest's year
 * at its age and the growing dome at capacity; water: the tanks' average rain and the well up to the aquifer's
 * recharge; energy: today's harvest and the battery; beds, goods, spring time: built capacity. Materials: capacity
 * of the works. Plants the City COOP holds idle (a failed COOP's, with no seller yet) count: they stand, and only an
 * institution keeps them idle. It follows what COOPs chose to build (they build toward demand), so it is a capacity
 * figure, not a bound set by land, energy and deposits alone.
 */
export function physicsCeiling(w) {
	const out = new Float64Array(G);
	for (const co of w.coops) if (co.alive) out[co.good] += co.capDay >= 0 ? co.capDay : capDayOf(w, co, w.day);
	const city = w.coops[w.cityK];
	for (const pl of city?.idle ?? []) out[pl.def.good] += plantCapDay(w, pl, w.day);
	// energy: what the harvest leaves for people's own use once the other basics have theirs (water pumping, food
	// processing, the domes' climate and the heat pumps for their heat, at today's deliveries)
	const t = w.today, h = t.harvest;
	const other = Math.max(0, (t.req?.[0] ?? 0) - (t.pBasic ?? 0)) + (t.heatPump?.basics ?? 0);
	out[ENERGY] = Math.max(0, h.solar + h.geo + h.battery - other);
	for (let g = 0; g < G; g++) out[g] /= Math.max(1, w.N);
	return out;
}

/** a recorded series as a plain array of one column (for the page and the proof) */
export function series(w, key, col = 0) {
	const rec = w.rec, width = rec.width[key];
	const out = new Array(rec.n);
	for (let d = 0; d < rec.n; d++) out[d] = rec[key][d * width + col];
	return out;
}

export { SERIES };

// ── the yearly tables for the page and the proof ─────────────────────────────────────────────────────────────────
/** plain words for a binding limit */
const PLAIN = {
	[LIMIT.none]: 'nothing: everyone had what they asked for',
	[LIMIT.capacity]: 'what is built (more could be built)',
	[LIMIT.land]: 'land',
	[LIMIT.water]: 'water (the aquifer’s recharge)',
	[LIMIT.energy]: 'electricity',
	[LIMIT.wood]: 'glulam for the works',
	[LIMIT.steel]: 'steel for the works',
	[LIMIT.glass]: 'glass for the works',
	[LIMIT.panel]: 'solar panels',
	[LIMIT.ramp]: 'the young food forest (it is still growing)',
	[LIMIT.mind]: 'people’s MIND (they could not pay)',
	[LIMIT.nature]: 'nature (sun, rain, the warm ponds)',
	[LIMIT.demand]: 'what people want at today’s prices',
	[LIMIT.logs]: 'logs',
	[LIMIT.noSeller]: 'no seller (plants stand idle)',
	[LIMIT.notBuilt]: 'nobody built more (free land)',
	[LIMIT.chips]: 'accelerators',
	[LIMIT.treasury]: 'a COOP’s treasury (cannot carry a build)',
	[LIMIT.noSlot]: 'no room for a new COOP',
	[LIMIT.importDear]: 'accelerators cost more euros than they earn back',
	[LIMIT.euros]: 'euros at the border (no exports yet, the reserve empty)'
};
const per = (x, Y) => (Y.peopleDays > 0 ? x / Y.peopleDays : 0);

/**
 * Living standards by tenth of MIND holdings, a year at a time (the poorest tenth, the middle (5th) tenth, the
 * richest tenth, and everyone): a person a day, the year's mean. Cheap: the sums are kept as the days run.
 */
export function livingYears(w) {
	const out = [], nL = LIV.length;
	for (const Y of w.rec?.years ?? []) {
		if (!Y) continue;
		const row = (d) => {
			const pd = Math.max(1, Y.pd[d]);
			const v = (m) => Y.liv[d * nL + LIV.indexOf(m)] / pd;
			return { kcal: v('kcal'), protein: v('protein'), homeM2: v('homeM2'), waterL: v('waterL'), homeKwh: v('homeKwh'), avenH: v('avenH'), goodsKgYear: v('goodsKg') * 365, pondHWeek: v('pondH') * 7, shortPeople: Y.short[d] };
		};
		const tenths = {};
		for (const [k, d] of Object.entries(TENTHS)) tenths[k] = row(d);
		const all = row(10);
		all.shortPeople = Y.shortAll;
		out.push({ year: Y.year, days: Y.days, people: Y.people, tenths, all, shortPeople: Y.shortAll });
	}
	return out;
}

/** the year's most frequent limit of a good, in plain words (and its share of the days) */
function bindOf(Y, g) {
	let best = 0, n = -1;
	for (let x = 0; x < 32; x++) if (Y.badges[g * 32 + x] > n) (n = Y.badges[g * 32 + x]), (best = x);
	return { code: best, words: PLAIN[best] ?? LIMIT_NAMES[best] ?? String(best), share: Y.days > 0 ? n / Y.days : 0 };
}

/**
 * The village a year at a time: food grown outdoors, grown indoors, bought at the border and eaten (kcal a person a
 * day); the food domes' kcal a person a day by month; electricity made and where it went (kWh a person a day); and
 * what bound each good most days, in plain words.
 */
export function villageYears(w) {
	const out = [];
	for (const Y of w.rec?.years ?? []) {
		if (!Y) continue;
		const k = (u) => per(u * 1000, Y);
		const E = Y.energy;
		const binds = {};
		for (const [id, g] of [['food', FOOD], ['water', WATER], ['energy', ENERGY], ['bed', BED], ['goods', GOODS_], ['spring', SPRING], ['compute', COMPUTE], ['glulam', WOOD], ['steel', STEEL], ['glass', GLASS], ['panels', PANEL]]) binds[id] = bindOf(Y, g);
		out.push({
			year: Y.year,
			days: Y.days,
			food: { outdoors: k(Y.food.outdoors), indoors: k(Y.food.indoors), imported: k(Y.food.imported), eaten: k(Y.food.eaten), led: k(Y.food.led), lost: k(Y.food.lost), rotted: k(Y.food.rotted), unpicked: k(Y.food.unpicked) },
			season: { ...Y.season },
			indoorByMonth: Array.from(Y.indoorMonth, (x, m) => (Y.monthDays[m] > 0 ? (x * 1000) / Y.monthDays[m] : null)),
			energy: {
				made: { solar: per(E.solar, Y), geothermal: per(E.geothermal, Y), battery: per(E.battery, Y) },
				went: { basics: per(E.basics, Y), running: per(E.running, Y), building: per(E.building, Y), rd: per(E.rd, Y), export: per(E.export, Y), storage: per(E.storage, Y), curtailed: per(E.curtailed, Y) },
				heatPumps: per(E.heatPump, Y)
			},
			solarKwp: Y.solarKwp,
			binds: Object.fromEntries(Object.entries(binds).map(([id, b]) => [id, b.words])),
			bindShare: Object.fromEntries(Object.entries(binds).map(([id, b]) => [id, b.share]))
		});
	}
	return out;
}

/** the food domes at maturity by month, kcal a person a day, with and without LED light (./food.js) */
export function indoorMonthsOf(w) {
	let m2 = 0;
	for (const co of w.coops) if (co.alive) for (const pl of co.plants) if (pl.tech === 'greenhouse') m2 += Math.max(0, pl.cap - pl.worn);
	return indoorMonths(m2 * (w.cfg.forestYield ?? 1), Math.max(1, w.N), w.c.ghGrown * 1000);
}

/**
 * The diet and the land it takes (cheap: no pass over the days): what a person eats (grams of each group, kcal and
 * protein a day), the m² a person needs outdoors and under glass at maturity, the kcal a m² gives, and how many people
 * the village's food land feeds at maturity in an average year after the harvest's losses (outdoors, under glass, all);
 * then, from the run so far, the first year the village fed itself and the last year it bought food.
 */
export function foodLand(w) {
	const c = w.c, f = dietFacts(c.diet, c.foodYields), V = c.village;
	const outM2 = V.outdoorFoodM2 * c.vf, inM2 = V.indoorFoodM2 * c.vf;
	const fed = peopleFed(f, outM2 * (w.cfg.forestYield ?? 1), inM2 * (w.cfg.forestYield ?? 1));
	const D = DIETS[f.diet];
	let firstFed = null, lastImport = null;
	for (const Y of w.rec?.years ?? []) {
		if (!Y || Y.days < 365) continue;
		const fedSelf = Y.food.eaten > 0 && Y.food.imported <= 0.01 * Y.food.eaten;
		if (fedSelf && firstFed == null) firstFed = Y.year;
		if (!fedSelf) lastImport = Y.year;
	}
	return {
		diet: f.diet,
		dietLabel: f.label,
		yields: f.yields,
		yieldsLabel: YIELDS[f.yields]?.label ?? f.yields,
		groups: Object.fromEntries(Object.entries(D.groups).map(([k, d]) => [k, { label: d.label, g: d.g, kcal: (d.g / 1000) * d.kcal, protein: (d.g / 1000) * d.protein }])),
		kcalDay: f.kcalDay,
		proteinDay: f.proteinDay,
		landM2: { out: f.out.total, in: f.in.total, outByGroup: f.out.m2, inByGroup: f.in.m2 },
		kcalM2Year: { out: f.out.kcalM2Year, in: f.in.kcalM2Year },
		foodHa: { out: outM2 / 1e4, in: inM2 / 1e4 },
		peopleFed: { out: fed.out, in: fed.in, all: fed.all },
		people: w.N,
		firstFedYear: firstFed,
		lastImportYear: lastImport
	};
}

/**
 * The border's ledger a year at a time: what the COOPs bought (food in kcal for the whole village, logs, scrap and
 * float glass in t, cells in kWp, accelerators in units) and what it cost in €, what the line's exports earned, the
 * euro reserve at the year's end (the founding euros left and the COOPs' accounts), whether the village fed itself
 * (food bought under 1 % of food eaten) and whether exports paid for all imports.
 */
export function borderYears(w) {
	const out = [];
	for (const Y of w.rec?.years ?? []) {
		if (!Y) continue;
		const imports = {
			food: { kcal: Y.imp.food * 1000, eur: Y.impEur.food },
			logs: { t: Y.imp.logs, eur: Y.impEur.logs },
			scrap: { t: Y.imp.scrap, eur: Y.impEur.scrap },
			float: { t: Y.imp.float, eur: Y.impEur.float },
			cells: { kwp: Y.imp.cells, eur: Y.impEur.cells },
			glulam: { t: Y.imp.glulam, eur: Y.impEur.glulam },
			steel: { t: Y.imp.steel, eur: Y.impEur.steel },
			glazing: { t: Y.imp.glazing, eur: Y.impEur.glazing },
			panels: { kwp: Y.imp.panels, eur: Y.impEur.panels },
			accelerators: { n: Y.imp.chips, eur: Y.impEur.chips }
		};
		const importEur = IMPORT_KINDS.reduce((a, k) => a + Y.impEur[k], 0);
		out.push({
			year: Y.year,
			days: Y.days,
			imports,
			importEur,
			exportKwh: Y.exportKwh,
			exportEur: Y.exportEur,
			exportByGood: Object.fromEntries(GOOD_IDS.map((id, g) => [id, Y.exportBy[g] * w.c.eurPerKwh]).filter(([, v]) => v > 0)),
			reserveEur: Y.reserveEur,
			foundingLeftEur: Y.sharedEur,
			foundingDrawnEur: Y.sharedDrawn,
			// the lowest the reserve went that year, and days a COOP could not pay for all it wanted to import (the
			// reserve, its own account included, was empty: its buyers got less)
			reserveMinEur: Y.reserveMin,
			importShortDays: Y.impShortDays,
			reserveOut: Y.impShortDays > 0,
			fedSelf: Y.food.eaten > 0 && Y.food.imported <= 0.01 * Y.food.eaten,
			exportsCover: Y.exportEur >= importEur - 1e-6
		});
	}
	return out;
}

/** what the village holds on day 0 that was bought outside before it (called by ./engine.js createWorld) */
export function foundingStores(w) {
	const st = { food: 0, mat: new Float64Array(G), raw: {}, chips: 0, chipsInstalled: 0 };
	for (const co of w.coops) {
		if (co.good === FOOD) st.food += co.stock;
		else if ([WOOD, STEEL, GLASS, PANEL].includes(co.good)) st.mat[co.good] += co.stock;
		for (let g = 0; g < G; g++) st.mat[g] += co.inStock[g];
		st.chips += co.chips ?? 0;
		for (const pl of co.plants) {
			const ro = pl.def.inputs.find(([g]) => typeof g === 'string');
			if (ro && pl.raw > 0) st.raw[ro[0]] = (st.raw[ro[0]] ?? 0) + pl.raw;
			if (pl.def.build.chips) st.chipsInstalled += pl.cap * pl.def.build.chips;
		}
	}
	st.reserveEur = w.border.shared;
	return st;
}

/**
 * The founding bill: what was bought outside to build and stock the village before day 0, in tonnes and €. Sandbox
 * 6's village (src/lib/sandbox-7: its shells, putting them up, the fit-out, the machines and the land), the
 * accelerators in the Aven-service halls, the stores of food, materials and raw inputs, and the euros left over in the
 * reserve. Rows not in tonnes carry kwp, n, kcal or m2.
 */
export function foundingBill(w) {
	const V = w.c.village, vf = w.c.vf, F = w.founding, E = w.c.eur, P = V.prices;
	const rows = [];
	const mat = Object.fromEntries(V.materials.map((m) => [m.id, m]));
	const add = (id, label, o) => rows.push({ id, label, ...o });
	add('glulam', 'Glulam struts and north cassettes', { t: (mat.timber?.t ?? 0) * vf, m3: (mat.timber?.qty ?? 0) * vf, eur: (mat.timber?.eur ?? 0) * vf, group: 'shells' });
	add('clt', 'CLT and glulam floors inside', { t: (mat.clt?.t ?? 0) * vf, m3: (mat.clt?.qty ?? 0) * vf, eur: (mat.clt?.eur ?? 0) * vf, group: 'inside' });
	add('steel', 'Steel hubs, ring and connectors', { t: (mat.steel?.t ?? 0) * vf, eur: (mat.steel?.eur ?? 0) * vf, group: 'shells' });
	add('glass', 'Laminated double glazing', { t: (mat.glass?.t ?? 0) * vf, m2: (mat.glass?.qty ?? 0) * vf, eur: (mat.glass?.eur ?? 0) * vf, group: 'shells' });
	add('cells', 'See-through solar cells in the glass', { t: null, m2: (mat.pv?.qty ?? 0) * vf, kwp: (V.solarKwh * vf) / w.c.kwhPerKwp, eur: (mat.pv?.eur ?? 0) * vf, group: 'shells' });
	add('hemp', 'Hemp-fibre insulation (north side)', { t: (mat.hemp?.t ?? 0) * vf, eur: (mat.hemp?.eur ?? 0) * vf, group: 'shells' });
	add('lime', 'Lime-pozzolan footings', { t: (mat.lime?.t ?? 0) * vf, eur: (mat.lime?.eur ?? 0) * vf, group: 'shells' });
	if (mat.concrete) add('concrete', 'Screed and slabs (lime/LC3 concrete)', { t: mat.concrete.t * vf, eur: mat.concrete.eur * vf, group: 'inside' });
	const shellEur = rows.filter((r) => r.group === 'shells').reduce((a, r) => a + r.eur, 0);
	add('assembly', V.cost[1].label, { t: null, eur: V.cost[1].eur * vf, group: 'work' });
	const insideEur = rows.filter((r) => r.group === 'inside').reduce((a, r) => a + r.eur, 0);
	add('fitout', 'Fit-out inside the domes beyond the CLT (homes, halls, workshops)', { t: null, eur: Math.max(0, V.cost[2].eur * vf - insideEur), group: 'work' });
	add('machines', V.cost[3].label, { t: null, eur: V.cost[3].eur * vf, group: 'machines' });
	add('land', V.cost[4].label, { t: null, ha: (V.landM2 * vf) / 1e4, eur: V.cost[4].eur * vf, group: 'land' });
	const chips = F.chips + F.chipsInstalled;
	add('accelerators', 'Accelerators for the Aven-service halls (installed and spares)', { t: null, n: chips, eur: chips * w.c.chipEur, group: 'machines' });
	add('foodStore', `Food in the stores (${Math.round(w.c.foodStoreDays)} days, the diet at wholesale)`, { t: null, kcal: F.food * 1000, eur: F.food * E.food, group: 'stores' });
	const matEur = { [WOOD]: (P.glulam.eur / 0.55), [STEEL]: P.steel.eur, [GLASS]: P.glass.eur / 0.05, [PANEL]: (P.pv.eur * w.c.kwhPerKwp) / 227 };
	add('materialStores', 'Glulam, steel, glass and panels in the works’ and builders’ stores (a month)', { t: F.mat[WOOD] + F.mat[STEEL] + F.mat[GLASS], kwp: F.mat[PANEL], eur: F.mat[WOOD] * matEur[WOOD] + F.mat[STEEL] * matEur[STEEL] + F.mat[GLASS] * matEur[GLASS] + F.mat[PANEL] * matEur[PANEL], group: 'stores' });
	for (const [k, label, unit] of [['logs', 'Logs for the timber works (a month)', 't'], ['scrap', 'Steel scrap for the arc furnace (a month)', 't'], ['float', 'Float glass for the glassworks (a month)', 't'], ['cells', 'Solar cells for the panel works (a month)', 'kwp']])
		if (F.raw[k] > 0) add(`raw-${k}`, label, { t: unit === 't' ? F.raw[k] : null, kwp: unit === 'kwp' ? F.raw[k] : undefined, eur: F.raw[k] * E[k], group: 'stores' });
	const builtEur = rows.reduce((a, r) => a + r.eur, 0);
	add('reserve', `Euros left in the reserve (${w.c.reserveYears} year${w.c.reserveYears === 1 ? '' : 's'} of the village’s food at wholesale)`, { t: null, eur: F.reserveEur, group: 'reserve' });
	return {
		rows,
		builtEur,
		totalEur: builtEur + F.reserveEur,
		reserveEur: F.reserveEur,
		foodStoreDays: w.c.foodStoreDays,
		tonnes: rows.reduce((a, r) => a + (typeof r.t === 'number' ? r.t : 0), 0),
		sources: { village: 'src/lib/sandbox-7 stats.js (Sandbox 6’s village): shells, putting them up, fit-out, machines, land', prices: 'src/lib/sandbox-7 specs.js PRICES and SOURCES; ./primitives.js BORDER and CHIPS', tower: V.tower ? 'with the Tower180' : `without the tower: the centre hex’s middle holds one more Dome120; the tower’s 1 MW data centre and water works dropped (−€${(V.droppedEur / 1e6).toFixed(1)}M)` }
	};
}
