/*
 * THE BATTERYPACK, v10 and v11 — our own modular, repairable battery (Samuel 2026-10-13; the v9 design of
 * $lib/actors/batterypack.js, kept to every measure) built the way AirSup's machine skill builds a machine: every part a
 * technician would name as real solids in measured materials, its insides there to cut open (each cell's can, its
 * jelly roll, its crimped cap with the vent, its insulator ring and its sleeve; the contact plates' spring fingers in
 * the holders' holes; the pawls, springs and cables in the hollow foot; the MOSFETs, shunt and fuse on the BMS), and a
 * solver that runs it per row on real equations. The older pack (v1 to v9: $lib/actors/batterypack.js, one rigged
 * mesh in flat colours) stays as it was; the BatteryCube and the games still build on it.
 *
 * ---------------------------------------------------------------- research (AirSup's step 1)
 * The machine: a 460 × 480 × 125 mm rack module of 280 cylindrical 21700 cells, 14 rows in series of 20 in parallel
 * (14S20P): 51.8 V nominal, 100 Ah, about 5.2 kWh. A closed aluminium shell on a 20 mm foot with a sill across its face,
 * its two front corners standing up as columns to the base plate's top (46 mm wide, 25 mm high); one L-shaped service
 * drawer (a front plate, the pack's face, and a 364 × 446 × 5 mm base plate between the columns) that carries every inner part: two holder
 * plates 22 mm pitch, the cells, copper contact plates top and bottom pressed on by a clamp (no welds), the BMS and an
 * inner plug that meets the shell's back socket; a grip low on the face with the ClickLock's trigger, two release
 * buttons in the columns with spring-bolt catches, a back socket with its holes in one line (guide, power, data, power,
 * guide) and a 10-segment LED charge strip. The cells stand caps up in the even rows and caps down in the odd ones, so
 * the plates alone put the rows in series: 7 top plates and 8 bottom plates (the two end plates are the pack's − and +).
 * The cell: a 21700 NMC energy cell, 5,000 mAh typical (4,900 min) at 0.2 C, 3.6 V nominal, charged to 4.20 V, cut off
 * at 2.5 V (2.75 recommended), standard charge 0.2–0.5 C with a 50–100 mA cut-off, 10 A max continuous (2 C), 15 A
 * short, AC impedance 12–30 mΩ at 1 kHz by make, 68–72 g, to be kept under 60 °C: the datasheets of such cells, no
 * maker named. Inferred, and said so on each card: the DC pulse resistance (25 mΩ at 25 °C and 50 % SoC, about twice
 * the AC figure), its rise in the cold (an Arrhenius law with an activation energy of 21 kJ/mol on the whole DC
 * resistance: 2.1× at 0 °C, 3× at −10 °C, 0.6× at 45 °C; published charge-transfer fits give 39 kJ/mol while the ohmic
 * part barely moves), its rise under 15 % SoC (to 2.5× at empty), the OCV against SoC (a 14-point NMC curve: 3.0 V
 * rested empty, 3.49 at 10 %, 3.70 at 50 %, 3.95 at 80 %, 4.18 full), the heat capacity 1,008 J/kg·K and the
 * conductivities 18 W/m·K along the can and 0.18 across the roll (calorimetry of cylindrical cells; +0.2 %/K).
 * The copper: ETP, 1.72e-8 Ω·m at 20 °C, +0.393 %/K; 1.5 mm plates (660 mm² across a row at 0.15 A/mm², the fingers at
 * 0.5 A/mm²); a pressed nickel-plated contact at the clamp's ~90 N a cell 0.5 mΩ [inferred: bolted busbars measure
 * 11–16 µΩ at 6–30 MPa; press contacts reach a weld's only with the pressure, roughness and area controlled; Holm's
 * a-spot at this force gives a few mΩ for one spot, many spots a fraction]. The BMS: two back-to-back banks of 8 MOSFETs
 * (0.5 mΩ together [inferred]), a 0.1 mΩ manganin shunt, a 125 A fuse (0.3 mΩ), passive balancing at 100 mA above 4.10
 * V [inferred: 14S boards sold run 40 mA], cut-offs 4.25 V over, 2.80 V under (as those boards), 60 °C over-temperature
 * [inferred, the cells' limit], 100 A continuous, 250 A for 10 s [inferred]. The heat path: a cell's I²R goes along its
 * can to the plates (its 18 W/m·K axial path and the contact: ~3 W/K a row), the plates to the drawer's base plate
 * through a 0.25 mm film, the drawer to the shell through its PTFE strips and the air films round it (~5 W/K), the
 * shell to the room by free convection and radiation (~10 W/m²·K over 0.63 m²: 6.3 W/K) [all computed from the
 * geometry]; the rows share heat through the plates they hold in common (~6.5 W/K a pair).
 * The physics: per row V = OCV(SoC) − I·R(T, SoC)/20 − I·R_contacts; the pack V = ΣV_row − I·R_bms, I from the load P
 * by V² − V_oc·V + P·R = 0; dSoC/dt = −I / (3,600·Q_row); heat q = I²R into each row's 1,480 J/K, conducted row to
 * row, to the drawer and the shell, and off to the air; the BMS opens its MOSFETs on any row under 2.80 V or over
 * 4.25 V, any row over 60 °C, or over-current. The one number: the power delivered (kW). The inputs: the load (negative
 * is charging), the room's temperature, the state of charge, one aged row, and the drawer out and the trigger. The
 * break: overloaded to 250 A, the rows sag under cut-off when low, heat past 60 °C when full, or the 10 s peak runs
 * out: the BMS opens, the power drops to 0 and the strip blinks the fault.
 * State of charge and heat are shown 60 times faster than real (an hour a minute); the electrics, the BMS and the
 * strip at real time.
 *
 * In the asset's frame (./parts.js): metres, the foot's middle at the origin, y up, the face towards +z, x across. The
 * measures below are v9's, in mm: x across, y to the front, z up.
 */
import * as THREE from 'three';
import { GEO, MAT, Flow, approach, clamp, ease, fmt, lerp, table } from '$lib/assets/kit.js';
import { assetKit } from '$lib/assets/parts.js';

/** @typedef {[number, number, number]} V3 */
/** @typedef {[number, number]} V2 */

const S = 0.001;
/** the pack's size (mm): W across, L front to back, H high; its skids under the floor lift it by `LIFT` */
export const PACK = { W: 460, L: 480, H: 125 };
const LIFT = 2.5;
/** the foot: its floor tub and the sill across the face; the two front corner columns (mm) */
const FOOT = 20;
const POST = { w: 46, top: 25 };
/** its cells: 14 rows in series (along y) of 20 in parallel (along x), 22 mm apart, standing; their zone's middle */
export const CELLS = { s: 14, p: 20, pitch: 22, r: 10.5, h: 70, z0: 33, y: -55 };
/** where the drawer's front plate begins (y), the lock's pawls and the grip's bar (z), the pawls' teeth behind the face */
const Y0 = PACK.L / 2 - 30, LOCK_Z = 10, GRIP_Z = 10, LOCK_BACK = 22;
const Wh = PACK.W / 2, Lh = PACK.L / 2, PX = Wh - POST.w, CATCH_Y = Y0 - 14;
/** how far the drawer comes out (mm) */
const DRAWER_OUT = 450;
/** a step from 0 to 1 between two moments of a loop, eased @param {number} t @param {number} a @param {number} b */
const phase = (t, a, b) => ease.io(clamp((t - a) / (b - a)));
/**
 * Its own moves (v11), loops over its controls: Service presses the two buttons (the drawer's first 4 mm), pulls the
 * whole inside out between the columns and slides it home again till the catches click; Grip closes a hand round
 * the grip, the trigger pulls both pawls in, and lets go, so they click out again.
 * @type {Record<string, import('$lib/assets/parts.js').Move>}
 */
const MOVES = {
	service: {
		label: 'Service',
		seconds: 9,
		note: 'Press both buttons, pull the drawer out, slide it home',
		at: (u) => {
			const t = u * 9;
			return { drawer: DRAWER_OUT * (phase(t, 0.6, 3.2) - phase(t, 5, 7.6)) };
		}
	},
	grip: {
		label: 'Grip',
		seconds: 3,
		note: 'Squeeze the trigger: the pawls swing in; let go: they click out',
		at: (u) => {
			const t = u * 3;
			return { trigger: 4 * (phase(t, 0.3, 0.6) - phase(t, 1.6, 1.9)) };
		}
	}
};

const SOURCES = [
	{ label: 'BatteryPack v9 (our design, $lib/actors/batterypack.js)', url: 'https://github.com/maiacity' },
	{ label: '21700 energy cells: their datasheets (no maker named)', url: 'https://lygte-info.dk/info/BatteryChargePercent%20UK.html' },
	{ label: 'Cylindrical cells’ heat capacity and conductivity (Steinhardt et al. 2021, J. Energy Storage)', url: 'https://portal.fis.tum.de/en/publications/low-effort-determination-of-heat-capacity-and-thermal-conductivit/' },
	{ label: 'Pulse resistance against temperature (Batteries 8(7) 60, 2022)', url: 'https://www.mdpi.com/2313-0105/8/7/60' },
	{ label: 'OCV against SoC of NMC cells (Chin. J. Mech. Eng. 31, 2018)', url: 'https://cjme.springeropen.com/articles/10.1186/s10033-018-0268-8' },
	{ label: 'Resistivity and its temperature coefficients (HyperPhysics)', url: 'https://hyperphysics.gsu.edu/hbase/Tables/rstiv.html' },
	{ label: 'Contact resistance of pressed copper busbars (J. Mech. Electr. Veh. 2019)', url: 'https://mev.brin.go.id/mev/article/view/97' },
	{ label: 'Press contacts for battery cells (Fraunhofer)', url: 'https://publica.fraunhofer.de/handle/publica/245414' },
	{ label: 'A 14S board’s protection figures (a listing)', url: 'https://sigmanortec.ro/en/bms-li-ion-module-14s-45a-with-balance-52v' },
	{ label: 'Machine skill kit (AirSup, MIT)', url: 'https://github.com/AirsupHQ/machine-skill' }
];
const SRC = { ours: SOURCES[0].label, cell: SOURCES[1].label, heat: SOURCES[2].label, rt: SOURCES[3].label, ocv: SOURCES[4].label, cu: SOURCES[5].label, press: SOURCES[6].label, bms: SOURCES[8].label };

const ASSEMBLIES = /** @type {import('$lib/actors/parts.js').Assembly[]} */ ([
	{ id: 'shell', label: 'Shell', note: 'The closed outer shell on its foot: floor tub, walls, top and back in one, open at the front above the foot’s sill. Its two front corners stand up as columns to the base plate’s top, each with a release button in its face and the drawer’s catch inside; the sill between them carries the grip, and the back socket sits in the back.', out: [0, 0, -0.6] },
	{ id: 'drawer', label: 'Service drawer', note: 'One L of aluminium riding on the shell’s foot: the front plate (the face above the sill and the two columns, with its finger pull and the charge strip) and the base plate behind it, running between the columns. It carries every inner part and nothing you hold: press the two buttons, pull it by its finger pull, and the whole inside comes out.', out: [0, 0, 0.4] },
	{ id: 'cells', label: 'Cells', note: '280 cylindrical 21700 cells standing in two holder plates on the drawer, 14 rows in series of 20 side by side, every other row upside down so the plates alone join them.', out: [0, 0.2, 0] },
	{ id: 'contacts', label: 'Contact plates', note: 'Copper plates top and bottom that join each row to the next, pressed on by the drawer’s clamp, not welded: the bottom plates’ spring fingers reach the poles through the holder’s holes.', out: [0, 0.3, 0] },
	{ id: 'electronics', label: 'BMS and plug', note: 'The battery management system on the drawer (its MOSFETs, shunt, fuse and a balance lead to every row), the straps that carry the current, and its inner plug that meets the shell’s back socket when the drawer is in.', out: [0, 0.2, 0.25] },
	{ id: 'lock', label: 'ClickLock', note: 'The snap-in latch that holds the pack in its cube, in the shell’s hollow foot: two spring pawls, their pivots and the cables to the grip’s trigger.', out: [0, -0.15, 0.05] }
]);
const STEPS = ['Lay out the shell on its foot: floor tub, walls, top and back, its two corner columns with their release buttons and catches, the back socket, the grip and the ClickLock', 'Build the drawer: base plate and front plate with its finger pull and charge strip', 'Set the film, the bottom contact plates and the bottom holder on the base plate, and stand the 280 cells in it', 'Press on the top holder, the top plates and the clamp', 'Fit the BMS, its leads, the straps and the inner plug; slide the drawer in between the columns until both catches click into the base plate'];

// ---------------------------------------------------------------- shapes (mm in, metres out)

/** a point of the pack (mm: x across, y to the front, z up) in the asset's frame (m) @param {number} x @param {number} y @param {number} z @returns {V3} */
const L = (x, y, z) => [x * S, (z + LIFT) * S, y * S];
/** a box centred at (x, y, z) mm, w across, l deep, h high; rounded by r mm (0: a plain box, light) */
const box = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {number} */ w, /** @type {number} */ l, /** @type {number} */ h, r = 0) =>
	(r > 0 ? GEO.rbox(w * S, h * S, l * S, Math.min(r, w / 2, h / 2, l / 2) * 0.999 * S, 2) : new THREE.BoxGeometry(w * S, h * S, l * S)).translate(...L(x, y, z));
/** a closed cylinder from a to b (mm), radius r mm @param {V3} a @param {V3} b @param {number} r @param {number} [n] */
function cyl(a, b, r, n = 16) {
	const A = new THREE.Vector3(...L(...a)), B = new THREE.Vector3(...L(...b));
	const g = new THREE.CylinderGeometry(r * S, r * S, A.distanceTo(B), n);
	g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
	return g.translate(...A.clone().add(B).multiplyScalar(0.5).toArray());
}
/** a hose, a cable or a strap through points (mm) @param {V3[]} pts @param {number} r @param {number} [radial] */
const hose = (pts, r, radial = 8) => GEO.pipe(pts.map((p) => L(...p)), r * S, { seg: Math.max(12, pts.length * 8), radial, tension: 0.5 });
/** a coil spring along x from x0 to x1 (mm) at (y, z): R its radius, wire its wire, n turns */
function coilX(/** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ y, /** @type {number} */ z, /** @type {number} */ R, /** @type {number} */ wire, /** @type {number} */ n) {
	const pts = [], seg = n * 12, len = (x1 - x0) * S;
	for (let i = 0; i <= seg; i++) {
		const t = i / seg, a = t * n * Math.PI * 2;
		pts.push(new THREE.Vector3(t * len, R * S * Math.cos(a), R * S * Math.sin(a)));
	}
	return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, wire * S, 6, false).translate(...L(x0, y, z));
}
/** one hex nut at a point (mm), its axis up @param {number} x @param {number} y @param {number} z @param {number} s @param {number} h */
const nut = (x, y, z, s, h) => new THREE.CylinderGeometry(s * S, s * S, h * S, 6).translate(...L(x, y, z + h / 2));
// in a shape, y is minus the pack's y (the extrusion stands it up), so every point goes in as (x, -y)
const at2 = (/** @type {number} */ x, /** @type {number} */ y) => /** @type {V2} */ ([x * S, -y * S]);
/** an outline (mm, the pack's x and y) drawn up from z0, h high, as one prism @param {(p: THREE.Shape) => void} draw @param {number} z0 @param {number} h @param {number} [seg] */
function prism(draw, z0, h, seg = 8) {
	const shape = new THREE.Shape();
	draw(shape);
	// three fixes a hole's winding only when the outline is anticlockwise; ours are clockwise, so a clockwise hole would
	// come out inside out (its walls facing in, its volume added): turn those round
	if (THREE.ShapeUtils.isClockWise(shape.getPoints(seg))) shape.holes = shape.holes.map((hl) => (THREE.ShapeUtils.isClockWise(hl.getPoints(seg)) ? new THREE.Path(hl.getPoints(seg).reverse()) : hl));
	const g = new THREE.ExtrudeGeometry(shape, { depth: h * S, curveSegments: seg, bevelEnabled: false });
	g.rotateX(-Math.PI / 2).translate(0, (z0 + LIFT) * S, 0);
	g.clearGroups();
	return g;
}
/** a rounded rectangle in plan, centred (x, y), w × l, corners r, as a shape or a hole */
function rrect(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ l, /** @type {number} */ r, hole = false) {
	const p = hole ? new THREE.Path() : new THREE.Shape();
	const X = w / 2, Y = l / 2;
	p.moveTo(...at2(x - X + r, y - Y));
	p.lineTo(...at2(x + X - r, y - Y));
	p.quadraticCurveTo(...at2(x + X, y - Y), ...at2(x + X, y - Y + r));
	p.lineTo(...at2(x + X, y + Y - r));
	p.quadraticCurveTo(...at2(x + X, y + Y), ...at2(x + X - r, y + Y));
	p.lineTo(...at2(x - X + r, y + Y));
	p.quadraticCurveTo(...at2(x - X, y + Y), ...at2(x - X, y + Y - r));
	p.lineTo(...at2(x - X, y - Y + r));
	p.quadraticCurveTo(...at2(x - X, y - Y), ...at2(x - X + r, y - Y));
	p.closePath();
	return p;
}
/** a round hole in plan @param {number} x @param {number} y @param {number} r */
const hole = (x, y, r) => {
	const p = new THREE.Path();
	p.absarc(x * S, -y * S, r * S, 0, Math.PI * 2, false); // anticlockwise: the opposite way to our outlines, as three wants a hole
	return p;
};
/** the shell's U (open at the front), its walls `w` thick; `w` 0: the same outline closed, a plate */
const shellU = (/** @type {number} */ w) => (/** @type {THREE.Shape} */ p) => {
	const x = Wh, yb = -Lh, r = 30;
	p.moveTo(...at2(-x, Y0));
	p.lineTo(...at2(-x, yb + r));
	p.quadraticCurveTo(...at2(-x, yb), ...at2(-x + r, yb));
	p.lineTo(...at2(x - r, yb));
	p.quadraticCurveTo(...at2(x, yb), ...at2(x, yb + r));
	p.lineTo(...at2(x, Y0));
	if (w) {
		p.lineTo(...at2(x - w, Y0));
		p.lineTo(...at2(x - w, yb + r));
		p.quadraticCurveTo(...at2(x - w, yb + w), ...at2(x - r, yb + w));
		p.lineTo(...at2(-x + r, yb + w));
		p.quadraticCurveTo(...at2(-x + w, yb + w), ...at2(-x + w, yb + r));
		p.lineTo(...at2(-x + w, Y0));
	}
	p.closePath();
};
/** the drawer's front plate (and the sill under it) in plan: from Y0 to the face, its two front corners round */
const capD = (/** @type {THREE.Shape} */ p) => {
	const x = Wh, yf = Lh, r = 30;
	p.moveTo(...at2(-x, Y0));
	p.lineTo(...at2(x, Y0));
	p.quadraticCurveTo(...at2(x, yf), ...at2(x - r, yf));
	p.lineTo(...at2(-x + r, yf));
	p.quadraticCurveTo(...at2(-x, yf), ...at2(-x, Y0));
	p.closePath();
};
/** a front corner column in plan: inside the wall behind the face, round at the corner in front of it */
const postP = (/** @type {number} */ sx) => (/** @type {THREE.Shape} */ p) => {
	const pt = (/** @type {number} */ x, /** @type {number} */ y) => at2(sx * x, y);
	p.moveTo(...pt(PX, Y0 - 30));
	p.lineTo(...pt(Wh - 4, Y0 - 30));
	p.lineTo(...pt(Wh - 4, Y0));
	p.lineTo(...pt(Wh, Y0));
	p.quadraticCurveTo(...pt(Wh, Lh), ...pt(Wh - 30, Lh));
	p.lineTo(...pt(PX, Lh));
	p.closePath();
};
const rowY = (/** @type {number} */ i) => CELLS.y + (i - (CELLS.s - 1) / 2) * CELLS.pitch;
const colX = (/** @type {number} */ j) => (j - (CELLS.p - 1) / 2) * CELLS.pitch;
const zone = { w: CELLS.p * CELLS.pitch + 6, l: CELLS.s * CELLS.pitch + 6 };
const TOP = CELLS.z0 + CELLS.h;
/** the clamp's four posts, at the holders' corners, clear of the corner cells and the plates */
const POSTS = /** @type {V2[]} */ ([-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx * 219.5, CELLS.y + sy * 153.5])));
/** the plates' width: over every cap, clear of the posts (v9 drew them 440 wide, through the posts) */
const PLATE_W = 432;
/** the series nodes: node 0 the pack's −, node 14 its +; a node's plate (which rows it joins), where it is (y, z) and its side */
const NODES = Array.from({ length: CELLS.s + 1 }, (_, k) => {
	if (k === 0) return { k, rows: [0], y: rowY(0), z: 26.25, top: false, len: CELLS.pitch - 3 };
	if (k === CELLS.s) return { k, rows: [CELLS.s - 1], y: rowY(CELLS.s - 1), z: 26.25, top: false, len: CELLS.pitch - 3 };
	const top = k % 2 === 1;
	return { k, rows: [k - 1, k], y: (rowY(k - 1) + rowY(k)) / 2, z: top ? 103.75 : 26.25, top, len: 2 * CELLS.pitch - 3 };
});

// ---------------------------------------------------------------- the materials (AirSup's measured presets)

function materials() {
	return {
		shell: MAT.anodised({ color: [0.075, 0.08, 0.088], roughness: 0.36, cap: [0.72, 0.73, 0.75], capRough: 0.3 }),
		face: MAT.anodised({ color: [0.11, 0.12, 0.13], roughness: 0.4, cap: [0.72, 0.73, 0.75], capRough: 0.3 }),
		lid: MAT.anodised({ color: [0.085, 0.09, 0.1], roughness: 0.34, cap: [0.72, 0.73, 0.75], capRough: 0.3 }),
		seam: MAT.aluminiumMachined({ color: [0.8, 0.81, 0.82], roughness: 0.3, finish: 'brushed', cap: [0.86, 0.87, 0.88], capRough: 0.3 }),
		alu: MAT.aluminium({ color: [0.72, 0.73, 0.74], roughness: 0.55, cap: [0.86, 0.87, 0.88], capRough: 0.3 }),
		plate: MAT.aluminiumMachined({ roughness: 0.3, finish: 'brushed', cap: [0.86, 0.87, 0.88], capRough: 0.3 }),
		steel: MAT.stainless({ roughness: 0.26, cap: [0.8, 0.8, 0.78], capRough: 0.3 }),
		spring: MAT.stainless({ color: [0.6, 0.6, 0.6], roughness: 0.3, finish: null, cap: [0.78, 0.78, 0.76], capRough: 0.3 }),
		dark: MAT.plastic({ color: [0.035, 0.038, 0.042], roughness: 0.62, cap: [0.1, 0.1, 0.11] }),
		grip: MAT.rubber({ color: [0.03, 0.032, 0.035], roughness: 0.75, cap: [0.09, 0.09, 0.095] }),
		black: MAT.plastic({ color: [0.012, 0.012, 0.014], roughness: 0.5, cap: [0.06, 0.06, 0.065] }),
		line: MAT.aluminium({ color: [0.85, 0.86, 0.87], roughness: 0.3, cap: [0.88, 0.89, 0.9], capRough: 0.3 }),
		hole: MAT.plastic({ color: [0.004, 0.004, 0.005], roughness: 0.9, cap: [0.03, 0.03, 0.032] }),
		holder: MAT.plastic({ color: [0.045, 0.05, 0.055], roughness: 0.58, cap: [0.12, 0.13, 0.14] }),
		sleeve: MAT.plastic({ color: [0.03, 0.12, 0.42], roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15, cap: [0.08, 0.22, 0.6] }),
		can: MAT.steel({ color: [0.62, 0.63, 0.63], roughness: 0.25, finish: null, cap: [0.7, 0.7, 0.68], capRough: 0.3 }),
		roll: MAT.satin({ color: [0.05, 0.05, 0.052], roughness: 0.7, cap: [0.14, 0.13, 0.12], capRough: 0.7 }),
		cap: MAT.steel({ color: [0.7, 0.71, 0.7], roughness: 0.24, finish: null, cap: [0.75, 0.75, 0.73] }),
		ring: MAT.plastic({ color: [0.85, 0.84, 0.78], roughness: 0.5, cap: [0.9, 0.88, 0.8] }),
		copper: MAT.copper({ color: [0.88, 0.62, 0.48], roughness: 0.3, cap: [0.95, 0.7, 0.55], capRough: 0.3 }),
		film: MAT.plastic({ color: [0.6, 0.3, 0.06], roughness: 0.2, clearcoat: 0.5, cap: [0.6, 0.3, 0.06] }),
		ptfe: MAT.plastic({ color: [0.86, 0.86, 0.84], roughness: 0.3, cap: [0.92, 0.92, 0.9] }),
		foam: MAT.satin({ color: [0.6, 0.55, 0.45], roughness: 0.95, cap: [0.65, 0.6, 0.5] }),
		pcb: MAT.paint({ color: [0.02, 0.15, 0.07], roughness: 0.4, clearcoat: 0.4, cap: [0.6, 0.55, 0.3] }),
		pad: MAT.copper({ roughness: 0.3, finish: null, cap: [0.95, 0.7, 0.55], capRough: 0.3 }),
		chip: MAT.plastic({ color: [0.02, 0.02, 0.022], roughness: 0.45, cap: [0.08, 0.08, 0.085] }),
		ceramic: MAT.ceramic({ color: [0.88, 0.87, 0.82], roughness: 0.4, cap: [0.92, 0.91, 0.87] }),
		brass: MAT.brass({ roughness: 0.3, cap: [0.9, 0.75, 0.4], capRough: 0.3 }),
		manganin: MAT.copper({ color: [0.72, 0.6, 0.5], roughness: 0.45, finish: 'brushed', cap: [0.8, 0.68, 0.56], capRough: 0.35 }),
		gold: MAT.gold({ roughness: 0.2, cap: [0.95, 0.8, 0.45], capRough: 0.3 }),
		red: MAT.plastic({ color: [0.5, 0.03, 0.02], roughness: 0.4, cap: [0.6, 0.08, 0.05] }),
		wire: MAT.plastic({ color: [0.8, 0.8, 0.78], roughness: 0.5, cap: [0.86, 0.86, 0.84] }),
		wireRed: MAT.plastic({ color: [0.55, 0.04, 0.02], roughness: 0.5, cap: [0.62, 0.08, 0.05] }),
		wireBlack: MAT.plastic({ color: [0.015, 0.015, 0.017], roughness: 0.5, cap: [0.07, 0.07, 0.075] }),
		strap: MAT.plastic({ color: [0.03, 0.03, 0.035], roughness: 0.55, cap: [0.95, 0.7, 0.55] }),
		ledOff: MAT.plastic({ color: [0.06, 0.09, 0.075], roughness: 0.3, cap: [0.12, 0.16, 0.14] })
	};
}

// ---------------------------------------------------------------- the solver

/** the cell: capacity (Ah), its voltages, its DC resistance at 25 °C and 50 % (Ω) [inferred], mass (kg), heat capacity (J/kg·K), the most it may give (A), its Arrhenius energy (J/mol) [inferred] */
const CELL = { Q: 5.0, Vmax: 4.2, Vmin: 2.5, R25: 0.025, m: 0.069, cp: 1008, Imax: 10, Ea: 21e3 };
/** the open-circuit voltage of an NMC cell by its state of charge, rested [inferred from published curves] */
const OCV = { soc: [0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1], v: [3.0, 3.25, 3.4, 3.49, 3.57, 3.62, 3.66, 3.7, 3.77, 3.86, 3.95, 4.05, 4.11, 4.18] };
const ocv = (/** @type {number} */ soc) => table(OCV.soc, OCV.v, clamp(soc));
/** a cell's DC resistance (Ω) at a temperature (°C) and a state of charge: Arrhenius in the cold, up under 15 % */
const rCell = (/** @type {number} */ T, /** @type {number} */ soc) => CELL.R25 * Math.exp((CELL.Ea / 8.314) * (1 / (T + 273.15) - 1 / 298.15)) * (1 + 1.5 * clamp((0.15 - soc) / 0.15));
/** the BMS: its cut-offs (V, °C, A), its balancing (A, above V), its own resistances (Ω) */
const BMS = { ov: 4.25, uv: 2.8, ot: 60, otChg: 45, oc: 100, ocPeak: 250, peakS: 10, chg: 50, bal: 0.1, balAt: 4.1, R: 0.5e-3 + 0.1e-3 + 0.3e-3 };
/** a pressed contact (Ω, one cell, one end) [inferred]; the straps and the plug (Ω) [computed: 2 × 0.35 m of 40 mm² copper, two 0.1 mΩ contacts] */
const LINK = { contact: 0.5e-3, series: 2 * 0.35 * 1.72e-8 / 40e-6 + 0.2e-3 };
/** the heat: a row's capacity (J/K), row to row, row to drawer, drawer to shell, shell to air (W/K), the drawer's and the shell's capacities (J/K) [computed from the geometry] */
const HEAT = { Crow: CELLS.p * CELL.m * CELL.cp + 90, Grr: 6.5, Grd: 3, Gds: 5, Gsa: 6.3, Cd: 6000, Cs: 5000 };
/** state of charge and heat shown this much faster than real */
const TIME = 60;
const NOMINAL = 51.8;

/**
 * The pack's physics, stepped in time: 14 rows, each 20 cells in parallel, their electrics, their heat and the BMS over
 * them. Everything the page shows comes from here.
 * @param {{ load: { value: number }, ambient: { value: number }, soc: { value: number }, aged: { value: number }, drawer: { value: number }, trigger: { value: number } }} ctl
 */
function solver(ctl) {
	const n = CELLS.s;
	const s = {
		used: 0, // Ah drawn since full, the same for every row (they are in series)
		bal: new Float64Array(n), // Ah bled off each row by the balancer
		soc: new Float64Array(n).fill(0.7),
		T: new Float64Array(n).fill(20),
		Vr: new Float64Array(n).fill(3.86), // each row under its load (V)
		R: new Float64Array(n), // each row (Ω): its 20 cells and their two contacts
		Td: 20, // the drawer
		Ts: 20, // the shell
		Voc: 0,
		V: 0,
		I: 0, // A, positive out of the pack
		P: 0, // W delivered (negative: taken in)
		q: 0, // W of heat in the whole pack
		closed: true, // the BMS's MOSFETs
		fault: '', // '', 'under-voltage', 'over-voltage', 'over-temperature', 'over-current'
		latched: false, // a fault that waits for the load to be taken off
		ocTimer: 0,
		balancing: 0, // rows being bled
		plugged: true,
		blink: 0,
		at: { load: ctl.load.value, soc: ctl.soc.value }
	};
	/** a row's capacity (Ah): 20 cells, the aged row's less */
	const Qrow = (/** @type {number} */ i) => CELLS.p * CELL.Q * (i === 6 ? 1 - 0.4 * (ctl.aged.value / 100) : 1);
	const rFactor = (/** @type {number} */ i) => (i === 6 ? 1 + 2 * (ctl.aged.value / 100) : 1);
	const setSoc = (/** @type {number} */ soc) => {
		s.used = (1 - soc) * CELLS.p * CELL.Q;
		s.bal.fill(0);
	};
	setSoc(ctl.soc.value / 100);
	/** @param {number} dt @param {{ broken: boolean }} env */
	function step(dt, env) {
		const Ta = ctl.ambient.value;
		// the sliders: a new state of charge sets every row; the load moved lets a latched fault go
		if (Math.abs(ctl.soc.value - s.at.soc) > 0.01) {
			setSoc(ctl.soc.value / 100);
			s.at.soc = ctl.soc.value;
		}
		if (Math.abs(ctl.load.value - s.at.load) > 1e-6) {
			s.at.load = ctl.load.value;
			if (s.latched && !env.broken) s.latched = false;
		}
		s.plugged = ctl.drawer.value < 10;
		for (let i = 0; i < n; i++) s.soc[i] = clamp(1 - (s.used + s.bal[i]) / Qrow(i));
		// each row's open-circuit voltage and resistance now
		let Voc = 0, Rsum = BMS.R + LINK.series;
		for (let i = 0; i < n; i++) {
			s.R[i] = (rCell(s.T[i], s.soc[i]) * rFactor(i) + 2 * LINK.contact) / CELLS.p;
			Voc += ocv(s.soc[i]);
			Rsum += s.R[i];
		}
		s.Voc = Voc;
		// the load: the power asked (the break asks for 250 A), the current it takes at the sagged voltage
		let P = env.broken ? BMS.ocPeak * (Voc - BMS.ocPeak * Rsum) : ctl.load.value * 1000;
		let I = 0;
		if (s.closed && s.plugged) {
			if (P >= 0) {
				const disc = Voc * Voc - 4 * P * Rsum;
				I = disc > 0 ? (Voc - Math.sqrt(disc)) / (2 * Rsum) : Voc / (2 * Rsum);
			} else {
				// charging: a CC-CV charger, held to the BMS's charge current, tapered so no row passes 4.20 V, off when full
				const Vc = (Voc + Math.sqrt(Voc * Voc - 4 * P * Rsum)) / 2;
				I = Math.max(P / Vc, -BMS.chg);
				let cv = Infinity;
				for (let i = 0; i < n; i++) cv = Math.min(cv, Math.max(0, CELL.Vmax - ocv(s.soc[i])) / s.R[i]);
				I = Math.max(I, -cv);
				if (s.soc.every((x) => x >= 0.999)) I = 0;
			}
		}
		s.I = I;
		let Vmin = 9, Vmax = 0, Tmax = -99, V = 0;
		for (let i = 0; i < n; i++) {
			s.Vr[i] = ocv(s.soc[i]) - I * s.R[i];
			V += s.Vr[i];
			Vmin = Math.min(Vmin, s.Vr[i]);
			Vmax = Math.max(Vmax, s.Vr[i]);
			Tmax = Math.max(Tmax, s.T[i]);
		}
		s.V = V - I * (BMS.R + LINK.series);
		s.P = s.V * I;
		// the BMS: over-current at once past the peak, after 10 s past the continuous rating; the rest by the rows
		if (Math.abs(I) > BMS.oc) s.ocTimer += dt;
		else s.ocTimer = Math.max(0, s.ocTimer - dt);
		let fault = '';
		if (Math.abs(I) > BMS.ocPeak * 0.999 || s.ocTimer > BMS.peakS) fault = 'over-current';
		else if (Vmin < BMS.uv && I > 0) fault = 'under-voltage';
		else if (Vmax > BMS.ov && I < 0) fault = 'over-voltage';
		else if (Tmax > BMS.ot || (I < 0 && Tmax > BMS.otChg)) fault = 'over-temperature';
		if (fault && s.closed) {
			s.closed = false;
			s.fault = fault;
			s.latched = fault === 'under-voltage' || fault === 'over-current';
			s.ocTimer = 0;
		} else if (!s.closed) {
			// it closes again on its own when the trouble is gone: the cells cooled, the voltage back, the load taken off
			const cool = Tmax < BMS.ot - 10, ok = Vmin > BMS.uv + 0.2 && Vmax < BMS.ov - 0.1;
			if (cool && ok && !s.latched && !env.broken) {
				s.closed = true;
				s.fault = '';
			}
		}
		// the charge drawn (shown 60× faster), the balancer bleeding the high rows while charging or at rest
		const h = (dt * TIME) / 3600;
		s.used += I * h;
		s.balancing = 0;
		if (I <= 0) for (let i = 0; i < n; i++) if (s.Vr[i] > BMS.balAt && s.Vr[i] - Vmin > 0.01) {
			s.bal[i] += BMS.bal * h;
			s.balancing++;
		}
		// the heat: each row's I²R into its cells, shared with its neighbours through the plates, down into the drawer,
		// out through the shell into the room (shown 60× faster)
		const dts = dt * TIME;
		let q = I * I * (BMS.R + LINK.series), qd = q;
		const T = s.T, dT = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			const qi = I * I * s.R[i];
			q += qi;
			let flow = qi - HEAT.Grd * (T[i] - s.Td);
			if (i > 0) flow -= HEAT.Grr * (T[i] - T[i - 1]);
			if (i < n - 1) flow -= HEAT.Grr * (T[i] - T[i + 1]);
			dT[i] = flow / HEAT.Crow;
			qd += HEAT.Grd * (T[i] - s.Td);
		}
		for (let i = 0; i < n; i++) T[i] += dT[i] * dts;
		s.q = q;
		s.Td += ((qd - HEAT.Gds * (s.Td - s.Ts) - 0.5 * (s.Td - Ta)) / HEAT.Cd) * dts;
		s.Ts += ((HEAT.Gds * (s.Td - s.Ts) - HEAT.Gsa * (s.Ts - Ta)) / HEAT.Cs) * dts;
		s.blink = (s.blink + dt) % 1;
		return { Vmin, Vmax, Tmax };
	}
	/** the break taken back: the fault cleared, the pack closed again on the load it had */
	function reset() {
		s.latched = false;
		s.ocTimer = 0;
	}
	/** the pack's charge left (Ah): what its weakest row still holds, and the energy (Wh) */
	const left = () => {
		let ah = Infinity;
		for (let i = 0; i < n; i++) ah = Math.min(ah, s.soc[i] * Qrow(i));
		return { ah, wh: ah * NOMINAL };
	};
	const socPack = () => s.soc.reduce((a, b) => a + b, 0) / n;
	const hottest = () => { let k = 0; for (let i = 1; i < n; i++) if (s.T[i] > s.T[k]) k = i; return k; };
	return { s, step, reset, left, socPack, hottest, Qrow };
}

// ---------------------------------------------------------------- the pack

/**
 * The BatteryPack: a root at its real size, every part its own, its solver running it per row. v11 (the default) adds
 * its own moves, Service and Grip; v10 is the same pack without them.
 * @param {{ load?: number, ambient?: number, soc?: number, v?: 10 | 11 }} [o] the load (kW, negative charging), the room (°C), the state of charge (%), the version
 * @returns {THREE.Group}
 */
export function batteryPack({ load = 2, ambient = 20, soc = 70, v = 11 } = {}) {
	const root = new THREE.Group();
	root.name = 'BatteryPack';
	const M = materials();
	const kit = assetKit(root, { assemblies: ASSEMBLIES, steps: STEPS, sources: SOURCES });
	const m = (/** @type {THREE.BufferGeometry} */ geo, /** @type {THREE.Material} */ mat) => kit.mesh(geo, mat);
	/** a part: its meshes, its card and how it is shown */
	const part = (/** @type {any} */ info, /** @type {THREE.Object3D[]} */ objs, /** @type {import('$lib/assets/parts.js').How} */ how = {}, parent = /** @type {THREE.Object3D} */ (root)) => {
		const grp = new THREE.Group();
		grp.add(...objs);
		return kit.part(grp, info, how, parent);
	};
	/** a group of meshes turning or sliding about a point (mm): its origin there, the meshes drawn where they are */
	const pivot = (/** @type {V3} */ p, /** @type {THREE.Object3D[]} */ objs) => {
		const g = new THREE.Group();
		g.position.set(...L(...p));
		for (const o of objs) {
			o.position.copy(g.position).negate();
			g.add(o);
		}
		return g;
	};
	/** the mass of some solids (kg) at a density (kg/m³) @param {THREE.BufferGeometry[]} geos @param {number} rho */
	const kg = (geos, rho) => geos.reduce((a, g) => a + GEO.volume(g).V * rho, 0);
	let mass = CELLS.s * CELLS.p * CELL.m + 0.35; // the cells and the BMS
	/** the service drawer: everything on it slides out as one */
	const drawer = new THREE.Group();
	drawer.name = 'drawer';
	root.add(drawer);
	/** @type {Record<string, THREE.Object3D>} */
	const moving = {};

	/* ------------------------------------------------------------ the shell */
	{
		// the foot is hollow: a floor sheet, a top skin the drawer's strips ride on, the band round them; the sill across
		// the face the same, its sheets top and bottom and a wall round; the lock's pawls, springs and cables live inside
		const sillWall = (/** @type {THREE.Shape} */ p) => {
			capD(p);
			p.holes.push(/** @type {THREE.Path} */ (rrect(0, (Y0 + Lh) / 2, PACK.W - 8, Lh - Y0 - 6, 20, true)));
		};
		const faceG = GEO.merge([prism(shellU(4), 0, FOOT), prism(capD, 0, 3), prism(capD, FOOT - 3, 3), prism(sillWall, 3, FOOT - 6), prism(postP(-1), FOOT - 1, POST.top - FOOT + 1), prism(postP(1), FOOT - 1, POST.top - FOOT + 1)]);
		const caseG = GEO.merge([prism(shellU(4), FOOT, 110 - FOOT), prism(shellU(0), 0, 3), prism(shellU(0), 15, 3)]);
		const seamG = prism(shellU(4), 110, 2);
		const lidG = GEO.merge([prism(shellU(4), 112, 13), prism(shellU(0), PACK.H - 4, 4)]);
		const skids = GEO.merge([-1, 1].map((sx) => box(sx * 170, -15, -1, 20, 370, 3, 1)));
		mass += kg([faceG, caseG, seamG, lidG], 2700);
		part({ id: 'shell', label: 'Shell', assembly: 'shell', source: SRC.ours, what: 'The pack’s outer shell: a foot (its floor tub and, across the face, a sill, both hollow boxes 20 mm high), walls, top and back in one smooth aluminium piece, open at the front above the sill where the service drawer slides in. Its two front corners stand up as columns to the base plate’s top, each with a release button in its face and the drawer’s catch inside. It is what you carry and what the cube holds: the grip, the ClickLock and the two release buttons are all on it.', specs: [['Outside', '460 × 480 × 125 mm'], ['Foot and sill', `${FOOT} mm high, hollow`], ['Columns', `${POST.w} mm wide, to ${POST.top} mm`], ['Material', 'Aluminium, 3 mm, black anodised'], ['Corners', 'R 30 mm'], ['Skids', '2 strips under the floor, 3 mm']] },
			[m(faceG, M.face), m(caseG, M.shell), m(seamG, M.seam), m(lidG, M.lid), m(skids, M.grip)], { explode: [0, 0, -0.42], xray: 'shell', tag: { text: 'Shell', at: L(-200, -120, PACK.H), value: () => `${fmt(sim.s.Ts)} °C`, side: 'left' } });

		// the back socket: a plate 2 mm proud, its holes in one line, the contacts deep in their pockets; inside the wall its
		// body, where the drawer's inner plug meets the same contacts
		const yb = -Lh - 2;
		const sock = [m(box(0, -Lh - 1, 58, 170, 2, 46, 1), M.black), m(box(0, -Lh + 2.5, 58, 170, 5, 46, 1), M.black)];
		/** a hole: its lining ring a little wider, its dark inside over it @param {number} x @param {number} z @param {number} r @param {THREE.Material} ring */
		const holeAt = (x, z, r, ring) => sock.push(m(cyl([x, yb, z], [x, yb - 0.4, z], r + 2, 16), ring), m(cyl([x, yb - 0.4, z], [x, yb - 0.6, z], r, 16), M.hole));
		for (const x of [-45, 45]) {
			holeAt(x, 58, 9.5, M.face);
			sock.push(m(cyl([x, yb - 0.6, 58], [x, -Lh + 7, 58], 4.5, 16), M.brass)); // the contact tube, through the wall to the body
		}
		sock.push(m(box(0, yb - 0.2, 58, 50, 0.4, 16, 2), M.face), m(box(0, yb - 0.5, 58, 45, 0.4, 13, 2), M.hole));
		for (let k = 0; k < 4; k++) sock.push(m(cyl([-12 + k * 8, yb - 0.7, 58], [-12 + k * 8, -Lh + 7, 58], 1.6, 8), M.gold));
		for (const sx of [-1, 1]) {
			sock.push(m(cyl([sx * 150, -Lh, 58], [sx * 150, -Lh - 1.5, 58], 11, 16), M.black));
			holeAt(sx * 150, 58, 5.5, M.steel);
		}
		part({ id: 'socket', label: 'Back socket', assembly: 'shell', source: SRC.ours, what: 'The pack’s plus, minus and data in one socket flush in its back, nothing sticking out, its holes in one line: guide, power, data, power, guide. The power contacts sit at the bottom of pockets that take the cube’s insulating collars, so no metal is ever open to a finger; the two lined guide holes take the cube’s guide pins first. Inside the wall the same contact tubes take the drawer’s inner plug: slide the pack in and it plugs itself into the backplane; pull the drawer and it lets go.', specs: [['Power', '2 pockets ⌀ 19 mm, tubes for ⌀ 8 mm pins, 120 A [inferred]'], ['Data', 'CAN, 4 sockets in one pocket'], ['Guides', '2 lined holes, ⌀ 11 mm, for ⌀ 10 mm pins'], ['Contact', '~0.1 mΩ each [inferred]'], ['Touch', 'Finger-safe, IP2X']] }, sock, { explode: [0, 0, -0.595], tag: { text: 'Back socket', at: L(0, -Lh - 2, 58), value: () => (sim.s.plugged ? `${fmt(sim.s.V, 1)} V · ${fmt(sim.s.I)} A` : 'unplugged'), side: 'right' } });

		// the grip: one hand, in the middle of the sill, its trigger under its bar
		part({ id: 'grip', label: 'Grip', assembly: 'shell', source: SRC.ours, what: 'One grip for one hand on the shell itself, in the middle of the sill across its foot: carry the pack by it and the shell takes the weight, never the drawer. Its trigger sits at the very height of the ClickLock’s pawls in the foot, so the two release cables run straight to them: close your fingers round it and the pawls pull back, so the pack slides out in the same move; let go and it clicks home again.', specs: [['Width', '150 mm, for a gloved hand'], ['Height', `Bar ${GRIP_Z} mm over the foot, trigger at ${LOCK_Z} mm: the lock’s height`], ['On', 'The shell’s sill'], ['Release', 'Trigger in the grip, ~20 N'], ['Carries', '~26 kg [inferred, as v9 said; see the card of the shell for the weight of the geometry]']] },
			[m(GEO.merge([box(-82, Lh + 14, GRIP_Z, 16, 28, 15, 5), box(82, Lh + 14, GRIP_Z, 16, 28, 15, 5), box(0, Lh + 30, GRIP_Z, 180, 16, 15, 6)]), M.grip), m(box(0, Lh + 38.5, GRIP_Z + 3, 120, 1, 2, 0.4), M.line)], { explode: [0, -0.035, 0.21] });

		// the release buttons in the columns' faces and the spring-bolt catches across inside them
		for (const [sx, side] of /** @type {const} */ ([[-1, 'left'], [1, 'right']])) {
			const bx = sx * (PX + 8), bz = 18, cz = 22.5;
			const btn = pivot([bx, Lh, bz], [m(cyl([bx, Lh + 0.2, bz], [bx, Lh + 1, bz], 7, 18), M.steel), m(cyl([bx, Lh - 4, bz], [bx, Lh + 2.4, bz], 5, 18), M.dark), m(cyl([bx, Lh - 6, bz], [bx, CATCH_Y + 6, bz], 1.8, 8), M.steel), m(box(bx, CATCH_Y + 4, (bz + cz) / 2, 6, 6, cz - bz + 6, 0.5), M.steel)]);
			part({ id: `release-${side}`, label: `Release button, ${side}`, assembly: 'shell', source: SRC.ours, what: 'A round push button in the face of the shell’s corner column on its side, at the base plate’s level: part of the shell, so it stays put while the drawer comes out. Behind it a short plunger with a wedge runs back inside the column and pushes the catch’s bolt out of its notch in the base plate. Press both, pull the drawer by its finger pull, and the whole inside slides out between the columns.', moves: 'In by 4 mm when pressed.', drive: 'A thumb', specs: [['Button', '⌀ 14 mm, 4 mm travel'], ['On', 'The shell’s corner column'], ['Force', '~10 N each [inferred]']] }, [btn], { explode: [0, 0, 0.14] });
			moving[`release-${side}`] = btn;
			const bolt = pivot([sx * PX, CATCH_Y, cz], [m(cyl([sx * (PX - 4.5), CATCH_Y, cz], [sx * (Wh - 8), CATCH_Y, cz], 2.5, 12), M.steel), m(cyl([sx * (PX + 9), CATCH_Y, cz], [sx * (PX + 11), CATCH_Y, cz], 3.5, 12), M.steel), m(coilX(sx < 0 ? -(PX + 29) : PX + 12, sx < 0 ? -(PX + 12) : PX + 29, CATCH_Y, cz, 3.2, 0.5, 6), M.spring)]);
			part({ id: `catch-${side}`, label: `Drawer catch, ${side}`, assembly: 'shell', source: SRC.ours, what: 'A spring bolt lying across inside the shell’s corner column, at the base plate’s height: its spring pushes its tip into a notch in the base plate’s edge and holds the drawer in. The button’s wedge pushes it back out; slide the drawer home and the bolt clicks in again on its own.', moves: 'Sideways, 5 mm, out of its notch.', drive: 'Its spring; the button’s wedge against it', specs: [['Bolt', 'Stainless, ⌀ 5 mm, 5 mm travel'], ['Spring', 'Compression, ~12 N [inferred]'], ['In', 'The shell’s corner column']] }, [bolt], { explode: [sx * 0.105, 0.042, 0] });
			moving[`catch-${side}`] = bolt;
		}
	}

	/* ------------------------------------------------------------ the ClickLock, in the foot */
	{
		const y = Lh - LOCK_BACK, z = LOCK_Z; // the pawls' teeth
		const pawls = [-1, 1].map((sx) => pivot([sx * 223, y - 38, z], [m(GEO.merge([box(sx * 223, y - 18, z, 5, 44, 8, 1), box(sx * 232, y, z, 8, 10, 8, 1)]), M.steel)]));
		part({ id: 'lock-pawls', label: 'Pawls', assembly: 'lock', count: 2, source: SRC.ours, what: 'Two steel levers, one inside each side of the hollow foot. Each pivots at its back end; its tooth at the front pokes out through a slot in the wall. Sliding in, the tooth rides up the rail’s ramp, is pushed in, and snaps out again behind the keeper: that is the click.', moves: 'Swing in 4 mm at the tooth when the trigger is pulled.', drive: 'The release cables; the springs push them out again', specs: [['Material', 'Stainless steel, 5 mm, hardened tooth'], ['Travel', '4 mm'], ['Hold', '~300 N each [inferred]']] }, pawls, { explode: [0, -0.084, 0] });
		moving['pawl-left'] = pawls[0];
		moving['pawl-right'] = pawls[1];
		const springs = [];
		for (const sx of [-1, 1]) springs.push(m(coilX(sx < 0 ? -220.5 : 206, sx < 0 ? -206 : 220.5, y - 4, z, 3, 0.5, 6), M.spring), m(box(sx * 204, y - 4, z, 4, 10, 10, 0.5), M.steel));
		part({ id: 'lock-springs', label: 'Pawl springs', assembly: 'lock', count: 2, source: SRC.ours, what: 'A small coil spring behind each pawl, against a boss on the floor, presses its tooth outward, so it always drops into the keeper on its own: you never have to lock it, only to unlock it.', specs: [['Type', 'Compression, stainless, ⌀ 6 mm'], ['Force', '~15 N each [inferred]']] }, springs, { explode: [0, -0.112, 0] });
		part({ id: 'lock-pivots', label: 'Pivot pins', assembly: 'lock', count: 2, source: SRC.ours, what: 'A pin through each pawl’s back end, standing between the foot’s two sheets: the pawl swings round it, in and out.', specs: [['Pin', '⌀ 5 mm, stainless']] }, [-1, 1].map((sx) => m(cyl([sx * 223, y - 38, 1], [sx * 223, y - 38, 19], 2.5, 10), M.steel)), { explode: [0, -0.14, 0] });
		const cables = [];
		for (const sx of [-1, 1]) cables.push(m(hose([[sx * 60, Lh + 22, z], [sx * 60, Lh - 10, z], [sx * 206, Lh - 10, z], [sx * 222, y - 6, z]], 1.6), M.dark));
		part({ id: 'lock-cables', label: 'Release cables', assembly: 'lock', count: 2, source: SRC.ours, what: 'Two short steel cables in sleeves, both at the pawls’ own height: from the trigger in through the face, along the inside of the hollow sill to the corner and straight back along the side of the foot to the pawl, no bend up or down. Pulling the trigger pulls both cables, and both pawls swing in together, out of their keepers.', specs: [['Cable', '⌀ 1.5 mm steel in a PTFE sleeve'], ['Pull', '4 mm']] }, cables, { explode: [0, -0.07, 0.07] });
		const trig = pivot([0, Lh + 22, z], [m(box(0, Lh + 22, z, 130, 8, 8, 3), M.dark), m(box(0, Lh + 26.5, z, 90, 0.6, 2, 0.3), M.line)]);
		part({ id: 'lock-trigger', label: 'Trigger', assembly: 'lock', source: SRC.ours, what: 'The bar under the grip: your fingers close round the grip and press it up, it pulls both cables, and the pawls let go. Let go and the springs push it back.', moves: 'Up 4 mm when squeezed.', drive: 'Your fingers', specs: [['Force', '~20 N'], ['Travel', '4 mm']] }, [trig], { explode: [0, -0.042, 0.14] });
		moving.trigger = trig;
	}

	/* ------------------------------------------------------------ the drawer: its front plate, base plate and charge strip */
	{
		const Z = POST.top;
		// a hollow moulding: 3 mm skins, closed top and bottom, the piece between the columns solid
		const frontWall = (/** @type {THREE.Shape} */ p) => {
			capD(p);
			p.holes.push(/** @type {THREE.Path} */ (rrect(0, (Y0 + Lh) / 2, PACK.W - 6, Lh - Y0 - 6, 10, true)));
		};
		const frontSkin = GEO.merge([prism(capD, Z, 3), prism(frontWall, Z + 3, 110 - Z - 6), prism(capD, 107, 3)]), frontMid = box(0, (Y0 + Lh) / 2, (FOOT + Z) / 2, 2 * PX - 1, Lh - Y0, Z - FOOT);
		const frontG = GEO.merge([frontSkin, frontMid]);
		const faceG = box(0, Lh + 1, 66, 380, 3, 68, 1);
		mass += kg([frontSkin, frontMid, faceG], 2700);
		part({ id: 'front', label: 'Front plate', assembly: 'drawer', source: SRC.ours, what: 'The upright of the service drawer’s L: the pack’s face above the sill and the two columns, its round front corners and bands flush with the shell. A long finger pull along its foot and the charge strip along its top; nothing you carry by. The base plate is fixed to its foot.', specs: [['Size', `460 × 30 × ${PACK.H - FOOT} mm`], ['Pull', 'Finger slot, 240 mm'], ['Walls', '3 mm, a hollow moulding [inferred]'], ['Material', 'Aluminium, black anodised']] },
			[m(frontG, M.shell), m(prism(capD, 110, 2), M.seam), m(prism(capD, 112, 13), M.lid), m(faceG, M.face), m(box(0, Lh + 1.2, FOOT + 7, 240, 3, 8, 3), M.black), m(box(0, Lh + 1.6, FOOT + 5.5, 228, 2.4, 4), M.hole)], { explode: [0, 0, 0.28], xray: 'shell' }, drawer);
		const bw = 2 * (PX - 2);
		const baseG = box(0, (Y0 - Lh + 4) / 2, 22.5, bw, Y0 + Lh - 4, 5, 1);
		mass += kg([baseG], 2700);
		part({ id: 'base', label: 'Base plate', assembly: 'drawer', source: SRC.ours, what: 'The floor of the service drawer’s L, riding on the shell’s foot between its two columns: every inner part is mounted on it, the film and the bottom plates, the cells’ holders, the clamp and the BMS. It runs on two low-friction strips on the foot’s top skin and slides out over the sill; the catches’ bolts click into the two notches in its edges.', specs: [['Size', `${bw} × ${Y0 + Lh - 4} × 5 mm, between the columns`], ['Material', 'Aluminium, 5 mm'], ['Runs on', '2 PTFE strips, 2 mm'], ['Notches', '2, for the catches’ bolts']] },
			[m(baseG, M.plate), m(GEO.merge([-1, 1].map((sx) => box(sx * (bw / 2 - 40), (Y0 - Lh + 4) / 2, FOOT - 1, 14, Y0 + Lh - 10, 2, 0.3))), M.ptfe), m(GEO.merge([-1, 1].map((sx) => box(sx * (bw / 2 - 2.5), CATCH_Y, 22.5, 5.4, 9, 5.2))), M.hole)], { explode: [0, 0, 0] }, drawer);
		/** @type {THREE.MeshPhysicalMaterial[]} */
		const leds = [];
		const segs = [];
		for (let k = 0; k < 10; k++) {
			const mat = /** @type {THREE.MeshPhysicalMaterial} */ (MAT.plastic({ color: [0.06, 0.09, 0.075], emissive: [0.12, 0.95, 0.4], emissiveIntensity: 0, roughness: 0.3, finish: null }));
			leds.push(mat);
			segs.push(m(box(-171 + k * 38, Lh + 1.5, 104, 34, 1.5, 4), mat));
		}
		part({ id: 'charge', label: 'Charge strip', assembly: 'drawer', source: SRC.ours, what: 'A slim LED strip along the top of the face, under the lid’s seam: ten segments light up with the pack’s state of charge, one a tenth; the next one breathes while it charges, and when the BMS has opened the pack the lit ones blink red.', specs: [['Length', '380 mm, 10 segments'], ['Shows', 'State of charge, 10 % a segment; a fault in red'], ['Fed by', 'The BMS, by a ribbon up the face']] },
			[m(box(0, Lh + 0.5, 104, 386, 2, 7, 1), M.black), ...segs], { explode: [0, 0.035, 0.35], tag: { text: 'Charge strip', at: L(0, Lh + 2, 104), value: () => `${fmt(sim.socPack() * 100)} %${sim.s.fault ? ' · ' + sim.s.fault : ''}`, side: 'right' } }, drawer);
		moving.leds = /** @type {any} */ (leds);
		// the clamp: a stiff plate on four posts, its foam pad pressing every top plate onto the poles
		const clampG = box(0, CELLS.y, 111, 446, 314, 4, 2);
		const posts = GEO.merge(POSTS.flatMap(([x, y]) => [cyl([x, y, POST.top], [x, y, 113], 3, 12), nut(x, y, 113, 5, 4)]));
		mass += kg([clampG], 2700) + kg([posts], 7900);
		part({ id: 'clamp', label: 'Clamp', assembly: 'drawer', source: SRC.ours, what: 'A stiff plate on four posts over the cells, its foam pad pressing every top contact plate onto its poles with about 90 N a cell: the only joining force in the pack, so every cell comes out again. On the drawer, so the cells stay pressed when it comes out.', specs: [['Plate', 'Aluminium, 4 mm'], ['Pad', 'Silicone foam, 4.5 mm, ~0.2 MPa [inferred]'], ['Force', `${fmt((0.2e6 * 0.432 * 0.3) / 1000)} kN over 280 cells: ~${fmt((0.2e6 * 0.432 * 0.3) / 280)} N each [computed]`], ['Posts', '4 × M6, from the base plate']] },
			[m(clampG, M.plate), m(box(0, CELLS.y, 106.75, 432, 300, 4.5, 1), M.foam), m(posts, M.steel)], { explode: [0, 0.294, 0], xray: 'shell' }, drawer);
	}

	/* ------------------------------------------------------------ the cells and their holders */
	{
		// one holder plate: a flat sheet of flame-retardant plastic with a hole for every cell and the four posts
		const holder = (/** @type {number} */ z0, /** @type {number} */ h, /** @type {number} */ r) => {
			const shape = new THREE.Shape();
			const X = zone.w / 2, Y0h = CELLS.y - zone.l / 2, Y1h = CELLS.y + zone.l / 2;
			shape.moveTo(...at2(-X, Y0h));
			shape.lineTo(...at2(X, Y0h));
			shape.lineTo(...at2(X, Y1h));
			shape.lineTo(...at2(-X, Y1h));
			shape.closePath();
			for (let i = 0; i < CELLS.s; i++) for (let j = 0; j < CELLS.p; j++) shape.holes.push(hole(colX(j), rowY(i), r));
			for (const [x, y] of POSTS) shape.holes.push(hole(x, y, 3.3));
			const g = new THREE.ExtrudeGeometry(shape, { depth: h * S, curveSegments: 3, bevelEnabled: false });
			g.rotateX(-Math.PI / 2).translate(0, (z0 + LIFT) * S, 0);
			g.clearGroups();
			return g;
		};
		const hb = GEO.merge([holder(27, 6, 5), holder(33, 6, 10.7)]);
		const ht = holder(TOP - 9, 6, 10.7);
		mass += kg([hb, ht], 1200);
		part({ id: 'holder-bottom', label: 'Bottom cell holder', assembly: 'cells', source: SRC.ours, what: 'A plate of flame-retardant plastic on the bottom contact plates with a socket for every cell’s foot: a floor with a hole under each cell for the plate’s spring finger, and a honeycomb of collars 6 mm high that keeps the cells 22 mm apart, air between them.', specs: [['Material', 'PC/ABS, UL94 V-0 [inferred]'], ['Pitch', '22 mm'], ['Floor and collars', '6 + 6 mm'], ['Holes', `${CELLS.s * CELLS.p} + 4`]] }, [m(hb, M.holder)], { explode: [0, 0.098, 0] }, drawer);
		part({ id: 'holder-top', label: 'Top cell holder', assembly: 'cells', source: SRC.ours, what: 'The same plate round the cells’ heads, its holes leaving each pole bare for the top contact plates.', specs: [['Material', 'PC/ABS, UL94 V-0 [inferred]'], ['Thickness', '6 mm'], ['Holes', `${CELLS.s * CELLS.p} + 4`]] }, [m(ht, M.holder)], { explode: [0, 0.21, 0] }, drawer);

		// the cells: a row of 20 merged into one part, its can, jelly roll, crimped cap with its vent, insulator ring and
		// sleeve each their own solid; the odd rows stand on their heads
		const cz = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z0, /** @type {number} */ z1, /** @type {number} */ r, /** @type {number} */ n) => cyl([x, y, z0], [x, y, z1], r, n);
		for (let i = 0; i < CELLS.s; i++) {
			const y = rowY(i), flip = i % 2 === 1;
			const zz = (/** @type {number} */ z) => (flip ? CELLS.z0 + TOP - z : z);
			const sleeve = [], can = [], roll = [], cap = [], ring = [], vent = [];
			for (let j = 0; j < CELLS.p; j++) {
				const x = colX(j);
				sleeve.push(cz(x, y, zz(CELLS.z0 + 0.2), zz(TOP - 1.5), CELLS.r, 14));
				can.push(cz(x, y, zz(CELLS.z0), zz(TOP - 1.7), CELLS.r - 0.2, 12));
				roll.push(cz(x, y, zz(CELLS.z0 + 0.6), zz(TOP - 2.4), CELLS.r - 0.6, 12));
				ring.push(cz(x, y, zz(TOP - 1.7), zz(TOP - 1.2), CELLS.r - 0.2, 12));
				cap.push(cz(x, y, zz(TOP - 1.5), zz(TOP), 6.5, 12));
				for (let k = 0; k < 3; k++) {
					const a = (k / 3) * Math.PI * 2;
					vent.push(new THREE.BoxGeometry(2.6 * S, 0.3 * S, 0.9 * S).rotateY(a).translate(...L(x + 4 * Math.cos(a), y + 4 * Math.sin(a), zz(TOP) + (flip ? -0.1 : 0.1))));
				}
			}
			const k = i + 1;
			part({ id: `row-${k}`, label: `Row ${k}`, assembly: 'cells', count: CELLS.p, source: SRC.cell, what: `Twenty 21700 cells side by side in parallel, ${flip ? 'standing on their heads: their caps on the bottom plate, their cans’ bottoms up under the top plate' : 'standing caps up: their cans’ bottoms on the bottom plate, their caps under the top plate'}. Each is a nickel-plated steel can with the wound electrodes (the jelly roll) inside, a crimped positive cap with its vent over a gasket and an insulator ring, in a blue PVC sleeve; held, not welded: a worn cell is pulled and a new one pushed in.`, specs: [['Cell', '21700 NMC: 5,000 mAh, 3.6 V nominal, 4.20–2.5 V, 10 A max, 69 g'], ['Resistance', '25 mΩ DC at 25 °C and 50 % [inferred: about twice the 1 kHz figure]'], ['Row', `20 in parallel: ${fmt(CELLS.p * CELL.Q)} Ah, 1.25 mΩ + 0.05 mΩ of contacts at 25 °C`], ['Heat capacity', `${fmt(HEAT.Crow)} J/K (1,008 J/kg·K a cell)`], ['Limits', `${BMS.uv} V under, ${BMS.ov} V over, ${BMS.ot} °C`]] },
				[m(GEO.merge(sleeve), M.sleeve), m(GEO.merge(can), M.can), m(GEO.merge(roll), M.roll), m(GEO.merge(ring), M.ring), m(GEO.merge(cap), M.cap), m(GEO.merge(vent), M.hole)],
				{ explode: [0, 0.14, 0], delay: 0.1 + (i / CELLS.s) * 0.15, ...(i % 2 === 0 ? { tag: { text: `Rows ${k}–${k + 1}`, at: L((i < 7 ? -1 : 1) * (colX(CELLS.p - 1) + CELLS.r), (y + rowY(i + 1)) / 2, (CELLS.z0 + TOP) / 2), value: () => `${fmt(sim.s.Vr[i], 2)} · ${fmt(sim.s.Vr[i + 1], 2)} V · ${fmt(sim.s.T[i])} · ${fmt(sim.s.T[i + 1])} °C`, side: i < 7 ? 'left' : 'right' } } : {}) }, drawer);
		}
	}

	/* ------------------------------------------------------------ the contact plates */
	{
		part({ id: 'insulation', label: 'Insulation film', assembly: 'contacts', source: SRC.ours, what: 'A polyimide film between the bottom contact plates and the aluminium base plate: the plates are live, the drawer is not. Thin, so the cells’ heat still goes down through it into the drawer.', specs: [['Material', 'Polyimide, 0.5 mm'], ['Heat', '~8 W/K a row through it [computed]']] }, [m(box(0, CELLS.y, 25.25, PLATE_W, 320, 0.5), M.film)], { explode: [0, 0.035, 0] }, drawer);
		const bottom = NODES.filter((n) => !n.top).map((n) => box(0, n.y, n.z, PLATE_W, n.len, 1.5));
		const fingers = [];
		for (let i = 0; i < CELLS.s; i++) for (let j = 0; j < CELLS.p; j++) fingers.push(box(colX(j), rowY(i), 30, 6, 1.6, 6));
		const pb = GEO.merge([...bottom, ...fingers]);
		const pt = GEO.merge(NODES.filter((n) => n.top).map((n) => box(0, n.y, n.z, PLATE_W, n.len, 1.5)));
		mass += kg([pb, pt], 8900);
		part({ id: 'plates-bottom', label: 'Bottom contact plates', assembly: 'contacts', count: 8, source: SRC.press, what: 'Copper plates under the cells on the film: six that each join a row’s poles to the next row’s, and the two end plates, the pack’s minus (row 1) and plus (row 14). Each has a spring finger per cell, pressed up through the holder’s hole onto the pole by the clamp’s force: a pressed contact, no weld, so every cell comes out again.', specs: [['Material', 'Copper, nickel-plated, 1.5 mm'], ['Resistivity', '1.72e-8 Ω·m, +0.39 %/K'], ['Current density', '0.15 A/mm² across a plate, 0.5 A/mm² in a finger at 100 A [computed]'], ['Contact', '0.5 mΩ a cell at ~90 N [inferred]'], ['Fingers', `${CELLS.s * CELLS.p}, 6 mm high`]] }, [m(pb, M.copper)], { explode: [0, 0.063, 0] }, drawer);
		part({ id: 'plates-top', label: 'Top contact plates', assembly: 'contacts', count: 7, source: SRC.press, what: 'Copper plates over the cells, each joining a row’s poles to the next row’s: with the bottom plates they put the 14 rows in series, the current snaking up one row and down the next. Pressed flat onto the poles by the clamp’s pad.', specs: [['Material', 'Copper, nickel-plated, 1.5 mm'], ['Pressed by', 'The clamp’s pad, ~90 N a cell'], ['Each', `${PLATE_W} × ${2 * CELLS.pitch - 3} mm, two rows`]] }, [m(pt, M.copper)], { explode: [0, 0.252, 0] }, drawer);
	}

	/* ------------------------------------------------------------ the BMS, its leads, the straps and the inner plug */
	{
		const by = rowY(CELLS.s - 1) + 60, bz = 67; // the board: in front of the cells, on standoffs
		const board = [m(box(0, by, bz, 400, 80, 2, 0.5), M.pcb)];
		board.push(m(GEO.merge([-1, 1].flatMap((sx) => [by - 36, by + 36].map((y) => cyl([sx * 195, y, POST.top], [sx * 195, y, bz - 1], 2.5, 8)))), M.brass));
		// the pads the straps bolt to: P− at the left end, B+ and B− at the right
		board.push(m(GEO.merge([box(-185, by, bz + 2, 20, 16, 2), box(185, by - 30, bz + 2, 20, 16, 2), box(185, by + 30, bz + 2, 20, 16, 2), box(165, by, bz + 2, 16, 16, 2)]), M.pad));
		// the monitor chips (two cell-voltage front ends, a microcontroller), the capacitors, the balance header
		board.push(m(GEO.merge([box(-160, by - 20, bz + 1.5, 7, 7, 1), box(-160, by, bz + 1.5, 7, 7, 1), box(-160, by + 20, bz + 1.6, 10, 10, 1.2), ...[-100, -88, -76, 44, 56, 68].map((x) => cyl([x, by - 32, bz + 1], [x, by - 32, bz + 6], 2.5, 10)), box(-60, by + 32, bz + 4, 50, 5, 6)]), M.chip));
		part({ id: 'bms', label: 'Battery management system', assembly: 'electronics', source: SRC.bms, what: 'The board in front of the cells on the drawer: two front-end chips read every row’s voltage and the thermistors on the plates, a microcontroller runs the protection and talks CAN to the inverter through the plug. It opens the MOSFETs on any row under 2.80 V or over 4.25 V, any row over 60 °C, or over-current (past 100 A for 10 s, or 250 A at once), and bleeds the high rows at 100 mA above 4.10 V while charging so they stay together.', moves: 'Opens and closes the pack.', specs: [['Rows', '14S, every one measured, balanced'], ['Cut-offs', `${BMS.uv} V · ${BMS.ov} V · ${BMS.ot} °C · ${BMS.oc} A, ${BMS.ocPeak} A for ${BMS.peakS} s [inferred]`], ['Balancing', `${BMS.bal * 1000} mA above ${BMS.balAt} V [inferred]`], ['Charging', `≤ ${BMS.chg} A (0.5 C), ≤ ${BMS.otChg} °C`], ['Talks', 'CAN to the inverter']] }, board, { explode: [0, 0.14, 0.14], tag: { text: 'BMS', at: L(-150, by, bz + 2), value: () => (sim.s.closed ? (sim.s.balancing ? `closed · balancing ${sim.s.balancing} rows` : 'closed') : `open: ${sim.s.fault}`), side: 'left' } }, drawer);
		// the MOSFETs: two banks of eight back to back on heavy copper, charge and discharge
		const fets = [], pours = [];
		for (const [k, y] of /** @type {[number, number][]} */ ([[0, by - 20], [1, by + 20]])) {
			pours.push(box(-60, y, bz + 1.5, 180, 16, 1));
			for (let j = 0; j < 8; j++) fets.push(box(-130 + j * 20, y, bz + 4.25, 10, 15, 4.5, 0.5));
		}
		part({ id: 'mosfets', label: 'MOSFET switches', assembly: 'electronics', count: 16, source: SRC.bms, what: 'Sixteen power MOSFETs in two banks of eight on the board’s copper: one bank blocks discharge, the other charge, back to back in the pack’s minus line. They are the pack’s only switch: closed they drop a few millivolts, open the pack is dead at the plug.', moves: 'Switch in microseconds.', drive: 'The BMS', specs: [['Device', '100 V, ~2 mΩ each [inferred]'], ['Together', `${BMS.R * 1000 - 0.4} mΩ for both banks [inferred]`], ['Heat', 'I²R: 5 W at 100 A, into the board’s copper']] }, [m(GEO.merge(fets), M.chip), m(GEO.merge(pours), M.pad)], { explode: [0, 0.182, 0.14] }, drawer);
		part({ id: 'shunt', label: 'Current shunt', assembly: 'electronics', source: SRC.cu, what: 'A manganin bar between two copper pads in the minus line: the BMS reads the pack’s current from the millivolts across it, for its counting of the charge and its over-current trip.', specs: [['Resistance', '0.1 mΩ: 10 mV at 100 A'], ['Material', 'Manganin, 48e-8 Ω·m, flat with temperature']] }, [m(box(60, by, bz + 2.25, 40, 10, 2.5), M.manganin), m(GEO.merge([box(35, by, bz + 1.5, 12, 14, 1), box(85, by, bz + 1.5, 12, 14, 1)]), M.pad)], { explode: [0, 0.168, 0.14] }, drawer);
		part({ id: 'fuse', label: 'Fuse', assembly: 'electronics', source: SRC.bms, what: 'A bolt-down fuse in the plus line, the last guard behind the MOSFETs: a dead short at the plug blows it before any strap or plate can heat.', specs: [['Rating', '125 A, 80 V DC [inferred]'], ['Resistance', '0.3 mΩ [inferred]']] }, [m(box(120, by, bz + 8, 44, 20, 14, 2), M.ceramic), m(GEO.merge([box(98, by, bz + 7, 8, 22, 12, 1), box(142, by, bz + 7, 8, 22, 12, 1)]), M.brass)], { explode: [0, 0.196, 0.14] }, drawer);
		// a balance lead from every series node to the header: along the left gap, in front of the cells and up to the board
		const leads = [];
		for (const n of NODES) {
			const mat = n.k === 0 ? M.wireBlack : n.k === CELLS.s ? M.wireRed : M.wire;
			leads.push(m(hose([[-PLATE_W / 2, n.y, n.z], [-224.5, n.y, n.z], [-224.5, 104, n.z], [-210, 106, n.z], [-210, 106, bz + 7], [-82 + (n.k - 7) * 3, by + 30, bz + 7]], 0.7, 6), mat));
		}
		part({ id: 'balance-leads', label: 'Balance leads', assembly: 'electronics', count: NODES.length, source: SRC.bms, what: 'Fifteen thin leads, one from every contact plate, so the BMS sees every row’s voltage and can bleed any row that runs ahead: from each plate’s end along the gap beside the holders, in front of the cells and up to the header on the board.', specs: [['Leads', '15 × 0.5 mm², fused at the plate'], ['Thermistors', 'On 4 of the plates [inferred]']] }, leads, { explode: [-0.07, 0.21, 0.07] }, drawer);
		// the straps that carry the current: B+ from row 14’s plate to the fuse, P+ from the fuse down the right gap to the
		// plug; P− from the plug up the left gap to the MOSFETs, B− from the shunt along the right gap, high, back to row 1
		const y0 = rowY(0), y13 = rowY(CELLS.s - 1);
		const bare = [box(220.5, y0, 26.25, 9, 19, 1.5), box(205, by + 30, bz + 3.75, 39, 20, 1.5), box(220.5, y13, 26.25, 9, 19, 1.5), box(205, by - 30, bz + 3.75, 39, 20, 1.5), box(195, by, bz + 3.75, 59, 20, 1.5), box(-205, by, bz + 3.75, 39, 20, 1.5)];
		const sleeved = [
			box(224.5, y0, 66, 1.5, 19, 80), box(224.5, (y0 - 9.5 + by + 40) / 2, 105, 1.5, by + 40 - y0 + 9.5, 20), box(224.5, by + 30, 88, 1.5, 20, 36), // B−
			box(224.5, y13, 48, 1.5, 19, 44), box(224.5, (y13 - 9.5 + by - 20) / 2, 70, 1.5, by - 20 - y13 + 9.5, 20), // B+
			box(224.5, by, 58, 1.5, 20, 24), box(224.5, (by - 216) / 2, 46, 1.5, by + 216, 20), box((45 + 224.5) / 2, -216, 46, 179.5, 1.5, 20), // P+
			box(-224.5, by, 58, 1.5, 20, 24), box(-224.5, (by - 216) / 2, 46, 1.5, by + 216, 20), box(-(45 + 224.5) / 2, -216, 46, 179.5, 1.5, 20) // P−
		];
		mass += kg([...bare, ...sleeved], 8900);
		part({ id: 'busbars', label: 'Current straps', assembly: 'electronics', count: 4, source: SRC.cu, what: 'Four flat copper straps in heat-shrink carry the pack’s current, each in the 3 mm gap between the holders and the shell’s wall: from row 14’s plate (the plus) up to the fuse, from the fuse down the right side and across the back to the plug’s plus; from the plug’s minus up the left side to the MOSFETs, and from the shunt along the right side, high, back to row 1’s plate (the minus). Bolted to the pads, no weld.', specs: [['Strap', '20 × 2 mm copper, 40 mm²: 2.5 A/mm² at 100 A [computed]'], ['Resistance', `${fmt(LINK.series * 1000 - 0.2, 2)} mΩ for the two long runs [computed]`], ['Insulation', 'Heat-shrink, 0.5 mm']] }, [m(GEO.merge(bare), M.copper), m(GEO.merge(sleeved), M.strap)], { explode: [0, 0.238, 0] }, drawer);
		const plug = [m(box(0, -Lh + 14, 57, 150, 12, 30, 1), M.black)];
		for (const x of [-45, 45]) plug.push(m(cyl([x, -Lh + 8, 58], [x, -Lh + 4.5, 58], 3.5, 12), M.brass));
		for (let k = 0; k < 4; k++) plug.push(m(cyl([-12 + k * 8, -Lh + 8, 58], [-12 + k * 8, -Lh + 5, 58], 1.2, 8), M.gold));
		part({ id: 'inner-plug', label: 'Inner plug', assembly: 'electronics', source: SRC.ours, what: 'At the back of the drawer: the BMS’s plus, minus and data in one plug whose two round pins and four data pins slide into the inside of the shell’s back socket as the drawer goes home, into the same contact tubes the cube’s pins enter from the other side. Pull the drawer 10 mm and the pack is dead at its socket.', moves: 'Leaves the socket with the drawer.', specs: [['Power', '2 pins ⌀ 7 mm, 120 A [inferred]'], ['Data', 'CAN, 4 pins'], ['Engages', 'The last 3.5 mm of the drawer’s travel']] }, plug, { explode: [0, 0.07, -0.14] }, drawer);
	}

	/* ------------------------------------------------------------ the solver and its moving parts */
	const ctl = {
		load: { label: 'Load (below 0: charging)', min: -2.5, max: 5, value: load, step: 0.1, unit: 'kW', digits: 1, ends: /** @type {[string, string]} */ (['Charging at 2.5 kW', 'Full load, 100 A']) },
		ambient: { label: 'Room temperature', min: -10, max: 45, value: ambient, step: 1, unit: '°C', ends: /** @type {[string, string]} */ (['Cold', 'Hot']) },
		soc: { label: 'State of charge (set)', min: 0, max: 100, value: soc, step: 1, unit: '%', ends: /** @type {[string, string]} */ (['Empty', 'Full']) },
		aged: { label: 'Row 7 aged', min: 0, max: 100, value: 0, step: 5, unit: '%', ends: /** @type {[string, string]} */ (['New', '60 % left, 3× resistance']) },
		drawer: { label: 'Drawer out', min: 0, max: DRAWER_OUT, value: 0, step: 5, unit: 'mm', ends: /** @type {[string, string]} */ (['Home, buttons pressed to start', 'Out for service']) },
		trigger: { label: 'Grip trigger', min: 0, max: 4, value: 0, step: 0.5, unit: 'mm', ends: /** @type {[string, string]} */ (['Released', 'Squeezed: pawls in']) }
	};
	const sim = solver(ctl);
	// the current, drawn where the cut or the x-ray shows it: up one row and down the next through the plates, along the
	// straps to the plug and back; one set for discharging, the same paths reversed for charging
	const lanes = [-187, -99, -11, 77, 165];
	const snake = (/** @type {number} */ x) => {
		const pts = [];
		for (let i = 0; i < CELLS.s; i++) {
			const y = rowY(i), up = i % 2 === 0;
			pts.push([x, y, up ? 27 : 103], [x, y, up ? 103 : 27]);
		}
		return /** @type {V3[]} */ (pts);
	};
	const by = rowY(CELLS.s - 1) + 60;
	const leadIn = /** @type {V3[]} */ ([[216, rowY(CELLS.s - 1), 27], [224.5, rowY(CELLS.s - 1), 50], [224.5, by - 20, 70], [185, by - 30, 72], [120, by, 78], [185, by, 72], [224.5, by, 60], [224.5, -216, 46], [45, -216, 46], [45, -224, 58], [45, -236, 58]]);
	const leadOut = /** @type {V3[]} */ ([[-45, -236, 58], [-45, -224, 58], [-45, -216, 46], [-224.5, -216, 46], [-224.5, by, 60], [-185, by, 72], [-60, by, 73], [60, by, 72], [185, by + 30, 72], [224.5, by + 30, 88], [224.5, by + 20, 105], [224.5, rowY(0), 105], [224.5, rowY(0), 40], [216, rowY(0), 27]]);
	const pathsD = [...lanes.map(snake), leadIn, leadOut];
	const pathsC = pathsD.map((p) => [...p].reverse());
	/** the streaks' colour: the rows' by their heat (cool blue to hot red), the straps' by the current */
	const tCol = (/** @type {number} */ T) => {
		const k = clamp((T - 20) / 45);
		return [lerp(0.25, 1.0, k), lerp(0.55, 0.35, k), lerp(1.0, 0.1, k)];
	};
	const colour = (/** @type {number} */ k, /** @type {number} */ u) => (k < lanes.length ? tCol(sim.s.T[clamp(Math.floor(u * CELLS.s), 0, CELLS.s - 1)]) : tCol(20 + 45 * clamp(Math.abs(sim.s.I) / 150)));
	const toM = (/** @type {V3[][]} */ ps) => ps.map((p) => p.map((q) => L(...q)));
	const flowD = new Flow({ theme: 'paper' }, { parent: drawer, paths: toM(pathsD), count: 520, length: 0.025, seed: 5, color: colour });
	const flowC = new Flow({ theme: 'paper' }, { parent: drawer, paths: toM(pathsC), count: 520, length: 0.025, seed: 9, color: (/** @type {number} */ k, /** @type {number} */ u) => colour(k, 1 - u) });
	kit.onTick((dt, env) => {
		sim.step(dt, env);
		const s = sim.s;
		// the service move: the buttons go in as the drawer starts, the catches' bolts out of their notches, the drawer out
		const out = ctl.drawer.value, press = clamp(out / 4) * (1 - clamp((out - 16) / 8));
		const catches = out > 0.5 ? 1 : press;
		drawer.position.z = out * S;
		for (const [sx, side] of /** @type {const} */ ([[-1, 'left'], [1, 'right']])) {
			moving[`release-${side}`].position.z = L(0, Lh, 0)[2] - press * 4 * S;
			moving[`catch-${side}`].position.x = sx * PX * S + sx * catches * 5 * S;
			moving[`pawl-${side}`].rotation.y = -sx * (ctl.trigger.value / 38);
		}
		moving.trigger.position.y = (LOCK_Z + LIFT) * S + ctl.trigger.value * S;
		// the strip: a segment a tenth of the charge; the next breathes while charging; the lit ones blink red on a fault
		const soc = sim.socPack(), lit = Math.round(soc * 10);
		const leds = /** @type {THREE.MeshPhysicalMaterial[]} */ (/** @type {any} */ (moving.leds));
		for (let k = 0; k < 10; k++) {
			const on = k < lit, next = k === lit && s.I < -0.5 && s.closed;
			const fault = !s.closed && (on || lit === 0);
			leds[k].emissive.setRGB(fault ? 1 : 0.12, fault ? 0.08 : 0.95, fault ? 0.05 : 0.4);
			leds[k].emissiveIntensity = fault ? (s.blink < 0.5 ? 2.5 : 0.2) : on ? 2.2 : next ? 1.2 + 1.0 * Math.sin(s.blink * Math.PI * 2) : 0;
		}
		// the streaks: one way discharging, the other charging, as fast as the current, where the inside shows
		const show = Math.max(env.cut, env.xray) * (s.plugged ? 1 : 0.4);
		flowD.speed = (0.12 * Math.max(0, s.I)) / 100;
		flowC.speed = (0.12 * Math.max(0, -s.I)) / 100;
		flowD.opacity = s.I > 0.5 ? clamp(0.3 + s.I / 100) * show : 0;
		flowC.opacity = s.I < -0.5 ? clamp(0.3 - s.I / 100) * show : 0;
		flowD.update(dt);
		flowC.update(dt);
		const hero = lab.read;
		const left = sim.left(), hot = sim.hottest();
		hero.value = s.P / 1000;
		hero.bad = !s.closed || s.T[hot] > BMS.ot - 5 || Math.abs(s.I) > BMS.oc;
		hero.state = !s.plugged ? 'unplugged: the drawer is out' : !s.closed ? `open: ${s.fault}${s.latched ? ', take the load off' : ''}` : env.broken ? `overloaded: ${fmt(s.I)} A, ${BMS.ocPeak} A for ${BMS.peakS} s at most` : s.I < -0.5 ? (s.balancing ? `charging, balancing ${s.balancing} rows` : soc > 0.999 ? 'full' : 'charging') : s.I > BMS.oc ? 'over its continuous rating' : s.T[hot] > BMS.ot - 5 ? `row ${hot + 1} near its limit` : Math.abs(s.I) < 0.5 ? (ctl.load.value < 0 && soc >= 0.995 ? 'full, the charger off' : 'resting') : 'delivering';
		hero.sub = `${fmt(s.V, 1)} V · ${fmt(Math.abs(s.I))} A ${s.I < -0.5 ? 'in' : 'out'} · ${fmt(soc * 100)} % · ${fmt(left.wh / 1000, 2)} kWh left${s.P > 50 ? ` · ${runTime(left.wh / s.P)} at this load` : ''} · row ${hot + 1} ${fmt(s.T[hot])} °C · ${fmt(s.q)} W of heat`;
	});
	/** hours as "2 h 14 min" @param {number} h */
	const runTime = (h) => (h >= 1 ? `${Math.floor(h)} h ${fmt((h % 1) * 60)} min` : `${fmt(h * 60)} min`);
	/** @type {import('$lib/assets/parts.js').Lab} */
	const lab = {
		hero: { label: 'Power delivered', unit: 'kW', max: 5, digits: 2 },
		read: { value: 0, state: '', sub: '', bad: false },
		controls: ctl,
		how: {
			text: 'Fourteen rows of twenty cells in series. Each row’s voltage is its cells’ open-circuit voltage at their state of charge less the current’s drop over their resistance, which rises in the cold (Arrhenius) and near empty; the pack’s is their sum less the BMS’s, the straps’ and the plug’s. The load asks for a power, and the current follows from the sagged voltage; charging is a 50 A charger tapered so no row passes 4.20 V, the balancer bleeding the high rows. Every current’s I²R heats its row; the rows share heat through the plates, give it down into the drawer and out through the shell to the room. The BMS opens the pack on any row under 2.80 V or over 4.25 V, over 60 °C, or over-current. State of charge and heat run 60 times faster than real (an hour a minute); the electrics, the BMS’s trips and the strip at real time.',
			eqs: ['V_row = OCV(SoC) − I · R_cell(T, SoC) / 20 − I · 2 R_c / 20      R_cell = 25 mΩ · e^(Ea/R (1/T − 1/298)) · (1 + 1.5 · (0.15 − SoC)⁺/0.15), Ea = 21 kJ/mol, R_c = 0.5 mΩ', 'V = Σ V_row − I · (R_fet + R_shunt + R_fuse + R_straps + R_plug) = Σ V_row − I · 1.4 mΩ', 'I = (V_oc − √(V_oc² − 4 P R)) / (2 R)      P the load; charging I ≥ −50 A and I ≥ −(4.20 − OCV) / R_row', 'dSoC_row/dt = −I / (3,600 · Q_row)      Q_row = 100 Ah (row 7: × (1 − 0.4 aged)); balancing −0.1 A on a row over 4.10 V', 'C_row dT/dt = I² R_row − G_rr (T − T_±1) − G_rd (T − T_drawer)      C_row = 1,480 J/K, G_rr = 6.5, G_rd = 3 W/K', 'C_d dT_d/dt = Σ G_rd (T − T_d) + I² R_bms − G_ds (T_d − T_s);  C_s dT_s/dt = G_ds (T_d − T_s) − G_sa (T_s − T_room)      G_ds = 5, G_sa = 6.3 W/K', 'BMS opens: V_row < 2.80 V · V_row > 4.25 V · T_row > 60 °C · |I| > 250 A, or > 100 A for 10 s']
		},
		breakIt: {
			label: 'Overload it',
			run: () => {},
			reset: () => sim.reset()
		},
		cut: { a: [1, 0, 0], b: [0, 1, 0], center: [0.011, (CELLS.z0 + TOP) / 2 * S + LIFT * S, -0.05], reach: 0.9 }
	};
	// v11: its own moves, what a hand does with it (the stage adds Run and Assemble)
	if (v >= 11) lab.moves = MOVES;
	const asset = kit.seal({ lab });
	root.userData.mass = mass;
	// at rest: every moving part where the solver's first moment puts it
	asset.tick(0, { broken: false, time: 0, slow: 0, cut: 0, xray: 0 });
	return root;
}
