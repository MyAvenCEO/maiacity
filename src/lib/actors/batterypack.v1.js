/* v1 of the BatteryPack, frozen 2026-10-13: its first square case (v2 rounds it and adds the charge strip).
 *
 * THE BATTERYPACK — our own modular, repairable battery (Samuel 2026-10-13): a rack module 460 × 480 × 125 mm of 280
 * cylindrical 21700 cells (14 in series, 20 in parallel: 51.8 V, 100 Ah, about 5.2 kWh, ~26 kg), held in two holder
 * plates and joined by copper contact plates that its lid presses onto them: no welds, no glue. Undo the latches,
 * lift the lid, and any cell, plate or the BMS comes out on its own and a new one goes in; nothing is thrown away
 * for one worn cell. Four of them fill a BatteryCube (./batterycube.js) to the top.
 *
 * Built in its own frame: its foot's middle at the origin, its front (the handles, terminals and state of charge)
 * towards +z; in mm through `L` (x across, y along to the front, z up). Its figures are inferred from common 21700
 * cells (5 Ah, 3.7 V) and rack modules; its cards say so. `batteryPackParts` adds one to any machine's kit.
 */
import * as THREE from 'three';
import { loop, rig, skin } from './rig';
import { block, ease } from './excavator-rig.js';
import { machineKit } from './parts.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Cast} Cast */
/** @typedef {[number, number, number]} MM a point of the pack: x across, y forward, z up (mm) */

const S = 0.001;
/** the pack's size (mm): W across, L front to back, H high */
export const PACK = { W: 460, L: 480, H: 125 };
/** its cells: 14 rows in series (along y) of 20 in parallel (along x), 22 mm apart, standing; their zone's middle */
const CELLS = { s: 14, p: 20, pitch: 22, r: 10.5, h: 70, z0: 16, y: -55 };
const SRC = 'BatteryPack (our design)';
const CASE = '#3a4046', LID = '#c5cacc', HOLDER = '#1b1d1f', WRAP = '#2f6fb5', CAP = '#c9ccce', COPPER = '#c27a43', PCB = '#2c7a4a', DARK = '#202326', RED = '#c8372d', BLACK = '#161718', LED = '#3ddc84', STEEL = '#8d9396';

/** its assemblies, as the pack on its own shows them drawn apart */
const ASSEMBLIES = /** @type {import('./parts.js').Assembly[]} */ ([
	{ id: 'case', label: 'Case', note: 'An aluminium tray with its front panel and handles: the pack slides into a rack or a BatteryCube by them.', out: [0, -0.12, 0] },
	{ id: 'cells', label: 'Cells', note: '280 cylindrical 21700 cells standing in two holder plates, 14 rows in series of 20 side by side.', out: [0, 0.12, 0] },
	{ id: 'contacts', label: 'Contact plates', note: 'Copper plates top and bottom that join each row to the next: pressed on, not welded, so every cell comes out again.', out: [0, 0.3, 0] },
	{ id: 'electronics', label: 'BMS and terminals', note: 'The battery management system that watches every row, the main terminals and the state-of-charge lights.', out: [0, 0.15, 0.3] },
	{ id: 'lid', label: 'Lid', note: 'The lid with its spring pad that presses the contacts home, held by four latches: open them and the pack is open.', out: [0, 0.5, 0] }
]);
const STEPS = ['Lay out the tray, its front panel and handles', 'Set the bottom contact plates and holder, and stand the 280 cells in it', 'Press on the top holder and the top contact plates', 'Fit the BMS, its sense leads and the terminals', 'Close the lid on its spring pad and snap the four latches'];
const STEP = /** @type {Record<string, number>} */ ({ tray: 1, front: 1, handles: 1, 'plates-bottom': 2, 'holder-bottom': 2, cells: 2, 'holder-top': 3, 'plates-top': 3, bms: 4, terminals: 4, lid: 5, latches: 5 });
const GROUP = /** @type {Record<string, string>} */ ({ tray: 'case', front: 'case', handles: 'case', 'plates-bottom': 'contacts', 'holder-bottom': 'cells', cells: 'cells', 'holder-top': 'cells', 'plates-top': 'contacts', bms: 'electronics', terminals: 'electronics', lid: 'lid', latches: 'lid' });

/**
 * Add a BatteryPack's parts to a machine's kit, its foot's middle at `at` (actor metres), its front towards +z.
 * `assembly` and `step` say where each part goes in the machine's catalog; with `unit`, the pack arrives whole.
 * `seg`: the sides of a cell (fewer where many packs stand closed).
 * @param {ReturnType<typeof machineKit>} kit
 * @param {{ at: V3, base: string, assembly?: (g: string) => string, step?: (p: string) => number, prefix?: string, unit?: string, seg?: number }} o
 */
export function batteryPackParts(kit, { at, base, assembly = (g) => g, step = (p) => STEP[p], prefix = '', unit, seg = 10 }) {
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
	const { W, L: LEN, H } = PACK;
	const Wh = W / 2, Lh = LEN / 2;
	const rowY = (/** @type {number} */ i) => CELLS.y + (i - (CELLS.s - 1) / 2) * CELLS.pitch;
	const colX = (/** @type {number} */ j) => (j - (CELLS.p - 1) / 2) * CELLS.pitch;
	const zone = { w: CELLS.p * CELLS.pitch + 6, l: CELLS.s * CELLS.pitch + 6 };
	const top = CELLS.z0 + CELLS.h;
	/** @param {string} p @param {Omit<import('./parts.js').PartInfo, 'assembly' | 'step' | 'id'>} info @param {(put: (geo: THREE.BufferGeometry, color: string) => void) => void} make */
	const part = (p, info, make) => kit.part({ ...info, id: `${prefix}${p}`, assembly: assembly(GROUP[p]), step: step(p), source: SRC, ...(unit ? { unit } : {}) }, base, make);

	part('tray', { label: 'Tray', what: 'The pack’s aluminium tray: a floor and four walls the holders sit in, with ribs under it to slide on rails.', specs: [['Outside', '460 × 480 × 112 mm'], ['Material', 'Aluminium, 2 mm, anodised']] }, (put) => {
		put(box(0, 0, 2.5, W, LEN, 5), CASE);
		for (const sx of [-1, 1]) put(box(sx * (Wh - 2), 0, 58, 4, LEN, 106), CASE);
		put(box(0, -Lh + 2, 58, W, 4, 106), CASE);
		for (const sx of [-1, 1]) put(box(sx * (Wh - 30), 0, -1, 20, LEN - 20, 3), DARK);
	});
	part('front', { label: 'Front panel', what: 'The pack’s face: it closes the tray’s front and carries the handles, the terminals and the state-of-charge lights.', specs: [['Size', '460 × 125 mm']] }, (put) => {
		put(box(0, Lh - 3, H / 2, W, 6, H, 2), DARK);
		for (let k = 0; k < 5; k++) put(box(-60 + k * 16, Lh + 1, 96, 10, 3, 6, 1), LED);
	});
	part('handles', { label: 'Handles', count: 2, what: 'Two handles on its face to slide it in and out: at ~26 kg one person lifts it.', specs: [['Mass', '~26 kg [inferred]']] }, (put) => {
		for (const sx of [-1, 1]) {
			for (const z of [35, 95]) put(cyl([sx * 205, Lh, z], [sx * 205, Lh + 32, z], 6, 8), STEEL);
			put(cyl([sx * 205, Lh + 32, 32], [sx * 205, Lh + 32, 98], 7, 8), STEEL);
		}
	});
	part('plates-bottom', { label: 'Bottom contact plates', count: 8, what: 'Copper plates under the cells, each joining a row’s minus poles to the next row’s, and the two end plates that go to the terminals.', specs: [['Material', 'Nickel-plated copper, 1.5 mm'], ['Joined by', 'Pressure, no welds']] }, (put) => {
		put(box(0, rowY(0), 9, zone.w - 6, CELLS.pitch - 3, 1.5, 0.3), COPPER);
		for (let i = 1; i < CELLS.s - 1; i += 2) put(box(0, (rowY(i) + rowY(i + 1)) / 2, 9, zone.w - 6, 2 * CELLS.pitch - 3, 1.5, 0.3), COPPER);
		put(box(0, rowY(CELLS.s - 1), 9, zone.w - 6, CELLS.pitch - 3, 1.5, 0.3), COPPER);
	});
	part('holder-bottom', { label: 'Bottom cell holder', what: 'A plate of flame-retardant plastic with a socket for every cell’s foot: it keeps them 22 mm apart, air between them.', specs: [['Material', 'PC/ABS, UL94 V-0 [inferred]'], ['Pitch', '22 mm']] }, (put) => put(box(0, CELLS.y, 13, zone.w, zone.l, 6, 1), HOLDER));
	part('cells', { label: '21700 cells', count: CELLS.s * CELLS.p, what: 'Cylindrical lithium-ion cells, 21 mm across and 70 mm high, 14 rows in series of 20 side by side. Each is held, not welded: a worn cell is pulled and a new one pushed in.', specs: [['Cell', '21700, 5 Ah, 3.7 V (NMC) [inferred]'], ['Pack', '14S20P: 51.8 V, 100 Ah, ~5.2 kWh'], ['Cells', '280']] }, (put) => {
		for (let i = 0; i < CELLS.s; i++) for (let j = 0; j < CELLS.p; j++) {
			put(cyl([colX(j), rowY(i), CELLS.z0], [colX(j), rowY(i), top - 2], CELLS.r, seg), WRAP);
			if (seg > 6) put(cyl([colX(j), rowY(i), top - 2], [colX(j), rowY(i), top], CELLS.r - 2, seg), CAP);
		}
	});
	part('holder-top', { label: 'Top cell holder', what: 'The same plate over the cells’ heads, its openings leaving each pole bare for the contact plates.', specs: [['Material', 'PC/ABS, UL94 V-0 [inferred]']] }, (put) => put(box(0, CELLS.y, top - 6, zone.w, zone.l, 6, 1), HOLDER));
	part('plates-top', { label: 'Top contact plates', count: 7, what: 'Copper plates over the cells, each joining a row’s plus poles to the next row’s minus: with the bottom plates they put the 14 rows in series.', specs: [['Material', 'Nickel-plated copper, 1.5 mm'], ['Pressed by', 'The lid’s spring pad']] }, (put) => {
		for (let i = 0; i < CELLS.s - 1; i += 2) put(box(0, (rowY(i) + rowY(i + 1)) / 2, top + 1, zone.w - 6, 2 * CELLS.pitch - 3, 1.5, 0.3), COPPER);
	});
	part('bms', { label: 'Battery management system', what: 'The board behind the cells: a lead to each of the 14 rows, it balances them, keeps them within their voltage and temperature, and opens the pack if anything goes wrong.', specs: [['Rows', '14S, balanced'], ['Current', '100 A continuous [inferred]'], ['Talks', 'CAN to the inverter']] }, (put) => {
		const y = rowY(CELLS.s - 1) + 60;
		put(box(0, y, 50, 400, 80, 3, 0.5), PCB);
		for (const x of [-140, -60, 30, 110]) put(box(x, y, 54, 34, 26, 5, 0.5), BLACK);
		put(box(170, y, 62, 50, 40, 22, 2), DARK); // the contactor
		for (let i = 0; i < CELLS.s; i += 3) put(cyl([-180 + i * 6, y - 40, 52], [-180 + i * 6, rowY(i), top + 3], 1.2, 4), RED); // sense leads
	});
	part('terminals', { label: 'Terminals', count: 2, what: 'The pack’s plus and minus on its face, under their covers, and the data plug for the BMS beside them.', specs: [['Connectors', 'Anderson-type, 120 A [inferred]'], ['Data', 'CAN, RJ45']] }, (put) => {
		put(cyl([90, Lh, 55], [90, Lh + 22, 55], 13, 12), RED);
		put(cyl([140, Lh, 55], [140, Lh + 22, 55], 13, 12), BLACK);
		put(box(-110, Lh + 2, 55, 26, 6, 20, 2), '#d9d9d9');
	});
	part('lid', { label: 'Lid', what: 'The aluminium lid and the spring pad under it: closing it presses every contact plate onto its poles, the whole pack’s only joining force.', specs: [['Pad', 'Silicone foam, ~0.2 MPa [inferred]']] }, (put) => {
		put(box(0, 0, H - 2, W, LEN, 4), LID);
		put(box(0, CELLS.y, H - 9, zone.w - 10, zone.l - 10, 10, 2), '#d8d1bf');
	});
	part('latches', { label: 'Latches', count: 4, what: 'Four over-centre latches, two a side: flip them and the lid lifts. No tool opens the pack.', specs: [['Type', 'Over-centre, stainless']] }, (put) => {
		for (const sx of [-1, 1]) for (const y of [-120, 120]) put(box(sx * (Wh + 3), y, H - 18, 6, 40, 30, 2), STEEL);
	});
}

/** The BatteryPack on its own, every part its own: drawn apart, built step by step. @returns {Cast} */
export function batteryPack() {
	const kit = machineKit(ASSEMBLIES);
	batteryPackParts(kit, { at: [0, 0, 0], base: 'base' });
	const built = kit.build();
	const r = rig([{ name: 'base', at: [0, 0, 0] }, ...built.bones], built.pieces, [skin(0.55, { side: THREE.DoubleSide })]);
	r.object.name = 'BatteryPack';
	return {
		rig: r,
		clips: {
			off: () => ({}),
			explode: (t) => {
				const u = loop(t, 8);
				const k = ease(Math.min(1, Math.max(0, (u - 0.05) / 0.3))) - ease(Math.min(1, Math.max(0, (u - 0.65) / 0.3)));
				return kit.explode(built.centre, k, {});
			},
			assemble: (t) => {
				const n = STEPS.length, period = n * 2.6 + 3;
				const u = Math.min(1, loop(t, period) * (period / (n * 2.6)));
				return kit.assemble(built.centre, u, n, {});
			}
		},
		poses: { off: {}, exploded: kit.explode(built.centre, 1, {}) },
		first: 'explode',
		catalog: { assemblies: ASSEMBLIES, parts: built.catalogParts, steps: STEPS, sources: [] }
	};
}
