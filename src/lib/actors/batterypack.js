/*
 * THE BATTERYPACK — our own modular, repairable battery (Samuel 2026-10-13): a rack module 460 × 480 × 125 mm of 280
 * cylindrical 21700 cells (14 in series, 20 in parallel: 51.8 V, 100 Ah, about 5.2 kWh, ~26 kg), held in two holder
 * plates and joined by copper contact plates that its lid presses onto them: no welds, no glue. Undo the latches,
 * lift the lid, and any cell, plate or the BMS comes out on its own and a new one goes in; nothing is thrown away
 * for one worn cell. Four of them fill a BatteryCube (./batterycube.js) to the top.
 *
 * Built in its own frame: its foot's middle at the origin, its front (the handles and the charge strip)
 * towards +z; in mm through `L` (x across, y along to the front, z up). Its figures are inferred from common 21700
 * cells (5 Ah, 3.7 V) and rack modules; its cards say so. `batteryPackParts` adds one to any machine's kit.
 */
import * as THREE from 'three';
import { loop, rig, skin } from './rig';
import { block, ease } from './excavator-rig.js';
import { machineKit } from './parts.js';
import { CLICKLOCK, clickLatch, clickLockPieces } from './clicklock.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Cast} Cast */
/** @typedef {[number, number, number]} MM a point of the pack: x across, y forward, z up (mm) */

const S = 0.001;
/** the pack's size (mm): W across, L front to back, H high */
export const PACK = { W: 460, L: 480, H: 125 };
/** the height (mm) its ClickLock's pawls sit at: low in the foot band until v4; from v5 at the grip's own height, so
 *  the release cables run straight and the cube's rails follow them; from v8 in the shell's foot, with the grip */
export const lockZ = (v = 8) => (v >= 8 ? 10 : v >= 7 ? 20 : v >= 5 ? 30 : 10);
/** how far behind its face (mm) the ClickLock's pawl teeth sit: 40 until v5; from v6 22, so they come out through the
 *  drawer's front plate and leave with it */
export const lockBack = (v = 8) => (v >= 6 ? 22 : 40);
/** the grip's bar height (mm) from v5: low on the face, its trigger at the lock's height */
const gripZ = (/** @type {number} */ v) => (v >= 8 ? 10 : v >= 7 ? 28 : 40);
/** how high (mm) the shell's foot (its floor tub and the sill across its face) stands from v8: the drawer rides on it */
const FOOT_8 = 20;
/** from v9 the shell's two front corner columns (mm): `w` across from its side, up to the base plate's top. The cells'
 *  block fills 446 of the shell's 452 mm inside, so a column any taller would stop the drawer coming out: the base
 *  plate runs between the two, and the cells' holders pass over them */
const POST_9 = { w: 46, top: 25 };
/** its cells: 14 rows in series (along y) of 20 in parallel (along x), 22 mm apart, standing; their zone's middle */
const CELLS = { s: 14, p: 20, pitch: 22, r: 10.5, h: 70, z0: 16, y: -55 };
const SRC = 'BatteryPack (our design)';
const CASE = '#1f2225', LID = '#232629', SEAM = '#d9dcde', FACE = '#2b2f33', HOLDER = '#1b1d1f', WRAP = '#2f6fb5', CAP = '#c9ccce', COPPER = '#c27a43', PCB = '#2c7a4a', DARK = '#202326', RED = '#c8372d', BLACK = '#161718', LED = '#59f0a0', LED_OFF = '#2c3a33', STEEL = '#8d9396';

/** its assemblies, as the pack on its own shows them drawn apart */
const ASSEMBLIES = /** @type {import('./parts.js').Assembly[]} */ ([
	{ id: 'case', label: 'Case', note: 'An aluminium tray with its front panel and handles: the pack slides into a rack or a BatteryCube by them.', out: [0, 0, 0] },
	{ id: 'cells', label: 'Cells', note: '280 cylindrical 21700 cells standing in two holder plates, 14 rows in series of 20 side by side.', out: [0, 0.12, 0] },
	{ id: 'contacts', label: 'Contact plates', note: 'Copper plates top and bottom that join each row to the next: pressed on, not welded, so every cell comes out again.', out: [0, 0.3, 0] },
	{ id: 'electronics', label: 'BMS and plug', note: 'The battery management system that watches every row, the plug in its back and the charge strip.', out: [0, 0.15, 0.3] },
	{ id: 'lock', label: 'ClickLock', note: 'The snap-in latch in all its pieces: two spring pawls whose teeth click into the rails’ keepers, their pivots, and the cables that let the grip’s trigger pull both back at once.', out: [0, 0.04, 0.32] },
	{ id: 'lid', label: 'Lid', note: 'The lid with its spring pad that presses the contacts home, held by four latches: open them and the pack is open.', out: [0, 0.5, 0] }
]);
const HOLE = '#050607';
/** from v6: a closed shell, and one L-shaped drawer (front plate + base plate) that carries every inner part */
const ASSEMBLIES_6 = /** @type {import('./parts.js').Assembly[]} */ ([
	{ id: 'shell', label: 'Shell', note: 'The closed outer shell: floor, walls, top and back in one, open only at the front. The back socket sits in it, and the two release buttons in its sides.', out: [0, 0, 0] },
	{ id: 'drawer', label: 'Service drawer', note: 'One L of aluminium: the front plate with the grip and the charge strip, and the base plate under it. Every inner part is mounted on it, so pressing the two side buttons and pulling the grip brings the whole inside out.', out: [0, 0, 0.6] },
	{ id: 'cells', label: 'Cells', note: '280 cylindrical 21700 cells standing in two holder plates on the drawer, 14 rows in series of 20 side by side.', out: [0, 0.14, 0.6] },
	{ id: 'contacts', label: 'Contact plates', note: 'Copper plates top and bottom that join each row to the next, pressed on by the drawer’s clamp, not welded.', out: [0, 0.32, 0.6] },
	{ id: 'electronics', label: 'BMS and plug', note: 'The battery management system on the drawer, and its inner plug that meets the shell’s back socket when the drawer is in.', out: [0, 0.18, 0.85] },
	{ id: 'lock', label: 'ClickLock', note: 'The snap-in latch that holds the pack in its cube, on the drawer’s front plate: two spring pawls, their pivots and the cables to the grip’s trigger.', out: [0, 0.04, 0.85] }
]);
/** from v8 the shell carries everything you hold and press: its foot's sill across the face with the grip, the ClickLock
 *  and the two release buttons at its outer ends; the drawer only the insides */
const ASSEMBLIES_8 = /** @type {import('./parts.js').Assembly[]} */ ([
	{ id: 'shell', label: 'Shell', note: 'The closed outer shell on its foot: floor tub, walls, top and back in one, open at the front above the foot’s sill. The sill carries the grip and, at its two outer ends, the release buttons; the back socket sits in the back.', out: [0, 0, 0] },
	{ id: 'drawer', label: 'Service drawer', note: 'One L of aluminium riding on the shell’s foot: the front plate (the face above the sill, with its finger pull and the charge strip) and the base plate behind it. It carries every inner part and nothing you hold: press the two buttons, pull it by its finger pull, and the whole inside comes out.', out: [0, 0.03, 0.6] },
	{ id: 'cells', label: 'Cells', note: '280 cylindrical 21700 cells standing in two holder plates on the drawer, 14 rows in series of 20 side by side.', out: [0, 0.17, 0.6] },
	{ id: 'contacts', label: 'Contact plates', note: 'Copper plates top and bottom that join each row to the next, pressed on by the drawer’s clamp, not welded.', out: [0, 0.35, 0.6] },
	{ id: 'electronics', label: 'BMS and plug', note: 'The battery management system on the drawer, and its inner plug that meets the shell’s back socket when the drawer is in.', out: [0, 0.21, 0.85] },
	{ id: 'lock', label: 'ClickLock', note: 'The snap-in latch that holds the pack in its cube, in the shell’s foot: two spring pawls, their pivots and the cables to the grip’s trigger.', out: [0, -0.02, 0.3] }
]);
/** from v9 the release buttons and their catches sit in the shell's two front corner columns, at the base plate's level */
const ASSEMBLIES_9 = /** @type {import('./parts.js').Assembly[]} */ ([
	{ id: 'shell', label: 'Shell', note: 'The closed outer shell on its foot: floor tub, walls, top and back in one, open at the front above the foot’s sill. Its two front corners stand up as columns to the base plate’s top, each with a release button in its face and the drawer’s catch inside; the sill between them carries the grip, and the back socket sits in the back.', out: [0, 0, 0] },
	{ ...ASSEMBLIES_8[1], note: 'One L of aluminium riding on the shell’s foot: the front plate (the face above the sill and the two columns, with its finger pull and the charge strip) and the base plate behind it, running between the columns. It carries every inner part and nothing you hold: press the two buttons, pull it by its finger pull, and the whole inside comes out.' },
	...ASSEMBLIES_8.slice(2)
]);
const STEPS_9 = ['Lay out the shell on its foot: floor tub, walls, top and back, its two corner columns with their release buttons and catches, the back socket, the grip and the ClickLock', 'Build the drawer: base plate and front plate with its finger pull and charge strip', 'Set the bottom contact plates and holder on the base plate, and stand the 280 cells in it', 'Press on the top holder, the top plates and the clamp', 'Fit the BMS, its leads and the inner plug; slide the drawer in between the columns until both catches click into the base plate'];
const STEPS_8 = ['Lay out the shell on its foot: floor tub, walls, top and back, the back socket, the grip, the ClickLock, the release buttons and their catches', 'Build the drawer: base plate and front plate with its finger pull and charge strip', 'Set the bottom contact plates and holder on the base plate, and stand the 280 cells in it', 'Press on the top holder, the top plates and the clamp', 'Fit the BMS, its leads and the inner plug; slide the drawer in over the sill until both catches click'];
const STEP_8 = /** @type {Record<string, number>} */ ({ tray: 1, terminals: 1, handles: 1, 'release-left': 1, 'release-right': 1, 'catch-left': 1, 'catch-right': 1, 'lock-pawls': 1, 'lock-springs': 1, 'lock-pivots': 1, 'lock-cables': 1, 'lock-trigger': 1, front: 2, base: 2, charge: 2, 'plates-bottom': 3, 'holder-bottom': 3, cells: 3, 'holder-top': 4, 'plates-top': 4, clamp: 4, bms: 5, 'inner-plug': 5 });
const GROUP_8 = /** @type {Record<string, string>} */ ({ tray: 'shell', terminals: 'shell', handles: 'shell', 'release-left': 'shell', 'release-right': 'shell', 'catch-left': 'shell', 'catch-right': 'shell', front: 'drawer', base: 'drawer', charge: 'drawer', clamp: 'drawer', 'lock-pawls': 'lock', 'lock-springs': 'lock', 'lock-pivots': 'lock', 'lock-cables': 'lock', 'lock-trigger': 'lock', 'plates-bottom': 'contacts', 'holder-bottom': 'cells', cells: 'cells', 'holder-top': 'cells', 'plates-top': 'contacts', bms: 'electronics', 'inner-plug': 'electronics' });
const STEPS_6 = ['Lay out the shell: floor, walls, top and back, the back socket and the two release buttons', 'Build the drawer: base plate and front plate, the grip, charge strip and ClickLock', 'Set the bottom contact plates and holder on the base plate, and stand the 280 cells in it', 'Press on the top holder, the top plates and the clamp', 'Fit the BMS, its leads and the inner plug; slide the drawer in until both side catches click'];
const STEP_6 = /** @type {Record<string, number>} */ ({ tray: 1, terminals: 1, 'release-left': 1, 'release-right': 1, front: 2, base: 2, charge: 2, handles: 2, 'catch-left': 2, 'catch-right': 2, 'lock-pawls': 2, 'lock-springs': 2, 'lock-pivots': 2, 'lock-cables': 2, 'lock-trigger': 2, 'plates-bottom': 3, 'holder-bottom': 3, cells: 3, 'holder-top': 4, 'plates-top': 4, clamp: 4, bms: 5, 'inner-plug': 5 });
const GROUP_6 = /** @type {Record<string, string>} */ ({ tray: 'shell', terminals: 'shell', 'release-left': 'shell', 'release-right': 'shell', front: 'drawer', base: 'drawer', charge: 'drawer', handles: 'drawer', clamp: 'drawer', 'catch-left': 'drawer', 'catch-right': 'drawer', 'lock-pawls': 'lock', 'lock-springs': 'lock', 'lock-pivots': 'lock', 'lock-cables': 'lock', 'lock-trigger': 'lock', 'plates-bottom': 'contacts', 'holder-bottom': 'cells', cells: 'cells', 'holder-top': 'cells', 'plates-top': 'contacts', bms: 'electronics', 'inner-plug': 'electronics' });
/** the shell's own parts (all the rest slide out with the drawer; from v7 the release buttons too, on its front),
 *  and how far the drawer comes out (m) */
const onShell = (/** @type {number} */ v) =>
	v >= 8 ? Object.keys(GROUP_8).filter((p) => GROUP_8[p] === 'shell' || GROUP_8[p] === 'lock') : v >= 7 ? ['tray', 'terminals'] : ['tray', 'terminals', 'release-left', 'release-right'];
const DRAWER_OUT = 0.45;
const STEPS = ['Lay out the tray, its front panel, handles and ClickLock', 'Set the bottom contact plates and holder, and stand the 280 cells in it', 'Press on the top holder and the top contact plates', 'Fit the BMS, its sense leads and the back plug', 'Close the lid on its spring pad and snap the four latches'];
const STEP = /** @type {Record<string, number>} */ ({ tray: 1, front: 1, charge: 1, handles: 1, clicklock: 1, 'lock-pawls': 1, 'lock-springs': 1, 'lock-pivots': 1, 'lock-cables': 1, 'lock-trigger': 1, 'plates-bottom': 2, 'holder-bottom': 2, cells: 2, 'holder-top': 3, 'plates-top': 3, bms: 4, terminals: 4, lid: 5, latches: 5 });
const GROUP = /** @type {Record<string, string>} */ ({ tray: 'case', front: 'case', charge: 'case', handles: 'case', clicklock: 'case', 'lock-pawls': 'lock', 'lock-springs': 'lock', 'lock-pivots': 'lock', 'lock-cables': 'lock', 'lock-trigger': 'lock', 'plates-bottom': 'contacts', 'holder-bottom': 'cells', cells: 'cells', 'holder-top': 'cells', 'plates-top': 'contacts', bms: 'electronics', terminals: 'electronics', lid: 'lid', latches: 'lid' });

/**
 * Add a BatteryPack's parts to a machine's kit, its foot's middle at `at` (actor metres), its front towards +z.
 * `assembly` and `step` say where each part goes in the machine's catalog; with `unit`, the pack arrives whole.
 * `seg`: the sides of a cell (fewer where many packs stand closed). `v`: the version to build (2: its plug still on the
 * face, no ClickLock; 3: the back plug and the ClickLock; 4: one centre grip whose
 * trigger releases the ClickLock; 5: that grip low on its face, the lock at its height so the cables run straight,
 * and its back plug as holes for the cube's pins; 6: a closed shell and one L-shaped service drawer carrying every
 * inner part, released by two push buttons in the shell's sides; 7: the grip, the lock and two release buttons on the
 * face's left and right ends, all down at the base plate's level; 8: the grip, the lock and the release buttons all on
 * the shell, in its foot's sill across the face, the drawer riding on the foot; the back socket's holes in one line;
 * 9: the release buttons and catches in the shell's two front corner columns, at the base plate's level, the catches
 * shooting sideways into the base plate's edges).
 * @param {ReturnType<typeof machineKit>} kit
 * @param {{ at: V3, base: string, assembly?: (g: string) => string, step?: (p: string) => number, prefix?: string, unit?: string, seg?: number, v?: number }} o
 */
export function batteryPackParts(kit, { at, base, assembly = (g) => g, step, prefix = '', unit, seg = 10, v = 9 }) {
	const G = v >= 8 ? GROUP_8 : v >= 7 ? { ...GROUP_6, 'release-left': 'drawer', 'release-right': 'drawer' } : v >= 6 ? GROUP_6 : GROUP;
	const GRIP_Z = gripZ(v);
	const stepOf = step ?? ((/** @type {string} */ p) => (v >= 8 ? STEP_8 : v >= 6 ? STEP_6 : STEP)[p]); // v9 builds in v8's steps
	// from v8 every inner part rides higher, on the shell's foot
	const DZ = v >= 8 ? FOOT_8 - 3 : 0;
	const m = new THREE.Matrix4().makeTranslation(...at);
	/** @param {number} x @param {number} y @param {number} z @returns {V3} */
	const L = (x, y, z) => [x * S, z * S, y * S];
	const T = (/** @type {THREE.BufferGeometry} */ g) => g.applyMatrix4(m);
	// a box: rounded where its edges show (r over 2 mm), a plain one for the plates and boards, so a pack stays light
	const box = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {number} */ w, /** @type {number} */ l, /** @type {number} */ h, r = 1.5) =>
		T(r > 2 ? block(w * S, h * S, l * S, L(x, y, z), r * S) : new THREE.BoxGeometry(w * S, h * S, l * S).translate(...L(x, y, z)));
	/** @param {MM} a @param {MM} b @param {number} r @param {number} [n] */
	const cyl = (a, b, r, n = 12) => {
		const A = new THREE.Vector3(...L(...a)), B = new THREE.Vector3(...L(...b));
		const g = new THREE.CylinderGeometry(r * S, r * S, A.distanceTo(B), n);
		g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()), new THREE.Vector3(1, 1, 1)));
		return T(g);
	};
	/** a rounded slab (mm): a w × l outline with corners of radius r, from z0 up h high, hollow to `wall` if given,
	 *  its top edge eased by `bevel`; the case's smooth shell, lid and bands */
	const slab = (/** @type {number} */ w, /** @type {number} */ l, /** @type {number} */ r, /** @type {number} */ z0, /** @type {number} */ h, wall = 0, bevel = 0) => {
		const outline = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ c, hole = false) => {
			const p = hole ? new THREE.Path() : new THREE.Shape();
			const x = a / 2, y = b / 2;
			p.moveTo(-x + c, -y);
			p.lineTo(x - c, -y);
			p.quadraticCurveTo(x, -y, x, -y + c);
			p.lineTo(x, y - c);
			p.quadraticCurveTo(x, y, x - c, y);
			p.lineTo(-x + c, y);
			p.quadraticCurveTo(-x, y, -x, y - c);
			p.lineTo(-x, -y + c);
			p.quadraticCurveTo(-x, -y, -x + c, -y);
			return p;
		};
		const shape = /** @type {THREE.Shape} */ (outline(w * S, l * S, r * S));
		if (wall) shape.holes.push(/** @type {THREE.Path} */ (outline((w - 2 * wall) * S, (l - 2 * wall) * S, Math.max(1, r - wall) * S, true)));
		const g = new THREE.ExtrudeGeometry(shape, { depth: (h - bevel) * S, curveSegments: 8, bevelEnabled: bevel > 0, bevelThickness: bevel * S, bevelSize: bevel * S * 0.8, bevelOffset: -bevel * S * 0.8, bevelSegments: 3 });
		g.rotateX(-Math.PI / 2).translate(0, z0 * S, 0);
		g.clearGroups(); // one material per piece: the kit's merge sets its own groups
		return T(g);
	};
	const RC = 30; // the case's corner radius
	const CHARGE = 7; // the segments lit: ~70 % charged
	const { W, L: LEN, H } = PACK;
	const Wh = W / 2, Lh = LEN / 2;
	const rowY = (/** @type {number} */ i) => CELLS.y + (i - (CELLS.s - 1) / 2) * CELLS.pitch;
	const colX = (/** @type {number} */ j) => (j - (CELLS.p - 1) / 2) * CELLS.pitch;
	const zone = { w: CELLS.p * CELLS.pitch + 6, l: CELLS.s * CELLS.pitch + 6 };
	const z0 = CELLS.z0 + DZ, top = z0 + CELLS.h;
	/** @param {string} p @param {Omit<import('./parts.js').PartInfo, 'assembly' | 'step' | 'id'>} info @param {(put: (geo: THREE.BufferGeometry, color: string) => void) => void} make */
	const part = (p, info, make) => kit.part({ ...info, id: `${prefix}${p}`, assembly: assembly(G[p]), step: stepOf(p), source: SRC, ...(unit ? { unit } : {}) }, base, make);
	/** an outline (mm, the pack's x and y) drawn up from z0, h high, as one prism */
	const prism = (/** @type {(p: THREE.Shape) => void} */ draw, /** @type {number} */ z0, /** @type {number} */ h) => {
		const shape = new THREE.Shape();
		draw(shape);
		const g = new THREE.ExtrudeGeometry(shape, { depth: h * S, curveSegments: 8, bevelEnabled: false });
		g.rotateX(-Math.PI / 2).translate(0, z0 * S, 0);
		g.clearGroups();
		return T(g);
	};
	// in a shape, y is minus the pack's y (the extrusion stands it up), so every point goes in as (x, -y)
	const at2 = (/** @type {number} */ x, /** @type {number} */ y) => /** @type {[number, number]} */ ([x * S, -y * S]);
	const Y0 = PACK.L / 2 - 30; // where the shell's straight sides end and the drawer's front plate begins
	/** the shell's U (open at the front), its walls `w` thick; `w` 0: the same outline closed, a plate */
	const shellU = (/** @type {number} */ w) => (/** @type {THREE.Shape} */ p) => {
		const x = PACK.W / 2, yb = -PACK.L / 2, r = 30;
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
	/** the drawer's front plate in plan: from Y0 to the face, its two front corners round */
	const capD = (/** @type {THREE.Shape} */ p) => {
		const x = PACK.W / 2, yf = PACK.L / 2, r = 30;
		p.moveTo(...at2(-x, Y0));
		p.lineTo(...at2(x, Y0));
		p.quadraticCurveTo(...at2(x, yf), ...at2(x - r, yf));
		p.lineTo(...at2(-x + r, yf));
		p.quadraticCurveTo(...at2(-x, yf), ...at2(-x, Y0));
		p.closePath();
	};
	/** the case's bands, foot to top, as v2 drew them */
	const BANDS = /** @type {[number, number, string][]} */ ([[0, 16, FACE], [16, 94, CASE], [110, 2, SEAM], [112, 13, LID]]);
	// the release buttons in the shell's sides, and the drawer's catches behind them; from v7 the buttons on the face's
	// two ends and the catches just inside the shell's front, all at the base plate's level
	const REL = v >= 7 ? { y: Y0 - 18, z: 22, x: 182 } : { y: 150, z: 64, x: 0 };
	// from v9: where the columns begin (x), and where their catches meet the base plate (y)
	const PX = Wh - POST_9.w, CATCH_Y = Y0 - 14;
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

	if (v >= 8) {
		const F = FOOT_8;
		part('tray', { label: 'Shell', what: 'The pack’s outer shell: a foot (its floor tub and, across the face, a sill), walls, top and back in one smooth aluminium piece, open at the front above the sill where the service drawer slides in. It is what you carry and what the cube holds: the grip, the ClickLock and the two release buttons are all on it, in the sill.', specs: [['Outside', '460 × 480 × 125 mm'], ['Foot and sill', `${F} mm high`], ['Material', 'Aluminium, 3 mm, black anodised'], ['Corners', 'R 30 mm']] }, (put) => {
			for (const [z0, h, c] of /** @type {[number, number, string][]} */ ([[0, F, FACE], [F, 110 - F, CASE], [110, 2, SEAM], [112, 13, LID]])) put(prism(shellU(4), z0, h), c);
			put(prism(shellU(0), 0, F - 2), CASE); // its floor tub
			put(prism(shellU(0), H - 4, 4), LID); // its top
			put(prism(capD, 0, F), FACE); // the sill across the face
			if (v >= 9) {
				// its two front corner columns, up to the base plate's top: round at the corner like the case, inside the
				// walls behind the face
				for (const sx of [-1, 1]) put(prism(postP(sx), F - 1, POST_9.top - F + 1), FACE);
				put(box(0, Lh + 0.6, F, 2 * PX - 2, 1.4, 1.2), HOLE); // the line where the drawer sits on the sill
				for (const sx of [-1, 1]) {
					put(box(sx * PX, Lh + 0.6, (F + POST_9.top) / 2, 1.4, 1.4, POST_9.top - F), HOLE); // and beside each column
					put(box(sx * (PX + 8), Lh + 0.6, POST_9.top, 16, 1.4, 1.2), HOLE); // and over it
				}
			} else put(box(0, Lh + 0.6, F, W - 8, 1.4, 1.2), HOLE); // the line where the drawer sits on it
			for (const sx of [-1, 1]) put(box(sx * (Wh - 60), -15, -1, 20, LEN - 110, 3), DARK);
		});
		part('front', { label: 'Front plate', what: 'The upright of the service drawer’s L: the pack’s face above the sill, its round front corners and bands flush with the shell. A long finger pull along its foot and the charge strip along its top; nothing you carry by. The base plate is fixed to its foot.', specs: [['Size', `460 × 30 × ${H - F} mm`], ['Pull', 'Finger slot, 240 mm'], ['Material', 'Aluminium, black anodised']] }, (put) => {
			const Z = v >= 9 ? POST_9.top : F; // from v9 its two lower corners sit on the columns
			for (const [z0, h, c] of /** @type {[number, number, string][]} */ ([[Z, 110 - Z, CASE], [110, 2, SEAM], [112, 13, LID]])) put(prism(capD, z0, h), c);
			if (v >= 9) put(box(0, (Y0 + Lh) / 2, (F + Z) / 2, 2 * PX - 1, Lh - Y0, Z - F), CASE); // and between them down to the sill
			put(box(0, Lh + 1, 66, 380, 3, 68, 1), FACE);
			put(box(0, Lh + 1.2, F + 7, 240, 3, 8, 3), BLACK); // the finger pull's lip
			put(box(0, Lh + 1.6, F + 5.5, 228, 2.4, 4, 1), HOLE); // and the slot behind it
			for (const sx of [-1, 1]) put(box(sx * (Wh - 1.2), Y0 + 0.8, (Z + H) / 2, 3, 1.6, H - Z - 1), HOLE);
			put(box(0, Y0 + 0.8, H - 1, W - 4, 1.6, 3), HOLE);
		});
		part('base', { label: 'Base plate', what: 'The floor of the service drawer’s L, riding on the shell’s foot: every inner part is mounted on it, the cells’ holders, the contact plates, the clamp and the BMS. It runs on two low-friction strips and slides out over the sill.', specs: [['Size', '444 × 446 × 5 mm'], ['Material', 'Aluminium, 5 mm'], ['Runs on', '2 PTFE strips']] }, (put) => {
			// from v9 it runs between the shell's two columns, the cells' holders reaching out over them
			const bw = v >= 9 ? 2 * (PX - 2) : W - 16;
			put(box(0, (Y0 - Lh + 4) / 2, 5.5 + DZ, bw, Y0 + Lh - 4, 5, 1), STEEL);
			for (const sx of [-1, 1]) put(box(sx * (v >= 9 ? bw / 2 - 40 : Wh - 40), (Y0 - Lh + 4) / 2, 3.5 + DZ, 14, Y0 + Lh - 10, 1, 0.3), '#e8e8e4');
			if (v >= 9) for (const sx of [-1, 1]) put(box(sx * (bw / 2 - 2.5), CATCH_Y, 5.5 + DZ, 5.4, 9, 5.2), HOLE); // the catches' notches
		});
	} else if (v >= 6) {
		part('tray', { label: 'Shell', what: 'The pack’s outer shell: floor, walls, top and back in one smooth aluminium piece with round corners, open only at the front where the service drawer slides in. No lid and no latches any more: nothing opens but the drawer.', specs: [['Outside', '460 × 450 × 125 mm, the front plate makes 480'], ['Material', 'Aluminium, 3 mm, black anodised'], ['Corners', 'R 30 mm']] }, (put) => {
			for (const [z0, h, c] of BANDS) put(prism(shellU(4), z0, h), c);
			put(prism(shellU(0), 0, 3), CASE); // its floor
			put(prism(shellU(0), H - 4, 4), LID); // its top
			for (const sx of [-1, 1]) put(box(sx * (Wh - 60), -15, -1, 20, LEN - 110, 3), DARK);
		});
		part('front', { label: 'Front plate', what: 'The upright of the service drawer’s L: the pack’s whole face, its round front corners and bands flush with the shell. It carries the grip, the charge strip and the ClickLock; the base plate is fixed to its foot.', specs: [['Size', '460 × 30 × 125 mm'], ['Material', 'Aluminium, black anodised']] }, (put) => {
			for (const [z0, h, c] of BANDS) put(prism(capD, z0, h), c);
			put(box(0, Lh + 1, 62, 380, 3, 80, 1), FACE);
			// the fine dark line where it meets the shell, so the drawer reads as one
			for (const sx of [-1, 1]) put(box(sx * (Wh - 1.2), Y0 + 0.8, H / 2, 3, 1.6, H - 1), HOLE);
			put(box(0, Y0 + 0.8, H - 1, W - 4, 1.6, 3), HOLE);
		});
		part('base', { label: 'Base plate', what: 'The floor of the service drawer’s L: every inner part is mounted on it, the cells’ holders, the contact plates, the clamp and the BMS. It runs on the shell’s floor on two low-friction strips.', specs: [['Size', '444 × 446 × 5 mm'], ['Material', 'Aluminium, 5 mm'], ['Runs on', '2 PTFE strips']] }, (put) => {
			put(box(0, (Y0 - Lh + 4) / 2, 5.5, W - 16, Y0 + Lh - 4, 5, 1), STEEL);
			for (const sx of [-1, 1]) put(box(sx * (Wh - 40), (Y0 - Lh + 4) / 2, 3.5, 14, Y0 + Lh - 10, 1, 0.3), '#e8e8e4');
		});
	} else
	part('tray', { label: 'Case', what: 'The pack’s case: one smooth aluminium shell with round corners, its floor and four walls, a darker foot band, and rails under it to slide on.', specs: [['Outside', '460 × 480 × 112 mm'], ['Material', 'Aluminium, 3 mm, black anodised'], ['Corners', 'R 30 mm']] }, (put) => {
		put(slab(W, LEN, RC, 0, 5), CASE);
		put(slab(W, LEN, RC, 0, 16, 4), FACE); // the foot band
		put(slab(W, LEN, RC, 16, 94, 4), CASE);
		put(slab(W, LEN, RC, 110, 2, 3), SEAM); // the light seam under the lid
		for (const sx of [-1, 1]) put(box(sx * (Wh - 60), 0, -1, 20, LEN - 80, 3), DARK);
	});
	if (v < 6) part('front', { label: 'Front panel', what: 'The pack’s face, set into the case’s front: it carries the handles, the charge strip along its top' + (v < 3 ? ' and the terminals.' : '; its power and data leave by the plug in its back.'), specs: [['Size', '380 × 80 mm']] }, (put) => {
		put(box(0, Lh + 1, 62, 380, 3, 80, 1), FACE);
	});
	part('charge', { label: 'Charge strip', what: 'A slim LED strip along the top of its face, under the lid’s seam: ten segments light up with the pack’s state of charge.', specs: [['Length', '380 mm, 10 segments'], ['Shows', 'State of charge, 10 % a segment'], ['Fed by', 'The BMS']] }, (put) => {
		put(box(0, Lh + 0.5, 104, 386, 2, 7, 1), BLACK);
		for (let k = 0; k < 10; k++) put(box(-171 + k * 38, Lh + 1.5, 104, 34, 1.5, 4), k < CHARGE ? LED : LED_OFF);
	});
	if (v >= 8)
		part('handles', { label: 'Grip', what: 'One grip for one hand on the shell itself, in the middle of the sill across its foot: carry the pack by it and the shell takes the weight, never the drawer. Its trigger sits at the very height of the ClickLock’s pawls in the foot, so the two release cables run straight to them: close your fingers round it and the pawls pull back, so the pack slides out in the same move; let go and it clicks home again.', specs: [['Width', '150 mm, for a gloved hand'], ['Height', `Bar ${GRIP_Z} mm over the foot, trigger at ${lockZ(v)} mm: the lock’s height`], ['On', 'The shell’s sill'], ['Release', 'Trigger in the grip, ~20 N'], ['Carries', '~26 kg [inferred]']] }, (put) => {
			for (const sx of [-1, 1]) put(box(sx * 82, Lh + 14, GRIP_Z, 16, 28, 15, 5), DARK); // its two feet
			put(box(0, Lh + 30, GRIP_Z, 180, 16, 15, 6), DARK); // the bar
			put(box(0, Lh + 38.5, GRIP_Z + 3, 120, 1, 2, 0.4), '#d9dcde'); // its light line
		});
	else if (v >= 5)
		part('handles', { label: 'Grip', what: (v >= 7 ? 'One grip for one hand, down at the base plate’s level in the middle of its face, between the two release buttons:' : 'One grip for one hand, low on its face near the case’s foot:') + ' its trigger sits at the very height of the ClickLock’s pawls, so the two release cables run straight to them. Close your fingers round it and the trigger pulls both pawls back, so the pack slides out in the same move; let go and it clicks home again.', specs: [['Width', '150 mm, for a gloved hand'], ['Height', `Bar ${GRIP_Z} mm over the foot, trigger at ${lockZ(v)} mm: the lock’s height`], ['Release', 'Trigger in the grip, ~20 N'], ['Carries', '~26 kg [inferred]']] }, (put) => {
			for (const sx of [-1, 1]) put(box(sx * 82, Lh + 14, GRIP_Z, 16, 28, 34, 6), DARK); // its two feet
			put(box(0, Lh + 30, GRIP_Z, 180, 16, 30, 8), DARK); // the bar
			put(box(0, Lh + 38.5, GRIP_Z + 4, 120, 1, 2, 0.4), '#d9dcde'); // its light line
		});
	else if (v >= 4)
		part('handles', { label: 'Grip', what: 'One grip in the middle of its face, for one hand: close your fingers round it and its trigger pulls the ClickLock’s pawls back, so the pack slides out in the same move; let go and it clicks home again. The pack hangs balanced under it.', specs: [['Width', '150 mm, for a gloved hand'], ['Release', 'Trigger in the grip, ~20 N'], ['Carries', '~26 kg [inferred]']] }, (put) => {
			for (const sx of [-1, 1]) put(box(sx * 82, Lh + 14, 62, 16, 28, 34, 6), DARK); // its two feet
			put(box(0, Lh + 30, 62, 180, 16, 30, 8), DARK); // the bar
			put(box(0, Lh + 38.5, 66, 120, 1, 2, 0.4), '#d9dcde'); // its light line
		});
	else
	part('handles', { label: 'Handles', count: 2, what: 'Two handles on its face to slide it in and out: at ~26 kg one person lifts it.', specs: [['Mass', '~26 kg [inferred]']] }, (put) => {
		for (const sx of [-1, 1]) {
			for (const z of [38, 90]) put(cyl([sx * 175, Lh, z], [sx * 175, Lh + 28, z], 6, 10), DARK);
			put(cyl([sx * 175, Lh + 28, 35], [sx * 175, Lh + 28, 93], 7, 10), DARK);
		}
	});
	part('plates-bottom', { label: 'Bottom contact plates', count: 8, what: 'Copper plates under the cells, each joining a row’s minus poles to the next row’s, and the two end plates that go to the terminals.', specs: [['Material', 'Nickel-plated copper, 1.5 mm'], ['Joined by', 'Pressure, no welds']] }, (put) => {
		put(box(0, rowY(0), 9 + DZ, zone.w - 6, CELLS.pitch - 3, 1.5, 0.3), COPPER);
		for (let i = 1; i < CELLS.s - 1; i += 2) put(box(0, (rowY(i) + rowY(i + 1)) / 2, 9 + DZ, zone.w - 6, 2 * CELLS.pitch - 3, 1.5, 0.3), COPPER);
		put(box(0, rowY(CELLS.s - 1), 9 + DZ, zone.w - 6, CELLS.pitch - 3, 1.5, 0.3), COPPER);
	});
	part('holder-bottom', { label: 'Bottom cell holder', what: 'A plate of flame-retardant plastic with a socket for every cell’s foot: it keeps them 22 mm apart, air between them.', specs: [['Material', 'PC/ABS, UL94 V-0 [inferred]'], ['Pitch', '22 mm']] }, (put) => put(box(0, CELLS.y, 13 + DZ, zone.w, zone.l, 6, 1), HOLDER));
	part('cells', { label: '21700 cells', count: CELLS.s * CELLS.p, what: 'Cylindrical lithium-ion cells, 21 mm across and 70 mm high, 14 rows in series of 20 side by side. Each is held, not welded: a worn cell is pulled and a new one pushed in.', specs: [['Cell', '21700, 5 Ah, 3.7 V (NMC) [inferred]'], ['Pack', '14S20P: 51.8 V, 100 Ah, ~5.2 kWh'], ['Cells', '280']] }, (put) => {
		for (let i = 0; i < CELLS.s; i++) for (let j = 0; j < CELLS.p; j++) {
			put(cyl([colX(j), rowY(i), z0], [colX(j), rowY(i), top - 2], CELLS.r, seg), WRAP);
			if (seg > 6) put(cyl([colX(j), rowY(i), top - 2], [colX(j), rowY(i), top], CELLS.r - 2, seg), CAP);
		}
	});
	part('holder-top', { label: 'Top cell holder', what: 'The same plate over the cells’ heads, its openings leaving each pole bare for the contact plates.', specs: [['Material', 'PC/ABS, UL94 V-0 [inferred]']] }, (put) => put(box(0, CELLS.y, top - 6, zone.w, zone.l, 6, 1), HOLDER));
	part('plates-top', { label: 'Top contact plates', count: 7, what: 'Copper plates over the cells, each joining a row’s plus poles to the next row’s minus: with the bottom plates they put the 14 rows in series.', specs: [['Material', 'Nickel-plated copper, 1.5 mm'], ['Pressed by', 'The lid’s spring pad']] }, (put) => {
		for (let i = 0; i < CELLS.s - 1; i += 2) put(box(0, (rowY(i) + rowY(i + 1)) / 2, top + 1, zone.w - 6, 2 * CELLS.pitch - 3, 1.5, 0.3), COPPER);
	});
	part('bms', { label: 'Battery management system', what: 'The board behind the cells: a lead to each of the 14 rows, it balances them, keeps them within their voltage and temperature, and opens the pack if anything goes wrong.', specs: [['Rows', '14S, balanced'], ['Current', '100 A continuous [inferred]'], ['Talks', 'CAN to the inverter']] }, (put) => {
		const y = rowY(CELLS.s - 1) + 60;
		put(box(0, y, 50 + DZ, 400, 80, 3, 0.5), PCB);
		for (const x of [-140, -60, 30, 110]) put(box(x, y, 54 + DZ, 34, 26, 5, 0.5), BLACK);
		put(box(170, y, 62 + DZ, 50, 40, 22, 2), DARK); // the contactor
		for (let i = 0; i < CELLS.s; i += 3) put(cyl([-180 + i * 6, y - 40, 52 + DZ], [-180 + i * 6, rowY(i), top + 3], 1.2, 4), RED); // sense leads
	});
	if (v < 3)
		part('terminals', { label: 'Terminals', count: 2, what: 'The pack’s plus and minus on its face, under their covers, and the data plug for the BMS beside them.', specs: [['Connectors', 'Anderson-type, 120 A [inferred]'], ['Data', 'CAN, RJ45']] }, (put) => {
			put(cyl([90, Lh, 55], [90, Lh + 16, 55], 13, 16), RED);
			put(cyl([140, Lh, 55], [140, Lh + 16, 55], 13, 16), BLACK);
			put(box(-110, Lh + 3, 55, 26, 4, 20, 2), '#d9d9d9');
		});
	else if (v >= 7)
		part('terminals', { label: 'Back socket', what: 'The pack’s plus, minus and data in one socket flush in its back, nothing sticking out. Its contacts sit at the bottom of pockets that take the cube’s insulating collars: the collars slide in first, then the pins meet their contacts, so no metal is ever open to a finger on either side. Two lined guide holes take the cube’s guide pins first: slide the pack in and it plugs itself into the backplane; pull it out and it lets go.', specs: [['Power', '2 pockets ⌀ 19 mm, sockets for ⌀ 8 mm pins, 120 A [inferred]'], ['Data', 'CAN, 4 sockets in one pocket'], ['Guides', '2 lined holes, ⌀ 11 mm, for ⌀ 10 mm pins'], ['Touch', 'Finger-safe, IP2X']] }, (put) => {
			const yb = -Lh - 2; // the socket's face, 2 mm proud of the case's back
			put(box(0, -Lh - 1, 58, 170, 2, 46, 1), BLACK);
			/** a hole: its lining ring a little wider, its dark inside over it @param {number} x @param {number} z @param {number} r @param {string} ring */
			const hole = (x, z, r, ring) => {
				put(cyl([x, yb, z], [x, yb - 0.4, z], r + 2, 16), ring);
				put(cyl([x, yb - 0.4, z], [x, yb - 0.6, z], r, 16), HOLE);
			};
			for (const x of [-45, 45]) {
				hole(x, 58, 9.5, FACE); // the collar's pocket
				put(cyl([x, yb - 0.6, 58], [x, yb - 0.8, 58], 4.5, 12), x < 0 ? RED : COPPER); // the contact, deep inside
			}
			const dz = v >= 8 ? 58 : 72; // from v8 in one line with the power and guide holes
			put(box(0, yb - 0.2, dz, 50, 0.4, 16, 2), FACE); // the data pocket
			put(box(0, yb - 0.5, dz, 45, 0.4, 13, 2), HOLE);
			for (let k = 0; k < 4; k++) put(cyl([-12 + k * 8, yb - 0.7, dz], [-12 + k * 8, yb - 0.9, dz], 1.6, 8), CAP);
			for (const sx of [-1, 1]) {
				put(cyl([sx * 150, -Lh, 58], [sx * 150, -Lh - 1.5, 58], 11, 16), BLACK); // its boss, flush
				hole(sx * 150, 58, 5.5, STEEL);
			}
		});
	else if (v >= 5)
		part('terminals', { label: 'Back socket', what: 'The pack’s plus, minus and data in one socket flush in its back: proper holes, nothing sticking out. Two lined guide holes take the cube’s guide pins first, then its two power pins and four data pins slide into their sockets: slide the pack in and it plugs itself into the backplane; pull it out and it lets go. With nothing proud on its back, it stands on any shelf and no contact gets bent.', specs: [['Power', '2 sockets for ⌀ 8 mm pins, 120 A [inferred]'], ['Data', 'CAN, 4 sockets'], ['Guides', '2 lined holes, ⌀ 11 mm, for ⌀ 10 mm pins']] }, (put) => {
			const yb = -Lh - 2; // the socket's face, 2 mm proud of the case's back
			put(box(0, -Lh - 1, 58, 170, 2, 46, 1), BLACK);
			/** a hole: its lining ring a little wider, its dark inside over it @param {number} x @param {number} z @param {number} r @param {string} ring */
			const hole = (x, z, r, ring) => {
				put(cyl([x, yb, z], [x, yb - 0.4, z], r + 2, 16), ring);
				put(cyl([x, yb - 0.4, z], [x, yb - 0.6, z], r, 16), HOLE);
			};
			for (const x of [-45, 45]) hole(x, 58, 6, x < 0 ? RED : COPPER);
			for (let k = 0; k < 4; k++) hole(-12 + k * 8, 72, 1.6, CAP);
			for (const sx of [-1, 1]) {
				put(cyl([sx * 150, -Lh, 58], [sx * 150, -Lh - 1.5, 58], 11, 16), BLACK); // its boss, flush
				hole(sx * 150, 58, 5.5, STEEL);
			}
		});
	else
		part('terminals', { label: 'Back plug', what: 'The pack’s plus, minus and data in one blind-mate plug in its back, between two guide pins: slide the pack in and it plugs itself into the cube’s backplane; pull it out by its handles and it lets go. No cables, no bolts.', specs: [['Power', '2 × 120 A blade contacts [inferred]'], ['Data', 'CAN, 4 pins'], ['Guides', '2 pins, ⌀ 10 mm']] }, (put) => {
		put(box(0, -Lh - 3, 58, 170, 6, 46, 1), BLACK);
		for (const x of [-45, 45]) put(box(x, -Lh - 7, 58, 34, 3, 12), x < 0 ? RED : COPPER);
		put(box(0, -Lh - 7, 58, 22, 3, 10), CAP);
		for (const sx of [-1, 1]) put(cyl([sx * 150, -Lh, 58], [sx * 150, -Lh - 12, 58], 5, 10), STEEL);
	});
	if (v === 3)
		part('clicklock', { ...CLICKLOCK, what: `${CLICKLOCK.what} In a BatteryCube the pawls click in just as its back plug meets the backplane.` }, (put) => clickLatch(box, put, { half: Wh, face: Lh, z: 10, tabZ: 24 }));
	// from v4 the ClickLock shows every piece: pawls, springs, pivots, cables and the grip's trigger
	if (v >= 5) for (const [id, info, draw] of clickLockPieces(box, cyl, { half: Wh, face: Lh, z: lockZ(v), back: lockBack(v), grip: [0, Lh + 22, lockZ(v)], straight: true })) part(id, info, draw);
	else if (v >= 4) for (const [id, info, draw] of clickLockPieces(box, cyl, { half: Wh, face: Lh, z: 10, grip: [0, Lh + 22, 52] })) part(id, info, draw);
	if (v >= 6) {
		part('clamp', { label: 'Clamp', what: 'A stiff plate on four posts over the cells, its spring pad pressing every top contact plate onto its poles: the job the lid did, now on the drawer, so the cells stay pressed when it comes out.', specs: [['Pad', 'Silicone foam, ~0.2 MPa [inferred]'], ['Posts', '4, from the base plate']] }, (put) => {
			put(box(0, CELLS.y, top + 8, zone.w - 10, zone.l - 10, 4, 2), STEEL);
			put(box(0, CELLS.y, top + 4, zone.w - 14, zone.l - 14, 4, 1), '#d8d1bf');
			for (const sx of [-1, 1]) for (const sy of [-1, 1]) put(cyl([sx * (zone.w / 2 - 4), CELLS.y + sy * (zone.l / 2 - 4), 8 + DZ], [sx * (zone.w / 2 - 4), CELLS.y + sy * (zone.l / 2 - 4), top + 10], 3, 8), STEEL);
		});
		part('inner-plug', { label: 'Inner plug', what: 'At the back of the drawer: the BMS’s plus, minus and data in one plug that slides onto the inside of the shell’s back socket as the drawer goes home.', specs: [['Power', '2 × 120 A [inferred]'], ['Data', 'CAN']] }, (put) => {
			put(box(0, -Lh + 14, 40 + DZ, 150, 12, 30, 1), BLACK);
		});
		for (const [sx, side] of /** @type {const} */ ([[-1, 'left'], [1, 'right']])) {
			if (v >= 9) {
				// on the column's face, in the flat between the drawer and the round corner, at the base plate's level
				const bx = sx * (PX + 8), bz = 18, cz = 5.5 + DZ;
				part(`release-${side}`, { label: `Release button, ${side}`, what: 'A round push button in the face of the shell’s corner column on its side, at the base plate’s level: part of the shell, so it stays put while the drawer comes out. Behind it a short plunger with a wedge runs back inside the column and pushes the catch’s bolt out of its notch in the base plate. Press both, pull the drawer by its finger pull, and the whole inside slides out between the columns.', specs: [['Button', '⌀ 10 mm, 4 mm travel'], ['On', 'The shell’s corner column'], ['Force', '~10 N each [inferred]']] }, (put) => {
					put(cyl([bx, Lh + 0.2, bz], [bx, Lh + 1, bz], 7, 18), STEEL);
					put(cyl([bx, Lh - 4, bz], [bx, Lh + 2.4, bz], 5, 18), '#3a3f44');
					put(cyl([bx, Lh - 6, bz], [bx, CATCH_Y + 6, bz], 1.8, 6), STEEL); // the plunger
					put(box(bx, CATCH_Y + 4, (bz + cz) / 2, 6, 6, cz - bz + 6, 0.5), STEEL); // its wedge on the bolt's collar
				});
				part(`catch-${side}`, { label: `Drawer catch, ${side}`, what: 'A spring bolt lying across inside the shell’s corner column, at the base plate’s height: its spring pushes its tip into a notch in the base plate’s edge and holds the drawer in. The button’s wedge pushes it back out; slide the drawer home and the bolt clicks in again on its own.', specs: [['Bolt', 'Stainless, ⌀ 6 mm, 5 mm travel'], ['Spring', 'Compression, ~12 N [inferred]'], ['In', 'The shell’s corner column']] }, (put) => {
					put(cyl([sx * (PX - 4.5), CATCH_Y, cz], [sx * (Wh - 8), CATCH_Y, cz], 2.5, 12), STEEL);
					put(cyl([sx * (PX + 9), CATCH_Y, cz], [sx * (PX + 11), CATCH_Y, cz], 3.5, 12), STEEL); // its collar
					for (let k = 0; k < 5; k++) put(cyl([sx * (PX + 13 + k * 4), CATCH_Y, cz], [sx * (PX + 14 + k * 4), CATCH_Y, cz], 3.4, 10), '#b8bdc0'); // its spring
				});
				continue;
			}
			if (v >= 8) {
				const bx = sx * (Wh - 26), bz = FOOT_8 / 2;
				part(`release-${side}`, { label: `Release button, ${side}`, what: 'A round push button in the shell’s sill, at its outer end on the face: part of the shell, so it stays put while the drawer comes out. A short rod behind it pulls the drawer’s catch on that side down. Press both, pull the drawer by its finger pull, and the whole inside slides out over the sill.', specs: [['Button', '⌀ 13 mm, 4 mm travel'], ['On', 'The shell’s sill'], ['Force', '~10 N each [inferred]']] }, (put) => {
					put(cyl([bx, Lh + 0.2, bz], [bx, Lh + 1, bz], 8.5, 18), STEEL);
					put(cyl([bx, Lh - 4, bz], [bx, Lh + 2.6, bz], 6.2, 18), '#3a3f44');
					put(cyl([bx, Lh - 6, bz], [sx * (Wh - 30), Y0 - 16, FOOT_8 - 4], 1.6, 6), STEEL); // its rod to the catch
				});
				part(`catch-${side}`, { label: `Drawer catch, ${side}`, what: 'A spring-steel tongue in the shell’s foot, just behind the sill: its hook springs up into a notch under the drawer’s base plate and holds the drawer in. The button on its side pulls it down.', specs: [['Tongue', 'Spring steel, 1 mm'], ['Hook', '8 × 6 mm'], ['On', 'The shell’s foot']] }, (put) => {
					put(box(sx * (Wh - 30), Y0 - 26, FOOT_8 - 3, 10, 24, 2, 0.4), STEEL);
					put(box(sx * (Wh - 30), Y0 - 16, FOOT_8 + 1.5, 8, 6, 7, 0.8), STEEL);
				});
				continue;
			}
			if (v >= 7) {
				part(`release-${side}`, { label: `Release button, ${side}`, what: 'A round push button low on the face, at its left or right end, level with the base plate. A short rod behind it pulls the drawer’s spring catch on that side in, out of its hole in the shell. Press both, pull the grip, and the drawer slides out: everything from the front.', specs: [['Button', '⌀ 16 mm, 4 mm travel'], ['Force', '~10 N each [inferred]']] }, (put) => {
					put(cyl([sx * REL.x, Lh + 0.2, REL.z], [sx * REL.x, Lh + 1, REL.z], 11, 18), STEEL);
					put(cyl([sx * REL.x, Lh - 4, REL.z], [sx * REL.x, Lh + 3, REL.z], 8, 18), '#3a3f44');
					put(cyl([sx * REL.x, Lh - 6, REL.z], [sx * (Wh - 10), REL.y + 4, REL.z], 1.8, 6), STEEL); // its rod to the catch
				});
				part(`catch-${side}`, { label: `Drawer catch, ${side}`, what: 'A spring-steel tongue on the base plate, just inside the shell’s front: its knob springs out into a hole in the shell’s side and holds the drawer in. The front button on its side pulls it back.', specs: [['Tongue', 'Spring steel, 1 mm'], ['Knob', '⌀ 8 mm']] }, (put) => {
					put(box(sx * (Wh - 9), REL.y, (8 + REL.z) / 2 + 1, 2, 14, REL.z - 6, 0.5), STEEL);
					put(cyl([sx * (Wh - 10), REL.y, REL.z], [sx * (Wh + 0.6), REL.y, REL.z], 4, 12), STEEL);
				});
				continue;
			}
			part(`release-${side}`, { label: `Release button, ${side}`, what: 'A round push button flush in the shell’s side. Press both at once and they push the drawer’s two spring catches back inside, out of their holes; pull the grip and the drawer slides out. In a cube the buttons face the rails, so the drawer can only come out of a pack that is out.', specs: [['Button', '⌀ 16 mm, 4 mm travel'], ['Force', '~10 N each [inferred]']] }, (put) => {
				put(cyl([sx * (Wh + 0.2), REL.y, REL.z], [sx * (Wh + 1), REL.y, REL.z], 11, 18), STEEL);
				put(cyl([sx * (Wh - 4), REL.y, REL.z], [sx * (Wh + 2.5), REL.y, REL.z], 8, 18), '#3a3f44');
			});
			part(`catch-${side}`, { label: `Drawer catch, ${side}`, what: 'A spring-steel tongue standing up from the base plate: its knob springs out into a hole in the shell’s side and holds the drawer in. Its release button pushes it back.', specs: [['Tongue', 'Spring steel, 1 mm'], ['Knob', '⌀ 10 mm']] }, (put) => {
				put(box(sx * (Wh - 7), REL.y, (8 + REL.z) / 2 + 2, 2, 14, REL.z - 4, 0.5), STEEL);
				put(cyl([sx * (Wh - 8), REL.y, REL.z], [sx * (Wh - 4), REL.y, REL.z], 5, 12), STEEL);
			});
		}
	} else {
	part('lid', { label: 'Lid', what: 'The lid, its round corners and soft edge flush with the case, and the spring pad under it: closing it presses every contact plate onto its poles, the whole pack’s only joining force.', specs: [['Pad', 'Silicone foam, ~0.2 MPa [inferred]'], ['Corners', 'R 30 mm']] }, (put) => {
		put(slab(W, LEN, RC, H - 13, 13, 0, 5), LID);
		put(box(0, CELLS.y, H - 19, zone.w - 10, zone.l - 10, 10, 2), '#d8d1bf');
	});
	part('latches', { label: 'Latches', count: 4, what: 'Four flush over-centre latches, two a side: flip them and the lid lifts. No tool opens the pack.', specs: [['Type', 'Over-centre, flush']] }, (put) => {
		for (const sx of [-1, 1]) for (const y of [-120, 120]) put(box(sx * (Wh + 1.5), y, H - 16, 4, 36, 22, 1.5), FACE);
	});
	}
}

/** The BatteryPack on its own (version `v`), every part its own: drawn apart, built step by step. @returns {Cast} */
export function batteryPack(v = 9) {
	const assemblies = v >= 9 ? ASSEMBLIES_9 : v >= 8 ? ASSEMBLIES_8 : v >= 6 ? ASSEMBLIES_6 : ASSEMBLIES;
	const kit = machineKit(assemblies);
	const steps = v >= 9 ? STEPS_9 : v >= 8 ? STEPS_8 : v >= 6 ? STEPS_6 : STEPS;
	batteryPackParts(kit, { at: [0, 0, 0], base: 'base', v });
	const built = kit.build();
	const r = rig([{ name: 'base', at: [0, 0, 0] }, ...built.bones], built.pieces, [skin(0.55, { side: THREE.DoubleSide })]);
	r.object.name = 'BatteryPack';
	/** @type {Cast} */
	const cast = {
		rig: r,
		clips: {
			off: () => ({}),
			explode: (t) => {
				const u = loop(t, 8);
				const k = ease(Math.min(1, Math.max(0, (u - 0.05) / 0.3))) - ease(Math.min(1, Math.max(0, (u - 0.65) / 0.3)));
				return kit.explode(built.centre, k, {});
			},
			assemble: (t) => {
				const n = steps.length, period = n * 2.6 + 3;
				const u = Math.min(1, loop(t, period) * (period / (n * 2.6)));
				return kit.assemble(built.centre, u, n, {});
			}
		},
		poses: { off: {}, exploded: kit.explode(built.centre, 1, {}), ...(v >= 6 ? { 'drawer out': service(built.catalogParts, DRAWER_OUT, 0, 1, v) } : {}) },
		first: v >= 6 ? 'service' : 'explode',
		catalog: { assemblies, parts: built.catalogParts, steps, sources: [] }
	};
	if (v >= 6) {
		const parts = built.catalogParts;
		const s = (/** @type {number} */ u, /** @type {number} */ a, /** @type {number} */ b) => ease(Math.min(1, Math.max(0, (u - a) / (b - a))));
		// from v6: press both buttons, pull the drawer out by its grip, hold it out for service, push it home: the catches click
		cast.clips.service = (t) => {
			const u = loop(t, 10) * 10; // seconds into its 10 s
			const press = s(u, 0.4, 0.8) - s(u, 1.6, 1.9);
			const out = DRAWER_OUT * (s(u, 1.0, 3.6) - s(u, 6.2, 8.8));
			return service(parts, out, press, out < 0.02 ? press : 1, v);
		};
	}
	return cast;
}

/**
 * A pose of the pack from v6: the drawer `out` metres out, the release buttons pressed in by `press` (0…1), and the
 * drawer's catches in by `catches` (held in by the shell's walls while the drawer is out).
 * @param {import('./parts.js').PartInfo[]} parts @param {number} out @param {number} press @param {number} [catches] @param {number} [v]
 * @returns {import('./rig').Pose}
 */
function service(parts, out, press, catches = press, v = 9) {
	/** @type {import('./rig').Pose} */
	const p = {};
	const shell = onShell(v);
	for (const { id } of parts) {
		const inward = id.endsWith('left') ? 1 : -1;
		// from v8 the buttons and the catches are the shell's: the buttons pressed in, the catches pulled down
		if (v >= 8 && id.startsWith('release-')) p[`p.${id}`] = [0, 0, 0, 1, 0, 0, -press * 0.004];
		// from v9 the catches are bolts across the columns: pushed out of their notches, sideways
		else if (v >= 9 && id.startsWith('catch-')) p[`p.${id}`] = [0, 0, 0, 1, -inward * catches * 0.005, 0, 0];
		else if (v >= 8 && id.startsWith('catch-')) p[`p.${id}`] = [0, 0, 0, 1, 0, -catches * 0.005, 0];
		// from v7 the buttons are on the face: pressed in (backwards), and out with the drawer
		else if (id.startsWith('release-')) p[`p.${id}`] = v >= 7 ? [0, 0, 0, 1, 0, 0, out - press * 0.004] : [0, 0, 0, 1, inward * press * 0.004, 0, 0];
		else if (!shell.includes(id)) p[`p.${id}`] = [0, 0, 0, 1, id.startsWith('catch-') ? inward * catches * 0.004 : 0, 0, out];
	}
	return p;
}
