/*
 * STRAWBERRY — Fragaria × ananassa, the garden strawberry, from one seed: an achene a millimetre long sown on the
 * soil. It sprouts two round seed leaves, then from its crown (the short stem at the soil) a rosette of trifoliate
 * leaves on long hairy stalks, serrated and pleated along their veins; fibrous roots from the crown, white when new and
 * darkening as they age; trusses of white five-petalled flowers, each swelling into a berry — green, then white, then
 * red from the tip up, its seeds on the outside — hanging on its stalk toward the soil; and a runner along the
 * ground with a daughter plant at its end.
 *
 * All of it at real measure (metres), the soil's surface at y = 0.
 */
import * as THREE from 'three';
import { Bag, Space, about, aim, bead, between, chance, clamp, heading, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { bloom } from './bloom.js';

export const STAGES = [
	{ name: 'Seed', day: 0, note: 'An achene a millimetre long, sown on the soil, barely covered: strawberry seeds want light to sprout.' },
	{ name: 'Germination', day: 12, note: 'The radicle breaks out and turns down; the hypocotyl, bent in a hook, pushes up into the light.' },
	{ name: 'Seed leaves', day: 20, note: 'Two round cotyledons open on a stem a centimetre high; the root has its first laterals.' },
	{ name: 'True leaves', day: 40, note: 'The first trifoliate leaves, toothed, from between the seed leaves: the crown has begun.' },
	{ name: 'Rosette', day: 75, note: 'A crown of leaves on long stalks, the seed leaves gone, fibrous roots spreading from the crown.' },
	{ name: 'Flowering', day: 110, note: 'Trusses of white five-petalled flowers rise between the leaves, bees welcome.' },
	{ name: 'Fruit set', day: 120, note: 'The petals fall; behind each flower the receptacle swells into a small green berry, its seeds standing out.' },
	{ name: 'Green berries', day: 130, note: 'The berries fill out, still hard and green, their stalks bowing toward the soil; a runner sets out.' },
	{ name: 'Turning', day: 140, note: 'The first berries pale to white and blush red from the tip up; a daughter plant roots at the runner’s end.' },
	{ name: 'Ripe', day: 150, note: 'Berry after berry red and glossy, hanging on the straw: picking time.' }
];

/** the stages as the plant grows them: flowering at 5, then the fruit's four stages over a longer stretch of growth */
const growth = (/** @type {number} */ stage) => (stage <= 5 ? stage : 5 + (stage - 5) * 0.65);

const SEED_AT = v3(0, -0.0022, 0);
const LEAVES = 16;
const ROOTS = 22;
const TRUSSES = 6;

/** the leaves' births: the first slowly, one after the other, then a new one every few days */
const leafBirth = (/** @type {number} */ i) => (i === 0 ? 2.0 : i === 1 ? 2.45 : i === 2 ? 2.85 : 3.1 + (i - 3) * 0.18);

/**
 * The strawberry at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} stage
 * @param {string} seed
 */
export function strawberry(stage, seed) {
	const g = growth(stage);
	const bag = new Bag();
	/** what is where: the berries, so that none grows through another */
	const space = new Space();
	const r = chance(seed, 'plant');
	const vigour = about(r, 1, 0.12);

	// the seedling: the radicle, the hook, the seed leaves — later the crown
	const s = sprout(bag, {
		seed,
		at: SEED_AT,
		size: v3(0.00065, 0.00042, 0.00042),
		coat: '#b98a3e',
		coatShade: '#8a6a3a',
		stem: table(g, [[0, 0], [0.35, 0.0004], [1, 0.0052], [2, 0.011], [3, 0.012], [4.2, 0.0045], [6, 0.0045]]),
		hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.00028 + 0.0006 * span(g, 2, 4),
		stemColor: '#8fa84a',
		leaf: { length: 0.0055, width: 0.0026, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.7), color: '#5f9a3b', vein: '#9cc46e' },
		open: span(g, 1.15, 2),
		shed: span(g, 1.0, 1.7),
		wither: span(g, 3.3, 4.3)
	});
	const crown = s.top.clone();
	if (g > 2.4) {
		// the crown: the short thick stem at the soil, the leaves' stipules wrapped round it
		const c = span(g, 2.4, 6);
		bag.add('body', bead(crown.clone().add(v3(0, -0.001 * c, 0)), v3(1, 1.25, 1).multiplyScalar(0.0012 + 0.0065 * c * vigour), mix('#8a9a4a', '#6e4b32', c)));
	}

	// the radicle, the first root, straight down from the seed
	root(bag, {
		seed,
		key: ['radicle'],
		from: SEED_AT.clone(),
		dir: v3(0.05, -1, 0.02),
		length: 0.2,
		grown: table(g, [[0, 0], [0.4, 0.004], [1, 0.06], [2, 0.16], [3, 0.35], [4, 0.7], [6, 1]]),
		radius: 0.00035 + 0.0006 * span(g, 2, 5),
		down: 0.05,
		wander: 0.2,
		laterals: 9,
		lateral: 0.3,
		depth: 2,
		age: span(g, 2.5, 5),
		young: '#f6f0de',
		old: '#9c6f45'
	});
	// the crown's roots, fibrous, one after another as the crown grows
	for (let i = 0; i < ROOTS; i++) {
		const rr = chance(seed, 'crown-root', i);
		const born = 2.6 + i * 0.13 + rr() * 0.1;
		const tilt = between(rr, 0.25, 1.15);
		const bear = rr() * Math.PI * 2;
		const d = v3(Math.sin(tilt) * Math.cos(bear), -Math.cos(tilt), Math.sin(tilt) * Math.sin(bear));
		root(bag, {
			seed,
			key: ['crown', i],
			from: crown.clone().add(v3(d.x * 0.003, -0.002, d.z * 0.003)),
			dir: d,
			length: between(rr, 0.12, 0.24) * vigour,
			grown: (g - born) / 2.2,
			radius: 0.001,
			down: 0.06,
			wander: 0.28,
			laterals: 7,
			lateral: 0.28,
			depth: 2,
			age: (g - born - 0.8) / 2.5,
			young: '#f3ead2',
			old: '#7a5232'
		});
	}

	// the rosette: trifoliate leaves turned round the crown by the golden angle
	for (let i = 0; i < LEAVES; i++) {
		const born = leafBirth(i);
		if (g <= born) break;
		const lr = chance(seed, 'leaf', i);
		const size = lerp(0.22, 1, clamp((born - 2) / 2.2)) * about(lr, 1, 0.12) * vigour;
		const bear = i * 2.39996 + about(lr, 0, 0.35);
		const tiltTo = between(lr, 0.45, 1.1);
		const grown = clamp((g - born) / 0.9);
		const wither = born < 3.05 ? span(g, 4.3 + i * 0.35, 5.5 + i * 0.35) : 0;
		if (wither >= 1) continue;
		trifoliate(bag, { seed, key: ['leaf', i], at: crown, size, bear, tilt: lerp(0.08, tiltTo, grown) + wither * 0.7, grown, wither, scale: 1 });
	}

	// the trusses: flowers on branching stalks, then berries
	for (let j = 0; j < TRUSSES; j++) {
		const tr = chance(seed, 'truss', j);
		const born = 4.1 + j * 0.16 + tr() * 0.1;
		if (g <= born) continue;
		truss(bag, { seed, key: j, at: crown, born, g, bear: tr() * Math.PI * 2, tilt: between(tr, 0.35, 0.75), vigour, space });
	}

	// the runner: a stolon along the soil, a daughter plant rooting at its end
	if (g > 5.05) runner(bag, seed, crown, g, vigour);

	return bag.build();
}

/** the leaflet's outline: broadest above the middle, wedge-shaped at its base, toothed from a third of the way out */
function leaflet(/** @type {number} */ u) {
	const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.72);
	const tooth = u > 0.3 && u < 0.97 ? ((u * 13) % 1) * 0.11 : 0;
	return body * (1 + tooth);
}

/**
 * A strawberry leaf: a long hairy stalk, reddish at its foot, and three leaflets at its top, folded along their
 * midribs while young, then spread flat and pleated.
 * @param {Bag} bag
 * @param {{ seed: string, key: (string | number)[], at: THREE.Vector3, size: number, bear: number, tilt: number, grown: number, wither: number, scale: number }} o
 */
function trifoliate(bag, o) {
	const lr = chance(o.seed, ...o.key, 'shape');
	const len = 0.14 * o.size * o.scale * lerp(0.25, 1, o.grown);
	const droop = between(lr, 0.15, 0.45) + o.wither * 0.8;
	// the stalk: up and out, bowing outward under the leaf's weight
	const pts = [];
	let d = heading(o.tilt, o.bear);
	let p = o.at.clone();
	const out = v3(Math.cos(o.bear), 0, Math.sin(o.bear));
	const steps = 10;
	for (let k = 0; k <= steps; k++) {
		pts.push(p.clone());
		d = d.clone().addScaledVector(out, (droop * 0.12 * k) / steps).addScaledVector(v3(0, -1, 0), (droop * 0.06 * k) / steps).normalize();
		p = p.clone().addScaledVector(d, len / steps);
	}
	const top = pts[steps];
	const rad = (0.0005 + 0.0007 * o.size) * o.scale;
	const brown = o.wither;
	bag.add('body', tube(pts, (u) => rad * (1 - 0.3 * u), (u) => mix(mix('#8a3b2c', '#6f9a3a', clamp(u * 3)), '#a8743a', brown), 5));

	// the leaflets: held about level, the middle one straight on, the two side ones turned off it
	const leafLen = 0.072 * o.size * o.scale * lerp(0.3, 1, o.grown);
	const fold = (1 - o.grown) * 0.95 + 0.06 + o.wither * 0.3;
	const pitch = lerp(1.1, between(lr, -0.05, 0.25), o.grown) - o.wither * 0.6;
	const young = 1 - clamp(o.grown * 1.3);
	for (const k of [-1, 0, 1]) {
		const turn = o.bear + k * between(lr, 0.85, 1.05);
		const horiz = v3(Math.cos(turn), 0, Math.sin(turn));
		const dir = horiz.multiplyScalar(Math.cos(pitch)).add(v3(0, Math.sin(pitch), 0)).normalize();
		const l = leafLen * (k === 0 ? 1 : 0.92);
		const blade = sheet({
			length: l,
			width: l * 0.42,
			shape: leaflet,
			lift: (u, v) => fold * Math.abs(v) * 0.32 - 0.07 * u * u - 0.012 * Math.abs(Math.sin(u * Math.PI * 9)) * Math.abs(v),
			paint: (u, v) => {
				const vein = Math.abs(v) < 0.08 ? 0.45 : Math.abs(Math.sin(u * Math.PI * 9)) < 0.15 && Math.abs(v) < 0.8 ? 0.15 : 0;
				const green = mix(mix('#2f6a26', '#6aa846', young), '#a9cf7c', vein);
				return o.wither ? green.lerp(mix('#c4542e', '#d1a43a', u), clamp(o.wither * 1.4)) : green;
			},
			along: 52,
			across: 6
		});
		const at = top.clone().addScaledVector(horiz, k === 0 ? 0.004 * o.size : 0.001);
		bag.add('sheet', blade, aim(at, dir));
	}
}

/**
 * A truss: a stalk from the crown that forks into a few flowers, the first and largest opening first; each flower
 * sheds its petals and swells into a berry, its stalk bowing over as the berry grows heavy.
 * @param {Bag} bag
 * @param {{ seed: string, key: number, at: THREE.Vector3, born: number, g: number, bear: number, tilt: number, vigour: number, space: Space }} o
 */
function truss(bag, o) {
	const tr = chance(o.seed, 'truss-shape', o.key);
	const g = o.g;
	const grown = clamp((g - o.born) / 0.6);
	// the weight of its berries bows it down
	const heavy = span(g, o.born + 0.9, o.born + 1.6);
	const len = 0.13 * o.vigour * lerp(0.3, 1, grown) * about(tr, 1, 0.15);
	const out = v3(Math.cos(o.bear), 0, Math.sin(o.bear));
	let d = heading(o.tilt + heavy * 0.5, o.bear);
	let p = o.at.clone();
	const pts = [];
	const steps = 10;
	for (let k = 0; k <= steps; k++) {
		pts.push(p.clone());
		d = d.clone().addScaledVector(out, 0.03 + heavy * 0.07).addScaledVector(v3(0, -1, 0), heavy * 0.09 * (k / steps)).normalize();
		p = p.clone().addScaledVector(d, len / steps);
		p.y = Math.max(p.y, 0.004);
	}
	bag.add('body', tube(pts, (u) => 0.0014 * (1 - 0.35 * u), (u) => mix('#7e3a2a', '#7aa040', clamp(u * 2.5)), 5));
	const fork = pts[steps];
	const tip = pts[steps].clone().sub(pts[steps - 1]).normalize();

	const flowers = 3 + Math.floor(tr() * 3);
	for (let k = 0; k < flowers; k++) {
		const fr = chance(o.seed, 'flower', o.key, k);
		const opens = o.born + 0.3 + k * 0.1 + fr() * 0.05;
		const big = k === 0 ? 1 : k < 3 ? 0.78 : 0.6;
		const spread = k === 0 ? 0 : between(fr, 0.5, 1.0);
		const side = new THREE.Vector3().crossVectors(tip, v3(0, 1, 0)).normalize().applyAxisAngle(tip, fr() * Math.PI * 2);
		// its own stalk off the fork
		const pdir = tip.clone().applyAxisAngle(side, spread).normalize();
		const plen = (k === 0 ? 0.025 : 0.04) * lerp(0.4, 1, grown);
		const fruitT = span(g, opens + 0.5, opens + 1.4);
		const hang = clamp(span(g, opens + 0.35, opens + 0.9) * 1.1);
		const ppts = [];
		let pd = pdir.clone();
		let pp = fork.clone();
		for (let m = 0; m <= 6; m++) {
			ppts.push(pp.clone());
			pd = pd.clone().lerp(v3(0, -1, 0), hang * 0.18).normalize();
			pp = pp.clone().addScaledVector(pd, plen / 6);
			pp.y = Math.max(pp.y, 0.005);
		}
		bag.add('body', tube(ppts, () => 0.0007 * big, () => '#7fa548', 4));
		const end = ppts[6];
		const facing = ppts[6].clone().sub(ppts[5]).normalize();
		if (g < opens) {
			// a bud: a green ball in its sepals
			const b = clamp((g - o.born) / (opens - o.born));
			bag.add('body', bead(end.clone().addScaledVector(facing, 0.002), v3(1, 1, 1).multiplyScalar(0.0015 + 0.0025 * b * big), mix('#7fae4a', '#dfe6c0', b * 0.5)));
		} else if (g < opens + 0.55 || fruitT <= 0.02) {
			bloom(bag, FLOWER, end, facing, big, clamp((g - opens) / 0.2), span(g, opens + 0.35, opens + 0.55));
		} else {
			// it hangs, unless it would hang into the soil: then it lies along it
			const dir = facing.clone().lerp(v3(0, -1, 0), 0.75 + hang * 0.2).normalize();
			const room = (end.y - 0.002) / (0.036 * big * o.vigour);
			if (-dir.y > room) {
				const flat = v3(dir.x, 0, dir.z);
				if (flat.lengthSq() < 1e-6) flat.copy(side);
				flat.normalize().multiplyScalar(Math.sqrt(1 - Math.max(0, room) ** 2));
				dir.set(flat.x, -Math.max(0, room), flat.z).normalize();
			}
			// and where it touches no other berry
			const L = 0.036 * big * o.vigour * lerp(0.18, 1, fruitT);
			const place = o.space.settle(end, dir, (a, d) => [{ c: a.clone().addScaledVector(d, L * 0.42), r: L * 0.46 }], 0.012);
			if (place.at.distanceTo(end) > 1e-5) bag.add('body', tube([end, place.at], () => 0.0007 * big, () => '#7fa548', 4));
			berry(bag, { seed: o.seed, key: [o.key, k], at: place.at, dir: place.dir, size: big * o.vigour, grown: fruitT, ripe: span(g, opens + 1.4, opens + 2.0) });
		}
	}
}

/** a strawberry flower: five white round petals, the green sepals behind them, a yellow cushion of pistils ringed by the stamens */
const FLOWER = { petals: 5, length: 0.012, width: 0.0062, colour: '#f3efe2', heart: '#d9cf47' };

/**
 * A berry: the swollen receptacle hanging from its green calyx, its achenes (the true seeds) on the outside. It
 * grows green, turns white, then red from the tip up.
 * @param {Bag} bag
 * @param {{ seed: string, key: (string | number)[], at: THREE.Vector3, dir: THREE.Vector3, size: number, grown: number, ripe: number }} o
 */
function berry(bag, o) {
	const br = chance(o.seed, 'berry', ...o.key);
	const L = 0.036 * o.size * lerp(0.18, 1, o.grown) * about(br, 1, 0.1);
	const R = L * between(br, 0.42, 0.52);
	const bend = about(br, 0, 0.08);
	// its shape: a rounded shoulder under the calyx, broadest a third down, tapering to a blunt tip
	const radius = (/** @type {number} */ u) => R * Math.pow(Math.sin(Math.PI * Math.min(1, 0.16 + u * 0.84)), 0.62) * (1 - 0.3 * u) * Math.pow(clamp(u / 0.06), 0.5);
	const q = new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir.clone().normalize());
	const m = new THREE.Matrix4().compose(o.at, q, v3(1, 1, 1));
	/** @type {THREE.Vector3[]} */
	const axis = [];
	for (let k = 0; k <= 16; k++) {
		const u = k / 16;
		axis.push(v3(bend * L * u * u, -u * L, 0));
	}
	const colour = (/** @type {number} */ u) => {
		const here = clamp(o.ripe * 1.7 - (1 - u) * 0.7);
		return here < 0.4 ? mix('#9cc25a', '#eeead0', here / 0.4) : mix('#eeead0', '#c4142b', (here - 0.4) / 0.6);
	};
	bag.add('gloss', tube(axis, radius, (u) => colour(u), 14), m);
	// the achenes, set into its skin in a spiral
	const n = Math.round(60 + 90 * o.size);
	for (let k = 0; k < n; k++) {
		const u = 0.1 + 0.86 * ((k + 0.5) / n);
		const a = k * 2.39996;
		const at = v3(bend * L * u * u + Math.cos(a) * radius(u) * 0.98, -u * L, Math.sin(a) * radius(u) * 0.98);
		const s = Math.max(0.00035, L * 0.018);
		bag.add('body', bead(at, v3(s, s * 1.3, s), o.ripe > 0.5 ? '#c99a32' : mix('#8fb04a', '#e2c34a', o.ripe * 2), 2), m);
	}
	// the calyx: a green star of sepals over the shoulder, curling back as it ripens
	for (let k = 0; k < 10; k++) {
		const sepal = sheet({ length: (k % 2 ? 0.007 : 0.01) * o.size, width: 0.002 * o.size, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.6)) * (1 - u * 0.5), lift: (u) => 0.12 * u + o.ripe * 0.25 * u * u, paint: (u) => mix('#4f7f2c', '#6f9c3e', u), along: 6, across: 2 });
		bag.add('sheet', sepal, m.clone().multiply(new THREE.Matrix4().makeRotationY((k / 10) * Math.PI * 2)).multiply(new THREE.Matrix4().makeRotationZ(-0.35 - o.grown * 0.4)));
	}
}

/**
 * A runner: a thin reddish stolon arching out along the soil, and at its end a daughter plant putting down roots.
 * @param {Bag} bag @param {string} seed @param {THREE.Vector3} crown @param {number} g @param {number} vigour
 */
function runner(bag, seed, crown, g, vigour) {
	const rr = chance(seed, 'runner');
	const bear = rr() * Math.PI * 2;
	const grown = span(g, 5.05, 5.85);
	const reach = 0.3 * vigour * grown;
	const out = v3(Math.cos(bear), 0, Math.sin(bear));
	const side = v3(-out.z, 0, out.x);
	const wiggle = about(rr, 0, 0.12);
	const pts = [];
	for (let k = 0; k <= 16; k++) {
		const u = k / 16;
		const p = crown.clone().addScaledVector(out, u * reach).addScaledVector(side, Math.sin(u * Math.PI) * wiggle * reach);
		p.y = crown.y + Math.sin(u * Math.PI) * 0.035 * grown * (1 - u * 0.4) + (0.003 - crown.y) * u;
		pts.push(p);
	}
	bag.add('body', tube(pts, () => 0.0011, (u) => mix('#9c3f33', '#b4593f', u), 5));
	const end = pts[16];
	const daughter = span(g, 5.5, 6);
	if (daughter <= 0) {
		bag.add('body', bead(end, v3(1, 1, 1).multiplyScalar(0.002), '#7f9a44'));
		return;
	}
	bag.add('body', bead(end, v3(1, 1.2, 1).multiplyScalar(0.0025 + 0.002 * daughter), '#7e8a40'));
	for (let i = 0; i < 3; i++) {
		if (daughter < i * 0.3) break;
		trifoliate(bag, { seed, key: ['daughter', i], at: end, size: 0.35, bear: bear + i * 2.4, tilt: 0.3, grown: clamp((daughter - i * 0.3) / 0.6), wither: 0, scale: 0.8 });
	}
	for (let i = 0; i < 5; i++) {
		const a = (i / 5) * Math.PI * 2;
		root(bag, { seed, key: ['daughter', i], from: end.clone().add(v3(0, -0.001, 0)), dir: v3(Math.cos(a) * 0.4, -1, Math.sin(a) * 0.4), length: 0.04, grown: daughter, radius: 0.0007, laterals: 3, depth: 1, young: '#f6efdc', old: '#c79d6c' });
	}
}
