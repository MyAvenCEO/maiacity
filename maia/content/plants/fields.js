/*
 * FIELDS — the plants of the forest garden's mini fields, sown or planted many side by side: a stand of bamboo, a
 * strip of hemp, beds of lentils, edamame and chickpeas, a patch of oats. Each one is light — a few hundred to a few
 * thousand triangles, the bamboo more — so that hundreds can stand together, and each reads right among the rest.
 *
 * Bamboo (Phyllostachys, Bambus) runs: a piece of rhizome planted in spring sends up a thin shoot, and every spring
 * after, fat shoots in spotted papery sheaths push up from rhizomes running further out, each telescoping to its full
 * height in a few weeks — taller and thicker every year, six to eight metres in the end — before it branches, two
 * branches at a node, with fans of narrow leaves at their tips. Its culms are ringed at every node, a white bloom just
 * below; they yellow as they age, and the three-year-old ones are cut for canes.
 *
 * Hemp (Cannabis sativa, Nutzhanf) is one slender stalk two and a half metres tall in a summer, its leaves of five to
 * nine toothed leaflets spread like a hand, in pairs low down, one at a node higher up; the seed forms in clusters of
 * bracts at the top, and the lower leaves fall as it ripens.
 *
 * Lentil (Lens culinaris, Linse), chickpea (Cicer arietinum, Kichererbse) and soya (Glycine max, Sojabohne — picked
 * green as edamame) are the legumes, nodules on their roots: the lentil a low fine bush of feathery leaves ending in
 * tendrils, tiny white-lilac flowers and flat little pods; the chickpea a grey-green, hairy, upright bush of toothed
 * leaflets, its pods puffed up like little balloons; the soya upright and hairy, leaves of three, small purple flowers
 * and clusters of fuzzy pods all along the stem. The lentil's and chickpea's seed stays below as they come up; the
 * soya lifts its two fat seed leaves into the light.
 *
 * Oats (Avena sativa, Hafer) tiller into a tuft of stems a metre high, each with its nodes and its long blades, and an
 * open, nodding panicle of dangling spikelets, green and then golden.
 *
 * All at real measure (metres), the soil's surface at y = 0. Their many small leaves, pods and spikelets are gathered
 * into one geometry (Blades), thinned like any sheet when a world grows them lighter (DETAIL); their fine stalks
 * become flat ribbons there, rather than vanishing. Each entry is a plant as ./index.js lists it, with its food-forest
 * `layer`; ./index.js adds every entry of FIELDS to the library.
 */
import * as THREE from 'three';
import { Bag, DETAIL, about, bead, between, chance, clamp, lerp, root, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { noduled } from './allies.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/* ------------------------------------------------------------------------------------------------ shared */

const UP = v3(0, 1, 0);

/** @type {Map<string, THREE.Color>} the colours, each read from its text once (never changed: `mix` makes new ones) */
const COLOURS = new Map();
/** a colour by its text, read once */
const tint = (/** @type {THREE.ColorRepresentation} */ c) => {
	if (c instanceof THREE.Color) return c;
	const key = String(c);
	let got = COLOURS.get(key);
	if (!got) COLOURS.set(key, (got = new THREE.Color(c)));
	return got;
};
/** a colour between two, as a new THREE.Color */
const mix = (/** @type {THREE.ColorRepresentation} */ a, /** @type {THREE.ColorRepresentation} */ b, /** @type {number} */ t) => tint(a).clone().lerp(tint(b), clamp(t));

/** a point along a path at u (0 … 1) */
function point(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
	return pts[k].clone().lerp(pts[k + 1], f - k);
}
/** which way a path runs at u (0 … 1) */
function towards(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
	return pts[k + 1].clone().sub(pts[k]).normalize();
}
/** the first part of a path, to u (0 … 1) of its points */
function upto(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.floor(f);
	const out = pts.slice(0, k + 1).map((p) => p.clone());
	if (k < pts.length - 1 && f - k > 1e-4) out.push(pts[k].clone().lerp(pts[k + 1], f - k));
	if (out.length < 2) out.push(out[0].clone().add(v3(0, 1e-5, 0)));
	return out;
}

/** a level direction at the compass bearing a */
const level = (/** @type {number} */ a) => v3(Math.cos(a), 0, Math.sin(a));
/** a direction `tilt` (radians) from upright toward the level `out` */
const tilted = (/** @type {THREE.Vector3} */ out, /** @type {number} */ tilt) => out.clone().setY(0).normalize().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
/** the quaternion that turns +X to `d` (a bead's long axis) */
const alongX = (/** @type {THREE.Vector3} */ d) => new THREE.Quaternion().setFromUnitVectors(v3(1, 0, 0), d.clone().normalize());

/**
 * A stalk's points from `at`, setting out along `dir` and bowing down as it goes (up, for `bow` below 0).
 * @param {THREE.Vector3} at @param {THREE.Vector3} dir @param {number} length @param {number} bow @param {number} [n]
 */
function arch(at, dir, length, bow, n = 6) {
	const pts = [at.clone()];
	const d = dir.clone().normalize();
	for (let k = 0; k < n; k++) {
		d.y -= bow / n;
		d.normalize();
		pts.push(pts[k].clone().addScaledVector(d, length / n));
	}
	return pts;
}

/**
 * BLADES — the many small flat things of a plant (leaflets, grass blades, spikelets, bracts, pods, petals) and its
 * fine stalks as ribbons, gathered into one geometry of the double-sided sheet material, so that thousands are one
 * piece. Thinned as ./grow.js's Bag thins its sheets (DETAIL.thin, DETAIL.fill): one in so many kept and grown from
 * its base to cover for the rest; and made of fewer rows at a lower DETAIL.level, down to a single diamond.
 */
class Blades {
	constructor() {
		/** @type {number[]} */
		this.pos = [];
		/** @type {number[]} */
		this.col = [];
		/** @type {number[]} */
		this.idx = [];
		/** how far into the next one kept, when thinned */
		this.acc = 0;
	}
	/** how much bigger a thing this long is grown when kept at this detail; 0 when it is one of those left out */
	keep(/** @type {number} */ size, round = false) {
		if (DETAIL.thin >= 1 && DETAIL.fill === 1) return 1;
		this.acc += DETAIL.thin;
		if (this.acc < 1) return 0;
		this.acc -= 1;
		const most = Math.max(1, 0.14 / Math.max(1e-4, size / 2));
		return Math.min(2.6, most, round ? 1 / Math.cbrt(DETAIL.thin) : DETAIL.fill / Math.sqrt(DETAIL.thin));
	}
	/** a vertex, its index */
	vert(/** @type {THREE.Vector3} */ p, /** @type {THREE.ColorRepresentation} */ c) {
		const k = tint(c);
		this.pos.push(p.x, p.y, p.z);
		this.col.push(k.r, k.g, k.b);
		return this.pos.length / 3 - 1;
	}
	/**
	 * One blade from `at` along `dir`, its face toward `up`: `shape(u)` its half-width (0 … 1 of `width`) from base to
	 * tip; `fold` lifts its edges (a V along the midrib), `droop` bends its tip down, `twin` makes it two faces bulging
	 * apart along the midrib — a pod, a spikelet (one folded face at the lowest detail).
	 * @param {{
	 *   at: THREE.Vector3, dir: THREE.Vector3, up?: THREE.Vector3, length: number, width: number, shape: (u: number) => number,
	 *   segs: number, paint: THREE.ColorRepresentation | ((u: number, v: number) => THREE.ColorRepresentation),
	 *   fold?: number, droop?: number, twin?: number, round?: boolean, keep?: boolean
	 * }} o — `round` grows it as a bead is when thinned (less), `keep` never thins it
	 */
	add(o) {
		const s = o.keep ? 1 : this.keep(Math.max(o.length, o.width * 2), o.round);
		if (!s) return;
		const L = o.length * s, W = o.width * s;
		const X = o.dir.clone().normalize();
		let Z = new THREE.Vector3().crossVectors(X, o.up ?? UP);
		if (Z.lengthSq() < 1e-8) Z = new THREE.Vector3().crossVectors(X, Math.abs(X.y) < 0.9 ? UP : v3(1, 0, 0));
		Z.normalize();
		const Y = new THREE.Vector3().crossVectors(Z, X);
		const n = DETAIL.level >= 1 ? o.segs : Math.max(1, Math.round(o.segs * DETAIL.level));
		const { shape, at } = o;
		const droop = o.droop ?? 0, twin = o.twin ?? 0;
		const faces = twin && n > 1 ? [1, -1] : [1];
		const fold = (o.fold ?? 0) + (twin && n <= 1 ? twin : 0);
		const paint = typeof o.paint === 'function' ? o.paint : () => /** @type {THREE.ColorRepresentation} */ (o.paint);
		const place = (/** @type {number} */ u, /** @type {number} */ v, /** @type {number} */ f) => {
			const w = W * shape(u);
			const lift = w * (fold * Math.abs(v) + (faces.length > 1 ? f * twin : 0) * (1 - Math.abs(v)));
			return v3(at.x + X.x * u * L + Z.x * w * v + Y.x * lift, at.y + X.y * u * L + Z.y * w * v + Y.y * lift - droop * L * u * u, at.z + X.z * u * L + Z.z * w * v + Y.z * lift);
		};
		// at its least, a diamond of two triangles
		if (n === 1 && shape(0) < 1e-6 && shape(1) < 1e-6) {
			const b = this.vert(place(0, 0, 1), paint(0, 0)), t = this.vert(place(1, 0, 1), paint(1, 0));
			const l = this.vert(place(0.45, -1, 1), paint(0.45, -1)), r = this.vert(place(0.45, 1, 1), paint(0.45, 1));
			this.idx.push(b, l, t, b, t, r);
			return;
		}
		for (const f of faces) {
			/** @type {number[][]} each row's left edge, midrib, right edge */
			const rows = [];
			const wide = [];
			for (let i = 0; i <= n; i++) {
				const u = i / n;
				wide.push(shape(u) > 1e-6);
				rows.push([-1, 0, 1].map((v) => this.vert(place(u, v, f), paint(u, v))));
			}
			for (let i = 0; i < n; i++)
				for (const e of [0, 2]) {
					const a = rows[i][1], b = rows[i][e], c = rows[i + 1][1], d = rows[i + 1][e];
					if (wide[i]) this.idx.push(a, b, d);
					if (wide[i + 1]) this.idx.push(a, d, c);
				}
		}
	}
	/**
	 * A flat ribbon along a path, `width` wide, lying across `side` — a fine stalk as a world sees it from metres away.
	 * @param {THREE.Vector3[]} pts @param {number} width @param {(u: number) => THREE.ColorRepresentation} paint @param {THREE.Vector3} [side]
	 */
	strip(pts, width, paint, side = v3(1, 0, 0)) {
		if (DETAIL.level < 1) {
			const every = Math.max(1, Math.round(1 / DETAIL.level));
			if (every > 1 && pts.length > 2) pts = pts.filter((_, i) => i % every === 0 || i === pts.length - 1);
		}
		const n = pts.length;
		if (n < 2) return;
		let first = -1;
		for (let i = 0; i < n; i++) {
			const t = pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]);
			let across = new THREE.Vector3().crossVectors(t, side);
			if (across.lengthSq() < 1e-12) across = new THREE.Vector3().crossVectors(t, v3(0, 0, 1));
			if (across.lengthSq() < 1e-12) across = v3(1, 0, 0);
			across.normalize().multiplyScalar((width / 2) * (1 - 0.4 * (i / (n - 1))));
			const c = paint(i / (n - 1));
			const a = this.vert(pts[i].clone().add(across), c);
			this.vert(pts[i].clone().sub(across), c);
			if (first < 0) first = a;
			if (i) this.idx.push(a - 2, a - 1, a, a, a - 1, a + 1);
		}
	}
	/** how far it has got: where what is drawn next begins (see `pick`) */
	mark() {
		return { v: this.pos.length / 3, i: this.idx.length };
	}
	/**
	 * What was drawn here since `from` (a `mark()`), as a piece of the fruit `bag` is drawing (Bag.fruit): the bag
	 * only sees what goes through its own `add`, and blades go into it whole at the end. The piece is made only when
	 * asked for (the fruit viewer, `pickFruit`), so it costs next to nothing otherwise.
	 * @param {Bag} bag @param {{ v: number, i: number }} from
	 */
	pick(bag, from) {
		const fruit = bag.drawing;
		if (!fruit || this.idx.length === from.i) return;
		const v1 = this.pos.length / 3, i1 = this.idx.length;
		const { pos, col, idx } = this;
		/** @type {THREE.BufferGeometry | null} */
		let made = null;
		fruit.parts.push({
			kind: 'sheet',
			get geometry() {
				if (made) return made;
				made = new THREE.BufferGeometry();
				made.setAttribute('position', new THREE.Float32BufferAttribute(pos.slice(from.v * 3, v1 * 3), 3));
				made.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((v1 - from.v) * 2), 2));
				made.setAttribute('color', new THREE.Float32BufferAttribute(col.slice(from.v * 3, v1 * 3), 3));
				made.setIndex(idx.slice(from.i, i1).map((k) => k - from.v));
				made.computeVertexNormals();
				return made;
			}
		});
	}
	/** into the bag, as one piece of its sheets (past the bag's own thinning: it is thinned here) */
	into(/** @type {Bag} */ bag) {
		if (!this.idx.length) return;
		const geo = new THREE.BufferGeometry();
		const n = this.pos.length / 3;
		geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
		geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
		geo.setIndex(this.idx);
		geo.computeVertexNormals();
		bag.parts.sheet.push(geo);
	}
}

/**
 * A fine stalk: a tube at full detail; a ribbon when the world grows the plant lighter (where a tube this thin would be
 * left out, see DETAIL.finest); nothing at all when it is too fine even for that.
 * @param {Bag} bag @param {Blades} blades @param {THREE.Vector3[]} pts @param {number} r
 * @param {(u: number) => THREE.ColorRepresentation} paint @param {number} [sides] @param {THREE.Vector3} [side]
 */
function wire(bag, blades, pts, r, paint, sides = 4, side) {
	if (DETAIL.level >= 1 && r >= DETAIL.finest) bag.add('body', tube(pts, (u) => r * (1 - 0.35 * u), paint, sides));
	else if (r * 2 >= DETAIL.finest * 0.6) blades.strip(pts, r * 2.4, paint, side);
}

/** a legume's roots, its nodules on them — none when the world leaves out what is under the soil */
function legumeRoots(/** @type {Bag} */ bag, /** @type {Parameters<typeof noduled>[1]} */ o) {
	if (DETAIL.roots) noduled(bag, o);
}

/** leaf shapes: lanceolate, ovate, oval, a grass blade, a hemp leaflet (toothed, at full detail) */
const lance = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.8);
const ovate = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.75);
const oval = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * u), 0.7);
const grass = (/** @type {number} */ u) => Math.min(1, 0.55 + u * 6) * Math.pow(1 - u, 0.75);
const hempLeaflet = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.9) * (u > 0.1 && u < 0.95 ? 1 + 0.16 * Math.cos(u * Math.PI * 6) : 1);

/**
 * A pea flower (a lentil's, a chickpea's, a soya's): the standard petal up and back, the wings and the keel folded
 * forward; a closed bud before it opens.
 * @param {Blades} blades @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {number} size
 * @param {THREE.ColorRepresentation} colour @param {THREE.ColorRepresentation} keel @param {number} open @param {number} fall
 */
function peaFlower(blades, at, facing, size, colour, keel, open, fall) {
	if (fall >= 1) return;
	const f = facing.clone().setY(0);
	if (f.lengthSq() < 1e-8) f.set(1, 0, 0);
	f.normalize();
	const s = size * lerp(0.55, 1, open) * (1 - 0.3 * fall);
	const up = f.clone().lerp(v3(0, 1, 0).addScaledVector(f, -0.3), open).add(v3(0, -fall, 0)).normalize();
	blades.add({ at, dir: up, up: f.clone().negate(), length: s, width: s * lerp(0.25, 0.5, open), shape: oval, segs: 2, fold: -0.3, paint: (u) => mix(open > 0.3 ? colour : '#a8c080', colour, u + open), round: true });
	if (open > 0.2) blades.add({ at, dir: f.clone().add(v3(0, -0.25 - fall, 0)), length: s * 0.75, width: s * 0.22, shape: oval, segs: 2, twin: 0.6, paint: keel, round: true });
}

/**
 * A pinnate leaf (a lentil's, a chickpea's): its rachis out from `at`, leaflets in pairs along it, and a leaflet or a
 * tendril at its end. From far off (a world's lower detail) the whole leaf is one feathery blade.
 * @param {Bag} bag @param {Blades} blades
 * @param {{
 *   r: () => number, at: THREE.Vector3, out: THREE.Vector3, lift: number, length: number, pairs: number,
 *   leaflet: { length: number, width: number, shape: (u: number) => number, segs: number }, paint: (u: number, v: number) => THREE.Color,
 *   stalk: THREE.ColorRepresentation, radius: number, grown: number, old: number, terminal?: boolean, tendril?: number, drop?: number
 * }} o — `drop` the part of its leaflets fallen (an old leaf at harvest)
 */
function pinnateLeaf(bag, blades, o) {
	const g = clamp(o.grown);
	if (g <= 0.02) return;
	const len = o.length * lerp(0.3, 1, g);
	const lift = lerp(1.2, o.lift, g) - o.old * 0.5;
	const d = o.out.clone().setY(0).normalize().multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0)).normalize();
	const pts = arch(o.at, d, len, 0.3 + o.old * 0.4, 2);
	const leafLen = o.leaflet.length * lerp(0.35, 1, g), leafWide = o.leaflet.width * lerp(0.35, 1, g);
	const drop = o.drop ?? 0;
	if (DETAIL.level < 0.5) {
		if (o.r() < drop) return;
		const end = pts[pts.length - 1];
		blades.add({ at: o.at, dir: end.clone().sub(o.at), length: len + (o.terminal ? leafLen * 0.6 : 0), width: leafLen * 0.8, shape: oval, segs: 2, fold: 0.2, droop: 0.1, paint: o.paint(0.5, 0) });
		return;
	}
	wire(bag, blades, pts, o.radius, () => o.stalk, 3, o.out);
	const fold = 0.35 * (1 - g) + 0.12;
	for (let k = 0; k < o.pairs; k++) {
		const u = lerp(0.3, 0.92, o.pairs === 1 ? 1 : k / (o.pairs - 1));
		const p = point(pts, u), t = towards(pts, u);
		const across = new THREE.Vector3().crossVectors(t, UP);
		if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
		across.normalize();
		for (const side of [-1, 1]) {
			const size = lerp(0.8, 1, k / Math.max(1, o.pairs - 1)) * about(o.r, 1, 0.08);
			if (o.r() < drop) continue;
			const dir = across.clone().multiplyScalar(side * 0.85).addScaledVector(t, 0.45).add(v3(0, -0.1 - o.old * 0.4, 0)).normalize();
			blades.add({ at: p, dir, length: leafLen * size, width: leafWide * size, shape: o.leaflet.shape, segs: o.leaflet.segs, fold, droop: 0.08 + o.old * 0.3, paint: o.paint });
		}
	}
	const end = pts[pts.length - 1], t = towards(pts, 1);
	if (o.terminal && o.r() >= drop) blades.add({ at: end, dir: t, length: leafLen, width: leafWide, shape: o.leaflet.shape, segs: o.leaflet.segs, fold, droop: 0.1 + o.old * 0.3, paint: o.paint });
	// a tendril: a thread curling at the end of the rachis
	if (o.tendril) {
		const tp = [end.clone()];
		const td = t.clone();
		const axis = new THREE.Vector3().crossVectors(t, UP).normalize();
		for (let k = 0; k < 5; k++) {
			td.applyAxisAngle(axis, -0.55 * (k + 1) * 0.5).normalize();
			tp.push(tp[k].clone().addScaledVector(td, (o.tendril * g) / 5));
		}
		blades.strip(tp, 0.0007, () => o.stalk, o.out);
	}
}

/* ------------------------------------------------------------------------------------------------ bamboo */

export const BAMBOO_STAGES = stages([
	['Rhizome', 0, 'A piece of running rhizome, jointed and yellowish with fat buds at its nodes, laid a hand deep in spring.'],
	['First shoot', 30, 'A bud wakes: a thin shoot in papery sheaths pushes up and telescopes into a culm.'],
	['First culms', 120, 'A few thin culms a metre or two high, ringed at every node, two branches at a node and fans of narrow leaves.'],
	['Second year', 400, 'The rhizomes run out under the soil; new culms come up taller and thicker than the last.'],
	['Spring shoots', 730, 'Its third spring: fat conical shoots in brown spotted sheaths break the soil all round — dug at a hand high, they are eaten.'],
	['Culm extension', 760, 'Each shoot telescopes up, metres in a few weeks, its sheaths loosening and dropping as the nodes part.'],
	['Leafing out', 800, 'The new culms branch at their nodes and leaf out in fans; under the soil the rhizomes run again.'],
	['Grove', 1100, 'Its fourth spring: the tallest culms yet shoot up through the clump, five to six metres of them.'],
	['Mature grove', 1500, 'A grove six to eight metres high, the tops arching under their leaves; the older culms dull and yellowing.'],
	['Harvest', 1900, 'The oldest culms cut at the ground for canes, the stand thinned; some leaves yellow in the spring leaf change.']
]);

/**
 * The clump's culms, each born in its spring, as tall and thick as that year's: a few thin ones the first summer, then
 * taller each year, further out from where the rhizome was planted.
 * @param {string} seed
 */
function bambooCulms(seed) {
	const r = chance(seed, 'bamboo-clump');
	/** @type {[number, number, [number, number], number, [number, number], number][]} born, how many, height, diameter, how far out, how long it extends */
	const years = [
		[0.6, 3, [1.2, 2], 0.009, [0.02, 0.14], 0.9],
		[2.3, 4, [2.6, 3.6], 0.016, [0.12, 0.38], 1.2],
		[3.8, 4, [5, 6.4], 0.027, [0.2, 0.62], 1.5],
		[6.1, 3, [6.3, 7.6], 0.034, [0.38, 0.74], 1.3]
	];
	const list = [];
	let k = 0;
	for (let y = 0; y < years.length; y++) {
		const [b, count, [h0, h1], d, [r0, r1], dur] = years[y];
		for (let i = 0; i < count; i++, k++) {
			const H = between(r, h0, h1);
			const a = k * 2.39996 + r() * 0.8;
			const out = between(r, r0, r1);
			list.push({ key: k, year: y, born: b + i * 0.16 + r() * 0.14, H, D: d * (H / ((h0 + h1) / 2)) * about(r, 1, 0.08), at: v3(Math.cos(a) * out, 0, Math.sin(a) * out), dur, lean: between(r, 0.02, 0.1), turn: r() * Math.PI * 2 });
		}
	}
	return list;
}

/** a bamboo leaf: broadest a third of the way, drawn out to a long fine tip */
const bambooLeaf = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.55)), 0.8);

/**
 * Bamboo at a stage (0 … 9, between them on the way) from the seed id: one running clump.
 * @param {number} g @param {string} seed
 */
export function bamboo(g, seed) {
	const bag = new Bag(), blades = new Blades();
	const culms = bambooCulms(seed);
	// the planted rhizome, its buds, and the rhizomes run out from it to every culm, roots at their nodes
	if (DETAIL.roots) {
		const piece = [v3(-0.14, -0.11, 0.02), v3(0, -0.12, 0), v3(0.14, -0.11, -0.02)];
		bag.add('body', tube(piece, () => 0.007, (u) => mix('#d8c48a', '#b8a060', Math.abs(Math.sin(u * 22)) > 0.92 ? 1 : 0), 6));
		for (const x of [-0.07, 0.07]) if (g < 1.5) bag.add('body', bead(v3(x, -0.105, 0), v3(0.008, 0.01, 0.008), '#c8a868', 4));
		for (let i = 0; i < 3; i++) root(bag, { seed, key: ['piece', i], from: point(piece, i / 2), dir: v3(0.3 - i * 0.3, -1, 0.2), length: 0.25, grown: table(g, [[0, 0.05], [1, 0.4], [3, 1]]), radius: 0.0016, laterals: 3, depth: 1, young: '#f0e8d0', old: '#a88a5a' });
		for (const c of culms) {
			const grown = span(g, c.born - 1.1, c.born);
			if (grown <= 0 || c.at.length() < 0.03) continue;
			const from = c.year === 0 ? v3(0, -0.12, 0) : culms[Math.max(0, c.key - 4)].at.clone().setY(-0.14);
			const to = c.at.clone().setY(-0.13);
			const mid = from.clone().lerp(to, 0.5).add(v3(0, -0.04, 0));
			const pts = upto([from, from.clone().lerp(mid, 0.5), mid, mid.clone().lerp(to, 0.5), to, c.at.clone().setY(-0.02)], grown);
			bag.add('body', tube(pts, () => Math.max(0.004, c.D * 0.3), (u) => mix('#e0cc90', '#b8a060', Math.abs(Math.sin(u * 30)) > 0.93 ? 1 : 0), 4));
			if (grown >= 1) root(bag, { seed, key: ['rhizome', c.key], from: point(pts, 0.7), dir: v3(0, -1, 0), length: 0.2, grown: span(g, c.born, c.born + 1.5), radius: 0.0012, laterals: 1, depth: 1, young: '#f0e8d0', old: '#a88a5a' });
		}
	}
	for (const c of culms) bambooCulm(bag, blades, seed, c, g);
	blades.into(bag);
	return bag.build();
}

/**
 * One culm: a shoot in its sheaths, telescoping up, then a ringed pole with two branches at a node and fans of leaves.
 * @param {Bag} bag @param {Blades} blades @param {string} seed @param {ReturnType<typeof bambooCulms>[number]} c @param {number} g
 */
function bambooCulm(bag, blades, seed, c, g) {
	if (g <= c.born) return;
	const r = chance(seed, 'bamboo-culm', c.key);
	const grow = span(g, c.born, c.born + c.dur);
	const cut = c.year === 0 && g > 8.5;
	const age = g - c.born - c.dur;
	const h = cut ? 0.12 : Math.max(0.02, c.H * grow);
	const branched = cut ? 0 : span(g, c.born + c.dur * 0.85, c.born + c.dur + 0.3);
	const leafy = cut ? 0 : span(g, c.born + c.dur + 0.05, c.born + c.dur + 0.6);
	// the nodes: short internodes at the foot and the tip, the longest in the middle
	const N = Math.max(8, Math.round(c.H / 0.22) + 4);
	const lens = [];
	for (let k = 0; k < N; k++) lens.push((k < 3 ? 0.35 + k * 0.2 : 1) * (0.35 + Math.pow(Math.sin(Math.PI * Math.min(1, ((k + 0.5) / N) * 1.2)), 0.6)));
	const sum = lens.reduce((a, b) => a + b, 0);
	const nodes = [0];
	for (let k = 0; k < N; k++) nodes.push(nodes[k] + (lens[k] / sum) * c.H);
	// leaning out of the clump, the top arching further under its leaves
	const out = c.at.length() > 0.02 ? c.at.clone().setY(0).normalize() : level(c.turn);
	const bend = (0.03 + r() * 0.04) * leafy;
	const P = (/** @type {number} */ z) => c.at.clone().add(v3(0, z - 0.03, 0)).addScaledVector(out, Math.sin(c.lean) * z + bend * c.H * Math.pow(z / c.H, 3));
	const R = (/** @type {number} */ z) => (c.D / 2) * (1 - 0.6 * (z / c.H));
	// the shoot's tip, still in its sheaths, while it extends
	const cone = grow < 1 && !cut ? Math.min(h, 0.12 + c.D * 6) : 0;
	const pole = h - cone * 0.8;
	const colour = mix(mix('#3f7a2a', '#5f8a34', age / 2.5), '#9a9a46', (age - 2.5) / 3);
	if (pole > 0.01) {
		/** @type {THREE.Vector3[]} */
		const pts = [];
		/** @type {number[]} */
		const zs = [];
		for (let k = 0; k <= N; k++) {
			const z = nodes[k];
			if (z >= pole) break;
			// just below the node its white bloom, at the node its ring
			if (k && z - 0.015 > (zs[zs.length - 1] ?? -1)) (zs.push(z - 0.015), pts.push(P(z - 0.015)));
			zs.push(z), pts.push(P(z));
		}
		zs.push(pole), pts.push(P(pole));
		const ring = (/** @type {number} */ z) => {
			for (let k = 1; k <= N; k++) {
				const d = z - nodes[k];
				if (Math.abs(d) < 0.002) return 2;
				if (d < 0 && d > -0.02) return 1;
			}
			return 0;
		};
		const ends = zs[zs.length - 1];
		bag.add(
			'body',
			tube(pts, (u) => R(u * ends) * (ring(u * ends) === 2 ? 1.1 : 1), (u) => {
				const k = ring(u * ends);
				return k === 2 ? mix(colour, '#6a6a2a', 0.4) : k === 1 ? mix(colour, '#c8d0b8', 0.45 * clamp(1.5 - age / 3)) : colour;
			}, 5)
		);
		if (cut) bag.add('body', bead(P(0.12), v3(R(0.12), 0.002, R(0.12)), '#e8d8a8', 5));
	}
	if (cone > 0) {
		// the sheathed tip: brown and spotted, green at its very tip
		const z0 = h - cone;
		const spots = r() * 10;
		bag.add('body', tube([P(z0), P(z0 + cone * 0.5), P(h)], (u) => R(z0) * 1.25 * Math.pow(1 - u, 0.7) + 0.0008, (u, v) => mix(Math.sin(u * 37 + v * 23 + spots) > 0.75 ? '#3a2a1a' : '#8a6a42', '#6a8a3a', (u - 0.75) * 4), 6));
	}
	if (cut) return;
	const leafSize = (c.year === 0 ? 0.75 : c.year === 1 ? 0.88 : 1) * lerp(0.3, 1, leafy);
	const yellow = g > 8.5 ? 0.22 : 0;
	const zone = c.H * (c.year < 2 ? 0.25 : 0.32);
	const side0 = r() * Math.PI * 2;
	for (let k = 1; k < N; k++) {
		const z = nodes[k];
		if (z > pole - 0.02) break;
		const nr = chance(seed, 'bamboo-node', c.key, k);
		// the sheath at each node while the culm is young, from the lowest up they drop
		const shed = span(g, c.born + c.dur * (0.5 + 0.5 * (z / c.H)), c.born + c.dur * (0.5 + 0.5 * (z / c.H)) + 0.35);
		if (shed < 1) {
			const sl = Math.min(nodes[k + 1] - z, 0.06 + c.D * 5) * 0.85;
			bag.add('body', tube([P(z), P(z + sl * 0.5), P(z + sl)], (u) => R(z) * (1.18 + shed * 0.5 * u) * (1 - 0.15 * u), (u, v) => mix(Math.sin(u * 29 + v * 17 + k) > 0.8 ? '#5a3a24' : '#c0a070', '#d8c8a0', shed), 5));
		}
		if (z < zone || branched <= 0) continue;
		// two branches at a node, the bigger and the smaller, on the side that changes node to node
		const t = (z - zone) / Math.max(0.01, c.H - zone);
		const reach = c.H * 0.16 * lerp(1, 0.4, t) * (c.year === 0 ? 1.3 : 1) * branched;
		for (const [m, part] of [[0, 1], [1, 0.62]]) {
			const bear = side0 + k * Math.PI + (m ? 0.5 : -0.5) + about(nr, 0, 0.2);
			const d = tilted(level(bear), between(nr, 0.8, 1.05));
			const at = P(z).addScaledVector(level(bear), R(z));
			const pts = arch(at, d, reach * part, 0.25 + 0.2 * leafy, 3);
			const rb = Math.max(0.0012, c.D * 0.08 * part);
			if (DETAIL.level >= 1) bag.add('body', tube(pts, (u) => rb * (1 - 0.6 * u), () => mix(colour, '#7a8a3a', 0.3), 3));
			else if (rb >= DETAIL.finest) blades.strip(pts, rb * 2.4, () => colour, UP);
			if (leafy <= 0) continue;
			// fans of narrow leaves along it and at its tip, hanging (fewer, each grown bigger, when a world thins it)
			const long = reach * part > 0.25;
			const fans = DETAIL.thin < 1 ? (long ? [0.45, 0.75, 1] : [0.6, 1]) : long ? [0.35, 0.6, 0.8, 1] : [0.4, 0.7, 1];
			for (const f of fans) {
				const p = point(pts, f), td = towards(pts, f);
				const count = 2 + Math.floor(nr() * 3);
				for (let j = 0; j < count; j++) {
					const fan = level(bear + (j - (count - 1) / 2) * 0.7 + about(nr, 0, 0.15));
					const dir = fan.multiplyScalar(0.85).addScaledVector(td, 0.4).add(v3(0, lerp(0.6, -0.45, leafy), 0)).normalize();
					const Ll = 0.145 * leafSize * about(nr, 1, 0.15);
					const old = nr() < yellow ? 1 : 0;
					blades.add({ at: p, dir, length: Ll, width: Ll * 0.085, shape: bambooLeaf, segs: 2, fold: 0.15, droop: 0.25, paint: (u, v) => mix(mix(mix('#8ab84a', '#3f7a2e', leafy), '#5a9040', Math.abs(v) < 0.1 ? 0.3 : 0), '#d0b450', old) });
				}
			}
		}
	}
}

/* ------------------------------------------------------------------------------------------------ hemp */

export const HEMP_STAGES = stages([
	['Seed', 0, 'A small smooth grey-brown seed, marbled, two centimetres down in warm spring soil — sown thick, so the stalks grow tall and slender.'],
	['Germination', 4, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 8, 'Two small oval seed leaves.'],
	['First pairs', 18, 'The first true leaves in pairs: a single toothed leaflet, then three, then five.'],
	['Vegetative', 40, 'Growing fast, leaves of seven and nine leaflets spread like hands, in pairs a quarter-turn apart.'],
	['Stretch', 65, 'Shooting up two metres and more, the leaves now one at a node, spiralling up the stalk.'],
	['Flowering', 85, 'At the top and the short side shoots, clusters of small bracts with white pistils; the pollen drifts in the wind.'],
	['Seed set', 100, 'Seeds swell in the bracts; the lowest leaves yellow.'],
	['Ripening', 115, 'The seed heads turn brown-grey, the leaves fall from the bottom up.'],
	['Harvest', 125, 'Seed threshed from the heads; the bare stalks cut and laid in the field to ret for their fibre.']
]);

/**
 * Hemp at a stage (0 … 9, between them on the way) from the seed id: one slender stalk, as it grows sown thick.
 * @param {number} g @param {string} seed
 */
export function hemp(g, seed) {
	const bag = new Bag(), blades = new Blades();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.02, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0022, 0.0015, 0.0017), coat: '#7a7458', coatShade: '#4a4232',
		stem: table(g, [[0, 0], [0.3, 0.001], [1, 0.025], [2, 0.042], [9, 0.045]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0011 + 0.0015 * span(g, 1.5, 4), stemColor: '#6a8a3a',
		leaf: { length: 0.013, width: 0.0055, shape: oval, color: '#5f9a40', vein: '#9ac470' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 3.6, 4.6)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.6, grown: table(g, [[0, 0], [0.3, 0.02], [1, 0.08], [3, 0.3], [5, 0.8], [6, 1]]), radius: 0.0016 + 0.004 * span(g, 3, 7), down: 0.06, wander: 0.18, laterals: 7, lateral: 0.35, depth: 1, age: span(g, 3, 8), young: '#f4ead6', old: '#b8986a' });
	const Hmax = 2.5 * vigour;
	const L = table(g, [[1.6, 0], [2, 0.012], [3, 0.1], [4, 0.45], [5, 1.35], [6, 2.05], [7, 2.4], [9, 2.5]]) * vigour;
	if (L < 0.003) {
		blades.into(bag);
		return bag.build();
	}
	const r = chance(seed, 'hemp-stalk');
	// the nodes up the stalk, short at the foot and in the head
	const N = 20;
	const lens = [];
	for (let k = 0; k < N; k++) lens.push(0.3 + Math.pow(Math.sin(Math.PI * Math.min(1, ((k + 0.5) / N) * 1.15)), 0.8));
	const sum = lens.reduce((a, b) => a + b, 0);
	const nodes = [0.02];
	for (let k = 0; k < N; k++) nodes.push(nodes[k] + (lens[k] / sum) * Hmax * 0.96);
	const lean = v3(r() - 0.5, 0, r() - 0.5).multiplyScalar(0.05);
	const base = s.top.clone();
	const full = nodes.map((z) => base.clone().add(v3(lean.x * z + 0.012 * Math.sin(z * 3 + r()), z, lean.z * z + 0.012 * Math.cos(z * 2.6))));
	full.push(base.clone().add(v3(lean.x * Hmax, Hmax, lean.z * Hmax)));
	const zAt = (/** @type {number} */ z) => {
		let k = 0;
		while (k < nodes.length - 1 && nodes[k + 1] < z) k++;
		const z1 = k + 1 < nodes.length ? nodes[k + 1] : Hmax;
		return full[k].clone().lerp(full[k + 1], clamp((z - nodes[k]) / Math.max(1e-6, z1 - nodes[k])));
	};
	const ripe = span(g, 8, 9.2);
	const stalkColour = (/** @type {number} */ u) => mix(mix('#5a7a34', '#7a9a44', u), '#b8a878', ripe);
	const stem = [base.clone(), ...full.filter((_, k) => k < nodes.length && nodes[k] < L).slice(1)];
	stem.push(zAt(L));
	const Rb = 0.0016 + 0.0055 * span(g, 3, 6.5) * vigour;
	bag.add('body', tube(stem, (u) => Rb * (1 - 0.75 * u), stalkColour, 6));
	const flowering = span(g, 5.6, 6.3), seeding = span(g, 6.6, 7.6);
	const b0 = r() * Math.PI * 2;
	const leaflets = [1, 3, 5, 7, 7, 9, 9, 9, 9, 9, 7, 7, 7, 7, 5, 5, 5, 3, 3, 1];
	for (let k = 0; k < N; k++) {
		const z = nodes[k + 1] - 0.005;
		if (z > L - 0.01) break;
		const f = k / N;
		const kr = chance(seed, 'hemp-node', k);
		const p = zAt(z);
		const grown = clamp((L - z) / 0.28);
		// low on the stalk the leaves fall first as the seed ripens
		const old = span(g, 6.1 + 2.8 * f, 7.1 + 2.8 * f);
		const fallen = g > 7.3 + 2.8 * f;
		const head = k >= N - 7;
		const size = (0.05 + 0.1 * Math.pow(Math.sin(Math.PI * Math.min(1, (k + 1.5) / (N * 0.8))), 0.7)) * vigour * (head ? 0.6 : 1);
		// in pairs below, one at a node above
		const pair = k < 6;
		for (const side of pair ? [0, 1] : [0]) {
			const bear = pair ? b0 + (k * Math.PI) / 2 + side * Math.PI : b0 + k * 2.39996;
			if (!fallen) palmate(bag, blades, kr, p, level(bear + about(kr, 0, 0.15)), leaflets[k], size, grown, old);
			// in the axil, a little leafy shoot of its own
			if (!pair && !head && !fallen && g > 4.2) palmate(bag, blades, kr, p.clone().add(v3(0, 0.01, 0)), level(bear + 0.5), 5, size * 0.45, grown * span(g, 4.2 + f, 5 + f), old);
			// a short side shoot from the upper axils, its own little head at the tip
			if (!pair && k >= 8 && k < N - 4 && kr() < 0.4) {
				const reach = (0.12 + 0.2 * kr()) * span(g, 4.5 + f, 5.6 + f) * vigour;
				if (reach > 0.01) {
					const sp = arch(p, tilted(level(bear + 0.4), 0.55), reach, -0.25, 3);
					wire(bag, blades, sp, 0.0018, stalkColour, 4, UP);
					for (let j = 0; j < 2; j++) if (!fallen) palmate(bag, blades, kr, point(sp, 0.4 + j * 0.3), level(bear + (j ? 1 : -1)), 5, size * 0.55, grown, old);
					hempHead(blades, kr, point(sp, 1), towards(sp, 1), 0.6, flowering, seeding, ripe);
				}
			}
		}
		if (head) hempHead(blades, kr, p, v3(0, 1, 0), 0.9 + 0.9 * (k - (N - 7)) / 7, flowering, seeding, ripe);
	}
	// the top: the biggest head
	if (L > Hmax * 0.8) hempHead(blades, chance(seed, 'hemp-top'), zAt(L - 0.06), v3(0, 1, 0), 2.6, flowering, seeding, ripe);
	blades.into(bag);
	return bag.build();
}

/**
 * A hemp leaf: a long stalk, its toothed leaflets spread like a hand from the end, the middle one longest, all drooping
 * a little; folded up while young, hanging and yellow when old.
 * @param {Bag} bag @param {Blades} blades @param {() => number} r @param {THREE.Vector3} at @param {THREE.Vector3} out
 * @param {number} count @param {number} size the middle leaflet's length @param {number} grown @param {number} old
 */
function palmate(bag, blades, r, at, out, count, size, grown, old) {
	if (grown <= 0.02) return;
	const pet = size * 0.75 * lerp(0.3, 1, grown);
	const pts = arch(at, tilted(out, lerp(0.35, 0.95, grown) + old * 0.4), pet, 0.15 + old * 0.3, 3);
	wire(bag, blades, pts, 0.0011 + size * 0.008, () => mix('#5a8a3a', '#c8b060', old), 3, UP);
	const end = pts[pts.length - 1];
	const across = level(Math.atan2(out.z, out.x));
	const spread = count > 1 ? Math.min(0.42, 2.9 / (count - 1)) : 0;
	const green = mix(mix('#7aa848', '#356a28', grown), '#c8b448', old);
	const vein = mix(green, '#a8c888', 0.35);
	for (let j = 0; j < count; j++) {
		const a = (j - (count - 1) / 2) * spread;
		const len = size * lerp(0.35, 1, grown) * (1 - 0.5 * Math.pow(Math.abs(a) / 1.5, 1.4)) * about(r, 1, 0.05);
		const lift = lerp(0.9, 0.12, grown) - old * 0.7 + Math.abs(a) * 0.08;
		const d = across.clone().applyAxisAngle(UP, -a).multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0)).normalize();
		blades.add({ at: end, dir: d, length: len, width: len * 0.11, shape: hempLeaflet, segs: 6, fold: 0.3 * (1 - grown) + 0.12, droop: 0.22 * grown + old * 0.3, paint: (u, v) => (Math.abs(v) < 0.1 ? vein : green) });
	}
}

/**
 * A cluster of hemp's flowers: small toothed leaves and bracts crowding round in a spiral, white pistils from the
 * bracts while it flowers, seeds swelling in them, all browning as it ripens.
 * @param {Blades} blades @param {() => number} r @param {THREE.Vector3} at @param {THREE.Vector3} up @param {number} size
 * @param {number} flowering @param {number} seeding @param {number} ripe
 */
function hempHead(blades, r, at, up, size, flowering, seeding, ripe) {
	if (flowering <= 0) return;
	const count = Math.round(8 + 10 * size);
	const leaf = mix(mix('#4f8a36', '#3f7030', seeding), '#8a7448', ripe);
	const bract = mix(mix('#8ab858', '#6a9a44', seeding), '#9a8050', ripe);
	for (let m = 0; m < count; m++) {
		const a = m * 2.39996 + r();
		const k = m / count;
		const p = at.clone().addScaledVector(up, k * 0.1 * size).addScaledVector(level(a), 0.004 * size * (1 - k));
		const isLeaf = m % 2 === 0;
		// the leaves reach out further, the bracts sit close in round the seeds
		const d = up.clone().multiplyScalar(isLeaf ? 0.8 : 1.4).add(level(a)).normalize();
		const len = (isLeaf ? 0.025 + 0.025 * r() : 0.012 + 0.008 * r()) * Math.sqrt(size) * lerp(0.5, 1, flowering) * (1 - 0.35 * k);
		blades.add({ at: p, dir: d, length: len, width: len * (isLeaf ? 0.16 : 0.32), shape: isLeaf ? hempLeaflet : oval, segs: isLeaf ? 3 : 2, fold: 0.3, droop: isLeaf ? 0.15 : 0, paint: isLeaf ? leaf : bract });
		if (isLeaf) continue;
		// the pistils, white hairs out of the bracts while it is in flower
		if (flowering > 0.3 && seeding < 0.7) blades.add({ at: p, dir: d.clone().add(level(a + 1)).normalize(), length: len * 0.8, width: len * 0.06, shape: oval, segs: 1, paint: mix('#f2eee0', '#c8a878', seeding) });
		// a seed in it, swelling, greying and mottled as it ripens
		if (seeding > 0 && DETAIL.level >= 0.5) blades.add({ at: p.clone().addScaledVector(d, len * 0.2), dir: d, length: 0.004 * seeding, width: 0.0016 * seeding, shape: oval, segs: 2, twin: 0.8, paint: mix('#8a9a5a', '#6a6050', ripe), round: true });
	}
}

/* ------------------------------------------------------------------------------------------------ lentil */

export const LENTIL_STAGES = stages([
	['Seed', 0, 'A small flat lens of a seed, green-brown, two or three centimetres down in early spring — it does not mind the cold.'],
	['Germination', 7, 'The root goes down; the seed itself stays below, and a hooked shoot pushes up from it.'],
	['First leaves', 14, 'Above two scale leaves, the first leaf: a pair of small oval leaflets and a bristle.'],
	['Seedling', 24, 'Leaves of more leaflet pairs, side stems from the base.'],
	['Branching', 38, 'A low, fine, bushy plant, feathery pinnate leaves ending in little tendrils that catch on its neighbours.'],
	['Flowering', 52, 'Tiny white flowers veined with lilac, one or two on a short stalk from the upper axils.'],
	['Pods set', 60, 'Behind the flowers, small flat pods.'],
	['Green pods', 72, 'Pods full, one or two lentils in each; on the roots, the pink nodules have been fixing nitrogen all along.'],
	['Drying', 88, 'Leaves yellowing from the bottom up, the pods turning tan.'],
	['Harvest', 100, 'The whole plant dry and straw-coloured, the lentils rattling in their pods: pulled or cut, and threshed.']
]);

/**
 * The lentil at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function lentil(g, seed) {
	const bag = new Bag(), blades = new Blades();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.025, 0);
	// hypogeal, as the bean: the seed stays below, the shoot rises from it
	const s = sprout(bag, {
		seed, at, size: v3(0.0026, 0.0011, 0.0026), coat: '#8a7a48', coatShade: '#5a4a2a',
		stem: table(g, [[0, 0], [0.4, 0.002], [1, 0.022], [1.6, 0.03], [9, 0.03]]), hook: table(g, [[0, 1], [1.1, 1], [1.6, 0]]),
		radius: 0.0006, stemColor: '#6a8a3a', leaf: { length: 0.0005, width: 0.0003, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
		open: 0, shed: span(g, 4, 5.5), wither: 1, keepCoat: true
	});
	legumeRoots(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.3, grown: table(g, [[0, 0], [0.4, 0.04], [1, 0.15], [3, 0.5], [5, 0.9], [6, 1]]), radius: 0.0012, nodules: 10, laterals: 3, age: span(g, 3, 6) });
	const dry = span(g, 7.4, 8.8), straw = span(g, 8.4, 9.2);
	const ctx = { bag, blades, seed, g, vigour, dry, straw };
	const r = chance(seed, 'lentil');
	const stems = 3 + Math.floor(r() * 2);
	for (let j = 0; j < stems; j++) {
		const born = j ? 2.7 + j * 0.25 : 1.3;
		const max = 0.42 * vigour * (j ? between(r, 0.7, 0.9) : 1);
		const reach = max * table(g - (j ? 0.3 : 0), [[1.3, 0], [2, 0.05], [3, 0.2], [4, 0.5], [5, 0.8], [6, 0.95], [7, 1]]);
		if (g <= born) break;
		lentilStem(ctx, [j], s.top.clone(), tilted(level(j * 2.39996 + r()), j ? between(r, 0.7, 1.05) : between(r, 0.15, 0.35)), max, reach, 0);
	}
	blades.into(bag);
	return bag.build();
}

/**
 * A lentil stem: fine, zigzag at its nodes, a leaf at each node, the flowers and pods from the upper axils; a side
 * stem or two from its lower nodes.
 * @param {{ bag: Bag, blades: Blades, seed: string, g: number, vigour: number, dry: number, straw: number }} ctx
 * @param {number[]} key @param {THREE.Vector3} from @param {THREE.Vector3} dir @param {number} max @param {number} reach @param {number} order
 */
function lentilStem(ctx, key, from, dir, max, reach, order) {
	const { bag, blades, seed, g, dry, straw } = ctx;
	if (reach < 0.004) return;
	const r = chance(seed, 'lentil-stem', ...key);
	const d = dir.clone().normalize();
	const full = [from.clone()];
	for (let k = 0; k < 10; k++) {
		d.lerp(UP, 0.07).add(v3((r() - 0.5) * 0.15, 0, (r() - 0.5) * 0.15)).normalize();
		full.push(full[k].clone().addScaledVector(d, max / 10));
	}
	const pts = upto(full, reach / max);
	const stalk = (/** @type {number} */ u) => mix(mix('#5a8a38', '#7aa04a', u), '#cdb47c', dry + straw);
	wire(bag, blades, pts, order ? 0.0011 : 0.0016, stalk, 4, UP);
	const nodes = Math.floor(max / 0.036);
	const b0 = r() * Math.PI * 2;
	for (let n = 1; n < nodes; n++) {
		const f = n / nodes;
		const h = f * max;
		if (h > reach - 0.004) break;
		const nr = chance(seed, 'lentil-node', ...key, n);
		const p = point(full, f);
		const bear = b0 + n * Math.PI + about(nr, 0, 0.3);
		const grown = clamp((reach - h) / 0.05);
		const old = clamp(dry * 1.6 - f * 0.6) * (1 - straw * 0.3) + straw * 0.3;
		const pairs = order ? 3 : n < 2 ? 1 : n < 4 ? 3 : 3 + Math.floor(nr() * 2);
		pinnateLeaf(bag, blades, {
			r: nr, at: p, out: level(bear), lift: 0.55, length: (0.018 + 0.026 * clamp(n / 5)) * ctx.vigour, pairs,
			leaflet: { length: 0.013, width: 0.0038, shape: oval, segs: 2 }, paint: (u, v) => mix(mix(mix('#8ab860', '#4f8436', grown), '#7aa85a', Math.abs(v) < 0.1 ? 0.3 : 0), mix('#d2c070', '#c8b080', u), old),
			stalk: mix('#6a9a42', '#cdb47c', old), radius: 0.0005, grown, old, tendril: n >= 3 ? 0.012 : 0, drop: straw * 0.5
		});
		// side stems from the lower nodes of the main stems
		if (!order && (n === 2 || n === 4) && g > 3.4) lentilStem(ctx, [...key, n], p, tilted(level(bear + Math.PI * 0.5), 0.95), max * 0.5, max * 0.45 * span(g, 3.4 + n * 0.1, 5.4), 1);
		// one or two flowers from the upper axils, opening from the bottom up, a pod behind each that sets
		if (f < 0.4 || n < 3) continue;
		const opens = 4.5 + f * 0.9 + nr() * 0.3;
		if (g < opens - 0.3) continue;
		const fout = level(bear + Math.PI * 0.4);
		const ped = arch(p, tilted(fout, 0.6), 0.014, 0.1, 1);
		const end = ped[ped.length - 1];
		wire(bag, blades, ped, 0.0004, stalk, 3, UP);
		const count = 1 + (nr() < 0.4 ? 1 : 0);
		for (let m = 0; m < count; m++) {
			const o = opens + m * 0.15;
			const open = span(g, o - 0.3, o), fall = span(g, o + 0.5, o + 0.7);
			const set = nr() < 0.75 ? span(g, o + 0.5, o + 1.6) : 0;
			const fa = end.clone().addScaledVector(level(bear + m * 2), 0.003);
			if (set < 0.05) peaFlower(blades, fa, fout, 0.006, '#f4f0f4', '#c8b0e0', open, fall);
			else {
				const len = 0.014 * lerp(0.4, 1, set);
				const pd = level(bear + m * 1.4 - 0.3).multiplyScalar(0.6).add(v3(0, -0.4, 0)).normalize();
				const seeds = 1 + (nr() < 0.5 ? 1 : 0);
				// one pod (the stalk it shares with its twin left on the plant)
				bag.fruit([...key, n, m], fa, pd);
				const from = blades.mark();
				blades.add({ at: fa, dir: pd, up: level(bear + m * 1.4 - 0.3 + Math.PI / 2), length: len, width: 0.0045 * lerp(0.5, 1, set), shape: (u) => oval(u) * (seeds > 1 ? 1 - 0.12 * Math.cos(u * Math.PI * 4) : 1), segs: 4, twin: 0.35 * set, paint: (u) => mix(mix('#9ac464', '#72a048', set), '#c8a868', dry * 1.2 - u * 0.1), round: true });
				blades.pick(bag, from);
				bag.fruitDone();
			}
		}
	}
}

/* ------------------------------------------------------------------------------------------------ chickpea */

export const CHICKPEA_STAGES = stages([
	['Seed', 0, 'A beige, wrinkled seed like a ram’s head (the dark desi ones smaller and angular), five centimetres down in warm spring soil.'],
	['Germination', 8, 'The root goes down deep; the seed stays below, and a hooked shoot pushes up from it.'],
	['First leaves', 16, 'Above two scale leaves, the first small pinnate leaves, grey-green and hairy.'],
	['Seedling', 26, 'Several stems from the base, every part covered in fine glandular hairs, sour to the tongue.'],
	['Branching', 42, 'A bushy upright plant half a metre high, leaves of small toothed leaflets, no tendrils.'],
	['Flowering', 58, 'Small white or pink-purple flowers, one on each long stalk from the axils.'],
	['Pods set', 66, 'Short, puffed-up pods like little balloons behind the flowers.'],
	['Filling', 80, 'Pods full, hairy and pale green, a chickpea or two rattling inside each; picked green, they are eaten fresh.'],
	['Drying', 95, 'The leaves yellow, the pods turn golden-tan.'],
	['Harvest', 110, 'The plant dry and golden, the pods papery: pulled and threshed.']
]);

/**
 * The chickpea at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function chickpea(g, seed) {
	const bag = new Bag(), blades = new Blades();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const r = chance(seed, 'chickpea');
	const desi = r() < 0.3;
	const at = v3(0, -0.045, 0);
	const s = sprout(bag, {
		seed, at, size: desi ? v3(0.0034, 0.003, 0.003) : v3(0.0045, 0.004, 0.004), coat: desi ? '#6a4a2a' : '#dcc092', coatShade: desi ? '#3a2818' : '#a88a5a',
		stem: table(g, [[0, 0], [0.4, 0.003], [1, 0.042], [1.6, 0.05], [9, 0.05]]), hook: table(g, [[0, 1], [1.1, 1], [1.6, 0]]),
		radius: 0.0009, stemColor: '#6a8a4a', leaf: { length: 0.0005, width: 0.0003, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
		open: 0, shed: span(g, 4, 5.5), wither: 1, keepCoat: true
	});
	legumeRoots(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.5, grown: table(g, [[0, 0], [0.4, 0.04], [1, 0.12], [3, 0.45], [5, 0.85], [6, 1]]), radius: 0.0018, nodules: 10, laterals: 3, age: span(g, 3, 6) });
	const ctx = { bag, blades, seed, g, vigour, desi, dry: span(g, 7.5, 8.7), straw: span(g, 8.4, 9.2) };
	const stems = 3;
	for (let j = 0; j < stems; j++) {
		const born = j ? 2.8 + j * 0.25 : 1.3;
		if (g <= born) break;
		const max = 0.5 * vigour * (j ? between(r, 0.75, 0.92) : 1);
		const reach = max * table(g - (j ? 0.3 : 0), [[1.3, 0], [2, 0.06], [3, 0.2], [4, 0.5], [5, 0.82], [6, 0.96], [7, 1]]);
		chickpeaStem(ctx, [j], s.top.clone(), tilted(level(j * 2.39996 + r()), j ? between(r, 0.55, 0.85) : between(r, 0.08, 0.2)), max, reach, 0);
	}
	blades.into(bag);
	return bag.build();
}

/**
 * A chickpea stem: upright, hairy, a leaf at each node, a long-stalked flower and then a pod from the upper axils, side
 * stems from its lower nodes.
 * @param {{ bag: Bag, blades: Blades, seed: string, g: number, vigour: number, desi: boolean, dry: number, straw: number }} ctx
 * @param {number[]} key @param {THREE.Vector3} from @param {THREE.Vector3} dir @param {number} max @param {number} reach @param {number} order
 */
function chickpeaStem(ctx, key, from, dir, max, reach, order) {
	const { bag, blades, seed, g, desi, dry, straw } = ctx;
	if (reach < 0.004) return;
	const r = chance(seed, 'chickpea-stem', ...key);
	const d = dir.clone().normalize();
	const full = [from.clone()];
	for (let k = 0; k < 10; k++) {
		d.lerp(UP, 0.1).add(v3((r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.1)).normalize();
		full.push(full[k].clone().addScaledVector(d, max / 10));
	}
	const pts = upto(full, reach / max);
	const stalk = (/** @type {number} */ u) => mix(mix('#6a8a4c', '#88a868', u), '#c8a868', dry * 0.6 + straw * 0.4);
	wire(bag, blades, pts, order ? 0.0013 : 0.0021, stalk, 4, UP);
	const nodes = Math.floor(max / 0.042);
	const b0 = r() * Math.PI * 2;
	for (let n = 1; n < nodes; n++) {
		const f = n / nodes;
		const h = f * max;
		if (h > reach - 0.004) break;
		const nr = chance(seed, 'chickpea-node', ...key, n);
		const p = point(full, f);
		const bear = b0 + n * Math.PI * 0.8 + about(nr, 0, 0.3);
		const grown = clamp((reach - h) / 0.06);
		const old = clamp(dry * 1.5 - f * 0.5) * (1 - straw * 0.3) + straw * 0.3;
		pinnateLeaf(bag, blades, {
			r: nr, at: p, out: level(bear), lift: 0.7, length: (0.025 + 0.028 * clamp(n / 4)) * ctx.vigour, pairs: order ? 3 : n < 2 ? 2 : 5,
			leaflet: { length: 0.013, width: 0.005, shape: (u) => ovate(u) * (1 + 0.14 * Math.cos(u * Math.PI * 4)), segs: 2 },
			paint: (u, v) => mix(mix(mix('#94b07a', '#58804a', grown), '#88a878', Math.abs(v) < 0.1 ? 0.3 : 0), mix('#d8b868', '#c8a060', u), old),
			stalk: mix('#6a8a4c', '#c8a868', old), radius: 0.0006, grown, old, terminal: true, drop: straw * 0.5
		});
		if (!order && (n === 2 || n === 4) && g > 3.4) chickpeaStem(ctx, [...key, n], p, tilted(level(bear + Math.PI * 0.5), 0.85), max * 0.55, max * 0.55 * span(g, 3.4 + n * 0.08, 5.6), 1);
		// one flower to a long stalk from an upper axil; its pod hangs, puffed up
		if (f < 0.35 || n < 2) continue;
		const opens = 4.6 + f * 0.9 + nr() * 0.3;
		if (g < opens - 0.3) continue;
		const fout = level(bear + Math.PI * 0.5);
		const open = span(g, opens - 0.3, opens), fall = span(g, opens + 0.5, opens + 0.7);
		const set = nr() < 0.8 ? span(g, opens + 0.5, opens + 1.7) : 0;
		const ped = arch(p, tilted(fout, 0.7), 0.022, 0.3 + set * 0.9, 2);
		const end = ped[ped.length - 1];
		const pd = fout.clone().multiplyScalar(0.5).add(v3(0, -0.85, 0)).normalize();
		// once set, one pod on its own long stalk: the stalk (a tube, or a ribbon at lower detail) and the pod
		const pod = set >= 0.05;
		if (pod) bag.fruit([...key, n], p, pd);
		const from = blades.mark();
		wire(bag, blades, ped, 0.0005, stalk, 3, UP);
		if (pod) blades.pick(bag, from);
		if (set < 0.05) {
			peaFlower(blades, end, fout, 0.009, desi ? '#c87ab0' : '#f6f4ee', desi ? '#a85a98' : '#f0ece4', open, fall);
			continue;
		}
		// the pod: an inflated oval, hairy, with a little beak
		const size = lerp(0.35, 1, set) * about(nr, 1, 0.1);
		const c = end.clone().addScaledVector(pd, 0.011 * size);
		bag.add('body', bead(c, v3(0.012, 0.0075, 0.0068).multiplyScalar(size), mix(mix('#a8c47a', '#8cb064', set), '#d4ae6c', dry * 1.2), 3, alongX(pd)));
		bag.fruitDone();
	}
}

/* ------------------------------------------------------------------------------------------------ edamame */

export const EDAMAME_STAGES = stages([
	['Seed', 0, 'A round soybean, green for edamame, three centimetres down in warm soil after the last frost.'],
	['Germination', 6, 'The root goes down; a hooked stem pulls the bean up and out of the soil.'],
	['Seed leaves', 10, 'The bean splits into two fat yellow-green seed leaves, held up in the light.'],
	['First leaves', 18, 'A pair of simple oval leaves, opposite, above the seed leaves.'],
	['Trifoliates', 32, 'Leaves of three on long stalks, one at a node, everything soft with tawny hairs; side stems from the lower nodes.'],
	['Flowering', 50, 'Small purple (or white) flowers tucked in clusters in the leaf axils, all the way up.'],
	['Pods set', 58, 'Flat little pods, two to four at a node.'],
	['Filling', 70, 'The pods fattening, fuzzy and green, two or three beans showing in each.'],
	['Picking', 85, 'Edamame: the pods plump and bright green — the whole plant pulled, or picked over, and the pods boiled in salt water.'],
	['Dry beans', 115, 'Left on, the leaves yellow and fall, the pods turn tan and hard: soybeans for drying.']
]);

/**
 * Edamame (the soybean picked green) at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function edamame(g, seed) {
	const bag = new Bag(), blades = new Blades();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const r = chance(seed, 'edamame');
	const white = r() < 0.3;
	const at = v3(0, -0.028, 0);
	// epigeal: the bean is lifted out of the soil and opens into two fat seed leaves
	const s = sprout(bag, {
		seed, at, size: v3(0.0045, 0.0038, 0.004), coat: '#a8b868', coatShade: '#6a7a40',
		stem: table(g, [[0, 0], [0.3, 0.002], [1, 0.038], [2, 0.058], [9, 0.062]]), hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.0016 + 0.0014 * span(g, 2, 5), stemColor: '#7a9a4a',
		leaf: { length: 0.017, width: 0.0105, shape: oval, color: '#b0b850', vein: '#c8cc78' },
		open: span(g, 1.2, 2), shed: span(g, 1.1, 1.6), wither: span(g, 3.6, 4.6)
	});
	legumeRoots(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.45, grown: table(g, [[0, 0], [0.3, 0.04], [1, 0.14], [3, 0.5], [5, 0.9], [6, 1]]), radius: 0.0022, nodules: 14, laterals: 3, age: span(g, 3, 6) });
	const ctx = { bag, blades, seed, g, vigour, white, old: span(g, 8.5, 9.3) };
	const max = 0.7 * vigour;
	const reach = max * table(g, [[1.8, 0], [2.2, 0.03], [3, 0.12], [4, 0.36], [5, 0.7], [6, 0.92], [7, 1]]);
	soyStem(ctx, [0], s.top.clone(), v3(r() * 0.1 - 0.05, 1, r() * 0.1 - 0.05), max, reach, 0);
	blades.into(bag);
	return bag.build();
}

/**
 * A soy stem: hairy, upright, a pair of simple leaves at its first node (the main stem's), then a leaf of three at each
 * node; the flowers and then the pods in clusters in the axils; side stems from its lower nodes.
 * @param {{ bag: Bag, blades: Blades, seed: string, g: number, vigour: number, white: boolean, old: number }} ctx
 * @param {number[]} key @param {THREE.Vector3} from @param {THREE.Vector3} dir @param {number} max @param {number} reach @param {number} order
 */
function soyStem(ctx, key, from, dir, max, reach, order) {
	const { bag, blades, seed, g, white, old } = ctx;
	if (reach < 0.004) return;
	const r = chance(seed, 'soy-stem', ...key);
	const d = dir.clone().normalize();
	const full = [from.clone()];
	for (let k = 0; k < 10; k++) {
		d.lerp(UP, order ? 0.12 : 0.05).add(v3((r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.06)).normalize();
		full.push(full[k].clone().addScaledVector(d, max / 10));
	}
	const pts = upto(full, reach / max);
	const stalk = (/** @type {number} */ u) => mix(mix('#7a9448', '#8aa858', u), '#b89a62', old);
	const R = (order ? 0.0022 : 0.0042) * ctx.vigour * lerp(0.4, 1, span(g, 2, 6));
	if (DETAIL.level >= 1 || R >= DETAIL.finest) bag.add('body', tube(pts, (u) => R * (1 - 0.6 * u), stalk, 5));
	else wire(bag, blades, pts, R, stalk, 5, UP);
	const nodes = Math.floor(max / 0.055);
	const b0 = r() * Math.PI * 2;
	for (let n = 0; n < nodes; n++) {
		const f = (n + (order ? 0.6 : 0.15)) / nodes;
		const h = f * max;
		if (h > reach - 0.004) break;
		const nr = chance(seed, 'soy-node', ...key, n);
		const p = point(full, f);
		const bear = b0 + n * Math.PI + about(nr, 0, 0.35);
		const grown = clamp((reach - h) / 0.08);
		// the leaves yellow and fall from the bottom up at the end
		const yellow = clamp(old * 1.6 - f * 0.6);
		const fallen = old > 0 && nr() < old * 1.3 - f * 0.4;
		if (!order && n === 0) {
			// the first leaves: a simple pair, opposite
			for (const side of [0, Math.PI]) if (!fallen) soyLeaflet(blades, nr, p, level(bear + side), 0.055 * ctx.vigour, grown, yellow, 0.025);
			continue;
		}
		if (!fallen) {
			const size = (order ? 0.075 : 0.095) * ctx.vigour * (f > 0.8 ? 0.75 : 1);
			const pet = arch(p, tilted(level(bear), lerp(0.25, 0.75, grown) + yellow * 0.5), (0.05 + 0.07 * clamp(1 - f * 0.6)) * lerp(0.3, 1, grown) * (order ? 0.7 : 1), 0.1 + yellow * 0.3, 3);
			wire(bag, blades, pet, 0.0012, stalk, 3, UP);
			const end = pet[pet.length - 1];
			const out = level(bear);
			soyLeaflet(blades, nr, end.clone().addScaledVector(out, 0.012), out, size, grown, yellow, 0.035);
			for (const side of [-1, 1]) soyLeaflet(blades, nr, end, level(bear + side * 1.25), size * 0.85, grown, yellow, 0.03);
		}
		// side stems from the lower nodes
		if (!order && n >= 1 && n <= 3 && g > 3.6) soyStem(ctx, [...key, n], p, tilted(level(bear + Math.PI / 2), 0.55), max * 0.45, max * 0.45 * span(g, 3.6 + n * 0.1, 5.8), 1);
		// in the axil, a cluster of small flowers, then of pods
		if (n < 1) continue;
		const opens = 4.6 + f * 0.6 + nr() * 0.2;
		if (g < opens - 0.3) continue;
		const open = span(g, opens - 0.3, opens), fall = span(g, opens + 0.5, opens + 0.7);
		const fill = span(g, opens + 0.5, 7.6), plump = span(g, 6.8, 8);
		const pods = 2 + Math.floor(nr() * 3);
		const fout = level(bear + Math.PI * 0.35);
		for (let m = 0; m < pods; m++) {
			const a = bear + Math.PI * 0.35 + (m - (pods - 1) / 2) * 0.8;
			const fa = p.clone().addScaledVector(level(a), 0.004).add(v3(0, 0.002 * m, 0));
			if (fill < 0.04) {
				peaFlower(blades, fa, level(a), 0.0065, white ? '#f4f0f6' : '#a070c8', white ? '#ece8f0' : '#8a58b0', open, fall);
				continue;
			}
			const pd = level(a).multiplyScalar(0.5).add(v3(0, -0.85 + 0.3 * (m % 2), 0)).normalize();
			const beans = 2 + (nr() < 0.6 ? 1 : 0);
			const len = 0.05 * lerp(0.3, 1, fill) * about(nr, 1, 0.08);
			// one pod, stalkless in its cluster in the axil
			bag.fruit([...key, n, m], fa, pd);
			const from = blades.mark();
			blades.add({ at: fa, dir: pd, up: level(a + Math.PI / 2), length: len, width: 0.0066 * lerp(0.5, 1, fill), shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.9)), 0.4) * (1 - 0.18 * plump * Math.pow(Math.cos(u * Math.PI * beans), 2)), segs: 6, twin: lerp(0.3, 1.2, plump), droop: 0.25, paint: (u, v) => mix(mix('#a8c470', '#90b85a', fill), '#a8885a', old * 1.2).lerp(tint('#d8dcb0'), Math.abs(v) > 0.9 ? 0.45 : 0), round: true });
			blades.pick(bag, from);
			bag.fruitDone();
		}
	}
}

/** a soy leaflet (or a first simple leaf), ovate and pointed, soft with hairs, yellowing at the end */
function soyLeaflet(/** @type {Blades} */ blades, /** @type {() => number} */ r, /** @type {THREE.Vector3} */ at, /** @type {THREE.Vector3} */ out, /** @type {number} */ size, /** @type {number} */ grown, /** @type {number} */ yellow, /** @type {number} */ half) {
	if (grown <= 0.02) return;
	const len = size * lerp(0.3, 1, grown) * about(r, 1, 0.06);
	const lift = lerp(1, 0.05, grown) - yellow * 0.7;
	const d = out.clone().multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0)).normalize();
	const green = mix(mix('#8ab456', '#40702e', grown), '#d0b840', yellow);
	const rib = mix(green, '#a8c08a', 0.35);
	blades.add({ at, dir: d, length: len, width: len * (half / 0.085), shape: ovate, segs: 5, fold: 0.3 * (1 - grown) + 0.1, droop: 0.12 + yellow * 0.2, paint: (u, v) => (Math.abs(v) < 0.1 ? rib : green) });
}

/* ------------------------------------------------------------------------------------------------ oats */

export const OATS_STAGES = stages([
	['Seed', 0, 'A slim, pale, hulled oat grain, three centimetres down in early spring.'],
	['Germination', 7, 'Three seminal roots go down; the coleoptile, a pale sheath, pushes up to the light.'],
	['First leaf', 14, 'The first blade unrolls out of the coleoptile, then the next out of the first.'],
	['Tillering', 30, 'Side shoots from the crown at the soil: a tuft of blades, crown roots below.'],
	['Stem extension', 48, 'The stems shoot up, a node at a time, each wrapped in its leaf’s sheath.'],
	['Booting', 58, 'The panicle swells inside the sheath of the flag leaf, the last and broadest.'],
	['Heading', 66, 'The panicle breaks out and opens: whorls of fine branches, the spikelets dangling from their tips, flowering within.'],
	['Grain fill', 80, 'The grain milky, then doughy; the panicles heavier, nodding, still green.'],
	['Turning', 95, 'Yellowing from the bottom up, the panicles golden-green.'],
	['Harvest', 108, 'Golden straw, the spikelets papery and pale, the grain hard: cut and threshed.']
]);

/**
 * Oats at a stage (0 … 9, between them on the way) from the seed id: one plant, tillered into a tuft of stems.
 * @param {number} g @param {string} seed
 */
export function oats(g, seed) {
	const bag = new Bag(), blades = new Blades();
	const vigour = about(chance(seed, 'plant'), 1, 0.07);
	const r = chance(seed, 'oats');
	const grain = v3(0, -0.03, 0);
	const spent = span(g, 2.2, 4);
	if (spent < 1) bag.add('body', bead(grain, v3(0.0055, 0.0017, 0.0019).multiplyScalar(1 - 0.35 * spent), mix('#dcc890', '#8a7a58', spent), 5, alongX(level(r() * Math.PI * 2).add(v3(0, 0.3, 0)))));
	// three seminal roots from the grain, then crown roots from the tillering node: fibrous, half a metre and more
	if (DETAIL.roots) {
		for (let i = 0; i < 3; i++) root(bag, { seed, key: ['seminal', i], from: grain.clone(), dir: v3(Math.cos(i * 2.1) * 0.4, -1, Math.sin(i * 2.1) * 0.4), length: 0.4, grown: table(g, [[0, 0], [0.5, 0.05], [1, 0.2], [3, 0.6], [5, 1]]), radius: 0.0006, laterals: 1, lateral: 0.3, depth: 1, age: span(g, 3, 8), young: '#f4ecd8', old: '#c8b088' });
		for (let i = 0; i < 3; i++) root(bag, { seed, key: ['crown', i], from: v3(0, -0.014, 0), dir: v3(Math.cos(i * 2.1 + 1), -0.8, Math.sin(i * 2.1 + 1)), length: 0.35, grown: span(g, 2.6 + i * 0.12, 6), radius: 0.0008, laterals: 2, lateral: 0.3, depth: 1, age: span(g, 4, 8), young: '#f4ecd8', old: '#c8b088' });
	}
	// the coleoptile: a pale sheath from the grain to the light
	const cole = table(g, [[0, 0], [0.4, 0.004], [1, 0.034], [9, 0.034]]);
	if (cole > 0.001 && g < 3.2) bag.add('body', tube([grain.clone(), grain.clone().add(v3(0, cole, 0))], (u) => 0.0011 * (1 - 0.4 * u), (u) => mix('#f0ecd0', '#b8cc88', u), 4));
	const tillers = 6 + Math.floor(r() * 3);
	const ripe = span(g, 7.4, 8.9), straw = span(g, 8.5, 9.2);
	for (let i = 0; i < tillers; i++) {
		const born = i ? 2.5 + i * 0.2 : 1.2;
		if (g <= born) break;
		const tr = chance(seed, 'tiller', i);
		const a = i * 2.39996 + tr() * 0.5;
		const base = v3(0, -0.012, 0).addScaledVector(level(a), i ? 0.004 + 0.014 * Math.sqrt(i / tillers) : 0);
		tiller(bag, blades, seed, i, base, level(a), i ? between(tr, 0.1, 0.28) : between(tr, 0.02, 0.07), born, g, vigour * (i ? between(tr, 0.85, 0.98) : 1.03), i ? 0.12 + i * 0.05 : 0, ripe, straw);
	}
	blades.into(bag);
	return bag.build();
}

/**
 * One oat tiller: its leaves from the crown, then its stem with four nodes, a blade at each, and the panicle at its top.
 * @param {Bag} bag @param {Blades} blades @param {string} seed @param {number} i @param {THREE.Vector3} base
 * @param {THREE.Vector3} out @param {number} lean @param {number} born @param {number} g @param {number} H its full height
 * @param {number} late how far behind the main stem @param {number} ripe @param {number} straw
 */
function tiller(bag, blades, seed, i, base, out, lean, born, g, H, late, ripe, straw) {
	const r = chance(seed, 'oat-tiller', i);
	const Hc = H * table(g - late, [[3.6, 0], [4, 0.08], [4.5, 0.3], [5, 0.55], [5.5, 0.74], [6, 0.88], [6.5, 0.96], [7, 1]]);
	const leaves = clamp((g - born - 0.15) / 0.6 + 1, 0, 5);
	const ps = 0.012 + 0.012 * leaves;
	const top = Math.max(Hc, ps);
	const jointed = Hc > ps;
	const fill = span(g, 6.6, 7.8);
	const nod = 0.04 + 0.05 * fill;
	/** the stem at height h: leaning out, the panicle nodding further */
	const at = (/** @type {number} */ h) => base.clone().addScaledVector(out, Math.sin(lean) * h + nod * top * Math.pow(h / top, 4)).add(v3(0, Math.cos(lean) * h, 0));
	const nodesAt = [0.05, 0.18, 0.36, 0.58];
	const hs = [0, 0.05, 0.18, 0.36, 0.58, 0.7, 0.78, 0.86, 0.93, 1];
	const pts = hs.map((f) => at(f * top));
	const green = (/** @type {number} */ u) => mix(mix('#5f8f3c', '#7aa452', u), '#dcc27a', ripe * 1.2 - (1 - u) * 0.2).lerp(tint('#e6d29a'), straw * 0.6);
	const r0 = (jointed ? 0.0022 : 0.0028) * H;
	bag.add(
		'body',
		tube(pts, (u) => {
			const knee = jointed && nodesAt.some((n) => Math.abs(u - n) < 0.008) ? 1.3 : 1;
			return r0 * knee * (u < 0.78 ? 1 - 0.3 * u : 0.75 * (1 - ((u - 0.78) / 0.22) * 0.6));
		}, (u) => (jointed && nodesAt.some((n) => Math.abs(u - n) < 0.008) ? mix(green(u), '#5a6a30', 0.45) : green(u)), 5)
	);
	// the leaves, in two ranks: each sheath from its node, the blade from the collar arching out
	const rank = r() * Math.PI * 2;
	const lengths = [0.13, 0.2, 0.24, 0.26, 0.21], widths = [0.0048, 0.006, 0.0072, 0.008, 0.009];
	const collars = [0.04, 0.13, 0.28, 0.48, 0.7];
	for (let k = 0; k < 5; k++) {
		const grown = clamp(leaves - k);
		if (grown <= 0.02) break;
		const h = Math.max(Math.min(ps, 0.014 + 0.012 * k), jointed ? Hc * collars[k] : 0);
		const p = at(h);
		const o = level(rank + k * Math.PI + about(r, 0, 0.3));
		const tilt = lerp(0.12, between(r, 0.55, 0.9), grown);
		const dead = k < 3 ? span(g, 6.2 + k * 0.4, 7.4 + k * 0.35) : 0;
		const L = lengths[k] * H * lerp(0.3, 1, grown);
		const col = mix(mix(mix('#88b45a', '#4f7f34', grown), '#c8b070', dead), '#dcc27a', ripe);
		blades.add({ at: p.addScaledVector(o, r0), dir: tilted(o, tilt + dead * 0.4), length: L, width: widths[k] * lerp(0.5, 1, grown), shape: grass, segs: 6, fold: 0.25, droop: 0.3 * grown + dead * 0.3, paint: (u) => mix(col, '#8ab060', (1 - u) * 0.15 * (1 - ripe)) });
	}
	// the panicle: whorls of fine branches up its axis, the spikelets dangling from them
	const emerge = span(g - late, 5.4, 6.3);
	if (!jointed || emerge <= 0) return;
	const spike = mix(mix('#a2c472', '#b0c47e', fill), '#e2c880', ripe).lerp(tint('#efe2b4'), straw);
	const twig = (/** @type {number} */ u) => mix(mix('#7aa452', '#dcc27a', ripe), '#e6d29a', straw * u);
	const spread = lerp(0.1, 0.8, emerge);
	const counts = [3, 3, 2, 2, 1];
	const branchLen = [0.5, 0.42, 0.34, 0.25, 0.15];
	const P = top * 0.22;
	for (let w = 0; w < 5; w++) {
		const u = 0.78 + 0.22 * (0.04 + w * 0.19);
		// the panicle comes out of the boot top first
		const out_ = span(emerge, 0.8 - w * 0.18, 1 - w * 0.15);
		if (out_ <= 0) continue;
		const p = at(u * top);
		for (let b = 0; b < counts[w]; b++) {
			const br = chance(seed, 'oat-branch', i, w, b);
			const bear = w * 1.3 + (b * Math.PI * 2) / counts[w] + about(br, 0, 0.3);
			const ob = level(bear);
			const d = ob.clone().multiplyScalar(Math.sin(spread * out_)).add(v3(0, Math.cos(spread * out_), 0)).normalize();
			const bp = arch(p, d, P * branchLen[w] * lerp(0.5, 1, out_), 0.35 + 0.5 * fill, 2);
			wire(bag, blades, bp, 0.00045, twig, 3, ob);
			for (const f of w < 2 ? [1, 0.55] : [1]) {
				const sp = point(bp, f);
				const hang = ob.clone().multiplyScalar(lerp(0.6, 0.3, fill)).add(v3(0, lerp(-0.2, -1, out_), 0)).normalize();
				// once its grain fills, one spikelet (the branch it hangs from left on the panicle)
				if (fill > 0) bag.fruit([i, w, b, f], sp, hang);
				const from = blades.mark();
				blades.add({ at: sp, dir: hang, up: ob, length: 0.022 * lerp(0.5, 1, out_), width: 0.004, shape: lance, segs: 2, twin: 0.7, paint: spike, round: true });
				if (fill > 0) blades.pick(bag, from);
				bag.fruitDone();
			}
		}
	}
	// and one at the very top
	if (emerge > 0.1) {
		const hang = out.clone().multiplyScalar(0.5).add(v3(0, -1, 0)).normalize();
		if (fill > 0) bag.fruit([i, 'top'], at(top), hang);
		const from = blades.mark();
		blades.add({ at: at(top), dir: hang, up: out, length: 0.022, width: 0.004, shape: lance, segs: 2, twin: 0.7, paint: spike, round: true });
		if (fill > 0) blades.pick(bag, from);
		bag.fruitDone();
	}
}

/* ------------------------------------------------------------------------------------------------ the list */

/** the fields' plants, as ./index.js lists them */
export const FIELDS = [
	{
		id: 'bamboo',
		label: 'Bamboo',
		latin: 'Phyllostachys · Bambus',
		note: 'A running clump from a piece of rhizome: every spring fat spotted shoots telescope up into ringed green culms, taller each year to six or eight metres, two branches at a node and fans of narrow leaves.',
		from: 'Grove · 5 years',
		stages: BAMBOO_STAGES,
		grow: bamboo,
		layer: 'sub-canopy'
	},
	{
		id: 'hemp',
		label: 'Hemp',
		latin: 'Cannabis sativa · Nutzhanf',
		note: 'One slender stalk two and a half metres high in a summer, leaves of five to nine toothed leaflets spread like hands; seed in clusters of bracts at the top, the stalk retted for its fibre.',
		from: 'Annual · 125 days',
		stages: HEMP_STAGES,
		grow: hemp,
		layer: 'herbaceous'
	},
	{
		id: 'lentil',
		label: 'Lentil',
		latin: 'Lens culinaris · Linse',
		note: 'A low, fine, bushy annual of feathery leaves ending in little tendrils; tiny white-lilac flowers, small flat pods of one or two lentils, the whole plant drying to straw.',
		from: 'Annual · 100 days',
		stages: LENTIL_STAGES,
		grow: lentil,
		layer: 'herbaceous'
	},
	{
		id: 'edamame',
		label: 'Edamame',
		latin: 'Glycine max · Sojabohne',
		note: 'An upright, hairy bush of leaves of three; small purple flowers in the axils, then clusters of fuzzy green pods all along the stem, picked plump as edamame — or left to yellow for dry soybeans.',
		from: 'Annual · 85 days',
		stages: EDAMAME_STAGES,
		grow: edamame,
		layer: 'herbaceous'
	},
	{
		id: 'chickpea',
		label: 'Chickpea',
		latin: 'Cicer arietinum · Kichererbse',
		note: 'A grey-green, glandular-hairy bush of small toothed leaflets; white or pink flowers one to a stalk, then puffed-up pods with a chickpea or two, drying golden-tan.',
		from: 'Annual · 110 days',
		stages: CHICKPEA_STAGES,
		grow: chickpea,
		layer: 'herbaceous'
	},
	{
		id: 'oats',
		label: 'Oats',
		latin: 'Avena sativa · Hafer',
		note: 'A tuft of tillers, long blades, stems a metre high with their nodes, and open nodding panicles of dangling spikelets, green and then golden over golden straw.',
		from: 'Annual · 108 days',
		stages: OATS_STAGES,
		grow: oats,
		layer: 'herbaceous'
	}
];
