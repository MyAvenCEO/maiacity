// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE UNIVERSAL RENDERER — one way for any page (a viewer, a sandbox, a world, a film) to draw our assets and anyone's,
 * as many of them as a world holds: `use` an asset by its label or its build (`plants/apple@2?stage=9`,
 * `<recipe hash>?its=values`), `place` it as often as you like, and `update` each frame before the scene is drawn.
 *
 * - Every build comes the one way any build comes (../load.js): from this device's cache, else from the asset box,
 *   checked. Nothing of an asset runs here; what it made is only data, and our code draws it.
 * - Each kind is drawn at the level of detail its size on screen calls for (./lod.js): up to three shapes (its recipe
 *   built at a lower `detail`, for the recipes that take one; phase 5 gives every asset its levels) and, smallest, its
 *   picture (./impostors.js). The coarsest shape comes first, so a world stands as soon as it has it; a finer one is
 *   asked for only once a copy is near enough to want it.
 * - Every copy of a kind at one level is one more instance of the same few drawings (./prepare.js): a forest of a
 *   thousand trees of forty kinds is a few hundred draw calls, the pictures a handful.
 * - Every material is the renderer's own (./presets.js), with the shader code only we add: the dither a level fades
 *   in by, and the kit's section caps when the world is cut open (`cut`).
 *
 * Several boxes build side by side while a world loads (`boxes`), each a frame and a worker of its own.
 */
import * as THREE from 'three';
import { AssetBox } from '../box/host.js';
import { canonical, loadAsset } from '../load.js';
import { INDEX, buildOf, hashOf, parseBuild } from '../recipes.js';
import { parseRef } from '../refs.js';
import { createImpostors } from './impostors.js';
import { LEVELS, SMALLEST, choose, sizeOn, thresholdsOf } from './lod.js';
import { prepare } from './prepare.js';
import { createPresets } from './presets.js';

/** the details a recipe that takes one is built at, its finest level first (plants: Sandbox 4's two and the whole) */
export const DETAILS = [1, 0.25, 0.1];

/** a = a × b, 4 × 4 matrices as three.js keeps them (by column), each at its offset in its array */
function multiply(a, ai, b, bi, out, oi) {
	for (let c = 0; c < 4; c++) {
		const b0 = b[bi + c * 4], b1 = b[bi + c * 4 + 1], b2 = b[bi + c * 4 + 2], b3 = b[bi + c * 4 + 3];
		out[oi + c * 4] = a[ai] * b0 + a[ai + 4] * b1 + a[ai + 8] * b2 + a[ai + 12] * b3;
		out[oi + c * 4 + 1] = a[ai + 1] * b0 + a[ai + 5] * b1 + a[ai + 9] * b2 + a[ai + 13] * b3;
		out[oi + c * 4 + 2] = a[ai + 2] * b0 + a[ai + 6] * b1 + a[ai + 10] * b2 + a[ai + 14] * b3;
		out[oi + c * 4 + 3] = a[ai + 3] * b0 + a[ai + 7] * b1 + a[ai + 11] * b2 + a[ai + 15] * b3;
	}
}

/**
 * What a ref names: a recipe's hash and the values it is built with, as text.
 * @param {string} ref a label (`plants/apple@2?stage=9`) or a build (`<hash>?stage=9`)
 */
function resolve(ref) {
	if (/^[0-9a-f]{64}(\?|$)/.test(ref)) return parseBuild(ref);
	const hash = hashOf(ref);
	if (!hash) throw new Error(`no asset ${ref}`);
	const params = parseRef(ref).params;
	return { hash, ...(params && { params }) };
}

/**
 * A renderer of assets for one scene.
 * @param {{
 *   renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, boxes?: number, details?: number[],
 *   levels?: number[], px?: number, cache?: boolean
 * }} o `boxes` how many build side by side; `details` and `levels` the details a recipe is built at and the sizes on
 *   screen each is drawn to (./lod.js); `px` each picture's pixels a side; `cache: false` builds everything afresh
 */
export function createAssets(o) {
	const { renderer, camera } = o;
	const details = o.details ?? DETAILS;
	const levels = o.levels ?? LEVELS;
	renderer.localClippingEnabled = true;
	const group = new THREE.Group();
	group.name = 'assets';
	const presets = createPresets();
	const pictures = createImpostors(renderer, { px: o.px });
	group.add(pictures.group);

	/* ── the boxes, and the builds waiting for one: the coarsest shapes first ── */
	const pool = Array.from({ length: Math.max(1, o.boxes ?? 3) }, () => ({ box: new AssetBox({ engine: INDEX.engine }), busy: false }));
	/** @type {{ name: string, first: boolean, ok: Function, no: Function }[]} */
	const queue = [];
	let loads = 0;
	function pump() {
		for (const p of pool) {
			if (p.busy || !queue.length) continue;
			const i = queue.findIndex((q) => q.first);
			const job = queue.splice(i >= 0 ? i : 0, 1)[0];
			p.busy = true;
			loads++;
			loadAsset(job.name, { box: p.box, cache: o.cache !== false })
				.then(job.ok, job.no)
				.finally(() => {
					p.busy = false;
					loads--;
					pump();
				});
		}
	}
	const build = (name, first) =>
		new Promise((ok, no) => {
			queue.push({ name, first, ok, no });
			pump();
		});

	/* ── the kinds ── */
	/** @type {Map<string, any>} */
	const kinds = new Map();
	let dirty = true;

	/**
	 * A kind: an asset at its version, variant and values, at every level it is drawn at. Asked for again, the same.
	 * @param {string} ref a label or a build
	 */
	function use(ref) {
		const { hash, params } = resolve(ref);
		const at = INDEX.recipes[hash];
		if (!at) throw new Error(`no recipe ${hash.slice(0, 12)}… on this device`);
		const takes = at.params?.some((p) => p.id === 'detail');
		// each named as it is kept, its own values filled in, so two refs of one build are one kind
		const names = (takes ? details.map((d) => buildOf(hash, { ...params, detail: String(d) })) : [buildOf(hash, params)]).map((n) => canonical(n).name);
		const key = names[0];
		let k = kinds.get(key);
		if (k) return k;
		k = {
			key,
			label: at.label,
			names,
			levels: names.map(() => ({ state: 'idle', level: null, meshes: null })),
			ok: false,
			error: null,
			radius: 1,
			center: new THREE.Vector3(),
			thresholds: thresholdsOf(names.length, undefined, levels),
			slot: null,
			n: 0,
			cap: 0,
			M: new Float32Array(0),
			T: new Float32Array(0),
			S: new Float32Array(0),
			alive: new Uint8Array(0),
			was: new Int8Array(0)
		};
		kinds.set(key, k);
		// the coarsest shape first: its measure is the kind's, and its picture is taken from it
		const last = names.length - 1;
		k.ready = want(k, last, true).then(
			() => {
				const L = k.levels[last].level;
				k.radius = L.radius;
				k.center.copy(L.center);
				k.thresholds = thresholdsOf(names.length, L.tris, levels);
				k.ok = true;
				dirty = true;
				return k;
			},
			(err) => {
				k.error = String(err?.message ?? err);
				console.warn(`assets: ${at.label} did not load: ${k.error}`);
				return k;
			}
		);
		return k;
	}

	/** a level of a kind asked for, once; its drawings made when it comes */
	function want(k, L, first = false) {
		const lv = k.levels[L];
		if (lv.state !== 'idle') return lv.promise;
		lv.state = 'loading';
		lv.promise = build(k.names[L], first).then(
			async (got) => {
				lv.level = prepare(got.obj, presets);
				lv.from = got.from;
				lv.meshes = lv.level.draws.map((d) => meshOf(k, L, d));
				const last = L === k.levels.length - 1;
				await compiled(lv, last);
				// its picture taken as soon as its coarsest shape is here, while the world loads, not by a frame that
				// wants it: a copy whose picture is missing draws that whole shape in its place
				if (last && !k.slot) k.slot = pictures.add(lv.level);
				lv.state = 'ready';
				dirty = true;
			},
			(err) => {
				lv.state = 'failed';
				throw err;
			}
		);
		lv.promise.catch(() => {});
		return lv.promise;
	}

	/** the world the renderer's group stands in: its lights and fog are in every shader its drawings get */
	const worldOf = () => {
		let s = group;
		while (s.parent) s = s.parent;
		return s.isScene ? s : null;
	};
	let compiling = 0;
	/**
	 * A level's shaders made before it is first drawn, beside the frames and not in one (where the browser can, else
	 * while the world loads): each new shader takes the GPU a while to make, and a frame that waits for it stalls the
	 * view. The coarsest level's for the picture studio too, which lights it otherwise.
	 */
	async function compiled(lv, studio) {
		const scene = worldOf();
		compiling++;
		try {
			if (scene) await Promise.all(lv.meshes.map(({ mesh }) => renderer.compileAsync(mesh, camera, scene)));
			if (studio) await pictures.prepare(lv.level);
		} finally {
			compiling--;
		}
	}

	/** one drawing of a level, as the instances of all its copies */
	function meshOf(k, L, d) {
		// its own shape (sharing the corners) for its own fade per copy
		const g = new THREE.BufferGeometry();
		for (const [name, a] of Object.entries(d.geometry.attributes)) g.setAttribute(name, a);
		g.setIndex(d.geometry.index);
		g.boundingBox = d.geometry.boundingBox;
		g.boundingSphere = d.geometry.boundingSphere;
		const cap = 16;
		const mesh = new THREE.InstancedMesh(g, d.material, cap);
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
		if (d.colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
		mesh.count = 0;
		mesh.visible = false;
		// which copies are drawn is chosen here, never by three's culling, which would see only the first
		mesh.frustumCulled = false;
		// the coarsest shape of a kind with finer ones casts no shadow: its picture's and the finer ones' are enough
		mesh.castShadow = d.cast && (k.names.length === 1 || L < k.names.length - 1);
		mesh.receiveShadow = true;
		mesh.name = `${k.label} · level ${L}`;
		group.add(mesh);
		return { mesh, draw: d, cap, used: 0 };
	}

	/** room in a drawing for `need` instances */
	function room(m, need) {
		if (m.cap >= need) return;
		const cap = Math.max(need, m.cap * 2);
		const old = m.mesh.instanceMatrix;
		const im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16).setUsage(THREE.DynamicDrawUsage);
		im.array.set(old.array.subarray(0, m.used * 16));
		m.mesh.instanceMatrix = im;
		const f = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
		f.array.set(m.mesh.geometry.attributes.aFade.array.subarray(0, m.used));
		m.mesh.geometry.setAttribute('aFade', f);
		if (m.mesh.instanceColor) {
			const c = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
			c.array.set(m.mesh.instanceColor.array.subarray(0, m.used * 3));
			m.mesh.instanceColor = c;
		}
		m.cap = cap;
	}

	/* ── the copies ── */
	const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m4 = new THREE.Matrix4();

	/**
	 * A copy of a kind put down: at x, y, z, turned by `turn` about the upright, at `scale`; or by a whole matrix.
	 * @param {any} k a kind (`use`) or a ref
	 * @param {{ x?: number, y?: number, z?: number, turn?: number, scale?: number } | THREE.Matrix4} at
	 * @returns {{ kind: any, i: number }}
	 */
	function place(k, at = {}) {
		if (typeof k === 'string') k = use(k);
		if (k.n >= k.cap) {
			const cap = Math.max(16, k.cap * 2);
			const grow = (A, n) => {
				const B = new A.constructor(cap * n);
				B.set(A);
				return B;
			};
			k.M = grow(k.M, 16);
			k.T = grow(k.T, 1);
			k.S = grow(k.S, 1);
			k.alive = grow(k.alive, 1);
			k.was = grow(k.was, 1);
			k.cap = cap;
		}
		const i = k.n++;
		set(k, i, at);
		k.alive[i] = 1;
		k.was[i] = -1;
		dirty = true;
		return { kind: k, i };
	}

	function set(k, i, at) {
		if (at?.isMatrix4) {
			at.toArray(k.M, i * 16);
			at.decompose(_p, _q, _s);
			// as an upright card sees it: its turn about the upright, its size
			k.T[i] = Math.atan2(at.elements[8], at.elements[0]);
			k.S[i] = Math.max(_s.x, _s.y, _s.z);
			return;
		}
		const turn = at.turn ?? 0, scale = at.scale ?? 1;
		_m4.compose(_p.set(at.x ?? 0, at.y ?? 0, at.z ?? 0), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn), _s.setScalar(scale));
		_m4.toArray(k.M, i * 16);
		k.T[i] = turn;
		k.S[i] = scale;
	}

	/** a copy moved */
	const move = (copy, at) => {
		set(copy.kind, copy.i, at);
		dirty = true;
	};
	/** a copy taken away */
	const remove = (copy) => {
		copy.kind.alive[copy.i] = 0;
		dirty = true;
	};

	/* ── each frame ── */
	const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), ball = new THREE.Sphere(), eye = new THREE.Vector3();
	const last = { world: new Float32Array(16), proj: new Float32Array(16) };
	const counted = { levels: [0, 0, 0], pictures: 0, tris: 0, calls: 0, culled: 0 };
	const same = (a, b) => {
		for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-5) return false;
		return true;
	};

	/** the level nearest `L` that is ready to draw: coarser first, then finer; -1 for none */
	function readyNear(k, L) {
		for (let j = L; j < k.levels.length; j++) if (k.levels[j].state === 'ready') return j;
		for (let j = L - 1; j >= 0; j--) if (k.levels[j].state === 'ready') return j;
		return -1;
	}

	/**
	 * Copy i of kind k drawn at level L (a shape, or its picture past the last), `fade` of it showing; the level it was
	 * drawn at (another, nearest, while L is not there yet), or -1 for none.
	 */
	function draw(k, i, L, fade) {
		const m = k.levels.length;
		if (L >= m) {
			if (k.slot) {
				pictures.push(k.slot, k.M[i * 16 + 12], k.M[i * 16 + 13], k.M[i * 16 + 14], k.T[i], k.S[i], fade);
				return m;
			}
			// no picture yet: its coarsest shape stands in, whole
			if (fade < 1) return -1;
			L = m - 1;
		}
		if (k.levels[L].state === 'idle') want(k, L);
		const R = readyNear(k, L);
		if (R < 0 || (R !== L && fade < 1)) return -1;
		const lv = k.levels[R];
		for (const d of lv.meshes) {
			const n = d.draw.n;
			room(d, d.used + n);
			const A = d.mesh.instanceMatrix.array, F = d.mesh.geometry.attributes.aFade.array;
			for (let j = 0; j < n; j++) {
				const s = d.used + j;
				multiply(k.M, i * 16, d.draw.locals, j * 16, A, s * 16);
				F[s] = fade >= 1 ? 0 : fade;
				if (d.draw.colors) d.mesh.instanceColor.array.set(d.draw.colors.subarray(j * 3, j * 3 + 3), s * 3);
			}
			d.used += n;
		}
		counted.levels[R] = (counted.levels[R] ?? 0) + 1;
		return R;
	}

	/**
	 * Draws what the camera should see: each copy at its level, the pictures turned to it. Cheap when nothing moved.
	 */
	function update() {
		camera.updateMatrixWorld();
		const world = camera.matrixWorld.elements, proj = camera.projectionMatrix.elements;
		if (!dirty && same(world, last.world) && same(proj, last.proj)) return false;
		dirty = false;
		last.world.set(world);
		last.proj.set(proj);
		view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		frustum.setFromProjectionMatrix(view);
		eye.setFromMatrixPosition(camera.matrixWorld);
		const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (camera.zoom || 1);
		counted.levels.fill(0);
		counted.culled = 0;
		pictures.begin();
		for (const k of kinds.values()) {
			for (const lv of k.levels) for (const d of lv.meshes ?? []) d.used = 0;
			if (!k.ok) continue;
			const c = k.center;
			for (let i = 0; i < k.n; i++) {
				if (!k.alive[i]) continue;
				const M = k.M, o = i * 16;
				ball.center.set(M[o] * c.x + M[o + 4] * c.y + M[o + 8] * c.z + M[o + 12], M[o + 1] * c.x + M[o + 5] * c.y + M[o + 9] * c.z + M[o + 13], M[o + 2] * c.x + M[o + 6] * c.y + M[o + 10] * c.z + M[o + 14]);
				ball.radius = k.radius * k.S[i];
				if (!frustum.intersectsSphere(ball)) {
					counted.culled++;
					continue;
				}
				const size = sizeOn(ball.radius, ball.center.distanceTo(eye), tanHalf);
				if (size < SMALLEST) continue;
				const { level, fade } = choose(size, k.thresholds, k.was[i]);
				k.was[i] = level;
				const drawn = draw(k, i, level, 1);
				// the coarser one fading in under it, unless it already stands in whole
				if (fade > 0 && drawn !== level + 1) draw(k, i, level + 1, fade);
			}
		}
		pictures.end();
		let tris = pictures.drawn * 2, calls = pictures.pages && pictures.drawn ? 1 : 0;
		for (const k of kinds.values())
			for (const lv of k.levels)
				for (const d of lv.meshes ?? []) {
					const m = d.mesh;
					m.count = d.used;
					m.visible = d.used > 0;
					if (!m.visible) continue;
					m.instanceMatrix.clearUpdateRanges();
					m.instanceMatrix.addUpdateRange(0, d.used * 16);
					m.instanceMatrix.needsUpdate = true;
					const f = m.geometry.attributes.aFade;
					f.clearUpdateRanges();
					f.addUpdateRange(0, d.used);
					f.needsUpdate = true;
					if (m.instanceColor) m.instanceColor.needsUpdate = true;
					tris += d.draw.tris * d.used;
					calls++;
				}
		counted.pictures = pictures.drawn;
		counted.tris = tris;
		counted.calls = calls;
		return true;
	}

	/**
	 * Waits for every kind used so far to have its coarsest shape (or to have failed); `onKind` hears each one come.
	 * @param {(done: number, of: number) => void} [onKind]
	 */
	async function ready(onKind) {
		const list = [...kinds.values()];
		let done = 0;
		await Promise.all(list.map((k) => k.ready.then(() => onKind?.(++done, list.length))));
		return list;
	}

	/** how much it draws now, and how much it holds */
	function stats() {
		const list = [...kinds.values()];
		return {
			kinds: list.length,
			loaded: list.filter((k) => k.ok).length,
			failed: list.filter((k) => k.error).map((k) => ({ label: k.label, error: k.error })),
			copies: list.reduce((a, k) => a + k.alive.subarray(0, k.n).reduce((x, y) => x + y, 0), 0),
			levels: counted.levels.slice(0, Math.max(...list.map((k) => k.levels.length), 1)),
			pictures: counted.pictures,
			culled: counted.culled,
			tris: counted.tris,
			calls: counted.calls,
			materials: presets.size,
			pages: pictures.pages,
			building: queue.length + loads + compiling,
			builds: list.reduce((a, k) => a + k.levels.filter((l) => l.state === 'ready').length, 0)
		};
	}

	return {
		group,
		use,
		place,
		move,
		remove,
		update,
		ready,
		stats,
		/** every kind used, with its levels */
		kinds: () => [...kinds.values()],
		/** cuts everything open along a plane (what is on its negative side taken away), or closes it (null) */
		cut(/** @type {THREE.Plane | null} */ plane) {
			presets.cut(plane);
			pictures.cut(plane);
			dirty = true;
		},
		/** asks again, the next frame, what to draw (after something changed that the renderer cannot see) */
		touch: () => (dirty = true),
		dispose() {
			group.removeFromParent();
			for (const k of kinds.values())
				for (const lv of k.levels)
					for (const d of lv.meshes ?? []) {
						d.mesh.geometry.dispose();
						d.mesh.dispose();
					}
			for (const k of kinds.values()) for (const lv of k.levels) for (const d of lv.level?.draws ?? []) d.geometry.dispose();
			pictures.dispose();
			presets.dispose();
			for (const p of pool) p.box.stop('the renderer was disposed');
			queue.length = 0;
			kinds.clear();
		}
	};
}
