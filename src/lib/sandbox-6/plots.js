/**
 * SANDBOX 6 · CITIES, VILLAGES, SETTLEMENTS — the plan every city is built on, laid over the grid of nodes (./hex.js).
 *
 * The valley is a field of big hexes, as on the island of Sandbox 1, one biome each. A hex's middle is a stop where
 * paths meet, and six straight paths can run from it, one to the middle of each hex next to it, along the lines of the
 * grid. Between those six ways lie six corners: three of them, in a triangle round the middle, are the hex's building
 * spots — one for its house, two for the factory domes that work beside it — and the other three stay free (trees,
 * rocks, fields). Seven hexes make a village: one in the middle, filled by its one large village center, and the six
 * round it; villages tile the valley too. A city is the villages one owner holds. Pure, and the same for every valley
 * of a size.
 */

/** steps from the middle of a hex to the middle of the next */
export const K = 4;
/** the corners round a hex's middle, by the two directions between which each lies (as in ./hex.js): each [dq, dr] */
const CORNERS = [[2, -1], [1, -2], [-1, -1], [-2, 1], [-1, 2], [1, 1]];
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
	return { centre, spots, free, nbr, plotOf, spotOf, villageOf, villages };
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
