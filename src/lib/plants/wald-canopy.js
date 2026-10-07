/*
 * THE CANOPY — the tall trees of a temperate forest garden, and the hazel under them: the walnut, the sweet chestnut,
 * the black alder (the nitrogen-fixer the others lean on), the small-leaved lime, the pecan, the Turkish tree hazel,
 * the Korean pine (the evergreen of the canopy, its cones full of pine nuts), and the hazel coppice of the sub-canopy. Each entry is a plant as ./index.js lists it, with its food-forest `layer`; ./index.js adds every entry
 * of WALD to the library.
 *
 * They are grown like ./orchard.js grows a fruit tree — the seed, its roots, a crown from ./crown.js — but with their
 * own leaves and their own flowers and nuts, which a fruit tree's description cannot say: the walnut's long pinnate
 * leaves and its green husked nuts splitting brown, the chestnut's toothed lances, its cream catkins and its spiny
 * burrs, the alder's round notched leaves, its catkins and little woody cones and the nodules on its roots, the lime's
 * heart-shaped leaves and its hanging flowers on their leafy bracts, the hazel's stems from the stool, its lamb's
 * tails and its nuts in their frilly husks.
 *
 * Their leaves are each made once and stamped onto the tree (`template`, `stamp`), thousands of them, so a crown is full
 * and still quick to grow. The nuts hang where they touch nothing (the bag's Space), and the leaves turn out of their
 * way (`Clear`).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Bag, DETAIL, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { flushCrown, leaderCrown } from './crown.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));
const TAU = Math.PI * 2;
const DOWN = v3(0, -1, 0);

/* ------------------------------------------------------------------------------------------------ the leaves */

/**
 * A leaf made once and stamped onto the tree as often as it has leaves: its pieces merged, built along +X from the
 * foot of its stalk (its first vertex), face up; its colours kept as shades of the leaf's own colour (1 the colour).
 * @param {THREE.BufferGeometry[]} parts
 */
function template(parts) {
	const g = /** @type {THREE.BufferGeometry} */ (mergeGeometries(parts));
	for (const p of parts) p.dispose();
	return g;
}

/**
 * All a tree's leaves, gathered straight into one geometry as they are stamped: the template set at `m` and coloured,
 * thousands of times, without a geometry each. Thinned as the bag thins its sheets (DETAIL.thin): one leaf in so many
 * kept, grown bigger from its stalk.
 */
class Foliage {
	constructor() {
		this.verts = 0;
		this.tris = 0;
		this.pos = new Float32Array(3 * 4096);
		this.nor = new Float32Array(3 * 4096);
		this.uv = new Float32Array(2 * 4096);
		this.col = new Float32Array(3 * 4096);
		this.idx = new Uint32Array(3 * 4096);
		this.kept = 0;
	}
	/** room for `v` more vertices and `t` more indices, doubling as it fills @param {number} v @param {number} t */
	room(v, t) {
		/** @template {Float32Array | Uint32Array} A @param {A} a @param {number} need @returns {A} */
		const grow = (a, need) => {
			if (need <= a.length) return a;
			const b = /** @type {A} */ (new /** @type {any} */ (a.constructor)(Math.max(need, a.length * 2)));
			b.set(a);
			return b;
		};
		const n = this.verts + v;
		this.pos = grow(this.pos, n * 3);
		this.nor = grow(this.nor, n * 3);
		this.col = grow(this.col, n * 3);
		this.uv = grow(this.uv, n * 2);
		this.idx = grow(this.idx, this.tris + t);
	}
	/** @param {THREE.BufferGeometry} tpl @param {THREE.Matrix4} m @param {THREE.Color} colour */
	stamp(tpl, m, colour) {
		if (DETAIL.thin < 1) {
			this.kept += DETAIL.thin;
			if (this.kept < 1) return;
			this.kept -= 1;
			const grow = Math.min(1.8, 1 / Math.sqrt(DETAIL.thin));
			m = m.clone().multiply(new THREE.Matrix4().makeScale(grow, grow, grow));
		}
		const e = m.elements;
		// the leaf is turned and scaled evenly: its normals turn with it, and are made unit again
		const P = /** @type {Float32Array} */ (tpl.attributes.position.array), N = /** @type {Float32Array} */ (tpl.attributes.normal.array);
		const C = /** @type {Float32Array} */ (tpl.attributes.color.array), U = /** @type {Float32Array} */ (tpl.attributes.uv.array);
		const I = /** @type {ArrayLike<number>} */ (/** @type {THREE.BufferAttribute} */ (tpl.index).array);
		const nv = P.length / 3;
		this.room(nv, I.length);
		const base = this.verts;
		const pos = this.pos, nor = this.nor, col = this.col;
		for (let i = 0, o = base * 3; i < P.length; i += 3, o += 3) {
			const x = P[i], y = P[i + 1], z = P[i + 2];
			pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
			pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
			pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
			const a = N[i], b = N[i + 1], c = N[i + 2];
			const nx = e[0] * a + e[4] * b + e[8] * c, ny = e[1] * a + e[5] * b + e[9] * c, nz = e[2] * a + e[6] * b + e[10] * c;
			const l = Math.hypot(nx, ny, nz) || 1;
			nor[o] = nx / l;
			nor[o + 1] = ny / l;
			nor[o + 2] = nz / l;
			col[o] = C[i] * colour.r;
			col[o + 1] = C[i + 1] * colour.g;
			col[o + 2] = C[i + 2] * colour.b;
		}
		this.uv.set(U, base * 2);
		for (let i = 0; i < I.length; i++) this.idx[this.tris + i] = I[i] + base;
		this.verts += nv;
		this.tris += I.length;
	}
	/** the leaves into the bag, among its sheets (as they are: already thinned) @param {Bag} bag */
	into(bag) {
		if (!this.tris) return;
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.verts * 3), 3));
		g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.verts * 3), 3));
		g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.verts * 2), 2));
		g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.verts * 3), 3));
		g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.tris), 1));
		bag.parts.sheet.push(g);
	}
}

/** a shade: the leaf's colour lighter or darker, or warmer (the stalk, the midrib) */
const shade = (/** @type {number} */ r, /** @type {number} */ g = r, /** @type {number} */ b = r) => new THREE.Color(r, g, b);

/**
 * A simple leaf: its stalk, then its blade, bowed down at the tip — a few rows only, for a crown of thousands (cupped,
 * and its midrib paler, with `across` 2). The blade
 * can be set back over the stalk's end (`back`, parts of its length), so a heart-shaped base wraps round it.
 * @param {{ stalk: number, length: number, width: number, shape: (u: number) => number, back?: number, cup?: number, bow?: number, along: number, across?: number, cross?: boolean }} o
 */
function simpleLeaf(o) {
	const parts = [];
	if (o.stalk > 0) parts.push(sheet({ length: o.stalk, width: 0.0012, shape: () => 1, paint: () => shade(1.05, 1.05, 0.7), along: 1, across: 1 }));
	const blade = sheet({
		length: o.length,
		width: o.width,
		shape: o.shape,
		lift: (u, v) => (o.cup ?? 0.05) * v * v - (o.bow ?? 0.08) * u * u,
		paint: (u, v) => (Math.abs(v) < 0.2 ? shade(1.18, 1.2, 1.0) : shade(lerp(1.06, 0.92, u))),
		along: o.along,
		across: o.across ?? 1
	});
	blade.translate(o.stalk - (o.back ?? 0) * o.length, 0, 0);
	parts.push(blade);
	// a bundle of needles is round: a second blade across the first, so it shows from the side too
	if (o.cross) parts.push(blade.clone().rotateX(Math.PI / 2));
	return template(parts);
}

/**
 * The walnut's leaf: a long arching rachis, its leaflets in pairs growing larger toward the tip, and one at the end
 * (`wide`, how broad a leaflet is for its length: the walnut's long, the pecan's longer still).
 * @param {number} length the rachis @param {number} pairs @param {number} [wide]
 */
function pinnateLeaf(length, pairs, wide = 0.24) {
	const parts = [];
	const bow = (/** @type {number} */ u) => -0.16 * u * u * length;
	parts.push(sheet({ length, width: 0.0028, shape: (u) => 1 - 0.5 * u, lift: (u) => -0.16 * u * u, paint: () => shade(1.1, 1.08, 0.75), along: 2, across: 1 }));
	const leaflet = (/** @type {number} */ u, /** @type {number} */ len, /** @type {number} */ side) => {
		const x = u * length, slope = -0.32 * u;
		const turn = side === 0 ? 0 : side * 0.95;
		const d = v3(Math.cos(turn), slope + (side ? -0.05 : 0), Math.sin(turn)).normalize();
		const blade = sheet({
			length: len,
			width: len * wide,
			shape: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.6) * (t < 0.05 ? t / 0.05 : 1),
			lift: (t) => -0.06 * t * t,
			paint: () => shade(side > 0 ? 1.04 : side < 0 ? 0.96 : 1.08),
			along: 3,
			across: 1
		});
		blade.applyMatrix4(aim(v3(x, bow(u), 0), d, side * 0.25));
		parts.push(blade);
	};
	for (let k = 0; k < pairs; k++) {
		const u = 0.38 + (0.5 * k) / Math.max(1, pairs - 1);
		const len = length * (0.27 + 0.1 * (k / Math.max(1, pairs - 1)));
		leaflet(u, len, 1);
		leaflet(u + 0.03, len, -1);
	}
	leaflet(1, length * 0.4, 0);
	return template(parts);
}

/**
 * Where the nuts and flowers already hang, for the leaves to keep out of: balls in a coarse grid, quick to ask.
 */
class Clear {
	constructor() {
		/** @type {Map<number, { c: THREE.Vector3, r: number }[]>} */
		this.cells = new Map();
		this.size = 0.3;
	}
	/** @param {number} x @param {number} y @param {number} z */
	key(x, y, z) {
		return ((Math.floor(x / this.size) + 512) * 1024 + Math.floor(y / this.size) + 512) * 1024 + Math.floor(z / this.size) + 512;
	}
	/** @param {THREE.Vector3} c @param {number} r */
	add(c, r) {
		const k = this.key(c.x, c.y, c.z);
		const list = this.cells.get(k);
		if (list) list.push({ c: c.clone(), r });
		else this.cells.set(k, [{ c: c.clone(), r }]);
	}
	/** how deep a ball at p of radius r sinks into what is here (0 when it touches nothing) @param {THREE.Vector3} p @param {number} r */
	depth(p, r) {
		let worst = 0;
		const s = this.size;
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++)
				for (let dz = -1; dz <= 1; dz++) {
					const list = this.cells.get(this.key(p.x + dx * s, p.y + dy * s, p.z + dz * s));
					if (list) for (const b of list) worst = Math.max(worst, b.r + r - b.c.distanceTo(p));
				}
		return worst;
	}
	/** whether a ball at p of radius r touches anything here @param {THREE.Vector3} p @param {number} r */
	hit(p, r) {
		if (!this.cells.size) return false;
		const s = this.size;
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++)
				for (let dz = -1; dz <= 1; dz++) {
					const list = this.cells.get(this.key(p.x + dx * s, p.y + dy * s, p.z + dz * s));
					if (list) for (const b of list) if (b.c.distanceTo(p) < b.r + r) return true;
				}
		return false;
	}
}

/* ------------------------------------------------------------------------------------------------ the tree */

/** @typedef {import('./crown.js').Shoot} Shoot */
/**
 * @typedef {{ bag: Bag, g: number, seed: string, shoots: Shoot[], vigour: number, clear: Clear, gens: number }} Ctx —
 *   what a tree's flowers and nuts are grown with: its shoots (`gens` the last flush of a flushing crown), and where
 *   things already are
 */
/**
 * @typedef {{
 *   stalk: number, length: number, width: number, shape: (u: number) => number, back?: number, cup?: number, bow?: number,
 *   along: number, pinnate?: number, wide?: number, cross?: boolean
 * }} Blade — a leaf's make: a simple blade, or `pinnate` pairs of leaflets along a rachis `length` long (`wide` how
 *   broad each leaflet is for its length); `cross`, a second blade across the first (a bundle of needles)
 */
/**
 * @typedef {{
 *   seed: { size: THREE.Vector3, coat: string, shade: string, depth: number }, hypogeal: boolean,
 *   cotyledon?: { length: number, width: number, colour: string },
 *   roots: { tap: number, spread: number, count: number, radius: number }, nodules?: boolean,
 *   flush?: import('./crown.js').Flush, leader?: import('./crown.js').Leader,
 *   coppice?: { stems: [number, number], from: number, every: number, lean: number, stool: number, leader: import('./crown.js').Leader },
 *   leaf: { blade: Blade, colour: string, young: string, autumn: string, droop: number, gap: number, per: number, twig: number, tuft: number, from?: number, inner?: number, limb?: number, top?: number, bare?: boolean, spring?: boolean },
 *   bear: (ctx: Ctx) => void
 * }} Wood — a tree of the forest garden, described: its seed, its roots (`nodules` the alder's), its crown (in flushes,
 *   with a leader, or a coppice of `stems` leaders from the stool, one every `every` stages from `from`), its leaves
 *   (a node every `gap` metres along the outer shoots, of one leaf or a short twig `twig` long with `per`; `tuft` more
 *   at each tip; along the older wood within, `inner` times sparser; on a leader's limbs from `limb` of the way out,
 *   and in sprays up its `top` metres; `bare` if it flowers before they come, `spring` if as they come)
 *   and `bear`, which grows its flowers and its nuts
 */

/**
 * @param {Wood} spec
 * @returns {(g: number, seed: string) => THREE.Group}
 */
function wood(spec) {
	return (g, seed) => {
		const bag = new Bag();
		const vigour = about(chance(seed, 'plant'), 1, 0.08);
		const at = v3(0, -spec.seed.depth, 0);

		// the seed, and how it comes up
		const s = sprout(bag, {
			seed,
			at,
			size: spec.seed.size,
			coat: spec.seed.coat,
			coatShade: spec.seed.shade,
			stem: table(g, [[0, 0], [0.3, spec.seed.depth * 0.1 + 0.001], [1, spec.seed.depth + 0.03], [2, spec.seed.depth + 0.07], [9, spec.seed.depth + 0.07]]),
			hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
			radius: 0.0018 + 0.004 * span(g, 1, 3),
			stemColor: '#7a6a42',
			leaf: spec.cotyledon ? { length: spec.cotyledon.length, width: spec.cotyledon.width, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.7), color: spec.cotyledon.colour, vein: '#a6c47e' } : { length: 0.001, width: 0.0005, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
			open: spec.hypogeal ? 0 : span(g, 1.1, 2),
			shed: spec.hypogeal ? span(g, 3.5, 4.5) : span(g, 1, 1.6),
			wither: spec.hypogeal ? 1 : span(g, 3, 3.8),
			keepCoat: spec.hypogeal
		});

		// the roots: a taproot going deep, and roots spreading wide near the surface
		root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0.02, -1, 0.01), length: spec.roots.tap, grown: table(g, [[0, 0], [0.3, 0.004], [1, 0.03], [2, 0.07], [3, 0.2], [4, 0.45], [5, 0.75], [6, 0.9], [8, 1]]), radius: 0.002 + spec.roots.radius * span(g, 2, 8), down: 0.03, wander: 0.1, laterals: 10, lateral: 0.3, depth: 2, age: span(g, 1.5, 6), young: '#f3e6cc', old: '#5e4632' });
		for (let i = 0; i < spec.roots.count; i++) {
			const rr = chance(seed, 'feeder', i);
			const born = 2.6 + i * (4 / spec.roots.count);
			const bear = i * 2.39996 + rr() * 0.4;
			root(bag, { seed, key: ['feeder', i], from: at.clone().add(v3(0, -0.04 - rr() * 0.12, 0)), dir: v3(Math.cos(bear), -0.15, Math.sin(bear)), length: between(rr, 0.6, 1) * spec.roots.spread * vigour, grown: (g - born) / 2.8, radius: 0.003 + spec.roots.radius * 0.4 * span(g, 3, 8), down: 0.01, wander: 0.14, laterals: 4, lateral: 0.25, depth: 2, age: (g - born - 0.6) / 2.5, young: '#efdcb8', old: '#5e4632' });
		}
		if (spec.nodules) nodules(bag, seed, g, at);

		// the crown
		/** @type {Shoot[]} */
		let shoots = [];
		// (a sapling is a slim whip: the wood thickens with the years, not only with each shoot's age)
		const girth = table(g, [[2, 0.12], [3, 0.25], [4, 0.55], [5, 0.8], [6, 0.92], [9, 1]]);
		if (spec.flush) shoots = flushCrown(bag, { seed, g, from: s.top.clone(), spec: { ...spec.flush, radius: spec.flush.radius * girth } });
		else if (spec.leader) shoots = leaderCrown(bag, { seed, g, from: s.top.clone(), spec: spec.leader });
		else if (spec.coppice) shoots = coppice(bag, seed, g, s.top.clone(), spec.coppice);

		// what is where, so the nuts hang clear of the wood and of each other, and the leaves clear of the nuts
		// (the thick wood: a leader's trunk and limbs, a flushing crown's first three flushes)
		for (const sh of shoots) if (sh.gen <= (spec.flush ? 2 : 1) && sh.radius > 0.01) bag.space.rod(sh.pts, sh.radius + 0.01);
		const clear = new Clear();
		spec.bear({ bag, g, seed, shoots, vigour, clear, gens: spec.flush?.gens ?? 2 });

		// the leaves
		const L = spec.leaf;
		const tr = chance(seed, 'leaf-make');
		const B = L.blade;
		const make = () => (B.pinnate ? pinnateLeaf(B.length * about(tr, 1, 0.06), B.pinnate, B.wide) : simpleLeaf({ ...B, length: B.length * about(tr, 1, 0.06) }));
		const tpls = [make(), make(), make()];
		// a tree that flowers before its leaves come (the hazel, the alder): bare through the late winter, then the
		// new leaves unfolding
		const season = L.bare ? table(g, [[4.3, 1], [4.5, 0], [5.25, 0], [5.8, 1]]) : 1;
		const unfold = L.bare ? clamp((g - 5.25) / 0.9) : 1;
		const fall = span(g, 8.2, 9.2);
		const leaves = new Foliage();
		if (season > 0.03) for (const sh of shoots) foliage(bag, leaves, spec, seed, g, sh, tpls, clear, season, g > 5.25 && g < 6.2 ? unfold : 1, fall);
		leaves.into(bag);
		for (const t of tpls) t.dispose();
		return bag.build();
	};
}

/**
 * The leaves of a shoot: one by one along it in a spiral, turned out toward the light, and a tuft at its tip; on a
 * leader's limbs along their outer half, and up the leader's own top. New leaves their young colour, darkening as they
 * harden; in the autumn some yellowing.
 * @param {Bag} bag @param {Foliage} leaves @param {Wood} spec @param {string} seed @param {number} g @param {Shoot} sh
 * @param {THREE.BufferGeometry[]} tpls @param {Clear} clear @param {number} season @param {number} unfold @param {number} fall
 */
function foliage(bag, leaves, spec, seed, g, sh, tpls, clear, season, unfold, fall) {
	const L = spec.leaf;
	const lr = chance(seed, 'leaves', ...sh.key);
	const leader = !spec.flush;
	const outer = (spec.flush?.gens ?? 0) - 1;
	const leafy = leader ? true : sh.end || (sh.gen === 0 && g < 3.4) || sh.gen >= Math.min(L.from ?? 99, outer);
	// the older wood within: short leafy spurs along it, sparser (`inner` times the gap), where the tree is shade-tolerant
	// enough to keep them (the lime, the chestnut)
	const inner = !leafy && sh.gen >= 1 && L.inner ? L.inner : 0;
	if (!leafy && !inner) return;
	const age = Math.min(clamp((g - sh.born) / 0.6), unfold);
	const reach = L.blade.pinnate ? L.blade.length * 1.1 : L.blade.length + L.blade.stalk;
	const young = new THREE.Color(L.young), old = new THREE.Color(L.colour), autumn = new THREE.Color(L.autumn);
	// a tree that flowers as its leaves come (the walnut): the whole crown its young colour again then, for a while
	const spring = L.spring ? 0.75 * table(g, [[4.4, 0], [4.75, 1], [5.3, 1], [5.9, 0]]) : 0;
	/** one leaf at p, reaching out along `out` @param {THREE.Vector3} p @param {THREE.Vector3} out */
	const leaf = (p, out) => {
		const size = between(lr, 0.8, 1.1) * lerp(0.45, 1, age) * lerp(0.55, 1, clamp(g - 2)) * season;
		const hang = lerp(-0.7, -L.droop, age) + about(lr, 0, 0.3);
		const tpl = tpls[Math.floor(lr() * tpls.length)];
		const roll = (lr() - 0.5) * 0.6;
		const tint = lr();
		// in the autumn a leaf here and there yellowing first
		const yellow = fall * clamp((lr() - 0.6) * 1.6);
		if (size < 0.02) return;
		// turned as little as it needs to keep out of the nuts and the flowers
		let dir = null;
		const flat = out.clone().setY(0);
		if (flat.lengthSq() < 1e-6) flat.set(1, 0, 0);
		flat.normalize();
		for (const turn of [0, 0.7, -0.7, 1.5, -1.5, 2.4, -2.4]) {
			const o = flat.clone().applyAxisAngle(v3(0, 1, 0), turn);
			const d = o.multiplyScalar(Math.cos(hang)).add(v3(0, Math.sin(hang), 0)).normalize();
			let hit = false;
			for (const f of [0.35, 0.7, 1]) if (clear.hit(p.clone().addScaledVector(d, reach * size * f), reach * size * 0.16)) hit = true;
			if (!hit) {
				dir = d;
				break;
			}
		}
		if (!dir) return;
		const colour = young.clone().lerp(old, age * (1 - spring)).multiplyScalar(0.92 + 0.16 * tint).lerp(autumn, yellow * 0.75);
		leaves.stamp(tpl, aim(p, dir, roll).multiply(new THREE.Matrix4().makeScale(size, size, size)), colour);
	};
	/** out from the shoot, round it by `bear`, and a little out from the trunk */
	const outFrom = (/** @type {THREE.Vector3} */ p, /** @type {THREE.Vector3} */ dir, /** @type {number} */ bear, /** @type {number} */ forward) => {
		let side = new THREE.Vector3().crossVectors(dir, v3(0, 1, 0));
		if (side.lengthSq() < 1e-6) side = v3(1, 0, 0);
		side.normalize().applyAxisAngle(dir, bear);
		const away = v3(p.x, 0, p.z);
		if (away.lengthSq() > 1e-6) side.addScaledVector(away.normalize(), 0.45);
		return side.addScaledVector(dir, forward);
	};
	if (leader && sh.gen === 0) {
		// the leader's own top: sprays up its last metres, so it does not stand bare over the crown
		const top = Math.min(L.top ?? 2.4, sh.length * 0.6);
		const n = Math.max(2, Math.min(40, Math.round(top / L.gap)));
		for (let k = 0; k < n; k++) {
			const { at, dir } = along(sh.pts, 1 - (top / sh.length) * (k / n));
			const twig = 0.06 + 0.3 * (k / n) * clamp(sh.length / 4);
			for (let m = 0; m < 4; m++) {
				const a = (k * 4 + m) * 2.39996;
				const o = v3(Math.cos(a), 0, Math.sin(a));
				leaf(at.clone().addScaledVector(o, twig), o.addScaledVector(dir, 0.5));
			}
		}
		return;
	}
	// along it (on a leader's limbs, their outer part only): a leaf at each node, or a short twig of `per` leaves
	const from = leader && sh.gen === 1 ? L.limb ?? 0.5 : inner ? 0.3 : 0.12;
	// (a sapling's stem, its leaves closer)
	const gap = sh.gen === 0 && !leader ? Math.min(L.gap, 0.09) : L.gap * (inner || 1);
	const n = Math.min(40, Math.max(1, Math.round((sh.length * (1 - from)) / gap)));
	const bark = new THREE.Color(spec.flush?.bark[0] ?? spec.leader?.bark[0] ?? spec.coppice?.leader.bark[0] ?? '#6a5a4a');
	for (let k = 0; k < n; k++) {
		const u = from + ((k + 0.5) / n) * (1 - from);
		const { at, dir } = along(sh.pts, u);
		const out = outFrom(at, dir, k * 2.39996 + lr() * 0.5, 0.45);
		if (L.per <= 1) {
			leaf(at, out);
			continue;
		}
		const td = out.clone().normalize().add(v3(0, 0.25, 0)).normalize();
		const tl = L.twig * between(lr, 0.7, 1.15) * lerp(0.4, 1, age) * season + 0.01;
		const end = at.clone().addScaledVector(td, tl);
		bag.add('body', tube([at, end], (t) => 0.003 * (1 - 0.5 * t), () => bark, 3));
		for (let m = 0; m < L.per; m++) {
			const p = at.clone().lerp(end, (m + 1) / L.per);
			leaf(p, outFrom(p, td, (m % 2 ? 1 : -1) * 1.3 + lr() * 0.4, m === L.per - 1 ? 1.2 : 0.4));
		}
	}
	// and a tuft at the tip
	if ((sh.end || leader) && !inner) {
		for (let k = 0; k < L.tuft; k++) {
			const { at, dir } = along(sh.pts, 1 - (k % 3) * 0.05);
			leaf(at, outFrom(at, dir, k * 2.39996 + 1, 1.1));
		}
	}
}

/** a place along a path, u 0 … 1 */
function along(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
	return { at: pts[k].clone().lerp(pts[k + 1], f - k), dir: pts[k + 1].clone().sub(pts[k]).normalize() };
}

/**
 * The hazel's stool: stems coming up from the base one after another, each a leader of its own leaning out from the
 * middle, the first the seedling's own; they are grown upright (./crown.js) and tipped over at their foot.
 * @param {Bag} bag @param {string} seed @param {number} g @param {THREE.Vector3} top
 * @param {NonNullable<Wood['coppice']>} c
 * @returns {Shoot[]}
 */
function coppice(bag, seed, g, top, c) {
	/** @type {Shoot[]} */
	const out = [];
	const cr = chance(seed, 'stool');
	const count = c.stems[0] + Math.floor(cr() * (c.stems[1] - c.stems[0] + 1));
	for (let i = 0; i < count; i++) {
		const sr = chance(seed, 'stem', i);
		const born = c.from + i * c.every * about(sr, 1, 0.25);
		const bear = i * 2.39996 + about(sr, 0, 0.3);
		const off = i === 0 ? 0 : c.stool * between(sr, 0.4, 1);
		const tilt = i === 0 ? about(sr, 0.05, 0.03) : c.lean * between(sr, 0.55, 1.2);
		const local = g - born + 2;
		if (local <= 2) continue;
		const base = top.clone().add(v3(Math.cos(bear) * off, -0.02, Math.sin(bear) * off));
		const m = new THREE.Matrix4().makeTranslation(base.x, base.y, base.z).multiply(new THREE.Matrix4().makeRotationAxis(v3(-Math.sin(bear), 0, Math.cos(bear)), -tilt));
		const proxy = {
			/** @param {import('./grow.js').Kind} kind @param {THREE.BufferGeometry} geo @param {THREE.Matrix4} [mm] */
			add(kind, geo, mm) {
				if (mm) geo.applyMatrix4(mm);
				geo.applyMatrix4(m);
				bag.add(kind, geo);
				return proxy;
			},
			space: bag.space
		};
		const tall = about(sr, 1, 0.12) * (1 - 0.06 * i);
		const spec = { ...c.leader, height: c.leader.height.map(([a, h]) => /** @type {[number, number]} */ ([a, h * tall])) };
		const shoots = leaderCrown(/** @type {Bag} */ (/** @type {unknown} */ (proxy)), { seed: `${seed}·${i}`, g: local, from: v3(0, 0, 0), spec });
		const turn = new THREE.Matrix3().setFromMatrix4(m);
		for (const sh of shoots) {
			sh.pts = sh.pts.map((p) => p.clone().applyMatrix4(m));
			sh.tip = sh.tip.clone().applyMatrix4(m);
			sh.dir = sh.dir.clone().applyMatrix3(turn).normalize();
			sh.key = ['stem', i, ...sh.key];
			out.push(sh);
		}
	}
	return out;
}

/**
 * The alder's root nodules: clusters of knobbly orange-brown lumps on its shallow roots, where Frankia, living in
 * them, fixes nitrogen from the air for the alder and, as roots and leaves rot, for the plants round it.
 * @param {Bag} bag @param {string} seed @param {number} g @param {THREE.Vector3} at
 */
function nodules(bag, seed, g, at) {
	const grown = span(g, 2.4, 6);
	if (grown <= 0.01) return;
	const nr = chance(seed, 'nodules');
	const count = 9;
	for (let i = 0; i < count; i++) {
		const bear = i * 2.39996 + nr() * 0.8;
		const reach = between(nr, 0.12, 0.7) * lerp(0.3, 1, grown);
		const deep = between(nr, 0.06, 0.25);
		const o = v3(Math.cos(bear), 0, Math.sin(bear));
		const end = at.clone().addScaledVector(o, reach).add(v3(0, -deep, 0));
		// the little root it is on
		root(bag, { seed, key: ['nodule-root', i], from: at.clone().add(v3(0, -0.03, 0)), dir: o.clone().add(v3(0, -deep / Math.max(0.1, reach), 0)), length: end.distanceTo(at) * 1.1, grown: grown * 1.2, radius: 0.004 + 0.008 * grown, down: 0, wander: 0.04, laterals: 0, depth: 0, age: grown, young: '#e8d4b0', old: '#6a4e36' });
		const size = (0.008 + 0.022 * nr()) * grown;
		const lumps = 5 + Math.floor(nr() * 5);
		for (let k = 0; k < lumps; k++) {
			const d = v3(nr() - 0.5, nr() - 0.5, nr() - 0.5).normalize();
			bag.add('body', bead(end.clone().addScaledVector(d, size * 0.6), v3(1, 0.8, 1).multiplyScalar(size * between(nr, 0.35, 0.6)), mix('#d0884a', '#8a5a34', nr()), 3));
		}
	}
}

/* ------------------------------------------------------------------------------------------------ flowers and nuts */

/** the shoots a flushing tree flowers on: the outermost, its last flush, `share` of them (the same at every stage) */
function tips(/** @type {Ctx} */ ctx, /** @type {number} */ share) {
	return ctx.shoots.filter((sh) => sh.end && sh.gen >= ctx.gens - 1 && sh.grown > 0.6 && chance(ctx.seed, 'tip', ...sh.key)() < share);
}

/**
 * A catkin: a slender spike from `at`, out along `dir` and then hanging (or held stiffly, `stiff` 1), its length `len`.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} dir @param {number} len @param {number} radius
 * @param {THREE.ColorRepresentation} colour @param {number} stiff
 */
function catkin(bag, at, dir, len, radius, colour, stiff) {
	if (len < 0.003) return;
	const pts = [at.clone()];
	const d = dir.clone().normalize();
	for (let i = 0; i < 5; i++) {
		d.lerp(DOWN, (1 - stiff) * 0.45).normalize();
		pts.push(pts[i].clone().addScaledVector(d, len / 5));
	}
	const c = new THREE.Color(colour);
	bag.add('body', tube(pts, (u) => radius * (u < 0.1 ? 0.5 + 5 * u : 1 - 0.45 * u * u), (u) => c.clone().multiplyScalar(0.85 + 0.25 * u), 5));
}

/**
 * Where a nut hangs from its site, touching nothing: from `from`, along a direction near `dir`, its stalk perhaps a
 * little longer, so that it keeps clear of the thick wood (the bag's Space) and of the nuts and flowers already hung
 * (Clear, a grid — quick however many there are), which it then joins, for the leaves to keep out of too.
 * @param {Ctx} ctx @param {THREE.Vector3} from @param {THREE.Vector3} dir @param {number} L @param {number} W @param {number} reach
 */
function hang(ctx, from, dir, L, W, reach) {
	const balls = (/** @type {THREE.Vector3} */ a, /** @type {THREE.Vector3} */ d) => [0.3, 0.7].map((t) => ({ c: a.clone().addScaledVector(d, L * t), r: W * 0.95 }));
	const d0 = dir.clone().normalize();
	let best = { at: from.clone(), dir: d0, cost: Infinity };
	const side = new THREE.Vector3();
	search: for (const ext of [0, 0.5, 1]) {
		for (const swing of [0, 0.45, 0.9, 1.4, 2]) {
			for (let k = 0; k < (swing ? 8 : 1); k++) {
				const a = (k / 8) * TAU;
				side.set(Math.cos(a), 0, Math.sin(a));
				const d = d0.clone().addScaledVector(side, swing).normalize();
				if (d.y > 0.35) continue;
				const p = from.clone().addScaledVector(d, ext * reach);
				let cost = swing * 0.004 + ext * 0.003;
				for (const b of balls(p, d)) cost += (ctx.bag.space.depth(b.c, b.r) + ctx.clear.depth(b.c, b.r)) * 10 + Math.max(0, b.r - b.c.y) * 10;
				if (cost < best.cost) best = { at: p, dir: d, cost };
			}
			if (best.cost < 0.004 * (swing + 0.5)) break search;
		}
	}
	for (const b of balls(best.at, best.dir)) ctx.clear.add(b.c, b.r);
	return best;
}

/** the matrix that hangs a thing built down -Y from `at` along `dir`, turned round it by `spin` */
const hung = (/** @type {THREE.Vector3} */ at, /** @type {THREE.Vector3} */ dir, /** @type {number} */ spin) => new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(DOWN, dir.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), spin)), v3(1, 1, 1));

/**
 * A husked nut: the husk (smooth, or spiny like the chestnut's burr) round it, splitting into `valves` from the tip as
 * it ripens, the nuts inside showing in the clefts; built down -Y from its stalk.
 * @param {Bag} bag @param {THREE.Matrix4} m @param {number} L @param {number} W
 * @param {{ shape: (u: number) => number, husk: (u: number, v: number) => THREE.Color, split: number, valves: number,
 *   spines?: number, rings: number, sides: number, nut: string, nuts: number, nutSize: number, kind?: 'body' | 'gloss' }} o
 */
function husked(bag, m, L, W, o) {
	const axis = [];
	for (let k = 0; k <= o.rings; k++) axis.push(v3(0, -0.001 - (k / o.rings) * L, 0));
	const cleft = (/** @type {number} */ u, /** @type {number} */ v) => {
		if (o.split <= 0) return 1;
		let c = 1;
		for (let k = 0; k < o.valves; k++) c = Math.min(c, Math.abs(((v - k / o.valves + 1.5) % 1) - 0.5));
		const wide = 0.02 + 0.07 * o.split;
		return 1 - o.split * 0.75 * Math.exp(-Math.pow(c / wide, 2)) * clamp(u * 2.2 - 0.1);
	};
	const radius = (/** @type {number} */ u, /** @type {number} */ v) => {
		const spike = o.spines && u > 0.06 && u < 0.94 ? o.spines * ((Math.round(u * o.rings) + Math.round(v * o.sides)) % 2) : 0;
		return W * o.shape(u) * (1 + 0.12 * o.split) * (1 + spike) * cleft(u, v);
	};
	bag.add(o.kind ?? 'body', tube(axis, radius, (u, v) => (cleft(u, v) < 0.75 ? o.husk(u, v).multiplyScalar(0.55) : o.husk(u, v)), o.sides), m);
	if (o.split > 0.05) {
		for (let k = 0; k < o.nuts; k++) {
			const a = (k / o.nuts) * TAU + 0.4;
			const off = o.nuts > 1 ? W * 0.32 : 0;
			const c = v3(Math.cos(a) * off, -L * 0.5, Math.sin(a) * off);
			bag.add('gloss', bead(c, v3(W * o.nutSize * (o.nuts > 1 ? 0.62 : 0.9), L * 0.42 * o.nutSize, W * o.nutSize * (o.nuts > 1 ? 0.5 : 0.85)), o.nut, 3, new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), -a)), m);
		}
	}
}

/* ------------------------------------------------------------------------------------------------ walnut */

export const WALNUT_STAGES = stages([
	['Nut', 0, 'A walnut in its shell, sown in the autumn five centimetres down — where a jay or a squirrel would have buried it — and chilled by the winter.'],
	['Germination', 170, 'In the spring the shell splits along its seam: a thick root goes straight down; the seed leaves stay in the shell.'],
	['Seedling', 200, 'A stout shoot with its first leaves, already pinnate, bronze as they open; the taproot is longer than the shoot.'],
	['Sapling', 730, 'A straight whip of smooth olive-grey bark, its big leaves in a tuft at the top; it leafs out late, after the frosts.'],
	['Young tree', 2200, 'A broad crown on a stout grey trunk, eight metres across in a forest garden at eight years, heading for twenty.'],
	['Flowering', 3050, 'In May with the bronze new leaves: green male catkins hanging from last year’s wood, and at the tips of the new shoots little green female flowers with two feathery stigmas.'],
	['Nut set', 3075, 'The catkins drop; at the shoot tips one to three small green fruits swell, smooth and dotted pale.'],
	['Green walnuts', 3140, 'Green husked walnuts the size of a hen’s egg at the shoot tips — picked now in June for nocino, before the shell hardens.'],
	['Turning', 3210, 'The husks yellow and spot with brown; inside, the shell has hardened and the kernel filled.'],
	['Ripe', 3240, 'The husks go brown-black and split; the wrinkled nuts show and drop — gather them quickly, before the squirrels.']
]);

const WALNUT_GREEN = new THREE.Color('#78a83e');

export const walnut = wood({
	seed: { size: v3(0.018, 0.016, 0.016), coat: '#a8875a', shade: '#6a5236', depth: 0.05 },
	hypogeal: true,
	// a broad, open dome: a clear grey trunk, a few big scaffold limbs, stout shoots
	flush: {
		trunk: 1.8, trunkBorn: 1.6, trunkFlush: 1.2, scaffolds: [3, 5], scaffoldAngle: 0.6, gens: 6, flush: 0.16, rest: 0.08,
		shoot: (gen) => [0, 1.6, 1.2, 0.92, 0.7, 0.55, 0.42][gen] ?? 0.4, whorl: [2, 3], spread: 0.62, up: 0.045, droop: 0.05,
		wander: 0.12, radius: 0.15, taper: 0.62, thicken: 3.5, bark: ['#8e8a7e', '#68645c']
	},
	roots: { tap: 2.4, spread: 3.6, count: 9, radius: 0.08 },
	leaf: { blade: { stalk: 0, length: 0.38, width: 0, shape: () => 1, along: 4, pinnate: 3 }, colour: '#3f6a2a', young: '#8a6236', autumn: '#c8b04a', droop: 0.05, gap: 0.26, per: 1, twig: 0, tuft: 6, from: 4, spring: true },
	bear(ctx) {
		const { bag, g, seed } = ctx;
		// the male catkins: from the side buds of last year's wood, below the new shoots
		for (const sh of ctx.shoots) {
			if (sh.gen !== ctx.gens - 1) continue;
			const cr = chance(seed, 'catkins', ...sh.key);
			const opens = 4.65 + cr() * 0.3;
			const phase = g - opens;
			if (phase < -0.45 || phase > 0.55) continue;
			const n = Math.floor(cr() * 3);
			for (let k = 0; k < n; k++) {
				const { at, dir } = along(sh.pts, between(cr, 0.55, 0.95));
				const out = dir.clone().add(v3(cr() - 0.5, -0.4, cr() - 0.5)).normalize();
				const len = 0.1 * lerp(0.25, 1, span(phase, -0.45, -0.05)) * lerp(1, 0.6, span(phase, 0.25, 0.55));
				catkin(bag, at, out, len, 0.0045, phase < 0.2 ? mix('#7a9440', '#c8c45a', span(phase, -0.1, 0.1)) : mix('#c8c45a', '#6a5a3a', span(phase, 0.2, 0.45)), 0.1);
			}
		}
		// the female flowers and the nuts, at the tips of the new shoots
		for (const sh of tips(ctx, 0.45)) {
			const fr = chance(seed, 'flowering', ...sh.key);
			const opens = 4.75 + fr() * 0.4;
			const phase = g - opens;
			if (phase < -0.3) continue;
			const n = 1 + Math.floor(fr() * 3);
			const up = sh.dir.clone().lerp(v3(0, 1, 0), 0.5).normalize();
			if (phase < 0.55) {
				for (let k = 0; k < n; k++) {
					const a = (k / n) * TAU + fr();
					const d = up.clone().add(v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.5)).normalize();
					const c = sh.tip.clone().addScaledVector(d, 0.012);
					const open = span(phase, -0.3, 0.1);
					bag.add('body', bead(c, v3(0.004, 0.006, 0.004).multiplyScalar(lerp(0.6, 1, open)), '#7a9a46', 3, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), d)));
					// two curled feathery stigmas
					for (const side of [-1, 1]) {
						const s = new THREE.Vector3().crossVectors(d, v3(0, 0, 1)).normalize().multiplyScalar(side);
						const tip = c.clone().addScaledVector(d, 0.009).addScaledVector(s, 0.006 * open);
						bag.add('body', tube([c.clone().addScaledVector(d, 0.005), tip], () => 0.0018 * open + 0.0004, () => '#d8b07a', 3));
					}
				}
				continue;
			}
			const set = span(phase, 0.55, 2.4);
			const ripe = span(phase, 2.6, 3.7);
			const split = span(ripe, 0.55, 1);
			const keep = 1 + Math.floor(fr() * Math.min(3, n));
			for (let k = 0; k < keep; k++) {
				const kr = chance(seed, 'walnut', ...sh.key, k);
				const size = ctx.vigour * about(kr, 1, 0.08);
				const L = 0.052 * size * lerp(0.2, 1, set), W = 0.021 * size * lerp(0.2, 1, set);
				const swing = v3(Math.cos(k * 2.4 + kr() * 2), 0, Math.sin(k * 2.4 + kr() * 2));
				const start = sh.tip.clone().addScaledVector(up, 0.012);
				// on a short stout stalk, hanging out below the leaves of the tip
				const place = hang(ctx, start.clone().addScaledVector(swing, 0.02).add(v3(0, -0.035, 0)), DOWN.clone().addScaledVector(swing, 0.6), L, W, 0.03 + W);
				bag.fruit(['walnut', ...sh.key, k], sh.tip, place.dir);
				bag.add('body', tube([sh.tip, start, place.at], (u) => 0.0035 * (1 - 0.3 * u) + 0.002 * set, () => '#6a7040', 4));
				const blotch = kr() * TAU;
				husked(bag, hung(place.at, place.dir, kr() * TAU), L, W, {
					shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.03 + u * 0.97))), 0.55) * (1 - 0.06 * u),
					husk: (u, v) => {
						// green, dotted pale; then yellowing in blotches; then brown-black, splitting
						const spot = Math.max(0, Math.sin(u * 23 + v * 31 + blotch) * Math.sin(v * 17 - u * 11));
						const c = ripe < 0.5 ? WALNUT_GREEN.clone().lerp(new THREE.Color('#b8b448'), ripe * 1.4).lerp(new THREE.Color('#6a4a2a'), spot * ripe * 1.4) : mix('#9a8a3a', '#3a2a1e', (ripe - 0.5) * 2).lerp(new THREE.Color('#1e1610'), spot * 0.5);
						return spot > 0.85 && ripe < 0.3 ? c.lerp(new THREE.Color('#c8d08a'), 0.5) : c;
					},
					split, valves: 4, rings: 7, sides: 10, nut: '#b8925e', nuts: 1, nutSize: 0.86
				});
				bag.fruitDone();
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ sweet chestnut */

export const CHESTNUT_STAGES = stages([
	['Nut', 0, 'A fresh chestnut, glossy brown, sown in the autumn before it dries out, four centimetres down.'],
	['Germination', 150, 'In the spring a thick root pushes out of the pointed tip and down; the seed leaves stay in the nut.'],
	['Seedling', 180, 'A straight shoot of long, toothed leaves, each tooth ending in a bristle.'],
	['Sapling', 730, 'A fast young tree, its bark smooth and olive-grey, its leaves in two rows along the shoots.'],
	['Young tree', 2200, 'A broad dome on a stout trunk, its bark beginning to fissure — and to twist, in a spiral, as it ages.'],
	['Flowering', 3080, 'Late, at midsummer, in full leaf: long cream catkins stand out from the shoot tips by the hundred, heavy-scented; small green female flowers sit at the base of the upper ones.'],
	['Burr set', 3100, 'The catkins brown and fall; where the female flowers were, little green burrs bristle.'],
	['Green burrs', 3170, 'Spiny green burrs the size of a fist at the shoot tips, one to three nuts in each.'],
	['Turning', 3240, 'The burrs fade yellow-brown; the nuts inside harden and darken.'],
	['Ripe', 3270, 'The burrs split in four and gape: two or three glossy red-brown chestnuts in each, dropping in October.']
]);

export const chestnut = wood({
	seed: { size: v3(0.014, 0.011, 0.016), coat: '#6a3a20', shade: '#3a2010', depth: 0.04 },
	hypogeal: true,
	flush: {
		trunk: 1.9, trunkBorn: 1.6, trunkFlush: 1.2, scaffolds: [3, 5], scaffoldAngle: 0.6, gens: 6, flush: 0.16, rest: 0.08,
		shoot: (gen) => [0, 1.6, 1.2, 0.9, 0.7, 0.52, 0.4][gen] ?? 0.38, whorl: [2, 3], spread: 0.6, up: 0.055, droop: 0.045,
		wander: 0.12, radius: 0.16, taper: 0.62, thicken: 3.5, bark: ['#7e7462', '#5a5044']
	},
	roots: { tap: 2.2, spread: 3.4, count: 9, radius: 0.08 },
	leaf: {
		blade: { stalk: 0.02, length: 0.21, width: 0.032, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.7) * (u < 0.05 ? u / 0.05 : 1), along: 5, bow: 0.1 },
		colour: '#2c5420', young: '#4a7a2a', autumn: '#c8a038', droop: 0.25, gap: 0.1, per: 3, twig: 0.16, tuft: 4, from: 4, inner: 3
	},
	bear(ctx) {
		const { bag, g, seed } = ctx;
		for (const sh of tips(ctx, 0.75)) {
			const fr = chance(seed, 'flowering', ...sh.key);
			const opens = 4.8 + fr() * 0.3;
			const phase = g - opens;
			if (phase < -0.35) continue;
			const up = sh.dir.clone().lerp(v3(0, 1, 0), 0.35).normalize();
			// the catkins: from the axils of the shoot's last leaves, spreading out and up, then sagging
			if (phase < 0.95) {
				const n = 3 + Math.floor(fr() * 3);
				for (let k = 0; k < n; k++) {
					const { at, dir } = along(sh.pts, 0.55 + (0.45 * k) / n);
					const a = k * 2.39996 + fr();
					const d = dir.clone().add(v3(Math.cos(a), 0.4, Math.sin(a)).multiplyScalar(0.8)).normalize();
					const len = 0.19 * lerp(0.2, 1, span(phase, -0.35, 0.05)) * lerp(1, 0.55, span(phase, 0.4, 0.95));
					catkin(bag, at, d, len, 0.0062, phase < 0.35 ? mix('#d8dc9a', '#fbf0b8', span(phase, -0.2, 0.05)) : mix('#fbf0b8', '#8a6a3a', span(phase, 0.35, 0.8)), 0.55);
				}
			}
			// the burrs, from the female flowers at the foot of the upper catkins
			if (fr() > 0.35) continue;
			const set = span(phase, 0.15, 2.3);
			const ripe = span(phase, 2.5, 3.6);
			const split = span(ripe, 0.55, 1);
			const keep = 1 + Math.floor(fr() * 3);
			for (let k = 0; k < keep; k++) {
				const kr = chance(seed, 'burr', ...sh.key, k);
				const size = ctx.vigour * about(kr, 1, 0.1);
				const W = 0.032 * size * lerp(0.15, 1, set), L = 0.062 * size * lerp(0.15, 1, set);
				const swing = v3(Math.cos(k * 2.4 + kr() * 2), 0, Math.sin(k * 2.4 + kr() * 2));
				const start = sh.tip.clone().addScaledVector(up, 0.01);
				const place = hang(ctx, start.clone().addScaledVector(swing, 0.01), swing.clone().add(v3(0, -0.5, 0)), L, W * 1.35, 0.02 + W);
				bag.fruit(['burr', ...sh.key, k], sh.tip, place.dir);
				bag.add('body', tube([sh.tip, start, place.at], () => 0.0035 + 0.002 * set, () => '#6a7040', 4));
				const green = mix('#86b03e', '#b8b84a', ripe * 1.5);
				husked(bag, hung(place.at, place.dir, kr() * TAU), L, W, {
					shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.04 + u * 0.96))), 0.45),
					husk: (u) => (ripe < 0.6 ? green.clone() : mix('#b8a04a', '#8a6a38', (ripe - 0.6) / 0.4)).multiplyScalar(0.9 + 0.2 * u),
					split, valves: 4, spines: 1.1 * lerp(0.4, 1, set), rings: 8, sides: 12, nut: '#6a3218', nuts: 2 + Math.floor(kr() * 2), nutSize: 0.95
				});
				bag.fruitDone();
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ black alder */

export const ALDER_STAGES = stages([
	['Seed', 0, 'A tiny flat nutlet with a narrow corky wing — alder seed floats down streams — on wet soil, barely covered.'],
	['Germination', 30, 'A thread of a root, then a hook of a stem.'],
	['Seedling', 50, 'Two small round seed leaves, then round toothed leaves; Frankia from the soil already swelling the first nodules on its roots.'],
	['Sapling', 365, 'A slender, fast whip, a metre or more in its second year, its young leaves sticky (glutinosa).'],
	['Young tree', 1800, 'A narrow cone of a tree on one straight dark trunk, its limbs level in tiers: the support tree, its nodules feeding the garden nitrogen.'],
	['Flowering', 2550, 'In late winter, before the leaves: long purple-brown catkins at the twig tips loosening yellow with pollen; below them, tiny dark red female catkins.'],
	['Cone set', 2600, 'The leaves unfold, round and notched at the tip; the female catkins swell into little green cones.'],
	['Green cones', 2700, 'Clusters of green cones on short stalks, and next year’s catkins already formed, small and stiff.'],
	['Turning', 2760, 'The cones darken and harden, olive to brown.'],
	['Ripe', 2800, 'Dark woody cones, their scales open, shedding seed through the winter; the leaves fall green — alder keeps no autumn colour.']
]);

export const alder = wood({
	seed: { size: v3(0.0014, 0.0005, 0.0013), coat: '#7a5a3a', shade: '#5a3e26', depth: 0.003 },
	hypogeal: false,
	cotyledon: { length: 0.005, width: 0.0028, colour: '#5f9a3e' },
	nodules: true,
	// upright and narrow: a straight trunk, many steep limbs, the crown an egg narrowing to its top
	flush: {
		trunk: 1.5, trunkBorn: 1.6, trunkFlush: 1.2, scaffolds: [4, 6], scaffoldAngle: 0.28, gens: 6, flush: 0.16, rest: 0.08,
		shoot: (gen) => [0, 2.8, 1.6, 1.05, 0.72, 0.52, 0.4][gen] ?? 0.38, whorl: [2, 3], spread: 0.45, up: 0.085, droop: 0.04,
		wander: 0.12, radius: 0.13, taper: 0.62, thicken: 3.5, bark: ['#6a5e50', '#4a423c']
	},
	roots: { tap: 1.6, spread: 3, count: 9, radius: 0.06 },
	leaf: {
		blade: {
			stalk: 0.025, length: 0.095, width: 0.048,
			shape: (u) => (u < 0.62 ? Math.pow(Math.sin((Math.PI / 2) * (u / 0.62)), 0.8) : Math.sqrt(1 - 0.78 * Math.pow((u - 0.62) / 0.38, 2))),
			along: 4, bow: 0.05
		},
		colour: '#44703a', young: '#74a444', autumn: '#4a7232', droop: 0.15, gap: 0.09, per: 3, twig: 0.14, tuft: 4, from: 4, inner: 2, bare: true
	},
	bear(ctx) {
		const { bag, g, seed } = ctx;
		for (const sh of tips(ctx, 0.22)) {
			const fr = chance(seed, 'flowering', ...sh.key);
			const opens = 4.55 + fr() * 0.25;
			const phase = g - opens;
			if (phase < -0.4) continue;
			const tip = sh.tip;
			// the male catkins, hanging from the twig tips in twos to fours
			if (phase < 0.6) {
				const n = 2 + Math.floor(fr() * 3);
				for (let k = 0; k < n; k++) {
					const a = k * 2.39996 + fr();
					const d = sh.dir.clone().add(v3(Math.cos(a) * 0.6, -0.2, Math.sin(a) * 0.6)).normalize();
					const len = lerp(0.03, 0.09, span(phase, -0.4, 0)) * lerp(1, 0.7, span(phase, 0.3, 0.6));
					catkin(bag, tip, d, len, 0.0038, phase < 0.15 ? mix('#5a2e30', '#c8a040', span(phase, -0.1, 0.12)) : mix('#c8a040', '#5a4030', span(phase, 0.2, 0.5)), 0.15);
				}
			}
			// the female catkins, then the cones they become, on short stalks just behind the tip
			const set = span(phase, 0.2, 2);
			const ripe = span(phase, 2.4, 3.6);
			const n = 2 + Math.floor(fr() * 3);
			const { at: base } = along(sh.pts, 0.88);
			for (let k = 0; k < n; k++) {
				const kr = chance(seed, 'cone', ...sh.key, k);
				const L = lerp(0.005, 0.018, set) * about(kr, 1, 0.1), W = lerp(0.0022, 0.0068, set) * about(kr, 1, 0.08);
				const a = k * 2.39996 + kr();
				const out = v3(Math.cos(a), set < 0.3 ? 0.6 : -0.6, Math.sin(a));
				const place = hang(ctx, base.clone().addScaledVector(out.clone().setY(0), 0.008), out.clone().setY(-0.8).normalize(), L, W, 0.012 + W);
				// a cone once the female catkin has set (before that, a flower)
				if (set > 0) bag.fruit(['cone', ...sh.key, k], base, place.dir);
				bag.add('body', tube([base, place.at], () => 0.0012, () => '#4a3a2a', 3));
				const colour = set < 0.25 ? mix('#7a2a30', '#5a7a34', set * 4) : ripe < 0.5 ? mix('#5a7a34', '#6a6034', ripe * 2) : mix('#6a6034', '#3a2618', (ripe - 0.5) * 2);
				const open = span(ripe, 0.6, 1);
				const axis = [];
				for (let r = 0; r <= 6; r++) axis.push(v3(0, -(r / 6) * L, 0));
				bag.add('body', tube(axis, (u, v) => W * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.06 + u * 0.94))), 0.6) * (1 + (0.12 + 0.25 * open) * ((Math.round(u * 6) + Math.round(v * 6)) % 2)), (u, v) => colour.clone().multiplyScalar((Math.round(u * 6) + Math.round(v * 6)) % 2 ? 1.1 : 0.75), 6), hung(place.at, place.dir, kr() * TAU));
				if (set > 0) bag.fruitDone();
			}
			// next year's catkins, formed in the summer: small, stiff, purple-brown
			const next = span(g, 6.6, 8.6);
			if (next > 0.02) {
				const m = 1 + Math.floor(chance(seed, 'next', ...sh.key)() * 2);
				for (let k = 0; k < m; k++) {
					const a = k * 2.39996 + 0.5;
					catkin(bag, tip, sh.dir.clone().add(v3(Math.cos(a) * 0.5, -0.1, Math.sin(a) * 0.5)), 0.03 * next, 0.0028, '#5a3a34', 0.75);
				}
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ small-leaved lime */

export const LINDEN_STAGES = stages([
	['Nutlet', 0, 'A round grey felted nutlet, four ribs faint on it, sown in the autumn: it may lie a winter or two before it wakes.'],
	['Germination', 180, 'The root goes down; the hook comes up.'],
	['Seedling', 200, 'Two odd seed leaves, each cut into five fingers like a little hand, then the first heart-shaped leaves.'],
	['Sapling', 730, 'A slim young tree, its zigzag shoots red-brown, its leaves in two rows along them.'],
	['Young tree', 2200, 'A tall, dense, egg-shaped crown on a grey trunk, deep shade under it; its soft young leaves are good to eat in a spring salad.'],
	['Flowering', 3300, 'In July, after the other limes: hanging clusters of pale yellow flowers, sweetly scented and loud with bees, each on a long stalk half-joined to a pale leafy bract.'],
	['Fruit set', 3315, 'The flowers fade; small green nutlets set in the clusters, the bracts still pale and fresh.'],
	['Green nutlets', 3360, 'Clusters of little round green nutlets hanging under the leaves on their bracts.'],
	['Turning', 3420, 'The nutlets felt over grey-brown; the bracts go papery and tan.'],
	['Ripe', 3460, 'Hard round nutlets, the bract a wing: in the autumn wind the whole cluster spins away.']
]);

/** a heart-shaped blade: round lobes at its foot, broadest low down, drawn out to a point */
const heart = (/** @type {number} */ u) => (u < 0.22 ? 0.5 + 0.5 * Math.sin((Math.PI / 2) * (u / 0.22)) : Math.pow(Math.cos((Math.PI / 2) * ((u - 0.22) / 0.78)), 0.85));

export const linden = wood({
	seed: { size: v3(0.0035, 0.0033, 0.0033), coat: '#8a7a5a', shade: '#5a4a34', depth: 0.012 },
	hypogeal: false,
	cotyledon: { length: 0.018, width: 0.011, colour: '#5a9a3a' },
	// a tall dense dome: many limbs, steep, densely twigged, leafy down to the lowest
	flush: {
		trunk: 1.6, trunkBorn: 1.6, trunkFlush: 1.2, scaffolds: [4, 6], scaffoldAngle: 0.5, gens: 6, flush: 0.16, rest: 0.08,
		shoot: (gen) => [0, 1.5, 1.1, 0.85, 0.65, 0.5, 0.38][gen] ?? 0.36, whorl: [2, 3], spread: 0.58, up: 0.06, droop: 0.05,
		wander: 0.13, radius: 0.14, taper: 0.62, thicken: 3.5, bark: ['#7e7a6e', '#5c5850']
	},
	roots: { tap: 2.0, spread: 3.2, count: 9, radius: 0.07 },
	leaf: {
		blade: { stalk: 0.032, length: 0.07, width: 0.033, shape: heart, back: 0.12, along: 4, bow: 0.06 },
		colour: '#2f5a24', young: '#5a8a34', autumn: '#d8c04a', droop: 0.35, gap: 0.1, per: 4, twig: 0.2, tuft: 3, from: 3, inner: 1.6
	},
	bear(ctx) {
		const { bag, g, seed } = ctx;
		for (const sh of tips(ctx, 0.45)) {
			const fr = chance(seed, 'flowering', ...sh.key);
			const n = 1 + Math.floor(fr() * 2);
			for (let k = 0; k < n; k++) {
				const kr = chance(seed, 'cyme', ...sh.key, k);
				const opens = 4.85 + kr() * 0.3;
				const phase = g - opens;
				if (phase < -0.4) continue;
				const grown = span(phase, -0.4, 0);
				const { at, dir } = along(sh.pts, between(kr, 0.45, 0.95));
				const a = kr() * TAU;
				const out = dir.clone().add(v3(Math.cos(a), 0, Math.sin(a))).setY(0).normalize();
				// the stalk, out of the leaf axil and down, the bract along its first half
				const peduncle = 0.065 * lerp(0.4, 1, grown);
				const place = hang(ctx, at.clone().addScaledVector(out, 0.01), out.clone().add(v3(0, -1.6, 0)).normalize(), 0.03, 0.022, 0.02);
				const end = place.at.clone().addScaledVector(place.dir, peduncle);
				const mid = at.clone().lerp(end, 0.5).addScaledVector(out, 0.012);
				// the cluster of nutlets with its bract, once the flowers have set
				const nutlets = phase >= 0.55;
				if (nutlets) bag.fruit(['cyme', ...sh.key, k], at, place.dir);
				bag.add('body', tube([at, mid, end], () => 0.0009, () => '#a8b060', 3));
				const ripe = span(phase, 2.4, 3.6);
				const bractColour = ripe < 0.4 ? mix('#c8d88a', '#d8d090', ripe * 2) : mix('#d8d090', '#b89a62', (ripe - 0.4) / 0.6);
				const bractDir = mid.clone().sub(at).normalize();
				bag.add('body', sheet({ length: 0.075 * lerp(0.4, 1, grown), width: 0.009 * lerp(0.4, 1, grown), shape: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.92)), 0.5), lift: (u, v) => 0.04 * v * v, paint: () => bractColour, along: 4, across: 1 }), aim(at.clone().addScaledVector(bractDir, 0.004), bractDir.clone().add(v3(0, -0.3, 0)), 1.2));
				// the cyme: five to eleven flowers, then the nutlets
				const flowers = 5 + Math.floor(kr() * 5);
				const set = span(phase, 0.5, 2.2);
				// of the flowers, one to three set a nutlet
				const keep = phase < 0.55 ? flowers : 1 + Math.floor(kr() * 3);
				for (let f = 0; f < keep; f++) {
					const b = f * 2.39996 + kr();
					const d = v3(Math.cos(b), -0.6 - kr() * 0.6, Math.sin(b)).normalize();
					const p = end.clone().addScaledVector(d, 0.018);
					bag.add('body', tube([end, p], () => 0.0007, () => '#a8b060', 3));
					if (phase < 0.55) {
						const open = span(phase, -0.3, 0.05);
						const fade = span(phase, 0.3, 0.55);
						// a starry flower, its long stamens a pale yellow puff
						bag.add('body', bead(p, v3(1, 0.75, 1).multiplyScalar(lerp(0.0028, 0.0085, open)), open < 0.5 ? '#c8d08a' : mix('#f6eca0', '#b8a868', fade), 3));
					} else {
						const r = lerp(0.0015, 0.0038, set);
						bag.add('body', bead(p.clone().addScaledVector(d, r * 0.5), v3(r, r * 1.05, r), ripe < 0.5 ? mix('#8aa05a', '#9a9a6a', ripe * 2) : mix('#9a9a6a', '#7a6248', (ripe - 0.5) * 2), 3));
					}
				}
				if (nutlets) bag.fruitDone();
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ hazel */

export const HAZEL_STAGES = stages([
	['Nut', 0, 'A hazelnut in its shell, sown in the autumn three centimetres down, chilled by the winter.'],
	['Germination', 150, 'The shell cracks at its tip: the root goes down; the seed leaves stay in the nut.'],
	['Seedling', 180, 'A downy shoot of round, toothed, soft leaves.'],
	['Sapling', 730, 'New stems come up from the base beside the first: the hazel is becoming a stool.'],
	['Young stool', 1800, 'Five to ten straight stems from the stool, four to six metres, cut every seven years or so for poles and grown again.'],
	['Flowering', 2190, 'In late winter, on the bare twigs: yellow lamb’s-tail catkins dangling in ones to fours, and tiny bud-like female flowers with tufts of crimson stigmas.'],
	['Nut set', 2280, 'The leaves come; where the red tufts were, tiny nuts form in clusters, each in a green frilly husk.'],
	['Green nuts', 2380, 'Clusters of green-white nuts in their ragged husks — and next year’s catkins already there, small, stiff and grey-green.'],
	['Turning', 2440, 'The husks dry at their edges; the shells turn from green-white to tan.'],
	['Ripe', 2460, 'Brown hazelnuts loose in browning husks, falling at a shake — before the squirrels and the dormice.']
]);

export const hazel = wood({
	seed: { size: v3(0.009, 0.008, 0.008), coat: '#9a6a3a', shade: '#6a4626', depth: 0.03 },
	hypogeal: true,
	coppice: {
		stems: [6, 9], from: 1.6, every: 0.35, lean: 0.3, stool: 0.22,
		leader: {
			height: [[2, 0], [2.4, 0.25], [3, 1.3], [4, 3.2], [5, 4.4], [6, 4.9], [9, 5.3]], radius: 0.07, tiers: 26, clear: 0.9, spacing: 0.22, angle: 0.85,
			limb: (h) => 1.5 * (1 - 0.55 * h) + 0.3, rate: 1.6, crown: 4.6, sides: 0.5, side: 0.16, bark: ['#8a6a4c', '#6a5440'], droop: 0.09
		}
	},
	roots: { tap: 1.0, spread: 2.2, count: 12, radius: 0.04 },
	leaf: {
		blade: {
			stalk: 0.014, length: 0.11, width: 0.05,
			shape: (u) => (u < 0.2 ? 0.55 + 0.45 * Math.sin((Math.PI / 2) * (u / 0.2)) : u < 0.72 ? 1 - 0.12 * Math.pow((u - 0.2) / 0.52, 2) : 0.88 * Math.pow(Math.cos((Math.PI / 2) * ((u - 0.72) / 0.28)), 0.7)),
			back: 0.08, along: 6, bow: 0.07
		},
		colour: '#3e6e2a', young: '#9ac060', autumn: '#d0b040', droop: 0.3, gap: 0.08, per: 3, twig: 0.14, tuft: 3, limb: 0.25, top: 3, bare: true
	},
	bear(ctx) {
		const { bag, g, seed } = ctx;
		for (const sh of ctx.shoots) {
			if (sh.gen !== 2) continue;
			const sr = chance(seed, 'twig', ...sh.key);
			const sites = sr() < 0.35 ? 1 : 0;
			for (let s = 0; s < sites; s++) {
				const fr = chance(seed, 'flowering', ...sh.key, s);
				const { at, dir } = along(sh.pts, between(fr, 0.72, 1));
				const opens = 4.55 + fr() * 0.25;
				const phase = g - opens;
				// lamb's tails: one to four from the node, hanging
				if (phase > -0.45 && phase < 0.6) {
					const n = 1 + Math.floor(fr() * 4);
					for (let k = 0; k < n; k++) {
						const a = k * 2.39996 + fr();
						const len = lerp(0.025, 0.075, span(phase, -0.45, -0.05)) * lerp(1, 0.6, span(phase, 0.3, 0.6));
						catkin(bag, at, v3(Math.cos(a) * 0.3, -1, Math.sin(a) * 0.3), len, 0.0048, phase < 0.25 ? mix('#a8a860', '#e8d050', span(phase, -0.3, -0.05)) : mix('#e8d050', '#7a6a40', span(phase, 0.25, 0.55)), 0.05);
					}
				}
				// the female flower: a little bud with a tuft of crimson stigmas
				if (phase > -0.3 && phase < 0.7) {
					const bud = at.clone().addScaledVector(dir, 0.006).add(v3(0, 0.004, 0));
					bag.add('body', bead(bud, v3(0.0028, 0.0042, 0.0028), '#6a5a3a', 3));
					const tuft = span(phase, -0.3, 0) * (1 - span(phase, 0.4, 0.7));
					for (let k = 0; k < 6; k++) {
						const a = (k / 6) * TAU;
						bag.add('body', tube([bud.clone().add(v3(0, 0.003, 0)), bud.clone().add(v3(Math.cos(a) * 0.004, 0.007, Math.sin(a) * 0.004))], () => 0.0007 * tuft + 0.0001, () => '#d01838', 3));
					}
				}
				// the nuts, in their husks, one to four together
				const set = span(phase, 0.6, 2.3);
				const ripe = span(phase, 2.6, 3.7);
				if (set > 0) {
					const keep = 1 + Math.floor(fr() * 3);
					for (let k = 0; k < keep; k++) {
						const kr = chance(seed, 'hazelnut', ...sh.key, s, k);
						const size = ctx.vigour * about(kr, 1, 0.08) * lerp(0.15, 1, set);
						const L = 0.02 * size, W = 0.008 * size;
						const swing = v3(Math.cos(k * 2.4 + kr()), 0, Math.sin(k * 2.4 + kr()));
						const place = hang(ctx, at.clone().addScaledVector(swing, 0.008), swing.clone().add(v3(0, -0.8, 0)).normalize(), L * 1.1, W * 1.3, 0.02 + W);
						bag.fruit(['hazelnut', ...sh.key, s, k], at, place.dir);
						bag.add('body', tube([at, place.at], () => 0.0016, () => '#6a7a3a', 3));
						const m = hung(place.at, place.dir, kr() * TAU);
						// the nut: green-white, then tan, then brown
						const nut = ripe < 0.4 ? mix('#d8dcb0', '#c8a868', ripe / 0.4) : mix('#c8a868', '#8a5a2e', (ripe - 0.4) / 0.6);
						bag.add('gloss', bead(v3(0, -L * 0.55, 0), v3(W, L * 0.5, W * 0.92), nut, 3), m);
						// the husk: a ragged leafy cup round the nut's foot, as long as the nut
						const husk = ripe < 0.5 ? mix('#6a9a3a', '#9aa04a', ripe * 2) : mix('#9aa04a', '#9a7a4a', (ripe - 0.5) * 2);
						const axis = [];
						for (let r = 0; r <= 5; r++) axis.push(v3(0, -0.001 - (r / 5) * L * 1.05, 0));
						bag.add('body', tube(axis, (u, v) => W * (0.55 + 0.75 * Math.sqrt(u)) * (u > 0.6 ? 1 + 0.35 * (u - 0.6) * Math.abs(Math.sin(v * Math.PI * 5)) : 1) * (1 + 0.15 * ripe * u), (u, v) => husk.clone().multiplyScalar(u > 0.8 ? 1.15 : 0.95 + 0.1 * Math.sin(v * 31)), 8), m);
						bag.fruitDone();
					}
				}
				// next year's catkins, formed in the summer: small, stiff, grey-green
				const next = span(g, 6.6, 8.6);
				if (next > 0.02) {
					const m = 1 + Math.floor(chance(seed, 'next', ...sh.key, s)() * 2);
					for (let k = 0; k < m; k++) {
						const a = k * 2.39996 + 1.2;
						catkin(bag, at, v3(Math.cos(a), -0.2, Math.sin(a)).addScaledVector(dir, 0.4), 0.022 * next, 0.0026, '#8a8a62', 0.8);
					}
				}
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ pecan */

export const PECAN_STAGES = stages([
	['Nut', 0, 'A pecan in its thin shell, soaked for two days and sown in the spring four centimetres down, after a winter in the cold.'],
	['Germination', 25, 'A thick white root straight down; the seed leaves stay in the shell.'],
	['Seedling', 60, 'A stout shoot with its first leaves, pinnate, the leaflets long and curved like a sickle.'],
	['Sapling', 900, 'A straight young tree with a deep taproot, slow to leaf in the spring and its leaves long and arching.'],
	['Young tree', 2600, 'A tall, oval crown on a straight grey trunk, the bark breaking into narrow scaly ridges — heading for thirty metres.'],
	['Flowering', 3300, 'In late May with the leaves: green catkins hanging in threes from last year’s wood, and at the new shoot tips small spikes of female flowers.'],
	['Nut set', 3330, 'The catkins drop; at the shoot tips clusters of three to six small green nuts, each with four ridges.'],
	['Green nuts', 3420, 'Clusters of ridged green husks the size of a walnut, hanging at the ends of the shoots.'],
	['Turning', 3500, 'The husks darken to brown at their seams.'],
	['Ripe', 3530, 'The husks split along their four ridges and open: smooth brown pecans, long and pointed, dropping in October — the best of the nuts.']
]);

export const pecan = wood({
	seed: { size: v3(0.011, 0.011, 0.02), coat: '#9a6a3e', shade: '#6a4224', depth: 0.04 },
	hypogeal: true,
	// a tall oval crown: a long straight trunk, its limbs rising, the shoots arching out at the top
	flush: {
		trunk: 2.1, trunkBorn: 1.6, trunkFlush: 1.2, scaffolds: [3, 5], scaffoldAngle: 0.48, gens: 6, flush: 0.16, rest: 0.08,
		shoot: (gen) => [0, 1.7, 1.25, 0.94, 0.7, 0.54, 0.42][gen] ?? 0.4, whorl: [2, 3], spread: 0.55, up: 0.06, droop: 0.05,
		wander: 0.12, radius: 0.15, taper: 0.62, thicken: 3.5, bark: ['#8a8478', '#5e5a52']
	},
	roots: { tap: 3, spread: 3.6, count: 9, radius: 0.08 },
	leaf: { blade: { stalk: 0, length: 0.42, width: 0, shape: () => 1, along: 3, pinnate: 5, wide: 0.2 }, colour: '#3e6a2a', young: '#7a9a3e', autumn: '#c8a83e', droop: 0.08, gap: 0.32, per: 1, twig: 0, tuft: 4, from: 4, spring: true },
	bear(ctx) {
		const { bag, g, seed } = ctx;
		// the catkins, in threes from last year's wood
		for (const sh of ctx.shoots) {
			if (sh.gen !== ctx.gens - 1) continue;
			const cr = chance(seed, 'catkins', ...sh.key);
			const phase = g - (4.75 + cr() * 0.25);
			if (phase < -0.45 || phase > 0.55) continue;
			const { at, dir } = along(sh.pts, between(cr, 0.6, 0.95));
			for (let k = 0; k < 3; k++) {
				const a = k * 2.1 + cr();
				const len = 0.12 * lerp(0.25, 1, span(phase, -0.45, -0.05)) * lerp(1, 0.6, span(phase, 0.25, 0.55));
				catkin(bag, at, dir.clone().add(v3(Math.cos(a) * 0.4, -0.5, Math.sin(a) * 0.4)).normalize(), len, 0.0035, phase < 0.2 ? mix('#7a9440', '#c0c05a', span(phase, -0.1, 0.1)) : mix('#c0c05a', '#6a5a3a', span(phase, 0.2, 0.45)), 0.08);
			}
		}
		// the nuts, in clusters at the tips of the new shoots
		for (const sh of tips(ctx, 0.55)) {
			const fr = chance(seed, 'flowering', ...sh.key);
			const phase = g - (4.85 + fr() * 0.25);
			if (phase < 0.4) continue;
			const set = span(phase, 0.4, 2.3), ripe = span(phase, 2.6, 3.7);
			const keep = 3 + Math.floor(fr() * 4);
			const up = sh.dir.clone().lerp(v3(0, 1, 0), 0.4).normalize();
			for (let k = 0; k < keep; k++) {
				const kr = chance(seed, 'pecan', ...sh.key, k);
				const size = ctx.vigour * about(kr, 1, 0.08) * lerp(0.2, 1, set);
				const L = 0.048 * size, W = 0.016 * size;
				const swing = v3(Math.cos(k * 2.4 + kr() * 2), 0, Math.sin(k * 2.4 + kr() * 2));
				const start = sh.tip.clone().addScaledVector(up, 0.01 + 0.012 * k);
				const place = hang(ctx, start.clone().addScaledVector(swing, 0.015), DOWN.clone().addScaledVector(swing, 0.7), L, W, 0.02 + W);
				bag.fruit(['pecan', ...sh.key, k], sh.tip, place.dir);
				bag.add('body', tube([sh.tip, start, place.at], () => 0.0026 + 0.0014 * set, () => '#6a7040', 4));
				husked(bag, hung(place.at, place.dir, kr() * TAU), L, W, {
					shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.04 + u * 0.96))), 0.65),
					// green, its four ridges paler; then browning from the seams
					husk: (u, v) => {
						const ridge = Math.pow(Math.abs(Math.cos(v * Math.PI * 4)), 8);
						const c = ripe < 0.5 ? mix('#6a9a3a', '#7a7a3a', ripe * 2) : mix('#7a7a3a', '#3e2e1e', (ripe - 0.5) * 2);
						return c.multiplyScalar(0.92 + 0.2 * ridge + 0.06 * u);
					},
					split: span(ripe, 0.5, 1), valves: 4, rings: 8, sides: 12, nut: '#8a5a32', nuts: 1, nutSize: 0.9
				});
				bag.fruitDone();
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ Turkish tree hazel */

export const TREE_HAZEL_STAGES = stages([
	['Nut', 0, 'A thick-shelled hazelnut, sown in the autumn three centimetres down, chilled by the winter.'],
	['Germination', 150, 'The shell cracks at its tip: the root goes down; the seed leaves stay in the nut.'],
	['Seedling', 180, 'A single straight shoot of broad, double-toothed leaves — no suckers: this hazel is a tree.'],
	['Sapling', 900, 'A neat young tree on one trunk, its crown a narrow cone; it shrugs off drought, heat and city air.'],
	['Young tree', 2600, 'A tall pyramid of a crown on a straight trunk with corky, flaking grey bark, its limbs level, the leaves big and dark.'],
	['Flowering', 3000, 'In late winter, before the leaves: long yellow lamb’s tails by the hundred, and the tiny crimson-tufted female flowers.'],
	['Nut set', 3100, 'The leaves come; at the shoot tips the nuts form in clusters of three to six, each wrapped in a long, deeply fringed husk.'],
	['Green clusters', 3200, 'Clusters of nuts in their curly green bracts, like little bunches of lettuce, all over the crown.'],
	['Turning', 3260, 'The husks dry and curl at their tips; the shells turn tan.'],
	['Ripe', 3290, 'Brown hazelnuts falling out of their dry fringed husks in September — the same sweet hazelnut, from a tree twenty metres tall.']
]);

export const treeHazel = wood({
	seed: { size: v3(0.01, 0.009, 0.009), coat: '#9a6a3a', shade: '#6a4626', depth: 0.03 },
	hypogeal: true,
	// one straight trunk to the top, its limbs in tiers round it: a narrow cone, broadening with age
	leader: {
		height: [[2, 0], [2.4, 0.3], [3, 1.4], [4, 3.6], [5, 5.6], [6, 6.6], [9, 7.3]], radius: 0.17, tiers: 34, clear: 1.6, spacing: 0.19, angle: 1.05,
		limb: (h) => 3.4 * (1 - 0.7 * h) + 0.3, rate: 1.5, crown: 6.2, sides: 0.75, side: 0.2, bark: ['#8a8074', '#6a6258'], droop: 0.08
	},
	roots: { tap: 2.2, spread: 3, count: 10, radius: 0.07 },
	leaf: {
		blade: {
			stalk: 0.02, length: 0.12, width: 0.06,
			shape: (u) => (u < 0.2 ? 0.55 + 0.45 * Math.sin((Math.PI / 2) * (u / 0.2)) : u < 0.7 ? 1 - 0.12 * Math.pow((u - 0.2) / 0.5, 2) : 0.88 * Math.pow(Math.max(0, Math.cos((Math.PI / 2) * ((u - 0.7) / 0.3))), 0.7)) * (1 + 0.04 * Math.sin(u * 50)),
			back: 0.08, along: 6, bow: 0.07
		},
		colour: '#2e5a22', young: '#7ab048', autumn: '#c8a840', droop: 0.3, gap: 0.08, per: 3, twig: 0.14, tuft: 3, limb: 0.2, top: 2.4, bare: true
	},
	bear(ctx) {
		const { bag, g, seed } = ctx;
		for (const sh of ctx.shoots) {
			if (sh.gen !== 2) continue;
			const fr = chance(seed, 'flowering', ...sh.key);
			if (fr() > 0.45) continue;
			const { at, dir } = along(sh.pts, between(fr, 0.75, 1));
			const phase = g - (4.55 + fr() * 0.25);
			// lamb's tails: two to four from the node, hanging
			if (phase > -0.45 && phase < 0.6) {
				const n = 2 + Math.floor(fr() * 3);
				for (let k = 0; k < n; k++) {
					const a = k * 2.39996 + fr();
					const len = lerp(0.03, 0.09, span(phase, -0.45, -0.05)) * lerp(1, 0.6, span(phase, 0.3, 0.6));
					catkin(bag, at, v3(Math.cos(a) * 0.3, -1, Math.sin(a) * 0.3), len, 0.005, phase < 0.25 ? mix('#a8a860', '#e8d050', span(phase, -0.3, -0.05)) : mix('#e8d050', '#7a6a40', span(phase, 0.25, 0.55)), 0.05);
				}
			}
			// the nuts, three to six together, each in a long fringed husk
			const set = span(phase, 0.6, 2.3), ripe = span(phase, 2.6, 3.7);
			if (set <= 0) continue;
			const keep = 3 + Math.floor(fr() * 4);
			for (let k = 0; k < keep; k++) {
				const kr = chance(seed, 'treehazel', ...sh.key, k);
				const size = ctx.vigour * about(kr, 1, 0.08) * lerp(0.15, 1, set);
				const L = 0.019 * size, W = 0.0085 * size;
				const swing = v3(Math.cos(k * 2.4 + kr()), 0, Math.sin(k * 2.4 + kr()));
				const place = hang(ctx, at.clone().addScaledVector(swing, 0.01), swing.clone().add(v3(0, -0.7, 0)).normalize(), L * 1.6, W * 1.5, 0.02 + W);
				bag.fruit(['treehazel', ...sh.key, k], at, place.dir);
				bag.add('body', tube([at, place.at], () => 0.0018, () => '#6a7a3a', 3));
				const m = hung(place.at, place.dir, kr() * TAU);
				const nut = ripe < 0.4 ? mix('#d8dcb0', '#c8a868', ripe / 0.4) : mix('#c8a868', '#8a5a2e', (ripe - 0.4) / 0.6);
				bag.add('gloss', bead(v3(0, -L * 0.55, 0), v3(W, L * 0.5, W * 0.95), nut, 3), m);
				// the husk: longer than the nut, cut deep into curling fringes
				const husk = ripe < 0.5 ? mix('#5e9234', '#9aa04a', ripe * 2) : mix('#9aa04a', '#9a7a4a', (ripe - 0.5) * 2);
				const axis = [];
				for (let r = 0; r <= 6; r++) axis.push(v3(0, -0.001 - (r / 6) * L * 1.6, 0));
				bag.add('body', tube(axis, (u, v) => W * (0.55 + 0.9 * Math.sqrt(u)) * (u > 0.45 ? 1 + 0.6 * (u - 0.45) * Math.abs(Math.sin(v * Math.PI * 7)) : 1) * (1 + 0.2 * ripe * u), (u, v) => husk.clone().multiplyScalar(u > 0.75 ? 1.12 : 0.94 + 0.1 * Math.sin(v * 31)), 10), m);
				bag.fruitDone();
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ Korean pine */

export const PINE_STAGES = stages([
	['Seed', 0, 'A big wingless pine nut in its hard shell, soaked and chilled through the winter, sown in the spring two centimetres down.'],
	['Germination', 30, 'The root goes down; the shoot comes up wearing the shell like a cap.'],
	['Seedling', 60, 'A ring of a dozen slender seed leaves, then the first single needles.'],
	['Sapling', 1100, 'A small dense cone of soft blue-green needles in fives, slow for its first years, a whorl of branches a year.'],
	['Young tree', 3300, 'A tall cone of level tiers on one straight trunk, its bark grey-brown and scaly, its needles in long soft bundles.'],
	['Flowering', 4300, 'In June: clusters of yellow pollen cones at the base of the new shoots low in the crown; small red seed cones at the tips of the topmost shoots.'],
	['Cone set', 4320, 'The pollinated seed cones turn green and stop — a pine nut takes two summers to ripen.'],
	['Green cones', 4700, 'In the second summer the cones swell, upright at the top of the crown: green, fat, sticky with resin.'],
	['Turning', 4760, 'The cones go brown from their tips, their scales thick and woody.'],
	['Ripe', 4790, 'Big brown cones, their scales loosening on the big pine nuts — the sweet, rich nuts of the Siberian taiga, falling whole in the autumn.']
]);

/** a bundle of pine needles: long and narrow, splaying a little from its foot, to a point */
const needle = (/** @type {number} */ u) => (u < 0.1 ? 0.6 + 4 * u : 1 - 0.85 * Math.pow((u - 0.1) / 0.9, 2));

export const pine = wood({
	seed: { size: v3(0.006, 0.005, 0.009), coat: '#6a4a2e', shade: '#4a3220', depth: 0.02 },
	hypogeal: false,
	cotyledon: { length: 0.03, width: 0.0018, colour: '#5a8a4a' },
	// one straight trunk, its limbs in level whorls, the lower long, the upper short: a tall cone
	leader: {
		height: [[2, 0], [2.4, 0.2], [3, 0.9], [4, 3.2], [5, 5.6], [6, 6.9], [9, 7.6]], radius: 0.19, tiers: 44, clear: 1.2, spacing: 0.15, angle: 1.32,
		limb: (h) => 3.3 * Math.pow(1 - h, 1.05) + 0.25, rate: 1.4, crown: 6.8, sides: 0.55, side: 0.15, bark: ['#7a6450', '#54443a'], droop: 0.14
	},
	roots: { tap: 1.6, spread: 3.4, count: 10, radius: 0.07 },
	leaf: {
		// (a bundle of five needles drawn as two narrow blades crossed: from a few metres off that is what it reads as)
		blade: { stalk: 0, length: 0.12, width: 0.014, shape: needle, along: 2, bow: 0.12, cross: true },
		colour: '#335e3a', young: '#6a9a5a', autumn: '#335e3a', droop: -0.05, gap: 0.065, per: 5, twig: 0.05, tuft: 12, limb: 0.1, top: 2
	},
	bear(ctx) {
		const { bag, g, seed } = ctx;
		// the cones, upright on the shoots at the top of the crown
		const high = ctx.shoots.filter((sh) => sh.gen === 2 && sh.tip.y > 0);
		const top = high.reduce((m, sh) => Math.max(m, sh.tip.y), 0);
		for (const sh of high) {
			if (sh.tip.y < top * 0.68) continue;
			const fr = chance(seed, 'cones', ...sh.key);
			if (fr() > 0.5) continue;
			const phase = g - (4.8 + fr() * 0.2);
			if (phase < -0.2) continue;
			const set = span(phase, 0, 2.2), ripe = span(phase, 2.6, 3.7);
			const n = 1 + Math.floor(fr() * 2);
			for (let k = 0; k < n; k++) {
				const kr = chance(seed, 'cone', ...sh.key, k);
				const L = lerp(0.015, 0.13, set) * about(kr, 1, 0.08), W = lerp(0.006, 0.05, set) * about(kr, 1, 0.06);
				const a = k * 2.39996 + kr();
				const dir = v3(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25).normalize();
				const base = sh.tip.clone().addScaledVector(dir, 0.01);
				// a cone once pollinated (before that, a red seed-cone flower)
				if (set > 0) bag.fruit(['cone', ...sh.key, k], sh.tip, dir);
				// built from its foot along its axis, standing up
				const colour = set < 0.15 ? mix('#a83a3a', '#6a8a4a', set / 0.15) : ripe < 0.5 ? mix('#6a8a4a', '#7a6a3a', ripe * 2) : mix('#7a6a3a', '#5a3a22', (ripe - 0.5) * 2);
				const open = span(ripe, 0.6, 1);
				const axis = [];
				for (let r = 0; r <= 8; r++) axis.push(v3(0, -(r / 8) * L, 0));
				bag.add('body', tube(axis, (u, v) => W * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.92))), 0.55) * (1 + (0.1 + 0.22 * open) * ((Math.round(u * 9) + Math.round(v * 8)) % 2)), (u, v) => colour.clone().multiplyScalar((Math.round(u * 9) + Math.round(v * 8)) % 2 ? 1.12 : 0.78), 8), hung(base, dir, kr() * TAU));
				if (set > 0) bag.fruitDone();
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ the list */

/** @type {(import('./index.js').Plant & { layer: import('./index.js').Layer })[]} */
export const WALD = [
	{
		id: 'walnut',
		label: 'Walnut',
		latin: 'Juglans regia · Walnuss',
		note: 'A broad dome on a clear grey trunk: long pinnate leaves bronze as they open, green catkins on last year’s wood, green husked walnuts in ones to threes at the shoot tips, splitting brown-black over the ripe nuts.',
		from: 'Tree · 9 years',
		stages: WALNUT_STAGES,
		grow: walnut,
		layer: 'canopy'
	},
	{
		id: 'chestnut',
		label: 'Sweet chestnut',
		latin: 'Castanea sativa · Esskastanie',
		note: 'A big domed tree of long, bristle-toothed leaves; at midsummer long cream catkins all over the crown, then spiny green burrs at the shoot tips, fading yellow-brown and splitting over two or three glossy chestnuts.',
		from: 'Tree · 9 years',
		stages: CHESTNUT_STAGES,
		grow: chestnut,
		layer: 'canopy'
	},
	{
		id: 'alder',
		label: 'Black alder',
		latin: 'Alnus glutinosa · Schwarzerle',
		note: 'The support tree: a narrow cone on a straight dark trunk, round notched leaves, purple-brown catkins in late winter, little woody cones — and on its roots the orange nodules where Frankia fixes nitrogen for the garden.',
		from: 'Tree · 7 years',
		stages: ALDER_STAGES,
		grow: alder,
		layer: 'canopy'
	},
	{
		id: 'linden',
		label: 'Small-leaved lime',
		latin: 'Tilia cordata · Winterlinde',
		note: 'A tall, dense crown of small heart-shaped leaves (the young ones good to eat); in July hanging clusters of pale yellow scented flowers on their leafy bracts, then little round nutlets that spin away on them.',
		from: 'Tree · 9 years',
		stages: LINDEN_STAGES,
		grow: linden,
		layer: 'canopy'
	},
	{
		id: 'pecan',
		label: 'Pecan',
		latin: 'Carya illinoinensis · Pekannuss',
		note: 'The finest nut of the canopy: a tall oval crown on a straight trunk, long arching pinnate leaves, green catkins in threes, then clusters of four-ridged green husks splitting over smooth, long brown pecans.',
		from: 'Tree · 10 years',
		stages: PECAN_STAGES,
		grow: pecan,
		layer: 'canopy'
	},
	{
		id: 'tree-hazel',
		label: 'Turkish tree hazel',
		latin: 'Corylus colurna · Baumhasel',
		note: 'A hazel grown into a tall tree: one straight trunk with corky bark, a narrow pyramid of big dark leaves, yellow lamb’s tails in late winter, then hazelnuts by the cluster in long, curly fringed husks.',
		from: 'Tree · 9 years',
		stages: TREE_HAZEL_STAGES,
		grow: treeHazel,
		layer: 'canopy'
	},
	{
		id: 'korean-pine',
		label: 'Korean pine',
		latin: 'Pinus koraiensis · Korea-Kiefer',
		note: 'The evergreen of the canopy and the hardiest nut pine: a tall cone of level tiers, soft blue-green needles in fives, and at the top of the crown fat upright cones that ripen over two summers and fall full of big sweet pine nuts.',
		from: 'Tree · 13 years',
		stages: PINE_STAGES,
		grow: pine,
		layer: 'canopy'
	},
	{
		id: 'hazel',
		label: 'Hazel',
		latin: 'Corylus avellana · Haselnuss',
		note: 'A coppice stool of straight stems from the base, round toothed leaves; yellow lamb’s tails and crimson-tufted female flowers on the bare twigs in late winter, then nuts in clusters in their frilly husks, ripening brown.',
		from: 'Coppice · 6 years',
		stages: HAZEL_STAGES,
		grow: hazel,
		layer: 'sub-canopy'
	}
];
