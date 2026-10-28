/*
 * EGGPLANT — Solanum melongena, the aubergine, from one seed: flat, kidney-shaped, tan, three millimetres long, sown
 * half a centimetre deep in warm soil. Two oval seed leaves; then a hairy purple-tinged stem that forks into a bush,
 * its leaves big, soft and felted grey-green, wavy-edged, their midribs purple. In the leaf axils nodding violet star
 * flowers with a yellow cone of anthers, few to a plant; each sets a fruit under a big spiny green calyx that grows
 * long and glossy, from pale violet to a deep black-purple, hanging from the branches.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, Space, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { bloom } from './bloom.js';
import { limb } from './tree.js';

export const STAGES = [
	{ name: 'Seed', day: 0, note: 'A flat, kidney-shaped tan seed, half a centimetre down: eggplants want the soil warm, 25 °C and more.' },
	{ name: 'Germination', day: 8, note: 'The radicle goes down; the hypocotyl hooks up into the light.' },
	{ name: 'Seed leaves', day: 14, note: 'Two oval cotyledons on a short stem.' },
	{ name: 'True leaves', day: 30, note: 'The first true leaves: soft, felted, grey-green, the midrib already purple.' },
	{ name: 'Bushing', day: 55, note: 'Planted out, the stem forks into a bush of big wavy leaves.' },
	{ name: 'Flowering', day: 70, note: 'Nodding violet stars in the leaf axils, a yellow cone of anthers at their heart.' },
	{ name: 'Fruit set', day: 80, note: 'The petals fall; under each spiny green calyx a little violet fruit swells.' },
	{ name: 'Swelling', day: 95, note: 'The fruit lengthen and darken, hanging under the leaves.' },
	{ name: 'Glossy', day: 105, note: 'Full-sized and deep purple, the skin taut and shining: the time to pick.' },
	{ name: 'Harvest', day: 115, note: 'Branch after branch of black-purple fruit, new flowers still opening above.' }
];

const SEED_AT = v3(0, -0.006, 0);

/** the eggplant's leaf: broad, ovate, its edge in shallow waves */
function leafShape(/** @type {number} */ u) {
	const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.68) * (1 - 0.15 * u);
	return body * (1 + 0.1 * Math.sin(u * Math.PI * 5.5) * (u > 0.1 ? 1 : 0));
}

/** an eggplant flower: five or six violet petals in a star, the anthers a yellow cone, the calyx purple-green */
const FLOWER = { petals: 6, length: 0.019, width: 0.011, colour: '#8d6cb8', heart: '#f0c419', cone: true, flat: 0.25, sepals: 6, sepal: 0.012, sepalBack: 0.2, sepalColour: '#5f5a4a', shape: (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.7) };

/**
 * The eggplant at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function eggplant(g, seed) {
	const bag = new Bag();
	const r = chance(seed, 'plant');
	const vigour = about(r, 1, 0.1);

	const s = sprout(bag, {
		seed,
		at: SEED_AT,
		size: v3(0.0016, 0.0005, 0.0013),
		coat: '#d2b98a',
		coatShade: '#a68a5a',
		stem: table(g, [[0, 0], [0.3, 0.0008], [1, 0.011], [2, 0.03], [3, 0.034], [9, 0.036]]),
		hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0011 + 0.004 * span(g, 2, 6),
		stemColor: '#6e7a48',
		leaf: { length: 0.02, width: 0.0075, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.65), color: '#5a8a3c', vein: '#98bb78' },
		open: span(g, 1.1, 2),
		shed: span(g, 1.0, 1.6),
		wither: span(g, 4.3, 5.2)
	});

	root(bag, { seed, key: ['taproot'], from: SEED_AT.clone(), dir: v3(0.03, -1, 0), length: 0.42, grown: table(g, [[0, 0], [0.35, 0.006], [1, 0.05], [2, 0.14], [3, 0.3], [4, 0.6], [5, 0.85], [7, 1]]), radius: 0.0024, down: 0.04, wander: 0.15, laterals: 0, depth: 0, age: span(g, 2, 6), young: '#f7f1e0', old: '#c4a37a' });
	const lr = chance(seed, 'laterals');
	for (let i = 0; i < 26; i++) {
		const at = 0.005 + i * 0.012 + lr() * 0.005;
		const born = 1.3 + i * 0.14;
		const bear = i * 2.39996 + lr() * 0.5;
		root(bag, { seed, key: ['lateral', i], from: SEED_AT.clone().add(v3(0, -at, 0)), dir: v3(Math.cos(bear), -0.4, Math.sin(bear)), length: between(lr, 0.12, 0.28) * vigour, grown: (g - born) / 2.6, radius: 0.0012, down: 0.05, wander: 0.3, laterals: 7, lateral: 0.3, depth: 2, age: (g - born - 1) / 3, young: '#f6efdc', old: '#bf9c72' });
	}

	// the bush: a stem that forks, and forks again
	/** @type {import('./tree.js').Limb[]} */
	const limbs = [];
	limb(bag, {
		seed,
		key: ['stem'],
		from: s.top.clone(),
		dir: v3(0, 1, 0),
		length: 0.42 * vigour,
		grown: table(g, [[2.1, 0], [3, 0.12], [4, 0.6], [5, 1.3], [6, 1.75], [7, 2.0], [9, 2.15]]),
		radius: 0.0085,
		up: 0.05,
		wander: 0.1,
		spread: 0.75,
		children: 3,
		shorten: [0.6, 0.85],
		depth: 2,
		from0: 0.45,
		young: '#7c8a52',
		old: '#5e4f5c',
		age: span(g, 4, 8),
		out: limbs
	});

	// what is where: the stems, then the fruit, for the fruit and the leaves to keep clear of
	const space = bag.space;
	for (const l of limbs) space.rod(l.pts, 0.008 * (l.order ? 0.6 : 1) + 0.004);
	/** the leaves wait until the fruit hang, then turn away from them @type {(() => void)[]} */
	const leaves = [];
	let flowered = 0;
	for (const l of limbs) {
		const total = l.length;
		// a leaf every 6 – 8 cm along it, turning round it
		const lr2 = chance(seed, 'leaves', ...l.key);
		let s0 = 0.03 + lr2() * 0.03;
		for (let k = 0; k < 9; k++, s0 += between(lr2, 0.055, 0.08)) {
			const past = total - s0;
			const bear = k * 2.4 + lr2() * 0.5;
			const size = about(lr2, 1, 0.12) * vigour * lerp(0.55, 1, clamp(g - 3));
			if (past <= 0) continue;
			const { p } = along(l.pts, s0 / total);
			const old = l.order === 0 && k < 3 ? span(g, 7 + k * 0.4, 8.5 + k * 0.4) : 0;
			const grownLeaf = clamp(past / 0.1);
			if (old < 1) leaves.push(() => leaf(bag, p, space.steer(p, v3(Math.cos(bear), 0, Math.sin(bear)), -0.1, 0.24 * size, 0.035 * size), size, grownLeaf, old));
			// a flower in the axil of the second leaf of each branch
			if (l.order >= 1 && k === 1 && flowered < 9) {
				flowered++;
				blossom(bag, seed, [...l.key, k], p, v3(Math.cos(bear + Math.PI), 0, Math.sin(bear + Math.PI)), g, vigour, space);
			}
		}
	}
	for (const leaf of leaves) leaf();
	return bag.build();
}

/** a point along a limb's path at u (0 … 1 of its grown length) */
function along(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
	return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize() };
}

/**
 * An eggplant leaf: a stout purple-tinged stalk and a broad soft wavy blade, hanging out and down.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} out @param {number} size @param {number} grown @param {number} old
 */
function leaf(bag, at, out, size, grown, old) {
	const len = 0.06 * size * lerp(0.3, 1, grown);
	const stalkDir = out.clone().multiplyScalar(0.7).add(v3(0, lerp(1, 0.55, grown) - old * 0.6, 0)).normalize();
	const end = at.clone().addScaledVector(stalkDir, len);
	bag.add('body', tube([at, at.clone().lerp(end, 0.5).add(v3(0, len * 0.08, 0)), end], (u) => 0.0022 * size * (1 - 0.3 * u), () => mix('#6f6a52', '#b9a14a', old), 5));
	const blade = 0.2 * size * lerp(0.25, 1, grown);
	const tilt = lerp(0.9, -0.35, grown) - old * 0.6;
	const dir = out.clone().multiplyScalar(Math.cos(tilt)).add(v3(0, Math.sin(tilt), 0)).normalize();
	const fold = (1 - grown) * 0.7 + 0.05;
	bag.add(
		'sheet',
		sheet({
			length: blade,
			width: blade * 0.36,
			shape: leafShape,
			lift: (u, v) => fold * Math.abs(v) * 0.3 - 0.1 * u * u + 0.025 * Math.sin(u * Math.PI * 7) * v * v,
			paint: (u, v) => {
				const vein = Math.abs(v) < 0.07 ? 0.7 : 0;
				const green = mix(mix('#57774a', '#7fa262', 1 - grown), '#7a4f7e', vein * (1 - u * 0.6));
				return old ? green.lerp(mix('#c9b04a', '#9a7a3a', u), clamp(old * 1.3)) : green;
			},
			along: 22,
			across: 6
		}),
		aim(end, dir)
	);
}

/**
 * A flower in a leaf axil, nodding on its stalk; then the fruit it sets, under its spiny calyx, growing long and dark.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} at @param {THREE.Vector3} out @param {number} g @param {number} vigour
 * @param {Space} space
 */
function blossom(bag, seed, key, at, out, g, vigour, space) {
	const fr = chance(seed, 'eggplant-flower', ...key);
	const opens = 4.4 + fr() * 1.3;
	const bud = clamp((g - (opens - 0.35)) / 0.35);
	if (bud <= 0) return;
	const set = span(g, opens + 0.4, opens + 2.3);
	const hang = clamp(set * 1.5);
	const d = out.clone().multiplyScalar(0.6).add(v3(0, 0.2 - hang * 1.1, 0)).normalize();
	const end = at.clone().addScaledVector(d, 0.035);
	if (set < 0.03) bag.add('body', tube([at, end], () => 0.0018, () => '#6a6150', 5));
	const facing = d.clone().lerp(v3(0, -1, 0), 0.4).normalize();
	if (g < opens) {
		bag.add('body', bead(end.clone().addScaledVector(facing, 0.006), v3(0.004, 0.008, 0.004).multiplyScalar(0.5 + bud * 0.5), mix('#5f5a4a', '#8d6cb8', bud * 0.7)));
	} else if (set < 0.03) {
		bloom(bag, FLOWER, end, facing, 1.4, clamp((g - opens) / 0.2), span(g, opens + 0.25, opens + 0.4));
	} else {
		const size = vigour * about(fr, 1, 0.12);
		// it hangs where it touches nothing: no fruit through another, nor through a stem
		const place = space.settle(end, d.clone().lerp(v3(0, -1, 0), 0.6), (a, dd) => fruitBalls(a, dd, size, set), 0.05);
		// one eggplant, picked with its stalk from the leaf axil
		bag.fruit(key, at, place.dir);
		bag.add('body', tube([at, end, place.at], () => 0.0018 + 0.0018 * set, () => '#6a6150', 5));
		fruit(bag, { seed, key, at: place.at, dir: place.dir, size, set, gloss: span(g, opens + 1.2, opens + 2.5) });
		bag.fruitDone();
	}
}

/** the room an eggplant takes: three balls down its length, the last the broadest */
function fruitBalls(/** @type {THREE.Vector3} */ at, /** @type {THREE.Vector3} */ dir, /** @type {number} */ size, /** @type {number} */ set) {
	const L = 0.2 * size * lerp(0.12, 1, set);
	const R = L * 0.25;
	return [0.22, 0.52, 0.8].map((f, i) => ({ c: at.clone().addScaledVector(dir, 0.004 + L * f), r: R * [0.75, 0.92, 1][i] }));
}

/**
 * An eggplant: long and full, broadest toward its end, glossy; pale violet when small, deep black-purple full-grown. A
 * big green calyx with soft spines clasps its top.
 * @param {Bag} bag
 * @param {{ seed: string, key: (string | number)[], at: THREE.Vector3, dir: THREE.Vector3, size: number, set: number, gloss: number }} o
 */
function fruit(bag, o) {
	const fr = chance(o.seed, 'eggplant', ...o.key);
	const L = 0.2 * o.size * lerp(0.12, 1, o.set);
	const R = L * between(fr, 0.22, 0.27);
	const bend = about(fr, 0, 0.12);
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir), v3(1, 1, 1));
	const axis = [];
	for (let k = 0; k <= 18; k++) {
		const u = k / 18;
		axis.push(v3(bend * L * u * u, -0.004 - u * L, 0));
	}
	const radius = (/** @type {number} */ u) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.92))), 0.45) * (0.68 + 0.32 * u);
	const colour = mix(mix('#9c78c0', '#4a2560', o.set), '#2a1236', o.gloss);
	bag.add('gloss', tube(axis, radius, (u) => colour.clone().lerp(new THREE.Color('#5b3a6e'), (1 - u) * 0.15), 18), m);
	// the calyx: a cap over the top and its lobes clasping the fruit
	const cap = [];
	for (let k = 0; k <= 5; k++) cap.push(v3(0, -0.001 - (k / 5) * L * 0.12, 0));
	bag.add('body', tube(cap, (u) => radius(0.02 + u * 0.1) * 1.05 + 0.002, () => '#5c7a3c', 12), m);
	for (let k = 0; k < 6; k++) {
		const lobe = sheet({ length: L * 0.2 + 0.01, width: R * 0.35, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.6)) * (1 - 0.6 * u), lift: (u) => -0.35 * u * u, paint: (u) => mix('#5c7a3c', '#7f9a52', u), along: 6, across: 2 });
		bag.add('sheet', lobe, m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 6) * Math.PI * 2 + fr())).multiply(new THREE.Matrix4().makeTranslation(radius(0.06) * 1.02, -0.004, 0)).multiply(new THREE.Matrix4().makeRotationZ(-1.25)));
	}
}
