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
import { BASICS, CONSUMER, COMPUTE, ENERGY, G, LIMIT, BED, PHYSICAL } from './consts.js';
import { capDayOf, plantCapDay } from './genesis.js';

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
