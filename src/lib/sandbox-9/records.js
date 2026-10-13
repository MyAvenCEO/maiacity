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
import { DAYS_IN_MONTH, CHIPS, BORDER, FOOD as FOOD_R } from './primitives.js';
import { monthOf } from './energy.js';
import { reserveEur, IMPORT_KINDS, advancesOwed } from './border.js';
import { chipsOf } from './ai.js';
import { indoorMonths, dietFacts, peopleFed, peopleFedByGroup, splitYields, DIETS, YIELDS } from './food.js';

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
const LIV = ['kcal', 'protein', 'homeM2', 'waterL', 'homeKwh', 'avenH', 'goodsKg', 'pondH', 'bed', 'workH', 'incHearts', 'incWork', 'incDiv'];
const TENTHS = { poorest: 0, middle: 4, richest: 9 };

function newYear(w, y) {
	return {
		year: y + 1,
		days: 0,
		// [tenth 0..9, everyone 10] × measures: sums over person-days, and person-days
		liv: new Float64Array(11 * LIV.length),
		pd: new Float64Array(11),
		// the same by tenth of Aven output
		livA: new Float64Array(10 * LIV.length),
		pdA: new Float64Array(10),
		short: new Float64Array(11), // people short of a basic on at least one day this year, by their tenth that day
		shortAll: 0,
		food: { outdoors: 0, indoors: 0, imported: 0, eaten: 0, led: 0, unpicked: 0, lost: 0, rotted: 0, irrigM3: 0 },
		season: { weather: 1, tree: 1, frost: false },
		indoorMonth: new Float64Array(12),
		monthDays: new Float64Array(12),
		peopleDays: 0,
		energy: { solar: 0, geothermal: 0, battery: 0, basics: 0, running: 0, building: 0, rd: 0, export: 0, storage: 0, curtailed: 0, heatPump: 0 },
		badges: new Float64Array(G * 32),
		imp: Object.fromEntries(IMPORT_KINDS.map((k) => [k, 0])),
		impEur: Object.fromEntries(IMPORT_KINDS.map((k) => [k, 0])),
		// the settlement COOPs' rents: beds sold and their price (R), dome floor rented and its rate, rent paid (R), and
		// what a euro was worth in R (the bank's rate) summed over the days
		rent: { bedR: 0, beds: 0, m2R: 0, m2: 0, paidR: 0, eurR: 0, days: 0, byCoop: {} },
		exportKwh: 0,
		exportEur: 0,
		exportEurElec: 0,
		exportEurAi: 0,
		// the AI market (./ai.js): sums over the year's days
		ai: { days: 0, capAH: 0, AH: 0, revR: 0, exportAH: 0, exportEur: 0, workH: 0, runNeed: 0, propNeed: 0, runFill: 0, propFill: 0, workPaidR: 0, workBillR: 0, workSelfH: 0, spaceShortDays: 0, chipsUsed: 0, chipsEnd: 0, byOwner: {}, byAi: {} },
		exportBy: new Float64Array(G),
		exportEurBy: new Float64Array(G),
		sharedDrawn: 0,
		reserveEur: 0,
		reserveMin: Infinity,
		sharedEur: 0,
		impShortDays: 0,
		solarKwp: 0,
		people: 0,
		drawStart: w.border?.drawShared ?? 0,
		advStart: w.border?.advanced ?? 0,
		repStart: w.border?.repaidR ?? 0,
		advEur: 0,
		repaidR: 0,
		owedEur: 0,
		cumEur: 0,
		lowEur: 0
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
		const o = i * G, d = w.decH[i], da = w.decA[i];
		const f = w.q[o + FOOD];
		// Aven help is what a person's Aven gave its person: the Aven hours bought less those it worked for the COOPs;
		// the income is the R value a day of the HEARTS half, the work items and the Law 5 dividends
		const wk = w.workH ? w.workH[i] : 0;
		const v = [f * 1000, f * protD, w.q[o + BED] * homeM2, w.q[o + WATER], w.q[o + ENERGY], w.q[o + COMPUTE] - wk, w.q[o + GOODS_], w.q[o + SPRING], w.q[o + BED], wk, w.heartsR[i], w.income[i], w.div[i]];
		for (let m = 0; m < nL; m++) (Y.liv[d * nL + m] += v[m]), (Y.liv[10 * nL + m] += v[m]), (Y.livA[da * nL + m] += v[m]);
		Y.pd[d]++;
		Y.pd[10]++;
		Y.pdA[da]++;
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
	Y.food.irrigM3 += t.irrigM3 ?? 0;
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
	// euros the village earned abroad: the line's electricity, and (experiment AIX) Aven service
	Y.exportEurElec += t.eurIn ?? 0;
	Y.exportEurAi += t.eurInAi ?? 0;
	Y.exportEur += (t.eurIn ?? 0) + (t.eurInAi ?? 0);
	{
		// the AI market: the owners' accelerators, capacity and inference sold (and its price), the AI COOPs' Aven hours,
		// the work the personal Avens did for the COOPs, the AIX export
		const A = Y.ai, ta = t.ai;
		A.days++;
		if (ta) (A.capAH += ta.capAH), (A.AH += ta.AH), (A.revR += ta.AH * ta.priceR), (A.exportAH += ta.exportAH), (A.exportEur += ta.exportEur);
		let chips = 0;
		for (const co of w.aiOwners ?? []) {
			const n = chipsOf(co);
			chips += n;
			const b = (A.byOwner[co.id] ??= { label: co.label ?? co.id, chips: 0, chipDays: 0, AH: 0, revR: 0 });
			b.chips = n;
			b.chipDays += n;
			b.AH += co.inf?.sold ?? 0;
			b.revR += (co.inf?.sold ?? 0) * (co.inf?.priceR ?? 0);
		}
		A.chipsEnd = chips;
		for (const co of w.coops) {
			if (!co.alive || co.good !== COMPUTE) continue;
			const b = (A.byAi[co.id] ??= { label: co.label ?? co.id, hours: 0, revR: 0 });
			b.hours += co.sold;
			b.revR += co.sold * co.priceR;
		}
		if (t.work) (A.workH += t.work.WH), (A.runNeed += t.work.needRun), (A.propNeed += t.work.needProp), (A.runFill += t.work.runFill), (A.propFill += t.work.propFill), (A.workPaidR += t.work.paidR), (A.workBillR += t.work.billR ?? 0), (A.workSelfH += t.work.selfH ?? 0);
		if (t.aiSpaceShort) A.spaceShortDays++;
		A.chipsUsed += t.chipsUsed ?? 0;
	}
	{
		const Rt = Y.rent;
		for (const co of w.coops) {
			if (!co.alive) continue;
			if (co.good === BED && co.sold > 0) (Rt.bedR += co.sold * co.priceR), (Rt.beds += co.sold);
			for (const pl of co.plants)
				if (pl.def.kind === 'hall' && pl.rentedM2 > 0) {
					const m2 = pl.hosted.reduce((a, x) => a + x.m2, 0);
					Rt.m2R += m2 * (pl.rateR ?? 0);
					Rt.m2 += m2;
					const b = (Rt.byCoop[co.id] ??= { m2R: 0, m2: 0, label: co.label ?? co.id });
					b.m2R += m2 * (pl.rateR ?? 0);
					b.m2 += m2;
				}
		}
		Rt.paidR += t.domeRentR ?? 0;
		Rt.eurR += w.c.eurPerKwh > 0 ? w.pbar[ENERGY] / w.c.eurPerKwh : 0;
		Rt.days++;
	}
	if (t.exportBy) for (let g = 0; g < G; g++) Y.exportBy[g] += t.exportBy[g];
	if (t.exportEurBy) for (let g = 0; g < G; g++) Y.exportEurBy[g] += t.exportEurBy[g];
	if ((t.impShort ?? 0) > 1e-9) Y.impShortDays++;
	Y.reserveEur = reserveEur(w);
	Y.reserveMin = Math.min(Y.reserveMin, Y.reserveEur);
	Y.sharedEur = w.border.shared;
	Y.sharedDrawn = w.border.drawShared - Y.drawStart;
	// the bank: advances to the COOPs this year, MIND paid back (R), what the COOPs still owe, and its cumulative
	// balance (exports less imports since day 0) and the lowest it has been
	Y.advEur = w.border.advanced - Y.advStart;
	Y.repaidR = w.border.repaidR - Y.repStart;
	Y.owedEur = advancesOwed(w);
	Y.cumEur = Y.reserveEur - w.border.shared0;
	Y.lowEur = w.border.low;
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
		const wk = w.workH ? w.workH[i] : 0;
		for (const g of CONSUMER) cons[g] += g === COMPUTE ? w.q[o + g] - wk : w.q[o + g];
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
		for (const g of CONSUMER) L += (g === COMPUTE ? w.q[o + g] - wk : w.q[o + g]) * p0[g];
		const Lx = L - (w.q[o + COMPUTE] - wk) * p0[COMPUTE];
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
		const rowOf = (liv, pdA, d, short) => {
			const pd = Math.max(1, pdA[d]);
			const v = (m) => liv[d * nL + LIV.indexOf(m)] / pd;
			return { kcal: v('kcal'), protein: v('protein'), homeM2: v('homeM2'), waterL: v('waterL'), homeKwh: v('homeKwh'), bed: v('bed'), avenH: v('avenH'), workH: v('workH'), income: { hearts: v('incHearts'), work: v('incWork'), div: v('incDiv') }, goodsKgYear: v('goodsKg') * 365, pondHWeek: v('pondH') * 7, shortPeople: short, personDays: pdA[d] };
		};
		const row = (d) => rowOf(Y.liv, Y.pd, d, Y.short[d]);
		const tenths = {};
		for (const [k, d] of Object.entries(TENTHS)) tenths[k] = row(d);
		const all = row(10);
		all.shortPeople = Y.shortAll;
		// all ten tenths, by MIND holdings and by Aven output (Proposition 3 in real units: ./prop3.js)
		const byHoldings = Array.from({ length: 10 }, (_, d) => row(d));
		const byAven = Array.from({ length: 10 }, (_, d) => rowOf(Y.livA, Y.pdA, d, null));
		out.push({ year: Y.year, days: Y.days, people: Y.people, peopleMean: Y.days > 0 ? Y.peopleDays / Y.days : Y.people, tenths, all, shortPeople: Y.shortAll, byHoldings, byAven });
	}
	return out;
}

/** the year's most frequent limit of a good, in plain words (and its share of the days) */
function rentOf(Y, w) {
	const R = Y.rent;
	if (!R || !R.days) return null;
	const bedR = R.beds > 0 ? R.bedR / R.beds : null;
	const m2Day = R.m2 > 0 ? R.m2R / R.m2 : null;
	const eurR = R.eurR / R.days;
	const H = w.cfg.heartsPerDay ?? 24;
	return {
		bedRDay: bedR,
		bedShareOfHearts: bedR != null ? bedR / H : null,
		bedEurMonth: bedR != null && eurR > 0 ? (bedR / eurR) * (365 / 12) : null,
		domeRM2Month: m2Day != null ? m2Day * (365 / 12) : null,
		domeEurM2Month: m2Day != null && eurR > 0 ? (m2Day / eurR) * (365 / 12) : null,
		domeM2Rented: R.days > 0 ? R.m2 / R.days : 0,
		domeRentPaidR: R.paidR,
		byLandlord: Object.fromEntries(Object.entries(R.byCoop).map(([id, b]) => [id, { label: b.label, m2: b.m2 / R.days, rM2Month: b.m2 > 0 ? (b.m2R / b.m2) * (365 / 12) : null }]))
	};
}

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
			food: { outdoors: k(Y.food.outdoors), indoors: k(Y.food.indoors), imported: k(Y.food.imported), eaten: k(Y.food.eaten), led: k(Y.food.led), lost: k(Y.food.lost), rotted: k(Y.food.rotted), unpicked: k(Y.food.unpicked), irrigationM3: Y.food.irrigM3, irrigationKwh: per(Y.food.irrigM3 * w.c.irrigKwhM3, Y) },
			season: { ...Y.season },
			indoorByMonth: Array.from(Y.indoorMonth, (x, m) => (Y.monthDays[m] > 0 ? (x * 1000) / Y.monthDays[m] : null)),
			energy: {
				made: { solar: per(E.solar, Y), geothermal: per(E.geothermal, Y), battery: per(E.battery, Y) },
				went: { basics: per(E.basics, Y), running: per(E.running, Y), building: per(E.building, Y), rd: per(E.rd, Y), export: per(E.export, Y), storage: per(E.storage, Y), curtailed: per(E.curtailed, Y) },
				heatPumps: per(E.heatPump, Y)
			},
			solarKwp: Y.solarKwp,
			// the settlement COOPs' rents (Samuel, 2026-10-13): a bed a day (R, and its share of a person's 24 HEARTS a
			// day, and in euros at the bank's rate), the dome floor a m² a month, the dome rent paid that year
			rent: rentOf(Y, w),
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
 * then, from the run so far, the first full year the village grew at least what everyone needs and the last year it
 * bought food (more than 1 % of what was eaten).
 */
export function foodLand(w) {
	const c = w.c, f = dietFacts(c.diet, c.foodYields), V = c.village;
	// the outdoor land that grows food: less tracks, sheds and hedges and the compost ley (./food.js OUTDOOR)
	const grossOut = V.outdoorFoodM2 * c.vf, outM2 = grossOut * (c.outNet ?? 1), inM2 = V.indoorFoodM2 * c.vf;
	const fy = w.cfg.forestYield ?? 1;
	const fed = peopleFed(f, outM2 * fy, inM2 * fy);
	const fedBy = Object.fromEntries(['average', 'best'].map((k) => { const g = dietFacts(c.diet, k), x = peopleFed(g, outM2 * fy, inM2 * fy), d = peopleFedByGroup(g, outM2 * fy, inM2 * fy), sy = splitYields(g, outM2, inM2); return [k, { out: x.out, in: x.in, all: x.all, byGroup: d, village: { kcalM2Year: { out: sy.out, in: sy.in }, proteinM2Year: { out: (sy.out * sy.protOut) / 1000, in: (sy.in * sy.protIn) / 1000 } }, kcalM2Year: { out: g.out.kcalM2Year, in: g.in.kcalM2Year }, proteinM2Year: { out: (g.out.kcalM2Year * g.out.proteinPer1000) / 1000, in: (g.in.kcalM2Year * g.in.proteinPer1000) / 1000 }, landM2: { out: g.out.total, in: g.in.total } }]; }));
	const D = DIETS[f.diet];
	let firstFed = null, lastImport = null;
	for (const Y of w.rec?.years ?? []) {
		if (!Y || Y.days < 365) continue;
		if (grewNeed(Y) && firstFed == null) firstFed = Y.year;
		if (!noFoodImports(Y)) lastImport = Y.year;
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
		// the diet grown all outdoors or all under glass (kcal a m² a year before losses), and as the village grows it with
		// its land split by the diet's groups (the engine's yields, ./food.js splitYields)
		kcalM2Year: { out: f.out.kcalM2Year, in: f.in.kcalM2Year },
		kcalM2Village: (() => { const sy = splitYields(f, outM2, inM2); return { out: sy.out, in: sy.in, proteinOut: (sy.out * sy.protOut) / 1000, proteinIn: (sy.in * sy.protIn) / 1000 }; })(),
		proteinM2Year: { out: (f.out.kcalM2Year * f.out.proteinPer1000) / 1000, in: (f.in.kcalM2Year * f.in.proteinPer1000) / 1000 },
		foodHa: { out: outM2 / 1e4, outGross: grossOut / 1e4, in: inM2 / 1e4 },
		peopleFed: { out: fed.out, in: fed.in, all: fed.all },
		// by the diet's groups, food-best.md's way (the engine counts calories: see ./food.js peopleFedByGroup)
		peopleFedByGroup: peopleFedByGroup(f, outM2 * fy, inM2 * fy),
		// at maturity, for each yield setting ('ramp' reaches 'best' from year 10)
		peopleFedBy: fedBy,
		skill: c.skill,
		irrigation: c.irrigation,
		// the legumes' share of the outdoor annual land (legumes, sweet potato, vegetables, seeds) at maturity: the
		// rotation allows about half (food-best.md §2)
		legumeShare: (() => { const m = f.out.m2, ann = (m.legumes ?? 0) + (m.sweetPotato ?? 0) + (m.vegetables ?? 0) + (m.nutsSeeds ?? 0) + (m.roots ?? 0); return ann > 0 ? (m.legumes ?? 0) / ann : null; })(),
		people: w.N,
		firstFedYear: firstFed,
		lastImportYear: lastImport
	};
}

/** the village's own food that year (outdoors and under glass, after losses) as a share of what everyone needs
 * (2,240 kcal a person a day) */
const ownShare = (Y) => (Y.peopleDays > 0 ? ((Y.food.outdoors + Y.food.indoors) * 1000) / (Y.peopleDays * FOOD_R.kcalNeed.v) : 0);
/** the village fed itself: it grew at least what everyone needs (people may still buy food above need at the border) */
const grewNeed = (Y) => ownShare(Y) >= 1;
/** it bought no food at the border (under 1 % of what was eaten) */
const noFoodImports = (Y) => Y.food.eaten > 0 && Y.food.imported <= 0.01 * Y.food.eaten;

/**
 * The border's ledger a year at a time: what the COOPs bought (food in kcal for the whole village, logs, scrap and
 * float glass in t, cells in kWp, accelerators in units) and what it cost in €, what the line's exports earned, the
 * euro reserve at the year's end (the founding euros left and the COOPs' accounts), the village's own food as a share
 * of need, whether it fed itself (grew at least what everyone needs), whether it bought no food (under 1 % of food
 * eaten) and whether exports paid for all imports.
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
			accelerators: { n: Y.imp.chips, eur: Y.impEur.chips },
			// the build-out (./ramp.js): grid electricity while the village's own falls short, and the plan's bill by kind
			grid: { kwh: Y.imp.grid, eur: Y.impEur.grid },
			buildKit: { eur: Y.impEur.buildKit },
			buildRunning: { eur: Y.impEur.buildRunning },
			buildMaterials: { eur: Y.impEur.buildMaterials },
			buildMachines: { eur: Y.impEur.buildMachines },
			buildServices: { eur: Y.impEur.buildServices },
			land: { eur: Y.impEur.land }
		};
		const buildEur = ['buildKit', 'buildRunning', 'buildMaterials', 'buildMachines', 'buildServices', 'land'].reduce((a, k) => a + (Y.impEur[k] ?? 0), 0);
		const importEur = IMPORT_KINDS.reduce((a, k) => a + Y.impEur[k], 0);
		out.push({
			year: Y.year,
			days: Y.days,
			imports,
			importEur,
			// of it, the build-out's bill (kit, materials, machines, services, land) and the rest (running the village)
			buildEur,
			runEur: importEur - buildEur,
			people: Y.people,
			exportKwh: Y.exportKwh,
			// all the euros earned abroad: the line's electricity, and Aven service (experiment AIX only)
			exportEur: Y.exportEur,
			exportEurElec: Y.exportEurElec,
			exportEurAi: Y.exportEurAi,
			exportByGood: Object.fromEntries(GOOD_IDS.map((id, g) => [id, Y.exportEurBy[g]]).filter(([, v]) => v > 0)),
			// € a MWh the line earned on average that year
			exportEurMwh: Y.exportKwh > 0 ? (Y.exportEurElec / Y.exportKwh) * 1000 : null,
			reserveEur: Y.reserveEur,
			foundingLeftEur: Y.sharedEur,
			foundingDrawnEur: Y.sharedDrawn,
			// the lowest the reserve went that year, and days a COOP could not pay for all it wanted to import (the
			// reserve, its own account included, was empty: its buyers got less)
			reserveMinEur: Y.reserveMin,
			importShortDays: Y.impShortDays,
			reserveOut: Y.impShortDays > 0,
			// the City COOP's bank: euros advanced to the COOPs this year, what they paid back in MIND (R), what they still
			// owe at the year's end, the cumulative balance (all exports less all imports since day 0) and the lowest it has
			// been so far (the euros the village needed from its founders at once)
			bank: { advancedEur: Y.advEur, repaidR: Y.repaidR, owedEur: Y.owedEur, cumulativeEur: Y.cumEur, lowestEur: Y.lowEur },
			exportsCoverCumulative: Y.cumEur >= 0,
			ownFoodShare: ownShare(Y),
			fedSelf: grewNeed(Y),
			noFoodImports: noFoodImports(Y),
			exportsCover: Y.exportEur >= importEur - 1e-6
		});
	}
	return out;
}

/**
 * The AI market a year at a time (round 4, ./ai.js): who owns the accelerators and how many (at the year's end, and
 * on average), the inference they sold to the AI COOPs (accelerator-hours a day) and its price, the Aven hours the AI
 * COOPs sold, per tenth of holdings split into the person's help and the work for the COOPs, each tenth's MIND income
 * by source (the HEARTS half, Aven work items, Law 5 dividends; R a day), the accelerators bought at the border and
 * their euros, what bound the Aven service most days, and the AIX export.
 */
export function aiYears(w) {
	const out = [];
	const liv = livingYears(w);
	for (const Y of w.rec?.years ?? []) {
		if (!Y || !Y.ai) continue;
		const A = Y.ai, d = Math.max(1, A.days);
		const L = liv.find((r) => r.year === Y.year);
		const tenth = (r) => ({ helpH: r.avenH, workH: r.workH, hearts: r.income.hearts, work: r.income.work, div: r.income.div });
		const owners = Object.entries(A.byOwner).map(([id, b]) => ({ id, label: b.label, chips: b.chips, chipsMean: b.chipDays / d, AHDay: b.AH / d, priceR: b.AH > 0 ? b.revR / b.AH : null, revRDay: b.revR / d }));
		const aiCoops = Object.entries(A.byAi).map(([id, b]) => ({ id, label: b.label, hoursDay: b.hours / d, priceR: b.hours > 0 ? b.revR / b.hours : null }));
		out.push({
			year: Y.year,
			days: Y.days,
			people: Y.people,
			owners,
			chips: A.chipsEnd,
			capAHDay: A.capAH / d,
			AHDay: A.AH / d,
			inferPriceR: A.AH > 0 ? A.revR / A.AH : null,
			utilization: A.capAH > 0 ? A.AH / A.capAH : null,
			aiCoops,
			// the people's Aven hours (a person a day): help for themselves, work for the COOPs, by tenth of holdings
			tenths: L ? Object.fromEntries(L.byHoldings.map((r, i) => [i + 1, tenth(r)])) : {},
			all: L ? tenth(L.all) : null,
			// the COOPs' need for Aven work (hours a day) and how much of it the Avens delivered
			work: { hoursDay: A.workH / d, runNeedDay: A.runNeed / d, propNeedDay: A.propNeed / d, runFill: A.runFill / d, propFill: A.propFill / d, paidRDay: A.workPaidR / d, billRDay: A.workBillR / d, selfHDay: A.workSelfH / d },
			imported: { n: Y.imp.chips ?? 0, eur: Y.impEur.chips ?? 0 },
			worn: A.chipsUsed,
			bind: bindOf(Y, COMPUTE),
			spaceShortDays: A.spaceShortDays,
			export: { AHDay: A.exportAH / d, eur: A.exportEur },
			bankCumEur: Y.cumEur
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
			// the accelerators standing in the hardware owners' data halls (./ai.js)
			if (pl.def.kind === 'hall') st.chipsInstalled += pl.chipsN ?? 0;
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
	if (w.ramp) return buildoutBill(w);
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
	add('accelerators', 'Accelerators in the hardware owners’ data halls', { t: null, n: chips, eur: chips * w.c.chipEur, group: 'machines' });
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

/**
 * On the ramp (./ramp.js) the founding bill is the build-out's: the starter kit, running it, the materials, machines
 * and services (the geothermal drilling among them) and the land, as the build-out plan prices them
 * (src/lib/sandbox-7/buildout.js), by kind, by settlement (each settlement COOP's advances; the Village COOP's for the
 * centre) and by year. Same shape as the round-2 bill (rows, builtEur, totalEur …) plus the plan's own tables.
 */
function buildoutBill(w) {
	const S = w.ramp, plan = S.plan, T = plan.totals;
	const label = { kit: 'The starter kit (camp, power, water, machines, site gear, workshop), bought once and reused', running: 'Running the kit (fuel, upkeep, insurance)', materials: 'Materials bought at the border (finished, or raw inputs for the village’s own works once they run)', machines: 'Machines for the works, the utilities and the geothermal plant', services: 'Services bought in (design and permits, the geothermal drilling and plant)', land: 'The land (farmland at Sandbox 6’s price)' };
	const group = { kit: 'kit', running: 'kit', materials: 'shells', machines: 'machines', services: 'services', land: 'land' };
	const rows = Object.entries(T.eur).map(([k, eur]) => ({ id: k, label: label[k] ?? k, t: k === 'materials' ? Object.values(T.t ?? {}).reduce((a, x) => a + (x ?? 0), 0) : null, eur, group: group[k] ?? k }));
	const geo = plan.steps.find((x) => x.kind === 'geothermal');
	const builtEur = rows.reduce((a, r) => a + r.eur, 0);
	return {
		rows,
		builtEur,
		totalEur: builtEur,
		reserveEur: 0,
		foodStoreDays: w.c.foodStoreDays,
		tonnes: rows.reduce((a, r) => a + (typeof r.t === 'number' ? r.t : 0), 0),
		ramp: true,
		kit: { eur: plan.kit.eur, byGroup: plan.kit.byGroup, items: plan.kit.items.map((k) => ({ id: k.id, label: k.label, n: k.n, eur: k.eur, total: k.total })) },
		geothermal: geo ? { label: geo.label, eur: geo.eur.total, start: geo.start, end: geo.end, coop: 'Village COOP' } : null,
		bySettlement: plan.settlements.map((x) => ({ key: x.key, label: x.label, coop: x.coop, founded: x.founded, done: x.done, beds: x.beds, domes: x.domes, eur: x.eur })),
		byYear: T.byYear,
		doneMonth: T.doneMonth,
		peopleMonth: T.peopleMonth,
		feasibility: plan.feasibility.statement,
		kitChoice: plan.feasibility.kit ?? null,
		sources: { buildout: 'src/lib/sandbox-7/buildout.js buildPlan (the build-out plan): kit, work rates, schedule and euros', prices: 'src/lib/sandbox-7 specs.js PRICES; buildout.js BUILD_SOURCES', start: 'launched in January (the engine’s year starts in January)' }
	};
}
