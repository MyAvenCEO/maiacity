/*
 * GREENS — two leaf crops picked a few leaves at a time for months: Swiss chard (Mangold) and kale (Grünkohl).
 * Their last four stages are the harvest's own.
 *
 * Swiss chard is a beet grown for its leaves: a rosette from a short crown, big glossy blistered leaves on thick,
 * broad, juicy stalks — red, yellow, orange, pink or white, one colour a plant, the colour running on into the midrib
 * and the veins. The outer leaves are twisted off at the base as they grow, the new ones keep coming from the middle.
 *
 * Kale is a cabbage that never heads: an upright stem setting leaf after leaf from its top, each leaf long-stalked and
 * blue-green — curled and frilled to the edge (curly kale), or long, narrow and blistered (Lacinato, cavolo nero). The
 * lowest leaves are picked off, leaving scars up a bare stem, so by winter it is a crown of leaves on a stalk like a
 * little palm, sweeter for every frost.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/* ------------------------------------------------------------------------------------------------ Swiss chard */

export const CHARD_STAGES = stages([
	['Seed', 0, 'A corky, knobbly seed cluster (several seeds in one), two centimetres down.'],
	['Germination', 7, 'One cluster, two or three seedlings: the radicles go down, the hooks come up.'],
	['Seed leaves', 12, 'Two long narrow seed leaves on a stem already red, yellow or white.'],
	['True leaves', 25, 'The first true leaves, glossy, on coloured stalks.'],
	['Rosette', 40, 'A rosette of glossy, blistered leaves on broad stalks.'],
	['Baby leaf', 50, 'Leaves a hand long: picked young for salads.'],
	['First picking', 60, 'The outer leaves full-sized: twist them off at the base.'],
	['Cut and come again', 75, 'Picked from the outside, new leaves keep coming from the middle.'],
	['Full', 90, 'Big crinkled leaves, half a metre tall on thick bright stalks.'],
	['Harvest', 110, 'Picked all summer and into the autumn; it stands the first frosts.']
]);

/** the stalk colours: red, yellow, white, orange, pink — one colour a plant, by its seed */
const CHARD = [
	{ stalk: '#c41e34', vein: '#b01a30', leaf: '#2a4a24' },
	{ stalk: '#e8be22', vein: '#d8b030', leaf: '#356a28' },
	{ stalk: '#f0ede0', vein: '#d8dcc0', leaf: '#2f6428' },
	{ stalk: '#e8782a', vein: '#d8702a', leaf: '#2f5a26' },
	{ stalk: '#e0508a', vein: '#c84a7a', leaf: '#2c5226' }
];

/** a chard leaf: a broad oval, the base running into the stalk */
const chardLeaf = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.6) * (u < 0.08 ? 0.35 + u * 8 : 1);

/**
 * Swiss chard at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function chard(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const pick = chance(seed, 'chard-colour')();
	const sort = CHARD[pick < 0.32 ? 0 : pick < 0.6 ? 1 : pick < 0.8 ? 2 : pick < 0.92 ? 3 : 4];
	const at = v3(0, -0.012, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.004, 0.0035, 0.004), coat: '#9a8058', coatShade: '#6a5438',
		stem: table(g, [[0, 0], [0.3, 0.001], [1, 0.014], [2, 0.026], [9, 0.026]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.001 + 0.006 * span(g, 2, 6), stemColor: sort.stalk,
		leaf: { length: 0.022, width: 0.0035, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.6), color: '#4f8a35', vein: '#9cc277' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 3.5, 4.5)
	});
	// a beet's taproot, a little swollen at the top, and its fibrous laterals
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.45, grown: table(g, [[0, 0], [0.3, 0.02], [1, 0.08], [3, 0.4], [5, 0.8], [7, 1]]), radius: 0.003 + 0.007 * span(g, 3, 8), down: 0.05, wander: 0.12, laterals: 14, lateral: 0.4, depth: 2, age: span(g, 3, 8), young: '#f6efdc', old: mix('#d8c49a', sort.stalk, 0.25).getStyle() });
	const crown = s.top.clone();
	const space = bag.space;
	// the leaves from the middle: the older ones outside, picked from the outside from the first picking on
	const leaves = 30;
	for (let i = 0; i < leaves; i++) {
		const born = 2 + i * 0.27;
		if (g <= born) break;
		if (g > 6.3 + i * 0.3) continue;
		const lr = chance(seed, 'chard-leaf', i);
		const grown = clamp((g - born) / 1.5);
		const len = (0.07 + 0.5 * clamp(i / 9)) * vigour * about(lr, 1, 0.07) * lerp(0.25, 1, grown);
		const bear = i * 2.39996 + about(lr, 0, 0.15);
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		// young ones upright in the middle, older ones leaning out
		const lean = lerp(0.12, between(lr, 0.45, 0.8), grown);
		const stalkLen = len * 0.42;
		const from = crown.clone().addScaledVector(out, 0.004 + 0.008 * clamp(i / 10));
		const dir = out.clone().multiplyScalar(Math.sin(lean)).add(v3(0, Math.cos(lean), 0)).normalize();
		const mid = from.clone().addScaledVector(dir, stalkLen * 0.5);
		const top = mid.clone().addScaledVector(dir.clone().addScaledVector(out, 0.15).normalize(), stalkLen * 0.5);
		const w = (0.0035 + 0.007 * clamp(i / 9)) * vigour * lerp(0.4, 1, grown);
		// the stalk: broad and flattened, a groove up its inner face
		bag.add('gloss', tube([from, mid, top], (u, v) => w * (1 - 0.45 * u) * (0.75 + 0.35 * Math.abs(Math.cos(v * Math.PI * 2 + bear))), (u, v) => mix(sort.stalk, '#fffaf0', 0.12 * Math.abs(Math.sin(v * Math.PI * 6))), 7));
		space.rod([from, top], w);
		const bladeDir = dir.clone().addScaledVector(out, 0.35).add(v3(0, -0.1, 0)).normalize();
		const blade = len * 0.6;
		const crinkle = lerp(0.3, 1, grown);
		bag.add(
			'sheet',
			sheet({
				length: blade,
				width: blade * 0.36,
				shape: chardLeaf,
				// cupped, arching, blistered (savoyed) between the veins
				lift: (u, v) => 0.1 * v * v - 0.1 * u * u + 0.018 * crinkle * Math.sin(u * 26 + v * 3) * Math.sin(v * 9) * (0.4 + Math.abs(v)),
				paint: (u, v) => {
					const base = mix(mix(sort.leaf, '#6aa848', (1 - grown) * 0.6), '#a8c070', 0.06);
					// the midrib the stalk's colour, the veins tinted with it
					if (Math.abs(v) < 0.06 * (1 - u * 0.6)) return mix(sort.stalk, base, u * 0.5);
					return base.lerp(new THREE.Color(sort.vein), Math.abs(Math.sin(u * 13 - Math.abs(v) * 4.5)) > 0.94 ? 0.5 * (1 - u * 0.5) : 0);
				},
				along: 16,
				across: 8
			}),
			aim(top, bladeDir, 0)
		);
	}
	// the stumps of the picked leaves round the crown
	for (let i = 0; i < leaves; i++) {
		if (!(g > 6.3 + i * 0.3) || i > 18) continue;
		const bear = i * 2.39996;
		bag.add('body', bead(crown.clone().add(v3(Math.cos(bear) * 0.016, -0.002, Math.sin(bear) * 0.016)), v3(0.006, 0.004, 0.006), mix(sort.stalk, '#8a7a5a', 0.6), 4));
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ kale */

export const KALE_STAGES = stages([
	['Seed', 0, 'A round dark-brown seed two millimetres across, a centimetre down.'],
	['Germination', 4, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 8, 'Two heart-shaped seed leaves, notched at the tip, on a purplish stem.'],
	['True leaves', 20, 'The first true leaves, already blue-green and waxy.'],
	['Young plant', 40, 'A rosette on a short, stout stem.'],
	['Leafy', 60, 'Big leaves on long stalks, new ones from the top as the stem lengthens.'],
	['First picking', 80, 'The lowest leaves snapped off down at the stem, leaving scars.'],
	['Picking', 110, 'Picked from the bottom up week by week; the stem rises bare and scarred.'],
	['Winter', 150, 'Frost sweetens it: a crown of leaves on a scarred stem, like a little palm.'],
	['Harvest', 180, 'Still picking from the crown through the winter; in spring it will flower.']
]);

/** curly kale's leaf: oblong, its edge frilled; Lacinato's: long and narrow, rounded at the tip */
const curlyLeaf = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.55) * (0.72 + 0.28 * Math.abs(Math.sin(u * 23))) * (u < 0.1 ? u * 6 + 0.4 : 1);
const strapLeaf = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.5) * (u < 0.08 ? u * 8 + 0.3 : 1);

/**
 * Kale at a stage (0 … 9, between them on the way) from the seed id: curly or Lacinato, by the seed.
 * @param {number} g @param {string} seed
 */
export function kale(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const curly = chance(seed, 'kale-sort')() < 0.55;
	const at = v3(0, -0.008, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0011, 0.001, 0.001), coat: '#5a3a2a', coatShade: '#3a2418',
		stem: table(g, [[0, 0], [0.3, 0.0008], [1, 0.012], [2, 0.022], [9, 0.022]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0009 + 0.004 * span(g, 2, 6), stemColor: '#7a6a8a',
		leaf: { length: 0.011, width: 0.007, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.6) * (1 - 0.35 * Math.exp(-Math.pow((u - 1) / 0.12, 2))), color: '#5a8a5a', vein: '#9cc0a0' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 3.6, 4.6)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.4, grown: table(g, [[0, 0], [0.3, 0.02], [1, 0.08], [3, 0.4], [5, 0.85], [7, 1]]), radius: 0.003 + 0.006 * span(g, 3, 8), down: 0.04, wander: 0.15, laterals: 14, lateral: 0.4, depth: 2, age: span(g, 3, 8), young: '#f6efdc', old: '#c8b08a' });

	// the stem: a node for every leaf, close together low down, further apart as it rises
	const n = 28;
	const born = (/** @type {number} */ i) => 2.2 + i * 0.25;
	const node = (/** @type {number} */ i) => (i < 8 ? i * 0.007 : 0.056 + (i - 8) * 0.019) * vigour;
	const sr = chance(seed, 'kale-stem');
	const lean = v3(sr() - 0.5, 0, sr() - 0.5).multiplyScalar(0.12);
	const stemAt = (/** @type {number} */ h) => s.top.clone().add(v3(lean.x * h * h * 2, h, lean.z * h * h * 2));
	let last = -1;
	for (let i = 0; i < n; i++) if (g > born(i)) last = i;
	if (last >= 0) {
		const H = node(last) + 0.012 * clamp(g - born(last));
		const pts = [];
		for (let m = 0; m <= 12; m++) pts.push(stemAt((m / 12) * H));
		const R = (0.004 + 0.014 * span(g, 3, 8.5)) * vigour;
		bag.add('body', tube(pts, (u) => R * (1 - 0.35 * u), (u) => mix('#8a9a8a', '#6a8a6a', u), 8));
		bag.space.rod(pts, R);
	}
	const picked = (/** @type {number} */ i) => g > 5.7 + i * 0.24;
	for (let i = 0; i <= last; i++) {
		const lr = chance(seed, 'kale-leaf', i);
		const bear = i * 2.39996 + about(lr, 0, 0.1);
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		const p = stemAt(node(i));
		if (picked(i)) {
			// the scar where the leaf was snapped off: a pale half-moon
			if (i >= 2) bag.add('body', bead(p.clone().addScaledVector(out, 0.008 + 0.008 * span(g, 3, 8.5)), v3(0.007, 0.0035, 0.004), '#c8ccb0', 3, new THREE.Quaternion().setFromUnitVectors(v3(1, 0, 0), out)));
			continue;
		}
		const grown = clamp((g - born(i)) / 1.6);
		const size = (0.1 + 0.42 * clamp(i / 10)) * vigour * about(lr, 1, 0.07) * lerp(0.25, 1, grown);
		// the young leaves at the top stand up; the older ones spread
		const tilt = lerp(0.15, between(lr, 0.8, 1.15), grown);
		const dir = out.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
		const stalk = size * 0.28;
		const from = p.clone().addScaledVector(out, 0.006);
		const top = from.clone().addScaledVector(dir, stalk);
		bag.add('body', tube([from, top], (u) => 0.0035 * lerp(0.5, 1, grown) * (1 - 0.3 * u), () => (curly ? '#8aa88a' : '#9aa898'), 5));
		const bladeDir = dir.clone().add(v3(0, -0.12, 0)).normalize();
		const blade = size * 0.8;
		const colour = curly ? mix('#4a7a52', '#3a6650', lr() * 0.6) : mix('#2e4a44', '#36524a', lr());
		if (curly) {
			bag.add(
				'sheet',
				sheet({
					length: blade,
					width: blade * 0.24,
					shape: curlyLeaf,
					// curled under at the edges, and frilled
					lift: (u, v) => 0.12 * v * v - 0.14 * u * u + 0.05 * Math.pow(Math.abs(v), 1.6) * Math.sin(u * 64 + v * 9) * lerp(0.4, 1, grown),
					paint: (u, v) => colour.clone().lerp(new THREE.Color('#b8c8b0'), Math.abs(v) < 0.07 ? 0.55 : 0).lerp(new THREE.Color('#6a9a6a'), Math.abs(v) > 0.85 ? 0.3 : 0),
					along: 26,
					across: 8
				}),
				aim(top, bladeDir, 0)
			);
		} else {
			bag.add(
				'sheet',
				sheet({
					length: blade * 1.1,
					width: blade * 0.11,
					shape: strapLeaf,
					// blistered all over, arching over and down at the tip
					lift: (u, v) => 0.03 * v * v - 0.22 * u * u + 0.012 * Math.sin(u * 52) * Math.sin(v * 7.5) * lerp(0.3, 1, grown),
					paint: (u, v) => colour.clone().lerp(new THREE.Color('#b0bca8'), Math.abs(v) < 0.08 ? 0.55 : 0).lerp(new THREE.Color('#5a7a70'), Math.max(0, Math.sin(u * 52) * Math.sin(v * 7.5)) * 0.35),
					along: 24,
					across: 6
				}),
				aim(top, bladeDir, 0)
			);
		}
	}
	return bag.build();
}
