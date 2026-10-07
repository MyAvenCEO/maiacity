/**
 * SANDBOX 6 · THE VIEW — the simulation (./sim.js) drawn in three.js, and nothing else: it reads the state every
 * frame and never changes it. The valley's land is one mesh of triangles between the nodes (grass, sand, rock, the ore
 * showing in its colour); trees, rocks, fields, flags, wares, border stones and people are instanced; each building
 * is its own model (./models.js). Only what changed is rebuilt: the state counts its changes (objV, netV, terV).
 */
import * as THREE from 'three';
import { GRASS, MOUNTAIN, SAND, WARES, WATER } from './rules.js';
import { buildingModel, mat, recolour, scaffold, TEAM } from './models.js';
import { SE } from './hex.js';

const ROAD_W = 0.42;
/** the water's surface */
export const SEA = -0.3;

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

	// ── the land ──
	const positions = new Float32Array(g.N * 3), colors = new Float32Array(g.N * 3);
	const c = new THREE.Color(), tint = new THREE.Color();
	const ORE_TINT = [null, new THREE.Color('#34322f'), new THREE.Color('#a4583a'), new THREE.Color('#e0b53c')];
	for (let i = 0; i < g.N; i++) {
		positions.set([X(i), Y(i), Z(i)], i * 3);
		const n = hash(i);
		switch (st.terrain[i]) {
			case GRASS:
				c.set('#7da957').lerp(tint.set('#5b8c43'), n * 0.7).lerp(tint.set('#9bb25e'), Math.max(0, st.height[i] - 1) * 0.3);
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
	const posts = inst(new THREE.CylinderGeometry(0.07, 0.09, 0.5, 5).translate(0, 0.25, 0), white, g.N, false);
	const poles = inst(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 5).translate(0, 0.5, 0), mat('#5a3d27'), 2000);
	const cloths = inst(new THREE.BoxGeometry(0.34, 0.22, 0.02).translate(0.17, 0.88, 0), white, 2000);
	const wares = inst(new THREE.BoxGeometry(0.2, 0.17, 0.2), white, 4000);
	const bodies = inst(new THREE.CylinderGeometry(0.13, 0.17, 0.5, 6).translate(0, 0.25, 0), white, 1500);
	const heads = inst(new THREE.SphereGeometry(0.12, 6, 4).translate(0, 0.62, 0), mat('#f0c8a0'), 1500);
	const loads = inst(new THREE.BoxGeometry(0.22, 0.18, 0.22).translate(0, 0.86, 0), white, 1500);
	const spots = inst(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 6), keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 })), g.N, false);
	spots.receiveShadow = false;

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
	function syncBorder() {
		if (terSeen === st.terV) return;
		terSeen = st.terV;
		let k = 0;
		for (let i = 0; i < g.N; i++) {
			const o = st.owner[i];
			if (o < 0 || st.terrain[i] === WATER) continue;
			let edge = false;
			for (let d = 0; d < 6; d++) {
				const j = g.nb(i, d);
				if (j < 0 || st.owner[j] !== o) edge = true;
			}
			if (!edge) continue;
			put(posts, k, X(i), Y(i), Z(i));
			posts.setColorAt(k++, teamColor[o]);
		}
		done(posts, k);
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

	// ── flags and the wares at them ──
	const wareColor = Object.fromEntries(Object.values(WARES).map((w) => [w.id, new THREE.Color(w.color)]));
	function syncFlags() {
		let f = 0, w = 0;
		for (const flag of Object.values(st.flags)) {
			const n = flag.node, x = X(n), y = Math.max(Y(n), SEA), z = Z(n);
			put(poles, f, x, y, z);
			put(cloths, f, x, y, z, 1, 0.3 + Math.sin(performance.now() / 400 + flag.id) * 0.25);
			cloths.setColorAt(f++, teamColor[flag.owner]);
			flag.wares.forEach((/** @type {number} */ id, /** @type {number} */ k) => {
				const ware = st.wares[id];
				if (!ware) return;
				const a = (k / 8) * Math.PI * 2 + 0.4;
				put(wares, w, x + Math.cos(a) * 0.42, y + 0.09, z + Math.sin(a) * 0.42, 1, a);
				wares.setColorAt(w++, wareColor[ware.type]);
			});
		}
		done(poles, f);
		done(cloths, f);
		done(wares, w);
	}

	// ── buildings ──
	/** @type {Map<number, { group: THREE.Group, model: THREE.Group, scaffold: THREE.Group | null, owner: number, sails: THREE.Object3D | undefined, blade: THREE.Object3D | undefined, smoke: THREE.Object3D[] }>} */
	const shown = new Map();
	const DOOR = Math.atan2(0.5, Math.sqrt(3) / 2);
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
				group.position.set(X(b.node), Y(b.node), Z(b.node));
				group.rotation.y = DOOR;
				group.userData.building = b.id;
				const smoke = /** @type {THREE.Object3D[]} */ ([]);
				model.traverse((o) => o.name === 'smoke' && smoke.push(o));
				s = { group, model, scaffold: null, owner: b.owner, sails: model.getObjectByName('sails'), blade: model.getObjectByName('blade'), smoke };
				root.add(group);
				shown.set(b.id, s);
			}
			if (b.stage === 'site') {
				if (!s.scaffold) s.group.add((s.scaffold = scaffold()));
				const total = Object.values(b.cost).reduce((/** @type {number} */ a, /** @type {any} */ n) => a + n, 0);
				const used = Object.values(b.used).reduce((/** @type {number} */ a, /** @type {any} */ n) => a + n, 0);
				s.model.scale.set(1, Math.max(0.06, used / Math.max(1, total)), 1);
			} else if (s.scaffold) {
				s.group.remove(s.scaffold);
				s.scaffold = null;
				s.model.scale.set(1, 1, 1);
			}
			if (s.owner !== b.owner) {
				recolour(s.model, b.owner);
				s.owner = b.owner;
			}
			const busy = b.stage === 'live' && b.timer > 0 && !b.paused;
			if (s.sails && busy) s.sails.rotation.z = t * 1.6;
			if (s.blade && busy) s.blade.rotation.y = t * 9;
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
	function syncUnits(/** @type {number} */ t) {
		let k = 0, l = 0;
		for (const u of Object.values(st.units)) {
			if (u.inside) continue;
			const p = unitPos(u);
			let x = p.x, y = p.y, z = p.z, bob = 0;
			const moving = u.p !== u.tgt && !u.wait;
			if (moving) bob = Math.abs(Math.sin(t * 11 + u.id)) * 0.07;
			if (u.job === 's-siege' || u.job === 's-fight') {
				const a = (u.id % 7) * 0.9;
				const r = u.job === 's-fight' ? 0.45 : 1.0;
				x += Math.cos(a) * r;
				z += Math.sin(a) * r;
				if (u.job === 's-fight') bob = Math.abs(Math.sin(t * 16 + u.id)) * 0.18;
			} else if (u.job === 's-defend') {
				x += 0.2;
				bob = Math.abs(Math.sin(t * 16 + u.id)) * 0.18;
			} else if (u.job === 'b-work') {
				x += 0.9;
				z += 0.4;
				bob = Math.abs(Math.sin(t * 9 + u.id)) * 0.12;
			} else if (u.wait > 0) bob = Math.abs(Math.sin(t * 8 + u.id)) * 0.1;
			const was = last.get(u.id);
			const turn = was ? Math.atan2(p.x - was[0], p.z - was[1]) : 0;
			if (was) (was[0] = p.x), (was[1] = p.z);
			else last.set(u.id, [p.x, p.z]);
			const size = u.kind === 'soldier' ? 1.5 : 1.35;
			put(bodies, k, x, y + bob, z, size, moving ? turn : 0);
			put(heads, k, x, y + bob, z, size);
			bodies.setColorAt(k++, u.kind === 'soldier' ? teamColor[u.owner] : /** @type {Record<string, THREE.Color>} */ (KIND)[u.kind]);
			if (u.ware) {
				put(loads, l, x, y + bob, z, 1.35);
				loads.setColorAt(l++, wareColor[u.ware]);
			}
		}
		done(bodies, k);
		done(heads, k);
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
			ring.visible = node >= 0;
			if (node >= 0) ring.position.set(X(node), Math.max(Y(node), SEA) + 0.08, Z(node));
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
				ghost.rotation.y = DOOR;
				ghostType = type;
				root.add(ghost);
			}
			ghost.visible = true;
			ghost.position.set(X(node), Y(node), Z(node));
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
		/** where a node is in the world @param {number} n */
		place(n) {
			return new THREE.Vector3(X(n), Math.max(Y(n), SEA), Z(n));
		},
		dispose() {
			scene.remove(root);
			for (const s of shown.values()) s.group.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
			ghost?.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
			preview?.geometry.dispose();
			roadMesh?.geometry.dispose();
			for (const grp of fires.values()) grp.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
			for (const d of disposables) d.dispose();
		}
	};
}
