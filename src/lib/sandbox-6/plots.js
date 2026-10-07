/**
 * SANDBOX 6 · CITIES, VILLAGES, SETTLEMENTS — the plan every city is built on, laid over the grid of nodes (./hex.js).
 *
 * A settlement is one small hex of seven nodes: its flag in the middle and, round it, three spots in a triangle — one
 * for its house, two for the factory domes that work beside it (the other three nodes stay free for roads). The small
 * hexes tile the whole valley. Seven settlements make a village: one in the middle, six round it; villages tile the
 * valley too. A city is the villages one owner holds. Pure, and the same for every valley of a size.
 */

/** where round its flag a settlement's house and its two factories stand (directions as in ./hex.js) */
export const HOUSE_DIR = 2, FACTORY_DIRS = [0, 4];

/**
 * @typedef {object} Plan
 * @property {number[]} centre each settlement plot's flag node
 * @property {number[][]} spots each plot's [house, factory, factory] nodes (-1 off the map)
 * @property {Int32Array} plotOf the plot a node belongs to (-1 none)
 * @property {Int32Array} spotOf for a node that is a spot: 0 house, 1 or 2 factory; else -1
 * @property {number[]} villageOf each plot's village
 * @property {{ centre: number, plots: number[], near: number[] }[]} villages the middle plot, its seven plots, the villages round it
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
	// settlement plots: centres on the lattice a·(2,1) + b·(−1,3), so their seven-node hexes tile the plane
	/** @type {Map<string, number>} */
	const plotAt = new Map();
	const centre = [], ab = [];
	const span = W + H;
	for (let a = -span; a <= span; a++)
		for (let b = -span; b <= span; b++) {
			const n = node(2 * a - b, a + 3 * b);
			if (n < 0) continue;
			plotAt.set(`${a},${b}`, centre.length);
			centre.push(n);
			ab.push([a, b]);
		}
	const plotOf = new Int32Array(N).fill(-1), spotOf = new Int32Array(N).fill(-1);
	const spots = centre.map((c, k) => {
		plotOf[c] = k;
		for (let d = 0; d < 6; d++) {
			const j = g.nb(c, d);
			if (j >= 0) plotOf[j] = k;
		}
		const s = [HOUSE_DIR, ...FACTORY_DIRS].map((d) => g.nb(c, d));
		s.forEach((j, x) => j >= 0 && (spotOf[j] = x));
		return s;
	});
	// nodes at the very edge whose plot centre is off the map: the nearest plot
	for (let i = 0; i < N; i++)
		if (plotOf[i] < 0) {
			let best = -1, bd = Infinity;
			for (let k = 0; k < centre.length; k++) {
				const d = g.dist(i, centre[k]);
				if (d < bd) (bd = d), (best = k);
			}
			plotOf[i] = best;
		}
	// villages: the same lattice again, on the plots
	/** @type {Map<string, number>} */
	const villAt = new Map();
	const villageOf = Array(centre.length).fill(-1);
	/** @type {Plan['villages']} */
	const villages = [];
	const PLOT_NB = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
	for (let s = -span; s <= span; s++)
		for (let t = -span; t <= span; t++) {
			const a = 2 * s - t, b = s + 3 * t;
			const members = [[a, b], ...PLOT_NB.map(([da, db]) => [a + da, b + db])].map(([x, y]) => plotAt.get(`${x},${y}`)).filter((k) => k !== undefined);
			if (!members.length) continue;
			const mid = plotAt.get(`${a},${b}`) ?? /** @type {number} */ (members[0]);
			const v = villages.length;
			villAt.set(`${s},${t}`, v);
			villages.push({ centre: mid, plots: /** @type {number[]} */ (members), near: [] });
			for (const k of members) villageOf[/** @type {number} */ (k)] = v;
		}
	for (const [key, v] of villAt) {
		const [s, t] = key.split(',').map(Number);
		villages[v].near = PLOT_NB.map(([ds, dt]) => villAt.get(`${s + ds},${t + dt}`)).filter((x) => x !== undefined).map(Number);
	}
	return { centre, spots, plotOf, spotOf, villageOf, villages };
}
