/**
 * SANDBOX 6 · THE VIEW — the simulation (./sim.js) drawn in three.js, and nothing else: it reads the state every
 * frame and never changes it. The valley's land is one mesh of triangles between the nodes (grass, sand, rock, the ore
 * showing in its colour, snow on the peaks); trees, rocks, fields, wares and people are instanced; each building is its
 * own model (./models.js), a village center filling half its hex. The hexes the valley is cut into (./plots.js) are
 * drawn only while something is being placed: faint lines lying on the land, the villages' borders, and the hexes a
 * building needs tinted. Only what changed is rebuilt: the state counts its changes (objV, netV, terV).
 */
import * as THREE from 'three';
import { GRASS, MOUNTAIN, SAND, WARES, WATER } from './rules.js';
import { buildingModel, mat, recolour, scaffold, TEAM } from './models.js';
import { ROW, SE, STEP } from './hex.js';
import { K, RING_R, onRing, ringWay } from './plots.js';

/** a path's width: two lanes, a bus each way, a dashed line between them */
const ROAD_W = 0.9;
/** how far right of a path's middle a bus keeps: the middle of its own lane */
const LANE = ROAD_W / 4;
/** the water's surface */
export const SEA = -0.3;
/** a hex's radius, middle to corner */
const HEX_R = (K * STEP) / Math.sqrt(3);
/** the six ways out of a hex, in the world: east, north-east, north-west, west, south-west, south-east */
const WAYS = [[1, 0], [0.5, -Math.sqrt(3) / 2], [-0.5, -Math.sqrt(3) / 2], [-1, 0], [-0.5, Math.sqrt(3) / 2], [0.5, Math.sqrt(3) / 2]];
/** how much larger a village center is drawn than its model: half its hex across, land all round it */
const CENTRE_SCALE = 2.4, CENTRE_TALL = 1.8;
/** the roundabout in the middle of a hex where its paths meet: the ring the buses drive round (half a step out, where
 * a path's last step begins), its road from the island out, and the island in its middle, where wares wait */
const RING = STEP / 2, RING_OUT = RING + 0.38, ISLE = RING - 0.33;

/**
 * @param {THREE.Scene} scene
 * @param {import('./sim.js').Sim} sim
 */
export function createView(scene, sim) {
	const st = sim.state, g = sim.grid;
	const root = new THREE.Group();
	root.name = 'sandbox-6';
	scene.add(root);
	const disposables = /** @type {{ dispose: () => void }[]} */ ([]);
	const keep = (/** @type {any} */ x) => (disposables.push(x), x);
	const X = (/** @type {number} */ i) => g.x(i), Z = (/** @type {number} */ i) => g.z(i);
	const Y = (/** @type {number} */ i) => (st.terrain[i] === WATER ? SEA - 0.9 : st.height[i]);
	const hash = (/** @type {number} */ i) => {
		let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
		h ^= h >>> 13;
		return ((Math.imul(h, 0xc2b2ae35) >>> 0) % 1000) / 1000;
	};

	// ── instanced things ──
	/** @param {THREE.BufferGeometry} geo @param {THREE.Material} m @param {number} cap */
	function inst(geo, m, cap, shadow = true) {
		const mesh = new THREE.InstancedMesh(keep(geo), m, cap);
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.castShadow = shadow;
		mesh.receiveShadow = true;
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		root.add(mesh);
		disposables.push(mesh);
		return mesh;
	}
	const white = keep(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }));
	const trunks = inst(new THREE.CylinderGeometry(0.07, 0.11, 0.7, 5).translate(0, 0.35, 0), mat('#6b4a30'), g.N);
	const pines = inst(new THREE.ConeGeometry(0.55, 1.6, 6).translate(0, 1.3, 0), mat('#3f7a3c'), g.N);
	const leaves = inst(new THREE.IcosahedronGeometry(0.62, 0).translate(0, 1.15, 0), mat('#5c9440'), g.N);
	const rocks = inst(new THREE.DodecahedronGeometry(0.42, 0).translate(0, 0.2, 0), mat('#a19d95'), g.N);
	const fields = inst(new THREE.CylinderGeometry(STEP * 0.47, STEP * 0.47, 0.12, 6), white, g.N, false);
	const wares = inst(new THREE.BoxGeometry(0.2, 0.17, 0.2), white, 4000);
	// everyone travels by bus: a small driverless pod, the same both ways round (it never turns, it just sets off the
	// other way), its body in the colour of its job, a band of glass round it, a lamp at either end and its load on the roof
	const BUSES = 1800;
	const buses = inst(new THREE.CapsuleGeometry(0.15, 0.3, 4, 10).rotateX(Math.PI / 2).scale(1, 0.85, 1).translate(0, 0.2, 0), white, BUSES);
	const glass = inst(new THREE.CapsuleGeometry(0.155, 0.22, 4, 10).rotateX(Math.PI / 2).scale(1, 0.42, 1).translate(0, 0.25, 0), keep(new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.2, metalness: 0.4 })), BUSES);
	const lampGeo = new THREE.SphereGeometry(0.04, 6, 4);
	const lamps = inst(lampGeo.clone().translate(0, 0.18, 0.29), keep(new THREE.MeshBasicMaterial({ color: '#fff4c8' })), BUSES, false);
	const lampsBack = inst(lampGeo.translate(0, 0.18, -0.29), keep(new THREE.MeshBasicMaterial({ color: '#fff4c8' })), BUSES, false);
	const loads = inst(new THREE.BoxGeometry(0.2, 0.12, 0.26).translate(0, 0.4, 0), white, BUSES);
	// and four wheels under it
	const tyre = keep(new THREE.MeshStandardMaterial({ color: '#22262a', roughness: 0.9 }));
	const wheels = [
		[-1, -1], [1, -1], [-1, 1], [1, 1]
	].map(([sx, sz]) => inst(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 10).rotateZ(Math.PI / 2).translate(sx * 0.14, 0.065, sz * 0.19), tyre, BUSES));
	const spots = inst(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 6), keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 })), g.N, false);
	spots.receiveShadow = false;
	// the roundabouts where paths meet: a ring of road, a kerb, and a green island with a bush on it
	const squares = inst(new THREE.CylinderGeometry(RING_OUT, RING_OUT, 0.06, 28), keep(new THREE.MeshStandardMaterial({ color: '#b39468', roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })), g.N, false);
	const kerbs = inst(new THREE.CylinderGeometry(ISLE + 0.05, ISLE + 0.05, 0.1, 24).translate(0, 0.05, 0), mat('#d9d4c6'), g.N, false);
	const isles = inst(new THREE.CylinderGeometry(ISLE, ISLE, 0.14, 24).translate(0, 0.07, 0), mat('#6f9e4c'), g.N, false);
	const bushes = inst(new THREE.IcosahedronGeometry(0.16, 0).translate(0, 0.24, 0), mat('#4f8a3a'), g.N);
	/** the stops in use: where the roundabouts stand */
	const stops = new Set();

	const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
	/** @param {THREE.InstancedMesh} mesh @param {number} k @param {number} x @param {number} y @param {number} z */
	const put = (mesh, k, x, y, z, scale = 1, turn = 0, sy = scale) => {
		q.setFromAxisAngle(yAxis, turn);
		mesh.setMatrixAt(k, m4.compose(p3.set(x, y, z), q, s3.set(scale, sy, scale)));
	};
	const done = (/** @type {THREE.InstancedMesh} */ mesh, /** @type {number} */ n) => {
		mesh.count = n;
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	};

	// ── the land: one mesh of triangles between the nodes ──
	const plan = sim.plan, P = plan.centre.length;
	const c = new THREE.Color(), tint = new THREE.Color();
	const positions = new Float32Array(g.N * 3), colors = new Float32Array(g.N * 3);
	const ORE_TINT = [null, null, new THREE.Color('#a4583a')];
	for (let i = 0; i < g.N; i++) {
		positions.set([X(i), Y(i), Z(i)], i * 3);
		const n = hash(i);
		switch (st.terrain[i]) {
			case GRASS:
				c.set('#7da957').lerp(tint.set('#5b8c43'), n * 0.7).lerp(tint.set('#9bb25e'), Math.max(0, st.height[i] - 1) * 0.3);
				// iron under the grass shows rust-red through it
				if (ORE_TINT[st.ore[i]]) c.lerp(/** @type {THREE.Color} */ (ORE_TINT[st.ore[i]]), 0.3);
				break;
			case SAND:
				c.set('#dcc893').lerp(tint.set('#cdb67e'), n);
				break;
			case WATER:
				c.set('#57806e');
				break;
			case MOUNTAIN: {
				c.set('#8a8277').lerp(tint.set('#a59d91'), n * 0.6);
				if (st.height[i] > 7.5) c.lerp(tint.set('#f2f2ee'), Math.min(1, (st.height[i] - 7.5) / 1.5));
				const ore = ORE_TINT[st.ore[i]];
				if (ore) c.lerp(ore, 0.42);
				break;
			}
		}
		colors.set([c.r, c.g, c.b], i * 3);
	}
	/** @type {number[]} */
	const index = [];
	const up = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
	const tri = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ d) => {
		if (a < 0 || b < 0 || d < 0) return;
		pa.fromArray(positions, a * 3);
		pb.fromArray(positions, b * 3);
		pc.fromArray(positions, d * 3);
		up.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa));
		if (up.y > 0) index.push(a, b, d);
		else index.push(a, d, b);
	};
	for (let i = 0; i < g.N; i++) {
		tri(i, g.nb(i, 4), g.nb(i, SE));
		tri(i, g.nb(i, SE), g.nb(i, 0));
	}
	const landGeo = keep(new THREE.BufferGeometry());
	landGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	landGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	landGeo.setIndex(index);
	landGeo.computeVertexNormals();
	const land = new THREE.Mesh(landGeo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })));
	land.receiveShadow = true;
	land.name = 'land';
	root.add(land);
	const sea = new THREE.Mesh(keep(new THREE.PlaneGeometry(900, 900)), keep(new THREE.MeshStandardMaterial({ color: '#3a7fa4', roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.88 })));
	sea.rotation.x = -Math.PI / 2;
	sea.position.y = SEA;
	sea.receiveShadow = true;
	root.add(sea);
	const seabed = new THREE.Mesh(keep(new THREE.PlaneGeometry(900, 900)), keep(new THREE.MeshStandardMaterial({ color: '#2d5a6a', roughness: 1 })));
	seabed.rotation.x = -Math.PI / 2;
	seabed.position.y = SEA - 1.0;
	root.add(seabed);

	/** the ground's height at any point, on the land's own triangles (the water's surface over a lake or the sea) */
	const ox = -g.x(0), oz = -g.z(0);
	function heightAt(/** @type {number} */ x, /** @type {number} */ z) {
		const fr = (z + oz) / ROW;
		const r0 = Math.max(0, Math.min(g.H - 2, Math.floor(fr)));
		const t = Math.max(0, Math.min(1, fr - r0));
		const o0 = (r0 & 1) * 0.5, o1 = ((r0 + 1) & 1) * 0.5;
		// across the band of triangles between two rows, sheared so its nodes stand in squares
		const sx = (x + ox) / STEP - o0 - (o1 - o0) * t;
		const c0 = Math.max(0, Math.min(g.W - 2, Math.floor(sx)));
		const f = Math.max(0, Math.min(1, sx - c0));
		const a = (/** @type {number} */ k) => Y(r0 * g.W + k), b = (/** @type {number} */ k) => Y((r0 + 1) * g.W + k);
		const y =
			o1 > o0
				? f + t <= 1
					? a(c0) * (1 - f - t) + a(c0 + 1) * f + b(c0) * t
					: a(c0 + 1) * (1 - t) + b(c0 + 1) * (f + t - 1) + b(c0) * (1 - f)
				: f >= t
					? a(c0) * (1 - f) + a(c0 + 1) * (f - t) + b(c0 + 1) * t
					: a(c0) * (1 - t) + b(c0) * (t - f) + b(c0 + 1) * f;
		return Math.max(y, SEA);
	}
	/** a hex's middle in the world, and one of its corners (between its ways d and d + 1): its side toward way d runs
	 * from corner d to corner d + 1 */
	const HX = (/** @type {number} */ k) => X(plan.centre[k]), HZ = (/** @type {number} */ k) => Z(plan.centre[k]);
	const corner = (/** @type {number} */ k, /** @type {number} */ d, r = HEX_R) => {
		const a = Math.atan2(WAYS[d][1], WAYS[d][0]) + Math.PI / 6;
		return [HX(k) + Math.cos(a) * r, HZ(k) + Math.sin(a) * r];
	};
	/** the hexes worth outlining: those whose middle is dry land */
	const dry = plan.centre.map((n) => st.terrain[n] !== WATER);
	// the hexes' outlines: faint lines lying on the land, only while placing a building or a path
	const outline = (() => {
		/** @type {number[]} */
		const pos = [];
		for (let k = 0; k < P; k++) {
			if (!dry[k]) continue;
			for (let d = 0; d < 6; d++) {
				// a side two hexes share is drawn once
				const o = plan.nbr[k][d];
				if (d >= 3 && o >= 0 && dry[o]) continue;
				const [ax, az] = corner(k, d), [bx, bz] = corner(k, (d + 1) % 6);
				const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.6);
				for (let s = 0; s < n; s++) {
					const x0 = ax + ((bx - ax) * s) / n, z0 = az + ((bz - az) * s) / n, x1 = ax + ((bx - ax) * (s + 1)) / n, z1 = az + ((bz - az) * (s + 1)) / n;
					pos.push(x0, heightAt(x0, z0) + 0.07, z0, x1, heightAt(x1, z1) + 0.07, z1);
				}
			}
		}
		const geo = keep(new THREE.BufferGeometry());
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		const lines = new THREE.LineSegments(geo, keep(new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false })));
		lines.visible = false;
		lines.renderOrder = 2;
		root.add(lines);
		return lines;
	})();
	/**
	 * Whole hexes as a sheet lying on the land, a little in from their sides: each of the six triangles round the
	 * middle cut finer, so the sheet follows the hills.
	 * @param {number[]} hexes @param {number} inset
	 */
	function sheet(hexes, inset) {
		/** @type {number[]} */
		const pos = [];
		const CUT = 9;
		const pt = (/** @type {number} */ x, /** @type {number} */ z) => pos.push(x, heightAt(x, z) + 0.08, z);
		for (const k of hexes)
			for (let d = 0; d < 6; d++) {
				const mx = HX(k), mz = HZ(k);
				const [ax, az] = corner(k, (d + 5) % 6, HEX_R * inset), [bx, bz] = corner(k, d, HEX_R * inset);
				// a point of the triangle (middle, a, b) by how far toward a and toward b
				const at = (/** @type {number} */ i, /** @type {number} */ j) => [mx + ((ax - mx) * i + (bx - mx) * j) / CUT, mz + ((az - mz) * i + (bz - mz) * j) / CUT];
				for (let i = 0; i < CUT; i++)
					for (let j = 0; j < CUT - i; j++) {
						const p0 = at(i, j), p1 = at(i + 1, j), p2 = at(i, j + 1);
						pt(p0[0], p0[1]), pt(p1[0], p1[1]), pt(p2[0], p2[1]);
						if (i + j < CUT - 1) {
							const p3 = at(i + 1, j + 1);
							pt(p1[0], p1[1]), pt(p3[0], p3[1]), pt(p2[0], p2[1]);
						}
					}
			}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		return geo;
	}
	// the hexes of one biome, tinted, while a building that needs it is being placed
	const tileMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
	const tiles = new THREE.Mesh(new THREE.BufferGeometry(), tileMat);
	tiles.renderOrder = 2;
	tiles.visible = false;
	root.add(tiles);
	let tileKey = '';

	let objSeen = -1;
	function syncObjects() {
		if (objSeen === st.objV) return;
		objSeen = st.objV;
		let t = 0, pn = 0, lf = 0, r = 0, f = 0;
		for (let i = 0; i < g.N; i++) {
			const o = st.obj[i];
			if (!o) continue;
			const x = X(i) + (hash(i) - 0.5) * 0.5, z = Z(i) + (hash(i + 7) - 0.5) * 0.5, y = Y(i);
			if (o.k === 'tree') {
				const s = 0.2 + 0.8 * o.g, turn = hash(i) * 6.3;
				put(trunks, t++, x, y, z, s * (0.9 + hash(i + 3) * 0.3), turn);
				if (hash(i + 11) < 0.55) put(pines, pn++, x, y, z, s * (0.85 + hash(i + 5) * 0.35), turn);
				else put(leaves, lf++, x, y, z, s * (0.85 + hash(i + 5) * 0.35), turn);
			} else if (o.k === 'rock') {
				const s = 0.55 + Math.min(1, o.n / 7) * 0.75;
				put(rocks, r++, X(i), y, Z(i), s, hash(i) * 6.3, s * 0.8);
			} else if (o.k === 'field') {
				put(fields, f, X(i), y + 0.06, Z(i), 1, 0.52);
				fields.setColorAt(f++, c.set('#8b6a3e').lerp(tint.set('#7fb04a'), Math.min(1, o.g * 1.6)).lerp(tint.set('#e3c54d'), Math.max(0, o.g * 2 - 1)));
			}
		}
		done(trunks, t);
		done(pines, pn);
		done(leaves, lf);
		done(rocks, r);
		done(fields, f);
	}

	let terSeen = -1;
	const teamColor = TEAM.map((x) => new THREE.Color(x));
	/** the borders of the villages held: a band lying on the land just inside each village's own outline (its seven
	 * hexes), in its owner's colour, so two villages side by side each show theirs; every village's while placing */
	const borderMat = keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
	const borders = new THREE.Mesh(new THREE.BufferGeometry(), borderMat);
	borders.renderOrder = 3;
	borders.visible = false;
	root.add(borders);
	/** and the picked village center's own village alone: one thin line round its seven hexes */
	const pickBorder = new THREE.Mesh(new THREE.BufferGeometry(), borderMat);
	pickBorder.renderOrder = 3;
	pickBorder.visible = false;
	root.add(pickBorder);
	let gridOn = false;
	/** the band round each of these villages @param {number[]} vs @param {number} band its width */
	function villageBand(vs, band) {
		/** @type {number[]} */
		const pos = [], col = [];
		for (const v of vs) {
			const tc = teamColor[st.villageOwner[v] ?? 0] ?? teamColor[0];
			for (const k of plan.villages[v].plots)
				for (let d = 0; d < 6; d++) {
					const o = plan.nbr[k][d];
					if (o >= 0 && plan.villageOf[o] === v) continue;
					// a side of the village's outline: the band runs along it on the inside, a little past both ends so
					// it meets the next side without a gap
					const [cx, cz] = corner(k, d), [ex, ez] = corner(k, (d + 1) % 6);
					const len = Math.hypot(ex - cx, ez - cz), tx = (ex - cx) / len, tz = (ez - cz) / len;
					const mx = (cx + ex) / 2, mz = (cz + ez) / 2, il = Math.hypot(HX(k) - mx, HZ(k) - mz), ix = (HX(k) - mx) / il, iz = (HZ(k) - mz) / il;
					const ax = cx - tx * band, az = cz - tz * band, bx = ex + tx * band, bz = ez + tz * band;
					const n = Math.ceil((len + 2 * band) / 0.4);
					for (let s = 0; s < n; s++) {
						const x0 = ax + ((bx - ax) * s) / n, z0 = az + ((bz - az) * s) / n, x1 = ax + ((bx - ax) * (s + 1)) / n, z1 = az + ((bz - az) * (s + 1)) / n;
						const p0 = [x0 + ix * 0.04, z0 + iz * 0.04], p1 = [x1 + ix * 0.04, z1 + iz * 0.04], q1 = [x1 + ix * (0.04 + band), z1 + iz * (0.04 + band)], q0 = [x0 + ix * (0.04 + band), z0 + iz * (0.04 + band)];
						for (const [x, z] of [p0, p1, q1, p0, q1, q0]) pos.push(x, heightAt(x, z) + 0.09, z), col.push(tc.r, tc.g, tc.b);
					}
				}
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
		return geo;
	}
	function syncBorder() {
		if (terSeen === st.terV) return;
		terSeen = st.terV;
		borders.geometry.dispose();
		borders.geometry = villageBand(plan.villages.map((_, v) => v).filter((v) => (st.villageOwner[v] ?? -1) >= 0), 0.1);
	}

	// ── roads ──
	const roadMat = keep(new THREE.MeshStandardMaterial({ color: '#b39468', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
	// a path: two lanes with a dashed line between them, one way each
	const laneTex = (() => {
		const c = document.createElement('canvas');
		c.width = 32;
		c.height = 64;
		const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
		x.fillStyle = '#b39468';
		x.fillRect(0, 0, 32, 64);
		x.fillStyle = '#efe4c8';
		x.fillRect(15, 6, 2, 26);
		const t = new THREE.CanvasTexture(c);
		t.wrapS = THREE.ClampToEdgeWrapping;
		t.wrapT = THREE.RepeatWrapping;
		t.colorSpace = THREE.SRGBColorSpace;
		return keep(t);
	})();
	const laneMat = keep(new THREE.MeshStandardMaterial({ map: laneTex, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
	/** a path's straight runs: its nodes where it turns @param {number[]} path */
	const runs = (path) => {
		const out = [];
		let from = path[0];
		for (let k = 1; k < path.length; k++) {
			const a = path[k - 1], b = path[k], c = path[k + 1];
			if (c !== undefined && Math.abs((X(b) - X(a)) * (Z(c) - Z(b)) - (Z(b) - Z(a)) * (X(c) - X(b))) < 1e-6) continue;
			out.push([from, b]);
			from = b;
		}
		return out;
	};
	/** @type {THREE.Mesh | null} */
	let roadMesh = null;
	/** a ribbon along a list of nodes @param {number[][]} paths @param {number} width @param {number} lift */
	function ribbon(paths, width, lift) {
		/** @type {number[]} */
		const pos = [];
		for (const path of paths)
			for (let k = 0; k < path.length - 1; k++) {
				const a = path[k], b = path[k + 1];
				const ax = X(a), az = Z(a), bx = X(b), bz = Z(b);
				const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
				const nx = (-dz / len) * (width / 2), nz = (dx / len) * (width / 2);
				const ay = Math.max(Y(a), SEA) + lift, by = Math.max(Y(b), SEA) + lift;
				pos.push(ax + nx, ay, az + nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz, ax + nx, ay, az + nz, bx - nx, by, bz - nz, ax - nx, ay, az - nz);
			}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		geo.computeVertexNormals();
		// the ribbons face up whichever way they were wound
		const n = /** @type {THREE.BufferAttribute} */ (geo.getAttribute('normal'));
		for (let k = 0; k < n.count; k++) if (n.getY(k) < 0) n.setXYZ(k, -n.getX(k), -n.getY(k), -n.getZ(k));
		return geo;
	}
	/** the ground's height under a point, never below the water */
	const groundY = heightAt;
	/** straight ribbons from end to end, lying on the ground all the way (sampled a few times a step, so no hill hides their middle) */
	function line(/** @type {number[][]} */ ends, /** @type {number} */ width, /** @type {number} */ lift) {
		/** @type {number[]} */
		const pos = [], uv = [];
		for (const [a, b] of ends) {
			const ax = X(a), az = Z(a), bx = X(b), bz = Z(b);
			const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
			if (len < 1e-6) continue;
			const nx = (-dz / len) * (width / 2), nz = (dx / len) * (width / 2);
			const steps = Math.max(1, Math.ceil(len * 3));
			for (let k = 0; k < steps; k++) {
				const f0 = k / steps, f1 = (k + 1) / steps;
				const x0 = ax + dx * f0, z0 = az + dz * f0, x1 = ax + dx * f1, z1 = az + dz * f1;
				const y0 = groundY(x0, z0) + lift, y1 = groundY(x1, z1) + lift;
				pos.push(x0 + nx, y0, z0 + nz, x1 + nx, y1, z1 + nz, x1 - nx, y1, z1 - nz, x0 + nx, y0, z0 + nz, x1 - nx, y1, z1 - nz, x0 - nx, y0, z0 - nz);
				// across the ribbon 0…1, along it a repeat every so many world units (for a texture's dots and dashes)
				const v0 = (len * f0) / width, v1 = (len * f1) / width;
				uv.push(1, v0, 1, v1, 0, v1, 1, v0, 0, v1, 0, v0);
			}
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		geo.computeVertexNormals();
		const n = /** @type {THREE.BufferAttribute} */ (geo.getAttribute('normal'));
		for (let k = 0; k < n.count; k++) if (n.getY(k) < 0) n.setXYZ(k, -n.getX(k), -n.getY(k), -n.getZ(k));
		return geo;
	}
	/** ribbons along lines of points on the ground [x, z], bending where they bend (a closed one joins its ends), lying
	 * on the ground all the way */
	function strip(/** @type {{ pts: number[][], closed?: boolean }[]} */ lines, /** @type {number} */ width, /** @type {number} */ lift) {
		/** @type {number[]} */
		const pos = [], uv = [];
		for (const { pts: raw, closed } of lines) {
			// a few points a world unit, so no hill hides a stretch
			const pts = [raw[0]];
			for (let k = 1; k < raw.length + (closed ? 1 : 0); k++) {
				const [x0, z0] = pts[pts.length - 1], [x1, z1] = raw[k % raw.length];
				const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 3);
				for (let j = 1; j <= n; j++) pts.push([x0 + ((x1 - x0) * j) / n, z0 + ((z1 - z0) * j) / n]);
			}
			const m = pts.length;
			if (m < 2) continue;
			// each point's sideways: across the way it runs there (round the join, on a closed one)
			const side = pts.map((_, k) => {
				const [px, pz] = pts[k > 0 ? k - 1 : closed ? m - 2 : 0], [nx, nz] = pts[k < m - 1 ? k + 1 : closed ? 1 : m - 1];
				const dx = nx - px, dz = nz - pz, len = Math.hypot(dx, dz) || 1;
				return [(-dz / len) * (width / 2), (dx / len) * (width / 2)];
			});
			let v = 0;
			for (let k = 0; k < m - 1; k++) {
				const [x0, z0] = pts[k], [x1, z1] = pts[k + 1], [ax, az] = side[k], [bx, bz] = side[k + 1];
				const y0 = groundY(x0, z0) + lift, y1 = groundY(x1, z1) + lift;
				pos.push(x0 + ax, y0, z0 + az, x1 + bx, y1, z1 + bz, x1 - bx, y1, z1 - bz, x0 + ax, y0, z0 + az, x1 - bx, y1, z1 - bz, x0 - ax, y0, z0 - az);
				// across the ribbon 0…1, along it a repeat every so many world units (for a texture's dots and dashes)
				const v1 = v + Math.hypot(x1 - x0, z1 - z0) / width;
				uv.push(1, v, 1, v1, 0, v1, 1, v, 0, v1, 0, v);
				v = v1;
			}
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		geo.computeVertexNormals();
		const n = /** @type {THREE.BufferAttribute} */ (geo.getAttribute('normal'));
		for (let k = 0; k < n.count; k++) if (n.getY(k) < 0) n.setXYZ(k, -n.getX(k), -n.getY(k), -n.getZ(k));
		return geo;
	}
	/** how far out from a village center's middle its spur starts: at the foot of its tower and the crates at its door,
	 * or of a logistics hub's dome */
	const footOf = (/** @type {any} */ b) => (b.type === 'centre' && (b.level || 1) === 1 ? 2.8 : 4.5);
	/**
	 * A path into a village center joins its ring road (./plots.js RING_R), right above its trade routes' ring, and goes
	 * round it the short way to the spur at its door: no path runs into it. The way a carrier walks it, from the far end
	 * [x, z] (pts, with how far along each point lies: run) and whether the path's nodes run the other way (rev); where
	 * the path is drawn up to (cut: the ring's outer edge); the village center's id. Null for any other path, or one
	 * that starts inside the ring.
	 * @param {any} r @returns {{ pts: number[][], run: number[], rev: boolean, far: number, cut: number[][], id: number } | null}
	 */
	function ringRoad(r) {
		const n = r.path.length;
		const centreAt = (/** @type {number} */ node) => {
			const b = st.buildings[st.flags[st.obj[node]?.k === 'flag' ? st.obj[node].id : -1]?.bld];
			return b && big(b.type) && st.flags[b.flag]?.node === node ? b : null;
		};
		const b0 = centreAt(r.path[0]), b1 = centreAt(r.path[n - 1]);
		const b = b1 ?? b0;
		if (!b || (b0 && b1)) return null;
		const rev = !b1;
		const nodes = rev ? [...r.path].reverse() : r.path;
		const c = /** @type {any} */ (sim.ring(b.id));
		const out = (/** @type {number} */ j) => Math.hypot(X(j) - c.x, Z(j) - c.z);
		if (out(nodes[0]) <= RING_R + ROAD_W / 2) return null;
		/** its nodes from the far end until it comes within R of the middle, and the point where it does */
		const upTo = (/** @type {number} */ R) => {
			const pts = [[X(nodes[0]), Z(nodes[0])]];
			let k = 1;
			while (k < n - 1 && out(nodes[k]) > R) pts.push([X(nodes[k]), Z(nodes[k])]), k++;
			const a = nodes[k - 1], e = nodes[k];
			const ax = X(a) - c.x, az = Z(a) - c.z, dx = X(e) - X(a), dz = Z(e) - Z(a);
			const A = dx * dx + dz * dz, B = 2 * (ax * dx + az * dz), C = ax * ax + az * az - R * R;
			const t = A > 1e-9 ? Math.min(1, Math.max(0, (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A))) : 0;
			pts.push([X(a) + dx * t, Z(a) + dz * t]);
			return pts;
		};
		// drawn up to the ring's outer edge, walked on to its middle
		const cut = upTo(RING_R + ROAD_W / 2), pts = upTo(RING_R), at = pts[pts.length - 1];
		// round the ring the short way to the door, then in along the spur to the stop in the middle
		const a0 = Math.atan2(at[1] - c.z, at[0] - c.x), d = ((c.door - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
		const steps = Math.ceil((Math.abs(d) * RING_R) / 0.5);
		for (let j = 1; j <= steps; j++) pts.push(onRing(c, a0 + (d * j) / steps));
		pts.push([c.x, c.z]);
		const run = [0];
		for (let j = 1; j < pts.length; j++) run.push(run[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
		return { pts, run, rev, far: nodes[0], cut, id: b.id };
	}
	/** the paths that join a village center's ring, by id (./view.js ringRoad) @type {Map<number, NonNullable<ReturnType<typeof ringRoad>>>} */
	const ringRoads = new Map();
	/** @type {THREE.Mesh | null} */
	let stubMesh = null;
	let netKey = '';
	/** the paths, a square where they meet in the middle of each hex in use, and a short way from it to each door; round
	 * each village center a path joins, a ring road and a spur from its door out to it */
	function syncRoads() {
		const list = sim.buildingList();
		const key = `${st.netV}:${list.length}:${list.filter((b) => b.type === 'centre' && (b.level || 1) === 1).length}`;
		if (netKey === key) return;
		netKey = key;
		for (const m of [roadMesh, stubMesh]) {
			if (!m) continue;
			m.geometry.dispose();
			root.remove(m);
		}
		ringRoads.clear();
		/** @type {{ pts: number[][], closed?: boolean }[]} */
		const lanes = [];
		/** @type {Set<number>} */
		const ringed = new Set();
		for (const r of Object.values(st.roads)) {
			const w = ringRoad(r);
			if (!w) {
				for (const [a, b] of runs(r.path)) lanes.push({ pts: [[X(a), Z(a)], [X(b), Z(b)]] });
				continue;
			}
			ringRoads.set(r.id, w);
			lanes.push({ pts: w.cut });
			ringed.add(w.id);
		}
		for (const id of ringed) {
			const c = /** @type {any} */ (sim.ring(id)), foot = footOf(st.buildings[id]);
			lanes.push({ pts: Array.from({ length: 96 }, (_, k) => onRing(c, (k / 96) * Math.PI * 2)), closed: true });
			lanes.push({ pts: [[c.x + foot * Math.cos(c.door), c.z + foot * Math.sin(c.door)], onRing(c, c.door).map((v, k) => v - (ROAD_W / 2) * (k ? Math.sin(c.door) : Math.cos(c.door)))] });
		}
		roadMesh = new THREE.Mesh(strip(lanes, ROAD_W, 0.04), laneMat);
		roadMat.side = THREE.DoubleSide;
		roadMesh.receiveShadow = true;
		root.add(roadMesh);
		/** @type {number[][]} */
		const doors = [];
		/** @type {Set<number>} */
		const used = new Set();
		for (const b of list) {
			const f = st.flags[b.flag];
			if (!f) continue;
			used.add(f.node);
			if (!big(b.type)) doors.push([f.node, b.node]);
		}
		for (const r of Object.values(st.roads)) used.add(r.path[0]), used.add(r.path[r.path.length - 1]);
		stubMesh = new THREE.Mesh(line(doors, ROAD_W * 0.5, 0.05), roadMat);
		stubMesh.receiveShadow = true;
		root.add(stubMesh);
		let k = 0;
		stops.clear();
		for (const n of used)
			if (plan.centre[plan.plotOf[n]] === n) {
				const y = Math.max(Y(n), SEA);
				put(squares, k, X(n), y + 0.03, Z(n));
				put(kerbs, k, X(n), y, Z(n));
				put(isles, k, X(n), y + 0.02, Z(n));
				put(bushes, k++, X(n) + 0.12, y + 0.02, Z(n) - 0.1, 1, n);
				stops.add(n);
			}
		for (const m of [squares, kerbs, isles, bushes]) done(m, k);
	}

	// the trade routes: two-lane tunnels in their digger's colour from village center to village center, shown (seen
	// through the ground, dotted at their walls) only while a village center is picked: brighter where they touch it
	let tunSeen = '', picked = 0;
	/** @type {THREE.Mesh[]} */
	let tunMeshes = [];
	const tunTex = (() => {
		const c = document.createElement('canvas');
		c.width = 64;
		c.height = 64;
		const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
		// the two lanes: a see-through floor
		x.fillStyle = 'rgba(255,255,255,0.32)';
		x.fillRect(6, 0, 52, 64);
		// its walls: dotted
		x.fillStyle = 'rgba(255,255,255,0.95)';
		for (let y = 0; y < 64; y += 16) {
			x.fillRect(0, y + 2, 5, 9);
			x.fillRect(59, y + 2, 5, 9);
		}
		// the middle: a dashed line between the lanes, one each way
		x.fillStyle = 'rgba(255,255,255,0.85)';
		for (let y = 0; y < 64; y += 32) x.fillRect(30, y + 4, 4, 18);
		const t = new THREE.CanvasTexture(c);
		t.wrapS = THREE.ClampToEdgeWrapping;
		t.wrapT = THREE.RepeatWrapping;
		t.colorSpace = THREE.SRGBColorSpace;
		return keep(t);
	})();
	/** a tunnel's look in a colour: bright where it touches the picked village center, faint elsewhere */
	const tunMat = (/** @type {string} */ c, /** @type {number} */ opacity) =>
		keep(new THREE.MeshBasicMaterial({ color: c, map: tunTex, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
	const tunMats = TEAM.map((c) => [tunMat(c, 0.45), tunMat(c, 0.95)]);
	/** how wide a tunnel is: two lanes, a bus in each */
	const TUN_W = 1.3;
	/** the trade routes under the ground: a ring road round each village center they join, a spur from its door out to
	 * it, and the routes straight across from ring to ring, never through a village center */
	function syncTunnels() {
		let hubs = 0;
		for (const t of Object.values(st.tunnels)) for (const id of [t.a, t.b]) if (st.buildings[id]?.level === 1) hubs++;
		const key = `${st.tunV}:${picked}:${hubs}`;
		if (tunSeen === key) return;
		tunSeen = key;
		for (const m of tunMeshes) {
			m.geometry.dispose();
			root.remove(m);
		}
		tunMeshes = [];
		if (!picked) return;
		/** @type {Record<string, { pts: number[][], closed?: boolean }[]>} */
		const sets = {};
		const add = (/** @type {number} */ owner, /** @type {boolean} */ on, /** @type {{ pts: number[][], closed?: boolean }} */ l) => (sets[`${owner}:${on ? 1 : 0}`] ??= []).push(l);
		/** @type {Set<number>} */
		const ringed = new Set();
		for (const t of Object.values(st.tunnels)) {
			const a = sim.ring(t.a), b = sim.ring(t.b);
			if (!a || !b) continue;
			const out = Math.atan2(b.z - a.z, b.x - a.x);
			add(t.owner, t.a === picked || t.b === picked, { pts: [onRing(a, out), onRing(b, out + Math.PI)] });
			ringed.add(t.a).add(t.b);
		}
		for (const id of ringed) {
			const c = /** @type {any} */ (sim.ring(id)), b = st.buildings[id], s = c.door, foot = footOf(b);
			add(b.owner, id === picked, { pts: Array.from({ length: 72 }, (_, k) => onRing(c, (k / 72) * Math.PI * 2)), closed: true });
			add(b.owner, id === picked, { pts: [[c.x + foot * Math.cos(s), c.z + foot * Math.sin(s)], onRing(c, s)] });
		}
		for (const [key, lines] of Object.entries(sets)) {
			const [o, on] = key.split(':').map(Number);
			const m = new THREE.Mesh(strip(lines, TUN_W, 0.12), tunMats[o][on]);
			m.renderOrder = 3 + on;
			root.add(m);
			tunMeshes.push(m);
		}
	}

	// ── flags and the wares at them ──
	const wareColor = Object.fromEntries(Object.values(WARES).map((w) => [w.id, new THREE.Color(w.color)]));
	function syncFlags() {
		let w = 0;
		for (const flag of Object.values(st.flags)) {
			const n = flag.node, x = X(n), y = Math.max(Y(n), SEA), z = Z(n);
			// no flag stands there any more: a settlement's middle is a roundabout where its paths meet, its wares on its island
			const isle = stops.has(n) ? 0.16 : 0;
			flag.wares.forEach((/** @type {number} */ id, /** @type {number} */ k) => {
				const ware = st.wares[id];
				if (!ware) return;
				const a = (k / 8) * Math.PI * 2 + 0.4, r = isle ? ISLE * 0.62 : 0.42;
				put(wares, w, x + Math.cos(a) * r, y + 0.09 + isle, z + Math.sin(a) * r, isle ? 0.8 : 1, a);
				wares.setColorAt(w++, wareColor[ware.type]);
			});
		}
		done(wares, w);
	}

	// ── buildings ──
	/** @type {Map<number, { group: THREE.Group, model: THREE.Group, scaffold: THREE.Group | null, owner: number, smoke: THREE.Object3D[], look: number }>} */
	const shown = new Map();
	/** a building turns its door to its hex's middle */
	const door = (/** @type {number} */ node) => {
		const f = plan.centre[plan.plotOf[node]];
		return Math.atan2(X(f) - X(node), Z(f) - Z(node));
	};
	const big = (/** @type {string} */ type) => type === 'centre' || type === 'village';
	/** where a building stands: a village center in the middle of its hex, which it fills; the rest on their spots */
	const stand = (/** @type {string} */ type, /** @type {number} */ node) => (big(type) ? plan.centre[plan.plotOf[node]] : node);
	/** a house grows with its size, one dome ever larger: from a hut to a great dome of 248 */
	const HOUSE_SCALE = [0.62, 0.78, 0.94, 1.15, 1.4, 1.7, 2.0, 2.35];
	const sizeHouse = (/** @type {THREE.Object3D} */ m, /** @type {number} */ level) => m.scale.setScalar(HOUSE_SCALE[level - 1]);
	/** the wood building's dome grows with each upgrade too: forester, woodcutter, sawmill, timber works; and so do the
	 * steel building's (iron mine, furnace, steelworks), the clay building's (clay pit, kiln, block works) and the glass
	 * building's (sand pit, glassworks, solar panel works) */
	const WOOD_SCALE = [0.8, 1, 1.3, 1.6];
	const STEEL_SCALE = [1, 1.25, 1.55];
	/** the buildings that grow by upgrades, besides houses */
	const grows = (/** @type {string | undefined} */ type) => type === 'woodcutter' || type === 'ironmine' || type === 'clayworks' || type === 'glassworks';
	/** how large a building that grows by upgrades stands at a level */
	const grown = (/** @type {string} */ type, /** @type {number} */ level) => (type === 'woodcutter' ? WOOD_SCALE : STEEL_SCALE)[level - 1];
	function syncBuildings(/** @type {number} */ t) {
		for (const [id, s] of shown)
			if (!st.buildings[id]) {
				root.remove(s.group);
				shown.delete(id);
			}
		for (const b of Object.values(st.buildings)) {
			let s = shown.get(b.id);
			// the wood and steel buildings look their level: built anew when they are upgraded
			const look = b.type === 'woodcutter' ? (b.level ? b.level : b.stage === 'live' ? 2 : 1) : grows(b.type) || b.type === 'centre' ? b.level || 1 : 0;
			if (s && s.look !== look) {
				root.remove(s.group);
				s.group.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
				shown.delete(b.id);
				s = undefined;
			}
			if (!s) {
				const group = new THREE.Group();
				const model = buildingModel(b.type, b.owner, look || undefined);
				group.add(model);
				const at = stand(b.type, b.node);
				group.position.set(X(at), Y(at), Z(at));
				group.rotation.y = door(b.node);
				if (big(b.type)) group.scale.set(CENTRE_SCALE, CENTRE_TALL, CENTRE_SCALE);
				group.userData.building = b.id;
				const smoke = /** @type {THREE.Object3D[]} */ ([]);
				model.traverse((o) => o.name === 'smoke' && smoke.push(o));
				s = { group, model, scaffold: null, owner: b.owner, smoke, look };
				root.add(group);
				shown.set(b.id, s);
			}
			if (b.stage === 'site') {
				if (!s.scaffold) s.group.add((s.scaffold = scaffold()));
				const total = Object.values(b.cost).reduce((/** @type {number} */ a, /** @type {any} */ n) => a + n, 0);
				const used = Object.values(b.used).reduce((/** @type {number} */ a, /** @type {any} */ n) => a + n, 0);
				// a house being enlarged stands meanwhile at its size, and wood being upgraded as it was; anything new rises
				// from the ground
				if (b.type === 'house' && b.level) sizeHouse(s.model, b.level);
				else if (grows(b.type) && b.level) s.model.scale.setScalar(grown(b.type, b.level));
				else {
					const w = b.type === 'woodcutter' ? WOOD_SCALE[0] : 1;
					s.model.scale.set(w, w * Math.max(0.06, used / Math.max(1, total)), w);
				}
			} else if (s.scaffold) {
				s.group.remove(s.scaffold);
				s.scaffold = null;
				s.model.scale.set(1, 1, 1);
			}
			if (b.type === 'house' && b.stage === 'live') sizeHouse(s.model, Math.max(1, b.level));
			if (grows(b.type) && b.stage === 'live') s.model.scale.setScalar(grown(b.type, look));
			if (s.owner !== b.owner) {
				recolour(s.model, b.owner);
				s.owner = b.owner;
			}
			const busy = b.stage === 'live' && b.timer > 0;
			for (const sm of s.smoke) {
				sm.visible = busy;
				if (busy)
					for (const puff of sm.children) {
						const k = (((t * 0.5 + puff.userData.k / 4) % 1) + 1) % 1;
						puff.position.set(Math.sin(k * 5 + puff.userData.k) * 0.12, k * 1.4, 0);
						puff.scale.setScalar(0.6 + k * 1.4);
						/** @type {THREE.MeshStandardMaterial} */ (/** @type {THREE.Mesh} */ (puff).material).opacity = 0.55 * (1 - k);
					}
			}
		}
	}

	// ── people ──
	const KIND = { carrier: new THREE.Color('#e3a23a'), worker: new THREE.Color('#4e9a3a'), builder: new THREE.Color('#d4502a') };
	const at = new THREE.Vector3();
	/** where each walker was last frame, to face where it goes @type {Map<number, number[]>} */
	const last = new Map();
	/** the carrier of a path that joins a village center's ring, while it walks that path: the path's way (ringRoad) */
	const ringOf = (/** @type {any} */ u) => {
		const w = u.kind === 'carrier' ? ringRoads.get(u.road) : undefined, r = w && st.roads[u.road];
		return r && u.path.length === r.path.length && u.path[0] === r.path[0] && u.path[u.path.length - 1] === r.path[r.path.length - 1] ? w : null;
	};
	function unitPos(/** @type {any} */ u) {
		const n = u.path.length, p = Math.max(0, Math.min(n - 1, u.p)), dir = u.tgt >= u.p ? 1 : -1;
		// within half a step of a roundabout it drives round the island, counter-clockwise (the way right-hand traffic
		// goes round), from the path it came by to the path it leaves by
		const i = Math.round(p), m = u.path[i];
		const w = ringOf(u);
		if (w && m !== w.far) {
			// on a path into a village center: on along it to the ring, round to the door, in along the spur. Its steps are
			// the path's, spread over the longer way (the first half step as it is, off the island at the far end)
			const q = w.rev ? n - 1 - p : p, all = (n - 1) * STEP, s = q * STEP, L = w.run[w.run.length - 1];
			const h = stops.has(w.far) ? STEP / 2 : 0, d = s <= h ? s : h + ((s - h) * (L - h)) / Math.max(1e-6, all - h);
			let lo = 0, hi = w.run.length - 1;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (w.run[mid] <= d) lo = mid;
				else hi = mid;
			}
			const [ax, az] = w.pts[lo], [bx, bz] = w.pts[hi], len = w.run[hi] - w.run[lo] || 1, f = Math.min(1, Math.max(0, (d - w.run[lo]) / len));
			// it keeps to the right-hand lane of the way it goes, easing out of the middle of the road off the island
			const fwd = w.rev ? -dir : dir, side = ((fwd * LANE) / len) * Math.min(1, Math.max(0, (q - (h ? 0.5 : -1)) * 2));
			const x = ax + (bx - ax) * f - (bz - az) * side, z = az + (bz - az) * f + (bx - ax) * side;
			return at.set(x, groundY(x, z), z);
		}
		if (stops.has(m)) {
			const from = u.path[i - dir], to = u.path[i + dir];
			const ang = (/** @type {number} */ j) => Math.atan2(Z(j) - Z(m), X(j) - X(m));
			const ain = from !== undefined ? ang(from) : to !== undefined ? ang(to) : 0, aout = to !== undefined ? ang(to) : ain;
			const sweep = (((ain - aout) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
			const s = Math.min(1, Math.max(0, (p - i) * dir + 0.5));
			const a = ain - sweep * s, x = X(m) + Math.cos(a) * RING, z = Z(m) + Math.sin(a) * RING;
			return at.set(x, groundY(x, z), z);
		}
		const k = Math.min(n - 1, Math.floor(p));
		const f = Math.min(1, Math.max(0, p - k));
		const a = u.path[k], b = u.path[Math.min(n - 1, k + 1)];
		// it keeps to the right-hand lane of the way it goes, so every path runs both ways at once (easing into the
		// middle of the road where it meets a roundabout)
		const a0 = a === b && k > 0 ? u.path[k - 1] : a, b0 = a === b && k > 0 ? a : b;
		const near = Math.min(stops.has(a) ? f : 1, stops.has(b) ? 1 - f : 1);
		const dx = X(b0) - X(a0), dz = Z(b0) - Z(a0), len = Math.hypot(dx, dz), side = len > 1e-6 ? ((dir * LANE) / len) * Math.min(1, Math.max(0, (near - 0.5) * 2)) : 0;
		return at.set(X(a) + (X(b) - X(a)) * f - dz * side, Math.max(Y(a), SEA) + (Math.max(Y(b), SEA) - Math.max(Y(a), SEA)) * f, Z(a) + (Z(b) - Z(a)) * f + dx * side);
	}
	/** whether a node is a village center's stop: where a cart's straight legs meet */
	const isCentre = (/** @type {number} */ n) => {
		const o = st.obj[n];
		const b = o?.k === 'flag' ? st.buildings[st.flags[o.id]?.bld] : null;
		return !!b && big(b.type);
	};
	/** @type {WeakMap<object, { pts: number[][], run: number[] } | null>} */
	const cartWays = new WeakMap();
	/** a cart's way on the ground round the ring roads (./plots.js ringWay), with how far along each point lies; null for
	 * a cart of an older save, or one whose village centers are gone */
	function cartWay(/** @type {any} */ u) {
		let w = cartWays.get(u);
		if (w === undefined) {
			const chain = (u.via ?? []).map((/** @type {number} */ id) => sim.ring(id));
			w = null;
			if (chain.length >= 2 && chain.every(Boolean)) {
				const pts = ringWay(chain, 0.5), run = [0];
				for (let k = 1; k < pts.length; k++) run.push(run[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
				w = { pts, run };
			}
			cartWays.set(u, w);
		}
		return w;
	}
	/** a cart goes round the ring roads and straight across between them, as far along its way as its steps say */
	function cartPos(/** @type {any} */ u) {
		const n = u.path.length, p = Math.max(0, Math.min(n - 1, u.p));
		const w = cartWay(u);
		if (w) {
			const { pts, run } = w, d = (p / Math.max(1, n - 1)) * run[run.length - 1];
			let lo = 0, hi = run.length - 1;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (run[mid] <= d) lo = mid;
				else hi = mid;
			}
			const [ax, az] = pts[lo], [bx, bz] = pts[hi], len = run[hi] - run[lo] || 1, f = Math.min(1, (d - run[lo]) / len);
			// it keeps to its own lane: the right-hand one of the way it goes
			const dx = bx - ax, dz = bz - az, side = ((u.tgt >= u.p ? 1 : -1) * TUN_W) / 4;
			const x = ax + dx * f - (dz / len) * side, z = az + dz * f + (dx / len) * side;
			return at.set(x, groundY(x, z), z);
		}
		// a cart of an older save goes straight from village center to village center, however its steps were counted
		let k0 = Math.floor(p), k1 = Math.min(n - 1, k0 + 1);
		while (k0 > 0 && !isCentre(u.path[k0])) k0--;
		while (k1 < n - 1 && !isCentre(u.path[k1])) k1++;
		const a = u.path[k0], b = u.path[k1], f = k1 > k0 ? (p - k0) / (k1 - k0) : 0;
		// it keeps to its own lane: the right-hand one of the way it goes
		const dx = X(b) - X(a), dz = Z(b) - Z(a), len = Math.hypot(dx, dz) || 1, side = ((u.tgt >= u.p ? 1 : -1) * TUN_W) / 4;
		const x = X(a) + dx * f - (dz / len) * side, z = Z(a) + dz * f + (dx / len) * side;
		return at.set(x, groundY(x, z), z);
	}
	function syncUnits(/** @type {number} */ t) {
		let k = 0, l = 0;
		for (const u of Object.values(st.units)) {
			// the buses under the ground show with their tunnels: while a village center is picked
			if (u.inside || (u.kind === 'cart' && !picked)) continue;
			const p = u.kind === 'cart' ? cartPos(u) : unitPos(u);
			let x = p.x, y = p.y, z = p.z, bob = 0;
			const moving = u.p !== u.tgt && !u.wait;
			if (moving) bob = Math.abs(Math.sin(t * 11 + u.id)) * 0.015;
			if (u.job === 'b-work') {
				x += 0.9;
				z += 0.4;
				bob = Math.abs(Math.sin(t * 9 + u.id)) * 0.05;
			}
			const was = last.get(u.id);
			// a bus keeps the line it last ran along: it has no front, so it only lines up with the way, never turns round
			const dx = was ? p.x - was[0] : 0, dz = was ? p.z - was[1] : 0;
			if (was) {
				if (dx * dx + dz * dz > 1e-6) was[2] = Math.atan2(dx, dz) % Math.PI;
				(was[0] = p.x), (was[1] = p.z);
			} else last.set(u.id, [p.x, p.z, 0]);
			const turn = last.get(u.id)?.[2] ?? 0;
			if (k >= BUSES) continue;
			// on a trade route under the ground: the same bus at twice the size, in the colour of what it carries (its city's, with settlers)
			const cart = u.kind === 'cart', size = cart ? 2.7 : 1.35, lift = cart ? 0.02 : bob;
			put(buses, k, x, y + lift, z, size, turn);
			put(glass, k, x, y + lift, z, size, turn);
			put(lamps, k, x, y + lift, z, size, turn);
			put(lampsBack, k, x, y + lift, z, size, turn);
			for (const w of wheels) put(w, k, x, y + lift, z, size, turn);
			buses.setColorAt(k++, cart ? (u.ware ? wareColor[u.ware] : teamColor[u.owner]) : /** @type {Record<string, THREE.Color>} */ (KIND)[u.kind]);
			if (u.ware && !cart) {
				put(loads, l, x, y + bob, z, size, turn);
				loads.setColorAt(l++, wareColor[u.ware]);
			}
		}
		done(buses, k);
		done(glass, k);
		done(lamps, k);
		done(lampsBack, k);
		for (const w of wheels) done(w, k);
		done(loads, l);
		if (last.size > k * 2 + 50) for (const id of last.keys()) if (!st.units[id]) last.delete(id);
	}

	// ── fire where a building burned ──
	/** @type {Map<string, THREE.Group>} */
	const fires = new Map();
	const flameMat = keep(new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.85 }));
	const smokeMat = keep(new THREE.MeshStandardMaterial({ color: '#3a3632', transparent: true, opacity: 0.5 }));
	function syncFires(/** @type {number} */ t) {
		const live = new Set();
		for (const f of st.fx) {
			const key = `${f.node}/${f.t}`;
			live.add(key);
			let grp = fires.get(key);
			if (!grp) {
				grp = new THREE.Group();
				for (let k = 0; k < 4; k++) {
					const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 5), flameMat);
					flame.position.set(Math.cos(k * 1.6) * 0.4, 0.4, Math.sin(k * 1.6) * 0.4);
					grp.add(flame);
				}
				const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), smokeMat);
				puff.name = 'smoke';
				grp.add(puff);
				grp.position.set(X(f.node), Y(f.node), Z(f.node));
				root.add(grp);
				fires.set(key, grp);
			}
			const age = st.time - f.t;
			grp.children.forEach((ch, k) => {
				if (ch.name === 'smoke') {
					ch.position.y = 1.2 + ((t * 0.6) % 1) * 1.5;
					ch.scale.setScalar(1 + ((t * 0.6) % 1));
				} else ch.scale.set(1, Math.max(0.05, (1 - age / 12) * (0.7 + 0.3 * Math.sin(t * 12 + k * 2))), 1);
			});
		}
		for (const [key, grp] of fires)
			if (!live.has(key)) {
				root.remove(grp);
				grp.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
				fires.delete(key);
			}
	}

	// ── what the player is about to do: the spots a building may stand on, a ghost of it, a road's way ──
	const ring = new THREE.Mesh(keep(new THREE.RingGeometry(0.75, 0.95, 24).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false })));
	ring.renderOrder = 5;
	ring.visible = false;
	root.add(ring);
	const hover = new THREE.Mesh(keep(new THREE.RingGeometry(0.55, 0.72, 6).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthTest: false })));
	hover.renderOrder = 5;
	hover.visible = false;
	root.add(hover);
	/** @type {THREE.Group | null} */
	let ghost = null, ghostType = '';
	const ghostOk = keep(new THREE.MeshStandardMaterial({ color: '#7be07b', transparent: true, opacity: 0.55 }));
	const ghostNo = keep(new THREE.MeshStandardMaterial({ color: '#ff6a5a', transparent: true, opacity: 0.5 }));
	/** @type {THREE.Mesh | null} */
	let preview = null;
	const previewOk = keep(new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));

	let flagClock = 0;
	return {
		root,
		land,
		/** draw the state as it is now @param {number} t seconds, for what moves */
		update(t) {
			syncObjects();
			syncBorder();
			syncRoads();
			syncTunnels();
			if (t - flagClock > 0.1) {
				flagClock = t;
				syncFlags();
			}
			syncBuildings(t);
			syncUnits(t);
			syncFires(t);
		},
		/** the building a ray hits first, if any @param {THREE.Raycaster} ray */
		pickBuilding(ray) {
			const hits = ray.intersectObjects([...shown.values()].map((s) => s.group), true);
			for (const h of hits) {
				/** @type {THREE.Object3D | null} */
				let o = h.object;
				while (o && o.userData.building === undefined) o = o.parent;
				if (o) return /** @type {number} */ (o.userData.building);
			}
			return 0;
		},
		/** the ring round what is selected @param {number} node */
		select(node) {
			const o = node >= 0 ? st.obj[node] : null;
			const b = o?.k === 'bld' ? st.buildings[o.id] : null;
			picked = b && big(b.type) ? b.id : 0;
			ring.visible = node >= 0;
			const at = b ? stand(b.type, node) : node;
			// round what is picked: a village center, a house of its size, any other dome
			ring.scale.setScalar(picked ? CENTRE_SCALE * 1.95 : b?.type === 'house' && b.level ? Math.max(1, HOUSE_SCALE[b.level - 1] * 1.15) : grows(b?.type) && b.level ? Math.max(1, grown(b.type, b.level) * 1.1) : 1);
			// a picked village center shows its own village's border, alone
			pickBorder.visible = !!picked && !gridOn;
			if (picked && b) {
				pickBorder.geometry.dispose();
				pickBorder.geometry = villageBand([plan.villageOf[plan.plotOf[b.node]]], 0.12);
			}
			if (node >= 0) ring.position.set(X(at), Math.max(Y(at), SEA) + 0.08, Z(at));
		},
		/** show the hexes' outlines and the villages' borders (while placing), or hide them @param {boolean} on */
		grid(on) {
			gridOn = on;
			outline.visible = on;
			borders.visible = on;
			pickBorder.visible = !!picked && !on;
		},
		/** the ring under the cursor, in a colour @param {number} node @param {string} [color] */
		hover(node, color = '#ffffff') {
			hover.visible = node >= 0;
			if (node < 0) return;
			hover.position.set(X(node), Math.max(Y(node), SEA) + 0.08, Z(node));
			/** @type {THREE.MeshBasicMaterial} */ (hover.material).color.set(color);
		},
		/** a ghost of the building about to be placed @param {string} type @param {number} node @param {boolean} ok */
		ghost(type, node, ok) {
			if (!type || node < 0) {
				if (ghost) ghost.visible = false;
				return;
			}
			if (!ghost || ghostType !== type) {
				if (ghost) root.remove(ghost);
				ghost = buildingModel(type, 0, type === 'ironmine' || type === 'clayworks' || type === 'glassworks' || type === 'centre' ? 1 : undefined);
				ghostType = type;
				root.add(ghost);
			}
			ghost.visible = true;
			const at = stand(type, node);
			ghost.position.set(X(at), Y(at), Z(at));
			ghost.rotation.y = door(node);
			if (big(type)) ghost.scale.set(CENTRE_SCALE, CENTRE_TALL, CENTRE_SCALE);
			else ghost.scale.setScalar(1);
			ghost.traverse((o) => {
				if (o instanceof THREE.Mesh) {
					o.material = ok ? ghostOk : ghostNo;
					o.castShadow = false;
				}
			});
		},
		/** the spots a building may stand on @param {number[]} nodes */
		spots(nodes) {
			nodes.forEach((n, k) => {
				put(spots, k, X(n), Y(n) + 0.05, Z(n), 0.8, 0.52);
				spots.setColorAt(k, c.set('#9dff8a'));
			});
			done(spots, nodes.length);
		},
		/** tint whole settlement hexes (by their middle nodes) in a biome's colour @param {number[]} centres @param {string} color */
		tiles(centres, color = '#ffffff') {
			const hexes = centres.map((n) => plan.plotOf[n]);
			const key = hexes.join(',');
			tiles.visible = hexes.length > 0;
			tileMat.color.set(color);
			if (key === tileKey) return;
			tileKey = key;
			tiles.geometry.dispose();
			tiles.geometry = sheet(hexes, 0.94);
		},
		/** the way a road would take @param {number[] | null} path */
		road(path) {
			if (preview) {
				preview.geometry.dispose();
				root.remove(preview);
				preview = null;
			}
			if (!path || path.length < 2) return;
			preview = new THREE.Mesh(ribbon([path], ROAD_W * 0.8, 0.1), previewOk);
			preview.renderOrder = 4;
			root.add(preview);
		},
		/** where a node is in the world (a village center's: the middle of its hex) @param {number} n */
		place(n) {
			const o = n >= 0 ? st.obj[n] : null;
			const b = o?.k === 'bld' ? st.buildings[o.id] : null;
			const at = b ? stand(b.type, n) : n;
			return new THREE.Vector3(X(at), Math.max(Y(at), SEA), Z(at));
		},
		dispose() {
			scene.remove(root);
			for (const s of shown.values()) s.group.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
			ghost?.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
			preview?.geometry.dispose();
			roadMesh?.geometry.dispose();
			stubMesh?.geometry.dispose();
			tiles.geometry.dispose();
			borders.geometry.dispose();
			pickBorder.geometry.dispose();
			for (const m of tunMeshes) m.geometry.dispose();
			for (const grp of fires.values()) grp.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
			for (const d of disposables) d.dispose();
		}
	};
}
