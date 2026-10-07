/*
 * FROZEN — the Pod as it was at v3 (7 October 2026): open shelves over the goods pod's axles. Kept so a world built on
 * `pod@3` still gets it; the Pod today is ./pod.js.
 *
 * THE POD — the settlement's mini transporter: an autonomous electric car on rails with no front and no back, for
 * people and for goods. It is built to the box of a shipping container: 4 m long, so three stand end to end in the
 * footprint of a 40 ft container (12.19 m), and as wide (2.44 m) and as high (2.59 m) as one, so it travels where
 * containers travel, through the container tunnels and on a container's chassis.
 *
 * - On rails: four small steel wheels (40 cm, flanged) on two axles at the very ends, on standard gauge (1435 mm).
 *   The rails steer it, so nothing turns but the wheels, and everything between the axles is room to carry things.
 * - No driver: both ends are the same, glazed or closed. Each end has white lamps and red lamps; the end it drives
 *   towards shows white, the other red. Lidar on the four roof corners.
 * - It opens only to its sides, never at its ends: a platform is beside it, and pods can run nose to tail.
 * - The people mover: two compartments, as a cable car's, each with two benches of five facing each other and a door
 *   on both sides between them: twenty seats, 1.79 m to the ceiling. Under the floor, between the axles, the bay:
 *   2.76 m long, the pod's whole width and 40 cm high, behind a flap on each side that folds up level, to push
 *   luggage and crates in.
 * - The goods pod: one hold from a floor 16 cm off the rails between the axles (2.2 m inside), a shelf over each axle,
 *   and two doors on each side that swing open to the left and the right, the whole 2.76 m between the axles. It
 *   carries Euro pallets (EPAL, 1200 × 800 × 144 mm): four, in two rows of two lengthwise, each row loaded from its
 *   own side, every pallet stacked 1.6 m high.
 *
 * Built facing +z (the "north" end), the wheels on y 0. Bones: `base` (the body), the two axles (rolling, about x),
 * the doors and flaps on their hinges, the lamps (shown or hidden by their size), and the goods pod's pallets, each
 * on a bone pivoted far below it, so a small turn slides it sideways out of the doors and back (a bone only turns).
 * Moves: shuttle (drive one way, stop, open, drive back the other way), open, close, idle; the goods pod also load
 * and unload.
 */
import * as THREE from 'three';
import { limb, loop, rig, skin } from './rig';
import { block, ease, wheel } from './excavator-rig.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Piece} Piece */
/** @typedef {import('./rig').Pose} Pose */
/** @typedef {import('./rig').Cast} Cast */
/** @typedef {'people' | 'goods'} Kind */
/** @typedef {(geo: THREE.BufferGeometry, color: string, bone: string, mat?: number) => void} Add */

const BODY = '#f1f0eb', BAND = '#2f6f68', DARK = '#2a2c2e', STEEL = '#9a9fa3', HUB = '#b7bbbd', GLASS = '#a9c3cd';
const SEAT = '#3f5f7a', FLOOR = '#5b5e60', BAY = '#3a3c3e', CRATE = '#b98d55', CRATE2 = '#a87f4c', WHITE = '#fff4d6', RED = '#e0302a';

/** the container's box: half its length, half its width, and the roof's top (the lidar on it reaches 2.59 m) */
const HL = 2.0, HW = 1.22, H = 2.49;
/** the wheels: radius, the treads' x (half the gauge), the axles' z */
const R = 0.2, GX = 1.435 / 2, AZ = HL - 0.3;
/** between the axles: half the length of the room there; the bay under the cabin (y from–to); the cabin floor */
const MID = 1.38, BAY_Y = [0.14, 0.52], CABIN = 0.58;
/** the people mover's doors: their middle (z) and width; the goods pod's floor */
const DOOR_Z = 0.975, DOOR_W = 0.8, LOAD = 0.16;
/** a Euro pallet (EPAL): its length, width and height; the goods pod's pallets: their rows' x and places' z, the
 *  height they are stacked to, how far they slide out of the doors, and how far below them their bones pivot */
const PL = 1.2, PW = 0.8, PH = 0.144, ROW_X = 0.6, PALLET_Z = 0.62, STACK = 1.6, OUT = 2.2, PIVOT = 400;
const WOOD = '#c9a878', WOOD2 = '#b8955f', WRAP = '#dfe3e2';

const SIDES = /** @type {const} */ ([['L', 1], ['R', -1]]);
const ENDS = /** @type {const} */ ([['N', 1], ['S', -1]]);

/** the running gear, the ends, the roof, the lidar and the lamps: what both variants share */
/** @param {Add} add */
function chassis(add) {
	for (const [e, sz] of ENDS) {
		// the axle: two flanged steel wheels on it, a disc on each so the rolling shows
		const z = sz * AZ, axle = `axle${e}`;
		add(wheel(0.045, GX * 2 - 0.1, [0, R, z], 14), DARK, axle);
		for (const sx of [-1, 1]) {
			add(wheel(R, 0.1, [sx * GX, R, z], 28), STEEL, axle);
			add(wheel(R + 0.03, 0.022, [sx * (GX - 0.06), R, z], 28), DARK, axle); // the flange, inside the rail
			add(wheel(R * 0.55, 0.104, [sx * GX, R, z], 5), HUB, axle);
		}
		// the bogie frame over it, the motor between the wheels, the body's lower end panels round it
		add(block(GX * 2 + 0.2, 0.08, 0.5, [0, R + 0.1, z], 0.02), DARK, 'base');
		add(block(0.5, 0.22, 0.32, [0, R + 0.03, z - sz * 0.32], 0.03), DARK, 'base');
		for (const sx of [-1, 1]) add(block(0.04, CABIN - 0.36, HL - MID - 0.02, [sx * (HW - 0.02), (CABIN + 0.36) / 2, sz * (MID + HL) / 2], 0.015), BODY, 'base');
		add(block(HW * 2, CABIN - 0.36, 0.04, [0, (CABIN + 0.36) / 2, sz * (HL - 0.02)], 0.015), BODY, 'base');
		add(block(2.3, 0.12, 0.06, [0, 0.36, sz * (HL - 0.03)], 0.03), DARK, 'base'); // the buffer
		// the lamps: white at the outer corners, red inboard of them, on their own bones
		for (const sx of [-1, 1]) {
			add(block(0.26, 0.07, 0.014, [sx * 0.86, 0.9, sz * (HL - 0.002)], 0.006), WHITE, `light${e}`);
			add(block(0.16, 0.07, 0.014, [sx * 0.55, 0.9, sz * (HL - 0.002)], 0.006), RED, `tail${e}`);
		}
	}
	add(block(HW * 2, 0.12, HL * 2, [0, H - 0.06, 0], 0.06), BODY, 'base'); // the roof
	for (const sx of [-1, 1])
		for (const sz of [-1, 1]) {
			add(new THREE.CylinderGeometry(0.07, 0.08, 0.07, 20).translate(sx * (HW - 0.14), H + 0.035, sz * (HL - 0.14)), DARK, 'base');
			add(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20).translate(sx * (HW - 0.14), H + 0.085, sz * (HL - 0.14)), '#4b4f53', 'base');
		}
}

/** the bay between the axles under the people mover's floor: its floor, its ends, a flap each side, crates in it */
/** @param {Add} add */
function bay(add) {
	add(block(HW * 2 - 0.04, 0.04, MID * 2, [0, BAY_Y[0] - 0.02, 0], 0.01), BAY, 'base');
	for (const sz of [-1, 1]) add(block(HW * 2 - 0.04, BAY_Y[1] - BAY_Y[0], 0.04, [0, (BAY_Y[0] + BAY_Y[1]) / 2, sz * (MID - 0.02)], 0.01), BAY, 'base');
	for (const x of [-0.6, 0, 0.6]) add(block(0.03, 0.02, MID * 2 - 0.1, [x, BAY_Y[0] + 0.01, 0], 0.005), HUB, 'base'); // its rails
	for (const [s, sx] of SIDES) {
		const h = BAY_Y[1] - BAY_Y[0];
		add(block(0.035, h - 0.01, MID * 2 - 0.02, [sx * (HW - 0.018), (BAY_Y[0] + BAY_Y[1]) / 2, 0], 0.012), BODY, `flap${s}`);
		add(block(0.03, 0.035, 0.4, [sx * (HW + 0.004), BAY_Y[0] + 0.06, 0], 0.012), DARK, `flap${s}`); // its handle
	}
	for (const [x, z, w, h, d, c] of /** @type {const} */ ([[0.55, -0.8, 0.9, 0.34, 0.7, CRATE], [-0.5, -0.9, 0.7, 0.3, 0.5, CRATE2], [0.3, 0.6, 0.6, 0.34, 0.6, CRATE2], [-0.6, 0.85, 0.8, 0.26, 0.5, CRATE]]))
		add(block(w, h, d, [x, BAY_Y[0] + h / 2, z], 0.02), c, 'base');
}

/** the people mover: two compartments of twenty seats over the bay */
/** @param {Add} add */
function people(add) {
	bay(add);
	add(block(HW * 2 - 0.04, 0.06, HL * 2 - 0.04, [0, CABIN - 0.03, 0], 0.01), FLOOR, 'base');
	const belt = 1.05, top = H - 0.18;
	for (const [s, sx] of SIDES) {
		// the side: posts, the belt with its band, glass above it, all but the two doors
		const x = sx * (HW - 0.025);
		/** @type {[number, number][]} the stretches of wall along z between the doors and the ends */
		const walls = [[-HL, -DOOR_Z - DOOR_W / 2], [-DOOR_Z + DOOR_W / 2, DOOR_Z - DOOR_W / 2], [DOOR_Z + DOOR_W / 2, HL]];
		for (const [z0, z1] of walls) {
			const len = z1 - z0, mid = (z0 + z1) / 2;
			add(block(0.05, belt - CABIN + 0.04, len, [x, (belt + CABIN - 0.04) / 2, mid], 0.02), BODY, 'base');
			add(block(0.052, 0.07, len, [x, belt - 0.1, mid], 0.005), BAND, 'base');
			add(block(0.02, top - belt, len - 0.1, [sx * (HW - 0.03), (top + belt) / 2, mid]), GLASS, 'base', 1);
			for (const z of [z0, z1]) add(block(0.07, top - CABIN + 0.1, 0.08, [sx * (HW - 0.035), (top + CABIN) / 2, z + (z === z0 ? 0.04 : -0.04)], 0.02), BODY, 'base');
		}
		add(block(0.06, H - 0.12 - top, HL * 2, [sx * (HW - 0.03), (top + H - 0.12) / 2, 0], 0.01), BODY, 'base');
		// the doors: one leaf each, glass in a frame, hinged on the side towards its end and swinging out
		for (const [e, sz] of ENDS) {
			const bone = `door${s}${e}`, mid = sz * DOOR_Z;
			for (const dz of [-1, 1]) add(block(0.04, top - CABIN, 0.06, [sx * (HW - 0.02), (top + CABIN) / 2, mid + dz * (DOOR_W / 2 - 0.03)], 0.015), BODY, bone);
			add(block(0.04, belt - CABIN, DOOR_W, [sx * (HW - 0.02), (belt + CABIN) / 2, mid], 0.015), BODY, bone);
			add(block(0.042, 0.07, DOOR_W, [sx * (HW - 0.02), belt - 0.1, mid], 0.005), BAND, bone);
			add(block(0.04, 0.05, DOOR_W, [sx * (HW - 0.02), top - 0.025, mid], 0.015), BODY, bone);
			add(block(0.015, top - belt - 0.05, DOOR_W - 0.1, [sx * (HW - 0.02), (top + belt - 0.05) / 2, mid]), GLASS, bone, 1);
			add(limb([sx * (HW + 0.02), 1.0, mid - sz * 0.3], [sx * (HW + 0.02), 1.4, mid - sz * 0.3], 0.014, 0.014), HUB, bone); // its handle
		}
	}
	for (const [, sz] of ENDS) {
		// the end wall: its panel to the belt with the band, the screen above it (both ends alike)
		add(block(HW * 2 - 0.12, belt - CABIN + 0.04, 0.05, [0, (belt + CABIN - 0.04) / 2, sz * (HL - 0.025)], 0.02), BODY, 'base');
		add(block(HW * 2 - 0.12, 0.07, 0.052, [0, belt - 0.1, sz * (HL - 0.025)], 0.005), BAND, 'base');
		add(block(HW * 2 - 0.2, top - belt, 0.02, [0, (top + belt) / 2, sz * (HL - 0.03)]), GLASS, 'base', 1);
		add(block(1.2, 0.08, 0.03, [0, top - 0.06, sz * (HL - 0.01)], 0.01), DARK, 'base'); // the destination strip
		add(block(0.1, top - CABIN + 0.1, 0.1, [HW - 0.05, (top + CABIN) / 2, sz * (HL - 0.05)], 0.04), BODY, 'base');
		add(block(0.1, top - CABIN + 0.1, 0.1, [-HW + 0.05, (top + CABIN) / 2, sz * (HL - 0.05)], 0.04), BODY, 'base');
		// the compartment's two benches of five, facing each other across its doors: one against the end wall, one
		// against the low partition in the middle of the pod (back to back with the other compartment's)
		for (const [back, face] of /** @type {const} */ ([[HL - 0.07, -1], [0.06, 1]])) {
			const bz = sz * back, f = sz * face; // the back's z, and which way the bench faces (towards ±z)
			for (let i = 0; i < 5; i++) {
				const x = -0.9 + i * 0.45;
				add(block(0.42, 0.1, 0.44, [x, CABIN + 0.42, bz + f * 0.27], 0.04), SEAT, 'base');
				add(block(0.42, 0.62, 0.08, [x, CABIN + 0.78, bz + f * 0.03], 0.04), SEAT, 'base');
			}
			add(block(2.28, 0.37, 0.4, [0, CABIN + 0.185, bz + f * 0.26], 0.02), DARK, 'base'); // the bench's base
		}
		// a grab pole in the middle of each compartment
		add(limb([0, CABIN + 0.4, sz * DOOR_Z], [0, top, sz * DOOR_Z], 0.018, 0.018), HUB, 'base');
	}
	add(block(HW * 2 - 0.1, 0.4, 0.04, [0, CABIN + 1.2, 0], 0.02), SEAT, 'base'); // the partition over the benches' backs
	for (const [, sz] of ENDS) add(block(0.5, 0.05, 1.0, [0, top - 0.04, sz * DOOR_Z], 0.02), '#fbf7ea', 'base'); // the ceiling lights
}

/**
 * A Euro pallet on the floor at (x, y, z), its length along z: five top boards along it, three cross boards under
 * them, nine blocks, three bottom boards; and its load, cartons stacked to `STACK`, wrapped in film.
 * @param {Add} add @param {number} x @param {number} y @param {number} z @param {string} bone
 */
function pallet(add, x, y, z, bone) {
	for (const [bx, w] of [[-0.3275, 0.145], [-0.16, 0.1], [0, 0.145], [0.16, 0.1], [0.3275, 0.145]]) add(block(w, 0.022, PL, [x + bx, y + PH - 0.011, z], 0.004), WOOD, bone);
	for (const bz of [-0.5275, 0, 0.5275]) {
		add(block(PW, 0.022, 0.145, [x, y + 0.111, z + bz], 0.004), WOOD2, bone);
		for (const bx of [-0.3275, 0, 0.3275]) add(block(0.145, 0.078, 0.145, [x + bx, y + 0.061, z + bz], 0.006), WOOD2, bone);
	}
	for (const bx of [-0.3275, 0, 0.3275]) add(block(0.1, 0.022, PL, [x + bx, y + 0.011, z], 0.004), WOOD, bone);
	const top = STACK - PH;
	for (let k = 0; k < 3; k++) add(block(PW - 0.02, top / 3 - 0.01, PL - 0.02, [x, y + PH + (k + 0.5) * (top / 3), z], 0.02), k % 2 ? CRATE : CRATE2, bone);
	add(block(PW + 0.004, top * 0.7, PL + 0.004, [x, y + PH + top * 0.5, z], 0.02), WRAP, bone, 1);
}

/** the goods pod: a low hold between the axles, a shelf over each, two doors each side, four Euro pallets */
/** @param {Add} add */
function goods(add) {
	add(block(HW * 2 - 0.04, 0.06, MID * 2, [0, LOAD - 0.03, 0], 0.01), FLOOR, 'base');
	for (const sz of [-1, 1]) {
		add(block(HW * 2 - 0.04, 0.06, HL - MID, [0, CABIN - 0.03, sz * (MID + HL) / 2], 0.01), FLOOR, 'base'); // the shelf
		add(block(HW * 2 - 0.04, CABIN - LOAD, 0.04, [0, (CABIN + LOAD) / 2, sz * MID], 0.01), BAY, 'base'); // its face
		// the end wall, closed: the band across it
		add(block(HW * 2, H - 0.12 - CABIN, 0.05, [0, (H - 0.12 + CABIN) / 2, sz * (HL - 0.025)], 0.02), BODY, 'base');
		add(block(HW * 2, 0.07, 0.052, [0, 1.0, sz * (HL - 0.025)], 0.005), BAND, 'base');
		for (const sx of [-1, 1]) add(block(0.1, H - 0.48, 0.1, [sx * (HW - 0.05), (H + 0.24) / 2, sz * (HL - 0.05)], 0.04), BODY, 'base'); // the corner posts
	}
	for (const [s, sx] of SIDES) {
		// the side over each shelf, fixed, with the band; the header over the doors
		const x = sx * (HW - 0.025);
		for (const sz of [-1, 1]) {
			add(block(0.04, H - 0.12 - CABIN, HL - MID, [x, (H - 0.12 + CABIN) / 2, sz * (MID + HL) / 2], 0.015), BODY, 'base');
			add(block(0.044, 0.07, HL - MID, [x, 1.0, sz * (MID + HL) / 2], 0.005), BAND, 'base');
		}
		add(block(0.06, 0.1, HL * 2, [sx * (HW - 0.03), H - 0.17, 0], 0.01), BODY, 'base');
		// the doors: two leaves between the axles, each hinged at its end of the opening and swinging out, the one to
		// the left and the other to the right; ribs, the band, a light strip, a handle at the middle
		for (const [e, sz] of ENDS) {
			const bone = `door${s}${e}`, mid = (sz * MID) / 2, y0 = LOAD, y1 = H - 0.22;
			add(block(0.04, y1 - y0, MID - 0.01, [x, (y0 + y1) / 2, mid], 0.015), BODY, bone);
			for (const k of [0.15, 0.5, 0.85]) add(block(0.02, y1 - y0 - 0.1, 0.04, [sx * (HW - 0.002), (y0 + y1) / 2, sz * MID * k], 0.008), '#e2e1db', bone);
			add(block(0.044, 0.07, MID - 0.01, [x, 1.0, mid], 0.005), BAND, bone);
			add(block(0.02, 0.1, MID - 0.3, [sx * (HW - 0.008), H - 0.34, mid], 0.01), GLASS, bone, 1);
			add(limb([sx * (HW + 0.02), 0.9, sz * 0.1], [sx * (HW + 0.02), 1.4, sz * 0.1], 0.014, 0.014), HUB, bone);
		}
	}
	// what it carries: four Euro pallets, two rows of two lengthwise, each row on its own side; crates on the shelves
	for (const [s, sx] of SIDES) for (const [e, sz] of ENDS) pallet(add, sx * ROW_X, LOAD, sz * PALLET_Z, `pallet${s}${e}`);
	for (const sz of [-1, 1]) for (const x of [-0.6, 0.6]) add(block(0.9, 0.4, 0.5, [x, CABIN + 0.2, sz * (HL - 0.33)], 0.02), x > 0 ? CRATE : CRATE2, 'base');
}

/**
 * The pod at a moment: where it is along z (driving), which way it leads, its doors (0 shut … 1 open), its bay's
 * flaps, and how far the goods pod's pallets are out of their doors (0 in … 1 out on the platform beside it).
 * @param {Kind} kind
 * @param {{ z?: number, lead?: -1 | 0 | 1, doors?: number, flaps?: number, out?: number }} s
 * @returns {Pose}
 */
function at(kind, { z = 0, lead = 0, doors = 0, flaps = 0, out = 0 }) {
	/** @type {Pose} */
	const p = { root: [0, 0, z] };
	for (const [e, sz] of ENDS) {
		p[`axle${e}`] = [z / R, 0, 0];
		p[`light${e}`] = [0, 0, 0, lead === -sz ? 0 : 1];
		p[`tail${e}`] = [0, 0, 0, lead === -sz ? 1 : 0];
	}
	for (const [s, sx] of SIDES) {
		if (kind === 'people') {
			for (const [e, sz] of ENDS) p[`door${s}${e}`] = [0, -sx * sz * 1.5 * doors, 0];
			p[`flap${s}`] = [0, 0, sx * 1.55 * flaps];
		} else
			for (const [e, sz] of ENDS) {
				p[`door${s}${e}`] = [0, -sx * sz * 1.6 * doors, 0];
				// a turn about z of the bone far below: the pallet slides out sideways (sinking 6 mm at most)
				p[`pallet${s}${e}`] = [0, 0, -Math.asin((sx * OUT * out) / PIVOT)];
			}
	}
	return p;
}

/** from 0 to 1 over [a, b] of the cycle, eased @param {number} u @param {number} a @param {number} b */
const ramp = (u, a, b) => ease(Math.min(1, Math.max(0, (u - a) / (b - a))));

/** Build a pod and its moves. @param {Kind} kind @returns {Cast} */
export function pod(kind) {
	/** @type {import('./rig').BoneSpec[]} */
	const bones = [
		{ name: 'base', at: [0, 0.5, 0] },
		...ENDS.flatMap(([e, sz]) => [
			{ name: `axle${e}`, parent: 'base', at: /** @type {V3} */ ([0, R, sz * AZ]) },
			{ name: `light${e}`, parent: 'base', at: /** @type {V3} */ ([0, 0.9, sz * HL]) },
			{ name: `tail${e}`, parent: 'base', at: /** @type {V3} */ ([0, 0.9, sz * HL]) }
		])
	];
	for (const [s, sx] of SIDES) {
		if (kind === 'people') {
			for (const [e, sz] of ENDS) bones.push({ name: `door${s}${e}`, parent: 'base', at: [sx * (HW - 0.02), CABIN, sz * (DOOR_Z + DOOR_W / 2)] });
			bones.push({ name: `flap${s}`, parent: 'base', at: [sx * HW, BAY_Y[1], 0] });
		} else
			for (const [e, sz] of ENDS) {
				bones.push({ name: `door${s}${e}`, parent: 'base', at: [sx * (HW - 0.02), LOAD, sz * MID] });
				bones.push({ name: `pallet${s}${e}`, parent: 'base', at: [sx * ROW_X, LOAD - PIVOT, sz * PALLET_Z] });
			}
	}
	/** @type {Piece[]} */
	const parts = [];
	/** @type {Add} */
	const add = (geo, color, bone, mat) => void parts.push({ geo, color, bone, ...(mat ? { mat } : {}) });
	chassis(add);
	(kind === 'people' ? people : goods)(add);
	const r = rig(bones, parts, [skin(0.45, { side: THREE.DoubleSide }), skin(0.06, { transparent: true, opacity: 0.3, depthWrite: false })]);
	r.object.name = kind === 'people' ? 'pod (people)' : 'pod (goods)';

	/** @param {Parameters<typeof at>[1]} s */
	const m = (s) => at(kind, s);
	const run = 3, period = kind === 'people' ? 18 : 14;
	/** @type {Record<string, import('./rig').Clip>} */
	const clips = {
		// drive 3 m north, stop and open, drive back south leading with the other end, stop and open again
		shuttle: (t) => {
			const u = loop(t, period), h = 0.5;
			const there = ramp(u, 0, 0.18), back = ramp(u, h, h + 0.18);
			const z = -run / 2 + run * there - run * back;
			const lead = u < 0.18 ? 1 : u >= h && u < h + 0.18 ? -1 : 0;
			const open = (/** @type {number} */ a) => ramp(u, a, a + 0.06) - ramp(u, a + 0.2, a + 0.26);
			// the people mover opens its doors at the north stop and its bay at the south; the goods pod its doors at both
			const k = Math.max(open(0.2), open(h + 0.2));
			if (kind === 'goods') return m({ z, lead, doors: k });
			return m({ z, lead, doors: u < h ? k : 0, flaps: u < h ? 0 : k });
		},
		// the doors (and the bay's flaps) opening, then held open; closing, then held shut
		open: (t) => {
			const k = ramp(loop(t, 5), 0.08, 0.4);
			return m({ doors: k, flaps: k });
		},
		close: (t) => {
			const k = 1 - ramp(loop(t, 5), 0.08, 0.4);
			return m({ doors: k, flaps: k });
		},
		idle: () => m({})
	};
	if (kind === 'goods') {
		// the pallets brought in from the platforms either side: the doors open, the rows slide in, the doors close
		clips.load = (t) => {
			const u = loop(t, 10);
			return m({ doors: ramp(u, 0, 0.12) - ramp(u, 0.5, 0.62), out: 1 - ramp(u, 0.15, 0.45) });
		};
		// and taken out: the doors open, the rows slide out to either side, the doors close behind them
		clips.unload = (t) => {
			const u = loop(t, 10);
			return m({ doors: ramp(u, 0.04, 0.16) - ramp(u, 0.55, 0.67), out: ramp(u, 0.2, 0.5) });
		};
	}
	/** @type {Record<string, Pose>} */
	const poses = kind === 'people' ? { closed: m({}), 'doors open': m({ doors: 1 }), 'bay open': m({ flaps: 1 }), 'all open': m({ doors: 1, flaps: 1 }) } : { closed: m({}), 'doors open': m({ doors: 1 }), unloaded: m({ doors: 1, out: 1 }) };
	return { rig: r, clips, poses, first: 'shuttle' };
}
