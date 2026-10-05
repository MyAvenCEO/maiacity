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
import { Bag, about, aim, bead, between, chance, clamp, fan, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

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
export const banana = (/** @type {number} */ g, /** @type {string} */ seed) => grow(YELLOW, g, seed);

/**
 * @typedef {{ stem: [string, string], stalk: string, green: string, ripe: string, tip: string, fingers: [number, number], length: number, girth: number, hands: number }} Look
 *   — a banana's colours (its pseudostem's two greens or reds, its leaf stalks, its fruit green and ripe), how many
 *   fingers to a hand, how long and thick they are, how many hands to a bunch
 */
/** the red banana's stages: as the banana's, its colours its own */
export const RED_BANANA_STAGES = BANANA_STAGES.map((st, k) => ({ ...st, day: Math.round(st.day * 1.08), note: [
	'A red sucker cut from its mother’s corm, its narrow leaves upright, set in the soil.',
	st.note, st.note, 'A pseudostem of rolled sheaths, flushed red-purple; red leaf stalks and midribs.',
	'Three metres of dark red pseudostem, a crown of huge leaves with red midribs, torn by the wind.',
	st.note,
	'Bract after bract lifts, baring hands of short thick fingers, maroon from the start.',
	'The fingers fill out, plump and dark red.',
	'Full and rounded, the maroon lightening toward a dusky purple-red.',
	'A heavy bunch of red bananas, sweet with a hint of raspberry; beside it the next sucker.'
][k] }));

/** @type {Look} */
const YELLOW = { stem: ['#6f9a3a', '#4f7a2e'], stalk: '#6f9a3a', green: '#5f8a2e', ripe: '#f2d43a', tip: '#3a2a1a', fingers: [14, 18], length: 0.2, girth: 0.021, hands: 10 };
/** the red banana (Red Dacca): its pseudostem, leaf stalks and midribs flushed red-purple, its fruit maroon turning a dusky purple-red, short and thick */
/** @type {Look} */
const RED = { stem: ['#7a3a4a', '#5a2a3a'], stalk: '#8a3a4a', green: '#6a2a3a', ripe: '#a8303a', tip: '#2a1a1a', fingers: [12, 16], length: 0.16, girth: 0.025, hands: 8 };

/**
 * The red banana at a stage (0 … 9) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export const redBanana = (g, seed) => grow(RED, g, seed);

/** @param {Look} look @param {number} g @param {string} seed */
function grow(look, g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const corm = v3(0, -0.14, 0);
	plantBanana(bag, look, seed, ['mother'], corm, g, vigour, 1);
	// the follower: the next sucker, up beside its mother
	if (g > 3.6) {
		const fr = chance(seed, 'follower');
		const a = fr() * Math.PI * 2;
		plantBanana(bag, look, seed, ['follower'], corm.clone().add(v3(Math.cos(a) * 0.35, 0.02, Math.sin(a) * 0.35)), (g - 3.6) * 0.6, vigour * 0.85, 0);
	}
	return bag.build();
}

/**
 * One banana plant: corm, roots, pseudostem, leaves, and (if it is the mother) its bunch.
 * @param {Bag} bag @param {Look} look @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} corm @param {number} g @param {number} vigour @param {number} bears
 */
function plantBanana(bag, look, seed, key, corm, g, vigour, bears) {
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
	bag.add('body', tube(stem, (u) => R * (1.15 - 0.35 * u), (u, v) => mix(mix(look.stem[0], look.stem[1], Math.abs(Math.sin(v * 21 + u * 7))), '#6a4a3a', Math.pow(Math.abs(Math.sin(v * 9 + u * 31)), 20) * 0.7).lerp(new THREE.Color('#a8865a'), clamp((0.12 - u) * 8)), 14));
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
		bag.add('body', tube([top, petiole], () => 0.02 * size, () => mix(look.stalk, '#9a7a4a', dry), 6));
		const bladeDir = dir.clone().lerp(out, 0.4).normalize();
		const tears = [];
		const torn = clamp(age * 1.5) * (j > 6 ? 1 : 0.2);
		for (let t = 0; t < 8; t++) if (lr() < torn * 0.6) tears.push(0.12 + t * 0.105 + lr() * 0.04);
		const colour = mix(mix('#3f7a2e', '#8ac05a', 1 - opened), '#2f6024', age * 0.4);
		bag.add('body', tube([petiole, petiole.clone().addScaledVector(bladeDir, L).add(v3(0, -0.25 * L * (0.3 + age), 0))], (u) => 0.012 * size * (1 - 0.8 * u), () => mix('#b8c88a', '#9a7a4a', dry), 5));
		for (const side of [-1, 1]) halfBlade(bag, { at: petiole, dir: bladeDir, side, length: L, width: W, droop: 0.12 + age * 0.15, colour, dry, tears: side < 0 ? tears : tears.map((t) => Math.min(0.95, t + 0.03)), roll: side * 0.15 });
	}
	if (shooting) bunch(bag, look, seed, top, g, vigour);
}

/**
 * The bunch: the stalk up through the pseudostem and over; the hands, each under its purple bract until the bract
 * lifts; the fingers curving up; the male bud hanging below.
 * @param {Bag} bag @param {Look} look @param {string} seed @param {THREE.Vector3} top @param {number} g @param {number} vigour
 */
function bunch(bag, look, seed, top, g, vigour) {
	const br = chance(seed, 'bunch');
	const out = v3(Math.cos(br() * 6.28), 0, Math.sin(br() * 6.28));
	const shoot = span(g, 4.9, 5.4);
	// the stalk: up out of the top, over, and down
	// up out of the crown of leaves, arching out half a metre, then hanging straight down; as it shoots it is only the
	// first part of that path
	const path = new THREE.CatmullRomCurve3([[0, 0], [0.12, 0.32], [0.38, 0.38], [0.56, 0.1], [0.62, -0.35], [0.62, -0.85], [0.6, -1.25]].map(([o, y]) => top.clone().addScaledVector(out, o * vigour).add(v3(0, y * vigour, 0))));
	const pts = path.getPoints(16).map((_, k) => path.getPoint((k / 16) * lerp(0.25, 1, shoot)));
	bag.add('body', tube(pts, (u) => 0.03 * (1 - 0.4 * u), () => '#6f8a3a', 8));
	const hands = look.hands;
	const fill = span(g, 5.6, 7.8);
	const ripe = span(g, 8, 9);
	for (let h = 0; h < hands; h++) {
		// the hands packed close down the stalk, each a few centimetres below the last, fingers overlapping the next
		const u = 0.5 + h * 0.021;
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
		const fingers = look.fingers[0] + Math.floor(br() * (look.fingers[1] - look.fingers[0] + 1));
		for (let n = 0; n < fingers; n++) {
			const a = around + (n / fingers - 0.5) * 2.4;
			const row = n % 2 ? 1 : 0.86;
			const base = at.clone().add(v3(Math.cos(a) * 0.065 * row, -0.012 * (n % 2), Math.sin(a) * 0.065 * row));
			const radial = v3(Math.cos(a), 0, Math.sin(a));
			const len = look.length * lerp(0.5, 1, fill) * vigour * (1 - h * 0.025) * revealed;
			const R = look.girth * lerp(0.35, 1, fill) * vigour * (1 - h * 0.02);
			const fp = [];
			for (let m = 0; m <= 8; m++) {
				const t = m / 8;
				// out from the cushion, then turning up
				fp.push(base.clone().addScaledVector(radial, len * (0.75 * t)).add(v3(0, len * (0.75 * t * t - 0.1 * t), 0)));
			}
			const colour = mix(mix('#4f7a2a', look.green, fill), look.ripe, clamp(ripe * 1.3 - h * 0.05));
			bag.add('gloss', tube(fp, (t, v) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.05 + t))), 0.4) * (1 - 0.3 * t) * (1 + 0.06 * Math.cos(v * Math.PI * 10)), (t) => colour.clone().lerp(new THREE.Color(look.tip), clamp((t - 0.93) * 14)), 10));
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


/* ------------------------------------------------------------------------------------------------ papaya */

export const PAPAYA_STAGES = stages([
	['Seed', 0, 'A small black wrinkled seed in its clear jelly, washed, a centimetre down in warm soil.'],
	['Germination', 12, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 18, 'Two oval seed leaves, then a first small lobed leaf.'],
	['Seedling', 40, 'A soft green stem, its leaves already deeply lobed.'],
	['Young papaya', 120, 'One unbranched hollow stem, scarred where old leaves fell, a crown of huge palmate leaves on long hollow stalks.'],
	['Flowering', 180, 'Waxy cream flowers in the axils of the leaves, right on the stem.'],
	['Fruit set', 195, 'Small green fruit set close against the stem, one at each leaf axil.'],
	['Green fruit', 240, 'A ring of heavy green papayas hugging the stem under the leaves, more forming above.'],
	['Colouring', 300, 'The lowest turn yellow from their tips.'],
	['Ripe', 320, 'Yellow-orange papayas below, green ones above: it fruits on as the stem grows.']
]);

/** a papaya leaf's edge: seven deep lobes, each lobed again */
function papayaLeaf(/** @type {number} */ a) {
	const lobes = [0, 0.85, -0.85, 1.7, -1.7, 2.45, -2.45];
	let reach = 0;
	for (let k = 0; k < lobes.length; k++) {
		const d = Math.abs(a - lobes[k]);
		reach = Math.max(reach, (k < 1 ? 1 : k < 3 ? 0.95 : k < 5 ? 0.8 : 0.6) * (1 - 0.7 * Math.min(1, d / 0.38)));
	}
	return Math.max(0.12, reach * (1 + 0.1 * Math.abs(Math.sin(a * 24))));
}

/**
 * The papaya at a stage (0 … 9) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function papaya(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.01, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0028, 0.0022, 0.0022), coat: '#2a2420', coatShade: '#4a3a30',
		stem: table(g, [[0, 0], [0.3, 0.001], [1, 0.014], [2, 0.03], [9, 0.03]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0012 + 0.002 * span(g, 1, 3), stemColor: '#7aa04a',
		leaf: { length: 0.016, width: 0.006, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.6), color: '#5a9a3c', vein: '#9cc46e' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.6), wither: span(g, 3, 3.6)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.8, grown: table(g, [[0, 0], [0.3, 0.01], [1, 0.05], [3, 0.3], [5, 0.8], [7, 1]]), radius: 0.002 + 0.02 * span(g, 3, 8), down: 0.03, wander: 0.15, laterals: 10, lateral: 0.4, depth: 2, age: span(g, 3, 8), young: '#f4ead2', old: '#c8a878' });
	for (let i = 0; i < 16; i++) {
		const a = i * 2.39996;
		root(bag, { seed, key: ['lat', i], from: at.clone().add(v3(0, -0.04, 0)), dir: v3(Math.cos(a), -0.2, Math.sin(a)), length: 0.7 * vigour, grown: (g - 3 - i * 0.1) / 2.5, radius: 0.006, down: 0.015, wander: 0.2, laterals: 5, depth: 2, age: (g - 4 - i * 0.1) / 3, young: '#f4ead2', old: '#c8a878' });
	}
	// the stem: one, unbranched, thickening at its foot, scarred where each old leaf fell
	const H = table(g, [[2, 0], [3, 0.15], [4, 1.0], [5, 1.6], [6, 1.8], [7, 2.1], [8, 2.35], [9, 2.5]]) * vigour;
	const base = s.top.clone();
	const R = lerp(0.006, 0.075, span(g, 2.5, 8)) * vigour;
	const top = base.clone().add(v3(0, H, 0));
	const made = table(g, [[2, 0], [3, 4], [4, 18], [5, 30], [6, 36], [7, 44], [8, 52], [9, 58]]);
	const live = Math.min(made, 22);
	if (H > 0.01) {
		bag.add('body', tube([base, base.clone().add(v3(0, H * 0.5, 0)), top], (u, v) => R * (1.3 - 0.6 * u) * (1 - 0.06 * Math.pow(Math.abs(Math.sin(u * H * 34 + v * 3)), 12)), (u, v) => mix('#8a9a6a', '#7aa04a', clamp((u - 0.6) * 3)).lerp(new THREE.Color('#6a6a50'), Math.pow(Math.abs(Math.sin(u * H * 34 + v * 3)), 20) * 0.6), 14));
	}
	// the leaves spiral up the top of the stem, the oldest lowest and drooping, the newest in the middle upright
	/** where on the stem leaf j sprang: the top's last metre, up the spiral */
	const leafAt = (/** @type {number} */ j) => base.clone().add(v3(0, Math.max(0, H - (made - j) * 0.022), 0));
	for (let j = Math.max(0, Math.floor(made - live)); j < Math.ceil(made); j++) {
		const lr = chance(seed, 'papaya-leaf', j);
		const age = (made - j) / live;
		const grown = clamp((made - j) / 2);
		const bear = j * 2.39996;
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		const p = leafAt(j);
		const size = lerp(0.2, 1, clamp(j / 16)) * vigour;
		const tilt = lerp(0.25, 1.45, Math.pow(age, 0.8)) + about(lr, 0, 0.1);
		const dir = out.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
		const len = 0.75 * size * lerp(0.3, 1, grown);
		const end = p.clone().addScaledVector(dir, len).add(v3(0, -0.08 * len * age, 0));
		const yellow = span(age, 0.85, 1);
		bag.add('body', tube([p, p.clone().addScaledVector(dir, len * 0.5), end], (u) => 0.008 * size * (1 - 0.5 * u), () => mix('#8ab05a', '#c8a84a', yellow), 5));
		const facing = out.clone().multiplyScalar(0.35).add(v3(0, 1, 0)).normalize();
		bag.add('sheet', fan({ size: 0.42 * size * lerp(0.25, 1, grown), from: -Math.PI + 0.3, to: Math.PI - 0.3, edge: papayaLeaf, lift: (sv, a) => -0.15 * sv * sv * (1 + age) + 0.03 * Math.cos(a * 7) * sv, paint: (sv, a) => mix(mix('#3a6e2a', '#7ab04a', 1 - grown), '#d8c04a', yellow).lerp(new THREE.Color('#c8dca0'), [0, 0.85, -0.85, 1.7, -1.7, 2.45, -2.45].some((t) => Math.abs(a - t) < 0.035) ? 0.45 : 0), rings: 7, rays: 70 }), aim(end, out.clone().lerp(facing, 0.5).normalize(), 0));
		// in its axil: a flower, then a papaya hugging the stem
		const opens = 4.6 + (j - 26) * 0.045;
		if (j < 24 || g < opens - 0.2) continue;
		const set = span(g, opens + 0.25, opens + 2.1);
		const axil = p.clone().addScaledVector(out, R * 1.05);
		if (set < 0.03) {
			bag.add('body', bead(axil.clone().addScaledVector(out, 0.012), v3(0.007, 0.016, 0.007), '#f2eccf', 5));
			continue;
		}
		const ripe = span(g, opens + 2.4, opens + 3.2);
		const L = (0.05 + 0.2 * set) * vigour * about(lr, 1, 0.1), W = L * 0.36;
		const axis = [];
		for (let k = 0; k <= 14; k++) axis.push(axil.clone().addScaledVector(out, W * 0.9).add(v3(0, -(k / 14) * L, 0)));
		bag.add('gloss', tube(axis, (u, v) => W * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.04 + u * 0.98))), 0.45) * (0.8 + 0.25 * u) * (1 + 0.05 * Math.cos(v * Math.PI * 10)), (u) => mix('#3f7a2e', '#f2a02a', clamp(ripe * 1.6 - (1 - u) * 0.7)), 16));
	}
	return bag.build();
}

/* ------------------------------------------------------------------------------------------------ passion fruit */

export const PASSION_STAGES = stages([
	['Seed', 0, 'A small black pitted seed from the pulp, a centimetre down.'],
	['Germination', 14, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 21, 'Two oval seed leaves, then simple oval true leaves.'],
	['Climbing', 60, 'A slender vine up its stake, tendrils grabbing, the leaves now three-lobed.'],
	['On the wire', 150, 'Over the top and along the wire both ways; shoots hang down like a curtain.'],
	['Flowering', 200, 'Extraordinary flowers on the hanging shoots: white petals, a crown of purple-and-white filaments, the stigmas on a column.'],
	['Fruit set', 210, 'Pollinated, each flower leaves a small round green fruit.'],
	['Green fruit', 240, 'Glossy green balls the size of an egg, hanging on their stalks.'],
	['Colouring', 275, 'They darken to purple.'],
	['Ripe', 285, 'Deep purple, wrinkling as they ripen; they drop when ready.']
]);

/** a passion-fruit leaf: three deep lobes, finely toothed */
function passionLeaf(/** @type {number} */ a) {
	const lobes = [[0, 1], [1.0, 0.88], [-1.0, 0.88]];
	let reach = 0;
	for (const [at, size] of lobes) reach = Math.max(reach, size * (1 - 0.7 * Math.min(1, Math.abs(a - at) / 0.5)));
	return Math.max(0.15, reach) * (1 + 0.03 * Math.abs(Math.sin(a * 30)));
}

/**
 * The passion fruit (maracuja) at a stage (0 … 9) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function passionFruit(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.01, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.003, 0.0012, 0.0022), coat: '#2a2420', coatShade: '#3a3028',
		stem: table(g, [[0, 0], [0.3, 0.001], [1, 0.014], [2, 0.03], [9, 0.03]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.001 + 0.002 * span(g, 1, 4), stemColor: '#7aa04a',
		leaf: { length: 0.014, width: 0.005, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.6), color: '#5a9a3c', vein: '#9cc46e' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.6), wither: span(g, 3, 3.6)
	});
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.5, grown: table(g, [[0, 0], [0.3, 0.01], [1, 0.06], [3, 0.4], [5, 1]]), radius: 0.003, down: 0.03, wander: 0.15, laterals: 10, lateral: 0.4, depth: 2, age: span(g, 3, 7), young: '#f1e4c8', old: '#a8865a' });
	// the stake and the wire it is trained along
	const POST = v3(0.04, 0, 0), WIRE = 1.8;
	if (g >= 2.8) {
		bag.add('prop', tube([POST.clone().add(v3(0, -0.3, 0)), POST.clone().add(v3(0, WIRE + 0.05, 0))], () => 0.03, () => '#8a6a4a', 8));
		bag.add('prop', tube([v3(-1.4, WIRE, 0), v3(1.4, WIRE, 0)], () => 0.002, () => '#9a9a98', 4));
	}
	// the vine: up the stake in a loose spiral, then along the wire both ways
	const climb = table(g, [[2, 0], [3, 0.4], [4, 1.8], [4.5, 1.8], [9, 1.8]]) * vigour;
	const reach = table(g, [[3.6, 0], [4.6, 0.9], [5.4, 1.3], [9, 1.35]]) * vigour;
	const up = [];
	for (let k = 0; k <= 30; k++) {
		const h = (k / 30) * climb;
		up.push(s.top.clone().lerp(POST.clone().add(v3(-0.03, 0, 0)), clamp(h / 0.2)).add(v3(Math.cos(h * 9) * 0.025, h, Math.sin(h * 9) * 0.025)));
	}
	if (climb > 0.01) bag.add('body', tube(up, (u) => 0.005 * (1 - 0.4 * u) * lerp(0.4, 1, span(g, 3, 6)), () => '#6f9a42', 5));
	/** a leaf, three-lobed, on its stalk @param {THREE.Vector3} p @param {THREE.Vector3} out @param {number} grown */
	const leaf = (p, out, grown) => {
		const stalk = p.clone().addScaledVector(out, 0.04).add(v3(0, 0.01, 0));
		bag.add('body', tube([p, stalk], () => 0.0012, () => '#7aa04a', 3));
		bag.add('sheet', fan({ size: 0.11 * vigour * lerp(0.3, 1, grown), from: -Math.PI + 0.5, to: Math.PI - 0.5, edge: passionLeaf, lift: (sv) => -0.12 * sv * sv, paint: (sv, a) => mix('#2f6a28', '#7ab04a', 1 - grown).lerp(new THREE.Color('#a6c47e'), [0, 1, -1].some((t) => Math.abs(a - t) < 0.04) ? 0.4 : 0), rings: 6, rays: 40 }), aim(stalk, out.clone().add(v3(0, -0.2, 0)).normalize(), 0));
	};
	for (let k = 2; k < 30; k += 3) leaf(up[k], v3(Math.cos(k * 2.4), 0, Math.sin(k * 2.4)), clamp((climb - (k / 30) * climb) / 0.3 + 0.3));
	for (const side of [-1, 1]) {
		const arm = [];
		for (let k = 0; k <= 20; k++) arm.push(POST.clone().add(v3(side * (k / 20) * reach, WIRE + Math.sin(k * 1.3) * 0.01, Math.cos(k * 0.9) * 0.015)));
		if (reach < 0.02) continue;
		bag.add('body', tube(arm, (u) => 0.0045 * (1 - 0.5 * u), () => '#6f9a42', 5));
		// shoots hanging down from the wire, a leaf at each node, a flower then a fruit in the axils
		const shoots = Math.floor(reach / 0.18);
		for (let h = 0; h < shoots; h++) {
			const sr = chance(seed, 'hang', side, h);
			const from = arm[Math.min(20, Math.round(((h + 0.6) * 0.18 / reach) * 20))];
			const len = table(g, [[4.2, 0], [5, 0.6], [6, 0.9], [9, 1.0]]) * between(sr, 0.6, 1.1) * vigour;
			if (len < 0.02) continue;
			const pts = [];
			for (let k = 0; k <= 10; k++) pts.push(from.clone().add(v3((sr() - 0.5) * 0.04 * k / 10, -(k / 10) * len, (sr() - 0.5) * 0.06 * k / 10 + 0.02 * k / 10)));
			bag.add('body', tube(pts, (u) => 0.003 * (1 - 0.5 * u), () => '#7aa04a', 4));
			for (let k = 1; k <= 10; k += 2) {
				const a = k * 2.4 + h;
				leaf(pts[k], v3(Math.cos(a), 0, Math.sin(a)), 1);
				if (k < 3 || k > 9) continue;
				const fr = chance(seed, 'passion', side, h, k);
				const opens = 4.8 + fr() * 0.5 + k * 0.03;
				if (g < opens - 0.2 || fr() > 0.7) continue;
				const set = span(g, opens + 0.25, opens + 2.0);
				const out = v3(Math.cos(a + Math.PI), 0, Math.sin(a + Math.PI));
				const stalkEnd = pts[k].clone().addScaledVector(out, 0.03).add(v3(0, -0.05, 0));
				bag.add('body', tube([pts[k], pts[k].clone().addScaledVector(out, 0.03), stalkEnd], () => 0.0012, () => '#7aa04a', 3));
				if (set < 0.03) passionFlower(bag, stalkEnd, out.clone().add(v3(0, -0.3, 0)).normalize(), clamp((g - opens + 0.2) / 0.3), span(g, opens + 0.15, opens + 0.25));
				else {
					const ripe = span(g, opens + 2.0, opens + 2.9);
					const r = (0.008 + 0.028 * set) * vigour;
					const wrinkle = span(g, 8.6, 9.5) * 0.12;
					const ax = [];
					for (let m = 0; m <= 12; m++) ax.push(stalkEnd.clone().add(v3(0, -(m / 12) * r * 2.1, 0)));
					bag.add('gloss', tube(ax, (u, v) => r * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.5) * (1 + wrinkle * Math.sin(u * 23 + v * 31) * Math.sin(v * 17)), () => mix(mix('#4f8a2e', '#5a7a3a', ripe), '#4a1a4a', ripe), 14));
				}
			}
		}
	}
	return bag.build();
}

/**
 * A passion flower: five white sepals and five white petals in a flat star, a crown of filaments banded purple and
 * white over them, and in the middle the column with its five anthers and three stigmas.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {number} open @param {number} wilt
 */
function passionFlower(bag, at, facing, open, wilt) {
	const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), facing), v3(1, 1, 1).multiplyScalar(1 - wilt * 0.5));
	for (let k = 0; k < 10; k++) {
		const petal = sheet({ length: 0.035 * lerp(0.4, 1, open), width: 0.009, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6), lift: (u) => 0.03 * u, paint: () => (k % 2 ? '#f6f6ee' : '#e8f0dc'), along: 6, across: 2 });
		bag.add('sheet', petal, m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 10) * Math.PI * 2)).multiply(new THREE.Matrix4().makeRotationZ(lerp(1.3, 0.05, open))));
	}
	if (open < 0.3) return;
	// the corona: many fine filaments, purple at their base, a white band, purple again, wavy at their tips
	for (let k = 0; k < 60; k++) {
		const a = (k / 60) * Math.PI * 2;
		const pts = [];
		for (let n = 0; n <= 4; n++) {
			const t = n / 4;
			pts.push(v3(Math.cos(a) * (0.004 + t * 0.028), 0.003 + Math.sin(t * Math.PI * 2 + k) * 0.002, Math.sin(a) * (0.004 + t * 0.028)).applyMatrix4(m));
		}
		bag.add('body', tube(pts, () => 0.0005, (t) => (t < 0.3 ? '#5a1a6a' : t < 0.55 ? '#f4f0f4' : '#7a3a9a'), 3));
	}
	bag.add('body', tube([v3(0, 0, 0).applyMatrix4(m), v3(0, 0.018, 0).applyMatrix4(m)], () => 0.0018, () => '#9ac06a', 5));
	for (let k = 0; k < 5; k++) {
		const a = (k / 5) * Math.PI * 2;
		bag.add('body', bead(v3(Math.cos(a) * 0.008, 0.016, Math.sin(a) * 0.008).applyMatrix4(m), v3(0.003, 0.0012, 0.0015), '#d8c040', 3));
	}
	for (let k = 0; k < 3; k++) {
		const a = (k / 3) * Math.PI * 2;
		bag.add('body', tube([v3(0, 0.018, 0).applyMatrix4(m), v3(Math.cos(a) * 0.007, 0.027, Math.sin(a) * 0.007).applyMatrix4(m)], () => 0.0008, () => '#6a4a3a', 3));
	}
}
