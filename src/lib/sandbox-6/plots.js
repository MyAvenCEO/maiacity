/**
 * SANDBOX 6 · CITIES, VILLAGES, SETTLEMENTS — the plan every city is built on, laid over the grid of nodes (./hex.js)
 * and over the valley as it grew (./map.js), unseen until you place something.
 *
 * The valley is cut into big hexes. A hex's middle is a little square where paths meet, and six straight paths can
 * run from it, one to the middle of each hex next to it, along the lines of the grid. Between those six ways lie six
 * corners, a third of the way out: three of them, in a triangle round the square, are the hex's building spots — one
 * for its house (a dome that grows to hold 248), two for the factory domes that work beside it, every door facing the
 * square — and the other three stay free. The rest of the hex, most of it, is land: trees, rocks, fields. Seven hexes make a village: one in the middle, filled by
 * its one large village center, and the six round it; villages tile the valley too. A city is the villages one owner
 * holds. Pure, and the same for every valley of a size.
 */

import { ROW } from './hex.js';

/** steps from the middle of a hex to the middle of the next */
export const K = 13;
/** the corners round a hex's middle, by the two directions between which each lies (as in ./hex.js): each [dq, dr],
 * a third of the way out, so a great dome on one stays clear of the paths either side of it */
const CORNERS = [[4, -2], [2, -4], [-2, -2], [-4, 2], [-2, 4], [2, 2]];
/** which corners are the house's and the two factories': a triangle, the house at the back (north) */
export const HOUSE_CORNER = 1, FACTORY_CORNERS = [3, 5];
/** the six directions in axial steps, as in ./hex.js: east, north-east, north-west, west, south-west, south-east */
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/**
 * @typedef {object} Plan
 * @property {number[]} centre each hex's middle node (its stop)
 * @property {number[][]} spots each hex's [house, factory, factory] nodes (-1 off the map)
 * @property {number[][]} free each hex's three free corners (-1 off the map)
 * @property {number[][]} nbr each hex's six neighbours by direction (-1 none)
 * @property {Int32Array} plotOf the hex a node belongs to (-1 none)
 * @property {Int32Array} spotOf for a node that is a spot: 0 house, 1 or 2 factory; else -1
 * @property {Uint8Array} lane 1 for a node on the straight way between two middles (where a path may run), else 0
 * @property {Uint8Array} clear 1 where nothing grows: a hex's square and its spots, the ground round them, and the
 *   middle of a village's middle hex, where its center stands (its ways may grow over until a path is laid)
 * @property {number[]} villageOf each hex's village
 * @property {{ centre: number, plots: number[], near: number[] }[]} villages the middle hex, its seven hexes, the villages round it
 */

/** @param {import('./hex.js').Grid} g @returns {Plan} */
export function makePlan(g) {
	const { W, H, N } = g;
	const axial = (/** @type {number} */ i) => {
		const r = Math.floor(i / W), c = i % W;
		return [c - (r - (r & 1)) / 2, r];
	};
	const node = (/** @type {number} */ q, /** @type {number} */ r) => {
		if (r < 0 || r >= H) return -1;
		const c = q + (r - (r & 1)) / 2;
		return c < 0 || c >= W ? -1 : r * W + c;
	};
	// the middles: every K steps along the grid's lines, so the way from one to the next is straight
	/** @type {Map<string, number>} */
	const plotAt = new Map();
	/** @type {number[]} */
	const centre = [];
	/** @type {number[][]} */
	const ab = [];
	const span = Math.ceil((W + H) / K) + 2;
	for (let a = -span; a <= span; a++)
		for (let b = -span; b <= span; b++) {
			const n = node(K * a, K * b);
			if (n < 0) continue;
			plotAt.set(`${a},${b}`, centre.length);
			centre.push(n);
			ab.push([a, b]);
		}
	const plotOf = new Int32Array(N).fill(-1), spotOf = new Int32Array(N).fill(-1);
	// each node to the nearest middle (on a hex's edge, the first of the two)
	for (let i = 0; i < N; i++) {
		const [q, r] = axial(i);
		const a0 = Math.floor(q / K), b0 = Math.floor(r / K);
		let best = -1, bd = Infinity, be = Infinity;
		for (let a = a0 - 1; a <= a0 + 2; a++)
			for (let b = b0 - 1; b <= b0 + 2; b++) {
				const k = plotAt.get(`${a},${b}`);
				if (k === undefined) continue;
				const d = g.dist(i, centre[k]);
				const e = Math.hypot(g.x(i) - g.x(centre[k]), g.z(i) - g.z(centre[k]));
				if (d < bd || (d === bd && e < be - 1e-6)) (bd = d), (be = e), (best = k);
			}
		if (best < 0) for (let k = 0; k < centre.length; k++) {
			const d = g.dist(i, centre[k]);
			if (d < bd) (bd = d), (best = k);
		}
		plotOf[i] = best;
	}
	const corner = (/** @type {number} */ k, /** @type {number} */ x) => {
		const [q, r] = axial(centre[k]);
		const n = node(q + CORNERS[x][0], r + CORNERS[x][1]);
		return n >= 0 && plotOf[n] === k ? n : -1;
	};
	const spots = centre.map((_, k) => {
		const s = [HOUSE_CORNER, ...FACTORY_CORNERS].map((x) => corner(k, x));
		s.forEach((j, x) => j >= 0 && (spotOf[j] = x));
		return s;
	});
	const free = centre.map((_, k) => [0, 2, 4].map((x) => corner(k, x)));
	const nbr = ab.map(([a, b]) => DIRS.map(([da, db]) => plotAt.get(`${a + da},${b + db}`) ?? -1));
	// the ways from every middle to the next: kept open for paths
	const lane = new Uint8Array(N);
	for (let k = 0; k < centre.length; k++)
		for (let d = 0; d < 6; d++)
			for (let s = 1, j = g.nb(centre[k], d); s < K && j >= 0; s++, j = g.nb(j, d)) lane[j] = 1;
	// villages: a middle hex and the six round it, on a lattice of their own that tiles the hexes
	/** @type {Map<string, number>} */
	const villAt = new Map();
	const villageOf = Array(centre.length).fill(-1);
	/** @type {Plan['villages']} */
	const villages = [];
	for (let s = -span; s <= span; s++)
		for (let t = -span; t <= span; t++) {
			const a = 2 * s - t, b = s + 3 * t;
			const members = [[a, b], ...DIRS.map(([da, db]) => [a + da, b + db])].map(([x, y]) => plotAt.get(`${x},${y}`)).filter((k) => k !== undefined);
			if (!members.length) continue;
			const mid = plotAt.get(`${a},${b}`) ?? /** @type {number} */ (members[0]);
			const v = villages.length;
			villAt.set(`${s},${t}`, v);
			villages.push({ centre: mid, plots: /** @type {number[]} */ (members), near: [] });
			for (const k of members) villageOf[/** @type {number} */ (k)] = v;
		}
	for (const [key, v] of villAt) {
		const [s, t] = key.split(',').map(Number);
		villages[v].near = DIRS.map(([ds, dt]) => villAt.get(`${s + ds},${t + dt}`)).filter((x) => x !== undefined).map(Number);
	}
	// where nothing grows: the square and the ground round it, every spot and the ground round it; a village's middle
	// hex out to where its center ends
	const clear = new Uint8Array(N);
	const ring = (/** @type {number} */ n, /** @type {number} */ r) => {
		if (n < 0) return;
		const [q0, r0] = axial(n);
		for (let dq = -r; dq <= r; dq++)
			for (let dr = Math.max(-r, -dq - r); dr <= Math.min(r, -dq + r); dr++) {
				const j = node(q0 + dq, r0 + dr);
				if (j >= 0) clear[j] = 1;
			}
	};
	for (let k = 0; k < centre.length; k++) {
		ring(centre[k], 1);
		// the house grows into a great dome; a factory stays small
		spots[k].forEach((j, x) => ring(j, x === 0 ? 2 : 1));
	}
	for (const v of villages) ring(centre[v.centre], 3);
	return { centre, spots, free, nbr, plotOf, spotOf, lane, clear, villageOf, villages };
}

/**
 * The straight way from the middle of a hex to the middle of the one next to it in a direction: K + 1 nodes, both
 * middles included, or null off the map.
 * @param {import('./hex.js').Grid} g @param {Plan} plan @param {number} k @param {number} d
 */
export function spoke(g, plan, k, d) {
	const out = [plan.centre[k]];
	for (let s = 0; s < K; s++) {
		const j = g.nb(out[out.length - 1], d);
		if (j < 0) return null;
		out.push(j);
	}
	return out;
}

/** how far a village center's ring road runs from the middle of its hex, where it stands, in world units: under the
 * ground, round its tower (about 4.5 out with the crates at its door) and well inside its hex (whose edge is 10.4 out
 * at the nearest) */
export const RING_R = 7.5;

/** a point on a village center's ring road, at an angle @param {{ x: number, z: number }} c @param {number} a */
export const onRing = (c, a) => [c.x + RING_R * Math.cos(a), c.z + RING_R * Math.sin(a)];

/**
 * The way along the trade routes through a chain of village centers, as points on the ground [x, z] at most `step`
 * apart. Out of the first one's door along its spur to its ring road, round the ring the short way to where the route
 * to the next one leaves it, straight across to the next one's ring, round that one, and so on; at the last one, round
 * to its spur and in at its door. A route never crosses a village center, only rings it. Each center is its stop
 * (x, z), the middle of its hex where it stands, and the angle its door faces (door), where its spur leaves.
 * @param {{ x: number, z: number, door: number }[]} chain @param {number} step
 */
export function ringWay(chain, step) {
	/** @type {number[][]} */
	const pts = [[chain[0].x, chain[0].z]];
	const to = (/** @type {number[]} */ [x, z]) => {
		const [lx, lz] = pts[pts.length - 1];
		const n = Math.ceil(Math.hypot(x - lx, z - lz) / step - 1e-9);
		for (let k = 1; k <= n; k++) pts.push([lx + ((x - lx) * k) / n, lz + ((z - lz) * k) / n]);
	};
	/** round a ring the short way, from one angle to another */
	const round = (/** @type {{ x: number, z: number }} */ c, /** @type {number} */ a0, /** @type {number} */ a1) => {
		const d = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
		const n = Math.ceil((Math.abs(d) * RING_R) / step);
		for (let k = 1; k <= n; k++) to(onRing(c, a0 + (d * k) / n));
	};
	let enter = chain[0].door;
	to(onRing(chain[0], enter));
	for (let k = 1; k < chain.length; k++) {
		const p = chain[k - 1], c = chain[k];
		const out = Math.atan2(c.z - p.z, c.x - p.x);
		round(p, enter, out);
		enter = out + Math.PI;
		to(onRing(c, enter));
	}
	const last = chain[chain.length - 1];
	round(last, enter, last.door);
	to([last.x, last.z]);
	return pts;
}

/**
 * The nodes under each village's ring road (RING_R round its middle hex's middle) and under the spur from its center's
 * door out to it, by village: nothing grows there. The center stands on the middle and faces away from the house spot
 * it is built on.
 * @param {import('./hex.js').Grid} g @param {Plan} plan @returns {number[][]}
 */
export function ringNodes(g, plan) {
	const reach = Math.ceil((RING_R + 2) / ROW);
	return plan.villages.map((v) => {
		const c = plan.centre[v.centre], s = plan.spots[v.centre][0];
		if (c < 0) return [];
		const cx = g.x(c), cz = g.z(c);
		const door = s >= 0 ? Math.atan2(cz - g.z(s), cx - g.x(s)) : Math.PI / 2;
		const ux = Math.cos(door), uz = Math.sin(door);
		return g.within(c, reach).filter((j) => {
			const dx = g.x(j) - cx, dz = g.z(j) - cz, d = Math.hypot(dx, dz);
			const along = dx * ux + dz * uz, across = Math.abs(dz * ux - dx * uz);
			return Math.abs(d - RING_R) < 1.2 || (along > 3.5 && along < RING_R && across < 1);
		});
	});
}
