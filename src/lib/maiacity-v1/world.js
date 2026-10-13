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
import { pickup, solarPanel } from '$lib/models/village.js';
import { electroCube } from '$lib/actors/electrocube.js';
import { batteryCube } from '$lib/actors/batterycube.js';
import { MOUTH, human, skinAt } from '$lib/actors/human.ts';
import { SPEED } from '$lib/models/units.js';
import { lineDur } from './tour.js';
import { ME_EYES, ME_SEAT, packedVan } from './van.js';
import { startStage } from './trees.js';
import { plantAt } from '$lib/plants/index.js';
import { SEEDLINGS } from '../../../game/maiacity-v1/engine.js';
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
const BATT_AT = V(STORE.x + 3.4, 0, STORE.z + 0.6);
const PANEL_AT = V(STORE.x + 6, 0, STORE.z - 1.2);
/** the bench of seedlings beside the shed's door, its pots in a row along it (+x), facing the track */
const BENCH = V(STORE.x - 4.4, 0, STORE.z + 3.2);
/** where each player plants their first tree at home, off the tent and the players' places */
const TREE_AT = { A: V(-6.5, 0, -3.5), B: V(7, 0, 9.5) };
/** a tree spot's own frame (x across, y up, z on toward the tent at the hex's middle): a shot from behind it (-z) has
 *  the tent beyond the tree */
const spotAt = (S) => {
	const f = V(-S.x, 0, -S.z).normalize(), r = V(f.z, 0, -f.x);
	return (x, y, z) => S.clone().addScaledVector(r, x).add(V(0, y, 0)).addScaledVector(f, z);
};
/** our tribe: the tent at the middle, the pickup's round lot, a little yard for the powercube once it is home */
const LOT = { x: -16, z: 10, r: 5 }; // room to turn a 5.4 m pickup
const YARD = { x: 12, z: -4, r: 3 };
const BATT_HOME = V(YARD.x + 1.4, 0, YARD.z + 1.1);
const PANEL_HOME = V(YARD.x + 2.6, 0, YARD.z - 2.4);
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
/** where the ElectroCube (0.75 × 1 m) and the packed tent ride in the pickup's bed (1.55 m long, its floor 1.16 m up):
 *  side by side, the cube behind the tool box, the tent by the tailgate */
const CUBE_ON_BED = V(0, 1.16, -1.42);
const TENT_ON_BED = V(0, 1.16 + 0.47, -2.3); // lying on the two jerrycans
/** the second player's load: the BatteryCube where the ElectroCube rides, the solar panel on its rack behind it, over
 *  the open tailgate; at the village beside the shed, at home beside the tent and the ElectroCube */
const PANEL_ON_BED = V(0, 1.16, -2.55);
/** the two 20-litre jerrycans of petrol for the ElectroCube (its engine runs on petrol): in the bed behind
 *  the cube, the tent strapped over them */
const FUEL_ON_BED = [V(-0.55, 1.16, -1.95), V(0.55, 1.16, -1.95)];
const POT_ON_BED = V(0.6, 1.16, -0.86); // the seedling in its pot, in the bed's front corner by the cab

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

/** a player: the rigged stand-in from Actors (./actors/human.ts) at 1.8 m, in their seat's colour, their one backpack
 *  on. It plays what it does (act): a clip of the stand-in (idle, walk, wave), one of its poses (kneel, point, look up,
 *  think) or one of the player's own (carry, push), walking on as it moves */
export function person(seat) {
	const g = new THREE.Group();
	g.name = `player:${seat}`;
	const cast = human({ shirt: `#${SEAT_COLOUR[seat].toString(16).padStart(6, '0')}`, trousers: seat === 'A' ? '#5b5145' : '#3d4a5c' }, 1.8);
	cast.rig.object.name = g.name;
	cast.rig.object.castShadow = true;
	cast.rig.object.receiveShadow = false; // the sun's shadow map is far too coarse for a face: it drew a dark band over the eyes
	cast.rig.object.frustumCulled = false;
	const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshStandardMaterial({ color: 0xe0435a, emissive: 0xe0435a, emissiveIntensity: 0.7 }));
	glow.position.y = 2.3;
	glow.name = g.name;
	// one backpack each, clothes and all they brought (Samuel 2026-10-13), on the chest bone so it moves with the back
	const pack = new THREE.Group();
	const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.18), mat(seat === 'A' ? 0x7a5a36 : 0x4f6b3a));
	const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 10).rotateZ(Math.PI / 2), mat(0x9c3b2f));
	roll.position.y = 0.3;
	bag.castShadow = roll.castShadow = true;
	bag.name = roll.name = g.name;
	pack.add(bag, roll);
	const chest = cast.rig.bones.chest ?? cast.rig.bones.spine;
	if (chest) {
		chest.add(pack);
		chest.updateWorldMatrix(true, false);
		pack.position.copy(chest.worldToLocal(V(0, 1.12, -0.24)));
	} else (pack.position.set(0, 1.12, -0.24), g.add(pack));
	// joy, on the head bone: a broad open smile on the lips (a crescent laid on the skin, its upper teeth showing), shown
	// when they beam (after the first mint); the eyes' catchlights are the stand-in's own
	const joyFace = new THREE.Group();
	const head = cast.rig.bones.head;
	if (head) {
		cast.rig.object.updateMatrixWorld(true);
		const k = 1.8 / 1.823; // the stand-in's measure (./actors/human.ts) to 1.8 m
		const at = (x, y, z) => head.worldToLocal(V(x * k, y * k, z * k));
		/** a band between two edges of the smile (x, y about the mouth's middle, `mid` m at the middle, `end` at the
		 * corners), laid onto the face `lift` m off the skin, in short strips that follow its curve */
		const W = MOUTH.w + 0.001; // half the smile's width
		const band = (top, bottom, lift, w = W, n = 16) => {
			const pts = [], idx = [];
			for (let i = 0; i <= n; i++) {
				const x = -w + (2 * w * i) / n, u = (x / W) ** 2;
				for (const [mid, end] of [top, bottom]) {
					const y = MOUTH.y + 0.0036 + mid + (end - mid) * u;
					pts.push(...at(x, y, skinAt(x, y) + lift).toArray());
				}
				if (i) idx.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
			}
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
			geo.setIndex(idx);
			geo.computeVertexNormals();
			return geo;
		};
		const red = new THREE.MeshStandardMaterial({ color: 0x5a2226, roughness: 0.8, side: THREE.DoubleSide });
		const white = new THREE.MeshStandardMaterial({ color: 0xf3eee6, roughness: 0.45, side: THREE.DoubleSide });
		const mouth = new THREE.Mesh(band([0.0005, 0.004], [-0.0095, 0.004], 0.0036), red);
		const teeth = new THREE.Mesh(band([0.0002, 0.0034], [-0.0045, 0.0018], 0.0062, W * 0.72), white);
		const smile = new THREE.Group();
		smile.add(mouth, teeth);
		joyFace.add(smile);
		joyFace.visible = false;
		head.add(joyFace);
	}
	g.add(cast.rig.object, glow);
	g.userData = { glow, cast, joyFace, act: 'idle', t: Math.random() * 9 };
	return g;
}

/** the player's own poses, beyond the stand-in's: carrying something in both arms before them, pushing something along */
const CARRY = { upperArmL: [-0.75, 0, 0.18], upperArmR: [-0.75, 0, -0.18], forearmL: [-0.95, 0, 0], forearmR: [-0.95, 0, 0], handL: [0, 0, -0.3], handR: [0, 0, 0.3] };
const CANS = { upperArmL: [0, 0, 0.16], upperArmR: [0, 0, -0.16], forearmL: [-0.05, 0, 0], forearmR: [-0.05, 0, 0] };
const PUSH = { spine: [0.25, 0, 0], chest: [0.15, 0, 0], upperArmL: [-1.25, 0, 0.12], upperArmR: [-1.25, 0, -0.12], forearmL: [-0.25, 0, 0], forearmR: [-0.25, 0, 0] };
/** play a player's act at time t: a clip, a pose, or walking carrying/pushing (the legs walk, the arms hold) */
function acting(p, t) {
	const { cast, act } = p.userData;
	const [what, legs] = act.split('+'); // 'carry+walk': the arms carry, the legs walk
	const base = legs ? cast.clips[legs]?.(t) ?? {} : null;
	const hold = { carry: CARRY, push: PUSH, cans: CANS }[what];
	if (hold) return cast.rig.pose({ ...(base ?? cast.clips.idle(t)), ...hold });
	const glad = p.userData.joyFace;
	if (glad) {
		glad.visible = !!p.userData.joy;
		if (glad.visible) glad.children.forEach((c, i) => c.userData.twinkle && c.scale.setScalar(0.8 + 0.3 * Math.abs(Math.sin(t * 3 + i * 1.7))));
	}
	const lift = p.userData.joy ? { neck: [-0.02, 0, 0], head: [-0.06, 0, 0] } : p.userData.extra ?? {}; // the chin up, beaming
	if (cast.clips[what]) return cast.rig.pose({ ...cast.clips[what](t), ...lift });
	cast.rig.pose({ ...(cast.poses[what] ?? cast.poses.stand), ...lift });
}

/** where the newcomer's eyes are in the van (leaning into the aisle to see the road ahead), and where they look */
const VAN_SEAT = V(0.2, 1.8, 0.26);
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
	/** how close the orbit may come at a place: 12 m, or nearer where the place is seen close */
	const nearest = (offset) => Math.min(12, offset.length() * 0.8);
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
	// the Village COOP's solar panel on its rack and its BatteryCube (four BatteryPacks and an inverter in the Power
	// Cube's frame) beside the shed: the second player fetches them home (placeBattery, placePanel)
	const solar = named(solarPanel(), 'asset:solar');
	const batteryCast = batteryCube();
	batteryCast.rig.pose(batteryCast.clips.off(0));
	const battery = named(batteryCast.rig.object, 'asset:battery');
	world.add(shed, solar, battery);
	// once both are home: one cable from the panel to the BatteryCube, and one on to the tent
	const cables = new THREE.Group();
	for (const pts of [[V(PANEL_HOME.x, 0.5, PANEL_HOME.z), V(PANEL_HOME.x - 0.4, 0.03, PANEL_HOME.z + 1.2), V(BATT_HOME.x, 0.03, BATT_HOME.z - 0.6), V(BATT_HOME.x, 0.3, BATT_HOME.z - 0.35)], [V(BATT_HOME.x - 0.3, 0.3, BATT_HOME.z), V(BATT_HOME.x - 1.5, 0.03, BATT_HOME.z + 0.4), V(3.2, 0.03, -1.2), V(2.6, 0.2, -1)]]) {
		const c = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 6), mat(0x161616));
		cables.add(c);
	}
	cables.visible = false;
	world.add(cables);
	// the pickup at its real size (5.4 m), and the powercube it fetches, drawn as a small silenced cube that fits its bed
	const truck = named(pickup(), 'asset:pickup');
	// the powercube: the ElectroCube, OSE's Power Cube frame with an alternator in place of its hydraulics
	const cubeCast = electroCube(); // the ElectroCube (#608): the tent's power
	cubeCast.rig.pose(cubeCast.clips.off(0));
	const cube = named(cubeCast.rig.object, 'asset:powercube');
	const bundle = named(packedTent(), 'asset:tent');
	const fuel = [jerrycan(), jerrycan()].map((c) => named(c, 'asset:fuel'));
	world.add(truck, cube, bundle, ...fuel);
	// the travel van of the arrival, packed
	const van = named(packedVan(), 'asset:van');
	for (const p of van.userData.people) p.castShadow = false; // its people stay out of the sun's coarse shadow map
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
	let stage = { at: 'home', cube: 'home', tent: 'up', battery: 'store', me: 'A', other: 'B', rides: false, pot: 'bench', pick: '' };
	let busy = false; // an intro, a drive or a load is playing
	function set(next) {
		stage = { ...stage, ...next };
		if (!busy) place();
	}
	function place() {
		seatMe(false);
		const { at, me, other, rides } = stage;
		// the second player is fetched: until then the pickup stands at home with the first
		const fetched = me === 'B';
		if ((at === 'stop' || at === 'arrive') && !fetched) putTruck(U_START);
		else if (at === 'village') putTruck(U_STORE);
		else (putTruck(1), (truck.rotation.y = 2.2));
		truck.updateMatrixWorld(true);
		placeCube(stage.cube);
		placeTent(stage.tent);
		placeBattery(stage.battery);
		placePots(stage.pot, stage.pick);
		placeFuel(stage.cube === 'home' ? 'home' : at === 'van' || at === 'arrive' || (at === 'stop' && !fetched) ? 'station' : 'bed');
		for (const s of ['A', 'B']) {
			const p = people[s];
			p.visible = true;
			act(p, 'idle');
			p.rotation.y = s === 'A' ? 0.4 : -0.4;
			if (s !== me && s !== other) p.visible = false;
			else if (at === 'home' || (s === other && !rides)) p.position.copy(HOME[s]);
			else if (at === 'arrive' || (s === other && at === 'stop')) p.visible = false;
			else if (at === 'stop') (p.position.copy(STOP), (p.rotation.y = -Math.PI / 2 - 0.5));
			else p.position.copy(beside(truck, 1, s === me ? 1 : -1.6));
		}
		van.visible = at === 'van';
		riding = at === 'van';
		if (!riding) ((rideHold = ''), phoneOut && phoneShow(null));
		if (riding) {
			for (const p of van.userData.people) p.visible = true;
			for (const s of ['A', 'B']) people[s].visible = false;
			if (RIDE_SHOTS[rideHold]?.me) seatMe(true);
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
		rollVan(step);
		const t = performance.now() / 1000;
		const held = RIDE_SHOTS[rideHold];
		camera.position.copy(held ? held.cam(t, 1) : van.localToWorld(VAN_SEAT.clone())).add(V(0, Math.sin(t * 23) * 0.012 + Math.sin(t * 7.3) * 0.02, 0));
		camera.lookAt(held ? held.at(t, 1) : van.localToWorld(VAN_LOOK.clone().add(V(Math.sin(t * 0.21) * 3, 0, 0))));
	}
	/** the shot the ride holds while the story waits on the player (the mint: close on their face), or none */
	let rideHold = '';
	function holdRide(name = '') {
		rideHold = name;
		seatMe(!!RIDE_SHOTS[name]?.me);
		if (riding) lensIn();
	}
	/** the van rolling on at its real speed, its people nodding to the road */
	function rollVan(step) {
		rideT = (rideT + step) % 50;
		van.position.set(VAN_HALT.x - 2200 + SPEED.highway * rideT, 0, VAN_HALT.z);
		van.rotation.y = Math.PI / 2;
		van.updateMatrixWorld(true);
		dust(van, -2.6);
		van.userData.nod(performance.now() / 1000, step);
	}
	/** the shots of the ride, one a line of the story, so every sentence cuts to a new view (Samuel 2026-10-13): the
	 *  back seat looking ahead, out of the side window at the steppe going by, alongside the van, from high above it,
	 *  from the front seats back at the faces, and from the roadside as it passes. In the van's own frame (+z ahead,
	 *  +x the door's side) */
	const RIDE_SHOTS = {
		seat: { inside: true, cam: () => van.localToWorld(VAN_SEAT.clone()), at: (t) => van.localToWorld(VAN_LOOK.clone().add(V(Math.sin(t * 0.21) * 3, 0, 0))) },
		window: { inside: true, cam: () => van.localToWorld(V(0.55, 1.76, 0.42)), at: (t, k) => van.localToWorld(V(30, 1.2 - 0.4 * k, 6 - 10 * k)) },
		faces: { inside: true, cam: () => van.localToWorld(V(0.0, 1.97, 1.86)), at: (t, k) => van.localToWorld(V(0.25 * k - 0.1, 1.45, -1.2)) },
		along: { cam: (t, k) => van.localToWorld(V(8 - 2 * k, 1.5 + 0.5 * k, 6 - 8 * k)), at: () => van.localToWorld(V(0, 1.4, 0.5)) },
		aerial: { cam: (t, k) => van.localToWorld(V(-40 + 20 * k, 34 - 8 * k, -55 + 25 * k)), at: () => van.localToWorld(V(0, 0, 18)) },
		pass: { fixed: true, cam: () => van.localToWorld(V(4.2, 0.7, 75)), at: () => van.localToWorld(V(0, 1.2, 0)) },
		// the player themself in the back seat, gazing out of the side window (Samuel 2026-10-13): from the front at the
		// side, then close on their face
		profile: { inside: true, me: true, cam: (t, k) => van.localToWorld(V(0.08 + 0.06 * k, 1.74, 1.08)), at: () => van.localToWorld(V(ME_SEAT.x + 0.07, 1.62, ME_SEAT.z + 0.03)) },
		close: { inside: true, me: true, cam: (t, k) => van.localToWorld(V(0.5 + 0.03 * k, 1.8, 0.84 - 0.06 * k)), at: () => van.localToWorld(V(0.49, 1.71, 0.27)) },
		// what the woman beside you does as she tells of the HEARTS (Samuel 2026-10-13: show what the line says): the
		// two of you from the front as she leans over with her phone; its screen, over your shoulder; her face
		lean: { inside: true, me: true, cam: (t, k) => van.localToWorld(V(0.24 - 0.03 * k, 1.8, 0.98 - 0.06 * k)), at: () => van.localToWorld(V(0.17, 1.6, 0.2)) },
		screen: { inside: true, cam: (t, k) => van.localToWorld(ME_EYES.clone()).lerp(van.userData.phoneAt(), 0.36 + 0.12 * k), at: () => van.userData.phoneAt() },
		her: { inside: true, cam: (t, k) => van.localToWorld(V(0.42, 1.7, 0.52 - 0.04 * k)), at: () => van.userData.herFace() }
	};
	// every line of the ride a new view, the back seat's own once (Samuel 2026-10-13: it came round three times)
	const RIDE_ORDER = ['seat', 'aerial', 'profile', 'window', 'along', 'close', 'faces', 'pass'];
	/** the player sitting in the van's back seat for the shots that show them, or back in the world */
	function seatMe(on) {
		const me = people[stage.me];
		if (!me) return;
		if (on) {
			van.add(me);
			me.position.copy(ME_SEAT);
			me.rotation.set(0, 0.45, 0); // the head and shoulders turned to the window
			me.userData.glow.visible = false;
			act(me, 'sit');
			// while the woman beside them shows her phone, they look at it
			me.userData.extra = phoneOut ? { neck: [0.12, -0.2, 0], head: [0.28, -0.32, 0] } : null;
			me.visible = true;
		} else if (me.parent === van) {
			world.attach(me);
			me.userData.glow.visible = true;
			me.userData.extra = null;
			me.visible = false;
			act(me, 'idle');
		}
	}
	let rideCut = 0;
	let phoneOut = false;
	/** the woman beside the player leans over with her phone showing `screen`, or sits back (null) */
	function phoneShow(screen) {
		phoneOut = !!screen;
		van.userData.lean(phoneOut, screen);
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
		if (where !== 'home') cubeCast.rig.pose(cubeCast.clips.off(0)); // it hums only at home, powering the tent
		if (where === 'shed') (cube.position.copy(CUBE_IN_SHED), (cube.rotation.y = Math.PI / 2));
		else if (where === 'home') (cube.position.set(YARD.x, 0, YARD.z), (cube.rotation.y = -0.3));
		else {
			truck.add(cube);
			cube.position.copy(CUBE_ON_BED);
			cube.rotation.set(0, Math.PI / 2, 0); // its 1 m length across the 1.7 m bed
		}
	}	/** the BatteryCube and the solar panel (where): beside the village's shed, in the pickup's bed (the cube where the
	 *  ElectroCube rides, the panel on its rack lying over the tailgate), or set up at home beside the tent */
	// the seedlings at the shed (Samuel 2026-10-13): a plank bench on trestles, and on it one terracotta pot of each
	// of the five, a seedling a few centimetres high in each, grown by the Plants; the one a player picks rides home
	// in the pickup's bed, waits beside the tent, and is planted as their first tree
	const bench = new THREE.Group();
	bench.position.copy(BENCH);
	{
		const wood = mat(0x8a6a48), legs = mat(0x6b5038);
		const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.5), wood);
		top.position.y = 0.76;
		bench.add(top);
		for (const x of [-0.9, 0.9]) for (const z of [-0.2, 0.2]) {
			const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.74, 0.05), legs);
			l.position.set(x, 0.37, z);
			bench.add(l);
		}
		bench.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
	}
	world.add(named(bench, 'asset:seedlings'));
	const clay = mat(0xb5653d), soil = mat(0x3b2a1e);
	const pots = Object.fromEntries(
		SEEDLINGS.map((x, i) => {
			const g = new THREE.Group();
			const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.048, 0.11, 18), clay);
			pot.position.y = 0.055;
			const dirt = new THREE.Mesh(new THREE.CircleGeometry(0.06, 18).rotateX(-Math.PI / 2), soil);
			dirt.position.y = 0.1;
			g.add(pot, dirt);
			g.userData = { pot, dirt, at: V(-0.72 + i * 0.36, 0.785, 0.02), plant: null };
			named(g, `asset:seedling:${x.id}`);
			return [x.id, g];
		})
	);
	/** each pot's seedling, grown the first time it shows (the Plants grow it a few centimetres high) */
	const sprout = (id) => {
		const g = pots[id];
		if (g.userData.plant) return;
		const p = plantAt(id);
		const plant = p.grow(startStage(id, 'shed'), 'shed');
		plant.position.y = 0.1;
		plant.traverse((o) => o.isMesh && ((o.castShadow = true), (o.name = `asset:seedling:${id}`)));
		g.add(plant);
		g.userData.plant = plant;
	};
	/** the pots: all on the bench, or the one picked in the pickup's bed, beside the tent, or planted (gone) */
	function placePots(where = 'bench', pick = '') {
		for (const [id, g] of Object.entries(pots)) {
			if (g.parent !== world && g.parent) g.parent.remove(g);
			const mine = id === pick && where !== 'bench';
			g.userData.pot.visible = g.userData.dirt.visible = true;
			if (g.userData.plant) g.userData.plant.position.y = 0.1;
			g.rotation.set(0, 0, 0);
			if (!mine) (bench.add(g), g.position.copy(g.userData.at));
			else if (where === 'bed') (truck.add(g), g.position.copy(POT_ON_BED));
			else if (where === 'home') (world.add(g), g.position.copy(spotAt(TREE_AT[stage.me])(0.3, 0, -0.25)));
			g.visible = !mine || where !== 'planted';
			if (g.visible && (bench.visible || mine)) sprout(id);
		}
	}

	// the first trees at home, each named after the player who planted it, as they stand on the game clock now
	const trees = {};
	/** the players' trees (list: { seat, plant, seed, stage, label, now, name }), regrown when a stage moves on */
	function setTrees(list = []) {
		for (const seat of ['A', 'B']) {
			const t = list.find((x) => x.seat === seat);
			const had = trees[seat];
			const key = t ? `${t.plant.id}:${t.plant.version}:${t.seed}:${t.stage.toFixed(2)}` : '';
			if (had?.userData.key === key) continue;
			if (had) (world.remove(had), had.traverse((o) => o.geometry?.dispose?.()), delete trees[seat]);
			if (!t) continue;
			const g = t.plant.grow(t.stage, t.seed);
			g.position.copy(TREE_AT[seat]);
			g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.name = `tree:${seat}`)));
			const top = new THREE.Box3().setFromObject(g).max.y;
			g.userData = { key, top: Math.max(0.4, top + 0.35) };
			world.add(g);
			trees[seat] = g;
		}
	}

	function placeBattery(where) {
		cables.visible = where === 'home';
		for (const o of [battery, solar]) if (o.parent !== world) world.attach(o);
		solar.rotation.set(0, 0, 0);
		if (where === 'store') (battery.position.copy(BATT_AT), (battery.rotation.y = 0.2), solar.position.copy(PANEL_AT), (solar.rotation.y = Math.PI + 0.3));
		else if (where === 'home') (battery.position.copy(BATT_HOME), (battery.rotation.y = -0.3), solar.position.copy(PANEL_HOME), (solar.rotation.y = Math.PI - 0.4));
		else {
			truck.add(battery, solar);
			battery.position.copy(CUBE_ON_BED);
			battery.rotation.set(0, Math.PI / 2, 0);
			solar.position.copy(PANEL_ON_BED);
			solar.rotation.set(0, Math.PI / 2, 0);
		}
	}


	/** the camera's places: what it looks at, and from where; once there, it drifts slowly round, like a crane on a set */
	const PLACES = {
		centre: { target: V(STOP.x + 6, 2, STOP.z + 1), offset: V(-34, 26, -50) },
		city: { target: V(CX + 120 * K, 0, CZ + 80 * K), offset: V(620 * K, 900 * K, 860 * K) },
		village: { target: V(STORE.x, 2, VZ - 6), offset: V(52, 38, 58) },
		tribe: { target: V(2, 1, 3), offset: V(30, 22, 40) },
		// close on the seedlings' bench, the player standing at it; each player's spot for their first tree beside the
		// tent, the seedling waiting in its pot; and the tree in the ground (its shots: one a line, in order)
		bench: { target: V(BENCH.x, 0.85, BENCH.z), offset: V(1.6, 1.1, 2.6), stand: V(BENCH.x + 0.25, 0, BENCH.z + 0.62), face: Math.PI, shots: benchShots() },
		...Object.fromEntries(['A', 'B'].flatMap((s) => {
			const L = spotAt(TREE_AT[s]), stand = L(-0.95, 0, 0.55), target = TREE_AT[s].clone().setY(0.25);
			const face = Math.atan2(TREE_AT[s].x - stand.x, TREE_AT[s].z - stand.z);
			return [
				[`plot${s}`, { target, offset: L(0.7, 1.3, -2.2).sub(target), shots: plotShots(L) }],
				[`tree${s}`, { target, offset: L(0.6, 1.1, -1.9).sub(target), stand, face, shots: treeShots(L) }]
			];
		}))
	};
	/** the shots at the bench: close along the five pots; from the side at the player reaching for them; across the
	 *  bench at the player's face looking down at them; along the row once more, slower */
	function benchShots() {
		const B = BENCH, at = (x, y, z) => V(B.x + x, y, B.z + z);
		return [
			(k) => [at(-0.9 + 0.5 * k, 1.12, 0.62), at(-0.35 + 0.5 * k, 0.82, 0)],
			(k) => [at(1.55 - 0.1 * k, 1.85 - 0.1 * k, 1.0), at(-0.15, 0.82, 0)],
			(k) => [at(0.05 + 0.1 * k, 1.25, -0.85), at(0.25, 1.45, 0.62)],
			(k) => [at(0.95 - 1.7 * k, 0.98, 0.5), at(0.75 - 1.6 * k, 0.8, 0)]
		];
	}
	/** before planting (L: the spot's own frame, the tent ahead): the seedling waiting in its pot with the tent behind
	 *  it, then close on it */
	function plotShots(L) {
		return [(k) => [L(0.9 - 0.2 * k, 1.2 - 0.3 * k, -2.6 + 0.5 * k), L(0.1, 0.25, 0.8)], (k) => [L(0.62 - 0.05 * k, 0.3, -0.75 + 0.1 * k), L(0.3, 0.07, -0.25)]];
	}
	/** the tree in the ground: close at its leaves; with the player standing beside it; rising over it to the tent
	 *  and the hex; and close once more */
	function treeShots(L) {
		return [
			(k) => [L(-0.32 + 0.06 * k, 0.26 - 0.04 * k, -0.5 + 0.06 * k), L(0, 0.03, 0)],
			(k) => [L(1.2 - 0.1 * k, 1.3, -2.9 + 0.2 * k), L(-0.45, 0.85, 0.3)],
			(k) => [L(1.3 + 0.5 * ease(k), 1.3 + 3.7 * ease(k), -3.2 - 2.3 * ease(k)), L(-0.4 + 0.4 * ease(k), 0.5 + 0.2 * ease(k), 0.25 + 1.25 * ease(k))],
			(k) => [L(-0.48 + 0.12 * k, 0.3, -0.36), L(0, 0.03, 0)]
		];
	}
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
		controls.minDistance = Math.min(controls.minDistance, nearest(offset)); // the seedlings and the trees are seen close
		goal = { target: p.target.clone(), offset };
		drift = true;
		if (now) {
			controls.target.copy(goal.target);
			camera.position.copy(goal.target).add(offset);
			controls.minDistance = nearest(offset);
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
		if (m?.steps.some((x) => x.caption)) onCaption(null); // the page's own voice-over keeps its line
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

	// the players act their own story: walking at their real pace (SPEED.walk), carrying, pushing, kneeling, getting in
	const WALK = SPEED.walk;
	const act = (p, what) => void (p.userData.act = what);
	const face = (p, at) => void (p.rotation.y = Math.atan2(at.x - p.position.x, at.z - p.position.z));
	/** walk a player along points (world, on the ground), s seconds after setting off; holding something (hold: an act
	 *  for the arms) or not; once there they stand, holding it still. Returns whether they have arrived */
	function walkOn(p, pts, s, hold) {
		let left = s * WALK;
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i - 1], b = pts[i], d = a.distanceTo(b);
			if (left <= d) {
				p.position.lerpVectors(a, b, d ? left / d : 1);
				if (d > 0.05) p.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
				act(p, hold ? `${hold}+walk` : 'walk');
				return false;
			}
			left -= d;
		}
		p.position.copy(pts[pts.length - 1]);
		act(p, hold ?? 'idle');
		return true;
	}
	const walkTime = (pts) => pts.slice(1).reduce((a, b, i) => a + pts[i].distanceTo(b), 0) / WALK;
	// on the pickup (its own frame, +z ahead, the driver's door on its left, +x): the doors, the tailgate, beside it
	const atTruck = (x, z) => (truck.updateMatrixWorld(true), truck.localToWorld(V(x, 0, z)).setY(0));
	const DRIVER = [1.25, 0.55], PASSENGER = [-1.25, 0.55], TAIL = [0.5, -3.3], BESIDE = [2.6, 1], BESIDE_2 = [2.6, -1.6];
	/** a shot of a moment: at least min seconds, and as long as the line of the voice-over it carries; its run gets the
	 *  seconds since it began (s), so a walk keeps its pace however long the line holds the shot */
	function beat(min, run, start) {
		const st = { dur: min, shot: true, start, run: (k) => run(k * st.dur, k, st.dur) };
		return st;
	}
	/** the voice-over: one line a shot, in order (more lines than shots: the last carries them all); each shot holds
	 *  as long as its line takes to tell */
	function told(steps, lines = []) {
		const shots = steps.filter((x) => x.shot);
		lines.forEach((line, i) => {
			const st = shots[Math.min(i, shots.length - 1)];
			if (st) st.caption = st.caption ? { title: `${st.caption.title} ${line}` } : { title: line };
		});
		for (const st of shots) if (st.caption) (st.dur = Math.max(st.dur, lineDur(st.caption.title))), (st.caption.dur = st.dur);
		return steps;
	}
	/** a camera standing still, turning to follow what it looks at (a player's head) */
	const still = (eye, at) => camLerp(eye, at, 0.12);
	const head = (p, y = 1.35) => p.position.clone().setY(y);

	/** the arrival, cut like a trailer on the film camera's moves: dawn over the endless steppe and a van's dust far
	 *  below; inside the packed van; alongside it past the telegraph poles; the road ending at the abandoned gas station;
	 *  the van pulling up and the newcomer stepping out; looking east, over their shoulder, to the green land; and up,
	 *  over the whole city plot. Each shot carries its line of the story (onCaption). */
	function intro(part = 'road', { lines } = {}) {
		placed = true;
		holdRide();
		phoneShow(null);
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
						van.userData.nod(T);
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
						walkOn(me, [door, STOP], Math.max(0, k - 0.15) * 5);
						if (k > 0.85) act(me, 'look up');
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
		const cut = part === 'road' ? shots.slice(0, 3) : shots.slice(3);
		// the story's own lines, one a shot, in place of the trailer's titles; the last of the arrival stays big, the city's name
		if (lines?.length) {
			cut.forEach((st) => ((st.shot = true), (st.caption = undefined)));
			told(cut, lines);
			if (part !== 'road' && cut[cut.length - 1].caption) cut[cut.length - 1].caption.big = true;
		}
		return play(cut, { hour: 8.6 });
	}

	/** a drive in the pickup along the track, cut in three shots: from the roadside as it sets off, from the air
	 *  as it crosses the land, and close behind it as it arrives. To the village's shed, or on home to our tribe; when the
	 *  other player comes to fetch me (fetch), the pickup first drives out from the tribe to the bus stop. */
	function drive(leg, { fetch = false, lines } = {}) {
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
		const drivesMe = stage.me === 'A'; // the first player drives; the fetched one sits beside them
		const myDoor = () => atTruck(...(drivesMe ? DRIVER : PASSENGER));
		const shotOf = (st) => ((st.shot = true), st);
		// getting in: from where each stands, round to their door, then the door shuts behind them
		const getIn = () => {
			let mine = null, theirs = null;
			return beat(2.5, (s) => {
				const k = mine ? walkOn(me, mine, s) : true;
				const j = theirs ? walkOn(other, theirs, s) : true;
				if (k) me.visible = false;
				if (j && other) other.visible = false;
				still(camEye, head(me));
			}, () => {
				placeFuel(stage.cube === 'home' ? 'home' : 'bed');
				const side = drivesMe ? 1 : -1;
				const door = myDoor();
				// the passenger goes round the front of the pickup
				mine = [me.position.clone(), ...(side < 0 ? [atTruck(1.6, 3.4), atTruck(-1.6, 3.4)] : []), door];
				theirs = other && stage.rides && other.visible ? [other.position.clone(), atTruck(...DRIVER)] : null;
				camEye = atTruck(9 * side, 7).setY(3.4);
				camera.position.copy(camEye);
				controls.target.copy(head(me));
			});
		};
		// getting out where the drive ends: out of the doors to where the story has them stand
		const getOut = (where) => {
			let mine = null, theirs = null;
			return beat(2.5, (s) => {
				walkOn(me, mine, s);
				if (theirs) walkOn(other, theirs, s);
				still(camEye, head(me));
			}, () => {
				const rides = other && (stage.rides || fetch);
				const myEnd = where === 'home' ? HOME[stage.me] : atTruck(...BESIDE);
				const door = myDoor();
				me.visible = true;
				me.position.copy(door);
				mine = [door, ...(drivesMe ? [] : [atTruck(-1.6, 3.4), atTruck(1.6, 3.4)]), myEnd];
				if (rides) {
					other.visible = true;
					other.position.copy(atTruck(...DRIVER));
					theirs = [other.position.clone(), where === 'home' ? HOME[stage.other] : atTruck(...BESIDE_2)];
				}
				camEye = atTruck(drivesMe ? 6 : 5, 5.5).setY(2);
				camera.position.copy(camEye);
				controls.target.copy(head(me));
			});
		};
		let camEye = V(0, 0, 0);
		const steps = [];
		if (fetch) {
			// the other player comes for me: the pickup out of the tribe's hex to the bus stop, me waving as it nears
			const come = shotOf(go(1, U_START, 12));
			const run = come.run;
			come.start = () => {
				putTruck(1, true);
				if (other) other.visible = false;
				me.visible = true;
				me.position.copy(STOP);
			};
			come.run = (k) => (run(k), face(me, truck.position), act(me, k > 0.55 ? 'wave' : 'idle'));
			steps.push(come);
		} else if (leg === 'village') {
			// the first player: the two jerrycans off the forecourt into the back, then round to the driver's door
			let cans = [], toCans = [], toTail = [];
			const fill = beat(4.5, (s) => {
				walkOn(me, toCans, s);
				still(camEye, head(me));
			}, () => {
				placeFuel('station');
				me.visible = true;
				me.position.copy(STOP);
				cans = fuel.map((c) => c.position.clone());
				toCans = [STOP.clone(), atTruck(2.2, -1.8)];
				camEye = atTruck(10, 7).setY(3.2);
				camera.position.copy(camEye);
				controls.target.copy(head(me));
			});
			const carry = beat(4, (s) => {
				const t0 = 0.6; // kneeling to take hold of them
				if (s < t0) act(me, 'kneel');
				const there = s >= t0 && walkOn(me, toTail, s - t0, 'cans');
				const lift = there ? Math.min(1, (s - t0 - walkTime(toTail)) / 0.8) : 0;
				fuel.forEach((c, i) => {
					if (s < t0) return;
					const hand = me.localToWorld(V(i ? -0.32 : 0.32, 0.3, 0.05));
					if (!there) (c.position.copy(hand), (c.rotation.y = me.rotation.y));
					else {
						const to = truck.localToWorld(FUEL_ON_BED[i].clone());
						c.position.lerpVectors(hand, to, ease(lift)).setY(hand.y + (to.y - hand.y) * ease(lift) + Math.sin(Math.PI * lift) * 0.5);
					}
				});
				if (there && lift < 1) act(me, 'carry');
				still(camEye, head(me, 1));
			}, () => {
				toTail = [me.position.clone(), atTruck(...TAIL)];
				camEye = atTruck(4.5, -7).setY(1.8);
			});
			const done = { dur: 0.1, start: () => placeFuel('bed') };
			steps.push(fill, carry, done);
		}
		steps.push(getIn());
		steps.push(shotOf(leg === 'village' ? go(U_START, U_STORE, 13) : go(U_STORE, 1, 9)));
		steps.push(getOut(leg === 'village' ? 'village' : 'home'));
		const first = steps[0].start;
		steps[0].start = () => {
			first?.();
			lensOut();
		};
		return play(told(steps, lines));
	}

	/** loading at the village's shed: out of the pickup, the Power Cube pushed out of the shed and up onto the bed, the
	 *  packed tent carried over and swung in, and back beside the pickup */
	function load({ lines, what } = {}) {
		const me = people[stage.me];
		truck.updateMatrixWorld(true);
		// the first player loads the ElectroCube and the packed tent; the second the BatteryCube and the solar panel
		const P = what === 'power'
			? { push: battery, from: BATT_AT.clone().setY(0.02), yaw0: 0.2, carry: solar, carryAt: PANEL_AT, carryTo: PANEL_ON_BED, lift: 0.3, ahead: 0.95, setup: () => placeBattery('store'), mid: () => {}, end: () => ((stage.battery = 'bed'), placeBattery('bed')) }
			: { push: cube, from: CUBE_IN_SHED.clone(), yaw0: Math.PI / 2, carry: bundle, carryAt: TENT_IN_SHED, carryTo: TENT_ON_BED, lift: 1.05, ahead: 0.42, setup: () => (placeCube('shed'), placeTent('shed')), mid: () => ((stage.cube = 'bed'), placeCube('bed')), end: () => ((stage.tent = 'bed'), placeTent('bed')) };
		const look = V(STORE.x + 2, 1.2, (STORE.z + VZ) / 2);
		const eye = V(STORE.x + 11, 4.5, VZ + 12).sub(look).multiplyScalar(0.6).add(look);
		const pushTo = truck.localToWorld(CUBE_ON_BED.clone());
		const yawTo = truck.rotation.y + Math.PI / 2;
		const tail = atTruck(0, -3.9);
		const front = (o, d) => o.clone().add(V(Math.sin(me.rotation.y), 0, Math.cos(me.rotation.y)).multiplyScalar(d));
		let toShed = [], toCarry = [], back = [];
		return play(told([
			beat(3.5, (s) => (walkOn(me, toShed, s), still(eye, head(me))), () => {
				P.setup();
				me.visible = true;
				me.position.copy(atTruck(...BESIDE));
				const behind = P.from.clone().setY(0).add(P.from.clone().setY(0).sub(tail).setLength(1.2));
				toShed = [me.position.clone(), behind];
				camera.position.copy(eye);
				controls.target.copy(head(me));
			}),
			// pushing it along the ground to the tailgate (1 m/s), then up the ramp into the bed
			beat(7, (s) => {
				const from = P.from, d = from.distanceTo(tail), push = d / 1;
				const u = Math.min(1, s / push), r = Math.min(1, Math.max(0, (s - push) / 2));
				const at = from.clone().lerp(tail.clone().setY(0.1), u);
				if (r > 0) at.lerpVectors(tail.clone().setY(0.1), pushTo, ease(r));
				P.push.position.copy(at);
				P.push.rotation.y = P.yaw0 + (yawTo - P.yaw0) * ease(Math.min(1, u * 1.4));
				const dir = tail.clone().sub(from).setY(0).normalize();
				me.position.copy(r > 0 ? tail.clone().sub(dir.clone().multiplyScalar(0.9)).setY(0) : at.clone().setY(0).sub(dir.clone().multiplyScalar(0.95)));
				me.rotation.y = Math.atan2(dir.x, dir.z);
				act(me, u < 1 ? 'push+walk' : r < 1 ? 'push' : 'idle');
				still(eye.clone().add(V(-3, -1, 2)), at.clone().setY(1));
			}),
			{ dur: 0.1, start: () => P.mid() },
			beat(5, (s) => {
				const t1 = walkTime(toCarry), t2 = t1 + 0.5;
				walkOn(me, toCarry, s);
				if (s >= t1 && s < t2) act(me, 'kneel');
				const going = s >= t2 && !walkOn(me, back, s - t2, 'carry');
				const lift = s >= t2 + walkTime(back) ? Math.min(1, (s - t2 - walkTime(back)) / 0.8) : 0;
				if (s >= t2) {
					const arms = front(me.position, P.ahead).setY(P.lift);
					const to = truck.localToWorld(P.carryTo.clone());
					if (going || !lift) P.carry.position.copy(arms), (P.carry.rotation.y = me.rotation.y + Math.PI / 2);
					else (P.carry.position.lerpVectors(arms, to, ease(lift)).setY(arms.y + (to.y - arms.y) * ease(lift) + Math.sin(Math.PI * lift) * 0.6), (P.carry.rotation.y = me.rotation.y + Math.PI / 2 + (yawTo - me.rotation.y - Math.PI / 2) * ease(lift)));
				}
				still(eye.clone().add(V(-5, -1.5, 3)), head(me, 1));
			}, () => {
				toCarry = [me.position.clone(), P.carryAt.clone().setY(0).add(V(1.1, 0, 0.2))];
				back = [toCarry[1], atTruck(0.6, -3.3)];
			}),
			{ dur: 0.1, start: () => P.end() },
			beat(2.5, (s) => (walkOn(me, [atTruck(0.6, -3.3), atTruck(2.4, -2), atTruck(...BESIDE)], s), still(eye, head(me))))
		], lines));
	}


	/** pitching the tent at the middle of our hex: the packed canvas carried off the pickup and unrolled, the little dome
	 *  raised strut by strut while the camera circles it, then the Power Cube pushed down off the bed to its yard */
	function pitch({ lines, what } = {}) {
		if (what === 'power') return setUp({ lines });
		const me = people[stage.me];
		truck.updateMatrixWorld(true);
		const orbit = shot({ kind: 'orbit', centre: [0, 0], a0: 0.4, a1: 1.9, r0: 16, r1: 10, y0: 8, y1: 3.5, aim: [0, 1, 0], curve: 'ease' });
		const LAY = V(0, 0, 2.2), KNEEL = V(0, 0, 3.3);
		let toTail = [], toLay = [], toTail2 = [];
		const eye = V(-4, 3.2, 12);
		const cubeFrom = () => truck.localToWorld(CUBE_ON_BED.clone());
		const tail = atTruck(0, -3.9);
		const yard = V(YARD.x, 0, YARD.z);
		return play(told([
			beat(6, (s) => {
				const t1 = walkTime(toTail);
				walkOn(me, toTail, s);
				if (s >= t1 && s < t1 + 0.7) {
					act(me, 'carry');
					bundle.position.lerpVectors(truck.localToWorld(TENT_ON_BED.clone()), me.localToWorld(V(0, 1.05, 0.42)), ease((s - t1) / 0.7));
				} else if (s >= t1 + 0.7) {
					const there = walkOn(me, toLay, s - t1 - 0.7, 'carry');
					bundle.position.copy(me.localToWorld(V(0, 1.05, 0.42)));
					bundle.rotation.y = me.rotation.y + Math.PI / 2;
					if (there) (act(me, 'kneel'), bundle.position.copy(LAY).setY(0.2));
				}
				still(eye, head(me, 1.1));
			}, () => {
				world.attach(bundle);
				me.visible = true;
				toTail = [me.position.clone(), atTruck(...TAIL)];
				toLay = [toTail[1], KNEEL];
				camera.position.copy(eye);
				controls.target.copy(head(me));
			}),
			beat(5.5, (s, k) => {
				const e = ease(Math.min(1, s / 4.5));
				home.scale.set(0.3 + 0.7 * e, Math.max(0.02, e), 0.3 + 0.7 * e);
				home.rotation.y = (1 - e) * 0.6;
				me.position.copy(KNEEL);
				face(me, V(0, 0, 0));
				act(me, e < 0.35 ? 'kneel' : e < 1 ? 'push' : 'look up');
				pose(orbit(k));
			}, () => {
				bundle.visible = false;
				home.visible = true;
			}),
			{ dur: 0.1, start: () => ((stage.tent = 'up'), placeTent('up')) },
			beat(7, (s) => {
				const t1 = walkTime(toTail2);
				const down = Math.min(1, Math.max(0, (s - t1) / 1.5));
				const along = Math.max(0, s - t1 - 1.5);
				const d = tail.distanceTo(yard), u = Math.min(1, along / d);
				const from = cubeFrom();
				const at = down < 1 ? from.clone().lerp(tail.clone().setY(0), ease(down)) : tail.clone().lerp(yard, u);
				if (s >= t1) cube.position.copy(at);
				if (s < t1) walkOn(me, toTail2, s);
				else {
					const dir = (down < 1 ? tail.clone().sub(from) : yard.clone().sub(tail)).setY(0).normalize();
					me.position.copy(down < 1 ? atTruck(0, -2.9) : at.clone().setY(0).sub(dir.clone().multiplyScalar(0.95)));
					me.rotation.y = down < 1 ? truck.rotation.y + Math.PI : Math.atan2(dir.x, dir.z);
					act(me, down < 1 ? 'carry' : u < 1 ? 'push+walk' : 'idle');
				}
				still(V(YARD.x - 9, 4, YARD.z + 11), (s < t1 ? me.position : cube.position).clone().setY(1));
			}, () => {
				world.attach(cube);
				toTail2 = [me.position.clone(), V(KNEEL.x + 3, 0, KNEEL.z + 1), atTruck(0, -2.9)];
			}),
			{ dur: 0.4, start: () => ((stage.cube = 'home'), placeCube('home'), act(me, 'idle')), run: () => still(V(YARD.x - 9, 4, YARD.z + 11), V(4, 1, -1)) }
		], lines));
	}
	/** the second player's setting up at home: the BatteryCube down the ramp and pushed beside the ElectroCube, the solar
	 *  panel carried to face the sun, then one cable from the panel to the BatteryCube and on to the tent */
	function setUp({ lines } = {}) {
		const me = people[stage.me];
		truck.updateMatrixWorld(true);
		const tail = atTruck(0, -3.9);
		const eye = V(YARD.x - 13, 5.5, YARD.z + 15);
		const front = (d) => me.position.clone().add(V(Math.sin(me.rotation.y), 0, Math.cos(me.rotation.y)).multiplyScalar(d));
		let toTail = [], toPanel = [];
		return play(told([
			beat(7, (s) => {
				const t1 = walkTime(toTail);
				const down = Math.min(1, Math.max(0, (s - t1) / 1.5));
				const d = tail.distanceTo(BATT_HOME), u = Math.min(1, Math.max(0, s - t1 - 1.5) / d);
				const from = truck.localToWorld(CUBE_ON_BED.clone());
				if (s < t1) return void (walkOn(me, toTail, s), still(eye, head(me, 1)));
				const at = down < 1 ? from.clone().lerp(tail.clone().setY(0), ease(down)) : tail.clone().lerp(BATT_HOME, u);
				battery.position.copy(at);
				const dir = (down < 1 ? tail.clone().sub(from) : BATT_HOME.clone().sub(tail)).setY(0).normalize();
				me.position.copy(down < 1 ? atTruck(0, -2.9) : at.clone().setY(0).sub(dir.clone().multiplyScalar(0.95)));
				me.rotation.y = down < 1 ? truck.rotation.y + Math.PI : Math.atan2(dir.x, dir.z);
				act(me, down < 1 ? 'carry' : u < 1 ? 'push+walk' : 'idle');
				still(eye, at.clone().setY(1));
			}, () => {
				world.attach(battery);
				me.visible = true;
				toTail = [me.position.clone(), atTruck(...TAIL)];
				camera.position.copy(eye);
				controls.target.copy(head(me));
			}),
			beat(7, (s) => {
				const t1 = walkTime(toTail), t2 = t1 + 0.6;
				if (s < t1) return void (walkOn(me, toTail, s), still(eye, head(me, 1)));
				const there = s >= t2 && walkOn(me, toPanel, s - t2, 'carry');
				if (s < t2) act(me, 'carry');
				else if (!there) (solar.position.copy(front(0.95).setY(0.3)), (solar.rotation.y = me.rotation.y + Math.PI / 2));
				else {
					const k = Math.min(1, (s - t2 - walkTime(toPanel)) / 1);
					solar.position.lerpVectors(front(0.95).setY(0.3), PANEL_HOME, ease(k));
					solar.rotation.y = me.rotation.y + Math.PI / 2 + (Math.PI - 0.4 - me.rotation.y - Math.PI / 2) * ease(k);
					act(me, k < 1 ? 'carry' : 'look up');
				}
				still(eye.clone().add(V(2, 0, -2)), (s < t2 ? me.position : solar.position).clone().setY(1));
			}, () => {
				world.attach(solar);
				toTail = [me.position.clone(), atTruck(0.6, -3.3)];
				toPanel = [atTruck(0.6, -3.3), PANEL_HOME.clone().add(V(0, 0, 1.6))];
			}),
			beat(4.5, (s, k) => {
				cables.visible = k > 0.35;
				if (s < 1.6) walkOn(me, [me.position.clone(), BATT_HOME.clone().add(V(-0.9, 0, 0.6))], s);
				else (face(me, BATT_HOME), act(me, k < 0.75 ? 'kneel' : 'idle'));
				still(V(YARD.x - 5, 2.4, YARD.z + 6), BATT_HOME.clone().setY(0.6));
			}),
			{ dur: 0.3, start: () => ((stage.battery = 'home'), placeBattery('home'), act(me, 'idle')) }
		], lines));
	}
	/** planting the first tree (Samuel 2026-10-13): the player kneels at its place beside the tent with the seedling's
	 *  pot, takes it out and sets it in the ground, firms the soil, and stands up to look at it */
	function plant() {
		const me = people[stage.me];
		const pot = pots[stage.pick];
		const spot = TREE_AT[stage.me];
		if (!pot || !me) return Promise.resolve();
		// low and close from the side, the tent beyond: the player kneels beside the spot, the pot set down by the knee,
		// the seedling out of it and into the ground; then the camera draws back as they stand up beside it
		const L = spotAt(spot);
		const kneel = L(-0.42, 0, 0.12), stand = L(-0.95, 0, 0.55);
		const face = Math.atan2(spot.x - kneel.x, spot.z - kneel.z);
		const lens = () => {
			camera.near = 0.1;
			camera.fov = camera.aspect < 0.8 ? 64 : 46;
			camera.updateProjectionMatrix();
		};
		return play([
			beat(2.6, (sec, k) => {
				camera.position.copy(L(0.95 - 0.08 * k, 0.85 - 0.06 * k, -1.6 + 0.12 * k));
				camera.lookAt(L(-0.2, 0.6 - 0.08 * k, 0.08));
				if (k > 0.55 && pot.userData.pot.visible) {
					pot.userData.pot.visible = pot.userData.dirt.visible = false;
					pot.position.copy(spot);
					if (pot.userData.plant) pot.userData.plant.position.y = 0;
				}
			}, () => {
				lensOut();
				lens();
				placePots('home', stage.pick);
				pot.position.copy(L(0.1, 0, -0.2));
				me.visible = true;
				me.position.copy(kneel);
				me.rotation.y = face;
				act(me, 'kneel');
			}),
			beat(2.8, (sec, k) => {
				const e = ease(k);
				camera.position.copy(L(0.87 + 0.28 * e, 0.79 + 0.81 * e, -1.48 - 1.12 * e));
				camera.lookAt(L(-0.2 - 0.18 * e, 0.52 + 0.25 * e, 0.08 + 0.27 * e));
			}, () => ((stage.pot = 'planted'), act(me, 'idle'), me.position.copy(stand), (me.rotation.y = face))),
			{ dur: 0.05, start: () => placePots('planted', stage.pick) }
		]);
	}
	/** the player's joy (Samuel 2026-10-13: after the first mint): close on their face in the van, a big smile and
	 *  sparkling eyes, a few seconds */
	function joy() {
		const me = people[stage.me];
		const close = RIDE_SHOTS.close;
		if (!riding) return Promise.resolve();
		return play([
			beat(4, (sec, k) => {
				rollVan(dt);
				const t = performance.now() / 1000;
				const at = close.at(t, 1);
				camera.position.copy(close.cam(t, 1)).lerp(at, 0.3 * ease(Math.min(1, k * 2))).add(V(0, Math.sin(t * 23) * 0.012 + Math.sin(t * 7.3) * 0.02, 0));
				camera.lookAt(at);
			}, () => {
				rollVan(0);
				lensIn();
				if (riding) holdRide('close');
				me.userData.joy = true;
			}),
			{ dur: 0.1, start: () => (me.userData.joy = false) }
		]);
	}
	/** jump to the end of what is playing */
	/** a shot of the story told over the world (a voice-over's length, dur s): still riding in the van, the ride rolls
	 *  on; anywhere else the camera glides slowly round the place the story is at, closing in a little, like a crane */
	function shotAt(name, { lines = [], act: doing, close = false, shots, phone, hold } = {}) {
		const p = PLACES[name];
		const me = people[stage.me];
		const n = Math.max(1, lines.length);
		const steps = [];
		if (riding) {
			// on the road: each line cuts to the view that shows what it says (shots), or else to the next view of the ride;
			// the woman beside the player has her phone out while she tells of the HEARTS
			holdRide();
			phoneShow(phone);
			for (let i = 0; i < n; i++) {
				const kind = RIDE_SHOTS[shots?.[i]] ?? RIDE_SHOTS[RIDE_ORDER[rideCut++ % RIDE_ORDER.length]];
				let fixed = null;
				steps.push(beat(3, (sec, k) => {
					rollVan(dt);
					const t = performance.now() / 1000;
					const bump = kind.inside ? V(0, Math.sin(t * 23) * 0.012 + Math.sin(t * 7.3) * 0.02, 0) : V(0, 0, 0);
					camera.position.copy(fixed ?? kind.cam(t, k)).add(bump);
					camera.lookAt(kind.at(t, k));
				}, () => {
					rollVan(0);
					seatMe(!!kind.me);
					kind.inside ? lensIn() : ((camera.near = 0.5), (camera.fov = camera.aspect < 0.8 ? 60 : 38), camera.updateProjectionMatrix());
					fixed = kind.fixed ? kind.cam(0, 0) : null;
				}));
			}
			// a move to make (the mint): the shot it is made in holds while the story waits on it
			if (hold) steps.push({ dur: 0.05, start: () => holdRide(hold) });
			return play(told(steps, lines));
		}
		if (!p) return play(told([beat(3, () => {})], lines));
		const offset = p.offset.clone().multiplyScalar(camera.aspect < 0.8 ? 1.65 : 1);
		const r0 = Math.hypot(offset.x, offset.z), a0 = Math.atan2(offset.z, offset.x);
		const near = name !== 'city' && me.visible; // the player is in the picture
		// anywhere else: each line a new shot of the place: a crane drifting round it, low on the ground looking up at it,
		// high over it, and close on the player as they act the line
		const kinds = name === 'city' ? ['crane', 'high'] : near ? ['crane', 'close', 'low', 'high'] : ['crane', 'low', 'high'];
		// a place with its own shots (the bench, the tree): each line the next of them, the player where it puts them
		if (p.shots) {
			for (let i = 0; i < n; i++) {
				const at = p.shots[i % p.shots.length];
				steps.push(beat(3, (sec, k) => {
					const [eye, look] = at(ease(k));
					camera.position.copy(eye);
					camera.lookAt(look);
				}, () => {
					camera.near = 0.1; // close, yet deep enough that the grass far off doesn't flicker through
					camera.fov = camera.aspect < 0.8 ? 60 : 40;
					camera.updateProjectionMatrix();
					if (i === 0 && p.stand && me.visible) (me.position.copy(p.stand), (me.rotation.y = p.face ?? 0), act(me, doing ?? 'idle'));
				}));
			}
			return play(told(steps, lines));
		}
		for (let i = 0; i < n; i++) {
			const kind = close && i === 0 ? 'close' : kinds[(i + (close ? 1 : 0)) % kinds.length];
			const turn = a0 + i * 0.85;
			steps.push(beat(3, (sec, k) => {
				const e = ease(k);
				if (kind === 'close') {
					const from = me.localToWorld(V(1.5, 1.8, 3.6)), to = me.localToWorld(V(0.75, 1.62, 2.2));
					camera.position.lerpVectors(from, to, e);
					return camera.lookAt(head(me, 1.45));
				}
				const a = turn + (0.1 + sec * 0.012) * e;
				const [r, y] = kind === 'low' ? [r0 * (0.42 - 0.06 * e), 1.3 + e * 0.6] : kind === 'high' ? [r0 * (0.35 + 0.1 * e), offset.y * (1.9 - 0.2 * e)] : [r0 * (1.08 - 0.16 * e), offset.y * (1.06 - 0.12 * e)];
				camera.position.set(p.target.x + Math.cos(a) * r, p.target.y + y, p.target.z + Math.sin(a) * r);
				camera.lookAt(kind === 'low' ? p.target.clone().add(V(0, 2.5, 0)) : p.target);
			}, () => (lensOut(), i === 0 && doing && me.visible && act(me, doing))));
		}
		return play(told(steps, lines));
	}
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
		for (const p of Object.values(people)) if (p.visible) (acting(p, (p.userData.t += step)), busy && (p.userData.glow.visible = false));
		if (stage.cube === 'home' && cube.parent === world && !busy) cubeCast.rig.pose(cubeCast.clips.run(t));
		if (moment) runMoment(performance.now() / 1000);
		else if (riding) ride(step);
		else {
			if (goal) {
				const at = goal.target.clone().add(goal.offset);
				const ease = 1 - Math.exp(-3.7 * step); // the same glide at any frame rate
				controls.target.lerp(goal.target, ease);
				camera.position.lerp(at, ease);
				if (camera.position.distanceTo(at) < 0.5) (controls.minDistance = nearest(goal.offset)), (goal = null);
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
				const tree = trees[k];
				if (tree) {
					const q = tree.position.clone().setY(tree.userData.top).project(camera);
					out[`tree:${k}`] = { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h, on: !busy && !riding && q.z < 1 && camera.position.distanceTo(tree.position) < 60 };
				}
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
		scene: shotAt,
		joy,
		plant,
		trees: setTrees,
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
