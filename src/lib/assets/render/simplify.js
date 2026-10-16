// @ts-nocheck — plain JS, trusted: runs in the page's worker (./simplify.worker.js), or in the page
/*
 * A SHAPE MADE LIGHTER — the lower levels of detail of an asset (./lod.js) made from a finer level's own checked
 * geometry (./prepare.js) by meshoptimizer's simplifier, the one three.js ships
 * (three/addons/libs/meshopt_simplifier.module.js: library code of ours, never the recipe's). Every asset whose recipe
 * takes no `detail` (a machine, a thing, an actor) gets its levels 1 and 2 so; a plant keeps its recipe's own.
 *
 * The drawings of a level cross in as plain arrays (each its attributes and its index, how often it is drawn and how
 * big it is) and come out the same, lighter:
 *
 * - a part smaller than the level draws (a pixel where it is drawn biggest) is left out, and one already tiny (a box,
 *   a card) kept as it is;
 * - the rest share what the level may cost, each as much of it as it has of the triangles;
 * - each drawing's corners are first welded where they are the same corner (the same place, normal, colour and
 *   picture's place, near enough): a build often comes as loose triangles, each with corners of its own, and to a
 *   simplifier every edge of a loose triangle is an edge of the shape it may not take away;
 * - then it is simplified to its share, the edges whose loss shows least taken first, its normals, colours and
 *   picture's places weighed with its shape, a seam where they change kept as a seam, its open edges kept to their
 *   line, and the small loose parts of it (a bolt, a hinge) dropped once they are smaller than the error it may make;
 * - a drawing whose corners meet so that the careful pass may take little away (a hard edge at every corner, as a
 *   machine's parts have) is passed again allowed across its seams, the attributes still weighed, and only then, if
 *   it must, allowed to stray further (STRETCH); one passed so is shaded again from the faces it has left (`reshade`);
 * - and what one drawing could not give up, the others that could give up a little more of, once.
 *
 * What it leaves out: the bones' weights (a copy drawn with its bones is a tree of its own, from level 0's build,
 * ./index.js) and the blend shapes (a pose is baked into the shape before, ./prepare.js).
 */
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { STRETCH } from './lod.js';

/** the simplifier's code, made ready once */
export const ready = MeshoptSimplifier.ready;

/** what a lower level leaves out: the bones' weights, which only a posed copy, drawn from level 0's tree, uses */
export const LEFT = new Set(['skinIndex', 'skinWeight']);

/**
 * How much a change in each attribute weighs against a change of the shape, as meshoptimizer weighs them (a change of
 * 1 in the attribute as much as one of the drawing's own size): a normal turned the most, a colour less, a picture's
 * place least (a texture's tiling runs to many units).
 */
export const WEIGHTS = { normal: 0.5, color: 0.25, uv: 0.02 };

/** a drawing this light (triangles) or lighter is kept as it is: there is nothing in a box or a card to take away */
export const TINY = 24;

const maxOf = (A) => (A instanceof Uint8Array ? 255 : A instanceof Uint16Array ? 65535 : A instanceof Int8Array ? 127 : A instanceof Int16Array ? 32767 : 1);

/** an attribute's components as floats */
const floats = (a) => (a.array instanceof Float32Array && !a.normalized ? a.array : Float32Array.from(a.array, (v) => (a.normalized ? v / maxOf(a.array) : v)));

/**
 * A shape's corners welded where they are the same, near enough: every attribute it keeps, rounded to its grain, the
 * same. Its triangles that come to nothing (two corners one) are left out.
 * @param {{ attributes: Record<string, { array: ArrayLike<number>, itemSize: number, normalized?: boolean }>, index: ArrayLike<number> }} shape
 * @returns {{ attributes: Record<string, { array: any, itemSize: number, normalized: boolean }>, index: Uint32Array, count: number }}
 */
export function weldCorners(shape) {
	const names = Object.keys(shape.attributes).filter((k) => !LEFT.has(k));
	const P = shape.attributes.position;
	const n = P.array.length / P.itemSize;
	let lo = Infinity, hi = -Infinity;
	for (let i = 0; i < P.array.length; i++) {
		const v = P.array[i];
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	// each attribute's grain: a millionth of the shape's size for its place, about a tenth of a degree for a normal
	const grain = { position: Math.max(1e-7, (hi - lo) * 1e-6), normal: 1 / 512, tangent: 1 / 512, color: 1 / 512 };
	const lists = names.map((k) => {
		const a = shape.attributes[k];
		return { A: a.array, size: a.itemSize, q: 1 / (grain[k] ?? 1e-4), scale: a.normalized ? 1 / maxOf(a.array) : 1 };
	});
	const width = lists.reduce((s, l) => s + l.size, 0);
	const keys = new Int32Array(n * width);
	const hash = new Uint32Array(n);
	for (let v = 0; v < n; v++) {
		let h = 2166136261, o = v * width;
		for (const l of lists)
			for (let c = 0; c < l.size; c++) {
				const q = Math.round(l.A[v * l.size + c] * l.scale * l.q) | 0;
				keys[o++] = q;
				h = Math.imul(h ^ q, 16777619);
			}
		hash[v] = h >>> 0;
	}
	// an open table of the corners kept, by their rounded attributes
	let size = 1;
	while (size < n * 2) size <<= 1;
	const table = new Int32Array(size).fill(-1);
	const remap = new Uint32Array(n);
	const kept = [];
	for (let v = 0; v < n; v++) {
		for (let s = hash[v] & (size - 1); ; s = (s + 1) & (size - 1)) {
			const u = table[s];
			if (u < 0) {
				table[s] = v;
				remap[v] = kept.push(v) - 1;
				break;
			}
			let same = hash[u] === hash[v];
			for (let c = 0; same && c < width; c++) same = keys[u * width + c] === keys[v * width + c];
			if (same) {
				remap[v] = remap[u];
				break;
			}
		}
	}
	const attributes = {};
	for (const k of names) {
		const a = shape.attributes[k];
		const to = new a.array.constructor(kept.length * a.itemSize);
		for (let i = 0; i < kept.length; i++) for (let c = 0; c < a.itemSize; c++) to[i * a.itemSize + c] = a.array[kept[i] * a.itemSize + c];
		attributes[k] = { array: to, itemSize: a.itemSize, normalized: !!a.normalized };
	}
	const I = shape.index;
	const index = new Uint32Array(I.length - (I.length % 3));
	let m = 0;
	for (let t = 0; t + 2 < I.length; t += 3) {
		const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
		if (a === b || b === c || a === c) continue;
		index[m++] = a;
		index[m++] = b;
		index[m++] = c;
	}
	return { attributes, index: index.slice(0, m), count: kept.length };
}

/** the attributes the simplifier weighs, side by side as floats, and their weights */
function weighed(attributes, count) {
	const parts = [];
	for (const [k, w] of Object.entries(WEIGHTS)) {
		const a = attributes[k];
		if (a && w) parts.push({ a: floats(a), size: Math.min(3, a.itemSize), stride: a.itemSize, w });
	}
	const width = parts.reduce((s, p) => s + p.size, 0);
	const packed = new Float32Array(count * width);
	const weights = [];
	let o = 0;
	for (const p of parts) {
		for (let i = 0; i < count; i++) for (let c = 0; c < p.size; c++) packed[i * width + o + c] = p.a[i * p.stride + c];
		for (let c = 0; c < p.size; c++) weights.push(p.w);
		o += p.size;
	}
	return { packed, width, weights };
}

/** a welded shape's triangles `index` as a shape of its own, with only the corners they use */
function compact(welded, index) {
	const to = new Int32Array(welded.count).fill(-1);
	const used = [];
	const out = new Uint32Array(index.length);
	for (let i = 0; i < index.length; i++) {
		const v = index[i];
		if (to[v] < 0) to[v] = used.push(v) - 1;
		out[i] = to[v];
	}
	const attributes = {};
	for (const [k, a] of Object.entries(welded.attributes)) {
		const A = new a.array.constructor(used.length * a.itemSize);
		for (let i = 0; i < used.length; i++) for (let c = 0; c < a.itemSize; c++) A[i * a.itemSize + c] = a.array[used[i] * a.itemSize + c];
		attributes[k] = { array: A, itemSize: a.itemSize, normalized: a.normalized };
	}
	return { attributes, index: used.length <= 65535 ? Uint16Array.from(out) : out };
}

/** how sharply two faces may meet and still be shaded as one smooth surface, once a shape is shaded again (radians) */
export const CREASE = (50 * Math.PI) / 180;

/**
 * A welded shape's triangles `index`, simplified across its seams, shaded again where what is left of it calls for: a
 * corner where two faces were once a hard edge (a machine's panel against the next) may have been folded across it,
 * and its old normal then lights the faces on the other side wrongly (a dark crease, a pale band). A corner of a
 * triangle whose normal still lies within CREASE of the triangle's own keeps it (a curved panel keeps the smooth
 * shading it was made with); any other takes the faces round its place that meet its own at less than CREASE, weighed
 * by their area. The corners of one welded corner with the same normal are one corner again, keeping its colour and
 * picture's place.
 */
export function reshade(welded, index) {
	const P = floats(welded.attributes.position);
	const n = welded.count, faces = index.length / 3;
	// each corner's place: the corners of the welded shape that stand at the same point (its seams) are one place
	const bits = new Uint32Array(P.buffer, P.byteOffset, n * 3);
	let size = 1;
	while (size < n * 2) size <<= 1;
	const table = new Int32Array(size).fill(-1);
	const place = new Int32Array(n);
	let places = 0;
	for (let v = 0; v < n; v++) {
		const h = (Math.imul(bits[v * 3], 73856093) ^ Math.imul(bits[v * 3 + 1], 19349663) ^ Math.imul(bits[v * 3 + 2], 83492791)) >>> 0;
		for (let s = h & (size - 1); ; s = (s + 1) & (size - 1)) {
			const u = table[s];
			if (u < 0) {
				table[s] = v;
				place[v] = places++;
				break;
			}
			if (bits[u * 3] === bits[v * 3] && bits[u * 3 + 1] === bits[v * 3 + 1] && bits[u * 3 + 2] === bits[v * 3 + 2]) {
				place[v] = place[u];
				break;
			}
		}
	}
	// each face's normal, as long as its area (and of length one), and the faces round each place
	const area = new Float32Array(faces * 3), unit = new Float32Array(faces * 3);
	const counts = new Int32Array(places + 1);
	for (let f = 0; f < faces; f++) {
		const a = index[f * 3] * 3, b = index[f * 3 + 1] * 3, c = index[f * 3 + 2] * 3;
		const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
		const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
		const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
		const l = Math.hypot(x, y, z) || 1;
		area[f * 3] = x;
		area[f * 3 + 1] = y;
		area[f * 3 + 2] = z;
		unit[f * 3] = x / l;
		unit[f * 3 + 1] = y / l;
		unit[f * 3 + 2] = z / l;
		for (let c2 = 0; c2 < 3; c2++) counts[place[index[f * 3 + c2]] + 1]++;
	}
	for (let p = 0; p < places; p++) counts[p + 1] += counts[p];
	const round = new Int32Array(index.length), fill = counts.slice(0, places);
	for (let i = 0; i < index.length; i++) round[fill[place[index[i]]]++] = Math.floor(i / 3);
	// each corner's normal, and the corners kept: one for each welded corner and normal
	const cos = Math.cos(CREASE);
	const was = welded.attributes.normal ? floats(welded.attributes.normal) : null, stride = welded.attributes.normal?.itemSize ?? 3;
	const key = new Map();
	const from = [], normals = [];
	const out = new Uint32Array(index.length);
	for (let i = 0; i < index.length; i++) {
		const f = Math.floor(i / 3), v = index[i], p = place[v];
		if (was) {
			const x = was[v * stride], y = was[v * stride + 1], z = was[v * stride + 2], l = Math.hypot(x, y, z);
			if (l > 0 && (x * unit[f * 3] + y * unit[f * 3 + 1] + z * unit[f * 3 + 2]) / l >= cos) {
				const k = `${v}`;
				let at = key.get(k);
				if (at === undefined) {
					key.set(k, (at = from.push(v) - 1));
					normals.push(x / l, y / l, z / l);
				}
				out[i] = at;
				continue;
			}
		}
		let x = 0, y = 0, z = 0;
		for (let k = counts[p]; k < counts[p + 1]; k++) {
			const g = round[k];
			if (unit[g * 3] * unit[f * 3] + unit[g * 3 + 1] * unit[f * 3 + 1] + unit[g * 3 + 2] * unit[f * 3 + 2] < cos) continue;
			x += area[g * 3];
			y += area[g * 3 + 1];
			z += area[g * 3 + 2];
		}
		const l = Math.hypot(x, y, z);
		if (l > 0) (x /= l), (y /= l), (z /= l);
		else (x = unit[f * 3]), (y = unit[f * 3 + 1]), (z = unit[f * 3 + 2]);
		const k = `${v},${Math.round(x * 1024)},${Math.round(y * 1024)},${Math.round(z * 1024)}`;
		let at = key.get(k);
		if (at === undefined) {
			key.set(k, (at = from.push(v) - 1));
			normals.push(x, y, z);
		}
		out[i] = at;
	}
	const attributes = {};
	for (const [k, a] of Object.entries(welded.attributes)) {
		const A = new a.array.constructor(from.length * a.itemSize);
		for (let i = 0; i < from.length; i++) for (let c = 0; c < a.itemSize; c++) A[i * a.itemSize + c] = a.array[from[i] * a.itemSize + c];
		attributes[k] = { array: A, itemSize: a.itemSize, normalized: a.normalized };
	}
	if (attributes.normal) {
		const N = attributes.normal, s = N.normalized ? maxOf(N.array) : 1;
		for (let i = 0; i < from.length; i++) for (let c = 0; c < 3; c++) N.array[i * N.itemSize + c] = normals[i * 3 + c] * s;
	}
	return { attributes, index: from.length <= 65535 ? Uint16Array.from(out) : out };
}

/** a shape made ready to simplify, once for all its levels */
function readied(shape) {
	const welded = weldCorners(shape);
	return { welded, positions: floats(welded.attributes.position), ...weighed(welded.attributes, welded.count) };
}

/**
 * A readied shape simplified to `tris` triangles, keeping within `error` metres where it can (see the passes above).
 * @returns {{ index: Uint32Array, error: number, pass: number }}
 */
function simplified(r, tris, error) {
	const target = Math.max(3, Math.min(r.welded.index.length, Math.floor(tris) * 3));
	if (target >= r.welded.index.length) return { index: r.welded.index, error: 0, pass: 0 };
	const run = (e, flags) => MeshoptSimplifier.simplifyWithAttributes(r.welded.index, r.positions, 3, r.packed, r.width, r.weights, null, target, e, ['ErrorAbsolute', 'Prune', ...flags]);
	let best = null;
	const passes = [[error, []], [error, ['Permissive']], [error * STRETCH, ['Permissive']]];
	for (let p = 0; p < passes.length; p++) {
		const [index, got] = run(...passes[p]);
		if (!best || index.length < best.index.length) best = { index, error: got, pass: p + 1 };
		// near enough its share: done
		if (index.length <= target * 1.02 + 3) break;
	}
	return best;
}

/**
 * A level's drawings lowered to each plan: for each, every drawing kept, left out or lighter, and what it came to.
 * @param {{ attributes: Record<string, any>, index: ArrayLike<number>, tris: number, n: number, size: number }[]} draws
 *   each drawing of the level: its shape, its triangles, how often one copy draws it, and the diameter of its ball at
 *   the biggest it is drawn (m)
 * @param {{ budget: number, error: number, smallest: number }[]} plans each lower level: its triangles at most
 *   (./lod.js `budgetOf`), how far it may stray (m, `errorOf`) and the smallest part it draws (m, `smallestOf`)
 * @param {() => Promise<void>} [pause] waited for between two drawings (in the page, a frame's room)
 * @returns {Promise<{ draws: ('same' | null | { attributes: Record<string, any>, index: Uint16Array | Uint32Array, tris: number })[], tris: number, error: number, passes: number[] }[]>}
 *   'same' a drawing kept as it is, null one left out
 */
export async function lowerDraws(draws, plans, pause) {
	await ready;
	/** each drawing readied once, when a plan first needs it */
	const made = new Map();
	const readyOf = async (i) => {
		if (!made.has(i)) {
			if (pause) await pause();
			made.set(i, readied(draws[i]));
		}
		return made.get(i);
	};
	const out = [];
	for (const plan of plans) {
		const result = draws.map((d) => (d.size < plan.smallest ? null : 'same'));
		const cost = (i) => draws[i].tris * draws[i].n;
		const open = draws.map((_, i) => i).filter((i) => result[i] && draws[i].tris > TINY);
		const fixed = draws.reduce((s, d, i) => s + (result[i] && d.tris <= TINY ? cost(i) : 0), 0);
		const whole = open.reduce((s, i) => s + cost(i), 0);
		const level = { draws: result, tris: fixed + whole, error: 0, passes: [0, 0, 0, 0] };
		if (fixed + whole > plan.budget && open.length) {
			const share = Math.max(0, plan.budget - fixed) / whole;
			const got = new Map();
			const lower = async (i, tris) => {
				const r = await readyOf(i);
				if (pause) await pause();
				const g = simplified(r, tris, plan.error);
				got.set(i, { ...g, want: tris, tris: g.pass === 0 ? draws[i].tris : g.index.length / 3 });
			};
			for (const i of open) await lower(i, Math.max(1, draws[i].tris * share));
			// what one could not give up, those that could give a little more of, once
			const sum = () => fixed + open.reduce((s, i) => s + got.get(i).tris * draws[i].n, 0);
			const over = sum() - plan.budget;
			if (over > 0) {
				const able = open.filter((i) => got.get(i).pass > 0 && got.get(i).tris <= got.get(i).want * 1.02 + 1);
				const room = able.reduce((s, i) => s + got.get(i).tris * draws[i].n, 0);
				if (room > over) for (const i of able) await lower(i, Math.max(1, got.get(i).tris * (1 - over / room)));
			}
			for (const i of open) {
				const g = got.get(i);
				level.passes[g.pass]++;
				level.error = Math.max(level.error, g.error);
				// folded across its seams (the second and third passes): shaded again from its faces
				const shape = g.pass === 0 ? null : g.pass > 1 && made.get(i).welded.attributes.normal ? reshade(made.get(i).welded, g.index) : compact(made.get(i).welded, g.index);
				result[i] = shape ? { ...shape, tris: g.tris } : 'same';
			}
			level.tris = sum();
		}
		out.push(level);
	}
	return out;
}
