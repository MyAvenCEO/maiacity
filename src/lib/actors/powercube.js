/*
 * THE POWER CUBE — Open Source Ecology's modular hydraulic power unit, the heart of the Global Village Construction
 * Set: an engine turning a hydraulic pump in a cube of steel, with its own tanks, cooler and quick couplers, so it can
 * be lifted off one machine and coupled to another — the LifeTrac, the CEB press, the tractor's implements — and
 * several cubes ganged for more power. Built as OSE's newest built design documents it: Power Cube VII / 7s (v15.6,
 * 2014–15), a 28 hp Briggs & Stratton V-twin on a 1 in³ gear pump, 15.2 gpm at 3,000 psi, ~181 kg, in a 27" cube on
 * a 4×4 tube base, with the relief valve, pressure gauge and six-tube oil cooler 7s added. (Newer than it there is
 * only a concept, v17.08; LifeTrac v25 builds its power unit into its frame instead.)
 *
 * Every part is its own (./parts.js): `powerCubeParts` adds them to any machine's kit at any place — the LifeTrac
 * (./lifetrac.js) carries one — and `powerCube` is the cube on its own, as the Actors and the Assets show it.
 * Built in its own frame: its foot's middle at the origin, its front (the flywheel's end) towards +z, in mm through
 * `L`; the wiki's figures where it gives them, the rest inferred to fit the 27" cube (its cards say which).
 */
import * as THREE from 'three';
import { loop, rig, skin } from './rig';
import { block, beam, ease } from './excavator-rig.js';
import { machineKit } from './parts.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Pose} Pose */
/** @typedef {import('./rig').Cast} Cast */
/** @typedef {import('./rig').BoneSpec} BoneSpec */
/** @typedef {[number, number, number]} MM a point of the cube: x across, y forward, z up (mm) */
/** @typedef {'frame' | 'engine' | 'hydraulics' | 'controls'} Group */

const S = 0.001;
/** the cube's size: 27" each way (W across, L along, H high), the 4×4 base's height */
export const CUBE = { W: 686, L: 660, H: 686, base: 101.6 };
/** the crank's height and the shaft's line (x 0), the flywheel's y, the coupling's, the cooler fan's place */
const CRANK = 235, FLY = 262, CPL = -168, FAN = /** @type {MM} */ ([360, -40, 230]);

const RED = '#c8372d', FRAME = '#c8372d', STEEL = '#8d9396', DARK = '#2b2d2f', ENGINE = '#2f3133', BLACK = '#161718';
const ALU = '#b9bdbf', HOSE = '#202224', BRASS = '#c9a03a', YELLOW = '#f0c419', GREEN = '#2c7a4a';

export const POWERCUBE_SOURCES = [
	{ label: 'Power Cube VII (OSE wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube_VII' },
	{ label: 'Power Cube 7s (OSE wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube_7s' },
	{ label: 'Power Cube v15.6 (OSE wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube_v15.6' },
	{ label: 'Power Cube Genealogy (OSE wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube_Genealogy' },
	{ label: 'Power Cube (OSE wiki)', url: 'https://wiki.opensourceecology.org/wiki/Power_Cube' },
	{ label: 'Power Cube (OSE portfolio)', url: 'https://www.opensourceecology.org/portfolio/power-cube/' },
	{ label: 'Power Cube fabrication manual (v4)', url: 'https://commons.wikimedia.org/wiki/File:Open_Source_Ecology_-_Powercube_-_Fabricaion_Manual.pdf' }
];
const SRC = { vii: 'Power Cube VII (OSE wiki)', s7: 'Power Cube 7s (OSE wiki)', v156: 'Power Cube v15.6 (OSE wiki)', port: 'Power Cube (OSE portfolio)', man: 'Power Cube fabrication manual (v4)' };

/** the cube on its own: its assemblies and its build steps */
const OWN = /** @type {import('./parts.js').Assembly[]} */ ([
	{ id: 'frame', label: 'Frame', note: 'A 27" cube: two 4×4 tube skids carry everything and take the lifting pins; 2×2 angle posts and top rails close it, and its quick-attach plate couples it to a machine.', out: [0, -0.04, 0] },
	{ id: 'engine', label: 'Engine', note: 'A 28 hp Briggs & Stratton air-cooled V-twin with electric start, on its mount plate: the prime mover of every machine the cube is coupled to.', out: [0, 0.45, 0.12] },
	{ id: 'hydraulics', label: 'Hydraulics', note: 'The gear pump on the engine’s shaft, the 7-gallon reservoir, the relief valve and gauge, the six-tube cooler, the return filter and the two quick couplers out.', out: [0, 0.22, -0.5] },
	{ id: 'controls', label: 'Fuel and controls', note: 'The removable 7-gallon fuel tank, the 12 V battery and the panel with the key, the choke and the throttle.', out: [-0.5, 0.35, 0.2] }
]);
const OWN_STEPS = ['Cut, drill and bolt the frame: skids, posts, top rails, quick-attach plate', 'Bolt in the engine on its mount plate', 'Mount the pump and coupling; fit the reservoir, filter, relief, gauge, cooler, couplers and hoses', 'Fit the fuel tank, the battery and the control panel'];
const STEP_OF = { frame: 1, engine: 2, hydraulics: 3, controls: 4 };

/**
 * Add a Power Cube's parts to a machine's kit, its foot's middle at `at` (actor metres), its front towards +z.
 * Its moving parts ride the joints named in `joints` (flywheel, coupling, fan: bones the caller makes at the points
 * `powerCubeJoints` gives); every other part rides `base`.
 * @param {ReturnType<typeof machineKit>} kit
 * @param {{ at: V3, base: string, joints: { flywheel: string, coupling: string, fan: string }, assembly: (g: Group) => string, step: (g: Group) => number, prefix?: string }} o
 */
export function powerCubeParts(kit, { at, base, joints, assembly, step, prefix = 'pc-' }) {
	const m = new THREE.Matrix4().makeTranslation(...at);
	/** a point of the cube (mm) in the actor @param {number} x @param {number} y @param {number} z @returns {V3} */
	const L = (x, y, z) => [x * S, z * S, y * S];
	const T = (/** @type {THREE.BufferGeometry} */ g) => g.applyMatrix4(m);
	const box = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {number} */ w, /** @type {number} */ l, /** @type {number} */ h, r = 2) => T(block(w * S, h * S, l * S, L(x, y, z), r * S));
	const bar = (/** @type {MM} */ a, /** @type {MM} */ b, /** @type {number} */ w, /** @type {number} */ h, r = 2) => T(beam(L(...a), L(...b), w * S, h * S, r * S));
	/** @param {MM} a @param {MM} b @param {number} r @param {number} [seg] @param {number} [r1] */
	const cyl = (a, b, r, seg = 18, r1 = r) => {
		const A = new THREE.Vector3(...L(...a)), B = new THREE.Vector3(...L(...b));
		const g = new THREE.CylinderGeometry(r1 * S, r * S, A.distanceTo(B), seg);
		g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()), new THREE.Vector3(1, 1, 1)));
		return T(g);
	};
	const hose = (/** @type {MM[]} */ pts, r = 9.5) => T(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...L(...p)))), 24, r * S, 8, false));
	/** an angle (L) along a line, its legs `leg` mm, turned so its outside corner is at `corner` (±x, ±y) */
	const angle = (/** @type {MM} */ a, /** @type {MM} */ b, /** @type {number} */ sx, /** @type {number} */ sy, leg = 50.8, t = 6.35) => {
		const out = [];
		const vert = a[0] === b[0] && a[1] === b[1];
		if (vert) {
			out.push(bar([a[0] - sx * (leg / 2 - leg / 2), a[1] - sy * (leg / 2), a[2]], [b[0], b[1] - sy * (leg / 2), b[2]], t, leg).translate(sx * (-t / 2) * S, 0, 0));
			out.push(box(a[0] - sx * (leg / 2), a[1] - sy * (t / 2), (a[2] + b[2]) / 2, leg, t, b[2] - a[2], 1));
		} else {
			out.push(bar(a, b, t, leg, 1), bar([a[0], a[1], a[2] - leg / 2 + t / 2], [b[0], b[1], b[2] - leg / 2 + t / 2], leg, t, 1));
		}
		return out;
	};
	const W = CUBE.W / 2, Lh = CUBE.L / 2, H = CUBE.H, B = CUBE.base;
	const id = (/** @type {string} */ s) => `${prefix}${s}`;
	/** @param {Group} g @param {Omit<import('./parts.js').PartInfo, 'assembly' | 'step'>} info @param {string} joint @param {(put: (geo: THREE.BufferGeometry, color: string, mat?: number) => void) => void} make */
	const part = (g, info, joint, make) => kit.part({ ...info, id: id(info.id), assembly: assembly(g), step: step(g) }, joint, make);

	/* the frame */
	part('frame', { id: 'skids', label: 'Power Cube base skids (4×4 tube)', count: 2, source: SRC.s7, what: 'Two 4×4 steel tubes front to back under the cube: the “strong structural frame” of 7s that the engine, pump and tanks bolt to, and that takes the forks, the lifting pins or another cube stacked on it.', specs: [['Stock', '4" × 4" square tube (101.6 mm)'], ['Length', '660 mm [inferred: the 27" cube]'], ['Version', '7s / v15.6 (VII: 2×2 angle)']] }, base, (put) => {
		for (const sx of [-1, 1]) put(box(sx * (W - 50.8), 0, B / 2, 101.6, CUBE.L, 101.6, 6), FRAME);
		for (const y of [-Lh + 40, Lh - 40]) put(box(0, y, B / 2, CUBE.W - 203, 50.8, 50.8, 3), FRAME);
	});
	part('frame', { id: 'cage', label: 'Power Cube posts and top rails (2×2 angle)', count: 8, source: SRC.vii, what: 'Four corner posts and four top rails of 1/4" × 2" × 2" angle make the cube’s cage: they guard the engine, carry the fuel tank and give hand-holds to lift it by. OSE’s frame page cuts its members 29", 27" and 24" long.', specs: [['Stock', '1/4" × 2" × 2" angle (6.35 × 50.8 × 50.8 mm)'], ['Members', '29", 27" and 24" pieces'], ['Envelope', '27" (686 mm) cube']] }, base, (put) => {
		for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const g of angle([sx * (W - 3), sy * (Lh - 3), B], [sx * (W - 3), sy * (Lh - 3), H], sx, sy)) put(g, FRAME);
		for (const sx of [-1, 1]) for (const g of angle([sx * (W - 3), -Lh, H - 3], [sx * (W - 3), Lh, H - 3], sx, 0)) put(g, FRAME);
		for (const sy of [-1, 1]) for (const g of angle([-W, sy * (Lh - 3), H - 3], [W, sy * (Lh - 3), H - 3], 0, sy)) put(g, FRAME);
	});
	part('frame', { id: 'quick-attach', label: 'Power Cube quick-attach plate', source: SRC.man, what: 'How the cube is coupled to a machine: plates across its back with a 4×8 receiver tube between them, so it slides onto the machine’s mount and is pinned, and comes off again in minutes for the next machine. Several cubes can be strung together for more power.', specs: [['Plates', '2 × 3/8" × 4" × 27"; 2 × 1/4" × 4" × 8"'], ['Receiver tube', '4" × 8" × 14½"'], ['Strap', '1/4" × 2" × 24"'], ['Source', 'v4 fabrication manual']] }, base, (put) => {
		for (const z of [B + 60, B + 220]) put(box(0, -Lh - 5, z, CUBE.W - 40, 9.5, 101.6, 2), STEEL);
		put(box(0, -Lh - 40, B + 140, 203, 70, 101.6, 6), STEEL);
		for (const sx of [-1, 1]) put(cyl([sx * 120, -Lh - 30, B + 270], [sx * 120, -Lh - 30, B + 330], 12, 10), STEEL);
	});
	part('frame', { id: 'lift-eyes', label: 'Power Cube lifting eyes', count: 2, source: SRC.vii, what: 'Two eyes on the top rails: at about 181 kg the cube is lifted on and off a machine by the loader, a hoist or two people with a bar.', specs: [['Cube mass', '~400 lb (181 kg)']] }, base, (put) => {
		for (const sx of [-1, 1]) {
			const g = new THREE.TorusGeometry(26 * S, 7 * S, 8, 16);
			put(T(g.translate(...L(sx * 180, 0, H + 26))), STEEL);
		}
	});

	/* the engine */
	part('engine', { id: 'engine-plate', label: 'Engine mount plate', source: SRC.vii, what: 'The plate the engine’s base bolts to, itself bolted across the skids: it holds the engine’s shaft exactly in line with the pump’s.', specs: [['VII engine module plate', '8" × 15½" (203 × 394 mm)'], ['Generic mounts', '1/4" × 8" × 9" and × 12", welded at 90°']] }, base, (put) => put(box(0, 40, B + 6, CUBE.W - 140, 394, 12, 2), STEEL));
	part('engine', { id: 'crankcase', label: 'Engine crankcase', source: SRC.vii, what: 'The 28 hp Briggs & Stratton V-twin’s crankcase: crankshaft, camshaft, the oil sump and the governor that holds it at its speed. The crankshaft runs fore and aft: the flywheel at the front, the pump at the back.', moves: 'The crankshaft inside turns at engine speed.', drive: 'Petrol and air; electric start', specs: [['Engine', 'Briggs & Stratton 28 hp (20.9 kW) V-twin, air-cooled'], ['Displacement', '~810 cc [inferred: B&S 28 hp class]'], ['Speed', '3,600 rpm governed'], ['Start', 'Electric'], ['Older cubes', '27 hp (v12.11), 18 hp (Prototypes I–II)']] }, base, (put) => {
		put(box(0, 30, CRANK - 10, 250, 300, 240, 26), ENGINE);
		put(box(0, 30, B + 22, 300, 290, 20, 6), DARK);
		for (const sx of [-1, 1]) for (const y of [-90, 150]) put(cyl([sx * 170, y, B + 12], [sx * 170, y, B + 24], 11, 6), STEEL);
	});
	for (const [sx, side] of /** @type {const} */ ([[1, 'left'], [-1, 'right']])) {
		part('engine', { id: `cyl-${side}`, label: `Engine cylinder and head, ${side}`, source: SRC.vii, what: 'One bank of the 90° V-twin: a finned air-cooled cylinder and its overhead-valve head. The flywheel’s fan pushes air through the shroud and over these fins.', moves: 'Its piston runs up and down inside, twice per two turns of the crank.', drive: 'Burning petrol and air', specs: [['Layout', '90° V-twin, OHV'], ['Cooling', 'Air, by the flywheel fan']] }, base, (put) => {
			const d = [sx * Math.SQRT1_2, Math.SQRT1_2];
			const at = (/** @type {number} */ k) => /** @type {MM} */ ([d[0] * k, 30, CRANK + d[1] * k]);
			put(cyl(at(100), at(250), 50, 18), DARK);
			for (let k = 112; k < 250; k += 13) put(cyl(at(k), at(k + 4), 70, 18), ENGINE);
			put(cyl(at(250), at(305), 68, 16), ENGINE);
			const g = block(0.12, 0.04, 0.15, [0, 0, 0], 0.012);
			g.rotateZ(-sx * Math.PI / 4);
			g.translate(...L(...at(320)));
			put(T(g), BLACK);
		});
	}
	part('engine', { id: 'blower', label: 'Blower housing', source: SRC.vii, what: 'The shroud over the flywheel, ducting its fan’s air back over both cylinders.', specs: [['Material', 'Pressed steel']] }, base, (put) => put(box(0, FLY - 32, CRANK + 30, 420, 60, 330, 28), '#3a3d40'));
	part('engine', { id: 'flywheel', label: 'Flywheel and fan screen', source: SRC.vii, what: 'The flywheel at the crank’s front: its weight smooths the twin’s firing, its magnets fire the plugs and charge the battery, its vanes are the cooling fan.', moves: 'Turns with the crankshaft (shown slowed: really 60 turns a second).', drive: 'The crankshaft', specs: [['Speed', '3,600 rpm'], ['Charging', 'Flywheel alternator']] }, joints.flywheel, (put) => {
		put(cyl([0, FLY - 4, CRANK], [0, FLY + 10, CRANK], 115, 32), DARK);
		for (let k = 0; k < 6; k++) {
			const g = block(0.22, 0.012, 0.006, [0, 0, 0], 0.002);
			g.rotateZ((k / 6) * Math.PI);
			g.translate(...L(0, FLY + 13, CRANK));
			put(T(g), STEEL);
		}
		put(cyl([0, FLY + 10, CRANK], [0, FLY + 18, CRANK], 28, 16), STEEL);
	});
	part('engine', { id: 'air-cleaner', label: 'Air cleaner', source: SRC.vii, what: 'The paper element in the V between the cylinders: every litre of air the engine breathes is cleaned here first.', specs: [['Element', 'Paper, foam pre-cleaner']] }, base, (put) => {
		put(box(0, 50, 520, 210, 190, 56, 14), BLACK);
		put(cyl([0, 50, 548], [0, 50, 572], 76, 24), '#3a3d40');
	});
	part('engine', { id: 'muffler', label: 'Muffler', source: SRC.vii, what: 'The Briggs & Stratton muffler behind the cylinders, collecting both exhausts into one can and blowing out to the side.', specs: [['Type', 'B&S twin-inlet muffler']] }, base, (put) => {
		put(cyl([-150, -110, 470], [150, -110, 470], 45, 18), '#505457');
		for (const sx of [-1, 1]) put(cyl([sx * 190, 30, 430], [sx * 110, -110, 470], 9, 8), DARK);
	});
	part('engine', { id: 'starter', label: 'Electric starter', source: SRC.vii, what: 'The 12 V starter whose pinion meshes with the flywheel’s ring gear while the key is held to START.', moves: 'Spins only while starting.', drive: 'The battery, through its solenoid', specs: [['Voltage', '12 V']] }, base, (put) => {
		put(cyl([-150, 120, 150], [-150, 230, 150], 36, 16), DARK);
		put(cyl([-150, 230, 150], [-150, 248, 150], 20, 12), STEEL);
	});

	/* the hydraulics */
	part('hydraulics', { id: 'coupling', label: 'Shaft coupling', source: SRC.port, what: 'Not a bought jaw coupling: OSE cut two coupling halves and welded them into one sleeve, keyed and set-screwed to the engine’s shaft, splined onto the pump’s 3/4" shaft.', moves: 'Turns with the engine (shown slowed).', drive: 'The crankshaft; it drives the pump', specs: [['Engine side', 'Keyed, set screws'], ['Pump side', '3/4" spline (11-tooth typical)'], ['Made', 'Two halves cut and welded']] }, joints.coupling, (put) => {
		put(cyl([0, CPL - 40, CRANK], [0, CPL + 40, CRANK], 34, 18), STEEL);
		put(cyl([0, CPL - 3, CRANK], [0, CPL + 3, CRANK], 38, 18), '#c9b37a');
		for (const yy of [CPL - 22, CPL + 22]) put(cyl([0, yy, CRANK + 32], [0, yy, CRANK + 42], 6, 6), DARK);
	});
	part('hydraulics', { id: 'pump-mount', label: 'Pump mount', source: SRC.vii, what: 'A plate on the engine plate holding the pump’s SAE-A flange square to the engine, its two bolts on 4.19" centres, so the shafts stay in line.', specs: [['Flange', 'SAE A: Ø3.25" pilot, 2 × 3/8-16 on 4.19"']] }, base, (put) => {
		put(box(0, -215, CRANK - 50, 200, 12.7, 230, 4), STEEL);
		put(box(0, -170, B + 30, 200, 100, 12, 2), STEEL);
	});
	part('hydraulics', { id: 'pump', label: 'Hydraulic gear pump', source: SRC.port, what: 'A fixed-displacement gear pump: two gears mesh and carry oil from the suction port round to the pressure port — about a cubic inch every turn, 15 gallons a minute at engine speed. This flow is everything the machine it is coupled to can do.', moves: 'Its gears turn with the engine.', drive: 'The engine, through the coupling', specs: [['Displacement', '~1 in³/rev (v4: 0.976 in³, 16.0 cm³)'], ['Flow', '15.2 gpm (57.5 L/min) at 3,600 rpm'], ['Pressure', '3,000 psi (207 bar) max'], ['Shaft', '3/4" spline'], ['Earlier', 'Hydreco pump (VI)']] }, base, (put) => {
		put(box(0, -275, CRANK, 105, 100, 120, 10), '#3b4a5a');
		put(cyl([-52, -275, CRANK], [-80, -275, CRANK], 20, 12), STEEL);
		put(cyl([52, -275, CRANK], [75, -275, CRANK], 14, 12), STEEL);
	});
	part('hydraulics', { id: 'reservoir', label: 'Hydraulic reservoir (7 gal)', source: SRC.vii, what: 'The oil tank across the back of the cube, removable for cleaning. The pump draws through a strainer at its bottom; returns come back in at its top, where the oil settles and lets go of its air. Earlier cubes used their tanks as members of the frame.', specs: [['Volume', '7 gal (26.5 L)'], ['Oil', 'Hydraulic AW oil'], ['Removable', 'Yes']] }, base, (put) => {
		put(box(0, -Lh + 120, 450, CUBE.W - 40, 180, 200, 10), '#3d4447');
		put(box(-200, -Lh + 29, 440, 26, 4, 140, 3), '#9fd7ff'); // its sight gauge, above the strainer
	});
	part('hydraulics', { id: 'strainer', label: 'Suction strainer and line', source: SRC.vii, what: 'A mesh strainer inside the reservoir’s outlet and the wide soft line down to the pump’s inlet: wide so the pump never starves and cavitates.', specs: [['Hose', '1" suction'], ['Sight gauge', 'Above the strainer']] }, base, (put) => put(hose([[-150, -Lh + 170, 360], [-140, -260, 300], [-82, -275, CRANK]], 15), HOSE));
	part('hydraulics', { id: 'relief', label: 'Relief valve', source: SRC.v156, what: 'Added to the cube in October 2014: a spring-loaded valve that dumps the pump’s flow back to the tank when the pressure reaches its setting, so nothing bursts when a cylinder bottoms out or a wheel stalls.', moves: 'Its poppet lifts only at its setting.', specs: [['Setting', '≤3,000 psi'], ['Added', 'October 2014 (v15.6)']] }, base, (put) => {
		put(box(110, -300, CRANK + 90, 60, 50, 60, 4), ALU);
		put(cyl([110, -300, CRANK + 120], [110, -300, CRANK + 170], 13, 12), STEEL);
		put(hose([[75, -275, CRANK], [110, -300, CRANK + 60]], 8), HOSE);
	});
	part('hydraulics', { id: 'gauge', label: 'Pressure gauge', source: SRC.v156, what: 'A liquid-filled gauge on the pressure line, added in April 2015: the operator sees at a glance how hard the cube is working.', specs: [['Range', '0–5,000 psi'], ['Added', 'April 2015 (v15.6)']] }, base, (put) => {
		put(cyl([170, -Lh + 4, CRANK + 260], [170, -Lh - 22, CRANK + 260], 32, 24), STEEL);
		put(cyl([170, -Lh - 22, CRANK + 260], [170, -Lh - 25, CRANK + 260], 28, 24), '#f4f4ee');
	});
	part('hydraulics', { id: 'cooler', label: 'Oil cooler (six tubes)', source: SRC.v156, what: 'v15.6’s cooler on the cube’s side: the returning oil runs through six finned tubes before the filter, giving the heat of every relief and orifice to the air.', specs: [['Type', '6-tube, fan-cooled'], ['Added', 'v15.6']] }, base, (put) => {
		for (let k = 0; k < 6; k++) put(cyl([W - 30, -200, 140 + k * 36], [W - 30, 120, 140 + k * 36], 9, 10), ALU);
		for (let y = -190; y <= 110; y += 14) put(box(W - 30, y, 230, 26, 2, 200, 0.5), '#8e9496');
		put(box(W - 10, -40, 230, 8, 330, 230, 4), DARK);
	});
	part('hydraulics', { id: 'cooler-fan', label: 'Cooler fan', source: SRC.v156, what: 'The 12 V fan pulling air through the cooler’s tubes.', moves: 'Turns while the engine runs (shown slowed).', drive: '12 V from the battery', specs: [['Voltage', '12 V']] }, joints.fan, (put) => {
		for (let k = 0; k < 5; k++) {
			const g = block(0.006, 0.03, 0.09, [0, 0, 0.05], 0.004);
			g.rotateX((k / 5) * Math.PI * 2);
			g.translate(...L(...FAN));
			put(T(g), BLACK);
		}
		put(cyl([FAN[0] - 10, FAN[1], FAN[2]], [FAN[0] + 14, FAN[1], FAN[2]], 24, 14), DARK);
	});
	part('hydraulics', { id: 'filter', label: 'Return filter', source: SRC.man, what: 'A spin-on filter on the return line where it enters the reservoir: everything that comes back from the machine passes through it.', specs: [['Flow', '20 gpm (v4 BOM)']] }, base, (put) => {
		put(cyl([150, -Lh + 120, 550], [150, -Lh + 120, 570], 44, 18), STEEL);
		put(cyl([150, -Lh + 120, 570], [150, -Lh + 120, 680], 46, 20), '#c33b2e');
	});
	part('hydraulics', { id: 'breather', label: 'Filler and breather cap', source: SRC.vii, what: 'Where the reservoir is filled, and how it breathes as the machine’s cylinders draw oil out and give it back.', specs: [['Filter', 'Air breather']] }, base, (put) => {
		put(cyl([-60, -Lh + 120, 550], [-60, -Lh + 120, 575], 20, 14), STEEL);
		put(cyl([-60, -Lh + 120, 575], [-60, -Lh + 120, 605], 36, 18), BLACK);
	});
	part('hydraulics', { id: 'couplers', label: 'Quick couplers (pressure and return)', count: 2, source: SRC.man, what: 'The cube’s whole connection to a machine: a pressure coupler and a return coupler on its back. Push the machine’s hoses on and the cube drives it; pull them off and it is free for the next one.', specs: [['Size', '3/4" (v4 BOM)'], ['Type', 'Standard quick connect (ISO-A class) [inferred]'], ['Hoses inside', '1/2", 3/4" and 1" (VI)']] }, base, (put) => {
		for (const [x, c] of /** @type {const} */ ([[230, RED], [290, '#2f6fb5']])) {
			put(cyl([x, -Lh + 30, B + 150], [x, -Lh - 40, B + 150], 17, 14), BRASS);
			put(cyl([x, -Lh - 30, B + 150], [x, -Lh - 36, B + 150], 20, 14), c);
		}
		put(hose([[110, -300, CRANK + 140], [200, -Lh + 50, B + 200], [230, -Lh + 30, B + 150]], 9), HOSE);
		put(hose([[290, -Lh + 30, B + 150], [W - 30, -240, 160], [W - 30, -200, 140]], 9), HOSE);
		put(hose([[W - 30, 120, 320], [300, 60, 600], [150, -Lh + 120, 690]], 9), HOSE);
	});

	/* fuel and controls */
	part('controls', { id: 'fuel-tank', label: 'Fuel tank (7 gal)', source: SRC.vii, what: 'The removable petrol tank on top of the cube, over the engine: lift it off to fill it away from the machine.', specs: [['Volume', '7 gal (26.5 L)'], ['Fuel', 'Petrol (gasoline)'], ['Removable', 'Yes']] }, base, (put) => {
		put(box(0, 90, 630, CUBE.W - 70, 400, 95, 14), RED);
		put(cyl([200, 200, 677], [200, 200, 700], 22, 14), BLACK);
		put(hose([[-200, 260, 590], [-220, 250, 400], [-130, 150, 330]], 4), BLACK);
	});
	part('controls', { id: 'battery', label: '12 V battery', source: SRC.vii, what: 'The cube’s own 12 V battery beside the engine: it cranks the starter, runs the cooler fan and the machine’s valves; the flywheel alternator charges it.', specs: [['Voltage', '12 V'], ['Charged by', 'Flywheel alternator']] }, base, (put) => {
		put(box(-260, 70, 205, 125, 240, 190, 6), BLACK);
		for (const [y, c] of /** @type {const} */ ([[-10, RED], [150, BLACK]])) put(cyl([-260, y, 300], [-260, y, 316], 9, 10), c);
	});
	part('controls', { id: 'panel', label: 'Control panel', source: SRC.vii, what: 'On the front corner post: the key switch (off, run, start), the choke and the throttle. The cube is started here and left running; the machine’s valves do the rest.', moves: 'Key, choke and throttle are worked by hand.', specs: [['Key', 'Off / run / start'], ['Choke', 'Pull knob'], ['Throttle', 'Lever']] }, base, (put) => {
		put(box(W - 60, Lh - 3, 470, 110, 6, 170, 4), DARK);
		put(cyl([W - 85, Lh, 520], [W - 85, Lh + 18, 520], 16, 14), STEEL);
		put(cyl([W - 40, Lh, 520], [W - 40, Lh + 24, 520], 9, 10), YELLOW);
		put(box(W - 60, Lh + 12, 420, 60, 20, 14, 3), GREEN);
	});
}

/** where a Power Cube's moving joints are, its foot's middle at `at` @param {V3} at @returns {{ flywheel: V3, coupling: V3, fan: V3 }} */
export function powerCubeJoints(at) {
	const L = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => /** @type {V3} */ ([at[0] + x * S, at[1] + z * S, at[2] + y * S]);
	return { flywheel: L(0, FLY, CRANK), coupling: L(0, CPL, CRANK), fan: L(...FAN) };
}

/** the turns of a running cube's joints at time t (s): the engine (slowed to be seen) and the cooler's fan @param {number} t */
export const powerCubeTurns = (t) => ({ engine: t * 2 * Math.PI * 2.2, fan: t * 2 * Math.PI * 1.6 });

/**
 * The Power Cube on its own, every part its own: runs (its engine and fan turning), off, is drawn apart, is built.
 * @returns {Cast}
 */
export function powerCube() {
	const kit = machineKit(OWN);
	const at = /** @type {V3} */ ([0, 0, 0]);
	powerCubeParts(kit, { at, base: 'base', joints: { flywheel: 'flywheel', coupling: 'coupling', fan: 'fan' }, assembly: (g) => g, step: (g) => STEP_OF[g], prefix: '' });
	const built = kit.build();
	const j = powerCubeJoints(at);
	/** @type {BoneSpec[]} */
	const bones = [{ name: 'base', at: [0, 0, 0] }, { name: 'flywheel', parent: 'base', at: j.flywheel }, { name: 'coupling', parent: 'base', at: j.coupling }, { name: 'fan', parent: 'base', at: j.fan }, ...built.bones];
	const r = rig(bones, built.pieces, [skin(0.55, { side: THREE.DoubleSide })]);
	r.object.name = 'Power Cube';
	/** @param {number} t @param {boolean} run @returns {Pose} */
	const pose = (t, run) => {
		const { engine, fan } = powerCubeTurns(run ? t : 0);
		return { flywheel: [0, 0, engine], coupling: [0, 0, engine], fan: [fan, 0, 0], root: [0, run ? Math.sin(t * 50) * 0.0008 : 0, 0] };
	};
	return {
		rig: r,
		clips: {
			run: (t) => pose(t, true),
			off: () => pose(0, false),
			explode: (t) => {
				const u = loop(t, 8);
				const k = ease(Math.min(1, Math.max(0, (u - 0.05) / 0.3))) - ease(Math.min(1, Math.max(0, (u - 0.65) / 0.3)));
				return kit.explode(built.centre, k, pose(t, true));
			},
			assemble: (t) => {
				const n = OWN_STEPS.length, period = n * 2.6 + 3;
				const u = Math.min(1, loop(t, period) * (period / (n * 2.6)));
				return kit.assemble(built.centre, u, n, pose(t, u >= 1));
			}
		},
		poses: { off: pose(0, false), exploded: kit.explode(built.centre, 1, pose(0, false)) },
		first: 'run',
		catalog: { assemblies: OWN, parts: built.catalogParts, steps: OWN_STEPS, sources: POWERCUBE_SOURCES }
	};
}
