/*
 * MANGO — Mangifera indica, from its seed: the flat fibrous stone, ten centimetres long, laid flat a few centimetres
 * down. Its seed leaves stay inside the stone (hypogeal): a hooked shoot comes up out of it and a taproot dives
 * deep. The leaves come in flushes at the shoot tips — limp and bronze-red when new, then pale, then dark glossy green
 * and leathery, long and narrow, clustered at the ends of the twigs. The seedling grows into a tree with a dense
 * domed crown; after some years it flowers in big upright panicles at its branch tips, thousands of small pink-cream
 * flowers; few set fruit, one or two to a panicle, hanging on the long stalks as they swell — green, then golden with
 * a red blush on their sunny side.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { limb } from './tree.js';

export const STAGES = [
	{ name: 'Stone', day: 0, note: 'The flat fibrous stone, ten centimetres long, laid flat a few centimetres down, kept warm and moist.' },
	{ name: 'Germination', day: 14, note: 'A taproot dives; a hooked shoot comes up out of the stone — its seed leaves stay inside, feeding it.' },
	{ name: 'Seedling', day: 35, note: 'A flush of limp bronze-red leaves at the shoot’s tip, greening as they firm.' },
	{ name: 'Sapling', day: 365, note: 'Half a metre, flush after flush of long narrow leaves clustered at its tip.' },
	{ name: 'Young tree', day: 1100, note: 'Branching into a crown, two metres; the taproot metres deep.' },
	{ name: 'Flowering', day: 2000, note: 'A domed tree; upright panicles of tiny pink-cream flowers at the branch tips, humming with insects.' },
	{ name: 'Fruit set', day: 2030, note: 'Most flowers fall; one or two small green fruit hold on each panicle.' },
	{ name: 'Green fruit', day: 2080, note: 'Mangoes swelling on their long dangling stalks, green and hard.' },
	{ name: 'Colouring', day: 2120, note: 'They turn from green to gold, the sunny side blushing red.' },
	{ name: 'Ripe', day: 2140, note: 'Ripe mangoes, golden and red, fragrant at the stalk: picking time.' }
];

const STONE_AT = v3(0, -0.04, 0);

/**
 * The mango at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function mango(g, seed) {
	const bag = new Bag();
	const r = chance(seed, 'plant');
	const vigour = about(r, 1, 0.08);

	// the stone stays below, its seed leaves inside it; the shoot hooks up out of it
	const s = sprout(bag, {
		seed,
		at: STONE_AT,
		size: v3(0.05, 0.013, 0.026),
		coat: '#d9c49a',
		coatShade: '#8a7350',
		stem: table(g, [[0, 0], [0.3, 0.004], [1, 0.07], [2, 0.09], [9, 0.09]]),
		hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.0025 + 0.004 * span(g, 1, 3),
		stemColor: '#8a5a3a',
		leaf: { length: 0.001, width: 0.0005, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
		open: 0,
		shed: span(g, 3.5, 4.5),
		wither: 1,
		keepCoat: true
	});

	// the taproot, deep, and the feeder roots spreading near the surface
	root(bag, { seed, key: ['taproot'], from: STONE_AT.clone(), dir: v3(0.02, -1, 0.01), length: 2.4, grown: table(g, [[0, 0], [0.3, 0.003], [1, 0.02], [2, 0.05], [3, 0.16], [4, 0.45], [5, 0.75], [6, 0.9], [8, 1]]), radius: 0.003 + 0.06 * span(g, 2, 8), down: 0.03, wander: 0.1, laterals: 12, lateral: 0.35, depth: 2, age: span(g, 1.5, 6), young: '#f3e6cc', old: '#7a5838' });
	for (let i = 0; i < 18; i++) {
		const rr = chance(seed, 'feeder', i);
		const born = 3 + i * 0.16;
		const bear = i * 2.39996 + rr() * 0.4;
		root(bag, { seed, key: ['feeder', i], from: STONE_AT.clone().add(v3(0, -0.05 - rr() * 0.15, 0)), dir: v3(Math.cos(bear), -0.12, Math.sin(bear)), length: between(rr, 1.6, 3) * vigour, grown: (g - born) / 2.8, radius: 0.004 + 0.022 * span(g, 3, 8), down: 0.008, wander: 0.14, laterals: 6, lateral: 0.25, depth: 2, age: (g - born - 0.6) / 2.5, young: '#efdcb8', old: '#6e5032' });
	}

	// the tree: a leader and its limbs, as far as it has grown
	/** @type {import('./tree.js').Limb[]} */
	const limbs = [];
	limb(bag, {
		seed,
		key: ['trunk'],
		from: s.top.clone(),
		dir: v3(0, 1, 0),
		length: 2.4 * vigour,
		grown: table(g, [[1, 0], [2, 0.04], [3, 0.3], [4, 0.9], [5, 1.8], [6, 2.4], [7, 2.75], [8, 2.95], [9, 3.1]]),
		radius: 0.15,
		up: 0.022,
		wander: 0.08,
		spread: 1.1,
		children: 3,
		shorten: [0.55, 0.78],
		depth: 4,
		from0: 0.4,
		young: '#6f7a44',
		old: '#4e4238',
		age: span(g, 2.5, 7),
		out: limbs,
		sides: 10
	});

	for (const l of limbs) {
		// the leaves: a whorl at each twig's tip, a few along the outer twigs
		if (l.end) rosette(bag, seed, l, g, 15);
		if (l.order >= 3 && l.pts.length > 2) {
			const { p } = at(l.pts, 0.5);
			rosette(bag, seed, { ...l, tip: p, key: [...l.key, 'mid'] }, g, 9);
		}
		// the panicles, then the fruit, at most twig tips once the tree is old enough
		if (l.end && l.order >= 2) panicle(bag, seed, l, g, vigour);
	}
	return bag.build();
}

/** a point along a path at u (0 … 1 of its length) */
function at(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
	return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize() };
}

/**
 * A whorl of mango leaves: long, narrow, pointed, leathery, hanging from short stalks; a new flush limp and bronze-red,
 * an old one dark and glossy.
 * @param {Bag} bag @param {string} seed @param {import('./tree.js').Limb} l @param {number} g @param {number} count
 */
function rosette(bag, seed, l, g, count) {
	const lr = chance(seed, 'whorl', ...l.key);
	// how old this flush is: a twig still growing carries a young one
	const flush = clamp(l.grown * 1.4 - 0.3 + (g - 4) * 0.15);
	for (let k = 0; k < count; k++) {
		const bear = k * 2.39996 + lr() * 0.6;
		const out = v3(Math.cos(bear), 0, Math.sin(bear)).addScaledVector(l.dir, 0.6).normalize();
		const droop = lerp(-1.1, between(lr, -0.5, 0.1), flush);
		const dir = out.clone().setY(0).normalize().multiplyScalar(Math.cos(droop)).add(v3(0, Math.sin(droop), 0)).normalize();
		const len = between(lr, 0.22, 0.32) * lerp(0.55, 1, flush) * lerp(0.6, 1, clamp(g - 2));
		const colour = flush < 0.35 ? mix('#9a3f2e', '#b8a05a', flush / 0.35) : mix('#8fae5a', '#24502a', (flush - 0.35) / 0.65);
		bag.add(
			'sheet',
			sheet({
				length: len,
				width: len * 0.12,
				shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.65) * (u < 0.08 ? u / 0.08 : 1),
				lift: (u, v) => 0.05 * v * v - 0.06 * u * u,
				paint: (u, v) => colour.clone().lerp(new THREE.Color('#d8d8a0'), Math.abs(v) < 0.1 ? 0.35 : 0),
				along: 10,
				across: 4
			}),
			aim(l.tip.clone().addScaledVector(dir, 0.015), dir, (lr() - 0.5) * 0.6)
		);
	}
}

/**
 * A panicle at a twig's tip: an upright cone of branched reddish stalks crowded with tiny pink-cream flowers; then
 * the one or two fruit it keeps, hanging on its long stalk, swelling and colouring.
 * @param {Bag} bag @param {string} seed @param {import('./tree.js').Limb} l @param {number} g @param {number} vigour
 */
function panicle(bag, seed, l, g, vigour) {
	const pr = chance(seed, 'panicle', ...l.key);
	if (pr() > 0.75) return;
	const opens = 4.7 + pr() * 0.5;
	const phase = g - opens;
	if (phase < -0.2) return;
	const set = phase > 0.6;
	const len = 0.3 * lerp(0.3, 1, clamp((phase + 0.2) / 0.4));
	const up = l.dir.clone().lerp(v3(0, 1, 0), 0.6).normalize();
	if (!set) {
		const tip = l.tip.clone().addScaledVector(up, len);
		bag.add('body', tube([l.tip, tip], (u) => 0.005 * (1 - 0.8 * u), () => '#b0473a', 5));
		const branches = 12;
		for (let k = 0; k < branches; k++) {
			const u = 0.1 + (k / branches) * 0.85;
			const base = l.tip.clone().lerp(tip, u);
			const a = k * 2.39996;
			const side = v3(Math.cos(a), 0.4, Math.sin(a)).normalize();
			const reach = 0.09 * (1 - u) + 0.02;
			const end = base.clone().addScaledVector(side, reach);
			bag.add('body', tube([base, end], () => 0.0015, () => '#b0473a', 3));
			for (let m = 0; m < 4; m++) bag.add('body', bead(base.clone().lerp(end, 0.35 + m * 0.2), v3(0.004, 0.004, 0.004), m % 2 ? '#f0d7a0' : '#e7a29a', 2));
		}
		return;
	}
	// set: the panicle's stalk dries, bends under its fruit and hangs
	const grown = span(phase, 0.6, 2.4);
	const fruits = pr() < 0.4 ? 2 : 1;
	for (let k = 0; k < fruits; k++) {
		const fr = chance(seed, 'mango', ...l.key, k);
		const stalk = between(fr, 0.15, 0.3);
		const swing = v3(Math.cos(k * 2.5 + fr() * 3), 0, Math.sin(k * 2.5 + fr() * 3)).multiplyScalar(0.25);
		const mid = l.tip.clone().addScaledVector(up, 0.06).add(swing.clone().multiplyScalar(0.1));
		const end = mid.clone().add(swing.clone().multiplyScalar(0.3)).add(v3(0, -stalk * lerp(0.4, 1, grown), 0));
		bag.add('body', tube([l.tip, mid, end], () => 0.002 + 0.0015 * grown, () => '#6f6a3a', 4));
		fruit(bag, { seed, key: [...l.key, k], at: end, size: vigour * about(fr, 1, 0.1) * lerp(0.15, 1, grown), ripe: span(phase, 2.6, 3.9), sun: fr() * Math.PI * 2 });
	}
}

/**
 * A mango: an ovoid a little flattened and bent, a beak toward its end; green, then gold from the bottom up, a red blush
 * on the side toward the sun.
 * @param {Bag} bag
 * @param {{ seed: string, key: (string | number)[], at: THREE.Vector3, size: number, ripe: number, sun: number }} o
 */
function fruit(bag, o) {
	const fr = chance(o.seed, 'mango-shape', ...o.key);
	const L = 0.13 * o.size;
	const R = L * between(fr, 0.36, 0.42);
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), o.sun), v3(1, 1, 0.82));
	const axis = [];
	for (let k = 0; k <= 16; k++) {
		const u = k / 16;
		axis.push(v3(0.12 * L * Math.sin(u * Math.PI) + 0.06 * L * u * u, -0.003 - u * L, 0));
	}
	const radius = (/** @type {number} */ u) => R * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.55) * (1 - 0.15 * u);
	bag.add(
		'gloss',
		tube(
			axis,
			radius,
			(u, v) => {
				const gold = clamp(o.ripe * 1.4 - (1 - u) * 0.4);
				const base = gold < 0.5 ? mix('#5f9a3a', '#c9c24a', gold * 2) : mix('#c9c24a', '#f2b632', (gold - 0.5) * 2);
				const blush = Math.max(0, Math.cos(v * Math.PI * 2)) * clamp(o.ripe * 1.2) * (0.4 + 0.6 * (1 - u));
				return base.lerp(new THREE.Color('#d6452e'), blush * 0.85);
			},
			16
		),
		m
	);
}
