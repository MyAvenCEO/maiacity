/*
 * FLORA'S GROWING — one of our plants ($lib/plants) grown for a world rather than for the plants viewer: at the
 * version the world was planted with, at a stage and a seed, made lighter (`lite`: no roots, fewer facets, a part of
 * its leaves each grown to fill in), and with everything under the soil cut away. What comes back is plain arrays by
 * material (its wood, its leaves and petals, its glossy fruit) and its measure, so it can be grown in a worker
 * (./flora.worker.js) and handed to the page.
 */
import { lite, material } from '$lib/plants/grow.js';
import { plantAt } from '$lib/plants/index.js';

/** how finely the plants are grown: near you, and further off (see DETAIL in $lib/plants/grow.js) */
export const TIERS = {
	near: { level: 0.3, roots: false, thin: 0.45 },
	mid: { level: 0.14, roots: false, thin: 0.16 }
};

/** @typedef {{ id: string, v: number, stage: number, seed: string }} Kind a plant at its version, stage and seed */
/**
 * @typedef {{ kind: 'body' | 'sheet' | 'gloss', position: Float32Array, normal: Float32Array, color: Float32Array, index: Uint32Array }} Part
 *   one material's worth of a plant
 */
/**
 * @typedef {{ parts: Part[], height: number, reach: number, foot: number, leaf: [number, number, number], tris: number }} Shape
 *   a plant grown for a world: its parts; how tall it stands, how far it reaches out, how thick it is at its foot (its
 *   trunk or its clump), and the colour of its leaves (for its stand-in far away)
 */

/** A plant's key, for the forest to know it by. @param {Kind} k */
export const keyOf = (k) => `${k.id}@${k.v}:${k.stage}:${k.seed}`;

/**
 * Grows a plant for a world at one of the tiers' detail.
 * @param {Kind} kind @param {'near' | 'mid'} tier @returns {Shape}
 */
export function grow(kind, tier) {
	const plant = plantAt(kind.id, kind.v);
	if (!plant) throw new Error(`no plant ${kind.id}@${kind.v}`);
	const group = lite(TIERS[tier], () => plant.grow(kind.stage, kind.seed));
	group.updateMatrixWorld(true);
	/** @type {Record<Part['kind'], { pos: number[], nor: number[], col: number[], idx: number[] }>} */
	const by = { body: { pos: [], nor: [], col: [], idx: [] }, sheet: { pos: [], nor: [], col: [], idx: [] }, gloss: { pos: [], nor: [], col: [], idx: [] } };
	let height = 0, reach = 0, foot = 0, tris = 0;
	const leaf = [0, 0, 0];
	let leaves = 0;
	group.traverse((o) => {
		const mesh = /** @type {import('three').Mesh} */ (o);
		if (!mesh.isMesh) return;
		const kind = mesh.material === material('sheet') ? 'sheet' : mesh.material === material('gloss') ? 'gloss' : 'body';
		const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
		const P = /** @type {Float32Array} */ (g.attributes.position.array);
		const N = /** @type {Float32Array} */ (g.attributes.normal?.array ?? new Float32Array(P.length));
		const C = /** @type {Float32Array} */ (g.attributes.color?.array ?? new Float32Array(P.length).fill(0.5));
		const I = g.index ? g.index.array : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
		const out = by[kind];
		/** where each kept vertex went */
		const moved = new Int32Array(P.length / 3).fill(-1);
		const keep = (/** @type {number} */ v) => {
			if (moved[v] >= 0) return moved[v];
			const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
			moved[v] = out.pos.length / 3;
			out.pos.push(x, y, z);
			out.nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
			out.col.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
			if (y > height) height = y;
			const h = Math.hypot(x, z);
			if (y > 0 && h > reach) reach = h;
			if (kind === 'body' && y > 0.05 && y < 0.5 && h < 0.8 && h > foot) foot = h;
			if (kind === 'sheet') {
				leaf[0] += C[v * 3];
				leaf[1] += C[v * 3 + 1];
				leaf[2] += C[v * 3 + 2];
				leaves++;
			}
			return moved[v];
		};
		for (let t = 0; t < I.length; t += 3) {
			const a = I[t], b = I[t + 1], c = I[t + 2];
			// under the soil: no one walking a forest sees it
			if (P[a * 3 + 1] < -0.01 && P[b * 3 + 1] < -0.01 && P[c * 3 + 1] < -0.01) continue;
			out.idx.push(keep(a), keep(b), keep(c));
			tris++;
		}
		g.dispose();
	});
	/** @type {Part[]} */
	const parts = [];
	for (const kind of /** @type {const} */ (['body', 'sheet', 'gloss'])) {
		const o = by[kind];
		if (!o.idx.length) continue;
		parts.push({ kind, position: new Float32Array(o.pos), normal: new Float32Array(o.nor), color: new Float32Array(o.col), index: new Uint32Array(o.idx) });
	}
	const n = Math.max(1, leaves);
	return { parts, height, reach, foot: foot || reach * 0.4, leaf: leaves ? [leaf[0] / n, leaf[1] / n, leaf[2] / n] : [0.3, 0.45, 0.2], tris };
}
