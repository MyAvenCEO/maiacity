/*
 * ALLIES — two plants a food forest grows less to eat than to feed the rest: comfrey and white clover.
 *
 * Comfrey (Symphytum officinale, Beinwell) is grown from a piece of its black-skinned root. It makes a clump of big
 * bristly lance leaves on winged stalks, and from its second spring stems a metre high, branching at the top into
 * curled cymes — coiled like a scorpion's tail — that uncurl as their nodding bells open, purple or pink or cream, one
 * after another. Its black taproot goes a metre and more down and brings up what the shallow roots cannot reach; cut
 * to a hand high and laid round as mulch (chop and drop), its leaves give it back to the soil, and it is up again in
 * weeks.
 *
 * White clover (Trifolium repens, Weißklee) creeps: from a seedling with a single first leaf, stolons run out over
 * the soil, rooting at every node and putting up a leaf of three leaflets on a long stalk, each leaflet marked with a
 * pale chevron; round white flower heads stand above the leaves on longer stalks still, their florets folding down and
 * browning as they set seed. On its roots, pink nodules where bacteria fix nitrogen from the air.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/**
 * A root drawn here rather than by `root`, so its path is known: wandering down from `from`, with the pink nodules of
 * a legume (the clover's, the bean's) along it, where the bacteria fix nitrogen. Its laterals are ordinary roots.
 * @param {Bag} bag
 * @param {{ seed: string, key: (string | number)[], from: THREE.Vector3, dir: THREE.Vector3, length: number, grown: number, radius: number, nodules: number, laterals: number, age: number }} o
 */
export function noduled(bag, o) {
	const r = chance(o.seed, 'noduled', ...o.key);
	const grown = clamp(o.grown);
	if (grown <= 0.01) return;
	const steps = 12;
	const pts = [o.from.clone()];
	const d = o.dir.clone().normalize();
	for (let i = 0; i < steps; i++) {
		d.y -= 0.06;
		d.x += (r() - 0.5) * 0.4;
		d.z += (r() - 0.5) * 0.4;
		if (d.y > -0.2) d.y = -0.2;
		d.normalize();
		pts.push(pts[i].clone().addScaledVector(d, (o.length * grown) / steps));
	}
	bag.add('body', tube(pts, (u) => o.radius * (0.4 + 0.6 * grown) * (1 - 0.75 * u), (u) => mix('#c8a878', '#f4ecd8', u * 1.4 - clamp(o.age) + 0.3), 5));
	for (let k = 0; k < o.laterals; k++) {
		const u = 0.15 + 0.75 * (k / o.laterals);
		if (u > grown) break;
		const i = Math.min(steps - 1, Math.floor(u * steps));
		const a = k * 2.39996 + r();
		root(bag, { seed: o.seed, key: [...o.key, 'lat', k], from: pts[i].clone(), dir: v3(Math.cos(a), -0.4, Math.sin(a)), length: o.length * between(r, 0.3, 0.55), grown: (grown - u) * 2.2, radius: o.radius * 0.4, down: 0.04, wander: 0.3, laterals: 3, lateral: 0.3, depth: 1, young: '#f6efdc', old: '#c8ae84' });
	}
	// the nodules: pink knobs, more as it ages
	const n = Math.round(o.nodules * clamp(o.age * 1.3));
	for (let k = 0; k < n; k++) {
		const u = between(r, 0.05, 0.6) * grown;
		const f = u * steps, i = Math.min(steps - 1, Math.floor(f));
		const p = pts[i].clone().lerp(pts[i + 1], f - i);
		const a = r() * Math.PI * 2;
		const s = o.radius * between(r, 0.7, 1.3);
		bag.add('body', bead(p.add(v3(Math.cos(a) * o.radius, 0, Math.sin(a) * o.radius)), v3(s, s * 0.85, s), mix('#e8a0a0', '#c87a7a', r()), 3));
	}
}

/* ------------------------------------------------------------------------------------------------ comfrey */

export const COMFREY_STAGES = stages([
	['Root cutting', 0, 'A finger of comfrey root, black outside and white inside, laid five centimetres down in spring.'],
	['Sprouting', 14, 'Buds break from its top; white roots from all along it.'],
	['First leaves', 30, 'A few bristly, pointed leaves, rough to touch.'],
	['Rosette', 70, 'Big lance leaves on winged stalks, spreading from the crown; the root turning black and going down.'],
	['Clump', 365, 'Its second spring: a dense clump of leaves half a metre long; the taproot a metre down.'],
	['Flowering stems', 400, 'Winged, bristly stems rise a metre from the clump, branching at the top.'],
	['Buds', 415, 'At every tip a curled cyme like a scorpion’s tail, packed with buds.'],
	['Flowering', 430, 'The cymes uncurl as their bells open one by one, nodding, a bumblebee at each.'],
	['Full bloom', 450, 'Bells all along the uncurled cymes; the lowest leaves yellowing.'],
	['Chop and drop', 460, 'Cut to a hand high and laid round it as mulch, feeding the soil; new leaves are up within days.']
]);

/** a comfrey leaf: long, broad at the middle, drawn out to a point, running down its stalk as a wing */
const comfreyLeaf = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.8) * (u < 0.1 ? 0.25 + u * 7.5 : 1);
/** the bells: purple most often, pink-violet, or cream */
const BELLS = [['#6a2f7a', '#9a5aa8'], ['#b0609a', '#d898c0'], ['#e8e0b8', '#f4f0d8']];

/**
 * Comfrey at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function comfrey(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const crown = v3(0, -0.012, 0);
	// the root cutting it grew from, swallowed into the crown as it thickens
	const cut = [];
	for (let k = 0; k <= 6; k++) cut.push(v3(-0.03 + k * 0.01, -0.05 - Math.sin(k * 0.5) * 0.004, 0.005 * Math.sin(k)));
	bag.add('body', tube(cut, (u) => 0.0065 * (0.7 + 0.3 * Math.sin(Math.PI * (0.1 + 0.8 * u))), () => '#2a2420', 6));
	// the taproots: black, deep, thick
	for (let i = 0; i < 4; i++) {
		const rr = chance(seed, 'comfrey-tap', i);
		const a = i * 2.39996;
		root(bag, { seed, key: ['tap', i], from: v3(-0.02 + i * 0.012, -0.05, 0), dir: v3(Math.cos(a) * 0.25, -1, Math.sin(a) * 0.25), length: (i === 0 ? 1.1 : between(rr, 0.45, 0.8)) * vigour, grown: table(g, [[0.4, 0], [1, 0.06], [2, 0.15], [3, 0.35], [4, 0.75], [5, 0.9], [7, 1]]) - i * 0.08, radius: (i === 0 ? 0.004 + 0.012 * span(g, 2, 6) : 0.003 + 0.006 * span(g, 3, 7)), down: 0.05, wander: 0.15, laterals: 8, lateral: 0.3, depth: 2, age: span(g, 1.5, 5), young: '#f2ece0', old: '#1e1a18' });
	}
	const cutDown = g >= 8.6;
	const space = bag.space;
	const colours = BELLS[(() => { const c = chance(seed, 'bells')(); return c < 0.6 ? 0 : c < 0.82 ? 1 : 2; })()];

	// the flowering stems, from the second spring
	/** @type {(() => void)[]} */
	const later = [];
	const stems = 4 + Math.floor(chance(seed, 'stems')() * 3);
	for (let s = 0; s < stems; s++) {
		const sr = chance(seed, 'comfrey-stem', s);
		const born = 4.3 + s * 0.12 + sr() * 0.2;
		if (g <= born) break;
		const rise = span(g, born, born + 1.1);
		const H = (0.85 + 0.25 * sr()) * vigour * rise;
		const a = s * 2.39996 + sr() * 0.5;
		const lean = between(sr, 0.08, 0.3);
		const out = v3(Math.cos(a), 0, Math.sin(a));
		if (cutDown) {
			// cut: the stem lies on the soil among the mulch
			const lie = out.clone().applyAxisAngle(v3(0, 1, 0), 0.4);
			const from = out.clone().multiplyScalar(0.12).setY(0.004);
			bag.add('body', tube([from, from.clone().addScaledVector(lie, H * 0.95)], () => 0.0045, () => '#5a6a3a', 5));
			bag.add('body', tube([v3(out.x * 0.02, 0, out.z * 0.02), v3(out.x * 0.025, 0.06, out.z * 0.025)], () => 0.005, () => '#5f7a3a', 5));
			continue;
		}
		const pts = [];
		for (let m = 0; m <= 10; m++) {
			const t = m / 10;
			pts.push(v3(out.x * (0.02 + Math.sin(lean) * H * t * (0.6 + 0.4 * t)), H * t, out.z * (0.02 + Math.sin(lean) * H * t * (0.6 + 0.4 * t))));
		}
		bag.add('body', tube(pts, (u) => 0.0055 * (1 - 0.5 * u) * lerp(0.5, 1, rise), () => '#5f8a3a', 5));
		space.rod(pts, 0.008);
		// leaves up the stem, alternate, smaller toward the top, their bases running down it as wings
		for (let j = 0; j < 6; j++) {
			const t = 0.18 + j * 0.11;
			const lg = clamp((rise - t) / 0.3);
			if (lg <= 0) continue;
			const p = pts[Math.round(t * 10)];
			const b = a + (j % 2 ? 2.2 : -2.2) + sr() * 0.3;
			const size = (0.22 - 0.022 * j) * vigour;
			later.push(() => {
				const o = space.steer(p, v3(Math.cos(b), 0, Math.sin(b)), 0.3, size, 0.02);
				leaf(bag, p, o, size * lerp(0.4, 1, lg), lerp(0.25, 0.95, lg), span(g, 8, 8.6) * (j < 2 ? 1 : 0), 0);
			});
		}
		// the top branches, each ending in a curled cyme of bells
		const forks = 2 + Math.floor(sr() * 2);
		for (let f = 0; f < forks; f++) {
			const fr = chance(seed, 'comfrey-fork', s, f);
			const from = pts[f === 0 ? 10 : 8];
			const fa = a + (f - 1) * 1.6 + fr() * 0.4;
			const end = from.clone().add(v3(Math.cos(fa) * 0.06 * rise, 0.04 * rise, Math.sin(fa) * 0.06 * rise));
			if (f > 0) bag.add('body', tube([from, end], () => 0.0025, () => '#5f8a3a', 4));
			cyme(bag, seed, [s, f], f === 0 ? from : end, v3(Math.cos(fa), 0, Math.sin(fa)), g, born, colours);
		}
	}

	// the basal leaves: the clump, from the crown
	const basal = 16;
	for (let i = 0; i < basal; i++) {
		const born = 1.6 + i * (i < 6 ? 0.35 : 0.22);
		if (g <= born) break;
		const lr = chance(seed, 'comfrey-leaf', i);
		const grown = clamp((g - born) / 1.3);
		const bear = i * 2.39996 + about(lr, 0, 0.2);
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		const size = (0.14 + 0.32 * clamp(i / 7)) * vigour * about(lr, 1, 0.08) * (g < 4 ? lerp(0.6, 1, clamp((g - 2) / 2)) : 1);
		if (cutDown) {
			// cut and laid down round it as mulch, wilting dark
			const d = 0.12 + (i % 4) * 0.06 + lr() * 0.05;
			const lay = out.clone().applyAxisAngle(v3(0, 1, 0), about(lr, 0, 0.5));
			bag.add('sheet', sheet({ length: size, width: size * 0.17, shape: comfreyLeaf, lift: (u, v) => 0.01 * v * v + 0.004 * Math.sin(u * 30 + v * 5), paint: (u) => mix('#4a5a2e', '#6a5a30', lr() * 0.6 + u * 0.2), along: 10, across: 4 }), aim(out.clone().multiplyScalar(d).setY(0.003 + (i % 5) * 0.0012), lay, 0));
			continue;
		}
		const old = span(g, 7.6 + i * 0.12, 8.6) * (i < 5 ? 1 : 0);
		const tilt = lerp(0.2, between(lr, 0.75, 1.05), grown) + old * 0.35;
		const at = crown.clone().addScaledVector(out, 0.01);
		later.push(() => {
			const o = space.steer(at.clone().add(v3(0, 0.05, 0)), out, Math.PI / 2 - tilt, size, 0.03);
			leaf(bag, at, o, size * lerp(0.3, 1, grown), tilt, old, 0.28 * size);
		});
	}
	// after the cut: new leaves straight up from the crown
	if (cutDown) {
		for (let i = 0; i < 7; i++) {
			const lr = chance(seed, 'comfrey-regrowth', i);
			const grown = clamp((g - 8.6 - i * 0.03) / 0.4);
			const bear = i * 2.39996;
			leaf(bag, crown.clone().add(v3(Math.cos(bear) * 0.012, 0, Math.sin(bear) * 0.012)), v3(Math.cos(bear), 0, Math.sin(bear)), (0.06 + 0.08 * grown) * about(lr, 1, 0.1) * vigour, lerp(0.15, 0.55, grown), 0, 0.03);
		}
	}
	for (const f of later) f();
	return bag.build();
}

/**
 * A comfrey leaf: on its winged stalk (`stalk` long, none for a stem leaf) from `at`, reaching out along `out`
 * (level) at `tilt` from upright, bristly and net-veined, yellowing as it gets `old`.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} out @param {number} size @param {number} tilt @param {number} old @param {number} stalk
 */
function leaf(bag, at, out, size, tilt, old, stalk) {
	const dir = out.clone().setY(0).normalize().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
	let base = at;
	if (stalk > 0) {
		base = at.clone().addScaledVector(dir, stalk);
		bag.add('body', tube([at, at.clone().addScaledVector(dir, stalk * 0.5).add(v3(0, stalk * 0.08, 0)), base], (u) => 0.004 * (1 - 0.3 * u), () => mix('#6a9a46', '#b8a04a', old), 4));
	}
	const blade = dir.clone().add(v3(0, -0.15, 0)).normalize();
	bag.add(
		'sheet',
		sheet({
			length: size,
			width: size * 0.17,
			shape: comfreyLeaf,
			// arching over, the edges a little up, the blade puckered between its net of veins
			lift: (u, v) => 0.06 * v * v - (0.16 + old * 0.2) * u * u + 0.006 * Math.sin(u * 34) * Math.sin(v * 7),
			paint: (u, v) => mix('#3f6a2e', '#c8b04a', clamp(old * 1.3 - (1 - u) * 0.2))
				.lerp(new THREE.Color('#8aa86a'), Math.abs(v) < 0.07 ? 0.45 : Math.abs(Math.sin(u * 16 - Math.abs(v) * 4)) > 0.93 ? 0.25 : 0)
				.lerp(new THREE.Color('#a8b098'), 0.08),
			along: 14,
			across: 4
		}),
		aim(base, blade, 0)
	);
}

/**
 * A curled cyme: a coiled stalk, its bells hanging from the outside of the coil, opening from its base toward the
 * curled tip as it uncurls.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} from @param {THREE.Vector3} out
 * @param {number} g @param {number} born @param {string[]} colours
 */
function cyme(bag, seed, key, from, out, g, born, colours) {
	const cr = chance(seed, 'cyme', ...key);
	const buds = span(g, born + 0.7, born + 1.4);
	if (buds <= 0) return;
	const uncurl = span(g, 6, 8.3);
	const len = 0.075 * lerp(0.35, 1, buds) * lerp(0.7, 1.1, uncurl);
	// the coil: out and up, then curling over and down and back
	const curl = lerp(4.2, 1.6, uncurl);
	const n = 12;
	const pts = [from.clone()];
	const side = out.clone();
	for (let k = 1; k <= n; k++) {
		const t = k / n;
		const a = Math.pow(t, 1.6) * curl;
		const step = len / n;
		const prev = pts[k - 1];
		pts.push(prev.clone().addScaledVector(side, Math.cos(a) * step * (1 + 0.3 * cr())).add(v3(0, Math.sin(a + 0.6) * step, 0)));
	}
	bag.add('body', tube(pts, (u) => 0.0018 * (1 - 0.5 * u), () => '#6a8a3a', 4));
	const bells = 11;
	for (let k = 0; k < bells; k++) {
		const t = (k + 0.5) / bells;
		const f = t * n, i = Math.min(n - 1, Math.floor(f));
		const p = pts[i].clone().lerp(pts[i + 1], f - i);
		// from the base of the cyme to its tip, one after another
		const open = span(g, 6.1 + t * 2.2, 6.4 + t * 2.2);
		const drop = span(g, 7.8 + t * 1.6, 8.1 + t * 1.6);
		const hang = v3((cr() - 0.5) * 0.5, -1, (cr() - 0.5) * 0.5).addScaledVector(out, 0.35).normalize();
		const calyx = p.clone().addScaledVector(hang, 0.004);
		bag.add('body', tube([p, calyx], () => 0.0007, () => '#6a8a3a', 3));
		bag.add('body', bead(calyx, v3(0.0025, 0.0022, 0.0025), '#5f7a3a', 3));
		if (drop >= 1) continue;
		const L = lerp(0.006, 0.016, open);
		const end = calyx.clone().addScaledVector(hang, L);
		const [deep, pale] = colours;
		bag.add('body', tube([calyx, calyx.clone().lerp(end, 0.5), end], (u) => lerp(0.0022, lerp(0.0028, 0.0042, open), u) * (1 - drop * 0.5), (u) => mix(open < 0.3 ? '#d890b0' : deep, pale, u * 0.6 * open), 6));
	}
}

/* ------------------------------------------------------------------------------------------------ white clover */

export const CLOVER_STAGES = stages([
	['Seed', 0, 'A tiny yellow, heart-shaped seed, pressed onto the soil’s surface.'],
	['Germination', 4, 'The radicle goes down, the hook comes up.'],
	['Seed leaves', 8, 'Two small round seed leaves on a short stem.'],
	['First leaf', 16, 'A single round first leaf on its stalk, then the first leaf of three.'],
	['Creeping', 40, 'Stolons run out over the soil, rooting at every node, a leaf of three at each.'],
	['Mat', 70, 'A mat of leaves on long stalks, every leaflet with a pale chevron; pink nodules on the roots fixing nitrogen.'],
	['Flowering', 90, 'Round white flower heads on stalks taller than the leaves, the bees at them all day.'],
	['Full flower', 105, 'Heads everywhere over the mat, the oldest florets folding down.'],
	['Setting seed', 120, 'The florets brown and hang, tiny pods inside them.'],
	['Seed', 140, 'Brown, dry heads full of seed; the mat creeps on, feeding the soil with its nitrogen.']
]);

/** a clover leaflet: broadest beyond its middle, rounded at the tip */
const obovate = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 1.25)), 0.55) * (u > 0.94 ? 0.8 : 1);

/**
 * White clover at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g @param {string} seed
 */
export function clover(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.003, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0013, 0.0007, 0.001), coat: '#d8b84a', coatShade: '#a8883a',
		stem: table(g, [[0, 0], [0.3, 0.0005], [1, 0.006], [2, 0.012], [9, 0.012]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
		radius: 0.0005 + 0.0006 * span(g, 1, 4), stemColor: '#8aa05a',
		leaf: { length: 0.005, width: 0.0028, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6), color: '#6aa046', vein: '#a6c47e' },
		open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 4, 5)
	});
	noduled(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.16, grown: table(g, [[0, 0], [0.3, 0.03], [1, 0.15], [2, 0.3], [4, 0.7], [6, 1]]), radius: 0.0012, nodules: 14, laterals: 6, age: span(g, 3, 6) });
	/** @type {(() => void)[]} */
	const later = [];
	// the first leaf, single and round, then a few leaves of three from the crown
	if (g > 2.3) later.push(() => trefoil(bag, seed, ['first'], s.top, 0.035, 0.6, clamp((g - 2.3) / 0.6), true, g));
	for (let i = 0; i < 5; i++) {
		const born = 2.8 + i * 0.35;
		if (g <= born) break;
		const lr = chance(seed, 'crown-leaf', i);
		const top = s.top.clone().add(v3(Math.cos(i * 2.4) * 0.006, 0, Math.sin(i * 2.4) * 0.006));
		later.push(() => trefoil(bag, seed, ['crown', i], top, between(lr, 0.05, 0.08) * vigour, i * 2.39996, clamp((g - born) / 0.7), false, g));
	}
	// the stolons
	for (let k = 0; k < 6; k++) {
		const kr = chance(seed, 'stolon', k);
		const born = 3.6 + k * 0.25 + kr() * 0.2;
		if (g <= born) break;
		const run = Math.min(0.42, (g - born) * 0.11) * vigour * between(kr, 0.8, 1.1);
		stolon(bag, seed, ['s', k], s.top.clone().setY(0.003), k * 2.39996 + kr() * 0.5, run, g, born, vigour, 0, later);
	}
	for (const f of later) f();
	return bag.build();
}

/**
 * A stolon creeping over the soil from `from`: a node every few centimetres, rooting into the soil, a leaf up on its
 * stalk, now and then a flower head, now and then a branch.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} from @param {number} head
 * @param {number} run @param {number} g @param {number} born @param {number} vigour @param {number} order @param {(() => void)[]} later
 */
function stolon(bag, seed, key, from, head, run, g, born, vigour, order, later) {
	if (run < 0.01) return;
	const sr = chance(seed, 'stolon-path', ...key);
	const step = 0.035;
	const pts = [from.clone()];
	let a = head;
	for (let s = step; s <= run + 1e-9; s += step) {
		a += (sr() - 0.5) * 0.5;
		const last = pts[pts.length - 1];
		pts.push(v3(last.x + Math.cos(a) * step, 0.0025, last.z + Math.sin(a) * step));
	}
	const rest = run - (pts.length - 1) * step;
	if (rest > 0.001) {
		const last = pts[pts.length - 1];
		a += (sr() - 0.5) * 0.5;
		pts.push(v3(last.x + Math.cos(a) * rest, 0.0025, last.z + Math.sin(a) * rest));
	}
	if (pts.length < 2) return;
	bag.add('body', tube(pts, (u) => 0.0014 * (1 - 0.3 * u), (u) => mix('#8a9a5a', '#b0c07a', u), 4));
	bag.space.rod(pts, 0.003);
	for (let i = 1; i < pts.length; i++) {
		const nr = chance(seed, 'clover-node', ...key, i);
		const p = pts[i];
		// how long ago the tip passed this node
		const age = (run - i * step) / (0.11 * vigour);
		const grown = clamp(age / 0.6);
		root(bag, { seed, key: [...key, 'node', i], from: p.clone().add(v3(0, -0.003, 0)), dir: v3(nr() - 0.5, -1, nr() - 0.5), length: between(nr, 0.05, 0.09), grown: age / 1.2, radius: 0.0007, down: 0.05, wander: 0.3, laterals: 3, lateral: 0.3, depth: 1, young: '#f6efdc', old: '#d8c49a' });
		const b = a + (i % 2 ? 1.2 : -1.2) + nr();
		later.push(() => trefoil(bag, seed, [...key, i], p, between(nr, 0.05, 0.1) * vigour, b, grown, false, g));
		// a branch now and then from the older nodes
		if (order === 0 && i >= 2 && nr() < 0.3) {
			const bborn = born + (i * step) / (0.11 * vigour) + 0.5;
			if (g > bborn) stolon(bag, seed, [...key, 'b', i], p, b + (nr() - 0.5), Math.min(0.2, (g - bborn) * 0.1) * vigour, g, bborn, vigour, 1, later);
		}
		// a flower head at a node old enough, on a stalk taller than the leaves
		if (i >= 2 && nr() < 0.4) {
			const opens = Math.max(5.5, born + (i * step) / (0.11 * vigour) + 1.4) + nr() * 0.5;
			if (g > opens - 0.6) later.push(() => flowerHead(bag, seed, [...key, 'head', i], p, b + 0.8, between(nr, 0.11, 0.16) * vigour, g, opens));
		}
	}
}

/**
 * A clover leaf on its stalk: three leaflets spread level at its top (or one round one, the first leaf), each marked
 * with a pale chevron; folded together while young.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} at @param {number} height
 * @param {number} bear @param {number} grown @param {boolean} single @param {number} g
 */
function trefoil(bag, seed, key, at, height, bear, grown, single, g) {
	if (grown <= 0.02) return;
	const lr = chance(seed, 'trefoil', ...key);
	const h = height * lerp(0.3, 1, grown);
	const lean = v3(Math.cos(bear), 0, Math.sin(bear)).multiplyScalar(h * 0.25);
	const top = at.clone().add(v3(lean.x, h, lean.z));
	bag.add('body', tube([at, at.clone().add(v3(lean.x * 0.3, h * 0.6, lean.z * 0.3)), top], () => 0.0007, () => '#8aa860', 3));
	const fold = (1 - grown) * 0.9;
	const old = span(g, 8.4, 9.6) * lr() * 0.6;
	const size = (single ? 0.008 : 0.0135) * about(lr, 1, 0.12) * lerp(0.4, 1, grown);
	const mark = lr() < 0.85;
	const n = single ? 1 : 3;
	for (let k = 0; k < n; k++) {
		const a = bear + (k / 3) * Math.PI * 2 + about(lr, 0, 0.1);
		const dir = v3(Math.cos(a), lerp(1.4, 0.12, grown), Math.sin(a)).normalize();
		bag.add(
			'sheet',
			sheet({
				length: size,
				width: size * (single ? 0.6 : 0.45),
				shape: single ? (u) => Math.pow(Math.sin(Math.PI * u), 0.5) : obovate,
				lift: (u, v) => fold * Math.abs(v) * 0.4 + 0.04 * v * v,
				// the pale chevron across the middle, its point toward the base
				paint: (u, v) => mix('#3f7a32', '#b8a84a', old).lerp(new THREE.Color('#d0e0c0'), mark && !single && Math.abs(u - (0.4 + 0.3 * Math.abs(v))) < 0.07 ? 0.55 : 0),
				along: 5,
				across: 3
			}),
			aim(top, dir, 0)
		);
	}
}

/**
 * A white clover head: a ball of little florets on a long stalk, opening from the outside in, then folding down and
 * browning as the seed sets.
 * @param {Bag} bag @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} at @param {number} bear
 * @param {number} height @param {number} g @param {number} opens
 */
function flowerHead(bag, seed, key, at, bear, height, g, opens) {
	const hr = chance(seed, 'clover-head', ...key);
	const rise = span(g, opens - 0.6, opens);
	const h = height * lerp(0.3, 1, rise);
	const lean = v3(Math.cos(bear), 0, Math.sin(bear)).multiplyScalar(h * 0.2);
	const top = at.clone().add(v3(lean.x, h, lean.z));
	bag.add('body', tube([at, at.clone().add(v3(lean.x * 0.2, h * 0.5, lean.z * 0.2)), top], () => 0.0008, () => '#8aa860', 3));
	const R = 0.0085 * lerp(0.5, 1, rise);
	const florets = 34;
	for (let m = 0; m < florets; m++) {
		const t = m / florets;
		const phi = Math.acos(1 - 2 * t * 0.95), th = m * 2.39996;
		const out = v3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
		// the lowest florets open first and are first to fold down and brown
		const open = span(g, opens + (1 - t) * 0.1 - 0.1, opens + 0.3 + (1 - t) * 0.3);
		const over = span(g, opens + 1.2 + t * 1.2, opens + 1.6 + t * 1.2);
		const d = out.clone().lerp(v3(out.x * 0.4, -1, out.z * 0.4), over).normalize();
		const c = over > 0.2 ? mix('#e8dcc8', '#8a6a4a', over) : open < 0.3 ? mix('#c8d8b0', '#f0f2e8', open) : mix('#f6f6ee', '#f0d8dc', hr() * 0.4);
		bag.add('body', bead(top.clone().addScaledVector(d, R * 0.75), v3(0.001, 0.0034, 0.001).multiplyScalar(lerp(0.6, 1, open)), c, 2, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), d)));
	}
}
