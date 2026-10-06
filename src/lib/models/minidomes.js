/*
 * MINI DOMES — the coops, hutches and playgrounds of the village again, each as a tiny geodesic dome: the same
 * triangles as the village's great domes, small enough to step over a hen.
 *
 * The hen dome (v2 of the chicken coop) is a dome of timber struts 5.6 m across, low and wide: wire in its lower
 * band to see the hens through, clear panels over the run, and a cedar-shingled back where they roost — a ladder of
 * perches, three nesting boxes on straw with the day's eggs in them (and one laid out on the straw, as a hen will),
 * a feeder and a water trough. The rabbit dome (v2 of the hutch) is wire all over against foxes and hawks, on grass,
 * a little wooden dome inside to sleep in, a hay rack, a water bowl, a log to hide in. The play dome (v2 of the
 * playground) is the sandpit ringed with stumps round a climbing dome of round logs with a platform in it and a
 * slide out of its side, a swing on an arch of logs, balance logs and stepping stumps.
 *
 * Each builder returns its group and the circles it takes up (for walking round it), in its own frame: its run or
 * its sand at +z, as the timber coop's is; at real measure (metres), the ground at y = 0.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** @typedef {{ x: number, z: number, r: number }} Collider */
/** @typedef {{ group: THREE.Group, colliders: Collider[] }} Space */

/** a small seeded random (mulberry32) */
function seeded(/** @type {number} */ seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const col = (/** @type {string} */ c, rough = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
const MAT = {
	strut: col('#8a6040', 0.8),
	log: col('#b98a5a', 0.75),
	darkLog: col('#7a5434', 0.85),
	cedar: new THREE.MeshStandardMaterial({ color: '#9a5c3a', roughness: 0.9, side: THREE.DoubleSide }),
	shingle: new THREE.MeshStandardMaterial({ color: '#6e4a33', roughness: 0.95, side: THREE.DoubleSide }),
	oak: col('#a8774c', 0.8),
	straw: col('#d8c38a', 1),
	hay: col('#cdb874', 1),
	grass: col('#7f9a52', 1),
	sand: col('#e3cf9c', 1),
	steel: new THREE.MeshStandardMaterial({ color: '#9aa0a2', roughness: 0.35, metalness: 0.7 }),
	rope: col('#d8c8a0', 1),
	slide: new THREE.MeshStandardMaterial({ color: '#d9b36a', roughness: 0.4, side: THREE.DoubleSide }),
	egg: col('#e9dcc6', 0.55),
	brownEgg: col('#c79a6a', 0.55),
	wire: new THREE.MeshStandardMaterial({ color: '#c3c7bf', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6 }),
	clear: new THREE.MeshStandardMaterial({ color: '#e8f0ee', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, roughness: 0.15 })
};

/**
 * A geodesic dome: the triangles of an icosphere of radius R above the ground (squashed to `squash` of its height), a
 * strut along every edge. Each triangle goes to the material `panel` gives it (null: left open), by its middle.
 * @param {THREE.Group} g @param {number} R @param {number} detail @param {number} squash
 * @param {number} strut the struts' radius @param {THREE.Material} strutMat
 * @param {(c: THREE.Vector3, R: number) => THREE.Material | null} panel
 */
function dome(g, R, detail, squash, strut, strutMat, panel) {
	const ico = new THREE.IcosahedronGeometry(R, detail);
	const p = ico.attributes.position;
	/** @type {Map<THREE.Material, number[]>} */
	const panes = new Map();
	/** @type {Map<string, [THREE.Vector3, THREE.Vector3]>} */
	const edges = new Map();
	const key = (/** @type {THREE.Vector3} */ v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
	for (let i = 0; i < p.count; i += 3) {
		const tri = [0, 1, 2].map((k) => new THREE.Vector3(p.getX(i + k), p.getY(i + k), p.getZ(i + k)));
		if ((tri[0].y + tri[1].y + tri[2].y) / 3 < -R * 0.02) continue;
		for (const v of tri) v.y = Math.max(0, v.y) * squash;
		const c = tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3);
		const m = panel(c, R);
		if (m) {
			const list = panes.get(m) ?? [];
			list.push(...tri.flatMap((v) => [v.x, v.y, v.z]));
			panes.set(m, list);
		}
		for (let k = 0; k < 3; k++) {
			const a = tri[k], b = tri[(k + 1) % 3];
			if (a.y === 0 && b.y === 0) continue;
			const ka = key(a), kb = key(b);
			edges.set(ka < kb ? ka + kb : kb + ka, [a, b]);
		}
	}
	ico.dispose();
	for (const [m, list] of panes) {
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
		// uv too, though nothing is painted on: a world bakes the panels with the boxes of the same wood, and only
		// pieces of one kind merge
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((list.length / 3) * 2), 2));
		geo.computeVertexNormals();
		const mesh = new THREE.Mesh(geo, m);
		mesh.receiveShadow = true;
		mesh.castShadow = !(/** @type {THREE.MeshStandardMaterial} */ (m).transparent);
		g.add(mesh);
	}
	// the struts, one geometry; a hub at every joint
	/** @type {THREE.BufferGeometry[]} */
	const parts = [];
	/** @type {Map<string, THREE.Vector3>} */
	const hubs = new Map();
	for (const [a, b] of edges.values()) {
		const len = a.distanceTo(b);
		const cyl = new THREE.CylinderGeometry(strut, strut, len, 6, 1, true);
		cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
		cyl.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
		parts.push(cyl);
		hubs.set(key(a), a);
		hubs.set(key(b), b);
	}
	for (const h of hubs.values()) parts.push(new THREE.IcosahedronGeometry(strut * 1.6, 0).translate(h.x, h.y, h.z));
	const struts = new THREE.Mesh(mergeGeometries(parts.map((q) => q.toNonIndexed())), strutMat);
	for (const q of parts) q.dispose();
	struts.castShadow = true;
	g.add(struts);
}

/** A round timber from a to b. */
function log(/** @type {THREE.Group} */ g, /** @type {THREE.Vector3} */ a, /** @type {THREE.Vector3} */ b, /** @type {number} */ r, mat = MAT.log) {
	const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10), mat);
	m.position.copy(a).add(b).multiplyScalar(0.5);
	m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
	m.castShadow = true;
	g.add(m);
	return m;
}
const v = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => new THREE.Vector3(x, y, z);
/** a box resting on y */
function box(/** @type {THREE.Group} */ g, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ d, /** @type {THREE.Material} */ mat, x = 0, y = 0, z = 0, rot = 0) {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	m.position.set(x, y + h / 2, z);
	m.rotation.y = rot;
	m.castShadow = m.receiveShadow = true;
	g.add(m);
	return m;
}
/** a disc of something on the ground */
function floor(/** @type {THREE.Group} */ g, /** @type {number} */ r, /** @type {THREE.Material} */ mat, x = 0, z = 0) {
	const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat);
	m.rotation.x = -Math.PI / 2;
	m.position.set(x, 0.03, z);
	m.receiveShadow = true;
	g.add(m);
}

/** An egg, 5.7 cm long, lying on its side. */
const EGG = new THREE.SphereGeometry(0.022, 10, 8).scale(1, 1, 1.3);
function egg(/** @type {THREE.Group} */ g, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {() => number} */ r) {
	const e = new THREE.Mesh(EGG, r() < 0.45 ? MAT.brownEgg : MAT.egg);
	e.position.set(x, y + 0.021, z);
	e.rotation.set((r() - 0.5) * 0.3, r() * Math.PI * 2, 0);
	e.castShadow = true;
	g.add(e);
}

/**
 * The hen dome: a timber geodesic dome 5.6 m across, 2.3 m high, the hens' house at its back (-z), their run under
 * its clear panels toward +z; the nests with eggs in them.
 * @param {number} [seed] @returns {Space}
 */
export function henDome(seed = 3) {
	const r = seeded(seed);
	const g = new THREE.Group();
	const R = 2.8, O = 0.5;
	const shell = new THREE.Group();
	shell.position.z = O;
	// wire round the foot, the back shingled where they roost, clear panels over the run
	dome(shell, R, 2, 0.82, 0.035, MAT.strut, (c) => (c.z < -R * 0.1 && c.y > R * 0.06 ? MAT.shingle : c.y < R * 0.42 ? MAT.wire : MAT.clear));
	g.add(shell);
	// a door frame at the front, where the keeper comes in
	for (const sx of [-0.42, 0.42]) box(g, 0.07, 1.6, 0.07, MAT.strut, sx, 0, O + R - 0.25);
	box(g, 0.9, 0.07, 0.07, MAT.strut, 0, 1.6, O + R - 0.25);
	// straw on the floor
	floor(g, R - 0.12, MAT.straw, 0, O);
	// the roost: a ladder of perches leaning against the back
	for (const sx of [-0.55, 0.55]) log(g, v(sx, 0, O - 1.2), v(sx, 1.55, O - 2.05), 0.035, MAT.darkLog);
	for (let k = 0; k < 4; k++) {
		const u = (k + 0.6) / 4.4;
		log(g, v(-0.6, u * 1.55, O - 1.2 - u * 0.85), v(0.6, u * 1.55, O - 1.2 - u * 0.85), 0.025, MAT.log);
	}
	// three nesting boxes along the back on the left, straw in each and the day's eggs
	const nests = new THREE.Group();
	nests.position.set(-1.35, 0, O - 1.75);
	nests.rotation.y = 0.55;
	box(nests, 1.2, 0.08, 0.42, MAT.cedar, 0, 0.42, 0);
	box(nests, 1.2, 0.36, 0.04, MAT.cedar, 0, 0.5, -0.19);
	box(nests, 1.2, 0.05, 0.46, MAT.shingle, 0, 0.88, -0.02);
	for (const x of [-0.6, -0.2, 0.2, 0.6]) box(nests, 0.03, 0.36, 0.42, MAT.cedar, x, 0.5, 0);
	box(nests, 1.2, 0.07, 0.03, MAT.cedar, 0, 0.5, 0.2);
	for (const sx of [-0.55, 0.55]) box(nests, 0.06, 0.42, 0.06, MAT.strut, sx, 0, 0.12);
	for (const x of [-0.4, 0, 0.4]) {
		box(nests, 0.34, 0.05, 0.36, MAT.hay, x, 0.5, 0);
		const n = 1 + Math.floor(r() * 3);
		for (let e = 0; e < n; e++) egg(nests, x + (r() - 0.5) * 0.16, 0.55, (r() - 0.5) * 0.14, r);
	}
	g.add(nests);
	// and an egg or two laid out on the straw, as a hen will
	for (let e = 0; e < 2; e++) egg(g, -1.7 + r() * 0.6, 0.03, O - 0.6 + r() * 0.6, r);
	// the feeder (a hanging drum) and a water trough
	const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 16), MAT.steel);
	drum.position.set(1.05, 0.42, O - 0.3);
	g.add(drum);
	const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.05, 18), MAT.steel);
	pan.position.set(1.05, 0.22, O - 0.3);
	g.add(pan);
	log(g, v(1.05, 0.6, O - 0.3), v(1.05, 1.9, O - 0.3), 0.006, MAT.steel);
	box(g, 0.8, 0.14, 0.24, MAT.steel, 0.9, 0, O + 1.4, 0.4);
	return { group: g, colliders: [{ x: 0, z: O, r: R }] };
}

/**
 * The rabbit dome: wire all over, 5.2 m across and 1.6 m high, on grass, a small wooden dome inside to sleep in.
 * @param {number} [seed] @returns {Space}
 */
export function rabbitDome(seed = 4) {
	const r = seeded(seed);
	const g = new THREE.Group();
	const R = 2.6, O = 0.5;
	const shell = new THREE.Group();
	shell.position.z = O;
	dome(shell, R, 2, 0.62, 0.03, MAT.strut, () => MAT.wire);
	g.add(shell);
	floor(g, R - 0.1, MAT.grass, 0, O);
	// the sleeping dome at the back: shingled, a round way in toward the run
	const den = new THREE.Group();
	den.position.set(0.6, 0, O - 1.45);
	dome(den, 0.75, 1, 0.85, 0.02, MAT.strut, (c) => (c.z > 0.45 && c.y < 0.4 && Math.abs(c.x) < 0.35 ? null : MAT.cedar));
	floor(den, 0.7, MAT.hay);
	g.add(den);
	// a hay rack on legs, a water bowl, a hollow log to hide in
	const rack = new THREE.Group();
	rack.position.set(-1.1, 0, O - 1.3);
	rack.rotation.y = -0.6;
	for (const sx of [-0.3, 0.3]) box(rack, 0.05, 0.6, 0.05, MAT.strut, sx, 0, 0);
	box(rack, 0.65, 0.22, 0.2, MAT.hay, 0, 0.32, 0);
	for (let k = 0; k < 6; k++) box(rack, 0.012, 0.26, 0.012, MAT.steel, -0.27 + k * 0.11, 0.3, 0.1);
	g.add(rack);
	const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.07, 14), MAT.steel);
	bowl.position.set(-1.5, 0.035, O + 0.9);
	g.add(bowl);
	const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: 0.95, side: THREE.DoubleSide }));
	tunnel.rotation.z = Math.PI / 2;
	tunnel.rotation.y = 0.5 + r() * 0.4;
	tunnel.position.set(1.1, 0.17, O + 0.9);
	g.add(tunnel);
	// a door frame at the front
	for (const sx of [-0.35, 0.35]) box(g, 0.06, 1.05, 0.06, MAT.strut, sx, 0, O + R - 0.35);
	box(g, 0.76, 0.06, 0.06, MAT.strut, 0, 1.05, O + R - 0.35);
	return { group: g, colliders: [{ x: 0, z: O, r: R }] };
}

/**
 * The play dome: a sandpit ringed with stumps round a climbing dome of round logs, a platform in it and a slide out
 * of its side; a swing on an arch of logs; balance logs and stepping stumps. About 16 m across.
 * @param {number} [seed] @returns {Space}
 */
export function playDome(seed = 90) {
	const r = seeded(seed);
	const g = new THREE.Group();
	/** @type {Collider[]} */
	const cs = [];
	// the sandpit, ringed by half-buried stumps
	floor(g, 4.2, MAT.sand);
	for (let i = 0; i < 18; i++) {
		const a = (i / 18) * Math.PI * 2;
		const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.35 + r() * 0.25, 10), MAT.darkLog);
		stump.position.set(Math.sin(a) * 4.3, 0.2, Math.cos(a) * 4.3);
		stump.castShadow = true;
		g.add(stump);
	}
	// the climbing dome: open, round logs on every edge, 4.4 m across; a rope net under its crown
	const T = { x: -1.1, z: -0.7, R: 2.2 };
	const climber = new THREE.Group();
	climber.position.set(T.x, 0, T.z);
	dome(climber, T.R, 2, 0.95, 0.045, MAT.log, (c, R) => (c.y > R * 0.82 ? MAT.rope : null));
	// the platform in it, at 1.2 m, and the slide out of its side into the sand
	const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.08, 20), MAT.oak);
	deck.position.y = 1.2;
	deck.castShadow = true;
	climber.add(deck);
	for (const [sx, sz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) log(climber, v(sx, 0, sz), v(sx, 1.2, sz), 0.06, MAT.darkLog);
	g.add(climber);
	const slidePath = new THREE.CatmullRomCurve3([v(T.x + 1.0, 1.2, T.z + 0.2), v(T.x + 2.4, 0.75, T.z + 0.1), v(T.x + 3.6, 0.22, T.z + 0.35)]);
	const chute = new THREE.Mesh(new THREE.TubeGeometry(slidePath, 20, 0.4, 10, false), MAT.slide);
	chute.scale.y = 0.6;
	chute.position.y = 0.2;
	g.add(chute);
	cs.push({ x: T.x, z: T.z, r: T.R });
	// the swing: an arch of logs, two seats on ropes
	const S = { x: 2.0, z: 2.3, w: 1.5, h: 2.4 };
	const arch = new THREE.CatmullRomCurve3([v(S.x - S.w, 0, S.z), v(S.x - S.w * 0.85, S.h * 0.8, S.z), v(S.x, S.h, S.z), v(S.x + S.w * 0.85, S.h * 0.8, S.z), v(S.x + S.w, 0, S.z)]);
	const beam = new THREE.Mesh(new THREE.TubeGeometry(arch, 30, 0.09, 8, false), MAT.log);
	beam.castShadow = true;
	g.add(beam);
	for (const sx of [-1, 1]) log(g, v(S.x + sx * S.w, 0, S.z - 0.7), v(S.x + sx * S.w * 0.9, 1.4, S.z), 0.06, MAT.darkLog);
	for (const sx of [-0.45, 0.45]) {
		const top = arch.getPoint(0.5 + sx / (S.w * 4.4));
		for (const dz of [-0.18, 0.18]) log(g, v(S.x + sx, top.y - 0.05, S.z + dz * 0.2), v(S.x + sx, 0.55, S.z + dz), 0.012, MAT.rope);
		box(g, 0.22, 0.05, 0.5, MAT.oak, S.x + sx, 0.5, S.z, Math.PI / 2);
	}
	cs.push({ x: S.x - S.w, z: S.z, r: 0.5 }, { x: S.x + S.w, z: S.z, r: 0.5 });
	// balance logs and stepping stumps, out from the sand
	for (let i = 0; i < 3; i++) {
		const a = 3.6 + i * 0.5;
		log(g, v(Math.sin(a) * 5.2, 0.25, Math.cos(a) * 5.2), v(Math.sin(a + 0.35) * 6.8, 0.25, Math.cos(a + 0.35) * 6.8), 0.15, MAT.darkLog);
	}
	for (let i = 0; i < 7; i++) {
		const a = 0.9 + i * 0.28, h = 0.2 + i * 0.08;
		const st = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, h, 12), MAT.log);
		st.position.set(Math.sin(a) * 6.2, h / 2, Math.cos(a) * 6.2);
		st.castShadow = true;
		g.add(st);
	}
	g.traverse((o) => {
		const m = /** @type {THREE.Mesh} */ (o);
		if (m.isMesh) m.receiveShadow = true;
	});
	return { group: g, colliders: cs };
}
