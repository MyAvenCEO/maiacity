/*
 * FROZEN — the excavator as it was at v2 (6 October 2026): the mini excavator scaled up to twice its size, its bucket
 * turned round. Kept so a world built on `excavator@2` still gets it; the excavators today are ./excavator.js (the
 * mini) and ./crawler-excavator.js (the 14-tonne crawler).
 *
 * THE EXCAVATOR — the digger the crew builds the settlement with (Sandbox 1). Its parts are measured as a 1.7-tonne
 * mini excavator's and the whole machine is shown at twice that (`SCALE`): rubber tracks 3.1 m long on an
 * undercarriage 2 m wide, a dozer blade at the front, the house on its slewing ring with an open canopy over the seat,
 * the counterweight behind, and the digging arm — a swinging boom bracket, a bent boom, the arm (the dipper) and an
 * 80 cm backhoe bucket, its mouth and four teeth turned towards the machine. About 7.8 m reach, 4.4 m digging depth,
 * 4.6 m to the canopy.
 *
 * Rigged as every actor is (./rig.ts): a skeleton of joints under one skinned mesh, every part riding its joint
 * rigidly, as a machine's parts do. The joints: `base` (the undercarriage), `blade`, the four wheels `sprocketL/R`
 * and `idlerL/R`, `house` (slews about y), `swing` (the boom bracket, about y), `boom`, `arm` and `bucket` (each
 * about x: forward and down is positive). Each hydraulic cylinder is two joints — its barrel on one part, its rod on
 * the other — and `machine()` turns them every pose so barrel and rod stay on the line between their pins: the rams
 * slide in and out as the arm works.
 *
 * Built in its rest pose, facing +z, its tracks on y 0. Its moves: dig (a cycle: reach out, curl a bucketful in,
 * lift, slew, dump, slew back), drive (the wheels turning, the arm tucked), doze (the blade down and up), idle.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { limb, loop, rig, skin } from './rig';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Pose} Pose */
/** @typedef {import('./rig').Piece} Piece */
/** @typedef {import('./rig').Cast} Cast */

const PAINT = '#f0a90f', DARK = '#2b2c2e', STEEL = '#8c9094', RUBBER = '#1d1e20', CHROME = '#d8d8d6', SEAT = '#3a3b3d';

/* where its joints are in the rest pose: the digging arm in the y–z plane, the boom raised, the bucket hanging */
/** @type {Record<string, V3>} */
const J = {
	base: [0, 0.3, 0],
	blade: [0, 0.32, 0.62],
	house: [0, 0.48, 0],
	swing: [0, 0.68, 0.62],
	boom: [0, 0.78, 0.74],
	arm: [0, 2.05, 1.72],
	bucket: [0, 1.02, 2.18]
};
/** the cylinders' pins: barrel end (on the first part) and rod end (on the second) */
/** @type {Record<string, { a: V3, b: V3, on: [string, string], r: number }>} */
const RAMS = {
	boomRam: { a: [0, 0.6, 0.82], b: [0, 1.45, 1.12], on: ['swing', 'boom'], r: 0.05 },
	armRam: { a: [0, 1.75, 1.05], b: [0, 2.32, 1.78], on: ['boom', 'arm'], r: 0.045 },
	bucketRam: { a: [0, 2.05, 1.86], b: [0, 1.18, 2.36], on: ['arm', 'bucket'], r: 0.04 }
};
const SIDES = /** @type {const} */ ([['L', 1], ['R', -1]]);
const TRACK_X = 0.37, TRACK_W = 0.25, TRACK_L = 1.55, WHEEL = 0.17;
/** how much bigger than the mini it is built as: twice, every measure */
export const SCALE = 2;

/** a box w × h × len from a to b (len its length), its other sides across, turned along the line */
/** @param {V3} a @param {V3} b @param {number} w @param {number} h @param {number} [r] */
function beam(a, b, w, h, r = 0.02) {
	const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
	const g = new RoundedBoxGeometry(w, h, A.distanceTo(B), 2, r);
	g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize()), new THREE.Vector3(1, 1, 1)));
	return g;
}
/** a box at a place */
/** @param {number} w @param {number} h @param {number} d @param {V3} at @param {number} [r] */
function block(w, h, d, at, r = 0.02) {
	const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
	g.translate(...at);
	return g;
}
/** a wheel turning about x: radius r, width w, at */
/** @param {number} r @param {number} w @param {V3} at */
function wheel(r, w, at) {
	const g = new THREE.CylinderGeometry(r, r, w, 18);
	g.rotateZ(Math.PI / 2);
	g.translate(...at);
	return g;
}

/** The bucket: a curled back plate between two side plates, four teeth along its lip, its pins at the top. */
/** @returns {Piece[]} */
function bucketParts() {
	const [, py, pz] = J.bucket;
	const cy = py - 0.24, cz = pz + 0.04, R = 0.24, w = 0.4;
	/** @type {Piece[]} */
	const out = [];
	/** a point on the curl, φ from up (0) through out (π/2, away from the cab) to down (π) and on round under it: a
	 *  backhoe's bucket, its back to the outside and its mouth and teeth towards the machine @param {number} phi
	 *  @param {number} [r] @returns {V3} */
	const at = (phi, r = R) => [0, cy + Math.cos(phi) * r, cz + Math.sin(phi) * r];
	const n = 9, from = -0.15, to = Math.PI + 0.55;
	for (let i = 0; i < n; i++) {
		const p0 = at(from + ((to - from) * i) / n), p1 = at(from + ((to - from) * (i + 1)) / n);
		out.push({ geo: beam(p0, p1, w, 0.025, 0.006), color: DARK, bone: 'bucket' });
	}
	// the side plates: a fan of the curl, one each side
	for (const sx of [-1, 1]) {
		const shape = new THREE.Shape();
		shape.moveTo(0, 0);
		for (let i = 0; i <= n; i++) {
			const phi = from + ((to - from) * i) / n;
			shape.lineTo(Math.sin(phi) * R, Math.cos(phi) * R);
		}
		shape.lineTo(0, 0);
		const g = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false });
		g.rotateY(-Math.PI / 2); // the shape's x along z, its extrusion along −x
		g.translate(sx * (w / 2) + (sx > 0 ? 0.015 : 0), cy, cz);
		out.push({ geo: g, color: DARK, bone: 'bucket' });
	}
	// the teeth carry on round the curl from its lip
	const lip = at(to), along = new THREE.Vector3(0, -Math.sin(to), Math.cos(to));
	const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
	for (let k = 0; k < 4; k++) {
		const x = -0.15 + k * 0.1;
		const tooth = new THREE.ConeGeometry(0.025, 0.09, 6);
		tooth.translate(0, 0.045, 0);
		tooth.applyQuaternion(aim);
		tooth.translate(x, lip[1], lip[2]);
		out.push({ geo: tooth, color: STEEL, bone: 'bucket' });
	}
	// the ears its pins go through
	for (const sx of [-1, 1]) out.push({ geo: beam([sx * 0.09, py + 0.03, pz - 0.04], [sx * 0.09, RAMS.bucketRam.b[1], RAMS.bucketRam.b[2]], 0.03, 0.12, 0.01), color: DARK, bone: 'bucket' });
	return out;
}

/** Every part, riding its joint. */
/** @returns {Piece[]} */
function parts() {
	/** @type {Piece[]} */
	const out = [];
	/** @param {THREE.BufferGeometry} geo @param {string} color @param {string} bone */
	const add = (geo, color, bone) => out.push({ geo, color, bone });

	// the undercarriage: the frame, two rubber tracks round a sprocket (back), an idler (front) and rollers
	add(block(0.5, 0.2, 1.1, [0, 0.3, 0]), DARK, 'base');
	add(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 28).translate(0, 0.44, 0), DARK, 'base'); // the slewing ring
	for (const [s, x] of SIDES) {
		const tx = x * TRACK_X;
		add(block(TRACK_W * 0.6, 0.14, TRACK_L - 0.4, [tx, 0.2, 0]), DARK, 'base');
		// the belt: top run, bottom run, wrapped round the ends
		add(block(TRACK_W, 0.05, TRACK_L - 2 * WHEEL, [tx, 2 * WHEEL + 0.005, 0]), RUBBER, 'base');
		add(block(TRACK_W, 0.05, TRACK_L - 2 * WHEEL, [tx, 0.025, 0]), RUBBER, 'base');
		for (const ez of [-1, 1]) {
			const g = new THREE.CylinderGeometry(WHEEL + 0.03, WHEEL + 0.03, TRACK_W, 20, 1, true, ez > 0 ? 0 : Math.PI, Math.PI);
			g.rotateZ(Math.PI / 2);
			g.translate(tx, WHEEL + 0.005, ez * (TRACK_L / 2 - WHEEL));
			add(g, RUBBER, 'base');
		}
		// the lugs across the belt, top and bottom
		for (let i = 0; i < 10; i++) {
			const z = -TRACK_L / 2 + WHEEL + 0.03 + i * ((TRACK_L - 2 * WHEEL - 0.06) / 9);
			add(block(TRACK_W, 0.025, 0.04, [tx, 0.0, z], 0.005), RUBBER, 'base');
			add(block(TRACK_W, 0.025, 0.04, [tx, 2 * WHEEL + 0.035, z], 0.005), RUBBER, 'base');
		}
		for (const [w, ez] of /** @type {const} */ ([['sprocket', -1], ['idler', 1]])) {
			const z = ez * (TRACK_L / 2 - WHEEL);
			add(wheel(WHEEL - 0.01, TRACK_W * 0.7, [tx, WHEEL + 0.005, z]), STEEL, `${w}${s}`);
			// spokes, so the turning shows
			for (let k = 0; k < 3; k++) {
				const a = (k * Math.PI) / 3;
				add(spoke(tx + x * TRACK_W * 0.36, WHEEL + 0.005, z, a), DARK, `${w}${s}`);
			}
		}
		for (const z of [-0.3, 0, 0.3]) add(wheel(0.06, TRACK_W * 0.5, [tx, 0.09, z]), STEEL, 'base');
	}
	// the dozer blade on its two arms
	add(block(0.99, 0.3, 0.05, [0, 0.2, 0.98], 0.01), PAINT, 'blade');
	add(block(0.99, 0.02, 0.06, [0, 0.05, 1.0], 0.005), STEEL, 'blade');
	for (const sx of [-1, 1]) add(beam([sx * 0.2, 0.32, 0.62], [sx * 0.25, 0.25, 0.96], 0.07, 0.1), PAINT, 'blade');
	add(limb([0, 0.38, 0.58], [0, 0.3, 0.9], 0.035, 0.03), CHROME, 'blade');

	// the house: deck, engine hood and counterweight behind, the seat and canopy, the boom bracket at the front
	add(block(1.0, 0.1, 1.15, [0, 0.55, -0.05]), DARK, 'house');
	add(block(0.98, 0.5, 0.55, [0, 0.85, -0.33], 0.08), PAINT, 'house');
	const cw = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 32, 1, false, Math.PI * 0.72, Math.PI * 0.56);
	cw.translate(0, 0.81, -0.05);
	add(cw, DARK, 'house');
	add(block(0.9, 0.06, 0.6, [0, 0.62, 0.3]), DARK, 'house'); // the floor plate
	add(block(0.48, 0.1, 0.45, [0.05, 0.98, 0.05], 0.04), SEAT, 'house');
	add(block(0.48, 0.5, 0.1, [0.05, 1.25, -0.16], 0.05), SEAT, 'house');
	for (const sx of [-1, 1]) {
		add(block(0.12, 0.25, 0.35, [0.05 + sx * 0.3, 0.85, 0.18], 0.03), DARK, 'house'); // the lever consoles
		add(limb([0.05 + sx * 0.3, 0.97, 0.25], [0.05 + sx * 0.3, 1.15, 0.28], 0.012, 0.012), DARK, 'house');
		add(new THREE.SphereGeometry(0.03, 10, 8).translate(0.05 + sx * 0.3, 1.17, 0.28), DARK, 'house');
	}
	for (const [px, pz] of [[-0.42, -0.5], [0.42, -0.5], [-0.42, 0.42], [0.42, 0.42]]) add(limb([px, 0.6, pz], [px, 2.25, pz], 0.03, 0.03), DARK, 'house');
	add(block(0.98, 0.06, 1.05, [0, 2.28, -0.04], 0.03), DARK, 'house'); // the canopy roof
	add(limb([0.36, 1.05, -0.62], [0.36, 1.35, -0.62], 0.025, 0.02), DARK, 'house'); // the exhaust
	add(block(0.04, 0.04, 0.02, [-0.36, 2.22, 0.45], 0.01), '#ffd27a', 'house'); // the work light
	add(block(0.34, 0.36, 0.3, [0, 0.72, 0.62], 0.03), PAINT, 'swing'); // the swing bracket
	add(beam([0, 0.6, 0.62], [0, 0.6, 0.85], 0.2, 0.12), DARK, 'swing');

	// the boom: bent, a box section; the arm; their pins
	const knee = /** @type {V3} */ ([0, 1.85, 1.25]);
	add(beam(J.boom, knee, 0.2, 0.26), PAINT, 'boom');
	add(beam(knee, J.arm, 0.2, 0.22), PAINT, 'boom');
	add(beam([0, 1.65, 1.0], RAMS.armRam.a, 0.12, 0.12), PAINT, 'boom');
	add(wheel(0.07, 0.26, J.arm), STEEL, 'boom');
	add(beam([0, 2.35, 1.65], J.bucket, 0.16, 0.2), PAINT, 'arm');
	add(beam(J.arm, RAMS.armRam.b, 0.16, 0.12), PAINT, 'arm');
	add(wheel(0.06, 0.24, J.bucket), STEEL, 'arm');
	add(beam([0, 2.3, 1.72], RAMS.bucketRam.a, 0.1, 0.1), PAINT, 'arm');
	out.push(...bucketParts());

	// the rams: a barrel on one part, a rod on the other, each reaching most of the way to the other pin
	for (const [name, ram] of Object.entries(RAMS)) {
		const A = new THREE.Vector3(...ram.a), B = new THREE.Vector3(...ram.b);
		const len = A.distanceTo(B);
		const dir = B.clone().sub(A).normalize();
		const barrelEnd = A.clone().addScaledVector(dir, len * 0.62);
		const rodEnd = B.clone().addScaledVector(dir, -len * 0.75);
		add(limb(ram.a, /** @type {V3} */ (barrelEnd.toArray()), ram.r, ram.r), PAINT, `${name}Barrel`);
		add(limb(ram.b, /** @type {V3} */ (rodEnd.toArray()), ram.r * 0.5, ram.r * 0.5), CHROME, `${name}Rod`);
	}
	return out;
}

/** a spoke across a wheel at x, y, z, turned `a` about x */
/** @param {number} x @param {number} y @param {number} z @param {number} a */
function spoke(x, y, z, a) {
	const g = new THREE.BoxGeometry(0.02, (WHEEL - 0.02) * 2, 0.035);
	g.rotateX(a);
	g.translate(x, y, z);
	return g;
}

/* ── the arm's geometry, in its plane: a point (y, z), angles about x (forward and down positive) ── */

/** @param {number} th @param {number} y @param {number} z @returns {[number, number]} */
const rot = (th, y, z) => [y * Math.cos(th) - z * Math.sin(th), y * Math.sin(th) + z * Math.cos(th)];
/** the angle of (y, z) the way a turn about x counts it */
/** @param {number} y @param {number} z */
const ang = (y, z) => Math.atan2(z, y);

/**
 * Where the arm's points are with the boom, arm and bucket turned so (in the swing bracket's frame), and how the
 * rams' barrels and rods must turn to stay on their pins.
 * @param {number} boom @param {number} arm @param {number} bucket
 * @returns {Pose}
 */
function rams(boom, arm, bucket) {
	/** a point riding a part, where it is now @param {string} part @param {V3} p @returns {[number, number]} */
	const place = (part, p) => {
		if (part === 'swing') return [p[1], p[2]];
		const steps = /** @type {[string, number][]} */ ([['boom', boom], ['arm', arm], ['bucket', bucket]]);
		let y = p[1], z = p[2];
		// unwind outwards in: the deepest part's turn first, about its joint, then each parent's
		const upTo = steps.findIndex(([n]) => n === part);
		for (let i = upTo; i >= 0; i--) {
			const [n] = steps[i];
			const j = J[n];
			const total = steps[i][1];
			[y, z] = rot(total, y - j[1], z - j[2]);
			y += j[1];
			z += j[2];
		}
		return [y, z];
	};
	/** how far a part is turned in all (its parents' turns and its own) @param {string} part */
	const turned = (part) => (part === 'swing' ? 0 : part === 'boom' ? boom : part === 'arm' ? boom + arm : boom + arm + bucket);
	/** @type {Pose} */
	const out = {};
	for (const [name, ram] of Object.entries(RAMS)) {
		const [on0, on1] = ram.on;
		const a = place(on0, ram.a), b = place(on1, ram.b);
		const rest = ang(ram.b[1] - ram.a[1], ram.b[2] - ram.a[2]);
		const now = ang(b[0] - a[0], b[1] - a[1]);
		out[`${name}Barrel`] = [now - rest - turned(on0), 0, 0];
		out[`${name}Rod`] = [now - rest - turned(on1), 0, 0];
	}
	return out;
}

/**
 * The machine at its joints' turns: how far the house is slewed and the boom swung (about y), the boom, arm and
 * bucket (about x), the blade, how far the wheels have turned; the rams follow.
 * @param {{ slew?: number, swing?: number, boom?: number, arm?: number, bucket?: number, blade?: number, wheels?: number, root?: V3 }} s
 * @returns {Pose}
 */
export function machine({ slew = 0, swing = 0, boom = 0, arm = 0, bucket = 0, blade = 0, wheels = 0, root }) {
	/** @type {Pose} */
	const p = {
		house: [0, slew, 0],
		swing: [0, swing, 0],
		boom: [boom, 0, 0],
		arm: [arm, 0, 0],
		bucket: [bucket, 0, 0],
		blade: [blade, 0, 0],
		...rams(boom, arm, bucket)
	};
	for (const [s] of SIDES) for (const w of ['sprocket', 'idler']) p[`${w}${s}`] = [wheels, 0, 0];
	if (root) p.root = root;
	return p;
}

/** smoothly from 0 to 1 */
/** @param {number} x */
const ease = (x) => x * x * (3 - 2 * x);
/**
 * Between key poses (each at its time in the cycle, 0…1), eased.
 * @param {[number, Parameters<typeof machine>[0]][]} keys @param {number} u
 */
function through(keys, u) {
	let i = 0;
	while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
	const [t0, a] = keys[i], [t1, b] = keys[i + 1];
	const k = ease(Math.min(1, Math.max(0, (u - t0) / (t1 - t0))));
	/** @type {Record<string, number>} */
	const mix = {};
	for (const name of ['slew', 'swing', 'boom', 'arm', 'bucket', 'blade']) {
		const x = /** @type {Record<string, number>} */ (a)[name] ?? 0, y = /** @type {Record<string, number>} */ (b)[name] ?? 0;
		mix[name] = x + (y - x) * k;
	}
	return mix;
}

/* the poses it works between */
const TUCKED = { boom: -0.35, arm: -0.55, bucket: -1.2, blade: -0.25 };
const REACH = { boom: 0.55, arm: 0.6, bucket: -1.6, blade: 0.08 };
const CURLED = { boom: 0.62, arm: -0.35, bucket: 0.55, blade: 0.08 };
const LIFTED = { boom: -0.2, arm: -0.4, bucket: 0.6, blade: 0.08 };

/** Build the mini excavator and its moves. @returns {Cast} */
export function excavator() {
	/** @type {import('./rig').BoneSpec[]} */
	const bones = [
		{ name: 'base', at: J.base },
		{ name: 'blade', parent: 'base', at: J.blade },
		...SIDES.flatMap(([s, x]) => [
			{ name: `sprocket${s}`, parent: 'base', at: /** @type {V3} */ ([x * TRACK_X, WHEEL + 0.005, -(TRACK_L / 2 - WHEEL)]) },
			{ name: `idler${s}`, parent: 'base', at: /** @type {V3} */ ([x * TRACK_X, WHEEL + 0.005, TRACK_L / 2 - WHEEL]) }
		]),
		{ name: 'house', parent: 'base', at: J.house },
		{ name: 'swing', parent: 'house', at: J.swing },
		{ name: 'boom', parent: 'swing', at: J.boom },
		{ name: 'arm', parent: 'boom', at: J.arm },
		{ name: 'bucket', parent: 'arm', at: J.bucket },
		...Object.entries(RAMS).flatMap(([name, ram]) => [
			{ name: `${name}Barrel`, parent: ram.on[0], at: ram.a },
			{ name: `${name}Rod`, parent: ram.on[1], at: ram.b }
		])
	];
	const r = rig(bones, parts(), [skin(0.5, { side: THREE.DoubleSide })]);
	r.object.name = 'excavator';
	r.object.scale.setScalar(SCALE); // built at the mini's measure, shown at twice it

	/** @type {Record<string, import('./rig').Clip>} */
	const clips = {
		dig: (t) => {
			const u = loop(t, 9);
			return machine(
				through(
					[
						[0, { ...LIFTED }],
						[0.14, { ...REACH }],
						[0.3, { ...CURLED }],
						[0.42, { ...LIFTED }],
						[0.58, { ...LIFTED, slew: 1.4 }],
						[0.7, { ...LIFTED, slew: 1.4, bucket: -1.4, arm: 0.1 }],
						[0.82, { ...LIFTED, slew: 1.4 }],
						[1, { ...LIFTED }]
					],
					u
				)
			);
		},
		drive: (t) => machine({ ...TUCKED, wheels: -t * 3.2, root: [0, Math.sin(t * 9) * 0.004, 0] }),
		doze: (t) => {
			// push 1.2 m forward with the blade down, lift it, back up
			const u = loop(t, 6);
			const dist = 1.2 * (u < 0.5 ? ease(u * 2) : ease(2 - u * 2));
			const blade = u < 0.45 ? 0.03 : u < 0.55 ? 0.03 - 0.28 * ease((u - 0.45) * 10) : u < 0.95 ? -0.25 : -0.25 + 0.28 * ease((u - 0.95) * 20);
			return machine({ ...TUCKED, blade, wheels: -dist / WHEEL, root: [0, 0, dist] });
		},
		idle: (t) => machine({ ...LIFTED, root: [0, Math.sin(t * 40) * 0.002, 0] })
	};
	/** @type {Record<string, Pose>} */
	const poses = { tucked: machine(TUCKED), reaching: machine(REACH), curled: machine(CURLED), rest: machine({}) };
	return { rig: r, clips, poses, first: 'dig' };
}
