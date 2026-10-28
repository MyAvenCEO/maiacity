/*
 * ORCHARD, AS IT WAS AT v1 — frozen (5 October 2026): the plants whose fruit it placed differently then (the
 * cacao, the jackfruit, the durian, the soursop: their fruit on the trunk and the limbs) keep their v1 here, in their
 * history ($lib/app/versions.js). Never change this file; ./orchard.js is the living one.
 *
 * ORCHARD — a fruit tree from its seed, made from a description (`Orchard`): the seed and how it comes up (its seed
 * leaves above the soil, or kept inside the seed below it), its roots, its crown (./crown.js: in flushes or with a
 * leader), its leaves (in whorls at the shoot tips or all along them), its flowers (where they come — at the shoot
 * tips, in the leaf axils of the newest shoots, on spurs on the thin outer branches, along the limbs, or on the trunk
 * itself — and what they look like) and its fruit (its shape and skin, how it
 * hangs, how it ripens). The mango, the apple, the orange, the lemon, the durian and the jackfruit are each one such
 * description (./trees.js).
 *
 * Its stages are the same ten as every plant's: seed, germination, seedling, sapling, young tree, flowering, then the
 * fruit's four — set, green, colouring, ripe.
 */
import * as THREE from 'three';
import { Bag, Space, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { bloom } from './bloom.js';
import { flushCrown, leaderCrown } from './crown.js';

/**
 * @typedef {{
 *   seed: { size: THREE.Vector3, coat: string, shade: string, depth: number }, hypogeal: boolean,
 *   cotyledon?: { length: number, width: number, colour: string },
 *   flush?: import('./crown.js').Flush, leader?: import('./crown.js').Leader,
 *   roots: { tap: number, spread: number, count: number, radius: number },
 *   leaf: { length: number, width: number, shape: (u: number) => number, colour: string, young: string, style: 'whorl' | 'along', per: number, droop: number, from?: number, gloss?: boolean },
 *   flower: { kind?: import('./bloom.js').Kind, panicle?: boolean, catkin?: boolean, size: number, opens: number, sites: 'tips' | 'shoots' | 'spurs' | 'limbs' | 'trunk', chance: number, per: [number, number], axils?: [number, number] },
 *   fruit: {
 *     length: number, width: number, shape: (u: number, v: number) => number, colour: (ripe: number, u: number, v: number) => THREE.Color,
 *     skin?: { colour: (ripe: number) => string, count: number, size: number, length: number }, stalk: number, keep: [number, number],
 *     setFor: number, ripeFrom: number, ripeFor: number, gloss: boolean, calyx?: string
 *   }
 * }} Orchard — a fruit tree, described. `fruit.shape(u, v)` its radius (0 … 1) along it and round it, `skin` its
 *   spines or warts, `keep` how many fruit a flowering site keeps, `setFor` how long they take to grow, `ripeFrom`
 *   and `ripeFor` when after flowering they colour, over how long
 */

/**
 * @param {Orchard} spec
 * @returns {(g: number, seed: string) => THREE.Group}
 */
export function orchard(spec) {
	return (g, seed) => {
		const bag = new Bag();
		const vigour = about(chance(seed, 'plant'), 1, 0.08);
		const at = v3(0, -spec.seed.depth, 0);

		// the seed, and how it comes up
		const s = sprout(bag, {
			seed,
			at,
			size: spec.seed.size,
			coat: spec.seed.coat,
			coatShade: spec.seed.shade,
			stem: table(g, [[0, 0], [0.3, spec.seed.depth * 0.1 + 0.001], [1, spec.seed.depth + 0.03], [2, spec.seed.depth + 0.07], [9, spec.seed.depth + 0.07]]),
			hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
			radius: 0.0018 + 0.004 * span(g, 1, 3),
			stemColor: '#7a7a42',
			leaf: spec.cotyledon ? { length: spec.cotyledon.length, width: spec.cotyledon.width, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.7), color: spec.cotyledon.colour, vein: '#a6c47e' } : { length: 0.001, width: 0.0005, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
			open: spec.hypogeal ? 0 : span(g, 1.1, 2),
			shed: spec.hypogeal ? span(g, 3.5, 4.5) : span(g, 1, 1.6),
			wither: spec.hypogeal ? 1 : span(g, 3, 3.8),
			keepCoat: spec.hypogeal
		});

		// the roots: a taproot going deep, and roots spreading wide near the surface
		root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0.02, -1, 0.01), length: spec.roots.tap, grown: table(g, [[0, 0], [0.3, 0.004], [1, 0.03], [2, 0.07], [3, 0.2], [4, 0.45], [5, 0.75], [6, 0.9], [8, 1]]), radius: 0.002 + spec.roots.radius * span(g, 2, 8), down: 0.03, wander: 0.1, laterals: 10, lateral: 0.3, depth: 2, age: span(g, 1.5, 6), young: '#f3e6cc', old: '#6e5032' });
		for (let i = 0; i < spec.roots.count; i++) {
			const rr = chance(seed, 'feeder', i);
			const born = 2.6 + i * (4 / spec.roots.count);
			const bear = i * 2.39996 + rr() * 0.4;
			root(bag, { seed, key: ['feeder', i], from: at.clone().add(v3(0, -0.04 - rr() * 0.12, 0)), dir: v3(Math.cos(bear), -0.15, Math.sin(bear)), length: between(rr, 0.6, 1) * spec.roots.spread * vigour, grown: (g - born) / 2.8, radius: 0.003 + spec.roots.radius * 0.4 * span(g, 3, 8), down: 0.01, wander: 0.14, laterals: 5, lateral: 0.25, depth: 2, age: (g - born - 0.6) / 2.5, young: '#efdcb8', old: '#6e5032' });
		}

		// which shoot tips flower: drawn by their place in the tree, the same at every stage; once chosen a tip
		// flushes no further — it is a flowering and fruiting terminal now
		const f = spec.flower;
		const tipSite = (/** @type {(string | number)[]} */ key, /** @type {number} */ gen, /** @type {number} */ born) => {
			if ((f.sites !== 'tips' && f.sites !== 'shoots') || gen < 2) return false;
			const fr = chance(seed, 'site', ...key);
			// the shoots of the last flush before flowering: the outermost tips of the crown when it blooms
			return fr() < f.chance && born < f.opens - 0.05 && born > f.opens - 0.75;
		};
		const shoots = spec.flush
			? flushCrown(bag, { seed, g, from: s.top.clone(), spec: { ...spec.flush, stop: (key, gen, born) => tipSite(key, gen, born) } })
			: spec.leader
				? leaderCrown(bag, { seed, g, from: s.top.clone(), spec: spec.leader })
				: [];

		// what is where, so the fruit hang clear of the wood and of each other
		const space = bag.space;
		for (const sh of shoots) if (sh.gen <= 2 && sh.radius > 0.01) space.rod(sh.pts, sh.radius + 0.01);

		// the flowering sites
		/** @type {{ at: THREE.Vector3, dir: THREE.Vector3, key: (string | number)[] }[]} */
		const sites = [];
		for (const sh of shoots) {
			if (f.sites === 'tips' && sh.end && tipSite(sh.key, sh.gen, sh.born)) sites.push({ at: sh.tip, dir: sh.dir, key: sh.key });
			// shoots: the flowers in the leaf axils of the newest shoots, one to a leaf (the kaki, the fig, the mulberry,
			// the peach) — out at the crown's edge, among the leaves, `axils` of them a shoot
			if (f.sites === 'shoots' && tipSite(sh.key, sh.gen, sh.born)) {
				const ar = chance(seed, 'axils', ...sh.key);
				const [a, b] = f.axils ?? [2, 4];
				const n = a + Math.floor(ar() * (b - a + 1));
				for (let k = 0; k < n; k++) sites.push(onBark(along(sh.pts, 0.35 + (0.6 * (k + ar() * 0.6)) / n), sh.radius, ar, [...sh.key, 'axil', k]));
			}
			// spurs: short fruiting spurs on the two- and three-year-old wood (the stone fruit, the pear), `chance` of them
			// a metre — the thin outer branches, never the scaffold limbs or the thick wood they branch from
			if (f.sites === 'spurs' && sh.gen >= 3 && sh.born < f.opens - 0.05) {
				const sr = chance(seed, 'spur', ...sh.key);
				const n = Math.floor(sh.length * f.chance + sr());
				for (let k = 0; k < n; k++) sites.push(onBark(along(sh.pts, between(sr, 0.3, 0.95)), sh.radius, sr, [...sh.key, 'spur', k]));
			}
			if (f.sites === 'limbs' && sh.gen === 1) {
				const lr = chance(seed, 'limb-site', ...sh.key);
				const n = Math.floor(sh.length * f.chance);
				for (let k = 0; k < n; k++) sites.push({ ...along(sh.pts, between(lr, 0.25, 0.8)), key: [...sh.key, k] });
			}
			if (f.sites === 'trunk' && sh.gen === 0) {
				const tr = chance(seed, 'trunk-site');
				const n = Math.floor(sh.length * f.chance);
				for (let k = 0; k < n; k++) {
					const p = along(sh.pts, between(tr, 0.12, 0.7));
					const a = tr() * Math.PI * 2;
					// on the bark's surface, facing out
					p.at.add(v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(sh.radius * 0.8));
					sites.push({ at: p.at, dir: v3(Math.cos(a), 0, Math.sin(a)), key: ['trunk', k] });
				}
			}
			if (f.sites === 'trunk' && sh.gen === 1) {
				const lr = chance(seed, 'limb-site', ...sh.key);
				if (lr() < 0.5) sites.push({ ...along(sh.pts, between(lr, 0.1, 0.35)), key: sh.key });
			}
		}
		for (const site of sites) flowering(bag, spec, seed, g, site, space, vigour);

		// the leaves
		for (const sh of shoots) leaves(bag, spec, seed, g, sh);
		return bag.build();
	};
}

/** a place along a path, u 0 … 1 */
/**
 * A site on the bark of a shoot rather than in its core: moved out to its surface on a side drawn by `r`, facing out
 * and a little along the shoot.
 * @param {{ at: THREE.Vector3, dir: THREE.Vector3 }} p @param {number} radius @param {() => number} r @param {(string | number)[]} key
 */
function onBark(p, radius, r, key) {
	const side = new THREE.Vector3().crossVectors(p.dir, Math.abs(p.dir.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0)).normalize();
	side.applyAxisAngle(p.dir, r() * Math.PI * 2);
	// below the shoot rather than on top of it, mostly: where the fruit hang
	if (side.y > 0.3) side.y *= -1;
	return { at: p.at.clone().addScaledVector(side, radius * 0.9), dir: side.clone().addScaledVector(p.dir, 0.6).normalize(), key };
}

function along(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
	return { at: pts[k].clone().lerp(pts[k + 1], f - k), dir: pts[k + 1].clone().sub(pts[k]).normalize() };
}

/**
 * The leaves of a shoot: a whorl at its tip (and a few below it), or one by one all along it. A new flush its own
 * colour (the mango's bronze-red, the lemon's purple), darkening as it hardens.
 * @param {Bag} bag @param {Orchard} spec @param {string} seed @param {number} g @param {import('./crown.js').Shoot} sh
 */
function leaves(bag, spec, seed, g, sh) {
	const L = spec.leaf;
	const lr = chance(seed, 'leaves', ...sh.key);
	const isLeader = !!spec.leader;
	// which shoots carry leaves: the outermost (still at the crown's surface); a young tree's trunk too
	// the outermost two flushes keep their leaves; a young tree's trunk too
	const outer = (spec.flush?.gens ?? 0) - 1;
	const leafy = isLeader ? sh.gen >= 1 || g > 3.5 : sh.end || (sh.gen === 0 && g < 3.4) || sh.gen >= Math.min(L.from ?? 99, outer);
	if (!leafy) return;
	const age = clamp((g - sh.born) / 0.9);
	const colour = (/** @type {number} */ u, /** @type {number} */ v) => mix(L.young, L.colour, age).lerp(new THREE.Color('#d8d8a0'), Math.abs(v) < 0.1 ? 0.25 : 0);
	/** one leaf, at p, reaching out along `out`, hanging by `droop` @param {THREE.Vector3} p @param {THREE.Vector3} out */
	const leaf = (p, out) => {
		const len = L.length * between(lr, 0.75, 1.1) * lerp(0.5, 1, age) * lerp(0.55, 1, clamp(g - 2));
		const hang = lerp(-1.2, -L.droop, age) + about(lr, 0, 0.25);
		const dir = out.clone().setY(0).normalize().multiplyScalar(Math.cos(hang)).add(v3(0, Math.sin(hang), 0)).normalize();
		bag.add(
			'sheet',
			sheet({ length: len, width: len * (L.width / L.length), shape: L.shape, lift: (u, v) => 0.05 * v * v - 0.06 * u * u, paint: colour, along: 8, across: 2 }),
			aim(p.clone().addScaledVector(dir, 0.01), dir, (lr() - 0.5) * 0.7)
		);
	};
	if (L.style === 'whorl') {
		for (let k = 0; k < L.per; k++) {
			const bear = k * 2.39996 + lr() * 0.5;
			const out = v3(Math.cos(bear), 0, Math.sin(bear)).addScaledVector(sh.dir, 0.7);
			const { at } = along(sh.pts, 1 - (k % 3) * 0.08);
			leaf(at, out);
		}
		return;
	}
	if (isLeader && sh.gen === 0) {
		// the leader's own top: sprays up its last two metres or so, so it does not stand bare over the crown
		const top = Math.min(2.4, sh.length * 0.3);
		for (let k = 0; k < 18; k++) {
			const { at, dir } = along(sh.pts, 1 - (top / sh.length) * (k / 18));
			for (let m = 0; m < L.per * 2; m++) {
				const a = (k * L.per * 2 + m) * 2.39996;
				// on short twigs out from the leader, the higher the shorter
				const twig = 0.05 + 0.35 * (k / 18);
				leaf(at.clone().add(v3(Math.cos(a) * twig, 0, Math.sin(a) * twig)), v3(Math.cos(a), 0, Math.sin(a)).addScaledVector(dir, 0.6));
			}
		}
		return;
	}
	if (isLeader) {
		// sprays of leaves all along the side shoots, and along the outer half of the limbs
		const step = L.length * 0.75;
		const n = Math.min(24, Math.floor(sh.length / step));
		for (let k = 0; k < n; k++) {
			const u = (sh.gen === 1 ? 0.5 : 0.1) + ((k + 0.5) / n) * (sh.gen === 1 ? 0.5 : 0.9);
			const { at, dir } = along(sh.pts, u);
			for (let m = 0; m < L.per; m++) {
				const a = m * 2.39996 + lr() * 0.6;
				leaf(at, v3(Math.cos(a), 0, Math.sin(a)).addScaledVector(dir, 0.9));
			}
		}
		return;
	}
	const n = Math.max(1, Math.round(sh.length / (L.length * 0.3)));
	for (let k = 0; k < Math.min(n, 24); k++) {
		const u = 0.15 + (k / Math.max(1, n)) * 0.85;
		const { at, dir } = along(sh.pts, u);
		const side = new THREE.Vector3().crossVectors(dir, v3(0, 1, 0));
		if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
		side.normalize().multiplyScalar(k % 2 ? 1 : -1);
		leaf(at, side.addScaledVector(dir, 0.5).add(v3(lr() - 0.5, 0, lr() - 0.5).multiplyScalar(0.6)));
	}
}

/**
 * A flowering site through its stages: buds, flowers (a panicle, a cluster, a catkin), then the fruit it keeps,
 * swelling and ripening on its stalk.
 * @param {Bag} bag @param {Orchard} spec @param {string} seed @param {number} g
 * @param {{ at: THREE.Vector3, dir: THREE.Vector3, key: (string | number)[] }} site @param {Space} space @param {number} vigour
 */
function flowering(bag, spec, seed, g, site, space, vigour) {
	const f = spec.flower, F = spec.fruit;
	const fr = chance(seed, 'flowering', ...site.key);
	const opens = f.opens + fr() * 0.5;
	const phase = g - opens;
	if (phase < -0.3) return;
	const up = site.dir.clone().lerp(v3(0, 1, 0), 0.6).normalize();
	if (phase < 0.55) {
		const open = clamp(phase / 0.2);
		if (f.panicle) {
			// an upright cone of branched reddish stalks crowded with tiny flowers
			const len = 0.3 * lerp(0.3, 1, clamp((phase + 0.3) / 0.4));
			const tip = site.at.clone().addScaledVector(up, len);
			bag.add('body', tube([site.at, tip], (u) => 0.005 * (1 - 0.8 * u), () => '#b0473a', 5));
			for (let k = 0; k < 12; k++) {
				const u = 0.1 + (k / 12) * 0.85;
				const base = site.at.clone().lerp(tip, u);
				const a = k * 2.39996;
				const end = base.clone().addScaledVector(v3(Math.cos(a), 0.4, Math.sin(a)).normalize(), 0.09 * (1 - u) + 0.02);
				bag.add('body', tube([base, end], () => 0.0015, () => '#b0473a', 3));
				for (let m = 0; m < 4; m++) bag.add('body', bead(base.clone().lerp(end, 0.35 + m * 0.2), v3(0.004, 0.004, 0.004), open > 0.3 ? (m % 2 ? '#f0d7a0' : '#e7a29a') : '#c9b46a', 2));
			}
			return;
		}
		if (f.catkin) {
			// the jackfruit's flower heads: green club-shaped spikes on short stout stalks out of the bark
			const n = f.per[0] + Math.floor(fr() * (f.per[1] - f.per[0] + 1));
			for (let k = 0; k < n; k++) {
				const d = site.dir.clone().add(v3((fr() - 0.5) * 0.8, -0.3, (fr() - 0.5) * 0.8)).normalize();
				const end = site.at.clone().addScaledVector(d, 0.03);
				bag.add('body', tube([site.at, end], () => 0.004, () => '#5f7a34', 4));
				bag.add('body', bead(end.clone().addScaledVector(d, 0.03 * f.size), v3(0.012, 0.035, 0.012).multiplyScalar(f.size * lerp(0.4, 1, clamp(phase + 0.3))), '#8aa64a', 6, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), d)));
			}
			return;
		}
		// a cluster of flowers on short stalks
		const n = f.per[0] + Math.floor(fr() * (f.per[1] - f.per[0] + 1));
		for (let k = 0; k < n; k++) {
			const a = (k / n) * Math.PI * 2 + fr();
			const d = up.clone().add(v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.7)).add(v3(0, f.sites === 'tips' ? 0 : -1.2, 0)).normalize();
			const end = site.at.clone().addScaledVector(d, 0.025 * f.size);
			bag.add('body', tube([site.at, end], () => 0.0012 * f.size, () => '#6f7a3a', 4));
			if (phase < 0 || !f.kind) bag.add('body', bead(end.clone().addScaledVector(d, 0.004), v3(0.004, 0.006, 0.004).multiplyScalar(f.size), '#dfe2c0', 4));
			else bloom(bag, f.kind, end, d, f.size, open, span(phase, 0.35, 0.55));
		}
		return;
	}
	// set: the fruit the site keeps, hanging on its stalk, swelling and ripening
	const set = span(phase, 0.55, 0.55 + F.setFor);
	const ripe = span(phase, F.ripeFrom, F.ripeFrom + F.ripeFor);
	const keep = F.keep[0] + Math.floor(fr() * (F.keep[1] - F.keep[0] + 1));
	for (let k = 0; k < keep; k++) {
		const kr = chance(seed, 'fruit', ...site.key, k);
		const size = vigour * about(kr, 1, 0.1);
		const L = F.length * size * lerp(0.15, 1, set);
		const W = F.width * size * lerp(0.15, 1, set);
		const swing = v3(Math.cos(k * 2.4 + kr() * 3), 0, Math.sin(k * 2.4 + kr() * 3));
		const start = site.at.clone().addScaledVector(f.sites === 'tips' ? up : site.dir, F.stalk * 0.25);
		const hangFrom = start.clone().addScaledVector(swing, F.stalk * 0.25).add(v3(0, -F.stalk * lerp(0.3, 1, set), 0));
		const place = space.settle(hangFrom, v3(0, -1, 0).addScaledVector(swing, 0.15), (a, d) => [0.3, 0.7].map((t) => ({ c: a.clone().addScaledVector(d, L * t), r: W * 0.92 })), F.stalk * 0.5 + W);
		bag.add('body', tube([site.at, start, place.at], (u) => 0.002 + 0.004 * set * (F.width / 0.05) * (1 - 0.4 * u), () => '#6f6a3a', 4));
		fruitOf(bag, F, { seed, key: [...site.key, k], at: place.at, dir: place.dir, L, W, ripe, set });
	}
}

/**
 * A fruit of the described shape, hanging from `at` along `dir`: its skin coloured as it ripens, its spines or warts
 * if it has them, its calyx at the stalk.
 * @param {Bag} bag @param {Orchard['fruit']} F
 * @param {{ seed: string, key: (string | number)[], at: THREE.Vector3, dir: THREE.Vector3, L: number, W: number, ripe: number, set: number }} o
 */
function fruitOf(bag, F, o) {
	const fr = chance(o.seed, 'fruit-shape', ...o.key);
	const sun = fr() * Math.PI * 2;
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), sun)), v3(1, 1, 1));
	const axis = [];
	const rings = 18;
	for (let k = 0; k <= rings; k++) axis.push(v3(0, -0.002 - (k / rings) * o.L, 0));
	bag.add(F.gloss ? 'gloss' : 'body', tube(axis, (u, v) => o.W * F.shape(u, v), (u, v) => F.colour(o.ripe, u, v), 20), m);
	if (F.calyx) bag.add('body', bead(v3(0, -0.002, 0), v3(1, 0.5, 1).multiplyScalar(Math.max(0.003, o.W * 0.18)), F.calyx, 4), m);
	if (F.skin && o.set > 0.05) {
		const skin = F.skin;
		const n = Math.round(skin.count * clamp(o.set * 1.5));
		const c = skin.colour(o.ripe);
		for (let k = 0; k < n; k++) {
			const u = 0.06 + 0.88 * ((k + 0.5) / n);
			const a = k * 2.39996;
			const rad = o.W * F.shape(u, a / (Math.PI * 2));
			const out = v3(Math.cos(a), 0, Math.sin(a));
			const at = v3(0, -0.002 - u * o.L, 0).addScaledVector(out, rad);
			const s = skin.size * lerp(0.4, 1, o.set);
			bag.add('body', bead(at.addScaledVector(out, s * skin.length * 0.5), v3(s, s * skin.length, s), c, 2, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), out)), m);
		}
	}
}
