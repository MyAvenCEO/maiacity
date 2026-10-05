/*
 * BEANS — the runner bean (Phaseolus coccineus, Feuerbohne), a twining climber up its bamboo cane. Its big bean stays
 * below the soil when it comes up (its seed leaves never see the light): a hooked shoot pushes up, opens a first pair
 * of simple heart-shaped leaves, opposite, and from then on every leaf is of three leaflets, one at a node, alternate.
 * Its tip circles until it finds the cane, then winds up it anticlockwise as seen from above, two metres and more.
 * From the leaf axils, long stalks carry sprays of pea-like flowers — scarlet, or white on some — opening from the
 * bottom of the spray up, and behind the few that set, long rough pods hang, green, in bunches; a pod left on swells
 * lumpy with its beans and yellows. On its roots, the pink nodules of a legume.
 *
 * All at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { noduled } from './allies.js';

export const BEAN_STAGES = [
	{ name: 'Bean', day: 0, note: 'A big kidney-shaped bean, mottled purple and black, five centimetres down in warm soil after the last frost.' },
	{ name: 'Germination', day: 7, note: 'The root goes down; a hooked shoot pushes up — the bean itself, its two halves full of food, stays below.' },
	{ name: 'First leaves', day: 12, note: 'A pair of simple, heart-shaped leaves, opposite each other, at the top of the shoot.' },
	{ name: 'Trifoliate', day: 20, note: 'The first leaf of three leaflets; the tip already circling, feeling for something to climb.' },
	{ name: 'Climbing', day: 35, note: 'Winding anticlockwise up its cane, a leaf of three at every node.' },
	{ name: 'Flowering', day: 60, note: 'Long sprays of pea-like flowers from the leaf axils, opening from the bottom up, bumblebees at them.' },
	{ name: 'Pods set', day: 67, note: 'Most flowers drop; behind a few, thin green pods.' },
	{ name: 'Young pods', day: 75, note: 'Slender pods a hand long — the best for picking, before the beans show.' },
	{ name: 'Long pods', day: 85, note: 'Rough green pods twenty and thirty centimetres long, hanging in bunches: pick them and more come.' },
	{ name: 'Picking', day: 95, note: 'Picking every few days; a pod left on swells lumpy with its beans and yellows, to keep for seed.' }
];

const SEED_AT = v3(0, -0.05, 0);
const CANE = v3(0.07, 0, 0.02);
const CANE_TOP = 2.2;
/** the twining: round the cane, so many radians a metre up, anticlockwise from above */
const TWIST = (Math.PI * 2) / 0.17;

/** a bean leaflet: broad at the base, drawn out to a point */
const leafletShape = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.7) * (u > 0.8 ? 1 - (u - 0.8) * 2.2 : 1) * (u < 0.05 ? 0.3 + u * 14 : 1);
/** the first leaves: heart-shaped */
const heartShape = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.55)), 0.65);

/**
 * The runner bean at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function beans(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.07);
	const white = chance(seed, 'bean-flower')() < 0.25;
	// the bean comes up hypogeal: its coat and seed leaves stay down, the shoot rises from between them
	const s = sprout(bag, {
		seed, at: SEED_AT, size: v3(0.012, 0.007, 0.0085), coat: '#5a2a4a', coatShade: '#2a1424',
		stem: table(g, [[0, 0], [0.4, 0.003], [1, 0.06], [1.6, 0.085], [9, 0.09]]), hook: table(g, [[0, 1], [1.1, 1], [1.6, 0]]),
		radius: 0.0018 + 0.0018 * span(g, 1.5, 5), stemColor: '#6a8a3a',
		leaf: { length: 0.001, width: 0.0005, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
		open: 0, shed: span(g, 4, 5.5), wither: 1, keepCoat: true
	});
	// its mottling, while it lasts
	if (g < 5.5) {
		const mr = chance(seed, 'mottle');
		for (let k = 0; k < 6; k++) bag.add('body', bead(SEED_AT.clone().add(v3(between(mr, -0.009, 0.009), between(mr, -0.003, 0.004), between(mr, -0.006, 0.006))), v3(0.003, 0.0025, 0.003).multiplyScalar(1 - span(g, 4, 5.5) * 0.4), '#c8a0c0', 3));
	}
	// roots: a taproot and its laterals, pink nodules on them
	noduled(bag, { seed, key: ['tap'], from: SEED_AT.clone(), dir: v3(0, -1, 0), length: 0.5, grown: table(g, [[0, 0], [0.4, 0.03], [1, 0.12], [2, 0.3], [4, 0.7], [6, 1]]), radius: 0.0025, nodules: 18, laterals: 10, age: span(g, 3, 6) });

	// the cane, pushed in beside it before it climbs
	if (g >= 2.5) bag.add('prop', tube([CANE.clone().add(v3(0, -0.25, 0)), CANE.clone().add(v3(0, CANE_TOP, 0))], (u) => 0.0075 * (1 - 0.3 * u), (u) => mix('#c8a865', '#d9c08a', Math.abs(Math.sin(u * 50)) < 0.07 ? 0 : 1), 8));
	const space = bag.space;
	space.rod([CANE.clone(), CANE.clone().add(v3(0, CANE_TOP, 0))], 0.012);

	const H = table(g, [[1.4, 0], [2, 0.03], [3, 0.2], [4, 0.75], [5, 1.65], [6, 2.15], [7, 2.32], [9, 2.4]]) * vigour;
	const vr = chance(seed, 'bean-vine');
	const phase = vr() * Math.PI * 2;
	const start = s.top.clone();
	/** the vine at height h: from the seedling over to the cane, then round and round it; over the top, leaning off */
	const vineAt = (/** @type {number} */ h) => {
		const to = clamp((h - 0.08) / 0.25);
		const e = to * to * (3 - 2 * to);
		const a = phase + h * TWIST;
		const ring = 0.0115 + 0.003 * Math.sin(h * 9 + phase);
		const over = Math.max(0, h - CANE_TOP + 0.02);
		return v3(lerp(start.x, CANE.x + Math.cos(a) * ring, e) + over * 0.6, start.y + Math.min(h, CANE_TOP - 0.02) + over * 0.4 - over * over * 2, lerp(start.z, CANE.z - Math.sin(a) * ring, e));
	};
	if (H < 0.002) return bag.build();
	const steps = Math.max(2, Math.ceil(H / 0.012));
	const pts = [];
	for (let k = 0; k <= steps; k++) pts.push(vineAt((k / steps) * H));
	bag.add('body', tube(pts, (u) => (0.0026 + 0.0018 * span(g, 3, 7)) * (1 - 0.6 * u) * vigour, (u) => mix('#5a7a34', '#8ab05a', u), 5));
	space.rod(pts, 0.004);

	/** @type {(() => void)[]} */
	const leaves = [];
	// the first pair: simple heart-shaped leaves, opposite, at the top of the first shoot
	const first = span(g, 1.6, 2.4);
	if (first > 0) {
		const p = vineAt(0.012);
		for (const side of [-1, 1]) {
			const out = v3(side, 0, 0.3).normalize();
			leaves.push(() => {
				const o = space.steer(p, out, 0.1, 0.09, 0.02);
				leaflet(bag, p, o, 0.085 * vigour * lerp(0.35, 1, first), lerp(0.25, 1.15, first), heartShape, 0.75, span(g, 6, 8) * 0.8);
			});
		}
	}
	// a node every so far up, a leaf of three at each, alternate; from the axils higher up, the flower sprays
	const nodes = 15;
	for (let n = 1; n < nodes; n++) {
		const h = 0.04 + n * 0.155;
		if (H < h + 0.01) break;
		const nr = chance(seed, 'bean-node', n);
		const p = vineAt(h);
		const radial = p.clone().sub(CANE).setY(0);
		if (radial.lengthSq() < 1e-8) radial.set(1, 0, 0);
		radial.normalize();
		const out = radial.clone().applyAxisAngle(v3(0, 1, 0), (n % 2 ? 0.6 : -0.6) + about(nr, 0, 0.25));
		const grown = clamp((H - h) / 0.3);
		const old = n < 4 ? span(g, 7.5 + n * 0.3, 9.6) : 0;
		leaves.push(() => trifoliate(bag, seed, ['leaf', n], p, out, 0.26 * vigour * about(nr, 1, 0.08), grown, old));
		if (n >= 3) raceme(bag, seed, n, p, out.clone().applyAxisAngle(v3(0, 1, 0), n % 2 ? -1.1 : 1.1), g, white, vigour, H - h);
	}
	for (const leaf of leaves) leaf();
	return bag.build();
}

/**
 * One leaflet (or a first simple leaf) from `at`, reaching out along `out` (level) at `tilt` from upright.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} out @param {number} len @param {number} tilt
 * @param {(u: number) => number} shape @param {number} wide @param {number} old
 */
function leaflet(bag, at, out, len, tilt, shape, wide, old) {
	const dir = out.clone().setY(0).normalize().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
	bag.add(
		'sheet',
		sheet({
			length: len,
			width: len * wide * 0.5,
			shape,
			lift: (u, v) => 0.05 * v * v - (0.1 + old * 0.15) * u * u,
			paint: (u, v) => mix('#3a7230', '#c8b84a', clamp(old * 1.2 - (1 - u) * 0.3)).lerp(new THREE.Color('#8ab868'), Math.abs(v) < 0.07 ? 0.35 : Math.abs(Math.sin(u * 9 - Math.abs(v) * 3)) > 0.95 ? 0.2 : 0),
			along: 9,
			across: 4
		}),
		aim(at, dir, 0)
	);
}

/**
 * A leaf of three on its long stalk from the node at `at`: the stalk out and up, the two side leaflets at its end, the
 * end one a little further on its own short stalk; folded and upright while young.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} at @param {THREE.Vector3} out
 * @param {number} size @param {number} grown @param {number} old
 */
function trifoliate(bag, seed, key, at, out, size, grown, old) {
	if (grown <= 0.02) return;
	const lr = chance(seed, 'trifoliate', ...key);
	const reach = size * lerp(0.3, 1, grown);
	const o = bag.space.steer(at, out, 0.45, reach, 0.03);
	const stalk = reach * 0.45;
	const d = o.clone().multiplyScalar(0.8).add(v3(0, lerp(1.6, 0.45, grown) - old * 0.4, 0)).normalize();
	const mid = at.clone().addScaledVector(d, stalk * 0.55).add(v3(0, stalk * 0.08, 0));
	const end = at.clone().addScaledVector(d, stalk);
	const tip = end.clone().addScaledVector(o, reach * 0.12).add(v3(0, reach * 0.02, 0));
	bag.add('body', tube([at, mid, end, tip], (u) => 0.0016 * (1 - 0.4 * u), () => mix('#6a9a42', '#b8a84a', old), 4));
	const len = 0.13 * size / 0.26 * lerp(0.3, 1, grown);
	const tilt = lerp(0.35, between(lr, 1.35, 1.6), grown) + old * 0.3;
	leaflet(bag, tip, o, len, tilt, leafletShape, 0.68, old);
	const across = v3(-o.z, 0, o.x);
	for (const side of [-1, 1]) leaflet(bag, end, across.clone().multiplyScalar(side).addScaledVector(o, 0.5), len * 0.85, tilt + 0.1, leafletShape, 0.62, old);
}

/**
 * A flower spray from the axil at `at`: its long stalk out from the vine, flowers along its end opening from the
 * bottom up, and a pod hanging behind each of the few that set.
 * @param {Bag} bag @param {string} seed @param {number} n @param {THREE.Vector3} at @param {THREE.Vector3} out
 * @param {number} g @param {boolean} white @param {number} vigour @param {number} above how far the tip has grown past the node
 */
function raceme(bag, seed, n, at, out, g, white, vigour, above) {
	const rr = chance(seed, 'raceme', n);
	// the lower sprays open first, a node once the vine has climbed well past it
	const opens = 4.6 + n * 0.12 + rr() * 0.2;
	if (g < opens - 0.5 || above < 0.35) return;
	const rise = span(g, opens - 0.5, opens);
	const len = 0.14 * vigour * lerp(0.3, 1, rise);
	const d = out.clone().setY(0).normalize().add(v3(0, 0.35, 0)).normalize();
	const pts = [at.clone(), at.clone().addScaledVector(d, len * 0.5), at.clone().addScaledVector(d, len).add(v3(0, -len * 0.08, 0))];
	bag.add('body', tube(pts, (u) => 0.0014 * (1 - 0.3 * u), () => '#6a9a42', 4));
	const flowers = 7;
	const keep = 1 + Math.floor(rr() * 3);
	for (let k = 0; k < flowers; k++) {
		const fr = chance(seed, 'bean-flower', n, k);
		const t = 0.55 + 0.45 * (k / (flowers - 1));
		const p = pts[1].clone().lerp(pts[2], (t - 0.5) * 2);
		const a = k * 2.39996;
		const side = v3(Math.cos(a), 0, Math.sin(a));
		const open = span(g, opens + k * 0.16, opens + k * 0.16 + 0.15);
		const fall = span(g, opens + k * 0.16 + 0.45, opens + k * 0.16 + 0.6);
		const sets = k < keep;
		const set = sets ? span(g, opens + k * 0.16 + 0.5, opens + k * 0.16 + 2.4) : 0;
		const ped = p.clone().addScaledVector(side, 0.008).add(v3(0, -0.004, 0));
		if (set < 0.02 && fall >= 1) continue;
		bag.add('body', tube([p, ped], () => 0.0007, () => '#6a9a42', 3));
		if (set < 0.02) {
			flower(bag, ped, side.clone().addScaledVector(d, 0.4).normalize(), white, open, fall);
			continue;
		}
		// the pod: hanging below its flower, long, flat, rough, its tip a little beak
		const L = (0.03 + 0.25 * set) * vigour * about(fr, 1, 0.08);
		const W = (0.002 + 0.0075 * set) * vigour;
		// a pod left on (the lowest sprays' first) swells lumpy and yellows
		const left = n < 6 && k === 0 ? span(g, 8.3, 9.4) : 0;
		const place = bag.space.settle(ped, v3(side.x * 0.2, -1, side.z * 0.2), (c, dd) => [0.15, 0.4, 0.65, 0.9].map((f) => ({ c: c.clone().addScaledVector(dd, L * f), r: W * 1.3 })), 0.03);
		bag.add('body', tube([p, ped, place.at], () => 0.0012, () => '#6a9a42', 3));
		const m = new THREE.Matrix4().compose(place.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), place.dir), v3(1, 1, 1));
		const bend = fr() < 0.5 ? -1 : 1;
		const axis = [];
		for (let q = 0; q <= 20; q++) {
			const u = q / 20;
			axis.push(v3(bend * L * 0.12 * u * u, -0.002 - u * L, 0));
		}
		const lumps = 5 + Math.floor(fr() * 3);
		bag.add(
			'body',
			tube(
				axis,
				(u, v) => W * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.03 + u * 0.99))), 0.3) * (u > 0.92 ? 1 - (u - 0.92) * 6 : 1) * (0.5 + 0.5 * Math.abs(Math.cos(v * Math.PI * 2))) * (1 + left * 0.35 * Math.pow(Math.abs(Math.sin(u * Math.PI * lumps)), 2)),
				(u, v) => mix(mix('#7ab04a', '#4a8a30', set), '#c8b860', left).lerp(new THREE.Color('#2f6a24'), Math.pow(Math.abs(Math.sin(u * 90 + v * 30)), 30) * 0.4),
				8
			),
			m
		);
	}
}

/**
 * A pea-like flower: the broad standard petal up behind, two wings either side, the keel curled between them, in a
 * little green calyx; opening, then dropping.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {boolean} white @param {number} open @param {number} fall
 */
function flower(bag, at, facing, white, open, fall) {
	const f = facing.clone().setY(0).normalize();
	bag.add('body', bead(at, v3(0.003, 0.003, 0.003), '#5f8a3a', 3));
	if (fall >= 1) return;
	const size = lerp(0.45, 1, open) * (1 - fall * 0.3);
	const colour = white ? '#f6f4ea' : mix('#e8403a', '#d82018', open);
	const keel = white ? '#ecece0' : '#c81e1e';
	if (open < 0.05) {
		bag.add('body', bead(at.clone().addScaledVector(f, 0.004), v3(0.003, 0.004, 0.003).multiplyScalar(size), mix(colour, '#8aa860', 0.4), 3));
		return;
	}
	// the standard: up and bent back
	const up = f.clone().multiplyScalar(-0.3).add(v3(0, 1, 0)).normalize().lerp(v3(0, -1, 0), fall * 0.5);
	bag.add('sheet', sheet({ length: 0.013 * size, width: 0.008 * size, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6), lift: (u, v) => -0.15 * v * v + 0.08 * u, paint: (u) => mix(colour, white ? '#fffff8' : '#f05a3a', u * 0.3), along: 4, across: 3 }), aim(at.clone().add(v3(0, 0.002, 0)), up, Math.PI / 2));
	// the wings and the keel
	const across = v3(-f.z, 0, f.x);
	for (const s of [-1, 1]) bag.add('sheet', sheet({ length: 0.01 * size, width: 0.0035 * size, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.7)), paint: () => colour, along: 3, across: 2 }), aim(at, f.clone().addScaledVector(across, s * 0.5).add(v3(0, -0.15 - fall, 0)).normalize(), s * 0.6));
	bag.add('body', bead(at.clone().addScaledVector(f, 0.006 * size).add(v3(0, -0.001, 0)), v3(0.0055, 0.0025, 0.0025).multiplyScalar(size), keel, 3, new THREE.Quaternion().setFromUnitVectors(v3(1, 0, 0), f)));
}
