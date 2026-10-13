// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE POOLS — protocol-owned, equal-weight G3M baskets of 4 to 8 MINDs (paper Eq. 5–6).
 *
 * A pool holds a reserve of each of its MINDs. In an equal-weight basket the price of one MIND in another is the
 * ratio of their reserves. A swap keeps the product of the reserves (their geometric mean) and the 0.3 % fee stays in
 * the pool, so the product only grows. Nothing is ever withdrawn and nobody holds a share of a pool. The only ways in
 * are the tenth of the treasury half of each HEART (a COOP's own MIND, into its baskets) and swaps; the only way out
 * is the other side of a swap. The CITYmind sits in every basket, so any two MINDs meet in at most 2 hops.
 *
 * Plain functions on the world; the maths is lifted from scripts/theos-e2e-sim.mjs (swapOut, routes, the arbitrage
 * cycles, the consensus price), rewritten for a world of up to MAX_COOPS MINDs.
 */
import { exp, log } from './dmath.js';
import { GAMMA, MAX_COOPS } from './consts.js';

/** a new, empty basket of these MINDs */
export function newPool(members) {
	const pos = new Int32Array(MAX_COOPS).fill(-1);
	members.forEach((k, i) => (pos[k] = i));
	return { members: Int32Array.from(members), pos, x: new Float64Array(members.length), live: false };
}

/** which pools each MIND sits in, and the route table, rebuilt when a basket is added */
export function indexPools(w) {
	w.poolsOf = Array.from({ length: MAX_COOPS }, () => []);
	w.pools.forEach((p, pi) => p.members.forEach((k) => w.poolsOf[k].push(pi)));
	w.routeCache = new Map();
}

/** what a swap of amt of member a gives of member b, before it is made */
export const swapOut = (x, a, b, amt) => {
	const ain = amt * GAMMA;
	return (x[b] * ain) / (x[a] + ain);
};

/** all routes of at most 2 hops from MIND j to MIND k: [pool, from, to] or [pool, from, to, pool2, from2, to2] */
export function routesOf(w, j, k) {
	const key = j * MAX_COOPS + k;
	let rs = w.routeCache.get(key);
	if (rs) return rs;
	rs = [];
	const P = w.pools;
	for (const p of w.poolsOf[j]) if (P[p].pos[k] >= 0) rs.push([p, P[p].pos[j], P[p].pos[k]]);
	for (const p1 of w.poolsOf[j])
		for (let i = 0; i < P[p1].members.length; i++) {
			const m = P[p1].members[i];
			if (m === j || m === k) continue;
			for (const p2 of w.poolsOf[m]) if (p2 !== p1 && P[p2].pos[k] >= 0) rs.push([p1, P[p1].pos[j], P[p1].pos[m], p2, P[p2].pos[m], P[p2].pos[k]]);
		}
	w.routeCache.set(key, rs);
	return rs;
}

function routeQuote(w, r, amt) {
	const p1 = w.pools[r[0]];
	if (!p1.live) return 0;
	let o = swapOut(p1.x, r[1], r[2], amt);
	if (r.length > 3) {
		const p2 = w.pools[r[3]];
		if (!p2.live) return 0;
		o = swapOut(p2.x, r[4], r[5], o);
	}
	return o;
}

function routeDo(w, r, amt) {
	const p1 = w.pools[r[0]];
	let o = swapOut(p1.x, r[1], r[2], amt);
	p1.x[r[1]] += amt;
	p1.x[r[2]] -= o;
	let fee = amt * (1 - GAMMA) * w.P[p1.members[r[1]]];
	if (r.length > 3) {
		const p2 = w.pools[r[3]];
		const o2 = swapOut(p2.x, r[4], r[5], o);
		fee += o * (1 - GAMMA) * w.P[p2.members[r[4]]];
		p2.x[r[4]] += o;
		p2.x[r[5]] -= o2;
		o = o2;
	}
	w.today.routeFeeR += fee;
	return o;
}

/**
 * Sell q of MIND j for MIND k through the best routes, in four slices. Returns what arrived; what found no live
 * route is handed back (`back`), so nothing is lost.
 */
export function swap(w, j, k, q) {
	if (!(q > 0)) return { out: 0, back: 0 };
	if (j === k) return { out: q, back: 0 };
	const rs = routesOf(w, j, k);
	let out = 0, back = 0;
	// a big trade goes in four slices (each takes the best route at that moment); a small one (under 1 % of the
	// seller MIND's first reserve) in one
	const r0 = rs.length ? w.pools[rs[0][0]].x[rs[0][1]] : 0;
	const slices = q > 0.01 * r0 ? 4 : 1;
	for (let s = 0; s < slices; s++) {
		const a = q / slices;
		let best = -1, bo = 0;
		for (let r = 0; r < rs.length; r++) {
			const o = routeQuote(w, rs[r], a);
			if (o > bo) (bo = o), (best = r);
		}
		if (best < 0) {
			back += a;
			continue;
		}
		const o = routeDo(w, rs[best], a);
		out += o;
		w.today.routedR += a * w.P[j];
		if (w.today.swapSold) (w.today.swapSold[j] += a * w.P[j]), (w.today.swapBought[k] += o * w.P[k]);
		w.today.hopsR += (a * w.P[j] * rs[best].length) / 3;
	}
	return { out, back };
}

/** a pool is live when every member has a reserve */
function liveness(w) {
	for (const p of w.pools) {
		let ok = true;
		for (let i = 0; i < p.x.length; i++) if (!(p.x[i] > 1e-12)) ok = false;
		p.live = ok;
	}
}

/**
 * The consensus price of each MIND in R from all live pools (depth-weighted, in log space). By default (rIndex
 * 'hearts') R is anchored to HEARTS:
 * the HEARTS-weighted mean price of the MIND being created (weights: each COOP's share of the HEARTS converted, a
 * 30-day average) is held at 1 R, so a person's 24 HEARTS a day always make about 24 R of MIND, of which 12 R is the
 * person's. The index is chain-linked (today's weights value yesterday's and today's prices alike, so a shift of
 * where HEARTS go never moves R by itself) and relaxes to 1 with a 30-day time constant. A MIND with no live pool
 * keeps its last price. With rIndex 'basket', R is the paper's: the geometric mean of the SOLAR-, HABITAT- and
 * CITYmind prices, chain-linked when a reference MIND fails (it drifts against HEARTS as those three MINDs' pools
 * fill at different speeds, which is why it is not the default).
 */
export function updatePrices(w) {
	liveness(w);
	const M = MAX_COOPS, P = w.P;
	const lnP = new Float64Array(M);
	for (let k = 0; k < M; k++) lnP[k] = log(P[k] > 0 ? P[k] : 1);
	const seen = new Uint8Array(M);
	// the weights: each COOP's share of the HEARTS converted (30-day average, today included)
	const wt = new Float64Array(M);
	let ws = 0;
	for (const co of w.coops) if (co.alive) (wt[co.k] = (co.heartsEma * 29 + co.heartsToday) / 30), (ws += wt[co.k]);
	for (let it = 0; it < 6; it++) {
		const num = new Float64Array(M), den = new Float64Array(M);
		for (const p of w.pools) {
			if (!p.live) continue;
			const n = p.members.length;
			let mp = 0, mx = 0;
			for (let i = 0; i < n; i++) (mp += lnP[p.members[i]]), (mx += log(p.x[i]));
			const s = (mp + mx) / n;
			const depth = n * exp(s);
			for (let i = 0; i < n; i++) {
				num[p.members[i]] += depth * (s - log(p.x[i]));
				den[p.members[i]] += depth;
			}
		}
		for (let k = 0; k < M; k++) if (den[k] > 0) (lnP[k] = num[k] / den[k]), (seen[k] = 1);
		if (w.cfg.rIndex === 'basket') {
			// the paper's R: the geometric mean of the reference MINDs (SOLAR-, HABITAT- and CITYmind) holds its level;
			// when a reference MIND fails and its heir takes its place, the index is chain-linked
			const refs = w.refMinds.filter((k) => seen[k] && w.coops[k]?.alive);
			if (!refs.length) continue;
			const key = refs.join(',');
			if (key !== w.refKey) {
				let t = 0;
				for (const k of refs) t += log(P[k] > 0 ? P[k] : 1);
				w.refTarget = w.refKey == null ? 0 : t / refs.length;
				w.refKey = key;
			}
			let ref = 0;
			for (const k of refs) ref += lnP[k];
			const shift = ref / refs.length - w.refTarget;
			for (let k = 0; k < M; k++) if (den[k] > 0) lnP[k] -= shift;
			continue;
		}
		if (!(ws > 0)) continue;
		let a = 0, b = 0, sw = 0;
		for (let k = 0; k < M; k++) {
			if (!(wt[k] > 0) || !seen[k]) continue;
			a += wt[k] * exp(lnP[k]);
			b += wt[k] * (P[k] > 0 ? P[k] : 1);
			sw += wt[k];
		}
		if (!(sw > 0)) continue;
		const target = (1 - 1 / 30) * log(b / sw);
		const shift = log(a / sw) - target;
		for (let k = 0; k < M; k++) if (den[k] > 0) lnP[k] -= shift;
	}
	for (let k = 0; k < M; k++) if (seen[k]) P[k] = exp(lnP[k]);
	const a = 1 / 7;
	for (let k = 0; k < M; k++) w.Ptw[k] += a * (P[k] - w.Ptw[k]);
}

/**
 * Put MIND k into its baskets (the tenth of the treasury half of a HEART), split equally between them. Counted in the
 * money ledger as part of the HEART conversion, not as a transfer.
 */
export function poolInflow(w, k, amt) {
	const ps = w.poolsOf[k];
	if (!ps.length || !(amt > 0)) return false;
	const each = amt / ps.length;
	for (const pi of ps) w.pools[pi].x[w.pools[pi].pos[k]] += each;
	return true;
}

/**
 * Arbitrage between pools that share two MINDs: where a loop through two or three pools gives back more than it took,
 * the Avens trade it with the MIND they hold (all Avens run the same bot). The trade is backed by their holdings: it
 * takes no more of the starting MIND than people hold of it, from each in proportion, and gives each back what their
 * part made, so the gain goes to the holders in proportion to what they put in. Nothing is borrowed. With the
 * genesis baskets (each MIND in one basket besides the CITYmind) there is no loop; loops appear when Law 3 foundings
 * make baskets overlap.
 */
export function arbitrage(w) {
	if (!w.cycles) buildCycles(w);
	let gainR = 0;
	for (let pass = 0; pass < 3; pass++) {
		let any = false;
		for (const e of w.cycles) {
			let A = 1, B = 1, C = 0, ok = true;
			for (let h = 0; h < e.length; h += 3) {
				const p = w.pools[e[h]];
				if (!p.live) {
					ok = false;
					break;
				}
				const a = p.x[e[h + 1]], b = p.x[e[h + 2]];
				const A2 = b * GAMMA * A, B2 = a * B, C2 = a * C + GAMMA * A;
				(A = A2), (B = B2), (C = C2);
			}
			if (!ok || !(A > B * 1.000001)) continue;
			const d = (Math.sqrt(A * B) - B) / C;
			if (!(d > 0)) continue;
			const start = w.pools[e[0]].members[e[1]];
			// the trade needs d of the starting MIND, out of what people hold of it
			let H = 0;
			for (let i = 0; i < w.N; i++) {
				const h = w.hold[i * MAX_COOPS + start];
				if (h > 0) H += h;
			}
			const d0 = Math.min(d, H);
			if (!(d0 > 0)) continue;
			let amt = d0;
			for (let h = 0; h < e.length; h += 3) {
				const p = w.pools[e[h]];
				const o = swapOut(p.x, e[h + 1], e[h + 2], amt);
				p.x[e[h + 1]] += amt;
				p.x[e[h + 2]] -= o;
				amt = o;
			}
			// each holder put in d0 / H of what they hold and gets back that part times amt / d0; the net is the profit, in
			// proportion to holdings (it is positive: the loop is traded only where it gives back more than it takes)
			const profit = amt - d0;
			if (profit > 0) any = true;
			const f = profit / H;
			for (let i = 0; i < w.N; i++) {
				const h = w.hold[i * MAX_COOPS + start];
				if (h > 0) w.hold[i * MAX_COOPS + start] = h + h * f;
			}
			gainR += profit * w.P[start];
		}
		if (!any) break;
	}
	w.today.arbR += gainR;
}

/** loops of two pools sharing two MINDs */
export function buildCycles(w) {
	const cyc = [];
	const P = w.pools;
	for (let p1 = 0; p1 < P.length; p1++)
		for (let p2 = 0; p2 < P.length; p2++) {
			if (p1 === p2) continue;
			const shared = [...P[p1].members].filter((k) => P[p2].pos[k] >= 0);
			for (const i of shared) for (const j of shared) if (i !== j) cyc.push([p1, P[p1].pos[i], P[p1].pos[j], p2, P[p2].pos[j], P[p2].pos[i]]);
		}
	w.cycles = cyc;
}
