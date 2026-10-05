/*
 * VEGETABLES — the ones grown for their roots, their leaves and their bulbs: the radish, the carrot, the butterhead
 * lettuce (Kopfsalat) and garlic (Knoblauch). Their last four stages are the harvest's own: the root swelling, the
 * head closing, the bulb splitting into cloves.
 *
 * The radish's root is its swollen hypocotyl, a red ball half out of the soil on a thin white tail; the carrot's a long
 * orange taproot under a fountain of fine ferny leaves; the lettuce's head its inner leaves cupped tight inside the
 * spreading outer ones; garlic is planted as a clove in autumn, roots, puts up its flat leaves, rests through the
 * winter, and in early summer its base swells into a bulb of new cloves while its flower stalk (the scape) curls.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { pinnate } from './leaves.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/* ------------------------------------------------------------------------------------------------ radish */

export const RADISH_STAGES = stages([
	['Seed', 0, 'A round brown seed three millimetres across, a centimetre down.'],
	['Germination', 2, 'Within two days the radicle is out and the hook breaks the soil.'],
	['Seed leaves', 4, 'Two heart-shaped seed leaves, notched at their tips.'],
	['True leaves', 9, 'The first rough, lobed true leaves.'],
	['Rosette', 14, 'A small rosette; below, the stem between root and leaves begins to thicken.'],
	['Swelling', 17, 'The hypocotyl turns red and swells at the soil’s surface.'],
	['Rounding', 20, 'A red ball forming, its white tail root going down.'],
	['Filling', 23, 'The ball fills out, its red shoulders pushing up out of the soil.'],
	['Full', 26, 'Round and firm, two and a half centimetres across.'],
	['Harvest', 28, 'Pull it now, crisp and hot — a week more and it goes woolly.']
]);

/** @param {number} g @param {string} seed */
export function radish(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.1);
	const at = v3(0, -0.01, 0);
	sprout(bag, {
		seed, at, size: v3(0.0016, 0.0014, 0.0014), coat: '#8a5a3a', coatShade: '#5a3a24',
		stem: table(g, [[0, 0], [0.3, 0.001], [1, 0.012], [2, 0.022], [4, 0.024]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0008 + 0.0012 * span(g, 1, 4), stemColor: '#b04a5a',
		leaf: { length: 0.011, width: 0.007, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.6) * (1 - 0.35 * Math.exp(-Math.pow((u - 1) / 0.12, 2))), color: '#5a9a3c', vein: '#9cc46e' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 5, 6.5)
	});
	// the root: the swollen hypocotyl, a red ball at the soil, a white tail below it
	const swell = span(g, 3.5, 9);
	const R = (0.002 + 0.012 * swell) * vigour;
	const top = 0.004 + R * 0.7;
	const ball = [];
	for (let k = 0; k <= 16; k++) ball.push(v3(0, top - (k / 16) * R * 2.3, 0));
	bag.add('gloss', tube(ball, (u) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.04 + u))), 0.6) * (1 - 0.25 * u), (u) => mix('#c8233a', '#f2ede4', clamp((u - 0.82) * 6)).lerp(new THREE.Color('#e04a5a'), 0.15 * (1 - u)), 18));
	root(bag, { seed, key: ['tail'], from: v3(0, top - R * 2.2, 0), dir: v3(0, -1, 0), length: 0.16, grown: table(g, [[0, 0], [0.4, 0.04], [1, 0.12], [2, 0.3], [4, 0.7], [6, 1]]), radius: 0.0012, down: 0.05, wander: 0.15, laterals: 8, lateral: 0.3, depth: 1, young: '#f6f0de', old: '#e9dccb' });
	// the leaves: lobed, rough, on reddish stalks
	for (let i = 0; i < 9; i++) {
		const born = 2 + i * 0.5;
		if (g <= born) break;
		const lr = chance(seed, 'leaf', i);
		const grown = clamp((g - born) / 1.6);
		const bear = i * 2.39996;
		const len = (0.05 + 0.1 * clamp(i / 5)) * vigour * lerp(0.3, 1, grown);
		const tilt = lerp(0.2, between(lr, 0.6, 1.1), grown) + span(g, 8, 9.5) * 0.4 * (i < 3 ? 1 : 0);
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		const dir = out.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
		const base = v3(0, top, 0);
		const stalk = base.clone().addScaledVector(dir, len * 0.35);
		bag.add('body', tube([base, stalk], () => 0.0012, () => '#9a4a5a', 4));
		bag.add('sheet', sheet({ length: len * 0.75, width: len * 0.22, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.7) * (u < 0.55 ? 0.45 + 0.4 * Math.abs(Math.sin(u * Math.PI * 4)) : 1), lift: (u, v) => 0.06 * v * v - 0.12 * u * u, paint: (u, v) => mix('#4f8a3a', '#6aa84a', 1 - grown).lerp(new THREE.Color('#a8c88a'), Math.abs(v) < 0.1 ? 0.4 : 0), along: 18, across: 4 }), aim(stalk, dir.clone().lerp(out, 0.3).normalize()));
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ carrot */

export const CARROT_STAGES = stages([
	['Seed', 0, 'A tiny ridged, bristly seed, a centimetre down; carrots are slow to come up.'],
	['Germination', 10, 'The radicle goes down long before anything shows above.'],
	['Seed leaves', 16, 'Two long, grass-like seed leaves.'],
	['True leaves', 25, 'The first finely divided, ferny true leaf.'],
	['Ferny tops', 40, 'A fountain of ferny leaves; below, the taproot starts to thicken.'],
	['Thickening', 55, 'The taproot fills out at the top and turns orange.'],
	['Lengthening', 65, 'It thickens down its length, fine roots in rows along it.'],
	['Colouring', 75, 'Deep orange through, its shoulders at the soil’s surface.'],
	['Filling out', 85, 'Full, blunt-ended, sweet.'],
	['Harvest', 95, 'Lift it now: twenty centimetres of carrot under the ferny top.']
]);

/** a carrot's leaflet: finely cut, like a fern's */
const ferny = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.8) * (0.25 + 0.75 * Math.abs(Math.sin(u * Math.PI * 4.5)));

/** @param {number} g @param {string} seed */
export function carrot(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.1);
	const at = v3(0, -0.01, 0);
	sprout(bag, {
		seed, at, size: v3(0.0016, 0.0007, 0.0009), coat: '#8a7a5a', coatShade: '#6a5a3a',
		stem: table(g, [[0, 0], [0.5, 0.001], [1.2, 0.014], [2, 0.025], [4, 0.025]]), hook: table(g, [[0, 1], [1.2, 1], [1.7, 0]]),
		radius: 0.0006 + 0.001 * span(g, 1, 4), stemColor: '#7a9a4a',
		leaf: { length: 0.025, width: 0.0018, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.9)), 0.6), color: '#5a9a3c', vein: '#9cc46e' },
		open: span(g, 1.2, 2), shed: span(g, 1.2, 1.7), wither: span(g, 4.5, 6)
	});
	// the taproot: a long orange cone, thickening from the top down as it grows, fine roots in rows along it
	const fill = span(g, 3.5, 9);
	const L = (0.06 + 0.15 * span(g, 2, 7.5)) * vigour;
	const R = (0.0015 + 0.0165 * fill) * vigour;
	const top = 0.006 * fill;
	const axis = [];
	for (let k = 0; k <= 24; k++) axis.push(v3(Math.sin(k * 0.4) * 0.001, top - (k / 24) * L, 0));
	bag.add('body', tube(axis, (u, v) => R * Math.pow(1 - u, 0.75 + 0.6 * (1 - fill)) * Math.min(1, (u + 0.02) / 0.06) * (1 - 0.03 * Math.pow(Math.abs(Math.sin(u * 140)), 8)), (u) => mix(mix('#f2e8d0', '#e8781e', clamp(fill * 1.6 - u * 0.4)), '#7a9a4a', clamp((0.04 - u) * 25) * 0.5), 14));
	root(bag, { seed, key: ['tail'], from: v3(0, top - L, 0), dir: v3(0, -1, 0), length: 0.12, grown: table(g, [[0, 0], [0.5, 0.04], [1.2, 0.15], [3, 0.6], [5, 1]]), radius: 0.0008, down: 0.05, wander: 0.12, laterals: 5, depth: 1, young: '#f6f0de', old: '#e9dccb' });
	for (let k = 0; k < 10; k++) {
		const u = 0.15 + k * 0.08;
		if (u * L > L * fill + 0.02) break;
		const a = k * 2.39996;
		root(bag, { seed, key: ['hair', k], from: v3(0, top - u * L, 0), dir: v3(Math.cos(a), -0.3, Math.sin(a)), length: 0.05, grown: span(g, 2 + k * 0.3, 5 + k * 0.3), radius: 0.0005, laterals: 2, depth: 1, young: '#f6efdc', old: '#e5d6bd' });
	}
	// the ferny leaves: long stalks up and out, cut and cut again
	for (let i = 0; i < 11; i++) {
		const born = 2.4 + i * 0.5;
		if (g <= born) break;
		const lr = chance(seed, 'leaf', i);
		const grown = clamp((g - born) / 1.6);
		const size = (0.4 + 0.6 * clamp(i / 4)) * vigour;
		pinnate(bag, {
			seed, key: ['carrot', i], at: v3(0, top, 0), out: v3(Math.cos(i * 2.39996), 0, Math.sin(i * 2.39996)), lift: between(lr, 0.9, 1.25),
			length: 0.3 * size, pairs: 4, leaflet: { length: 0.07 * size, width: 0.035 * size, shape: ferny, colour: '#3f7a2e', young: '#6aa84a', vein: '#3f7a2e' },
			grown, stalk: '#6f9a45', radius: 0.0012, terminal: 0.9, between: true
		});
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ lettuce */

export const LETTUCE_STAGES = stages([
	['Seed', 0, 'A slender grey seed four millimetres long, barely covered: lettuce wants light to sprout.'],
	['Germination', 3, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 6, 'Two small oval seed leaves.'],
	['True leaves', 14, 'Soft, round, pale green true leaves.'],
	['Rosette', 25, 'A flat rosette of broad wavy leaves.'],
	['Heart forming', 32, 'The new leaves stay upright and start to cup round each other.'],
	['Heading', 38, 'The inner leaves fold over the heart: a head is forming.'],
	['Firming', 44, 'The head fills and firms, pale yellow-green inside.'],
	['Full head', 50, 'A round, buttery head inside a ruff of spreading outer leaves.'],
	['Harvest', 55, 'Cut it now — before it bolts.']
]);

/** @param {number} g @param {string} seed */
export function lettuce(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.004, 0);
	sprout(bag, {
		seed, at, size: v3(0.002, 0.0006, 0.0008), coat: '#9a9078', coatShade: '#6a6250',
		stem: table(g, [[0, 0], [0.3, 0.0008], [1, 0.008], [2, 0.014], [4, 0.014]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0006 + 0.003 * span(g, 1, 5), stemColor: '#a8c47a',
		leaf: { length: 0.01, width: 0.0045, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6), color: '#7ab04a', vein: '#a6cc7a' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 3.5, 4.5)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.25, grown: table(g, [[0, 0], [0.3, 0.02], [1, 0.08], [3, 0.4], [6, 1]]), radius: 0.0015, down: 0.04, wander: 0.15, laterals: 12, lateral: 0.35, depth: 2, age: span(g, 3, 8), young: '#f6efdc', old: '#d9c4a0' });
	// the leaves, from the outside in: the first ones broad and spreading, the later ones upright and cupped into a head
	const head = span(g, 4.5, 8.5);
	for (let i = 0; i < 30; i++) {
		const born = 2 + i * 0.22;
		if (g <= born) break;
		const lr = chance(seed, 'leaf', i);
		const grown = clamp((g - born) / 1.4);
		const inner = clamp((born - 4.2) / 2.2);
		const len = (0.04 + 0.11 * clamp(i / 8) - 0.04 * inner) * vigour * lerp(0.3, 1, grown);
		const bear = i * 2.39996 + about(lr, 0, 0.2);
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		// outer leaves lean out flat; the heart's stand up and lean in over the middle
		const tilt = lerp(lerp(0.9, 1.35, clamp(i / 10)), lerp(0.35, -0.15, inner), clamp(inner * 1.5) * head);
		const dir = out.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
		const cup = lerp(0.12, 0.9, inner * head);
		const r0 = 0.004 + 0.01 * (1 - inner);
		const colour = mix(mix('#5f9a3a', '#8cc05a', 1 - grown), '#d4e49a', inner * head);
		bag.add(
			'sheet',
			sheet({
				length: len,
				width: len * 0.5,
				shape: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.05 + u * 0.95)), 0.55) * (0.55 + 0.45 * u),
				lift: (u, v) => cup * v * v * (0.3 + 0.4 * u) + (inner ? 0 : -0.1 * u * u) + 0.02 * Math.sin(u * 14 + v * 6) * Math.abs(v) * (1 - inner),
				paint: (u, v) => colour.clone().lerp(new THREE.Color('#e8f0c8'), Math.abs(v) < 0.08 ? 0.5 * (1 - u) : 0),
				along: 12,
				across: 8
			}),
			aim(v3(Math.cos(bear) * r0, 0.004, Math.sin(bear) * r0), dir, 0)
		);
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ garlic */

export const GARLIC_STAGES = stages([
	['Clove', 0, 'A clove planted in autumn, pointed end up, five centimetres down.'],
	['Rooting', 10, 'White roots break from the flat base plate.'],
	['Shoot', 25, 'A green shoot pushes up out of the clove’s tip.'],
	['First leaves', 45, 'Flat blue-green leaves in two ranks, before the frost.'],
	['Winter', 120, 'It rests through the cold, roots growing on.'],
	['Spring growth', 180, 'New leaves fast in the lengthening days; the old clove is used up.'],
	['Bulbing', 210, 'The base swells: a bulb is forming, splitting inside into cloves.'],
	['Scape', 225, 'The flower stalk shoots up from the middle and curls in a loop.'],
	['Swelling', 245, 'The bulb fattens, its papery skins streaked purple; the lower leaves brown.'],
	['Harvest', 265, 'Half the leaves brown: lift the bulb and dry it.']
]);

/** @param {number} g @param {string} seed */
export function garlic(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const plate = v3(0, -0.05, 0);
	// the mother clove, used up as the plant grows
	const used = span(g, 4.6, 6.2);
	if (used < 1) {
		const c = [];
		for (let k = 0; k <= 10; k++) c.push(plate.clone().add(v3(0, (k / 10) * 0.028 * (1 - used * 0.4), 0)));
		bag.add('body', tube(c, (u) => 0.008 * (1 - used * 0.5) * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.1 + u * 0.95))), 0.6) * (1 - 0.4 * u), () => mix('#efe2cc', '#a8906a', used), 10));
	}
	// the roots from the base plate, many, white and fibrous
	const roots = Math.round(table(g, [[0.3, 0], [1, 8], [3, 18], [5, 26], [9, 32]]));
	for (let i = 0; i < roots; i++) {
		const rr = chance(seed, 'garlic-root', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['g', i], from: plate.clone().add(v3(Math.cos(a) * 0.006, 0, Math.sin(a) * 0.006)), dir: v3(Math.cos(a) * 0.6, -1, Math.sin(a) * 0.6), length: between(rr, 0.12, 0.25), grown: (g - 0.3 - i * 0.12) / 2.5, radius: 0.001, down: 0.04, wander: 0.18, laterals: 3, lateral: 0.2, depth: 1, young: '#f7f2e4', old: '#e2d2b4' });
	}
	// the bulb: the base swelling into cloves under purple-streaked papery skins
	const bulb = span(g, 5.5, 9);
	if (bulb > 0) {
		const R = (0.008 + 0.024 * bulb) * vigour;
		const cloves = 6 + Math.floor(chance(seed, 'cloves')() * 4);
		const b = [];
		for (let k = 0; k <= 16; k++) b.push(plate.clone().add(v3(0, (k / 16) * R * 1.8, 0)));
		bag.add('body', tube(b, (u, v) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.92))), 0.55) * (1 - 0.55 * Math.pow(u, 1.5)) * (1 + 0.07 * bulb * Math.abs(Math.cos(v * Math.PI * cloves))), (u, v) => mix('#f2ebe0', '#9a6a8a', Math.pow(Math.abs(Math.sin(v * Math.PI * cloves * 2 + u * 3)), 14) * 0.7 * bulb), 24));
	}
	// the leaves: flat, keeled, blue-green, in two ranks, arching; browning from the bottom at the end
	const top = plate.clone().add(v3(0, 0.03, 0));
	for (let i = 0; i < 9; i++) {
		const born = i < 4 ? 1.6 + i * 0.6 : 4.6 + (i - 4) * 0.35;
		if (g <= born) break;
		const lr = chance(seed, 'garlic-leaf', i);
		const grown = clamp((g - born) / 1.2);
		const brown = span(g, 7.6 + i * 0.25, 8.6 + i * 0.25);
		const side = i % 2 ? 1 : -1;
		const len = (0.18 + 0.3 * clamp(i / 5)) * vigour * lerp(0.2, 1, grown);
		const sheath = 0.04 + 0.12 * span(g, 3, 6);
		const base = top.clone().add(v3(0, sheath * (0.5 + 0.08 * i), 0));
		bag.add('body', tube([top, base], () => 0.005 + 0.004 * bulb, () => '#7f9e6a', 8));
		const dir = v3(side * Math.sin(lerp(0.1, between(lr, 0.4, 0.75), grown)), Math.cos(lerp(0.1, 0.6, grown)), (lr() - 0.5) * 0.3).normalize();
		bag.add('sheet', sheet({ length: len, width: 0.009 * vigour, shape: (u) => Math.pow(1 - u, 0.6) * Math.min(1, u * 8 + 0.4), lift: (u, v) => 0.25 * Math.abs(v) * 0.06 - (0.35 + brown * 0.4) * u * u, paint: (u) => mix(mix('#5f8a5a', '#7fa070', 1 - grown), '#b0925a', clamp(brown * 1.4 - (1 - u) * 0.4)), along: 14, across: 2 }), aim(base, dir, 0));
	}
	// the scape: up from the middle, curling one loop, its pointed flower bud at its end
	const scape = span(g, 6.3, 7.4);
	if (scape > 0) {
		const pts = [];
		const h = 0.25 + 0.2 * scape;
		for (let k = 0; k <= 30; k++) {
			const u = k / 30;
			const s = u * h * scape;
			const curl = Math.max(0, (u - 0.55) / 0.45) * Math.PI * 2 * scape;
			pts.push(top.clone().add(v3(Math.sin(curl) * 0.04, Math.min(s, h * 0.6) + Math.cos(curl) * 0.0 + (u > 0.55 ? (1 - Math.cos(curl)) * 0.02 : 0), 0)).add(v3(0, sheathTop(g), 0)));
		}
		bag.add('body', tube(pts, () => 0.002, () => '#7fa05a', 5));
		bag.add('body', bead(pts[30], v3(0.004, 0.012, 0.004), '#a8c47a', 5));
	}
	return bag.build();
}

const sheathTop = (/** @type {number} */ g) => 0.04 + 0.12 * span(g, 3, 6);
