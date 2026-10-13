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
const STEPS = ['Lay out the tray, its front panel, handles and ClickLock', 'Set the bottom contact plates and holder, and stand the 280 cells in it', 'Press on the top holder and the top contact plates', 'Fit the BMS, its sense leads and the back plug', 'Close the lid on its spring pad and snap the four latches'];
const STEP = /** @type {Record<string, number>} */ ({ tray: 1, front: 1, charge: 1, handles: 1, clicklock: 1, 'lock-pawls': 1, 'lock-springs': 1, 'lock-pivots': 1, 'lock-cables': 1, 'lock-trigger': 1, 'plates-bottom': 2, 'holder-bottom': 2, cells: 2, 'holder-top': 3, 'plates-top': 3, bms: 4, terminals: 4, lid: 5, latches: 5 });
const GROUP = /** @type {Record<string, string>} */ ({ tray: 'case', front: 'case', charge: 'case', handles: 'case', clicklock: 'case', 'lock-pawls': 'lock', 'lock-springs': 'lock', 'lock-pivots': 'lock', 'lock-cables': 'lock', 'lock-trigger': 'lock', 'plates-bottom': 'contacts', 'holder-bottom': 'cells', cells: 'cells', 'holder-top': 'cells', 'plates-top': 'contacts', bms: 'electronics', terminals: 'electronics', lid: 'lid', latches: 'lid' });

/**
 * Add a BatteryPack's parts to a machine's kit, its foot's middle at `at` (actor metres), its front towards +z.
 * `assembly` and `step` say where each part goes in the machine's catalog; with `unit`, the pack arrives whole.
 * `seg`: the sides of a cell (fewer where many packs stand closed). `v`: the version to build (2: its plug still on the
 * face, no ClickLock; 3: the back plug and the ClickLock; 4: one centre grip whose
 * trigger releases the ClickLock).
 * @param {ReturnType<typeof machineKit>} kit
 * @param {{ at: V3, base: string, assembly?: (g: string) => string, step?: (p: string) => number, prefix?: string, unit?: string, seg?: number, v?: number }} o
 */
export function batteryPackParts(kit, { at, base, assembly = (g) => g, step = (p) => STEP[p], prefix = '', unit, seg = 10, v = 4 }) {
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
	const top = CELLS.z0 + CELLS.h;
	/** @param {string} p @param {Omit<import('./parts.js').PartInfo, 'assembly' | 'step' | 'id'>} info @param {(put: (geo: THREE.BufferGeometry, color: string) => void) => void} make */
	const part = (p, info, make) => kit.part({ ...info, id: `${prefix}${p}`, assembly: assembly(GROUP[p]), step: step(p), source: SRC, ...(unit ? { unit } : {}) }, base, make);

	part('tray', { label: 'Case', what: 'The pack’s case: one smooth aluminium shell with round corners, its floor and four walls, a darker foot band, and rails under it to slide on.', specs: [['Outside', '460 × 480 × 112 mm'], ['Material', 'Aluminium, 3 mm, black anodised'], ['Corners', 'R 30 mm']] }, (put) => {
		put(slab(W, LEN, RC, 0, 5), CASE);
		put(slab(W, LEN, RC, 0, 16, 4), FACE); // the foot band
		put(slab(W, LEN, RC, 16, 94, 4), CASE);
		put(slab(W, LEN, RC, 110, 2, 3), SEAM); // the light seam under the lid
		for (const sx of [-1, 1]) put(box(sx * (Wh - 60), 0, -1, 20, LEN - 80, 3), DARK);
	});
	part('front', { label: 'Front panel', what: 'The pack’s face, set into the case’s front: it carries the handles, the charge strip along its top' + (v < 3 ? ' and the terminals.' : '; its power and data leave by the plug in its back.'), specs: [['Size', '380 × 80 mm']] }, (put) => {
		put(box(0, Lh + 1, 62, 380, 3, 80, 1), FACE);
	});
	part('charge', { label: 'Charge strip', what: 'A slim LED strip along the top of its face, under the lid’s seam: ten segments light up with the pack’s state of charge.', specs: [['Length', '380 mm, 10 segments'], ['Shows', 'State of charge, 10 % a segment'], ['Fed by', 'The BMS']] }, (put) => {
		put(box(0, Lh + 0.5, 104, 386, 2, 7, 1), BLACK);
		for (let k = 0; k < 10; k++) put(box(-171 + k * 38, Lh + 1.5, 104, 34, 1.5, 4), k < CHARGE ? LED : LED_OFF);
	});
	if (v >= 4)
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
	if (v < 3)
		part('terminals', { label: 'Terminals', count: 2, what: 'The pack’s plus and minus on its face, under their covers, and the data plug for the BMS beside them.', specs: [['Connectors', 'Anderson-type, 120 A [inferred]'], ['Data', 'CAN, RJ45']] }, (put) => {
			put(cyl([90, Lh, 55], [90, Lh + 16, 55], 13, 16), RED);
			put(cyl([140, Lh, 55], [140, Lh + 16, 55], 13, 16), BLACK);
			put(box(-110, Lh + 3, 55, 26, 4, 20, 2), '#d9d9d9');
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
	if (v >= 4) for (const [id, info, draw] of clickLockPieces(box, cyl, { half: Wh, face: Lh, z: 10, grip: [0, Lh + 22, 52] })) part(id, info, draw);
	part('lid', { label: 'Lid', what: 'The lid, its round corners and soft edge flush with the case, and the spring pad under it: closing it presses every contact plate onto its poles, the whole pack’s only joining force.', specs: [['Pad', 'Silicone foam, ~0.2 MPa [inferred]'], ['Corners', 'R 30 mm']] }, (put) => {
		put(slab(W, LEN, RC, H - 13, 13, 0, 5), LID);
		put(box(0, CELLS.y, H - 19, zone.w - 10, zone.l - 10, 10, 2), '#d8d1bf');
	});
	part('latches', { label: 'Latches', count: 4, what: 'Four flush over-centre latches, two a side: flip them and the lid lifts. No tool opens the pack.', specs: [['Type', 'Over-centre, flush']] }, (put) => {
		for (const sx of [-1, 1]) for (const y of [-120, 120]) put(box(sx * (Wh + 1.5), y, H - 16, 4, 36, 22, 1.5), FACE);
	});
}

/** The BatteryPack on its own (version `v`), every part its own: drawn apart, built step by step. @returns {Cast} */
export function batteryPack(v = 4) {
	const kit = machineKit(ASSEMBLIES);
	batteryPackParts(kit, { at: [0, 0, 0], base: 'base', v });
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
