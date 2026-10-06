/*
 * THE MINI EXCAVATOR — the 1.7-tonne digger for the tight places of the settlement (Sandbox 1): rubber tracks 1.55 m
 * long on an undercarriage 0.99 m wide, a dozer blade at the front, the house on its slewing ring with an open
 * canopy over the seat, the counterweight behind, and the digging arm — a swinging boom bracket (a mini's: the boom
 * swings left and right to dig beside a wall), a bent boom, the arm (the dipper) and a 40 cm backhoe bucket with four
 * teeth. About 3.9 m reach, 2.2 m digging depth, 2.3 m to the canopy.
 *
 * Rigged and moved as every excavator is (./excavator-rig.js); its big brother is ./crawler-excavator.js.
 */
import * as THREE from 'three';
import { limb } from './rig';
import { CHROME, DARK, PAINT, RUBBER, SEAT, SIDES, STEEL, beam, block, bucketParts, excavatorCast, ramParts, spoke, wheel } from './excavator-rig.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Piece} Piece */
/** @typedef {import('./excavator-rig.js').Spec} Spec */

/* where its joints are in the rest pose: the digging arm in the y–z plane, the boom raised, the bucket hanging */
const J = {
	base: /** @type {V3} */ ([0, 0.3, 0]),
	blade: /** @type {V3} */ ([0, 0.32, 0.62]),
	house: /** @type {V3} */ ([0, 0.48, 0]),
	swing: /** @type {V3} */ ([0, 0.68, 0.62]),
	boom: /** @type {V3} */ ([0, 0.78, 0.74]),
	arm: /** @type {V3} */ ([0, 2.05, 1.72]),
	bucket: /** @type {V3} */ ([0, 1.02, 2.18])
};
/** the cylinders' pins: barrel end (on the first part) and rod end (on the second) */
/** @type {Record<string, import('./excavator-rig.js').Ram>} */
const RAMS = {
	boomRam: { a: [0, 0.6, 0.82], b: [0, 1.45, 1.12], on: ['swing', 'boom'], r: 0.05 },
	armRam: { a: [0, 1.75, 1.05], b: [0, 2.32, 1.78], on: ['boom', 'arm'], r: 0.045 },
	bucketRam: { a: [0, 2.05, 1.86], b: [0, 1.18, 2.36], on: ['arm', 'bucket'], r: 0.04 }
};
const TRACK_X = 0.37, TRACK_W = 0.25, TRACK_L = 1.55, WHEEL = 0.17;

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
				add(spoke(WHEEL - 0.02, tx + x * TRACK_W * 0.36, WHEEL + 0.005, z, a), DARK, `${w}${s}`);
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
	out.push(...bucketParts({ pivot: J.bucket, R: 0.24, w: 0.4, teeth: 4, pin: RAMS.bucketRam.b, plate: 0.025 }));
	out.push(...ramParts(RAMS));
	return out;
}

/** @type {Spec} */
const MINI = {
	name: 'mini excavator',
	J,
	rams: RAMS,
	wheels: { x: TRACK_X, y: WHEEL + 0.005, sprocket: -(TRACK_L / 2 - WHEEL), idler: TRACK_L / 2 - WHEEL, r: WHEEL },
	parts,
	poses: {
		tucked: { boom: -0.35, arm: -0.55, bucket: -1.2, blade: -0.25 },
		reach: { boom: 0.55, arm: 0.6, bucket: -1.6, blade: 0.08 },
		curled: { boom: 0.62, arm: -0.35, bucket: 0.55, blade: 0.08 },
		lifted: { boom: -0.2, arm: -0.4, bucket: 0.6, blade: 0.08 },
		dump: { boom: -0.2, arm: 0.1, bucket: -1.4, blade: 0.08 }
	},
	slew: 1.4,
	period: 9,
	speed: 0.55
};

/** Build the mini excavator and its moves: dig, drive, doze, idle. */
export const miniExcavator = () => excavatorCast(MINI);
