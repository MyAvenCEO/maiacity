/*
 * THE TERRACE'S MODELS — the backyard's pergola terrace (src/lib/worlds/backyard): the cognac leather club sofa, the
 * bamboo coffee table with its smoked glass, the white bistro table and its black moulded chairs, the paper lanterns,
 * the tall white ribbed planters with their herbs, the old olive tree in its bowl, the potted plants (the bird of
 * paradise, the monstera, the ficus, a geranium), terracotta pots, a string of festoon lights, and the two toys on the
 * wall's ledge. Each to its real measure, standing on the floor at its origin, its back towards −z, its front towards
 * +z; a thing that hangs hangs from its origin.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bar, part, shared, soft, std, v3 } from './parts';
import { beeStripes, lanternPaper, leather, monsteraLeaf, ribs } from './textures';
import { bark, bush, seeded, stems } from './outdoor';

const m = {
	leather: shared(() => new THREE.MeshPhysicalMaterial({ map: leather(), color: '#f3d6bd', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.55 })),
	darkWood: std('#2b1a11', 0.55),
	bamboo: std('#5b3722', 0.42),
	node: std('#33201a', 0.5),
	smoked: shared(() => new THREE.MeshPhysicalMaterial({ color: '#3b2d22', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.62 })),
	white: std('#f2f0ea', 0.38),
	whiteTube: std('#eeede8', 0.32, { metalness: 0.25 }),
	glide: std('#2a2a2a', 0.7),
	moulded: std('#1e1e20', 0.62),
	paper: shared(() => new THREE.MeshStandardMaterial({ map: lanternPaper(), roughness: 0.86, emissive: '#ffcf8f', emissiveIntensity: 0, side: THREE.DoubleSide })),
	wire: std('#d9d9d4', 0.35, { metalness: 0.7 }),
	planter: shared(() => new THREE.MeshStandardMaterial({ color: '#efede5', roughness: 0.55, bumpMap: ribs(), bumpScale: 1.4 })),
	soil: std('#2b1f16', 0.97),
	terracotta: std('#b4623c', 0.88),
	bowl: std('#b55a37', 0.62),
	brass: std('#b28c46', 0.32, { metalness: 0.85 }),
	ceramic: std('#f3f2ee', 0.18),
	glaze: std('#576e5b', 0.22, { metalness: 0.15 }),
	stalk: std('#4c6a31', 0.6),
	blade: shared(() => new THREE.MeshStandardMaterial({ color: '#3a6a32', roughness: 0.5, side: THREE.DoubleSide })),
	monstera: shared(() => new THREE.MeshStandardMaterial({ map: monsteraLeaf(), alphaTest: 0.5, roughness: 0.38, side: THREE.DoubleSide })),
	oliveBark: shared(() => new THREE.MeshStandardMaterial({ map: bark(), color: new THREE.Color(1.3, 1.22, 1.1), roughness: 0.96 })),
	cable: std('#141414', 0.6),
	socket: std('#1b1b1b', 0.5),
	bulb: shared(() => new THREE.MeshStandardMaterial({ color: '#fff4dc', roughness: 0.2, emissive: '#ffcc80', emissiveIntensity: 0.1 })),
	plush: std('#6b4225', 0.95),
	face: std('#e2b98e', 0.92),
	shirt: std('#c42a2a', 0.9),
	eye: std('#0d0d0d', 0.3),
	bee: shared(() => new THREE.MeshStandardMaterial({ map: beeStripes(), roughness: 0.95 })),
	yellow: std('#f4c21a', 0.95),
	black: std('#1c1a17', 0.9),
	wing: shared(() => new THREE.MeshStandardMaterial({ color: '#f4f6ff', roughness: 0.6, transparent: true, opacity: 0.75, side: THREE.DoubleSide })),
	flower: std('#e893b2', 0.7),
	redFlower: std('#c8242f', 0.7)
};

const mesh = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
	const o = new THREE.Mesh(geo, mat);
	o.position.set(x, y, z);
	o.castShadow = o.receiveShadow = true;
	g.add(o);
	return o;
};
/** a ball stretched to radii (an ellipsoid) */
const ball = (g: THREE.Group, rx: number, ry: number, rz: number, mat: THREE.Material, x: number, y: number, z: number) => {
	const o = mesh(g, new THREE.SphereGeometry(1, 20, 14), mat, x, y, z);
	o.scale.set(rx, ry, rz);
	return o;
};

/* ── the club sofa ────────────────────────────────────────────────────────── */

/**
 * A three-seat club sofa in cognac leather, worn pale on its seat and the tops of its arms: 1.95 × 0.92 m, 80 cm high,
 * its seat at 45 cm. Low rolled arms scrolled outwards, a tight back curving down to them, three plump seat cushions,
 * short dark feet. Its back towards −z.
 */
export function clubSofa(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'club sofa';
	const L = m.leather(), W = 1.95, D = 0.92;
	for (const [x, z] of [[-0.84, -0.36], [0.84, -0.36], [-0.84, 0.36], [0.84, 0.36]] as const) mesh(g, new THREE.CylinderGeometry(0.028, 0.02, 0.07, 14), m.darkWood(), x, 0.035, z);
	// the base under the cushions, its front a little rounded
	soft(g, W - 0.06, 0.24, D - 0.06, 0.06, L, 0, 0.19, 0.01);
	// the back: higher in its middle, curving down to the arms, its top rolled
	const back = new RoundedBoxGeometry(1.58, 0.52, 0.26, 5, 0.1);
	const bp = back.attributes.position!;
	for (let i = 0; i < bp.count; i++) {
		const x = bp.getX(i), y = bp.getY(i);
		if (y > 0) bp.setY(i, y - 0.075 * (x / 0.79) ** 2 * (y / 0.26));
	}
	back.computeVertexNormals();
	const b = mesh(g, back, L, 0, 0.56, -0.33);
	b.rotation.x = -0.08;
	// the arms: a panel and its roll, scrolled out over it; the roll's end the scroll seen from the front
	for (const s of [-1, 1]) {
		soft(g, 0.2, 0.46, D - 0.04, 0.06, L, s * (W / 2 - 0.11), 0.3, 0);
		const roll = mesh(g, new THREE.CylinderGeometry(0.125, 0.125, D - 0.03, 28), L, s * (W / 2 - 0.085), 0.555, 0.005);
		roll.rotation.x = Math.PI / 2;
	}
	// three seat cushions, crowned, and three back cushions leaning on the back
	for (const x of [-0.51, 0, 0.51]) {
		const cushion = new RoundedBoxGeometry(0.5, 0.15, 0.64, 5, 0.06);
		const cp = cushion.attributes.position!;
		for (let i = 0; i < cp.count; i++) {
			const cx = cp.getX(i), cy = cp.getY(i), cz = cp.getZ(i);
			if (cy > 0) cp.setY(i, cy + 0.025 * Math.max(0, 1 - (cx / 0.25) ** 2) * Math.max(0, 1 - (cz / 0.32) ** 2));
		}
		cushion.computeVertexNormals();
		mesh(g, cushion, L, x, 0.385, 0.1);
		const bc = soft(g, 0.5, 0.36, 0.14, 0.06, L, x, 0.62, -0.17);
		bc.rotation.x = -0.16;
	}
	return g;
}

/* ── the bamboo coffee table ──────────────────────────────────────────────── */

/** A low table of dark bamboo canes, its nodes ringed, a smoked glass top: 66 × 48 cm, 45 cm high, a shelf of canes
 *  under it. */
export function bambooTable(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'bamboo coffee table';
	const W = 0.66, D = 0.48, H = 0.45, cane = m.bamboo(), node = m.node();
	const lx = W / 2 - 0.025, lz = D / 2 - 0.025;
	for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]] as const) {
		bar(g, v3(x, 0, z), v3(x, H - 0.012, z), 0.016, cane);
		for (const y of [0.06, 0.22, 0.38]) {
			const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.004, 6, 14), node);
			ring.rotation.x = Math.PI / 2;
			ring.position.set(x, y, z);
			g.add(ring);
		}
	}
	for (const y of [H - 0.035, 0.1]) {
		for (const z of [-lz, lz]) bar(g, v3(-lx, y, z), v3(lx, y, z), 0.012, cane);
		for (const x of [-lx, lx]) bar(g, v3(x, y, -lz), v3(x, y, lz), 0.012, cane);
	}
	for (let i = 0; i < 9; i++) bar(g, v3(-lx + 0.04 + i * ((2 * lx - 0.08) / 8), 0.115, -lz), v3(-lx + 0.04 + i * ((2 * lx - 0.08) / 8), 0.115, lz), 0.008, cane);
	part(g, W - 0.03, 0.008, D - 0.03, m.smoked(), 0, H - 0.008, 0, false);
	return g;
}

/* ── the bistro set ───────────────────────────────────────────────────────── */

/** A round bistro table, its white top 60 cm across at 73 cm, on white tube legs splayed from under its middle. */
export function bistroTable(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'bistro table';
	mesh(g, new THREE.CylinderGeometry(0.3, 0.3, 0.022, 48), m.white(), 0, 0.719, 0);
	const edge = mesh(g, new THREE.TorusGeometry(0.299, 0.011, 8, 48), m.white(), 0, 0.719, 0);
	edge.rotation.x = Math.PI / 2;
	mesh(g, new THREE.CylinderGeometry(0.07, 0.07, 0.03, 20), m.whiteTube(), 0, 0.693, 0);
	for (let k = 0; k < 4; k++) {
		const a = Math.PI / 4 + (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
		bar(g, v3(c * 0.06, 0.69, s * 0.06), v3(c * 0.15, 0.36, s * 0.15), 0.011, m.whiteTube());
		bar(g, v3(c * 0.15, 0.36, s * 0.15), v3(c * 0.3, 0.01, s * 0.3), 0.011, m.whiteTube());
		mesh(g, new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10), m.glide(), c * 0.3, 0.006, s * 0.3);
	}
	return g;
}

/** A stacking chair moulded in one piece of black polypropylene: thick legs, a dished seat at 46 cm, the back legs
 *  rising into a curved back to 84 cm. */
export function bistroChair(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'bistro chair';
	const p = m.moulded();
	for (const s of [-1, 1]) {
		bar(g, v3(s * 0.205, 0, 0.215), v3(s * 0.19, 0.445, 0.185), 0.016, p, 0.019);
		bar(g, v3(s * 0.2, 0, -0.235), v3(s * 0.19, 0.445, -0.19), 0.016, p, 0.019);
		bar(g, v3(s * 0.19, 0.445, -0.19), v3(s * 0.175, 0.83, -0.27), 0.019, p, 0.016);
	}
	const seat = new RoundedBoxGeometry(0.44, 0.032, 0.44, 4, 0.013);
	const sp = seat.attributes.position!;
	for (let i = 0; i < sp.count; i++) {
		const x = sp.getX(i), z = sp.getZ(i);
		sp.setY(i, sp.getY(i) + 0.014 * (x / 0.22) ** 2 - (z > 0.15 ? (z - 0.15) * 0.45 : 0) + (z < -0.12 ? (-0.12 - z) * 0.3 : 0));
	}
	seat.computeVertexNormals();
	mesh(g, seat, p, 0, 0.455, -0.005);
	const back = new RoundedBoxGeometry(0.38, 0.3, 0.022, 4, 0.01);
	const bp = back.attributes.position!;
	for (let i = 0; i < bp.count; i++) bp.setZ(i, bp.getZ(i) + 0.05 * (bp.getX(i) / 0.19) ** 2);
	back.computeVertexNormals();
	const bk = mesh(g, back, p, 0, 0.67, -0.245);
	bk.rotation.x = -0.2;
	return g;
}

/* ── the paper lanterns ───────────────────────────────────────────────────── */

/**
 * A round paper lantern, `d` across (they hang 20–45 cm), on a wire `drop` below its hook: white paper on wire ribs,
 * open at the top and wider at the bottom. All lanterns share one paper (`userData.glass`), so a world lights them
 * together; `userData.light` is its middle, where a light inside it would be.
 */
export function paperLantern({ d = 0.35, drop = 0.3 }: { d?: number; drop?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'paper lantern';
	const R = d / 2, cy = -drop - R;
	const prof: THREE.Vector2[] = [];
	for (let i = 0; i <= 32; i++) {
		const phi = 0.36 + (i / 32) * (Math.PI - 0.36 - 0.13);
		// the ribs pull the paper in a little between them
		const rib = 1 - 0.012 * Math.abs(Math.sin(i * Math.PI * 0.5));
		prof.push(new THREE.Vector2(R * Math.sin(phi) * rib, cy - R * Math.cos(phi) * 0.96));
	}
	const paper = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), m.paper());
	paper.castShadow = true;
	g.add(paper);
	bar(g, v3(0, 0, 0), v3(0, cy + R * 0.95, 0), 0.0012, m.wire());
	for (const [y, rr] of [[cy + R * 0.955, R * 0.13], [cy - R * 0.9, R * 0.35]] as const) {
		const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0015, 4, 20), m.wire());
		ring.rotation.x = Math.PI / 2;
		ring.position.y = y;
		g.add(ring);
	}
	g.userData = { glass: m.paper(), light: v3(0, cy, 0) };
	return g;
}

/* ── the planters and their herbs ─────────────────────────────────────────── */

export type Herb = 'mint' | 'oregano' | 'lavender' | 'rosemary' | 'trailing' | 'rosemary in flower' | 'none';

/** the plant a planter or a pot grows, `top` its soil's height, `w` its width */
function herb(g: THREE.Group, kind: Herb, top: number, w: number, seed: number) {
	const b = (o: Parameters<typeof bush>[0]) => g.add(bush({ seed, base: top - 0.03, ...o }));
	if (kind === 'mint') b({ w: w * 1.2, h: 0.34, cards: 150, card: 0.1, leaf: 'broad', tint: '#d5efa6', gain: 1.15 });
	if (kind === 'oregano') b({ w: w * 1.15, h: 0.26, cards: 170, card: 0.08, leaf: 'broad', tint: '#c4dc9a', gain: 1.1 });
	if (kind === 'lavender') b({ w: w * 1.35, h: 0.46, cards: 300, card: 0.09, leaf: 'narrow', tint: '#e6ecdb', gain: 1.6 });
	if (kind === 'rosemary' || kind === 'rosemary in flower') {
		b({ w: w * 1.1, h: 0.55, cards: 260, card: 0.1, leaf: 'narrow', tint: '#a2b394', gain: 1.15 });
		const r = seeded(seed * 3 + 1);
		// its stiff stems up through it
		for (let i = 0; i < 9; i++) bar(g, v3((r() - 0.5) * w * 0.6, top, (r() - 0.5) * w * 0.6), v3((r() - 0.5) * w * 0.9, top + 0.4 + r() * 0.25, (r() - 0.5) * w * 0.9), 0.004, m.stalk());
		if (kind === 'rosemary in flower')
			for (let i = 0; i < 14; i++) {
				const f = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), m.redFlower());
				f.position.set((r() - 0.5) * w * 0.9, top + 0.12 + r() * 0.3, (r() - 0.5) * w * 0.9);
				g.add(f);
			}
	}
	if (kind === 'trailing') {
		b({ w: w * 1.05, h: 0.2, cards: 60, card: 0.1, leaf: 'broad', tint: '#e6f0cf' });
		const r = seeded(seed * 5 + 2);
		const lines: [THREE.Vector3, THREE.Vector3][] = [];
		for (let i = 0; i < 14; i++) {
			const side = i % 4, t = r() - 0.5, h = w / 2 + 0.02;
			const [x, z] = side === 0 ? [t * w, h] : side === 1 ? [h, t * w] : side === 2 ? [t * w, -h] : [-h, t * w];
			lines.push([v3(x * 0.8, top + 0.02, z * 0.8), v3(x * 1.1, top - 0.25 - r() * 0.35, z * 1.1)]);
		}
		g.add(stems(lines, { card: 0.075, per: 30, tint: '#e9f2d6', seed, spread: 0.03 }));
	}
}

/**
 * A tall planter of white fibreglass, square and a little tapered, ribbed across every 2.5 cm: `w` across the top,
 * `h` high, its soil 5 cm under the rim and a herb growing out of it.
 */
export function ribbedPlanter({ w = 0.4, h = 0.85, plant = 'mint', seed = 1 }: { w?: number; h?: number; plant?: Herb; seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = `planter, ${plant}`;
	const geo = new THREE.CylinderGeometry(w / Math.SQRT2, (w * 0.86) / Math.SQRT2, h, 4, 1, true);
	geo.rotateY(Math.PI / 4);
	const uv = geo.attributes.uv!;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * (h / 0.1));
	mesh(g, geo, m.planter(), 0, h / 2, 0);
	// its rim, and the soil inside
	for (const [rw, rd, x, z] of [[w, 0.018, 0, w / 2 - 0.009], [w, 0.018, 0, -w / 2 + 0.009], [0.018, w, w / 2 - 0.009, 0], [0.018, w, -w / 2 + 0.009, 0]] as const) part(g, rw, 0.02, rd, m.white(), x, h - 0.01, z);
	part(g, w - 0.03, 0.02, w - 0.03, m.soil(), 0, h - 0.05, 0, true);
	herb(g, plant, h - 0.04, w, seed);
	return g;
}

/* ── the olive tree ───────────────────────────────────────────────────────── */

/**
 * An old olive tree in a wide terracotta-coloured bowl: a short gnarled trunk, hollowed and twisted, forking into three
 * limbs under a round silver-green crown. About 1.9 m high, the crown 1.7 m across, the bowl 84 cm across.
 */
export function oliveTree({ seed = 3 }: { seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'olive tree';
	const r = seeded(seed * 101 + 9);
	const bowl = [new THREE.Vector2(0.26, 0), new THREE.Vector2(0.3, 0.02), new THREE.Vector2(0.37, 0.18), new THREE.Vector2(0.415, 0.33), new THREE.Vector2(0.425, 0.36), new THREE.Vector2(0.405, 0.365), new THREE.Vector2(0.39, 0.34)];
	mesh(g, new THREE.LatheGeometry(bowl, 48), m.bowl());
	mesh(g, new THREE.CylinderGeometry(0.39, 0.39, 0.02, 40), m.soil(), 0, 0.315, 0);
	// the trunk: a tube up a crooked line, its rings swollen and furrowed by a seeded noise
	const path = new THREE.CatmullRomCurve3([v3(0, 0.25, 0), v3(0.07, 0.5, 0.03), v3(-0.03, 0.78, 0.06), v3(0.05, 1.02, 0.0)]);
	const T = 28, R = 16;
	const tube = new THREE.TubeGeometry(path, T, 1, R, false);
	const tp = tube.attributes.position!, tuv = tube.attributes.uv!;
	const ph = r() * 6;
	for (let i = 0; i <= T; i++) {
		const t = i / T, c = path.getPointAt(t);
		const rad = 0.24 - 0.09 * Math.min(1, t * 4) - 0.06 * t;
		for (let j = 0; j <= R; j++) {
			const k = i * (R + 1) + j;
			const out = v3(tp.getX(k), tp.getY(k), tp.getZ(k)).sub(c);
			// fluted and knobbled, its ridges running up it (by the compass round it, so they never twist), swelling and
			// shrinking along it
			const a = Math.atan2(out.z, out.x);
			const knot = 1 + 0.2 * Math.sin(3 * a + ph) * (0.6 + 0.4 * Math.sin(9 * t + ph)) + 0.1 * Math.sin(5 * a + 2 * ph) + 0.06 * Math.sin(11 * a - ph) * Math.sin(6 * t);
			const v = out.multiplyScalar(rad * knot).add(c);
			tp.setXYZ(k, v.x, v.y, v.z);
			tuv.setXY(k, (j / R) * 2, t * 2.2);
		}
	}
	tube.computeVertexNormals();
	mesh(g, tube, m.oliveBark());
	// the limbs out of its top, and their branches up into the crown
	const top = v3(0.05, 1.0, 0);
	for (let l = 0; l < 3; l++) {
		const a = (l / 3) * Math.PI * 2 + r();
		const end = v3(Math.cos(a) * 0.38, 1.36 + r() * 0.12, Math.sin(a) * 0.32);
		bar(g, top, end, 0.06, m.oliveBark(), 0.03);
		for (let b = 0; b < 3; b++) bar(g, end, end.clone().add(v3((r() - 0.5) * 0.6, 0.15 + r() * 0.25, (r() - 0.5) * 0.6)), 0.022, m.oliveBark(), 0.006);
	}
	g.add(bush({ w: 1.75, h: 1.0, d: 1.55, cards: 1300, card: 0.13, leaf: 'narrow', tint: '#dde4ef', gain: 1.7, seed, base: 1.0 }));
	return g;
}

/* ── pots and potted plants ───────────────────────────────────────────────── */

/** a pot turned on a lathe: `top` and `foot` across, `h` high, a rim band; its soil 3 cm under the rim */
function pot(g: THREE.Group, top: number, foot: number, h: number, mat: THREE.Material, rim = 0.03) {
	const t = top / 2, f = foot / 2;
	const prof = [new THREE.Vector2(0.001, 0.002), new THREE.Vector2(f, 0), new THREE.Vector2(t - 0.01, h - rim), new THREE.Vector2(t + 0.008, h - rim + 0.004), new THREE.Vector2(t + 0.008, h), new THREE.Vector2(t - 0.012, h), new THREE.Vector2(t - 0.016, h - 0.03)];
	mesh(g, new THREE.LatheGeometry(prof, 36), mat);
	mesh(g, new THREE.CylinderGeometry(t - 0.016, t - 0.02, 0.012, 32), m.soil(), 0, h - 0.035, 0);
	return h - 0.03;
}

/** A terracotta flower pot, `d` across the top and `h` high, with a herb or a small shrub in it, or nothing. */
export function terracottaPot({ d = 0.34, h = 0.3, plant = 'none', seed = 1 }: { d?: number; h?: number; plant?: Herb | 'shrub'; seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'terracotta pot';
	const top = pot(g, d, d * 0.72, h, m.terracotta(), 0.045);
	if (plant === 'shrub') g.add(bush({ w: d * 1.4, h: d * 1.5, cards: 90, card: 0.13, leaf: 'broad', tint: '#a9c98a', seed, base: top - 0.02 }));
	else herb(g, plant, top, d * 0.8, seed);
	return g;
}

/** A bird of paradise (Strelitzia) in a brass pot: long stalks fanned in one plane, each holding up a paddle of a leaf,
 *  folded along its midrib. About 1.2 m high. */
export function strelitzia({ seed = 2 }: { seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'bird of paradise';
	const top = pot(g, 0.32, 0.26, 0.3, m.brass(), 0.02);
	const r = seeded(seed * 41 + 3);
	for (let i = 0; i < 8; i++) {
		const fan = -1.0 + (i / 7) * 2.0 + (r() - 0.5) * 0.2, len = 0.45 + r() * 0.4;
		const foot = v3((r() - 0.5) * 0.06, top, (r() - 0.5) * 0.06);
		const tip = foot.clone().add(v3(Math.sin(fan) * len * 0.55, Math.cos(fan * 0.6) * len, (r() - 0.5) * 0.18));
		bar(g, foot, tip, 0.008, m.stalk(), 0.006);
		// the blade: a plane cut to an ellipse, folded along its midrib, its tip curling back
		const L = 0.34 + r() * 0.12, W = 0.12 + r() * 0.04;
		const blade = new THREE.PlaneGeometry(W, L, 6, 14);
		const p = blade.attributes.position!;
		for (let k = 0; k < p.count; k++) {
			const x = p.getX(k), y = p.getY(k) + L / 2, t = y / L;
			const half = Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
			p.setXYZ(k, x * half, y, Math.abs(x * half) * 0.4 + t * t * 0.06);
		}
		blade.computeVertexNormals();
		const b = mesh(g, blade, m.blade(), tip.x, tip.y - 0.02, tip.z);
		b.rotation.set(-0.15 - r() * 0.3, fan * 0.4 + (r() - 0.5) * 0.6, -fan * 0.75);
	}
	return g;
}

/** A monstera in a white glossy pot, six split leaves on their stalks, for a window sill: about 55 cm high. */
export function monstera({ seed = 4 }: { seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'monstera';
	const top = pot(g, 0.24, 0.19, 0.2, m.ceramic(), 0.02);
	const r = seeded(seed * 61 + 5);
	for (let i = 0; i < 7; i++) {
		const a = (i / 7) * Math.PI * 2 + r() * 0.5, len = 0.2 + r() * 0.2;
		const tip = v3(Math.cos(a) * len * 0.75, top + len * 0.75, Math.sin(a) * len * 0.75);
		bar(g, v3(0, top, 0), tip, 0.005, m.stalk());
		const s = 0.24 + r() * 0.1;
		const leaf = new THREE.PlaneGeometry(s, s, 6, 6);
		const p = leaf.attributes.position!;
		for (let k = 0; k < p.count; k++) p.setZ(k, -((p.getX(k) / s) ** 2) * 0.08 - (p.getY(k) / s + 0.5) * 0.04);
		leaf.computeVertexNormals();
		leaf.translate(0, s / 2 - 0.02, 0);
		const o = mesh(g, leaf, m.monstera(), tip.x, tip.y, tip.z);
		o.rotation.set(-1.0 - r() * 0.4, -a + Math.PI / 2, 0, 'YXZ');
	}
	return g;
}

/** A tall ficus (Ficus binnendijkii) in a white glazed pot: a slim trunk, a lush crown of long narrow drooping leaves,
 *  about 2.2 m high. */
export function ficusTree({ seed = 5 }: { seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'ficus';
	const top = pot(g, 0.42, 0.32, 0.38, m.ceramic(), 0.03);
	const r = seeded(seed * 17 + 1);
	const p = [v3(0, top - 0.02, 0), v3(0.04, 0.8, 0.02), v3(-0.02, 1.25, -0.03), v3(0.02, 1.7, 0)];
	for (let i = 0; i + 1 < p.length; i++) bar(g, p[i]!, p[i + 1]!, 0.028 - i * 0.006, m.oliveBark(), 0.024 - i * 0.006);
	for (let b = 0; b < 6; b++) {
		const from = p[1]!.clone().lerp(p[3]!, 0.2 + r() * 0.8), a = r() * Math.PI * 2;
		bar(g, from, from.clone().add(v3(Math.cos(a) * 0.35, 0.18 + r() * 0.2, Math.sin(a) * 0.35)), 0.012, m.oliveBark(), 0.005);
	}
	g.add(bush({ w: 1.25, h: 1.45, d: 1.15, cards: 620, card: 0.22, leaf: 'narrow', tint: '#6a9a52', gain: 1.1, seed, base: 0.62 }));
	return g;
}

/** A pink geranium in a small green-bronze glazed pot, for a table: about 35 cm high. */
export function geraniumPot({ seed = 6 }: { seed?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'geranium';
	const top = pot(g, 0.2, 0.14, 0.17, m.glaze(), 0.02);
	g.add(bush({ w: 0.32, h: 0.2, cards: 40, card: 0.1, leaf: 'broad', tint: '#a6c98e', seed, base: top - 0.01 }));
	const r = seeded(seed * 29 + 7);
	for (let i = 0; i < 6; i++) {
		const at = v3((r() - 0.5) * 0.24, top + 0.15 + r() * 0.08, (r() - 0.5) * 0.24);
		bar(g, v3(at.x * 0.4, top, at.z * 0.4), at, 0.003, m.stalk());
		for (let k = 0; k < 6; k++) {
			const f = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), m.flower());
			f.position.copy(at).add(v3((r() - 0.5) * 0.04, (r() - 0.3) * 0.03, (r() - 0.5) * 0.04));
			g.add(f);
		}
	}
	return g;
}

/* ── festoon lights ───────────────────────────────────────────────────────── */

/**
 * A string of festoon lights `length` long along +x from its origin, sagging `sag` in its middle between its ends: a
 * black cable, round bulbs hanging from it on their sockets. All bulbs share one glass (`userData.glass`).
 */
export function festoonLights({ length = 2.2, sag = 0.12, bulbs = 9 }: { length?: number; sag?: number; bulbs?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'festoon lights';
	const at = (t: number) => v3(t * length, -4 * sag * t * (1 - t), 0);
	const curve = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => at(i / 12)));
	mesh(g, new THREE.TubeGeometry(curve, 40, 0.004, 5, false), m.cable());
	for (let i = 0; i < bulbs; i++) {
		const p = at((i + 0.5) / bulbs);
		mesh(g, new THREE.CylinderGeometry(0.011, 0.011, 0.03, 10), m.socket(), p.x, p.y - 0.02, p.z);
		const b = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10), m.bulb());
		b.position.set(p.x, p.y - 0.055, p.z);
		g.add(b);
	}
	g.userData = { glass: m.bulb(), light: at(0.5).add(v3(0, -0.06, 0)) };
	return g;
}

/* ── the toys on the ledge ────────────────────────────────────────────────── */

/** A toy monkey in plush, sitting, about 30 cm: brown, a pale face and big ears, a red shirt, its legs out in front. */
export function toyMonkey(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'toy monkey';
	ball(g, 0.072, 0.085, 0.062, m.shirt(), 0, 0.11, 0);
	ball(g, 0.068, 0.068, 0.066, m.plush(), 0, 0.235, 0);
	ball(g, 0.05, 0.048, 0.03, m.face(), 0, 0.232, 0.045);
	ball(g, 0.032, 0.024, 0.025, m.face(), 0, 0.208, 0.068);
	for (const s of [-1, 1]) {
		ball(g, 0.009, 0.009, 0.006, m.eye(), s * 0.02, 0.247, 0.072);
		const ear = mesh(g, new THREE.CylinderGeometry(0.027, 0.027, 0.012, 16), m.face(), s * 0.072, 0.245, 0);
		ear.rotation.z = Math.PI / 2;
		bar(g, v3(s * 0.065, 0.16, 0), v3(s * 0.075, 0.08, 0.07), 0.021, m.plush());
		ball(g, 0.022, 0.018, 0.026, m.face(), s * 0.075, 0.075, 0.085);
		bar(g, v3(s * 0.035, 0.04, 0.02), v3(s * 0.065, 0.03, 0.15), 0.024, m.plush());
		ball(g, 0.026, 0.02, 0.034, m.face(), s * 0.067, 0.03, 0.17);
	}
	const tail = new THREE.CatmullRomCurve3([v3(0, 0.04, -0.05), v3(0.06, 0.03, -0.12), v3(0.12, 0.08, -0.1)]);
	mesh(g, new THREE.TubeGeometry(tail, 10, 0.012, 6, false), m.plush());
	return g;
}

/** A toy bee in plush, sitting, about 30 cm: a yellow body banded black, a yellow face, a black tuft, antennae, two
 *  pale wings. */
export function toyBee(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'toy bee';
	ball(g, 0.072, 0.1, 0.07, m.bee(), 0, 0.1, 0);
	ball(g, 0.07, 0.066, 0.064, m.yellow(), 0, 0.245, 0.005);
	ball(g, 0.045, 0.03, 0.04, m.black(), 0, 0.3, -0.005);
	for (const s of [-1, 1]) {
		ball(g, 0.012, 0.016, 0.008, m.eye(), s * 0.025, 0.255, 0.064);
		bar(g, v3(s * 0.02, 0.3, 0.02), v3(s * 0.05, 0.37, 0.05), 0.003, m.black());
		ball(g, 0.012, 0.012, 0.012, m.black(), s * 0.05, 0.372, 0.05);
		const wing = ball(g, 0.06, 0.035, 0.004, m.wing(), s * 0.06, 0.17, -0.07);
		wing.rotation.set(0.2, s * 0.6, s * 0.5);
		bar(g, v3(s * 0.06, 0.15, 0.01), v3(s * 0.07, 0.08, 0.07), 0.016, m.yellow());
		bar(g, v3(s * 0.03, 0.03, 0.03), v3(s * 0.055, 0.025, 0.15), 0.02, m.black());
	}
	return g;
}
