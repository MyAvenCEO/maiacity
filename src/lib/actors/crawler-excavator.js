/*
 * THE CRAWLER EXCAVATOR — the settlement's big digger (Sandbox 1), a 14-tonne class machine and not a big mini: it is
 * built the way excavators of its size are.
 *
 * - Steel tracks: grousered shoes 50 cm wide round a drive sprocket (back) and an idler (front), seven track rollers
 *   under the frame and two carrier rollers over it; 3.7 m long, 2.49 m over the tracks.
 * - No dozer blade and no swinging boom bracket: the boom is pinned straight to the house, between the cab and the
 *   tanks, and lifted by two cylinders side by side.
 * - An enclosed cab on the left at a person's measure (the seat at 1.6 m off the ground, the roof at 2.95 m), glazed
 *   all round, a beacon on its roof; the fuel and hydraulic tanks and the toolbox on the right under a handrail; the
 *   engine behind under its hood and the heavy counterweight round the back (a 2.25 m tail).
 * - A 4.6 m mono boom, a 2.5 m arm and a 1 m backhoe bucket with five teeth: about 8.3 m reach and 5.5 m digging
 *   depth.
 *
 * Rigged and moved as every excavator is (./excavator-rig.js); its little brother is ./excavator.js.
 */
import * as THREE from 'three';
import { limb, skin } from './rig';
import { DARK, PAINT, SEAT, SIDES, STEEL, beam, block, bucketParts, excavatorCast, ramParts, spoke, wheel } from './excavator-rig.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Piece} Piece */
/** @typedef {import('./excavator-rig.js').Spec} Spec */

const WEIGHT = '#3a3b3d', GLASS = '#a9c3cd', LAMP = '#ffe9b0', AMBER = '#ffb000';
const X = -0.03; // the boom's line, a little right of the middle, between the cab and the tanks

/* where its joints are at rest: the boom raised, the arm hanging forward, the bucket near the ground */
const J = {
	base: /** @type {V3} */ ([0, 0.5, 0]),
	house: /** @type {V3} */ ([0, 0.98, 0]),
	swing: /** @type {V3} */ ([X, 1.55, 1.2]),
	boom: /** @type {V3} */ ([X, 1.55, 1.2]),
	arm: /** @type {V3} */ ([X, 3.45, 4.75]),
	bucket: /** @type {V3} */ ([X, 1.0, 5.25])
};
const KNEE = /** @type {V3} */ ([X, 3.75, 2.85]);
/** @type {Record<string, import('./excavator-rig.js').Ram>} */
const RAMS = {
	boomRamL: { a: [X + 0.36, 1.25, 1.7], b: [X + 0.36, 3.08, 2.88], on: ['swing', 'boom'], r: 0.085 },
	boomRamR: { a: [X - 0.36, 1.25, 1.7], b: [X - 0.36, 3.08, 2.88], on: ['swing', 'boom'], r: 0.085 },
	armRam: { a: [X, 3.11, 1.87], b: [X, 4.15, 4.55], on: ['boom', 'arm'], r: 0.095 },
	bucketRam: { a: [X, 3.23, 5.15], b: [X, 1.25, 5.55], on: ['arm', 'bucket'], r: 0.08 }
};
/** the tracks: centres, the wheels' axle height and radius, sprocket (back) and idler (front), the shoes' loop */
const T = { x: 0.995, w: 0.5, y: 0.45, r: 0.35, back: -1.45, front: 1.45, loop: 0.38 };

/** The shoes of one track, round its loop: each a plate and its grouser, laid every 19 cm along the loop. */
/** @param {number} tx @returns {THREE.BufferGeometry[]} */
function shoes(tx) {
	const run = T.front - T.back, arc = Math.PI * T.loop, total = 2 * run + 2 * arc, pitch = 0.19;
	/** where along the loop (0…total) a shoe is, and which way is out @param {number} s @returns {[number, number, number, number]} */
	const along = (s) => {
		if (s < run) return [T.y + T.loop, T.back + s, 1, 0]; // the top run, back to front
		s -= run;
		if (s < arc) {
			const a = s / T.loop; // round the idler, over the front
			return [T.y + Math.cos(a) * T.loop, T.front + Math.sin(a) * T.loop, Math.cos(a), Math.sin(a)];
		}
		s -= arc;
		if (s < run) return [T.y - T.loop, T.front - s, -1, 0]; // the bottom run, front to back
		s -= run;
		const a = Math.PI + s / T.loop; // round the sprocket, up the back
		return [T.y + Math.cos(a) * T.loop, T.back + Math.sin(a) * T.loop, Math.cos(a), Math.sin(a)];
	};
	/** @type {THREE.BufferGeometry[]} */
	const out = [];
	const n = Math.round(total / pitch);
	for (let i = 0; i < n; i++) {
		const [y, z, ny, nz] = along((i * total) / n);
		const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, ny, nz), new THREE.Vector3(0, -nz, ny));
		basis.setPosition(tx, y, z);
		const plate = new THREE.BoxGeometry(T.w, 0.05, pitch * 0.92);
		plate.applyMatrix4(basis);
		const grouser = new THREE.BoxGeometry(T.w, 0.035, 0.03).translate(0, 0.042, 0);
		grouser.applyMatrix4(basis);
		out.push(plate, grouser);
	}
	return out;
}

/** Every part, riding its joint. @returns {Piece[]} */
function parts() {
	/** @type {Piece[]} */
	const out = [];
	/** @param {THREE.BufferGeometry} geo @param {string} color @param {string} bone @param {number} [mat] */
	const add = (geo, color, bone, mat = 0) => out.push({ geo, color, bone, mat });

	// the undercarriage: the car body, the slewing ring, two track frames with their wheels, rollers and steel shoes
	add(block(0.95, 0.42, 1.7, [0, 0.62, 0], 0.04), DARK, 'base');
	add(block(1.7, 0.3, 0.9, [0, 0.58, 0], 0.04), DARK, 'base');
	add(new THREE.CylinderGeometry(0.78, 0.78, 0.12, 36).translate(0, 0.9, 0), DARK, 'base');
	for (const [s, x] of SIDES) {
		const tx = x * T.x;
		add(block(0.36, 0.42, T.front - T.back + 0.1, [tx, T.y, 0], 0.03), DARK, 'base');
		for (const g of shoes(tx)) add(g, STEEL, 'base');
		for (let i = 0; i < 7; i++) add(wheel(0.1, 0.26, [tx, 0.2, -1.08 + i * 0.36], 14), STEEL, 'base');
		for (const z of [-0.5, 0.5]) add(wheel(0.08, 0.2, [tx, T.y + T.loop - 0.105, z], 14), STEEL, 'base');
		for (const [w, z] of /** @type {const} */ ([['sprocket', T.back], ['idler', T.front]])) {
			add(wheel(T.r - 0.02, 0.32, [tx, T.y, z], 24), DARK, `${w}${s}`);
			for (let k = 0; k < 3; k++) add(spoke(T.r - 0.04, tx + x * 0.17, T.y, z, (k * Math.PI) / 3), STEEL, `${w}${s}`);
		}
		add(wheel(0.24, 0.22, [tx - x * 0.26, T.y, T.back], 20), DARK, 'base'); // the travel motor
	}

	// the house: its deck, the counterweight round the back, the engine under its hood
	add(block(2.45, 0.22, 3.75, [0, 1.1, -0.3], 0.03), DARK, 'house');
	const weight = new THREE.CylinderGeometry(2.25, 2.25, 0.85, 40, 1, false, Math.PI - 0.6, 1.2);
	weight.translate(0, 1.64, 0);
	add(weight, WEIGHT, 'house');
	add(block(2.25, 0.85, 1.3, [-0.05, 1.64, -1.3], 0.06), PAINT, 'house');
	for (let i = 0; i < 6; i++) add(block(0.9, 0.012, 0.05, [-0.45, 2.075, -1.75 + i * 0.12], 0.004), DARK, 'house'); // the hood's louvres
	add(limb([-0.62, 2.05, -0.95], [-0.62, 2.62, -0.95], 0.055, 0.05), DARK, 'house'); // the exhaust
	// the right front: the fuel and hydraulic tanks and the toolbox, a handrail round their top, a step
	add(block(0.95, 0.95, 1.55, [-0.73, 1.68, 0.78], 0.05), PAINT, 'house');
	add(block(0.9, 0.02, 0.5, [-0.73, 1.45, 1.56], 0.005), DARK, 'house'); // the toolbox lid's line
	for (const z of [0.1, 0.8, 1.5]) add(limb([-1.17, 2.15, z], [-1.17, 2.62, z], 0.022, 0.022), PAINT, 'house');
	add(limb([-1.17, 2.62, 0.1], [-1.17, 2.62, 1.5], 0.022, 0.022), PAINT, 'house');
	add(block(0.42, 0.05, 0.28, [-1.0, 1.0, 1.72], 0.01), STEEL, 'house');
	// the boom's foot, pinned to the house, and the brackets its two rams push from
	add(block(0.62, 0.5, 0.75, [X, 1.45, 1.2], 0.05), PAINT, 'house');
	for (const sx of [-1, 1]) add(block(0.12, 0.3, 0.42, [X + sx * 0.36, 1.25, 1.62], 0.02), DARK, 'swing');

	// the cab on the left: its frame, glass all round, the seat and joysticks inside, a door, a mirror, a beacon
	const cx = 0.7, cz = 0.1, cw = 1.0, cd = 1.7, y0 = 1.22, y1 = 2.92;
	add(block(cw, 0.25, cd, [cx, y0 + 0.125, cz], 0.03), DARK, 'house');
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(block(0.07, y1 - y0, 0.07, [cx + sx * (cw / 2 - 0.035), (y0 + y1) / 2, cz + sz * (cd / 2 - 0.035)], 0.01), DARK, 'house');
	add(block(cw + 0.06, 0.09, cd + 0.06, [cx, y1 + 0.03, cz], 0.03), PAINT, 'house');
	const gy = (y0 + 0.25 + y1) / 2, gh = y1 - y0 - 0.27;
	add(block(cw - 0.08, gh, 0.012, [cx, gy, cz + cd / 2 - 0.02]), GLASS, 'house', 1);
	add(block(cw - 0.08, gh, 0.012, [cx, gy, cz - cd / 2 + 0.02]), GLASS, 'house', 1);
	for (const sx of [-1, 1]) add(block(0.012, gh, cd - 0.08, [cx + sx * (cw / 2 - 0.02), gy, cz]), GLASS, 'house', 1);
	add(block(0.05, gh, 0.04, [cx + cw / 2 - 0.02, gy, cz - 0.15], 0.01), DARK, 'house'); // the door's back edge
	add(block(0.05, 0.03, 0.18, [cx + cw / 2 + 0.02, 2.05, cz + 0.4], 0.01), DARK, 'house'); // its handle
	add(block(0.5, 0.12, 0.5, [cx, 1.62, cz - 0.15], 0.04), SEAT, 'house');
	add(block(0.5, 0.65, 0.12, [cx, 1.98, cz - 0.42], 0.05), SEAT, 'house');
	for (const sx of [-1, 1]) {
		add(block(0.14, 0.3, 0.5, [cx + sx * 0.36, 1.6, cz - 0.05], 0.03), DARK, 'house');
		add(limb([cx + sx * 0.36, 1.76, cz + 0.12], [cx + sx * 0.36, 1.92, cz + 0.15], 0.015, 0.015), DARK, 'house');
	}
	add(limb([cx + cw / 2 + 0.06, 1.3, cz + cd / 2 - 0.1], [cx + cw / 2 + 0.06, 2.6, cz + cd / 2 - 0.1], 0.02, 0.02), DARK, 'house'); // the grab rail
	add(limb([cx + cw / 2, 2.55, cz + cd / 2], [cx + cw / 2 + 0.25, 2.6, cz + cd / 2 + 0.1], 0.012, 0.012), DARK, 'house');
	add(block(0.04, 0.28, 0.18, [cx + cw / 2 + 0.27, 2.52, cz + cd / 2 + 0.1], 0.01), DARK, 'house'); // the mirror
	add(new THREE.SphereGeometry(0.07, 12, 8).translate(cx + 0.3, y1 + 0.13, cz - 0.6), AMBER, 'house'); // the beacon
	add(block(0.12, 0.08, 0.06, [cx - 0.3, y1 + 0.06, cz + cd / 2], 0.01), LAMP, 'house'); // the cab's work light

	// the boom: a box section bent at its knee, a lamp on it; the arm with its lever; their pins
	add(beam(J.boom, KNEE, 0.5, 0.62, 0.04), PAINT, 'boom');
	add(beam(KNEE, J.arm, 0.48, 0.52, 0.04), PAINT, 'boom');
	add(wheel(0.13, 0.66, J.boom), STEEL, 'boom');
	add(wheel(0.12, 0.6, J.arm), STEEL, 'boom');
	for (const sx of [-1, 1]) add(beam([X + sx * 0.3, 3.35, 2.55], [X + sx * 0.36, RAMS.boomRamL.b[1], RAMS.boomRamL.b[2]], 0.08, 0.3, 0.02), PAINT, 'boom');
	add(beam([X, 2.87, 2.19], RAMS.armRam.a, 0.3, 0.2, 0.02), PAINT, 'boom');
	add(block(0.14, 0.1, 0.08, [X + 0.3, 3.65, 2.95], 0.01), LAMP, 'boom');
	add(beam(J.arm, J.bucket, 0.42, 0.5, 0.04), PAINT, 'arm');
	add(beam(J.arm, RAMS.armRam.b, 0.36, 0.34, 0.03), PAINT, 'arm');
	add(beam([X, 3.16, 4.81], RAMS.bucketRam.a, 0.26, 0.2, 0.02), PAINT, 'arm');
	add(wheel(0.1, 0.52, J.bucket), STEEL, 'arm');
	out.push(...bucketParts({ pivot: J.bucket, R: 0.5, w: 1.0, teeth: 5, pin: RAMS.bucketRam.b, plate: 0.035 }));
	out.push(...ramParts(RAMS));
	return out;
}

/** @type {Spec} */
const CRAWLER = {
	name: 'crawler excavator',
	J,
	rams: RAMS,
	wheels: { x: T.x, y: T.y, sprocket: T.back, idler: T.front, r: T.r },
	parts,
	poses: {
		tucked: { boom: -0.35, arm: -0.95, bucket: 0.4 },
		reach: { boom: 0.38, arm: 0.65, bucket: -1.3 },
		curled: { boom: 0.48, arm: -0.25, bucket: 0.7 },
		lifted: { boom: -0.15, arm: -0.3, bucket: 0.6 },
		dump: { boom: -0.15, arm: 0.25, bucket: -1.4 }
	},
	slew: 1.6,
	period: 12,
	speed: 1.0,
	materials: [skin(0.08, { transparent: true, opacity: 0.32, depthWrite: false })]
};

/** Build the crawler excavator and its moves: dig, drive, idle. */
export const crawlerExcavator = () => excavatorCast(CRAWLER);
