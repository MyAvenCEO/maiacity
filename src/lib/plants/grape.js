/*
 * GRAPE — Vitis vinifera, a red wine grape, from its pip: a small pear-shaped seed, chilled through the winter. Two
 * oval seed leaves, then a slender vine of five-lobed toothed leaves, a tendril opposite each one. Trained: one woody
 * trunk up its post to the wire, two arms (the cordon) along the wire, short spurs on the arms; each spring the spurs
 * send up green shoots between the catch wires, a leaf at every node, the flower clusters opposite the third and fourth
 * leaves. The tiny green flowers shed their caps; the berries set, swell hard and green, then at véraison soften and
 * colour berry by berry, until the bunches hang deep red-purple, dusted with bloom.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, fan, lerp, mix, root, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

export const STAGES = [
	{ name: 'Pip', day: 0, note: 'A small pear-shaped pip, chilled through the winter, a centimetre down.' },
	{ name: 'Germination', day: 14, note: 'The radicle goes down, the hook comes up.' },
	{ name: 'Seedling', day: 30, note: 'Two oval seed leaves and the first lobed, toothed true leaves.' },
	{ name: 'First summer', day: 150, note: 'A slender vine climbing its stake, a tendril opposite every leaf.' },
	{ name: 'Trained', day: 730, note: 'Pruned to one woody trunk up the post and two arms along the wire, short spurs on the arms.' },
	{ name: 'Flowering', day: 1100, note: 'Green shoots up between the catch wires; tiny green flowers in clusters shed their caps.' },
	{ name: 'Fruit set', day: 1110, note: 'Clusters of hard little green berries set, opposite the third and fourth leaves.' },
	{ name: 'Green berries', day: 1150, note: 'The bunches swell and close up, berry pressed to berry, still green and sour.' },
	{ name: 'Véraison', day: 1190, note: 'Berry by berry they soften and turn: green, pink, red, the bunch speckled.' },
	{ name: 'Ripe', day: 1220, note: 'Deep red-purple bunches dusted with bloom, sweet: the harvest.' }
];

const POST = v3(0.04, 0, -0.03);
const WIRE = 0.9;

/** a vine leaf's edge: five lobes with deep sinuses, toothed, the stalk in a notch at its base */
function vineLeaf(/** @type {number} */ a) {
	const tips = [[0, 1], [0.95, 0.88], [-0.95, 0.88], [1.95, 0.6], [-1.95, 0.6]];
	let reach = 0;
	for (const [at, size] of tips) reach = Math.max(reach, size * (1 - 0.48 * Math.min(1, Math.abs(a - at) / 0.48)));
	return reach * (1 + 0.06 * Math.abs(Math.sin(a * 26)));
}

/**
 * The grapevine at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function grape(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.01, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.003, 0.0018, 0.002), coat: '#7a5232', coatShade: '#4a3020',
		stem: table(g, [[0, 0], [0.3, 0.001], [1, 0.014], [2, 0.03], [9, 0.03]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.001 + 0.001 * span(g, 1, 3), stemColor: '#8a9a4a',
		leaf: { length: 0.012, width: 0.005, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.65), color: '#6aa046', vein: '#a6c47e' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.6), wither: span(g, 3, 3.8)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0.02, -1, 0), length: 1.2, grown: table(g, [[0, 0], [0.3, 0.005], [1, 0.03], [2, 0.08], [3, 0.25], [4, 0.6], [6, 1]]), radius: 0.003 + 0.02 * span(g, 3, 8), down: 0.03, wander: 0.15, laterals: 10, lateral: 0.35, depth: 2, age: span(g, 2, 7), young: '#f1e4c8', old: '#6a4a32' });
	for (let i = 0; i < 12; i++) {
		const rr = chance(seed, 'feeder', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['feeder', i], from: at.clone().add(v3(0, -0.05 - rr() * 0.1, 0)), dir: v3(Math.cos(a), -0.35, Math.sin(a)), length: between(rr, 0.5, 0.9), grown: (g - 3 - i * 0.1) / 2.5, radius: 0.006, down: 0.02, wander: 0.15, laterals: 5, depth: 2, age: (g - 4 - i * 0.1) / 2, young: '#efdcb8', old: '#6a4a32' });
	}

	// the post and its wires, once the vine is trained to them
	if (g >= 3) {
		bag.add('prop', tube([POST.clone().add(v3(0, -0.3, 0)), POST.clone().add(v3(0, 1.6, 0))], () => 0.035, (u, v) => mix('#8a6a4a', '#a0845c', Math.abs(Math.sin(v * 40 + u * 3))), 10));
		for (const [y, z] of [[WIRE, 0], [1.2, 0.04], [1.2, -0.04], [1.5, 0.04], [1.5, -0.04]]) bag.add('prop', tube([v3(-1.1, y, z - 0.03), v3(1.1, y, z - 0.03)], () => 0.0015, () => '#9a9a98', 4));
	}

	// the first summer: a slender vine up a cane, leaves and tendrils
	const young = span(g, 2, 3.6);
	const trained = span(g, 3.6, 4.6);
	if (g > 2 && trained < 1) {
		const len = (0.05 + 0.85 * young) * (1 - trained);
		const pts = [s.top.clone()];
		for (let k = 1; k <= 12; k++) pts.push(s.top.clone().add(v3(Math.sin(k * 0.9) * 0.012, (k / 12) * len, Math.cos(k * 0.9) * 0.01)));
		bag.add('body', tube(pts, (u) => 0.003 * (1 - 0.5 * u), () => '#8a9a4a', 5));
		for (let k = 0; k < Math.floor(len / 0.08); k++) leaf(bag, seed, ['young', k], pts[Math.min(12, Math.round(((k + 1) * 0.08 / len) * 12))], k * Math.PI + 0.3, 0.7, 1);
	}
	if (trained <= 0) return bag.build();

	// the trunk up the post, and the two arms along the wire
	const base = s.top.clone();
	const trunkTop = v3(POST.x - 0.045, WIRE - 0.02, POST.z + 0.02);
	const tr = [base, base.clone().lerp(trunkTop, 0.4).add(v3(0.01, 0, 0)), base.clone().lerp(trunkTop, 0.75).add(v3(-0.012, 0, 0.006)), trunkTop];
	const wood = lerp(0.01, 0.035, span(g, 3.6, 9));
	bag.add('body', tube(tr, (u) => wood * (1 - 0.25 * u), (u, v) => mix('#6a4a32', '#8a6a4a', Math.pow(Math.abs(Math.sin(v * 30 + u * 9)), 4)), 10));
	const arm = 0.8 * trained * vigour;
	for (const side of [-1, 1]) {
		const ap = [trunkTop.clone()];
		for (let k = 1; k <= 10; k++) ap.push(trunkTop.clone().add(v3(side * (k / 10) * arm, Math.sin(k * 0.6) * 0.008 + 0.01, Math.cos(k * 0.8) * 0.006)));
		bag.add('body', tube(ap, (u) => wood * 0.7 * (1 - 0.4 * u), () => '#7a5a3c', 8));
		// the spurs along it, each sending up shoots in spring
		for (let sp = 0; sp < 4; sp++) {
			const u = 0.2 + sp * 0.24;
			if (u * 0.8 > arm) break;
			const spur = trunkTop.clone().add(v3(side * u * 0.8 * vigour, 0.03, 0));
			bag.add('body', bead(spur, v3(0.012, 0.02, 0.012), '#6a4a32', 4));
			for (let sh = 0; sh < 2; sh++) shoot(bag, seed, [side, sp, sh], spur.clone().add(v3(sh * 0.02 - 0.01, 0.01, 0)), g, vigour);
		}
	}
	return bag.build();
}

/**
 * A grape leaf at a node: on its long stalk, five-lobed, toothed, facing out to the light.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} at @param {number} bear @param {number} size @param {number} grown
 */
function leaf(bag, seed, key, at, bear, size, grown) {
	const lr = chance(seed, 'vine-leaf', ...key);
	const out = v3(Math.cos(bear), 0, Math.sin(bear));
	const stalk = at.clone().addScaledVector(out, 0.06 * size * lerp(0.3, 1, grown)).add(v3(0, 0.02 * size, 0));
	bag.add('body', tube([at, stalk], () => 0.0012, () => '#8a9a4a', 4));
	const tilt = lerp(0.8, between(lr, -0.6, -0.2), grown);
	const facing = out.clone().multiplyScalar(Math.cos(tilt)).add(v3(0, Math.sin(tilt), 0)).normalize();
	bag.add(
		'sheet',
		fan({ size: 0.075 * size * lerp(0.25, 1, grown), from: -Math.PI + 0.45, to: Math.PI - 0.45, edge: vineLeaf, lift: (s, a) => -0.1 * s * s + 0.015 * Math.cos(a * 5) * s + (1 - grown) * 0.3 * s * Math.abs(Math.sin(a)), paint: (s, a) => mix(mix('#3f6f2e', '#8ab45a', 1 - grown), '#9cc06e', [0, 0.95, -0.95, 1.95, -1.95].some((t) => Math.abs(a - t) < 0.04) ? 0.5 * (1 - s) : 0), rings: 7, rays: 48 }),
		aim(stalk.clone().addScaledVector(facing, -0.008), facing, about(lr, 0, 0.2))
	);
}

/**
 * A spring shoot from a spur: up between the catch wires, a leaf at each node, tendrils opposite, the flower clusters
 * opposite its third and fourth leaves — then the bunches.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} from @param {number} g @param {number} vigour
 */
function shoot(bag, seed, key, from, g, vigour) {
	const sr = chance(seed, 'shoot', ...key);
	const born = 4.4 + sr() * 0.2;
	if (g <= born) return;
	const len = (0.15 + 0.95 * span(g, born, 7)) * vigour * about(sr, 1, 0.1);
	const lean = v3((sr() - 0.5) * 0.25, 1, (sr() - 0.5) * 0.15).normalize();
	const pts = [from.clone()];
	for (let k = 1; k <= 14; k++) {
		const u = k / 14;
		pts.push(from.clone().addScaledVector(lean, u * len).add(v3(Math.sin(u * 7 + sr()) * 0.012, 0, 0)));
	}
	bag.add('body', tube(pts, (u) => 0.0055 * (1 - 0.5 * u), (u) => mix(g > 7.8 ? '#8a6a3a' : '#7a8a3a', '#a6bc5a', u), 5));
	const nodes = Math.floor(len / 0.075);
	for (let k = 0; k < nodes; k++) {
		const p = pts[Math.min(14, Math.round(((k + 0.6) * 0.075 / len) * 14))];
		const bear = (k % 2 ? 0 : Math.PI) + (key[0] === 1 ? 0.25 : -0.25) + about(sr, 0, 0.2);
		const grown = clamp((len - k * 0.075) / 0.25);
		leaf(bag, seed, [...key, k], p, bear + Math.PI / 2, 1, grown);
		if (k === 2 || k === 3) bunch(bag, seed, [...key, k], p, bear - Math.PI / 2, g, vigour);
		else if (k > 3 && grown > 0.3) {
			// a tendril, coiling
			const d = v3(Math.cos(bear - Math.PI / 2), 0.5, Math.sin(bear - Math.PI / 2)).normalize();
			const tp = [];
			for (let m = 0; m <= 10; m++) {
				const u = m / 10;
				tp.push(p.clone().addScaledVector(d, Math.min(u, 0.6) * 0.07).add(u > 0.6 ? v3(Math.cos(u * 18) * 0.006, Math.sin(u * 18) * 0.006, 0) : v3(0, 0, 0)));
			}
			bag.add('body', tube(tp, () => 0.0008, () => '#9ab85a', 3));
		}
	}
}

/**
 * A cluster: tiny green flowers shedding their caps; then a conical bunch of berries, swelling, closing up, colouring
 * berry by berry at véraison, ripe deep red-purple with a dusty bloom.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} at @param {number} bear @param {number} g @param {number} vigour
 */
function bunch(bag, seed, key, at, bear, g, vigour) {
	const br = chance(seed, 'bunch', ...key);
	const opens = 4.9 + br() * 0.25;
	if (g < opens - 0.4) return;
	const set = span(g, opens + 0.3, opens + 2.5);
	const out = v3(Math.cos(bear), 0, Math.sin(bear));
	const peduncle = at.clone().addScaledVector(out, 0.04).add(v3(0, -0.02 - 0.03 * set, 0));
	bag.add('body', tube([at, at.clone().addScaledVector(out, 0.03), peduncle], () => 0.002, () => '#7a8a3a', 4));
	const L = (0.06 + 0.1 * set) * vigour * about(br, 1, 0.15);
	const W = L * 0.42;
	const n = 70;
	const flowering = g < opens + 0.3;
	for (let k = 0; k < n; k++) {
		const t = (k + 0.5) / n;
		const a = k * 2.39996;
		const cone = W * (1 - 0.72 * t) * Math.sqrt(br() * 0.7 + 0.3);
		const p = peduncle.clone().add(v3(Math.cos(a) * cone, -0.01 - t * L, Math.sin(a) * cone));
		if (flowering) {
			bag.add('body', bead(p, v3(0.0018, 0.0026, 0.0018), mix('#a8b85a', '#d8d890', clamp((g - opens + 0.4) / 0.6)), 2));
			continue;
		}
		// each berry turns on its own day at véraison
		const tr = chance(seed, 'berry', ...key, k);
		const turn = span(g, 7.4 + tr() * 0.7, 8.2 + tr() * 0.6);
		const r = (0.0025 + 0.0058 * set) * vigour;
		const c = turn < 0.5 ? mix('#9ab84a', '#c27a7a', turn * 2) : mix('#c27a7a', '#5a1430', (turn - 0.5) * 2);
		bag.add('gloss', bead(p, v3(r, r * 1.08, r), c.lerp(new THREE.Color('#8a6a8a'), span(g, 8.5, 9) * 0.18), 4));
	}
	bag.add('body', tube([peduncle, peduncle.clone().add(v3(0, -L, 0))], () => 0.0012, () => '#7a8a3a', 3));
}
