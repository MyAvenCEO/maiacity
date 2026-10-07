/**
 * SANDBOX 6 · THE VALLEY — one island valley grown from a seed: rolling grass, the sea round a sandy coast, mountains
 * with snow on their peaks and iron in their hearts, lakes, woods and fields of rocks. Your first village lies in the
 * west, open grass with two woods and a field of rocks of its own; the water and the iron are out in the valley, for
 * the villages you found next.
 *
 * The valley does not know the hexes it is cut into (./plots.js): what each hex is good for is read from the land
 * that grew on it (`biomes`).
 *
 * Pure: the same seed grows the same valley.
 */
import { GRASS, IRON, MOUNTAIN, SAND, WATER } from './rules.js';
import { STEP, makeGrid, rng } from './hex.js';
import { K, makePlan } from './plots.js';

/** the valley's size in nodes: room for some twenty-five villages, the sea round them */
export const W = 186, H = 160;
/** the valley was first laid out on a coarser grid of 60 by 52 nodes: its features are given in those old steps
 * (columns across, rows down), and so is its noise, so it grows as it always did, now 5 world units to the step */
const OLD = 5, OW = 60, OH = 52, S = 1.3;
/** world units from one hex's middle to the next */
const HS = K * STEP;

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
 * @property {number} hq where your first village center stands
 * @property {number[]} villages where the neighbours live (none: you play the valley on your own)
 * @property {string[]} biome what each hex is good for (./rules.js BIOMES)
 */

/** @param {number} seed @returns {Valley} */
export function growValley(seed) {
	const g = makeGrid(W, H);
	const N = W * H;
	const rand = rng(seed * 7919 + 13);
	// smooth value noise on the plane of the old steps
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
	/** a node's place in old steps: across, and down (rows of 0.866) */
	const px = (/** @type {number} */ i) => g.x(i) / OLD + (OW - 0.5) / 2;
	const py = (/** @type {number} */ i) => g.z(i) / OLD + ((OH - 1) * 0.866) / 2;
	/** an old node (column, row) in old steps */
	const oldAt = (/** @type {number} */ c, /** @type {number} */ r) => [c + (r & 1) * 0.5, r * 0.866];
	/** how deep a node is in a blob round an old node of radius R (old steps): above 0 inside, with a ragged edge */
	const inBlob = (/** @type {number} */ i, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ R) => {
		const [x, y] = oldAt(cx, cy);
		return R + (noise(px(i), py(i), 0.45) - 0.5) * 2.2 - Math.hypot(px(i) - x, py(i) - y);
	};

	const terrain = Array(N).fill(GRASS);
	const height = Array(N).fill(0);
	const ore = Array(N).fill(0);
	const amount = Array(N).fill(0);
	const fish = Array(N).fill(0);
	/** @type {Valley['obj']} */
	const obj = Array(N).fill(null);

	/** a feature laid out for the smallest map, moved and grown to this one @param {any[]} f @returns {any} */
	const scaled = (f) => [Math.round(f[0] * S), Math.round(f[1] * S), f[2] * S, ...f.slice(3)];
	/** @type {[number, number, number, (string | null)[]][]} mountains: centre, radius, the ores from its heart out */
	const MOUNTAINS = [
		[8, 12, 4.4, [null]],
		[19, 32, 3.7, ['iron', 'iron', null]],
		[24, 4, 3.2, [null]],
		[39, 7, 4.2, ['iron', 'iron', null]]
	].map(scaled);
	/** @type {[number, number, number][]} lakes */
	const LAKES = [[4, 30, 3.4], [25, 20, 2.4], [42, 33, 3.2], [11, 35, 2.0]].map(scaled);
	/** @type {[number, number, number][]} forests */
	const FORESTS = [[18, 13, 3.6], [15, 26, 3.0], [5, 20, 2.2], [32, 33, 4.2], [33, 5, 3.0], [21, 23, 1.8]].map(scaled);
	/** @type {[number, number, number][]} rock fields */
	const ROCKS = [[13, 15, 1.8], [7, 25, 1.6], [26, 14, 1.5], [40, 22, 1.8]].map(scaled);

	/** raise the mountains and fill the lakes over a node @param {typeof MOUNTAINS} mountains @param {typeof LAKES} lakes */
	const lay = (/** @type {number} */ i, mountains, lakes) => {
		const x = px(i), y = py(i);
		for (const [cx, cy, R, ores] of mountains) {
			const k = inBlob(i, cx, cy, R);
			if (k > 0) {
				terrain[i] = MOUNTAIN;
				height[i] = 1.8 + k * 1.5 + noise(x, y, 0.7) * 1.1;
				const o = ores[Math.min(ores.length - 1, Math.floor((1 - Math.min(1, k / R)) * ores.length * 1.15))];
				ore[i] = o === 'iron' ? IRON : 0;
				// the vein in the south holds little
				amount[i] = o ? (cy > 26 ? 2 : 3) + Math.floor(rand() * (cy > 26 ? 2 : 4)) : 0;
			}
		}
		for (const [cx, cy, R] of lakes) {
			const k = inBlob(i, cx, cy, R);
			if (k > 0) {
				terrain[i] = WATER;
				ore[i] = 0;
			} else if (k > -1.1 && terrain[i] !== WATER && terrain[i] !== MOUNTAIN) terrain[i] = SAND;
		}
	};
	for (let i = 0; i < N; i++) {
		const x = px(i), y = py(i);
		height[i] = 0.35 + noise(x, y, 0.18) * 0.9 + noise(x, y, 0.5) * 0.25;
		// the island: the sea round the edge, a beach before it
		const edge = Math.min(x, OW - 0.5 - x, y / 0.866, OH - 1 - y / 0.866) + (noise(x, y, 0.3) - 0.5) * 1.6;
		if (edge < 1.6) terrain[i] = WATER;
		else if (edge < 2.5) terrain[i] = SAND;
		lay(i, MOUNTAINS, LAKES);
	}

	// ── your first village: in the west, the whole village nearest there that is all grass ──
	const plan = makePlan(g);
	/** @type {number[][]} */
	const hexNodes = plan.centre.map(() => []);
	for (let i = 0; i < N; i++) hexNodes[plan.plotOf[i]].push(i);
	const [hx, hy] = oldAt(Math.round(11 * S), Math.round(21 * S));
	const want = { x: (hx - (OW - 0.5) / 2) * OLD, z: (hy - ((OH - 1) * 0.866) / 2) * OLD };
	const far = (/** @type {number} */ k) => Math.hypot(g.x(plan.centre[k]) - want.x, g.z(plan.centre[k]) - want.z);
	/** how much of a village is not grass (and how near the edge of the valley it is) */
	const rough = (/** @type {{ plots: number[] }} */ v) => v.plots.reduce((s, k) => s + hexNodes[k].filter((j) => terrain[j] !== GRASS).length, 0);
	const home = plan.villages
		.filter((v) => v.plots.length === 7 && v.plots.every((k) => plan.nbr[k].every((j) => j >= 0)))
		.reduce((a, b) => (rough(b) * 40 + far(b.centre) < rough(a) * 40 + far(a.centre) ? b : a));
	const homeHexes = new Set(home.plots);
	const atHome = (/** @type {number} */ i) => homeHexes.has(plan.plotOf[i]);
	/** the old node a world offset from your village center lands on @returns {[number, number]} */
	const fromHome = (/** @type {number} */ dx, /** @type {number} */ dz) => {
		const c = plan.centre[home.centre];
		const x = (g.x(c) + dx) / OLD + (OW - 0.5) / 2, y = (g.z(c) + dz) / OLD + ((OH - 1) * 0.866) / 2;
		const r = Math.round(y / 0.866);
		return [Math.round(x - (r & 1) * 0.5), r];
	};
	// a little way out of it: a pond to fish, and rocks
	const pond = /** @type {[number, number, number]} */ ([...fromHome(-1.06 * HS, 2.02 * HS), 2.4]);
	for (let i = 0; i < N; i++) if (!atHome(i)) lay(i, [], [pond]);
	ROCKS.push([...fromHome(1.73 * HS, -1.35 * HS), 1.8]);
	for (let i = 0; i < N; i++) {
		if (terrain[i] === WATER) {
			height[i] = -1.4;
			fish[i] = 4;
		} else if (terrain[i] === SAND) height[i] = 0.18 + noise(px(i), py(i), 0.5) * 0.12;
	}

	// woods and fields of rocks on the grass (as thick on the ground as on the old, coarser grid)
	for (let i = 0; i < N; i++) {
		if (terrain[i] !== GRASS || atHome(i)) continue;
		let tree = rand() < 0.016;
		for (const [cx, cy, R] of FORESTS) if (inBlob(i, cx, cy, R) > 0 && rand() < 0.36) tree = true;
		let rock = false;
		for (const [cx, cy, R] of ROCKS) if (inBlob(i, cx, cy, R) > 0 && rand() < 0.3) rock = true;
		if (rock) obj[i] = { k: 'rock', n: 4 + Math.floor(rand() * 4) };
		else if (tree) obj[i] = { k: 'tree', g: 0.75 + rand() * 0.25 };
		else if (rand() < 0.0035) obj[i] = { k: 'rock', n: 3 + Math.floor(rand() * 3) };
	}

	// your first village: open grass, level round each hex's middle and gently on out; two woods and a field of rocks
	// grow over three of its hexes (and on past them), and iron lies under the rocks, so a woodcutter and an iron mine
	// can start at home
	for (let i = 0; i < N; i++) {
		if (!atHome(i)) continue;
		const k = plan.plotOf[i], c = plan.centre[k], d = g.dist(i, c);
		terrain[i] = GRASS;
		ore[i] = 0;
		amount[i] = 0;
		obj[i] = null;
		const level = Math.min(Math.max(height[c], 0.4), 1.0);
		const w = Math.max(0, Math.min(1, (d - 5) / 3));
		height[i] = level + (height[i] - level) * w;
	}
	const outer = home.plots.filter((k) => k !== home.centre);
	const middle = plan.centre[home.centre];
	/** a patch grown round the outer side of one of your hexes, ragged at its edge, over its land and on out of the
	 * village (never into your other hexes), and at least so many in the hex itself
	 * @param {number} k @param {number} R @param {number} dense @param {number} least @param {() => any} make */
	const patch = (k, R, dense, least, make) => {
		const c = plan.centre[k];
		const x = g.x(c) + (g.x(c) - g.x(middle)) * 0.3, z = g.z(c) + (g.z(c) - g.z(middle)) * 0.3;
		const open = (/** @type {number} */ i) => terrain[i] === GRASS && !obj[i] && !plan.clear[i];
		for (const i of g.within(c, K + 2)) {
			if (!open(i) || (atHome(i) && plan.plotOf[i] !== k)) continue;
			const edge = R + (noise(px(i), py(i), 0.45) - 0.5) * 0.7 * R - Math.hypot(g.x(i) - x, g.z(i) - z);
			if (edge > 0 && rand() < dense) obj[i] = make();
		}
		const near = hexNodes[k].filter(open).sort((a, b) => Math.hypot(g.x(a) - x, g.z(a) - z) - Math.hypot(g.x(b) - x, g.z(b) - z));
		for (let n = hexNodes[k].filter((i) => obj[i]).length; n < least && near.length; n++) obj[/** @type {number} */ (near.shift())] = make();
	};
	for (const k of [outer[1], outer[2]]) patch(k, 0.62 * HS, 0.5, 34, () => ({ k: 'tree', g: 0.8 + rand() * 0.2 }));
	patch(outer[4], 0.5 * HS, 0.3, 12, () => ({ k: 'rock', n: 5 + Math.floor(rand() * 3) }));
	// the iron: round the first factory spot of the rocky hex, rich enough for a long while
	const lode = plan.spots[outer[4]][1];
	if (lode >= 0) for (const i of g.within(lode, 3)) if (terrain[i] === GRASS) (ore[i] = IRON), (amount[i] = 6 + Math.floor(rand() * 4));
	for (const k of [outer[0], outer[3], outer[5]]) for (const i of hexNodes[k]) if (!plan.clear[i] && !obj[i] && rand() < 0.03) obj[i] = { k: 'tree', g: 0.75 + rand() * 0.25 };
	const biome = biomes(g, plan, terrain, obj, ore);
	return { W, H, terrain, height, ore, amount, fish, obj, hq: plan.spots[home.centre][0], villages: [], biome };
}

/**
 * What each hex is good for, from the land that grew on it: a lake where its middle is under water; iron where a
 * factory spot has iron ore round it; stone where rocks lie; bare mountain where it is mostly rock;
 * water on a shore (a lake's or the sea's); forest where trees stand thick; else meadow.
 * @param {import('./hex.js').Grid} g
 * @param {import('./plots.js').Plan} plan
 * @param {number[]} terrain
 * @param {any[]} obj
 * @param {number[]} ore
 * @returns {string[]}
 */
export function biomes(g, plan, terrain, obj, ore) {
	/** @type {number[][]} */
	const nodes = plan.centre.map(() => []);
	for (let i = 0; i < g.N; i++) nodes[plan.plotOf[i]]?.push(i);
	return plan.centre.map((c, k) => {
		if (terrain[c] === WATER) return 'lake';
		const hex = nodes[k];
		const count = (/** @type {(j: number) => boolean} */ f) => hex.filter(f).length;
		const [, ...factories] = plan.spots[k];
		if (factories.some((j) => j >= 0 && terrain[j] !== WATER && g.within(j, 3).some((n) => ore[n] === IRON))) return 'iron';
		if (count((j) => obj[j]?.k === 'rock') >= 8) return 'stone';
		if (count((j) => terrain[j] === MOUNTAIN) * 2 >= hex.length) return 'mountain';
		if (count((j) => terrain[j] === WATER) >= 6) return 'water';
		if (count((j) => obj[j]?.k === 'tree') >= 25) return 'forest';
		return 'meadow';
	});
}
