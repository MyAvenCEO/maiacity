/*
 * GROUND — the food forest's ground layer that is neither herb nor shrub: a moss, and three mushrooms a food forest
 * grows on purpose.
 *
 * Haircap moss (Widertonmoos, Polytrichum commune) from a spore: a green thread (the protonema) creeping over the soil,
 * buds on it that grow into leafy shoots, star-like from above, rooted by brown rhizoids; the shoots crowd into a
 * cushion; then on the female shoots a red-brown stalk rises with a capsule under its hairy cap, which ripens and
 * sheds its spores.
 *
 * The mushrooms are the fruit of a fungus whose body, the mycelium, lives in its food: the wine cap (Riesenträuschling,
 * Stropharia rugosoannulata) in a bed of wood chips, its white rhizomorphs running through chips and soil; the
 * shiitake (Lentinula edodes) in an oak log plugged with spawn; the oyster (Austernpilz, Pleurotus ostreatus) in a
 * standing beech log, its shelves of caps breaking from the bark.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, fan, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/* ------------------------------------------------------------------------------------------------ moss */

export const MOSS_STAGES = stages([
	['Spore', 0, 'A moss spore, a hundredth of a millimetre, landed on damp shaded soil.'],
	['Protonema', 14, 'A green thread creeps over the soil, branching: the protonema.'],
	['Buds', 40, 'Tiny buds swell on the threads, each the start of a shoot; brown rhizoids anchor them.'],
	['Leafy shoots', 90, 'Upright shoots, narrow leaves in a spiral, star-like from above.'],
	['Cushion', 200, 'The shoots crowd together into a soft dark-green cushion.'],
	['Carpet', 400, 'The cushion spreads into a carpet, holding the rain like a sponge.'],
	['Sporophytes', 540, 'From the female shoots, red-brown stalks rise, each with a capsule under a golden hairy cap.'],
	['Capsules', 580, 'The capsules swell, four-angled, their caps still on.'],
	['Ripe capsules', 620, 'The caps fall, the capsules brown and tilt.'],
	['Spores', 640, 'The lids pop off; spores drift out on dry days. The carpet keeps on growing.']
]);

/**
 * The haircap moss at a stage (0 … 9) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function moss(g, seed) {
	const bag = new Bag();
	const r = chance(seed, 'moss');
	const spread = table(g, [[0, 0.004], [1, 0.01], [2, 0.02], [3, 0.04], [4, 0.08], [5, 0.14], [9, 0.16]]);
	// the spore, then the protonema: green branching threads over the soil
	if (g < 0.6) bag.add('body', bead(v3(0, 0.0005, 0), v3(1, 1, 1).multiplyScalar(0.0006), '#7a6a3a', 4));
	const threads = span(g, 0.4, 2.5) * (1 - span(g, 4, 5.5));
	if (threads > 0) {
		for (let k = 0; k < 24; k++) {
			const tr = chance(seed, 'protonema', k);
			const a = k * 2.39996, len = between(tr, 0.4, 1) * spread * 0.9;
			const pts = [];
			for (let m = 0; m <= 8; m++) pts.push(v3(Math.cos(a + Math.sin(m) * 0.4) * len * (m / 8), 0.0006, Math.sin(a + Math.sin(m) * 0.4) * len * (m / 8)));
			bag.add('body', tube(pts, () => 0.00025 * threads, () => '#7ab84a', 3));
		}
	}
	// the shoots: placed in a disc, each born when the carpet reaches it
	const shoots = Math.round(table(g, [[1.6, 0], [3, 60], [4, 260], [5, 520], [9, 620]]));
	for (let i = 0; i < shoots; i++) {
		const sr = chance(seed, 'shoot', i);
		const d = Math.sqrt((i + 0.5) / 620) * 0.16;
		const a = i * 2.39996 + sr() * 0.3;
		if (d > spread) continue;
		const grown = clamp((spread - d) / 0.03);
		const H = (0.01 + 0.03 * between(sr, 0.6, 1)) * lerp(0.15, 1, grown) * lerp(0.4, 1, span(g, 3, 5.5));
		const base = v3(Math.cos(a) * d, 0, Math.sin(a) * d);
		const tilt = v3(sr() - 0.5, 4, sr() - 0.5).normalize();
		const top = base.clone().addScaledVector(tilt, H);
		bag.add('body', tube([base, top], () => 0.0006, () => '#5a4a2a', 3));
		// the leaves: narrow, in a spiral up the stem, spreading star-like
		const leaves = Math.round(8 + 18 * grown);
		for (let k = 0; k < leaves; k++) {
			const u = 0.15 + (k / leaves) * 0.85;
			const p = base.clone().lerp(top, u);
			const b = k * 2.39996;
			const dir = v3(Math.cos(b), 0.55 + 0.6 * u, Math.sin(b)).normalize();
			bag.add('sheet', sheet({ length: 0.009 * lerp(0.5, 1, grown), width: 0.0009, shape: (t) => (1 - t) * Math.min(1, t * 6 + 0.3), paint: (t) => mix('#2f5a24', '#7ab04a', t * 0.6 + (u > 0.8 ? 0.3 : 0)), along: 2, across: 1 }), aim(p, dir, 0));
		}
		// brown rhizoids into the soil
		if (i % 3 === 0) root(bag, { seed, key: ['rhizoid', i], from: base.clone(), dir: v3(0, -1, 0), length: 0.012, grown, radius: 0.00025, down: 0.05, wander: 0.4, laterals: 2, depth: 1, young: '#8a6a4a', old: '#5a4030' });
		// a sporophyte on some of the female shoots
		const fr = chance(seed, 'sporophyte', i);
		if (fr() > 0.25 || g < 5.6 || grown < 1) continue;
		const rise = span(g, 5.6, 6.6);
		const capsule = span(g, 6.3, 7.3), ripe = span(g, 7.4, 8.4), spent = span(g, 8.4, 9);
		const seta = top.clone().add(v3((fr() - 0.5) * 0.01, 0.05 * rise, (fr() - 0.5) * 0.01));
		bag.add('body', tube([top, seta], () => 0.0004, () => '#9a3a2a', 3));
		const lean = ripe * 0.9;
		const cap = seta.clone().add(v3(lean * 0.003, -lean * 0.002, 0));
		bag.add('body', bead(cap, v3(0.0016, 0.004, 0.0016).multiplyScalar(lerp(0.3, 1, capsule)), mix('#7a9a3a', '#7a4a2a', ripe), 4, new THREE.Quaternion().setFromAxisAngle(v3(0, 0, 1), -lean * 1.2)));
		if (ripe < 0.6) bag.add('body', bead(cap.clone().add(v3(0, 0.0025, 0)), v3(0.0022, 0.003, 0.0022).multiplyScalar(lerp(0.3, 1, capsule)), '#d8b45a', 4));
		if (spent > 0.3) for (let m = 0; m < 4; m++) bag.add('body', bead(cap.clone().add(v3((fr() - 0.5) * 0.01, 0.004 + fr() * 0.008, (fr() - 0.5) * 0.01)), v3(0.0005, 0.0005, 0.0005), '#b89a4a', 2));
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ mushrooms */

/**
 * A mushroom: a stipe, perhaps with a ring, a cap from a closed button to open and flat, its gills beneath.
 * @param {Bag} bag
 * @param {{ at: THREE.Vector3, up: THREE.Vector3, stipe: number, stipeR: number, capR: number, open: number, cap: (u: number, a: number) => THREE.Color | string, gills: string, stem: string, ring?: string }} o
 */
function mushroom(bag, o) {
	const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), o.up.clone().normalize());
	const m = new THREE.Matrix4().compose(o.at, q, v3(1, 1, 1));
	const H = o.stipe * lerp(0.35, 1, o.open);
	bag.add('body', tube([v3(0, -0.002, 0), v3(0, H * 0.5, 0), v3(0, H, 0)], (u) => o.stipeR * (1.25 - 0.35 * u), () => o.stem, 8), m);
	if (o.ring && o.open > 0.5) bag.add('sheet', fan({ size: o.stipeR * 2.2, from: -Math.PI, to: Math.PI, edge: () => 1, lift: (s) => -0.25 * s, paint: () => o.ring ?? '#fff', rings: 2, rays: 16 }), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, H * 0.75, 0)));
	// the cap: a dome from its top down to its rim, the rim curled in while it is young
	const capH = o.capR * lerp(0.95, 0.38, o.open);
	const axis = [];
	for (let k = 0; k <= 10; k++) axis.push(v3(0, H + capH * 0.85 - (k / 10) * capH, 0));
	const rim = (/** @type {number} */ u) => (u > 0.75 ? (1 - o.open) * 0.35 * ((u - 0.75) / 0.25) : 0);
	bag.add('body', tube(axis, (u) => o.capR * Math.pow(Math.sin(Math.min(1, u * 1.05) * Math.PI / 2), 0.55) * (1 - rim(u)), (u, v) => o.cap(u, v * Math.PI * 2), 16), m);
	// the gills: a disc beneath, ruled with gills
	bag.add('sheet', fan({ size: o.capR * (1 - rim(1)) * 0.98, from: -Math.PI, to: Math.PI, edge: () => 1, lift: (s) => 0.25 * (1 - o.open) * s * s, paint: (s, a) => mix(o.gills, '#3a2a20', Math.abs(Math.sin(a * 40)) > 0.85 ? 0.25 : 0), rings: 3, rays: 40 }), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, H + capH * 0.85 - capH + 0.0005, 0)));
}

/** a log: bark round it, its cut ends showing the wood, white with mycelium as it is colonised */
function log(/** @type {Bag} */ bag, /** @type {THREE.Vector3} */ a, /** @type {THREE.Vector3} */ b, /** @type {number} */ R, /** @type {number} */ colonised, /** @type {string} */ bark) {
	const pts = [];
	for (let k = 0; k <= 24; k++) pts.push(a.clone().lerp(b, k / 24));
	bag.add('body', tube(pts, () => R, (u, v) => mix(bark, '#3a2e24', Math.pow(Math.abs(Math.sin(v * 70 + u * 13)), 6) * 0.6).lerp(new THREE.Color('#e8e4d8'), (u < 0.045 || u > 0.955 ? colonised : 0) * 0.5), 18));
	for (const [end, dir] of [[a, a.clone().sub(b)], [b, b.clone().sub(a)]]) {
		bag.add('sheet', fan({ size: R * 0.97, from: -Math.PI, to: Math.PI, edge: () => 1, paint: (s) => mix('#c8a878', '#f2eee4', clamp(colonised * 1.4 - (1 - s) * 0.6)).lerp(new THREE.Color('#8a6a4a'), Math.abs(Math.sin(s * 40)) > 0.9 ? 0.4 : 0), rings: 6, rays: 24 }), new THREE.Matrix4().compose(end.clone().addScaledVector(dir.clone().normalize(), 0.001), new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), dir.clone().normalize()), v3(1, 1, 1)));
	}
}

export const WINECAP_STAGES = stages([
	['Spawn', 0, 'Spawn — grain or sawdust grown through with mycelium — mixed into a bed of fresh hardwood chips.'],
	['Running', 14, 'White threads run out from the spawn through the damp chips.'],
	['Colonising', 40, 'Thick white cords, rhizomorphs, bind the chips together and reach down into the soil.'],
	['Colonised', 70, 'The bed is white through; the mycelium feeds the soil and the plants around it.'],
	['Pinning', 85, 'After rain: tiny wine-red knobs push up out of the chips.'],
	['Buttons', 88, 'Round wine-red buttons on stout white stems.'],
	['Opening', 91, 'The caps open, their veil tearing into a ring with ridged edges.'],
	['Mature', 93, 'Big burgundy caps a hand across, their gills turning purple-grey with spores.'],
	['Fading', 96, 'The caps fade to tan as they age; pick them young.'],
	['Next flush', 110, 'The bed rests and flushes again, as long as the chips last: top it up each year.']
]);

/**
 * Wine caps in a bed of wood chips.
 * @param {number} g
 * @param {string} seed
 */
export function wineCap(g, seed) {
	const bag = new Bag();
	const R = 0.32;
	// the bed: chips over the soil
	const cr = chance(seed, 'chips');
	for (let k = 0; k < 420; k++) {
		const d = Math.sqrt(cr()) * R, a = cr() * Math.PI * 2;
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(cr() * 0.6 - 0.3, cr() * 6.28, cr() * 0.6 - 0.3));
		bag.add('body', bead(v3(Math.cos(a) * d, 0.006 + cr() * 0.025 * (1 - d / R), Math.sin(a) * d), v3(0.012, 0.0025, 0.007).multiplyScalar(between(cr, 0.6, 1.4)), mix('#b08a5a', '#e8e0cc', span(g, 1, 3.5) * (cr() < 0.5 ? 0.8 : 0.2)), 2, q));
	}
	// the mycelium: white cords out from the spawn, through the chips and down into the soil
	for (let i = 0; i < 18; i++) {
		const mr = chance(seed, 'mycelium', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['myc', i], from: v3(Math.cos(a) * 0.05, 0.01, Math.sin(a) * 0.05), dir: v3(Math.cos(a), -between(mr, 0.2, 0.9), Math.sin(a)), length: between(mr, 0.2, 0.38), grown: span(g, 0.3 + i * 0.05, 3 + i * 0.05), radius: 0.0008, down: 0.03, wander: 0.4, laterals: 6, lateral: 0.4, depth: 2, young: '#ffffff', old: '#efeae0' });
	}
	// the flush: mushrooms in a loose troop
	const fr = chance(seed, 'troop');
	for (let k = 0; k < 9; k++) {
		const pins = 3.6 + fr() * 0.6;
		const grow = span(g, pins, pins + 3.2);
		if (grow <= 0) {
			fr(); fr();
			continue;
		}
		const d = Math.sqrt(fr()) * R * 0.8, a = fr() * Math.PI * 2;
		const size = about(fr, 1, 0.2);
		const fade = span(g, 7.3, 8.6);
		mushroom(bag, {
			at: v3(Math.cos(a) * d, 0.02, Math.sin(a) * d), up: v3(fr() - 0.5, 4, fr() - 0.5), stipe: 0.12 * size * lerp(0.2, 1, grow), stipeR: 0.012 * size * lerp(0.4, 1, grow), capR: 0.065 * size * lerp(0.12, 1, grow), open: span(g, 5.6, 7.2),
			cap: (u) => mix('#7a1e2a', '#c89a6a', fade).lerp(new THREE.Color('#a8545a'), u * 0.25), gills: mix('#e8e2dc', '#5a4a5a', span(g, 6.5, 7.5)).getStyle(), stem: '#f2ece0', ring: '#eae2d4'
		});
	}
	return bag.build();
}

export const SHIITAKE_STAGES = stages([
	['Plugging', 0, 'A fresh-cut oak log, drilled in a diamond pattern; plugs of spawn tapped in and sealed with wax.'],
	['Running', 60, 'The mycelium runs out from each plug through the wood, unseen.'],
	['Colonising', 180, 'White mottling creeps over the cut ends.'],
	['Colonised', 300, 'The ends are white through: the log is ready to fruit.'],
	['Shocked', 330, 'Soaked a day in cold water to wake it.'],
	['Pinning', 337, 'Small knobs push through cracks in the bark.'],
	['Buttons', 341, 'Brown buttons with a white-fringed rim.'],
	['Opening', 344, 'The caps open, brown with pale flecks, their gills cream.'],
	['Mature', 347, 'Caps a hand across, edges just beginning to flatten: pick now.'],
	['Resting', 360, 'The log rests a couple of months, then fruits again — for four or five years.']
]);

/**
 * Shiitake on an oak log.
 * @param {number} g
 * @param {string} seed
 */
export function shiitake(g, seed) {
	const bag = new Bag();
	const R = 0.07, L = 0.9;
	const a = v3(-L / 2, R, 0), b = v3(L / 2, R + 0.05, 0);
	log(bag, a, b, R, span(g, 1.5, 3), '#5a4a3e');
	// the plugs, sealed with wax
	const pr = chance(seed, 'plugs');
	for (let k = 0; k < 24; k++) {
		const u = 0.08 + (k % 8) * 0.12 + (Math.floor(k / 8) % 2) * 0.06;
		const ang = Math.floor(k / 8) * 2.1 + pr() * 0.2;
		const radial = v3(0, Math.cos(ang), Math.sin(ang));
		bag.add('body', bead(a.clone().lerp(b, u).addScaledVector(radial, R), v3(0.006, 0.006, 0.006), '#c8a03a', 4));
	}
	// the flush, breaking from the bark
	const fr = chance(seed, 'flush');
	for (let k = 0; k < 9; k++) {
		const u = between(fr, 0.1, 0.9), ang = between(fr, -1.6, 1.6);
		const radial = v3(0, Math.cos(ang), Math.sin(ang));
		const pins = 4.7 + fr() * 0.5;
		const grow = span(g, pins, pins + 3.2) * (1 - span(g, 8.6, 9.2));
		if (grow <= 0.01) continue;
		const size = about(fr, 1, 0.2);
		const up = radial.clone().lerp(v3(0, 1, 0), 0.5).normalize();
		mushroom(bag, {
			at: a.clone().lerp(b, u).addScaledVector(radial, R * 0.95), up, stipe: 0.035 * size * lerp(0.3, 1, grow), stipeR: 0.007 * size, capR: 0.05 * size * lerp(0.15, 1, grow), open: span(g, 6, 7.8),
			cap: (uu, ang2) => mix('#6a3e24', '#a8784a', uu * 0.6).lerp(new THREE.Color('#e8dcc8'), uu > 0.4 && Math.abs(Math.sin(ang2 * 9 + uu * 30)) > 0.93 ? 0.6 : 0), gills: '#efe6d2', stem: '#e2d6c0'
		});
	}
	return bag.build();
}

export const OYSTER_STAGES = stages([
	['Plugging', 0, 'A beech log, drilled and plugged with oyster spawn, stood on end in the shade.'],
	['Running', 30, 'The mycelium runs through the wood.'],
	['Colonising', 70, 'White mycelium shows on the cut top.'],
	['Colonised', 110, 'Colonised through: it fruits when the autumn turns cool and wet.'],
	['Cold snap', 130, 'The first cold rains: the trigger.'],
	['Pinning', 134, 'Clusters of tiny grey knobs burst from the bark.'],
	['Clusters', 137, 'Tight clusters of little grey-blue fans.'],
	['Shelves', 140, 'The fans spread into overlapping shelves, white gills running down their short stems.'],
	['Mature', 143, 'Shelves of grey caps a hand across: cut the whole cluster.'],
	['Spent', 150, 'Old caps curl and pale; the log rests until the next cold spell.']
]);

/**
 * Oyster mushrooms on a standing log.
 * @param {number} g
 * @param {string} seed
 */
export function oyster(g, seed) {
	const bag = new Bag();
	const R = 0.09, H = 0.55;
	const a = v3(0, -0.12, 0), b = v3(0, H, 0);
	log(bag, a, b, R, span(g, 1, 2.8), '#8a8478');
	const cr = chance(seed, 'clusters');
	for (let c = 0; c < 5; c++) {
		const ang = c * 1.7 + cr() * 0.5, h = between(cr, 0.12, 0.45);
		const out = v3(Math.cos(ang), 0, Math.sin(ang));
		const pins = 4.7 + cr() * 0.4;
		const grow = span(g, pins, pins + 3);
		const spent = span(g, 8.4, 9.3);
		if (grow <= 0.01) continue;
		const n = 7 + Math.floor(cr() * 5);
		for (let k = 0; k < n; k++) {
			const fr = chance(seed, 'shelf', c, k);
			const base = v3(0, h + (fr() - 0.5) * 0.08, 0).addScaledVector(out.clone().applyAxisAngle(v3(0, 1, 0), (fr() - 0.5) * 0.9), R * 0.98);
			const size = about(fr, 1, 0.25) * lerp(0.15, 1, grow);
			const dir = base.clone().setY(0).normalize().add(v3(0, 0.25 - spent * 0.4, 0)).normalize();
			const stem = base.clone().addScaledVector(dir, 0.015 * size);
			bag.add('body', tube([base, stem], () => 0.006 * size, () => '#e8e4dc', 5));
			// the fan-shaped cap, its edge wavy, its gills running down underneath
			const capColour = mix(mix('#4a5a6a', '#8a8a8a', grow), '#d8d0c0', spent);
			const capR = 0.085 * size;
			const m = aim(stem, dir);
			bag.add('body', fan({ size: capR * 0.98, from: -1.5, to: 1.5, edge: (a2) => 1 + 0.06 * Math.sin(a2 * 7), lift: (s, a2) => 0.12 * s * (1 - s) + (spent * 0.3 - 0.08) * s * s + 0.02 * Math.sin(a2 * 7) * s + 0.09 * (1 - s) * (1 - s), paint: () => capColour, rings: 6, rays: 28 }), m);
			bag.add('body', fan({ size: capR, from: -1.5, to: 1.5, edge: (a2) => 1 + 0.06 * Math.sin(a2 * 7), lift: (s, a2) => 0.12 * s * (1 - s) + (spent * 0.3 - 0.08) * s * s + 0.02 * Math.sin(a2 * 7) * s, paint: (s) => capColour.clone().lerp(new THREE.Color('#2a3a4a'), (1 - s) * 0.15 * (1 - spent)), rings: 6, rays: 28 }), m);
			bag.add('sheet', fan({ size: capR * 0.97, from: -1.5, to: 1.5, edge: (a2) => 1 + 0.06 * Math.sin(a2 * 7), lift: (s, a2) => 0.12 * s * (1 - s) + (spent * 0.3 - 0.08) * s * s + 0.02 * Math.sin(a2 * 7) * s - 0.006, paint: (s, a2) => mix('#f2eee4', '#c8c0b0', Math.abs(Math.sin(a2 * 45)) > 0.8 ? 0.5 : 0), rings: 4, rays: 40 }), m);
		}
	}
	return bag.build();
}
