// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * A CROWD, BUILT IN THE BOX — many of one kind of rigged actor in a world (a flock of hens, a herd of goats, a hive's
 * bees, a pond's fish, a forest's songbirds; a town's people as well), every one built in the asset box like any other
 * asset (../load.js) and drawn here: the ones near the eye as rigged copies, every bone set each frame from the clips
 * the box wrote down (../clips.js), each copy at its own time and as it moves; the rest, too far to see a leg move,
 * as instances of a coarser build of the same actor at rest, a hundred of them a draw call. Which is which is asked
 * again every frame, so the same frame of a shot always draws the same.
 *
 * Each coat is two builds of its ref: at `detail` (a fifth, `FAR`) for afar, and as it is for near. Until a coat's far
 * build is here its copies are not drawn; until its near one is, they are drawn as from afar. A film waits for both
 * (`settled`). Its actor's own code never runs in the page: what moves it are the tables.
 *
 * Each frame: `begin()`, `put()` every one of them, `end()`.
 */
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { blend, playerOf, poser } from '../clips.js';

export { blend };

/** @typedef {Record<string, number[]>} Pose a pose: each bone's turn (and size, offset), the root's place */
/** @typedef {(t: number, m?: { dist: number, speed: number, turn?: number }) => Pose} Clip */
/** @typedef {{ geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[] }} Shape */

/** how coarse an actor is drawn from afar */
export const FAR = 0.2;

/** the loader and the boxes crowds are built in, a few side by side (one for each spare core, up to three), and the
 *  Maia City vault's recipes they are built from (../vault.js): fetched when a crowd first builds, so a world's module
 *  can be read where there is no page (a test, a recipe's library) */
let loader = null;
let turn = 0;
const loaderOf = () =>
	(loader ??= Promise.all([import('../box/host.js'), import('../load.js'), import('../vault.js')]).then(async ([{ AssetBox }, { loadAsset }, { INDEX, buildAt, loadRecipes }]) => {
		await loadRecipes();
		const n = Math.max(1, Math.min(3, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1));
		const boxes = Array.from({ length: n }, () => new AssetBox({ engine: INDEX.engine }));
		return { loadAsset, buildAt, box: () => boxes[turn++ % boxes.length] };
	}));

/** every build asked for, by its name: the one load of it */
const loads = new Map();
/**
 * A build of an actor, once: its ref at a detail (1: as it is).
 * @param {string} ref @param {number} detail
 */
function built(ref, detail) {
	const label = detail < 1 ? `${ref}?detail=${detail}` : ref;
	if (!loads.has(label))
		loads.set(
			label,
			loaderOf()
				.then((L) => L.loadAsset(L.buildAt(label), { box: L.box() }))
				.catch((e) => {
					console.warn(`a crowd's ${ref} at ${detail} was not built: ${e?.message ?? e}`);
					return null;
				})
		);
	return loads.get(label);
}

/** every crowd made, held weakly (a dome's crowds go with it): what `wantNear` asks */
const crowds = new Set();
/**
 * The near builds the actors round these points will need (a shot's camera path, src/lib/sandbox-kit/stream.js views),
 * asked for now: a rigged build is made only for a coat one of whose actors comes near an eye, never up front, and a
 * shot asks for those its camera passes before it is drawn (`settled` then waits for them).
 * @param {{ x: number, y?: number, z: number }[]} points
 */
export function wantNear(points) {
	for (const ref of crowds) {
		const c = ref.deref();
		if (c) c.want(points);
		else crowds.delete(ref);
	}
}

/** every build a crowd asked for, here (or failed) */
export async function settled() {
	let n = -1;
	// (a near build is asked for once its far one is here: wait until nothing more is asked)
	while (n !== loads.size) {
		n = loads.size;
		await Promise.all(loads.values());
	}
}

/** the first mesh of a tree */
const meshOf = (root) => {
	let m = null;
	root.traverse((o) => (m ??= o.isMesh ? o : null));
	return m;
};

/**
 * A crowd of `counts[c]` actors in each coat `c`, coat c built from `refs[c]` (`actors/goat:goat-saanen`).
 * @param {string[]} refs
 * @param {number[]} counts
 * @param {{
 *   near: number, max: number, scale?: number, lift?: number, shadows?: boolean, detail?: number,
 *   farShape?: (coat: number) => { geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[] }
 * }} o `near`: up to how far (m) from the eye they are rigged; `max`: how many at most at once; `scale`: how big they
 *   are against the build (a bee drawn larger than life, to be seen); `lift`: how high the build's middle stands over
 *   its origin (`put` gives the middle's height); `shadows`: whether they cast them; `detail`: how coarse from afar
 *   (`FAR`); `farShape`: what stands in for them from afar instead of a coarser build (a bee: a striped speck)
 */
export function crowd(refs, counts, o) {
	const { near, max, scale = 1, lift = 0, shadows = true, detail = FAR } = o;
	const object = new THREE.Group();
	/** far: the coarse build at rest, one instanced mesh a coat */
	const far = counts.map(() => null);
	const farMesh = (c, shape) => {
		const mesh = new THREE.InstancedMesh(shape.geometry, shape.material, Math.max(1, counts[c]));
		mesh.count = 0;
		mesh.castShadow = shadows;
		mesh.frustumCulled = false;
		object.add(mesh);
		far[c] = mesh;
	};
	/** near: the build as it is, a pool of copies a coat, each made the first time one is wanted */
	const models = counts.map(() => null);
	/** @type {(Record<string, Clip> | undefined)[]} each coat's clips, played from its tables, once its near build is here */
	const clips = counts.map(() => undefined);
	const pools = counts.map(() => []);
	/** whether each coat's near (rigged) build is asked for: only once one of its actors comes near an eye */
	const asked = counts.map(() => false);
	const askNear = (/** @type {number} */ c) => {
		if (asked[c]) return;
		asked[c] = true;
		void built(refs[c], 1).then((got) => {
			if (!got) return;
			const view = got.obj.userData.view;
			models[c] = got.obj;
			clips[c] = playerOf(view?.clips?.motion, view?.clips?.bones ?? []);
		});
	};
	refs.forEach((ref, c) => {
		if (o.farShape) return void farMesh(c, o.farShape(c));
		void built(ref, detail).then((got) => {
			const m = got && meshOf(got.obj);
			if (m) farMesh(c, { geometry: m.geometry, material: m.material });
		});
	});
	const rigged = (c, k) => {
		const pool = pools[c];
		while (pool.length <= k) {
			const model = models[c];
			// copied without the build's notes (its tables are many, and every copy plays the build's)
			const notes = model.userData;
			model.userData = {};
			let copy;
			try {
				copy = clone(model);
			} finally {
				model.userData = notes;
			}
			const mesh = meshOf(copy);
			copy.traverse((x) => {
				if (!x.isMesh) return;
				x.frustumCulled = false;
				x.castShadow = shadows;
				x.receiveShadow = true;
			});
			object.add(copy);
			pool.push({ copy, pose: poser(mesh?.skeleton?.bones ?? []) });
		}
		return pool[k];
	};

	let entries = [];
	/** where its actors stood the last frame (what `want` measures from) */
	let last = [];
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3();
	const self = {
		object,
		/**
		 * The near builds of the coats with an actor within `near` (and a margin, they move) of any of these points,
		 * asked for (`wantNear`).
		 * @param {{ x: number, z: number }[]} points
		 */
		want(points) {
			const r2 = (near * 1.5) ** 2;
			for (const en of last) if (!asked[en.coat] && points.some((pt) => (pt.x - en.x) ** 2 + (pt.z - en.z) ** 2 < r2)) askNear(en.coat);
		},
		/** each coat's clips, by name, once its near build is here: (t, motion) → pose */
		clips,
		begin() {
			entries = [];
		},
		/**
		 * one of them: its coat, where its middle is, which way it faces (and leans, drawn from afar), how far from the
		 * eye (squared), its pose if it is near enough to be rigged, and its size against the build
		 * @param {number} coat @param {number} x @param {number} y @param {number} z @param {number} yaw @param {number} d2
		 * @param {() => Pose} pose @param {number} [pitch] @param {number} [roll] @param {number} [size]
		 */
		put(coat, x, y, z, yaw, d2, pose, pitch = 0, roll = 0, size = 1) {
			entries.push({ coat, x, y: y - lift * scale * size, z, yaw, pitch, roll, d2, size, pose });
		},
		end() {
			last = entries;
			// a coat with an actor near the eye: its rigged build asked for (drawn coarse until it is here)
			for (const en of entries) if (en.d2 < near * near) askNear(en.coat);
			const close = entries.filter((en) => en.d2 < near * near && models[en.coat]).sort((a, b) => a.d2 - b.d2).slice(0, max);
			const chosen = new Set(close);
			const used = counts.map(() => 0);
			for (const en of close) {
				const r = rigged(en.coat, used[en.coat]++);
				r.copy.visible = true;
				r.copy.position.set(en.x, en.y, en.z);
				r.copy.rotation.set(0, en.yaw, 0);
				r.copy.scale.setScalar(scale * en.size);
				r.pose(en.pose());
			}
			pools.forEach((pool, c) => pool.forEach((r, k) => (r.copy.visible = k < used[c])));
			const slot = counts.map(() => 0);
			for (const en of entries) {
				if (chosen.has(en)) continue;
				const mesh = far[en.coat];
				if (!mesh) continue;
				q.setFromEuler(e.set(en.pitch, en.yaw, en.roll));
				mesh.setMatrixAt(slot[en.coat]++, m.compose(p.set(en.x, en.y, en.z), q, s.setScalar(scale * en.size)));
			}
			far.forEach((mesh, c) => {
				if (!mesh) return;
				mesh.count = slot[c];
				mesh.instanceMatrix.needsUpdate = true;
			});
		}
	};
	crowds.add(new WeakRef(self));
	return self;
}

/**
 * One rigged actor's builds for a world that places its copies itself (an ant hill on the forest floor): its far
 * shape (the coarse build's mesh at rest) and, once here, a copy of its near build to pose, with its clips.
 * @param {string} ref @param {number} [detail]
 */
export function actor(ref, detail = FAR) {
	/** @type {{ far: Shape | null, model: THREE.Object3D | null, clips: Record<string, Clip> | undefined, ready: Promise<void>, copy: () => { object: THREE.Object3D, pose: (p: Pose) => void } }} */
	const out = { far: null, model: null, clips: undefined, ready: Promise.resolve(), copy: () => ({ object: new THREE.Group(), pose: () => {} }) };
	out.ready = built(ref, detail).then((got) => {
		const m = got && meshOf(got.obj);
		if (m) out.far = { geometry: m.geometry, material: m.material };
		return built(ref, 1).then((n) => {
			if (!n) return;
			const view = n.obj.userData.view;
			out.model = n.obj;
			out.clips = playerOf(view?.clips?.motion, view?.clips?.bones ?? []);
		});
	});
	/** a copy of the near build, and how to pose it */
	out.copy = () => {
		const model = out.model;
		const notes = model.userData;
		model.userData = {};
		let copy;
		try {
			copy = clone(model);
		} finally {
			model.userData = notes;
		}
		const mesh = meshOf(copy);
		copy.traverse((x) => x.isMesh && (x.frustumCulled = false));
		return { object: copy, pose: poser(mesh?.skeleton?.bones ?? []) };
	};
	return out;
}
