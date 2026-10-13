// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE ENGINE — one day of the world, the slow weekly loop inside it, the two ledgers, and the getters the
 * page reads. Pure and seeded: the same settings and seed give the same world on every machine, in node and in the
 * browser (no node APIs here).
 *
 *   const w = createWorld({ people: 250, seed: 20261012 });
 *   for (let d = 0; d < 365 * 30; d++) step(w);
 *   getPeople(w); getCoops(w); getFlows(w); getEnergy(w); getDay(w);
 *
 * A day (world model 4.3): the calendar and shocks → the melt → every person's HEARTS become MIND (half to the
 * person, the rest to the COOP's treasury, a tenth of that into its pools) → the pools' prices → the harvest of sun
 * and geothermal → nature (forest, rain, logs, pits) → costs, forward margins, posted prices → each Aven orders →
 * COOPs plan → the consumer goods clear (fair shares when a good runs short) → the energy dispatch (basics, running,
 * building, R&D, storage) → materials clear → the works make, upkeep rebuilds, projects build, R&D learns → payment
 * through the pools, Law 5 → records → running items paid to Avens → wear → the slow loop (arbitrage, ground rent,
 * reserve and payout, learning, building, where the HEARTS go, Law 3 foundings, receivership) → both ledgers checked.
 *
 * The slow loop runs every day in the first year and for 90 days after a scheduled shock, otherwise every 7th day.
 */
import { exp, log, pow } from './dmath.js';
import { DEFAULTS, createWorld as genesisWorld, blankToday, initPerson, firstAlloc, capDayOf, plantCapDay, vcOf } from './genesis.js';
import { BASICS, BED, CLASS, CLASS_NAMES, COMPUTE, CONSUMER, ENERGY, FOOD, G, GOOD_IDS, GOODS_, LIMIT, LIMIT_NAMES, MATERIALS, MAX_COOPS, PHYSICAL, POOL_SHARE, SPRING, WATER } from './consts.js';
import { GOODS, MONTH_NAMES, YEAR_DAYS } from './primitives.js';
import { calendar, harvest, dispatch, shockFactor } from './energy.js';
import { updatePrices, poolInflow, arbitrage, swap } from './pools.js';
import { postPrices, peopleOrders, openPayments, payDirect, payRest, settleSwaps, law5, sellerOutcome } from './market.js';
import { nature, margins, costs, plan, produce, runningItems, wear, buildDecisions, payout, learn, rentDue, adjustRent, foundings, receiverships, treasuryR, kwhOf, inputsOf, runHours, freeLand, firstPlotM2 } from './coops.js';
import { initRecords, recordDay, physicsCeiling, foundingStores } from './records.js';
import { newBorder, importsDay, shareLine, repayAdvances } from './border.js';
import { villageRecords } from './village.js';
import { catalogList } from './primitives.js';
import { OUTDOOR, INDOOR } from './food.js';

const M = MAX_COOPS;
const PEOPLE_GOODS = [FOOD, WATER, BED, GOODS_, SPRING, COMPUTE];
/** goods made as they are sold (a bed-day, an hour at the spring, an hour of Aven service): nothing to store */
const ON_DEMAND = [BED, SPRING, COMPUTE];
const EMA_DEMAND = 1 / 10;

export { DEFAULTS };

// ── a world ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** build a world from settings (see DEFAULTS in ./genesis.js for every knob) */
export function createWorld(config = {}) {
	const w = genesisWorld(config);
	w.basicCost = new Float64Array(w.Nmax);
	w.purse = new Float64Array(w.Nmax);
	w.badge = new Uint8Array(G);
	w.repl = new Float64Array(M);
	w.lastSlow = -1;
	w.births = 0;
	w.unpaidR = 0;
	w.energyLedger = { leaks: [], maxRel: 0 };
	w.matter.prevStock = stockTotals(w);
	w.matter.prevRaw = rawTotal(w);
	w.liquid = new Uint8Array(M);
	w.poolQueue = new Float64Array(M); // pool inflow waiting for the weekly slice (bootstrap off only)
	// the MaiaCity COOP's bank at the border (paper §11.4), in €: the founding euros (foundingEur; or reserveYears of the
	// village's food at wholesale; by default drawn from the founders outside as far as the village needs) and each
	// COOP's deposit, and what came in and went out (./border.js)
	w.border = newBorder(w, w.cfg.foundingEur != null ? w.cfg.foundingEur : w.cfg.reserveYears != null ? w.cfg.reserveYears * w.cfg.people * w.c.need[0] * 365 * w.c.eur.food : Infinity);
	// what was bought outside before day 0 to found the village (./records.js foundingBill)
	w.founding = foundingStores(w);
	// the catalog's day-0 guesses, in R, indexed like the rate card to the HEARTS issued a day; genesisPrices below
	// finds the real day-0 prices from costs. A few rounds of that fixed point do not converge, so a guess left at
	// 24 HEARTS a day would leave day-0 prices in a 48-HEARTS world only part of the way to double (energy came out
	// ×1.67), and the two worlds would differ from day 0 for a reason that is not money
	w.pbar = Float64Array.from(w.c.p0g, (x) => x * (w.c.rentIdx ?? 1));
	w.laws = { checks: 0, maxRel: 0, breaches: [], poolMissed: 0 };
	w.peopleShortEma = new Float64Array(4);
	w.coopLowDays = 0;
	w.shares = new Float64Array(G * M);
	if (w.cfg.ownerSpend === 'dividends') {
		w.spendCap = new Float64Array(w.Nmax).fill(-1);
		for (const i of w.ownerIds) w.spendCap[i] = 0;
	}
	initDemand(w);
	// each plant starts in use as far as its day-0 buyers will use it
	for (const co of w.coops) {
		const cap = capDayOf(w, co, 0);
		for (const pl of co.plants) pl.utilEma = cap > 0 ? Math.min(1, co.demandEma / cap) : 0;
	}
	genesisPrices(w);
	for (const co of w.coops) co.salesShareR = 0;
	// the bootstrap (§11.4): each Aven's first HEARTS go to the COOPs it will buy from, at day-0 prices
	for (let i = 0; i < w.N; i++) bootstrapAlloc(w, i);
	// the replicator starts where the first HEARTS went
	for (let i = 0; i < w.N; i++) for (let k = 0; k < M; k++) w.repl[k] += w.alloc[i * M + k] / w.N;
	initRecords(w);
	deciles(w);
	return w;
}

/**
 * The bootstrap of §11.4: a person's first HEARTS go to the COOPs the person will buy from, in the shares of what
 * the person will spend there on day 0 (the basic bundle at day-0 prices, each good's sellers by capacity), with a
 * little in every COOP so every MIND reaches the pools on day 0. Without the bootstrap: three COOPs of the Aven's
 * own taste (./genesis.js firstAlloc).
 */
function bootstrapAlloc(w, i) {
	if (!w.cfg.bootstrap) return;
	const b = i * M, need = w.c.need;
	const spendG = { [FOOD]: need[0] * w.pbar[FOOD], [WATER]: need[1] * w.pbar[WATER], [ENERGY]: need[2] * w.pbar[ENERGY], [BED]: need[3] * w.pbar[BED] };
	let total = 0;
	for (const g of BASICS) total += spendG[g];
	let sum = 0;
	for (let k = 0; k < M; k++) w.alloc[b + k] = 0;
	for (const co of w.coops) {
		if (!co.alive) continue;
		let v = 0.01;
		if (spendG[co.good] !== undefined) {
			let capAll = 0;
			for (const c2 of w.coops) if (c2.alive && c2.good === co.good) capAll += Math.max(1e-9, capDayOf(w, c2, w.day));
			v += (0.8 * spendG[co.good] * Math.max(1e-9, capDayOf(w, co, w.day))) / capAll / total;
		}
		w.alloc[b + co.k] = v;
		sum += v;
	}
	for (let k = 0; k < M; k++) w.alloc[b + k] /= sum;
}

/** what each seller expects to be asked for on day 0: need, split by capacity */
function initDemand(w) {
	const N = w.N, c = w.c;
	const total = { [FOOD]: N * c.need[0], [WATER]: N * c.need[1], [ENERGY]: N * c.need[2] * 2.2, [BED]: N, [GOODS_]: N * 1.0, [SPRING]: N * 0.6, [COMPUTE]: N * 2 };
	for (const g of Object.keys(total).map(Number)) {
		const sellers = w.coops.filter((co) => co.alive && co.good === g);
		let capSum = 0;
		for (const co of sellers) capSum += Math.max(1e-9, capDayOf(w, co, 0));
		for (const co of sellers) {
			co.demandEma = (total[g] * Math.max(1e-9, capDayOf(w, co, 0))) / capSum;
			co.soldEma = co.demandEma;
			co.madeEma = co.demandEma;
		}
	}
}

/**
 * Day-0 prices: the reference starts at full cost (world model 4.4). Full costs depend on each other (energy and
 * materials are inputs), so they are found by a few rounds of fixed point from the catalog's guesses. The treasuries'
 * running-cost averages start at the same day-0 costs, so the reserve means something from the first payout.
 */
function genesisPrices(w) {
	for (const co of w.coops) co.capDay = capDayOf(w, co, 0);
	for (let it = 0; it < 6; it++) {
		// the starting plants are booked at this round's day-0 prices (a plant's book value is fixed once the prices are)
		for (const co of w.coops) for (const pl of co.plants) pl.bookR = undefined;
		costs(w, true);
		const s = new Float64Array(G), n = new Float64Array(G);
		for (const co of w.coops) {
			// a COOP with no plant yet (the geothermal stage switched off) has no cost to average
			if (!co.alive || !(co.capDay > 0) || !Number.isFinite(co.fullR)) continue;
			s[co.good] += co.fullR * co.capDay;
			n[co.good] += co.capDay;
		}
		for (let g = 0; g < G; g++) if (n[g] > 0 && s[g] > 0) w.pbar[g] = s[g] / n[g];
	}
	for (const co of w.coops) {
		if (!co.alive) continue;
		// without a plant it quotes the good's day-0 price (as a COOP still building its first plant does)
		if (!(co.capDay > 0) || !Number.isFinite(co.fullR)) (co.fullR = w.pbar[co.good]), (co.floorR = Number.isFinite(co.floorR) ? co.floorR : 0);
		co.priceR = co.ref = co.lastPrice = Math.max(co.fullR, co.floorR);
		let runH = 0, m2 = 0;
		for (const pl of co.plants) (runH += runHours(w, pl)), (m2 += pl.landM2);
		co.costREma = runH * w.c.rateR + co.varR * co.soldEma + (co.city ? 0 : m2 * w.land.rent);
	}
	w.genesisPriceR = Float64Array.from(w.pbar);
}

// ── one day ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** run the world one day */
export function step(w) {
	const cfg = w.cfg;
	// the MIND slots in use (a slot is never reused, so this only grows)
	if (!w.ks || w.ks.length !== w.coops.length) w.ks = w.coops.map((co) => co.k);
	w.today = blankToday(w);
	resetDay(w);
	calendar(w);
	growPopulation(w);
	melt(w);
	invest(w);
	updatePrices(w);
	liquidity(w);
	if (w.day === 0)
		// day-0 prices are in R (full cost): each COOP posts them in its own MIND at the pools' first price
		for (const co of w.coops) co.price = co.priceR / w.P[co.k];
	harvest(w);
	nature(w);
	// the border: food and raw inputs bought outside today (./border.js)
	importsDay(w);
	const slow = cfg.dailySlow || w.day < YEAR_DAYS || w.day < w.slowUntil || w.day % 7 === 0;
	costs(w, slow || w.day === 0);
	margins(w);
	postPrices(w);
	peopleOrders(w);
	// the COOPs plan (their own requests are summed below, after the people's goods have cleared)
	plan(w, new Float64Array(5), { basics: 0, running: 0 });
	clearPeople(w);
	affordPeople(w);
	basicsLoads(w);
	affordCoops(w);
	const req = new Float64Array(5), heatReq = { basics: 0, running: 0 };
	// the domes' climate is the second part of the basics class (./energy.js dispatch serves water, people's basic power
	// and food first)
	let basicsB = 0;
	for (const co of w.coops) {
		if (!co.alive) continue;
		for (let cl = 0; cl < 4; cl++) req[cl] += co.eReq[cl];
		if (co.good === BED) basicsB += co.eReq[CLASS.basics];
		heatReq.basics += co.heatReq;
		heatReq.running += co.heatRun;
	}
	let pBasic = 0, pExtra = 0;
	for (let i = 0; i < w.N; i++) (pBasic += w.basicEnergy[i]), (pExtra += w.extraEnergy[i]);
	req[CLASS.basics] += pBasic;
	w.today.pBasic = pBasic;
	req[CLASS.running] += pExtra;
	// what buyers ask of the energy sellers: basics and running in full, and what building (projects, the border's
	// exports) and R&D took. Building and R&D come after basics and running in the dispatch and are scheduled into what
	// is left, so what they would have liked more is no shortage: it neither raises the forward margin's price nor
	// calls a Law 3 founding (with it, one geothermal project asking a year of the hex's electricity read as a
	// shortage of 30 times the supply, and the price ran away)
	const cop = w.today.cop;
	w.energyAsked = req[0] + req[1] + Math.max(0, heatReq.basics - w.today.harvest.geoHeat) / cop;
	const reqCopy = Float64Array.from(req);
	// the border's export for accelerators: upkeep's right after running, a project's with building (./coops.js plan)
	shareLine(w);
	const exportAsk = { up: 0, build: 0 };
	for (const co of w.coops) if (co.alive) (exportAsk.up += co.exportUp), (exportAsk.build += co.exportBuild);
	const fill = dispatch(w, req, heatReq, basicsB, exportAsk);
	// what the energy sellers sold across the border is demand for their electricity too
	w.energyAsked += w.today.use[CLASS.building] + w.today.exportKwh;
	if (!cfg.rdAsks) w.energyAsked += w.today.use[CLASS.rd];
	else w.energyAsked += reqCopy[CLASS.rd];
	w.today.req = reqCopy;
	w.today.fill = fill;
	deliver(w, fill);
	clearMaterials(w);
	produce(w, fill);
	settle(w, fill);
	badges(w, fill);
	recordDay(w);
	runningItems(w);
	wear(w);
	if (slow) slowLoop(w);
	sellerOutcome(w);
	endOfDay(w);
	// receivership is checked every day (a COOP fails the day it reaches 30 days unable to pay, so nobody keeps
	// delivering to it unpaid); Law 3 foundings and the decile sort run every 30 days, every day of the year alike
	receiverships(w);
	if (w.day > 0 && w.day % 30 === 0) {
		foundings(w);
		deciles(w);
	}
	for (const co of w.coops) if (co.alive && co.lowDays >= 30) w.coopLowDays++;
	checkLedgers(w);
	w.day++;
	return w;
}

/** run a world for some days, calling onDay(w) after each */
export function run(w, days, onDay) {
	for (let d = 0; d < days; d++) {
		step(w);
		if (onDay) onDay(w);
	}
	return w;
}

function resetDay(w) {
	const N = w.N;
	for (let i = 0; i < N; i++) (w.div[i] = 0), (w.income[i] = 0), (w.spent[i] = 0);
	for (const co of w.coops) {
		co.costR = 0;
		co.heartsToday = 0;
		co.sold = 0;
		co.salesR = 0;
		co.divR = 0;
		co.orders = 0;
		co.heatRun = 0;
		co.payoutToday = 0;
		co.unpaidBillR = 0;
		co.offeredToday = 0;
	}
	w.ledger.created.fill(0);
	w.ledger.melted.fill(0);
}

/** population growth (a setting): newcomers arrive with an Aven and nothing held */
function growPopulation(w) {
	const r = w.cfg.popGrowth;
	if (r > 0) w.births += w.N * (exp(r / YEAR_DAYS) - 1);
	while (r > 0 && w.births >= 1 && w.N < w.Nmax) {
		const i = w.N++;
		initPerson(w, i, w.day);
		firstAlloc(w, i);
		w.decH[i] = 0;
		w.decA[i] = 0;
		w.births -= 1;
		w.events.push({ day: w.day, kind: 'born', person: i });
	}
	// newcomers (a setting, the A07 test): on one day, n owner-only people (no Aven output, nothing held) join a
	// settled city. They get their 24 HEARTS a day like everyone; they are tracked apart from the genesis cohort
	const nc = w.cfg.newcomers;
	if (nc && w.day === nc.day) {
		w.newIds = w.newIds ?? [];
		for (let j = 0; j < nc.n && w.N < w.Nmax; j++) {
			const i = w.N++;
			initPerson(w, i, w.day);
			w.aven[i] = 0;
			firstAlloc(w, i);
			w.decH[i] = 0;
			w.decA[i] = 0;
			w.newIds.push(i);
			w.events.push({ day: w.day, kind: 'born', person: i });
		}
	}
}

/** the melt: every MIND everywhere (people, treasuries, pools) loses e^(−melt/365) a day; one global index */
function melt(w) {
	const f = exp(-w.cfg.melt / YEAR_DAYS);
	const melted = w.ledger.melted;
	const N = w.N, P = w.P;
	let meltR = 0;
	// only the slots a COOP has ever had (a slot is never reused)
	const ks = w.ks;
	for (let i = 0; i < N; i++) {
		const b = i * M;
		for (const k of ks) {
			const h = w.hold[b + k];
			if (h !== 0) {
				const x = h * f;
				melted[k] += h - x;
				w.hold[b + k] = x;
			}
		}
	}
	for (let j = 0; j < M * M; j++) {
		const h = w.tre[j];
		if (h !== 0) {
			const x = h * f;
			melted[j % M] += h - x;
			w.tre[j] = x;
		}
	}
	for (const p of w.pools)
		for (let i = 0; i < p.x.length; i++) {
			const h = p.x[i];
			const x = h * f;
			melted[p.members[i]] += h - x;
			p.x[i] = x;
		}
	for (const k of ks)
		if (w.poolQueue[k] > 0) {
			const h = w.poolQueue[k];
			melted[k] += h - h * f;
			w.poolQueue[k] = h * f;
		}
	for (let k = 0; k < M; k++) meltR += melted[k] * P[k];
	w.today.meltR = meltR;
	w.meltIndex *= f;
}

/**
 * Every person's HEARTS become MIND of the COOPs their Aven chose: one HEART, one MIND; half to the person, the other
 * half to the COOP's treasury, of which a tenth goes into the COOP's pools. No HEART stays anywhere.
 */
function invest(w) {
	const H = w.cfg.heartsPerDay, N = w.N;
	const alive = [];
	for (const co of w.coops) if (co.alive) alive.push(co.k);
	const toCoop = new Float64Array(M), toPeople = new Float64Array(M);
	const founder = new Int32Array(N).fill(-1);
	if (w.founders) {
		w.founders = w.founders.filter((f) => f.until > w.day && w.coops[f.k]?.alive);
		for (const f of w.founders) if (f.i < N) founder[f.i] = f.k;
	}
	for (let i = 0; i < N; i++) {
		const b = i * M;
		if (founder[i] >= 0) {
			w.hold[b + founder[i]] += H / 2;
			toPeople[founder[i]] += H / 2;
			toCoop[founder[i]] += H;
			w.heartsR[i] = (H / 2) * w.P[founder[i]];
			continue;
		}
		let s = 0;
		for (const k of alive) if (w.alloc[b + k] > 0) s += w.alloc[b + k];
		if (!(s > 0)) {
			// an Aven with nowhere to invest falls back on the City COOP
			w.hold[b + w.cityK] += H / 2;
			toPeople[w.cityK] += H / 2;
			toCoop[w.cityK] += H;
			w.heartsR[i] = (H / 2) * w.P[w.cityK];
			continue;
		}
		let hr = 0;
		for (const k of alive) {
			const a = w.alloc[b + k];
			if (!(a > 0)) continue;
			const x = (H * a) / s;
			w.hold[b + k] += x / 2;
			toPeople[k] += x / 2;
			toCoop[k] += x;
			hr += (x / 2) * w.P[k];
		}
		w.heartsR[i] = hr;
	}
	// without the bootstrap the pools get their tenth in weekly slices (paper §9.3, world model 4.3 step 11): they are
	// empty on day 0 and fill on day 7; with it they are seeded the day the HEARTS convert
	const queue = !w.cfg.bootstrap;
	if (queue && w.day > 0 && w.day % 7 === 0)
		for (let k = 0; k < M; k++) if (w.poolQueue[k] > 0 && poolInflow(w, k, w.poolQueue[k])) w.poolQueue[k] = 0;
	let R = 0;
	for (let k = 0; k < M; k++) {
		const x = toCoop[k];
		if (!(x > 0)) continue;
		w.ledger.created[k] += x;
		const co = w.coops[k];
		co.heartsToday += x;
		const half = x / 2;
		const pool = half * POOL_SHARE;
		const tre0 = w.tre[k * M + k];
		w.tre[k * M + k] += half - pool;
		let pooled = pool;
		if (queue) w.poolQueue[k] += pool;
		else if (!poolInflow(w, k, pool)) (w.tre[k * M + k] += pool), (pooled = 0), w.laws.poolMissed++;
		// the law, checked: people got half of the MIND these HEARTS made, the treasury and the pools the other half,
		// a tenth of that half into the pools
		lawCheck(w, 'invest: people half', toPeople[k], half);
		lawCheck(w, 'invest: treasury + pools half', w.tre[k * M + k] - tre0 + pooled, half, Math.abs(tre0));
		if (pooled > 0) lawCheck(w, 'invest: pools tenth', pooled, half * POOL_SHARE);
		R += x * w.P[k];
	}
	w.today.investR = R;
}

/**
 * A law's two sides must agree (to rounding, relative to the larger of the amount and `scale`, the size of the
 * numbers it was worked out from); a breach is recorded and, outside test mode, stops the world.
 */
function lawCheck(w, what, got, want, scale = 0) {
	const L = w.laws;
	const rel = Math.abs(got - want) / Math.max(1e-300, Math.abs(want), scale);
	L.checks++;
	if (rel > L.maxRel) L.maxRel = rel;
	if (rel > 1e-9) leak(w, L.breaches, `${what}: ${got} vs ${want}`);
}
export { lawCheck };

/** a MIND is liquid when one of its pools is live (every member has a reserve) */
function liquidity(w) {
	w.liquid.fill(0);
	for (const p of w.pools) if (p.live) for (const k of p.members) w.liquid[k] = 1;
}

// ── the people's goods ───────────────────────────────────────────────────────────────────────────────────────────
/** the sellers of each good, alive */
function sellersOf(w) {
	const s = Array.from({ length: G }, () => []);
	for (const co of w.coops) if (co.alive) s[co.good].push(co);
	return s;
}

/**
 * Clear the goods people buy (all but energy, which the dispatch clears): orders split by the logit on price, what a
 * seller cannot give goes to sellers with room. When a good runs short of all orders, the sellers share it by equal
 * caps (each Aven gets its whole order up to a cap that uses the supply): the first units, which are the basic need,
 * are served before anyone's extras. That is a sellers' rule, not a price control: the price is still free.
 */
function clearPeople(w) {
	const N = w.N;
	w.sellers = sellersOf(w);
	if (!w.supply || w.supply.length !== G * M) w.supply = new Float64Array(G * M);
	w.supply.fill(0);
	if (!w.sh || w.sh.length !== G * M) w.sh = new Float64Array(G * M);
	w.sh.fill(0);
	if (!w.gcap || w.gcap.length !== G) w.gcap = new Float64Array(G);
	w.gcap.fill(Infinity);
	if (!w.gfrac || w.gfrac.length !== G) w.gfrac = new Float64Array(G);
	w.gfrac.fill(1);
	for (const co of w.coops) {
		if (!co.alive) continue;
		const g = co.good, k = co.k;
		if (g === FOOD || g === GOODS_) w.supply[g * M + k] = Math.max(0, co.stock);
		else if (g === WATER) w.supply[g * M + k] = Math.max(0, co.stock) + wellToday(w, co);
		else if (ON_DEMAND.includes(g)) w.supply[g * M + k] = co.capDay;
	}
	// a seller of food or water offers people no more than its sustainable rate (./coops.js margins), but never less
	// than its share of the basic orders: in a lean season the basics are served first and the extras share the rest
	for (const g of [FOOD, WATER]) {
		let Tb = 0;
		for (let i = 0; i < N; i++) Tb += w.c.need[g] * w.fB[i];
		const T = w.peopleOrderTot[g];
		if (!(T > Tb)) continue;
		// a seller's basic part: its share of the basic orders, or all of them the other sellers cannot cover from
		// their stores today (a seller that runs dry passes its people's need to the one with food left)
		const raw = Float64Array.from(w.supply);
		let all = 0;
		for (const co of w.sellers[g]) all += raw[g * M + co.k];
		for (const co of w.sellers[g]) {
			const j = g * M + co.k;
			const basicPart = Math.max(Tb * w.shares[j], Tb - (all - raw[j])) * 1.02;
			if (co.sustain >= 0) w.supply[j] = Math.min(w.supply[j], Math.max(co.sustain, basicPart));
		}
	}
	for (const g of PEOPLE_GOODS) {
		const T = w.peopleOrderTot[g];
		const base = g * M;
		let S = 0;
		for (const co of w.sellers[g]) (S += w.supply[base + co.k]), (co.offeredToday = w.supply[base + co.k]);
		const got = new Float64Array(M);
		for (const co of w.sellers[g]) co.orders = T * w.shares[base + co.k];
		// the orders a seller with nothing to offer (a new COOP still building its first plant) passes on are counted as
		// the others' orders, so their forward margins and stores plan for the whole demand
		{
			let dead = 0, live = 0;
			for (const co of w.sellers[g]) if (w.supply[base + co.k] > 0) live += w.shares[base + co.k];
			else dead += co.orders;
			if (dead > 0 && live > 0) for (const co of w.sellers[g]) co.orders = w.supply[base + co.k] > 0 ? (T * w.shares[base + co.k]) / live : 0;
		}
		if (!(T > 0)) continue;
		if (T <= S) {
			let unmet = 0;
			for (const co of w.sellers[g]) {
				got[co.k] = Math.min(co.orders, w.supply[base + co.k]);
				unmet += co.orders - got[co.k];
			}
			for (let pass = 0; pass < 3 && unmet > 1e-12; pass++) {
				let room = 0;
				for (const co of w.sellers[g]) room += Math.max(0, w.supply[base + co.k] - got[co.k]);
				if (!(room > 1e-12)) break;
				const take = Math.min(unmet, room);
				for (const co of w.sellers[g]) {
					const r = Math.max(0, w.supply[base + co.k] - got[co.k]);
					if (r > 0) {
						const x = (take * r) / room;
						got[co.k] += x;
						unmet -= x;
					}
				}
			}
		} else {
			for (const co of w.sellers[g]) got[co.k] = w.supply[base + co.k];
			// a basic short: equal caps by default, so everyone's need comes before anyone's extras (a deviation from world
			// model 4.3 step 7, which shares in proportion to the orders: with proportional shares a person who orders
			// extras takes part of another's need; setting basicRation 'proportion' runs the world model's rule, B33);
			// an extra short: the sellers ration in proportion to the orders
			if (BASICS.includes(g) && w.cfg.basicRation !== 'proportion') w.gcap[g] = waterFill(w, g, S);
			else w.gfrac[g] = S / T;
		}
		let all = 0;
		for (const co of w.sellers[g]) all += got[co.k];
		if (all > 0) for (const co of w.sellers[g]) w.sh[base + co.k] = got[co.k] / all;
	}
	// what each person gets of these goods today (energy waits for the dispatch)
	for (let i = 0; i < N; i++) {
		const o = i * G;
		for (let g = 0; g < G; g++) w.q[o + g] = 0;
		for (const g of PEOPLE_GOODS) w.q[o + g] = Math.min(w.order[o + g], w.gcap[g]) * w.gfrac[g];
	}
}

/** the cap c with Σ min(order, c) = S */
function waterFill(w, g, S) {
	const N = w.N;
	const o = new Float64Array(N);
	for (let i = 0; i < N; i++) o[i] = Math.max(0, w.order[i * G + g]);
	o.sort();
	// walk up the sorted orders: with the first j orders served in full, the rest share what is left equally
	let below = 0;
	for (let j = 0; j < N; j++) {
		const c = (S - below) / (N - j);
		if (c <= o[j]) return Math.max(0, c);
		below += o[j];
	}
	return o[N - 1];
}

/** what the wells of a water COOP can pump today (L), bounded by the aquifer's recharge */
function wellToday(w, co) {
	let s = 0;
	const f = shockFactor(w, co);
	for (const pl of co.plants) if (pl.tech === 'well') s += plantCapDay(w, pl, w.day) * f;
	return s;
}

/** the effective price in R a person pays for a unit of each good today, by the sellers' shares */
function effPrices(w) {
	const pe = new Float64Array(G);
	for (const g of PEOPLE_GOODS) {
		let p = 0;
		for (const co of w.sellers[g]) p += w.sh[g * M + co.k] * co.price * w.P[co.k];
		pe[g] = p > 0 ? p : w.pbar[g];
	}
	pe[ENERGY] = w.pbar[ENERGY];
	return pe;
}

/**
 * No one gets what they cannot pay for: if a person's goods cost more than the Aven may spend (sellers' shares can
 * differ from the expected price), extras are cut first, then the basics in proportion.
 */
function affordPeople(w) {
	const N = w.N, need = w.c.need;
	const pe = (w.pEff = effPrices(w));
	for (let i = 0; i < N; i++) {
		const o = i * G;
		const fB = w.fB[i];
		let basicC = 0, extraC = 0;
		for (let b = 0; b < 4; b++) {
			const q = b === ENERGY ? w.basicEnergy[i] + w.extraEnergy[i] : w.q[o + b];
			const qb = b === ENERGY ? w.basicEnergy[i] : Math.min(q, need[b] * fB);
			basicC += qb * pe[b];
			extraC += (q - qb) * pe[b];
		}
		extraC += w.q[o + GOODS_] * pe[GOODS_] + w.q[o + SPRING] * pe[SPRING] + w.q[o + COMPUTE] * pe[COMPUTE];
		w.basicCost[i] = need[0] * pe[FOOD] + need[1] * pe[WATER] + need[2] * pe[ENERGY] + need[3] * pe[BED];
		let W = w.wealth[i];
		if (w.spendCap && w.spendCap[i] >= 0) W = Math.min(W, w.spendCap[i]);
		const room = W * 0.999;
		if (basicC + extraC <= room) continue;
		let fb = 1, fx = 0;
		if (basicC <= room) fx = extraC > 0 ? (room - basicC) / extraC : 0;
		else fb = basicC > 0 ? room / basicC : 0;
		for (let b = 0; b < 4; b++) {
			if (b === ENERGY) continue;
			const q = w.q[o + b];
			const qb = Math.min(q, need[b] * fB);
			w.q[o + b] = qb * fb + (q - qb) * fx;
		}
		w.basicEnergy[i] *= fb;
		w.extraEnergy[i] *= fx;
		w.q[o + GOODS_] *= fx;
		w.q[o + SPRING] *= fx;
		w.q[o + COMPUTE] *= fx;
	}
	// what each good's sellers deliver to people in all
	if (!w.D || w.D.length !== G) w.D = new Float64Array(G);
	w.D.fill(0);
	for (let i = 0; i < N; i++) for (const g of PEOPLE_GOODS) w.D[g] += w.q[i * G + g];
}

/** the energy the basics need: pumping water, the domes' climate and heat; and the spring's heat (running) */
function basicsLoads(w) {
	const t = w.today;
	for (const co of w.coops) {
		if (!co.alive) continue;
		const g = co.good, s = w.sh[g * M + co.k];
		if (!(s > 0)) continue;
		const x = w.D[g] * s;
		if (g === WATER) {
			const fromTank = Math.min(Math.max(0, co.stock), x);
			const rain = co.plants.find((p) => p.tech === 'rain'), well = co.plants.find((p) => p.tech === 'well');
			co.eReq[CLASS.basics] += fromTank * (rain ? kwhOf(w, rain) : 0) + (x - fromTank) * (well ? kwhOf(w, well) : 0);
		} else if (g === BED) {
			const home = co.plants.find((p) => p.tech === 'home');
			co.eReq[CLASS.basics] += x * kwhOf(w, home);
			co.heatReq += x * home.def.heat * YEAR_DAYS * t.heatShare * vcOf(home, 'heat');
		} else if (g === SPRING) {
			// an open warm pond loses this month's heat for each bather-hour it is open (./primitives.js spring)
			if (co.plants.some((p) => p.tech === 'spring')) co.heatRun += x * t.springHeat;
		} else if (g === COMPUTE) {
			// the accelerators run on electricity in the running class
			const pl = co.plants.find((p) => p.tech === 'compute');
			co.eReq[CLASS.running] += x * (pl ? kwhOf(w, pl) : 0);
		}
	}
}

/**
 * A COOP buys only what its treasury can pay for: energy for its basics always (a seller of basics keeps
 * delivering), then the energy for its works and upkeep, then materials, then its building project, then R&D.
 */
function affordCoops(w) {
	const cop = w.today.cop;
	// a COOP budgets its energy at the dearest energy seller's price today (what it pays depends on who delivers), so
	// what it draws it can always pay
	const pE = 1.1 * expectedEnergyPriceR(w);
	const pMat = Float64Array.from(w.pbar);
	for (const g of MATERIALS) for (const s of w.sellers[g]) pMat[g] = Math.max(pMat[g], s.price * w.P[s.k]);
	for (const co of w.coops) {
		co.own = 1;
		if (!co.alive) continue;
		// what it can pay with today: the MINDs its treasury holds that the pools can turn into a seller's MIND
		let budget = 0.9 * payableR(w, co.k);
		// the energy and heat of the basics it delivers come first: a COOP draws only what it can pay for; if its
		// treasury cannot pay for all of it, it delivers that much less today (and goes into receivership tonight)
		const billB = (co.eReq[CLASS.basics] + co.heatReq / cop + co.heatRun / cop) * pE;
		if (billB > budget) {
			const f = Math.max(0, budget / billB);
			co.own = f;
			co.eReq[CLASS.basics] *= f;
			co.heatReq *= f;
			co.heatRun *= f;
		}
		budget -= billB * co.own;
		// today's running items next (they are paid at the end of the day)
		let runH = 0;
		for (const pl of co.plants) runH += runHours(w, pl);
		budget -= runH * w.c.rateR;
		// (the border's export that replaces worn accelerators is upkeep: it is budgeted with the running energy)
		const run = (co.eReq[CLASS.running] + co.exportUp) * pE;
		const fr = run > 0 ? Math.max(0, Math.min(1, budget / run)) : 1;
		budget -= run * fr;
		if (fr < 1) {
			co.eReq[CLASS.running] *= fr;
			co.exportUp *= fr;
			for (const pl of co.plants) {
				pl.plan = (pl.plan ?? 0) * fr;
				pl.upkeepPlan = (pl.upkeepPlan ?? 0) * fr;
			}
		}
		// materials: the works' inputs and upkeep first, then the building project
		let matP = 0, matJ = 0;
		for (const g of MATERIALS) (matP += w.b2bProd[g * M + co.k] * pMat[g]), (matJ += w.b2bProj[g * M + co.k] * pMat[g]);
		const fp = matP > 0 ? Math.max(0, Math.min(1, budget / matP)) : 1;
		budget -= matP * fp;
		// a building project never takes the last month of running costs (a COOP that builds stays able to pay its
		// running items)
		budget -= 30 * co.costREma;
		const fj = matJ > 0 ? Math.max(0, Math.min(1, budget / matJ)) : 1;
		budget -= matJ * fj;
		for (const g of MATERIALS) {
			w.b2bRun[g * M + co.k] = w.b2bProd[g * M + co.k] * fp;
			w.b2b[g * M + co.k] = w.b2bRun[g * M + co.k] + w.b2bProj[g * M + co.k] * fj;
		}
		// (with the building project's energy, the border's export for the project's accelerators)
		const bld = (co.eReq[CLASS.building] + co.exportBuild) * pE;
		const fb = bld > 0 ? Math.max(0, Math.min(1, budget / bld)) : 1;
		co.eReq[CLASS.building] *= fb;
		co.exportBuild *= fb;
		budget -= bld * fb;
		const rd = co.eReq[CLASS.rd] * pE;
		const fd = rd > 0 ? Math.max(0, Math.min(1, budget / rd)) : 1;
		co.eReq[CLASS.rd] *= fd;
		budget -= rd * fd;
	}
}

/**
 * The price a COOP should expect to pay for a kWh today, in R: the energy sellers' prices weighted by what each will
 * deliver if all the electricity harvested today were sold (the buyers' logit shares, each seller capped by its harvest
 * and battery, the rest from the sellers with room, as ./energy.js splitSellers does). A seller with a high price and
 * little to give weighs little; one that has to fill in for a sold-out rival weighs what it fills.
 */
function expectedEnergyPriceR(w) {
	const sellers = w.sellers[ENERGY];
	let tot = 0;
	const avail = new Float64Array(M);
	for (const s of sellers) {
		avail[s.k] = (w.eAvail?.[s.k] ?? 0) + s.plants.reduce((a, p) => a + (p.batt ?? 0), 0);
		tot += avail[s.k];
	}
	if (!(tot > 0)) return w.pbar[ENERGY];
	const got = new Float64Array(M);
	let left = tot;
	for (const s of sellers) {
		const x = Math.min(avail[s.k], tot * w.shares[ENERGY * M + s.k]);
		got[s.k] = x;
		left -= x;
	}
	let room = 0;
	for (const s of sellers) room += Math.max(0, avail[s.k] - got[s.k]);
	if (left > 0 && room > 0) for (const s of sellers) got[s.k] += (Math.min(left, room) * Math.max(0, avail[s.k] - got[s.k])) / room;
	let pR = 0, sum = 0;
	for (const s of sellers) (pR += got[s.k] * s.price * w.P[s.k]), (sum += got[s.k]);
	return sum > 0 ? Math.max(w.pbar[ENERGY], pR / sum) : w.pbar[ENERGY];
}

/** what a treasury can pay with today, in R: the MINDs it holds that have a live pool (any seller's MIND can be reached
 * from them), at today's prices */
export function payableR(w, k) {
	let s = 0;
	const row = k * M;
	for (let j = 0; j < M; j++) if (w.tre[row + j] > 0 && w.liquid[j]) s += w.tre[row + j] * w.P[j];
	return s;
}

/** after the dispatch: water and beds need their basics energy, the spring its heat; people get their energy */
function deliver(w, fill) {
	const N = w.N, fr = fill[CLASS.running];
	const t = w.today;
	// the basics class in two parts (./energy.js dispatch): water pumping and people's basic power first, the domes'
	// climate and heat second; water is cut only when its pumping is, a bed-day only when the dome's climate is
	const fa = t.fillA, fb = t.fillB;
	// the spring's heat: condenser heat first, heat pumps (running class) for the rest
	const springHeat = w.coops.reduce((a, c) => a + (c.alive ? c.heatRun : 0), 0);
	const fs = springHeat > 0 ? Math.min(1, (t.heatFromGeo.running + (springHeat - t.heatFromGeo.running) * fr) / springHeat) : 1;
	w.fillSpring = fs;
	// a seller that could not pay for all of its basics energy or heat today (./engine.js affordCoops) delivers that
	// much less: each buyer's share from it is cut, and the shares are renormalized over what was delivered
	const ownF = {};
	for (const g of [WATER, BED, SPRING]) {
		let F = 0, cut = false;
		for (const co of w.sellers[g]) {
			const s = w.sh[g * M + co.k];
			F += s * (co.own ?? 1);
			if ((co.own ?? 1) < 1 && s > 0) cut = true;
		}
		if (!cut) continue;
		ownF[g] = F;
		for (const co of w.sellers[g]) w.sh[g * M + co.k] = F > 0 ? (w.sh[g * M + co.k] * (co.own ?? 1)) / F : 0;
	}
	for (let i = 0; i < N; i++) {
		const o = i * G;
		for (const g in ownF) w.q[o + Number(g)] *= ownF[g];
	}
	// food: the part of today's harvest a forest COOP cannot process (energy cut, or it could not pay for the energy)
	// is lost tonight (./coops.js produce), so it cannot be delivered either. Each seller delivers at most what its
	// store keeps; what one cannot deliver goes to sellers with food to spare, and only the rest is short
	{
		const sel = w.sellers[FOOD];
		let Df = 0;
		for (let i = 0; i < N; i++) Df += w.q[i * G + FOOD];
		if (Df > 0 && sel.length) {
			const cap = new Float64Array(M), got = new Float64Array(M);
			let unmet = 0, any = false;
			for (const co of sel) {
				const fo = fa * (co.own ?? 1);
				const lost = co.harvestToday > 0 && fo < 1 ? Math.min(Math.max(0, co.stock), co.harvestToday * (1 - fo)) : 0;
				cap[co.k] = Math.max(0, co.stock - lost);
				const want = w.sh[FOOD * M + co.k] * Df;
				got[co.k] = Math.min(want, cap[co.k]);
				if (got[co.k] < want - 1e-12) (unmet += want - got[co.k]), (any = true);
			}
			if (any) {
				let room = 0;
				for (const co of sel) room += cap[co.k] - got[co.k];
				if (room > 0) for (const co of sel) got[co.k] += (Math.min(unmet, room) * (cap[co.k] - got[co.k])) / room;
				let F = 0;
				for (const co of sel) F += got[co.k];
				for (const co of sel) w.sh[FOOD * M + co.k] = F > 0 ? got[co.k] / F : 0;
				if (F < Df) for (let i = 0; i < N; i++) w.q[i * G + FOOD] *= F / Df;
			}
		}
	}
	for (let i = 0; i < N; i++) {
		const o = i * G;
		if (fa < 1) w.q[o + WATER] *= fa;
		if (fb < 1) w.q[o + BED] *= fb;
		if (fs < 1) w.q[o + SPRING] *= fs;
		if (fr < 1) w.q[o + COMPUTE] *= fr;
		w.q[o + ENERGY] = w.basicEnergy[i] * fa + w.extraEnergy[i] * fr;
	}
	if (!w.D || w.D.length !== G) w.D = new Float64Array(G);
	w.D.fill(0);
	for (let i = 0; i < N; i++) for (const g of CONSUMER) w.D[g] += w.q[i * G + g];
	if (!w.eShare || w.eShare.length !== M) w.eShare = new Float64Array(M);
	w.eShare.fill(0);
	let es = 0;
	for (let k = 0; k < M; k++) es += w.eSold[k];
	if (es > 0) for (let k = 0; k < M; k++) w.eShare[k] = w.eSold[k] / es;
}

/** materials between COOPs: orders split by price, shortages shared in proportion to orders */
function clearMaterials(w) {
	if (!w.mGot || w.mGot.length !== G * M) w.mGot = new Float64Array(G * M);
	w.mGot.fill(0);
	if (!w.mSh || w.mSh.length !== G * M) w.mSh = new Float64Array(G * M);
	w.mSh.fill(0);
	if (!w.mShort || w.mShort.length !== G) w.mShort = new Uint8Array(G);
	w.mShort.fill(0);
	w.orderEma = w.orderEma ?? new Float64Array(G);
	for (const g of PEOPLE_GOODS) w.orderEma[g] += ((w.peopleOrderTot[g] ?? 0) - w.orderEma[g]) / 30;
	for (const g of MATERIALS) {
		const base = g * M;
		let T = 0;
		for (let k = 0; k < M; k++) T += w.b2b[base + k];
		w.orderEma[g] += (T - w.orderEma[g]) / 30;
		const sellers = w.sellers[g];
		for (const co of sellers) co.orders += T * w.shares[base + co.k];
		if (!(T > 0) || !sellers.length) continue;
		let S = 0;
		for (const co of sellers) (S += Math.max(0, co.stock)), (co.offeredToday = Math.max(0, co.stock));
		const sold = new Float64Array(M);
		if (T <= S) {
			let unmet = 0;
			for (const co of sellers) {
				sold[co.k] = Math.min(T * w.shares[base + co.k], Math.max(0, co.stock));
				unmet += T * w.shares[base + co.k] - sold[co.k];
			}
			for (let pass = 0; pass < 3 && unmet > 1e-12; pass++) {
				let room = 0;
				for (const co of sellers) room += Math.max(0, co.stock - sold[co.k]);
				if (!(room > 1e-12)) break;
				const take = Math.min(unmet, room);
				for (const co of sellers) {
					const r = Math.max(0, co.stock - sold[co.k]);
					if (r > 0) {
						const x = (take * r) / room;
						sold[co.k] += x;
						unmet -= x;
					}
				}
			}
		} else {
			for (const co of sellers) sold[co.k] = Math.max(0, co.stock);
			w.mShort[g] = 1;
		}
		let all = 0;
		for (const co of sellers) all += sold[co.k];
		if (!(all > 0)) continue;
		for (const co of sellers) {
			w.mSh[base + co.k] = sold[co.k] / all;
			co.stock -= sold[co.k];
			co.sold += sold[co.k];
		}
		// when short, the sellers serve the works' running inputs and upkeep first and building projects from the rest
		let Tr = 0;
		for (let k = 0; k < M; k++) Tr += w.b2bRun[base + k];
		const fr = Tr > 0 ? Math.min(1, all / Tr) : 1;
		const fj = T - Tr > 1e-12 ? Math.max(0, Math.min(1, (all - Tr * fr) / (T - Tr))) : 1;
		// the price a buyer pays a unit today (the sellers' posted prices by what each sold); each input store keeps the
		// average price its units were bought at, so what upkeep uses from it is costed at what was paid
		let pg = 0;
		for (const co of sellers) pg += w.mSh[base + co.k] * co.priceR;
		for (let k = 0; k < M; k++) {
			const run = w.b2bRun[base + k];
			const x = run * fr + (w.b2b[base + k] - run) * fj;
			if (x > 0) {
				w.mGot[base + k] = x;
				const b = w.coops[k];
				const had = Math.max(0, b.inStock[g]);
				b.inCostR = b.inCostR ?? Float64Array.from(w.pbar);
				b.inCostR[g] = (b.inCostR[g] * had + pg * x) / (had + x);
				b.inStock[g] += x;
			}
		}
	}
}

// ── payment ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Everyone pays for what they got, at each seller's posted price: with the seller's own MIND first, the rest with
 * the MINDs they hold, which the pools turn into the seller's MIND. Then Law 5. A COOP buying from itself moves its
 * own goods and pays nothing (that is no sale).
 */
function settle(w, fill) {
	const N = w.N, P = w.P, t = w.today, cop = t.cop, p0g = w.c.p0g;
	openPayments(w);
	const dec = 1 / 30;
	// people: each Aven pays with the MIND it values least, the one that pays it the least Law 5 dividend for each R it
	// holds (a seller's own MIND counts a little cheaper, since paying with it saves the pool fees); the pools turn
	// what is not the seller's own MIND into it
	// the order changes slowly (a month's dividends): it is worked out again on the slow loop's days
	if (!w.payOrderCache || w.payOrderDay !== w.lastSlow) (w.payOrderCache = payOrder(w)), (w.payOrderDay = w.lastSlow);
	const order = w.payOrderCache;
	const owe = new Float64Array(M);
	// each MIND's room in the pools today: what can be sold into them moving its price about 5 % (a twentieth of the
	// value of its reserves, yesterday's prices); Avens pay with their cheapest MIND within that room, then the next
	const room = new Float64Array(M), sold = new Float64Array(M);
	for (const p of w.pools) if (p.live) for (let i = 0; i < p.members.length; i++) room[p.members[i]] += 0.05 * p.x[i] * P[p.members[i]];
	let peopleR = 0;
	// what a unit of each good costs today from each seller, in its MIND and in R, by the sellers' shares
	const unit = [];
	for (const g of CONSUMER) {
		const list = [];
		for (const co of w.sellers[g]) {
			const s = g === ENERGY ? w.eShare[co.k] : w.sh[g * M + co.k];
			if (s > 0) list.push(co.k, s * co.price, s * co.price * P[co.k], s * p0g[g] * dec);
		}
		if (list.length) unit.push(g, list);
	}
	const mix = w.spendMix, qq = w.q;
	for (let i = 0; i < N; i++) {
		const row = i * M, o = i * G;
		let spentR = 0;
		owe.fill(0);
		for (let u = 0; u < unit.length; u += 2) {
			const q = qq[o + unit[u]];
			if (!(q > 0)) continue;
			const list = unit[u + 1];
			for (let j = 0; j < list.length; j += 4) {
				const k = list[j];
				spentR += q * list[j + 2];
				owe[k] += q * list[j + 1];
				mix[row + k] += q * list[j + 3];
			}
		}
		if (spentR > 0) {
			let left = spentR, swapR = 0;
			// first pass: within each MIND's room in the pools today; second pass (rare): whatever is left
			for (let pass = 0; pass < 2 && left > 1e-15; pass++)
				for (const j of order) {
					if (!(left > 1e-15)) break;
					const h = w.hold[row + j];
					if (!(h > 0) || !(P[j] > 0)) continue;
					if (!w.liquid[j] && !(owe[j] > 0)) continue;
					const direct = Math.min(h, owe[j] > 0 ? owe[j] : 0);
					let maxUse = w.liquid[j] ? h : direct;
					if (pass === 0 && w.liquid[j]) maxUse = Math.min(h, direct + Math.max(0, room[j] - sold[j]) / P[j]);
					if (!(maxUse > 0)) continue;
					const R = Math.min(maxUse * P[j], left);
					let x = R / P[j];
					if (x > h) x = h;
					w.hold[row + j] -= x;
					left -= R;
					const d = Math.min(x, owe[j]);
					if (d > 0) {
						w.recv[j] += d;
						owe[j] -= d;
						x -= d;
					}
					if (x > 0) {
						w.swapIn[j] += x;
						swapR += x * P[j];
						sold[j] += x * P[j];
					}
				}
			for (let k = 0; k < M; k++) if (owe[k] > 0) w.due[k] += owe[k];
			if (swapR > 0) w.payers.push([w.hold, row, swapR]);
			if (left > spentR * 1e-9) w.unpaidR += left;
		}
		w.spent[i] = spentR;
		peopleR += spentR;
		if (w.spendCap && w.spendCap[i] >= 0) w.spendCap[i] = Math.max(0, w.spendCap[i] - spentR);
	}
	t.salesPeopleR = peopleR;
	// COOPs: energy (electricity by the sellers' shares, geothermal heat from the geothermal COOP), materials
	const hb = t.heatFromGeo.basics, hr = t.heatFromGeo.running;
	let heatB = 0, heatR = 0, heatSum = 0;
	for (const co of w.coops) if (co.alive) (heatB += co.heatReq), (heatR += co.heatRun);
	for (let k = 0; k < M; k++) heatSum += w.heatAvail[k];
	let b2bR = 0;
	if (!w.eCoop || w.eCoop.length !== M) w.eCoop = new Float64Array(M);
	w.eCoop.fill(0);
	for (const co of w.coops) {
		if (!co.alive) continue;
		const row = co.k * M;
		let restR = 0, costR = 0;
		// electricity: its classes as served, and the heat pumps for the heat geothermal did not cover
		// (the basics class in its two parts: the domes' climate and the heat pumps second, the rest first)
		let kwh = co.eReq[CLASS.basics] * (co.good === BED ? t.fillB : t.fillA);
		for (let cl = 1; cl < 4; cl++) kwh += co.eReq[cl] * fill[cl];
		kwh += co.exportUp * t.fillExportUp + co.exportBuild * t.fillExportBuild;
		const geoB = heatB > 0 ? (co.heatReq / heatB) * hb : 0;
		const geoR = heatR > 0 ? (co.heatRun / heatR) * hr : 0;
		kwh += ((co.heatReq - geoB) / cop) * t.fillB + ((co.heatRun - geoR) / cop) * fill[CLASS.running];
		w.eCoop[co.k] = kwh;
		const rdKwh = co.eReq[CLASS.rd] * fill[CLASS.rd];
		let rdR = 0;
		for (const s of w.sellers[ENERGY]) {
			const share = w.eShare[s.k];
			if (!(share > 0) || s.k === co.k) continue;
			const count = kwh * share * s.price;
			costR += count * P[s.k];
			rdR += rdKwh * share * s.price * P[s.k];
			restR += payDirect(w, w.tre, row, s.k, count) * P[s.k];
		}
		// geothermal heat, sold at the price of the electricity a heat pump would need for it
		const heat = geoB + geoR;
		if (heat > 0 && heatSum > 0)
			for (const s of w.sellers[ENERGY]) {
				const share = w.heatAvail[s.k] / heatSum;
				if (!(share > 0) || s.k === co.k) continue;
				const count = ((heat * share) / cop) * s.price;
				costR += count * P[s.k];
				restR += payDirect(w, w.tre, row, s.k, count) * P[s.k];
			}
		co.rdBudgetR = Math.max(0, co.rdBudgetR - rdR);
		// materials
		for (const g of MATERIALS) {
			const x = w.mGot[g * M + co.k];
			if (!(x > 0)) continue;
			for (const s of w.sellers[g]) {
				const share = w.mSh[g * M + s.k];
				if (!(share > 0) || s.k === co.k) continue;
				const count = x * share * s.price;
				costR += count * P[s.k];
				b2bR += count * P[s.k];
				restR += payDirect(w, w.tre, row, s.k, count) * P[s.k];
			}
		}
		if (restR > 0) {
			const paid = payRest(w, w.tre, row, restR, co.k);
			if (paid < restR * (1 - 1e-9)) {
				w.unpaidR += restR - paid;
				co.unpaidBillR = restR - paid;
				// every unpaid bill is kept by COOP, for the proof (a rule breach: every delivery is paid)
				w.unpaidBy = w.unpaidBy ?? {};
				w.unpaidBy[co.id] = (w.unpaidBy[co.id] ?? 0) + restR - paid;
			}
		}
		co.costR += costR;
	}
	t.salesB2BR = b2bR;
	settleSwaps(w);
	// Law 5 pays holders and the seller's own treasury only: the pools must be untouched by it
	let pools0 = 0;
	for (const p of w.pools) for (let i = 0; i < p.x.length; i++) pools0 += p.x[i];
	law5(w);
	let pools1 = 0;
	for (const p of w.pools) for (let i = 0; i < p.x.length; i++) pools1 += p.x[i];
	lawCheck(w, 'Law 5: pools untouched', pools1, pools0, 1);
	t.unroutedR = w.unroutedR;
	// a payment no pool could route went back to its payer: the seller was not paid for that delivery
	if (w.unroutedR > 0) {
		w.unpaidR += w.unroutedR;
		w.unpaidBy = w.unpaidBy ?? {};
		w.unpaidBy['(no route)'] = (w.unpaidBy['(no route)'] ?? 0) + w.unroutedR;
	}
	// owner-only in the strict test: today's dividends are what they may spend tomorrow
	if (w.spendCap) for (const i of w.ownerIds) w.spendCap[i] += w.div[i];
	// goods leave the sellers' stores
	for (const g of PEOPLE_GOODS) {
		const D = w.D[g];
		t.eaten[g] += D;
		for (const co of w.sellers[g]) {
			const x = D * w.sh[g * M + co.k];
			if (!(x > 0)) continue;
			co.sold += x;
			if (g === FOOD || g === GOODS_) co.stock -= x;
			else if (g === WATER) {
				const fromTank = Math.min(Math.max(0, co.stock), x);
				co.stock -= fromTank;
				t.made[WATER] += x - fromTank;
				co.made += x - fromTank;
			} else {
				t.made[g] += x;
				co.made += x;
			}
		}
	}
	// energy sellers
	t.eaten[ENERGY] += w.D[ENERGY];
	// (a seller with nothing to sell, a new COOP still building, passes its share of the orders on to the others)
	let liveShare = 0;
	for (const s of w.sellers[ENERGY]) if (s.supplyToday > 0) liveShare += w.shares[ENERGY * M + s.k];
	for (const s of w.sellers[ENERGY]) {
		s.sold = w.eSold[s.k];
		s.made = w.eSold[s.k];
		s.orders = liveShare > 0 ? (s.supplyToday > 0 ? (w.energyAsked * w.shares[ENERGY * M + s.k]) / liveShare : 0) : w.energyAsked * w.shares[ENERGY * M + s.k];
		s.offeredToday = s.supplyToday;
	}
}

/**
 * Every MIND in the order an Aven spends it: lowest Law 5 yield first (dividends paid over the last month for each R
 * held by people and other treasuries). A seller's own MIND counts a little cheaper (paying with it saves two pool
 * fees, spread over a month), so a person who holds it pays the seller directly unless it is a much better holding.
 */
function payOrder(w) {
	const N = w.N, P = w.P;
	const H = new Float64Array(M);
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) H[k] += w.hold[i * M + k];
	for (let j = 0; j < M; j++) for (let k = 0; k < M; k++) if (j !== k) H[k] += w.tre[j * M + k];
	const y = new Float64Array(M);
	const isSeller = new Uint8Array(M);
	for (const g of CONSUMER) for (const co of w.sellers[g]) isSeller[co.k] = 1;
	const ks = [];
	for (let k = 0; k < M; k++) {
		const co = w.coops[k];
		if (!co || !(P[k] > 0)) continue;
		const v = H[k] * P[k];
		y[k] = v > 0 ? (co.divEma ?? 0) / v : 0;
		if (isSeller[k]) y[k] -= (2 * (1 - GAMMA_)) / 30;
		ks.push(k);
	}
	w.yieldDay = y;
	return ks.sort((a, b) => y[a] - y[b] || a - b);
}
const GAMMA_ = 0.997;

// ── the binding limit of each good ───────────────────────────────────────────────────────────────────────────────
/** why people did not get more of each good today (world model 5.6) */
function badges(w, fill) {
	const N = w.N, need = w.c.need;
	for (let g = 0; g < G; g++) {
		let short = false;
		if (g < 4) for (let i = 0; i < N && !short; i++) if (w.q[i * G + g] < 0.98 * need[g]) short = true;
		const soldOut = PEOPLE_GOODS.includes(g) ? isFinite(w.gcap[g]) || w.gfrac[g] < 1 : g === ENERGY ? fill[CLASS.running] < 1 || fill[CLASS.basics] < 1 : !!w.mShort[g];
		// the energy a basic needs: water its pumping and a person's basic power (the first part of the basics class),
		// a bed its dome's climate and heat (the second part)
		const t = w.today;
		const energyCut = ((g === WATER || g === ENERGY) && t.fillA < 0.999) || (g === BED && t.fillB < 0.999);
		if (g < 4) w.badge[g] = !short ? LIMIT.none : energyCut ? LIMIT.energy : soldOut || !w.sellers[g].length ? physicalLimit(w, g) : LIMIT.mind;
		// how often people have lately been short of each basic (a 30-day average): ./coops.js lets the builds of a basic
		// people go short of skip the payback test
		if (g < 4) w.peopleShortEma[g] += ((short ? 1 : 0) - w.peopleShortEma[g]) / 30;
		else w.badge[g] = soldOut ? physicalLimit(w, g) : w.mindBound && w.mindBound[g] > 0 ? LIMIT.mind : LIMIT.demand;
	}
}

/**
 * The reason the biggest seller of a good could not give more: an institution (plants of the good stand idle with the
 * City COOP, or there is no seller; free land and no project while it is short), or physics.
 */
function physicalLimit(w, g) {
	const city = w.coops[w.cityK];
	// plants of the good stand idle with the City COOP: no COOP took them (no MIND slot was free, or none yet)
	if ((city?.idle ?? []).some((pl) => pl.def.good === g && pl.cap - pl.worn > 0)) return w.coops.length >= M ? LIMIT.noSlot : LIMIT.noSeller;
	let best = null, bs = -1;
	for (const co of w.sellers[g]) if (w.supply[g * M + co.k] > bs) (bs = w.supply[g * M + co.k]), (best = co);
	if (!best) return LIMIT.noSeller;
	// food the sellers could not buy at the border today: no euros in their accounts or the founding reserve
	if (g === FOOD && (w.today.impShort ?? 0) > 1e-9) return LIMIT.euros;
	if (best.limiter && best.limiter !== LIMIT.none) return best.limiter;
	// Aven services whose worn halls wait for accelerators while the dispatch cuts the export that replaces them (the
	// city's own basics, running and building took the electricity): energy
	if (g === COMPUTE && w.sellers[g].some((co) => co.exportUp > 0 && (co.exUpFillEma ?? 1) < 0.9)) return LIMIT.energy;
	const pl = best.plants[0];
	if (!pl) return LIMIT.capacity;
	// built capacity binds, and what stops the sellers building more is physics (land, a deposit, energy, accelerators,
	// nature) or an institution (a treasury that cannot carry the build): that is the limit to read. Aven services sold
	// out with no accelerators to install read 'accelerators'; with them but no electricity for them, 'energy'
	const why = w.sellers[g].map((co) => co.buildLimit).find((x) => PHYSICAL.includes(x) || x === LIMIT.treasury);
	if (why) return why;
	if (g === COMPUTE && !(best.chips > 0) && w.cfg.chipImport === false) return LIMIT.chips;
	// built capacity binds, yet no seller of the good is building and land is free: nobody chose to build
	const building = w.sellers[g].some((co) => co.project);
	const landTech = pl.def.land > 0 && pl.tech !== 'spring' && pl.tech !== 'geo' && pl.tech !== 'well' && pl.tech !== 'rain';
	// (free land counts only when it is at least the smallest plot the technology builds on: a scrap of land too small
	// for a timber plot leaves wood bound by land, not by a choice)
	const notBuilt = !building && landTech && freeLand(w) >= Math.max(1000 * w.c.scale, firstPlotM2(w, pl.tech)) && best.buildLimit !== LIMIT.land;
	switch (pl.tech) {
		case 'forest':
			return pl.plots.some((p) => w.day - p.born < 3650) ? LIMIT.ramp : notBuilt ? LIMIT.notBuilt : LIMIT.nature;
		case 'solar':
			return notBuilt ? LIMIT.notBuilt : LIMIT.nature;
		case 'rain':
		case 'spring':
			return LIMIT.nature;
		case 'well':
			return pl.cap * 1000 >= w.c.rechargeL - 1 ? LIMIT.water : LIMIT.capacity;
		default:
			for (const [x, a] of inputsOf(w, pl)) if (typeof x === 'number' && best.inStock[x] < a) return LIMIT.wood + MATERIALS.indexOf(x);
			return notBuilt ? LIMIT.notBuilt : LIMIT.capacity;
	}
}

// ── the slow loop ────────────────────────────────────────────────────────────────────────────────────────────────
function slowLoop(w) {
	const dt = w.lastSlow < 0 ? 1 : w.day - w.lastSlow;
	w.lastSlow = w.day;
	arbitrage(w);
	payRent(w, dt);
	// the COOPs pay their euro advances back to the City COOP's bank in their own MIND (./border.js)
	if (w.border) w.today.repaidR = (w.today.repaidR ?? 0) + repayAdvances(w, dt);
	if (w.day % 7 === 0) adjustRent(w);
	payout(w, 1 - pow(1 - w.cfg.payoutRate, dt / 7));
	if (w.day % 7 === 0) learn(w);
	buildDecisions(w);
	// the spending mix forgets at 1/30 a day (applied here, for the days since the last slow loop)
	const keep = pow(1 - 1 / 30, dt);
	for (let j = 0; j < w.N * M; j++) w.spendMix[j] *= keep;
	updateAlloc(w, dt);
	rebalance(w, dt);
}

/**
 * Avens leave bad COOPs (world model §3: "collects dividends, and leaves bad COOPs"): a MIND whose Law 5 dividend
 * yield is under half the average yield of what people hold is sold, 2 % of every holding of it a week, through the
 * pools into the MINDs that yield at least the average (in proportion to their pools' depth); each Aven sells the same
 * share and gets the same mix back. A sale never takes more than a twentieth of the MIND's pool reserve a day, so a
 * thin pool is not crashed.
 */
function rebalance(w, dt) {
	const N = w.N, P = w.P;
	const H = new Float64Array(M), Hp = new Float64Array(M), room = new Float64Array(M);
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) if (w.hold[i * M + k] > 0) Hp[k] += w.hold[i * M + k];
	for (let k = 0; k < M; k++) H[k] = Hp[k];
	for (let j = 0; j < M; j++) for (let k = 0; k < M; k++) if (j !== k && w.tre[j * M + k] > 0) H[k] += w.tre[j * M + k];
	for (const p of w.pools) if (p.live) for (let i = 0; i < p.members.length; i++) room[p.members[i]] += 0.05 * dt * p.x[i] * P[p.members[i]];
	const y = new Float64Array(M);
	let ys = 0, vs = 0;
	for (const co of w.coops) {
		const k = co.k;
		if (!co.alive || !w.liquid[k] || !(H[k] > 0) || !(P[k] > 0)) continue;
		y[k] = (co.divEma ?? 0) / (H[k] * P[k]);
		ys += y[k] * Hp[k] * P[k];
		vs += Hp[k] * P[k];
	}
	if (!(vs > 0)) return;
	const ybar = ys / vs;
	const rate = 1 - pow(0.98, dt / 7);
	const sellF = new Float64Array(M), tgt = [];
	let roomT = 0;
	for (const co of w.coops) {
		const k = co.k;
		if (!co.alive || !w.liquid[k] || !(Hp[k] > 0)) continue;
		if (y[k] < 0.5 * ybar) sellF[k] = Math.min(rate, room[k] / (Hp[k] * P[k]));
		else if (y[k] >= ybar && room[k] > 0) tgt.push(k), (roomT += room[k]);
	}
	if (!tgt.length) return;
	const out = new Float64Array(M * M), back = new Float64Array(M);
	let soldR = 0;
	for (let j = 0; j < M; j++) {
		if (!(sellF[j] > 0)) continue;
		const A = sellF[j] * Hp[j];
		soldR += A * P[j];
		for (const k of tgt) {
			const r = swap(w, j, k, (A * room[k]) / roomT);
			out[j * M + k] += r.out;
			back[j] += r.back;
		}
	}
	for (let i = 0; i < N; i++) {
		const b = i * M;
		for (let j = 0; j < M; j++) {
			const f = sellF[j];
			if (!(f > 0)) continue;
			const h = w.hold[b + j];
			if (!(h > 0)) continue;
			const s = f * h, share = s / (f * Hp[j]);
			w.hold[b + j] -= s;
			w.hold[b + j] += back[j] * share;
			for (const k of tgt) w.hold[b + k] += out[j * M + k] * share;
		}
	}
	w.today.rebalR = soldR;
}

/**
 * Ground rent: every COOP pays the City COOP for its plots, in MIND the pools turn into CITYmind. A lease is not a
 * sale of goods: no Law 5 dividend is paid on it (there is no rent payout to people). Under the private-land rule the
 * rent goes to the landowners instead, in the payer's own MIND.
 */
function payRent(w, dt) {
	const due = rentDue(w);
	if (!due.length) return;
	const P = w.P, t = w.today, city = w.cityK;
	if (w.cfg.landRule === 'private') {
		for (const [co, R7] of due) {
			const R = (R7 * dt) / 7;
			const count = Math.min(w.tre[co.k * M + co.k], R / P[co.k]);
			if (!(count > 0)) continue;
			w.tre[co.k * M + co.k] -= count;
			let given = 0;
			for (let i = 0; i < w.N; i++) {
				const x = count * w.landOwn[i];
				w.hold[i * M + co.k] += x;
				given += x;
			}
			w.tre[co.k * M + co.k] += count - given;
			co.costR += count * P[co.k];
			t.rentR += count * P[co.k];
		}
		return;
	}
	openPayments(w);
	for (const [co, R7] of due) {
		const R = Math.min((R7 * dt) / 7, 0.5 * treasuryR(w, co.k));
		if (!(R > 0)) continue;
		const rest = payDirect(w, w.tre, co.k * M, city, R / P[city]);
		if (rest > 0) payRest(w, w.tre, co.k * M, rest * P[city], co.k);
		co.costR += R;
		t.rentR += R;
	}
	settleSwaps(w);
	w.tre[city * M + city] += w.recv[city];
	w.recv[city] = 0;
}

/**
 * Where the HEARTS go (the Avens' rule, world model 4.3 step 15). Half of a person's HEARTS follow what the person
 * buys (so the Aven can pay each seller in its own MIND, the bootstrap habit); the other half follow what the economy
 * gets (each good's share of all delivered output, to people and to COOPs, over the last month, at base-year prices)
 * and, between the sellers of a good,
 * the replicator of Eq. 8 on delivered output per HEART (audited meters, at base-year prices): a seller that delivers
 * more for each HEART invested in it draws a growing share. Founders put all their HEARTS into their new COOP for its
 * first 90 days (in invest). Moves at a limited speed.
 */
function updateAlloc(w, dt) {
	const p0 = w.c.p0g, N = w.N;
	// each good's share of all sales
	const gs = new Float64Array(G);
	let tot = 0;
	for (const co of w.coops) if (co.alive) (gs[co.good] += Math.max(0, co.salesShareR)), (tot += Math.max(0, co.salesShareR));
	if (!(tot > 0)) return;
	// the replicator between the sellers of each good
	const f = new Float64Array(M);
	const fbar = new Float64Array(G), rs = new Float64Array(G);
	for (const co of w.coops) {
		if (!co.alive) continue;
		// 'output' (default): delivered output per HEART; 'price': what a HEART's MIND is worth in the pools (the TWAP)
		f[co.k] = w.cfg.allocBy === 'price' ? Math.max(1e-12, w.Ptw[co.k]) : (co.soldEma * p0[co.good] + 1e-12) / Math.max(co.heartsEma, 1e-3 * N);
		fbar[co.good] += w.repl[co.k] * f[co.k];
		rs[co.good] += w.repl[co.k];
	}
	for (let g = 0; g < G; g++) fbar[g] = rs[g] > 0 ? fbar[g] / rs[g] : 1;
	const within = new Float64Array(G);
	for (let k = 0; k < M; k++) {
		const co = w.coops[k];
		if (!co || !co.alive) {
			w.repl[k] = 0;
			continue;
		}
		const g = Math.max(-1, Math.min(1, log(Math.max(1e-12, f[k]) / Math.max(1e-12, fbar[co.good]))));
		w.repl[k] = Math.max(0.02, w.repl[k] * exp((0.5 * dt * g) / 7));
		within[co.good] += w.repl[k];
	}
	const target = new Float64Array(M);
	for (let k = 0; k < M; k++) {
		const co = w.coops[k];
		if (!co || !co.alive || !(within[co.good] > 0)) continue;
		target[k] = (gs[co.good] / tot) * (w.repl[k] / within[co.good]);
	}
	const mu = 1 - pow(0.85, dt / 7);
	for (let i = 0; i < N; i++) {
		const b = i * M;
		let ss = 0;
		for (let k = 0; k < M; k++) if (w.coops[k]?.alive) ss += w.spendMix[b + k];
		let sum = 0;
		for (let k = 0; k < M; k++) {
			if (!w.coops[k]?.alive) {
				w.alloc[b + k] = 0;
				continue;
			}
			const tg = ss > 0 ? 0.5 * (w.spendMix[b + k] / ss) + 0.5 * target[k] : target[k];
			w.alloc[b + k] = (1 - mu) * w.alloc[b + k] + mu * tg;
			sum += w.alloc[b + k];
		}
		if (sum > 0) for (let k = 0; k < M; k++) w.alloc[b + k] /= sum;
	}
}

/** deciles by holdings (monthly) and by Aven output */
function deciles(w) {
	const N = w.N;
	const idx = Array.from({ length: N }, (_, i) => i);
	idx.sort((a, b) => w.wealth[a] - w.wealth[b] || a - b);
	idx.forEach((i, r) => (w.decH[i] = Math.min(9, Math.floor((r * 10) / N))));
	const ida = Array.from({ length: N }, (_, i) => i);
	ida.sort((a, b) => w.aven[a] - w.aven[b] || a - b);
	ida.forEach((i, r) => (w.decA[i] = Math.min(9, Math.floor((r * 10) / N))));
}

function endOfDay(w) {
	// each person's dividends (a 30-day average), inflow (the HEARTS half, dividends, Aven pay; a cfg.inflowDays
	// average) and HEARTS half (a 90-day average)
	const inflowDays = w.cfg.inflowDays ?? 365;
	for (let i = 0; i < w.N; i++) {
		w.divEma[i] += (w.div[i] - w.divEma[i]) / 30;
		w.inflowEma[i] += (w.heartsR[i] + w.div[i] + w.income[i] - w.inflowEma[i]) / inflowDays;
		w.heartsEma[i] += (w.heartsR[i] - w.heartsEma[i]) / 90;
	}
	w.Pslow = w.Pslow ?? Float64Array.from(w.P);
	for (let k = 0; k < M; k++) w.Pslow[k] += (w.P[k] - w.Pslow[k]) / 90;
	// the slow price of each good (a year's average) follows the prices it actually traded at today, weighted by what
	// was sold: a price quoted by sellers who sold nothing (an empty works asking a fortune) moves nothing. Plants are
	// valued at it (./coops.js costs), so a good nobody trades cannot inflate the capital cost of what is made of it
	w.pbarSlow = w.pbarSlow ?? Float64Array.from(w.pbar);
	const soldU = new Float64Array(G), soldR = new Float64Array(G);
	for (const co of w.coops) if (co.alive && co.sold > 0 && co.priceR > 0) (soldU[co.good] += co.sold), (soldR[co.good] += co.sold * co.priceR);
	for (let g = 0; g < G; g++) if (soldU[g] > 0) w.pbarSlow[g] += (soldR[g] / soldU[g] - w.pbarSlow[g]) / 365;
	for (const co of w.coops) {
		if (!co.alive) continue;
		co.costREma += (co.costR - co.costREma) / 30;
		// what rebuilding its worn plant cost today, at the prices its input store was bought at (a 90-day average)
		co.upkeepREma = (co.upkeepREma ?? 0) + ((co.upkeepRToday ?? 0) - (co.upkeepREma ?? 0)) / 90;
		co.upkeepRToday = 0;
		co.heartsEma += (co.heartsToday - co.heartsEma) / 30;
		co.salesREma += (co.salesR - co.salesREma) / 30;
		co.soldEma += (co.sold - co.soldEma) * EMA_DEMAND;
		co.madeEma += (co.made - co.madeEma) * EMA_DEMAND;
		co.demandEma += (co.orders - co.demandEma) * EMA_DEMAND;
		const tr = treasuryR(w, co.k);
		// a COOP that could not pay for all the energy and materials it needed today (it made and delivered only what
		// it paid for: co.own < 1) or left a bill unpaid. Nobody delivers to it unpaid; it simply makes less that day
		co.billFail = (co.own ?? 1) < 1 - 1e-9 || co.unpaidBillR > 0;
		// insolvent today: it could not pay all its running items, its bills or its inputs. 30 such days in a row
		// and it goes into receivership (./coops.js receiverships)
		co.lowDays = co.unpaidH > 1e-9 || co.unpaidBillR > 1e-9 * Math.max(1, co.costREma) || co.billFail ? co.lowDays + 1 : 0;
		// what it delivered today at base-year prices (to people and to other COOPs): the real output the Avens'
		// replicator reads (audited meters), not its sales in R, which move with every price
		co.salesShareR += (co.sold * w.c.p0g[co.good] - co.salesShareR) / 30;
		co.divEma = (co.divEma ?? 0) + (co.divR - (co.divEma ?? 0)) / 30;
		co.idleDays = co.sold <= 0 && co.heartsToday <= 0 ? co.idleDays + 1 : 0;
		// the audit: days in a row its output stood under a quarter of what its plants are rated for
		co.auditLow = co.ratedDay > 0 && co.capDay < 0.25 * co.ratedDay ? (co.auditLow ?? 0) + 1 : 0;
		// how much of its plant the COOP used today: what its works made, what its forest let be picked, what it sold of
		// energy, water, beds and spring time; running items follow it (./coops.js runHours)
		let u;
		if (co.good === ENERGY) u = w.eAvail[co.k] > 0 ? w.eSold[co.k] / w.eAvail[co.k] : 0;
		else if (co.good === FOOD || MATERIALS.includes(co.good) || co.good === GOODS_) u = co.capDay > 0 ? co.made / co.capDay : 0;
		else u = co.capDay > 0 ? co.sold / co.capDay : 0;
		u = Math.max(0, Math.min(1, u));
		for (const pl of co.plants) pl.utilEma = (pl.utilEma ?? u) + (u - (pl.utilEma ?? u)) / 7;
		// learning by doing for what is sold as it is made (beds, spring time, Aven services), in R&D weeks only, as
		// for the works (./coops.js produce)
		if (ON_DEMAND.includes(co.good) && co.sold > 0 && co.capDay > 0)
			for (const pl of co.plants) if (w.learn[pl.tech]?.rdOn) w.learn[pl.tech].Q += (co.sold * plantCapDay(w, pl, w.day)) / co.capDay;
	}
}

// ── the two ledgers ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The money ledger: each MIND counted exactly, wherever it is (people, treasuries, pools). Today's count must be
 * yesterday's plus what HEARTS created minus what melted, and nothing else. The matter-energy ledger: each good's
 * stores move only by what was made, eaten, used as an input, built in, or rotted; electricity harvested equals what
 * was used, stored and curtailed, and what buyers paid for equals what was dispatched to them.
 */
function checkLedgers(w) {
	const L = w.ledger, N = w.N, t = w.today;
	const tot = new Float64Array(M); // kept as tomorrow's L.prev: a fresh array
	for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) tot[k] += w.hold[i * M + k];
	for (let j = 0; j < M; j++) for (let k = 0; k < M; k++) tot[k] += w.tre[j * M + k];
	for (const p of w.pools) for (let i = 0; i < p.x.length; i++) tot[p.members[i]] += p.x[i];
	for (let k = 0; k < M; k++) tot[k] += w.poolQueue[k];
	for (let k = 0; k < M; k++) {
		const expect = L.prev[k] + L.created[k] - L.melted[k];
		const diff = tot[k] - expect;
		const scale = Math.max(1, Math.abs(tot[k]), L.created[k]);
		const rel = Math.abs(diff) / scale;
		if (rel > L.maxRel) L.maxRel = rel;
		if (rel > 1e-9 || !isFinite(tot[k]) || tot[k] < -1e-9 * scale) leak(w, L.leaks, `MIND ${w.coops[k]?.id ?? k}: count ${tot[k]} vs ${expect} (diff ${diff})`);
	}
	L.prev = tot;
	L.checks++;
	// matter
	const now = stockTotals(w), prev = w.matter.prevStock;
	for (let g = 0; g < G; g++) {
		if (g === ENERGY) continue;
		const expect = prev[g] + t.made[g] + t.imported[g] - t.eaten[g] - t.input[g] - t.built[g] - t.rotted[g];
		const diff = now[g] - expect;
		const scale = Math.max(1, Math.abs(now[g]), t.made[g], t.eaten[g]);
		const rel = Math.abs(diff) / scale;
		if (rel > w.matter.maxRel) w.matter.maxRel = rel;
		if (rel > 1e-7) leak(w, w.matter.leaks, `${GOOD_IDS[g]}: store ${now[g]} vs ${expect} (diff ${diff})`);
	}
	w.matter.prevStock = now;
	// no store may go below zero: a negative store is stock taken from nowhere
	for (const co of w.coops) {
		if (co.stock < -1e-9 && !ON_DEMAND.includes(co.good) && co.good !== ENERGY) leak(w, w.matter.leaks, `${co.id}: store below zero (${co.stock})`);
		for (let g = 0; g < G; g++) if (co.inStock[g] < -1e-9) leak(w, w.matter.leaks, `${co.id}: input store of ${GOOD_IDS[g]} below zero (${co.inStock[g]})`);
	}
	for (let g = 0; g < G; g++) if (w.cityStore[g] < -1e-9) leak(w, w.matter.leaks, `City COOP store of ${GOOD_IDS[g]} below zero (${w.cityStore[g]})`);
	const raw = rawTotal(w), rprev = w.matter.prevRaw;
	const sum = (o) => Object.values(o).reduce((a, x) => a + x, 0);
	const rexp = rprev + sum(t.raw.grown) + sum(t.raw.imported) - sum(t.raw.used) - sum(t.raw.lost);
	if (Math.abs(raw - rexp) > 1e-7 * Math.max(1, raw)) leak(w, w.matter.leaks, `raw logs/scrap/float glass/cells: ${raw} vs ${rexp}`);
	w.matter.prevRaw = raw;
	// accelerators: they come in only through the border, and leave only into a plant
	let chips = w.cityChips ?? 0;
	for (const co of w.coops) chips += co.chips ?? 0;
	const cexp = (w.matter.prevChips ?? chips) + (t.chipsIn ?? 0) - (t.chipsUsed ?? 0);
	if (Math.abs(chips - cexp) > 1e-7 * Math.max(1, chips)) leak(w, w.matter.leaks, `accelerators: ${chips} vs ${cexp}`);
	if (chips < -1e-9) leak(w, w.matter.leaks, `accelerators below zero: ${chips}`);
	w.matter.prevChips = chips;
	// the euro reserve (paper §11.4): it moves only by what the line's export earned and what the COOPs bought at the
	// border; it is held by COOPs only (the founding euros left over, and each COOP's account; no person holds euros)
	// and never becomes MIND
	const B = w.border;
	let eur = B.shared;
	for (let k = 0; k < M; k++) eur += B.eur[k];
	const eexp = B.prev + (t.eurIn ?? 0) - (t.eurOut ?? 0);
	if (Math.abs(eur - eexp) > 1e-7 * Math.max(1, Math.abs(eur)) || (!B.open && eur < -1e-6)) leak(w, w.matter.leaks, `euro reserve: ${eur} vs ${eexp}`);
	// the bank's cumulative balance against its founding euros: its lowest is what the village needed at once
	if (eur - B.shared0 < B.low) (B.low = eur - B.shared0), (B.lowDay = w.day);
	if (Math.abs((t.eurIn ?? 0) - (t.exportKwh ?? 0) * (t.eurPerKwh ?? w.c.eurPerKwh)) > 1e-7 * Math.max(1, t.eurIn ?? 0)) leak(w, w.matter.leaks, `euro reserve: earned ${t.eurIn ?? 0} for ${t.exportKwh ?? 0} kWh exported`);
	B.prev = eur;
	B.inEur += t.eurIn ?? 0;
	B.outEur += t.eurOut ?? 0;
	// energy
	const h = t.harvest;
	const supply = h.solar + h.geo + h.battery;
	let used = t.exportKwh ?? 0;
	for (let cl = 0; cl < 4; cl++) used += t.use[cl];
	const out = used + t.use[CLASS.storage] + t.curtailed;
	let paidFor = w.D[ENERGY];
	for (let k = 0; k < M; k++) paidFor += w.eCoop[k];
	const EL = w.energyLedger;
	const r1 = Math.abs(supply - out) / Math.max(1, supply);
	const r2 = Math.abs(paidFor - used) / Math.max(1, used);
	EL.maxRel = Math.max(EL.maxRel, r1, r2);
	if (r1 > 1e-7) leak(w, EL.leaks, `electricity: harvest ${supply} vs used+stored+curtailed ${out}`);
	if (r2 > 1e-6) leak(w, EL.leaks, `electricity: delivered to buyers ${paidFor} vs dispatched ${used}`);
	const heatIn = h.geoHeat + h.lowHeat, heatOut = t.heatUse + t.heatVented;
	if (Math.abs(heatIn - heatOut) > 1e-7 * Math.max(1, heatIn)) leak(w, EL.leaks, `heat: ${heatIn} vs ${heatOut}`);
	// the ORC's heat balance: the heat it drew = gross electricity + condenser heat + losses
	const orcOut = h.geoGross + h.lowHeat + h.geoLossKwh;
	if (Math.abs(h.geoQin - orcOut) > 1e-7 * Math.max(1, h.geoQin)) leak(w, EL.leaks, `ORC heat: in ${h.geoQin} vs out ${orcOut}`);
	if (h.geoGross > 0 && h.geoGross / h.geoQin > w.c.exergyLimit) leak(w, EL.leaks, `ORC efficiency ${h.geoGross / h.geoQin} above the exergy limit`);
}

function leak(w, list, msg) {
	const e = { day: w.day, msg };
	if (list.length < 100) list.push(e);
	if (!w.cfg.testMode) throw new Error(`ledger leak on day ${w.day}: ${msg}`);
}

/** every store of each good: sellers' stores, input stores, and what the City COOP holds of failed COOPs */
function stockTotals(w) {
	const s = new Float64Array(G);
	for (const co of w.coops) {
		if (!ON_DEMAND.includes(co.good) && co.good !== ENERGY) s[co.good] += co.stock;
		for (let g = 0; g < G; g++) s[g] += co.inStock[g];
	}
	for (let g = 0; g < G; g++) s[g] += w.cityStore[g];
	return s;
}
function rawTotal(w) {
	let s = 0;
	for (const co of w.coops) for (const pl of co.plants) s += pl.raw;
	for (const pl of w.coops[w.cityK].idle ?? []) s += pl.raw;
	return s;
}

// ── getters for the page ─────────────────────────────────────────────────────────────────────────────────────────
/** the calendar of the day just run */
export function getDay(w) {
	const t = w.today, d = Math.max(0, w.day - 1);
	return { day: d, year: Math.floor(d / YEAR_DAYS) + 1, dayOfYear: d % YEAR_DAYS, month: MONTH_NAMES[t.month], season: t.season, sun: t.sun, rain: t.rain, heat: t.heatShare * YEAR_DAYS, shocks: t.shocks.slice(), people: w.N };
}

/** every person: holdings, deciles, owner-only, Aven output, shares met, limit bars against expected prices */
export function getPeople(w) {
	const out = [], need = w.c.need;
	for (let i = 0; i < w.N; i++) {
		const o = i * G;
		out.push({
			id: i,
			holdingR: w.wealth[i],
			decile: w.decH[i],
			avenDecile: w.decA[i],
			ownerOnly: !!w.owner[i],
			aven: w.aven[i],
			met: w.met[i],
			share: BASICS.map((b) => w.q[o + b] / need[b]),
			limitR: [0, 1, 2, 3].map((b) => w.limit[i * 4 + b]),
			expectedR: BASICS.map((b) => (w.pEff ? w.pEff[b] : w.pbar[b])),
			spentR: w.spent[i],
			dividendsR: w.div[i],
			incomeR: w.income[i],
			living: w.L[i],
			got: Array.from(w.q.subarray(o, o + G))
		});
	}
	return out;
}

/** every COOP: good, treasury, price, cost floor, capacity, output, alive, plot */
export function getCoops(w) {
	return w.coops.map((co) => ({
		id: co.id,
		k: co.k,
		good: GOOD_IDS[co.good],
		city: co.city,
		alive: co.alive,
		born: co.born,
		died: co.died,
		why: co.why,
		treasuryR: treasuryR(w, co.k),
		reserveR: co.reserveR ?? 0,
		priceR: co.price * w.P[co.k],
		price: co.price,
		mindR: w.P[co.k],
		floorR: co.floorR,
		fullR: co.fullR,
		capacity: co.capDay,
		made: co.made,
		sold: co.sold,
		stock: co.stock,
		margin: co.margin,
		plotM2: co.plants.reduce((a, p) => a + p.landM2, 0),
		limit: LIMIT_NAMES[co.limiter ?? 0],
		buildLimit: co.buildLimit != null ? LIMIT_NAMES[co.buildLimit] : null,
		project: co.project ? { tech: co.project.tech, units: co.project.units, since: co.project.start } : null,
		plants: co.plants.map((p) => ({ tech: p.tech, cap: p.cap, worn: p.worn, landM2: p.landM2 }))
	}));
}

/** the day's money flows, in R */
export function getFlows(w) {
	const t = w.today;
	return {
		heartsToMindR: t.investR,
		salesToPeopleR: t.salesPeopleR,
		salesBetweenCoopsR: t.salesB2BR,
		law5ToPeopleR: t.divPeopleR,
		law5ToTreasuriesR: t.divTreR,
		runningItemsR: t.runningR,
		workProposalsR: t.proposalsR,
		rdR: t.rdR,
		groundRentR: t.rentR,
		meltR: t.meltR,
		poolFeesR: t.routeFeeR,
		routedR: t.routedR,
		arbitrageR: t.arbR,
		basicBundleR: t.basicCostR,
		landRentR: w.land.rent
	};
}

/** the day's energy: harvest by source, use by class, storage, curtailment, heat */
export function getEnergy(w) {
	const t = w.today, h = t.harvest;
	return {
		harvest: { solar: h.solar, geothermal: h.geo, battery: h.battery },
		use: Object.fromEntries(CLASS_NAMES.map((n, cl) => [n, t.use[cl]])),
		unserved: Object.fromEntries(CLASS_NAMES.map((n, cl) => [n, t.unserved[cl]])),
		// what the line exported for accelerators (paper §11.4): not the city's use, not surplus
		exported: t.exportKwh ?? 0,
		curtailed: t.curtailed,
		batteryIn: t.battIn,
		batteryLoss: t.battLoss,
		heat: { geothermal: h.geoHeat + h.lowHeat, used: t.heatUse, vented: t.heatVented, heatPumpKwh: t.heatPumpKwh },
		surplus: t.surplusKwh,
		priceR: t.energyPriceR,
		perPerson: w.D ? w.D[ENERGY] / w.N : 0
	};
}

/** both ledgers */
export function getLedger(w) {
	return {
		checks: w.ledger.checks,
		mindMaxRel: w.ledger.maxRel,
		mindLeaks: w.ledger.leaks.slice(),
		matterMaxRel: w.matter.maxRel,
		matterLeaks: w.matter.leaks.slice(),
		energyMaxRel: w.energyLedger.maxRel,
		energyLeaks: w.energyLedger.leaks.slice(),
		unpaidR: w.unpaidR,
		lawChecks: w.laws.checks,
		lawMaxRel: w.laws.maxRel,
		lawBreaches: w.laws.breaches.slice(),
		poolMissed: w.laws.poolMissed,
		coopLowDays: w.coopLowDays,
		meltIndex: w.meltIndex
	};
}

/** each good's binding limit today (world model 5.6) and its physics ceiling, a person a day */
export function getLimits(w) {
	const ceil = physicsCeiling(w), c = w.c;
	return GOODS.map((gd, g) => ({
		good: gd.id,
		code: w.badge[g],
		limit: LIMIT_NAMES[w.badge[g]],
		ceilingPerPerson: ceil[g],
		needPerPerson: g < 4 ? c.need[g] : 0,
		satiation: g === BED ? 1 : c.sat[g] ?? 0,
		mindBoundPeople: w.mindBound ? w.mindBound[g] : 0,
		priceR: w.pbar[g]
	}));
}

/** the goods, for labels */
export const GOOD_LIST = GOODS.map((g, i) => ({ ...g, index: i }));

/**
 * Every parameter a world runs with (the World tab and the proof's parameter sets): its settings (the defaults merged
 * with the run's own, plus the village's derived keys), the plain constants it was built from (w.c, without the
 * village's facts), the defaults (to mark what the run changed), and the village's facts read from Sandbox 6's design
 * as catalog records ({ v, u, src, est }).
 */
export function paramSet(w) {
	const cfg = { ...DEFAULTS, ...w.cfg };
	const V = w.c.village;
	const settings = { ...cfg, livingHexes: V.livingHexes, peoplePerHex: cfg.people / V.livingHexes, tower: V.tower, beds: Math.round(V.beds.total * w.c.vf) };
	const catalog = {};
	for (const [k, v] of Object.entries(w.c)) {
		if (k === 'village' || k === 'p0base') continue;
		catalog[k] = ArrayBuffer.isView(v) ? Array.from(v) : v;
	}
	return { settings, catalog, defaults: { ...DEFAULTS }, village: villageRecords(V) };
}

/** every catalog record (./primitives.js and ./food.js) as [path, record], for the World tab and the proof */
export function catalogAll() {
	const out = catalogList();
	for (const [grp, o] of Object.entries({ OUTDOOR, INDOOR })) for (const [k, r] of Object.entries(o)) out.push([`FOOD_YIELDS.${grp}.${k}`, r]);
	return out;
}
