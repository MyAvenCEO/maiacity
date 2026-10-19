/*
 * THE HEAVY DIESEL — a 13 L inline-six truck diesel and its 12-speed automated gearbox, each part a mechanic would
 * name as its own solid at AirSup's realism ($lib/assets), and the model that runs its air and its fire: for the
 * truck (./truck.js) and any heavy machine after it. The light four-cylinder of the van and the pickup is
 * ./vehicle.js `inlineEngine`; this one goes further inside:
 *
 *   the block, its six wet liners, the bedplate under the crank; the crankshaft with its six throws at 120° and seven
 *   main journals, the viscous damper on its nose; six pistons with re-entrant bowls on fracture-split rods; one head
 *   per cylinder on four bolts each; the camshaft in the block, its 12 lobes lifting roller tappets and pushrods to 12
 *   rockers, each pressing a bridge over two valves (24 valves, each pair opened on its own cam's timing); six
 *   injectors upright in the middle of their four valves, fed by their quills from the common rail and the
 *   high-pressure pump; the fire in each bowl as its cylinder fires (1-5-3-6-2-4); the gear train at the flywheel end
 *   (crank, idler, cam, pump and air compressor gears, in mesh); the turbocharger with its compressor and turbine
 *   wheels spinning at the speed its model gives, its wastegate opening; the manifolds, the oil cooler and filters,
 *   the front drive with its fan, the ECU; behind it the flywheel, the clutch, and a 12-speed range-splitter gearbox
 *   with its planetary range at the back and its shift unit on top.
 *
 * ---------------------------------------------------------------- research (AirSup's step 1)
 * The machine: a 12.8 L four-stroke diesel, six in line, 131 × 158 mm, 18 : 1, four valves a cylinder, a camshaft
 * in the block with pushrods, a common rail to 2,400 bar, one turbocharger with a wastegate and a charge air cooler,
 * SCR alone after it (no EGR) [inferred, as heavy diesels of the 2010s–2020s are built]; 338 kW (460 hp) at
 * 1,900 rpm, 2,300 N·m from 1,000 to 1,400 rpm; 1,050 kg dry. The gearbox: an automated 12-speed range-splitter (3
 * gears in its main box, a splitter in front, a planetary range behind), 14.93 … 1.00, the clutch worked by air.
 * The physics, run by `airOf` beside the vehicle solver (./vehicle.js) that gives it the engine's speed and fuel:
 *   compressor  U = ω r₂, Δh = μ U², PR = (1 + η_c Δh / (c_p T₀))^3.5, T₂ = T₀ + Δh / c_p
 *   cooler      T_man = T₂ − ε (T₂ − T₀), p_man = PR p₁ − Δp_cac
 *   cylinders   ṁ_a = η_v p_man / (R T_man) · V_d n / 120, λ = ṁ_a / (14.5 ṁ_f)
 *   exhaust     T₃ = T_man + x · LHV ṁ_f / ((ṁ_a + ṁ_f) c_pg), p₃² = p₄² + (ṁ √T₃ / Φ)², Φ = Φ_t + Φ_g · gate
 *   turbine     P_t = η_t ṁ_t c_pg T₃ (1 − (p₄ / p₃)^0.248), and J ω dω/dt = η_m P_t − ṁ_a Δh
 *   cylinder    p_comp = p_man ε_c^1.32, T_comp = T_man ε_c^0.32, BMEP = 4π T / V_d
 * The one number (for the truck): the power at the wheels; here, the boost, the turbo's speed, the gas before the
 * turbine, the fuel per stroke. Sources: Heywood, "Internal Combustion Engine Fundamentals" (cycle, turbocharging,
 * friction); Watson & Janota, "Turbocharging the Internal Combustion Engine" (the compressor's work, the turbine's
 * flow); the valve timing and the firing order of six-cylinder diesels; no maker is named.
 *
 * In the engine's frame: metres, the crank along z through the origin, its front (the fan and the belts) at +z, the
 * camshaft, the rail and the intake on its left (+x), the exhaust and the turbo on its right (−x).
 */
import * as THREE from 'three';
import { GEO, MAT, clamp } from '$lib/assets/kit.js';
import { at, beltGeometry, beltHole, beltShape, box, circle, coil, cyl, ext, hex, hose, latheY, latheZ, onY, plate, rrect, slab, spurGeometry } from './vehicle.js';

/** @typedef {[number, number, number]} V3 */
/** @typedef {[number, number]} V2 */
/** @typedef {ReturnType<typeof import('$lib/assets/parts.js').assetKit>} Kit */

/** the engine's measures (m) and its timing (crank degrees after its cylinder's firing top dead centre) */
export const SIX = {
	bore: 0.131,
	stroke: 0.158,
	rod: 0.255,
	pitch: 0.163,
	/** the piston's pin to its crown */
	ch: 0.08,
	cr: 18,
	order: [1, 5, 3, 6, 2, 4],
	/** the exhaust valves open and close, the intake valves open and close [inferred] */
	exhaust: /** @type {V2} */ ([135, 370]),
	intake: /** @type {V2} */ ([350, 570]),
	/** the cam's lift at the tappet, the rocker's ratio (valve over pushrod arm) */
	lift: 0.0105,
	arms: /** @type {V2} */ ([0.06, 0.07]),
	/** the camshaft's axis (x, y) */
	cam: /** @type {V2} */ ([0.13, 0.22])
};
/** its displacement (m³) */
export const VD = 6 * Math.PI * (SIX.bore / 2) ** 2 * SIX.stroke;
/** each cylinder's firing angle in the cycle (deg, 0 … 720): 1-5-3-6-2-4, a firing every 120° */
export const FIRE = [1, 2, 3, 4, 5, 6].map((c) => 120 * SIX.order.indexOf(c));
/** a valve's lift (0 … 1) at a cylinder's angle in its cycle (deg after its firing) @param {number} phi @param {V2} w */
export const liftAt = (phi, [o, c]) => (phi > o && phi < c ? Math.sin((Math.PI * (phi - o)) / (c - o)) ** 2 : 0);
/** an angle into 0 … 720 @param {number} d */
const cyc = (d) => ((d % 720) + 720) % 720;
/**
 * A casing's walls, `t` thick, round a space w × h × d centred on `c`, so what it holds shows when it is cut;
 * `open` leaves out its bottom (a cover on its gasket).
 * @param {number} w @param {number} h @param {number} d @param {number} t @param {V3} c @param {boolean} [open]
 */
function walls(w, h, d, t, [x, y, z], open = false) {
	const g = [at(box(w, t, d, t * 0.45), x, y + h / 2 - t / 2, z)];
	if (!open) g.push(at(slab(w, t, d), x, y - h / 2 + t / 2, z));
	for (const sx of [-1, 1]) g.push(at(slab(t, h - t, d), x + sx * (w / 2 - t / 2), y - t / 2, z), at(slab(w - 2 * t, h - t, t), x, y - t / 2, z + sx * (d / 2 - t / 2)));
	return GEO.merge(g);
}

// ---------------------------------------------------------------- the air and the fire

/** the turbocharger, the charge air cooler and the cylinders' gas as `airOf` runs them [inferred where not stated] */
export const AIR = {
	/** the compressor wheel's tip radius (m), its work factor and efficiency; the turbine's and the bearings' */
	r2: 0.048,
	mu: 0.7,
	etaC: 0.78,
	etaT: 0.74,
	etaM: 0.97,
	/** the rotor's inertia (kg·m²): both wheels and the shaft */
	J: 1.0e-3,
	/** the turbine's flow capacity, and the wastegate's when wide open (m² √K) */
	phiT: 5.2e-5,
	phiG: 6.0e-5,
	/** the wastegate opens from this boost (Pa, absolute) and is wide open this much above it */
	set: 3.2e5,
	band: 0.2e5,
	cp: 1005,
	cpg: 1150,
	R: 287,
	T0: 298,
	p0: 101325,
	/** the air filter's and the charge air cooler's pressure drops (Pa), the cooler's effectiveness */
	filter: 0.025e5,
	cac: 0.1e5,
	eps: 0.82,
	/** the cylinders' volumetric efficiency, the fuel's heating value (J/kg), the share of it the gas carries out */
	etaV: 0.92,
	LHV: 42.6e6,
	x: 0.36,
	/** the pressure after the turbine, through the aftertreatment (Pa) */
	p4: 1.07e5
};

/**
 * The air through the engine, stepped in time from its speed and its fuel: the turbo's speed and so the boost, the
 * wastegate, the air's mass and the gas's heat before the turbine, the excess air, the fuel per stroke, the charge
 * at the end of compression.
 */
export function airOf() {
	const A = AIR;
	const s = { w: 3000, boost: 0, pMan: A.p0, tMan: A.T0, t2: A.T0, ma: 0, mf: 0, t3: A.T0, p3: A.p4, gate: 0, Pt: 0, Pc: 0, lambda: 0, q: 0, rail: 0, pComp: 0, tComp: 0, n: 0 };
	/** @param {number} dt @param {{ n: number, mf: number }} inp the engine's speed (rpm), its fuel (kg/s) */
	function step(dt, { n, mf }) {
		const sub = 20, h = dt / sub;
		for (let k = 0; k < sub; k++) {
			const U = s.w * A.r2, dh = A.mu * U * U;
			const PR = (1 + (A.etaC * dh) / (A.cp * A.T0)) ** 3.5;
			const t2 = A.T0 + dh / A.cp;
			const tMan = t2 - A.eps * (t2 - A.T0);
			const pMan = Math.max(A.p0 * 0.9, PR * (A.p0 - A.filter) - A.cac * clamp(s.ma / 0.4) ** 2);
			const ma = (((A.etaV * pMan) / (A.R * tMan)) * VD * n) / 120;
			const mex = ma + mf;
			const t3 = tMan + (mex > 1e-6 ? (A.x * A.LHV * mf) / (mex * A.cpg) : 0);
			const gate = clamp((pMan - A.set) / A.band);
			const phi = A.phiT + A.phiG * gate;
			const p3 = Math.sqrt(A.p4 ** 2 + ((mex * Math.sqrt(t3)) / phi) ** 2);
			const Pt = A.etaT * mex * (A.phiT / phi) * A.cpg * t3 * (1 - (A.p4 / p3) ** 0.248);
			const Pc = ma * dh;
			s.w = Math.max(800, s.w + ((A.etaM * Pt - Pc) / (A.J * s.w)) * h);
			Object.assign(s, { t2, tMan, pMan, ma, mf, t3, p3, gate, Pt, Pc });
		}
		s.n = n;
		s.boost = s.pMan - A.p0;
		s.lambda = mf > 1e-6 ? s.ma / (14.5 * mf) : 0;
		// the fuel per stroke (mm³): the fuel over the injections, six every two turns
		s.q = n > 1 ? (mf / ((n / 120) * 6) / 835) * 1e9 : 0;
		// the rail's pressure: the control unit's map, from 500 bar at idle to 2,400 bar at the most fuel [inferred]
		s.rail = n > 1 ? 500 + 1900 * clamp(s.q / 300) : 0;
		s.pComp = s.pMan * SIX.cr ** 1.32;
		s.tComp = s.tMan * SIX.cr ** 0.32;
	}
	return { s, step };
}

// ---------------------------------------------------------------- the engine in its parts

/** the heavy engine's palette: the engine room's (./vehicle.js) and its own */
export function dieselMaterials() {
	return {
		block: MAT.paint({ color: [0.08, 0.09, 0.1], roughness: 0.55, clearcoat: 0.15, cap: [0.42, 0.42, 0.42], capRough: 0.6 }),
		iron: MAT.castIron({ color: [0.28, 0.28, 0.29] }),
		liner: MAT.castIron({ color: [0.36, 0.36, 0.37], roughness: 0.4, finish: 'turned' }),
		piston: MAT.steel({ color: [0.5, 0.5, 0.5], roughness: 0.36, finish: 'turned' }),
		rod: MAT.steelDark({ roughness: 0.36 }),
		crank: MAT.steel({ roughness: 0.16, color: [0.6, 0.6, 0.6], cap: [0.8, 0.79, 0.76], capRough: 0.3 }),
		gear: MAT.steel({ roughness: 0.2, finish: 'turned', cap: [0.82, 0.81, 0.78] }),
		valve: MAT.steel({ color: [0.62, 0.6, 0.57], roughness: 0.28 }),
		spring: MAT.paint({ color: [0.03, 0.03, 0.035], roughness: 0.4, metalness: 0.4 }),
		alloy: MAT.aluminium({ color: [0.74, 0.75, 0.76], roughness: 0.42 }),
		cover: MAT.plastic({ color: [0.04, 0.04, 0.045], roughness: 0.5 }),
		pan: MAT.paint({ color: [0.06, 0.065, 0.07], roughness: 0.55, clearcoat: 0.1 }),
		rail: MAT.steel({ color: [0.6, 0.6, 0.6], roughness: 0.22 }),
		line: MAT.steel({ color: [0.62, 0.62, 0.63], roughness: 0.3 }),
		hot: MAT.inconel({ color: [0.45, 0.4, 0.36], roughness: 0.55 }),
		turbine: MAT.inconel({ roughness: 0.4 }),
		wheel: MAT.aluminiumMachined({ roughness: 0.2 }),
		manifold: MAT.castIron({ color: [0.26, 0.17, 0.12], roughness: 0.78 }),
		shield: MAT.stainless({ roughness: 0.3, finish: 'brushed' }),
		hose: MAT.rubber({ color: [0.02, 0.02, 0.022], roughness: 0.6 }),
		belt: MAT.rubber({ color: [0.03, 0.03, 0.032], roughness: 0.7 }),
		black: MAT.paint({ color: [0.025, 0.025, 0.028], roughness: 0.45, clearcoat: 0.2 }),
		filter: MAT.paint({ color: [0.75, 0.75, 0.72], roughness: 0.4 }),
		yellow: MAT.plastic({ color: [0.85, 0.6, 0.02], roughness: 0.35 }),
		copper: MAT.copper({ roughness: 0.35 }),
		friction: MAT.ceramic({ color: [0.22, 0.2, 0.17], roughness: 0.92 }),
		oil: MAT.fluid({ color: [0.36, 0.2, 0.04], roughness: 0.06 }),
		ecu: MAT.aluminium({ color: [0.5, 0.52, 0.54], roughness: 0.5 }),
		harness: MAT.plastic({ color: [0.02, 0.02, 0.025], roughness: 0.75 }),
		blue: MAT.anodised({ color: [0.05, 0.12, 0.35] }),
		flame: MAT.glow({ emissive: [1, 0.42, 0.08], emissiveIntensity: 5 })
	};
}
/** @typedef {ReturnType<typeof dieselMaterials>} DieselMats */

/**
 * @typedef {object} SixOptions
 * @property {THREE.Object3D} parent @property {V3} at the crank's middle, in `parent`
 * @property {number[]} gears the gearbox's ratios, first to top (12: six low range, six high)
 * @property {number} range the planetary range's ratio
 * @property {string} assembly @property {string} gearAssembly @property {string} [source] @property {string} [airSource]
 * @property {DieselMats} M
 * @property {Record<string, (() => string) | undefined>} [tags] live values for the labels: `engine`, `turbo`,
 *   `exhaust`, `rail`, `injector`, `cylinder`, `gearbox`
 */

/**
 * The 13 L six and its gearbox in their parts, each with its card. In the engine's frame (above); `update` turns it.
 * @param {Kit} kit @param {SixOptions} o
 */
export function dieselSix(kit, o) {
	const { M } = o, T = o.tags ?? {};
	const R = SIX.bore / 2, r = SIX.stroke / 2, L = SIX.rod, p = SIX.pitch, ch = SIX.ch, n = 6;
	const deck = r + L + ch;
	const lb = (n * p) / 2 + 0.03;
	const hw = 0.15;
	const yb = 0.262;
	const pan = -0.135, bed = -0.19;
	const [xc, yc] = SIX.cam;
	const zc = (/** @type {number} */ i) => ((n - 1) / 2 - i) * p;
	const pin = (/** @type {number} */ i) => (-FIRE[i] * Math.PI) / 180;
	const E = new THREE.Group();
	E.name = 'engine';
	E.position.set(...o.at);
	o.parent.add(E);
	const m = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ mat) => kit.mesh(g, mat);
	/** @param {any} info @param {THREE.Object3D[]} objs @param {import('$lib/assets/parts.js').How} [how] */
	const part = (info, objs, how = {}) => {
		const g = new THREE.Group();
		g.add(...objs);
		return kit.part(g, { assembly: o.assembly, source: o.source, ...info }, how, E);
	};
	const tag = (/** @type {string} */ key, /** @type {string} */ text, /** @type {V3} */ where, side = /** @type {'left' | 'right'} */ ('right')) => (T[key] ? { text, at: where, value: T[key], side } : undefined);
	const spin = () => new THREE.Group();
	const mains = Array.from({ length: n + 1 }, (_, k) => clamp((n / 2 - k) * p, -lb + 0.015, lb - 0.015));

	/* ------------------------------------------------------------ the block, its liners, the bedplate */
	{
		const top = rrect(2 * hw, 2 * lb, 0.014);
		for (let i = 0; i < n; i++) {
			top.holes.push(circle(0, -zc(i), R + 0.0115));
			for (const dz of [0.032, -0.032]) top.holes.push(circle(xc, -(zc(i) + dz), 0.0135));
		}
		/** @type {THREE.BufferGeometry[]} */
		const g = [onY(plate(top, deck - yb, 32), (deck + yb) / 2)];
		for (const sx of [-1, 1]) {
			const s = new THREE.Shape();
			s.moveTo(sx * (hw - 0.014), yb + 0.004);
			s.lineTo(sx * hw, yb + 0.004);
			s.lineTo(sx * (hw + 0.03), pan);
			s.lineTo(sx * (hw + 0.016), pan);
			s.closePath();
			g.push(plate(s, 2 * lb, 2));
			// the mounts' bosses and the ribs down the skirt
			g.push(at(box(0.04, 0.09, 0.12, 0.008), sx * (hw + 0.035), 0.02, lb - 0.16));
			for (const z of [-0.3, -0.05, 0.2]) g.push(at(box(0.012, yb - pan - 0.02, 0.02, 0.004), sx * (hw + 0.012), (yb + pan) / 2 - 0.004, z));
		}
		for (const z of mains) {
			const s = new THREE.Shape();
			s.moveTo(-hw - 0.012, 0);
			s.lineTo(-0.06, 0);
			s.absarc(0, 0, 0.06, Math.PI, 0, true);
			s.lineTo(hw + 0.012, 0);
			s.lineTo(hw + 0.012, yb);
			s.lineTo(-hw - 0.012, yb);
			s.closePath();
			s.holes.push(circle(xc, yc, 0.026));
			g.push(plate(s, 0.026, 24).translate(0, 0, z));
		}
		// the camshaft's gallery along the left, its tappets' bores up into the deck
		const gal = rrect(0.11, yb - 0.15, 0.012, xc, (yb + 0.15) / 2);
		gal.holes.push(circle(xc, yc, 0.04));
		g.push(plate(gal, 2 * lb, 20));
		const rail = rrect(2 * hw + 0.07, 2 * lb, 0.012);
		rail.holes.push(rrect(2 * hw + 0.01, 2 * lb - 0.04, 0.008));
		g.push(onY(plate(rail, 0.014, 6), pan + 0.007));
		part(
			{ id: 'block', label: 'Cylinder block', what: 'The cast-iron block: six bores in its deck where the wet liners stand in their coolant, the crankcase under them with seven bulkheads for the crankshaft’s main bearings, and the camshaft’s gallery along its left with the tappets’ bores up into the deck. Every other part of the engine bolts to it.', specs: [['Displacement', `${(VD * 1000).toFixed(1)} L (${Math.round(SIX.bore * 1000)} × ${Math.round(SIX.stroke * 1000)} mm, six in line)`], ['Power', '338 kW (460 hp) at 1,900 rpm [inferred]'], ['Torque', '2,300 N·m from 1,000 to 1,400 rpm [inferred]'], ['Mass', '1,050 kg dry [inferred]']] },
			[m(GEO.merge(g), M.block)],
			{ explode: [0, 0, 0], xray: 'shell', tag: tag('engine', '13 L six', [-hw - 0.03, deck - 0.12, 0.25], 'right') }
		);
		const liners = [];
		for (let i = 0; i < n; i++) liners.push(latheY([[R, deck - 0.21], [R + 0.011, deck - 0.21], [R + 0.011, deck], [R, deck]], 40).translate(0, 0, zc(i)));
		part({ id: 'liners', label: 'Cylinder liners', count: 6, what: 'Six wet liners of centrifugally cast iron, each a sleeve the piston runs in, its outside washed by the coolant; worn out, a liner is pulled and a new one pressed in, and the block lives on.', specs: [['Bore', `${Math.round(SIX.bore * 1000)} mm, plateau honed`], ['Wall', '11 mm [inferred]']] }, [m(GEO.merge(liners), M.liner)], { explode: [0, 0.5, 0], xray: 'shell' });
		const bp = rrect(2 * hw + 0.07, 2 * lb, 0.012);
		bp.holes.push(rrect(2 * hw - 0.05, 2 * lb - 0.06, 0.02));
		/** @type {THREE.BufferGeometry[]} */
		const bg = [onY(plate(bp, pan - bed, 8), (bed + pan) / 2)];
		for (const z of mains) {
			const s = new THREE.Shape();
			s.moveTo(-0.1, 0);
			s.lineTo(-0.06, 0);
			s.absarc(0, 0, 0.06, Math.PI, Math.PI * 2, false);
			s.lineTo(0.1, 0);
			s.lineTo(0.1, pan);
			s.lineTo(-0.1, pan);
			s.closePath();
			bg.push(plate(s, 0.026, 24).translate(0, 0, z), at(box(2 * hw + 0.06, pan - bed, 0.03, 0.004), 0, (bed + pan) / 2, z), cyl([-0.08, pan, z], [-0.08, pan + 0.02, z], 0.012, 8), cyl([0.08, pan, z], [0.08, pan + 0.02, z], 0.012, 8));
		}
		part({ id: 'bedplate', label: 'Bedplate and main bearing caps', what: 'A ladder of cast iron bolted under the crankcase: seven caps that close the main bearings round the crankshaft, tied in one frame so the block does not flex at its skirts.', specs: [['Bolts', '14 main bearing bolts, M18 [inferred]']] }, [m(GEO.merge(bg), M.iron)], { explode: [0, -0.32, 0] });
	}

	/* ------------------------------------------------------------ the crankshaft and its damper */
	const crank = spin();
	{
		const web = new THREE.Shape();
		web.moveTo(0.098, -0.035);
		web.lineTo(0.048, r);
		web.absarc(0, r, 0.048, 0, Math.PI, false);
		web.lineTo(-0.098, -0.035);
		web.absarc(0, 0, 0.105, (200 * Math.PI) / 180, (340 * Math.PI) / 180, false);
		const g = [];
		for (const z of mains) g.push(cyl([0, 0, z - 0.018], [0, 0, z + 0.018], 0.055, 20));
		for (let i = 0; i < n; i++) {
			const ph = pin(i), px = r * Math.sin(ph), py = r * Math.cos(ph);
			g.push(cyl([px, py, zc(i) - 0.023], [px, py, zc(i) + 0.023], 0.045, 20));
			for (const sd of [-1, 1]) g.push(ext(web, 0.024, 0.002, 6).rotateZ(-ph).translate(0, 0, zc(i) + sd * 0.0355));
		}
		g.push(cyl([0, 0, lb - 0.015], [0, 0, lb + 0.12], 0.04, 24), cyl([0, 0, -lb + 0.015], [0, 0, -lb - 0.07], 0.07, 28));
		const damper = latheZ([[0.04, lb + 0.035], [0.15, lb + 0.035], [0.15, lb + 0.075], [0.04, lb + 0.075]], 48);
		crank.add(m(GEO.merge(g), M.crank), m(damper, M.black));
		part({ id: 'crankshaft', label: 'Crankshaft and damper', what: 'The forged steel crankshaft on seven main journals: six throws at 120°, cylinders 1 and 6, 2 and 5, 3 and 4 in pairs, turn the pistons’ push into torque, and its twelve counterweights balance them; a six in line is in balance by itself. The viscous damper on its nose calms its twisting.', moves: 'Turns at the engine’s speed (shown 40 times slower).', drive: 'The pistons, through the rods', specs: [['Stroke', `${Math.round(SIX.stroke * 1000)} mm`], ['Main journals', '7, Ø 110 mm [inferred]'], ['Firing order', SIX.order.join('-')]] }, [crank], { explode: [0, -0.6, 0] });
	}

	/* ------------------------------------------------------------ the pistons, their fire, the rods */
	/** @type {THREE.Group[]} */
	const pistons = [];
	/** @type {THREE.Group[]} */
	const rods = [];
	/** @type {THREE.Mesh[]} */
	const flames = [];
	{
		const Rp = R - 0.0005;
		/** @type {V2[]} */
		const prof = [[0, ch - 0.01], [0.012, ch - 0.017], [0.028, ch - 0.025], [0.045, ch - 0.017], [0.041, ch - 0.005], [0.043, ch], [Rp, ch]];
		for (const y of [ch - 0.012, ch - 0.024, ch - 0.036]) prof.push([Rp, y], [Rp - 0.004, y], [Rp - 0.004, y - 0.003], [Rp, y - 0.003]);
		prof.push([Rp, -0.06], [R - 0.008, -0.06], [R - 0.008, ch - 0.04], [0, ch - 0.04]);
		const pg = latheY(prof, 32);
		const pinG = cyl([-(R - 0.006), 0, 0], [R - 0.006, 0, 0], 0.024, 18);
		const flameG = GEO.lathe([[0, -0.012], [0.03, -0.008], [0.044, 0.002], [0.03, 0.009], [0, 0.012]], 24);
		const rod = new THREE.Shape();
		const R1 = 0.062, R2 = 0.032, wb = 0.024, wt = 0.015;
		const y1 = Math.sqrt(R1 * R1 - wb * wb), y2 = L - Math.sqrt(R2 * R2 - wt * wt);
		rod.moveTo(wb, y1);
		rod.absarc(0, 0, R1, Math.atan2(y1, wb), Math.atan2(y1, -wb), true);
		rod.lineTo(-wt, y2);
		rod.absarc(0, L, R2, Math.atan2(y2 - L, -wt), Math.atan2(y2 - L, wt), true);
		rod.closePath();
		rod.holes.push(circle(0, 0, 0.046), circle(0, L, 0.0245));
		const rodG = GEO.merge([ext(rod, 0.034, 0.002, 7), cyl([0.054, -0.045, 0], [0.054, 0.016, 0], 0.007, 8), cyl([-0.054, -0.045, 0], [-0.054, 0.016, 0], 0.007, 8)]);
		for (let i = 0; i < n; i++) {
			const pis = new THREE.Group();
			const fl = m(flameG, M.flame);
			fl.visible = false;
			fl.position.y = ch - 0.012;
			flames.push(fl);
			pis.add(m(pg, M.piston), m(pinG, M.crank), fl);
			pis.position.z = zc(i);
			pistons.push(pis);
			const rd = new THREE.Group();
			rd.add(m(rodG, M.rod));
			rd.position.z = zc(i);
			rods.push(rd);
		}
		part({ id: 'pistons', label: 'Pistons', count: 6, what: 'Six forged steel pistons, a re-entrant bowl in each crown where the injector sprays its fuel into the swirling air and it burns, three rings sealing each in its liner. The fire is drawn in a bowl as its cylinder fires, from the start of injection until the fuel has burnt.', moves: 'Up and down their liners (shown 40 times slower); the fire in each bowl at its firing, in the order 1-5-3-6-2-4.', drive: 'The burning charge; they drive the rods', specs: [['Diameter', `${Math.round(SIX.bore * 1000)} mm`], ['Compression', `${SIX.cr} : 1`], ['Rings', '2 compression, 1 oil']] }, pistons, { explode: [0, 0.75, 0], tag: tag('cylinder', 'Cylinder 1', [0, ch, zc(0)], 'left') });
		for (const fl of flames) fl.castShadow = fl.receiveShadow = false;
		part({ id: 'rods', label: 'Connecting rods', count: 6, what: 'Forged steel I-section rods, their big ends cracked apart along a line and bolted back on their own broken faces round the crank pins, so each cap goes back exactly where it was.', moves: 'Swing and slide with the pistons.', drive: 'The pistons; they drive the crankshaft', specs: [['Length', `${Math.round(L * 1000)} mm between centres`], ['Big end', 'Fracture split, 2 bolts']] }, rods, { explode: [0, 0.62, 0] });
	}

	/* ------------------------------------------------------------ the heads, the valve train, the injectors */
	const hTop = deck + 0.11;
	const [arm1, arm2] = SIX.arms, xs = xc - arm1, ys = deck + 0.21;
	/** the tappet's roller on the cam's base circle */
	const y0 = yc + 0.028 + 0.009;
	/** the cam lobes, tappets and rockers, the valves: one of each per cam (cylinder × intake/exhaust) */
	/** @type {{ i: number, intake: boolean, lifter: THREE.Group, rocker: THREE.Group, valves: THREE.Group }[]} */
	const trains = [];
	{
		/** @type {THREE.BufferGeometry[]} */
		const heads = [], bolts = [];
		for (let i = 0; i < n; i++) {
			const s = rrect(hw + 0.168, p - 0.004, 0.012, (0.168 - hw) / 2, 0);
			for (const dz of [0.032, -0.032]) {
				for (const dx of [0.027, -0.027]) s.holes.push(circle(dx, -dz, 0.0075));
				s.holes.push(circle(xc, -dz, 0.011));
			}
			s.holes.push(circle(0, 0, 0.0125));
			heads.push(onY(plate(s, hTop - deck - 0.002, 24), (deck + hTop) / 2 + 0.001).translate(0, 0, zc(i)));
			for (const [bx, bz] of [[-0.105, 0.06], [-0.105, -0.06], [0.092, 0.06], [0.092, -0.06]]) bolts.push(hex([bx, hTop, zc(i) + bz], [0, 1, 0], 0.013, 0.018), cyl([bx, hTop, zc(i) + bz], [bx, hTop + 0.003, zc(i) + bz], 0.018, 16));
		}
		const gasket = [];
		for (let i = 0; i < n; i++) {
			const s = rrect(hw + 0.168, p - 0.004, 0.012, (0.168 - hw) / 2, 0);
			s.holes.push(circle(0, 0, R + 0.002));
			gasket.push(onY(plate(s, 0.0018, 24), deck + 0.0009).translate(0, 0, zc(i)));
		}
		part({ id: 'heads', label: 'Cylinder heads', count: 6, what: 'One cast-iron head for each cylinder, held down on its gasket by four long bolts: its ports, four valves’ seats and guides round the injector’s well in its middle, and the pushrods’ passages; a head comes off alone to work on one cylinder.', specs: [['Valves', '4 a cylinder, 24 in all'], ['Bolts', '24, M16 [inferred]']] }, [m(GEO.merge(heads), M.iron), m(GEO.merge(bolts), M.gear), m(GEO.merge(gasket), M.copper)], { explode: [0, 0.42, 0], xray: 'shell' });

		// the camshaft in the block, turned at half the crank's speed by the gear train behind
		/** @type {THREE.BufferGeometry[]} */
		const cg = [cyl([0, 0, -lb - 0.02], [0, 0, lb - 0.01], 0.022, 16)];
		for (const z of mains) cg.push(cyl([0, 0, z - 0.012], [0, 0, z + 0.012], 0.026, 20));
		const lobeOf = (/** @type {V2} */ w) => {
			const half = ((w[1] - w[0]) / 4) * (Math.PI / 180), rb = 0.028, s = new THREE.Shape();
			for (let k = 0; k <= 72; k++) {
				const a = (k / 72) * Math.PI * 2 - Math.PI, u = Math.abs(a) < half ? Math.cos((Math.PI / 2) * (a / half)) ** 2 : 0;
				const rr = rb + SIX.lift * u;
				if (k === 0) s.moveTo(rr * Math.cos(a), rr * Math.sin(a));
				else s.lineTo(rr * Math.cos(a), rr * Math.sin(a));
			}
			return s;
		};
		for (let i = 0; i < n; i++)
			for (const intake of [true, false]) {
				const w = intake ? SIX.intake : SIX.exhaust;
				// its nose upward, under its tappet, when its valves are most open
				const beta = Math.PI / 2 + ((FIRE[i] + (w[0] + w[1]) / 2) * Math.PI) / 360;
				cg.push(ext(lobeOf(w), 0.02, 0.0015, 4).rotateZ(beta).translate(0, 0, zc(i) + (intake ? 0.032 : -0.032)));
			}
		const cam = spin();
		cam.add(m(GEO.merge(cg), M.crank));
		cam.position.set(xc, yc, 0);
		part({ id: 'camshaft', label: 'Camshaft', what: 'One camshaft low in the block, on seven bearings, turned by the gear train at half the crank’s speed: twelve lobes, an intake and an exhaust for each cylinder, each lifting its tappet at its moment of the cycle.', moves: 'Turns at half the crank’s speed (shown slowed).', drive: 'The gear train', specs: [['Lift', `${(SIX.lift * 1000).toFixed(1)} mm at the tappet`], ['Exhaust', `opens ${180 - SIX.exhaust[0]}° before bottom centre, closes ${SIX.exhaust[1] - 360}° after top`], ['Intake', `opens ${360 - SIX.intake[0]}° before top centre, closes ${SIX.intake[1] - 540}° after bottom`]] }, [cam], { explode: [0.45, -0.1, 0] });
		E.userData.cam = cam;

		// the tappets and pushrods, the rockers on their shaft, the bridges and valves
		const tappet = cyl([0, 0.003, 0], [0, 0.07, 0], 0.012, 14);
		const roller = cyl([0, 0, -0.007], [0, 0, 0.007], 0.009, 14);
		// the pushrod's ball just in its rocker's cup
		const top = ys - 0.024 - y0;
		const pushrod = GEO.merge([cyl([0, 0.07, 0], [0, top, 0], 0.0055, 8), new THREE.SphereGeometry(0.008, 10, 8).translate(0, top, 0)]);
		const rockerS = new THREE.Shape();
		rockerS.moveTo(-arm2 - 0.008, -0.012);
		rockerS.lineTo(arm1 + 0.012, -0.004);
		rockerS.lineTo(arm1 + 0.012, 0.012);
		rockerS.absarc(0, 0, 0.022, 0.4, Math.PI - 0.3, false);
		rockerS.lineTo(-arm2 - 0.008, 0.004);
		rockerS.closePath();
		rockerS.holes.push(circle(0, 0, 0.0125));
		const rockerG = GEO.merge([ext(rockerS, 0.018, 0.0015, 6), cyl([-arm2, -0.012, 0], [-arm2, -0.022, 0], 0.008, 10), cyl([arm1, -0.004, 0], [arm1, -0.016, 0], 0.007, 10)]);
		const valveG = (/** @type {number} */ dx) => GEO.merge([latheY([[0, deck + 0.001], [0.021, deck + 0.001], [0.021, deck + 0.004], [0.006, deck + 0.016], [0.0045, deck + 0.03], [0.0045, deck + 0.17], [0, deck + 0.17]], 20).translate(dx, 0, 0), cyl([dx, deck + 0.152, 0], [dx, deck + 0.158, 0], 0.016, 14)]);
		const springG = (/** @type {number} */ dx) => coil(0.0135, 0.0022, 7, 0.042, 50, 5).translate(dx, hTop, 0);
		const bridgeG = GEO.merge([at(box(0.072, 0.012, 0.016, 0.003), 0, deck + 0.177, 0), cyl([0, deck + 0.183, 0], [0, deck + 0.188, 0], 0.008, 10)]);
		const lifters = new THREE.Group(), rocks = new THREE.Group(), vs = new THREE.Group();
		for (let i = 0; i < n; i++)
			for (const intake of [true, false]) {
				const z = zc(i) + (intake ? 0.032 : -0.032);
				const lifter = spin();
				lifter.position.set(xc, y0, z);
				lifter.add(m(tappet, M.gear), m(roller, M.crank), m(pushrod, M.valve));
				lifters.add(lifter);
				const rk = spin();
				rk.position.set(xs, ys, z);
				rk.add(m(rockerG, M.rod));
				rocks.add(rk);
				const vg = spin();
				vg.position.z = z;
				vg.add(m(GEO.merge([valveG(0.027), valveG(-0.027)]), M.valve), m(bridgeG, M.gear));
				vs.add(vg);
				trains.push({ i, intake, lifter, rocker: rk, valves: vg });
			}
		const springs = [];
		for (let i = 0; i < n; i++) for (const dz of [0.032, -0.032]) for (const dx of [0.027, -0.027]) springs.push(springG(dx).translate(0, 0, zc(i) + dz));
		const shaft = GEO.merge([cyl([xs, ys, -lb + 0.02], [xs, ys, lb - 0.02], 0.0115, 16), ...Array.from({ length: n }, (_, i) => at(box(0.03, ys - hTop + 0.012, 0.03, 0.004), xs, (ys + hTop) / 2 - 0.006, zc(i)))]);
		part({ id: 'tappets-pushrods', label: 'Tappets and pushrods', count: 12, what: 'A roller tappet riding on each cam lobe, sliding up its bore in the block, and a steel pushrod from it up through the head to its rocker: twelve, one for each pair of valves.', moves: 'Rise and fall on their lobes, at the cam’s timing.', drive: 'The camshaft', specs: [['Rollers', 'Needle bearings [inferred]']] }, [lifters], { explode: [0.32, 0.2, 0] });
		part({ id: 'rockers', label: 'Rockers and rocker shaft', count: 12, what: 'Twelve forged rockers on one hollow shaft over the heads, oiled through it: each one’s short arm is lifted by its pushrod, its long arm presses down on a bridge, opening two valves at once by 1.17 times the cam’s lift.', moves: 'Rock on their shaft as their pushrods rise.', drive: 'The pushrods', specs: [['Ratio', `${(arm2 / arm1).toFixed(2)} : 1`], ['Valve lift', `${((SIX.lift * arm2) / arm1 * 1000).toFixed(1)} mm`]] }, [rocks, m(shaft, M.gear)], { explode: [0, 0.62, 0] });
		part({ id: 'valves', label: 'Valves, springs and bridges', count: 24, what: 'Twenty-four poppet valves, two intake and two exhaust round each injector, each pair pushed open together through a bridge and shut again by its spring; the exhaust valves of heat-resistant steel.', moves: 'Open and shut at their cam’s timing: the exhaust pair before the piston’s bottom, the intake pair before its top.', drive: 'The rockers', specs: [['Head', 'Ø 42 mm [inferred]'], ['Springs', '24']] }, [vs, m(GEO.merge(springs), M.spring)], { explode: [0, 0.52, 0] });

		// the injectors, upright in the middle of their four valves, and their clamps
		const inj = [], nozzles = [], plugs = [];
		for (let i = 0; i < n; i++) {
			const z = zc(i);
			inj.push(latheY([[0, deck - 0.004], [0.004, deck - 0.004], [0.0085, deck + 0.012], [0.0085, deck + 0.09], [0.011, deck + 0.095], [0.011, deck + 0.15], [0, deck + 0.15]], 20).translate(0, 0, z));
			nozzles.push(at(box(0.05, 0.008, 0.016, 0.003), -0.022, hTop + 0.03, z), cyl([-0.045, hTop, z], [-0.045, hTop + 0.035, z], 0.006, 8));
			plugs.push(at(box(0.024, 0.018, 0.02, 0.004), 0, deck + 0.158, z));
		}
		part({ id: 'injectors', label: 'Injectors', count: 6, what: 'Six common-rail injectors stood upright in the middle of each cylinder’s four valves, their nozzles just into the bowl: the control unit opens each with a solenoid for a few thousandths of a second, and the rail’s pressure sprays its fuel through eight holes as a fine mist into the hot, squeezed air, where it lights by itself.', moves: 'Fire in turn, at their cylinders’ top centres.', drive: 'The control unit’s signal and the rail’s pressure', specs: [['Nozzle', '8 holes [inferred]'], ['Pressure', 'Up to 2,400 bar']] }, [m(GEO.merge(inj), M.valve), m(GEO.merge(nozzles), M.gear), m(GEO.merge(plugs), M.black)], { explode: [0, 0.9, 0], tag: tag('injector', 'Injector', [0, deck + 0.16, zc(0)], 'left') });
	}

	/* ------------------------------------------------------------ the rocker cover */
	{
		const g = [walls(hw + 0.17, 0.15, 2 * lb - 0.04, 0.006, [(0.17 - hw) / 2, hTop + 0.087, 0], true), at(box(hw + 0.19, 0.012, 2 * lb - 0.02, 0.004), (0.17 - hw) / 2, hTop + 0.006, 0)];
		part({ id: 'rocker-cover', label: 'Rocker cover', what: 'One long moulded cover over the six heads, the rockers and the injectors, sealed on its gasket; the oil filler and the crankcase breather in it.', specs: [['Material', 'Glass-filled polyamide [inferred]']] }, [m(GEO.merge(g), M.cover), m(cyl([0.06, hTop + 0.15, lb - 0.12], [0.06, hTop + 0.17, lb - 0.12], 0.032, 24), M.yellow)], { explode: [0, 1.05, 0], xray: 'shell' });
	}

	/* ------------------------------------------------------------ the gear train at the flywheel end */
	const gz = -lb - 0.022;
	const rk = 0.065, rc = 0.13, ri = 0.05, rp = 0.065, rac = 0.065;
	/** the idler where it meets both the crank's gear and the cam's */
	const idler = (() => {
		const d = Math.hypot(xc, yc), a = rk + ri, b = rc + ri, x0 = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x0 * x0));
		const ux = xc / d, uy = yc / d;
		return /** @type {V2} */ ([x0 * ux + h * uy, x0 * uy - h * ux]);
	})();
	const pumpXY = /** @type {V2} */ ([xc + (rc + rp) * Math.cos(0.26), yc + (rc + rp) * Math.sin(0.26)]);
	const compXY = /** @type {V2} */ ([xc + (rc + rac) * Math.cos(-0.96), yc + (rc + rac) * Math.sin(-0.96)]);
	const gCrank = spin(), gIdler = spin(), gCam = spin(), gPump = spin(), gComp = spin();
	{
		gCrank.add(m(spurGeometry({ r: rk, width: 0.028, module: 0.005, bore: 0.03 }), M.gear));
		gIdler.add(m(spurGeometry({ r: ri, width: 0.028, module: 0.005, bore: 0.015 }), M.gear));
		gCam.add(m(spurGeometry({ r: rc, width: 0.028, module: 0.005, bore: 0.02 }), M.gear), m(GEO.merge([0, 1, 2, 3, 4].map((k) => cyl([0.08 * Math.cos(k * 1.2566), 0.08 * Math.sin(k * 1.2566), -0.016], [0.08 * Math.cos(k * 1.2566), 0.08 * Math.sin(k * 1.2566), 0.016], 0.018, 12))), M.gear));
		gPump.add(m(spurGeometry({ r: rp, width: 0.028, module: 0.005, bore: 0.015 }), M.gear));
		gComp.add(m(spurGeometry({ r: rac, width: 0.028, module: 0.005, bore: 0.015 }), M.gear));
		gCrank.position.set(0, 0, gz);
		gIdler.position.set(idler[0], idler[1], gz);
		gCam.position.set(xc, yc, gz);
		gPump.position.set(pumpXY[0], pumpXY[1], gz);
		gComp.position.set(compXY[0], compXY[1], gz);
		part({ id: 'gear-train', label: 'Gear train', count: 5, what: 'Hardened spur gears in constant mesh at the flywheel end, where the crankshaft twists least: the crank’s gear turns an idler, the idler the camshaft’s gear of twice its teeth (half the speed), and the camshaft’s gear the high-pressure pump’s and the air compressor’s.', moves: 'Turn together with the crank (shown slowed).', drive: 'The crankshaft', specs: [['Cam', '2 : 1'], ['Pump', '1 : 1'], ['Air compressor', `${(rk / rac).toFixed(2)} : 1 … 1 : 1 [inferred]`]] }, [gCrank, gIdler, gCam, gPump, gComp], { explode: [0, 0, -0.45] });
		const cs = /** @type {[number, number, number][]} */ ([[0, 0, rk + 0.03], [idler[0], idler[1], ri], [xc, yc, rc], [pumpXY[0], pumpXY[1], rp], [compXY[0], compXY[1], rac]]);
		const wall = beltShape(cs, 0.022);
		wall.holes.push(beltHole(cs, 0.01));
		const cover = beltShape(cs, 0.022);
		cover.holes.push(circle(0, 0, 0.072));
		const housing = GEO.merge([plate(wall, 0.044, 12).translate(0, 0, -lb - 0.022), plate(cover, 0.008, 12).translate(0, 0, -lb - 0.048)]);
		part({ id: 'gear-housing', label: 'Timing gear housing', what: 'The cast housing across the block’s back face round the gear train, its cover behind; the flywheel housing bolts to it, the pump and the compressor stand on its front face.', specs: [['Material', 'Cast aluminium [inferred]']] }, [m(housing, M.alloy)], { explode: [0, 0, -0.62], xray: 'shell' });
	}

	/* ------------------------------------------------------------ fuel: the pump, the rail, its lines */
	const railX = 0.215, railY = deck - 0.05;
	{
		const [px, py] = pumpXY;
		const pumpG = GEO.merge([latheZ([[0, -lb], [0.05, -lb], [0.05, -lb + 0.16], [0.042, -lb + 0.17], [0.042, -lb + 0.23], [0, -lb + 0.23]], 32).translate(px, py, 0), at(box(0.06, 0.05, 0.08, 0.008), px, py + 0.055, -lb + 0.12), cyl([px - 0.03, py + 0.02, -lb + 0.19], [px - 0.03, py + 0.07, -lb + 0.19], 0.014, 12)]);
		const railG = GEO.merge([cyl([railX, railY, zc(5) - 0.07], [railX, railY, zc(0) + 0.07], 0.017, 20), cyl([railX, railY, zc(0) + 0.07], [railX, railY, zc(0) + 0.11], 0.012, 12), cyl([railX, railY, zc(5) - 0.07], [railX, railY, zc(5) - 0.1], 0.013, 12), ...Array.from({ length: n }, (_, i) => cyl([railX, railY - 0.03, zc(i)], [railX, railY + 0.026, zc(i)], 0.012, 12))]);
		const lines = [hose([[px - 0.03, py + 0.07, -lb + 0.19], [px - 0.04, railY - 0.02, -lb + 0.12], [railX, railY, zc(5) - 0.1]], 0.0045, 6)];
		for (let i = 0; i < n; i++) lines.push(hose([[railX, railY + 0.026, zc(i)], [railX - 0.01, deck + 0.02, zc(i)], [0.18, deck + 0.045, zc(i)], [0.17, deck + 0.045, zc(i)]], 0.0035, 6));
		const nuts = Array.from({ length: n }, (_, i) => hex([0.168, deck + 0.045, zc(i)], [1, 0, 0], 0.011, 0.012));
		part({ id: 'hp-pump', label: 'High-pressure fuel pump', what: 'A two-piston pump on the gear housing, turned by the camshaft’s gear at the crank’s speed: it squeezes the diesel the feed pump brings it to the rail’s pressure, metered by its inlet valve so it gives only what the rail needs.', moves: 'Its shaft turns with its gear.', drive: 'The gear train', specs: [['Pistons', '2 [inferred]'], ['Up to', '2,400 bar']] }, [m(pumpG, M.alloy)], { explode: [0.42, 0.05, -0.2] });
		part({ id: 'common-rail', label: 'Common rail and fuel lines', what: 'A forged steel tube along the engine’s left, holding the fuel at the injection pressure for all six injectors at once, its sensor at the front end and its relief valve at the back; a steel line from the pump, and six quills from the rail through the heads’ sides to the injectors.', specs: [['Pressure', '500 to 2,400 bar, as the control unit’s map asks [inferred]'], ['Lines', 'Ø 9 × 2 mm steel [inferred]']] }, [m(railG, M.rail), m(GEO.merge(lines), M.line), m(GEO.merge(nuts), M.gear)], { explode: [0.5, 0.15, 0], tag: tag('rail', 'Common rail', [railX + 0.02, railY, zc(1)], 'left') });
	}

	/* ------------------------------------------------------------ air in: the intake manifold */
	const imX = 0.238, imY = deck + 0.07;
	{
		const g = /** @type {THREE.BufferGeometry[]} */ ([cyl([imX, imY, zc(5) - 0.07], [imX, imY, zc(0) + 0.05], 0.04, 24), latheZ([[0, zc(0) + 0.04], [0.045, zc(0) + 0.04], [0.045, lb + 0.02], [0.052, lb + 0.02], [0.052, lb + 0.035], [0, lb + 0.035]], 24).translate(imX, imY, 0)]);
		for (let i = 0; i < n; i++) g.push(hose([[0.168, deck + 0.075, zc(i) + 0.032], [0.19, deck + 0.075, zc(i) + 0.03], [imX - 0.02, imY, zc(i) + 0.02]], 0.02, 12));
		part({ id: 'intake-manifold', label: 'Intake manifold', what: 'The cast-aluminium manifold along the heads’ left side: the cooled, pressed air from the charge air cooler comes in at its front and it shares it among the six heads’ intake ports.', specs: [['Material', 'Cast aluminium'], ['Grid heater', 'In its inlet, for cold starts [inferred]']] }, [m(GEO.merge(g), M.alloy)], { explode: [0.55, 0.3, 0] });
	}

	/* ------------------------------------------------------------ gas out: the exhaust manifold and the turbo */
	const emX = -0.19, emY = deck + 0.06;
	const tx = -0.345, ty = deck + 0.04, tzT = -0.2, tzC = -0.03;
	const turbo = spin(), gateArm = spin();
	{
		const e = [];
		for (const half of [0, 1]) {
			const z0 = half ? zc(5) - 0.04 : zc(2) - 0.02, z1 = half ? zc(3) + 0.02 : zc(0) + 0.04;
			e.push(cyl([emX, emY, z0], [emX, emY, z1], 0.034, 20));
			e.push(hose([[emX, emY, half ? zc(4) : zc(1)], [emX - 0.06, emY - 0.02, tzT + (half ? -0.02 : 0.03)], [tx + 0.1, ty, tzT]], 0.03, 14));
		}
		for (let i = 0; i < n; i++) e.push(hose([[-hw, deck + 0.06, zc(i) - 0.032], [-hw - 0.02, deck + 0.06, zc(i) - 0.028], [emX + 0.01, emY, zc(i) - 0.02]], 0.021, 12));
		const rings = [zc(2) - 0.02, zc(3) + 0.02].map((z) => cyl([emX, emY, z - 0.012], [emX, emY, z + 0.012], 0.039, 20));
		const shield = at(box(0.09, 0.006, 2 * lb - 0.1, 0.003), emX, emY + 0.05, 0);
		part({ id: 'exhaust-manifold', label: 'Exhaust manifold', what: 'Two cast halves, their runners on slip joints so they can grow with the heat: the front three cylinders’ gas and the back three’s kept apart into the turbine’s two inlets, so each cylinder’s pulse drives the wheel without spoiling the next. A stainless shield over it.', specs: [['Material', 'Ductile iron with silicon and molybdenum [inferred]'], ['Gas', 'Up to ~650 °C before the turbine']] }, [m(GEO.merge([...e, ...rings]), M.manifold), m(shield, M.shield)], { explode: [-0.55, 0.15, 0], tag: tag('exhaust', 'Exhaust manifold', [emX, emY + 0.04, zc(1)], 'right') });

		// the turbocharger: the turbine's twin volute, the bearing housing, the compressor's volute and its wheels
		const vol = (/** @type {number} */ R0, /** @type {number} */ z0, /** @type {number} */ z1, /** @type {number} */ rIn) => latheZ([[rIn, z0], [R0 * 0.8, z0], [R0, (z0 + z1) / 2], [R0 * 0.8, z1], [rIn, z1]], 40);
		const housings = GEO.merge([vol(0.115, tzT - 0.055, tzT + 0.05, 0.047).translate(tx, ty, 0), latheZ([[0.04, tzT - 0.055], [0.055, tzT - 0.055], [0.055, tzT - 0.11], [0.06, tzT - 0.11], [0.06, tzT - 0.125], [0.04, tzT - 0.125]], 32).translate(tx, ty, 0)]);
		const bearing = latheZ([[0.012, tzT + 0.05], [0.055, tzT + 0.05], [0.05, tzT + 0.09], [0.058, tzC - 0.06], [0.058, tzC - 0.048], [0.012, tzC - 0.048]], 32).translate(tx, ty, 0);
		const comp = GEO.merge([vol(0.12, tzC - 0.048, tzC + 0.04, 0.049).translate(tx, ty, 0), latheZ([[0.036, tzC + 0.04], [0.05, tzC + 0.04], [0.05, tzC + 0.11], [0.056, tzC + 0.11], [0.056, tzC + 0.12], [0.036, tzC + 0.12]], 32).translate(tx, ty, 0), cyl([tx - 0.02, ty + 0.1, tzC], [tx - 0.02, ty + 0.17, tzC], 0.034, 18)]);
		const oil = [hose([[tx, ty + 0.055, tzT + 0.075], [tx + 0.04, ty + 0.12, tzT + 0.08], [-hw - 0.01, deck - 0.06, tzT + 0.1]], 0.005, 6), hose([[tx, ty - 0.055, tzT + 0.075], [tx + 0.02, ty - 0.15, tzT + 0.07], [-hw - 0.02, 0.05, tzT + 0.06]], 0.011, 8)];
		/** a radial wheel's blades: from its eye (r0 … r1 at z0) out to its tip (r2 at z1), `k` of them */
		const blades = (/** @type {number} */ k, /** @type {number} */ r0, /** @type {number} */ r1, /** @type {number} */ r2, /** @type {number} */ z0, /** @type {number} */ z1, /** @type {number} */ t) => {
			const s = new THREE.Shape();
			s.moveTo(r0, z0);
			s.lineTo(r1, z0);
			s.quadraticCurveTo(r2 * 0.95, z0 + (z1 - z0) * 0.2, r2, z1);
			s.lineTo(r0 + 0.004, z1);
			s.closePath();
			const one = plate(s, t, 6).rotateX(Math.PI / 2);
			return GEO.ring(one, k, 'z');
		};
		const cw = GEO.merge([blades(12, 0.012, 0.034, 0.046, tzC + 0.035, tzC - 0.02, 0.0016), latheZ([[0, tzC + 0.035], [0.012, tzC + 0.035], [0.044, tzC - 0.02], [0.046, tzC - 0.026], [0, tzC - 0.026]], 32)]);
		const tw = GEO.merge([blades(11, 0.012, 0.03, 0.044, tzT - 0.05, tzT + 0.01, 0.002), latheZ([[0, tzT - 0.05], [0.012, tzT - 0.05], [0.04, tzT + 0.008], [0.044, tzT + 0.016], [0, tzT + 0.016]], 32)]);
		turbo.add(m(cw, M.wheel), m(tw, M.turbine), m(cyl([0, 0, tzT + 0.01], [0, 0, tzC - 0.02], 0.007, 10), M.crank));
		turbo.position.set(tx, ty, 0);
		// the wastegate: its actuator on the compressor's side, its rod to the flap's lever on the turbine housing
		const act = GEO.merge([latheZ([[0, 0], [0.042, 0], [0.042, 0.035], [0.03, 0.05], [0, 0.05]], 28).rotateX(-Math.PI / 2).translate(tx - 0.14, ty + 0.03, tzC - 0.02), at(box(0.03, 0.01, 0.12, 0.003), tx - 0.12, ty + 0.0, tzC - 0.06)]);
		gateArm.position.set(tx - 0.135, ty + 0.0, tzT + 0.0);
		gateArm.add(m(GEO.merge([at(box(0.012, 0.045, 0.01, 0.002), 0, 0.02, 0), cyl([0, 0.04, 0], [0, 0.04, tzC - 0.04 - tzT], 0.0035, 6)]), M.gear));
		part({ id: 'turbocharger', label: 'Turbocharger', what: 'On one shaft in its oiled bearing housing: a turbine wheel of nickel alloy in the twin-entry volute, spun by the exhaust gas, and an aluminium compressor wheel in its own volute, which pulls the air in at the front and throws it out pressed. Above its boost the wastegate lets part of the gas round the turbine.', moves: 'Its wheels spin at the speed the air model gives (shown 2,000 times slower).', drive: 'The exhaust gas', specs: [['Compressor wheel', 'Ø 96 mm [inferred]'], ['Speed', 'Up to ~100,000 rpm'], ['Wastegate', `opens from ${((AIR.set - AIR.p0) / 1e5).toFixed(1)} bar boost`]] }, [turbo, m(housings, M.hot), m(bearing, M.iron), m(comp, M.alloy), m(GEO.merge(oil), M.line), m(act, M.black), gateArm], { explode: [-0.75, 0.35, 0], tag: tag('turbo', 'Turbocharger', [tx - 0.12, ty + 0.06, tzC], 'right') });
	}

	/* ------------------------------------------------------------ the front: cover, pump, belt, fan, alternator */
	const za = lb + 0.1;
	const wpXY = /** @type {V2} */ ([-0.15, 0.06]), altXY = /** @type {V2} */ ([-0.23, 0.25]), fanXY = /** @type {V2} */ ([0, 0.33]), tenXY = /** @type {V2} */ ([0.14, 0.12]);
	const aCrank = spin(), aPump = spin(), aAlt = spin(), aFan = spin(), aTen = spin(), fan = spin();
	{
		const fc = beltShape([[0, 0, 0.16], [wpXY[0], wpXY[1], 0.08]], 0.0);
		const front = GEO.merge([plate(fc, 0.03, 16).translate(0, 0, lb + 0.015), latheZ([[0.03, lb + 0.03], [0.07, lb + 0.03], [0.07, za - 0.02], [0.03, za - 0.02]], 24).translate(wpXY[0], wpXY[1], 0), at(box(0.06, 0.12, 0.05, 0.01), fanXY[0], fanXY[1] - 0.04, lb + 0.025), cyl([fanXY[0], fanXY[1], lb + 0.04], [fanXY[0], fanXY[1], za - 0.02], 0.03, 18), cyl([0.0, deck - 0.01, lb], [0.0, deck + 0.06, lb + 0.05], 0.035, 18)]);
		const groove = (/** @type {number} */ rr, /** @type {number} */ w) => latheZ([[0.02, -w / 2], [rr, -w / 2], [rr - 0.004, -w / 4], [rr, 0], [rr - 0.004, w / 4], [rr, w / 2], [0.02, w / 2]], 40);
		aCrank.add(m(groove(0.11, 0.036), M.black));
		aPump.add(m(groove(0.06, 0.036), M.black));
		aAlt.add(m(groove(0.035, 0.034), M.gear));
		aFan.add(m(groove(0.09, 0.036), M.black));
		aTen.add(m(latheZ([[0.01, -0.019], [0.04, -0.019], [0.04, 0.019], [0.01, 0.019]], 24), M.gear));
		for (const [g, xy] of /** @type {[THREE.Group, V2][]} */ ([[aCrank, [0, 0]], [aPump, wpXY], [aAlt, altXY], [aFan, fanXY], [aTen, tenXY]])) g.position.set(xy[0], xy[1], za);
		const cs = /** @type {[number, number, number][]} */ ([[0, 0, 0.11], [tenXY[0], tenXY[1], 0.04], [fanXY[0], fanXY[1], 0.09], [altXY[0], altXY[1], 0.035], [wpXY[0], wpXY[1], 0.06]]);
		part({ id: 'front-cover', label: 'Front cover, water pump and thermostat', what: 'The cast cover over the block’s front end round the crank’s seal and the oil pump; the water pump in it drives the coolant through the block, the liners’ jackets and the heads, and the thermostat housing on top sends it to the radiator once it is warm.', specs: [['Water pump', 'Centrifugal, ~450 L/min at rated speed [inferred]'], ['Thermostat', 'Opens at 83 °C [inferred]']] }, [m(front, M.alloy)], { explode: [0, 0.05, 0.45] });
		const tenArm = GEO.merge([at(box(0.03, 0.12, 0.025, 0.006), tenXY[0] + 0.02, tenXY[1] - 0.05, za - 0.03), cyl([tenXY[0] + 0.03, tenXY[1] - 0.1, lb + 0.03], [tenXY[0] + 0.03, tenXY[1] - 0.1, za - 0.02], 0.025, 16)]);
		part({ id: 'accessory-drive', label: 'Belt drive', what: 'One poly-V belt from the crank’s pulley round the fan’s hub, the alternator’s and the water pump’s pulleys, held tight by a spring tensioner.', moves: 'The belt and its pulleys turn with the engine.', drive: 'The crankshaft', specs: [['Belt', '8-rib poly-V [inferred]']] }, [aCrank, aPump, aAlt, aFan, aTen, m(beltGeometry(cs, 0.006, 0.034).translate(0, 0, za), M.belt), m(tenArm, M.black)], { explode: [0, 0.05, 0.75] });
		const alt = GEO.merge([latheZ([[0, -0.16], [0.075, -0.16], [0.08, -0.13], [0.08, -0.03], [0.06, -0.012], [0, -0.012]], 32).translate(altXY[0], altXY[1], za), at(box(0.05, 0.03, 0.12, 0.006), altXY[0] + 0.05, altXY[1] - 0.07, za - 0.1)]);
		part({ id: 'alternator', label: 'Alternator', what: 'Turned by the belt at about three times the crank’s speed, it charges the 24 V batteries and runs everything electric on the truck.', moves: 'Its rotor turns with its pulley.', drive: 'The belt', specs: [['Output', '28 V, 150 A [inferred]']] }, [m(alt, M.alloy), aAlt], { explode: [-0.45, 0.2, 0.4] });
		fan.add(m(GEO.rotor(/** @type {any} */ ({ count: 9, axis: 'z', r0: 0.09, r1: 0.37, chord: [0.09, 0.12], thick: 0.06, camber: 0.08, twist: 0.4, pitch: 0.42, nS: 5, nC: 7 })), M.cover), m(latheZ([[0, 0], [0.11, 0], [0.12, 0.03], [0.11, 0.075], [0, 0.075]], 36).translate(0, 0, -0.075), M.alloy));
		fan.position.set(fanXY[0], fanXY[1], za + 0.1);
		part({ id: 'fan', label: 'Fan and viscous coupling', what: 'Nine moulded blades, 750 mm across, on the fan hub through a viscous coupling: the silicone fluid in it locks the fan to the hub when the air through the radiator is hot and lets it slip when it is not.', moves: 'Turns with its hub.', drive: 'The belt, through the coupling', specs: [['Diameter', '750 mm [inferred]']] }, [fan], { explode: [0, 0.1, 1.0] });
	}

	/* ------------------------------------------------------------ oil, the compressor, the starter, the ECU, the mounts */
	{
		const sw = 2 * hw + 0.06, half = lb - 0.01;
		const ring = (/** @type {number} */ w, /** @type {number} */ l, /** @type {number} */ t) => {
			const s = rrect(w, l, 0.03);
			s.holes.push(rrect(w - 2 * t, l - 2 * t, 0.025));
			return s;
		};
		const z0 = -half / 2;
		const g = [onY(plate(ring(sw, 2 * half, 0.004), 0.05, 8), bed - 0.025), onY(plate(rrect(sw, half, 0.03), 0.004, 8), bed - 0.05).translate(0, 0, half / 2), onY(plate(ring(sw, half, 0.004), 0.17, 8), bed - 0.135).translate(0, 0, z0), onY(plate(rrect(sw, half, 0.03), 0.004, 8), bed - 0.22).translate(0, 0, z0), cyl([0, bed - 0.22, z0], [0, bed - 0.235, z0], 0.014, 6)];
		part({ id: 'sump', label: 'Sump', what: 'The oil pan under the bedplate, deep at its back end where the oil pump’s pickup draws, shallow over the front axle; its drain plug at the bottom.', specs: [['Oil', '36 L, 10W-40 [inferred]']] }, [m(GEO.merge(g), M.pan), m(at(box(sw - 0.012, 0.12, half - 0.012, 0.012), 0, bed - 0.16, z0), M.oil)], { explode: [0, -0.5, 0], xray: 'shell' });
		const oc = GEO.merge([at(box(0.045, 0.13, 0.46, 0.012), -hw - 0.04, 0.12, -0.06), cyl([-hw - 0.06, 0.05, 0.3], [-hw - 0.06, 0.19, 0.3], 0.03, 16)]);
		const filters = GEO.merge([cyl([-hw - 0.085, 0.04, 0.24], [-hw - 0.085, -0.16, 0.24], 0.05, 28), cyl([-hw - 0.085, 0.04, 0.36], [-hw - 0.085, -0.16, 0.36], 0.05, 28)]);
		part({ id: 'oil-cooler-filters', label: 'Oil cooler and filters', count: 2, what: 'A stack of plates in the coolant on the block’s right side that takes the oil’s heat into the water, and two full-flow filters hanging under its housing; the oil pump pushes all the oil through them before the bearings.', specs: [['Filters', '2 spin-on, Ø 100 mm [inferred]']] }, [m(oc, M.alloy), m(filters, M.filter), m(GEO.merge([hose([[-hw - 0.02, 0.0, 0.5], [-hw - 0.04, deck - 0.05, 0.47], [-hw - 0.05, deck + 0.17, 0.46]], 0.005, 8)]), M.line), m(cyl([-hw - 0.05, deck + 0.17, 0.46], [-hw - 0.05, deck + 0.19, 0.46], 0.012, 12), M.yellow)], { explode: [-0.42, -0.1, 0.1] });
		const [cx, cy] = compXY;
		const comp = GEO.merge([latheZ([[0, -lb], [0.062, -lb], [0.062, -lb + 0.15], [0.05, -lb + 0.165], [0, -lb + 0.165]], 32).translate(cx, cy, 0), cyl([cx + 0.04, cy, -lb + 0.08], [cx + 0.15, cy, -lb + 0.08], 0.05, 24)]);
		const head = GEO.merge([at(box(0.03, 0.11, 0.11, 0.008), cx + 0.165, cy, -lb + 0.08)]);
		part({ id: 'air-compressor', label: 'Air compressor', what: 'A piston compressor on the gear housing, turned by the camshaft’s gear: it fills the truck’s air tanks for the brakes, the suspension, the gearbox’s shift unit and the clutch, its head cooled by the engine’s water.', moves: 'Its crank turns with its gear.', drive: 'The gear train', specs: [['Displacement', '~700 cm³, 1 cylinder [inferred]'], ['Pressure', 'Up to 12.5 bar']] }, [m(comp, M.alloy), m(head, M.black)], { explode: [0.5, -0.2, -0.3] });
		const st = /** @type {V2} */ ([-0.25, -0.1]);
		part({ id: 'starter', label: 'Starter motor', what: 'A 24 V motor on the flywheel housing: its solenoid throws its pinion into the flywheel’s ring gear and it spins the engine to start it.', specs: [['Power', '5.5 kW, 24 V [inferred]']] }, [m(GEO.merge([cyl([st[0], st[1], -lb - 0.07], [st[0], st[1], -lb + 0.2], 0.06, 24), cyl([st[0] + 0.03, st[1] + 0.075, -lb - 0.05], [st[0] + 0.03, st[1] + 0.075, -lb + 0.1], 0.03, 16)]), M.black)], { explode: [-0.45, -0.2, -0.2] });
		const ecu = GEO.merge([at(box(0.035, 0.18, 0.28, 0.01), hw + 0.05, 0.03, 0.2), at(box(0.02, 0.04, 0.05, 0.006), hw + 0.075, 0.1, 0.33)]);
		/** @type {THREE.BufferGeometry[]} */
		const harness = [hose([[hw + 0.075, 0.12, 0.34], [hw + 0.08, deck - 0.03, 0.42], [0.12, hTop + 0.05, zc(0) + 0.08], [0.1, hTop + 0.05, zc(5) - 0.05]], 0.008, 8)];
		part({ id: 'ecu', label: 'Engine control unit', what: 'The engine’s computer on rubber mounts on the block’s left: from the pedal, the boost, the temperatures and the crank’s and cam’s positions it sets the rail’s pressure and when and how long each injector opens; its harness runs to all six under the cover.', specs: [['Sensors', 'Crank, cam, boost, rail, air and coolant temperatures [inferred]']] }, [m(ecu, M.ecu), m(GEO.merge(harness), M.harness)], { explode: [0.42, -0.05, 0.2] });
		const mg = [], rub = [];
		for (const sx of [-1, 1]) {
			mg.push(at(box(0.1, 0.03, 0.14, 0.006), sx * (hw + 0.09), -0.03, lb - 0.16), at(box(0.03, 0.09, 0.12, 0.006), sx * (hw + 0.06), 0.02, lb - 0.16));
			rub.push(cyl([sx * (hw + 0.11), -0.105, lb - 0.16], [sx * (hw + 0.11), -0.045, lb - 0.16], 0.04, 20));
			mg.push(at(box(0.09, 0.03, 0.12, 0.006), sx * 0.32, -0.04, -lb - 0.12));
			rub.push(cyl([sx * 0.36, -0.115, -lb - 0.12], [sx * 0.36, -0.055, -lb - 0.12], 0.04, 20));
		}
		part({ id: 'engine-mounts', label: 'Engine mounts', count: 4, what: 'Four rubber blocks on the frame’s brackets, two at the front of the block, two at the flywheel housing: they carry 1,500 kg of engine and gearbox, take its torque and keep its shake out of the frame.', specs: [['Rubber', 'Bonded, ~60 Shore A [inferred]']] }, [m(GEO.merge(mg), M.black), m(GEO.merge(rub), M.hose)], { explode: [0, -0.3, 0] });
	}

	/* ------------------------------------------------------------ the flywheel, the clutch, their housing */
	const fly = spin(), clutchSpin = spin();
	{
		fly.add(m(GEO.merge([latheZ([[0.07, 0], [0.235, 0], [0.235, -0.06], [0.2, -0.06], [0.2, -0.035], [0.07, -0.035]], 56), spurGeometry({ r: 0.245, width: 0.025, module: 0.007, bore: 0.228 }).translate(0, 0, -0.02)]), M.gear));
		fly.position.z = -lb - 0.065;
		part({ id: 'flywheel', label: 'Flywheel', what: 'A heavy steel disc on the crank’s back flange: it carries the engine through the strokes between firings and is the clutch’s friction face; the starter turns its ring gear.', moves: 'Turns with the crankshaft.', specs: [['Mass', '~60 kg [inferred]'], ['Ring gear', '~140 teeth']] }, [fly], { explode: [0, 0, -0.75] });
		clutchSpin.add(m(GEO.shell([[0.225, 0], [0.225, -0.03], [0.09, -0.05]], 0.006, 48).rotateX(Math.PI / 2), M.gear), m(latheZ([[0.12, 0.002], [0.215, 0.002], [0.215, -0.008], [0.12, -0.008]], 48), M.friction));
		clutchSpin.position.z = -lb - 0.13;
		part({ id: 'clutch', label: 'Clutch', assembly: o.gearAssembly, what: 'One 430 mm friction disc pressed on the flywheel by its cover’s diaphragm spring; an air cylinder on the clutch housing pulls it apart to pull away and to change gear, so the truck has no clutch pedal.', moves: 'Turns with the flywheel; slips while it pulls away.', drive: 'Its air actuator, from the gearbox’s control unit', specs: [['Disc', 'Ø 430 mm, single dry plate [inferred]']] }, [clutchSpin], { explode: [0, 0, -0.95] });
		const bell = GEO.merge([GEO.shell([[0.3, -lb - 0.064], [0.3, -lb - 0.1], [0.27, -lb - 0.16]], 0.008, 56).rotateX(Math.PI / 2), latheZ([[0.255, -lb - 0.052], [0.32, -lb - 0.052], [0.32, -lb - 0.066], [0.255, -lb - 0.066]], 56)]);
		part({ id: 'flywheel-housing', label: 'Flywheel housing', what: 'The cast-iron housing round the flywheel, bolted to the gear housing; the starter on it, the gearbox’s clutch housing bolted behind.', specs: [['Size', 'SAE 1 [inferred]']] }, [m(bell, M.iron)], { explode: [0, 0, -0.85], xray: 'shell' });
	}

	/* ------------------------------------------------------------ the gearbox */
	const zg = -lb - 0.16, zm = zg - 0.62, zr = zm - 0.2, zo = zr - 0.02;
	const gin = spin(), glay = spin(), gmain = spin(), sun = spin(), ringG = spin(), carrier = spin(), outF = spin();
	/** @type {{ g: THREE.Group, k: number }[]} */
	const freeGears = [];
	/** @type {THREE.Group[]} */
	const planets = [];
	const Zs = 24, Zr = 86, Zp = (Zr - Zs) / 2;
	const range = o.range;
	{
		const clutchH = GEO.shell([[0.27, zg + 0.002], [0.24, zg - 0.08], [0.22, zg - 0.12]], 0.008, 48).rotateX(Math.PI / 2);
		const caseG = GEO.merge([walls(0.4, 0.42, zg - 0.12 - zm, 0.012, [0, -0.04, (zg - 0.12 + zm) / 2]), GEO.shell([[0.17, zm], [0.17, zm - 0.03], [0.165, zr + 0.03], [0.12, zr], [0.05, zr]], 0.01, 48).rotateX(Math.PI / 2)]);
		const d = 0.13;
		glay.position.set(0, -d, 0);
		const rIn = 0.045;
		gin.add(m(GEO.merge([cyl([0, 0, zg + 0.04], [0, 0, zg - 0.16], 0.022, 14), spurGeometry({ r: rIn, width: 0.03, module: 0.005 }).translate(0, 0, zg - 0.14)]), M.gear));
		glay.add(m(GEO.merge([cyl([0, 0, zg - 0.13], [0, 0, zm + 0.04], 0.022, 14), spurGeometry({ r: d - rIn, width: 0.03, module: 0.005 }).translate(0, 0, zg - 0.14)]), M.gear));
		// the splitter's second input pair, the main box's three and the reverse's
		const steps = [1.28, 2.55, 1.6, 1.0, 3.2];
		steps.forEach((k, j) => {
			const rm = (d * k) / (1 + k), rl = d - rm, z = zg - 0.22 - j * 0.085;
			glay.add(m(spurGeometry({ r: rl, width: 0.026, module: 0.005 }).translate(0, 0, z), M.gear));
			const fg = spin();
			fg.add(m(spurGeometry({ r: rm, width: 0.026, module: 0.005, bore: 0.025 }), M.gear));
			fg.position.z = z;
			freeGears.push({ g: fg, k: 1 / k });
		});
		gmain.add(m(GEO.merge([cyl([0, 0, zg - 0.17], [0, 0, zr + 0.06], 0.025, 14), ...[0, 1, 2].map((j) => cyl([0, 0, zg - 0.26 - j * 0.17], [0, 0, zg - 0.215 - j * 0.17], 0.04, 18))]), M.crank));
		sun.add(m(spurGeometry({ r: (Zs * 0.003) / 2, width: 0.05, module: 0.003 }), M.gear));
		sun.position.z = zm - 0.09;
		const ringS = new THREE.Shape();
		ringS.absarc(0, 0, (Zr * 0.003) / 2 + 0.012, 0, Math.PI * 2, false);
		const teeth = [];
		for (let k = 0; k < Zr; k++) teeth.push(at(slab(0.0035, 0.006, 0.05), 0, (Zr * 0.003) / 2 + 0.002, 0).rotateZ((k / Zr) * Math.PI * 2));
		ringS.holes.push(circle(0, 0, (Zr * 0.003) / 2 + 0.003));
		ringG.add(m(GEO.merge([plate(ringS, 0.05, 48), ...teeth]), M.gear));
		ringG.position.z = zm - 0.09;
		const rpl = (Zp * 0.003) / 2, rarm = ((Zs + Zp) * 0.003) / 2;
		carrier.add(m(GEO.merge([latheZ([[0.03, -0.04], [rarm + 0.02, -0.04], [rarm + 0.02, -0.03], [0.03, -0.03]], 40), cyl([0, 0, -0.04], [0, 0, zo - (zm - 0.09)], 0.035, 18)]), M.crank));
		carrier.position.z = zm - 0.09;
		for (let k = 0; k < 4; k++) {
			const pl = spin();
			pl.add(m(spurGeometry({ r: rpl, width: 0.048, module: 0.003, bore: 0.012 }), M.gear));
			const a = (k * Math.PI) / 2;
			pl.position.set(rarm * Math.cos(a), rarm * Math.sin(a), 0);
			carrier.add(pl);
			planets.push(pl);
		}
		outF.add(m(GEO.merge([latheZ([[0.03, 0], [0.09, 0], [0.09, -0.02], [0.03, -0.02]], 32), ...Array.from({ length: 8 }, (_, k) => cyl([0.072 * Math.cos(k * 0.785), 0.072 * Math.sin(k * 0.785), 0.002], [0.072 * Math.cos(k * 0.785), 0.072 * Math.sin(k * 0.785), -0.03], 0.006, 8))]), M.rod));
		outF.position.z = zo;
		part({ id: 'clutch-housing', label: 'Clutch housing', assembly: o.gearAssembly, what: 'The gearbox’s cast bell bolted to the flywheel housing round the clutch, its air actuator on its side.', specs: [['Material', 'Cast aluminium']] }, [m(clutchH, M.alloy), m(cyl([0.27, 0.12, zg - 0.04], [0.27, 0.12, zg - 0.2], 0.04, 18), M.black)], { explode: [0, 0, -1.1], xray: 'shell' });
		part({ id: 'gearbox', label: 'Gearbox, 12 speeds', assembly: o.gearAssembly, what: 'An automated 12-speed gearbox: a splitter at its front halves every step, a three-speed main box multiplies them, and a planetary range at its back multiplies them again, low or high; its control unit picks the gear and its air cylinders shift it, no lever and no pedal.', specs: [['Ratios', o.gears.map((g) => g.toFixed(2)).join(' · ')], ['Oil', '13 L, 75W-80 [inferred]'], ['Mass', '~270 kg [inferred]']] }, [m(caseG, M.alloy)], { explode: [0, 0, -1.3], xray: 'shell', tag: tag('gearbox', 'Gearbox', [0.2, 0.1, (zg + zm) / 2], 'right') });
		part({ id: 'gear-sets', label: 'Shafts and gears', assembly: o.gearAssembly, what: 'Inside the case: the input shaft and the splitter’s two gears, the countershaft and its cluster below, the main shaft with the gears that ride free on it until a collar locks one, all in constant mesh.', moves: 'The shafts and gears turn (shown slowed).', drive: 'The clutch', specs: [['Splitter', '1.28 : 1'], ['Main box', '2.55 · 1.60 · 1.00']] }, [gin, glay, gmain, ...freeGears.map((f) => f.g)], { explode: [0, -0.45, -1.3] });
		part({ id: 'range', label: 'Planetary range', assembly: o.gearAssembly, what: `A sun gear on the main shaft, four planets on their carrier round it and a ring gear round them: in the low range the ring is held, and the carrier turns ${range.toFixed(2)} times slower than the sun; in the high range the ring is locked to the carrier and all of it turns as one.`, moves: 'The sun, the planets and the carrier turn; the ring is held in the low range.', drive: 'The main shaft', specs: [['Teeth', `sun ${Zs}, planets ${Zp}, ring ${Zr}`], ['Ratio', `${range.toFixed(2)} : 1 low, 1 : 1 high`]] }, [sun, ringG, carrier, outF], { explode: [0, -0.3, -1.6] });
		const shift = GEO.merge([at(box(0.22, 0.09, 0.3, 0.02), 0.04, 0.215, (zg + zm) / 2 - 0.05), at(box(0.12, 0.05, 0.08, 0.012), -0.07, 0.205, (zg + zm) / 2 + 0.12)]);
		part({ id: 'shift-unit', label: 'Shift unit and control', assembly: o.gearAssembly, what: 'On the gearbox’s top: the air cylinders and valves that move its forks, and its own control unit, which picks each gear from the speed, the load and the slope and shifts it in a fraction of a second.', specs: [['Air', '8.5 bar from the compressor [inferred]']] }, [m(shift, M.black), m(hose([[0.1, 0.26, (zg + zm) / 2], [0.2, 0.3, (zg + zm) / 2 + 0.1], [0.25, 0.12, zg - 0.1]], 0.005, 6), M.hose)], { explode: [0, 0.4, -1.2] });
	}

	return {
		group: E,
		/** points of the engine in its parent's frame */
		points: {
			out: /** @type {V3} */ ([o.at[0], o.at[1], o.at[2] + zo - 0.03]),
			airIn: /** @type {V3} */ ([o.at[0] + tx, o.at[1] + ty, o.at[2] + tzC + 0.12]),
			boostOut: /** @type {V3} */ ([o.at[0] + tx - 0.02, o.at[1] + ty + 0.17, o.at[2] + tzC]),
			intake: /** @type {V3} */ ([o.at[0] + imX, o.at[1] + imY, o.at[2] + lb + 0.035]),
			exhaust: /** @type {V3} */ ([o.at[0] + tx, o.at[1] + ty, o.at[2] + tzT - 0.125]),
			waterOut: /** @type {V3} */ ([o.at[0], o.at[1] + deck + 0.06, o.at[2] + lb + 0.05]),
			waterIn: /** @type {V3} */ ([o.at[0] + wpXY[0], o.at[1] + wpXY[1] - 0.07, o.at[2] + za - 0.02]),
			fan: /** @type {V3} */ ([o.at[0] + fanXY[0], o.at[1] + fanXY[1], o.at[2] + za + 0.1])
		},
		size: { lb, deck, hw, za },
		/**
		 * Turn it: the crank to `a` (rad, as shown), the gearbox's output to `ap`, with the clutch slipping or not, in
		 * `gear` (1 … 12); the turbo to `turboAng`, the wastegate `gate` open (0 … 1), the fire as big as `fire` (0 … 1).
		 * @param {{ a: number, ap: number, slipping?: boolean, gear: number, turboAng: number, gate: number, fire: number, running: boolean }} st
		 */
		update({ a, ap, slipping = false, gear, turboAng, gate, fire, running }) {
			crank.rotation.z = fly.rotation.z = clutchSpin.rotation.z = gCrank.rotation.z = aCrank.rotation.z = -a;
			gIdler.rotation.z = (a * rk) / ri;
			gCam.rotation.z = E.userData.cam.rotation.z = -a / 2;
			gPump.rotation.z = gComp.rotation.z = a;
			aPump.rotation.z = (-a * 0.11) / 0.06;
			aAlt.rotation.z = (-a * 0.11) / 0.035;
			aFan.rotation.z = fan.rotation.z = (-a * 0.11) / 0.09;
			aTen.rotation.z = (-a * 0.11) / 0.04;
			turbo.rotation.z = turboAng;
			gateArm.rotation.x = -0.5 * gate;
			const ain = slipping ? -a * 0.6 : -a;
			gin.rotation.z = ain;
			glay.rotation.z = (-ain * 0.045) / 0.085;
			for (const f of freeGears) f.g.rotation.z = ain * f.k;
			const low = gear <= 6;
			const wc = -ap, ws = low ? wc * range : wc;
			gmain.rotation.z = sun.rotation.z = ws;
			carrier.rotation.z = outF.rotation.z = wc;
			ringG.rotation.z = low ? 0 : wc;
			for (const pl of planets) pl.rotation.z = -((ws - wc) * Zs) / Zp;
			const deg = (a * 180) / Math.PI;
			for (let i = 0; i < n; i++) {
				const t = a + pin(i), px = r * Math.sin(t), py = r * Math.cos(t);
				const yp = py + Math.sqrt(L * L - px * px);
				pistons[i].position.y = yp;
				rods[i].position.set(px, py, zc(i));
				rods[i].rotation.z = Math.atan2(px, yp - py);
				// the fire: from the start of injection, as long as the fuel takes to burn
				const phi = cyc(deg - FIRE[i] + 4), dur = 12 + 40 * fire;
				const f = running && fire > 0.02 && phi < dur ? Math.sin((Math.PI * phi) / dur) : 0;
				flames[i].visible = f > 0.05;
				flames[i].scale.set(0.4 + 0.6 * f, 0.5 + 0.9 * f, 0.4 + 0.6 * f);
			}
			for (const tr of trains) {
				const phi = cyc(deg - FIRE[tr.i]);
				const u = SIX.lift * liftAt(phi, tr.intake ? SIX.intake : SIX.exhaust);
				tr.lifter.position.y = y0 + u;
				tr.rocker.rotation.z = u / arm1;
				tr.valves.position.y = -(u * arm2) / arm1;
			}
		},
		/** the stroke cylinder 1 is in, and how far through it (0 … 1) @param {number} a */
		strokeOf(a) {
			const phi = cyc((a * 180) / Math.PI - FIRE[0]);
			return { name: ['power', 'exhaust', 'intake', 'compression'][Math.floor(phi / 180)], k: (phi % 180) / 180, phi };
		}
	};
}
