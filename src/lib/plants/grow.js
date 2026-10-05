/*
 * GROW — what every plant is made from. A seed id (any text) is hashed into the plant's chance, and every organ draws
 * its own chance by name (`chance(seed, 'leaf', 3)`), so the third leaf is the same leaf whichever stage it is seen at
 * and however many leaves came before it: a plant tabbed from seed to fruit grows, it is not redrawn.
 *
 * Growth is one number `g`, 0 … 6: the seven stages are its whole values (0 the seed, 6 the plant in fruit), and an
 * organ grows over a stretch of it (`span(g, from, to)`). The shapes are swept tubes (a root, a stem, a berry) and
 * sheets (a leaf, a petal), each painted by vertex colours, and all of a plant's pieces are merged into one mesh per
 * material (`Bag`) so a cucumber vine with its hundreds of roots is a handful of draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** @typedef {() => number} Chance a number 0 … 1, the next one every call */
/** @typedef {(u: number, v: number) => THREE.ColorRepresentation | THREE.Color} Paint a colour for a place on a shape (u along it, v round or across it) */

/** a 32-bit hash of a text (FNV-1a) */
export function hashText(/** @type {string} */ text) {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/**
 * The chance of one organ of one plant: the seed id and the organ's name hashed into a small fast generator
 * (mulberry32), the same numbers every time.
 * @param {string} seed
 * @param {...(string | number)} keys
 * @returns {Chance}
 */
export function chance(seed, ...keys) {
	let a = hashText(`${seed}|${keys.join('|')}`);
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** a number between a and b */
export const between = (/** @type {Chance} */ r, /** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * r();
/** a number round m, give or take `by` */
export const about = (/** @type {Chance} */ r, /** @type {number} */ m, /** @type {number} */ by) => m + (r() * 2 - 1) * by;

export const clamp = (/** @type {number} */ x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
export const smooth = (/** @type {number} */ x) => {
	const t = clamp(x);
	return t * t * (3 - 2 * t);
};
/** how far an organ has grown at g, if it grows from `from` to `to`: 0 … 1, eased */
export const span = (/** @type {number} */ g, /** @type {number} */ from, /** @type {number} */ to) => smooth((g - from) / (to - from));

/**
 * A value that follows growth through a table of [g, value] rows, straight between them.
 * @param {number} g
 * @param {[number, number][]} rows
 */
export function table(g, rows) {
	if (g <= rows[0][0]) return rows[0][1];
	for (let i = 1; i < rows.length; i++) {
		const [g1, v1] = rows[i];
		if (g <= g1) {
			const [g0, v0] = rows[i - 1];
			return lerp(v0, v1, smooth((g - g0) / (g1 - g0)));
		}
	}
	return rows[rows.length - 1][1];
}

export const v3 = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);

/** a direction tipped from straight up by `tilt` (radians) toward the compass bearing `turn` */
export const heading = (/** @type {number} */ tilt, /** @type {number} */ turn) => v3(Math.sin(tilt) * Math.cos(turn), Math.cos(tilt), Math.sin(tilt) * Math.sin(turn));

/** the matrix that sets a shape built along +X (normal +Y) at `at`, pointing along `dir`, rolled by `roll` round it */
export function aim(/** @type {THREE.Vector3} */ at, /** @type {THREE.Vector3} */ dir, roll = 0) {
	const x = dir.clone().normalize();
	// keep its face up as far as it can while it points along dir
	let z = new THREE.Vector3().crossVectors(x, UP);
	if (z.lengthSq() < 1e-8) z = v3(0, 0, 1);
	z.normalize();
	const y = new THREE.Vector3().crossVectors(z, x).normalize();
	const m = new THREE.Matrix4().makeBasis(x, y, z);
	if (roll) m.multiply(new THREE.Matrix4().makeRotationX(roll));
	return m.setPosition(at);
}

const C = new THREE.Color();
const toColor = (/** @type {THREE.ColorRepresentation | THREE.Color} */ c) => (c instanceof THREE.Color ? c : C.set(c));
/** a colour between two, as a THREE.Color (a new one) */
export const mix = (/** @type {THREE.ColorRepresentation} */ a, /** @type {THREE.ColorRepresentation} */ b, /** @type {number} */ t) => new THREE.Color(a).lerp(new THREE.Color(b), clamp(t));

/**
 * A tube swept along points, its radius changing along it (`radius(u)`, u 0 … 1 base to tip), its frames carried along
 * without twist. A root, a stem, a petiole, a tendril, a berry, a cucumber.
 * @param {THREE.Vector3[]} points
 * @param {(u: number) => number} radius
 * @param {Paint} paint
 * @param {number} [sides]
 */
export function tube(points, radius, paint, sides = 6) {
	const n = points.length;
	const pos = [], nor = [], uv = [], col = [], idx = [];
	// the length along it, to spread u evenly by distance
	const along = [0];
	for (let i = 1; i < n; i++) along.push(along[i - 1] + points[i].distanceTo(points[i - 1]));
	const total = along[n - 1] || 1;
	let normal = null;
	let prev = null;
	for (let i = 0; i < n; i++) {
		const t = points[Math.min(n - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]);
		if (t.lengthSq() < 1e-14) t.copy(prev ?? UP);
		t.normalize();
		if (!normal) {
			normal = Math.abs(t.y) < 0.9 ? new THREE.Vector3().crossVectors(t, UP).normalize() : new THREE.Vector3().crossVectors(t, v3(1, 0, 0)).normalize();
		} else if (prev) {
			normal.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(prev, t)).normalize();
		}
		prev = t;
		const bin = new THREE.Vector3().crossVectors(t, normal).normalize();
		const u = along[i] / total;
		const r = Math.max(0, radius(u));
		for (let s = 0; s <= sides; s++) {
			const a = (s / sides) * Math.PI * 2;
			const d = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
			const p = points[i].clone().addScaledVector(d, r);
			pos.push(p.x, p.y, p.z);
			nor.push(d.x, d.y, d.z);
			uv.push(u, s / sides);
			const c = toColor(paint(u, s / sides));
			col.push(c.r, c.g, c.b);
		}
	}
	for (let i = 0; i < n - 1; i++)
		for (let s = 0; s < sides; s++) {
			const a = i * (sides + 1) + s, b = a + sides + 1;
			idx.push(a, b, a + 1, b, b + 1, a + 1);
		}
	return made(pos, nor, uv, col, idx, false);
}

/**
 * A sheet: a leaf, a leaflet, a petal, a sepal — built along +X from its base, across Z, its face up (+Y). `shape(u)`
 * is its half-width at u (0 base … 1 tip, in parts of its length), `lift(u, v)` how far a place on it is raised (v
 * −1 … 1 across), for a cupped or folded or drooping leaf.
 * @param {{ length: number, width: number, shape: (u: number) => number, lift?: (u: number, v: number) => number, paint: Paint, along?: number, across?: number }} o
 */
export function sheet({ length, width, shape, lift = () => 0, paint, along = 16, across = 6 }) {
	const pos = [], nor = [], uv = [], col = [], idx = [];
	for (let i = 0; i <= along; i++) {
		const u = i / along;
		const w = shape(u) * width;
		for (let j = 0; j <= across; j++) {
			const v = (j / across) * 2 - 1;
			pos.push(u * length, lift(u, v) * length, v * w);
			nor.push(0, 1, 0);
			uv.push(u, (v + 1) / 2);
			const c = toColor(paint(u, v));
			col.push(c.r, c.g, c.b);
		}
	}
	for (let i = 0; i < along; i++)
		for (let j = 0; j < across; j++) {
			const a = i * (across + 1) + j, b = a + across + 1;
			idx.push(a, a + 1, b, b, a + 1, b + 1);
		}
	return made(pos, nor, uv, col, idx, true);
}

/**
 * A round sheet spread from one point (where its stalk meets it): a palmate leaf, a flower's disc. `edge(a)` is its
 * reach at the angle a (0 straight on along +X, ±π behind), `lift(s, a)` its rise at the part s of the reach.
 * @param {{ size: number, from: number, to: number, edge: (a: number) => number, lift?: (s: number, a: number) => number, paint: Paint, rings?: number, rays?: number }} o
 */
export function fan({ size, from, to, edge, lift = () => 0, paint, rings = 8, rays = 40 }) {
	const pos = [], nor = [], uv = [], col = [], idx = [];
	for (let j = 0; j <= rays; j++) {
		const a = lerp(from, to, j / rays);
		const reach = edge(a) * size;
		for (let i = 0; i <= rings; i++) {
			const s = i / rings;
			pos.push(Math.cos(a) * reach * s, lift(s, a) * size, Math.sin(a) * reach * s);
			nor.push(0, 1, 0);
			uv.push(s, j / rays);
			const c = toColor(paint(s, a));
			col.push(c.r, c.g, c.b);
		}
	}
	for (let j = 0; j < rays; j++)
		for (let i = 0; i < rings; i++) {
			const a = j * (rings + 1) + i, b = a + rings + 1;
			idx.push(a, b, a + 1, b, b + 1, a + 1);
		}
	return made(pos, nor, uv, col, idx, true);
}

/** a small round thing — a seed, an achene, a wart, a bud — at `at`, stretched by `scale`, of one colour */
export function bead(/** @type {THREE.Vector3} */ at, /** @type {THREE.Vector3} */ scale, /** @type {THREE.ColorRepresentation} */ color, detail = 6, /** @type {THREE.Quaternion} */ turn = new THREE.Quaternion()) {
	const g = new THREE.SphereGeometry(1, detail + 2, detail);
	g.applyMatrix4(new THREE.Matrix4().compose(at, turn, scale));
	const c = new THREE.Color(color);
	const n = g.attributes.position.count;
	const col = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
	g.setAttribute('color', new THREE.BufferAttribute(col, 3));
	return g;
}

/** @returns {THREE.BufferGeometry} */
function made(/** @type {number[]} */ pos, /** @type {number[]} */ nor, /** @type {number[]} */ uv, /** @type {number[]} */ col, /** @type {number[]} */ idx, /** @type {boolean} */ flat) {
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.setIndex(idx);
	// a sheet is bent by its lift: its normals follow the bend
	if (flat) g.computeVertexNormals();
	return g;
}

/** the materials, made once: a plant's body, its thin sheets (lit from both sides), its glossy fruit */
const materials = /** @type {Record<string, THREE.Material>} */ ({});
/** @param {'body' | 'sheet' | 'gloss'} kind */
export function material(kind) {
	return (materials[kind] ??=
		kind === 'sheet'
			? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide })
			: kind === 'gloss'
				? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.35 })
				: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
}

/** @typedef {'body' | 'sheet' | 'gloss' | 'prop'} Kind */
/**
 * Everything a plant is, gathered by material and merged at the end into one mesh each. Above or below the soil, all
 * one plant: the viewer cuts the soil away to show the roots.
 */
export class Bag {
	constructor() {
		/** @type {Record<Kind, THREE.BufferGeometry[]>} */
		this.parts = { body: [], sheet: [], gloss: [], prop: [] };
	}
	/** @param {Kind} kind @param {THREE.BufferGeometry} geometry @param {THREE.Matrix4} [m] */
	add(kind, geometry, m) {
		if (m) geometry.applyMatrix4(m);
		this.parts[kind].push(geometry);
		return this;
	}
	build() {
		const group = new THREE.Group();
		for (const kind of /** @type {const} */ (['body', 'sheet', 'gloss', 'prop'])) {
			const list = this.parts[kind];
			if (!list.length) continue;
			const merged = mergeGeometries(list);
			for (const g of list) g.dispose();
			if (!merged) continue;
			const mesh = new THREE.Mesh(merged, material(kind === 'prop' ? 'body' : kind));
			// a prop (a stake, a cane) stands by the plant but is not the plant: the viewer frames the plant
			mesh.userData.prop = kind === 'prop';
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
		return group;
	}
}

/**
 * A root and the roots it branches into, grown into the soil: it bends down (gravity) and wanders (stones, water),
 * its whole path drawn from its own chance so that a younger root is the first part of the older one.
 * @param {Bag} bag
 * @param {{
 *   seed: string, key: (string | number)[], from: THREE.Vector3, dir: THREE.Vector3, length: number, grown: number,
 *   radius: number, down?: number, wander?: number, laterals?: number, lateral?: number, order?: number, depth?: number,
 *   young: THREE.ColorRepresentation, old: THREE.ColorRepresentation, age?: number, floor?: number
 * }} o
 */
export function root(bag, o) {
	const { seed, key, from, length, radius, young, old } = o;
	const grown = clamp(o.grown);
	if (grown <= 0.002 || length * grown < 1e-4) return;
	const r = chance(seed, 'root', ...key);
	const down = o.down ?? 0.15, wander = o.wander ?? 0.35, order = o.order ?? 0, depth = o.depth ?? 2;
	const steps = Math.max(4, Math.min(24, Math.round(10 + length * 40)));
	const step = length / steps;
	/** the whole path, drawn in full every time */
	const path = [from.clone()];
	const dir = o.dir.clone().normalize();
	for (let i = 0; i < steps; i++) {
		dir.y -= down;
		dir.x += (r() * 2 - 1) * wander;
		dir.y += (r() * 2 - 1) * wander * 0.5;
		dir.z += (r() * 2 - 1) * wander;
		// roots stay in the soil
		if (dir.y > -0.05 && path[i].y > -0.004) dir.y = -0.25;
		dir.normalize();
		const next = path[i].clone().addScaledVector(dir, step);
		if (o.floor !== undefined && next.y < o.floor) next.y = o.floor + (next.y - o.floor) * 0.1;
		path.push(next);
	}
	// as far as it has grown: the first part of the path, the last piece cut short
	const reach = grown * steps;
	const whole = Math.floor(reach);
	const pts = path.slice(0, whole + 1);
	if (whole < steps) pts.push(path[whole].clone().lerp(path[whole + 1], reach - whole));
	if (pts.length < 2) return;
	const age = clamp(o.age ?? 0);
	const r0 = radius * (0.35 + 0.65 * grown);
	bag.add(
		'body',
		tube(pts, (u) => r0 * (1 - 0.7 * u), (u) => mix(old, young, u * 1.5 + 0.5 - age), order ? 4 : 5)
	);
	if (order >= depth) return;
	// its laterals: each starts at its place along it once the tip has passed there, and grows behind the tip
	const n = Math.round(o.laterals ?? 6);
	for (let i = 0; i < n; i++) {
		const at = between(r, 0.12, 0.85);
		const bear = r() * Math.PI * 2;
		const longer = between(r, 0.5, 1);
		const here = at * steps;
		if (here > reach - 0.6) {
			r();
			continue;
		}
		const k = Math.floor(here);
		const p = path[k].clone().lerp(path[k + 1], here - k);
		const along = path[k + 1].clone().sub(path[k]).normalize();
		const side = new THREE.Vector3(Math.cos(bear), 0, Math.sin(bear));
		const ldir = side.addScaledVector(along, 0.35).normalize();
		root(bag, {
			...o,
			key: [...key, i],
			from: p,
			dir: ldir,
			length: length * (o.lateral ?? 0.35) * longer,
			grown: (reach - here) / (steps * 0.55),
			radius: radius * 0.45,
			down: down * 0.6,
			laterals: Math.round(n * 0.6),
			order: order + 1,
			age: age * 0.6,
			floor: o.floor
		});
		r();
	}
}
