/*
 * THE TRUCK, v2 — the tired land's highway truck (v1: $lib/models/furniture.ts `truck`, a cab and a box on eight
 * wheels) built again as a Machine at AirSup's realism ($lib/assets) round the heavy diesel of ./diesel6.js: a 4×2
 * cab-over tractor and a 13.6 m box semi-trailer, every part a mechanic would name as its own solid in its measured
 * material, the 13 L six and its 12-speed gearbox there to cut open, the cab that tilts forward over the engine, the
 * trailer's rear doors that swing round to its sides, and a solver that drives it on the road on real equations, the
 * turbocharger's air beside it and the five axles' loads from the two bodies' statics.
 *
 * ---------------------------------------------------------------- research (AirSup's step 1)
 * The machine: a European 4×2 tractor with a high sleeper cab over its engine and a dry box semi-trailer, as the
 * highways of the 2010s–2020s carry them [inferred era]; 16.4 m over the two, 2.55 m wide (2.95 m over the mirrors),
 * 4.0 m high, the most the EU allows (96/53/EC: 16.5 m, 2.55 m, 4 m; 40 t). The tractor: a ladder frame of two C rails
 * 270 × 90 × 7 mm, 850 mm apart outside; a 3.8 m wheelbase, 1.2 m front overhang; a forged I-beam front axle on
 * two-leaf parabolic springs, a single-reduction drive axle (2.53 : 1) on four air bellows; 315/70 R22.5 tyres, twin
 * at the back, on 9.00 × 22.5 steel wheels with ten studs on a 335 mm circle; 430 mm disc brakes worked by air at
 * every wheel; the cab 2.2 m long, 2.5 m wide, its flat floor 1.75 m up, 3.8 m to its roof and a deflector to 3.98 m,
 * tilting forward 60° on two hinges at its front; a 430 L aluminium fuel tank, 60 L of AdBlue, the box of the exhaust's
 * aftertreatment; the fifth wheel 1.15 m up, 0.65 m ahead of the drive axle. Its engine and gearbox: ./diesel6.js
 * (12.8 L, 338 kW, 2,300 N·m; 12 speeds, 14.96 … 1.00). The trailer: 13.6 m long, its floor at 1.30 m, inside 13.4 ×
 * 2.48 × 2.67 m; its kingpin (2", ISO 337) 1.6 m from its front; two I-beam main rails; three axles 1.31 m apart on
 * air, 385/65 R22.5 singles; two rear doors on four hinges each that open to 260°; two landing legs. Masses [inferred]:
 * the tractor 7,400 kg ready with its driver and full tanks, the trailer 7,000 kg; 25,600 kg payload makes 40 t.
 * The physics: the road's load F = m g Crr cos θ + m g sin θ + ½ ρ Cd A v² and the power at the wheels P = F v (the one
 * number), the engine on its full-load curve through the gear the driver (its gearbox's control unit) picks, the fuel
 * from its work and its friction, as for the pickup (./vehicle.js); the drive's grip, μ times the drive axle's load:
 * a 4×2 runs out of grip before its first gear runs out of torque; the two bodies' statics: the trailer on its kingpin
 * and its bogie, the tractor on its two axles with the kingpin's load and pull, the climb and the push moving load
 * back; the bellows' pressure p = F / (n A); the front springs' sag; the turbocharger's speed and boost from
 * ./diesel6.js `airOf`, fed with the engine's speed and fuel. The inputs: the speed asked, the grade, the load, the cab's
 * tilt, the cab's doors, the trailer's doors. The break: overloaded to 60 t up a 25 % ramp, the drive axle carries
 * ~17 t and its tyres grip ~120 kN, the ramp takes ~146 kN: the drive wheels spin and it stops, the engine idling.
 * Sources: Wong, "Theory of Ground Vehicles" (road load, grip, axle loads); Hucho, "Aerodynamics of Road Vehicles"
 * (tractor-trailer drag, Cd A ≈ 5.6 m²); Directive 96/53/EC (weights and dimensions); the ETRTO's tyre measures; ISO
 * 337 (the kingpin); air springs' effective area; Heywood and Watson & Janota for the engine (./diesel6.js). No maker is
 * named.
 *
 * In the asset's frame (./parts.js): metres, the ground at y 0, the front towards +z, +x its left (the driver's side:
 * it drives on the right, its wheel on the left).
 */
import * as THREE from 'three';
import { GEO, MAT, clamp, ease, fmt } from '$lib/assets/kit.js';
import { assetKit } from '$lib/assets/parts.js';
import { VD, airOf, dieselMaterials, dieselSix } from './diesel6.js';
import { G, aim, at, barrelGeometry, box, calliperGeometry, circle, cluster, coil, cyl, discGeometry, doorPanels, edgePanel, halfCut, hex, hinge, hose, inFrame, insetEdges, latheX, latheY, latheZ, leafPack, onEdge, onX, onY, ordinal, plate, propshaft, roundHole, roundPoly, seatGeometry, slab, spurGeometry, steeringWheelGeometry, tyreGeometry, tyreSize, unitBar, vehicleMaterials, vehicleSolver, xz, zyHole, zyShape } from './vehicle.js';

/** @typedef {[number, number, number]} V3 */
/** @typedef {[number, number]} V2 */
/** @typedef {ReturnType<typeof assetKit>} Kit */

const TYRE = tyreSize(315, 70, 22.5);
const TTYRE = tyreSize(385, 65, 22.5);
/** the wheels' middles off the road: each tyre sunk 15 mm under its load */
const YW = TYRE.r - 0.015, YT = TTYRE.r - 0.015;
/** the wheels' studs and their circle (m) */
const STUDS = 10, PCD = 0.335;

/** the truck's measures (m) */
export const TR = {
	W: 2.55,
	front: 8.24,
	/** the steer and the drive axle (z), the front wheels' and the twins' middles (x) */
	axle: { steer: 7.05, drive: 3.25, front: 1.04, twins: [0.745, 1.085] },
	/** the kingpin in the fifth wheel: where the trailer rests and pulls */
	king: { z: 3.9, y: 1.15 },
	/** the frame's C rails: their outer faces at ±x, their top and depth, their ends */
	frame: { x: 0.43, top: 1.0, h: 0.27, front: 7.95, rear: 2.45 },
	/** the crank's middle */
	engine: /** @type {V3} */ ([0, 0.95, 6.68]),
	/** the cab: its back, its face, its bottom over the wheels and its apron in front, its floor and roof, its half width; the hinge it tilts on (z, y) */
	cab: { back: 6.0, face: 8.2, bottom: 1.2, apron: 0.95, floor: 1.75, roof: 3.8, X: 1.25, hinge: /** @type {V2} */ ([7.98, 1.05]) },
	door: { z: /** @type {V2} */ ([6.25, 7.5]), y: /** @type {V2} */ ([1.25, 3.1]), split: 2.32 },
	driver: { x: 0.6, z: 6.95 },
	/** the trailer: its front wall and its back, its floor's top and its roof, its axles and their wheels' middles (x), its main rails (x) */
	trailer: { front: 5.5, rear: -8.1, floor: 1.3, roof: 4.0, axles: [-2.49, -3.8, -5.11], x: 1.02, beam: 0.55, legs: 1.45 }
};
/** how far the cab tilts, wide open (rad) */
const TILT = (60 * Math.PI) / 180;

const SOURCES = [
	{ label: 'Road load, grip and axle loads (Wong, Theory of Ground Vehicles)', url: 'https://en.wikipedia.org/wiki/Rolling_resistance' },
	{ label: 'Drag of tractor-trailers (Hucho, Aerodynamics of Road Vehicles)', url: 'https://en.wikipedia.org/wiki/Automobile_drag_coefficient' },
	{ label: 'Weights and dimensions of road vehicles (EU Directive 96/53/EC)', url: 'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:31996L0053' },
	{ label: 'Tyre markings (ETRTO)', url: 'https://en.wikipedia.org/wiki/Tire_code' },
	{ label: 'Fifth wheel and kingpin (ISO 337)', url: 'https://en.wikipedia.org/wiki/Fifth-wheel_coupling' },
	{ label: 'Air springs and air suspension', url: 'https://en.wikipedia.org/wiki/Air_suspension' },
	{ label: 'The engine and its turbocharger (Heywood; Watson & Janota)', url: 'https://en.wikipedia.org/wiki/Turbocharger' },
	{ label: 'Machine skill kit (AirSup, MIT)', url: 'https://github.com/AirsupHQ/machine-skill' }
];
const SRC = { road: SOURCES[0].label, air: SOURCES[1].label, eu: SOURCES[2].label, tyre: SOURCES[3].label, king: SOURCES[4].label, bags: SOURCES[5].label, eng: SOURCES[6].label };

const ASSEMBLIES = /** @type {import('$lib/actors/parts.js').Assembly[]} */ ([
	{ id: 'chassis', label: 'Frame and suspension', note: 'The ladder frame of two C rails; the forged front axle on its leaf springs and the steering; the drive axle on its four air bellows.', out: [0, -0.9, 0] },
	{ id: 'wheels', label: 'Wheels and brakes', note: 'Six 315/70 R22.5 tyres on ten-stud steel wheels, twins on the drive axle; a disc brake worked by air at every wheel.', out: [0.7, -0.2, 0] },
	{ id: 'engine', label: 'Engine', note: 'The 12.8 L six under the cab, 338 kW and 2,300 N·m, its turbocharger and its common rail.', out: [0, 0.7, 0.5] },
	{ id: 'drivetrain', label: 'Gearbox and drive', note: 'The clutch, the 12-speed automated gearbox, the propshaft and the drive axle’s gears.', out: [0, -0.6, -0.5] },
	{ id: 'services', label: 'Cooling, fuel, air and exhaust', note: 'The radiator and the charge air cooler in front of the engine, the fuel and AdBlue tanks, the batteries, the air tanks and filter, the exhaust’s aftertreatment.', out: [0, -0.4, 0.3] },
	{ id: 'cab', label: 'Cab', note: 'The steel cab over the engine on two hinges and two rear mounts: its sides, face, roof and deflector, the glass, the lights, the mirrors, the bumper and the steps.', out: [0, 1.3, 0.5] },
	{ id: 'doors', label: 'Cab doors', note: 'Two doors, each on two hinges at its front edge.', out: [0.9, 0.3, 0] },
	{ id: 'interior', label: 'Inside the cab', note: 'The dashboard and its gauges, the steering wheel, the pedals, two seats on air, the bunk behind them.', out: [0, 0.9, 0] },
	{ id: 'coupling', label: 'Fifth wheel and lines', note: 'The fifth wheel on its mounting plate, the trailer’s kingpin locked in it, the air and electric lines between the two.', out: [0, 0.9, 0] },
	{ id: 'trailer', label: 'Trailer chassis', note: 'The trailer’s kingpin plate, its two main rails and cross members, its floor, its landing legs and its guards.', out: [0, -0.7, -0.6] },
	{ id: 'running', label: 'Trailer axles', note: 'Three axles on air bellows and trailing arms, six 385/65 R22.5 tyres, a disc brake at each.', out: [0.6, -0.5, -0.6] },
	{ id: 'box', label: 'Trailer box', note: 'The box on the floor: its sandwich walls and roof, its front wall, its rear frame and two doors.', out: [0, 1.3, -0.6] }
]);
const STEPS = ['Rivet the frame; hang the front axle on its springs and the drive axle on its air', 'Bolt on the wheels and brakes', 'Drop in the engine on its mounts', 'Bolt on the gearbox and the propshaft', 'Fit the radiator, the tanks, the batteries, the air filter and the exhaust', 'Lower the cab onto its hinges and mounts; fit its glass, lights, mirrors, bumper and steps', 'Hang the cab’s doors', 'Fit the dashboard, the seats and the bunk', 'Bolt on the fifth wheel and couple the lines', 'Build the trailer’s chassis and floor', 'Hang the trailer’s axles and wheels', 'Build the box on the floor and hang its doors'];

// ---------------------------------------------------------------- the masses, and the loads on the axles

/** the gearbox (./diesel6.js): the splitter, the three-speed main box, the planetary range */
const RANGE = 4.583;
const HIGH = [2.55 * 1.28, 2.55, 1.6 * 1.28, 1.6, 1.28, 1];
export const GEARS = [...HIGH.map((g) => +(g * RANGE).toFixed(2)), ...HIGH.map((g) => +g.toFixed(2))];

/** where the masses are (kg; z, y in m) [inferred] */
export const MASS = {
	tractor: { m: 7400, z: 5.85, y: 1.05 },
	trailer: { m: 7000, z: -1.1, y: 1.25 },
	/** the payload's middle: spread on the floor along the box */
	load: { z: -1.3, y: 2.1 },
	/** what does not ride on the springs, by axle */
	unsprung: { steer: 900, drive: 1400, trailer: 750 }
};
/** the air bellows: their effective area (m², Ø 300 mm) and the supply's pressure (Pa) [inferred] */
const BAG = { A: Math.PI * 0.15 ** 2, supply: 8.5e5 };
/** the front springs' rate, each side (N/m), and their bump stops' travel from the kerb's ride height (m) [inferred] */
const KF = 3.0e5, TRAVEL_F = 0.07;
/** the drive tyres' grip on dry asphalt [inferred] */
const MU = 0.75;

/**
 * The loads on the axles (N): the trailer on its kingpin and its bogie, the tractor on its two axles with the
 * kingpin's load and its pull; climbing and pulling move load back off the kingpin and off the steer axle.
 * @param {number} load the payload (kg) @param {number} a the acceleration (m/s²) @param {number} th the grade's angle (rad)
 */
export function axleLoads(load, a, th) {
	const { king, axle, trailer: T } = TR;
	const zb = T.axles[1];
	const mt = MASS.trailer.m + load;
	const zt = (MASS.trailer.m * MASS.trailer.z + load * MASS.load.z) / mt;
	const ht = (MASS.trailer.m * MASS.trailer.y + load * MASS.load.y) / mt;
	const c = Math.cos(th), push = a + G * Math.sin(th);
	const pull = mt * push;
	const kingN = (mt * G * c * (zt - zb) - pull * (ht - king.y)) / (king.z - zb);
	const bogie = mt * G * c - kingN;
	const { m: mc, z: zc, y: hc } = MASS.tractor;
	const steer = (mc * G * c * (zc - axle.drive) + kingN * (king.z - axle.drive) - pull * king.y - mc * push * hc) / (axle.steer - axle.drive);
	const drive = mc * G * c + kingN - steer;
	return { steer, drive, bogie, king: kingN, pull };
}
/** the loads with the trailer empty, standing: the ride height the springs are set at */
const KERB = axleLoads(0, 0, 0);
/** the bellows' pressure (Pa, over the air's) under an axle load @param {number} N @param {number} unsprung @param {number} n */
const bagP = (N, unsprung, n) => Math.max(0, (N - unsprung * G) / (n * BAG.A));

/** the tractor and its trailer as the solver runs them [inferred where marked in the research] */
export const VEHICLE = /** @type {import('./vehicle.js').Vehicle} */ ({
	kerb: MASS.tractor.m + MASS.trailer.m,
	payload: 25600,
	Crr: 0.0055,
	CdA: 5.6,
	r: TYRE.r * 0.965,
	eta: 0.92,
	gears: GEARS,
	final: 2.53,
	engine: { rpm: [500, 600, 800, 1000, 1400, 1600, 1800, 1900, 2000, 2100, 2200], nm: [900, 1150, 1700, 2300, 2300, 2015, 1790, 1700, 1560, 1000, 0], idle: 600, stall: 450, max: 2100, up: 1800, down: 1000, launch: 900, Vd: VD, fmep: 1.3e5, bsfc: 172, fuel: 'diesel', J: 3.5 },
	Jw: 16,
	wheels: 12,
	axles: { wb: TR.axle.steer - TR.axle.drive, h: 1.6, front: 0.37, loadFront: 0.07, k: [KF, 1e9], travel: [TRAVEL_F, 0.1] },
	grip: (/** @type {any} */ s, /** @type {{ load: number, grade: number }} */ inp) => MU * axleLoads(inp.load, s.a, Math.atan(inp.grade)).drive
});
const KMH = 1 / 3.6;
/** tonnes, to one place @param {number} N */
const tonnes = (N) => fmt(N / G / 1000, 1);

/** the truck's paint and trim, the cab's and the box's colours as a world gives them */
function materials(/** @type {string} */ cab, /** @type {string} */ boxColour) {
	return {
		paint: MAT.paint({ color: cab, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
		box: MAT.paint({ color: boxColour, roughness: 0.48, clearcoat: 0.2, clearcoatRoughness: 0.5 }),
		trim: MAT.satin({ color: [0.035, 0.035, 0.038], roughness: 0.6 }),
		grey: MAT.plastic({ color: [0.12, 0.125, 0.13], roughness: 0.55 }),
		rubber: MAT.rubber({ color: [0.02, 0.02, 0.022], roughness: 0.7 }),
		chrome: MAT.chrome({ roughness: 0.12 }),
		glass: MAT.glass({ color: [0.84, 0.92, 0.94], roughness: 0.04 }),
		mirror: MAT.chrome({ roughness: 0.02 }),
		lens: MAT.glass({ color: [0.95, 0.95, 0.92], roughness: 0.08, thickness: 0.01 }),
		red: MAT.plastic({ color: [0.45, 0.02, 0.015], roughness: 0.25, transmission: 0.4, thickness: 0.01 }),
		amber: MAT.plastic({ color: [0.8, 0.32, 0.02], roughness: 0.25, transmission: 0.4, thickness: 0.01 }),
		reflector: MAT.chrome({ roughness: 0.2 }),
		plate: MAT.paint({ color: [0.85, 0.85, 0.82], roughness: 0.4 }),
		floor: MAT.rubber({ color: [0.04, 0.04, 0.043], roughness: 0.85 }),
		fabric: MAT.satin({ color: [0.16, 0.17, 0.19], roughness: 0.95, finish: 'cast' }),
		vinyl: MAT.plastic({ color: [0.035, 0.035, 0.038], roughness: 0.62 }),
		dash: MAT.plastic({ color: [0.06, 0.06, 0.065], roughness: 0.7 }),
		card: MAT.plastic({ color: [0.22, 0.22, 0.23], roughness: 0.85 }),
		lining: MAT.satin({ color: [0.5, 0.49, 0.46], roughness: 0.95, finish: 'cast' }),
		dial: MAT.satin({ color: [0.015, 0.015, 0.018], roughness: 0.4 }),
		white: MAT.plastic({ color: [0.85, 0.85, 0.82], roughness: 0.4 }),
		needle: MAT.plastic({ color: [0.85, 0.22, 0.02], roughness: 0.3 }),
		mattress: MAT.satin({ color: [0.24, 0.27, 0.32], roughness: 0.95, finish: 'cast' }),
		tank: MAT.aluminium({ color: [0.82, 0.83, 0.84], roughness: 0.2, finish: 'brushed' }),
		tread: MAT.aluminium({ color: [0.7, 0.71, 0.72], roughness: 0.45 }),
		adblue: MAT.plastic({ color: [0.06, 0.06, 0.065], roughness: 0.5 }),
		blueCap: MAT.plastic({ color: [0.04, 0.2, 0.7], roughness: 0.35 }),
		battery: MAT.plastic({ color: [0.02, 0.02, 0.022], roughness: 0.5 }),
		lead: MAT.steel({ color: [0.42, 0.42, 0.44], roughness: 0.5, finish: 'cast' }),
		core: MAT.aluminium({ color: [0.55, 0.56, 0.57], roughness: 0.6 }),
		stainless: MAT.stainless({ roughness: 0.3, finish: 'brushed' }),
		filterBox: MAT.plastic({ color: [0.03, 0.03, 0.035], roughness: 0.55 }),
		airTank: MAT.paint({ color: [0.05, 0.05, 0.055], roughness: 0.5 }),
		wood: MAT.satin({ color: [0.28, 0.17, 0.09], roughness: 0.8, finish: 'cast' }),
		alu: MAT.aluminium({ color: [0.74, 0.75, 0.76], roughness: 0.35 }),
		lineRed: MAT.plastic({ color: [0.6, 0.04, 0.02], roughness: 0.4 }),
		lineYellow: MAT.plastic({ color: [0.85, 0.6, 0.02], roughness: 0.4 }),
		lineBlack: MAT.plastic({ color: [0.03, 0.03, 0.033], roughness: 0.4 }),
		hydraulic: MAT.chrome({ roughness: 0.08 })
	};
}

// ---------------------------------------------------------------- small geometry

/** a box from one point to another, w × d across it @param {V3} a @param {V3} b @param {number} w @param {number} d @param {number} [r] */
function link(a, b, w, d, r = 0.004) {
	const A = new THREE.Vector3(...a), dir = new THREE.Vector3(...b).sub(A), L = dir.length();
	const g = box(w, L, d, r).translate(0, L / 2, 0);
	g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
	return g.translate(A.x, A.y, A.z);
}
/** a coiled line from one point to another @param {V3} a @param {V3} b @param {number} R @param {number} wire @param {number} turns */
function coilFrom(a, b, R, wire, turns) {
	const A = new THREE.Vector3(...a), dir = new THREE.Vector3(...b).sub(A), L = dir.length();
	const g = coil(R, wire, turns, L, turns * 18, 6);
	g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
	return g.translate(A.x, A.y, A.z);
}
/**
 * A rolling-lobe air spring standing at (x, z) from its piston's foot at y0 to its top plate at y1, r round: the steel
 * piston, the rubber bellows rolling over it, the bead plate bolted under the frame.
 * @param {number} x @param {number} y0 @param {number} y1 @param {number} z @param {number} r
 */
function airSpring(x, y0, y1, z, r) {
	const h = y1 - y0;
	const piston = latheY([[0, y0], [r * 0.6, y0], [r * 0.64, y0 + h * 0.5], [0, y0 + h * 0.5]], 32);
	const bellows = latheY([[0, y0 + h * 0.36], [r * 0.64, y0 + h * 0.36], [r * 0.9, y0 + h * 0.5], [r, y0 + h * 0.68], [r * 0.97, y0 + h * 0.88], [r * 0.9, y1 - 0.014], [0, y1 - 0.014]], 36);
	const top = latheY([[0, y1 - 0.014], [r * 0.93, y1 - 0.014], [r * 0.93, y1], [0, y1]], 32);
	return { rubber: bellows.translate(x, 0, z), steel: GEO.merge([piston, top]).translate(x, 0, z) };
}
/**
 * A 22.5" steel truck wheel in its own frame (the axle along x, the rim's middle at x 0): the barrel with its flanges
 * and its well, the flat disc at x = et (its outer face) with the ten stud holes and the centre bore, the cone that
 * joins the disc to the well.
 * @param {{ size: ReturnType<typeof tyreSize>, rimW: number, et: number }} o
 */
function rimGeometry({ size, rimW, et }) {
	const barrel = barrelGeometry({ rim: size.rim, rimW, t: 0.006, seg: 48 });
	const s = new THREE.Shape();
	s.absarc(0, 0, 0.212, 0, Math.PI * 2, false);
	s.holes.push(circle(0, 0, 0.1405));
	for (let k = 0; k < STUDS; k++) {
		const a = (k / STUDS) * Math.PI * 2;
		s.holes.push(circle((PCD / 2) * Math.cos(a), (PCD / 2) * Math.sin(a), 0.0135));
	}
	const disc = onX(plate(s, 0.014, 40), et - 0.007);
	const well = size.rim - 0.028;
	const cone = latheX([[0.205, et - 0.012], [well + 0.005, 0.062], [well + 0.005, 0.046], [0.205, et - 0.024]], 48);
	return GEO.merge([barrel, disc, cone]);
}
/** where stud k stands round the axle (y, z), as the disc's holes are drawn @param {number} k */
const studAt = (k) => {
	const a = (k / STUDS) * Math.PI * 2;
	return /** @type {V2} */ ([(PCD / 2) * Math.sin(a), -(PCD / 2) * Math.cos(a)]);
};

/**
 * One wheel station: in a frame at the hub's face (`at`, mirrored to look out to `side`), the wheel or the twins
 * (`wheel-<id>`: tyres, rims, studs and nuts, the hub and its cap, the brake disc, all turning) and what holds still
 * (`brake-<id>`: the calliper on its bracket and the air chamber that works it).
 * @param {Kit} kit
 * @param {{ id: string, label: string, at: V3, side: 1 | -1, size: ReturnType<typeof tyreSize>, rimW: number, et: number, twin?: boolean, spring?: boolean, angle: number, parent: THREE.Object3D, assembly: string, drive?: string, tag?: import('$lib/assets/parts.js').How['tag'], M: ReturnType<typeof materials>, R: ReturnType<typeof vehicleMaterials> }} o
 */
function station(kit, o) {
	const { M, R } = o;
	const m = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ mat) => kit.mesh(g, mat);
	const st = new THREE.Group();
	st.name = `station-${o.id}`;
	st.position.set(...o.at);
	st.scale.x = o.side; // its own mirror (a child of the asset, never its root)
	o.parent.add(st);
	const turn = new THREE.Group();
	const tyre = tyreGeometry({ size: o.size, rimW: o.rimW, pattern: 'highway', pitches: 34 });
	const rim = rimGeometry({ size: o.size, rimW: o.rimW, et: o.et });
	turn.add(m(tyre.clone().translate(-o.et, 0, 0), R.tyre), m(rim.clone().translate(-o.et, 0, 0), R.rimSteel));
	if (o.twin) {
		const outer = new THREE.Group();
		outer.scale.x = -1;
		outer.position.x = o.et + 0.014;
		outer.add(m(tyre, R.tyre), m(rim, R.rimSteel));
		turn.add(outer);
	}
	const face = o.twin ? 0.028 : 0.014;
	const ks = Array.from({ length: STUDS }, (_, k) => k);
	const nuts = GEO.merge(ks.map((k) => hex([face, studAt(k)[0], studAt(k)[1]], [1, 0, 0], 0.0185, 0.026)));
	const studs = GEO.merge(ks.map((k) => cyl([-0.04, studAt(k)[0], studAt(k)[1]], [face + 0.034, studAt(k)[0], studAt(k)[1]], 0.011, 8)));
	const hub = latheX([[0.07, -0.26], [0.115, -0.26], [0.125, -0.06], [0.205, -0.055], [0.205, -0.014], [0.07, -0.014]], 40);
	const cap = o.twin ? GEO.merge([latheX([[0, face], [0.1, face], [0.1, face + 0.014], [0.06, face + 0.03], [0, face + 0.03]], 32), ...Array.from({ length: 8 }, (_, k) => hex([face + 0.014, 0.08 * Math.sin((k * Math.PI) / 4), 0.08 * Math.cos((k * Math.PI) / 4)], [1, 0, 0], 0.009, 0.012))]) : latheX([[0, face], [0.1, face], [0.098, face + 0.03], [0.07, face + 0.065], [0, face + 0.072]], 32);
	const d = discGeometry({ r: 0.215, rIn: 0.13, t: 0.045, hat: 0.15 });
	const hat = latheX([[0.118, -0.055], [0.136, -0.055], [0.136, -0.182], [0.118, -0.182]], 40);
	turn.add(m(GEO.merge([nuts]), M.chrome), m(studs, R.zinc), m(hub, R.forged), m(cap, o.twin ? R.forged : M.chrome), m(d.rings.translate(-0.055, 0, 0), R.disc), m(hat, R.castIron));
	const rimIn = Math.round((o.size.rim * 2) / 0.0254 * 10) / 10;
	kit.part(
		turn,
		{
			id: `wheel-${o.id}`,
			label: `${o.twin ? 'Twin wheels' : 'Wheel'}, ${o.label}`,
			assembly: o.assembly,
			source: SRC.tyre,
			count: o.twin ? 2 : 1,
			what: `${o.twin ? 'Two' : 'A'} ${o.size.code} tubeless tyre${o.twin ? 's' : ''} on ${o.twin ? '' : 'a '}${(o.rimW / 0.0254).toFixed(2)} × ${rimIn}" steel wheel${o.twin ? 's, their discs back to back on the hub' : ''}, held by ten M22 nuts on studs pressed into the hub; the hub turns on two taper bearings on the ${o.drive ? 'axle’s end, the half-shaft bolted to its cap' : 'spindle'}, and the brake disc is bolted to its back.`,
			moves: 'Rolls with the road (shown turning 10 times slower).',
			drive: o.drive ?? 'The road; its brake stops it',
			specs: [['Tyre', o.size.code], ['Outer diameter', `${Math.round(o.size.r * 2000)} mm`], ['Wheel', `${(o.rimW / 0.0254).toFixed(2)} × ${rimIn}", ${STUDS} studs on ${Math.round(PCD * 1000)} mm, ${Math.round(o.et * 1000)} mm inset`], ['Disc', 'Ø 430 × 45 mm, vented']]
		},
		{ explode: [0.55, 0, 0], tag: o.tag },
		st
	);
	// the calliper over the disc's back edge, its bracket to the axle, the chamber pushing its lever
	const xd = -0.055 - 0.15, ca = o.angle, rc = 0.215 + 0.03;
	const cal = calliperGeometry({ r: 0.215, t: 0.045, angle: ca, span: 0.5 }).translate(xd, 0, 0);
	const cy = rc * Math.sin(ca), cz = rc * Math.cos(ca);
	const bracket = GEO.merge([link([xd - 0.04, cy * 0.7, cz * 0.7], [xd - 0.04, 0, 0], 0.03, 0.12), link([xd - 0.05, cy, cz], [xd - 0.2, cy, cz], 0.06, 0.05)]);
	const L = o.spring ? 0.3 : 0.18;
	const chamber = GEO.merge([cyl([xd - 0.2, cy, cz], [xd - 0.2 - L, cy, cz], 0.085, 24), latheX([[0.03, xd - 0.2 - L], [0.088, xd - 0.2 - L], [0.088, xd - 0.214 - L], [0.03, xd - 0.214 - L]], 24).translate(0, cy, cz)]);
	const airLine = hose([[xd - 0.2 - L * 0.6, cy + 0.085, cz], [xd - 0.3 - L * 0.6, cy + 0.16, cz - 0.05], [xd - 0.45 - L * 0.6, cy + 0.2, cz - 0.08]], 0.008, 8);
	kit.part(
		new THREE.Group().add(m(cal, R.calliper), m(bracket, R.forged), m(chamber, M.airTank), m(airLine, M.rubber)),
		{ id: `brake-${o.id}`, label: `Disc brake, ${o.label}`, assembly: o.assembly, source: SRC.road, what: `A sliding calliper over the disc’s back edge, worked by air: the ${o.spring ? 'spring brake chamber (a service diaphragm in front, a strong spring behind that the air holds back: let the air out and the spring brakes, so a broken line stops the truck)' : 'chamber'}’s pushrod turns a lever in the calliper that presses the pads on the disc from both sides.`, specs: [['Pads', 'Two, ~ 0.16 m² together [inferred]'], ['Chamber', o.spring ? 'Type 24/24, spring brake' : 'Type 22'], ['Air', '8.5 bar at most']] },
		{ explode: [0.3, 0.18, 0] },
		st
	);
	return {
		st,
		turn,
		/** roll it to `a` (rad, forward positive) @param {number} a */
		set(a) {
			turn.rotation.x = a;
		}
	};
}

// ---------------------------------------------------------------- the truck

/**
 * The truck: a root at its real size, every part its own, its solver driving it.
 * @param {{ cab?: string, box?: string, speed?: number, grade?: number, load?: number, tilt?: number, doors?: number, rear?: number }} [o]
 *   the cab's and the box's colours (hex), the speed asked (km/h), the grade (%), the payload (kg), how far the cab is
 *   tilted, its doors and the trailer's rear doors are open (0 … 1)
 * @returns {THREE.Group}
 */
export function truck({ cab: cabColour = '#a33a2a', box: boxColour = '#e0ddd6', speed = 80, grade = 0, load = 16000, tilt = 0, doors = 0, rear = 0 } = {}) {
	const root = new THREE.Group();
	root.name = 'Truck';
	const M = materials(cabColour, boxColour), R = vehicleMaterials(), D = dieselMaterials();
	const kit = assetKit(root, { assemblies: ASSEMBLIES, steps: STEPS, sources: SOURCES });
	const m = (/** @type {THREE.BufferGeometry} */ geo, /** @type {THREE.Material} */ mat) => kit.mesh(geo, mat);
	/** the tractor's sprung body: the frame and all it carries, pitching on the front springs */
	const body = new THREE.Group();
	body.name = 'sprung';
	root.add(body);
	/** the trailer, on the fifth wheel and its bogie's bellows */
	const trailer = new THREE.Group();
	trailer.name = 'trailer';
	root.add(trailer);
	/** a part: its meshes, its card and how it is shown (in the tractor's body unless said) */
	const part = (/** @type {any} */ info, /** @type {THREE.Object3D[]} */ objs, /** @type {import('$lib/assets/parts.js').How} */ how = {}, parent = /** @type {THREE.Object3D} */ (body)) => {
		const grp = new THREE.Group();
		grp.add(...objs);
		return kit.part(grp, info, how, parent);
	};
	const { axle, frame: F, cab: C, door: DR, trailer: T } = TR;
	const sim = vehicleSolver(VEHICLE);
	const air = airOf();
	const kmh = () => sim.s.v * 3.6;
	/** the loads as the solver last left them */
	let L = KERB;

	/* ------------------------------------------------------------ the frame */
	{
		const g = [];
		for (const sx of [-1, 1]) {
			// a C rail, its web outside, its flanges reaching in
			const x0 = sx * F.x, x1 = sx * (F.x - 0.007), xi = sx * (F.x - 0.09), b = F.top - F.h;
			const s = new THREE.Shape();
			s.moveTo(x0, b);
			s.lineTo(x0, F.top);
			s.lineTo(xi, F.top);
			s.lineTo(xi, F.top - 0.007);
			s.lineTo(x1, F.top - 0.007);
			s.lineTo(x1, b + 0.007);
			s.lineTo(xi, b + 0.007);
			s.lineTo(xi, b);
			s.closePath();
			g.push(plate(s, F.front - F.rear, 2).translate(0, 0, (F.front + F.rear) / 2));
			// the front springs' hangers and shackle brackets, the drive axle's arm hangers, the dampers' brackets
			const xs = sx * 0.385;
			g.push(at(box(0.1, 0.07, 0.09, 0.008), xs, b - 0.03, axle.steer + 0.8), at(box(0.1, 0.07, 0.07, 0.008), xs, b - 0.03, axle.steer - 0.8));
			g.push(at(box(0.11, 0.14, 0.14, 0.01), xs, b - 0.06, 4.15));
			g.push(at(box(0.05, 0.1, 0.08, 0.008), sx * (F.x + 0.025), F.top - 0.07, axle.steer + 0.2), at(box(0.05, 0.1, 0.08, 0.008), sx * (F.x + 0.025), F.top - 0.08, 3.5));
			// the engine's four mounting brackets off the webs (the rubbers at ±0.26 and ±0.36, ./diesel6.js)
			g.push(at(box(0.2, 0.016, 0.15, 0.004), sx * 0.325, 0.837, 7.039), at(box(0.012, 0.09, 0.15, 0.004), sx * 0.419, 0.875, 7.039));
			g.push(at(box(0.1, 0.016, 0.13, 0.004), sx * 0.375, 0.827, 6.041), at(box(0.012, 0.09, 0.13, 0.004), sx * 0.419, 0.865, 6.041));
			// the outriggers for the steps, the tanks and the cab's rear mounts
			for (const z of [6.25, 5.05, 4.1]) g.push(at(box(0.16, 0.05, 0.08, 0.008), sx * (F.x + 0.08), 0.86, z));
			g.push(at(box(0.08, 0.2, 0.1, 0.008), sx * 0.6, 1.0, 6.12), at(box(0.2, 0.03, 0.1, 0.006), sx * 0.52, F.top + 0.015, 6.12));
		}
		// the cross members: the front one (the bumper's), the top-hat ones over the propshaft, the back one
		g.push(at(box(0.846, 0.22, 0.01, 0.004), 0, F.top - 0.135, F.front - 0.03), at(box(0.846, 0.07, 0.12, 0.006), 0, F.top - 0.035, 4.6), at(box(0.846, 0.12, 0.1, 0.006), 0, 0.84, 3.9), at(box(0.846, 0.24, 0.01, 0.004), 0, F.top - 0.135, F.rear + 0.03));
		part({ id: 'frame', label: 'Ladder frame', assembly: 'chassis', source: SRC.road, what: 'Two pressed-steel C rails the length of the tractor, 850 mm apart outside, their webs out and their flanges in, joined by cross members riveted to them: a plate at the front for the bumper, top-hat sections over the propshaft, a deep one at the back. The springs’ hangers, the engine’s brackets, the outriggers for the steps and the tanks are riveted to the webs.', specs: [['Rails', '270 × 90 × 7 mm, high-tensile steel [inferred]'], ['Length', `${(F.front - F.rear).toFixed(2)} m`]] }, [m(GEO.merge(g), R.chassis)], { explode: [0, -0.8, 0] });
	}

	/* ------------------------------------------------------------ the front axle and the steering */
	const springs = /** @type {ReturnType<typeof leafPack>[]} */ ([]);
	const CAMBER = 0.035;
	{
		const zs = axle.steer;
		// the I-beam's side outline (x, y): up from the kingpins to the spring pads, dropped in the middle under the sump
		const top = [[-0.82, 0.57], [-0.56, 0.625], [-0.29, 0.625], [-0.19, 0.48], [0.19, 0.48], [0.29, 0.625], [0.56, 0.625], [0.82, 0.57]];
		const bot = [[0.82, 0.455], [0.55, 0.505], [0.3, 0.505], [0.21, 0.37], [-0.21, 0.37], [-0.3, 0.505], [-0.55, 0.505], [-0.82, 0.455]];
		const beamS = /** @type {THREE.Shape} */ (roundPoly(/** @type {V2[]} */ ([...top, ...bot]), 0.02));
		const g = [plate(beamS, 0.09, 6).translate(0, 0, zs)];
		const bosses = [], arms = [];
		for (const sx of [-1, 1]) {
			const xk = sx * 0.86;
			bosses.push(cyl([xk, 0.4, zs], [xk, 0.62, zs], 0.055, 24), cyl([xk, 0.38, zs], [xk, 0.64, zs], 0.022, 12), cyl([xk, YW, zs], [sx * 0.95, YW, zs], 0.06, 24), latheX([[0.03, 0.0], [0.085, 0.0], [0.085, 0.05], [0.03, 0.05]], 24).translate(sx * 0.86 - (sx > 0 ? 0 : 0.05), YW, zs));
			// the tie rod's arms back to the rod, behind the axle
			arms.push(link([xk, 0.47, zs - 0.03], [sx * 0.74, 0.47, zs - 0.23], 0.04, 0.03));
		}
		// the steering arm up and forward from the left knuckle, the drag link to the steering box's drop arm
		arms.push(link([0.86, 0.62, zs + 0.02], [0.84, 0.66, zs + 0.2], 0.04, 0.035), cyl([-0.74, 0.47, zs - 0.23], [0.74, 0.47, zs - 0.23], 0.025, 14), cyl([0.84, 0.66, zs + 0.2], [0.64, 0.62, 7.45], 0.022, 12));
		part({ id: 'front-axle', label: 'Front axle and steering linkage', assembly: 'chassis', source: SRC.road, what: 'A forged steel I-beam across under the engine, dropped in its middle to clear the sump: a kingpin through each end carries a knuckle with its spindle, and the knuckles are tied by the tie rod behind the axle so they steer together; the drag link pulls the left one’s steering arm from the steering box.', moves: 'Rides up and down with the road on its springs; its knuckles steer (held straight here).', drive: 'The steering box, through the drag link', specs: [['Rated', '7.1 t [inferred]'], ['Track', `${Math.round(axle.front * 2000)} mm`]] }, [m(GEO.merge(g), R.forged), m(GEO.merge(bosses), R.castIron), m(GEO.merge(arms), R.forged)], { explode: [0, -0.5, 0.3], tag: { text: 'Steer axle', at: [0.6, 0.6, zs], side: 'right', value: () => `${tonnes(L.steer)} t on it (7.1 t allowed) · sunk ${fmt(sag.f * 1000)} mm` } }, root);
		// the leaf springs, their eyes and U-bolts, the shackles; the dampers
		const leaves = [], eyes = [], steel = [];
		for (const sx of [-1, 1]) {
			const lp = leafPack({ L: 1.6, w: 0.09, t: 0.022, n: 2, camber: CAMBER });
			springs.push(lp);
			const grp = new THREE.Group();
			grp.position.set(sx * 0.385, 0.625 + 0.033, zs);
			grp.add(m(lp.geo, R.spring));
			for (const e of lp.eyes) {
				e.add(m(lp.eye.clone().scale(1.4, 1.4, 1.4), R.spring), m(cyl([-0.06, 0, 0], [0.06, 0, 0], 0.014, 10), R.zinc));
				grp.add(e);
			}
			leaves.push(grp);
			for (const dz of [-0.07, 0.07]) for (const dx of [-0.055, 0.055]) steel.push(cyl([sx * 0.385 + dx, 0.5, zs + dz], [sx * 0.385 + dx, 0.71, zs + dz], 0.011, 8));
			steel.push(at(box(0.13, 0.025, 0.2, 0.006), sx * 0.385, 0.71, zs));
			// the shackle at the back eye, up to its bracket
			steel.push(link([sx * 0.44, 0.69, zs - 0.8], [sx * 0.44, 0.735, zs - 0.82], 0.016, 0.04), link([sx * 0.33, 0.69, zs - 0.8], [sx * 0.33, 0.735, zs - 0.82], 0.016, 0.04));
			// the damper, from the beam up to its bracket outside the rail
			eyes.push(cyl([sx * 0.47, 0.56, zs + 0.12], [sx * 0.47, 0.76, zs + 0.17], 0.035, 16), cyl([sx * 0.47, 0.76, zs + 0.17], [sx * 0.46, 0.92, zs + 0.2], 0.016, 10));
		}
		part({ id: 'front-springs', label: 'Front springs and dampers', count: 2, assembly: 'chassis', source: SRC.road, what: 'A parabolic spring each side: two tapered steel leaves clamped to the axle’s pad by four U-bolts, hung from the frame at their front eyes and swinging on shackles at their back ones as they flatten; a telescopic damper beside each.', moves: 'They flatten as the load on the steer axle grows.', drive: 'The axle’s load', specs: [['Leaves', '2 parabolic, 1.6 m between the eyes'], ['Rate', `${Math.round(KF / 1000)} kN/m a side [inferred]`]] }, [...leaves, m(GEO.merge(steel), R.zinc), m(GEO.merge(eyes), R.damper)], { explode: [0, -0.6, 0.5] }, root);
		// the steering box on the left rail, its drop arm, the shaft up to the cab
		const sb = GEO.merge([at(box(0.15, 0.2, 0.2, 0.02), 0.52, 0.86, 7.45), cyl([0.6, 0.84, 7.45], [0.64, 0.84, 7.45], 0.035, 16), cyl([0.5, 0.96, 7.45], [0.5, 1.2, 7.62], 0.02, 10)]);
		part({ id: 'steering-box', label: 'Steering box', assembly: 'chassis', source: SRC.road, what: 'A recirculating-ball steering box with its own hydraulic power assist, bolted outside the left rail: the shaft from the steering wheel turns its worm, and its drop arm swings the drag link forward and back.', specs: [['Assist', 'Hydraulic, from a pump on the gear train [inferred]']] }, [m(sb, R.castIron), m(link([0.64, 0.84, 7.45], [0.64, 0.6, 7.45], 0.05, 0.04), R.forged)], { explode: [0.5, -0.3, 0.3] });
	}

	/* ------------------------------------------------------------ the drive axle on its air */
	const crown = new THREE.Group(), shafts = new THREE.Group();
	{
		const zd = axle.drive;
		const housing = GEO.shell([[0.08, -0.19], [0.18, -0.17], [0.245, -0.09], [0.255, 0], [0.245, 0.09], [0.18, 0.17], [0.08, 0.19]], 0.012, 48).rotateZ(-Math.PI / 2).translate(0, YW, zd);
		const tubes = [];
		for (const sx of [-1, 1]) tubes.push(cyl([sx * 0.18, YW, zd], [sx * 0.66, YW, zd], 0.075, 24), cyl([sx * 0.66, YW, zd], [sx * 0.9, YW, zd], 0.06, 20), at(box(0.16, 0.03, 0.22, 0.008), sx * 0.385, YW - 0.085, zd));
		const carrierShell = GEO.shell([[0.19, 0.12], [0.14, 0.24], [0.085, 0.36], [0.06, 0.4]], 0.012, 32).rotateX(Math.PI / 2).translate(0, YW + 0.02, zd);
		part({ id: 'drive-axle', label: 'Drive axle', assembly: 'drivetrain', source: SRC.road, what: 'A pressed-steel banjo housing across the frame: in its bowl the crown wheel and the differential, the pinion in the carrier in front of it driven by the propshaft; the half-shafts through its tubes turn the hubs of the twin wheels. Single reduction, 2.53 : 1.', moves: 'Its gears and shafts turn with the wheels.', drive: 'The propshaft', specs: [['Ratio', '2.53 : 1, hypoid [inferred]'], ['Rated', '11.5 t'], ['Oil', '13 L, 75W-90 [inferred]']] }, [m(GEO.merge([housing, ...tubes, carrierShell]), R.chassis)], { explode: [0, -0.5, -0.2], xray: 'shell', tag: { text: 'Drive axle', at: [-0.6, YW + 0.1, zd], side: 'left', value: () => `${tonnes(L.drive)} t on it (11.5 t allowed) · its tyres grip ${fmt((MU * L.drive) / 1000)} kN` } }, root);
		// the crown wheel and the differential's case, the pinion, the half-shafts: turning, seen through the cut
		crown.position.set(0, YW, zd);
		crown.add(m(spurGeometry({ r: 0.19, width: 0.04, module: 0.006, bore: 0.07 }).rotateY(Math.PI / 2).translate(0.07, 0, 0), D.gear), m(latheX([[0.03, -0.1], [0.12, -0.1], [0.14, 0.05], [0.03, 0.05]], 32), D.iron));
		shafts.position.set(0, YW, zd);
		shafts.add(m(GEO.merge([cyl([-0.9, 0, 0], [-0.06, 0, 0], 0.028, 14), cyl([0.06, 0, 0], [0.9, 0, 0], 0.028, 14)]), D.crank));
		part({ id: 'differential', label: 'Crown wheel and differential', assembly: 'drivetrain', source: SRC.road, what: 'Inside the bowl: the pinion turns the crown wheel 2.53 times slower; the crown wheel carries the differential’s case, whose bevel gears share its push between the two half-shafts and let them turn at different speeds round a bend.', moves: 'Turns with the wheels.', drive: 'The pinion', specs: [['Crown wheel', 'Ø ~ 400 mm [inferred]']] }, [crown, shafts], { explode: [0, 0.4, -0.4] }, root);
		// the trailing arms, the four bellows, the dampers, the V-rod
		const arms = [], rubber = [], steel = [], damp = [];
		for (const sx of [-1, 1]) {
			const x = sx * 0.385;
			arms.push(link([x, 0.62, 4.15], [x, 0.4, zd], 0.08, 0.06), link([x, 0.4, zd], [x, 0.4, 2.76], 0.08, 0.06), cyl([x - 0.05, 0.62, 4.15], [x + 0.05, 0.62, 4.15], 0.04, 16));
			for (const [z, y0] of /** @type {[number, number][]} */ ([[3.68, 0.525], [2.8, 0.43]])) {
				const b = airSpring(x, y0, F.top - F.h, z, 0.145);
				rubber.push(b.rubber);
				steel.push(b.steel);
			}
			damp.push(cyl([sx * 0.53, YW + 0.02, zd + 0.13], [sx * 0.52, 0.76, zd + 0.24], 0.035, 16), cyl([sx * 0.52, 0.76, zd + 0.24], [sx * 0.47, 0.92, zd + 0.25], 0.016, 10));
		}
		arms.push(link([0, YW + 0.2, zd + 0.1], [0.34, 0.8, 3.86], 0.05, 0.04), link([0, YW + 0.2, zd + 0.1], [-0.34, 0.8, 3.86], 0.05, 0.04));
		part({ id: 'drive-suspension', label: 'Drive axle’s air suspension', assembly: 'chassis', source: SRC.bags, what: 'A trailing arm each side from a hanger on the frame, the axle clamped on it; two rolling-lobe air bellows on each arm, ahead of and behind the axle, carry the load; a levelling valve fills or empties them to hold the frame at its height whatever the load, so their pressure follows the load; a damper each side and a V-rod over the axle hold it straight.', moves: 'The bellows’ pressure rises and falls with the load; the height stays.', drive: 'The compressor’s air, through the levelling valve', specs: [['Bellows', `4, Ø 300 mm effective [inferred]`], ['Pressure', 'Up to the supply’s 8.5 bar']] }, [m(GEO.merge(arms), R.forged), m(GEO.merge(rubber), R.bush), m(GEO.merge(steel), R.zinc), m(GEO.merge(damp), R.damper)], { explode: [0, -0.5, -0.3], tag: { text: 'Bellows', at: [-0.385, 0.6, 2.8], side: 'left', value: () => `${fmt(bagP(L.drive, MASS.unsprung.drive, 4) / 1e5, 1)} bar, holding the height` } }, root);
	}

	/* ------------------------------------------------------------ the wheels */
	const front = /** @type {ReturnType<typeof station>[]} */ ([]), drive = /** @type {ReturnType<typeof station>[]} */ ([]), trail = /** @type {ReturnType<typeof station>[]} */ ([]);
	for (const sx of /** @type {(1 | -1)[]} */ ([1, -1])) {
		const lr = sx > 0 ? 'left' : 'right';
		front.push(station(kit, { id: `f${lr[0]}`, label: `front ${lr}`, at: [sx * (axle.front + 0.12), YW, axle.steer], side: sx, size: TYRE, rimW: 9 * 0.0254, et: 0.12, angle: Math.PI * 0.85, parent: root, assembly: 'wheels', M, R, tag: sx > 0 ? { text: 'Front wheel', at: [0.05, 0.3, 0], side: 'left', value: () => `${fmt((sim.s.v / VEHICLE.r) * 9.549)} rpm` } : undefined }));
		drive.push(station(kit, { id: `r${lr[0]}`, label: `rear ${lr}`, at: [sx * 0.915, YW, axle.drive], side: sx, size: TYRE, rimW: 9 * 0.0254, et: 0.17, twin: true, spring: true, angle: Math.PI * 0.75, parent: root, assembly: 'wheels', drive: 'The half-shaft, from the differential', M, R }));
		T.axles.forEach((z, i) => trail.push(station(kit, { id: `t${i + 1}${lr[0]}`, label: `trailer axle ${i + 1}, ${lr}`, at: [sx * (T.x + 0.12), YT, z], side: sx, size: TTYRE, rimW: 11.75 * 0.0254, et: 0.12, spring: true, angle: Math.PI * 0.75, parent: root, assembly: 'running', M, R })));
	}

	/* ------------------------------------------------------------ the engine, the gearbox, the propshaft */
	const engine = dieselSix(kit, {
		parent: body,
		at: TR.engine,
		gears: GEARS,
		range: RANGE,
		assembly: 'engine',
		gearAssembly: 'drivetrain',
		source: SRC.eng,
		M: D,
		tags: {
			engine: () => (sim.s.stalled && !sim.s.running ? 'stopped' : `${fmt(sim.s.rpm)} rpm · ${fmt(Math.max(0, sim.s.Te))} N·m · ${fmt(Math.max(0, sim.s.Pe) / 1000)} kW`),
			turbo: () => `${fmt((air.s.w * 60) / (2 * Math.PI) / 1000)}k rpm · ${fmt(air.s.boost / 1e5, 2)} bar boost${air.s.gate > 0.02 ? ` · wastegate ${fmt(air.s.gate * 100)} % open` : ''}`,
			exhaust: () => `${fmt(air.s.t3 - 273)} °C before the turbine`,
			rail: () => `${fmt(air.s.rail)} bar`,
			injector: () => `${fmt(air.s.q)} mm³ a stroke · λ ${fmt(air.s.lambda, 2)}`,
			cylinder: () => `${fmt(air.s.pComp / 1e5)} bar, ${fmt(air.s.tComp - 273)} °C at the top`,
			gearbox: () => (sim.s.stalled && !sim.s.running ? 'stalled' : sim.s.v < 0.05 && sim.s.at.vSet < 0.05 ? 'neutral' : `${ordinal(sim.s.gear)} gear · ${GEARS[sim.s.gear - 1].toFixed(2)} : 1${sim.s.launch ? ' · clutch slipping' : ''}`)
		}
	});
	const PINION = /** @type {V3} */ ([0, YW + 0.02, axle.drive + 0.43]);
	const shaft = propshaft(kit, { n: 1, r: 0.05, M: R, assembly: 'drivetrain', source: SRC.road, specs: [['Tube', 'Ø 100 × 3 mm steel [inferred]'], ['Joints', '2 universal joints, a sliding spline']] });

	/* ------------------------------------------------------------ cooling, fuel, air, power, exhaust */
	{
		// the radiator and, in front of it, the charge air cooler; the fan's shroud between them and the fan
		const zr = 7.58, zc = 7.69, wr = 1.0, y0 = 0.78, y1 = 1.64;
		const finsOf = (/** @type {number} */ z, /** @type {number} */ n) => {
			const out = [at(box(wr, y1 - y0, 0.05, 0.002), 0, (y0 + y1) / 2, z)];
			for (let k = 0; k <= n; k++) out.push(slab(0.0007, y1 - y0, 0.056).translate(-wr / 2 + (k * wr) / n, (y0 + y1) / 2, z));
			return GEO.merge(out);
		};
		const tanks = GEO.merge([at(box(wr + 0.04, 0.06, 0.07, 0.012), 0, y1 + 0.03, zr), at(box(wr + 0.04, 0.05, 0.07, 0.012), 0, y0 - 0.025, zr), cyl([0.3, y1 + 0.06, zr], [0.3, y1 + 0.08, zr], 0.025, 18)]);
		const cacTanks = GEO.merge([at(box(0.07, y1 - y0 + 0.02, 0.07, 0.015), wr / 2 + 0.035, (y0 + y1) / 2, zc), at(box(0.07, y1 - y0 + 0.02, 0.07, 0.015), -wr / 2 - 0.035, (y0 + y1) / 2, zc)]);
		const fp = engine.points.fan;
		const ring = new THREE.Shape();
		ring.absarc(0, 0, 0.395, 0, Math.PI * 2, false);
		ring.holes.push(circle(0, 0, 0.382));
		const face = /** @type {THREE.Shape} */ (roundPoly([[-wr / 2, y0 - fp[1]], [wr / 2, y0 - fp[1]], [wr / 2, y1 - fp[1]], [-wr / 2, y1 - fp[1]]], 0.03));
		face.holes.push(circle(0, 0, 0.385));
		const shroud = GEO.merge([plate(ring, 0.16, 32).translate(0, fp[1], fp[2] + 0.02), plate(face, 0.006, 8).translate(0, fp[1], zr - 0.03)]);
		const wo = engine.points.waterOut, wi = engine.points.waterIn;
		const hoses = [hose([wo, [0.25, wo[1] + 0.16, wo[2] + 0.04], [0.42, 1.58, 7.35], [0.42, 1.63, zr - 0.04]], 0.024, 10), hose([[-0.42, y0 - 0.04, zr - 0.03], [-0.42, 0.74, 7.3], [-0.3, 0.76, 7.2], wi], 0.024, 10)];
		part({ id: 'radiator', label: 'Radiator, charge air cooler and shroud', assembly: 'services', source: SRC.eng, what: 'In the nose under the cab’s floor, behind the grille: in front the charge air cooler, where the compressed air from the turbocharger gives its heat to the road’s air; behind it the radiator, where the engine’s coolant does; the shroud round the fan makes it pull through all of both cores.', specs: [['Cores', `${Math.round(wr * 1000)} × ${Math.round((y1 - y0) * 1000)} mm each, aluminium [inferred]`], ['Rejects', 'About a quarter of the fuel’s heat at full load']] }, [m(finsOf(zr, 70), M.core), m(finsOf(zc, 40), M.core), m(tanks, D.cover), m(cacTanks, D.alloy), m(shroud, D.cover), m(GEO.merge(hoses), D.hose)], { explode: [0, 0.2, 1.1], tag: { text: 'Radiator', at: [0.45, y1, zr], side: 'right', value: () => `${fmt(heat())} kW to the air` } });
		// the charge air: from the compressor out round the right to the cooler, back round the left to the manifold
		const bo = engine.points.boostOut, ia = engine.points.intake;
		const cac = GEO.merge([hose([bo, [-0.5, 1.6, 6.8], [-0.62, 1.45, 7.15], [-0.62, 1.15, 7.5], [-0.57, 1.0, zc]], 0.045, 14), hose([[0.57, 1.0, zc], [0.62, 1.3, 7.56], [0.5, 1.52, 7.42], [0.33, 1.47, 7.32], ia], 0.045, 14)]);
		part({ id: 'charge-air-pipes', label: 'Charge air pipes', count: 2, assembly: 'services', source: SRC.eng, what: 'Two aluminium pipes with silicone joints: the hot, compressed air from the turbocharger round the engine’s right side to the charge air cooler, and the cooled air back round its left to the intake manifold.', specs: [['Pipes', 'Ø 90 mm [inferred]'], ['Air', 'Up to 2.2 bar over the air’s, ~200 °C before the cooler']] }, [m(cac, D.alloy)], { explode: [0, 0.3, 0.6] });
		// the air filter behind the cab on the right, its duct into the compressor
		const af = { x: -0.88, z: 5.8 };
		const ai = engine.points.airIn;
		part({ id: 'air-filter', label: 'Air filter and intake', assembly: 'services', source: SRC.eng, what: 'The engine breathes from an intake high on the cab’s back corner, down through a paper element in this canister behind the cab, and through a duct forward into the turbocharger’s compressor.', specs: [['Element', 'Paper, dry, ~ 30 m³/min [inferred]']] }, [m(GEO.merge([cyl([af.x, 0.68, af.z], [af.x, 1.12, af.z], 0.16, 32), latheY([[0, 1.12], [0.16, 1.12], [0.12, 1.15], [0, 1.15]], 32).translate(af.x, 0, af.z), at(box(0.06, 0.06, 0.2, 0.01), af.x + 0.16, 0.9, af.z)]), M.filterBox), m(hose([[af.x + 0.08, 1.12, af.z + 0.06], [-0.78, 1.12, 6.0], [-0.72, 1.3, 6.3], [-0.6, 1.5, 6.75], [-0.42, 1.48, 6.98], [-0.35, 1.41, 6.9], ai], 0.05, 14), D.hose)], { explode: [-0.5, 0.2, -0.2] });
		// the fuel tank on the left, its straps and filler; the batteries behind it
		const ft = { x: 0.78, y: 0.67, z0: 4.42, z1: 5.72 };
		const tankS = /** @type {THREE.Shape} */ (roundPoly([[-0.31, -0.31], [0.31, -0.31], [0.31, 0.31], [-0.31, 0.31]], [0.04, 0.16, 0.16, 0.04]));
		const tankG = plate(tankS, ft.z1 - ft.z0, 8).translate(ft.x, ft.y, (ft.z0 + ft.z1) / 2);
		const straps = [];
		for (const z of [ft.z0 + 0.25, ft.z1 - 0.25]) straps.push(latheZ([[0.317, -0.02], [0.325, -0.02], [0.325, 0.02], [0.317, 0.02]], 32).translate(ft.x, ft.y, z), at(box(0.08, 0.02, 0.05, 0.004), 0.47, ft.y + 0.33, z));
		part({ id: 'fuel-tank', label: 'Fuel tank', assembly: 'services', source: SRC.eng, what: 'A polished aluminium tank outside the left rail, hung on two brackets and two steel straps; its cap on its top outside, its sender and its pickup inside, the lines to the engine’s filters along the rail.', specs: [['Volume', '~ 430 L [inferred]'], ['Fuel', 'Diesel, 835 g/L']] }, [m(tankG, M.tank), m(GEO.merge(straps), R.chassis), m(cyl([1.0, ft.y + 0.31, 5.5], [1.0, ft.y + 0.34, 5.5], 0.05, 20), M.trim)], { explode: [0.6, -0.2, 0], tag: { text: 'Fuel', at: [1.09, ft.y, 5.0], side: 'left', value: () => (sim.s.stalled && !sim.s.running ? 'stopped' : `${fmt(sim.s.fuel, 1)} L/h${sim.s.v > 0.5 ? ` · ${fmt(sim.s.l100, 1)} L/100 km` : ''}`) } });
		const bb = { x: 0.76, y: 0.72, z: 4.09 };
		part({ id: 'batteries', label: 'Batteries', count: 2, assembly: 'services', source: SRC.eng, what: 'Two 12 V batteries in series for the truck’s 24 V, in a box with a lid outside the left rail behind the tank: they start the engine and carry the cab’s load when it is off; the alternator charges them.', specs: [['Each', '12 V, 225 Ah [inferred]']] }, [m(at(box(0.58, 0.36, 0.56, 0.02), bb.x, bb.y, bb.z), M.grey), m(GEO.merge([at(box(0.6, 0.02, 0.58, 0.006), bb.x, bb.y + 0.19, bb.z)]), M.trim)], { explode: [0.6, -0.2, -0.2] });
		// the AdBlue tank and the aftertreatment box on the right
		const ab = { x: -0.75, y: 0.75, z: 4.17 };
		part({ id: 'adblue-tank', label: 'AdBlue tank', assembly: 'services', source: SRC.eng, what: 'A plastic tank of urea in water outside the right rail; a pump doses it into the exhaust ahead of the SCR catalyst, where it turns the engine’s nitrogen oxides into nitrogen and water.', specs: [['Volume', '60 L [inferred]'], ['Use', '~ 5 % of the diesel']] }, [m(at(box(0.5, 0.44, 0.44, 0.05), ab.x, ab.y, ab.z), M.adblue), m(cyl([ab.x - 0.1, ab.y + 0.22, ab.z], [ab.x - 0.1, ab.y + 0.26, ab.z], 0.045, 18), M.blueCap)], { explode: [-0.6, -0.2, -0.2] });
		const ex = engine.points.exhaust;
		const at0 = { x: -0.8, y: 0.72, z0: 4.45, z1: 5.55 };
		const atb = plate(/** @type {THREE.Shape} */ (roundPoly([[-0.32, -0.3], [0.32, -0.3], [0.32, 0.3], [-0.32, 0.3]], 0.12)), at0.z1 - at0.z0, 8).translate(at0.x, at0.y, (at0.z0 + at0.z1) / 2);
		part({ id: 'aftertreatment', label: 'Exhaust and aftertreatment', assembly: 'services', source: SRC.eng, what: 'From the turbine down past the frame into one stainless box outside the right rail: an oxidation catalyst, the particulate filter, the AdBlue’s doser and mixer, the SCR catalyst; the tail pipe out of its bottom.', specs: [['Pipe', 'Ø 127 mm [inferred]'], ['Inside', 'DOC, DPF, SCR, ammonia slip catalyst']] }, [m(atb, M.stainless), m(GEO.merge([hose([ex, [-0.4, 1.22, 6.15], [-0.5, 1.1, 5.95], [-0.56, 1.06, 5.7], [-0.6, 1.0, at0.z1 + 0.02]], 0.062, 14), hose([[-0.95, at0.y - 0.3, 4.6], [-0.98, 0.32, 4.55], [-1.02, 0.28, 4.45]], 0.055, 12)]), D.hot)], { explode: [-0.7, -0.2, 0], tag: { text: 'Exhaust', at: [-1.12, at0.y, 5.0], side: 'right', value: () => `${fmt(air.s.t3 - 273)} °C from the turbine` } });
		// the air tanks between the rails
		const tanks2 = [];
		for (const z of [4.05, 4.32]) tanks2.push(cyl([-0.32, 0.83, z], [0.32, 0.83, z], 0.1, 24), latheX([[0, 0.32], [0.1, 0.32], [0.06, 0.35], [0, 0.355]], 24).translate(0, 0.83, z), latheX([[0, -0.355], [0.06, -0.35], [0.1, -0.32], [0, -0.32]], 24).translate(0, 0.83, z));
		part({ id: 'air-tanks', label: 'Air tanks', count: 2, assembly: 'services', source: SRC.bags, what: 'Two steel reservoirs across between the rails, filled by the engine’s compressor through the air dryer: they hold the air for the brakes, the bellows, the gearbox’s shift unit and the trailer’s line.', specs: [['Each', '30 L at 12.5 bar [inferred]']] }, [m(GEO.merge(tanks2), M.airTank)], { explode: [0, -0.5, 0] });
	}
	/** the coolant's heat to the air (kW): about a quarter of the fuel's heat [inferred] */
	const heat = () => (sim.s.fuel * 0.835 * 42.6 * 0.25) / 3.6;

	/* ------------------------------------------------------------ the cab's mounts and the bumper, the steps */
	const H = C.hinge;
	const ramA = /** @type {V3} */ ([0.62, 0.95, 7.15]), ramB = /** @type {V3} */ ([0.62, 1.24, 7.62]);
	const ram = { body: new THREE.Group(), rod: new THREE.Group() };
	{
		const g = [], rub = [];
		for (const sx of [-1, 1]) {
			// the tilt hinges on brackets off the rails' front ends
			g.push(link([sx * 0.42, 0.9, F.front - 0.02], [sx * 0.62, H[1], H[0]], 0.06, 0.06), cyl([sx * 0.52, H[1], H[0]], [sx * 0.74, H[1], H[0]], 0.022, 12));
			// the rear mounts: a spring and damper on each outrigger, the cab's lock over it
			rub.push(cyl([sx * 0.6, 1.1, 6.12], [sx * 0.6, C.bottom - 0.005, 6.12], 0.045, 18));
			g.push(coil(0.05, 0.008, 5, 0.09, 60, 6).translate(sx * 0.6, 1.01, 6.12));
		}
		ram.body.add(m(unitBar(0.032, 16), R.damper));
		ram.rod.add(m(unitBar(0.016, 10), M.hydraulic));
		part({ id: 'cab-mounts', label: 'Cab hinges, mounts and tilt ram', assembly: 'cab', source: SRC.road, what: 'The cab rests on two hinges at the front of the frame and two sprung mounts at its back, locked down there by hooks. To reach the engine the locks open and a hand pump drives the hydraulic ram, which tilts the whole cab forward 60° on its hinges.', moves: 'The ram stretches as the cab tilts.', drive: 'A hand pump’s oil', specs: [['Tilt', '60°'], ['Mounts', 'Coil springs and dampers at the back [inferred]']] }, [m(GEO.merge(g), R.chassis), m(GEO.merge(rub), R.damper), ram.body, ram.rod], { explode: [0, -0.4, 0.4] });
		// the bumper on the frame's front, its headlights and fog lights
		const bump = GEO.merge([at(box(2.46, 0.42, 0.26, 0.06), 0, 0.61, 8.11), at(box(2.3, 0.07, 0.12, 0.02), 0, 0.37, 8.17)]);
		const lamps = [], lenses = [], ambers = [];
		for (const sx of [-1, 1]) {
			lamps.push(at(box(0.38, 0.15, 0.06, 0.02), sx * 0.9, 0.73, 8.21), at(box(0.15, 0.08, 0.05, 0.02), sx * 0.72, 0.5, 8.22));
			lenses.push(at(box(0.36, 0.13, 0.01, 0.006), sx * 0.9, 0.73, 8.236), at(box(0.13, 0.065, 0.01, 0.005), sx * 0.72, 0.5, 8.244));
			ambers.push(at(box(0.08, 0.13, 0.04, 0.01), sx * 1.14, 0.73, 8.215));
		}
		const brackets = [link([0.4, 0.78, F.front - 0.02], [0.6, 0.66, 7.98], 0.08, 0.06), link([-0.4, 0.78, F.front - 0.02], [-0.6, 0.66, 7.98], 0.08, 0.06)];
		const ends = { paint: halfCut(M.paint), grey: halfCut(M.grey), lens: halfCut(M.lens), amber: halfCut(M.amber), reflector: halfCut(M.reflector) };
		part({ id: 'bumper', label: 'Bumper and headlights', assembly: 'cab', source: SRC.air, what: 'A steel bumper with its plastic skin across the front of the frame, the front underrun guard inside it; the headlights in its top corners with the indicators outside them, the fog lights below, the air dam under it.', specs: [['Headlights', 'LED, 24 V [inferred]'], ['Guard', 'Front underrun, 160 kN [inferred]']] }, [m(GEO.merge([bump]), ends.paint), m(GEO.merge(brackets), R.chassis), m(GEO.merge(lamps), ends.reflector), m(GEO.merge(lenses), ends.lens), m(GEO.merge(ambers), ends.amber)], { explode: [0, -0.2, 0.7] });
		// the steps behind the front wheels, frame-mounted, two treads each
		const stepG = [], treads = [];
		for (const sx of [-1, 1]) {
			stepG.push(onX(plate(zyShape([[6.08, 0.36], [6.46, 0.36], [6.46, 1.18], [6.08, 1.18]], 0.03), 0.008, 4), sx * 1.235), link([sx * F.x, 0.86, 6.25], [sx * 1.0, 0.86, 6.25], 0.06, 0.06), at(box(0.25, 0.008, 0.38, 0.003), sx * 1.11, 0.36, 6.27));
			for (const y of [0.45, 0.85]) treads.push(at(box(0.25, 0.03, 0.36, 0.006), sx * 1.11, y, 6.27));
		}
		part({ id: 'steps', label: 'Steps', count: 2, assembly: 'cab', source: SRC.road, what: 'A step box each side behind the front wheel, on the frame’s outriggers: two aluminium treads at 450 and 850 mm, the third in the door’s sill at 1.25 m, the cab’s floor at 1.75 m.', specs: [['Treads', '450 · 850 · 1,250 mm']] }, [m(GEO.merge(stepG), M.grey), m(GEO.merge(treads), M.tread)], { explode: [0, -0.3, 0] });
	}

	/* ------------------------------------------------------------ the cab, on its hinges */
	const cabPivot = new THREE.Group();
	cabPivot.name = 'cab-tilt';
	cabPivot.position.set(0, H[1], H[0]);
	body.add(cabPivot);
	/** the cab in the body's own coordinates, turned with the pivot */
	const cab = new THREE.Group();
	cab.position.set(0, -H[1], -H[0]);
	cabPivot.add(cab);
	const X = C.X, t = 0.008;
	const doorHole = /** @type {V2[]} */ ([[DR.z[0], DR.y[0]], [DR.z[1], DR.y[0]], [DR.z[1], DR.y[1]], [DR.z[0], DR.y[1]]]);
	const doorWin = /** @type {V2[]} */ ([[DR.z[0] + 0.08, 2.4], [DR.z[1] - 0.08, 2.4], [DR.z[1] - 0.08, 3.02], [DR.z[0] + 0.08, 3.02]]);
	{
		// the side profile (z, y), anticlockwise from the back's foot: the bottom over the wheel, the arch's front, the apron,
		// the face, the windscreen, its header, the roof and the back; each edge's radius round onto the sides
		const Ra = 0.72, a1 = Math.asin((C.bottom - YW) / Ra), a2 = Math.asin((C.apron - YW) / Ra);
		/** @type {V2[]} */
		const pts = [[C.back, C.bottom]];
		for (let k = 0; k <= 10; k++) {
			const a = a1 + ((a2 - a1) * k) / 10;
			pts.push([axle.steer + Ra * Math.cos(a), YW + Ra * Math.sin(a)]);
		}
		const k0 = pts.length;
		pts.push([8.08, C.apron], [8.15, 1.05], [C.face, 2.35], [8.08, 3.2], [7.98, 3.72], [7.85, C.roof], [C.back + 0.08, C.roof], [C.back, C.roof - 0.08]);
		const er = [0, 0.05, 0.12, 0.12, 0.12, 0.1, 0.1, 0.06, 0.06];
		const n = pts.length;
		/** @type {number[]} */
		const r = pts.map((_, k) => (k < k0 - 1 ? 0 : er[k - (k0 - 1)]));
		const kFace = k0 + 1, kWs = k0 + 2;
		const outline = insetEdges(pts, r);
		const sides = [];
		for (const sx of [-1, 1]) {
			const s = zyShape(outline, 0);
			s.holes.push(zyHole(doorHole, 0.04));
			sides.push(onX(plate(s, t, 6), sx * (X - t / 2)));
		}
		// the front wheels' houses under the cab, black plastic round the tyres
		const houses = [];
		for (const sx of [-1, 1]) {
			const sh = new THREE.Shape();
			sh.absarc(0, 0, Ra + 0.006, a2, Math.PI - a2, false);
			sh.absarc(0, 0, Ra, Math.PI - a2, a2, true);
			sh.closePath();
			houses.push(plate(sh, 0.38, 24).rotateY(Math.PI / 2).translate(sx * (X - 0.2), YW, axle.steer));
		}
		part({ id: 'cab-sides', label: 'Cab sides', assembly: 'cab', source: SRC.air, what: 'The cab’s two pressed-steel sides, the door openings in them, the front wheels’ arches cut under them; the plastic wheel houses inside, round the tops of the front tyres, turning with the cab when it tilts.', specs: [['Steel', '0.8 mm, painted [inferred]']] }, [m(GEO.merge(sides), M.paint), m(GEO.merge(houses), M.trim)], { explode: [0, 0.4, 0], xray: 'shell' }, cab);
		// the face, the windscreen's frame, the header, the roof and the back wall: a panel for each edge
		/** @type {THREE.BufferGeometry[]} */
		const ps = [];
		/** @type {THREE.BufferGeometry[]} */
		const screen = [];
		/** @type {THREE.BufferGeometry[]} */
		const grille = [];
		for (let k = k0 - 1; k < n; k++) {
			if (k === k0 - 1) continue;
			const a = pts[k], b = pts[(k + 1) % n], R0 = r[k];
			const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
			/** @type {THREE.Path[]} */
			const holes = [];
			const hw = X - R0;
			if (k === kWs) {
				holes.push(roundHole([[-hw + 0.05, 0.05], [hw - 0.05, 0.05], [hw - 0.05, len - 0.05], [-hw + 0.05, len - 0.05]], 0.07));
				screen.push(onEdge(plate(/** @type {THREE.Shape} */ (roundPoly([[-hw + 0.045, 0.045], [hw - 0.045, 0.045], [hw - 0.045, len - 0.045], [-hw + 0.045, len - 0.045]], 0.07)), 0.008, 8), a, b, -0.008));
			}
			if (k === kFace) {
				holes.push(roundHole([[-0.82, 0.08], [0.82, 0.08], [0.82, 1.0], [-0.82, 1.0]], 0.05));
			}
			ps.push(edgePanel(a, b, R0, t, 2 * X, holes));
		}
		// the grille's bars across its opening, each on the face's slope
		{
			const a = pts[kFace], b = pts[kFace + 1];
			for (let j = 0; j < 9; j++) grille.push(onEdge(box(1.62, 0.04, 0.025, 0.008).translate(0, 0.14 + (j * 0.82) / 8, 0), a, b, -0.004));
			grille.push(onEdge(GEO.merge([box(1.68, 0.03, 0.02, 0.006).translate(0, 0.085, 0), box(1.68, 0.03, 0.02, 0.006).translate(0, 0.995, 0)]), a, b, -0.004));
		}
		part({ id: 'cab-shell', label: 'Face, roof and back', assembly: 'cab', source: SRC.air, what: 'The cab’s face with the grille’s opening low in it, the windscreen’s frame, the header over it, the high roof and the back wall of the sleeper; every edge rounded onto the sides. Under the face the apron hangs low in front of the wheels, the radiator behind it.', specs: [['Inside', '2.0 m standing over the flat floor']] }, [m(GEO.merge(ps), M.paint)], { explode: [0, 0.9, 0], xray: 'shell' }, cab);
		part({ id: 'grille', label: 'Grille', assembly: 'cab', source: SRC.air, what: 'Nine bars across the opening low in the cab’s face: the road’s air through them into the charge air cooler and the radiator.', specs: [['Opening', '1.64 × 0.92 m']] }, [m(GEO.merge(grille), M.grey)], { explode: [0, 0, 0.6] }, cab);
		// the sun visor over the windscreen
		const visor = onEdge(box(2.3, 0.18, 0.012, 0.005).translate(0, 0.16, 0).rotateX(-0.9), pts[kWs + 1], pts[kWs + 2], 0.0);
		part({ id: 'windscreen', label: 'Windscreen and sun visor', assembly: 'cab', source: SRC.air, what: 'The laminated windscreen, nearly upright over the dashboard, and the sun visor over its top.', specs: [['Glass', '6 mm laminated, ~ 2.3 × 0.9 m']] }, [m(GEO.merge(screen), M.glass), m(visor, M.trim)], { explode: [0, 0.4, 0.5] }, cab);
		// the roof deflector, its slope and its sides
		const dz = /** @type {V2[]} */ ([[7.75, C.roof], [6.35, 3.98]]);
		const defl = [edgePanel(dz[0], dz[1], 0.08, 0.006, 2.36, []), edgePanel(dz[1], [C.back + 0.05, 3.98], 0.08, 0.006, 2.36, [])];
		for (const sx of [-1, 1]) defl.push(onX(plate(zyShape([[7.7, C.roof], [C.back + 0.05, C.roof], [C.back + 0.05, 3.9], [6.35, 3.9]], 0.02), 0.006, 4), sx * 1.172));
		part({ id: 'deflector', label: 'Roof deflector', assembly: 'cab', source: SRC.air, what: 'A glass-fibre wedge on the roof that lifts the air from the cab’s top to the trailer’s, so it does not strike the trailer’s front wall: it takes about a tenth off the drag.', specs: [['Top', '3.98 m'], ['Saves', '~ 10 % of the drag at 80 km/h [inferred]']] }, [m(GEO.merge(defl), M.paint)], { explode: [0, 0.5, -0.2], xray: 'shell' }, cab);
		// the floor, the sills' steps, the front wall, the lining
		const fx = X - t - 0.004;
		const floorS = /** @type {THREE.Shape} */ (roundPoly(xz([[-0.97, C.back + 0.03], [0.97, C.back + 0.03], [0.97, 7.66], [-0.97, 7.66]]), 0.004));
		const floorG = [onY(plate(floorS, 0.02, 4), C.floor - 0.01)];
		const sills = [];
		for (const sx of [-1, 1]) {
			floorG.push(onY(plate(/** @type {THREE.Shape} */ (roundPoly(xz([[sx * 0.97, C.back + 0.03], [sx * fx, C.back + 0.03], [sx * fx, DR.z[0] - 0.02], [sx * 0.97, DR.z[0] - 0.02]]), 0.003)), 0.02, 4), C.floor - 0.01), onY(plate(/** @type {THREE.Shape} */ (roundPoly(xz([[sx * 0.97, DR.z[1] + 0.02], [sx * fx, DR.z[1] + 0.02], [sx * fx, 7.66], [sx * 0.97, 7.66]]), 0.003)), 0.02, 4), C.floor - 0.01));
			sills.push(at(box(fx - 0.97, 0.03, DR.z[1] - DR.z[0], 0.005), sx * (fx + 0.97) / 2, DR.y[0] + 0.015, (DR.z[0] + DR.z[1]) / 2), onX(plate(zyShape([[DR.z[0], DR.y[0]], [DR.z[1], DR.y[0]], [DR.z[1], C.floor], [DR.z[0], C.floor]], 0.004), 0.008, 4), sx * 0.97));
		}
		const fwall = at(box(2 * fx, 0.3, 0.012, 0.004), 0, C.floor + 0.15, 7.66);
		const lining = GEO.merge([at(box(2 * fx, 0.012, 2.0, 0.004), 0, C.roof - 0.05, 7.0), at(slab(2 * fx, 1.9, 0.012), 0, C.floor + 0.98, C.back + 0.02)]);
		part({ id: 'floor', label: 'Floor and sills', assembly: 'cab', source: SRC.air, what: 'The cab’s flat steel floor over the engine, 1.75 m off the road, a rubber mat on it; each door’s sill a step lower at 1.25 m, the third of the steps; the front wall under the dashboard; the headlining under the roof and the trim on the back wall.', specs: [['Floor', `${Math.round(C.floor * 1000)} mm off the road, flat`]] }, [m(GEO.merge(floorG), M.floor), m(GEO.merge([...sills, fwall]), M.paint), m(lining, M.lining)], { explode: [0, 0.3, 0] }, cab);
		// the mirrors on their arms, the lights on the cab
		const mir = [], glass = [], markers = [];
		for (const sx of [-1, 1]) {
			mir.push(link([sx * X, 2.95, 7.8], [sx * 1.43, 2.98, 7.84], 0.03, 0.03), link([sx * X, 2.42, 7.8], [sx * 1.43, 2.46, 7.84], 0.025, 0.025), at(box(0.07, 0.4, 0.24, 0.02), sx * 1.45, 2.8, 7.84), at(box(0.07, 0.2, 0.2, 0.02), sx * 1.45, 2.47, 7.84));
			glass.push(at(slab(0.004, 0.37, 0.21), sx * 1.45, 2.8, 7.84), at(slab(0.004, 0.17, 0.17), sx * 1.45, 2.47, 7.84));
			markers.push(at(box(0.05, 0.03, 0.08, 0.01), sx * (X + 0.01), 1.12, 7.85));
		}
		// the mirrors' glass faces back: stand it on their housings' back faces
		const mg = GEO.merge(glass.map((g) => g.translate(0, 0, -0.124)));
		part({ id: 'mirrors', label: 'Mirrors', count: 4, assembly: 'cab', source: SRC.air, what: 'On each side a main mirror and a wide-angle one under it on arms from the cab’s front corner, so the driver sees down the whole trailer and the lane beside it.', specs: [['Main', '~ 0.37 × 0.21 m, heated'], ['Width over them', '2.95 m']] }, [m(GEO.merge(mir), M.trim), m(mg, M.mirror), m(GEO.merge(markers), M.amber)], { explode: [0, 0.3, 0.3] }, cab);
		const wip = [];
		// each blade and its arm lying along the screen's foot, parked
		for (const wx of [-0.5, 0.4]) wip.push(onEdge(GEO.merge([at(slab(0.75, 0.012, 0.012), 0, 0.075, 0.014), at(slab(0.72, 0.022, 0.022), -0.01, 0.06, 0.026)]).rotateZ(0.04).translate(wx, 0, 0), pts[kWs], pts[kWs + 1], 0));
		part({ id: 'wipers', label: 'Wipers', count: 2, assembly: 'cab', source: SRC.air, what: 'Two long wipers parked at the windscreen’s foot, driven by one motor behind the face.', specs: [['Blades', '2 × 800 mm [inferred]']] }, [m(GEO.merge(wip), M.trim)], { explode: [0, 0.4, 0.5] }, cab);
	}

	/* ------------------------------------------------------------ the cab's doors */
	/** @type {ReturnType<typeof hinge>[]} */
	const cabDoors = [];
	for (const sx of /** @type {(1 | -1)[]} */ ([1, -1])) {
		const id = sx > 0 ? 'door-left' : 'door-right';
		const h = hinge(cab, { at: [sx * X, 0, DR.z[1]], axis: 'y', max: -sx * 1.35, name: id });
		const d = doorPanels([...doorHole], [...doorWin], { x: X, sx, split: DR.split, t: [0.06, 0.035] });
		const mv = (/** @type {THREE.BufferGeometry} */ g) => g.translate(-sx * X, 0, -DR.z[1]);
		const z0 = DR.z[0];
		const outside = GEO.merge([at(box(0.025, 0.04, 0.2, 0.01), sx * (X + 0.012), 2.05, z0 + 0.2), at(box(0.02, 0.6, 0.03, 0.008), sx * (X + 0.012), 1.75, z0 + 0.08)]);
		const inside = GEO.merge([at(box(0.05, 0.05, 0.4, 0.012), sx * (X - 0.09), 2.12, (z0 + DR.z[1]) / 2), at(box(0.03, 0.03, 0.12, 0.008), sx * (X - 0.08), 2.22, z0 + 0.2)]);
		kit.part(h.pivot, { id, label: sx > 0 ? 'Door, left (the driver’s)' : 'Door, right', assembly: 'doors', source: SRC.air, what: 'A hinged steel door the height of the cab’s side from its sill to its roof line, its window wound down into it by a motor, its card, armrest and handles; a grab handle down its back edge to climb the steps by.', moves: 'Opens to 77° on its hinges.', drive: 'By hand (the Cab doors slider)', specs: [['Opening', `${Math.round((DR.z[1] - z0) * 1000)} × ${Math.round((DR.y[1] - DR.y[0]) * 1000)} mm`]] }, { explode: [sx * 0.7, 0.05, 0.2] }, cab);
		h.pivot.add(m(mv(d.skin), M.paint), m(mv(d.glass), M.glass), m(mv(d.card), M.card), m(mv(inside), M.vinyl), m(mv(outside), M.trim));
		cabDoors.push(h);
	}

	/* ------------------------------------------------------------ inside the cab */
	const gauges = cluster(kit, { dials: [{ x: -0.09, y: 0, r: 0.065, max: 125, ticks: 6 }, { x: 0.09, y: 0, r: 0.065, max: 3000, ticks: 7 }], face: M.dial, tick: M.white, needle: M.needle, bezel: M.chrome, housing: M.dash });
	{
		const { x: dx, z: dz } = TR.driver;
		const f = seatGeometry({ w: 0.56, d: 0.55, h: 0.48, back: 0.72, rake: 0.22 });
		const seats = [-1, 1].map((sx) => [f.fabric.clone().translate(sx * dx, C.floor, dz), f.base.clone().translate(sx * dx, C.floor, dz)]);
		part({ id: 'seats', label: 'Seats', count: 2, assembly: 'interior', source: SRC.air, what: 'The driver’s seat and the passenger’s, each on its own air spring and damper so the road’s shake stops under the driver; belts built into them.', specs: [['Suspension', 'Air, 100 mm travel [inferred]']] }, [m(GEO.merge(seats.map((p) => p[0])), M.fabric), m(GEO.merge(seats.map((p) => p[1])), M.vinyl)], { explode: [0, 0.8, 0.1] }, cab);
		const bunk = [at(box(2.3, 0.44, 0.58, 0.02), 0, C.floor + 0.22, C.back + 0.32)];
		part({ id: 'bunk', label: 'Bunk', assembly: 'interior', source: SRC.air, what: 'The bed across the back of the cab over its lockers, where the driver sleeps through the rest the law asks for between days.', specs: [['Mattress', '2.0 × 0.6 m [inferred]']] }, [m(GEO.merge(bunk), M.vinyl), m(at(box(2.2, 0.14, 0.58, 0.05), 0, C.floor + 0.51, C.back + 0.32), M.mattress)], { explode: [0, 0.9, -0.3] }, cab);
		const dash = GEO.merge([at(box(2.38, 0.36, 0.5, 0.05, 2), 0, 2.12, 7.9), at(box(0.5, 0.2, 0.4, 0.04, 2), 0, C.floor + 0.1, 7.48), at(box(0.42, 0.1, 0.18, 0.03), dx, 2.31, 7.66)]);
		gauges.group.position.set(dx, 2.32, 7.58);
		gauges.group.rotation.x = 0.3;
		part({ id: 'dashboard', label: 'Dashboard and gauges', assembly: 'interior', source: SRC.air, what: 'The dashboard wrapping round the driver under the windscreen: the speedometer and the rev counter before him with a screen between them, the gearbox’s selector and the switches within his reach, the passenger’s side and the shelf over the engine.', moves: 'Its needles show the speed and the engine’s revs.', specs: [['Gauges', 'Speed to 125 km/h, revs to 3,000 rpm']] }, [m(dash, M.dash), gauges.group], { explode: [0, 0.6, 0.5], tag: { text: 'Gauges', at: [dx, 2.38, 7.6], side: 'right', value: () => `${fmt(kmh())} km/h · ${fmt(sim.s.rpm)} rpm` } }, cab);
		const sw = steeringWheelGeometry({ R: 0.24, column: 0.45 });
		const wheel = new THREE.Group();
		wheel.add(m(sw.rim, M.vinyl), m(sw.hub, M.dash), m(sw.column, M.dash));
		wheel.position.set(dx, 2.22, 7.36);
		wheel.rotation.x = 0.95;
		const ped = [];
		for (const [ox, w] of [[0.1, 0.07], [-0.06, 0.09]]) ped.push(cyl([dx + ox, 2.0, 7.66], [dx + ox, C.floor + 0.12, 7.6], 0.008, 8), at(box(w, 0.12, 0.012, 0.004), dx + ox, C.floor + 0.12, 7.58));
		part({ id: 'steering-wheel', label: 'Steering wheel and pedals', assembly: 'interior', source: SRC.air, what: 'The wheel laid back at a bus’s angle on its column, which a shaft carries down through the floor to the steering box; the brake and the accelerator under it (the gearbox needs no clutch pedal).', moves: 'Turned by the driver (held straight here).', specs: [['Diameter', '480 mm']] }, [wheel, m(GEO.merge(ped), M.vinyl)], { explode: [0, 0.6, 0.2] }, cab);
	}

	/* ------------------------------------------------------------ the fifth wheel, the kingpin, the lines */
	{
		const kz = TR.king.z;
		const mount = [];
		for (const sx of [-1, 1]) mount.push(at(box(0.12, 0.04, 1.0, 0.006), sx * 0.385, F.top + 0.02, kz), at(box(0.12, 0.035, 0.18, 0.008), sx * 0.36, F.top + 0.057, kz));
		const fwS = /** @type {THREE.Shape} */ (roundPoly(xz([[-0.435, kz + 0.45], [0.435, kz + 0.45], [0.435, kz - 0.48], [0.19, kz - 0.48], [0.04, kz - 0.02], [-0.04, kz - 0.02], [-0.19, kz - 0.48], [-0.435, kz - 0.48]]), [0.12, 0.12, 0.05, 0.03, 0.02, 0.02, 0.03, 0.05]));
		const plateG = onY(plate(fwS, 0.06, 12), TR.king.y - 0.03);
		const jaws = GEO.merge([at(box(0.06, 0.05, 0.14, 0.01), 0.07, TR.king.y - 0.085, kz), at(box(0.06, 0.05, 0.14, 0.01), -0.07, TR.king.y - 0.085, kz), cyl([0.2, 1.07, kz - 0.1], [0.55, 1.05, kz - 0.15], 0.012, 8), at(box(0.1, 0.03, 0.03, 0.01), 0.58, 1.05, kz - 0.15)]);
		part({ id: 'fifth-wheel', label: 'Fifth wheel', assembly: 'coupling', source: SRC.king, what: 'A greased steel plate on two pedestals that let it rock, bolted to the frame on its mounting plate: the trailer’s kingpin slides up its throat as the tractor backs under, and its jaws close round the pin; the trailer’s front rests on the plate and is pulled by the pin. A handle on its left opens the jaws.', moves: 'Rocks on its pedestals with the road.', drive: 'The trailer’s pin', specs: [['Height', `${Math.round(TR.king.y * 1000)} mm`], ['Lead', `${Math.round((kz - axle.drive) * 1000)} mm ahead of the drive axle`], ['Rated', '20 t on it, 150 kN D-value [inferred]']] }, [m(GEO.merge(mount), R.chassis), m(plateG, R.castIron), m(jaws, R.forged)], { explode: [0, 0.4, 0], tag: { text: 'Fifth wheel', at: [0.43, TR.king.y, kz], side: 'right', value: () => `${tonnes(L.king)} t on it · pulling ${fmt(Math.max(0, L.pull) / 1000)} kN` } });
		// the lines from their hanger on the catwalk behind the cab to the trailer's front wall
		const cat = GEO.merge([at(box(0.98, 0.012, 0.44, 0.004), 0, 1.07, 5.77), at(box(0.04, 0.6, 0.04, 0.008), 0.25, 1.36, 5.95), at(box(0.3, 0.04, 0.05, 0.008), 0.3, 1.64, 5.95)]);
		const ends = /** @type {V3[]} */ ([[0.2, 1.62, 5.93], [0.3, 1.62, 5.93], [0.4, 1.62, 5.93]]);
		const to = /** @type {V3[]} */ ([[0.25, 1.75, T.front + 0.03], [0.4, 1.75, T.front + 0.03], [0.55, 1.75, T.front + 0.03]]);
		part({ id: 'lines', label: 'Trailer lines and catwalk', count: 3, assembly: 'coupling', source: SRC.bags, what: 'The catwalk behind the cab, and three coiled lines from their hanger to the trailer’s front wall: the red one supplies the trailer’s air tanks (cut it and the trailer brakes itself), the yellow one carries the brake pedal’s signal, the black one the lights and the brakes’ electronics.', specs: [['Air', 'Red: supply, 8.5 bar · yellow: control']] }, [m(cat, M.tread), m(coilFrom(ends[0], to[0], 0.04, 0.007, 7), M.lineRed), m(coilFrom(ends[1], to[1], 0.04, 0.007, 7), M.lineYellow), m(coilFrom(ends[2], to[2], 0.045, 0.008, 7), M.lineBlack)], { explode: [0, 0.6, 0] });
	}
	/** the tractor's mudguards over the twins */
	{
		const g = [];
		for (const sx of [-1, 1]) {
			g.push(at(box(0.68, 0.012, 1.2, 0.006), sx * 0.915, 1.08, axle.drive), at(box(0.66, 0.5, 0.008, 0.003), sx * 0.915, 0.62, axle.drive - 0.66), link([sx * F.x, 0.95, axle.drive - 0.3], [sx * 0.62, 1.07, axle.drive - 0.3], 0.04, 0.04));
		}
		part({ id: 'mudguards', label: 'Mudguards', count: 2, assembly: 'chassis', source: SRC.road, what: 'Plastic guards over the twin wheels on stays from the frame, and the flaps behind them that keep the spray off the road behind.', specs: [['Flaps', 'Spray-suppressing [inferred]']] }, [m(GEO.merge(g), M.trim)], { explode: [0, 0.3, -0.3] });
	}

	/* ------------------------------------------------------------ the trailer's chassis */
	const zb = T.axles[1];
	{
		const g = [];
		// the kingpin plate under the front; the kingpin through it
		const kp = /** @type {THREE.Shape} */ (roundPoly(xz([[-1.2, T.front - 0.05], [1.2, T.front - 0.05], [1.2, 2.2], [-1.2, 2.2]]), 0.03));
		g.push(onY(plate(kp, 0.02, 4), TR.king.y + 0.01));
		// the main rails: I-beams, deep behind the gooseneck
		const top = 1.27, low = 0.82;
		for (const sx of [-1, 1]) {
			g.push(onX(plate(zyShape([[T.front - 0.05, TR.king.y + 0.02], [2.2, TR.king.y + 0.02], [1.7, low], [T.rear + 0.08, low], [T.rear + 0.08, top], [T.front - 0.05, top]], 0.01), 0.01, 4), sx * T.beam));
			g.push(at(box(0.15, 0.015, T.front - T.rear - 0.13, 0.004), sx * T.beam, top - 0.0075, (T.front + T.rear) / 2 - 0.015), at(box(0.15, 0.015, 1.7 - T.rear - 0.08, 0.004), sx * T.beam, low + 0.0075, (1.7 + T.rear + 0.08) / 2), link([sx * T.beam, TR.king.y + 0.02, 2.2], [sx * T.beam, low + 0.0075, 1.7], 0.015, 0.15));
			// the outer rails along the floor's edges
			g.push(at(box(0.05, 0.13, T.front - T.rear, 0.006), sx * 1.25, 1.235, (T.front + T.rear) / 2));
		}
		// the cross members under the floor, behind the gooseneck
		for (let z = 2.0; z > T.rear + 0.1; z -= 0.5) g.push(at(box(2.45, 0.1, 0.05, 0.006), 0, 1.22, z));
		// the axles' hangers under the main rails
		for (const z of T.axles) for (const sx of [-1, 1]) g.push(at(box(0.12, 0.2, 0.14, 0.01), sx * T.beam, low - 0.1, z + 0.55));
		part({ id: 'trailer-chassis', label: 'Trailer chassis', assembly: 'trailer', source: SRC.king, what: 'Two welded steel I-beams the trailer’s length, shallow over the tractor’s gooseneck and deep behind it, cross members every half metre out to the floor’s edges; at the front the kingpin plate that rests on the fifth wheel; the axles’ hangers under the beams.', specs: [['Beams', '450 mm deep behind the gooseneck [inferred]'], ['Kingpin to the bogie', `${(TR.king.z - zb).toFixed(2)} m`]] }, [m(GEO.merge(g), R.chassis)], { explode: [0, -0.7, 0] }, trailer);
		const pin = GEO.merge([cyl([0, TR.king.y - 0.085, TR.king.z], [0, TR.king.y + 0.01, TR.king.z], 0.0254, 20), cyl([0, TR.king.y - 0.05, TR.king.z], [0, TR.king.y - 0.035, TR.king.z], 0.037, 20), cyl([0, TR.king.y - 0.002, TR.king.z], [0, TR.king.y + 0.01, TR.king.z], 0.09, 24)]);
		part({ id: 'kingpin', label: 'Kingpin', assembly: 'coupling', source: SRC.king, what: 'A 2-inch forged steel pin under the trailer’s plate, 1.6 m behind its front: the fifth wheel’s jaws close round its neck, and through it the tractor pulls and the trailer turns.', specs: [['Pin', '2" (50.8 mm), ISO 337']] }, [m(pin, R.forged)], { explode: [0, -0.3, 0] }, trailer);
		const fl = /** @type {THREE.Shape} */ (roundPoly(xz([[-1.23, T.front - 0.06], [1.23, T.front - 0.06], [1.23, T.rear + 0.09], [-1.23, T.rear + 0.09]]), 0.004));
		part({ id: 'trailer-floor', label: 'Floor', assembly: 'trailer', source: SRC.eu, what: 'A floor of 28 mm hardwood boards on the cross members, a fork-lift truck’s wheels’ load on any of them; lashing points along its edges.', specs: [['Height', `${Math.round(T.floor * 1000)} mm off the road`], ['Inside', `${(T.front - T.rear - 0.2).toFixed(1)} × 2.46 m`]] }, [m(onY(plate(fl, 0.03, 4), T.floor - 0.015), M.wood)], { explode: [0, 0.3, 0] }, trailer);
		// the landing legs, their gearbox and crank
		const lg = [], foot = [];
		for (const sx of [-1, 1]) {
			const x = sx * 0.66;
			lg.push(at(box(0.11, 1.17 - 0.45, 0.11, 0.008), x, (1.17 + 0.45) / 2, T.legs), link([x, 1.0, T.legs], [sx * T.beam, low + 0.02, T.legs + 0.6], 0.05, 0.05), at(box(0.12, 0.12, 0.2, 0.01), x, 1.15, T.legs));
			foot.push(at(box(0.09, 0.26, 0.09, 0.006), x, 0.34, T.legs), at(box(0.26, 0.035, 0.26, 0.008), x, 0.2, T.legs));
		}
		lg.push(cyl([-0.66, 0.95, T.legs], [0.66, 0.95, T.legs], 0.016, 10), link([-0.72, 0.95, T.legs], [-0.95, 0.85, T.legs - 0.05], 0.025, 0.025), link([-0.95, 0.85, T.legs - 0.05], [-0.95, 0.65, T.legs - 0.05], 0.02, 0.02));
		part({ id: 'landing-legs', label: 'Landing legs', count: 2, assembly: 'trailer', source: SRC.king, what: 'Two telescopic legs under the trailer’s front, joined by a shaft: the crank on the right winds them down through their two-speed gearbox to stand the trailer when the tractor leaves it, and up again to drive.', moves: 'Wound up to drive, down to park.', drive: 'The crank, by hand', specs: [['Lift', '24 t a pair [inferred]']] }, [m(GEO.merge(lg), R.chassis), m(GEO.merge(foot), R.zinc)], { explode: [0, -0.4, 0.3] }, trailer);
		// the side guards and the rear underrun guard, the lights
		const gd = [], lt = [], rd = [], am = [];
		for (const sx of [-1, 1]) {
			for (const y of [0.55, 0.95]) gd.push(at(box(0.03, 0.1, 3.0, 0.005), sx * 1.22, y, -0.35));
			for (const z of [1.1, -0.35, -1.8]) gd.push(link([sx * 1.22, 0.5, z], [sx * 1.22, 1.17, z], 0.05, 0.03));
			gd.push(link([sx * T.beam, low, T.rear + 0.25], [sx * 0.7, 0.5, T.rear + 0.15], 0.06, 0.06));
			lt.push(at(box(0.36, 0.14, 0.05, 0.015), sx * 0.95, 0.66, T.rear + 0.1));
			rd.push(at(box(0.22, 0.11, 0.01, 0.005), sx * 1.0, 0.66, T.rear + 0.07));
			am.push(at(box(0.1, 0.11, 0.01, 0.005), sx * 0.8, 0.66, T.rear + 0.07));
			for (const z of [3.0, 0.0, -3.0, -6.0]) am.push(at(box(0.012, 0.03, 0.07, 0.004), sx * 1.276, 1.2, z));
		}
		gd.push(at(box(2.3, 0.12, 0.1, 0.01), 0, 0.5, T.rear + 0.15));
		// on its front wall, the three heads the tractor's lines plug into
		gd.push(at(box(0.5, 0.14, 0.02, 0.006), 0.4, 1.75, T.front + 0.01));
		for (const x of [0.25, 0.4, 0.55]) gd.push(cyl([x, 1.75, T.front + 0.02], [x, 1.75, T.front + 0.05], 0.028, 16));
		part({ id: 'guards-lights', label: 'Guards and lights', assembly: 'trailer', source: SRC.eu, what: 'The side guards between the landing legs and the axles that keep a cyclist from falling under the wheels; the rear underrun guard that keeps a car from running under the trailer; the tail, brake and indicator lights on it, the amber markers along the sides, and the three heads on its front wall that the tractor’s lines plug into.', specs: [['Rear guard', '~ 550 mm off the road']] }, [m(GEO.merge(gd), M.trim), m(GEO.merge(lt), M.trim), m(GEO.merge(rd), M.red), m(GEO.merge(am), M.amber)], { explode: [0, -0.3, -0.4] }, trailer);
	}

	/* ------------------------------------------------------------ the trailer's axles */
	{
		const beams = [], arms = [], rubber = [], steel = [], damp = [], guards = [];
		for (const z of T.axles) {
			beams.push(at(box(1.76, 0.127, 0.127, 0.012), 0, YT, z));
			for (const sx of [-1, 1]) {
				const x = sx * T.beam;
				arms.push(link([x, 0.62, z + 0.55], [x, YT - 0.08, z], 0.09, 0.07), link([x, YT - 0.08, z], [x, 0.42, z - 0.44], 0.09, 0.07), cyl([x - 0.06, 0.62, z + 0.55], [x + 0.06, 0.62, z + 0.55], 0.045, 16));
				const b = airSpring(x, 0.44, 0.82, z - 0.44, 0.15);
				rubber.push(b.rubber);
				steel.push(b.steel);
				damp.push(cyl([sx * 0.66, YT, z - 0.08], [sx * 0.66, 0.66, z + 0.25], 0.035, 16), cyl([sx * 0.66, 0.66, z + 0.25], [sx * 0.62, 0.72, z + 0.5], 0.016, 10));
			}
		}
		for (const sx of [-1, 1]) guards.push(at(box(0.42, 0.012, T.axles[0] - T.axles[2] + 1.2, 0.006), sx * T.x, 1.12, (T.axles[0] + T.axles[2]) / 2), at(box(0.4, 0.45, 0.008, 0.003), sx * T.x, 0.68, T.axles[2] - 0.62));
		part({ id: 'trailer-axles', label: 'Axles and air suspension', count: 3, assembly: 'running', source: SRC.bags, what: 'Three square steel axle beams, 1.31 m apart, each on two trailing arms from hangers under the main rails; an air bellows behind each axle on each arm carries the load, a levelling valve holding the trailer’s height; a damper beside each bellows; the guards over the wheels.', moves: 'The bellows’ pressure follows the load; the height stays.', drive: 'The road; the air from the tractor', specs: [['Rated', '9 t an axle, 24 t the three [inferred]'], ['Bellows', '6, Ø 300 mm effective [inferred]']] }, [m(GEO.merge(beams), R.chassis), m(GEO.merge(arms), R.forged), m(GEO.merge(rubber), R.bush), m(GEO.merge(steel), R.zinc), m(GEO.merge(damp), R.damper), m(GEO.merge(guards), M.trim)], { explode: [0, -0.5, 0], tag: { text: 'Trailer axles', at: [-T.beam, 0.62, zb - 0.44], side: 'left', value: () => `${tonnes(L.bogie)} t on the three (24 t allowed) · bellows ${fmt(bagP(L.bogie, MASS.unsprung.trailer * 3, 6) / 1e5, 1)} bar` } }, root);
	}

	/* ------------------------------------------------------------ the box and its doors */
	/** @type {ReturnType<typeof hinge>[]} */
	const rearDoors = [];
	{
		const yb = 1.17, W2 = TR.W / 2, tw = 0.03;
		const walls = [];
		for (const sx of [-1, 1]) walls.push(onX(plate(zyShape([[T.front, yb], [T.rear + 0.1, yb], [T.rear + 0.1, T.roof], [T.front, T.roof]], 0.01), tw, 4), sx * (W2 - tw / 2)));
		walls.push(at(slab(2 * W2, tw, T.front - T.rear - 0.1), 0, T.roof - tw / 2, (T.front + T.rear + 0.1) / 2), at(slab(2 * W2, T.roof - yb, tw), 0, (T.roof + yb) / 2, T.front - tw / 2));
		const edges = [];
		for (const sx of [-1, 1]) edges.push(at(box(0.06, 0.06, T.front - T.rear - 0.1, 0.01), sx * (W2 - 0.03), T.roof - 0.03, (T.front + T.rear + 0.1) / 2), at(box(0.06, T.roof - yb, 0.06, 0.01), sx * (W2 - 0.03), (T.roof + yb) / 2, T.front - 0.03), at(box(0.04, 0.1, T.front - T.rear - 0.1, 0.006), sx * (W2 + 0.002), yb + 0.05, (T.front + T.rear + 0.1) / 2));
		edges.push(at(box(2 * W2, 0.06, 0.06, 0.01), 0, T.roof - 0.03, T.front - 0.03));
		part({ id: 'box-walls', label: 'Box walls and roof', assembly: 'box', source: SRC.eu, what: 'Sandwich panels of foam between two glass-fibre skins, 30 mm thick: the two sides, the front wall and the roof, bonded and riveted to aluminium rails along their edges and corners, standing on the floor’s outer rails; light, stiff and smooth to the air.', specs: [['Outside', `${(T.front - T.rear).toFixed(1)} × ${TR.W} × ${T.roof} m`], ['Inside', '13.4 × 2.48 × 2.67 m, ~ 89 m³']] }, [m(GEO.merge(walls), M.box), m(GEO.merge(edges), M.alu)], { explode: [0, 1.2, 0], xray: 'shell' }, trailer);
		// the rear frame: two posts, the header, the sill
		const fr = [];
		for (const sx of [-1, 1]) fr.push(at(box(0.1, T.roof - yb, 0.1, 0.01), sx * (W2 - 0.05), (T.roof + yb) / 2, T.rear + 0.05));
		fr.push(at(box(2 * W2, 0.14, 0.1, 0.01), 0, T.roof - 0.07, T.rear + 0.05), at(box(2 * W2, 0.15, 0.1, 0.01), 0, yb + 0.075, T.rear + 0.05));
		part({ id: 'rear-frame', label: 'Rear frame', assembly: 'box', source: SRC.eu, what: 'A galvanised steel portal at the box’s back: two corner posts carrying the doors’ hinges, the header over the opening and the sill under it, which a fork-lift truck drives over.', specs: [['Opening', `${(2 * W2 - 0.2).toFixed(2)} × ${(T.roof - 0.14 - yb - 0.15).toFixed(2)} m`]] }, [m(GEO.merge(fr), R.zinc)], { explode: [0, 0.3, -0.6] }, trailer);
		// the two doors, hinged at the posts' outer back edges, swinging round to the sides
		const dy0 = yb + 0.16, dy1 = T.roof - 0.15, zh = T.rear - 0.05;
		for (const sx of /** @type {(1 | -1)[]} */ ([1, -1])) {
			const id = sx > 0 ? 'rear-door-left' : 'rear-door-right';
			const h = hinge(trailer, { at: [sx * (W2 + 0.015), 0, zh], axis: 'y', max: -sx * ((260 * Math.PI) / 180), name: id });
			const leaf = at(box(W2 + 0.01, dy1 - dy0, 0.04, 0.008), -sx * (W2 + 0.01) / 2, (dy0 + dy1) / 2, 0.03);
			const hard = [];
			for (const y of [dy0 + 0.15, dy0 + 0.9, dy1 - 0.9, dy1 - 0.15]) hard.push(at(box(0.16, 0.06, 0.02, 0.005), -sx * 0.06, y, 0.0), cyl([0, y - 0.04, -0.005], [0, y + 0.04, -0.005], 0.012, 10));
			const bars = [];
			for (const bx of [0.35, 0.95]) {
				bars.push(cyl([-sx * bx, dy0 - 0.08, -0.012], [-sx * bx, dy1 + 0.08, -0.012], 0.014, 10));
				for (const y of [dy0 + 1.0, dy1 - 1.0]) bars.push(at(box(0.04, 0.05, 0.02, 0.006), -sx * bx, y, -0.006));
				bars.push(at(box(0.03, 0.18, 0.02, 0.006), -sx * (bx + 0.03), (dy0 + dy1) / 2, -0.03));
			}
			kit.part(h.pivot, { id, label: sx > 0 ? 'Rear door, left' : 'Rear door, right', assembly: 'box', source: SRC.eu, what: 'A sandwich door on four hinges at its corner post, held shut by two locking bars whose cams turn into keepers in the header and the sill; unlocked, it swings out through 260° to lie flat against the box’s side, where a hook holds it.', moves: 'Swings 260° on its hinges.', drive: 'By hand (the Rear doors slider)', specs: [['Leaf', `${Math.round((W2 + 0.01) * 1000)} × ${Math.round((dy1 - dy0) * 1000)} mm`]] }, { explode: [sx * 0.3, 0, -0.7] }, trailer);
			h.pivot.add(m(leaf, M.box), m(GEO.merge(hard), R.zinc), m(GEO.merge(bars), R.zinc));
			rearDoors.push(h);
		}
	}

	/* ------------------------------------------------------------ the solver and what it moves */
	const ctl = {
		speed: { label: 'Speed asked', min: 0, max: 90, value: speed, step: 1, unit: 'km/h', ends: /** @type {[string, string]} */ (['Standing', '90 km/h']) },
		grade: { label: 'Grade', min: -10, max: 25, value: grade, step: 0.5, unit: '%', ends: /** @type {[string, string]} */ (['Downhill', 'Steep climb']) },
		load: { label: 'Payload', min: 0, max: VEHICLE.payload, value: Math.min(load, VEHICLE.payload), step: 100, unit: 'kg', ends: /** @type {[string, string]} */ (['Empty', '40 t gross']) },
		tilt: { label: 'Cab tilted', min: 0, max: 1, value: tilt, step: 0.01, digits: 2, ends: /** @type {[string, string]} */ (['Down', 'Tilted 60°']) },
		doors: { label: 'Cab doors', min: 0, max: 1, value: doors, step: 0.01, digits: 2, ends: /** @type {[string, string]} */ (['Shut', 'Open']) },
		rear: { label: 'Rear doors', min: 0, max: 1, value: rear, step: 0.01, digits: 2, ends: /** @type {[string, string]} */ (['Shut', 'Open to the sides']) }
	};
	const OVER = 60000 - VEHICLE.kerb, RAMP = 0.3;
	/** what the driver is asked for: the sliders, or the break's overload up its ramp @param {{ broken: boolean }} env */
	const input = (env) => ({ vSet: ctl.speed.value * KMH, grade: env.broken ? RAMP : ctl.grade.value / 100, load: env.broken ? OVER : ctl.load.value });
	sim.settle(input({ broken: false }));
	for (let k = 0; k < 200; k++) air.step(0.05, { n: sim.s.rpm, mf: (sim.s.fuel * 0.835) / 3600 });
	const sag = { f: 0 };
	let turboAng = 0;
	const pa = new THREE.Vector3(), ax = new THREE.Vector3(1, 0, 0), q = new THREE.Quaternion();
	const rTrail = TTYRE.r * 0.965;
	kit.onTick((dt, env) => {
		const inp = input(env);
		sim.step(dt, inp);
		const s = sim.s;
		const dead = s.stalled && !s.running;
		air.step(dt, { n: dead ? 0 : s.rpm, mf: dead ? 0 : (s.fuel * 0.835) / 3600 });
		L = axleLoads(inp.load, s.stalled ? 0 : s.a, s.road.th);
		// the front springs' sag from the kerb's ride height, stiffened tenfold on their bump stops
		const x = (L.steer - KERB.steer) / 2 / KF;
		sag.f += ((x > TRAVEL_F ? TRAVEL_F + (x - TRAVEL_F) / 10 : x) - sag.f) * clamp(dt / 0.25);
		const wb = axle.steer - axle.drive, al = sag.f / wb;
		body.rotation.x = al;
		body.position.y = -sag.f + al * axle.steer;
		body.updateMatrix();
		for (const lp of springs) lp.set(CAMBER - sag.f);
		// the trailer: its front on the fifth wheel, its back held at its height by the bellows
		const kp = inFrame(body, [0, TR.king.y, TR.king.z]);
		const at2 = (TR.king.y - kp[1]) / (TR.king.z - zb);
		trailer.rotation.x = at2;
		trailer.position.y = at2 * zb;
		// the wheels
		for (const w of [...front, ...drive]) w.set(s.wheelAng);
		for (const w of trail) w.set((s.wheelAng * VEHICLE.r) / rTrail);
		crown.rotation.x = shafts.rotation.x = s.wheelAng;
		// the engine and the turbo (the turbo shown 2,000 times slower)
		turboAng += (air.s.w / 2000) * dt;
		engine.update({ a: s.engAng, ap: s.propAng, slipping: s.launch, gear: s.gear, turboAng, gate: air.s.gate, fire: dead ? 0 : clamp(air.s.q / 300), running: !dead });
		shaft.set([inFrame(body, engine.points.out), PINION], s.propAng);
		// the cab on its hinges, the ram between the frame and the cab
		const th = TILT * clamp(ctl.tilt.value);
		cabPivot.rotation.x = th;
		q.setFromAxisAngle(ax, th);
		pa.set(0, ramB[1] - H[1], ramB[2] - H[0]).applyQuaternion(q);
		const B = /** @type {V3} */ ([ramB[0], H[1] + pa.y, H[0] + pa.z]);
		const len = Math.hypot(B[1] - ramA[1], B[2] - ramA[2]);
		aim(ram.body, ramA, B, false);
		ram.body.scale.set(1, Math.min(0.32, len), 1);
		aim(ram.rod, B, ramA, false);
		ram.rod.scale.set(1, Math.max(0.05, len - 0.02), 1);
		const kd = clamp(ctl.doors.value);
		for (const d of cabDoors) d.set(kd);
		const kr = clamp(ctl.rear.value);
		for (const d of rearDoors) d.set(kr);
		gauges.set([kmh(), s.rpm]);
		// the hero and its words
		const r = lab.read;
		const lug = !s.stalled && s.theta > 0.97 && s.a < -0.05;
		r.value = Math.max(0, s.Pw) / 1000;
		r.bad = s.stalled || s.spin || (lug && s.gear === 1);
		r.state = s.stalled
			? s.why === 'grip'
				? env.broken
					? `stopped, the drive wheels spinning: 60 t up a ${RAMP * 100} % ramp`
					: 'stopped: the drive wheels spin'
				: env.broken
					? `stalled: 60 t up a ${RAMP * 100} % ramp`
					: 'stalled: more than first gear can pull'
			: inp.vSet < 0.05 && s.v < 0.05
				? 'standing, idling in neutral'
				: s.spin
					? `the drive wheels slipping in ${ordinal(s.gear)}: the climb takes all their grip`
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
			? s.why === 'grip'
				? `the drive axle carries ${tonnes(L.drive)} t and its tyres grip at most ${fmt(s.can / 1000)} kN, the ramp and the road take ${fmt(s.need / 1000)} kN · ${env.broken ? 'take the break back' : 'move a slider'} to start again`
				: `first gear gives at most ${fmt(s.can / 1000)} kN at the wheels, the hill and the road take ${fmt(s.need / 1000)} kN · ${env.broken ? 'take the break back' : 'move a slider'} to start again`
			: `${fmt(kmh())} km/h · ${fmt(s.rpm)} rpm · ${fmt(Math.max(0, s.Pe) / 1000)} kW at the flywheel · ${fmt(air.s.boost / 1e5, 2)} bar boost · the road takes ${fmt(s.road.F / 1000, 1)} kN (rolling ${fmt(s.road.roll / 1000, 1)}, climbing ${fmt(s.road.climb / 1000, 1)}, air ${fmt(s.road.air / 1000, 1)}) · ${s.v > 0.5 ? `${fmt(s.l100, 1)} L/100 km` : `${fmt(s.fuel, 1)} L/h`}`;
	});
	const phase = (/** @type {number} */ t0, /** @type {number} */ a, /** @type {number} */ b) => ease.io(clamp((t0 - a) / (b - a)));
	/** @type {import('$lib/assets/parts.js').Lab} */
	const lab = {
		hero: { label: 'Power at the wheels', unit: 'kW', max: 400, digits: 0 },
		read: { value: 0, state: '', sub: '', bad: false },
		controls: ctl,
		moves: {
			tilt: { label: 'Tilt the cab', seconds: 12, note: 'Stop, tilt the cab forward over the engine, lower it again', at: (u) => ({ speed: 0, tilt: phase(u * 12, 1, 5) - phase(u * 12, 8, 11.5) }) },
			rear: { label: 'Open the doors', seconds: 12, note: 'Stop, swing both rear doors round to the sides, close them', at: (u) => ({ speed: 0, rear: phase(u * 12, 1, 5) - phase(u * 12, 8, 11.5) }) }
		},
		how: {
			text: `A driver holds the speed asked: the road takes a force to roll the twelve tyres, to lift the truck up the grade and to push the air aside, and holding the speed takes that force times the speed at the wheels, more through the gearbox’s and the axle’s losses at the engine. The gearbox’s control unit picks the highest of its twelve gears that gives that push without the engine running under 1,000 rpm, and the engine’s full-load curve says how much it can give; downhill it brakes when even the shut throttle pushes too much. Only the drive axle’s twins push, and they push at most three quarters of their load: the trailer’s weight rests partly on the fifth wheel, and climbing and pulling move load back, off the kingpin and the steer axle and onto the trailer’s axles and the drive axle; past their grip they spin and the truck stops. The engine’s fuel comes from its work and its friction; its fuel and speed drive the turbocharger’s model, which gives the boost, the turbo’s speed and the gas before the turbine. The bellows hold the frame and the trailer at their height, so their pressure follows the load; the front springs sink by the load over their rate. Not modelled: the grip of the steer and trailer axles, the turbo’s lag on the engine’s torque, the tyres’ heat. The cab’s tilt and the doors are moved by their sliders alone. Shown slowed: the wheels 10 times, the engine, the gearbox and the propshaft 40 times, the turbo 2,000 times.`,
			eqs: [
				`F = m g (Crr cos θ + sin θ) + ½ ρ Cd A v²      m = ${fmt(VEHICLE.kerb)} kg + payload, Crr = 0.0055, Cd A = 5.6 m²`,
				'P_wheels = F v        P_engine = P_wheels / η      η = 0.92',
				`n = (v / r) · i_gear · i_axle      r = ${VEHICLE.r.toFixed(3)} m, i = ${GEARS[0].toFixed(2)} … 1.00, i_axle = 2.53`,
				'T_engine ≤ T_full(n)      2,300 N·m from 1,000 to 1,400 rpm, 338 kW from 1,400 to 1,900 rpm',
				`F_drive ≤ μ N_drive      μ = ${MU} on dry asphalt`,
				'N_king = [m_t g cos θ (z_t − z_bogie) − m_t (a + g sin θ)(h_t − h_king)] / (z_king − z_bogie)',
				'N_steer = [m_c g cos θ (z_c − z_drive) + N_king (z_king − z_drive) − m_t (a + g sin θ) h_king − m_c (a + g sin θ) h_c] / wheelbase',
				'p_bellows = (N_axle − m_unsprung g) / (n A)      A = 0.071 m² (Ø 300 mm)',
				'fuel = (T + T_friction) ω · 172 g/kWh      T_friction from 1.3 bar',
				'turbo: Δh = μ U², PR = (1 + η_c Δh / c_p T₀)^3.5, J ω dω/dt = η_m P_t − ṁ_a Δh'
			]
		},
		breakIt: {
			label: `Overload it to 60 t up a ${RAMP * 100} % ramp`,
			run: () => {},
			reset: () => sim.restart()
		},
		cut: { a: [1, 0, 0], b: [0, 1, 0], center: [0, 1.0, 0], reach: 0.5 }
	};
	const asset = kit.seal({ lab });
	// at rest: every moving part where the solver's first moment puts it
	asset.tick(0, { broken: false, time: 0, slow: 0, cut: 0, xray: 0 });
	return root;
}
