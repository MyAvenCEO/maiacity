/*
 * WALD · PERENNIALS — the soft layers of a temperate forest garden, under the trees and the shrubs: the herbaceous
 * perennials that come back from their crowns every spring, the ground cover, the roots and tubers, and a climber.
 *
 * Rhubarb (Rhabarber) rises from a knobbly crown: red buds, huge crinkled leaves on thick red stalks, pulled from the
 * outside in its second spring, then a hollow stem two metres high with a cream plume. Sorrel (Sauerampfer) is a
 * clump of arrow-shaped sour leaves and reddish flower spikes. The stinging nettle (Brennnessel) runs on yellow
 * rhizomes into a patch of square stems, toothed heart leaves in pairs, green tassels hanging from the axils. The
 * globe artichoke (Artischocke) is a fountain of deeply cut silver leaves, its stems carrying the scaly buds that are
 * eaten, or left to open into violet thistles. Asparagus (Spargel) sends up its spears from a spidery crown, then
 * feathery fern a metre and a half high, red berries on the female plants.
 *
 * Nasturtium (Kapuzinerkresse) trails over the soil, round shield leaves with the stalk at the middle, spurred
 * flowers orange, red or yellow, and wrinkled green seeds in threes. Sweet woodruff (Waldmeister) carpets the shade
 * with stems of starry whorls and tiny white flowers.
 *
 * The Jerusalem artichoke (Topinambur) stands three metres high with little yellow sunflowers, a nest of knobbly
 * tubers below; horseradish (Meerrettich) a clump of big wavy leaves over a white root thick as a wrist. And the hop
 * (Hopfen) twines clockwise up its pole, rough lobed leaves in pairs, side arms hung with papery cones.
 *
 * All at real measure (metres), the soil's surface at y = 0. Each entry is a plant as ./index.js lists it, with its
 * food-forest `layer`; ./index.js adds every entry of WALD to the library.
 */
import * as THREE from 'three';
import { Bag, DETAIL, Space, about, aim, bead, between, chance, clamp, fan, lerp, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/* ------------------------------------------------------------------------------------------------ shared */

const UP = v3(0, 1, 0);

/**
 * The colours, each read from its text once: a plant paints thousands of vertices, and reading '#3d6a28' afresh for
 * every one of them costs more than the shapes. (Never changed: `mix` makes a new colour from them.)
 * @type {Map<string, THREE.Color>}
 */
const COLOURS = new Map();
/** a colour by its text, read once */
const tint = (/** @type {THREE.ColorRepresentation} */ c) => {
	if (c instanceof THREE.Color) return c;
	const key = String(c);
	let got = COLOURS.get(key);
	if (!got) COLOURS.set(key, (got = new THREE.Color(c)));
	return got;
};
/** a colour between two, as a new THREE.Color (./grow.js's `mix`, with the colours read once) */
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

/** a direction `tilt` (radians) from upright toward the level `out` */
const tilted = (/** @type {THREE.Vector3} */ out, /** @type {number} */ tilt) => out.clone().setY(0).normalize().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();

/** a level direction at the compass bearing a */
const level = (/** @type {number} */ a) => v3(Math.cos(a), 0, Math.sin(a));

/**
 * The matrix that sets a shape built along +X (its face +Y) at `at`, pointing along `x`, its face turned toward `up`
 * as far as it can — a bract's face outward from its bud, a petal's toward where the flower looks.
 * @param {THREE.Vector3} at @param {THREE.Vector3} x @param {THREE.Vector3} up
 */
function face(at, x, up) {
	const X = x.clone().normalize();
	let Z = new THREE.Vector3().crossVectors(X, up);
	if (Z.lengthSq() < 1e-8) Z = new THREE.Vector3().crossVectors(X, Math.abs(X.y) < 0.9 ? UP : v3(1, 0, 0));
	Z.normalize();
	const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
	return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(at);
}

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

/** the quaternion that turns +Y to `d` */
const upTo = (/** @type {THREE.Vector3} */ d) => new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());

/** a leaf's colour: its green (paler while young), the midrib lighter, yellowing and browning as it gets old */
function leafColour(/** @type {string} */ green, /** @type {string} */ young, /** @type {number} */ grown, /** @type {number} */ old, /** @type {number} */ u) {
	return mix(green, young, (1 - grown) * 0.8).lerp(mix('#c8b04a', '#8a6a3a', u), clamp(old * 1.3 - (1 - u) * 0.3));
}

/**
 * SLIVERS — many small narrow leaves (an asparagus fern's needles, a woodruff's whorls) gathered into one geometry, so
 * that thousands of them are one piece and not thousands: each a slim diamond from its base along its direction, its
 * face turned up as far as it can, made with both faces for the plant's one-sided body material.
 */
class Slivers {
	constructor() {
		/** @type {number[]} */
		this.pos = [];
		/** @type {number[]} */
		this.nor = [];
		/** @type {number[]} */
		this.col = [];
	}
	/**
	 * @param {THREE.Vector3} at @param {THREE.Vector3} dir @param {number} length @param {number} width its half-width
	 * @param {THREE.ColorRepresentation} colour @param {number} [droop] how far its tip bends down, in parts of its length
	 * @param {boolean} [needle] a needle: one slim triangle, not a diamond
	 * @param {THREE.Vector3} [across] which way its width lies (level, across its direction, if not given)
	 */
	add(at, dir, length, width, colour, droop = 0, needle = false, across) {
		const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
		const dx = dir.x / dl, dy = dir.y / dl, dz = dir.z / dl;
		// across it, level: dir × up
		let sx = -dz, sy = 0, sz = dx;
		if (across) (sx = across.x), (sy = across.y), (sz = across.z);
		const sl = Math.hypot(sx, sy, sz);
		if (sl < 1e-6) (sx = 1), (sy = 0), (sz = 0);
		else (sx /= sl), (sy /= sl), (sz /= sl);
		const m = needle ? 0 : 0.4;
		const mx = at.x + dx * length * m, my = at.y + dy * length * m, mz = at.z + dz * length * m;
		const tip = [at.x + dx * length, at.y + dy * length - droop * length, at.z + dz * length];
		const l = [mx + sx * width, my + sy * width, mz + sz * width], r = [mx - sx * width, my - sy * width, mz - sz * width];
		const base = [at.x, at.y, at.z];
		const c = tint(colour);
		for (const [a, b, e] of needle ? [[l, tip, r]] : [[base, l, tip], [base, tip, r]]) {
			const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = e[0] - a[0], vy = e[1] - a[1], vz = e[2] - a[2];
			let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
			const nl = Math.hypot(nx, ny, nz) || 1;
			(nx /= nl), (ny /= nl), (nz /= nl);
			// its face, and its back
			this.pos.push(...a, ...b, ...e, ...a, ...e, ...b);
			for (let k = 0; k < 6; k++) {
				const f = k < 3 ? 1 : -1;
				this.nor.push(nx * f, ny * f, nz * f);
				this.col.push(c.r, c.g, c.b);
			}
		}
	}
	/** into the bag, as one piece of the body */
	into(/** @type {Bag} */ bag) {
		if (!this.pos.length) return;
		const geo = new THREE.BufferGeometry();
		const n = this.pos.length / 3;
		geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
		geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(n * 2).fill(0), 2));
		geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
		geo.setIndex([...Array(n).keys()]);
		bag.add('body', geo);
	}
}

/* ------------------------------------------------------------------------------------------------ rhubarb */

export const RHUBARB_STAGES = stages([
	['Crown', 0, 'A division of an old crown — a fat red bud or two on a piece of knobbly rootstock — set level with the soil in late winter.'],
	['Bud break', 14, 'Red knobbly buds push through the soil, the crumpled leaves packed tight inside them.'],
	['Unfurling', 30, 'The first leaves unfurl, crinkled and bronze-green, on short red stalks.'],
	['First summer', 90, 'A clump of big leaves; none pulled in the first year, so the crown can build.'],
	['Second spring', 400, 'Back from the winter with more buds, broader leaves and thicker stalks.'],
	['Full clump', 430, 'Leaves half a metre across on stalks thick as a thumb, the clump a metre and more wide.'],
	['First pull', 450, 'The first stalks pulled — held low and twisted off the crown, never cut — a few only.'],
	['Pulling', 480, 'Pulled from the outside week by week, the leaves cut off onto the compost (they are poisonous); never more than a third, and no more after midsummer.'],
	['Flower spike', 500, 'A thick hollow stem shoots up two metres from the crown, papery sheaths at its nodes, a great plume of tiny cream flowers.'],
	['Seed', 530, 'The plume turns rusty red with winged seeds; the old leaves yellow at their edges. (Cut the spike early and the crown keeps its strength.)']
]);

/** a rhubarb blade's reach at the angle a: roundly heart-shaped, the stalk in its notch, the margin wavy */
const rhubarbEdge = (/** @type {number} */ a) => {
	const c = 0.45, rho = 0.72, s = Math.sin(a);
	const d = c * Math.cos(a) + Math.sqrt(rho * rho - c * c * s * s);
	const notch = 1 - 0.85 * Math.exp(-Math.pow((Math.abs(a) - Math.PI) / 0.3, 2));
	return (d / (c + rho)) * notch * (1 + 0.04 * Math.sin(a * 13));
};

/**
 * Rhubarb at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function rhubarb(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const crown = v3(0, -0.025, 0);
	const build = span(g, 0, 5.5);
	// the rootstock: a knobbly brown crown just under the soil
	const cr = chance(seed, 'rhubarb-crown');
	for (let k = 0; k < 5; k++) {
		const a = k * 2.39996 + cr();
		const d = k ? 0.025 + 0.035 * build : 0;
		bag.add('body', bead(crown.clone().add(v3(Math.cos(a) * d, -0.01 - cr() * 0.015, Math.sin(a) * d)), v3(1, 0.7, 1).multiplyScalar((0.03 + 0.02 * build) * vigour), mix('#5a3e2c', '#7a5440', cr()), 5));
	}
	// its fat red buds, sitting on top of the crown until they break
	for (let k = 0; k < 2; k++) {
		const swell = 1 - span(g, 0.7 + k * 0.3, 1.2 + k * 0.3);
		if (swell > 0) bag.add('gloss', bead(crown.clone().add(v3(k * 0.035 - 0.015, 0.03 + 0.01 * (1 - swell), k * 0.01)), v3(0.018, 0.024, 0.018).multiplyScalar(lerp(0.6, 1, swell)), '#b02238', 6));
	}
	// the thick fleshy roots, yellow inside a brown skin, going down a metre when old
	for (let i = 0; i < 6; i++) {
		const rr = chance(seed, 'rhubarb-root', i);
		const a = i * 2.39996 + rr();
		root(bag, { seed, key: ['root', i], from: crown.clone().add(v3(Math.cos(a) * 0.03, -0.03, Math.sin(a) * 0.03)), dir: v3(Math.cos(a) * 0.6, -1, Math.sin(a) * 0.6), length: between(rr, 0.5, 0.9) * vigour, grown: table(g, [[0, 0.3], [2, 0.5], [4, 0.8], [6, 1]]), radius: 0.007 + 0.008 * build, down: 0.05, wander: 0.2, laterals: 4, lateral: 0.35, depth: 1, age: 0.6 + 0.4 * build, young: '#e8c890', old: '#6a4a30' });
	}
	// the leaves: the first year's, gone in the autumn; the second spring's, bigger, some of them pulled
	/** @type {{ key: number, born: number, size: number, wither: number, pulled: number, old: number }[]} */
	const leaves = [];
	for (let i = 0; i < 8; i++) leaves.push({ key: i, born: 0.7 + i * 0.27, size: 0.42 + 0.06 * i, wither: span(g, 3.2 + i * 0.03, 3.85), pulled: Infinity, old: 0 });
	for (let j = 0; j < 18; j++) leaves.push({ key: 8 + j, born: 3.6 + j * 0.15, size: j < 3 ? 0.8 : 0.95, wither: 0, pulled: j % 2 === 0 && j < 10 ? 5.9 + j * 0.15 : Infinity, old: span(g, 8.3, 9.4) * (j < 9 ? 0.55 : 0.25) });
	for (const L of leaves) {
		if (g <= L.born || L.wither >= 1 || g > L.pulled) continue;
		const lr = chance(seed, 'rhubarb-leaf', L.key);
		const grown = clamp((g - L.born) / 1.1);
		const bear = L.key * 2.39996 + about(lr, 0, 0.2);
		const out = level(bear);
		const S = L.size * vigour * about(lr, 1, 0.08);
		// the red bud it comes from, until it opens
		if (grown < 0.25) bag.add('body', bead(crown.clone().addScaledVector(out, 0.02).add(v3(0, 0.025, 0)), v3(0.014, 0.022, 0.014).multiplyScalar(lerp(0.6, 1, S) * (1 - grown * 2)), '#b0283a', 4));
		const P = (0.08 + 0.32 * S) * lerp(0.15, 1, grown);
		const tilt = lerp(0.06, between(lr, 0.45, 0.85), grown) + L.wither * 0.7;
		const pts = arch(crown.clone().addScaledVector(out, 0.02).add(v3(0, 0.02, 0)), tilted(out, tilt), P, 0.25 * grown + L.wither * 0.6, 6);
		const pr = (0.004 + 0.011 * S) * lerp(0.35, 1, grown);
		const fleck = lr() * 10;
		bag.add('gloss', tube(pts, (u) => pr * (1 - 0.35 * u), (u, v) => mix(mix('#a8182e', '#c0384a', Math.abs(Math.sin(v * 9 + fleck)) > 0.9 ? 0.6 : 0), '#7a8a3a', clamp(u * 0.9 - 0.3 + L.wither)).lerp(tint('#8a7a4a'), L.wither), 6));
		bag.space.rod(pts, pr);
		// the blade: crumpled and folded up while it unfurls, then spread nearly level, blistered and wavy
		const R = (0.12 + 0.4 * S) * lerp(0.15, 1, grown);
		const fold = (1 - grown) * 0.9;
		const top = pts[pts.length - 1];
		const lift = lerp(1.1, -0.05 + lr() * 0.2, grown) - L.wither * 0.8;
		const dir = out.clone().multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0));
		const crinkle = lerp(1.6, 1, grown);
		bag.add(
			'sheet',
			fan({
				size: R,
				from: -Math.PI,
				to: Math.PI,
				edge: (a) => rhubarbEdge(a) * (1 - 0.45 * fold * Math.abs(Math.sin(a))),
				lift: (s, a) => fold * Math.abs(Math.sin(a)) * s * 0.8 - (0.1 + L.wither * 0.3) * s * s + crinkle * (0.045 * Math.sin(a * 8 + s * 5) * s * s + 0.014 * Math.sin(s * 22) * Math.cos(a * 11) * s),
				paint: (s, a) => {
					const m = Math.abs(a) % 0.95, vein = Math.min(m, 0.95 - m) < 0.03 + 0.03 * (1 - s);
					const base = leafColour('#3d6a28', '#7a6a2a', grown, Math.max(L.wither, L.old * clamp((s - 0.6) * 3)), s);
					return vein ? base.lerp(tint(s < 0.3 ? '#b04050' : '#b8c48a'), 0.5) : base;
				},
				rings: 10,
				rays: 30
			}),
			face(top, dir, UP)
		);
	}
	// the flower spike, from the crown's middle
	const rise = span(g, 7.3, 8.1);
	if (rise > 0) {
		const fr = chance(seed, 'rhubarb-spike');
		const H = (1.5 + 0.4 * fr()) * vigour * rise;
		const lean = v3(fr() - 0.5, 0, fr() - 0.5).multiplyScalar(0.12);
		const stem = [];
		for (let k = 0; k <= 10; k++) {
			const h = (k / 10) * H;
			stem.push(crown.clone().add(v3(lean.x * h * h, 0.02 + h, lean.z * h * h)));
		}
		bag.add('body', tube(stem, (u) => 0.02 * (1 - 0.65 * u) * lerp(0.6, 1, rise), (u, v) => mix('#6a8a3a', '#a83040', Math.abs(Math.sin(u * 40 + v * 13)) > 0.92 ? 0.7 : 0.15), 8));
		bag.space.rod(stem, 0.02);
		const bloom = span(g, 7.8, 8.3), seeding = span(g, 8.6, 9.3);
		// the papery sheaths (ochreae) at the nodes, and a small leaf at the lower ones
		for (let k = 1; k <= 4; k++) {
			const u = 0.1 * k;
			const p = point(stem, u);
			bag.add('body', bead(p, v3(0.03, 0.014, 0.03).multiplyScalar(1 - u), mix('#d8c8a0', '#a8865a', seeding), 4));
			if (k > 3) continue;
			const a = k * 2.4 + fr();
			const leafAt = p.clone().addScaledVector(level(a), 0.02);
			bag.add('sheet', fan({ size: 0.12 * (1 - k * 0.2) * rise, from: -Math.PI, to: Math.PI, edge: rhubarbEdge, lift: (s, aa) => -0.12 * s * s + 0.03 * Math.sin(aa * 8) * s, paint: (s) => leafColour('#3d6a28', '#6a8a3a', 1, seeding * 0.6, s), rings: 5, rays: 16 }), face(leafAt, tilted(level(a), 1.2), UP));
		}
		// the plume: its branches from the upper half, each a spray of tiny cream flowers in clusters
		if (bloom <= 0.05) {
			bag.add('body', bead(stem[10], v3(0.035, 0.05, 0.035).multiplyScalar(lerp(0.6, 1, rise)), '#d8c8a8', 6));
		} else {
			const flower = seeding > 0 ? mix('#efe6c8', '#a8402c', seeding) : mix('#d8d0a8', '#f2ecd2', bloom);
			const branches = 22;
			for (let b = 0; b < branches; b++) {
				const t = b / (branches - 1);
				const from = point(stem, 0.45 + 0.52 * t);
				const len = (0.3 - 0.2 * t) * bloom;
				const d = level(b * 2.39996 + fr()).multiplyScalar(0.6).add(v3(0, 0.8, 0));
				const twig = arch(from, d, len, -0.15, 3);
				bag.add('body', tube(twig, () => 0.003 * (1 - 0.5 * t), () => tint('#8a9a5a'), 3));
				// along each branch, little sprays packed with flowers: a fluffy plume
				for (let m = 1; m <= 6; m++) {
					const p = point(twig, m / 6);
					for (let q = 0; q < 3; q++) {
						const side = level(m * 2.39996 + b + q * 2.1).multiplyScalar(0.012 + 0.006 * q).add(v3(0, 0.006 * q, 0));
						bag.add('body', bead(p.clone().add(side), v3(0.011, 0.009, 0.011).multiplyScalar(lerp(0.5, 1, bloom) * (1 - 0.35 * t)), flower, 2));
					}
				}
			}
			for (let m = 0; m < 6; m++) bag.add('body', bead(point(stem, 0.94 + m * 0.012).add(level(m * 2.4).multiplyScalar(0.008)), v3(0.008, 0.008, 0.008), flower, 2));
		}
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ sorrel */

export const SORREL_STAGES = stages([
	['Seed', 0, 'A small, glossy, three-sided brown seed, barely covered.'],
	['Germination', 7, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 12, 'Two narrow seed leaves.'],
	['True leaves', 25, 'The first true leaves, already arrow-shaped and sharp with oxalic acid.'],
	['Rosette', 45, 'A rosette of long-stalked arrow-shaped leaves, the stalks red at the base.'],
	['Clump', 70, 'A dense clump a hand and a half high; a reddish taproot below. It comes back every spring.'],
	['First picking', 380, 'Its second spring, the first green of the year: the young leaves picked for soup and sauce, lemony and sour.'],
	['Cut and come again', 410, 'Picked from the outside, new leaves keep coming from the middle.'],
	['Flowering', 430, 'Slender stems rise knee-high with whorls of tiny reddish flowers up their branches.'],
	['Seeding', 460, 'The spikes turn rust-red with winged seeds; cut them off and the leaves come again.']
]);

/** a sorrel blade's reach at the angle a: arrow-shaped, its two basal lobes pointing back beside the stalk */
const arrowEdge = (/** @type {number} */ a) => table(Math.abs(a), [[0, 1], [0.25, 0.72], [0.6, 0.4], [1.2, 0.27], [1.6, 0.25], [2.2, 0.24], [2.6, 0.32], [2.85, 0.2], [Math.PI, 0.03]]);

/**
 * Sorrel at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function sorrel(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.1);
	const at = v3(0, -0.005, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0013, 0.0009, 0.0009), coat: '#6a3a24', coatShade: '#3a2014',
		stem: table(g, [[0, 0], [0.3, 0.0006], [1, 0.008], [2, 0.014], [9, 0.014]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0006 + 0.0012 * span(g, 1, 4), stemColor: '#8a5a4a',
		leaf: { length: 0.009, width: 0.0025, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6), color: '#5a9a3c', vein: '#9cc46e' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 3.5, 4.5)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.35, grown: table(g, [[0, 0], [0.3, 0.02], [1, 0.1], [3, 0.4], [5, 0.85], [7, 1]]), radius: 0.0015 + 0.005 * span(g, 3, 8), down: 0.04, wander: 0.18, laterals: 7, lateral: 0.35, depth: 1, age: span(g, 3, 8), young: '#f0e0d0', old: '#8a4a30' });
	const crown = v3(0, Math.min(s.top.y, 0.008), 0);
	// the leaves from the crown, the older outside, picked from the outside from the first picking on
	for (let i = 0; i < 26; i++) {
		const born = 2.3 + i * 0.24;
		if (g <= born) break;
		if (i % 3 !== 2 && i < 14 && g > 6.1 + i * 0.12) continue;
		const lr = chance(seed, 'sorrel-leaf', i);
		const grown = clamp((g - born) / 1.1);
		const out = level(i * 2.39996 + about(lr, 0, 0.15));
		const L = (0.03 + 0.1 * clamp(i / 8)) * vigour * about(lr, 1, 0.1) * lerp(0.3, 1, grown);
		const tilt = lerp(0.1, between(lr, 0.45, 0.85), grown);
		const pts = arch(crown.clone().addScaledVector(out, 0.003), tilted(out, tilt), L * 0.95, 0.1 * grown, 4);
		bag.add('body', tube(pts, (u) => 0.0018 * lerp(0.4, 1, grown) * (1 - 0.4 * u), (u) => mix('#a8443a', '#6a9a46', clamp(u * 2)), 4));
		const fold = (1 - grown) * 0.8;
		bag.add(
			'sheet',
			fan({
				size: L,
				from: -Math.PI,
				to: Math.PI,
				edge: (a) => arrowEdge(a) * (1 - 0.4 * fold * Math.abs(Math.sin(a))),
				lift: (ss, a) => fold * Math.abs(Math.sin(a)) * ss * 0.6 + 0.04 * Math.abs(Math.sin(a)) * ss - 0.05 * ss * ss * Math.max(0, Math.cos(a)),
				paint: (ss, a) => leafColour('#3a7a2c', '#7ab04a', grown, 0, ss).lerp(tint('#a8c88a'), Math.abs(a) < 0.04 || Math.abs(Math.abs(a) - 2.55) < 0.04 ? 0.45 : 0),
				rings: 5,
				rays: 18
			}),
			face(pts[pts.length - 1], tilted(out, tilt + lerp(0.1, 0.55, grown)), UP)
		);
	}
	// the flowering stems in its second summer: whorls of tiny flowers up their branches
	const stems = 3 + Math.floor(chance(seed, 'sorrel-stems')() * 3);
	for (let k = 0; k < stems; k++) {
		const fr = chance(seed, 'sorrel-stem', k);
		const born = 7.0 + k * 0.12 + fr() * 0.15;
		if (g <= born) break;
		const rise = span(g, born, born + 0.8);
		const H = (0.6 + 0.3 * fr()) * vigour * rise;
		const a = k * 2.39996 + fr();
		const stem = arch(crown.clone().addScaledVector(level(a), 0.01), tilted(level(a), between(fr, 0.05, 0.22)), H, -0.05, 8);
		bag.add('body', tube(stem, (u) => 0.0028 * (1 - 0.6 * u), (u) => mix('#7a8a3a', '#a8483a', u), 4));
		// a clasping leaf or two low on the stem
		for (let j = 0; j < 2; j++) {
			const p = point(stem, 0.15 + j * 0.18);
			const o = level(a + 2.4 * (j + 1));
			bag.add('sheet', fan({ size: 0.05 * rise * (1 - j * 0.3), from: -Math.PI, to: Math.PI, edge: arrowEdge, lift: (ss) => -0.05 * ss * ss, paint: (ss) => leafColour('#3a7a2c', '#7ab04a', 1, 0, ss), rings: 3, rays: 12 }), face(p, tilted(o, 1.0), UP));
		}
		const bloom = span(g, 7.6, 8.1), seeding = span(g, 8.5, 9.2);
		const flower = seeding > 0 ? mix('#b04a34', '#8a3420', seeding) : mix('#8aa04a', '#b85a44', bloom);
		for (let b = 0; b < 5; b++) {
			const t = 0.55 + b * 0.09;
			const from = point(stem, t);
			const len = (0.16 - b * 0.02) * rise;
			const twig = b === 4 ? stem.slice(-3) : arch(from, level(a + b * 2.4).multiplyScalar(0.4).add(v3(0, 1, 0)), len, -0.05, 3);
			if (b < 4) bag.add('body', tube(twig, () => 0.0012, () => tint('#8a7a3a'), 3));
			for (let w = 0; w < 7; w++) {
				const p = point(twig, 0.25 + w * 0.11);
				for (let m = 0; m < 3; m++) bag.add('body', bead(p.clone().add(level(m * 2.1 + w).multiplyScalar(0.003)), v3(0.0018, 0.0022, 0.0018).multiplyScalar(lerp(0.5, 1, rise)), flower, 2));
			}
		}
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ stinging nettle */

export const NETTLE_STAGES = stages([
	['Seed', 0, 'A tiny flat oval seed, one of the thousands a female plant shed last autumn, on bare rich soil.'],
	['Germination', 8, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 14, 'Two small round seed leaves.'],
	['True leaves', 25, 'The first pair of toothed leaves, already bristling with stinging hairs.'],
	['Young plant', 50, 'A square stem with heart-shaped, toothed leaves in pairs, each pair turned a quarter from the last.'],
	['Spreading', 110, 'Yellow rhizomes creep out under the soil and send up new stems: a patch.'],
	['Picking tops', 380, 'Its second spring: the top four leaves of every stem picked, with gloves, for soup, tea and pesto; the patch grows back thicker.'],
	['Flowering', 430, 'Stems a metre high and more; green tassels of tiny flowers hang in pairs from the upper leaf axils, male and female on separate plants.'],
	['Seeding', 470, 'The female tassels heavy and drooping with seed; the caterpillars of peacock and small tortoiseshell butterflies on the leaves.'],
	['Seed harvest', 500, 'Seed for picking, the tassels brown-green; cut down, the stems are the best compost activator and a liquid feed.']
]);

/** a nettle leaf: heart-shaped at the base, drawn out to a point, coarsely toothed */
const nettleLeaf = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.65) * (1 + (u > 0.08 && u < 0.92 ? ((u * 13) % 1) * 0.22 : 0));

/**
 * The stinging nettle at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function nettle(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const female = chance(seed, 'nettle-sex')() < 0.5;
	const at = v3(0, -0.003, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0011, 0.0005, 0.0008), coat: '#8a7a5a', coatShade: '#5a4a34',
		stem: table(g, [[0, 0], [0.3, 0.0005], [1, 0.006], [2, 0.012], [9, 0.012]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0005 + 0.001 * span(g, 1, 4), stemColor: '#6a8a3a',
		leaf: { length: 0.005, width: 0.0028, shape: (u) => Math.pow(Math.sin(Math.PI * u), 0.5), color: '#5a9a3c', vein: '#9cc46e' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 3.2, 4)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.22, grown: table(g, [[0, 0], [0.3, 0.03], [1, 0.12], [3, 0.5], [5, 1]]), radius: 0.0012 + 0.002 * span(g, 3, 6), down: 0.05, wander: 0.25, laterals: 6, lateral: 0.4, depth: 1, age: span(g, 3, 7), young: '#f4ead6', old: '#c8a050' });
	const flowering = span(g, 6.6, 7.2);
	nettleStem(bag, seed, [0], s.top.clone(), table(g, [[2, 0], [3, 0.02], [4, 0.25], [5, 0.7], [6, 0.95], [7, 1.2], [9, 1.3]]) * vigour, g, flowering, female);
	// the rhizomes: yellow, creeping a hand down, a new stem every so far along
	for (let k = 0; k < 4; k++) {
		const kr = chance(seed, 'nettle-rhizome', k);
		const born = 4.1 + k * 0.25 + kr() * 0.2;
		if (g <= born) break;
		const run = Math.min(0.5, (g - born) * 0.22) * vigour;
		let a = k * (Math.PI / 2) + kr() * 0.8;
		const pts = [v3(0, -0.02, 0)];
		const n = 10;
		for (let m = 1; m <= n; m++) {
			a += (kr() - 0.5) * 0.4;
			pts.push(pts[m - 1].clone().add(v3(Math.cos(a) * (run / n), (kr() - 0.5) * 0.004 - (m < 3 ? 0.005 : 0), Math.sin(a) * (run / n))));
		}
		bag.add('body', tube(pts, (u) => 0.003 * (1 - 0.3 * u), (u) => mix('#c8a03a', '#e8c860', u), 4));
		// a stem from every node passed, the oldest nearest
		for (let j = 0; j < 3; j++) {
			const d = 0.12 + j * 0.14;
			if (run < d) break;
			const sr = chance(seed, 'nettle-shoot', k, j);
			const sborn = born + d / 0.22 + 0.1;
			const base = point(pts, d / run).setY(0);
			root(bag, { seed, key: ['node', k, j], from: base.clone().setY(-0.03), dir: v3(0, -1, 0), length: 0.14, grown: span(g, sborn - 0.2, sborn + 1), radius: 0.0012, laterals: 3, depth: 1, young: '#f4ead6', old: '#c8a050' });
			nettleStem(bag, seed, [k + 1, j], base, 1.15 * between(sr, 0.75, 1.05) * vigour * span(g, sborn, sborn + 2.2), g, flowering * (span(g, sborn + 1.4, sborn + 1.8)), female);
		}
	}
	return bag.build();
}

/**
 * A nettle stem: square, its leaves in pairs a quarter-turn apart, the tassels hanging from the upper axils.
 * @param {Bag} bag @param {string} seed @param {number[]} key @param {THREE.Vector3} base @param {number} H
 * @param {number} g @param {number} flowering @param {boolean} female
 */
function nettleStem(bag, seed, key, base, H, g, flowering, female) {
	if (H < 0.004) return;
	const r = chance(seed, 'nettle-stem', ...key);
	const lean = v3(r() - 0.5, 0, r() - 0.5).multiplyScalar(0.18);
	const pts = [];
	for (let m = 0; m <= 8; m++) {
		const h = (m / 8) * H;
		pts.push(base.clone().add(v3(lean.x * h * (0.5 + h), h, lean.z * h * (0.5 + h))));
	}
	const R = 0.0012 + 0.0035 * clamp(H / 1.2);
	bag.add('body', tube(pts, (u) => R * (1 - 0.5 * u), (u) => mix('#6a5a3a', '#6a8a3a', clamp(u * 3)), 4));
	const nodes = Math.max(1, Math.floor(H / 0.075));
	const turn0 = r() * Math.PI;
	const seeding = span(g, 7.8, 8.8), brown = span(g, 8.6, 9.6);
	for (let n = 0; n < nodes; n++) {
		const u = (n + 0.6) / nodes;
		const p = point(pts, u);
		const t = towards(pts, u);
		const turn = turn0 + n * (Math.PI / 2) + r() * 0.15;
		// the young pairs at the tip small and upright, the grown ones below spreading and a little drooping
		const age = clamp(((1 - u) * H) / 0.18);
		const size = lerp(0.3, 1, age) * (u < 0.15 && H > 0.6 ? 0.75 : 1);
		for (const side of [-1, 1]) {
			const out = level(turn + (side < 0 ? Math.PI : 0));
			const tilt = lerp(0.3, 1.45, age) + 0.15 * age * age;
			const len = 0.125 * size * Math.min(1, 0.35 + H);
			const stalk = p.clone().addScaledVector(tilted(out, tilt), len * 0.25);
			bag.add('body', tube([p, stalk], () => 0.0009, () => tint('#6a8a3a'), 3));
			bag.add(
				'sheet',
				sheet({
					length: len,
					width: len * 0.34,
					shape: nettleLeaf,
					lift: (uu, v) => 0.08 * v * v - 0.12 * uu * uu * age + 0.01 * Math.sin(uu * 30) * Math.abs(v),
					paint: (uu, v) => leafColour('#2f5a26', '#5f8a3a', age, 0, uu).lerp(tint('#7a9a5a'), Math.abs(v) < 0.08 ? 0.4 : Math.abs(Math.sin(uu * 11 - Math.abs(v) * 3)) > 0.94 ? 0.2 : 0),
					along: 7,
					across: 2
				}),
				aim(stalk, tilted(out, tilt + 0.15).lerp(t, 0.1).normalize(), 0)
			);
			// the tassels: a pair from each upper axil, hanging (the female's heavier with seed)
			if (flowering <= 0 || u < 0.3 || u > 0.92) continue;
			for (const s of [-0.5, 0.5]) {
				const d = level(turn + (side < 0 ? Math.PI : 0) + s).multiplyScalar(female ? 0.5 : 0.9).add(v3(0, female ? -0.5 - seeding * 0.5 : -0.15, 0)).normalize();
				const L = (female ? 0.07 : 0.055) * flowering * lerp(0.6, 1, age);
				const tp = arch(p.clone().addScaledVector(out, 0.004), d, L, female ? 0.4 : 0.6, 4);
				bag.add('body', tube(tp, (uu) => 0.0024 * (1 + 0.6 * Math.abs(Math.sin(uu * 26))) * (1 - 0.3 * uu), () => mix(female ? '#7a9a50' : '#b0b878', '#8a7a4a', brown), 3));
			}
		}
	}
}

/* ------------------------------------------------------------------------------------------------ globe artichoke */

export const ARTICHOKE_STAGES = stages([
	['Offset', 0, 'A rooted offset sliced from the side of an old plant with a heel of root, planted in spring.'],
	['Rooting', 14, 'New white roots below; from its heart a first new leaf.'],
	['New leaves', 40, 'Grey-green leaves, deeply cut, rising in a fountain.'],
	['Fountain', 100, 'A fountain of silver leaves near a metre long, arching over; mulched against the winter.'],
	['Big clump', 380, 'Its second spring: a clump of silver leaves a metre and a half across.'],
	['Stems', 410, 'Thick, ribbed grey stems rise from the heart, a bud at every tip.'],
	['Buds', 425, 'The king bud at the top of each stem, smaller ones on the side shoots, scale over scale.'],
	['Harvest', 440, 'Cut while tight and fist-sized, the scales still closed: their fleshy bases and the heart are eaten. A few are left.'],
	['Opening', 460, 'A bud left on loosens its scales; a violet tuft shows at the top.'],
	['Thistle', 475, 'A violet thistle a hand across, loud with bumblebees; cut the stems down after and new shoots come from the base.']
]);

/** an artichoke leaf: long, cut almost to the midrib into lobes */
const cutLeaf = (/** @type {number} */ u) => {
	const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.7);
	const lobes = 0.14 + 0.86 * Math.pow(Math.abs(Math.sin(u * Math.PI * 6.5 + 0.4)), 0.7) * (1 - 0.15 * Math.abs(Math.sin(u * 60)));
	return env * lerp(0.3, lobes, clamp((u - 0.06) / 0.1));
};

/**
 * The globe artichoke at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function artichoke(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const crown = v3(0, 0.01, 0);
	// the heel of old root, and the new roots from it
	bag.add('body', bead(v3(0, -0.04, 0), v3(0.03, 0.05, 0.03).multiplyScalar(lerp(0.8, 1.6, span(g, 0, 5))), '#7a6a4a', 5));
	for (let i = 0; i < 6; i++) {
		const rr = chance(seed, 'artichoke-root', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['r', i], from: v3(Math.cos(a) * 0.02, -0.07, Math.sin(a) * 0.02), dir: v3(Math.cos(a) * 0.4, -1, Math.sin(a) * 0.4), length: between(rr, 0.4, 0.7) * vigour, grown: table(g, [[0, 0.1], [1, 0.25], [3, 0.6], [5, 1]]), radius: 0.004 + 0.006 * span(g, 1, 6), down: 0.04, wander: 0.2, laterals: 4, lateral: 0.35, depth: 1, age: span(g, 1, 6), young: '#f2e8d4', old: '#a8865a' });
	}
	const space = bag.space;
	/** @type {(() => void)[]} */
	const later = [];
	// the flower stems, from its second spring
	const stems = 3 + Math.floor(chance(seed, 'artichoke-stems')() * 2);
	for (let k = 0; k < stems; k++) {
		const fr = chance(seed, 'artichoke-stem', k);
		const born = 4.6 + k * 0.15;
		if (g <= born) break;
		const rise = span(g, born, born + 1.2);
		const H = (1.0 + 0.35 * fr()) * vigour * rise;
		const a = k * 2.39996 + fr();
		const stem = arch(crown.clone().addScaledVector(level(a), 0.03), tilted(level(a), between(fr, 0.06, 0.2)), H, -0.08, 8);
		const R = 0.011 * lerp(0.5, 1, rise);
		bag.add('body', tube(stem, (u, v) => R * (1 - 0.35 * u) * (1 + 0.08 * Math.cos(v * Math.PI * 16)), (u, v) => mix('#8a9c86', '#b8c4b0', Math.cos(v * Math.PI * 16) > 0.6 ? 0.5 : 0), 10));
		space.rod(stem, R);
		// small cut leaves up the lower stem
		for (let j = 0; j < 3; j++) {
			const p = point(stem, 0.15 + j * 0.16);
			const o = level(a + 2.2 * (j + 1));
			later.push(() => {
				const out = space.steer(p, o, 0.6, 0.25, 0.03);
				bag.add('sheet', sheet({ length: 0.3 * rise * (1 - j * 0.22), width: 0.05 * rise * (1 - j * 0.22), shape: cutLeaf, lift: (u, v) => 0.06 * v * v - 0.2 * u * u, paint: (u, v) => leafColour('#8a9c88', '#9aaa94', 1, 0, u).lerp(tint('#dce0d4'), Math.abs(v) < 0.08 ? 0.5 : 0), along: 18, across: 3 }), aim(p, tilted(out, 0.9), 0));
			});
		}
		// the king bud at the top, a smaller bud on each side shoot; most of the side buds and some kings cut
		/** @type {{ at: THREE.Vector3, axis: THREE.Vector3, R: number, cut: number, key: number }[]} */
		const buds = [{ at: stem[8], axis: towards(stem, 1), R: 0.045, cut: k % 2 ? 7.35 + k * 0.05 : Infinity, key: 0 }];
		for (let b = 0; b < 2; b++) {
			const from = point(stem, 0.55 + b * 0.15);
			const len = (0.22 + 0.08 * fr()) * span(g, born + 0.4, born + 1.4);
			if (len < 0.01) continue;
			const twig = arch(from, tilted(level(a + (b ? 2.2 : -2.2)), 0.55), len, -0.25, 4);
			bag.add('body', tube(twig, (u) => R * 0.6 * (1 - 0.3 * u), () => tint('#94a690'), 6));
			space.rod(twig, R * 0.6);
			buds.push({ at: twig[4], axis: towards(twig, 1), R: 0.028, cut: fr() < 0.75 ? 7.3 + b * 0.15 + k * 0.05 : Infinity, key: b + 1 });
		}
		for (const bud of buds) {
			if (g > bud.cut) {
				// the cut end of the stalk
				bag.add('body', bead(bud.at, v3(0.008, 0.004, 0.008), '#c8d0b0', 3));
				continue;
			}
			const grow = span(g, born + 0.5, 7);
			const size = bud.R * vigour * lerp(0.25, 1, grow);
			space.ball(bud.at.clone().addScaledVector(bud.axis, size), size * 1.1);
			head(bag, seed, [k, bud.key], bud.at, bud.axis, size, span(g, 7.8, 8.6) * (bud.key ? 0.8 : 1), span(g, 8.2, 9));
		}
	}
	// the leaves: a fountain from the heart, each living a year or so, the oldest withering outside
	for (let i = 0; i < 30; i++) {
		const born = 0.9 + i * 0.2;
		if (g <= born) break;
		const wither = span(g, born + 3.3, born + 3.9);
		if (wither >= 1) continue;
		const lr = chance(seed, 'artichoke-leaf', i);
		const grown = clamp((g - born) / 1.2);
		const S = (0.45 + 0.55 * clamp(i / 12)) * vigour * about(lr, 1, 0.08);
		const L = (0.25 + 0.7 * S) * lerp(0.25, 1, grown);
		const bear = i * 2.39996 + about(lr, 0, 0.15);
		const tilt = lerp(0.12, between(lr, 0.45, 0.75), grown) + wither * 0.6;
		const at = crown.clone().addScaledVector(level(bear), 0.02);
		later.push(() => {
			const out = g > 4.6 ? space.steer(at.clone().add(v3(0, L * 0.3, 0)), level(bear), Math.PI / 2 - tilt, L * 0.6, 0.04) : level(bear);
			const dir = tilted(out, tilt);
			const stalk = at.clone().addScaledVector(dir, L * 0.1);
			bag.add('body', tube([at, stalk], () => 0.006 * lerp(0.5, 1, grown), () => tint('#b8c0ac'), 5));
			bag.add(
				'sheet',
				sheet({
					length: L,
					width: L * 0.17,
					shape: cutLeaf,
					// arching over into a fountain, the lobes twisted, the blade a little channelled along its midrib
					lift: (u, v) => 0.07 * v * v - (0.32 + wither * 0.4) * u * u * lerp(0.4, 1, grown) + 0.02 * Math.sin(u * 40) * v,
					paint: (u, v) => leafColour('#879a86', '#9aac90', grown, wither, u).lerp(tint('#e2e6dc'), Math.abs(v) < 0.07 ? 0.55 : Math.abs(v) > 0.7 ? 0.12 : 0),
					along: 34,
					across: 4
				}),
				aim(stalk, dir, (lr() - 0.5) * 0.3)
			);
		});
	}
	for (const f of later) f();
	return bag.build();
}

/**
 * An artichoke head at the top of its stalk at `at`: a globe of fleshy scales, tight while it is eaten, loosening and
 * spreading as it opens, then a tuft of violet florets out of its top.
 * @param {Bag} bag @param {string} seed @param {number[]} key @param {THREE.Vector3} at @param {THREE.Vector3} axis
 * @param {number} R @param {number} open @param {number} flower
 */
function head(bag, seed, key, at, axis, R, open, flower) {
	const hr = chance(seed, 'artichoke-head', ...key);
	const turn = upTo(axis);
	const c = at.clone().addScaledVector(axis, R * 0.95);
	bag.add('body', bead(c, v3(R * 0.82, R * 0.95, R * 0.82), '#6a8456', 6, turn));
	const n = 34;
	for (let k = 0; k < n; k++) {
		const t = k / n;
		const phi = lerp(0.35, 2.5, t), th = k * 2.39996 + hr() * 0.1;
		const nrm = v3(Math.sin(phi) * Math.cos(th), -Math.cos(phi), Math.sin(phi) * Math.sin(th)).applyQuaternion(turn);
		const up = v3(Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th)).applyQuaternion(turn);
		const p = c.clone().add(v3(Math.sin(phi) * Math.cos(th) * R * 0.78, -Math.cos(phi) * R * 0.9, Math.sin(phi) * Math.sin(th) * R * 0.78).applyQuaternion(turn));
		const spread = 0.12 + open * (0.5 + 0.6 * (1 - t));
		const dir = up.clone().lerp(nrm, clamp(spread)).normalize();
		const len = R * (0.62 - 0.2 * t);
		bag.add(
			'sheet',
			sheet({
				length: len,
				width: R * 0.3,
				shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.5)), 0.55) * (u > 0.85 ? 0.75 : 1),
				lift: (u, v) => -0.15 * v * v + 0.05 * u,
				paint: (u) => mix(mix('#7a9a66', '#5f7a4e', t), '#6a4a72', clamp(u - 0.45) * (1.2 + open)).lerp(tint('#c8d0a8'), (1 - u) * 0.25),
				along: 3,
				across: 2
			}),
			face(p, dir, nrm)
		);
	}
	if (flower <= 0) return;
	// the florets: a dense tuft of violet threads out of the top, spreading as it opens
	const disc = c.clone().addScaledVector(axis, R * 0.65);
	const m = 80;
	for (let j = 0; j < m; j++) {
		const rr = Math.sqrt(j / m), a = j * 2.39996;
		const local = v3(Math.cos(a) * rr * R * 0.72, 0, Math.sin(a) * rr * R * 0.72).applyQuaternion(turn);
		const from = disc.clone().add(local);
		const d = axis.clone().addScaledVector(local.clone().normalize(), rr * 0.9).normalize();
		bag.add('body', tube([from, from.clone().addScaledVector(d, R * 0.85 * flower)], (u) => 0.0014 * (1 - 0.4 * u), (u) => mix('#6a3aa8', '#a070e0', u), 3));
	}
}

/* ------------------------------------------------------------------------------------------------ asparagus */

export const ASPARAGUS_STAGES = stages([
	['Crown', 0, 'A one-year crown like a big pale spider, its fleshy roots spread over a ridge in a trench, twenty centimetres down, in spring.'],
	['First spears', 20, 'Thin spears push up through the soil; none are cut for two years, so the crown can build.'],
	['First fern', 60, 'The spears open into airy fern half a metre high: not leaves but needle-fine little stems.'],
	['Golden fern', 200, 'In the autumn the fern turns gold, feeding the crown below; then it is cut down.'],
	['Second spring', 380, 'More spears and thicker, still left to grow.'],
	['Second summer', 430, 'Fern a metre high, a little thicket of feathers.'],
	['Spears', 730, 'Its third spring: fat spears, cut a little under the soil when twenty centimetres tall, every day or two.'],
	['Cutting', 760, 'Six weeks of cutting; then the spears are left to grow, to feed the crown for next year.'],
	['Fern and flowers', 810, 'Fern a metre and a half high; tiny green-white bells hang along it.'],
	['Berries', 860, 'On the female plants, red berries among the feathers; the fern goes gold in the autumn.']
]);

/**
 * Asparagus at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function asparagus(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const female = chance(seed, 'asparagus-sex')() < 0.5;
	const crown = v3(0, -0.17, 0);
	const build = span(g, 0, 7);
	bag.add('body', bead(crown, v3(0.025, 0.018, 0.025).multiplyScalar(lerp(1, 2, build)), '#b89a70', 5));
	// the fleshy storage roots, spreading out like a spider's legs
	for (let i = 0; i < 12; i++) {
		const rr = chance(seed, 'asparagus-root', i);
		const a = (i / 12) * Math.PI * 2 + rr() * 0.3;
		root(bag, { seed, key: ['r', i], from: crown.clone().addScaledVector(level(a), 0.02), dir: v3(Math.cos(a), -0.25, Math.sin(a)), length: between(rr, 0.3, 0.45) * lerp(0.7, 1.4, build) * vigour, grown: 1, radius: 0.0045, down: 0.02, wander: 0.12, laterals: 2, lateral: 0.3, depth: 1, age: build, young: '#f0e6cc', old: '#a8865a' });
	}
	/** @type {{ key: number, born: number, H: number, r: number, cut: number, gone: number, gold: number, year: number }[]} */
	const shoots = [];
	for (let k = 0; k < 3; k++) shoots.push({ key: k, born: 0.6 + k * 0.25, H: 0.5, r: 0.0028, cut: Infinity, gone: 3.45, gold: span(g, 2.5, 3.0), year: 1 });
	for (let k = 0; k < 5; k++) shoots.push({ key: 10 + k, born: 3.55 + k * 0.18, H: 1.0, r: 0.005, cut: Infinity, gone: 5.62, gold: span(g, 5.3, 5.6), year: 2 });
	for (let k = 0; k < 13; k++) {
		const harvest = k < 7;
		shoots.push({ key: 20 + k, born: harvest ? 5.6 + k * 0.16 : 6.75 + (k - 7) * 0.12, H: 1.5, r: 0.008, cut: harvest ? 5.6 + k * 0.16 + 0.5 : Infinity, gone: Infinity, gold: span(g, 9.2, 9.8), year: 3 });
	}
	for (const sh of shoots) {
		if (g <= sh.born || g > sh.gone) continue;
		const sr = chance(seed, 'asparagus-shoot', sh.key);
		const a = sh.key * 2.39996;
		const base = crown.clone().add(v3(Math.cos(a) * 0.03 * lerp(0.5, 1.5, build), 0.01, Math.sin(a) * 0.03 * lerp(0.5, 1.5, build)));
		const r = sh.r * vigour * about(sr, 1, 0.12);
		if (g > sh.cut) {
			// cut a few centimetres under the soil: the stub, pale
			bag.add('body', tube([base, base.clone().add(v3(0, -base.y - 0.03, 0))], () => r * 0.8, () => tint('#c8b48a'), 5));
			continue;
		}
		// a spear grows to a hand and more, then (if not cut) shoots up and opens into fern
		const spear = 0.25 * span(g, sh.born, sh.born + 0.45);
		const fern = sh.cut < Infinity ? 0 : span(g, sh.born + 0.4, sh.born + 1.4);
		const h = Math.max(spear - base.y, (sh.H - base.y) * fern) * vigour;
		const lean = v3(sr() - 0.5, 0, sr() - 0.5).multiplyScalar(0.12);
		/** @type {THREE.Vector3[]} */
		const stem = [];
		for (let m = 0; m <= 8; m++) {
			const t = (m / 8) * h;
			stem.push(base.clone().add(v3(lean.x * t * t, t, lean.z * t * t)));
		}
		const gold = sh.gold;
		bag.add('body', tube(stem, (u) => r * (1 - 0.6 * u * fern) * (u > 0.96 && fern < 0.1 ? 0.6 : 1), (u) => (stem[0].y + u * h < 0 ? tint('#ece4c8') : mix(mix('#6a9a3a', '#7a6a8a', clamp((u - 0.85) * 6) * (1 - fern)), '#c8a848', gold)), 6));
		bag.space.rod(stem, r);
		if (fern < 0.05) {
			// the spear's tip: tight scales, purple-tinged
			bag.add('body', bead(stem[8], v3(r * 1.05, r * 2, r * 1.05), '#6a6a4a', 4));
			for (let q = 0; q < 6; q++) {
				const p = point(stem, 1 - 0.04 - q * 0.05 * (0.2 / Math.max(0.2, h)));
				if (p.y < 0) continue;
				bag.add('body', bead(p.addScaledVector(level(q * 2.39996), r * 0.9), v3(r * 0.4, r * 0.9, r * 0.4), '#7a6a6a', 2));
			}
			continue;
		}
		fernBranches(bag, seed, sh.key, stem, h, fern, gold, sh.year === 3 ? span(g, 7.6, 8.1) : 0, sh.year === 3 && female ? span(g, 8.5, 9.1) : 0, female);
	}
	return bag.build();
}

/**
 * The fern on an asparagus stem: side branches up its upper part, each with its branchlets, each branchlet with its
 * tufts of needle-fine cladodes; the tiny bells hanging at the branchlets' feet, then (on a female plant) the berries.
 * @param {Bag} bag @param {string} seed @param {number} key @param {THREE.Vector3[]} stem @param {number} h
 * @param {number} open @param {number} gold @param {number} bells @param {number} berries @param {boolean} female
 */
function fernBranches(bag, seed, key, stem, h, open, gold, bells, berries, female) {
	const fr = chance(seed, 'asparagus-fern', key);
	const needle = mix('#4f8a3a', '#d8b84a', gold);
	const wood = mix('#5a8a3a', '#c8a848', gold);
	const needles = new Slivers();
	// fewer needles when planted by the hundred, each a little wider
	const tuft = Math.max(2, Math.round(5 * Math.min(1, DETAIL.level)));
	const wide = 5 / tuft;
	const branches = 20;
	for (let b = 0; b < branches; b++) {
		const t = 0.28 + 0.68 * (b / branches);
		const from = point(stem, t);
		if (from.y < 0.04) continue;
		const len = h * 0.3 * (1 - 0.65 * ((t - 0.3) / 0.66)) * span(open, b / branches * 0.5, b / branches * 0.5 + 0.5);
		if (len < 0.01) continue;
		const out = level(b * 2.39996 + fr() * 0.4);
		const twig = arch(from, tilted(out, 0.9 + 0.3 * (1 - t)), len, 0.15, 3);
		bag.add('body', tube(twig, () => 0.0012, () => wood, 3));
		for (let l = 0; l < 4; l++) {
			const u = 0.25 + l * 0.22;
			const p = point(twig, u);
			const across = level(b * 2.39996 + (l % 2 ? 1.2 : -1.2));
			const d = across.clone().add(towards(twig, u)).add(v3(0, 0.3, 0)).normalize();
			const ll = len * 0.35 * (1 - l * 0.15) + 0.02;
			const end = p.clone().addScaledVector(d, ll);
			bag.add('body', tube([p, end], () => 0.0007, () => wood, 3));
			// the needles, in little tufts along the branchlet, pointing out and up, never down
			for (let q = 0; q < 4; q++) {
				const np = p.clone().lerp(end, 0.3 + q * 0.23);
				for (let w = 0; w < tuft; w++) {
					const nd = v3(fr() - 0.5, between(fr, 0.05, 0.7), fr() - 0.5).normalize();
					needles.add(np, nd, 0.022, 0.0011 * wide, needle, 0, true);
				}
			}
			// a bell, then a berry, hanging under the branchlet's foot
			if (bells > 0 && fr() < 0.5) {
				const hang = p.clone().add(v3(0, -0.012, 0));
				bag.add('body', tube([p, hang], () => 0.0004, () => tint('#8aa860'), 3));
				if (berries > 0 && female) {
					const R = 0.0035 * lerp(0.5, 1, berries);
					bag.add('gloss', bead(hang.clone().add(v3(0, -R, 0)), v3(R, R, R), mix('#5a8a3a', '#c81e1e', berries), 4));
				} else if (berries <= 0) bag.add('body', bead(hang.clone().add(v3(0, -0.002, 0)), v3(0.0016, 0.0028, 0.0016).multiplyScalar(bells), '#dcdca0', 2));
			}
		}
	}
	needles.into(bag);
}

/* ------------------------------------------------------------------------------------------------ nasturtium */

export const NASTURTIUM_STAGES = stages([
	['Seed', 0, 'A big, wrinkled, ribbed seed like a dried chickpea, two centimetres down after the last frost.'],
	['Germination', 8, 'The root goes down and the shoot comes up alone: the seed leaves stay below, in the seed.'],
	['First leaves', 14, 'Round shield leaves on long stalks, the stalk joined at the middle; water beads and rolls off them.'],
	['Leafy', 25, 'A little mound of round, pale-veined leaves.'],
	['Trailing', 40, 'Stems sprawl out over the soil, a round leaf at every node.'],
	['Spreading', 55, 'A mat of shield leaves a metre and more across, covering the soil under the fruit trees.'],
	['Buds', 60, 'Spurred buds on long stalks from the leaf axils.'],
	['Flowering', 70, 'Orange, red or yellow flowers, each with its long nectar spur; leaves and flowers both peppery, eaten in salad.'],
	['Seeds set', 90, 'Behind each faded flower, three green wrinkled seeds joined in a triangle — pickled as poor man’s capers.'],
	['Ripe seeds', 110, 'The seeds turn pale and drop, to come up again next year; it flowers on until the first frost blackens it.']
]);

/** the flower colours: orange, scarlet, yellow, mahogany — one a plant, by its seed */
const NASTURTIUM = [['#f07a1a', '#f8b030'], ['#d42a1a', '#f05a2a'], ['#f2c21e', '#f8e070'], ['#9a2418', '#c84a2a']];

/**
 * Nasturtium at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function nasturtium(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const pick = chance(seed, 'nasturtium-colour')();
	const colours = NASTURTIUM[pick < 0.4 ? 0 : pick < 0.65 ? 1 : pick < 0.88 ? 2 : 3];
	const SEED = v3(0, -0.02, 0);
	// it comes up hypogeal, like the bean: the seed stays down, the shoot rises from it
	const s = sprout(bag, {
		seed, at: SEED, size: v3(0.0045, 0.004, 0.004), coat: '#8a8a5a', coatShade: '#5a5a3a',
		stem: table(g, [[0, 0], [0.4, 0.002], [1, 0.03], [1.6, 0.04], [9, 0.04]]), hook: table(g, [[0, 1], [1.1, 1], [1.6, 0]]),
		radius: 0.0012 + 0.0018 * span(g, 1.5, 5), stemColor: '#8aa860',
		leaf: { length: 0.001, width: 0.0005, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
		open: 0, shed: span(g, 4, 5.5), wither: 1, keepCoat: true
	});
	root(bag, { seed, key: ['tap'], from: SEED.clone(), dir: v3(0, -1, 0), length: 0.25, grown: table(g, [[0, 0], [0.4, 0.04], [1, 0.15], [3, 0.5], [5, 1]]), radius: 0.0016, down: 0.04, wander: 0.25, laterals: 8, lateral: 0.4, depth: 1, age: span(g, 3, 7), young: '#f4ead6', old: '#c8a878' });
	const space = bag.space;
	/** @type {(() => void)[]} */
	const leaves = [];
	// the first leaves, from the top of the shoot
	const top = s.top.clone();
	for (let i = 0; i < 3; i++) {
		const born = 1.5 + i * 0.4;
		if (g <= born) break;
		leaves.push(() => shield(bag, seed, ['first', i], top, i * 2.39996, clamp((g - born) / 0.8), 0.06 + 0.02 * i, 0.03, g));
	}
	// the trailing stems, branching
	for (let k = 0; k < 5; k++) {
		const kr = chance(seed, 'nasturtium-stem', k);
		const born = 2.6 + k * 0.45;
		if (g <= born) break;
		const run = table(g - born, [[0, 0], [0.6, 0.08], [1.5, 0.3], [2.5, 0.55], [3.5, 0.75], [4.5, 0.9], [7, 1.0]]) * vigour * between(kr, 0.75, 1.05) * (k ? 0.85 : 1);
		trail(bag, seed, [k], top, k * 2.39996 + kr() * 0.4, run, g, born, vigour, colours, leaves, 0);
	}
	for (const f of leaves) f();
	return bag.build();
}

/**
 * A nasturtium stem trailing over the soil from `from`, wandering, its tip lifting off it: at every node a leaf on its
 * stalk, from the older nodes a flower and then its seeds, and now and then a side stem.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} from @param {number} head
 * @param {number} run @param {number} g @param {number} born @param {number} vigour @param {string[]} colours
 * @param {(() => void)[]} leaves @param {number} order
 */
function trail(bag, seed, key, from, head, run, g, born, vigour, colours, leaves, order) {
	if (run < 0.01) return;
	const kr = chance(seed, 'nasturtium-trail', ...key);
	const space = bag.space;
	let a = head;
	const step = 0.03;
	const pts = [from.clone()];
	for (let d = step; d <= run + 1e-9; d += step) {
		a += (kr() - 0.5) * 0.45;
		const last = pts[pts.length - 1];
		// along the soil, the last span of the tip lifting off it
		const lift = 0.012 + 0.008 * Math.sin(d * 9) + 0.05 * clamp(1 - (run - d) / 0.12);
		pts.push(v3(last.x + Math.cos(a) * step, lift, last.z + Math.sin(a) * step));
	}
	if (pts.length < 2) return;
	bag.add('body', tube(pts, (u) => 0.0032 * (1 - 0.4 * u) * (order ? 0.8 : 1), (u) => mix('#7a9a4a', '#a8c070', u), 4));
	space.rod(pts, 0.004);
	for (let i = 1; i < pts.length; i++) {
		const nr = chance(seed, 'nasturtium-node', ...key, i);
		const p = pts[i];
		const ta = pts[i].clone().sub(pts[i - 1]);
		const along = Math.atan2(ta.z, ta.x);
		// how long ago the tip passed here, in stages
		const age = (run - i * step) / 0.25;
		const grown = clamp(age);
		const b = along + (i % 2 ? 1.2 : -1.2) + (nr() - 0.5) * 0.6;
		if (i % 2 === 0 || order) leaves.push(() => shield(bag, seed, [...key, i], p, b, grown, between(nr, 0.09, 0.17), between(nr, 0.04, 0.06) * vigour, g));
		// a side stem from a few of the older nodes
		if (order === 0 && i > 3 && i % 5 === 0 && nr() < 0.75) trail(bag, seed, [...key, 'side', i], p, along + (nr() < 0.5 ? 0.9 : -0.9), (run - i * step) * 0.6, g, born, vigour, colours, leaves, 1);
		if (i < 4 || nr() > 0.5) continue;
		const opens = Math.max(6.3, born + 1.2 + (i * step) / 0.3) + nr() * 0.5;
		if (g < opens - 0.6) continue;
		const fd = level(b + 0.6);
		const stalk = arch(p, fd.clone().add(v3(0, 1.6, 0)), between(nr, 0.11, 0.17), 0.6, 4);
		const at = stalk[4];
		const open = span(g, opens, opens + 0.25), fall = span(g, opens + 1.1, opens + 1.3);
		const sets = nr() < 0.75, swell = sets ? span(g, opens + 1.2, opens + 2.1) : 0, ripe = span(g, 8.9, 9.5);
		if (fall >= 1 && swell <= 0) continue;
		bag.add('body', tube(stalk, () => 0.0012, () => tint('#8aa860'), 3));
		if (swell > 0) {
			// three wrinkled seeds joined in a triangle, nodding on the stalk
			const R = 0.0045 * lerp(0.4, 1, swell);
			const c = at.clone().add(v3(0, -R * 1.2, 0));
			for (let q = 0; q < 3; q++) {
				const sp = c.clone().addScaledVector(level(q * 2.094 + b), R * 0.9);
				bag.add('body', bead(sp, v3(R, R * 0.9, R), mix('#6a9a3a', '#c8b890', ripe), 4));
			}
			space.ball(c, R * 2);
		} else {
			flower(bag, at, fd.clone().add(v3(0, 0.7, 0)).normalize(), colours, open, fall);
			space.ball(at.clone().addScaledVector(fd, 0.01), 0.025);
		}
	}
}

/**
 * A nasturtium leaf: a round shield held level on its stalk, the stalk joined at its middle, pale veins radiating; its
 * stalk leans this way or that until the blade is clear of the flowers and the leaves already there.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} at @param {number} bear
 * @param {number} grown @param {number} height @param {number} size @param {number} g
 */
function shield(bag, seed, key, at, bear, grown, height, size, g) {
	if (grown <= 0.02) return;
	const lr = chance(seed, 'shield', ...key);
	const R = size * lerp(0.3, 1, grown);
	const H = height * lerp(0.4, 1, grown);
	/** @type {{ balls: { c: THREE.Vector3, r: number }[], cost: number, data: THREE.Vector3 }[]} */
	const options = [];
	for (let o = 0; o < 9; o++) {
		const lean = o === 0 ? 0.25 : 0.55;
		const dir = tilted(level(bear + (o === 0 ? 0 : (o - 1) * 0.785)), lean);
		const t = at.clone().addScaledVector(dir, H * (o > 4 ? 1.25 : 1));
		options.push({ balls: [{ c: t.clone(), r: R * 0.85 }], cost: o * 0.002, data: t });
	}
	const t = bag.space.best(options);
	const old = span(g, 9.2, 9.9) * lr() * 0.5;
	bag.add('body', tube([at, at.clone().lerp(t, 0.5).add(v3(0, H * 0.1, 0)), t], () => 0.0012 * lerp(0.6, 1, grown), () => tint('#9ab868'), 3));
	const out = t.clone().sub(at).setY(0);
	const tip = out.lengthSq() > 1e-8 ? out.normalize() : level(bear);
	bag.add(
		'sheet',
		fan({
			size: R,
			from: -Math.PI,
			to: Math.PI,
			edge: (a) => 1 + 0.06 * Math.sin(a * 5 + 1),
			lift: (s, a) => (1 - grown) * 0.5 * s * Math.abs(Math.sin(a)) + 0.07 * s * s + 0.012 * Math.sin(a * 10) * s,
			paint: (s, a) => {
				const ray = Math.abs(Math.sin(a * 4.5)) < 0.04 + 0.03 * (1 - s);
				return leafColour('#3f7e2c', '#7ab452', grown, old, s).lerp(tint('#b8d4a0'), s < 0.07 ? 0.5 : ray ? 0.3 : 0);
			},
			rings: 4,
			rays: 18
		}),
		face(t, tip, v3(tip.x * 0.25, 1, tip.z * 0.25))
	);
}

/**
 * A nasturtium flower at `at`, looking along `facing`: five round petals (the lower three fringed at their claws), the
 * long nectar spur behind; opening, then falling.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {string[]} colours @param {number} open @param {number} fall
 */
function flower(bag, at, facing, colours, open, fall) {
	const f = facing.clone().normalize();
	const e1 = new THREE.Vector3().crossVectors(f, UP);
	if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
	e1.normalize();
	const e2 = new THREE.Vector3().crossVectors(e1, f).normalize();
	const [deep, pale] = colours;
	// the spur, curving back and down behind
	const spur = [at.clone(), at.clone().addScaledVector(f, -0.012).addScaledVector(e2, 0.004), at.clone().addScaledVector(f, -0.025).addScaledVector(e2, -0.004)];
	bag.add('body', tube(spur, (u) => 0.003 * (1 - 0.8 * u), () => mix(deep, '#c8a040', 0.3), 4));
	if (fall >= 1) return;
	if (open < 0.05) {
		bag.add('body', bead(at.clone().addScaledVector(f, 0.004), v3(0.006, 0.008, 0.006), mix('#a8b060', deep, 0.4), 3, upTo(f)));
		return;
	}
	const size = lerp(0.45, 1, open) * (1 - fall * 0.4);
	for (let k = 0; k < 5; k++) {
		const th = Math.PI / 2 + (k - 2) * 1.2 + (k === 0 || k === 4 ? 0 : 0) + Math.PI;
		const radial = e1.clone().multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
		const dir = radial.clone().addScaledVector(f, lerp(1.4, 0.3, open) + fall).normalize();
		bag.add(
			'sheet',
			sheet({ length: 0.026 * size, width: 0.013 * size, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.45)), 0.6) * (u < 0.3 ? 0.4 + u * 2 : 1), lift: (u, v) => 0.08 * v * v - 0.05 * u, paint: (u, v) => mix(deep, pale, u < 0.3 ? 0.5 : 0).lerp(tint('#5a1a10'), u < 0.4 && Math.abs(Math.sin(v * 9)) < 0.25 ? 0.6 : 0), along: 3, across: 2 }),
			face(at.clone().addScaledVector(f, 0.002), dir, f)
		);
	}
	bag.add('body', bead(at.clone().addScaledVector(f, 0.003), v3(0.0025, 0.0025, 0.0025), '#e8c040', 2));
}

/* ------------------------------------------------------------------------------------------------ sweet woodruff */

export const WOODRUFF_STAGES = stages([
	['Division', 0, 'A clump of thin pale rhizomes with a few shoots, planted in the shade under trees in autumn.'],
	['Rooting', 20, 'New roots run through the leaf litter.'],
	['First shoots', 150, 'In early spring, slender square stems push up, their leaves folded in tight stars.'],
	['Whorls', 170, 'Stems a hand high, a whorl of six to nine narrow glossy leaves at every node, like little ruffs.'],
	['Creeping', 220, 'Thin rhizomes creep out under the leaf litter and send up new stems.'],
	['Carpet', 400, 'A year on: a bright green carpet in the deep shade, keeping the soil covered where little else grows.'],
	['Buds', 420, 'Spring: buds at the stem tips. Now, before it flowers, it is picked and wilted for the Maibowle — the scent of coumarin, of new hay, comes as it dries.'],
	['Flowering', 435, 'Loose sprays of tiny white four-pointed stars above the whorls.'],
	['Burs', 470, 'Little round fruits covered in hooked bristles, that catch in fur and socks and are carried off.'],
	['Summer carpet', 520, 'The burs ripen dark; the carpet stays green until the autumn.']
]);

/**
 * Sweet woodruff at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function woodruff(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	// the division's stems, then those the rhizomes send up
	/** @type {{ key: (string | number)[], at: THREE.Vector3, born: number }[]} */
	const stems = [];
	for (let k = 0; k < 4; k++) {
		const kr = chance(seed, 'woodruff-first', k);
		stems.push({ key: ['first', k], at: level(k * 2.39996).multiplyScalar(0.012 + kr() * 0.015), born: 1.7 + k * 0.15 });
	}
	for (let k = 0; k < 6; k++) {
		const kr = chance(seed, 'woodruff-rhizome', k);
		const born = k < 3 ? 0.6 + k * 0.2 : 3.4 + k * 0.3;
		const run = Math.min(0.26, Math.max(0, g - born) * 0.07) * vigour * between(kr, 0.8, 1.1);
		if (run < 0.005) continue;
		let a = k * 2.39996 + kr() * 0.5;
		const pts = [v3(0, -0.01, 0)];
		for (let m = 1; m <= 6; m++) {
			a += (kr() - 0.5) * 0.5;
			pts.push(pts[m - 1].clone().add(v3(Math.cos(a) * run / 6, 0, Math.sin(a) * run / 6)));
		}
		bag.add('body', tube(pts, () => 0.0012, () => tint('#e8dcc0'), 3));
		root(bag, { seed, key: ['rhiz', k], from: pts[3].clone(), dir: v3(0, -1, 0), length: 0.06, grown: span(g, born, born + 1.5), radius: 0.0006, laterals: 3, depth: 1, young: '#f6efdc', old: '#d8c49a' });
		for (let j = 0; j < 5; j++) {
			const d = 0.05 + j * 0.05;
			if (run < d) break;
			const sborn = Math.max(1.7, born + d / 0.07 + 0.2);
			stems.push({ key: [k, j], at: point(pts, d / run).setY(0), born: sborn });
		}
	}
	root(bag, { seed, key: ['clump'], from: v3(0, -0.01, 0), dir: v3(0, -1, 0), length: 0.1, grown: span(g, 0, 2), radius: 0.001, laterals: 6, depth: 1, young: '#f6efdc', old: '#d8c49a' });
	const buds = span(g, 5.6, 6), bloom = span(g, 6.6, 7.0), burs = span(g, 7.6, 8.2), ripe = span(g, 8.7, 9.3);
	const slivers = new Slivers();
	for (const st of stems) {
		if (g <= st.born) continue;
		const sr = chance(seed, 'woodruff-stem', ...st.key);
		const grown = span(g, st.born, st.born + 1.4);
		const H = 0.2 * between(sr, 0.8, 1.15) * vigour * grown;
		if (H < 0.004) continue;
		const lean = level(sr() * Math.PI * 2).multiplyScalar(between(sr, 0.05, 0.25));
		const stem = arch(st.at, v3(lean.x, 1, lean.z), H, 0.1, 4);
		bag.add('body', tube(stem, () => 0.0011, () => tint('#6a9a4a'), 4));
		// the whorls: the upper ones the biggest, each leaf narrow and pointed, spread in a star
		for (let w = 0; w < 6; w++) {
			// planted by the thousand, every other lower whorl is left out
			if (DETAIL.level < 1 && (w === 1 || w === 3)) continue;
			const u = 0.18 + w * 0.15;
			const p = point(stem, u);
			const age = clamp((1 - u) * 1.2 + grown * 1.2 - 0.6);
			const n = 7 + ((w + Math.floor(sr() * 3)) % 3);
			const len = (0.022 + 0.018 * (w / 5)) * lerp(0.35, 1, age);
			for (let m = 0; m < n; m++) {
				const out = level((m / n) * Math.PI * 2 + w * 0.4);
				slivers.add(p, tilted(out, lerp(0.3, 1.4, age)), len, len * 0.13, mix('#3a7a2e', '#7ab04a', (1 - age) * 0.8 + (m % 2) * 0.08), 0.12);
			}
		}
		// the flowers at the top: a loose spray of tiny white stars, then the bristly burs
		if (buds <= 0 || grown < 0.9 || sr() < 0.2) continue;
		const top = stem[4];
		for (let f = 0; f < 9; f++) {
			const a = f * 2.39996 + sr();
			const d = f ? 0.006 + 0.007 * Math.sqrt(f / 8) : 0;
			const fp = top.clone().add(v3(Math.cos(a) * d, 0.012 + 0.005 * (f % 3) - d * 0.4, Math.sin(a) * d));
			bag.add('body', tube([top, fp], () => 0.0004, () => tint('#7aa04a'), 2));
			if (burs > 0.3) {
				bag.add('body', bead(fp, v3(0.0018, 0.0016, 0.0018), mix('#7a9a4a', '#3a3a24', ripe), 2));
			} else if (bloom < 0.2) {
				bag.add('body', bead(fp, v3(0.0017, 0.002, 0.0017), '#e8eedc', 2));
			} else {
				bag.add('body', bead(fp, v3(0.0012, 0.0008, 0.0012), '#f4f0d8', 2));
				for (let q = 0; q < 4; q++) slivers.add(fp, level(q * Math.PI / 2 + a).add(v3(0, 0.35, 0)), 0.0042 * bloom, 0.002, '#fbfbf4');
			}
		}
	}
	slivers.into(bag);
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ Jerusalem artichoke */

export const JERUSALEM_STAGES = stages([
	['Tuber', 0, 'A knobbly tuber the size of a hen’s egg, ten centimetres down in early spring.'],
	['Sprouting', 21, 'White shoots from its eyes, roots below.'],
	['Shoots', 40, 'Stout hairy shoots break the soil, rough leaves in pairs.'],
	['Leafy', 60, 'Stems knee-high, broad, rough, dark green leaves.'],
	['Tall', 100, 'Stems two metres, the leaves alternate higher up; under the soil, white stolons run out.'],
	['Towering', 140, 'A thicket nearly three metres tall — a windbreak and a screen; the stolon tips start to swell.'],
	['Flowering', 180, 'Small yellow sunflowers at the tops in September, the bees and hoverflies at them.'],
	['Tubers', 210, 'Under the soil, a nest of knobbly tubers filling out.'],
	['Frosted', 240, 'The first frosts blacken the leaves; the stems stand brown and the tubers grow sweet.'],
	['Digging', 260, 'Dug as needed all winter; any tuber missed comes up again next spring.']
]);

/**
 * The Jerusalem artichoke at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function jerusalemArtichoke(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const skin = chance(seed, 'topinambur-skin')() < 0.65 ? '#d8b896' : '#b0645a';
	const T = v3(0, -0.1, 0);
	const frost = span(g, 7.8, 8.5);
	// the planted tuber, feeding the shoots, shrivelling, gone
	const spent = span(g, 1, 5);
	if (spent < 1) tuber(bag, seed, ['mother'], T.clone().add(v3(-0.03, 0, 0)), v3(1, 0.1, 0.2), 0.065, 0.022 * (1 - 0.6 * spent), mix(skin, '#6a5040', spent));
	for (let i = 0; i < 6; i++) {
		const rr = chance(seed, 'topinambur-root', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['r', i], from: T.clone(), dir: v3(Math.cos(a) * 0.5, -1, Math.sin(a) * 0.5), length: between(rr, 0.4, 0.7) * vigour, grown: table(g, [[0.5, 0], [1.5, 0.2], [3, 0.6], [5, 1]]), radius: 0.0025, down: 0.04, wander: 0.25, laterals: 5, lateral: 0.35, depth: 1, age: span(g, 2, 6), young: '#f4ead6', old: '#b8986a' });
	}
	const space = bag.space;
	/** @type {(() => void)[]} */
	const later = [];
	const stems = 3 + Math.floor(chance(seed, 'topinambur-stems')() * 2);
	/** where the stems come up, for the stolons */
	const feet = [];
	for (let k = 0; k < stems; k++) {
		const sr = chance(seed, 'topinambur-stem', k);
		const H = table(g - k * 0.15, [[1.3, 0], [2, 0.06], [3, 0.5], [4, 1.8], [5, 2.6], [6, 2.8]]) * between(sr, 0.82, 1.05) * vigour;
		const a = k * 2.39996 + sr();
		const foot = T.clone().add(v3(Math.cos(a) * 0.03, 0.02, Math.sin(a) * 0.03));
		feet.push(foot);
		const under = [foot, v3(foot.x + Math.cos(a) * 0.03, -0.04, foot.z + Math.sin(a) * 0.03), v3(foot.x + Math.cos(a) * 0.05, 0, foot.z + Math.sin(a) * 0.05)];
		if (H <= 0) {
			// still a white shoot from an eye, under the soil
			const grow = span(g, 0.6, 1.3);
			if (grow > 0) bag.add('body', tube([foot, foot.clone().lerp(under[1], grow)], () => 0.003, () => tint('#f0e8d8'), 4));
			continue;
		}
		const lean = level(a).multiplyScalar(between(sr, 0.05, 0.13));
		const stem = [...under];
		for (let m = 1; m <= 12; m++) {
			const h = (m / 12) * H;
			stem.push(under[2].clone().add(v3(lean.x * h, h, lean.z * h)));
		}
		const R = (0.004 + 0.011 * span(g, 2, 5.5)) * vigour;
		bag.add('body', tube(stem, (u) => R * (1 - 0.6 * u), (u) => mix(mix('#4a6a2e', '#6a4a4a', 0.3 * (1 - u)), '#7a6648', frost), 6));
		space.rod(stem, R);
		const above = stem.slice(2);
		// the flowers: a head at the top and on short branches from the top nodes
		const bud = span(g, 5.0, 5.5), open = span(g, 5.5, 6.0), fade = span(g, 7.2, 8.2);
		if (bud > 0) {
			const heads = [{ at: above[12], dir: towards(above, 1) }];
			for (let b = 0; b < 6; b++) {
				const br = chance(seed, 'topinambur-branch', k, b);
				const from = point(above, 0.62 + b * 0.06);
				const len = between(br, 0.15, 0.35) * bud;
				const twig = arch(from, tilted(level(a + b * 2.39996), 0.6), len, -0.3, 4);
				bag.add('body', tube(twig, (u) => R * 0.35 * (1 - 0.4 * u), () => mix('#4a6a2e', '#7a6648', frost), 4));
				space.rod(twig, R * 0.35);
				heads.push({ at: twig[4], dir: towards(twig, 1) });
			}
			for (const h of heads) {
				const facing = h.dir.clone().lerp(UP, 0.3).normalize();
				space.ball(h.at.clone().addScaledVector(facing, 0.01), 0.04 * open + 0.012);
				sunflower(bag, h.at, facing, bud, open, fade);
			}
		}
		// the leaves: in pairs low down, alternate higher up, the topmost small
		let n = 0;
		for (let h = 0.08; h < H - 0.02; h += 0.09, n++) {
			const lr = chance(seed, 'topinambur-leaf', k, n);
			const u = h / H;
			const p = point(above, u);
			const grown = clamp((H - h) / 0.4);
			// the lowest drop as it grows tall, and after the frost the rest go too, a few at a time
			if (h < 0.5 * clamp((g - 3.5) / 2) || lr() < span(g, 8.3, 9.3) * 0.8) continue;
			const L = (0.28 - 0.14 * clamp((h - 1.4) / 1.4)) * lerp(0.3, 1, grown) * vigour * about(lr, 1, 0.08);
			const pair = h < 1.0;
			for (const side of pair ? [0, Math.PI] : [0]) {
				const bear = a + n * (pair ? Math.PI / 2 : 2.39996) + side;
				later.push(() => {
					const out = space.steer(p, level(bear), 0.2, L, 0.03);
					const tilt = lerp(0.2, between(lr, 1.0, 1.35), grown) + frost * 0.6;
					const dir = tilted(out, tilt);
					const st = p.clone().addScaledVector(dir, L * 0.18);
					bag.add('body', tube([p, st], () => 0.0018, () => mix('#5a7a3a', '#5a4a30', frost), 3));
					bag.add(
						'sheet',
						sheet({
							length: L,
							width: L * 0.34,
							shape: (uu) => Math.pow(Math.sin(Math.PI * Math.pow(uu, 0.68)), 0.7) * (1 + (uu > 0.15 && uu < 0.9 ? ((uu * 16) % 1) * 0.08 : 0)),
							lift: (uu, v) => 0.06 * v * v - (0.12 + frost * 0.4) * uu * uu,
							paint: (uu, v) => mix(leafColour('#3a682c', '#5a8a3a', grown, 0, uu), '#2e2a1e', frost * 1.1).lerp(tint('#7a9a5a'), Math.abs(v) < 0.07 ? 0.35 * (1 - frost) : 0),
							along: 8,
							across: 3
						}),
						aim(st, dir.clone().add(v3(0, -0.25, 0)).normalize(), (lr() - 0.5) * 0.8)
					);
				});
			}
		}
	}
	// the stolons and the tubers at their ends: a nest round the stems' feet
	for (let m = 0; m < 14; m++) {
		const tr = chance(seed, 'topinambur-tuber', m);
		const born = 4.0 + m * 0.08;
		const run = span(g, born, born + 1);
		if (run <= 0) continue;
		const foot = feet[m % feet.length];
		const a = m * 2.39996 + tr();
		const reach = between(tr, 0.06, 0.28);
		const end = foot.clone().add(v3(Math.cos(a) * reach * run, -between(tr, 0, 0.08) * run, Math.sin(a) * reach * run));
		bag.add('body', tube([foot, foot.clone().lerp(end, 0.5).add(v3(0, -0.01, 0)), end], () => 0.0018, () => tint('#f0e6d4'), 3));
		const swell = span(g, 5, 7.6) * between(tr, 0.6, 1.1);
		if (swell > 0.02) tuber(bag, seed, [m], end, level(a).add(v3(0, -0.3 + tr() * 0.6, 0)), 0.04 + 0.05 * swell, 0.006 + 0.018 * swell, skin);
	}
	for (const f of later) f();
	return bag.build();
}

/**
 * A knobbly tuber from `at` along `dir`: lumpy, its eyes swollen into knobs, one or two knobs grown out to the side.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} at @param {THREE.Vector3} dir
 * @param {number} length @param {number} R @param {THREE.ColorRepresentation} skin
 */
function tuber(bag, seed, key, at, dir, length, R, skin) {
	const tr = chance(seed, 'tuber', ...key);
	const d = dir.clone().normalize();
	const side = new THREE.Vector3().crossVectors(d, UP);
	if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
	side.normalize();
	const pts = [];
	for (let k = 0; k <= 8; k++) pts.push(at.clone().addScaledVector(d, (k / 8) * length).addScaledVector(side, Math.sin(k * 0.9 + tr() * 3) * R * 0.25));
	const ph = tr() * 6;
	bag.add('body', tube(pts, (u, v) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.04 + u * 0.96))), 0.55) * (1 + 0.22 * Math.sin(u * 17 + v * 11 + ph) * Math.sin(v * 7)), (u, v) => mix(skin, '#f2e6d0', Math.abs(Math.sin(u * 19 + v * 5)) > 0.95 ? 0.4 : 0), 8));
	for (let k = 0; k < 2; k++) {
		const p = point(pts, 0.35 + k * 0.3);
		const a = tr() * Math.PI * 2;
		const o = side.clone().applyAxisAngle(d, a);
		bag.add('body', bead(p.addScaledVector(o, R * 0.7), v3(R * 0.55, R * 0.5, R * 0.55), skin, 4));
	}
}

/**
 * A little sunflower: green bracts behind, a ring of yellow rays round a yellow-brown disc; a bud first, the rays
 * drooping and falling as it fades.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {number} bud @param {number} open @param {number} fade
 */
function sunflower(bag, at, facing, bud, open, fade) {
	const f = facing.clone().normalize();
	const turn = upTo(f);
	bag.add('body', bead(at, v3(0.012, 0.008, 0.012).multiplyScalar(lerp(0.4, 1, bud)), mix('#5a7a3a', '#5a4a30', fade), 4, turn));
	for (let k = 0; k < 10; k++) {
		const a = (k / 10) * Math.PI * 2;
		const d = v3(Math.cos(a), lerp(1.2, 0.2, open), Math.sin(a)).normalize().applyQuaternion(turn);
		bag.add('sheet', sheet({ length: 0.016 * lerp(0.5, 1, bud), width: 0.004, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.6)), paint: () => mix('#4a6a2e', '#5a4a30', fade), along: 2, across: 1 }), face(at, d, f));
	}
	if (open <= 0) return;
	const disc = at.clone().addScaledVector(f, 0.005);
	bag.add('sheet', fan({ size: 0.011 * lerp(0.6, 1, open), from: -Math.PI, to: Math.PI, edge: () => 1, lift: (s) => 0.2 * s * (1 - s), paint: (s) => mix(mix('#c89a2a', '#8a5a2a', s < 0.6 ? 0.6 : 0), '#4a3424', fade), rings: 2, rays: 10 }), face(disc, new THREE.Vector3().crossVectors(f, v3(0.3, 0.1, 1)).normalize(), f));
	if (fade >= 1) return;
	for (let k = 0; k < 12; k++) {
		const a = (k / 12) * Math.PI * 2 + 0.1;
		const radial = v3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(turn);
		const d = radial.clone().addScaledVector(f, lerp(0.9, 0.05, open) - fade * 1.2).normalize();
		bag.add('sheet', sheet({ length: 0.032 * lerp(0.4, 1, open) * (1 - fade * 0.3), width: 0.0055, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.5), lift: (u, v) => -0.06 * v * v, paint: (u) => mix(mix('#f4c41e', '#f8d848', u * 0.4), '#a88a3a', fade), along: 3, across: 1 }), face(disc.clone().addScaledVector(radial, 0.009), d, f));
	}
}

/* ------------------------------------------------------------------------------------------------ horseradish */

export const HORSERADISH_STAGES = stages([
	['Root cutting', 0, 'A pencil-thick piece of side root (a thong), planted slanting in spring, its top end up.'],
	['Sprouting', 14, 'Buds break at its top; white roots from all along it.'],
	['First leaves', 30, 'A tuft of narrow leaves, the earliest deeply cut like combs.'],
	['Rosette', 60, 'Long-stalked oblong leaves, glossy, their edges wavy and crinkled.'],
	['Clump', 110, 'Leaves sixty centimetres and more, standing up in a dark clump; gone back to the crown in winter.'],
	['Second spring', 380, 'Back from the crown, bigger: a clump near a metre high.'],
	['Flowering', 420, 'Branched stems rise a metre with clouds of small white four-petalled flowers, honey-scented.'],
	['Summer', 470, 'The flowers fall (it hardly ever sets seed); the leaves at their biggest.'],
	['Root thickening', 560, 'In autumn the taproot fills out, white as a parsnip and thick as a wrist.'],
	['Lifting', 600, 'Lifted after the frosts: grated, it brings the tears. The side roots are kept to replant — and any piece left in the soil grows again.']
]);

/**
 * Horseradish at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function horseradish(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const crown = v3(0, 0.003, 0);
	// the taproot, from the slanting thong it grew from, thickening; side roots from all along it
	const fat = span(g, 2.5, 9);
	const Lr = (0.18 + 0.2 * span(g, 2, 9)) * vigour;
	const Rr = (0.005 + 0.019 * fat) * vigour;
	const lean = level(chance(seed, 'horseradish-lean')() * Math.PI * 2);
	const tap = [];
	for (let k = 0; k <= 10; k++) {
		const t = k / 10;
		tap.push(crown.clone().addScaledVector(lean, Lr * 0.35 * Math.sin(t * 1.5) * (1 - fat * 0.6)).add(v3(0, -t * Lr, 0)));
	}
	bag.add('body', tube(tap, (u) => Rr * (u < 0.06 ? 0.75 + u * 4 : 1) * (1 - 0.7 * u * u), (u, v) => mix('#d4c098', '#a8905e', Math.abs(Math.sin(u * 60 + v)) > 0.9 ? 0.6 : 0.15), 10));
	for (let i = 0; i < 7; i++) {
		const rr = chance(seed, 'horseradish-root', i);
		const t = 0.25 + i * 0.1;
		const a = i * 2.39996;
		root(bag, { seed, key: ['side', i], from: point(tap, t), dir: v3(Math.cos(a), -0.6, Math.sin(a)), length: between(rr, 0.15, 0.3) * vigour, grown: span(g, 1 + i * 0.2, 4 + i * 0.2), radius: 0.002 + 0.003 * fat, down: 0.08, wander: 0.2, laterals: 3, lateral: 0.3, depth: 1, age: fat, young: '#f4ead6', old: '#b8a070' });
	}
	if (g < 1.5) bag.add('body', bead(crown.clone().add(v3(0, 0.004, 0)), v3(0.006, 0.008, 0.006).multiplyScalar(span(g, 0.3, 1.2)), '#d8d8a8', 4));
	// the leaves: the first year's gone back in the winter, the second year's bigger
	/** @type {{ key: number, born: number, size: number, wither: number, comb: boolean }[]} */
	const leaves = [];
	for (let i = 0; i < 11; i++) leaves.push({ key: i, born: 0.9 + i * 0.3, size: 0.32 + 0.055 * i, wither: span(g, 4.3 + i * 0.02, 4.8), comb: i < 3 });
	for (let j = 0; j < 22; j++) leaves.push({ key: 11 + j, born: 4.5 + j * 0.09, size: 0.85 + 0.15 * clamp(j / 4), wither: span(g, 8.8 + (j % 4) * 0.15, 9.8) * (j < 6 ? 0.6 : 0.2), comb: false });
	const top = v3(0, 0.005, 0);
	for (const L of leaves) {
		if (g <= L.born || L.wither >= 1) continue;
		const lr = chance(seed, 'horseradish-leaf', L.key);
		const grown = clamp((g - L.born) / 1.1);
		const out = level(L.key * 2.39996 + about(lr, 0, 0.2));
		const S = L.size * vigour * about(lr, 1, 0.08);
		const tilt = lerp(0.05, between(lr, 0.25, 0.7), grown) + L.wither * 0.8;
		const P = (0.06 + 0.22 * S) * lerp(0.3, 1, grown);
		const stalk = arch(top.clone().addScaledVector(out, 0.008), tilted(out, tilt), P, 0.04, 4);
		bag.add('body', tube(stalk, (u) => 0.004 * lerp(0.4, 1, grown) * (1 - 0.3 * u), () => mix('#a8c088', '#c8b060', L.wither), 4));
		const len = (0.1 + 0.42 * S) * lerp(0.25, 1, grown);
		const comb = L.comb;
		bag.add(
			'sheet',
			sheet({
				length: len,
				width: len * (comb ? 0.2 : 0.15),
				shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.5) * (comb ? 0.2 + 0.8 * Math.abs(Math.sin(u * Math.PI * 6)) : 1 + 0.03 * Math.abs(Math.sin(u * 45))),
				// wavy and crinkled at the edges, arching over at the tip
				lift: (u, v) => 0.05 * v * v + 0.018 * Math.sin(u * 24 + v) * Math.pow(Math.abs(v), 2) * grown - (0.12 + L.wither * 0.3) * u * u,
				paint: (u, v) => leafColour('#2f6a2a', '#6aa040', grown, L.wither, u).lerp(tint('#b8d098'), Math.abs(v) < 0.07 ? 0.5 : Math.abs(Math.sin(u * 14 - Math.abs(v) * 3)) > 0.95 ? 0.18 : 0),
				along: 18,
				across: 4
			}),
			aim(stalk[4], tilted(out, tilt + 0.1), (lr() - 0.5) * 0.4)
		);
	}
	// the flowering stems, from its second spring: branched, white clouds of small flowers that seldom set
	const stems = 2 + Math.floor(chance(seed, 'horseradish-stems')() * 2);
	const bloom = span(g, 5.8, 6.2), over = span(g, 6.8, 7.4), brown = span(g, 8.2, 9);
	for (let k = 0; k < stems; k++) {
		const fr = chance(seed, 'horseradish-stem', k);
		const born = 5.2 + k * 0.15;
		if (g <= born) break;
		const rise = span(g, born, born + 0.7);
		const H = (0.7 + 0.25 * fr()) * vigour * rise;
		const a = k * 2.39996 + fr();
		const stem = arch(top.clone().addScaledVector(level(a), 0.01), tilted(level(a), between(fr, 0.05, 0.2)), H, -0.05, 8);
		bag.add('body', tube(stem, (u) => 0.004 * (1 - 0.6 * u), () => mix('#7a9a5a', '#8a7a4a', brown), 4));
		for (let j = 0; j < 2; j++) bag.add('sheet', sheet({ length: 0.09 * rise, width: 0.012, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.6), lift: (u) => -0.1 * u * u, paint: (u) => leafColour('#2f6a2a', '#6aa040', 1, brown, u), along: 5, across: 1 }), aim(point(stem, 0.25 + j * 0.15), tilted(level(a + 2.4 + j * 2.4), 1.0), 0));
		for (let b = 0; b < 6; b++) {
			const t = 0.5 + b * 0.09;
			const twig = arch(point(stem, t), tilted(level(a + b * 2.39996), 0.6), (0.18 - b * 0.02) * rise, -0.1, 3);
			bag.add('body', tube(twig, () => 0.0012, () => mix('#7a9a5a', '#8a7a4a', brown), 3));
			for (let m = 0; m < 14; m++) {
				const p = point(twig, 0.15 + m * 0.062);
				const side = level(m * 2.39996 + b).multiplyScalar(0.008);
				const fp = p.clone().add(side).add(v3(0, 0.002, 0));
				if (over >= 1) continue;
				if (bloom <= 0) bag.add('body', bead(fp, v3(0.0016, 0.0016, 0.0016), '#d8e0b8', 2));
				else bag.add('body', bead(fp, v3(0.006, 0.0035, 0.006).multiplyScalar(lerp(0.6, 1, bloom) * (1 - over * 0.5)), mix('#fafaf2', '#c8c8a0', over), 2));
			}
		}
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ hop */

export const HOP_STAGES = stages([
	['Rhizome', 0, 'A piece of last year’s rhizome with its buds, a hand down at the foot of its pole, in early spring.'],
	['Shoots', 20, 'Red-flushed shoots push up; most are cut and eaten like asparagus, the three strongest kept.'],
	['Training', 35, 'The three bines find the pole and wind clockwise up it, their stems rough with hooked hairs that grip.'],
	['Climbing', 50, 'Up to a hand’s breadth a day, a pair of rough, lobed leaves at every node.'],
	['Halfway', 70, 'Over two metres up the pole; the lowest leaves stripped to let the air through.'],
	['Over the top', 95, 'At the top of the pole and over; side arms grow from the leaf axils in the upper half.'],
	['Burrs', 110, 'The female flowers: soft, spiky green burrs clustered on the side arms.'],
	['Green cones', 125, 'The burrs swell into papery green cones, bract over bract.'],
	['Ripening', 145, 'The cones dry and rustle, yellow lupulin dust inside smelling of beer and resin.'],
	['Harvest', 160, 'Golden cones picked; the bines cut down and the leaves yellowing; in spring it comes again from the rhizome.']
]);

const POLE = v3(0.09, 0, 0.02);
const POLE_TOP = 4.5;
const POLE_R = 0.04;
/** the twining: round the pole, so many radians a metre up, clockwise from above */
const TWINE = (Math.PI * 2) / 0.4;

/** a hop leaf's reach at the angle a: heart-based, cut into three or five pointed, toothed lobes (`lobes`) */
const hopEdge = (/** @type {number} */ a, /** @type {number} */ lobes) => {
	const heart = rhubarbEdge(a);
	const at = lobes >= 5 ? [0, 0.85, -0.85, 1.65, -1.65] : lobes >= 3 ? [0, 0.9, -0.9] : [0];
	let lobe = 0;
	for (const t of at) lobe = Math.max(lobe, Math.exp(-Math.pow((a - t) / 0.33, 2)) * (t === 0 ? 1 : Math.abs(t) > 1.2 ? 0.7 : 0.9));
	return heart * (lobes > 1 ? 0.5 + 0.55 * lobe : 1) * (1 + 0.05 * Math.abs(Math.sin(a * 22)));
};

/**
 * The hop at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function hop(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.06);
	const space = bag.space;
	// the rhizome, a hand down, and its roots going deep
	const rz = [v3(-0.12, -0.09, -0.02), v3(-0.05, -0.08, 0.01), v3(0.02, -0.085, -0.01), v3(0.09, -0.09, 0.02)];
	bag.add('body', tube(rz, () => 0.01 + 0.004 * span(g, 1, 6), (u) => mix('#6a4a34', '#8a6a4a', u), 6));
	for (let i = 0; i < 6; i++) {
		const rr = chance(seed, 'hop-root', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['r', i], from: point(rz, i / 5), dir: v3(Math.cos(a) * 0.4, -1, Math.sin(a) * 0.4), length: between(rr, 0.5, 0.9) * vigour, grown: table(g, [[0, 0.3], [2, 0.5], [5, 1]]), radius: 0.004, down: 0.06, wander: 0.2, laterals: 4, lateral: 0.3, depth: 1, age: span(g, 1, 6), young: '#f0e2c8', old: '#8a6a48' });
	}
	// the pole, set in beside it before the bines climb
	if (g >= 1.2) bag.add('prop', tube([POLE.clone().add(v3(0, -0.4, 0)), POLE.clone().add(v3(0, POLE_TOP, 0))], (u) => POLE_R * (1 - 0.25 * u), (u, v) => mix('#7a5a3e', '#9a7a58', Math.abs(Math.sin(u * 140 + v * 9)) > 0.85 ? 1 : 0.3), 8));
	space.rod([POLE.clone(), POLE.clone().add(v3(0, POLE_TOP, 0))], POLE_R + 0.005);
	// the spring shoots that are cut and eaten
	const spare = span(g, 0.5, 1.2) * (1 - span(g, 1.7, 1.9));
	if (spare > 0) {
		for (let k = 0; k < 5; k++) {
			const sr = chance(seed, 'hop-spare', k);
			const from = point(rz, between(sr, 0, 1));
			const h = (0.06 + 0.2 * sr()) * spare;
			bag.add('body', tube([from, from.clone().add(v3((sr() - 0.5) * 0.04, -from.y + h, (sr() - 0.5) * 0.04))], (u) => 0.004 * (1 - 0.5 * u), (u) => mix('#c8b0a0', '#8a3a4a', u), 4));
		}
	}
	/** @type {{ at: THREE.Vector3, size: number, key: (string | number)[], near: Space }[]} */
	const clusters = [];
	for (let b = 0; b < 3; b++) {
		const br = chance(seed, 'hop-bine', b);
		const phase = (b / 3) * Math.PI * 2 + br() * 0.5;
		const H = table(g, [[0.6, 0], [1, 0.08], [1.5, 0.3], [2, 0.7], [3, 1.8], [4, 3.0], [5, 4.6], [6, 5.2], [9, 5.4]]) * between(br, 0.92, 1.04) * vigour;
		if (H < 0.005) continue;
		const start = point(rz, 0.3 + b * 0.25).setY(-0.06);
		const over = level(phase);
		/** the bine at height h: from the rhizome over to the pole, round and round it clockwise; over the top, arching out and down */
		const bineAt = (/** @type {number} */ h) => {
			const to = clamp((h - 0.04) / 0.3);
			const e = to * to * (3 - 2 * to);
			const T = POLE_TOP - 0.05;
			const a = phase + Math.min(h, T) * TWINE;
			const ring = POLE_R * (1 - 0.25 * Math.min(h, T) / POLE_TOP) + 0.006;
			const p = v3(lerp(start.x, POLE.x + Math.cos(a) * ring, e), start.y + Math.min(h, T), lerp(start.z, POLE.z + Math.sin(a) * ring, e));
			if (h <= T) return p;
			const x = h - T;
			const arc = 0.4 * Math.PI / 2;
			const dx = x <= arc ? 0.4 * (1 - Math.cos(x / 0.4)) : 0.4;
			const dy = x <= arc ? 0.4 * Math.sin(x / 0.4) : 0.4 - (x - arc);
			return p.addScaledVector(over, dx).add(v3(0, dy, 0));
		};
		const steps = Math.max(2, Math.ceil(H / 0.03));
		const pts = [];
		for (let k = 0; k <= steps; k++) pts.push(bineAt((k / steps) * H));
		const yellow = span(g, 8.7, 9.6);
		bag.add('body', tube(pts, (u) => (0.0028 + 0.0018 * span(g, 2, 6)) * (1 - 0.5 * u), (u) => mix(mix('#5a7a3a', '#8a4a4a', u > 0.97 ? 0.5 : 0), '#8a7a4a', yellow), 5));
		space.rod(pts, 0.005);
		// the nodes: a pair of leaves at each, and from the upper ones the side arms. What the cones must keep clear of is
		// near them — their node's leaves and arm, and the node's below — so each node keeps its own space
		/** @type {Space | null} */
		let below = null;
		for (let n = 0; ; n++) {
			const h = 0.15 + n * 0.24;
			if (H < h + 0.02) break;
			const nr = chance(seed, 'hop-node', b, n);
			const p = bineAt(h);
			const radial = p.clone().sub(POLE).setY(0);
			const out = radial.lengthSq() > 1e-8 ? radial.normalize() : over.clone();
			const grown = clamp((H - h) / 0.45);
			// the lowest leaves stripped off once it is well up the pole
			const stripped = h < 0.9 && g > 4.2;
			const old = h < 2 ? span(g, 8.3, 9.4) : span(g, 8.9, 9.8) * 0.6;
			const near = new Space();
			if (below) near.balls.push(...below.balls);
			near.rod([bineAt(h - 0.3), bineAt(h), bineAt(h + 0.3)], 0.005);
			near.rod([POLE.clone().setY(h - 0.4), POLE.clone().setY(h + 0.4)], POLE_R + 0.005);
			below = near;
			if (!stripped) {
				for (const s of [-1, 1]) {
					const d = out.clone().applyAxisAngle(UP, s * (0.9 + (n % 2) * 0.3) + about(nr, 0, 0.2));
					hopLeaf(bag, near, p, d, (h > 3.6 ? 0.11 : 0.14) * vigour * about(nr, 1, 0.1), grown, h > 3.6 ? 3 : 5, old);
				}
			}
			// the side arms from the axils of the upper nodes: one, alternating, then a pair higher up
			if (h < 1.4) continue;
			const armBorn = 4.4 + (h - 1.4) * 0.16;
			const arm = span(g, armBorn, armBorn + 1.3);
			if (arm <= 0) continue;
			for (const s of h > 2.4 ? [-1, 1] : [n % 2 ? 1 : -1]) {
				const ar = chance(seed, 'hop-arm', b, n, s);
				const ad = out.clone().applyAxisAngle(UP, s * 1.1 + about(ar, 0, 0.2)).multiplyScalar(0.85).add(v3(0, 0.5, 0));
				const len = between(ar, 0.3, 0.55) * arm * vigour;
				const ap = arch(p, ad, len, 0.7, 6);
				bag.add('body', tube(ap, (u) => 0.0024 * (1 - 0.5 * u), () => mix('#5a7a3a', '#8a7a4a', yellow), 4));
				near.rod(ap, 0.004);
				for (let m = 1; m <= 3; m++) {
					const u = m / 3;
					const q = point(ap, u);
					const ta = towards(ap, u).setY(0);
					const side = ta.lengthSq() > 1e-8 ? ta.normalize() : out;
					for (const t of [-1, 1]) hopLeaf(bag, near, q, side.clone().applyAxisAngle(UP, t * (m < 3 ? 1.3 : 0.7)), (m < 3 ? 0.085 : 0.06) * vigour * about(ar, 1, 0.1), clamp(arm * 3 - m * 0.6), m < 3 ? 3 : 1, old);
					if (m > 1) clusters.push({ at: q, size: m === 3 ? 3 : 2, key: [b, n, s, m], near });
				}
			}
		}
	}
	// the flowers on the side arms: burrs, then cones, papery, green, ripening golden; each hangs clear of the leaves
	const burr = span(g, 5.6, 6.1), cone = span(g, 6.3, 7.3), ripe = span(g, 7.8, 8.6), gold = span(g, 8.7, 9.4);
	const bracts = new Slivers();
	if (burr > 0) {
		for (const c of clusters) {
			for (let k = 0; k < c.size; k++) {
				const cr = chance(seed, 'hop-cone', ...c.key, k);
				const a = k * 2.39996 + cr() * 0.5;
				const L = (0.012 + 0.03 * cone) * vigour * about(cr, 1, 0.12);
				const R = (0.006 + 0.007 * cone) * vigour;
				/** @type {{ balls: { c: THREE.Vector3, r: number }[], cost: number, data: { at: THREE.Vector3, dir: THREE.Vector3 } }[]} */
				const options = [];
				for (let o = 0; o < 7; o++) {
					const dir = level(a + o * 0.9).multiplyScalar(o ? 0.6 : 0.35).add(v3(0, -1, 0)).normalize();
					const at = c.at.clone().addScaledVector(dir, 0.012 + (o > 3 ? 0.012 : 0));
					options.push({ balls: [{ c: at.clone().addScaledVector(dir, L * 0.3), r: R }, { c: at.clone().addScaledVector(dir, L * 0.75), r: R * 0.8 }], cost: o * 0.002, data: { at, dir } });
				}
				const place = c.near.best(options);
				bag.add('body', tube([c.at, place.at], () => 0.0008, () => tint('#7a9a4a'), 3));
				hopCone(bag, bracts, place.at, place.dir, L, R, burr, cone, ripe, gold, cr());
			}
		}
	}
	bracts.into(bag);
	return bag.build();
}

/**
 * A hop leaf from the node at `at`: its stalk out along `out`, the blade cut into lobes, rough, dark green; its blade
 * set down in the `space` for the cones to keep clear of.
 * @param {Bag} bag @param {Space} space @param {THREE.Vector3} at @param {THREE.Vector3} out @param {number} size @param {number} grown
 * @param {number} lobes @param {number} old
 */
function hopLeaf(bag, space, at, out, size, grown, lobes, old) {
	if (grown <= 0.02) return;
	const R = size * lerp(0.3, 1, grown);
	const o = out.clone().setY(0).normalize();
	const stalk = arch(at, o.clone().add(v3(0, 0.5, 0)), R * 0.6, 0.6, 2);
	const top = stalk[2];
	bag.add('body', tube(stalk, () => 0.0012, () => mix('#6a8a3a', '#a89a4a', old), 3));
	const dir = o.clone().add(v3(0, lerp(1.4, -0.85, grown) - old * 0.5, 0)).normalize();
	space.ball(top.clone().addScaledVector(dir, R * 0.55), R * 0.5);
	bag.add(
		'sheet',
		fan({
			size: R,
			from: -Math.PI,
			to: Math.PI,
			edge: (a) => hopEdge(a, lobes) * (1 - 0.4 * (1 - grown) * Math.abs(Math.sin(a))),
			lift: (s, a) => (1 - grown) * 0.6 * s * Math.abs(Math.sin(a)) - 0.08 * s * s + 0.015 * Math.sin(s * 14) * Math.cos(a * 6) * s,
			paint: (s, a) => leafColour('#2f5a24', '#6a9a3a', grown, old, s).lerp(tint('#7a9a5a'), [0, 0.85, -0.85, 1.65, -1.65].some((t) => Math.abs(a - t) < 0.035) ? 0.4 : 0),
			rings: 3,
			rays: 15
		}),
		face(top, dir, UP)
	);
}

/**
 * A hop cone hanging from `at` along `dir`: first a soft spiky burr, then papery bracts overlapping down a short
 * axis, green, drying straw-yellow, then golden with brown tips.
 * @param {Bag} bag @param {Slivers} bracts where its bracts are gathered @param {THREE.Vector3} at @param {THREE.Vector3} dir
 * @param {number} L @param {number} R @param {number} burr @param {number} cone @param {number} ripe @param {number} gold @param {number} twist
 */
function hopCone(bag, bracts, at, dir, L, R, burr, cone, ripe, gold, twist) {
	const d = dir.clone().normalize();
	const turn = upTo(d);
	const colour = mix(mix('#a8c86a', '#d0d080', ripe), '#c8a858', gold);
	const mid = at.clone().addScaledVector(d, L * 0.5);
	bag.add('body', bead(mid, v3(R * 0.7, L * 0.5, R * 0.7).multiplyScalar(lerp(0.5, 1, burr)), mix('#8aa858', colour, cone), 3, turn));
	if (cone < 0.05) {
		// the burr's soft white-green styles
		for (let k = 0; k < 6; k++) {
			const a = k * 2.39996;
			const o = v3(Math.cos(a), 0.2, Math.sin(a)).normalize().applyQuaternion(turn);
			bag.add('body', tube([mid, mid.clone().addScaledVector(o, R * 1.3 * burr)], () => 0.0006, () => tint('#e0ecc8'), 2));
		}
		return;
	}
	const tip = mix(colour, '#8a6a3a', gold * 0.6);
	const n = DETAIL.level < 1 ? 6 : 9;
	for (let k = 0; k < n; k++) {
		const t = (k + 0.5) / n;
		const a = k * 2.39996 + twist * 6;
		const radial = v3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(turn);
		const p = at.clone().addScaledVector(d, L * (0.1 + 0.75 * t)).addScaledVector(radial, R * 0.45 * Math.sin(Math.PI * (0.2 + 0.7 * t)));
		const bd = d.clone().addScaledVector(radial, 0.35 + 0.25 * ripe).normalize();
		bracts.add(p, bd, L * 0.45 * cone, R * 0.5, k % 3 ? colour : tip, 0, false, new THREE.Vector3().crossVectors(bd, radial));
	}
}

/* ------------------------------------------------------------------------------------------------ the entries */

/** @type {(import('./index.js').Plant & { layer: import('./index.js').Layer })[]} */
export const WALD = [
	{
		id: 'rhubarb',
		label: 'Rhubarb',
		latin: 'Rheum rhabarbarum · Rhabarber',
		note: 'From a knobbly crown, red buds and huge crinkled leaves on thick red stalks — pulled from the outside in its second spring — then a hollow stem two metres high with a cream plume.',
		from: 'Perennial · 2 years',
		stages: RHUBARB_STAGES,
		grow: rhubarb,
		layer: 'herbaceous'
	},
	{
		id: 'sorrel',
		label: 'Sorrel',
		latin: 'Rumex acetosa · Sauerampfer',
		note: 'A clump of long-stalked, arrow-shaped, lemon-sour leaves, picked from the outside; then slender stems of tiny reddish flowers turning rust-red with seed.',
		from: 'Perennial · 2 years',
		stages: SORREL_STAGES,
		grow: sorrel,
		layer: 'herbaceous'
	},
	{
		id: 'nettle',
		label: 'Stinging nettle',
		latin: 'Urtica dioica · Brennnessel',
		note: 'From a tiny seed to a patch on creeping yellow rhizomes: square stems a metre high, toothed heart leaves in pairs, green flower tassels hanging from the upper axils.',
		from: 'Perennial · 2 years',
		stages: NETTLE_STAGES,
		grow: nettle,
		layer: 'herbaceous'
	},
	{
		id: 'artichoke',
		label: 'Globe artichoke',
		latin: 'Cynara cardunculus var. scolymus · Artischocke',
		note: 'A fountain of deeply cut silver-grey leaves; ribbed stems carry the scaly buds that are eaten, or left to open into violet thistles.',
		from: 'Perennial · 2 years',
		stages: ARTICHOKE_STAGES,
		grow: artichoke,
		layer: 'herbaceous'
	},
	{
		id: 'asparagus',
		label: 'Asparagus',
		latin: 'Asparagus officinalis · Spargel',
		note: 'From a spidery crown, spears every spring — left for two years, then cut for six weeks — and feathery fern a metre and a half high, red berries on the female plants.',
		from: 'Perennial · 3 years',
		stages: ASPARAGUS_STAGES,
		grow: asparagus,
		layer: 'herbaceous'
	},
	{
		id: 'nasturtium',
		label: 'Nasturtium',
		latin: 'Tropaeolum majus · Kapuzinerkresse',
		note: 'Trailing stems over the soil, round shield leaves with the stalk at the middle, spurred flowers orange, red or yellow, and wrinkled green seeds in threes.',
		from: 'Annual · 110 days',
		stages: NASTURTIUM_STAGES,
		grow: nasturtium,
		layer: 'ground'
	},
	{
		id: 'woodruff',
		label: 'Sweet woodruff',
		latin: 'Galium odoratum · Waldmeister',
		note: 'A low carpet for the deep shade: slender stems of starry leaf whorls, tiny white four-pointed flowers in May, then bristly burs; it smells of new hay as it dries.',
		from: 'Perennial · 2 years',
		stages: WOODRUFF_STAGES,
		grow: woodruff,
		layer: 'ground'
	},
	{
		id: 'jerusalem-artichoke',
		label: 'Jerusalem artichoke',
		latin: 'Helianthus tuberosus · Topinambur',
		note: 'From a knobbly tuber, hairy stems nearly three metres tall with rough leaves and little yellow sunflowers; below, a nest of new tubers, dug all winter.',
		from: 'Tuber · 260 days',
		stages: JERUSALEM_STAGES,
		grow: jerusalemArtichoke,
		layer: 'root'
	},
	{
		id: 'horseradish',
		label: 'Horseradish',
		latin: 'Armoracia rusticana · Meerrettich',
		note: 'From a root cutting, a clump of big wavy, long-stalked leaves and white flower sprays; below, a white taproot thick as a wrist that brings the tears.',
		from: 'Root · 2 years',
		stages: HORSERADISH_STAGES,
		grow: horseradish,
		layer: 'root'
	},
	{
		id: 'hop',
		label: 'Hop',
		latin: 'Humulus lupulus · Hopfen',
		note: 'From its rhizome, three bines twining clockwise up a pole four and a half metres high, rough lobed leaves in pairs, side arms hung with papery cones ripening golden.',
		from: 'Climber · perennial',
		stages: HOP_STAGES,
		grow: hop,
		layer: 'climber'
	}
];
