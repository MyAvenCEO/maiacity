/*
 * TROPICS — the banana and the pineapple, neither of them grown from seed in a garden: the banana (its fruit seedless)
 * from a sucker cut from its mother's corm, the pineapple from the leafy crown twisted off a fruit.
 *
 * The banana is no tree: its "trunk" is a pseudostem of leaf sheaths rolled round each other, its leaves unrolling
 * from the top one after the other, huge paddles torn by the wind into strips between their veins. After some twenty
 * leaves the flower stalk pushes up through the pseudostem and bends over; purple bracts lift one by one, each baring a
 * hand of fingers that curve up toward the light; the male bud hangs on below. Beside it, the next sucker is already up.
 *
 * The pineapple is a rosette of stiff, channelled, spine-edged leaves; from its heart rises a red cone of a hundred
 * violet flowers, and each flower's fruit fuses with the next into one fruit, its eyes in spirals, a crown of leaves
 * on top; it yellows from the base up.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/* ------------------------------------------------------------------------------------------------ banana */

export const BANANA_STAGES = stages([
	['Sucker', 0, 'A sword sucker cut from its mother’s corm, its narrow leaves upright, set in the soil.'],
	['Rooting', 14, 'Thick white roots break from the corm; the first leaf unrolls.'],
	['First leaves', 40, 'Narrow sword leaves, then broader ones, unrolling from the top one after the other.'],
	['Young plant', 100, 'A pseudostem of rolled leaf sheaths, the leaves broad paddles now.'],
	['Full grown', 200, 'Three metres of pseudostem, a crown of huge leaves torn into strips by the wind.'],
	['Shooting', 270, 'The flower stalk pushes up through the pseudostem and bends over, a purple bud at its end.'],
	['Hands', 285, 'Bract after bract lifts and falls, each baring a hand of small fingers that curve up toward the light.'],
	['Filling', 330, 'The fingers fill out, green and angular; the male bud hangs on below.'],
	['Colouring', 365, 'Full and rounded, the first hand yellowing.'],
	['Ripe', 380, 'A heavy bunch of yellow bananas; beside it the next sucker is already a young plant.']
]);

/**
 * Half a banana leaf's blade, from the midrib out to one side, torn into strips between its veins.
 * @param {Bag} bag @param {{ at: THREE.Vector3, dir: THREE.Vector3, side: number, length: number, width: number, droop: number, colour: THREE.Color, dry: number, tears: number[], roll: number }} o
 */
function halfBlade(bag, o) {
	const cuts = [0, ...o.tears, 1];
	const shape = (/** @type {number} */ u) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.04 + u * 0.97))), 0.22);
	for (let k = 0; k < cuts.length - 1; k++) {
		const u0 = cuts[k] + (k ? 0.004 : 0), u1 = cuts[k + 1];
		const L = (u1 - u0) * o.length;
		const g = sheet({
			length: L,
			width: o.width,
			shape: (uu) => shape(u0 + uu * (u1 - u0)),
			lift: (uu, v) => (-o.droop * Math.pow(u0 + uu * (u1 - u0), 2) * o.length - 0.05 * ((v + 1) / 2) * o.width * (1 + o.dry * 3)) / Math.max(1e-6, L),
			paint: (uu, v) => o.colour.clone().lerp(new THREE.Color('#9ab86a'), Math.abs(Math.sin((u0 + uu * (u1 - u0)) * 160)) < 0.05 ? 0.25 : 0).lerp(new THREE.Color('#a8864a'), clamp(o.dry * 1.4 - (1 - (v + 1) / 2) * 0.5)),
			along: 4,
			across: 3
		});
		// from a full-width sheet to one half, the midrib on its inner edge, offset along the leaf to its place
		const p = g.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), z = p.getZ(i);
			const w = shape(u0 + (x / Math.max(1e-6, L)) * (u1 - u0)) * o.width;
			p.setXYZ(i, x + u0 * o.length, p.getY(i), o.side * (z + w) / 2);
		}
		g.computeVertexNormals();
		bag.add('sheet', g, aim(o.at, o.dir, o.roll));
	}
}

/**
 * The banana at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function banana(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const corm = v3(0, -0.14, 0);
	plantBanana(bag, seed, ['mother'], corm, g, vigour, 1);
	// the follower: the next sucker, up beside its mother
	if (g > 3.6) {
		const fr = chance(seed, 'follower');
		const a = fr() * Math.PI * 2;
		plantBanana(bag, seed, ['follower'], corm.clone().add(v3(Math.cos(a) * 0.35, 0.02, Math.sin(a) * 0.35)), (g - 3.6) * 0.6, vigour * 0.85, 0);
	}
	return bag.build();
}

/**
 * One banana plant: corm, roots, pseudostem, leaves, and (if it is the mother) its bunch.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} corm @param {number} g @param {number} vigour @param {number} bears
 */
function plantBanana(bag, seed, key, corm, g, vigour, bears) {
	const r = chance(seed, 'banana', ...key);
	const big = span(g, 0.5, 4.6);
	bag.add('body', bead(corm, v3(1, 0.8, 1).multiplyScalar(0.05 + 0.1 * big), '#8a6a4a', 8));
	const roots = Math.round(table(g, [[0.4, 0], [1, 6], [3, 20], [5, 36], [9, 44]]));
	for (let i = 0; i < roots; i++) {
		const rr = chance(seed, 'banana-root', ...key, i);
		const a = i * 2.39996;
		root(bag, { seed, key: [...key, 'root', i], from: corm.clone().add(v3(Math.cos(a) * 0.08 * big, -0.02, Math.sin(a) * 0.08 * big)), dir: v3(Math.cos(a), -between(rr, 0.1, 0.6), Math.sin(a)), length: between(rr, 0.5, 1.4) * vigour, grown: (g - 0.4 - i * 0.08) / 2.5, radius: 0.004, down: 0.02, wander: 0.15, laterals: 4, lateral: 0.2, depth: 1, age: (g - 1.5 - i * 0.08) / 3, young: '#f6efe0', old: '#c4a77a' });
	}
	// the pseudostem: rolled leaf sheaths, green blotched brown, dry sheaths at its foot
	const H = table(g, [[0, 0.25], [1, 0.3], [2, 0.5], [3, 1.1], [4, 2.2], [5, 2.8], [9, 2.85]]) * vigour;
	const R = table(g, [[0, 0.025], [2, 0.04], [3, 0.07], [4, 0.12], [5, 0.14], [9, 0.145]]) * vigour;
	const stem = [corm.clone(), v3(corm.x, corm.y + 0.15, corm.z), v3(corm.x, H * 0.5, corm.z), v3(corm.x + 0.01, H, corm.z)];
	bag.add('body', tube(stem, (u) => R * (1.15 - 0.35 * u), (u, v) => mix(mix('#6f9a3a', '#4f7a2e', Math.abs(Math.sin(v * 21 + u * 7))), '#6a4a3a', Math.pow(Math.abs(Math.sin(v * 9 + u * 31)), 20) * 0.7).lerp(new THREE.Color('#a8865a'), clamp((0.12 - u) * 8)), 14));
	const top = stem[3];
	// the leaves: the newest a rolled cigar at the top, the older spread and arching, the oldest hanging dry
	const made = table(g, [[0, 3], [1, 4], [2, 7], [3, 12], [4, 18], [5, 24], [9, 24]]);
	const live = table(g, [[0, 3], [2, 5], [3, 8], [4, 11], [5, 12], [6, 11], [9, 9]]);
	const shooting = bears && g > 4.9;
	for (let j = Math.max(0, Math.floor(made - live - 1)); j < Math.ceil(made); j++) {
		const age = (made - j) / Math.max(1, live);
		if (age < 0 || age > 1.15) continue;
		const lr = chance(seed, 'banana-leaf', ...key, j);
		const bear = j * 2.8 + about(lr, 0, 0.2);
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		// leaves made while young are narrow swords; a grown plant's are huge
		const size = lerp(0.18, 1, clamp(j / 14)) * vigour;
		const L = 2.0 * size, W = lerp(0.12, 0.6, clamp(j / 14)) * vigour;
		const opened = clamp((made - j) / 0.9);
		if (opened < 0.25 && !shooting) {
			// the cigar leaf: still rolled, upright
			bag.add('body', tube([top, top.clone().add(v3(0, L * 0.6 * lerp(0.4, 1, opened * 4), 0))], (u) => 0.03 * size * (1 - 0.8 * u), () => '#8ab85a', 8));
			continue;
		}
		const tilt = lerp(0.15, 1.2, Math.pow(clamp(age), 0.8)) + Math.max(0, age - 0.85) * 3;
		const dry = span(age, 0.8, 1.1);
		const dir = out.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
		const petiole = top.clone().addScaledVector(dir, 0.35 * size);
		bag.add('body', tube([top, petiole], () => 0.02 * size, () => mix('#6f9a3a', '#9a7a4a', dry), 6));
		const bladeDir = dir.clone().lerp(out, 0.4).normalize();
		const tears = [];
		const torn = clamp(age * 1.5) * (j > 6 ? 1 : 0.2);
		for (let t = 0; t < 8; t++) if (lr() < torn * 0.6) tears.push(0.12 + t * 0.105 + lr() * 0.04);
		const colour = mix(mix('#3f7a2e', '#8ac05a', 1 - opened), '#2f6024', age * 0.4);
		bag.add('body', tube([petiole, petiole.clone().addScaledVector(bladeDir, L).add(v3(0, -0.25 * L * (0.3 + age), 0))], (u) => 0.012 * size * (1 - 0.8 * u), () => mix('#b8c88a', '#9a7a4a', dry), 5));
		for (const side of [-1, 1]) halfBlade(bag, { at: petiole, dir: bladeDir, side, length: L, width: W, droop: 0.12 + age * 0.15, colour, dry, tears: side < 0 ? tears : tears.map((t) => Math.min(0.95, t + 0.03)), roll: side * 0.15 });
	}
	if (shooting) bunch(bag, seed, top, g, vigour);
}

/**
 * The bunch: the stalk up through the pseudostem and over; the hands, each under its purple bract until the bract
 * lifts; the fingers curving up; the male bud hanging below.
 * @param {Bag} bag @param {string} seed @param {THREE.Vector3} top @param {number} g @param {number} vigour
 */
function bunch(bag, seed, top, g, vigour) {
	const br = chance(seed, 'bunch');
	const out = v3(Math.cos(br() * 6.28), 0, Math.sin(br() * 6.28));
	const shoot = span(g, 4.9, 5.4);
	// the stalk: up out of the top, over, and down
	// up out of the crown of leaves, arching out half a metre, then hanging straight down; as it shoots it is only the
	// first part of that path
	const path = new THREE.CatmullRomCurve3([[0, 0], [0.12, 0.32], [0.38, 0.38], [0.56, 0.1], [0.62, -0.35], [0.62, -0.85], [0.6, -1.25]].map(([o, y]) => top.clone().addScaledVector(out, o * vigour).add(v3(0, y * vigour, 0))));
	const pts = path.getPoints(16).map((_, k) => path.getPoint((k / 16) * lerp(0.25, 1, shoot)));
	bag.add('body', tube(pts, (u) => 0.03 * (1 - 0.4 * u), () => '#6f8a3a', 8));
	const hands = 8;
	const fill = span(g, 5.6, 7.8);
	const ripe = span(g, 8, 9);
	for (let h = 0; h < hands; h++) {
		const u = 0.45 + h * 0.055;
		const f = u * 16, k = Math.min(15, Math.floor(f));
		const at = pts[k].clone().lerp(pts[k + 1], f - k);
		const along = pts[k + 1].clone().sub(pts[k]).normalize();
		const revealed = span(g, 5.4 + h * 0.15, 5.7 + h * 0.15);
		const around = h * 2.2;
		if (revealed < 1) {
			// still under its bract: a purple hood
			bag.add('body', bead(at.clone().add(v3(Math.cos(around) * 0.06, 0, Math.sin(around) * 0.06)), v3(0.06, 0.1, 0.05), '#6a1e3a', 6, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), along.clone().negate())));
			if (revealed <= 0) continue;
		}
		// a hand: two rows of fingers on a cushion, curving up toward the light
		const fingers = 14 + Math.floor(br() * 5);
		for (let n = 0; n < fingers; n++) {
			const a = around + (n / fingers - 0.5) * 2.4;
			const row = n % 2 ? 1 : 0.86;
			const base = at.clone().add(v3(Math.cos(a) * 0.065 * row, -0.012 * (n % 2), Math.sin(a) * 0.065 * row));
			const radial = v3(Math.cos(a), 0, Math.sin(a));
			const len = (0.1 + 0.1 * fill) * vigour * (1 - h * 0.03) * revealed;
			const R = (0.007 + 0.014 * fill) * vigour * (1 - h * 0.02);
			const fp = [];
			for (let m = 0; m <= 8; m++) {
				const t = m / 8;
				// out from the cushion, then turning up
				fp.push(base.clone().addScaledVector(radial, len * (0.75 * t)).add(v3(0, len * (0.75 * t * t - 0.1 * t), 0)));
			}
			const colour = mix(mix('#4f7a2a', '#7aa03a', fill), '#f2d43a', clamp(ripe * 1.3 - h * 0.05));
			bag.add('gloss', tube(fp, (t, v) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.05 + t))), 0.4) * (1 - 0.3 * t) * (1 + 0.06 * Math.cos(v * Math.PI * 10)), (t) => colour.clone().lerp(new THREE.Color('#3a2a1a'), clamp((t - 0.93) * 14)), 10));
		}
	}
	// the male bud at the end, purple, on its bare stalk
	bag.add('body', bead(pts[16].clone().add(v3(0, -0.1, 0)), v3(0.07, 0.15, 0.07).multiplyScalar(lerp(0.5, 1, shoot)), '#5a1a34', 8));
}

/* ------------------------------------------------------------------------------------------------ pineapple */

export const PINEAPPLE_STAGES = stages([
	['Crown', 0, 'The leafy crown twisted off a ripe pineapple, dried a few days, set in the soil.'],
	['Rooting', 21, 'Roots break from the base of the crown; its old leaves hold on.'],
	['New leaves', 60, 'New leaves from the heart, longer than the crown’s.'],
	['Rosette', 180, 'A rosette of stiff, channelled, grey-green leaves edged with small spines.'],
	['Big rosette', 420, 'A metre across, forty leaves and more, the old crown leaves gone.'],
	['Flowering', 540, 'A red cone rises from the heart; its violet flowers open a few each day, from the bottom up.'],
	['Fruitlets', 570, 'Each flower’s fruit swells and fuses with its neighbours’; a little crown of leaves on top.'],
	['Green fruit', 640, 'A green-grey pineapple, its eyes in spirals, growing on its stalk.'],
	['Colouring', 690, 'It yellows from the base up, eye by eye.'],
	['Ripe', 710, 'Golden, fragrant at its base: ripe. A slip already grows below it.']
]);

/** a pineapple leaf: a long stiff sword, channelled, tapering to a spine */
const sword = (/** @type {number} */ u) => Math.pow(1 - u, 0.7) * Math.min(1, 0.55 + u * 5);

/**
 * The pineapple at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function pineapple(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const base = v3(0, 0.01, 0);
	rosette(bag, seed, ['mother'], base, g, vigour, true);
	if (g > 6) rosette(bag, seed, ['slip'], base.clone().add(v3(0.12, 0.08, 0.05)), (g - 6) * 0.9, vigour * 0.5, false);
	return bag.build();
}

/**
 * A pineapple rosette: its roots, its leaves, and (if it flowers) its fruit.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} base @param {number} g @param {number} vigour @param {boolean} fruits
 */
function rosette(bag, seed, key, base, g, vigour, fruits) {
	const r = chance(seed, 'pine', ...key);
	const roots = Math.round(table(g, [[0.3, 0], [1, 8], [3, 18], [5, 26], [9, 30]]));
	for (let i = 0; i < roots; i++) {
		const rr = chance(seed, 'pine-root', ...key, i);
		const a = i * 2.39996;
		root(bag, { seed, key: [...key, 'r', i], from: base.clone().add(v3(Math.cos(a) * 0.02, -0.02, Math.sin(a) * 0.02)), dir: v3(Math.cos(a), -between(rr, 0.2, 0.8), Math.sin(a)), length: between(rr, 0.25, 0.6) * vigour, grown: (g - 0.3 - i * 0.1) / 2.5, radius: 0.0018, down: 0.03, wander: 0.2, laterals: 5, lateral: 0.3, depth: 1, age: (g - 2 - i * 0.1) / 3, young: '#f2e8d2', old: '#a8865a' });
	}
	// the crown's old leaves (short), then the new ones, longer and longer, spiralling from the heart
	const count = Math.round(table(g, [[0, 22], [2, 30], [3, 42], [4, 60], [9, 66]]));
	for (let i = 0; i < count; i++) {
		const lr = chance(seed, 'pine-leaf', ...key, i);
		const crownLeaf = i < 22;
		if (crownLeaf && span(g, 3, 4.5) > 0.6 + lr() * 0.4) continue;
		const born = crownLeaf ? -1 : 0.6 + (i - 22) * 0.09;
		if (g <= born) break;
		const grown = crownLeaf ? 1 : clamp((g - born) / 0.8);
		const L = (crownLeaf ? 0.12 + 0.08 * (i / 22) : lerp(0.25, 0.95, clamp((i - 22) / 25))) * vigour * lerp(0.3, 1, grown);
		const bear = i * 2.39996 + about(lr, 0, 0.1);
		const inner = clamp((count - i) / 12);
		const tilt = lerp(lerp(0.5, 1.15, clamp(i / 50)), 0.12, inner * 0.8) + about(lr, 0, 0.1) + (crownLeaf ? span(g, 1, 4) * 0.6 : 0);
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		const dir = out.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
		const old = crownLeaf ? span(g, 1.5, 4) : 0;
		const colour = mix(mix('#5f7a5a', '#6a8a5a', lr()), '#a8865a', old);
		bag.add(
			'sheet',
			sheet({
				length: L,
				width: 0.022 * vigour * (crownLeaf ? 0.8 : 1),
				shape: sword,
				lift: (u, v) => 0.18 * Math.abs(v) * 0.05 - 0.12 * u * u,
				// spines along the edge, the faint grey bloom down the middle
				paint: (u, v) => colour.clone().lerp(new THREE.Color('#4a2a2a'), Math.abs(v) > 0.85 && Math.abs(Math.sin(u * 90)) > 0.92 ? 0.6 : 0).lerp(new THREE.Color('#9aa89a'), Math.abs(v) < 0.3 ? 0.2 : 0),
				along: 10,
				across: 4
			}),
			aim(base.clone().addScaledVector(out, 0.012), dir, about(lr, 0, 0.3))
		);
	}
	if (!fruits || g < 4.9) return;
	// the flower stalk and its head: a red cone of violet flowers, then the fruit with its crown
	const rise = span(g, 4.9, 5.4);
	const stalkTop = base.clone().add(v3(0, 0.18 + 0.22 * rise, 0));
	bag.add('body', tube([base, stalkTop], () => 0.012, () => '#7a9a5a', 6));
	const fruit = span(g, 5.4, 7.6);
	const ripe = span(g, 7.6, 9);
	const H = (0.06 + 0.16 * fruit) * vigour, R = (0.025 + 0.045 * fruit) * vigour;
	const axis = [];
	for (let k = 0; k <= 14; k++) axis.push(stalkTop.clone().add(v3(0, (k / 14) * H, 0)));
	const flowering = g < 5.6;
	bag.add('body', tube(axis, (u) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.88))), 0.45), (u) => (flowering ? mix('#c43a4a', '#e05a5a', u) : mix('#4f7a3a', '#e8a83a', clamp(ripe * 1.5 - u * 0.6))), 16));
	// the eyes: one per flower, in spirals; a violet flower on each while it blooms
	const eyes = 110;
	for (let k = 0; k < eyes; k++) {
		const u = 0.06 + 0.88 * ((k + 0.5) / eyes);
		const a = k * 2.39996;
		const rad = R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.88))), 0.45);
		const out = v3(Math.cos(a), 0, Math.sin(a));
		const at = stalkTop.clone().add(v3(0, u * H, 0)).addScaledVector(out, rad * 0.98);
		const opens = 5.0 + u * 0.5;
		if (flowering && g > opens && g < opens + 0.2) bag.add('body', bead(at.clone().addScaledVector(out, 0.006), v3(0.005, 0.005, 0.005), '#7a5ab8', 3));
		else bag.add('body', bead(at, v3(1, 0.7, 1).multiplyScalar(rad * 0.22), flowering ? '#d24a5a' : mix('#3f6a32', '#d88a2a', clamp(ripe * 1.5 - u * 0.6)), 3, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), out)));
	}
	// the crown on top
	const crownAt = stalkTop.clone().add(v3(0, H * 0.97, 0));
	for (let k = 0; k < 26; k++) {
		const a = k * 2.39996;
		const tilt = 0.15 + (k / 26) * 0.7;
		const dir = v3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
		bag.add('sheet', sheet({ length: (0.05 + 0.1 * (1 - k / 26)) * lerp(0.4, 1, fruit) * vigour, width: 0.012, shape: sword, lift: (u) => -0.08 * u * u, paint: () => mix('#5f7a5a', '#4f6a4a', k / 26), along: 6, across: 2 }), aim(crownAt, dir, 0));
	}
}

