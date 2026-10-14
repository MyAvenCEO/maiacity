/*
 * THE PICKUP — the double-cab pickup of the MaiaCity V1 world (the Thing: $lib/models/village.js `pickup`, its v3 with
 * four doors that open and a tailgate that drops) built as a Machine at AirSup's realism ($lib/assets): every part a
 * mechanic would name as its own solid in its measured material, the engine's insides there to cut open, the doors
 * and the tailgate that open, the bed a real floor that carries what is put on it, and a solver that drives it on the
 * road on real equations. The pieces it shares with the travel van (the wheels, the engine, the suspension, the body's
 * panels, the solver) are in ./vehicle.js. With a Power Cube: the Power Cube machine (./powercube.js, as it was at v3)
 * carried whole on the bed, its parts its own, strapped down, its weight on the springs and in the solver.
 *
 * ---------------------------------------------------------------- research (AirSup's step 1)
 * The machine: a two-wheel-drive double-cab pickup of the 1990s–2000s [inferred era], 5.35 m over its bumpers,
 * 1.86 m wide, 1.82 m to its roof, a 3.14 m wheelbase; four doors and five seats in a cab 2.2 m long; behind it a
 * pressed-steel bed 1.78 m long and 1.52 m wide inside (1.12 m between the wheel tubs), its floor 0.9 m off the
 * ground, a tailgate that drops flat on two check cables; blue paint. Running gear as such pickups had it [inferred,
 * and said so on each card]: a ladder frame kicked up over the rear axle, double wishbones with coil-over dampers in
 * front and a rack-and-pinion, a live axle on five-leaf semi-elliptic springs behind, ventilated discs in front and
 * drums behind, 265/70 R16 tyres on 7J steel wheels with six studs; a 2.5 L four-cylinder turbo-diesel with indirect
 * injection (93 × 92 mm, 21 : 1), 75 kW at 3,600 rpm and 240 N·m at 2,000; a 5-speed gearbox (4.31 · 2.33 · 1.44 ·
 * 1.00 · 0.84), a two-piece propshaft and a 4.10 axle; 1,750 kg ready to go with its driver, 950 kg payload.
 * The physics: the road's load F = m g Crr cos θ + m g sin θ + ½ ρ Cd A v², the power at the wheels P = F v (the one
 * number), the engine's P / η through its gear; the engine's torque from its full-load curve, the gear the driver
 * picks, the fuel from the engine's indicated work (a Willans line); the axles' loads with the climb's and the push's
 * transfer, the springs' sag. The inputs: the speed asked, the grade, the load, the doors, the tailgate. The break:
 * two and a half times its payload up a 35 % grade: even first gear gives less than the hill takes, the speed falls,
 * the engine lugs and stalls.
 * The Power Cube on the bed: Open Source Ecology's hydraulic power unit, ~181 kg (OSE's wiki), its engine off while it
 * rides, held by two ratchet straps to the bed's hooks; its mass is added to the load the solver carries.
 * Sources: the road-load equation and rolling resistance (Wong, "Theory of Ground Vehicles"; SAE J2452 for the
 * coefficient's range), drag of pickups (Hucho, "Aerodynamics of Road Vehicles"), Heywood's "Internal Combustion
 * Engine Fundamentals" for friction and consumption, leaf springs (SAE HS-788), the tyre's measures from its ETRTO
 * marking. No maker is named.
 *
 * In the asset's frame (./parts.js): metres, the ground at y 0, the front towards +z, +x its left (the driver's side:
 * it drives on the right, its wheel on the left).
 */
import * as THREE from 'three';
import { GEO, MAT, clamp, fmt } from '$lib/assets/kit.js';
import { assetKit } from '$lib/assets/parts.js';
import { CUBE, powerCube } from './powercube.js';
import { G, aim, at, box, circle, cluster, cyl, doorPanels, doubleWishbone, edgePanel, engineMaterials, frameY, halfCut, hinge, hose, inFrame, inlineEngine, insetEdges, ladderFrame, latheY, liveAxle, onEdge, onX, onY, ordinal, plate, propshaft, roundHole, roundPoly, seatGeometry, slab, steeringRack, steeringWheelGeometry, tyreSize, unitBar, vehicleMaterials, vehicleSolver, wheelCorner, xz, zyHole, zyShape } from './vehicle.js';

/** @typedef {[number, number, number]} V3 */
/** @typedef {[number, number]} V2 */

/** the pickup's measures (m): its body's width, its ends, the axles, its floors, waist and roof, its doors and its bed */
export const PU = {
	W: 1.86,
	front: 2.56,
	rear: -2.58,
	axle: { front: 1.92, rear: -1.22, x: 0.775 },
	floor: 0.62,
	sill: 0.5,
	waist: 1.28,
	roof: 1.82,
	/** the cab's back wall and the firewall under the windscreen */
	cab: { back: -0.68, firewall: 1.5 },
	/** the driver's seat (x, z) and the steering wheel's hub */
	driver: { x: 0.42, z: 0.62 },
	wheel: /** @type {V3} */ ([0.42, 1.2, 1.12]),
	/** the door openings (z from the back edge to the hinge), their bottom and top */
	door: { front: [0.47, 1.4], rear: [-0.55, 0.39], y0: 0.56, y1: 1.72 },
	/** the bed: its outer front wall, its floor, its sides' top and bottom, its inner walls (x) */
	bed: { front: -0.74, floor: 0.9, top: 1.3, skirt: 0.62, inner: 0.78, tub: 0.56 },
	/** where the Power Cube stands on the bed */
	cube: /** @type {V3} */ ([0, 0.9, -1.42])
};
const TYRE = tyreSize(265, 70, 16);
/** the Power Cube's mass (kg): about 400 lb, OSE's wiki */
export const CUBE_KG = 181;

const SOURCES = [
	{ label: 'Road load and rolling resistance (Wong, Theory of Ground Vehicles)', url: 'https://en.wikipedia.org/wiki/Rolling_resistance' },
	{ label: 'Drag of road vehicles (Hucho)', url: 'https://en.wikipedia.org/wiki/Automobile_drag_coefficient' },
	{ label: 'Engine friction and fuel (Heywood, IC Engine Fundamentals)', url: 'https://en.wikipedia.org/wiki/Brake-specific_fuel_consumption' },
	{ label: 'Tyre markings (ETRTO)', url: 'https://en.wikipedia.org/wiki/Tire_code' },
	{ label: 'Leaf and coil suspension', url: 'https://en.wikipedia.org/wiki/Leaf_spring' },
	{ label: 'Power Cube (Open Source Ecology wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube' },
	{ label: 'Machine skill kit (AirSup, MIT)', url: 'https://github.com/AirsupHQ/machine-skill' }
];
const SRC = { road: SOURCES[0].label, air: SOURCES[1].label, eng: SOURCES[2].label, tyre: SOURCES[3].label, susp: SOURCES[4].label, cube: SOURCES[5].label };

const ASSEMBLIES = /** @type {import('$lib/actors/parts.js').Assembly[]} */ ([
	{ id: 'chassis', label: 'Chassis and suspension', note: 'The ladder frame, kicked up over the rear axle; double wishbones and coil-overs in front with the rack-and-pinion, a live axle on leaf springs behind.', out: [0, -0.7, 0] },
	{ id: 'wheels', label: 'Wheels and brakes', note: 'Four 265/70 R16 tyres on steel wheels and a fifth under the bed; vented discs and callipers in front, drums behind.', out: [0.5, -0.2, 0] },
	{ id: 'engine', label: 'Engine', note: 'A 2.5 L four-cylinder turbo-diesel under the bonnet, 75 kW and 240 N·m.', out: [0, 0.5, 0.3] },
	{ id: 'drivetrain', label: 'Gearbox and drive', note: 'The clutch, the 5-speed gearbox, the two-piece propshaft and the rear axle’s crown wheel and pinion.', out: [0, -0.4, -0.3] },
	{ id: 'services', label: 'Cooling, fuel and power', note: 'The radiator in the nose, the battery and the air filter beside the engine, the fuel tank under the cab, the exhaust.', out: [0, -0.35, 0.2] },
	{ id: 'body', label: 'Cab', note: 'The steel cab on its rubber mounts: its sides, nose, bonnet, roof and back wall, the floor, the glass, the lights and bumpers.', out: [0, 0.9, 0.2] },
	{ id: 'doors', label: 'Doors', note: 'Four doors, each on two hinges at its front edge.', out: [0.6, 0.3, 0] },
	{ id: 'cab', label: 'Seats and dashboard', note: 'The dashboard and its gauges, the steering wheel and pedals, the console and the lever, two seats in front and a bench for three behind.', out: [0, 0.6, 0] },
	{ id: 'bed', label: 'Bed and tailgate', note: 'The steel bed behind the cab on its own mounts: its floor, its double-walled sides and wheel tubs, the tailgate on its hinges and check cables.', out: [0, 0.6, -0.9] }
]);
const STEPS = ['Weld the frame and hang the suspension, the axle and the steering on it', 'Bolt on the wheels and brakes', 'Drop in the engine on its mounts', 'Bolt on the gearbox; fit the propshaft and the axle’s gears', 'Fit the radiator, battery, air filter, fuel tank and exhaust', 'Lower the cab onto the frame; fit the glass, lights and bumpers', 'Hang the doors', 'Fit the dashboard, the steering wheel, the seats', 'Bolt the bed on behind the cab and hang its tailgate'];

/** the pickup's paint and trim (sRGB-ish values as the kit's materials take them) */
function materials() {
	return {
		paint: MAT.paint({ color: [0.12, 0.24, 0.36], roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
		trim: MAT.satin({ color: [0.03, 0.03, 0.032], roughness: 0.6 }),
		rubber: MAT.rubber({ color: [0.02, 0.02, 0.022], roughness: 0.7 }),
		chrome: MAT.chrome({ roughness: 0.12 }),
		glass: MAT.glass({ color: [0.86, 0.93, 0.95], roughness: 0.04 }),
		lens: MAT.glass({ color: [0.95, 0.95, 0.92], roughness: 0.08, thickness: 0.01 }),
		red: MAT.plastic({ color: [0.45, 0.02, 0.015], roughness: 0.25, transmission: 0.4, thickness: 0.01 }),
		amber: MAT.plastic({ color: [0.8, 0.32, 0.02], roughness: 0.25, transmission: 0.4, thickness: 0.01 }),
		reflector: MAT.chrome({ roughness: 0.2 }),
		plate: MAT.paint({ color: [0.85, 0.85, 0.82], roughness: 0.4 }),
		floor: MAT.rubber({ color: [0.03, 0.03, 0.033], roughness: 0.85 }),
		fabric: MAT.satin({ color: [0.2, 0.21, 0.23], roughness: 0.95, finish: 'cast' }),
		vinyl: MAT.plastic({ color: [0.035, 0.035, 0.038], roughness: 0.62 }),
		dash: MAT.plastic({ color: [0.05, 0.05, 0.052], roughness: 0.7 }),
		card: MAT.plastic({ color: [0.2, 0.2, 0.21], roughness: 0.85 }),
		lining: MAT.satin({ color: [0.45, 0.44, 0.41], roughness: 0.95, finish: 'cast' }),
		dial: MAT.satin({ color: [0.015, 0.015, 0.018], roughness: 0.4 }),
		white: MAT.plastic({ color: [0.85, 0.85, 0.82], roughness: 0.4 }),
		needle: MAT.plastic({ color: [0.85, 0.22, 0.02], roughness: 0.3 }),
		liner: MAT.plastic({ color: [0.035, 0.035, 0.04], roughness: 0.92 }),
		strap: MAT.satin({ color: [0.85, 0.45, 0.04], roughness: 0.8 }),
		cable: MAT.steel({ color: [0.6, 0.6, 0.62], roughness: 0.35 }),
		tank: MAT.paint({ color: [0.05, 0.05, 0.055], roughness: 0.6 }),
		battery: MAT.plastic({ color: [0.02, 0.02, 0.022], roughness: 0.5 }),
		lead: MAT.steel({ color: [0.42, 0.42, 0.44], roughness: 0.5, finish: 'cast' }),
		core: MAT.aluminium({ color: [0.55, 0.56, 0.57], roughness: 0.6 }),
		silencer: MAT.steelDark({ color: [0.2, 0.17, 0.15], roughness: 0.7 }),
		filterBox: MAT.plastic({ color: [0.03, 0.03, 0.035], roughness: 0.55 })
	};
}

// ---------------------------------------------------------------- the cab's panels

/**
 * The cab's side profile, (z, y) anticlockwise from its back bottom: the sill with the front wheel's arch cut up into
 * it, the nose, the bonnet, the cowl, the windscreen, the roof, the back wall. Each edge's radius: how far its panel's
 * rounded edge reaches round onto the side (0 along the sill and the arch).
 * @returns {{ pts: V2[], r: number[], seg: boolean[], k0: number }}
 */
function profile() {
	const { axle, sill, front, roof, cab } = PU;
	const yw = TYRE.r - 0.01, Ra = 0.46;
	/** @type {V2[]} */
	const pts = [[cab.back, sill]];
	const a0 = Math.PI - Math.asin((sill - yw) / Ra), a1 = Math.asin((sill - yw) / Ra);
	for (let k = 0; k <= 14; k++) {
		const a = a0 + ((a1 - a0) * k) / 14;
		pts.push([axle.front + Ra * Math.cos(a), yw + Ra * Math.sin(a)]);
	}
	const k0 = pts.length;
	// the valance, the nose's face, its top edge, the bonnet, the cowl, the windscreen, the roof's front corner, the
	// roof, its back corner, the back wall
	pts.push([front - 0.06, sill], [front, 0.62], [front + 0.02, 1.0], [front - 0.02, 1.1], [1.6, 1.25], [1.52, 1.26], [1.16, 1.77], [1.08, roof], [cab.back + 0.08, roof], [cab.back, roof - 0.06]);
	const er = [0.06, 0.08, 0.08, 0.08, 0.05, 0.06, 0.06, 0.06, 0.05, 0.05];
	/** @type {number[]} */
	const r = [];
	/** @type {boolean[]} */
	const seg = [];
	for (let k = 0; k < pts.length; k++) {
		r.push(k < k0 ? 0 : er[k - k0]);
		seg.push(k >= k0);
	}
	return { pts, r, seg, k0 };
}

/**
 * The bed's side, (z, y) anticlockwise from its back bottom: its skirt with the rear wheel's arch cut up into it, its
 * front, its top, its back post; and its corners' radii.
 * @returns {{ pts: V2[], r: number[] }}
 */
function bedSide() {
	const { axle, bed, rear } = PU;
	const yw = TYRE.r - 0.01, Ra = 0.47;
	/** @type {V2[]} */
	const pts = [[rear, bed.skirt]];
	const r = [0.03];
	const a0 = Math.PI - Math.asin((bed.skirt - yw) / Ra), a1 = Math.asin((bed.skirt - yw) / Ra);
	for (let k = 0; k <= 14; k++) {
		const a = a0 + ((a1 - a0) * k) / 14;
		pts.push([axle.rear + Ra * Math.cos(a), yw + Ra * Math.sin(a)]);
		r.push(0);
	}
	pts.push([bed.front, bed.skirt], [bed.front, bed.top], [rear, bed.top]);
	r.push(0.03, 0.03, 0.03);
	return { pts, r };
}

/** an arched strip over a wheel, from x0 to x1 (both sides), its middle at (zc, yc) @param {number} R @param {number} a0 @param {number} a1 @param {number} x0 @param {number} x1 @param {number} zc @param {number} yc */
function archStrip(R, a0, a1, x0, x1, zc, yc) {
	const s = new THREE.Shape();
	s.absarc(0, 0, R + 0.006, a1, a0, false);
	s.absarc(0, 0, R, a0, a1, true);
	s.closePath();
	return [-1, 1].map((sx) => plate(s, x1 - x0, 6).rotateY(Math.PI / 2).translate(sx * (x0 + (x1 - x0) / 2), yc, zc));
}

// ---------------------------------------------------------------- the pickup on the road

/** the pickup as the solver runs it [inferred where marked in the research] */
export const VEHICLE = /** @type {import('./vehicle.js').Vehicle} */ ({
	kerb: 1750,
	payload: 950,
	Crr: 0.012,
	CdA: 1.25,
	r: TYRE.r * 0.97,
	eta: 0.9,
	gears: [4.31, 2.33, 1.44, 1.0, 0.84],
	final: 4.1,
	engine: { rpm: [700, 1000, 1500, 2000, 2400, 3000, 3600, 4000, 4400], nm: [92, 140, 205, 240, 236, 224, 199, 180, 80], idle: 750, stall: 540, max: 4400, up: 3500, down: 1300, launch: 1200, Vd: 2.5e-3, fmep: 1.7e5, bsfc: 205, fuel: 'diesel', J: 0.3 },
	Jw: 1.4,
	wheels: 4,
	axles: { wb: PU.axle.front - PU.axle.rear, h: 0.8, front: 0.57, loadFront: 0.2, k: [45000, 60000], travel: [0.08, 0.1] }
});
const KMH = 1 / 3.6;

/**
 * The pickup: a root at its real size, every part its own, its solver driving it; with `cube` the Power Cube (v3)
 * carried on its bed.
 * @param {{ speed?: number, grade?: number, load?: number, doors?: number, tailgate?: number, cube?: boolean }} [o] the
 *   speed asked (km/h), the grade (%), the load in it (kg, people and cargo, the cube's own mass besides), how far its
 *   doors and its tailgate are open (0 shut … 1 open), and whether the Power Cube rides on its bed
 * @returns {THREE.Group}
 */
export function pickup({ speed = 90, grade = 0, load = 200, doors = 0, tailgate = 0, cube = false } = {}) {
	const root = new THREE.Group();
	root.name = cube ? 'Pickup with a Power Cube' : 'Pickup';
	const M = materials(), R = vehicleMaterials(), E = engineMaterials();
	const steps = cube ? [...STEPS, 'Lift the Power Cube onto the bed and strap it down'] : STEPS;
	const sources = cube ? SOURCES : SOURCES.filter((s) => s.label !== SRC.cube);
	const kit = assetKit(root, { assemblies: ASSEMBLIES, steps, sources });
	const m = (/** @type {THREE.BufferGeometry} */ geo, /** @type {THREE.Material} */ mat) => kit.mesh(geo, mat);
	/** the sprung body: everything the springs carry, sinking and pitching on them */
	const body = new THREE.Group();
	body.name = 'sprung';
	root.add(body);
	/** a part: its meshes, its card and how it is shown (in the body unless said) */
	const part = (/** @type {any} */ info, /** @type {THREE.Object3D[]} */ objs, /** @type {import('$lib/assets/parts.js').How} */ how = {}, parent = /** @type {THREE.Object3D} */ (body)) => {
		const grp = new THREE.Group();
		grp.add(...objs);
		return kit.part(grp, info, how, parent);
	};
	const { W, axle, floor, bed } = PU, X = W / 2;
	const yw = TYRE.r - 0.01;
	const sim = vehicleSolver(VEHICLE);
	const kmh = () => sim.s.v * 3.6;
	const extra = cube ? CUBE_KG : 0;

	/* ------------------------------------------------------------ the frame */
	const rails = /** @type {V2[]} */ ([[2.5, 0.5], [0.95, 0.5], [-0.4, 0.5], [-0.64, 0.68], [-2.52, 0.68]]);
	{
		const g = [ladderFrame({ x: 0.44, w: 0.065, h: 0.14, t: 0.0045, path: rails, cross: [2.45, 0.45, -0.95, -1.75, -2.45] })];
		// the front suspension's dropped crossmember and the lower arms' brackets, the coil-overs' towers and the upper
		// arms' brackets on the rails
		g.push(at(box(0.84, 0.08, 0.12, 0.01), 0, 0.32, axle.front));
		for (const sx of [-1, 1]) {
			g.push(at(box(0.05, 0.16, 0.12, 0.008), sx * 0.4, 0.39, axle.front), at(box(0.05, 0.06, 0.44, 0.008), sx * 0.3, 0.29, axle.front));
			g.push(at(box(0.13, 0.27, 0.15, 0.012), sx * 0.5, 0.7, axle.front), at(box(0.05, 0.1, 0.05, 0.006), sx * 0.47, 0.6, axle.front + 0.15), at(box(0.05, 0.1, 0.05, 0.006), sx * 0.47, 0.6, axle.front - 0.15));
			// the engine's mounting brackets, the cab's and the bed's rubber mounts' outriggers
			g.push(at(box(0.08, 0.02, 0.12, 0.004), sx * 0.42, 0.578, 1.76));
			for (const z of [1.35, 0.42, -0.55]) g.push(at(box(0.14, 0.04, 0.07, 0.006), sx * 0.5, 0.56, z));
			// the rear axle's bump stops under the rails
			g.push(at(box(0.06, 0.05, 0.06, 0.012), sx * 0.47, 0.585, axle.rear));
		}
		// the gearbox's crossmember under its tail, the hitch's receiver at the back
		g.push(at(box(0.84, 0.05, 0.08, 0.008), 0, 0.44, 0.84), at(box(0.05, 0.08, 0.08, 0.006), 0.39, 0.47, 0.84), at(box(0.05, 0.08, 0.08, 0.006), -0.39, 0.47, 0.84));
		g.push(at(box(0.84, 0.08, 0.08, 0.008), 0, 0.56, -2.5), at(box(0.07, 0.07, 0.34, 0.006), 0, 0.5, -2.52), at(box(0.12, 0.012, 0.1, 0.004), 0, 0.53, -2.38));
		part({ id: 'frame', label: 'Ladder frame', assembly: 'chassis', source: SRC.susp, what: 'Two boxed steel rails the length of the pickup, low under the cab and kicked up over the rear axle so it can rise under the bed, joined by crossmembers; the cab and the bed sit on it on rubber mounts, the engine between its rails. A dropped crossmember carries the front suspension, another the gearbox’s tail, and the hitch’s receiver is welded to the last.', specs: [['Rails', '140 × 65 × 4.5 mm box [inferred]'], ['Kick-up', '180 mm over the axle']] }, [m(GEO.merge(g), R.chassis)], { explode: [0, -0.6, 0] });
	}

	/* ------------------------------------------------------------ the wheels */
	const tagWheel = (/** @type {string} */ which) => ({ text: `Wheel, ${which}`, at: /** @type {V3} */ ([0.12, 0.22, 0]), side: /** @type {'left'} */ ('left'), value: () => `${fmt((sim.s.v / VEHICLE.r) * 9.549)} rpm · ${fmt((which.startsWith('front') ? sim.s.loadF : sim.s.loadR) / G)} kg on it` });
	const wheelOpts = { size: TYRE, rimW: 7 * 0.0254, et: 0.03, rim: /** @type {'steel'} */ ('steel'), studs: 6, pcd: 0.1397, pattern: /** @type {'allTerrain'} */ ('allTerrain'), M: R, assembly: 'wheels', source: SRC.tyre, capMat: M.chrome };
	const disc = { r: 0.145, rIn: 0.09, t: 0.026 }, drum = { r: 0.148, depth: 0.08 };
	const corners = {
		fl: wheelCorner(kit, { ...wheelOpts, id: 'fl', label: 'front left', at: [axle.x, yw, axle.front], side: 1, brake: 'disc', disc, steers: true, arm: 1, drive: 'The road; steered by the knuckle', tag: tagWheel('front left') }),
		fr: wheelCorner(kit, { ...wheelOpts, id: 'fr', label: 'front right', at: [-axle.x, yw, axle.front], side: -1, brake: 'disc', disc, steers: true, arm: 1 }),
		rl: wheelCorner(kit, { ...wheelOpts, id: 'rl', label: 'rear left', at: [axle.x, yw, axle.rear], side: 1, brake: 'drum', drum, drive: 'The half-shaft, from the differential', tag: tagWheel('rear left') }),
		rr: wheelCorner(kit, { ...wheelOpts, id: 'rr', label: 'rear right', at: [-axle.x, yw, axle.rear], side: -1, brake: 'drum', drum, drive: 'The half-shaft, from the differential' })
	};
	// the spare under the bed's back, on its winch cradle
	{
		const ys = 0.33, zs = -2.0;
		const spare = GEO.lathe([[0.205, -0.12], [0.3, -0.13], [0.37, -0.115], [0.389, -0.06], [0.389, 0.06], [0.37, 0.115], [0.3, 0.13], [0.205, 0.12]], 40).translate(0, ys, zs);
		const rim = latheY([[0.06, -0.09], [0.204, -0.09], [0.204, 0.09], [0.06, 0.09]], 32).translate(0, ys, zs);
		const cradle = GEO.merge([at(box(0.5, 0.012, 0.05, 0.004), 0, ys - 0.135, zs), at(box(0.05, 0.012, 0.5, 0.004), 0, ys - 0.135, zs), cyl([0, ys - 0.13, zs], [0, 0.62, zs], 0.004, 6)]);
		part({ id: 'spare-wheel', label: 'Spare wheel', assembly: 'wheels', source: SRC.tyre, what: 'A fifth wheel and tyre hung flat under the back of the bed on a cable: a crank through the bumper winds it down.', specs: [['Tyre', TYRE.code]] }, [m(spare, R.tyre), m(rim, R.rimSteel), m(cradle, R.chassis)], { explode: [0, -0.5, -0.3] });
	}

	/* ------------------------------------------------------------ the suspension and the steering */
	const front = /** @type {const} */ (['fl', 'fr']).map((id) => {
		const sx = id === 'fl' ? 1 : -1;
		return doubleWishbone(kit, {
			id,
			label: id === 'fl' ? 'front left' : 'front right',
			corner: corners[id],
			body,
			upper: [[sx * 0.46, 0.63, axle.front + 0.15], [sx * 0.46, 0.63, axle.front - 0.15]],
			lower: [[sx * 0.29, 0.27, axle.front + 0.19], [sx * 0.29, 0.27, axle.front - 0.19]],
			top: [sx * 0.5, 0.82, axle.front],
			rack: [sx * 0.36, 0.34, axle.front + 0.22],
			coil: { R: 0.056, wire: 0.012, turns: 5.5, k: VEHICLE.axles.k[0] },
			M: R,
			assembly: 'chassis',
			source: SRC.susp,
			tag: id === 'fl' ? { text: 'Front spring', at: [0, 0.3, 0], side: 'left', value: () => `sunk ${fmt(sim.s.sagF * 1000)} mm${sim.s.sagF > VEHICLE.axles.travel[0] ? ' · on its bump stop' : ''}` } : undefined
		});
	});
	steeringRack(kit, { parent: body, y: 0.34, z: axle.front + 0.22, half: 0.42, pinion: 0.3, shaft: [[0.3, 0.39, axle.front + 0.23], [0.38, 0.72, 1.86], [0.42, 1.0, 1.575]], M: R, assembly: 'chassis', source: SRC.susp });
	const rearAxle = liveAxle(kit, {
		body,
		z: axle.rear,
		y: yw,
		hub: axle.x - 0.02,
		springX: 0.47,
		over: false,
		leaf: { L: 1.25, w: 0.06, t: 0.009, n: 5, camber: 0.09 },
		hanger: 0.62,
		dampers: [[0.38, 0.64, -0.96], [-0.38, 0.64, -0.96]],
		ratio: VEHICLE.final,
		rate: VEHICLE.axles.k[1],
		M: R,
		E,
		assembly: 'drivetrain',
		springs: 'chassis',
		source: SRC.susp,
		tag: { text: 'Rear springs', at: [0.47, 0.32, -1.6], side: 'left', value: () => `sunk ${fmt(sim.s.sagR * 1000)} mm${sim.s.sagR > VEHICLE.axles.travel[1] ? ' · on the bump stops' : ''}` }
	});

	/* ------------------------------------------------------------ the engine and the gearbox */
	const EAT = /** @type {V3} */ ([0, 0.68, 1.76]);
	const engine = inlineEngine(kit, {
		parent: body,
		at: EAT,
		bore: 0.093,
		stroke: 0.092,
		rod: 0.155,
		pitch: 0.104,
		turbo: true,
		fan: true,
		compression: 21,
		well: 'rear',
		gears: VEHICLE.gears,
		lever: [0, 0.43, -0.76],
		mounts: [[0.42, -0.09, 0], [-0.42, -0.09, 0]],
		rearMount: [0, -0.18, -0.92],
		assembly: 'engine',
		gearAssembly: 'drivetrain',
		source: SRC.eng,
		name: '2.5 L turbo-diesel',
		specs: [['Power', '75 kW at 3,600 rpm [inferred]'], ['Torque', '240 N·m at 2,000 rpm [inferred]'], ['Injection', 'Indirect, 21 : 1, turbocharged'], ['Friction', '1.7 bar mean pressure at 2,000 rpm [inferred]']],
		M: E,
		tag: () => (sim.s.stalled ? 'stalled' : `${fmt(sim.s.rpm)} rpm · ${fmt(Math.max(0, sim.s.Te))} N·m · ${fmt(Math.max(0, sim.s.Pe) / 1000, 1)} kW`),
		gearTag: () => (sim.s.stalled ? 'stalled in 1st' : sim.s.v < 0.05 && sim.s.at.vSet < 0.05 ? 'neutral' : `${ordinal(sim.s.gear)} gear · ${VEHICLE.gears[sim.s.gear - 1].toFixed(2)} : 1${sim.s.launch ? ' · clutch slipping' : ''}`)
	});
	const shaft = propshaft(kit, { n: 2, r: 0.032, M: R, assembly: 'drivetrain', source: SRC.eng, specs: [['Tube', 'Ø 64 × 1.6 mm steel [inferred]'], ['Joints', '4 universal joints, a centre bearing']] });
	const BEARING = /** @type {V3} */ ([0, 0.52, -0.1]);
	const PINION = /** @type {V3} */ ([0, yw - 0.01, axle.rear + 0.065 + 0.212]);
	// the centre bearing's bracket, bolted up under the cab's floor
	part({ id: 'bearing-bracket', label: 'Centre bearing bracket', assembly: 'drivetrain', source: SRC.eng, what: 'A pressed-steel bracket under the cab’s floor holding the propshaft’s centre bearing in its rubber.', specs: [['Rubber', 'Bonded ring [inferred]']] }, [m(GEO.merge([at(box(0.22, 0.01, 0.06, 0.003), 0, 0.592, -0.1), at(box(0.012, 0.05, 0.05, 0.003), -0.1, 0.57, -0.1), at(box(0.012, 0.05, 0.05, 0.003), 0.1, 0.57, -0.1)]), R.chassis)], { explode: [0, -0.3, 0] });

	/* ------------------------------------------------------------ cooling, fuel, power, exhaust */
	{
		const zr = 2.32, yr = 0.86, wr = 0.66, hr = 0.38;
		const fins = [];
		for (let k = 0; k <= 56; k++) fins.push(slab(0.0006, hr, 0.036).translate(-wr / 2 + (k * wr) / 56, yr, zr));
		const core = GEO.merge([at(box(wr, hr, 0.03, 0.002), 0, yr, zr), ...fins]);
		const tanks = GEO.merge([at(box(wr + 0.06, 0.05, 0.06, 0.012), 0, yr + hr / 2 + 0.025, zr), at(box(wr + 0.06, 0.05, 0.06, 0.012), 0, yr - hr / 2 - 0.025, zr), cyl([0.22, yr + hr / 2 + 0.05, zr], [0.22, yr + hr / 2 + 0.07, zr], 0.022, 20)]);
		const ring = new THREE.Shape();
		ring.absarc(0, 0, 0.215, 0, Math.PI * 2, false);
		ring.holes.push(circle(0, 0, 0.2));
		const face = /** @type {THREE.Shape} */ (roundPoly([[-wr / 2, -hr / 2], [wr / 2, -hr / 2], [wr / 2, hr / 2], [-wr / 2, hr / 2]], 0.02));
		face.holes.push(circle(0, 0, 0.205));
		const sh = GEO.merge([plate(ring, 0.08, 24).translate(0, yr, zr - 0.07), plate(face, 0.006, 6).translate(0, yr, zr - 0.026)]);
		const wo = engine.points.waterOut, wi = engine.points.waterIn;
		const hoses = [hose([[0.26, yr + hr / 2 + 0.02, zr - 0.03], [0.2, yr + hr / 2 + 0.02, zr - 0.12], [wo[0] + 0.05, wo[1], wo[2] + 0.12], wo], 0.019, 8), hose([[-0.26, yr - hr / 2 - 0.02, zr - 0.03], [-0.2, yr - hr / 2 - 0.04, zr - 0.15], [wi[0] - 0.05, wi[1] - 0.05, wi[2] + 0.1], wi], 0.019, 8)];
		part({ id: 'radiator', label: 'Radiator and shroud', assembly: 'services', source: SRC.eng, what: 'In the nose behind the grille: the engine’s coolant runs down through the radiator’s finned tubes and gives its heat to the air the road and the engine’s fan pull through it; the shroud round the fan makes it pull through all of the core.', specs: [['Core', `${Math.round(wr * 1000)} × ${Math.round(hr * 1000)} mm, aluminium [inferred]`], ['Rejects', 'About a third of the fuel’s heat at full load']] }, [m(core, M.core), m(tanks, E.plastic), m(sh, E.plastic), m(GEO.merge(hoses), E.hose)], { explode: [0, 0.3, 0.8], tag: { text: 'Radiator', at: [0.34, yr + 0.22, zr], side: 'right', value: () => `${fmt(heat(), 1)} kW to the air` } });
		// the battery on the right beside the engine, the air filter on the left
		const bt = { x: -0.58, y: 0.88, z: 2.08, w: 0.17, h: 0.19, d: 0.26 };
		part({ id: 'battery', label: '12 V battery', assembly: 'services', source: SRC.eng, what: 'The starting battery on its tray over the right front wheel: it cranks the engine and heats the glow plugs; the alternator charges it.', specs: [['Capacity', '80 Ah, 640 A cold cranking [inferred]']] }, [m(at(box(bt.w, bt.h, bt.d, 0.008), bt.x, bt.y + bt.h / 2, bt.z), M.battery), m(GEO.merge([cyl([bt.x, bt.y + bt.h, bt.z - 0.09], [bt.x, bt.y + bt.h + 0.02, bt.z - 0.09], 0.009, 12), cyl([bt.x, bt.y + bt.h, bt.z + 0.09], [bt.x, bt.y + bt.h + 0.02, bt.z + 0.09], 0.009, 12)]), M.lead), m(GEO.merge([at(box(bt.w + 0.04, 0.012, bt.d + 0.04, 0.004), bt.x, bt.y - 0.006, bt.z), hose([[bt.x, bt.y + bt.h + 0.02, bt.z - 0.09], [bt.x + 0.1, bt.y + 0.1, bt.z - 0.2], [-0.3, 0.62, 1.7], [-0.16, 0.6, 1.5]], 0.007, 8)]), M.trim)], { explode: [-0.4, 0.3, 0.3] });
		const ia = engine.points.intake;
		const af = GEO.merge([at(box(0.2, 0.17, 0.3, 0.02), 0.58, 0.97, 2.1), cyl([0.58, 0.97, 2.25], [0.58, 0.97, 2.3], 0.04, 20)]);
		part({ id: 'air-filter', label: 'Air filter and intake', assembly: 'services', source: SRC.eng, what: 'The engine breathes through a paper element in this box over the left front wheel, then through a duct to the turbocharger’s compressor.', specs: [['Element', 'Paper, dry [inferred]']] }, [m(af, M.filterBox), m(hose([[0.58, 0.97, 1.95], [0.55, 0.98, 1.82], [0.4, 0.98, 1.72], [ia[0] + 0.08, ia[1] + 0.06, ia[2]], ia], 0.035, 12), E.hose)], { explode: [0.4, 0.3, 0.3] });
		// the fuel tank under the cab's back on the right, its filler up to the bed's side, its line to the pump
		const ft = { x: -0.645, y: 0.43, z: -0.2, w: 0.3, h: 0.2, d: 0.7 };
		const tankG = GEO.merge([at(box(ft.w, ft.h, ft.d, 0.03), ft.x, ft.y, ft.z), at(box(ft.w + 0.01, 0.01, 0.02, 0.003), ft.x, ft.y - ft.h / 2 + 0.005, ft.z + 0.2), at(box(ft.w + 0.01, 0.01, 0.02, 0.003), ft.x, ft.y - ft.h / 2 + 0.005, ft.z - 0.2)]);
		part({ id: 'fuel-tank', label: 'Fuel tank', assembly: 'services', source: SRC.eng, what: 'A 76 L pressed-steel tank outside the right rail under the cab’s back, hung on two straps; its filler neck runs up to the cap on the bed’s side.', specs: [['Volume', '76 L [inferred]'], ['Fuel', 'Diesel, 835 g/L']] }, [m(tankG, M.tank), m(GEO.merge([hose([[ft.x - 0.08, ft.y + ft.h / 2, ft.z - 0.32], [-0.8, 0.56, -0.71], [-0.86, 0.9, -0.84], [-0.915, 1.06, -0.88]], 0.022, 10), hose([[ft.x + 0.13, ft.y + 0.06, ft.z + 0.35], [-0.38, 0.47, 0.3], [-0.3, 0.5, 1.0], [-0.22, 0.62, 1.5], [-0.16, 0.7, 1.62]], 0.005, 6)]), E.hose), m(cyl([-0.925, 1.06, -0.88], [-0.935, 1.06, -0.88], 0.04, 20), M.trim)], { explode: [-0.5, -0.3, 0], tag: { text: 'Fuel', at: [ft.x - ft.w / 2, ft.y, ft.z], side: 'right', value: () => (sim.s.stalled ? 'stopped' : `${fmt(sim.s.fuel, 1)} L/h${sim.s.v > 0.5 ? ` · ${fmt(sim.s.l100, 1)} L/100 km` : ''}`) } });
		const ex = engine.points.exhaust;
		const pipe = hose([ex, [ex[0], ex[1] - 0.2, ex[2] - 0.08], [-0.24, 0.42, 1.1], [-0.25, 0.38, 0.84], [-0.25, 0.42, 0.5], [-0.25, 0.47, 0.24]], 0.025, 12);
		const tail = hose([[-0.25, 0.47, -0.84], [-0.23, 0.5, -1.0], [-0.22, 0.55, -1.25], [-0.24, 0.56, -1.7], [-0.4, 0.55, -2.3], [-0.52, 0.47, -2.5], [-0.56, 0.42, -2.66]], 0.025, 12);
		const silencer = at(box(0.24, 0.15, 1.04, 0.05), -0.25, 0.47, -0.3);
		part({ id: 'exhaust', label: 'Exhaust and silencer', assembly: 'services', source: SRC.eng, what: 'From the turbocharger down and back under the cab through the silencer, over the axle and out under the back on the right, hung on rubber loops.', specs: [['Pipe', 'Ø 50 mm steel [inferred]']] }, [m(GEO.merge([pipe, tail]), E.hot), m(silencer, M.silencer)], { explode: [0, -0.5, 0] });
	}
	/** the coolant's heat to the air (kW): about 30 % of the fuel's heat [inferred] */
	const heat = () => (sim.s.fuel * 0.835 * 42.6 * 0.3) / 3.6;

	/* ------------------------------------------------------------ the cab's body */
	const prof = profile();
	const t = 0.008;
	const D = PU.door;
	const n = prof.pts.length;
	const kFace = prof.k0 + 1, kBonnet = prof.k0 + 3, kWs = prof.k0 + 5;
	/** the A pillar's line on the side: the windscreen's edge moved back by `d` (z at height y) */
	const ws0 = prof.pts[kWs], ws1 = prof.pts[kWs + 1];
	const aLine = (/** @type {number} */ d, /** @type {number} */ y) => {
		const dz = ws1[0] - ws0[0], dy = ws1[1] - ws0[1], L = Math.hypot(dz, dy);
		const pz = ws0[0] - (dy / L) * d, py = ws0[1] + (dz / L) * d;
		return pz + ((y - py) * dz) / dy;
	};
	const hingeZ = D.front[1];
	const yA = (() => {
		// where the front door's straight front edge meets the A pillar's line
		let y = 1.1;
		for (let k = 0; k < 40; k++) y += (aLine(0.1, y) - hingeZ) * 0.5;
		return y;
	})();
	/** @type {V2[]} */
	const fHole = [[D.front[0], D.y0], [hingeZ, D.y0], [hingeZ, yA], [aLine(0.1, D.y1), D.y1], [D.front[0], D.y1]];
	/** @type {V2[]} */
	const fWin = [[D.front[0] + 0.06, 1.3], [aLine(0.165, 1.3), 1.3], [aLine(0.165, 1.67), 1.67], [D.front[0] + 0.06, 1.67]];
	/** @type {V2[]} */
	const rHole = [[D.rear[0], D.y0], [D.rear[1], D.y0], [D.rear[1], D.y1], [D.rear[0] + 0.08, D.y1], [D.rear[0], D.y1 - 0.08]];
	/** @type {V2[]} */
	const rWin = [[D.rear[0] + 0.06, 1.3], [D.rear[1] - 0.06, 1.3], [D.rear[1] - 0.06, 1.67], [D.rear[0] + 0.1, 1.67], [D.rear[0] + 0.06, 1.63]];
	{
		const outline = insetEdges(prof.pts, prof.r);
		const sides = [];
		for (const sx of [-1, 1]) {
			const s = zyShape(outline, 0);
			s.holes.push(zyHole(fHole, 0.03), zyHole(rHole, 0.03));
			sides.push(onX(plate(s, t, 6), sx * (X - t / 2)));
		}
		// the front wheels' housings: an arched top over each, and the inner wings over them to the bonnet's edge
		const houses = [];
		const a0 = Math.PI - Math.asin((PU.sill - yw) / 0.455), a1 = Math.asin((PU.sill - yw) / 0.455);
		houses.push(...archStrip(0.455, a0, a1, 0.6, X - t, axle.front, yw));
		for (const sx of [-1, 1]) houses.push(onX(plate(zyShape([[1.5, 0.84], [2.38, 0.84], [2.38, 1.08], [1.5, 1.17]], 0.01), 0.006, 4), sx * 0.7));
		part({ id: 'cab-sides', label: 'Cab sides and front wings', assembly: 'body', source: SRC.air, what: 'The two pressed-steel sides of the cab and its front wings in one: the four door openings, the pillars between them, the front wheels’ arches cut in; the wheel housings and inner wings inside.', specs: [['Steel', '0.8 mm, painted [inferred]']] }, [m(GEO.merge(sides), M.paint), m(GEO.merge(houses), M.trim)], { explode: [0, 0.3, 0], xray: 'shell' });
		// the nose, the bonnet, the cowl, the windscreen's frame, the roof and the back wall: one panel for each edge
		/** @type {THREE.BufferGeometry[]} */
		const ps = [];
		/** @type {THREE.BufferGeometry[]} */
		const bonnet = [];
		/** @type {THREE.BufferGeometry[]} */
		const screen = [];
		for (let k = 0; k < n; k++) {
			if (!prof.seg[k]) continue;
			const a = prof.pts[k], b = prof.pts[(k + 1) % n], R0 = prof.r[k];
			const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
			/** @type {THREE.Path[]} */
			const holes = [];
			const hw = X - R0;
			if (k === kWs) {
				holes.push(roundHole([[-hw + 0.045, 0.05], [hw - 0.045, 0.05], [hw - 0.045, len - 0.045], [-hw + 0.045, len - 0.045]], 0.06));
				screen.push(onEdge(plate(/** @type {THREE.Shape} */ (roundPoly([[-hw + 0.04, 0.045], [hw - 0.04, 0.045], [hw - 0.04, len - 0.04], [-hw + 0.04, len - 0.04]], 0.06)), 0.006, 8), a, b, -0.006));
			}
			if (k === kFace) holes.push(roundHole([[-0.42, 0.16], [0.42, 0.16], [0.42, 0.33], [-0.42, 0.33]], 0.03));
			if (k === n - 1) {
				holes.push(roundHole([[-0.58, 0.08], [0.58, 0.08], [0.58, 0.42], [-0.58, 0.42]], 0.05));
				screen.push(onEdge(plate(/** @type {THREE.Shape} */ (roundPoly([[-0.585, 0.075], [0.585, 0.075], [0.585, 0.425], [-0.585, 0.425]], 0.05)), 0.005, 8), a, b, -0.005));
			}
			(k === kBonnet ? bonnet : ps).push(edgePanel(a, b, R0, t, W, holes));
		}
		part({ id: 'nose-roof-back', label: 'Nose, roof and back wall', assembly: 'body', source: SRC.air, what: 'The cab’s ends and top: the nose with the grille’s opening, the cowl under the windscreen, the windscreen’s frame, the roof, and the back wall with its window; every edge rounded onto the sides.', specs: [['Roof', 'Steel, 0.8 mm [inferred]']] }, [m(GEO.merge(ps), M.paint)], { explode: [0, 0.8, 0], xray: 'shell' });
		part({ id: 'bonnet', label: 'Bonnet', assembly: 'body', source: SRC.air, what: 'The steel bonnet over the engine, hinged at its back edge under the windscreen, a stay to hold it up; its rounded edges meet the wings.', specs: [['Steel', '0.7 mm outer skin, braced inside [inferred]']] }, [m(GEO.merge(bonnet), M.paint)], { explode: [0, 0.7, 0.4], xray: 'shell' });
		part({ id: 'windscreen', label: 'Windscreen and back window', assembly: 'body', source: SRC.air, what: 'The laminated windscreen raked back over the bonnet, and the toughened window in the cab’s back wall.', specs: [['Windscreen', '5 mm laminated'], ['Back', '4 mm toughened']] }, [m(GEO.merge(screen), M.glass)], { explode: [0, 0.5, 0.3] });
		// the floor with its tunnel, the firewall, the mat, the back wall's trim and the headlining
		const fx = X - t - 0.004;
		const fs = /** @type {THREE.Shape} */ (roundPoly(xz([[-fx, PU.cab.back + 0.04], [fx, PU.cab.back + 0.04], [fx, PU.cab.firewall], [-fx, PU.cab.firewall]]), 0.004));
		const floorG = GEO.merge([onY(plate(fs, 0.02, 4), floor - 0.01), at(box(0.34, 0.2, 1.7, 0.04), 0, floor + 0.08, 0.64)]);
		const mat = GEO.merge([onY(plate(fs, 0.004, 4), floor + 0.002), at(box(0.35, 0.205, 1.69, 0.045), 0, floor + 0.082, 0.64)]);
		const fwS = /** @type {THREE.Shape} */ (roundPoly([[-0.9, floor], [-0.21, floor], [-0.21, 0.98], [0.21, 0.98], [0.21, floor], [0.9, floor], [0.9, 1.2], [-0.9, 1.2]], 0.01));
		const fw = plate(fwS, t, 4).translate(0, 0, PU.cab.firewall + t / 2);
		const bell = at(box(0.44, 0.38, 0.32, 0.08), 0, floor + 0.15, PU.cab.firewall - 0.14);
		const lining = GEO.merge([at(box(1.7, 0.01, 1.66, 0.004), 0, PU.roof - 0.05, 0.28), at(slab(1.7, 0.66, 0.012), 0, floor + 0.36, PU.cab.back + 0.035)]);
		part({ id: 'floor', label: 'Floor, firewall and lining', assembly: 'body', source: SRC.air, what: 'The cab’s steel floor on the frame’s mounts, a tunnel down its middle over the gearbox and the propshaft, the firewall between the engine and the cab, a rubber mat over the floor; the headlining under the roof and the trim on the back wall.', specs: [['Height', `${Math.round(floor * 1000)} mm off the road`]] }, [m(GEO.merge([floorG, fw, bell]), M.paint), m(mat, M.floor), m(lining, M.lining)], { explode: [0, 0.25, 0] });
		// bumpers, plates, the step and hitch, lights, the grille, the wipers, the cab's rubber mounts
		const bumpF = GEO.merge([at(box(1.9, 0.2, 0.1, 0.03), 0, 0.55, PU.front + 0.06), at(box(0.12, 0.18, 0.2, 0.03), 0.9, 0.55, PU.front - 0.02), at(box(0.12, 0.18, 0.2, 0.03), -0.9, 0.55, PU.front - 0.02)]);
		const bumpR = GEO.merge([at(box(1.86, 0.14, 0.1, 0.03), 0, 0.55, PU.rear - 0.05), at(box(1.0, 0.03, 0.12, 0.01), 0, 0.63, PU.rear - 0.04)]);
		// the bumpers hang just under the cut's height: cut lengthwise only, or a sliver of them floats behind the bed
		const ends = { chrome: halfCut(M.chrome), plate: halfCut(M.plate) };
		const mounts = [];
		for (const sx of [-1, 1]) for (const z of [1.35, 0.42, -0.55]) mounts.push(at(box(0.08, 0.03, 0.06, 0.008), sx * 0.52, 0.595, z));
		part({ id: 'bumpers', label: 'Bumpers, plates and mounts', assembly: 'body', source: SRC.air, what: 'A steel bumper in front, a step bumper behind with the hitch’s receiver through it, both on brackets to the frame; the number plates (blank); the cab’s rubber mounts on the frame’s outriggers.', specs: [['Bumpers', 'Steel, 2 mm, chrome in front [inferred]']] }, [m(bumpF, ends.chrome), m(bumpR, ends.chrome), m(GEO.merge([at(slab(0.52, 0.11, 0.006), 0, 0.55, PU.front + 0.113), at(slab(0.52, 0.11, 0.006), 0, 0.75, PU.rear - 0.004)]), ends.plate), m(GEO.merge(mounts), M.rubber)], { explode: [0, -0.2, 0] });
		const lights = [], lenses = [], ambers = [];
		for (const sx of [-1, 1]) {
			lights.push(at(box(0.3, 0.15, 0.05, 0.015), sx * 0.66, 0.92, PU.front - 0.005));
			lenses.push(at(box(0.28, 0.13, 0.012, 0.006), sx * 0.66, 0.92, PU.front + 0.022));
			ambers.push(at(box(0.07, 0.13, 0.03, 0.008), sx * 0.86, 0.92, PU.front - 0.015), at(box(0.04, 0.03, 0.06, 0.008), sx * (X + 0.004), 0.95, 2.2));
		}
		const grille = [];
		for (let k = 0; k < 5; k++) grille.push(at(box(0.88, 0.02, 0.03, 0.006), 0, 0.8 + k * 0.04, PU.front + 0.01));
		grille.push(at(box(0.9, 0.2, 0.01, 0.004), 0, 0.875, PU.front - 0.035), at(box(0.06, 0.2, 0.03, 0.006), 0, 0.875, PU.front + 0.012));
		part({ id: 'lights', label: 'Headlights and grille', assembly: 'body', source: SRC.air, what: 'Two headlights with their indicators beside them in the nose, the grille between them that lets the air to the radiator, the side repeaters on the wings.', specs: [['Headlights', 'Halogen, 12 V 60/55 W [inferred]']] }, [m(GEO.merge(lights), M.reflector), m(GEO.merge(lenses), M.lens), m(GEO.merge(ambers), M.amber), m(GEO.merge(grille), M.trim)], { explode: [0, 0, 0.5] });
		const wip = [];
		for (const wx of [-0.38, 0.32]) wip.push(onEdge(GEO.merge([at(slab(0.012, 0.44, 0.012), 0, 0.27, 0.012), at(slab(0.02, 0.42, 0.02), 0.02, 0.27, 0.024)]).rotateZ(-0.15).translate(wx, 0, 0), ws0, ws1, 0));
		part({ id: 'wipers', label: 'Wipers', count: 2, assembly: 'body', source: SRC.air, what: 'Two wipers parked at the windscreen’s foot, driven by one motor under the cowl.', specs: [['Blades', '2 × 480 mm [inferred]']] }, [m(GEO.merge(wip), M.trim)], { explode: [0, 0.6, 0.3] });
	}

	/* ------------------------------------------------------------ the doors */
	/** @type {ReturnType<typeof hinge>[]} */
	const hinged = [];
	{
		const doorDefs = /** @type {const} */ ([
			['door-fl', 'Front door, left (the driver’s)', 1, fHole, fWin, hingeZ, true],
			['door-fr', 'Front door, right', -1, fHole, fWin, hingeZ, true],
			['door-rl', 'Rear door, left', 1, rHole, rWin, D.rear[1], false],
			['door-rr', 'Rear door, right', -1, rHole, rWin, D.rear[1], false]
		]);
		for (const [id, label, sx, hole, win, hz, isFront] of doorDefs) {
			const h = hinge(body, { at: [sx * X, 0, hz], axis: 'y', max: -sx * 1.22, name: id });
			const d = doorPanels([...hole], [...win], { x: X, sx, split: PU.waist });
			const mv = (/** @type {THREE.BufferGeometry} */ g) => g.translate(-sx * X, 0, -hz);
			const z0 = hole[0][0];
			const inner = GEO.merge([at(box(0.05, 0.04, 0.32, 0.01), sx * (X - 0.085), 1.0, (z0 + hz) / 2), at(box(0.02, 0.025, 0.08, 0.006), sx * (X - 0.072), 1.12, z0 + 0.16)]);
			/** @type {THREE.BufferGeometry[]} */
			const outside = [at(box(0.02, 0.03, 0.14, 0.008), sx * (X + 0.012), 1.13, z0 + 0.14)];
			/** @type {THREE.BufferGeometry[]} */
			const shiny = [];
			if (isFront) {
				outside.push(cyl([sx * X, 1.36, 1.32], [sx * (X + 0.12), 1.38, 1.31], 0.012, 8), at(box(0.06, 0.16, 0.13, 0.02), sx * (X + 0.15), 1.4, 1.31));
				shiny.push(at(slab(0.035, 0.14, 0.004), sx * (X + 0.15), 1.4, 1.31 - 0.066));
			}
			kit.part(h.pivot, { id, label, assembly: 'doors', source: SRC.air, what: `A hinged steel door, its window wound down into it by a handle inside, its card, armrest and handles${isFront ? ', its mirror on its front corner' : ''}. It swings out on two hinges at its front edge.`, moves: 'Opens to 70° on its hinges.', drive: 'By hand (the Doors slider)', specs: [['Opening', `${Math.round((hz - z0) * 1000)} × ${Math.round((D.y1 - D.y0) * 1000)} mm`], ['Skin', '0.8 mm steel, a beam inside [inferred]']] }, { explode: [sx * 0.55, 0.05, isFront ? 0.25 : -0.1] }, body);
			h.pivot.add(m(mv(d.skin), M.paint), m(mv(d.glass), M.glass), m(mv(d.card), M.card), m(mv(inner), M.vinyl), m(mv(GEO.merge(outside)), M.trim));
			if (shiny.length) h.pivot.add(m(mv(GEO.merge(shiny)), M.chrome));
			hinged.push(h);
		}
	}

	/* ------------------------------------------------------------ the cab inside: seats, dashboard, wheel */
	const gauges = cluster(kit, { dials: [{ x: -0.075, y: 0, r: 0.05, max: 180 }, { x: 0.075, y: 0, r: 0.05, max: 5000, ticks: 11 }], face: M.dial, tick: M.white, needle: M.needle, bezel: M.chrome, housing: M.dash });
	{
		const f = seatGeometry({ w: 0.52, d: 0.5, h: 0.3, back: 0.56, rake: 0.26 });
		const fronts = [-1, 1].map((sx) => [f.fabric.clone().translate(sx * PU.driver.x, floor, PU.driver.z), f.base.clone().translate(sx * PU.driver.x, floor, PU.driver.z)]);
		part({ id: 'front-seats', label: 'Front seats', count: 2, assembly: 'cab', source: SRC.air, what: 'The driver’s seat and the passenger’s, on runners to slide them, their backs raked, a headrest on each.', specs: [['Cover', 'Grey cloth']] }, [m(GEO.merge(fronts.map((p) => p[0])), M.fabric), m(GEO.merge(fronts.map((p) => p[1])), M.vinyl)], { explode: [0, 0.7, 0.1] });
		const b2 = seatGeometry({ w: 1.5, d: 0.48, h: 0.32, back: 0.52, rake: 0.2 });
		part({ id: 'rear-bench', label: 'Rear bench', assembly: 'cab', source: SRC.air, what: 'A bench for three across the back of the cab, upright against its back wall.', specs: [['Seats', '3']] }, [m(b2.fabric.translate(0, floor, -0.26), M.fabric), m(b2.base.translate(0, floor, -0.26), M.vinyl)], { explode: [0, 0.8, -0.1] });
		const dash = GEO.merge([at(box(1.74, 0.22, 0.3, 0.03, 2), 0, 1.08, 1.37), at(box(1.76, 0.05, 0.26, 0.02, 2), 0, 1.215, 1.38), at(box(0.38, 0.07, 0.14, 0.025), PU.driver.x, 1.215, 1.26)]);
		const faces = GEO.merge([at(slab(0.2, 0.12, 0.01), 0, 1.08, 1.215), at(slab(0.4, 0.14, 0.01), -PU.driver.x, 1.06, 1.215), ...[-0.72, -0.16, 0.16, 0.72].map((x) => at(slab(0.1, 0.04, 0.01), x, 1.15, 1.215))]);
		gauges.group.position.set(PU.driver.x, 1.13, 1.205);
		gauges.group.rotation.x = 0.12;
		part({ id: 'dashboard', label: 'Dashboard and gauges', assembly: 'cab', source: SRC.air, what: 'The moulded dashboard under the windscreen: the speedometer and the rev counter in their binnacle before the driver, the radio and the heater’s controls in the middle, four vents, the glovebox before the passenger.', moves: 'Its needles show the speed and the engine’s revs.', specs: [['Gauges', 'Speed to 180 km/h, revs to 5,000 rpm']] }, [m(dash, M.dash), m(faces, M.vinyl), gauges.group], { explode: [0, 0.5, 0.4], tag: { text: 'Gauges', at: [PU.driver.x, 1.25, 1.25], side: 'right', value: () => `${fmt(kmh())} km/h · ${fmt(sim.s.rpm)} rpm` } });
		const sw = steeringWheelGeometry({ R: 0.19, column: 0.5 });
		const wheel = new THREE.Group();
		wheel.add(m(sw.rim, M.vinyl), m(sw.hub, M.dash), m(sw.column, M.dash));
		wheel.position.set(...PU.wheel);
		wheel.rotation.x = 0.42;
		part({ id: 'steering-wheel', label: 'Steering wheel and column', assembly: 'cab', source: SRC.air, what: 'The wheel on its column through the dashboard to the firewall, where a shaft with two universal joints runs down past the engine to the rack.', moves: 'Turned by the driver (held straight here).', specs: [['Diameter', '380 mm']] }, [wheel], { explode: [0, 0.55, 0.1] });
		const ped = [];
		for (const [dx, w] of [[0.12, 0.06], [0.0, 0.08], [-0.12, 0.05]]) ped.push(cyl([PU.driver.x + dx, 1.0, 1.44], [PU.driver.x + dx, floor + 0.14, 1.36], 0.008, 8), at(box(w, 0.09, 0.012, 0.004), PU.driver.x + dx, floor + 0.12, 1.35));
		const consoleG = GEO.merge([at(box(0.26, 0.2, 0.6, 0.04), 0, floor + 0.28, 0.9), at(box(0.03, 0.04, 0.2, 0.01), 0.06, floor + 0.4, 0.68)]);
		part({ id: 'pedals-console', label: 'Pedals, console and handbrake', count: 3, assembly: 'cab', source: SRC.air, what: 'Clutch, brake and accelerator hanging from under the dashboard; the console over the tunnel between the front seats with the gear lever through it and the handbrake beside it, which pulls the rear drums’ shoes by cable.', specs: [['Brakes', 'Servo-assisted hydraulic, two circuits']] }, [m(GEO.merge(ped), M.vinyl), m(consoleG, M.dash)], { explode: [0, 0.4, 0.3] });
	}

	/* ------------------------------------------------------------ the bed and its tailgate */
	const gate = hinge(body, { at: [0, bed.floor - 0.01, PU.rear + 0.025], axis: 'x', max: -Math.PI / 2, name: 'tailgate' });
	/** the check cables: from the bed's posts to the tailgate's top corners, re-aimed as it opens */
	const cables = [-1, 1].map((sx) => {
		const c = new THREE.Group();
		c.add(m(unitBar(0.0035, 6), M.cable));
		return { c, post: new THREE.Vector3(sx * (bed.inner - 0.01), 1.18, PU.rear + 0.06), end: /** @type {V3} */ ([sx * (bed.inner - 0.04), 0.37, 0.0]) };
	});
	{
		const sideP = bedSide();
		const outer = [], inner = [];
		for (const sx of [-1, 1]) {
			outer.push(onX(plate(zyShape(sideP.pts, sideP.r), t, 6), sx * (X - t / 2)));
			// the inner wall from the floor up under the cap, and the cap along the top
			inner.push(onX(plate(zyShape([[PU.rear + 0.08, bed.floor], [bed.front - 0.04, bed.floor], [bed.front - 0.04, bed.top - 0.03], [PU.rear + 0.08, bed.top - 0.03]], 0.01), t, 4), sx * (bed.inner + t / 2)));
			outer.push(at(box(X - bed.inner + 0.01, 0.035, bed.front - PU.rear - 0.004, 0.012), sx * ((X + bed.inner) / 2), bed.top - 0.0175, (bed.front + PU.rear) / 2));
			// the back posts carrying the tail lights and the tailgate's latches
			outer.push(at(box(X - bed.inner, bed.top - bed.skirt - 0.02, 0.08, 0.01), sx * ((X + bed.inner) / 2), (bed.top + bed.skirt) / 2 - 0.01, PU.rear + 0.04));
		}
		// the front wall, outer and inner
		const fwS = /** @type {THREE.Shape} */ (roundPoly([[-X, bed.skirt], [X, bed.skirt], [X, bed.top], [-X, bed.top]], 0.03));
		outer.push(plate(fwS, t, 4).translate(0, 0, bed.front - t / 2));
		inner.push(plate(/** @type {THREE.Shape} */ (roundPoly([[-bed.inner, bed.floor], [bed.inner, bed.floor], [bed.inner, bed.top - 0.03], [-bed.inner, bed.top - 0.03]], 0.01)), t, 4).translate(0, 0, bed.front - 0.04 - t / 2));
		outer.push(at(box(W, 0.035, 0.05, 0.012), 0, bed.top - 0.0175, bed.front - 0.02));
		// the rear wheels' housings under the floor, the tubs over them inside the bed
		const ah = 0.48;
		const b0 = Math.PI - Math.asin((bed.skirt - yw) / ah), b1 = Math.asin((bed.skirt - yw) / ah);
		/** @type {THREE.BufferGeometry[]} */
		const houses = archStrip(ah, b0, b1, 0.6, X - t, axle.rear, yw);
		/** @type {V2[]} */
		const wall = [];
		for (let k = 0; k <= 16; k++) {
			const a = b0 + ((b1 - b0) * k) / 16;
			wall.push([axle.rear + (ah + 0.006) * Math.cos(a), yw + (ah + 0.006) * Math.sin(a)]);
		}
		for (const sx of [-1, 1]) houses.push(onX(plate(zyShape(wall, 0), 0.006, 4), sx * 0.6));
		const tubs = [-1, 1].map((sx) => at(box(bed.inner - bed.tub, 0.14, 1.0, 0.035), sx * (bed.inner + bed.tub) / 2, bed.floor + 0.07, axle.rear));
		part({ id: 'bed-sides', label: 'Bed sides and front wall', assembly: 'bed', source: SRC.air, what: 'The bed’s double walls: the painted outer skins with the rear wheels’ arches cut in, the inner walls the load rubs against, the caps along their tops, the front wall behind the cab, the back posts carrying the lights; the wheel housings under the floor and the tubs over them.', specs: [['Inside', `${Math.round((bed.front - 0.04 - PU.rear - 0.05) * 1000)} × ${Math.round(bed.inner * 2000)} mm, ${Math.round(bed.tub * 2000)} mm between the tubs`], ['Depth', `${Math.round((bed.top - bed.floor) * 1000)} mm`]] }, [m(GEO.merge(outer), M.paint), m(GEO.merge(inner), M.liner), m(GEO.merge([...houses, ...tubs]), M.liner)], { explode: [0, 0.6, -0.4], xray: 'shell' });
		// the floor: ribbed steel on four bearers across the rails, hooks to tie the load to
		const flS = /** @type {THREE.Shape} */ (roundPoly(xz([[-bed.inner, bed.front - 0.04], [bed.inner, bed.front - 0.04], [bed.inner, PU.rear + 0.05], [-bed.inner, PU.rear + 0.05]]), 0.004));
		/** @type {THREE.BufferGeometry[]} */
		const flG = [onY(plate(flS, 0.01, 4), bed.floor - 0.005)];
		for (const x of [-0.5, -0.32, -0.12, 0.12, 0.32, 0.5]) flG.push(at(box(0.05, 0.012, bed.front - PU.rear - 0.14, 0.004), x, bed.floor + 0.004, (bed.front + PU.rear) / 2 - 0.0));
		const bearers = [];
		for (const z of [-0.95, -1.75, -2.2, -2.5]) bearers.push(at(box(1.5, 0.12, 0.07, 0.01), 0, frameY(rails, z) + 0.07 + 0.06, z));
		const hooks = [];
		for (const sx of [-1, 1]) for (const z of [bed.front - 0.12, -1.0, -1.84, PU.rear + 0.16]) hooks.push(new THREE.TorusGeometry(0.022, 0.005, 6, 14).rotateY(Math.PI / 2).translate(sx * (bed.inner - 0.03), bed.floor + 0.03, z));
		part({ id: 'bed-floor', label: 'Bed floor', assembly: 'bed', source: SRC.air, what: 'The bed’s floor: a ribbed steel sheet on four bearers across the frame’s rails, coated against wear; eight hooks along its edges to tie the load down. What is put on the bed stands on it.', specs: [['Height', `${Math.round(bed.floor * 1000)} mm off the road`], ['Ribs', '6, 12 mm high']] }, [m(GEO.merge(flG), M.liner), m(GEO.merge(bearers), R.chassis), m(GEO.merge(hooks), M.cable)], { explode: [0, 0.3, -0.3], tag: cube ? undefined : { text: 'Bed', at: [0, bed.floor, -1.7], side: 'left', value: () => `${fmt(ctl.load.value)} kg in it` } });
		const tails = [], reds = [], wh = [];
		for (const sx of [-1, 1]) {
			tails.push(at(box(0.11, 0.42, 0.03, 0.01), sx * ((X + bed.inner) / 2), 1.0, PU.rear - 0.012));
			reds.push(at(box(0.1, 0.24, 0.02, 0.008), sx * ((X + bed.inner) / 2), 1.08, PU.rear - 0.025));
			wh.push(at(box(0.1, 0.07, 0.02, 0.008), sx * ((X + bed.inner) / 2), 0.88, PU.rear - 0.025));
		}
		part({ id: 'tail-lights', label: 'Tail lights', count: 2, assembly: 'bed', source: SRC.air, what: 'The tail, brake, indicator and reversing lights on the bed’s back posts.', specs: [['Bulbs', '12 V 21/5 W [inferred]']] }, [m(GEO.merge(tails), M.trim), m(GEO.merge(reds), M.red), m(GEO.merge(wh), M.lens)], { explode: [0, 0, -0.4] });
		// the tailgate, in its hinge's frame: the hinge line along its bottom edge, its outer skin facing back (−z)
		const gw = bed.inner - 0.006, gh = bed.top - bed.floor + 0.0;
		const skinS = /** @type {THREE.Shape} */ (roundPoly([[-gw, 0.012], [gw, 0.012], [gw, gh], [-gw, gh]], 0.015));
		const skin = GEO.merge([plate(skinS, 0.008, 6).translate(0, 0, -0.021), plate(skinS, 0.006, 6).translate(0, 0, 0.022), at(box(2 * gw, 0.03, 0.05, 0.01), 0, gh - 0.01, 0), at(box(0.03, gh - 0.02, 0.05, 0.008), gw - 0.015, gh / 2 + 0.006, 0), at(box(0.03, gh - 0.02, 0.05, 0.008), -gw + 0.015, gh / 2 + 0.006, 0)]);
		const gateBits = GEO.merge([at(box(0.22, 0.045, 0.02, 0.008), 0, gh - 0.08, -0.03), cyl([-gw, 0.012, 0], [-gw + 0.06, 0.012, 0], 0.008, 8), cyl([gw - 0.06, 0.012, 0], [gw, 0.012, 0], 0.008, 8)]);
		const sill = at(box(2 * bed.inner, 0.025, 0.05, 0.006), 0, bed.floor - 0.03, PU.rear + 0.025);
		kit.part(gate.pivot, { id: 'tailgate', label: 'Tailgate', assembly: 'bed', source: SRC.air, what: 'The bed’s back wall on two hinges along its bottom edge: unlatched by its handle it drops back to lie level with the floor, held there by two steel check cables, to load the bed or to carry something longer than it.', moves: 'Drops 90° on its hinges.', drive: 'By hand (the Tailgate slider)', specs: [['Size', `${Math.round(gw * 2000)} × ${Math.round(gh * 1000)} mm`], ['Holds', '~200 kg level [inferred]']] }, { explode: [0, -0.1, -0.6] }, body);
		gate.pivot.add(m(skin, M.paint), m(gateBits, M.trim), ...cables.map((c) => c.c));
		part({ id: 'gate-sill', label: 'Tailgate sill and hinges', assembly: 'bed', source: SRC.air, what: 'The sill along the bed’s back edge that the tailgate’s hinge pins turn in.', specs: [['Pins', 'Ø 16 mm [inferred]']] }, [m(sill, M.trim)], { explode: [0, -0.1, -0.5] });
	}

	/* ------------------------------------------------------------ the Power Cube on the bed */
	if (cube) {
		const pc = powerCube({ speed: 1800, load: 0 });
		const pa = /** @type {any} */ (pc.userData.asset);
		// it rides with its engine off: its own solver is held still, and its labels (its revs and pressures) stay off
		const own = pa.tick;
		pa.tick = (/** @type {number} */ _dt, /** @type {any} */ env) => own(0, { ...env, broken: false });
		pa.labels.length = 0;
		kit.carry(pc, { at: PU.cube, parent: body, prefix: 'cube-', ref: 'machines/powercube@3', explode: [0, 0.9, 0], step: steps.length });
		// over its top rails and its tank, which stand as high (in the bed's frame)
		const top = PU.cube[1] + CUBE.H + 0.012, hw = CUBE.W / 2 + 0.012;
		const straps = [];
		for (const dz of [-0.17, 0.17]) {
			const z = PU.cube[2] + dz;
			straps.push(hose([[bed.inner - 0.03, bed.floor + 0.03, z], [hw + 0.03, bed.floor + 0.25, z], [hw, top - 0.03, z], [hw - 0.04, top, z], [0, top + 0.004, z], [-hw + 0.04, top, z], [-hw, top - 0.03, z], [-hw - 0.03, bed.floor + 0.25, z], [-bed.inner + 0.03, bed.floor + 0.03, z]], 0.006, 6));
			straps.push(at(box(0.04, 0.09, 0.06, 0.01), hw + 0.035, bed.floor + 0.32, z));
		}
		part({ id: 'straps', label: 'Ratchet straps', count: 2, assembly: 'bed', source: SRC.cube, what: 'Two 25 mm ratchet straps over the Power Cube’s frame from the bed’s hooks: they hold its 181 kg down on the floor through braking, bends and bumps.', specs: [['Straps', '25 mm polyester, 800 kg lashing capacity [inferred]']] }, [m(GEO.merge(straps), M.strap)], { explode: [0, 1.2, 0], tag: { text: 'Power Cube', at: [hw, top, PU.cube[2]], side: 'right', value: () => `${CUBE_KG} kg, strapped down · engine off` } });
	}

	/* ------------------------------------------------------------ the solver and what it moves */
	const ctl = {
		speed: { label: 'Speed asked', min: 0, max: 140, value: speed, step: 1, unit: 'km/h', ends: /** @type {[string, string]} */ (['Standing', '140 km/h']) },
		grade: { label: 'Grade', min: -15, max: 35, value: grade, step: 0.5, unit: '%', ends: /** @type {[string, string]} */ (['Downhill', 'Steep climb']) },
		load: { label: cube ? 'Load besides the cube (people and cargo)' : 'Load (people and cargo)', min: 0, max: VEHICLE.payload - extra, value: Math.min(load, VEHICLE.payload - extra), step: 10, unit: 'kg', ends: /** @type {[string, string]} */ (['Empty', 'Full payload']) },
		doors: { label: 'Doors open', min: 0, max: 1, value: doors, step: 0.01, digits: 2, ends: /** @type {[string, string]} */ (['Shut', 'Open']) },
		tailgate: { label: 'Tailgate', min: 0, max: 1, value: tailgate, step: 0.01, digits: 2, ends: /** @type {[string, string]} */ (['Shut', 'Down']) }
	};
	/** what the driver is asked for: the sliders, or the break's overload up its hill @param {{ broken: boolean }} env */
	const input = (env) => ({ vSet: ctl.speed.value * KMH, grade: env.broken ? 0.35 : ctl.grade.value / 100, load: (env.broken ? VEHICLE.payload * 2.5 : ctl.load.value) + extra });
	sim.settle(input({ broken: false }));
	const qx = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), pv = new THREE.Vector3(), hingeAt = new THREE.Vector3(0, bed.floor - 0.01, PU.rear + 0.025);
	kit.onTick((dt, env) => {
		const inp = input(env);
		sim.step(dt, inp);
		const s = sim.s;
		// the body on its springs
		const al = (s.sagF - s.sagR) / VEHICLE.axles.wb;
		body.rotation.x = al;
		body.position.y = -s.sagF + al * axle.front;
		body.updateMatrix();
		for (const c of Object.values(corners)) c.set(s.wheelAng);
		for (const f of front) f.update();
		rearAxle.update(s.sagR, s.wheelAng, s.propAng);
		engine.update(s.engAng, s.propAng, s.launch);
		shaft.set([inFrame(body, engine.points.out), inFrame(body, BEARING), PINION], s.propAng);
		const k = clamp(ctl.doors.value);
		for (const d of hinged) d.set(k);
		gate.set(clamp(ctl.tailgate.value));
		// the check cables: each post's point brought into the tailgate's turned frame
		qx.setFromAxisAngle(ax, gate.max * gate.k).invert();
		for (const c of cables) {
			pv.copy(c.post).sub(hingeAt).applyQuaternion(qx);
			aim(c.c, [pv.x, pv.y, pv.z], c.end, true);
		}
		gauges.set([kmh(), s.rpm]);
		const r = lab.read;
		const lug = !s.stalled && s.theta > 0.97 && s.a < -0.05;
		r.value = Math.max(0, s.Pw) / 1000;
		r.bad = s.stalled || (lug && s.gear === 1) || s.bottomed;
		r.state = s.stalled
			? env.broken
				? `stalled: ${fmt(VEHICLE.payload * 2.5 + extra)} kg loaded, up a 35 % grade`
				: 'stalled: more than first gear can pull'
			: inp.vSet < 0.05 && s.v < 0.05
				? 'standing, idling in neutral'
				: s.launch
					? 'pulling away, the clutch slipping'
					: lug
						? `lugging in ${ordinal(s.gear)}: full throttle, the speed falling`
						: s.theta > 0.97
							? `full throttle in ${ordinal(s.gear)}`
							: s.Fb > 1
								? inp.grade < -0.005
									? `braking down the hill in ${ordinal(s.gear)}`
									: `braking to the speed asked in ${ordinal(s.gear)}`
								: s.theta < 0.01
									? `coasting on the engine in ${ordinal(s.gear)}`
									: s.v > inp.vSet + 0.5
										? `easing off to the speed asked in ${ordinal(s.gear)}`
										: `cruising in ${ordinal(s.gear)}`;
		r.sub = s.stalled
			? `first gear gives at most ${fmt(s.can)} N at the wheels, the hill and the road take ${fmt(s.need)} N · ${env.broken ? 'take the break back' : 'move a slider'} to start it again`
			: `${fmt(kmh())} km/h · ${fmt(s.rpm)} rpm · ${fmt(Math.max(0, s.Pe) / 1000, 1)} kW at the flywheel · the road takes ${fmt(s.road.F)} N (rolling ${fmt(s.road.roll)}, climbing ${fmt(s.road.climb)}, air ${fmt(s.road.air)}) · ${s.v > 0.5 ? `${fmt(s.l100, 1)} L/100 km` : `${fmt(s.fuel, 2)} L/h`}${s.bottomed ? ' · the springs on their bump stops' : ''}`;
	});
	/** @type {import('$lib/assets/parts.js').Lab} */
	const lab = {
		hero: { label: 'Power at the wheels', unit: 'kW', max: 80, digits: 1 },
		read: { value: 0, state: '', sub: '', bad: false },
		controls: ctl,
		how: {
			text: `A driver holds the speed asked: the road takes a force to roll the tyres, to lift the pickup up the grade and to push the air aside, and holding the speed takes that force times the speed at the wheels, more through the gearbox’s and the axle’s losses at the engine. The driver picks the highest gear that gives that push without the engine running too slow, opens the throttle for it, and brakes downhill when even the shut throttle pushes too much. Where first gear on the engine’s full-load curve gives less than the hill takes, the speed falls, the engine lugs down and stalls. The fuel comes from the engine’s work plus its own friction. The axles’ loads shift back up a hill and as it pulls, and the springs sink by the load over their rates; most of the load rides over the rear axle.${cube ? ' The Power Cube’s 181 kg is added to the load, its engine off while it rides.' : ''} The doors and the tailgate are moved by their sliders alone. Shown slowed: the wheels 10 times, the engine, the gearbox and the propshaft 40 times.`,
			eqs: [`F = m g Crr cos θ + m g sin θ + ½ ρ Cd A v²      m = 1,750 kg + load${cube ? ' + 181 kg' : ''}, Crr = 0.012, Cd A = 1.25 m²`, 'P_wheels = F v        P_engine = P_wheels / η      η = 0.90', 'n = (v / r) · i_gear · i_axle      r = 0.377 m, i = 4.31 … 0.84, i_axle = 4.10', 'T_engine ≤ T_full(n)      240 N·m at 2,000 rpm, 199 N·m at 3,600', 'm_eff dv/dt = T i η / r − F      m_eff = m + (4 J_w + J_e i² η) / r²', 'fuel = (T + T_friction) ω · 205 g/kWh      T_friction from 1.7 bar', 'sag = ΔF_axle / k      k = 45 kN/m front, 60 kN/m rear (a wheel)']
		},
		breakIt: {
			label: 'Overload it up a 35 % hill',
			run: () => {},
			reset: () => sim.restart()
		},
		cut: { a: [1, 0, 0], b: [0, 1, 0], center: [0, 0.5, 0], reach: 0.5 }
	};
	const asset = kit.seal({ lab });
	// at rest: every moving part where the solver's first moment puts it
	asset.tick(0, { broken: false, time: 0, slow: 0, cut: 0, xray: 0 });
	return root;
}
