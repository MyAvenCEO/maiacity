// @ts-nocheck — plain JS, trusted: runs in the page's worker (./simplify.worker.js), or in the page
/*
 * A SHAPE MADE LIGHTER — the lower levels of detail of an asset (./lod.js) made from a finer level's own checked
 * geometry (./prepare.js) by meshoptimizer's simplifier, the one three.js ships
 * (three/addons/libs/meshopt_simplifier.module.js: library code of ours, never the recipe's). Every asset whose recipe
 * takes no `detail` (a machine, a thing, an actor) gets its levels 1 and 2 so. A plant keeps its recipe's own, and
 * one of them over its ceiling (a big tree's crown at detail 0.1) is brought under it here, every piece of it kept.
 *
 * The drawings of a level cross in as plain arrays (each its attributes and its index, how often and where it is
 * drawn, how big, whether it is seen through) and come out the same, lighter:
 *
 * - each drawing's corners are first welded where they are the same corner (the same place, normal, colour and
 *   picture's place, near enough): a build often comes as loose triangles, each with corners of its own, and to a
 *   simplifier every edge of a loose triangle is an edge of the shape it may not take away. A triangle with two corners
 *   at one place (a pointed leaf's tip, a tube's closed end) has no area, and is left out whatever else it carries;
 * - a drawing smaller than the level draws (a pixel where it is drawn biggest) is left out, one already tiny and drawn
 *   once (a box, a card) kept as it is, and so is each loose piece of a drawing smaller than that (a bolt's thread);
 * - a drawing drawn many times (a tent's poles, a pickup's wheel nuts) is simplified alone, to as much of the level as
 *   it has of the triangles; every drawing drawn once is simplified with all the others, as one shape: what one could
 *   not give up, another gives, the edges whose loss shows least taken first wherever they are. The drawings are set
 *   apart for it, so none takes another's corners, and where two of them meet (a deck's planks against its rim) the
 *   corners on that edge do not move, so no crack opens between them; an open edge that meets nothing (a panel's
 *   rim, a cloth's hem) may move along itself as any other;
 * - its normals, colours and picture's places are weighed with its shape as meshoptimizer weighs them, but each loose
 *   piece's against its own size, not the whole drawing's: a wiper's shading counts for as much on a wiper as a door's
 *   on a door, so a small part is neither kept round at any cost nor folded flat for free;
 * - each loose piece at least KEEP pixels across keeps its outer corners (the furthest along each axis): it may come
 *   out coarse, never gone. One the simplifier still folds to nothing (a thin rod, flattened to a line) is put back
 *   alone, as plain as the level's error lets it (`survived`);
 * - a shape whose corners meet so that the careful pass may take little away (a hard edge at every corner, as a
 *   machine's parts have) is passed again allowed across its seams, and then allowed to stray further (STRETCH), but
 *   only if that brings it to its share; one passed so is shaded again from the faces it has left (`reshade`);
 * - a level still over its share after that (a shape of many pieces, each as plain as it can be) is looked at from
 *   all round (`seenOf`): the pieces never seen from outside it (a battery's cells inside their modules, a tent's frame
 *   under its cover) are left out, and it is made again without them;
 * - and a level still over its ceiling (a coop's planks, six thousand boxes) is allowed to stray further, a step at a
 *   time, its smallest pieces left out, until it is not. Under its ceiling, such a shape keeps its pieces and stays
 *   over its share: leaving them out would show.
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
 * 1 in the attribute as much as one of the size of the loose piece it is on, `weighed`): a normal turned the most, a
 * colour less, a picture's place least (a texture's tiling runs to many units).
 */
export const WEIGHTS = { normal: 0.5, color: 0.25, uv: 0.02 };

/**
 * a drawing this light (triangles) or lighter, drawn once, is kept as it is: there is nothing in a box or a card to
 * take away worth the trouble. One drawn many times (a tent's poles, a pickup's wheel nuts) is weighed by all its copies.
 */
export const TINY = 24;

const maxOf = (A) => (A instanceof Uint8Array ? 255 : A instanceof Uint16Array ? 65535 : A instanceof Int8Array ? 127 : A instanceof Int16Array ? 32767 : 1);

/** an attribute's components as floats */
const floats = (a) => (a.array instanceof Float32Array && !a.normalized ? a.array : Float32Array.from(a.array, (v) => (a.normalized ? v / maxOf(a.array) : v)));

/**
 * a loose piece this many pixels across or more (where its level is drawn biggest) keeps its outer corners, and is put
 * back if the simplifier folds it away: a part several pixels big there (a mirror, a wiper, a lamp) is seen
 */
export const KEEP = 3;

/**
 * How a kind is looked at to find the pieces of it never seen (`seenOf`): from SIDES directions spread over the sphere,
 * each a picture `px` pixels across its ball, the size it is drawn at where level 2 hands over and more.
 */
export const SEEN = { px: 384, sides: 42 };

/** a level this much over its share (a times) has its never seen pieces looked for, and left out */
export const OVER = 1.05;

/**
 * A shape's corners welded where they are the same, near enough: every attribute it keeps, rounded to its grain, the
 * same. Its triangles that come to nothing (two corners at one place, whatever else they carry: no area) are left
 * out. And each corner's place: the corners at one point, whatever their other attributes (`place`, of `places`).
 * @param {{ attributes: Record<string, { array: ArrayLike<number>, itemSize: number, normalized?: boolean }>, index: ArrayLike<number> }} shape
 * @returns {{ attributes: Record<string, { array: any, itemSize: number, normalized: boolean }>, index: Uint32Array, count: number, place: Int32Array, places: number }}
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
	// each kept corner's place, by its position alone (its keys from `po` on, rounded as above)
	const pw = P.itemSize;
	let po = 0;
	for (const k of names) {
		if (k === 'position') break;
		po += shape.attributes[k].itemSize;
	}
	const place = new Int32Array(kept.length);
	const at = new Int32Array(size).fill(-1);
	let places = 0;
	for (let i = 0; i < kept.length; i++) {
		const o = kept[i] * width + po;
		let h = 2166136261;
		for (let c = 0; c < pw; c++) h = Math.imul(h ^ keys[o + c], 16777619);
		for (let s = (h >>> 0) & (size - 1); ; s = (s + 1) & (size - 1)) {
			const u = at[s];
			if (u < 0) {
				at[s] = i;
				place[i] = places++;
				break;
			}
			let same = true;
			for (let c = 0; same && c < pw; c++) same = keys[kept[u] * width + po + c] === keys[o + c];
			if (same) {
				place[i] = place[u];
				break;
			}
		}
	}
	const I = shape.index;
	const index = new Uint32Array(I.length - (I.length % 3));
	let m = 0;
	for (let t = 0; t + 2 < I.length; t += 3) {
		const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
		if (place[a] === place[b] || place[b] === place[c] || place[a] === place[c]) continue;
		index[m++] = a;
		index[m++] = b;
		index[m++] = c;
	}
	return { attributes, index: index.slice(0, m), count: kept.length, place, places };
}

/**
 * A welded shape's loose pieces: the corners its triangles join (at one place, whatever their attributes) are one
 * piece. Each corner's piece, and each piece's box (of the corners its triangles use), its size (the box's diagonal)
 * and its extent (the box's longest side).
 */
export function piecesOf(welded) {
	const { place, places, index } = welded;
	const parent = new Int32Array(places);
	for (let i = 0; i < places; i++) parent[i] = i;
	const find = (x) => {
		while (parent[x] !== x) x = parent[x] = parent[parent[x]];
		return x;
	};
	for (let t = 0; t < index.length; t += 3) {
		const a = find(place[index[t]]), b = find(place[index[t + 1]]);
		if (b !== a) parent[b] = a;
		const c = find(place[index[t + 2]]);
		if (c !== a) parent[c] = a;
	}
	const id = new Int32Array(places).fill(-1);
	let count = 0;
	const piece = new Int32Array(welded.count);
	for (let v = 0; v < welded.count; v++) {
		const r = find(place[v]);
		if (id[r] < 0) id[r] = count++;
		piece[v] = id[r];
	}
	const P = floats(welded.attributes.position);
	const box = new Float32Array(count * 6);
	for (let k = 0; k < count; k++) box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], k * 6);
	const used = new Uint8Array(welded.count);
	for (let i = 0; i < index.length; i++) used[index[i]] = 1;
	for (let v = 0; v < welded.count; v++) {
		if (!used[v]) continue;
		const o = piece[v] * 6;
		for (let c = 0; c < 3; c++) {
			const x = P[v * 3 + c];
			if (x < box[o + c]) box[o + c] = x;
			if (x > box[o + 3 + c]) box[o + 3 + c] = x;
		}
	}
	const size = new Float32Array(count), extent = new Float32Array(count);
	for (let k = 0; k < count; k++) {
		const o = k * 6, dx = box[o + 3] - box[o], dy = box[o + 4] - box[o + 1], dz = box[o + 5] - box[o + 2];
		size[k] = dx >= 0 ? Math.hypot(dx, dy, dz) : 0;
		extent[k] = dx >= 0 ? Math.max(dx, dy, dz) : 0;
	}
	return { piece, count, box, size, extent };
}

/** the box round some pieces of a shape (all of them, or those `which` says), as [x0, y0, z0, x1, y1, z1] */
function boxOfPieces(pieces, which) {
	const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
	for (let k = 0; k < pieces.count; k++) {
		if ((which && !which(k)) || !(pieces.box[k * 6 + 3] >= pieces.box[k * 6])) continue;
		for (let c = 0; c < 3; c++) (b[c] = Math.min(b[c], pieces.box[k * 6 + c])), (b[c + 3] = Math.max(b[c + 3], pieces.box[k * 6 + 3 + c]));
	}
	return b;
}

/**
 * The attributes the simplifier weighs, side by side as floats, and their weights: each corner's scaled by its piece's
 * extent against `whole` (the extent of all the simplifier is given at once), so a change on a small piece weighs
 * against that piece's own size, as it would on its own.
 */
function weighed(attributes, count, pieces, whole) {
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
		for (let i = 0; i < count; i++) {
			const s = whole > 0 ? Math.min(1, pieces.extent[pieces.piece[i]] / whole) : 1;
			for (let c = 0; c < p.size; c++) packed[i * width + o + c] = p.a[i * p.stride + c] * s;
		}
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

/** a shape made ready to simplify, once for all its levels: welded, its pieces found, its attributes weighed */
function readied(shape) {
	const welded = weldCorners(shape);
	const pieces = piecesOf(welded);
	const b = boxOfPieces(pieces);
	const whole = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2], 0);
	return { welded, pieces, positions: floats(welded.attributes.position), ...weighed(welded.attributes, welded.count, pieces, whole) };
}

/** a welded shape's open edges: each place at either end of an edge (between two places) only one triangle has */
function bordersOf(welded) {
	const { place, places, index } = welded;
	const edges = new Map();
	for (let t = 0; t < index.length; t += 3)
		for (let e = 0; e < 3; e++) {
			const a = place[index[t + e]], b = place[index[t + ((e + 1) % 3)]];
			const k = a < b ? a * places + b : b * places + a;
			edges.set(k, (edges.get(k) ?? 0) + 1);
		}
	const border = new Uint8Array(places);
	for (const [k, n] of edges) if (n === 1) (border[Math.floor(k / places)] = 1), (border[k % places] = 1);
	return border;
}

/** the attributes the drawings simplified together carry to the simplifier, each as many components as it gives */
const LAYOUT = [
	['normal', 3],
	['color', 3],
	['uv', 2]
];

/**
 * The drawings drawn once, readied, as one shape for the simplifier: their corners side by side (each drawing's after
 * the one before), each drawing moved along x past the one before so that none takes another's corners, their
 * attributes in one layout and weighed against the size of the whole, and which corners stand where another
 * drawing's do on an open edge (`shared`: where two drawings meet, neither moves).
 */
function together(rs) {
	let count = 0;
	const offset = rs.map((r) => {
		const o = count;
		count += r.welded.count;
		return o;
	});
	const boxes = rs.map((r) => boxOfPieces(r.pieces));
	const all = boxes.reduce((a, b) => [0, 1, 2, 3, 4, 5].map((c) => (c < 3 ? Math.min(a[c], b[c]) : Math.max(a[c], b[c]))), [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
	const span = Math.max(all[3] - all[0], all[4] - all[1], all[5] - all[2], 1e-6);
	// apart: each drawing past the one before along x, a tenth of the whole between them
	const shift = [];
	let at = 0;
	for (const b of boxes) {
		const a0 = b[3] >= b[0] ? b[0] : 0, a1 = b[3] >= b[0] ? b[3] : 0;
		shift.push(at - a0);
		at += a1 - a0 + span * 0.1;
	}
	const positions = new Float32Array(count * 3);
	rs.forEach((r, j) => {
		positions.set(r.positions, offset[j] * 3);
		for (let v = 0; v < r.welded.count; v++) positions[(offset[j] + v) * 3] += shift[j];
	});
	// the extent the simplifier sees: the drawings' row
	const whole = Math.max(at, all[4] - all[1], all[5] - all[2]);
	const width = LAYOUT.reduce((s, l) => s + l[1], 0);
	const packed = new Float32Array(count * width);
	const weights = LAYOUT.flatMap(([k, n]) => Array(n).fill(WEIGHTS[k]));
	rs.forEach((r, j) => {
		let o = 0;
		for (const [k, n] of LAYOUT) {
			const a = r.welded.attributes[k];
			if (a) {
				const F = floats(a), m = Math.min(n, a.itemSize);
				for (let v = 0; v < r.welded.count; v++) {
					const s = Math.min(1, r.pieces.extent[r.pieces.piece[v]] / whole);
					for (let c = 0; c < m; c++) packed[(offset[j] + v) * width + o + c] = F[v * a.itemSize + c] * s;
				}
			}
			o += n;
		}
	});
	// where two drawings meet: the corners on an open edge of one at a place a corner of another stands
	const grain = Math.max(1e-7, span * 1e-6);
	const seen = new Map();
	const shared = new Uint8Array(count);
	rs.forEach((r, j) => {
		const border = bordersOf(r.welded), P = r.positions;
		for (let v = 0; v < r.welded.count; v++) {
			if (!border[r.welded.place[v]]) continue;
			const key = `${Math.round(P[v * 3] / grain)},${Math.round(P[v * 3 + 1] / grain)},${Math.round(P[v * 3 + 2] / grain)}`;
			const was = seen.get(key);
			if (was === undefined) seen.set(key, [j, offset[j] + v]);
			else if (was[0] !== j) shared[offset[j] + v] = shared[was[1]] = 1;
		}
	});
	return { offset, count, positions, packed, width, weights, shared };
}

/**
 * A drawing's triangles at one level, before it is simplified: its pieces smaller than the level draws left out (a
 * plan that keeps `every` piece, a plant's, leaves none out), and so its pieces never seen (`seen`, when looked for);
 * the corners the simplifier may not move (`lock`): each piece's outer ones, the furthest along each axis, for a piece
 * at least KEEP pixels across (and three of every piece's, for `every`); how much bigger it is drawn than made
 * (`scale`), and how big a piece is put back if it comes to nothing (`keep`, m).
 */
function levelAt(r, d, plan, seen) {
	const { pieces, welded } = r;
	// how much bigger the drawing is drawn than it is made (its biggest copy)
	let scale = d.scale;
	if (!(scale > 0)) {
		const b = boxOfPieces(pieces);
		const diag = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
		scale = diag > 0 ? d.size / diag : 1;
	}
	const smallest = plan.every ? 0 : plan.smallest;
	const keep = plan.every ? 0 : KEEP * plan.smallest;
	const I = welded.index;
	let index = I;
	if (smallest > 0 || seen) {
		const out = new Uint32Array(I.length);
		let m = 0;
		for (let t = 0; t < I.length; t += 3) {
			const k = pieces.piece[I[t]];
			if (pieces.size[k] * scale < smallest || (seen && !seen[k])) continue;
			out[m++] = I[t];
			out[m++] = I[t + 1];
			out[m++] = I[t + 2];
		}
		if (m < I.length) index = out.slice(0, m);
	}
	const P = r.positions;
	const ext = new Int32Array(pieces.count * 6).fill(-1);
	for (let t = 0; t < index.length; t++) {
		const v = index[t], k = pieces.piece[v];
		if (pieces.size[k] * scale < keep) continue;
		for (let c = 0; c < 3; c++) {
			const lo = ext[k * 6 + c], hi = ext[k * 6 + 3 + c], x = P[v * 3 + c];
			if (lo < 0 || x < P[lo * 3 + c]) ext[k * 6 + c] = v;
			if (hi < 0 || x > P[hi * 3 + c]) ext[k * 6 + 3 + c] = v;
		}
	}
	const at = new Uint8Array(welded.places);
	let any = false;
	if (plan.every) {
		// a crown's thousands of leaves and needles: three corners each, both ends along its longest side and the one
		// furthest from the line between them, enough to keep a triangle of it and few enough to let the rest go
		const ends = new Int32Array(pieces.count * 3).fill(-1), far = new Float64Array(pieces.count).fill(-1);
		for (let k = 0; k < pieces.count; k++) {
			if (ext[k * 6] < 0) continue;
			const o = k * 6;
			let a = 0;
			for (let c = 1; c < 3; c++) if (pieces.box[o + 3 + c] - pieces.box[o + c] > pieces.box[o + 3 + a] - pieces.box[o + a]) a = c;
			ends[k * 3] = ext[o + a];
			ends[k * 3 + 1] = ext[o + 3 + a];
		}
		for (let t = 0; t < index.length; t++) {
			const v = index[t], k = pieces.piece[v], a = ends[k * 3], b = ends[k * 3 + 1];
			if (a < 0) continue;
			const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
			const wx = P[v * 3] - P[a * 3], wy = P[v * 3 + 1] - P[a * 3 + 1], wz = P[v * 3 + 2] - P[a * 3 + 2];
			const d = (uy * wz - uz * wy) ** 2 + (uz * wx - ux * wz) ** 2 + (ux * wy - uy * wx) ** 2;
			if (d > far[k]) (far[k] = d), (ends[k * 3 + 2] = v);
		}
		for (let i = 0; i < ends.length; i++) if (ends[i] >= 0) (at[welded.place[ends[i]]] = 1), (any = true);
	} else for (let i = 0; i < ext.length; i++) if (ext[i] >= 0) (at[welded.place[ext[i]]] = 1), (any = true);
	let lock = null;
	if (any) {
		lock = new Uint8Array(welded.count);
		for (let v = 0; v < welded.count; v++) lock[v] = at[welded.place[v]];
	}
	return { index, lock, scale, keep };
}

/**
 * The simplifier's passes, in turn until one comes near enough its share: each how many times the level's error it
 * may stray by, how (see above), and whether it is taken only if it does. A level still over its ceiling after them is
 * passed again allowed further, its smallest pieces pruned.
 */
const PASSES = [
	[1, []],
	[1, ['Permissive']],
	[STRETCH, ['Permissive'], true]
];

/**
 * A shape for the simplifier (`g`: a readied drawing, or drawings together) cut to its triangles `index`, simplified
 * to `tris` triangles, its corners `lock` kept, within `error` metres where it can (see the passes above); the number
 * of the pass it came from (`first` the first's), or 0 when nothing could be taken away, and what a pass allowed
 * further came to though short of its share (`short`).
 * @returns {{ index: Uint32Array, error: number, pass: number, short?: { index: Uint32Array, error: number, pass: number } }}
 */
function simplified(g, index, lock, tris, error, passes = PASSES, first = 1) {
	const target = Math.max(3, Math.min(index.length, Math.floor(tris) * 3));
	if (target >= index.length) return { index, error: 0, pass: 0 };
	const run = (e, flags) => MeshoptSimplifier.simplifyWithAttributes(index, g.positions, 3, g.packed, g.width, g.weights, lock, target, e, ['ErrorAbsolute', ...flags]);
	let best = null, short = null, careful = null;
	for (let p = 0; p < passes.length; p++) {
		const [out, got] = run(error * passes[p][0], passes[p][1]);
		const near = out.length <= target * 1.02 + 3;
		// one allowed further is taken only when that brings the shape to its share: short of it, it would lose its
		// look for little (a bicycle's tyres, a coop's struts); kept aside, for a level over its ceiling
		if (passes[p][2] && !near) {
			if (out.length < best.index.length) short = { index: out, error: got, pass: first + p };
			continue;
		}
		// and the careful one before it kept too, for a level the others keep from its share (see `lowerDraws`)
		if (passes[p][2]) careful = best;
		if (!best || out.length < best.index.length) best = { index: out, error: got, pass: first + p };
		// near enough its share: done
		if (near) break;
	}
	if (careful === best) careful = null;
	// nothing taken away (a box, a card): kept as it is
	if (best.index.length >= index.length) best = { index, error: 0, pass: 0 };
	if (careful && careful.index.length >= index.length) careful = { index, error: 0, pass: 0 };
	return { ...best, ...(short && { short }), ...(careful && { careful }) };
}

/**
 * A drawing's triangles after the simplifier, with each piece it should keep (in `at`, at least its `keep` across)
 * that it folded to nothing put back alone: as plain as the level's error lets it, and at least a few triangles (a
 * rod of eight sides as a thin box), or as it was when even that folds it away; and how far those stray (m).
 */
function survived(r, at, index, error) {
	const { pieces } = r;
	let worst = 0;
	const has = new Uint8Array(pieces.count);
	for (let t = 0; t < index.length; t += 3) has[pieces.piece[index[t]]] = 1;
	const lost = new Map();
	for (let t = 0; t < at.index.length; t += 3) {
		const k = pieces.piece[at.index[t]];
		if (has[k] || pieces.size[k] * at.scale < at.keep) continue;
		let l = lost.get(k);
		if (!l) lost.set(k, (l = []));
		l.push(at.index[t], at.index[t + 1], at.index[t + 2]);
	}
	if (!lost.size) return { index, error: 0 };
	const back = [];
	for (const l of lost.values()) {
		const I = Uint32Array.from(l);
		let [out, got] = MeshoptSimplifier.simplifyWithAttributes(I, r.positions, 3, r.packed, r.width, r.weights, null, Math.min(I.length, 12), error, ['ErrorAbsolute']);
		if (!out.length) (out = I), (got = 0);
		worst = Math.max(worst, got);
		for (let i = 0; i < out.length; i++) back.push(out[i]);
	}
	const out = new Uint32Array(index.length + back.length);
	out.set(index);
	out.set(back, index.length);
	return { index: out, error: worst };
}

/**
 * Which pieces of a kind are ever seen from outside it: every drawing at every place it is drawn, looked at from
 * SEEN.sides directions spread over the sphere (from below too: a lamp hung high is seen so), each a picture SEEN.px
 * pixels across the kind's ball, its nearest faces kept in each pixel. A face of a drawing drawn on one side only hides
 * nothing from its other; a drawing seen through (glass, a net) hides nothing, and is seen where nothing hides it.
 * @returns {Promise<false | { pieces: Uint8Array, copies: Uint8Array }[]>} for each drawing, whether each of its pieces
 *   is seen in any of its copies, and whether each copy is seen at all; false when every piece is
 */
async function seenOf(draws, rs, pause) {
	let verts = 0, faces = 0, ids = 0;
	const at = draws.map((d, i) => {
		const r = rs[i], o = { v: verts, f: faces, p: ids };
		verts += r.welded.count * d.n;
		faces += (r.welded.index.length / 3) * d.n;
		ids += r.pieces.count * d.n;
		return o;
	});
	const V = new Float32Array(verts * 3), F = new Uint32Array(faces * 3), owner = new Int32Array(faces);
	// each face: 1 seen from its front, 2 from its back, 3 from both; 4 seen through
	const how = new Uint8Array(faces);
	draws.forEach((d, i) => {
		const r = rs[i], o = at[i], P = r.positions, W = r.welded.index, M = d.locals;
		const count = r.welded.count, n3 = W.length / 3;
		const flag = (d.side === 2 ? 3 : d.side === 1 ? 2 : 1) | (d.see ? 4 : 0);
		for (let c = 0; c < d.n; c++) {
			const m = c * 16, vb = o.v + c * count, fb = o.f + c * n3, pb = o.p + c * r.pieces.count;
			for (let v = 0; v < count; v++) {
				const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], w = (vb + v) * 3;
				V[w] = M ? M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12] : x;
				V[w + 1] = M ? M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13] : y;
				V[w + 2] = M ? M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14] : z;
			}
			for (let t = 0; t < n3; t++) {
				const f = fb + t;
				F[f * 3] = vb + W[t * 3];
				F[f * 3 + 1] = vb + W[t * 3 + 1];
				F[f * 3 + 2] = vb + W[t * 3 + 2];
				owner[f] = pb + r.pieces.piece[W[t * 3]];
				how[f] = flag;
			}
		}
	});
	// the ball round it
	const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
	for (let v = 0; v < verts; v++) for (let c = 0; c < 3; c++) (lo[c] = Math.min(lo[c], V[v * 3 + c])), (hi[c] = Math.max(hi[c], V[v * 3 + c]));
	const mid = [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2);
	const R = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 || 1;
	const N = SEEN.px, k = N / (2 * R);
	const sx = new Float32Array(verts), sy = new Float32Array(verts), sz = new Float32Array(verts);
	const depth = new Float32Array(N * N), id = new Int32Array(N * N);
	const seen = new Uint8Array(ids);
	for (let s = 0; s < SEEN.sides; s++) {
		if (pause && s % 6 === 5) await pause();
		// a spiral of directions over the sphere, each as evenly apart as the others; the picture's right and up
		const y = 1 - (2 * (s + 0.5)) / SEEN.sides, ring = Math.sqrt(1 - y * y), turn = s * Math.PI * (3 - Math.sqrt(5));
		const D = [Math.cos(turn) * ring, y, Math.sin(turn) * ring];
		const A = Math.abs(D[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		const U = [A[1] * D[2] - A[2] * D[1], A[2] * D[0] - A[0] * D[2], A[0] * D[1] - A[1] * D[0]];
		const ul = Math.hypot(U[0], U[1], U[2]);
		for (let c = 0; c < 3; c++) U[c] /= ul;
		const Up = [D[1] * U[2] - D[2] * U[1], D[2] * U[0] - D[0] * U[2], D[0] * U[1] - D[1] * U[0]];
		for (let v = 0; v < verts; v++) {
			const x = V[v * 3] - mid[0], yy = V[v * 3 + 1] - mid[1], z = V[v * 3 + 2] - mid[2];
			sx[v] = (x * U[0] + yy * U[1] + z * U[2]) * k + N / 2;
			sy[v] = (x * Up[0] + yy * Up[1] + z * Up[2]) * k + N / 2;
			// towards the eye: the nearer, the more
			sz[v] = x * D[0] + yy * D[1] + z * D[2];
		}
		depth.fill(-Infinity);
		id.fill(-1);
		// the faces that hide what is behind them, then those seen through, against them
		for (let through = 0; through < 2; through++) {
			for (let f = 0; f < faces; f++) {
				const h = how[f];
				if ((h & 4 ? 1 : 0) !== through || (through && seen[owner[f]])) continue;
				const a = F[f * 3];
				let b = F[f * 3 + 1], c = F[f * 3 + 2];
				const ax = sx[a], ay = sy[a];
				let area = (sx[b] - ax) * (sy[c] - ay) - (sy[b] - ay) * (sx[c] - ax);
				// its front faces the eye when its corners turn counter-clockwise on the picture
				if (area > 0) {
					if (!(h & 1)) continue;
				} else if (area < 0) {
					if (!(h & 2)) continue;
					const t = b;
					b = c;
					c = t;
					area = -area;
				} else continue;
				const bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
				// the pixels whose middles it may cover
				const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(N - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
				const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(N - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
				if (x0 > x1 || y0 > y1) continue;
				const az = sz[a], bz = sz[b], cz = sz[c], inv = 1 / area, who = owner[f];
				const qx = x0 + 0.5, qy = y0 + 0.5;
				// how much of a and of b each pixel's middle has (c the rest), stepped along the rows
				let e0r = (bx - qx) * (cy - qy) - (by - qy) * (cx - qx), e1r = (cx - qx) * (ay - qy) - (cy - qy) * (ax - qx);
				const e0x = by - cy, e0y = cx - bx, e1x = cy - ay, e1y = ax - cx;
				rows: for (let py = y0; py <= y1; py++, e0r += e0y, e1r += e1y) {
					let e0 = e0r, e1 = e1r;
					for (let px = x0, o = py * N + x0; px <= x1; px++, o++, e0 += e0x, e1 += e1x) {
						const e2 = area - e0 - e1;
						if (e0 < 0 || e1 < 0 || e2 < 0) continue;
						const z = (e0 * az + e1 * bz + e2 * cz) * inv;
						if (z <= depth[o]) continue;
						if (through) {
							seen[who] = 1;
							break rows;
						}
						depth[o] = z;
						id[o] = who;
					}
				}
			}
			if (!through) for (let o = 0; o < N * N; o++) if (id[o] >= 0) seen[id[o]] = 1;
		}
	}
	let hidden = false;
	const out = draws.map((d, i) => {
		const r = rs[i], n = r.pieces.count;
		const pieces = new Uint8Array(n), copies = new Uint8Array(d.n);
		for (let c = 0; c < d.n; c++)
			for (let p = 0; p < n; p++)
				if (seen[at[i].p + c * n + p]) (pieces[p] = 1), (copies[c] = 1);
		// (a piece with no triangles has nothing to hide)
		const has = new Uint8Array(n);
		for (let t = 0; t < r.welded.index.length; t += 3) has[r.pieces.piece[r.welded.index[t]]] = 1;
		for (let p = 0; p < n; p++) if (has[p] && !pieces[p]) hidden = true;
		if (copies.includes(0)) hidden = true;
		return { pieces, copies };
	});
	return hidden && out;
}

/**
 * A level's drawings lowered to each plan: for each, every drawing kept, left out or lighter, and what it came to.
 * @param {{ attributes: Record<string, any>, index: ArrayLike<number>, tris: number, n: number, size: number, scale?: number, locals?: Float32Array, side?: number, see?: boolean }[]} draws
 *   each drawing of the level: its shape, its triangles, how often one copy draws it, the diameter of its ball at the
 *   biggest it is drawn (m) and how much bigger that is than it is made; where it is drawn (its `locals`, as
 *   ./prepare.js has them), on which side (a material's `side`) and whether it is seen through
 * @param {{ budget: number, most?: number, error: number, smallest: number, every?: boolean }[]} plans each lower level:
 *   the triangles it is made to (./lod.js `budgetOf`), those it may never have more of (its ceiling, `budgetOf` of a
 *   shape without end), how far it may stray (m, `errorOf`) and the smallest part it draws (m, `smallestOf`); `every`
 *   keeps every piece, however small (a plant's leaves: a crown thinned shows)
 * @param {() => Promise<void>} [pause] waited for between two steps (in the page, a frame's room)
 * @returns {Promise<{ draws: ('same' | null | { attributes?: Record<string, any>, index?: Uint16Array | Uint32Array, tris: number, copies?: Uint32Array })[], tris: number, error: number, passes: number[] }[]>}
 *   'same' a drawing kept as it is, null one left out, and otherwise its shape made lighter, or its copies that are
 *   ever seen (`copies`, their numbers among its places), or both; `passes` how many drawings came from each pass (0
 *   none taken away, 1 to 3 the passes above, 4 one allowed further for its level's ceiling)
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
	/** the drawings drawn once, together, for the set of them a level simplifies */
	let group = null;

	/** one level, its never seen pieces left out when `seen` says which */
	async function lowered(plan, seen) {
		const result = draws.map((d) => (d.size < plan.smallest && !plan.every ? null : 'same'));
		const tiny = (d) => d.tris <= TINY && d.n === 1;
		// the copies of each drawing drawn: those ever seen; a drawing never seen at all, left out
		const drawn = draws.map((d, i) => (seen && result[i] && !tiny(d) ? seen[i].copies.reduce((s, x) => s + x, 0) : d.n));
		draws.forEach((d, i) => drawn[i] === 0 && (result[i] = null));
		const cost = (i) => draws[i].tris * drawn[i];
		const open = draws.map((_, i) => i).filter((i) => result[i] && !tiny(draws[i]));
		const fixed = draws.reduce((s, d, i) => s + (result[i] && tiny(d) ? cost(i) : 0), 0);
		const level = { draws: result, tris: fixed + open.reduce((s, i) => s + cost(i), 0), error: 0, passes: Array(PASSES.length + 2).fill(0) };
		if (level.tris > plan.budget && open.length) {
			const ats = new Map();
			for (const i of open) ats.set(i, levelAt(await readyOf(i), draws[i], plan, seen?.[i].pieces));
			const own = (i) => ats.get(i).index.length / 3;
			const whole = open.reduce((s, i) => s + own(i) * drawn[i], 0) || 1;
			const most = plan.most ?? Infinity;
			const many = open.filter((i) => draws[i].n > 1), once = open.filter((i) => draws[i].n === 1);
			// the drawings drawn once, together: their triangles and the corners none may move
			let G = null, index = null, lock = null;
			if (once.length) {
				if (group?.key !== once.join()) group = { key: once.join(), ...together(once.map((i) => made.get(i))) };
				G = group;
				index = new Uint32Array(once.reduce((s, i) => s + ats.get(i).index.length, 0));
				lock = new Uint8Array(G.count);
				let m = 0;
				once.forEach((i, j) => {
					const at = ats.get(i), o = G.offset[j];
					for (let t = 0; t < at.index.length; t++) index[m++] = at.index[t] + o;
					if (at.lock) for (let v = 0; v < at.lock.length; v++) lock[o + v] = at.lock[v];
				});
				for (let v = 0; v < G.count; v++) lock[v] |= G.shared[v];
			}
			/**
			 * Every drawing simplified to the level, `less` triangles under what it may cost and its ceiling (the room
			 * for the pieces put back after): each drawing's triangles, how far it strays, and its pass.
			 * @returns {Promise<Map<number, { index: Uint32Array, error: number, pass: number }>>}
			 */
			const fitted = async (less) => {
				const budget = Math.max(1, plan.budget - less), top = most - less;
				const share = Math.max(0, budget - fixed) / whole;
				const got = new Map();
				// each drawing drawn many times, alone, at its share
				for (const i of many) {
					if (pause) await pause();
					const at = ats.get(i);
					got.set(i, simplified(made.get(i), at.index, at.lock, Math.max(1, own(i) * share), plan.error));
				}
				const manyTris = () => many.reduce((s, i) => s + (got.get(i).index.length / 3) * drawn[i], 0);
				// those drawn once, together, at what is left
				let g = null;
				if (G) {
					if (pause) await pause();
					g = simplified(G, index, lock, Math.max(1, budget - fixed - manyTris()), plan.error);
				}
				const total = () => fixed + manyTris() + (g ? g.index.length / 3 : 0);
				// a level the others keep from its share (a coop's struts beside a bicycle's tyres) is not worth a look
				// lost: what was allowed further to reach its own share goes back to its careful pass, under its ceiling
				if (total() > budget * OVER) {
					if (g?.careful) {
						const was = g;
						g = g.careful;
						if (total() > top) g = was;
					}
					for (const i of many) {
						const h = got.get(i);
						if (!h.careful) continue;
						got.set(i, h.careful);
						if (total() > top) got.set(i, h);
					}
				}
				// over its ceiling by the little a pass may come over what it is asked (a level made to its ceiling, a
				// big tree's crown): asked again for that much less
				if (total() > top) {
					const room = Math.max(0, top - fixed) / whole / 1.03;
					for (const i of many) {
						const at = ats.get(i), h = simplified(made.get(i), at.index, at.lock, Math.max(1, own(i) * room), plan.error);
						if (h.index.length < got.get(i).index.length) got.set(i, h);
					}
					if (g) {
						const h = simplified(G, index, lock, Math.max(1, (top - fixed - manyTris()) / 1.03), plan.error);
						if (h.index.length < g.index.length) g = h;
					}
				}
				// still over it: what was allowed further though short of its share taken after all
				if (total() > top && g?.short) g = g.short;
				for (const i of many) if (total() > top && got.get(i).short) got.set(i, got.get(i).short);
				// and then allowed further still, a step at a time, its smallest pieces pruned, until it is not
				for (let further = 2 * STRETCH; total() > top && further <= STRETCH ** 3; further *= 2) {
					const room = Math.max(0, top - fixed) / whole;
					const pass = [[further, ['Permissive', 'Prune']]];
					for (const i of many) {
						const at = ats.get(i), want = Math.max(1, own(i) * room);
						if (got.get(i).index.length / 3 <= want) continue;
						if (pause) await pause();
						const h = simplified(made.get(i), at.index, at.lock, want, plan.error, pass, PASSES.length + 1);
						if (h.pass && h.index.length < got.get(i).index.length) got.set(i, h);
					}
					if (g && total() > top) {
						if (pause) await pause();
						const h = simplified(G, index, lock, Math.max(1, top - fixed - manyTris()), plan.error, pass, PASSES.length + 1);
						if (h.pass && h.index.length < g.index.length) g = h;
					}
				}
				// back into the drawings
				if (g) {
					const parts = once.map(() => []);
					const ends = G.offset.slice(1).concat([G.count]);
					for (let t = 0; t < g.index.length; t += 3) {
						let j = 0;
						while (g.index[t] >= ends[j]) j++;
						const o = G.offset[j];
						parts[j].push(g.index[t] - o, g.index[t + 1] - o, g.index[t + 2] - o);
					}
					once.forEach((i, j) => got.set(i, { index: Uint32Array.from(parts[j]), error: g.error, pass: g.pass }));
				}
				return got;
			};
			const sum = (got) => fixed + open.reduce((s, i) => s + (got.get(i).index.length / 3) * drawn[i], 0);
			let got = await fitted(0);
			// the pieces it should keep that came to nothing put back (not those pruned for its ceiling); over its
			// ceiling so, made again with room for them, twice at most, and else left as it is
			for (let less = 0, tries = 0; ; tries++) {
				const all = new Map(got);
				for (const i of open) {
					const h = got.get(i);
					if (h.pass > PASSES.length) continue;
					const put = survived(made.get(i), ats.get(i), h.index, plan.error);
					if (put.index !== h.index) all.set(i, { ...h, index: put.index, error: Math.max(h.error, put.error) });
				}
				if (sum(all) <= most) {
					got = all;
					break;
				}
				if (tries === 2) break;
				less += sum(all) - most;
				got = await fitted(less);
			}
			for (const i of open) {
				const h = got.get(i), r = made.get(i);
				const tris = h.index.length / 3;
				level.passes[h.pass]++;
				level.error = Math.max(level.error, h.error);
				// folded across its seams (every pass but the first): shaded again from its faces
				result[i] = tris === 0 ? null : tris >= draws[i].tris ? 'same' : { ...(h.pass > 1 && r.welded.attributes.normal ? reshade(r.welded, h.index) : compact(r.welded, h.index)), tris };
			}
		}
		// the copies never seen left out
		if (seen)
			for (const i of open) {
				if (!result[i] || drawn[i] === draws[i].n) continue;
				const copies = Uint32Array.from(Array.from(seen[i].copies).flatMap((x, c) => (x ? [c] : [])));
				result[i] = result[i] === 'same' ? { tris: draws[i].tris, copies } : { ...result[i], copies };
			}
		level.tris = draws.reduce((s, d, i) => s + (result[i] === 'same' ? d.tris * d.n : result[i] ? result[i].tris * (result[i].copies?.length ?? d.n) : 0), 0);
		return level;
	}

	/** which pieces are ever seen, once looked for: null not yet, false every one */
	let seen = null;
	const out = [];
	for (const plan of plans) {
		let level = await lowered(plan, seen || null);
		// a shape that cannot reach its share: what of it is never seen left out, and made again
		if (seen === null && !plan.every && level.tris > plan.budget * OVER) {
			const rs = [];
			for (let i = 0; i < draws.length; i++) rs.push(await readyOf(i));
			seen = await seenOf(draws, rs, pause);
			if (seen) level = await lowered(plan, seen);
		}
		out.push(level);
	}
	return out;
}
