/*
 * THE SCULPT — an actor's body as one skin, the way the living thing has one: modelled out of soft shapes (an egg for
 * a barrel of ribs, a tapering round cone for a thigh, a muscle, a neck) that melt into one another where they meet,
 * like clay pressed together, and meshed as a single closed surface. A leg grows out of a body instead of being stuck
 * on it, so a hip can swing without a seam opening, and a coat's pattern runs across the join.
 *
 * Each shape rides a bone (or a chain of them: a neck, a spine, a tail), and each vertex of the skin is carried by the
 * bones of the shapes it lies nearest — fully by the nearest, and shared with any other shape it lies within the melt
 * of. So the skin's weights come from the sculpt itself: where a thigh melts into the body, the skin bends between them.
 *
 * The surface is found on a grid (surface nets: one vertex in every cell the surface passes through), only near the
 * surface (the grid is visited in blocks, and a block far from it is skipped), each vertex then pulled onto the true
 * surface and lit by the field's own gradient, so a coarse grid still draws a smooth body.
 *
 * Thin things — an ear, a fin, a comb, a beak, an eye — are no part of it: they are parts of their own (./rig.ts),
 * riding their bones, crisp at any size.
 */
import * as THREE from 'three';
import { detail, type BoneSpec, type V3 } from './rig';
import { noise3 } from './noise';

export type ShapeOptions = {
	/** the bone that carries it, or the chain of bones it lies along (from the first joint outwards) */
	bone?: string;
	chain?: string[];
	/** how softly it melts into the shapes before it (m): 0, a hard join */
	k?: number;
	/** cut away instead of added (a nostril, an eye socket, the mouth) */
	carve?: boolean;
	/** what it is, for the coat painter ('wool', 'face', 'leg' …) */
	tag?: string;
	/** a lumpy surface: how far its lumps rise (m), and how far apart they are (m) */
	bump?: number;
	lumps?: number;
};

type Shape = {
	kind: 0 | 1;
	// an egg: its middle, its radii, its turn (inverse, rows)
	c: V3;
	r: V3;
	inv: number[];
	// a round cone: from a (radius ra) to b (radius rb)
	a: V3;
	ba: V3;
	l2: number;
	rr: number;
	a2: number;
	il2: number;
	ra: number;
	rb: number;
	// where it is and how far it reaches, to find the shapes near a point
	mid: V3;
	reach: number;
	k: number;
	carve: boolean;
	tag: string;
	bone?: string;
	chain?: string[];
	bump: number;
	lumps: number;
};

/** What the painter is told of a point of the skin. */
export type Surface = {
	p: THREE.Vector3;
	n: THREE.Vector3;
	/** how much of the point is the shapes tagged so (0…1, all the tags at a point summing to 1) */
	tag: (name: string) => number;
	/** the tag of the shape it lies nearest */
	main: string;
};

/** A skin: its geometry (position, normal, colour) and, per vertex, its four bones (by name) and their weights. */
export type Skin = { geo: THREE.BufferGeometry; bones: string[]; index: Uint16Array; weight: Float32Array };

const smin = (a: number, b: number, k: number) => {
	if (k <= 0) return a < b ? a : b;
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return (a < b ? a : b) - h * h * k * 0.25;
};

/** the lumps' noise at the point last asked about (every lumpy shape of a sculpt shares it) */
let nx_ = NaN, ny_ = NaN, nz_ = NaN, nl_ = NaN, nv_ = 0;
const lumpsAt = (x: number, y: number, z: number, l: number) => {
	if (x !== nx_ || y !== ny_ || z !== nz_ || l !== nl_) {
		nx_ = x;
		ny_ = y;
		nz_ = z;
		nl_ = l;
		nv_ = noise3(x / l, y / l, z / l, 5);
	}
	return nv_;
};

function distance(s: Shape, x: number, y: number, z: number): number {
	let d: number;
	if (s.kind === 0) {
		const px = x - s.c[0], py = y - s.c[1], pz = z - s.c[2], m = s.inv;
		const qx = (m[0]! * px + m[1]! * py + m[2]! * pz) / s.r[0], qy = (m[3]! * px + m[4]! * py + m[5]! * pz) / s.r[1], qz = (m[6]! * px + m[7]! * py + m[8]! * pz) / s.r[2];
		const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
		const k1 = Math.sqrt((qx / s.r[0]) ** 2 + (qy / s.r[1]) ** 2 + (qz / s.r[2]) ** 2);
		d = k1 < 1e-12 ? -Math.min(...s.r) : (k0 * (k0 - 1)) / k1;
	} else {
		// a round cone (Inigo Quilez's): exact
		const pax = x - s.a[0], pay = y - s.a[1], paz = z - s.a[2];
		const yy = pax * s.ba[0] + pay * s.ba[1] + paz * s.ba[2];
		const zz = yy - s.l2;
		const xvx = pax * s.l2 - s.ba[0] * yy, xvy = pay * s.l2 - s.ba[1] * yy, xvz = paz * s.l2 - s.ba[2] * yy;
		const x2 = xvx * xvx + xvy * xvy + xvz * xvz, y2 = yy * yy * s.l2, z2 = zz * zz * s.l2;
		const k = Math.sign(s.rr) * s.rr * s.rr * x2;
		if (Math.sign(zz) * s.a2 * z2 > k) d = Math.sqrt(x2 + z2) * s.il2 - s.rb;
		else if (Math.sign(yy) * s.a2 * y2 < k) d = Math.sqrt(x2 + y2) * s.il2 - s.ra;
		else d = (Math.sqrt(x2 * s.a2 * s.il2) + yy * s.rr) * s.il2 - s.ra;
	}
	if (s.bump) d -= 0.5 * s.bump * lumpsAt(x, y, z, s.lumps);
	return d;
}

/** the field of a set of shapes at a point: < 0 inside */
function field(list: Shape[], x: number, y: number, z: number): number {
	let d = 1e9;
	for (const s of list) {
		const di = distance(s, x, y, z);
		d = s.carve ? -smin(-d, di, s.k) : smin(d, di, s.k);
	}
	return d;
}

const cache = new Map<string, Skin>();
/** the skins meshed here since `fresh()` was last asked (a worker hands them back to the page) */
let made: string[] = [];
export const fresh = (): [string, Skin][] => {
	const out = made.map((k) => [k, cache.get(k)!] as [string, Skin]);
	made = [];
	return out;
};
/** a skin meshed elsewhere (in a worker), kept as if meshed here */
export const keep = (key: string, skin: Skin) => cache.set(key, skin);

/**
 * A sculpt over a skeleton (its bones, where their joints rest): add its shapes, then `skin()` it.
 */
export function sculpt(bones: BoneSpec[]) {
	const shapes: Shape[] = [];
	const joint = Object.fromEntries(bones.map((b) => [b.name, b.at]));
	const base = (o: ShapeOptions) => ({ k: o.k ?? 0, carve: !!o.carve, tag: o.tag ?? 'body', bone: o.bone, chain: o.chain, bump: o.bump ?? 0, lumps: o.lumps ?? 0.05 });
	const none: V3 = [0, 0, 0];
	const api = {
		/** an egg at `c`, `r` its radii along x, y and z, turned by `rot` (radians about x, y, z) */
		egg(c: V3, r: V3, o: ShapeOptions, rot: V3 = [0, 0, 0]) {
			const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)).invert().elements;
			// three.js keeps its matrices by columns: the inverse's rows are these
			const inv = [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[2]!, m[6]!, m[10]!];
			shapes.push({ kind: 0, c, r, inv, a: none, ba: none, l2: 1, rr: 0, a2: 1, il2: 1, ra: 0, rb: 0, mid: c, reach: Math.max(...r), ...base(o) });
			return api;
		},
		/** a ball */
		ball(c: V3, r: number, o: ShapeOptions) {
			return api.egg(c, [r, r, r], o);
		},
		/** a round cone from a (`ra` thick) to b (`rb`): a limb, a neck, a tail */
		cone(a: V3, b: V3, ra: number, rb: number, o: ShapeOptions) {
			const ba: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
			const l2 = Math.max(1e-10, ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2), rr = ra - rb;
			const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
			shapes.push({ kind: 1, c: none, r: [1, 1, 1], inv: [], a, ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, ra, rb, mid, reach: Math.sqrt(l2) / 2 + Math.max(ra, rb), ...base(o) });
			return api;
		},
		/**
		 * The skin: meshed in cells `cell` across (coarser for an actor drawn far off), painted by `paint`. Kept by
		 * `key`, so the same sculpt is only ever meshed once.
		 */
		skin(cell: number, paint: (c: THREE.Color, s: Surface) => void, key?: string): Skin {
			const h = cell / detail();
			const id = key && `${key}@${h.toFixed(5)}`;
			if (id && cache.has(id)) return cache.get(id)!;
			const out = mesh(shapes, h, joint, paint);
			if (id) {
				cache.set(id, out);
				made.push(id);
			}
			return out;
		}
	};
	return api;
}

function mesh(shapes: Shape[], h: number, joint: Record<string, V3>, paint: (c: THREE.Color, s: Surface) => void): Skin {
	const solid = shapes.filter((s) => !s.carve);
	const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
	for (const s of solid)
		for (let i = 0; i < 3; i++) {
			const r = s.reach + s.bump + s.k;
			lo[i] = Math.min(lo[i]!, s.mid[i]! - r);
			hi[i] = Math.max(hi[i]!, s.mid[i]! + r);
		}
	for (let i = 0; i < 3; i++) {
		lo[i]! -= 2 * h;
		hi[i]! += 2 * h;
	}
	const nx = Math.ceil((hi[0] - lo[0]) / h), ny = Math.ceil((hi[1] - lo[1]) / h), nz = Math.ceil((hi[2] - lo[2]) / h);
	const px = nx + 1, py = ny + 1, pz = nz + 1;
	const at = (i: number, j: number, k: number) => i + px * (j + py * k);

	// the grid in blocks: each with the shapes near it; a block far from the surface is all inside or all outside
	const B = 6, bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
	const lists: Shape[][] = new Array(bx * by * bz);
	const flat = new Uint8Array(bx * by * bz);
	const value = new Float32Array(px * py * pz).fill(NaN);
	const half = (B * h * Math.sqrt(3)) / 2;
	for (let kb = 0; kb < bz; kb++)
		for (let jb = 0; jb < by; jb++)
			for (let ib = 0; ib < bx; ib++) {
				const cx = lo[0] + (ib + 0.5) * B * h, cy = lo[1] + (jb + 0.5) * B * h, cz = lo[2] + (kb + 0.5) * B * h;
				const reach = half + h * Math.sqrt(3);
				const list = shapes.filter((s) => Math.hypot(cx - s.mid[0], cy - s.mid[1], cz - s.mid[2]) <= s.reach + s.k + s.bump + reach * 1.3);
				lists[ib + bx * (jb + by * kb)] = list;
				const d = list.some((s) => !s.carve) ? field(list, cx, cy, cz) : 1e9;
				const i0 = ib * B, j0 = jb * B, k0 = kb * B;
				const i1 = Math.min(nx, i0 + B), j1 = Math.min(ny, j0 + B), k1 = Math.min(nz, k0 + B);
				// no surface within reach (with room for the field not being a true distance): the block takes its sign
				const uniform = Math.abs(d) > reach * 1.2;
				flat[ib + bx * (jb + by * kb)] = uniform ? 1 : 0;
				for (let k = k0; k <= k1; k++)
					for (let j = j0; j <= j1; j++)
						for (let i = i0; i <= i1; i++) {
							const n = at(i, j, k);
							if (value[n] === value[n]) continue;
							value[n] = uniform ? Math.sign(d) * reach : field(list, lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
						}
			}
	const listAt = (x: number, y: number, z: number) => {
		const ib = Math.min(bx - 1, Math.max(0, Math.floor((x - lo[0]) / (B * h))));
		const jb = Math.min(by - 1, Math.max(0, Math.floor((y - lo[1]) / (B * h))));
		const kb = Math.min(bz - 1, Math.max(0, Math.floor((z - lo[2]) / (B * h))));
		return lists[ib + bx * (jb + by * kb)]!;
	};

	// a vertex in every cell the surface passes through: where it crosses the cell's edges, on average
	const cellAt = (i: number, j: number, k: number) => i + nx * (j + ny * k);
	const vertexOf = new Int32Array(nx * ny * nz).fill(-1);
	const pos: number[] = [];
	const corner = [0, 0, 0, 0, 0, 0, 0, 0];
	const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
	const cellVertex = (i: number, j: number, k: number) => {
		let inside = 0;
		for (let c = 0; c < 8; c++) {
			corner[c] = value[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]!;
			if (corner[c]! < 0) inside++;
		}
		if (inside === 0 || inside === 8) return;
		let sx = 0, sy = 0, sz = 0, n = 0;
		for (const [a, b] of EDGES) {
			const va = corner[a!]!, vb = corner[b!]!;
			if (va < 0 === vb < 0) continue;
			const t = va / (va - vb);
			sx += (a! & 1) + ((b! & 1) - (a! & 1)) * t;
			sy += ((a! >> 1) & 1) + (((b! >> 1) & 1) - ((a! >> 1) & 1)) * t;
			sz += ((a! >> 2) & 1) + (((b! >> 2) & 1) - ((a! >> 2) & 1)) * t;
			n++;
		}
		vertexOf[cellAt(i, j, k)] = pos.length / 3;
		pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
	};
	// only in the blocks the surface may pass through
	for (let kb = 0; kb < bz; kb++)
		for (let jb = 0; jb < by; jb++)
			for (let ib = 0; ib < bx; ib++) {
				if (flat[ib + bx * (jb + by * kb)]) continue;
				for (let k = kb * B; k < Math.min(nz, kb * B + B); k++)
					for (let j = jb * B; j < Math.min(ny, jb * B + B); j++) for (let i = ib * B; i < Math.min(nx, ib * B + B); i++) cellVertex(i, j, k);
			}

	// a quad across every grid edge the surface crosses, joining the four cells round it
	const idx: number[] = [];
	const quad = (a: number, b: number, c: number, d: number) => {
		if (a < 0 || b < 0 || c < 0 || d < 0) return;
		idx.push(a, b, c, a, c, d);
	};
	for (let k = 0; k <= nz; k++)
		for (let j = 0; j <= ny; j++)
			for (let i = 0; i <= nx; i++) {
				const v0 = value[at(i, j, k)]! < 0;
				if (i < nx && j > 0 && k > 0 && j < ny && k < nz && v0 !== value[at(i + 1, j, k)]! < 0)
					quad(vertexOf[cellAt(i, j - 1, k - 1)]!, vertexOf[cellAt(i, j, k - 1)]!, vertexOf[cellAt(i, j, k)]!, vertexOf[cellAt(i, j - 1, k)]!);
				if (j < ny && i > 0 && k > 0 && i < nx && k < nz && v0 !== value[at(i, j + 1, k)]! < 0)
					quad(vertexOf[cellAt(i - 1, j, k - 1)]!, vertexOf[cellAt(i, j, k - 1)]!, vertexOf[cellAt(i, j, k)]!, vertexOf[cellAt(i - 1, j, k)]!);
				if (k < nz && i > 0 && j > 0 && i < nx && j < ny && v0 !== value[at(i, j, k + 1)]! < 0)
					quad(vertexOf[cellAt(i - 1, j - 1, k)]!, vertexOf[cellAt(i, j - 1, k)]!, vertexOf[cellAt(i, j, k)]!, vertexOf[cellAt(i - 1, j, k)]!);
			}

	// each vertex onto the true surface, and its normal from the field's gradient
	const count = pos.length / 3;
	const nrm = new Float32Array(count * 3);
	const e = h * 0.2;
	/** the field's gradient by forward differences (times e), `d` the field at the point */
	const grad = (list: Shape[], x: number, y: number, z: number, d: number, g: number[]) => {
		g[0] = field(list, x + e, y, z) - d;
		g[1] = field(list, x, y + e, z) - d;
		g[2] = field(list, x, y, z + e) - d;
		return g;
	};
	const g = [0, 0, 0];
	for (let v = 0; v < count; v++) {
		let x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
		const list = listAt(x, y, z);
		// a Newton step along the gradient: as far as the field says the surface is, never more than half a cell
		const d = field(list, x, y, z);
		grad(list, x, y, z, d, g);
		const gl = Math.hypot(g[0]!, g[1]!, g[2]!);
		if (gl > 1e-12) {
			const move = Math.max(-h / 2, Math.min(h / 2, (d * e) / gl));
			x -= (g[0]! / gl) * move;
			y -= (g[1]! / gl) * move;
			z -= (g[2]! / gl) * move;
		}
		pos[v * 3] = x;
		pos[v * 3 + 1] = y;
		pos[v * 3 + 2] = z;
		grad(list, x, y, z, field(list, x, y, z), g);
		const l = Math.hypot(g[0]!, g[1]!, g[2]!) || 1;
		nrm[v * 3] = g[0]! / l;
		nrm[v * 3 + 1] = g[1]! / l;
		nrm[v * 3 + 2] = g[2]! / l;
	}
	// every triangle facing out, as the field's gradient does
	for (let t = 0; t < idx.length; t += 3) {
		const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
		const ux = pos[b * 3]! - pos[a * 3]!, uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!, uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
		const vx = pos[c * 3]! - pos[a * 3]!, vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!, vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
		const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
		const sx = nrm[a * 3]! + nrm[b * 3]! + nrm[c * 3]!, sy = nrm[a * 3 + 1]! + nrm[b * 3 + 1]! + nrm[c * 3 + 1]!, sz = nrm[a * 3 + 2]! + nrm[b * 3 + 2]! + nrm[c * 3 + 2]!;
		if (fx * sx + fy * sy + fz * sz < 0) {
			idx[t + 1] = c;
			idx[t + 2] = b;
		}
	}

	// the weights: each vertex carried by the bones of the shapes it lies nearest, and its tags for the painter
	const names: string[] = [];
	const nameIndex = new Map<string, number>();
	const boneId = (n: string) => {
		if (!nameIndex.has(n)) {
			nameIndex.set(n, names.length);
			names.push(n);
		}
		return nameIndex.get(n)!;
	};
	const index = new Uint16Array(count * 4), weight = new Float32Array(count * 4), color = new Float32Array(count * 3);
	const byBone = new Map<number, number>(), byTag = new Map<string, number>();
	const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
	let total = 0;
	const surface: Surface = { p, n, tag: (name) => (byTag.get(name) ?? 0) / total, main: '' };
	const addBone = (b: string, w: number) => {
		const id = boneId(b);
		byBone.set(id, Math.max(byBone.get(id) ?? 0, w));
	};
	for (let v = 0; v < count; v++) {
		const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
		const list = listAt(x, y, z).filter((s) => !s.carve);
		const ds = list.map((s) => distance(s, x, y, z));
		let dmin = Infinity, main = 0;
		ds.forEach((d, i) => d < dmin && ((dmin = d), (main = i)));
		byBone.clear();
		byTag.clear();
		total = 0;
		list.forEach((s, i) => {
			const band = Math.max(s.k, 1.5 * h);
			const u = Math.max(0, 1 - (ds[i]! - dmin) / band);
			const w = u * u;
			if (w <= 0) return;
			byTag.set(s.tag, Math.max(byTag.get(s.tag) ?? 0, w));
			if (s.bone) addBone(s.bone, w);
			else if (s.chain) for (const [b, share] of along(s.chain, joint, x, y, z, band)) addBone(b, w * share);
		});
		for (const w of byTag.values()) total += w;
		const top = [...byBone].sort((a, b) => b[1] - a[1]).slice(0, 4);
		const sum = top.reduce((acc, [, w]) => acc + w, 0) || 1;
		top.forEach(([b, w], q) => {
			index[v * 4 + q] = b;
			weight[v * 4 + q] = w / sum;
		});
		p.set(x, y, z);
		n.set(nrm[v * 3]!, nrm[v * 3 + 1]!, nrm[v * 3 + 2]!);
		surface.main = list[main]?.tag ?? 'body';
		c.set(0xffffff);
		paint(c, surface);
		color[v * 3] = c.r;
		color[v * 3 + 1] = c.g;
		color[v * 3 + 2] = c.b;
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
	geo.setIndex(idx);
	return { geo, bones: names, index, weight };
}

/** Along a chain of bones: which of them carry a point, and how much (sharing across a joint over `soft`). */
function along(chain: string[], joint: Record<string, V3>, x: number, y: number, z: number, soft: number): [string, number][] {
	let best = 0, bestD = Infinity, bestS = 0, bestLen = 1;
	for (let i = 0; i < chain.length; i++) {
		const a = joint[chain[i]!]!;
		const b = i < chain.length - 1 ? joint[chain[i + 1]!]! : i > 0 ? (a.map((v, q) => 2 * v - joint[chain[i - 1]!]![q]!) as V3) : ([a[0], a[1] - 0.1, a[2]] as V3);
		const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
		const len = Math.max(1e-6, Math.hypot(dx, dy, dz));
		const s = Math.max(0, Math.min(len, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / len));
		const d = Math.hypot(a[0] + (dx * s) / len - x, a[1] + (dy * s) / len - y, a[2] + (dz * s) / len - z);
		if (d < bestD - 1e-9) [best, bestD, bestS, bestLen] = [i, d, s, len];
	}
	const k = Math.min(soft, bestLen / 2);
	const back = best > 0 && bestS < k ? 0.5 - (0.5 * bestS) / k : 0;
	const next = best < chain.length - 1 && bestLen - bestS < k ? 0.5 - (0.5 * (bestLen - bestS)) / k : 0;
	const out: [string, number][] = [[chain[best]!, 1 - back - next]];
	if (back) out.push([chain[best - 1]!, back]);
	if (next) out.push([chain[best + 1]!, next]);
	return out;
}

/* ── for the painters ────────────────────────────────────────────────────── */

/** a colour from its hex, linear */
export const hex = (s: string) => new THREE.Color(s);
/** c moved toward `to` by t */
export const mix = (c: THREE.Color, to: THREE.Color | string, t: number) => c.lerp(typeof to === 'string' ? hex(to) : to, Math.max(0, Math.min(1, t)));
/** 0 below a, 1 above b, smooth between */
export const ramp = (x: number, a: number, b: number) => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
