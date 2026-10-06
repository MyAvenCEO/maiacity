/*
 * THE EXCAVATORS' RIG — what every tracked excavator is rigged and moved with, whatever its size: the mini
 * (./excavator.js) and the 14-tonne crawler (./crawler-excavator.js) are each a spec of where their joints and
 * cylinder pins are, their parts, and the poses they dig between; this file turns a spec into an actor (./rig.ts).
 *
 * The joints: `base` (the undercarriage), `blade` (if it has one), the wheels `sprocketL/R` and `idlerL/R`, `house`
 * (slews about y), `swing` (a mini's boom bracket, about y; on a bigger machine it stays put), `boom`, `arm` and
 * `bucket` (each about x: forward and down is positive). Each hydraulic cylinder is two joints — its barrel on one
 * part, its rod on the other — turned every pose so barrel and rod stay on the line between their pins.
 *
 * Built in the rest pose, facing +z, the tracks on y 0. Its moves: dig (reach out, curl a bucketful in, lift, slew,
 * dump, slew back), drive (the wheels turning, the arm tucked), doze (with a blade: push forward, lift, back up), idle.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { limb, loop, rig, skin } from './rig';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Pose} Pose */
/** @typedef {import('./rig').Piece} Piece */
/** @typedef {import('./rig').Cast} Cast */
/** @typedef {{ a: V3, b: V3, on: [string, string], r: number }} Ram a cylinder: its barrel's pin on the first part, its rod's on the second */
/** @typedef {{ slew?: number, swing?: number, boom?: number, arm?: number, bucket?: number, blade?: number, wheels?: number, root?: V3 }} Joints */
/**
 * @typedef {object} Spec an excavator: its joints, its rams, its parts and how it works
 * @property {string} name
 * @property {Record<'base' | 'house' | 'swing' | 'boom' | 'arm' | 'bucket', V3> & { blade?: V3 }} J where its joints are at rest
 * @property {Record<string, Ram>} rams
 * @property {{ x: number, y: number, sprocket: number, idler: number, r: number }} wheels the track centres' x, the wheels' axle height, the sprocket's z (back) and the idler's (front), their radius
 * @property {() => Piece[]} parts
 * @property {{ tucked: Joints, reach: Joints, curled: Joints, lifted: Joints, dump: Joints }} poses
 * @property {number} [slew] how far it slews to dump (rad)
 * @property {number} [period] a dig cycle (s)
 * @property {number} [speed] its travelling speed (m/s)
 * @property {THREE.Material[]} [materials] beyond its skin: 1 its glass
 */

export const SIDES = /** @type {const} */ ([['L', 1], ['R', -1]]);
export const PAINT = '#f0a90f', DARK = '#2b2c2e', STEEL = '#8c9094', RUBBER = '#1d1e20', CHROME = '#d8d8d6', SEAT = '#3a3b3d';

/** a box w × h × len from a to b, turned along the line */
/** @param {V3} a @param {V3} b @param {number} w @param {number} h @param {number} [r] */
export function beam(a, b, w, h, r = 0.02) {
	const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
	const g = new RoundedBoxGeometry(w, h, A.distanceTo(B), 2, Math.min(r, w / 2, h / 2));
	g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize()), new THREE.Vector3(1, 1, 1)));
	return g;
}
/** a box at a place */
/** @param {number} w @param {number} h @param {number} d @param {V3} at @param {number} [r] */
export function block(w, h, d, at, r = 0.02) {
	const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
	g.translate(...at);
	return g;
}
/** a wheel turning about x: radius r, width w, at */
/** @param {number} r @param {number} w @param {V3} at @param {number} [seg] */
export function wheel(r, w, at, seg = 18) {
	const g = new THREE.CylinderGeometry(r, r, w, seg);
	g.rotateZ(Math.PI / 2);
	g.translate(...at);
	return g;
}
/** a spoke across a wheel of radius r at x, y, z, turned `a` about x */
/** @param {number} r @param {number} x @param {number} y @param {number} z @param {number} a */
export function spoke(r, x, y, z, a) {
	const g = new THREE.BoxGeometry(r * 0.12, r * 1.8, r * 0.2);
	g.rotateX(a);
	g.translate(x, y, z);
	return g;
}

/**
 * A backhoe's bucket on its pivot: a curled back plate between two side plates, its back to the outside (+z) and its
 * mouth and teeth turned towards the machine, the teeth carrying on round the curl from its lip; the ears to its
 * ram's pin.
 * @param {{ pivot: V3, R: number, w: number, teeth: number, pin: V3, plate?: number }} o
 * @returns {Piece[]}
 */
export function bucketParts({ pivot, R, w, teeth, pin, plate = R * 0.06 }) {
	const [, py, pz] = pivot;
	const cy = py - R, cz = pz + R * 0.17;
	/** @type {Piece[]} */
	const out = [];
	/** a point on the curl, φ from up (0) through out (π/2) to down (π) and on round under it @param {number} phi @returns {V3} */
	const at = (phi) => [0, cy + Math.cos(phi) * R, cz + Math.sin(phi) * R];
	const n = 10, from = -0.15, to = Math.PI + 0.55;
	for (let i = 0; i < n; i++) out.push({ geo: beam(at(from + ((to - from) * i) / n), at(from + ((to - from) * (i + 1)) / n), w, plate, plate * 0.25), color: DARK, bone: 'bucket' });
	for (const sx of [-1, 1]) {
		const shape = new THREE.Shape();
		shape.moveTo(0, 0);
		for (let i = 0; i <= n; i++) {
			const phi = from + ((to - from) * i) / n;
			shape.lineTo(Math.sin(phi) * R, Math.cos(phi) * R);
		}
		shape.lineTo(0, 0);
		const g = new THREE.ExtrudeGeometry(shape, { depth: plate * 0.6, bevelEnabled: false });
		g.rotateY(-Math.PI / 2); // the shape's x along z, its extrusion along −x
		g.translate(sx * (w / 2) + (sx > 0 ? plate * 0.6 : 0), cy, cz);
		out.push({ geo: g, color: DARK, bone: 'bucket' });
	}
	const lip = at(to), along = new THREE.Vector3(0, -Math.sin(to), Math.cos(to));
	const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
	for (let k = 0; k < teeth; k++) {
		const x = -w / 2 + (w * (k + 0.5)) / teeth;
		const tooth = new THREE.ConeGeometry(R * 0.1, R * 0.38, 6);
		tooth.translate(0, R * 0.19, 0);
		tooth.applyQuaternion(aim);
		tooth.translate(x, lip[1], lip[2]);
		out.push({ geo: tooth, color: STEEL, bone: 'bucket' });
	}
	for (const sx of [-1, 1]) out.push({ geo: beam([sx * w * 0.22, py + R * 0.12, pz - R * 0.15], [sx * w * 0.22, pin[1], pin[2]], R * 0.12, R * 0.5, R * 0.04), color: DARK, bone: 'bucket' });
	return out;
}

/** The rams: a barrel on one part, a rod on the other, each reaching most of the way to the other pin. */
/** @param {Record<string, Ram>} rams @returns {Piece[]} */
export function ramParts(rams) {
	return Object.entries(rams).flatMap(([name, ram]) => {
		const A = new THREE.Vector3(...ram.a), B = new THREE.Vector3(...ram.b);
		const len = A.distanceTo(B), dir = B.clone().sub(A).normalize();
		const barrelEnd = /** @type {V3} */ (A.clone().addScaledVector(dir, len * 0.62).toArray());
		const rodEnd = /** @type {V3} */ (B.clone().addScaledVector(dir, -len * 0.75).toArray());
		return [
			{ geo: limb(ram.a, barrelEnd, ram.r, ram.r), color: PAINT, bone: `${name}Barrel` },
			{ geo: limb(ram.b, rodEnd, ram.r * 0.5, ram.r * 0.5), color: CHROME, bone: `${name}Rod` }
		];
	});
}

/* ── the arm's geometry, in its plane: a point (y, z), angles about x (forward and down positive) ── */

/** @param {number} th @param {number} y @param {number} z @returns {[number, number]} */
const rot = (th, y, z) => [y * Math.cos(th) - z * Math.sin(th), y * Math.sin(th) + z * Math.cos(th)];
/** the angle of (y, z) the way a turn about x counts it @param {number} y @param {number} z */
const ang = (y, z) => Math.atan2(z, y);

/**
 * How the rams' barrels and rods must turn to stay on their pins, the boom, arm and bucket turned so.
 * @param {Spec} spec @param {number} boom @param {number} arm @param {number} bucket @returns {Pose}
 */
function rams(spec, boom, arm, bucket) {
	const steps = /** @type {[string, number][]} */ ([['boom', boom], ['arm', arm], ['bucket', bucket]]);
	/** a point riding a part, where it is now @param {string} part @param {V3} p @returns {[number, number]} */
	const place = (part, p) => {
		let y = p[1], z = p[2];
		// the deepest part's turn first, about its joint, then each parent's
		for (let i = steps.findIndex(([n]) => n === part); i >= 0; i--) {
			const [n, th] = steps[i];
			const j = spec.J[/** @type {'boom' | 'arm' | 'bucket'} */ (n)];
			[y, z] = rot(th, y - j[1], z - j[2]);
			y += j[1];
			z += j[2];
		}
		return [y, z];
	};
	/** how far a part is turned in all @param {string} part */
	const turned = (part) => (part === 'boom' ? boom : part === 'arm' ? boom + arm : part === 'bucket' ? boom + arm + bucket : 0);
	/** @type {Pose} */
	const out = {};
	for (const [name, ram] of Object.entries(spec.rams)) {
		const [on0, on1] = ram.on;
		const a = place(on0, ram.a), b = place(on1, ram.b);
		const now = ang(b[0] - a[0], b[1] - a[1]) - ang(ram.b[1] - ram.a[1], ram.b[2] - ram.a[2]);
		out[`${name}Barrel`] = [now - turned(on0), 0, 0];
		out[`${name}Rod`] = [now - turned(on1), 0, 0];
	}
	return out;
}

/**
 * The machine at its joints' turns — the house slewed and the boom swung (about y), the boom, arm and bucket (about
 * x), the blade, the wheels — and the rams following.
 * @param {Spec} spec @param {Joints} j @returns {Pose}
 */
export function machine(spec, { slew = 0, swing = 0, boom = 0, arm = 0, bucket = 0, blade = 0, wheels = 0, root }) {
	/** @type {Pose} */
	const p = { house: [0, slew, 0], swing: [0, swing, 0], boom: [boom, 0, 0], arm: [arm, 0, 0], bucket: [bucket, 0, 0], ...rams(spec, boom, arm, bucket) };
	if (spec.J.blade) p.blade = [blade, 0, 0];
	for (const [s] of SIDES) for (const w of ['sprocket', 'idler']) p[`${w}${s}`] = [wheels, 0, 0];
	if (root) p.root = root;
	return p;
}

/** smoothly from 0 to 1 @param {number} x */
export const ease = (x) => x * x * (3 - 2 * x);
/** Between key poses (each at its time in the cycle, 0…1), eased. @param {[number, Joints][]} keys @param {number} u @returns {Joints} */
function through(keys, u) {
	let i = 0;
	while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
	const [t0, a] = keys[i], [t1, b] = keys[i + 1];
	const k = ease(Math.min(1, Math.max(0, (u - t0) / (t1 - t0))));
	/** @type {Record<string, number>} */
	const mix = {};
	for (const name of /** @type {const} */ (['slew', 'swing', 'boom', 'arm', 'bucket', 'blade'])) mix[name] = (a[name] ?? 0) + ((b[name] ?? 0) - (a[name] ?? 0)) * k;
	return mix;
}

/** Build an excavator from its spec: its skeleton, its skin, its moves. @param {Spec} spec @returns {Cast} */
export function excavatorCast(spec) {
	const { J, wheels: w } = spec;
	/** @type {import('./rig').BoneSpec[]} */
	const bones = [
		{ name: 'base', at: J.base },
		...(J.blade ? [{ name: 'blade', parent: 'base', at: J.blade }] : []),
		...SIDES.flatMap(([s, x]) => [
			{ name: `sprocket${s}`, parent: 'base', at: /** @type {V3} */ ([x * w.x, w.y, w.sprocket]) },
			{ name: `idler${s}`, parent: 'base', at: /** @type {V3} */ ([x * w.x, w.y, w.idler]) }
		]),
		{ name: 'house', parent: 'base', at: J.house },
		{ name: 'swing', parent: 'house', at: J.swing },
		{ name: 'boom', parent: 'swing', at: J.boom },
		{ name: 'arm', parent: 'boom', at: J.arm },
		{ name: 'bucket', parent: 'arm', at: J.bucket },
		...Object.entries(spec.rams).flatMap(([name, ram]) => [
			{ name: `${name}Barrel`, parent: ram.on[0], at: ram.a },
			{ name: `${name}Rod`, parent: ram.on[1], at: ram.b }
		])
	];
	const r = rig(bones, spec.parts(), [skin(0.5, { side: THREE.DoubleSide }), ...(spec.materials ?? [])]);
	r.object.name = spec.name;
	const { tucked, reach, curled, lifted, dump } = spec.poses;
	const slew = spec.slew ?? 1.4, period = spec.period ?? 9, speed = spec.speed ?? 0.6;
	/** @param {Joints} j */
	const m = (j) => machine(spec, j);
	/** @type {Record<string, import('./rig').Clip>} */
	const clips = {
		dig: (t) =>
			m(
				through(
					[
						[0, lifted],
						[0.14, reach],
						[0.3, curled],
						[0.42, lifted],
						[0.58, { ...lifted, slew }],
						[0.7, { ...dump, slew }],
						[0.82, { ...lifted, slew }],
						[1, lifted]
					],
					loop(t, period)
				)
			),
		drive: (t) => m({ ...tucked, wheels: (-t * speed) / w.r, root: [0, Math.sin(t * 9) * w.r * 0.02, 0] }),
		idle: (t) => m({ ...lifted, root: [0, Math.sin(t * 40) * 0.002, 0] })
	};
	if (J.blade)
		clips.doze = (t) => {
			// push 1.2 m forward with the blade down, lift it, back up
			const u = loop(t, 6);
			const dist = 1.2 * (u < 0.5 ? ease(u * 2) : ease(2 - u * 2));
			const blade = u < 0.45 ? 0.03 : u < 0.55 ? 0.03 - 0.28 * ease((u - 0.45) * 10) : u < 0.95 ? -0.25 : -0.25 + 0.28 * ease((u - 0.95) * 20);
			return m({ ...tucked, blade, wheels: -dist / w.r, root: [0, 0, dist] });
		};
	/** @type {Record<string, Pose>} */
	const poses = { tucked: m(tucked), reaching: m(reach), curled: m(curled), rest: m({}) };
	return { rig: r, clips, poses, first: 'dig' };
}
