/**
 * SANDBOX 6 · THE VALLEY — one island of big hexes grown from a seed, the way the island of Sandbox 1 grows: the sea
 * round a ragged coast, and on the land one biome to a hex, in patches (a weighted Voronoi over scattered region
 * centres), so each biome comes back across the island in small and middling patches, never one great blob. Meadow
 * is most of it; forest, stone, iron, mountains and lakes are pockets you go looking for, and a hex on a lake's or the
 * sea's shore is water to fish from. The land of each hex follows its biome: trees in a forest, rocks on stone, rust-red
 * rock on iron, water in a lake.
 *
 * Your first village lies inland, with two forest hexes and a stone hex of its own; water and iron lie in the villages
 * round it, for you to found.
 *
 * Pure: the same seed grows the same valley.
 */
import { GRASS, IRON, MOUNTAIN, WATER } from './rules.js';
import { makeGrid, rng } from './hex.js';
import { makePlan } from './plots.js';

/** the valley's size in nodes: room for some forty villages and the sea round them */
export const W = 72, H = 60;

/** how common each biome is (relative shares of the region centres, and how far each region reaches) */
const SHARE = { meadow: 10, forest: 2.4, stone: 1.2, mountain: 0.9, iron: 0.5, lake: 0.65 };

/**
 * @typedef {object} Valley
 * @property {number} W
 * @property {number} H
 * @property {number[]} terrain GRASS, WATER or MOUNTAIN per node
 * @property {number[]} height metres
 * @property {number[]} ore 0 bare rock, 2 iron
 * @property {number[]} amount how much ore a mountain node holds
 * @property {number[]} fish fish in a water node
 * @property {({ k: 'tree', g: number } | { k: 'rock', n: number } | null)[]} obj trees and rocks
 * @property {number} hq where your first village center stands
 * @property {number[]} villages where the neighbours live (none: you play the valley on your own)
 * @property {string[]} biome what each hex is (./rules.js BIOMES)
 */

/** @param {number} seed @returns {Valley} */
export function growValley(seed) {
	const g = makeGrid(W, H);
	const N = W * H;
	const rand = rng(seed * 7919 + 13);
	// smooth value noise on the plane
	const lattice = Array.from({ length: 64 * 64 }, () => rand());
	const noise = (/** @type {number} */ x, /** @type {number} */ y) => {
		const x0 = Math.floor(x), y0 = Math.floor(y);
		const tx = x - x0, ty = y - y0;
		const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
		const L = (/** @type {number} */ a, /** @type {number} */ b) => lattice[(((a % 64) + 64) % 64) * 64 + (((b % 64) + 64) % 64)];
		const a = L(x0, y0) + (L(x0 + 1, y0) - L(x0, y0)) * sx;
		const b = L(x0, y0 + 1) + (L(x0 + 1, y0 + 1) - L(x0, y0 + 1)) * sx;
		return a + (b - a) * sy;
	};
	const plan = makePlan(g);
	const P = plan.centre.length;
	const hx = (/** @type {number} */ k) => g.x(plan.centre[k]), hz = (/** @type {number} */ k) => g.z(plan.centre[k]);
	const halfX = Math.max(...plan.centre.map((c) => Math.abs(g.x(c)))), halfZ = Math.max(...plan.centre.map((c) => Math.abs(g.z(c))));
	/** hexes apart */
	const apart = (/** @type {number} */ a, /** @type {number} */ b) => g.dist(plan.centre[a], plan.centre[b]) / 4;

	// ── the island: land hex by hex, the sea round a ragged coast (every hex at the map's edge is sea) ──
	const whole = (/** @type {number} */ k) => plan.nbr[k].every((j) => j >= 0);
	const land = plan.centre.map((_, k) => {
		if (!whole(k)) return false;
		const x = hx(k), z = hz(k);
		const edge = Math.min(1 - Math.abs(x) / halfX, 1 - Math.abs(z) / halfZ);
		return edge + (noise(x * 0.045 + 7, z * 0.045 + 3) - 0.5) * 0.28 > 0.13;
	});
	// no single sea hexes inside the land, no single land hexes out at sea
	for (let k = 0; k < P; k++) {
		const n = plan.nbr[k].filter((j) => j >= 0 && land[j]).length;
		if (!land[k] && whole(k) && n >= 5) land[k] = true;
		else if (land[k] && n <= 1) land[k] = false;
	}
	const landHexes = plan.centre.map((_, k) => k).filter((k) => land[k]);
	const inland = (/** @type {number} */ k) => land[k] && plan.nbr[k].every((j) => j >= 0 && land[j]);

	// ── the biomes: many region centres, each a biome, a hex taking the nearest (weighted, a little jittered) ──
	const kinds = /** @type {(keyof typeof SHARE)[]} */ (Object.keys(SHARE));
	const total = kinds.reduce((s, b) => s + SHARE[b], 0);
	const count = Math.max(14, Math.round(landHexes.length / 7));
	/** @type {(keyof typeof SHARE)[]} */
	const picks = ['lake', 'forest', 'stone', 'mountain', 'iron'];
	while (picks.length < count) {
		let r = rand() * total;
		let b = kinds[0];
		for (const x of kinds) if ((r -= SHARE[x]) <= 0) {
			b = x;
			break;
		}
		picks.push(b);
	}
	/** @type {{ k: number, biome: string, weight: number }[]} */
	const regions = [];
	for (const biome of picks) {
		const pool = biome === 'lake' ? landHexes.filter(inland) : landHexes;
		let best = pool[Math.floor(rand() * pool.length)];
		for (let t = 0; t < 16; t++) {
			const k = pool[Math.floor(rand() * pool.length)];
			best = k;
			if (regions.every((r) => apart(r.k, k) >= 2.5)) break;
		}
		// meadow reaches furthest; lakes stay ponds and meres
		const pull = biome === 'lake' ? 0.5 : biome === 'meadow' ? 1.25 : 0.62 + 0.05 * SHARE[biome];
		regions.push({ k: best, biome, weight: (0.8 + rand() * 0.5) * pull });
	}
	const biome = plan.centre.map((_, k) => {
		if (!land[k]) return 'sea';
		let best = regions[0], bd = Infinity;
		for (const r of regions) {
			const d = (apart(k, r.k) + (rand() - 0.5) * 0.3) / r.weight;
			if (d < bd) (bd = d), (best = r);
		}
		return best.biome;
	});
	// lakes only inland
	for (const k of landHexes) if (biome[k] === 'lake' && !inland(k)) biome[k] = 'meadow';

	// ── your first village: a whole village inland, toward the west, of meadow, with two forest hexes and a stone hex ──
	const good = plan.villages
		.map((v, i) => ({ v, i }))
		.filter(({ v }) => v.plots.length === 7 && v.plots.every((k) => inland(k) && plan.nbr[k].every((j) => biome[j] !== 'lake')));
	const home = good.reduce((a, b) => (score(b.v) > score(a.v) ? b : a), good[0]);
	function score(/** @type {{ centre: number }} */ v) {
		const x = hx(v.centre) / halfX, z = hz(v.centre) / halfZ;
		return -Math.hypot(x + 0.35, z * 1.2);
	}
	const outer = home.v.plots.filter((k) => k !== home.v.centre);
	for (const k of home.v.plots) biome[k] = 'meadow';
	biome[outer[0]] = 'forest';
	biome[outer[1]] = 'forest';
	biome[outer[3]] = 'stone';
	// the villages round it hold the water and the iron you will want (and wood and stone besides)
	const around = home.v.plots.flatMap((k) => plan.nbr[k]).filter((k) => k >= 0 && !home.v.plots.includes(k) && land[k]);
	const ring = [...new Set(around)].sort((a, b) => a - b);
	const need = (/** @type {string} */ b, /** @type {number} */ far) => {
		const near = landHexes.filter((k) => !home.v.plots.includes(k) && apart(k, home.v.centre) <= far);
		if (near.some((k) => biome[k] === b)) return;
		const k = ring[Math.floor(rand() * ring.length)];
		if (k !== undefined) biome[k] = b;
	};
	need('iron', 4.5);
	need('lake', 4.5);
	for (const k of ring) if (biome[k] === 'lake' && !inland(k)) biome[k] = 'meadow';
	// a land hex on a lake's or the sea's shore is water to fish from
	for (const k of landHexes) {
		if (biome[k] !== 'meadow' || home.v.plots.includes(k)) continue;
		const lake = plan.nbr[k].some((j) => j >= 0 && biome[j] === 'lake');
		const sea = plan.nbr[k].filter((j) => j < 0 || biome[j] === 'sea').length;
		if (lake || (sea >= 2 && noise(hx(k) * 0.08 + 31, hz(k) * 0.08) > 0.62)) biome[k] = 'water';
	}

	// ── the land of every node, from its hex ──
	const terrain = Array(N).fill(GRASS);
	const height = Array(N).fill(0);
	const ore = Array(N).fill(0);
	const amount = Array(N).fill(0);
	const fish = Array(N).fill(0);
	/** @type {Valley['obj']} */
	const obj = Array(N).fill(null);
	/** each hex's own height: land a little up and down, mountains and iron raised, water down */
	const tile = plan.centre.map((_, k) => {
		const b = biome[k];
		if (b === 'sea' || b === 'lake') return -1.4;
		if (b === 'mountain') return 1.5;
		if (b === 'iron') return 1.05;
		return 0.25 + Math.round(noise(hx(k) * 0.06 + 11, hz(k) * 0.06 + 5) * 4) * 0.08;
	});
	for (let i = 0; i < N; i++) {
		const k = plan.plotOf[i], b = biome[k];
		height[i] = tile[k];
		if (b === 'sea' || b === 'lake') {
			terrain[i] = WATER;
			fish[i] = 4;
		} else if (b === 'mountain') terrain[i] = MOUNTAIN;
	}
	for (let k = 0; k < P; k++) {
		const b = biome[k], [house, ...factories] = plan.spots[k];
		const corners = [...factories, ...plan.free[k]].filter((j) => j >= 0);
		if (b === 'iron')
			// the hex's rock holds the iron: its factory spots and free corners (its middle, its house spot and its ways stay grass)
			for (const j of corners) {
				terrain[j] = MOUNTAIN;
				ore[j] = IRON;
				amount[j] = 3 + Math.floor(rand() * 4);
			}
		else if (b === 'forest') {
			// trees everywhere but its middle and its house spot (a path through fells those in its way)
			for (let i = 0; i < N; i++) if (plan.plotOf[i] === k && i !== plan.centre[k] && i !== house) obj[i] = { k: 'tree', g: 0.75 + rand() * 0.25 };
		} else if (b === 'stone') for (const j of corners) obj[j] = { k: 'rock', n: 5 + Math.floor(rand() * 3) };
		else if (b === 'meadow' || b === 'water')
			for (const j of plan.free[k]) {
				if (j < 0) continue;
				const r = rand();
				if (r < 0.14) obj[j] = { k: 'tree', g: 0.75 + rand() * 0.25 };
				else if (r < 0.18) obj[j] = { k: 'rock', n: 3 + Math.floor(rand() * 3) };
			}
	}
	// your first village is open meadow but for its forest and stone hexes
	for (let i = 0; i < N; i++) {
		const k = plan.plotOf[i];
		if (home.v.plots.includes(k) && biome[k] === 'meadow') obj[i] = null;
	}
	return { W, H, terrain, height, ore, amount, fish, obj, hq: plan.spots[home.v.centre][0], villages: [], biome };
}
