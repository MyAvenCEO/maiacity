#!/usr/bin/env node
// @ts-nocheck — plain JS, no dependencies
/**
 * theOS end to end: a small agent-based simulation of the whole economy of the paper (v6), built to test whether its
 * macro thesis and its MIND concept hold when people actually live under the rules.
 *
 * Fixed rules (the author's): only HEARTS and MINDs; 24 personal HEARTS a person a day, invest-only; 1 HEART → 1 MIND
 * of that COOP, half to the investor, half to the COOP's treasury; COOPs never hold HEARTS; treasuries hold own and
 * other MINDs as working capital; 10 % of treasury MIND flows into protocol-owned, never-withdrawable, equal-weight G3M
 * baskets of 4–8 MINDs with a 0.3 % fee kept in the pool, and all MIND↔MIND trades go through them; a COOP bootstraps
 * from HEARTS plus ≥ 3 basket partners; HEARTS and MINDs melt at 7 %/yr; all land belongs to the City COOP (one equal
 * share per citizen), which also runs what citizens share (here: water, streets, parks), is never sold and is leased
 * for ground rent paid in MIND to the City COOP; a failed COOP's physical assets go to the City COOP, which leases them
 * to another COOP; when a COOP sells, it receives only its own MIND and the pools route the buyer's MIND to it; Avens
 * invest, trade and pay for people.
 *
 * Switches compared: how using a MIND works ((a) holding it is a quota of the COOP's output / (b) spent MIND goes to
 * the seller's treasury / (c) spent MIND is burned / (d) spent MIND goes to the seller's treasury, but a treasury keeps
 * at most 60 days of running costs in its own MIND and the protocol retires the rest), the base of the 10 % rule
 * (inflow / stock), whether the City pays its surplus out, the working-capital target, and the Avens' investment rule
 * (price / delivered output). Behaviour the paper leaves open is set here: COOPs price between variable cost and twice
 * full cost and ration when sold out (inputs first, then households and new capacity), wages are 2 R an hour (the
 * nominal anchor), Avens keep about a week of spending in the MINDs they pay with.
 *
 * Run:   node scripts/theos-e2e-sim.mjs              all tables (markdown) on stdout, about a minute
 *        node scripts/theos-e2e-sim.mjs --quick      fewer people, shorter runs (smoke test)
 *        node scripts/theos-e2e-sim.mjs --csv FILE   also write yearly series of every run to FILE
 *        node scripts/theos-e2e-sim.mjs --debug d 60 [--empty 0.25 | --grow]   one run, a line a year
 */
import { writeFileSync } from 'node:fs';

const ARGS = process.argv.slice(2);
const QUICK = ARGS.includes('--quick');
const CSV = ARGS.includes('--csv') ? ARGS[ARGS.indexOf('--csv') + 1] : null;
const T0 = Date.now();

// ── protocol constants ───────────────────────────────────────────────────────────────────────────────────────────────
const RATE = 0.07; // demurrage on HEARTS and MINDs, a year
const HEARTS_DAY = 24;
const U = HEARTS_DAY * 365; // 8,760 HEARTS a person a year
const POOL_SHARE = 0.1; // the liquidity rule: a tenth of the treasury half of each HEART (5 % of the HEART) goes to the pools
const FEE = 0.003;
const GAM = 1 - FEE;
const W_STAR = U / 2 / RATE; // the paper's resting MIND holding of a person, 62,571
const M_STAR = U / RATE; // the paper's steady state of all money a person, 125,143

// ── goods, in real units ─────────────────────────────────────────────────────────────────────────────────────────────
const FOOD = 0, ENERGY = 1, HOUSING = 2, WATER = 3, GOODS = 4, CARE = 5, PANELS = 6, MAT = 7, NPROD = 8;
const PNAME = ['food', 'energy', 'housing', 'water', 'goods', 'care', 'panels', 'materials'];
const PUNIT = ['kcal', 'kWh', 'm²', 'L', 'kg', 'h', 'kWp', 'kg'];
const NHH = 6; // what households buy: products 0..5
const BASIC = [2000, 3, 20, 100, 0, 0]; // basic needs a person a day (shortfall below 98 % of these)
const SAT = [2800, 12, 50, 250, 6, 4]; // satiation: basics saturate, goods and care only far up
const BETA = [0.14, 0.14, 0.3, 0.04, 0.22, 0.16]; // Stone–Geary marginal budget shares above the basics
const WAGE_R = 2; // R an hour of operating work, the default nominal anchor (costs, and so prices, are quoted in R)
const PRICE_CAP = 2; // COOPs price between variable cost and twice full cost, and ration when sold out
const BUILT_SHARE = 0.2; // land the City keeps for streets and parks

// ── COOPs: production functions (per unit of output, per unit of capacity) ───────────────────────────────────────────
const CITY = 0, SOLAR = 1, PANEL = 2, AGRI = 3, GREEN = 4, HABITAT = 5, BUILD = 6, GOODSC = 7, CAREC = 8, JUNK = 9, GEO = 10, AGRIB = 11;
const M = 12;
const SPECS = [
	// the City COOP: owns all land (leases it), runs water, streets and parks; inputs per litre, plus a fixed upkeep a citizen
	{ id: 'CITY', product: WATER, inputs: [[ENERGY, 0.0006], [MAT, 0.00002]], capital: [[MAT, 2], [ENERGY, 2]], dep: 0.02, land: 0.02, work: 0.00001, gMax: 0.5, upkeep: [[ENERGY, 0.3], [MAT, 0.3]], upkeepWork: 0.05 },
	{ id: 'SOLAR', product: ENERGY, inputs: [[MAT, 0.002]], capital: [[PANELS, 0.365], [MAT, 15]], dep: 0.04, land: 2.2, work: 0.0005, gMax: 0.5 },
	{ id: 'PANEL', product: PANELS, inputs: [[ENERGY, 1200], [MAT, 70]], capital: [[MAT, 20000], [ENERGY, 10000]], dep: 0.05, land: 500, work: 3, gMax: 0.5 },
	{ id: 'AGRI', product: FOOD, inputs: [[ENERGY, 0.0004], [MAT, 0.00002]], capital: [[MAT, 0.5]], dep: 0.05, land: 0.28, work: 0.00005, gMax: 0.5 },
	{ id: 'GREEN', product: FOOD, inputs: [[ENERGY, 0.003], [MAT, 0.0001]], capital: [[MAT, 3], [ENERGY, 2]], dep: 0.04, land: 0.033, work: 0.00002, gMax: 0.5 },
	{ id: 'HABITAT', product: HOUSING, inputs: [[ENERGY, 0.05], [MAT, 0.01]], capital: [[MAT, 500], [ENERGY, 100]], dep: 0.0125, land: 0.67, work: 0.002, gMax: 0.3 },
	{ id: 'BUILD', product: MAT, inputs: [[ENERGY, 0.3]], capital: [[MAT, 20], [ENERGY, 50]], dep: 0.05, land: 2, work: 0.005, gMax: 0.5 },
	{ id: 'GOODS', product: GOODS, inputs: [[ENERGY, 5], [MAT, 1.2]], capital: [[MAT, 300], [ENERGY, 500]], dep: 0.07, land: 2, work: 0.3, gMax: 0.5 },
	{ id: 'CARE', product: CARE, inputs: [[ENERGY, 0.2], [MAT, 0.05]], capital: [[MAT, 100]], dep: 0.05, land: 3, work: 1, gMax: 0.5 },
	// branch-only COOPs
	{ id: 'JUNK', product: -1, inputs: [], capital: [], dep: 0, land: 0, work: 0, gMax: 0 },
	{ id: 'GEO', product: ENERGY, inputs: [[MAT, 0.0003]], capital: [[MAT, 150], [ENERGY, 600]], dep: 0.0125, land: 0.5, work: 0.0002, gMax: 0.5, lumpy: true },
	{ id: 'AGRI-B', product: FOOD, inputs: [[ENERGY, 0.0004], [MAT, 0.00002]], capital: [[MAT, 0.5]], dep: 0.05, land: 0.28, work: 0.00005, gMax: 0.5 }
];
const NAMES = SPECS.map((s) => s.id);
const BASE_COOPS = 9;
const REF = [SOLAR, HABITAT, CITY]; // the reference unit R: geometric mean of these three MIND prices
// equal-weight baskets the COOPs chose (each member has ≥ 3 partners; the graph is connected)
const BASKETS = [
	[SOLAR, AGRI, CITY, HABITAT],
	[PANEL, BUILD, SOLAR, GOODSC],
	[AGRI, GREEN, CAREC, CITY],
	[HABITAT, BUILD, CITY, GREEN, GOODSC, CAREC]
];

// ── seeded randomness ────────────────────────────────────────────────────────────────────────────────────────────────
function rnd(S) {
	S.rs = (S.rs + 0x6d2b79f5) >>> 0;
	let t = S.rs;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = (S) => Math.sqrt(-2 * Math.log(rnd(S) || 1e-12)) * Math.cos(2 * Math.PI * rnd(S));

function gini(v, n) {
	const a = Array.from(v.subarray ? v.subarray(0, n) : v.slice(0, n)).map((x) => Math.max(0, x)).sort((x, y) => x - y);
	let s = 0, tot = 0;
	for (let i = 0; i < n; i++) (s += (2 * (i + 1) - n - 1) * a[i]), (tot += a[i]);
	return tot > 0 ? s / (n * tot) : 0;
}

// ── initial sizing: a Leontief pass for what N people need, so capacities and land start in proportion ─────────────────
function requirements(N) {
	const hh = [2600, 10, 40, 200, 1.2, 1.5]; // close to what people want once they can afford it
	const X = new Float64Array(M);
	for (let it = 0; it < 300; it++) {
		const need = new Float64Array(NPROD);
		for (let g = 0; g < NHH; g++) need[g] += hh[g] * N;
		for (let k = 0; k < BASE_COOPS; k++) {
			const sp = SPECS[k], K = X[k] / 0.85;
			for (const [j, a] of sp.inputs) need[j] += a * X[k];
			for (const [j, c] of sp.capital) need[j] += (c * K * (sp.dep + 0.05)) / 365; // wear plus room to grow 5 %/yr
			if (sp.upkeep) for (const [j, a] of sp.upkeep) need[j] += a * N;
		}
		X[AGRI] = need[FOOD] * 0.75;
		X[GREEN] = need[FOOD] * 0.25;
		X[SOLAR] = need[ENERGY];
		X[HABITAT] = need[HOUSING];
		X[CITY] = need[WATER];
		X[GOODSC] = need[GOODS];
		X[CAREC] = need[CARE];
		X[PANEL] = need[PANELS];
		X[BUILD] = need[MAT];
	}
	const K = X.map((x) => x / 0.85);
	let land = 0;
	for (let k = 0; k < BASE_COOPS; k++) land += SPECS[k].land * K[k];
	return { X, K, land };
}

// initial goods prices, R a unit (quoted in the reference unit, charged in own MIND at its TWAP price), chosen so the basic bundle costs about the daily investor half (tatonnement
// moves them from there)
const P0 = [0.0009, 0.25, 0.12, 0.003, 2, 1.5, 400, 0.15];

// ── the world ────────────────────────────────────────────────────────────────────────────────────────────────────────
function initPerson(S, i, day) {
	let bs = 0;
	for (let g = 0; g < NHH; g++) {
		const v = BETA[g] * Math.exp(0.35 * gauss(S));
		S.beta[i * NHH + g] = v;
		bs += v;
	}
	for (let g = 0; g < NHH; g++) S.beta[i * NHH + g] /= bs;
	let vs = 0;
	for (let k = 0; k < M; k++) {
		let v = 0;
		if (k < BASE_COOPS) {
			const p = SPECS[k].product;
			v = p >= 0 && p < NHH ? S.beta[i * NHH + p] * (k === AGRI ? 0.75 : k === GREEN ? 0.25 : 1) : 0.03;
			if (k === CITY) v += 0.06; // water, streets, parks, land
			v *= Math.exp(0.5 * gauss(S));
		}
		S.values[i * M + k] = v;
		vs += v;
	}
	for (let k = 0; k < M; k++) {
		S.values[i * M + k] /= vs;
		S.alloc[i * M + k] = S.values[i * M + k];
		S.hold[i * M + k] = 0;
	}
	S.workH[i] = !S.sc.allWork && rnd(S) < 0.4 ? 0 : 2 * Math.exp(-0.18 + 0.6 * gauss(S)); // 40 % offer no work (children, the old, carers)
	S.ybar[i] = 12;
	S.born[i] = day;
	S.ring[i] = 0;
}

function newCoop(k) {
	return {
		k, active: k < BASE_COOPS, K: 0, prodF: 1, land: 0, inv: new Float64Array(NPROD), capInv: new Float64Array(NPROD),
		tre: new Float64Array(M), priceR: SPECS[k].product >= 0 ? P0[SPECS[k].product] : 0, price: SPECS[k].product >= 0 ? P0[SPECS[k].product] : 0, q: 0, zEma: 1, reqEma: 0,
		costEma: 0, capEma: 0, heartsEma: 0, outValEma: 0, poolDue: 0, baskets: [], insolv: 0, module: 0, ordIn: new Float64Array(M),
		ordCap: new Float64Array(M), selfIn: 0, selfCap: 0, need: new Float64Array(M), tgt: new Float64Array(M),
		buy: new Float64Array(M), sell: new Float64Array(M), rentDue: 0, wageOwn: 0, Keff: 0, made: 0, failed: false,
		leaseFee: 0, revenueR: 0
	};
}

function init(sc) {
	const N0 = sc.N0;
	const Nmax = sc.popGrowth ? Math.ceil(N0 * Math.exp(sc.popGrowth * sc.years) * 1.05) + 5 : N0;
	const S = { sc, t: 0, rs: sc.seed >>> 0 || 1, N: N0, Nmax, popAcc: 0 };
	S.hold = new Float64Array(Nmax * M);
	S.alloc = new Float64Array(Nmax * M);
	S.values = new Float64Array(Nmax * M);
	S.beta = new Float64Array(Nmax * NHH);
	S.workH = new Float64Array(Nmax);
	S.ybar = new Float64Array(Nmax);
	S.inc = new Float64Array(Nmax);
	S.born = new Float64Array(Nmax);
	S.ring = new Uint8Array(Nmax);
	S.cons = new Float64Array(Nmax * NHH);
	S.reqU = new Float64Array(Nmax * M);
	S.pbuy = new Float64Array(Nmax * M);
	S.psell = new Float64Array(Nmax * M);
	for (let i = 0; i < Nmax; i++) initPerson(S, i, 0);
	S.c = SPECS.map((_, k) => newCoop(k));
	const req = requirements(N0);
	S.req0 = req;
	for (let k = 0; k < BASE_COOPS; k++) {
		const co = S.c[k];
		co.K = req.K[k] * sc.seedCap;
		co.land = SPECS[k].land * co.K;
		co.reqEma = req.X[k] * sc.seedCap;
		for (const [j, a] of SPECS[k].inputs) co.inv[j] = a * co.reqEma * 14;
		if (SPECS[k].upkeep) for (const [j, a] of SPECS[k].upkeep) co.inv[j] += a * N0 * 14;
	}
	S.landTotal = (req.land * 1.6) / (1 - BUILT_SHARE); // fixed for ever; 20 % of it streets and parks
	S.landLeasable = req.land * 1.6;
	S.pools = BASKETS.map((m) => newPool(m));
	S.pools.forEach((p, pi) => p.m.forEach((k) => S.c[k].baskets.push(pi)));
	S.P = new Float64Array(M).fill(1); // consensus MIND prices in R; par is the prior until a pool prices a MIND
	S.Ptw = new Float64Array(M).fill(1);
	S.live = new Uint8Array(M);
	S.rho = 0.0004; // ground rent, CITYmind a m² a day
	S.arb = new Float64Array(M);
	S.spendShare = new Float64Array(M);
	S.routeCostEma = 0.01;
	S.leaseUnmet = 0;
	S.tot = { issued: 0, melted: 0, burned: 0, arbR: 0 };
	S.Y = [];
	S.cur = newBucket();
	S.first = { d1: null, d30: { pd: 0, s: 0, sg: [0, 0, 0, 0] }, routeIn: 0, routeCost: 0 };
	buildGraph(S);
	return S;
}

function newPool(members) {
	const pos = new Int32Array(M).fill(-1);
	members.forEach((k, i) => (pos[k] = i));
	return { m: members.slice(), pos, x: new Float64Array(members.length), live: false, depR: new Float64Array(members.length) };
}

function newBucket() {
	return {
		pd: 0, sAny: 0, sg: [0, 0, 0, 0], newPd: 0, newS: 0, cons: new Float64Array(NHH), routeIn: 0, routeCost: 0,
		routeFee: 0, hopsIn: 0, insolv: new Float64Array(M), steps: 0, days: 0, arbR: 0, hearts: new Float64Array(M),
		burned: 0, retired: 0, issued: 0, payR: 0, cpiSum: 0, cpiN: 0, rentR: 0, wagesR: 0, divR: 0, propR: 0, pFail: 0,
		divK: new Float64Array(M), eligK: new Float64Array(M), treInR: 0, heartInR: 0, salesHHR: 0, b2bR: 0
	};
}

// ── routes and arbitrage cycles through the pools ────────────────────────────────────────────────────────────────────
function buildGraph(S) {
	const pools = S.pools;
	const inPools = Array.from({ length: M }, () => []);
	pools.forEach((p, pi) => p.m.forEach((k) => inPools[k].push(pi)));
	const both = (i, j) => inPools[i].filter((p) => pools[p].pos[j] >= 0);
	S.routes = [];
	for (let i = 0; i < M; i++)
		for (let j = 0; j < M; j++) {
			const rs = [];
			if (i !== j) {
				for (const p of both(i, j)) rs.push([p, pools[p].pos[i], pools[p].pos[j]]);
				for (let k = 0; k < M; k++) {
					if (k === i || k === j) continue;
					for (const p1 of both(i, k)) for (const p2 of both(k, j)) if (p1 !== p2) rs.push([p1, pools[p1].pos[i], pools[p1].pos[k], p2, pools[p2].pos[k], pools[p2].pos[j]]);
				}
			}
			S.routes.push(rs);
		}
	// cycles: two pools that share two MINDs, and triangles over three different pools
	const cyc = [];
	for (let i = 0; i < M; i++)
		for (let j = 0; j < M; j++) {
			if (i === j) continue;
			const ps = both(i, j);
			for (const p1 of ps) for (const p2 of ps) if (p1 !== p2) cyc.push([p1, pools[p1].pos[i], pools[p1].pos[j], p2, pools[p2].pos[j], pools[p2].pos[i]]);
		}
	for (let i = 0; i < M; i++)
		for (let j = i + 1; j < M; j++)
			for (let k = i + 1; k < M; k++) {
				if (k === j) continue;
				for (const p1 of both(i, j)) for (const p2 of both(j, k)) for (const p3 of both(k, i)) {
					if (p1 === p2 || p2 === p3 || p3 === p1) continue;
					cyc.push([p1, pools[p1].pos[i], pools[p1].pos[j], p2, pools[p2].pos[j], pools[p2].pos[k], p3, pools[p3].pos[k], pools[p3].pos[i]]);
				}
			}
	S.cycles = cyc;
	S.cycStart = cyc.map((e) => S.pools[e[0]].m[e[1]]);
}

const swapOut = (x, a, b, amt) => {
	const ain = amt * GAM;
	return (x[b] * ain) / (x[a] + ain);
};

function routeOut(S, r, amt) {
	const p1 = S.pools[r[0]];
	if (!p1.live) return 0;
	let o = swapOut(p1.x, r[1], r[2], amt);
	if (r.length > 3) {
		const p2 = S.pools[r[3]];
		if (!p2.live) return 0;
		o = swapOut(p2.x, r[4], r[5], o);
	}
	return o;
}

function routeDo(S, r, amt) {
	const p1 = S.pools[r[0]];
	let o = swapOut(p1.x, r[1], r[2], amt);
	p1.x[r[1]] += amt;
	p1.x[r[2]] -= o;
	if (r.length > 3) {
		const p2 = S.pools[r[3]];
		const o2 = swapOut(p2.x, r[4], r[5], o);
		p2.x[r[4]] += o;
		p2.x[r[5]] -= o2;
		o = o2;
	}
	return o;
}

/** sell q of MIND i for MIND j through the best routes, in four slices; returns what arrived and the hops used */
function execOrder(S, i, j, q, B) {
	const rs = S.routes[i * M + j];
	if (!rs.length || !(q > 0)) return { out: 0, fail: q };
	let out = 0, fail = 0;
	const slices = 4;
	for (let s = 0; s < slices; s++) {
		const a = q / slices;
		let best = -1, bo = 0;
		for (let r = 0; r < rs.length; r++) {
			const o = routeOut(S, rs[r], a);
			if (o > bo) (bo = o), (best = r);
		}
		if (best < 0) {
			fail += a;
			continue;
		}
		const hops = rs[best].length / 3;
		out += routeDo(S, rs[best], a);
		const inR = a * S.P[i];
		B.hopsIn += inR * hops;
		B.routeFee += inR * (1 - Math.pow(GAM, hops));
	}
	return { out, fail };
}

function arbitrage(S) {
	const dest = S.sc.arbTo;
	for (let pass = 0; pass < 4; pass++) {
		let any = false;
		for (let c = 0; c < S.cycles.length; c++) {
			const e = S.cycles[c];
			let A = 1, B = 1, C = 0, ok = true;
			for (let h = 0; h < e.length; h += 3) {
				const p = S.pools[e[h]];
				if (!p.live) {
					ok = false;
					break;
				}
				const a = p.x[e[h + 1]], b = p.x[e[h + 2]];
				const A2 = b * GAM * A, B2 = a * B, C2 = a * C + GAM * A;
				(A = A2), (B = B2), (C = C2);
			}
			if (!ok || !(A > B * 1.000001)) continue;
			const d = (Math.sqrt(A * B) - B) / C;
			if (!(d > 0)) continue;
			let amt = d;
			for (let h = 0; h < e.length; h += 3) {
				const p = S.pools[e[h]];
				const o = swapOut(p.x, e[h + 1], e[h + 2], amt);
				p.x[e[h + 1]] += amt;
				p.x[e[h + 2]] -= o;
				amt = o;
			}
			const profit = amt - d;
			if (profit <= 0) continue;
			any = true;
			const k = S.cycStart[c];
			S.cur.arbR += profit * S.P[k];
			S.tot.arbR += profit * S.P[k];
			if (dest === 'avens') {
				const share = profit / S.N;
				for (let i = 0; i < S.N; i++) S.hold[i * M + k] += share;
			} else S.arb[k] += profit;
		}
		if (!any) break;
	}
}

/** consensus prices from all live pools (depth-weighted), in R = geometric mean of the reference MINDs */
function updatePrices(S, dt) {
	const P = S.P;
	for (const p of S.pools) {
		let ok = true;
		for (let i = 0; i < p.m.length; i++) if (!(p.x[i] > 1e-12)) ok = false;
		p.live = ok;
	}
	S.live.fill(0);
	for (const p of S.pools) if (p.live) for (const k of p.m) S.live[k] = 1;
	const lnP = new Float64Array(M);
	for (let k = 0; k < M; k++) lnP[k] = Math.log(P[k] > 0 ? P[k] : 1);
	for (let it = 0; it < 4; it++) {
		const num = new Float64Array(M), den = new Float64Array(M);
		for (const p of S.pools) {
			if (!p.live) continue;
			const n = p.m.length;
			let mp = 0, mx = 0;
			for (let i = 0; i < n; i++) (mp += lnP[p.m[i]]), (mx += Math.log(p.x[i]));
			const s = (mp + mx) / n;
			const depth = n * Math.exp(s);
			for (let i = 0; i < n; i++) {
				num[p.m[i]] += depth * (s - Math.log(p.x[i]));
				den[p.m[i]] += depth;
			}
		}
		for (let k = 0; k < M; k++) if (den[k] > 0) lnP[k] = num[k] / den[k];
		let ref = 0, nr = 0;
		for (const k of REF) if (S.live[k]) (ref += lnP[k]), nr++;
		if (nr === REF.length) for (let k = 0; k < M; k++) if (den[k] > 0) lnP[k] -= ref / nr;
	}
	const a = Math.min(1, dt / 7);
	for (let k = 0; k < M; k++) {
		if (S.live[k]) P[k] = Math.exp(lnP[k]);
		S.Ptw[k] += a * (P[k] - S.Ptw[k]);
	}
}

// ── one step of dt days ──────────────────────────────────────────────────────────────────────────────────────────────
/** credit a treasury in its own MIND; only the treasury half of each HEART pays a tenth into the pools (sales are not levied) */
function treasuryIn(S, k, amt, levy = false) {
	if (!(amt > 0)) return;
	const co = S.c[k];
	if (levy) {
		const d = POOL_SHARE * amt;
		co.poolDue += d;
		amt -= d;
	}
	co.tre[k] += amt;
}

const effCap = (S, k) => {
	const co = S.c[k], sp = SPECS[k];
	let K = co.K;
	if (sp.land > 0) K = Math.min(K, co.land / sp.land);
	return K * co.prodF;
};

function meltAll(S, f) {
	const n = S.N * M;
	let lost = 0;
	for (let x = 0; x < n; x++) (lost += S.hold[x]), (S.hold[x] *= f);
	for (const co of S.c) for (let k = 0; k < M; k++) (lost += co.tre[k]), (co.tre[k] *= f);
	for (const p of S.pools) for (let i = 0; i < p.x.length; i++) (lost += p.x[i]), (p.x[i] *= f);
	for (let k = 0; k < M; k++) (lost += S.arb[k]), (S.arb[k] *= f);
	S.tot.melted += lost * (1 - f);
}

function grow(S, dt) {
	S.popAcc += S.N * (Math.exp((S.sc.popGrowth * dt) / 365) - 1);
	while (S.popAcc >= 1 && S.N < S.Nmax) {
		initPerson(S, S.N, S.t);
		S.N++;
		S.popAcc -= 1;
	}
}

function invest(S, dt) {
	const half = (HEARTS_DAY * dt) / 2, N = S.N, to = new Float64Array(M);
	for (let i = 0; i < N; i++) {
		const b = i * M;
		let inc = 0, sum = 0;
		for (let k = 0; k < M; k++) sum += S.alloc[b + k];
		for (let k = 0; k < M; k++) {
			const a = sum > 0 ? S.alloc[b + k] / sum : 0;
			if (a > 0) {
				const m = half * a;
				S.hold[b + k] += m;
				to[k] += m;
				inc += m * S.P[k];
			}
		}
		S.inc[i] = inc;
	}
	const ea = Math.min(1, dt / 90);
	for (let k = 0; k < M; k++) {
		const co = S.c[k];
		if (to[k] > 0) treasuryIn(S, k, to[k], true), (S.cur.treInR += to[k] * (1 - POOL_SHARE) * S.P[k]), (S.cur.heartInR += to[k] * (1 - POOL_SHARE) * S.P[k]);
		co.heartsEma += ea * ((2 * to[k]) / dt - co.heartsEma);
		S.cur.hearts[k] += 2 * to[k];
	}
	S.tot.issued += 2 * half * N;
	S.cur.issued += 2 * half * N;
}

/** R price of a unit from each seller, and how households split a product between its sellers (logit, ε = 6) */
function sellerTable(S) {
	const a = S.sc.mech === 'a', T = [];
	for (let g = 0; g < NPROD; g++) T.push({ s: [], sh: [], pi: Infinity, piR: Infinity });
	for (let k = 0; k < M; k++) {
		const co = S.c[k], sp = SPECS[k];
		if (!co.active || sp.product < 0 || co.Keff <= 1e-9 || !(S.P[k] > 0)) continue;
		const pi = a ? (co.q > 0 ? S.P[k] / co.q : Infinity) : co.price * S.P[k];
		if (!isFinite(pi) || pi <= 0) continue;
		T[sp.product].s.push(k);
		T[sp.product].sh.push(pi);
	}
	for (const t of T) {
		if (!t.s.length) continue;
		const lo = Math.min(...t.sh);
		let sum = 0;
		const w = t.sh.map((p) => Math.pow(p / lo, -6));
		w.forEach((x) => (sum += x));
		let pi = 0;
		t.sh = w.map((x, i) => {
			const s = x / sum;
			return s;
		});
		t.s.forEach((k, i) => {
			const co = S.c[k];
			pi += t.sh[i] * (a ? S.P[k] / co.q : co.price * S.P[k]);
		});
		t.pi = pi;
	}
	return T;
}

/** Stone–Geary demand with satiation: per day, from a budget per day (or, under quotas, a stock) at R prices pi */
function demand(budget, pi, beta, bo, out) {
	let basic = 0;
	for (let g = 0; g < 4; g++) basic += BASIC[g] * (isFinite(pi[g]) ? pi[g] : 0);
	if (!(budget > basic)) {
		const f = basic > 0 ? Math.max(0, budget) / basic : 0;
		for (let g = 0; g < NHH; g++) out[g] = g < 4 && isFinite(pi[g]) ? BASIC[g] * f : 0;
		return;
	}
	let extra = budget - basic;
	const free = [true, true, true, true, true, true];
	for (let g = 0; g < NHH; g++) {
		out[g] = BASIC[g];
		if (!isFinite(pi[g])) (free[g] = false), (out[g] = 0);
	}
	for (let pass = 0; pass < 6; pass++) {
		let bs = 0;
		for (let g = 0; g < NHH; g++) if (free[g]) bs += beta[bo + g];
		if (bs <= 0 || extra <= 0) break;
		let capped = false;
		for (let g = 0; g < NHH; g++) {
			if (!free[g]) continue;
			const x = BASIC[g] + ((beta[bo + g] / bs) * extra) / pi[g];
			if (x >= SAT[g]) {
				out[g] = SAT[g];
				free[g] = false;
				extra -= (SAT[g] - BASIC[g]) * pi[g];
				capped = true;
			}
		}
		if (!capped) {
			for (let g = 0; g < NHH; g++) if (free[g]) out[g] = BASIC[g] + ((beta[bo + g] / bs) * extra) / pi[g];
			break;
		}
	}
}

/** COOPs plan: production, input and capital orders, ground rent, wages, what MIND they need */
function plan(S, dt, T) {
	const mech = S.sc.mech;
	let leased = 0;
	for (let k = 0; k < M; k++) if (S.c[k].active) leased += S.c[k].land;
	let free = S.landLeasable - leased;
	S.leaseUnmet = 0;
	for (let k = 0; k < M; k++) {
		const co = S.c[k], sp = SPECS[k];
		co.need.fill(0);
		co.tgt.fill(0);
		co.ordIn.fill(0);
		co.ordCap.fill(0);
		co.selfIn = co.selfCap = 0;
		co.rentDue = co.wageOwn = 0;
		if (!co.active) continue;
		co.Keff = effCap(S, k);
		if (sp.product < 0) continue;
		const plannedDay = Math.min(co.Keff, co.reqEma * 1.05);
		const want = new Float64Array(NPROD), wantCap = new Float64Array(NPROD);
		// inputs: replace this step's use and close 30 % of the gap to a 14-day stock
		const useDay = new Float64Array(NPROD);
		for (const [j, a] of sp.inputs) useDay[j] += plannedDay * a;
		if (sp.upkeep) for (const [j, a] of sp.upkeep) useDay[j] += a * S.N;
		for (let j = 0; j < NPROD; j++) if (useDay[j] > 0) want[j] += Math.max(0, useDay[j] * dt + 0.3 * Math.min(1, dt / 3) * (useDay[j] * 14 - co.inv[j]));
		// capacity: grow while sold out and covered, replace wear while used, else let it shrink
		let dK = 0;
		if (sp.lumpy && co.K <= 0) {
			const margin = unitR(S, sp.product) - varCostR(S, k), payback = margin > 0 ? capCostR(S, k) / (margin * 365) : Infinity;
			dK = mech === 'a' || payback <= 0.4 / sp.dep ? co.module : 0;
		}
		else {
			let g = 0;
			const cover = co.costEma > 0 ? valueOf(S, co.tre) / co.costEma : 99;
			// grow only what pays back within 40 % of the asset's life at today's prices (quotas: no prices, demand only);
			// replace wear on whatever is still used
			let growOK = true;
			if (mech !== 'a') {
				const margin = co.priceR - varCostR(S, k), payback = margin > 0 ? capCostR(S, k) / (margin * 365) : Infinity;
				const life = sp.dep > 0 ? 1 / sp.dep : 50;
				growOK = payback <= 0.4 * life;
			}
			if (co.zEma >= 0.9 && cover >= 20 && growOK) g = sp.gMax * Math.min(1, (co.zEma - 0.85) / 0.2);
			const repl = co.zEma >= 0.6 ? sp.dep : 0;
			dK = (co.K * (g + repl) * dt) / 365;
		}
		if (sp.land > 0 && dK > 0) {
			const wantLand = sp.land * (co.K + dK) - co.land;
			if (wantLand > 0) {
				const grant = Math.min(wantLand, Math.max(0, free));
				co.land += grant;
				free -= grant;
				S.leaseUnmet += wantLand - grant;
				if (grant < wantLand) dK = Math.max(0, co.land / sp.land - co.K);
			}
		}
		if (sp.capital.length) {
			let conv = Infinity;
			for (const [j, c] of sp.capital) conv = Math.min(conv, co.capInv[j] / c);
			for (const [j, c] of sp.capital) {
				const left = co.capInv[j] - conv * c;
				wantCap[j] += Math.max(0, (sp.lumpy && co.K <= 0 ? dK * c - co.capInv[j] : dK * c - left));
			}
		}
		// orders by seller
		for (let j = 0; j < NPROD; j++) {
			if (want[j] <= 0 && wantCap[j] <= 0) continue;
			if (SPECS[k].product === j && co.Keff > 0) {
				co.selfIn += want[j];
				co.selfCap += wantCap[j];
				continue;
			}
			const t = T[j];
			let shs = 0;
			for (let x = 0; x < t.s.length; x++) if (t.s[x] !== k) shs += t.sh[x];
			for (let x = 0; x < t.s.length; x++) {
				const s = t.s[x];
				if (s === k || shs <= 0) continue;
				co.ordIn[s] += (want[j] * t.sh[x]) / shs;
				co.ordCap[s] += (wantCap[j] * t.sh[x]) / shs;
			}
		}
		co.rentDue = k === CITY || S.t < (co.graceUntil || 0) ? 0 : co.land * S.rho * dt + co.leaseFee * dt;
		const hours = sp.work * plannedDay * dt + (sp.upkeepWork ? sp.upkeepWork * S.N * dt : 0);
		co.wageOwn = S.P[k] > 0 ? (hours * S.sc.wageR) / S.P[k] : 0;
		// what it needs to hold
		if (mech === 'a') {
			for (let s = 0; s < M; s++) {
				const flow = (co.ordIn[s] + co.ordCap[s]) / dt;
				if (flow > 0 && S.c[s].q > 0) co.tgt[s] = flow / S.c[s].q;
			}
			co.need[CITY] += co.rentDue;
		} else {
			let opR = 0, capR = 0;
			for (let s = 0; s < M; s++) {
				opR += co.ordIn[s] * S.c[s].price * S.P[s];
				capR += co.ordCap[s] * S.c[s].price * S.P[s];
			}
			opR += co.rentDue * S.P[CITY] + co.wageOwn * S.P[k];
			const V = valueOf(S, co.tre);
			let fIn = 1, fCap = 0;
			if (V < opR) {
				fIn = opR > 0 ? V / opR : 0;
				if (fIn < 0.99) (co.insolv += dt), (S.cur.insolv[k] += dt);
			} else if (capR > 0) fCap = Math.min(1, Math.max(0, V - opR - 20 * co.costEma) / capR);
			for (let s = 0; s < M; s++) {
				co.ordIn[s] *= fIn;
				co.ordCap[s] *= fCap;
				co.need[s] = (co.ordIn[s] + co.ordCap[s]) * S.c[s].price;
			}
			co.need[CITY] += co.rentDue * fIn;
			co.selfCap *= fCap > 0 ? 1 : 0;
			co.costEma = co.costEma > 0 ? co.costEma + Math.min(1, dt / 30) * (opR / dt - co.costEma) : opR / dt;
			co.capEma += Math.min(1, dt / 30) * (capR / dt - co.capEma);
		}
	}
}

const valueOf = (S, v) => {
	let s = 0;
	for (let k = 0; k < M; k++) s += v[k] * S.P[k];
	return s;
};

/** every agent's Aven or treasurer turns what it holds into what it must pay and wants to hold; one batch through the pools */
function trade(S, dt, T, B) {
	const mech = S.sc.mech, N = S.N, P = S.P, c = S.c;
	const sellQ = new Float64Array(M), buyQ = new Float64Array(M);
	const pi = new Float64Array(NHH), x = new Float64Array(NHH), need = new Float64Array(M), tgt = new Float64Array(M);
	for (let g = 0; g < NHH; g++) pi[g] = T[g].pi;
	const reb = 1 - Math.exp(-(mech === 'a' ? 0.1 : 0.2) * dt);
	const spend = new Float64Array(M);
	for (let i = 0; i < N; i++) {
		const b = i * M;
		let W = 0;
		for (let k = 0; k < M; k++) W += S.hold[b + k] * P[k];
		need.fill(0);
		tgt.fill(0);
		if (mech !== 'a') {
			const y = S.ybar[i];
			const bud = Math.min(W, dt * Math.max(0, y + (W - 3 * y) / 15));
			demand(bud / dt, pi, S.beta, i * NHH, x);
			let spendR = 0;
			for (let g = 0; g < NHH; g++) {
				const t = T[g];
				for (let z = 0; z < t.s.length; z++) {
					const s = t.s[z], u = x[g] * dt * t.sh[z];
					S.reqU[b + s] = u;
					need[s] += u * c[s].price;
					spendR += u * c[s].price * P[s];
				}
			}
			// keep about a week of spending in the MINDs it is spent in; savings stay where they are
			const rem = Math.max(0, W - spendR);
			const buf = spendR > 0 ? Math.min(rem / spendR, 7 / dt) : 0;
			for (let s = 0; s < M; s++) {
				tgt[s] = need[s] * (1 + buf);
				spend[s] += need[s] * P[s];
			}
		} else {
			demand(W, pi, S.beta, i * NHH, x);
			for (let g = 0; g < NHH; g++) {
				const t = T[g];
				for (let z = 0; z < t.s.length; z++) {
					const s = t.s[z], u = x[g] * t.sh[z];
					S.reqU[b + s] = u * dt;
					tgt[s] += c[s].q > 0 ? u / c[s].q : 0;
					spend[s] += u * (c[s].q > 0 ? P[s] / c[s].q : 0);
				}
			}
		}
		orders(S.hold, b, need, tgt, reb, P, S.pbuy, S.psell, sellQ, buyQ, -1);
	}
	let sp = 0;
	for (let k = 0; k < M; k++) sp += spend[k];
	for (let k = 0; k < M; k++) S.spendShare[k] += Math.min(1, dt / 30) * ((sp > 0 ? spend[k] / sp : 0) - S.spendShare[k]);
	// treasuries
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active) continue;
		co.buy.fill(0);
		co.sell.fill(0);
		if (mech === 'a') {
			for (let s = 0; s < M; s++) need[s] = co.need[s];
			for (let s = 0; s < M; s++) tgt[s] = Math.max(co.tgt[s], co.need[s]);
			orders(co.tre, 0, need, tgt, Math.min(1, 0.3 * dt), P, co.buy, co.sell, sellQ, buyQ, k);
		} else orders(co.tre, 0, co.need, co.need, 0, P, co.buy, co.sell, sellQ, buyQ, k);
	}
	// match sells to buys (value, biproportional, no self pairs) and execute in random order
	const sv = new Float64Array(M), bv = new Float64Array(M);
	let ts = 0, tb = 0;
	for (let k = 0; k < M; k++) (sv[k] = sellQ[k] * P[k]), (bv[k] = buyQ[k] * P[k]), (ts += sv[k]), (tb += bv[k]);
	const recv = new Float64Array(M), refund = new Float64Array(M);
	if (ts > 0 && tb > 0) {
		const V = new Float64Array(M * M);
		for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) if (i !== j) V[i * M + j] = sv[i] * bv[j];
		const colT = bv.map((v) => (v * ts) / tb);
		for (let it = 0; it < 8; it++) {
			for (let i = 0; i < M; i++) {
				let r = 0;
				for (let j = 0; j < M; j++) r += V[i * M + j];
				if (r > 0) for (let j = 0; j < M; j++) V[i * M + j] *= sv[i] / r;
			}
			for (let j = 0; j < M; j++) {
				let r = 0;
				for (let i = 0; i < M; i++) r += V[i * M + j];
				if (r > 0) for (let i = 0; i < M; i++) V[i * M + j] *= colT[j] / r;
			}
		}
		// end on rows: nobody sells more than they put in
		for (let i = 0; i < M; i++) {
			let r = 0;
			for (let j = 0; j < M; j++) r += V[i * M + j];
			if (r > sv[i]) for (let j = 0; j < M; j++) V[i * M + j] *= sv[i] / r;
		}
		const pairs = [];
		for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) if (V[i * M + j] > 0) pairs.push(i * M + j);
		for (let a = pairs.length - 1; a > 0; a--) {
			const z = Math.floor(rnd(S) * (a + 1));
			[pairs[a], pairs[z]] = [pairs[z], pairs[a]];
		}
		// a step of several days trades as that many daily batches, with arbitrage between them
		const nSub = Math.max(1, Math.round(dt));
		for (let sub = 0; sub < nSub; sub++) {
			for (const pj of pairs) {
				const i = Math.floor(pj / M), j = pj % M;
				const q = V[pj] / P[i] / nSub;
				const { out, fail } = execOrder(S, i, j, q, B);
				recv[j] += out;
				refund[i] += fail;
				const inR = (q - fail) * P[i];
				B.routeIn += inR;
				B.routeCost += inR - out * P[j];
				if (S.t < 365) (S.first.routeIn += inR), (S.first.routeCost += inR - out * P[j]);
				B.pFail += fail * P[i];
			}
			if (nSub > 1) arbitrage(S);
		}
		// sells that found no buyer side at all
		for (let i = 0; i < M; i++) {
			let r = 0;
			for (let j = 0; j < M; j++) r += V[i * M + j];
			if (sellQ[i] > 0 && P[i] > 0) refund[i] += Math.max(0, sellQ[i] - r / P[i]);
		}
	} else for (let k = 0; k < M; k++) refund[k] = sellQ[k];
	const fill = new Float64Array(M), back = new Float64Array(M);
	for (let k = 0; k < M; k++) {
		fill[k] = buyQ[k] > 0 ? recv[k] / buyQ[k] : 0;
		back[k] = sellQ[k] > 0 ? Math.min(1, refund[k] / sellQ[k]) : 0;
	}
	for (let i = 0; i < N; i++) {
		const b = i * M;
		for (let k = 0; k < M; k++) S.hold[b + k] += fill[k] * S.pbuy[b + k] + back[k] * S.psell[b + k];
	}
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active) continue;
		for (let s = 0; s < M; s++) co.tre[s] += fill[s] * co.buy[s] + back[s] * co.sell[s];
	}
}

/** one agent: buy what it must pay plus a slice of its target mix, funded by selling what it holds beyond targets */
function orders(h, b, need, tgt, reb, P, pbuy, psell, sellQ, buyQ, self) {
	let buyV = 0, exV = 0, othV = 0;
	const isP = self < 0;
	for (let s = 0; s < M; s++) {
		const hs = h[b + s];
		let bq = 0;
		if (s !== self) {
			const mb = Math.max(0, need[s] - hs);
			const rb = reb * Math.max(0, tgt[s] - Math.max(hs, need[s]));
			bq = P[s] > 0 ? mb + rb : 0;
		}
		if (isP) pbuy[b + s] = bq;
		else pbuy[s] = bq;
		buyV += bq * P[s];
		const keep = s === self ? Math.max(tgt[s], need[s]) : Math.max(tgt[s], need[s]);
		exV += Math.max(0, hs - keep) * P[s];
		othV += Math.max(0, Math.min(hs, keep) - need[s]) * P[s];
	}
	// a treasury pays its own wages and costs from its own MIND: never sells it below what it must pay out itself
	let f1 = 0, f2 = 0, fb = 1;
	if (buyV <= exV) f1 = exV > 0 ? buyV / exV : 0;
	else {
		f1 = 1;
		const rest = buyV - exV;
		if (rest <= othV) f2 = othV > 0 ? rest / othV : 0;
		else (f2 = 1), (fb = (exV + othV) / buyV);
	}
	for (let s = 0; s < M; s++) {
		const hs = h[b + s];
		const keep = Math.max(tgt[s], need[s]);
		const sq = f1 * Math.max(0, hs - keep) + f2 * Math.max(0, Math.min(hs, keep) - need[s]);
		h[b + s] -= sq;
		if (isP) {
			psell[b + s] = sq;
			pbuy[b + s] *= fb;
			buyQ[s] += pbuy[b + s];
		} else {
			psell[s] = sq;
			pbuy[s] *= fb;
			buyQ[s] += pbuy[s];
		}
		sellQ[s] += sq;
	}
}

function payRent(S, dt, B) {
	let paidAll = 0;
	for (let k = 0; k < M; k++) {
		const co = S.c[k];
		if (!co.active || k === CITY || co.rentDue <= 0) continue;
		const paid = Math.min(co.rentDue, co.tre[CITY]);
		co.tre[CITY] -= paid;
		paidAll += paid;
		if (paid < co.rentDue * 0.999) {
			const f = 1 - paid / co.rentDue;
			co.land *= 1 - f * Math.min(1, dt / 30);
		}
	}
	B.rentR += paidAll * S.P[CITY];
	B.treInR += paidAll * S.P[CITY];
	treasuryIn(S, CITY, paidAll);
}

/** (d): the working capital a treasury keeps in its own MIND: capDays of running costs and planned building */
const wcTarget = (S, k) => (S.P[k] > 0 ? (S.sc.capDays * (S.c[k].costEma + S.c[k].capEma)) / S.P[k] : 0);

/** (d): a treasury never holds more of its own MIND than its working-capital target; the protocol retires the rest */
function capTreasuries(S, B) {
	if (S.sc.mech !== 'd') return;
	for (let k = 0; k < M; k++) {
		const co = S.c[k];
		if (!co.active) continue;
		const over = co.tre[k] - wcTarget(S, k);
		if (over > 0) (co.tre[k] -= over), (S.tot.burned += over), (B.burned += over), (B.retired += over);
	}
}

/**
 * main scenario: what a treasury holds of its own MIND above its working capital (60 days of running costs and planned
 * building) it pays out within about a month (pace sc.payout a year): a share sc.divShare as a dividend to everyone who
 * holds its MIND (people and other treasuries, pro rata; not itself, not the pools), the rest for accepted work
 * proposals, paid to the people who do the work (by hours offered)
 */
function payOut(S, dt, B) {
	if (S.sc.mech !== 'b' || !(S.sc.payout > 0)) return;
	const N = S.N, c = S.c;
	let hrs = 0;
	for (let i = 0; i < N; i++) hrs += S.workH[i];
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active || k === JUNK) continue;
		const over = co.tre[k] - wcTarget(S, k);
		if (!(over > 0)) continue;
		const pay = over * Math.min(1, (S.sc.payout * dt) / 365);
		const div = holders(S, k) > 0 ? pay * S.sc.divShare : 0;
		if (div > 0) (co.tre[k] -= div), payDiv(S, k, div, B);
		const work = pay - div;
		if (work > 0 && hrs > 0) {
			for (let i = 0; i < N; i++) {
				const w = (work * S.workH[i]) / hrs;
				if (w > 0) (S.hold[i * M + k] += w), (S.inc[i] += w * S.P[k]);
			}
			B.propR += work * S.P[k];
			co.tre[k] -= work;
		}
	}
}

/** the MIND k that may get a dividend: what people and other treasuries hold (not the COOP itself, not the pools) */
function holders(S, k) {
	let H = 0;
	for (let i = 0; i < S.N; i++) H += S.hold[i * M + k];
	for (let j = 0; j < M; j++) if (j !== k && S.c[j].active) H += S.c[j].tre[k];
	return H;
}

/** a dividend of div MIND k, pro rata to its holders (people and other treasuries) */
function payDiv(S, k, div, B) {
	const H = holders(S, k);
	if (!(div > 0 && H > 0)) return;
	const f = div / H, c = S.c;
	for (let i = 0; i < S.N; i++) {
		const d = S.hold[i * M + k] * f;
		S.hold[i * M + k] += d;
		S.inc[i] += d * S.P[k];
	}
	for (let j = 0; j < M; j++) if (j !== k && c[j].active) c[j].tre[k] += c[j].tre[k] * f;
	B.divK[k] += div;
	B.divR += div * S.P[k];
}

/** eligible holdings of every MIND, for the dividend yield */
function eligible(S, dt, B) {
	for (let k = 0; k < M; k++) if (S.c[k].active && k !== JUNK) B.eligK[k] += holders(S, k) * dt;
}

function deliver(S, dt, T, B) {
	const mech = S.sc.mech, N = S.N, c = S.c, P = S.P;
	const tot = new Float64Array(M), totE = new Float64Array(M), totU = new Float64Array(M), totH = new Float64Array(M);
	// requests: what each buyer can pay for (b, c, d) or wants to use (a)
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active || SPECS[k].product < 0) continue;
		co._Y = 0;
	}
	for (let i = 0; i < N; i++) {
		const b = i * M;
		for (let s = 0; s < M; s++) {
			const r = S.reqU[b + s];
			if (!(r > 0)) continue;
			if (mech === 'a') {
				const e = S.hold[b + s] * c[s].q * dt;
				const m = Math.min(r, e);
				totE[s] += m;
				totU[s] += r - m;
				tot[s] += r;
			} else {
				const a = Math.min(r, S.hold[b + s] / c[s].price);
				S.reqU[b + s] = a;
				totH[s] += a;
			}
		}
	}
	// COOPs: inputs rank with households; capital orders are served only from what is left (a queue, not a bid)
	const totC = new Float64Array(M);
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active) continue;
		co._in = new Float64Array(M);
		co._cap = new Float64Array(M);
		co._m = new Float64Array(M);
		for (let s = 0; s < M; s++) {
			const r = co.ordIn[s] + co.ordCap[s];
			if (!(r > 0)) continue;
			if (mech === 'a') {
				const e = co.tre[s] * c[s].q * dt, m = Math.min(co.ordIn[s], e);
				co._m[s] = m;
				totE[s] += m;
				totU[s] += co.ordIn[s] - m;
				tot[s] += co.ordIn[s];
				totC[s] += co.ordCap[s];
				co._in[s] = co.ordIn[s];
				co._cap[s] = co.ordCap[s];
			} else {
				const a = Math.min(1, co.tre[s] / (r * c[s].price));
				co._in[s] = co.ordIn[s] * a;
				co._cap[s] = co.ordCap[s] * a;
				tot[s] += co._in[s];
				totC[s] += co._cap[s];
			}
		}
	}
	// what each seller can make this step
	const f1 = new Float64Array(M), f2 = new Float64Array(M), fl = new Float64Array(M), fc = new Float64Array(M), fi = new Float64Array(M);
	for (let s = 0; s < M; s++) {
		const co = c[s], sp = SPECS[s];
		if (!co.active || sp.product < 0) continue;
		let Y = co.Keff * dt;
		for (const [j, a] of sp.inputs) if (a > 0) Y = Math.min(Y, co.inv[j] / a);
		const capAll = totC[s] + co.selfCap;
		const all = tot[s] + totH[s] + co.selfIn + capAll;
		co.zNow = co.Keff > 0 ? all / (co.Keff * dt) : all > 0 ? 9 : 0;
		let spare;
		if (mech === 'a') {
			const base = totE[s] + co.selfIn;
			f1[s] = base > 0 ? Math.min(1, Y / base) : 0;
			spare = Math.max(0, Y - base);
			f2[s] = totU[s] > 0 ? Math.min(1, spare / totU[s]) : 0;
			spare = Math.max(0, spare - f2[s] * totU[s]);
			fi[s] = f1[s];
			fc[s] = capAll > 0 ? Math.min(1, spare / capAll) : 0;
		} else {
			// inputs first (production keeps running), then households and new capacity in proportion
			const inp = tot[s] + co.selfIn;
			fi[s] = inp > 0 ? Math.min(1, Y / inp) : 0;
			spare = Math.max(0, Y - inp);
			const rest = totH[s] + capAll;
			fl[s] = fc[s] = rest > 0 ? Math.min(1, spare / rest) : 0;
		}
		co._self = co.selfIn * fi[s] + co.selfCap * fc[s];
		co._made = co._self;
		co.reqEma += Math.min(1, dt / 14) * (all / dt - co.reqEma);
	}
	// deliver to people: consume, pay, count shortfalls
	const cap = S.sc.capDays;
	const pay = new Float64Array(M);
	const cons = new Float64Array(NHH);
	const B4 = [0, 0, 0, 0];
	let pd = 0, sAny = 0, newPd = 0, newS = 0, cpi = 0;
	const fresh = S.sc.popGrowth ? 3 * 365 : -1;
	for (let i = 0; i < N; i++) {
		const b = i * M;
		cons.fill(0);
		for (let s = 0; s < M; s++) {
			const r = S.reqU[b + s];
			if (!(r > 0)) continue;
			let d;
			if (mech === 'a') {
				const e = S.hold[b + s] * c[s].q * dt, m = Math.min(r, e);
				d = f1[s] * m + f2[s] * (r - m);
			} else {
				d = fl[s] * r;
				const pm = d * c[s].price;
				S.hold[b + s] -= pm;
				pay[s] += pm;
				B.salesHHR += pm * P[s];
			}
			c[s]._made += d;
			cons[SPECS[s].product] += d / dt;
			S.reqU[b + s] = 0;
		}
		let short = false;
		for (let g = 0; g < 4; g++) if (cons[g] < 0.98 * BASIC[g]) (short = true), (B4[g] += dt);
		pd += dt;
		if (short) sAny += dt;
		if (fresh > 0 && S.t - S.born[i] < fresh && S.born[i] > 0) {
			newPd += dt;
			if (short) newS += dt;
		}
		for (let g = 0; g < NHH; g++) (S.cons[i * NHH + g] = cons[g]), (B.cons[g] += cons[g] * dt);
	}
	B.pd += pd;
	B.sAny += sAny;
	B.newPd += newPd;
	B.newS += newS;
	for (let g = 0; g < 4; g++) B.sg[g] += B4[g];
	if (S.t < 30) {
		S.first.d30.pd += pd;
		S.first.d30.s += sAny;
		for (let g = 0; g < 4; g++) S.first.d30.sg[g] += B4[g];
	}
	if (S.t === 0) S.first.d1 = { pd, s: sAny, sg: B4.slice() };
	// deliver to COOPs
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active) continue;
		for (let s = 0; s < M; s++) {
			if (!(co._in[s] + co._cap[s] > 0)) continue;
			let fr;
			if (mech === 'a') fr = co._in[s] > 0 ? (f1[s] * co._m[s] + f2[s] * (co._in[s] - co._m[s])) / co._in[s] : 0;
			else fr = fi[s];
			const j = SPECS[s].product, dIn = co._in[s] * fr, dCap = co._cap[s] * fc[s];
			co.inv[j] += dIn;
			co.capInv[j] += dCap;
			c[s]._made += dIn + dCap;
			if (mech !== 'a') {
				const pm = (dIn + dCap) * c[s].price;
				co.tre[s] -= pm;
				pay[s] += pm;
				B.b2bR += pm * P[s];
			}
		}
		// self supply (no payment)
		const sp = SPECS[k];
		if (sp.product >= 0 && co.selfIn + co.selfCap > 0) {
			co.inv[sp.product] += co.selfIn * fi[k];
			co.capInv[sp.product] += co.selfCap * fc[k];
		}
	}
	// payments land: (b) back to the treasury, (c) burned, (d) back up to the working-capital target, the rest burned
	for (let s = 0; s < M; s++) {
		if (!(pay[s] > 0)) continue;
		const co = c[s];
		B.payR += pay[s] * P[s];
		co.revenueR += pay[s] * P[s];
		if (mech === 'b') {
			// Law 5: a share of every sale goes at once to everyone who holds the seller's MIND
			const d = S.sc.turnDiv > 0 && s !== JUNK && holders(S, s) > 0 ? pay[s] * S.sc.turnDiv : 0;
			treasuryIn(S, s, pay[s] - d), (B.treInR += (pay[s] - d) * P[s]);
			if (d > 0) payDiv(S, s, d, B);
		}
		else if (mech === 'c') (S.tot.burned += pay[s]), (B.burned += pay[s]);
		else if (mech === 'd') {
			const target = wcTarget(S, s);
			const keep = Math.min(pay[s], Math.max(0, target - co.tre[s]));
			treasuryIn(S, s, keep);
			S.tot.burned += pay[s] - keep;
			B.burned += pay[s] - keep;
		}
	}
	// production uses inputs; utilisation and output value
	let hoursD = 0;
	const ea = Math.min(1, dt / 90);
	for (let s = 0; s < M; s++) {
		const co = c[s], sp = SPECS[s];
		if (!co.active) continue;
		if (sp.product >= 0) {
			const made = co._made || 0;
			for (const [j, a] of sp.inputs) co.inv[j] = Math.max(0, co.inv[j] - a * made);
			co.made = made / dt;
			hoursD += sp.work * made;
			const piR = T[sp.product].s.includes(s) ? (mech === 'a' ? P[s] / Math.max(1e-12, co.q) * RATE / 365 : co.price * P[s]) : 0;
			co.outValEma += ea * ((made * piR) / dt - co.outValEma);
			co.zEma += Math.min(1, dt / 14) * ((co.zNow || 0) - co.zEma);
		}
		if (sp.upkeep) {
			for (const [j, a] of sp.upkeep) co.inv[j] = Math.max(0, co.inv[j] - a * S.N * dt);
			hoursD += sp.upkeepWork * S.N * dt;
		}
	}
	if (true) {
		// the City's value to the output rule: its rent income
		const co = c[CITY];
		co.outValEma += ea * ((B.rentR > 0 ? 0 : 0) - 0);
	}
	S.hoursD = hoursD;
	// CPI: the basic bundle in R a day (under quotas: the yearly melt on the stock that grants it, a day)
	for (let g = 0; g < 4; g++) cpi += BASIC[g] * (mech === 'a' ? (T[g].pi * RATE) / 365 : T[g].pi);
	if (isFinite(cpi)) (B.cpiSum += cpi), B.cpiN++;
}

function payWages(S, dt, B) {
	const c = S.c, N = S.N;
	let supply = 0;
	for (let i = 0; i < N; i++) supply += S.workH[i] * dt;
	const demandH = S.hoursD || 0;
	if (supply <= 0 || demandH <= 0) return;
	const eD = Math.min(1, supply / demandH);
	const wageM = new Float64Array(M);
	let totR = 0;
	for (let k = 0; k < M; k++) {
		const co = c[k], sp = SPECS[k];
		if (!co.active || !(S.P[k] > 0)) continue;
		const h = (sp.work * (co.made || 0) * dt + (sp.upkeepWork ? sp.upkeepWork * N * dt : 0)) * eD;
		const due = (h * S.sc.wageR) / S.P[k];
		const paid = Math.min(due, co.tre[k]);
		co.tre[k] -= paid;
		wageM[k] = paid;
		totR += paid * S.P[k];
	}
	B.wagesR += totR;
	for (let i = 0; i < N; i++) {
		const w = (S.workH[i] * dt) / supply;
		if (w <= 0) continue;
		const b = i * M;
		for (let k = 0; k < M; k++) if (wageM[k] > 0) (S.hold[b + k] += wageM[k] * w), (S.inc[i] += wageM[k] * w * S.P[k]);
	}
	// the founder ring's COOP pays its whole treasury out to the ring as "community rewards"
	const j = c[JUNK];
	if (j.active && j.tre[JUNK] > 0) {
		const ring = [];
		for (let i = 0; i < N; i++) if (S.ring[i]) ring.push(i);
		const pay = j.tre[JUNK] * 0.9;
		j.tre[JUNK] -= pay;
		for (const i of ring) (S.hold[i * M + JUNK] += pay / ring.length), (S.inc[i] += (pay / ring.length) * S.P[JUNK]);
	}
}

function capacity(S, dt) {
	for (let k = 0; k < M; k++) {
		const co = S.c[k], sp = SPECS[k];
		if (!co.active || sp.product < 0) continue;
		if (sp.capital.length) {
			let conv = Infinity;
			for (const [j, c] of sp.capital) conv = Math.min(conv, co.capInv[j] / c);
			if (sp.lumpy && co.K <= 0) {
				if (conv >= co.module * 0.999) {
					for (const [j, c] of sp.capital) co.capInv[j] -= co.module * c;
					co.K = co.module;
					co.builtAt = S.t;
				}
			} else if (conv > 0 && isFinite(conv)) {
				co.K += conv;
				for (const [j, c] of sp.capital) co.capInv[j] -= conv * c;
			}
		}
		co.K *= Math.exp((-sp.dep * dt) / 365);
		if (sp.land > 0 && co.land > sp.land * co.K * 1.1 && !(sp.lumpy && co.K <= 0)) co.land = Math.max(sp.land * co.K * 1.05, co.land * (1 - 0.01 * dt));
	}
}

function deposits(S, dt) {
	// inflows enter in daily slices, arbitrage between them
	const nSub = Math.max(1, Math.round(dt));
	for (let sub = 0; sub < nSub; sub++) {
		for (let k = 0; k < M; k++) {
			const co = S.c[k];
			if (!co.active || !(co.poolDue > 0) || !co.baskets.length) continue;
			const each = co.poolDue / (nSub - sub) / co.baskets.length;
			for (const pi of co.baskets) {
				const p = S.pools[pi];
				p.x[p.pos[k]] += each;
				p.depR[p.pos[k]] += each * S.P[k];
			}
			co.poolDue -= each * co.baskets.length;
		}
		if (nSub > 1 && sub < nSub - 1) arbitrage(S);
	}
}

function adjust(S, dt) {
	const mech = S.sc.mech, c = S.c, P = S.P;
	const st = Math.min(dt, 7);
	if (mech !== 'a') {
		for (let s = 0; s < M; s++) {
			const co = c[s], sp = SPECS[s];
			if (!co.active || sp.product < 0) continue;
			const z = co.zNow || 0;
			const step = Math.max(-0.25, Math.min(0.25, 0.05 * st * (z - 0.95)));
			co.priceR *= Math.exp(step);
			// never below the variable cost of inputs, wages and ground rent (under burning too: it keeps the treasury's MIND scarce)
			// and never above twice the full cost (wear plus a 10 %/yr return on capacity): a sold-out COOP rations instead
			co.priceR = Math.min(co.priceR, PRICE_CAP * fullCostR(S, s));
			co.priceR = Math.max(co.priceR, varCostR(S, s));
			co.priceR = Math.max(co.priceR, 1e-12);
			co.price = co.priceR / Math.max(1e-9, S.Ptw[s]);
		}
	}
	// ground rent: the City raises it while land is short and lowers it while land lies empty (floor 0.0001 R/m² a day)
	let leased = 0;
	for (let k = 0; k < M; k++) if (c[k].active) leased += c[k].land;
	const occ = (leased + S.leaseUnmet) / S.landLeasable;
	S.rho *= Math.exp(Math.max(-0.1, Math.min(0.1, 0.03 * st * (occ - 0.9) * 10)));
	if (P[CITY] > 0) S.rho = Math.max(S.rho, 0.0001 / P[CITY]);
	S.occ = occ;
}

/** variable cost of a unit in R: inputs, wages, ground rent (and, for the City, nothing for its own land) */
function varCostR(S, k) {
	const sp = SPECS[k], co = S.c[k];
	let cost = sp.work * S.sc.wageR + (k === CITY ? 0 : (sp.land * S.rho * S.P[CITY]) / Math.max(0.05, co.prodF));
	for (const [j, a] of sp.inputs) cost += a * unitR(S, j);
	return cost;
}
/** full cost of a unit in R: variable cost plus wear and a 10 %/yr return on the capacity it uses */
function fullCostR(S, k) {
	const sp = SPECS[k], co = S.c[k];
	const u = Math.max(0.5, Math.min(1, co.Keff > 0 ? (co.made || 0) / co.Keff : 1));
	return varCostR(S, k) + (capCostR(S, k) * (sp.dep + 0.1)) / 365 / u;
}
/** what a unit of capacity costs to build, in R */
function capCostR(S, k) {
	let cost = 0;
	for (const [j, c] of SPECS[k].capital) cost += c * unitR(S, j);
	return cost;
}

function unitR(S, j) {
	let best = Infinity;
	for (let k = 0; k < M; k++) {
		const co = S.c[k];
		if (co.active && SPECS[k].product === j && co.Keff > 0) best = Math.min(best, co.priceR);
	}
	return isFinite(best) ? best : 0;
}

/** quotas under (a): each MIND held entitles its holder to K / (MIND held by its users) units a day */
function quotas(S) {
	const c = S.c, N = S.N;
	const H = new Float64Array(M);
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) H[k] += S.hold[i * M + k];
	for (let j = 0; j < M; j++) if (c[j].active) for (let k = 0; k < M; k++) if (k !== j) H[k] += c[j].tre[k];
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active || SPECS[k].product < 0) continue;
		co.Keff = effCap(S, k);
		// what it can actually deliver this week: capacity, limited by the inputs it has in stock
		let Y = co.Keff;
		for (const [j, a] of SPECS[k].inputs) if (a > 0) Y = Math.min(Y, co.inv[j] / a / 7);
		Y = Math.max(Y, co.Keff * 0.01);
		co.q = H[k] > 1e-9 ? Y / H[k] : Y;
	}
}

function updateAlloc(S, dt) {
	const c = S.c, N = S.N, rule = S.sc.avenRule;
	const score = new Float64Array(M);
	let any = false;
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active || !S.live[k] || k === JUNK && !S.live[k]) continue;
		let s;
		if (rule === 'output') s = co.heartsEma > 0 ? (co.outValEma + (k === CITY ? co.rentEma || 0 : 0)) / co.heartsEma : 0;
		else s = S.Ptw[k] * (1 - S.routeCostEma * (1 - S.spendShare[k]));
		if (co.failed) s *= 0.2;
		score[k] = Math.max(0, s);
		if (s > 0) any = true;
	}
	const idx = [...score.keys()].filter((k) => score[k] > 0).sort((a, b) => score[b] - score[a]).slice(0, 6);
	const w = new Float64Array(M);
	if (idx.length) {
		const top = score[idx[0]];
		let sum = 0;
		for (const k of idx) (w[k] = Math.pow(score[k] / top, 10)), (sum += w[k]);
		for (const k of idx) w[k] /= sum;
	}
	const rate = Math.min(1, 0.1 * dt);
	for (let i = 0; i < N; i++) {
		const b = i * M;
		if (S.ring[i]) {
			for (let k = 0; k < M; k++) S.alloc[b + k] = k === JUNK ? 1 : 0;
			continue;
		}
		for (let k = 0; k < M; k++) {
			const tg = any ? 0.25 * S.values[b + k] + 0.75 * w[k] : S.values[b + k];
			S.alloc[b + k] += rate * ((c[k].active ? tg : 0) - S.alloc[b + k]);
		}
	}
	// people's income, smoothed
	const ea = Math.min(1, dt / 30);
	for (let i = 0; i < N; i++) S.ybar[i] += ea * (S.inc[i] / dt - S.ybar[i]);
}

function step(S, dt) {
	const B = S.cur;
	if (S.sc.popGrowth) grow(S, dt);
	meltAll(S, Math.exp((-RATE * dt) / 365));
	invest(S, dt);
	for (let k = 0; k < M; k++) if (S.c[k].active) S.c[k].Keff = effCap(S, k);
	if (S.sc.mech === 'a') quotas(S);
	let T = sellerTable(S);
	plan(S, dt, T);
	T = sellerTable(S);
	const r0 = B.routeIn, c0 = B.routeCost;
	trade(S, dt, T, B);
	if (B.routeIn > r0) S.routeCostEma += Math.min(1, dt / 30) * ((B.routeCost - c0) / (B.routeIn - r0) - S.routeCostEma);
	payRent(S, dt, B);
	deliver(S, dt, T, B);
	payWages(S, dt, B);
	payOut(S, dt, B);
	eligible(S, dt, B);
	capTreasuries(S, B);
	capacity(S, dt);
	deposits(S, dt);
	arbitrage(S);
	updatePrices(S, dt);
	adjust(S, dt);
	const rentNow = B.rentR;
	S.c[CITY].rentEma = (S.c[CITY].rentEma || 0) + Math.min(1, dt / 90) * ((rentNow - (S._rentPrev || 0)) / dt - (S.c[CITY].rentEma || 0));
	S._rentPrev = rentNow;
	updateAlloc(S, dt);
	B.steps++;
	B.days += dt;
	S.t += dt;
	if (Math.floor(S.t / 365) > S.Y.length) closeYear(S);
}

// ── yearly snapshot ──────────────────────────────────────────────────────────────────────────────────────────────────
function moneySplit(S) {
	const N = S.N, P = S.P, c = S.c;
	const o = { wal: 0, treOwn: 0, treOther: 0, pool: 0, arb: 0, walR: 0, treR: 0, poolR: 0, arbR: 0 };
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) (o.wal += S.hold[i * M + k]), (o.walR += S.hold[i * M + k] * P[k]);
	for (let j = 0; j < M; j++) {
		if (!c[j].active && !c[j].failed) continue;
		for (let k = 0; k < M; k++) {
			if (k === j) o.treOwn += c[j].tre[k];
			else o.treOther += c[j].tre[k];
			o.treR += c[j].tre[k] * P[k];
		}
		o.treOwn += c[j].poolDue;
	}
	for (const p of S.pools) for (let i = 0; i < p.m.length; i++) (o.pool += p.x[i]), (o.poolR += p.x[i] * P[p.m[i]]);
	for (let k = 0; k < M; k++) (o.arb += S.arb[k]), (o.arbR += S.arb[k] * P[k]);
	o.total = o.wal + o.treOwn + o.treOther + o.pool + o.arb;
	o.totalR = o.walR + o.treR + o.poolR + o.arbR;
	return o;
}

function closeYear(S) {
	const B = S.cur, N = S.N, P = S.P, c = S.c;
	const W = new Float64Array(N), C = new Float64Array(N);
	for (let i = 0; i < N; i++) {
		let w = 0;
		for (let k = 0; k < M; k++) w += S.hold[i * M + k] * P[k];
		W[i] = w;
		let cv = 0;
		for (let g = 0; g < NHH; g++) cv += S.cons[i * NHH + g] / SAT[g];
		C[i] = cv;
	}
	const split = moneySplit(S);
	// conservation: everything ever issued is held somewhere, melted or burned
	const leak = (split.total - (S.tot.issued - S.tot.melted - S.tot.burned)) / Math.max(1, S.tot.issued);
	if (Math.abs(leak) > 1e-6) throw new Error(`MIND not conserved in year ${S.Y.length + 1}: ${leak}`);
	const cover = {}, Kd = {};
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active) continue;
		cover[NAMES[k]] = co.costEma > 0 ? valueOf(S, co.tre) / co.costEma : null;
		Kd[NAMES[k]] = { K: co.K, made: co.made, z: co.zEma };
	}
	let meanW = 0;
	for (let i = 0; i < N; i++) meanW += W[i];
	meanW /= N;
	// dividend yield of each MIND this year (dividends paid ÷ average eligible holdings)
	const yk = new Float64Array(M);
	let divAll = 0, eligAll = 0;
	for (let k = 0; k < M; k++) {
		if (B.eligK[k] > 0) yk[k] = B.divK[k] / (B.eligK[k] / B.days);
		divAll += B.divK[k] * P[k];
		eligAll += (B.eligK[k] / Math.max(1, B.days)) * P[k];
	}
	// people's yearly returns on what they held at the start of the year (price change plus dividends, before the
	// melt): Proposition 2's μ (mean) and σ (spread across people)
	let sigma = null, muRet = null, muPrice = null;
	if (S.prevHold && S.prevN === N) {
		const lr = [], lp = [];
		for (let i = 0; i < N; i++) {
			let a = 0, b = 0, d = 0;
			for (let k = 0; k < M; k++) {
				const h = S.prevHold[i * M + k];
				a += h * S.prevP[k];
				b += h * P[k];
				d += h * P[k] * yk[k];
			}
			if (a > 0 && b > 0 && isFinite(d)) lr.push(Math.log((b + d) / a)), lp.push(Math.log(b / a));
		}
		if (lr.length > 10) {
			const mu = lr.reduce((x, y) => x + y, 0) / lr.length;
			muRet = mu;
			muPrice = lp.reduce((x, y) => x + y, 0) / lp.length;
			sigma = Math.sqrt(lr.reduce((x, y) => x + (y - mu) * (y - mu), 0) / (lr.length - 1));
		}
	}
	// workers (who offer hours) against people who do not work
	let wW = 0, nW = 0, wO = 0, nO = 0;
	for (let i = 0; i < N; i++) if (S.workH[i] > 0) (wW += W[i]), nW++;
		else (wO += W[i]), nO++;
	S.prevHold = S.hold.slice(0, N * M);
	S.prevP = Float64Array.from(P);
	S.prevN = N;
	let ringY = null, ringW = null;
	if (S.c[JUNK].active) {
		let a = 0, na = 0, b = 0, nb = 0, wa = 0, wb = 0;
		for (let i = 0; i < N; i++) if (S.ring[i]) (a += S.ybar[i]), (wa += W[i]), na++;
			else (b += S.ybar[i]), (wb += W[i]), nb++;
		ringY = na && nb ? a / na / (b / nb) : null;
		ringW = na && nb && wb > 0 ? wa / na / (wb / nb) : null;
	}
	const poolMem = S.pools.map((p) => ({ m: p.m.slice(), v: Array.from(p.x).map((x, i) => x * P[p.m[i]]) }));
	S.Y.push({
		year: S.Y.length + 1, N, t: S.t,
		short: B.pd > 0 ? B.sAny / B.pd : 0, shortG: B.sg.map((x) => (B.pd > 0 ? x / B.pd : 0)),
		newShort: B.newPd > 0 ? B.newS / B.newPd : null,
		cons: Array.from(B.cons).map((x) => x / Math.max(1, B.pd)),
		route: B.routeIn > 0 ? B.routeCost / B.routeIn : null, routeFee: B.routeIn > 0 ? B.routeFee / B.routeIn : null,
		hops: B.routeIn > 0 ? B.hopsIn / B.routeIn : null, routeShare: B.payR > 0 ? B.routeIn / B.payR : null,
		P: Array.from(P), cpi: B.cpiN ? B.cpiSum / B.cpiN : null, split, mPer: split.total / N,
		gini: gini(W, N), giniC: gini(C, N), meanW, cover, Kd, insolv: Array.from(B.insolv),
		arbR: B.arbR, hearts: Array.from(B.hearts), burned: B.burned, retired: B.retired, issued: B.issued, rho: S.rho * P[CITY], occ: S.occ,
		rentR: B.rentR, wagesR: B.wagesR, divR: B.divR, payR: B.payR, pFail: B.pFail, prices: c.map((co) => co.price), q: c.map((co) => co.q),
		sigma, muRet, muPrice, ringY, ringW, poolMem, yield: eligAll > 0 ? divAll / eligAll : 0, propR: B.propR, treInR: B.treInR,
		workRatio: nW && nO && wO > 0 ? wW / nW / (wO / nO) : null, peopleShareR: split.totalR > 0 ? split.walR / split.totalR : null,
		yk: Array.from(yk), flows: { heartIn: B.heartInR, salesHH: B.salesHHR, b2b: B.b2bR, rent: B.rentR, wages: B.wagesR, prop: B.propR, div: B.divR }
	});
	S.cur = newBucket();
}

// ── scenarios ────────────────────────────────────────────────────────────────────────────────────────────────────────
const N0 = QUICK ? 120 : 250;
const BASE = { N0, seed: 20261012, seedCap: 1.15, mech: 'b', turnDiv: 0.2, payout: 12, divShare: 0, wageR: WAGE_R, capDays: 60, arbTo: 'bot', avenRule: 'price', popGrowth: 0, years: 60 };
const DAILY_YEARS = 1;
const DAILY_AFTER = 90; // days of daily steps after a shock

/** run until a day, daily for the first year and for 90 days after a shock, weekly in between */
function advance(S, until, dailyFrom = -1e9) {
	while (S.t < until - 1e-9) {
		const daily = S.t < DAILY_YEARS * 365 || (S.t >= dailyFrom && S.t < dailyFrom + DAILY_AFTER);
		const dt = daily ? 1 : Math.min(7, until - S.t);
		step(S, dt);
	}
}

const clone = (S) => structuredClone(S);

function branchFailure(S, commons) {
	// the food COOP that makes most of the city's food fails: its plant breaks down and its management turns
	// extractive, so it delivers a tenth of what it could
	const k = S.c[GREEN].made >= S.c[AGRI].made ? GREEN : AGRI;
	const a = S.c[k];
	a.prodF = 0.1;
	a.failed = true;
	S.failK = k;
	S.failAt = S.t;
	S.commons = commons;
	SPECS[AGRIB] = { ...SPECS[k], id: `${NAMES[k]}-B` }; // the successor runs the same plant
	NAMES[AGRIB] = SPECS[AGRIB].id;
}

function checkFailure(S) {
	// the protocol detects the failure after 30 days; under the City rule its plant and land go to the City COOP, which
	// leases them to a new COOP (same technology) for an asset fee, with 180 days' grace on fee and ground rent; the
	// failed COOP keeps only its treasury and its MIND
	if (!S.commons || S.c[AGRIB].active || S.t < S.failAt + 30) return;
	const fk = S.failK, a = S.c[fk], b = S.c[AGRIB];
	b.active = true;
	b.K = a.K;
	b.land = a.land;
	b.capInv = a.capInv.slice();
	b.inv = a.inv.slice();
	b.reqEma = a.reqEma;
	b.zEma = 1;
	b.priceR = a.priceR;
	b.price = a.price;
	b.graceUntil = S.t + 180;
	b.leaseFee = S.P[CITY] > 0 ? (capCostR(S, fk) * a.K * 0.06) / 365 / S.P[CITY] : 0; // 6 %/yr of the plant's value, in CITYmind
	a.K = 0;
	a.land = 0;
	a.capInv.fill(0);
	a.inv.fill(0);
	// the successor bootstraps with three partners in a new basket
	const partners = [CITY, SOLAR, fk === GREEN ? AGRI : GREEN];
	S.pools.push(newPool([AGRIB, ...partners]));
	b.baskets.push(S.pools.length - 1);
	for (const k of partners) S.c[k].baskets.push(S.pools.length - 1);
	buildGraph(S);
	for (let i = 0; i < S.N; i++) (S.values[i * M + AGRIB] = S.values[i * M + fk]), (S.values[i * M + fk] = 0);
}

function branchFounder(S) {
	const j = S.c[JUNK];
	j.active = true;
	for (let i = 0; i < 4; i++) S.ring[i] = 1;
	S.pools.push(newPool([JUNK, PANEL, BUILD, GOODSC]));
	j.baskets.push(S.pools.length - 1);
	for (const k of [PANEL, BUILD, GOODSC]) S.c[k].baskets.push(S.pools.length - 1);
	buildGraph(S);
	S.P[JUNK] = 1;
	S.Ptw[JUNK] = 1;
}

function branchGeo(S) {
	const g = S.c[GEO];
	g.active = true;
	let e = 0;
	for (let k = 0; k < M; k++) if (S.c[k].active && SPECS[k].product === ENERGY) e += S.c[k].made;
	g.module = 0.15 * e; // a plant for 15 % of the city's energy, built in one piece, for 80 years
	g.startAt = S.t;
	S.pools.push(newPool([GEO, SOLAR, AGRI, CITY]));
	g.baskets.push(S.pools.length - 1);
	for (const k of [SOLAR, AGRI, CITY]) S.c[k].baskets.push(S.pools.length - 1);
	buildGraph(S);
	for (let i = 0; i < S.N; i++) {
		S.values[i * M + GEO] = 0.02;
		for (let k = 0; k < M; k++) S.values[i * M + k] /= 1.02;
	}
}

function branchInequality(S) {
	// keep the total of what people hold, make it as unequal as Germany's wealth (lognormal, Gini 0.72)
	const N = S.N, sl = Math.SQRT2 * 1.0803;
	const z = Array.from({ length: N }, () => Math.exp(sl * gauss(S)));
	const zs = z.reduce((a, b) => a + b, 0);
	const tot = new Float64Array(M);
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) tot[k] += S.hold[i * M + k];
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) S.hold[i * M + k] = (tot[k] * z[i]) / zs;
	const W = new Float64Array(N);
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) W[i] += S.hold[i * M + k] * S.P[k];
	S.gini0 = gini(W, N);
	S.m0 = W.reduce((a, b) => a + b, 0) / N;
}

function runFrom(S, years, opts = {}) {
	const until = S.t + years * 365;
	const from = S.t;
	while (S.t < until - 1e-9) {
		advance(S, Math.min(until, S.t + 30), from);
		if (opts.onMonth) opts.onMonth(S);
	}
	return S;
}

// ── debug: one run, a line a year ────────────────────────────────────────────────────────────────────────────────────
if (ARGS.includes('--debug')) {
	const mech = ARGS[ARGS.indexOf('--debug') + 1] || 'd';
	const yrs = +(ARGS[ARGS.indexOf('--debug') + 2] || 10);
	const extra = ARGS.includes('--empty') ? { seedCap: +ARGS[ARGS.indexOf('--empty') + 1] || 0.25 } : ARGS.includes('--grow') ? { popGrowth: 0.02, years: yrs } : {};
	if (ARGS.includes('--set')) for (const kv of ARGS[ARGS.indexOf('--set') + 1].split(',')) extra[kv.split('=')[0]] = +kv.split('=')[1];
	const S = init({ ...BASE, mech, years: yrs, ...extra });
	const d1 = Date.now();
	advance(S, yrs * 365);
	const r2 = (x) => (x === null || x === undefined ? '-' : Math.round(x * 100) / 100);
	console.log('day1', S.first.d1, 'd30', S.first.d30, 'route y1', S.first.routeCost / S.first.routeIn);
	for (const y of S.Y) {
		console.log(`   people hold ${r2((y.peopleShareR || 0) * 100)}% of MIND value, yield ${r2(y.yield * 100)}% mu ${r2((y.muRet ?? 0) * 100)}% sigma ${r2((y.sigma ?? 0) * 100)}% div/person ${Math.round(y.divR / y.N)} work/person ${Math.round(y.propR / y.N)} wages/person ${Math.round(y.wagesR / y.N)} treIn/person ${Math.round(y.treInR / y.N)} workers/others ${r2(y.workRatio)}`);
		console.log(`y${y.year} N${y.N} short ${r2(y.short * 100)}% [${y.shortG.map((x) => r2(x * 100)).join(' ')}] new ${r2(y.newShort)} cons ${y.cons.map((x) => r2(x)).join(' ')} route ${r2((y.route || 0) * 100)}% hops ${r2(y.hops)} cpi ${r2(y.cpi)} m ${Math.round(y.mPer)} wal ${Math.round(y.split.wal / y.N)} tre ${Math.round((y.split.treOwn + y.split.treOther) / y.N)} pool ${Math.round(y.split.pool / y.N)} arb ${Math.round(y.split.arb / y.N)} burn ${Math.round(y.burned / y.N)} gini ${r2(y.gini)} meanW ${Math.round(y.meanW)} rho ${y.rho.toExponential(2)} occ ${r2(y.occ)}`);
		console.log('   P', y.P.slice(0, BASE_COOPS).map(r2).join(' '), '| z', Object.values(y.Kd).map((v) => r2(v.z)).join(' '), '| cover', Object.values(y.cover).map((v) => Math.round(v)).join(' '), '| insolv', y.insolv.slice(0, BASE_COOPS).map(Math.round).join(' '), '| price', y.prices.slice(0, BASE_COOPS).map((p) => p.toPrecision(2)).join(' '));
	}
	console.log('time', (Date.now() - d1) / 1000, 's');
	process.exit(0);
}

// ── formatting helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const f = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '–' : Number(x).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (x, d = 1) => (x === null || x === undefined || !isFinite(x) ? '–' : `${f(x * 100, d)} %`);
const avg = (S, a, b, fn) => {
	const ys = S.Y.filter((y) => y.year > a && y.year <= b);
	const v = ys.map(fn).filter((x) => x !== null && isFinite(x));
	return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const at = (S, y) => S.Y[Math.min(S.Y.length, y) - 1];

// ── run everything ───────────────────────────────────────────────────────────────────────────────────────────────────
const YRS = QUICK ? 20 : 60;
const BR = QUICK ? 10 : 30; // branch year
const LAD_END = BR + (QUICK ? 10 : 20); // the fairness ladder runs to here (Germany-unequal holdings from year BR)
const results = {};
const csvRows = [];
// the main scenario and the side comparisons
const RUNS = {
	main: { mech: 'b', label: 'Main: pay → 20 % to holders, the rest to the seller\'s treasury → paid out for work' },
	hoard: { mech: 'b', payout: 0, label: 'Same, but treasuries keep their surplus' },
	retire: { mech: 'd', label: 'Side: treasury surplus retired, not paid out' },
	quota: { mech: 'a', label: 'Side: hold to use (rejected)' }
};
// the fairness ladder: how treasuries pay out their surplus, and how high prices are against the MIND stock
const LADDER = [
	['hoard', 'no dividend, surplus kept', { turnDiv: 0, payout: 0 }],
	['work', 'no dividend, surplus for work proposals', { turnDiv: 0 }],
	['half', 'no Law 5: surplus half as dividends, half for work', { turnDiv: 0, divShare: 0.5 }],
	['turn10', 'Law 5 at 10 % of every sale', { turnDiv: 0.1 }],
	['main', 'Law 5 at 20 % of every sale (main)', {}],
	['turn30', 'Law 5 at 30 % of every sale', { turnDiv: 0.3 }],
	['keep', 'Law 5 at 20 %, surplus kept (no work proposals)', { payout: 0 }],
	['main-w5', 'main, prices ×2.5 (wage 5 R/h)', { wageR: 5 }],
	['allwork', 'main, but everyone offers some work', { allWork: true }],
	['retire', 'surplus retired (side)', { mech: 'd', turnDiv: 0 }]
];

/** the R value of the partners' reserves in every pool that holds MIND k, at the end of a year */
function partnerValue(S, year, k) {
	const y = at(S, year);
	if (!y) return null;
	let v = 0;
	for (const p of y.poolMem) if (p.m.includes(k)) p.m.forEach((m, i) => m !== k && (v += p.v[i]));
	return v / y.N;
}

function giniRest(a) {
	const lg = (z) => {
		const L = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
		if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lg(1 - z);
		z -= 1;
		let x = 0.99999999999980993;
		for (let i = 0; i < 8; i++) x += L[i] / (z + i + 1);
		const t = z + 7.5;
		return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
	};
	return a <= 1 ? 1 : Math.exp(lg(a - 0.5) - lg(a)) / Math.sqrt(Math.PI);
}

/** Proposition 2 from a run's own μ (mean yearly return: price change plus dividends) and σ (its spread across people) */
function prop2(S, a, b) {
	const sg = avg(S, a, b, (y) => y.sigma), mu = avg(S, a, b, (y) => y.muRet);
	if (sg === null || mu === null) return { sg, mu, alpha: null, g: null };
	const alpha = 1 + (2 * (RATE - mu)) / (sg * sg);
	return { sg, mu, alpha, g: giniRest(alpha) };
}

function measure(name, S) {
	const [, kind] = name.split(':');
	if (kind && kind.startsWith('founder')) {
		const r = S.Y.filter((y) => y.year > BR && y.ringY !== null).map((y) => y.ringY);
		S.ringRatio = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
		const jp = S.pools.find((p) => p.m.includes(JUNK));
		let dep = 0, left = 0;
		jp.m.forEach((k, i) => k !== JUNK && ((dep += jp.depR[i]), (left += jp.x[i] * S.P[k])));
		S.partnerLoss = (dep - left) / S.N; // partner MIND that left JUNK's pool, in exchange for JUNKmind
		S.partnerDep = dep / S.N;
	}
}

function record(name, S) {
	results[name] = S;
	measure(name, S);
	if (CSV) for (const y of S.Y) csvRows.push([name, y.year, y.N, y.short, y.newShort ?? '', y.route ?? '', y.cpi ?? '', y.mPer, y.split.wal / y.N, (y.split.treOwn + y.split.treOther) / y.N, y.split.pool / y.N, y.peopleShareR ?? '', y.gini, y.yield, y.muRet ?? '', y.sigma ?? '', y.divR / y.N, y.propR / y.N, ...y.P.slice(0, BASE_COOPS)].join(','));
}

const tick = (what) => process.stderr.write(`  ran ${what} (${((Date.now() - T0) / 1000).toFixed(1)} s)\n`);

// main scenario: 60 years, shocks branched off in year BR
{
	const S = init({ ...BASE, years: YRS });
	advance(S, BR * 365);
	const snap = clone(S);
	advance(S, YRS * 365);
	record('main:base', S);
	const bf = (fn, years, name, extra = {}) => {
		const X = clone(snap);
		X.sc = { ...X.sc, ...extra };
		fn(X);
		runFrom(X, years, { onMonth: checkFailure });
		record(`main:${name}`, X);
	};
	bf((X) => branchFailure(X, true), 10, 'fail-city');
	bf((X) => branchFailure(X, false), 10, 'fail-none');
	bf(branchFounder, 10, 'founder');
	bf(branchFounder, 10, 'founder-output', { avenRule: 'output' });
	bf(branchInequality, 20, 'gini');
	bf(branchGeo, 20, 'geo');
	const E = init({ ...BASE, seedCap: 0.25, years: 25 });
	advance(E, (QUICK ? 10 : 25) * 365);
	record('main:empty', E);
	tick('main scenario and its shocks');
}
// side comparisons: 60 years each, and population growth
for (const key of ['hoard', 'retire', 'quota']) {
	const S = init({ ...BASE, ...RUNS[key], years: YRS });
	advance(S, YRS * 365);
	record(`${key}:base`, S);
}
for (const key of ['main', 'retire', 'quota']) {
	const G = init({ ...BASE, ...RUNS[key], popGrowth: 0.02, years: QUICK ? 15 : 40 });
	advance(G, (QUICK ? 15 : 40) * 365);
	record(`${key}:grow`, G);
}
tick('side comparisons and population growth');
// the fairness ladder: steady state over the 10 years before BR, then holdings made as unequal as Germany's
for (const [key, , extra] of LADDER) {
	const S = init({ ...BASE, ...extra, years: LAD_END });
	advance(S, BR * 365);
	branchInequality(S);
	advance(S, LAD_END * 365, BR * 365);
	record(`lad:${key}`, S);
}
tick('fairness ladder');

// ── report ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const out = [];
const P = (...l) => out.push(l.join(''));
const table = (head, rows) => {
	P('| ', head.join(' | '), ' |');
	P('|', head.map((_, i) => (i ? ' ---: ' : ' --- ')).join('|'), '|');
	for (const r of rows) P('| ', r.join(' | '), ' |');
	P('');
};
const ssA = YRS - 10, ssB = YRS;
const lA = BR - 10, lB = BR; // the ladder's steady state
const hoursYear = (S) => {
	let h = 0;
	for (let i = 0; i < S.N; i++) h += S.workH[i];
	return h * 365;
};

P(`# theOS end-to-end simulation — tables`);
P('');
P(`${N0} people, ${BASE_COOPS} COOPs (+3 in some shocks), seed ${BASE.seed}. Daily steps in the first year and for ${DAILY_AFTER} days after each shock (year ${BR}); weekly steps (traded as daily batches) otherwise. Steady state = years ${ssA + 1}–${ssB}. R = the geometric mean of the SOLAR-, HABITAT- and CITYmind prices.`);
P('');
const S0 = results['main:base'];
P(`Land: ${f(S0.landTotal / N0)} m² a person (${f(S0.landLeasable / N0)} leasable, the rest streets and parks), all of it the City COOP's. Seed capacities: 115 % of the starting need (goods exist, money does not) or 25 % (empty city).`);
P('');
P('Main scenario: a person pays for what a COOP makes in that COOP\'s MIND (the Aven pays with any MIND, the pools convert it, the seller receives only its own MIND, into its treasury). A tenth of the treasury half of each HEART (5 % of the HEART) goes to the pools; sales are not levied. A treasury pays for inputs and building from other COOPs, for operating work (2 R an hour, in its prices) and ground rent; Law 5: 20 % of every sale goes at once, as a dividend in the seller\'s own MIND, to everyone who holds that MIND (people and other treasuries, pro rata; not the seller, not the pools); the rest lands in the treasury. What a treasury holds of its own MIND above 60 days of running costs and planned building it pays out within about a month for accepted work proposals (to the people who offer work, by hours). No rent payout, no basic income.');
P('');

P('## 1. Main scenario against the side comparisons (60 years from a cold start with goods)');
P('');
const KEYS = ['main', 'hoard', 'retire', 'quota'];
const rows1 = [];
const metric = (label, fn) => rows1.push([label, ...KEYS.map((k) => fn(results[`${k}:base`], k))]);
metric('Basic-need shortfall, day 1', (S) => pct(S.first.d1.s / S.first.d1.pd));
metric('Basic-need shortfall, days 1–30', (S) => pct(S.first.d30.s / S.first.d30.pd));
metric('Basic-need shortfall, year 1', (S) => pct(at(S, 1).short));
metric('Basic-need shortfall, steady state', (S) => pct(avg(S, ssA, ssB, (y) => y.short), 2));
metric('Food / energy / housing a day, steady state', (S) => `${f(avg(S, ssA, ssB, (y) => y.cons[0]))} kcal / ${f(avg(S, ssA, ssB, (y) => y.cons[1]), 1)} kWh / ${f(avg(S, ssA, ssB, (y) => y.cons[2]))} m²`);
metric('Routing cost of a payment, year 1', (S) => pct(S.first.routeCost / Math.max(1e-9, S.first.routeIn), 2));
metric('Routing cost, steady state (of it fees)', (S) => `${pct(avg(S, ssA, ssB, (y) => y.route), 2)} (${pct(avg(S, ssA, ssB, (y) => y.routeFee), 2)})`);
metric('Average hops a payment', (S) => f(avg(S, ssA, ssB, (y) => y.hops), 2));
metric(`MIND count a person (paper u/r = ${f(M_STAR)})`, (S) => `${f(avg(S, ssA, ssB, (y) => y.mPer))} (${pct(avg(S, ssA, ssB, (y) => y.mPer) / M_STAR, 0)})`);
metric('… in wallets / treasuries / pools', (S) => `${pct(avg(S, ssA, ssB, (y) => y.split.wal / y.split.total), 0)} / ${pct(avg(S, ssA, ssB, (y) => (y.split.treOwn + y.split.treOther) / y.split.total), 0)} / ${pct(avg(S, ssA, ssB, (y) => y.split.pool / y.split.total), 0)}`);
metric('… with the arbitrage bot', (S) => pct(avg(S, ssA, ssB, (y) => y.split.arb / y.split.total), 1));
metric('People\'s share of all MIND (by value)', (S) => pct(avg(S, ssA, ssB, (y) => y.peopleShareR), 0));
metric(`Mean a person holds, R (paper W* = ${f(W_STAR)})`, (S) => f(avg(S, ssA, ssB, (y) => y.meanW)));
metric('Gini of what people hold', (S) => f(avg(S, ssA, ssB, (y) => y.gini), 2));
metric('Workers\' mean holding ÷ non-workers\'', (S) => f(avg(S, ssA, ssB, (y) => y.workRatio), 1));
metric('Gini of consumption', (S) => f(Math.max(0, avg(S, ssA, ssB, (y) => y.giniC)), 2));
metric('Dividend yield a year', (S) => pct(avg(S, ssA, ssB, (y) => y.yield), 1));
metric('Paid for work proposals, R a person a year', (S) => f(avg(S, ssA, ssB, (y) => y.propR / y.N)));
metric('Paid as dividends, R a person a year', (S) => f(avg(S, ssA, ssB, (y) => y.divR / y.N)));
metric('Burned or retired, share of issuance', (S) => pct(avg(S, ssA, ssB, (y) => y.burned / y.issued), 0));
metric('Basic bundle, R a day: year 1 / 10 / 60', (S) => `${f(at(S, 1).cpi, 2)} / ${f(at(S, 10).cpi, 2)} / ${f(at(S, YRS).cpi, 2)}`);
metric('COOP-days short of working capital (60 y)', (S) => f(S.Y.reduce((s, y) => s + y.insolv.reduce((a, b) => a + b, 0), 0)));
table(['Measure', ...KEYS.map((k) => RUNS[k].label)], rows1);
P('Under hold-to-use the "basic bundle" is the yearly melt on the MIND stock that grants a day of basic use. "Workers" are the 60 % of people who offer some hours of work; the rest (children, the old, carers) offer none.');
P('');

P('## 2. MIND prices over time, main scenario (R)');
P('');
{
	const S = results['main:base'];
	const yrs = [1, 2, 5, 10, 20, 30, 45, YRS].filter((y) => y <= S.Y.length);
	table(['COOP', ...yrs.map((y) => `y${y}`)], NAMES.slice(0, BASE_COOPS).map((n, k) => [n, ...yrs.map((y) => f(at(S, y).P[k], 2))]));
	P(`Dividend yield by MIND, years ${ssA + 1}–${ssB}: ${NAMES.slice(0, BASE_COOPS).map((n, k) => `${n} ${pct(avg(S, ssA, ssB, (y) => y.yk[k]), 1)}`).join(', ')}.`);
	P('');
}

P('## 3. Money in the main scenario: where it sits (MIND count a person) and who holds it');
P('');
{
	const S = results['main:base'];
	const yrs = [1, 2, 5, 10, 20, 30, 45, YRS].filter((y) => y <= S.Y.length);
	const an = (y) => M_STAR * (1 - Math.exp(-RATE * y));
	table(['Year', 'all money', 'paper m(t)', 'wallets', 'treasuries', 'pools', 'people\'s share (value)', 'dividend yield', 'Gini owned', 'basic bundle (R/day)'], yrs.map((y) => {
		const r = at(S, y);
		return [y, f(r.mPer), f(an(y)), f(r.split.wal / r.N), f((r.split.treOwn + r.split.treOther) / r.N), f(r.split.pool / r.N), pct(r.peopleShareR, 0), pct(r.yield, 1), f(r.gini, 2), f(r.cpi, 2)];
	}));
}

P('## 4. Treasuries in the main scenario: what comes in and where it goes (R a person a year, steady state)');
P('');
{
	const rows = KEYS.slice(0, 3).map((k) => {
		const S = results[`${k}:base`];
		const g = (fn) => avg(S, ssA, ssB, (y) => fn(y.flows) / y.N);
		const inn = g((x) => x.heartIn + x.salesHH + x.b2b + x.rent);
		const melt = avg(S, ssA, ssB, (y) => (y.split.treR * RATE) / y.N);
		return [RUNS[k].label, f(g((x) => x.heartIn)), f(g((x) => x.salesHH)), f(g((x) => x.b2b + x.rent)), f(inn), f(g((x) => x.b2b + x.rent)), f(g((x) => x.wages)), `${f(g((x) => x.prop))} (${pct(g((x) => x.prop) / inn, 0)})`, `${f(g((x) => x.div))} (${pct(g((x) => x.div) / inn, 0)})`, f(melt), f(avg(S, ssA, ssB, (y) => (y.retired || 0) / y.N))];
	});
	table(['Run', 'in: treasury half of HEARTS', 'in: sales to people', 'in: sales to COOPs and rent', 'in: total', 'out: inputs, building, rent', 'out: operating wages', 'out: work proposals (share of in)', 'out: dividends (share of in)', 'melt on treasuries', 'retired (MIND)'], rows);
	const S = results['main:base'];
	P(`Days of running costs a treasury holds (main, year ${YRS}): ${NAMES.slice(0, BASE_COOPS).map((n) => `${n} ${f(at(S, YRS).cover[n])}`).join(', ')}. Work proposals pay ${f(avg(S, ssA, ssB, (y) => y.propR) / hoursYear(S), 1)} R an hour offered, on top of the operating wage of ${WAGE_R} R an hour.`);
	P('');
}

P('## 5. Fairness: how treasuries pay out, and Proposition 2');
P('');
P(`Each run: ${BR} years from a cold start (steady state = years ${lA + 1}–${lB}); then everyone's holdings are made as unequal as Germany's wealth (Gini 0.72, same total) and the run goes on to year ${LAD_END}.`);
P('');
const ratio = (x) => (x === null || !isFinite(x) ? '–' : x > 1000 ? '> 1,000' : f(x, 1));
table(['Treasury payout', 'basic-need shortfall', 'people\'s share of all MIND', `mean holding, R (W* = ${f(W_STAR)})`, 'workers ÷ non-workers', 'Gini owned at rest', 'dividend yield', 'μ: mean return (dividends + price)', 'σ across people', 'Prop. 2 Gini', 'work pay, R an hour offered', 'work + dividends, share of treasury inflow'], LADDER.map(([key, label]) => {
	const S = results[`lad:${key}`];
	const p2 = prop2(S, lA, lB);
	const inn = avg(S, lA, lB, (y) => y.flows.heartIn + y.flows.salesHH + y.flows.b2b + y.flows.rent);
	const outp = avg(S, lA, lB, (y) => y.flows.prop + y.flows.div);
	return [label, pct(avg(S, lA, lB, (y) => y.short), 1), pct(avg(S, lA, lB, (y) => y.peopleShareR), 0), f(avg(S, lA, lB, (y) => y.meanW)), ratio(avg(S, lA, lB, (y) => y.workRatio)), f(avg(S, lA, lB, (y) => y.gini), 2), pct(avg(S, lA, lB, (y) => y.yield), 1), pct(p2.mu, 1), pct(p2.sg, 2), p2.g === null ? '–' : f(p2.g, 2), f(avg(S, lA, lB, (y) => y.propR) / hoursYear(S), 1), pct(outp / inn, 0)];
}));
table(['Treasury payout', 'μ', 'Gini at start', '+1 y', '+5 y', '+10 y', `+${LAD_END - BR} y`, 'Eq. (9), melt r: +10 / +20', 'Eq. (9) with r − μ: +10 / +20'], LADDER.map(([key, label]) => {
	const S = results[`lad:${key}`];
	const mu = prop2(S, lA, lB).mu ?? 0;
	const g0 = at(S, BR + 1) ? S.gini0 : null, m0 = S.m0, ws = avg(S, lA, lB, (y) => y.meanW);
	const eq = (t, rr) => {
		const e = Math.exp(-rr * t);
		return (g0 * e * m0) / (e * m0 + ws * (1 - e));
	};
	return [label, pct(mu, 1), f(g0, 2), f(at(S, BR + 1).gini, 2), f(at(S, BR + 5).gini, 2), f(at(S, BR + 10).gini, 2), f(at(S, LAD_END).gini, 2), `${f(eq(10, RATE), 2)} / ${f(eq(20, RATE), 2)}`, `${f(eq(10, Math.max(1e-6, RATE - mu)), 2)} / ${f(eq(20, Math.max(1e-6, RATE - mu)), 2)}`];
}));
P('Eq. (9) is the paper\'s path with no spread of returns, towards the run\'s own resting mean; the second column swaps the melt r for the net melt r − μ that a holder actually faces when dividends are paid.');
P('');

P('## 6. Scenarios on the main scenario');
P('');
P(`### 6.1 Cold start in an empty city (25 % of the needed capacity on day 1)`);
P('');
{
	const S = results['main:empty'];
	const first = S.Y.find((y) => y.short < 0.01);
	table(['shortfall y1', 'y3', 'y5', 'y10', `y${S.Y.length}`, 'first year with < 1 %', 'COOP-days short of working capital'], [[pct(at(S, 1).short), pct(at(S, 3).short), pct(at(S, 5).short), pct(at(S, 10).short), pct(at(S, S.Y.length).short), first ? first.year : 'never', f(S.Y.reduce((s, y) => s + y.insolv.reduce((a, b) => a + b, 0), 0))]]);
}

P(`### 6.2 One COOP fails (the COOP that makes most of the food delivers 10 % of its capacity from year ${BR})`);
P('');
table(['failing COOP', 'City takes the plant and leases it on?', 'food shortfall, year after', 'any shortfall, years 2–10 after', 'its MIND price before → 1 y after', 'its MIND price 10 y after'], ['fail-city', 'fail-none'].map((v) => {
	const S = results[`main:${v}`], k = S.failK;
	return [NAMES[k], v === 'fail-city' ? `yes (to ${NAMES[k]}-B, 180 days' grace on rent)` : 'no', pct(at(S, BR + 1).shortG[0]), pct(avg(S, BR + 1, BR + 10, (y) => y.short)), `${f(at(S, BR).P[k], 2)} → ${f(at(S, BR + 1).P[k], 3)}`, f(at(S, BR + 10).P[k], 3)];
}));

P(`### 6.3 A founder ring self-invests (4 people found JUNK, a COOP with no output, in year ${BR}; its treasury pays them 90 % of what it gets)`);
P('');
table(['Aven rule', 'ring income ÷ others\' income', 'ring wealth ÷ others\' wealth, y+10', 'HEARTS that went to JUNK (share of all; the ring is 1.6 %)', 'JUNKmind price y+1 / y+10', 'partner MIND drained from JUNK\'s pool (R a person, of deposited)'], ['founder', 'founder-output'].map((v) => {
	const S = results[`main:${v}`];
	const ys = S.Y.filter((y) => y.year > BR);
	const h = ys.reduce((s, y) => s + y.hearts[JUNK], 0) / ys.reduce((s, y) => s + y.issued, 0);
	return [v === 'founder' ? 'price (paper)' : 'delivered output', f(S.ringRatio, 1), f(at(S, BR + 10).ringW, 1), pct(h, 2), `${f(at(S, BR + 1).P[JUNK], 3)} / ${f(at(S, BR + 10).P[JUNK], 3)}`, `${f(S.partnerLoss, 0)} of ${f(S.partnerDep, 0)}`];
}));

P(`### 6.4 Population grows 2 %/yr from a cold start (land fixed)`);
P('');
table(['Run', 'people, last year', 'shortfall, all, y10 / last', 'shortfall, newcomers (< 3 y), y10 / last', 'ground rent R/m²·yr, last', 'land leased, last', `money a person vs u/(r+n) = ${f(U / (RATE + 0.02))}`, 'people\'s share of MIND, last', 'Gini owned, last'], ['main', 'retire', 'quota'].map((k) => {
	const S = results[`${k}:grow`];
	const L = S.Y.length;
	return [RUNS[k].label, at(S, L).N, `${pct(at(S, 10).short)} / ${pct(at(S, L).short)}`, `${pct(at(S, 10).newShort)} / ${pct(at(S, L).newShort)}`, f(at(S, L).rho * 365, 3), pct(at(S, L).occ, 0), f(at(S, L).mPer), pct(at(S, L).peopleShareR, 0), f(at(S, L).gini, 2)];
}));

P(`### 6.5 The §9.2 Gini path in the main scenario (holdings made as unequal as Germany's in year ${BR}, same total)`);
P('');
{
	const S = results['main:gini'];
	const g0 = S.gini0, m0 = S.m0, ws = avg(results['main:base'], BR + 10, BR + 20, (y) => y.meanW);
	const eq9 = (t) => {
		const e = Math.exp(-RATE * t);
		return (g0 * e * m0) / (e * m0 + ws * (1 - e));
	};
	table(['mean holding at start (R)', 'resting mean (R)', 'Gini +0', '+1 y', '+5 y', '+10 y', '+20 y', 'no shock, +20 y', 'Eq. (9) +10 y', 'Eq. (9) +20 y'], [[f(m0), f(ws), f(g0, 2), f(at(S, BR + 1).gini, 2), f(at(S, BR + 5).gini, 2), f(at(S, BR + 10).gini, 2), f(at(S, BR + 20).gini, 2), f(at(results['main:base'], BR + 20).gini, 2), f(eq9(10), 2), f(eq9(20), 2)]]);
}

P(`### 6.6 §8: a long-lived plant (GEO: 80-year life, built in one piece for 15 % of the city's energy) founded in year ${BR}`);
P('');
{
	const S = results['main:geo'];
	const ys = S.Y.filter((y) => y.year > BR);
	const h = ys.reduce((s, y) => s + y.hearts[GEO], 0) / ys.reduce((s, y) => s + y.issued, 0);
	const g = S.c[GEO];
	const built = g.builtAt !== undefined ? f((g.builtAt - g.startAt) / 365, 1) : 'not in 20 y';
	const L = at(S, BR + 20), e = (L.Kd.GEO?.made || 0) / Math.max(1e-9, (L.Kd.GEO?.made || 0) + (L.Kd.SOLAR?.made || 0));
	// what one MIND bought in year BR is worth 20 years on, dividends kept as MIND, after the melt
	const claim = (k) => {
		let n = 1;
		for (let y = BR + 1; y <= BR + 20; y++) n *= 1 + (at(S, y).yk[k] || 0);
		return (n * Math.exp(-RATE * 20) * at(S, BR + 20).P[k]) / at(S, BR + 1).P[k];
	};
	table(['HEARTS to GEO, share (20 y)', 'years until built', 'GEO share of energy +20 y', 'GEO plant left after 20 y', '1 GEOmind of year 1 after founding, worth +20 y (with dividends, after melt)', '1 SOLARmind, same', 'paper Eq. (7) factor, 20 y'], [[pct(h, 2), built, pct(e, 0), pct(Math.exp(-SPECS[GEO].dep * 20), 0), f(claim(GEO), 2), f(claim(SOLAR), 2), f(Math.exp((RATE - 0.01) * 20), 2)]]);
}

P(`_Runtime ${((Date.now() - T0) / 1000).toFixed(1)} s._`);
console.log(out.join('\n'));
if (CSV) writeFileSync(CSV, ['run,year,N,shortfall,newcomer_shortfall,routing_cost,basic_bundle_R,money_per_person,wallets_pp,treasuries_pp,pools_pp,people_share_value,gini_owned,dividend_yield,mean_return,sigma_returns,dividends_pp,work_proposals_pp,' + NAMES.slice(0, BASE_COOPS).map((n) => `P_${n}`).join(',')].concat(csvRows).join('\n') + '\n');
