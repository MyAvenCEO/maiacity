// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V2's world, in three.js, and nothing but it: the city plot of 49 hexes on a wide sandy steppe, a dusty
 * highway through its centre hex, and the journey of a newcomer across it. At the city's centre the bus stop and the
 * abandoned gas station (the MaiaCity centre, $lib/models/wayside.js); a meandering gravel track leaves the highway
 * there and runs through the village's centre hex, where the Village COOP's old shed keeps the powercube beside the
 * solar row and the battery (the village store), on to our tribe's hex: grass, a few bushes, the 2-person bell tent
 * and the pickup's round lot. The city's own hexes are steppe and prairie, the villages' hexes grass.
 *
 * The page tells the world where the story is (set: where the pickup, the powercube and the players are, the story's
 * hour, where the first tree grows; focus: what the camera looks at; reveal: how much of the locked land shows its
 * dotted rims) and plays its moments: the arrival (intro: the packed travel van down the highway, then the van
 * braking at the bus stop, the player stepping out), the walk to the pickup at the station (station), the drives in
 * the pickup (drive; while an invest waits it rolls slowly on, the camera held in it), loading at the shed (load),
 * pitching the tent (pitch), and the first tree: the spot chosen on the ground (choose, walkTo), the earth dug and a
 * plant stake pressed in beside it (sticks), the seed sown and watered (sow), and watered each game month after
 * (water). The sun follows the story's hour, or else the virtual day. Tapping a player names them (onPick), a tap on
 * the ground while a spot is chosen goes to onGround, and every frame the players' labels' places go to onLabels.
 *
 * Its moments are filmed by world shots (game/film/shot.js), the one shot player of the game, the studio and the
 * plates: a moment given a reel (`reel`, game/film/reel.js) is filmed by the reel's shots, its camera, its lens and the
 * frames it rides in (the van, the pickup) as the shots say, while the moment moves the world as it always did; given
 * none, by the moves coded here, which the intro's shots are made from (./intro.js, ./film.js). The same world, on the
 * film's clock, is the film world of /games/maiacity-v2/?film (`clock`, `own: false`, `tick`, `film`).
 */
import * as THREE from 'three';
import { CAST, SECOND_HOME } from './cast.js';
import { createControls } from '$lib/render/core.js';
import { worldRenderer } from '$lib/render/world.js';
import { blend } from '$lib/assets/clips.js';
import { SPEED } from '$lib/models/units.js';
import { lineDur } from './tour.js';
import { ME_SEAT, packedVan, seeThrough, wearFace } from './van.js';
import { PLOT, SEATS, WATER_REACH } from '../../../game/maiacity-v2/engine.js';
import { look, pathOf } from '../../../game/film/camera.js';
import { BAG_PARTS, BELL_TENT, BOTTLE_MOUTH, CENTRE_AT, FIRE_CATCHES, FIRE_WALK, PACK_PACKETS, PICKUP, RAMP, STAKE_FLAG, TENT_CLOTH, TENT_LAMP, TENT_WALK, THINGS, WALK_CYCLE, stakeRef, standInRef, tentWork } from './things.js';
import { createDrawn } from './drawn.js';
import { growthFrame } from './tree-camera.js';
import { aim, filmHoldsSize, poseIn } from '$lib/sandbox-kit/film.js';
import { frameAt as reelFrame } from '../../../game/film/reel.js';
import { plantRef } from './plants.js';

/** the hex's radius in metres: 114.75, one and a half times 76.5 again (Samuel 2026-10-13, 17:49) */
const HEX_R = 114.75;
/** how much larger than the 76.5 m hexes the hand-drawn track and the far views were laid out for */
const K = HEX_R / 76.5;
const SEAT_COLOUR = { A: 0x3f6f9a, B: 0xd7a53a, C: 0x71965b };
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
/** a tree spot's own frame (x across, y up, z on toward the tent at the hex's middle): a shot from behind it (-z) has
 *  the tent beyond the tree */
const spotAt = (S) => {
	const f = V(-S.x, 0, -S.z).normalize(), r = V(f.z, 0, -f.x);
	return (x, y, z) => V(S.x, 0, S.z).addScaledVector(r, x).add(V(0, y, 0)).addScaledVector(f, z);
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
const TRACK_L = TRACK.getLength();
/** the place on the track (0 … 1) nearest a point */
const uNear = (x, z) => {
	let best = 0;
	PATH.forEach((p, i) => { if (Math.hypot(p.x - x, p.z - z) < Math.hypot(PATH[best].x - x, PATH[best].z - z)) best = i; });
	return best / (PATH.length - 1);
};
/** where the pickup is while an invest waits, shortly before arriving (Samuel 2026-10-14): 70 m short of the shed,
 *  and out on the village's grass short of our hex; from there it rolls slowly on (CREEP metres, slowing) */
const U_NEAR = { shed: U_STORE - 70 / TRACK_L, home: uNear(-142, -2) };
const CREEP = 24;
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

/** what of a model lies flat on the ground (a groundsheet, a rug, a bed of ash; with all, every piece) drawn over the
 *  land's tiles, which sit a depth offset above the ground (flat): a stronger one for these */
function overLand(o, all = false) {
	o.updateMatrixWorld(true);
	const box = new THREE.Box3();
	o.traverse((c) => {
		if (!c.isMesh) return;
		if (!all) {
			if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
			box.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld);
			if (box.max.y - o.position.y > 0.08) return;
		}
		for (const mm of [].concat(c.material)) Object.assign(mm, { polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
	});
}

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

/** our tribe's hex in knee-high grass (Samuel 2026-10-14: you step out into it, the wind the only sound): tufts of
 *  three blades, thicker round the lot, off the tent, the gravel and the paths */
function tallGrass() {
	const r = rng(77);
	const n = 2800;
	const m = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.62, 3).translate(0, 0.31, 0), mat(0x86a95a), n * 3);
	const o = new THREE.Object3D();
	let i = 0;
	for (let k = 0; i < n * 3 && k < n * 6; k++) {
		const near = r() < 0.3; // a third of them round the lot, where you step out
		const a = r() * Math.PI * 2, d = near ? 4 + Math.sqrt(r()) * 26 : 5 + Math.sqrt(r()) * (HEX_R - 8);
		const x = (near ? LOT.x - 8 : 0) + Math.cos(a) * d, z = (near ? LOT.z + 2 : 0) + Math.sin(a) * d;
		if (hexKey(x, z) !== '0,0' || onGravel(x, z, 0.8) || Math.hypot(x, z) < 4.5 || Math.hypot(x - BELL_TENT.fire.x, z - BELL_TENT.fire.z) < 2.4) continue;
		const s = 0.75 + r() * 0.6, yaw = r() * Math.PI * 2;
		for (let b = 0; b < 3; b++) {
			o.position.set(x + Math.cos(yaw + b * 2.1) * 0.06, 0, z + Math.sin(yaw + b * 2.1) * 0.06);
			o.rotation.set(Math.cos(yaw + b * 2.1) * 0.35, 0, Math.sin(yaw + b * 2.1) * 0.35);
			o.scale.set(s, s * (0.8 + r() * 0.5), s);
			o.updateMatrix();
			m.setMatrixAt(i++, o.matrix);
		}
	}
	m.count = i;
	m.receiveShadow = true;
	return m;
}

/** a clump of tall grass to stand close in front of a low camera (the grass in the foreground of a shot) */
function clump() {
	const g = new THREE.Group();
	const r = rng(91);
	const green = [mat(0x7f9f52), mat(0x93ad62), mat(0x6f8f47)];
	for (let i = 0; i < 26; i++) {
		const h = 0.5 + r() * 0.45;
		const b = new THREE.Mesh(new THREE.ConeGeometry(0.035, h, 3).translate(0, h / 2, 0), green[i % 3]);
		b.position.set((r() - 0.5) * 1.6, 0, (r() - 0.5) * 0.5);
		b.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
		g.add(b);
	}
	g.visible = false;
	return g;
}

/** where the ElectroCube (0.75 × 1 m) and the packed tent ride in the pickup's bed (1.55 m long, its floor 1.16 m up):
 *  side by side, the cube behind the tool box, the tent by the tailgate */
const CUBE_ON_BED = V(0, 1.16, -1.42);
const TENT_ON_BED = V(-0.15, 1.16, -2.2);
/** the second player's load: the BatteryCube where the ElectroCube rides, the solar panel on its rack behind it, over
 *  the open tailgate; at the village beside the shed, at home beside the tent and the ElectroCube */
const PANEL_ON_BED = V(0, 1.16, -2.55);

/** the ramp behind the pickup, its lip on the tailgate let down flat (RAMP, PICKUP): along the pickup (its own z), its
 *  lip and its foot, and the slope it tips a machine to */
const LIP_Z = PICKUP.tailgate - PICKUP.gate;
const FOOT_Z = LIP_Z - RAMP.run;
const SLOPE = Math.atan2(RAMP.rise, RAMP.run);
/** how high a machine stands at z along the pickup (on the bed, the ramp or the ground behind it), and how far it is
 *  tipped to the ramp's slope (0 … 1): half tipped where it sits over a knee of the ramp, its 70 cm half on, half off */
const rampY = (z) => RAMP.rise * Math.min(1, Math.max(0, (z - FOOT_Z) / RAMP.run));
const rampTip = (z) => Math.min(1, Math.max(0, (Math.min(z - FOOT_Z, LIP_Z - z) + 0.35) / 0.7));

/** the first tree's spot once it is marked (Samuel 2026-10-14): the earth dug, the seed's hollow in its middle, and
 *  the plant stake the tree will grow by pushed in beside it, 75 cm of it standing; its little flag printed with the
 *  tree's name and its plant, tied on once the seed is picked */
const STAKE_AT = V(0.13, -0.25, -0.12);
/**
 * The kit of a tree's spot: the dug earth (things/dug-earth@1, built in the box), wetted by its control `wet`, and the
 * tree's plant stake (labelKit), each put in as it comes. `pick`: what a tap on it finds (none: no name, its shadows
 * as built).
 * @param {ReturnType<typeof createDrawn>} drawn
 */
function spotKit(drawn, { name = '', seed = '', pick } = {}) {
	const g = new THREE.Group();
	const earth = new THREE.Group();
	g.add(earth);
	let wet = 0, poser = null;
	drawn.load(THINGS.earth, earth, { pick, cast: !!pick }).then(
		(got) => {
			poser = got.poser;
			if (wet) poser.set('wet', wet);
		},
		() => {}
	);
	/** the earth as wet as k (0 dry … 1 soaked) */
	const setWet = (k) => {
		if (k === wet) return;
		wet = k;
		poser?.set('wet', k);
	};
	g.userData = { earth, setWet, stake: null, drawn, pick };
	labelKit(g, name, seed);
	return g;
}
/** the stake of a kit for a tree of that name and seed (things/plant-stake@2, its print made with them): a new one
 *  when either changes, its flag shown once there is a seed */
function labelKit(kit, name, seed) {
	let stake = kit.userData.stake;
	if (!stake || stake.userData.seed !== (seed || 'apple') || stake.userData.name !== name) {
		if (stake) kit.remove(stake);
		stake = new THREE.Group();
		stake.userData = { seed: seed || 'apple', name, flag: null, flown: !!seed };
		const { drawn, pick } = kit.userData;
		drawn.load(stakeRef(name, seed || 'apple'), stake, { pick, cast: true }).then(
			(got) => {
				stake.userData.flag = STAKE_FLAG.path.reduce((x, i) => x?.children[i], got.obj) ?? null;
				if (stake.userData.flag) stake.userData.flag.visible = stake.userData.flown;
			},
			() => {}
		);
		stake.position.copy(STAKE_AT);
		stake.rotation.set(0.03, 0, -0.04);
		kit.add(stake);
		kit.userData.stake = stake;
	}
	stake.userData.flown = !!seed;
	if (stake.userData.flag) stake.userData.flag.visible = !!seed;
	return stake;
}
/**
 * A player's backpack off their back and open (Samuel 2026-10-14: the seeds and a 1 l bottle in it; things/backpack@2,
 * built in the box), opened and shut by its control `open`, with where the bottle and each seed's packet sit in it,
 * so they go back there. Until it is here the story moves stand-ins for its bottle, its packets and what is in it;
 * once it is, the build's own take over where those were put.
 * @param {ReturnType<typeof createDrawn>} drawn @param {string} pick
 */
function openPack(drawn, pick) {
	const g = new THREE.Group();
	const inside = new THREE.Group(), bottle = new THREE.Group(), cap = new THREE.Group();
	bottle.add(cap);
	bottle.userData = { cap, mouth: V(0, BOTTLE_MOUTH, 0) };
	inside.add(bottle);
	const packets = {};
	for (const id of PACK_PACKETS) {
		const p = (packets[id] = new THREE.Group());
		p.userData.y0 = 0;
		inside.add(p);
	}
	g.add(inside);
	let open = 1, poser = null;
	g.userData = {
		inside,
		bottle,
		packets,
		bottleAt: { p: bottle.position.clone(), r: bottle.rotation.clone() },
		setOpen(k) {
			if (k === open) return;
			open = k;
			poser?.set('open', k);
		}
	};
	drawn.load(THINGS.pack, g, { pick }).then(
		(got) => {
			const u = g.userData, at = (n) => got.named.get(n);
			const real = { inside: at('inside'), bottle: at('water-bottle'), cap: at('cap') };
			if (!real.inside || !real.bottle || !real.cap) return;
			real.bottle.userData = { cap: real.cap, mouth: V(0, BOTTLE_MOUTH, 0) };
			const bottleAt = { p: real.bottle.position.clone(), r: real.bottle.rotation.clone() };
			// the packets leaned back against the clothes, their fronts up to whoever looks in
			const mine = {};
			for (const id of PACK_PACKETS) {
				const p = at(`seed-packet:${id}`);
				if (!p) continue;
				p.rotation.x -= 0.6;
				p.userData.y0 = p.position.y;
				// raised as its stand-in was, shown as it was
				p.position.y += u.packets[id].position.y - u.packets[id].userData.y0;
				p.visible = u.packets[id].visible;
				mine[id] = p;
			}
			// the bottle where its stand-in was taken, if it was, its cap as it was
			if (u.bottle.parent && u.bottle.parent !== u.inside) {
				u.bottle.parent.add(real.bottle);
				real.bottle.position.copy(u.bottle.position);
				real.bottle.quaternion.copy(u.bottle.quaternion);
			}
			real.bottle.visible = u.bottle.visible;
			real.cap.visible = u.bottle.userData.cap.visible;
			u.bottle.removeFromParent();
			g.remove(u.inside);
			Object.assign(u, { inside: real.inside, bottle: real.bottle, packets: mine, bottleAt });
			poser = got.poser;
			if (open !== 1) poser.set('open', open);
		},
		() => {}
	);
	return g;
}
/** the bottle back in its pack, its cap on */
function stowBottle(pk) {
	const { bottle, inside, bottleAt } = pk.userData;
	inside.add(bottle);
	bottle.position.copy(bottleAt.p);
	bottle.rotation.copy(bottleAt.r);
	bottle.userData.cap.visible = true;
}

/** how tall a player is (m): the stand-in built at it */
export const PLAYER_HEIGHT = 1.8;
/** where a player's backpack sits on them, standing as built (their own frame) */
const PACK_ON = V(0, 0.88, -0.25);
/**
 * A player's one backpack (clothes and all they brought, Samuel 2026-10-13) on their chest bone, so it moves with the
 * back, its back panel and straps against theirs: placed as the stand-in stands as built, in its own frame (`root`).
 * @param {THREE.Bone} chest @param {THREE.Object3D} pack @param {THREE.Object3D} root
 */
export function wearPack(chest, pack, root) {
	root.updateWorldMatrix(true, true);
	const rel = root.matrixWorld.clone().invert().multiply(chest.matrixWorld);
	const q = new THREE.Quaternion();
	rel.decompose(V(0, 0, 0), q, V(1, 1, 1));
	chest.add(pack);
	pack.position.copy(PACK_ON).applyMatrix4(rel.invert());
	pack.quaternion.copy(q.invert().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI)));
}
/** a player: the rigged stand-in (actors/stand-in@11, built in the box at 1.8 m in their seat's colours, ./things.js
 *  standInRef), their one backpack on (things/backpack@2, shut by its control `open`). It plays what it does (act): a
 *  clip of the stand-in (idle, walk, wave), one of its poses (kneel, point, look up, think) or one of the player's own
 *  (carry, push), walking on as it moves; until it is here, nothing of them shows but the heart over them */
function person(seat, drawn) {
	const g = new THREE.Group();
	g.name = `player:${seat}`;
	const body = new THREE.Group();
	const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshStandardMaterial({ color: 0xe0435a, emissive: 0xe0435a, emissiveIntensity: 0.7 }));
	glow.position.y = 2.3;
	glow.name = g.name;
	const pack = new THREE.Group();
	drawn.load(THINGS.pack, pack, { pick: g.name, cast: false }).then((got) => got.poser.set('open', 0), () => {});
	const { height, look } = CAST[seat];
	// casting its shadow, none on it: the sun's shadow map is far too coarse for a face (it drew a dark band over the eyes)
	const cast = drawn.actor(seat === 'C' ? 'actors/elder-woman' : standInRef(height, look), body, { pick: g.name, shadow: true, receive: false, cycles: { walk: WALK_CYCLE } }, (c) => {
		const chest = c.rig.bones.chest ?? c.rig.bones.spine;
		if (chest) wearPack(chest, pack, c.mesh);
		else (pack.position.copy(PACK_ON), pack.rotation.set(0, Math.PI, 0), body.add(pack));
	});
	g.add(body, glow);
	g.userData = { playerSeat: seat, glow, cast, pack, act: 'idle', t: Math.random() * 9, walked: 0, last: null };
	return g;
}

/** the player's own poses, beyond the stand-in's: carrying something in both arms before them, pushing something along,
 *  at the wheel, holding the backpack on the knees, and pouring from the bottle while kneeling */
const CARRY = { upperArmL: [-0.75, 0, 0.18], upperArmR: [-0.75, 0, -0.18], forearmL: [-0.95, 0, 0], forearmR: [-0.95, 0, 0], handL: [0, 0, -0.3], handR: [0, 0, 0.3] };
/** reaching up to the tent's frame, both hands high before them */
const REACH = { spine: [-0.05, 0, 0], neck: [-0.15, 0, 0], head: [-0.25, 0, 0], upperArmL: [-2.5, 0, 0.18], upperArmR: [-2.5, 0, -0.18], forearmL: [-0.35, 0, 0], forearmR: [-0.35, 0, 0] };
const PUSH = { spine: [0.25, 0, 0], chest: [0.15, 0, 0], upperArmL: [-1.25, 0, 0.12], upperArmR: [-1.25, 0, -0.12], forearmL: [-0.25, 0, 0], forearmR: [-0.25, 0, 0] };
const WHEEL = { spine: [0.08, 0, 0], upperArmL: [-1.05, 0, -0.22], upperArmR: [-1.05, 0, 0.22], forearmL: [-0.55, 0, 0.1], forearmR: [-0.55, 0, -0.1], handL: [0, 0, 0], handR: [0, 0, 0] };
/** sitting in the pickup's cab, lower than the stand-in's 0.5 m edge: the thighs rising a little to the knees, the shins
 *  reaching forward and down to the floor and the pedals */
const CAR = { thighL: [-(Math.PI / 2 + 0.15), 0, 0.1], thighR: [-(Math.PI / 2 + 0.15), 0, -0.1], shinL: [0.87, 0, 0], shinR: [0.87, 0, 0], footL: [-0.3, 0, 0], footR: [-0.3, 0, 0] };
const LAP = { neck: [0.2, 0, 0], head: [0.3, 0, 0], upperArmL: [-0.55, 0, -0.18], upperArmR: [-0.55, 0, 0.18], forearmL: [-0.75, 0, 0.35], forearmR: [-0.75, 0, -0.35], handL: [0, 0, 0], handR: [0, 0, 0] };
const POUR = { spine: [0.3, 0, 0], chest: [0.2, 0, 0], neck: [0.2, 0, 0], head: [0.25, 0, 0], upperArmR: [-1.0, 0, -0.1], forearmR: [-0.6, 0, 0], handR: [0, 0, 0.9], upperArmL: [-0.5, 0, 0.1], forearmL: [-0.6, 0, 0] };
const PRESS = { spine: [0.45, 0, 0], chest: [0.3, 0, 0], neck: [0.15, 0, 0], head: [0.2, 0, 0], upperArmL: [-1.1, 0, 0.12], upperArmR: [-1.1, 0, -0.12], forearmL: [-0.35, 0, 0], forearmR: [-0.35, 0, 0] };
/** sitting on the ground by the tent, the knees up and the arms over them (the stand-in sits only on a 0.5 m edge):
 *  its own measure (s) read off its kneel's hips */
const ground = (cast) => {
	const s = cast.poses.kneel.root[1] / (0.535 - 0.98);
	const up = 0.75; // the thighs up from the hips to the knees
	return { root: [0, (0.17 - 0.98) * s, 0], thighL: [-(Math.PI / 2 + up), 0, 0.12], thighR: [-(Math.PI / 2 + up), 0, -0.12], shinL: [1.85, 0, 0], shinR: [1.85, 0, 0], footL: [-0.4, 0, 0], footR: [-0.4, 0, 0], spine: [0.22, 0, 0], chest: [0.12, 0, 0], head: [-0.05, 0, 0], upperArmL: [-0.95, 0, -0.12], upperArmR: [-0.95, 0, 0.12], forearmL: [-0.55, 0, 0.25], forearmR: [-0.55, 0, -0.25] };
};
/** how far the stand-in's walk carries it over one second of its clip (m): the pace its feet keep on the ground */
const CLIP_PACE = 1.27;
/** how far a player on the ground has walked, forward along where they face (back, it counts down): the walk is
 *  played by it, not by the clock, so the feet stay where they are set down, at any pace and walking backwards too */
function stride(p, onGround) {
	const u = p.userData;
	if (!onGround) return void (u.last = null);
	if (u.last) {
		const dx = p.position.x - u.last.x, dz = p.position.z - u.last.z;
		if (dx * dx + dz * dz < 1) u.walked += dx * Math.sin(p.rotation.y) + dz * Math.cos(p.rotation.y); // a cut is no step
	}
	u.last = (u.last ?? new THREE.Vector3()).copy(p.position);
}
/** play a player's act at time t: a clip, a pose, or walking carrying/pushing (the legs walk, the arms hold) */
function acting(p, t) {
	const { cast, act } = p.userData;
	if (!cast.ready) return; // (not here yet)
	const [what, legs] = act.split('+'); // 'carry+walk': the arms carry, the legs walk
	const walk = cast.clips.walk(p.userData.walked / CLIP_PACE);
	const base = legs === 'walk' ? walk : legs ? cast.clips[legs]?.(t) ?? {} : null;
	// joy: the stand-in's own smile (its blend shape: from v7 a warm closed smile, the corners up, the cheeks lifting
	// the eyes), shown when they beam (after the first mint), coming on and going off over a moment
	wearFace(cast.face, { joy: p.userData.joy ? 1 : 0, ease: 0.2 }); // friendly at rest
	const hold = { carry: CARRY, push: PUSH, reach: REACH }[what];
	if (hold) return cast.rig.pose({ ...(base ?? cast.clips.idle(t)), ...hold });
	const sat = { drive: { ...WHEEL, ...CAR }, ride: CAR, lap: LAP }[what];
	if (sat) return cast.rig.pose({ ...cast.poses.sit, ...sat });
	// getting into the pickup: from standing to sat in its seat (k), as the driver with the hands going to the wheel
	if (what === 'getin') return cast.rig.pose(blend(cast.poses.stand, { ...cast.poses.sit, ...(p.userData.seatAs === 'driver' ? { ...WHEEL, ...CAR } : CAR) }, p.userData.k ?? 1));
	const knelt = { pour: POUR, press: PRESS }[what];
	if (knelt) return cast.rig.pose({ ...cast.poses.kneel, ...knelt });
	if (what === 'rest') return cast.rig.pose({ ...ground(cast), ...(p.userData.extra ?? {}) });
	const lift = p.userData.joy ? { neck: [-0.02, 0, 0], head: [-0.06, 0, 0] } : p.userData.extra ?? {}; // the chin up, beaming
	if (what === 'walk') return cast.rig.pose({ ...walk, ...lift });
	if (cast.clips[what]) return cast.rig.pose({ ...cast.clips[what](t), ...lift });
	cast.rig.pose({ ...(cast.poses[what] ?? cast.poses.stand), ...lift });
}

/** where the newcomer's eyes are in the van (leaning into the aisle to see the road ahead), and where they look */
const VAN_SEAT = V(0.2, 1.8, 0.26);
const VAN_LOOK = V(0.0, 1.45, 14);

/**
 * The world on a canvas. clock: the world's clock in seconds (else the page's); own: whether it runs its own frames
 * (a film world runs none: the film asks for each, `tick`); film: it is the film's world (no room kept for the
 * story's card; the hour the shot's where the film sets one, `hourOf`); random: its chance (seeded, on film).
 */
export function createWorld(canvas, { onPick = () => {}, onLabels = () => {}, onCaption = () => {}, onGround = () => {}, onRoam = () => {}, clock: clockOf = null, own = true, film = false, hourOf = () => undefined, random = Math.random } = {}) {
	/** the world's clock, in seconds */
	const now = clockOf ?? (() => performance.now() / 1000);
	let rand = random;
	// the world renderer ($lib/render/world.js): soft shadows, V1's own colours (no tone mapping), at most 1.5 pixels
	// per CSS pixel
	const renderer = worldRenderer({ canvas, maxPixelRatio: 1.5, toneMapping: 'none' });
	const scene = new THREE.Scene();
	const sky = new THREE.Color(0xd8e2e2);
	scene.background = sky;
	scene.fog = new THREE.Fog(sky, 380, 2200);
	const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 6400);
	camera.position.set(138, 118, 170);
	const controls = createControls(camera, canvas, { target: new THREE.Vector3(2, 1, 3), minDistance: 12 });
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
	// the library's assets, built in the asset box and drawn by the universal renderer (./drawn.js, ./things.js)
	const drawn = createDrawn({ renderer, camera, scene });
	const { group: ground, rims } = land();
	world.add(ground, highway(), steppe(), gravel(), bushes(), tallGrass());
	const fore = clump(); // the grass close in front of a low camera
	world.add(fore);
	const foreAt = (eye, at, d = 1.1) => {
		const dir = at.clone().sub(eye).setY(0).normalize();
		fore.position.copy(eye).addScaledVector(dir, d).setY(0);
		fore.rotation.y = Math.atan2(dir.x, dir.z);
		fore.visible = true;
	};
	let shown = -1;
	/** how much of the locked land shows its dotted rim: 0 our own hex only, 1 this village, 2 the whole city plot */
	function reveal(level) {
		if (level === shown) return;
		for (const o of rims) o.visible = o.userData.level <= level;
		shown = level;
	}
	reveal(0);
	// our tent: the bell tent (things/bell-tent@1, built in the box), pitched by its control `pitch` (its canvas hung,
	// raised and draped as the box wrote it down: engine 5), its lantern the build's own light, turned up at dusk and
	// its canvas warmed at night (light)
	const home = new THREE.Group();
	home.name = 'asset:tent';
	world.add(home);
	/** the tent as the box built it, once it is here: its controls, its packs, its canvas and its lantern */
	let pitched = null;
	let homePitch = 1;
	drawn.load(THINGS.tent, home, { pick: 'asset:tent', cast: false }).then(
		(got) => {
			overLand(got.obj);
			const lamp = TENT_LAMP.path.reduce((x, i) => x?.children[i], got.named.get(TENT_LAMP.part));
			let canvas = null;
			got.obj.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => m.emissive?.getHex() === TENT_CLOTH.emissive && (canvas = m)));
			pitched = { obj: got.obj, poser: got.poser, packs: got.named.get('packs'), canvas, lamp: lamp?.isLight ? lamp : null };
			// the bell tent's own two packs stand in for ours: hidden
			for (const c of pitched.packs?.children ?? []) for (const pk of c.children) pk.visible = false;
			if (homePitch !== 1) pitched.poser.set('pitch', homePitch);
		},
		() => {}
	);
	/** the tent pitched as far as e (0 … 1) */
	function setPitch(e) {
		if (e === homePitch) return;
		homePitch = e;
		pitched?.poser.set('pitch', e);
	}
	// The third settler's supplies are separate objects: the first home and power system stay in place.
	const secondHome = new THREE.Group(), secondBag = new THREE.Group(), waterCan = new THREE.Group();
	secondHome.position.set(SECOND_HOME.x, 0, SECOND_HOME.z);
	world.add(secondHome, secondBag, waterCan);
	let secondPoser = null, secondPitch = 1, secondPitched = null;
	drawn.load(THINGS.tent, secondHome, { pick: 'asset:tent-2', cast: false }).then(g => {
		secondPoser = g.poser; secondPoser.set('pitch', secondPitch); overLand(g.obj);
        const lamp = TENT_LAMP.path.reduce((x, i) => x?.children[i], g.named.get(TENT_LAMP.part));
        let canvas = null;
        g.obj.traverse(o => o.isMesh && [].concat(o.material).forEach(m => m.emissive?.getHex() === TENT_CLOTH.emissive && (canvas = m)));
        secondPitched = {canvas, lamp: lamp?.isLight ? lamp : null};
		for (const c of g.named.get('packs')?.children ?? []) for (const pk of c.children) pk.visible = false;
	}, () => {});
	drawn.load(THINGS.bag, secondBag, { pick: 'asset:tent-2' });
	drawn.load(THINGS.water, waterCan, { pick: 'asset:water-canister' });
	const shelterPitch = (k) => { secondPitch = k; secondPoser?.set('pitch', k); };
	const EXTRA_BED = V(.35, 1.16, -1.45), WATER_BED = V(-.5, 1.16, -1.8);
	const EXTRA_SHED = V(STORE.x - .4, 0, STORE.z + .6);
	const WATER_SHED = EXTRA_SHED.clone().add(V(.8,0,0));
	const WATER_HOME = V(13, 0, -6);
 let sharedWater = null;
	function placeShelter(where) {
		secondHome.visible = where === 'home';
		secondBag.visible = where === 'shed' || where === 'bed';
		waterCan.visible = where !== 'hidden';
		if (where === 'home') shelterPitch(1);
		for (const [o, at] of [[secondBag, where === 'bed' ? EXTRA_BED : EXTRA_SHED], [waterCan, where === 'bed' ? WATER_BED : where === 'home' ? WATER_HOME : WATER_SHED]]) {
			(where === 'bed' ? truck : world).add(o); o.position.copy(at); o.rotation.set(0,0,0);
		}
	}

	/** whether the tent's own packs are in it yet, as far as it is pitched */
	const packsIn = () => homePitch >= 1 || !!pitched?.packs?.children[0]?.visible;
	// its fire place in front of it, where the Buildings' bell tent has it (things/fire-place@1, built in the box and
	// kept running there while it burns): built by its control `build`, and lit as the light goes (light) by the last
	// stretch of it, where its fire catches (FIRE_CATCHES): its flames, their light and its embers as the box has them,
	// flickering in the box
	const fire = new THREE.Group();
	fire.position.set(BELL_TENT.fire.x, 0, BELL_TENT.fire.z);
	world.add(fire);
	/** how far it is built and lit (0 … 1), and the control's value they come to */
	const hearth = { built: 1, lit: 0, b: -1, hero: null, t: null };
	drawn.cast(THINGS.fire, fire, { cast: false }, (got) => overLand(got.obj)).then(
		(h) => {
			hearth.hero = h;
			hearth.b = -1;
			burnTo();
		},
		() => {}
	);
	/** the build's `build` for what is asked: built as far as where its fire catches; built in full, lit as much as
	 *  `lit` by how far into that last stretch it goes (it burns as much as the ease of it: undone here) */
	const unease = (f) => 0.5 - Math.sin(Math.asin(1 - 2 * f) / 3);
	function burnTo() {
		const [c0, c1] = FIRE_CATCHES;
		const b = hearth.built < 1 ? Math.min(hearth.built, c0) : c0 + (c1 - c0) * unease(Math.min(1, Math.max(0, hearth.lit)));
		if (!hearth.hero || b === hearth.b) return;
		hearth.b = b;
		hearth.hero.set('build', b);
		hearth.hero.build(b);
	}
	/** the fire place built as far as k (0 … 1) */
	const buildFire = (k) => ((hearth.built = k), burnTo());

	const named = (o, name) => (o.traverse((c) => { c.name = name; if (c.isMesh) c.castShadow = true; }), o);
	/** where a library asset the renderer draws stands (./drawn.js): a group the story moves as it moved the asset */
	const anchor = (ref, pick) => {
		const g = new THREE.Group();
		drawn.follow(ref, g, { pick });
		return g;
	};
	// the MaiaCity centre: the bus stop and the abandoned gas station by the highway, where the library's maia-centre
	// stands them
	const centre = new THREE.Group();
	centre.position.set(CENTRE.x, 0, CENTRE.z);
	for (const [id, pick] of [['busStop', 'asset:busStop'], ['gasStation', 'asset:gasStation']]) {
		const at = CENTRE_AT[id], o = anchor(THINGS[id], pick);
		o.position.set(at.x, 0, at.z);
		o.rotation.y = at.turn;
		centre.add(o);
	}
	world.add(centre);
	// the village store: the old shed, the solar row and the battery the Village COOP keeps at its centre hex
	const shed = anchor(THINGS.shed, 'asset:shed');
	shed.position.set(STORE.x, 0, STORE.z);
	// the Village COOP's solar panel on its rack and its BatteryCube (four BatteryPacks and an inverter in the Power
	// Cube's frame, standing off as it is built) beside the shed: the second player fetches them home (placeBattery,
	// placePanel)
	const solar = anchor(THINGS.solar, 'asset:solar');
	const battery = anchor(THINGS.battery, 'asset:battery');
	world.add(shed, solar, battery);
	// once both are home: one cable from the panel to the BatteryCube, and one on to the tent
	const cables = new THREE.Group();
	for (const pts of [[V(PANEL_HOME.x, 0.5, PANEL_HOME.z), V(PANEL_HOME.x - 0.4, 0.03, PANEL_HOME.z + 1.2), V(BATT_HOME.x, 0.03, BATT_HOME.z - 0.6), V(BATT_HOME.x, 0.3, BATT_HOME.z - 0.35)], [V(BATT_HOME.x - 0.3, 0.3, BATT_HOME.z), V(BATT_HOME.x - 1.5, 0.03, BATT_HOME.z + 0.4), V(3.4, 0.03, -0.9), V(2.05, 0.02, -0.45)]]) {
		const c = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 6), mat(0x161616));
		cables.add(c);
	}
	cables.visible = false;
	world.add(cables);
	// the ElectroCube's cable to the tent, once it stands in its yard
	const cubeCable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(YARD.x - 0.35, 0.35, YARD.z + 0.15), V(YARD.x - 1.3, 0.03, YARD.z + 0.6), V(4.6, 0.03, -1.5), V(1.95, 0.02, -0.8)]), 30, 0.013, 6), mat(0x161616));
	cubeCable.visible = false;
	world.add(cubeCable);
	// the pickup at its real size (5.33 m), its cab seen from inside through its clear glass (v2), its four doors that
	// open (v3), and the powercube it fetches: drawn by the renderer, its tailgate and its doors its controls
	// (`tailgate`, `door.<name>`: 0 shut … 1 open)
	const truck = new THREE.Group();
	const truckCopy = drawn.follow(THINGS.pickup, truck, { pick: 'asset:pickup' });
	const setTruck = (id, k) => drawn.pose(truckCopy, id, k);
	// the powercube: the ElectroCube, OSE's Power Cube frame with an alternator in place of its hydraulics (#608): the
	// tent's power, built in the box and kept running there, its clip `run` while it hums at home, `off` elsewhere
	const cube = new THREE.Group();
	cube.name = 'asset:powercube';
	let cubeHero = null;
	drawn.cast(THINGS.cube, cube, { pick: 'asset:powercube' }).then(
		(h) => {
			cubeHero = h;
			if (stage.cube !== 'home') h.hold('off');
		},
		() => {}
	);
	// the tent in its bag (things/bell-tent-bag@1, built in the box), opened by its control `open`: its straps undone,
	// its cover laid out flat (as the box wrote it down: engine 5), what was in it settled on it (BAG_PARTS)
	const bundle = new THREE.Group();
	bundle.name = 'asset:tent';
	/** the bag as the box built it, once it is here: its controls and what is in it */
	let bag = null;
	let bagOpen = 0;
	drawn.load(THINGS.bag, bundle, { pick: 'asset:tent' }).then(
		(got) => {
			overLand(got.obj, true); // its canvas lies flat on the ground once it is opened
			const kids = got.obj.children.slice(-BAG_PARTS.length);
			bag = { poser: got.poser, parts: Object.fromEntries(BAG_PARTS.map((id, i) => [id, kids[i]])) };
			if (bagOpen) bag.poser.set('open', bagOpen);
		},
		() => {}
	);
	/** the bag opened as far as k (0 … 1) */
	function openBag(k) {
		if (k === bagOpen) return;
		bagOpen = k;
		bag?.poser.set('open', k);
	}
	/** what was in the bag, each part (none until it is here) */
	const bagParts = () => bag?.parts ?? {};
	world.add(truck, cube, bundle);
	// the loading ramp behind it while a machine goes on or off, its lip on the tailgate let down flat
	const ramp = anchor(THINGS.ramp, 'asset:pickup');
	ramp.position.z = FOOT_Z;
	ramp.visible = false;
	truck.add(ramp);
	/** the ramp out (or put away), the tailgate down for it; down too while the solar panel rides over it */
	function rampOut(on) {
		ramp.visible = on;
		setTruck('tailgate', on || solar.parent === truck ? 1 : 0);
	}
	/** a machine on its way up or down the ramp: turned on the pickup (yaw, from its own) and tipped to its slope (k) */
	const tipOn = (o, yaw, k) => o.quaternion.copy(truck.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-SLOPE * k, yaw, 0)));
	// each player's backpack off their back and open, the seeds and the bottle in it; the dug earth and the stake at
	// the spot marked
	const packs = Object.fromEntries(SEATS.map((s) => [s, openPack(drawn, `asset:pack:${s}`)]));
	for (const k of SEATS) (packs[k].visible = false), world.add(named(packs[k], `asset:pack:${k}`));
	// the seed itself as it is planted, as long as the seed picked (cm, a pip a little larger than life so it reads):
	// a pip, a stone or a nut
	const SEED_CM = { apple: 1.2, pear: 1.2, quince: 1.2, mulberry: 0.8, cherry: 1.4, plum: 2, apricot: 2.4, hazel: 1.8, chestnut: 2.8, walnut: 3.4 };
	const seed = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.006, 0.0045, 0.01), new THREE.MeshStandardMaterial({ color: '#3a2010', roughness: 0.3 }));
	seed.visible = false;
	const myKit = spotKit(drawn);
	myKit.visible = false;
	world.add(myKit);
	// the water poured from the bottle: a thin clear stream down to the earth
	const pour = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 1, 8).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: 0xd8ecf6, roughness: 0.1, transparent: true, opacity: 0.6, depthWrite: false }));
	pour.visible = false;
	world.add(pour);
	/** walking to where the first tree grows (walkTo): the path and when they set off */
	let errand = null;
	// the core circle where the homes are built (PLOT.core), drawn while a spot is chosen, and the chosen spot's marker
	const core = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, k) => V(Math.cos((k / 96) * Math.PI * 2) * PLOT.core, 0.1, Math.sin((k / 96) * Math.PI * 2) * PLOT.core))), new THREE.LineDashedMaterial({ color: 0xfff6dc, dashSize: 1.6, gapSize: 1.1 }));
	core.computeLineDistances();
	core.visible = false;
	const marker = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
	marker.renderOrder = 5; // drawn over the grass, so it shows from high above
	marker.position.y = 0.08;
	marker.visible = false;
	world.add(core, marker);
	// the travel van of the arrival, packed: the minibus itself built in the box, its glass see-through
	// (its people stay out of the sun's coarse shadow map: ./van.js)
	const van = named(packedVan(drawn, 'asset:van'), 'asset:van');
	drawn.load(THINGS.van, van, { pick: 'asset:van' }).then((got) => seeThrough(got.obj), () => {});
	van.visible = false;
	world.add(van);
	const people = Object.fromEntries(SEATS.map((s) => [s, person(s, drawn)]));
	world.add(...Object.values(people));

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
	const HOME = { A: V(-5.5, 0, 7), B: V(5.5, 0, 6), C: V(0, 0, 10) };
	/** where the players sit in the pickup's cab (its own frame): the driver on the left (+x), the other beside; their
	 *  hips on its seats (PICKUP), set back against the seat's back, the stand-in's 0.5 m sitting edge under them */
	const CAB = { rearL: V(0.42, PICKUP.driver.y - 0.5, -0.2), driver: V(PICKUP.driver.x, PICKUP.driver.y - 0.5, PICKUP.driver.z - 0.04), passenger: V(PICKUP.passenger.x, PICKUP.passenger.y - 0.5, PICKUP.passenger.z - 0.04) };
	/** the yaw that turns a spot's own frame (spotAt) to the world: its +z on toward the hex's middle */
	const spotYaw = (S) => Math.atan2(-S.x, -S.z);

	/** where things stand at this point of the story: at ('van', 'stop', 'cab', 'cruise', 'village', 'home'), the
	 *  powercube ('shed', 'bed', 'home'), the tent, the BatteryCube, whose seat this is (me), the other seat if anyone has
	 *  it, whether the other rides along (they came to fetch me), the story's hour, where the pickup rolls on to while an
	 *  invest waits (cruise: 'shed' or 'home'), the first tree's spot (spot, marked; by: 'spot' while the player stands at
	 *  it) and the seed picked (pick) */
	let stage = { at: 'home', cube: 'home', tent: 'up', battery: 'store', me: 'A', other: 'B', rides: false, hour: null, cruise: '', spot: null, marked: false, by: '', pick: '', name: '' };
	let busy = false; // an intro, a drive or a load is playing
	function set(next) {
		stage = { ...stage, ...next };
		if (!busy) place();
	}
	/** a player sitting in the cab (driver or passenger), or back out in the world */
	function seatIn(p, where) {
		truck.add(p);
		p.position.copy(CAB[where]);
		p.rotation.set(0, 0, 0);
		p.visible = true;
		p.userData.glow.visible = false;
		p.userData.pack.visible = false; // off their back while they sit, against the seat's back
		act(p, where === 'driver' ? 'drive' : 'ride');
		p.userData.seat = where;
	}
	function seatOut(p) {
		if (p.parent !== truck) return;
		world.attach(p);
		p.rotation.set(0, p.rotation.y, 0);
		p.userData.glow.visible = true;
		wear(p, !homed(p));
		act(p, 'idle');
	}
	/** whose backpack stays in the tent (Samuel 2026-10-14): once a player's home stands, their pack is put down in
	 *  it and they go on without it (fetching the second player, walking about), out again only to plant or water */
	const homed = (p) => !!stage.homed?.[p.userData.playerSeat];
	/** the backpack on their back (on) or not; on, it is no longer in the tent */
	function wear(p, on) {
		p.userData.pack.visible = on;
		const pk = packs[p.userData.playerSeat];
		if (on && pk.userData.inTent) (pk.visible = false), (pk.userData.inTent = false);
	}
	/** the bell tent's own two packs stand in for ours: hidden, our players' backpacks leant on its wall where they
	 *  stand (the tent's frame) */
	const TENT_PACKS = { A: [-1.3, 0.1, -1.2], B: [-1.25, 0.55, -1.4], C: [1.3, 0.1, -1.2] };
	function packInTent(seat) {
		const pk = packs[seat], [x, z, ry] = TENT_PACKS[seat];
		if (pk.parent !== world) world.attach(pk);
		const tentHome = seat === 'C' ? secondHome : home;
		tentHome.updateMatrixWorld(true);
		pk.position.copy(tentHome.localToWorld(V(x, 0, z)));
		pk.rotation.set(0, home.rotation.y + ry + Math.PI / 2, 0);
		pk.userData.setOpen(0);
		stowBottle(pk);
		pk.visible = true;
		pk.userData.inTent = true;
	}
	/** in the cab as the story has them: the first player at the wheel; the second beside the first, who fetched them
	 *  (alone, at the wheel themselves). Whoever is in already stays as they sit, so every drive can ask it: the pickup
	 *  never drives with no one at its wheel */
	function inCab(roaming = false) {
		const me = people[stage.me], other = stage.other ? people[stage.other] : null;
		const sit = (p, where) => p.parent !== truck && seatIn(p, where);
		// walking freely, the player is not sat back in it
		if (stage.me === 'C') {
			sit(people.A, 'driver');
			sit(people.B, 'rearL');
			if (!roaming) sit(me, 'passenger');
			return;
		}
		if (stage.me === 'A' || !other) return roaming || sit(me, 'driver');
		if (!roaming) sit(me, 'passenger');
		sit(other, 'driver');
	}
	/** the pickup rolling slowly on towards the shed or home while an invest waits (Samuel 2026-10-14): from just short
	 *  of it, slowing over CREEP metres; the camera held in it (cruiseHold) */
	let cruising = null;
	let cruiseHold = '';
	const cruiseU = () => (cruising ? cruising.u0 + (CREEP * (1 - Math.exp(-(now() - cruising.t0) / 9))) / TRACK_L : U_STORE);
	function place() {
		seatMe(false);
		const { at, me, other, rides } = stage;
		// a held shot keeps the player as it put them, and so does walking or driving freely; the pickup driven freely
		// stays where it was left, and whoever sits in it
		const keepMe = (held || roam) && (people[me].parent === world || driving || !!boarding);
		for (const s of SEATS) if (!(keepMe && s === me) && !(freeTruck && people[s].parent === truck)) seatOut(people[s]);
		// the second player is fetched: until then the pickup stands at home with the first
		const fetched = me !== 'A';
		if (at !== 'cruise') cruising = null;
		if (freeTruck) {
			// left where they drove it
		} else if ((at === 'stop' || at === 'van' || at === 'cab') && !fetched) putTruck(U_START);
		else if (at === 'village') putTruck(U_STORE);
		else if (at === 'cruise') {
			if (cruising?.to !== stage.cruise) cruising = { to: stage.cruise, u0: U_NEAR[stage.cruise] ?? U_STORE, t0: now() };
			putTruck(cruiseU());
		} else putTruck(1);
		truck.updateMatrixWorld(true);
		placeCube(stage.cube);
		placeTent(stage.tent);
		placeBattery(stage.battery);
		placeShelter(stage.shelter ?? 'hidden');
		rampOut(false);
		for (const s of SEATS) {
			const p = people[s];
			if (keepMe && s === me) continue;
			if (freeTruck && p.parent === truck) continue;
			p.visible = true;
			act(p, 'idle');
			wear(p, !homed(p));
			p.rotation.y = s === 'A' ? 0.4 : -0.4;
			if (s !== me && s !== other) { p.visible = !!stage.present?.includes(s); p.position.copy(HOME[s]); if (me === 'C' && s === 'B' && ['cab', 'cruise', 'village'].includes(at)) seatIn(p, 'rearL'); }
			else if (s === me && errand) continue; // walking to where the first tree grows: the loop moves them
			else if (s === me && at === 'home' && stage.by === 'spot' && stage.spot) standAt(p, stage.spot);
			else if (at === 'home' || (s === other && !rides)) p.position.copy(HOME[s]);
			else if (at === 'van' || at === 'cab' || at === 'cruise' || (s === other && at === 'stop')) p.visible = false;
			else if (at === 'stop') (p.position.copy(STOP), (p.rotation.y = -Math.PI / 2 - 0.5));
			else p.position.copy(beside(truck, 1, s === me ? 1 : -1.6));
		}
		if (!freeTruck && (at === 'cab' || at === 'cruise')) inCab(keepMe);
		placeKit();
		van.visible = at === 'van';
		riding = at === 'van';
		if (!riding) ((rideHold = ''), talking && talkShow(false));
		if (riding) {
			for (const p of van.userData.people) p.visible = true;
			for (const s of SEATS) people[s].visible = false;
			if (RIDE_SHOTS[rideHold]?.me) seatMe(true, RIDE_SHOTS[rideHold]);
			controls.enabled = false;
			lensIn();
		} else if (at === 'cruise' && !busy) {
			controls.enabled = false;
			lensFor(DRIVE_SHOTS[cruiseHold] ?? DRIVE_SHOTS.ots);
		} else if (!busy && !held) {
			controls.enabled = true;
			if (camera.near < 0.5 && !(roam && inTent)) lensOut(); // in the tent the walk keeps its near lens
		}
	}
	/** standing at the first tree's spot, facing it, the tent beyond */
	function standAt(p, S) {
		p.position.copy(spotAt(S)(0, 0, -0.62));
		p.rotation.y = spotYaw(S);
	}
	/** the backpack off and open beside the spot while the seed is chosen and sown, the seed picked lifted a little out
	 *  of it; the dug earth and its stake at the spot once it is marked, until the tree stands there with its own */
	function placeKit() {
		for (const k of SEATS) if (packs[k].parent !== world) world.attach(packs[k]);
		for (const k of SEATS) (packs[k].visible = false), (packs[k].userData.inTent = false);
		const S = stage.spot, me = stage.me;
		myKit.visible = !!(S && stage.marked && !trees[me]);
		if (myKit.visible) (myKit.position.set(S.x, 0, S.z), (myKit.rotation.y = spotYaw(S)));
		const stake = labelKit(myKit, stage.name, stage.pick);
		stake.position.copy(STAKE_AT);
		stake.visible = true;
		const pk = packs[me];
		pk.userData.setOpen(1);
		for (const [id, p] of Object.entries(pk.userData.packets)) p.position.y = p.userData.y0 + (id === stage.pick ? 0.05 : 0);
		stowBottle(pk);
		pour.visible = false;
		if (stage.at === 'home' && stage.by === 'spot' && S) {
			pk.position.copy(spotAt(S)(0.62, 0, -0.4));
			pk.rotation.set(0, spotYaw(S) + 0.4, 0);
			pk.visible = true;
			people[me].userData.pack.visible = false;
		}
		// a pack not on its player's back nor out at the spot is in the tent, once the tent stands
		for (const k of SEATS) if (homed(people[k]) && !people[k].userData.pack.visible && !packs[k].visible && home.visible && homePitch >= 1) packInTent(k);
	}
	/** still on the road (at 'van'): the van rolls on down the highway at its real speed, the camera in its back seat,
	 *  while the story tells what lies ahead; the road loops far out on the steppe, so the van never reaches the stop */
	let riding = false;
	let rideT = 0;
	const lensIn = () => ((camera.fov = camera.aspect < 0.8 ? 80 : 72), (camera.near = 0.05), camera.updateProjectionMatrix());
	const lensOut = () => ((camera.near = 0.5), (camera.fov = camera.aspect < 0.8 ? 58 : 42), camera.updateProjectionMatrix());
	/** a shot's own lens: inside (near 5 cm) or out, its field of view (wider on a phone held upright) */
	const lensFor = (s) => ((camera.near = s.inside ? 0.05 : s.near ?? 0.5), (camera.fov = (s.fov ?? 42) + (camera.aspect < 0.8 ? 14 : 0)), camera.updateProjectionMatrix());
	function ride(step) {
		rollVan(step);
		const t = now();
		const held = RIDE_SHOTS[rideHold];
		camera.position.copy(held ? held.cam(t, 1) : van.localToWorld(VAN_SEAT.clone())).add(V(0, Math.sin(t * 23) * 0.012 + Math.sin(t * 7.3) * 0.02, 0));
		camera.lookAt(held ? held.at(t, 1) : van.localToWorld(VAN_LOOK.clone().add(V(Math.sin(t * 0.21) * 3, 0, 0))));
	}
	/** the shot the ride holds while the story waits on the player (the mint: on their face), or none */
	let rideHold = '';
	function holdRide(name = '') {
		rideHold = name;
		seatMe(!!RIDE_SHOTS[name]?.me, RIDE_SHOTS[name]);
		if (riding) RIDE_SHOTS[name] ? lensFor({ inside: true, ...RIDE_SHOTS[name], fov: RIDE_SHOTS[name].fov ?? 72 }) : lensIn();
	}
	/** the van rolling on at its real speed, its people nodding to the road */
	function rollVan(step) {
		rideT = (rideT + step) % 50;
		van.position.set(VAN_HALT.x - 2200 + SPEED.highway * rideT, 0, VAN_HALT.z);
		van.rotation.y = Math.PI / 2;
		van.updateMatrixWorld(true);
		dust(van, -2.6);
		van.userData.nod(now(), step);
	}
	/** the shots of the ride, one a line of the story, so every sentence cuts to a new view (Samuel 2026-10-13, the
	 *  script 2026-10-14). In the van's own frame (+z ahead, +x the door's side, the player's seat by it) */
	const LAP_AT = V(ME_SEAT.x, 0.97, ME_SEAT.z + 0.3);
	const RIDE_SHOTS = {
		seat: { inside: true, cam: () => van.localToWorld(VAN_SEAT.clone()), at: (t) => van.localToWorld(VAN_LOOK.clone().add(V(Math.sin(t * 0.21) * 3, 0, 0))) },
		window: { inside: true, cam: () => van.localToWorld(V(0.55, 1.76, 0.42)), at: (t, k) => van.localToWorld(V(30, 1.2 - 0.4 * k, 6 - 10 * k)) },
		faces: { inside: true, cam: () => van.localToWorld(V(0.0, 1.97, 1.86)), at: (t, k) => van.localToWorld(V(0.25 * k - 0.1, 1.45, -1.2)) },
		along: { cam: (t, k) => van.localToWorld(V(8 - 2 * k, 1.5 + 0.5 * k, 6 - 8 * k)), at: () => van.localToWorld(V(0, 1.4, 0.5)) },
		aerial: { cam: (t, k) => van.localToWorld(V(-40 + 20 * k, 34 - 8 * k, -55 + 25 * k)), at: () => van.localToWorld(V(0, 0, 18)) },
		pass: { fixed: true, cam: () => van.localToWorld(V(4.2, 0.7, 75)), at: () => van.localToWorld(V(0, 1.2, 0)) },
		// across the aisle from the sliding door, a slow sideways dolly: the other passengers, tired, their bags with them
		aisle: { inside: true, me: true, fov: 58, cam: (t, k) => van.localToWorld(V(0.8, 1.74, 0.95 - 0.3 * k)), at: (t, k) => van.localToWorld(V(-0.35, 1.42, -0.8 - 0.3 * k)) },
		// close on the player at the window, a long lens, the steppe soft behind
		gaze: { inside: true, me: true, fov: 30, cam: (t, k) => van.localToWorld(V(-0.18 + 0.03 * k, 1.68, 0.95 - 0.04 * k)), at: () => van.localToWorld(V(ME_SEAT.x + 0.06, 1.62, ME_SEAT.z + 0.06)) },
		// the woman beside them lifts her eyes up the road
		lookup: { inside: true, fov: 46, cam: () => van.localToWorld(V(0.12, 1.62, 1.02)), at: () => van.userData.herFace(), run: (k) => van.userData.lift(0.32 * (1 - ease(k)) - 0.1 * ease(k)), end: () => van.userData.lift(0) },
		// top-down on their hands, the backpack on their knees: the paper bag of seeds and the 1 l bottle in its top
		pack: { inside: true, me: true, lap: true, fov: 40, cam: (t, k) => van.localToWorld(LAP_AT.clone().add(V(0.02, 0.92 - 0.04 * k, 0.12))), at: () => van.localToWorld(LAP_AT.clone().add(V(0, 0.4, 0.02))) },
		// low over the road ahead of the van, running to the horizon, tilting up
		horizon: { cam: (t, k) => van.localToWorld(V(-2.5, 7 + 3 * k, -16 + 6 * k)), at: (t, k) => van.localToWorld(V(0, 1 + 60 * ease(k), 40 + 900 * ease(k))) },
		// high up, the van a dot on the endless road, held
		dot: { far: true, cam: (t, k) => van.localToWorld(V(-170 - 10 * k, 300, -140 + 30 * k)), at: () => van.localToWorld(V(0, 0, 90)) },
		// the player alone, centred, their face and shoulders, room above them for the joy of the first mint
		mcu: { inside: true, me: true, fov: 50, cam: (t, k) => van.localToWorld(V(ME_SEAT.x + 0.02, 1.72, 0.98 - 0.04 * k)), at: () => van.localToWorld(V(ME_SEAT.x + 0.01, 1.6, ME_SEAT.z + 0.08)) },
		// the player themself in the back seat, gazing out of the side window (Samuel 2026-10-13): from the front at the
		// side, then close on their face
		profile: { inside: true, me: true, cam: (t, k) => van.localToWorld(V(0.08 + 0.06 * k, 1.74, 1.08)), at: () => van.localToWorld(V(ME_SEAT.x + 0.07, 1.62, ME_SEAT.z + 0.03)) },
		close: { inside: true, me: true, cam: (t, k) => van.localToWorld(V(0.5 + 0.03 * k, 1.8, 0.84 - 0.06 * k)), at: () => van.localToWorld(V(0.49, 1.71, 0.27)) },
		// the woman beside you telling you of the HEARTS, as a conversation is filmed (Samuel 2026-10-13: no phone, her
		// telling you): the two of you from the front as she turns to you; her face over your shoulder; your face as you
		// listen; her face from the front
		two: { inside: true, me: true, cam: (t, k) => van.localToWorld(V(0.2 - 0.03 * k, 1.8, 1.0 - 0.06 * k)), at: () => van.localToWorld(V(0.18, 1.55, 0.2)) },
		over: { inside: true, me: true, fov: 46, cam: (t, k) => van.localToWorld(V(0.8 - 0.02 * k, 1.86, -0.1 + 0.03 * k)), at: () => van.userData.herFace() },
		listen: { inside: true, me: true, fov: 52, cam: (t, k) => van.localToWorld(V(0.1 + 0.02 * k, 1.72, 0.74 - 0.04 * k)), at: () => van.localToWorld(V(ME_SEAT.x + 0.02, 1.66, ME_SEAT.z + 0.12)) },
		her: { inside: true, fov: 52, cam: (t, k) => van.localToWorld(V(0.42, 1.7, 0.52 - 0.04 * k)), at: () => van.userData.herFace() }
	};
	// every line of the ride a new view, the back seat's own once (Samuel 2026-10-13: it came round three times)
	const RIDE_ORDER = ['seat', 'aerial', 'profile', 'window', 'along', 'close', 'faces', 'pass'];
	/** the player sitting in the van's back seat for the shots that show them (the backpack on their knees for the one
	 *  that looks into it), or back in the world */
	function seatMe(on, shot = {}) {
		const me = people[stage.me];
		if (!me) return;
		const pk = packs[stage.me];
		if (on) {
			van.add(me);
			me.position.copy(ME_SEAT);
			me.rotation.set(0, talking ? 0.05 : shot.lap ? 0 : 0.45, 0); // the head and shoulders turned to the window, or to her as she talks
			me.userData.glow.visible = false;
			act(me, shot.lap ? 'lap' : 'sit');
			// while the woman beside them talks, they turn to her and listen
			// (spread over the chest, the neck and the head, so the head's own turn stays small and the jaw turns with it)
			me.userData.extra = talking ? { chest: [0.03, -0.16, 0], neck: [0.02, -0.32, 0], head: [0.04, -0.2, 0] } : null;
			me.userData.pack.visible = !shot.lap;
			if (shot.lap) (van.add(pk), pk.position.copy(LAP_AT), pk.rotation.set(-0.15, 0, 0), pk.userData.setOpen(1), stowBottle(pk), (pk.visible = true));
			else if (pk.parent === van) (world.attach(pk), (pk.visible = false));
			me.visible = true;
		} else if (me.parent === van) {
			world.attach(me);
			if (pk.parent === van) (world.attach(pk), (pk.visible = false));
			me.userData.glow.visible = true;
			me.userData.extra = null;
			me.userData.pack.visible = true;
			me.visible = false;
			act(me, 'idle');
		}
	}
	let rideCut = 0;
	let talking = false;
	/** the woman beside the player turns to them and talks (on), or sits back */
	function talkShow(on) {
		talking = !!on;
		van.userData.talk(talking);
	}
	const TENT_IN_SHED = V(STORE.x - 1.5, 0, STORE.z + 0.6);
	/** the tent: packed in the shed, packed on the pickup's bed, or pitched at the middle of our hex */
	function placeTent(where) {
		home.visible = fire.visible = where === 'up';
		if (where === 'up') (setPitch(1), buildFire(1));
		bundle.visible = where !== 'up';
		openBag(0);
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
		lit = where === 'home' || stage.battery === 'home';
		cubeCable.visible = where === 'home';
		if (where !== 'home') cubeHero?.hold('off'); // it hums only at home, powering the tent
		if (where === 'shed') (cube.position.copy(CUBE_IN_SHED), cube.rotation.set(0, Math.PI / 2, 0));
		else if (where === 'home') (cube.position.set(YARD.x, 0, YARD.z), cube.rotation.set(0, -0.3, 0));
		else {
			truck.add(cube);
			cube.position.copy(CUBE_ON_BED);
			cube.rotation.set(0, Math.PI / 2, 0); // its 1 m length across the 1.7 m bed
		}
	}
	/** whether the tent has power (the ElectroCube in its yard, or the sun stored in the BatteryCube): lit from within
	 *  as the light goes */
	let lit = false;

	// the first trees, each named after the player who planted it, where they planted it, beside its stake, as
	// it stands on its watered months now; a watering grows it in place (grows)
	const trees = {};
	/** the trees a new one takes the place of, standing till it is drawn */
	const standing = Object.fromEntries(SEATS.map((s) => [s, []]));
	const grows = [];
	/** the players' trees (list: { seat, plant, seed, stage, x, z, grown }), regrown when a stage moves on */
	function setTrees(list = [], { holdGrowth = false } = {}) {
		const ready = [];
		for (const seat of SEATS) {
			const t = list.find((x) => x.seat === seat);
			const had = trees[seat];
			const key = t ? `${t.plant.id}:${t.plant.version}:${t.seed}:${t.stage.toFixed(3)}:${t.x}:${t.z}:${t.name}:${!!t.markerOnly}` : '';
			if (had?.userData.key === key) continue;
			// the one it takes the place of stands until it is there to draw (no gap while it is built)
			const away = () => {
				for (const o of standing[seat].splice(0)) (world.remove(o), o.traverse((c) => c.geometry?.dispose?.()), drawn.drop(o.userData.drawn));
			};
			if (had) standing[seat].push(had);
			delete trees[seat];
			if (!t) {
				away();
				continue;
			}
			const g = new THREE.Group();
			// the plant at its stage from its seed, built in the asset box and drawn by the renderer where this anchor
			// stands (./plants.js)
			const plant = new THREE.Group();
			if (holdGrowth && had) plant.visible = false;
			const copy = t.markerOnly ? {ready: Promise.resolve(null)} : drawn.follow(plantRef(t.plant, t.stage, t.seed), plant, { pick: `tree:${seat}`, receive: true });
			const kit = spotKit(drawn, { name: t.name ?? '', seed: t.plant.id, pick: `tree:${seat}` });
			kit.userData.setWet(0.6);
			g.add(plant, kit);
			g.position.set(t.x, 0, t.z);
			g.rotation.y = spotYaw(t);
			g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.name = `tree:${seat}`)));
			// a ring on the ground round it, drawn over the grass, while a spot is chosen: a tree already grows here, its
			// name over it (Samuel 2026-10-14: the trees the first settlers planted marked in the later ones' stories)
			const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.2, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xa8e07a, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
			ring.position.y = 0.08;
			ring.renderOrder = 5;
			ring.visible = !film;
            ring.name = `tree:${seat}`;
			g.add(ring);
			// how tall it stands is read off the build once it is there
			g.userData = { key, top: 0.7, grown: t.grown, height: 0, ring, drawn: copy };
			const was = had?.userData;
			ready.push(copy.ready.then((box) => {
				const height = Math.max(0, box?.max.y ?? 0);
				Object.assign(g.userData, { top: Math.max(0.7, height + 0.35), height, bounds: box?.clone() });
				if (trees[seat] !== g) return;
				const startGrowth = () => {
					plant.visible = true;
					away();
					if (was && t.grown > was.grown && height > 0.002) {
						const from = Math.min(1, was.height / height);
						plant.scale.setScalar(from);
						grows.push({ plant, t0: now(), from, seconds: holdGrowth ? 4 : 1.8 });
					}
				};
				if (holdGrowth && was && t.grown > was.grown) {
					plant.visible = false;
					g.userData.startGrowth = startGrowth;
				} else startGrowth();
			}));
			world.add(g);
			trees[seat] = g;
		}
		if (trees[stage.me]) myKit.visible = false;
		return Promise.all(ready);
	}

	function placeBattery(where) {
		cables.visible = where === 'home';
		for (const o of [battery, solar]) if (o.parent !== world) world.attach(o);
		solar.rotation.set(0, 0, 0);
		if (where === 'store') (battery.position.copy(BATT_AT), battery.rotation.set(0, 0.2, 0), solar.position.copy(PANEL_AT), (solar.rotation.y = Math.PI + 0.3));
		else if (where === 'home') (battery.position.copy(BATT_HOME), battery.rotation.set(0, -0.3, 0), solar.position.copy(PANEL_HOME), (solar.rotation.y = Math.PI - 0.4));
		else {
			truck.add(battery, solar);
			battery.position.copy(CUBE_ON_BED);
			battery.rotation.set(0, Math.PI / 2, 0);
			solar.position.copy(PANEL_ON_BED);
			solar.rotation.set(0, Math.PI / 2, 0);
		}
		rampOut(ramp.visible); // the tailgate down while the panel rides over it
	}

	/** the camera's places: what it looks at, and from where; once there, it drifts slowly round, like a crane on a set */
	const PLACES = {
		centre: { target: V(STOP.x + 6, 2, STOP.z + 1), offset: V(-34, 26, -50) },
		city: { target: V(CX + 120 * K, 0, CZ + 80 * K), offset: V(620 * K, 900 * K, 860 * K) },
		village: { target: V(STORE.x, 2, VZ - 6), offset: V(52, 38, 58) },
		tribe: { target: V(2, 1, 3), offset: V(30, 22, 40) }
	};
	/** the places of the last act, made where the story is now (the spot the player chose), each with its own shots, one
	 *  a line, in order: a shot is { cam: k → [eye, look], put: where the player is and what they do, fov, cold } */
	const SITTING = V(1.45, 0, 2.95);
	const PACK_AT = V(2.6, 0, 5.0);
	const SCENES = {
		// your rent (Samuel 2026-10-14): a crane up to the tent tiny on its hex; close at its door; sitting by it, held;
		// low, the tent and you, while the invest waits (the low cut cold, then warm again)
		tent: () => [
			{ cam: (k) => [V(5, 1.6, 9).lerp(V(16, 27, 31), ease(k)), V(0, 1, 0).lerp(V(0, 0.4, 0), k)], put: (p) => ((p.position.set(0.9, 0, 2.95)), (p.rotation.y = 0.1)) },
			{ cold: true, fov: 34, cam: (k) => [V(0.98, 1.64, 4.2 - 0.12 * k), V(0.8, 1.6, 2.75)], put: (p) => (p.position.set(0.75, 0, 2.75), (p.rotation.y = 0.12)) },
			{ cold: true, fov: 40, cam: (k) => [V(6.8 - 0.2 * k, 1.35, 9.6 - 0.2 * k), V(0.9, 0.7, 1.6)], put: (p) => (p.position.copy(SITTING), (p.rotation.y = 0.3), act(p, 'rest')) },
			{ fov: 44, cam: (k) => [V(3.2 - 0.15 * k, 0.62, 5.7 - 0.2 * k), V(1.0, 0.95, 2.1)], put: (p) => (p.position.copy(SITTING), (p.rotation.y = 0.3), act(p, 'rest')) }
		],
		// the answer: rising over the tent on its hex
		rise: () => [{ cam: (k) => [V(6, 3, 10).lerp(V(34, 62, 74), ease(k)), V(0, 1, 0).lerp(V(0, 0, 0), k)], put: (p) => (p.position.copy(SITTING), (p.rotation.y = 0.3), act(p, 'rest')) }],
		// the backpack off and opened in front of you (pays off the insert in the van): the seeds and the bottle in it
		pack: () => [{
			fov: 40,
			cam: (k) => [V(4.25 - 0.2 * k, 1.15, 6.35 - 0.2 * k), V(2.5, 0.5, 4.85)],
			put: (p) => {
				const pk = packs[stage.me];
				pk.position.copy(PACK_AT);
				pk.rotation.set(0, Math.PI + 0.3, 0);
				pk.userData.setOpen(0);
				stowBottle(pk);
				pk.visible = true;
				p.userData.pack.visible = false;
				p.position.set(PACK_AT.x - 0.15, 0, PACK_AT.z - 0.62);
				p.rotation.y = 0.2;
				act(p, 'press');
			},
			run: (k) => {
				// the lid thrown back, then the bottle and the seed packets lifted a little out of it
				const pk = packs[stage.me], { bottle, bottleAt, packets } = pk.userData;
				const out = ease(Math.min(1, Math.max(0, k * 2.5 - 1)));
				pk.userData.setOpen(ease(Math.min(1, k * 2.5)));
				bottle.position.y = bottleAt.p.y + 0.08 * out;
				for (const p of Object.values(packets)) p.position.y = p.userData.y0 + 0.04 * out;
				if (k > 0.6) act(people[stage.me], 'kneel');
			}
		}, {
			// and down into it: the five seed packets, one for every tree (everyone here plants their own)
			fov: 36,
			near: 0.05,
			cam: (k) => [V(PACK_AT.x + 0.12, 1.05 - 0.06 * k, PACK_AT.z - 0.06), V(PACK_AT.x, 0.33, PACK_AT.z + 0.02)],
			run: () => {
				const pk = packs[stage.me], { bottle, bottleAt, packets } = pk.userData;
				pk.userData.setOpen(1);
				bottle.position.y = bottleAt.p.y + 0.08;
				for (const p of Object.values(packets)) p.position.y = p.userData.y0 + 0.04;
			}
		}],
		// high behind you, the core circle drawn on the ground: choose where it grows, out beyond the homes
		plot: () => [{
			fov: 46,
			// the whole circle in the picture, you by the tent in its middle, the land beyond it to tap (further off on an
			// upright phone)
			cam: (k) => {
				// a tree another already planted drawn into the picture too, ringed and named (Samuel 2026-10-14)
				const theirs = trees[stage.me === 'A' ? 'B' : 'A'];
				const at = theirs ? V(0, 0, 6).lerp(theirs.position.clone().setY(0), 0.3) : V(0, 0, 6);
				const far = (camera.aspect < 0.8 ? 1.8 : 1) * (theirs ? 1.1 : 1);
				return [V(-6, 46 + 2 * k, -36 - 1.5 * k).sub(at).multiplyScalar(far).add(at), at];
			},
			start: () => (core.visible = true),
			put: (p) => (p.position.set(PACK_AT.x, 0, PACK_AT.z + 0.5), (p.rotation.y = 0.15), act(p, 'look up'))
		}],
		// top-down into the backpack beside the spot: the five seed packets
		seeds: () => {
			const L = spotAt(stage.spot);
			return [{ fov: 38, near: 0.05, cam: (k) => [L(0.62, 1.2 - 0.05 * k, -0.34), L(0.62, 0.38, -0.29)], put: (p) => (standAt(p, stage.spot), act(p, 'kneel')) }];
		},
		// behind you at the stake and its flag, the tent beyond, then craning up and back
		tend: () => {
			const L = spotAt(stage.spot);
			return [{ fov: 44, near: 0.1, cam: (k) => [L(1.5, 1.5, -2.5).lerp(L(1.1, 3.4, -4.6), ease(k)), L(0, 0.75, 0.4).lerp(L(0, 0.9, 7), ease(k))], put: (p) => standAt(p, stage.spot) }];
		},
		// and on, up and away until the tent is a dot, along to the road and the next van coming down it to the stop
		end: () => {
			const L = spotAt(stage.spot);
			const fly = pathOf({ kind: 'fly', keys: [[arr(L(1.1, 3.4, -4.6)), arr(L(0, 0.9, 7))], [[24, 150, 130], [0, 0, 0]], [[-260, 230, 40], [-430, 0, -120]], [[VAN_HALT.x - 560, 70, ROAD_Z + 115], [VAN_HALT.x - 830, 1, ROAD_Z]]], curve: 'glide' });
			return [{
				min: 12,
				fov: 44,
				cam: (k) => {
					const T = k * 12;
					van.position.set(VAN_HALT.x - 1100 + SPEED.highway * T, 0, VAN_HALT.z);
					van.rotation.y = Math.PI / 2;
					dust(van, -2.6);
					if (moment) moment.hour = (stage.hour ?? 17.2) + 0.45 * k; // the sun going down as we fly
					// the film camera's pose (where, and its yaw and pitch) as an eye and the point on the ground it looks at
					const [x, y, z, yaw, pitch] = fly(k);
					const dir = V(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
					const eye = V(x, y, z);
					return [eye, eye.clone().addScaledVector(dir, dir.y < -0.01 ? Math.min(2000, -y / dir.y) : 200)];
				},
				start: () => {
					van.visible = true;
					for (const p of van.userData.people) p.visible = false;
				},
				put: (p) => standAt(p, stage.spot)
			}];
		}
	};
	/** a player's first tree as a place for the camera: close by it, a little above, the tent beyond */
	function treePlace(seat) {
		const g = trees[seat];
		if (!g) return null;
		const back = V(-g.position.x, 0, -g.position.z).setLength(-7).add(V(3, 0, 0).applyAxisAngle(V(0, 1, 0), g.rotation.y));
		return { target: g.position.clone().setY(Math.min(1.5, g.userData.top * 0.45)), offset: back.setY(2.6 + g.userData.top * 0.5) };
	}
	let placeNow = '';
	let placed = false; // the first place is taken at once, without easing
	let tourOn = false;
	/** the shot a prompt waits in (the invest at the tent, the spot, the seed): the camera stays where it ended */
	let held = false;
	/** turn the camera to a place of the story, easing there (or at once) */
	function focus(name, { now = false } = {}) {
		if (name === placeNow && !now) return;
		placeNow = name;
		const p = name?.startsWith('tree:') ? treePlace(name.slice(5)) : PLACES[name];
		if (!p) return;
		held = false;
		if (busy || riding) return; // taken up when the moment ends
		if (stage.at === 'cruise') return;
		controls.enabled = true;
		if (!placed) (placed = true), (now = true);
		const offset = p.offset.clone().multiplyScalar(camera.aspect < 0.8 ? 1.65 : 1);
		controls.minDistance = Math.min(controls.minDistance, nearest(offset));
		goal = { target: p.target.clone(), offset };
		drift = !p.still;
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
		if (tourOn && !busy && !film) camera.setViewOffset(w, h, 0, h * 0.17, w, h);
		else camera.clearViewOffset();
	}
	const touring = (on) => {
		if (!on) held = false; // no story, no shot held for it: the camera is the player's again
		if (on === tourOn) return;
		tourOn = on;
		frameView();
	};

	// moments that play over a few seconds: one at a time, each step a function of its own clock
	let moment = null;
	/** play a moment (steps); hour: its light (a step may move it: a time-lapse); keep: its last frame stays when it
	 *  ends, while a prompt waits on the player */
	/** the reel the next moment is filmed by (`reel`), taken by it as it starts */
	let nextReel = null;
	function play(steps, { hour: at, keep = false } = {}) {
		const reel = nextReel;
		nextReel = null;
		return new Promise((done) => {
			if (roam || freeTruck) walk(false); // a moment ends the free walk and drive, everyone back where the story has them
			busy = true;
			held = false;
			errand = null;
			roam = false;
			controls.enabled = false;
			goal = null;
			fore.visible = false;
			frameView();
			moment = { steps, i: 0, t0: now(), start: now(), done, hour: at ?? stage.hour ?? undefined, keep, reel };
		});
	}
	function endMoment() {
		const m = moment;
		moment = null;
		busy = false;
		canvas.style.filter = '';
		fore.visible = false;
		if (m?.steps.some((x) => x.caption)) onCaption(null); // the page's own voice-over keeps its line
		const name = placeNow;
		placeNow = '';
		if (m?.keep && !riding && stage.at !== 'cruise') {
			// the shot holds while the story waits on the player, the picture drawn a little higher over the card
			held = true;
			placeNow = name;
			controls.enabled = false;
			frameView();
			return m.done();
		}
		controls.enabled = true;
		camera.near = 0.5;
		camera.fov = camera.aspect < 0.8 ? 58 : 42;
		camera.updateProjectionMatrix();
		// the orbit picks up from where the camera looks now; what the moment moved stays where it ended, and the page sets the next stage
		controls.target.copy(camera.position).add(camera.getWorldDirection(V(0, 0, 0)).multiplyScalar(40));
		frameView();
		if (riding) (holdRide(rideHold), (controls.enabled = false));
		else if (stage.at === 'cruise') ((controls.enabled = false), lensFor(DRIVE_SHOTS[cruiseHold] ?? DRIVE_SHOTS.ots));
		else if (name) focus(name);
		m?.done();
	}
	/** a step's line as it is told: held on over the wordless steps that follow its shot (a push, a roll on), up to
	 *  the next shot, so the picture never runs on long without the voice */
	function spoken(m, i) {
		let dur = m.steps[i].dur;
		for (let j = i + 1; j < m.steps.length && !m.steps[j].shot && !m.steps[j].caption; j++) dur += m.steps[j].dur;
		return { ...m.steps[i].caption, dur };
	}
	function runMoment(now) {
		const m = moment;
		dt = Math.min(0.25, now - (m.last ?? now - 1 / 60));
		m.last = now;
		if (!m.started) (m.started = true), m.steps[0].start?.(), m.steps[0].caption && onCaption(spoken(m, 0));
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
			if (step.caption) onCaption(spoken(m, m.i));
		}
		step.run?.(t / step.dur);
		if (m.reel) filmed(m.reel, now - m.start);
	}
	/** the camera as a reel's shot has it at time t of the moment: its pose (in the world, or in one of the world's
	 *  frames) and its lens; on an upright screen, the shot's upright framing */
	function filmed(reel, t) {
		const e = reelFrame(reel, t, camera.aspect < 0.8 ? '9:16' : undefined);
		if (!e) return;
		if (e.own) return void putParts(e.parts);
		putParts(e.parts);
		const f = e.frame && frames[e.frame]?.();
		aim(camera, f ? poseIn(f, e.pose) : e.pose);
		camera.fov = e.fov;
		if (e.near) camera.near = e.near;
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();
	}
	/** the world's moving parts a shot moves (game/film/worlds.js `parts`), put where it has them over the world's own
	 *  moves: the van along the highway (1 at the bus stop), the pickup along the track, the tent as far as pitched.
	 *  Returns how to put them back as the world had them */
	function putParts(v = {}) {
		const was = [];
		if (v.van?.along !== undefined) {
			const p = van.position.clone(), r = van.rotation.y;
			was.push(() => (van.position.copy(p), (van.rotation.y = r), van.updateMatrixWorld(true)));
			van.position.set(VAN_HALT.x - 2200 * (1 - v.van.along), 0, VAN_HALT.z);
			van.rotation.y = Math.PI / 2;
			van.updateMatrixWorld(true);
		}
		if (v.pickup?.along !== undefined) {
			const p = truck.position.clone(), r = truck.rotation.y;
			was.push(() => (truck.position.copy(p), (truck.rotation.y = r), truck.updateMatrixWorld(true)));
			putTruck(v.pickup.along);
			truck.updateMatrixWorld(true);
		}
		if (v.tent?.pitch !== undefined) {
			const e = homePitch;
			was.push(() => setPitch(e));
			setPitch(v.tent.pitch);
		}
		return () => was.forEach((f) => f());
	}
	/** where the first tree's spot stands, turned as its own frame turns (spotAt): +z on toward the hex's middle */
	const spotFrame = new THREE.Object3D();
	/** the world's own frames a shot's camera may ride in (game/film/camera.js `frame`), each where it stands now: the
	 *  van, the pickup, the player and the first tree's spot */
	const frames = {
		van: () => van,
		pickup: () => truck,
		player: () => people[stage.me],
		spot: () => {
			const S = stage.spot ?? { x: 0, z: 30 };
			spotFrame.position.set(S.x, 0, S.z);
			spotFrame.rotation.set(0, spotYaw(S), 0);
			return spotFrame;
		}
	};
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
	/** a whip pan (the editor's transitions, kept for one meaning: jumping across the land to another place): the camera
	 *  flicks sideways over the last (out) or the first (into) moments of a shot, the same way round, blurred so the
	 *  cut hides in the smear */
	const WHIP = 0.32, UP = V(0, 1, 0);
	function whipCam(sec, dur, { into = 0, out = 0 } = {}) {
		const a = out && dur - sec < WHIP ? out * ((WHIP - (dur - sec)) / WHIP) ** 2 : into && sec < WHIP ? -into * ((WHIP - sec) / WHIP) ** 2 : 0;
		if (a) camera.rotateOnWorldAxis(UP, a);
		const b = a ? (Math.abs(a) / Math.max(Math.abs(into), Math.abs(out))) * 10 : 0;
		canvas.style.filter = b > 0.5 ? `blur(${b.toFixed(1)}px)` : '';
	}

	// dust: puffs behind whatever drives over the sand, swelling and fading
	const puffs = Array.from({ length: 60 }, () => {
		const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xd9c8a0, roughness: 1, transparent: true, opacity: 0, depthWrite: false }));
		m.visible = false;
		m.userData.age = 9;
		world.add(m);
		return m;
	});
	let puffAt = 0;
	let lastDust = new WeakMap();
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
		p.position.copy(o.localToWorld(V((rand() - 0.5) * 1.2, 0.5, back)));
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
		let left = Math.max(0, s) * WALK;
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
	// at their door: just behind it when it is open (pickup v3's doors hinge at their front edge), clear of the B pillar
	const DRIVER = [1.3, 0.8], PASSENGER = [-1.3, 0.8], TAIL = [0.5, -3.3], BESIDE = [2.6, 1], BESIDE_2 = [2.6, -1.6];
	/** getting in at their door (where: 'driver' or 'passenger'), k from 0 to 1 over GET_IN seconds: the door swung
	 *  open (the pickup's doors, once it has them: setDoor), a turn towards the seat, a step up and in, sitting down
	 *  onto it, turning to face ahead, the door pulled shut. At 1 they sit in it */
	const GET_IN = 1.8;
	function climbIn(p, where, k) {
		truck.updateMatrixWorld(true);
		setTruck(`door.${where}`, Math.min(1, k / 0.2) * (1 - Math.min(1, Math.max(0, (k - 0.8) / 0.2))));
		if (k >= 1) return void (p.parent !== truck && seatIn(p, where));
		if (p.parent === truck) seatOut(p);
		const door = atTruck(...(where === 'rearL' ? [1.3, -.25] : where === 'driver' ? DRIVER : PASSENGER));
		const seat = truck.localToWorld(CAB[where].clone());
		const e = ease(Math.min(1, Math.max(0, (k - 0.2) / 0.6)));
		p.position.lerpVectors(door, seat, e);
		const yaw0 = Math.atan2(seat.x - door.x, seat.z - door.z), turn = Math.atan2(Math.sin(truck.rotation.y - yaw0), Math.cos(truck.rotation.y - yaw0));
		p.rotation.y = yaw0 + turn * ease(Math.min(1, Math.max(0, (k - 0.25) / 0.6)));
		p.userData.pack.visible = e < 0.5; // off their back as they sit back (the seat's back)
		Object.assign(p.userData, { k: e, seatAs: where });
		act(p, 'getin');
	}
	/** getting out (k from 0 to 1 over GET_IN seconds): the door open, turning to it, up off the seat and out, standing
	 *  at the door, the door pushed shut behind them */
	function climbOut(p, where, k) {
		// out of the seat they sit in (or are on the way out of); not in the cab, nothing to get out of
		if (p.parent === truck) where = p.userData.seat ?? where;
		else if (p.userData.act === 'getin') where = p.userData.seatAs ?? where;
		else if (k < 1) return;
		truck.updateMatrixWorld(true);
		setTruck(`door.${where}`, Math.min(1, k / 0.2) * (1 - Math.min(1, Math.max(0, (k - 0.8) / 0.2))));
		if (p.parent === truck) seatOut(p);
		const door = atTruck(...(where === 'rearL' ? [1.3, -.25] : where === 'driver' ? DRIVER : PASSENGER));
		const seat = truck.localToWorld(CAB[where].clone());
		const e = ease(Math.min(1, Math.max(0, (k - 0.15) / 0.6)));
		p.position.lerpVectors(seat, door, e);
		const yaw1 = Math.atan2(door.x - seat.x, door.z - seat.z), turn = Math.atan2(Math.sin(yaw1 - truck.rotation.y), Math.cos(yaw1 - truck.rotation.y));
		p.rotation.y = truck.rotation.y + turn * ease(Math.min(1, k / 0.5));
		p.userData.pack.visible = e > 0.5 && !homed(p);
		Object.assign(p.userData, { k: 1 - e, seatAs: where });
		act(p, k >= 1 ? 'idle' : 'getin');
	}
	/** where they stand at the ramp's foot, to take a machine off it */
	const AT_RAMP = [0, FOOT_Z - 0.4];
	const PUSHING = 0.9; // m/s, a machine on its wheels pushed over the grass
	/** a machine rolled off the pickup to where it stands (the ElectroCube to its yard, the BatteryCube beside it), s
	 *  seconds after they reached the ramp's foot: they walk up the ramp below it while it comes out of the bed over the
	 *  tailgate, walk back down holding it, step round it at the foot and push it on, round the pickup's side. Returns
	 *  whether it stands there */
	const OUT = 1.3, DOWN = 2.2, OFF = FOOT_Z - 0.4; // out of the bed, down the ramp (s); off it: its whole depth on the ground
	const onRamp = (z) => truck.localToWorld(V(0, rampY(z), z));
	/** a machine's way from the ramp's foot to where it stands (to): round the pickup's side on that side, and the
	 *  steps they take round it at the foot to get behind it */
	function offWay(to) {
		const side = Math.sign(truck.worldToLocal(to.clone()).x) || 1;
		const way = [onRamp(OFF), atTruck(side * 2.4, OFF + 0.6), to.clone().setY(0)];
		const d0 = way[1].clone().sub(way[0]).normalize();
		return { way, round: [onRamp(OFF - 0.95), way[0].clone().addScaledVector(d0, -0.95)] };
	}
	/** how long rollOff takes, from the ramp's foot till it stands there (s) */
	const rollTime = (to) => {
		const { way, round } = offWay(to);
		return OUT + DOWN + walkTime(round) + walkTime(way) * (WALK / PUSHING);
	};
	function rollOff(thing, to, me, s) {
		const on = onRamp;
		if (s < OUT + DOWN) {
			const z = s < OUT ? CUBE_ON_BED.z + (LIP_Z - CUBE_ON_BED.z) * ease(s / OUT) : LIP_Z + (OFF - LIP_Z) * ease((s - OUT) / DOWN);
			thing.position.copy(on(z));
			tipOn(thing, Math.PI / 2, rampTip(z));
			const zm = s < OUT ? AT_RAMP[1] + (LIP_Z - 0.95 - AT_RAMP[1]) * ease(s / OUT) : z - 0.95;
			me.position.copy(on(zm));
			me.rotation.y = truck.rotation.y; // facing up the ramp
			act(me, s < OUT ? 'walk' : 'carry+walk');
			return false;
		}
		const { way, round } = offWay(to);
		const t = s - OUT - DOWN - walkTime(round);
		tipOn(thing, Math.PI / 2, 0);
		if (t < 0) return (thing.position.copy(way[0]), walkOn(me, round, s - OUT - DOWN), t > -0.3 && act(me, 'push'), false);
		let left = t * PUSHING;
		for (let i = 1; i < way.length; i++) {
			const a = way[i - 1], b = way[i], d = a.distanceTo(b);
			if (left <= d) {
				const dir = b.clone().sub(a).normalize();
				thing.position.lerpVectors(a, b, d ? left / d : 1);
				me.position.copy(thing.position).addScaledVector(dir, -0.95).setY(0);
				me.rotation.y = Math.atan2(dir.x, dir.z);
				act(me, 'push+walk');
				return false;
			}
			left -= d;
		}
		thing.position.copy(way[way.length - 1]);
		act(me, 'idle');
		return true;
	}
	/** unloading a machine at home, in three shots (s from the ramp's foot, as rollOff): side on to the ramp as they
	 *  come up to its foot (a cut brings them close), walk up it, and back down below the machine as it comes out over
	 *  the tailgate and down; low beside it as they push it off round the pickup; and wide on where it goes, it pushed
	 *  in the last of its way (the cut skips the middle, at its pace). after(s, k): the last shot's own work (the cable,
	 *  the light) */
	function unload(thing, to, me, { wide, wideAt, after = () => {} }) {
		let up = [], eyeR = V(0, 0, 0), lookR = V(0, 0, 0), T = 0;
		const ramp = beat(4, (s) => {
			const t1 = walkTime(up);
			if (s < t1) walkOn(me, up, s);
			else rollOff(thing, to, me, s - t1);
			still(eyeR, lookR);
		}, () => {
			world.attach(thing);
			rampOut(true);
			me.visible = true;
			// from the side away from where it goes, so it rolls off away from us after
			const sx = -Math.sign(truck.worldToLocal(to.clone()).x) || 1;
			up = [atTruck(sx * 1.6, FOOT_Z - 2.4), atTruck(...AT_RAMP)];
			me.position.copy(up[0]);
			eyeR = truck.localToWorld(V(sx * 6.2, 1.4, -4.6));
			lookR = truck.localToWorld(V(0, 1.05, -4.3));
			camera.position.copy(eyeR);
			controls.target.copy(lookR);
			lensFor({ fov: 40 });
			T = rollTime(to);
			ramp.dur = Math.max(ramp.dur, walkTime(up) + OUT + DOWN + 0.3);
		});
		const off = () => ramp.dur - walkTime(up); // where rollOff is as the ramp's shot ends
		let eyeN = V(0, 0, 0);
		const near = beat(3.5, (s) => (rollOff(thing, to, me, off() + s), camLerp(eyeN, thing.position.clone().setY(0.7), 0.15)), () => {
			eyeN = atTruck((Math.sign(truck.worldToLocal(to.clone()).x) || 1) * 4.2, OFF - 2.8).setY(0.9); // low, on its side
			camera.position.copy(eyeN);
			controls.target.copy(thing.position.clone().setY(0.7));
			lensFor({ fov: 44 });
		});
		const ARRIVE = 4.5;
		const there = beat(ARRIVE + 2.5, (s, k) => {
			const at = Math.max(off() + near.dur, T - ARRIVE) + s;
			const done = rollOff(thing, to, me, at);
			after(s, k, done);
			still(wide, done ? wideAt : thing.position.clone().setY(0.8));
		}, () => {
			camera.position.copy(wide);
			controls.target.copy(thing.position.clone().setY(0.8));
			lensFor({ fov: 40 });
		});
		// the voice-over's lines go to the ramp's shot (held on over the push) and to the wide one where it arrives
		near.shot = false;
		return [ramp, near, there];
	}
	/** a shot of a moment: at least min seconds, and as long as the line of the voice-over it carries; its run gets the
	 *  seconds since it began (s), so a walk keeps its pace however long the line holds the shot */
	function beat(min, run, start) {
		const st = { dur: min, shot: true, start, run: (k) => run(k * st.dur, k, st.dur) };
		return st;
	}
	/** one long take cut into shots at the times given (s from its start), each its own line of the voice-over; a
	 *  shot its line holds longer stays on its last frame */
	function cutsOf(total, at, run, start) {
		const ends = [...at, total];
		return ends.map((end, i) => {
			const from = i ? ends[i - 1] : 0;
			return beat(end - from, (s) => run(Math.min(end - 1e-3, from + s)), i ? undefined : start);
		});
	}
	/** the voice-over: one line a shot, in order (more lines than shots: the last carries them all; a null line is a
	 *  shot without words, the picture telling it alone); each shot holds as long as its line takes to tell */
	function told(steps, lines = []) {
		const shots = steps.filter((x) => x.shot);
		lines.forEach((line, i) => {
			const st = shots[Math.min(i, shots.length - 1)];
			if (st && line) st.caption = st.caption ? { title: `${st.caption.title} ${line}` } : { title: line };
		});
		for (const st of shots) if (st.caption) (st.dur = Math.max(st.dur, lineDur(st.caption.title))), (st.caption.dur = st.dur);
		return steps;
	}
	/** a camera standing still, turning to follow what it looks at (a player's head) */
	const still = (eye, at) => camLerp(eye, at, 0.12);
	const head = (p, y = 1.35) => p.position.clone().setY(y);

	/** the arrival, cut like a trailer on the film camera's moves: high over the endless steppe and a van's dust far
	 *  below, pushing on (the road, its first shot; then the ride goes on inside the van); and at the end of the road a
	 *  crane from high down to the van braking where the asphalt ends (cut straight from the face of the first mint: a
	 *  scale smash), the newcomer stepping out, over their shoulder to the green land east, and up over the whole city
	 *  plot. Each shot carries its line of the story (onCaption). */
	function intro(part = 'road', { lines } = {}) {
		placed = true;
		holdRide();
		talkShow(false);
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
		const crane = shot({ kind: 'move', from: [VAN_HALT.x - 30, 95, ROAD_Z - 125], to: [VAN_HALT.x - 64, 2.6, ROAD_Z - 10], aimFrom: [CX, 0, ROAD_Z], aimTo: [VAN_HALT.x - 6, 1.5, ROAD_Z], curve: 'ease' });
		const low = shot({ kind: 'move', from: [STOP.x + 6, 0.9, STOP.z - 5.5], to: [STOP.x + 4.5, 1.1, STOP.z - 4], aimFrom: [VAN_HALT.x, 1.3, VAN_HALT.z], aimTo: [VAN_HALT.x + 1, 1.4, VAN_HALT.z - 1], curve: 'drift' });
		// over the shoulder: the newcomer in the left third, their back to us, the green land opening east
		const GREEN = V(CX + 240, 3, CZ - 70);
		const fdir = GREEN.clone().sub(STOP).setY(0).normalize(), right = V(-fdir.z, 0, fdir.x);
		const sh = (d, side) => arr(STOP.clone().addScaledVector(fdir, -d).addScaledVector(right, side).setY(1.78));
		const shoulder = shot({ kind: 'move', from: sh(2.9, 0.55), to: sh(2.45, 0.5), aimFrom: arr(STOP.clone().addScaledVector(fdir, 80).setY(1.2)), aimTo: arr(STOP.clone().addScaledVector(fdir, 80).setY(1.6)), curve: 'drift' });
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
						face(me, STOP); // out of the door already turned to the stop: never a step backwards
						act(me, 'idle');
					},
					run: (k) => {
						walkOn(me, [door, STOP], Math.max(0, k - 0.08) * 5);
						if (k > 0.85) act(me, 'look up');
						pose(low(k));
					}
				},
				{
					dur: 5,
					caption: { title: 'Land that belongs to everyone who lives on it.', dur: 5 },
					start: () => (me.position.copy(STOP), face(me, GREEN), act(me, 'idle')),
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
					caption: { title: 'Welcome to MaiaCity', sub: 'You are among our very first human founders.', big: true, dur: 6.5 },
					start: () => {
						van.visible = false;
						reveal(2);
						const from = arr(camera.position);
						rise = shot({ kind: 'move', from, to: [CX - 260 * K, 560 * K, CZ - 560 * K], aimFrom: [CX + 240, 3, CZ - 70], aimTo: [CX + 160 * K, 0, CZ + 80 * K], curve: 'ease' });
					},
					run: (k) => pose(rise(k))
				}
			];
		// the road (its first shot, then the ride goes on inside the van while the story tells of what lies ahead), or
		// the arrival at the end of the road (four shots)
		const cut = part === 'road' ? shots.slice(0, 1) : shots.slice(3);
		// the story's own lines, one a shot, in place of the trailer's titles; the last of the arrival stays big, the
		// city's name, the rest of its line under it
		if (lines?.length) {
			cut.forEach((st) => ((st.shot = true), (st.caption = undefined)));
			told(cut, lines);
			const last = cut[cut.length - 1].caption;
			if (part !== 'road' && last) {
				const [, name, rest] = last.title.match(/^(Welcome to MaiaCity)\.?\s*(.*)$/) ?? [];
				if (name) Object.assign(last, { title: name, sub: rest || undefined });
				last.big = true;
			}
		}
		return play(cut, { hour: 8.6 });
	}

	/** the views from in and on the pickup while it drives (its own frame, +z ahead, the driver on the left, +x): over the
	 *  shoulder of the newcomer in it, out through the windscreen to the land ahead (ots); through the windscreen at them
	 *  (screen); from its bed forward through the rear window, the load in front of us (bed) */
	const DRIVE_SHOTS = {
		ots: { inside: true, fov: 54, cam: (k) => truck.localToWorld(V(stage.me === 'A' ? 0.12 : -0.12, 1.62, -0.22 + 0.04 * k)), at: () => truck.localToWorld(V(stage.me === 'A' ? 0.36 : -0.36, 1.25, 14)) },
		screen: { fov: 38, near: 0.1, cam: (k) => truck.localToWorld(V(0.16, 1.72, 5.4 - 0.3 * k)), at: () => truck.localToWorld(V(0.3, 1.52, 0.66)) },
		bed: { inside: true, fov: 58, cam: (k) => truck.localToWorld(V(0.66 - 0.04 * k, 2.3, -2.85)), at: () => truck.localToWorld(V(0.35, 1.45, 3)) }
	};
	const inTruck = (name, k) => {
		const s = DRIVE_SHOTS[name];
		camera.position.copy(s.cam(k));
		camera.lookAt(s.at());
	};
	/** while an invest waits on the way: the pickup rolling slowly on, the camera held in it */
	function cruise() {
		putTruck(cruiseU());
		truck.updateMatrixWorld(true);
		dust(truck, -2.8);
		inTruck(DRIVE_SHOTS[cruiseHold] ? cruiseHold : 'ots', 1);
	}

	/** a drive in the pickup along the track, cut like a film (the script 2026-10-14: every invest on the drive,
	 *  shortly before arriving): to the village (from the station, or fetching me at the stop first) as far as just short
	 *  of the shed; the pull-up at the shed; from the shed on towards home; and onto our hex. Each shot carries its line;
	 *  the cuts skip the middle of the way, so the pickup always drives at a real track speed (SPEED.track) */
	function drive(leg, { fetch = false, lines } = {}) {
		const me = people[stage.me];
		const other = stage.other ? people[stage.other] : null;
		const v = SPEED.track;
		const drivesMe = stage.me === 'A'; // the first player drives; the fetched one sits beside them
		const m = (metres) => metres / TRACK_L;
		let back = false;
		/** the pickup from a to b over the shot (at speed, easing in from a stop, or out to one), and how it heads */
		const roll = (a, b, how, k) => {
			const e = how === 'in' ? k * k : how === 'out' ? 1 - (1 - k) * (1 - k) : k;
			const u = a + (b - a) * e;
			putTruck(u, back);
			truck.updateMatrixWorld(true);
			dust(truck, -2.8);
			const { p, t } = along(u);
			const dir = back ? t.clone().negate() : t;
			return { p, dir, side: V(dir.z, 0, -dir.x) };
		};
		const out = (fov = 40) => lensFor({ fov });
		/** getting in: from where each stands round to their doors and in, the camera holding (eye: on the pickup, x z
		 *  and its height); then the pickup pulls away (pull: metres) */
		const getIn = ({ min = 2.5, pull = 0, at = U_STORE, eye: [ex, ez, ey] = [9, 5, 2.4] } = {}) => {
			let mine = null, theirs = null, t1 = 0, eye = V(0, 0, 0);
			const st = beat(min, (s) => {
				if (me.parent !== truck && walkOn(me, mine, s)) climbIn(me, drivesMe ? 'driver' : 'passenger', (s - walkTime(mine)) / GET_IN);
				if (theirs && other.parent !== truck && walkOn(other, theirs, s)) climbIn(other, 'driver', (s - walkTime(theirs)) / GET_IN);
				if (pull && s > t1) (inCab(), roll(at, at + m(pull), 'in', Math.min(1, (s - t1) / Math.max(0.1, st.dur - t1))));
				camLerp(eye, pull && s > t1 ? truck.position.clone().setY(1.3) : head(me), 0.15);
			}, () => {
				back = false;
				putTruck(at);
				truck.updateMatrixWorld(true);
				for (const p of [me, other]) if (p) seatOut(p);
				if (stage.me === 'C') seatIn(people.B, 'rearL');
				me.visible = true;
				const door = atTruck(...(drivesMe ? DRIVER : PASSENGER));
				// the passenger goes round the front of the pickup
				const local = truck.worldToLocal(me.position.clone());
				if (fetch && leg === 'village') { me.position.copy(door.clone().add(V(-1.8, 0, 0).applyAxisAngle(V(0, 1, 0), truck.rotation.y))); face(me, door); me.userData.last = null; }
			mine = [me.position.clone(), ...(!fetch && !drivesMe && local.x > 0 ? [atTruck(1.6, 3.4), atTruck(-1.6, 3.4)] : []), door];
				theirs = other && other.visible && (stage.rides || fetch) ? [other.position.clone(), atTruck(...DRIVER)] : null;
				t1 = Math.max(walkTime(mine), theirs ? walkTime(theirs) : 0) + GET_IN + 0.3;
				st.dur = Math.max(st.dur, t1 + (pull ? 3.2 : 0.6));
				eye = atTruck(ex, ez).setY(ey);
				camera.position.copy(eye);
				controls.target.copy(head(me));
				out(40);
			});
			return st;
		};
		/** low at the roadside, the grass close in front, the pickup passing (u0: where it is as the shot begins) */
		const roadside = (u0) => {
			let fixed = V(0, 0, 0);
			const st = beat(4.5, (s, k) => {
				const { p } = roll(u0, u0 + m(v * st.dur), 'run', k);
				camLerp(fixed, p.clone().setY(1.1), 0.35);
			}, () => {
				const mid = along(u0 + m(v * st.dur * 0.5));
				const side = V(mid.t.z, 0, -mid.t.x);
				inCab();
				fixed = mid.p.clone().addScaledVector(side, 6.5).addScaledVector(mid.t, 4).setY(0.55);
				camera.position.copy(fixed);
				controls.target.copy(along(u0).p.clone().setY(1.1));
				foreAt(fixed, mid.p, 1.1);
				out(44);
			});
			return st;
		};
		const steps = [];
		if (leg === 'village') {
			const from = U_START, to = U_NEAR.shed, span = to - from;
			if (fetch) {
				// the first player comes for me in the pickup, down the track to the stop, me waving as it nears
				let eye = V(0, 0, 0);
				steps.push(beat(5, (s, k) => {
					const { p } = roll(U_START + m(50), U_START, 'out', k);
					face(me, truck.position);
					act(me, k > 0.4 ? 'wave' : 'idle');
					camLerp(eye, p.clone().setY(1.4), 0.2);
				}, () => {
					back = true;
					if (other) seatIn(other, 'driver');
					if (stage.me === 'C') seatIn(people.B, 'rearL');
					me.visible = true;
					me.position.copy(STOP);
					eye = STOP.clone().add(V(-6, 2.2, -4.5));
					camera.position.copy(eye);
					controls.target.copy(head(me));
					out(40);
				}));
				// round the front and in beside them; then over my shoulder in the cab, the land ahead, whipped away
				steps.push(getIn({ min: 3, at: U_START, eye: [-5.5, 4.5, 1.8] }));
				steps.push(beat(3.5, (s, k, dur) => (inTruck('ots', k), whipCam(s, dur, { out: 0.9 })), () => (putTruck(U_START), inCab(), lensFor(DRIVE_SHOTS.ots))));
			}
			steps.push(
				// high over the land, tracking the pickup, the hex rims faint on the grass (whipped in from the station)
				beat(5, (s, k, dur) => {
					const a = from + span * 0.2;
					const { p, dir, side } = roll(a, a + m(v * dur), 'run', k);
					camera.position.copy(p).addScaledVector(side, 34).addScaledVector(dir, -42).add(V(0, 50, 0));
					camera.lookAt(p.clone().addScaledVector(dir, 24));
					controls.target.copy(p);
					whipCam(s, dur, { into: 0.9 });
				}, () => (inCab(), out(40))),
				roadside(from + span * 0.56),
				// through the windscreen at the wheel, rolling on to just short of the shed
				beat(4.5, (s, k, dur) => (roll(to - m(v * dur), to, 'run', k), inTruck('screen', k)), () => (inCab(), lensFor(DRIVE_SHOTS.screen)))
			);
		} else if (leg === 'pullup') {
			// the pickup pulls up at the shed, the shed beyond it, and everyone gets out
			let a = U_STORE, mine = null, theirs = null, eye = V(0, 0, 0);
			const ARRIVE = 3.2;
			steps.push(beat(8, (s) => {
				const { p } = roll(a, U_STORE, 'out', Math.min(1, s / ARRIVE));
				if (s >= ARRIVE) {
					if (!mine) {
						const rides = other && other.parent === truck;
						me.visible = true;
						mine = [atTruck(...(drivesMe ? DRIVER : PASSENGER)), ...(drivesMe ? [] : [atTruck(-1.6, 3.4), atTruck(1.6, 3.4)]), atTruck(...BESIDE)];
						if (rides) theirs = [atTruck(...DRIVER), atTruck(...BESIDE_2)];
					}
					// out of the cab, then off to the shed
					const t = s - ARRIVE;
					if (t < GET_IN) (climbOut(me, drivesMe ? 'driver' : 'passenger', t / GET_IN), theirs && climbOut(other, 'driver', t / GET_IN));
					else (walkOn(me, mine, t - GET_IN), theirs && walkOn(other, theirs, t - GET_IN));
				}
				camLerp(eye, s < ARRIVE ? p.clone().setY(1.2) : head(me, 1.2), 0.1);
			}, () => {
				a = cruiseU();
				inCab();
				const end = along(U_STORE).p;
				eye = end.clone().add(V(-7, 3.2, 15));
				camera.position.copy(eye);
				controls.target.copy(along(a).p.clone().setY(1.2));
				out(42);
			}));
		} else if (leg === 'tribe') {
			// in, and away from the shed (from its left, as the next shot goes on the same way: a match on motion)
			steps.push(getIn({ min: 3, pull: 16, at: U_STORE }));
			const a0 = U_STORE + (U_NEAR.home - U_STORE) * 0.3;
			steps.push(beat(4.5, (s, k, dur) => {
				const { p, dir, side } = roll(a0, a0 + m(v * dur), 'run', k);
				camera.position.copy(p).addScaledVector(side, 30).addScaledVector(dir, -10).add(V(0, 26, 0));
				camera.lookAt(p.clone().addScaledVector(dir, 12));
				controls.target.copy(p);
			}, () => (inCab(), out(40))));
		} else if (leg === 'home') {
			// high over the edge of our hex, the pickup rolling slowly onto it, tiny (whipped in across the land)
			let a = 0;
			const HIGH = V(-40, 150, 110);
			steps.push(beat(5, (s, k, dur) => {
				const { p } = roll(a, a + m(6 * dur), 'run', k);
				camera.position.copy(HIGH);
				camera.lookAt(controls.target.lerp(p, 0.1));
				whipCam(s, dur, { into: 0.9 });
			}, () => {
				a = cruiseU();
				inCab();
				camera.position.copy(HIGH);
				controls.target.copy(along(a).p);
				out(34);
			}));
			// low in the knee-high grass at the lot: the pickup stops, and you step out into it, looking round
			let mine = null, theirs = null, eye = V(0, 0, 0);
			const STOPS = 2.6;
			steps.push(beat(8.5, (s) => {
				const { p } = roll(1 - m(14), 1, 'out', Math.min(1, s / STOPS));
				if (s >= STOPS + 0.3) {
					if (!mine) {
						const rides = other && other.parent === truck;
						const door = atTruck(...(drivesMe ? DRIVER : PASSENGER));
						me.visible = true;
						const into = V(0, 0, 0).sub(door).setY(0).setLength(3.2);
						mine = [door, door.clone().add(into)];
						if (rides) theirs = [atTruck(...DRIVER), HOME[stage.other]];
					}
					// out of the cab, and a few steps into the grass, looking round
					const t = s - STOPS - 0.3;
					if (t < GET_IN) (climbOut(me, drivesMe ? 'driver' : 'passenger', t / GET_IN), theirs && climbOut(other, 'driver', t / GET_IN));
					else {
						if (walkOn(me, mine, t - GET_IN)) act(me, 'look up');
						if (theirs) walkOn(other, theirs, t - GET_IN);
					}
				}
				still(eye, s < STOPS ? p.clone().setY(1.1) : head(me, 1.35));
			}, () => {
				const end = along(1);
				const side = V(end.t.z, 0, -end.t.x);
				eye = end.p.clone().addScaledVector(end.t, -9).addScaledVector(side, -6.5).setY(0.55);
				camera.position.copy(eye);
				controls.target.copy(end.p.clone().setY(1.1));
				foreAt(eye, end.p, 1.2);
				out(44);
			}));
		}
		return play(told(steps, lines));
	}

	/** off the bus stop and over to the gas station (Samuel 2026-10-13: not standing at the stop for long): from behind
	 *  the stop the newcomer walks to where the village's pickup waits at the pumps; gets in; and at its wheel, over
	 *  their shoulder, the land ahead, whipped away across it into the drive */
	function station({ lines } = {}) {
		const me = people[stage.me];
		let path = [], eye = V(0, 0, 0), eye2 = V(0, 0, 0);
		const away = beat(2, (s) => (walkOn(me, path, s), still(eye, head(me))), () => {
			lensOut();
			putTruck(U_START);
			truck.updateMatrixWorld(true);
			seatOut(me);
			me.visible = true;
			me.position.copy(STOP);
			path = [STOP.clone(), atTruck(2.6, 1.8), atTruck(...DRIVER)];
			eye = STOP.clone().add(STOP.clone().sub(path[1]).setY(0).setLength(5)).add(V(1.2, 2.1, 0));
			camera.position.copy(eye);
			controls.target.copy(head(me));
		});
		const getIn = beat(2, (s) => {
			if (me.parent !== truck && walkOn(me, path, s)) climbIn(me, 'driver', (s - walkTime(path)) / GET_IN);
			still(eye2, me.parent === truck ? truck.localToWorld(V(0.42, 1.5, 0.7)) : head(me));
		}, () => {
			eye2 = atTruck(5.5, 4.2).setY(1.7);
			camera.position.copy(eye2);
			const door = atTruck(...DRIVER);
			const approach = door.clone().add(V(0, 0, 1.5).applyAxisAngle(V(0, 1, 0), truck.rotation.y));
			path = [approach, door];
			me.position.copy(approach); face(me, door); me.userData.last = null;
			getIn.dur = walkTime(path) + GET_IN + 0.3;
		});
		const ots = beat(3.5, (s, k, dur) => (inTruck('ots', k), whipCam(s, dur, { out: 0.9 })), () => (inCab(), lensFor(DRIVE_SHOTS.ots)));
		return play(told([away, getIn, ots], lines));
	}

	/** Four clear beats: supplies, two-person tent, ten litres, all three ready to leave. */
	function loadShelter({ lines } = {}) {
		const me = people.C, helper = people.B;
		const tail = () => atTruck(-.5, -3.3);
		let from, to;
		const carry = (obj, who, s, dur, bed) => {
			const lift=.65, k=Math.min(1,s/dur);
			who.position.lerpVectors(from,to,k); face(who,to); act(who,k<1?'carry+walk':'carry');
			world.attach(obj); obj.position.copy(who.position).add(V(Math.sin(who.rotation.y)*.4,lift,Math.cos(who.rotation.y)*.4));
			if(k>=1){truck.add(obj);obj.position.copy(bed);act(who,'idle');}
		};
		return play(told([
			beat(3, () => still(EXTRA_SHED.clone().add(V(2,1.2,2.8)), EXTRA_SHED.clone().add(V(.4,.3,0))), () => {
				placeShelter('shed'); seatOut(me); seatOut(helper); me.visible=helper.visible=true;
				me.position.copy(EXTRA_SHED.clone().add(V(0,0,1))); helper.position.copy(WATER_SHED.clone().add(V(0,0,1)));
				face(me,EXTRA_SHED);face(helper,WATER_SHED); lensFor({fov:42});
			}),
			beat(4, (s,k,dur) => {carry(secondBag,me,s,dur,EXTRA_BED); still(atTruck(-5,-4).setY(1.7),head(me,1));}, () => {
				from=tail().add(V(-3,0,0));to=tail();me.position.copy(from); me.userData.last=null;
			}),
			beat(3.5, (s,k,dur) => {carry(waterCan,helper,s,dur,WATER_BED); still(atTruck(-3.8,-3.4).setY(1.1),waterCan.getWorldPosition(V(0,0,0)).add(V(0,.2,0)));}, () => {
				from=tail().add(V(-2.5,0,0));to=tail();helper.position.copy(from);helper.userData.last=null;
			}),
			beat(2.5, () => still(atTruck(-4,-5).setY(2.1),truck.position.clone().setY(1.2)), () => {
				stage.shelter='bed'; placeShelter('bed'); inCab();
			})
		],lines));
	}
	/** The two existing settlers help raise a second tent; the original tent is always in the wide shot. */
	function raiseShelter({ lines } = {}) {
		const c=V(SECOND_HOME.x,0,SECOND_HOME.z), me=people.C;
		const wide=()=>still(c.clone().add(V(-11,6,13)),c.clone().add(V(-4,1,0)));
		return play(told([
			beat(3,wide,()=>{
				placeShelter('bed');for(const p of Object.values(people)) seatOut(p);
				world.attach(secondBag);secondBag.position.copy(c.clone().add(V(-1,0,3)));
				for(const [i,p] of Object.values(people).entries()){p.visible=true;p.position.copy(c.clone().add(V((i-1)*2.8,0,3)));face(p,c);act(p,'kneel');}
				lensFor({fov:48});
			}),
			beat(8,(s,k)=>{
				secondHome.visible=true;secondBag.visible=false;shelterPitch(k);
				for(const p of Object.values(people)){face(p,c);act(p,k<.35?'kneel':k<.8?'reach':'idle');}
				wide();
			}),
			beat(3,(s,k)=>{
				waterCan.position.lerpVectors(WATER_HOME.clone().add(V(0,.65,0)),WATER_HOME,k);
				still(WATER_HOME.clone().add(V(2,1.1,2)),WATER_HOME.clone().add(V(0,.25,0)));
			},()=>{
				world.attach(waterCan);me.position.copy(WATER_HOME.clone().add(V(0,0,.7)));face(me,WATER_HOME);act(me,'kneel');
			}),
			beat(3.5,wide,()=>{stage.shelter='home';placeShelter('home');for(const p of Object.values(people))act(p,'idle');})
		],lines));
	}

	/** loading at the village's shed (the script 2026-10-14): from inside the shed, the newcomer walking in against the
	 *  daylight; a slow dolly along the machines; side on as the ElectroCube goes up the ramp into the bed, big in the
	 *  frame; the packed tent carried over and swung in. The second loads the BatteryCube and the solar panel, which
	 *  stand beside the shed */
	function load({ lines, what } = {}) {
		if (what === 'shelter') return loadShelter({ lines });
		const me = people[stage.me];
		truck.updateMatrixWorld(true);
		const power = what === 'power';
		const P = power
			? { push: battery, from: BATT_AT.clone().setY(0.02), carry: solar, carryAt: PANEL_AT, carryTo: PANEL_ON_BED, lift: 0.3, ahead: 0.95, turn: Math.PI / 2, setup: () => placeBattery('store'), mid: () => {}, end: () => ((stage.battery = 'bed'), placeBattery('bed')) }
			: { push: cube, from: CUBE_IN_SHED.clone(), carry: bundle, carryAt: TENT_IN_SHED, carryTo: TENT_ON_BED, lift: 0.85, ahead: 0.4, turn: 0, setup: () => (placeCube('shed'), placeTent('shed')), mid: () => ((stage.cube = 'bed'), placeCube('bed')), end: () => ((stage.tent = 'bed'), placeTent('bed'), rampOut(false)) };
		const tail = atTruck(0, -3.9);
		const yawTo = truck.rotation.y + P.turn; // the bag across the bed, the panel along it
		const behind = P.from.clone().setY(0).add(P.from.clone().setY(0).sub(tail).setY(0).setLength(1.2));
		let walkIn = [], eye = V(0, 0, 0), d0, d1, l0, l1, eye26, look26, toTail = [], camOff = V(0, 0, 0);
		return play(told([
			// 24: from inside the shed, you walk in against the daylight (the second: from behind the BatteryCube)
			beat(4.5, (s) => (walkOn(me, walkIn, s), still(eye, head(me))), () => {
				P.setup();
				me.visible = true;
				const from = behind.clone().add(tail.clone().sub(behind).setY(0).setLength(6.5));
				me.position.copy(from);
				walkIn = [from, behind];
				eye = power ? behind.clone().add(behind.clone().sub(tail).setY(0).setLength(4)).setY(1.5) : V(STORE.x + 1.7, 1.45, STORE.z - 1.55);
				camera.position.copy(eye);
				controls.target.copy(head(me));
				lensFor({ fov: 46, near: 0.1 });
			}),
			// 25: a slow dolly along the machines
			beat(5, (s, k) => {
				me.position.copy(behind);
				face(me, P.from);
				act(me, 'idle');
				camera.position.lerpVectors(d0, d1, k);
				camera.lookAt(l0.clone().lerp(l1, k));
			}, () => {
				if (power) [d0, d1, l0, l1] = [BATT_AT.clone().add(V(-3, 1.3, 3.4)), PANEL_AT.clone().add(V(1.2, 1.3, 3.4)), BATT_AT.clone().setY(0.7), PANEL_AT.clone().setY(0.6)];
				else [d0, d1, l0, l1] = [V(STORE.x - 2.3, 1.3, STORE.z + 1.4), V(STORE.x + 1.9, 1.3, STORE.z + 1.4), V(STORE.x - 1.5, 0.5, STORE.z + 0.3), V(STORE.x + 0.8, 0.6, STORE.z - 0.8)];
				lensFor({ fov: 48, near: 0.1 });
			}),
			// 26: side on, the ramp in profile: the last of the way to its foot, then up it into the bed, big in the frame
			beat(6.5, (s) => {
				// along the pickup: from 2.4 m short of the ramp's foot to it, up the ramp to its lip, on over the tailgate
				// into the bed, tipped to the slope while it is on it
				const z = s < 2.2 ? FOOT_Z - 2.4 * (1 - s / 2.2) : s < 4.8 ? FOOT_Z + RAMP.run * ease((s - 2.2) / 2.6) : LIP_Z + (CUBE_ON_BED.z - LIP_Z) * ease(Math.min(1, (s - 4.8) / 0.9));
				P.push.position.copy(truck.localToWorld(V(0, rampY(z), z)));
				tipOn(P.push, Math.PI / 2, rampTip(z));
				// behind it, pushing: up the ramp after it, as far as its top
				const zm = Math.min(z - 0.95, LIP_Z - 0.45);
				me.position.copy(truck.localToWorld(V(0, rampY(zm), zm)));
				me.rotation.y = truck.rotation.y;
				act(me, s >= 5.7 ? 'idle' : zm < z - 0.95 ? 'push' : 'push+walk');
				still(eye26, look26);
			}, () => {
				rampOut(true);
				eye26 = truck.localToWorld(V(5.8, 1.35, -4.3));
				look26 = truck.localToWorld(V(0, 1.1, -4.1)); // high enough for them on the ramp, the bed's floor at 1.16 m
				camera.position.copy(eye26);
				controls.target.copy(look26);
				lensFor({ fov: 40 });
			}),
			{ dur: 0.1, start: () => P.mid() },
			// 27: the tent carried over and swung up into the bed (the second: the solar panel)
			beat(4.5, (s) => {
				const there = walkOn(me, toTail, s, 'carry');
				const lift = there ? Math.min(1, (s - walkTime(toTail)) / 0.8) : 0;
				const arms = me.position.clone().add(V(Math.sin(me.rotation.y), 0, Math.cos(me.rotation.y)).multiplyScalar(P.ahead)).setY(P.lift);
				const to = truck.localToWorld(P.carryTo.clone());
				if (!there) (P.carry.position.copy(arms), (P.carry.rotation.y = me.rotation.y + P.turn));
				else {
					P.carry.position.lerpVectors(arms, to, ease(lift)).setY(arms.y + (to.y - arms.y) * ease(lift) + Math.sin(Math.PI * lift) * 0.6);
					P.carry.rotation.y = me.rotation.y + P.turn + (yawTo - me.rotation.y - P.turn) * ease(lift);
					act(me, lift < 1 ? 'carry' : 'idle');
				}
				camLerp(me.position.clone().add(camOff), head(me, 1.1), 0.1);
			}, () => {
				ramp.visible = false; // put away; the tailgate stays down to swing the load in over it
				world.attach(P.carry);
				const at = atTruck(0.6, -3.3);
				const from = at.clone().add(P.carryAt.clone().setY(0).sub(at).setY(0).setLength(4.4));
				me.position.copy(from);
				toTail = [from, at];
				const d = at.clone().sub(from).normalize();
				// from the side away from the pickup, a little ahead of them
				const sd = V(d.z, 0, -d.x);
				if (sd.dot(truck.position.clone().sub(at).setY(0)) > 0) sd.negate();
				camOff = sd.multiplyScalar(3.4).addScaledVector(d, 1.2).setY(1.55);
				camera.position.copy(me.position.clone().add(camOff));
				controls.target.copy(head(me, 1.1));
				lensFor({ fov: 42 });
			}),
			{ dur: 0.1, start: () => P.end() }
		], lines));
	}

	/** the bell tent pitched by one person, worked out beforehand, a frame every 1/30 s: they walk to each piece in turn
	 *  (the tent's own work points, userData.work) at a brisk pace, round the tent's ring once anything stands on it, in
	 *  by its door at the end, and stay at each piece as long as it takes; the pitch (e) moves on only while they are at
	 *  it. Each phase: the stretch of e it covers and the seconds of work in it. In the tent's own frame */
	const PITCH_PACE = 1.8;
	const PITCH_DT = 1 / 30;
	function pitchPlan(from) {
		const { R, steps: S } = BELL_TENT;
		const part = (st, a, b) => [st[0] + (st[1] - st[0]) * a, st[0] + (st[1] - st[0]) * b];
		const span = (e, [a, b]) => (e - a) / (b - a);
		const PHASES = [
			[...part(S.groundsheet, 0, 0.7), 3], // unfolded from the door, across and back
			[...part(S.groundsheet, 0.7, 1), 3.6], // its 12 pegs
			[...S.canvas, 1.8],
			[...S.pole, 3],
			[...part(S.wall, 0, 0.6), 3.5], // 10 wall poles stood under the eave
			[...part(S.wall, 0.6, 1), 4.5], // 18 wall pegs
			[...S.guys, 4.5],
			[...S.door, 1.4],
			[...S.inside, 4.4]
		];
		const rate = (e) => {
			for (const [a, b, sec] of PHASES) if (e < b) return (b - a) / sec;
			return 1;
		};
		const RING = R + 0.42; // where they walk round it, and stand at a peg or a pole
		/** where they stand for the piece being worked on at e (w, its work point), what they look at, what they do,
		 *  and whether the work goes on as they follow it (a sheet drawn out, a pole walked up) */
		function job(e, w) {
			const r = Math.hypot(w.x, w.z), out = r > 1e-3 ? V(w.x / r, 0, w.z / r) : V(0, 0, 1);
			const ring = (rr, side = 0) => out.clone().multiplyScalar(rr).add(V(out.z, 0, -out.x).multiplyScalar(side));
			if (e < S.groundsheet[1]) {
				const gs = span(e, S.groundsheet);
				if (gs < 0.35) return { at: V(0, 0, R + 0.4), look: V(0, 0, 0), act: 'press', follow: true };
				if (gs < 0.7) return { at: V(0, 0, Math.max(-R - 0.35, w.z - 0.35)), look: V(0, 0, R), act: 'press', follow: true, face: true, free: true };
				return { at: ring(RING), look: w, act: 'press' };
			}
			if (e < S.canvas[1]) return { at: V(0.55, 0, R + 0.4), look: w, act: 'press', follow: true };
			if (e < S.pole[1]) return w.z > R - 0.2 ? { at: V(0, 0, w.z + 0.5), look: V(0, 0, 0), act: 'press', follow: true, face: true } : { at: V(0, 0, R + 0.4), look: V(0, 1.5, 0), act: 'reach', follow: true };
			if (e < S.wall[1]) return { at: ring(RING), look: ring(R), act: 'press' };
			if (e < S.guys[1]) return { at: ring(R + 1.25, 0.3), look: ring(R + 1.5), act: 'press' };
			if (e < S.door[1]) return { at: V(0, 0, R + 0.45), look: V(0, 1.3, R), act: 'reach', follow: true };
			// in by the door: kneeling to put each thing down, the lantern last, hung on the pole
			if (span(e, S.inside) >= 8 / 9) return { at: V(0.32, 0, 0.42), look: V(0, 1.8, 0), act: 'reach', free: true };
			return { at: w.z < 0 ? V(0.45, 0, -0.45) : V(0.4, 0, 1), look: w, act: 'press', free: true };
		}
		/** a step of d towards `to`: round the ring when the straight way runs through the tent */
		function stepTo(p, to, d, free) {
			let dx = to.x - p.x, dz = to.z - p.z;
			const len = Math.hypot(dx, dz);
			if (len <= d) return void p.set(to.x, 0, to.z);
			const rp = Math.hypot(p.x, p.z);
			const tt = Math.max(0, Math.min(1, -(p.x * dx + p.z * dz) / (len * len)));
			if (!free && rp > RING - 0.25 && Math.hypot(p.x + dx * tt, p.z + dz * tt) < RING - 0.02) {
				const ap = Math.atan2(p.x, p.z), turn = Math.sign(Math.atan2(Math.sin(Math.atan2(to.x, to.z) - ap), Math.cos(Math.atan2(to.x, to.z) - ap))) || 1;
				dx = Math.cos(ap) * turn + (RING - rp) * 2 * Math.sin(ap);
				dz = -Math.sin(ap) * turn + (RING - rp) * 2 * Math.cos(ap);
			}
			const n = Math.hypot(dx, dz);
			p.x += (dx / n) * d;
			p.z += (dz / n) * d;
		}
		const frames = [];
		const p = home.worldToLocal(from.clone()).setY(0);
		let e = 0, yaw = Math.atan2(-p.x, -p.z);
		for (let i = 0; i < 9000 && e < 1; i++) {
			const w = tentWork(e), j = job(e, V(w.x, w.y, w.z));
			const d = Math.hypot(j.at.x - p.x, j.at.z - p.z);
			let what = j.act;
			if (d > 0.06) {
				const was = p.clone();
				stepTo(p, j.at, PITCH_PACE * PITCH_DT, j.free);
				if (!j.face && p.distanceTo(was) > 1e-4) yaw = Math.atan2(p.x - was.x, p.z - was.z);
				what = 'walk';
			}
			if (d <= (j.follow ? 0.9 : 0.06)) e = Math.min(1, e + rate(e) * PITCH_DT);
			if (what !== 'walk' || j.face) {
				const lx = j.look.x - p.x, lz = j.look.z - p.z;
				if (Math.hypot(lx, lz) > 0.15) yaw = Math.atan2(lx, lz);
			}
			frames.push({ e, x: p.x, z: p.z, yaw, act: what });
		}
		return frames;
	}

	/** pitching the tent at the middle of our hex: the bag carried off the pickup and opened beside where it will stand;
	 *  then the bell tent pitched piece by piece, one short shot a step, the time between them cut out (the groundsheet
	 *  drawn out and pegged, the canvas spread, the pole walked up, the wall poles stood and pegged, the guy ropes run
	 *  out and tightened, the door rolled back, the things brought in and the lantern hung); its fire place built in
	 *  front of it; then, held wide, the ElectroCube rolled down to its yard and its cable laid to the tent while the
	 *  afternoon goes (a time-lapse), the tent glowing from within at dusk and the fire lit */
	function pitch({ lines, what } = {}) {
		if (what === 'power') return setUp({ lines });
		if (what === 'shelter') return raiseShelter({ lines });
		const me = people[stage.me];
		truck.updateMatrixWorld(true);
		const { R, steps: S } = BELL_TENT;
		// the bag set down at the tent's door side, clear of where its canvas and its fire place will be; where they
		// kneel to open it (it unrolls across z, 1.6 m wide)
		const BAG_AT = V(-1.15, 0, 3), KNEEL = V(-1.15, 0, 4.2);
		const OPEN = 1.6; // its straps undone and its canvas unrolled, before the groundsheet comes out of it
		let toTail = [], toLay = [];
		const yard = V(YARD.x, 0, YARD.z);
		const h0 = stage.hour ?? 14.2;
		const DUSK = 16.7;
		const WIDE = V(YARD.x - 4.5, 3.6, YARD.z + 15.5), WIDE_AT = V(6, 0.9, -2);
		// the ElectroCube off the pickup and pushed to its place by the tent; its cable to the tent, and the tent lit from
		// within as the light goes
		const offShots = unload(cube, yard, me, {
			wide: WIDE,
			wideAt: WIDE_AT,
			after: (s, k, done) => {
				if (moment) moment.hour = h0 + 0.2 + (DUSK - h0 - 0.2) * ease(k);
				if (done && !lit) ((lit = true), (cubeCable.visible = true));
			}
		});
		// the pitching, worked out from where they kneel; one window of it a step, each its own shot
		const plan = pitchPlan(KNEEL);
		const T = plan.length * PITCH_DT;
		const tOf = (e0) => (plan.findIndex((f) => f.e >= e0) + 1 || plan.length) * PITCH_DT;
		const L = (x, y, z) => home.localToWorld(V(x, y, z));
		/** a shot that sees the worker from outside the tent, beside where they work: out from the pole through them,
		 *  then aside along the wall */
		const beside = (f, out, side, y, aimY) => {
			const r = Math.hypot(f.x, f.z) || 1, ux = f.x / r, uz = f.z / r;
			return { eye: L(f.x + ux * out + uz * side, y, f.z + uz * out - ux * side), at: L(f.x * 0.7, aimY, f.z * 0.7) };
		};
		const WINDOWS = [
			{ from: tOf(0.001) - 0.3, len: 3.6, fov: 46, cam: () => ({ eye: L(3.4, 3.4, 5.6), at: L(0, 0, 0.2) }) },
			{ from: tOf(S.canvas[0]) - 0.4, len: 2.2, fov: 44, cam: () => ({ eye: L(2.8, 1.8, 5.4), at: L(0, 0.2, 1.1) }) },
			{ from: tOf(S.pole[0]), len: 3.4, fov: 44, cam: () => ({ eye: L(4.8, 1.2, 6.4), at: L(0, 1.4, 0.4) }) },
			{ from: tOf(S.wall[0]), len: 3.2, fov: 46, cam: (f) => beside(f, 4.4, 2.2, 1.7, 0.6) },
			{ from: tOf(S.guys[0]) - 0.3, len: 3.2, fov: 44, cam: (f) => beside(f, 3, -2, 1.6, 0.9) },
			{ from: tOf(S.door[0]) - 0.2, len: 1.6, fov: 42, cam: () => ({ eye: L(1.7, 1.5, R + 3.4), at: L(0, 1.1, R) }) },
			// in the tent with them, from its back under the canvas, the pole aside and the door's light beyond them, the
			// lantern lighting up at the end
			{ from: T - 3.6, len: 3.6, fov: 66, near: 0.05, cam: () => ({ eye: L(0.75, 1.45, -1), at: L(0.2, 1.2, 1) }) }
		];
		let start = OPEN;
		for (const w of WINDOWS) ((w.from = Math.max(0, Math.min(T - w.len, w.from))), (w.at = start), (start += w.len));
		const FIRE = 3.2, LOOK = 1.8;
		const RAISE = start + FIRE + LOOK;
		const FIRE_KNEEL = V(BELL_TENT.fire.x + 0.75, 0, BELL_TENT.fire.z - 0.6);
		/** the tent and its bag at pitch e: what was in the bag goes into the tent as each step takes it */
		const pitchTo = (e) => {
			setPitch(e);
			// the backpack off and put down in the tent as the packs' turn comes (the tent's own stand in for ours)
			const me = people[stage.me], pk = packs[stage.me], down = packsIn();
			if (down && !pk.userData.inTent) ((me.userData.pack.visible = false), packInTent(stage.me));
			else if (!down && pk.userData.inTent) ((pk.visible = false), (pk.userData.inTent = false), (me.userData.pack.visible = true));
			const parts = bagParts();
			if (parts.canvas) {
				parts.groundsheet.visible = e <= S.groundsheet[0];
				parts.canvas.visible = e < S.canvas[0];
				parts.pole.visible = e < S.pole[0];
				parts.wallPoles.visible = e < S.wall[0];
				parts.pegs.visible = e < S.guys[1];
			}
		};
		let shown = -1;
		return play(told([
			beat(6, (s) => {
				const t1 = walkTime(toTail);
				walkOn(me, toTail, s);
				if (s >= t1 && s < t1 + 0.7) {
					act(me, 'carry');
					bundle.position.lerpVectors(truck.localToWorld(TENT_ON_BED.clone()), me.localToWorld(V(0, 0.85, 0.4)), ease((s - t1) / 0.7));
				} else if (s >= t1 + 0.7) {
					const t2 = t1 + 0.7 + walkTime(toLay);
					const there = walkOn(me, toLay, s - t1 - 0.7, 'carry');
					// carried across their arms; there, set down beside them as they kneel
					bundle.position.copy(me.localToWorld(V(0, 0.85, 0.4)));
					bundle.rotation.y = me.rotation.y;
					if (there) {
						act(me, 'kneel');
						const d = ease(Math.min(1, (s - t2) / 0.6));
						bundle.position.lerp(BAG_AT, d);
						bundle.rotation.y += Math.atan2(Math.sin(-bundle.rotation.y), Math.cos(-bundle.rotation.y)) * d;
					}
				}
				camLerp(me.position.clone().add(V(2.6, 1.55, 3)), head(me, 1.0), 0.08);
			}, () => {
				world.attach(bundle);
				me.visible = true;
				toTail = [me.position.clone(), atTruck(...TAIL)];
				toLay = [toTail[1], KNEEL];
				camera.position.copy(me.position.clone().add(V(2.6, 1.55, 3)));
				controls.target.copy(head(me));
				lensFor({ fov: 44 });
			}),
			// the bag opened; the tent pitched step by step, one shot each (WINDOWS); the fire place built; they stand back
			...cutsOf(RAISE, [WINDOWS[2].at, WINDOWS[4].at, start], (s) => {
				if (s < OPEN) {
					openBag(s / OPEN);
					pitchTo(0);
					(me.position.copy(KNEEL), face(me, BAG_AT), act(me, 'press'));
					return void camLerp(KNEEL.clone().add(V(1.9, 1.3, 1.6)), BAG_AT.clone().setY(0.2), 0.12);
				}
				openBag(1);
				const i = WINDOWS.findIndex((w) => s < w.at + w.len);
				if (i >= 0) {
					const w = WINDOWS[i];
					const f = plan[Math.min(plan.length - 1, Math.round((w.from + s - w.at) / PITCH_DT))];
					pitchTo(f.e);
					fire.visible = false;
					me.position.copy(L(f.x, 0, f.z));
					me.rotation.y = home.rotation.y + f.yaw;
					act(me, f.act);
					if (i !== shown) {
						// a cut: the shot framed on where they are in the middle of it
						shown = i;
						const mid = plan[Math.min(plan.length - 1, Math.round((w.from + w.len / 2) / PITCH_DT))];
						w.shot = w.cam(mid);
						lensFor({ fov: w.fov, near: w.near });
					}
					// a slow push in over each shot
					const u = (s - w.at) / w.len;
					camera.position.lerpVectors(w.shot.eye, w.shot.at, 0.08 * u);
					controls.target.copy(w.shot.at);
					return void camera.lookAt(w.shot.at);
				}
				pitchTo(1);
				fire.visible = true;
				if (s < start + FIRE) {
					// the fire place: the stones set round, the woodpile stacked, the logs laid, the chairs unfolded
					buildFire(0.86 * ease((s - start) / FIRE));
					(me.position.copy(FIRE_KNEEL), face(me, fire.position), act(me, 'press'));
					const eye = V(BELL_TENT.fire.x + 2.9, 1.2, BELL_TENT.fire.z + 3), at = fire.position.clone().setY(0.35);
					if (shown !== 'fire') ((shown = 'fire'), lensFor({ fov: 42 }), camera.position.copy(eye), controls.target.copy(at));
					return void still(eye, at);
				}
				// stood back, looking at it
				buildFire(0.86);
				me.position.set(BELL_TENT.fire.x + 1.8, 0, BELL_TENT.fire.z + 1.2);
				face(me, V(0, 1.4, 0));
				act(me, 'idle');
				if (shown !== 'look') {
					shown = 'look';
					lensFor({ fov: 42 });
					camera.position.copy(V(5, 1.9, 9.6));
					controls.target.copy(V(0.2, 1.2, 1.2));
				}
				still(V(4.8, 1.85, 9.3), V(0.2, 1.2, 1.2));
			}, () => {
				world.attach(bundle);
				bundle.position.copy(BAG_AT);
				bundle.rotation.set(0, 0, 0);
				for (const o of Object.values(bagParts())) o.visible = true;
				home.visible = true;
				fire.visible = false;
				buildFire(0);
				pitchTo(0);
				shown = -1;
				camera.position.copy(KNEEL.clone().add(V(1.9, 1.3, 1.6)));
				controls.target.copy(BAG_AT.clone().setY(0.2));
				lensFor({ fov: 44 });
			}),
			{ dur: 0.1, start: () => ((stage.tent = 'up'), placeTent('up'), lensOut()) },
			...offShots,
			{ dur: 0.4, start: () => ((stage.cube = 'home'), placeCube('home'), rampOut(false), act(me, 'idle'), me.position.setY(0), moment && (moment.hour = DUSK)), run: () => still(WIDE, WIDE_AT) }
		], lines), { hour: h0 });
	}
	/** the second player's setting up at home: the BatteryCube down the ramp and pushed beside the ElectroCube, the solar
	 *  panel carried to face the sun, then one cable from the panel to the BatteryCube and on to the tent, the afternoon
	 *  going as they work (a time-lapse) */
	function setUp({ lines } = {}) {
		const me = people[stage.me];
		truck.updateMatrixWorld(true);
		const eye = V(YARD.x - 13, 5.5, YARD.z + 15);
		const front = (d) => me.position.clone().add(V(Math.sin(me.rotation.y), 0, Math.cos(me.rotation.y)).multiplyScalar(d));
		const h0 = stage.hour ?? 14.2;
		const DUSK = 16.7;
		let toTail = [], toPanel = [];
		return play(told([
			// the BatteryCube off the pickup and pushed beside the ElectroCube
			...unload(battery, BATT_HOME, me, { wide: eye, wideAt: BATT_HOME.clone().setY(1) }),
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
				ramp.visible = false; // put away; the tailgate stays down till the panel is off it
				world.attach(solar);
				toTail = [me.position.clone().setY(0), atTruck(0.6, -3.3)];
				toPanel = [atTruck(0.6, -3.3), PANEL_HOME.clone().add(V(0, 0, 1.6))];
			}),
			beat(5, (s, k) => {
				if (moment) moment.hour = h0 + 0.3 + (DUSK - h0 - 0.3) * ease(k);
				cables.visible = k > 0.35;
				if (k > 0.5) lit = true;
				if (s < 1.6) walkOn(me, [me.position.clone(), BATT_HOME.clone().add(V(-0.9, 0, 0.6))], s);
				else (face(me, BATT_HOME), act(me, k < 0.75 ? 'kneel' : 'idle'));
				still(V(YARD.x - 11, 4.2, YARD.z + 14), V(YARD.x - 2.5, 0.8, YARD.z + 1));
			}),
			{ dur: 0.3, start: () => ((stage.battery = 'home'), placeBattery('home'), (lit = true), act(me, 'idle'), moment && (moment.hour = DUSK)) }
		], lines), { hour: h0 });
	}

	/** the earth dug where the first tree will grow and its plant stake pressed in beside it (Samuel 2026-10-14),
	 *  kneeling at the spot, close */
	function markIt({ x, z }) {
		const me = people[stage.me];
		const S = { x, z }, L = spotAt(S);
		return play([
			beat(3.4, (s, k) => {
				const { stake } = myKit.userData;
				stake.visible = k > 0.2;
				stake.position.y = STAKE_AT.y + 0.32 * (1 - ease(Math.min(1, Math.max(0, (k - 0.25) / 0.4))));
				camera.position.copy(L(0.95 - 0.06 * k, 0.55, 1.0 - 0.05 * k));
				camera.lookAt(L(0.08, 0.32, -0.05));
			}, () => {
				lensFor({ fov: 40, near: 0.05 });
				myKit.position.set(x, 0, z);
				myKit.rotation.y = spotYaw(S);
				labelKit(myKit, stage.name, '');
				myKit.userData.setWet(0);
				myKit.visible = true;
				seatOut(me);
				me.visible = true;
				me.position.copy(L(0, 0, -0.55));
				me.rotation.y = spotYaw(S);
				act(me, 'press');
				core.visible = marker.visible = false;
			}),
			{ dur: 0.05, start: () => ((myKit.userData.stake.visible = true), myKit.userData.stake.position.copy(STAKE_AT), act(me, 'kneel')) }
		], { keep: true });
	}
	/** the seed into the dug earth beside the stake, its flag tied on with the tree's name and its plant, watered from
	 *  the bottle (Samuel 2026-10-14): kneeling to press it in; the bottle pouring, the earth darkening; close on the wet
	 *  earth, nothing showing yet */
	function sow({ lines } = {}) {
		const me = people[stage.me];
		const S = stage.spot;
		if (!S) return Promise.resolve();
		const L = spotAt(S);
		const pk = packs[stage.me];
		const { setWet } = myKit.userData;
		// the seed from the packet in their fingers, down into the hollow and pressed under: from the side, kneeling at
		// it, then close on the earth as it goes in (Samuel 2026-10-14: the planting was not seen, and oddly framed)
		const hand = me.userData.cast.rig.bones.handR ?? me, IN = L(0, 0.025, 0); // on the hollow's floor, 2 cm up (in their hand: them, until they are here)
		const seedAt = (k) => {
			// in the hand, then down to the hollow (k 0.35 … 0.75), then pressed in out of sight
			const from = hand.localToWorld(V(0, -0.06, 0.02));
			const e = ease(Math.min(1, Math.max(0, (k - 0.35) / 0.4)));
			seed.position.lerpVectors(from, IN, e).y -= 0.03 * Math.max(0, (k - 0.8) / 0.2);
			seed.visible = k < 0.97;
		};
		return play(told([
			beat(3, (s, k) => {
				act(me, 'press');
				seedAt(Math.min(1, k * 1.25));
				camera.position.copy(L(-1.55 + 0.1 * k, 1.15 - 0.04 * k, 0.75 - 0.05 * k));
				camera.lookAt(L(0, 0.58 - 0.05 * k, -0.3));
			}, () => {
				lensFor({ fov: 50, near: 0.05 });
				placeKit();
				myKit.visible = true;
				setWet(0);
				me.visible = true;
				me.position.copy(L(0, 0, -0.55));
				me.rotation.y = spotYaw(S);
				act(me, 'press');
				seed.scale.setScalar((SEED_CM[stage.pick] ?? 1.2) / 2);
				world.add(seed);
			}),
			beat(2.4, (s, k) => {
				// down onto the earth, a moment lying in the hollow, then pressed under
				const e = ease(Math.min(1, k / 0.35)), under = ease(Math.min(1, Math.max(0, (k - 0.6) / 0.3)));
				seed.visible = k < 0.92;
				seed.position.copy(L(0, 0.09 - 0.065 * e - 0.02 * under, 0));
				camera.position.copy(L(-0.15, 0.15, 0.15 - 0.015 * k));
				camera.lookAt(L(0, 0.025, 0));
			}, () => (lensFor({ fov: 30, near: 0.02 }), act(me, 'press'))),
			beat(3.2, (s, k) => pourAt(L, S, k, pk.userData.bottle, setWet, me), () => (world.attach(pk.userData.bottle), lensFor({ fov: 36, near: 0.05 }))),
			// close on the wet earth, then up the stake to its flag: the tree's name and its plant (the line: it carries
			// your name now)
			beat(3.5, (s, k) => {
				const e = ease(Math.min(1, Math.max(0, (k - 0.15) / 0.45)));
				camera.position.copy(L(0.4 - 0.22 * e, 0.36 + 0.47 * e, 0.34 - 0.05 * e));
				camera.lookAt(L(0.15 * e, 0.05 + 0.78 * e, -0.02 - 0.1 * e));
			}, () => {
				pour.visible = false;
				seed.visible = false;
				stowBottle(pk);
				setWet(1);
				act(me, 'kneel');
			})
		], lines), { keep: true }); // the flag held till the next shot, while the tree is planted in the game
	}
	/** the bottle in the hand, its cap off, tipped over the seed, the water running down, the earth darkening (L: the
	 *  spot's frame; wet: how wet the earth gets, or none) */
	function pourAt(L, S, k, bottle, wet, me) {
		const tip = ease(Math.min(1, k / 0.25));
		bottle.userData.cap.visible = false;
		bottle.position.copy(L(0.04, 0.36, -0.15));
		bottle.rotation.set(0, spotYaw(S), 0);
		bottle.rotateX(2.1 * tip);
		bottle.updateMatrixWorld(true);
		const mouth = bottle.localToWorld(bottle.userData.mouth.clone());
		pour.visible = tip > 0.9 && k < 0.92;
		pour.position.copy(mouth);
		pour.scale.set(1, Math.max(0.01, mouth.y - 0.01), 1);
		wet?.(Math.min(1, Math.max(0, (k - 0.3) / 0.55)));
		act(me, 'pour');
		camera.position.copy(L(0.46, 0.42, 0.2));
		camera.lookAt(L(0.02, 0.12, -0.05));
	}
	/** A locked close-up of the saved before/after growth, built before the camera starts. */
	async function waterTree(seat, onWatered = () => Promise.resolve()) {
		const me = people[seat], before = trees[seat];
		if (!before || busy || !me) return;
		const saved = { eye: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near };
		await onWatered(); // the next stage must be ready before its growth is shown
		const g = trees[seat];
		if (!g) return;
		const bounds = g.userData.bounds?.clone() ?? new THREE.Box3(V(-0.1, 0, -0.1), V(0.1, 0.3, 0.1));
		if (before.userData.bounds) bounds.union(before.userData.bounds);
		g.updateWorldMatrix(true, false);
		const { eye, target } = growthFrame(bounds, g.matrixWorld, saved.eye, camera.aspect);
		const hold = () => { camera.position.copy(eye); camera.lookAt(target); };
		const S = { x: g.position.x, z: g.position.z }, L = spotAt(S);
		world.attach(waterCan);
		try {
			await play([
				beat(3.2, (s, k) => {
					waterCan.position.copy(L(0.16, 0.55, -0.15));
					waterCan.rotation.set(0, spotYaw(S), 0);
					waterCan.rotateZ(-1.3 * Math.sin(Math.PI * k));
					pour.visible = k > 0.2 && k < 0.85;
					pour.position.copy(L(0, 0.3, 0)); pour.scale.set(1, 0.3, 1);
					act(me, 'pour'); hold();
				}, () => {
					lensFor({ fov: 42, near: 0.01 });
					seatOut(me); me.position.copy(L(0, 0, -0.65)); me.rotation.y = spotYaw(S);
				}),
				beat(5.5, hold, () => { pour.visible = false; act(me, 'stand'); g.userData.startGrowth?.(); delete g.userData.startGrowth; })
			]);
		} finally {
			// Also reveal the saved stage if the player skipped the close-up.
			g.userData.startGrowth?.(); delete g.userData.startGrowth;
			pour.visible = false;
			goal = null;
			camera.position.copy(saved.eye); controls.target.copy(saved.target);
			camera.fov = saved.fov; camera.near = saved.near; camera.updateProjectionMatrix();
			camera.lookAt(saved.target);
		}
	}

	/** the player's joy (Samuel 2026-10-13: after the first mint): their face in the van, centred, a big smile and
	 *  sparkling eyes, a few seconds */
	function joy() {
		const me = people[stage.me];
		const mcu = RIDE_SHOTS.mcu;
		if (!riding) return Promise.resolve();
		return play([
			beat(4, (sec, k) => {
				rollVan(dt);
				const t = now();
				const at = mcu.at(t, 1);
				camera.position.copy(mcu.cam(t, 1)).lerp(at, 0.18 * ease(Math.min(1, k * 2))).add(V(0, Math.sin(t * 23) * 0.012 + Math.sin(t * 7.3) * 0.02, 0));
				camera.lookAt(at);
			}, () => {
				rollVan(0);
				if (riding) holdRide('mcu');
				me.userData.joy = true;
			}),
			{ dur: 0.1, start: () => (me.userData.joy = false) }
		]);
	}
	/** a shot of the story told over the world (a voice-over's length, dur s): still riding in the van, the ride rolls
	 *  on; in the pickup while an invest waits, it rolls slowly on; at a place of the last act, its own shots; anywhere
	 *  else the camera glides slowly round the place the story is at, closing in a little, like a crane. A move to make
	 *  (an invest, the spot, the seed) waits in the shot it was asked in */
	function shotAt(name, { lines = [], act: doing, close = false, shots, talk, hold, kind: step } = {}) {
		const p = PLACES[name];
		const me = people[stage.me];
		const n = Math.max(1, lines.length);
		const keep = step === 'invest' || step === 'pick' || step === 'spot';
		const steps = [];
		if (riding) {
			// on the road: each line cuts to the view that shows what it says (shots), or else to the next view of the ride;
			// the woman beside the player turns to them while she tells of the HEARTS
			holdRide();
			talkShow(talk);
			for (let i = 0; i < n; i++) {
				const kind = RIDE_SHOTS[shots?.[i]] ?? RIDE_SHOTS[RIDE_ORDER[rideCut++ % RIDE_ORDER.length]];
				let fixed = null;
				steps.push(beat(3, (sec, k) => {
					rollVan(dt);
					const t = now();
					const bump = kind.inside ? V(0, Math.sin(t * 23) * 0.012 + Math.sin(t * 7.3) * 0.02, 0) : V(0, 0, 0);
					camera.position.copy(fixed ?? kind.cam(t, k)).add(bump);
					const at = kind.at(t, k);
					camera.lookAt(at);
					controls.target.copy(at); // the haze keeps its distance from what is seen
					kind.run?.(k);
				}, () => {
					rollVan(0);
					if (!kind.run) van.userData.lift(0);
					seatMe(!!kind.me, kind);
					lensFor({ inside: kind.inside, fov: kind.fov ?? (kind.inside ? 72 : 38) });
					fixed = kind.fixed ? kind.cam(0, 0) : null;
				}));
			}
			// a move to make (the mint): the shot it is made in holds while the story waits on it
			if (hold) steps.push({ dur: 0.05, start: () => (van.userData.lift(0), holdRide(hold)) });
			return play(told(steps, lines));
		}
		if (stage.at === 'cruise') {
			// in the pickup rolling slowly on: each line a view from in or on it; the invest waits in the last (hold)
			for (let i = 0; i < n; i++) {
				const s = DRIVE_SHOTS[shots?.[i]] ?? DRIVE_SHOTS.ots;
				steps.push(beat(3, (sec, k) => {
					putTruck(cruiseU());
					truck.updateMatrixWorld(true);
					dust(truck, -2.8);
					camera.position.copy(s.cam(k));
					camera.lookAt(s.at());
				}, () => (inCab(), lensFor(s))));
			}
			if (hold) steps.push({ dur: 0.05, start: () => (cruiseHold = hold) });
			return play(told(steps, lines));
		}
		const scene = SCENES[name] && stage.at === 'home' && (name !== 'seeds' && name !== 'tend' && name !== 'end' || stage.spot) ? SCENES[name]() : null;
		if (scene) {
			for (let i = 0; i < n; i++) {
				const sh = scene[Math.min(i, scene.length - 1)];
				steps.push(beat(sh.min ?? (sh.cold && !lines[i] ? 4.5 : 3), (sec, k) => {
					const [eye, look] = sh.cam(k);
					camera.position.copy(eye);
					camera.lookAt(look);
					controls.target.copy(look);
					sh.run?.(k);
				}, () => {
					lensFor({ fov: sh.fov ?? 42, near: sh.near ?? 0.1 });
					if (moment) moment.cold = !!sh.cold; // the low cut cold, warm again after
					sh.start?.();
					if (me.visible) (seatOut(me), sh.put?.(me));
				}));
			}
			return play(told(steps, lines), { keep });
		}
		if (!p) return play(told([beat(3, () => {})], lines), { keep });
		const offset = p.offset.clone().multiplyScalar(camera.aspect < 0.8 ? 1.65 : 1);
		const r0 = Math.hypot(offset.x, offset.z), a0 = Math.atan2(offset.z, offset.x);
		const near = name !== 'city' && me.visible; // the player is in the picture
		// anywhere else: each line a new shot of the place: a crane drifting round it, low on the ground looking up at it,
		// high over it, and close on the player as they act the line
		const kinds = name === 'city' ? ['crane', 'high'] : near ? ['crane', 'close', 'low', 'high'] : ['crane', 'low', 'high'];
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
		return play(told(steps, lines), { keep });
	}
	/** choosing where the first tree grows (Samuel 2026-10-14): the core circle drawn on the ground, and a marker where
	 *  the player tapped (ok: outside the circle, inside the hex, off the other's tree); a tap on the ground goes to
	 *  onGround */
	let choosing = false;
	function choose({ on = false, at = null, ok = true } = {}) {
		choosing = on;
		core.visible = on || (busy && core.visible);
		marker.visible = on && !!at;
		if (at) (marker.position.set(at.x, 0.08, at.z), marker.material.color.set(ok ? 0xfff6dc : 0xe0435a));
	}
	/** the player walks to where the first tree grows, the camera holding as they go */
	function walkTo(x, z) {
		const me = people[stage.me];
		if (busy || !me) return;
		const S = { x, z };
        if (roam && !tourOn) { if (driving || boarding) return; boardNext = false; roamTo = wayTo(me, spotAt(S)(0,0,-.62)); return; }
		seatOut(me);
		me.visible = true;
		wear(me, true); // out of the tent with them, for the seed and the bottle
		errand = { pts: [me.position.clone().setY(0), spotAt(S)(0, 0, -0.62)], t0: now(), yaw: spotYaw(S) };
		return walkTime(errand.pts);
	}

	/** walking freely, once the story is told (Samuel 2026-10-14): the camera behind the player, following them; a tap
	 *  on the ground walks them there, the arrow keys (or WASD) walk them on, a drag still turns the view round them */
	let roam = false, roamTo = [];
	/** one mode (Samuel 2026-10-14: no walk button): once the story is told the player walks the world whenever no
	 *  film plays (freeWalk) */
	let wantRoam = false;
	function freeWalk(on) {
		wantRoam = !!on;
		if (!on && roam) walk(false);
	}
	const keys = new Set();
	const stick = { x: 0, y: 0, hurry: false };
	function move(x, y, hurry) {
		if ((x || y) && (!wantRoam || busy || (!roam && !walk(true)))) return;
		Object.assign(stick, { x, y, hurry });
		if (x || y) { roamTo = []; boardNext = false; driveTo = null; }
	}
	function look(dx, dy) {
		if (!roam || busy) return;
		goal = null;
		drift = false;
		const offset = camera.position.clone().sub(controls.target);
		const spherical = new THREE.Spherical().setFromVector3(offset);
		spherical.theta -= dx * .0065;
		spherical.phi = Math.max(.12, Math.min(Math.PI / 2 - .04, spherical.phi - dy * .0065));
		camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
		controls.update();
	}
	const stopInput = () => { keys.clear(); Object.assign(stick, { x: 0, y: 0, hurry: false }); };
	window.addEventListener('blur', stopInput);
	const KEYS = { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
	const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '') || e.target?.isContentEditable;
	const onKey = (e) => {
		if (!KEYS[e.code] || typing(e)) return;
		// one mode (Samuel 2026-10-14: no walk button): an arrow key walks them on whenever no film plays
		if (!roam && !(e.type === 'keydown' && walk(true))) return;
		e.preventDefault();
		if (e.type === 'keydown') (keys.add(e.code), (roamTo = []), (boardNext = false));
		else keys.delete(e.code);
	};
	window.addEventListener('keydown', onKey);
	window.addEventListener('keyup', onKey);
	function walk(on) {
		const me = people[stage.me];
		if (!me || (on && (busy || riding || stage.at === 'cruise'))) return false;
		roam = !!on;
		if (roam) held = false; // walking takes the camera back from a shot the story held
		roamTo = [];
		if (inTent) lensOut();
		inTent = false;
		stopInput();
		errand = null;
		if (roam) {
			const sat = me.parent === truck ? me.userData.seat : null;
			seatOut(me);
			if (sat) me.position.copy(atTruck(...(sat === 'driver' ? DRIVER : PASSENGER))); // out at their door
			me.visible = true;
			wear(me, !homed(me));
			me.position.setY(0);
			drift = false;
			goal = null;
			controls.minDistance = 1.5;
			me.userData.glow.visible = false; // the marker over their head would fill the view from behind them
			const back = V(-Math.sin(me.rotation.y), 0, -Math.cos(me.rotation.y));
			goal = { target: head(me, 1.2), offset: back.multiplyScalar(7.5).setY(3.4) };
		} else {
			if (me.parent === truck) seatOut(me);
			driving = boardNext = false;
			boarding = driveTo = null;
			speed = steer = 0;
			freeTruck = false;
			me.userData.glow.visible = true;
			act(me, 'idle');
			controls.minDistance = 12;
			// back to where the story has everyone, the camera gliding back to its place
			place();
			const was = placeNow;
			placeNow = null;
			focus(was);
		}
		return roam;
	}
	/** driving the pickup freely (Samuel 2026-10-14: everyone may get in and drive it anywhere, any time, to the gas
	 *  station too): walked to its driver's door and in; at its wheel the arrow keys (or WASD) are the throttle and the
	 *  steering, and a tap on the ground drives there; at its real pace off the track, stopping short of whatever stands
	 *  in its way; the camera behind it, swinging round as it turns. Out again at its door. While they roam it stays
	 *  where it was left (place keeps it); a story's moment puts it back */
	let driving = false, boarding = null, boardNext = false, freeTruck = false, speed = 0, steer = 0, driveTo = null;
	/** four times its real pace off the track, pulling away and braking four times as hard (Samuel 2026-10-14) */
	const FAST = 4;
	const WHEELBASE = 3.2, TOP = SPEED.track * 1.3 * FAST, REVERSE = 2.5 * FAST;
	const doorAt = () => atTruck(...DRIVER);
	/** whether they stand by the pickup, near enough to get in */
	const byPickup = () => {
		const me = people[stage.me];
		return roam && !driving && !boarding && me?.parent === world && truck.visible && truck.parent === world && me.position.distanceTo(doorAt()) < 4;
	};
	/** get in (walking to its door first) or out */
	function board(on) {
		const me = people[stage.me];
		if (!roam || boarding || !me || on === driving) return false;
		if (on) {
			if (me.position.distanceTo(doorAt()) > 1.2) return ((roamTo = wayTo(me, doorAt())), (boardNext = true));
			// whoever sits at the wheel already moves over
			const other = stage.other ? people[stage.other] : null;
			if (other?.parent === truck && other.userData.seat === 'driver') seatIn(other, 'passenger');
		}
		roamTo = [];
		boardNext = false;
		driveTo = null;
		speed = 0;
		boarding = { into: on, t0: now() };
		return true;
	}
	function boardingStep() {
		const me = people[stage.me];
		const k = Math.min(1, (now() - boarding.t0) / GET_IN);
		if (boarding.into) climbIn(me, 'driver', k);
		else climbOut(me, 'driver', k);
		if (k < 1) return;
		driving = boarding.into;
		boarding = null;
		if (driving) {
			freeTruck = true;
			const back = V(-Math.sin(truck.rotation.y), 0, -Math.cos(truck.rotation.y));
			goal = { target: truck.position.clone().setY(1.6), offset: back.multiplyScalar(11).setY(4.4) };
			controls.minDistance = 4;
		} else {
			act(me, 'idle');
			// the camera out beside them, away from the pickup's side, so both are in view (not behind its cab)
			const out = me.position.clone().sub(truck.position).setY(0).normalize();
			goal = { target: head(me, 1.2), offset: out.multiplyScalar(7.5).setY(3.4) };
			controls.minDistance = 1.5;
		}
	}
	/** the MaiaCity centre's solid things, from its middle (x, z, radius): the bus stop; the gas station's kiosk, its
	 *  pump island, its canopy's four posts, its sign pole and its oil drums (wayside.js: the station 10 m on, turned) */
	const STATION = [
		[-14, -6.5, 2.6],
		[14.5, -3, 2.6], [14.5, 0, 2.6], [14.5, 3, 2.6],
		[6, -1.8, 0.8], [6, 0, 0.8], [6, 1.8, 0.8],
		[8.5, -4.5, 0.3], [8.5, 4.5, 0.3], [3.5, -4.5, 0.3], [3.5, 4.5, 0.3],
		[3.5, 9.5, 0.3], [12, 5.9, 0.9]
	];
	/** what the pickup stops short of, as circles on the ground (centre, radius): the tent and its fire place, the
	 *  shed, the bus stop and the gas station, the machines and the people standing about, the first trees */
	function obstacles() {
		const list = [[V(STORE.x, 0, STORE.z), 3.3], ...STATION.map(([x, z, r]) => [V(CENTRE.x + x, 0, CENTRE.z + z), r])];
		if (home.visible) list.push([home.position, 3.7]);
		if (fire.visible) list.push([fire.position, 1.9]);
		for (const o of [cube, battery, solar]) if (o.parent === world && o.visible) list.push([o.position, 1]);
		for (const s of SEATS) if (people[s].parent === world && people[s].visible) list.push([people[s].position, 0.5]);
		for (const t of Object.values(trees)) if (t?.position) list.push([t.position, 0.6]);
		return list;
	}
	/** whether a move of the pickup's (from `was` to `next`, heading `yaw`) runs into any of them: its front, middle and
	 *  back each a circle of a metre; only a move nearer is stopped, so a way out is never blocked */
	function blocked(was, next, yaw) {
		const f = V(Math.sin(yaw), 0, Math.cos(yaw));
		for (const [c, r] of obstacles()) {
			for (const a of [1.5, 0, -1.5]) {
				const q = next.clone().addScaledVector(f, a), d = Math.hypot(q.x - c.x, q.z - c.z);
				if (d >= r + 1) continue;
				const q0 = was.clone().addScaledVector(f, a);
				if (d < Math.hypot(q0.x - c.x, q0.z - c.z)) return true;
			}
		}
		return false;
	}
	/** the free drive, a frame of it: on along the keys, or on to where they tapped, slowing as it comes and as it turns */
	function drivingStep(step) {
		let throttle = 0, turn = 0;
		if (keys.size || stick.x || stick.y) {
			const k = [...keys].reduce((a, c) => [a[0] + KEYS[c][0], a[1] + KEYS[c][1]], [0, 0]);
			throttle = Math.max(-1, Math.min(1, k[1] + stick.y));
			turn = -Math.max(-1, Math.min(1, k[0] + stick.x)); // left (+x, the driver's side) turns it left
			driveTo = null;
		} else if (driveTo) {
			const dx = driveTo.x - truck.position.x, dz = driveTo.z - truck.position.z, dist = Math.hypot(dx, dz);
			if (dist < 2.5) driveTo = null;
			else {
				const a = Math.atan2(dx, dz) - truck.rotation.y, off = Math.atan2(Math.sin(a), Math.cos(a));
				turn = Math.max(-1, Math.min(1, off * 2));
				throttle = Math.min(1, Math.max(0.3, Math.sqrt(dist) / 6)) * (1 - 0.55 * Math.abs(turn));
			}
		}
		const want = throttle > 0 ? TOP * throttle : throttle < 0 ? -REVERSE : 0;
		speed += Math.max(-7 * FAST * step, Math.min(3 * FAST * step, want - speed)); // it brakes harder than it pulls away
		steer += Math.max(-1.2 * step, Math.min(1.2 * step, turn * 0.6 - steer));
		const was = truck.position.clone();
		// above its real top speed it turns no faster than it did there, so it never spins on the spot
		const grip = Math.min(1, TOP / FAST / Math.max(1e-3, Math.abs(speed)));
		const yaw = truck.rotation.y + (speed / WHEELBASE) * Math.tan(steer) * grip * step;
		const next = was.clone().add(V(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed * step));
		if (blocked(was, next, yaw)) speed = 0;
		else (truck.position.copy(next), (truck.rotation.y = yaw));
		if (Math.abs(speed) > 1.5) dust(truck, -2.6);
		// the camera carried along with it, swinging round behind it as it goes
		const moved = truck.position.clone().sub(was);
		camera.position.add(moved);
		controls.target.add(moved);
		if (goal) goal.target.add(moved);
		if (Math.abs(speed) > 0.5 && !goal) {
			const off = camera.position.clone().sub(controls.target);
			const behind = Math.atan2(-Math.sin(truck.rotation.y), -Math.cos(truck.rotation.y)), now = Math.atan2(off.x, off.z);
			off.applyAxisAngle(V(0, 1, 0), Math.atan2(Math.sin(behind - now), Math.cos(behind - now)) * Math.min(1, step * 1.5));
			camera.position.copy(controls.target).add(off);
		}
	}
	/** the tent walked into (Samuel 2026-10-14): its wall a ring crossed only at its door (+z), the things in it and
	 *  round it stood clear of (the fire place's too); upright under the bell only as far out as its headroom (the bell
	 *  tent comes down to 1.8 m 1.3 m from its pole); all in the tent's own frame, as the tent gives them
	 *  (userData.walk: { r, door, headroom, colliders }; a tent without it is not walked into or round) */
	const BODY = 0.25; // how far a walker keeps from a wall or a thing (m)
	const tentWalk = () => (home.visible && TENT_WALK) || null;
	const inside = (w, p) => Math.hypot(p.x, p.z) < w.r;
	/** how far from the pole a grown-up stands upright in it */
	const upright = (w) => Math.min(w.headroom ?? w.r - BODY, w.r - BODY);
	/** what is in the way, in and round the tent: its own things and its fire place's */
	const things = (w) => {
		if (!fire.visible) return w.colliders ?? [];
		const f = home.worldToLocal(fire.position.clone());
		return [...(w.colliders ?? []), ...FIRE_WALK.colliders.map((c) => ({ x: c.x + f.x, z: c.z + f.z, r: c.r }))];
	};
	/** where a step from `from` to `to` (world) may end: through the door, slid along the wall, round the things */
	function walkable(from, to) {
		const w = tentWalk();
		if (!w) return to;
		home.updateMatrixWorld(true);
		const a = home.worldToLocal(from.clone()), b = home.worldToLocal(to.clone());
		const rb = Math.hypot(b.x, b.z);
		const atDoor = b.z > 0 && Math.abs(b.x) < w.door - BODY;
		if (!atDoor && rb > upright(w) && rb < w.r + BODY) {
			// under the low bell or at the canvas: kept on the side they were on, sliding round it
			const r = inside(w, a) ? upright(w) : w.r + BODY;
			if (rb < 1e-6) return from;
			(b.x *= r / rb), (b.z *= r / rb);
		}
		const step = Math.hypot(b.x - a.x, b.z - a.z);
		for (const c of things(w)) {
			const d = Math.hypot(b.x - c.x, b.z - c.z), m = c.r + BODY;
			if (d >= m) continue;
			if (d < 1e-6) return from;
			// out to its edge, and on round it, to the side the step leans to
			const ux = (b.x - c.x) / d, uz = (b.z - c.z) / d, side = Math.sign(ux * (b.z - a.z) - uz * (b.x - a.x)) || 1;
			(b.x = c.x + ux * m + -uz * side * step * 0.7), (b.z = c.z + uz * m + ux * side * step * 0.7);
		}
		return home.localToWorld(b).setY(to.y);
	}
	/** the way to a tapped point: straight there; by the door when it is on the wall's other side; round the tent
	 *  when the straight way outside runs through it */
	function wayTo(me, at) {
		const w = tentWalk();
		if (!w) return [at];
		home.updateMatrixWorld(true);
		const L = (p) => home.worldToLocal(p.clone());
		/** outside to outside: a point beside the tent to pass by, if the way runs through it */
		const round = (from, to) => {
			const a = L(from), b = L(to), dx = b.x - a.x, dz = b.z - a.z;
			const t = Math.min(1, Math.max(0, -(a.x * dx + a.z * dz) / (dx * dx + dz * dz || 1)));
			const cx = a.x + dx * t, cz = a.z + dz * t, d = Math.hypot(cx, cz), n = Math.hypot(dx, dz) || 1;
			if (d >= w.r + BODY) return [];
			const [ux, uz] = d > 1e-3 ? [cx / d, cz / d] : [-dz / n, dx / n];
			return [home.localToWorld(V(ux * (w.r + 1.2), 0, uz * (w.r + 1.2)))];
		};
		const fromIn = inside(w, L(me.position)), toIn = inside(w, L(at));
		if (fromIn && toIn) return [at];
		if (!fromIn && !toIn) return [...round(me.position, at), at];
		const out = home.localToWorld(V(0, 0, w.r + 0.8)), inn = home.localToWorld(V(0, 0, Math.min(w.r - 0.8, upright(w) - 0.1)));
		return fromIn ? [inn, out, ...round(out, at), at] : [...round(me.position, out), out, inn, at];
	}
	/** the camera in the tent with them: under the canvas, a third of the way round the pole from them, so it looks
	 *  across the tent at them with the pole beside the view, not in it; it moves on round only when they come too near
	 *  it or the pole comes between. Cut to on the way in, and on the way out cut to high behind them, over the tent */
	let inTent = false, stuck = 0, tentEye = null;
	const EYE_Y = 1.7;
	function tentCamera(me) {
		const w = tentWalk();
		home.updateMatrixWorld(true);
		const p = w ? home.worldToLocal(me.position.clone()) : null;
		const now = !!w && inside(w, p), cut = now && !inTent;
		if (now !== inTent) {
			inTent = now;
			// a near, wide lens under the canvas (the tent is 4.2 m across), the walk's own lens again outside
			if (now) ((camera.near = 0.08), (camera.fov = camera.aspect < 0.8 ? 84 : 72), camera.updateProjectionMatrix());
			else lensOut();
			tentEye = null;
			if (!now) {
				// out by the door: from high behind them, over the bell, so the way on is still away from the camera
				const back = V(-Math.sin(me.rotation.y), 0, -Math.cos(me.rotation.y));
				const target = head(me, 1.2), offset = back.multiplyScalar(7.5).setY(6);
				controls.target.copy(target);
				camera.position.copy(target).add(offset);
				goal = null;
				controls.minDistance = 1.5;
				return;
			}
		}
		if (!now) return;
		const R = upright(w) - 0.05;
		const spot = (b) => V(Math.sin(b) * R, EYE_Y, Math.cos(b) * R);
		const pole = (e) => {
			// how near the pole (the tent's middle) the line from the camera to them passes
			const dx = p.x - e.x, dz = p.z - e.z, n = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, -(e.x * dx + e.z * dz) / n));
			return Math.hypot(e.x + dx * t, e.z + dz * t);
		};
		if (!tentEye || Math.hypot(p.x - tentEye.x, p.z - tentEye.z) < 1 || pole(tentEye) < 0.3) {
			// a third of the way round from them, on the side nearer where the camera is (no swing across)
			const a = Math.hypot(p.x, p.z) > 0.3 ? Math.atan2(p.x, p.z) : me.rotation.y - home.rotation.y + Math.PI;
			const [l, r] = [spot(a + 2.1), spot(a - 2.1)];
			const was = tentEye ?? home.worldToLocal(camera.position.clone());
			tentEye = l.distanceTo(was) <= r.distanceTo(was) ? l : r;
		}
		const target = head(me, 1.2), eye = home.localToWorld(tentEye.clone());
		if (cut) (camera.position.copy(eye), controls.target.copy(target)); // the cut in
		goal = { target, offset: eye.sub(target) };
		controls.minDistance = 0.4;
	}
	/** a point pulled in under the canvas, if it is out beyond it */
	function inTentAt(p) {
		const w = tentWalk();
		if (!w) return p;
		const c = home.worldToLocal(p.clone()), rc = Math.hypot(c.x, c.z), max = upright(w) - 0.05;
		if (rc > max) (c.x *= max / rc), (c.z *= max / rc);
		return home.localToWorld(c);
	}
	/** walking freely: four times the story's real pace (Samuel 2026-10-14) */
	const ROAM = WALK * 4;
	/** the free walk, a frame of it: on along the keys (ahead is away from the camera) or along the way to where they
	 *  tapped, at their walking pace (ROAM), never through the tent's canvas; the camera carried along with them */
	function roaming(step) {
		const me = people[stage.me];
		if (!me || me.parent !== world) return;
		const was = me.position.clone();
		let dir = null;
		if (keys.size || stick.x || stick.y) {
			const ahead = controls.target.clone().sub(camera.position).setY(0).normalize(), right = V(-ahead.z, 0, ahead.x);
			const k = [...keys].reduce((a, c) => [a[0] + KEYS[c][0], a[1] + KEYS[c][1]], [0, 0]);
			dir = ahead.multiplyScalar(k[1] + stick.y).addScaledVector(right, k[0] + stick.x);
		} else if (roamTo.length) dir = roamTo[0].clone().sub(me.position).setY(0);
		const left = dir?.length() ?? 0;
		if (left > 0.05) {
			const manual = keys.size || stick.x || stick.y;
			const pace = keys.size ? 1 : manual ? Math.min(1, left) * (stick.hurry ? 1 : .5) : 1;
			const d = Math.min(manual ? Infinity : left, ROAM * pace * step);
			dir.normalize();
			me.position.copy(walkable(was, me.position.clone().addScaledVector(dir, d)));
			me.rotation.y = Math.atan2(dir.x, dir.z);
			const on = me.position.distanceTo(was) > 0.2 * d;
			act(me, on ? 'walk' : 'idle');
			// against a wall or a thing for a moment, where they were going is given up
			stuck = on ? 0 : stuck + step;
			if (stuck > 0.6) ((roamTo = []), (stuck = 0), (boardNext = false));
		} else if (roamTo.length > 1) roamTo.shift();
		else {
			roamTo = [];
			act(me, 'idle');
			if (boardNext) board(true); // at the pickup's door: in
		}
		if (!inTent) {
			// the camera carried along with them (in the tent it keeps its place, turning to them)
			const moved = me.position.clone().sub(was);
			camera.position.add(moved);
			controls.target.add(moved);
		}
		tentCamera(me);
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
		sharedWater = view.water;
		for (const seat of SEATS) {
			const hearts = view.players[seat].wallet.HEARTS;
			const glow = people[seat].userData.glow;
			glow.visible = hearts > 0.01 && !busy && !held && people[seat].parent === world && !(roam && seat === stage.me);
			glow.scale.setScalar(0.5 + Math.min(1.5, hearts / 24));
		}
	}

	// the sun by the virtual hour: up from 6 to 18, low and warm at the ends, a cool night with a moonlight; it
	// follows what the camera looks at, so the shadows fall wherever the story is
	/** the canvas's glow by day and at night, and the lantern's own light, as the bell tent gives them */
	const CLOTH_DAY = new THREE.Color('#5a4c34'), CLOTH_NIGHT = new THREE.Color('#ffb36a'), LANTERN = 1.4;
	/** the hour the world's light is at now: the moment's (a time-lapse moves it), the story's, else the game's */
	const hourNow = () => moment?.hour ?? stage.hour ?? hour;
	function light(t) {
		const day = ((hourOf() ?? hourNow()) - 6) / 12;
		const up = Math.sin(Math.PI * Math.min(1, Math.max(0, day)));
		const a = Math.PI * day;
		// the low cut cold: a bluer, flatter light for its beat (on film, the shot's lights say it: ./intro.js COLD)
		const cold = !film && !!moment?.cold;
		sun.target.position.copy(controls.target).setY(0);
		sun.position.set(Math.cos(a) * 90, 8 + up * 80, -30 + Math.sin(a) * 20).add(sun.target.position);
		sun.intensity = (0.25 + up * 2.1) * (cold ? 0.55 : 1);
		if (cold) sun.color.setHSL(0.58, 0.25, 0.8);
		else sun.color.setHSL(0.1, 0.6 - up * 0.3, 0.75 + up * 0.15);
		hemi.intensity = (0.35 + up * 0.85) * (cold ? 0.8 : 1);
		const c = new THREE.Color(0x1d2b3d).lerp(new THREE.Color(cold ? 0xb4c4d2 : 0xd8e2e2), Math.min(1, up * 1.6));
		// the tent glows from within once it has power, more as the light goes: its lantern turned up, the canvas warm
		// with it (the bell tent's own night glow); and the fire in front of it lit at dusk, flickering
		const glow = (lit ? Math.min(1, Math.max(0, (0.8 - up) / 0.55)) : 0) * (cold ? 0.35 : 1);
		// seen from inside, the canvas is lit by the lantern only, not glowing as it does to whoever is outside
		const within = roam && inTent ? 0.3 : 1;
		for (const tent of [pitched, secondPitched]) {
        if (tent?.canvas) {
			tent.canvas.emissive.copy(CLOTH_DAY).lerp(CLOTH_NIGHT, glow * within);
			tent.canvas.emissiveIntensity = (0.35 + 0.2 * glow) * within;
		}
		if (tent?.lamp) tent.lamp.intensity = LANTERN * (1 + 3 * glow);
        } // while it is pitched, its own
		const flame = fire.visible && hearth.built >= 1 ? Math.min(1, Math.max(0, (0.62 - up) / 0.3)) : 0;
		if (Math.abs(flame - hearth.lit) > 0.005) ((hearth.lit = flame), burnTo());
		// its burning: its flames and their light flicker in the box while it burns
		const burns = hearth.built >= 1 ? hearth.lit : 0;
		hearth.hero?.tick(burns > 0.01 && fire.visible ? Math.min(0.25, Math.max(0, t - (hearth.t ?? t))) : 0);
		hearth.t = t;
		scene.background.copy(c);
		scene.fog.color.copy(c);
		// the haze keeps its distance from the camera, so the far view of the whole city still reads
		const d = camera.position.distanceTo(controls.target);
		scene.fog.near = Math.max(260, d * 0.75);
		scene.fog.far = Math.max(1600, d * 2.6);
		for (const seat of SEATS) {
			const g = people[seat].userData.glow;
			g.rotation.y = t * 1.5;
			g.position.y = 2.3 + Math.sin(t * 2 + (seat === 'A' ? 0 : 1.5)) * 0.1;
		}
	}

	function resize() {
		if (film && filmHoldsSize()) return; // the film keeps the size it asked for
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
		if (roam) {
			// walking freely: the point on the ground under the tap is where they walk to (at the wheel, drive to); the
			// pickup tapped, they walk to it and get in
			if (boarding) return;
			const at = ray.ray.intersectPlane(new THREE.Plane(V(0, 1, 0), 0), V(0, 0, 0));
			if (driving) return void (at && (driveTo = at));
			if (truck.visible && ray.intersectObject(truck, true).length) return void board(true);
			// a machine, a thing or a tree tapped shows what it is, as before; the ground, the tent and the buildings are
			// walked to
			const thing = ray.intersectObjects(world.children, true).find((h) => h.object.visible && /^(asset|tree):/.test(h.object.name) && !/^asset:(tent|busStop|gasStation|shed)$/.test(h.object.name));
			if (thing?.object.name === 'asset:water-canister' && sharedWater && !sharedWater.carriedBy) {
				boardNext = false;
				walkTo(sharedWater.x, sharedWater.z);
				return;
			}
			if (thing) return void onPick(thing.object.name);
			boardNext = false;
			if (at) roamTo = wayTo(people[stage.me], at);
			return;
		}
		if (choosing) {
			// choosing where the first tree grows: the point on the ground under the tap
			const at = ray.ray.intersectPlane(new THREE.Plane(V(0, 1, 0), 0), V(0, 0, 0));
			return at && onGround({ x: Math.round(at.x * 100) / 100, z: Math.round(at.z * 100) / 100 });
		}
		const hit = ray.intersectObjects(world.children, true).find((h) => h.object.name && h.object.visible);
		onPick(hit ? hit.object.name : null);
	};
	// TouchStick owns touch camera gestures; OrbitControls and tap-to-walk must not also consume them.
	const touchPointer = (e) => {
		if (e.pointerType === 'touch' && wantRoam && !tourOn && !film) e.stopImmediatePropagation();
	};
	for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.addEventListener(event, touchPointer, true);
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointerup', onUp);

	let frame = 0;
	let raf = 0;
	let roamSeen = { on: false, near: false, driving: false };
	let lastT = null;
	/** the world's own frames: one a screen refresh, on the world's clock */
	function loop() {
		raf = requestAnimationFrame(loop);
		frameOf(now(), true);
	}
	/** one frame of the world at time t (s, its clock): everything moved on to t, and, drawn, the picture drawn (a film
	 *  world comes to a moment frame by frame, drawing only the last: the film draws it) */
	function frameOf(t, drawn_ = true) {
		const step = Math.min(0.25, t - (lastT ?? t));
		lastT = t;
		settleDust(step);
		if (cubeHero) {
			// humming at home while no film plays (held where it was while one does), off elsewhere
			const runs = stage.cube === 'home' && cube.parent === world && !busy;
			if (runs && cubeHero.doing?.name !== 'run') cubeHero.play('run');
			if (runs || cubeHero.doing?.name === 'off') cubeHero.tick(runs ? step : 0);
		}
		if (errand && !moment) {
			// walking to where the first tree grows, the camera holding
			const me = people[stage.me];
			if (walkOn(me, errand.pts, t - errand.t0)) me.rotation.y = errand.yaw;
		}
  if (!film && !tourOn && !busy && sharedWater) {
   world.attach(waterCan); waterCan.visible=true; waterCan.rotation.set(0,0,0);
   if(sharedWater.carriedBy === stage.me) {
    const me=people[stage.me];waterCan.position.copy(me.localToWorld(V(.36,.55,.05)));waterCan.rotation.y=me.rotation.y;
   } else waterCan.position.set(sharedWater.x,sharedWater.carriedBy ? .55 : 0,sharedWater.z);
  }
		for (let i = grows.length - 1; i >= 0; i--) {
			// a watered tree grows in place
			const g = grows[i], k = Math.min(1, (t - g.t0) / (g.seconds ?? 1.8));
			g.plant.scale.setScalar(g.from + (1 - g.from) * easeOut(k));
			if (k >= 1) grows.splice(i, 1);
		}
		// once the story is told the player simply walks: back on their feet as soon as no film plays
		if (wantRoam && !roam && !moment && !riding && stage.at !== 'cruise' && !choosing && !errand) walk(true);
		if (moment) runMoment(t);
		else if (riding) ride(step);
		else if (stage.at === 'cruise' && cruising) cruise();
		else if (held && !roam) controls.enabled = false;
		else {
			controls.enabled = true;
			if (roam) boarding ? boardingStep() : driving ? drivingStep(step) : roaming(step);
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
			if (roam && inTent) camera.position.copy(inTentAt(camera.position)); // never out through the canvas
		}
		// the players posed after the moment has said where they are and what they do, so a cut never shows the last
		// shot's pose for a frame
		for (const p of Object.values(people)) if (p.visible) (stride(p, p.parent === world), acting(p, (p.userData.t += step)), busy && (p.userData.glow.visible = false));
		if (!drawn_) return;
		light(t);
		drawn.update();
		if (own) renderer.render(scene, camera);
		if (++frame % 4 === 0) {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			const out = {};
			for (const k of SEATS) {
				const o = people[k];
				const p = o.localToWorld(V(0, 2.8, 0)).project(camera);
				out[`player:${k}`] = { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, on: o.visible && !busy && !held && !riding && stage.at !== 'cruise' && p.z < 1 };
				const tree = trees[k];
				if (tree) {
					// another's tree, while a spot is chosen: ringed and named however far off the camera is
					const marked = (core.visible && k !== stage.me) || (!film && !tourOn);
					tree.userData.ring.visible = marked;
					const q = tree.position.clone().setY(tree.userData.top).project(camera);
					const behind = q.z > 1;
					const sx = (behind ? -q.x : q.x), sy = (behind ? -q.y : q.y);
					out[`tree:${k}`] = { x: Math.max(90, Math.min(w - 90, ((sx + 1) / 2) * w)), y: Math.max(80, Math.min(h - 80, ((1 - sy) / 2) * h)), on: !riding && marked, edge: behind || Math.abs(q.x) > .85 || Math.abs(q.y) > .85, distance: Math.round(people[stage.me].getWorldPosition(V()).distanceTo(tree.position)) };
				}
			}
			onLabels(out);
			const at = people[stage.me].getWorldPosition(V());
   const mine=trees[stage.me];
   const r = { on: roam, near: byPickup(), driving: driving || !!boarding?.into,
    waterNear: !!sharedWater && Math.hypot(at.x-sharedWater.x,at.z-sharedWater.z) <= WATER_REACH,
    waterDistance: sharedWater ? Math.ceil(Math.hypot(at.x-sharedWater.x,at.z-sharedWater.z)) : null,
    treeNear: !!mine && Math.hypot(at.x-mine.position.x,at.z-mine.position.z) <= WATER_REACH };
			if (r.on !== roamSeen.on || r.near !== roamSeen.near || r.driving !== roamSeen.driving || r.waterNear !== roamSeen.waterNear || r.waterDistance !== roamSeen.waterDistance || r.treeNear !== roamSeen.treeNear) ((roamSeen = r), onRoam(r));
		}
	}
	if (own) loop();

	/** the film's hold on the world (./film.js): the world brought back to how a moment of the story starts, whatever
	 *  came before it, so the same moment always plays the same way */
	const filmHold = {
		renderer,
		scene,
		camera,
		frames,
		/** one frame at time t (s); drawn: the last of a run, everything the picture needs made ready */
		tick: (t, drawn_ = false) => frameOf(t, drawn_),
		/** nothing playing, nothing held, nothing left over of the moment before: the world at time t as the story's
		 *  next moment starts it (its chance seeded with `seed`) */
		reset(t, seed) {
			moment = null;
			busy = held = false;
			nextReel = null;
			errand = null;
			cruising = null;
			cruiseHold = rideHold = '';
			rideT = 0;
			rideCut = 0;
			talkShow(false);
			placeNow = '';
			placed = true;
			goal = null;
			grows.length = 0;
			canvas.style.filter = '';
			for (const p of puffs) (p.visible = false), (p.userData.age = 9), (p.material.opacity = 0);
			puffAt = 0;
			lastDust = new WeakMap();
			for (const p of Object.values(people)) Object.assign(p.userData, { t: 0, walked: 0, last: null, joy: false, extra: null });
			for (const o of van.userData.people) Object.assign(o.userData, { k: 0, to: 0, lift: 0 });
			rand = random;
			if (seed != null) rand = rng(seed);
			lastT = t;
			camera.clearViewOffset();
			lensOut();
		},
		/** the moment playing now: which of its steps, whether that one is a shot (a cut to a new one), the reel's start */
		moment: () => (moment ? { i: moment.i, shot: !!moment.steps[moment.i]?.shot, start: moment.start, t0: moment.t0, cold: !!moment.cold } : null),
		/** the moving parts put where a shot has them; returns how to put them back as the world had them */
		parts: putParts,
		/** the hour the world's light is at now, as the story has it */
		hour: () => hourNow(),
		/** the world's own lights a shot scales and colours over what the hour gives them (game/film/shot.js LIGHTS) */
		lights: {
			sun: (k, color) => ((sun.intensity *= k), color && sun.color.set(color)),
			fill: (k, color) => ((hemi.intensity *= k), color && hemi.color.set(color)),
			glow: (k, color) => {
				if (pitched?.lamp) pitched.lamp.intensity *= k;
				if (pitched?.canvas) (pitched.canvas.emissiveIntensity *= k), color && pitched.canvas.emissive.set(color);
			}
		}
	};

	return {
		film: filmHold,
		/** the reel the next moment is filmed by (game/film/reel.js), else the moves coded here */
		reel: (r) => void (nextReel = r ?? null),
		update,
		freeWalk,
		reveal,
		set,
		focus,
		touring,
		intro,
		scene: shotAt,
		joy,
		trees: setTrees,
		drive,
		station,
		load,
		pitch,
		choose,
		walkTo,
		walk,
		board,
		sticks: markIt,
		sow,
		water: waterTree,
		move,
		look,
		position: () => { const p=people[stage.me].getWorldPosition(V()); return {x:p.x,z:p.z}; },
		skip,
		get busy() {
			return busy;
		},
		/** settles once every library asset asked for so far is there to draw (or failed) */
		get ready() {
			return drawn.ready();
		},
		/** settles once every library asset in the camera's view (as the next frame is drawn) is there to draw (or
		 *  failed): what the shot on screen shows, the rest perhaps still coming */
		get inView() {
			return drawn.inView();
		},
		/** what the renderer draws of the library */
		stats: () => drawn.stats(),
		dispose() {
			cancelAnimationFrame(raf);
			drawn.dispose();
			ro.disconnect();
			window.removeEventListener('blur', stopInput);
			for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.removeEventListener(event, touchPointer, true);
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointerup', onUp);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keyup', onKey);
			controls.dispose();
			renderer.dispose();
		}
	};
}
