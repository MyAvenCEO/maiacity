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

/**
 * How finely a plant is made: 1 in the plants viewer, less when a world plants hundreds of it (`lite`). Below 1 every
 * tube has fewer sides and rings, every sheet fewer rows, every bead fewer facets — and with `roots` off nothing
 * under the soil is grown at all, which no one walking a forest sees; and with `thin` under 1 only that part of the
 * leaves, petals and beads is kept, each grown bigger to fill the gap (a crown seen from metres away reads the same).
 */
export const DETAIL = { level: 1, roots: true, thin: 1 };

/**
 * Builds with `make` at a lower detail (see DETAIL), and puts it back as it was.
 * @template T @param {{ level?: number, roots?: boolean }} o @param {() => T} make @returns {T}
 */
export function lite(o, make) {
	const keep = { ...DETAIL };
	Object.assign(DETAIL, o);
	try {
		return make();
	} finally {
		Object.assign(DETAIL, keep);
	}
}
/** a count of divisions at the present detail, never under `least` */
const fewer = (/** @type {number} */ n, least = 1) => (DETAIL.level >= 1 ? n : Math.max(least, Math.round(n * DETAIL.level)));

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
 * A tube swept along points, its radius changing along it (`radius(u, v)`, u 0 … 1 base to tip, v 0 … 1 round it — a
 * tomato's ribs), its frames carried along without twist. A root, a stem, a petiole, a tendril, a berry, a cucumber.
 * @param {THREE.Vector3[]} points
 * @param {(u: number, v: number) => number} radius
 * @param {Paint} paint
 * @param {number} [sides]
 */
export function tube(points, radius, paint, sides = 6) {
	if (DETAIL.level < 1) {
		sides = fewer(sides, 3);
		// every other point or more, the ends always kept
		const every = Math.max(1, Math.round(1 / DETAIL.level));
		if (every > 1 && points.length > 3) points = points.filter((_, i) => i % every === 0 || i === points.length - 1);
	}
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
		for (let s = 0; s <= sides; s++) {
			const a = (s / sides) * Math.PI * 2;
			const d = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
			const p = points[i].clone().addScaledVector(d, Math.max(0, radius(u, s / sides)));
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
			idx.push(a, a + 1, b, b, a + 1, b + 1);
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
	along = fewer(along, 2);
	across = fewer(across, 1);
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
	rings = fewer(rings, 1);
	rays = fewer(rays, 5);
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
	detail = fewer(detail, 2);
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
		/** what the plant has put where, for its fruit and leaves to keep clear of (see Space) */
		this.space = new Space();
		/** how far into the next sheet kept, when thinned (DETAIL.thin) */
		this.sheets = 0;
	}
	/** @param {Kind} kind @param {THREE.BufferGeometry} geometry @param {THREE.Matrix4} [m] */
	add(kind, geometry, m) {
		if (m) geometry.applyMatrix4(m);
		const isBead = geometry.type === 'SphereGeometry';
		if ((kind === 'sheet' || isBead) && DETAIL.thin < 1) {
			// keep one sheet (or bead) in so many, evenly, and grow it from where it is attached (a sheet's first vertex,
			// a bead's middle) to cover for the ones left out
			this.sheets = (this.sheets ?? 0) + DETAIL.thin;
			if (this.sheets < 1) return this;
			this.sheets -= 1;
			if (isBead) geometry.computeBoundingSphere();
			const at = isBead ? /** @type {THREE.Sphere} */ (geometry.boundingSphere).center.clone() : new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 0);
			const grow = Math.min(1.8, isBead ? 1 / Math.cbrt(DETAIL.thin) : 1 / Math.sqrt(DETAIL.thin));
			geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z)).applyMatrix4(new THREE.Matrix4().makeScale(grow, grow, grow)).applyMatrix4(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
		}
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
	if (!DETAIL.roots) return;
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

/**
 * SPACE — what a plant has already put where, so that what comes next keeps clear of it: its stems and stakes as rods
 * (capsules), its fruit as balls. A fruit looks for a way to hang that touches nothing (`settle`), a leaf turns on its
 * stalk away from the fruit and the stems (`steer`). Nothing here is physics: a search, the same every time.
 */
export class Space {
	constructor() {
		/** @type {{ c: THREE.Vector3, r: number }[]} */
		this.balls = [];
		/** @type {{ a: THREE.Vector3, b: THREE.Vector3, r: number }[]} */
		this.rods = [];
	}
	/** @param {THREE.Vector3} c @param {number} r */
	ball(c, r) {
		this.balls.push({ c: c.clone(), r });
	}
	/** a rod along a path, as a capsule per few points @param {THREE.Vector3[]} pts @param {number} r */
	rod(pts, r) {
		const step = Math.max(1, Math.floor(pts.length / 12));
		for (let i = 0; i + step < pts.length; i += step) this.rods.push({ a: pts[i].clone(), b: pts[Math.min(pts.length - 1, i + step)].clone(), r });
	}
	/** how deep a ball at c of radius r sinks into what is already there (0 when it touches nothing) */
	depth(/** @type {THREE.Vector3} */ c, /** @type {number} */ r) {
		let worst = 0;
		for (const b of this.balls) worst = Math.max(worst, r + b.r - c.distanceTo(b.c));
		const ab = new THREE.Vector3(), ac = new THREE.Vector3(), q = new THREE.Vector3();
		for (const s of this.rods) {
			ab.subVectors(s.b, s.a);
			ac.subVectors(c, s.a);
			const t = clamp(ac.dot(ab) / Math.max(1e-12, ab.lengthSq()));
			q.copy(s.a).addScaledVector(ab, t);
			worst = Math.max(worst, r + s.r - c.distanceTo(q));
		}
		return Math.max(0, worst);
	}
	/** how far a set of balls overlaps what is there, all told */
	overlap(/** @type {{ c: THREE.Vector3, r: number }[]} */ shape) {
		let sum = 0;
		for (const s of shape) sum += this.depth(s.c, s.r);
		return sum;
	}
	/**
	 * Where a fruit hangs: from `at`, along a direction near `dir`, its stalk perhaps a little longer, so that its
	 * balls (`shape(at, dir)`) touch nothing — or as little as can be. It keeps the place, and the fruit's balls are
	 * added to the space.
	 * @param {THREE.Vector3} at @param {THREE.Vector3} dir
	 * @param {(at: THREE.Vector3, dir: THREE.Vector3) => { c: THREE.Vector3, r: number }[]} shape
	 * @param {number} reach how far it may lengthen its stalk
	 */
	settle(at, dir, shape, reach) {
		const d0 = dir.clone().normalize();
		let best = { at: at.clone(), dir: d0, cost: Infinity };
		const side = new THREE.Vector3();
		for (const ext of [0, 0.5, 1]) {
			for (const swing of [0, 0.45, 0.9, 1.4, 2]) {
				for (let k = 0; k < (swing ? 8 : 1); k++) {
					const a = (k / 8) * Math.PI * 2;
					side.set(Math.cos(a), 0, Math.sin(a));
					const d = d0.clone().addScaledVector(side, swing).normalize();
					if (d.y > 0.35) continue;
					const p = at.clone().addScaledVector(d, ext * reach);
					const balls = shape(p, d);
					// below the soil is no place for a fruit either
					let cost = this.overlap(balls) * 10 + swing * 0.004 + ext * 0.003;
					for (const b of balls) cost += Math.max(0, b.r - b.c.y) * 10;
					if (cost < best.cost) best = { at: p, dir: d, cost };
				}
				if (best.cost < 0.004 * (swing + 0.5)) break;
			}
			if (best.cost < 0.01) break;
		}
		for (const b of shape(best.at, best.dir)) this.ball(b.c, b.r);
		return best;
	}
	/**
	 * Of a few ways to place a thing (each its balls, and how much less it is liked than the first), the one that touches
	 * least of what is already there — the first that touches nothing. Its balls are added to the space.
	 * @template T
	 * @param {{ balls: { c: THREE.Vector3, r: number }[], cost: number, data: T }[]} options
	 * @returns {T}
	 */
	best(options) {
		let pick = options[0], low = Infinity;
		for (const o of options) {
			let cost = this.overlap(o.balls) * 10 + o.cost;
			for (const b of o.balls) cost += Math.max(0, b.r - b.c.y) * 10;
			if (cost < low) {
				low = cost;
				pick = o;
			}
			if (cost <= o.cost + 1e-9) break;
		}
		for (const b of pick.balls) this.ball(b.c, b.r);
		return pick.data;
	}
	/**
	 * Which way a leaf reaches: its bearing turned as little as it needs so that its blade (points along it, out from
	 * `at`) keeps out of the fruit and the stems.
	 * @param {THREE.Vector3} at @param {THREE.Vector3} out level @param {number} lift @param {number} reach @param {number} r
	 */
	steer(at, out, lift, reach, r) {
		let best = { out: out.clone(), cost: Infinity };
		for (const turn of [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4]) {
			const o = out.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).setY(0).normalize();
			const d = o.clone().multiplyScalar(Math.cos(lift)).add(new THREE.Vector3(0, Math.sin(lift), 0));
			const across = new THREE.Vector3(-o.z, 0, o.x);
			let cost = Math.abs(turn) * 0.002;
			// along the midrib, and out to either side where the leaflets or the blade's edges reach
			for (const f of [0.3, 0.55, 0.8, 1]) {
				const p = at.clone().addScaledVector(d, reach * f).add(new THREE.Vector3(0, -reach * 0.12 * f * f, 0));
				cost += this.depth(p, r);
				for (const side of [-1, 1]) cost += this.depth(p.clone().addScaledVector(across, side * reach * 0.22), r * 0.8);
			}
			if (cost < best.cost) best = { out: o, cost };
			if (cost < 0.0005) break;
		}
		return best.out;
	}
}
