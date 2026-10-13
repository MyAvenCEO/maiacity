#!/usr/bin/env node
// @ts-nocheck — plain JS, no dependencies
/**
 * theOS end to end: a small agent-based simulation of the whole economy of the paper (v6), built to test whether its
 * macro thesis and its MIND concept hold when people actually live under the rules.
 *
 * Fixed rules (the author's): only HEARTS and MINDs; 24 personal HEARTS a person a day, invest-only; 1 HEART → 1 MIND
 * of that COOP: 0.5 to the investor, 0.4 to the COOP's treasury, 0.1 to the city's liquidity pools; COOPs never hold
 * HEARTS; treasuries hold own and other MINDs as working capital; the pools are equal-weight G3M baskets of 4–8 MINDs
 * with a 0.3 % fee kept in the pool, whose LP tokens the City COOP holds (no redemptions here), and all MIND↔MIND
 * trades go through them; Law 5 pays 20 % of every sale at once to the holders of the seller's MIND; a COOP bootstraps
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
 * full cost and ration when sold out (inputs first, then households and new capacity), Aven work items are paid 2 R a
 * unit, to the human whose Aven delivers (the nominal anchor; no human labour is paid), Avens keep about a week of
 * spending in the MINDs they pay with.
 *
 *
 * The dynamic world (the main scenario since v2; the world above is kept as "static (previous main)"): COOPs set
 * their prices freely from demand (up while sold out or rationing, down while idle or while stock piles up or rots; no
 * cap, no price control; a COOP's own floor is its variable cost grossed up for Law 5, below which it goes only to clear
 * stock that would rot); every household good starts with two rivals (water stays with the City) and a seventh good,
 * experiences, has no satiation; a product whose margin over full cost stays above 30 % for 90 days gets a new rival
 * (Law 3: founders and 3 basket partners); treasuries keep 9 months of running costs plus planned building, grow first
 * and only then pay out for Aven work proposals; productivity rises about 2 % a year, unevenly; capacity shocks and
 * drifting tastes; weak COOPs fail (their plant goes to the City, which leases it to a successor; the failed MIND leaves
 * the pools and is retired) and small ones that lost their market exit; every tenth person is a zero-Aven test group.
 * The report starts with the per-person proof checks of the dynamic main (no one starves, no one has to work to
 * survive, living standards rise for everyone), then the dynamic sections D1–D8 and ladders, then the same runs valued
 * in HEARTS, the paper's unit of account (H1–H8), then the static sections.
 *
 * Run:   node scripts/theos-e2e-sim.mjs              all tables (markdown) on stdout, about 4 minutes
 *        node scripts/theos-e2e-sim.mjs --quick      fewer people, shorter runs (smoke test, about a minute)
 *        node scripts/theos-e2e-sim.mjs --csv FILE   also write yearly series of every run to FILE (with HEART columns)
 *        node scripts/theos-e2e-sim.mjs --json FILE  also write the numbers of H1–H8 to FILE
 *        node scripts/theos-e2e-sim.mjs --seeds 20261012-20261019 [--set key=value,…]   the dynamic main on each seed:
 *                                                    μ, σ, the margin below the melt and Proposition 3's checks
 *                                                    (keys of the dynamic world, e.g. poolShare=0.05, turnDiv=0.1,
 *                                                    capDays=365)
 *        node scripts/theos-e2e-sim.mjs … --melt 0.09  a research run with another melt (the protocol's is 0.07)
 *        node scripts/theos-e2e-sim.mjs --debug d 60 [--empty 0.25 | --grow]   one static run, a line a year
 *        node scripts/theos-e2e-sim.mjs --dyn 60 [--set key=value,…]          one dynamic run, a line a year
 */
import { writeFileSync } from 'node:fs';

const ARGS = process.argv.slice(2);
const QUICK = ARGS.includes('--quick');
const CSV = ARGS.includes('--csv') ? ARGS[ARGS.indexOf('--csv') + 1] : null;
const JSON_OUT = ARGS.includes('--json') ? ARGS[ARGS.indexOf('--json') + 1] : null;
const T0 = Date.now();

// ── protocol constants ───────────────────────────────────────────────────────────────────────────────────────────────
// demurrage on HEARTS and MINDs, a year. `--melt R` changes it for a research run only (the melt tests of the paper's
// Section 9.3); the protocol's rate is 0.07
const RATE = ARGS.includes('--melt') ? +ARGS[ARGS.indexOf('--melt') + 1] : 0.07;
const HEARTS_DAY = 24;
const U = HEARTS_DAY * 365; // 8,760 HEARTS a person a year
// the liquidity rule: each HEART invested into a COOP makes 1 MIND: 0.5 to the investor, 0.4 to the COOP's treasury and
// 0.1 to the city's pools (the pools' part is taken out of the treasury's half). Sales are not levied. The old pool rule
// sent 0.05 of each HEART (a tenth of the treasury's half); it is kept as a variation (DLADDER 'pool05').
const POOL_SHARE = 0.1;
const FEE = 0.003;
const GAM = 1 - FEE;
const W_STAR = U / 2 / RATE; // the paper's resting MIND holding of a person, 62,571
const M_STAR = U / RATE; // the paper's steady state of all money a person, 125,143

// ── goods, in real units ─────────────────────────────────────────────────────────────────────────────────────────────
// experiences / new products (EXPER) exist only in the dynamic world: a composite of new products and services, a unit
// worth 1 R at genesis prices, with no hard satiation
const FOOD = 0, ENERGY = 1, HOUSING = 2, WATER = 3, GOODS = 4, CARE = 5, EXPER = 6, PANELS = 7, MAT = 8, NPROD = 9;
const PNAME = ['food', 'energy', 'housing', 'water', 'goods', 'care', 'experiences', 'panels', 'materials'];
const PUNIT = ['kcal', 'kWh', 'm²', 'L', 'kg', 'h', 'unit', 'kWp', 'kg'];
const NHH = 7; // what households buy: products 0..6 (experiences only in the dynamic world)
const NHH_STATIC = 6; // the static world draws tastes for products 0..5 only
const BASIC = [2000, 3, 20, 100, 0, 0, 0]; // basic needs a person a day (shortfall below 98 % of these)
const SAT = [2800, 12, 50, 250, 6, 4, Infinity]; // satiation: basics saturate, goods and care only far up, experiences never
const BETA = [0.14, 0.14, 0.3, 0.04, 0.22, 0.16, 0.35]; // Stone–Geary marginal budget shares above the basics
const WAGE_R = 2; // R a unit of Aven work items, paid to the human whose Aven delivers: the nominal anchor (costs, and so prices, are quoted in R)
const PRICE_CAP = 2; // static world: COOPs price between variable cost and twice full cost, and ration when sold out
const BUILT_SHARE = 0.2; // land the City keeps for streets and parks

// ── COOPs: production functions (per unit of output, per unit of capacity) ───────────────────────────────────────────
const CITY = 0, SOLAR = 1, PANEL = 2, AGRI = 3, GREEN = 4, HABITAT = 5, BUILD = 6, GOODSC = 7, CAREC = 8, JUNK = 9, GEO = 10, AGRIB = 11;
// the dynamic world's genesis rivals (slots 12–17) and the slots new COOPs are founded into (18 …)
const WIND = 12, NEST = 13, MAKER = 14, CLINIC = 15, FEST = 16, ARTS = 17, FIRST_FREE = 18;
const M_STATIC = 12;
const M_DYN = QUICK ? 34 : 40;
const BASE_SPECS = [
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
// the dynamic world: every household good starts with two rivals that use somewhat different technology (full cost
// within about ±10 % of each other at genesis prices), plus two COOPs for experiences / new products
const RIVAL_SPECS = [
	{ id: 'WIND', product: ENERGY, inputs: [[MAT, 0.003]], capital: [[MAT, 600], [ENERGY, 180]], dep: 0.05, land: 1.4, work: 0.0008, gMax: 0.5 },
	{ id: 'NEST', product: HOUSING, inputs: [[ENERGY, 0.04], [MAT, 0.012]], capital: [[MAT, 420], [ENERGY, 140]], dep: 0.015, land: 0.6, work: 0.0025, gMax: 0.3 },
	{ id: 'MAKER', product: GOODS, inputs: [[ENERGY, 4.2], [MAT, 1.35]], capital: [[MAT, 380], [ENERGY, 400]], dep: 0.08, land: 1.6, work: 0.33, gMax: 0.5 },
	{ id: 'CLINIC', product: CARE, inputs: [[ENERGY, 0.25], [MAT, 0.04]], capital: [[MAT, 80], [ENERGY, 30]], dep: 0.06, land: 2.5, work: 0.95, gMax: 0.5 },
	{ id: 'FEST', product: EXPER, inputs: [[ENERGY, 0.12], [MAT, 0.03]], capital: [[MAT, 40], [ENERGY, 30]], dep: 0.08, land: 0.8, work: 0.4, gMax: 0.6 },
	{ id: 'ARTS', product: EXPER, inputs: [[ENERGY, 0.08], [MAT, 0.05]], capital: [[MAT, 60], [ENERGY, 20]], dep: 0.06, land: 1.0, work: 0.45, gMax: 0.6 }
];
const EMPTY_SPEC = { id: '', product: -1, inputs: [], capital: [], dep: 0, land: 0, work: 0, gMax: 0 };
// genesis split of each product between its sellers (dynamic world)
const GEN_SHARE = { [CITY]: 1, [SOLAR]: 0.6, [WIND]: 0.4, [PANEL]: 1, [AGRI]: 0.75, [GREEN]: 0.25, [HABITAT]: 0.6, [NEST]: 0.4, [BUILD]: 1, [GOODSC]: 0.6, [MAKER]: 0.4, [CAREC]: 0.6, [CLINIC]: 0.4, [FEST]: 0.5, [ARTS]: 0.5 };
const GENESIS_DYN = [CITY, SOLAR, PANEL, AGRI, GREEN, HABITAT, BUILD, GOODSC, CAREC, WIND, NEST, MAKER, CLINIC, FEST, ARTS];
// how long unsold stock keeps: food and goods can be stored (and rot); everything else is made to order (dynamic world)
const ROT = { [FOOD]: 0.02, [GOODS]: 0.002 };
const STOCK_DAYS = 14;
const PCODE = ['FOOD', 'ENERGY', 'HOME', 'WATER', 'MAKE', 'CARE', 'EXP', 'PANEL', 'MAT'];
// the run being stepped: its number of MIND slots, its COOPs' production functions and names (bound per run)
let M = M_STATIC;
let SPECS = BASE_SPECS;
let NAMES = BASE_SPECS.map((s) => s.id);
const BASE_NAMES = BASE_SPECS.map((s) => s.id);
function bind(S) {
	M = S.M;
	SPECS = S.specs;
	NAMES = S.names;
}
const BASE_COOPS = 9;
const REF = [SOLAR, HABITAT, CITY]; // the reference unit R: geometric mean of these three MIND prices
// equal-weight baskets the COOPs chose (each member has ≥ 3 partners; the graph is connected)
const BASKETS = [
	[SOLAR, AGRI, CITY, HABITAT],
	[PANEL, BUILD, SOLAR, GOODSC],
	[AGRI, GREEN, CAREC, CITY],
	[HABITAT, BUILD, CITY, GREEN, GOODSC, CAREC]
];
const DYN_BASKETS = [
	[WIND, NEST, CITY, BUILD, AGRI],
	[MAKER, CLINIC, CITY, SOLAR, GREEN],
	[FEST, ARTS, CITY, HABITAT, GOODSC, WIND]
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
	const hh = [2600, 10, 40, 200, 1.2, 1.5, 0]; // close to what people want once they can afford it
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

/** the dynamic world's genesis sizing: the same Leontief pass, each product split between its rivals (GEN_SHARE) */
function requirementsDyn(N) {
	const hh = [2600, 10, 40, 200, 1.2, 1.5, 2];
	const X = new Float64Array(M);
	for (let it = 0; it < 300; it++) {
		const need = new Float64Array(NPROD);
		for (let g = 0; g < NHH; g++) need[g] += hh[g] * N;
		for (const k of GENESIS_DYN) {
			const sp = SPECS[k], K = X[k] / 0.85;
			for (const [j, a] of sp.inputs) need[j] += a * X[k];
			for (const [j, c] of sp.capital) need[j] += (c * K * (sp.dep + 0.05)) / 365;
			if (sp.upkeep) for (const [j, a] of sp.upkeep) need[j] += a * N;
		}
		for (const k of GENESIS_DYN) X[k] = need[SPECS[k].product] * GEN_SHARE[k];
	}
	const K = X.map((x) => x / 0.85);
	let land = 0;
	for (const k of GENESIS_DYN) land += SPECS[k].land * K[k];
	return { X, K, land };
}

// initial goods prices, R a unit (quoted in the reference unit, charged in own MIND at its TWAP price), chosen so the basic bundle costs about the daily investor half (tatonnement
// moves them from there)
const P0 = [0.0009, 0.25, 0.12, 0.003, 2, 1.5, 1, 400, 0.15];

// ── the world ────────────────────────────────────────────────────────────────────────────────────────────────────────
function initPerson(S, i, day) {
	const dyn = !!S.sc.dynamic, nh = dyn ? NHH : NHH_STATIC;
	let bs = 0;
	for (let g = 0; g < nh; g++) {
		const v = BETA[g] * Math.exp(0.35 * gauss(S));
		// (ladder: wants do not grow — nobody wants experiences, everything else saturates)
		S.beta[i * NHH + g] = dyn && g === EXPER && !(S.sc.wantsGrow ?? true) ? 0 : v;
		bs += v;
	}
	for (let g = 0; g < nh; g++) S.beta[i * NHH + g] /= bs;
	let vs = 0;
	for (let k = 0; k < M; k++) {
		let v = 0;
		// (a newcomer in the dynamic world values only genesis COOPs that are still alive; its Aven finds the others)
		if (dyn ? GEN_SHARE[k] !== undefined && (!S.c || S.c[k].active) : k < BASE_COOPS) {
			const p = SPECS[k].product;
			v = p >= 0 && p < NHH ? S.beta[i * NHH + p] * (dyn ? GEN_SHARE[k] : k === AGRI ? 0.75 : k === GREEN ? 0.25 : 1) : 0.03;
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
	// post-AI (main): no human labour is paid. Every human's Aven proposes work items (operating and building), and the
	// COOPs pay the Aven's human for them; Avens differ in what they deliver (lognormal, spread sc.avenSigma, mean 2).
	// The old world (sc.labour): 40 % of people offer no work (children, the old, carers), the rest offer hours.
	// The dynamic world flags every tenth person as a test group whose Aven delivers nothing: they live from what they own.
	const sg = S.sc.avenSigma ?? 0.6;
	S.workH[i] = S.sc.labour && rnd(S) < 0.4 ? 0 : 2 * Math.exp(sg * gauss(S) - (sg * sg) / 2);
	if (dyn && S.sc.zeroAven && i % 10 === 9) (S.workH[i] = 0), (S.zeroAven[i] = 1);
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
		leaseFee: 0, revenueR: 0,
		// dynamic world: productivity (index and its yearly growth), a taste shifter, unsold stock, a capacity shock, its life
		A: 1, ga: 0, taste: 0, stock: 0, shockUntil: -1, bornT: 0, endT: null, endWhy: null, netEma: 0, dryDays: 0, lowDays: 0,
		inR: 0, outR: 0, marginEma: 0, peakMade: 0, heir: -1, heirOf: -1
	};
}

/** a COOP's yearly productivity growth: about 2 % on average, uneven (sc.prodSd), between −0.5 % and 6 % */
function drawGrowth(S) {
	if (!S.sc.prodGrowth) return 0;
	return Math.max(-0.005, Math.min(0.06, S.sc.prodMean + S.sc.prodSd * gauss(S)));
}

function init(sc) {
	const N0 = sc.N0, dyn = !!sc.dynamic;
	const Nmax = sc.popGrowth ? Math.ceil(N0 * Math.exp(sc.popGrowth * sc.years) * 1.05) + 5 : N0;
	const S = { sc, t: 0, rs: sc.seed >>> 0 || 1, N: N0, Nmax, popAcc: 0, M: dyn ? M_DYN : M_STATIC };
	S.specs = dyn
		? Array.from({ length: M_DYN }, (_, k) => ({ ...(k < M_STATIC ? BASE_SPECS[k] : k < FIRST_FREE ? RIVAL_SPECS[k - M_STATIC] : EMPTY_SPEC) }))
		: BASE_SPECS.map((s) => ({ ...s }));
	S.names = S.specs.map((s) => s.id);
	bind(S);
	S.hold = new Float64Array(Nmax * M);
	S.alloc = new Float64Array(Nmax * M);
	S.values = new Float64Array(Nmax * M);
	S.beta = new Float64Array(Nmax * NHH);
	S.workH = new Float64Array(Nmax);
	S.ybar = new Float64Array(Nmax);
	S.inc = new Float64Array(Nmax);
	S.born = new Float64Array(Nmax);
	S.ring = new Uint8Array(Nmax);
	S.zeroAven = new Uint8Array(Nmax);
	S.cons = new Float64Array(Nmax * NHH);
	S.reqU = new Float64Array(Nmax * M);
	S.pbuy = new Float64Array(Nmax * M);
	S.psell = new Float64Array(Nmax * M);
	for (let i = 0; i < Nmax; i++) initPerson(S, i, 0);
	S.c = SPECS.map((_, k) => newCoop(k));
	const gen = dyn ? GENESIS_DYN : [...Array(BASE_COOPS).keys()];
	if (dyn) for (let k = 0; k < M; k++) S.c[k].active = gen.includes(k);
	const req = dyn ? requirementsDyn(N0) : requirements(N0);
	S.req0 = req;
	for (const k of gen) {
		const co = S.c[k];
		co.K = req.K[k] * sc.seedCap;
		co.land = SPECS[k].land * co.K;
		co.reqEma = req.X[k] * sc.seedCap;
		for (const [j, a] of SPECS[k].inputs) co.inv[j] = a * co.reqEma * 14;
		if (SPECS[k].upkeep) for (const [j, a] of SPECS[k].upkeep) co.inv[j] += a * N0 * 14;
	}
	S.landTotal = (req.land * 1.6) / (1 - BUILT_SHARE); // fixed for ever; 20 % of it streets and parks
	S.landLeasable = req.land * 1.6;
	S.pools = (dyn ? BASKETS.concat(DYN_BASKETS) : BASKETS).map((m) => newPool(m));
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
	S.ref = REF.slice();
	S.Y = [];
	S.cur = newBucket();
	S.first = { d1: null, d30: { pd: 0, s: 0, sg: [0, 0, 0, 0] }, routeIn: 0, routeCost: 0 };
	if (dyn) {
		// the work-item rate, R a unit. Main: the Avens' rate card (2 R a unit; Avens are AI and deliver what is asked).
		// Ladder (sc.avenMarket): each Aven's capacity is fixed, sized so the genesis plants use 95 % of it, and the rate
		// moves with how much of it is used
		S.wage = sc.wageR;
		let wk = 0;
		for (const k of gen) wk += SPECS[k].work * req.X[k] + (SPECS[k].upkeepWork ? SPECS[k].upkeepWork * N0 : 0);
		S.avenCap = wk / 0.95; // work units all Avens can deliver a day
		S.avenU = 0.95;
		for (const k of gen) (S.c[k].ga = drawGrowth(S)), (S.c[k].taste = 0);
		S.tasteLg = new Float64Array(NHH);
		S.tasteG = new Float64Array(NHH).fill(1);
		S.events = [];
		S.allNames = S.names.slice();
		S.lastSpec = new Array(NPROD).fill(null); // the last technology seen for each product (for a founding after all sellers ended)
		S.highDays = new Float64Array(NPROD);
		S.lastFound = new Float64Array(NPROD).fill(-1e9);
		S.founder = new Int32Array(Nmax).fill(-1);
		S.founderUntil = new Float64Array(Nmax);
		S.divI = new Float64Array(Nmax); // Law 5 dividends a person received this step (R)
		S.realAcc = new Float64Array(Nmax); // real consumption at base-year prices, summed over the year
		S.realDays = 0;
		S.watch = []; // windows after capacity shocks (to 30 days after the plant is back): did anyone lose basics?
		S.watchF = []; // windows after a COOP ended (180 days)
		// the worst person-day over the whole run: on any day, and from day 8 on (after the genesis week, when nobody
		// holds MIND yet and the pools are empty); the zero-Aven group's first day on which Law 5 dividends alone covered
		// a day's basic bundle for every one of them, and the last day they did not
		S.proof = { covMin: Infinity, covMinT: 0, covMinLate: Infinity, covMinLateT: 0, weekPd: 0, weekShort: 0, weekMin: Infinity, weekMinT: 0, zCovMinLate: Infinity, zShortLate: 0, zStrictFrom: null, zStrictLastFail: null, zStrictLastFailR: null };
		S.prevNames = null;
	}
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
		divK: new Float64Array(M), eligK: new Float64Array(M), treInR: 0, heartInR: 0, salesHHR: 0, b2bR: 0,
		// the round trip (R): the investor's half to wallets, the pools' part to the pools, dividends to people and to treasuries, melt by place
		walHeartR: 0, poolHeartR: 0, divHHR: 0, divTR: 0, meltWR: 0, meltTR: 0, meltPR: 0, meltAR: 0,
		// dynamic world: failures (liquidation to holders, what holders and pools lost), stock that rotted, events, MIND count
		// melted, Aven work demand, and the per-person proof checks
		liqHHR: 0, liqTR: 0, lossWalR: 0, lossTreR: 0, lossPoolR: 0, burnTreR: 0, rotR: 0, failN: 0, exitN: 0, foundN: 0, shockN: 0,
		meltCnt: 0, workU: 0, wageSum: 0, avenUSum: 0, covMin: Infinity, zPd: 0, zStrictOk: 0, zStrictMin: Infinity, zStrictSum: 0,
		zCovMin: Infinity, zShort: 0, watchPd: 0, watchShort: 0, watchCov: Infinity, watchFPd: 0, watchFShort: 0, watchFCov: Infinity,
		zWminStep: Infinity, hFlows: {}, hRevW: 0, hRevT: 0, hRevP: 0, hRevA: 0, hZWmin: Infinity, basicMindSum: 0, revalW: 0, revalT: 0, revalP: 0, revalA: 0, madeN: {}, revN: {}, prodN: {}, sellD: new Float64Array(NPROD), spreadSum: new Float64Array(NPROD), spreadD: new Float64Array(NPROD)
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
			// dynamic world (many pools): direct routes, then the two-hop routes through the deepest pools, at most 8
			if (S.sc.dynamic && rs.length > 8) {
				const depth = (pi) => {
					let v = 0;
					for (let x = 0; x < pools[pi].m.length; x++) v += pools[pi].x[x] * (S.P ? S.P[pools[pi].m[x]] : 1);
					return v;
				};
				const sc = (r) => (r.length === 3 ? 1e30 + depth(r[0]) : Math.min(depth(r[0]), depth(r[3])));
				rs.sort((a, b) => sc(b) - sc(a));
				rs.length = 8;
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
		let ok = !p.dead;
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
		if (S.sc.dynamic) {
			// dynamic world: R is chain-linked, so it does not jump when a reference MIND ends or a new one joins: the reference
			// MINDs that were live last step and still are keep their average (log) price from one step to the next
			let d = 0, nr = 0;
			for (const k of S.ref) if (S.live[k] && S.refLive && S.refLive[k] && P[k] > 0) (d += lnP[k] - Math.log(P[k])), nr++;
			if (nr > 0) for (let k = 0; k < M; k++) if (den[k] > 0) lnP[k] -= d / nr;
			continue;
		}
		let ref = 0, nr = 0;
		for (const k of S.ref) if (S.live[k]) (ref += lnP[k]), nr++;
		if (nr === S.ref.length) for (let k = 0; k < M; k++) if (den[k] > 0) lnP[k] -= ref / nr;
	}
	if (S.sc.dynamic) {
		S.refLive = new Uint8Array(M);
		for (const k of S.ref) if (S.live[k]) S.refLive[k] = 1;
	}
	const a = Math.min(1, dt / 7);
	for (let k = 0; k < M; k++) {
		if (S.live[k]) P[k] = Math.exp(lnP[k]);
		S.Ptw[k] += a * (P[k] - S.Ptw[k]);
	}
}

// ── one step of dt days ──────────────────────────────────────────────────────────────────────────────────────────────
/** the pools' part of the treasury's half of each HEART: poolShare of the HEART is 2·poolShare of that half */
const poolLevy = (S) => 2 * S.sc.poolShare;
/** credit a treasury in its own MIND; only the treasury's half of each HEART pays the pools their part (sales are not levied) */
function treasuryIn(S, k, amt, levy = false) {
	if (!(amt > 0)) return;
	const co = S.c[k];
	if (levy) {
		const d = poolLevy(S) * amt;
		co.poolDue += d;
		amt -= d;
	}
	co.tre[k] += amt;
}

const effCap = (S, k) => {
	const co = S.c[k], sp = SPECS[k];
	let K = co.K;
	if (sp.land > 0) K = Math.min(K, co.land / sp.land);
	return K * co.prodF * co.A;
};

function meltAll(S, f) {
	const n = S.N * M;
	let lost = 0, w = 0, t = 0, pl = 0, a = 0;
	const P = S.P, g = 1 - f;
	for (let x = 0; x < n; x++) (lost += S.hold[x]), (w += S.hold[x] * P[x % M]), (S.hold[x] *= f);
	for (const co of S.c) for (let k = 0; k < M; k++) (lost += co.tre[k]), (t += co.tre[k] * P[k]), (co.tre[k] *= f);
	for (const p of S.pools) for (let i = 0; i < p.x.length; i++) (lost += p.x[i]), (pl += p.x[i] * P[p.m[i]]), (p.x[i] *= f);
	for (let k = 0; k < M; k++) (lost += S.arb[k]), (a += S.arb[k] * P[k]), (S.arb[k] *= f);
	S.tot.melted += lost * g;
	if (S.cur) (S.cur.meltWR += w * g), (S.cur.meltTR += t * g), (S.cur.meltPR += pl * g), (S.cur.meltAR += a * g), (S.cur.meltCnt += lost * g);
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
	let nIn = 0;
	for (let i = 0; i < N; i++) {
		const b = i * M;
		let inc = 0, sum = 0;
		for (let k = 0; k < M; k++) sum += S.alloc[b + k];
		if (sum > 0) nIn++;
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
		S.cur.walHeartR += inc;
	}
	const ea = Math.min(1, dt / 90), lev = poolLevy(S);
	for (let k = 0; k < M; k++) {
		const co = S.c[k];
		if (to[k] > 0) treasuryIn(S, k, to[k], true), (S.cur.treInR += to[k] * (1 - lev) * S.P[k]), (S.cur.heartInR += to[k] * (1 - lev) * S.P[k]), (S.cur.poolHeartR += to[k] * lev * S.P[k]), (co.inR += to[k] * (1 - lev) * S.P[k]);
		co.heartsEma += ea * ((2 * to[k]) / dt - co.heartsEma);
		S.cur.hearts[k] += 2 * to[k];
	}
	S.tot.issued += 2 * half * nIn;
	S.cur.issued += 2 * half * nIn;
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
		// logit, ε = 6; the dynamic world adds each seller's drifting taste shifter (demand shifts between rivals)
		// the dynamic world weights each seller by its size (what it can supply: capacity, plus stock for goods made ahead):
		// buyers meet sellers in proportion to their reach, and a small rival cannot take a whole market by being cheap
		const reach = (k) => {
			if (!S.sc.dynamic) return 1;
			const co = S.c[k];
			return co.Keff + (ROT[SPECS[k].product] !== undefined ? co.stock / 7 : 0);
		};
		const w = t.sh.map((p, x) => Math.pow(p / lo, -6) * Math.exp(S.c[t.s[x]].taste) * reach(t.s[x]));
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
	// dynamic world: what a unit of each product costs a buyer is the share-weighted price, not the cheapest one
	if (S.sc.dynamic) S.uR = T.map((t) => (isFinite(t.pi) ? t.pi : 0));
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
	const free = new Array(NHH).fill(true);
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
		for (const [j, a] of sp.inputs) useDay[j] += plannedDay * (a / co.A);
		if (sp.upkeep) for (const [j, a] of sp.upkeep) useDay[j] += a * S.N;
		for (let j = 0; j < NPROD; j++) if (useDay[j] > 0) want[j] += Math.max(0, useDay[j] * dt + 0.3 * Math.min(1, dt / 3) * (useDay[j] * 14 - co.inv[j]));
		// capacity: grow while sold out and covered, replace wear while used, else let it shrink
		let dK = 0;
		if (sp.lumpy && co.K <= 0) {
			const margin = unitR(S, sp.product) - varCostR(S, k), payback = margin > 0 ? capCostR(S, k) / co.A / (margin * 365) : Infinity;
			dK = mech === 'a' || payback <= 0.4 / sp.dep ? co.module : 0;
		}
		else {
			let g = 0;
			const cover = co.costEma > 0 ? valueOf(S, co.tre) / co.costEma : 99;
			// grow only what pays back within 40 % of the asset's life at today's prices (quotas: no prices, demand only);
			// replace wear on whatever is still used
			let growOK = true;
			if (S.sc.dynamic) {
				// dynamic world: demand exceeds capacity when the COOP is sold out or its price stands above full cost; a COOP
				// invests its surplus there first (up to its ramp limit gMax at a 30 % margin or when rationing), as long as it
				// still holds 20 days of running costs
				const fc = fullCostR(S, k), m = fc > 0 ? co.priceR / fc - 1 : 0;
				growOK = false;
				if (S.sc.growth !== false && co.zEma >= 0.8 && cover >= 20) g = sp.gMax * Math.min(1, Math.max(0, (m - 0.05) / 0.25, (co.zEma - 0.95) / 0.15));
			} else if (mech !== 'a') {
				const margin = co.priceR - varCostR(S, k), payback = margin > 0 ? capCostR(S, k) / (margin * 365) : Infinity;
				const life = sp.dep > 0 ? 1 / sp.dep : 50;
				growOK = payback <= 0.4 * life;
			}
			if (growOK && co.zEma >= 0.9 && cover >= 20) g = sp.gMax * Math.min(1, (co.zEma - 0.85) / 0.2);
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
		const hours = (sp.work / co.A) * plannedDay * dt + (sp.upkeepWork ? sp.upkeepWork * S.N * dt : 0);
		co.wageOwn = S.P[k] > 0 ? (hours * wageR(S)) / S.P[k] : 0;
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
			const inR = opR + co.rentDue * S.P[CITY];
			opR += co.rentDue * S.P[CITY] + co.wageOwn * S.P[k];
			const V = valueOf(S, co.tre);
			let fIn = 1, fCap = 0;
			// dynamic world: Aven work items are paid when the output is delivered (from the sale), so only inputs and rent
			// must be paid up front; the static world keeps its rule (the whole running cost up front)
			const upfront = S.sc.dynamic ? inR : opR;
			if (V < upfront) {
				fIn = upfront > 0 ? V / upfront : 0;
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

/** the rate for a unit of Aven work, R: fixed in the static world (the nominal anchor), set by demand in the dynamic one */
const wageR = (S) => (S.sc.dynamic ? S.wage : S.sc.wageR);

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
	const bb = new Float64Array(NHH);
	let basicR = 0;
	for (let g = 0; g < 4; g++) basicR += BASIC[g] * (isFinite(pi[g]) ? pi[g] : 0);
	const reb = 1 - Math.exp(-(mech === 'a' ? 0.1 : 0.2) * dt);
	const spend = new Float64Array(M);
	for (let i = 0; i < N; i++) {
		const b = i * M;
		let W = 0;
		for (let k = 0; k < M; k++) W += S.hold[b + k] * P[k];
		need.fill(0);
		tgt.fill(0);
		if (S.sc.dynamic) {
			// dynamic world: a person spends a share sc.spendRate a year of what they own (they keep about 1 / spendRate years
			// of spending); basics come first. At rest the share of income spent is then spendRate / (spendRate + melt).
			const bd = Math.max((S.sc.spendRate * W) / 365, basicR);
			const bud = Math.min(W, dt * bd);
			for (let g = 0; g < NHH; g++) bb[g] = S.beta[i * NHH + g] * S.tasteG[g];
			demand(bud / dt, pi, bb, 0, x);
		} else if (mech !== 'a') {
			const y = S.ybar[i];
			const bud = Math.min(W, dt * Math.max(0, y + (W - 3 * y) / 15));
			demand(bud / dt, pi, S.beta, i * NHH, x);
		}
		if (mech !== 'a') {
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
		// a step of several days trades as that many daily batches, with arbitrage between them (the dynamic world, with
		// many more MINDs and pools, trades a week in 3 batches)
		const nSub = Math.max(1, Math.min(S.sc.dynamic ? 3 : 99, Math.round(dt)));
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
		// a MIND with no market (a failed COOP's, taken out of the pools) cannot be sold
		const sq = P[s] > 0 ? f1 * Math.max(0, hs - keep) + f2 * Math.max(0, Math.min(hs, keep) - need[s]) : 0;
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
		co.outR += paid * S.P[CITY];
		paidAll += paid;
		if (paid < co.rentDue * 0.999) {
			const f = 1 - paid / co.rentDue;
			co.land *= 1 - f * Math.min(1, dt / 30);
		}
	}
	B.rentR += paidAll * S.P[CITY];
	B.treInR += paidAll * S.P[CITY];
	S.c[CITY].inR += paidAll * S.P[CITY];
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
	if (S.sc.dynamic) {
		// (rounding can leave −1e-16 behind a payment; it must not take a share)
		for (let i = 0; i < S.N; i++) H += Math.max(0, S.hold[i * M + k]);
		for (let j = 0; j < M; j++) if (j !== k && S.c[j].active) H += Math.max(0, S.c[j].tre[k]);
		return H;
	}
	for (let i = 0; i < S.N; i++) H += S.hold[i * M + k];
	for (let j = 0; j < M; j++) if (j !== k && S.c[j].active) H += S.c[j].tre[k];
	return H;
}

/** a dividend of div MIND k, pro rata to its holders (people and other treasuries) */
function payDiv(S, k, div, B) {
	const H = holders(S, k);
	if (!(div > 0 && H > 0)) return;
	const f = div / H, c = S.c;
	if (S.sc.dynamic) c[k].divAcc = (c[k].divAcc || 0) + f;
	let hh = 0;
	const dI = S.divI, pos = !!S.sc.dynamic;
	for (let i = 0; i < S.N; i++) {
		const d = (pos ? Math.max(0, S.hold[i * M + k]) : S.hold[i * M + k]) * f;
		S.hold[i * M + k] += d;
		S.inc[i] += d * S.P[k];
		if (dI) dI[i] += d * S.P[k];
		hh += d;
	}
	for (let j = 0; j < M; j++) if (j !== k && c[j].active) c[j].tre[k] += (pos ? Math.max(0, c[j].tre[k]) : c[j].tre[k]) * f;
	B.divHHR += hh * S.P[k];
	B.divTR += (div - hh) * S.P[k];
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
		for (const [j, a] of sp.inputs) if (a > 0) Y = Math.min(Y, co.inv[j] / (a / co.A));
		// dynamic world: food and goods are made ahead into a stock (STOCK_DAYS of demand) and sold from it; unsold stock
		// rots; everything else is made to order
		co._prod = -1;
		if (S.sc.dynamic && ROT[sp.product] !== undefined) {
			const target = STOCK_DAYS * co.reqEma;
			co._prod = Math.min(Y, Math.max(0, co.reqEma * dt + 0.3 * Math.min(1, dt / 3) * (target - co.stock)));
			Y = co._prod + co.stock;
		}
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
		} else if (S.sc.dynamic) {
			// dynamic world: a sold-out COOP serves running orders (households and other COOPs' inputs) pro rata, with no
			// priority for anyone, and new capacity from what is left; its price does the rest
			const run = tot[s] + co.selfIn + totH[s];
			fi[s] = fl[s] = run > 0 ? Math.min(1, Y / run) : 0;
			// what it was asked for over what it could deliver (short of inputs, a COOP rations below its capacity)
			co.zDel = run > 0 ? run / Math.max(Y, 1e-9 * run) : 0;
			spare = Math.max(0, Y - run);
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
				if (S.spendI) S.spendI[i] += pm * P[s];
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
				co.outR += dIn * c[s].price * P[s]; // running costs only: building new capacity is investment, not a loss
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
			// Law 5, every sale pays its owners: a share of every sale goes at once to everyone who holds the seller's MIND
			const d = S.sc.turnDiv > 0 && s !== JUNK && holders(S, s) > 0 ? pay[s] * S.sc.turnDiv : 0;
			treasuryIn(S, s, pay[s] - d), (B.treInR += (pay[s] - d) * P[s]);
			co.inR += (pay[s] - d) * P[s];
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
			// what it produced: its deliveries, or, for goods made ahead, this step's production (the rest went to stock)
			const prodQ = co._prod >= 0 ? co._prod : made;
			if (co._prod >= 0) {
				const left = Math.max(0, co.stock + co._prod - made), rotted = left * (1 - Math.exp(-ROT[sp.product] * dt));
				co.stock = left - rotted;
				B.rotR += rotted * co.priceR;
			}
			for (const [j, a] of sp.inputs) co.inv[j] = Math.max(0, co.inv[j] - (a / co.A) * prodQ);
			co.made = made / dt;
			co.prodD = prodQ / dt;
			hoursD += (sp.work / co.A) * prodQ;
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
	if (S.sc.dynamic) (S.avenU = demandH / dt / S.avenCap), (B.workU += demandH);
	if (supply <= 0 || demandH <= 0) return;
	// static world: Avens are paid for at most what they offer; dynamic world: every work item done is paid at the rate,
	// and the rate itself moves with how much of the Avens' capacity is used (adjust)
	const eD = S.sc.dynamic ? 1 : Math.min(1, supply / demandH);
	const wageM = new Float64Array(M);
	let totR = 0;
	for (let k = 0; k < M; k++) {
		const co = c[k], sp = SPECS[k];
		if (!co.active || !(S.P[k] > 0)) continue;
		const h = ((sp.work / co.A) * (co.prodD || 0) * dt + (sp.upkeepWork ? sp.upkeepWork * N * dt : 0)) * eD;
		const due = (h * wageR(S)) / S.P[k];
		const paid = Math.min(due, co.tre[k]);
		co.tre[k] -= paid;
		co.outR += paid * S.P[k];
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
	if (S.sc.dynamic) {
		// dynamic world: free prices. A COOP quotes its price in R (and takes the equivalent in its own MIND at today's
		// consensus price): up while it is sold out or rationing, down while capacity sits idle or stock piles up. Its
		// normal choice is not to sell below its variable cost; with stock that would rot (more than twice its stock target)
		// it clears it down to 60 % of that. Law 5 sends a share of every sale to the owners, so "variable cost" here is what
		// a unit costs the treasury: variable cost ÷ (1 − Law 5's share). No cap and no protected price for anything.
		for (let s = 0; s < M; s++) {
			const co = c[s], sp = SPECS[s];
			if (!co.active || sp.product < 0) continue;
			// a COOP with no plant yet (founded, or lined up to take over one) has no market to read: it keeps today's going
			// price of its product
			if (co.Keff <= 0) {
				const pi = S.uR ? S.uR[sp.product] : 0;
				if (pi > 0) co.priceR = pi;
				co.price = co.priceR / Math.max(1e-9, S.Ptw[s]);
				continue;
			}
			// demand over what it can deliver: what it was asked for over its capacity, or over what it could actually make
			// (a COOP short of inputs rations below its capacity). The step is the same size up and down: an asymmetric step
			// (faster up than down) ratchets prices up whenever demand hovers around capacity
			const z = Math.max(co.zNow || 0, Math.min(co.zDel || 0, 9));
			let step = 0.07 * st * (z - 0.95);
			let clear = false;
			if (ROT[sp.product] !== undefined && co.reqEma > 0) {
				const sr = co.stock / (STOCK_DAYS * co.reqEma);
				step -= 0.015 * st * Math.max(0, sr - 1.2);
				clear = sr > 2;
			}
			step = Math.max(-0.25, Math.min(0.25, step));
			co.priceR *= Math.exp(step);
			// what a unit costs the treasury: its variable cost, of which the treasury keeps only 1 − Law 5's share of the price
			const floorR = varCostR(S, s) / (1 - S.sc.turnDiv);
			co.priceR = Math.max(co.priceR, (clear ? 0.6 : 1) * floorR, 1e-12);
			co.price = co.priceR / Math.max(1e-9, S.Ptw[s]);
		}
		// the work-item rate (ladder only): up while the Avens' capacity is more than 95 % used, down while it is not
		const u = S.avenU;
		if (S.sc.avenMarket) {
			S.wage *= Math.exp(Math.max(-0.02, Math.min(0.02, 0.02 * st * (u - 0.95))));
			S.wage = Math.max(S.wage, 1e-3);
		}
		S.cur.wageSum += S.wage * dt;
		S.cur.avenUSum += u * dt;
	} else if (mech !== 'a') {
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
	let cost = (sp.work / co.A) * wageR(S) + (k === CITY ? 0 : (sp.land * S.rho * S.P[CITY]) / Math.max(0.05, co.prodF * co.A));
	for (const [j, a] of sp.inputs) cost += (a / co.A) * unitR(S, j);
	return cost;
}
/** full cost of a unit in R: variable cost plus wear and a 10 %/yr return on the capacity it uses */
function fullCostR(S, k) {
	const sp = SPECS[k], co = S.c[k];
	const u = Math.max(0.5, Math.min(1, co.Keff > 0 ? (co.made || 0) / co.Keff : 1));
	return varCostR(S, k) + ((capCostR(S, k) / co.A) * (sp.dep + 0.1)) / 365 / u;
}
/** what a unit of capacity costs to build, in R */
function capCostR(S, k) {
	let cost = 0;
	for (const [j, c] of SPECS[k].capital) cost += c * unitR(S, j);
	return cost;
}

function unitR(S, j) {
	if (S.sc.dynamic && S.uR && S.uR[j] > 0) return S.uR[j];
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
	// dynamic world: each MIND's Law 5 dividend yield (a year's dividends over what its holders hold), smoothed over 90 days
	if (S.sc.dynamic)
		for (let k = 0; k < M; k++) {
			const co = c[k];
			co.yEma = (co.yEma || 0) + Math.min(1, dt / 90) * (((co.divAcc || 0) * 365) / dt - (co.yEma || 0));
			co.divAcc = 0;
		}
	const score = new Float64Array(M);
	let any = false;
	for (let k = 0; k < M; k++) {
		const co = c[k];
		if (!co.active || !S.live[k] || k === JUNK && !S.live[k]) continue;
		// dynamic world: Avens invest in a newly founded COOP's MIND only once its pool has traded for a year (its founders
		// do before); a successor that runs a failed COOP's plant for the City is an ongoing business and gets no such wait
		if (S.sc.dynamic && co.startup && S.t - co.bornT < 365) continue;
		let s;
		if (rule === 'output') s = co.heartsEma > 0 ? (co.outValEma + (k === CITY ? co.rentEma || 0 : 0)) / co.heartsEma : 0;
		else s = S.Ptw[k] * (1 - S.routeCostEma * (1 - S.spendShare[k]));
		// dynamic world: the Aven also counts what holding the MIND pays (its Law 5 dividend yield, over about three years)
		if (S.sc.dynamic) s *= 1 + 3 * (co.yEma || 0);
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
		// Law 3: the founders of a new COOP invest all their HEARTS in it for its first year
		if (S.founder && S.founder[i] >= 0) {
			const fk = S.founder[i];
			if (S.t < S.founderUntil[i] && c[fk].active) {
				for (let k = 0; k < M; k++) S.alloc[b + k] = k === fk ? 1 : 0;
				continue;
			}
			S.founder[i] = -1;
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

// ── the dynamic world: productivity, shocks, taste drift, foundings (Law 3), failures and exits ─────────────────────────
/** productivity growth, capacity shocks and drifting tastes, at the start of a step */
function world(S, dt, B) {
	const sc = S.sc, c = S.c, sq = Math.sqrt(dt / 365);
	for (let k = 0; k < M; k++) {
		const co = c[k], sp = SPECS[k];
		if (!co.active || sp.product < 0) continue;
		if (sc.prodGrowth) co.A *= Math.exp((co.ga * dt) / 365);
		if (co.shockUntil >= 0) {
			if (S.t >= co.shockUntil) (co.prodF = 1), (co.shockUntil = -1);
		} else if (sc.shockRate > 0 && rnd(S) < (sc.shockRate * dt) / 365) {
			// a capacity shock: 30–50 % of the plant out for 2–8 months
			co.prodF = 1 - (0.3 + 0.2 * rnd(S));
			co.shockUntil = S.t + 60 + 180 * rnd(S);
			B.shockN++;
			S.events.push({ t: S.t, type: 'shock', k, name: NAMES[k], product: sp.product, note: `−${Math.round((1 - co.prodF) * 100)} % capacity for ${Math.round(co.shockUntil - S.t)} days` });
			S.watch.push(co.shockUntil + 30);
		}
		// demand shifts between rivals: each seller's taste shifter drifts (mean-reverting over about 5 years)
		if (sc.tasteSd > 0) co.taste += (-co.taste * dt) / (5 * 365) + sc.tasteSd * sq * gauss(S);
	}
	// and between goods: what people want of each good drifts too (mean-reverting over about 10 years)
	if (sc.tasteSd > 0)
		for (let g = 0; g < NHH; g++) {
			S.tasteLg[g] += (-S.tasteLg[g] * dt) / (10 * 365) + 0.5 * sc.tasteSd * sq * gauss(S);
			S.tasteG[g] = Math.exp(S.tasteLg[g]);
		}
}

/** per person, every step: basic-need coverage, real consumption at base-year prices, and the zero-Aven group's checks */
function proofStep(S, dt, T, B) {
	let basicR = 0;
	for (let g = 0; g < 4; g++) basicR += BASIC[g] * (isFinite(T[g].pi) ? T[g].pi : 0);
	S.basicRNow = basicR;
	let watching = false, watchingF = false;
	for (const u of S.watch) if (S.t < u) watching = true;
	for (const u of S.watchF) if (S.t < u) watchingF = true;
	const pr = S.proof, P = S.P;
	let zAll = true, zWorst = Infinity;
	for (let i = 0; i < S.N; i++) {
		const b = i * NHH;
		let cov = Infinity, real = 0;
		for (let g = 0; g < 4; g++) cov = Math.min(cov, S.cons[b + g] / BASIC[g]);
		for (let g = 0; g < NHH; g++) real += S.cons[b + g] * P0[g];
		S.realAcc[i] += real * dt;
		if (cov < B.covMin) B.covMin = cov;
		if (cov < pr.covMin) (pr.covMin = cov), (pr.covMinT = S.t);
		if (S.t >= 7 && cov < pr.covMinLate) (pr.covMinLate = cov), (pr.covMinLateT = S.t);
		if (S.t < 7) (pr.weekPd += dt), cov < 0.98 && (pr.weekShort += dt), cov < pr.weekMin && ((pr.weekMin = cov), (pr.weekMinT = S.t));
		if (watching) (B.watchPd += dt), cov < 0.98 && (B.watchShort += dt), (B.watchCov = Math.min(B.watchCov, cov));
		if (watchingF) (B.watchFPd += dt), cov < 0.98 && (B.watchFShort += dt), (B.watchFCov = Math.min(B.watchFCov, cov));
		if (S.zeroAven[i]) {
			if (S.t >= 7) (pr.zCovMinLate = Math.min(pr.zCovMinLate, cov)), cov < 0.98 && (pr.zShortLate += dt);
			const r = basicR > 0 ? S.divI[i] / dt / basicR : 0; // Law 5 dividends a day ÷ a day's basic bundle
			B.zPd += dt;
			if (r >= 1) B.zStrictOk += dt;
			else zAll = false;
			if (r < zWorst) zWorst = r;
			if (r < B.zStrictMin) B.zStrictMin = r;
			B.zStrictSum += r * dt;
			if (cov < B.zCovMin) B.zCovMin = cov;
			if (cov < 0.98) B.zShort += dt;
			let w = 0;
			for (let k = 0; k < M; k++) w += S.hold[i * M + k] * P[k];
			if (w < B.zWminStep) B.zWminStep = w;
			let wh = 0;
			for (let k = 0; k < M; k++) wh += S.hold[i * M + k] * S.vH[k];
			if (wh < B.hZWmin) B.hZWmin = wh;
		}
		S.divI[i] = 0;
	}
	if (zAll && pr.zStrictFrom === null) pr.zStrictFrom = S.t;
	if (!zAll) (pr.zStrictLastFail = S.t), (pr.zStrictLastFailR = zWorst);
	S.realDays += dt;
}

/** a slot for a new COOP: one never used, else one whose COOP ended more than 30 days ago (all its MIND is retired) */
const freeSlot = (S) => {
	for (let k = FIRST_FREE; k < M; k++) if (!S.c[k].used && !S.c[k].active && !S.c[k].failed) return k;
	for (let k = 1; k < M; k++) if (k !== JUNK && k !== GEO && k !== AGRIB && S.c[k].failed && !S.c[k].active && S.t - S.c[k].endT > 30) return k;
	return -1;
};
/** clean a slot for reuse: the old COOP's MIND is fully retired, so only prices and per-slot state are reset */
function resetSlot(S, k) {
	S.P[k] = 1;
	S.Ptw[k] = 1;
	S.arb[k] = 0;
	S.spendShare[k] = 0;
	S.live[k] = 0;
	for (let i = 0; i < S.Nmax; i++) (S.hold[i * M + k] = 0), (S.alloc[i * M + k] = 0), (S.values[i * M + k] = 0), (S.reqU[i * M + k] = 0), (S.pbuy[i * M + k] = 0), (S.psell[i * M + k] = 0);
	for (const co of S.c) co.tre[k] = 0;
}

/** Law 3: a new COOP bootstraps from its founders' HEARTS and a basket with three partners (the City and two others) */
/**
 * its founders: a few people (not the zero-Aven test group, who only own) put all their HEARTS into it for a year; only
 * people who can carry themselves meanwhile found: they hold at least 180 days of their basic bundle elsewhere
 */
function pickFounders(S) {
	const nF = Math.max(3, Math.round(S.sc.founderShare * S.N)), F = [];
	for (let tries = 0; F.length < nF && tries < 50 * nF; tries++) {
		const i = Math.floor(rnd(S) * S.N);
		if (S.zeroAven[i] || S.founder[i] >= 0 || F.includes(i)) continue;
		let W = 0;
		for (let k = 0; k < M; k++) W += Math.max(0, S.hold[i * M + k]) * S.P[k];
		if (W >= 180 * (S.basicRNow || 0)) F.push(i);
	}
	return F;
}

function newBasket(S, kk, founders) {
	const cand = [];
	for (let k = 0; k < M; k++) if (k !== kk && k !== CITY && S.c[k].active && SPECS[k].product >= 0 && S.live[k] && S.c[k].baskets.length) cand.push(k);
	const partners = [CITY];
	while (partners.length < 3 && cand.length) partners.push(cand.splice(Math.floor(rnd(S) * cand.length), 1)[0]);
	S.pools.push(newPool([kk, ...partners]));
	const pi = S.pools.length - 1;
	S.c[kk].baskets.push(pi);
	for (const k of partners) S.c[k].baskets.push(pi);
	buildGraph(S);
	S.P[kk] = 1;
	S.Ptw[kk] = 1;
	for (const i of founders || pickFounders(S)) {
		S.founder[i] = kk;
		S.founderUntil[i] = S.t + 365;
		S.values[i * M + kk] = 0.1;
	}
	return partners;
}

function newName(S, base) {
	for (let n = 2; ; n++) {
		const id = `${base}${n}`;
		if (!S.allNames.includes(id)) return S.allNames.push(id), id;
	}
}

/** a rival is founded where a product's margin over full cost stayed above 30 % for 90 days */
function found(S, g, B) {
	const kk = freeSlot(S);
	if (kk < 0) return;
	const founders = pickFounders(S);
	if (founders.length < 3) return;
	const sellers = [];
	let tot = 0, Amax = 0, pmin = Infinity;
	for (let k = 0; k < M; k++) {
		const co = S.c[k];
		if (co.active && SPECS[k].product === g && co.Keff > 0) sellers.push(k), (tot += co.made), (Amax = Math.max(Amax, co.A)), (pmin = Math.min(pmin, co.priceR));
	}
	if (!sellers.length && !S.lastSpec[g]) return;
	if (!sellers.length) (Amax = S.lastSpec[g].A), (pmin = S.lastSpec[g].priceR);
	const tpl = sellers.length ? SPECS[sellers[Math.floor(rnd(S) * sellers.length)]] : S.lastSpec[g].spec;
	resetSlot(S, kk);
	const r = () => 0.85 + 0.3 * rnd(S);
	S.specs[kk] = { ...tpl, id: newName(S, PCODE[g]), inputs: tpl.inputs.map(([j, a]) => [j, a * r()]), capital: tpl.capital.map(([j, c]) => [j, c * r()]), work: tpl.work * r(), land: tpl.land * r(), lumpy: true, upkeep: undefined, upkeepWork: undefined };
	S.names[kk] = S.specs[kk].id;
	const co = (S.c[kk] = newCoop(kk));
	co.used = co.active = co.startup = true;
	co.bornT = S.t;
	co.A = Amax * (0.95 + 0.1 * rnd(S)); // it starts with today's technology
	co.ga = drawGrowth(S);
	co.module = Math.max(1e-6, sellers.length ? 0.08 * tot : 0.3 * S.lastSpec[g].made); // its first plant: 8 % of the market
	co.reqEma = co.module;
	co.priceR = co.price = pmin;
	const partners = newBasket(S, kk, founders);
	S.lastFound[g] = S.t;
	S.highDays[g] = 0;
	B.foundN++;
	S.events.push({ t: S.t, type: 'found', k: kk, name: NAMES[kk], product: g, note: `rival in ${PNAME[g]}, partners ${partners.map((x) => NAMES[x]).join(', ')}` });
}

/**
 * the City's handover: once a COOP has been dry and losing for 90 days, the City lines up the COOP that would run its
 * plant (a new MIND in a new basket, people may invest in it at once), so that its customers can pay it from the day it
 * takes over; if the old COOP recovers, the handover is called off
 */
function prepareHeir(S, fk) {
	const kk = freeSlot(S);
	if (kk < 0) return -1;
	const a = S.c[fk];
	resetSlot(S, kk);
	S.specs[kk] = { ...SPECS[fk], id: newName(S, `${NAMES[fk].replace(/-B\d*$/, '')}-B`), lumpy: false };
	S.names[kk] = S.specs[kk].id;
	const b = (S.c[kk] = newCoop(kk));
	b.used = b.active = true;
	b.bornT = S.t;
	b.heirOf = fk;
	b.priceR = a.priceR;
	b.price = a.price;
	a.heir = kk;
	newBasket(S, kk);
	for (let i = 0; i < S.N; i++) S.values[i * M + kk] = S.values[i * M + fk];
	return kk;
}

/** a failed COOP's plant and land go to the City COOP, which leases them to a successor (same plant, new MIND) */
function successor(S, fk, B) {
	const a = S.c[fk], g = SPECS[fk].product;
	let kk = a.heir >= 0 && S.c[a.heir] && S.c[a.heir].active && S.c[a.heir].heirOf === fk ? a.heir : -1;
	if (kk < 0) kk = prepareHeir(S, fk);
	if (kk < 0) return -1;
	const b = S.c[kk];
	b.heirOf = -1;
	a.heir = -1;
	b.K = a.K;
	b.land = a.land;
	for (let j = 0; j < NPROD; j++) (b.capInv[j] += a.capInv[j]), (b.inv[j] += a.inv[j]);
	b.stock = a.stock;
	b.reqEma = a.reqEma;
	b.zEma = 1;
	b.priceR = a.priceR;
	b.price = b.priceR / Math.max(1e-9, S.Ptw[kk]);
	b.graceUntil = S.t + 180;
	b.leaseFee = S.P[CITY] > 0 ? (capCostR(S, fk) * a.K * 0.06) / 365 / S.P[CITY] : 0; // 6 %/yr of the plant's value, in CITYmind
	let As = 0, n = 0;
	for (let k = 0; k < M; k++) if (k !== fk && S.c[k].active && SPECS[k].product === g) (As += S.c[k].A), n++;
	b.A = Math.max(a.A, n ? As / n : a.A); // new management brings the rivals' average practice
	b.ga = drawGrowth(S);
	a.K = 0;
	a.land = 0;
	a.capInv.fill(0);
	a.inv.fill(0);
	a.stock = 0;
	return kk;
}

/**
 * a COOP ends (failure: treasury dry and losing; exit: it lost its market): its MIND leaves the pools (the pools' reserve
 * of it is retired), what its treasury holds of other MINDs goes to the holders of its MIND pro rata, and all of its MIND
 * is retired: it is worth nothing from now on
 */
function endCoop(S, k, type, why, B) {
	const co = S.c[k], P = S.P, N = S.N;
	const kk = type === 'fail' && co.K > 0 ? successor(S, k, B) : -1;
	if (co.heir >= 0 && kk < 0 && S.c[co.heir]?.active && S.c[co.heir].heirOf === k) {
		const h = co.heir;
		co.heir = -1;
		endCoop(S, h, 'exit', `handover from ${NAMES[k]} called off`, B);
	}
	co.heir = -1;
	// the pools: retire their reserve of it, and take it out
	for (let pi = 0; pi < S.pools.length; pi++) {
		const p = S.pools[pi], at = p.pos[k];
		if (at < 0) continue;
		B.lossPoolR += p.x[at] * P[k];
		S.tot.burned += p.x[at];
		B.burned += p.x[at];
		const keep = p.m.map((_, i) => i).filter((i) => i !== at);
		p.m = keep.map((i) => p.m[i]);
		p.x = Float64Array.from(keep.map((i) => p.x[i]));
		p.depR = Float64Array.from(keep.map((i) => p.depR[i]));
		p.pos = new Int32Array(M).fill(-1);
		p.m.forEach((m, i) => (p.pos[m] = i));
		if (p.m.length < 2) {
			p.dead = true;
			p.live = false;
			for (const m of p.m) S.c[m].baskets = S.c[m].baskets.filter((x) => x !== pi);
		}
	}
	co.baskets = [];
	// liquidation: its treasury's other MINDs to the holders of its MIND (people and other treasuries)
	const H = holders(S, k);
	for (let j = 0; j < M; j++) {
		const a = co.tre[j];
		if (j === k || !(a > 0)) continue;
		co.tre[j] = 0;
		if (H > 0) {
			const f = a / H;
			let hh = 0;
			for (let i = 0; i < N; i++) {
				const d = Math.max(0, S.hold[i * M + k]) * f;
				S.hold[i * M + j] += d;
				S.inc[i] += d * P[j];
				hh += d;
			}
			for (let x = 0; x < M; x++) if (x !== k && S.c[x].active) S.c[x].tre[j] += Math.max(0, S.c[x].tre[k]) * f;
			B.liqHHR += hh * P[j];
			B.liqTR += (a - hh) * P[j];
		} else (S.tot.burned += a), (B.burned += a);
	}
	// retire all of its MIND: in its own treasury, its pool dues, in wallets and in other treasuries
	let r = co.tre[k] + co.poolDue;
	B.burnTreR += r * P[k];
	co.tre[k] = 0;
	co.poolDue = 0;
	for (let i = 0; i < N; i++) (B.lossWalR += S.hold[i * M + k] * P[k]), (r += S.hold[i * M + k]), (S.hold[i * M + k] = 0), (S.alloc[i * M + k] = 0), (S.values[i * M + k] = 0);
	// its founders go back to investing as their Avens advise (the City's MIND until their next allocation step)
	for (let i = 0; i < N; i++) if (S.founder[i] === k) (S.founder[i] = -1), (S.alloc[i * M + CITY] = 1);
	for (let x = 0; x < M; x++) if (x !== k) (B.lossTreR += S.c[x].tre[k] * P[k]), (r += S.c[x].tre[k]), (S.c[x].tre[k] = 0);
	r += S.arb[k];
	S.arb[k] = 0;
	S.tot.burned += r;
	B.burned += r;
	co.active = false;
	co.failed = true;
	co.endT = S.t;
	co.endWhy = why;
	co.K = 0;
	co.land = 0;
	co.capInv.fill(0);
	co.inv.fill(0);
	co.stock = 0;
	P[k] = 0;
	S.Ptw[k] = 0;
	// the reference unit R follows the successor (or the largest remaining seller of the same product)
	const ri = S.ref.indexOf(k);
	if (ri >= 0) {
		let alt = kk;
		if (alt < 0) {
			let best = 0;
			for (let x = 0; x < M; x++) if (S.c[x].active && SPECS[x].product === SPECS[k].product && S.c[x].made > best) (best = S.c[x].made), (alt = x);
		}
		if (alt >= 0) S.ref[ri] = alt;
		else S.ref.splice(ri, 1);
	}
	if (type === 'fail') B.failN++;
	else B.exitN++;
	S.events.push({ t: S.t, type, k, name: NAMES[k], product: SPECS[k].product, note: why + (kk >= 0 ? `; the City leases its plant to ${NAMES[kk]}` : '') });
	S.watchF.push(S.t + 180);
	buildGraph(S);
}

/** margins, cash flow, foundings, failures and exits, at the end of a step */
function lifecycle(S, dt, B) {
	const c = S.c, sc = S.sc, a90 = Math.min(1, dt / 90);
	const out = new Float64Array(NPROD), mw = new Float64Array(NPROD), n = new Int32Array(NPROD);
	const pLo = new Float64Array(NPROD).fill(Infinity), pHi = new Float64Array(NPROD).fill(0);
	for (let k = 0; k < M; k++) {
		const co = c[k], sp = SPECS[k];
		if (!co.active || sp.product < 0) continue;
		co.netEma += a90 * ((co.inR - co.outR) / dt - co.netEma);
		co.inR = co.outR = 0;
		const fc = fullCostR(S, k), m = fc > 0 ? co.priceR / fc - 1 : 0;
		co.marginEma += a90 * (m - co.marginEma);
		if (co.Keff > 0) (out[sp.product] += co.made), (mw[sp.product] += co.made * co.marginEma), n[sp.product]++;
		// the year's competition record: what each seller made and sold (R), sellers a day, the price gap between rivals
		if (co.made > 0) {
			B.madeN[NAMES[k]] = (B.madeN[NAMES[k]] || 0) + co.made * dt;
			B.prodN[NAMES[k]] = sp.product;
			B.revN[NAMES[k]] = (B.revN[NAMES[k]] || 0) + co.made * co.priceR * dt;
			if (co.Keff > 0) (pLo[sp.product] = Math.min(pLo[sp.product], co.priceR)), (pHi[sp.product] = Math.max(pHi[sp.product], co.priceR));
		}
		if (co.made > 0 && (!S.lastSpec[sp.product] || co.made >= S.lastSpec[sp.product].made * 0.5)) S.lastSpec[sp.product] = { spec: sp, A: co.A, priceR: co.priceR, made: Math.max(co.made, S.lastSpec[sp.product]?.made || 0) };
	}
	for (let g = 0; g < NPROD; g++) {
		B.sellD[g] += n[g] * dt;
		if (n[g] >= 2 && pHi[g] > 0) (B.spreadSum[g] += (pHi[g] / pLo[g] - 1) * dt), (B.spreadD[g] += dt);
	}
	for (let k = 0; k < M; k++) {
		const co = c[k], sp = SPECS[k];
		if (!co.active || sp.product < 0 || k === CITY) continue;
		const cover = co.costEma > 0 ? valueOf(S, co.tre) / co.costEma : 99;
		// failure: the treasury runs dry (under 30 days of running costs) and it keeps losing MIND, for 180 days
		if (cover < 30 && co.netEma < 0) co.dryDays += dt;
		else co.dryDays = Math.max(0, co.dryDays - dt);
		// exit: a small COOP that lost its market (under 2 % of its product for a year while others sell it, and its plant
		// under 5 % of the market: a big idle plant stays as a standby rival and fails only if its treasury runs dry) winds
		// up, and so does a newly founded one that never built its first plant in 3 years
		const share = out[sp.product] > 0 ? co.made / out[sp.product] : 1;
		if (n[sp.product] >= 2 && share < 0.02 && co.Keff < 0.05 * out[sp.product] && S.t - co.bornT > 730) co.lowDays += dt;
		else co.lowDays = 0;
		if (co.K > 0 && co.dryDays >= 90 && !(co.heir >= 0)) prepareHeir(S, k);
		else if (co.heir >= 0 && co.dryDays <= 0 && S.c[co.heir]?.active && S.c[co.heir].heirOf === k) {
			const h = co.heir;
			co.heir = -1;
			endCoop(S, h, 'exit', `handover from ${NAMES[k]} called off (it recovered)`, B);
		}
		if (co.heirOf >= 0) continue;
		if (co.dryDays >= 180) endCoop(S, k, 'fail', 'treasury dry and losing MIND for 180 days', B);
		else if (co.lowDays >= 365) endCoop(S, k, 'exit', 'lost its market (under 2 % for a year)', B);
		else if (co.K <= 0 && S.t - co.bornT > 3 * 365) endCoop(S, k, 'exit', 'never built its first plant', B);
	}
	const building = new Uint8Array(NPROD);
	for (let k = 0; k < M; k++) if (c[k].active && SPECS[k].product >= 0 && c[k].K <= 0) building[SPECS[k].product] = 1;
	for (let g = 0; g < NPROD; g++) {
		if (g === WATER) continue;
		// every seller of a product has ended: founders open a new COOP for it at once (people still want it)
		if (!(out[g] > 0)) {
			let alive = 0;
			for (let k = 0; k < M; k++) if (c[k].active && SPECS[k].product === g) alive++;
			if (!alive && S.lastSpec[g] && S.t - S.lastFound[g] >= 180) found(S, g, B);
			continue;
		}
		const m = mw[g] / out[g];
		S.highDays[g] = m > 0.3 ? S.highDays[g] + dt : 0;
		// a rival is founded when the product's margin over full cost (sales-weighted, smoothed over 90 days) stayed above
		// 30 % for 90 days, from year sc.foundFrom, at most one every sc.foundGap years a product, none while one is building
		if (S.highDays[g] >= 90 && S.t >= sc.foundFrom * 365 && S.t - S.lastFound[g] >= sc.foundGap * 365 && !building[g] && n[g] < (g === EXPER ? sc.maxSellers + 2 : sc.maxSellers)) found(S, g, B);
	}
}

function step(S, dt) {
	const B = S.cur;
	if (!S.vH) {
		const hi0 = heartIndex(S);
		S.vH = hi0.v;
		S.hpH = hi0.hp;
	}
	let hSnap = HKEYS.map((k) => B[k] || 0);
	if (S.sc.popGrowth) grow(S, dt);
	meltAll(S, Math.exp((-RATE * dt) / 365));
	if (S.sc.dynamic) world(S, dt, B);
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
	if (S.sc.dynamic) proofStep(S, dt, T, B);
	eligible(S, dt, B);
	capTreasuries(S, B);
	capacity(S, dt);
	deposits(S, dt);
	arbitrage(S);
	heartFlows(B, hSnap, S.hpH);
	hSnap = HKEYS.map((k) => B[k] || 0);
	const Pold = S.sc.dynamic ? Float64Array.from(S.P) : null;
	updatePrices(S, dt);
	if (Pold) revalue(S, Pold, B);
	adjust(S, dt);
	const rentNow = B.rentR;
	S.c[CITY].rentEma = (S.c[CITY].rentEma || 0) + Math.min(1, dt / 90) * ((rentNow - (S._rentPrev || 0)) / dt - (S.c[CITY].rentEma || 0));
	S._rentPrev = rentNow;
	updateAlloc(S, dt);
	if (S.sc.dynamic) lifecycle(S, dt, B);
	{
		const hiE = heartIndex(S);
		heartFlows(B, hSnap, hiE.hp);
		const dv = new Float64Array(M);
		for (let k = 0; k < M; k++) dv[k] = hiE.v[k] - S.vH[k];
		const rv = heartPlaces(S, dv);
		B.hRevW += rv.w;
		B.hRevT += rv.t;
		B.hRevP += rv.p;
		B.hRevA += rv.a;
		S.vH = hiE.v;
		S.hpH = hiE.hp;
	}
	B.steps++;
	B.days += dt;
	S.t += dt;
	if (Math.floor(S.t / 365) > S.Y.length) closeYear(S);
}

/**
 * the dynamic world's round trip in R: what the price moves of a step did to the R value of what wallets, treasuries
 * and pools hold (MIND prices move a lot here, so the yearly change of what a place holds is flows plus revaluation)
 */
function revalue(S, Pold, B) {
	const P = S.P, N = S.N, c = S.c;
	const d = new Float64Array(M);
	let any = false;
	for (let k = 0; k < M; k++) if ((d[k] = P[k] - Pold[k]) !== 0) any = true;
	if (!any) return;
	let w = 0, t = 0, p = 0, a = 0;
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) if (d[k] !== 0) w += S.hold[i * M + k] * d[k];
	for (let j = 0; j < M; j++) {
		if (!c[j].active && !c[j].failed) continue;
		for (let k = 0; k < M; k++) t += c[j].tre[k] * d[k];
		t += c[j].poolDue * d[j];
	}
	for (const pl of S.pools) for (let i = 0; i < pl.m.length; i++) p += pl.x[i] * d[pl.m[i]];
	for (let k = 0; k < M; k++) a += S.arb[k] * d[k];
	B.revalW += w;
	B.revalT += t;
	B.revalP += p;
	B.revalA += a;
}

/** the dynamic world's yearly record: units people can feel, dispersion, competition, and the per-person proof checks */
function dynYear(S, B, W, split, yk) {
	const N = S.N, P = S.P, c = S.c;
	const inc = B.walHeartR + B.wagesR + B.propR + B.divHHR + B.liqHHR;
	// a day of living: what an average person's daily consumption costs, R
	const L = B.pd > 0 ? B.salesHHR / B.pd : null;
	// MIND prices of the COOPs that are alive: min, max, spread of log prices
	const lp = [];
	for (let k = 0; k < M; k++) if (c[k].active && S.live[k] && P[k] > 0) lp.push(Math.log(P[k]));
	const mu = lp.reduce((a, b) => a + b, 0) / Math.max(1, lp.length);
	const sdLog = lp.length > 1 ? Math.sqrt(lp.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (lp.length - 1)) : 0;
	// each MIND's return this year: price change plus dividends (paid in itself), from the start of the year
	// (only for a COOP that was alive under the same name all year; a COOP that ended this year: −100 %, all its MIND
	// retired, before what its treasury's other MINDs paid out to its holders)
	const rk = new Array(M).fill(null), rn = {}, pn = S.prevNames, P0y = S.prevP0;
	if (P0y && pn)
		for (let k = 0; k < M; k++) {
			if (pn[k] === null) continue;
			if (pn[k] === NAMES[k] && c[k].active && P0y[k] > 0 && P[k] > 0) (rk[k] = (P[k] * (1 + yk[k])) / P0y[k] - 1), (rn[NAMES[k]] = { r: rk[k], y: yk[k], p: P[k] / P0y[k] - 1, prod: SPECS[k].product });
			else if (pn[k] !== NAMES[k] || !c[k].active) rn[pn[k]] = { r: -1, y: 0, p: -1, prod: null, ended: true };
		}
	// competition: per product, sellers a day, each seller's share of what was made this year, the price gap between rivals
	const comp = [];
	for (let g = 0; g < NPROD; g++) {
		const sh = {};
		let tot = 0;
		for (const nm in B.madeN) if (B.prodN[nm] === g) (sh[nm] = B.madeN[nm]), (tot += B.madeN[nm]);
		for (const nm in sh) sh[nm] /= tot;
		comp.push({ sellers: B.days > 0 ? B.sellD[g] / B.days : 0, shares: sh, spread: B.spreadD[g] > 0 ? B.spreadSum[g] / B.spreadD[g] : null, spreadDays: B.spreadD[g] });
	}
	// real consumption a person (base-year prices, R a day): by decile, the zero-Aven group, the poorest person
	const real = new Float64Array(N), days = Math.max(1e-9, S.realDays);
	let zr = 0, zn = 0, zMin = Infinity, zW = 0, zWmin = Infinity;
	for (let i = 0; i < N; i++) {
		real[i] = S.realAcc[i] / days;
		S.realAcc[i] = 0;
		if (S.zeroAven[i]) (zr += real[i]), zn++, (zMin = Math.min(zMin, real[i])), (zW += W[i]), (zWmin = Math.min(zWmin, W[i]));
	}
	S.realDays = 0;
	const sorted = Array.from(real).sort((a, b) => a - b);
	const dec = [];
	for (let d = 0; d < 10; d++) {
		const a = Math.floor((d * N) / 10), b = Math.floor(((d + 1) * N) / 10);
		let s = 0;
		for (let i = a; i < b; i++) s += sorted[i];
		dec.push(s / Math.max(1, b - a));
	}
	const cpi = B.cpiN ? B.cpiSum / B.cpiN : null; // a day's basic bundle, R
	const mindR = split.total > 0 ? split.totalR / split.total : 1; // R a MIND, on average over all MIND
	return {
		L, inc: inc / Math.max(1, B.pd), spend: B.salesHHR / Math.max(1, B.pd), spendShare: inc > 0 ? B.salesHHR / inc : null,
		meltWshare: inc > 0 ? B.meltWR / inc : null, treShareR: split.totalR > 0 ? split.treR / split.totalR : null,
		poolShareR: split.totalR > 0 ? split.poolR / split.totalR : null, pMin: lp.length ? Math.exp(Math.min(...lp)) : null,
		pMax: lp.length ? Math.exp(Math.max(...lp)) : null, sdLog, nLive: lp.length, rk,
		wage: B.days > 0 ? B.wageSum / B.days : null, avenU: B.days > 0 ? B.avenUSum / B.days : null,
		covMin: B.covMin, shortPd: B.sAny, pd: B.pd, watchPd: B.watchPd, watchShort: B.watchShort, watchCov: B.watchCov,
		watchFPd: B.watchFPd, watchFShort: B.watchFShort, watchFCov: B.watchFCov, zWminStep: B.zWminStep, rn, comp, N,
		zPd: B.zPd, zStrictShare: B.zPd > 0 ? B.zStrictOk / B.zPd : null, zStrictMin: B.zStrictMin, zStrictMean: B.zPd > 0 ? B.zStrictSum / B.zPd : null,
		zCovMin: B.zCovMin, zShort: B.zShort, zW: zn ? zW / zn : null, zWmin: zn ? zWmin : null, zReal: zn ? zr / zn : null, zRealMin: zn ? zMin : null,
		dec, realMean: real.reduce((a, b) => a + b, 0) / N, giniReal: gini(real, N), realMin: sorted[0], newPd: B.newPd, newS: B.newS,
		basicR: cpi, basicMind: cpi !== null ? cpi / mindR : null, mindR,
		failN: B.failN, exitN: B.exitN, foundN: B.foundN, shockN: B.shockN, rotR: B.rotR, meltCnt: B.meltCnt, burned: B.burned,
		liqHH: B.liqHHR, liqT: B.liqTR, lossWal: B.lossWalR, lossTre: B.lossTreR, lossPool: B.lossPoolR, burnTre: B.burnTreR,
		meanA: (() => {
			let a = 0, w = 0;
			for (let k = 0; k < M; k++) if (c[k].active && SPECS[k].product >= 0) (a += c[k].A * c[k].made * c[k].priceR), (w += c[k].made * c[k].priceR);
			return w > 0 ? a / w : null;
		})(),
		coops: c.map((co, k) => ({ name: NAMES[k], product: SPECS[k].product, active: co.active, failed: co.failed, made: co.made, priceR: co.priceR, A: co.A, ga: co.ga, K: co.K, P: P[k], cover: co.active && co.costEma > 0 ? valueOf(S, co.tre) / co.costEma : null, bornT: co.bornT, endT: co.endT }))
	};
}

// ── HEARTS as the unit of account (the paper's unit, Section 6.3; display only) ─────────────────────────────────────
// Every MIND is minted 1:1 from HEARTS, so the average MIND in existence is worth 1 HEART. The pools set only how each
// MIND stands against the others. So the MINDs the pools price are scaled together until their supply-weighted average
// is 1 HEART (Σ supply·value = Σ supply), and a MIND the pools cannot price yet counts at 1 HEART (the game's rule).
// Nothing in the simulation reads these values, so every move, price and trade stays the same. Flows are valued at the
// HEART values of the step in which they happen; price moves are what the change of HEART values from one step to the
// next did to what each place holds. The report's sections H1–H8 print them.
const HKEYS = ['payR', 'cpiSum', 'rentR', 'wagesR', 'divR', 'propR', 'treInR', 'heartInR', 'salesHHR', 'b2bR', 'walHeartR', 'poolHeartR', 'divHHR', 'divTR', 'meltWR', 'meltTR', 'meltPR', 'meltAR', 'liqHHR', 'liqTR', 'lossWalR', 'lossTreR', 'lossPoolR', 'burnTreR', 'rotR', 'arbR', 'routeCost', 'routeFee', 'routeIn', 'wageSum'];
function heartIndex(S) {
	const N = S.N, P = S.P, c = S.c, s = new Float64Array(M);
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) s[k] += S.hold[i * M + k];
	for (let j = 0; j < M; j++) {
		if (!c[j].active && !c[j].failed) continue;
		for (let k = 0; k < M; k++) s[k] += c[j].tre[k];
		s[j] += c[j].poolDue;
	}
	for (const p of S.pools) for (let i = 0; i < p.m.length; i++) s[p.m[i]] += p.x[i];
	for (let k = 0; k < M; k++) s[k] += S.arb[k];
	let units = 0, worth = 0, all = 0, allR = 0, n = 0;
	for (let k = 0; k < M; k++) {
		all += s[k];
		allR += s[k] * P[k];
		if (S.live && S.live[k] && s[k] > 0 && P[k] > 0) (units += s[k]), (worth += s[k] * P[k]), n++;
	}
	const hp = n >= 2 && units > 0 && worth > 0 ? worth / units : null;
	const v = new Float64Array(M);
	for (let k = 0; k < M; k++) v[k] = hp !== null && S.live[k] && P[k] > 0 ? P[k] / hp : 1;
	return { v, hp: hp ?? 1, priced: hp !== null, unpriced: all > 0 ? 1 - (hp !== null ? units : 0) / all : 1, hU: all > 0 ? allR / all : 1, all };
}
/** what wallets, treasuries (with what waits for the pools), pools and the arbitrage bot hold, at the values v */
function heartPlaces(S, v) {
	const N = S.N, c = S.c;
	let w = 0, t = 0, p = 0, a = 0;
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) w += S.hold[i * M + k] * v[k];
	for (let j = 0; j < M; j++) {
		if (!c[j].active && !c[j].failed) continue;
		for (let k = 0; k < M; k++) t += c[j].tre[k] * v[k];
		t += c[j].poolDue * v[j];
	}
	for (const pl of S.pools) for (let i = 0; i < pl.m.length; i++) p += pl.x[i] * v[pl.m[i]];
	for (let k = 0; k < M; k++) a += S.arb[k] * v[k];
	return { w, t, p, a };
}
function heartFlows(B, snap, hp) {
	for (let i = 0; i < HKEYS.length; i++) {
		const k = HKEYS[i], d = (B[k] || 0) - snap[i];
		if (d) B.hFlows[k] = (B.hFlows[k] || 0) + d / hp;
	}
}
/** the year in HEARTS: called at the start of closeYear, while S.prevHold and S.prevNames still hold last year's */
function heartYear(S, B) {
	if (!S.HY) S.HY = [];
	const N = S.N, c = S.c, v = S.vH, hi = heartIndex(S), pl = heartPlaces(S, v);
	const yk = new Float64Array(M);
	for (let k = 0; k < M; k++) if (B.eligK[k] > 0) yk[k] = B.divK[k] / (B.eligK[k] / B.days);
	const vr = S.sc.dynamic && S.prevNames ? Array.from(v, (x, k) => (S.prevNames[k] === null || S.prevNames[k] === NAMES[k] ? x : 0)) : Array.from(v);
	let muH = null, sgH = null, muPH = null;
	if (S.prevHold && S.prevVH && S.prevN <= N) {
		const lr = [], lp = [];
		for (let i = 0; i < S.prevN; i++) {
			let a = 0, b = 0, d = 0;
			for (let k = 0; k < M; k++) {
				const h = S.prevHold[i * M + k];
				a += h * S.prevVH[k];
				b += h * vr[k];
				d += h * vr[k] * yk[k];
			}
			if (a > 0 && b > 0 && isFinite(d)) lr.push(Math.log((b + d) / a)), lp.push(Math.log(b / a));
		}
		if (lr.length > 10) {
			muH = lr.reduce((x, y) => x + y, 0) / lr.length;
			muPH = lp.reduce((x, y) => x + y, 0) / lp.length;
			sgH = Math.sqrt(lr.reduce((x, y) => x + (y - muH) * (y - muH), 0) / (lr.length - 1));
		}
	}
	const rnH = {};
	if (S.sc.dynamic && S.prevVH && S.prevNames)
		for (let k = 0; k < M; k++) {
			const pn = S.prevNames;
			if (pn[k] === null) continue;
			if (pn[k] === NAMES[k] && c[k].active && S.prevVH[k] > 0 && v[k] > 0) rnH[NAMES[k]] = { r: (v[k] * (1 + yk[k])) / S.prevVH[k] - 1, y: yk[k], p: v[k] / S.prevVH[k] - 1, prod: SPECS[k].product };
			else if (pn[k] !== NAMES[k] || !c[k].active) rnH[pn[k]] = { r: -1, y: 0, p: -1, prod: null, ended: true };
		}
	let zW = 0, zn = 0;
	if (S.zeroAven) for (let i = 0; i < N; i++) if (S.zeroAven[i]) {
		let w = 0;
		for (let k = 0; k < M; k++) w += S.hold[i * M + k] * v[k];
		zW += w;
		zn++;
	}
	const lv = [];
	for (let k = 0; k < M; k++) if (c[k].active && S.live[k] && S.P[k] > 0) lv.push(v[k]);
	const baseV = Array.from(v).slice(0, BASE_COOPS);
	S.HY.push({
		year: S.Y.length + 1, N, days: B.days, pd: B.pd, hp: S.hpH, hpCheck: hi.hp, hU: hi.hU, unpriced: hi.unpriced, count: hi.all,
		v: Array.from(v), yk: Array.from(yk), pl, flows: { ...B.hFlows }, rev: { W: B.hRevW, T: B.hRevT, P: B.hRevP, A: B.hRevA },
		zWmin: B.hZWmin, zW: zn ? zW / zn : null, muH, sgH, muPH, rnH, vMin: lv.length ? Math.min(...lv) : null, vMax: lv.length ? Math.max(...lv) : null,
		vMinBase: Math.min(...baseV.filter((x) => x > 0)), vMaxBase: Math.max(...baseV),
		cpi: B.cpiN ? (B.hFlows.cpiSum || 0) / B.cpiN : null, L: B.pd > 0 ? (B.hFlows.salesHHR || 0) / B.pd : null,
		giniH: (() => {
			// the Gini of what people hold, valued in HEARTS at the year's end
			const Wh = new Float64Array(N);
			for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) Wh[i] += S.hold[i * M + k] * v[k];
			return gini(Wh, N);
		})()
	});
	S.prevVH = Float64Array.from(v);
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
	heartYear(S, B);
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
	// (dynamic world: a slot whose COOP ended this year and was reused counts at 0 for what was held of the old COOP)
	const Pr = S.sc.dynamic && S.prevNames ? P.map((p, k) => (S.prevNames[k] === null || S.prevNames[k] === NAMES[k] ? p : 0)) : P;
	if (S.prevHold && S.prevN <= N) {
		const lr = [], lp = [];
		for (let i = 0; i < S.prevN; i++) {
			let a = 0, b = 0, d = 0;
			for (let k = 0; k < M; k++) {
				const h = S.prevHold[i * M + k];
				a += h * S.prevP[k];
				b += h * Pr[k];
				d += h * Pr[k] * yk[k];
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
	// the people whose Avens (or, in the old world, whose own hours) earn the top half of work pay, against the rest
	let wW = 0, nW = 0, wO = 0, nO = 0;
	const med = Array.from(S.workH.subarray(0, N)).sort((x, y) => x - y)[Math.floor(N / 2)];
	for (let i = 0; i < N; i++) if (S.workH[i] > med) (wW += W[i]), nW++;
		else (wO += W[i]), nO++;
	S.prevHold = S.hold.slice(0, N * M);
	S.prevP0 = S.prevP;
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
	const dyn = S.sc.dynamic ? dynYear(S, B, W, split, yk) : null;
	if (S.sc.dynamic) S.prevNames = c.map((co, k) => (co.active ? NAMES[k] : null));
	S.Y.push({
		dyn,
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
		yk: Array.from(yk), flows: { heartIn: B.heartInR, salesHH: B.salesHHR, b2b: B.b2bR, rent: B.rentR, wages: B.wagesR, prop: B.propR, div: B.divR },
		rt: {
			walHeart: B.walHeartR, treHeart: B.heartInR, poolHeart: B.poolHeartR, ops: B.wagesR, prop: B.propR, divHH: B.divHHR, divT: B.divTR,
			buy: B.salesHHR, b2b: B.b2bR, rent: B.rentR, routeCost: B.routeCost, routeFee: B.routeFee,
			meltW: B.meltWR, meltT: B.meltTR, meltP: B.meltPR, meltA: B.meltAR, days: B.days,
			// dynamic world: price moves (revaluation), what a COOP that ended paid out of its treasury to its holders, and the
			// MIND that was retired with it (in wallets, other treasuries, its own treasury, the pools)
			revalW: B.revalW, revalT: B.revalT, revalP: B.revalP, revalA: B.revalA, liqHH: B.liqHHR, liqT: B.liqTR,
			lossWal: B.lossWalR, lossTre: B.lossTreR, burnTre: B.burnTreR, lossPool: B.lossPoolR
		}
	});
	S.cur = newBucket();
}

// ── scenarios ────────────────────────────────────────────────────────────────────────────────────────────────────────
const N0 = QUICK ? 120 : 250;
const BASE = { N0, seed: 20261012, seedCap: 1.15, mech: 'b', turnDiv: 0.2, poolShare: POOL_SHARE, payout: 12, divShare: 0, wageR: WAGE_R, capDays: 60, arbTo: 'bot', avenRule: 'price', popGrowth: 0, years: 60 };
// the dynamic world (the new main): free prices, rivals in every good, experiences, reserves of 9 months, productivity
// growth, shocks, foundings and failures, a zero-Aven test group (every tenth person)
const DYN = {
	...BASE, dynamic: true, capDays: 270, spendRate: 0.5, zeroAven: true, prodGrowth: true,
	prodMean: 0.02, prodSd: 0.015, shockRate: 0.05, tasteSd: 0.15, maxSellers: 4, founderShare: 0.04, growth: true, foundFrom: 3, foundGap: 2,
	avenMarket: false
};
const DAILY_YEARS = 1;
const DAILY_AFTER = 90; // days of daily steps after a shock

/** run until a day, daily for the first year and for 90 days after a shock, weekly in between */
function advance(S, until, dailyFrom = -1e9) {
	bind(S);
	while (S.t < until - 1e-9) {
		const daily = S.t < DAILY_YEARS * 365 || (S.t >= dailyFrom && S.t < dailyFrom + DAILY_AFTER);
		const dt = daily ? 1 : Math.min(7, until - S.t);
		step(S, dt);
	}
}

const clone = (S) => {
	const X = structuredClone(S);
	bind(X);
	return X;
};

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
// ── debug: one dynamic run, a line a year (--dyn YEARS [--set key=value,…]) ─────────────────────────────────────────────
if (ARGS.includes('--dyn')) {
	const yrs = +(ARGS[ARGS.indexOf('--dyn') + 1] || 20);
	const extra = {};
	if (ARGS.includes('--set')) for (const kv of ARGS[ARGS.indexOf('--set') + 1].split(',')) extra[kv.split('=')[0]] = +kv.split('=')[1];
	const S = init({ ...DYN, years: yrs, ...extra });
	const d1 = Date.now();
	const r2 = (x, d = 2) => (x === null || x === undefined || !isFinite(x) ? '-' : (+x).toFixed(d));
	let last = 0;
	while (S.t < yrs * 365 - 1e-9) {
		advance(S, Math.min(yrs * 365, S.t + 365));
		const y = S.Y[S.Y.length - 1], d = y.dyn;
		console.log(`y${y.year} short ${r2(y.short * 100)}% [${y.shortG.map((x) => r2(x * 100, 1)).join(" ")}] covMin ${r2(d.covMin)} L ${r2(d.L)} inc ${r2(d.inc)} spend ${r2(d.spend)} (${r2(d.spendShare * 100, 0)}%) meltW ${r2(d.meltWshare * 100, 0)}% tre ${r2(d.treShareR * 100, 0)}% ppl ${r2(y.peopleShareR * 100, 0)}% wage ${r2(d.wage)} u ${r2(d.avenU)} yield ${r2(y.yield * 100)}% mu ${r2((y.muRet ?? 0) * 100)}% P[${r2(d.pMin)}..${r2(d.pMax)}] sd ${r2(d.sdLog, 3)} live ${d.nLive} f/e/n ${d.failN}/${d.exitN}/${d.foundN} A ${r2(d.meanA)} basic ${r2(d.basicR)} z: strict ${r2(d.zStrictShare * 100, 0)}% min ${r2(d.zStrictMin)} cov ${r2(d.zCovMin)} W ${r2(d.zW, 0)} real ${r2(d.zReal)} dec ${r2(d.dec[0])}..${r2(d.dec[9])} m ${Math.round(y.mPer)} gini ${r2(y.gini)} (${((Date.now() - d1) / 1000).toFixed(1)} s)`);
		const pr = d.coops.map((c, k) => (c.active && c.product >= 0 ? `${c.name}:${r2(c.P)}/${c.priceR.toPrecision(2)}/${r2(c.made / Math.max(1e-9, 1), 0)}${c.cover !== null ? '/' + Math.round(c.cover) : ''}` : null)).filter(Boolean);
		console.log('   ', pr.join(' '));
		console.log('    occ', r2(S.occ), 'rho', S.rho.toExponential(2), 'unmet', Math.round(S.leaseUnmet), 'building', S.c.map((c, k) => (c.active && SPECS[k].product >= 0 && c.K <= 0 ? `${NAMES[k]} mod ${c.module.toPrecision(3)} land ${Math.round(c.land)}/${Math.round(SPECS[k].land * c.module)} cap ${SPECS[k].capital.map(([j, q]) => (c.capInv[j] / (q * c.module)).toFixed(2)).join(',')} V ${Math.round(valueOf(S, c.tre))} cost ${Math.round(c.costEma)}` : null)).filter(Boolean).join(' | '));
		for (const e of S.events.slice(last)) if (e.type !== 'shock' || process.env.SHOCKS) console.log('    *', (e.t / 365).toFixed(2), e.type, e.name, e.note);
		last = S.events.length;
	}
	console.log('time', (Date.now() - d1) / 1000, 's');
	process.exit(0);
}

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

// ── the seed check: the dynamic main on several seeds (--seeds 20261012-20261019 [--set key=value,…]) ────────────────
// One seed is one history. Each seed runs in its own process (--seed-run SEED: the same run as the full script's dynamic
// main), four at a time; the table gives μ and σ at rest in HEARTS, the margin below the melt, both Ginis and the proof
// checks of Proposition 3.
const SET = {};
if (ARGS.includes('--set')) for (const kv of ARGS[ARGS.indexOf('--set') + 1].split(',')) SET[kv.split('=')[0]] = +kv.split('=')[1];
const SEED_RUN = ARGS.includes('--seed-run') ? { ...SET, seed: +ARGS[ARGS.indexOf('--seed-run') + 1] } : null;
if (ARGS.includes('--seeds')) {
	const arg = ARGS[ARGS.indexOf('--seeds') + 1];
	const seeds = arg.includes('-') ? Array.from({ length: +arg.split('-')[1] - +arg.split('-')[0] + 1 }, (_, i) => +arg.split('-')[0] + i) : arg.split(',').map(Number);
	const { spawn } = await import('node:child_process');
	const { fileURLToPath } = await import('node:url');
	const self = fileURLToPath(import.meta.url);
	const one = (seed) =>
		new Promise((ok, no) => {
			const args = [self, '--seed-run', String(seed), ...(QUICK ? ['--quick'] : []), ...(ARGS.includes('--set') ? ['--set', ARGS[ARGS.indexOf('--set') + 1]] : []), ...(ARGS.includes('--melt') ? ['--melt', String(RATE)] : [])];
			const ch = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
			let o = '';
			ch.stdout.on('data', (b) => (o += b));
			ch.on('close', (code) => (code ? no(new Error(`seed ${seed}: exit ${code}`)) : ok(JSON.parse(o))));
		});
	const res = new Array(seeds.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(4, seeds.length) }, async () => {
			while (next < seeds.length) {
				const i = next++;
				res[i] = await one(seeds[i]);
				process.stderr.write(`  seed ${seeds[i]} done (${((Date.now() - T0) / 1000).toFixed(1)} s)\n`);
			}
		})
	);
	const ok = (b) => (b ? '✓' : '✗');
	const set = [...Object.entries(SET).map(([k, v]) => `${k} = ${v}`), ...(ARGS.includes('--melt') ? [`melt ${pct(RATE, 0)}`] : [])].join(', ');
	const L = [];
	L.push(`# The seed check: the dynamic main on ${seeds.length} seeds${set ? ` (${set})` : ''}`, '');
	L.push(`Each row is the dynamic main of the full report on one seed: ${res[0].N} people, ${res[0].years} years, the pools' part ${f(res[0].poolShare, 2)} of each HEART, Law 5 at ${pct(res[0].turnDiv, 0)}. μ and σ: the mean and the spread across people of each person's yearly return in HEARTS (dividends plus price change, before the melt), at rest (the last 10 years). The margin is the ${pct(RATE, 0)} melt less μ. Proposition 3's checks are the report's proof checks 1–3 (check 2 normal, with the bundle under 12 MIND); "every tenth" is check 3 for the ten tenths alone.`, '');
	L.push('| Seed | μ at rest | margin (melt − μ) | σ | Prop. 2 Gini | measured Gini (HEARTS): last year; trend / 10 y | dividend yield | pools\' share of MIND | 1. no one starves (person-days short from day 8) | 2. no one has to work | 3. living standards rise | every tenth higher | all three |');
	L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: | :---: | :---: | :---: |');
	for (const r of res) L.push(`| ${r.seed} | ${pct(r.muH, 2)} | ${f(r.marginH * 100, 2)} pt | ${pct(r.sgH, 2)} | ${r.gini2H === null ? '–' : f(r.gini2H, 2)} | ${f(r.giniH.y60, 3)}; ${r.giniH.trend >= 0 ? '+' : ''}${f(r.giniH.trend, 3)} | ${pct(r.yield, 1)} | ${pct(r.pools, 1)} | ${ok(r.ok1)} ${f(r.shLate)} | ${ok(r.ok2)} | ${ok(r.ok3)} | ${ok(r.tenths)} | ${ok(r.all)} |`);
	L.push('');
	const mus = res.map((r) => r.muH), mg = res.map((r) => r.marginH);
	const sorted = [...mus].sort((a, b) => a - b), med = (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
	L.push(`μ at rest: ${pct(Math.min(...mus), 2)} to ${pct(Math.max(...mus), 2)} (median ${pct(med, 2)}); below the melt on ${mus.filter((m) => m < RATE).length} of ${res.length} seeds; smallest margin ${f(Math.min(...mg) * 100, 2)} pt (seed ${res[mg.indexOf(Math.min(...mg))].seed}). All three checks of Proposition 3 pass on ${res.filter((r) => r.all).length} of ${res.length} seeds (check 1 on ${res.filter((r) => r.ok1).length}, check 2 on ${res.filter((r) => r.ok2).length}, check 3 on ${res.filter((r) => r.ok3).length}; every tenth higher at each mark on ${res.filter((r) => r.tenths).length}). Measured Gini of holdings in the last year: ${f(Math.min(...res.map((r) => r.giniH.y60)), 2)}–${f(Math.max(...res.map((r) => r.giniH.y60)), 2)}.`, '');
	for (const r of res.filter((x) => !x.all)) L.push(`- ${r.seed}: ${r.why}.`);
	L.push('', `_Runtime ${((Date.now() - T0) / 1000).toFixed(1)} s._`);
	console.log(L.join('\n'));
	if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(res, null, 1));
	process.exit(0);
}

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
	['main', 'Law 5 at 20 % of every sale, every human\'s Aven works (main)', {}],
	['turn30', 'Law 5 at 30 % of every sale', { turnDiv: 0.3 }],
	['keep', 'Law 5 at 20 %, surplus kept (no work proposals)', { payout: 0 }],
	['main-w5', 'main, prices ×2.5 (wage 5 R/h)', { wageR: 5 }],
	['labour', 'old world: human labour paid, 40 % without work', { labour: true }],
	['aven-equal', 'main, all Avens deliver alike', { avenSigma: 0 }],
	['aven-wide', 'main, Avens differ twice as much', { avenSigma: 1.2 }],
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
	if (CSV) for (const y of S.Y) csvRows.push([name, y.year, y.N, y.short, y.newShort ?? '', y.route ?? '', y.cpi ?? '', y.mPer, y.split.wal / y.N, (y.split.treOwn + y.split.treOther) / y.N, y.split.pool / y.N, y.peopleShareR ?? '', y.gini, y.yield, y.muRet ?? '', y.sigma ?? '', y.divR / y.N, y.propR / y.N, ...y.P.slice(0, BASE_COOPS), ...new Array(NDYNCOL).fill(''), ...heartCols(S, y.year)].map((x) => (x === null || x === undefined || (typeof x === 'number' && !isFinite(x)) ? '' : x)).join(','));
}

const NDYNCOL = 30;
/** the HEART columns of a year (see heartIndex): R a HEART, μ and σ in HEARTS, the Gini of what people hold in HEARTS,
 *  a day of living and a day's basic bundle in HEARTS, and the pools' share of all MIND by HEART value */
const HEARTCOLS = 'R_per_HEART,mean_return_H,sigma_returns_H,gini_owned_H,days_of_living_H,basic_bundle_H,pool_share_H';
function heartCols(S, year) {
	const h = S.HY[year - 1], t = h.pl.w + h.pl.t + h.pl.p + h.pl.a;
	return [h.hp, h.muH, h.sgH, h.giniH, h.L, h.cpi, t > 0 ? h.pl.p / t : null];
}
function recordDyn(name, S) {
	results[name] = S;
	if (!CSV) return;
	for (const y of S.Y) {
		const d = y.dyn;
		const base = [name, y.year, y.N, y.short, y.newShort ?? '', y.route ?? '', y.cpi ?? '', y.mPer, y.split.wal / y.N, (y.split.treOwn + y.split.treOther) / y.N, y.split.pool / y.N, y.peopleShareR ?? '', y.gini, y.yield, y.muRet ?? '', y.sigma ?? '', y.divR / y.N, y.propR / y.N];
		const pb = BASE_NAMES.slice(0, BASE_COOPS).map((n, k) => (d.coops[k] && d.coops[k].name === n && d.coops[k].active ? y.P[k] : ''));
		const dz = [d.L, d.inc, d.spend, d.spendShare, d.meltWshare, d.treShareR, d.poolShareR, d.pMin, d.pMax, d.sdLog, d.nLive, d.covMin, d.shortPd, d.pd, d.zStrictShare, d.zStrictMin, d.zCovMin, d.zW, d.zWmin, d.basicMind, d.realMean, d.dec[0], d.dec[4], d.dec[9], d.zReal, d.failN, d.exitN, d.foundN, d.shockN, d.meanA];
		csvRows.push([...base, ...pb, ...dz, ...heartCols(S, y.year)].map((x) => (x === null || x === undefined || (typeof x === 'number' && !isFinite(x)) ? '' : x)).join(','));
	}
}

const tick = (what) => process.stderr.write(`  ran ${what} (${((Date.now() - T0) / 1000).toFixed(1)} s)\n`);

// the dynamic world first (it runs faster on a fresh heap): the new main and its ladders (Law 5 share, reserves, productivity growth and its spread, wants,
// the Avens' rate, a growing population), each from a cold start with goods; 60 years (the population row 40)
const DLADDER = [
	['main', 'dynamic main: Law 5 at 20 %, reserves 9 months', {}],
	['law35', 'Law 5 at 35 % of every sale', { turnDiv: 0.35 }],
	['law50', 'Law 5 at 50 % of every sale', { turnDiv: 0.5 }],
	['res6', 'reserves 6 months', { capDays: 180 }],
	['res12', 'reserves 12 months', { capDays: 365 }],
	['prod0', 'no productivity growth', { prodGrowth: false }],
	['even', 'productivity growth even (2 % a year for every COOP)', { prodSd: 0 }],
	['wide', 'productivity growth twice as uneven', { prodSd: 0.03 }],
	['wants', 'wants do not grow (no experiences)', { wantsGrow: false }],
	['aven', 'Avens with fixed capacity, their rate floats', { avenMarket: true }],
	['pop', 'population grows 2 % a year (newcomers)', { popGrowth: 0.02 }],
	['pool05', 'the old pool rule: 0.05 of each HEART to the pools', { poolShare: 0.05 }]
];
const dynYears = (key) => (QUICK ? (key === 'main' ? YRS : 12) : key === 'pop' ? 40 : YRS);
for (const [key, , extra] of SEED_RUN ? [['main', 'seed', SEED_RUN]] : DLADDER) {
	const yrs = dynYears(key);
	const S = init({ ...DYN, ...extra, years: yrs });
	advance(S, yrs * 365);
	recordDyn(`dyn:${key}`, S);
	if (key === 'main') tick('dynamic main');
}
tick('dynamic ladder');
// the static world (the previous main) and its branches, side runs and ladder; not in a seed run
if (!SEED_RUN) {
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
}

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

// ── report: the dynamic world (the new main) ─────────────────────────────────────────────────────────────────────────
const D = results['dyn:main'];
bind(D);
const dL = D.Y.length, dA = dL - 10, dB = dL; // the dynamic steady state: the last 10 years
const ok = (b) => (b ? '✓' : '✗');
const sumY = (S, fn, a = 0, b = Infinity) => S.Y.filter((y) => y.year > a && y.year <= b).reduce((s, y) => s + (fn(y) || 0), 0);
const minY = (S, fn, a = 0, b = Infinity) => {
	let m = Infinity, at_ = null;
	for (const y of S.Y) if (y.year > a && y.year <= b) {
		const v = fn(y);
		if (v !== null && v !== undefined && isFinite(v) && v < m) (m = v), (at_ = y.year);
	}
	return { v: m, year: at_ };
};
const maxY = (S, fn, a = 0, b = Infinity) => {
	const r = minY(S, (y) => {
		const v = fn(y);
		return v === null || v === undefined ? null : -v;
	}, a, b);
	return { v: -r.v, year: r.year };
};
const yrOf = (t) => Math.floor(t / 365) + 1;
const dayOf = (t) => `year ${yrOf(t)}, day ${Math.floor(t - 365 * (yrOf(t) - 1)) + 1}`;
const marksOf = (S, list) => [...new Set(list.concat([S.Y.length]))].filter((y) => y >= 1 && y <= S.Y.length).sort((a, b) => a - b);
const perPD = (S, a, b, fn) => avg(S, a, b, (y) => fn(y.rt, y) / y.N / Math.max(1, y.rt.days)); // R a person a day
const incomeOf = (r) => r.walHeart + r.ops + r.prop + r.divHH + (r.liqHH || 0);
const zN = (S) => {
	let n = 0;
	for (let i = 0; i < S.N; i++) n += S.zeroAven[i];
	return n;
};

/** the three per-person proof checks of a dynamic run */
function proof(S) {
	const pr = S.proof, L = S.Y.length;
	const pd = sumY(S, (y) => y.dyn.pd), sh = sumY(S, (y) => y.dyn.shortPd);
	const o = { pr, pd, sh, shLate: Math.max(0, sh - pr.weekShort), pdLate: pd - pr.weekPd };
	o.wPd = sumY(S, (y) => y.dyn.watchPd);
	o.wSh = sumY(S, (y) => y.dyn.watchShort);
	o.wCov = minY(S, (y) => y.dyn.watchCov);
	o.fPd = sumY(S, (y) => y.dyn.watchFPd);
	o.fSh = sumY(S, (y) => y.dyn.watchFShort);
	o.fCov = minY(S, (y) => y.dyn.watchFCov);
	o.nPd = sumY(S, (y) => y.dyn.newPd);
	o.nSh = sumY(S, (y) => y.dyn.newS);
	o.shocks = S.events.filter((e) => e.type === 'shock').length;
	o.fails = S.events.filter((e) => e.type === 'fail').length;
	o.exits = S.events.filter((e) => e.type === 'exit' && !/called off/.test(e.note)).length;
	o.calls = S.events.filter((e) => e.type === 'exit' && /called off/.test(e.note)).length;
	o.founds = S.events.filter((e) => e.type === 'found').length;
	o.ok1 = pr.covMinLate >= 0.98 && o.shLate < 1e-9;
	o.okWeek = pr.weekShort < 1e-9;
	// 2: the zero-Aven group
	o.zWmin = minY(S, (y) => y.dyn.zWminStep, Math.min(1, L - 1)); // from year 2 (on day 1 they hold only their first MIND)
	o.okN = pr.zCovMinLate >= 0.98 && pr.zShortLate < 1e-9 && minY(S, (y) => y.dyn.zWminStep).v > 0;
	const share = (a, b) => {
		let s = 0, p = 0;
		for (const y of S.Y) if (y.year > a && y.year <= b) (s += (y.dyn.zStrictShare || 0) * y.dyn.zPd), (p += y.dyn.zPd);
		return p > 0 ? s / p : null;
	};
	o.sAll = share(0, L);
	o.sLate = share(Math.min(10, L - 1), L);
	o.sSS = share(L - 10, L);
	o.sMinLate = minY(S, (y) => y.dyn.zStrictMin, Math.min(10, L - 1));
	o.sMinSS = minY(S, (y) => y.dyn.zStrictMin, L - 10);
	o.okS = pr.zStrictFrom !== null && (pr.zStrictLastFail === null || pr.zStrictLastFail < pr.zStrictFrom);
	o.bm = maxY(S, (y) => y.dyn.basicMind);
	o.okB = o.bm.v < 12;
	o.ok2 = o.okN && o.okB;
	// 3: living standards: every decile, the zero-Aven group and the poorest person higher at every 10-year mark
	o.marks = marksOf(S, [1, 10, 20, 30, 40, 50, 60]);
	const series = [];
	for (let d = 0; d < 10; d++) series.push([`decile ${d + 1}`, (y) => y.dyn.dec[d]]);
	series.push(['the zero-Aven group (mean)', (y) => y.dyn.zReal], ['the poorest zero-Aven person', (y) => y.dyn.zRealMin], ['the poorest person', (y) => y.dyn.realMin]);
	o.falls = [];
	for (const [label, fn] of series)
		for (let i = 1; i < o.marks.length; i++) {
			const a = fn(at(S, o.marks[i - 1])), b = fn(at(S, o.marks[i]));
			if (!(b > a)) o.falls.push(`${label} y${o.marks[i - 1]} → y${o.marks[i]}: ${f(a, 1)} → ${f(b, 1)}`);
		}
	o.ok3 = o.falls.length === 0;
	o.all = o.ok1 && o.ok2 && o.ok3;
	return o;
}

/** a run's steady state (its last 10 years): the measures of the comparisons */
function ss(S) {
	const L = S.Y.length, a = L - 10, b = L, dyn = !!S.sc.dynamic;
	const p2 = prop2(S, a, b);
	const inc = perPD(S, a, b, incomeOf), buy = perPD(S, a, b, (r) => r.buy), mW = perPD(S, a, b, (r) => r.meltW);
	const disp = dyn
		? { lo: avg(S, a, b, (y) => y.dyn.pMin), hi: avg(S, a, b, (y) => y.dyn.pMax), sd: avg(S, a, b, (y) => y.dyn.sdLog) }
		: (() => {
				const st = (y) => {
					const lp = y.P.slice(0, BASE_COOPS).filter((p) => p > 0).map(Math.log);
					const mu = lp.reduce((x, z) => x + z, 0) / lp.length;
					return { lo: Math.exp(Math.min(...lp)), hi: Math.exp(Math.max(...lp)), sd: Math.sqrt(lp.reduce((x, z) => x + (z - mu) * (z - mu), 0) / (lp.length - 1)) };
				};
				return { lo: avg(S, a, b, (y) => st(y).lo), hi: avg(S, a, b, (y) => st(y).hi), sd: avg(S, a, b, (y) => st(y).sd) };
			})();
	return {
		a, b, p2, inc, buy, mW, disp, short: avg(S, a, b, (y) => y.short), people: avg(S, a, b, (y) => y.peopleShareR),
		tre: avg(S, a, b, (y) => y.split.treR / y.split.totalR), pool: avg(S, a, b, (y) => y.split.poolR / y.split.totalR),
		yield: avg(S, a, b, (y) => y.yield), gini: avg(S, a, b, (y) => y.gini), mPer: avg(S, a, b, (y) => y.mPer),
		L: dyn ? avg(S, a, b, (y) => y.dyn.L) : buy, meanW: avg(S, a, b, (y) => y.meanW)
	};
}

// ── a run in HEARTS: the helpers of the H sections and of the seed check ───────────────────────────────────────────
const hmean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const hy = (S, y) => S.HY[y - 1];
const yy = (S, y) => S.Y[y - 1];
const restYears = (S) => Array.from({ length: 10 }, (_, i) => S.Y.length - 9 + i);
const g2 = (mu, sg) => (mu === null || sg === null ? null : giniRest(1 + (2 * (RATE - mu)) / (sg * sg)));
const hfl = (h, k) => h.flows[k] || 0;
const hPerPD = (S, fn) => hmean(restYears(S).map((y) => fn(hy(S, y)) / hy(S, y).N / Math.max(1, hy(S, y).days)));
const rPD = (S, fn) => hmean(restYears(S).map((y) => fn(yy(S, y).rt) / yy(S, y).N / Math.max(1, yy(S, y).rt.days)));
const incH = (h) => hfl(h, 'walHeartR') + hfl(h, 'wagesR') + hfl(h, 'propR') + hfl(h, 'divHHR') + hfl(h, 'liqHHR');
/** the least-squares trend of fn(year) over years a..b, per 10 years */
const trend10 = (fn, a, b) => {
	const xs = [], ys = [];
	for (let y = a; y <= b; y++) xs.push(y), ys.push(fn(y));
	const mx = hmean(xs), my = hmean(ys);
	let num = 0, den = 0;
	for (let i = 0; i < xs.length; i++) (num += (xs[i] - mx) * (ys[i] - my)), (den += (xs[i] - mx) ** 2);
	return (num / den) * 10;
};
/** the summary of one run in HEARTS (and the same in R from the script's own records, as a check) */
function heartSummary(S) {
	const ys = restYears(S), all = S.HY.map((h) => h.year), L = S.Y.length;
	const muH = hmean(ys.map((y) => hy(S, y).muH).filter((x) => x !== null));
	const sgH = hmean(ys.map((y) => hy(S, y).sgH).filter((x) => x !== null));
	const muR = hmean(ys.map((y) => yy(S, y).muRet).filter((x) => x !== null));
	const sgR = hmean(ys.map((y) => yy(S, y).sigma).filter((x) => x !== null));
	const runH = all.map((y) => hy(S, y).muH).filter((x) => x !== null), runR = all.map((y) => yy(S, y).muRet).filter((x) => x !== null);
	const shares = { people: [], treasuries: [], pools: [], arb: [] };
	for (const y of ys) {
		const p = hy(S, y).pl, t = p.w + p.t + p.p + p.a;
		shares.people.push(p.w / t), shares.treasuries.push(p.t / t), shares.pools.push(p.p / t), shares.arb.push(p.a / t);
	}
	const maxBy = (from, fn) => S.HY.reduce((b, h) => (h.year >= from && fn(h) !== null && fn(h) > b.v ? { v: fn(h), year: h.year } : b), { v: 0, year: 0 });
	return {
		years: L,
		muH, sgH, muR, sgR, gini2H: g2(muH, sgH), gini2R: g2(muR, sgR), marginH: muH === null ? null : RATE - muH,
		muPH: hmean(ys.map((y) => hy(S, y).muPH).filter((x) => x !== null)), muPR: hmean(ys.map((y) => yy(S, y).muPrice).filter((x) => x !== null)),
		muRunH: hmean(runH), muRunR: hmean(runR), aboveH: runH.filter((x) => x >= RATE).length, aboveR: runR.filter((x) => x >= RATE).length, ofYears: runH.length,
		yield: hmean(ys.map((y) => yy(S, y).yield)),
		incomeH: hPerPD(S, incH), buyH: hPerPD(S, (h) => hfl(h, 'salesHHR')), meltWH: hPerPD(S, (h) => hfl(h, 'meltWR')),
		incomeR: rPD(S, (r) => r.walHeart + r.ops + r.prop + r.divHH + (r.liqHH || 0)),
		hpRest: hmean(ys.map((y) => hy(S, y).hp)),
		// the most a day's basic bundle cost in a year: valued at each step's HEART values, and as the script values it
		// (the year's mean cost in R ÷ R a MIND on average at the year's end)
		bundleMax: maxBy(1, (h) => h.cpi), bundleMaxFrom2: maxBy(2, (h) => h.cpi),
		bundleMaxScript: S.Y.reduce((b, y) => (y.dyn && y.dyn.basicMind !== null && y.dyn.basicMind > b.v ? { v: y.dyn.basicMind, year: y.year } : b), { v: 0, year: 0 }),
		// who holds the MIND, by HEART value, at rest: wallets, treasuries (with what waits for the pools), pools, the arbitrage bot
		shares: { people: hmean(shares.people), treasuries: hmean(shares.treasuries), pools: hmean(shares.pools), arb: hmean(shares.arb) },
		// the measured Gini of what people hold, in HEARTS: years L−20, L−10, L, its mean at rest, and its trend over the last 20 years
		giniH: { y40: hy(S, L - 20)?.giniH ?? null, y50: hy(S, L - 10).giniH, y60: hy(S, L).giniH, rest: hmean(ys.map((y) => hy(S, y).giniH)), trend: L > 20 ? trend10((y) => hy(S, y).giniH, L - 19, L) : null }
	};
}

if (SEED_RUN) {
	// one seed of the seed check (see --seeds): its measures as JSON on stdout
	const S = results['dyn:main'], pf = proof(S), h = heartSummary(S);
	const tenths = pf.falls.every((x) => !x.startsWith('decile'));
	const why = [
		!pf.ok1 && `short of basics from day 8: ${f(pf.shLate)} person-days, worst ${pct(pf.pr.covMinLate, 0)} (${dayOf(pf.pr.covMinLateT)})`,
		!pf.okN && `the zero-Aven people fell to ${pct(pf.pr.zCovMinLate, 0)} of a basic need`,
		!pf.okB && `a day's basic bundle cost ${f(pf.bm.v, 2)} MIND (year ${pf.bm.year})`,
		!pf.ok3 && `not higher at every 10-year mark: ${pf.falls.slice(0, 3).join('; ')}${pf.falls.length > 3 ? `; and ${pf.falls.length - 3} more` : ''}`
	].filter(Boolean).join('; ');
	console.log(JSON.stringify({ seed: S.sc.seed, N: S.sc.N0, years: S.Y.length, poolShare: S.sc.poolShare, turnDiv: S.sc.turnDiv, muH: h.muH, sgH: h.sgH, marginH: h.marginH, gini2H: h.gini2H, muR: h.muR, giniH: h.giniH, yield: h.yield, pools: h.shares.pools, people: h.shares.people, ok1: pf.ok1, shLate: pf.shLate, okN: pf.okN, okB: pf.okB, ok2: pf.ok2, ok3: pf.ok3, tenths, all: pf.all, why }));
	process.exit(0);
}
const PD = proof(D), SD = ss(D), S0s = ss(results['main:base']);
const fCount = (S) => `${S.events.filter((e) => e.type === 'fail').length} / ${S.events.filter((e) => e.type === 'exit' && !/called off/.test(e.note)).length} / ${S.events.filter((e) => e.type === 'found').length}`;

P('# theOS end-to-end simulation — the dynamic world (new main), and the static previous main');
P('');
P(`${N0} people from a cold start with goods (seed capacities ${f(DYN.seedCap * 100)} % of the starting need, nobody holds MIND on day 1), seed ${BASE.seed}, ${dL} years. Daily steps in the first year, weekly steps (traded as 3 batches) after. Steady state = the last 10 years (years ${dA + 1}–${dB}). R = the geometric mean of the reference MIND prices (SOLAR, HABITAT, CITY; chain-linked, so R does not jump when a reference COOP ends and its successor takes its place). A day of living = what an average person's daily consumption costs in R that year. Every tenth person (${zN(D)} people) is the zero-Aven test group: their Avens deliver nothing and they start with nothing; they live only from what they own.`);
P('');
P(`The dynamic world: prices move freely with demand in both directions (no cap, no price control, no protected price for basics; a COOP\'s floor is its own variable cost grossed up for Law 5, and it goes below that to clear stock that would rot); every household good starts with two rivals (water stays with the City), a seventh good (experiences, new products) has no satiation; a product whose margin over full cost stays above 30 % for 90 days gets a new rival under Law 3 (founders, 3 basket partners); treasuries keep ${f(DYN.capDays / 30)} months of running costs plus planned building, grow first, then pay out for Aven work proposals; each HEART invested makes 1 MIND: ${f(0.5, 1)} to the investor, ${f(0.5 - DYN.poolShare, 1)} to the COOP\'s treasury, ${f(DYN.poolShare, 1)} to the pools; Law 5 pays ${pct(DYN.turnDiv, 0)} of every sale to the holders of the seller\'s MIND; productivity rises about 2 % a year, unevenly; random capacity shocks (30–50 % for 2–8 months) and drifting tastes; a COOP whose treasury stays dry while it keeps losing fails (its plant goes to the City, which leases it to a successor with a new MIND; the failed MIND leaves the pools and is retired), a small COOP that lost its market exits. People spend about half of what they own a year (basics first).`);
P('');
P('## Proof checks (dynamic main, per person, every day)');
P('');
{
	const pr = PD.pr;
	P(`1. ${ok(PD.ok1)} **No one starves** (from day 8 on): the worst person on the worst day had ${pct(pr.covMinLate, 0)} of every basic need (${dayOf(pr.covMinLateT)}); person-days below 98 % of the basics: ${f(PD.shLate)} of ${f(PD.pdLate)}. In the 30 days after each of ${PD.shocks} capacity shocks: ${f(PD.wSh)} of ${f(PD.wPd)} person-days short (worst ${pct(PD.wCov.v, 0)}); in the 180 days after each of ${PD.fails} failures and ${PD.exits} exits: ${f(PD.fSh)} of ${f(PD.fPd)} (worst ${pct(PD.fCov.v, 0)}). ${ok(PD.okWeek)} The genesis week (days 1–7, before anyone holds MIND and while the pools are still empty): worst ${pct(pr.weekMin, 0)} on ${dayOf(pr.weekMinT)}, ${f(pr.weekShort)} of ${f(pr.weekPd)} person-days short.`);
	P(`2. ${ok(PD.okN)} normal · ${ok(PD.okS)} strict · ${ok(PD.okB)} bundle — **No one has to work to survive** (the ${zN(D)} zero-Aven people). Normal: Law 5 dividends plus spending some of the MIND they hold covered their basics every day from day 8 (worst ${pct(pr.zCovMinLate, 0)}), and what they hold stayed positive (lowest from year 2 on: ${f(PD.zWmin.v)} R, in year ${PD.zWmin.year}). Strict: Law 5 dividends alone covered a day's basic bundle for every one of them first on ${pr.zStrictFrom === null ? 'no day' : dayOf(pr.zStrictFrom)}; ${pr.zStrictLastFail === null ? 'and on every day after' : `but not on every day after (last miss ${dayOf(pr.zStrictLastFail)}, that day's worst person got ${f(pr.zStrictLastFailR, 2)}× the bundle)`}; after year 10 on ${pct(PD.sLate, 2)} of their person-days (worst ${f(PD.sMinLate.v, 2)}× the bundle, year ${PD.sMinLate.year}). A day's basic bundle cost at most ${f(PD.bm.v, 3)} MIND (year ${PD.bm.year}) against the 12 MIND of ownership their investing creates a day (their half of the new MIND): margin ×${f(12 / PD.bm.v, 0)}.`);
	const m = PD.marks, d = (k) => m.map((y) => f(at(D, y).dyn.dec[k], 1)).join(' → ');
	P(`3. ${ok(PD.ok3)} **Living standards rise for everyone**: real consumption at base-year prices (R a person a day), years ${m.join(', ')}: poorest decile ${d(0)}; middle (5th) ${d(4)}; richest ${d(9)}; the zero-Aven group ${m.map((y) => f(at(D, y).dyn.zReal, 1)).join(' → ')}; the poorest person ${m.map((y) => f(at(D, y).dyn.realMin, 1)).join(' → ')}. ${PD.ok3 ? 'Every decile, the zero-Aven group and the poorest person are higher at every 10-year mark.' : `Not higher at every 10-year mark: ${PD.falls.join('; ')}.`} COOPs: ${PD.fails} failed, ${PD.exits} exited, ${PD.founds} founded in ${dL} years; no person lost basics after a failure: ${ok(PD.fSh < 1e-9)}.`);
}
P('');
// the Law 5 ladder's best point
const L5 = [['main', 0.2], ['law35', 0.35], ['law50', 0.5]].map(([k, t]) => ({ k, t, S: results[`dyn:${k}`], pf: proof(results[`dyn:${k}`]), s: ss(results[`dyn:${k}`]) }));
{
	const safe = (x) => x.s.p2.mu !== null && x.s.p2.mu < RATE - 0.01;
	const pass = (x) => safe(x) && x.pf.all;
	const top = (xs) => (xs.length ? xs.reduce((a, b) => (b.s.yield > a.s.yield ? b : a)) : null);
	const best = top(L5.filter(pass)), bestS = top(L5.filter((x) => pass(x) && x.pf.okS));
	const why = (x) => [!safe(x) && `μ ${pct(x.s.p2.mu, 1)} not safely below 7 %`, !x.pf.ok1 && 'basics short', !x.pf.okN && 'zero-Aven normal check', !x.pf.okB && 'bundle above 12 MIND', !x.pf.ok3 && 'living standards fell somewhere'].filter(Boolean).join(', ');
	P(`**Law 5 ladder (20 / 35 / 50 % of every sale, dynamic main):** ${L5.map((x) => `${f(x.t * 100)} %: dividend yield ${pct(x.s.yield, 1)}, μ ${pct(x.s.p2.mu, 1)}, checks ${ok(x.pf.ok1)}${ok(x.pf.ok2)}${ok(x.pf.ok3)} (strict ${ok(x.pf.okS)})`).join('; ')}. ${best ? `Best point: ${f(best.t * 100)} % (the highest yield with μ at least 1 point below the 7 % melt and all three checks passing${bestS === best ? ', the strict zero-Aven check too' : ', with the normal zero-Aven check; the strict one fails'}).` : `No share on this ladder holds μ at least 1 point below the 7 % melt with all three checks passing: ${L5.map((x) => `${f(x.t * 100)} %: ${why(x) || 'passes'}`).join('; ')}.`} Details in D7.`);
	P('');
}

P('## D1. Dynamic main against the static previous main (steady state: the last 10 years of each)');
P('');
{
	const S1 = results['main:base'];
	const rows = [];
	const m = (label, dv, sv) => rows.push([label, dv, sv]);
	m('Basic-need shortfall (person-days), steady state / whole run', `${pct(SD.short, 2)} / ${pct(PD.sh / PD.pd, 2)}`, `${pct(S0s.short, 2)} / ${pct(avg(S1, 0, YRS, (y) => y.short), 2)}`);
	m('Worst person-day, share of the basics (from day 8)', pct(PD.pr.covMinLate, 0), '– (not tracked)');
	m('A day of living (R): year 1 / 10 / last', `${f(at(D, 1).dyn.L, 1)} / ${f(at(D, 10).dyn.L, 1)} / ${f(at(D, dL).dyn.L, 1)}`, [1, 10, YRS].map((y) => f(at(S1, y).rt.buy / at(S1, y).N / at(S1, y).rt.days, 1)).join(' / '));
	m('Income a person a day (R)', f(SD.inc, 1), f(S0s.inc, 1));
	m('… of it spent / melting in wallets', `${pct(SD.buy / SD.inc, 0)} / ${pct(SD.mW / SD.inc, 0)}`, `${pct(S0s.buy / S0s.inc, 0)} / ${pct(S0s.mW / S0s.inc, 0)}`);
	m(`MIND count a person (paper u/r = ${f(M_STAR)})`, f(SD.mPer), f(S0s.mPer));
	m('Share of all MIND (value): people / treasuries / pools', `${pct(SD.people, 0)} / ${pct(SD.tre, 0)} / ${pct(SD.pool, 0)}`, `${pct(S0s.people, 0)} / ${pct(S0s.tre, 0)} / ${pct(S0s.pool, 0)}`);
	m('Dividend yield a year (all MIND, by value)', pct(SD.yield, 1), pct(S0s.yield, 1));
	m(`μ: mean yearly return a person (dividends + price change) against the ${pct(RATE, 0)} melt`, pct(SD.p2.mu, 1), pct(S0s.p2.mu, 1));
	m('σ: spread of those returns across people', pct(SD.p2.sg, 1), pct(S0s.p2.sg, 1));
	m('Proposition 2 Gini (from μ and σ)', SD.p2.g === null ? '–' : f(SD.p2.g, 2), S0s.p2.g === null ? '–' : f(S0s.p2.g, 2));
	m('Gini of what people hold', f(SD.gini, 2), f(S0s.gini, 2));
	m('Gini of real consumption (dynamic) / of satiation-weighted consumption (static)', f(avg(D, dA, dB, (y) => y.dyn.giniReal), 2), f(Math.max(0, avg(S1, ssA, ssB, (y) => y.giniC)), 2));
	m('COOP failures / exits / foundings (whole run)', fCount(D), '0 / 0 / 0 (failure only as a scripted branch)');
	m('MIND prices (R), steady state: lowest – highest (sd of log prices)', `${f(SD.disp.lo, 2)} – ${f(SD.disp.hi, 2)} (${f(SD.disp.sd, 2)})`, `${f(S0s.disp.lo, 2)} – ${f(S0s.disp.hi, 2)} (${f(S0s.disp.sd, 2)})`);
	m('MINDs alive at the end (COOPs with a priced MIND)', f(at(D, dL).dyn.nLive), f(BASE_COOPS));
	m('Output per unit of plant at the end (sales-weighted)', f(at(D, dL).dyn.meanA, 2), '1.00');
	table(['Measure', 'Dynamic main', 'Static (previous main)'], rows);
	P(`Income = ownership created by their investing (their half of the new MIND), Aven work items and proposals, Law 5 dividends and what COOPs that ended paid out to their holders. "Spent" = bought from COOPs. The rest of income is kept as holdings, which melt at ${pct(RATE, 0)} a year. μ and σ use each person's holdings at the start of a year: price change over the year plus dividends, before the melt (a MIND that was retired counts at zero).`);
	P('');
}

P('## D2. MIND prices, dispersion, winners and losers (dynamic main)');
P('');
{
	const yrs = marksOf(D, [1, 2, 5, 10, 20, 30, 40, 50, 60]);
	table(['Year', 'MINDs priced', 'lowest price (R)', 'highest', 'sd of log prices', 'a day of living (R)', 'a day\'s basic bundle (R)', 'a MIND on average (R)', 'basic bundle in days of living', 'basic bundle in MIND'], yrs.map((y) => {
		const d = at(D, y).dyn;
		return [y, d.nLive, f(d.pMin, 2), f(d.pMax, 2), f(d.sdLog, 2), f(d.L, 2), f(d.basicR, 3), f(d.mindR, 2), d.L > 0 ? f(d.basicR / d.L, 4) : '–', f(d.basicMind, 3)];
	}));
	// each MIND over its life: dividend yield, price change, total return (a MIND that ended counts −100 % in its last year)
	const per = new Map();
	for (const y of D.Y)
		for (const [nm, r] of Object.entries(y.dyn.rn)) {
			let o = per.get(nm);
			if (!o) per.set(nm, (o = { nm, n: 0, sy: 0, sp: 0, sr: 0, nr: 0, g: 1, prod: r.prod, first: y.year, fate: 'alive' }));
			o.sr += r.r;
			o.g *= 1 + r.r;
			o.nr++;
			if (!r.ended) (o.n++, (o.sy += r.y), (o.sp += r.p));
			if (r.prod !== null) o.prod = r.prod;
		}
	for (const e of D.events) if ((e.type === 'fail' || (e.type === 'exit' && !/called off/.test(e.note))) && per.has(e.name)) {
		const o = per.get(e.name);
		o.fate = `${e.type === 'fail' ? 'failed' : 'exited'} in year ${yrOf(e.t)}`;
		o.prod = e.product;
	}
	const list = [...per.values()].filter((o) => o.nr >= 1).sort((a, b) => a.prod - b.prod || a.first - b.first);
	const beat = list.filter((o) => o.nr >= 3 && o.sr / o.nr > RATE);
	P(`Every MIND over its life (full years only, from the year after its COOP began; a MIND whose COOP ended counts −100 % in that year, before what its treasury paid out to its holders; "mean" is the average yearly return, "compounded" what one MIND held with its dividends became, a year). ${list.length} MINDs; ${list.filter((o) => o.fate !== 'alive').length} of them ended. ${beat.length} of the ${list.filter((o) => o.nr >= 3).length} with at least 3 years returned more than the ${pct(RATE, 0)} melt on average: ${beat.map((o) => `${o.nm} ${pct(o.sr / o.nr, 0)}`).join(', ') || 'none'}.`);
	P('');
	table(['MIND', 'product', 'first full year', 'fate', 'years', 'dividend yield a year', 'price change a year', 'total return a year (mean)', 'compounded over its life, a year', 'mean above the melt?'], list.map((o) => [o.nm, PNAME[o.prod] ?? '–', o.first, o.fate, o.nr, o.n ? pct(o.sy / o.n, 1) : '–', o.n ? pct(o.sp / o.n, 1) : '–', pct(o.sr / o.nr, 1), pct(Math.pow(Math.max(0, o.g), 1 / o.nr) - 1, 1), o.sr / o.nr > RATE ? 'yes' : 'no']));
}

P('## D3. Money and days of living (dynamic main, R a person a day)');
P('');
{
	const yrs = marksOf(D, [1, 2, 5, 10, 20, 30, 40, 50, 60]);
	table(['Year', 'a day of living', 'income', 'ownership created by their investing', 'Aven work (items + proposals)', 'Law 5 dividends', 'spent', 'share of income spent', 'melt in wallets (share of income)', 'MIND a person', 'people / treasuries / pools (value)', 'dividend yield', 'Gini owned'], yrs.map((y) => {
		const r = at(D, y), q = r.rt, n = r.N * Math.max(1, q.days), d = r.dyn;
		const inc = incomeOf(q);
		return [y, f(d.L, 2), f(inc / n, 2), f(q.walHeart / n, 2), f((q.ops + q.prop) / n, 2), f(q.divHH / n, 2), f(q.buy / n, 2), pct(q.buy / inc, 0), pct(q.meltW / inc, 0), f(r.mPer), `${pct(r.peopleShareR, 0)} / ${pct(d.treShareR, 0)} / ${pct(d.poolShareR, 0)}`, pct(r.yield, 1), f(r.gini, 2)];
	}));
	P(`People spend about ${pct(DYN.spendRate, 0)} of what they own a year (at least the basic bundle), so at rest they spend about r_s / (r_s + melt) = ${pct(DYN.spendRate / (DYN.spendRate + RATE), 0)} of income and the rest melts in their wallets. Experiences have no satiation, so spending has somewhere to go.`);
	P('');
}

P('## D4. Treasuries (dynamic main)');
P('');
{
	const g = (fn) => avg(D, dA, dB, (y) => fn(y.flows) / y.N);
	const inn = g((x) => x.heartIn + x.salesHH + x.b2b + x.rent);
	const melt = avg(D, dA, dB, (y) => (y.split.treR * RATE) / y.N);
	table(['R a person a year, steady state', `in: the treasury's part of the new MIND (${f(0.5 - DYN.poolShare, 2)} of each HEART)`, 'in: sales to people', 'in: sales to COOPs and rent', 'in: total', 'out: inputs, building, rent', 'out: Aven work items', 'out: Aven work proposals (share of in)', 'out: Law 5 dividends (share of in)', 'melt on treasuries'], [['dynamic main', f(g((x) => x.heartIn)), f(g((x) => x.salesHH)), f(g((x) => x.b2b + x.rent)), f(inn), f(g((x) => x.b2b + x.rent)), f(g((x) => x.wages)), `${f(g((x) => x.prop))} (${pct(g((x) => x.prop) / inn, 0)})`, `${f(g((x) => x.div))} (${pct(g((x) => x.div) / inn, 0)})`, f(melt)]]);
	const cov = at(D, dL).dyn.coops.filter((c) => c.active && c.product >= 0 && c.cover !== null && c.K > 0).map((c) => c.cover).sort((a, b) => a - b);
	P(`Reserves at the end (days of running costs a treasury holds, COOPs with a plant): lowest ${f(cov[0])}, median ${f(cov[Math.floor(cov.length / 2)])}, highest ${f(cov[cov.length - 1])}; the target is ${DYN.capDays} days plus planned building. Treasuries hold ${pct(SD.tre, 0)} of all MIND by value (static: ${pct(S0s.tre, 0)}). A COOP grows its plant first (where it sells out or earns a margin), and pays out only what it holds above the target.`);
	P('');
}

P('## D5. Competition by good (dynamic main)');
P('');
{
	const yrs = marksOf(D, [1, 5, 10, 20, 30, 40, 50, 60]);
	const G = [FOOD, ENERGY, HOUSING, WATER, GOODS, CARE, EXPER, PANELS, MAT];
	P('Each cell: sellers on an average day · the largest seller\'s share of what was made that year · price gap between the dearest and the cheapest seller with a plant (R a unit, on days with two or more).');
	P('');
	table(['Good', ...yrs.map((y) => `y${y}`)], G.map((g) => [PNAME[g], ...yrs.map((y) => {
		const c = at(D, y).dyn.comp[g];
		const sh = Object.values(c.shares);
		if (!sh.length) return `${f(c.sellers, 1)} · none made · –`;
		return `${f(c.sellers, 1)} · ${pct(Math.max(...sh), 0)} · ${c.spread === null ? '–' : '+' + pct(c.spread, 0)}`;
	})]));
	const shares = (y) => G.map((g) => {
		const c = at(D, y).dyn.comp[g];
		return `${PNAME[g]}: ${Object.entries(c.shares).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${pct(v, 0)}`).join(', ') || 'none made that year'}`;
	}).join('; ');
	P(`Market shares, year 1: ${shares(1)}.`);
	P('');
	P(`Market shares, year ${dL}: ${shares(dL)}.`);
	P('');
	const ev = (type, filt = () => true) => D.events.filter((e) => e.type === type && filt(e));
	const fmt = (e) => `y${yrOf(e.t)} ${e.name} (${PNAME[e.product]}${e.note ? ': ' + e.note : ''})`;
	P(`Failures (${ev('fail').length}): ${ev('fail').map(fmt).join('; ') || 'none'}.`);
	P('');
	P(`Exits (${ev('exit', (e) => !/called off/.test(e.note)).length}): ${ev('exit', (e) => !/called off/.test(e.note)).map((e) => `y${yrOf(e.t)} ${e.name} (${PNAME[e.product]})`).join('; ') || 'none'}. Handovers lined up and called off because the COOP recovered: ${ev('exit', (e) => /called off/.test(e.note)).length}.`);
	P('');
	P(`Foundings (${ev('found').length}): ${ev('found').map((e) => `y${yrOf(e.t)} ${e.name}`).join(', ') || 'none'}.`);
	P('');
	const sh = ev('shock');
	P(`Capacity shocks: ${sh.length} (${G.map((g) => [PNAME[g], sh.filter((e) => e.product === g).length]).filter(([, n]) => n).map(([p, n]) => `${p} ${n}`).join(', ')}).`);
	P('');
}

P('## D6. The proof checks in detail (dynamic main)');
P('');
{
	P('### D6.1 No one starves: the worst person-day, year by year');
	P('');
	const yrs = D.Y.filter((y) => [1, 2, 5, 10, 20, 30, 40, 50, 60].includes(y.year) || y.year === dL || y.dyn.shortPd > 0 || y.dyn.failN > 0).map((y) => y.year);
	table(['Year', 'worst person-day (share of basics)', 'person-days below 98 %', 'after shocks: person-days (short)', 'after a COOP ended: person-days (short)', 'failures / exits / foundings / shocks'], yrs.map((yy) => {
		const d = at(D, yy).dyn;
		return [yy, pct(d.covMin, 0), `${f(d.shortPd)} of ${f(d.pd)}`, `${f(d.watchPd)} (${f(d.watchShort)})`, `${f(d.watchFPd)} (${f(d.watchFShort)})`, `${d.failN} / ${d.exitN} / ${d.foundN} / ${d.shockN}`];
	}));
	P('### D6.2 No one has to work to survive: the zero-Aven group');
	P('');
	const y5 = marksOf(D, [1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
	table(['Year', 'strict: days dividends alone covered the bundle', 'strict: worst day (dividends ÷ bundle)', 'strict: average', 'normal: worst person-day (share of basics)', 'normal: person-days below 98 %', 'holding a person, mean (R)', 'lowest holding (R)', 'basic bundle (R a day)', 'basic bundle (MIND a day)', 'margin to 12 MIND'], y5.map((yy) => {
		const d = at(D, yy).dyn;
		return [yy, pct(d.zStrictShare, 1), f(d.zStrictMin, 2), f(d.zStrictMean, 2), pct(d.zCovMin, 0), f(d.zShort), f(d.zW), f(d.zWmin), f(d.basicR, 3), f(d.basicMind, 4), `×${f(12 / d.basicMind, 0)}`];
	}));
	{
		// what the zero-Aven group holds at the end, and what each of those MINDs paid
		const S = D, hv = new Float64Array(M);
		let tot = 0;
		for (let i = 0; i < S.N; i++) if (S.zeroAven[i]) for (let k = 0; k < M; k++) (hv[k] += Math.max(0, S.hold[i * M + k]) * S.P[k]), (tot += Math.max(0, S.hold[i * M + k]) * S.P[k]);
		const y = at(S, dL);
		const top = [...hv.keys()].filter((k) => hv[k] > 0.03 * tot).sort((a, b) => hv[b] - hv[a]);
		P(`What the zero-Aven group holds at the end (share of its value, and that MIND's dividend yield in year ${dL}): ${top.map((k) => `${NAMES[k]} ${pct(hv[k] / tot, 0)} (${pct(y.yk[k], 1)})`).join(', ')}. The strict check depends on this mix: Law 5 pays only on sales, so a MIND whose COOP sells little against the MIND people hold of it (CITYmind earns ground rent, which is not a sale) pays almost nothing, while the group spends the MIND of what it buys most (experiences) instead of keeping it.`);
		P('');
	}
	P('### D6.3 Living standards: real consumption at base-year prices (R a person a day), by decile');
	P('');
	const y10 = marksOf(D, [1, 5, 10, 20, 30, 40, 50, 60]);
	table(['Year', ...Array.from({ length: 10 }, (_, i) => `D${i + 1}`), 'zero-Aven mean', 'zero-Aven lowest', 'poorest person', 'mean', 'Gini'], y10.map((yy) => {
		const d = at(D, yy).dyn;
		return [yy, ...d.dec.map((x) => f(x, 1)), f(d.zReal, 1), f(d.zRealMin, 1), f(d.realMin, 1), f(d.realMean, 1), f(d.giniReal, 2)];
	}));
	P('Real consumption: every unit a person consumed, valued at the year-1 genesis prices (so it counts quantities, not price changes). Deciles are re-sorted each year. The richest deciles are the people whose Avens earn most.');
	P('');
}

P('## D7. Ladders on the dynamic main (each row: its own run of the full length; steady state = its last 10 years)');
P('');
{
	const rows = DLADDER.map(([k, label]) => ({ k, label, S: results[`dyn:${k}`] })).map((x) => ({ ...x, pf: proof(x.S), s: ss(x.S) }));
	table(['Run', 'years', 'shortfall (person-days, from day 8)', 'people / treasuries share of MIND', 'share of income spent', 'a day of living (R)', 'dividend yield', 'μ (vs 7 % melt)', 'σ', 'Prop. 2 Gini', 'Gini owned', 'failures / exits / foundings', 'sd of log MIND prices'], rows.map((x) => [x.label, x.S.Y.length, pct(x.pf.shLate / x.pf.pdLate, 2), `${pct(x.s.people, 0)} / ${pct(x.s.tre, 0)}`, pct(x.s.buy / x.s.inc, 0), f(x.s.L, 1), pct(x.s.yield, 1), x.s.p2.mu === null ? '–' : `${pct(x.s.p2.mu, 1)} ${x.s.p2.mu < RATE ? '<' : '≥'} 7 %`, pct(x.s.p2.sg, 1), x.s.p2.g === null ? '–' : f(x.s.p2.g, 2), f(x.s.gini, 2), fCount(x.S), f(x.s.disp.sd, 2)]));
	P('Proof checks per row (per person, every day):');
	P('');
	table(['Run', '1. no one starves: worst person-day from day 8 (first day of it)', 'person-days below 98 % (of them after shocks / after a COOP ended / newcomers)', '2. normal: zero-Aven worst person-day from day 8; lowest holding from year 2', '2. strict: share of zero-Aven days dividends alone covered the bundle, after year 10 (worst)', '2. bundle: max MIND a day (margin to 12)', '3. real consumption, poorest decile first → last year (zero-Aven group)', 'checks 1 · 2 · 3 (strict)'], rows.map((x) => {
		const p = x.pf, L = x.S.Y.length;
		return [x.label, `${pct(p.pr.covMinLate, 0)} (${dayOf(p.pr.covMinLateT)})`, `${f(p.shLate)} (${f(p.wSh)} / ${f(p.fSh)} / ${x.S.sc.popGrowth ? f(p.nSh) : '–'})`, `${pct(p.pr.zCovMinLate, 0)}; ${f(p.zWmin.v)} R`, `${pct(p.sLate, 1)} (${f(p.sMinLate.v, 2)}× in y${p.sMinLate.year})`, `${f(p.bm.v, 3)} (×${f(12 / p.bm.v, 0)})`, `${f(at(x.S, 1).dyn.dec[0], 1)} → ${f(at(x.S, L).dyn.dec[0], 1)} (${f(at(x.S, 1).dyn.zReal, 1)} → ${f(at(x.S, L).dyn.zReal, 1)})`, `${ok(p.ok1)} · ${ok(p.ok2)} · ${ok(p.ok3)} (${ok(p.okS)})`];
	}));
	const bad = rows.filter((x) => !x.pf.ok1);
	for (const x of bad) {
		const worst = x.S.Y.filter((y) => y.dyn.shortPd > 0 && y.year > 1).sort((a, b) => b.dyn.shortPd - a.dyn.shortPd).slice(0, 3);
		const fl = x.S.events.filter((e) => e.type === 'fail');
		P(`- ${x.label}: basics were short in ${x.S.Y.filter((y) => y.dyn.shortPd > (y.year === 1 ? x.pf.pr.weekShort + 1e-9 : 0)).map((y) => `y${y.year}`).join(', ')}; worst years ${worst.map((y) => `y${y.year} (${pct(y.short, 1)} of person-days; food ${pct(y.shortG[0], 1)}, energy ${pct(y.shortG[1], 1)}, housing ${pct(y.shortG[2], 1)}, water ${pct(y.shortG[3], 1)}; ${y.dyn.failN} failures)`).join(', ')}. Failures in the run: ${fl.length}${fl.length ? ` (${fl.slice(0, 12).map((e) => `y${yrOf(e.t)} ${e.name}`).join(', ')}${fl.length > 12 ? ', …' : ''})` : ''}.`);
	}
	for (const x of rows.filter((r) => !r.pf.ok2 || !r.pf.ok3)) {
		const p = x.pf, why = [];
		if (!p.okN) why.push(`the zero-Aven people were short too (worst ${pct(p.pr.zCovMinLate, 0)}, ${f(p.pr.zShortLate)} person-days below 98 %)${minY(x.S, (y) => y.dyn.zWminStep).v > 0 ? '' : '; holdings reached zero'}`);
		if (!p.okB) why.push(`a day\'s basic bundle cost up to ${f(p.bm.v, 2)} MIND (year ${p.bm.year}), more than the 12 MIND a day their investing creates`);
		if (!p.ok3) why.push(`real consumption did not rise between two 10-year marks for: ${p.falls.slice(0, 4).join('; ')}${p.falls.length > 4 ? `; and ${p.falls.length - 4} more` : ''}`);
		P(`- ${x.label}: check 2 ${ok(p.ok2)}, check 3 ${ok(p.ok3)}: ${why.join('; ')}.`);
	}
	P('');
	P('The population row has newcomers (people born into the run; "newcomers" = their first 3 years): their person-days below 98 % are in the second column (they start with nothing and without a week of the sellers\' MIND in hand, so in their first weeks they get only the part of a week\'s basics that the pools fill of their buy orders; the zero-Aven newcomers start with nothing at all). The rows with fixed Aven capacity let the Aven work-item rate float (it starts at 2 R a unit); everywhere else the rate is fixed and Avens deliver what is asked.');
	P('');
}

P('## D8. The round trip and the macro checks (dynamic main, steady state)');
P('');
{
	const S = D, a = dA, b = dB;
	const pd = (fn) => perPD(S, a, b, fn);
	const d = (key) => avg(S, a, b, (y) => {
		const prev = S.Y[y.year - 2];
		return prev ? (y.split[key] - prev.split[key]) / y.N / 365 : null;
	});
	const row = (place, ins, outs, rv, dk) => {
		const inT = ins.reduce((x, [, v]) => x + v, 0), outT = outs.reduce((x, [, v]) => x + v, 0), ch = d(dk);
		return { r: [place, ins.map(([l, v]) => `${l} ${f(v, 2)}`).join('; '), outs.map(([l, v]) => `${l} ${f(v, 2)}`).join('; '), f(inT - outT, 2), f(rv, 2), f(ch, 2), f(ch - (inT - outT) - rv, 2)], gap: (ch - (inT - outT) - rv) / Math.max(1e-9, inT) };
	};
	const wal = row('People\'s wallets',
		[['ownership created by their investing (their half of the new MIND)', pd((r) => r.walHeart)], ['Aven work items', pd((r) => r.ops)], ['Aven work proposals', pd((r) => r.prop)], ['Law 5 dividends', pd((r) => r.divHH)], ['paid out by COOPs that ended', pd((r) => r.liqHH)]],
		[['buying from COOPs', pd((r) => r.buy)], ['melt', pd((r) => r.meltW)], ['retired with a COOP that ended', pd((r) => r.lossWal)]], pd((r) => r.revalW), 'walR');
	const tre = row('COOP treasuries',
		[[`the treasury's part of the new MIND (${f(0.5 - DYN.poolShare, 2)} of each HEART)`, pd((r) => r.treHeart)], ['sales to people', pd((r) => r.buy)]],
		[['Law 5 dividends to people', pd((r) => r.divHH)], ['Aven work items', pd((r) => r.ops)], ['Aven work proposals', pd((r) => r.prop)], ['melt', pd((r) => r.meltT)], ['paid out to people by COOPs that ended', pd((r) => r.liqHH)], ['retired with a COOP that ended', pd((r) => r.lossTre + r.burnTre)]], pd((r) => r.revalT), 'treR');
	const pool = row('Pools',
		[[`the pools' part of the new MIND (${f(DYN.poolShare, 2)} of each HEART)`, pd((r) => r.poolHeart)], ['routing costs', pd((r) => r.routeCost)]],
		[['melt', pd((r) => r.meltP)], ['retired with a COOP that ended', pd((r) => r.lossPool)]], pd((r) => r.revalP), 'poolR');
	table(['Place', 'in (R a person a day)', 'out', 'in − out', 'price moves', 'change of what it holds', 'not explained: routing, timing'], [wal.r, tre.r, pool.r]);
	P(`Between treasuries (these cancel out, so they are not in the table): sales to other COOPs ${f(pd((r) => r.b2b), 2)}, ground rent to the City COOP ${f(pd((r) => r.rent), 2)}, Law 5 dividends to treasuries that hold other MINDs ${f(pd((r) => r.divT), 2)}, paid out to other treasuries by COOPs that ended ${f(pd((r) => r.liqT), 2)} R a person a day. People pay routing costs on the share of their payments that the pools convert. Price moves: what the year's MIND price changes (in R) did to the value of what each place holds.`);
	P('');
	// in MIND counts: what is issued against what melts and what is retired
	const cnt = (fn) => avg(S, a, b, (y) => fn(y) / y.N / 365);
	const issued = cnt((y) => y.issued), melted = cnt((y) => y.dyn.meltCnt), retired = cnt((y) => y.burned);
	const grew = avg(S, a, b, (y) => {
		const prev = S.Y[y.year - 2];
		return prev ? (y.split.total - prev.split.total) / y.N / 365 : null;
	});
	const p2 = SD.p2;
	const bundle = (y) => y.dyn.basicR;
	const drift = Math.pow(bundle(at(S, b)) / bundle(at(S, a)), 1 / (b - a)) - 1;
	const driftL = Math.pow(at(S, b).dyn.L / at(S, a).dyn.L, 1 / (b - a)) - 1;
	const ins = S.Y.reduce((x, y) => x + y.insolv.reduce((u, z) => u + z, 0), 0), insLate = S.Y.slice(10).reduce((x, y) => x + y.insolv.reduce((u, z) => u + z, 0), 0);
	const gapMax = Math.max(Math.abs(wal.gap), Math.abs(tre.gap), Math.abs(pool.gap));
	const inc = pd(incomeOf);
	P('Macro checks:');
	P('');
	P(`- ${ok(gapMax < 0.02)} The round trip closes: what flows and price moves do not explain is at most ${pct(gapMax, 2)} of a place's inflow (wallets ${pct(wal.gap, 2)}, treasuries ${pct(tre.gap, 2)}, pools ${pct(pool.gap, 2)}).`);
	P(`- ${ok(Math.abs(issued - melted - retired) / issued < 0.03)} New money equals the melt at rest (in MIND): ${f(issued, 2)} MIND a person a day issued (24 HEARTS converted), ${f(melted, 2)} melted and ${f(retired, 2)} retired with COOPs that ended (gap ${pct((issued - melted - retired) / issued, 1)}): the MIND stock was still growing by ${f(grew, 2)} MIND a person a day, towards u/r from below (MIND is conserved to 1e-6 every year). In R, at that year's prices: ${f(pd((r) => r.walHeart + r.treHeart + r.poolHeart), 2)} issued, ${f(pd((r) => r.meltW + r.meltT + r.meltP + r.meltA), 2)} melted.`);
	P(`- ${ok(Math.abs(SD.mPer / M_STAR - 1) < 0.05)} Money a person rests at the paper's level u/r: ${f(SD.mPer)} MIND against ${f(M_STAR)} (${pct(SD.mPer / M_STAR - 1, 1)}; MIND retired with COOPs that ended is gone for good).`);
	P(`- ${ok(SD.short < 0.001 && PD.ok1)} Every basic need is met: shortfall ${pct(SD.short, 2)} of person-days at rest; per person, see proof check 1.`);
	P(`- ${ok(insLate === 0 && PD.fSh < 1e-9)} COOPs stay solvent, or fail without harm: ${f(ins)} COOP-days short of working capital in ${dL} years (${f(insLate)} after year 10); ${PD.fails} failures and ${PD.exits} exits, after which ${f(PD.fSh)} person-days were short of basics.`);
	P(`- ${ok(Math.abs(drift) < 0.01)} Prices are stable at rest: the basic bundle changes ${pct(drift, 1)} a year in R over years ${a + 1}–${b} (a day of living ${pct(driftL, 1)} a year). ${Math.abs(drift) >= 0.01 ? 'Not expected here: productivity keeps rising about 2 % a year and competition passes it on, so basics keep getting cheaper.' : ''}`);
	P(`- ${ok(SD.people > 0.8)} People own the economy: ${pct(SD.people, 0)} of all MIND by value (treasuries ${pct(SD.tre, 0)}: they now keep ${f(DYN.capDays / 30)} months of reserves; people own the COOPs that hold them).`);
	P(`- ${ok(p2.mu !== null && p2.mu < RATE)} Holding never beats the melt: μ = ${pct(p2.mu, 1)} (dividend yield ${pct(SD.yield, 1)}, price change ${pct(avg(S, a, b, (y) => y.muPrice), 1)} a year in R) against r = ${pct(RATE, 0)}; Proposition 2's Gini ${p2.g === null ? '–' : f(p2.g, 2)} (σ = ${pct(p2.sg, 1)}).`);
	P(`- Where a person's income comes from, at rest: ownership created by their investing (their half of the new MIND) ${pct(pd((r) => r.walHeart) / inc, 0)}, Aven work items ${pct(pd((r) => r.ops) / inc, 0)}, Aven work proposals ${pct(pd((r) => r.prop) / inc, 0)}, Law 5 dividends ${pct(pd((r) => r.divHH) / inc, 0)}, paid out by COOPs that ended ${pct(pd((r) => r.liqHH) / inc, 1)}. No wage for human labour.`);
	P(`- Gini of what people hold: ${f(SD.gini, 2)}; the top half of Aven pay holds ${f(avg(S, a, b, (y) => y.workRatio), 1)}× the bottom half.`);
	P('');
}

// ── report: the same runs in HEARTS (the paper's unit, Section 6.3) ─────────────────────────────────────────────────
// Every value that the sections above report in R, valued in HEARTS (see heartIndex). H1–H8; with --json FILE, the
// same numbers as JSON.
const HJ = {};
{
	const mean = hmean, HY = hy, YY = yy, rest = restYears, fl = hfl, hPD = hPerPD;
	const summary = heartSummary;
	// ── the dynamic main ──
	const D = results['dyn:main'];
	const sD = summary(D);
	HJ.main = sD;
	HJ.index = D.HY.map((h, i) => ({ year: h.year, hp: h.hp, hU: h.hU, unpriced: h.unpriced, mindR: D.Y[i].dyn.mindR, totalH: h.pl.w + h.pl.t + h.pl.p + h.pl.a, count: h.count }));
	HJ.byYear = D.HY.map((h, i) => ({ year: h.year, hp: h.hp, L: h.L, bundle: h.cpi, bundleScript: D.Y[i].dyn.basicMind, LR: D.Y[i].dyn.L, bundleR: D.Y[i].dyn.basicR, vMin: h.vMin, vMax: h.vMax, muH: h.muH, sgH: h.sgH, muR: D.Y[i].muRet, giniH: h.giniH, giniR: D.Y[i].gini, zW: h.zW, zWmin: h.zWmin, income: incH(h) / h.N / Math.max(1, h.days), people: h.pl.w / (h.pl.w + h.pl.t + h.pl.p + h.pl.a), pools: h.pl.p / (h.pl.w + h.pl.t + h.pl.p + h.pl.a) }));
	const L = D.Y.length, a = L - 10, b = L;
	HJ.pricesByYear = Object.fromEntries(marksOf(D, [1, 10, 30, 40]).map((y) => [y, { living: HY(D, y).L, bundle: HY(D, y).cpi, share: HY(D, y).cpi / HY(D, y).L, vMin: HY(D, y).vMin, vMax: HY(D, y).vMax }]));
	HJ.dayLiving = { y1: HY(D, 1).L, y10: HY(D, 10).L, y60: HY(D, L).L };
	HJ.pricesRest = { min: mean(rest(D).map((y) => HY(D, y).vMin)), max: mean(rest(D).map((y) => HY(D, y).vMax)) };
	HJ.bundleDrift = Math.pow(HY(D, b).cpi / HY(D, a).cpi, 1 / (b - a)) - 1;
	HJ.livingDrift = Math.pow(HY(D, b).L / HY(D, a).L, 1 / (b - a)) - 1;
	HJ.bundleDriftR = Math.pow(YY(D, b).dyn.basicR / YY(D, a).dyn.basicR, 1 / (b - a)) - 1;
	HJ.bundleRest = mean(rest(D).map((y) => HY(D, y).cpi));
	{
		let m = Infinity, yr = null;
		for (const h of D.HY) if (h.year > 1 && h.zWmin < m) (m = h.zWmin), (yr = h.year);
		HJ.lowestHolding = { v: m, year: yr, livingThen: HY(D, yr).L, bundleThen: HY(D, yr).cpi };
	}
	HJ.ownerOnly = { holding40: HY(D, Math.min(40, L)).zW, holding60: HY(D, L).zW };
	{
		const g = (k) => mean(rest(D).map((y) => fl(HY(D, y), k) / HY(D, y).N));
		HJ.reserves = { inflow: g('heartInR') + g('salesHHR') + g('b2bR') + g('rentR'), items: g('wagesR'), proposals: g('propR'), dividends: g('divR'), heartIn: g('heartInR'), sales: g('salesHHR') };
	}
	// the round trip at rest, in HEARTS a person a day
	{
		const S = D, pd = (fn) => hPD(S, fn);
		const ch = (key) => mean(rest(S).map((y) => (HY(S, y).pl[key] - HY(S, y - 1).pl[key]) / HY(S, y).N / 365));
		const rv = (key) => hPD(S, (h) => h.rev[key]);
		const place = (ins, outs, rev, key) => {
			const inT = Object.values(ins).reduce((x, v) => x + v, 0), outT = Object.values(outs).reduce((x, v) => x + v, 0), c = ch(key);
			return { in: ins, out: outs, net: inT - outT, moves: rev, change: c, rest: c - (inT - outT) - rev, gap: (c - (inT - outT) - rev) / inT };
		};
		const k = (n) => pd((h) => fl(h, n));
		const people = place({ own: k('walHeartR'), items: k('wagesR'), proposals: k('propR'), dividends: k('divHHR'), liquidation: k('liqHHR') }, { buying: k('salesHHR'), melt: k('meltWR'), retired: k('lossWalR') }, rv('W'), 'w');
		const treasuries = place({ own: k('heartInR'), sales: k('salesHHR') }, { dividends: k('divHHR'), items: k('wagesR'), proposals: k('propR'), melt: k('meltTR'), liquidation: k('liqHHR'), retired: k('lossTreR') + k('burnTreR') }, rv('T'), 't');
		const pools = place({ pool: k('poolHeartR'), routing: k('routeCost') }, { melt: k('meltPR'), retired: k('lossPoolR') }, rv('P'), 'p');
		HJ.roundTrip = {
			people, treasuries, pools, between: { sales: k('b2bR'), rent: k('rentR'), divT: k('divTR'), liqT: k('liqTR') },
			issued: k('walHeartR') + k('heartInR') + k('poolHeartR'), melted: k('meltWR') + k('meltTR') + k('meltPR') + k('meltAR'),
			unexplainedMax: Math.max(Math.abs(people.gap), Math.abs(treasuries.gap), Math.abs(pools.gap)),
			movesAll: rv('W') + rv('T') + rv('P') + rv('A')
		};
	}
	// every MIND over its life, in HEARTS
	{
		const per = new Map();
		for (const h of D.HY)
			for (const [nm, r] of Object.entries(h.rnH)) {
				let o = per.get(nm);
				if (!o) per.set(nm, (o = { nm, n: 0, sy: 0, sp: 0, sr: 0, nr: 0, g: 1, first: h.year, ended: false }));
				o.sr += r.r;
				o.g *= 1 + r.r;
				o.nr++;
				if (r.ended) o.ended = true;
				else (o.n++, (o.sy += r.y), (o.sp += r.p));
			}
		const list = [...per.values()];
		const three = list.filter((o) => o.nr >= 3), beat = three.filter((o) => o.sr / o.nr > RATE);
		const arts = per.get('ARTS');
		HJ.mindReturns = {
			minds: list.length, ended: list.filter((o) => o.ended).length, withThreeYears: three.length, aboveMelt: beat.length, aboveMeltEnded: beat.filter((o) => o.ended).length,
			arts: arts ? { compounded: Math.pow(Math.max(0, arts.g), 1 / arts.nr) - 1, years: arts.nr, mean: arts.sr / arts.nr } : null,
			list: list.map((o) => ({ nm: o.nm, years: o.nr, mean: o.sr / o.nr, priceChange: o.n ? o.sp / o.n : null, compounded: Math.pow(Math.max(0, o.g), 1 / o.nr) - 1, ended: o.ended }))
		};
	}
	// the variations
	HJ.variations = Object.fromEntries(DLADDER.map(([k]) => [k, summary(results[`dyn:${k}`])]));
	// the static world
	{
		const S = results['main:base'];
		const s = summary(S);
		const Ls = (y) => fl(HY(S, y), 'salesHHR') / HY(S, y).N / HY(S, y).days;
		const k = (n) => hPD(S, (h) => fl(h, n));
		const ch = (key) => mean(rest(S).map((y) => (HY(S, y).pl[key] - HY(S, y - 1).pl[key]) / HY(S, y).N / 365));
		HJ.static = {
			...s, dayLiving: { y1: Ls(1), y10: Ls(10), y60: Ls(YRS) },
			pricesRest: { min: mean(rest(S).map((y) => HY(S, y).vMinBase)), max: mean(rest(S).map((y) => HY(S, y).vMaxBase)) },
			roundTrip: {
				people: { in: { own: k('walHeartR'), items: k('wagesR'), proposals: k('propR'), dividends: k('divHHR') }, out: { buying: k('salesHHR'), melt: k('meltWR') }, change: ch('w') },
				treasuries: { in: { own: k('heartInR'), sales: k('salesHHR') }, out: { dividends: k('divHHR'), items: k('wagesR'), proposals: k('propR'), melt: k('meltTR') }, change: ch('t') },
				pools: { in: { pool: k('poolHeartR'), routing: k('routeCost') }, out: { melt: k('meltPR') }, change: ch('p') },
				issued: k('walHeartR') + k('heartInR') + k('poolHeartR'), melted: k('meltWR') + k('meltTR') + k('meltPR') + k('meltAR')
			}
		};
	}
	// the long-lived plant of S6.6, in HEARTS
	{
		const S = results['main:geo'];
		const claim = (k, val) => {
			let n = 1;
			for (let y = BR + 1; y <= BR + 20; y++) n *= 1 + (S.Y[y - 1].yk[k] || 0);
			return (n * Math.exp(-RATE * 20) * val(BR + 20, k)) / val(BR + 1, k);
		};
		const vH = (y, k) => HY(S, y).v[k], vR = (y, k) => S.Y[y - 1].P[k];
		HJ.geo = { geo: claim(GEO, vH), solar: claim(SOLAR, vH), geoR: claim(GEO, vR), solarR: claim(SOLAR, vR) };
	}

	// ── the markdown ──
	P('# The same runs in HEARTS (the paper\'s unit of account)');
	P('');
	P('Every MIND is minted 1:1 from HEARTS, so the average MIND in existence is worth 1 HEART. The pools set only how each MIND stands against the others. At every step the MINDs that the pools price are scaled together until their supply-weighted average is 1 HEART (Σ supply·value = Σ supply, over wallets, treasuries, what waits for the pools, the pools and the arbitrage bot); a MIND that the pools cannot price yet counts at 1 HEART. Nothing in the simulation reads these values, so every move, price and trade is the one reported above. Flows are valued at the HEART values of the step in which they happen; price moves are what the change of HEART values from one step to the next did to what each place holds.');
	P('');
	P('## H1. The index (dynamic main)');
	P('');
	table(['Year', 'R a HEART (the index)', 'R a MIND on average (script)', 'share of MIND unpriced', 'HEART value of all MIND ÷ MIND count'], marksOf(D, [1, 2, 5, 10, 20, 30, 40, 50, 51, 55, 60]).map((y) => {
		const x = HJ.index[y - 1];
		return [y, f(x.hp, 4), f(x.mindR, 4), pct(x.unpriced, 2), f(x.totalH / x.count, 4)];
	}));
	P('## H2. Dynamic main against the static world, in HEARTS (steady state: the last 10 years)');
	P('');
	const st = HJ.static;
	table(['Measure', 'Dynamic main, HEARTS', 'same, R (script)', 'Static, HEARTS', 'Static, R (script)'], [
		['A day of living: year 1 / 10 / last', `${f(HJ.dayLiving.y1, 1)} / ${f(HJ.dayLiving.y10, 1)} / ${f(HJ.dayLiving.y60, 1)}`, `${f(YY(D, 1).dyn.L, 1)} / ${f(YY(D, 10).dyn.L, 1)} / ${f(YY(D, L).dyn.L, 1)}`, `${f(st.dayLiving.y1, 1)} / ${f(st.dayLiving.y10, 1)} / ${f(st.dayLiving.y60, 1)}`, '–'],
		['Income a person a day', f(sD.incomeH, 1), f(sD.incomeR, 1), f(st.incomeH, 1), f(st.incomeR, 1)],
		['MIND prices at rest: lowest – highest', `${f(HJ.pricesRest.min, 2)} – ${f(HJ.pricesRest.max, 2)}`, '–', `${f(st.pricesRest.min, 2)} – ${f(st.pricesRest.max, 2)}`, '–'],
		['μ: mean yearly return a person (dividends + price change)', pct(sD.muH, 2), pct(sD.muR, 2), pct(st.muH, 2), pct(st.muR, 2)],
		[`… its margin below the ${pct(RATE, 0)} melt (melt − μ)`, `${f(sD.marginH * 100, 2)} pt`, `${f((RATE - sD.muR) * 100, 2)} pt`, `${f(st.marginH * 100, 2)} pt`, `${f((RATE - st.muR) * 100, 2)} pt`],
		['… of it price change', pct(sD.muPH, 2), pct(sD.muPR, 2), pct(st.muPH, 2), pct(st.muPR, 2)],
		['σ: spread across people', pct(sD.sgH, 2), pct(sD.sgR, 2), pct(st.sgH, 2), pct(st.sgR, 2)],
		['Proposition 2 Gini from μ and σ', sD.gini2H === null ? '–' : f(sD.gini2H, 2), sD.gini2R === null ? '–' : f(sD.gini2R, 2), st.gini2H === null ? '–' : f(st.gini2H, 2), st.gini2R === null ? '–' : f(st.gini2R, 2)],
		['Measured Gini of what people hold: at rest; years L−20 / L−10 / L; trend over the last 20 years (per 10 years)', `${f(sD.giniH.rest, 3)}; ${f(sD.giniH.y40, 3)} / ${f(sD.giniH.y50, 3)} / ${f(sD.giniH.y60, 3)}; ${sD.giniH.trend >= 0 ? '+' : ''}${f(sD.giniH.trend, 3)}`, f(SD.gini, 3), `${f(st.giniH.rest, 3)}; ${f(st.giniH.y40, 3)} / ${f(st.giniH.y50, 3)} / ${f(st.giniH.y60, 3)}; ${st.giniH.trend >= 0 ? '+' : ''}${f(st.giniH.trend, 3)}`, f(S0s.gini, 3)],
		[`μ over the whole run; years at or above the ${pct(RATE, 0)} melt`, `${pct(sD.muRunH, 2)}; ${sD.aboveH} of ${sD.ofYears}`, `${pct(sD.muRunR, 2)}; ${sD.aboveR} of ${sD.ofYears}`, '–', '–'],
		['Dividend yield (unit-free)', pct(sD.yield, 1), pct(sD.yield, 1), pct(st.yield, 1), pct(st.yield, 1)],
		['A day\'s basic bundle: change a year at rest', pct(HJ.bundleDrift, 2), pct(HJ.bundleDriftR, 2), '–', '–'],
		['A day\'s basic bundle: most in a year (year)', `${f(sD.bundleMax.v, 3)} (${sD.bundleMax.year}); from year 2: ${f(sD.bundleMaxFrom2.v, 3)} (${sD.bundleMaxFrom2.year})`, `script "in MIND": ${f(sD.bundleMaxScript.v, 3)} (${sD.bundleMaxScript.year})`, '–', '–'],
		['Share of all MIND by HEART value: people / treasuries / pools / bot', `${pct(sD.shares.people, 1)} / ${pct(sD.shares.treasuries, 1)} / ${pct(sD.shares.pools, 1)} / ${pct(sD.shares.arb, 1)}`, '–', `${pct(st.shares.people, 1)} / ${pct(st.shares.treasuries, 1)} / ${pct(st.shares.pools, 1)} / ${pct(st.shares.arb, 1)}`, '–']
	]);
	P('## H3. Prices by year (dynamic main, HEARTS)');
	P('');
	table(['Year', 'a day of living', 'a day\'s basic bundle', 'basic bundle, script\'s "in MIND"', 'basics, share of a day of living', 'lowest MIND', 'highest MIND', 'μ that year'], marksOf(D, [1, 2, 5, 10, 20, 30, 40, 50, 60]).map((y) => {
		const x = HJ.byYear[y - 1];
		return [y, f(x.L, 2), f(x.bundle, 4), f(x.bundleScript, 4), pct(x.bundle / x.L, 2), f(x.vMin, 2), f(x.vMax, 2), x.muH === null ? '–' : pct(x.muH, 1)];
	}));
	P(`Lowest holding of an owner-only (zero-Aven) person from year 2 on: ${f(HJ.lowestHolding.v)} HEARTS (year ${HJ.lowestHolding.year}), ${f(HJ.lowestHolding.v / HJ.lowestHolding.livingThen)} days of living; a day of living that year ${f(HJ.lowestHolding.livingThen, 3)} HEARTS. Owner-only mean holding: ${f(HJ.ownerOnly.holding40)} HEARTS in year ${Math.min(40, L)}, ${f(HJ.ownerOnly.holding60)} in year ${L}. A day's basic bundle at rest: ${f(HJ.bundleRest, 4)} HEARTS. Treasuries at rest, HEARTS a person a year (booked as D4 books them): in ${f(HJ.reserves.inflow)}, Aven work items ${f(HJ.reserves.items)}, proposals ${f(HJ.reserves.proposals)}, Law 5 dividends ${f(HJ.reserves.dividends)}.`);
	P('');
	P('## H4. The round trip at rest (dynamic main, HEARTS a person a day)');
	P('');
	const rt = HJ.roundTrip, fr = (o) => Object.entries(o).map(([k, v]) => `${k} ${f(v, 2)}`).join('; ');
	table(['Place', 'in', 'out', 'in − out', 'price moves', 'change of what it holds', 'not explained'], [['People', fr(rt.people.in), fr(rt.people.out), f(rt.people.net, 2), f(rt.people.moves, 2), f(rt.people.change, 2), f(rt.people.rest, 3)], ['Treasuries', fr(rt.treasuries.in), fr(rt.treasuries.out), f(rt.treasuries.net, 2), f(rt.treasuries.moves, 2), f(rt.treasuries.change, 2), f(rt.treasuries.rest, 3)], ['Pools', fr(rt.pools.in), fr(rt.pools.out), f(rt.pools.net, 2), f(rt.pools.moves, 2), f(rt.pools.change, 2), f(rt.pools.rest, 3)]]);
	P(`"own" is the investor's or the treasury's part of each HEART invested; "pool" is the pools' part (${f(DYN.poolShare, 2)} of each HEART). Between treasuries: ${fr(rt.between)}. Issued ${f(rt.issued, 2)}, melted ${f(rt.melted, 2)} HEARTS a person a day. Largest unexplained rest: ${pct(rt.unexplainedMax, 3)} of a place's inflow. Price moves of all places together (with the arbitrage bot): ${f(rt.movesAll, 3)}.`);
	P('');
	P('## H5. Every MIND over its life, in HEARTS (dynamic main)');
	P('');
	const mr = HJ.mindReturns;
	P(`${mr.minds} MINDs, ${mr.ended} ended. ${mr.aboveMelt} of the ${mr.withThreeYears} with at least 3 years returned more than the ${pct(RATE, 0)} melt on average; ${mr.aboveMeltEnded} of those ended. ARTS: ${mr.arts ? `${pct(mr.arts.compounded, 1)} a year compounded over ${mr.arts.years} years` : '–'}.`);
	P('');
	table(['MIND', 'years', 'mean return a year', 'price change a year', 'compounded', 'ended'], mr.list.map((o) => [o.nm, o.years, pct(o.mean, 1), o.priceChange === null ? '–' : pct(o.priceChange, 1), pct(o.compounded, 1), o.ended ? 'yes' : 'no']));
	P('## H6. Variations (each its own run; steady state = its last 10 years)');
	P('');
	table(['Run', 'μ, HEARTS', 'margin (melt − μ)', 'μ, R (script)', 'σ, HEARTS', 'Prop. 2 Gini, HEARTS', 'measured Gini (HEARTS): last year; trend / 10 y', 'dividend yield', 'pools\' share of MIND (HEARTS)', 'R a HEART at rest', 'basic bundle, most in a year (year)', 'same, script "in MIND"'], DLADDER.map(([k, label]) => {
		const x = HJ.variations[k];
		return [label, pct(x.muH, 2), `${f(x.marginH * 100, 2)} pt`, pct(x.muR, 2), pct(x.sgH, 2), x.gini2H === null ? '–' : f(x.gini2H, 2), `${f(x.giniH.y60, 3)}; ${x.giniH.trend === null ? '–' : (x.giniH.trend >= 0 ? '+' : '') + f(x.giniH.trend, 3)}`, pct(x.yield, 1), pct(x.shares.pools, 1), f(x.hpRest, 3), `${f(x.bundleMax.v, 3)} (${x.bundleMax.year})`, `${f(x.bundleMaxScript.v, 3)} (${x.bundleMaxScript.year})`];
	}));
	P('## H7. The static world (main:base) and the long-lived plant (main:geo), in HEARTS');
	P('');
	const srt = st.roundTrip;
	P(`Round trip at rest: people in ${fr(srt.people.in)}, out ${fr(srt.people.out)}, change ${f(srt.people.change, 2)}; treasuries in ${fr(srt.treasuries.in)}, out ${fr(srt.treasuries.out)}, change ${f(srt.treasuries.change, 2)}; pools in ${fr(srt.pools.in)}, out ${fr(srt.pools.out)}, change ${f(srt.pools.change, 2)}. Issued ${f(srt.issued, 2)}, melted ${f(srt.melted, 2)}. R a HEART at rest: ${f(st.hpRest, 4)}.`);
	P('');
	P(`1 GEOmind of the year after founding, 20 years on (dividends kept, after the melt): ${f(HJ.geo.geo, 2)} in HEARTS (${f(HJ.geo.geoR, 2)} in R); 1 SOLARmind: ${f(HJ.geo.solar, 2)} (${f(HJ.geo.solarR, 2)} in R).`);
	P('');
	P('## H8. Every year of the dynamic main, in HEARTS');
	P('');
	P(`μ and σ: each person's yearly return on what they held at the start of the year (dividends plus price change, before the melt), its mean and its spread across people. The measured Gini values what people hold at the year's end; Proposition 2's Gini counts only the spread that returns make. The Gini of what people hold in HEARTS rose ${sD.giniH.trend >= 0 ? '+' : ''}${f(sD.giniH.trend, 3)} per 10 years over years ${L - 19}–${L} (least squares).`);
	P('');
	table(['Year', 'R a HEART', 'μ', 'σ', 'measured Gini of holdings (HEARTS)', 'same in R (script)', 'a day of living', 'a day\'s basic bundle', 'people / pools, share of MIND'], HJ.byYear.map((x) => [x.year, f(x.hp, 3), x.muH === null ? '–' : pct(x.muH, 2), x.sgH === null ? '–' : pct(x.sgH, 2), f(x.giniH, 3), f(x.giniR, 3), f(x.L, 2), f(x.bundle, 4), `${pct(x.people, 1)} / ${pct(x.pools, 1)}`]));
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(HJ, null, 1));

// ── report: the static previous main ────────────────────────────────────────────────────────────────────────────────
bind(results['main:base']);
P('# Static (previous main)');
P('');
P(`${N0} people, ${BASE_COOPS} COOPs (+3 in some shocks), seed ${BASE.seed}. Daily steps in the first year and for ${DAILY_AFTER} days after each shock (year ${BR}); weekly steps (traded as daily batches) otherwise. Steady state = years ${ssA + 1}–${ssB}. R = the geometric mean of the SOLAR-, HABITAT- and CITYmind prices.`);
P('');
const S0 = results['main:base'];
P(`Land: ${f(S0.landTotal / N0)} m² a person (${f(S0.landLeasable / N0)} leasable, the rest streets and parks), all of it the City COOP's. Seed capacities: 115 % of the starting need (goods exist, money does not) or 25 % (empty city).`);
P('');
P(`Main scenario: a person pays for what a COOP makes in that COOP's MIND (the Aven pays with any MIND, the pools convert it, the seller receives only its own MIND, into its treasury). Each HEART invested makes 1 MIND: ${f(0.5, 1)} to the investor, ${f(0.5 - BASE.poolShare, 1)} to the COOP's treasury and ${f(BASE.poolShare, 1)} to the pools; sales are not levied. No human labour is paid: every human has one Aven, and the Avens do and propose all work items. A treasury pays for inputs and building from other COOPs, for operating work items (2 R a unit, in its prices; paid to the human whose Aven does them) and ground rent; Law 5, every sale pays its owners: 20 % of every sale goes at once, as a dividend in the seller's own MIND, to everyone who holds that MIND (people and other treasuries, pro rata; not the seller, not the pools); the rest lands in the treasury. What a treasury holds of its own MIND above 60 days of running costs and planned building it pays out within about a month for accepted work proposals (to the humans whose Avens propose and deliver the work, by what each Aven delivers). No rent payout, no basic income.`);
P('');

P('## S1. Static main against the side comparisons (60 years from a cold start with goods)');
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
metric('Mean holding: top half of Aven pay ÷ bottom half', (S) => f(avg(S, ssA, ssB, (y) => y.workRatio), 1));
metric('Gini of consumption', (S) => f(Math.max(0, avg(S, ssA, ssB, (y) => y.giniC)), 2));
metric('Dividend yield a year', (S) => pct(avg(S, ssA, ssB, (y) => y.yield), 1));
metric('Paid for Aven work items (operating), R a person a year', (S) => f(avg(S, ssA, ssB, (y) => y.wagesR / y.N)));
metric('Paid for Aven work proposals, R a person a year', (S) => f(avg(S, ssA, ssB, (y) => y.propR / y.N)));
metric('Paid as dividends, R a person a year', (S) => f(avg(S, ssA, ssB, (y) => y.divR / y.N)));
metric('Burned or retired, share of issuance', (S) => pct(avg(S, ssA, ssB, (y) => y.burned / y.issued), 0));
metric('Basic bundle, R a day: year 1 / 10 / 60', (S) => `${f(at(S, 1).cpi, 2)} / ${f(at(S, 10).cpi, 2)} / ${f(at(S, YRS).cpi, 2)}`);
metric('COOP-days short of working capital (60 y)', (S) => f(S.Y.reduce((s, y) => s + y.insolv.reduce((a, b) => a + b, 0), 0)));
table(['Measure', ...KEYS.map((k) => RUNS[k].label)], rows1);
P('Under hold-to-use the "basic bundle" is the yearly melt on the MIND stock that grants a day of basic use. No human labour is paid: every human has one Aven, the Avens do and propose the work items, and what an Aven delivers differs from Aven to Aven (lognormal, spread 0.6). "Top half" are the people whose Avens earn more than the median.');
P('');

P('## S2. MIND prices over time, static main (R)');
P('');
{
	const S = results['main:base'];
	const yrs = [1, 2, 5, 10, 20, 30, 45, YRS].filter((y) => y <= S.Y.length);
	table(['COOP', ...yrs.map((y) => `y${y}`)], NAMES.slice(0, BASE_COOPS).map((n, k) => [n, ...yrs.map((y) => f(at(S, y).P[k], 2))]));
	P(`Dividend yield by MIND, years ${ssA + 1}–${ssB}: ${NAMES.slice(0, BASE_COOPS).map((n, k) => `${n} ${pct(avg(S, ssA, ssB, (y) => y.yk[k]), 1)}`).join(', ')}.`);
	P('');
}

P('## S3. Money in the static main: where it sits (MIND count a person) and who holds it');
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

P('## S4. Treasuries in the static main: what comes in and where it goes (R a person a year, steady state)');
P('');
{
	const rows = KEYS.slice(0, 3).map((k) => {
		const S = results[`${k}:base`];
		const g = (fn) => avg(S, ssA, ssB, (y) => fn(y.flows) / y.N);
		const inn = g((x) => x.heartIn + x.salesHH + x.b2b + x.rent);
		const melt = avg(S, ssA, ssB, (y) => (y.split.treR * RATE) / y.N);
		return [RUNS[k].label, f(g((x) => x.heartIn)), f(g((x) => x.salesHH)), f(g((x) => x.b2b + x.rent)), f(inn), f(g((x) => x.b2b + x.rent)), f(g((x) => x.wages)), `${f(g((x) => x.prop))} (${pct(g((x) => x.prop) / inn, 0)})`, `${f(g((x) => x.div))} (${pct(g((x) => x.div) / inn, 0)})`, f(melt), f(avg(S, ssA, ssB, (y) => (y.retired || 0) / y.N))];
	});
	table(['Run', `in: the treasury's part of the new MIND (${f(0.5 - BASE.poolShare, 2)} of each HEART)`, 'in: sales to people', 'in: sales to COOPs and rent', 'in: total', 'out: inputs, building, rent', 'out: Aven work items, operating', 'out: Aven work proposals (share of in)', 'out: dividends (share of in)', 'melt on treasuries', 'retired (MIND)'], rows);
	const S = results['main:base'];
	P(`Days of running costs a treasury holds (main, year ${YRS}): ${NAMES.slice(0, BASE_COOPS).map((n) => `${n} ${f(at(S, YRS).cover[n])}`).join(', ')}. A person\'s Aven earns ${f(avg(S, ssA, ssB, (y) => y.wagesR / y.N))} R a year for operating items and ${f(avg(S, ssA, ssB, (y) => y.propR / y.N))} R for work proposals; the person also gets ${f(avg(S, ssA, ssB, (y) => y.rt.divHH / y.N))} R of dividends.`);
	P('');
}

P('## S5. Fairness in the static world: how treasuries pay out, and Proposition 2');
P('');
P(`Each run: ${BR} years from a cold start (steady state = years ${lA + 1}–${lB}); then everyone's holdings are made as unequal as Germany's wealth (Gini 0.72, same total) and the run goes on to year ${LAD_END}.`);
P('');
const ratio = (x) => (x === null || !isFinite(x) ? '–' : x > 1000 ? '> 1,000' : f(x, 1));
table(['Treasury payout', 'basic-need shortfall', 'people\'s share of all MIND', `mean holding, R (W* = ${f(W_STAR)})`, 'top ÷ bottom half of work pay', 'Gini owned at rest', 'dividend yield', 'μ: mean return (dividends + price)', 'σ across people', 'Prop. 2 Gini', 'work pay a person, R a year', 'work + dividends, share of treasury inflow'], LADDER.map(([key, label]) => {
	const S = results[`lad:${key}`];
	const p2 = prop2(S, lA, lB);
	const inn = avg(S, lA, lB, (y) => y.flows.heartIn + y.flows.salesHH + y.flows.b2b + y.flows.rent);
	const outp = avg(S, lA, lB, (y) => y.flows.prop + y.flows.div);
	return [label, pct(avg(S, lA, lB, (y) => y.short), 1), pct(avg(S, lA, lB, (y) => y.peopleShareR), 0), f(avg(S, lA, lB, (y) => y.meanW)), ratio(avg(S, lA, lB, (y) => y.workRatio)), f(avg(S, lA, lB, (y) => y.gini), 2), pct(avg(S, lA, lB, (y) => y.yield), 1), pct(p2.mu, 1), pct(p2.sg, 2), p2.g === null ? '–' : f(p2.g, 2), f(avg(S, lA, lB, (y) => (y.propR + y.wagesR) / y.N)), pct(outp / inn, 0)];
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

P('## S6. Scenarios on the static main');
P('');
P(`### S6.1 Cold start in an empty city (25 % of the needed capacity on day 1)`);
P('');
{
	const S = results['main:empty'];
	const first = S.Y.find((y) => y.short < 0.01);
	table(['shortfall y1', 'y3', 'y5', 'y10', `y${S.Y.length}`, 'first year with < 1 %', 'COOP-days short of working capital'], [[pct(at(S, 1).short), pct(at(S, 3).short), pct(at(S, 5).short), pct(at(S, 10).short), pct(at(S, S.Y.length).short), first ? first.year : 'never', f(S.Y.reduce((s, y) => s + y.insolv.reduce((a, b) => a + b, 0), 0))]]);
}

P(`### S6.2 One COOP fails (the COOP that makes most of the food delivers 10 % of its capacity from year ${BR})`);
P('');
table(['failing COOP', 'City takes the plant and leases it on?', 'food shortfall, year after', 'any shortfall, years 2–10 after', 'its MIND price before → 1 y after', 'its MIND price 10 y after'], ['fail-city', 'fail-none'].map((v) => {
	const S = results[`main:${v}`], k = S.failK;
	return [NAMES[k], v === 'fail-city' ? `yes (to ${NAMES[k]}-B, 180 days' grace on rent)` : 'no', pct(at(S, BR + 1).shortG[0]), pct(avg(S, BR + 1, BR + 10, (y) => y.short)), `${f(at(S, BR).P[k], 2)} → ${f(at(S, BR + 1).P[k], 3)}`, f(at(S, BR + 10).P[k], 3)];
}));

P(`### S6.3 A founder ring self-invests (4 people found JUNK, a COOP with no output, in year ${BR}; its treasury pays them 90 % of what it gets)`);
P('');
table(['Aven rule', 'ring income ÷ others\' income', 'ring wealth ÷ others\' wealth, y+10', 'HEARTS that went to JUNK (share of all; the ring is 1.6 %)', 'JUNKmind price y+1 / y+10', 'partner MIND drained from JUNK\'s pool (R a person, of deposited)'], ['founder', 'founder-output'].map((v) => {
	const S = results[`main:${v}`];
	const ys = S.Y.filter((y) => y.year > BR);
	const h = ys.reduce((s, y) => s + y.hearts[JUNK], 0) / ys.reduce((s, y) => s + y.issued, 0);
	return [v === 'founder' ? 'price (paper)' : 'delivered output', f(S.ringRatio, 1), f(at(S, BR + 10).ringW, 1), pct(h, 2), `${f(at(S, BR + 1).P[JUNK], 3)} / ${f(at(S, BR + 10).P[JUNK], 3)}`, `${f(S.partnerLoss, 0)} of ${f(S.partnerDep, 0)}`];
}));

P(`### S6.4 Population grows 2 %/yr from a cold start (land fixed)`);
P('');
table(['Run', 'people, last year', 'shortfall, all, y10 / last', 'shortfall, newcomers (< 3 y), y10 / last', 'ground rent R/m²·yr, last', 'land leased, last', `money a person vs u/(r+n) = ${f(U / (RATE + 0.02))}`, 'people\'s share of MIND, last', 'Gini owned, last'], ['main', 'retire', 'quota'].map((k) => {
	const S = results[`${k}:grow`];
	const L = S.Y.length;
	return [RUNS[k].label, at(S, L).N, `${pct(at(S, 10).short)} / ${pct(at(S, L).short)}`, `${pct(at(S, 10).newShort)} / ${pct(at(S, L).newShort)}`, f(at(S, L).rho * 365, 3), pct(at(S, L).occ, 0), f(at(S, L).mPer), pct(at(S, L).peopleShareR, 0), f(at(S, L).gini, 2)];
}));

P(`### S6.5 The §9.2 Gini path in the main scenario (holdings made as unequal as Germany's in year ${BR}, same total)`);
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

P(`### S6.6 §8: a long-lived plant (GEO: 80-year life, built in one piece for 15 % of the city's energy) founded in year ${BR}`);
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

P('## S7. The round trip and the macro checks (static main, steady state)');
P('');
{
	// one day of the whole economy, R a person a day, averaged over the steady state: what flows into and out of each
	// place, the change of what that place holds, and what the flows do not explain (routing costs and price moves)
	const S = results['main:base'];
	const pd = (fn) => avg(S, ssA, ssB, (y) => fn(y.rt, y) / y.N / Math.max(1, y.rt.days));
	const d = (key) => avg(S, ssA, ssB, (y) => {
		const prev = S.Y[y.year - 2];
		return prev ? (y.split[key] - prev.split[key]) / y.N / 365 : null;
	});
	const row = (place, ins, outs, dk) => {
		const inT = ins.reduce((a, [, v]) => a + v, 0), outT = outs.reduce((a, [, v]) => a + v, 0), ch = d(dk);
		return [place, ins.map(([l, v]) => `${l} ${f(v, 2)}`).join('; '), outs.map(([l, v]) => `${l} ${f(v, 2)}`).join('; '), f(inT - outT, 2), f(ch, 2), f(ch - (inT - outT), 2)];
	};
	const wal = row('People\'s wallets',
		[['own half of the HEARTS they invest', pd((r) => r.walHeart)], ['Aven work items', pd((r) => r.ops)], ['Aven work proposals', pd((r) => r.prop)], ['dividends', pd((r) => r.divHH)]],
		[['buying from COOPs', pd((r) => r.buy)], ['melt', pd((r) => r.meltW)]], 'walR');
	const tre = row('COOP treasuries',
		[[`the treasury's part of the new MIND (${f(0.5 - BASE.poolShare, 2)} of each HEART)`, pd((r) => r.treHeart)], ['sales to people', pd((r) => r.buy)]],
		[['dividends to people', pd((r) => r.divHH)], ['Aven work items', pd((r) => r.ops)], ['Aven work proposals', pd((r) => r.prop)], ['melt', pd((r) => r.meltT)]], 'treR');
	const pool = row('Pools',
		[[`the pools' part of the new MIND (${f(BASE.poolShare, 2)} of each HEART)`, pd((r) => r.poolHeart)], ['routing costs', pd((r) => r.routeCost)]],
		[['melt', pd((r) => r.meltP)]], 'poolR');
	table(['Place', 'in (R a person a day)', 'out', 'in − out', 'change of what it holds', 'not explained: routing, price moves'], [wal, tre, pool]);
	P(`Between treasuries (these cancel out, so they are not in the table): sales to other COOPs ${f(pd((r) => r.b2b), 2)}, ground rent to the City COOP ${f(pd((r) => r.rent), 2)}, dividends to treasuries that hold other MINDs ${f(pd((r) => r.divT), 2)} R a person a day. People pay routing costs only on the share of their payments that the pools convert.`);
	P('');
	const issued = pd((r) => r.walHeart + r.treHeart + r.poolHeart), melt = pd((r) => r.meltW + r.meltT + r.meltP + r.meltA);
	const inc = pd((r) => r.walHeart + r.ops + r.prop + r.divHH);
	const p2 = prop2(S, ssA, ssB);
	const drift = Math.pow(at(S, YRS).cpi / at(S, ssA).cpi, 1 / (YRS - ssA)) - 1;
	const short = avg(S, ssA, ssB, (y) => y.short), ins = S.Y.reduce((a, y) => a + y.insolv.reduce((x, z) => x + z, 0), 0);
	const insLate = S.Y.slice(10).reduce((a, y) => a + y.insolv.reduce((x, z) => x + z, 0), 0);
	const ok = (b) => (b ? '✓' : '✗');
	P('Macro checks:');
	P('');
	P(`- ${ok(Math.abs(issued - melt) / issued < 0.03)} New money equals the melt at rest: ${f(issued, 2)} R a person a day issued (24 HEARTS converted), ${f(melt, 2)} R melted.`);
	P(`- ${ok(Math.abs(avg(S, ssA, ssB, (y) => y.mPer) / M_STAR - 1) < 0.05)} Money a person rests at the paper's level u/r: ${f(avg(S, ssA, ssB, (y) => y.mPer))} MIND against ${f(M_STAR)}.`);
	P(`- ${ok(short < 0.001)} Every basic need is met: shortfall ${pct(short, 2)} at rest; consumption Gini ${f(Math.max(0, avg(S, ssA, ssB, (y) => y.giniC)), 2)}.`);
	P(`- ${ok(insLate === 0)} COOPs stay solvent: ${f(ins)} COOP-days short of working capital in ${YRS} years, ${f(insLate)} after year 10.`);
	P(`- ${ok(Math.abs(drift) < 0.01)} Prices are stable at rest: the basic bundle changes ${pct(drift, 2)} a year over years ${ssA + 1}–${ssB}.`);
	P(`- ${ok(avg(S, ssA, ssB, (y) => y.peopleShareR) > 0.8)} People own the economy: ${pct(avg(S, ssA, ssB, (y) => y.peopleShareR), 0)} of all MIND by value.`);
	P(`- ${ok(p2.mu !== null && p2.mu < RATE)} Holding never beats the melt: μ = ${pct(p2.mu, 1)} (dividend yield ${pct(avg(S, ssA, ssB, (y) => y.yield), 1)}) against r = ${pct(RATE, 0)}, so Proposition 2's Gini stays bounded (${p2.g === null ? '–' : f(p2.g, 2)}).`);
	P(`- Where a person's income comes from, at rest: own half of the HEARTS ${pct(pd((r) => r.walHeart) / inc, 0)}, Aven work items ${pct(pd((r) => r.ops) / inc, 0)}, Aven work proposals ${pct(pd((r) => r.prop) / inc, 0)}, dividends ${pct(pd((r) => r.divHH) / inc, 0)}. No wage for human labour.`);
	P(`- Gini of what people hold: ${f(avg(S, ssA, ssB, (y) => y.gini), 2)}; the top half of Aven pay holds ${f(avg(S, ssA, ssB, (y) => y.workRatio), 1)}× the bottom half.`);
	P('');
}

P(`_Runtime ${((Date.now() - T0) / 1000).toFixed(1)} s._`);
console.log(out.join('\n'));
const DYNCOLS = 'days_of_living_R,income_R_pd,spent_R_pd,share_of_income_spent,wallet_melt_share_of_income,treasury_share_value,pool_share_value,P_min,P_max,sd_log_P,live_MINDs,worst_basic_coverage,person_days_short,person_days,zero_aven_strict_share_of_days,zero_aven_strict_worst_ratio,zero_aven_worst_coverage,zero_aven_holding_mean_R,zero_aven_holding_min_R,basic_bundle_in_MIND,real_consumption_mean,real_consumption_decile1,real_consumption_decile5,real_consumption_decile10,real_consumption_zero_aven,failures,exits,foundings,shocks,mean_productivity';
if (CSV) writeFileSync(CSV, ['run,year,N,shortfall,newcomer_shortfall,routing_cost,basic_bundle_R,money_per_person,wallets_pp,treasuries_pp,pools_pp,people_share_value,gini_owned,dividend_yield,mean_return,sigma_returns,dividends_pp,work_proposals_pp,' + BASE_NAMES.slice(0, BASE_COOPS).map((n) => `P_${n}`).join(',') + ',' + DYNCOLS + ',' + HEARTCOLS].concat(csvRows).join('\n') + '\n');
