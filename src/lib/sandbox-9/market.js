// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE MARKET — prices, what people's Avens order, who sells it, and how it is paid.
 *
 * Prices are fully dynamic: each COOP posts a price in its own MIND every morning, by one of three rules (world model
 * 4.4). There is no cap and no protected price; the only floor is the seller's own reservation price, its variable
 * cost ÷ (1 − Law 5 share), because its treasury keeps only the rest of each sale.
 *
 * Buyers choose between the sellers of a good by a logit on price (intensity β, as an elasticity of 6 in the e2e
 * simulation). A seller that runs out rations in proportion to the orders and what it could not give goes to the
 * others with room. Payment: a buyer pays with the seller's own MIND first (the bootstrap makes Avens hold it); the
 * rest comes from the MIND it holds, swapped through the pools, and the seller receives only its own MIND. Then Law 5:
 * a fifth of every sale goes at once, in the seller's MIND, to everyone who holds that MIND (people and other COOPs'
 * treasuries; never the seller's own treasury, never the pools); the other four fifths go to the seller's treasury.
 */
import { exp, log, pow } from './dmath.js';
import { BASICS, BED, COMPUTE, CONSUMER, ENERGY, EXTRAS, FOOD, G, GOODS_, IN_HAND, MAX_COOPS, NX, SPRING, WATER, LIMIT } from './consts.js';
import { GOODS } from './primitives.js';
import { rnd } from './rng.js';
import { swap } from './pools.js';

const M = MAX_COOPS;
const EXTRA_GOODS = EXTRAS;

// ── prices ───────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Post every COOP's price for today, by the world's price rule. A COOP thinks in R (it reads its MIND's pool price,
 * the TWAP) and posts the price in its own MIND: R price ÷ its MIND's price. Then the buyers' shares and expected
 * prices.
 */
export function postPrices(w) {
	const rule = w.cfg.priceRule;
	const avg = avgPriceR(w);
	for (const co of w.coops) {
		if (!co.alive) continue;
		const P = w.P[co.k] > 0 ? w.P[co.k] : 1;
		const now = co.priceR ?? co.price * P;
		co.lastPrice = now;
		const floor = co.floorR;
		const H = GOODS[co.good].horizon;
		const m = co.margin;
		const others = avg.n[co.good] > 1 ? (avg.sum[co.good] - now) / (avg.n[co.good] - 1) : now;
		let p = now;
		if (w.day > 0 && !(co.capDay > 0) && !(co.stock > 0)) {
			// a COOP still building its first plant has nothing to sell: it quotes the others' price
			p = avg.n[co.good] > 1 ? others : now;
		} else if (w.day > 0) {
			if (rule === 'mark0') {
				// Mark-0: up by a random step when short and below the others' price, down when in glut and above it
				const step = 0.05 * rnd(w);
				if (m < 1 && (now < others || avg.n[co.good] < 2)) p *= 1 + step;
				else if (m > 1 && (now > others || avg.n[co.good] < 2)) p *= 1 - step;
			} else if (rule === 'primer') {
				// Primer's adaptive price: a little more after a day it sold out, a little less after a day with some
				// left. "Yesterday" is what the seller wrote down at the end of yesterday (soldOutY, orderedY: see
				// sellerOutcome), because today's sales have not happened yet when the morning's price is posted
				if (co.soldOutY && co.orderedY) p *= 1.03;
				else p *= 0.97;
			} else {
				// forward margin (world model 4.4): price = reference × (1 ÷ margin), β = 1. The reference starts at
				// full cost and follows it slowly (over 60 days). It is a level, not a running total of past gaps (the
				// Sandbox 7 flow price lags, overshoots and sticks). There is no bound on the level: a store that is
				// nearly empty asks a very high price (the margin is only kept above 1e-9, so an empty store asks a
				// finite one); the square-root step below limits only how fast the price moves toward it. Mark-0's
				// guard keeps a seller from outrunning the others' average.
				const lm = w.cfg._clamp ? Math.max(-2.0794415416798357, Math.min(2.0794415416798357, log(Math.max(1e-9, m)))) : log(Math.max(1e-9, m));
				if (co.fullR > 0) co.ref *= exp(log(co.fullR / co.ref) / 60);
				let target = co.ref * exp(-lm);
				if (avg.n[co.good] > 1) {
					if (m >= 1 && target > others && target > now) target = Math.max(now, others);
					if (m < 1 && target < others && target < now) target = Math.min(now, others);
				}
				p = now * pow(target / now, 0.5);
			}
		}
		if (!(p > 0) || !isFinite(p)) p = now;
		co.priceR = Math.max(p, floor);
		co.price = co.priceR / P;
	}
	computeShares(w);
}

/**
 * At the end of each day every seller writes down how the day went, for Primer's adaptive price tomorrow: whether it
 * sold all it offered (soldOutY) and whether anyone ordered from it (orderedY). What it offered: its store (food,
 * goods, materials), its store and wells (water), its capacity (beds, spring time, Aven services) or its harvest
 * (energy).
 */
export function sellerOutcome(w) {
	for (const co of w.coops) {
		if (!co.alive) continue;
		const offered = co.offeredToday ?? 0;
		co.soldOutY = offered > 0 ? co.sold >= 0.999 * offered : co.orders > 0;
		co.orderedY = co.orders > 0;
	}
}

/** sum and count of sellers' R prices by good */
function avgPriceR(w) {
	const sum = new Float64Array(G), n = new Float64Array(G);
	for (const co of w.coops) if (co.alive) (sum[co.good] += co.priceR ?? co.price * w.P[co.k]), n[co.good]++;
	return { sum, n };
}

/**
 * The buyers' logit shares between the sellers of each good, and the expected price in R (what a buyer expects to
 * pay for a unit, share-weighted). Shares lean to the cheaper seller: (p ÷ p_min)^−β.
 */
export function computeShares(w) {
	if (!w.shares || w.shares.length !== G * M) w.shares = new Float64Array(G * M);
	else w.shares.fill(0);
	w.pbar = w.pbar ?? new Float64Array(G);
	const beta = w.cfg.logitBeta;
	for (let g = 0; g < G; g++) {
		let lo = Infinity;
		for (const co of w.coops) if (co.alive && co.good === g) lo = Math.min(lo, co.price * w.P[co.k]);
		if (!isFinite(lo)) continue;
		let sum = 0;
		for (const co of w.coops) if (co.alive && co.good === g) (w.shares[g * M + co.k] = pow((co.price * w.P[co.k]) / lo, -beta)), (sum += w.shares[g * M + co.k]);
		let pb = 0;
		for (const co of w.coops)
			if (co.alive && co.good === g) {
				w.shares[g * M + co.k] /= sum;
				pb += w.shares[g * M + co.k] * co.price * w.P[co.k];
			}
		w.pbar[g] = pb;
	}
}

// ── what people order ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Each Aven orders for its person: the basic bundle first (all of it while the holding pays for it), then extras
 * from a budget of a share of what it holds above a buffer of basics (Stone–Geary with satiation). Also writes each
 * person's limit for each basic: the most a unit could cost today with the person still living from what they hold
 * for a month and today's dividends, drawn on the page as a bar beside the expected price.
 */
export function peopleOrders(w) {
	const N = w.N, c = w.c, cfg = w.cfg, pbar = w.pbar, P = w.P;
	const liquid = w.liquid;
	const need = c.need;
	const Cb = need[0] * pbar[FOOD] + need[1] * pbar[WATER] + need[2] * pbar[ENERGY] + need[3] * pbar[BED];
	w.today.basicCostR = Cb;
	const tot = new Float64Array(G);
	const extraEnergy = (w.extraEnergy = w.extraEnergy && w.extraEnergy.length === w.Nmax ? w.extraEnergy : new Float64Array(w.Nmax));
	const basicEnergy = (w.basicEnergy = w.basicEnergy && w.basicEnergy.length === w.Nmax ? w.basicEnergy : new Float64Array(w.Nmax));
	const capX = new Float64Array(NX), q = new Float64Array(NX), free = new Uint8Array(NX);
	// the Aven's taste for extras is CES between them (σ = extrasSigma): a dear extra loses budget to cheaper ones
	const sigma = cfg.extrasSigma ?? 3;
	const relW = new Float64Array(NX);
	for (let x = 0; x < NX; x++) {
		const g = EXTRA_GOODS[x];
		const rel = pbar[g] > 0 ? pbar[g] / c.p0g[g] / (cfg.heartsPerDay / 24) : 1;
		relW[x] = pow(rel, 1 - sigma);
	}
	const fBarr = (w.fB = w.fB && w.fB.length === w.Nmax ? w.fB : new Float64Array(w.Nmax));
	// how many people MIND holds below what they would take of each good (the basics: below need; an extra: below
	// satiation with the budget spent)
	const bound = (w.mindBound = new Float64Array(G));
	const cap = w.spendCap;
	// the Aven values what it holds at slow prices (each MIND's pool price over about 90 days) when it decides what to
	// spend, so a pool's daily noise does not swing its person's life
	const Ps = w.Pslow ?? P;
	let hs = 0;
	for (let i = 0; i < N; i++) hs += w.wealthSlow[i];
	w.meanHold = hs / Math.max(1, N);
	const meltDay = 1 - exp(-cfg.melt / 365);
	for (let i = 0; i < N; i++) {
		const b = i * M;
		let W = 0, Ws = 0;
		for (const k of w.ks) {
			const h = w.hold[b + k];
			if (h > 0 && liquid[k]) (W += h * P[k]), (Ws += h * Ps[k]);
		}
		w.wealth[i] = W;
		w.wealthSlow[i] = Ws;
		// what the Aven may spend: all it holds, or (strict owner-only test) only the dividends not yet spent
		if (cap && cap[i] >= 0) W = Math.min(W, cap[i]);
		w.pb[i] = Cb;
		const o = i * G;
		for (let g = 0; g < G; g++) w.order[o + g] = 0;
		const fB = Cb > 0 ? Math.min(1, W / (Cb * 1.0001)) : 1;
		fBarr[i] = fB;
		if (fB < 1) for (const g of BASICS) bound[g]++;
		w.order[o + FOOD] = need[0] * fB;
		w.order[o + WATER] = need[1] * fB;
		w.order[o + ENERGY] = need[2] * fB;
		w.order[o + BED] = need[3] * fB;
		basicEnergy[i] = need[2] * fB;
		// limits (R a unit): a 30th of the holding a day plus today's dividends, less the other basics
		const room = W / 30 + w.divEma[i];
		w.limit[i * 4 + 0] = (room - (Cb - need[0] * pbar[FOOD])) / need[0];
		w.limit[i * 4 + 1] = (room - (Cb - need[1] * pbar[WATER])) / need[1];
		w.limit[i * 4 + 2] = (room - (Cb - need[2] * pbar[ENERGY])) / need[2];
		w.limit[i * 4 + 3] = (room - (Cb - need[3] * pbar[BED])) / need[3];
		// extras (Stone–Geary over food, water, energy, goods, spring time and Aven services, each up to its
		// satiation): the Aven keeps a share (cfg.keep) of its person's HEARTS half and a share (cfg.keepOther) of the
		// rest of what flows in (dividends, Aven pay) as ownership, and spends the rest of what flows in (averages over
		// cfg.inflowDays) above the basics; what it holds above the resting level of what it keeps (kept ÷ melt) it also
		// spends, a share (cfg.spendRate) a day. Keeping a share of every inflow makes holdings follow what a person
		// earns, and Law 5 pays pro rata: ownership is how people live
		const kept = cfg.keep * w.heartsEma[i] + (cfg.keepOther ?? 0) * Math.max(0, w.inflowEma[i] - w.heartsEma[i]);
		const rest = kept / meltDay;
		const Wv = Math.min(W, Ws);
		let E = Math.min(W - Cb, w.inflowEma[i] - kept - Cb + cfg.spendRate * Math.max(0, Wv - rest));
		if (!(E > 0)) E = 0;
		extraEnergy[i] = 0;
		if (E > 0) {
			capX[0] = c.sat[FOOD] - need[0];
			capX[1] = c.sat[WATER] - need[1];
			capX[2] = c.sat[ENERGY] - need[2];
			capX[3] = c.sat[GOODS_];
			capX[4] = c.sat[SPRING];
			capX[5] = c.sat[COMPUTE];
			for (let x = 0; x < NX; x++) (q[x] = 0), (free[x] = pbar[EXTRA_GOODS[x]] > 0 ? 1 : 0);
			for (let pass = 0; pass < 5 && E > 1e-12; pass++) {
				let ts = 0;
				for (let x = 0; x < NX; x++) if (free[x]) ts += w.taste[i * NX + x] * relW[x];
				if (!(ts > 0)) break;
				let spent = 0, capped = false;
				for (let x = 0; x < NX; x++) {
					if (!free[x]) continue;
					const p = pbar[EXTRA_GOODS[x]];
					const want = ((w.taste[i * NX + x] * relW[x]) / ts * E) / p;
					const room2 = capX[x] - q[x];
					if (want >= room2) {
						q[x] += room2;
						spent += room2 * p;
						free[x] = 0;
						capped = true;
					} else {
						q[x] += want;
						spent += want * p;
					}
				}
				E -= spent;
				if (!capped) break;
			}
			for (let x = 0; x < NX; x++) if (free[x] && q[x] < capX[x] * 0.999) bound[EXTRA_GOODS[x]]++;
			w.order[o + FOOD] += q[0];
			w.order[o + WATER] += q[1];
			w.order[o + ENERGY] += q[2];
			w.order[o + GOODS_] += q[3];
			w.order[o + SPRING] += q[4];
			w.order[o + COMPUTE] += q[5];
			extraEnergy[i] = q[2];
		}
		for (const g of CONSUMER) tot[g] += w.order[o + g];
	}
	w.peopleOrderTot = tot;
}

// ── clearing ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Clear good g: orders split by the logit shares; a seller with too little rations in proportion to its orders and
 * what it could not give goes to the sellers with room. Writes w.del[g·M + k]: what one unit ordered of g gets from
 * seller k. `supply[k]` is what seller k can give today.
 */
export function clearGood(w, g, orderTot, supply) {
	const base = g * M;
	const ord = new Float64Array(M), got = new Float64Array(M);
	for (let k = 0; k < M; k++) w.del[base + k] = 0;
	if (!(orderTot > 0)) {
		for (const co of w.coops) if (co.alive && co.good === g) co.orders = 0;
		return 0;
	}
	let unmet = 0;
	for (const co of w.coops) {
		if (!co.alive || co.good !== g) continue;
		ord[co.k] = orderTot * w.shares[base + co.k];
		got[co.k] = Math.min(ord[co.k], Math.max(0, supply[co.k]));
		unmet += ord[co.k] - got[co.k];
		co.orders = ord[co.k];
	}
	for (let pass = 0; pass < 2 && unmet > 1e-12; pass++) {
		let room = 0;
		for (const co of w.coops) if (co.alive && co.good === g) room += Math.max(0, supply[co.k] - got[co.k]);
		if (!(room > 1e-12)) break;
		const take = Math.min(unmet, room);
		for (const co of w.coops) {
			if (!co.alive || co.good !== g) continue;
			const r = Math.max(0, supply[co.k] - got[co.k]);
			if (r > 0) {
				const x = (take * r) / room;
				got[co.k] += x;
				co.orders += x;
				unmet -= x;
			}
		}
	}
	let all = 0;
	for (let k = 0; k < M; k++) (w.del[base + k] = got[k] / orderTot), (all += got[k]);
	return all / orderTot;
}

// ── payments ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** start the day's payments */
export function openPayments(w) {
	w.recv = new Float64Array(M);
	w.swapIn = new Float64Array(M);
	w.due = new Float64Array(M);
	w.dueR = 0;
	w.payers = [];
	w.unroutedR = 0;
}

/**
 * A payer (row `row` of the array `arr`: a person's wallet or a treasury) pays `amt` of seller k's MIND. It uses the
 * seller's own MIND first; returns the rest still owed (in seller-MIND count), for `payRest`.
 */
export function payDirect(w, arr, row, k, amt) {
	if (!(amt > 0)) return 0;
	const have = arr[row + k];
	const use = have > 0 ? Math.min(have, amt) : 0;
	if (use > 0) {
		arr[row + k] -= use;
		w.recv[k] += use;
	}
	const rest = amt - use;
	if (rest > 0) w.due[k] += rest;
	return rest;
}

/**
 * The rest a payer owes, in R, is taken from everything liquid it holds in proportion (it pays with the MINDs it
 * holds, which the pools convert). `skip` is a MIND the payer must not sell (a treasury keeps its own MIND for last).
 */
export function payRest(w, arr, row, restR, ownLast = -1) {
	if (!(restR > 0)) return 0;
	const P = w.P;
	let have = 0;
	for (let k = 0; k < M; k++) if (k !== ownLast && arr[row + k] > 0 && w.liquid[k]) have += arr[row + k] * P[k];
	let f = have > 0 ? Math.min(1, restR / have) : 0;
	let paid = 0;
	if (f > 0)
		for (let k = 0; k < M; k++) {
			if (k === ownLast || !(arr[row + k] > 0) || !w.liquid[k]) continue;
			const x = arr[row + k] * f;
			arr[row + k] -= x;
			w.swapIn[k] += x;
			paid += x * P[k];
		}
	if (paid < restR * (1 - 1e-12) && ownLast >= 0 && arr[row + ownLast] > 0) {
		const x = Math.min(arr[row + ownLast], (restR - paid) / P[ownLast]);
		arr[row + ownLast] -= x;
		w.swapIn[ownLast] += x;
		paid += x * P[ownLast];
	}
	w.payers.push([arr, row, paid]);
	w.dueR += restR;
	return paid;
}

/**
 * The batch: everything paid in other MINDs is swapped through the pools into the sellers' MINDs, in proportion to
 * what each seller is owed, and each seller receives the output (its own MIND only). Fees and slippage stay in the
 * pools. A MIND that finds no live route goes back to the payers who gave it.
 */
export function settleSwaps(w) {
	const P = w.P;
	let dueR = 0;
	for (let k = 0; k < M; k++) dueR += w.due[k] * P[k];
	if (!(dueR > 0)) return;
	const back = new Float64Array(M);
	for (let j = 0; j < M; j++) {
		const inj = w.swapIn[j];
		if (!(inj > 0)) continue;
		for (let k = 0; k < M; k++) {
			if (!(w.due[k] > 0)) continue;
			const flow = (inj * w.due[k] * P[k]) / dueR;
			if (j === k) {
				w.recv[k] += flow;
				continue;
			}
			const r = swap(w, j, k, flow);
			w.recv[k] += r.out;
			back[j] += r.back;
		}
	}
	// what found no route goes back, pro rata to what each payer gave of that MIND (rare: only a MIND with no live pool)
	let anyBack = false;
	for (let j = 0; j < M; j++) if (back[j] > 0) anyBack = true;
	if (anyBack) {
		let backR = 0;
		for (let j = 0; j < M; j++) backR += back[j] * P[j];
		w.unroutedR += backR;
		const totIn = Float64Array.from(w.swapIn);
		// payers' shares of each MIND are proportional to what they paid in R, as payRest takes MINDs pro rata
		let paidAll = 0;
		for (const [, , paid] of w.payers) paidAll += paid;
		for (const [arr, row, paid] of w.payers) for (let j = 0; j < M; j++) if (back[j] > 0 && totIn[j] > 0) arr[row + j] += (back[j] * paid) / paidAll;
	}
}

/**
 * Law 5, "every sale pays its owners": of what each seller received today, its Law 5 share goes at once to the
 * holders of its MIND (people and other COOPs' treasuries), the rest to its own treasury. Dividends to people are
 * written to w.div (R) for the Proposition 3 records.
 */
export function law5(w) {
	const N = w.N, P = w.P, lam = w.cfg.law5, t = w.today;
	for (let k = 0; k < M; k++) {
		const R = w.recv[k];
		if (!(R > 0)) continue;
		const co = w.coops[k];
		let div = lam * R;
		let H = 0;
		for (let i = 0; i < N; i++) {
			const h = w.hold[i * M + k];
			if (h > 0) H += h;
		}
		for (let j = 0; j < M; j++) {
			if (j === k) continue;
			const h = w.tre[j * M + k];
			if (h > 0) H += h;
		}
		if (!(H > 0)) div = 0;
		if (div > 0) {
			const f = div / H;
			let toPeople = 0;
			for (let i = 0; i < N; i++) {
				const h = w.hold[i * M + k];
				if (h > 0) {
					const d = h * f;
					w.hold[i * M + k] += d;
					w.div[i] += d * P[k];
					toPeople += d;
				}
			}
			let toTre = 0;
			for (let j = 0; j < M; j++) {
				if (j === k) continue;
				const h = w.tre[j * M + k];
				if (h > 0) {
					w.tre[j * M + k] += h * f;
					toTre += h * f;
				}
			}
			// rounding: whatever the two sums miss stays with the seller's treasury, so the count is exact
			const paid = toPeople + toTre;
			// the law, checked: the holders got λ of the sale (to rounding) and the seller's own treasury the rest
			if (w.laws) {
				const rel = Math.abs(paid - div) / div;
				w.laws.checks++;
				if (rel > w.laws.maxRel) w.laws.maxRel = rel;
				if (rel > 1e-9 && w.laws.breaches.length < 100) w.laws.breaches.push({ day: w.day, msg: `Law 5 ${co.id}: paid ${paid} vs ${div}` });
			}
			t.divPeopleR += toPeople * P[k];
			t.divTreR += toTre * P[k];
			t.divR += paid * P[k];
			co.divR += paid * P[k];
			w.tre[k * M + k] += R - paid;
		} else w.tre[k * M + k] += R;
		co.salesR += R * P[k];
	}
}

/** a COOP pays seller k for `units` of good g at k's posted price (inputs, materials, energy) */
export function coopBuys(w, buyer, k, amtCount) {
	const rest = payDirect(w, w.tre, buyer.k * M, k, amtCount);
	return rest * w.P[k];
}

export { EXTRA_GOODS, LIMIT };
