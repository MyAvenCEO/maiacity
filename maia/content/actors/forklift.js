/*
 * THE FORKLIFT — the settlement's pallet mover: autonomous, on a battery, as small as a machine that lifts a loaded
 * Euro pallet can be. No cab, no seat, no overhead guard: a low body 0.76 m wide and 0.95 m long holding the battery
 * and the drive, two drive wheels at the front of it and two castors at the back, a mast of two uprights behind the
 * forks, and the forks, 0.8 m long, spaced for a Euro pallet's openings (./pallet.js). 1.8 m long with its forks,
 * 1.23 m high. Its sensors sit flush in its body (a dark strip across the top and one across the front of it); a
 * green lamp on top says it is working, red lamps at its back.
 *
 * It is its own actor, and it can be built into another one's rig: `forkliftParts` adds its pieces and bones to any
 * actor, at any place, facing any way, and `forkliftPose` drives it, turns its wheels and lifts its forks there, so the
 * goods pod (./pod.js) has its own forklifts carry its pallets in and out. A bone can only turn, so the forklift rides
 * a bone pivoted far below it (a small turn of that carries it along the ground), and its forks a bone pivoted far
 * behind it (a small turn of that lifts them).
 *
 * Built facing +z, its heel (the face of the forks' carriage, where a pallet stops) at the origin, on y 0.
 * Moves: lift (the forks up and down), drive (forward and back), carry (in under a pallet, lift it, back out with it,
 * set it down), idle.
 */
import * as THREE from 'three';
import { loop, rig, skin } from './rig';
import { block, ease, wheel } from './excavator-rig.js';
import { euroPallet, FORK_X } from './pallet.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Pose} Pose */
/** @typedef {import('./rig').Cast} Cast */
/** @typedef {import('./rig').BoneSpec} BoneSpec */
/** @typedef {(geo: THREE.BufferGeometry, color: string, bone: string, mat?: number) => void} Add */

const BODY = '#f1f0eb', BAND = '#2f6f68', DARK = '#2a2c2e', STEEL = '#8f9498', TYRE = '#1d1e20', GREEN = '#4fd18b', RED = '#e0302a';
/** how far below and behind it its far bones pivot (m) */
const FAR = 2000;
/** the drive wheels: radius, their x and z; the forks' length and how high they ride above the ground at rest */
const WR = 0.1, WX = 0.4, WZ = -0.22, FORK = 0.8, TINE_Y = 0.03;
/** how high the forks lift at most (m) */
export const LIFT_MAX = 0.75;

/** where a point of the forklift built at the origin facing +z lands at `heel`, turned `yaw` @param {V3} heel @param {number} yaw */
const placer = (heel, yaw) => new THREE.Matrix4().makeTranslation(...heel).multiply(new THREE.Matrix4().makeRotationY(yaw));

/**
 * Add a forklift to a rig: its bones (to `bones`, under `parent`) and its pieces (through `add`), its heel at `heel`,
 * turned `yaw` about y (0 faces +z, π/2 faces +x). Its bones are named after it: `name` (it drives on it, pivoted far
 * below), `nameBody`, `nameWheels`, `nameLift` (pivoted far behind) and `nameForks` (the forks and their carriage, so a
 * size of 0 there and on the body and the wheels hides the forklift).
 * @param {Add} add @param {BoneSpec[]} bones
 * @param {{ name: string, parent?: string, heel: V3, yaw?: number }} o
 */
export function forkliftParts(add, bones, { name, parent, heel, yaw = 0 }) {
	const m = placer(heel, yaw);
	/** @param {V3} p @returns {V3} */
	const to = (p) => /** @type {V3} */ (new THREE.Vector3(...p).applyMatrix4(m).toArray());
	bones.push(
		{ name, ...(parent ? { parent } : {}), at: to([0, -FAR, 0]) },
		{ name: `${name}Body`, parent: name, at: to([0, 0.3, -0.5]) },
		{ name: `${name}Wheels`, parent: name, at: to([0, WR, WZ]) },
		{ name: `${name}Lift`, parent: name, at: to([0, TINE_Y, -FAR]) },
		{ name: `${name}Forks`, parent: `${name}Lift`, at: to([0, TINE_Y, 0]) }
	);
	/** @type {Add} */
	const put = (geo, color, bone, mat) => add(geo.applyMatrix4(m), color, bone, mat);
	const body = `${name}Body`, forks = `${name}Forks`;
	// the body: battery and drive in one rounded block, the band round it, a bumper at the back
	put(block(0.76, 0.36, 0.86, [0, 0.29, -0.52], 0.08), BODY, body);
	put(block(0.764, 0.05, 0.864, [0, 0.37, -0.52], 0.01), BAND, body);
	put(block(0.7, 0.08, 0.05, [0, 0.15, -0.96], 0.03), DARK, body);
	// its sensors, flush: a dark strip across the top, one across the front under the mast; its lamps
	put(block(0.56, 0.012, 0.14, [0, 0.47, -0.82], 0.005), DARK, body);
	put(block(0.6, 0.06, 0.012, [0, 0.22, -0.084], 0.005), DARK, body);
	put(block(0.08, 0.02, 0.08, [0.26, 0.475, -0.3], 0.008), GREEN, body);
	for (const sx of [-1, 1]) put(block(0.14, 0.05, 0.012, [sx * 0.26, 0.37, -0.953], 0.006), RED, body);
	// the castors at the back, under the body
	for (const sx of [-1, 1]) {
		put(wheel(0.055, 0.05, [sx * 0.26, 0.055, -0.84], 14), TYRE, body);
		put(block(0.06, 0.06, 0.06, [sx * 0.26, 0.11, -0.84], 0.01), STEEL, body);
	}
	// the drive wheels, at the front corners
	for (const sx of [-1, 1]) {
		put(wheel(WR, 0.07, [sx * WX, WR, WZ], 22), TYRE, `${name}Wheels`);
		put(wheel(WR * 0.55, 0.074, [sx * WX, WR, WZ], 5), STEEL, `${name}Wheels`);
	}
	// the mast: two uprights and a beam across their tops, behind the carriage
	for (const sx of [-1, 1]) put(block(0.06, 1.12, 0.07, [sx * 0.3, 0.67, -0.07], 0.012), STEEL, body);
	put(block(0.66, 0.06, 0.07, [0, 1.2, -0.07], 0.012), STEEL, body);
	// the carriage and the forks: two tines, each with its shank up the carriage
	put(block(0.56, 0.36, 0.03, [0, TINE_Y + 0.2, -0.015], 0.01), DARK, forks);
	for (const sx of [-1, 1]) {
		put(block(0.12, 0.4, 0.035, [sx * FORK_X, TINE_Y + 0.2, -0.018], 0.008), STEEL, forks);
		put(block(0.12, 0.035, FORK, [sx * FORK_X, TINE_Y + 0.0175, FORK / 2], 0.008), STEEL, forks);
	}
}

const Y = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
/** the turn (x, y, z) of `angle` about `dir` @param {THREE.Vector3} dir @param {number} angle @returns {V3} */
const turn = (dir, angle) => {
	e.setFromQuaternion(q.setFromAxisAngle(dir, angle), 'XYZ');
	return [e.x, e.y, e.z];
};

/**
 * Pose a forklift added by `forkliftParts` (turned `yaw`) into `p`: driven `move` metres forward (back if negative)
 * from where it was built, its forks lifted `lift` metres, shown or hidden.
 * @param {Pose} p @param {string} name @param {number} yaw
 * @param {{ move?: number, lift?: number, show?: boolean }} s
 */
export function forkliftPose(p, name, yaw, { move = 0, lift = 0, show = true }) {
	const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
	// driving: the far bone below turned about the line square to its way, so it slides along it
	p[name] = turn(axis.crossVectors(Y, f).normalize(), Math.asin(move / FAR));
	// lifting: the bone far behind turned about the line across the forklift, so the forks rise
	p[`${name}Lift`] = turn(axis.crossVectors(f, Y).normalize(), Math.asin(lift / FAR));
	p[`${name}Wheels`] = [...turn(axis.crossVectors(Y, f).normalize(), move / WR), show ? 1 : 0];
	const size = show ? 1 : 0;
	p[`${name}Body`] = [0, 0, 0, size];
	p[`${name}Forks`] = [0, 0, 0, size];
}

/** from 0 to 1 over [a, b] of the cycle, eased @param {number} u @param {number} a @param {number} b */
const ramp = (u, a, b) => ease(Math.min(1, Math.max(0, (u - a) / (b - a))));

/**
 * The forklift on its own, empty or with a loaded Euro pallet on its forks.
 * @param {{ pallet?: boolean }} [o] @returns {Cast}
 */
export function forklift({ pallet = false } = {}) {
	/** @type {BoneSpec[]} */
	const bones = [{ name: 'base', at: [0, 0, 0] }];
	/** @type {import('./rig').Piece[]} */
	const parts = [];
	/** @type {Add} */
	const add = (geo, color, bone, mat) => void parts.push({ geo, color, bone, ...(mat ? { mat } : {}) });
	forkliftParts(add, bones, { name: 'forklift', parent: 'base', heel: [0, 0, 0] });
	if (pallet) euroPallet(add, [0, -0.035, 0.42], 0, 'forkliftForks', { stack: 1.2 });
	const r = rig(bones, parts, [skin(0.45, { side: THREE.DoubleSide }), skin(0.06, { transparent: true, opacity: 0.3, depthWrite: false })]);
	r.object.name = pallet ? 'forklift (with a pallet)' : 'forklift';

	// a loaded pallet stands on the ground with the forks in it, low (it rides them: they lift it as they rise)
	const rest = pallet ? 0.035 : 0;
	/** @param {{ move?: number, lift?: number }} s */
	const m = ({ move = 0, lift = 0 }) => {
		/** @type {Pose} */
		const p = {};
		forkliftPose(p, 'forklift', 0, { move, lift: Math.max(lift, rest) });
		return p;
	};
	return {
		rig: r,
		clips: {
			// the forks up to the top, held, and down again
			lift: (t) => {
				const u = loop(t, 6);
				return m({ lift: LIFT_MAX * (ramp(u, 0.1, 0.4) - ramp(u, 0.6, 0.9)) });
			},
			// 2 m forward, a stop, and back
			drive: (t) => {
				const u = loop(t, 8);
				return m({ move: 2 * (ramp(u, 0.05, 0.45) - ramp(u, 0.55, 0.95)) });
			},
			// lift it clear, carry it 2 m back, set it down, and bring it back low to where it was
			carry: (t) => {
				const u = loop(t, 10);
				return m({ move: -2 * (ramp(u, 0.2, 0.5) - ramp(u, 0.65, 0.95)), lift: 0.12 * (ramp(u, 0.05, 0.15) - ramp(u, 0.55, 0.63)) });
			},
			idle: () => m({})
		},
		poses: { down: m({}), raised: m({ lift: 0.3 }), top: m({ lift: LIFT_MAX }) },
		first: 'lift'
	};
}
