/*
 * FLORA — a world's forest grown from our own plants ($lib/plants), as many thousands of them as a dome cell holds,
 * and drawn fast.
 *
 * Each kind of plant (a plant at its version, stage and seed: an apple tree in flower, a ripe pumpkin) is grown once,
 * in a worker (./flora.worker.js, ./flora.grow.js), twice over: finely for near you, coarsely for further off. Every
 * plant of that kind in the world is then one more instance of it, drawn with all the others in a handful of draw
 * calls. Which plant is drawn how is chosen afresh as you walk and look round: in front of you and near, the fine one;
 * further, the coarse one; further still a tree is a picture of itself turned to you (./impostors.js; a trunk and a
 * crown in its leaves' colour where there is no renderer to take the pictures with), and the small plants are left
 * out; behind you nothing at all.
 *
 * A forest is a list of plants put somewhere (`add`); `grown` waits for their kinds to have grown, `update` keeps
 * the drawing in step with the eye.
 */
import * as THREE from 'three';
import { grow, keyOf } from './flora.grow.js';
import { impostors } from './impostors.js';

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
	const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
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

/** @typedef {{ meshes: THREE.InstancedMesh[], attr: THREE.InstancedBufferAttribute }} Tier the instances of one kind at one detail */
/**
 * @typedef {{
 *   kind: Kind, reach: Reach, n: number, add: number[], shape?: Shape, colour?: THREE.Color,
 *   x?: Float32Array, y?: Float32Array, z?: Float32Array, c?: Float32Array, s?: Float32Array,
 *   cells?: Map<number, number[]>, near?: Tier, mid?: Tier
 * }} Stand all the plants of one kind in a forest: where each stands (x, y, z), its turn (c, s: cos and sin times its
 *   scale), in cells of the ground so only the ones near the eye are looked at
 */

/** the side of a cell of the ground the small plants are filed in, metres */
const CELL = 24;
/** a cell's key @param {number} x @param {number} z */
const cellOf = (x, z) => (Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096);

/**
 * A forest: plants put down in it, drawn as you see them.
 * @param {{ tree?: [number, number], shrub?: [number, number], cover?: [number, number], renderer?: THREE.WebGLRenderer }} [o]
 *   how far each reach is drawn: [the fine plants to, the coarse ones to]; a tree beyond is its stand-in, anything
 *   else beyond is left out. With a `renderer`, a tree's stand-in is a picture of the tree itself (./impostors.js),
 *   not a trunk and a ball
 */
export function createForest(o = {}) {
	const REACH = { tree: o.tree ?? [32, 80], shrub: o.shrub ?? [18, 45], cover: o.cover ?? [10, 24] };
	const group = new THREE.Group();
	group.name = 'flora';
	/** @type {Map<string, Stand>} */
	const stands = new Map();
	/** the trees far away: a trunk and a crown each, every tree of the forest */
	/** @type {{ trunks: THREE.InstancedMesh, crowns: THREE.InstancedMesh } | null} */
	let far = null;
	/** the trees far away as pictures of themselves, when the forest has a renderer to take them with */
	/** @type {ReturnType<typeof impostors> | null} */
	let cards = null;
	let dirty = true;
	const last = { x: Infinity, z: Infinity, a: Infinity };
	/** the circles of ground whose plants are not drawn (a dome whose own full forest is shown there) */
	/** @type {{ x: number, z: number, r: number }[]} */
	let masked = [];

	/**
	 * A plant put down at x, z (on the ground at y), turned by `turn`, at `scale` of its kind's size.
	 * @param {Kind} kind @param {Reach} reach @param {number} x @param {number} y @param {number} z @param {number} turn @param {number} scale
	 */
	function add(kind, reach, x, y, z, turn, scale) {
		const key = keyOf(kind);
		let st = stands.get(key);
		if (!st) stands.set(key, (st = { kind, reach, n: 0, add: [] }));
		st.add.push(x, y, z, turn, scale);
		st.n++;
		dirty = true;
	}

	/** the kinds this forest has */
	const kinds = () => [...stands.values()].map((st) => st.kind);

	/**
	 * A tier's instances, room for `need` of them: grown (doubled) when there is not room enough.
	 * @param {Stand} st @param {'near' | 'mid'} t @param {number} need
	 */
	function room(st, t, need) {
		const tier = /** @type {Tier} */ (st[t]);
		if (tier.attr.count >= need) return tier.attr;
		const attr = new THREE.InstancedBufferAttribute(new Float32Array(Math.min(st.n, Math.max(need, tier.attr.count * 2)) * 16), 16);
		attr.setUsage(THREE.DynamicDrawUsage);
		for (const m of tier.meshes) m.instanceMatrix = attr;
		tier.attr = attr;
		return attr;
	}

	/**
	 * Grows every kind of the forest (both tiers) and gets its drawing ready; `onKind` hears each kind as it is ready.
	 * @param {(done: number, of: number) => void} [onKind]
	 */
	async function grown(onKind) {
		const list = [...stands.values()];
		let done = 0;
		await Promise.all(
			list.map(async (st) => {
				const tiers = /** @type {const} */ (['near', 'mid']);
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
				// where each stands, packed; and the small ones filed by their cell of the ground
				const n = st.n, a = st.add;
				st.x = new Float32Array(n);
				st.y = new Float32Array(n);
				st.z = new Float32Array(n);
				st.c = new Float32Array(n);
				st.s = new Float32Array(n);
				if (st.reach !== 'tree') st.cells = new Map();
				for (let i = 0; i < n; i++) {
					const x = a[i * 5], z = a[i * 5 + 2], turn = a[i * 5 + 3], k = a[i * 5 + 4];
					st.x[i] = x;
					st.y[i] = a[i * 5 + 1];
					st.z[i] = z;
					st.c[i] = Math.cos(turn) * k;
					st.s[i] = Math.sin(turn) * k;
					if (st.cells) {
						const key = cellOf(x, z);
						let cell = st.cells.get(key);
						if (!cell) st.cells.set(key, (cell = []));
						cell.push(i);
					}
				}
				st.add = [];
				tiers.forEach((t, i) => {
					const shape = got[i];
					const attr = new THREE.InstancedBufferAttribute(new Float32Array(Math.min(n, 64) * 16), 16);
					attr.setUsage(THREE.DynamicDrawUsage);
					const meshes = shape.parts.map((part) => {
						const mesh = new THREE.InstancedMesh(geometryOf(`${keyOf(st.kind)}/${t}/${part.kind}`, part), MATERIALS[part.kind], n);
						mesh.instanceMatrix = attr;
						mesh.count = 0;
						mesh.visible = false;
						// which are drawn is chosen here (update), never by three's culling, which sees only the first
						mesh.frustumCulled = false;
						// the small plants near you cast no shadows: the trees' are enough, and theirs cost the most
						mesh.castShadow = t === 'near' && st.reach === 'tree';
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
		if (count && o.renderer) {
			cards = impostors(
				o.renderer,
				trees.map((st) => {
					const shape = /** @type {Shape} */ (st.shape), near = /** @type {Tier} */ (st.near);
					return {
						parts: shape.parts.map((p, i) => ({ geometry: /** @type {THREE.InstancedMesh} */ (near.meshes[i]).geometry, kind: p.kind })),
						height: shape.height,
						reach: shape.reach,
						leaf: new THREE.Color().setRGB(...shape.leaf),
						x: /** @type {Float32Array} */ (st.x), y: /** @type {Float32Array} */ (st.y), z: /** @type {Float32Array} */ (st.z),
						c: /** @type {Float32Array} */ (st.c), s: /** @type {Float32Array} */ (st.s), n: st.n
					};
				}),
				REACH.tree[1],
				// the coarse trees cast no shadows of their own: their pictures cast them
				REACH.tree[0]
			);
			cards.mask(masked);
			group.add(cards.mesh);
		} else if (count) {
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

	/**
	 * Writes plant i of a stand into an instance array at slot k: turned about the up axis, scaled, put in place.
	 * @param {Float32Array} arr @param {number} k @param {Stand} st @param {number} i
	 */
	const put = (arr, k, st, i) => {
		const c = /** @type {Float32Array} */ (st.c)[i], sn = /** @type {Float32Array} */ (st.s)[i], j = k * 16;
		const sc = Math.hypot(c, sn);
		arr[j] = c;
		arr[j + 1] = 0;
		arr[j + 2] = -sn;
		arr[j + 3] = 0;
		arr[j + 4] = 0;
		arr[j + 5] = sc;
		arr[j + 6] = 0;
		arr[j + 7] = 0;
		arr[j + 8] = sn;
		arr[j + 9] = 0;
		arr[j + 10] = c;
		arr[j + 11] = 0;
		arr[j + 12] = /** @type {Float32Array} */ (st.x)[i];
		arr[j + 13] = /** @type {Float32Array} */ (st.y)[i];
		arr[j + 14] = /** @type {Float32Array} */ (st.z)[i];
		arr[j + 15] = 1;
	};

	const standIn = new THREE.Matrix4(), cp = new THREE.Vector3(), cq = new THREE.Quaternion(), cs = new THREE.Vector3(), upAxis = new THREE.Vector3(0, 1, 0);
	/** the indices of a stand worth looking at from x, z: every one for the trees, the near cells' for the rest */
	/** @type {number[]} */
	const near = [];
	/**
	 * Draws what the eye at x, z looking along (fx, fz) should see. Cheap when nothing has changed: the choice is made
	 * again only once the eye has moved a little or turned.
	 * @param {number} x @param {number} z @param {number} fx @param {number} fz
	 */
	function update(x, z, fx, fz) {
		const a = Math.atan2(fx, fz);
		const turned = Math.abs(Math.atan2(Math.sin(a - last.a), Math.cos(a - last.a)));
		if (!dirty && Math.hypot(x - last.x, z - last.z) < 2 && turned < 0.12) return;
		dirty = false;
		last.x = x;
		last.z = z;
		last.a = a;
		// the pictures of the far trees stand from where the full ones end, round this same eye
		cards?.eye(x, z);
		const fl = Math.hypot(fx, fz) || 1;
		fx /= fl;
		fz /= fl;
		let farN = 0;
		for (const st of stands.values()) {
			if (!st.near || !st.x) continue;
			const shape = /** @type {Shape} */ (st.shape);
			const [nearTo, midTo] = REACH[st.reach];
			// what reaches past the frame's edge still shows: the plant's own reach, scaled up a little
			const r = Math.max(1, shape.reach * 1.3 + 1);
			const X = st.x, Z = st.z;
			/** @type {Iterable<number> | null} */
			let which = null;
			if (st.cells) {
				near.length = 0;
				const span = Math.ceil((midTo + r) / CELL);
				const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
				for (let i = -span; i <= span; i++)
					for (let j = -span; j <= span; j++) {
						const cell = st.cells.get((cx + i + 4096) * 8192 + (cz + j + 4096));
						if (cell) for (const k of cell) near.push(k);
					}
				which = near;
			}
			let nN = 0, nM = 0;
			let nearArr = /** @type {Float32Array} */ (st.near.attr.array), midArr = /** @type {Float32Array} */ (/** @type {Tier} */ (st.mid).attr.array);
			const look = (/** @type {number} */ i) => {
				const dx = X[i] - x, dz = /** @type {Float32Array} */ (Z)[i] - z;
				const d = Math.hypot(dx, dz);
				for (const m of masked) if ((X[i] - m.x) ** 2 + (/** @type {Float32Array} */ (Z)[i] - m.z) ** 2 < m.r * m.r) return;
				// behind the eye: not drawn (the frame is never wider than about 100°)
				if (d > r && dx * fx + dz * fz < -0.15 * d + r * 0.9) return;
				if (d < nearTo) {
					if (nN * 16 >= nearArr.length) nearArr = /** @type {Float32Array} */ (room(st, 'near', nN + 1).array);
					put(nearArr, nN++, st, i);
				} else if (d < midTo) {
					if (nM * 16 >= midArr.length) midArr = /** @type {Float32Array} */ (room(st, 'mid', nM + 1).array);
					put(midArr, nM++, st, i);
				} else if (far && st.reach === 'tree') {
					// its stand-in: a trunk to under its crown, an ellipsoid crown as wide as it reaches
					const k = Math.hypot(/** @type {Float32Array} */ (st.c)[i], /** @type {Float32Array} */ (st.s)[i]);
					const h = shape.height * k, w = Math.max(0.3, shape.reach * k), foot = Math.max(0.06, shape.foot * k * 1.2);
					cq.setFromAxisAngle(upAxis, Math.atan2(/** @type {Float32Array} */ (st.s)[i], /** @type {Float32Array} */ (st.c)[i]));
					standIn.compose(cp.set(X[i], /** @type {Float32Array} */ (st.y)[i], /** @type {Float32Array} */ (Z)[i]), cq, cs.set(foot, h * 0.45, foot));
					far.trunks.setMatrixAt(farN, standIn);
					cp.y += h * 0.62;
					standIn.compose(cp, cq, cs.set(w * 0.85, h * 0.38, w * 0.85));
					far.crowns.setMatrixAt(farN, standIn);
					far.crowns.setColorAt(farN, /** @type {THREE.Color} */ (st.colour));
					farN++;
				}
			};
			if (which) for (const i of which) look(i);
			else for (let i = 0; i < st.n; i++) look(i);
			// none drawn is no draw call at all
			st.near.attr.needsUpdate = true;
			for (const m of st.near.meshes) m.visible = (m.count = nN) > 0;
			const mid = /** @type {Tier} */ (st.mid);
			mid.attr.needsUpdate = true;
			for (const m of mid.meshes) m.visible = (m.count = nM) > 0;
		}
		if (far) {
			far.trunks.count = far.crowns.count = farN;
			far.trunks.visible = far.crowns.visible = farN > 0;
			far.trunks.instanceMatrix.needsUpdate = far.crowns.instanceMatrix.needsUpdate = true;
			if (far.crowns.instanceColor) far.crowns.instanceColor.needsUpdate = true;
		}
	}

	/** how many triangles the forest draws now, for a check on its weight; and how many plants it has */
	const weight = () => {
		let tris = 0;
		group.traverse((o) => {
			const m = /** @type {THREE.InstancedMesh} */ (o);
			if (m.isInstancedMesh && m.visible) tris += ((m.geometry.index?.count ?? 0) / 3) * m.count;
		});
		return tris;
	};
	const plants = () => [...stands.values()].reduce((a, st) => a + st.n, 0);

	/** a mesh to cast rays at one plant's own shape, moved to wherever it stands */
	const probe = new THREE.Mesh();
	const caster = new THREE.Raycaster();
	/**
	 * The plant a ray from o along d meets first, within `far` metres: found by its leaves, its wood and its fruit, as
	 * drawn near you. The plants the ray passes close to (each taken as an upright cylinder as tall as it is and as
	 * wide as it reaches) are tried, nearest first, against their own shapes. Null when it meets none.
	 * @param {THREE.Vector3} o @param {THREE.Vector3} d @param {number} [far]
	 * @returns {{ kind: Kind, x: number, y: number, z: number, height: number, reach: number, t: number } | null}
	 */
	function pick(o, d, far = 45) {
		/** @type {{ st: Stand, i: number, t: number }[]} */
		const near = [];
		const dd = d.x * d.x + d.z * d.z;
		for (const st of stands.values()) {
			if (!st.x || !st.shape || !st.near) continue;
			const X = st.x, Y = /** @type {Float32Array} */ (st.y), Z = /** @type {Float32Array} */ (st.z), C = /** @type {Float32Array} */ (st.c), S = /** @type {Float32Array} */ (st.s);
			const shape = st.shape;
			const test = (/** @type {number} */ i) => {
				const cx = X[i] - o.x, cz = Z[i] - o.z;
				if (cx * cx + cz * cz > far * far) return;
				const k = Math.hypot(C[i], S[i]);
				const w = Math.max(0.3, shape.reach * k + 0.2), h = Math.max(0.2, shape.height * k);
				// the stretch of the ray inside the plant's cylinder, if any: where it enters (or 0, from inside)
				let t0 = 0, t1 = far;
				if (dd > 1e-9) {
					const b = -(cx * d.x + cz * d.z), c = cx * cx + cz * cz - w * w;
					const disc = b * b - dd * c;
					if (disc < 0) return;
					t0 = Math.max(0, (-b - Math.sqrt(disc)) / dd);
					t1 = (-b + Math.sqrt(disc)) / dd;
					if (t1 < 0) return;
				} else if (cx * cx + cz * cz > w * w) return;
				const ya = o.y + d.y * t0, yb = o.y + d.y * t1;
				if (Math.max(ya, yb) < Y[i] - 0.1 || Math.min(ya, yb) > Y[i] + h + 0.1) return;
				near.push({ st, i, t: t0 });
			};
			if (st.cells) {
				const span = Math.ceil(far / CELL), ix = Math.floor(o.x / CELL), iz = Math.floor(o.z / CELL);
				for (let a = -span; a <= span; a++)
					for (let b = -span; b <= span; b++) for (const i of st.cells.get((ix + a + 4096) * 8192 + (iz + b + 4096)) ?? []) test(i);
			} else for (let i = 0; i < st.n; i++) test(i);
		}
		near.sort((a, b) => a.t - b.t);
		caster.set(o, d.clone().normalize());
		caster.far = far;
		/** @type {{ kind: Kind, x: number, y: number, z: number, height: number, reach: number, t: number } | null} */
		let best = null;
		const arr = new Float32Array(16);
		for (const { st, i, t } of near.slice(0, 40)) {
			// nothing nearer than the one already found can come after it
			if (best && t > best.t) break;
			put(arr, 0, st, i);
			probe.matrixWorld.fromArray(arr);
			for (const m of /** @type {Tier} */ (st.near).meshes) {
				probe.geometry = m.geometry;
				probe.material = m.material;
				const hits = caster.intersectObject(probe, false);
				const hit = hits[0];
				if (hit && (!best || hit.distance < best.t)) {
					const k = Math.hypot(/** @type {Float32Array} */ (st.c)[i], /** @type {Float32Array} */ (st.s)[i]);
					const shape = /** @type {Shape} */ (st.shape);
					best = { kind: st.kind, x: /** @type {Float32Array} */ (st.x)[i], y: /** @type {Float32Array} */ (st.y)[i], z: /** @type {Float32Array} */ (st.z)[i], height: shape.height * k, reach: shape.reach * k, t: hit.distance };
				}
			}
		}
		return best;
	}

	/** The kind's shape, once grown (for its size: how far a plant of it reaches, how thick its foot). @param {Kind} kind */
	const shape = (kind) => stands.get(keyOf(kind))?.shape;

	function dispose() {
		group.removeFromParent();
		cards?.dispose();
		for (const st of stands.values()) for (const t of [st.near, st.mid]) for (const m of t?.meshes ?? []) m.dispose();
		far?.trunks.dispose();
		far?.crowns.dispose();
	}

	/**
	 * Leaves out every plant standing in these circles of ground (at most eight), until the next mask.
	 * @param {{ x: number, z: number, r: number }[]} list
	 */
	function mask(list) {
		masked = list.slice(0, 8);
		cards?.mask(masked);
		dirty = true;
	}

	return { group, add, kinds, grown, update, weight, plants, shape, pick, mask, dispose };
}

/** @typedef {ReturnType<typeof createForest>} Forest */
