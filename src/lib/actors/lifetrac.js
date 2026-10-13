/*
 * THE LIFETRAC — Open Source Ecology's open-source tractor, as its newest design draws it: LifeTrac v25 (OSE's
 * GitHub, December 2025 to October 2026), a compact loader between a Toro Dingo and a Bobcat, driven by radio and with
 * no seat. Every part of it is its own part (./parts.js): picked on the turntable it shows its card — what it is, what
 * moves it, its numbers from OSE's own bill of materials — and it can be shown alone, drawn out of the machine in the
 * exploded view, or watched going on in the build.
 *
 * Built to OSE's CAD (DESIGN-STRUCTURAL/openscad/lifetrac_v25_params.scad, bom.csv): its frame is two sandwiches of
 * 1/2" plate, one each side, bolted to the floor plate, two 6×2 tubes and stiffener plates; four Universal Wheel
 * Units, each a 100 cc hydraulic motor straight on its wheel shaft (no chains, skid-steered: the left pair on one
 * valve, the right pair on another); L-shaped loader arms pivoting in the sandwiches' gaps on 1½" pins, raised by two
 * 2.5" cylinders, the bucket tipped by two 3" cylinders from the cross beam; a folding deck at the back to stand on.
 * What the CAD does not draw yet — the power unit (an 18 hp Vanguard V-twin on a 1.4 in³ gear pump), the tank, the
 * valve block, the controller's box — is placed here where it fits, sized from OSE's hydraulic and controller bills.
 * The tyres are drawn as the CAD draws them (617.5 mm, touching the ground); the real 12-16.5 tyre is 851 mm.
 *
 * Built facing +z, on y 0; OSE's coordinates (X across, Y forward from the frame's back, Z up, mm) through `P`.
 * Moves: work (a loader cycle: in, scoop, lift, back, dump, lower), drive, turn (a skid turn on the spot), lift,
 * curl, platform (the deck folded down and up), assemble (built step by step), explode (drawn apart and back), idle.
 * The engine runs in every move (its flywheel, coupling and the cooler's fan turning, slowed to be seen), the valves'
 * coils light as they are switched, and the handheld's sticks move as the machine does.
 */
import * as THREE from 'three';
import { loop, rig, skin } from './rig';
import { block, beam, ease } from './excavator-rig.js';
import { machineKit } from './parts.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Pose} Pose */
/** @typedef {import('./rig').Cast} Cast */
/** @typedef {import('./rig').BoneSpec} BoneSpec */
/** @typedef {[number, number, number]} MM a point in OSE's coordinates, mm */

const GREEN = '#1f5e50', ARM = '#45b58f', STEEL = '#8d9396', DARK = '#2b2d2f', ORANGE = '#ef9a1c', CHROME = '#dcdcd8', YELLOW = '#e9c21b';
const TYRE = '#1b1c1e', RIM = '#c9cbc6', ENGINE = '#2f3133', BLACK = '#161718', RED = '#d8302a', AMBER = '#ffb21a', PCB = '#1f6b3a';
const BLUE = '#2f6fb5', HOSE = '#202224', COPPER = '#b8743a', ALU = '#b9bdbf', LED = '#43f08a', TEAL = '#1aa6a0';

const S = 0.001;
/** the actor's middle: this far forward of the frame's back (mm) */
const BACK = 760;
/** a point of OSE's CAD in the actor @param {number} X @param {number} Y @param {number} Z @returns {V3} */
const P = (X, Y, Z) => [X * S, Z * S, (Y - BACK) * S];
const V = (/** @type {MM} */ a) => new THREE.Vector3(...P(...a));

/* ── shapes, in mm ─────────────────────────────────────────────────────────── */

/** a box: its middle, w across (X), l along (Y), h high (Z) @param {number} X @param {number} Y @param {number} Z @param {number} w @param {number} l @param {number} h @param {number} [r] */
const box = (X, Y, Z, w, l, h, r = 2) => block(w * S, h * S, l * S, P(X, Y, Z), r * S);
/** a bar from a to b, w across and h deep @param {MM} a @param {MM} b @param {number} w @param {number} h @param {number} [r] */
const bar = (a, b, w, h, r = 2) => beam(P(...a), P(...b), w * S, h * S, r * S);
/** a round bar from a to b @param {MM} a @param {MM} b @param {number} r @param {number} [seg] @param {number} [r1] */
function cyl(a, b, r, seg = 18, r1 = r) {
	const A = V(a), B = V(b);
	const g = new THREE.CylinderGeometry(r1 * S, r * S, A.distanceTo(B), seg);
	g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()), new THREE.Vector3(1, 1, 1)));
	return g;
}
/** a disc or round bar across, from X0 to X1 @param {number} X0 @param {number} X1 @param {number} Y @param {number} Z @param {number} r @param {number} [seg] */
const xcyl = (X0, X1, Y, Z, r, seg = 24) => cyl([X0, Y, Z], [X1, Y, Z], r, seg);
/** a hex head (a bolt's or a nut's) at a point, along an axis @param {MM} at @param {'x' | 'y' | 'z'} axis @param {number} [af] @param {number} [h] */
function hex(at, axis, af = 19, h = 8) {
	const g = new THREE.CylinderGeometry((af / Math.sqrt(3)) * S, (af / Math.sqrt(3)) * S, h * S, 6);
	if (axis === 'x') g.rotateZ(Math.PI / 2);
	if (axis === 'y') g.rotateX(Math.PI / 2);
	g.translate(...P(...at));
	return g;
}
/** a plate standing on its edge in the side plane, its outline in (Y, Z), from X0 to X0 + t @param {[number, number][]} pts @param {number} X0 @param {number} t */
function side(pts, X0, t) {
	const sh = new THREE.Shape(pts.map(([y, z]) => new THREE.Vector2((y - BACK) * S, z * S)));
	const g = new THREE.ExtrudeGeometry(sh, { depth: t * S, bevelEnabled: false, curveSegments: 16 });
	g.rotateY(-Math.PI / 2);
	g.translate((X0 + t) * S, 0, 0);
	return g;
}
/** a box w (X) × h × l tilted `a` (rad, up from forward, in the side plane), its middle at a point @param {number} w @param {number} h @param {number} l @param {number} a @param {MM} at */
function tilted(w, h, l, a, at) {
	const g = block(w * S, h * S, l * S, [0, 0, 0], 2 * S);
	g.rotateX(-a);
	g.translate(...P(...at));
	return g;
}
/** a hose along points @param {MM[]} pts @param {number} [r] */
const hose = (pts, r = 9.5) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V)), Math.max(12, pts.length * 10), r * S, 8, false);
/** a ring round x (a tyre's section turned on a lathe) @param {[number, number][]} prof (radius, x) @param {number} X @param {number} Y @param {number} Z @param {number} [seg] */
function lathe(prof, X, Y, Z, seg = 40) {
	const g = new THREE.LatheGeometry(prof.map(([r, x]) => new THREE.Vector2(r * S, x * S)), seg);
	g.rotateZ(-Math.PI / 2);
	g.translate(...P(X, Y, Z));
	return g;
}

/* ── the loader's geometry (OSE's solver, at rest: arms down, bucket flat on the ground) ── */

const D = Math.PI / 180;
/** the arms' pivot (Y, Z), their angle at rest, and the arm's elbow and tip in the arm's own frame (u along, v up) */
const PIV = /** @type {[number, number]} */ ([200, 1100]), TH0 = -27.71 * D;
const ELB = /** @type {[number, number]} */ ([1417.7, 117.8]), TIP = /** @type {[number, number]} */ ([1762.0, -249.3]);
/** a point of the arm (u, v) where it is at rest (Y, Z) @param {number} u @param {number} v @returns {[number, number]} */
const armAt = (u, v) => [PIV[0] + u * Math.cos(TH0) - v * Math.sin(TH0), PIV[1] + u * Math.sin(TH0) + v * Math.cos(TH0)];
const MAIN = Math.atan2(ELB[1], ELB[0]) + TH0; // the main tube's slope at rest
const [TY, TZ] = armAt(...TIP);
const ARM_X = 450, BCYL_X = 315.4;
/** the cylinders' pins at rest (Y, Z): the lift cylinders' base on the frame, rod end on the arm; the bucket cylinders'
 *  base under the cross beam, rod end on the bucket */
const LIFT_A = /** @type {[number, number]} */ ([50, 600]), LIFT_B = armAt(828.5, -114.3);
const T3_U = 736.5, T3_V = ELB[1] * (T3_U / ELB[0]) - 76.2 - 25.4;
const BCYL_A = armAt(T3_U, T3_V - 25.4 - 50);
const BCYL_B = /** @type {[number, number]} */ ([TY, TZ + 300]);
/** the axles: Y of the rear and the front, their height, the wheels' X */
const AX = { rear: 400, front: 1150, z: 308.75, x: 707, r: 308.75 };
/** the engine's crank (and the pump's shaft) height, the flywheel's Y, the coupling's, the cooler fan's place */
const CRANK = 330, FLY_Y = 1000, CPL_Y = 602, FAN = /** @type {MM} */ ([0, 1288, 560]);
/** the deck's pivot (Y, Z) */
const DECK = /** @type {[number, number]} */ ([75.4, 330]);
/** where the handheld sits (a holster on the back plate), tilted to the one standing behind */
const HAND = /** @type {MM} */ ([0, -40, 1010]), HAND_TILT = -0.9;

/** the wheels, by corner */
const CORNERS = /** @type {const} */ ([
	{ id: 'fl', label: 'front left', sx: 1, y: AX.front },
	{ id: 'fr', label: 'front right', sx: -1, y: AX.front },
	{ id: 'rl', label: 'rear left', sx: 1, y: AX.rear },
	{ id: 'rr', label: 'rear right', sx: -1, y: AX.rear }
]);
/** the valves' stations on the manifold (across), the coils they carry and what each does */
const STATIONS = /** @type {const} */ ([
	{ id: 'left', x: 165, a: 'D1', b: 'D2', what: 'the left wheels', ya: 'forward', yb: 'back' },
	{ id: 'arms', x: 55, a: 'D5', b: 'D6', what: 'the loader arms', ya: 'up', yb: 'down' },
	{ id: 'bucket', x: -55, a: 'D7', b: 'D8', what: 'the bucket', ya: 'curl', yb: 'dump' },
	{ id: 'right', x: -165, a: 'D3', b: 'D4', what: 'the right wheels', ya: 'forward', yb: 'back' }
]);
const MAN_Y = 410, MAN_Z = 905;

const SRC = {
	repo: 'OSE LifeTrac v25 (GitHub)',
	bom: 'v25 bill of materials',
	params: 'v25 CAD parameters',
	hyd: 'v25 hydraulic BOM',
	ctl: 'v25 controller BOM',
	sa: 'v25 structural analysis',
	uwu: 'Universal Wheel Unit',
	lt6: 'LifeTrac 6 (OSE wiki)'
};

/** @type {import('./parts.js').Assembly[]} */
const ASSEMBLIES = [
	{ id: 'frame', label: 'Frame', note: 'Two sandwiches of 1/2" plate, one each side, 120 mm apart for the arms and lift cylinders to work in, bolted to a floor plate, two 6×2 cross tubes and stiffeners with grade-8 bolts. Welding only at the arm pivots and the wheel hubs.', out: [0, -0.25, 0] },
	...CORNERS.map((c) => ({ id: `uwu-${c.id}`, label: `Wheel unit, ${c.label}`, note: `A Universal Wheel Unit: a 100 cc/rev hydraulic motor bolted to the motor plate, coupled straight to a 1¼" shaft in two flange bearings, a welded hub and a Bobcat wheel. No chain, no gearbox.`, out: /** @type {V3} */ ([c.sx * 0.95, -0.1, c.y === AX.front ? 0.45 : -0.45]) })),
	{ id: 'power', label: 'Power unit', note: 'The prime mover: an 18 hp Briggs & Stratton Vanguard V-twin turning a 1.4 in³ gear pump through an SAE-A bell housing and a jaw coupling, about 11 gpm at up to 3,000 psi. Not drawn in OSE’s CAD yet; placed here where it fits.', out: [0, 1.35, 0.1] },
	{ id: 'hydraulics', label: 'Hydraulic circuit', note: 'Tank, pump line, relief, the proportional flow valve that sets every speed, a four-station manifold of 12 V directional valves (left wheels, right wheels, arms, bucket), the cooler, the return filter and the hoses.', out: [0, 1.9, -0.75] },
	{ id: 'arms', label: 'Loader arms', note: 'Two L-shaped arms, each a 6×2 tube between two 1/4" side plates, pivoting on 1½" pins in the frame’s sandwiches and tied together by the cross beam that carries the bucket cylinders.', out: [0, 0.75, 0.25] },
	{ id: 'cylinders', label: 'Cylinders', note: 'Four double-acting hydraulic cylinders: two 2.5" lift cylinders raise the arms, two 3" bucket cylinders curl and dump the bucket. Each is a barrel on one pin and a rod on the other.', out: [0, 0.35, 0.55] },
	{ id: 'bucket', label: 'Bucket', note: 'A 1,100 mm bucket of 1/4" plate with a 3/4" cutting edge, pinned at the arms’ tips and tipped by the bucket cylinders.', out: [0, 0.15, 0.95] },
	{ id: 'platform', label: 'Standing platform', note: 'A folding deck at the back for an operator to ride on; folded up when the machine is driven by radio, as it is meant to be.', out: [0, -0.1, -0.9] },
	{ id: 'electronics', label: 'Controller and radio', note: 'The tractor node: a Portenta X8 on its Max Carrier (Linux, the LoRa radio, the arbiter) driving an Arduino Opta over Modbus, whose solid-state outputs switch the eight valve coils; a safety relay, the battery, the mast with its antennas, cameras and beacon, and the handheld it obeys.', out: [0, 2.6, -0.35] }
];

const STEPS = [
	'Bolt the frame: floor plate and its angle runs, back and front walls, motor plates, inner and outer side panels, cross tubes',
	'Mount the four wheel units: motors on the motor plates, shafts through the bearings, hubs, wheels',
	'Set in the power unit: engine, bell housing, jaw coupling, pump, fuel tank',
	'Plumb the hydraulics: tank, suction and pressure lines, relief, flow valve, valve manifold, cooler, filter, hoses',
	'Hang the loader arms on their pivot pins and bolt in the cross beam',
	'Pin in the lift and bucket cylinders',
	'Pin on the bucket',
	'Bolt on the folding platform',
	'Wire the controller: node box, boards, safety relay, battery, mast, antennas, cameras, beacon, E-stop; pair the handheld'
];

/**
 * LifeTrac v25, every part its own.
 * @returns {Cast}
 */
export function lifetrac() {
	const kit = machineKit(ASSEMBLIES);
	const part = kit.part;

	/* ── 1. the frame ─────────────────────────────────────────────────────── */
	/** a side panel's outline (Y, Z): the arms' slope along its top, the pivot's boss at its back @param {number} len @param {number} drop */
	const panel = (len, drop) => /** @type {[number, number][]} */ ([
		[0, 150], [len, 150], [len, 480 - drop], [1300 * (len / 1392.6), 525 - drop], [330, 925 - drop], [292, 1040 - drop],
		[268, 1128 - drop * 0.4], [232, 1166 - drop * 0.4], [200, 1176 - drop * 0.4], [168, 1168 - drop * 0.4], [128, 1150 - drop], [0, 1150 - drop]
	]);
	for (const [sx, id, P_] of /** @type {const} */ ([[1, 'P1', 'left'], [-1, 'P2', 'right']])) {
		part(
			{ id: `outer-${P_}`, label: `Outer side panel, ${P_} (${id})`, assembly: 'frame', step: 1, source: SRC.bom, what: `The outside wall of the ${P_} sandwich, the machine’s biggest part: cut from 1/2" A36 plate, it carries the arm’s pivot pin and the lift cylinder’s base pin on one side of the 120 mm gap, and the wheel bearings’ outer flanges.`, specs: [['BOM', id], ['Stock', 'PL 1/2" (12.7 mm) A36'], ['Size', '1,392.6 × 1,000 mm'], ['Mass', '82.8 kg'], ['Holes', '24']] },
			'base',
			(put) => put(side(panel(1392.6, 0), sx > 0 ? 510 : -522.7, 12.7), GREEN)
		);
	}
	for (const [sx, P_] of /** @type {const} */ ([[1, 'left'], [-1, 'right']])) {
		part(
			{ id: `inner-${P_}`, label: `Inner side panel, ${P_} (P3)`, assembly: 'frame', step: 1, source: SRC.bom, what: 'The inside wall of a sandwich: with the outer panel 120 mm away it makes the slot the loader arm and its lift cylinder swing in, so the pins are held at both ends (double shear) instead of hanging off one plate.', specs: [['BOM', 'P3 (2 per machine)'], ['Stock', 'PL 1/2" A36'], ['Size', '1,349.2 × 968.2 mm'], ['Mass', '75.7 kg'], ['Gap to outer panel', '120 mm']] },
			'base',
			(put) => put(side(panel(1349.2, 32), sx > 0 ? 377.3 : -390, 12.7), GREEN)
		);
	}
	part(
		{ id: 'floor', label: 'Bottom stiffener plate (P7)', assembly: 'frame', step: 1, source: SRC.bom, what: 'The floor of the frame and its first part: the angle runs are bolted to it, then everything stands on them. It ties the bottoms of the four side panels and the motor plates together.', specs: [['BOM', 'P7'], ['Stock', 'PL 1/4" (6.35 mm) A36'], ['Size', '1,196.8 × 1,020 mm'], ['Mass', '60.6 kg'], ['Holes', '80'], ['Ground clearance', '150 mm']] },
		'base',
		(put) => put(box(0, 698, 153.2, 1020, 1196.8, 6.35, 1), GREEN)
	);
	part(
		{ id: 'floor-angles', label: 'Bottom angle runs (A6)', assembly: 'frame', step: 1, count: 30, source: SRC.bom, what: 'Six runs of 2×2×1/4 angle, three segments each, bolted along the floor plate under every panel line: the panels and motor plates stand on their vertical legs and are bolted through them.', specs: [['BOM', 'A6-1, A6-2, A6-3 (10 each)'], ['Stock', 'L2×2×1/4 A36'], ['Segments', '200, 300 and 250 mm']] },
		'base',
		(put) => {
			for (const x of [365, 262, 213, -213, -262, -365]) {
				put(box(x, 698, 159.5, 50.8, 1150, 6.35, 1), STEEL);
				put(box(x + (x > 0 ? -22 : 22), 698, 182, 6.35, 1150, 50.8, 1), STEEL);
			}
		}
	);
	part(
		{ id: 'back-wall', label: 'Back stiffener plate (P4)', assembly: 'frame', step: 1, source: SRC.bom, what: 'The back wall, closing the frame between the sandwiches high up behind the arm pivots: it squares the frame and carries the mast, the E-stop and the handheld’s holster. Below it the frame is open for the folding platform.', specs: [['BOM', 'P4'], ['Stock', 'PL 1/4" A36'], ['Size', '1,020 × 650 mm'], ['Mass', '33.0 kg']] },
		'base',
		(put) => put(box(0, 3.2, 825, 1020, 6.35, 650, 1), GREEN)
	);
	part(
		{ id: 'back-angles', label: 'Back wall angles (A1, A2)', assembly: 'frame', step: 1, count: 6, source: SRC.bom, what: 'Six vertical 2×2 angles bolted to the back plate, two at its outer edges and four inside, joining it to the side panels and stiffening it.', specs: [['BOM', 'A1 ×2, A2 ×4'], ['Stock', 'L2×2×1/4'], ['Length', '650 mm']] },
		'base',
		(put) => {
			for (const x of [495, 403, 364, -364, -403, -495]) {
				put(box(x, 32, 825, 6.35, 50.8, 650, 1), STEEL);
				put(box(x, 9.5, 825, 50.8, 6.35, 650, 1), STEEL);
			}
		}
	);
	part(
		{ id: 'front-wall', label: 'Front stiffener plates (P5, P6)', assembly: 'frame', step: 1, count: 3, source: SRC.bom, what: 'Three small plates closing the front: the centre plate low between the inner panels, and an outer plate across the front of each sandwich’s gap, all bolted through eight short angles (A10).', specs: [['BOM', 'P5 ×1, P6 ×2, A10 ×8'], ['P5', '481.6 × 260.4 mm, 6.2 kg'], ['P6', '269.2 × 127 mm, 1.7 kg']] },
		'base',
		(put) => {
			put(box(0, 1389.4, 280, 481.6, 6.35, 260.4, 1), GREEN);
			for (const sx of [-1, 1]) put(box(sx * 450, 1389.4, 285, 127, 6.35, 269.2, 1), GREEN);
		}
	);
	for (const [sx, P_] of /** @type {const} */ ([[1, 'left'], [-1, 'right']])) {
		part(
			{ id: `motor-plate-${P_}`, label: `Motor mounting plate, ${P_} (P8)`, assembly: 'frame', step: 1, source: SRC.bom, what: 'A 10" high plate standing 6" inboard of the inner panel the whole length of the frame: both wheel motors of its side bolt to it, their shafts passing out through the panels to the wheels.', specs: [['BOM', 'P8 (2 per machine)'], ['Stock', 'PL 1/4" A36'], ['Size', '1,196.8 × 254 mm'], ['Mass', '14.1 kg'], ['Inboard of inner panel', '152.4 mm']] },
			'base',
			(put) => put(box(sx * 237.6, 698, 279, 6.35, 1196.8, 254, 1), GREEN)
		);
	}
	part(
		{ id: 'cross-tubes', label: 'Front and rear cross tubes (T1, T2)', assembly: 'frame', step: 1, count: 2, source: SRC.bom, what: 'Two 6×2 rectangular tubes running right across the frame through all six plates, bolted to each by angle clips: they hold the two sandwiches at their distance and keep the frame from racking.', specs: [['BOM', 'T1, T2'], ['Stock', 'HSS 6×2×1/4 A500'], ['Length', '1,070.8 mm'], ['Mass', '20.2 kg each'], ['Clips', '26 tube mount angles (A4)']] },
		'base',
		(put) => {
			for (const y of [130, 1290]) {
				put(box(0, y, 309, 1070.8, 50.8, 152.4, 3), STEEL);
				for (const x of [383, 516, 237, -237, -383, -516]) put(box(x + (x > 0 ? -10 : 10), y + 40, 309, 6.35, 50.8, 146, 1), STEEL);
			}
		}
	);
	part(
		{ id: 'bolts', label: 'Grade-8 bolts, nuts and washers (F3–F8)', assembly: 'frame', step: 1, count: 324, source: SRC.bom, what: 'The frame is bolted, not welded, so it can be built with a drill and taken apart for repair: 154 half-inch and 170 three-eighths grade-8 bolts, each with its nut and two hardened washers.', specs: [['1/2-13 Gr 8', '154 bolts, 154 nuts, 308 washers'], ['3/8-16 Gr 8', '170 bolts, 170 nuts, 340 washers'], ['Whole machine', '1,521 pieces, 60 kinds']] },
		'base',
		(put) => {
			for (const sx of [-1, 1]) {
				const x = sx * 526;
				for (let y = 120; y < 1380; y += 160) put(hex([x, y, 182], 'x', 19, 8), DARK);
				for (const y of [130, 1290]) for (const z of [260, 360]) put(hex([x, y + 40, z], 'x', 19, 8), DARK);
				for (const z of [560, 720, 880, 1040]) put(hex([x, 30, z], 'x', 19, 8), DARK);
			}
			for (const x of [495, 403, 364, -364, -403, -495]) for (const z of [560, 720, 880, 1040]) put(hex([x, -4, z], 'y', 19, 8), DARK);
		}
	);

	/* ── 2. the wheel units ───────────────────────────────────────────────── */
	for (const c of CORNERS) {
		const sx = c.sx, y = c.y, z = AX.z, a = `uwu-${c.id}`, j = `wheel_${c.id}`;
		const X = (/** @type {number} */ x) => sx * x;
		const front = y === AX.front;
		part(
			{ id: `${a}-motor`, label: `Wheel motor, ${c.label}`, assembly: a, step: 2, source: SRC.uwu, what: `A low-speed, high-torque hydraulic motor (orbital, gerotor class) driving the ${c.label} wheel directly. Oil from its side’s valve turns it; swapping the oil’s way through it (the valve’s other coil) turns it back.`, moves: 'Its output shaft turns with the wheel; the body stays bolted to the motor plate.', drive: `The ${sx > 0 ? 'left' : 'right'} drive valve (${sx > 0 ? 'D1 forward / D2 back' : 'D3 forward / D4 back'}), its pair in parallel`, specs: [['Displacement', '100 cc/rev'], ['Ports', '1/2" NPT'], ['Shaft', 'Ø1" × 1.5"'], ['Mount', '7.5" square flange, 4 × 1/2" bolts on 8.25" BCD'], ['Body', 'Ø6" × 5"'], ['Class', 'White RS, Char-Lynn H or Parker TG (to bench-test)']] },
			'base',
			(put) => {
				put(xcyl(X(98), X(221), y, z, 76.2, 28), ORANGE);
				put(box(X(227.5), y, z, 12.7, 190.5, 190.5, 6), ORANGE);
				for (const [dy, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) put(hex([X(214), y + dy * 74, z + dz * 74], 'x', 19, 10), DARK);
				for (const dy of [-30, 30]) put(xcyl(X(140), X(170), y + dy, z + 82, 11, 10), STEEL); // the two ports
			}
		);
		part(
			{ id: `${a}-shaft`, label: `Wheel shaft, ${c.label} (R6)`, assembly: a, step: 2, source: SRC.bom, what: 'A 1¼" round shaft from the motor’s coupling out through both bearings to the hub: it carries the wheel’s weight on the bearings and the motor’s torque to the hub.', moves: 'Turns with the wheel.', drive: 'The wheel motor, through the coupling', specs: [['BOM', 'R6 (4 per machine)'], ['Stock', 'Ø1-1/4" (31.75 mm) shafting'], ['Length', '474 mm'], ['Mass', '2.93 kg']] },
			j,
			(put) => {
				put(xcyl(X(268), X(742), y, z, 15.9, 16), CHROME);
				put(box(X(560), y, z + 14, 60, 8, 4, 1), DARK); // its key, so its turning shows
			}
		);
		part(
			{ id: `${a}-coupling`, label: `Shaft coupling, ${c.label}`, assembly: a, step: 2, source: SRC.params, what: 'A 2" sleeve joining the motor’s 1" shaft to the 1¼" wheel shaft, so the motor never carries the wheel’s load: the bearings do.', moves: 'Turns with the shaft.', drive: 'The motor', specs: [['Size', 'Ø2" × 2"'], ['Joins', 'Ø1" motor shaft to Ø1¼" wheel shaft']] },
			j,
			(put) => {
				put(xcyl(X(240), X(291), y, z, 25.4, 18), STEEL);
				for (const xx of [252, 279]) put(hex([X(xx), y, z + 26], 'z', 10, 6), DARK);
			}
		);
		part(
			{ id: `${a}-bearings`, label: `Flange bearings, ${c.label}`, assembly: a, step: 2, count: 2, source: SRC.uwu, what: 'Two 4-bolt flange bearings, one on the inner panel and one on the outer, holding the shaft at both ends of the sandwich so the wheel’s load is carried across the 120 mm gap.', moves: 'Their inner races turn with the shaft; the housings are bolted still.', specs: [['Bore', '1-1/4"'], ['Housing', 'Ø2.5"'], ['Bolts', '4 × 1/2" on 6.19" BCD'], ['Pattern', 'Bolted at 45°']] },
			'base',
			(put) => {
				for (const [x0, x1] of [[346, 377], [523, 554]]) {
					put(box(X((x0 + x1) / 2), y, z, x1 - x0, 145, 145, 14), DARK);
					put(xcyl(X(x0 - 6), X(x1 + 6), y, z, 31.75, 20), STEEL);
					for (const [dy, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) put(hex([X(sx > 0 ? x1 + 2 : x0 - 2), y + dy * 55.6, z + dz * 55.6], 'x', 19, 6), STEEL);
				}
			}
		);
		part(
			{ id: `${a}-hub`, label: `Wheel hub, ${c.label} (P17, T7, P18)`, assembly: a, step: 2, source: SRC.bom, what: 'A DIY hub: a 2" DOM tube bored to slip on the shaft and locked to it with a 1/2" cross-bolt, welded to a 9" lug plate of 1/2" steel braced by four gussets. The Bobcat wheel bolts to the plate’s eight studs.', moves: 'Turns with the shaft.', drive: 'The shaft, through its cross-bolt', specs: [['Hub plate P17', 'Ø228.6 × 12.7 mm, 8 × 5/8" holes on 8" BCD'], ['DOM tube T7', '50.8 OD × 6.35 wall × 139.7 mm'], ['Gussets P18', '4 × 86.4 × 83.9 mm, 1/4" plate'], ['Option', 'QD (SK-class) taper bushing']] },
			j,
			(put) => {
				put(xcyl(X(580), X(667), y, z, 25.4, 20), STEEL);
				put(xcyl(X(667), X(679.7), y, z, 114.3, 32), STEEL);
				for (let k = 0; k < 4; k++) {
					const t = (k * Math.PI) / 2 + Math.PI / 8;
					put(tilted(6.35, 70, 70, 0, [X(630), y + Math.cos(t) * 55, z + Math.sin(t) * 55]).rotateY(0), STEEL);
				}
				put(xcyl(X(600), X(612), y, z + 26, 7, 8).rotateX(0), DARK); // the cross-bolt's head
			}
		);
		part(
			{ id: `${a}-wheel`, label: `Wheel and tyre, ${c.label}`, assembly: a, step: 2, source: SRC.params, what: 'A Bobcat skid-steer wheel (P/N 7232567): a 12-16.5 tyre on a 16.5 × 10 rim with eight lug nuts. The CAD draws it 617.5 mm across so it stands on the ground; the real tyre is 851 mm, which would lift the frame by about 116 mm.', moves: 'Rolls. With no steering, the machine turns by skidding: the left and right pairs driven at different speeds or opposite ways.', drive: 'Its wheel motor, through shaft and hub', specs: [['Tyre', '12-16.5 (OD 851 mm, 254 mm wide)'], ['As drawn', 'OD 617.5 mm'], ['Rim', '16.5 × 10, offset 94 mm'], ['Lugs', '8 on 8" (203.2 mm) BCD'], ['Centre bore', '3"']] },
			j,
			(put) => {
				const x0 = 580, x1 = 834, rr = 209.5, R = AX.r;
				// the tyre: its section turned round, and its tread bars across, staggered, so its turning shows
				const pr = /** @type {[number, number][]} */ ([[rr, X(x0 + 6)], [rr + 40, X(x0)], [R - 22, X(x0 + 2)], [R - 4, X(x0 + 18)], [R - 4, X(x1 - 18)], [R - 22, X(x1 - 2)], [rr + 40, X(x1)], [rr, X(x1 - 6)]]);
				if (sx < 0) pr.reverse();
				put(lathe(pr, 0, y, z, 44), TYRE);
				const n = 22;
				for (let k = 0; k < n; k++) {
					const t = (k / n) * Math.PI * 2;
					for (const half of [0, 1]) {
						const tt = t + (half ? Math.PI / n : 0);
						const g = block(0.105, 0.018, 0.05, [0, 0, 0], 0.006);
						g.rotateY(half ? 0.35 : -0.35);
						g.translate(X(half ? 770 : 645) * S, (R + 2) * S, 0);
						g.rotateX(-tt);
						g.translate(0, z * S, (y - BACK) * S);
						put(g, TYRE);
					}
				}
				// the rim: its barrel and its centre disc at the hub, the lug nuts on it
				put(lathe(sx > 0 ? [[rr, x0 + 4], [rr - 8, x0 + 14], [rr - 8, x1 - 14], [rr, x1 - 4]].map(([r, x]) => /** @type {[number, number]} */ ([r, X(x)])) : [[rr, x1 - 4], [rr - 8, x1 - 14], [rr - 8, x0 + 14], [rr, x0 + 4]].map(([r, x]) => /** @type {[number, number]} */ ([r, X(x)])), 0, y, z, 40), RIM);
				put(xcyl(X(680), X(688), y, z, rr - 10, 40), RIM);
				put(xcyl(X(686), X(692), y, z, 38.1, 18), DARK);
				for (let k = 0; k < 8; k++) {
					const t = (k / 8) * Math.PI * 2;
					put(hex([X(694), y + Math.cos(t) * 101.6, z + Math.sin(t) * 101.6], 'x', 19, 12), STEEL);
				}
			}
		);
		part(
			{ id: `${a}-hoses`, label: `Motor hoses, ${c.label}`, assembly: a, step: 4, count: 2, source: SRC.hyd, what: `The two work lines of the ${c.label} motor: one feeds it, the other takes the oil back; which is which depends on the way it is driven. Its partner on the same side is fed in parallel, so both wheels of a side always turn together.`, specs: [['Hose', 'SAE 100R2, -8 (1/2")'], ['Fittings', 'JIC 37°'], ['Pair', front ? 'teed to the rear motor’s lines' : 'from the drive valve']] },
			'base',
			(put) => {
				const st = STATIONS.find((s) => s.id === (sx > 0 ? 'left' : 'right'));
				const vx = /** @type {number} */ (st?.x);
				for (const [k, dy] of [[0, -28], [1, 28]]) {
					const end = /** @type {MM} */ ([X(155), y + dy, z + 92]);
					put(hose(front ? [end, [X(170), y + dy - 40, 470], [X(320), y - 300, 480], [X(320), 520, 520], [vx + (k ? 10 : -10), MAN_Y - 60, MAN_Z - 60]] : [end, [X(170), y + dy, 470], [X(220), MAN_Y - 50, 760], [vx + (k ? 10 : -10), MAN_Y - 50, MAN_Z - 60]]), HOSE);
				}
			}
		);
	}

	/* ── 3. the power unit ────────────────────────────────────────────────── */
	part(
		{ id: 'engine-block', label: 'Engine crankcase', assembly: 'power', step: 3, source: SRC.hyd, what: 'The Vanguard’s crankcase: the crankshaft, cam and oil sump of a 570 cc V-twin petrol engine, governed at 3,600 rpm. Its shaft runs fore and aft: the flywheel and blower in front, the pump at the back.', moves: 'The crankshaft inside turns at engine speed.', drive: 'Petrol; electric start from the 12 V battery', specs: [['Engine', 'Briggs & Stratton Vanguard 18 HP V-twin'], ['Displacement', '570 cc'], ['Power', '18 hp gross, ~16 net at 3,600 rpm'], ['Shaft', '1-1/8" × 2.96" keyed'], ['Mass', '~39 kg (85 lb)'], ['Upgrades named', 'Vanguard 23 hp, Honda GX630, Kohler CH640/730'], ['CAD placeholder', '25 hp (OSE target: 60 hp total)']] },
		'base',
		(put) => {
			put(box(0, 800, 160, 460, 330, 10, 1), STEEL); // the mount plate
			put(box(0, 790, 290, 250, 290, 250, 26), ENGINE);
			put(box(0, 790, 168, 300, 300, 18, 6), DARK); // the sump
			for (const sx of [-1, 1]) for (const yy of [670, 910]) put(hex([sx * 190, yy, 168], 'z', 19, 10), STEEL);
		}
	);
	for (const [sx, P_] of /** @type {const} */ ([[1, 'left'], [-1, 'right']])) {
		part(
			{ id: `engine-cyl-${P_}`, label: `Engine cylinder and head, ${P_}`, assembly: 'power', step: 3, source: SRC.hyd, what: 'One bank of the 90° V-twin: a finned, air-cooled cylinder and its overhead-valve head. The fins carry the heat out into the air the flywheel’s blower pushes over them.', moves: 'Its piston goes up and down inside, two strokes for every turn of the crank.', drive: 'Burning petrol and air, fired by the ignition', specs: [['Layout', '90° V-twin, OHV'], ['Cooling', 'Air, forced by the flywheel fan'], ['Bore × stroke', '~72 × 70 mm (each)']] },
			'base',
			(put) => {
				const dir = new THREE.Vector3(sx * Math.SQRT1_2, Math.SQRT1_2, 0);
				const base = new THREE.Vector3(...P(0, 790, CRANK));
				const at = (/** @type {number} */ d) => /** @type {MM} */ ([(base.x + dir.x * d * S) / S, 790, (base.y + dir.y * d * S) / S]);
				put(cyl(at(110), at(270), 50, 20), DARK);
				for (let d = 125; d < 270; d += 13) put(cyl(at(d), at(d + 4), 72, 20), ENGINE);
				put(cyl(at(270), at(330), 70, 16), ENGINE);
				const vc = at(345);
				const g = block(0.13, 0.04, 0.16, [0, 0, 0], 0.012);
				g.rotateZ(-sx * Math.PI / 4);
				g.translate(...P(...vc));
				put(g, BLACK);
				put(cyl(at(300), [sx * 120, 700, 640], 9, 8), DARK); // the exhaust pipe to the muffler
			}
		);
	}
	part(
		{ id: 'blower', label: 'Blower housing', assembly: 'power', step: 3, source: SRC.hyd, what: 'The sheet-steel shroud over the flywheel at the engine’s front, ducting the flywheel fan’s air back over both cylinders’ fins.', specs: [['Material', 'Pressed steel'], ['Holds', 'The flywheel screen and the recoil-free electric-start ring']] },
		'base',
		(put) => {
			put(box(0, 955, 330, 430, 70, 360, 30), '#3a3d40');
		}
	);
	part(
		{ id: 'flywheel', label: 'Flywheel and fan screen', assembly: 'power', step: 3, source: SRC.hyd, what: 'The flywheel at the crank’s front end: its mass smooths the twin’s firing pulses, its magnets fire the ignition and charge the 16 A alternator, its vanes are the cooling fan.', moves: 'Turns with the crankshaft (shown slowed down: really 60 turns a second).', drive: 'The crankshaft', specs: [['Speed', '3,600 rpm governed'], ['Alternator', '16 A regulated'], ['Screen', 'Rotating grass screen']] },
		'flywheel',
		(put) => {
			put(cyl([0, FLY_Y - 12, CRANK], [0, FLY_Y + 6, CRANK], 120, 32), DARK);
			for (let k = 0; k < 6; k++) {
				const t = (k / 6) * Math.PI;
				put(box(0, FLY_Y + 9, CRANK, 230, 6, 14, 1).rotateZ(0).applyMatrix4(new THREE.Matrix4().makeTranslation(-0, -CRANK * S, -(FLY_Y - BACK) * S)).applyMatrix4(new THREE.Matrix4().makeRotationZ(t)).applyMatrix4(new THREE.Matrix4().makeTranslation(0, CRANK * S, (FLY_Y - BACK) * S)), STEEL);
			}
			put(cyl([0, FLY_Y + 6, CRANK], [0, FLY_Y + 14, CRANK], 30, 16), STEEL);
		}
	);
	part(
		{ id: 'air-cleaner', label: 'Air cleaner', assembly: 'power', step: 3, source: SRC.hyd, what: 'The dry paper element and its housing in the V between the cylinders: every litre of air the engine breathes is filtered here first — a loader works in dust.', specs: [['Element', 'Paper with foam pre-cleaner']] },
		'base',
		(put) => {
			put(box(0, 800, 600, 220, 200, 60, 14), BLACK);
			put(cyl([0, 800, 630], [0, 800, 660], 80, 24), '#3a3d40');
			put(hex([0, 800, 664], 'z', 22, 10), STEEL);
		}
	);
	part(
		{ id: 'muffler', label: 'Muffler', assembly: 'power', step: 3, source: SRC.hyd, what: 'The silencer behind the cylinders, joining both heads’ exhaust into one can and blowing it out sideways, away from the operator’s deck.', specs: [['Type', 'Twin-inlet canister']] },
		'base',
		(put) => {
			put(xcyl(-150, 150, 690, 650, 55, 20), '#505457');
			put(xcyl(-195, -150, 690, 650, 16, 10), DARK);
		}
	);
	part(
		{ id: 'starter', label: 'Electric starter', assembly: 'power', step: 3, source: SRC.hyd, what: 'A 12 V starter motor whose pinion meshes with the flywheel’s ring gear to crank the engine; the key on the controller box’s sense input (I1) tells the controller the engine is meant to run.', moves: 'Spins only while starting.', drive: 'The 12 V battery through its solenoid', specs: [['Voltage', '12 V'], ['Start', 'Electric, key']] },
		'base',
		(put) => {
			put(cyl([-150, 830, 230], [-150, 940, 230], 38, 18), DARK);
			put(cyl([-150, 940, 230], [-150, 960, 230], 22, 12), STEEL);
			put(cyl([-150, 850, 280], [-150, 920, 280], 18, 10), BLACK);
		}
	);
	part(
		{ id: 'oil-filter', label: 'Engine oil filter', assembly: 'power', step: 3, source: SRC.hyd, what: 'The spin-on filter of the engine’s pressure lubrication (not the hydraulic oil’s: that has its own filter on the tank).', specs: [['Type', 'Spin-on, full flow']] },
		'base',
		(put) => put(cyl([150, 870, 220], [215, 870, 220], 38, 18), BLUE)
	);
	part(
		{ id: 'fuel-tank', label: 'Fuel tank', assembly: 'power', step: 3, source: SRC.hyd, what: 'A small petrol tank in front of the engine, feeding it by gravity and its fuel pump. (One of OSE’s BOM lines calls the engine-kill relay a “diesel fuel-cut”; the named engine is petrol.)', specs: [['Fuel', 'Petrol (gasoline)'], ['As drawn', '~5 L']] },
		'base',
		(put) => {
			put(box(0, 1065, 490, 300, 110, 140, 18), RED);
			put(cyl([90, 1065, 560], [90, 1065, 590], 22, 14), BLACK);
			put(hose([[0, 1010, 430], [0, 990, 400], [-60, 960, 380]], 4), BLACK);
		}
	);
	part(
		{ id: 'bell-housing', label: 'SAE-A bell housing', assembly: 'power', step: 3, source: SRC.hyd, what: 'The cast adapter bolting the pump’s SAE-A flange to the engine’s face, holding the two shafts in line; its windows show the coupling inside.', specs: [['Standard', 'SAE-A 2-bolt'], ['Joins', 'Engine 1-1/8" shaft to pump shaft']] },
		'base',
		(put) => {
			put(cyl([0, 625, CRANK], [0, 640, CRANK], 95, 28), ALU);
			put(cyl([0, 565, CRANK], [0, 578, CRANK], 70, 24), ALU);
			for (let k = 0; k < 3; k++) {
				const t = (k / 3) * Math.PI * 2 + 0.5;
				put(cyl([Math.cos(t) * 74, 578, CRANK + Math.sin(t) * 74], [Math.cos(t) * 86, 625, CRANK + Math.sin(t) * 86], 9, 8), ALU);
			}
		}
	);
	part(
		{ id: 'coupling', label: 'Jaw coupling', assembly: 'power', step: 3, source: SRC.hyd, what: 'An L-jaw coupling: two cast-iron hubs, one on each shaft, their jaws meshing through a rubber spider that soaks up the engine’s pulses and a little misalignment.', moves: 'Turns with the engine (shown slowed).', drive: 'The crankshaft; it drives the pump', specs: [['Type', 'L-jaw (Lovejoy class)'], ['Insert', 'Rubber spider']] },
		'coupling',
		(put) => {
			put(cyl([0, 580, CRANK], [0, 598, CRANK], 40, 18), STEEL);
			put(cyl([0, 606, CRANK], [0, 624, CRANK], 40, 18), STEEL);
			for (let k = 0; k < 3; k++) {
				const t = (k / 3) * Math.PI * 2;
				put(box(Math.cos(t) * 28, CPL_Y, CRANK + Math.sin(t) * 28, 22, 22, 22, 3), k % 2 ? DARK : STEEL);
			}
			put(cyl([0, 597, CRANK], [0, 607, CRANK], 36, 18), '#e2b02a');
		}
	);
	part(
		{ id: 'pump', label: 'Hydraulic gear pump', assembly: 'power', step: 3, source: SRC.hyd, what: 'A fixed-displacement gear pump: two meshing gears carry oil from the suction side round to the pressure side, about 41 litres a minute at engine speed. Every motion of the machine starts here.', moves: 'Its gears turn with the engine.', drive: 'The engine, through the jaw coupling', specs: [['Displacement', '1.4 in³/rev (22.9 cc)'], ['Flow', '~11 gpm (41.6 L/min) at 3,600 rpm'], ['Pressure', '3,000 psi continuous, 3,500 peak'], ['Mount', 'SAE-A'], ['Candidates', 'Haldex 1001601, Parker PGP315, Casappa PLP10'], ['Later option', '6+6 gpm tandem pump']] },
		'base',
		(put) => {
			put(box(0, 515, CRANK, 110, 100, 120, 10), '#3b4a5a');
			put(cyl([-55, 515, CRANK], [-80, 515, CRANK], 20, 12), STEEL);
			put(cyl([55, 515, CRANK], [75, 515, CRANK], 14, 12), STEEL);
			put(box(0, 568, CRANK, 120, 10, 90, 3), STEEL);
		}
	);

	/* ── 4. the hydraulic circuit ─────────────────────────────────────────── */
	part(
		{ id: 'tank', label: 'Hydraulic reservoir', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'The oil tank behind the engine: the pump draws from its bottom, every return comes back through its top. Its volume lets the oil settle, lose its air and cool between trips round the circuit.', specs: [['Volume', '~30 gal (114 L) planned; ~110 L drawn'], ['Fluid', 'ISO VG 46 anti-wear oil'], ['Fittings', 'Suction -16, returns -10']] },
		'base',
		(put) => {
			put(box(0, 280, 660, 720, 320, 480, 10), '#3d4447');
			put(box(250, 441, 640, 30, 4, 220, 3), '#9fd7ff'); // the sight gauge
			put(box(250, 443, 640, 40, 4, 240, 3).translate(0, 0, -0.001), DARK);
		}
	);
	part(
		{ id: 'breather', label: 'Filler and breather cap', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'Where the tank is filled, and how it breathes: as the cylinders extend the oil level drops and air must come in, filtered, as they retract it goes out.', specs: [['Filter', 'Air breather element']] },
		'base',
		(put) => {
			put(cyl([-280, 180, 900], [-280, 180, 930], 22, 14), STEEL);
			put(cyl([-280, 180, 930], [-280, 180, 965], 40, 18), BLACK);
		}
	);
	part(
		{ id: 'return-filter', label: 'Return filter', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'A 10-micron spin-on filter on the tank’s top: every drop coming back from the valves and cooler passes through it before it goes back to the pump.', specs: [['Rating', '10 µm'], ['Flow', '25 gpm'], ['Place', 'Return line, after the cooler']] },
		'base',
		(put) => {
			put(cyl([280, 180, 900], [280, 180, 925], 45, 18), STEEL);
			put(cyl([280, 180, 925], [280, 180, 1060], 48, 20), '#c33b2e');
		}
	);
	part(
		{ id: 'suction', label: 'Suction line', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'The big, soft line from the tank’s bottom to the pump’s inlet: wide (-16) so the oil is never pulled hard enough to boil off air and wreck the pump (cavitation).', specs: [['Hose', '-16 (1") suction hose']] },
		'base',
		(put) => put(hose([[-150, 440, 450], [-140, 470, 380], [-110, 500, CRANK], [-82, 515, CRANK]], 16), HOSE)
	);
	part(
		{ id: 'relief', label: 'Relief valve', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'The circuit’s safety: a spring-loaded valve that opens to the tank when the pressure reaches 3,000 psi, so a stalled cylinder or a wheel against a wall never bursts a hose.', moves: 'Its poppet lifts only at its setting.', specs: [['Setting', '3,000 psi (207 bar)'], ['Working pressure', '2,000–2,500 psi']] },
		'base',
		(put) => {
			put(box(150, 460, 600, 60, 40, 60, 4), ALU);
			put(cyl([150, 460, 630], [150, 460, 690], 14, 12), STEEL);
			put(hex([150, 460, 694], 'z', 22, 8), BLACK);
			put(hose([[75, 515, CRANK], [120, 500, 420], [150, 470, 570]], 8), HOSE);
		}
	);
	part(
		{ id: 'efc', label: 'Electronic flow control valve (EFC)', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'The machine’s throttle: a proportional valve that sends only the flow the joystick asks for on to the manifold and bypasses the rest to the tank. Before any spool centres, the firmware ramps it down, so every stop is soft.', moves: 'Its orifice opens in proportion to the signal.', drive: 'The Burkert driver in the node box, 0–10 V from the Opta’s A0602', specs: [['Valve', 'Brand EFC, 10 gpm (README: PEFC12-20, 0–20 gpm)'], ['Modes', 'One valve, or two at 6 gpm each (one per side)'], ['Soft stop', '250–2,000 ms ramp']] },
		'base',
		(put) => {
			put(box(150, 460, 740, 70, 50, 90, 5), '#c4c8ca');
			put(cyl([150, 460, 785], [150, 460, 840], 22, 16), BLACK);
			put(box(150, 460, 850, 40, 30, 20, 3), '#3a3a3a');
			put(hose([[150, 470, 630], [170, 470, 680], [150, 470, 700]], 8), HOSE);
			put(hose([[150, 450, 790], [140, 440, 870], [80, MAN_Y, MAN_Z - 30]], 8), HOSE);
		}
	);
	part(
		{ id: 'manifold', label: 'D03 valve manifold', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'A block with four D03 valve stations side by side, fed in parallel: the pressure gallery (P) and the tank gallery (T) run through it, and every valve takes its oil from the one and gives it back to the other.', specs: [['Stations', '4, parallel'], ['Pattern', 'NFPA D03 / CETOP 3'], ['Order (left to right)', 'left wheels, arms, bucket, right wheels']] },
		'base',
		(put) => {
			put(box(0, MAN_Y, MAN_Z - 25, 440, 90, 50, 4), ALU);
			for (const st of STATIONS) for (const dy of [-30, 30]) put(cyl([st.x, MAN_Y + dy, MAN_Z - 50], [st.x, MAN_Y + dy, MAN_Z - 64], 8, 8), STEEL);
		}
	);
	for (const st of STATIONS) {
		part(
			{ id: `valve-${st.id}`, label: `Directional valve, ${st.what} (${st.a}/${st.b})`, assembly: 'hydraulics', step: 4, source: SRC.hyd, what: `A Parker D1VW 4-way, 3-position solenoid valve for ${st.what}. Coil ${st.a} pushes its spool one way (${st.ya}), coil ${st.b} the other (${st.yb}); with neither, springs centre it and the tandem centre locks the work ports, so a raised load stays up.`, moves: `Its spool slides a few millimetres either way when a coil is switched; the coil’s lamp lights while it is (watch them in the moves).`, drive: `Two 12 V coils switched by the Opta D1608S’s solid-state outputs`, specs: [['Valve', 'Parker D1VW008CNKW (tandem centre)'], ['Interim', 'D1VW004CNKW (float) + pilot-operated checks'], ['Flow', '18.5–21.1 gpm'], ['Coils', '12 V DC, DIN 43650-A plugs'], ['Mass', '~11 kg (25 lb)']] },
			'base',
			(put) => {
				put(box(st.x, MAN_Y, MAN_Z + 25, 46, 110, 50, 4), '#7c8287');
				for (const sy of [-1, 1]) {
					put(box(st.x, MAN_Y + sy * 85, MAN_Z + 25, 52, 60, 52, 6), BLACK);
					put(box(st.x, MAN_Y + sy * 85, MAN_Z + 64, 34, 40, 26, 4), '#3f3f3f'); // its plug
					put(cyl([st.x, MAN_Y + sy * 122, MAN_Z + 25], [st.x, MAN_Y + sy * 132, MAN_Z + 25], 10, 10), STEEL);
				}
			}
		);
		for (const [coil, sy, way] of /** @type {const} */ ([[st.a, -1, st.ya], [st.b, 1, st.yb]])) {
			part(
				{ id: `coil-${coil}`, label: `Coil ${coil}: ${st.what}, ${way}`, assembly: 'hydraulics', step: 4, source: SRC.ctl, what: `The solenoid coil that shifts the ${st.id} valve’s spool to send ${st.what} ${way}. Its lamp here lights while the controller holds it on.`, moves: 'Its plunger pulls the spool over while it is energised.', drive: `One solid-state output of the D1608S, 12 V, fused 5 A, with a flyback diode`, specs: [['Coil', coil], ['Voltage', '12 V DC'], ['Load', '~15–30 W'], ['Watchdog', 'All coils drop if the controller misses a 10 Hz tick']] },
				`coil${coil}`,
				(put) => put(box(st.x, MAN_Y + sy * 85, MAN_Z + 80, 18, 18, 8, 3), LED)
			);
		}
	}
	part(
		{ id: 'transducers', label: 'Pressure transducers', assembly: 'hydraulics', step: 4, count: 2, source: SRC.ctl, what: 'Two 0–250 bar sensors on the pressure and work galleries, read by the Opta’s analogue inputs: the controller sees how hard the machine is working and when it is stalled against relief.', specs: [['Range', '0–250 bar'], ['Read by', 'A0602 inputs AI2, AI3']] },
		'base',
		(put) => {
			for (const x of [-230, 230]) {
				put(cyl([x, MAN_Y, MAN_Z - 25], [x, MAN_Y, MAN_Z + 40], 12, 12), STEEL);
				put(cyl([x, MAN_Y, MAN_Z + 40], [x, MAN_Y, MAN_Z + 60], 9, 10), BLACK);
			}
		}
	);
	part(
		{ id: 'cooler', label: 'Oil cooler', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'An aluminium core at the front: every relief valve and every orifice turns pressure into heat, so the returning oil passes through it to lose about 6,500 BTU an hour before the filter.', specs: [['Rating', '~6,500 BTU/h (1.9 kW)'], ['Type', 'Fan-cooled, 12 V fan']] },
		'base',
		(put) => {
			put(box(0, 1335, 560, 400, 40, 280, 4), ALU);
			for (let x = -180; x <= 180; x += 20) put(box(x, 1357, 560, 3, 4, 260, 0.5), '#8e9496');
			put(box(0, 1305, 560, 300, 30, 270, 6), DARK); // the fan's shroud
		}
	);
	part(
		{ id: 'cooler-fan', label: 'Cooler fan', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'The 12 V fan pulling air through the cooler’s core.', moves: 'Turns whenever the machine runs (shown slowed).', drive: '12 V from the battery', specs: [['Diameter', '~250 mm'], ['Voltage', '12 V']] },
		'coolerFan',
		(put) => {
			for (let k = 0; k < 5; k++) {
				const t = (k / 5) * Math.PI * 2;
				const g = block(0.11, 0.035, 0.006, [0.06, 0, 0], 0.004);
				g.rotateY(0.35);
				g.rotateZ(t);
				g.translate(...P(...FAN));
				put(g, BLACK);
			}
			put(cyl([0, FAN[1] - 12, FAN[2]], [0, FAN[1] + 12, FAN[2]], 26, 16), DARK);
		}
	);
	part(
		{ id: 'return-line', label: 'Return line', assembly: 'hydraulics', step: 4, source: SRC.hyd, what: 'From the manifold’s tank gallery forward to the cooler and back to the filter on the tank: the oil’s way home after doing its work.', specs: [['Hose', '-10 (5/8")'], ['Path', 'Manifold T → cooler → 10 µm filter → tank']] },
		'base',
		(put) => {
			put(hose([[-220, MAN_Y + 20, MAN_Z - 30], [-330, 600, 700], [-330, 1100, 520], [-150, 1320, 520]], 11), HOSE);
			put(hose([[150, 1320, 600], [330, 1100, 560], [330, 600, 760], [280, 190, 1020]], 11), HOSE);
		}
	);
	for (const [sx, P_] of /** @type {const} */ ([[1, 'left'], [-1, 'right']])) {
		part(
			{ id: `lift-hoses-${P_}`, label: `Lift cylinder hoses, ${P_}`, assembly: 'hydraulics', step: 4, count: 2, source: SRC.hyd, what: 'The two lines from the arms’ valve to the lift cylinder: oil into the cap end raises the arm, into the rod end lowers it. Both lift cylinders are fed in parallel.', specs: [['Hose', 'SAE 100R2 -8'], ['Valve', 'D5 up / D6 down']] },
			'base',
			(put) => {
				for (const dz of [-14, 14]) put(hose([[55 + dz, MAN_Y - 40, MAN_Z - 60], [sx * 300, 200, 860 + dz], [sx * 440, 110, 720 + dz], [sx * 450, LIFT_A[0] + 55, LIFT_A[1] + 30 + dz]], 8), HOSE);
			}
		);
	}
	part(
		{ id: 'bucket-hoses', label: 'Bucket cylinder hoses', assembly: 'hydraulics', step: 4, count: 4, source: SRC.hyd, what: 'From the bucket valve up to the arm pivots and along the arms to the bucket cylinders on the cross beam. Where they cross the pivot they hang in loose loops, so the arms can rise without stretching them.', specs: [['Hose', 'SAE 100R2 -8'], ['Valve', 'D7 curl / D8 dump']] },
		'base',
		(put) => {
			for (const sx of [-1, 1]) for (const dz of [-12, 12]) put(hose([[-55 + dz, MAN_Y - 40, MAN_Z - 60], [sx * 200, 300, 1020], [sx * 360, PIV[0] + 40, PIV[1] - 20 + dz]], 8), HOSE);
		}
	);

	/* ── 5. the loader arms ───────────────────────────────────────────────── */
	// an arm's outline in its own frame, a band 152 mm deep round its main tube and its drop leg, round at both ends
	const outline = (() => {
		const h = 82, A = new THREE.Vector2(0, 0), E = new THREE.Vector2(...ELB), T = new THREE.Vector2(...TIP);
		const d1 = E.clone().sub(A).normalize(), d2 = T.clone().sub(E).normalize();
		const n1 = new THREE.Vector2(-d1.y, d1.x), n2 = new THREE.Vector2(-d2.y, d2.x);
		const miter = n1.clone().add(n2).multiplyScalar(h / (1 + n1.dot(n2)));
		/** @type {THREE.Vector2[]} */
		const pts = [];
		const arc = (/** @type {THREE.Vector2} */ c, /** @type {THREE.Vector2} */ from, /** @type {number} */ sweep) => {
			const a0 = Math.atan2(from.y, from.x);
			for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector2(c.x + Math.cos(a0 + (sweep * i) / 8) * h, c.y + Math.sin(a0 + (sweep * i) / 8) * h));
		};
		arc(A, n1.clone().negate(), -Math.PI); // round the pivot, from below to above, by the back
		pts.push(E.clone().add(miter));
		arc(T, n2, -Math.PI); // round the tip
		pts.push(E.clone().sub(miter));
		return pts.map((p) => /** @type {[number, number]} */ (armAt(p.x, p.y)));
	})();
	for (const [sx, P_] of /** @type {const} */ ([[1, 'left'], [-1, 'right']])) {
		const x = sx * ARM_X;
		part(
			{ id: `arm-plates-${P_}`, label: `Arm side plates, ${P_} (P9, P10)`, assembly: 'arms', step: 5, count: 2, source: SRC.bom, what: 'Two L-shaped 1/4" plates either side of the arm’s tube, cut on the CNC plasma table: they make the arm’s bend, carry the pivot plates at its back, the lift bracket under it and the bucket’s pin at its tip.', moves: 'Swing up and down with the arm about the pivot pin.', drive: 'The lift cylinder', specs: [['BOM', 'P9 inner, P10 outer'], ['Stock', 'PL 1/4" A36'], ['Size', '1,792 × 350.1 mm'], ['Mass', '13.2 / 13.6 kg'], ['Arm shape', 'L1 1,422.6 mm, L2 503.1 mm, 130° bend']] },
			'arms',
			(put) => {
				for (const off of [-31.75, 25.4]) put(side(outline, x + off * 1, 6.35), ARM);
			}
		);
		const [ey, ez] = armAt(...ELB), d2 = new THREE.Vector2(TIP[0] - ELB[0], TIP[1] - ELB[1]).normalize();
		part(
			{ id: `arm-tube-${P_}`, label: `Arm main tube, ${P_} (T4)`, assembly: 'arms', step: 5, source: SRC.bom, what: 'The arm’s backbone: a 6×2 rectangular tube from the pivot to the bend, and on down the drop leg towards the bucket, sandwiched between the side plates and bolted through them.', moves: 'Swings with the arm.', drive: 'The lift cylinder', specs: [['BOM', 'T4 (2 per machine)'], ['Stock', 'HSS 6×2×1/4 A500'], ['Length', '1,356.5 mm (+ 348 mm drop leg)'], ['Mass', '24.5 kg']] },
			'arms',
			(put) => {
				put(bar([x, ...armAt(101.6 * Math.cos(MAIN - TH0), 101.6 * Math.sin(MAIN - TH0))], [x, ey, ez], 50.8, 152.4, 3), ARM);
				const [dy, dz] = armAt(ELB[0] + d2.x * 348, ELB[1] + d2.y * 348);
				put(bar([x, ey, ez], [x, dy, dz], 50.8, 152.4, 3), ARM);
			}
		);
		part(
			{ id: `arm-pivot-${P_}`, label: `Arm pivot, ${P_} (R2, T6, P11, F1)`, assembly: 'arms', step: 5, source: SRC.bom, what: 'The joint the whole loader turns on: a 1½" 4140 pin through both plates of the sandwich and a DOM tube in the arm, the tube welded into two round 6" plates that bolt to the arm with five 1/2" bolts, a big 1½-6 nut on each end of the pin.', moves: 'The DOM tube turns on the pin as the arm swings; the pin stays.', specs: [['Pin R2', 'Ø38.1 × 226.4 mm, 4140'], ['DOM T6', '50.8 OD × 6.35 wall × 120 mm'], ['Plates P11', '2 × Ø152.4 × 1/4"'], ['Nuts F1', '2 × 1-1/2-6 grade 8'], ['Pin load at relief', '~69 kN, 30 MPa shear']] },
			'arms',
			(put) => {
				put(xcyl(x - 113.2, x + 113.2, PIV[0], PIV[1], 19.05, 18), CHROME);
				put(xcyl(x - 60, x + 60, PIV[0], PIV[1], 25.4, 20), STEEL);
				for (const off of [-38.1, 38.1]) put(xcyl(x + off - 3.2, x + off + 3.2, PIV[0], PIV[1], 76.2, 28), ARM);
				for (const off of [-38.1, 38.1]) for (let k = 0; k < 5; k++) {
					const t = (k / 5) * Math.PI * 2 + 0.6;
					put(hex([x + off + Math.sign(off) * 6, PIV[0] + Math.cos(t) * 57, PIV[1] + Math.sin(t) * 57], 'x', 19, 6), DARK);
				}
				for (const ex of [x - 128, x + 128]) put(hex([ex, PIV[0], PIV[1]], 'x', 57, 30), DARK);
			}
		);
		part(
			{ id: `lift-bracket-${P_}`, label: `Lift cylinder bracket, ${P_}`, assembly: 'arms', step: 5, source: SRC.params, what: 'Two gusset plates under the arm, 828 mm out from the pivot, with a 1" bolt for the lift cylinder’s rod eye: where the cylinder pushes the arm up.', moves: 'Swings with the arm.', drive: 'Pushed by the lift cylinder', specs: [['Pin', '1" bolt'], ['Place', '828.5 mm along the arm, 114.3 mm under it']] },
			'arms',
			(put) => {
				for (const off of [-28.6, 28.6]) put(bar([x + off, ...armAt(828.5, 10)], [x + off, ...LIFT_B], 6.35, 100, 2), ARM);
				put(xcyl(x - 40, x + 40, LIFT_B[0], LIFT_B[1], 12.7, 12), CHROME);
			}
		);
	}
	const [t3y, t3z] = armAt(T3_U, T3_V);
	part(
		{ id: 'cross-beam', label: 'Arm cross beam (T3, A5)', assembly: 'arms', step: 5, source: SRC.bom, what: 'The 6×2 tube tying the two arms together a little forward of the pivot, so they rise as one, bolted to each arm through two angles. The bucket cylinders hang from its underside.', moves: 'Swings with the arms.', drive: 'The lift cylinders, through the arms', specs: [['BOM', 'T3, A5 ×4'], ['Stock', 'HSS 6×2×1/4 A500'], ['Length', '849.2 mm'], ['Mass', '16.6 kg'], ['Place', '736.5 mm along the arms'], ['Stress at full dump', '~238 MPa (A36 yields at 250)']] },
		'arms',
		(put) => {
			put(tilted(849.2, 50.8, 152.4, MAIN, [0, t3y, t3z]), ARM);
			for (const sx of [-1, 1]) put(tilted(6.35, 50.8, 146, MAIN, [sx * 420, t3y, t3z + 40]), STEEL);
		}
	);
	part(
		{ id: 'cylinder-lugs', label: 'Bucket cylinder lugs (U1, R3)', assembly: 'arms', step: 5, count: 2, source: SRC.bom, what: 'Two short pieces of 3×3 tube welded under the cross beam, each with a 3/4" clevis pin for a bucket cylinder’s base eye.', moves: 'Swing with the arms.', specs: [['BOM', 'U1 ×2, R3 ×2'], ['Stock', 'HSS 3×3×1/4'], ['Size', '76.2 × 76.2 × 66.7 mm'], ['Pin R3', 'Ø19.05 × 106.2 mm, 4140']] },
		'arms',
		(put) => {
			const [ly, lz] = armAt(T3_U, T3_V - 25.4 - 38.1);
			for (const sx of [-1, 1]) {
				for (const off of [-36, 36]) put(tilted(6.35, 90, 76.2, MAIN, [sx * BCYL_X + off, ly, lz]), STEEL);
				put(xcyl(sx * BCYL_X - 53, sx * BCYL_X + 53, BCYL_A[0], BCYL_A[1], 9.5, 12), CHROME);
			}
		}
	);

	/* ── 6. the cylinders ─────────────────────────────────────────────────── */
	/** a cylinder: its barrel (from its base pin `a`) and rod (from its rod pin `b`), each reaching part way @param {string} id @param {[number, number]} a @param {[number, number]} b @param {number} x @param {number} R @param {number} r */
	const cylinder = (id, a, b, x, R, r, barrelPart = {}, rodPart = {}, barrelJoint = '', rodJoint = '', kb = 0.78, kr = 0.92) => {
		const A = new THREE.Vector2(...a), B = new THREE.Vector2(...b), len = A.distanceTo(B), d = B.clone().sub(A).normalize();
		const at = (/** @type {THREE.Vector2} */ p, /** @type {number} */ k) => /** @type {MM} */ ([x, p.x + d.x * k, p.y + d.y * k]);
		part(/** @type {any} */ (barrelPart), barrelJoint, (put) => {
			put(cyl(at(A, 0), at(A, len * kb), R, 22), ORANGE);
			put(cyl(at(A, len * kb - 6), at(A, len * kb + 4), R + 5, 22), ORANGE); // the gland
			put(xcyl(x - 26, x + 26, a[0], a[1], R * 0.85, 18), ORANGE); // the base eye
			for (const k of [40, len * kb - 0.6 * R]) {
				const [, py, pz] = at(A, k);
				put(cyl([x + Math.sign(x) * R * 0.8, py, pz], [x + Math.sign(x) * R * 1.15, py, pz], 9, 10), STEEL); // its ports
			}
		});
		part(/** @type {any} */ (rodPart), rodJoint, (put) => {
			put(cyl(at(B, 0), at(B, -len * kr), r, 16), CHROME);
			put(xcyl(x - 22, x + 22, b[0], b[1], r * 1.5, 16), ORANGE); // the rod eye
		});
	};
	for (const [sx, P_] of /** @type {const} */ ([[1, 'left'], [-1, 'right']])) {
		cylinder(`lift-${P_}`, LIFT_A, LIFT_B, sx * ARM_X, 38.1, 19.05,
			{ id: `lift-barrel-${P_}`, label: `Lift cylinder barrel, ${P_}`, assembly: 'cylinders', step: 6, source: SRC.params, what: 'The lift cylinder’s barrel, pinned to the frame low behind the arm pivot inside the sandwich’s gap. Oil pumped into its cap end pushes the piston and rod out, raising the arm; into the rod end, it pulls them back.', moves: 'Tilts about its base pin as the arm rises, so it always points at the bracket.', drive: 'Oil from the arms’ valve (D5 up, D6 down)', specs: [['Bore', '63.5 mm (2.5")'], ['Stroke', '650 mm (solver; not a catalogue size)'], ['Pin to pin', '830 → 1,311 mm working'], ['Push at 3,000 psi', '65.5 kN'], ['Base pin R1', 'Ø25.4 × 160 mm at Y 50, Z 600'], ['Lift, both, at relief', '3,674 kg arms down, 1,258 kg at full height']] },
			{ id: `lift-rod-${P_}`, label: `Lift cylinder rod, ${P_}`, assembly: 'cylinders', step: 6, source: SRC.params, what: 'The chromed 1½" rod and the piston on its inner end: it slides out of the barrel under pressure, its eye pinned to the arm’s bracket.', moves: 'Slides out of and back into the barrel, turning with the arm about the bracket bolt.', drive: 'The oil pressure on its piston', specs: [['Rod', 'Ø38.1 mm (1.5"), hard chrome'], ['Travel', '~480 mm used of 650']] },
			`liftBarrel${sx > 0 ? 'L' : 'R'}`, `liftRod${sx > 0 ? 'L' : 'R'}`, 0.8, 0.95);
		cylinder(`bucket-${P_}`, BCYL_A, BCYL_B, sx * BCYL_X, 44.5, 19.05,
			{ id: `bucket-barrel-${P_}`, label: `Bucket cylinder barrel, ${P_}`, assembly: 'cylinders', step: 6, source: SRC.params, what: 'The bucket cylinder’s barrel, hung by its base eye from a lug under the cross beam: it rides with the arms and pushes on the bucket’s top.', moves: 'Rises with the arms and tilts about its lug pin as the bucket turns.', drive: 'Oil from the bucket valve (D7 curl, D8 dump)', specs: [['Bore', '76.2 mm (3")'], ['Stroke', '508 mm (20")'], ['Pin to pin', '712 closed, 1,220 extended'], ['Push / pull at 3,000 psi', '94.3 / 70.7 kN'], ['Breakout per cylinder', 'up to 35.2 kN dump, 26.4 kN curl']] },
			{ id: `bucket-rod-${P_}`, label: `Bucket cylinder rod, ${P_}`, assembly: 'cylinders', step: 6, source: SRC.params, what: 'Its chromed rod, pinned to the lug on the bucket’s back: pushed out it tips the bucket forward to dump, drawn in it curls the bucket back to hold its load.', moves: 'Slides out and in, turning with the bucket.', drive: 'The oil pressure on its piston', specs: [['Rod', 'Ø38.1 mm (1.5")'], ['Bucket range', '−94° to +50° to the arm']] },
			`bucketBarrel${sx > 0 ? 'L' : 'R'}`, `bucketRod${sx > 0 ? 'L' : 'R'}`, 0.74, 0.82);
	}

	/* ── 7. the bucket ────────────────────────────────────────────────────── */
	const BK = TY + 38.1; // the back plate's back face
	part(
		{ id: 'bucket-shell', label: 'Bucket shell (P12, P13, P14)', assembly: 'bucket', step: 7, source: SRC.bom, what: 'The bucket: a back plate, a bottom and two sides of 1/4" plate welded into an open box 1,100 mm wide, 600 deep and 450 high, about a third of a cubic metre heaped.', moves: 'Turns about the pins at the arms’ tips: curled back to carry, tipped forward to dump; and rises with the arms.', drive: 'The two bucket cylinders', specs: [['Back P12', '1,112.7 × 450 mm, 24.7 kg'], ['Bottom P13', '1,112.7 × 600 mm, 32.8 kg'], ['Sides P14', '2 × 600 × 450 mm, 8.8 kg each'], ['Size', '1,100 W × 600 D × 450 H mm'], ['Volume', '~0.3 m³ struck']] },
		'bucket',
		(put) => {
			put(box(0, BK + 3.2, 225, 1112.7, 6.35, 450, 1), YELLOW);
			put(box(0, BK + 300, 3.2, 1112.7, 600, 6.35, 1), YELLOW);
			for (const sx of [-1, 1]) put(side([[BK, 0], [BK + 600, 0], [BK + 600, 60], [BK + 120, 450], [BK, 450]], sx > 0 ? 550 : -556.35, 6.35), YELLOW);
			put(box(0, BK + 3.2, 452, 1112.7, 20, 8, 2), YELLOW); // the top lip
		}
	);
	part(
		{ id: 'cutting-edge', label: 'Cutting edge (P19)', assembly: 'bucket', step: 7, source: SRC.bom, what: 'A 3/4" bar along the bucket’s front lip, the part that bites into the ground and wears: bolted or welded on so it can be replaced.', moves: 'With the bucket.', specs: [['BOM', 'P19'], ['Stock', 'PL 3/4" (19.05 mm) A36'], ['Size', '1,100 × 80 mm'], ['Mass', '13.2 kg']] },
		'bucket',
		(put) => put(box(0, BK + 600, 9.5, 1100, 80, 19.05, 2), STEEL)
	);
	part(
		{ id: 'bucket-pivots', label: 'Bucket pivot lugs and pins (U2, R4)', assembly: 'bucket', step: 7, count: 2, source: SRC.bom, what: 'Two 3×3 tube lugs on the bucket’s back, pinned through the arms’ tips with 1" pins: the hinge the bucket turns on. OSE’s own analysis flags this joint as overloaded at relief; a quick-attach plate (46 × 18") is planned here instead.', moves: 'The lugs turn on the pins with the bucket.', specs: [['Lugs U2', '76.2 × 76.2 × 66.7 mm'], ['Pins R4', 'Ø25.4 × 106.2 mm, 4140'], ['Planned', 'Skid-steer quick attach, 1,168 × 457 mm, 1" lock pins']] },
		'bucket',
		(put) => {
			for (const sx of [-1, 1]) {
				put(box(sx * ARM_X, TY, TZ, 66.7, 76.2, 76.2, 6), YELLOW);
				put(xcyl(sx * ARM_X - 53, sx * ARM_X + 53, TY, TZ, 12.7, 14), CHROME);
			}
		}
	);
	part(
		{ id: 'bucket-cyl-lugs', label: 'Bucket cylinder lugs (U3)', assembly: 'bucket', step: 7, count: 2, source: SRC.bom, what: 'Two lugs high on the bucket’s back for the bucket cylinders’ rod eyes: the higher above the pivot, the more leverage the cylinders have to break the bucket out of the ground.', moves: 'With the bucket.', specs: [['BOM', 'U3 ×2'], ['Stock', 'HSS 3×3×1/4'], ['Above the pivot', '~300 mm']] },
		'bucket',
		(put) => {
			for (const sx of [-1, 1]) {
				for (const off of [-30, 30]) put(box(sx * BCYL_X + off, TY + 10, BCYL_B[1] - 20, 6.35, 60, 110, 3), YELLOW);
				put(xcyl(sx * BCYL_X - 45, sx * BCYL_X + 45, BCYL_B[0], BCYL_B[1], 9.5, 12), CHROME);
			}
		}
	);

	/* ── 8. the platform ──────────────────────────────────────────────────── */
	part(
		{ id: 'deck', label: 'Platform deck (P15)', assembly: 'platform', step: 8, source: SRC.bom, what: 'A 1/4" plate to stand on behind the machine, punched with a grid of anti-slip holes. The machine has no seat and no cab: it is meant to be driven by radio, the deck is for riding when that is easier.', moves: 'Folds up about its pivot pins to stow, down to stand on.', drive: 'By hand; locked by two 5/8" pins', specs: [['BOM', 'P15'], ['Size', '735.5 × 400 mm'], ['Mass', '14.3 kg'], ['Height', '330 mm above the ground'], ['Anti-slip holes', 'Ø15 mm at 80 mm pitch'], ['Tipping load with a rider', '294 kg (184 kg without)']] },
		'platform',
		(put) => {
			put(box(0, DECK[0] - 200, DECK[1] - 3.2, 735.5, 400, 6.35, 2), STEEL);
			for (let x = -300; x <= 300; x += 80) for (let y = DECK[0] - 340; y <= DECK[0] - 60; y += 80) put(cyl([x, y, DECK[1] - 2], [x, y, DECK[1] + 0.6], 7.5, 8), DARK);
		}
	);
	part(
		{ id: 'deck-frame', label: 'Platform angles (A7, A8)', assembly: 'platform', step: 8, count: 4, source: SRC.bom, what: 'The 2×2 angles under the deck: two short side arms that reach forward to its pivot pins, two long transverse angles across its front and back edges.', moves: 'Fold with the deck.', specs: [['A7', '2 × 247.6 mm'], ['A8', '2 × 729.2 mm'], ['Stock', 'L2×2×1/4']] },
		'platform',
		(put) => {
			for (const sx of [-1, 1]) put(box(sx * 340, DECK[0] - 120, DECK[1] - 32, 6.35, 247.6, 50.8, 1), STEEL);
			for (const y of [DECK[0] - 25, DECK[0] - 380]) put(box(0, y, DECK[1] - 32, 729.2, 6.35, 50.8, 1), STEEL);
		}
	);
	part(
		{ id: 'deck-brackets', label: 'Platform pivot brackets, pins and lock pins (P16, R5, F2)', assembly: 'platform', step: 8, source: SRC.bom, what: 'Two brackets bolted inside the inner panels carry the deck’s 1" pivot pins; a 5/8" hitch pin through each bracket, 60 mm from the pivot, locks the deck down or up.', moves: 'The brackets stay; the deck turns on their pins.', specs: [['Brackets P16', '2 × 400 × 230 mm, 1/4"'], ['Pins R5', '2 × Ø25.4 × 55.4 mm'], ['Lock pins F2', '2 × Ø5/8" hitch pins']] },
		'base',
		(put) => {
			for (const sx of [-1, 1]) {
				put(side([[10, 230], [180, 230], [180, 420], [60, 460], [10, 420]], sx > 0 ? 367 : -373.35, 6.35), GREEN);
				put(xcyl(sx * 340, sx * 395, DECK[0], DECK[1], 12.7, 12), CHROME);
				put(xcyl(sx * 345, sx * 395, DECK[0] + 60, DECK[1] + 20, 8, 10), RED);
			}
		}
	);

	/* ── 9. the controller and radio ──────────────────────────────────────── */
	const NB = /** @type {MM} */ ([0, 165, 952]); // the node box's middle
	part(
		{ id: 'node-box', label: 'Tractor node enclosure', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'An IP65 box with a clear lid holding the machine’s brain, mounted on the tank behind the valves. Its harness leaves through Deutsch DT connectors.', specs: [['Rating', 'IP65'], ['Size', '~250 × 200 × 100 mm'], ['Connectors', 'Deutsch DT'], ['Electronics draw', '~3.4 W (valves 60–240 W)']] },
		'base',
		(put) => {
			put(box(NB[0], NB[1], NB[2] - 40, 200, 250, 20, 6), '#dcdcd6');
			for (const sx of [-1, 1]) put(box(sx * 98, NB[1], NB[2], 4, 250, 100, 2), '#dcdcd6', 1);
			for (const sy of [-1, 1]) put(box(0, NB[1] + sy * 123, NB[2], 200, 4, 100, 2), '#dcdcd6', 1);
			put(box(0, NB[1], NB[2] + 52, 204, 254, 4, 6), '#e8f4ff', 1);
			for (const x of [-60, 0, 60]) put(cyl([x, NB[1] + 127, NB[2] - 20], [x, NB[1] + 150, NB[2] - 20], 9, 10), '#2b2b2b');
			put(box(0, NB[1] - 30, 893, 230, 100, 6, 1), STEEL); // its bracket
		}
	);
	part(
		{ id: 'portenta-x8', label: 'Portenta X8 on its Max Carrier', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'The tractor’s main computer: an Arduino Portenta X8 (a Linux i.MX8M Mini with an STM32H747 beside it) plugged into a Portenta Max Carrier with its LoRa radio. It receives the handheld’s commands at 20 Hz, decides which source wins (handheld, base station, autonomy), and drives the Opta over Modbus.', moves: 'Nothing moves; it ticks a 10 Hz watchdog, or every coil drops.', specs: [['Boards', 'Portenta X8 (ABX00049) + Max Carrier (ABX00043)'], ['Radio', 'LoRa 915 / 868 MHz, SF7 BW250, AES-128-GCM'], ['Link', '20 Hz control, ≤150 ms round trip'], ['To the Opta', 'Modbus RTU over RS-485, 115,200 baud'], ['Note', 'An H7-only option is proposed (export rules on the X8)']] },
		'base',
		(put) => {
			put(box(-35, NB[1] - 20, NB[2] - 26, 110, 170, 3, 1), PCB);
			put(box(-35, NB[1] - 30, NB[2] - 21, 30, 66, 6, 1), '#1d2a3a');
			put(box(-60, NB[1] + 40, NB[2] - 21, 26, 24, 10, 1), ALU);
			put(box(-10, NB[1] + 40, NB[2] - 21, 20, 16, 8, 1), '#f2f2f2');
		}
	);
	part(
		{ id: 'opta', label: 'Opta WiFi with D1608S and A0602', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'The machine’s hands: an Arduino Opta PLC on a DIN rail with two expansions. The D1608S’s eight solid-state outputs switch the eight valve coils; the A0602 puts out 0–10 V to the flow valve’s driver and reads the battery, both pressures and the oil temperature. The Opta’s own relays kill the engine, sound the horn and beacon, release the park brake.', specs: [['Opta', 'Modbus slave; relays R1 kill, R2 beacon/horn, R3 brake, R4 spare'], ['D1608S', '8 × SSR to the coils, flyback diodes; inputs ignition, E-stop, mode'], ['A0602', 'AO1/AO2 0–10 V to the EFC; AI battery, 2 pressures, coolant, oil temp']] },
		'base',
		(put) => {
			put(box(50, NB[1], NB[2] - 26, 35, 220, 8, 1), STEEL); // the DIN rail
			for (const [y, w] of [[NB[1] - 70, 70], [NB[1] + 5, 70], [NB[1] + 72, 46]]) {
				put(box(50, y, NB[2] - 2, 60, w - 4, 40, 3), '#f4f4f0');
				put(box(50, y, NB[2] + 18, 40, w - 12, 4, 1), '#2a6fb0');
			}
		}
	);
	part(
		{ id: 'efc-driver', label: 'EFC driver (Burkert 8605)', assembly: 'electronics', step: 9, source: SRC.hyd, what: 'A small DIN-rail amplifier turning the Opta’s 0–10 V into the coil current the proportional flow valve needs.', specs: [['Driver', 'Burkert 8605 Type 316532'], ['Input', '0–10 V'], ['Output', 'PWM coil current']] },
		'base',
		(put) => put(box(-80, NB[1] + 85, NB[2] - 6, 30, 40, 36, 3), '#e4e4de')
	);
	part(
		{ id: 'safety-relay', label: 'Safety relay and E-stop loop', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'A Phoenix PSR dual-channel safety relay: while the E-stop loop is closed it holds the 12 V valve rail and the engine’s run circuit on. Press any E-stop (on the machine or the handheld) and it drops both, whatever the computers think.', specs: [['Relay', 'Phoenix Contact PSR, dual channel'], ['Cuts', '12 V valve rail and engine kill (30 A relay)'], ['E-stops', 'Latching mushrooms on tractor and handheld']] },
		'base',
		(put) => put(box(-80, NB[1] + 40, NB[2] - 6, 24, 40, 36, 3), '#f2d13a')
	);
	part(
		{ id: 'fuses', label: 'Fuses and power path', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'From the battery: a 175 A master cut-off, an EMI filter, a 20 A main fuse, then eight 5 A fuses, one per valve coil; a small 18650 cell keeps the computer alive through cranking.', specs: [['Master', '175 A cut-off'], ['Main fuse', '20 A'], ['Branches', '8 × 5 A'], ['Backup', '18650 cell + TP4056 charger']] },
		'base',
		(put) => {
			put(box(-35, NB[1] + 90, NB[2] - 18, 90, 40, 12, 2), '#2a2a2a');
			for (let k = 0; k < 8; k++) put(box(-75 + k * 11.5, NB[1] + 90, NB[2] - 8, 7, 18, 8, 1), ['#ffcc33', '#e05a2a'][k % 2]);
		}
	);
	part(
		{ id: 'status-leds', label: 'Status lamps and buzzer', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'Three lamps on the lid — POWER, LINK, FAULT — and a buzzer: at a glance, is it powered, is it hearing the handheld, has it stopped itself.', specs: [['Lamps', 'POWER, LINK, FAULT'], ['Buzzer', 'Fault and link-loss alarm']] },
		'base',
		(put) => {
			for (const [k, c] of /** @type {const} */ ([[0, '#3cff7a'], [1, '#3ab0ff'], [2, '#ff4a3a']])) put(cyl([-60 + k * 30, NB[1] - 100, NB[2] + 54], [-60 + k * 30, NB[1] - 100, NB[2] + 60], 6, 10), c);
			put(cyl([60, NB[1] - 100, NB[2] + 54], [60, NB[1] - 100, NB[2] + 58], 12, 14), BLACK);
		}
	);
	part(
		{ id: 'imu-gps', label: 'GPS and IMU boards', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'A u-blox NEO-M9N GPS (an RTK ZED-F9P later, for centimetres) and a BNO086 motion sensor: where the machine is, which way it faces, how it tilts — for the base station’s map, and for warning before it tips.', specs: [['GPS', 'u-blox NEO-M9N (upgrade ZED-F9P RTK)'], ['IMU', 'BNO086 via MCP2221A USB bridge']] },
		'base',
		(put) => {
			put(box(-60, NB[1] - 80, NB[2] - 20, 40, 30, 4, 1), '#c0392b');
			put(box(-15, NB[1] - 80, NB[2] - 20, 30, 30, 4, 1), '#6b3fa0');
		}
	);
	part(
		{ id: 'harness', label: 'Valve and sensor harness', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'The wiring from the node box to the eight valve coils (DIN plugs), the flow valve, the pressure sensors, the engine’s kill and ignition sense, and up the mast.', specs: [['Connectors', 'Deutsch DT at the box, DIN 43650-A at the coils'], ['Coil feed', '12 V, fused 5 A each']] },
		'base',
		(put) => {
			for (const st of STATIONS) for (const sy of [-1, 1]) put(hose([[st.x * 0.3, NB[1] + 127, NB[2] - 20], [st.x, MAN_Y + sy * 60, MAN_Z + 110], [st.x, MAN_Y + sy * 85, MAN_Z + 78]], 3), sy < 0 ? '#2f2f2f' : '#3a3a3a');
			put(hose([[-100, NB[1], NB[2]], [-260, 60, 1040], [-330, 20, 1150]], 5), '#2f2f2f');
		}
	);
	part(
		{ id: 'battery', label: '12 V battery', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'The machine’s 12 V store, beside the engine: it cranks the starter and feeds the valves, fan and computers; the engine’s 16 A alternator charges it while it runs.', specs: [['Voltage', '12 V'], ['Charged by', 'Vanguard 16 A alternator'], ['Watched by', 'A0602 input AI1']] },
		'base',
		(put) => {
			put(box(312, 780, 505, 130, 250, 190, 6), '#1e1f22');
			for (const [y, c] of /** @type {const} */ ([[700, RED], [860, BLACK]])) put(cyl([312, y, 600], [312, y, 618], 10, 10), c);
			put(box(312, 780, 400, 140, 260, 10, 1), STEEL);
		}
	);
	part(
		{ id: 'master-switch', label: 'Master cut-off switch', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'A red key on the battery’s positive lead: turned off, nothing on the machine is live — for servicing and for leaving it.', moves: 'Turned by hand.', specs: [['Rating', '175 A']] },
		'base',
		(put) => {
			put(cyl([372, 960, 520], [377, 960, 520], 40, 18), BLACK);
			put(cyl([340, 960, 520], [372, 960, 520], 20, 16), RED);
			put(hose([[312, 700, 620], [340, 900, 600], [360, 960, 540]], 6), RED);
		}
	);
	part(
		{ id: 'mast', label: 'Antenna mast', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'A steel pole on the back wall lifting the radio, GPS and cameras clear of the steel around them.', specs: [['Height', 'top ~1.75 m above the ground']] },
		'base',
		(put) => {
			put(cyl([-330, -24, 880], [-330, -24, 1750], 19, 14), STEEL);
			for (const z of [930, 1110]) put(box(-330, -10, z, 60, 30, 20, 2), STEEL);
			put(box(-330, -24, 1752, 110, 70, 6, 2), STEEL);
		}
	);
	part(
		{ id: 'lora-antenna', label: 'LoRa antenna', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'The whip for the control radio: raw LoRa with OSE’s own frame format, every command 16 bytes, encrypted, twenty times a second. Lose it for a second and the machine stops itself.', specs: [['Band', '915 MHz (US) / 868 MHz (EU)'], ['Modulation', 'LoRa SF7, BW 250 kHz, CR 4/5'], ['Frame', '16 B → ~44 B with AES-128-GCM'], ['Timeout', '1 s → all motion stops']] },
		'base',
		(put) => {
			put(cyl([-300, -24, 1755], [-300, -24, 2150], 4, 8, 2), BLACK);
			put(cyl([-300, -24, 1755], [-300, -24, 1790], 9, 10), DARK);
		}
	);
	part(
		{ id: 'gps-antenna', label: 'GPS antenna', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'A patch antenna on the mast’s top plate, seeing the sky for the GPS receiver.', specs: [['Type', 'Active GNSS patch']] },
		'base',
		(put) => put(box(-365, -24, 1768, 50, 50, 20, 8), '#f0f0ea')
	);
	part(
		{ id: 'cameras', label: 'Cameras', assembly: 'electronics', step: 9, count: 2, source: SRC.ctl, what: 'USB cameras looking forward over the bucket and back over the deck, streamed to the base station so the machine can be driven out of sight. Up to four can be fitted.', specs: [['Cameras', 'Kurokesu C1 PRO / C2-290C (UVC), 1–4'], ['Research build', 'Arducam IMX335 on a Raspberry Pi 4']] },
		'base',
		(put) => {
			for (const sy of [-1, 1]) {
				put(box(-330, -24 + sy * 50, 1700, 50, 50, 46, 6), BLACK);
				put(cyl([-330, -24 + sy * 75, 1700], [-330, -24 + sy * 82, 1700], 15, 14), '#3a6fa8');
			}
		}
	);
	part(
		{ id: 'beacon', label: 'Warning beacon and horn', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'An amber beacon on the back wall that flashes whenever the machine moves, and a horn beside it, both on the Opta’s relay R2: a machine with nobody on it has to say it is coming.', moves: 'Flashes while the machine moves.', drive: 'Opta relay R2', specs: [['Relay', 'R2'], ['Light', 'Amber LED beacon']] },
		'base',
		(put) => {
			put(cyl([330, 0, 1150], [330, 0, 1175], 45, 18), BLACK);
			put(cyl([330, 0, 1175], [330, 0, 1255], 38, 18, 30), '#c8801a', 1);
			put(cyl([420, -18, 1060], [420, -50, 1060], 28, 16, 10), DARK);
		}
	);
	part(
		{ id: 'beacon-light', label: 'Beacon lamp', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'The beacon’s lamp: lit, it is flashing.', moves: 'Flashes while the machine moves.', drive: 'Opta relay R2', specs: [['Colour', 'Amber']] },
		'beacon',
		(put) => put(cyl([330, 0, 1185], [330, 0, 1240], 26, 14, 20), AMBER)
	);
	part(
		{ id: 'estop', label: 'E-stop on the machine', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'A latching red mushroom on the back wall: pushed, it opens the safety relay’s loop, dropping the valves (everything holds where it is) and killing the engine. Twisted out, the machine can be started again.', moves: 'Pushed in to stop; twisted to release.', specs: [['Type', 'Latching mushroom'], ['Acts on', 'Safety relay, hard-wired']] },
		'base',
		(put) => {
			put(box(250, -30, 1060, 80, 50, 80, 6), YELLOW);
			put(cyl([250, -55, 1060], [250, -75, 1060], 34, 20), RED);
		}
	);
	part(
		{ id: 'handheld', label: 'Handheld remote', assembly: 'electronics', step: 9, source: SRC.ctl, what: 'How the LifeTrac is driven: a small IP54 box on an Arduino MKR WAN 1310 with two joysticks, an E-stop, four buttons and a screen, its own LoRa radio. Here it sits in its holster on the back wall.', specs: [['Board', 'MKR WAN 1310 (LoRa)'], ['Box', '120 × 80 × 40 mm, IP54'], ['Battery', '2,000 mAh LiPo, ~8 h'], ['Also', '22 mm E-stop, 4 buttons, OLED'], ['Other ways', 'Base station web UI; research build: BLE (DroidPad), Wi-Fi/MQTT, ROS2']] },
		'base',
		(put) => {
			const m = handMatrix();
			const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {string} */ c, /** @type {number} */ mat = 0) => put(g.applyMatrix4(m), c, mat);
			add(block(0.12, 0.04, 0.08, [0, -0.02, 0], 0.008), '#ffcf2e');
			add(block(0.05, 0.004, 0.025, [0, 0.001, 0.022], 0.002), '#0a1a2a'); // the screen
			add(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 16).translate(0, 0.006, -0.026), RED); // its E-stop
			for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.004, 0.004, 0.005, 10).translate(-0.018 + k * 0.012, 0.002, -0.006), '#3a3a3a');
			for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.014, 0.016, 0.006, 16).translate(sx * 0.038, 0.003, 0), DARK);
			add(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 8).translate(0.05, 0.03, -0.035), BLACK); // its antenna
			put(box(0, -14, 980, 140, 22, 70, 3), STEEL); // the holster
		}
	);
	for (const [sx, P_, does] of /** @type {const} */ ([[1, 'left', 'drive: forward and back on Y, steer on X (tank steering)'], [-1, 'right', 'loader: arms up and down on Y, bucket curl and dump on X']])) {
		part(
			{ id: `stick-${P_}`, label: `Handheld joystick, ${P_}`, assembly: 'electronics', step: 9, source: SRC.ctl, what: `The ${P_} stick: ${does}. A 10 % dead zone in the middle; the stick’s deflection sets the flow valve’s opening, so a little deflection is a slow, fine movement.`, moves: 'Tilts as the machine is driven (watch it in the moves).', specs: [['Mapping', does], ['Dead zone', '10 %'], ['Research build', 'SparkFun Qwiic joysticks on an ESP32']] },
			`stick${sx > 0 ? 'L' : 'R'}`,
			(put) => {
				const m = handMatrix();
				put(new THREE.CylinderGeometry(0.003, 0.004, 0.03, 10).translate(sx * 0.038, 0.018, 0).applyMatrix4(m), DARK);
				put(new THREE.SphereGeometry(0.009, 12, 8).translate(sx * 0.038, 0.034, 0).applyMatrix4(m), BLACK);
			}
		);
	}

	/* ── the skeleton ─────────────────────────────────────────────────────── */
	const built = kit.build();
	const hm = handMatrix();
	const stickAt = (/** @type {number} */ sx) => /** @type {V3} */ (new THREE.Vector3(sx * 0.038, 0, 0).applyMatrix4(hm).toArray());
	/** @type {BoneSpec[]} */
	const bones = [
		{ name: 'base', at: [0, 0, 0] },
		...CORNERS.map((c) => ({ name: `wheel_${c.id}`, parent: 'base', at: P(c.sx * AX.x, c.y, AX.z) })),
		{ name: 'flywheel', parent: 'base', at: P(0, FLY_Y, CRANK) },
		{ name: 'coupling', parent: 'base', at: P(0, CPL_Y, CRANK) },
		{ name: 'coolerFan', parent: 'base', at: P(...FAN) },
		{ name: 'arms', parent: 'base', at: P(0, ...PIV) },
		{ name: 'bucket', parent: 'arms', at: P(0, TY, TZ) },
		{ name: 'platform', parent: 'base', at: P(0, ...DECK) },
		{ name: 'beacon', parent: 'base', at: P(330, 0, 1210) },
		{ name: 'stickL', parent: 'base', at: stickAt(1) },
		{ name: 'stickR', parent: 'base', at: stickAt(-1) },
		...STATIONS.flatMap((st) => [st.a, st.b].map((c, i) => ({ name: `coil${c}`, parent: 'base', at: P(st.x, MAN_Y + (i ? 85 : -85), MAN_Z + 80) }))),
		...(/** @type {const} */ (['L', 'R'])).flatMap((s) => {
			const x = s === 'L' ? 1 : -1;
			return [
				{ name: `liftBarrel${s}`, parent: 'base', at: P(x * ARM_X, ...LIFT_A) },
				{ name: `liftRod${s}`, parent: 'arms', at: P(x * ARM_X, ...LIFT_B) },
				{ name: `bucketBarrel${s}`, parent: 'arms', at: P(x * BCYL_X, ...BCYL_A) },
				{ name: `bucketRod${s}`, parent: 'bucket', at: P(x * BCYL_X, ...BCYL_B) }
			];
		}),
		...built.bones
	];
	const r = rig(bones, built.pieces, [skin(0.55, { side: THREE.DoubleSide }), skin(0.15, { side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false })]);
	r.object.name = 'LifeTrac v25';

	/* ── its moves ────────────────────────────────────────────────────────── */
	const rest0 = { lift: ang(LIFT_A, LIFT_B), bucket: ang(BCYL_A, BCYL_B) };
	/**
	 * @typedef {{ dist?: number, yaw?: number, arm?: number, bucket?: number, deck?: number, t?: number, moving?: boolean,
	 *   coils?: Record<string, boolean>, sticks?: [number, number, number, number] }} State
	 * dist: driven forward (m); yaw: turned (rad, left positive); arm: raised from rest (rad); bucket: the bucket's turn
	 * to the arm (rad, curl positive); deck: the platform folded up (0 down … 1 up)
	 */
	/** @param {State} s @returns {Pose} */
	const pose = ({ dist = 0, yaw = 0, arm = 0, bucket = 0, deck = 0, t = 0, moving = false, coils = {}, sticks = [0, 0, 0, 0] }) => {
		/** @type {Pose} */
		const p = { base: [0, yaw, 0], root: [Math.sin(yaw) * 0, 0, dist] };
		const roll = (dist * 1000) / AX.r, spin = (yaw * AX.x) / AX.r;
		for (const c of CORNERS) p[`wheel_${c.id}`] = [roll - c.sx * spin, 0, 0];
		const eng = t * 2 * Math.PI * 2.2;
		p.flywheel = [0, 0, eng];
		p.coupling = [0, 0, eng];
		p.coolerFan = [0, 0, t * 2 * Math.PI * 1.6];
		p.arms = [-arm, 0, 0];
		p.bucket = [-bucket, 0, 0];
		p.platform = [deck * (Math.PI / 2), 0, 0];
		// the cylinders follow their pins
		const lb = turnAbout(PIV, LIFT_B, arm);
		const la = ang(LIFT_A, lb) - rest0.lift;
		const tip = turnAbout(PIV, [TY, TZ], arm);
		const ba = turnAbout(PIV, BCYL_A, arm);
		const bb = turnAbout(PIV, turnAbout([TY, TZ], BCYL_B, bucket), arm);
		const bang = ang(ba, bb) - rest0.bucket;
		void tip;
		for (const s of ['L', 'R']) {
			p[`liftBarrel${s}`] = [-la, 0, 0];
			p[`liftRod${s}`] = [-(la - arm), 0, 0];
			p[`bucketBarrel${s}`] = [-(bang - arm), 0, 0];
			p[`bucketRod${s}`] = [-(bang - arm - bucket), 0, 0];
		}
		const flash = moving && Math.sin(t * 2 * Math.PI * 1.5) > 0;
		p.beacon = [0, 0, 0, flash ? 1 : 0];
		for (const st of STATIONS) for (const c of [st.a, st.b]) p[`coil${c}`] = [0, 0, 0, coils[c] ? 1 : 0];
		const [lx, ly, rx, ry] = sticks;
		p.stickL = [-ly * 0.4, 0, -lx * 0.4];
		p.stickR = [-ry * 0.4, 0, -rx * 0.4];
		return p;
	};
	/**
	 * A move from how the machine stands over time: what the valves and sticks do is read off how it is changing.
	 * @param {(t: number) => State} at @param {boolean} [engine] @returns {import('./rig').Clip}
	 */
	const move = (at, engine = true) => (t) => {
		const s = at(t), a = at(t - 0.06), b = at(t + 0.06);
		const v = (/** @type {keyof State} */ k) => (/** @type {number} */ (b[k] ?? 0) - /** @type {number} */ (a[k] ?? 0)) / 0.12;
		const fwd = v('dist'), turn = v('yaw'), up = v('arm'), curl = v('bucket');
		const left = fwd - turn * 0.7, right = fwd + turn * 0.7, e = 0.02;
		const coils = { D1: left > e, D2: left < -e, D3: right > e, D4: right < -e, D5: up > e, D6: up < -e, D7: curl > e, D8: curl < -e };
		const k = (/** @type {number} */ x, /** @type {number} */ m) => Math.max(-1, Math.min(1, x / m));
		/** @type {[number, number, number, number]} */
		const sticks = [k(-turn, 0.6), k(fwd, 0.6), k(curl, 0.5), k(up, 0.4)];
		const moving = Object.values(coils).some(Boolean);
		return pose({ ...s, t: engine ? t : 0, coils, sticks, moving });
	};
	const ARM_MAX = 77 * D, CURL = 0.55, DUMP = -1.15;
	/** between key states (each at its time in the cycle, 0…1), eased @param {[number, State][]} keys @param {number} u @returns {State} */
	const through = (keys, u) => {
		let i = 0;
		while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
		const [t0, a] = keys[i], [t1, b] = keys[i + 1];
		const k = ease(Math.min(1, Math.max(0, (u - t0) / (t1 - t0))));
		/** @type {Record<string, number>} */
		const mix = {};
		for (const n of /** @type {const} */ (['dist', 'yaw', 'arm', 'bucket', 'deck'])) mix[n] = (a[n] ?? 0) + ((b[n] ?? 0) - (a[n] ?? 0)) * k;
		return mix;
	};
	const STEPS_N = STEPS.length;
	/** @type {Record<string, import('./rig').Clip>} */
	const clips = {
		work: move((t) =>
			through(
				[
					[0, { deck: 1, arm: 0.06, bucket: 0 }],
					[0.16, { deck: 1, dist: 1.4, arm: 0.0, bucket: -0.05 }],
					[0.26, { deck: 1, dist: 1.6, arm: 0.04, bucket: CURL }],
					[0.42, { deck: 1, dist: 0.3, arm: 0.5, bucket: CURL - 0.4 }],
					[0.56, { deck: 1, dist: 0.6, arm: ARM_MAX, bucket: CURL - ARM_MAX }],
					[0.68, { deck: 1, dist: 0.6, arm: ARM_MAX, bucket: DUMP }],
					[0.76, { deck: 1, dist: 0.6, arm: ARM_MAX, bucket: DUMP }],
					[0.9, { deck: 1, dist: 0.1, arm: 0.2, bucket: -0.15 }],
					[1, { deck: 1, arm: 0.06, bucket: 0 }]
				],
				loop(t, 16)
			)
		),
		drive: move((t) => {
			const u = loop(t, 8);
			return { deck: 1, arm: 0.12, dist: 1.6 * (ease(Math.min(1, Math.max(0, (u - 0.05) / 0.4))) - ease(Math.min(1, Math.max(0, (u - 0.55) / 0.4)))) };
		}),
		turn: move((t) => {
			const u = loop(t, 9);
			return { deck: 1, arm: 0.12, yaw: Math.PI * (ease(Math.min(1, Math.max(0, (u - 0.05) / 0.4))) - ease(Math.min(1, Math.max(0, (u - 0.55) / 0.4)))) };
		}),
		lift: move((t) => {
			const u = loop(t, 8);
			const a = ARM_MAX * (ease(Math.min(1, Math.max(0, (u - 0.05) / 0.4))) - ease(Math.min(1, Math.max(0, (u - 0.55) / 0.4))));
			return { deck: 1, arm: a, bucket: -a * 0.85 };
		}),
		curl: move((t) => through([[0, { deck: 1, arm: 0.35 }], [0.25, { deck: 1, arm: 0.35, bucket: CURL }], [0.45, { deck: 1, arm: 0.35, bucket: CURL }], [0.75, { deck: 1, arm: 0.35, bucket: -0.9 }], [0.9, { deck: 1, arm: 0.35, bucket: -0.9 }], [1, { deck: 1, arm: 0.35 }]], loop(t, 8))),
		platform: move((t) => through([[0, { deck: 1 }], [0.15, { deck: 1 }], [0.4, { deck: 0 }], [0.65, { deck: 0 }], [0.9, { deck: 1 }], [1, { deck: 1 }]], loop(t, 6))),
		assemble: (t) => {
			const u = Math.min(1, loop(t, STEPS_N * 2.6 + 3) * ((STEPS_N * 2.6 + 3) / (STEPS_N * 2.6)));
			return kit.assemble(built.centre, u, STEPS_N, pose({ deck: 1, t: u >= 1 ? t : 0 }));
		},
		explode: (t) => {
			const u = loop(t, 9);
			const k = ease(Math.min(1, Math.max(0, (u - 0.05) / 0.3))) - ease(Math.min(1, Math.max(0, (u - 0.65) / 0.3)));
			return kit.explode(built.centre, k, pose({ deck: 0, t }));
		},
		idle: move(() => ({ deck: 1, arm: 0.06 }))
	};
	/** @type {Record<string, Pose>} */
	const poses = {
		rest: pose({ deck: 0 }),
		raised: pose({ deck: 1, arm: ARM_MAX, bucket: CURL - ARM_MAX }),
		dumping: pose({ deck: 1, arm: ARM_MAX, bucket: DUMP }),
		exploded: kit.explode(built.centre, 1, pose({ deck: 0 }))
	};
	return {
		rig: r,
		clips,
		poses,
		first: 'work',
		catalog: {
			assemblies: ASSEMBLIES,
			parts: built.catalogParts,
			steps: STEPS,
			sources: [
				{ label: SRC.repo, url: 'https://github.com/OpenSourceEcology/LifeTrac/tree/main/LifeTrac-v25' },
				{ label: SRC.bom, url: 'https://github.com/OpenSourceEcology/LifeTrac/blob/main/LifeTrac-v25/DESIGN-STRUCTURAL/drawings/generated/bom.csv' },
				{ label: SRC.params, url: 'https://github.com/OpenSourceEcology/LifeTrac/blob/main/LifeTrac-v25/DESIGN-STRUCTURAL/openscad/lifetrac_v25_params.scad' },
				{ label: SRC.hyd, url: 'https://github.com/OpenSourceEcology/LifeTrac/blob/main/LifeTrac-v25/DESIGN-HYDRAULIC/HYDRAULIC_BOM.md' },
				{ label: SRC.ctl, url: 'https://github.com/OpenSourceEcology/LifeTrac/blob/main/LifeTrac-v25/DESIGN-CONTROLLER/HARDWARE_BOM.md' },
				{ label: SRC.sa, url: 'https://github.com/OpenSourceEcology/LifeTrac/blob/main/LifeTrac-v25/DESIGN-STRUCTURAL/STRUCTURAL_ANALYSIS_LOG.md' },
				{ label: SRC.uwu, url: 'https://github.com/OpenSourceEcology/LifeTrac/tree/main/UWU' },
				{ label: SRC.lt6, url: 'https://wiki.opensourceecology.org/wiki/LifeTrac_6' }
			]
		}
	};
}

/** where the handheld's own frame (its face up, y) lands on the machine */
function handMatrix() {
	return new THREE.Matrix4().makeTranslation(...P(...HAND)).multiply(new THREE.Matrix4().makeRotationX(HAND_TILT));
}
/** a pin's point (Y, Z) turned `a` (rad, up positive) about a centre @param {[number, number]} c @param {[number, number]} p @param {number} a @returns {[number, number]} */
function turnAbout(c, p, a) {
	const y = p[0] - c[0], z = p[1] - c[1];
	return [c[0] + y * Math.cos(a) - z * Math.sin(a), c[1] + y * Math.sin(a) + z * Math.cos(a)];
}
/** the slope of the line from a to b (rad, up positive) @param {[number, number]} a @param {[number, number]} b */
function ang(a, b) {
	return Math.atan2(b[1] - a[1], b[0] - a[0]);
}
