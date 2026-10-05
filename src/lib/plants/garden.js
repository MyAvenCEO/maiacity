/*
 * GARDEN — the bell pepper (Paprika), the pumpkin (Kürbis, a Hokkaido) and the highbush blueberry (Blaubeere).
 *
 * The pepper forks and forks again into a little bush, a single white flower nodding in every fork; each sets a blocky
 * bell of three or four lobes that hangs, green, then darkens and turns red. The pumpkin runs: a hairy vine along the
 * ground, rooting at its nodes, huge lobed leaves standing up on their stalks, tendrils, big yellow trumpets — the
 * female ones on a little round ovary — and a few pumpkins lying on the soil, ribbed, green turning deep orange. The
 * blueberry is a shrub of many canes from its crown, twiggy, small leaves; white urn-shaped bells in hanging clusters,
 * then berries green, pink, then blue under a pale bloom.
 */
import * as THREE from 'three';
import { Bag, Space, about, aim, bead, between, chance, clamp, fan, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { bloom } from './bloom.js';
import { limb } from './tree.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/** a point along a path at u (0 … 1) */
function along(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
	return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize() };
}

/* ------------------------------------------------------------------------------------------------ pepper */

export const PEPPER_STAGES = stages([
	['Seed', 0, 'A flat round pale seed, half a centimetre down in warm soil: peppers want 25 °C to sprout.'],
	['Germination', 9, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 16, 'Two long narrow seed leaves.'],
	['True leaves', 35, 'Glossy, pointed, dark green true leaves.'],
	['Forking', 60, 'The stem forks, and forks again, into a little bush.'],
	['Flowering', 75, 'A single small white flower nods in every fork.'],
	['Fruit set', 85, 'The petals fall; a little green bell swells behind each.'],
	['Green peppers', 100, 'Blocky green bells, three or four lobes, hanging heavy.'],
	['Colouring', 120, 'They darken, then turn: chocolate, then red.'],
	['Ripe', 135, 'Glossy red peppers, thick-walled and sweet.']
]);

const PEPPER_FLOWER = { petals: 6, length: 0.011, width: 0.0045, colour: '#f6f4ea', heart: '#d8c860', sepals: 6, sepal: 0.004, stamens: 6, stamenColour: '#8a7ab8', flat: 0.3 };

/** @param {number} g @param {string} seed */
export function pepper(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.1);
	const at = v3(0, -0.006, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0018, 0.0005, 0.0017), coat: '#ecdcae', coatShade: '#c8b47e',
		stem: table(g, [[0, 0], [0.3, 0.0008], [1, 0.01], [2, 0.03], [9, 0.032]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.001 + 0.004 * span(g, 2, 6), stemColor: '#5f8a3a',
		leaf: { length: 0.024, width: 0.0055, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.7), color: '#4f8a35', vein: '#9cc277' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.6), wither: span(g, 4.4, 5.4)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.35, grown: table(g, [[0, 0], [0.3, 0.006], [1, 0.05], [3, 0.35], [6, 1]]), radius: 0.002, down: 0.04, wander: 0.15, laterals: 0, depth: 0, age: span(g, 2, 6), young: '#f6efdc', old: '#c4a37a' });
	const lr0 = chance(seed, 'laterals');
	for (let i = 0; i < 22; i++) {
		const a = i * 2.39996;
		root(bag, { seed, key: ['lat', i], from: at.clone().add(v3(0, -0.005 - i * 0.01, 0)), dir: v3(Math.cos(a), -0.4, Math.sin(a)), length: between(lr0, 0.1, 0.24), grown: (g - 1.3 - i * 0.15) / 2.5, radius: 0.001, down: 0.05, wander: 0.3, laterals: 6, lateral: 0.3, depth: 2, age: (g - 2.5 - i * 0.15) / 3, young: '#f6efdc', old: '#c0a078' });
	}
	/** @type {import('./tree.js').Limb[]} */
	const limbs = [];
	limb(bag, { seed, key: ['stem'], from: s.top.clone(), dir: v3(0, 1, 0), length: 0.25 * vigour, grown: table(g, [[2, 0], [3, 0.3], [4, 0.9], [5, 1.6], [6, 2.2], [7, 2.6], [9, 2.8]]), radius: 0.008, up: 0.04, wander: 0.08, spread: 0.55, children: 2, shorten: [0.8, 0.95], depth: 3, from0: 0.95, young: '#6f9a42', old: '#5a7a3a', age: span(g, 4, 8), out: limbs });
	const space = new Space();
	for (const l of limbs) space.rod(l.pts, 0.006);
	/** @type {(() => void)[]} */
	const leaves = [];
	for (const l of limbs) {
		const lr = chance(seed, 'pepper-leaves', ...l.key);
		const n = Math.floor(l.length / 0.05);
		for (let k = 0; k < Math.min(n, 6); k++) {
			const { p } = along(l.pts, (k + 0.6) / Math.max(1, n));
			const bear = k * 2.39996 + lr() * 0.5;
			const size = about(lr, 1, 0.12) * vigour;
			const grown = clamp((l.length - (k + 0.6) * 0.05) / 0.08);
			leaves.push(() => {
				const out = space.steer(p, v3(Math.cos(bear), 0, Math.sin(bear)), -0.2, 0.12 * size, 0.02);
				const dir = out.clone().multiplyScalar(0.85).add(v3(0, lerp(0.8, -0.25, grown), 0)).normalize();
				bag.add('sheet', sheet({ length: 0.1 * size * lerp(0.3, 1, grown), width: 0.024 * size, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.7) * (u < 0.1 ? u / 0.1 : 1), lift: (u, v) => 0.05 * v * v - 0.08 * u * u, paint: (u, v) => mix('#2f6a28', '#6aa84a', 1 - grown).lerp(new THREE.Color('#8fbf6e'), Math.abs(v) < 0.08 ? 0.4 : 0), along: 10, across: 4 }), aim(p.clone().addScaledVector(dir, 0.012), dir, 0));
			});
		}
		// a flower in each fork (the start of every branch)
		if (l.order >= 1) {
			const fr = chance(seed, 'pepper-flower', ...l.key);
			const opens = 4.3 + l.order * 0.35 + fr() * 0.4;
			if (g < opens - 0.25) continue;
			const fork = l.pts[0];
			const down = v3(fr() - 0.5, -1, fr() - 0.5).normalize();
			const set = span(g, opens + 0.4, opens + 2.2);
			if (set < 0.03) {
				const end = fork.clone().addScaledVector(down, 0.02);
				bag.add('body', tube([fork, end], () => 0.001, () => '#6f9a42', 4));
				if (g < opens) bag.add('body', bead(end, v3(0.003, 0.004, 0.003), '#e8eccf', 4));
				else bloom(bag, PEPPER_FLOWER, end, down, 1.2, clamp((g - opens) / 0.2), span(g, opens + 0.25, opens + 0.4));
				continue;
			}
			const size = vigour * about(fr, 1, 0.1);
			const L = 0.1 * size * lerp(0.15, 1, set), R = 0.042 * size * lerp(0.15, 1, set);
			const place = space.settle(fork.clone().addScaledVector(down, 0.02), down, (a, d) => [{ c: a.clone().addScaledVector(d, L * 0.45), r: R * 0.95 }], 0.04);
			bag.add('body', tube([fork, place.at], () => 0.0025 + 0.002 * set, () => '#5f8a3a', 5));
			const ripe = span(g, opens + 2.3, opens + 3.3);
			const colour = ripe < 0.4 ? mix('#2f7a2a', '#3a4a22', ripe / 0.4) : mix('#3a4a22', '#c41e1e', (ripe - 0.4) / 0.6);
			const lobes = 3 + Math.floor(fr() * 2);
			const m = new THREE.Matrix4().compose(place.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), place.dir), v3(1, 1, 1));
			const axis = [];
			for (let k = 0; k <= 14; k++) axis.push(v3(0, -0.003 - (k / 14) * L, 0));
			// blocky: broad shoulders, near-straight sides, lobed at the blossom end
			bag.add('gloss', tube(axis, (u, v) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.95))), 0.3) * (1 - 0.1 * u) * (1 + 0.09 * Math.cos(v * Math.PI * 2 * lobes) * (0.3 + u)), () => colour, 20), m);
			bag.add('body', bead(v3(0, -0.002, 0), v3(R * 0.45, R * 0.18, R * 0.45), '#4f7a2e', 6), m);
		}
	}
	for (const leaf of leaves) leaf();
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ pumpkin */

export const PUMPKIN_STAGES = stages([
	['Seed', 0, 'A big flat cream seed, two and a half centimetres down in warm soil.'],
	['Germination', 6, 'The radicle goes down; the hook pulls the seed leaves out of the coat.'],
	['Seed leaves', 10, 'Two big oval seed leaves.'],
	['True leaves', 20, 'The first rough, lobed true leaves.'],
	['Running', 40, 'The vine runs along the ground, a huge leaf standing up at every node, rooting as it goes.'],
	['Flowering', 55, 'Big yellow trumpets open at dawn: male ones on long stalks, female ones on a little round ovary.'],
	['Fruit set', 62, 'The bees have been: the ovaries swell into small green pumpkins lying on the soil.'],
	['Green pumpkins', 80, 'Ribbed pumpkins growing fast, still green.'],
	['Colouring', 100, 'They turn deep orange from the top, the stalk hardening.'],
	['Ripe', 110, 'Deep orange Hokkaidos, the stalks corky and dry, the leaves going over: harvest.']
]);

/** a pumpkin leaf's edge: five broad shallow lobes, its base deeply notched, toothed */
function pumpkinLeaf(/** @type {number} */ a) {
	const tips = [[0, 1], [1.05, 0.9], [-1.05, 0.9], [2.1, 0.7], [-2.1, 0.7]];
	let reach = 0;
	for (const [at, size] of tips) reach = Math.max(reach, size * (1 - 0.22 * Math.min(1, Math.abs(a - at) / 0.55)));
	return reach * (1 + 0.04 * Math.abs(Math.sin(a * 20)));
}

/** @param {number} g @param {string} seed */
export function pumpkin(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.025, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.009, 0.0022, 0.0055), coat: '#efe4c4', coatShade: '#c9b98c',
		stem: table(g, [[0, 0], [0.3, 0.001], [1, 0.035], [2, 0.06], [9, 0.06]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.003 + 0.004 * span(g, 2, 5), stemColor: '#7a9a4a',
		leaf: { length: 0.05, width: 0.015, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.6), color: '#4f9134', vein: '#a5cf7d' },
		open: span(g, 1.1, 2), shed: span(g, 0.8, 1.4), wither: span(g, 4.5, 5.6), keepCoat: true
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.6, grown: table(g, [[0, 0], [0.3, 0.005], [1, 0.08], [3, 0.4], [5, 0.9], [7, 1]]), radius: 0.003, down: 0.03, wander: 0.15, laterals: 0, depth: 0, age: span(g, 2, 6), young: '#f7f1e0', old: '#c4a57c' });
	for (let i = 0; i < 20; i++) {
		const lr = chance(seed, 'pumpkin-lat', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['lat', i], from: at.clone().add(v3(0, -0.01 - i * 0.012, 0)), dir: v3(Math.cos(a), -0.2, Math.sin(a)), length: between(lr, 0.3, 0.6) * vigour, grown: (g - 1.2 - i * 0.12) / 2.6, radius: 0.0016, down: 0.025, wander: 0.3, laterals: 6, lateral: 0.3, depth: 2, age: (g - 2.5 - i * 0.12) / 3, young: '#f6efdc', old: '#c3a27a' });
	}
	// the vine: out along the ground from the seedling, wandering, a side vine from its third node
	const run = table(g, [[2.2, 0], [3, 0.15], [4, 0.9], [5, 1.7], [6, 2.3], [7, 2.7], [9, 2.9]]) * vigour;
	const vr = chance(seed, 'vine');
	const head = vr() * Math.PI * 2;
	vine(bag, seed, ['main'], s.top.clone(), head, run, g, vigour, true);
	return bag.build();
}

/**
 * A pumpkin vine running along the ground: nodes every so often, a leaf standing up at each on its long stalk, a
 * tendril, roots down into the soil, the flowers, and where a female flower was, a pumpkin.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} from @param {number} head @param {number} run @param {number} g @param {number} vigour @param {boolean} main
 */
function vine(bag, seed, key, from, head, run, g, vigour, main) {
	if (run < 0.01) return;
	const vr = chance(seed, 'vine-path', ...key);
	const pts = [from.clone()];
	let a = head;
	const step = 0.05;
	for (let s = step; s <= run + 1e-9; s += step) {
		a += (vr() - 0.5) * 0.35;
		const last = pts[pts.length - 1];
		pts.push(v3(last.x + Math.cos(a) * step, Math.max(0.012, last.y - 0.02), last.z + Math.sin(a) * step));
	}
	if (pts.length < 2) return;
	bag.add('body', tube(pts, (u) => (0.009 - 0.004 * u) * vigour, (u) => mix('#6f9440', '#9cc26a', u), 7));
	const nodes = Math.floor(run / 0.16);
	for (let i = 0; i < nodes; i++) {
		const nr = chance(seed, 'pumpkin-node', ...key, i);
		const { p, d } = along(pts, ((i + 0.6) * 0.16) / run);
		const side = v3(-d.z, 0, d.x).multiplyScalar(i % 2 ? 1 : -1);
		const grown = clamp((run - (i + 0.6) * 0.16) / 0.4);
		const old = span(g, 8.2 + (nodes - i) * 0.02, 9.5);
		// the leaf, standing up on its stalk, its blade facing up and out
		const stalk = (0.22 + 0.15 * nr()) * vigour * lerp(0.3, 1, grown);
		const top = p.clone().add(v3(0, stalk, 0)).addScaledVector(side, 0.06);
		bag.add('body', tube([p, p.clone().add(v3(0, stalk * 0.6, 0)).addScaledVector(side, 0.02), top], () => 0.005 * vigour, () => mix('#7aa046', '#b8a04a', old), 5));
		const facing = side.clone().multiplyScalar(0.6).add(v3(0, 0.8 - old * 0.6, 0)).normalize();
		bag.add('sheet', fan({ size: 0.17 * vigour * lerp(0.25, 1, grown), from: -Math.PI + 0.35, to: Math.PI - 0.35, edge: pumpkinLeaf, lift: (s, a2) => -0.15 * s * s * (1 + old) + 0.02 * Math.cos(a2 * 5) * s, paint: (s, a2) => mix(mix('#3a6e2a', '#7ab04a', 1 - grown), '#c9b04a', old * 1.2).lerp(new THREE.Color('#b9cc9a'), [0, 1.05, -1.05, 2.1, -2.1].some((t) => Math.abs(a2 - t) < 0.04) ? 0.4 : 0).lerp(new THREE.Color('#a8bca0'), Math.abs(Math.sin(a2 * 7 + s * 9)) > 0.97 ? 0.3 : 0), rings: 8, rays: 56 }), aim(top.clone().addScaledVector(facing, -0.02), facing, 0));
		// roots down from the node
		if (i > 1) root(bag, { seed, key: [...key, 'node-root', i], from: p.clone().add(v3(0, -0.01, 0)), dir: v3(0, -1, 0), length: 0.18, grown: span(g, 3.5 + i * 0.08, 5 + i * 0.08), radius: 0.0015, laterals: 4, depth: 1, young: '#f6efdc', old: '#c3a27a' });
		// a tendril, coiled
		if (i > 1 && grown > 0.4) {
			const tp = [];
			for (let m = 0; m <= 10; m++) {
				const t = m / 10;
				tp.push(p.clone().addScaledVector(side.clone().negate(), Math.min(t, 0.6) * 0.1).add(t > 0.6 ? v3(Math.cos(t * 20) * 0.008, 0.01 + Math.sin(t * 20) * 0.008, 0) : v3(0, 0.015 * t, 0)));
			}
			bag.add('body', tube(tp, () => 0.001, () => '#9cc26a', 3));
		}
		// a side vine from the third node of the main one
		if (main && i === 3) vine(bag, seed, [...key, 'side'], p, Math.atan2(side.z, side.x) + Math.atan2(d.z, d.x) * 0.0, Math.max(0, run - 0.6) * 0.65, g, vigour, false);
		// the flowers: male ones along it, a female one at a few nodes, then her pumpkin
		if (i < 3) continue;
		const female = main ? i === 5 || i === 9 || i === 13 : i === 4 || i === 8;
		const opens = 4.6 + i * 0.07 + nr() * 0.2;
		if (g < opens - 0.3) continue;
		const set = span(g, opens + 0.4, opens + 2.4);
		if (!female || set < 0.03) {
			const stalkTop = p.clone().add(v3(0, female ? 0.03 : 0.18, 0)).addScaledVector(side, -0.04);
			bag.add('body', tube([p, stalkTop], () => 0.003, () => '#7aa046', 4));
			if (female) bag.add('body', bead(stalkTop, v3(0.015, 0.012, 0.015), '#6a9a3a', 6));
			const open = clamp((g - opens) / 0.15), wilt = span(g, opens + 0.25, opens + 0.45);
			if (wilt < 1) bloom(bag, { petals: 5, length: 0.05, width: 0.028, colour: '#f2a81c', heart: '#e88a10', sepals: 5, sepal: 0.012, stamens: 0, flat: -0.4 }, stalkTop.clone().add(v3(0, female ? 0.012 : 0, 0)), v3(0, 1, 0), 1 - wilt * 0.4, open, wilt);
			continue;
		}
		// a pumpkin, lying on the soil beside the vine, its stalk thick and ridged
		const fr = chance(seed, 'pumpkin', ...key, i);
		const R = (0.03 + 0.1 * set) * vigour * about(fr, 1, 0.08);
		const Hh = R * 1.45;
		const c = p.clone().addScaledVector(side, -(R + 0.03)).setY(0);
		const ripe = span(g, opens + 2.6, opens + 3.6);
		const axis = [];
		for (let k = 0; k <= 14; k++) axis.push(c.clone().add(v3(0, Hh - (k / 14) * Hh, 0)));
		const colour = mix('#3f6a2a', '#e06418', ripe);
		bag.add('gloss', tube(axis, (u, v) => R * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.55) * (1 + 0.06 * Math.cos(v * Math.PI * 2 * 10)) * (1 - 0.12 * Math.pow(1 - u, 3)), (u, v) => colour.clone().lerp(new THREE.Color(ripe > 0.5 ? '#f08a3a' : '#8aa86a'), Math.pow(Math.abs(Math.cos(v * Math.PI * 10)), 30) * 0.4), 30));
		bag.add('body', tube([p, c.clone().add(v3(0, Hh + 0.03, 0)), c.clone().add(v3(0, Hh - 0.005, 0))], () => 0.008, () => mix('#6a9a3a', '#b8a06a', ripe), 6));
	}
}

/* ------------------------------------------------------------------------------------------------ blueberry */

export const BLUEBERRY_STAGES = stages([
	['Seed', 0, 'A tiny seed from a berry, on acid peaty soil, barely covered, kept moist and cool.'],
	['Germination', 30, 'After a month a root goes down, a tiny hook comes up.'],
	['Seedling', 60, 'Two tiny round seed leaves and the first small leaves.'],
	['Young bush', 365, 'A twiggy little bush, its new stems red.'],
	['Bush', 1100, 'Canes from the crown, grey-barked below, fine twigs above, small elliptic leaves.'],
	['Flowering', 1300, 'Clusters of small white bells hang from last year’s twigs, the bees at them.'],
	['Fruit set', 1315, 'The bells drop; little green berries, each with a five-pointed crown.'],
	['Green berries', 1345, 'Clusters of hard green berries swelling.'],
	['Colouring', 1370, 'Berry by berry they turn pink, then purple-blue.'],
	['Ripe', 1385, 'Blue berries under a pale silvery bloom, picked over weeks.']
]);

/** @param {number} g @param {string} seed */
export function blueberry(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.1);
	const at = v3(0, -0.002, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0008, 0.0005, 0.0005), coat: '#8a5a3a', coatShade: '#5a3a24',
		stem: table(g, [[0, 0], [0.4, 0.0005], [1, 0.004], [2, 0.01], [9, 0.01]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0005 + 0.002 * span(g, 1, 4), stemColor: '#9a5a4a',
		leaf: { length: 0.004, width: 0.0022, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6), color: '#6aa046', vein: '#a6c47e' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.6), wither: span(g, 3, 3.8)
	});
	// shallow fibrous roots, spreading
	for (let i = 0; i < 26; i++) {
		const rr = chance(seed, 'bb-root', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['r', i], from: at.clone().add(v3(0, -0.01, 0)), dir: v3(Math.cos(a), -between(rr, 0.15, 0.5), Math.sin(a)), length: between(rr, 0.25, 0.5) * vigour, grown: (g - 0.4 - i * 0.15) / 3, radius: 0.0015, down: 0.01, wander: 0.25, laterals: 7, lateral: 0.3, depth: 2, age: (g - 2 - i * 0.15) / 3, young: '#f1e4cc', old: '#8a6a4a' });
	}
	/** @type {import('./tree.js').Limb[]} */
	const twigs = [];
	// the canes: one after another from the crown, each branching into fine twigs
	for (let c = 0; c < 7; c++) {
		const cr = chance(seed, 'cane', c);
		const born = 2 + c * 0.55;
		if (g <= born) break;
		const bear = c * 2.39996 + cr() * 0.4;
		const lean = c === 0 ? 0.05 : between(cr, 0.2, 0.45);
		limb(bag, { seed, key: ['cane', c], from: s.top.clone().add(v3(Math.cos(bear) * 0.01 * c, 0, Math.sin(bear) * 0.01 * c)), dir: v3(Math.cos(bear) * Math.sin(lean), Math.cos(lean), Math.sin(bear) * Math.sin(lean)), length: (0.6 + 0.4 * cr()) * vigour, grown: Math.min(2.8, (g - born) * 0.9), radius: 0.012, up: 0.04, wander: 0.12, spread: 0.7, children: 3, shorten: [0.4, 0.65], depth: 3, from0: 0.4, young: '#a8503a', old: '#6a5a50', age: clamp((g - born) / 4), out: twigs });
	}
	for (const t of twigs) {
		const tr = chance(seed, 'bb-twig', ...t.key);
		// small elliptic leaves along the twigs
		if (t.order >= 1 || g < 4) {
			const n = Math.min(10, Math.floor(t.length / 0.035));
			for (let k = 0; k < n; k++) {
				const { p, d } = along(t.pts, (k + 0.5) / Math.max(1, n));
				const sideV = new THREE.Vector3().crossVectors(d, v3(0, 1, 0));
				if (sideV.lengthSq() < 1e-6) sideV.set(1, 0, 0);
				sideV.normalize().multiplyScalar(k % 2 ? 1 : -1);
				const dir = sideV.addScaledVector(d, 0.5).add(v3(0, 0.1, 0)).normalize();
				bag.add('sheet', sheet({ length: 0.05 * vigour, width: 0.022 * vigour, shape: (u) => Math.pow(Math.sin(Math.PI * u), 0.6), lift: (u, v) => 0.04 * v * v - 0.04 * u * u, paint: (u, v) => mix('#4f8a3a', '#2f6a2e', tr()).lerp(new THREE.Color('#a6c47e'), Math.abs(v) < 0.1 ? 0.3 : 0), along: 6, across: 2 }), aim(p, dir, 0));
			}
		}
		// the clusters at the ends of the older twigs
		if (!t.end || t.order < 2) continue;
		const opens = 4.7 + tr() * 0.4;
		if (g < opens - 0.3) continue;
		const set = span(g, opens + 0.35, opens + 2.2);
		const count = 5 + Math.floor(tr() * 5);
		for (let k = 0; k < count; k++) {
			const a = k * 2.39996;
			const hang = t.tip.clone().add(v3(Math.cos(a) * 0.012 * (1 + k * 0.15), -0.012 - k * 0.006, Math.sin(a) * 0.012 * (1 + k * 0.15)));
			bag.add('body', tube([t.tip, hang], () => 0.0006, () => '#8a6a4a', 3));
			if (set < 0.03) {
				// a white urn-shaped bell, mouth down
				const open = clamp((g - opens + 0.3) / 0.3), drop = span(g, opens + 0.25, opens + 0.4);
				if (drop < 1) bag.add('body', bead(hang.clone().add(v3(0, -0.005, 0)), v3(0.0035, 0.005, 0.0035).multiplyScalar(lerp(0.5, 1, open)), mix('#e9eccf', '#f4ecec', open), 5));
				continue;
			}
			const br = chance(seed, 'berry', ...t.key, k);
			const turn = span(g, 7.2 + br() * 0.9, 8.2 + br() * 0.7);
			const r = (0.002 + 0.0058 * set) * vigour * about(br, 1, 0.1);
			const c = turn < 0.4 ? mix('#9ab86a', '#c87a8a', turn / 0.4) : mix('#c87a8a', '#3a4a8a', (turn - 0.4) / 0.6);
			const p = hang.clone().add(v3(0, -r, 0));
			bag.add('gloss', bead(p, v3(r, r * 0.9, r), c.lerp(new THREE.Color('#8a9ac0'), turn * 0.3), 5));
			bag.add('body', bead(p.clone().add(v3(0, -r * 0.85, 0)), v3(r * 0.35, r * 0.15, r * 0.35), '#3a2a3a', 3));
		}
	}
	return bag.build();
}
