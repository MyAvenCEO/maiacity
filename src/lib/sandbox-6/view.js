/**
 * SANDBOX 6 · THE VIEW — the simulation (./sim.js) drawn in three.js, and nothing else: it reads the state every
 * frame and never changes it. The valley's land is a field of hex tiles, as on the island of Sandbox 1, each in the
 * colour of its biome, with peaks on its mountains; trees, rocks, fields, wares, the borders of villages and people
 * are instanced; each building is its own model (./models.js), a village center large enough to fill its hex. Only
 * what changed is rebuilt: the state counts its changes (objV, netV, terV).
 */
import * as THREE from 'three';
import { WARES, WATER } from './rules.js';
import { buildingModel, mat, recolour, scaffold, TEAM } from './models.js';
import { STEP } from './hex.js';
import { K } from './plots.js';

const ROAD_W = 0.42;
/** the water's surface */
export const SEA = -0.3;
/** a hex's radius, middle to corner, and middle to the middle of a side */
const HEX_R = (K * STEP) / Math.sqrt(3), HEX_IN = (K * STEP) / 2;
/** the ground of each biome */
const GROUND = /** @type {Record<string, string>} */ ({ meadow: '#86b35a', forest: '#4f8a45', stone: '#a9a597', iron: '#a2735a', water: '#d8c690', mountain: '#8d867b', lake: '#4f6f64', sea: '#2d5a6a' });
/** the six ways out of a hex, in the world: east, north-east, north-west, west, south-west, south-east */
const WAYS = [[1, 0], [0.5, -Math.sqrt(3) / 2], [-0.5, -Math.sqrt(3) / 2], [-1, 0], [-0.5, Math.sqrt(3) / 2], [0.5, Math.sqrt(3) / 2]];
/** how much larger a village center is drawn than its model: it fills its hex; and the domes round a hex's middle */
const CENTRE_SCALE = 1.9, DOME_SCALE = 1.3;

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
	const fields = inst(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 6), white, g.N, false);
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
	// the settlement hexes of one biome, tinted, while a building that needs it is being placed
	const tiles = inst(new THREE.CylinderGeometry(HEX_R * 0.9, HEX_R * 0.9, 0.04, 6), keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false })), g.N, false);
	tiles.receiveShadow = false;

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

	// ── the land: a hex tile for every hex, in its biome's colour, a little up or down; peaks on the mountains ──
	const plan = sim.plan, P = plan.centre.length;
	const c = new THREE.Color(), tint = new THREE.Color();
	/** a hex's middle in the world, and the top of its tile */
	const HX = (/** @type {number} */ k) => X(plan.centre[k]), HZ = (/** @type {number} */ k) => Z(plan.centre[k]);
	const top = (/** @type {number} */ k) => Y(plan.centre[k]);
	const land = inst(new THREE.CylinderGeometry(HEX_R * 0.95, HEX_R * 0.99, 3, 6).translate(0, -1.5, 0), keep(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })), P, false);
	land.name = 'land';
	const peaks = inst(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0), keep(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true })), P * 8);
	{
		let n = 0, m = 0;
		for (let k = 0; k < P; k++) {
			const b = st.biome[k];
			if (b === 'sea') continue;
			const y = b === 'lake' ? top(k) + 0.2 : top(k);
			put(land, n, HX(k), y, HZ(k));
			land.setColorAt(n++, c.set(GROUND[b] ?? GROUND.meadow).lerp(tint.set('#ffffff'), (hash(k + 101) - 0.5) * 0.08));
			// a mountain: a great peak in its middle and smaller ones round it; iron: rust-red crags on its free corners
			const peak = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ r, /** @type {number} */ h, /** @type {string} */ col) => {
				put(peaks, m, x, top(k) - 0.05, z, r, hash(m + 3) * 6.3, h);
				peaks.setColorAt(m++, c.set(col).lerp(tint.set('#ffffff'), hash(m + 9) * 0.12));
			};
			if (b === 'mountain') {
				peak(HX(k), HZ(k), 2.3, 3.6 + hash(k) * 1.4, '#8a8378');
				for (const j of [...plan.spots[k], ...plan.free[k]]) if (j >= 0) peak(X(j), Z(j), 1.1 + hash(j) * 0.4, 1.5 + hash(j + 1) * 1.2, '#958d81');
			} else if (b === 'iron') for (const j of plan.free[k]) if (j >= 0) peak(X(j), Z(j), 1.0 + hash(j) * 0.3, 1.2 + hash(j + 1) * 0.8, '#9a5638');
		}
		done(land, n);
		done(peaks, m);
		land.castShadow = false;
	}
	const sea = new THREE.Mesh(keep(new THREE.PlaneGeometry(900, 900)), keep(new THREE.MeshStandardMaterial({ color: '#3a7fa4', roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.88 })));
	sea.rotation.x = -Math.PI / 2;
	sea.position.y = SEA;
	sea.receiveShadow = true;
	root.add(sea);
	const seabed = new THREE.Mesh(keep(new THREE.PlaneGeometry(900, 900)), keep(new THREE.MeshStandardMaterial({ color: '#2d5a6a', roughness: 1 })));
	seabed.rotation.x = -Math.PI / 2;
	seabed.position.y = SEA - 1.0;
	root.add(seabed);

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
	/** the borders of the villages held: a band along every side of a held hex that faces a hex held by nobody or another */
	const borders = inst(new THREE.BoxGeometry(1, 0.14, 0.26), white, P * 6, false);
	function syncBorder() {
		if (terSeen === st.terV) return;
		terSeen = st.terV;
		let n = 0;
		const held = (/** @type {number} */ k) => (k < 0 ? -1 : st.owner[plan.centre[k]]);
		for (let k = 0; k < P; k++) {
			const o = held(k);
			if (o < 0 || st.biome[k] === 'sea' || st.biome[k] === 'lake') continue;
			for (let d = 0; d < 6; d++) {
				if (held(plan.nbr[k][d]) === o) continue;
				const [dx, dz] = WAYS[d];
				borders.setMatrixAt(n, m4.compose(p3.set(HX(k) + dx * (HEX_IN - 0.2), top(k) + 0.05, HZ(k) + dz * (HEX_IN - 0.2)), q.setFromAxisAngle(yAxis, Math.atan2(-dx, -dz)), s3.set(HEX_R * 0.98, 1, 1)));
				borders.setColorAt(n++, teamColor[o]);
			}
		}
		done(borders, n);
	}

	// ── roads ──
	let netSeen = -1;
	const roadMat = keep(new THREE.MeshStandardMaterial({ color: '#b39468', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
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
	/** the ground's height under a point: whichever node it is nearest, never below the water */
	const groundY = (/** @type {number} */ x, /** @type {number} */ z) => {
		const n = g.at(x, z);
		return n < 0 ? SEA : Math.max(Y(n), SEA);
	};
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
	function syncRoads() {
		if (netSeen === st.netV) return;
		netSeen = st.netV;
		if (roadMesh) {
			roadMesh.geometry.dispose();
			root.remove(roadMesh);
		}
		roadMesh = new THREE.Mesh(ribbon(Object.values(st.roads).map((r) => r.path), ROAD_W, 0.04), roadMat);
		roadMat.side = THREE.DoubleSide;
		roadMesh.receiveShadow = true;
		root.add(roadMesh);
	}

	// the trade routes: two-lane tunnels in their digger's colour from village center to village center, shown (seen
	// through the ground, dotted at their walls) only while a village center is picked: brighter where they touch it
	let tunSeen = -1, tunPick = -1, picked = 0;
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
	function syncTunnels() {
		if (tunSeen === st.tunV && tunPick === picked) return;
		tunSeen = st.tunV;
		tunPick = picked;
		for (const m of tunMeshes) {
			m.geometry.dispose();
			root.remove(m);
		}
		tunMeshes = [];
		if (!picked) return;
		/** @type {Record<string, number[][]>} */
		const sets = {};
		for (const t of Object.values(st.tunnels)) (sets[`${t.owner}:${t.a === picked || t.b === picked ? 1 : 0}`] ??= []).push([t.path[0], t.path[t.path.length - 1]]);
		for (const [key, ends] of Object.entries(sets)) {
			const [o, on] = key.split(':').map(Number);
			const m = new THREE.Mesh(line(ends, TUN_W, 0.12), tunMats[o][on]);
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
			// no flag stands there any more: a settlement's middle is a stop where its paths meet, its wares round it
			flag.wares.forEach((/** @type {number} */ id, /** @type {number} */ k) => {
				const ware = st.wares[id];
				if (!ware) return;
				const a = (k / 8) * Math.PI * 2 + 0.4;
				put(wares, w, x + Math.cos(a) * 0.42, y + 0.09, z + Math.sin(a) * 0.42, 1, a);
				wares.setColorAt(w++, wareColor[ware.type]);
			});
		}
		done(wares, w);
	}

	// ── buildings ──
	/** @type {Map<number, { group: THREE.Group, model: THREE.Group, scaffold: THREE.Group | null, owner: number, smoke: THREE.Object3D[] }>} */
	const shown = new Map();
	/** a building turns its door to its hex's middle */
	const door = (/** @type {number} */ node) => {
		const f = plan.centre[plan.plotOf[node]];
		return Math.atan2(X(f) - X(node), Z(f) - Z(node));
	};
	const big = (/** @type {string} */ type) => type === 'centre' || type === 'village';
	/** where a building stands: a village center in the middle of its hex, which it fills; the rest on their spots */
	const stand = (/** @type {string} */ type, /** @type {number} */ node) => (big(type) ? plan.centre[plan.plotOf[node]] : node);
	/** a house grows with its size */
	const HOUSE_SCALE = [0.62, 0.78, 0.94, 1.15];
	function syncBuildings(/** @type {number} */ t) {
		for (const [id, s] of shown)
			if (!st.buildings[id]) {
				root.remove(s.group);
				shown.delete(id);
			}
		for (const b of Object.values(st.buildings)) {
			let s = shown.get(b.id);
			if (!s) {
				const group = new THREE.Group();
				const model = buildingModel(b.type, b.owner);
				group.add(model);
				const at = stand(b.type, b.node);
				group.position.set(X(at), Y(at), Z(at));
				group.rotation.y = door(b.node);
				if (big(b.type)) group.scale.set(CENTRE_SCALE, CENTRE_SCALE * 0.7, CENTRE_SCALE);
				else group.scale.setScalar(DOME_SCALE);
				group.userData.building = b.id;
				const smoke = /** @type {THREE.Object3D[]} */ ([]);
				model.traverse((o) => o.name === 'smoke' && smoke.push(o));
				s = { group, model, scaffold: null, owner: b.owner, smoke };
				root.add(group);
				shown.set(b.id, s);
			}
			if (b.stage === 'site') {
				if (!s.scaffold) s.group.add((s.scaffold = scaffold()));
				const total = Object.values(b.cost).reduce((/** @type {number} */ a, /** @type {any} */ n) => a + n, 0);
				const used = Object.values(b.used).reduce((/** @type {number} */ a, /** @type {any} */ n) => a + n, 0);
				// a house being enlarged stands meanwhile at its size; anything new rises from the ground
				if (b.type === 'house' && b.level) s.model.scale.setScalar(HOUSE_SCALE[b.level - 1]);
				else s.model.scale.set(1, Math.max(0.06, used / Math.max(1, total)), 1);
			} else if (s.scaffold) {
				s.group.remove(s.scaffold);
				s.scaffold = null;
				s.model.scale.set(1, 1, 1);
			}
			if (b.type === 'house' && b.stage === 'live') s.model.scale.setScalar(HOUSE_SCALE[Math.max(0, b.level - 1)]);
			if (s.owner !== b.owner) {
				recolour(s.model, b.owner);
				s.owner = b.owner;
			}
			const busy = b.stage === 'live' && b.timer > 0 && !b.paused;
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
	function unitPos(/** @type {any} */ u) {
		const n = u.path.length;
		const k = Math.max(0, Math.min(n - 1, Math.floor(u.p)));
		const f = Math.min(1, Math.max(0, u.p - k));
		const a = u.path[k], b = u.path[Math.min(n - 1, k + 1)];
		return at.set(X(a) + (X(b) - X(a)) * f, Math.max(Y(a), SEA) + (Math.max(Y(b), SEA) - Math.max(Y(a), SEA)) * f, Z(a) + (Z(b) - Z(a)) * f);
	}
	/** whether a node is a village center's stop: where a cart's straight legs meet */
	const isCentre = (/** @type {number} */ n) => {
		const o = st.obj[n];
		const b = o?.k === 'flag' ? st.buildings[st.flags[o.id]?.bld] : null;
		return !!b && big(b.type);
	};
	/** a cart goes straight from village center to village center, however its steps were counted */
	function cartPos(/** @type {any} */ u) {
		const n = u.path.length, p = Math.max(0, Math.min(n - 1, u.p));
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
			ring.scale.setScalar(picked ? 3.4 : 1);
			if (node >= 0) ring.position.set(X(at), Math.max(Y(at), SEA) + 0.08, Z(at));
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
				ghost = buildingModel(type, 0);
				ghostType = type;
				root.add(ghost);
			}
			ghost.visible = true;
			const at = stand(type, node);
			ghost.position.set(X(at), Y(at), Z(at));
			ghost.rotation.y = door(node);
			if (big(type)) ghost.scale.set(CENTRE_SCALE, CENTRE_SCALE * 0.7, CENTRE_SCALE);
			else ghost.scale.setScalar(DOME_SCALE);
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
			centres.forEach((n, k) => {
				put(tiles, k, X(n), Math.max(Y(n), SEA) + 0.03, Z(n));
				tiles.setColorAt(k, c.set(color));
			});
			done(tiles, centres.length);
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
			for (const m of tunMeshes) m.geometry.dispose();
			for (const grp of fires.values()) grp.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
			for (const d of disposables) d.dispose();
		}
	};
}
