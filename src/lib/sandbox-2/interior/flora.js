/*
 * FLORA — a world's forest grown from our own plants ($lib/plants), as many thousands of them as a dome cell holds,
 * and drawn fast.
 *
 * Each kind of plant (a plant at its version, stage and seed: an apple tree in flower, a ripe pumpkin) is grown once,
 * in a worker (./flora.worker.js, ./flora.grow.js), twice over: finely for near you, coarsely for further off. Every
 * plant of that kind in the world is then one more instance of it, drawn with all the others in a handful of draw
 * calls. Which plant is drawn how is chosen afresh as you walk and look round: in front of you and near, the fine one;
 * further, the coarse one; further still a tree is a trunk and a crown in its leaves' colour, and the small plants are
 * left out; behind you nothing at all.
 *
 * A forest is a list of plants put somewhere (`add`); `grown` waits for their kinds to have grown, `update` keeps
 * the drawing in step with the eye.
 */
import * as THREE from 'three';
import { grow, keyOf } from './flora.grow.js';

/** @typedef {import('./flora.grow.js').Kind} Kind */
/** @typedef {import('./flora.grow.js').Shape} Shape */
/**
 * @typedef {'tree' | 'shrub' | 'cover'} Reach how far off a plant is still drawn: a tree always (far off as its
 *   stand-in), a shrub to the middle distance, the cover (herbs, vegetables, the ground layer) only near you
 */

/* ── growing the kinds: a few workers side by side, each kind and tier once for the whole page ── */

/** @type {Map<string, Promise<Shape>>} */
const shapes = new Map();
/** @type {{ worker: Worker, busy: number }[]} */
const pool = [];
let jobs = 0;
/** @type {Map<number, { resolve: (s: Shape) => void, reject: (e: Error) => void, w: { busy: number } }>} */
const waiting = new Map();

function workers() {
	if (pool.length || typeof Worker === 'undefined') return pool;
	const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
	for (let i = 0; i < n; i++) {
		try {
			const worker = new Worker(new URL('./flora.worker.js', import.meta.url), { type: 'module' });
			const w = { worker, busy: 0 };
			worker.onmessage = (/** @type {MessageEvent<{ job: number, shape?: Shape, error?: string }>} */ e) => {
				const wait = waiting.get(e.data.job);
				if (!wait) return;
				waiting.delete(e.data.job);
				wait.w.busy--;
				if (e.data.shape) wait.resolve(e.data.shape);
				else wait.reject(new Error(e.data.error));
			};
			pool.push(w);
		} catch {
			break;
		}
	}
	return pool;
}

/**
 * A kind of plant grown at a tier, once for the page.
 * @param {Kind} kind @param {'near' | 'mid'} tier @returns {Promise<Shape>}
 */
export function shapeOf(kind, tier) {
	const key = `${keyOf(kind)}/${tier}`;
	let s = shapes.get(key);
	if (!s) {
		const ws = workers();
		if (!ws.length) s = new Promise((resolve) => setTimeout(() => resolve(grow(kind, tier)), 0));
		else {
			const w = ws.reduce((a, b) => (b.busy < a.busy ? b : a));
			w.busy++;
			const job = ++jobs;
			s = new Promise((resolve, reject) => waiting.set(job, { resolve, reject, w }));
			w.worker.postMessage({ job, kind, tier });
		}
		shapes.set(key, s);
	}
	return s;
}

/* ── drawing them ── */

/** the materials every plant of a world is drawn with: its wood, its leaves and petals (both sides lit), its fruit */
const MATERIALS = {
	body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
	sheet: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }),
	gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 })
};

/** @type {Map<string, THREE.BufferGeometry>} the shapes on the graphics card, shared by every forest of the page */
const geometries = new Map();
/** @param {string} key @param {import('./flora.grow.js').Part} p */
function geometryOf(key, p) {
	let g = geometries.get(key);
	if (!g) {
		g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
		g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
		g.setAttribute('color', new THREE.BufferAttribute(p.color, 3));
		g.setIndex(new THREE.BufferAttribute(p.index, 1));
		g.computeBoundingSphere();
		geometries.set(key, g);
	}
	return g;
}

const trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 6, 1).translate(0, 0.5, 0);
const crownGeo = new THREE.IcosahedronGeometry(1, 1);
const trunkMat = new THREE.MeshStandardMaterial({ color: '#6d5238', roughness: 0.9 });
const crownMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });

/**
 * @typedef {{
 *   kind: Kind, reach: Reach, n: number, x: number[], z: number[], m: number[], mf?: Float32Array, colour?: THREE.Color,
 *   near?: { meshes: THREE.InstancedMesh[], attr: THREE.InstancedBufferAttribute },
 *   mid?: { meshes: THREE.InstancedMesh[], attr: THREE.InstancedBufferAttribute },
 *   shape?: Shape
 * }} Stand all the plants of one kind in a forest
 */

/**
 * A forest: plants put down in it, drawn as you see them.
 * @param {{ near?: number, mid?: number, cover?: number, shrubs?: number, shadows?: boolean }} [o] how far each tier
 *   reaches: the fine plants to `near`, the coarse ones to `mid`; the cover to `cover`, the shrubs to `shrubs`
 */
export function createForest(o = {}) {
	const NEAR = o.near ?? 40, MID = o.mid ?? 100, COVER = o.cover ?? 32, SHRUBS = o.shrubs ?? 75;
	const group = new THREE.Group();
	group.name = 'flora';
	/** @type {Map<string, Stand>} */
	const stands = new Map();
	/** the trees far away: a trunk and a crown each, every tree of the forest */
	/** @type {{ trunks: THREE.InstancedMesh, crowns: THREE.InstancedMesh } | null} */
	let far = null;
	const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
	let dirty = true;
	const last = { x: Infinity, z: Infinity, a: Infinity };

	/**
	 * A plant put down at x, z (on the ground at y), turned by `turn`, at `scale` of its kind's size.
	 * @param {Kind} kind @param {Reach} reach @param {number} x @param {number} y @param {number} z @param {number} turn @param {number} scale
	 */
	function add(kind, reach, x, y, z, turn, scale) {
		const key = keyOf(kind);
		let st = stands.get(key);
		if (!st) stands.set(key, (st = { kind, reach, n: 0, x: [], z: [], m: [] }));
		mx.compose(p.set(x, y, z), q.setFromAxisAngle(up, turn), s.set(scale, scale, scale));
		st.x.push(x);
		st.z.push(z);
		st.m.push(...mx.elements);
		st.n++;
		dirty = true;
	}

	/** the kinds this forest has, to grow them before planting (each a promise of its near shape) */
	const kinds = () => [...stands.values()].map((st) => st.kind);

	/**
	 * Grows every kind of the forest (both tiers) and gets its drawing ready; `onKind` hears each kind as it is ready.
	 * @param {(done: number, of: number) => void} [onKind]
	 */
	async function grown(onKind) {
		const list = [...stands.values()];
		let done = 0;
		await Promise.all(
			list.map(async (st) => {
				const tiers = /** @type {('near' | 'mid')[]} */ (st.reach === 'cover' ? ['near'] : ['near', 'mid']);
				/** @type {Shape[]} */
				let got;
				try {
					got = await Promise.all(tiers.map((t) => shapeOf(st.kind, t)));
				} catch (err) {
					// a kind that will not grow (a plant or version the library has not got) leaves its places empty
					console.warn(`flora: ${keyOf(st.kind)} did not grow`, err);
					onKind?.(++done, list.length);
					return;
				}
				st.shape = got[0];
				st.mf = new Float32Array(st.m);
				tiers.forEach((t, i) => {
					const shape = got[i];
					const attr = new THREE.InstancedBufferAttribute(new Float32Array(st.n * 16), 16);
					attr.setUsage(THREE.DynamicDrawUsage);
					const meshes = shape.parts.map((part) => {
						const mesh = new THREE.InstancedMesh(geometryOf(`${keyOf(st.kind)}/${t}/${part.kind}`, part), MATERIALS[part.kind], st.n);
						mesh.instanceMatrix = attr;
						mesh.count = 0;
						// which are drawn is chosen here (update), never by three's culling, which sees only the first
						mesh.frustumCulled = false;
						mesh.castShadow = t === 'near' && st.reach !== 'cover';
						mesh.receiveShadow = true;
						group.add(mesh);
						return mesh;
					});
					st[t] = { meshes, attr };
				});
				onKind?.(++done, list.length);
			})
		);
		const trees = list.filter((st) => st.reach === 'tree' && st.shape);
		const count = trees.reduce((a, st) => a + st.n, 0);
		if (count) {
			const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
			const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
			for (const st of trees) st.colour = new THREE.Color().setRGB(...(/** @type {Shape} */ (st.shape).leaf));
			crowns.setColorAt(0, new THREE.Color());
			for (const m of [trunks, crowns]) {
				m.count = 0;
				m.frustumCulled = false;
				m.castShadow = true;
				m.receiveShadow = true;
				group.add(m);
			}
			far = { trunks, crowns };
		}
		dirty = true;
	}

	const placed = new THREE.Matrix4(), standIn = new THREE.Matrix4(), cp = new THREE.Vector3(), cq = new THREE.Quaternion(), cs = new THREE.Vector3();
	/**
	 * Draws what the eye at x, z looking along (fx, fz) should see. Cheap when nothing has changed: the choice is made
	 * again only once the eye has moved a little or turned.
	 * @param {number} x @param {number} z @param {number} fx @param {number} fz
	 */
	function update(x, z, fx, fz) {
		const a = Math.atan2(fx, fz);
		const turned = Math.abs(Math.atan2(Math.sin(a - last.a), Math.cos(a - last.a)));
		if (!dirty && Math.hypot(x - last.x, z - last.z) < 2.5 && turned < 0.12) return;
		dirty = false;
		last.x = x;
		last.z = z;
		last.a = a;
		const fl = Math.hypot(fx, fz) || 1;
		fx /= fl;
		fz /= fl;
		let farN = 0;
		for (const st of stands.values()) {
			if (!st.near || !st.mf) continue;
			const M = st.mf;
			const shape = /** @type {Shape} */ (st.shape);
			// what reaches past the frame's edge still shows: the plant's own reach, scaled up a little
			const r = Math.max(1, shape.reach * 1.3 + 1);
			const nearArr = /** @type {Float32Array} */ (st.near.attr.array), midArr = st.mid ? /** @type {Float32Array} */ (st.mid.attr.array) : null;
			const nearTo = st.reach === 'cover' ? COVER : NEAR;
			const midTo = st.reach === 'tree' ? MID : st.reach === 'shrub' ? SHRUBS : 0;
			let nN = 0, nM = 0;
			for (let i = 0; i < st.n; i++) {
				const dx = st.x[i] - x, dz = st.z[i] - z;
				const d = Math.hypot(dx, dz);
				// behind the eye: not drawn (the frame is never wider than about 100°)
				if (d > r && dx * fx + dz * fz < -0.15 * d + r * 0.9) continue;
				if (d < nearTo) nearArr.set(M.subarray(i * 16, i * 16 + 16), 16 * nN++);
				else if (midArr && d < midTo) midArr.set(M.subarray(i * 16, i * 16 + 16), 16 * nM++);
				else if (far && st.reach === 'tree') {
					// its stand-in: a trunk to under its crown, an ellipsoid crown as wide as it reaches
					placed.fromArray(M, i * 16);
					placed.decompose(cp, cq, cs);
					const h = shape.height * cs.y, w = Math.max(0.3, shape.reach * cs.x);
					standIn.compose(cp, cq, cs.set(Math.max(0.06, shape.foot * cs.x * 1.2), h * 0.45, Math.max(0.06, shape.foot * cs.z * 1.2)));
					far.trunks.setMatrixAt(farN, standIn);
					cp.y += h * 0.62;
					standIn.compose(cp, cq, cs.set(w * 0.85, h * 0.38, w * 0.85));
					far.crowns.setMatrixAt(farN, standIn);
					far.crowns.setColorAt(farN, /** @type {THREE.Color} */ (st.colour));
					farN++;
				}
			}
			st.near.attr.needsUpdate = true;
			// none drawn is no draw call at all
			for (const m of st.near.meshes) m.visible = (m.count = nN) > 0;
			if (st.mid) {
				st.mid.attr.needsUpdate = true;
				for (const m of st.mid.meshes) m.visible = (m.count = nM) > 0;
			}
		}
		if (far) {
			far.trunks.count = far.crowns.count = farN;
			far.trunks.visible = far.crowns.visible = farN > 0;
			far.trunks.instanceMatrix.needsUpdate = far.crowns.instanceMatrix.needsUpdate = true;
			if (far.crowns.instanceColor) far.crowns.instanceColor.needsUpdate = true;
		}
	}

	/** how many triangles the forest draws now, for a check on its weight */
	const weight = () => {
		let tris = 0;
		group.traverse((o) => {
			const m = /** @type {THREE.InstancedMesh} */ (o);
			if (m.isInstancedMesh) tris += ((m.geometry.index?.count ?? 0) / 3) * m.count;
		});
		return tris;
	};

	/** The kind's shape, once grown (for its size: how far a plant of it reaches, how thick its foot). @param {Kind} kind */
	const shape = (kind) => stands.get(keyOf(kind))?.shape;

	function dispose() {
		group.removeFromParent();
		for (const st of stands.values()) for (const t of [st.near, st.mid]) for (const m of t?.meshes ?? []) m.dispose();
		far?.trunks.dispose();
		far?.crowns.dispose();
	}

	return { group, add, kinds, grown, update, weight, shape, dispose };
}

/** @typedef {ReturnType<typeof createForest>} Forest */
