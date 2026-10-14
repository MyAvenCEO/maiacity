/*
 * THE TRAVEL VAN — the old minibus of the MaiaCity V1 intro (the Thing: $lib/models/wayside.js `travelVan`, its inside:
 * $lib/maiacity-v1/van.js) built as a Machine at AirSup's realism ($lib/assets): every part a mechanic would name as
 * its own solid in its measured material, the engine's insides there to cut open, the doors that open, and a solver
 * that drives it on the road on real equations. The pieces any wheeled machine shares (the wheels, the engine, the
 * suspension, the solver) are in ./vehicle.js.
 *
 * ---------------------------------------------------------------- research (AirSup's step 1)
 * The machine: a semi-forward-control minibus of the 1980s–90s, 5.2 m over its bumpers, 1.9 m wide, 2.13 m to its roof
 * (2.8 m to the top of the bags tied on it), a 3.15 m wheelbase; two-tone paint, cream below the waist and blue above,
 * faded and rusting through at the sills and the arches; a short nose holding the radiator, the battery and the air
 * filter; the engine under a cover between the two front seats (the "doghouse"), driving the rear wheels; a sliding
 * door on the left, two hinged front doors, eleven seats in three rows; a roof rack with the bags and a spare tyre.
 * Running gear as such vans had it [inferred, and said so on each card]: a ladder frame under a steel body, double
 * wishbones and coil springs in front with a rack-and-pinion, a live axle on leaf springs at the back, discs in front
 * and drums behind, 185/80 R14 C tyres on 5½J steel wheels; a 2.4 L four-cylinder indirect-injection diesel (92 × 90
 * mm, 22 : 1), 55 kW at 4,000 rpm and 152 N·m at 2,400; a 5-speed gearbox (4.00 · 2.20 · 1.40 · 1.00 · 0.80), a
 * two-piece propshaft and a 4.30 axle; 1,950 kg ready to go with its driver and its roof load, 1,000 kg payload.
 * The physics: the road's load F = m g Crr cos θ + m g sin θ + ½ ρ Cd A v², the power at the wheels P = F v (the one
 * number), the engine's P / η through its gear; the engine's torque from its full-load curve, the gear the driver
 * picks, the fuel from the engine's indicated work (a Willans line); the axles' loads with the climb's and the
 * push's transfer, the springs' sag. The inputs: the speed asked, the grade, the load, the doors. The break: two and a
 * half times its payload up a 35 % grade: even first gear gives less than the hill takes, the speed falls, the
 * engine lugs and stalls.
 * Sources: the road-load equation and rolling resistance (SAE J2452 for the coefficient's range, Wong's "Theory of
 * Ground Vehicles"), drag areas of vans (Hucho, "Aerodynamics of Road Vehicles"), Heywood's "Internal Combustion
 * Engine Fundamentals" for friction and consumption; the tyre's measures from its ETRTO marking. No maker is named.
 *
 * In the asset's frame (./parts.js): metres, the ground at y 0, the front towards +z, +x the sliding door's side (the
 * left: the van drives on the left, its wheel on the right).
 */
import * as THREE from 'three';
import { GEO, MAT, clamp, fmt } from '$lib/assets/kit.js';
import { assetKit } from '$lib/assets/parts.js';
import { G, at, bar, box, circle, cluster, cyl, doorPanels, doubleWishbone, edgePanel, engineMaterials, ext, frameY, halfCut, hinge, hose, inFrame, inlineEngine, insetEdges, ladderFrame, latheX, latheY, latheZ, liveAxle, onEdge, onX, onY, ordinal, outsetRect, plate, propshaft, rrect, roundHole, roundPoly, seatGeometry, slab, slide, steeringRack, steeringWheelGeometry, tyreSize, vehicleMaterials, vehicleSolver, wheelCorner, xz, zy, zyHole, zyRect, zyShape } from './vehicle.js';

/** @typedef {[number, number, number]} V3 */
/** @typedef {[number, number]} V2 */

/** the van's measures (m): its body's width, its ends, the axles, its floor, waist and roof */
export const VAN = {
	W: 1.9,
	front: 2.5,
	rear: -2.45,
	axle: { front: 1.6, rear: -1.55, x: 0.82 },
	floor: 0.62,
	sill: 0.42,
	waist: 1.3,
	roof: 2.13,
	/** the driver's seat (x, z) and the steering wheel's hub */
	driver: { x: -0.56, z: 1.02 },
	wheel: /** @type {V3} */ ([-0.56, 1.42, 1.44]),
	/** the sliding door's opening and the front doors' (z, y) */
	slider: { z0: 0.22, z1: 1.24, y0: 0.5, y1: 2.0 },
	fdoor: { z0: 1.3, hinge: 2.14, y0: 0.8, y1: 2.0 }
};
const TYRE = tyreSize(185, 80, 14);

const SOURCES = [
	{ label: 'Road load and rolling resistance (Wong, Theory of Ground Vehicles)', url: 'https://en.wikipedia.org/wiki/Rolling_resistance' },
	{ label: 'Drag of road vehicles (Hucho)', url: 'https://en.wikipedia.org/wiki/Automobile_drag_coefficient' },
	{ label: 'Engine friction and fuel (Heywood, IC Engine Fundamentals)', url: 'https://en.wikipedia.org/wiki/Brake-specific_fuel_consumption' },
	{ label: 'Tyre markings (ETRTO)', url: 'https://en.wikipedia.org/wiki/Tire_code' },
	{ label: 'Leaf and coil suspension', url: 'https://en.wikipedia.org/wiki/Leaf_spring' },
	{ label: 'Machine skill kit (AirSup, MIT)', url: 'https://github.com/AirsupHQ/machine-skill' }
];
const SRC = { road: SOURCES[0].label, air: SOURCES[1].label, eng: SOURCES[2].label, tyre: SOURCES[3].label, susp: SOURCES[4].label };

const ASSEMBLIES = /** @type {import('$lib/actors/parts.js').Assembly[]} */ ([
	{ id: 'chassis', label: 'Chassis and suspension', note: 'The ladder frame the body sits on; double wishbones and coil springs in front with the rack-and-pinion, a live axle on leaf springs behind.', out: [0, -0.7, 0] },
	{ id: 'wheels', label: 'Wheels and brakes', note: 'Four 185/80 R14 C tyres on steel wheels; vented discs and callipers in front, drums behind.', out: [0.5, -0.2, 0] },
	{ id: 'engine', label: 'Engine', note: 'A 2.4 L four-cylinder diesel under the cover between the front seats, 55 kW and 152 N·m.', out: [0, 0.1, 0] },
	{ id: 'drivetrain', label: 'Gearbox and drive', note: 'The clutch, the 5-speed gearbox, the two-piece propshaft and the rear axle’s crown wheel and pinion.', out: [0, -0.4, -0.3] },
	{ id: 'services', label: 'Cooling, fuel and power', note: 'The radiator and its fan in the nose, the battery and the air filter beside it, the fuel tank under the floor, the exhaust.', out: [0, -0.35, 0.2] },
	{ id: 'body', label: 'Body', note: 'The steel body in two tones on the frame: its sides, nose, roof and back, the floor, the glass.', out: [0, 1.0, 0] },
	{ id: 'doors', label: 'Doors', note: 'The sliding door on the left and the two front doors, each on its rails or hinges.', out: [0.6, 0.4, 0] },
	{ id: 'cab', label: 'Cab and seats', note: 'The dashboard and its gauges, the steering wheel and pedals, the engine’s cover, eleven seats in three rows.', out: [0, 0.6, 0] },
	{ id: 'roof', label: 'Roof rack and load', note: 'The rack on the roof’s gutters and what is tied on it: three bags, a sack of rice and a spare tyre.', out: [0, 1.6, 0] }
]);
const STEPS = ['Weld the frame and hang the suspension, the axle and the steering on it', 'Bolt on the wheels and brakes', 'Drop in the engine on its mounts', 'Bolt on the gearbox; fit the propshaft and the axle’s gears', 'Fit the radiator, battery, fuel tank and exhaust', 'Lower the body onto the frame; fit the glass', 'Hang the doors', 'Fit the dashboard, the steering wheel, the seats', 'Bolt on the roof rack and tie the load on'];

/** the van's paint and trim (linear colours, measured where AirSup has them) */
function materials() {
	// the two tones: one paint whose map is cream below the waist and blue above, by a second set of uvs from height
	const tones = new THREE.DataTexture(new Uint8Array([194, 175, 133, 255, 29, 65, 97, 255]), 1, 2, THREE.RGBAFormat);
	tones.magFilter = tones.minFilter = THREE.NearestFilter;
	tones.wrapS = tones.wrapT = THREE.ClampToEdgeWrapping;
	tones.channel = 1;
	tones.needsUpdate = true;
	const paint = MAT.paint({ color: [1, 1, 1], roughness: 0.5, clearcoat: 0.12, clearcoatRoughness: 0.5 });
	paint.map = tones;
	return {
		paint,
		blue: MAT.paint({ color: [0.114, 0.254, 0.381], roughness: 0.5, clearcoat: 0.12, clearcoatRoughness: 0.5 }),
		cream: MAT.paint({ color: [0.76, 0.686, 0.521], roughness: 0.52, clearcoat: 0.1, clearcoatRoughness: 0.5 }),
		rust: MAT.paint({ color: [0.254, 0.069, 0.019], roughness: 0.95, clearcoat: 0, finish: 'cast' }),
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
		fabric: MAT.satin({ color: [0.2, 0.09, 0.045], roughness: 0.95, finish: 'cast' }),
		fabricDark: MAT.satin({ color: [0.06, 0.04, 0.03], roughness: 0.95, finish: 'cast' }),
		vinyl: MAT.plastic({ color: [0.035, 0.035, 0.038], roughness: 0.62 }),
		dash: MAT.plastic({ color: [0.05, 0.048, 0.045], roughness: 0.7 }),
		card: MAT.plastic({ color: [0.32, 0.29, 0.25], roughness: 0.85 }),
		dial: MAT.satin({ color: [0.015, 0.015, 0.018], roughness: 0.4 }),
		white: MAT.plastic({ color: [0.85, 0.85, 0.82], roughness: 0.4 }),
		needle: MAT.plastic({ color: [0.85, 0.22, 0.02], roughness: 0.3 }),
		rack: MAT.paint({ color: [0.043, 0.043, 0.045], roughness: 0.55, clearcoat: 0.2, metalness: 0.4 }),
		bagRed: MAT.satin({ color: [0.33, 0.043, 0.028], roughness: 0.92, finish: 'cast' }),
		bagGreen: MAT.satin({ color: [0.078, 0.147, 0.043], roughness: 0.92, finish: 'cast' }),
		bagBlue: MAT.satin({ color: [0.028, 0.078, 0.195], roughness: 0.92, finish: 'cast' }),
		sack: MAT.satin({ color: [0.686, 0.604, 0.402], roughness: 0.98, finish: 'cast' }),
		strap: MAT.satin({ color: [0.6, 0.45, 0.04], roughness: 0.8 }),
		tank: MAT.paint({ color: [0.05, 0.05, 0.055], roughness: 0.6 }),
		battery: MAT.plastic({ color: [0.02, 0.02, 0.022], roughness: 0.5 }),
		lead: MAT.steel({ color: [0.42, 0.42, 0.44], roughness: 0.5, finish: 'cast' }),
		core: MAT.aluminium({ color: [0.55, 0.56, 0.57], roughness: 0.6 }),
		silencer: MAT.steelDark({ color: [0.2, 0.17, 0.15], roughness: 0.7 }),
		filterBox: MAT.plastic({ color: [0.03, 0.03, 0.035], roughness: 0.55 })
	};
}

// ---------------------------------------------------------------- the body's panels

/**
 * The side profile of the body, (z, y) anticlockwise from its rear bottom: the sill with the two wheel arches cut up
 * into it, the nose, the bonnet, the windscreen, the roof, the back. Each edge's radius: how far its panel's rounded
 * edge reaches round onto the side (0 along the sill and arches).
 * @returns {{ pts: V2[], r: number[], seg: boolean[] }}
 */
function profile() {
	const { axle, sill, front, rear, roof } = VAN;
	const yw = TYRE.r - 0.008, Ra = 0.43;
	/** @type {V2[]} */
	const pts = [[rear, sill]];
	/** @type {number[]} */
	const r = [];
	/** @type {boolean[]} */
	const seg = [];
	const arch = (/** @type {number} */ zc) => {
		const a0 = Math.PI - Math.asin((sill - yw) / Ra), a1 = Math.asin((sill - yw) / Ra);
		for (let k = 0; k <= 14; k++) {
			const a = a0 + ((a1 - a0) * k) / 14;
			pts.push([zc + Ra * Math.cos(a), yw + Ra * Math.sin(a)]);
		}
	};
	arch(axle.rear);
	arch(axle.front);
	/** the front, the roof and the back, each point the start of an edge with its radius */
	const ends = /** @type {V2[]} */ ([[front - 0.04, sill], [front, 0.95], [front - 0.01, 1.42], [front - 0.07, 1.49], [2.2, 1.53], [1.98, 2.05], [1.88, roof], [rear + 0.07, roof], [rear, roof - 0.07]]);
	const er = [0.1, 0.1, 0.1, 0.1, 0.08, 0.09, 0.09, 0.07, 0.07];
	const k0 = pts.length;
	pts.push(...ends);
	for (let k = 0; k < pts.length; k++) {
		r.push(k < k0 ? 0 : er[k - k0]);
		seg.push(k >= k0);
	}
	return { pts, r, seg };
}

/** give a body panel's vertices their second uvs from their height, so the two-tone paint changes at the waist @param {THREE.BufferGeometry} g @param {number} [dy] its height's offset from the body's frame */
function tone(g, dy = 0) {
	const p = g.attributes.position, uv = new Float32Array(p.count * 2);
	for (let i = 0; i < p.count; i++) {
		uv[i * 2] = 0.5;
		uv[i * 2 + 1] = 0.5 + (p.getY(i) + dy - VAN.waist) * 200;
	}
	g.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
	return g;
}

// ---------------------------------------------------------------- the van on the road

/** the van as the solver runs it [inferred where marked in the research] */
export const VEHICLE = /** @type {import('./vehicle.js').Vehicle} */ ({
	kerb: 1950,
	payload: 1000,
	Crr: 0.011,
	CdA: 1.62,
	r: TYRE.r * 0.97,
	eta: 0.9,
	gears: [4.0, 2.2, 1.4, 1.0, 0.8],
	final: 4.3,
	engine: { rpm: [700, 1000, 1500, 2000, 2400, 3000, 3600, 4000, 4400], nm: [75, 108, 136, 148, 152, 147, 139, 131, 70], idle: 780, stall: 560, max: 4400, up: 3600, down: 1350, launch: 1250, Vd: 2.39e-3, fmep: 1.6e5, bsfc: 200, fuel: 'diesel', J: 0.28 },
	Jw: 1.0,
	wheels: 4,
	axles: { wb: VAN.axle.front - VAN.axle.rear, h: 0.85, front: 0.5, loadFront: 0.35, k: [32000, 52000], travel: [0.08, 0.1] }
});
const KMH = 1 / 3.6;

/**
 * The travel van: a root at its real size, every part its own, its solver driving it.
 * @param {{ speed?: number, grade?: number, load?: number, doors?: number }} [o] the speed asked (km/h), the grade (%),
 *   the load in it (kg, people and bags), how far its doors are open (0 shut … 1 open)
 * @returns {THREE.Group}
 */
export function van({ speed = 80, grade = 0, load = 600, doors = 0 } = {}) {
	const root = new THREE.Group();
	root.name = 'Travel van';
	const M = materials(), R = vehicleMaterials(), E = engineMaterials();
	const kit = assetKit(root, { assemblies: ASSEMBLIES, steps: STEPS, sources: SOURCES });
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
	const { W, axle, floor } = VAN, X = W / 2;
	const yw = TYRE.r - 0.008;
	const sim = vehicleSolver(VEHICLE);
	const kmh = () => sim.s.v * 3.6;

	/* ------------------------------------------------------------ the frame */
	const rails = /** @type {V2[]} */ ([[2.38, 0.54], [-2.3, 0.54]]);
	{
		const g = [ladderFrame({ x: 0.45, w: 0.06, h: 0.12, t: 0.004, path: rails, cross: [2.3, -0.45, -1.02, -2.22] })];
		// the front suspension's crossmember under the engine's nose, the gearbox's dropped crossmember, the mounts' shelves
		g.push(at(box(0.9, 0.07, 0.1, 0.01), 0, 0.3, axle.front), at(box(0.05, 0.06, 0.42, 0.008), 0.3, 0.27, axle.front), at(box(0.05, 0.06, 0.42, 0.008), -0.3, 0.27, axle.front));
		for (const sx of [-1, 1]) g.push(at(box(0.06, 0.18, 0.08, 0.006), sx * 0.43, 0.39, axle.front), at(box(0.08, 0.02, 0.14, 0.004), sx * 0.53, 0.595, axle.front), at(box(0.04, 0.12, 0.05, 0.004), sx * 0.5, 0.53, axle.front + 0.15), at(box(0.04, 0.12, 0.05, 0.004), sx * 0.5, 0.53, axle.front - 0.15));
		g.push(at(box(0.9, 0.05, 0.08, 0.008), 0, 0.345, 0.46), at(box(0.05, 0.14, 0.06, 0.006), 0.42, 0.42, 0.46), at(box(0.05, 0.14, 0.06, 0.006), -0.42, 0.42, 0.46));
		for (const sx of [-1, 1]) g.push(at(box(0.08, 0.012, 0.1, 0.003), sx * 0.375, 0.494, 1.27), at(box(0.012, 0.05, 0.1, 0.003), sx * 0.418, 0.52, 1.27));
		for (const sx of [-1, 1]) g.push(at(box(0.08, 0.04, 0.06, 0.006), sx * 0.39, 0.575, -1.3));
		// its bump stops over the axle
		for (const sx of [-1, 1]) g.push(at(box(0.06, 0.05, 0.06, 0.012), sx * 0.45, 0.455, axle.rear));
		part({ id: 'frame', label: 'Ladder frame', assembly: 'chassis', source: SRC.susp, what: 'Two box-section steel rails the length of the van, joined by crossmembers: everything hangs from it, and the body sits on it on rubber mounts. A dropped crossmember carries the front suspension under the engine’s nose, another the gearbox’s tail.', specs: [['Rails', '120 × 60 × 4 mm box [inferred]'], ['Track of rails', '900 mm']] }, [m(GEO.merge(g), R.chassis)], { explode: [0, -0.6, 0] });
	}

	/* ------------------------------------------------------------ the wheels */
	const tagWheel = (/** @type {string} */ which) => ({ text: `Wheel, ${which}`, at: /** @type {V3} */ ([0.12, 0.2, 0]), side: /** @type {'left'} */ ('left'), value: () => (which.startsWith('front') ? `${fmt((sim.s.v / VEHICLE.r) * 9.549)} rpm · ${fmt(sim.s.loadF / G)} kg on it` : `${fmt((sim.s.v / VEHICLE.r) * 9.549)} rpm · ${fmt(sim.s.loadR / G)} kg on it`) });
	const wheelOpts = { size: TYRE, rimW: 5.5 * 0.0254, et: 0.03, rim: /** @type {'steel'} */ ('steel'), studs: 5, pcd: 0.13, M: R, assembly: 'wheels', source: SRC.tyre, capMat: M.chrome };
	const corners = {
		fl: wheelCorner(kit, { ...wheelOpts, id: 'fl', label: 'front left', at: [axle.x, yw, axle.front], side: 1, brake: 'disc', disc: { r: 0.128, rIn: 0.08, t: 0.022 }, steers: true, arm: 1, drive: 'The road; steered by the knuckle', tag: tagWheel('front left') }),
		fr: wheelCorner(kit, { ...wheelOpts, id: 'fr', label: 'front right', at: [-axle.x, yw, axle.front], side: -1, brake: 'disc', disc: { r: 0.128, rIn: 0.08, t: 0.022 }, steers: true, arm: 1 }),
		rl: wheelCorner(kit, { ...wheelOpts, id: 'rl', label: 'rear left', at: [axle.x, yw, axle.rear], side: 1, brake: 'drum', drum: { r: 0.127, depth: 0.075 }, drive: 'The half-shaft, from the differential', tag: tagWheel('rear left') }),
		rr: wheelCorner(kit, { ...wheelOpts, id: 'rr', label: 'rear right', at: [-axle.x, yw, axle.rear], side: -1, brake: 'drum', drum: { r: 0.127, depth: 0.075 }, drive: 'The half-shaft, from the differential' })
	};

	/* ------------------------------------------------------------ the suspension and the steering */
	const front = /** @type {const} */ (['fl', 'fr']).map((id) => {
		const sx = id === 'fl' ? 1 : -1;
		return doubleWishbone(kit, {
			id,
			label: id === 'fl' ? 'front left' : 'front right',
			corner: corners[id],
			body,
			upper: [[sx * 0.5, 0.53, axle.front + 0.15], [sx * 0.5, 0.53, axle.front - 0.15]],
			lower: [[sx * 0.3, 0.22, axle.front + 0.18], [sx * 0.3, 0.22, axle.front - 0.18]],
			top: [sx * 0.53, 0.585, axle.front],
			rack: [sx * 0.36, 0.33, axle.front + 0.24],
			coil: { R: 0.052, wire: 0.0105, turns: 5, k: VEHICLE.axles.k[0] },
			M: R,
			assembly: 'chassis',
			source: SRC.susp,
			tag: id === 'fl' ? { text: 'Front spring', at: [0, 0.3, 0], side: 'left', value: () => `sunk ${fmt(sim.s.sagF * 1000)} mm${sim.s.sagF > VEHICLE.axles.travel[0] ? ' · on its bump stop' : ''}` } : undefined
		});
	});
	steeringRack(kit, { parent: body, y: 0.33, z: axle.front + 0.24, half: 0.45, pinion: -0.3, shaft: [[-0.3, 0.38, axle.front + 0.25], [-0.42, 0.66, axle.front + 0.2], [-0.56, 1.0, 1.72]], M: R, assembly: 'chassis', source: SRC.susp });
	const rearAxle = liveAxle(kit, {
		body,
		z: axle.rear,
		y: yw,
		hub: axle.x - 0.02,
		springX: 0.45,
		over: false,
		leaf: { L: 1.2, w: 0.06, t: 0.008, n: 5, camber: 0.075 },
		hanger: 0.48,
		dampers: [[0.39, 0.575, -1.3], [-0.39, 0.575, -1.3]],
		ratio: VEHICLE.final,
		rate: VEHICLE.axles.k[1],
		M: R,
		E,
		assembly: 'drivetrain',
		springs: 'chassis',
		source: SRC.susp,
		tag: { text: 'Rear springs', at: [0.45, 0.33, -1.5], side: 'left', value: () => `sunk ${fmt(sim.s.sagR * 1000)} mm${sim.s.sagR > VEHICLE.axles.travel[1] ? ' · on the bump stops' : ''}` }
	});

	/* ------------------------------------------------------------ the engine and the gearbox */
	const EAT = /** @type {V3} */ ([0, 0.52, 1.25]);
	const engine = inlineEngine(kit, {
		parent: body,
		at: EAT,
		bore: 0.092,
		stroke: 0.09,
		rod: 0.152,
		pitch: 0.104,
		well: 'rear',
		gears: VEHICLE.gears,
		lever: [0, 0.6, -0.42],
		mounts: [[0.375, -0.02, 0.02], [-0.375, -0.02, 0.02]],
		rearMount: [0, -0.15, -0.79],
		assembly: 'engine',
		gearAssembly: 'drivetrain',
		source: SRC.eng,
		name: '2.4 L diesel',
		specs: [['Power', '55 kW at 4,000 rpm [inferred]'], ['Torque', '152 N·m at 2,400 rpm [inferred]'], ['Injection', 'Indirect, 22 : 1'], ['Friction', '1.6 bar mean pressure at 2,000 rpm [inferred]']],
		M: E,
		tag: () => (sim.s.stalled ? 'stalled' : `${fmt(sim.s.rpm)} rpm · ${fmt(Math.max(0, sim.s.Te))} N·m · ${fmt(Math.max(0, sim.s.Pe) / 1000, 1)} kW`),
		gearTag: () => (sim.s.stalled ? 'stalled in 1st' : sim.s.v < 0.05 && sim.s.at.vSet < 0.05 ? 'neutral' : `${ordinal(sim.s.gear)} gear · ${VEHICLE.gears[sim.s.gear - 1].toFixed(2)} : 1${sim.s.launch ? ' · clutch slipping' : ''}`)
	});
	const shaft = propshaft(kit, { n: 2, r: 0.032, M: R, assembly: 'drivetrain', source: SRC.eng, specs: [['Tube', 'Ø 64 × 1.6 mm steel [inferred]'], ['Joints', '4 universal joints, a centre bearing']] });
	const BEARING = /** @type {V3} */ ([0, 0.44, -0.45]);
	const PINION = /** @type {V3} */ ([0, yw - 0.01, axle.rear + 0.065 + 0.212]);

	/* ------------------------------------------------------------ cooling, fuel, power, exhaust */
	const fan = new THREE.Group();
	{
		const zr = 2.37, yr = 1.02, wr = 0.62, hr = 0.44;
		const fins = [];
		for (let k = 0; k <= 56; k++) fins.push(slab(0.0006, hr, 0.036).translate(-wr / 2 + (k * wr) / 56, yr, zr));
		const core = GEO.merge([at(box(wr, hr, 0.03, 0.002), 0, yr, zr), ...fins]);
		const tanks = GEO.merge([at(box(wr + 0.06, 0.06, 0.06, 0.012), 0, yr + hr / 2 + 0.03, zr), at(box(wr + 0.06, 0.06, 0.06, 0.012), 0, yr - hr / 2 - 0.03, zr), cyl([0.2, yr + hr / 2 + 0.06, zr], [0.2, yr + hr / 2 + 0.08, zr], 0.022, 20)]);
		const shroud = new THREE.Shape();
		shroud.absarc(0, 0, 0.2, 0, Math.PI * 2, false);
		shroud.holes.push(circle(0, 0, 0.185));
		fan.add(m(GEO.rotor(/** @type {any} */ ({ count: 5, axis: 'z', r0: 0.04, r1: 0.175, chord: [0.05, 0.07], thick: 0.06, camber: 0.08, twist: 0.35, pitch: 0.45, nS: 5, nC: 7 })), E.plastic));
		fan.position.set(0, yr, zr - 0.07);
		const motor = GEO.merge([cyl([0, yr, zr - 0.11], [0, yr, zr - 0.07], 0.045, 20), plate(shroud, 0.05, 24).translate(0, yr, zr - 0.06), at(slab(0.4, 0.02, 0.012), 0, yr, zr - 0.105), at(slab(0.02, 0.4, 0.012), 0, yr, zr - 0.105)]);
		const hoses = [hose([[0.24, yr + hr / 2 + 0.03, zr - 0.03], [0.22, 1.12, 2.14], [0.08, 0.95, 1.72], [0, 0.85, 1.5]], 0.019, 8), hose([[-0.24, yr - hr / 2 - 0.03, zr - 0.03], [-0.22, 0.72, 2.12], [-0.08, 0.68, 1.68], [-0.03, 0.66, 1.53]], 0.019, 8)];
		part({ id: 'radiator', label: 'Radiator and fan', assembly: 'services', source: SRC.eng, what: 'In the nose behind the grille: the engine’s coolant runs down through the radiator’s finned tubes and gives its heat to the air the road and the electric fan push through it; two long hoses run back under the floor to the engine.', moves: 'The fan turns when the coolant is hot.', drive: 'Its 12 V motor, switched by a thermostat', specs: [['Core', `${Math.round(wr * 1000)} × ${Math.round(hr * 1000)} mm, aluminium [inferred]`], ['Rejects', 'About a third of the fuel’s heat at full load']] }, [m(core, M.core), m(tanks, E.plastic), m(motor, E.plastic), fan, m(GEO.merge(hoses), E.hose)], { explode: [0, 0.2, 0.9], tag: { text: 'Radiator', at: [0.32, yr + 0.25, zr], side: 'right', value: () => `${fmt(heat(), 1)} kW to the air` } });
		// the battery and the air filter beside it in the nose
		const bt = { x: -0.58, y: 0.885, z: 2.3, w: 0.24, h: 0.19, d: 0.17 };
		part({ id: 'battery', label: '12 V battery', assembly: 'services', source: SRC.eng, what: 'The starting battery in the nose, beside the radiator: it cranks the engine and heats the glow plugs; the alternator charges it.', specs: [['Capacity', '88 Ah, 680 A cold cranking [inferred]']] }, [m(at(box(bt.w, bt.h, bt.d, 0.008), bt.x, bt.y + bt.h / 2, bt.z), M.battery), m(GEO.merge([cyl([bt.x - 0.08, bt.y + bt.h, bt.z], [bt.x - 0.08, bt.y + bt.h + 0.02, bt.z], 0.009, 12), cyl([bt.x + 0.08, bt.y + bt.h, bt.z], [bt.x + 0.08, bt.y + bt.h + 0.02, bt.z], 0.009, 12)]), M.lead), m(GEO.merge([at(box(bt.w + 0.04, 0.012, bt.d + 0.04, 0.004), bt.x, bt.y - 0.006, bt.z), hose([[bt.x + 0.08, bt.y + bt.h + 0.02, bt.z], [bt.x + 0.2, bt.y + 0.1, bt.z - 0.1], [-0.2, 0.6, 1.9], [-0.155, 0.45, 1.05]], 0.007, 8)]), M.trim)], { explode: [-0.3, 0.3, 0.5] });
		const af = GEO.merge([at(box(0.28, 0.16, 0.22, 0.02), 0.58, 1.06, 2.3), cyl([0.58, 1.06, 2.41], [0.58, 1.06, 2.46], 0.04, 20)]);
		part({ id: 'air-filter', label: 'Air filter and intake', assembly: 'services', source: SRC.eng, what: 'The engine breathes through a paper element in this box behind the grille, then down a long duct to the intake manifold.', specs: [['Element', 'Paper, dry [inferred]']] }, [m(af, M.filterBox), m(hose([[0.5, 1.0, 2.19], [0.38, 0.95, 1.95], [0.22, 0.9, 1.62], [0.26, 0.88, 1.25], [0.176, 0.858, 1.06]], 0.032, 12), E.hose)], { explode: [0.3, 0.3, 0.5] });
		// the fuel tank under the floor on the right, its filler, its line to the pump
		const ft = { x: -0.71, y: 0.46, z: -0.6, w: 0.32, h: 0.24, d: 0.7 };
		const tankG = GEO.merge([at(box(ft.w, ft.h, ft.d, 0.03), ft.x, ft.y, ft.z), at(box(ft.w + 0.01, 0.01, 0.02, 0.003), ft.x, ft.y + ft.h / 2 - 0.02, ft.z + 0.2), at(box(ft.w + 0.01, 0.01, 0.02, 0.003), ft.x, ft.y + ft.h / 2 - 0.02, ft.z - 0.2)]);
		part({ id: 'fuel-tank', label: 'Fuel tank', assembly: 'services', source: SRC.eng, what: 'A 60 L pressed-steel tank under the floor on the right, hung on two straps; its filler neck runs up to the cap on the side.', specs: [['Volume', '60 L [inferred]'], ['Fuel', 'Diesel, 835 g/L']] }, [m(tankG, M.tank), m(GEO.merge([hose([[ft.x - 0.1, ft.y + ft.h / 2, ft.z - 0.3], [-0.88, 0.75, -0.95], [-0.93, 1.0, -0.95]], 0.022, 10), hose([[ft.x + 0.14, ft.y + 0.08, ft.z + 0.35], [-0.38, 0.5, 0.2], [-0.1, 0.45, 0.9], [0.12, 0.55, 1.3], [0.16, 0.66, 1.42]], 0.005, 6)]), E.hose)], { explode: [-0.5, -0.3, 0], tag: { text: 'Fuel', at: [ft.x - ft.w / 2, ft.y, ft.z], side: 'right', value: () => (sim.s.stalled ? 'stopped' : `${fmt(sim.s.fuel, 1)} L/h${sim.s.v > 0.5 ? ` · ${fmt(sim.s.l100, 1)} L/100 km` : ''}`) } });
		const ex = engine.points.exhaust;
		const pipe = hose([ex, [ex[0] - 0.04, 0.55, ex[2] - 0.08], [-0.25, 0.42, 0.82], [-0.25, 0.42, 0.2]], 0.024, 12);
		const tail = hose([[-0.25, 0.42, -0.78], [-0.27, 0.43, -1.3], [-0.29, 0.43, -1.6], [-0.3, 0.43, -2.2], [-0.6, 0.42, -2.34], [-0.64, 0.41, -2.5]], 0.024, 12);
		const silencer = GEO.merge([at(box(0.24, 0.14, 0.94, 0.05), -0.25, 0.42, -0.29)]);
		part({ id: 'exhaust', label: 'Exhaust and silencer', assembly: 'services', source: SRC.eng, what: 'From the manifold down and back under the floor through the silencer, over the axle and out under the back on the right, hung on rubber loops.', specs: [['Pipe', 'Ø 48 mm steel [inferred]']] }, [m(GEO.merge([pipe, tail]), E.hot), m(silencer, M.silencer)], { explode: [0, -0.5, 0] });
	}
	/** the coolant's heat to the air (kW): about 30 % of the fuel's heat [inferred] */
	const heat = () => (sim.s.fuel * 0.835 * 42.6 * 0.3) / 3.6;

	/* ------------------------------------------------------------ the body */
	const prof = profile();
	const t = 0.008;
	const S = VAN.slider, F = VAN.fdoor;
	/** the A pillar's line on the side: the windscreen's edge moved back by `d` (z at height y) */
	const kWs = prof.pts.length - 9 + 4;
	const ws0 = prof.pts[kWs], ws1 = prof.pts[kWs + 1];
	const aLine = (/** @type {number} */ d, /** @type {number} */ y) => {
		const dz = ws1[0] - ws0[0], dy = ws1[1] - ws0[1], L = Math.hypot(dz, dy);
		const pz = ws0[0] - (dy / L) * d, py = ws0[1] + (dz / L) * d;
		return pz + ((y - py) * dz) / dy;
	};
	const yA = (() => {
		// where the front door's straight front edge meets the A pillar's line
		let y = 1.0;
		for (let k = 0; k < 40; k++) y += (aLine(0.13, y) - F.hinge) * 0.5;
		return y;
	})();
	/** @type {V2[]} */
	const fdoorHole = [[F.z0, F.y0], [F.hinge, F.y0], [F.hinge, yA], [aLine(0.13, F.y1), F.y1], [F.z0, F.y1]];
	/** @type {V2[]} */
	const fdoorWin = [[F.z0 + 0.06, 1.42], [aLine(0.18, 1.42), 1.42], [aLine(0.18, 1.94), 1.94], [F.z0 + 0.06, 1.94]];
	const sideWins = { left: [zyRect(-0.85, 0.12, 1.42, 1.94), zyRect(-2.2, -0.95, 1.42, 1.94)], right: [zyRect(0.3, 1.16, 1.42, 1.94), zyRect(-0.85, 0.12, 1.42, 1.94), zyRect(-2.2, -0.95, 1.42, 1.94)] };
	{
		const outline = insetEdges(prof.pts, prof.r);
		const sides = [];
		const seals = [];
		const glass = [];
		for (const sx of [-1, 1]) {
			const s = zyShape(outline, 0);
			s.holes.push(zyHole(fdoorHole, 0.03));
			if (sx > 0) s.holes.push(zyHole(zyRect(S.z0, S.z1, S.y0, S.y1), 0.04));
			const wins = sx > 0 ? sideWins.left : sideWins.right;
			for (const w of wins) {
				s.holes.push(zyHole(w, 0.05));
				const ring = zyShape(outsetRect(w, 0.014), 0.06);
				ring.holes.push(zyHole(w, 0.05));
				seals.push(onX(plate(ring, 0.004, 6), sx * (X + 0.002)));
				glass.push(onX(plate(zyShape(outsetRect(w, 0.006), 0.055), 0.005, 6), sx * (X - t / 2)));
			}
			sides.push(tone(onX(plate(s, t, 6), sx * (X - t / 2))));
			// the sliding door's centre rail on the left's rear quarter
			if (sx > 0) sides.push(tone(at(box(0.024, 0.03, 1.2, 0.006), X + 0.012, 1.34, -0.4)));
		}
		// the inner wheel housings: a wall and an arched top over each wheel, inside the body
		const houses = [];
		for (const zc of [axle.front, axle.rear])
			for (const sx of [-1, 1]) {
				const a0 = Math.PI - Math.asin((VAN.sill - yw) / 0.435), a1 = Math.asin((VAN.sill - yw) / 0.435);
				/** @type {V2[]} */
				const arc = [];
				for (let k = 0; k <= 16; k++) {
					const a = a0 + ((a1 - a0) * k) / 16;
					arc.push([zc + 0.435 * Math.cos(a), yw + 0.435 * Math.sin(a)]);
				}
				houses.push(onX(plate(zyShape(arc, 0), 0.006, 6), sx * 0.66));
				const top = new THREE.Shape();
				top.absarc(0, 0, 0.441, a1, a0, false);
				top.absarc(0, 0, 0.435, a0, a1, true);
				top.closePath();
				houses.push(plate(top, X - 0.66 - t, 6).rotateY(Math.PI / 2).translate(sx * (0.66 + (X - 0.66 - t) / 2), yw, zc));
			}
		// rust: along the sills, round the arches' lips, a patch on each side
		const rust = [];
		for (const sx of [-1, 1]) {
			for (const [z0, z1] of [[-2.36, -2.0], [-1.1, 1.15], [2.04, 2.34]]) rust.push(onX(plate(zyShape(zyRect(z0, z1, VAN.sill + 0.004, VAN.sill + 0.07 + 0.03 * Math.sin(z0 * 7)), 0.02), 0.002, 4), sx * (X + 0.0012)));
			for (const zc of [axle.front, axle.rear]) {
				const lip = new THREE.Shape();
				lip.absarc(0, 0, 0.47, 0.35, Math.PI - 0.35, false);
				lip.absarc(0, 0, 0.432, Math.PI - 0.35, 0.35, true);
				lip.closePath();
				rust.push(plate(lip, 0.002, 12).rotateY(Math.PI / 2).translate(sx * (X + 0.0012), yw, zc));
			}
			/** @type {V2[]} */
			const blob = [];
			for (let k = 0; k < 9; k++) {
				const a = (k / 9) * Math.PI * 2, rr = 0.06 + 0.025 * Math.sin(k * 2.3 + sx);
				blob.push([-1.35 + rr * 1.5 * Math.cos(a), 0.62 + rr * Math.sin(a)]);
			}
			rust.push(onX(plate(zyShape(blob, 0.025), 0.002, 4), sx * (X + 0.0012)));
		}
		part({ id: 'body-sides', label: 'Body sides', assembly: 'body', source: SRC.air, what: 'The two pressed-steel sides, cream below the waist and blue above, their windows, door openings and wheel arches cut in; the wheel housings inside. Thirty years of sun have faded the blue, and the sills and arches are rusting through.', specs: [['Steel', '0.8 mm, painted [inferred]'], ['Paint', 'Two-tone, cream and blue']] }, [m(GEO.merge(sides), M.paint), m(GEO.merge(houses), M.trim), m(GEO.merge(rust), M.rust), m(GEO.merge(seals), M.rubber)], { explode: [0, 0.3, 0], xray: 'shell' });
		part({ id: 'side-glass', label: 'Side windows', count: 5, assembly: 'body', source: SRC.air, what: 'Fixed side windows of toughened glass in rubber seals.', specs: [['Glass', '4 mm toughened']] }, [m(GEO.merge(glass), M.glass)], { explode: [0, 0.32, 0] });
		// the front, the roof and the back: one panel for each edge of the profile, its edges rounded onto the sides
		const ps = [];
		/** @type {THREE.BufferGeometry[]} */
		const screen = [];
		const n = prof.pts.length;
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
			if (k === kWs - 3) holes.push(roundHole([[-0.43, 0.08], [0.43, 0.08], [0.43, 0.37], [-0.43, 0.37]], 0.03));
			if (k === n - 1) {
				holes.push(roundHole([[-0.72, 2.06 - 1.94], [0.72, 2.06 - 1.94], [0.72, 2.06 - 1.42], [-0.72, 2.06 - 1.42]], 0.05));
				screen.push(onEdge(plate(/** @type {THREE.Shape} */ (roundPoly([[-0.725, 0.115], [0.725, 0.115], [0.725, 0.645], [-0.725, 0.645]], 0.05)), 0.005, 8), a, b, -0.005));
			}
			ps.push(tone(edgePanel(a, b, R0, t, W, holes)));
		}
		part({ id: 'front-roof-back', label: 'Nose, roof and back', assembly: 'body', source: SRC.air, what: 'The body’s ends and top: the short nose with the grille’s opening, the bonnet, the windscreen’s frame, the roof, and the back with its two doors (shut here); every edge rounded onto the sides.', specs: [['Roof', 'Ribbed steel, 0.8 mm [inferred]']] }, [m(GEO.merge(ps), M.paint)], { explode: [0, 0.9, 0], xray: 'shell' });
		part({ id: 'windscreen', label: 'Windscreen and back window', assembly: 'body', source: SRC.air, what: 'The laminated windscreen, nearly upright over the short nose, and the back window between the rear doors.', specs: [['Windscreen', '6.4 mm laminated'], ['Back', '4 mm toughened']] }, [m(GEO.merge(screen), M.glass)], { explode: [0, 0.5, 0.5] });
		// the floor, its mat, the wall under the dashboard
		const fx = X - t - 0.004;
		/** @type {V2[]} */
		const fo = [[-fx, 2.15], [fx, 2.15]];
		for (const zc of [axle.front, axle.rear]) fo.push([fx, zc + 0.44], [0.655, zc + 0.44], [0.655, zc - 0.44], [fx, zc - 0.44]);
		fo.push([fx, VAN.rear + 0.012], [-fx, VAN.rear + 0.012]);
		for (const zc of [axle.rear, axle.front]) fo.push([-fx, zc - 0.44], [-0.655, zc - 0.44], [-0.655, zc + 0.44], [-fx, zc + 0.44]);
		const fs = /** @type {THREE.Shape} */ (roundPoly(xz(fo), 0.004));
		fs.holes.push(roundHole(xz([[-0.3, 0.84], [-0.3, 2.12], [0.3, 2.12], [0.3, 0.84]]), 0.04));
		const floorG = onY(plate(fs, 0.02, 4), floor - 0.01);
		const mat = onY(plate(fs, 0.004, 4), floor + 0.002);
		const wall = at(slab(1.7, 0.56, t), 0, floor + 0.28, 2.16);
		part({ id: 'floor', label: 'Floor', assembly: 'body', source: SRC.air, what: 'The ribbed steel floor on the frame, cut round the engine’s cover and the wheel housings, a rubber mat over it; the wall under the dashboard closes the cab from the nose.', specs: [['Height', `${Math.round(floor * 1000)} mm off the road`]] }, [m(floorG, M.cream), m(mat, M.floor), m(wall, M.cream)], { explode: [0, 0.2, 0] });
		// bumpers, plates, lights, the grille, the gutters, the wipers
		// (the bumpers hang just under the cut's height: cut lengthwise only, or a sliver of them floats by the body)
		const bump = (/** @type {number} */ z, /** @type {number} */ dz) => GEO.merge([at(box(1.82, 0.15, 0.13, 0.03), 0, 0.53, z), at(box(0.16, 0.15, 0.2, 0.04), 0.86, 0.53, z - dz * 0.04), at(box(0.16, 0.15, 0.2, 0.04), -0.86, 0.53, z - dz * 0.04), at(box(0.06, 0.08, 0.12, 0.01), 0.42, 0.53, z - dz * 0.1), at(box(0.06, 0.08, 0.12, 0.01), -0.42, 0.53, z - dz * 0.1)]);
		part({ id: 'bumpers', label: 'Bumpers and number plates', assembly: 'body', source: SRC.air, what: 'Steel bumpers front and back on brackets to the frame, painted black; the plates (blank) on them.', specs: [['Steel', '2 mm pressed']] }, [m(GEO.merge([bump(VAN.front + 0.12, 1), bump(VAN.rear - 0.1, -1)]), halfCut(M.trim)), m(GEO.merge([at(slab(0.52, 0.11, 0.006), 0, 0.53, VAN.front + 0.19), at(slab(0.52, 0.11, 0.006), 0, 0.8, VAN.rear - 0.006)]), halfCut(M.plate))], { explode: [0, -0.2, 0] });
		const lights = [], lenses = [], reds = [], ambers = [];
		for (const sx of [-1, 1]) {
			lights.push(at(box(0.27, 0.18, 0.05, 0.01), sx * 0.62, 1.12, VAN.front - 0.012));
			lenses.push(at(box(0.24, 0.15, 0.012, 0.004), sx * 0.62, 1.12, VAN.front + 0.014));
			ambers.push(at(box(0.12, 0.06, 0.03, 0.008), sx * 0.62, 0.99, VAN.front + 0.0), at(box(0.06, 0.12, 0.03, 0.008), sx * 0.81, 1.1, VAN.rear - 0.004));
			reds.push(at(box(0.12, 0.24, 0.03, 0.008), sx * 0.79, 0.88, VAN.rear - 0.004));
			lenses.push(at(box(0.08, 0.06, 0.03, 0.008), sx * 0.79, 0.72, VAN.rear - 0.004));
		}
		const grille = [];
		for (let k = 0; k < 6; k++) grille.push(at(box(0.88, 0.022, 0.03, 0.006), 0, 1.03 + k * 0.05, VAN.front - 0.012));
		grille.push(at(box(0.9, 0.31, 0.01, 0.004), 0, 1.155, VAN.front - 0.04));
		part({ id: 'lights', label: 'Lights and grille', assembly: 'body', source: SRC.air, what: 'Two square sealed-beam headlights with their indicators under them in the nose, the grille between them that lets the air to the radiator; the tail lights, indicators and reversing lights at the back corners.', specs: [['Headlights', 'Sealed beam, 12 V 60/55 W [inferred]']] }, [m(GEO.merge(lights), M.reflector), m(GEO.merge(lenses), M.lens), m(GEO.merge(reds), M.red), m(GEO.merge(ambers), M.amber), m(GEO.merge(grille), M.trim)], { explode: [0, 0, 0.5] });
		const gut = [];
		for (const sx of [-1, 1]) gut.push(cyl([sx * 0.9, VAN.roof - 0.012, -2.36], [sx * 0.9, VAN.roof - 0.012, 1.86], 0.01, 8));
		const wip = [];
		for (const wx of [-0.45, 0.3]) wip.push(onEdge(GEO.merge([at(slab(0.012, 0.42, 0.012), 0, 0.26, 0.012), at(slab(0.02, 0.4, 0.02), 0.02, 0.26, 0.024)]).rotateZ(-0.12).translate(wx, 0, 0), ws0, ws1, 0));
		part({ id: 'gutters-wipers', label: 'Gutters and wipers', assembly: 'body', source: SRC.air, what: 'The rain gutters along the roof’s edges, where the rack’s feet clamp; the two wipers on the windscreen.', specs: [['Wipers', '2 × 450 mm [inferred]']] }, [m(GEO.merge(gut), M.trim), m(GEO.merge(wip), M.trim)], { explode: [0, 0.6, 0.3] });
	}

	/* ------------------------------------------------------------ the doors */
	/** @type {ReturnType<typeof hinge>[]} */
	const fdoors = [];
	/** a door's panels, its skin in the two tones @param {V2[]} hole @param {V2[]} win @param {1 | -1} sx */
	const doorPanelsT = (hole, win, sx) => {
		const d = doorPanels(hole, win, { x: X, sx, split: 1.4 });
		tone(d.skin);
		return d;
	};
	for (const sx of [1, -1]) {
		const h = hinge(body, { at: [sx * X, 0, F.hinge], axis: 'y', max: -sx * 1.2, name: `door-${sx > 0 ? 'left' : 'right'}` });
		const d = doorPanelsT(fdoorHole, fdoorWin, /** @type {1 | -1} */ (sx));
		const mv = (/** @type {THREE.BufferGeometry} */ g) => g.translate(-sx * X, 0, -F.hinge);
		const extra = GEO.merge([at(box(0.05, 0.04, 0.3, 0.01), sx * (X - 0.08), 1.08, 1.62), at(box(0.02, 0.025, 0.08, 0.006), sx * (X - 0.07), 1.22, F.z0 + 0.12)]);
		const outside = GEO.merge([at(box(0.02, 0.03, 0.14, 0.008), sx * (X + 0.012), 1.3, F.z0 + 0.12), cyl([sx * X, 1.48, 2.06], [sx * (X + 0.13), 1.5, 2.05], 0.012, 8), at(box(0.05, 0.19, 0.12, 0.02), sx * (X + 0.16), 1.55, 2.05)]);
		const glassM = at(slab(0.04, 0.17, 0.004), sx * (X + 0.16), 1.55, 2.05 - 0.062);
		kit.part(h.pivot, { id: `door-${sx > 0 ? 'left' : 'right'}`, label: sx > 0 ? 'Front door, left' : 'Front door, right (the driver’s)', assembly: 'doors', source: SRC.air, what: 'A hinged steel door over the front wheel, its window wound down by a handle inside; its mirror on its front corner. It swings out on two hinges at its front edge.', moves: 'Opens to 70° on its hinges.', drive: 'By hand (the Doors slider)', specs: [['Opening', `${Math.round((F.hinge - F.z0) * 1000)} × ${Math.round((F.y1 - F.y0) * 1000)} mm`]] }, { explode: [sx * 0.55, 0.1, 0.25] }, body);
		h.pivot.add(m(mv(d.skin), M.paint), m(mv(d.glass), M.glass), m(mv(d.card), M.card), m(mv(extra), M.vinyl), m(mv(outside), M.trim), m(mv(glassM), M.chrome));
		fdoors.push(h);
	}
	const slider = slide(body, { path: [[0, 0, 0], [0.075, 0, -0.07], [0.075, 0, -0.3], [0.075, 0, -1.02]], name: 'slider' });
	{
		const hole = zyRect(S.z0, S.z1, S.y0, S.y1);
		const d = doorPanelsT(hole, zyRect(0.3, 1.16, 1.42, 1.94), 1);
		const bits = GEO.merge([at(box(0.02, 0.03, 0.16, 0.008), X + 0.012, 1.3, S.z1 - 0.14), cyl([X - 0.03, 1.34, S.z0 + 0.03], [X + 0.012, 1.34, S.z0 - 0.06], 0.008, 8), cyl([X + 0.012, 1.31, S.z0 - 0.06], [X + 0.012, 1.37, S.z0 - 0.06], 0.014, 12), cyl([X - 0.04, S.y1 - 0.04, S.z1 - 0.06], [X - 0.12, S.y1 - 0.02, S.z1 - 0.06], 0.008, 8), cyl([X - 0.04, S.y0 + 0.05, S.z1 - 0.06], [X - 0.12, S.y0 + 0.08, S.z1 - 0.06], 0.008, 8)]);
		kit.part(new THREE.Group().add(m(d.skin, M.paint), m(d.glass, M.glass), m(d.card, M.card), m(bits, M.trim)), { id: 'sliding-door', label: 'Sliding door', assembly: 'doors', source: SRC.air, what: 'The wide door on the left into the seats behind: its rollers run in three rails, top, bottom and the centre rail along the side, that first pull it out of its opening and then slide it back along the van.', moves: 'Out of its opening, then back along the side (the Doors slider).', drive: 'By hand', specs: [['Opening', `${Math.round((S.z1 - S.z0) * 1000)} × ${Math.round((S.y1 - S.y0) * 1000)} mm`], ['Travel', '1,020 mm']] }, { explode: [0.6, 0.1, 0] }, slider.carriage);
	}

	/* ------------------------------------------------------------ the cab: seats, dashboard, wheel, the engine's cover */
	const gauges = cluster(kit, { dials: [{ x: -0.07, y: 0, r: 0.055, max: 140 }, { x: 0.07, y: 0, r: 0.055, max: 5000, ticks: 11 }], face: M.dial, tick: M.white, needle: M.needle, bezel: M.chrome, housing: M.dash });
	{
		part({ id: 'engine-cover', label: 'Engine cover', assembly: 'cab', source: SRC.eng, what: 'The padded box between the front seats over the engine (the “doghouse”): lift it off to reach the engine from inside; its lining keeps the noise and heat out of the cab.', specs: [['Lining', 'Felt and vinyl [inferred]']] }, [m(at(box(0.6, 1.0 - floor, 1.28, 0.07, 3), 0, (floor + 1.0) / 2, 1.48), M.vinyl)], { explode: [0, 0.9, 0], xray: 'shell' });
		const f = seatGeometry({ w: 0.48, d: 0.5, h: 0.32, back: 0.62, rake: 0.26 });
		const fronts = [-1, 1].map((sx) => [f.fabric.clone().translate(sx * 0.57, floor, VAN.driver.z), f.base.clone().translate(sx * 0.57, floor, VAN.driver.z)]);
		part({ id: 'front-seats', label: 'Front seats', count: 2, assembly: 'cab', source: SRC.air, what: 'The driver’s seat and one passenger’s, each side of the engine’s cover, on pedestals over the front wheel housings.', specs: [['Cover', 'Striped moquette, worn']] }, [m(GEO.merge(fronts.map((p) => p[0])), M.fabric), m(GEO.merge(fronts.map((p) => p[1])), M.vinyl)], { explode: [0, 0.7, 0.1] });
		const b2 = seatGeometry({ w: 1.2, d: 0.48, h: 0.32, back: 0.6, rake: 0.22 });
		part({ id: 'middle-bench', label: 'Middle bench', assembly: 'cab', source: SRC.air, what: 'A bench for three behind the front seats, an aisle beside it to the sliding door.', specs: [['Seats', '3']] }, [m(b2.fabric.translate(-0.27, floor, -0.02), M.fabric), m(b2.base.translate(-0.27, floor, -0.02), M.vinyl)], { explode: [0, 0.75, 0] });
		const b3 = seatGeometry({ w: 1.76, d: 0.48, h: 0.32, back: 0.6, rake: 0.22 });
		part({ id: 'rear-bench', label: 'Rear bench', assembly: 'cab', source: SRC.air, what: 'The full-width bench at the back, over the rear axle’s front; the luggage behind it.', specs: [['Seats', '4']] }, [m(b3.fabric.translate(0, floor, -1.12), M.fabric), m(b3.base.translate(0, floor, -1.12), M.vinyl)], { explode: [0, 0.8, -0.1] });
		const dash = GEO.merge([at(box(1.8, 0.3, 0.42, 0.03, 2), 0, 1.3, 1.95), at(box(1.82, 0.06, 0.34, 0.02, 2), 0, 1.47, 2.0), at(box(0.32, 0.11, 0.06, 0.02), VAN.driver.x, 1.4, 1.73)]);
		const faces = GEO.merge([at(slab(0.36, 0.13, 0.01), 0.52, 1.24, 1.735), at(slab(0.18, 0.05, 0.012), 0, 1.33, 1.735), ...[-0.82, -0.25, 0.25, 0.82].map((x) => at(slab(0.1, 0.04, 0.01), x, 1.4, 1.735))]);
		gauges.group.position.set(VAN.driver.x, 1.38, 1.7);
		gauges.group.rotation.x = 0.3;
		part({ id: 'dashboard', label: 'Dashboard and gauges', assembly: 'cab', source: SRC.air, what: 'The moulded dashboard under the windscreen: the speedometer and the rev counter in their binnacle before the driver, the radio, four vents, the glovebox.', moves: 'Its needles show the speed and the engine’s revs.', specs: [['Gauges', 'Speed to 140 km/h, revs to 5,000 rpm']] }, [m(dash, M.dash), m(faces, M.vinyl), gauges.group], { explode: [0, 0.5, 0.4], tag: { text: 'Gauges', at: [VAN.driver.x, 1.45, 1.7], side: 'right', value: () => `${fmt(kmh())} km/h · ${fmt(sim.s.rpm)} rpm` } });
		const sw = steeringWheelGeometry({ R: 0.2, column: 0.5 });
		const wheel = new THREE.Group();
		wheel.add(m(sw.rim, M.vinyl), m(sw.hub, M.dash), m(sw.column, M.dash));
		wheel.position.set(...VAN.wheel);
		wheel.rotation.x = 0.95;
		part({ id: 'steering-wheel', label: 'Steering wheel and column', assembly: 'cab', source: SRC.air, what: 'A large, nearly flat wheel, as on a bus, on its column down to the floor, where a shaft with two universal joints runs to the rack.', moves: 'Turned by the driver (held straight here).', specs: [['Diameter', '400 mm']] }, [wheel], { explode: [0, 0.55, 0.1] });
		const ped = [];
		for (const [dx, w] of [[-0.13, 0.06], [-0.02, 0.08], [0.1, 0.05]]) ped.push(cyl([VAN.driver.x + dx, 1.12, 1.86], [VAN.driver.x + dx, 0.8, 1.68], 0.008, 8), at(box(w, 0.09, 0.012, 0.004), VAN.driver.x + dx, 0.77, 1.67));
		ped.push(cyl([-0.31, floor + 0.02, 0.9], [-0.31, floor + 0.2, 1.08], 0.012, 8));
		part({ id: 'pedals', label: 'Pedals and handbrake', count: 3, assembly: 'cab', source: SRC.air, what: 'Clutch, brake and accelerator hanging from under the dashboard; the handbrake lever by the driver’s seat pulls the rear drums’ shoes by cable.', specs: [['Brakes', 'Servo-assisted hydraulic, two circuits']] }, [m(GEO.merge(ped), M.vinyl)], { explode: [0, 0.4, 0.3] });
	}

	/* ------------------------------------------------------------ the roof rack and its load */
	{
		const y = 2.33;
		const r = [];
		for (const sx of [-1, 1]) r.push(bar([sx * 0.85, y, -2.1], [sx * 0.85, y, 1.9], 0.02, 12));
		for (const z of [-2.1, -0.7, 0.6, 1.9]) {
			r.push(bar([-0.85, y, z], [0.85, y, z], 0.017, 10));
			for (const sx of [-1, 1]) r.push(bar([sx * 0.85, y, z], [sx * 0.9, VAN.roof + 0.005, z], 0.014, 8), at(box(0.05, 0.04, 0.06, 0.008), sx * 0.9, VAN.roof + 0.01, z));
		}
		part({ id: 'roof-rack', label: 'Roof rack', assembly: 'roof', source: SRC.air, what: 'A welded tube rack clamped to the roof’s gutters on eight feet: two rails and four crossbars to tie the load to.', specs: [['Tube', 'Ø 40 mm steel'], ['Load', 'Up to 100 kg on the roof [inferred]']] }, [m(GEO.merge(r), M.rack)], { explode: [0, 1.0, 0] });
		const bag = (/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ d, /** @type {number} */ x, /** @type {number} */ z) => {
			const yc = y + 0.02 + h / 2;
			return { shell: at(box(w, h, d, Math.min(0.08, h / 3), 3), x, yc, z), straps: GEO.merge([at(box(w + 0.008, h + 0.008, 0.035, 0.01), x, yc, z - d / 4), at(box(w + 0.008, h + 0.008, 0.035, 0.01), x, yc, z + d / 4), at(new THREE.TorusGeometry(0.06, 0.01, 6, 16, Math.PI), x, yc + h / 2, z)]) };
		};
		const bags = /** @type {[string, string, THREE.Material, number, number, number, number, number, number][]} */ ([['bag-red', 'Red holdall', M.bagRed, 0.7, 0.4, 0.9, -0.4, -1.3, 0.9], ['bag-blue', 'Blue holdall', M.bagBlue, 0.6, 0.35, 0.8, 0.4, -1.2, 1.05], ['bag-green', 'Green duffel', M.bagGreen, 0.8, 0.45, 0.7, 0.25, 0.1, 1.2]]);
		for (const [id, label, mat, w, h, d, x, z, up] of bags) {
			const b = bag(w, h, d, x, z);
			part({ id, label, assembly: 'roof', source: SRC.air, what: 'A soft canvas bag of the travellers’ things, strapped shut and tied to the rack.', specs: [['Size', `${Math.round(w * 100)} × ${Math.round(d * 100)} × ${Math.round(h * 100)} cm`], ['Weight', '~20 kg [inferred]']] }, [m(b.shell, mat), m(b.straps, M.trim)], { explode: [0, up + 0.4, 0] });
		}
		part({ id: 'sack', label: 'Sack of rice', assembly: 'roof', source: SRC.air, what: 'A woven sack of rice, its neck tied off, lying on the rack.', specs: [['Weight', '25 kg']] }, [m(at(box(0.6, 0.35, 0.9, 0.16, 3), -0.4, y + 0.195, 0.2), M.sack), m(cyl([-0.4, y + 0.19, 0.64], [-0.4, y + 0.19, 0.74], 0.05, 12), M.sack)], { explode: [0, 1.5, 0] });
		const spare = GEO.lathe([[0.18, -0.088], [0.25, -0.092], [0.305, -0.08], [0.322, -0.045], [0.322, 0.045], [0.305, 0.08], [0.25, 0.092], [0.18, 0.088]], 40).translate(0, y + 0.115, 1.4);
		part({ id: 'spare-tyre', label: 'Spare wheel', assembly: 'roof', source: SRC.tyre, what: 'A fifth wheel and tyre lying flat on the front of the rack.', specs: [['Tyre', TYRE.code]] }, [m(spare, R.tyre), m(latheY([[0.05, -0.055], [0.178, -0.055], [0.178, 0.055], [0.05, 0.055]], 32).translate(0, y + 0.115, 1.4), R.rimSteel)], { explode: [0, 1.0, 0.3] });
		const ropes = [hose([[-0.85, y, -1.3], [-0.72, y + 0.43, -1.3], [0.0, y + 0.44, -1.28], [0.7, y + 0.39, -1.22], [0.85, y, -1.2]], 0.006, 6), hose([[-0.85, y, 0.15], [-0.6, y + 0.38, 0.15], [0.1, y + 0.5, 0.12], [0.62, y + 0.48, 0.1], [0.85, y, 0.1]], 0.006, 6), hose([[-0.85, y, 1.4], [-0.3, y + 0.24, 1.4], [0.3, y + 0.24, 1.4], [0.85, y, 1.4]], 0.006, 6)];
		part({ id: 'ropes', label: 'Ropes', count: 3, assembly: 'roof', source: SRC.air, what: 'Three ropes over the load, tied off to the rack’s rails.', specs: [['Rope', '6 mm polypropylene']] }, [m(GEO.merge(ropes), M.strap)], { explode: [0, 1.7, 0] });
	}

	/* ------------------------------------------------------------ the solver and what it moves */
	const ctl = {
		speed: { label: 'Speed asked', min: 0, max: 120, value: speed, step: 1, unit: 'km/h', ends: /** @type {[string, string]} */ (['Standing', '120 km/h']) },
		grade: { label: 'Grade', min: -15, max: 35, value: grade, step: 0.5, unit: '%', ends: /** @type {[string, string]} */ (['Downhill', 'Steep climb']) },
		load: { label: 'Load inside (people and bags)', min: 0, max: VEHICLE.payload, value: load, step: 10, unit: 'kg', ends: /** @type {[string, string]} */ (['Empty', 'Full payload']) },
		doors: { label: 'Doors open', min: 0, max: 1, value: doors, step: 0.01, digits: 2, ends: /** @type {[string, string]} */ (['Shut', 'Open']) }
	};
	/** what the driver is asked for: the sliders, or the break's overload up its hill @param {{ broken: boolean }} env */
	const input = (env) => ({ vSet: ctl.speed.value * KMH, grade: env.broken ? 0.35 : ctl.grade.value / 100, load: env.broken ? VEHICLE.payload * 2.5 : ctl.load.value });
	sim.settle(input({ broken: false }));
	let fanA = 0;
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
		fanA -= (heat() > 8 ? 2200 / 60 / 40 : 0) * Math.PI * 2 * dt;
		fan.rotation.z = fanA;
		const k = clamp(ctl.doors.value);
		for (const d of fdoors) d.set(k);
		slider.set(k);
		gauges.set([kmh(), s.rpm]);
		const r = lab.read;
		const lug = !s.stalled && s.theta > 0.97 && s.a < -0.05;
		r.value = Math.max(0, s.Pw) / 1000;
		r.bad = s.stalled || (lug && s.gear === 1) || s.bottomed;
		r.state = s.stalled
			? env.broken
				? `stalled: ${fmt(VEHICLE.payload * 2.5)} kg in it up a 35 % grade`
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
		hero: { label: 'Power at the wheels', unit: 'kW', max: 60, digits: 1 },
		read: { value: 0, state: '', sub: '', bad: false },
		controls: ctl,
		how: {
			text: 'A driver holds the speed asked: the road takes a force to roll the tyres, to lift the van up the grade and to push the air aside, and holding the speed takes that force times the speed at the wheels, more through the gearbox’s and the axle’s losses at the engine. The driver picks the highest gear that gives that push without the engine running too slow, opens the throttle for it, and brakes downhill when even the shut throttle pushes too much. Where first gear on the engine’s full-load curve gives less than the hill takes, the speed falls, the engine lugs down and stalls. The fuel comes from the engine’s work plus its own friction. The axles’ loads shift back up a hill and as it pulls, and the springs sink by the load over their rates. The doors are moved by their slider alone. Shown slowed: the wheels 10 times, the engine, the gearbox and the propshaft 40 times.',
			eqs: ['F = m g Crr cos θ + m g sin θ + ½ ρ Cd A v²      m = 1,950 kg + load, Crr = 0.011, Cd A = 1.62 m²', 'P_wheels = F v        P_engine = P_wheels / η      η = 0.90', 'n = (v / r) · i_gear · i_axle      r = 0.316 m, i = 4.00 … 0.80, i_axle = 4.30', 'T_engine ≤ T_full(n)      152 N·m at 2,400 rpm, 131 N·m at 4,000', 'm_eff dv/dt = T i η / r − F      m_eff = m + (4 J_w + J_e i² η) / r²', 'fuel = (T + T_friction) ω · 200 g/kWh      T_friction from 1.6 bar', 'sag = ΔF_axle / k      k = 32 kN/m front, 52 kN/m rear (a wheel)']
		},
		breakIt: {
			label: 'Overload it up a 35 % hill',
			run: () => {},
			reset: () => sim.restart()
		},
		cut: { a: [1, 0, 0], b: [0, 1, 0], center: [0, 0.45, 0], reach: 0.5 }
	};
	const asset = kit.seal({ lab });
	// at rest: every moving part where the solver's first moment puts it
	asset.tick(0, { broken: false, time: 0, slow: 0, cut: 0, xray: 0 });
	return root;
}
