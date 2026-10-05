/*
 * KING COCONUT — Cocos nucifera 'King', the thambili of Sri Lanka, from its seed: the whole husked nut, laid on its
 * side half sunk in the soil. A spike pushes out of its stem end and roots break down through the husk; the seedling
 * feeds on the nut for a year, its first leaves whole and split only at their tip (bifid); later leaves come pinnate,
 * the palm builds a broad base and then a grey trunk ringed with old leaf scars, a crown of long arching fronds. Between
 * the fronds the flower spikes open from boat-shaped spathes, cream and branched; the buttons set and swell into bunches
 * of golden-orange nuts — the king coconut's colour — picked young for their water, dulling to orange-brown when ripe.
 * Below: hundreds of thick orange roots from the base of the trunk, spreading wide.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, Space, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';

export const STAGES = [
	{ name: 'Seed nut', day: 0, note: 'The whole golden husked nut, laid on its side half sunk in moist soil: the seed of a palm is its fruit.' },
	{ name: 'Germination', day: 120, note: 'A pointed spike breaks out of the nut’s stem end, roots push down through the husk.' },
	{ name: 'Seedling', day: 240, note: 'The first leaves, whole and split only at their tip; the seedling still feeds on the nut.' },
	{ name: 'Young palm', day: 540, note: 'Its leaves start to split into leaflets; the nut beside it, spent, rots away.' },
	{ name: 'Juvenile', day: 1100, note: 'A broad base, no trunk yet, a fountain of pinnate fronds two metres long.' },
	{ name: 'Flowering', day: 2000, note: 'A grey trunk ringed with leaf scars; boat-shaped spathes split and the cream flower spikes open.' },
	{ name: 'Fruit set', day: 2100, note: 'Green-gold buttons set on the branched spikes; many drop, the best hold on.' },
	{ name: 'Young nuts', day: 2250, note: 'Bunches of bright golden-orange nuts, full of sweet water: the king coconut’s drinking stage.' },
	{ name: 'Maturing', day: 2380, note: 'The nuts fill their shells with white meat, a new bunch every month above them.' },
	{ name: 'Ripe', day: 2480, note: 'Heavy bunches dulling to orange-brown under a crown of thirty fronds; the palm keeps fruiting for decades.' }
];

/** the nut lies along +X, its stem end (where it sprouts) at +X */
const NUT_AT = v3(-0.1, -0.035, 0);
const BASE = v3(0.02, 0, 0.01);

/** how many fronds the palm has made by g, all told */
const made = (/** @type {number} */ g) => table(g, [[1, 0], [1.6, 1], [2, 2], [3, 6], [4, 13], [5, 24], [6, 36], [7, 48], [8, 60], [9, 72]]);
/** how many it holds at once */
const holds = (/** @type {number} */ g) => table(g, [[1, 0], [1.6, 1], [2, 2], [3, 5], [4, 10], [5, 18], [6, 24], [7, 28], [9, 30]]);
/** when frond j was made */
function bornAt(/** @type {number} */ j) {
	let lo = 1, hi = 9;
	for (let i = 0; i < 30; i++) {
		const mid = (lo + hi) / 2;
		if (made(mid) > j) hi = mid;
		else lo = mid;
	}
	return hi;
}

/**
 * The king coconut at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function coconut(g, seed) {
	const bag = new Bag();
	const r = chance(seed, 'plant');
	const vigour = about(r, 1, 0.08);

	// the seed nut: golden going brown, spent and rotting once the palm stands on its own
	const rot = span(g, 3.2, 4.4);
	if (rot < 1) nut(bag, { seed, key: ['seed'], at: NUT_AT, dir: v3(1, -0.08, 0).normalize(), size: 1 - rot * 0.25, grown: 1, colour: mix('#c8853a', '#5a4630', rot) });

	// the roots: first through the husk, then thick and many from the base of the trunk
	const roots = Math.round(table(g, [[0.4, 0], [1, 4], [2, 9], [3, 16], [5, 34], [7, 48], [9, 56]]));
	for (let i = 0; i < roots; i++) {
		const rr = chance(seed, 'palm-root', i);
		const born = i < 4 ? 0.4 + i * 0.12 : bornRoot(i);
		const bear = i * 2.39996 + rr() * 0.4;
		const fromNut = i < 4;
		const from = fromNut ? NUT_AT.clone().add(v3(0.04 + i * 0.03, -0.06, (rr() - 0.5) * 0.05)) : BASE.clone().add(v3(Math.cos(bear) * 0.06 * lerp(1, 2.5, span(g, 4, 7)), -0.03 - rr() * 0.06, Math.sin(bear) * 0.06 * lerp(1, 2.5, span(g, 4, 7))));
		root(bag, {
			seed,
			key: ['palm', i],
			from,
			dir: fromNut ? v3((rr() - 0.5) * 0.4, -1, (rr() - 0.5) * 0.4) : v3(Math.cos(bear), -between(rr, 0.3, 1.1), Math.sin(bear)),
			length: fromNut ? 0.45 : between(rr, 1.2, 2.4) * vigour,
			grown: (g - born) / 2.4,
			radius: fromNut ? 0.003 : 0.0045,
			down: 0.025,
			wander: 0.12,
			laterals: 4,
			lateral: 0.18,
			depth: 1,
			age: (g - born - 0.6) / 2.5,
			young: '#efd2a6',
			old: '#b5683a'
		});
	}

	// the trunk: a broad base, then grey and ringed, leaning a little and curving back up
	const H = table(g, [[3.8, 0], [4.4, 0.12], [5, 1.5], [6, 3.3], [7, 5], [8, 6.5], [9, 7.8]]) * vigour;
	const lean = chance(seed, 'lean');
	const leanTo = v3(Math.cos(lean() * 6.283), 0, Math.sin(lean() * 6.283));
	const bow = between(lean, 0.04, 0.1);
	const trunkAt = (/** @type {number} */ u) => BASE.clone().addScaledVector(leanTo, Math.sin(u * 1.4) * bow * H).add(v3(0, u * H, 0));
	const bole = lerp(0.03, 0.17, span(g, 1.8, 6)) * vigour;
	// the leaf scars, from the base up: a ring where each fallen frond was, a hand apart, laid down as the trunk grew
	const sr = chance(seed, 'scars');
	const scars = [0.25];
	while (scars[scars.length - 1] < 9) scars.push(scars[scars.length - 1] + between(sr, 0.07, 0.13));
	/** how far from the nearest scar a height is (above it +, below it −), and the scar's own depth */
	const nearest = (/** @type {number} */ h) => {
		let lo = 0, hi = scars.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (scars[mid] > h) hi = mid;
			else lo = mid;
		}
		const a = h - scars[lo], b = h - scars[hi];
		return Math.abs(a) < Math.abs(b) ? a : b;
	};
	/** what is where: the trunk, then the nuts, so none grows through the trunk or another */
	const space = new Space();
	if (g > 1.6) {
		const ht = Math.max(0.05, H);
		// close enough along it for every ring to be its own groove
		const n = Math.max(24, Math.min(700, Math.round(ht / 0.012)));
		const pts = [];
		for (let k = 0; k <= n; k++) pts.push(trunkAt(k / n));
		if (H > 0.3) space.rod(pts, bole * 1.05);
		bag.add(
			'body',
			tube(
				H > 0.02 ? pts : [BASE.clone().add(v3(0, -0.05, 0)), BASE.clone().add(v3(0, bole * 0.8, 0))],
				(u, v) => {
					const h = u * ht;
					// the bole swollen at the foot, then a slow taper, a little thicker again under the crown
					const body = bole * (1 + 0.7 * Math.pow(1 - Math.min(1, h / 0.8), 2)) * (1 - 0.28 * u + 0.12 * Math.pow(u, 6));
					// each scar a groove with a lip just above it, rough round the trunk
					const d = nearest(h);
					const ring = h > 0.2 ? -0.035 * Math.exp(-Math.pow(d / 0.006, 2)) + 0.03 * Math.exp(-Math.pow((d - 0.014) / 0.01, 2)) : 0;
					return body * (1 + ring + 0.008 * Math.sin(v * Math.PI * 2 * 9 + h * 3));
				},
				(u, v) => {
					const h = u * ht;
					const d = nearest(h);
					const scar = h > 0.2 ? Math.exp(-Math.pow(d / 0.007, 2)) : 0;
					const lip = h > 0.2 ? Math.exp(-Math.pow((d - 0.016) / 0.012, 2)) : 0;
					// grey and weathered below, browner and greener toward the crown, fine vertical cracks
					const bark = mix(mix('#8d8476', '#7a6a52', clamp((u - 0.7) / 0.3)), '#6c5f4c', Math.pow(Math.abs(Math.sin(v * Math.PI * 2 * 23 + h * 1.7)), 12) * 0.6);
					return bark.lerp(new THREE.Color('#463d33'), scar * 0.75).lerp(new THREE.Color('#aaa08e'), lip * 0.35).lerp(new THREE.Color('#6b7a3c'), clamp(1 - H / 0.4) * 0.6);
				},
				22
			)
		);
		// the boot of old frond bases wrapped round the top of the trunk, fibrous brown
		if (H > 0.3) {
			const boot = [trunkAt(Math.max(0, 1 - 0.45 / ht)), trunkAt(1).add(v3(0, 0.12, 0))];
			bag.add('body', tube(boot, (u) => bole * (0.98 + 0.25 * Math.sin(Math.PI * u)), (u, v) => mix('#7a5f3e', '#9a8358', Math.abs(Math.sin(v * 40 + u * 9))), 18));
		}
	}
	const crown = H > 0.02 ? trunkAt(1) : BASE.clone().add(v3(0, g < 1.6 ? 0 : bole * 0.6, 0));

	// the germinating spike, before the first leaf opens
	const spike = span(g, 0.25, 1.4);
	const sprouting = NUT_AT.clone().add(v3(0.11, 0.05, 0));
	if (spike > 0 && g < 2.2) {
		const top = (g < 1.6 ? sprouting : crown).clone().add(v3(0, 0.02 + 0.2 * spike, 0));
		bag.add('body', tube([g < 1.6 ? sprouting : crown, top], (u) => 0.02 * (1 - u * 0.85) * lerp(0.4, 1, spike), (u) => mix('#c9a45a', '#7fa046', u), 8));
	}

	// the fronds: the newest a closed spear in the middle, the oldest hanging, yellowing, falling
	const total = made(g);
	const live = holds(g);
	for (let j = Math.max(0, Math.floor(total - live - 1)); j < Math.ceil(total); j++) {
		const age = (total - j) / Math.max(1, live);
		if (age < 0 || age > 1.05) continue;
		const born = bornAt(j);
		frond(bag, { seed, j, at: g < 1.6 ? sprouting : crown, age, opened: clamp((total - j) / 1.2), born, g, vigour });
	}

	// the bunches: one from each leaf axil of the lower crown, each a few weeks on from the one above it
	for (let b = 0; b < 7; b++) {
		const opens = 4.85 + b * 0.32;
		const phase = g - opens;
		if (phase < -0.3 || H < 0.3) continue;
		bunch(bag, { seed, b, at: crown, phase, vigour, bear: (made(opens) % 5) * 2.513 + b * 2.513, space, reach: bole });
	}
	return bag.build();
}

/** when a root from the base is made: a few a month */
const bornRoot = (/** @type {number} */ i) => 1.4 + (i - 4) * 0.13;

/**
 * A frond: its sheathing base, a long stalk, and its blade — while young whole and pleated, split only at its tip;
 * on the grown palm cut into a hundred narrow leaflets each side, held in a shallow V, arching over.
 * @param {Bag} bag
 * @param {{ seed: string, j: number, at: THREE.Vector3, age: number, opened: number, born: number, g: number, vigour: number }} o
 */
function frond(bag, o) {
	const fr = chance(o.seed, 'frond', o.j);
	const bear = o.j * 2.513 + about(fr, 0, 0.15);
	const out = v3(Math.cos(bear), 0, Math.sin(bear));
	const full = table(o.born, [[1, 0.35], [2, 0.6], [3, 1.0], [4, 2.1], [5, 3.6], [6, 4.7], [9, 5.4]]) * o.vigour;
	const len = full * lerp(0.35, 1, o.opened);
	// up when new, out and over as it ages, then hanging dead against the trunk
	const tilt = lerp(0.1, 1.55, Math.pow(clamp(o.age), 0.75)) + Math.max(0, o.age - 0.85) * 4 + about(fr, 0, 0.1);
	const dying = span(o.age, 0.82, 1.02);
	const pinnate = o.born > 3.1;
	const steps = 14;
	const pts = [o.at.clone()];
	let d = out.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
	const arch = 0.035 + 0.045 * o.age;
	for (let k = 0; k < steps; k++) {
		d = d.clone().add(v3(0, -arch * (k / steps) * (o.opened > 0.7 ? 1 : 0.3), 0)).normalize();
		pts.push(pts[k].clone().addScaledVector(d, len / steps));
	}
	const colour = (/** @type {number} */ u) => mix(mix('#c4b25a', '#5f8a38', clamp(u * 3)), '#b98f4a', dying);
	bag.add('body', tube(pts, (u) => (0.012 + 0.03 * clamp(full / 4)) * (1 - 0.8 * u), colour, 6));
	const along = (/** @type {number} */ u) => {
		const f = u * steps, k = Math.min(steps - 1, Math.floor(f));
		return { p: pts[k].clone().lerp(pts[k + 1], f - k), t: pts[k + 1].clone().sub(pts[k]).normalize() };
	};
	const green = (/** @type {number} */ u) => mix(mix('#3f7a2e', '#a7c25a', 1 - clamp(o.opened)), '#c7a24c', clamp(dying * 1.3 - u * 0.2));
	if (!pinnate) {
		// a whole leaf, pleated, split at its tip: two halves either side of the midrib
		for (const side of [-1, 1]) {
			for (let k = 0; k < 6; k++) {
				const u0 = 0.3 + k * 0.115;
				const { p, t } = along(u0);
				const across = new THREE.Vector3().crossVectors(t, v3(0, 1, 0)).normalize().multiplyScalar(side);
				const dir = across.multiplyScalar(0.45).addScaledVector(t, 0.9).add(v3(0, 0.12, 0)).normalize();
				const l = len * (0.36 - k * 0.03) * lerp(0.4, 1, o.opened);
				bag.add('sheet', sheet({ length: l, width: len * 0.05, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.7)) * 0.9 + 0.1, lift: (u, v) => 0.04 * v * v + (1 - o.opened) * 0.2 * Math.abs(v), paint: (u, v) => green(u0).lerp(new THREE.Color('#2f5f24'), Math.abs(v) > 0.7 ? 0.3 : 0), along: 6, across: 2 }), aim(p, dir, side * 0.4));
			}
		}
		return;
	}
	// the leaflets: longest in the frond's middle, shortest at its ends, angled forward, in a shallow V
	const pairs = Math.round(lerp(28, 70, clamp((o.born - 3) / 2)));
	for (let k = 0; k < pairs; k++) {
		const u0 = 0.18 + (k / pairs) * 0.8;
		const { p, t } = along(u0);
		const lengthHere = full * 0.24 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + (k / pairs) * 0.95)), 0.6) * lerp(0.3, 1, o.opened);
		for (const side of [-1, 1]) {
			const across = new THREE.Vector3().crossVectors(t, v3(0, 1, 0));
			if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
			across.normalize().multiplyScalar(side);
			const dir = across.multiplyScalar(0.8).addScaledVector(t, 0.55).add(v3(0, 0.25 - o.age * 0.35 - dying * 0.5, 0)).normalize();
			bag.add('sheet', sheet({ length: lengthHere, width: 0.018 + 0.006 * clamp(full / 4), shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.55)) * (1 - 0.5 * u), lift: (u) => -0.15 * u * u, paint: () => green(u0), along: 5, across: 1 }), aim(p, dir, side * 0.35));
		}
	}
}

/**
 * A bunch from a leaf axil: first a closed spathe, then the branched cream flower spike, then the buttons, then the nuts
 * swelling, golden-orange, hanging below the crown on a long stalk.
 * @param {Bag} bag
 * @param {{ seed: string, b: number, at: THREE.Vector3, phase: number, vigour: number, bear: number, space: Space, reach: number }} o
 */
function bunch(bag, o) {
	const br = chance(o.seed, 'bunch', o.b);
	const out = v3(Math.cos(o.bear), 0, Math.sin(o.bear));
	const heavy = span(o.phase, 0.6, 2.2);
	const stalkLen = 0.55 * lerp(0.5, 1, clamp(o.phase + 0.3));
	const d = out.clone().multiplyScalar(0.8).add(v3(0, lerp(0.5, -0.9, heavy), 0)).normalize();
	const start = o.at.clone().addScaledVector(out, o.reach * 1.25 + 0.03).add(v3(0, -0.2, 0));
	const end = start.clone().addScaledVector(d, stalkLen);
	if (o.phase < 0) {
		// the spathe, closed: a long brown-green boat between the frond bases
		const grow = clamp((o.phase + 0.3) / 0.3);
		bag.add('body', tube([start, start.clone().addScaledVector(d, 0.7 * grow)], (u) => 0.06 * Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.85)) * grow, (u) => mix('#7d8a46', '#a07a42', u), 10));
		return;
	}
	bag.add('body', tube([start, start.clone().lerp(end, 0.5).add(v3(0, 0.05, 0)), end], (u) => 0.03 * (1 - 0.4 * u), () => mix('#c9a45a', '#8f7444', heavy), 7));
	// the split spathe, hanging empty once open
	if (o.phase < 1.5) bag.add('sheet', sheet({ length: 0.75, width: 0.08, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.7)), lift: (u, v) => 0.3 * v * v, paint: () => mix('#a58a52', '#7a5a38', clamp(o.phase)), along: 8, across: 4 }), aim(start, d.clone().add(v3(0, -0.6, 0)).normalize()));
	const flowering = o.phase < 0.6;
	const rachillae = 12;
	const nuts = Math.round(lerp(18, 9 + br() * 6, span(o.phase, 0.4, 1.2)));
	for (let k = 0; k < rachillae; k++) {
		const a = (k / rachillae) * Math.PI * 2 + br() * 0.3;
		const spray = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.55).addScaledVector(d, 0.6).add(v3(0, -0.2 * heavy, 0)).normalize();
		const tip = end.clone().addScaledVector(spray, 0.35 * lerp(0.6, 1, clamp(o.phase * 2)));
		bag.add('body', tube([end, tip], (u) => 0.008 * (1 - 0.6 * u), () => (flowering ? '#e9dca0' : '#b39a5a'), 4));
		if (flowering) {
			// the male flowers, small and cream, all along the strands
			for (let m = 1; m <= 6; m++) bag.add('body', bead(end.clone().lerp(tip, m / 6.5), v3(0.008, 0.008, 0.008), '#f2e6b8', 2));
		}
	}
	// the nuts (the female flowers, set): buttons, then nuts, crowded round the bunch's heart
	for (let n = 0; n < nuts; n++) {
		const nr = chance(o.seed, 'nut', o.b, n);
		const a = n * 2.39996;
		const ring = 0.08 + 0.08 * Math.sqrt(n / nuts);
		const grown = span(o.phase, 0.4, 1.9);
		const at = end.clone().add(v3(Math.cos(a) * ring * lerp(0.6, 1.6, grown), -0.06 - (n % 4) * 0.05 * lerp(0.3, 1.4, grown), Math.sin(a) * ring * lerp(0.6, 1.6, grown)));
		const dir = at.clone().sub(end).add(v3(0, -0.25, 0)).normalize();
		const ripe = span(o.phase, 2.2, 3.4);
		const size = lerp(0.12, 1, grown) * about(nr, 0.9, 0.08) * o.vigour;
		// each nut where it touches neither the trunk nor its neighbours
		const place = o.space.settle(at, dir, (a, d) => [{ c: a.clone(), r: 0.23 * size * 0.38 }], 0.08);
		nut(bag, { seed: o.seed, key: ['bunch', o.b, n], at: place.at, dir: place.dir, size, grown, colour: mix(mix('#c9b04a', '#f29a2e', clamp(grown * 1.5)), '#a8692e', ripe) });
	}
}

/**
 * A husked coconut: an ovoid, faintly three-cornered, pointed at its far end, a brown calyx at its stem end.
 * @param {Bag} bag
 * @param {{ seed: string, key: (string | number)[], at: THREE.Vector3, dir: THREE.Vector3, size: number, grown: number, colour: THREE.Color | string }} o
 */
function nut(bag, o) {
	const L = 0.23 * o.size;
	const R = L * 0.4;
	const q = new THREE.Quaternion().setFromUnitVectors(v3(1, 0, 0), o.dir.clone().normalize());
	const m = new THREE.Matrix4().compose(o.at, q, v3(1, 1, 1));
	const axis = [];
	for (let k = 0; k <= 22; k++) axis.push(v3(-L / 2 + (k / 22) * L, 0, 0));
	const colour = new THREE.Color(o.colour);
	bag.add('gloss', tube(axis, (u, v) => R * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.5) * (1 - 0.18 * u * u) * (1 + 0.05 * Math.cos(v * Math.PI * 6)), (u) => colour.clone().lerp(new THREE.Color('#e8c25a'), (1 - u) * 0.12), 22), m);
	bag.add('body', bead(v3(-L / 2 + 0.005, 0, 0), v3(0.012, 0.03, 0.03).multiplyScalar(o.size + 0.2), '#7a5a32', 4), m);
}

