/*
 * TOMATO — Solanum lycopersicum, staked as a cordon (one stem up a cane), in two sorts: the round red garden tomato,
 * and the Ochsenherz (oxheart, cuor di bue) — taller and slenderer, its leaves wispy, narrow and hanging as if wilted
 * (they are not, it is the sort), its trusses of few big heart-shaped tomatoes, broad-shouldered, ribbed, drawn to a
 * point, pinkish red when ripe and later to ripen. The round tomato, from one seed: flat, round, hairy and beige,
 * three millimetres across, sown half a centimetre deep. Two long narrow seed leaves; then a hairy stem tied up a
 * cane, a compound leaf at every node — ragged lobed leaflets in pairs with small ones between, drooping — and every
 * third node a truss of nodding yellow star flowers, their anthers fused into a cone. The fruit sets green, swells,
 * and ripens truss by truss from the bottom up, each tomato from its blossom end: green, breaker yellow-orange, red.
 * Below: a taproot, a dense fibrous mat of laterals and roots sprung from the buried stem.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, Space, about, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { bloom } from './bloom.js';
import { pinnate } from './leaves.js';

/** the round garden tomato's stages */
export const STAGES = [
	{ name: 'Seed', day: 0, note: 'A flat, hairy, beige seed three millimetres across, half a centimetre down in warm soil.' },
	{ name: 'Germination', day: 5, note: 'The radicle goes down; the hypocotyl arches up through the soil, the seed coat still on the seed leaves.' },
	{ name: 'Seed leaves', day: 10, note: 'Two long narrow cotyledons open on a hairy purple-green stem.' },
	{ name: 'True leaves', day: 21, note: 'The first compound leaves, their leaflets ragged and lobed, smelling of tomato when touched.' },
	{ name: 'Staked', day: 40, note: 'Planted out and tied to a cane: a leaf at every node, the stem thickening, roots from the buried stem.' },
	{ name: 'Flowering', day: 55, note: 'The first truss of nodding yellow stars opens; more trusses follow every three leaves.' },
	{ name: 'Fruit set', day: 65, note: 'The petals wither; small green tomatoes swell on the first truss, the next truss in flower.' },
	{ name: 'Green fruit', day: 80, note: 'Trusses of hard green tomatoes, full-sized below, smaller above; the lowest leaves yellow.' },
	{ name: 'Breaker', day: 92, note: 'The first truss breaks colour from the blossom end: yellow, orange, blushing red.' },
	{ name: 'Ripe', day: 105, note: 'Red trusses from the bottom up, green ones still swelling at the top: picking time.' }
];

/** the Ochsenherz's stages: as tall as a person, few and huge fruit, later */
export const OXHEART_STAGES = [
	{ name: 'Seed', day: 0, note: 'A flat, hairy, beige seed, half a centimetre down: oxhearts are sown a few weeks before other tomatoes.' },
	{ name: 'Germination', day: 6, note: 'The radicle goes down; the hypocotyl hooks up through the soil.' },
	{ name: 'Seed leaves', day: 11, note: 'Two long narrow cotyledons on a hairy stem.' },
	{ name: 'True leaves', day: 24, note: 'The first compound leaves — already thinner and droopier than a round tomato’s.' },
	{ name: 'Staked', day: 45, note: 'Tied to a tall cane, slender and fast: its wispy leaves hang and twist, as if wilting. They are fine.' },
	{ name: 'Flowering', day: 62, note: 'The first truss opens, its first flower often a big double one: that becomes the largest fruit.' },
	{ name: 'Fruit set', day: 72, note: 'Only three to five fruit set per truss; each swells fast, already heart-shaped.' },
	{ name: 'Green fruit', day: 92, note: 'Heavy green hearts, broad-shouldered and ribbed, pulling the trusses down.' },
	{ name: 'Breaker', day: 110, note: 'About sixty-five days from the flower, the first heart blushes from its point up, its shoulders green the longest.' },
	{ name: 'Ripe', day: 125, note: 'Pink-red hearts of three or four hundred grams, meaty with few seeds; the stem nearly two metres high.' }
];

/**
 * @typedef {{
 *   height: [number, number][], stake: number, leaflet: { length: number, width: number, shape: (u: number) => number },
 *   droop: number, curl: number, lift: [number, number], fruits: [number, number], fruit: (o: Fruit) => void, setFor: number,
 *   ripeFrom: number, ripeFor: number, double: boolean, truss: number,
 *   balls: (at: THREE.Vector3, dir: THREE.Vector3, size: number, set: number) => { c: THREE.Vector3, r: number }[]
 * }} Sort — how a tomato grows: its height through the stages, its leaves (and how they hang), how many fruit to a
 *   truss (at least, and up to how many more), the fruit it bears and the room it takes (`balls`, so the fruit keep
 *   clear of each other, the stem and the cane), the truss's length, how long the fruit take to set and to ripen
 */
/** @typedef {{ bag: Bag, seed: string, key: (string | number)[], at: THREE.Vector3, dir: THREE.Vector3, size: number, set: number, ripe: number }} Fruit */

const SEED_AT = v3(0, -0.006, 0);
const STAKE = v3(0.035, 0, -0.01);
const NODES = 22;

/** the tomato's leaflet: ovate, pointed, its edge cut into a few rounded lobes and toothed */
function leafletShape(/** @type {number} */ u) {
	const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.75);
	const lobes = u > 0.12 && u < 0.82 ? 0.16 * Math.max(0, Math.sin(u * Math.PI * 5.2)) : 0;
	const teeth = u > 0.1 && u < 0.95 ? ((u * 15) % 1) * 0.07 : 0;
	return body * (1 + lobes + teeth);
}

/** an oxheart's leaflet: long and narrow, barely lobed, finely toothed */
function wispyShape(/** @type {number} */ u) {
	const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.9) * (1 - 0.25 * u);
	const lobes = u > 0.15 && u < 0.6 ? 0.08 * Math.max(0, Math.sin(u * Math.PI * 6)) : 0;
	const teeth = u > 0.1 && u < 0.95 ? ((u * 18) % 1) * 0.06 : 0;
	return body * (1 + lobes + teeth);
}

/** @type {Sort} */
const ROUND = {
	height: [[2.1, 0], [3, 0.06], [4, 0.38], [5, 0.78], [6, 1.02], [7, 1.22], [8, 1.38], [9, 1.5]],
	stake: 1.75,
	leaflet: { length: 0.088, width: 0.042, shape: leafletShape },
	droop: 0,
	curl: 0,
	lift: [0.25, 0.55],
	fruits: [4, 4],
	fruit: (o) => roundFruit(o),
	setFor: 1.5,
	ripeFrom: 2.8,
	ripeFor: 0.6,
	double: false,
	truss: 0.11,
	balls: (at, dir, size, set) => {
		const R = 0.027 * size * lerp(0.15, 1, set);
		return [{ c: at.clone().addScaledVector(dir, 0.002 + R * 0.85), r: R * 0.98 }];
	}
};

/** @type {Sort} */
const OXHEART = {
	height: [[2.1, 0], [3, 0.07], [4, 0.44], [5, 0.9], [6, 1.2], [7, 1.48], [8, 1.7], [9, 1.88]],
	stake: 2.15,
	leaflet: { length: 0.098, width: 0.026, shape: wispyShape },
	droop: 0.14,
	curl: 0.35,
	lift: [-0.05, 0.25],
	fruits: [3, 3],
	fruit: (o) => heartFruit(o),
	setFor: 1.9,
	ripeFrom: 3.1,
	ripeFor: 0.6,
	double: true,
	truss: 0.17,
	balls: (at, dir, size, set) => {
		const R = 0.043 * size * lerp(0.15, 1, set);
		return [
			{ c: at.clone().addScaledVector(dir, 0.002 + R * 0.7), r: R * 0.98 },
			{ c: at.clone().addScaledVector(dir, 0.002 + R * 1.5), r: R * 0.62 }
		];
	}
};

/**
 * The round garden tomato at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export const tomato = (g, seed) => grow(ROUND, g, seed);

/**
 * The Ochsenherz at a stage (0 … 9) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export const oxheart = (g, seed) => grow(OXHEART, g, seed);

/**
 * @param {Sort} sort
 * @param {number} g
 * @param {string} seed
 */
function grow(sort, g, seed) {
	const bag = new Bag();
	const r = chance(seed, 'plant');
	const vigour = about(r, 1, 0.1);

	const s = sprout(bag, {
		seed,
		at: SEED_AT,
		size: v3(0.0016, 0.0005, 0.0014),
		coat: '#d8c39a',
		coatShade: '#b39a6a',
		stem: table(g, [[0, 0], [0.3, 0.0008], [1, 0.011], [2, 0.034], [3, 0.04], [9, 0.042]]),
		hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0009 + 0.0035 * span(g, 2, 6),
		stemColor: '#6f8f45',
		leaf: { length: 0.026, width: 0.0038, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.9)), 0.8), color: '#4f8a35', vein: '#9cc277' },
		open: span(g, 1.1, 2),
		shed: span(g, 1.0, 1.6),
		wither: span(g, 4.6, 5.6)
	});

	// the taproot, its fibrous laterals, and later the roots from the buried stem
	root(bag, { seed, key: ['taproot'], from: SEED_AT.clone(), dir: v3(0.03, -1, 0), length: 0.45, grown: table(g, [[0, 0], [0.35, 0.006], [1, 0.05], [2, 0.14], [3, 0.3], [4, 0.6], [5, 0.85], [7, 1]]), radius: 0.0022, down: 0.04, wander: 0.15, laterals: 0, depth: 0, age: span(g, 2, 6), young: '#f7f1e0', old: '#c9ab82' });
	const lr = chance(seed, 'laterals');
	for (let i = 0; i < 30; i++) {
		const at = 0.005 + i * 0.011 + lr() * 0.005;
		const born = 1.3 + i * 0.13;
		const bear = i * 2.39996 + lr() * 0.5;
		root(bag, { seed, key: ['lateral', i], from: SEED_AT.clone().add(v3(0, -at, 0)), dir: v3(Math.cos(bear), -0.45, Math.sin(bear)), length: between(lr, 0.12, 0.26) * vigour, grown: (g - born) / 2.5, radius: 0.0011, down: 0.05, wander: 0.32, laterals: 7, lateral: 0.3, depth: 2, age: (g - born - 1) / 3, young: '#f6efdc', old: '#c4a37a' });
	}
	for (let i = 0; i < 10; i++) {
		const ar = chance(seed, 'adventitious', i);
		const born = 4 + i * 0.12;
		const bear = ar() * Math.PI * 2;
		root(bag, { seed, key: ['stem', i], from: v3(0, -0.004 - ar() * 0.02, 0), dir: v3(Math.cos(bear), -0.3, Math.sin(bear)), length: between(ar, 0.1, 0.2), grown: (g - born) / 2, radius: 0.001, down: 0.06, wander: 0.3, laterals: 5, depth: 1, age: (g - born - 1) / 3, young: '#f6efdc', old: '#c8a77c' });
	}

	// what is where: the cane, the stem, the fruit, for the fruit and leaves to keep clear of
	const space = bag.space;
	if (g >= 3.6) space.rod([STAKE.clone(), STAKE.clone().add(v3(0, sort.stake, 0))], 0.008);
	if (g >= 3.6) bag.add('prop', tube([STAKE.clone().add(v3(0, -0.25, 0)), STAKE.clone().add(v3(0, sort.stake, 0))], (u) => 0.0055 * (1 - 0.3 * u), (u) => mix('#c8a865', '#d9c08a', Math.abs(Math.sin(u * 60)) < 0.06 ? 0 : 1), 8));

	const L = table(g, sort.height) * vigour;
	if (L > 0.002) stem(bag, sort, seed, s.top, L, g, vigour, space);
	return bag.build();
}

/**
 * The stem: up the cane in a slight zigzag (node to node), its leaves, its trusses.
 * @param {Bag} bag @param {Sort} sort @param {string} seed @param {THREE.Vector3} start @param {number} L @param {number} g @param {number} vigour
 * @param {Space} space
 */
function stem(bag, sort, seed, start, L, g, vigour, space) {
	const vr = chance(seed, 'stem');
	const step = 0.02;
	const pts = [start.clone()];
	for (let s = step; s <= 2.1; s += step) {
		const toStake = clamp(s / 0.2);
		const zig = Math.sin(s * 40 + vr() * 0.4) * 0.006;
		pts.push(v3(lerp(start.x, STAKE.x - 0.012, toStake) + zig, start.y + s * 0.985, lerp(start.z, STAKE.z + 0.006, toStake) + zig * 0.5));
	}
	const n = Math.min(pts.length - 1, L / step);
	const whole = Math.floor(n);
	const now = pts.slice(0, whole + 1);
	if (whole < pts.length - 1) now.push(pts[whole].clone().lerp(pts[whole + 1], n - whole));
	if (now.length < 2) return;
	const thick = 0.0022 + 0.0042 * span(g, 3, 7);
	bag.add('body', tube(now, (u) => thick * (1 - 0.6 * Math.pow(u, 2)), (u) => mix('#5f7f3a', '#86ae55', u), 7));
	space.rod(now, thick + 0.004);
	/** the leaves wait until the fruit hang, then turn away from them @type {(() => void)[]} */
	const leaves = [];
	const at = (/** @type {number} */ s) => {
		const f = Math.min(pts.length - 1.001, s / step), k = Math.floor(f);
		return pts[k].clone().lerp(pts[k + 1], f - k);
	};

	let s = 0.025;
	let truss = 0;
	for (let i = 0; i < NODES; i++) {
		const nr = chance(seed, 'node', i);
		s += i === 0 ? 0 : between(nr, 0.055, 0.075);
		const past = L - s;
		if (past <= 0) break;
		const p = at(s);
		const bear = i * 2.4 + about(nr, 0, 0.25);
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		const size = lerp(0.35, 1, clamp(i / 6)) * about(nr, 1, 0.1) * vigour;
		const old = i < 4 ? span(g, 6.8 + i * 0.25, 8.2 + i * 0.25) : 0;
		const lift = between(nr, sort.lift[0], sort.lift[1]);
		if (old < 1) leaves.push(() =>
			pinnate(bag, {
				seed,
				key: ['leaf', i],
				at: p,
				out: space.steer(p, out, lift - sort.droop, 0.34 * size, sort.leaflet.width * size * 0.7),
				lift,
				length: 0.34 * size,
				pairs: i < 2 ? 1 : i < 4 ? 2 : i < 7 ? 3 : 4,
				between: i >= 3,
				leaflet: { length: sort.leaflet.length * size, width: sort.leaflet.width * size, shape: sort.leaflet.shape, colour: '#3c7230', young: '#6aa84a', vein: '#8fbf6e' },
				droop: sort.droop,
				curl: sort.curl,
				grown: clamp(past / 0.2),
				old,
				stalk: '#6f9a45',
				radius: 0.0016 * size + 0.0006,
				terminal: 1.15
			})
		);
		// a truss every third node from the seventh, set off the leaf's side
		if (i >= 6 && (i - 6) % 3 === 0) {
			trussAt(bag, sort, seed, truss, p, out.clone().applyAxisAngle(v3(0, 1, 0), Math.PI * 0.8), g, past, vigour, space);
			truss++;
		}
	}
	for (const leaf of leaves) leaf();
	bag.add('body', bead(now[now.length - 1], v3(1, 1.3, 1).multiplyScalar(0.004), '#86b85a'));
}

/** a tomato flower: six yellow petals bent back into a star, the anthers a yellow cone */
const FLOWER = { petals: 6, length: 0.011, width: 0.0028, colour: '#f2d22a', heart: '#e6bf1a', cone: true, flat: 0.55, sepals: 6, sepal: 0.008, sepalBack: 0.4, sepalColour: '#5a8a35', shape: (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.5)), 0.6) * (1 - 0.4 * u) };

/**
 * A truss: a stalk out and down from the stem, its flowers along it on jointed pedicels, nodding; then its fruit,
 * growing heavy, the whole truss hanging.
 * @param {Bag} bag @param {Sort} sort @param {string} seed @param {number} t which truss, from the bottom @param {THREE.Vector3} at
 * @param {THREE.Vector3} out @param {number} g @param {number} past how far the stem has grown past it @param {number} vigour
 * @param {Space} space
 */
function trussAt(bag, sort, seed, t, at, out, g, past, vigour, space) {
	const tr = chance(seed, 'truss', t);
	const born = 4.3 + t * 0.55 + tr() * 0.1;
	if (g <= born || past < 0.04) return;
	const grown = clamp((g - born) / 0.5);
	const heavy = span(g, born + 1.2, born + 2.4);
	const len = sort.truss * lerp(0.3, 1, grown) * about(tr, 1, 0.15);
	/** @type {THREE.Vector3[]} */
	const pts = [];
	let d = out.clone().multiplyScalar(0.8).add(v3(0, 0.45 - heavy * 0.7, 0)).normalize();
	let p = at.clone();
	for (let k = 0; k <= 10; k++) {
		pts.push(p.clone());
		d = d.clone().add(v3(0, -0.06 - heavy * 0.06, 0)).normalize();
		p = p.clone().addScaledVector(d, len / 10);
	}
	bag.add('body', tube(pts, (u) => 0.0018 * (1 - 0.4 * u), () => '#6c9442', 5));
	const flowers = sort.fruits[0] + Math.floor(tr() * (sort.fruits[1] + 1));
	for (let k = 0; k < flowers; k++) {
		const fr = chance(seed, 'tomato-flower', t, k);
		const opens = born + 0.35 + k * 0.1 + fr() * 0.05;
		const u = lerp(0.25, 1, k / Math.max(1, flowers - 1));
		const f = u * 10, kk = Math.min(9, Math.floor(f));
		const base = pts[kk].clone().lerp(pts[kk + 1], f - kk);
		// the pedicel: down and a little to one side, a knuckle halfway
		const side = new THREE.Vector3().crossVectors(d, v3(0, 1, 0)).normalize().multiplyScalar(k % 2 ? 1 : -1);
		const set = span(g, opens + 0.5, opens + 0.5 + sort.setFor);
		// an oxheart's first flower is often a big double one (fasciated): the biggest fruit of the plant
		const double = sort.double && t === 0 && k === 0;
		const pd = side.multiplyScalar(0.5).add(v3(0, -0.6 - set * 0.4, 0)).addScaledVector(d, 0.2).normalize();
		const end = base.clone().addScaledVector(pd, 0.018 * lerp(0.4, 1, clamp((g - born) / 0.4)));
		if (g < opens || set < 0.03) bag.add('body', tube([base, end], () => 0.0008, () => '#6c9442', 4));
		if (g < opens) {
			const b = clamp((g - born) / Math.max(0.05, opens - born));
			bag.add('body', bead(end.clone().addScaledVector(pd, 0.003), v3(0.0018, 0.004, 0.0018).multiplyScalar(0.5 + b * 0.5), mix('#7fae4a', '#d8d05a', b * 0.6)));
		} else if (set < 0.03) {
			bloom(bag, FLOWER, end, pd, double ? 1.9 : 1.35, clamp((g - opens) / 0.2), span(g, opens + 0.3, opens + 0.5));
		} else {
			const size = vigour * (double ? 1.3 : k < 4 ? 1 : 0.8) * about(fr, 1, 0.1);
			// it hangs where it touches nothing: swung aside, its stalk a little longer if need be
			const place = space.settle(end, v3(0, -1, 0).lerp(pd, 0.25), (a, d) => sort.balls(a, d, size, set), 0.04);
			// one tomato, picked with its pedicel from the truss
			bag.fruit([t, k], base, place.dir);
			bag.add('body', tube([base, end, place.at], () => 0.0008 + 0.0008 * set, () => '#6c9442', 4));
			sort.fruit({ bag, seed, key: [t, k], at: place.at, dir: place.dir, size, set, ripe: span(g, opens + sort.ripeFrom, opens + sort.ripeFrom + sort.ripeFor) });
			bag.fruitDone();
		}
	}
}

/**
 * A tomato: round, flattened a little, softly ribbed, glossy; green, darker at its shoulders, then from the blossom
 * end yellow-orange (the breaker) and red. Its calyx a green star at its top.
 * @param {Fruit} o
 */
function roundFruit(o) {
	const bag = o.bag;
	const fr = chance(o.seed, 'tomato', ...o.key);
	const R = 0.027 * o.size * lerp(0.15, 1, o.set);
	const H = R * between(fr, 1.55, 1.8);
	const ribs = 5 + Math.floor(fr() * 3);
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir), v3(1, 1, 1));
	const axis = [];
	for (let k = 0; k <= 14; k++) axis.push(v3(0, -0.002 - (k / 14) * H, 0));
	const colour = (/** @type {number} */ u) => {
		const here = clamp(o.ripe * 1.6 - (1 - u) * 0.6);
		if (here <= 0) return mix('#4f8a32', '#7fae4a', u * 1.2);
		return here < 0.45 ? mix('#86b04a', '#e9a43a', here / 0.45) : mix('#e9a43a', '#d42c1a', (here - 0.45) / 0.55);
	};
	bag.add('gloss', tube(axis, (u, v) => R * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.55) * (1 + 0.04 * Math.cos(v * Math.PI * 2 * ribs) * Math.sin(Math.PI * u)), (u) => colour(u), 18), m);
	for (let k = 0; k < 6; k++) {
		const sepal = sheet({ length: 0.013 * o.size, width: 0.0018 * o.size, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.5)) * (1 - u * 0.5), lift: (u) => 0.1 * u + 0.15 * u * u, paint: () => '#4f7f2c', along: 6, across: 2 });
		bag.add('sheet', sepal, m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 6) * Math.PI * 2 + fr())).multiply(new THREE.Matrix4().makeRotationZ(-0.25)));
	}
	bag.add('body', bead(v3(0, -0.001, 0), v3(0.0018, 0.0018, 0.0018), '#5c7f34'), m);
}


/**
 * An oxheart: a big heart hanging point-down — broad shoulders under the calyx, deeply ribbed there, drawn down to a
 * blunt point. Green, darkest at its shoulders; it ripens from the point up to a pinkish red, the shoulders last.
 * @param {Fruit} o
 */
function heartFruit(o) {
	const bag = o.bag;
	const fr = chance(o.seed, 'oxheart', ...o.key);
	const R = 0.043 * o.size * lerp(0.15, 1, o.set);
	const H = R * between(fr, 1.9, 2.2);
	const ribs = 6 + Math.floor(fr() * 3);
	const lean = about(fr, 0, 0.12);
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir), v3(1, 1, 1));
	const axis = [];
	for (let k = 0; k <= 18; k++) {
		const u = k / 18;
		axis.push(v3(lean * H * u * u, -0.002 - u * H, 0));
	}
	// rounded over the shoulders, broadest a third down, then tapering to the point
	const radius = (/** @type {number} */ u, /** @type {number} */ v) => {
		const body = u < 0.36 ? Math.pow(Math.sin((Math.PI / 2) * (u / 0.36)), 0.55) : Math.pow((1 - u) / 0.64, 0.8) * (1 - 0.15 * Math.sin(Math.PI * (u - 0.36) / 0.64));
		const rib = 1 + 0.1 * Math.cos(v * Math.PI * 2 * ribs) * Math.max(0, 1 - u * 1.6);
		return R * body * rib;
	};
	const colour = (/** @type {number} */ u) => {
		const here = clamp(o.ripe * 1.5 - (1 - u) * 0.7);
		if (here <= 0) return mix('#3f7a2c', '#86b552', u * 1.1);
		return here < 0.4 ? mix('#8db352', '#e2914a', here / 0.4) : mix('#e2914a', '#d2414a', (here - 0.4) / 0.6);
	};
	bag.add('gloss', tube(axis, radius, (u) => colour(u), 24), m);
	for (let k = 0; k < 6; k++) {
		const sepal = sheet({ length: 0.02 * o.size, width: 0.0024 * o.size, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.5)) * (1 - u * 0.5), lift: (u) => 0.12 * u + 0.2 * u * u, paint: () => '#4f7f2c', along: 6, across: 2 });
		bag.add('sheet', sepal, m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 6) * Math.PI * 2 + fr())).multiply(new THREE.Matrix4().makeRotationZ(-0.2)));
	}
	bag.add('body', bead(v3(0, -0.001, 0), v3(0.0024, 0.0024, 0.0024), '#5c7f34'), m);
}
