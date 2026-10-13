// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1's world, in three.js, and nothing but it: the city plot of 49 hexes on a wide sandy steppe, a dusty
 * highway through its centre hex, and the journey of a newcomer across it. At the city's centre the bus stop and the
 * abandoned gas station (the MaiaCity centre, $lib/models/wayside.js); a meandering gravel track leaves the highway
 * there and runs through the village's centre hex, where the Village COOP's old shed keeps the powercube beside the
 * solar row and the battery (the village store), on to our tribe's hex: grass, a few bushes, the 2-person dome tent
 * and the pickup's round lot. The city's own hexes are steppe and prairie, the villages' hexes grass.
 *
 * The page tells the world where the story is (set: where the pickup, the powercube and the players are; focus: what
 * the camera looks at; reveal: how much of the locked land shows its dotted rims) and plays its moments: the arrival
 * (intro: the view from inside the packed travel van down the highway, then the van pulling up at the bus stop, the
 * player stepping out, the van leaving), the drives in the pickup (drive) and loading the powercube (load). The sun
 * follows the virtual day. Tapping a player names them (onPick), and every frame the players' labels' places go to
 * onLabels.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { batteryPack, pickup, solarRow } from '$lib/models/village.js';
import { powerCube } from '$lib/actors/powercube.js';
import { SPEED } from '$lib/models/units.js';
import { maiaCentre, oldShed, travelVan } from '$lib/models/wayside.js';
import { look, pathOf } from '../../../game/film/camera.js';

/** the hex's radius in metres: 114.75, one and a half times 76.5 again (Samuel 2026-10-13, 17:49) */
const HEX_R = 114.75;
/** how much larger than the 76.5 m hexes the hand-drawn track and the far views were laid out for */
const K = HEX_R / 76.5;
const SEAT_COLOUR = { A: 0x3f6f9a, B: 0xd7a53a };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Hexes point north (+z): axial (q, r) sits at x = √3·R·(q + r/2), z = 1.5·R·r; a hex is one tribe, seven are a
 *  village, seven villages the city. Our tribe's hex is the origin; its village's centre hex is the next one west,
 *  and the city's centre hex (the centre of the centre village) two villages' steps further on. */
const hexAt = (q, r) => [Math.sqrt(3) * HEX_R * (q + r / 2), 1.5 * HEX_R * r];
const AXIAL = [[0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
const VILLAGES = [[0, 0], [2, 1], [-1, 3], [-3, 2], [-2, -1], [1, -3], [3, -2]];
const CITY = [-3, -1]; // the city's centre hex, from our tribe
const HOME_VILLAGE = 1; // our village is VILLAGES[1] of the city
const [CX, CZ] = hexAt(...CITY);
const [VX, VZ] = hexAt(-1, 0);
/** every hex of the plot: its axial place from our tribe, its biome, and whether it is in our village */
const HEXES = VILLAGES.flatMap(([vq, vr], v) =>
	AXIAL.map(([dq, dr]) => {
		const q = CITY[0] + vq + dq, r = CITY[1] + vr + dr;
		return { q, r, at: hexAt(q, r), biome: v === 0 ? 'steppe' : 'grass', home: v === HOME_VILLAGE, tribe: !q && !r };
	})
);
const hexKey = (x, z) => {
	// the axial hex under a point, by rounding its cube coordinates
	const r = z / (1.5 * HEX_R), q = x / (Math.sqrt(3) * HEX_R) - r / 2, s = -q - r;
	let [rq, rr, rs] = [Math.round(q), Math.round(r), Math.round(s)];
	const [dq, dr, ds] = [Math.abs(rq - q), Math.abs(rr - r), Math.abs(rs - s)];
	if (dq > dr && dq > ds) rq = -rr - rs;
	else if (dr > ds) rr = -rq - rs;
	return `${rq},${rr}`;
};
const BIOME = new Map(HEXES.map((h) => [`${h.q},${h.r}`, h.biome]));
const isGrass = (x, z) => BIOME.get(hexKey(x, z)) === 'grass';

/** the highway: a dusty sand road that comes in from the far west, the side away from our village, and ends at the
 *  city's centre hex, at the abandoned gas station: a dead end (Samuel 2026-10-13) */
const ROAD_Z = CZ;
const ROAD_END = CX - 2;
const HIGHWAY_W = 9;
/** the MaiaCity centre (wayside.js) stands at the road's end: the gas station beyond it, the bus stop on its south side */
const CENTRE = { x: ROAD_END, z: ROAD_Z };
const STOP = V(ROAD_END - 12, 0, ROAD_Z - 5.4); // where a newcomer stands, by the bus stop
const VAN_HALT = V(ROAD_END - 14, 0, ROAD_Z - 1.8); // the van halts here, its side door to the bus stop
/** the van's way out: on round the forecourt, turning, and back west down the highway */
const VAN_OUT = new THREE.CatmullRomCurve3(
	[[0, -1.8], [10, -2.6], [17, 1], [12, 5], [0, 2.4], [-20, 2.2], [-420, 2.2]].map(([x, z]) => V(VAN_HALT.x + x, 0, ROAD_Z + z))
);
/** the village store: the old shed at the village's centre hex, its door to the track; the solar row and the battery behind */
const STORE = { x: VX + 2, z: VZ - 13 };
const CUBE_IN_SHED = V(STORE.x + 0.6, 0.1, STORE.z - 0.4);
/** our tribe: the tent at the middle, the pickup's round lot, a little yard for the powercube once it is home */
const LOT = { x: -16, z: 10, r: 5 }; // room to turn a 5.4 m pickup
const YARD = { x: 12, z: -4, r: 3 };
const STORE_YARD = { x: STORE.x + 1, z: STORE.z - 3, r: 14 };
const PATH_W = 4.2; // a narrow offroad track, two ruts in it (Samuel 2026-10-13)
/** the gravel track's centre line: off the highway beside the bus stop, a slow meander east through the steppe and
 *  the village's grass, past the old shed, and on into our tribe's lot (Samuel 2026-10-13) */
const TRACK = new THREE.CatmullRomCurve3(
	[
		[CX + 2, CZ - 8], [CX + 5, CZ - 20], [CX + 24, CZ - 24], [CX + 48, CZ - 6], ...[[-405, -70], [-360, -84], [-312, -48], [-262, -58], [-214, -20]].map(([x, z]) => [x * K, z * K]),
		[-176 * K, 2], [VX - 12, VZ + 4], [VX + 14, VZ], [-100 * K, -6], [-74 * K, 10], [-48 * K, 18], [-30, 12], [LOT.x, LOT.z]
	].map(([x, z]) => V(x, 0, z)),
	false,
	'centripetal'
);
const PATH = TRACK.getSpacedPoints(Math.ceil(TRACK.getLength() / 2));
/** where on the track (0 the highway, 1 the lot) the pickup halts at the shed */
const U_STORE = (() => {
	let best = 0;
	PATH.forEach((p, i) => { if (Math.hypot(p.x - STORE.x, p.z - VZ) < Math.hypot(PATH[best].x - STORE.x, PATH[best].z - VZ)) best = i; });
	return best / (PATH.length - 1);
})();
const U_START = 0.004; // the pickup waits at the gas station's forecourt
const nearPath = (x, z, r) => PATH.some((p) => Math.abs(p.x - x) < r + 2 && Math.hypot(p.x - x, p.z - z) < r + 1);
const onGravel = (x, z, pad = 0) =>
	[LOT, YARD, STORE_YARD].some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad) || nearPath(x, z, PATH_W / 2 + pad) || (x < ROAD_END + 2 && Math.abs(z - ROAD_Z) < HIGHWAY_W / 2 + pad);

/** a little seeded random, so everything stands in the same places for everyone */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
/** a flat thing on the ground, drawn over what lies under it */
const flat = (color, lift) => mat(color, { polygonOffset: true, polygonOffsetFactor: -lift, polygonOffsetUnits: -lift });

/** the steppe all round, and every hex of the plot as a tile of its biome: prairie at the city's centre, grass in the
 *  villages, our tribe's own green; each locked hex has a dotted rim the story reveals (1 our village, 2 the city) */
function land() {
	const g = new THREE.Group();
	const ground = new THREE.Mesh(new THREE.CircleGeometry(6400, 64), mat(0xd3bf90));
	ground.rotation.x = -Math.PI / 2;
	ground.position.set(CX, -0.02, CZ);
	ground.receiveShadow = true;
	g.add(ground);
	const tile = new THREE.CircleGeometry(HEX_R - 0.4, 6, Math.PI / 2);
	tile.rotateX(-Math.PI / 2);
	const r = rng(7);
	const prairie = [flat(0xc8b67c, 1), flat(0xccb882, 1), flat(0xc2b177, 1)];
	const grass = [flat(0x93b46d, 1), flat(0x8db06a, 1), flat(0x98b872, 1)];
	const rimHome = new THREE.LineDashedMaterial({ color: 0xf4f1e8, dashSize: 5, gapSize: 6, transparent: true, opacity: 0.85 });
	const rimFar = new THREE.LineDashedMaterial({ color: 0xf1ead8, dashSize: 5, gapSize: 6, transparent: true, opacity: 0.6 });
	const rim = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 7 }, (_, k) => V(Math.sin((k * Math.PI) / 3) * (HEX_R - 0.8), 0, Math.cos((k * Math.PI) / 3) * (HEX_R - 0.8))));
	const rims = [];
	for (const h of HEXES) {
		const t = new THREE.Mesh(tile, h.tribe ? flat(0x7fa860, 2) : h.biome === 'steppe' ? prairie[Math.floor(r() * 3)] : grass[Math.floor(r() * 3)]);
		t.position.set(h.at[0], 0, h.at[1]);
		t.receiveShadow = true;
		g.add(t);
		const line = new THREE.Line(rim, h.tribe ? new THREE.LineBasicMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0.8 }) : h.home ? rimHome : rimFar);
		line.position.set(h.at[0], 0.12, h.at[1]);
		line.computeLineDistances();
		line.userData.level = h.tribe ? 0 : h.home ? 1 : 2;
		rims.push(line);
		g.add(line);
	}
	return { group: g, rims };
}

/** the highway: packed sand, two darker wheel tracks, old asphalt in patches, telegraph poles along its north side,
 *  and at its end a low bank of sand: the road goes no further */
function highway() {
	const g = new THREE.Group();
	const len = 7000;
	const strip = (w, color, z, lift) => {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), flat(color, lift));
		m.rotation.x = -Math.PI / 2;
		m.position.set(ROAD_END - len / 2, 0, z);
		m.receiveShadow = true;
		g.add(m);
	};
	strip(HIGHWAY_W, 0xb8a072, ROAD_Z, 3);
	strip(1.1, 0x9c8660, ROAD_Z - 1.7, 4);
	strip(1.1, 0x9c8660, ROAD_Z + 1.7, 4);
	const r = rng(11);
	const patch = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), flat(0x6f6a62, 5), 160);
	const o = new THREE.Object3D();
	for (let i = 0; i < 160; i++) {
		o.position.set(ROAD_END - 30 - r() * 3600, 0, ROAD_Z + (r() - 0.5) * 5);
		o.scale.set(2 + r() * 10, 1, 1.5 + r() * 3);
		o.rotation.y = (r() - 0.5) * 0.2;
		o.updateMatrix();
		patch.setMatrixAt(i, o.matrix);
	}
	g.add(patch);
	const poles = 80;
	const wood = mat(0x6a5440);
	const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.15, 7.5, 6).translate(0, 3.75, 0), wood, poles);
	const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 1.8).translate(0, 7, 0), wood, poles);
	for (let i = 0; i < poles; i++) {
		o.position.set(ROAD_END - 40 - i * 45, 0, ROAD_Z + 8);
		o.scale.set(1, 1, 1);
		o.rotation.set((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.06); // leaning a little, as old poles do
		o.updateMatrix();
		pole.setMatrixAt(i, o.matrix);
		arm.setMatrixAt(i, o.matrix);
	}
	pole.castShadow = true;
	g.add(pole, arm);
	return g;
}

/** the steppe's plants: dry tufts, low grey-green scrub, stones and a few flat-topped thorn trees, everywhere but on
 *  the villages' grass, the roads and the MaiaCity centre */
function steppe() {
	const g = new THREE.Group();
	const r = rng(23);
	const o = new THREE.Object3D();
	const free = (x, z) => !isGrass(x, z) && !onGravel(x, z, 2) && Math.hypot(x - (CX + 2), z - CZ) > 30;
	const spot = (reach) => {
		for (let k = 0; k < 20; k++) {
			// more of them near the city's centre and along the highway, where the eye is
			const a = r() * Math.PI * 2, d = reach * Math.pow(r(), 0.7);
			const road = r() < 0.35;
			const x = road ? ROAD_END - r() * 3000 : CX + Math.cos(a) * d;
			const z = road ? CZ + (r() - 0.5) * 220 : CZ + Math.sin(a) * d;
			if (free(x, z)) return [x, z];
		}
		return null;
	};
	const scatter = (geo, material, n, reach, size, shadow = false) => {
		const m = new THREE.InstancedMesh(geo, material, n);
		let i = 0;
		while (i < n) {
			const p = spot(reach);
			if (!p) continue;
			const s = size[0] + r() * (size[1] - size[0]);
			o.position.set(p[0], 0, p[1]);
			o.rotation.set(0, r() * Math.PI * 2, 0);
			o.scale.set(s, s * (0.7 + r() * 0.6), s);
			o.updateMatrix();
			m.setMatrixAt(i++, o.matrix);
		}
		m.castShadow = shadow;
		g.add(m);
	};
	scatter(new THREE.ConeGeometry(0.45, 0.9, 5).translate(0, 0.4, 0), mat(0xb39a5c), Math.round(6000 * K * K), 1500 * K, [0.4, 0.9]); // grass tussocks, 0.3-0.8 m
	scatter(new THREE.ConeGeometry(0.4, 0.7, 5).translate(0, 0.3, 0), mat(0xa48e55), Math.round(3000 * K * K), 1500 * K, [0.45, 1]);
	scatter(new THREE.IcosahedronGeometry(1, 0).translate(0, 0.5, 0), mat(0x8c8f5a), Math.round(900 * K * K), 1400 * K, [0.4, 0.9], true); // shrubs, 0.8-1.8 m across
	scatter(new THREE.DodecahedronGeometry(0.7, 0).translate(0, 0.2, 0), mat(0x9d927d), Math.round(500 * K * K), 1400 * K, [0.3, 1.2], true); // stones and a few boulders
	// thorn trees: a crooked trunk and a flat crown
	const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.4, 5).translate(0, 1.7, 0);
	const crown = new THREE.CylinderGeometry(3.4, 2.2, 1, 7).translate(0, 3.6, 0);
	const tm = new THREE.InstancedMesh(trunk, mat(0x5f4a36), 70);
	const cm = new THREE.InstancedMesh(crown, mat(0x6f7c45), 70);
	for (let i = 0; i < 70; ) {
		const p = spot(1300 * K);
		if (!p) continue;
		o.position.set(p[0], 0, p[1]);
		o.rotation.set(0, r() * Math.PI * 2, (r() - 0.5) * 0.15);
		o.scale.setScalar(0.8 + r() * 0.7);
		o.updateMatrix();
		tm.setMatrixAt(i, o.matrix);
		cm.setMatrixAt(i++, o.matrix);
	}
	tm.castShadow = cm.castShadow = true;
	g.add(tm, cm);
	return g;
}

/** the gravel: the track as one ribbon, and the round lot, the tribe's yard and the store's yard as discs */
function gravel() {
	const g = new THREE.Group();
	const stone = flat(0xbdb29c, 3);
	stone.side = THREE.DoubleSide;
	for (const c of [LOT, YARD, STORE_YARD]) {
		const disc = new THREE.Mesh(new THREE.CircleGeometry(c.r, 48), stone);
		disc.rotation.x = -Math.PI / 2;
		disc.position.set(c.x, 0.01, c.z);
		disc.receiveShadow = true;
		g.add(disc);
	}
	// the track: a strip of packed dirt, and two darker ruts in it
	const ribbon = (half, off, material) => {
		const pos = [];
		PATH.forEach((p, i) => {
			const a = PATH[Math.max(0, i - 1)], b = PATH[Math.min(PATH.length - 1, i + 1)];
			const l = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
			pos.push(p.x + nx * (off + half), 0.01, p.z + nz * (off + half), p.x + nx * (off - half), 0.01, p.z + nz * (off - half));
		});
		const index = [];
		for (let i = 0; i < PATH.length - 1; i++) { const a = i * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		geo.setIndex(index);
		geo.computeVertexNormals();
		const m = new THREE.Mesh(geo, material);
		m.receiveShadow = true;
		g.add(m);
	};
	const dirt = flat(0xb19e78, 3);
	const rut = flat(0x958262, 4);
	dirt.side = rut.side = THREE.DoubleSide;
	ribbon(PATH_W / 2, 0, dirt);
	ribbon(0.4, -1.05, rut);
	ribbon(0.4, 1.05, rut);
	return g;
}

/** our tribe's hex: grass and a few round bushes, kept off the tent, the gravel and the paths */
function bushes() {
	const g = new THREE.Group();
	const r = rng(42);
	const leaves = [mat(0x4f7f40), mat(0x5d8a45), mat(0x46733a)];
	for (let i = 0, n = 0; i < 900 && n < 76; i++) {
		const a = r() * Math.PI * 2, d = 12 + r() * (HEX_R - 18);
		const x = Math.cos(a) * d, z = Math.sin(a) * d;
		if (hexKey(x, z) !== '0,0' || Math.hypot(x, z) > HEX_R * 0.8 || onGravel(x, z, 3)) continue;
		const b = new THREE.Group();
		for (let k = 0, c = 2 + Math.floor(r() * 3); k < c; k++) {
			const s = 0.35 + r() * 0.5; // bushes 1-2 m high
			const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leaves[(i + k) % 3]);
			ball.position.set((r() - 0.5) * 1.1, s * 0.75, (r() - 0.5) * 1.1);
			ball.castShadow = true;
			b.add(ball);
		}
		b.position.set(x, 0, z);
		g.add(b);
		n++;
	}
	return g;
}

/** the Tribe COOP's tent pitched: a 4 m geodesic dome, 2 m high at its middle, on a round timber deck */
export function tent() {
	const g = new THREE.Group();
	const r = 2;
	const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), mat(0xf1e8d4, { side: THREE.DoubleSide }));
	// keep the upper half only: a geodesic dome
	const pos = shell.geometry.attributes.position;
	for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setY(i, 0);
	pos.needsUpdate = true;
	shell.geometry.computeVertexNormals();
	shell.castShadow = true;
	g.add(shell);
	const struts = new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry, 1), new THREE.LineBasicMaterial({ color: 0x6b5236 }));
	g.add(struts);
	const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.2), mat(0x3b2f24));
	door.position.set(0, 0.8, Math.sqrt(r * r - 1.6 * 1.6) - 0.05);
	g.add(door);
	const deck = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.8, r + 0.8, 0.2, 24), mat(0xb08a5e));
	deck.position.y = 0.05;
	deck.receiveShadow = true;
	g.add(deck);
	return g;
}

/** the tent packed: a canvas bundle with its poles, strapped, as it waits in the village shed */
/** where the Power Cube Electric (0.75 × 1 m) and the packed tent ride in the pickup's bed (1.55 m long, its floor 1.16 m up):
 *  side by side, the cube behind the tool box, the tent by the tailgate */
const CUBE_ON_BED = V(0, 1.16, -1.42);
const TENT_ON_BED = V(0, 1.16 + 0.47, -2.3); // lying on the two jerrycans
/** the two 20-litre jerrycans of petrol for the Power Cube Electric (its engine runs on petrol): in the bed behind
 *  the cube, the tent strapped over them */
const FUEL_ON_BED = [V(-0.55, 1.16, -1.95), V(0.55, 1.16, -1.95)];

/** a 20-litre jerrycan: 0.47 m high, 0.35 m long, 0.17 m wide, its handles and spout on top */
function jerrycan() {
	const g = new THREE.Group();
	const red = mat(0xb3261e);
	const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.4, 0.35), red);
	body.position.y = 0.2;
	const top = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.22), red);
	top.position.set(0, 0.425, 0.05);
	const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 8), mat(0x3a3a3a));
	spout.position.set(0, 0.44, -0.13);
	g.add(body, top, spout);
	g.traverse((o) => o.isMesh && (o.castShadow = true));
	return g;
}

function packedTent() {
	const g = new THREE.Group();
	const canvas = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.3, 12).rotateZ(Math.PI / 2), mat(0xd9ccb0));
	canvas.position.y = 0.34;
	const poles = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 8).rotateZ(Math.PI / 2), mat(0x6b5236));
	poles.position.set(0, 0.12, 0.42);
	g.add(canvas, poles);
	for (const x of [-0.4, 0.4]) {
		const strap = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 16).rotateY(Math.PI / 2), mat(0x3b2f24));
		strap.position.set(x, 0.34, 0);
		g.add(strap);
	}
	g.traverse((o) => o.isMesh && (o.castShadow = true));
	return g;
}

/** a player: 1.8 m tall, their one backpack on */
export function person(seat) {
	const g = new THREE.Group();
	g.name = `player:${seat}`;
	const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.82, 4, 10), mat(SEAT_COLOUR[seat]));
	body.position.y = 0.67;
	body.castShadow = true;
	body.name = g.name;
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat(0xe8c4a0));
	head.position.y = 1.67;
	head.castShadow = true;
	head.name = g.name;
	const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshStandardMaterial({ color: 0xe0435a, emissive: 0xe0435a, emissiveIntensity: 0.7 }));
	glow.position.y = 2.3;
	glow.name = g.name;
	// one backpack each, clothes and all they brought (Samuel 2026-10-13)
	const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.2), mat(seat === 'A' ? 0x7a5a36 : 0x4f6b3a));
	pack.position.set(0, 1.1, -0.33);
	const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 10).rotateZ(Math.PI / 2), mat(0x9c3b2f));
	roll.position.set(0, 1.4, -0.33);
	pack.castShadow = roll.castShadow = true;
	pack.name = roll.name = g.name;
	g.add(body, head, glow, pack, roll);
	g.userData.glow = glow;
	return g;
}

/** the travel van as the intro rides in it: see-through glass, and inside the people and bags it is packed with,
 *  seat backs, the dashboard and the window posts, so the view from its back seat feels like one */
function packedVan() {
	const van = travelVan();
	van.traverse((o) => {
		if (o.isMesh && o.material?.color?.getHex() === 0x27323a) {
			o.material = o.material.clone();
			o.material.transparent = true;
			o.material.opacity = 0.12;
			o.material.depthWrite = false;
		}
	});
	const inside = new THREE.Group();
	const dark = mat(0x2a2622, { side: THREE.DoubleSide });
	const seatM = mat(0x5a4632);
	const skin = [mat(0x8d5a3c), mat(0xc69472), mat(0x6e4630), mat(0xb07a56)];
	const cloth = [mat(0x9c3b2f), mat(0x3f6f9a), mat(0xd8b04a), mat(0x4f6b3a), mat(0x7b5ea7)];
	const box = (w, h, d, m, x, y, z) => {
		const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
		b.position.set(x, y, z);
		inside.add(b);
		return b;
	};
	for (const x of [-0.93, 0.93]) {
		box(0.02, 0.95, 4.6, dark, x, 1.0, -0.1); // the walls below the windows
		for (const z of [-2.05, -1.1, -0.1, 0.9]) box(0.06, 0.62, 0.1, dark, x, 1.78, z); // window posts
		box(0.08, 0.7, 0.08, dark, x * 0.95, 1.8, 2.02).rotation.x = -0.25; // the windscreen's pillars
	}
	box(1.84, 0.02, 4.6, mat(0x6b6156, { side: THREE.DoubleSide }), 0, 2.1, -0.1); // the roof lining
	box(1.8, 0.3, 0.45, dark, 0, 1.28, 1.9); // the dashboard
	box(0.26, 0.07, 0.03, dark, 0, 1.97, 1.82); // the mirror, a charm hanging from it
	const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), mat(0xd8b04a));
	charm.position.set(0, 1.82, 1.82);
	inside.add(charm);
	box(0.5, 0.2, 0.3, cloth[4], 0.45, 1.5, 1.85); // a bag on the dashboard
	// the rows of seats, and people in them: the driver and a passenger in front of the camera, someone beside it
	const people = [];
	[[1.2, [-0.5, 0.58]], [0.2, [-0.55]], [-0.8, [-0.5, 0.4]]].forEach(([z, xs], row) => {
		for (const x of [-0.45, 0.45]) box(0.8, 0.75, 0.12, seatM, x, 1.12, z - 0.25);
		for (const [k, x] of xs.entries()) {
			const p = new THREE.Group();
			const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.26), cloth[(row * 2 + k) % cloth.length]);
			torso.position.y = 1.25;
			const head = new THREE.Group();
			const face = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), skin[(row + k) % skin.length]);
			const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), (row + k) % 3 ? mat(0x1c1612) : cloth[(row + k + 2) % cloth.length]);
			hair.position.set(0, 0.012, -0.012);
			head.add(face, hair);
			head.position.y = 1.62;
			const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.14, 8), skin[(row + k) % skin.length]);
			neck.position.y = 1.5;
			p.add(torso, neck, head);
			p.position.set(x, 0, z);
			p.userData.head = head;
			inside.add(p);
			people.push(p);
		}
	});
	// bags piled on the seat beside the camera, and on the floor
	box(0.55, 0.4, 0.5, cloth[0], -0.45, 1.05, -1.3);
	box(0.5, 0.35, 0.45, cloth[3], -0.4, 1.42, -1.35);
	box(0.6, 0.3, 0.4, mat(0xd8ccaa), 0.5, 0.95, -0.55);
	van.add(inside);
	van.userData.people = people;
	return van;
}

/** where the newcomer sits in the van, and where they look */
const VAN_SEAT = V(0.12, 1.6, 0.2);
const VAN_LOOK = V(0.0, 1.45, 14);

export function createWorld(canvas, { onPick = () => {}, onLabels = () => {}, onCaption = () => {} } = {}) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	const scene = new THREE.Scene();
	const sky = new THREE.Color(0xd8e2e2);
	scene.background = sky;
	scene.fog = new THREE.Fog(sky, 380, 2200);
	const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 6400);
	camera.position.set(138, 118, 170);
	const controls = new OrbitControls(camera, canvas);
	controls.target.set(2, 1, 3);
	controls.enableDamping = true;
	controls.minDistance = 12;
	controls.maxDistance = 2700; // far enough out to see the whole city plot
	controls.maxPolarAngle = Math.PI * 0.44;
	controls.autoRotateSpeed = 0.25;
	let goal = null; // where the camera eases to: { target, offset }
	let drift = true; // the slow orbit round the place; a drag stops it until the story moves on
	controls.addEventListener('start', () => ((drift = false), (goal = null)));

	const hemi = new THREE.HemisphereLight(0xeef4ff, 0x7a6b4a, 1.1);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 500 });
	scene.add(sun, sun.target);

	const world = new THREE.Group();
	scene.add(world);
	const { group: ground, rims } = land();
	world.add(ground, highway(), steppe(), gravel(), bushes());
	let shown = -1;
	/** how much of the locked land shows its dotted rim: 0 our own hex only, 1 this village, 2 the whole city plot */
	function reveal(level) {
		if (level === shown) return;
		for (const o of rims) o.visible = o.userData.level <= level;
		shown = level;
	}
	reveal(0);
	const home = tent();
	world.add(home);

	const named = (o, name) => (o.traverse((c) => { c.name = name; if (c.isMesh) c.castShadow = true; }), o);
	// the MaiaCity centre: the bus stop and the abandoned gas station by the highway
	const centre = maiaCentre({ withVan: false, withRoad: false });
	centre.position.set(CENTRE.x, 0, CENTRE.z);
	centre.children.forEach((c, i) => named(c, i === 0 ? 'asset:busStop' : 'asset:gasStation'));
	world.add(centre);
	// the village store: the old shed, the solar row and the battery the Village COOP keeps at its centre hex
	const shed = named(oldShed(), 'asset:shed');
	shed.position.set(STORE.x, 0, STORE.z);
	const solar = named(solarRow(6), 'asset:solar');
	solar.position.set(STORE.x, 0, STORE.z - 9);
	solar.rotation.y = Math.PI;
	const battery = named(batteryPack(), 'asset:battery');
	battery.position.set(STORE.x + 7, 0, STORE.z - 2);
	battery.rotation.y = -0.3;
	world.add(shed, solar, battery);
	// the pickup at its real size (5.4 m), and the powercube it fetches, drawn as a small silenced cube that fits its bed
	const truck = named(pickup(), 'asset:pickup');
	// the powercube: the Power Cube Electric, OSE's Power Cube VII with an alternator in place of its hydraulics
	const cubeCast = powerCube({ electric: true }); // the Power Cube Electric (#608): the tent's power
	cubeCast.rig.pose(cubeCast.clips.off(0));
	const cube = named(cubeCast.rig.object, 'asset:powercube');
	const bundle = named(packedTent(), 'asset:tent');
	const fuel = [jerrycan(), jerrycan()].map((c) => named(c, 'asset:fuel'));
	world.add(truck, cube, bundle, ...fuel);
	// the travel van of the arrival, packed
	const van = named(packedVan(), 'asset:van');
	van.visible = false;
	world.add(van);
	const people = { A: person('A'), B: person('B') };
	world.add(people.A, people.B);

	/** a place on the track (0 the highway, 1 the lot) and the way it heads */
	const along = (u) => {
		const p = TRACK.getPointAt(Math.min(1, Math.max(0, u)));
		const t = TRACK.getTangentAt(Math.min(0.999, Math.max(0.001, u)));
		return { p, yaw: Math.atan2(t.x, t.z), t };
	};
	const putTruck = (u, back = false) => {
		const { p, yaw } = along(u);
		truck.position.copy(p);
		truck.rotation.y = yaw + (back ? Math.PI : 0);
	};
	// a point beside the pickup, out of its left (+x) side
	const beside = (o, side, ahead = 0) => o.localToWorld(V(side * 2.6, 0, ahead)).setY(0);
	const HOME = { A: V(-5.5, 0, 7), B: V(5.5, 0, 6) };

	/** where things stand at this point of the story: at ('arrive', 'stop', 'village', 'home'), the powercube
	 *  ('shed', 'bed', 'home'), whose seat this is (me), the other seat if anyone has it, and whether the other
	 *  rides along (they came to fetch me) */
	let stage = { at: 'home', cube: 'home', tent: 'up', me: 'A', other: 'B', rides: false };
	let busy = false; // an intro, a drive or a load is playing
	function set(next) {
		stage = { ...stage, ...next };
		if (!busy) place();
	}
	function place() {
		const { at, me, other, rides } = stage;
		// the second player is fetched: until then the pickup stands at home with the first
		const fetched = me === 'B';
		if ((at === 'stop' || at === 'arrive') && !fetched) putTruck(U_START);
		else if (at === 'village') putTruck(U_STORE);
		else (putTruck(1), (truck.rotation.y = 2.2));
		truck.updateMatrixWorld(true);
		placeCube(stage.cube);
		placeTent(stage.tent);
		placeFuel(stage.cube === 'home' ? 'home' : at === 'van' || at === 'arrive' || (at === 'stop' && !fetched) ? 'station' : 'bed');
		for (const s of ['A', 'B']) {
			const p = people[s];
			p.visible = true;
			p.rotation.y = s === 'A' ? 0.4 : -0.4;
			if (s !== me && s !== other) p.visible = false;
			else if (at === 'home' || (s === other && !rides)) p.position.copy(HOME[s]);
			else if (at === 'arrive' || (s === other && at === 'stop')) p.visible = false;
			else if (at === 'stop') (p.position.copy(STOP), (p.rotation.y = -Math.PI / 2 - 0.5));
			else p.position.copy(beside(truck, 1, s === me ? 1 : -1.6));
		}
		van.visible = at === 'van';
		riding = at === 'van';
		if (riding) {
			for (const p of van.userData.people) p.visible = true;
			for (const s of ['A', 'B']) people[s].visible = false;
			controls.enabled = false;
			lensIn();
		} else if (!busy) {
			controls.enabled = true;
			if (camera.near < 0.5) lensOut();
		}
	}
	/** still on the road (at 'van'): the van rolls on down the highway at its real speed, the camera in its back seat,
	 *  while the story tells what lies ahead; the road loops far out on the steppe, so the van never reaches the stop */
	let riding = false;
	let rideT = 0;
	const lensIn = () => ((camera.fov = camera.aspect < 0.8 ? 80 : 72), (camera.near = 0.05), camera.updateProjectionMatrix());
	const lensOut = () => ((camera.near = 0.5), (camera.fov = camera.aspect < 0.8 ? 58 : 42), camera.updateProjectionMatrix());
	function ride(step) {
		rideT = (rideT + step) % 50;
		van.position.set(VAN_HALT.x - 2200 + SPEED.highway * rideT, 0, VAN_HALT.z);
		van.rotation.y = Math.PI / 2;
		van.updateMatrixWorld(true);
		const t = performance.now() / 1000;
		camera.position.copy(van.localToWorld(VAN_SEAT.clone())).add(V(0, Math.sin(t * 23) * 0.012 + Math.sin(t * 7.3) * 0.02, 0));
		camera.lookAt(van.localToWorld(VAN_LOOK.clone().add(V(Math.sin(t * 0.21) * 3, 0, 0))));
		for (const [i, p] of van.userData.people.entries()) p.userData.head.position.y = 1.62 + Math.sin(t * 9 + i) * 0.015;
	}
	/** the jerrycans: waiting on the forecourt beside the pickup, in its bed, or at home beside the Power Cube */
	function placeFuel(where) {
		fuel.forEach((c, i) => {
			if (c.parent !== world) world.attach(c);
			c.rotation.set(0, 0, 0);
			if (where === 'bed') (truck.add(c), c.position.copy(FUEL_ON_BED[i]));
			else if (where === 'home') (c.position.set(YARD.x + 1.1, 0, YARD.z + 0.5 + i * 0.25), (c.rotation.y = 0.3));
			else (truck.updateMatrixWorld(true), c.position.copy(truck.localToWorld(V(1.35, 0, -1.6 - i * 0.45))), (c.rotation.y = truck.rotation.y));
		});
	}
	const TENT_IN_SHED = V(STORE.x - 1.5, 0, STORE.z + 0.6);
	/** the tent: packed in the shed, packed on the pickup's bed, or pitched at the middle of our hex */
	function placeTent(where) {
		home.visible = where === 'up';
		home.scale.setScalar(1);
		bundle.visible = where !== 'up';
		if (bundle.parent !== world) world.attach(bundle);
		bundle.scale.setScalar(1);
		bundle.rotation.set(0, 0.3, 0);
		if (where === 'shed') bundle.position.copy(TENT_IN_SHED);
		else if (where === 'bed') {
			truck.add(bundle);
			bundle.position.copy(TENT_ON_BED);
			bundle.rotation.set(0, 0, 0);
		}
	}
	function placeCube(where) {
		if (cube.parent !== world) world.attach(cube);
		if (where === 'shed') (cube.position.copy(CUBE_IN_SHED), (cube.rotation.y = Math.PI / 2));
		else if (where === 'home') (cube.position.set(YARD.x, 0, YARD.z), (cube.rotation.y = -0.3));
		else {
			truck.add(cube);
			cube.position.copy(CUBE_ON_BED);
			cube.rotation.set(0, Math.PI / 2, 0); // its 1 m length across the 1.7 m bed
		}
	}

	/** the camera's places: what it looks at, and from where; once there, it drifts slowly round, like a crane on a set */
	const PLACES = {
		centre: { target: V(STOP.x + 6, 2, STOP.z + 1), offset: V(-34, 26, -50) },
		city: { target: V(CX + 120 * K, 0, CZ + 80 * K), offset: V(620 * K, 900 * K, 860 * K) },
		village: { target: V(STORE.x, 2, VZ - 6), offset: V(52, 38, 58) },
		tribe: { target: V(2, 1, 3), offset: V(30, 22, 40) }
	};
	let placeNow = '';
	let placed = false; // the first place is taken at once, without easing
	let tourOn = false;
	/** turn the camera to a place of the story, easing there (or at once) */
	function focus(name, { now = false } = {}) {
		if (name === placeNow && !now) return;
		const p = PLACES[name];
		if (!p) return;
		placeNow = name;
		if (busy || riding) return; // taken up when the moment ends
		if (!placed) (placed = true), (now = true);
		const offset = p.offset.clone().multiplyScalar(camera.aspect < 0.8 ? 1.65 : 1);
		goal = { target: p.target.clone(), offset };
		drift = true;
		if (now) {
			controls.target.copy(goal.target);
			camera.position.copy(goal.target).add(offset);
			goal = null;
		}
	}
	/** while the story's card sits low on the screen, the picture is drawn a little higher, so the place shows above it */
	function frameView() {
		const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
		if (tourOn && !busy) camera.setViewOffset(w, h, 0, h * 0.17, w, h);
		else camera.clearViewOffset();
	}
	const touring = (on) => {
		if (on === tourOn) return;
		tourOn = on;
		frameView();
	};

	// moments that play over a few seconds: one at a time, each step a function of its own clock
	let moment = null;
	function play(steps, { hour: at } = {}) {
		return new Promise((done) => {
			busy = true;
			controls.enabled = false;
			goal = null;
			frameView();
			moment = { steps, i: 0, t0: performance.now() / 1000, done, hour: at };
		});
	}
	function endMoment() {
		const m = moment;
		moment = null;
		busy = false;
		controls.enabled = true;
		camera.near = 0.5;
		camera.fov = camera.aspect < 0.8 ? 58 : 42;
		camera.updateProjectionMatrix();
		// the orbit picks up from where the camera looks now; what the moment moved stays where it ended, and the page sets the next stage
		controls.target.copy(camera.position).add(camera.getWorldDirection(V(0, 0, 0)).multiplyScalar(40));
		frameView();
		onCaption(null);
		const name = placeNow;
		placeNow = '';
		if (riding) (lensIn(), (controls.enabled = false));
		else if (name) focus(name);
		m?.done();
	}
	function runMoment(now) {
		const m = moment;
		dt = Math.min(0.25, now - (m.last ?? now - 1 / 60));
		m.last = now;
		if (!m.started) (m.started = true), m.steps[0].start?.(), m.steps[0].caption && onCaption(m.steps[0].caption);
		let step = m.steps[m.i];
		let t = now - m.t0;
		while (t >= step.dur) {
			step.run?.(1);
			m.i++;
			m.t0 += step.dur;
			t -= step.dur;
			if (m.i >= m.steps.length) return endMoment();
			step = m.steps[m.i];
			step.start?.();
			if (step.caption) onCaption(step.caption);
		}
		step.run?.(t / step.dur);
	}
	const ease = (k) => k * k * (3 - 2 * k);
	const easeOut = (k) => 1 - (1 - k) * (1 - k);
	let dt = 1 / 60; // the last frame's length, so the camera follows at the same pace however fast the frames come
	const camLerp = (pos, look, k = 0.08) => {
		k = 1 - Math.pow(1 - k, dt * 60);
		camera.position.lerp(pos, k);
		const t = controls.target.lerp(look, k);
		camera.lookAt(t);
	};
	/** a pose of the film camera (game/film/camera.js): [x, y, z, yaw, pitch] */
	const pose = (p) => {
		camera.position.set(p[0], p[1], p[2]);
		camera.rotation.set(p[4], p[3], 0, 'YXZ');
	};
	const shot = (spec) => pathOf(spec);
	const arr = (v) => [v.x, v.y, v.z];

	// dust: puffs behind whatever drives over the sand, swelling and fading
	const puffs = Array.from({ length: 60 }, () => {
		const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xd9c8a0, roughness: 1, transparent: true, opacity: 0, depthWrite: false }));
		m.visible = false;
		m.userData.age = 9;
		world.add(m);
		return m;
	});
	let puffAt = 0;
	const lastDust = new WeakMap();
	function dust(o, back) {
		const was = lastDust.get(o);
		const now = o.position.clone();
		lastDust.set(o, now);
		if (!was || was.distanceTo(now) < 0.05 || was.distanceTo(now) > 20) return;
		puffAt += was.distanceTo(now);
		if (puffAt < 1.6) return;
		puffAt = 0;
		const p = puffs.find((x) => x.userData.age > 2.4) ?? puffs[0];
		o.updateMatrixWorld(true);
		p.position.copy(o.localToWorld(V((Math.random() - 0.5) * 1.2, 0.5, back)));
		p.userData.age = 0;
		p.visible = true;
	}
	function settleDust(step) {
		for (const p of puffs) {
			if (!p.visible) continue;
			const a = (p.userData.age += step);
			if (a > 2.4) (p.visible = false), (p.material.opacity = 0);
			else (p.scale.setScalar(0.8 + a * 1.6), (p.material.opacity = 0.32 * (1 - a / 2.4)), (p.position.y += step * 0.6));
		}
	}

	/** the arrival, cut like a trailer on the film camera's moves: dawn over the endless steppe and a van's dust far
	 *  below; inside the packed van; alongside it past the telegraph poles; the road ending at the abandoned gas station;
	 *  the van pulling up and the newcomer stepping out; looking east, over their shoulder, to the green land; and up,
	 *  over the whole city plot. Each shot carries its line of the story (onCaption). */
	function intro(part = 'road') {
		placed = true;
		const me = people[stage.me];
		// where the van is at the trailer's second T: far out on the steppe in the first two shots (a cut may jump), then
		// on, slowing, to the bus stop
		const VV = SPEED.highway; // the van at 80 km/h, braking to the bus stop over its last five seconds
		const BRAKE = (VV * 5) / 2;
		const vx = (T) =>
			T < 6 ? VAN_HALT.x - 2200 + VV * T : T < 12 ? VAN_HALT.x - 1400 + VV * (T - 6) : T <= 17 ? VAN_HALT.x - BRAKE - VV * (17 - T) : T <= 22 ? VAN_HALT.x - BRAKE + BRAKE * (1 - (1 - (T - 17) / 5) ** 2) : VAN_HALT.x;
		const vanAt = (T) => {
			van.position.set(vx(T), 0, VAN_HALT.z);
			van.rotation.y = Math.PI / 2;
			dust(van, -2.6);
		};
		const bump = (t) => Math.sin(t * 23) * 0.012 + Math.sin(t * 7.3) * 0.02;
		const door = V(VAN_HALT.x + 0.4, 0, VAN_HALT.z - 1.4);
		const lens = (fov, near = 0.5) => ((camera.fov = fov), (camera.near = near), camera.updateProjectionMatrix());
		const wide = () => (camera.aspect < 0.8 ? 62 : 40);
		const crane = shot({ kind: 'move', from: [VAN_HALT.x - 70, 2.4, ROAD_Z - 9], to: [VAN_HALT.x - 52, 30, ROAD_Z - 44], aimFrom: [VAN_HALT.x - 40, 1.4, ROAD_Z], aimTo: [CX + 4, 2, ROAD_Z], curve: 'ease' });
		const low = shot({ kind: 'move', from: [STOP.x + 6, 0.9, STOP.z - 5.5], to: [STOP.x + 4.5, 1.1, STOP.z - 4], aimFrom: [VAN_HALT.x, 1.3, VAN_HALT.z], aimTo: [VAN_HALT.x + 1, 1.4, VAN_HALT.z - 1], curve: 'drift' });
		const shoulder = shot({ kind: 'move', from: [STOP.x - 7, 2.3, STOP.z - 4.5], to: [STOP.x - 2.6, 2.05, STOP.z - 1.4], aimFrom: [STOP.x, 1.8, STOP.z], aimTo: [CX + 240, 3, CZ - 70], curve: 'ease' });
		let rise = null;
		let T = 0;
		const shots = [
				{
					dur: 6,
					caption: { title: 'Somewhere past the end of the map…', dur: 6 },
					start: () => {
						place();
						van.visible = true;
						for (const p of van.userData.people) p.visible = true;
						me.visible = false;
						lens(wide());
					},
					run: (k) => {
						T = k * 6;
						vanAt(T);
						const e = ease(k), x = vx(T);
						pose(look([x - 170 + 120 * e, 150 - 80 * e, ROAD_Z + 230 - 120 * e], [x + 30, 0, ROAD_Z]));
					}
				},
				{
					dur: 6,
					caption: { title: '…a van full of people, and everything they own.', dur: 6 },
					start: () => lens(72, 0.05),
					run: (k) => {
						T = 6 + k * 6;
						vanAt(T);
						van.updateMatrixWorld(true);
						camera.position.copy(van.localToWorld(VAN_SEAT.clone())).add(V(0, bump(T), 0));
						camera.lookAt(van.localToWorld(VAN_LOOK.clone()));
						for (const [i, p] of van.userData.people.entries()) p.userData.head.position.y = 1.62 + Math.sin(T * 9 + i) * 0.015;
					}
				},
				{
					dur: 5,
					caption: { title: 'They are not running away.', sub: 'They are going towards something.', dur: 5 },
					start: () => {
						lens(wide() + 6);
						for (const p of van.userData.people) p.visible = false;
					},
					run: (k) => {
						T = 12 + k * 5;
						vanAt(T);
						const x = vx(T);
						pose(look([x + 5 - 4 * k, 1.3, ROAD_Z - 9.5], [x + 1.5, 1.3, VAN_HALT.z]));
					}
				},
				{
					dur: 5,
					caption: { title: 'Here, the old road ends.', dur: 5 },
					start: () => {
						lens(wide());
						van.visible = true;
						for (const p of van.userData.people) p.visible = false;
						me.visible = false;
					},
					run: (k) => {
						T = 17 + k * 5;
						vanAt(T);
						pose(crane(k));
					}
				},
				{
					dur: 5,
					caption: { title: 'And something new begins.', dur: 5 },
					start: () => {
						vanAt(22);
						me.visible = true;
						me.position.copy(door);
					},
					run: (k) => {
						const w = Math.min(1, Math.max(0, (k - 0.15) / 0.6));
						me.position.lerpVectors(door, STOP, ease(w));
						pose(low(k));
					}
				},
				{
					dur: 5,
					caption: { title: 'Land that belongs to everyone who lives on it.', dur: 5 },
					run: (k) => {
						const u = easeOut(k) * 0.35;
						van.position.copy(VAN_OUT.getPointAt(u));
						const t = VAN_OUT.getTangentAt(Math.max(0.001, u));
						van.rotation.y = Math.atan2(t.x, t.z);
						dust(van, -2.6);
						pose(shoulder(k));
					}
				},
				{
					dur: 6.5,
					caption: { title: 'Welcome to MaiaCity', sub: 'A city owned by the people who live in it. You are one of the first.', big: true, dur: 6.5 },
					start: () => {
						van.visible = false;
						reveal(2);
						const from = arr(camera.position);
						rise = shot({ kind: 'move', from, to: [CX - 260 * K, 560 * K, CZ - 560 * K], aimFrom: [CX + 240, 3, CZ - 70], aimTo: [CX + 160 * K, 0, CZ + 80 * K], curve: 'ease' });
					},
					run: (k) => pose(rise(k))
				}
			];
		// the road (three shots, then the ride goes on inside the van while the story tells of what lies ahead), or
		// the arrival at the end of the road (four shots)
		return play(part === 'road' ? shots.slice(0, 3) : shots.slice(3), { hour: 8.6 });
	}

	/** a drive in the pickup along the track, cut in three shots: from the roadside as it sets off, from the air
	 *  as it crosses the land, and close behind it as it arrives. To the village's shed, or on home to our tribe; when the
	 *  other player comes to fetch me (fetch), the pickup first drives out from the tribe to the bus stop. */
	function drive(leg, { fetch = false } = {}) {
		const me = people[stage.me];
		const other = stage.other ? people[stage.other] : null;
		// the pickup drives at a real track speed (SPEED.track); the cuts between the three shots skip the middle of
		// the way, as a film does, so a long drive still plays in a few seconds without the truck flying
		const L = TRACK.getLength();
		const go = (from, to, dur) => {
			let cut = -1;
			let fixed = null;
			const dist = Math.abs(to - from) * L;
			const v = SPEED.track;
			const d0 = dur * 0.3, d1 = dur * 0.38, d2 = dur * 0.32;
			const ramp = (t) => (t < 2 ? (v * t * t) / 4 : v * (t - 1)); // two seconds to get up to speed
			const metres = (k) => {
				if (dist <= ramp(d0) + v * d1 + ramp(d2)) return dist * ease(k); // short enough to drive whole
				const t = k * dur;
				if (t < d0) return ramp(t);
				if (t < d0 + d1) return dist / 2 + v * (t - d0 - d1 / 2);
				return dist - ramp(dur - t);
			};
			return {
				dur,
				run: (k) => {
					const u = from + Math.sign(to - from) * (metres(k) / L);
					const back = to < from;
					putTruck(u, back);
					dust(truck, -2.8);
					const { p, t } = along(u);
					const dir = back ? t.clone().negate() : t;
					const side = V(dir.z, 0, -dir.x);
					const phase = k < 0.3 ? 0 : k < 0.68 ? 1 : 2;
					if (phase !== cut) {
						cut = phase;
						if (phase === 0) {
							const ahead = along(from + (to - from) * 0.1);
							fixed = ahead.p.clone().add(side.clone().multiplyScalar(6)).setY(1.5);
						}
						if (phase === 1) camera.position.copy(p).add(side.clone().multiplyScalar(28)).add(V(0, 17, 0)).sub(dir.clone().multiplyScalar(8));
						if (phase === 2) camera.position.copy(p).sub(dir.clone().multiplyScalar(14)).add(V(0, 5.5, 0)).add(side.clone().multiplyScalar(3));
						controls.target.copy(p);
					}
					if (phase === 0) (camera.position.copy(fixed), camLerp(fixed, p.clone().setY(1.6), 0.3));
					else if (phase === 1) camLerp(p.clone().add(side.clone().multiplyScalar(28)).add(V(0, 17, 0)).sub(dir.clone().multiplyScalar(8)), p.clone().add(dir.clone().multiplyScalar(7)), 0.12);
					else camLerp(p.clone().sub(dir.clone().multiplyScalar(14)).add(V(0, 5.5, 0)).add(side.clone().multiplyScalar(3)), p.clone().add(dir.clone().multiplyScalar(6)).setY(1.2), 0.2);
				}
			};
		};
		const getIn = (start) => ({ dur: 0.7, start: () => { start?.(); placeFuel(stage.cube === 'home' ? 'home' : 'bed'); me.visible = false; if (other && stage.rides) other.visible = false; } });
		const steps = [];
		if (fetch) steps.push({ dur: 0.7, start: () => { putTruck(1, true); if (other) other.visible = false; } }, go(1, U_START, 12), getIn());
		else steps.push(getIn());
		steps.push(leg === 'village' ? go(U_START, U_STORE, 13) : go(U_STORE, 1, 9));
		const first = steps[0].start;
		steps[0].start = () => {
			first();
			camera.fov = camera.aspect < 0.8 ? 58 : 42;
			camera.updateProjectionMatrix();
		};
		return play(steps);
	}

	/** loading the powercube and the packed tent from the shed onto the pickup's bed */
	function load() {
		truck.updateMatrixWorld(true);
		const lift = (o, from, to, k, h = 5) => {
			const e = ease(k);
			o.position.lerpVectors(from, to, e).setY(from.y + (to.y - from.y) * e + Math.sin(Math.PI * e) * h);
			o.rotation.y = truck.rotation.y * e;
		};
		const cubeTo = truck.localToWorld(CUBE_ON_BED.clone());
		const tentTo = truck.localToWorld(TENT_ON_BED.clone());
		const look = V(STORE.x + 2, 2, (STORE.z + VZ) / 2);
		const eye = V(STORE.x + 13, 7, VZ + 16);
		return play([
			{ dur: 0.3, start: () => (placeCube('shed'), placeTent('shed')) },
			{ dur: 2.6, run: (k) => (lift(cube, CUBE_IN_SHED, cubeTo, k), camLerp(eye, look, 0.06)) },
			{ dur: 0.2, start: () => ((stage.cube = 'bed'), placeCube('bed')) },
			{ dur: 2, run: (k) => (lift(bundle, TENT_IN_SHED, tentTo, k, 3), camLerp(eye.clone().add(V(-6, -2, 4)), look, 0.06)) },
			{ dur: 0.6, start: () => ((stage.tent = 'bed'), placeTent('bed')), run: () => camLerp(eye, look, 0.06) }
		]);
	}

	/** pitching the tent at the middle of our hex: the bundle comes off the pickup, the powercube goes to its yard, and
	 *  the little dome rises strut by strut while the camera circles it */
	function pitch() {
		truck.updateMatrixWorld(true);
		const from = truck.localToWorld(TENT_ON_BED.clone());
		const cubeFrom = truck.localToWorld(CUBE_ON_BED.clone());
		const orbit = shot({ kind: 'orbit', centre: [0, 0], a0: 0.4, a1: 1.9, r0: 16, r1: 10, y0: 8, y1: 3.5, aim: [0, 1, 0], curve: 'ease' });
		return play([
			{
				dur: 1.6,
				start: () => {
					world.attach(bundle);
					world.attach(cube);
					bundle.scale.setScalar(1);
					cube.scale.setScalar(1);
				},
				run: (k) => {
					const e = ease(k);
					bundle.position.lerpVectors(from, V(0, 0, 2), e).setY(from.y * (1 - e) + Math.sin(Math.PI * e) * 2);
					cube.position.lerpVectors(cubeFrom, V(YARD.x, 0, YARD.z), e).setY(cubeFrom.y * (1 - e) + Math.sin(Math.PI * e) * 3);
					pose(orbit(k * 0.2));
				}
			},
			{
				dur: 4.2,
				start: () => {
					bundle.visible = false;
					home.visible = true;
				},
				run: (k) => {
					const e = ease(k);
					home.scale.set(0.3 + 0.7 * e, Math.max(0.02, e), 0.3 + 0.7 * e);
					home.rotation.y = (1 - e) * 0.6;
					pose(orbit(0.2 + k * 0.8));
				}
			},
			{ dur: 0.4, start: () => ((stage.tent = 'up'), (stage.cube = 'home'), placeTent('up'), placeCube('home')), run: () => pose(orbit(1)) }
		]);
	}
	/** jump to the end of what is playing */
	const skip = () => {
		if (!moment) return;
		for (const s of moment.steps.slice(moment.i)) (s.start?.(), s.run?.(1));
		endMoment();
	};

	place();

	let hour = 11;
	function update(view, h) {
		if (h != null) hour = h;
		if (!view) return;
		for (const seat of ['A', 'B']) {
			const hearts = view.players[seat].wallet.HEARTS;
			const glow = people[seat].userData.glow;
			glow.visible = hearts > 0.01 && !busy;
			glow.scale.setScalar(0.5 + Math.min(1.5, hearts / 24));
		}
	}

	// the sun by the virtual hour: up from 6 to 18, low and warm at the ends, a cool night with a moonlight; it
	// follows what the camera looks at, so the shadows fall wherever the story is
	function light(t) {
		const day = ((moment?.hour ?? hour) - 6) / 12;
		const up = Math.sin(Math.PI * Math.min(1, Math.max(0, day)));
		const a = Math.PI * day;
		sun.target.position.copy(controls.target).setY(0);
		sun.position.set(Math.cos(a) * 90, 8 + up * 80, -30 + Math.sin(a) * 20).add(sun.target.position);
		sun.intensity = 0.25 + up * 2.1;
		sun.color.setHSL(0.1, 0.6 - up * 0.3, 0.75 + up * 0.15);
		hemi.intensity = 0.35 + up * 0.85;
		const c = new THREE.Color(0x1d2b3d).lerp(new THREE.Color(0xd8e2e2), Math.min(1, up * 1.6));
		scene.background.copy(c);
		scene.fog.color.copy(c);
		// the haze keeps its distance from the camera, so the far view of the whole city still reads
		const d = camera.position.distanceTo(controls.target);
		scene.fog.near = Math.max(260, d * 0.75);
		scene.fog.far = Math.max(1600, d * 2.6);
		for (const seat of ['A', 'B']) {
			const g = people[seat].userData.glow;
			g.rotation.y = t * 1.5;
			g.position.y = 2.3 + Math.sin(t * 2 + (seat === 'A' ? 0 : 1.5)) * 0.1;
		}
	}

	function resize() {
		const w = canvas.clientWidth || 1;
		const h = canvas.clientHeight || 1;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		if (!busy) camera.fov = w / h < 0.8 ? 58 : 42;
		camera.updateProjectionMatrix();
		frameView();
	}
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);
	resize();

	// a tap (not a drag) names the thing under it
	const ray = new THREE.Raycaster();
	let down = null;
	const onDown = (e) => (down = [e.clientX, e.clientY]);
	const onUp = (e) => {
		if (busy || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
		const r = canvas.getBoundingClientRect();
		ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
		const hit = ray.intersectObjects(world.children, true).find((h) => h.object.name && h.object.visible);
		onPick(hit ? hit.object.name : null);
	};
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointerup', onUp);

	let frame = 0;
	let raf = 0;
	const clock = new THREE.Clock();
	let lastT = null;
	function loop() {
		raf = requestAnimationFrame(loop);
		const t = clock.getElapsedTime();
		const step = Math.min(0.25, t - (lastT ?? t));
		lastT = t;
		settleDust(step);
		if (moment) runMoment(performance.now() / 1000);
		else if (riding) ride(step);
		else {
			if (goal) {
				const at = goal.target.clone().add(goal.offset);
				const ease = 1 - Math.exp(-3.7 * step); // the same glide at any frame rate
				controls.target.lerp(goal.target, ease);
				camera.position.lerp(at, ease);
				if (camera.position.distanceTo(at) < 0.5) goal = null;
			}
			controls.autoRotate = drift && !goal;
			controls.autoRotateSpeed = tourOn ? 0.45 : 0.25;
			controls.update();
		}
		light(t);
		renderer.render(scene, camera);
		if (++frame % 4 === 0) {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			const out = {};
			for (const k of ['A', 'B']) {
				const o = people[k];
				const p = o.localToWorld(V(0, 2.8, 0)).project(camera);
				out[`player:${k}`] = { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, on: o.visible && !busy && p.z < 1 };
			}
			onLabels(out);
		}
	}
	loop();

	return {
		update,
		reveal,
		set,
		focus,
		touring,
		intro,
		drive,
		load,
		pitch,
		skip,
		get busy() {
			return busy;
		},
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointerup', onUp);
			controls.dispose();
			renderer.dispose();
		}
	};
}
