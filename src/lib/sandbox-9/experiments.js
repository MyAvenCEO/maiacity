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
import { createWorld, step, DEFAULTS, getLedger } from './engine.js';
import { prop3 } from './prop3.js';
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
	const N0 = w.cfg.people;
	for (let i = N0; i < w.N; i++)
		if (d - w.born[i] < 3 * Y) {
			x.newcomerPD++;
			if (w.met[i] < 0.98) x.newcomerShortPD++;
		}
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
/** the page's field: 100 people (5 of them owner-only) on a hex sized for them */
const PAGE_PEOPLE = 100;
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
			'With 20 %, the owner-only blobs’ dividends keep paying their basic bundle through the drought. With 0 %, they get no dividends at all.',
			'Water gets dearer in both worlds. Nobody goes short in either, because each person’s HEARTS half pays the basic bundle many times over.',
			'With 0 %, the sellers keep the fifth of every sale. So they build more, and water stays cheaper.'
		],
		people: PAGE_PEOPLE,
		years: 5,
		base: { law5: 0.2, shocks: [DROUGHT] },
		changed: { law5: 0, shocks: [DROUGHT] },
		charts: ['water price and the poorest limit bar', 'owner-only dividends ÷ basic bundle', 'person-days short'],
		metrics: [
			{ id: 'shortPD', label: 'person-days short of a basic (after day 0)', of: (w) => shortPD(w) },
			{ id: 'shortInDrought', label: 'person-days short in the drought and 90 days after', of: (w) => shortPD(w, inDrought[0], inDrought[1] + 90) },
			{ id: 'waterPeak', label: 'water price at its drought peak ÷ the 90 days before', of: (w) => maxOf(w, 'pbar', inDrought[0], inDrought[1] + 90, WATER) / meanOf(w, 'pbar', inDrought[0] - 90, inDrought[0], WATER) },
			{ id: 'poorWaterBar', label: 'lowest limit bar ÷ water price in the drought (anyone)', of: (w) => minOf(w, 'limitMin', inDrought[0], inDrought[1] + 90, WATER) },
			{ id: 'strictInDrought', label: 'owner-only: lowest dividends ÷ basic bundle in the drought', of: (w) => minOf(w, 'strict', inDrought[0], inDrought[1] + 90) },
			{ id: 'ownerShort', label: 'owner-only person-days short (after day 0)', of: (w) => sumOf(w, 'ownerShort', 1) },
			{ id: 'poorL', label: 'poorest Aven decile, living standard in the drought', of: (w) => meanOf(w, 'decA', inDrought[0], inDrought[1], 0) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`In the drought, water cost ${f2(b.waterPeak)}× its earlier price with Law 5 and ${f2(c.waterPeak)}× without. ` +
				`The lowest limit bar stood at ${f2(b.poorWaterBar)}× the water price with Law 5 and ${f2(c.poorWaterBar)}× without. ` +
				`Owner-only dividends paid ${f2(b.strictInDrought)}× their basic bundle at worst with Law 5, and ${f2(c.strictInDrought)}× without. ` +
				`Person-days short: ${b.shortPD} with Law 5, ${c.shortPD} without.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.shortPD === 0 && b.poorWaterBar > 1 && b.strictInDrought >= 1,
				claim: 'With Law 5 at 20 %, nobody is short, the poorest limit bar stays above the water price, and dividends alone pay the owner-only cohort’s basics through the drought.',
				evidence: `20 %: short ${b.shortPD} person-days, lowest bar ${f2(b.poorWaterBar)}× the price, owner-only dividends ≥ ${f2(b.strictInDrought)}× the bundle. 0 %: short ${c.shortPD}, bar ${f2(c.poorWaterBar)}×, dividends ${f2(c.strictInDrought)}×.`
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
			return (
				(c.ownerShort > 0 ? `On dividends only, the owner-only blobs were short ${c.ownerShort} person-days, the last on day ${c.lastShortDay}. ` : `On dividends only, the owner-only blobs were never short of a basic. `) +
				`Spending some of what they hold as well, they were short ${b.ownerShort} person-days. ` +
				`Dividends alone paid every member’s bundle every day from day ${b.strictFrom}. ` +
				`Their living standard in the last year: ${f2(c.ownerL)} on dividends only, ${f2(b.ownerL)} normally.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.ownerShort === 0 && c.ownerShortAfter120 === 0 && b.strictFrom > 0 && b.strictFrom <= 120,
				claim: 'Normal: never short from day 1. Strict: dividends alone pay the basic bundle by day 120, and the dividends-only cohort is never short after it.',
				evidence: `normal short ${b.ownerShort}; dividends-only short ${c.ownerShort} (after day 120: ${c.ownerShortAfter120}, last day ${c.lastShortDay}); strict test from day ${b.strictFrom}`
			};
		}
	},

	X3: {
		id: 'X3',
		question: 'Where does the MIND end up?',
		ruleChanged: 'Treasuries pay their surplus above the 270-day reserve out for Aven work proposals (base) vs keep it (changed).',
		guesses: ['With payout, people hold most of all MIND (the paper: 94 %). Without it, the treasuries hold most (the paper: 30 % for people).', 'Law 5 still pays people a fifth of every sale, so the gap is small.', 'Without payout, the owner-only cohort gets smaller dividends, because people own less.'],
		people: PAGE_PEOPLE,
		years: 8,
		base: { payout: true },
		changed: { payout: false },
		charts: ['who holds the MIND: people, treasuries, pools', 'owner-only dividends ÷ basic bundle', 'decile living standards'],
		metrics: [
			{ id: 'peopleShare', label: 'people’s share of all MIND (R), end', of: (w) => ownership(w).people },
			{ id: 'treShare', label: 'treasuries’ share of all MIND, end', of: (w) => ownership(w).treasuries },
			{ id: 'poolShare', label: 'pools’ share of all MIND, end', of: (w) => ownership(w).pools },
			{ id: 'strictMed', label: 'owner-only median dividends ÷ basic bundle, last year', of: (w) => meanOf(w, 'strictMed', ...lastYear(w)) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest holdings decile, last year', of: (w) => meanOf(w, 'decH', ...lastYear(w), 0) },
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) },
			{ id: 'p3', label: 'Proposition 3 holds (1 = yes)', of: (w, p) => (p.pass ? 1 : 0) }
		],
		takeaway(rb, rc) {
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
		guesses: ['With the melt, the Gini falls from about 0.7 to below 0.5 within seven years. Without it, it barely moves.', 'Without the melt, the equal HEARTS still dilute the old fortunes, only more slowly.'],
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
		guesses: ['With one food COOP, people go short until the plants find a new COOP. With two, the other seller covers.', 'The other seller is too small to cover a whole forest, so both worlds go short for a while.', 'The audit sends the failing COOP into receivership within two months; its plants go on making food.'],
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
		guesses: ['Following delivered output, the Avens send the ring almost nothing. Following the pool price, the ring draws a few percent of all HEARTS (the paper: 3.8 % vs 1.6 %).', 'The ring’s COOP never builds a plant, so receivership closes it within a year either way.'],
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
		guesses: ['With one seller, basics sell well above full cost and the COOP keeps the surplus. With two, the price falls toward cost and buyers keep it.', 'Law 3 founds a second seller where one is dear, so the gap closes within a few years.'],
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
		guesses: ['The forward margin reads need and the harvest ahead, so nobody goes short. Primer’s price lags behind the seasons.', 'Primer’s price swings more from day to day.'],
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
		ruleChanged: '24 (base) vs 48 (changed) HEARTS a day for every person.',
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
				claim: 'Doubling HEARTS changes only prices: real consumption of every good, and the mean living standard, within ±1 %.',
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
		charts: ['energy a person next to each decile’s living standard', 'where the energy goes', 'innovation: share of the way to the physical floors'],
		metrics: [
			{ id: 'ePP', label: 'electricity used a person a day (kWh), last year', of: (w) => meanOf(w, 'ePP', ...lastYear(w)) },
			{ id: 'surplusPP', label: 'surplus energy a person a day (kWh), last year', of: (w) => meanOf(w, 'surplusPP', ...lastYear(w)) },
			{ id: 'rdMwh', label: 'R&D energy, all years (MWh)', of: (w) => sumOf(w, 'rdKwh', 0) / 1000 },
			{ id: 'learn', label: 'innovation: share of the way to the physical floors', of: (w) => learnProgress(w) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest Aven decile, last year', of: (w) => meanOf(w, 'decA', ...lastYear(w), 0) },
			{ id: 'Lpoor2', label: 'poorest Aven decile, year 2', of: (w) => meanOf(w, 'decA', Y, 2 * Y, 0) },
			{ id: 'Lceil', label: 'physics ceiling of the living standard, last year', of: (w) => meanOf(w, 'Lceil', ...lastYear(w)) },
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With geothermal and R&D, a person used ${f2(b.ePP)} kWh a day, and ${f2(b.surplusPP)} kWh of surplus fed innovation (${pct(b.learn)} of the way to the floors). ` +
				`Without, ${f2(c.ePP)} kWh and ${pct(c.learn)}. ` +
				`The poorest decile went from ${f2(b.Lpoor2)} to ${f2(b.Lpoor)} with surplus energy, and from ${f2(c.Lpoor2)} to ${f2(c.Lpoor)} without. ` +
				`Person-days short: ${f0(b.shortPD)} vs ${f0(c.shortPD)}.`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.Lmean > c.Lmean && b.Lpoor > c.Lpoor && b.learn > c.learn,
				claim: 'Living standards (mean and poorest decile) end higher with surplus energy and R&D than without, and innovation advances only with it.',
				evidence: `mean ${f2(b.Lmean)} vs ${f2(c.Lmean)}; poorest decile ${f2(b.Lpoor)} vs ${f2(c.Lpoor)}; innovation ${pct(b.learn)} vs ${pct(c.learn)}`
			};
		}
	},

	X11: {
		id: 'X11',
		question: 'What stops a small village first?',
		ruleChanged: '250 blobs (base) vs 100 blobs (changed) on the same hex, built for 250, with dome solar and no geothermal stage yet (world model 5.5).',
		guesses: ['With 250, energy binds first (winter), then wood for building; water binds only in a dry year.', 'With 100, the same hex is roomy: fewer limits bind, and nobody is short.', 'MIND never binds a basic in either world.'],
		people: 250,
		years: 6,
		base: { people: 250, fieldPeople: 250, geothermal: false },
		changed: { people: 100, fieldPeople: 250, geothermal: false },
		charts: ['binding-limit badge of each good', 'energy a person and the physics ceiling', 'person-days short'],
		metrics: [
			{ id: 'shortPD', label: 'person-days short of a basic', of: (w) => shortPD(w) },
			{ id: 'shortPP', label: 'days short a person (person-days ÷ people)', of: (w) => shortPD(w) / w.N },
			{ id: 'mindBinds', label: 'days MIND bound a basic while physics allowed need', of: (w, p) => p.abundance.mindBindsBasics },
			{ id: 'energyBadge', label: 'share of days energy’s badge read “energy”', of: (w) => badgeShare(w, ENERGY, LIMIT.energy) },
			{ id: 'energyShortDays', label: 'days someone was short of energy', of: (w) => { let n = 0; for (let d = 1; d < w.rec.n; d++) if (w.rec.shortN[d * 4 + ENERGY] > 0) n++; return n; } },
			{ id: 'waterShortDays', label: 'days someone was short of water', of: (w) => { let n = 0; for (let d = 1; d < w.rec.n; d++) if (w.rec.shortN[d * 4 + WATER] > 0) n++; return n; } },
			{ id: 'woodTop', label: 'wood’s most frequent binding limit', of: (w) => topBadge(w, 4).limit },
			{ id: 'bedTop', label: 'beds’ most frequent binding limit', of: (w) => topBadge(w, BED).limit },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) }
		],
		takeaway(rb, rc) {
			const b = rb.values, c = rc.values;
			return (
				`With 250 blobs, someone was short of energy on ${b.energyShortDays} days and of water on ${b.waterShortDays}. With 100, on ${c.energyShortDays} and ${c.waterShortDays} days. ` +
				`MIND bound a basic on ${b.mindBinds} days with 250 and ${c.mindBinds} with 100. ` +
				`Wood was bound by ${b.woodTop} (250) and ${c.woodTop} (100).`
			);
		},
		pass(rb, rc) {
			const b = rb.values, c = rc.values;
			return {
				pass: b.mindBinds === 0 && c.mindBinds === 0 && c.shortPP <= b.shortPP,
				claim: 'Physics, not money, sets the limit: MIND never binds a basic while physics allows need, and fewer people on the same hex are short less.',
				evidence: `MIND-bound basic days ${b.mindBinds} (250) and ${c.mindBinds} (100); days short a person ${f2(b.shortPP)} vs ${f2(c.shortPP)}; short days by limit (250): ${JSON.stringify(shortDaysByLimit(rb.world ?? { rec: { n: 0 } }))}`
			};
		}
	},

	X12: {
		id: 'X12',
		question: 'Do newcomers eat?',
		ruleChanged: 'A constant population (base) vs +2 % a year (changed), on the same fixed land. Newcomers arrive with an Aven and nothing held.',
		guesses: ['Ground rent rises as land fills up. Newcomers are never short: their first HEARTS pay the basic bundle on day 1.', 'Living standards a person grow more slowly with growth, because capital must be built for the newcomers.'],
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
		guesses: ['With private land the holdings Gini rises toward 0.5; with City land it stays near 0.3.', 'Private landowners live better, renters are not short.'],
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
		ruleChanged: 'The bootstrap of §11.4 on (base: each Aven’s first HEARTS go to the basics COOPs it buys from, and pools fill on day 0) vs off (changed: first HEARTS into three COOPs of the Aven’s taste).',
		guesses: ['Without the bootstrap, most people go short on day 1, because they hold no MIND the sellers take and the pools are empty (the paper: 94 %).', 'With it, nobody is short from day 1.'],
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
		charts: ['spring hours a person', 'spring price', 'decile living standards and the physics ceiling'],
		metrics: [
			{ id: 'spring', label: 'spring hours a person a day, last year', of: (w) => meanOf(w, 'cons', ...lastYear(w), SPRING) },
			{ id: 'springPrice', label: 'spring price (R an hour), last year', of: (w) => meanOf(w, 'pbar', ...lastYear(w), SPRING) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'Lceil', label: 'physics ceiling of the living standard, last year', of: (w) => meanOf(w, 'Lceil', ...lastYear(w)) },
			{ id: 'Lpoor', label: 'poorest Aven decile, last year', of: (w) => meanOf(w, 'decA', ...lastYear(w), 0) },
			{ id: 'badge', label: 'share of days the spring’s badge read “nature”', of: (w) => badgeShare(w, SPRING, LIMIT.nature) }
		],
		takeaway(rb, rc) {
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
				evidence: `spring ${f2(b.spring)} → ${f2(c.spring)} h a person a day (badge “nature” on ${pct(b.badge)} of base days), mean ${f2(b.Lmean)} → ${f2(c.Lmean)}, poorest decile ${f2(b.Lpoor)} → ${f2(c.Lpoor)}; physics ceiling ${f2(b.Lceil)} → ${f2(c.Lceil)}`
			};
		}
	},

	SH: {
		id: 'SH',
		question: 'Through a drought, a dark winter, two failing COOPs and a failing well, does everyone keep the basics, and does every decile recover within two years?',
		ruleChanged: 'No shocks (base) vs five scheduled shocks (changed): a drought (rain −50 %, summer of year 2), a dark winter (sun −60 %, winter of year 3), two COOPs’ output to 10 % for a year (HOME-B, a bed COOP, and GOODS-A, year 5), and the geothermal well down for 90 days (winter of year 6).',
		guesses: ['Nobody goes short in any shock; prices rise and fall back.', 'The dark winter and the failed well cut energy for R&D and extras first; the basics are served first.', 'Living standards dip in each shock and recover within two years.'],
		people: PAGE_PEOPLE,
		years: 9,
		base: { shocks: [] },
		changed: {
			shocks: [
				{ kind: 'drought', day: Y + 152, days: 92, factor: 0.5 },
				{ kind: 'darkWinter', day: 2 * Y + 334, days: 90, factor: 0.4 },
				{ kind: 'coopFail', coop: 'HOME-B', day: 4 * Y + 100, days: 365, factor: 0.1 },
				{ kind: 'coopFail', coop: 'GOODS-A', day: 4 * Y + 100, days: 365, factor: 0.1 },
				{ kind: 'wellFail', day: 5 * Y + 334, days: 90 }
			]
		},
		charts: ['lowest share of each basic met', 'decile living standards (trailing year)', 'energy: harvest and use by class'],
		metrics: [
			{ id: 'shortPD', label: 'person-days short of a basic (after day 0)', of: (w) => shortPD(w) },
			{ id: 'shortByLimit', label: 'short days by basic and binding limit', of: (w) => JSON.stringify(shortDaysByLimit(w)) },
			{ id: 'p3', label: 'P3 (deciles, with the shocks’ two-year recovery excused)', of: (w, p) => (p.P3.pass ? 1 : 0) },
			{ id: 'worstFall', label: 'largest fall of any decile (trailing year) outside the excused windows', of: (w, p) => Math.max(...p.P3.deciles.map((d) => d.worstDrawdown?.fall ?? 0)) },
			{ id: 'Lmin', label: 'lowest living standard of anyone, any day', of: (w) => minOf(w, 'Lmin', 1) },
			{ id: 'Lmean', label: 'mean living standard, last year', of: (w) => meanOf(w, 'Lmean', ...lastYear(w)) },
			{ id: 'exits', label: 'receiverships', of: (w) => w.events.filter((e) => e.kind === 'receivership').length }
		],
		takeaway(rb, rc) {
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
				guesses: exp.guesses,
				charts: exp.charts ?? [],
				years,
				people: { base: base.cfg.people, changed: changed.cfg.people },
				seed,
				metrics: exp.metrics.map((m) => ({ id: m.id, label: m.label, base: rb.values[m.id], changed: rc.values[m.id] })),
				base: rb,
				changed: rc,
				takeaway: exp.takeaway(rb, rc),
				verdict: exp.pass(rb, rc),
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
	const res = { label: w.cfg.label, config: w.cfg, values, prop3: p, world: w };
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
		receiverships: w.events.filter((e) => e.kind === 'receivership').map((e) => ({ day: e.day, coop: e.coop, heir: e.heir, why: e.why })),
		founded: w.events.filter((e) => e.kind === 'found').length,
		newcomers: { pd: xt.newcomerPD, short: xt.newcomerShortPD },
		coopHearts: xt.coopHearts,
		ring: w.ring ? { share: w.ring.heartsAll ? w.ring.heartsIn / w.ring.heartsAll : NaN, people: w.ring.members.length / w.N, wealth0: w.ring.wealth0, wealth1: w.ring.wealth1 ?? NaN, died: w.coops[w.ring.k].died } : null,
		badges: Object.fromEntries(GOOD_IDS.map((id, g) => [id, topBadge(w, g)])),
		badgeShares: Object.fromEntries(GOOD_IDS.map((id, g) => [id, badgeShares(w, g)])),
		ledger: getLedger(w),
		owners: w.ownerIds.length
	};
}

/** Proposition 3's result without the long per-day lists (small enough to send between threads and write as JSON) */
export function slimProp3(p) {
	return {
		pass: p.pass,
		days: p.days,
		P1: p.P1,
		P2: { pass: p.P2.pass, cohort: p.P2.cohort, strict: { ...p.P2.strict, lowestRatioByYear: undefined, medianRatioByYear: undefined }, normal: { pass: p.P2.normal.pass, failures: p.P2.normal.failures, firstFailures: p.P2.normal.firstFailures, lowestShareMet: p.P2.normal.lowestShareMet, holdingTrendDaysPerYear: p.P2.normal.holdingTrendDaysPerYear, lowestHoldingDaysByYear: p.P2.normal.lowestHoldingDaysByYear } },
		P3: { pass: p.P3.pass, failed: p.P3.failed, netPass: p.P3.netPass, deciles: p.P3.deciles.map((d) => ({ by: d.by, decile: d.decile, pass: d.pass, first: d.first, last: d.last, ceiling: d.ceiling, rises: d.rises, nearCeiling: d.nearCeiling, fall: d.worstDrawdown?.fall, fallFrom: d.worstDrawdown?.peakDay, fallTo: d.worstDrawdown?.day, net: d.worstNet?.change })), coops: { pass: p.P3.coops.pass, alive: p.P3.coops.alive, founded: p.P3.coops.founded, receiverships: p.P3.coops.receiverships.length, shortAround: p.P3.coops.receiverships.reduce((a, r) => a + r.basicShortPersonDaysAround, 0), insolvent: p.P3.coops.insolventNow.length } },
		abundance: p.abundance
	};
}
