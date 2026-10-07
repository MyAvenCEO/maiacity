/*
 * FROZEN — the Pod as it was at v1 (7 October 2026): on rubber tyres steered at the corners, opening at its ends. Kept
 * so a world built on `pod@1` still gets it; the Pod today is ./pod.js.
 *
 * THE POD — the settlement's mini transporter: an autonomous electric vehicle with no front and no back, for people
 * and for goods. It is built to the box of a shipping container: 4 m long, so three stand end to end in the footprint
 * of a 40 ft container (12.19 m), and as wide (2.44 m) and as high (2.59 m) as one, so it travels where containers
 * travel, through the container tunnels and on a container's chassis.
 *
 * - No driver: both ends are the same. Each end has white lamps and red lamps; the end it drives towards shows white,
 *   the other red. Four wheels at the corners, every one steered, so it turns as tightly either way. Lidar on the four
 *   roof corners.
 * - The people mover: a cabin over a low bay. Eight seats on two benches, four across, facing each other at the ends
 *   (as there is no front to face), 1.75 m to the ceiling; double doors in the middle of both sides that swing out;
 *   glass all round. Under the cabin floor, the length of the pod, the bay: 1.5 m wide and 42 cm high, open at both
 *   ends behind a hatch, for pushing in luggage and crates.
 * - The goods pod: one hold the full height of the pod from a low floor (2 m inside: a person walks in, roll cages
 *   stand in it), barn doors over each whole end as a container has.
 *
 * Built facing +z (the "north" end), the wheels on y 0. Bones: `base` (the body), each wheel's `steer` (about y) and
 * `wheel` (rolling, about x), the doors and hatches on their hinges, and the lamps (shown or hidden by their size).
 * Moves: shuttle (drive one way, stop, open, drive back the other way), doors, steer, idle.
 */
import * as THREE from 'three';
import { limb, loop, rig, skin } from './rig';
import { beam, block, ease, wheel } from './excavator-rig.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Piece} Piece */
/** @typedef {import('./rig').Pose} Pose */
/** @typedef {import('./rig').Cast} Cast */
/** @typedef {'people' | 'goods'} Kind */

const BODY = '#f1f0eb', BAND = '#2f6f68', DARK = '#2a2c2e', TYRE = '#1c1d1f', HUB = '#b7bbbd', GLASS = '#a9c3cd';
const SEAT = '#3f5f7a', FLOOR = '#5b5e60', BAY = '#3a3c3e', CRATE = '#b98d55', CAGE = '#8e959a', WHITE = '#fff4d6', RED = '#e0302a';

/** the container's box: half its length, half its width, and the roof's top (the lidar on it reaches 2.59 m) */
const HL = 2.0, HW = 1.22, H = 2.49;
/** the wheels: radius, width, the centres' x and z */
const R = 0.32, TW = 0.24, WX = 1.0, WZ = 1.5;
/** the people mover's bay (y from–to, half its width) and its cabin floor; the doors' half opening */
const BAY_Y = [0.14, 0.56], BAY_X = 0.75, CABIN = 0.62, DOOR = 0.6;
/** the goods pod's load floor, and the barn doors' hinges */
const LOAD = 0.42, HINGE_X = 1.16;

/** the corners: name, x sign, z sign (N is +z) */
const CORNERS = /** @type {const} */ ([['NL', 1, 1], ['NR', -1, 1], ['SL', 1, -1], ['SR', -1, -1]]);
const ENDS = /** @type {const} */ ([['N', 1], ['S', -1]]);

/** the wheels, steered and rolling, the lidar and the lamps */
/** @param {Kind} kind @param {(geo: THREE.BufferGeometry, color: string, bone: string, mat?: number) => void} add */
function chassis(kind, add) {
	for (const [c, sx, sz] of CORNERS) {
		const at = /** @type {V3} */ ([sx * WX, R, sz * WZ]);
		add(wheel(R, TW, at, 28), TYRE, `wheel${c}`);
		add(wheel(R * 0.62, TW + 0.01, at, 20), HUB, `wheel${c}`);
		// five spokes on the outside face, so the rolling shows
		for (let k = 0; k < 5; k++) {
			const a = (k * 2 * Math.PI) / 5;
			add(beam([sx * (WX + TW / 2 + 0.006), R, sz * WZ], [sx * (WX + TW / 2 + 0.006), R + Math.cos(a) * R * 0.58, sz * WZ + Math.sin(a) * R * 0.58], 0.012, 0.05, 0.004), DARK, `wheel${c}`);
		}
		add(wheel(0.05, 0.08, [sx * (WX - TW / 2 - 0.04), R, sz * WZ]), DARK, `steer${c}`); // the steering knuckle
		// the lidar on the roof corner
		add(new THREE.CylinderGeometry(0.07, 0.08, 0.07, 20).translate(sx * (HW - 0.14), H + 0.035, sz * (HL - 0.14)), DARK, 'base');
		add(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20).translate(sx * (HW - 0.14), H + 0.085, sz * (HL - 0.14)), '#4b4f53', 'base');
	}
	// the lamps on each end, on their own bones: the people mover's across its end under the screen (white at the
	// corners, red inboard), the goods pod's up the posts beside its doors (white over red)
	for (const [e, sz] of ENDS) {
		for (const sx of [-1, 1]) {
			if (kind === 'people') {
				add(block(0.26, 0.07, 0.014, [sx * 0.86, 0.98, sz * (HL - 0.002)], 0.006), WHITE, `light${e}`);
				add(block(0.16, 0.07, 0.014, [sx * 0.55, 0.98, sz * (HL - 0.002)], 0.006), RED, `tail${e}`);
			} else {
				add(block(0.05, 0.24, 0.014, [sx * (HW - 0.04), 1.2, sz * (HL - 0.002)], 0.006), WHITE, `light${e}`);
				add(block(0.05, 0.16, 0.014, [sx * (HW - 0.04), 0.9, sz * (HL - 0.002)], 0.006), RED, `tail${e}`);
			}
		}
		// the bumper and the band across the end
		add(block(2.3, 0.12, 0.06, [0, 0.13, sz * (HL - 0.03)], 0.03), DARK, 'base');
	}
}

/** the people mover: a glazed cabin over the bay */
/** @param {(geo: THREE.BufferGeometry, color: string, bone: string, mat?: number) => void} add */
function people(add) {
	// the bay: its plates, its walls, rails along its floor, two crates pushed in from the south end
	add(block(BAY_X * 2 + 0.06, 0.04, HL * 2 - 0.02, [0, BAY_Y[0] - 0.02, 0], 0.01), BAY, 'base');
	for (const sx of [-1, 1]) {
		add(block(0.04, BAY_Y[1] - BAY_Y[0], HL * 2 - 0.02, [sx * (BAY_X + 0.02), (BAY_Y[0] + BAY_Y[1]) / 2, 0], 0.01), BAY, 'base');
		add(block(0.03, 0.02, HL * 2 - 0.1, [sx * 0.45, BAY_Y[0] + 0.01, 0], 0.005), HUB, 'base');
		// the skirt between the wheel arches, and the body below the floor beside the bay
		add(block(0.04, BAY_Y[1] - 0.14, 2 * (WZ - R - 0.08), [sx * (HW - 0.02), (BAY_Y[1] + 0.14) / 2, 0], 0.015), BODY, 'base');
		add(block(HW - BAY_X - 0.06, 0.1, 2 * (WZ - R - 0.1), [sx * (BAY_X + (HW - BAY_X) / 2), 0.2, 0], 0.01), DARK, 'base');
	}
	add(block(1.1, 0.4, 0.75, [0.05, BAY_Y[0] + 0.2, -1.4], 0.02), CRATE, 'base');
	add(block(0.7, 0.3, 0.55, [-0.2, BAY_Y[0] + 0.15, -0.6], 0.02), CRATE, 'base');
	for (const [e, sz] of ENDS) {
		// the end below the cabin: the frame round the bay's mouth, and its hatch hung from the top
		for (const sx of [-1, 1]) add(block(HW - BAY_X - 0.02, BAY_Y[1] - 0.14, 0.04, [sx * (BAY_X + (HW - BAY_X) / 2 + 0.01), (BAY_Y[1] + 0.14) / 2, sz * (HL - 0.02)], 0.015), BODY, 'base');
		add(block(BAY_X * 2 - 0.02, BAY_Y[1] - BAY_Y[0] - 0.02, 0.035, [0, (BAY_Y[0] + BAY_Y[1]) / 2, sz * (HL - 0.045)], 0.012), BODY, `hatch${e}`);
		add(block(0.3, 0.035, 0.03, [0, BAY_Y[0] + 0.06, sz * (HL - 0.016)], 0.012), DARK, `hatch${e}`); // its handle
	}
	// the cabin floor, the roof, the belt round it under the glass with the band on it
	add(block(HW * 2 - 0.04, 0.06, HL * 2 - 0.04, [0, CABIN - 0.03, 0], 0.01), FLOOR, 'base');
	add(block(HW * 2, 0.12, HL * 2, [0, H - 0.06, 0], 0.06), BODY, 'base');
	const belt = 1.12, top = H - 0.18;
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			const z0 = sz * DOOR, z1 = sz * HL;
			add(block(0.05, belt - CABIN + 0.08, Math.abs(z1 - z0), [sx * (HW - 0.025), (belt + CABIN - 0.08) / 2, (z0 + z1) / 2], 0.02), BODY, 'base');
			add(block(0.052, 0.07, Math.abs(z1 - z0), [sx * (HW - 0.025), belt - 0.12, (z0 + z1) / 2], 0.005), BAND, 'base');
			add(block(0.02, top - belt, Math.abs(z1 - z0) - 0.1, [sx * (HW - 0.03), (top + belt) / 2, (z0 + z1) / 2]), GLASS, 'base', 1);
			add(block(0.07, top - CABIN + 0.1, 0.08, [sx * (HW - 0.035), (top + CABIN) / 2, z0 + sz * 0.04], 0.02), BODY, 'base'); // the door posts
			add(block(0.1, top - CABIN + 0.1, 0.1, [sx * (HW - 0.05), (top + CABIN) / 2, sz * (HL - 0.05)], 0.04), BODY, 'base'); // the corner posts
		}
		add(block(0.06, H - 0.12 - top, HL * 2, [sx * (HW - 0.03), (top + H - 0.12) / 2, 0], 0.01), BODY, 'base');
		// the doors: two leaves each side, glass in a frame, hinged at the posts, swinging out
		for (const [f, sz] of /** @type {const} */ ([['f', 1], ['b', -1]])) {
			const bone = `door${sx > 0 ? 'L' : 'R'}${f}`, mid = sz * DOOR * 0.5;
			add(block(0.04, top - CABIN, 0.06, [sx * (HW - 0.02), (top + CABIN) / 2, sz * 0.03], 0.015), BODY, bone);
			add(block(0.04, top - CABIN, 0.06, [sx * (HW - 0.02), (top + CABIN) / 2, sz * (DOOR - 0.03)], 0.015), BODY, bone);
			add(block(0.04, belt - CABIN, DOOR, [sx * (HW - 0.02), (belt + CABIN) / 2, mid], 0.015), BODY, bone);
			add(block(0.042, 0.07, DOOR, [sx * (HW - 0.02), belt - 0.12, mid], 0.005), BAND, bone);
			add(block(0.04, 0.05, DOOR, [sx * (HW - 0.02), top - 0.025, mid], 0.015), BODY, bone);
			add(block(0.015, top - belt - 0.05, DOOR - 0.1, [sx * (HW - 0.02), (top + belt - 0.05) / 2, mid]), GLASS, bone, 1);
		}
		// a grab pole by each door
		for (const sz of [-1, 1]) add(limb([sx * (HW - 0.2), CABIN, sz * (DOOR + 0.12)], [sx * (HW - 0.2), top, sz * (DOOR + 0.12)], 0.018, 0.018), HUB, 'base');
	}
	for (const [, sz] of ENDS) {
		// the end wall: its panel to the belt with the band, the screen above it (both ends alike)
		add(block(HW * 2 - 0.12, belt - CABIN + 0.08, 0.05, [0, (belt + CABIN - 0.08) / 2, sz * (HL - 0.025)], 0.02), BODY, 'base');
		add(block(HW * 2 - 0.12, 0.07, 0.052, [0, belt - 0.12, sz * (HL - 0.025)], 0.005), BAND, 'base');
		add(block(HW * 2 - 0.2, top - belt, 0.02, [0, (top + belt) / 2, sz * (HL - 0.03)]), GLASS, 'base', 1);
		add(block(1.2, 0.08, 0.03, [0, top - 0.06, sz * (HL - 0.01)], 0.01), DARK, 'base'); // the destination strip
		// the bench: four seats across, its back to the end wall, facing the middle
		for (let i = 0; i < 4; i++) {
			const x = -0.84 + i * 0.56;
			add(block(0.5, 0.1, 0.46, [x, CABIN + 0.42, sz * (HL - 0.38)], 0.04), SEAT, 'base');
			add(block(0.5, 0.55, 0.09, [x, CABIN + 0.75, sz * (HL - 0.13)], 0.04), SEAT, 'base');
			add(block(0.14, 0.18, 0.06, [x, CABIN + 1.12, sz * (HL - 0.12)], 0.03), SEAT, 'base'); // the headrest
		}
		add(block(2.2, 0.38, 0.5, [0, CABIN + 0.19, sz * (HL - 0.36)], 0.02), DARK, 'base'); // the bench's base
	}
	add(block(0.5, 0.05, 1.2, [0, top - 0.04, 0], 0.02), '#fbf7ea', 'base'); // the ceiling light
}

/** the goods pod: one full-height hold from a low floor, barn doors over both ends */
/** @param {(geo: THREE.BufferGeometry, color: string, bone: string, mat?: number) => void} add */
function goods(add) {
	add(block(HW * 2 - 0.04, 0.08, HL * 2 - 0.02, [0, LOAD - 0.04, 0], 0.01), FLOOR, 'base');
	add(block(HW * 2 - 0.2, LOAD - 0.18, HL * 2 - 2 * (R + 0.2), [0, (LOAD + 0.1) / 2, 0], 0.02), DARK, 'base'); // the battery under the floor
	add(block(HW * 2, 0.12, HL * 2, [0, H - 0.06, 0], 0.06), BODY, 'base');
	for (const sx of [-1, 1]) {
		// the sides: one panel over the wheel arches, the skirt between them, the band and a light strip high up
		add(block(0.05, H - 0.12 - 0.72, HL * 2, [sx * (HW - 0.025), (H - 0.12 + 0.72) / 2, 0], 0.02), BODY, 'base');
		add(block(0.05, 0.72 - 0.14, 2 * (WZ - R - 0.08), [sx * (HW - 0.025), (0.72 + 0.14) / 2, 0], 0.02), BODY, 'base');
		add(block(0.052, 0.07, HL * 2 - 0.1, [sx * (HW - 0.025), 1.0, 0], 0.005), BAND, 'base');
		add(block(0.02, 0.12, HL * 2 - 0.5, [sx * (HW - 0.01), H - 0.32, 0], 0.01), GLASS, 'base', 1);
		// the wheel arches inside, at the corners
		for (const sz of [-1, 1]) add(block(0.3, 0.32, 0.8, [sx * (HW - 0.2), LOAD + 0.16, sz * WZ], 0.04), DARK, 'base');
		// a rail along the wall to strap loads to
		add(block(0.03, 0.05, HL * 2 - 0.3, [sx * (HW - 0.07), 1.35, 0], 0.01), HUB, 'base');
	}
	for (const [e, sz] of ENDS) {
		// the end's frame: two posts, the header over the doors, the sill under them
		for (const sx of [-1, 1]) add(block(0.08, H - 0.14, 0.1, [sx * (HW - 0.04), (H - 0.14 + 0.14) / 2 + 0.02, sz * (HL - 0.05)], 0.03), BODY, 'base');
		add(block(HW * 2, 0.12, 0.1, [0, H - 0.18, sz * (HL - 0.05)], 0.03), BODY, 'base');
		add(block(HW * 2, LOAD - 0.18, 0.1, [0, (LOAD + 0.18) / 2, sz * (HL - 0.05)], 0.02), BODY, 'base');
		// the two leaves, each with its ribs, a locking bar and the band across
		for (const hx of [-1, 1]) {
			const bone = `leaf${e}${hx > 0 ? 'L' : 'R'}`, w = HINGE_X, cx = hx * (HINGE_X - w / 2), y0 = LOAD, y1 = H - 0.24;
			add(block(w - 0.02, y1 - y0, 0.04, [cx, (y0 + y1) / 2, sz * (HL - 0.07)], 0.015), BODY, bone);
			for (const k of [0.25, 0.5, 0.75]) add(block(0.04, y1 - y0 - 0.1, 0.02, [hx * (HINGE_X - w * k), (y0 + y1) / 2, sz * (HL - 0.044)], 0.008), '#e2e1db', bone);
			add(block(w - 0.02, 0.07, 0.042, [cx, 1.0, sz * (HL - 0.07)], 0.005), BAND, bone);
			add(limb([hx * 0.14, y0 + 0.05, sz * (HL - 0.03)], [hx * 0.14, y1 - 0.05, sz * (HL - 0.03)], 0.015, 0.015), HUB, bone);
		}
	}
	// what it carries: two roll cages of crates at the south end, crates stacked at the north
	for (const x of [-0.45, 0.45]) {
		const z = -1.35, y = LOAD + 0.1;
		add(block(0.8, 0.04, 0.68, [x, y, z], 0.01), CAGE, 'base');
		for (const [cx, cz] of [[-0.38, -0.32], [0.38, -0.32], [-0.38, 0.32], [0.38, 0.32]]) add(limb([x + cx, y, z + cz], [x + cx, y + 1.7, z + cz], 0.012, 0.012), CAGE, 'base');
		for (let k = 0; k < 4; k++) add(block(0.72, 0.36, 0.6, [x, y + 0.22 + k * 0.4, z], 0.02), k % 2 ? CRATE : '#a87f4c', 'base');
	}
	for (let k = 0; k < 3; k++) add(block(0.6, 0.4, 0.4, [0.5, LOAD + 0.2 + k * 0.42, 1.2], 0.02), k % 2 ? '#a87f4c' : CRATE, 'base');
}

/**
 * The pod at a moment: where it is along z (driving), which way it leads, its doors (0 shut … 1 open), its hatches,
 * its wheels steered.
 * @param {Kind} kind
 * @param {{ z?: number, lead?: -1 | 0 | 1, doors?: number, hatches?: number, steer?: number }} s
 * @returns {Pose}
 */
function at(kind, { z = 0, lead = 0, doors = 0, hatches = 0, steer = 0 }) {
	/** @type {Pose} */
	const p = { root: [0, 0, z] };
	for (const [c, , sz] of CORNERS) {
		p[`steer${c}`] = [0, sz * steer, 0];
		p[`wheel${c}`] = [z / R, 0, 0];
	}
	for (const [e, sz] of ENDS) {
		p[`light${e}`] = [0, 0, 0, lead === -sz ? 0 : 1];
		p[`tail${e}`] = [0, 0, 0, lead === -sz ? 1 : 0];
	}
	if (kind === 'people') {
		const a = 1.45 * doors;
		for (const [side, sx] of /** @type {const} */ ([['L', 1], ['R', -1]])) {
			p[`door${side}f`] = [0, -sx * a, 0];
			p[`door${side}b`] = [0, sx * a, 0];
		}
		p.hatchN = [-1.45 * hatches, 0, 0];
		p.hatchS = [1.45 * hatches, 0, 0];
	} else {
		const a = 1.75 * doors;
		for (const [e, sz] of ENDS) {
			p[`leaf${e}L`] = [0, sz * a, 0];
			p[`leaf${e}R`] = [0, -sz * a, 0];
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
		...CORNERS.flatMap(([c, sx, sz]) => [
			{ name: `steer${c}`, parent: 'base', at: /** @type {V3} */ ([sx * WX, R, sz * WZ]) },
			{ name: `wheel${c}`, parent: `steer${c}`, at: /** @type {V3} */ ([sx * WX, R, sz * WZ]) }
		]),
		...ENDS.flatMap(([e, sz]) => [
			{ name: `light${e}`, parent: 'base', at: /** @type {V3} */ ([0, 0.98, sz * HL]) },
			{ name: `tail${e}`, parent: 'base', at: /** @type {V3} */ ([0, 0.98, sz * HL]) }
		])
	];
	if (kind === 'people') {
		for (const [side, sx] of /** @type {const} */ ([['L', 1], ['R', -1]])) {
			bones.push({ name: `door${side}f`, parent: 'base', at: [sx * (HW - 0.02), CABIN, DOOR] });
			bones.push({ name: `door${side}b`, parent: 'base', at: [sx * (HW - 0.02), CABIN, -DOOR] });
		}
		for (const [e, sz] of ENDS) bones.push({ name: `hatch${e}`, parent: 'base', at: [0, BAY_Y[1], sz * HL] });
	} else {
		for (const [e, sz] of ENDS) for (const [s, hx] of /** @type {const} */ ([['L', 1], ['R', -1]])) bones.push({ name: `leaf${e}${s}`, parent: 'base', at: [hx * HINGE_X, LOAD, sz * (HL - 0.07)] });
	}
	/** @type {Piece[]} */
	const parts = [];
	/** @param {THREE.BufferGeometry} geo @param {string} color @param {string} bone @param {number} [mat] */
	const add = (geo, color, bone, mat) => parts.push({ geo, color, bone, ...(mat ? { mat } : {}) });
	chassis(kind, add);
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
			return m({ z, lead, doors: u < h ? k : 0, hatches: u < h ? 0 : k });
		},
		doors: (t) => {
			const u = loop(t, 6);
			const k = ramp(u, 0.05, 0.3) - ramp(u, 0.7, 0.95);
			return m({ doors: k, hatches: kind === 'people' ? k : 0 });
		},
		// every wheel steered, the north pair against the south pair, as it turns tightly
		steer: (t) => m({ steer: Math.sin((t * 2 * Math.PI) / 5) * 0.45 }),
		idle: () => m({})
	};
	/** @type {Record<string, Pose>} */
	const poses = kind === 'people' ? { closed: m({}), 'doors open': m({ doors: 1 }), 'bay open': m({ hatches: 1 }), 'all open': m({ doors: 1, hatches: 1 }) } : { closed: m({}), 'doors open': m({ doors: 1 }) };
	return { rig: r, clips, poses, first: 'shuttle' };
}
