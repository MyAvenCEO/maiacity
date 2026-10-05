/*
 * WALD · BERRIES — the shrub layer of a temperate forest garden, and the kiwi that climbs over it: the redcurrant
 * (Rote Johannisbeere), the blackcurrant (Schwarze Johannisbeere), the gooseberry (Stachelbeere), the blackberry
 * (Brombeere), the aronia (Apfelbeere), the haskap (Maibeere), the Japanese rose (Kartoffelrose) and the hardy kiwi
 * (Kiwibeere) on its post.
 *
 * The bushes are one shape grown from a description (`shrub`): a seedling, a crown of stems coming up from the soil
 * year by year, each branching twice (./tree.js), leaves all along the younger wood, and the flowers and fruit where
 * each species really bears them — the redcurrant's hanging strigs from spurs on the older wood, the blackcurrant's on
 * last year's shoots, the gooseberry's single berries under the branches, the aronia's flat corymbs at the shoot tips,
 * the haskap's paired flowers in the leaf axils, the rose's flowers and hips at the ends of the season's shoots. The
 * blackberry is canes (as ./raspberry.js is): a first summer of long arching primocanes, then their side shoots with
 * flowers and berries ripening unevenly, green, red and black at once. The kiwi twines up its post and runs along the
 * bar, its shoots hanging in a curtain with the fruit under the leaves.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, fan, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { limb } from './tree.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));
const UP = v3(0, 1, 0);

/** @typedef {{ c: THREE.Vector3, r: number }} Ball */
/** @typedef {import('./tree.js').Limb} Limb */

/** the point at the distance s along a path, and its direction there — null past its end */
function walk(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ s) {
	let left = Math.max(0, s);
	for (let i = 1; i < pts.length; i++) {
		const seg = pts[i].distanceTo(pts[i - 1]);
		if (left <= seg) {
			const t = seg > 1e-9 ? left / seg : 0;
			return { p: pts[i - 1].clone().lerp(pts[i], t), d: pts[i].clone().sub(pts[i - 1]).normalize() };
		}
		left -= seg;
	}
	return null;
}

/** a direction square to d, turned round it by a */
function round(/** @type {THREE.Vector3} */ d, /** @type {number} */ a) {
	const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.95 ? v3(1, 0, 0) : UP).normalize();
	return side.applyAxisAngle(d, a);
}

/** level and of unit length, or `or` when it has no level part */
function level(/** @type {THREE.Vector3} */ d, or = v3(1, 0, 0)) {
	const h = d.clone().setY(0);
	return h.lengthSq() < 1e-8 ? or.clone() : h.normalize();
}

/** a colour along stops ([t, colour], t rising), at t */
function ramp(/** @type {[number, string][]} */ stops, /** @type {number} */ t) {
	if (t <= stops[0][0]) return new THREE.Color(stops[0][1]);
	for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
	return new THREE.Color(stops[stops.length - 1][1]);
}

/**
 * Which way a leaf reaches so that its blade keeps out of the fruit: its bearing turned round the upright as little
 * as it needs. Only when it would touch one does it look further.
 * @param {Ball[]} balls @param {THREE.Vector3} p @param {THREE.Vector3} dir @param {number} len
 */
function clear(balls, p, dir, len) {
	if (!balls.length) return dir;
	const r = len * 0.24;
	const q = new THREE.Vector3();
	const cost = (/** @type {THREE.Vector3} */ d) => {
		let c = 0;
		for (const f of [0.45, 0.95]) {
			q.copy(p).addScaledVector(d, len * f);
			for (const b of balls) {
				const x = r + b.r - Math.abs(q.x - b.c.x);
				if (x <= 0) continue;
				const into = r + b.r - q.distanceTo(b.c);
				if (into > 0) c += into;
			}
		}
		return c;
	};
	let best = dir, low = cost(dir);
	if (low === 0) return dir;
	for (const t of [0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, 3.1]) {
		const d = dir.clone().applyAxisAngle(UP, t);
		const c = cost(d);
		if (c < low) {
			low = c;
			best = d;
		}
		if (c === 0) break;
	}
	return best;
}

/* ------------------------------------------------------------------------------------------------ leaves */

/** @typedef {(u: number, v: number) => THREE.Color} LeafPaint */
/** a leaf's blade, built along +X from where its stalk meets it, its face up, set by `m` @typedef {(bag: Bag, m: THREE.Matrix4, len: number, paint: LeafPaint) => void} Blade */

/**
 * A palmately lobed blade (a currant's, a gooseberry's): a fan from the stalk, its edge reaching out to each of five
 * lobes' tips and back into the notches between, the two basal lobes reaching back beside the stalk. Its rays fall on
 * the tips and the notches, so ten of them draw it.
 * @param {number} side the side lobes' reach against the middle one's @param {number} basal the basal lobes'
 * @param {number} deep how far the notches cut in
 * @returns {Blade}
 */
const lobed = (side, basal, deep) => (bag, m, len, paint) => {
	const step = 0.95;
	const reach = [basal, side, 1, side, basal];
	const edge = (/** @type {number} */ a) => {
		const i = Math.max(-2, Math.min(2, Math.round(a / step)));
		return reach[i + 2] * (1 - deep * Math.min(1, Math.abs(a - i * step) / (step / 2)));
	};
	bag.add('sheet', fan({ size: len, from: -2.5 * step, to: 2.5 * step, edge, lift: (s, a) => -0.12 * s * s + 0.06 * s * Math.cos(a * 2.2), paint: (s, a) => paint(s, a / 2.4), rings: 1, rays: 10 }), m);
};

/**
 * A simple blade (an aronia's, a haskap's, a kiwi's): `shape(u)` its half-width along it, as a part of `width`.
 * @param {(u: number) => number} shape @param {number} width its width against its length @param {number} [cup] how far its sides rise
 * @returns {Blade}
 */
const simple = (shape, width, cup = 0.06) => (bag, m, len, paint) => {
	bag.add('sheet', sheet({ length: len, width: len * width, shape, lift: (u, v) => cup * v * v - 0.07 * u * u, paint, along: 5, across: 2 }), m);
};

/**
 * A compound blade of leaflets: pinnate (a rachis with pairs along it and one at its end — the rose's) or digitate
 * (all from the stalk's tip — the blackberry's).
 * @param {{ pairs: number, digitate?: boolean, leaflet: number, width: number, shape: (u: number) => number, rachis: string, wrinkle?: number, across?: number }} o
 * @returns {Blade}
 */
const compound = (o) => (bag, m, len, paint) => {
	const leaflet = (/** @type {THREE.Matrix4} */ at, /** @type {number} */ size) => {
		const l = len * o.leaflet * size;
		const w = o.wrinkle ?? 0;
		bag.add('sheet', sheet({ length: l, width: l * o.width, shape: o.shape, lift: (u, v) => 0.08 * v * v - 0.06 * u * u + w * Math.sin(u * 19 + v * 5) * 0.012, paint, along: 3, across: o.across ?? 2 }), m.clone().multiply(at));
	};
	const turn = (/** @type {number} */ x, /** @type {number} */ a) => new THREE.Matrix4().makeTranslation(x, 0, 0).multiply(new THREE.Matrix4().makeRotationY(a));
	if (o.digitate) {
		const fanned = o.pairs === 1 ? [[0, 1], [0.8, 0.8], [-0.8, 0.8]] : [[0, 1], [0.75, 0.88], [-0.75, 0.88], [1.5, 0.62], [-1.5, 0.62]];
		for (const [a, size] of fanned) leaflet(turn(0, a), size);
		return;
	}
	bag.add('body', tube([v3(0, 0, 0), v3(len * 0.62, 0, 0)], () => 0.0008, () => o.rachis, 3), m.clone());
	for (let k = 0; k < o.pairs; k++) {
		const x = len * lerp(0.12, 0.55, o.pairs === 1 ? 0.5 : k / (o.pairs - 1));
		for (const side of [-1, 1]) leaflet(turn(x, side * 1.05), lerp(0.75, 0.95, k / Math.max(1, o.pairs - 1)));
	}
	leaflet(turn(len * 0.6, 0), 1);
};

/**
 * @typedef {{
 *   blade: Blade, length: number, stalk: number, stalkColour: string, spacing: number, opposite?: boolean, from: number,
 *   bare: number, colour: string, young: string, vein: string, droop: number, shade?: string, tuft?: number, spur?: number,
 *   autumn?: { colour: string, from: number, share: number }
 * }} Leafing — the leaves of a shrub: their blade, their size, how far apart along the wood, opposite or one by one,
 *   from which order of wood (0 the stems), how much of each stem's base is bare, their greens, and on the older wood
 *   (the stems and their first branches) `tuft` leaves in a rosette on each spur, the spurs `spur` apart; `autumn`
 *   the share of them that colour, and from when
 */

/**
 * The leaves along a shrub's wood, at fixed distances from each twig's base so that a leaf once out stays where it
 * is as the twig lengthens; the youngest, near the tip, smaller and standing up.
 * @param {Ctx} ctx @param {Leafing} L
 * @param {{ pts: THREE.Vector3[], length: number, order: number, key: (string | number)[], fade?: number }[]} twigs `fade` 0 … 1 its leaves falling
 */
function leafOut(ctx, L, twigs) {
	const { bag, seed, g, vigour } = ctx;
	const balls = bag.space.balls;
	const fall = L.autumn ? span(g, L.autumn.from, L.autumn.from + 0.8) * L.autumn.share : 0;
	for (const t of twigs) {
		const fade = t.fade ?? 0;
		if (t.order < L.from || fade >= 1) continue;
		const lr = chance(seed, 'leafing', ...t.key);
		const bare = t.order === 0 ? Math.min(L.bare, t.length * 0.3) : 0;
		const old = t.order <= 1 && !!L.tuft;
		const spacing = old ? (L.spur ?? L.spacing * 1.6) : L.spacing;
		const n = Math.floor(t.length / spacing);
		for (let k = 0; k < n; k++) {
			const s = (k + 0.4) * spacing;
			const r1 = lr(), r2 = lr(), r3 = lr();
			if (s < bare) continue;
			const w = walk(t.pts, s);
			if (!w) break;
			const young = clamp((t.length - s) / 0.14);
			const size = lerp(0.5, 1, young) * vigour * (0.85 + r2 * 0.3) * (1 - fade * 0.6);
			const len = L.length * size;
			const autumn = L.autumn && r3 < fall ? clamp((fall - r3) * 6) : 0;
			const green = mix(L.young, L.colour, young * 0.9 + 0.1).lerp(new THREE.Color(L.shade ?? L.colour), r2 * 0.5);
			if (autumn) green.lerp(new THREE.Color(/** @type {{ colour: string }} */ (L.autumn).colour), autumn);
			const vein = green.clone().lerp(new THREE.Color(L.vein), 0.35), dark = green.clone().multiplyScalar(0.94), light = green.clone().multiplyScalar(1.06);
			/** @type {LeafPaint} */
			const paint = (u, v) => (Math.abs(v) < 0.07 ? vein : u > 0.5 ? light : dark);
			const sides = L.opposite ? [0, Math.PI] : [0];
			const tuft = old ? (L.tuft ?? 1) : 1;
			for (const side of sides)
				for (let f = 0; f < tuft; f++) {
					const a = (L.opposite ? (k * Math.PI) / 2 : k * 2.39996) + side + r1 * 0.4 + f * 1.25;
					const out = round(w.d, a);
					const h = level(out.clone().addScaledVector(w.d, 0.35), level(w.d));
					const lift = lerp(0.9, -L.droop, young) + (r2 - 0.5) * 0.35 - f * 0.15;
					const stalkDir = h.clone().multiplyScalar(Math.cos(0.55)).add(v3(0, Math.sin(0.55), 0));
					const end = w.p.clone().addScaledVector(stalkDir, L.stalk * size);
					let dir = h.clone().multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0)).normalize();
					dir = clear(balls, end, dir, len);
					if (L.stalk * size > 0.012) bag.add('body', tube([w.p, end], () => 0.0009, () => L.stalkColour, 3));
					L.blade(bag, aim(end, dir, (r3 - 0.5) * 0.5), len * (f ? 0.85 : 1), paint);
				}
		}
	}
}

/* ------------------------------------------------------------------------------------------------ flowers and fruit */

/** @typedef {{ bag: Bag, seed: string, g: number, vigour: number, twigs: Limb[] }} Ctx */

/**
 * A small flower, cheaply: a fan of `petals` rounded petals, cupped while it opens, and its heart. The currants'
 * little bells, the aronia's and the kiwi's white saucers, the blackberry's.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {number} size its radius
 * @param {string} colour @param {string} heart @param {number} open 0 … 1 @param {number} [petals] @param {number} [cup]
 */
function floret(bag, at, facing, size, colour, heart, open, petals = 5, cup = 0.25) {
	const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(UP, facing.clone().normalize()), v3(1, 1, 1));
	const edge = (/** @type {number} */ a) => 0.4 + 0.6 * Math.pow(Math.abs(Math.cos((a * petals) / 2)), 0.6);
	bag.add('sheet', fan({ size: size * lerp(0.4, 1, open), from: -Math.PI, to: Math.PI, edge, lift: (s) => cup * s * s * (1.6 - open), paint: (s) => mix(heart, colour, 0.35 + s), rings: 1, rays: petals * 2 }), m);
	bag.add('body', bead(at.clone().addScaledVector(facing, size * 0.12), v3(1, 0.7, 1).multiplyScalar(size * 0.28), heart, 2));
}

/** when a flowering site opens, sets and ripens, drawn from its chance @typedef {{ opens: number, ripeFrom: number, ripeFor: number, setFor: number }} Season */

/**
 * @typedef {{
 *   count: [number, number], r: number, drop: number, stalk: string, bud: string, flower: string, heart: string,
 *   bloom: number, colour: (ripe: number) => THREE.Color, season: Season, step: number, calyx: string
 * }} Strig — a currant's hanging raceme: how many flowers, the berry's radius, how many at its tip never set
 *   (`drop`), its colours, and `step` how much later each berry down it ripens than the one above
 */

/**
 * A strig: a thin stalk hanging from a spur, the flowers along it on short stalks, each a berry later — the top ones
 * first to colour. It hangs where it touches nothing (`Space.settle`).
 * @param {Ctx} ctx @param {{ at: THREE.Vector3, dir: THREE.Vector3, key: (string | number)[] }} site @param {Strig} S
 */
function strig(ctx, site, S) {
	const { bag, seed, g, vigour } = ctx;
	const fr = chance(seed, 'strig', ...site.key);
	const opens = S.season.opens + fr() * 0.3;
	const n = S.count[0] + Math.floor(fr() * (S.count[1] - S.count[0] + 1));
	const keep = n - Math.floor(fr() * (S.drop + 1));
	const twist = fr() * 6;
	const R = S.r * vigour * about(fr, 1, 0.08);
	if (g < opens - 0.7) return;
	const emerge = span(g, opens - 0.7, opens);
	const len = n * R * 1.1 + 0.012;
	const out = level(site.dir);
	const from = site.at.clone().addScaledVector(out, 0.008);
	const place = bag.space.settle(from, v3(0, -1, 0).addScaledVector(out, 0.4), (a, d) => [0.25, 0.55, 0.85].map((t) => ({ c: a.clone().addScaledVector(d, len * t), r: R * 2 })), 0.02);
	const d = place.dir;
	const L = len * lerp(0.3, 1, emerge);
	const top = place.at;
	bag.add('body', tube([site.at, top, top.clone().addScaledVector(d, L)], (u) => 0.001 * (1 - 0.5 * u), () => S.stalk, 3));
	const set = span(g, opens + 0.4, opens + 0.4 + S.season.setFor);
	for (let k = 0; k < n; k++) {
		const kr = chance(seed, 'strig-berry', ...site.key, k);
		const r1 = kr(), r2 = kr();
		const axis = top.clone().addScaledVector(d, L * clamp((0.012 + (k + 0.5) * R * 1.1) / len));
		const side = round(d, k * 2.39996 + twist);
		if (g < opens) {
			bag.add('body', bead(axis.addScaledVector(side, R * 0.5), v3(1, 1, 1).multiplyScalar(R * 0.35 * lerp(0.4, 1, emerge)), S.bud, 2));
			continue;
		}
		if (set < 0.02) {
			const open = clamp((g - opens) / 0.2) * (1 - span(g, opens + 0.3, opens + 0.42) * 0.5);
			const at = axis.clone().addScaledVector(side, R * 0.8);
			bag.add('body', tube([axis, at], () => 0.0004, () => S.stalk, 3));
			floret(bag, at, side.clone().add(v3(0, -0.6, 0)).normalize(), S.bloom, S.flower, S.heart, open, 5, 0.6);
			continue;
		}
		if (k >= keep) continue;
		const r = R * lerp(0.22, 1, set) * (0.92 + r1 * 0.16);
		const c = axis.clone().addScaledVector(side, R * 1.05).addScaledVector(d, r * 0.3);
		const ripe = span(g, S.season.ripeFrom + k * S.step + r2 * 0.15, S.season.ripeFrom + S.season.ripeFor + k * S.step + r2 * 0.15);
		bag.add('body', tube([axis, c], () => 0.0005, () => S.stalk, 3));
		bag.add('gloss', bead(c, v3(r, r * 1.04, r), S.colour(ripe), 3));
		bag.add('body', bead(c.clone().addScaledVector(side, r * 0.95), v3(1, 1, 1).multiplyScalar(r * 0.18), S.calyx, 2));
	}
}

/**
 * A berry, hanging or held, that is not round: an oval or a cylinder, swept along its axis, its stripes or its bloom
 * painted on; its calyx scar at the far end.
 * @param {Bag} bag @param {THREE.Vector3} at where its stalk meets it @param {THREE.Vector3} dir which way it hangs
 * @param {number} L its length @param {number} W its radius @param {(u: number) => number} shape its radius along it (0 … 1)
 * @param {(u: number, v: number) => THREE.Color} paint @param {string} tip its scar's colour @param {number} [sides]
 */
function oblong(bag, at, dir, L, W, shape, paint, tip, sides = 8) {
	const pts = [];
	for (let k = 0; k <= 6; k++) pts.push(at.clone().addScaledVector(dir, (k / 6) * L));
	bag.add('gloss', tube(pts, (u) => W * shape(u), paint, sides));
	bag.add('body', bead(at.clone().addScaledVector(dir, L * 0.98), v3(1, 1, 1).multiplyScalar(Math.max(0.0008, W * 0.2)), tip, 2));
}

/** a round berry's profile along its axis, closed at both ends */
const ovalShape = (/** @type {number} */ u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.62);

/**
 * @typedef {{
 *   L: number, W: number, stalk: number, stalkColour: string, season: Season,
 *   draw: (bag: Bag, at: THREE.Vector3, dir: THREE.Vector3, L: number, W: number, ripe: number) => void,
 *   bud: (bag: Bag, at: THREE.Vector3, down: THREE.Vector3, open: number, fall: number) => void
 * }} Hanging — a berry that hangs alone: its length and radius grown, its stalk, its season, how it is drawn and how
 *   its flower is
 */

/**
 * One berry (or a few) hanging under a node, on its own stalk, where it touches nothing.
 * @param {Ctx} ctx @param {THREE.Vector3} at @param {THREE.Vector3} out @param {(string | number)[]} key
 * @param {Hanging} o
 */
function hanging(ctx, at, out, key, o) {
	const { bag, seed, g, vigour } = ctx;
	const fr = chance(seed, 'hanging', ...key);
	const opens = o.season.opens + fr() * 0.35;
	const size = vigour * about(fr, 1, 0.1);
	const ripeAt = o.season.ripeFrom + fr() * 0.35;
	if (g < opens - 0.5) return;
	const set = span(g, opens + 0.45, opens + 0.45 + o.season.setFor);
	const L = o.L * size, W = o.W * size;
	const start = at.clone().addScaledVector(out, 0.004);
	const place = bag.space.settle(start.clone().add(v3(0, -o.stalk * 0.5, 0)).addScaledVector(out, o.stalk * 0.3), v3(0, -1, 0).addScaledVector(out, 0.3), (a, d) => [0.3, 0.72].map((t) => ({ c: a.clone().addScaledVector(d, L * t), r: W * 1.05 })), o.stalk * 0.6);
	bag.add('body', tube([at, start, place.at], () => 0.0006, () => o.stalkColour, 3));
	if (set < 0.02) {
		o.bud(bag, place.at, place.dir, clamp((g - opens) / 0.2), span(g, opens + 0.3, opens + 0.45));
		return;
	}
	o.draw(bag, place.at, place.dir, L * lerp(0.25, 1, set), W * lerp(0.22, 1, set), span(g, ripeAt, ripeAt + o.season.ripeFor));
}

/* ------------------------------------------------------------------------------------------------ the shrub */

/**
 * @typedef {{
 *   seed: { size: THREE.Vector3, coat: string, shade: string }, cotyledon: { length: number, width: number, colour: string },
 *   stems: {
 *     count: number, first: number, every: number, rate: number, length: [number, number], lean: [number, number],
 *     crown: number, radius: number, up: number, wander: number, spread: number, children: number,
 *     shorten: [number, number], depth: number, from0: number, young: string, old: string, size: [number, number][]
 *   },
 *   roots: { length: number, count: number },
 *   leaf: Leafing,
 *   wood?: (ctx: Ctx, t: Limb) => void,
 *   fruit: (ctx: Ctx) => void
 * }} Shrub — a bush, described: its seed and seed leaves; its stems (how many, from when and how often a new one
 *   comes up from the crown, how fast they grow, how long and how far they lean, how wide the crown they rise from,
 *   how they branch, their bark young and old, and `size` the whole bush's size through the stages); its roots; its
 *   leaves; what its wood bears (spines, prickles) and its flowers and fruit
 */

/**
 * @param {Shrub} spec
 * @returns {(g: number, seed: string) => THREE.Group}
 */
function shrub(spec) {
	return (g, seed) => {
		const bag = new Bag();
		const vigour = about(chance(seed, 'plant'), 1, 0.08);
		const at = v3(0, -0.004, 0);
		const s = sprout(bag, {
			seed, at, size: spec.seed.size, coat: spec.seed.coat, coatShade: spec.seed.shade,
			stem: table(g, [[0, 0], [0.35, 0.0006], [1, 0.006], [2, 0.014], [9, 0.014]]), hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
			radius: 0.0006 + 0.0025 * span(g, 1.5, 4), stemColor: '#8a8a4a',
			leaf: { length: spec.cotyledon.length, width: spec.cotyledon.width, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.65), color: spec.cotyledon.colour, vein: '#a6c47e' },
			open: span(g, 1.15, 2), shed: span(g, 1, 1.6), wither: span(g, 2.9, 3.6)
		});
		shrubRoots(bag, seed, g, at, spec.roots, vigour);

		// the stems: the seedling's own shoot, then one after another from the crown as it widens
		const S = spec.stems;
		const size = table(g, S.size);
		/** @type {Limb[]} */
		const twigs = [];
		for (let c = 0; c < S.count; c++) {
			const cr = chance(seed, 'stem', c);
			const born = c === 0 ? S.first : S.first + 0.5 + (c - 1) * S.every + cr() * 0.25;
			const bear = c * 2.39996 + cr() * 0.6;
			const off = S.crown * Math.sqrt(c / S.count) * between(cr, 0.6, 1);
			const lean = c === 0 ? between(cr, 0.03, 0.12) : between(cr, S.lean[0], S.lean[1]);
			const length = between(cr, S.length[0], S.length[1]);
			if (g <= born) continue;
			const from = c === 0 ? s.top.clone() : v3(Math.cos(bear) * off, 0, Math.sin(bear) * off);
			limb(bag, {
				seed, key: ['stem', c], from, dir: v3(Math.cos(bear) * Math.sin(lean), Math.cos(lean), Math.sin(bear) * Math.sin(lean)),
				length: length * vigour * size, grown: Math.min(2.6, (g - born) * S.rate), radius: S.radius * lerp(0.3, 1, size),
				up: S.up, wander: S.wander, spread: S.spread, children: S.children, shorten: S.shorten, depth: S.depth, from0: S.from0,
				young: S.young, old: S.old, age: clamp((g - born) / 3), out: twigs, sides: 5
			});
		}
		const ctx = { bag, seed, g, vigour, twigs };
		for (const t of twigs) if (t.order <= 1) bag.space.rod(t.pts, t.order ? 0.007 : 0.013);
		if (spec.wood) for (const t of twigs) spec.wood(ctx, t);
		spec.fruit(ctx);
		leafOut(ctx, spec.leaf, twigs);
		return bag.build();
	};
}

/**
 * A shrub's roots: a short taproot, and fibrous roots spreading near the surface.
 * @param {Bag} bag @param {string} seed @param {number} g @param {THREE.Vector3} at @param {{ length: number, count: number }} o @param {number} vigour
 */
function shrubRoots(bag, seed, g, at, o, vigour) {
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0.03, -1, 0), length: o.length * 0.7, grown: table(g, [[0, 0], [0.35, 0.005], [1, 0.04], [2, 0.1], [3, 0.35], [4, 0.7], [5, 1]]), radius: 0.0015 + 0.006 * span(g, 2.5, 6), down: 0.04, wander: 0.18, laterals: 5, lateral: 0.3, depth: 1, age: span(g, 2, 5), young: '#f1e4cc', old: '#7a5a3e' });
	for (let i = 0; i < o.count; i++) {
		const rr = chance(seed, 'shrub-root', i);
		const a = i * 2.39996 + rr() * 0.4;
		const born = 2.4 + i * 0.22;
		root(bag, { seed, key: ['spread', i], from: at.clone().add(v3(0, -0.015 - rr() * 0.03, 0)), dir: v3(Math.cos(a), -between(rr, 0.12, 0.4), Math.sin(a)), length: between(rr, 0.6, 1) * o.length * vigour, grown: (g - born) / 2.4, radius: 0.0016 + 0.004 * span(g, 3, 7), down: 0.012, wander: 0.22, laterals: 3, lateral: 0.3, depth: 1, age: (g - born - 0.5) / 2.5, young: '#f1e4cc', old: '#7a5a3e' });
	}
}

/** a thin sharp spine or prickle out of the bark: a cone along `dir`, bent at its tip by `hook` */
function prickle(/** @type {Bag} */ bag, /** @type {THREE.Vector3} */ at, /** @type {THREE.Vector3} */ dir, /** @type {number} */ len, /** @type {number} */ base, /** @type {string} */ colour, hook = 0) {
	const mid = at.clone().addScaledVector(dir, len * 0.55);
	const tip = mid.clone().addScaledVector(dir, len * 0.45).add(v3(0, -hook * len, 0));
	bag.add('body', tube([at, mid, tip], (u) => base * (1 - 0.95 * u), () => colour, 3));
}

/* ------------------------------------------------------------------------------------------------ the currants */

export const REDCURRANT_STAGES = stages([
	['Seed', 0, 'A small pale seed from a berry, sown in autumn: it needs a winter’s cold before it wakes.'],
	['Germination', 30, 'In spring a root goes down, a hooked shoot comes up.'],
	['Seed leaves', 45, 'Two small oval seed leaves, then the first lobed one.'],
	['Young bush', 365, 'A whip of a stem and its side shoots, lobed leaves all along.'],
	['Bush', 1100, 'An open bush of upright stems from the crown, a metre and more, grey-brown bark, spurs on the older wood.'],
	['Flowering', 1210, 'From the spurs hang strigs of small greenish-yellow cups, a dozen and more to a strig.'],
	['Fruit set', 1225, 'The flowers fade; little green berries along each strig, the last few at its tip falling.'],
	['Green berries', 1260, 'Strigs of hard green berries, swelling.'],
	['Turning', 1285, 'The berries clear and blush, the top of each strig first.'],
	['Ripe', 1300, 'Strigs of translucent red currants hanging under the leaves, the seeds showing through.']
]);

/** @type {Leafing} */
const CURRANT_LEAF = { blade: lobed(0.88, 0.6, 0.32), length: 0.06, stalk: 0.04, stalkColour: '#8a9a52', spacing: 0.045, tuft: 3, spur: 0.07, from: 0, bare: 0.2, colour: '#4c8a36', young: '#8abc58', vein: '#a8c47e', shade: '#3e7430', droop: 0.15 };

export const redcurrant = shrub({
	seed: { size: v3(0.0014, 0.0009, 0.001), coat: '#d8c8a0', shade: '#a8946a' },
	cotyledon: { length: 0.005, width: 0.0028, colour: '#6aa046' },
	stems: { count: 10, first: 2, every: 0.19, rate: 1.3, length: [0.6, 0.76], lean: [0.12, 0.45], crown: 0.14, radius: 0.014, up: 0.012, wander: 0.08, spread: 0.8, children: 4, shorten: [0.45, 0.7], depth: 2, from0: 0.25, young: '#b09272', old: '#6e6258', size: [[2, 0.2], [3, 0.4], [4, 0.8], [5, 1]] },
	roots: { length: 0.45, count: 7 },
	leaf: CURRANT_LEAF,
	fruit: (ctx) => {
		// spurs on the two- and three-year-old wood: along the stems and their branches, never the stems' bare base nor the
		// youngest wood at the tips
		for (const t of ctx.twigs) {
			const sr = chance(ctx.seed, 'spur', ...t.key);
			const n = Math.floor(t.length * [2.6, 2.4, 1.2][t.order] + sr());
			for (let k = 0; k < n; k++) {
				const s = between(sr, t.order ? 0.1 : 0.35, t.order === 2 ? 0.5 : 0.92) * t.length;
				const a = sr() * Math.PI * 2;
				const per = 1 + Math.floor(sr() * 1.6);
				const w = walk(t.pts, s);
				if (!w) continue;
				for (let m = 0; m < per; m++) {
					const side = round(w.d, a + m * 1.3);
					strig(ctx, { at: w.p.clone().addScaledVector(side, 0.008), dir: side, key: [...t.key, k, m] }, RED_STRIG);
				}
			}
		}
	}
});

/** @type {Strig} */
const RED_STRIG = {
	count: [9, 15], r: 0.0045, drop: 3, stalk: '#7a8a46', bud: '#b8b878', flower: '#c8c27a', heart: '#a87a58', bloom: 0.0035,
	colour: (t) => ramp([[0, '#9cbc5e'], [0.35, '#dcd8a0'], [0.62, '#ec7e70'], [1, '#c81428']], t),
	season: { opens: 4.7, setFor: 2.1, ripeFrom: 7.55, ripeFor: 0.8 }, step: 0.035, calyx: '#5a3a2a'
};

export const BLACKCURRANT_STAGES = stages([
	['Seed', 0, 'A small dark seed from a berry, sown in autumn to be chilled through the winter.'],
	['Germination', 30, 'In spring a root goes down, a hooked shoot comes up.'],
	['Seed leaves', 45, 'Two small seed leaves; the first true leaf already smells of blackcurrant.'],
	['Young bush', 365, 'A young bush, several shoots from low down, big lobed leaves.'],
	['Bush', 1100, 'A bushy stool of many stems straight from the ground, renewed from below year by year, the leaves aromatic.'],
	['Flowering', 1210, 'Short strigs of pinkish-purple bells hang from last year’s shoots.'],
	['Fruit set', 1225, 'Little green berries, five to ten to a strig.'],
	['Green berries', 1260, 'Glossy green berries swelling on the young wood.'],
	['Turning', 1285, 'Green to bronze and purple, the top berries first.'],
	['Ripe', 1300, 'Strigs of big glossy black currants, sharp and rich, along last year’s shoots.']
]);

/** @type {Strig} */
const BLACK_STRIG = {
	count: [5, 9], r: 0.0062, drop: 2, stalk: '#6a7a40', bud: '#a88a8a', flower: '#b88a96', heart: '#7a6a3a', bloom: 0.004,
	colour: (t) => ramp([[0, '#8fb05a'], [0.4, '#8a7a50'], [0.7, '#4a2236'], [1, '#17111c']], t),
	season: { opens: 4.65, setFor: 2.1, ripeFrom: 7.6, ripeFor: 0.85 }, step: 0.05, calyx: '#3a2a22'
};

export const blackcurrant = shrub({
	seed: { size: v3(0.0014, 0.0009, 0.001), coat: '#4a3424', shade: '#2a1c14' },
	cotyledon: { length: 0.005, width: 0.003, colour: '#5f9a42' },
	stems: { count: 13, first: 2, every: 0.19, rate: 1.3, length: [0.66, 0.84], lean: [0.15, 0.62], crown: 0.2, radius: 0.013, up: 0.01, wander: 0.09, spread: 0.85, children: 4, shorten: [0.45, 0.7], depth: 2, from0: 0.22, young: '#a07a5a', old: '#5e4e44', size: [[2, 0.2], [3, 0.42], [4, 0.82], [5, 1]] },
	roots: { length: 0.5, count: 8 },
	leaf: { ...CURRANT_LEAF, blade: lobed(0.86, 0.55, 0.26), length: 0.072, stalk: 0.045, spacing: 0.05, colour: '#3e7a30', shade: '#2f6428', young: '#7aae4e', bare: 0.25 },
	fruit: (ctx) => {
		// at the nodes of last year's shoots: the youngest wood
		for (const t of ctx.twigs) {
			if (t.order < 1) continue;
			const sr = chance(ctx.seed, 'node', ...t.key);
			const n = Math.floor(t.length / 0.06);
			for (let k = 1; k < n; k++) {
				const a = sr() * Math.PI * 2, keep = sr();
				if (keep > (t.order === 2 ? 0.24 : 0.1)) continue;
				const w = walk(t.pts, k * 0.06);
				if (!w) break;
				const side = round(w.d, a);
				strig(ctx, { at: w.p.clone().addScaledVector(side, 0.005), dir: side, key: [...t.key, k] }, BLACK_STRIG);
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ gooseberry */

export const GOOSEBERRY_STAGES = stages([
	['Seed', 0, 'A small seed from a berry, sown in autumn for the winter to chill.'],
	['Germination', 30, 'A root down, a hooked shoot up.'],
	['Seed leaves', 45, 'Two small oval seed leaves; the first spines already at the first nodes.'],
	['Young bush', 365, 'A few spiny shoots, small lobed leaves in tufts.'],
	['Bush', 1100, 'A low bush of arching spiny branches a metre high, sharp spines at every node.'],
	['Flowering', 1200, 'Small green, purple-flushed bells hang in ones and twos under the branches.'],
	['Fruit set', 1215, 'Each bell leaves a little hairy berry behind it, its withered flower at its tip.'],
	['Green berries', 1250, 'Big green veined berries hanging under the branches, hard and sour.'],
	['Turning', 1280, 'The berries soften and blush, the veins showing pale.'],
	['Ripe', 1295, 'Plump dark red gooseberries, hairy and veined, sweet now.']
]);

/** a gooseberry: an oval, faintly hairy, its pale veins running from end to end */
const gooseberryPaint = (/** @type {number} */ ripe) => (/** @type {number} */ u, /** @type {number} */ v) => {
	const c = ramp([[0, '#9cc068'], [0.45, '#b8b060'], [0.75, '#a84a48'], [1, '#7a1e30']], ripe);
	const vein = Math.pow(Math.abs(Math.cos(v * Math.PI * 7)), 22);
	return c.lerp(new THREE.Color(ripe > 0.6 ? '#d89a8a' : '#d8e8b0'), vein * 0.45);
};

export const gooseberry = shrub({
	seed: { size: v3(0.0016, 0.001, 0.0011), coat: '#b8a07a', shade: '#8a7450' },
	cotyledon: { length: 0.005, width: 0.003, colour: '#6aa046' },
	stems: { count: 9, first: 2, every: 0.19, rate: 1.3, length: [0.52, 0.68], lean: [0.35, 0.75], crown: 0.12, radius: 0.011, up: -0.035, wander: 0.1, spread: 0.85, children: 4, shorten: [0.45, 0.68], depth: 2, from0: 0.22, young: '#a8946a', old: '#6a5a48', size: [[2, 0.2], [3, 0.4], [4, 0.8], [5, 1]] },
	roots: { length: 0.4, count: 7 },
	leaf: { ...CURRANT_LEAF, blade: lobed(0.85, 0.55, 0.36), length: 0.045, stalk: 0.02, spacing: 0.03, tuft: 4, spur: 0.04, colour: '#4a8a3a', shade: '#3a7432', young: '#8ac05a', bare: 0.2 },
	wood: (ctx, t) => {
		// a spine (one to three together) at every node of the wood
		const pr = chance(ctx.seed, 'spines', ...t.key);
		const n = Math.floor(t.length / 0.045);
		for (let k = 0; k < n; k++) {
			const w = walk(t.pts, (k + 0.4) * 0.045);
			const a = pr(), many = pr();
			if (!w) break;
			const thick = t.order === 0 ? 0.006 : t.order === 1 ? 0.004 : 0.0025;
			if (t.order === 2 && k % 2) continue;
			for (let m = 0; m < 1 + Math.floor(many * 2.2); m++) {
				const out = round(w.d, a * 6.28 + (m - 1) * 0.9).addScaledVector(w.d, -0.35).normalize();
				prickle(ctx.bag, w.p.clone().addScaledVector(out, thick * 0.6), out, 0.008 + many * 0.004, 0.0009, '#c8b890');
			}
		}
	},
	fruit: (ctx) => {
		// one or two berries under the nodes of the younger wood and the spurs on the older, hanging below the branch
		for (const t of ctx.twigs) {
			if (t.order < 1) continue;
			const fr = chance(ctx.seed, 'goose-node', ...t.key);
			const n = Math.floor(t.length / 0.045);
			for (let k = 1; k < n; k++) {
				const pick = fr(), two = fr(), a = fr();
				if (pick > 0.16) continue;
				const w = walk(t.pts, (k + 0.4) * 0.045);
				if (!w) break;
				for (let m = 0; m < (two < 0.35 ? 2 : 1); m++) hanging(ctx, w.p, level(round(w.d, a * 6.28 + m * 2.2), level(w.d)), [...t.key, k, m], GOOSE);
			}
		}
	}
});


/**
 * A small hanging bell (a gooseberry's, a haskap's): a cone from where its stalk meets it, widening to its mouth,
 * opening, then shrivelling as it falls.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} down @param {number} len @param {number} mouth
 * @param {string} colour @param {string} lip @param {number} open @param {number} fall
 */
function bell(bag, at, down, len, mouth, colour, lip, open, fall) {
	const l = len * lerp(0.5, 1, open) * (1 - fall * 0.4);
	const pts = [0, 0.4, 0.8, 1].map((t) => at.clone().addScaledVector(down, l * t));
	bag.add('body', tube(pts, (u) => mouth * lerp(0.3, 1, Math.pow(u, 0.8)) * lerp(0.5, 1, open) * (1 - fall * 0.5), (u) => mix(colour, lip, u * u), 6));
}

/** @type {Hanging} */
const GOOSE = {
	L: 0.024, W: 0.0098, stalk: 0.014, stalkColour: '#8a8a52',
	season: { opens: 4.6, setFor: 2.2, ripeFrom: 7.6, ripeFor: 1.1 },
	bud: (bag, at, down, open, fall) => bell(bag, at, down, 0.009, 0.003, '#a8b066', '#8a4a5e', open, fall),
	draw: (bag, at, dir, L, W, ripe) => {
		oblong(bag, at, dir, L, W, ovalShape, gooseberryPaint(ripe), '#5a3a2a', 10);
		// its fine hairs, a few standing off the skin
		const side = round(dir, 0);
		for (let k = 0; k < 6; k++) {
			const out = side.clone().applyAxisAngle(dir, k * 1.05);
			const p = at.clone().addScaledVector(dir, L * (0.3 + (k % 3) * 0.2)).addScaledVector(out, W * 0.95);
			bag.add('body', tube([p, p.clone().addScaledVector(out, W * 0.25)], () => 0.00012, () => '#c8b898', 3));
		}
	}
};

/* ------------------------------------------------------------------------------------------------ aronia */

export const ARONIA_STAGES = stages([
	['Seed', 0, 'A tiny brown seed from a black berry, sown in autumn to be chilled through the winter.'],
	['Germination', 35, 'In spring a root goes down, a hooked shoot comes up.'],
	['Seed leaves', 50, 'Two small oval seed leaves, then glossy pointed ones.'],
	['Young bush', 365, 'A few upright shoots, glossy oval leaves.'],
	['Bush', 1100, 'An upright, suckering bush near two metres: many stems from the ground, glossy dark leaves.'],
	['Flowering', 1230, 'Flat corymbs of small white flowers with pink anthers at the tips of the shoots.'],
	['Fruit set', 1245, 'Little green berries, a dozen and more to a cluster.'],
	['Green berries', 1280, 'Clusters of green berries, the shoots bowing under them.'],
	['Turning', 1320, 'Red, then purple, then black, cluster by cluster.'],
	['Ripe', 1345, 'Heavy clusters of glossy black chokeberries, astringent and dark; the first leaves turning red.']
]);

/**
 * @typedef {{
 *   count: [number, number], r: number, drop: number, stalk: string, bud: string, flower: string, heart: string,
 *   bloom: number, colour: (ripe: number) => THREE.Color, season: Season
 * }} Corymb — a flat-topped cluster at a shoot's tip: how many flowers, the berry's radius, how many never set
 */

/**
 * A corymb: a short stalk at a shoot's tip, the flowers on longer stalks round it holding them level in a flat head;
 * then the berries, the cluster bowing over and hanging as they swell, where it touches nothing.
 * @param {Ctx} ctx @param {{ at: THREE.Vector3, dir: THREE.Vector3, key: (string | number)[] }} site @param {Corymb} C
 */
function corymb(ctx, site, C) {
	const { bag, seed, g, vigour } = ctx;
	const fr = chance(seed, 'corymb', ...site.key);
	const opens = C.season.opens + fr() * 0.3;
	const n = C.count[0] + Math.floor(fr() * (C.count[1] - C.count[0] + 1));
	const lost = fr();
	const twist = fr() * 6;
	const R = C.r * vigour * about(fr, 1, 0.08);
	const ripeAt = C.season.ripeFrom + fr() * 0.3;
	if (g < opens - 0.6) return;
	const emerge = span(g, opens - 0.6, opens);
	const set = span(g, opens + 0.4, opens + 0.4 + C.season.setFor);
	const up = site.dir.clone().lerp(UP, 0.6).normalize();
	const c = R * 1.25;
	const Rc = c * Math.sqrt(n) + R;
	const out = level(site.dir);
	const start = site.at.clone().addScaledVector(up, 0.012);
	const place = bag.space.settle(start, v3(0, -1, 0).addScaledVector(out, 0.9), (a, d) => [{ c: a.clone().addScaledVector(d, Rc * 1.1), r: Rc }], 0.02);
	const sag = span(set, 0.15, 0.9);
	const axis = up.clone().lerp(place.dir, sag).normalize();
	const base = start.clone().lerp(place.at, sag);
	bag.add('body', tube([site.at, start, base], () => 0.0013, () => C.stalk, 3));
	const centre = base.clone().addScaledVector(axis, Rc * lerp(0.5, 1.05, emerge));
	for (let k = 0; k < n; k++) {
		const kr = chance(seed, 'corymb-berry', ...site.key, k);
		const r1 = kr(), r2 = kr();
		const rad = c * Math.sqrt(k + 0.5) * lerp(0.6, 1, emerge);
		const p = centre.clone().addScaledVector(round(axis, k * 2.39996 + twist), rad).addScaledVector(axis, -(rad * rad) / (Rc * 2.4));
		bag.add('body', tube([base, p], () => 0.0005, () => C.stalk, 3));
		if (g < opens) {
			bag.add('body', bead(p, v3(1, 1, 1).multiplyScalar(R * 0.45 * lerp(0.5, 1, emerge)), C.bud, 2));
			continue;
		}
		if (set < 0.02) {
			floret(bag, p, axis, C.bloom, C.flower, C.heart, clamp((g - opens) / 0.2) * (1 - span(g, opens + 0.3, opens + 0.42) * 0.6), 5, 0.15);
			continue;
		}
		if (k >= n - Math.floor(lost * (C.drop + 1))) continue;
		const r = R * lerp(0.22, 1, set) * (0.9 + r1 * 0.18);
		const ripe = span(g, ripeAt + r2 * 0.25, ripeAt + r2 * 0.25 + C.season.ripeFor);
		bag.add('gloss', bead(p, v3(r, r * 0.92, r), C.colour(ripe), 3));
		bag.add('body', bead(p.clone().addScaledVector(axis, r * 0.9), v3(1, 1, 1).multiplyScalar(r * 0.22), '#3a2a2a', 2));
	}
}

/** @type {Corymb} */
const ARONIA_CORYMB = {
	count: [10, 18], r: 0.0048, drop: 3, stalk: '#7a6a40', bud: '#e8dccc', flower: '#f6f2ea', heart: '#d08aa0', bloom: 0.0075,
	colour: (t) => ramp([[0, '#8aac50'], [0.35, '#c4604a'], [0.65, '#5a1e38'], [1, '#1a1420']], t),
	season: { opens: 4.7, setFor: 2.3, ripeFrom: 7.6, ripeFor: 1.1 }
};

export const aronia = shrub({
	seed: { size: v3(0.0012, 0.0008, 0.0008), coat: '#7a5a3a', shade: '#4a3424' },
	cotyledon: { length: 0.005, width: 0.0028, colour: '#5f9a42' },
	stems: { count: 13, first: 2, every: 0.19, rate: 1.3, length: [0.82, 1.02], lean: [0.08, 0.35], crown: 0.3, radius: 0.015, up: 0.015, wander: 0.08, spread: 0.7, children: 4, shorten: [0.42, 0.66], depth: 2, from0: 0.3, young: '#8a5a44', old: '#5a4a44', size: [[2, 0.18], [3, 0.38], [4, 0.78], [5, 1]] },
	roots: { length: 0.55, count: 8 },
	leaf: {
		blade: simple((u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.75) * (1 + (u > 0.15 && u < 0.92 ? ((u * 14) % 1) * 0.05 : 0)), 0.6, 0.04),
		length: 0.07, stalk: 0.012, stalkColour: '#7a6a40', spacing: 0.035, from: 0, bare: 0.35, colour: '#2f6a2c', young: '#6aa44a', vein: '#8ab06a', shade: '#245a26', droop: 0.1,
		autumn: { colour: '#b8302a', from: 8.3, share: 0.2 }
	},
	fruit: (ctx) => {
		// a corymb at the tip of each of the outer shoots
		for (const t of ctx.twigs) {
			if (t.order < 1 || !t.end) continue;
			const tr = chance(ctx.seed, 'aronia-tip', ...t.key);
			if (tr() > (t.order === 2 ? 0.42 : 0.25)) continue;
			corymb(ctx, { at: t.tip, dir: t.dir, key: t.key }, ARONIA_CORYMB);
		}
	}
});

/* ------------------------------------------------------------------------------------------------ haskap */

export const HASKAP_STAGES = stages([
	['Seed', 0, 'A tiny brown seed from a blue berry, sown in autumn.'],
	['Germination', 30, 'Early in spring a root goes down, a hooked shoot comes up.'],
	['Seed leaves', 45, 'Two small round seed leaves, then oval leaves in opposite pairs.'],
	['Young bush', 365, 'A little bush of thin shoots, the leaves in pairs, the bark already peeling.'],
	['Bush', 1100, 'A rounded bush a metre and a half high, brown peeling bark, soft oval leaves in pairs.'],
	['Flowering', 1180, 'The first of all to flower, in March frosts: pale yellow trumpets in pairs in the leaf axils.'],
	['Fruit set', 1195, 'Each pair of flowers sets a single berry, the two grown into one.'],
	['Green berries', 1215, 'Long green berries hanging in the leaf axils.'],
	['Turning', 1230, 'Green to purple to blue, under a silver bloom.'],
	['Ripe', 1240, 'Long blue berries under their bloom — the first fruit of the year, before the strawberries.']
]);

/** @type {Hanging} */
const HASKAP = {
	L: 0.022, W: 0.0058, stalk: 0.006, stalkColour: '#7a8a4a',
	season: { opens: 4.6, setFor: 2, ripeFrom: 7.4, ripeFor: 1 },
	bud: (bag, at, down, open, fall) => {
		// the pair of pale yellow funnels, side by side
		const side = round(down, 0);
		for (const s of [-1, 1]) bell(bag, at.clone().addScaledVector(side, s * 0.0025), down.clone().addScaledVector(side, s * 0.35).normalize(), 0.014, 0.0032, '#e8e0a0', '#f6f0c0', open, fall);
	},
	draw: (bag, at, dir, L, W, ripe) => {
		const c = ramp([[0, '#9ab868'], [0.4, '#8a6a8a'], [0.75, '#3a3a76'], [1, '#3a4682']], ripe);
		const bloom = new THREE.Color('#7884b0');
		oblong(bag, at, dir, L, W, (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.32) * (1 - 0.12 * u), (u, v) => c.clone().lerp(bloom, ripe * (0.35 + 0.12 * Math.sin(v * 12 + u * 7))), '#4a3a3a', 8);
	}
};

export const haskap = shrub({
	seed: { size: v3(0.0011, 0.0007, 0.0007), coat: '#8a6a4a', shade: '#5a4430' },
	cotyledon: { length: 0.004, width: 0.0028, colour: '#6aa046' },
	stems: { count: 10, first: 2, every: 0.19, rate: 1.3, length: [0.66, 0.84], lean: [0.3, 0.75], crown: 0.14, radius: 0.012, up: 0.008, wander: 0.11, spread: 0.85, children: 4, shorten: [0.45, 0.7], depth: 2, from0: 0.22, young: '#8a6a50', old: '#7a5a46', size: [[2, 0.2], [3, 0.4], [4, 0.8], [5, 1]] },
	roots: { length: 0.45, count: 7 },
	leaf: { blade: simple((u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.6), 0.52, 0.05), length: 0.058, stalk: 0.005, stalkColour: '#7a8a4a', spacing: 0.045, opposite: true, from: 0, bare: 0.3, colour: '#5a8a4c', young: '#94b86a', vein: '#a8c08a', shade: '#4a7a4a', droop: 0.12 },
	fruit: (ctx) => {
		// in the axils of the lowest pairs of leaves on last year's shoots
		for (const t of ctx.twigs) {
			if (t.order < 1) continue;
			const fr = chance(ctx.seed, 'haskap-node', ...t.key);
			for (let k = 0; k < 4; k++) {
				const w = walk(t.pts, (k + 0.4) * 0.045);
				const picks = [fr(), fr()];
				if (!w) break;
				for (const s of [0, 1]) {
					if (picks[s] > (t.order === 2 ? 0.17 : 0.06)) continue;
					hanging(ctx, w.p, level(round(w.d, (k * Math.PI) / 2 + s * Math.PI), level(w.d)), [...t.key, k, s], HASKAP);
				}
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ Japanese rose */

export const ROSE_STAGES = stages([
	['Seed', 0, 'A hard pale achene from inside a hip, sown in autumn: it wants a winter, often two, before it comes up.'],
	['Germination', 60, 'A root goes down, a hooked shoot comes up.'],
	['Seed leaves', 75, 'Two oval seed leaves, then the first leaf of three wrinkled leaflets.'],
	['Young bush', 365, 'A bristly young shoot, its leaves of five and seven leaflets.'],
	['Bush', 1100, 'A dense thicket a metre and a half high, suckering out, every stem bristling with prickles.'],
	['Flowering', 1250, 'Big single flowers, magenta-pink and scented, golden stamens, at the ends of the shoots.'],
	['Fruit set', 1265, 'The petals drop; the hips start to swell under their crown of sepals — while new flowers still open.'],
	['Green berries', 1300, 'Fat round green hips, flattened, their sepals standing up.'],
	['Turning', 1330, 'The hips turn orange, then scarlet.'],
	['Ripe', 1350, 'Big round red hips like little tomatoes among the wrinkled leaves, a last flower or two.']
]);

/**
 * A single rose: five broad petals, notched, cupped while young and spread flat when open, a ring of golden stamens,
 * its sepals behind; then the petals falling.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {number} open @param {number} fall @param {string} colour
 */
function rose(bag, at, facing, open, fall, colour) {
	const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(UP, facing.clone().normalize()), v3(1, 1, 1));
	const petal = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.55)), 0.5) * (u > 0.9 ? 1 - (u - 0.9) * 2.5 : 1);
	for (let k = 0; k < 5; k++) {
		const up = lerp(1.2, 0.15, open) - fall * 0.9;
		const shrink = 1 - fall * 0.6;
		bag.add('sheet', sheet({ length: 0.036 * lerp(0.35, 1, open) * shrink, width: 0.021 * lerp(0.35, 1, open) * shrink, shape: petal, lift: (u, v) => 0.12 * u * u + 0.08 * v * v + 0.015 * Math.sin(u * 9 + v * 4), paint: (u) => mix('#f6e6a8', colour, clamp(u * 4)), along: 5, across: 3 }), m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 5) * Math.PI * 2)).multiply(new THREE.Matrix4().makeRotationZ(up)));
	}
	for (let k = 0; k < 5; k++) bag.add('sheet', sheet({ length: 0.028, width: 0.004, shape: (u) => 1 - u * 0.8, lift: (u) => -0.1 * u, paint: () => '#4a7a3a', along: 3, across: 1 }), m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 5) * Math.PI * 2 + 0.6)).multiply(new THREE.Matrix4().makeRotationZ(-0.35)));
	if (open > 0.3 && fall < 1) bag.add('body', fan({ size: 0.011, from: -Math.PI, to: Math.PI, edge: (a) => 0.85 + 0.15 * Math.abs(Math.sin(a * 9)), lift: (s) => 0.3 * s, paint: (s) => mix('#d89a20', '#f2c840', s), rings: 1, rays: 12 }), m);
	bag.add('body', bead(v3(0, 0.002, 0).applyMatrix4(m), v3(0.0045, 0.002, 0.0045), '#c8b040', 3));
}

/**
 * A rose hip: round, flattened, glossy, its five sepals standing up as a crown from its top; green, then orange, then
 * scarlet.
 * @param {Bag} bag @param {THREE.Vector3} at where its stalk meets it @param {THREE.Vector3} dir which way it points @param {number} R @param {number} ripe
 */
function hip(bag, at, dir, R, ripe) {
	const c = at.clone().addScaledVector(dir, R * 0.85);
	const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
	bag.add('gloss', bead(c, v3(R, R * 0.82, R), ramp([[0, '#7aa048'], [0.4, '#e0a030'], [0.7, '#ea521e'], [1, '#c81e14']], ripe), 6, q));
	const top = c.clone().addScaledVector(dir, R * 0.78);
	const m = new THREE.Matrix4().compose(top, q, v3(1, 1, 1));
	for (let k = 0; k < 5; k++) bag.add('sheet', sheet({ length: R * 1.4, width: R * 0.22, shape: (u) => 1 - u * 0.7, lift: (u) => 0.15 * u, paint: () => mix('#4a6a32', '#6a5a32', ripe), along: 3, across: 1 }), m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 5) * Math.PI * 2)).multiply(new THREE.Matrix4().makeRotationZ(1.1)));
}

export const japaneseRose = shrub({
	seed: { size: v3(0.0035, 0.0022, 0.0024), coat: '#c8b08a', shade: '#9a805a' },
	cotyledon: { length: 0.008, width: 0.004, colour: '#5f9a42' },
	stems: { count: 15, first: 2, every: 0.19, rate: 1.3, length: [0.62, 0.82], lean: [0.08, 0.5], crown: 0.36, radius: 0.012, up: 0.01, wander: 0.09, spread: 0.75, children: 4, shorten: [0.42, 0.66], depth: 2, from0: 0.3, young: '#8a6a4a', old: '#6a5a50', size: [[2, 0.18], [3, 0.4], [4, 0.8], [5, 1]] },
	roots: { length: 0.55, count: 8 },
	leaf: {
		blade: compound({ pairs: 3, leaflet: 0.33, width: 0.55, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.7), rachis: '#5a7a3a', wrinkle: 1, across: 1 }),
		length: 0.13, stalk: 0.01, stalkColour: '#5a7a3a', spacing: 0.068, from: 0, bare: 0.3, colour: '#2e6a2a', young: '#6aa040', vein: '#7ea866', shade: '#285c26', droop: 0.15,
		autumn: { colour: '#d8a830', from: 8.5, share: 0.18 }
	},
	wood: (ctx, t) => {
		// bristling with prickles, straight and fine, thickest on the stems
		const pr = chance(ctx.seed, 'rose-prickles', ...t.key);
		const n = Math.floor(t.length * (t.order === 0 ? 24 : t.order === 1 ? 10 : 3));
		const thick = t.order === 0 ? 0.007 : t.order === 1 ? 0.004 : 0.0025;
		for (let k = 0; k < n; k++) {
			const w = walk(t.pts, pr() * t.length);
			const a = pr() * 6.28, l = pr();
			if (!w) continue;
			const out = round(w.d, a).addScaledVector(w.d, -0.2).normalize();
			prickle(ctx.bag, w.p.clone().addScaledVector(out, thick * 0.7), out, 0.003 + l * 0.004, 0.0007, l > 0.5 ? '#8a6a5a' : '#a8806a');
		}
	},
	fruit: (ctx) => {
		const { bag, seed, g, vigour } = ctx;
		const pink = chance(seed, 'rose-colour')() < 0.5 ? '#c42a78' : '#d8508e';
		for (const t of ctx.twigs) {
			if (t.order < 1 || !t.end) continue;
			const tr = chance(seed, 'rose-tip', ...t.key);
			const pick = tr(), late = tr();
			if (pick > (t.order === 2 ? 0.55 : 0.3)) continue;
			const n = 1 + Math.floor(tr() * 2.4);
			for (let k = 0; k < n; k++) {
				const kr = chance(seed, 'rose', ...t.key, k);
				const opens = 4.6 + kr() * 0.35 + k * 0.12;
				const a = kr() * 6.28;
				const R = 0.0125 * vigour * about(kr, 1, 0.1);
				if (g < opens - 0.5) continue;
				const out = k ? round(t.dir, a).addScaledVector(t.dir, 0.8).normalize() : t.dir.clone();
				const at = t.tip.clone().addScaledVector(out, 0.012 + k * 0.006);
				const set = span(g, opens + 0.45, opens + 2.4);
				bag.add('body', tube([t.tip, at], () => 0.0012, () => '#5a7a3a', 3));
				if (set < 0.02) {
					const facing = out.clone().lerp(UP, 0.55).normalize();
					if (g < opens) bag.add('body', bead(at.clone().addScaledVector(facing, 0.006), v3(0.005, 0.008, 0.005).multiplyScalar(lerp(0.4, 1, span(g, opens - 0.5, opens))), '#b0306a', 4, new THREE.Quaternion().setFromUnitVectors(UP, facing)));
					else rose(bag, at, facing, clamp((g - opens) / 0.2), span(g, opens + 0.3, opens + 0.45), pink);
					continue;
				}
				const place = bag.space.settle(at, out.clone().lerp(v3(0, -1, 0), 0.5).normalize(), (p, d) => [{ c: p.clone().addScaledVector(d, R * 0.9), r: R * 1.05 }], 0.015);
				bag.add('body', tube([at, place.at], () => 0.0012, () => '#5a7a3a', 3));
				hip(bag, place.at, place.dir, R * lerp(0.3, 1, set), span(g, 7.4 + kr() * 0.4, 8.5 + kr() * 0.4));
			}
			// rugosa flowers on through the summer: a late one here and there beside the hips
			if (late < 0.12) {
				const opens = 8.3 + late * 6;
				if (g > opens - 0.3 && g < opens + 0.6) {
					const facing = t.dir.clone().lerp(UP, 0.7).normalize();
					const at = t.tip.clone().addScaledVector(round(t.dir, late * 50), 0.03).addScaledVector(facing, 0.03);
					bag.add('body', tube([t.tip, at], () => 0.0012, () => '#5a7a3a', 3));
					rose(bag, at, facing, clamp((g - opens + 0.3) / 0.3), span(g, opens + 0.3, opens + 0.6), pink);
				}
			}
		}
	}
});

/* ------------------------------------------------------------------------------------------------ blackberry */

export const BLACKBERRY_STAGES = stages([
	['Seed', 0, 'A small hard pitted seed from a drupelet, sown in autumn: two winters, sometimes, before it wakes.'],
	['Germination', 40, 'A root goes down, a hooked shoot comes up.'],
	['Seed leaves', 55, 'Two small oval seed leaves, then a first leaf of three toothed leaflets.'],
	['First cane', 365, 'A first prickly cane, green flushed red, arching over.'],
	['Canes', 730, 'Long arching primocanes, two metres and more, their tips bowing to the soil and rooting there; leaves of five leaflets.'],
	['Flowering', 1060, 'The canes’ second summer: side shoots along them with sprays of white-pink flowers; new green canes rise from the crown.'],
	['Fruit set', 1075, 'The petals fall; little green knots of drupelets.'],
	['Green berries', 1100, 'Clusters of hard green berries on the side shoots.'],
	['Turning', 1120, 'Berry by berry, red, unevenly: green, red and black on one spray.'],
	['Ripe', 1135, 'Glossy black blackberries among the red and the green, picked over weeks.']
]);

/** @type {Leafing} */
const BRAMBLE_LEAF = {
	blade: compound({ pairs: 2, digitate: true, leaflet: 0.55, width: 0.6, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.7) * (1 + (u > 0.1 && u < 0.92 ? ((u * 15) % 1) * 0.08 : 0)), rachis: '#6a7a3a' }),
	length: 0.2, stalk: 0.055, stalkColour: '#7a6a3a', spacing: 0.085, from: 0, bare: 0.12, colour: '#2f622a', young: '#6a9a40', vein: '#86a864', shade: '#28562a', droop: 0.2
};

/** a blackberry: a bumpy oval of drupelets, glossy, green, red, then black */
function bramble(/** @type {Bag} */ bag, /** @type {THREE.Vector3} */ at, /** @type {THREE.Vector3} */ dir, /** @type {number} */ L, /** @type {number} */ W, /** @type {number} */ ripe) {
	const c = ramp([[0, '#8aa848'], [0.25, '#b8b058'], [0.5, '#c43040'], [0.75, '#5a1626'], [1, '#141014']], ripe);
	const pts = [];
	for (let k = 0; k <= 6; k++) pts.push(at.clone().addScaledVector(dir, (k / 6) * L));
	bag.add('gloss', tube(pts, (u, v) => W * Math.pow(Math.max(0, Math.sin(Math.PI * (0.06 + u * 0.94))), 0.5) * (1 + 0.14 * Math.abs(Math.sin(v * Math.PI * 6 + u * 9)) * Math.abs(Math.sin(u * Math.PI * 6))), (u, v) => c.clone().multiplyScalar(0.85 + 0.3 * Math.abs(Math.sin(v * Math.PI * 6 + u * 9))), 7));
}

/**
 * The blackberry at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function blackberry(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const at = v3(0, -0.004, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0016, 0.001, 0.0011), coat: '#8a6a4a', coatShade: '#5a4430',
		stem: table(g, [[0, 0], [0.35, 0.0006], [1, 0.006], [2, 0.014], [9, 0.014]]), hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.0006 + 0.003 * span(g, 1.5, 4), stemColor: '#8a7a4a',
		leaf: { length: 0.006, width: 0.0035, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.65), color: '#5f9a42', vein: '#9cc46e' },
		open: span(g, 1.15, 2), shed: span(g, 1, 1.6), wither: span(g, 2.9, 3.6)
	});
	shrubRoots(bag, seed, g, at, { length: 0.65, count: 11 }, vigour);
	/** @type {{ born: number, first: boolean }[]} */
	const canes = [2.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.6, 4.7, 4.8, 4.9, 5.05, 5.25, 5.5].map((born) => ({ born, first: born < 4 }));
	const ctx = { bag, seed, g, vigour, twigs: /** @type {Limb[]} */ ([]) };
	/** @type {{ pts: THREE.Vector3[], length: number, order: number, key: (string | number)[], fade?: number }[]} */
	const leafy = [];
	/** @type {{ pts: THREE.Vector3[], length: number, order: number, key: (string | number)[] }[]} */
	const shoots = [];
	/** @type {(() => void)[]} */
	const fruiting = [];
	canes.forEach((c, j) => {
		const cr = chance(seed, 'bramble', j);
		const bear = j * 2.39996 + cr() * 0.7;
		const full = (j === 0 ? 1.5 : between(cr, 1.9, 2.7)) * vigour;
		const lean = between(cr, 0.25, 0.65);
		const bend = between(cr, 1.1, 1.6);
		const from0 = j === 0 ? s.top.clone() : v3(Math.cos(bear), 0, Math.sin(bear)).multiplyScalar(between(cr, 0.03, 0.14));
		if (g <= c.born) return;
		const L = full * (c.first ? (j === 0 ? table(g, [[2.1, 0], [3, 0.35], [3.6, 0.6], [4.4, 1]]) : span(g, c.born, c.born + 1)) : span(g, c.born, c.born + 3.6));
		if (L < 0.003) return;
		// up, leaning out, then arching over and down to the soil, where its tip may root
		const out = v3(Math.cos(bear), 0, Math.sin(bear));
		const steps = 30;
		const pts = [from0];
		let p = from0.clone();
		for (let k = 0; k < steps; k++) {
			const sAt = (k / steps) * full;
			const th = Math.min(2.3, lean + Math.max(0, sAt - full * 0.28) * bend);
			const d = out.clone().multiplyScalar(Math.sin(th)).add(v3(0, Math.cos(th), 0)).applyAxisAngle(UP, Math.sin(k * 0.7 + j) * 0.05);
			p = p.clone().addScaledVector(d, full / steps);
			p.y = Math.max(0.012, p.y);
			pts.push(p.clone());
		}
		const n = (L / full) * steps;
		const whole = Math.floor(n);
		const now = pts.slice(0, whole + 1);
		if (whole < steps) now.push(pts[whole].clone().lerp(pts[whole + 1], n - whole));
		if (now.length < 2) return;
		const flori = c.first ? span(g, 4.25, 4.65) : 0;
		const thick = 0.0085 * (0.35 + 0.65 * clamp(L / full)) * (j === 0 ? 0.7 : 1);
		bag.add('body', tube(now, (u) => thick * (1 - 0.65 * u), (u) => mix(mix('#6f8a3c', '#9a3a3a', 0.35 + 0.35 * Math.sin(u * 7 + j)), '#5e3236', flori), 7));
		bag.space.rod(now, thick + 0.004);
		// hooked prickles, stout at the base, pointing back
		const pr = chance(seed, 'bramble-prickles', j);
		for (let k = 0; k < Math.floor(L * 22); k++) {
			const w = walk(now, pr() * L);
			const a = pr() * 6.28;
			if (!w) continue;
			const o = round(w.d, a).addScaledVector(w.d, -0.45).normalize();
			prickle(bag, w.p.clone().addScaledVector(o, thick * 0.6), o, 0.0055, 0.0018, flori > 0.5 ? '#7a4a3a' : '#b0504a', 0.25);
		}
		// a tip on the soil roots there
		const tip = now[now.length - 1];
		if (L > full * 0.92 && tip.y < 0.03) root(bag, { seed, key: ['tip', j], from: tip.clone(), dir: v3(0, -1, 0), length: 0.18, grown: span(g, c.born + (c.first ? 1 : 3.3), c.born + (c.first ? 1.8 : 3.9)), radius: 0.0015, laterals: 4, depth: 1, young: '#f1e4cc', old: '#8a6a4a' });
		leafy.push({ pts: now, length: L, order: 1, key: ['cane', j] });
		if (!c.first) return;
		// the second year's side shoots: from the buds along its arch, rising, each ending in a spray of flowers
		for (let k = 0; k < 16; k++) {
			const kr = chance(seed, 'bramble-lateral', j, k);
			const sAt = (0.28 + k * 0.042) * full;
			const pick = kr(), len = between(kr, 0.18, 0.36) * vigour, a = kr();
			if (pick > 0.55 || sAt > L - 0.05) continue;
			const born = 4.5 + kr() * 0.15;
			if (g <= born) continue;
			const w = walk(now, sAt);
			if (!w) continue;
			const side = level(round(w.d, a * 6.28), out);
			const heavy = span(g, 6, 8.5);
			let d = side.clone().multiplyScalar(0.5).add(v3(0, 1, 0)).normalize();
			const lp = [w.p.clone()];
			const grown = len * span(g, born, born + 0.6);
			for (let m = 0; m < 6; m++) {
				d = d.clone().addScaledVector(side, 0.08).add(v3(0, -0.04 - heavy * 0.08, 0)).normalize();
				lp.push(lp[m].clone().addScaledVector(d, grown / 6));
			}
			bag.add('body', tube(lp, (u) => 0.0028 * (1 - 0.5 * u), () => '#6a5a36', 4));
			shoots.push({ pts: lp, length: grown, order: 1, key: ['lateral', j, k] });
			const end = lp[6], endDir = d.clone();
			fruiting.push(() => spray(ctx, ['spray', j, k], end, endDir, lp));
		}
	});
	for (const f of fruiting) f();
	leafOut(ctx, BRAMBLE_LEAF, leafy);
	leafOut(ctx, { ...BRAMBLE_LEAF, blade: compound({ pairs: 1, digitate: true, leaflet: 0.6, width: 0.6, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.7), rachis: '#6a7a3a' }), length: 0.14, stalk: 0.03, spacing: 0.05, bare: 0 }, shoots);
	return bag.build();
}

/**
 * The spray at the end of a blackberry's side shoot: a flower at its tip and more on stalks below, opening first at
 * the tip, then the berries ripening one by one in the same order.
 * @param {Ctx} ctx @param {(string | number)[]} key @param {THREE.Vector3} end @param {THREE.Vector3} dir @param {THREE.Vector3[]} lp
 */
function spray(ctx, key, end, dir, lp) {
	const { bag, seed, g, vigour } = ctx;
	const sr = chance(seed, ...key);
	const n = 3 + Math.floor(sr() * 5);
	const pink = sr() < 0.4;
	for (let k = 0; k < n; k++) {
		const kr = chance(seed, ...key, k);
		const opens = 4.7 + k * 0.04 + kr() * 0.15;
		const base = k === 0 ? end : lp[Math.max(2, 6 - Math.floor(k / 2))];
		const a = k * 2.39996 + kr();
		const stalk = round(dir, a).addScaledVector(dir, 0.5).add(v3(0, 0.2, 0)).normalize();
		const at = base.clone().addScaledVector(stalk, k === 0 ? 0.008 : 0.018 + kr() * 0.012);
		const set = span(g, opens + 0.45, opens + 2.3);
		const ripeAt = 7.4 + k * 0.15 + kr() * 0.45;
		const size = vigour * about(kr, 1, 0.1);
		if (g < opens - 0.5) continue;
		if (set < 0.02) {
			bag.add('body', tube([base, at], () => 0.0007, () => '#6a7a3a', 3));
			if (g < opens) bag.add('body', bead(at.clone().addScaledVector(stalk, 0.004), v3(0.004, 0.005, 0.004).multiplyScalar(lerp(0.4, 1, span(g, opens - 0.5, opens))), '#8aa060', 3));
			else floret(bag, at, stalk.clone().lerp(UP, 0.3).normalize(), 0.013, pink ? '#f4d0dc' : '#f6f2ea', '#c8d080', clamp((g - opens) / 0.2) * (1 - span(g, opens + 0.3, opens + 0.45) * 0.6), 5, 0.1);
			continue;
		}
		const L = 0.021 * size * lerp(0.3, 1, set), W = 0.0095 * size * lerp(0.3, 1, set);
		const place = bag.space.settle(at, stalk.clone().lerp(v3(0, -1, 0), 0.6).normalize(), (p, d) => [0.3, 0.72].map((t) => ({ c: p.clone().addScaledVector(d, 0.021 * size * t), r: 0.0095 * size * 1.05 })), 0.02);
		bag.add('body', tube([base, at, place.at], () => 0.0008, () => '#6a7a3a', 3));
		bramble(bag, place.at, place.dir, L, W, span(g, ripeAt, ripeAt + 0.9));
	}
}

/* ------------------------------------------------------------------------------------------------ hardy kiwi */

export const KIWIBERRY_STAGES = stages([
	['Seed', 0, 'A tiny dark seed from a kiwiberry, chilled through the winter, sown on the surface.'],
	['Germination', 25, 'A root goes down, a thread of a shoot comes up.'],
	['Seed leaves', 35, 'Two small oval seed leaves, then rounded hairy ones.'],
	['First shoots', 365, 'A young vine finds its post and twines up it, anticlockwise.'],
	['On the bar', 1100, 'Over the top and along the bar both ways, a woody trunk twisted round the post, shoots hanging down.'],
	['Flowering', 1650, 'Nodding white flowers with dark anthers in the axils of the new shoots’ lowest leaves, scented of lily of the valley.'],
	['Fruit set', 1665, 'The petals drop; little hairless green fruit hang in the leaf axils.'],
	['Green fruit', 1720, 'Clusters of grape-sized, smooth green fruit along the base of every shoot.'],
	['Swelling', 1770, 'The fruit fill out and soften, a bronze blush on the sunny side.'],
	['Ripe', 1790, 'Soft, smooth, sweet kiwiberries to eat skin and all, hanging under a curtain of leaves.']
]);

const POST = v3(0.02, 0, -0.1);
const POST_R = 0.045;
const BAR_Y = 2.2;
const BAR = 1.1;
/** the vine's turn round the post, a turn every 45 cm */
const TWIST = (Math.PI * 2) / 0.45;

/** @type {Hanging} */
const KIWI = {
	L: 0.027, W: 0.0105, stalk: 0.03, stalkColour: '#8a6a48',
	season: { opens: 4.7, setFor: 2.4, ripeFrom: 7.8, ripeFor: 1.1 },
	bud: (bag, at, down, open, fall) => {
		if (fall < 1) floret(bag, at, down.clone().lerp(UP, 0.25).normalize(), 0.0095 * (1 - fall * 0.4), '#f8f4e6', '#3a2a30', open, 5, 0.35);
	},
	draw: (bag, at, dir, L, W, ripe) => {
		const c = ramp([[0, '#6a9a3a'], [0.6, '#7aa642'], [1, '#8aa846']], ripe);
		oblong(bag, at, dir, L, W, ovalShape, (u, v) => c.clone().lerp(new THREE.Color('#8a5a3a'), ripe * 0.35 * Math.max(0, Math.cos(v * Math.PI * 2))), '#4a3a2a', 9);
	}
};

/**
 * The hardy kiwi at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function kiwiberry(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.07);
	const at = v3(0, -0.003, 0);
	const s = sprout(bag, {
		seed, at, size: v3(0.0012, 0.0006, 0.0008), coat: '#3a2a20', coatShade: '#1e1610',
		stem: table(g, [[0, 0], [0.35, 0.0005], [1, 0.005], [2, 0.012], [9, 0.012]]), hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.0006 + 0.0025 * span(g, 1.5, 4), stemColor: '#8a7a4a',
		leaf: { length: 0.005, width: 0.0032, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.6), color: '#5f9a42', vein: '#9cc46e' },
		open: span(g, 1.15, 2), shed: span(g, 1, 1.6), wither: span(g, 2.9, 3.6)
	});
	shrubRoots(bag, seed, g, at, { length: 0.7, count: 11 }, vigour);

	// the post and its bar, set in as the vine starts to climb
	if (g >= 2.4) {
		bag.add('prop', tube([POST.clone().add(v3(0, -0.4, 0)), POST.clone().add(v3(0, BAR_Y + 0.06, 0))], () => POST_R, (u) => mix('#8a7058', '#9a8064', Math.abs(Math.sin(u * 40)) * 0.5), 8));
		bag.add('prop', tube([POST.clone().add(v3(-BAR, BAR_Y, 0)), POST.clone().add(v3(BAR, BAR_Y, 0))], () => 0.032, () => '#94785c', 6));
	}
	bag.space.rod([POST.clone(), POST.clone().add(v3(0, BAR_Y, 0))], POST_R + 0.01);
	bag.space.rod([POST.clone().add(v3(-BAR, BAR_Y, 0)), POST.clone().add(v3(BAR, BAR_Y, 0))], 0.045);

	// the trunk: from the seedling over to the post, then round and round it to the bar
	const H = Math.min(BAR_Y, table(g, [[2, 0], [2.6, 0.06], [3, 0.5], [3.5, 1.4], [4, BAR_Y]]) * vigour);
	const phase = chance(seed, 'kiwi-vine')() * Math.PI * 2;
	const start = s.top.clone();
	const trunkAt = (/** @type {number} */ h) => {
		const t = clamp((h - 0.04) / 0.22);
		const e = t * t * (3 - 2 * t);
		const a = phase + h * TWIST;
		const ring = POST_R + 0.012;
		return v3(lerp(start.x, POST.x + Math.cos(a) * ring, e), start.y + h, lerp(start.z, POST.z - Math.sin(a) * ring, e));
	};
	const ctx = { bag, seed, g, vigour, twigs: /** @type {Limb[]} */ ([]) };
	/** @type {{ pts: THREE.Vector3[], length: number, order: number, key: (string | number)[], fade?: number }[]} */
	const leafy = [];
	if (H > 0.003) {
		const steps = Math.max(2, Math.ceil(H / 0.025));
		const pts = [];
		for (let k = 0; k <= steps; k++) pts.push(trunkAt((k / steps) * H));
		const thick = 0.0025 + 0.013 * span(g, 3.6, 8.5);
		bag.add('body', tube(pts, (u) => thick * (1 - 0.45 * u), (u) => mix('#6a5040', '#8a7a4a', clamp(u * 2 - span(g, 3.5, 6))), 6));
		bag.space.rod(pts, thick + 0.004);
		// its leaves while it is the year's new growth
		leafy.push({ pts, length: H * 1.0, order: 1, key: ['trunk'], fade: span(g, 4.3, 4.9) });
	}

	// the arms along the bar, both ways from the top, twining loosely round it
	const A = table(g, [[3.9, 0], [4.4, 0.5], [5, BAR * 0.92], [9, BAR * 0.97]]) * vigour;
	/** @type {Limb[]} */
	const shoots = [];
	for (const side of [-1, 1]) {
		if (A < 0.01) break;
		const armAt = (/** @type {number} */ x) => {
			const a = phase + side * x * TWIST * 0.6;
			const ring = 0.042 * clamp(x / 0.08);
			return v3(POST.x + side * x, BAR_Y + Math.cos(a) * ring + 0.01, POST.z + Math.sin(a) * ring);
		};
		const steps = Math.max(2, Math.ceil(A / 0.03));
		const pts = [trunkAt(BAR_Y)];
		for (let k = 1; k <= steps; k++) pts.push(armAt((k / steps) * A));
		bag.add('body', tube(pts, (u) => (0.003 + 0.007 * span(g, 4.4, 8.5)) * (1 - 0.5 * u), () => '#7a6048', 5));
		bag.space.rod(pts, 0.012);
		leafy.push({ pts, length: A, order: 1, key: ['arm', side] });
		// the shoots: from buds along the arm, out over each side of the bar and hanging down, a curtain
		for (let k = 0; k < 11; k++) {
			const x = 0.06 + k * 0.1;
			const kr = chance(seed, 'kiwi-shoot', side, k);
			const born = 4.35 + x * 0.6 + kr() * 0.1;
			const over = k % 2 ? 1 : -1;
			const length = between(kr, 0.8, 1.15) * vigour;
			const sway = (kr() - 0.5) * 0.6;
			if (x > A - 0.04 || g <= born) continue;
			limb(bag, {
				seed, key: ['shoot', side, k], from: armAt(x), dir: v3(side * 0.2 + sway, 0.45, over * 0.9).normalize(), length, grown: Math.min(2, (g - born) * 1.4),
				radius: 0.0065, up: -0.17, wander: 0.08, spread: 0.7, children: 2, shorten: [0.4, 0.65], depth: 1, from0: 0.35, young: '#9a8058', old: '#7a6048', age: clamp((g - born) / 4), out: shoots, sides: 5
			});
		}
	}
	// the flowers and fruit in the axils of the lowest leaves of each shoot
	for (const t of shoots) {
		if (t.order > 0) continue;
		const fr = chance(seed, 'kiwi-node', ...t.key);
		for (let k = 1; k < 5; k++) {
			const w = walk(t.pts, (k + 0.4) * 0.07);
			const pick = fr(), two = fr(), a = fr();
			if (!w) break;
			if (pick > 0.75) continue;
			for (let m = 0; m < (two < 0.4 ? 2 : 1); m++) hanging(ctx, w.p, level(round(w.d, a * 6.28 + m * 2.4), level(w.d)), [...t.key, k, m], KIWI);
		}
	}
	leafOut(ctx, KIWI_LEAF, [...leafy, ...shoots]);
	return bag.build();
}

/** @type {Leafing} */
const KIWI_LEAF = {
	blade: simple((u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.5) * (u > 0.88 ? 1 - (u - 0.88) * 4 : 1) * (u < 0.06 ? 0.55 + u * 7 : 1), 0.82, 0.05),
	length: 0.115, stalk: 0.055, stalkColour: '#a83e36', spacing: 0.065, from: 0, bare: 0, colour: '#2e6a2a', young: '#7aac4a', vein: '#a8c08a', shade: '#2a5e28', droop: 0.45
};

/* ------------------------------------------------------------------------------------------------ the entries */

/** @type {(import('./index.js').Plant & { layer: import('./index.js').Layer })[]} */
export const WALD = [
	{
		id: 'redcurrant',
		label: 'Redcurrant',
		latin: 'Ribes rubrum · Rote Johannisbeere',
		note: 'An open bush of upright stems from the crown, lobed leaves, and from spurs on the two- and three-year-old wood, strigs of small cups that ripen into hanging strings of translucent red currants.',
		from: 'Shrub · 3 years',
		stages: REDCURRANT_STAGES,
		grow: redcurrant,
		layer: 'shrub'
	},
	{
		id: 'blackcurrant',
		label: 'Blackcurrant',
		latin: 'Ribes nigrum · Schwarze Johannisbeere',
		note: 'A bushy stool of many stems from the ground, big aromatic lobed leaves, short strigs of pinkish bells on last year’s shoots and then big glossy black currants.',
		from: 'Shrub · 3 years',
		stages: BLACKCURRANT_STAGES,
		grow: blackcurrant,
		layer: 'shrub'
	},
	{
		id: 'gooseberry',
		label: 'Gooseberry',
		latin: 'Ribes uva-crispa · Stachelbeere',
		note: 'Arching branches a metre high with sharp spines at every node, small lobed leaves in tufts; single hairy, veined berries hanging under the branches, green turning dark red.',
		from: 'Shrub · 3 years',
		stages: GOOSEBERRY_STAGES,
		grow: gooseberry,
		layer: 'shrub'
	},
	{
		id: 'blackberry',
		label: 'Blackberry',
		latin: 'Rubus fruticosus · Brombeere',
		note: 'Long thorny canes arching over to root where they touch the soil: leafy the first summer, the second their side shoots flower white and pink and bear clusters of drupelet berries, green, red and black at once.',
		from: 'Canes · 3 summers',
		stages: BLACKBERRY_STAGES,
		grow: blackberry,
		layer: 'shrub'
	},
	{
		id: 'aronia',
		label: 'Aronia',
		latin: 'Aronia melanocarpa · Apfelbeere',
		note: 'An upright suckering shrub near two metres, glossy oval leaves going red in autumn, flat white corymbs at the shoot tips, then heavy clusters of black chokeberries.',
		from: 'Shrub · 3 years',
		stages: ARONIA_STAGES,
		grow: aronia,
		layer: 'shrub'
	},
	{
		id: 'haskap',
		label: 'Haskap',
		latin: 'Lonicera caerulea · Maibeere',
		note: 'A rounded bush of peeling brown stems and soft oval leaves in pairs; pale yellow trumpets in pairs in the leaf axils in March, then long blue berries under a silver bloom — the year’s first fruit.',
		from: 'Shrub · 3 years',
		stages: HASKAP_STAGES,
		grow: haskap,
		layer: 'shrub'
	},
	{
		id: 'rose',
		label: 'Japanese rose',
		latin: 'Rosa rugosa · Kartoffelrose',
		note: 'A dense thicket of bristling stems, wrinkled leaves of seven leaflets, big single magenta flowers at the shoot tips all summer, and big round scarlet hips crowned by their sepals.',
		from: 'Shrub · 3 years',
		stages: ROSE_STAGES,
		grow: japaneseRose,
		layer: 'shrub'
	},
	{
		id: 'kiwiberry',
		label: 'Hardy kiwi',
		latin: 'Actinidia arguta · Kiwibeere',
		note: 'A vigorous vine twining up its post and along the bar, rounded leaves on red stalks hanging in a curtain, nodding white flowers, and clusters of smooth green kiwiberries the size of grapes.',
		from: 'Vine · 5 years',
		stages: KIWIBERRY_STAGES,
		grow: kiwiberry,
		layer: 'climber'
	}
];
