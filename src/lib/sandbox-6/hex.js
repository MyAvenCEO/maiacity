/**
 * SANDBOX 6 · THE GRID — the valley is a field of nodes, each with six neighbours: rows of nodes, every odd row
 * shifted half a step east, so three nodes always make an even triangle (the terrain is drawn from those triangles).
 * Buildings, flags, trees and rocks stand on nodes; roads run from node to node.
 *
 * Directions, by index: 0 east, 1 north-east, 2 north-west, 3 west, 4 south-west, 5 south-east. The big hexes the
 * valley is made of (./plots.js) lie on these nodes: a building's stop is the middle of its hex.
 */

/** world units between two neighbouring nodes */
export const STEP = 2.0;
/** world units between two rows */
export const ROW = (STEP * Math.sqrt(3)) / 2;

const EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
export const SE = 5;

/**
 * @typedef {object} Grid
 * @property {number} W
 * @property {number} H
 * @property {number} N
 * @property {Int32Array} nbr six neighbours a node, -1 off the map
 * @property {(i: number, d: number) => number} nb
 * @property {(a: number, b: number) => number} dist steps between two nodes
 * @property {(i: number) => number} x world x of a node (the valley centred on 0)
 * @property {(i: number) => number} z world z of a node
 * @property {(i: number, r: number) => number[]} within every node at most r steps away
 * @property {(x: number, z: number) => number} at the node nearest a point, or -1 off the map
 */

/** @param {number} W @param {number} H @returns {Grid} */
export function makeGrid(W, H) {
	const N = W * H;
	const nbr = new Int32Array(N * 6).fill(-1);
	const cq = new Int32Array(N), cr = new Int32Array(N);
	for (let r = 0; r < H; r++)
		for (let c = 0; c < W; c++) {
			const i = r * W + c;
			cq[i] = c - (r - (r & 1)) / 2;
			cr[i] = r;
			const D = r & 1 ? ODD : EVEN;
			for (let d = 0; d < 6; d++) {
				const nc = c + D[d][0], nr = r + D[d][1];
				if (nc >= 0 && nc < W && nr >= 0 && nr < H) nbr[i * 6 + d] = nr * W + nc;
			}
		}
	const ox = ((W - 0.5) * STEP) / 2, oz = ((H - 1) * ROW) / 2;
	const dist = (/** @type {number} */ a, /** @type {number} */ b) => {
		const dq = cq[a] - cq[b], dr = cr[a] - cr[b];
		return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
	};
	return {
		W,
		H,
		N,
		nbr,
		nb: (i, d) => nbr[i * 6 + d],
		dist,
		x: (i) => ((i % W) + (Math.floor(i / W) & 1) * 0.5) * STEP - ox,
		z: (i) => Math.floor(i / W) * ROW - oz,
		within(i, r) {
			const out = [];
			const r0 = Math.floor(i / W), c0 = i % W;
			for (let rr = Math.max(0, r0 - r); rr <= Math.min(H - 1, r0 + r); rr++)
				for (let cc = Math.max(0, c0 - r - 1); cc <= Math.min(W - 1, c0 + r + 1); cc++) {
					const j = rr * W + cc;
					if (dist(i, j) <= r) out.push(j);
				}
			return out;
		},
		at(x, z) {
			const r = Math.round((z + oz) / ROW);
			if (r < 0 || r >= H) return -1;
			const c = Math.round((x + ox) / STEP - (r & 1) * 0.5);
			if (c < 0 || c >= W) return -1;
			let best = r * W + c, bd = Infinity;
			for (const j of [best, ...Array.from({ length: 6 }, (_, d) => nbr[best * 6 + d])]) {
				if (j < 0) continue;
				const dx = ((j % W) + (Math.floor(j / W) & 1) * 0.5) * STEP - ox - x, dz = Math.floor(j / W) * ROW - oz - z;
				const dd = dx * dx + dz * dz;
				if (dd < bd) (bd = dd), (best = j);
			}
			return best;
		}
	};
}

/**
 * The shortest way between two nodes (A*), each step to a neighbour; null when there is none.
 * @param {Grid} g
 * @param {number} from
 * @param {number} to
 * @param {(i: number) => boolean} open whether a walk may pass through a node (the two ends are always open)
 * @param {number} [limit] give up beyond so many nodes searched
 * @param {(i: number) => number} [extra] what stepping onto a node costs beyond one step (to keep a way off some nodes)
 * @returns {number[] | null}
 */
export function findPath(g, from, to, open, limit = 4000, extra) {
	if (from === to) return [from];
	const came = new Map([[from, -1]]);
	const cost = new Map([[from, 0]]);
	/** @type {[number, number][]} a binary heap of [priority, node] */
	const heap = [[g.dist(from, to), from]];
	const push = (/** @type {[number, number]} */ e) => {
		heap.push(e);
		let k = heap.length - 1;
		while (k > 0) {
			const p = (k - 1) >> 1;
			if (heap[p][0] <= heap[k][0]) break;
			[heap[p], heap[k]] = [heap[k], heap[p]];
			k = p;
		}
	};
	const pop = () => {
		const top = heap[0], last = /** @type {[number, number]} */ (heap.pop());
		if (heap.length) {
			heap[0] = last;
			let k = 0;
			for (;;) {
				const l = 2 * k + 1, r = l + 1;
				let m = k;
				if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
				if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
				if (m === k) break;
				[heap[m], heap[k]] = [heap[k], heap[m]];
				k = m;
			}
		}
		return top;
	};
	let searched = 0;
	while (heap.length && searched++ < limit) {
		const [, i] = pop();
		if (i === to) {
			const path = [];
			for (let k = to; k !== -1; k = /** @type {number} */ (came.get(k))) path.push(k);
			return path.reverse();
		}
		const ci = /** @type {number} */ (cost.get(i));
		for (let d = 0; d < 6; d++) {
			const j = g.nbr[i * 6 + d];
			if (j < 0 || (j !== to && !open(j))) continue;
			const cj = ci + 1 + (extra ? extra(j) : 0);
			if (cj < (cost.get(j) ?? Infinity)) {
				cost.set(j, cj);
				came.set(j, i);
				push([cj + g.dist(j, to), j]);
			}
		}
	}
	return null;
}

/** A small seeded random generator (mulberry32): the same seed, the same valley. @param {number} seed */
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
