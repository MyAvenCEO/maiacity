/**
 * SANDBOX 6 · THE VALLEY — one island valley grown from a seed: your headquarters in the west, two neighbour
 * villages in the east (under the peaks, in the northern hills), the fair between you, and round
 * them what an economy needs: forests, rocks, lakes to fish and mountains to mine. Your mountains are mostly bare rock,
 * with one thin vein of iron in the south: the rich iron lies under Eastmere's peaks, so most of your tools come by trade.
 *
 * Pure: the same seed grows the same valley.
 */
import { GRASS, IRON, MOUNTAIN, SAND, WATER } from './rules.js';
import { makeGrid, rng } from './hex.js';
import { makePlan } from './plots.js';

/** the valley's size in nodes: room for three cities of a few villages each, and the wild land between them */
export const W = 60, H = 52;
/** the valley's features were laid out for a smaller map: this much larger now */
const S = 1.3;

/**
 * @typedef {object} Valley
 * @property {number} W
 * @property {number} H
 * @property {number[]} terrain GRASS, WATER, MOUNTAIN or SAND per node
 * @property {number[]} height metres
 * @property {number[]} ore 0 bare rock, 2 iron
 * @property {number[]} amount how much ore a mountain node holds
 * @property {number[]} fish fish in a water node
 * @property {({ k: 'tree', g: number } | { k: 'rock', n: number } | null)[]} obj trees and rocks
 * @property {number} hq where your headquarters stands
 * @property {number[]} villages where the neighbours live
 * @property {number} fair where the valley's open market is held
 */

/** @param {number} seed @returns {Valley} */
export function growValley(seed) {
	const g = makeGrid(W, H);
	const N = W * H;
	const rand = rng(seed * 7919 + 13);
	// smooth value noise on the node plane
	const lattice = Array.from({ length: 64 * 64 }, () => rand());
	const noise = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ f) => {
		const fx = x * f, fy = y * f;
		const x0 = Math.floor(fx), y0 = Math.floor(fy);
		const tx = fx - x0, ty = fy - y0;
		const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
		const L = (/** @type {number} */ a, /** @type {number} */ b) => lattice[(((a % 64) + 64) % 64) * 64 + (((b % 64) + 64) % 64)];
		const a = L(x0, y0) + (L(x0 + 1, y0) - L(x0, y0)) * sx;
		const b = L(x0, y0 + 1) + (L(x0 + 1, y0 + 1) - L(x0, y0 + 1)) * sx;
		return a + (b - a) * sy;
	};
	/** a node on the plane, in steps */
	const px = (/** @type {number} */ i) => (i % W) + (Math.floor(i / W) & 1) * 0.5;
	const py = (/** @type {number} */ i) => Math.floor(i / W) * 0.866;
	const node = (/** @type {number} */ c, /** @type {number} */ r) => r * W + c;
	/** how deep a node is in a blob round (cx, cy) of radius R: above 0 inside, with a ragged edge */
	const inBlob = (/** @type {number} */ i, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ R) => {
		const c = node(cx, cy);
		const d = Math.hypot(px(i) - px(c), py(i) - py(c));
		return R + (noise(px(i), py(i), 0.45) - 0.5) * 2.2 - d;
	};

	const terrain = Array(N).fill(GRASS);
	const height = Array(N).fill(0);
	const ore = Array(N).fill(0);
	const amount = Array(N).fill(0);
	const fish = Array(N).fill(0);
	/** @type {Valley['obj']} */
	const obj = Array(N).fill(null);

	const plan = makePlan(g);
	/** a seat: the house spot of the nearest whole village's middle settlement (the fair: of the nearest settlement) */
	const seat = (/** @type {number} */ c, /** @type {number} */ r, village = true) => {
		const want = node(Math.round(c * S), Math.round(r * S));
		const plots = village ? plan.villages.filter((v) => v.plots.length === 7).map((v) => v.centre) : plan.centre.map((_, k) => k);
		const k = plots.reduce((a, b) => (g.dist(plan.centre[b], want) < g.dist(plan.centre[a], want) ? b : a));
		return plan.spots[k][0];
	};
	const hq = seat(11, 21);
	const villages = [seat(35, 18), seat(29, 10)];
	const fair = seat(22, 15, false);

	/** a feature laid out for the smaller map, moved and grown to this one @param {any[]} f @returns {any} */
	const scaled = (f) => [Math.round(f[0] * S), Math.round(f[1] * S), f[2] * S, ...f.slice(3)];
	/** @type {[number, number, number, (string | null)[]][]} mountains: centre, radius, the ores from its heart out */
	const MOUNTAINS = [
		[8, 12, 4.4, [null]],
		[19, 32, 3.7, ['iron', null, null]],
		[24, 4, 3.2, [null]],
		[39, 7, 4.2, ['iron', 'iron', null]]
	].map(scaled);
	/** @type {[number, number, number][]} lakes */
	const LAKES = [[4, 30, 3.4], [25, 20, 2.4], [42, 33, 3.2], [11, 35, 2.0]].map(scaled);
	/** @type {[number, number, number][]} forests */
	const FORESTS = [[18, 13, 3.6], [15, 26, 3.0], [5, 20, 2.2], [32, 33, 4.2], [33, 5, 3.0], [21, 23, 1.8]].map(scaled);
	/** @type {[number, number, number][]} rock fields */
	const ROCKS = [[13, 15, 1.8], [7, 25, 1.6], [26, 14, 1.5], [40, 22, 1.8]].map(scaled);

	for (let i = 0; i < N; i++) {
		const x = px(i), y = py(i);
		height[i] = 0.35 + noise(x, y, 0.18) * 0.9 + noise(x, y, 0.5) * 0.25;
		// the island: the sea round the edge
		const edge = Math.min(x, W - 0.5 - x, y / 0.866, (H - 1) - y / 0.866) + (noise(x, y, 0.3) - 0.5) * 1.6;
		if (edge < 1.6) terrain[i] = WATER;
		else if (edge < 2.5) terrain[i] = SAND;
		for (const [cx, cy, R, ores] of MOUNTAINS) {
			const k = inBlob(i, cx, cy, R);
			if (k > 0) {
				terrain[i] = MOUNTAIN;
				height[i] = 1.8 + k * 1.5 + noise(x, y, 0.7) * 1.1;
				const o = ores[Math.min(ores.length - 1, Math.floor((1 - Math.min(1, k / R)) * ores.length * 1.15))];
				ore[i] = o === 'iron' ? IRON : 0;
				// your thin vein in the south holds little
				amount[i] = o ? (cy > 20 ? 2 : 3) + Math.floor(rand() * (cy > 20 ? 2 : 5)) : 0;
			}
		}
		for (const [cx, cy, R] of LAKES) {
			const k = inBlob(i, cx, cy, R);
			if (k > 0) {
				terrain[i] = WATER;
				ore[i] = 0;
			} else if (k > -1.1 && terrain[i] !== WATER && terrain[i] !== MOUNTAIN) terrain[i] = SAND;
		}
	}
	for (let i = 0; i < N; i++) {
		if (terrain[i] === WATER) {
			height[i] = -1.4;
			fish[i] = 4;
		} else if (terrain[i] === SAND) height[i] = 0.18 + noise(px(i), py(i), 0.5) * 0.12;
	}

	// forests and rock fields on the grass
	for (let i = 0; i < N; i++) {
		if (terrain[i] !== GRASS) continue;
		let tree = rand() < 0.035;
		for (const [cx, cy, R] of FORESTS) if (inBlob(i, cx, cy, R) > 0 && rand() < 0.72) tree = true;
		let rock = false;
		for (const [cx, cy, R] of ROCKS) if (inBlob(i, cx, cy, R) > 0 && rand() < 0.62) rock = true;
		if (rock) obj[i] = { k: 'rock', n: 4 + Math.floor(rand() * 4) };
		else if (tree) obj[i] = { k: 'tree', g: 0.75 + rand() * 0.25 };
		else if (rand() < 0.008) obj[i] = { k: 'rock', n: 3 + Math.floor(rand() * 3) };
	}

	// the seats' villages (the fair's settlement) are open grass, cleared, and gently level
	const cleared = new Set();
	for (const s of [hq, ...villages]) for (const k of plan.villages[plan.villageOf[plan.plotOf[s]]].plots) cleared.add(k);
	cleared.add(plan.plotOf[fair]);
	for (const k of cleared) {
		const c = plan.centre[k];
		for (const j of [c, ...Array.from({ length: 6 }, (_, d) => g.nb(c, d))]) {
			if (j < 0) continue;
			terrain[j] = GRASS;
			obj[j] = null;
			ore[j] = 0;
			height[j] = Math.min(Math.max(height[j], 0.4), 1.0);
		}
		for (let d = 0; d < 6; d++) if (g.nb(c, d) >= 0) height[g.nb(c, d)] = height[c];
	}
	return { W, H, terrain, height, ore, amount, fish, obj, hq, villages, fair };
}
