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
