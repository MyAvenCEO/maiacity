/*
 * REUSABLE 3D MODELS — furniture and things, each built to its real measure (metres) by one function, to be placed in
 * any world (the room, a dome, a set) and shown on their own in the 3D models viewer (/app/models/).
 *
 * Every model stands on the floor at its origin (y 0 is the floor), its middle over x = 0, z = 0; its back (a bed's
 * head, a crate's back boards, a chair's backrest) towards −z, its front towards +z. A thing that hangs (the bulb)
 * hangs from its origin. Materials are shared between copies of a model, so a room full of them costs little.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { faceArt, paintedPine, pine, wool } from './textures';

const shared = <T>(make: () => T) => {
	let v: T | undefined;
	return () => (v ??= make());
};
const std = (color: string, roughness = 0.8, more: THREE.MeshStandardMaterialParameters = {}) => shared(() => new THREE.MeshStandardMaterial({ color, roughness, ...more }));
/** cloth: soft, a sheen at grazing angles as woven fabric has */
const cloth = (color: string, sheen = '#ffffff') => shared(() => new THREE.MeshPhysicalMaterial({ color, roughness: 0.92, sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color(sheen) }));

const mat = {
	oak: shared(() => new THREE.MeshStandardMaterial({ color: '#e2bd8c', map: pine(), roughness: 0.62 })),
	sheet: cloth('#7f9db3', '#c8d8e6'),
	duvet: cloth('#8e8d8a', '#c9c7c2'),
	pillow: cloth('#d9a23a', '#f2d18a'),
	crateWhite: shared(() => new THREE.MeshStandardMaterial({ map: paintedPine(), roughness: 0.78 })),
	pine: shared(() => new THREE.MeshStandardMaterial({ map: pine(), roughness: 0.74 })),
	pineDark: shared(() => new THREE.MeshStandardMaterial({ map: pine(true), roughness: 0.78 })),
	red: std('#b3222a', 0.42),
	leather: std('#8a4a2a', 0.5),
	steel: std('#9a9ca0', 0.3, { metalness: 0.85 }),
	cord: std('#1d1d1d', 0.6),
	brass: std('#b8893f', 0.35, { metalness: 0.9 }),
	porcelain: std('#f6f6f3', 0.4),
	tyre: std('#1a1a1a', 0.9),
	frameOrange: std('#e8a033', 0.45),
	wool: shared(() => new THREE.MeshStandardMaterial({ map: wool(), roughness: 1 }))
};

/** A part: a box at its place, casting shadows (and catching them, unless `catches` is false). */
function part(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, catches = true) {
	const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
	p.position.set(x, y, z);
	p.castShadow = true;
	p.receiveShadow = catches;
	g.add(p);
	return p;
}
/** A soft part: a box with rounded edges (a mattress, a pillow, a seat). */
function soft(g: THREE.Group, w: number, h: number, d: number, radius: number, m: THREE.Material, x: number, y: number, z: number) {
	const p = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(radius, w / 2, h / 2, d / 2)), m);
	p.position.set(x, y, z);
	p.castShadow = p.receiveShadow = true;
	g.add(p);
	return p;
}
/** A round bar from a to b (a leg, a tube, a spindle). */
function bar(g: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, r0: number, m: THREE.Material, r1 = r0) {
	const len = a.distanceTo(b);
	const p = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 12), m);
	p.position.copy(a).add(b).multiplyScalar(0.5);
	p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
	p.castShadow = true;
	g.add(p);
	return p;
}
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A duvet lying on a mattress (its top at 0.47) of `width` × `length`, from `from` (z, where it was thrown back) to the
 * foot: a thick layer of cloth, flat on the bed, bent round the mattress's edges and hanging down its sides and its
 * foot, crumpled all over, rolled up where it was thrown back.
 */
function duvet(width: number, length: number, from: number): THREE.Mesh {
	const t = 0.06, r = 0.07, hang = 0.09;
	// where it starts to bend over the side, the foot: its inside, crumpled in, still clears the mattress
	const ex = width / 2 + 0.08 - r, ez = length / 2 + 0.08 - r;
	const dw = 2 * (ex + (r * Math.PI) / 2 + hang), to = ez + (r * Math.PI) / 2 + hang;
	const top = 0.47 + t / 2 + 0.05; // its middle, lying flat (a crumple's deepest trough just touches the mattress)
	const geo = new THREE.BoxGeometry(dw, t, to - from, 84, 1, 72);
	const mid = (from + to) / 2;
	// u (≥ 0): how far from the middle (or along) the flat duvet → [out, down, the normal's out, the normal's up]
	const bend = (u: number, e: number) => {
		if (u <= e) return [u, 0, 0, 1] as const;
		const a = Math.min((u - e) / r, Math.PI / 2), rest = Math.max(0, u - e - (r * Math.PI) / 2);
		return [e + r * Math.sin(a), -r * (1 - Math.cos(a)) - rest, Math.sin(a), Math.cos(a)] as const;
	};
	const crumple = (x: number, z: number) =>
		0.02 * Math.sin(1.9 * x + 4.3 * z + 0.6) + 0.016 * Math.sin(5.1 * z - 2.2 * x) + 0.01 * Math.sin(9.7 * x + 3.1 * z) + 0.005 * Math.sin(17 * z + 7 * x);
	const pos = geo.attributes.position!;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i) + mid;
		const k = z - from, roll = k < 0.4 ? Math.sin((k / 0.4) * Math.PI) : 0; // thrown back: a double layer, rolled
		const off = y * (1 + roll * 1.2) + crumple(x, z) + roll * 0.05; // out along the cloth's normal
		const [ax, dx, nx, ux] = bend(Math.abs(x), ex), [az, dz, nz, uz] = bend(z, ez), s = Math.sign(x) || 1;
		pos.setXYZ(i, s * (ax + off * nx), top + Math.min(dx, dz) + off * ux * uz, az + off * nz);
	}
	geo.computeVertexNormals();
	const m = new THREE.Mesh(geo, mat.duvet());
	m.castShadow = m.receiveShadow = true;
	return m;
}

/** A pillow, `w` × `d` and `h` thick: full in its middle, thin at the seam all round, its corners rounded. */
function pillowGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
	const geo = new THREE.SphereGeometry(1, 48, 32);
	const pos = geo.attributes.position!;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		// from a ball towards a cushion: square seen from above, the stuffing pushed towards the middle
		const sx = Math.sign(x) * Math.abs(x) ** 0.4, sz = Math.sign(z) * Math.abs(z) ** 0.4;
		const edge = Math.max(Math.abs(sx), Math.abs(sz));
		pos.setXYZ(i, (sx * w) / 2, ((y * h) / 2) * (1 - 0.55 * edge ** 3), (sz * d) / 2);
	}
	geo.computeVertexNormals();
	return geo;
}

/* ── the bed ─────────────────────────────────────────────────────────────── */

export type BedOptions = { width?: number; length?: number };

/**
 * A bed: a solid oak frame of thick beams on four square legs, the mattress in its blue fitted sheet, a heavy grey
 * jersey duvet thrown back and crumpled, two plump mustard pillows at the head — 140 × 200 unless told otherwise. Its
 * head towards −z.
 */
export function bed({ width = 1.4, length = 2.0 }: BedOptions = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = `bed ${Math.round(width * 100)} × ${Math.round(length * 100)}`;
	const head = -length / 2, oak = mat.oak();
	const W = width + 0.1, Lb = length + 0.06; // the frame round the mattress
	// four square legs, the beams of the frame between them, a slatted base under the mattress
	for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) part(g, 0.09, 0.32, 0.09, oak, dx * (W / 2 - 0.045), 0.16, dz * (Lb / 2 - 0.045));
	for (const s of [-1, 1]) part(g, 0.05, 0.14, Lb - 0.18, oak, s * (W / 2 - 0.025), 0.22, 0);
	part(g, W - 0.18, 0.14, 0.05, oak, 0, 0.22, Lb / 2 - 0.025);
	part(g, W, 0.24, 0.06, oak, 0, 0.42, head - 0.03); // the head board, low and plain
	// the mattress in its sheet: soft edges, 20 cm
	soft(g, width - 0.02, 0.2, length - 0.02, 0.05, mat.sheet(), 0, 0.37, 0);
	// the duvet (a 185 × 220 one): thrown back off the head of the bed, crumpled, falling over the sides and the foot
	g.add(duvet(width, length, head + 0.62));
	// two pillows, plump, leaning back on the head board
	for (const dx of [-0.33, 0.33]) {
		const p = new THREE.Mesh(pillowGeometry(0.62 * (width / 1.4), 0.17, 0.42), mat.pillow());
		p.position.set(dx * (width / 1.4), 0.6, head + 0.24);
		p.rotation.set(0.55, dx > 0 ? -0.05 : 0.04, dx > 0 ? 0.02 : -0.03);
		p.castShadow = p.receiveShadow = true;
		g.add(p);
	}
	return g;
}

/* ── the wine crate ─────────────────────────────────────────────────────── */

/** A wine crate's measure (m): width, height, depth, and its boards' thickness. */
export const CRATE = { w: 0.5, h: 0.42, d: 0.33, t: 0.018 } as const;
export type CrateFinish = 'white' | 'pine' | 'dark';

/**
 * A wine crate standing on its end as a shelf, open to the front (+z): its back of three boards with gaps, solid ends
 * with a handle cut into each, top and bottom of two boards each, a shelf across its middle.
 */
export function wineCrate(finish: CrateFinish = 'pine'): THREE.Group {
	const g = new THREE.Group();
	g.name = `wine crate (${finish})`;
	const m = finish === 'white' ? mat.crateWhite() : finish === 'dark' ? mat.pineDark() : mat.pine();
	const { w, h, d, t } = CRATE;
	// the back: three boards across, a finger's gap between them
	const bh = (h - 2 * 0.012) / 3;
	for (let i = 0; i < 3; i++) part(g, w, bh, t, m, 0, bh / 2 + i * (bh + 0.012), -d / 2 + t / 2);
	// the ends (left and right), each with a handle hole: the board in four pieces round it
	for (const s of [-1, 1]) {
		const x = s * (w / 2 - t / 2), hole = { y0: h * 0.62, y1: h * 0.76, z: 0.11 };
		part(g, t, hole.y0, d, m, x, hole.y0 / 2, 0);
		part(g, t, h - hole.y1, d, m, x, (hole.y1 + h) / 2, 0);
		for (const zs of [-1, 1]) part(g, t, hole.y1 - hole.y0, (d - hole.z) / 2, m, x, (hole.y0 + hole.y1) / 2, zs * (hole.z / 2 + (d - hole.z) / 4));
	}
	// top and bottom: two boards each, a gap between
	for (const y of [t / 2, h - t / 2]) for (const zs of [-1, 1]) part(g, w - 2 * t, t, d / 2 - 0.006, m, 0, y, zs * (d / 4 + 0.003));
	part(g, w - 2 * t, t, d - t, m, 0, h / 2, t / 2); // the shelf
	return g;
}

/** Crates stacked into a tower, the lowest first: a bedside shelf. */
export function crateTower(finishes: CrateFinish[]): THREE.Group {
	const g = new THREE.Group();
	g.name = `crate tower (${finishes.join(', ')})`;
	finishes.forEach((f, i) => {
		const c = wineCrate(f);
		c.position.y = i * CRATE.h;
		g.add(c);
	});
	return g;
}

/* ── the chairs ─────────────────────────────────────────────────────────── */

export type ChairKind = 'red' | 'leather';

/**
 * A chair, its seat at 45 cm, its back towards −z.
 * 'red': a wooden café chair painted red — turned legs splayed a little, a round seat, back posts rising from the
 * back legs with a curved top rail and two spindles.
 * 'leather': a school chair — a frame of steel tube, a moulded seat and a curved back in brown leather.
 */
export function chair(kind: ChairKind = 'red'): THREE.Group {
	const g = new THREE.Group();
	g.name = `chair (${kind})`;
	if (kind === 'red') {
		const red = mat.red();
		for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) bar(g, v3(dx * 0.2, 0, dz * 0.2), v3(dx * 0.17, 0.44, dz * 0.17), 0.018, red, 0.014);
		// stretchers between the legs
		for (const z of [-0.19, 0.19]) bar(g, v3(-0.19, 0.16, z), v3(0.19, 0.16, z), 0.008, red);
		const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.205, 0.035, 32), red);
		seat.position.y = 0.455;
		seat.castShadow = seat.receiveShadow = true;
		g.add(seat);
		for (const s of [-1, 1]) bar(g, v3(s * 0.17, 0.44, -0.17), v3(s * 0.16, 0.86, -0.21), 0.014, red);
		const rail = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 8, 24, 1.15), red);
		rail.rotation.set(Math.PI / 2, 0, -Math.PI / 2 - 0.575);
		rail.position.set(0, 0.84, 0.09);
		rail.castShadow = true;
		g.add(rail);
		for (const x of [-0.05, 0.05]) bar(g, v3(x, 0.47, -0.19), v3(x * 1.1, 0.82, -0.215), 0.007, red);
	} else {
		const steel = mat.steel(), leather = mat.leather();
		for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) bar(g, v3(dx * 0.2, 0, dz * 0.2), v3(dx * 0.19, 0.43, dz * 0.19), 0.011, steel);
		for (const s of [-1, 1]) bar(g, v3(s * 0.19, 0.43, -0.19), v3(s * 0.19, 0.86, -0.25), 0.011, steel);
		// the moulded seat: a shallow dish, its front edge rolled down
		const seatGeo = new RoundedBoxGeometry(0.43, 0.03, 0.42, 4, 0.012);
		const sp = seatGeo.attributes.position!;
		for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) + 0.012 * (sp.getX(i) / 0.215) ** 2 - (sp.getZ(i) > 0.17 ? (sp.getZ(i) - 0.17) * 0.6 : 0));
		seatGeo.computeVertexNormals();
		const seat = new THREE.Mesh(seatGeo, leather);
		seat.position.y = 0.455;
		seat.castShadow = seat.receiveShadow = true;
		g.add(seat);
		// the back: a curved plate
		const backGeo = new RoundedBoxGeometry(0.4, 0.2, 0.025, 4, 0.01);
		const bp = backGeo.attributes.position!;
		for (let i = 0; i < bp.count; i++) bp.setZ(i, bp.getZ(i) + 0.04 * (bp.getX(i) / 0.2) ** 2);
		backGeo.computeVertexNormals();
		const back = new THREE.Mesh(backGeo, leather);
		back.position.set(0, 0.75, -0.24);
		back.rotation.x = -0.12;
		back.castShadow = true;
		g.add(back);
	}
	return g;
}

/* ── the Edison bulb ────────────────────────────────────────────────────── */

/**
 * A yellow retro Edison bulb on a short black cord, hung from its origin (the ceiling) down: a little ceiling hook,
 * `drop` metres of fabric cord, a brass cap, the amber glass as a teardrop with its filament glowing inside. Its glass
 * and filament are its own materials (`userData.glass`, `userData.filament`), so a world can make it glow, and
 * `userData.light` is where its light comes from (under the origin).
 */
export function edisonBulb({ drop = 0.32 }: { drop?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'Edison bulb';
	const hook = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 16), mat.cord());
	hook.position.y = -0.014;
	const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, drop, 8), mat.cord());
	cord.position.y = -drop / 2;
	const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.0135, 0.03, 16), mat.brass());
	cap.position.y = -drop - 0.015;
	// the glass: a teardrop turned on a lathe, 6.4 cm across, 14 cm long
	const profile: THREE.Vector2[] = [];
	for (let i = 0; i <= 24; i++) {
		const t = i / 24, y = -0.14 * t;
		const rr = t < 0.18 ? 0.014 + t * 0.06 : 0.032 * Math.sin(Math.PI * Math.min(1, (t - 0.1) / 0.92)) + 0.004 * (1 - t);
		profile.push(new THREE.Vector2(Math.max(0.0005, rr), y));
	}
	const glass = new THREE.MeshPhysicalMaterial({ color: '#e7a83c', emissive: '#ff9d2e', emissiveIntensity: 0.6, roughness: 0.12, transparent: true, opacity: 0.78, sheen: 0 });
	const bulb = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), glass);
	bulb.position.y = -drop - 0.03;
	// the filament: glowing loops inside
	const filament = new THREE.MeshBasicMaterial({ color: '#ffd28a' });
	for (let k = 0; k < 4; k++) {
		const loop = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0009, 4, 18, Math.PI), filament);
		loop.rotation.set(0, (k / 4) * Math.PI, Math.PI);
		loop.position.y = -drop - 0.11;
		g.add(loop);
	}
	g.add(hook, cord, cap, bulb);
	g.userData.glass = glass;
	g.userData.filament = filament;
	g.userData.light = new THREE.Vector3(0, -drop - 0.1, 0);
	return g;
}

/* ── the picture ────────────────────────────────────────────────────────── */

/**
 * The framed picture: a painted face on white paper behind glass, in a slim orange frame — 50 × 65 cm. Its back on
 * the wall at its origin's z = 0, facing +z; its lower edge at y 0 (hang it by its position).
 */
export function framedPicture({ w = 0.5, h = 0.65 }: { w?: number; h?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'framed picture';
	const f = 0.028, depth = 0.025, frame = mat.frameOrange();
	part(g, w, f, depth, frame, 0, f / 2, depth / 2);
	part(g, w, f, depth, frame, 0, h - f / 2, depth / 2);
	part(g, f, h - 2 * f, depth, frame, -w / 2 + f / 2, h / 2, depth / 2);
	part(g, f, h - 2 * f, depth, frame, w / 2 - f / 2, h / 2, depth / 2);
	const art = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * f, h - 2 * f), new THREE.MeshStandardMaterial({ map: faceArt(), roughness: 0.85 }));
	art.position.set(0, h / 2, depth * 0.4);
	art.receiveShadow = true;
	g.add(art);
	const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * f, h - 2 * f), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.04, transparent: true, opacity: 0.08, depthWrite: false }));
	glass.position.set(0, h / 2, depth * 0.75);
	g.add(glass);
	return g;
}

/* ── the sheepskin ──────────────────────────────────────────────────────── */

/** A white sheepskin rug, about 1 × 0.7 m: a soft irregular outline, the wool a little thick. */
export function sheepskin(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'sheepskin';
	const shape = new THREE.Shape();
	const N = 28;
	for (let i = 0; i <= N; i++) {
		const a = (i / N) * Math.PI * 2;
		const lobe = 1 + 0.18 * Math.cos(a * 4) + 0.07 * Math.sin(a * 7 + 1);
		const x = Math.cos(a) * 0.5 * lobe, z = Math.sin(a) * 0.35 * lobe;
		if (i === 0) shape.moveTo(x, z);
		else shape.lineTo(x, z);
	}
	const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.02, bevelSegments: 3 });
	geo.rotateX(Math.PI / 2);
	const uv = geo.attributes.uv!;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
	const rug = new THREE.Mesh(geo, mat.wool());
	rug.position.y = 0.037;
	rug.receiveShadow = true;
	g.add(rug);
	return g;
}

/* ── the truck ──────────────────────────────────────────────────────────── */

const truckGlass = std('#223038', 0.15, { metalness: 0.4 });

/**
 * A truck: a cab and a box trailer on a long chassis, eight wheels — about 16 m long, 2.55 m wide, 4 m high. It drives
 * towards +z. `cab` and `box` are their paint.
 */
export function truck({ cab = '#c8c4bc', box = '#dcdad4' }: { cab?: string; box?: string } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'truck';
	const paint = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
	const tyre = mat.tyre();
	// as the tired land's trucks always were (Day 19's shots): shadows cast, none caught
	part(g, 2.55, 3.1, 12, paint(box), 0, 2.45, -1.2, false); // the trailer
	part(g, 2.5, 2.6, 2.4, paint(cab), 0, 2.1, 6.2, false); // the cab
	part(g, 2.3, 1.0, 0.05, truckGlass(), 0, 2.7, 7.42, false); // its windscreen
	part(g, 2.3, 0.5, 15, tyre, 0, 0.7, 0, false); // the chassis
	for (const z of [-5.8, -4.6, 3.4, 6.4])
		for (const x of [-1.15, 1.15]) {
			const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), tyre);
			wheel.rotation.z = Math.PI / 2;
			wheel.position.set(x, 0.5, z);
			wheel.castShadow = true;
			g.add(wheel);
		}
	return g;
}

/* ── the Neewer CB60 RGB on its light stand ─────────────────────────────── */

/**
 * The CB60 RGB's measure (m), from Neewer's drawings and specs (the `neewer-cb60` skill): the body 12.5 × 12.3 cm with
 * rounded corners, 20 cm from the back panel to the Bowens flange; the LED module 4.8 cm in front of it; the stock
 * reflector 18 cm across, 14 cm deep, on a 10 cm collar; the tilt axis 8.9 cm under the beam.
 */
export const CB60 = {
	body: { w: 0.125, h: 0.123, l: 0.2, r: 0.028 },
	led: 0.048,
	reflector: { depth: 0.14, back: 0.05, front: 0.09 },
	axle: 0.089
} as const;

const fixture = {
	body: std('#161616', 0.6, { metalness: 0.3 }),
	stand: std('#1b1b1b', 0.45, { metalness: 0.35 }),
	chrome: std('#c9c9c9', 0.25, { metalness: 0.95 }),
	fins: std('#b9bcc0', 0.35, { metalness: 0.9 }),
	silver: shared(() => new THREE.MeshStandardMaterial({ color: '#dcdcdc', roughness: 0.22, metalness: 1, side: THREE.BackSide })),
	panel: std('#0c0c0c', 0.35),
	lcd: std('#1d2a2f', 0.2, { emissive: '#22343a', emissiveIntensity: 0.6 }),
	print: std('#cfcfcf', 0.5),
	red: std('#b0262a', 0.45, { emissive: '#7a0d10', emissiveIntensity: 0.4 }),
	brass: std('#b8893f', 0.35, { metalness: 0.9 }),
	rubber: std('#262626', 0.9)
};

/**
 * The Neewer CB60 RGB on a black three-legged light stand with leg braces (a Manfrotto). The head: a black body with
 * rounded corners, the carry handle across its rear top, side vents, the back panel (the LCD, five buttons, the knob,
 * the power inlet, the antenna), the LED module in front of the Bowens flange and the stock reflector — on a single
 * knuckle that tilts it, on the stand's 5/8" spigot. The stand on the floor at its origin, the light pointing towards
 * +z, tilted by `tilt` (radians, negative = down); `height` is the beam's height above the floor when level.
 * userData: `face` (the LED's material, to glow), `beam` (where the light leaves, in the model's space) and `aim` (its
 * direction).
 */
export function neewerCb60({ height = 1.5, tilt = -0.18 }: { height?: number; tilt?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'Neewer CB60 RGB on a light stand';
	const st = fixture.stand();
	const { w, h, l, r } = CB60.body;
	const axleY = height - CB60.axle, receiver = axleY - 0.071; // the receiver's foot, 9.7 cm under the body
	// the stand: three legs from a collar on the column, braces to a lower collar, the column in three sections
	const legTop = 0.62, braceAt = 0.3, spread = 0.46;
	bar(g, v3(0, 0.02, 0), v3(0, receiver + 0.04, 0), 0.008, st); // the spigot's top section
	bar(g, v3(0, 0.02, 0), v3(0, 0.95, 0), 0.0165, st);
	bar(g, v3(0, 0.95, 0), v3(0, Math.min(receiver - 0.05, 1.32), 0), 0.0125, st);
	for (const y of [0.95, Math.min(receiver - 0.05, 1.32)]) {
		const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.035, 14), st);
		lock.position.y = y;
		g.add(lock);
		bar(g, v3(0.02, y, 0), v3(0.05, y, 0), 0.005, fixture.red()); // the lock's knob
	}
	for (const y of [legTop, braceAt]) {
		const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 14), st);
		collar.position.y = y;
		g.add(collar);
	}
	for (let k = 0; k < 3; k++) {
		const a = (k / 3) * Math.PI * 2 + Math.PI / 6, cx = Math.sin(a), cz = Math.cos(a);
		const foot = v3(cx * spread, 0.015, cz * spread);
		bar(g, v3(cx * 0.03, legTop, cz * 0.03), foot, 0.008, st);
		bar(g, v3(cx * 0.03, braceAt, cz * 0.03), v3(cx * spread * 0.55, legTop * 0.45, cz * spread * 0.55), 0.005, st);
		const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 10), fixture.rubber());
		pad.position.copy(foot).setY(0.015);
		g.add(pad);
	}
	// the knuckle: the receiver on the spigot with its T-knob, the tilt axle and its lever
	const body = fixture.body();
	part(g, 0.028, 0.06, 0.028, body, 0, receiver + 0.03, 0.02, false);
	bar(g, v3(0.014, receiver + 0.02, 0.02), v3(0.045, receiver + 0.02, 0.02), 0.004, body); // the T-knob
	part(g, 0.03, 0.014, 0.012, body, 0.045, receiver + 0.02, 0.02, false);
	// the head: everything from here tilts round the axle, 8.9 cm under the beam, 12 cm forward of the back panel
	const head = new THREE.Group();
	head.position.set(0, axleY, 0.02);
	head.rotation.x = -tilt;
	g.add(head);
	const z0 = -0.12; // the back panel, from the axle
	const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.034, 16), body);
	axle.rotation.z = Math.PI / 2;
	head.add(axle);
	part(head, 0.03, 0.027, 0.055, body, 0, 0.0137, 0, false); // the plate, from the axle up to the body's underside
	bar(head, v3(0.017, 0, 0), v3(0.06, -0.06, 0.03), 0.005, body); // the angle lever, about 8 cm
	// the body: rounded corners, the flange at its front
	const shell = new THREE.Mesh(new RoundedBoxGeometry(w, h, l, 4, r), body);
	shell.position.set(0, CB60.axle, z0 + l / 2);
	shell.castShadow = shell.receiveShadow = true;
	head.add(shell);
	const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.007, 36), fixture.chrome());
	flange.rotation.x = Math.PI / 2;
	flange.position.set(0, CB60.axle, z0 + l + 0.0035);
	head.add(flange);
	// side vents (four rows of slots on each side of the rear housing) and the name print above them
	for (const s of [-1, 1]) {
		for (let row = 0; row < 4; row++)
			for (let k = 0; k < 6; k++) part(head, 0.002, 0.006, 0.014, fixture.panel(), s * (w / 2 + 0.0005), CB60.axle - 0.012 - row * 0.011, z0 + 0.035 + k * 0.019, false);
		part(head, 0.001, 0.008, 0.06, fixture.print(), s * (w / 2 + 0.0008), CB60.axle + 0.022, z0 + 0.08, false);
	}
	// the carry handle: across the rear top, 10.5 cm wide, rising 3.4 cm, a strap 2.5 cm deep
	const handle = new THREE.Mesh(new THREE.TorusGeometry(0.049, 0.0055, 8, 28, Math.PI), body);
	handle.scale.set(1, 0.69, 2.2);
	handle.position.set(0, CB60.axle + h / 2 - 0.002, z0 + 0.03);
	head.add(handle);
	// the back panel, as seen facing it (x to the right is the head's −x)
	const back = (x: number, y: number) => v3(-x / 100, CB60.axle + y / 100, z0 - 0.002);
	const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.095), fixture.panel());
	plate.rotation.y = Math.PI;
	plate.position.copy(back(0, 0.5));
	head.add(plate);
	const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.039, 0.028), fixture.lcd());
	screen.rotation.y = Math.PI;
	screen.position.copy(back(0, 3.6)).setZ(z0 - 0.003);
	head.add(screen);
	for (const bx of [-3.8, -1.9, 0, 1.9, 3.8]) {
		const p = back(bx, 1.05);
		part(head, 0.008, 0.008, 0.004, fixture.body(), p.x, p.y, z0 - 0.004, false);
	}
	{
		const p = back(0, -1.8);
		part(head, 0.031, 0.034, 0.004, fixture.rubber(), p.x, p.y, z0 - 0.003, false); // the power inlet
		const sw = back(-3.3, -1.0);
		part(head, 0.01, 0.004, 0.004, fixture.chrome(), sw.x, sw.y, z0 - 0.004, false); // BT ↔ 2.4G
		const led = back(-3.3, -2.3);
		part(head, 0.004, 0.004, 0.003, fixture.red(), led.x, led.y, z0 - 0.003, false);
		const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.02, 10), fixture.body());
		ant.rotation.x = Math.PI / 2;
		ant.position.copy(back(-3.5, 3.9)).setZ(z0 - 0.01);
		head.add(ant);
	}
	const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.013, 24), fixture.chrome());
	knob.rotation.x = Math.PI / 2;
	knob.position.copy(back(3.25, -1.7)).setZ(z0 - 0.0065);
	head.add(knob);
	// the LED module in front of the flange: the radial fin ring, the white cup, the emitting disc
	const ledAt = z0 + l + 0.007;
	const fins = new THREE.Mesh(new THREE.CylinderGeometry(0.0445, 0.0445, 0.03, 48), fixture.fins());
	fins.rotation.x = Math.PI / 2;
	fins.position.set(0, CB60.axle, ledAt + 0.015);
	head.add(fins);
	const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.03, 0.018, 36), std('#f1efe8', 0.4)());
	cup.rotation.x = Math.PI / 2;
	cup.position.set(0, CB60.axle, ledAt + 0.039);
	head.add(cup);
	const face = new THREE.MeshStandardMaterial({ color: '#f6f1df', emissive: '#fff2dc', emissiveIntensity: 0, roughness: 0.35 });
	const disc = new THREE.Mesh(new THREE.CircleGeometry(0.02, 32), face);
	disc.position.set(0, CB60.axle, ledAt + CB60.led + 0.0005);
	head.add(disc);
	// the stock reflector on the flange: black outside, faceted silver inside, a rolled rim
	const { depth, back: rb, front: rf } = CB60.reflector;
	const profile: THREE.Vector2[] = [];
	for (let i = 0; i <= 16; i++) {
		const t = i / 16;
		profile.push(new THREE.Vector2(rb + (rf - rb) * t, depth * t));
	}
	const reflectorGeo = new THREE.LatheGeometry(profile, 40);
	for (const m of [new THREE.Mesh(reflectorGeo, fixture.body()), new THREE.Mesh(reflectorGeo, fixture.silver())]) {
		m.rotation.x = Math.PI / 2;
		m.position.set(0, CB60.axle, z0 + l + 0.007);
		m.castShadow = m.material !== fixture.silver();
		head.add(m);
	}
	const lip = new THREE.Mesh(new THREE.TorusGeometry(rf, 0.004, 6, 48), fixture.chrome());
	lip.position.set(0, CB60.axle, z0 + l + 0.007 + depth);
	head.add(lip);
	head.updateMatrix();
	g.userData.face = face;
	g.userData.beam = v3(0, CB60.axle, ledAt + CB60.led + 0.01).applyMatrix4(head.matrix);
	g.userData.aim = v3(0, 0, 1).applyEuler(head.rotation);
	return g;
}

/* ── the stand-in: a neutral figure to block shots with ─────────────────── */

export type StandInPose = 'stand' | 'sit' | 'fallen';

/**
 * A stand-in: a neutral clay-grey figure of 1.80 m, as a film blocks a shot before its actor is there (Spielberg's
 * second team) — never a likeness of anyone. `stand` upright, arms down; `sit` on an edge 0.5 m high, elbows on the
 * knees; `fallen` back from that edge — the legs still over it, the back on the bed, arms out, the face to the ceiling.
 * Its feet (or its seat) at its origin, facing +z.
 */
export function standIn(pose: StandInPose = 'stand'): THREE.Group {
	const g = new THREE.Group();
	g.name = `stand-in, ${pose}`;
	const clay = std('#a8a49b', 0.92)();
	const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
		const len = a.distanceTo(b);
		const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 12), clay);
		m.position.copy(a).add(b).multiplyScalar(0.5);
		m.quaternion.setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize());
		m.castShadow = m.receiveShadow = true;
		g.add(m);
	};
	const ball = (at: THREE.Vector3, r: number, sy = 1) => {
		const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), clay);
		m.position.copy(at);
		m.scale.y = sy;
		m.castShadow = m.receiveShadow = true;
		g.add(m);
	};
	// the joints of each pose (m): hips, shoulders, head; knees and feet; elbows and hands, left and right (±x)
	const J = {
		stand: { hip: v3(0, 0.95, 0), neck: v3(0, 1.48, 0), head: v3(0, 1.67, 0.01), knee: [0.1, 0.5, 0.02], foot: [0.11, 0.06, 0.05], elbow: [0.24, 1.16, -0.02], hand: [0.25, 0.86, 0.03] },
		sit: { hip: v3(0, 0.52, 0), neck: v3(0, 1.0, 0.1), head: v3(0, 1.2, 0.16), knee: [0.11, 0.52, 0.44], foot: [0.12, 0.05, 0.48], elbow: [0.2, 0.6, 0.36], hand: [0.05, 0.58, 0.46] },
		fallen: { hip: v3(0, 0.52, 0), neck: v3(0, 0.6, -0.52), head: v3(0, 0.63, -0.72), knee: [0.12, 0.5, 0.42], foot: [0.13, 0.05, 0.46], elbow: [0.46, 0.6, -0.56], hand: [0.66, 0.6, -0.4] }
	}[pose];
	// the trunk: the pelvis, the torso up to the neck, the head
	const chest = J.hip.clone().lerp(J.neck, 0.62);
	limb(J.hip, chest, 0.15);
	limb(chest, J.neck, 0.17);
	ball(J.head, 0.105, 1.15);
	// which way it looks: a nose, and a darker band where the eyes are
	const look = (pose === 'fallen' ? v3(0, 1, 0) : pose === 'sit' ? v3(0, -0.25, 1) : v3(0, 0, 1)).normalize();
	const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 10), clay);
	nose.position.copy(J.head).addScaledVector(look, 0.11);
	nose.quaternion.setFromUnitVectors(v3(0, 1, 0), look);
	g.add(nose);
	// two dark eyes either side of the nose, a little above it
	const side = pose === 'fallen' ? v3(1, 0, 0) : v3(0, 1, 0).cross(look).normalize();
	const brow = pose === 'fallen' ? v3(0, 0, -1) : v3(0, 1, 0);
	for (const e of [-1, 1]) {
		const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), std('#4a4740', 0.8)());
		eye.position.copy(J.head).addScaledVector(look, 0.095).addScaledVector(side, e * 0.04).addScaledVector(brow, 0.03);
		g.add(eye);
	}
	for (const s of [-1, 1]) {
		const at = (p: number[]) => v3(s * p[0]!, p[1]!, p[2]!);
		const hip = J.hip.clone().add(v3(s * 0.1, -0.03, 0));
		const shoulder = J.neck.clone().add(J.neck.clone().sub(J.hip).normalize().multiplyScalar(-0.05)).add(v3(s * 0.2, 0, 0));
		limb(hip, at(J.knee), 0.075);
		limb(at(J.knee), at(J.foot), 0.06);
		const foot = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.07, 0.25, 2, 0.03), clay);
		foot.position.copy(at(J.foot)).add(v3(0, -0.02, 0.07));
		foot.castShadow = true;
		g.add(foot);
		limb(shoulder, at(J.elbow), 0.05);
		limb(at(J.elbow), at(J.hand), 0.042);
		ball(at(J.hand), 0.05);
	}
	return g;
}
