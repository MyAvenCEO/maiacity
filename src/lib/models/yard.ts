/*
 * THE YARD'S MODELS — a Munich backyard's courtyard and garden corner (src/lib/worlds/backyard): the old workshop's
 * steel windows and the house's white casements, its wooden front door under an arched steel canopy and a barn lamp,
 * the brown workshop doors, a letterbox on its post, window boxes, a black city bike on its stand; in the garden the
 * oval teak table, teak recliners and small pine folding chairs, a stoneware crock, a red tin and an ashtray; on the
 * shed the blue rain barrel, the sunflower insect hotel, a floodlight and the station clock on its bracket; clipped
 * hedges and an ivy-covered cone. Each to its real measure, standing on the floor at its origin, its back towards −z,
 * its front towards +z; a window or a door: its opening's foot at the origin, its face in the plane z 0; a thing on a
 * wall: its back at z 0.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bar, part, shared, soft, std, v3 } from './parts';
import { clockFace, hedgeLeaves, insectFace, pine, stoneware, teak } from './textures';
import { bush, scatterLeaves, seeded, stems } from './outdoor';

const m = {
	glass: shared(() => new THREE.MeshPhysicalMaterial({ color: '#e9f0f2', roughness: 0.04, transparent: true, opacity: 0.1, depthWrite: false })),
	dark: shared(() => new THREE.MeshStandardMaterial({ color: '#272c2f', roughness: 0.12, metalness: 0.3 })),
	frosted: shared(() => new THREE.MeshStandardMaterial({ color: '#e8ebe8', roughness: 0.75, transparent: true, opacity: 0.88 })),
	white: std('#f4f3ef', 0.4),
	handle: std('#cfccc4', 0.3, { metalness: 0.7 }),
	door: shared(() => new THREE.MeshStandardMaterial({ map: pine(true), color: '#c98f5c', roughness: 0.6 })),
	brass: std('#b8893f', 0.3, { metalness: 0.9 }),
	brown: std('#5a3323', 0.55),
	plate: std('#4f2e21', 0.5, { metalness: 0.45 }),
	steelGrey: std('#85847f', 0.5, { metalness: 0.3 }),
	galv: std('#a7a9a5', 0.42, { metalness: 0.72 }),
	enamel: std('#72797b', 0.35, { metalness: 0.2 }),
	enamelIn: shared(() => new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.35, side: THREE.BackSide })),
	lampGlass: shared(() => new THREE.MeshStandardMaterial({ color: '#fff6e6', roughness: 0.2, emissive: '#ffd59a', emissiveIntensity: 0.1 })),
	box: std('#202122', 0.7),
	soil: std('#2b1f16', 0.97),
	frame: std('#151617', 0.38, { metalness: 0.35 }),
	tyre: std('#141414', 0.85),
	rim: std('#2b2c2e', 0.35, { metalness: 0.7 }),
	spoke: std('#9a9c9e', 0.3, { metalness: 0.9 }),
	saddle: std('#1a1a1a', 0.6),
	barrel: std('#1f4f9c', 0.42),
	petal: std('#f0bf2a', 0.6),
	disc: std('#4a3220', 0.85),
	face: shared(() => new THREE.MeshStandardMaterial({ map: insectFace(), roughness: 0.9 })),
	floodBody: std('#d9d9d6', 0.45, { metalness: 0.2 }),
	floodLens: shared(() => new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.3, emissive: '#f4f6ff', emissiveIntensity: 0 })),
	clock: shared(() => new THREE.MeshStandardMaterial({ map: clockFace(), roughness: 0.4 })),
	clockRim: std('#2a2c2d', 0.35, { metalness: 0.5 }),
	teak: shared(() => new THREE.MeshStandardMaterial({ map: teak(), roughness: 0.62 })),
	teakGrey: shared(() => new THREE.MeshStandardMaterial({ map: teak(true), roughness: 0.85 })),
	pine: shared(() => new THREE.MeshStandardMaterial({ map: pine(), color: '#efd2a6', roughness: 0.7 })),
	stoneware: shared(() => new THREE.MeshStandardMaterial({ map: stoneware(), roughness: 0.5 })),
	red: shared(() => new THREE.MeshPhysicalMaterial({ color: '#c3161f', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 })),
	chrome: std('#d6d6d4', 0.15, { metalness: 1 }),
	hedge: shared(() => new THREE.MeshStandardMaterial({ map: hedgeLeaves(), roughness: 0.9 })),
	ivyCore: std('#1c2b15', 0.95)
};

const mesh = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) => {
	const o = new THREE.Mesh(geo, mat);
	o.position.set(x, y, z);
	o.castShadow = o.receiveShadow = true;
	g.add(o);
	return o;
};
const pane = (g: THREE.Group, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number) => {
	const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
	p.position.set(x, y, z);
	p.receiveShadow = true;
	g.add(p);
	return p;
};
const steels = new Map<string, THREE.MeshStandardMaterial>();
const steelOf = (c: string) => steels.get(c) ?? (steels.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.5 })), steels.get(c)!);

/* ── windows ──────────────────────────────────────────────────────────────── */

/**
 * An old workshop's steel window: a slim frame, `cols` × `rows` small panes between T-section bars, painted `color`;
 * some panes frosted or wired (`frosted`, a share, seeded), the rest `glass`: 'clear' to see a room behind it, 'dark'
 * where there is none. `w` × `h`, its foot at the origin, its face at z 0.
 */
export function steelWindow({ w = 2.2, h = 1.6, cols = 6, rows = 7, color = '#47291f', frosted = 0.12, glass = 'dark', seed = 1 }: { w?: number; h?: number; cols?: number; rows?: number; color?: string; frosted?: number; glass?: 'clear' | 'dark'; seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'steel window';
	const s = steelOf(color), F = 0.05, B = 0.024;
	part(g, w, F, 0.06, s, 0, F / 2, 0);
	part(g, w, F, 0.06, s, 0, h - F / 2, 0);
	part(g, F, h, 0.06, s, -w / 2 + F / 2, h / 2, 0);
	part(g, F, h, 0.06, s, w / 2 - F / 2, h / 2, 0);
	const iw = w - 2 * F, ih = h - 2 * F, cw = iw / cols, ch = ih / rows;
	for (let i = 1; i < cols; i++) part(g, B, ih, 0.04, s, -iw / 2 + i * cw, h / 2, 0.005);
	for (let j = 1; j < rows; j++) part(g, iw, B, 0.04, s, 0, F + j * ch, 0.005);
	pane(g, iw, ih, glass === 'clear' ? m.glass() : m.dark(), 0, h / 2, -0.008);
	const r = seeded(seed * 97 + cols * rows);
	for (let i = 0; i < cols; i++)
		for (let j = 0; j < rows; j++)
			if (r() < frosted || (j === 0 && r() < frosted * 2)) pane(g, cw - B, ch - B, m.frosted(), -iw / 2 + (i + 0.5) * cw, F + (j + 0.5) * ch, -0.004);
	return g;
}

/**
 * A white window of the house, two casements under a fixed top light: `w` × `h`, the frames 6 cm, a lever on the
 * right casement. Its glass dark — the room behind it unseen — or a `glass` of the world's own (a window lit at night).
 * Its foot at the origin, its face at z 0.
 */
export function casementWindow({ w = 1.05, h = 1.45, light = 0.36, glass }: { w?: number; h?: number; light?: number; glass?: THREE.Material } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'casement window';
	const W = m.white(), F = 0.06, t = h - light;
	part(g, w, F, 0.07, W, 0, F / 2, 0);
	part(g, w, F, 0.07, W, 0, h - F / 2, 0);
	part(g, F, h, 0.07, W, -w / 2 + F / 2, h / 2, 0);
	part(g, F, h, 0.07, W, w / 2 - F / 2, h / 2, 0);
	part(g, w - 2 * F, 0.07, 0.07, W, 0, t, 0); // the transom
	part(g, 0.09, t - F, 0.075, W, 0, (t + F) / 2, 0.004); // where the casements meet
	pane(g, w - 2 * F, h - 2 * F, glass ?? m.dark(), 0, h / 2, -0.01);
	// each casement's own frame inside the outer one
	for (const s of [-1, 1]) {
		const cx = s * (w / 4), cw = w / 2 - F - 0.045;
		part(g, cw, 0.045, 0.05, W, cx, F + 0.022, 0.012);
		part(g, cw, 0.045, 0.05, W, cx, t - 0.058, 0.012);
		part(g, 0.045, t - F - 0.08, 0.05, W, s * (w / 2 - F - 0.022), (t + F) / 2, 0.012);
	}
	part(g, 0.016, 0.11, 0.03, m.handle(), 0.07, F + (t - F) * 0.55, 0.05);
	return g;
}

/* ── doors ────────────────────────────────────────────────────────────────── */

/**
 * The house's front door: two leaves of old wood, 1.30 × 2.25 m, each a tall glazed panel over two raised panels, a
 * two-pane top light over them (0.42 m), a brass lever on the right leaf. In its frame; its foot at the origin.
 */
export function entranceDoor(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'entrance door';
	const wood = m.door(), W = 1.3, H = 2.25, T = 0.42, J = 0.08;
	part(g, J, H + T + J, 0.1, wood, -W / 2 - J / 2, (H + T + J) / 2, 0);
	part(g, J, H + T + J, 0.1, wood, W / 2 + J / 2, (H + T + J) / 2, 0);
	part(g, W + 2 * J, J, 0.1, wood, 0, H + T + J / 2, 0);
	part(g, W, 0.08, 0.1, wood, 0, H + 0.04, 0); // the transom bar
	pane(g, W - 0.06, T - 0.1, m.dark(), 0, H + T / 2 + 0.04, -0.02);
	part(g, 0.05, T - 0.08, 0.06, wood, 0, H + T / 2 + 0.04, 0);
	for (const s of [-1, 1]) {
		const cx = s * (W / 4), lw = W / 2 - 0.01;
		part(g, lw, 0.22, 0.05, wood, cx, 0.11, 0.01);
		part(g, lw, 0.14, 0.05, wood, cx, 1.02, 0.01);
		part(g, lw, 0.1, 0.05, wood, cx, H - 0.05, 0.01);
		part(g, 0.1, H, 0.05, wood, cx - lw / 2 + 0.05, H / 2, 0.01);
		part(g, 0.1, H, 0.05, wood, cx + lw / 2 - 0.05, H / 2, 0.01);
		pane(g, lw - 0.2, H - 1.19, m.dark(), cx, (1.09 + H - 0.1) / 2, 0.0);
		// two raised panels under the glass
		for (const y of [0.42, 0.8]) part(g, lw - 0.24, 0.26, 0.035, wood, cx, y, 0.012);
		part(g, lw - 0.2, 0.03, 0.03, wood, cx, 1.105, 0.03); // the glass's bead
	}
	part(g, 0.02, H, 0.06, wood, 0, H / 2, 0.02); // the meeting stile's cover
	part(g, 0.03, 0.14, 0.012, m.brass(), 0.09, 1.02, 0.042);
	bar(g, v3(0.09, 1.05, 0.05), v3(0.21, 1.05, 0.07), 0.009, m.brass());
	return g;
}

/**
 * The old workshop's double door, painted brown: 1.80 × 2.55 m, each leaf a tall pane over a steel plate to 1 m, a
 * galvanised letterbox on the right leaf, a lever. In its frame; its foot at the origin.
 */
export function workshopDoor(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'workshop door';
	const wood = m.brown(), W = 1.8, H = 2.55, J = 0.07;
	part(g, J, H + J, 0.1, wood, -W / 2 - J / 2, (H + J) / 2, 0);
	part(g, J, H + J, 0.1, wood, W / 2 + J / 2, (H + J) / 2, 0);
	part(g, W + 2 * J, J, 0.1, wood, 0, H + J / 2, 0);
	for (const s of [-1, 1]) {
		const cx = s * (W / 4), lw = W / 2 - 0.008;
		part(g, 0.09, H, 0.05, wood, cx - lw / 2 + 0.045, H / 2, 0.01);
		part(g, 0.09, H, 0.05, wood, cx + lw / 2 - 0.045, H / 2, 0.01);
		part(g, lw, 0.09, 0.05, wood, cx, H - 0.045, 0.01);
		part(g, lw, 0.12, 0.05, wood, cx, 1.06, 0.01);
		pane(g, lw - 0.18, H - 1.21, m.dark(), cx, (1.12 + H - 0.09) / 2, 0);
		part(g, lw - 0.02, 0.98, 0.012, m.plate(), cx, 0.51, 0.04);
	}
	part(g, 0.32, 0.22, 0.08, m.galv(), W / 4, 1.32, 0.06); // the letterbox
	part(g, 0.24, 0.012, 0.01, std('#1a1a1a', 0.5)(), W / 4, 1.4, 0.101);
	part(g, 0.1, 0.03, 0.004, m.white(), W / 4, 1.27, 0.102);
	bar(g, v3(0.07, 1.05, 0.05), v3(0.2, 1.05, 0.06), 0.009, m.handle());
	return g;
}

/**
 * A canopy over a door: a pane of glass in a grey steel frame `w` wide reaching `d` out from the wall, on two flat
 * steel brackets curved like a quarter of a wheel. Its origin where its roof meets the wall (hang it there); it falls
 * a little to the front.
 */
export function doorCanopy({ w = 1.7, d = 0.95 }: { w?: number; d?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'door canopy';
	const s = m.steelGrey(), fall = 0.12;
	const roof = new THREE.Group();
	roof.rotation.x = Math.atan2(fall, d);
	g.add(roof);
	part(roof, w, 0.04, 0.04, s, 0, 0, 0.02);
	part(roof, w, 0.04, 0.04, s, 0, 0, d - 0.02);
	for (const x of [-w / 2 + 0.02, -w / 6, w / 6, w / 2 - 0.02]) part(roof, 0.04, 0.04, d, s, x, 0, d / 2);
	pane(roof, w - 0.04, d - 0.04, m.glass(), 0, 0.022, d / 2).rotation.x = -Math.PI / 2;
	for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) {
		const arc = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => {
			const a = (i / 8) * (Math.PI / 2);
			return v3(x, -0.62 * Math.cos(a) - fall * Math.sin(a) * 0.9, (d - 0.05) * Math.sin(a));
		}));
		mesh(g, new THREE.TubeGeometry(arc, 16, 0.014, 4, false), s);
		part(g, 0.06, 0.1, 0.01, s, x, -0.62, 0.005);
	}
	return g;
}

/** A barn lamp in grey enamel on a gooseneck from the wall: the shade 30 cm across. Its origin at the wall plate;
 *  userData `glass` (the bulb's material) and `light` (where its light is). */
export function barnLamp(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'barn lamp';
	const plate = mesh(g, new THREE.CylinderGeometry(0.055, 0.055, 0.02, 20), m.enamel(), 0, 0, 0.01);
	plate.rotation.x = Math.PI / 2;
	const neck = new THREE.CatmullRomCurve3([v3(0, 0, 0.01), v3(0, 0.06, 0.16), v3(0, 0.02, 0.3), v3(0, -0.1, 0.36)]);
	mesh(g, new THREE.TubeGeometry(neck, 20, 0.011, 8, false), m.enamel());
	// from its rim up to its neck: so turned, the lathe's faces look outwards — the grey enamel outside, white inside
	const prof = [new THREE.Vector2(0.15, -0.15), new THREE.Vector2(0.13, -0.12), new THREE.Vector2(0.08, -0.07), new THREE.Vector2(0.04, -0.02), new THREE.Vector2(0.025, 0)];
	for (const mat of [m.enamel(), m.enamelIn()]) {
		const s = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), mat);
		s.position.set(0, -0.1, 0.36);
		s.castShadow = mat === m.enamel();
		g.add(s);
	}
	const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), m.lampGlass());
	bulb.position.set(0, -0.2, 0.36);
	g.add(bulb);
	g.userData = { glass: m.lampGlass(), light: v3(0, -0.24, 0.36) };
	return g;
}

/** A galvanised letterbox on its post: the box 37 × 30 × 14 cm under a rounded lid, its top at 1.37 m. */
export function mailboxPost(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'letterbox on a post';
	const s = m.galv();
	part(g, 0.18, 0.012, 0.18, s, 0, 0.006, 0);
	part(g, 0.05, 1.0, 0.05, s, 0, 0.5, 0);
	part(g, 0.37, 0.3, 0.14, s, 0, 1.15, 0.0);
	const lid = mesh(g, new THREE.CylinderGeometry(0.075, 0.075, 0.38, 20, 1, false, 0, Math.PI), s, 0, 1.3, 0);
	lid.rotation.z = Math.PI / 2;
	lid.scale.set(1, 1, 0.95);
	part(g, 0.26, 0.012, 0.01, std('#2a2a2a', 0.5)(), 0, 1.26, 0.071); // the slot's flap
	part(g, 0.09, 0.03, 0.004, std('#c9a46a', 0.4, { metalness: 0.6 })(), 0, 1.08, 0.072); // the name plate
	return g;
}

/** A window box of black plastic, `length` long, its herbs and flowers grown over its edge. Its back at z 0. */
export function windowBox({ length = 0.8, seed = 1 }: { length?: number; seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'window box';
	part(g, length, 0.16, 0.17, m.box(), 0, 0.08, 0.085);
	part(g, length - 0.03, 0.02, 0.14, m.soil(), 0, 0.14, 0.085);
	const r = seeded(seed * 7 + 3);
	for (let i = 0; i < Math.round(length / 0.22); i++)
		g.add(bush({ w: 0.24, h: 0.22, d: 0.16, cards: 22, card: 0.1, leaf: 'broad', tint: ['#a8c98a', '#8fb874', '#c4d8a0'][i % 3]!, seed: seed * 10 + i, base: 0.13 }).translateX(-length / 2 + 0.12 + i * 0.22 + (r() - 0.5) * 0.04).translateZ(0.085));
	const lines: [THREE.Vector3, THREE.Vector3][] = [];
	for (let i = 0; i < 5; i++) {
		const x = -length / 2 + 0.08 + r() * (length - 0.16);
		lines.push([v3(x, 0.15, 0.16), v3(x + (r() - 0.5) * 0.1, -0.05 - r() * 0.15, 0.2)]);
	}
	g.add(stems(lines, { card: 0.06, per: 30, tint: '#b8d39a', seed }));
	return g;
}

/* ── the bike ─────────────────────────────────────────────────────────────── */

/**
 * A black city e-bike on its side stand, leaning a little to its left: 28-inch wheels, the battery in its down tube,
 * the motor in its rear hub, mudguards, a rear rack, a lamp. About 1.8 m long; its front towards +z.
 */
export function cityBike(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'city bike';
	const b = new THREE.Group();
	b.rotation.z = 0.1; // on its stand
	g.add(b);
	const F = m.frame(), A = 0.35, rear = -0.55, front = 0.55;
	for (const z of [rear, front]) {
		const tyre = mesh(b, new THREE.TorusGeometry(0.33, 0.022, 10, 48), m.tyre(), 0, A, z);
		tyre.rotation.y = Math.PI / 2;
		const rim = mesh(b, new THREE.TorusGeometry(0.305, 0.011, 6, 48), m.rim(), 0, A, z);
		rim.rotation.y = Math.PI / 2;
		// 32 spokes, laced from the hub's two flanges, as one piece
		const spokes: THREE.BufferGeometry[] = [];
		for (let k = 0; k < 32; k++) {
			const a = (k / 32) * Math.PI * 2, side = k % 2 ? 0.025 : -0.025;
			const from = v3(side, A + Math.sin(a + 0.3) * 0.03, z + Math.cos(a + 0.3) * 0.03), to = v3(0, A + Math.sin(a) * 0.3, z + Math.cos(a) * 0.3);
			const len = from.distanceTo(to);
			const s = new THREE.CylinderGeometry(0.0012, 0.0012, len, 4, 1, true);
			s.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), to.clone().sub(from).normalize()));
			s.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
			spokes.push(s);
		}
		mesh(b, mergeGeometries(spokes)!, m.spoke());
		const hub = mesh(b, new THREE.CylinderGeometry(z === rear ? 0.07 : 0.025, z === rear ? 0.07 : 0.025, z === rear ? 0.06 : 0.09, 20), m.rim(), 0, A, z);
		hub.rotation.z = Math.PI / 2;
		// the mudguard over it
		const guard = mesh(b, new THREE.TorusGeometry(0.365, 0.018, 4, 30, 2.3), F, 0, A, z);
		guard.rotation.set(0, Math.PI / 2, z === rear ? 0.3 : 0.55);
		guard.scale.set(1, 1, 1.8);
	}
	const bb = v3(0, 0.29, -0.06), seat = v3(0, 0.8, -0.23), headLo = v3(0, 0.62, 0.4), headHi = v3(0, 0.8, 0.36);
	bar(b, bb, headLo, 0.034, F, 0.028); // the down tube, the battery in it
	bar(b, seat.clone().setY(0.78), headHi.clone().setY(0.77), 0.017, F);
	bar(b, bb, seat, 0.019, F);
	bar(b, headLo, headHi, 0.024, F);
	for (const s of [-1, 1]) {
		bar(b, v3(s * 0.035, 0.77, -0.23), v3(s * 0.06, A, rear), 0.009, F);
		bar(b, v3(s * 0.03, 0.29, -0.06), v3(s * 0.06, A, rear), 0.011, F);
		bar(b, headLo.clone().setX(s * 0.03), v3(s * 0.05, A, front), 0.014, F, 0.011);
		// the rack's sides and its stays to the axle
		bar(b, v3(s * 0.08, 0.7, -0.3), v3(s * 0.08, 0.7, -0.68), 0.006, F);
		bar(b, v3(s * 0.08, 0.7, -0.62), v3(s * 0.06, A, rear), 0.006, F);
	}
	for (const z of [-0.36, -0.46, -0.56, -0.66]) bar(b, v3(-0.08, 0.7, z), v3(0.08, 0.7, z), 0.005, F);
	// the stem and the bar, swept back to the grips; the saddle on its post
	bar(b, headHi, v3(0, 0.98, 0.32), 0.015, F);
	const handle = new THREE.CatmullRomCurve3([v3(-0.29, 1.0, 0.2), v3(-0.15, 0.99, 0.31), v3(0, 0.98, 0.33), v3(0.15, 0.99, 0.31), v3(0.29, 1.0, 0.2)]);
	mesh(b, new THREE.TubeGeometry(handle, 20, 0.011, 8, false), F);
	for (const s of [-1, 1]) bar(b, v3(s * 0.25, 1.0, 0.22), v3(s * 0.32, 1.0, 0.18), 0.017, m.saddle());
	bar(b, seat, v3(0, 0.93, -0.26), 0.014, m.rim());
	soft(b, 0.16, 0.06, 0.27, 0.025, m.saddle(), 0, 0.96, -0.27);
	// the cranks and the chainring, the pedals; the chain to the hub
	const ring = mesh(b, new THREE.TorusGeometry(0.095, 0.008, 6, 32), m.rim(), 0.065, 0.29, -0.06);
	ring.rotation.y = Math.PI / 2;
	for (const s of [-1, 1]) {
		const end = v3(s * 0.085, 0.29 + s * 0.12, -0.06 - s * 0.1);
		bar(b, v3(s * 0.07, 0.29, -0.06), end, 0.011, m.rim());
		part(b, 0.1, 0.02, 0.06, m.saddle(), end.x + s * 0.05, end.y, end.z);
	}
	bar(b, v3(0.065, 0.385, -0.06), v3(0.06, 0.39, rear), 0.004, m.rim());
	bar(b, v3(0.065, 0.195, -0.06), v3(0.06, 0.31, rear), 0.004, m.rim());
	const lamp = mesh(b, new THREE.CylinderGeometry(0.03, 0.025, 0.06, 14), m.saddle(), 0, 0.74, 0.43);
	lamp.rotation.x = Math.PI / 2;
	bar(b, v3(-0.03, 0.29, -0.12), v3(-0.16, 0.018, -0.3), 0.008, F); // the stand
	return g;
}

/* ── on the shed ──────────────────────────────────────────────────────────── */

/** A blue rain barrel of 200 litres, ribbed twice round, its lid's bungs on top: 58 cm across, 93 cm high. */
export function rainBarrel(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'rain barrel';
	const prof: THREE.Vector2[] = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.27, 0), new THREE.Vector2(0.285, 0.015)];
	for (let i = 1; i < 30; i++) {
		const y = (i / 30) * 0.9;
		const rib = Math.exp(-(((y - 0.3) / 0.02) ** 2)) + Math.exp(-(((y - 0.6) / 0.02) ** 2));
		prof.push(new THREE.Vector2(0.285 + 0.012 * rib, y));
	}
	prof.push(new THREE.Vector2(0.282, 0.925), new THREE.Vector2(0.26, 0.93), new THREE.Vector2(0.001, 0.925));
	mesh(g, new THREE.LatheGeometry(prof, 40), m.barrel());
	for (const [x, z, r] of [[0.15, 0.05, 0.035], [-0.16, -0.04, 0.026]] as const) mesh(g, new THREE.CylinderGeometry(r, r, 0.02, 16), m.barrel(), x, 0.935, z);
	return g;
}

/** A sunflower insect hotel for a wall: twelve yellow wooden petals round a disc of dark wood packed with bamboo canes
 *  and drilled holes, 62 cm across. Its back at z 0, its middle at the origin. */
export function insectHotel(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'insect hotel';
	const petal = new THREE.Shape();
	petal.absellipse(0, 0, 0.075, 0.042, 0, Math.PI * 2, false, 0);
	const pg = new THREE.ExtrudeGeometry(petal, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
	for (let k = 0; k < 12; k++) {
		const a = (k / 12) * Math.PI * 2;
		const p = mesh(g, pg, m.petal(), Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.004);
		p.rotation.z = a;
	}
	const core = mesh(g, new THREE.CylinderGeometry(0.155, 0.155, 0.1, 40), [m.disc(), m.face(), m.disc()], 0, 0, 0.05);
	core.rotation.x = Math.PI / 2;
	mesh(g, new THREE.TorusGeometry(0.157, 0.012, 8, 40), m.disc(), 0, 0, 0.1);
	return g;
}

/** An LED floodlight on its bracket, tilted down, its motion sensor under it: 24 × 18 cm. Its back at z 0; userData
 *  `glass` (its face) and `light`, `aim` (where its light is and where it points). */
export function floodlight(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'floodlight';
	const s = m.floodBody();
	part(g, 0.08, 0.08, 0.02, s, 0, 0, 0.01);
	for (const x of [-0.13, 0.13]) bar(g, v3(x * 0.4, 0, 0.02), v3(x, 0, 0.09), 0.008, s);
	const head = new THREE.Group();
	head.position.set(0, 0, 0.1);
	head.rotation.x = 0.55;
	g.add(head);
	mesh(head, new RoundedBoxGeometry(0.24, 0.18, 0.055, 3, 0.01), s);
	for (let i = 0; i < 7; i++) part(head, 0.008, 0.16, 0.03, s, -0.09 + i * 0.03, 0, -0.04);
	pane(head, 0.21, 0.15, m.floodLens(), 0, 0, 0.0285);
	bar(g, v3(0, -0.04, 0.03), v3(0, -0.12, 0.07), 0.008, s);
	const pir = mesh(g, new THREE.SphereGeometry(0.03, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.white(), 0, -0.135, 0.075);
	pir.rotation.x = Math.PI;
	g.userData = { glass: m.floodLens(), light: v3(0, -0.05, 0.14), aim: v3(0, -Math.sin(0.55), Math.cos(0.55)) };
	return g;
}

/** A station clock with two faces on a bracket: the clock 32 cm across, hung under the bracket's end `reach` out
 *  along +z from its origin (the post or wall it is fixed to). */
export function stationClock({ reach = 0.32 }: { reach?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'station clock';
	const r = m.clockRim();
	bar(g, v3(0, 0, 0), v3(0, 0, reach), 0.012, r);
	const scroll = new THREE.CatmullRomCurve3([v3(0, -0.12, 0), v3(0, -0.04, reach * 0.4), v3(0, 0, reach * 0.8)]);
	mesh(g, new THREE.TubeGeometry(scroll, 12, 0.007, 6, false), r);
	part(g, 0.01, 0.16, 0.06, r, 0, -0.04, 0.02);
	bar(g, v3(0, 0, reach), v3(0, -0.04, reach), 0.01, r);
	const body = mesh(g, new THREE.CylinderGeometry(0.16, 0.16, 0.08, 48), [r, m.clock(), m.clock()], 0, -0.2, reach);
	body.rotation.z = Math.PI / 2;
	const rim = mesh(g, new THREE.TorusGeometry(0.162, 0.012, 8, 48), r, 0, -0.2, reach);
	rim.rotation.y = Math.PI / 2;
	return g;
}

/* ── the garden table and its chairs ──────────────────────────────────────── */

/**
 * An oval garden table of teak, 1.60 × 0.95 m at 74 cm: its slatted top in an oval rim, the leaf's joint across its
 * middle, a parasol hole with its cover; legs under a straight apron, joined low by stretchers. `weathered` silver.
 */
export function teakTable({ weathered = false }: { weathered?: boolean } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'teak table';
	const t = weathered ? m.teakGrey() : m.teak(), rx = 0.8, rz = 0.475, y = 0.725;
	const rim = new THREE.Shape();
	rim.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
	const hole = new THREE.Path();
	hole.absellipse(0, 0, rx - 0.07, rz - 0.07, 0, Math.PI * 2, true, 0);
	rim.holes.push(hole);
	const rg = new THREE.ExtrudeGeometry(rim, { depth: 0.028, bevelEnabled: false, curveSegments: 40 });
	rg.rotateX(-Math.PI / 2);
	const uv = rg.attributes.uv!;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.8, uv.getY(i) * 0.8);
	mesh(g, rg, t, 0, y - 0.014, 0);
	// the slats along the table, cut by the oval; the leaf's joint across the middle
	const n = 11, ix = rx - 0.07, iz = rz - 0.07;
	for (let i = 0; i < n; i++) {
		const z = -iz + 0.035 + (i * (2 * iz - 0.07)) / (n - 1);
		const half = ix * Math.sqrt(Math.max(0, 1 - (z / iz) ** 2));
		if (half < 0.05) continue;
		part(g, 2 * half, 0.022, 0.062, t, 0, y, z);
	}
	part(g, 0.06, 0.024, 2 * iz, t, 0, y + 0.001, 0);
	mesh(g, new THREE.CylinderGeometry(0.035, 0.035, 0.006, 20), m.chrome(), 0.0, y + 0.014, 0);
	// the apron, the legs, the stretchers
	for (const s of [-1, 1]) {
		part(g, 1.06, 0.07, 0.025, t, 0, y - 0.05, s * 0.33);
		part(g, 0.025, 0.07, 0.66, t, s * 0.53, y - 0.05, 0);
		for (const z of [-0.31, 0.31]) part(g, 0.055, y - 0.02, 0.055, t, s * 0.5, (y - 0.02) / 2, z);
		part(g, 0.035, 0.05, 0.62, t, s * 0.5, 0.2, 0);
	}
	part(g, 1.0, 0.05, 0.035, t, 0, 0.2, 0);
	return g;
}

/**
 * A teak garden chair that folds and reclines, high-backed: a slatted seat at 40 cm, arms at 62 cm, a back of slats
 * leaning back to 1.08 m. Oiled red-brown, or `weathered` silver-grey.
 */
export function teakRecliner({ weathered = false }: { weathered?: boolean } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'teak recliner';
	const t = weathered ? m.teakGrey() : m.teak();
	const board = (a: THREE.Vector3, b: THREE.Vector3, w: number, d: number) => {
		const len = a.distanceTo(b);
		const p = part(g, w, len, d, t, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
		p.quaternion.setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize());
		return p;
	};
	for (const s of [-1, 1]) {
		const x = s * 0.29;
		board(v3(x, 0, 0.27), v3(x, 0.6, 0.25), 0.04, 0.05); // the front leg up to the arm
		board(v3(x, 0, -0.34), v3(x, 0.6, -0.02), 0.04, 0.05); // the back leg crossing up to it
		board(v3(s * 0.25, 0.36, -0.26), v3(s * 0.25, 1.08, -0.52), 0.045, 0.035); // the back's post
		part(g, 0.035, 0.035, 0.52, t, s * 0.255, 0.37, 0.0); // the seat's side rail
		const arm = part(g, 0.075, 0.022, 0.62, t, s * 0.305, 0.615, -0.02);
		arm.rotation.x = 0.04;
	}
	for (let i = 0; i < 6; i++) part(g, 0.5, 0.018, 0.06, t, 0, 0.398, -0.21 + i * 0.085);
	// the back: slats between its posts, a top rail, a low rail
	const back = new THREE.Group();
	back.position.set(0, 0.36, -0.26);
	back.rotation.x = -Math.atan2(0.26, 0.72);
	g.add(back);
	for (let i = 0; i < 7; i++) part(back, 0.045, 0.6, 0.016, t, -0.18 + i * 0.06, 0.4, 0);
	part(back, 0.5, 0.07, 0.025, t, 0, 0.73, 0);
	part(back, 0.5, 0.05, 0.022, t, 0, 0.08, 0);
	return g;
}

/** A small folding chair of fresh pine: a slatted seat at 43 cm, a ladder back of two rails, the legs crossed. */
export function foldingChair(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'folding chair';
	const p = m.pine();
	for (const s of [-1, 1]) {
		const post = part(g, 0.035, 0.84, 0.025, p, s * 0.18, 0.41, -0.2);
		post.rotation.x = 0.1;
		const leg = part(g, 0.03, 0.58, 0.022, p, s * 0.155, 0.26, 0.04);
		leg.rotation.x = -0.72;
		part(g, 0.025, 0.025, 0.4, p, s * 0.16, 0.42, 0.0);
	}
	for (let i = 0; i < 5; i++) part(g, 0.36, 0.016, 0.06, p, 0, 0.44, -0.15 + i * 0.075);
	for (const y of [0.6, 0.74]) part(g, 0.38, 0.06, 0.016, p, 0, y, -0.235 - (y - 0.41) * 0.1);
	return g;
}

/* ── on the garden table, by the wall ─────────────────────────────────────── */

/** A grey salt-glazed stoneware crock with a blue flower painted on it: 28 cm across, 40 cm high, two small lugs. */
export function stonewareCrock(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'stoneware crock';
	const prof = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.11, 0), new THREE.Vector2(0.13, 0.06), new THREE.Vector2(0.14, 0.18), new THREE.Vector2(0.13, 0.31), new THREE.Vector2(0.11, 0.37), new THREE.Vector2(0.12, 0.39), new THREE.Vector2(0.118, 0.4), new THREE.Vector2(0.1, 0.395), new THREE.Vector2(0.095, 0.36)];
	mesh(g, new THREE.LatheGeometry(prof, 40), m.stoneware());
	for (const s of [-1, 1]) {
		const lug = mesh(g, new THREE.TorusGeometry(0.03, 0.009, 6, 12, Math.PI), m.stoneware(), s * 0.128, 0.33, 0);
		lug.rotation.set(0, s > 0 ? Math.PI : 0, Math.PI / 2);
	}
	return g;
}

/** A red tin with a chrome lid and a wire handle, 14 cm across, 19 cm high. */
export function redTin(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'red tin';
	mesh(g, new THREE.CylinderGeometry(0.07, 0.07, 0.17, 32), m.red(), 0, 0.085, 0);
	mesh(g, new THREE.CylinderGeometry(0.072, 0.073, 0.022, 32), m.chrome(), 0, 0.18, 0);
	mesh(g, new THREE.SphereGeometry(0.014, 12, 8), std('#1a1a1a', 0.5)(), 0, 0.195, 0);
	const handle = mesh(g, new THREE.TorusGeometry(0.072, 0.003, 4, 24, Math.PI), m.chrome(), 0, 0.15, 0);
	handle.rotation.y = 0.4;
	return g;
}

/** A round windproof ashtray of brushed steel, 11 cm across, its lid domed. */
export function ashtray(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'ashtray';
	const prof = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.055, 0), new THREE.Vector2(0.056, 0.03), new THREE.Vector2(0.04, 0.042), new THREE.Vector2(0.012, 0.046), new THREE.Vector2(0.001, 0.046)];
	mesh(g, new THREE.LatheGeometry(prof, 32), m.chrome());
	return g;
}

/* ── hedges and ivy ───────────────────────────────────────────────────────── */

/**
 * A clipped hedge of box-leaved honeysuckle, `w` × `h` × `d`: a block with soft corners and a lumpy face of small leaves,
 * stray shoots standing out of it. Seeded.
 */
export function hedge({ w = 1.5, h = 0.7, d = 0.6, seed = 1 }: { w?: number; h?: number; d?: number; seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'hedge';
	const geo = new RoundedBoxGeometry(w, h, d, 5, Math.min(0.12, h / 3, d / 3));
	const p = geo.attributes.position!, nrm = geo.attributes.normal!, uv = geo.attributes.uv!;
	const r = seeded(seed * 131 + 17), ph = [r() * 6, r() * 6, r() * 6];
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
		const bump = 0.025 * Math.sin(x * 7 + ph[0]!) * Math.sin(z * 6 + ph[1]!) + 0.018 * Math.sin(y * 9 + x * 4 + ph[2]!);
		p.setXYZ(i, x + nrm.getX(i) * bump, y + nrm.getY(i) * bump, z + nrm.getZ(i) * bump);
		const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
		uv.setXY(i, ...((ay > 0.6 ? [x, z] : ax > 0.6 ? [z, y] : [x, y]).map((v) => v / 0.6) as [number, number]));
	}
	geo.computeVertexNormals();
	mesh(g, geo, m.hedge(), 0, h / 2, 0);
	// shoots standing out of its face
	const pts: { p: THREE.Vector3; size: number }[] = [];
	const area = 2 * (w * h + d * h) + w * d;
	for (let i = 0; i < Math.round(area * 40); i++) {
		const face = r();
		const at = face < (w * d) / area ? v3((r() - 0.5) * w, h + 0.02, (r() - 0.5) * d) : r() < 0.5 ? v3((r() - 0.5) * w, r() * h, (r() < 0.5 ? -1 : 1) * (d / 2 + 0.02)) : v3((r() < 0.5 ? -1 : 1) * (w / 2 + 0.02), r() * h, (r() - 0.5) * d);
		pts.push({ p: at, size: 0.09 + r() * 0.08 });
	}
	g.add(scatterLeaves(pts, (q) => v3(0, Math.min(q.y, h * 0.5), 0), { leaf: 'broad', tint: '#7fa064', seed }));
	return g;
}

/** Ivy grown over a stake into a cone, `h` high and `r` round at its foot: dense dark leaves over a darker core. */
export function ivyCone({ h = 1.3, r = 0.5, seed = 1 }: { h?: number; r?: number; seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'ivy cone';
	mesh(g, new THREE.ConeGeometry(r * 0.85, h * 0.95, 16), m.ivyCore(), 0, (h * 0.95) / 2, 0);
	const rnd = seeded(seed * 53 + 1);
	const pts: { p: THREE.Vector3; size: number }[] = [];
	for (let i = 0; i < 520; i++) {
		const t = Math.sqrt(rnd()), y = (1 - t) * h, a = rnd() * Math.PI * 2, rr = r * t * (0.9 + rnd() * 0.25);
		pts.push({ p: v3(Math.cos(a) * rr, y + 0.03, Math.sin(a) * rr), size: 0.12 + rnd() * 0.08 });
	}
	g.add(scatterLeaves(pts, (q) => v3(0, q.y * 0.7, 0), { leaf: 'broad', tint: '#6f8f5c', seed }));
	return g;
}
