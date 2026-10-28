/*
 * RASPBERRY — Rubus idaeus, the Himbeere, a summer-fruiting raspberry from one seed: brown, pitted, two and a half
 * millimetres long. Small round seed leaves, then a first cane (the primocane) a metre tall in its first summer, green
 * flushed red, set with fine prickles, a compound leaf at each node — five toothed leaflets low down, three toward the
 * top, dark green. It drops its leaves for the winter; in its second spring it is a brown floricane, and from its upper
 * buds grow side shoots with a few leaves each and clusters of small white flowers, their sepals bent back. Each flower
 * becomes a raspberry: a thimble of drupelets on a white core, green, then pale, pink, red. Meanwhile new green
 * primocanes rise from the crown and a sucker comes up from a root. Below: shallow, wide-spreading woody roots.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, about, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { bloom } from './bloom.js';
import { pinnate } from './leaves.js';

export const STAGES = [
	{ name: 'Seed', day: 0, note: 'A brown pitted seed two and a half millimetres long, chilled through the winter, a few millimetres down.' },
	{ name: 'Germination', day: 25, note: 'The radicle goes down, the hypocotyl hooks up toward the light.' },
	{ name: 'Seed leaves', day: 35, note: 'Two small round cotyledons on a short stem.' },
	{ name: 'True leaves', day: 55, note: 'The first toothed leaves, three leaflets each, white-felted beneath.' },
	{ name: 'First cane', day: 150, note: 'The primocane: a metre of green, red-flushed cane, prickly, five-leafleted leaves all the way up.' },
	{ name: 'Flowering', day: 420, note: 'Its second spring: the cane gone brown sends out side shoots with small white flowers; new canes rise beside it.' },
	{ name: 'Fruit set', day: 435, note: 'The petals drop; each flower’s pistils swell into a little green cluster of drupelets.' },
	{ name: 'Green berries', day: 450, note: 'Hard green berries hang in clusters from the side shoots.' },
	{ name: 'Turning', day: 460, note: 'The berries pale, then blush pink; the first ones deepen to red.' },
	{ name: 'Ripe', day: 470, note: 'Clusters of soft red raspberries, ready to slip off their white cores.' }
];

const SEED_AT = v3(0, -0.004, 0);

/** the raspberry's leaflet: ovate, drawn to a point, doubly toothed */
function leafletShape(/** @type {number} */ u) {
	const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.8) * (1 - 0.15 * u);
	const teeth = u > 0.08 && u < 0.96 ? ((u * 17) % 1) * 0.07 + ((u * 8.5) % 1) * 0.05 : 0;
	return body * (1 + teeth);
}
const LEAFLET = { length: 0.07, width: 0.03, shape: leafletShape, colour: '#355f2a', young: '#6aa04a', vein: '#7ea661', old: '#c9a640' };

/**
 * The raspberry at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function raspberry(g, seed) {
	const bag = new Bag();
	const r = chance(seed, 'plant');
	const vigour = about(r, 1, 0.1);

	const s = sprout(bag, {
		seed,
		at: SEED_AT,
		size: v3(0.0013, 0.0008, 0.0009),
		coat: '#8a5a3a',
		coatShade: '#5f3e28',
		stem: table(g, [[0, 0], [0.35, 0.0006], [1, 0.0065], [2, 0.014], [3, 0.016], [4, 0.006], [9, 0.006]]),
		hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.0005 + 0.003 * span(g, 2.5, 4.5),
		stemColor: '#87a04a',
		leaf: { length: 0.007, width: 0.0032, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.7), color: '#5c9a3b', vein: '#9cc46e' },
		open: span(g, 1.15, 2),
		shed: span(g, 1, 1.7),
		wither: span(g, 3.3, 4)
	});
	const crown = s.top.clone();

	// the roots: shallow, wide and woody, a few going deep
	root(bag, { seed, key: ['radicle'], from: SEED_AT.clone(), dir: v3(0.04, -1, 0), length: 0.35, grown: table(g, [[0, 0], [0.4, 0.004], [1, 0.03], [2, 0.08], [3, 0.2], [4, 0.6], [5, 0.85], [7, 1]]), radius: 0.0016, down: 0.04, wander: 0.18, laterals: 8, lateral: 0.3, depth: 2, age: span(g, 2.5, 6), young: '#f3ead2', old: '#8a5f3c' });
	const spread = [];
	for (let i = 0; i < 16; i++) {
		const rr = chance(seed, 'spread', i);
		const born = 2.6 + i * 0.16;
		const bear = i * 2.39996 + rr() * 0.4;
		const dir = v3(Math.cos(bear), -0.18, Math.sin(bear));
		const length = between(rr, 0.2, 0.42) * vigour;
		spread.push({ bear, dir, length, born });
		root(bag, { seed, key: ['spread', i], from: crown.clone().add(v3(0, -0.012, 0)), dir, length, grown: (g - born) / 2.8, radius: 0.0018, down: 0.012, wander: 0.22, laterals: 6, lateral: 0.3, depth: 2, age: (g - born - 0.6) / 2, young: '#f1e6cc', old: '#7a5232' });
	}

	// the canes: the first, then (its second spring) new ones from the crown, and a sucker from a root
	const canes = [
		{ from: crown, born: 2.2, bear: r() * Math.PI * 2, first: true },
		{ from: crown.clone().add(v3(0.012, 0, 0.006)), born: 4.75, bear: r() * Math.PI * 2, first: false },
		{ from: crown.clone().add(v3(-0.008, 0, 0.012)), born: 5.1, bear: r() * Math.PI * 2, first: false }
	];
	// the sucker: where a spreading root runs a hand and a half out
	const sr = spread[Math.floor(r() * 4)];
	const out = v3(Math.cos(sr.bear), 0, Math.sin(sr.bear));
	canes.push({ from: out.multiplyScalar(Math.min(0.16, sr.length * 0.6)).setY(0), born: 5.5, bear: sr.bear, first: false });
	canes.forEach((c, j) => cane(bag, seed, j, c, g, vigour));
	return bag.build();
}

/**
 * A cane and all it bears. The first lives two summers: green and leafy, then (after the winter) brown and bare but for
 * the side shoots that flower and fruit. The later ones are this year's green primocanes.
 * @param {Bag} bag @param {string} seed @param {number} j
 * @param {{ from: THREE.Vector3, born: number, bear: number, first: boolean }} c
 * @param {number} g @param {number} vigour
 */
function cane(bag, seed, j, c, g, vigour) {
	if (g <= c.born) return;
	const cr = chance(seed, 'cane', j);
	const full = (c.first ? 1.15 : between(cr, 0.75, 1.0)) * vigour;
	const L = c.first ? table(g, [[2.2, 0], [3, 0.05], [4, full * 0.9], [4.6, full]]) : full * span(g, c.born, c.born + 3.2);
	if (L < 0.002) return;
	// up, leaning a little, arching over at the top as it lengthens
	const lean = between(cr, 0.06, 0.2);
	const out = v3(Math.cos(c.bear), 0, Math.sin(c.bear));
	const steps = 24;
	/** @type {THREE.Vector3[]} */
	const pts = [];
	let p = c.from.clone();
	for (let k = 0; k <= steps; k++) {
		pts.push(p.clone());
		const s = (k / steps) * full;
		const arch = Math.max(0, s - 0.55) * 1.6;
		const d = out.clone().multiplyScalar(Math.sin(lean + arch)).add(v3(0, Math.cos(lean + arch), 0)).normalize();
		p = p.clone().addScaledVector(d, full / steps);
	}
	const n = Math.min(steps, (L / full) * steps);
	const whole = Math.floor(n);
	const now = pts.slice(0, whole + 1);
	if (whole < steps) now.push(pts[whole].clone().lerp(pts[whole + 1], n - whole));
	if (now.length < 2) return;
	// its second year: the first cane browns over the winter
	const winter = c.first ? span(g, 4.3, 4.7) : 0;
	const thick = (0.0018 + 0.0042 * clamp(L / full)) * (c.first ? 1 : 0.9);
	bag.add('body', tube(now, (u) => thick * (1 - 0.6 * u), (u) => mix(mix('#7f9e4a', '#9a5a4a', 0.35 + 0.3 * Math.sin(u * 9)), '#8a6a4c', winter), 7));
	const at = (/** @type {number} */ s) => {
		const f = Math.min(steps - 0.001, (s / full) * steps), k = Math.floor(f);
		return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize() };
	};
	// its prickles: fine, many, reddish
	const pr = chance(seed, 'prickles', j);
	const prickles = Math.floor(L * 60);
	for (let k = 0; k < prickles; k++) {
		const s = pr() * L;
		const { p: q, d } = at(s);
		const a = pr() * Math.PI * 2;
		const side = new THREE.Vector3().crossVectors(d, v3(0, 1, 0));
		if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
		side.normalize();
		const radial = side.applyAxisAngle(d, a);
		const w = thick * (1 - 0.6 * (s / L));
		bag.add('body', bead(q.clone().addScaledVector(radial, w), v3(0.0004, 0.0004, 0.0004).addScaledVector(radial.clone().set(Math.abs(radial.x), Math.abs(radial.y), Math.abs(radial.z)), 0.0007), winter > 0.5 ? '#6a4a3a' : '#8c3f4a', 2));
	}
	// its nodes: a leaf at each (the first cane's fall in the winter), and on the second year's cane the side shoots
	let s = 0.05;
	for (let i = 0; i < 18; i++) {
		const nr = chance(seed, 'node', j, i);
		s += i === 0 ? 0 : between(nr, 0.055, 0.075) * full;
		if (s >= L - 0.01) break;
		const { p: q } = at(s);
		const bear = c.bear + i * 2.4 + about(nr, 0, 0.3);
		const leafOut = v3(Math.cos(bear), 0, Math.sin(bear));
		const past = L - s;
		const high = s / full;
		const fall = c.first ? span(g, 4.25 + nr() * 0.2, 4.5 + nr() * 0.2) : 0;
		if (fall < 1) {
			const size = lerp(0.55, 1, clamp(i / 3)) * (1 - 0.35 * high) * about(nr, 1, 0.1) * vigour;
			pinnate(bag, { seed, key: ['leaf', j, i], at: q, out: leafOut, lift: between(nr, 0.35, 0.7), length: 0.13 * size, pairs: high > 0.7 || i < 1 ? 1 : 2, leaflet: { ...LEAFLET, length: LEAFLET.length * size, width: LEAFLET.width * size }, grown: clamp(past / 0.12), old: fall * 1.4, stalk: '#7f9a48', radius: 0.0011, terminal: 1.2 });
		}
		if (c.first && high > 0.3 && i % 2 === 0) shoot(bag, seed, i, q, leafOut, g, vigour, high);
	}
	if (L < full * 0.999 && !winter) bag.add('body', bead(now[now.length - 1], v3(1, 1.4, 1).multiplyScalar(0.003), '#9bbf6a'));
}

/** a raspberry flower: five small white petals, its sepals bent right back, a green cushion of pistils in a ring of stamens */
const FLOWER = { petals: 5, length: 0.0065, width: 0.0028, colour: '#f4f1e6', heart: '#cfd38a', stamens: 30, stamenColour: '#efe2b0', sepals: 5, sepal: 0.009, sepalBack: 1.1, sepalColour: '#6f9a48', shape: (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.7) };

/**
 * A side shoot from a bud of the second year's cane: a few trifoliate leaves, and at its end and in its upper leaf
 * axils the flowers, then the berries, hanging.
 * @param {Bag} bag @param {string} seed @param {number} i @param {THREE.Vector3} at @param {THREE.Vector3} out
 * @param {number} g @param {number} vigour @param {number} high how far up the cane (0 … 1)
 */
function shoot(bag, seed, i, at, out, g, vigour, high) {
	const sr = chance(seed, 'shoot', i);
	const born = 4.55 + (1 - high) * 0.25 + sr() * 0.1;
	if (g <= born) return;
	const grown = clamp((g - born) / 0.6);
	const heavy = span(g, born + 1.4, born + 3);
	const len = between(sr, 0.12, 0.24) * vigour * lerp(0.2, 1, grown);
	let d = out.clone().multiplyScalar(0.75).add(v3(0, 0.65 - heavy * 0.5, 0)).normalize();
	let p = at.clone();
	/** @type {THREE.Vector3[]} */
	const pts = [];
	for (let k = 0; k <= 8; k++) {
		pts.push(p.clone());
		d = d.clone().addScaledVector(out, 0.04).add(v3(0, -0.03 - heavy * 0.05, 0)).normalize();
		p = p.clone().addScaledVector(d, len / 8);
	}
	bag.add('body', tube(pts, (u) => 0.0016 * (1 - 0.5 * u), () => '#7f9a48', 5));
	for (let k = 0; k < 3; k++) {
		const u = 0.25 + k * 0.28;
		const q = pts[Math.round(u * 8)];
		const turn = (k % 2 ? 1 : -1) * 1.2 + sr() * 0.4;
		const lo = out.clone().applyAxisAngle(v3(0, 1, 0), turn);
		pinnate(bag, { seed, key: ['shoot-leaf', i, k], at: q, out: lo, lift: 0.5, length: 0.08 * vigour, pairs: 1, leaflet: { ...LEAFLET, length: 0.05, width: 0.022 }, grown: clamp((g - born - k * 0.12) / 0.5), stalk: '#7f9a48', radius: 0.0009, terminal: 1.15 });
	}
	// the cluster at its end, and one or two in the axils below it
	const end = pts[8];
	const flowers = 3 + Math.floor(sr() * 4);
	for (let k = 0; k < flowers; k++) {
		const fr = chance(seed, 'rasp-flower', i, k);
		const opens = born + 0.3 + k * 0.08 + fr() * 0.06;
		const base = k < flowers - 2 ? end : pts[5 + (k % 2)];
		const pd = d.clone().applyAxisAngle(v3(0, 1, 0), (k / flowers) * Math.PI * 2).add(v3(0, -0.4, 0)).normalize();
		const set = span(g, opens + 0.45, opens + 1.8);
		const hang = clamp(set * 1.3);
		const stalk = pd.clone().lerp(v3(0, -1, 0), hang * 0.5).normalize();
		const tip = base.clone().addScaledVector(stalk, 0.02 * lerp(0.3, 1, clamp((g - born) / 0.5)));
		const dir = stalk.clone().lerp(v3(0, -1, 0), 0.6).normalize();
		// once set, one raspberry, picked with its own stalk
		const fruiting = g >= opens && set >= 0.03;
		if (fruiting) bag.fruit([i, k], base, dir);
		bag.add('body', tube([base, tip], () => 0.0006, () => '#7f9a48', 4));
		if (g < opens) {
			const b = clamp((g - born) / Math.max(0.05, opens - born));
			bag.add('body', bead(tip.clone().addScaledVector(stalk, 0.002), v3(1, 1, 1).multiplyScalar(0.0015 + 0.002 * b), mix('#7fae4a', '#e0e3c0', b * 0.5)));
		} else if (set < 0.03) {
			bloom(bag, FLOWER, tip, stalk.clone().lerp(v3(0, 1, 0), 0.2).normalize(), 1, clamp((g - opens) / 0.2), span(g, opens + 0.3, opens + 0.45));
		} else {
			berry(bag, { seed, key: [i, k], at: tip, dir, size: vigour * about(fr, 1, 0.12), set, ripe: span(g, opens + 2.2, opens + 3.0) });
			bag.fruitDone();
		}
	}
}

/**
 * A raspberry: a thimble of drupelets — each a little glossy bead round a seed — on a white core, its calyx bent back
 * above it. Green and small, then pale, pink, red, and deep red when ripe.
 * @param {Bag} bag
 * @param {{ seed: string, key: (string | number)[], at: THREE.Vector3, dir: THREE.Vector3, size: number, set: number, ripe: number }} o
 */
function berry(bag, o) {
	const br = chance(o.seed, 'rasp', ...o.key);
	const H = 0.02 * o.size * lerp(0.25, 1, o.set);
	const R = H * between(br, 0.48, 0.56);
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir), v3(1, 1, 1));
	// the thimble's outline: broad under the calyx, rounding to a blunt tip
	const radius = (/** @type {number} */ u) => R * Math.pow(Math.max(0, 1 - Math.pow(u, 2.4)), 0.55) * (0.85 + 0.15 * Math.sin(Math.PI * Math.min(1, u + 0.3)));
	const colour = mix(o.ripe < 0.35 ? mix('#93b84e', '#e7d3a6', o.ripe / 0.35) : o.ripe < 0.7 ? mix('#e7d3a6', '#e0607a', (o.ripe - 0.35) / 0.35) : mix('#e0607a', '#b3122f', (o.ripe - 0.7) / 0.3), '#a00e2a', clamp(o.ripe - 0.95) * 10);
	// a core beneath, so no gap shows between the drupelets
	const core = [];
	for (let k = 0; k <= 10; k++) core.push(v3(0, -0.0015 - (k / 10) * H, 0));
	bag.add('gloss', tube(core, (u) => radius(u) * 0.86, () => colour.clone().multiplyScalar(0.8), 10), m);
	const rows = 7;
	const drupe = R * 0.33;
	for (let k = 0; k < rows; k++) {
		const u = (k + 0.5) / rows;
		const ring = Math.max(1, Math.round((2 * Math.PI * radius(u)) / (drupe * 1.7)));
		for (let q = 0; q < ring; q++) {
			const a = (q / ring) * Math.PI * 2 + k * 0.6 + br() * 0.2;
			const rad = radius(u) * 0.92;
			const c = colour.clone().multiplyScalar(0.92 + br() * 0.16);
			bag.add('gloss', bead(v3(Math.cos(a) * rad, -0.0015 - u * H, Math.sin(a) * rad), v3(drupe, drupe * 1.1, drupe), c, 4), m);
		}
	}
	bag.add('gloss', bead(v3(0, -0.0015 - H, 0), v3(drupe, drupe, drupe), colour, 4), m);
	for (let k = 0; k < 5; k++) {
		const sepal = sheet({ length: 0.009 * o.size, width: 0.0022 * o.size, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.6)) * (1 - u * 0.5), lift: (u) => 0.25 * u + 0.3 * u * u, paint: () => '#6f9a48', along: 6, across: 2 });
		bag.add('sheet', sepal, m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 5) * Math.PI * 2)).multiply(new THREE.Matrix4().makeRotationZ(0.3)));
	}
}
