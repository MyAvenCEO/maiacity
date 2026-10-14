/*
 * THE POWER CUBE, v3 — Open Source Ecology's hydraulic power unit (Power Cube VII / 7s, v15.6, 2014–15) built the way
 * AirSup's machine skill builds a machine: every part a mechanic would name as real solids in measured materials, its
 * insides there to cut open (the V-twin's pistons on their rods, the crank, the pump's two gears in their housing, the
 * oil in the tank), and a solver that runs it on real equations. The older cube (v1, v2: $lib/actors/powercube.js, one
 * rigged mesh) stays as it was; the ElectroCube, the BatteryCube and the LifeTrac still build on it.
 *
 * ---------------------------------------------------------------- research (AirSup's step 1)
 * The machine: a 27" (686 mm) steel cube on two 4×4 tube skids; a 28 hp (20.9 kW gross at 3,600 rpm) 810 cc OHV
 * air-cooled 90° V-twin, horizontal shaft, electric start (bore 83.8 mm, stroke 73.4 mm, 8.4:1: its maker's data sheet, not named);
 * on its shaft, through a welded sleeve coupling, a fixed-displacement gear pump of 0.976 in³ (16.0 cm³) a turn, 15.2
 * gpm (57.5 L/min) at 3,600 rpm, 3,000 psi (207 bar) at most; a 7-gallon reservoir, a relief valve (v15.6), a pressure
 * gauge (v15.6), a six-tube fan-cooled oil cooler (7s), a return filter, pressure and return quick couplers; a 7-gallon
 * fuel tank on top, a 12 V battery, a panel with the key, choke and throttle; about 181 kg (OSE's wiki and fabrication
 * manual, $lib/actors/powercube.js has the sources). Inferred, and said so on each card: the torque curve (peak 63 N·m
 * at 2,600 rpm from a 9.8 bar mean effective pressure, typical of these engines), the rod length (116 mm), the pump's
 * slip (6 % at 3,000 psi) and efficiency (92 %), the relief's override, the cooler's UA, the layout inside the cube.
 * The physics: a gear pump's flow Q = D n ηv and torque T = D p / (2π ηhm); the engine's torque against the pump's on
 * one shaft, J dω/dt = Te − Tp, held by a droop governor; a relief valve that caps the pressure and turns the flow it
 * dumps into heat; the oil's heat balance against the cooler. The one number: hydraulic power, p·Q (kW). The input:
 * the engine's speed and the pressure the work needs. The break: dead-headed with its relief stuck, the pressure
 * climbs until the pump's torque passes the engine's and the engine stalls.
 *
 * In the asset's frame (./parts.js): metres, the foot's middle at the origin, y up, the front (the flywheel's end)
 * towards +z, x across.
 */
import * as THREE from 'three';
import { GEO, MAT, Flow, approach, clamp, fmt, lerp, table } from '$lib/assets/kit.js';
import { assetKit } from '$lib/assets/parts.js';

/** @typedef {[number, number, number]} V3 */

/** the cube: 27" each way, its 4×4 skids' height */
export const CUBE = { W: 0.686, L: 0.66, H: 0.686, B: 0.1016 };
/** the crank's line (x 0, y, along z) and the plane the two cylinders stand in */
export const CRANK = { y: 0.235, z: 0.03 };
/** the engine: bore, stroke, rod (m), displacement (m³), its cylinders' angle from upright (rad) */
export const ENGINE = { bore: 0.0838, stroke: 0.0734, rod: 0.116, Vd: 810e-6, bank: Math.PI / 4, deck: 0.186 };
/** the pump: displacement (m³ a turn), its gears (teeth, module, width), the idler above the drive */
export const PUMP = { D: 16.0e-6, teeth: 12, module: 0.0025, width: 0.034, z0: -0.232 };

const SOURCES = [
	{ label: 'Power Cube VII (OSE wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube_VII' },
	{ label: 'Power Cube 7s (OSE wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube_7s' },
	{ label: 'Power Cube v15.6 (OSE wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube_v15.6' },
	{ label: 'Power Cube (OSE portfolio)', url: 'https://www.opensourceecology.org/portfolio/power-cube/' },
	{ label: 'Power Cube fabrication manual (v4)', url: 'https://commons.wikimedia.org/wiki/File:Open_Source_Ecology_-_Powercube_-_Fabricaion_Manual.pdf' },
	{ label: 'Machine skill kit (AirSup, MIT)', url: 'https://github.com/AirsupHQ/machine-skill' }
];
/** the engine's own numbers (bore, stroke, compression) are from its maker's data sheet, which we do not name */
const SRC = { vii: SOURCES[0].label, s7: SOURCES[1].label, v156: SOURCES[2].label, port: SOURCES[3].label, man: SOURCES[4].label, eng: SOURCES[0].label };

const ASSEMBLIES = /** @type {import('$lib/actors/parts.js').Assembly[]} */ ([
	{ id: 'frame', label: 'Frame', note: 'A 27" cube: two 4×4 tube skids carry everything and take the forks; 2×2 angle posts and rails close it; the quick-attach plates on its back couple it to a machine.', out: [0, -0.12, 0] },
	{ id: 'engine', label: 'Engine', note: 'An 810 cc air-cooled 90° V-twin, 28 hp at 3,600 rpm, electric start: its crank turns the pump through the coupling behind it.', out: [0, 0.32, 0.3] },
	{ id: 'hydraulics', label: 'Hydraulics', note: 'The gear pump on the engine’s shaft, the 7-gallon reservoir over it, the relief valve and gauge, the six-tube cooler, the return filter and the two quick couplers on the back.', out: [0, 0.18, -0.42] },
	{ id: 'controls', label: 'Fuel and controls', note: 'The 7-gallon fuel tank on top, the 12 V battery, and the panel on the front corner with the key, choke and throttle.', out: [0.36, 0.3, 0.2] }
]);
const STEPS = ['Cut, drill and bolt the frame: skids, posts, rails, the engine plate and the quick-attach plates', 'Bolt in the engine and fit its flywheel, shroud, air cleaner and muffler', 'Mount the coupling and the pump; fit the reservoir, hoses, relief, gauge, cooler, filter and couplers', 'Fit the fuel tank, the battery and the control panel'];

// ---------------------------------------------------------------- shapes

/** a rounded rectangle, centred @param {number} w @param {number} h @param {number} r */
function rrect(w, h, r) {
	const s = new THREE.Shape(), x = w / 2, y = h / 2;
	s.moveTo(-x + r, -y);
	s.lineTo(x - r, -y);
	s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
	s.lineTo(x, y - r);
	s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
	s.lineTo(-x + r, y);
	s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
	s.lineTo(-x, -y + r);
	s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
	return s;
}
/** a hole in a shape: a circle @param {number} x @param {number} y @param {number} r */
const ring = (x, y, r) => {
	const p = new THREE.Path();
	p.absarc(x, y, r, 0, Math.PI * 2, true);
	return p;
};
/** a solid extruded along z by `d`, centred, with a small bevel @param {THREE.Shape} s @param {number} d @param {number} [b] */
const ext = (s, d, b = 0.0008) => GEO.extrude(s, d, b);
/** a thin plate from a shape along z, centred, sharp-edged and light (fins, screens, tube walls) @param {THREE.Shape} s @param {number} d @param {number} [seg] */
const plate = (s, d, seg = 8) => new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: seg }).translate(0, 0, -d / 2);
/** a plain box, centred (for sheets too thin to show a rounded edge) @param {number} w @param {number} h @param {number} d */
const slab = (w, h, d) => new THREE.BoxGeometry(w, h, d);
/** a ring gear's teeth round a rim @param {number} n @param {number} mod @param {number} w */
function ringGear(n, mod, w) {
	const s = new THREE.Shape(), ra = (n * mod) / 2 + mod, rf = (n * mod) / 2 - 1.25 * mod, da = (Math.PI * 2) / n;
	const pt = (/** @type {number} */ r, /** @type {number} */ a) => /** @type {[number, number]} */ ([r * Math.cos(a), r * Math.sin(a)]);
	s.moveTo(...pt(rf, 0));
	for (let k = 0; k < n; k++) {
		const a = k * da;
		s.lineTo(...pt(ra, a + 0.27 * da));
		s.lineTo(...pt(ra, a + 0.48 * da));
		s.lineTo(...pt(rf, a + 0.75 * da));
		s.lineTo(...pt(rf, a + da));
	}
	s.holes.push(ring(0, 0, rf - 0.006));
	return plate(s, w, 4);
}
/** a rounded box, centred @param {number} w @param {number} h @param {number} d @param {number} [r] */
const box = (w, h, d, r = Math.min(w, h, d) * 0.12) => GEO.rbox(w, h, d, r, 3);
/** a solid of revolution about z from [r, z] points @param {[number, number][]} pts @param {number} [seg] */
const latheZ = (pts, seg = 48) => GEO.lathe(pts, seg).rotateX(Math.PI / 2);
/** about x @param {[number, number][]} pts @param {number} [seg] */
const latheX = (pts, seg = 48) => GEO.lathe(pts, seg).rotateZ(-Math.PI / 2);
/** a round bar (closed) along z, from z0 to z1 @param {number} r @param {number} z0 @param {number} z1 @param {number} [seg] */
const rodZ = (r, z0, z1, seg = 32) => latheZ([[0, z0], [r, z0], [r, z1], [0, z1]], seg);
/** a closed cylinder from a to b @param {V3} a @param {V3} b @param {number} r @param {number} [seg] */
function cyl(a, b, r, seg = 32) {
	const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
	const g = GEO.disc(r, len, Math.min(r, len) * 0.06, seg);
	g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
	return g.translate(...A.clone().add(B).multiplyScalar(0.5).toArray());
}
/** a hose or pipe through points @param {V3[]} pts @param {number} r */
const hose = (pts, r) => GEO.pipe(pts, r, { seg: Math.max(24, pts.length * 14), radial: 14, tension: 0.5 });
/** hex heads round a circle in the x-y plane, facing +z, at z @param {number} n @param {number} R @param {number} s @param {number} h @param {number} z @param {number} [phase] */
const boltsZ = (n, R, s, h, z, phase = 0) => GEO.bolts(n, R, s, h, { phase }).rotateX(Math.PI / 2).translate(0, 0, z);
/** one hex head at a point, its axis along `dir` @param {V3} at @param {V3} dir @param {number} s @param {number} h */
function hex(at, dir, s, h) {
	const g = new THREE.CylinderGeometry(s, s, h, 6).translate(0, h / 2, 0);
	g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()));
	return g.translate(...at);
}
/** move a geometry @param {THREE.BufferGeometry} g @param {number} x @param {number} y @param {number} z */
const at = (g, x, y, z) => g.translate(x, y, z);

// ---------------------------------------------------------------- the materials (AirSup's measured presets)

function materials() {
	return {
		red: MAT.paint({ color: [0.5, 0.055, 0.035], roughness: 0.4, clearcoat: 0.35 }),
		zinc: MAT.steel({ color: [0.52, 0.53, 0.54], roughness: 0.34, finish: 'cast' }),
		steel: MAT.steel({ roughness: 0.22 }),
		shaft: MAT.steel({ roughness: 0.14, color: [0.63, 0.63, 0.63], cap: [0.8, 0.79, 0.76], capRough: 0.3 }),
		black: MAT.paint({ color: [0.028, 0.028, 0.03], roughness: 0.46, clearcoat: 0.25 }),
		satin: MAT.satin({ color: [0.035, 0.035, 0.038] }),
		castAl: MAT.aluminium({ roughness: 0.42 }),
		machinedAl: MAT.aluminiumMachined(),
		castIron: MAT.castIron(),
		piston: MAT.aluminiumMachined({ roughness: 0.3, color: [0.78, 0.78, 0.77] }),
		forged: MAT.steelDark({ roughness: 0.36 }),
		pumpAl: MAT.aluminium({ color: [0.86, 0.87, 0.88], roughness: 0.32 }),
		gear: MAT.steel({ roughness: 0.18, finish: 'turned', cap: [0.82, 0.81, 0.78], capRough: 0.28 }),
		tank: MAT.paint({ color: [0.075, 0.08, 0.085], roughness: 0.44, clearcoat: 0.3 }),
		oil: MAT.fluid({ color: [0.55, 0.32, 0.06], roughness: 0.06 }),
		fuel: MAT.glass({ color: [0.98, 0.9, 0.55], transmission: 0.85, thickness: 0.05, roughness: 0.05 }),
		hose: MAT.rubber(),
		brass: MAT.brass({ roughness: 0.28 }),
		capRed: MAT.plastic({ color: [0.55, 0.05, 0.03], roughness: 0.38 }),
		capBlue: MAT.plastic({ color: [0.03, 0.12, 0.45], roughness: 0.38 }),
		plastic: MAT.plastic(),
		paper: MAT.ceramic({ color: [0.82, 0.74, 0.55], roughness: 0.8 }),
		ceramic: MAT.ceramic({ color: [0.9, 0.89, 0.86], roughness: 0.25 }),
		copper: MAT.copper(),
		muffler: MAT.steelDark({ color: [0.2, 0.19, 0.18], roughness: 0.55 }),
		glass: MAT.glass(),
		dial: MAT.enamel(),
		needle: MAT.paint({ color: [0.7, 0.05, 0.03], roughness: 0.3 }),
		yellow: MAT.plastic({ color: [0.85, 0.6, 0.02], roughness: 0.35 }),
		green: MAT.plastic({ color: [0.04, 0.3, 0.12], roughness: 0.35 }),
		battery: MAT.plastic({ color: [0.02, 0.02, 0.022], roughness: 0.5 }),
		lead: MAT.steel({ color: [0.42, 0.42, 0.44], roughness: 0.5, finish: 'cast' }),
		finAl: MAT.aluminium({ color: [0.8, 0.81, 0.82], roughness: 0.35 }),
		vane: MAT.aluminium({ color: [0.52, 0.53, 0.54], roughness: 0.62 }),
		hdpe: MAT.plastic({ color: [0.86, 0.83, 0.74], roughness: 0.55, transmission: 0.45, thickness: 0.02, ior: 1.54 })
	};
}

// ---------------------------------------------------------------- the solver

/** the engine's full-throttle torque (N·m, gross) by speed (rpm) [inferred: peak 63 N·m at 2,600 from a 9.8 bar BMEP, 55.4 at 3,600 from the rated 20.9 kW] */
const TORQUE = { rpm: [0, 600, 1200, 1800, 2200, 2600, 3000, 3600, 4000], nm: [0, 22, 44, 56, 60.5, 63, 61.5, 55.4, 49] };
/** gross to installed (air cleaner, muffler, the shroud's fan) [inferred: 93 %] */
const INSTALLED = 0.93;
const PSI = 6894.76;
/** ISO VG 46 oil's kinematic viscosity (cSt) at a temperature (°C) [from its 46 cSt at 40 °C, 6.8 at 100 °C] */
const viscosity = (/** @type {number} */ T) => 46 * Math.exp(-0.0335 * (T - 40));
/** the most torque the engine gives at any speed its governor lets it run at (N·m, installed) @param {number} set */
const best = (set) => {
	let t = 0;
	for (let n = 600; n <= set * 1.03; n += 25) t = Math.max(t, table(TORQUE.rpm, TORQUE.nm, n) * INSTALLED);
	return t;
};

/**
 * The cube's physics, stepped in time. Everything the page shows comes from here.
 * @param {{ speed: { value: number }, load: { value: number } }} ctl
 */
function solver(ctl) {
	const J = 0.075; // kg·m²: flywheel (~7 kg at 115 mm), crank, rods, coupling and the pump's gears [inferred]
	const etaHM = 0.92, slip0 = 0.06; // the pump's hydro-mechanical efficiency and its slip at 3,000 psi, 3,600 rpm, 50 °C [inferred]
	const kLeak0 = (slip0 * PUMP.D * 60) / (3000 * PSI); // m³/s per Pa at 50 °C (Q_leak = k p)
	const crack = 3000 * PSI, override = 160 * PSI; // the relief cracks at 3,000 psi, +160 psi at the pump's full flow [inferred: 5 %]
	const kLine = (60 * PSI) / Math.pow(57.5 / 60000, 2); // hoses and couplers: 60 psi at 15.2 gpm [inferred]
	const C = 25.7 * 1880 + 20 * 460; // J/K: 26 L of oil and the tank's 20 kg of steel
	const UAcool = 150, UAtank = 12, Tair = 20; // W/K: the six-tube cooler with its fan; the tank and hoses [inferred]
	const HEAT = 20; // the oil's heat shown 20× faster than real
	const s = {
		w: (3600 / 60) * 2 * Math.PI, // rad/s
		theta: 0.4, // the throttle
		set: ctl.speed.value, // rpm the governor holds: the lever's, reached at its own pace
		valves: 1, // how far the work is let on: 0 while it starts with its valves in neutral
		p: 0, // Pa, at the pump
		q: 0, // m³/s from the pump
		qLoad: 0,
		qRelief: 0,
		T: 45, // °C, the oil
		Te: 0,
		Tp: 0,
		hyd: 0, // W to the work
		shaft: 0,
		fuel: 0, // L/h
		stalled: false,
		dead: false,
		stuck: false,
		start: 0, // s left on the starter
		ang: 0, // the crank as shown (rad), slowed
		at: { speed: ctl.speed.value, load: ctl.load.value }
	};
	const rpm = () => (s.w * 60) / (2 * Math.PI);
	/** the engine's torque at a speed and throttle (N·m): its installed curve, less friction closed */
	const engine = (/** @type {number} */ n, /** @type {number} */ th) => {
		const f = 2.5 + 1.2e-3 * n;
		return th * (table(TORQUE.rpm, TORQUE.nm, n) * INSTALLED + f) - f;
	};
	/** @param {number} dt @param {{ broken: boolean }} env */
	function step(dt, env) {
		s.dead = s.stuck = env.broken;
		// stalled: it stays so until the key is turned (a slider moved, or the break taken back)
		if (s.stalled) {
			const moved = Math.abs(ctl.speed.value - s.at.speed) > 1 || Math.abs(ctl.load.value - s.at.load) > 1;
			if (moved && !env.broken) restart();
		}
		const sub = 8, h = dt / sub;
		for (let i = 0; i < sub && !s.stalled; i++) {
			const nNow = rpm();
			// the governor: full throttle below 95 % of the set speed, closed at 103 %, a lag of 0.08 s; the lever's
			// spring moves its setting about 1,500 rpm a second
			s.set += clamp(ctl.speed.value - s.set, -1500 * h, 1500 * h);
			const set = s.set;
			const want = clamp((set * 1.03 - nNow) / (set * 0.08));
			s.theta = approach(s.theta, want, 0.08, h);
			// started with its valves in neutral, the work is let on over 1.5 s once it is up to speed
			if (nNow > set * 0.85) s.valves = Math.min(1, s.valves + h / 1.5);
			// the pump: its flow less its slip (thinner oil slips more)
			const kLeak = kLeak0 * (viscosity(50) / viscosity(s.T));
			const qGeo = PUMP.D * (nNow / 60);
			const pLoad = ctl.load.value * PSI * s.valves;
			if (s.dead) {
				// dead-headed: the oil has nowhere to go but back through the pump's clearances, and the relief may be stuck
				s.qLoad = 0;
				const qOut = Math.max(0, qGeo - kLeak * s.p);
				const relief = s.stuck ? 0 : Math.max(0, (s.p - crack) / override) * (57.5 / 60000);
				// the hoses' and oil's stiffness: β/V (Pa per m³) [inferred: 0.7 GPa over 2 L]
				s.p = Math.max(0, s.p + (0.7e9 / 0.002) * (qOut - relief) * h);
				s.qRelief = relief;
				s.q = qOut;
			} else {
				// the work takes the flow at its pressure; past the relief's setting the relief takes the rest
				let p = pLoad + kLine * qGeo * qGeo;
				let qLoad = Math.max(0, qGeo - kLeak * p), qRelief = 0;
				if (p > crack) {
					for (let k = 0; k < 12; k++) {
						const qOut = Math.max(0, qGeo - kLeak * p);
						qLoad = p > pLoad ? Math.min(qOut, Math.sqrt((p - pLoad) / kLine)) : 0;
						qRelief = Math.max(0, qOut - qLoad);
						p = lerp(p, crack + override * (qRelief / (57.5 / 60000)), 0.5);
					}
				}
				s.p = approach(s.p, p, 0.02, h);
				s.q = Math.max(0, qGeo - kLeak * s.p);
				s.qLoad = qLoad;
				s.qRelief = qRelief;
			}
			// the shaft: the engine's torque against the pump's (and the starter's while it cranks)
			s.Tp = qGeo > 0 ? (PUMP.D * s.p) / (2 * Math.PI * etaHM) + 0.4 : 0;
			s.Te = engine(nNow, s.theta) + (s.start > 0 ? 12 : 0);
			s.start = Math.max(0, s.start - h);
			s.w = Math.max(0, s.w + ((s.Te - s.Tp) / J) * h);
			if (rpm() < 500 && s.start <= 0) {
				s.stalled = true;
				s.w = 0;
				s.p = 0;
				s.q = s.qLoad = s.qRelief = 0;
				s.at = { speed: ctl.speed.value, load: ctl.load.value };
			}
		}
		const nNow = rpm();
		s.hyd = s.p * s.qLoad;
		s.shaft = s.Tp * s.w;
		// heat: the pump's losses, what the relief dumps, the lines', and a quarter of the work's power back in the oil
		const losses = s.shaft - s.p * s.q + s.p * s.qRelief + kLine * s.qLoad ** 3 + 0.25 * s.hyd;
		const out = (UAcool * (s.stalled ? 0.15 : 1) + UAtank) * (s.T - Tair);
		s.T += ((losses - out) / C) * dt * HEAT;
		// petrol: brake specific fuel 0.37 kg/kWh at full load, worse at part load, an idle's worth on top [inferred]
		const P = Math.max(0, s.Te * s.w) / 1000, frac = P / 19.4;
		s.fuel = s.stalled ? 0 : (P * 0.37 * (1 + 0.6 * (1 - frac) ** 2)) / 0.745 + 0.5;
		// the crank as shown: slowed 40 times
		s.ang += (s.w / 40) * dt;
		return { rpm: nNow };
	}
	/** the key turned: it cranks, with the valves in neutral */
	function restart() {
		s.stalled = false;
		s.start = 0.8;
		s.p = 0;
		s.valves = 0;
	}
	return { s, step, rpm, restart };
}

// ---------------------------------------------------------------- the cube

/**
 * The Power Cube v3: a root at its real size, every part its own, its solver running it.
 * @param {{ speed?: number, load?: number }} [o] the engine's set speed (rpm) and the pressure the work needs (psi)
 * @returns {THREE.Group}
 */
export function powerCube({ speed = 3600, load = 1500 } = {}) {
	const root = new THREE.Group();
	root.name = 'Power Cube';
	const M = materials();
	const kit = assetKit(root, { assemblies: ASSEMBLIES, steps: STEPS, sources: SOURCES });
	const { W, L, H, B } = CUBE;
	const X = W / 2, Z = L / 2;
	const g = (/** @type {THREE.Mesh[]} */ ...ms) => {
		const grp = new THREE.Group();
		grp.add(...ms);
		return grp;
	};
	const m = (/** @type {THREE.BufferGeometry} */ geo, /** @type {THREE.Material} */ mat) => kit.mesh(geo, mat);
	/** a part: its meshes, its card and how it is shown */
	const part = (/** @type {any} */ info, /** @type {THREE.Object3D[]} */ objs, /** @type {import('$lib/assets/parts.js').How} */ how = {}, parent = /** @type {THREE.Object3D} */ (root)) => {
		const grp = new THREE.Group();
		grp.add(...objs);
		return kit.part(grp, info, how, parent);
	};

	/* ------------------------------------------------------------ the frame */
	{
		// 4×4 tube, 3/16" wall: hollow, so the cut shows it
		const sq = rrect(0.1016, 0.1016, 0.006);
		sq.holes.push(/** @type {any} */ (rrect(0.1016 - 0.0096, 0.1016 - 0.0096, 0.003)));
		const skid = plate(sq, L, 4);
		part({ id: 'skids', label: 'Base skids (4×4 tube)', assembly: 'frame', count: 2, source: SRC.s7, what: 'Two 4×4 steel tubes front to back under the cube: the strong frame of 7s that the engine, pump and tanks bolt to, and that takes a forklift’s forks, the lifting pins or another cube stacked on it.', specs: [['Stock', '4" × 4" × 3/16" tube (101.6 × 4.8 mm)'], ['Length', '660 mm [inferred: the 27" cube]']] },
			[-1, 1].map((sx) => m(at(skid.clone(), sx * (X - 0.0508), 0.0508, 0), M.red)), { explode: [0, -0.1, 0] });
		const sq2 = rrect(0.0508, 0.0508, 0.004);
		sq2.holes.push(/** @type {any} */ (rrect(0.0508 - 0.0064, 0.0508 - 0.0064, 0.002)));
		const cross = plate(sq2, (X - 0.1016) * 2, 4).rotateY(Math.PI / 2);
		part({ id: 'cross-tubes', label: 'Cross tubes (2×2)', assembly: 'frame', count: 2, source: SRC.s7, what: 'Two 2×2 tubes welded between the skids at front and back, squaring the base.', specs: [['Stock', '2" × 2" × 1/8" tube']] },
			[-1, 1].map((sz) => m(at(cross.clone(), 0, 0.0762, sz * (Z - 0.04)), M.red)), { explode: [0, -0.1, 0] });
		// 2×2×1/4 angle: two legs
		const leg = 0.0508, t = 0.00635;
		/** an upright angle at a corner, its outside corner outwards */
		const post = (/** @type {number} */ sx, /** @type {number} */ sz) => {
			const h = H - B, cx = sx * (X - t / 2), cz = sz * (Z - t / 2);
			return GEO.merge([at(box(t, h, leg, 0.0012), cx, B + h / 2, cz - (sz * (leg - t)) / 2), at(box(leg, h, t, 0.0012), cx - (sx * (leg - t)) / 2, B + h / 2, cz)]);
		};
		part({ id: 'posts', label: 'Corner posts (2×2 angle)', assembly: 'frame', count: 4, source: SRC.vii, what: 'Four corner posts of 1/4" × 2" × 2" angle make the cage: they guard the engine, carry the rails and give hand-holds to lift it by.', specs: [['Stock', '1/4" × 2" × 2" angle (6.35 × 50.8 × 50.8 mm)'], ['Envelope', '27" (686 mm) cube']] },
			[m(GEO.merge([post(-1, -1), post(-1, 1), post(1, -1), post(1, 1)]), M.red)], { explode: [0, 0, 0] });
		/** a top rail along x or z, its outside corner up and out */
		const rail = (/** @type {'x' | 'z'} */ ax, /** @type {number} */ s) => {
			const y = H - t / 2;
			if (ax === 'x') return GEO.merge([at(box(W - 0.002, t, leg, 0.0012), 0, y, s * (Z - leg / 2)), at(box(W - 0.002, leg, t, 0.0012), 0, H - leg / 2, s * (Z - t / 2))]);
			return GEO.merge([at(box(leg, t, L - 0.002, 0.0012), s * (X - leg / 2), y, 0), at(box(t, leg, L - 0.002, 0.0012), s * (X - t / 2), H - leg / 2, 0)]);
		};
		part({ id: 'top-rails', label: 'Top rails (2×2 angle)', assembly: 'frame', count: 4, source: SRC.vii, what: 'Four rails round the top of the cage: OSE’s frame cuts its members 29", 27" and 24" long. The lifting eyes and the fuel tank’s rails hang on them.', specs: [['Stock', '1/4" × 2" × 2" angle']] },
			[m(GEO.merge([rail('x', -1), rail('x', 1), rail('z', -1), rail('z', 1)]), M.red)], { explode: [0, 0.16, 0] });
		part({ id: 'tank-rails', label: 'Fuel tank rails', assembly: 'frame', count: 2, source: SRC.vii, what: 'Two angles across the cage under the top, the fuel tank resting on them, clear of the engine’s air cleaner.', specs: [['Stock', '1/8" × 1-1/2" angle'], ['Height', '565 mm [inferred]']] },
			[-0.115, 0.27].map((z) => m(GEO.merge([at(box(W - 0.1, 0.0032, 0.038, 0.001), 0, 0.5634, z), at(box(W - 0.1, 0.038, 0.0032, 0.001), 0, 0.5634 - 0.019, z + 0.0174)]), M.red)), { explode: [0, 0.1, 0] });
		part({ id: 'engine-plate', label: 'Engine mount plate', assembly: 'frame', source: SRC.vii, what: 'A 1/2" plate across the skids: the engine’s base bolts to it, and the pump’s bracket behind, so their shafts stay on one line.', specs: [['VII engine module plate', '8" × 15½" (203 × 394 mm), here one piece with the pump’s [inferred]'], ['Thickness', '1/2" (12.7 mm)']] },
			[m(at(box(W - 0.06, 0.0127, 0.49, 0.002), 0, B + 0.00635, -0.015), M.zinc), m(GEO.merge([-0.31, 0.31].flatMap((x) => [-0.23, 0.2].map((z) => hex([x, B + 0.0127, z], [0, 1, 0], 0.011, 0.009)))), M.zinc)], { explode: [0, -0.06, 0] });
		// the quick-attach: plates across the back, a receiver tube between them, two pins
		const qa = [];
		for (const y of [0.162, 0.322]) qa.push(m(at(box(W - 0.04, 0.1016, 0.0095, 0.002), 0, y, -Z - 0.0048), M.red));
		const recv = rrect(0.2032, 0.1016, 0.006);
		recv.holes.push(/** @type {any} */ (rrect(0.2032 - 0.0127, 0.1016 - 0.0127, 0.003)));
		qa.push(m(at(plate(recv, 0.07, 4), 0, 0.2416, -Z - 0.044), M.red));
		for (const sx of [-1, 1]) qa.push(m(cyl([sx * 0.12, 0.372, -Z - 0.03], [sx * 0.12, 0.43, -Z - 0.03], 0.012, 20), M.zinc));
		part({ id: 'quick-attach', label: 'Quick-attach plates and receiver', assembly: 'frame', source: SRC.man, what: 'How the cube is coupled to a machine: plates across its back with a 4×8 receiver tube between them, so it slides onto the machine’s mount and is pinned, and comes off again in minutes for the next machine.', specs: [['Plates', '2 × 3/8" × 4" × 27"'], ['Receiver tube', '4" × 8" × 1/4"'], ['Pins', '2 × 1" [inferred]']] }, qa, { explode: [0, 0, -0.16] });
		const eye = new THREE.TorusGeometry(0.026, 0.0075, 12, 28);
		part({ id: 'lift-eyes', label: 'Lifting eyes', assembly: 'frame', count: 2, source: SRC.vii, what: 'Two eyes welded on the top rails: at about 181 kg the cube is lifted on and off a machine by the loader, a hoist or two people with a bar.', specs: [['Cube mass', '~400 lb (181 kg)']] },
			[-1, 1].map((sx) => m(at(eye.clone(), sx * (X - 0.028), H + 0.02, 0), M.zinc)), { explode: [0, 0.2, 0] });
	}

	/* ------------------------------------------------------------ the engine */
	const C = new THREE.Vector3(0, CRANK.y, CRANK.z);
	const r = ENGINE.stroke / 2;
	/** a bank's axis: its angle from upright, towards +x for the right bank */
	const banks = /** @type {const} */ ([['left', -1], ['right', 1]]);
	/** the banks sit a rod's width apart along the crank, their two rods side by side on one pin */
	const off = (/** @type {number} */ sx) => sx * 0.0125;
	const axis = (/** @type {number} */ sx) => new THREE.Vector3(sx * Math.sin(ENGINE.bank), Math.cos(ENGINE.bank), 0);
	/** a geometry made upright on its own +y, turned onto a bank's axis and set on the crank */
	const onBank = (/** @type {THREE.BufferGeometry} */ geo, /** @type {number} */ sx) => geo.rotateZ(-sx * ENGINE.bank).translate(C.x, C.y, C.z + off(sx));
	/** @type {Record<string, THREE.Group>} */
	const moving = {};
	{
		// the crankcase: a ribbed casting with the two cylinder bosses, its sump flange on the plate
		const cc = [m(at(box(0.25, 0.2, 0.29, 0.035), 0, 0.226, 0.03), M.black), m(at(box(0.3, 0.018, 0.3, 0.004), 0, B + 0.0127 + 0.009, 0.03), M.black)];
		for (const [, sx] of banks) cc.push(m(onBank(latheZ([[0, 0], [0.068, 0], [0.068, 0.012], [0, 0.012]], 40).rotateX(-Math.PI / 2).translate(0, 0.088, 0), sx), M.black));
		cc.push(m(GEO.merge([-0.135, 0.135].flatMap((x) => [-0.08, 0.14].map((z) => hex([x, B + 0.0217, z], [0, 1, 0], 0.008, 0.008)))), M.zinc));
		cc.push(m(at(latheZ([[0, -0.115], [0.06, -0.115], [0.06, -0.125], [0, -0.125]], 40), 0, CRANK.y, 0), M.black)); // the PTO end's seal housing
		part({ id: 'crankcase', label: 'Crankcase', assembly: 'engine', source: SRC.eng, what: 'The engine’s cast block: it carries the crankshaft in its two main bearings, the camshaft and the governor, holds the oil in its sump, and bolts to the plate by its flange.', specs: [['Engine', '810 cc 90° V-twin, OHV, air-cooled'], ['Rated', '28 hp (20.9 kW) gross at 3,600 rpm'], ['Oil', '~1.9 L SAE 30 [inferred]'], ['Dry mass', '~42 kg (92 lb)']] }, cc, { explode: [0, 0.02, 0.02], xray: 'shell', tag: { at: [-0.12, 0.25, 0.1], value: () => `${fmt(sim.rpm())} rpm · ${fmt(Math.max(0, sim.s.Te) * sim.s.w / 1000, 1)} kW` , text: 'Engine', side: 'left' } });

		// the crankshaft: mains, two webs with counterweights, one pin for both rods
		const crank = new THREE.Group();
		crank.position.copy(C);
		const web = new THREE.Shape();
		web.moveTo(-0.022, r);
		web.absarc(0, r, 0.022, Math.PI, 0, true);
		web.lineTo(0.034, 0);
		web.absarc(0, 0, 0.062, 0, -Math.PI, true);
		web.lineTo(-0.034, 0);
		web.lineTo(-0.022, r);
		crank.add(
			m(rodZ(0.0175, -0.165, -0.052), M.shaft),
			m(rodZ(0.0175, 0.052, 0.205), M.shaft),
			m(at(ext(web, 0.016, 0.001), 0, 0, -0.044), M.forged),
			m(at(ext(web, 0.016, 0.001), 0, 0, 0.044), M.forged),
			m(at(rodZ(0.019, -0.036, 0.036), 0, r, 0), M.shaft)
		);
		part({ id: 'crankshaft', label: 'Crankshaft', assembly: 'engine', source: SRC.eng, what: 'One forged crank for both cylinders: their two rods share one pin, the counterweights balance them, its front end carries the flywheel and its back end drives the pump.', moves: 'Turns at engine speed (shown slowed 40 times).', drive: 'The pistons, through the rods; it drives the pump', specs: [['Throw', `${fmt(r * 1000, 1)} mm (stroke 73.4 mm)`], ['Main journals', 'Ø 35 mm [inferred]'], ['Speed', '3,600 rpm governed']] }, [crank], { explode: [0, -0.02, 0] });
		moving.crank = crank;

		for (const [side, sx] of banks) {
			const d = axis(sx);
			// the barrel: a cast-iron liner in square aluminium fins, an air gap between the fins
			const fin = rrect(0.128, 0.128, 0.012);
			fin.holes.push(ring(0, 0, ENGINE.bore / 2 + 0.006));
			const fins = [];
			for (let k = 0; k < 12; k++) fins.push(at(plate(fin, 0.0026, 6), 0, 0, 0.1 + k * 0.0072).rotateX(-Math.PI / 2));
			const finGeo = GEO.merge(fins);
			const liner = GEO.lathe([[ENGINE.bore / 2, 0.095], [ENGINE.bore / 2 + 0.0065, 0.095], [ENGINE.bore / 2 + 0.0065, ENGINE.deck], [ENGINE.bore / 2, ENGINE.deck]], 48);
			const barrel = new THREE.Group();
			barrel.add(m(onBank(finGeo, sx), M.castAl), m(onBank(liner, sx), M.castIron));
			part({ id: `cylinder-${side}`, label: `Cylinder, ${side}`, assembly: 'engine', source: SRC.eng, what: 'One bank of the 90° V: a cast-iron liner the piston runs in, cast into square aluminium fins that the flywheel’s fan blows air over.', specs: [['Bore', '83.8 mm (3.30")'], ['Swept', '405 cm³'], ['Cooling', 'Air, by the flywheel fan']] }, [barrel], { explode: d.clone().multiplyScalar(0.1).toArray(), xray: 'shell' });
			// the head: finned, its rocker cover, the spark plug
			const head = new THREE.Group();
			const hb = at(box(0.13, 0.05, 0.13, 0.01), 0, ENGINE.deck + 0.025, 0);
			const hfins = [];
			for (let k = 0; k < 4; k++) hfins.push(at(slab(0.146, 0.0028, 0.146), 0, ENGINE.deck + 0.008 + k * 0.011, 0));
			head.add(m(onBank(GEO.merge([hb, ...hfins]), sx), M.castAl));
			head.add(m(onBank(at(box(0.11, 0.032, 0.1, 0.012), 0, ENGINE.deck + 0.066, 0), sx), M.black));
			head.add(m(onBank(GEO.merge([-1, 1].flatMap((a) => [-1, 1].map((b) => at(new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 6), a * 0.042, ENGINE.deck + 0.084, b * 0.036)))), sx), M.zinc));
			// the plug: on the head's front, pointing forward and out
			const plugAt = C.clone().addScaledVector(d, ENGINE.deck + 0.03).add(new THREE.Vector3(0, 0, 0.065 + off(sx)));
			const plug = [m(cyl(plugAt.toArray(), plugAt.clone().add(new THREE.Vector3(0, 0, 0.012)).toArray(), 0.0095, 6), M.zinc), m(cyl(plugAt.clone().add(new THREE.Vector3(0, 0, 0.012)).toArray(), plugAt.clone().add(new THREE.Vector3(0, 0, 0.036)).toArray(), 0.0055, 20), M.ceramic), m(cyl(plugAt.clone().add(new THREE.Vector3(0, 0, 0.03)).toArray(), plugAt.clone().add(new THREE.Vector3(sx * 0.01, 0, 0.065)).toArray(), 0.009, 20), M.satin)];
			plug.push(m(hose([plugAt.clone().add(new THREE.Vector3(sx * 0.01, 0, 0.065)).toArray(), [sx * 0.15, 0.36, 0.2], [sx * 0.13, 0.33, 0.215]], 0.0035), M.satin));
			part({ id: `head-${side}`, label: `Cylinder head, ${side}`, assembly: 'engine', source: SRC.eng, what: 'The overhead-valve head: its inlet and exhaust valves under the rocker cover, the combustion chamber over the piston, and the spark plug in its front.', specs: [['Valves', 'OHV, 2 per cylinder'], ['Compression', '8.4 : 1']] }, [head], { explode: d.clone().multiplyScalar(0.2).toArray() });
			part({ id: `plug-${side}`, label: `Spark plug and lead, ${side}`, assembly: 'engine', source: SRC.eng, what: 'The plug in the head, its boot and the lead to its ignition coil at the flywheel: a spark each turn, fired by the flywheel’s magnet.', specs: [['Gap', '0.76 mm [inferred]']] }, plug, { explode: [sx * 0.08, 0.1, 0.14] });
			// the piston and rod: moved by the solver's crank
			const piston = new THREE.Group();
			const pr = ENGINE.bore / 2 - 0.0002;
			piston.add(
				m(GEO.lathe([[0, 0.03], [pr - 0.002, 0.03], [pr, 0.028], [pr, 0.022], [pr - 0.0015, 0.022], [pr - 0.0015, 0.0195], [pr, 0.0195], [pr, 0.016], [pr - 0.0015, 0.016], [pr - 0.0015, 0.0135], [pr, 0.0135], [pr, -0.026], [pr - 0.004, -0.026], [pr - 0.004, 0.022], [0, 0.022]], 48), M.piston),
				m(cyl([-0.026, 0, 0], [0.026, 0, 0], 0.0095, 20).rotateY(Math.PI / 2), M.shaft)
			);
			const rod = new THREE.Group();
			const beam = new THREE.Shape();
			beam.moveTo(-0.011, 0.02);
			beam.lineTo(-0.007, ENGINE.rod - 0.012);
			beam.lineTo(0.007, ENGINE.rod - 0.012);
			beam.lineTo(0.011, 0.02);
			beam.lineTo(-0.011, 0.02);
			const big = rrect(0.05, 0.05, 0.024);
			big.holes.push(ring(0, 0, 0.0195));
			const small = rrect(0.026, 0.026, 0.0125);
			small.holes.push(ring(0, 0, 0.0096));
			rod.add(m(GEO.merge([ext(beam, 0.011, 0.0006), ext(big, 0.014, 0.0008), at(ext(small, 0.012, 0.0006), 0, ENGINE.rod, 0)]), M.forged));
			const pz = new THREE.Group(), rz = new THREE.Group();
			pz.position.z = rz.position.z = CRANK.z + off(sx);
			part({ id: `piston-${side}`, label: `Piston, ${side}`, assembly: 'engine', source: SRC.eng, what: 'An aluminium piston with two compression rings and an oil ring, on a hardened pin: the burning charge pushes it down 405 cm³ a stroke.', moves: 'Up and down its cylinder, twice a turn of the crank for its four strokes.', drive: 'The burning charge; it turns the crank through its rod', specs: [['Diameter', '83.8 mm'], ['Stroke', '73.4 mm']] }, [piston], { explode: d.clone().multiplyScalar(0.3).toArray() }, pz);
			part({ id: `rod-${side}`, label: `Connecting rod, ${side}`, assembly: 'engine', source: SRC.eng, what: 'The forged rod from the piston’s pin to the crank’s pin, beside its twin on the same pin.', moves: 'Swings and slides with the crank.', drive: 'The piston', specs: [['Centres', '116 mm [inferred]']] }, [rod], { explode: d.clone().multiplyScalar(0.18).toArray() }, rz);
			root.add(pz, rz);
			moving[`piston-${side}`] = piston;
			moving[`rod-${side}`] = rod;
		}

		// the flywheel: its fan vanes and ring gear, on the crank's front end
		const fly = new THREE.Group();
		fly.position.copy(C);
		fly.add(m(latheZ([[0.015, 0.185], [0.1, 0.185], [0.11, 0.19], [0.11, 0.215], [0.06, 0.218], [0.03, 0.225], [0.015, 0.225]], 72), M.castIron));
		const vane = slab(0.07, 0.003, 0.03);
		const vanes = [];
		for (let k = 0; k < 18; k++) vanes.push(at(vane.clone(), 0.07, 0, 0).rotateZ((k / 18) * Math.PI * 2 + 0.3).translate(0, 0, 0.232));
		fly.add(m(GEO.merge(vanes), M.vane));
		fly.add(m(at(ringGear(112, 0.002, 0.011), 0, 0, 0.192), M.steel));
		fly.add(m(at(rodZ(0.024, 0.205, 0.245), 0, 0, 0), M.zinc));
		const screen = new THREE.Shape();
		screen.absarc(0, 0, 0.1, 0, Math.PI * 2, false);
		for (let k = 0; k < 24; k++) {
			const a = (k / 24) * Math.PI * 2;
			screen.holes.push(ring(0.065 * Math.cos(a), 0.065 * Math.sin(a), 0.012));
			if (k % 2 === 0) screen.holes.push(ring(0.035 * Math.cos(a + 0.13), 0.035 * Math.sin(a + 0.13), 0.009));
		}
		const scr = m(at(plate(screen, 0.0025, 10), 0, 0, 0.25), M.satin);
		part({ id: 'flywheel', label: 'Flywheel, fan and ring gear', assembly: 'engine', source: SRC.eng, what: 'Cast iron at the crank’s front: its weight smooths the twin’s firing, its magnets fire the plugs and charge the battery, its vanes are the cooling fan, and its ring gear takes the starter.', moves: 'Turns with the crankshaft (shown slowed 40 times).', drive: 'The crankshaft', specs: [['Diameter', '230 mm'], ['Ring gear', '112 teeth [inferred]'], ['Inertia', '~0.05 kg·m² [inferred]']] }, [fly], { explode: [0, 0, 0.24] });
		part({ id: 'screen', label: 'Rotating screen', assembly: 'engine', source: SRC.eng, what: 'The perforated disc on the flywheel’s face: it turns with it and flings off grass and chaff before the fan draws its air in.', moves: 'Turns with the flywheel.', drive: 'The crankshaft' }, [scr], { explode: [0, 0, 0.36] }, fly);
		moving.fly = fly;

		// the blower housing: a sheet steel shroud over the flywheel, ducting its air back over the fins
		const face = rrect(0.47, 0.4, 0.07);
		face.holes.push(ring(0, -0.06, 0.112));
		const shroud = [m(at(ext(face, 0.003, 0.001), 0, CRANK.y + 0.06, 0.262), M.black)];
		// the opening's rolled lip, two pressed ribs over it, the screws that hold it to the engine
		shroud.push(m(at(new THREE.TorusGeometry(0.115, 0.005, 10, 72), 0, CRANK.y, 0.264), M.black));
		for (const y of [0.17, 0.2]) shroud.push(m(cyl([-0.17, CRANK.y + y, 0.2635], [0.17, CRANK.y + y, 0.2635], 0.004, 12), M.black));
		shroud.push(m(GEO.merge([-1, 1].flatMap((sx) => [-0.11, 0.21].map((y) => hex([sx * 0.2, CRANK.y + y, 0.2635], [0, 0, 1], 0.005, 0.004)))), M.zinc));
		shroud.push(m(at(box(0.47, 0.003, 0.11, 0.001), 0, CRANK.y + 0.26, 0.205), M.black));
		for (const sx of [-1, 1]) shroud.push(m(at(box(0.003, 0.36, 0.11, 0.001), sx * 0.235, CRANK.y + 0.08, 0.205), M.black));
		for (const sx of [-1, 1]) shroud.push(m(at(box(0.16, 0.003, 0.15, 0.001), sx * 0.15, CRANK.y + 0.22, 0.09), M.black));
		part({ id: 'blower', label: 'Blower housing', assembly: 'engine', source: SRC.eng, what: 'The pressed-steel shroud over the flywheel, ducting its fan’s air back over both cylinders’ fins.', specs: [['Material', 'Pressed steel, painted']] }, shroud, { explode: [0, 0.05, 0.34], xray: 'shell' });

		// the carburettor and manifold in the V, the air cleaner over them
		const carb = [m(at(box(0.055, 0.05, 0.06, 0.008), 0, 0.42, CRANK.z), M.castAl), m(cyl([0, 0.445, CRANK.z], [0, 0.47, CRANK.z], 0.022, 28), M.castAl)];
		for (const sx of [-1, 1]) {
			const port = C.clone().addScaledVector(axis(sx), ENGINE.deck + 0.02).add(new THREE.Vector3(-sx * 0.05, 0, -0.03));
			carb.push(m(hose([[sx * 0.02, 0.42, CRANK.z - 0.015], [sx * 0.05, 0.42, CRANK.z - 0.03], port.toArray()], 0.012), M.castAl));
		}
		const lever = m(at(box(0.004, 0.035, 0.012, 0.001), 0, 0.0175, 0), M.zinc);
		const throttle = new THREE.Group();
		throttle.position.set(0.032, 0.42, CRANK.z + 0.02);
		throttle.add(lever);
		carb.push(/** @type {any} */ (throttle));
		part({ id: 'carburettor', label: 'Carburettor and intake', assembly: 'engine', source: SRC.eng, what: 'In the V: the carburettor mixes petrol into the air the cleaner gives it, its throttle opened by the governor, and the manifold carries the charge to both heads.', moves: 'Its throttle plate opens and closes with the governor.', drive: 'The governor', specs: [['Throttle', 'Butterfly, governed'], ['Choke', 'Cable, from the panel']] }, carb, { explode: [0, 0.16, 0.1] });
		moving.throttle = throttle;
		const element = GEO.lathe([[0.05, 0.482], [0.08, 0.482], [0.08, 0.525], [0.05, 0.525]], 72);
		const pos = element.attributes.position;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i), z = pos.getZ(i), a = Math.atan2(z, x), rr = Math.hypot(x, z);
			if (rr > 0.075) {
				const k = 1 + 0.06 * Math.cos(a * 36);
				pos.setX(i, x * k);
				pos.setZ(i, z * k);
			}
		}
		element.computeVertexNormals();
		const cleaner = [m(at(box(0.22, 0.012, 0.17, 0.004), 0, 0.476, CRANK.z), M.black), m(at(element, 0, 0, CRANK.z), M.paper), m(at(box(0.23, 0.03, 0.18, 0.012), 0, 0.538, CRANK.z), M.plastic), m(cyl([0, 0.553, CRANK.z], [0, 0.562, CRANK.z], 0.015, 6), M.yellow)];
		part({ id: 'air-cleaner', label: 'Air cleaner', assembly: 'engine', source: SRC.eng, what: 'Over the V: a pleated paper element in a plastic cover. Every litre of air the engine breathes, about 45 litres a second at full speed, is cleaned here first.', specs: [['Element', 'Pleated paper, foam pre-cleaner'], ['Air', `~${fmt((ENGINE.Vd * 3600) / 120 * 1000 * 0.85)} L/s at 3,600 rpm [computed: 85 % filling]`]] }, cleaner, { explode: [0, 0.28, 0], xray: 'shell' });

		// the muffler on the left, its pipes from both heads
		const muff = [m(cyl([-0.255, 0.3, -0.095], [-0.255, 0.3, 0.085], 0.05, 40), M.muffler)];
		for (const z of [-0.095, 0.085]) muff.push(m(cyl([-0.255, 0.3, z], [-0.255, 0.3, z + (z < 0 ? -0.004 : 0.004)], 0.052, 40), M.muffler));
		muff.push(m(cyl([-0.255, 0.3, 0.089], [-0.255, 0.3, 0.12], 0.012, 20), M.muffler));
		const exL = C.clone().addScaledVector(axis(-1), ENGINE.deck + 0.02).add(new THREE.Vector3(-0.02, 0, -0.06));
		const exR = C.clone().addScaledVector(axis(1), ENGINE.deck + 0.02).add(new THREE.Vector3(0.02, 0, -0.06));
		muff.push(m(hose([exL.toArray(), [-0.23, 0.36, -0.05], [-0.255, 0.33, -0.06]], 0.0115), M.muffler));
		muff.push(m(hose([exR.toArray(), [0.1, 0.4, -0.075], [-0.1, 0.4, -0.085], [-0.22, 0.34, -0.08], [-0.255, 0.32, -0.07]], 0.0115), M.muffler));
		part({ id: 'muffler', label: 'Muffler and exhaust', assembly: 'engine', source: SRC.vii, what: 'Both exhausts into one can on the cube’s left side, the right one crossing behind the cylinders; it blows out forward, away from the couplers.', specs: [['Pipes', 'Ø 23 mm [inferred]'], ['Can', 'Ø 100 × 180 mm [inferred]']] }, muff, { explode: [-0.18, 0.04, 0], xray: 'shell' });

		// the starter on the left, the oil filter and dipstick on the right
		part({ id: 'starter', label: 'Electric starter', assembly: 'engine', source: SRC.vii, what: 'The 12 V starter whose pinion meshes with the flywheel’s ring gear while the key is held to START.', moves: 'Spins only while starting.', drive: 'The battery, through its solenoid', specs: [['Voltage', '12 V'], ['Power', '~0.9 kW [inferred]']] },
			[m(cyl([-0.155, 0.17, 0.06], [-0.155, 0.17, 0.17], 0.036, 32), M.black), m(cyl([-0.155, 0.17, 0.17], [-0.155, 0.17, 0.19], 0.024, 28), M.castAl), m(cyl([-0.108, 0.186, 0.2], [-0.108, 0.186, 0.226], 0.013, 10), M.steel), m(cyl([-0.155, 0.218, 0.08], [-0.155, 0.218, 0.15], 0.018, 24), M.zinc)], { explode: [-0.16, 0, 0.06] });
		part({ id: 'oil-filter', label: 'Oil filter and dipstick', assembly: 'engine', source: SRC.eng, what: 'The engine’s full-pressure lubrication: a spin-on filter low on its right side, and the dipstick tube to fill and check the oil.', specs: [['Filter', 'Spin-on, Ø 76 mm [inferred]']] },
			[m(cyl([0.125, 0.165, -0.05], [0.205, 0.165, -0.05], 0.038, 32), M.capBlue), m(hose([[0.1, 0.25, 0.12], [0.13, 0.33, 0.13], [0.13, 0.4, 0.13]], 0.007), M.black), m(cyl([0.13, 0.4, 0.13], [0.13, 0.425, 0.13], 0.012, 16), M.yellow)], { explode: [0.16, 0, 0] });
		const ign = [];
		for (const sx of [-1, 1]) ign.push(m(at(box(0.04, 0.05, 0.03, 0.005), sx * 0.13, CRANK.y + 0.12, 0.2), M.satin));
		part({ id: 'ignition', label: 'Ignition coils', assembly: 'engine', count: 2, source: SRC.eng, what: 'One coil beside the flywheel’s rim for each plug: its magnet sweeping past them makes the spark, no battery needed.', specs: [['Type', 'Magneto armature']] }, ign, { explode: [0, 0.12, 0.12] });
		const gov = [m(cyl([0.03, 0.36, -0.02], [0.03, 0.42, 0.04], 0.0025, 8), M.zinc), m(at(box(0.012, 0.05, 0.006, 0.001), 0.03, 0.34, -0.03), M.zinc)];
		part({ id: 'governor', label: 'Governor and linkage', assembly: 'engine', source: SRC.eng, what: 'Flyweights inside the crankcase push a lever out as the speed rises; its rod closes the throttle, so the engine holds its set speed whatever the pump asks, drooping a little under load.', moves: 'Opens and closes the throttle.', drive: 'Flyweights on the camshaft gear', specs: [['Droop', '~5 % [inferred]'], ['Set speed', 'From the panel’s throttle']] }, gov, { explode: [0.06, 0.14, 0] });
	}

	/* ------------------------------------------------------------ the hydraulics */
	{
		// the coupling: OSE's welded sleeve
		const cpl = new THREE.Group();
		cpl.position.copy(C);
		cpl.add(m(latheZ([[0.0, -0.245], [0.034, -0.245], [0.034, -0.206], [0.036, -0.204], [0.036, -0.2], [0.034, -0.198], [0.034, -0.158], [0, -0.158]], 48), M.steel));
		cpl.add(m(GEO.merge([-0.228, -0.175].map((z) => at(cyl([0, 0.032, 0], [0, 0.04, 0], 0.005, 6), 0, 0, z))), M.satin));
		part({ id: 'coupling', label: 'Shaft coupling', assembly: 'hydraulics', source: SRC.port, what: 'Not a bought jaw coupling: OSE cut two coupling halves and welded them into one sleeve, keyed and set-screwed onto the engine’s shaft, splined onto the pump’s.', moves: 'Turns with the engine (shown slowed).', drive: 'The crankshaft; it drives the pump', specs: [['Engine side', '1" keyed, set screws'], ['Pump side', '3/4" spline, 11 teeth [inferred]'], ['Made', 'Two halves cut and welded']] }, [cpl], { explode: [0, 0, -0.1] });
		moving.cpl = cpl;
		// the pump bracket: an upright plate bolted to the engine plate
		const brk = rrect(0.2, 0.2, 0.01);
		brk.holes.push(ring(0, 0.0, 0.042));
		part({ id: 'pump-bracket', label: 'Pump bracket', assembly: 'hydraulics', source: SRC.vii, what: 'An upright plate on the engine plate holding the pump’s SAE-A flange square to the engine, so the two shafts stay on one line.', specs: [['Plate', '1/2" (12.7 mm)'], ['Flange', 'SAE A: Ø 82.55 mm pilot, 2 bolts on 106.4 mm']] },
			[m(at(ext(brk, 0.0127, 0.001), 0, CRANK.y, -0.2235), M.zinc), m(at(box(0.2, 0.0127, 0.06, 0.002), 0, B + 0.0127 + 0.0064, -0.2), M.zinc), m(GEO.merge([-1, 1].map((sx) => at(box(0.0095, 0.09, 0.05, 0.001), sx * 0.08, B + 0.0127 + 0.045, -0.2))), M.zinc)], { explode: [0, 0, -0.18] });
		// the pump: flange, figure-eight body, cover, through-bolts, its two gears inside
		const pump = new THREE.Group();
		pump.position.set(0, CRANK.y, 0);
		const flange = new THREE.Shape();
		flange.moveTo(-0.0532, 0.012);
		flange.absarc(-0.0532, 0, 0.012, Math.PI / 2, Math.PI * 1.5, false);
		flange.lineTo(-0.02, -0.04);
		flange.lineTo(0.02, -0.04);
		flange.lineTo(0.0532, -0.012);
		flange.absarc(0.0532, 0, 0.012, -Math.PI / 2, Math.PI / 2, false);
		flange.lineTo(0.02, 0.04 + 0.03);
		flange.lineTo(-0.02, 0.04 + 0.03);
		flange.lineTo(-0.0532, 0.012);
		flange.holes.push(ring(-0.0532, 0, 0.0055), ring(0.0532, 0, 0.0055), ring(0, 0, 0.012));
		const z0 = PUMP.z0, bw = PUMP.width;
		const tip = (PUMP.teeth * PUMP.module) / 2 + PUMP.module + 0.0002, cd = PUMP.teeth * PUMP.module;
		const eight = new THREE.Path();
		const yi = cd / 2, xi = Math.sqrt(tip * tip - yi * yi);
		eight.moveTo(xi, yi);
		eight.absarc(0, cd, tip, Math.atan2(yi - cd, xi), Math.atan2(yi - cd, -xi) + Math.PI * 2, false);
		eight.absarc(0, 0, tip, Math.atan2(yi, -xi), Math.atan2(yi, xi) + Math.PI * 2, false);
		const bodyShift = new THREE.Shape(rrect(0.09, 0.115, 0.012).getPoints(8).map((p) => new THREE.Vector2(p.x, p.y + cd / 2)));
		bodyShift.holes.push(eight);
		pump.add(m(at(ext(flange, 0.01, 0.0008), 0, 0, z0 - 0.003), M.pumpAl));
		const bodyM = m(at(ext(bodyShift, bw, 0.0006), 0, 0, z0 - 0.01 - bw / 2), M.pumpAl);
		const cover = m(at(ext(new THREE.Shape(rrect(0.09, 0.115, 0.012).getPoints(8).map((p) => new THREE.Vector2(p.x, p.y + cd / 2))), 0.016, 0.0015), 0, 0, z0 - 0.01 - bw - 0.008), M.pumpAl);
		const tb = GEO.merge([-1, 1].flatMap((sx) => [-1, 1].map((sy) => hex([sx * 0.034, cd / 2 + sy * 0.045, z0 - 0.01 - bw - 0.016], [0, 0, -1], 0.0065, 0.008))));
		// the ports: suction (wide) on the left, pressure on the right
		const ports = [m(cyl([-0.045, cd / 2, z0 - 0.01 - bw / 2], [-0.066, cd / 2, z0 - 0.01 - bw / 2], 0.019, 6), M.zinc), m(cyl([0.045, cd / 2, z0 - 0.01 - bw / 2], [0.06, cd / 2, z0 - 0.01 - bw / 2], 0.0135, 6), M.zinc)];
		pump.add(bodyM, cover, m(tb, M.zinc), ...ports);
		part({ id: 'pump', label: 'Hydraulic gear pump', assembly: 'hydraulics', source: SRC.port, what: 'A fixed-displacement external gear pump: two gears mesh and carry oil round the outside of their teeth from the suction port to the pressure port, about a cubic inch every turn. This flow is everything the machine it is coupled to can do.', moves: 'Its gears turn with the engine.', drive: 'The engine, through the coupling', specs: [['Displacement', '0.976 in³ (16.0 cm³) a turn'], ['Flow', '15.2 gpm (57.5 L/min) at 3,600 rpm, less its slip'], ['Pressure', '3,000 psi (207 bar) max'], ['Gears', '12 teeth, module 2.5, 34 mm wide [inferred]']] }, [pump], { explode: [0, 0, -0.28], xray: 'shell', tag: { text: 'Gear pump', at: [0.05, CRANK.y + 0.04, z0 - 0.03], value: () => `${fmt((sim.s.q * 60000), 1)} L/min · ${fmt(sim.s.p / PSI)} psi`, side: 'right' } });
		const gears = new THREE.Group();
		gears.position.set(0, CRANK.y, 0);
		const gearGeo = GEO.gear({ teeth: PUMP.teeth, module: PUMP.module, width: bw - 0.0004, bore: 0.009 });
		const drive = m(at(gearGeo.clone(), 0, 0, 0), M.gear);
		const idler = m(at(gearGeo.clone(), 0, 0, 0), M.gear);
		const driveG = new THREE.Group(), idlerG = new THREE.Group();
		driveG.position.set(0, 0, z0 - 0.01 - bw / 2);
		idlerG.position.set(0, cd, z0 - 0.01 - bw / 2);
		driveG.add(drive, m(rodZ(0.0095, -0.04, 0.05), M.shaft));
		idlerG.add(idler, m(rodZ(0.0095, -0.022, 0.022), M.shaft));
		gears.add(driveG, idlerG);
		part({ id: 'pump-gears', label: 'Pump gears', assembly: 'hydraulics', source: SRC.port, what: 'The drive gear on the pump’s shaft and the idler it turns: oil trapped between their teeth and the housing is carried round the outside from suction to pressure, and the meshing teeth push it out.', moves: 'Turn against each other at engine speed.', drive: 'The pump’s shaft', specs: [['Teeth', '12 each [inferred]'], ['Displacement', '2π m² z b ≈ 16 cm³ a turn']] }, [gears], { explode: [0, 0.03, -0.42] });
		moving.drive = driveG;
		moving.idler = idlerG;

		// the reservoir: six steel walls, a baffle, the oil, the strainer
		const rv = { x0: -0.297, x1: 0.297, y0: 0.335, y1: 0.555, z0: -0.32, z1: -0.115, t: 0.003 };
		const rw = rv.x1 - rv.x0, rh = rv.y1 - rv.y0, rd = rv.z1 - rv.z0, rc = [(rv.x0 + rv.x1) / 2, (rv.y0 + rv.y1) / 2, (rv.z0 + rv.z1) / 2];
		const walls = [
			at(box(rw, rv.t, rd, 0.001), rc[0], rv.y0 + rv.t / 2, rc[2]),
			at(box(rw, rv.t, rd, 0.001), rc[0], rv.y1 - rv.t / 2, rc[2]),
			at(box(rv.t, rh - 2 * rv.t, rd, 0.001), rv.x0 + rv.t / 2, rc[1], rc[2]),
			at(box(rv.t, rh - 2 * rv.t, rd, 0.001), rv.x1 - rv.t / 2, rc[1], rc[2]),
			at(box(rw - 2 * rv.t, rh - 2 * rv.t, rv.t, 0.001), rc[0], rc[1], rv.z0 + rv.t / 2),
			at(box(rw - 2 * rv.t, rh - 2 * rv.t, rv.t, 0.001), rc[0], rc[1], rv.z1 - rv.t / 2)
		];
		const inner = { w: rw - 2 * rv.t, h: rh - 2 * rv.t, d: rd - 2 * rv.t };
		const litres = inner.w * inner.h * inner.d * 1000;
		part({ id: 'reservoir', label: 'Hydraulic reservoir', assembly: 'hydraulics', source: SRC.vii, what: 'The oil tank over the pump, removable for cleaning: the pump draws through a strainer at its bottom, the returns come in at its top through the filter, and a baffle between them makes the oil settle and let go of its air before it is drawn again.', specs: [['Volume', `${fmt(litres, 1)} L inside (7 gal nominal)`], ['Walls', '3 mm steel'], ['Oil', 'ISO VG 46 anti-wear']] }, [m(GEO.merge(walls), M.tank)], { explode: [0, 0.2, -0.22], xray: 'shell', tag: { text: 'Reservoir', at: [rv.x0 + 0.04, rv.y1, rc[2]], value: () => `oil ${fmt(sim.s.T)} °C`, side: 'left' } });
		const level = 0.82;
		const oil = m(at(box(inner.w - 0.001, inner.h * level, inner.d - 0.001, 0.002), rc[0], rv.y0 + rv.t + (inner.h * level) / 2, rc[2]), M.oil);
		const baffle = m(at(box(0.003, inner.h * 0.7, inner.d - 0.002, 0.0008), 0.02, rv.y0 + rv.t + inner.h * 0.35, rc[2]), M.tank);
		const strainer = [m(cyl([-0.2, rv.y0 + 0.004, -0.25], [-0.2, rv.y0 + 0.05, -0.25], 0.026, 32), M.brass), m(cyl([-0.2, rv.y0 + 0.05, -0.25], [-0.2, rv.y0 + 0.056, -0.25], 0.028, 32), M.zinc)];
		part({ id: 'oil', label: 'Hydraulic oil', assembly: 'hydraulics', source: SRC.vii, what: 'About 21 L of ISO VG 46 anti-wear oil at its working level: it carries the power out to the machine and back, lubricates the pump and takes away the heat of every loss.', specs: [['Grade', 'ISO VG 46: 46 cSt at 40 °C'], ['Level', '82 % of the tank'], ['Limit', '82 °C (180 °F) [inferred]']] }, [oil], { explode: [0, 0.32, -0.22] });
		part({ id: 'baffle', label: 'Baffle and suction strainer', assembly: 'hydraulics', source: SRC.vii, what: 'A plate across the tank between the return and the suction, and a brass mesh strainer on the suction outlet at its bottom: the pump never draws air or grit.', specs: [['Strainer', '100 mesh (149 µm) [inferred]']] }, [baffle, ...strainer], { explode: [0, 0.25, -0.12] });
		// the suction line: wide, from the strainer down to the pump's inlet
		const suctionPts = /** @type {V3[]} */ ([[-0.2, rv.y0 - 0.002, -0.25], [-0.2, 0.3, -0.25], [-0.15, 0.27, -0.255], [-0.09, CRANK.y + cd / 2, -0.258], [-0.066, CRANK.y + cd / 2, z0 - 0.01 - bw / 2]]);
		part({ id: 'suction-hose', label: 'Suction hose', assembly: 'hydraulics', source: SRC.vii, what: 'The wide soft line from the tank’s strainer down to the pump’s inlet: wide, so the pump never starves and cavitates.', specs: [['Hose', '1" suction (SAE 100R4)'], ['Speed', '< 1.2 m/s in it [computed]']] }, [m(hose(suctionPts, 0.0175), M.hose)], { explode: [-0.12, 0.05, -0.2] });
		// the pressure line: pump, relief valve, the tee to the gauge, the pressure coupler
		const relief = new THREE.Group();
		relief.add(m(at(box(0.05, 0.05, 0.05, 0.004), 0.13, 0.3, -0.255), M.machinedAl), m(cyl([0.155, 0.3, -0.255], [0.2, 0.3, -0.255], 0.012, 24), M.steel), m(cyl([0.2, 0.3, -0.255], [0.215, 0.3, -0.255], 0.009, 6), M.brass), m(cyl([0.18, 0.3, -0.255], [0.188, 0.3, -0.255], 0.016, 6), M.zinc));
		relief.add(m(hose([[0.13, 0.325, -0.255], [0.13, rv.y0 - 0.002, -0.255]], 0.008), M.hose));
		part({ id: 'relief', label: 'Relief valve', assembly: 'hydraulics', source: SRC.v156, what: 'Added in October 2014: a spring-loaded poppet that opens back to the tank when the pressure reaches its setting, so nothing bursts when a cylinder bottoms out or a wheel stalls. All the power it dumps becomes heat in the oil.', moves: 'Its poppet lifts only at its setting.', specs: [['Setting', '3,000 psi (207 bar)'], ['Override', '+160 psi at full flow [inferred]'], ['Added', 'October 2014 (v15.6)']] }, [relief], { explode: [0.16, -0.02, -0.12], tag: { text: 'Relief valve', at: [0.2, 0.3, -0.255], value: () => (sim.s.qRelief > 1e-6 ? `dumping ${fmt(sim.s.qRelief * 60000, 1)} L/min` : sim.s.stuck ? 'stuck shut' : 'closed'), side: 'right' } });
		const pressPts = /** @type {V3[]} */ ([[0.06, CRANK.y + cd / 2, z0 - 0.01 - bw / 2], [0.1, 0.27, -0.255], [0.105, 0.3, -0.255]]);
		const outPts = /** @type {V3[]} */ ([[0.155, 0.28, -0.255], [0.2, 0.25, -0.29], [0.23, 0.2516, -0.322]]);
		part({ id: 'pressure-hose', label: 'Pressure hoses', assembly: 'hydraulics', source: SRC.vii, what: 'Two-wire braided hoses from the pump to the relief valve and on to the pressure coupler, every power stroke of the machine’s cylinders coming through them.', specs: [['Hose', '1/2" SAE 100R2'], ['Working pressure', '4,000 psi'], ['Burst', '16,000 psi']] }, [m(hose(pressPts, 0.0125), M.hose), m(hose(outPts, 0.0125), M.hose)], { explode: [0.14, -0.04, -0.2] });
		// the gauge on the back
		const gauge = new THREE.Group();
		const ga = /** @type {V3} */ ([0.17, 0.48, -0.336]);
		gauge.position.set(...ga);
		gauge.rotation.y = Math.PI;
		gauge.add(m(latheZ([[0, 0], [0.05, 0], [0.05, 0.028], [0.046, 0.032], [0, 0.032]], 48), M.steel), m(latheZ([[0, 0.0275], [0.045, 0.0275], [0.045, 0.029], [0, 0.029]], 48), M.dial), m(latheZ([[0, 0.031], [0.046, 0.031], [0.046, 0.033], [0, 0.033]], 48), M.glass));
		const ticks = [];
		for (let k = 0; k <= 10; k++) {
			const a = THREE.MathUtils.degToRad(225 - k * 27);
			ticks.push(at(box(0.0012, k % 5 === 0 ? 0.009 : 0.005, 0.0004, 0.0002), 0, 0.037, 0).rotateZ(a - Math.PI / 2).translate(0, 0, 0.0296));
		}
		gauge.add(m(GEO.merge(ticks), M.satin));
		const needle = new THREE.Group();
		needle.position.z = 0.0302;
		needle.add(m(at(box(0.002, 0.036, 0.0008, 0.0003), 0, 0.014, 0), M.needle), m(rodZ(0.003, -0.0006, 0.0006), M.satin));
		gauge.add(needle);
		gauge.add(m(hose([[0, 0, -0.002], [0, -0.06, -0.06], [0.02, -0.16, -0.08], [0.045, -0.19, -0.08]], 0.004), M.hose));
		part({ id: 'gauge', label: 'Pressure gauge', assembly: 'hydraulics', source: SRC.v156, what: 'A liquid-filled gauge on the pressure line, added in April 2015: the operator sees at a glance how hard the cube is working.', moves: 'Its needle swings with the pressure.', specs: [['Range', '0–5,000 psi'], ['Added', 'April 2015 (v15.6)']] }, [gauge], { explode: [0, 0.06, -0.14], tag: { text: 'Pressure gauge', at: [ga[0], ga[1] + 0.05, ga[2] - 0.03], value: () => `${fmt(sim.s.p / PSI)} psi · ${fmt(sim.s.p / 1e5)} bar`, side: 'left' } });
		moving.needle = needle;
		// the couplers on the back, between the quick-attach plates
		const cp = [];
		for (const [x, capM] of /** @type {[number, THREE.Material][]} */ ([[0.23, M.capRed], [0.29, M.capBlue]])) {
			cp.push(m(latheZ([[0, -0.3], [0.014, -0.3], [0.014, -0.322], [0.018, -0.326], [0.018, -0.36], [0.016, -0.364], [0, -0.364]], 40).translate(x, 0.2516, 0), M.brass));
			cp.push(m(cyl([x, 0.2516, -0.364], [x, 0.2516, -0.384], 0.019, 32), capM));
		}
		cp.push(m(at(box(0.15, 0.045, 0.006, 0.002), 0.26, 0.2516, -0.326), M.zinc));
		part({ id: 'couplers', label: 'Quick couplers', assembly: 'hydraulics', count: 2, source: SRC.man, what: 'The cube’s whole connection to a machine: the pressure coupler (red cap) and the return coupler (blue) on its back. Push the machine’s hoses on and the cube drives it; pull them off and it is free for the next one.', specs: [['Size', '1/2" ISO 7241-A [inferred]'], ['Rated', '3,000 psi']] }, cp, { explode: [0.06, 0, -0.22], tag: { text: 'Couplers P · T', at: [0.26, 0.2516, -0.38], value: () => `${fmt(sim.s.qLoad * 60000, 1)} L/min to the work`, side: 'right' } });
		// the return: coupler to cooler to filter to tank
		const retPts = /** @type {V3[]} */ ([[0.29, 0.2516, -0.3], [0.3, 0.2, -0.28], [0.318, 0.152, -0.272]]);
		const retPts2 = /** @type {V3[]} */ ([[0.318, 0.312, 0.032], [0.318, 0.42, 0.0], [0.318, 0.53, -0.08], [0.31, 0.585, -0.16], [0.22, 0.585, -0.21], [0.185, 0.572, -0.22]]);
		part({ id: 'return-hose', label: 'Return hoses', assembly: 'hydraulics', source: SRC.vii, what: 'From the return coupler through the cooler and the filter back into the tank: everything the machine sends back.', specs: [['Hose', '3/4" SAE 100R1 [inferred]']] }, [m(hose(retPts, 0.013), M.hose), m(hose(retPts2, 0.013), M.hose)], { explode: [0.16, 0.06, -0.06] });
		// the cooler: six finned tubes on the right side, its headers, its fan
		const co = [];
		const tubes = [];
		for (let k = 0; k < 6; k++) tubes.push(cyl([0.318, 0.152 + k * 0.032, -0.272], [0.318, 0.152 + k * 0.032, 0.032], 0.0065, 16));
		co.push(m(GEO.merge(tubes), M.copper));
		const fins = [];
		for (let z = -0.262; z < 0.026; z += 0.006) fins.push(at(slab(0.026, 0.188, 0.0005), 0.318, 0.232, z));
		co.push(m(GEO.merge(fins), M.finAl));
		for (const z of [-0.272, 0.032]) co.push(m(cyl([0.318, 0.14, z], [0.318, 0.324, z], 0.013, 24), M.machinedAl));
		// its guard: a frame and five bars, the fins and tubes seen between them
		const guard = rrect(0.31, 0.2, 0.012);
		guard.holes.push(/** @type {any} */ (rrect(0.29, 0.18, 0.006)));
		const bars = /** @type {THREE.BufferGeometry[]} */ ([plate(guard, 0.004, 4)]);
		for (let k = 1; k < 6; k++) bars.push(at(slab(0.004, 0.18, 0.004), -0.145 + k * 0.0483, 0, 0));
		co.push(m(GEO.merge(bars).rotateY(Math.PI / 2).translate(0.334, 0.232, -0.12), M.satin));
		part({ id: 'cooler', label: 'Oil cooler (six tubes)', assembly: 'hydraulics', source: SRC.v156, what: 'The 7s cooler on the cube’s right side: the returning oil runs through six finned tubes before the filter, giving the heat of every loss to the air its fan pulls through.', specs: [['Type', '6-tube, finned, fan-cooled'], ['Rejects', '~150 W per °C over the air [inferred]'], ['Added', '7s']] }, co, { explode: [0.2, 0, 0], tag: { text: 'Oil cooler', at: [0.33, 0.33, -0.12], value: () => `${fmt((150 * (sim.s.T - 20)) / 1000, 1)} kW to the air`, side: 'right' } });
		const fan = new THREE.Group();
		fan.position.set(0.29, 0.232, -0.12);
		const blade = new THREE.Group();
		blade.add(m(GEO.rotor(/** @type {any} */ ({ count: 5, axis: 'x', r0: 0.018, r1: 0.075, chord: [0.04, 0.05], thick: 0.06, camber: 0.05, twist: 0.4, pitch: 0.5, nS: 6, nC: 8 })), M.satin), m(latheX([[0, 0.0], [0.02, 0], [0.02, 0.018], [0, 0.022]], 24), M.satin));
		fan.add(blade);
		fan.add(m(cyl([-0.035, 0, 0], [-0.005, 0, 0], 0.025, 28), M.black));
		const shroudRing = new THREE.Shape();
		shroudRing.absarc(0, 0, 0.088, 0, Math.PI * 2, false);
		shroudRing.holes.push(ring(0, 0, 0.081));
		fan.add(m(ext(shroudRing, 0.03, 0.0008).rotateY(Math.PI / 2).translate(0.012, 0, 0), M.satin));
		part({ id: 'cooler-fan', label: 'Cooler fan', assembly: 'hydraulics', source: SRC.v156, what: 'The 12 V fan pulling air through the cooler’s fins into the cube.', moves: 'Turns while the engine runs.', drive: '12 V from the battery', specs: [['Voltage', '12 V'], ['Diameter', '160 mm [inferred]']] }, [fan], { explode: [0.06, 0, 0.04] });
		moving.fan = blade;
		part({ id: 'filter', label: 'Return filter', assembly: 'hydraulics', source: SRC.man, what: 'A spin-on filter on the tank’s top where the return enters it: everything that comes back from the machine passes through it.', specs: [['Flow', '20 gpm (v4 BOM)'], ['Element', '10 µm [inferred]']] },
			[m(at(box(0.07, 0.022, 0.07, 0.006), 0.15, rv.y1 + 0.011, -0.22), M.machinedAl), m(cyl([0.15, rv.y1 + 0.022, -0.22], [0.15, rv.y1 + 0.094, -0.22], 0.046, 40), M.capRed), m(cyl([0.15, rv.y1 + 0.094, -0.22], [0.15, rv.y1 + 0.098, -0.22], 0.042, 40), M.capRed)], { explode: [0, 0.22, -0.1] });
		part({ id: 'breather', label: 'Filler and breather cap', assembly: 'hydraulics', source: SRC.vii, what: 'Where the tank is filled, and how it breathes as the machine’s cylinders draw oil out and give it back.', specs: [['Filter', '10 µm air breather [inferred]']] },
			[m(cyl([-0.06, rv.y1, -0.22], [-0.06, rv.y1 + 0.02, -0.22], 0.02, 24), M.zinc), m(cyl([-0.06, rv.y1 + 0.02, -0.22], [-0.06, rv.y1 + 0.05, -0.22], 0.035, 36), M.plastic)], { explode: [0, 0.2, -0.06] });
		part({ id: 'sight-gauge', label: 'Sight gauge', assembly: 'hydraulics', source: SRC.vii, what: 'A window on the tank’s back above the strainer: the oil’s level and colour at a glance.', specs: [['Length', '127 mm [inferred]']] },
			[m(at(box(0.026, 0.13, 0.008, 0.003), -0.2, 0.445, rv.z0 - 0.004), M.zinc), m(at(box(0.012, 0.11, 0.006, 0.002), -0.2, 0.445, rv.z0 - 0.008), M.glass), m(at(box(0.01, 0.11 * level, 0.004, 0.001), -0.2, 0.39 + (0.11 * level) / 2, rv.z0 - 0.008), M.oil)], { explode: [0, 0.04, -0.16] });
	}

	/* ------------------------------------------------------------ fuel and controls */
	{
		const ft = { w: 0.56, h: 0.1, d: 0.44, y: 0.567, z: 0.08 };
		const shell = box(ft.w, ft.h, ft.d, 0.02);
		const fuel = m(at(box(ft.w - 0.01, ft.h * 0.7, ft.d - 0.01, 0.012), 0, ft.y + 0.005 + ft.h * 0.35, ft.z), M.fuel);
		part({ id: 'fuel-tank', label: 'Fuel tank', assembly: 'controls', source: SRC.vii, what: 'The removable petrol tank on top of the cube, over the engine: lift it off to fill it away from the machine. Moulded of natural polyethylene, so the petrol’s level shows through its wall.', specs: [['Material', 'HDPE, natural [inferred]'], ['Volume', `${fmt(ft.w * ft.h * ft.d * 1000 * 0.95, 1)} L (7 gal nominal)`], ['Fuel', 'Petrol (gasoline)'], ['Removable', 'Yes']] },
			[m(at(shell, 0, ft.y + ft.h / 2, ft.z), M.hdpe), m(GEO.merge([-0.12, 0, 0.12].map((x) => at(box(0.012, 0.006, ft.d - 0.06, 0.003), x, ft.y + ft.h + 0.002, ft.z))), M.hdpe), m(cyl([0.18, ft.y + ft.h, 0.24], [0.18, ft.y + ft.h + 0.016, 0.24], 0.024, 28), M.capRed)], { explode: [0, 0.3, 0], xray: 'shell', tag: { text: 'Fuel tank', at: [-0.2, ft.y + ft.h, 0.2], value: () => (sim.s.fuel > 0 ? `${fmt(sim.s.fuel, 1)} L/h · ${fmt((ft.w * ft.h * ft.d * 1000 * 0.7) / sim.s.fuel, 1)} h left` : 'stopped'), side: 'left' } });
		part({ id: 'fuel', label: 'Petrol', assembly: 'controls', source: SRC.vii, what: 'The fuel at 70 % of the tank: what the engine burns, about 0.37 kg for every kWh it makes at full load.', specs: [['Burns', '0.37 kg/kWh at full load [inferred]']] }, [fuel], { explode: [0, 0.4, 0] });
		part({ id: 'fuel-line', label: 'Fuel line and shut-off', assembly: 'controls', source: SRC.vii, what: 'From the tank’s outlet down the front through a shut-off valve and an inline filter to the carburettor.', specs: [['Line', '1/4" fuel hose']] },
			[m(hose([[-0.22, ft.y, 0.27], [-0.22, 0.5, 0.27], [-0.17, 0.45, 0.2], [-0.06, 0.43, 0.08], [-0.028, 0.42, CRANK.z + 0.02]], 0.004), M.black), m(at(box(0.016, 0.02, 0.02, 0.003), -0.22, 0.54, 0.27), M.brass), m(cyl([-0.19, 0.468, 0.235], [-0.17, 0.452, 0.21], 0.009, 16), M.glass)], { explode: [-0.1, 0.12, 0.12] });
		const bt = { x: 0.231, y: B + 0.0127, z: 0.19, w: 0.132, h: 0.186, d: 0.197 };
		part({ id: 'battery', label: '12 V battery', assembly: 'controls', source: SRC.vii, what: 'The cube’s own 12 V battery in the front corner: it cranks the starter, runs the cooler fan and the machine’s valves; the flywheel alternator charges it.', specs: [['Size', 'Group U1, 197 × 132 × 186 mm'], ['Capacity', '~32 Ah, 300 CCA [inferred]']] },
			[m(at(box(bt.w, bt.h, bt.d, 0.006), bt.x, bt.y + bt.h / 2, bt.z), M.battery), m(cyl([bt.x - 0.035, bt.y + bt.h, bt.z + 0.07], [bt.x - 0.035, bt.y + bt.h + 0.018, bt.z + 0.07], 0.008, 16), M.lead), m(cyl([bt.x - 0.035, bt.y + bt.h, bt.z - 0.07], [bt.x - 0.035, bt.y + bt.h + 0.018, bt.z - 0.07], 0.008, 16), M.lead), m(at(box(0.15, 0.004, 0.025, 0.001), bt.x, bt.y + bt.h + 0.002, bt.z), M.zinc)], { explode: [0.2, 0, 0.16] });
		part({ id: 'cables', label: 'Battery cables', assembly: 'controls', source: SRC.vii, what: 'The red cable from the battery across the front to the starter’s solenoid, the black to the frame.', specs: [['Gauge', '6 AWG [inferred]']] },
			[m(hose([[bt.x - 0.035, bt.y + bt.h + 0.018, bt.z + 0.07], [0.15, 0.33, 0.3], [-0.05, 0.13, 0.3], [-0.105, 0.2, 0.15]], 0.0055), M.capRed), m(hose([[bt.x - 0.035, bt.y + bt.h + 0.018, bt.z - 0.07], [0.29, 0.33, 0.1], [0.3, B + 0.02, 0.1]], 0.0055), M.satin)], { explode: [0.14, 0.06, 0.18] });
		const panel = new THREE.Group();
		panel.add(m(at(box(0.11, 0.17, 0.004, 0.003), 0.275, 0.5, Z + 0.003), M.satin));
		panel.add(m(cyl([0.25, 0.54, Z + 0.005], [0.25, 0.54, Z + 0.02], 0.014, 24), M.steel), m(at(box(0.004, 0.022, 0.004, 0.001), 0.25, 0.54, Z + 0.024), M.brass));
		panel.add(m(cyl([0.3, 0.54, Z + 0.005], [0.3, 0.54, Z + 0.03], 0.0035, 12), M.zinc), m(cyl([0.3, 0.54, Z + 0.03], [0.3, 0.54, Z + 0.04], 0.009, 20), M.yellow));
		panel.add(m(at(box(0.05, 0.02, 0.01, 0.002), 0.275, 0.46, Z + 0.008), M.satin), m(at(box(0.035, 0.012, 0.002, 0.001), 0.275, 0.46, Z + 0.0135), M.glass));
		const tl = new THREE.Group();
		tl.position.set(0.275, 0.43, Z + 0.006);
		tl.add(m(at(box(0.006, 0.04, 0.006, 0.001), 0, 0.02, 0.004), M.green), m(at(box(0.016, 0.01, 0.012, 0.002), 0, 0.04, 0.006), M.green));
		panel.add(tl);
		part({ id: 'panel', label: 'Control panel', assembly: 'controls', source: SRC.vii, what: 'On the front corner post: the key switch (off, run, start), the choke knob, the throttle lever that sets the governor’s speed, and an hour meter. The cube is started here and left running; the machine’s valves do the rest.', moves: 'Key, choke and throttle are worked by hand.', specs: [['Key', 'Off / run / start'], ['Choke', 'Pull knob'], ['Throttle', 'Lever: 1,750 to 3,600 rpm']] }, [panel], { explode: [0.14, 0.06, 0.14] });
		moving.lever = tl;
	}

	/* ------------------------------------------------------------ the solver and its moving parts */
	const ctl = {
		speed: { label: 'Engine speed (governor)', min: 1800, max: 3600, value: speed, step: 50, unit: 'rpm', ends: /** @type {[string, string]} */ (['Low', 'Rated 3,600']) },
		load: { label: 'Load pressure (the work)', min: 0, max: 2900, value: load, step: 10, unit: 'psi', ends: /** @type {[string, string]} */ (['Free flow', 'Near relief']) }
	};
	const sim = solver(ctl);
	// the oil's flow, drawn where the cut or the x-ray shows it: suction, round the gears, out, over the relief, back
	const cd = PUMP.teeth * PUMP.module, pz = PUMP.z0 - 0.01 - PUMP.width / 2;
	const flowPaths = [
		/* 0 suction */ [[-0.2, 0.36, -0.25], [-0.2, 0.3, -0.25], [-0.15, 0.27, -0.255], [-0.09, CRANK.y + cd / 2, -0.258], [-0.05, CRANK.y + cd / 2, pz], [-0.02, CRANK.y + cd + 0.012, pz], [0.02, CRANK.y + cd + 0.012, pz], [0.05, CRANK.y + cd / 2, pz]],
		/* 1 suction, under */ [[-0.2, 0.36, -0.248], [-0.2, 0.3, -0.248], [-0.15, 0.27, -0.252], [-0.09, CRANK.y + cd / 2, -0.256], [-0.05, CRANK.y + cd / 2, pz], [-0.02, CRANK.y - 0.012, pz], [0.02, CRANK.y - 0.012, pz], [0.05, CRANK.y + cd / 2, pz]],
		/* 2 pressure */ [[0.05, CRANK.y + cd / 2, pz], [0.1, 0.27, -0.255], [0.13, 0.3, -0.255], [0.155, 0.28, -0.255], [0.2, 0.25, -0.29], [0.23, 0.2516, -0.36]],
		/* 3 return */ [[0.29, 0.2516, -0.36], [0.3, 0.2, -0.28], [0.318, 0.152, -0.272], [0.318, 0.152, 0.03], [0.318, 0.216, 0.03], [0.318, 0.216, -0.27], [0.318, 0.28, -0.27], [0.318, 0.28, 0.03], [0.318, 0.42, 0.0], [0.318, 0.53, -0.08], [0.31, 0.585, -0.16], [0.22, 0.585, -0.21], [0.15, 0.57, -0.22], [0.15, 0.5, -0.22], [0.12, 0.42, -0.2]],
		/* 4 relief to tank */ [[0.13, 0.3, -0.255], [0.13, 0.33, -0.255], [0.13, 0.36, -0.255], [0.1, 0.42, -0.24]]
	];
	const flow = new Flow({ theme: 'paper' }, { parent: root, paths: flowPaths, count: 420, length: 0.05, seed: 7, perPath: [1, 1, 1, 1, 0], color: () => tCol(sim.s.T) });
	/** the oil's colour by its temperature: cool blue to hot amber @param {number} T */
	const tCol = (T) => {
		const k = clamp((T - 30) / 60);
		return [lerp(0.2, 1.0, k), lerp(0.45, 0.5, k), lerp(0.95, 0.1, k)];
	};
	const turnPin = new THREE.Vector3();
	kit.onTick((dt, env) => {
		sim.step(dt, env);
		const s = sim.s, a = s.ang;
		moving.crank.rotation.z = moving.fly.rotation.z = moving.cpl.rotation.z = -a;
		moving.drive.rotation.z = -a;
		moving.idler.rotation.z = a + Math.PI / PUMP.teeth;
		// the pistons and rods, from the crank's pin
		turnPin.set(r * Math.sin(a), r * Math.cos(a), 0);
		for (const [side, sx] of banks) {
			const d = axis(sx), phi = sx * ENGINE.bank;
			const along = r * Math.cos(a - phi), across = r * Math.sin(a - phi);
			const sPin = along + Math.sqrt(ENGINE.rod ** 2 - across ** 2);
			const pin = d.clone().multiplyScalar(sPin);
			const pis = moving[`piston-${side}`], rod = moving[`rod-${side}`];
			pis.position.set(C.x + pin.x, C.y + pin.y, 0);
			pis.rotation.z = -phi;
			rod.position.set(C.x + turnPin.x, C.y + turnPin.y, 0);
			rod.rotation.z = -Math.atan2(pin.x - turnPin.x, pin.y - turnPin.y);
		}
		moving.fan.rotation.x += (s.stalled ? 0 : 2800 / 60 / 12) * 2 * Math.PI * dt;
		moving.needle.rotation.z = THREE.MathUtils.degToRad(135 - (clamp(s.p / PSI / 5000) * 270));
		moving.throttle.rotation.z = -s.theta * 1.2;
		moving.lever.rotation.z = -0.5 + ((ctl.speed.value - 1800) / 1800) * 1.0;
		flow.speed = (0.5 * s.q) / (57.5 / 60000);
		flow.o.perPath[2] = s.q > 0 ? clamp((s.qLoad + s.qRelief) / s.q) : 0;
		flow.o.perPath[3] = s.q > 0 ? clamp(s.qLoad / s.q) : 0;
		flow.o.perPath[4] = s.q > 0 ? clamp(s.qRelief / s.q) * 2 : 0;
		flow.opacity = s.stalled ? 0 : clamp(0.3 + s.q / (57.5 / 60000)) * Math.max(env.cut, env.xray);
		flow.update(dt);
		const hero = lab.read;
		hero.value = s.hyd / 1000;
		hero.bad = s.stalled || s.T > 82 || (s.p > 3100 * PSI);
		hero.state = s.stalled ? (env.broken ? 'stalled: dead-headed, relief stuck' : 'stalled: more torque than the engine has') : env.broken ? 'dead-headed, relief stuck: the pressure climbing' : s.valves < 1 ? 'starting, valves in neutral' : s.qRelief > 1e-6 ? 'over relief' : s.T > 82 ? 'oil too hot' : s.theta > 0.98 && sim.rpm() < s.set * 0.96 ? 'lugging down: full throttle, the speed sagging' : 'running';
		hero.sub = s.stalled
			? `the pump needed ${fmt(lastTp)} N·m at ${fmt(lastP / PSI)} psi, the engine gives at most ${fmt(best(ctl.speed.value))} at this setting · ${env.broken ? 'take the break back' : 'move a slider'} to restart`
			: `${fmt(s.q * 60000, 1)} L/min (${fmt(s.q * 15850.3, 1)} gpm) · ${fmt(s.p / PSI)} psi · ${fmt(sim.rpm())} rpm · oil ${fmt(s.T)} °C · ${fmt(s.fuel, 1)} L/h`;
		if (!s.stalled) {
			lastP = s.p;
			lastTp = s.Tp;
		}
	});
	let lastP = 0, lastTp = 0;
	/** @type {import('$lib/assets/parts.js').Lab} */
	const lab = {
		hero: { label: 'Hydraulic power', unit: 'kW', max: 20, digits: 1 },
		read: { value: 0, state: '', sub: '', bad: false },
		controls: ctl,
		how: {
			text: 'The engine turns the gear pump on one shaft. Each turn the pump carries 16 cm³ of oil round its gears, less what slips back through its clearances (more as the pressure rises and the oil warms). The pressure is what the work needs plus the hoses’ loss, capped by the relief valve, which dumps the rest to the tank as heat. The pump’s torque grows with the pressure; the engine’s governor opens the throttle to hold its speed, and past what the engine can give the speed sags (lugging) or the engine stalls. The oil heats with every loss and the cooler gives the heat to the air (heat shown 20 times faster). Engine shown slowed 40 times.',
			eqs: ['Q = D n − k p (ν50/ν)      D = 16.0 cm³, slip 6 % at 3,000 psi', 'Tp = D p / (2π ηhm)       ηhm = 0.92', 'J dω/dt = θ Te(n) − Tp       J = 0.075 kg·m²', 'θ = clamp((1.03 n_set − n) / (0.08 n_set))', 'P = p Q_load', 'C dT/dt = losses − UA (T − T_air)      UA = 162 W/K']
		},
		breakIt: {
			label: 'Dead-head it',
			run: () => {},
			reset: () => sim.restart()
		},
		cut: { a: [0, 0, 1], b: [0, 1, 0], center: [0, CRANK.y, CRANK.z], reach: 0.9 }
	};
	const asset = kit.seal({ lab });
	// at rest: every moving part where the solver's first moment puts it
	asset.tick(0, { broken: false, time: 0, slow: 0, cut: 0, xray: 0 });
	return root;
}
