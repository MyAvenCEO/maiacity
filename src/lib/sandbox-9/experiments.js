// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · EXPERIMENTS — Primer's method: two worlds on the same seed, one rule changed, the same metrics read
 * from both. Each experiment says its question, the rule it changes, two or three guesses written before the run,
 * the metrics to chart, and the population and years it runs at (small enough that both worlds run in a few seconds
 * in a browser). The takeaway is a sentence computed from the two results, and `pass` checks the claim the
 * experiment tests. Nothing here is hard-coded: a world that behaves differently gets a different sentence and a
 * different verdict.
 *
 *   const r = runExperiment('X1', { onFrame: (base, changed, day) => draw(base, changed) });
 *   r.takeaway; r.verdict.pass; r.verdict.evidence;
 *
 * In the browser, startExperiment(exp) gives a runner to step a few days per animation frame.
 *
 * X1–X14 are the world model's fourteen experiments (§7.3); AB1 doubles a binding physical limit (Proposition 3's
 * "only physics limits abundance"); SH puts the four scheduled shocks of §4.5 into one world. The proof suite's
 * longer scenarios (world model §6) are in ./scenarios.js and use the same helpers (`hooks`, `track`, `summarize`).
 *
 * Two scheduled events are played here, not in the engine, because they are tests and not rules of the economy:
 *   'germany'  holdings made as unequal as Germany's (Gini 0.72) on one day; each MIND's count is kept exactly, so
 *              the money ledger still closes (world model B05);
 *   'ring'     four founders open a COOP that makes nothing, put all their HEARTS into it, pay themselves 90 % of its
 *              treasury as work that was never delivered, and buy its MIND in the pools to push its price (B11). It is
 *              an attack: the test is whether honest Avens starve it.
 * Both are listed in the world's `shocks`, so Proposition 3 excuses their windows like any other scheduled shock.
 */
import { exp, log } from './dmath.js';
import { polar } from './rng.js';
import { createWorld, step, DEFAULTS, getLedger, paramSet } from './engine.js';
import { livingYears, villageYears, borderYears, materialYears, foundingBill, foodLand, indoorMonthsOf, aiYears } from './records.js';
import { prop3 } from './prop3.js';
import { guessText } from './guesses.js';
import { openCoop } from './coops.js';
import { swap } from './pools.js';
import { BASICS, CONSUMER, ENERGY, FOOD, G, GOOD_IDS, GOODS_, LIMIT, LIMIT_NAMES, MAX_COOPS, SPRING, WATER, BED, COMPUTE } from './consts.js';

const Y = 365;
const M = MAX_COOPS;

// ── reading a world ──────────────────────────────────────────────────────────────────────────────────────────────
/** the mean of a recorded column over [a, b) (days), skipping non-numbers */
export function meanOf(w, key, a = 0, b = w.rec.n, col = 0) {
	const rec = w.rec, width = rec.width[key];
	let s = 0, n = 0;
	for (let d = Math.max(0, a); d < Math.min(rec.n, b); d++) {
		const v = rec[key][d * width + col];
		if (Number.isFinite(v)) (s += v), n++;
	}
	return n ? s / n : NaN;
}
/** the lowest value of a recorded column over [a, b) */
export function minOf(w, key, a = 1, b = w.rec.n, col = 0) {
	const rec = w.rec, width = rec.width[key];
	let m = Infinity;
	for (let d = Math.max(0, a); d < Math.min(rec.n, b); d++) {
		const v = rec[key][d * width + col];
		if (Number.isFinite(v) && v < m) m = v;
	}
	return m;
}
/** the highest value of a recorded column over [a, b) */
export function maxOf(w, key, a = 1, b = w.rec.n, col = 0) {
	const rec = w.rec, width = rec.width[key];
	let m = -Infinity;
	for (let d = Math.max(0, a); d < Math.min(rec.n, b); d++) {
		const v = rec[key][d * width + col];
		if (Number.isFinite(v) && v > m) m = v;
	}
	return m;
}
/** a sum of a recorded column over [a, b) */
export function sumOf(w, key, a = 1, b = w.rec.n, col = 0) {
	const rec = w.rec, width = rec.width[key];
	let s = 0;
	for (let d = Math.max(0, a); d < Math.min(rec.n, b); d++) {
		const v = rec[key][d * width + col];
		if (Number.isFinite(v)) s += v;
	}
	return s;
}
const lastYear = (w) => [Math.max(0, w.rec.n - Y), w.rec.n];
/**
 * The lowest room to pay of anyone over [a, b), in days of the basic bundle: what a person may spend on the basics a
 * day (a 30th of what they hold plus today's dividends, ./market.js peopleOrders) ÷ what the bundle costs. Read back
 * from the lowest water limit bar of the day (limit = (room − the other basics) ÷ the water need).
 */
function roomDays(w, a, b) {
	const rec = w.rec, nw = w.c.need[1];
	let m = Infinity;
	for (let d = Math.max(1, a); d < Math.min(rec.n, b); d++) {
		const pw = rec.pbar[d * G + WATER], Cb = rec.basicCostR[d], lr = rec.limitMin[d * 4 + 1];
		if (!(Cb > 0) || !Number.isFinite(lr)) continue;
		m = Math.min(m, 1 + (nw * pw * (lr - 1)) / Cb);
	}
	return m;
}
/** person-days short of any basic after day 0, in [a, b) */
export const shortPD = (w, a = 1, b = w.rec.n) => sumOf(w, 'shortAny', Math.max(1, a), b);
/** how far innovation has come: the mean share of the way from each coefficient's start (1) to its physical floor */
export function learnProgress(w) {
	let s = 0, n = 0;
	for (const [k, L] of Object.entries(w.learn)) {
		const floors = w.tech[k]?.floors ?? {};
		for (const [c, v] of Object.entries(L.coef)) {
			const f = floors[c];
			if (!(f < 1)) continue;
			s += (1 - v) / (1 - f);
			n++;
		}
	}
	return n ? s / n : 0;
}
/** the smallest margin of any learned coefficient above its physical floor (≥ 0: no recipe passed its floor) */
export function floorMargin(w) {
	let m = Infinity;
	for (const [k, L] of Object.entries(w.learn)) {
		const floors = w.tech[k]?.floors ?? {};
		for (const [c, v] of Object.entries(L.coef)) if (floors[c] < 1) m = Math.min(m, v - floors[c]);
	}
	return m;
}
/** the Gini index of a list of non-negative numbers */
export function gini(xs) {
	const a = Array.from(xs).filter(Number.isFinite).map((x) => Math.max(0, x)).sort((p, q) => p - q);
	const n = a.length;
	let s = 0, t = 0;
	for (let i = 0; i < n; i++) (s += (2 * (i + 1) - n - 1) * a[i]), (t += a[i]);
	return n && t > 0 ? s / (n * t) : 0;
}
/** the Gini index of what people hold (R at pool prices) */
export const holdingsGini = (w) => gini(w.wealth.subarray(0, w.N));
/** who holds the MIND, in R at today's pool prices: people, COOP treasuries, pools (shares of the whole) */
export function ownership(w) {
	const P = w.P, ks = w.ks ?? w.coops.map((c) => c.k);
	let ppl = 0, tre = 0, pools = 0;
	for (let i = 0; i < w.N; i++) for (const k of ks) ppl += w.hold[i * M + k] * P[k];
	for (const j of ks) for (const k of ks) tre += w.tre[j * M + k] * P[k];
	for (const p of w.pools) for (let i = 0; i < p.x.length; i++) pools += p.x[i] * P[p.members[i]];
	const t = ppl + tre + pools;
	return { people: ppl / t, treasuries: tre / t, pools: pools / t, totalR: t };
}
/** every MIND counted (not valued), a person: the money the HEARTS made, less the melt */
export function mindCountPerPerson(w) {
	let s = 0;
	for (let i = 0; i < w.N * M; i++) s += w.hold[i];
	for (let j = 0; j < M * M; j++) s += w.tre[j];
	for (const p of w.pools) for (const x of p.x) s += x;
	if (w.poolQueue) for (const x of w.poolQueue) s += x;
	return s / w.N;
}
/** the mean absolute daily change of a price, ln units (how much a price swings from day to day) */
export function priceSwing(w, g, a = 1, b = w.rec.n) {
	const rec = w.rec;
	let s = 0, n = 0;
	for (let d = Math.max(1, a); d < Math.min(rec.n, b); d++) {
		const p0 = rec.pbar[(d - 1) * G + g], p1 = rec.pbar[d * G + g];
		if (p0 > 0 && p1 > 0) (s += Math.abs(log(p1 / p0))), n++;
	}
	return n ? s / n : NaN;
}
/** the share of days in [a, b) a good's binding-limit badge read `code` */
export function badgeShare(w, g, code, a = 1, b = w.rec.n) {
	let n = 0, c = 0;
	for (let d = Math.max(0, a); d < Math.min(w.rec.n, b); d++) (c += w.rec.badge[d * G + g] === code ? 1 : 0), n++;
	return n ? c / n : NaN;
}
/** the limit that bound a good most often in [a, b), and its share of days */
export function topBadge(w, g, a = 1, b = w.rec.n) {
	const cnt = new Map();
	let n = 0;
	for (let d = Math.max(0, a); d < Math.min(w.rec.n, b); d++) {
		const x = w.rec.badge[d * G + g];
		cnt.set(x, (cnt.get(x) ?? 0) + 1);
		n++;
	}
	const [code, c] = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0] ?? [0, 0];
	return { code, limit: LIMIT_NAMES[code], share: n ? c / n : NaN };
}
/** every limit that bound a good in [a, b), with its share of days (largest first) */
export function badgeShares(w, g, a = 1, b = w.rec.n) {
	const cnt = new Map();
	let n = 0;
	for (let d = Math.max(0, a); d < Math.min(w.rec.n, b); d++) {
		const x = w.rec.badge[d * G + g];
		cnt.set(x, (cnt.get(x) ?? 0) + 1);
		n++;
	}
	return Object.fromEntries([...cnt.entries()].sort((p, q) => q[1] - p[1]).map(([code, c]) => [LIMIT_NAMES[code], c / Math.max(1, n)]));
}
/** the days a basic was short (someone under 98 %) and its badge read a physical limit (not MIND, not "need met") */
export function shortDaysByLimit(w) {
	const out = {};
	for (const b of BASICS)
		for (let d = 1; d < w.rec.n; d++) {
			if (!(w.rec.shortN[d * 4 + b] > 0)) continue;
			const name = `${GOOD_IDS[b]}: ${LIMIT_NAMES[w.rec.badge[d * G + b]]}`;
			out[name] = (out[name] ?? 0) + 1;
		}
	return out;
}

const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)} %` : String(x));
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const f0 = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : String(x));
const rel = (a, b) => (b !== 0 ? a / b - 1 : NaN);
/** three significant figures at most, for the one-sentence takeaways */
const sig = (x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : String(Number(x.toPrecision(3)))) : String(x));
const pc0 = (x) => (Number.isFinite(x) ? `${Math.round(100 * x)} %` : String(x));

// ── scheduled test events (not rules of the economy) ─────────────────────────────────────────────────────────────
/** a small seeded random source of its own, so both worlds of an experiment draw the same numbers */
function mulberry(seed) {
	let a = seed >>> 0 || 1;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Make holdings as unequal as Germany's (world model B05): each person's share of every MIND people hold is redrawn
 * from a lognormal with σ 1.53 (Gini about 0.72). The owner-only cohort is left as it was (they are the P2 test).
 * Each MIND's count is kept exactly: the money ledger closes as before.
 */
function germanyShock(w, s) {
	const rand = mulberry((w.cfg.seed ^ 0x9e3779b9) + s.day);
	const gauss = () => polar(rand);
	const sigma = s.sigma ?? 1.53;
	const ids = [];
	for (let i = 0; i < w.N; i++) if (!w.owner[i]) ids.push(i);
	const wt = ids.map(() => exp(sigma * gauss()));
	const sum = wt.reduce((a, b) => a + b, 0);
	for (const k of w.ks) {
		let tot = 0;
		for (const i of ids) tot += w.hold[i * M + k];
		if (!(tot > 0)) continue;
		ids.forEach((i, j) => (w.hold[i * M + k] = (tot * wt[j]) / sum));
	}
	w.events.push({ day: w.day, kind: 'germany', what: `holdings redrawn, σ ${sigma}` });
}

/** open the ring's COOP (it makes nothing) and enrol its founders */
function ringOpen(w, s) {
	const co = openCoop(w, GOODS_, 'RING', [], w.pbar[GOODS_]);
	if (!co) return;
	// openCoop enrols three random founders; the ring replaces them with its own members
	w.founders = (w.founders ?? []).filter((f) => f.k !== co.k);
	const size = s.size ?? 4, members = [];
	for (let j = 0; members.length < size && j < w.N; j++) {
		const i = Math.floor(((j + 0.37) * w.N) / (size + 3)) % w.N;
		if (!w.owner[i] && !members.includes(i)) members.push(i);
	}
	const until = s.day + (s.days ?? 300);
	for (const i of members) w.founders.push({ i, k: co.k, until });
	co.ring = true;
	const mean = (ids) => ids.reduce((a, i) => a + w.wealth[i], 0) / Math.max(1, ids.length);
	const others = [];
	for (let i = 0; i < w.N; i++) if (!members.includes(i)) others.push(i);
	w.ring = { k: co.k, id: co.id, members, others, from: s.day, until, wealth0: mean(members) / Math.max(1e-9, mean(others)), heartsIn: 0, heartsAll: 0, paidR: 0, pumpR: 0, diedDay: -1 };
	w.events.push({ day: w.day, kind: 'ring', coop: co.id, what: `${members.length} founders` });
}

/** the ring's week: it pays its founders 90 % of its treasury for work never delivered, and they buy its MIND */
function ringWeek(w) {
	const r = w.ring, k = r.k, co = w.coops[k];
	if (!co.alive) return;
	const own = w.tre[k * M + k];
	if (own > 0) {
		const pay = 0.9 * own;
		w.tre[k * M + k] -= pay;
		for (const i of r.members) w.hold[i * M + k] += pay / r.members.length;
		r.paidR += pay * w.P[k];
	}
	for (const i of r.members)
		for (const j of w.ks) {
			if (j === k || !w.liquid[j]) continue;
			const h = w.hold[i * M + j];
			if (!(h > 1e-9)) continue;
			const q = 0.1 * h;
			const x = swap(w, j, k, q);
			w.hold[i * M + j] += x.back - q;
			w.hold[i * M + k] += x.out;
			r.pumpR += (q - x.back) * w.P[j];
		}
}

/**
 * The test events of a world, run after each step (the day just run is w.day − 1): the Germany shock and the ring
 * (see the top of this file). Experiments and scenarios call it for every world; a world without these events is
 * not touched.
 */
export function hooks(w) {
	for (const s of w.cfg.shocks ?? []) {
		if (s.kind === 'germany' && w.day === s.day) germanyShock(w, s);
		if (s.kind === 'ring') {
			if (w.day === s.day) ringOpen(w, s);
			const r = w.ring;
			if (r && w.day > r.from && w.day <= r.until) {
				const co = w.coops[r.k];
				if (co.alive) {
					// HEARTS that went into the ring from people outside it (its founders put in all of theirs)
					let fromMembers = 0;
					for (const f of w.founders ?? []) if (f.k === r.k && f.until > w.day - 1) fromMembers += w.cfg.heartsPerDay;
					r.heartsIn += Math.max(0, co.heartsToday - fromMembers);
					r.heartsAll += r.others.length * w.cfg.heartsPerDay;
				} else if (r.diedDay < 0) r.diedDay = co.died;
				if (w.day % 7 === 0) ringWeek(w);
				if (w.day === r.until) {
					const mean = (ids) => ids.reduce((a, i) => a + w.wealth[i], 0) / Math.max(1, ids.length);
					r.wealth1 = mean(r.members) / Math.max(1e-9, mean(r.others));
				}
			}
		}
	}
}

// ── what every world tracks beyond its records ───────────────────────────────────────────────────────────────────
/**
 * Called after each step: yearly money flows (HEARTS issued, melt, dividends to people, ground rent), people's mean
 * holding, the basics' sales against their full and variable cost (who keeps the surplus), newcomers' days short, and
 * every 30 days the holdings Gini and who holds the MIND.
 */
export function track(w) {
	const x = w.xt ?? (w.xt = { years: [], monthly: [], newcomerPD: 0, newcomerShortPD: 0, coopHearts: [] });
	const d = w.day - 1, y = Math.floor(d / Y), t = w.today;
	const Yr = x.years[y] ?? (x.years[y] = { days: 0, issuedR: 0, meltR: 0, divPeopleR: 0, holdPeopleR: 0, salesPeopleR: 0, rentR: 0, landRent: 0, N: 0, rev: [0, 0, 0, 0], full: [0, 0, 0, 0], vc: [0, 0, 0, 0] });
	Yr.days++;
	Yr.issuedR += t.investR;
	Yr.meltR += t.meltR;
	Yr.divPeopleR += t.divPeopleR;
	Yr.salesPeopleR += t.salesPeopleR;
	Yr.rentR += t.rentR;
	Yr.landRent += w.land.rent;
	Yr.N += w.N;
	let hp = 0;
	for (let i = 0; i < w.N; i++) hp += w.wealth[i];
	Yr.holdPeopleR += hp;
	for (const co of w.coops) {
		if (!co.alive || co.good > BED || !(co.sold > 0)) continue;
		const g = co.good;
		Yr.rev[g] += co.sold * co.priceR;
		Yr.full[g] += co.sold * (Number.isFinite(co.fullR) ? co.fullR : co.priceR);
		Yr.vc[g] += co.sold * (Number.isFinite(co.varR) ? co.varR : 0);
	}
	// on the build-out: who went short, the settlers of day 0 while they were the whole village, newcomers in their
	// first 90 days, or anyone else (proof.md's P1 section)
	if (w.ramp && d >= 1) {
		const r = x.rampShort ?? (x.rampShort = { settlersPD: 0, settlersDays: 0, settlersLastDay: -1, newPD: 0, newDays: 0, otherPD: 0, otherDays: 0, byYear: [], arrivalPD: 0, ownerPD: 0, arrivals: 0, arrivalHeartsR: 0, arrivalBasicR: 0, arrivalShortHeartsR: 0, arrivalShortBasicR: 0 });
		const settlers = w.ramp.plan?.options?.settlers ?? 2;
		let sS = 0, sN = 0, sO = 0;
		for (let i = 0; i < w.N; i++) {
			// a newcomer's arrival day: what its first HEARTS half was worth against the day's basics
			const arr = w.N > settlers && w.born[i] > 0 && d === w.born[i];
			if (arr) (r.arrivals++), (r.arrivalHeartsR += w.heartsR[i]), (r.arrivalBasicR += w.basicCost[i]);
			if (!(w.met[i] < 0.98)) continue;
			if (w.N <= settlers) sS++;
			else if (w.born[i] > 0 && d - w.born[i] < 90) sN++;
			else sO++;
			if (w.N > settlers && arr) (r.arrivalPD++), (r.arrivalShortHeartsR += w.heartsR[i]), (r.arrivalShortBasicR += w.basicCost[i]);
			if (w.N > settlers && w.owner[i]) r.ownerPD++;
		}
		if (sS) (r.settlersPD += sS), r.settlersDays++, (r.settlersLastDay = d);
		if (sN) (r.newPD += sN), r.newDays++;
		if (sO) (r.otherPD += sO), r.otherDays++;
		if (sS + sN + sO) r.byYear[y] = (r.byYear[y] ?? 0) + sS + sN + sO;
	}
	const N0 = w.cfg.people;
	for (let i = N0; i < w.N; i++)
		if (d - w.born[i] < 3 * Y) {
			x.newcomerPD++;
			if (w.met[i] < 0.98) x.newcomerShortPD++;
		}
	// owner-only newcomers (cfg.newcomers): the lowest of their dividends ÷ basic bundle, each day since they joined
	if (w.newIds?.length) {
		const nr = x.newStrict ?? (x.newStrict = []);
		let r = Infinity;
		for (const i of w.newIds) r = Math.min(r, w.basicCost[i] > 0 ? w.div[i] / w.basicCost[i] : 0);
		nr.push(r);
	}
	r6Day(w, x, d, y);
	if (d % 30 === 0) {
		const o = ownership(w);
		x.monthly.push({ day: d, gini: holdingsGini(w), people: o.people, treasuries: o.treasuries, pools: o.pools, mindPP: mindCountPerPerson(w), rent: w.land.rent, N: w.N });
		if ((w.cfg.shocks ?? []).some((s) => s.kind === 'coopFail')) {
			let all = 0;
			for (const co of w.coops) if (co.alive) all += co.heartsEma;
			x.coopHearts.push({ day: d, share: Object.fromEntries(w.coops.filter((c) => c.alive).map((c) => [c.id, c.heartsEma / Math.max(1e-9, all)])) });
		}
	}
}

/**
 * (round 6) P2 strict's bound and the pools' LVR, a day at a time into yearly sums. Law 5 pays an owner-only person
 * λ × (its share of all holdings) × (all sales): divided by its bundle, dividends ÷ bundle = λ × (N × its share) × (all
 * sales ÷ everyone's basic bundle), exact when its holding is spread over the MINDs as the city's is (otherwise the
 * share is read per MIND). All holdings: people, the COOPs' treasuries (but each its own MIND, which Law 5 skips) and
 * the city's pools. Sales: every real sale Law 5 paid on (people, B2B, rent), the B2B part apart.
 */
function r6Day(w, x, d, y) {
	const M = MAX_COOPS, P = w.P, t = w.today, N = w.N;
	const R = (x.r6 ??= { years: [], pools: [] });
	const Yr = (R.years[y] ??= { days: 0, allR: 0, peopleR: 0, b2bR: 0, bundleR: 0, relMin: 0, relMed: 0, boundMin: 0, boundMed: 0, actMin: Infinity, actMed: 0, poolHoldShare: 0 });
	let all = 0;
	for (const co of w.coops) if (co.alive) all += co.salesR;
	let H = 0, Hp = 0;
	for (let i = 0; i < N; i++) H += w.wealth[i];
	for (const co of w.coops) {
		if (!co.alive) continue;
		for (const k of w.ks) if (k !== co.k && w.tre[co.k * M + k] > 0) H += w.tre[co.k * M + k] * P[k];
	}
	for (const p of w.pools) for (let i = 0; i < p.x.length; i++) Hp += p.x[i] * P[p.members[i]];
	H += Hp;
	const bundle = N * t.basicCostR;
	Yr.days++;
	Yr.allR += all;
	Yr.peopleR += t.salesPeopleR ?? 0;
	Yr.b2bR += t.salesB2BR ?? 0;
	Yr.bundleR += bundle;
	Yr.poolHoldShare += H > 0 ? Hp / H : 0;
	const rel = [], act = [];
	for (const i of w.ownerIds) {
		if (i >= N) continue;
		rel.push(H > 0 ? (N * w.wealth[i]) / H : 0);
		act.push(w.basicCost[i] > 0 ? w.div[i] / w.basicCost[i] : 0);
	}
	if (rel.length) {
		rel.sort((a, b) => a - b);
		act.sort((a, b) => a - b);
		const sb = bundle > 0 ? all / bundle : 0, lam = w.cfg.law5;
		Yr.relMin += rel[0];
		Yr.relMed += rel[rel.length >> 1];
		Yr.boundMin += lam * rel[0] * sb;
		Yr.boundMed += lam * rel[rel.length >> 1] * sb;
		Yr.actMin = Math.min(Yr.actMin, act[0]);
		Yr.actMed += act[act.length >> 1];
	}
	// each basket's fee income and loss to arbitrage, at each year's end (cumulative; ./pools.js)
	if ((d + 1) % Y === 0) R.pools.push({ year: y + 1, pools: w.pools.map((p) => ({ members: Array.from(p.members, (k) => w.coops[k]?.id ?? k), feeR: p.feeR ?? 0, lvrR: p.lvrR ?? 0, reserveR: p.x.reduce((a, v, i) => a + v * P[p.members[i]], 0) })) });
}

/** (round 6) the yearly table of P2 strict's bound, the bank's turning years and each basket's LVR against its fees */
function r6Summary(w) {
	const R = w.xt?.r6;
	if (!R) return null;
	const years = R.years.map((Yr, y) => {
		const n = Yr.days || 1, sb = Yr.bundleR > 0 ? Yr.allR / Yr.bundleR : 0;
		const relMed = Yr.relMed / n, relMin = Yr.relMin / n, lam = w.cfg.law5;
		return {
			year: y + 1,
			salesOverBasics: sb,
			peopleOverBasics: Yr.bundleR > 0 ? Yr.peopleR / Yr.bundleR : 0,
			b2bOverBasics: Yr.bundleR > 0 ? Yr.b2bR / Yr.bundleR : 0,
			otherOverBasics: Yr.bundleR > 0 ? (Yr.allR - Yr.peopleR - Yr.b2bR) / Yr.bundleR : 0,
			poolsShareOfHoldings: Yr.poolHoldShare / n,
			ownerRelShareMin: relMin,
			ownerRelShareMed: relMed,
			boundMin: Yr.boundMin / n,
			boundMed: Yr.boundMed / n,
			actualMin: Number.isFinite(Yr.actMin) ? Yr.actMin : null,
			actualMed: Yr.actMed / n,
			// the sales ÷ basics the strict test would need for the median and the lowest owner-only holding
			neededSalesOverBasicsMed: relMed > 0 ? 1 / (lam * relMed) : null,
			neededSalesOverBasicsMin: relMin > 0 ? 1 / (lam * relMin) : null
		};
	});
	// the bank: the first year from which the year's own balance (exports less all imports) stays at or above zero to
	// the end, and the first year the cumulative balance is positive ('never': null)
	const B = borderYears(w).filter((b) => b.days >= 365);
	let runPos = null;
	for (let i = B.length - 1; i >= 0 && B[i].exportEur - B[i].importEur >= 0; i--) runPos = B[i].year;
	const cumPos = B.find((b) => b.bank.cumulativeEur > 0)?.year ?? null;
	let bestYear = null;
	for (const b of B) if (bestYear == null || b.exportEur - b.importEur > bestYear.bal) bestYear = { year: b.year, bal: b.exportEur - b.importEur };
	// each basket's fees and LVR over the run and over its last ten years
	const last = R.pools.at(-1), ten = R.pools.at(-11) ?? null;
	const lvr = last ? last.pools.map((p, i) => ({ members: p.members, feeR: p.feeR, lvrR: p.lvrR, reserveR: p.reserveR, fee10R: ten?.pools[i] ? p.feeR - ten.pools[i].feeR : null, lvr10R: ten?.pools[i] ? p.lvrR - ten.pools[i].lvrR : null, below: p.lvrR <= p.feeR })) : [];
	return { years, bank: { runningPositiveYear: runPos, cumulativePositiveYear: cumPos, bestYear }, lvr };
}

/** the tracked monthly row nearest a day */
export function monthAt(w, day) {
	const m = w.xt?.monthly ?? [];
	let best = m[0];
	for (const r of m) if (Math.abs(r.day - day) < Math.abs(best.day - day)) best = r;
	return best;
}
/** a year's Law 5 dividend yield to people: dividends ÷ their mean holding */
export const yieldOf = (Yr) => (Yr && Yr.holdPeopleR > 0 ? Yr.divPeopleR / (Yr.holdPeopleR / Yr.days) : NaN);
/** a year's basics' price over full cost (1 = sold at full cost) and the sellers' share of revenue above variable cost */
export function markupOf(Yr) {
	let rev = 0, full = 0, vc = 0;
	for (let g = 0; g < 4; g++) (rev += Yr.rev[g]), (full += Yr.full[g]), (vc += Yr.vc[g]);
	return { markup: full > 0 ? rev / full : NaN, sellerShare: rev > 0 ? (rev - vc) / rev : NaN };
}

// ── the experiments ──────────────────────────────────────────────────────────────────────────────────────────────
/** the village's 1,500 people (5 % of them owner-only) in Sandbox 6's village of six living hexes: every experiment
 * runs at this size (Samuel 2026-10-13); one that tests another number changes that knob and says so */
const PAGE_PEOPLE = 1500;
const DROUGHT_DAY = 3 * Y + 152; // June of year 4
const DROUGHT = { kind: 'drought', day: DROUGHT_DAY, days: 120, factor: 0.3 };
const inDrought = [DROUGHT_DAY, DROUGHT_DAY + 120];
const GERMANY_DAY = 8 * Y; // the start of year 9: the melt's own effect shows only once money is near rest (in a young city the new HEARTS dilute every fortune fast, melt or not)
const RING_DAY = Y, RING_DAYS = 300;
const FAIL_DAY = 300;
const lastShortDay = (w) => {
	let l = -1;
	for (let d = 1; d < w.rec.n; d++) if (w.rec.ownerShort[d] > 0) l = d;
	return l;
};
const p3parts = (p) => `P1 ${p.P1.pass ? 'pass' : 'fail'}, P2 ${p.P2.pass ? 'pass' : 'fail'}, P3 ${p.P3.pass ? 'pass' : 'fail'}`;

export const EXPERIMENTS = {
	X1: {
		id: 'X1',
		question: 'Do the poor eat when water gets dear?',
		ruleChanged: 'Law 5 share 20 % (base) vs 0 % (changed). Both worlds have a drought: rain −70 % for 120 days from June of year 4. Prices are fully dynamic.',
		guesses: [
			{ text: 'With 20 %, the owner-only blobs’ dividends keep paying their basic bundle through the drought. With 0 %, they get no dividends at all.', check: (rb, rc) => rb.values.strictInDrought >= 1 && !(rc.values.strictInDrought > 0.001) },
			{ text: 'Water gets dearer in both worlds. Nobody goes short in either, because the MIND each person gets from investing their HEARTS (their half) pays the basic bundle many times over.', check: (rb, rc) => rb.values.waterPeak > 1 && rc.values.waterPeak > 1 && rb.values.shortPD === 0 && rc.values.shortPD === 0 },
			{ text: 'With 0 %, the sellers keep the fifth of every sale. So they build more, and water stays cheaper.', check: (rb, rc) => rc.values.waterPeak < rb.values.waterPeak }
		],
		people: PAGE_PEOPLE,
		years: 5,
		base: { law5: 0.2, shocks: [DROUGHT] },
		changed: { law5: 0, shocks: [DROUGHT] },
		charts: ['water price and the lowest room to pay', 'owner-only dividends ÷ basic bundle', 'person-days short'],
		metrics: [
			{ id: 'shortPD', label: 'person-days short of a basic (after day 0)', of: (w) => shortPD(w) },
			{ id: 'shortInDrought', label: 'person-days short in the drought and 90 days after', of: (w) => shortPD(w, inDrought[0], inDrought[1] + 90) },
			{ id: 'waterPeak', label: 'water price at its drought peak ÷ the 90 days before', of: (w) => maxOf(w, 'pbar', inDrought[0], inDrought[1] + 90, WATER) / meanOf(w, 'pbar', inDrought[0] - 90, inDrought[0], WATER) },
			{ id: 'poorRoomDays', label: 'lowest room to pay of anyone in the drought (a 30th of the holding plus dividends, a day), in days of the basic bundle', of: (w) => roomDays(w, inDrought[0], inDrought[1] + 90) },
			{ id: 'strictInDrought', label: 'owner-only: lowest dividends ÷ basic bundle in the drought', of: (w) => minOf(w, 'strict', inDrought[0], inDrought[1] + 90) },
			{ id: 'ownerShort', label: 'owner-only person-days short (after day 0)', of: (w) => sumOf(w, 'ownerShort', 1) },
			{ id: 'poorL', label: 'poorest Aven decile, living standard in the drought', of: (w) => meanOf(w, 'decA', inDrought[0], inDrought[1], 0) },
			{ id: 'poorH', label: 'poorest holdings decile, living standard in the drought', of: (w) => meanOf(w, 'decH', inDrought[0], inDrought[1], 0) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			const none = b.shortPD === 0 && c.shortPD === 0;
			return `In the drought, dividends paid the owner-only blobs’ basics ${sig(b.strictInDrought)}× over with Law 5 and ${c.strictInDrought > 0.001 ? `${sig(c.strictInDrought)}× over` : 'not at all'} without it${none ? ', and nobody went short in either world.' : `; ${f0(b.shortPD)} and ${f0(c.shortPD)} person-days were short.`}`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`In the drought, water cost ${f2(b.waterPeak)}× its earlier price with Law 5 and ${f2(c.waterPeak)}× without. ` +
				`The lowest room to pay of anyone was ${f2(b.poorRoomDays)} days of the basic bundle a day with Law 5 and ${f2(c.poorRoomDays)} without. ` +
				`The poorest tenth by holdings lived at ${f2(b.poorH)} R a day in the drought with Law 5 and ${f2(c.poorH)} without; by Aven output, ${f2(b.poorL)} and ${f2(c.poorL)}. ` +
				`Owner-only dividends paid ${f2(b.strictInDrought)}× their basic bundle at worst with Law 5, and ${f2(c.strictInDrought)}× without. ` +
				`Person-days short: ${b.shortPD} with Law 5, ${c.shortPD} without.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.shortPD === 0 && b.poorRoomDays >= 1 && b.strictInDrought >= 1 && b.strictInDrought > c.strictInDrought,
				claim: 'With Law 5 at 20 %, nobody is short, everyone can still pay at least a day of basics each day, and dividends alone pay the owner-only cohort’s basics through the drought, which they do not at 0 %. (Law 5’s work here is the owner-only cohort’s income; the poorest tenth’s levels in both worlds are in the numbers.)',
				evidence: `20 %: short ${b.shortPD} person-days, lowest room ${f2(b.poorRoomDays)} days of the bundle, owner-only dividends ≥ ${f2(b.strictInDrought)}× the bundle. 0 %: short ${c.shortPD}, room ${f2(c.poorRoomDays)} days, dividends ${f2(c.strictInDrought)}×.`
			};
		}
	},

	X2: {
		id: 'X2',
		question: 'Can a blob live without working?',
		ruleChanged: 'The owner-only cohort (5 %, Aven output 0, nothing held at the start) spends dividends and some of what it holds (base) vs dividends only (changed).',
		guesses: [
			'Dividends alone pay the basic bundle after about four months. Before that, the dividends-only cohort goes short.',
			'Spending some of what it holds, the cohort is never short, from day 1.',
			'Living on dividends only, the cohort’s holding grows faster, and its dividends with it.'
		],
		people: PAGE_PEOPLE,
		years: 3,
		base: { ownerSpend: 'normal' },
		changed: { ownerSpend: 'dividends' },
		charts: ['owner-only dividends ÷ basic bundle (strict test)', 'owner-only lowest holding in days of the bundle', 'owner-only living standard'],
		metrics: [
			{ id: 'ownerShort', label: 'owner-only person-days short (after day 0)', of: (w) => sumOf(w, 'ownerShort', 1) },
			{ id: 'ownerShortAfter120', label: 'owner-only person-days short after day 120', of: (w) => sumOf(w, 'ownerShort', 121) },
			{ id: 'lastShortDay', label: 'last day an owner-only person was short', of: (w) => lastShortDay(w) },
			{ id: 'strictFrom', label: 'strict test (dividends ≥ bundle, all of the cohort) holds every day from day', of: (w, p) => p.P2.strict.holdsEveryDayFrom },
			{ id: 'ownerL', label: 'owner-only living standard, last year', of: (w) => meanOf(w, 'ownerL', ...lastYear(w)) },
			{ id: 'ownerHoldDays', label: 'owner-only lowest holding, days of the basic bundle, end', of: (w) => w.rec.ownerHoldDays[w.rec.n - 1] }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			// (the strict test is −1 when dividends alone never paid every member's bundle on every day to the end)
			const strict = b.strictFrom >= 0 ? `dividends alone paid every member’s bundle every day from day ${b.strictFrom}` : 'dividends alone never paid every member’s bundle on every day to the end (the strict test)';
			return c.ownerShort > 0 ? `Living on dividends alone, the owner-only blobs went short until day ${c.lastShortDay}; spending some of what they hold as well, they were ${b.ownerShort > 0 ? `short on ${f0(b.ownerShort)} person-days` : 'never short'}.` : `The owner-only blobs were never short, even on dividends alone; in the base run ${strict}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				(c.ownerShort > 0 ? `On dividends only, the owner-only blobs were short ${c.ownerShort} person-days, the last on day ${c.lastShortDay}. ` : `On dividends only, the owner-only blobs were never short of a basic. `) +
				`Spending some of what they hold as well, they were short ${b.ownerShort} person-days. ` +
				(b.strictFrom >= 0 ? `Dividends alone paid every member’s bundle every day from day ${b.strictFrom}. ` : 'Dividends alone never paid every member’s bundle on every day to the end of the run (the strict test). ') +
				`Their living standard in the last year: ${f2(c.ownerL)} on dividends only, ${f2(b.ownerL)} normally.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.ownerShort === 0 && c.ownerShortAfter120 === 0 && b.strictFrom > 0 && b.strictFrom <= 120,
				claim: 'Normal: never short from day 1. Strict: dividends alone pay the basic bundle by day 120, and the dividends-only cohort is never short after it.',
				evidence: `normal short ${b.ownerShort}; dividends-only short ${c.ownerShort} (after day 120: ${c.ownerShortAfter120}, last day ${c.lastShortDay}); strict test ${b.strictFrom >= 0 ? `from day ${b.strictFrom}` : 'never held to the end'}`
			};
		}
	},

	X3: {
		id: 'X3',
		question: 'Where does the MIND end up?',
		ruleChanged: 'Treasuries pay their surplus above the 270-day reserve out for Aven work proposals (base) vs keep it (changed).',
		guesses: [
			{ text: 'With payout, people hold most of all MIND. Without it, the treasuries hold most.', check: (rb, rc) => rb.values.peopleShare > 0.5 && rc.values.treShare > 0.5 },
			{ text: 'Law 5 still pays people a fifth of every sale, so the gap is small.', check: (rb, rc) => rb.values.peopleShare - rc.values.peopleShare < 0.1 },
			{ text: 'Without payout, the owner-only cohort gets smaller dividends, because people own less.', check: (rb, rc) => rc.values.strictMed < rb.values.strictMed }
		],
		people: PAGE_PEOPLE,
		years: 8,
		base: { payout: true },
		changed: { payout: false },
		charts: ['who holds the MIND: people, treasuries, pools', 'owner-only dividends ÷ basic bundle', 'decile living standards'],
		metrics: [
			{ id: 'peopleShare', label: 'people’s share of all MIND (R), end', of: (w) => ownership(w).people },
			{ id: 'treShare', label: 'treasuries’ share of all MIND, end', of: (w) => ownership(w).treasuries },
			{ id: 'poolShare', label: 'the city’s pools’ share of all MIND, end (their LP tokens are the MaiaCity COOP’s)', of: (w) => ownership(w).pools },
			{ id: 'strictMed', label: 'owner-only median dividends ÷ basic bundle, last year', of: (w) => meanOf(w, 'strictMed', ...lastYear(w)) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest holdings decile, last year', of: (w) => meanOf(w, 'decH', ...lastYear(w), 0) },
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) },
			{ id: 'p3', label: 'Proposition 3 holds (1 = yes)', of: (w, p) => (p.pass ? 1 : 0) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `With payout, people ended up holding ${pc0(b.peopleShare)} of all MIND; when treasuries kept their surplus, only ${pc0(c.peopleShare)}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With payout, people held ${pct(b.peopleShare)} of all MIND at the end; when treasuries kept their surplus, ${pct(c.peopleShare)}. ` +
				`Treasuries held ${pct(b.treShare)} vs ${pct(c.treShare)}. ` +
				`The poorest decile lived at ${f2(b.Lpoor)} with payout and ${f2(c.Lpoor)} without.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.peopleShare - c.peopleShare >= 0.2 && b.peopleShare >= 0.5,
				claim: 'Law 5 alone is not enough: with payout people hold most of the MIND, at least 20 points more than when treasuries keep their surplus.',
				evidence: `people’s share ${pct(b.peopleShare)} (payout) vs ${pct(c.peopleShare)} (keep), gap ${pct(b.peopleShare - c.peopleShare)}`
			};
		}
	},

	X4: {
		id: 'X4',
		question: 'Does inequality fade?',
		ruleChanged: 'Melt 7 % a year (base) vs 0 % (changed). In both worlds, holdings are made as unequal as Germany’s (Gini 0.72) at the start of year 9.',
		guesses: [
			{ text: 'With the melt, the Gini falls from about 0.7 to below 0.5 within seven years. Without it, it barely moves.', check: (rb, rc) => rb.values.giniEnd < 0.5 && rc.values.giniAfter - rc.values.giniEnd < 0.05 },
			{ text: 'Without the melt, the equal HEARTS still dilute the old fortunes, only more slowly.', check: (rb, rc) => rc.values.giniEnd < rc.values.giniAfter - 0.02 && rc.values.giniEnd > rb.values.giniEnd }
		],
		people: PAGE_PEOPLE,
		years: 15,
		base: { melt: 0.07, shocks: [{ kind: 'germany', day: GERMANY_DAY, days: 1 }] },
		changed: { melt: 0, shocks: [{ kind: 'germany', day: GERMANY_DAY, days: 1 }] },
		charts: ['holdings Gini over time', 'holdings decile living standards', 'owner-only holding'],
		metrics: [
			{ id: 'giniBefore', label: 'holdings Gini just before the shock', of: (w) => monthAt(w, GERMANY_DAY - 30).gini },
			{ id: 'giniAfter', label: 'holdings Gini a month after the shock', of: (w) => monthAt(w, GERMANY_DAY + 30).gini },
			{ id: 'gini3', label: 'holdings Gini 3 years after', of: (w) => monthAt(w, GERMANY_DAY + 3 * Y).gini },
			{ id: 'giniEnd', label: 'holdings Gini at the end', of: (w) => monthAt(w, w.day).gini },
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) },
			{ id: 'Lpoor', label: 'poorest holdings decile, last year', of: (w) => meanOf(w, 'decH', ...lastYear(w), 0) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `After the shock the holdings Gini fell from ${f2(b.giniAfter)} to ${f2(b.giniEnd)} with the melt, and only to ${f2(c.giniEnd)} without it.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`The shock raised the Gini of holdings to ${f2(b.giniAfter)}. ` +
				`With the melt it fell to ${f2(b.giniEnd)} by the end. Without the melt it fell to ${f2(c.giniEnd)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.giniEnd < c.giniEnd && b.giniAfter - b.giniEnd >= (b.giniAfter - b.giniBefore) / 2,
				claim: 'The melt fades every advantage: with it, at least half the shock’s extra inequality is gone by the end, and the Gini ends lower than without the melt.',
				evidence: `Gini ${f2(b.giniBefore)} → ${f2(b.giniAfter)} → ${f2(b.giniEnd)} with melt; ${f2(c.giniBefore)} → ${f2(c.giniAfter)} → ${f2(c.giniEnd)} without`
			};
		}
	},

	X5: {
		id: 'X5',
		question: 'What if a food COOP fails?',
		ruleChanged: 'Two food COOPs at genesis (base) vs one (changed). In both worlds the food COOP AGRI fails on day 300: its output drops to 10 % for a year.',
		guesses: [
			{ text: 'With one food COOP, people go short until the plants find a new COOP. With two, the other seller covers.', check: (rb, rc) => rc.values.foodShort > 0 && rb.values.foodShort === 0 },
			{ text: 'The other seller is too small to cover a whole forest, so both worlds go short for a while.', check: (rb, rc) => rb.values.foodShort > 0 && rc.values.foodShort > 0 },
			{ text: 'The audit sends the failing COOP into receivership within two months; its plants go on making food.', check: (rb) => rb.values.exitDay >= 0 && rb.values.exitDay <= 61 }
		],
		people: PAGE_PEOPLE,
		years: 3,
		base: { shocks: [{ kind: 'coopFail', coop: 'AGRI', day: FAIL_DAY, days: 365, factor: 0.1 }] },
		changed: { coopsOf: { food: 1 }, shocks: [{ kind: 'coopFail', coop: 'AGRI', day: FAIL_DAY, days: 365, factor: 0.1 }] },
		charts: ['food met, lowest person', 'food stores', 'food price'],
		metrics: [
			{ id: 'foodShort', label: 'person-days short of food (after day 0)', of: (w) => w.rec.shortPD[FOOD] },
			{ id: 'shortPD', label: 'person-days short of any basic', of: (w) => shortPD(w) },
			{ id: 'foodMin', label: 'lowest share of food need met by anyone', of: (w) => minOf(w, 'minMet', 1, w.rec.n, FOOD) },
			{ id: 'exitDay', label: 'days from the failure to receivership', of: (w) => { const e = w.events.find((x) => x.kind === 'receivership' && x.coop === 'AGRI'); return e ? e.day - FAIL_DAY : -1; } },
			{ id: 'greenAlive', label: 'the other food COOP alive at the failure (1 = yes)', of: (w) => { const g = w.coops.find((c) => c.id === 'GREEN'); return g && (g.alive || g.died > FAIL_DAY) ? 1 : 0; } },
			{ id: 'foodPeak', label: 'food price peak ÷ before the failure', of: (w) => maxOf(w, 'pbar', FAIL_DAY, FAIL_DAY + 180, FOOD) / meanOf(w, 'pbar', FAIL_DAY - 60, FAIL_DAY, FOOD) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `When a food COOP failed, people were short of food on ${f0(b.foodShort)} person-days with two food COOPs and on ${f0(c.foodShort)} with one.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With two food COOPs, people were short of food ${f0(b.foodShort)} person-days; with one, ${f0(c.foodShort)}. ` +
				`The failing COOP went into receivership after ${b.exitDay} days (two sellers) and ${c.exitDay} days (one). ` +
				`The lowest food share anyone got was ${pct(b.foodMin)} vs ${pct(c.foodMin)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.foodShort === 0,
				claim: 'Two sellers of each basic keep everyone fed: with two food COOPs, nobody is short of food when one fails.',
				evidence: `two food COOPs: ${f0(b.foodShort)} person-days short of food (the second seller ${b.greenAlive ? 'was' : 'was not'} alive at the failure; receivership after ${b.exitDay} days); one: ${f0(c.foodShort)}`
			};
		}
	},

	X6: {
		id: 'X6',
		question: 'Can four friends cheat?',
		ruleChanged: 'Avens send HEARTS by delivered output per HEART (base) vs by the MIND’s pool price (changed). In both worlds, four friends open a COOP that makes nothing on day 365. They pay themselves 90 % of its treasury and buy its MIND to push its price.',
		guesses: [
			{ text: 'Following delivered output, the Avens send the ring almost nothing. Following the pool price, the ring draws a few percent of all HEARTS.', check: (rb, rc) => rb.values.ringShare < 0.01 && rc.values.ringShare >= 0.02 },
			{ text: 'The ring’s COOP never builds a plant, so receivership closes it within a year either way.', check: (rb, rc) => [rb, rc].every((r) => r.values.ringDied > 0 && r.values.ringDied - RING_DAY <= Y) }
		],
		people: PAGE_PEOPLE,
		years: 2,
		base: { allocBy: 'output', shocks: [{ kind: 'ring', day: RING_DAY, days: RING_DAYS, size: 4 }] },
		changed: { allocBy: 'price', shocks: [{ kind: 'ring', day: RING_DAY, days: RING_DAYS, size: 4 }] },
		charts: ['the ring’s share of other people’s HEARTS', 'ring members’ holding ÷ others', 'person-days short'],
		metrics: [
			{ id: 'ringShare', label: 'share of other people’s HEARTS that went into the ring', of: (w) => (w.ring?.heartsAll ? w.ring.heartsIn / w.ring.heartsAll : NaN) },
			{ id: 'ringPeople', label: 'the ring’s share of people', of: (w) => (w.ring ? w.ring.members.length / w.N : NaN) },
			{ id: 'wealth0', label: 'ring members’ mean holding ÷ others’, at the start', of: (w) => w.ring?.wealth0 ?? NaN },
			{ id: 'wealth1', label: 'ring members’ mean holding ÷ others’, at the end of the ring', of: (w) => w.ring?.wealth1 ?? NaN },
			{ id: 'ringDied', label: 'day the ring’s COOP went into receivership (−1: never)', of: (w) => (w.ring ? w.coops[w.ring.k].died : -1) },
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `Avens that follow delivered output sent the ring ${pct(b.ringShare)} of other people’s HEARTS; Avens that follow the pool price sent it ${pct(c.ringShare)}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`Following delivered output, Avens sent the ring ${pct(b.ringShare)} of others’ HEARTS; following the pool price, ${pct(c.ringShare)}. ` +
				`The ring is ${pct(b.ringPeople)} of the people. ` +
				`Its members ended at ${f2(b.wealth1)}× the others’ mean holding (output rule) and ${f2(c.wealth1)}× (price rule).`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.ringShare < c.ringShare && b.ringShare <= b.ringPeople,
				claim: 'Avens that follow delivered output starve a ring: it gets less than under the price rule, and no more than its share of the people.',
				evidence: `ring share of others’ HEARTS ${pct(b.ringShare)} (output) vs ${pct(c.ringShare)} (price); its share of people ${pct(b.ringPeople)}`
			};
		}
	},

	X7: {
		id: 'X7',
		question: 'Who keeps the surplus?',
		ruleChanged: 'Two competing COOPs per good at genesis (base) vs one (changed).',
		guesses: [
			{ text: 'With one seller, basics sell well above full cost and the COOP keeps the surplus. With two, the price falls toward cost and buyers keep it.', check: (rb, rc) => rc.values.markup > 1.2 && rb.values.markup < rc.values.markup && rc.values.sellerShare > rb.values.sellerShare },
			{ text: 'Law 3 founds a second seller where one is dear, so the gap closes within a few years.', check: (rb, rc) => rc.values.founded > 0 && rc.values.markupLast <= 1.1 * rb.values.markupLast }
		],
		people: PAGE_PEOPLE,
		years: 6,
		base: { coopsPerGood: 2 },
		changed: { coopsPerGood: 1 },
		charts: ['basics’ price ÷ full cost', 'sellers’ share of basics revenue above variable cost', 'decile living standards'],
		metrics: [
			{ id: 'markup', label: 'basics’ price ÷ full cost, whole run', of: (w) => markupAll(w).markup },
			{ id: 'markupLast', label: 'basics’ price ÷ full cost, last year', of: (w) => markupOf(w.xt.years[w.xt.years.length - 1]).markup },
			{ id: 'sellerShare', label: 'sellers’ share of basics revenue above variable cost', of: (w) => markupAll(w).sellerShare },
			{ id: 'basicCost', label: 'basic bundle, R a day, mean', of: (w) => meanOf(w, 'basicCostR', 1) },
			{ id: 'Lpoor', label: 'poorest Aven decile, last year', of: (w) => meanOf(w, 'decA', ...lastYear(w), 0) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) },
			{ id: 'founded', label: 'COOPs founded (Law 3)', of: (w) => w.events.filter((e) => e.kind === 'found').length }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `With two sellers per good, basics sold at ${sig(b.markup)}× their full cost; with one seller, at ${sig(c.markup)}×.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With two sellers per good, basics sold at ${f2(b.markup)}× their full cost; with one, at ${f2(c.markup)}×. ` +
				`Sellers kept ${pct(b.sellerShare)} vs ${pct(c.sellerShare)} of basics revenue above variable cost. ` +
				`The poorest decile lived at ${f2(b.Lpoor)} vs ${f2(c.Lpoor)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.markup < c.markup && b.sellerShare < c.sellerShare && b.shortPD === 0,
				claim: 'When sellers compete, citizens win: with two sellers basics sell closer to cost, sellers keep less of the revenue, and nobody is short.',
				evidence: `price ÷ full cost ${f2(b.markup)} (two) vs ${f2(c.markup)} (one); sellers’ share ${pct(b.sellerShare)} vs ${pct(c.sellerShare)}; short ${b.shortPD} vs ${c.shortPD}`
			};
		}
	},

	X8: {
		id: 'X8',
		question: 'Which price rule feeds everyone?',
		ruleChanged: 'Forward-margin price with Mark-0’s guard (base) vs Primer’s adaptive price (changed): each seller asks 3 % more after a day it sold out, and 3 % less after a day with stock left.',
		guesses: [
			{ text: 'The forward margin reads need and the harvest ahead, so nobody goes short. Primer’s price lags behind the seasons.', check: (rb, rc) => rb.values.shortPD === 0 && rc.values.shortPD > 0 },
			{ text: 'Primer’s price swings more from day to day.', check: (rb, rc) => rc.values.swing > rb.values.swing }
		],
		people: PAGE_PEOPLE,
		years: 6,
		base: { priceRule: 'forward' },
		changed: { priceRule: 'primer' },
		charts: ['basics’ prices', 'person-days short', 'lowest share of a basic met'],
		metrics: [
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) },
			{ id: 'swing', label: 'mean daily price swing of the basics (ln)', of: (w) => [FOOD, WATER, ENERGY, BED].reduce((a, g) => a + priceSwing(w, g), 0) / 4 },
			{ id: 'minMet', label: 'lowest share of any basic met by anyone', of: (w) => Math.min(...[0, 1, 2, 3].map((b) => minOf(w, 'minMet', 1, w.rec.n, b))) },
			{ id: 'markup', label: 'basics’ price ÷ full cost, whole run', of: (w) => markupAll(w).markup },
			{ id: 'Lpoor', label: 'poorest Aven decile, last year', of: (w) => meanOf(w, 'decA', ...lastYear(w), 0) },
			{ id: 'exits', label: 'receiverships', of: (w) => w.events.filter((e) => e.kind === 'receivership').length }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `People were short on ${f0(b.shortPD)} person-days with the forward margin and ${f0(c.shortPD)} with Primer’s adaptive price, whose basics’ prices swung ${c.swing > b.swing ? 'more' : 'less'} from day to day.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With the forward margin, ${f0(b.shortPD)} person-days were short; with Primer’s adaptive price, ${f0(c.shortPD)}. ` +
				`Basics’ prices swung ${pct(b.swing)} a day vs ${pct(c.swing)}. ` +
				`The poorest decile lived at ${f2(b.Lpoor)} vs ${f2(c.Lpoor)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.shortPD === 0 && b.shortPD <= c.shortPD && b.swing <= c.swing,
				claim: 'A price that reads need and the harvest pipeline feeds everyone: no one short, and no more shortage or price swing than Primer’s baseline.',
				evidence: `short ${f0(b.shortPD)} (forward) vs ${f0(c.shortPD)} (Primer); daily swing ${pct(b.swing)} vs ${pct(c.swing)}`
			};
		}
	},

	X9: {
		id: 'X9',
		question: 'Does more money make us richer?',
		ruleChanged: '24 (base) vs 48 (changed) HEARTS a day for every person. The Aven rate card is a number in R indexed to the HEARTS issued a day (HEARTS a day ÷ 24), so it doubles too. HEARTS never pay for goods.',
		guesses: ['Prices in R double; what people get stays the same within 1 %.', 'People get a little more, because more MIND flows into the COOPs and they build sooner.'],
		people: PAGE_PEOPLE,
		years: 6,
		base: { heartsPerDay: 24 },
		changed: { heartsPerDay: 48 },
		charts: ['prices in R', 'what a person gets of each good', 'mean living standard'],
		metrics: [
			{ id: 'Lmean', label: 'mean living standard over the run', of: (w) => meanOf(w, 'Lmean', 1) },
			{ id: 'Lpoor', label: 'poorest Aven decile, living standard over the run', of: (w) => meanOf(w, 'decA', 1, w.rec.n, 0) },
			...CONSUMER.map((g) => ({ id: 'cons_' + GOOD_IDS[g], label: `${GOOD_IDS[g]} a person a day over the run`, of: (w) => meanOf(w, 'cons', 1, w.rec.n, g) })),
			...[FOOD, WATER, ENERGY].map((g) => ({ id: 'price_' + GOOD_IDS[g], label: `${GOOD_IDS[g]} price (R) over the run`, of: (w) => meanOf(w, 'pbar', 1, w.rec.n, g) })),
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			const worst = Math.max(...CONSUMER.map((g) => Math.abs(rel(c['cons_' + GOOD_IDS[g]], b['cons_' + GOOD_IDS[g]]))).filter(Number.isFinite));
			return `With twice the HEARTS, food’s price in R went ×${sig(c.price_food / b.price_food)} while what people got of any good changed by at most ${pct(worst)}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			const dev = CONSUMER.map((g) => Math.abs(rel(c['cons_' + GOOD_IDS[g]], b['cons_' + GOOD_IDS[g]])));
			const worst = Math.max(...dev.filter(Number.isFinite));
			return (
				`With twice the HEARTS, food’s price in R went ×${f2(c.price_food / b.price_food)}, water’s ×${f2(c.price_water / b.price_water)}, energy’s ×${f2(c.price_energy / b.price_energy)}. ` +
				`What people got changed by at most ${pct(worst)} for any good. The mean living standard changed by ${pct(rel(c.Lmean, b.Lmean))}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			const rows = CONSUMER.map((g) => [GOOD_IDS[g], rel(c['cons_' + GOOD_IDS[g]], b['cons_' + GOOD_IDS[g]])]);
			const worst = rows.reduce((m, r) => (Math.abs(r[1]) > Math.abs(m[1]) ? r : m), ['', 0]);
			return {
				pass: rows.every((r) => Math.abs(r[1]) <= 0.01) && Math.abs(rel(c.Lmean, b.Lmean)) <= 0.01,
				claim: 'Doubling HEARTS changes only prices: real consumption of every good, and the mean living standard, within ±1 %. This holds because the Aven rate card (in R) is indexed to the HEARTS issued a day; with the card fixed in R it does not (the proof suite’s B28 reports that world).',
				evidence: `largest change: ${worst[0]} ${pct(worst[1])}; living standard ${pct(rel(c.Lmean, b.Lmean))}; ${rows.map((r) => `${r[0]} ${pct(r[1])}`).join(', ')}`
			};
		}
	},

	X10: {
		id: 'X10',
		question: 'Does more energy make us richer?',
		ruleChanged: 'The geothermal stage and R&D on surplus energy on (base) vs both off (changed).',
		guesses: ['With surplus energy, decile living standards keep rising; without, they stall.', 'Without the geothermal stage, the winter is short of energy for the basics.'],
		people: PAGE_PEOPLE,
		years: 10,
		base: { geothermal: true, rd: true },
		changed: { geothermal: false, rd: false },
		charts: ['energy a person next to each decile’s living standard', 'where the energy goes', 'how far recipes have come toward their physical best'],
		metrics: [
			{ id: 'ePP', label: 'electricity used a person a day (kWh), last year', of: (w) => meanOf(w, 'ePP', ...lastYear(w)) },
			{ id: 'surplusPP', label: 'surplus energy (R&D, storage, curtailed) a person a day (kWh), last year', of: (w) => meanOf(w, 'surplusPP', ...lastYear(w)) },
			{ id: 'exportPP', label: 'electricity exported for accelerators a person a day (kWh), last year', of: (w) => meanOf(w, 'exportPP', ...lastYear(w)) },
			{ id: 'rdMwh', label: 'R&D energy, all years (MWh)', of: (w) => sumOf(w, 'rdKwh', 0) / 1000 },
			{ id: 'learn', label: 'how far recipes have come toward their physical best', of: (w) => learnProgress(w) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest Aven decile, last year', of: (w) => meanOf(w, 'decA', ...lastYear(w), 0) },
			{ id: 'Lpoor2', label: 'poorest Aven decile, year 2', of: (w) => meanOf(w, 'decA', Y, 2 * Y, 0) },
			{ id: 'Lceil', label: 'capacity per person (mean) of the living standard, last year', of: (w) => meanOf(w, 'Lceil', ...lastYear(w)) },
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `With geothermal and R&D the poorest tenth went from ${sig(b.Lpoor2)} to ${sig(b.Lpoor)} R a day; without them, from ${sig(c.Lpoor2)} to ${sig(c.Lpoor)}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With geothermal and R&D, a person used ${f2(b.ePP)} kWh a day in the last year, ${f2(b.exportPP)} kWh were exported for accelerators and ${f2(b.surplusPP)} kWh were surplus (R&D, storage, curtailed); R&D took ${f0(b.rdMwh)} MWh over the run (recipes ${pct(b.learn)} of the way to their physical best). ` +
				`Without, ${f2(c.ePP)} kWh used, ${f2(c.exportPP)} exported, and ${pct(c.learn)}. ` +
				`The poorest decile went from ${f2(b.Lpoor2)} to ${f2(b.Lpoor)} with surplus energy, and from ${f2(c.Lpoor2)} to ${f2(c.Lpoor)} without. ` +
				`Person-days short: ${f0(b.shortPD)} vs ${f0(c.shortPD)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.Lmean > c.Lmean && b.Lpoor > c.Lpoor && b.learn > c.learn,
				claim: 'Living standards (mean and poorest decile) end higher with surplus energy and R&D than without, and recipes get better only with it.',
				evidence: `mean ${f2(b.Lmean)} vs ${f2(c.Lmean)}; poorest decile ${f2(b.Lpoor)} vs ${f2(c.Lpoor)}; recipes ${pct(b.learn)} vs ${pct(c.learn)} of the way to their physical best`
			};
		}
	},

	X11: {
		id: 'X11',
		question: 'What stops a small village first?',
		ruleChanged: '1,500 blobs (base) vs 600 blobs (changed) in the same village, built for 1,500, with dome solar and no geothermal stage yet (world model 5.5). This experiment changes the population.',
		guesses: [
			{ text: 'With 1,500, energy binds first (in winter): someone is short of energy on more days than of water.', check: (rb) => rb.values.energyShortDays > 0 && rb.values.energyShortDays >= rb.values.waterShortDays },
			{ text: 'With 600, the same village is roomy: fewer limits bind, and nobody is short.', check: (rb, rc) => rc.values.shortPD === 0 },
			{ text: 'MIND never binds a basic in either world.', check: (rb, rc) => rb.values.mindBinds === 0 && rc.values.mindBinds === 0 }
		],
		people: 1500,
		years: 6,
		base: { people: 1500, geothermal: false },
		changed: { people: 600, geothermal: false },
		charts: ['binding-limit badge of each good', 'energy a person and the capacity per person', 'person-days short'],
		metrics: [
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) },
			{ id: 'shortPP', label: 'days short a person (person-days ÷ people)', of: (w) => shortPD(w) / w.N },
			{ id: 'mindBinds', label: 'day-goods (a day and a basic) MIND bound a basic while physics allowed need', of: (w, p) => p.abundance.mindBindsBasics },
			{ id: 'energyBadge', label: 'share of days energy’s badge read “energy”', of: (w) => badgeShare(w, ENERGY, LIMIT.energy) },
			{ id: 'energyShortDays', label: 'days someone was short of energy', of: (w) => { let n = 0; for (let d = 1; d < w.rec.n; d++) if (w.rec.shortN[d * 4 + ENERGY] > 0) n++; return n; } },
			{ id: 'waterShortDays', label: 'days someone was short of water', of: (w) => { let n = 0; for (let d = 1; d < w.rec.n; d++) if (w.rec.shortN[d * 4 + WATER] > 0) n++; return n; } },
			{ id: 'woodTop', label: 'wood’s most frequent binding limit', of: (w) => topBadge(w, 4).limit },
			{ id: 'bedTop', label: 'beds’ most frequent binding limit', of: (w) => topBadge(w, BED).limit },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			// person-days short of any basic in both worlds first (energy days alone hid the beds and the water)
			return `With 1,500 blobs, ${f0(b.shortPD)} person-days were short of a basic (${f2(b.shortPP)} days a person; someone short of energy on ${f0(b.energyShortDays)} days); with 600 in the same village, ${f0(c.shortPD)} person-days (${f2(c.shortPP)} a person; energy on ${f0(c.energyShortDays)} days). MIND ${b.mindBinds + c.mindBinds === 0 ? 'never bound a basic' : `bound a basic on ${b.mindBinds} and ${c.mindBinds} day-goods`}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With 1,500 blobs, someone was short of energy on ${b.energyShortDays} days and of water on ${b.waterShortDays}. With 600, on ${c.energyShortDays} and ${c.waterShortDays} days. ` +
				`MIND bound a basic on ${b.mindBinds} day-goods with 1,500 and ${c.mindBinds} with 600. ` +
				`Wood was bound by ${b.woodTop} (1,500) and ${c.woodTop} (600).`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.mindBinds === 0 && c.mindBinds === 0 && c.shortPP <= b.shortPP,
				claim: 'Physics, not money, sets the limit: MIND never binds a basic while physics allows need, and fewer people on the same hex are short less.',
				evidence: `MIND-bound basic day-goods ${b.mindBinds} (1,500) and ${c.mindBinds} (600); person-days short of a basic ${f0(b.shortPD)} (1,500) and ${f0(c.shortPD)} (600); days short a person ${f2(b.shortPP)} vs ${f2(c.shortPP)}; short days by limit (1,500): ${JSON.stringify(shortDaysByLimit(rb.world ?? { rec: { n: 0 } }))}`
			};
		}
	},

	X12: {
		id: 'X12',
		question: 'Do newcomers eat?',
		ruleChanged: 'A constant population (base) vs +2 % a year (changed), on the same fixed land. Newcomers arrive with an Aven and nothing held.',
		guesses: [
			{ text: 'Ground rent rises as land fills up. Newcomers are never short: the MIND from their first HEARTS pays the basic bundle on day 1.', check: (rb, rc) => rc.values.rentEnd > rb.values.rentEnd && rc.values.newcomerShort === 0 },
			{ text: 'Each person’s living standard grows more slowly with growth, because capital must be built for the newcomers.', check: (rb, rc) => rc.values.Lmean < rb.values.Lmean }
		],
		people: PAGE_PEOPLE,
		years: 8,
		base: { popGrowth: 0 },
		changed: { popGrowth: 0.02, maxYears: 8 },
		charts: ['people', 'ground rent', 'newcomers’ share of the basic bundle met'],
		metrics: [
			{ id: 'N', label: 'people at the end', of: (w) => w.N },
			{ id: 'newcomerPD', label: 'newcomer person-days (first 3 years after arrival)', of: (w) => w.xt.newcomerPD },
			{ id: 'newcomerShort', label: 'newcomer person-days short of a basic', of: (w) => w.xt.newcomerShortPD },
			{ id: 'shortPD', label: 'person-days short of a basic (everyone)', of: (w) => shortPD(w) },
			{ id: 'rent0', label: 'ground rent (R a m² a day), year 1', of: (w) => w.xt.years[0].landRent / w.xt.years[0].days },
			{ id: 'rentEnd', label: 'ground rent, last year', of: (w) => { const Yr = w.xt.years[w.xt.years.length - 1]; return Yr.landRent / Yr.days; } },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest holdings decile, last year', of: (w) => meanOf(w, 'decH', ...lastYear(w), 0) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `The village grew to ${c.N} people; newcomers were ${c.newcomerShort > 0 ? `short on ${f0(c.newcomerShort)} person-days` : 'never short'}, and ground rent ended ${sig(c.rentEnd / b.rentEnd)}× the rent with a constant population.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With growth the village went from ${PAGE_PEOPLE} to ${c.N} people. Newcomers lived ${f0(c.newcomerPD)} person-days in their first three years and were short on ${f0(c.newcomerShort)}. ` +
				`Ground rent went from ${c.rent0.toExponential(2)} to ${c.rentEnd.toExponential(2)} R a m² a day (constant population: ${b.rentEnd.toExponential(2)}). ` +
				`The mean living standard ended at ${f2(c.Lmean)} vs ${f2(b.Lmean)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: c.newcomerPD > 0 && c.newcomerShort === 0 && c.rentEnd > b.rentEnd,
				claim: 'Growth raises rent, not hunger: newcomers are never short, and ground rent ends higher than with a constant population.',
				evidence: `newcomers short ${c.newcomerShort} of ${c.newcomerPD} person-days; rent at the end ${c.rentEnd.toExponential(2)} (growth) vs ${b.rentEnd.toExponential(2)} (constant)`
			};
		}
	},

	X13: {
		id: 'X13',
		question: 'Private land or City land?',
		ruleChanged: 'All land belongs to the City COOP and is leased for ground rent (base) vs land owned by people, unequally (a Pareto draw), with the rent paid to them (changed).',
		guesses: [
			{ text: 'With private land the holdings Gini rises toward 0.5; with City land it stays near 0.3.', check: (rb, rc) => rc.values.giniEnd >= 0.45 && Math.abs(rb.values.giniEnd - 0.3) <= 0.1 },
			{ text: 'Private landowners live better, renters are not short.', check: (rb, rc) => rc.values.Ltop > rb.values.Ltop && rc.values.shortPD === 0 }
		],
		people: PAGE_PEOPLE,
		years: 8,
		base: { landRule: 'city' },
		changed: { landRule: 'private' },
		charts: ['holdings Gini', 'holdings decile living standards', 'ground rent'],
		metrics: [
			{ id: 'giniEnd', label: 'holdings Gini, end', of: (w) => monthAt(w, w.day).gini },
			{ id: 'gini3', label: 'holdings Gini, year 3', of: (w) => monthAt(w, 3 * Y).gini },
			{ id: 'Lpoor', label: 'poorest holdings decile, last year', of: (w) => meanOf(w, 'decH', ...lastYear(w), 0) },
			{ id: 'Ltop', label: 'top holdings decile, last year', of: (w) => meanOf(w, 'decH', ...lastYear(w), 9) },
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) },
			{ id: 'rentR', label: 'ground rent paid, R a person a day, last year', of: (w) => { const Yr = w.xt.years[w.xt.years.length - 1]; return Yr.rentR / Yr.days / w.N; } }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `The holdings Gini ended at ${f2(b.giniEnd)} with City land and at ${f2(c.giniEnd)} with private land.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With City land the holdings Gini ended at ${f2(b.giniEnd)}; with private land, at ${f2(c.giniEnd)}. ` +
				`The poorest decile lived at ${f2(b.Lpoor)} vs ${f2(c.Lpoor)}, the top decile at ${f2(b.Ltop)} vs ${f2(c.Ltop)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.giniEnd < c.giniEnd && b.shortPD === 0,
				claim: 'Land that nobody can sell keeps ownership fairer: the holdings Gini ends lower with City land than with private land, and nobody is short.',
				evidence: `Gini ${f2(b.giniEnd)} (City) vs ${f2(c.giniEnd)} (private); short ${b.shortPD} vs ${c.shortPD}`
			};
		}
	},

	X14: {
		id: 'X14',
		question: 'What happens on day 1?',
		ruleChanged: 'The bootstrap on (base: each Aven’s first HEARTS go to the basics COOPs it buys from, and pools fill on day 0) vs off (changed: first HEARTS into three COOPs of the Aven’s taste).',
		guesses: [
			{ text: 'Without the bootstrap, most people go short on the first days, because they hold no MIND the sellers take and the pools are empty.', check: (rb, rc) => Math.max(rc.values.short0, rc.values.short1) > 0.5 },
			{ text: 'With it, nobody is short from day 1.', check: (rb) => rb.values.shortPD === 0 }
		],
		people: PAGE_PEOPLE,
		years: 1,
		base: { bootstrap: true },
		changed: { bootstrap: false },
		charts: ['share of people short on each of the first 30 days', 'lowest share of a basic met'],
		metrics: [
			{ id: 'short0', label: 'share of people short of a basic on day 0', of: (w) => w.rec.shortAny[0] / w.N },
			{ id: 'short1', label: 'share of people short on day 1', of: (w) => w.rec.shortAny[1] / w.N },
			{ id: 'short30', label: 'person-days short in days 1–30', of: (w) => shortPD(w, 1, 31) },
			{ id: 'shortPD', label: 'person-days short in year 1 (after day 0)', of: (w) => shortPD(w) },
			{ id: 'minMet30', label: 'lowest share of any basic met in days 1–30', of: (w) => Math.min(...[0, 1, 2, 3].map((b) => minOf(w, 'minMet', 1, 31, b))) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `${b.short0 > 0 ? `With the bootstrap ${pc0(b.short0)} of people` : 'With the bootstrap nobody'} went short on day 0; without it, ${pc0(c.short0)} did.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With the bootstrap, ${pct(b.short0)} of people were short on day 0 and ${pct(b.short1)} on day 1. Without it, ${pct(c.short0)} and ${pct(c.short1)}. ` +
				`Over year 1: ${f0(b.shortPD)} vs ${f0(c.shortPD)} person-days short.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.short0 === 0 && b.shortPD === 0,
				claim: 'Seed the pools, and the first day feeds everyone: with the bootstrap nobody is short on day 0 or after.',
				evidence: `bootstrap: ${pct(b.short0)} short on day 0, ${f0(b.shortPD)} person-days in year 1; without: ${pct(c.short0)} on day 0, ${f0(c.shortPD)} person-days`
			};
		}
	},

	AB1: {
		id: 'AB1',
		question: 'Does doubling a binding physical limit raise living standards?',
		ruleChanged: 'The hot spring’s warm ponds are fixed by nature and bind every day: 2 sites (base) vs 4 (changed).',
		guesses: ['Spring time a person doubles toward its satiation, and the mean living standard rises.', 'The poorest decile gains little: it is bound by MIND, not by the spring.'],
		people: PAGE_PEOPLE,
		years: 6,
		base: { springSites: 2 },
		changed: { springSites: 4 },
		charts: ['spring hours a person', 'spring price', 'decile living standards and the capacity per person'],
		metrics: [
			{ id: 'spring', label: 'spring hours a person a day, last year', of: (w) => meanOf(w, 'cons', ...lastYear(w), SPRING) },
			{ id: 'springPrice', label: 'spring price (R an hour), last year', of: (w) => meanOf(w, 'pbar', ...lastYear(w), SPRING) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lceil', label: 'capacity per person (mean) of the living standard, last year', of: (w) => meanOf(w, 'Lceil', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest Aven decile, last year', of: (w) => meanOf(w, 'decA', ...lastYear(w), 0) },
			{ id: 'badge', label: 'share of days the spring’s badge read “nature”', of: (w) => badgeShare(w, SPRING, LIMIT.nature) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `Doubling the warm ponds took spring time from ${sig(b.spring)} to ${sig(c.spring)} hours a person a day and changed the mean living standard by ${pct(rel(c.Lmean, b.Lmean))}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`Doubling the warm ponds took spring time from ${f2(b.spring)} to ${f2(c.spring)} hours a person a day, and its price from ${f2(b.springPrice)} to ${f2(c.springPrice)} R. ` +
				`The mean living standard went from ${f2(b.Lmean)} to ${f2(c.Lmean)} (${pct(rel(c.Lmean, b.Lmean))}), the poorest decile’s from ${f2(b.Lpoor)} to ${f2(c.Lpoor)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: c.spring > b.spring && c.Lmean > b.Lmean && c.Lpoor > b.Lpoor,
				claim: 'Doubling the binding physical limit raises living standards: more of the good, a higher mean living standard and a higher one for the poorest decile.',
				evidence: `spring ${f2(b.spring)} → ${f2(c.spring)} h a person a day (badge “nature” on ${pct(b.badge)} of base days), mean ${f2(b.Lmean)} → ${f2(c.Lmean)}, poorest decile ${f2(b.Lpoor)} → ${f2(c.Lpoor)}; capacity per person ${f2(b.Lceil)} → ${f2(c.Lceil)}`
			};
		}
	},

	TW: {
		id: 'TW',
		question: 'What does the tower add, and what does it cost?',
		ruleChanged: 'The village without the Tower180 (base: one more Dome120 of utilities and community halls in the centre hex) vs with it (changed), at its real cost: the tower’s shell, floors and equipment on the founding bill, its beds, its solar cells, its halls’ upkeep, climate and heat.',
		guesses: [
			{ text: 'The tower adds beds and some solar, but costs far more at the founding than it gives: the founding bill rises by over €200 M.', check: (rb, rc) => rc.values.foundingM - rb.values.foundingM > 200 },
			{ text: 'Its glass and steel wear raise the village’s imports of materials a year.', check: (rb, rc) => rc.values.importMatEur > rb.values.importMatEur },
			{ text: 'Living standards barely change: nobody needs the tower’s beds at 1,500 people.', check: (rb, rc) => Math.abs(rel(rc.values.Lmean, rb.values.Lmean)) < 0.05 }
		],
		people: PAGE_PEOPLE,
		years: 10,
		base: { tower: false },
		changed: { tower: true },
		charts: ['mean living standard', 'energy a person and the capacity per person', 'person-days short'],
		metrics: [
			{ id: 'foundingM', label: 'founding bill, € M (the village built before day 0)', of: (w) => foundingBill(w).totalEur / 1e6 },
			{ id: 'beds', label: 'beds', of: (w) => w.c.village.beds.total * w.c.vf },
			{ id: 'solarGWh', label: 'solar in the glass, GWh a year (as built)', of: (w) => w.c.village.solarKwh * w.c.vf / 1e6 },
			{ id: 'energyPP', label: 'electricity made a person a day, kWh (mean of the run)', of: (w) => { const v = villageYears(w); return v.reduce((a, y) => a + y.energy.made.solar + y.energy.made.geothermal, 0) / Math.max(1, v.length); } },
			{ id: 'exportPP', label: 'electricity exported a person a day, kWh (mean of the run)', of: (w) => { const v = villageYears(w); return v.reduce((a, y) => a + y.energy.went.export, 0) / Math.max(1, v.length); } },
			{ id: 'importEur', label: 'imports, € a year (mean of the run)', of: (w) => { const b = borderYears(w); return b.reduce((a, y) => a + y.importEur, 0) / Math.max(1, b.length); } },
			{ id: 'importMatEur', label: 'imports of materials (glulam, steel, glazing, panels and their raw inputs), € a year (mean of the run)', of: (w) => { const b = borderYears(w); return b.reduce((a, y) => a + y.importEur - y.imports.food.eur - y.imports.accelerators.eur, 0) / Math.max(1, b.length); } },
			{ id: 'shortPD', label: 'person-days short of a basic (after day 0)', of: (w) => shortPD(w) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest holdings decile, last year', of: (w) => meanOf(w, 'decH', ...lastYear(w), 0) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return `The tower adds ${f0(c.beds - b.beds)} beds and ${f2(c.solarGWh - b.solarGWh)} GWh of solar a year for €${f0(c.foundingM - b.foundingM)} M more at the founding; the mean living standard changes by ${pct(rel(c.Lmean, b.Lmean))}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`Founding bill €${f0(b.foundingM)} M without the tower, €${f0(c.foundingM)} M with it. Beds ${f0(b.beds)} vs ${f0(c.beds)}; solar ${f2(b.solarGWh)} vs ${f2(c.solarGWh)} GWh a year. ` +
				`Electricity made ${f2(b.energyPP)} vs ${f2(c.energyPP)} kWh a person a day; exported ${f2(b.exportPP)} vs ${f2(c.exportPP)}. ` +
				`Imports €${f0(b.importEur)} vs €${f0(c.importEur)} a year (materials €${f0(b.importMatEur)} vs €${f0(c.importMatEur)}). ` +
				`Person-days short ${f0(b.shortPD)} vs ${f0(c.shortPD)}; mean living standard ${f2(b.Lmean)} vs ${f2(c.Lmean)}, poorest tenth ${f2(b.Lpoor)} vs ${f2(c.Lpoor)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: null,
				claim: 'A comparison, not a test: what the tower adds (beds, solar) against what it costs (the founding bill, the imports to keep it up, its energy).',
				evidence: `founding +€${f0(c.foundingM - b.foundingM)} M; imports ${pct(rel(c.importEur, b.importEur))} a year; electricity made ${pct(rel(c.energyPP, b.energyPP))}; mean living standard ${pct(rel(c.Lmean, b.Lmean))}`
			};
		}
	},

	AIX: {
		id: 'AIX',
		question: 'Does selling Aven service abroad repay the bank?',
		ruleChanged: 'Electricity is the village’s only export (base) vs the MaiaCity COOP also buying Aven service from avenCEO in MIND and selling it abroad for euros (changed): at a sourced market price for an accelerator-hour (€2), bounded by a small provider’s demand (1,024 accelerators at 55 % use), only while the bank is behind and while an accelerator-hour abroad earns more than its electricity and its accelerator cost in euros.',
		guesses: [
			{ text: 'AI exports earn the bank more euros a year than the line’s electricity does.', check: (rb, rc) => rc.values.aiEurY > rc.values.elecEurY },
			{ text: 'The bank gets its founding euros back within the 60 years.', check: (rb, rc) => rc.values.repayYear > 0 },
			{ text: 'People keep their Aven help: selling inference abroad does not take it from the village.', check: (rb, rc) => rc.values.helpLast >= 0.98 * rb.values.helpLast }
		],
		people: PAGE_PEOPLE,
		years: 60,
		base: { aiExport: false },
		changed: { aiExport: true },
		charts: ['mean living standard', 'energy a person and the capacity per person', 'person-days short'],
		metrics: [
			{ id: 'bootstrapM', label: 'bootstrap number: the lowest cumulative balance at the bank, € M', of: (w) => -Math.min(0, ...borderYears(w).map((y) => y.bank.lowestEur ?? 0)) / 1e6 },
			{ id: 'cumEndM', label: 'cumulative balance at the end (all exports less all imports since day 0), € M', of: (w) => (borderYears(w).at(-1)?.bank.cumulativeEur ?? NaN) / 1e6 },
			{ id: 'repayYear', label: 'first year the cumulative balance is back at zero (−1: not within the run)', of: (w) => borderYears(w).find((y) => y.year > 1 && y.bank.cumulativeEur >= 0)?.year ?? -1 },
			{ id: 'netLast10M', label: 'exports less imports, € M a year (mean of the last 10 years)', of: (w) => { const b = borderYears(w).slice(-10); return b.reduce((a, y) => a + y.exportEur - y.importEur, 0) / Math.max(1, b.length) / 1e6; } },
			{ id: 'aiEurY', label: 'AI exports, € a year (mean of the run)', of: (w) => { const b = borderYears(w); return b.reduce((a, y) => a + (y.exportEurAi ?? 0), 0) / Math.max(1, b.length); } },
			{ id: 'elecEurY', label: 'electricity exports, € a year (mean of the run)', of: (w) => { const b = borderYears(w); return b.reduce((a, y) => a + (y.exportEurElec ?? 0), 0) / Math.max(1, b.length); } },
			{ id: 'chipEurY', label: 'accelerators imported, € a year (mean of the run)', of: (w) => { const b = borderYears(w); return b.reduce((a, y) => a + (y.imports.accelerators?.eur ?? 0), 0) / Math.max(1, b.length); } },
			{ id: 'chipsEnd', label: 'accelerators in the data halls at the end', of: (w) => aiYears(w).at(-1)?.chips ?? NaN },
			{ id: 'helpLast', label: 'Aven help a person a day, h (last year)', of: (w) => aiYears(w).at(-1)?.all?.helpH ?? NaN },
			{ id: 'workLast', label: 'Aven work for the COOPs a person a day, h (last year)', of: (w) => aiYears(w).at(-1)?.all?.workH ?? NaN },
			{ id: 'shortPD', label: 'person-days short of a basic (after day 0)', of: (w) => shortPD(w) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest holdings decile, last year', of: (w) => meanOf(w, 'decH', ...lastYear(w), 0) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			const when = (v) => (v.repayYear > 0 ? `in year ${f0(v.repayYear)}` : v.netLast10M > 0 ? `not within the run’s 60 years (about ${f0(-v.cumEndM / v.netLast10M)} more years at the last decade’s pace)` : `never at the last decade’s pace (exports did not cover imports)`);
			return `Selling Aven service abroad earned €${f0(c.aiEurY / 1e3)}k a year; the bootstrap number went from €${f2(b.bootstrapM)} M to €${f2(c.bootstrapM)} M, and the bank is repaid ${when(c)} (electricity only: ${when(b)}).`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`Bootstrap number €${f2(b.bootstrapM)} M (electricity only) vs €${f2(c.bootstrapM)} M (with AI exports); cumulative balance at the end €${f2(b.cumEndM)} M vs €${f2(c.cumEndM)} M; ` +
				`exports less imports in the last 10 years €${f2(b.netLast10M)} M vs €${f2(c.netLast10M)} M a year; repaid in year ${b.repayYear > 0 ? f0(b.repayYear) : 'never in the run'} vs ${c.repayYear > 0 ? f0(c.repayYear) : 'never in the run'}. ` +
				`AI exports €${f0(c.aiEurY)} a year; electricity exports €${f0(b.elecEurY)} vs €${f0(c.elecEurY)}; accelerators imported €${f0(b.chipEurY)} vs €${f0(c.chipEurY)} a year; ${f0(b.chipsEnd)} vs ${f0(c.chipsEnd)} accelerators at the end. ` +
				`Aven help ${f2(b.helpLast)} vs ${f2(c.helpLast)} h a person a day, work ${f2(b.workLast)} vs ${f2(c.workLast)} h; person-days short ${f0(b.shortPD)} vs ${f0(c.shortPD)}; mean living standard ${f2(b.Lmean)} vs ${f2(c.Lmean)}, poorest tenth ${f2(b.Lpoor)} vs ${f2(c.Lpoor)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: null,
				claim: 'A comparison, not a test: what selling Aven service abroad does to the bank’s balance (the bootstrap number and the year the founding euros are back) and to the village’s own Aven service.',
				evidence: `bootstrap €${f2(b.bootstrapM)} M → €${f2(c.bootstrapM)} M; repaid ${b.repayYear > 0 ? `year ${f0(b.repayYear)}` : 'not in the run'} → ${c.repayYear > 0 ? `year ${f0(c.repayYear)}` : 'not in the run'}; AI exports €${f0(c.aiEurY)} a year; Aven help ${pct(rel(c.helpLast, b.helpLast))}`
			};
		}
	},

	SH: {
		id: 'SH',
		question: 'Through a drought, a dark winter, two failing COOPs and a failing well, does everyone keep the basics, and does every decile recover within two years?',
		ruleChanged: 'No shocks (base) vs five scheduled shocks (changed): a drought (rain −50 %, summer of year 2), a dark winter (sun −60 %, winter of year 3), two COOPs’ output to 10 % for a year (WEST, the West Tribe COOP selling beds, and GOODS-A, year 5), and the geothermal well down for 90 days (winter of year 6).',
		guesses: ['Nobody goes short in any shock; prices rise and fall back.', 'The dark winter and the failed well cut energy for R&D and extras first; the basics are served first.', 'Living standards dip in each shock and recover within two years.'],
		people: PAGE_PEOPLE,
		years: 9,
		base: { shocks: [] },
		changed: {
			shocks: [
				{ kind: 'drought', day: Y + 152, days: 92, factor: 0.5 },
				{ kind: 'darkWinter', day: 2 * Y + 334, days: 90, factor: 0.4 },
				{ kind: 'coopFail', coop: 'WEST', day: 4 * Y + 100, days: 365, factor: 0.1 },
				{ kind: 'coopFail', coop: 'GOODS-A', day: 4 * Y + 100, days: 365, factor: 0.1 },
				{ kind: 'wellFail', day: 5 * Y + 334, days: 90 }
			]
		},
		charts: ['lowest share of each basic met', 'decile living standards (trailing year)', 'energy: harvest and use by class'],
		metrics: [
			{ id: 'shortPD', label: 'person-days short of a basic (after day 0)', of: (w) => shortPD(w) },
			{ id: 'shortByLimit', label: 'short days by basic and binding limit', of: (w) => JSON.stringify(shortDaysByLimit(w)) },
			{ id: 'p3', label: 'P3 (deciles, with the shocks’ two-year recovery excused)', of: (w, p) => (p.P3.pass ? 1 : 0) },
			{ id: 'worstFall', label: 'largest fall of any decile (trailing year or season against season) outside the excused windows', of: (w, p) => Math.max(...p.P3.deciles.map((d) => d.fall ?? 0)) },
			{ id: 'Lmin', label: 'lowest living standard of anyone, any day', of: (w) => minOf(w, 'Lmin', 1) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'exits', label: 'receiverships', of: (w) => w.events.filter((e) => e.kind === 'receivership').length }
		],
		takeaway(rb, rc) {
			const c = rc.values;
			return `Through the five shocks ${c.shortPD > 0 ? `people were short on ${f0(c.shortPD)} person-days` : 'nobody went short of a basic'}, and ${c.p3 ? 'every tenth was back within two years' : 'not every tenth was back within two years'}.`;
		},
		numbers(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`Through the shocks, ${f0(c.shortPD)} person-days were short of a basic (${f0(b.shortPD)} without shocks). ` +
				`The largest fall of any decile outside the two-year recovery windows was ${pct(c.worstFall)} (${pct(b.worstFall)} without). ` +
				`The mean living standard ended at ${f2(c.Lmean)} vs ${f2(b.Lmean)}. There were ${c.exits} receiverships vs ${b.exits}.`
			);
		},
		pass(rb, rc) {
			const c = rc.values;
			return {
				pass: c.shortPD === 0 && c.p3 === 1,
				claim: 'Nobody is short in any shock, and every decile is back within two years (P3 holds with the shocks excused for two years).',
				evidence: `short ${f0(c.shortPD)} person-days (${c.shortByLimit}); P3 ${c.p3 ? 'holds' : 'fails'} (worst fall outside the windows ${pct(c.worstFall)}; failing: ${rc.prop3.P3.failed.join(', ') || 'none'})`
			};
		}
	}
};

/** the verdict with the run's numbers (each experiment's `numbers` sentences) added to its evidence */
const withNumbers = (v, more) => (more ? { ...v, evidence: `${String(v.evidence).replace(/[.\s]+$/, '')}. ${more}` } : v);

/** the basics' price over full cost and the sellers' share, over the whole run */
function markupAll(w) {
	const sum = { rev: [0, 0, 0, 0], full: [0, 0, 0, 0], vc: [0, 0, 0, 0] };
	for (const Yr of w.xt.years) for (let g = 0; g < 4; g++) (sum.rev[g] += Yr.rev[g]), (sum.full[g] += Yr.full[g]), (sum.vc[g] += Yr.vc[g]);
	return markupOf(sum);
}

// ── running ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Start an experiment: two worlds on the same seed. `opts`: seed, years, people, testMode, config (settings for both
 * worlds), frameEvery (days between onFrame calls), onDay(base, changed, day), onFrame(base, changed, day). Returns
 * a runner: `advance(days)` steps both worlds (returns true while days remain), `finish()` reads the result.
 */
export function startExperiment(exp, opts = {}) {
	if (typeof exp === 'string') exp = EXPERIMENTS[exp];
	const years = opts.years ?? exp.years;
	const seed = opts.seed ?? DEFAULTS.seed;
	const people = opts.people ?? exp.people ?? DEFAULTS.people;
	const extra = { seed, people, testMode: !!opts.testMode, ...(opts.config ?? {}) };
	const base = createWorld({ ...extra, ...exp.base, label: `${exp.id} base` });
	const changed = createWorld({ ...extra, ...exp.changed, label: `${exp.id} changed` });
	const days = Math.round(years * Y);
	const every = opts.frameEvery ?? 7;
	let day = 0;
	const t0 = Date.now();
	return {
		base,
		changed,
		days,
		get day() {
			return day;
		},
		advance(n = days) {
			const end = Math.min(days, day + n);
			for (; day < end; day++) {
				step(base);
				hooks(base);
				track(base);
				step(changed);
				hooks(changed);
				track(changed);
				if (opts.onDay) opts.onDay(base, changed, day);
				if (opts.onFrame && day % every === 0) opts.onFrame(base, changed, day);
			}
			return day < days;
		},
		finish() {
			const rb = measure(exp, base), rc = measure(exp, changed);
			const out = {
				id: exp.id,
				question: exp.question,
				ruleChanged: exp.ruleChanged,
				guesses: (exp.guesses ?? []).map(guessText),
				charts: exp.charts ?? [],
				years,
				people: { base: base.cfg.people, changed: changed.cfg.people },
				seed,
				metrics: exp.metrics.map((m) => ({ id: m.id, label: m.label, base: rb.values[m.id], changed: rc.values[m.id] })),
				base: rb,
				changed: rc,
				// one plain sentence; every other number goes with the evidence
				takeaway: exp.takeaway(rb, rc),
				verdict: withNumbers(exp.pass(rb, rc), exp.numbers?.(rb, rc)),
				ms: Date.now() - t0
			};
			// the worlds themselves are not part of the result (they are large); the page holds them in the runner
			delete rb.world;
			delete rc.world;
			return out;
		}
	};
}

/** run an experiment to the end (see startExperiment for the options) */
export function runExperiment(exp, opts = {}) {
	if (typeof exp === 'string') exp = EXPERIMENTS[exp];
	const r = startExperiment(exp, opts);
	r.advance();
	return r.finish();
}

function measure(exp, w) {
	const p = prop3(w);
	const values = {};
	// the run's full parameter set (settings and catalog, for the page's World tab) and its yearly tables (living
	// standards by tenth, the village's food and energy, the border's ledger, the founding bill)
	const res = { label: w.cfg.label, config: w.cfg, params: paramSet(w), living: livingYears(w), village: villageYears(w), border: borderYears(w), founding: foundingBill(w), food: foodLand(w), values, prop3: p, world: w };
	for (const m of exp.metrics) values[m.id] = m.of(w, p);
	return res;
}

// ── a world's summary (the proof suite's scenarios read it) ──────────────────────────────────────────────────────
/** everything the scenarios need from one world that has run, as plain data */
export function summarize(w) {
	const p = prop3(w);
	const rec = w.rec, n = rec.n, ly = lastYear(w);
	const xt = w.xt ?? { years: [], monthly: [], newcomerPD: 0, newcomerShortPD: 0, coopHearts: [] };
	const yearsArr = xt.years.map((Yr, y) => ({
		y: y + 1,
		issuedPP: Yr.issuedR / Yr.days / (Yr.N / Yr.days),
		meltPP: Yr.meltR / Yr.days / (Yr.N / Yr.days),
		yield: yieldOf(Yr),
		rent: Yr.landRent / Yr.days,
		rentR: Yr.rentR / Yr.days,
		N: Yr.N / Yr.days,
		...markupOf(Yr),
		Lmean: meanOf(w, 'Lmean', y * Y, (y + 1) * Y),
		Lceil: meanOf(w, 'Lceil', y * Y, (y + 1) * Y),
		poorA: meanOf(w, 'decA', y * Y, (y + 1) * Y, 0),
		poorH: meanOf(w, 'decH', y * Y, (y + 1) * Y, 0),
		ePP: meanOf(w, 'ePP', y * Y, (y + 1) * Y),
		surplusPP: meanOf(w, 'surplusPP', y * Y, (y + 1) * Y),
		short: shortPD(w, Math.max(1, y * Y), (y + 1) * Y),
		gini: (xt.monthly.filter((m) => m.day < (y + 1) * Y).pop() ?? {}).gini
	}));
	const own = ownership(w);
	return {
		label: w.cfg.label,
		seed: w.cfg.seed,
		// the border setting the world ran with (the base world's: ./genesis.js DEFAULTS with any --set)
		chipImport: w.cfg.chipImport !== false,
		days: n,
		N: w.N,
		N0: w.cfg.people,
		prop3: slimProp3(p),
		shortPD: shortPD(w),
		short0: rec.shortAny[0] / w.N,
		short1: n > 1 ? rec.shortAny[1] / w.N : NaN,
		shortBy: Object.fromEntries(BASICS.map((b) => [GOOD_IDS[b], rec.shortPD[b]])),
		shortByLimit: shortDaysByLimit(w),
		Lmean: meanOf(w, 'Lmean', ...ly),
		Lceil: meanOf(w, 'Lceil', ...ly),
		poorA: meanOf(w, 'decA', ...ly, 0),
		poorH: meanOf(w, 'decH', ...ly, 0),
		// the owner-only cohort's living standard: its first five years and its last year (B34)
		ownerL5: meanOf(w, 'ownerL', 1, Math.min(n, 5 * Y)),
		ownerLLast: meanOf(w, 'ownerL', ...ly),
		consLast: Object.fromEntries(CONSUMER.map((g) => [GOOD_IDS[g], meanOf(w, 'cons', ...ly, g)])),
		consRun: Object.fromEntries(CONSUMER.map((g) => [GOOD_IDS[g], meanOf(w, 'cons', 1, n, g)])),
		priceRun: Object.fromEntries(CONSUMER.map((g) => [GOOD_IDS[g], meanOf(w, 'pbar', 1, n, g)])),
		LmeanRun: meanOf(w, 'Lmean', 1, n),
		swing: Object.fromEntries(BASICS.map((g) => [GOOD_IDS[g], priceSwing(w, g)])),
		limitMinWater: minOf(w, 'limitMin', 1, n, WATER),
		own,
		gini: xt.monthly.length ? xt.monthly[xt.monthly.length - 1].gini : NaN,
		monthly: xt.monthly.map((m) => ({ day: m.day, gini: m.gini, people: m.people, mindPP: m.mindPP, N: m.N })),
		years: yearsArr,
		mindPP: mindCountPerPerson(w),
		meltIndex: w.meltIndex,
		learn: learnProgress(w),
		floorMargin: floorMargin(w),
		rdMwh: sumOf(w, 'rdKwh', 0) / 1000,
		// electricity exported across the border for accelerators (B23), MWh over the run
		exportMwh: (() => {
			let s = 0;
			for (let d = 0; d < rec.n; d++) s += (rec.exportPP?.[d] ?? 0) * (rec.N?.[d] ?? w.N);
			return s / 1000;
		})(),
		// accelerators the euro reserve bought over the run (B23)
		chipsIn: w.events.reduce((s, e) => s + (e.kind === 'chips' ? e.n : 0), 0),
		receiverships: w.events.filter((e) => e.kind === 'receivership').map((e) => ({ day: e.day, coop: e.coop, heir: e.heir, why: e.why })),
		founded: w.events.filter((e) => e.kind === 'found').length,
		newcomers: { pd: xt.newcomerPD, short: xt.newcomerShortPD, ...newcomerStrict(w, xt.newStrict) },
		rampShort: xt.rampShort ? { ...xt.rampShort, byYear: Array.from(xt.rampShort.byYear, (v) => v ?? 0) } : null,
		coopHearts: xt.coopHearts,
		ring: w.ring ? { share: w.ring.heartsAll ? w.ring.heartsIn / w.ring.heartsAll : NaN, people: w.ring.members.length / w.N, wealth0: w.ring.wealth0, wealth1: w.ring.wealth1 ?? NaN, died: w.coops[w.ring.k].died } : null,
		badges: Object.fromEntries(GOOD_IDS.map((id, g) => [id, topBadge(w, g)])),
		badgeShares: Object.fromEntries(GOOD_IDS.map((id, g) => [id, badgeShares(w, g)])),
		ledger: getLedger(w),
		owners: w.ownerIds.length,
		// the run's full parameter set, and its yearly tables: living standards by tenth, the village's food and energy,
		// the border's ledger and the founding bill (./records.js)
		params: paramSet(w),
		living: livingYears(w),
		village: villageYears(w),
		border: borderYears(w),
		// the building materials by year (made, bought finished, upkeep, built, the dome factory's lines) and what the
		// plan's dome factory made over the build-out (sandbox-7 buildout.js dfTotals, its parts in their own units)
		materials: materialYears(w),
		domeFactory: dfPlanTotals(w),
		founding: foundingBill(w),
		food: foodLand(w),
		indoorMonths: indoorMonthsOf(w),
		// the AI market by year: who owns the accelerators, inference, Aven hours and income by tenth (./records.js)
		ai: aiYears(w),
		// (round 6) P2 strict's bound by year, the bank's turning years, each basket's LVR against its fees
		r6: r6Summary(w)
	};
}

/** the plan's dome factory over the build-out, slimmed (no months): null when the design has none */
function dfPlanTotals(w) {
	const T = w.ramp?.plan?.totals?.domeFactory;
	if (!T) return null;
	const { label, stands, runsFrom, made, used, bought, leftover, leftoverEur, importsEur, boughtEur, imports, boughtFinished, savedParts, hours, kwh, eurPower, eurUpkeep, peak, months, domes, domesFromDF, domesPartly } = T;
	return { label, stands, runsFrom, made, used, bought, leftover, leftoverEur, importsEur, boughtEur, imports, boughtFinished, savedParts, hours, kwh, eurPower, eurUpkeep, peak, months, domes, domesFromDF, domesPartly };
}

/**
 * The owner-only newcomers' strict test (cfg.newcomers): from how many days after joining their dividends alone paid
 * the basic bundle every day to the end (−1: never), and the lowest ratio in each year after they joined.
 */
function newcomerStrict(w, r) {
	if (!r?.length) return {};
	let from = -1;
	if (r[r.length - 1] >= 1) {
		from = r.length - 1;
		while (from > 0 && r[from - 1] >= 1) from--;
	}
	const byYear = [];
	for (let y = 0; y * Y < r.length; y++) byYear.push(Math.min(...r.slice(y * Y, (y + 1) * Y)));
	return { joined: w.cfg.newcomers.day, n: w.newIds.length, strictFrom: from, ratioByYear: byYear };
}

const slimDecile = (d) => ({ by: d.by, decile: d.decile, pass: d.pass, first: d.first, last: d.last, ceiling: d.ceiling, rises: d.rises, nearCeiling: d.nearCeiling, fall: d.fall, trailingFall: d.worstDrawdown?.fall, seasonalFall: d.seasonalFall?.fall ?? d.seasonalFall, windowsFailed: d.windowsFailed, fallFrom: d.worstDrawdown?.peakDay, fallTo: d.worstDrawdown?.day, net: d.worstNet?.change });
/** Proposition 3's result without the long per-day lists (small enough to send between threads and write as JSON) */
export function slimProp3(p) {
	return {
		pass: p.pass,
		days: p.days,
		// (round 6) the claim's span: Proposition 3 is judged from the end of the founding; the founding's own numbers
		// sit beside each verdict
		founding: p.founding,
		P1: p.P1,
		P2: { pass: p.P2.pass, cohort: p.P2.cohort, strict: { ...p.P2.strict, lowestRatioByYear: undefined, medianRatioByYear: undefined, lowestLastYear: p.P2.strict.lowestRatioByYear?.at(-1) ?? null }, normal: { pass: p.P2.normal.pass, failures: p.P2.normal.failures, failuresInFounding: p.P2.normal.failuresInFounding, failuresAll: p.P2.normal.failuresAll, firstFailures: p.P2.normal.firstFailures, lowestShareMet: p.P2.normal.lowestShareMet, holdingTrendDaysPerYear: p.P2.normal.holdingTrendDaysPerYear, lowestHoldingDaysByYear: p.P2.normal.lowestHoldingDaysByYear } },
		P3: {
			pass: p.P3.pass,
			failed: p.P3.failed,
			founding: p.P3.founding ? { pass: p.P3.founding.pass, failedTenths: p.P3.founding.failedTenths, failures: p.P3.founding.failures, years: p.P3.founding.years } : null,
			// the verdict's own test: real units per tenth (./prop3.js realUnits), and the old money index beside it
			real: p.P3.real ? { pass: p.P3.real.pass, rule: p.P3.real.rule, newcomers: p.P3.real.newcomers, years: p.P3.real.years, failedTenths: p.P3.real.failedTenths, basicsFail: p.P3.real.basicsFail, failures: p.P3.real.failures, excused: p.P3.real.excused.length, excusedList: p.P3.real.excused.slice(0, 40), riseFail: p.P3.real.riseFail, tenths: p.P3.real.tenths.map((t) => ({ by: t.by, tenth: t.tenth, pass: t.pass, basics: t.basics, extras: t.extras, rise: t.rise, first: t.first, last: t.last, change: t.change, up: t.up, down: t.down })) } : null,
			oldIndex: p.P3.oldIndex,
			netPass: p.P3.netPass,
			deciles: p.P3.deciles.map(slimDecile),
			withoutCompute: { pass: p.P3.withoutCompute.pass, failed: p.P3.withoutCompute.failed, deciles: p.P3.withoutCompute.deciles.map(slimDecile) },
			computeShare: p.P3.share,
			coops: { pass: p.P3.coops.pass, alive: p.P3.coops.alive, founded: p.P3.coops.founded, receiverships: p.P3.coops.receiverships.length, shortAround: p.P3.coops.receiverships.reduce((a, r) => a + r.basicShortPersonDaysAround, 0), insolvent: p.P3.coops.insolventNow.length, coopDaysUnableToPay30: p.P3.coops.coopDaysUnableToPay30, coopDaysUnableToPay30All: p.P3.coops.coopDaysUnableToPay30All, receivershipsInFounding: p.P3.coops.receivershipsInFounding, unpaidR: p.P3.coops.unpaidR, unpaidShare: p.P3.coops.unpaidShare }
		},
		abundance: p.abundance
	};
}
