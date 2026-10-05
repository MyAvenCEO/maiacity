/*
 * CUCUMBER — Cucumis sativus, from one seed: flat and cream, a centimetre long, sown two centimetres deep. Its hooked
 * stem pulls two big oblong seed leaves out of the coat (the coat held back in the soil by a peg on the stem); then a
 * vine, one broad rough leaf at each node — palmate, five shallow pointed lobes, a heart-shaped base — tendrils
 * reaching for the bamboo stake and coiling round it, yellow flowers in the leaf axils (the female ones with a tiny
 * prickly cucumber behind them), and the cucumbers hanging, dark green, warted, striped pale toward their blossom end.
 * Below: a taproot and a wide shallow mat of laterals.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, fan, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

export const STAGES = [
	{ name: 'Seed', day: 0, note: 'A flat cream seed, a centimetre long, two centimetres down in warm soil.' },
	{ name: 'Germination', day: 3, note: 'The radicle dives; the hypocotyl arches up through the soil, its peg holding the coat back.' },
	{ name: 'Seed leaves', day: 7, note: 'Two oblong cotyledons open on a stem a few centimetres high; the taproot already branches.' },
	{ name: 'True leaves', day: 18, note: 'The first rough, lobed true leaves; the vine begins between the seed leaves.' },
	{ name: 'Vining', day: 32, note: 'Half a metre of vine, a leaf at each node, tendrils finding the stake and coiling round it.' },
	{ name: 'Flowering', day: 45, note: 'Yellow flowers in the leaf axils: clusters of male ones, and females with a tiny cucumber behind.' },
	{ name: 'Fruit', day: 60, note: 'Cucumbers hang from the vine, dark and warted; the lowest leaves yellow, the roots spread wide.' }
];

const SEED_AT = v3(0, -0.02, 0);
const NODES = 20;
const STAKE = v3(0.05, 0, 0.0);

/** how long the vine is at g */
const vineLength = (/** @type {number} */ g) => table(g, [[2.2, 0], [3, 0.13], [4, 0.5], [5, 1.15], [6, 1.6]]);

/**
 * The cucumber at growth g (0 … 6) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function cucumber(g, seed) {
	const bag = new Bag();
	const r = chance(seed, 'plant');
	const vigour = about(r, 1, 0.1);

	const s = sprout(bag, {
		seed,
		at: SEED_AT,
		size: v3(0.0048, 0.0011, 0.0021),
		coat: '#ece2c2',
		coatShade: '#c9b98c',
		stem: table(g, [[0, 0], [0.3, 0.001], [1, 0.03], [2, 0.065], [3, 0.075], [6, 0.08]]),
		hook: table(g, [[0, 1], [1, 1], [1.55, 0]]),
		radius: 0.0016 + 0.0016 * span(g, 2, 5),
		stemColor: '#86a74a',
		leaf: { length: 0.034, width: 0.0095, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.6) * (u < 0.12 ? 0.45 + u * 4.5 : 1), color: '#4f9134', vein: '#a5cf7d' },
		open: span(g, 1.1, 2),
		shed: span(g, 0.75, 1.4),
		wither: span(g, 4.6, 5.8),
		keepCoat: true
	});

	// the taproot, deep, and its laterals spread wide and shallow
	root(bag, {
		seed,
		key: ['taproot'],
		from: SEED_AT.clone(),
		dir: v3(0.02, -1, 0.03),
		length: 0.42,
		grown: table(g, [[0, 0], [0.35, 0.004], [1, 0.08], [2, 0.2], [3, 0.4], [4, 0.75], [5, 0.95], [6, 1]]),
		radius: 0.0024,
		down: 0.04,
		wander: 0.12,
		laterals: 0,
		depth: 0,
		age: span(g, 2, 5),
		young: '#f7f1e0',
		old: '#c4a57c'
	});
	const tap = chance(seed, 'laterals');
	for (let i = 0; i < 26; i++) {
		const at = 0.006 + i * 0.012 + tap() * 0.006;
		const born = 1.2 + i * 0.16;
		const bear = i * 2.39996 + tap() * 0.5;
		const reach = (i < 12 ? between(tap, 0.18, 0.32) : between(tap, 0.08, 0.16)) * vigour;
		root(bag, {
			seed,
			key: ['lateral', i],
			from: SEED_AT.clone().add(v3(0, -at, 0)),
			dir: v3(Math.cos(bear), -0.25, Math.sin(bear)),
			length: reach,
			grown: (g - born) / 2.6,
			radius: 0.0012,
			down: 0.035,
			wander: 0.3,
			laterals: 6,
			lateral: 0.3,
			depth: 2,
			age: (g - born - 1) / 3,
			young: '#f6efdc',
			old: '#c3a27a'
		});
	}

	// the stake, pushed in once the vine needs it
	if (g >= 3.5) {
		bag.add('prop', tube([STAKE.clone().add(v3(0, -0.22, 0)), STAKE.clone().add(v3(0, 1.7, 0))], (u) => 0.0055 * (1 - 0.3 * u), (u) => mix('#c8a865', '#d9c08a', Math.abs(Math.sin(u * 60)) < 0.06 ? 0 : 1), 8));
	}

	// the vine: from between the seed leaves up and round the stake
	const L = vineLength(g) * vigour;
	if (L > 0.002) vine(bag, seed, s.top, L, g, vigour);
	return bag.build();
}

/**
 * The vine's whole path, drawn once: it leans to the stake and climbs it, wandering round it as tendrils catch.
 * @param {string} seed @param {THREE.Vector3} start
 */
function vinePath(seed, start) {
	const vr = chance(seed, 'vine');
	const pts = [start.clone()];
	const phase = vr() * Math.PI * 2;
	const step = 0.02;
	const total = 1.9;
	for (let s = step; s <= total + 1e-9; s += step) {
		const k = s / total;
		// out to the stake over the first 25 cm, then round it in a slow open spiral, a little wander
		const toStake = clamp(s / 0.25);
		const a = phase + s * 3.1 + Math.sin(s * 7 + phase) * 0.35;
		const ring = lerp(0, 0.035 + 0.015 * Math.sin(s * 5 + phase * 2), toStake);
		const x = lerp(start.x, STAKE.x, toStake * toStake * (3 - 2 * toStake)) + Math.cos(a) * ring;
		const z = lerp(start.z, STAKE.z, toStake * toStake * (3 - 2 * toStake)) + Math.sin(a) * ring;
		pts.push(v3(x, 0, z));
		pts[pts.length - 1].y = start.y + s * (0.92 - 0.06 * k);
	}
	return { pts, step };
}

/**
 * @param {Bag} bag @param {string} seed @param {THREE.Vector3} start @param {number} L @param {number} g @param {number} vigour
 */
function vine(bag, seed, start, L, g, vigour) {
	const { pts, step } = vinePath(seed, start);
	const n = Math.min(pts.length - 1, L / step);
	const whole = Math.floor(n);
	const now = pts.slice(0, whole + 1);
	if (whole < pts.length - 1) now.push(pts[whole].clone().lerp(pts[whole + 1], n - whole));
	if (now.length < 2) return;
	const thick = 0.0028 + 0.0022 * span(g, 3, 6);
	bag.add('body', tube(now, (u) => thick * (1 - 0.55 * Math.pow(u, 3)), (u) => mix('#6f9440', '#8fbf5a', u), 7));
	/** a place along the vine, and its direction */
	const at = (/** @type {number} */ s) => {
		const f = Math.min(pts.length - 1.001, s / step);
		const k = Math.floor(f);
		return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize() };
	};

	// a node every 7 – 9 cm: its leaf, from the third node its tendril, from the fifth its flowers
	let s = 0.03;
	for (let i = 0; i < NODES; i++) {
		const nr = chance(seed, 'node', i);
		s += i === 0 ? 0 : between(nr, 0.07, 0.095);
		const past = L - s;
		if (past <= 0) break;
		const { p, d } = at(s);
		const bear = i * 2.51 + about(nr, 0, 0.3);
		const out = new THREE.Vector3(Math.cos(bear), 0, Math.sin(bear));
		// leaves turn to face away from the stake
		const fromStake = p.clone().sub(STAKE).setY(0);
		if (fromStake.lengthSq() > 1e-6) out.lerp(fromStake.normalize(), 0.45).normalize();
		const grown = clamp(past / 0.16);
		const size = lerp(0.55, 1, clamp(i / 4)) * about(nr, 1, 0.12) * vigour;
		const old = i < 3 ? span(g, 5.4 + i * 0.2, 6.3 + i * 0.2) : 0;
		leaf(bag, { seed, key: i, at: p, out, size, grown, old });
		if (i >= 2 && past > 0.03) tendril(bag, seed, i, p, d, out, clamp((past - 0.03) / 0.2));
		if (i >= 4) flowers(bag, seed, i, p, out, g, past, vigour);
	}
	// the growing tip: a tight bud of folded leaves
	const tip = now[now.length - 1];
	bag.add('body', bead(tip, v3(1, 1.4, 1).multiplyScalar(0.004), '#9bc46a'));
}

/** the cucumber leaf's edge: five shallow pointed lobes and the notch at its base, finely toothed */
function lobes(/** @type {number} */ a) {
	const tips = [[0, 1], [1.12, 0.88], [-1.12, 0.88], [2.2, 0.62], [-2.2, 0.62]];
	let reach = 0;
	for (const [at, size] of tips) reach = Math.max(reach, size * (1 - 0.34 * Math.min(1, Math.abs(a - at) / 0.6)));
	return reach * (1 + 0.035 * Math.abs(Math.sin(a * 22)));
}

/**
 * A cucumber leaf on its long stalk: broad, roughly hairy, the veins pale and running out from the stalk to each lobe.
 * @param {Bag} bag
 * @param {{ seed: string, key: number, at: THREE.Vector3, out: THREE.Vector3, size: number, grown: number, old: number }} o
 */
function leaf(bag, o) {
	const lr = chance(o.seed, 'leaf', o.key);
	const g = o.grown;
	// the stalk: out and up, bowing under the blade
	const len = 0.11 * o.size * lerp(0.25, 1, g);
	const lift = between(lr, 0.5, 0.9) - o.old * 0.6;
	let d = o.out.clone().multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0)).normalize();
	let p = o.at.clone();
	const pts = [];
	for (let k = 0; k <= 8; k++) {
		pts.push(p.clone());
		d = d.clone().addScaledVector(v3(0, -1, 0), 0.05 * (k / 8) * (1 + o.old * 2)).normalize();
		p = p.clone().addScaledVector(d, len / 8);
	}
	bag.add('body', tube(pts, (u) => 0.0024 * o.size * (1 - 0.3 * u), () => mix('#78a446', '#c6b24a', o.old), 5));
	const top = pts[8];
	// the blade: spread from the stalk's end, held facing up and out
	const size = 0.095 * o.size * lerp(0.2, 1, g);
	// held up while it unfolds, then hanging from the stalk's end, its face turned out to the light
	const tilt = lerp(0.9, between(lr, -0.85, -0.45), g) - o.old * 0.4;
	const facing = o.out.clone().multiplyScalar(Math.cos(tilt)).add(v3(0, Math.sin(tilt), 0)).normalize();
	const curl = (1 - g) * 0.5;
	const blade = fan({
		size,
		from: -Math.PI + 0.32,
		to: Math.PI - 0.32,
		edge: lobes,
		lift: (s, a) => -0.12 * s * s * (1 + o.old) + curl * s * Math.abs(Math.sin(a)) + 0.012 * Math.cos(a * 5) * s,
		paint: (s, a) => {
			const vein = [0, 1.12, -1.12, 2.2, -2.2].some((t) => Math.abs(a - t) < 0.04) ? 0.5 : 0;
			const green = mix(mix('#2e6a25', '#5c9a3c', 1 - g), '#9cc173', vein * (1 - s * 0.5));
			return o.old ? green.lerp(mix('#d6c24c', '#a9873a', s), clamp(o.old * 1.3)) : green;
		},
		rings: 9,
		rays: 64
	});
	// the stalk joins the blade at its notch: the blade reaches forward from there, over the stalk's end
	bag.add('sheet', blade, aim(top.clone().addScaledVector(facing, -0.012 * o.size * g), facing, about(lr, 0, 0.2)));
}

/**
 * A tendril: a thin green thread that reaches for the stake, then coils into a spring.
 * @param {Bag} bag @param {string} seed @param {number} i @param {THREE.Vector3} at @param {THREE.Vector3} along @param {THREE.Vector3} out @param {number} grown
 */
function tendril(bag, seed, i, at, along, out, grown) {
	const tr = chance(seed, 'tendril', i);
	const toStake = STAKE.clone().setY(at.y + 0.04).sub(at);
	const reach = Math.min(0.12, toStake.length() + 0.01);
	const dir = toStake.lengthSq() > 1e-6 ? toStake.normalize().lerp(along, 0.3).normalize() : out.clone().negate();
	const len = (0.06 + reach) * grown;
	const coil = span(grown, 0.55, 1);
	const pts = [];
	const straight = len * (1 - coil * 0.55);
	const side = new THREE.Vector3().crossVectors(dir, v3(0, 1, 0)).normalize();
	const upw = new THREE.Vector3().crossVectors(side, dir).normalize();
	const twist = tr() * Math.PI;
	for (let k = 0; k <= 30; k++) {
		const u = k / 30;
		const s = u * len;
		if (s <= straight) pts.push(at.clone().addScaledVector(dir, s));
		else {
			// past the straight part it winds round, tighter toward its end
			const w = (s - straight) / Math.max(1e-6, len - straight);
			const ang = twist + w * Math.PI * 2 * (2 + coil * 3);
			const rad = 0.006 * (1 - 0.5 * w);
			pts.push(at.clone().addScaledVector(dir, straight + w * 0.015).addScaledVector(side, Math.cos(ang) * rad).addScaledVector(upw, Math.sin(ang) * rad));
		}
	}
	bag.add('body', tube(pts, (u) => 0.00075 * (1 - 0.6 * u), () => '#9cc26a', 4));
}

/**
 * The flowers at a node: a cluster of male flowers on short stalks, or one female flower with its ovary behind it —
 * the cucumber it becomes once it is pollinated.
 * @param {Bag} bag @param {string} seed @param {number} i @param {THREE.Vector3} at @param {THREE.Vector3} out @param {number} g @param {number} past @param {number} vigour
 */
function flowers(bag, seed, i, at, out, g, past, vigour) {
	const fr = chance(seed, 'flowers', i);
	const female = i >= 6 && (i % 2 === 0 ? fr() < 0.75 : fr() < 0.3);
	const opens = 4.25 + i * 0.07 + fr() * 0.15;
	if (g < opens - 0.25 || past < 0.05) return;
	const bud = clamp((g - (opens - 0.25)) / 0.25);
	const up = out.clone().add(v3(0, 0.6, 0)).normalize();
	if (!female) {
		const count = 2 + Math.floor(fr() * 3);
		for (let k = 0; k < count; k++) {
			const mr = chance(seed, 'male', i, k);
			const born = opens + k * 0.12;
			if (g < born - 0.25) continue;
			const d = up.clone().applyAxisAngle(v3(0, 1, 0), about(mr, 0, 0.9)).lerp(v3(0, 1, 0), 0.2).normalize();
			const stalk = at.clone().addScaledVector(d, 0.025);
			bag.add('body', tube([at.clone(), stalk], () => 0.0007, () => '#86ad52', 4));
			// open a few days, then wilt and drop
			const life = clamp((g - born) / 0.2);
			const wilt = span(g, born + 0.55, born + 0.8);
			if (wilt < 1) blossom(bag, stalk, d, life, wilt, 0.85);
		}
		return;
	}
	// the female: a tiny prickly cucumber, the flower at its end; set, it grows into the fruit and the flower dries
	const set = span(g, opens + 0.3, opens + 1.25 - (i - 6) * 0.04);
	const hang = clamp(set * 1.6);
	const dir = up.clone().lerp(v3(0, -1, 0), 0.25 + hang * 0.7).normalize();
	const stalkEnd = at.clone().addScaledVector(dir, 0.015 + 0.02 * set);
	bag.add('body', tube([at.clone(), stalkEnd], () => 0.0012 + 0.002 * set, () => '#6e9640', 5));
	const size = vigour * about(fr, 1, 0.12) * (i > 13 ? 0.7 : 1);
	const tipAt = fruit(bag, seed, i, stalkEnd, dir, lerp(0.022 * bud, 0.21 * size, set), set);
	const life = clamp((g - opens) / 0.2);
	const wilt = span(g, opens + 0.5, opens + 0.9);
	blossom(bag, tipAt.p, tipAt.d, life, wilt, 1);
}

/**
 * A cucumber flower: five yellow petals joined at their base, wrinkled, flaring open; wilting, they fold shut and
 * brown.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {number} open @param {number} wilt @param {number} size
 */
function blossom(bag, at, facing, open, wilt, size) {
	const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), facing.clone().normalize()), v3(size, size, size).multiplyScalar(1 - wilt * 0.45));
	const colour = mix(mix('#e5d670', '#f2c518', open), '#b08a3a', wilt);
	for (let k = 0; k < 5; k++) {
		const petal = sheet({
			length: 0.017,
			width: 0.0085,
			shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.7) * (1 + 0.06 * Math.sin(u * 30)),
			lift: (u, v) => 0.04 * Math.sin(u * 18 + v * 3) * u + 0.08 * u * u,
			paint: (u) => mix(colour, '#e9a800', (1 - u) * 0.35 * (1 - wilt)),
			along: 10,
			across: 6
		});
		const up = lerp(1.3, 0.22, open) + wilt * 1.0;
		bag.add('sheet', petal, m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 5) * Math.PI * 2)).multiply(new THREE.Matrix4().makeRotationZ(up)));
	}
	bag.add('body', bead(v3(0, 0.0025, 0).applyMatrix4(m), v3(0.0025, 0.003, 0.0025).multiplyScalar(size), wilt > 0.5 ? '#8f7a3a' : '#e0a91a', 5));
}

/**
 * A cucumber: long and a little bent, rounded at its ends, dark green paling in stripes toward its blossom end,
 * studded with small warts each with a pale spine. Grows from `at` along `dir`; returns its blossom end.
 * @param {Bag} bag @param {string} seed @param {number} i @param {THREE.Vector3} at @param {THREE.Vector3} dir @param {number} length @param {number} set
 */
function fruit(bag, seed, i, at, dir, length, set) {
	const cr = chance(seed, 'cucumber', i);
	const R = length * lerp(0.2, between(cr, 0.13, 0.16), set);
	const bend = about(cr, 0, 0.12) * set;
	const side = new THREE.Vector3().crossVectors(dir, v3(0, 1, 0));
	if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
	side.normalize();
	const axis = [];
	for (let k = 0; k <= 20; k++) {
		const u = k / 20;
		axis.push(at.clone().addScaledVector(dir, u * length).addScaledVector(side, Math.sin(u * Math.PI) * bend * length));
	}
	const radius = (/** @type {number} */ u) => R * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.32) * (0.82 + 0.18 * u);
	const stripes = Math.round(8 + cr() * 4);
	bag.add(
		'gloss',
		tube(axis, radius, (u, v) => {
			const stripe = Math.pow(Math.max(0, Math.cos(v * Math.PI * 2 * stripes)), 6) * clamp(u * 1.6 - 0.35);
			return mix(mix('#3a7329', '#5a8f3c', u * 0.6), '#b8d08a', stripe * 0.8 + clamp(u - 0.85) * 1.5);
		}, 16)
	);
	// its warts, each with a pale spine at its top
	const warts = Math.round(40 + 80 * set);
	const wr = chance(seed, 'warts', i);
	for (let k = 0; k < warts; k++) {
		const u = between(wr, 0.08, 0.92);
		const a = wr() * Math.PI * 2;
		const f = u * 20;
		const kk = Math.min(19, Math.floor(f));
		const c = axis[kk].clone().lerp(axis[kk + 1], f - kk);
		const t = axis[kk + 1].clone().sub(axis[kk]).normalize();
		const n1 = new THREE.Vector3().crossVectors(t, side).normalize();
		const radial = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(n1, Math.sin(a));
		const w = Math.max(0.0004, R * 0.07);
		bag.add('body', bead(c.clone().addScaledVector(radial, radius(u) * 0.97), v3(w, w, w), set < 0.4 ? '#cfe0a8' : '#4a7f35', 3));
		bag.add('body', bead(c.clone().addScaledVector(radial, radius(u) + w * 0.9), v3(w, w, w).multiplyScalar(0.35), '#f2f0dc', 2));
	}
	return { p: axis[20].clone().addScaledVector(dir, 0.001), d: dir.clone() };
}
