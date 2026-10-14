// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The travel van as MaiaCity V1's story rides in it (Samuel 2026-10-13: far more detail, real people, no ball heads):
 * the old minibus of $lib/models/wayside.js with see-through glass, and inside it all that a packed van on a long road
 * holds. A ribbed rubber floor; three rows of worn striped moquette seats with their headrests (two buckets in front,
 * two benches behind) on steel frames; door cards with a handle and window winders; window sills; curtains tied back at
 * every side window; a roof lining with its ribs, grab handles and a dome light; sun visors; a dashboard with two
 * gauges in their binnacle, a radio, vents and a glovebox; the steering wheel on its column, the engine cover between
 * the front seats and the gear stick on it; soft bags, a backpack, boxes tied with string, a suitcase and a rolled
 * mattress at the back.
 *
 * And its people, seated stand-ins of every look ($lib/actors/human.ts): the driver with his hands on the wheel, an
 * older woman beside him looking out, in the middle row the woman beside you who turns to you to talk, and in the back a young
 * man asleep against the window, a child, and an old man watching the steppe go by. They sway with the road.
 *
 * In the van's own frame: +z ahead, +x the sliding door's side, the floor at FLOOR.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { human } from '$lib/actors/human.ts';
import { blend } from '$lib/actors/rig.ts';
import { travelVan } from '$lib/models/wayside.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** the van's floor inside (m); each row's people sit with their feet on it, their seat's edge 0.5 m up */
export const FLOOR = 0.42;
const EDGE = FLOOR + 0.5;
/** where each row's people sit (z), and their places across it (x) */
const ROW = { front: 1.2, middle: 0.15, back: -0.85 };
/** the player's place: the middle row, by the sliding door */
export const ME_SEAT = V(0.45, FLOOR, ROW.middle);

/** a smooth material: cloth, vinyl, plastic, steel */
const m = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });

/** a seeded random, so every van is packed alike */
function seeded(seed) {
	let s = seed >>> 0;
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** worn bus moquette: a warm ground with stripes down it and a fleck through it */
function moquette(ground, stripe, thin, seed) {
	const c = document.createElement('canvas');
	c.width = c.height = 64;
	const x = c.getContext('2d');
	const r = seeded(seed);
	x.fillStyle = ground;
	x.fillRect(0, 0, 64, 64);
	for (let i = 0; i < 64; i += 16) {
		x.fillStyle = stripe;
		x.fillRect(i, 0, 6, 64);
		x.fillStyle = thin;
		x.fillRect(i + 10, 0, 2, 64);
	}
	for (let i = 0; i < 420; i++) {
		x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,220'},${0.05 + r() * 0.12})`;
		x.fillRect(r() * 64, r() * 64, 1, 1 + (r() * 2) | 0);
	}
	const t = new THREE.CanvasTexture(c);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.repeat.set(4, 3);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

/** a gauge's face: a black dial, its ticks and numbers, a red needle */
function dial(needle) {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const x = c.getContext('2d');
	x.fillStyle = '#0d0d0f';
	x.fillRect(0, 0, 128, 128);
	x.strokeStyle = '#e8e2d4';
	x.lineWidth = 3;
	for (let i = 0; i <= 10; i++) {
		const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
		x.beginPath();
		x.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46);
		x.lineTo(64 + Math.cos(a) * (i % 2 ? 54 : 58), 64 + Math.sin(a) * (i % 2 ? 54 : 58));
		x.stroke();
	}
	const a = Math.PI * 0.75 + needle * Math.PI * 1.5;
	x.strokeStyle = '#e0452f';
	x.lineWidth = 4;
	x.beginPath();
	x.moveTo(64, 64);
	x.lineTo(64 + Math.cos(a) * 48, 64 + Math.sin(a) * 48);
	x.stroke();
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

/** a box without its top: every triangle facing up above y (its own frame) cut away */
function lidless(geo, above) {
	const g = geo.index ? geo.toNonIndexed() : geo.clone();
	const keep = { position: [], normal: [], uv: [] };
	const p = g.attributes.position, n = g.attributes.normal;
	for (let i = 0; i < p.count; i += 3) {
		const up = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
		if (up > 0.4 && y > above) continue;
		for (const [name, a] of Object.entries(keep)) {
			const src = g.attributes[name];
			if (src) for (let j = 0; j < 3; j++) for (let c = 0; c < src.itemSize; c++) a.push(src.array[(i + j) * src.itemSize + c]);
		}
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.Float32BufferAttribute(keep.position, 3));
	out.setAttribute('normal', new THREE.Float32BufferAttribute(keep.normal, 3));
	if (keep.uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(keep.uv, 2));
	return out;
}

/** the people in the van: where each sits, how tall, what they look like, how they sit */
const PEOPLE = [
	{ id: 'driver', x: -0.48, row: 'front', h: 1.78, sits: 'drive', look: { skin: '#8d5a3c', hair: 'short', hairColour: '#16110e', brows: '#16110e', iris: '#2c1d14', shirt: '#9c3b2f', trousers: '#3b3a36', lips: '#7e4a3e' } },
	{ id: 'aunt', x: 0.48, row: 'front', h: 1.62, sits: 'out', look: { face: 'woman', skin: '#c69472', hair: 'bun', hairColour: '#bdb6ad', brows: '#8a8075', shirt: '#3f6f9a', trousers: '#4a3f36', lips: '#9a5a50' } },
	{ id: 'her', x: -0.1, row: 'middle', h: 1.66, sits: 'sit', look: { face: 'woman', skin: '#b07a56', hair: 'long', hairColour: '#3b2418', brows: '#2a1a12', iris: '#3a2616', shirt: '#4f6b3a', trousers: '#2f3a4a', lips: '#a0574c' } },
	{ id: 'sleeper', x: -0.58, row: 'back', h: 1.8, sits: 'asleep', look: { skin: '#e0b896', hair: 'short', hairColour: '#8a5a2b', brows: '#7a4f28', iris: '#4a6a8a', shirt: '#7b5ea7', trousers: '#47566c' } },
	{ id: 'child', x: -0.05, row: 'back', h: 1.3, sits: 'sit', look: { skin: '#a8714c', hair: 'short', hairColour: '#1c1612', brows: '#1c1612', shirt: '#d8b04a', trousers: '#5a4a3a' } },
	{ id: 'elder', x: 0.5, row: 'back', h: 1.72, sits: 'out', look: { skin: '#9a6a48', hair: 'none', brows: '#d9d2c7', shirt: '#d8ccaa', trousers: '#5b5145', lips: '#8a5a48' } }
];

/** how each sits, from the stand-in's own seated pose: at the wheel, turned to the window, asleep against it */
function seated(cast, sits, side) {
	const sit = cast.poses.sit;
	const zero = { forearmL: [-0.5, 0, 0], forearmR: [-0.5, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0] };
	if (sits === 'drive') return { ...sit, ...zero, spine: [0.08, 0, 0], upperArmL: [-1.05, 0, -0.22], upperArmR: [-1.05, 0, 0.22], forearmL: [-0.55, 0, 0.1], forearmR: [-0.55, 0, -0.1] };
	if (sits === 'out') return { ...sit, neck: [0, side * 0.3, 0], head: [0.04, side * 0.45, 0] };
	if (sits === 'asleep') return { ...sit, spine: [0.08, 0, -side * 0.04], chest: [0.03, 0, -side * 0.05], neck: [0.1, 0, -side * 0.1], head: [0.12, 0, -side * 0.14] }; // a soft lean to the window, never a bent neck
	return sit;
}
/** how much of the stand-in's smile (its `joy` blend shape) every face wears at rest (Samuel 2026-10-14: friendly
 *  gazes all the time, not a full smile); the sleeper's softer */
export const FRIENDLY = 0.35;
/** the woman beside you turned to you as she talks (on her left, +x): her shoulders and head round to you, a little
 *  forward, as people sit when they tell each other something on a long ride (Samuel 2026-10-13: a conversation, no phone) */
const TALK = { spine: [0.06, 0.1, 0], chest: [0.04, 0.16, 0], neck: [0.02, 0.26, 0], head: [0.04, 0.42, 0.02] };

export function packedVan() {
	const van = travelVan();
	van.traverse((o) => {
		if (o.isMesh && o.material?.color?.getHex() === 0x27323a) {
			o.material = o.material.clone();
			o.material.transparent = true;
			o.material.opacity = 0.12;
			o.material.depthWrite = false;
		}
		// the lower body's lid: from inside it would hide all below the window line (the seats, the laps, the floor),
		// so its top is cut away, under the upper body where no one outside sees it
		if (o.isMesh && o.geometry.type === 'RoundedBoxGeometry' && Math.abs(o.position.y - 0.85) < 1e-6) o.geometry = lidless(o.geometry, 0.3);
	});
	// every fixed piece goes into one mesh a material
	const bins = new Map();
	const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
		geo.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
		if (!bins.has(mat)) bins.set(mat, []);
		bins.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
	};
	const rbox = (w, h, d, r, mat, x, y, z, rx, ry, rz) => add(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat, x, y, z, rx, ry, rz);
	const box = (w, h, d, mat, x, y, z, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
	const rod = (a, b, r, mat, seg = 8) => {
		const d = b.clone().sub(a);
		const geo = new THREE.CylinderGeometry(r, r, d.length(), seg);
		geo.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1)));
		if (!bins.has(mat)) bins.set(mat, []);
		bins.get(mat).push(geo.toNonIndexed());
	};

	const seatCloth = new THREE.MeshStandardMaterial({ map: moquette('#6a4630', '#9c5a2e', '#d9b77a', 7), roughness: 0.95 });
	const frontCloth = new THREE.MeshStandardMaterial({ map: moquette('#4b3a30', '#7b4a30', '#c9a26a', 11), roughness: 0.95 });
	const piping = m(0x3a2a20);
	const vinyl = m(0x8f8678, { roughness: 0.7 });
	const vinylDark = m(0x5e574d, { roughness: 0.7 });
	const lining = m(0xa39e94, { roughness: 0.9 });
	const plastic = m(0x34312e, { roughness: 0.6 });
	const plasticHi = m(0x45413c, { roughness: 0.55 });
	const rubber = m(0x232322, { roughness: 1 });
	const steel = m(0x9aa0a6, { roughness: 0.35, metalness: 0.8 });
	const curtain = m(0x7a3b3b, { roughness: 1, side: THREE.DoubleSide });
	const card = m(0xb08a5a, { roughness: 1 });
	const string = m(0xe8dcc0, { roughness: 1 });

	// the floor: a ribbed rubber mat, the step down at the sliding door
	box(1.82, 0.03, 4.7, rubber, 0, FLOOR - 0.015, -0.12);
	for (let x = -0.84; x <= 0.85; x += 0.07) box(0.018, 0.008, 4.6, m(0x2e2e2c), x, FLOOR + 0.004, -0.12);
	box(0.2, 0.02, 1.0, steel, 0.83, FLOOR - 0.12, 0.9);

	// the walls under the windows: vinyl door cards, a ridge along them, a dark kick strip, the sills; the sliding
	// door's handle, the front doors' winders and pulls
	for (const x of [-0.925, 0.925]) {
		const s = Math.sign(x);
		box(0.025, 1.12, 4.6, vinyl, x, FLOOR + 0.56, -0.12);
		box(0.012, 0.18, 4.6, vinylDark, x - s * 0.014, FLOOR + 0.09, -0.12);
		for (const y of [FLOOR + 0.42, FLOOR + 0.78]) box(0.014, 0.025, 4.6, vinylDark, x - s * 0.014, y, -0.12);
		rbox(0.07, 0.03, 4.6, 0.012, vinylDark, x - s * 0.03, 1.53, -0.12);
		// the front door: a pull, a winder
		rbox(0.04, 0.035, 0.24, 0.015, plastic, x - s * 0.035, 1.22, 1.72);
		rod(V(x - s * 0.02, 1.32, 1.55), V(x - s * 0.06, 1.32, 1.55), 0.012, steel);
		rod(V(x - s * 0.06, 1.32, 1.55), V(x - s * 0.06, 1.25, 1.5), 0.007, steel);
		add(new THREE.SphereGeometry(0.016, 10, 8), plastic, x - s * 0.06, 1.25, 1.5);
		// the posts between the windows, in the same vinyl, and the curtains tied back at them on a rail
		for (const z of [-2.05, -1.1, -0.1, 0.9]) rbox(0.06, 0.62, 0.1, 0.02, vinyl, x - s * 0.02, 1.78, z);
		rod(V(x - s * 0.05, 2.0, -2.3), V(x - s * 0.05, 2.0, 1.0), 0.007, steel);
		for (const z of [-1.95, -1.25, -0.95, -0.25, 0.05, 0.75]) {
			add(new THREE.CylinderGeometry(0.028, 0.045, 0.44, 10).scale(0.55, 1, 1), curtain, x - s * 0.06, 1.77, z);
			add(new THREE.TorusGeometry(0.03, 0.006, 6, 14).scale(0.6, 1, 1.1), m(0xd8b04a), x - s * 0.06, 1.74, z, Math.PI / 2);
		}
		// the windscreen's pillars
		rbox(0.08, 0.72, 0.09, 0.03, vinylDark, x * 0.95, 1.8, 2.02, -0.25);
	}
	// the sliding door's handle
	rbox(0.04, 0.05, 0.2, 0.018, plastic, 0.895, 1.18, 0.55);
	box(0.01, 0.03, 0.14, steel, 0.875, 1.18, 0.55);

	// the roof lining, its ribs across, grab handles over the windows, the dome light, the sun visors
	box(1.84, 0.02, 4.6, lining, 0, 2.095, -0.12);
	for (let z = -2.2; z <= 1.8; z += 0.45) rbox(1.82, 0.02, 0.05, 0.008, m(0x8e897f), 0, 2.08, z);
	for (const x of [-0.84, 0.84]) for (const z of [-1.6, -0.6, 0.4]) add(new THREE.TorusGeometry(0.07, 0.01, 6, 16, Math.PI), plastic, x, 2.06, z, Math.PI, Math.PI / 2);
	rbox(0.26, 0.035, 0.14, 0.012, plasticHi, 0, 2.07, -0.3);
	box(0.2, 0.01, 0.1, m(0xfff4d6, { emissive: 0xfff0c8, emissiveIntensity: 0.25 }), 0, 2.05, -0.3);
	for (const x of [-0.48, 0.48]) rbox(0.44, 0.018, 0.17, 0.008, vinyl, x, 2.04, 1.86, 0.18);

	// the dashboard: its top, its face, the binnacle with two gauges, a radio, four vents, the glovebox
	rbox(1.82, 0.1, 0.5, 0.04, plastic, 0, 1.44, 2.0, 0.08);
	rbox(1.8, 0.36, 0.1, 0.035, plasticHi, 0, 1.24, 1.76);
	rbox(0.48, 0.13, 0.2, 0.05, plastic, -0.48, 1.5, 1.8);
	const faces = [];
	for (const [x, n] of [[-0.57, 0.62], [-0.39, 0.35]]) {
		const g = new THREE.Mesh(new THREE.CircleGeometry(0.052, 28), new THREE.MeshBasicMaterial({ map: dial(n), toneMapped: false }));
		g.position.set(x, 1.49, 1.698);
		g.rotation.y = Math.PI;
		faces.push(g);
		add(new THREE.TorusGeometry(0.055, 0.006, 6, 24), steel, x, 1.49, 1.7);
	}
	rbox(0.2, 0.06, 0.03, 0.01, m(0x161616), 0.02, 1.3, 1.705);
	box(0.11, 0.022, 0.005, m(0x7dffb0, { emissive: 0x3dff8a, emissiveIntensity: 0.6 }), 0.0, 1.31, 1.689);
	for (const x of [-0.08, 0.08]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.015, 12), steel, 0.02 + x, 1.29, 1.69, Math.PI / 2);
	for (const x of [-0.8, -0.2, 0.22, 0.8]) {
		rbox(0.15, 0.06, 0.03, 0.012, m(0x1e1e1e), x, 1.36, 1.71);
		for (let i = -2; i <= 2; i++) box(0.012, 0.05, 0.035, plastic, x + i * 0.025, 1.36, 1.705);
	}
	rbox(0.44, 0.17, 0.02, 0.02, plastic, 0.5, 1.17, 1.705);
	box(0.06, 0.015, 0.01, steel, 0.5, 1.23, 1.693);
	// the steering wheel on its column, raked like an old van's; the engine cover between the seats, the gear stick
	const wheel = new THREE.Group();
	wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.017, 10, 40), m(0x1c1a18, { roughness: 0.6 })));
	for (const a of [Math.PI / 2, Math.PI * 1.17, Math.PI * 1.83]) {
		const s = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.028, 0.014), m(0x2a2826));
		s.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0);
		s.rotation.z = a;
		wheel.add(s);
	}
	const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.04, 18), m(0x2a2826));
	hub.rotation.x = Math.PI / 2;
	wheel.add(hub);
	wheel.position.set(-0.48, 1.33, 1.58);
	wheel.rotation.x = 0.62;
	rod(V(-0.48, 1.33, 1.6), V(-0.48, 1.2, 1.78), 0.03, plastic, 12);
	rbox(0.38, 0.34, 0.6, 0.06, vinylDark, 0, FLOOR + 0.17, 1.55);
	rod(V(0.05, FLOOR + 0.34, 1.48), V(0.02, FLOOR + 0.62, 1.42), 0.009, steel);
	add(new THREE.SphereGeometry(0.028, 14, 10), m(0x141414, { roughness: 0.4 }), 0.02, FLOOR + 0.64, 1.42);
	add(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 12), rubber, 0.05, FLOOR + 0.35, 1.48);
	// the mirror, a charm hanging from it; on the dash a woven bag, a folded cloth, a water bottle
	rbox(0.26, 0.07, 0.03, 0.015, plastic, 0, 1.97, 1.84);
	rod(V(0, 1.94, 1.84), V(0, 1.84, 1.84), 0.002, string);
	add(new THREE.OctahedronGeometry(0.03, 0), m(0xd8b04a, { roughness: 0.4, metalness: 0.5 }), 0, 1.82, 1.84);
	rbox(0.46, 0.16, 0.26, 0.06, m(0x7b5ea7), 0.48, 1.56, 1.98);
	rbox(0.4, 0.03, 0.22, 0.012, m(0xc9a26a), -0.1, 1.505, 2.0);
	add(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 14).rotateZ(Math.PI / 2), m(0x9fc6d8, { roughness: 0.15, transparent: true, opacity: 0.6 }), 0.1, 1.53, 1.92);

	// the seats: worn striped moquette over foam, piping along their edges, a steel frame under each; two buckets in
	// front, two benches of three behind; a headrest on two posts over each place
	const seat = (x, z, w, cloth, places, bucket = false) => {
		rbox(w, 0.14, 0.52, 0.05, cloth, x, EDGE - 0.07, z + 0.06);
		box(w - 0.04, 0.02, 0.02, piping, x, EDGE - 0.01, z + 0.32);
		box(w - 0.1, EDGE - 0.14 - FLOOR, 0.035, plastic, x, (EDGE - 0.14 + FLOOR) / 2, z + 0.26);
		for (const dx of [-(w / 2 - 0.06), w / 2 - 0.06]) rod(V(x + dx, FLOOR, z - 0.12), V(x + dx, EDGE - 0.14, z - 0.12), 0.015, steel);
		rbox(w, 0.64, 0.13, 0.05, cloth, x, EDGE + 0.32, z - 0.21, -0.12);
		rbox(w - 0.02, 0.6, 0.03, 0.012, plastic, x, EDGE + 0.31, z - 0.29, -0.12);
		if (bucket) for (const s of [-1, 1]) rbox(0.07, 0.5, 0.17, 0.03, cloth, x + s * (w / 2 - 0.02), EDGE + 0.3, z - 0.18, -0.12, -s * 0.25);
		for (const px of places) {
			rbox(0.26, 0.17, 0.09, 0.04, cloth, px, FLOOR + 1.32, z - 0.31);
			for (const dx of [-0.07, 0.07]) rod(V(px + dx, EDGE + 0.6, z - 0.3), V(px + dx, FLOOR + 1.24, z - 0.31), 0.006, steel);
		}
	};
	seat(-0.48, ROW.front, 0.54, frontCloth, [-0.48], true);
	seat(0.48, ROW.front, 0.54, frontCloth, [0.48], true);
	seat(0, ROW.middle, 1.7, seatCloth, [-0.58, -0.1, 0.45]);
	seat(0, ROW.back, 1.76, seatCloth, [-0.58, -0.05, 0.5]);

	// their bags: a duffel and a backpack on the middle bench, more under the seats; at the back, boxes tied with
	// string, a red suitcase, a rolled striped mattress, a sack
	const r = seeded(3);
	const duffel = (x, y, z, ry, colour, len = 0.42) => {
		add(new THREE.CapsuleGeometry(0.13, len, 6, 14).rotateZ(Math.PI / 2).scale(1, 0.8, 1), m(colour, { roughness: 1 }), x, y, z, 0, ry);
		add(new THREE.TorusGeometry(0.1, 0.008, 6, 16, Math.PI), m(0x222222), x, y + 0.09, z, 0, ry);
	};
	duffel(-0.62, EDGE + 0.1, ROW.middle + 0.05, Math.PI / 2 - 0.2, 0x3f6f9a, 0.3);
	rbox(0.3, 0.42, 0.2, 0.06, m(0x9c3b2f, { roughness: 1 }), -0.62, EDGE + 0.4, ROW.middle - 0.08, -0.1);
	rbox(0.22, 0.18, 0.06, 0.03, m(0x7e2f26, { roughness: 1 }), -0.62, EDGE + 0.32, ROW.middle + 0.04, -0.1);
	duffel(0.15, FLOOR + 0.1, ROW.back + 0.42, 0.1, 0x4f6b3a, 0.36);
	const boxAt = (w, h, d, x, y, z, ry) => {
		box(w, h, d, card, x, y, z, 0, ry);
		box(w + 0.004, 0.012, d + 0.004, string, x, y, z, 0, ry);
		box(0.012, h + 0.004, d + 0.004, string, x, y, z, 0, ry);
	};
	boxAt(0.5, 0.4, 0.42, -0.5, FLOOR + 0.2, -1.6, 0.05);
	boxAt(0.44, 0.34, 0.4, -0.48, FLOOR + 0.57, -1.62, -0.1);
	boxAt(0.42, 0.3, 0.38, 0.0, FLOOR + 0.15, -1.65, 0.12);
	rbox(0.5, 0.65, 0.22, 0.04, m(0x7b2f2f, { roughness: 0.6 }), 0.52, FLOOR + 0.33, -1.6, 0, 0.08);
	for (const s of [-1, 1]) box(0.52, 0.02, 0.23, m(0x3a1a1a), 0.52, FLOOR + 0.33 + s * 0.25, -1.6, 0, 0.08);
	add(new THREE.CylinderGeometry(0.17, 0.17, 1.4, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ map: moquette('#d9d0bf', '#3f6f9a', '#9c3b2f', 5), roughness: 1 }), 0.05, FLOOR + 0.58, -2.05);
	add(new THREE.SphereGeometry(0.24, 14, 10).scale(1, 0.75, 1.1), m(0xc8b48a, { roughness: 1 }), -0.5, FLOOR + 0.95, -1.9);
	for (let i = 0; i < 3; i++) duffel(-0.55 + i * 0.5, FLOOR + 0.9 + r() * 0.05, -2.2, r() * 0.4, [0x5a4632, 0x3f6f9a, 0xd8b04a][i], 0.3);

	const inside = new THREE.Group();
	for (const [mat, geos] of bins) {
		const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
		mesh.receiveShadow = true;
		inside.add(mesh);
	}
	inside.add(wheel, ...faces);

	// the people, seated stand-ins swaying with the road
	const people = [];
	for (const [i, p] of PEOPLE.entries()) {
		const cast = human(p.look, p.h);
		const side = Math.sign(p.x) || 1;
		const base = seated(cast, p.sits, side);
		const o = cast.rig.object;
		o.position.set(p.x, FLOOR, ROW[p.row]);
		o.userData = { id: p.id, cast, base, i, k: 0, to: 0 };
		o.castShadow = o.receiveShadow = false; // in the van's shade; a sun's shadow map is far too coarse for a face
		cast.rig.pose(base);
		inside.add(o);
		people.push(o);
	}
	const her = people.find((o) => o.userData.id === 'her');
	const herHead = her.userData.cast.rig.bones.head;

	van.add(inside);
	van.userData = {
		people,
		/** the people swaying with the road at time t (s); the woman beside you turning to you and back, nodding a little
		 *  as she talks */
		nod(t, dt = 1 / 60) {
			for (const o of people) {
				const { cast, base, i } = o.userData;
				o.userData.k += Math.sign(o.userData.to - o.userData.k) * Math.min(Math.abs(o.userData.to - o.userData.k), dt * 1.4);
				const k = o.userData.k * o.userData.k * (3 - 2 * o.userData.k);
				const pose = k > 0 ? blend(base, { ...base, ...TALK }, k) : base;
				const h = pose.head ?? [0, 0, 0];
				const says = k * (Math.sin(t * 5.3 + i) * 0.035 + Math.sin(t * 1.7) * 0.025); // the small nods of someone talking
				const face = cast.rig.object, j = face.morphTargetDictionary?.joy;
				if (j !== undefined) face.morphTargetInfluences[j] = o.userData.id === 'sleeper' ? FRIENDLY / 3 : FRIENDLY;
				cast.rig.pose({ ...pose, head: [h[0] + says + (o.userData.lift ?? 0) + Math.sin(t * 9 + i) * 0.02 + Math.sin(t * 2.3 + i) * 0.015, h[1] + Math.sin(t * 0.3 + i * 2) * 0.04, h[2]] });
			}
		},
		/** the woman beside you turns to you to talk (on), or sits back and looks ahead */
		talk(on) {
			her.userData.to = on ? 1 : 0;
		},
		/** her head bowed (v > 0) or lifted (v < 0) a little, as she looks down at her hands or up the road */
		lift(v) {
			her.userData.lift = v;
		},
		/** her face (world) */
		herFace: () => herHead.localToWorld(V(0, 0.075, 0.08))
	};
	return van;
}
