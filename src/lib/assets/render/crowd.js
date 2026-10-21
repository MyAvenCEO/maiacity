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
/** how far (m) an actor is in sight: within it (and in a shot's frame) its coarse build is made, never before */
export const SEEN = 300;

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
 * After how long (ms) a build that failed only in passing (`Unread`: its recipe's proof or file wasn't handed over,
 * as the vault's server restarted) is forgotten, so the next view that needs it asks again: it comes once the server
 * is back, never missing for as long as the page is open (the village's animals, 2026-10-20). One that failed for good
 * stays failed.
 */
const AGAIN_AFTER = 60_000;
/**
 * A build of an actor, once: its ref at a detail (1: as it is).
 * @param {string} ref @param {number} detail
 */
function built(ref, detail) {
	const label = labelOf(ref, detail);
	if (!loads.has(label))
		loads.set(
			label,
			loaderOf()
				.then((L) => L.loadAsset(L.buildAt(label), { box: L.box() }))
				.catch((e) => {
					console.warn(`a crowd's ${ref} at ${detail} was not built: ${e?.message ?? e}`);
					if (e?.name === 'Unread') again.add(label);
					setTimeout(() => {
						if (!again.has(label)) return;
						loads.delete(label);
						done.delete(label);
					}, AGAIN_AFTER);
					return null;
				})
				.finally(() => done.add(label))
		);
	return loads.get(label);
}
/** the builds that failed only in passing, asked for again after `AGAIN_AFTER` */
const again = new Set();
/** whether a build that failed is asked for again (`AGAIN_AFTER`) @param {string} ref @param {number} detail */
const retried = (ref, detail) => again.has(labelOf(ref, detail));
/** a build's name: its ref at a detail @param {string} ref @param {number} detail */
const labelOf = (ref, detail) => (detail < 1 ? `${ref}?detail=${detail}` : ref);
/** the builds here (or failed): what `nearReady` asks without waiting */
const done = new Set();

/** every crowd made, held weakly (a dome's crowds go with it): what `wantNear` asks */
const crowds = new Set();
/**
 * The builds the actors these views will see need (a shot's camera path, src/lib/sandbox-kit/stream.js views), asked
 * for now: a coat's coarse build once one of its actors is in a view's frame within SEEN, its rigged build once one
 * comes near — never up front; a shot asks for what its camera sees before it is drawn (`settled` then waits for it).
 * @param {{ x: number, y?: number, z: number, frustum?: { containsPoint(p: { x: number, y: number, z: number }): boolean } | null }[]} points
 */
export function wantNear(points) {
	const labels = needed(points, true);
	return Promise.all(labels.map((l) => loads.get(l))).then(() => undefined);
}
/**
 * Whether every build the actors these views will see need is here (or failed), asking nothing: a world that holds a
 * shot only once its actors are built says so with it (the cut then never waits for one).
 * @param {Parameters<typeof wantNear>[0]} points
 */
export function nearReady(points) {
	return needed(points, false).every((l) => done.has(l) || !loads.has(l));
}
/** the builds the actors round `points` need, asked for when `ask` @param {Parameters<typeof wantNear>[0]} points @param {boolean} ask */
function needed(points, ask) {
	/** @type {string[]} */
	const out = [];
	for (const ref of crowds) {
		const c = ref.deref();
		if (c) out.push(...c.want(points, ask));
		else crowds.delete(ref);
	}
	return out;
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

/** the nearer of two actors first */
const nearer = (/** @type {{ d2: number }} */ a, /** @type {{ d2: number }} */ b) => a.d2 - b.d2;

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
 *   near: number, max: number, scale?: number, lift?: number, shadows?: boolean, detail?: number, seen?: number,
 *   farShape?: (coat: number) => { geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[] }
 * }} o `near`: up to how far (m) from the eye they are rigged; `max`: how many at most at once; `scale`: how big they
 *   are against the build (a bee drawn larger than life, to be seen); `lift`: how high the build's middle stands over
 *   its origin (`put` gives the middle's height); `shadows`: whether they cast them; `detail`: how coarse from afar
 *   (`FAR`); `farShape`: what stands in for them from afar instead of a coarser build (a bee: a striped speck)
 */
export function crowd(refs, counts, o) {
	const { near, max, scale = 1, lift = 0, shadows = true, detail = FAR, seen = SEEN } = o;
	// the boxes and the recipes, made ready now while the world loads: the first build asked for (the first shot's)
	// finds them warm
	void loaderOf().catch(() => {});
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
			// asked again once the build that failed is forgotten (`AGAIN_AFTER`), by the next frame or view near it
			if (!got) return void (retried(refs[c], 1) && setTimeout(() => (asked[c] = false), AGAIN_AFTER));
			const view = got.obj.userData.view;
			models[c] = got.obj;
			clips[c] = playerOf(view?.clips?.motion, view?.clips?.bones ?? []);
		});
	};
	/** whether each coat's coarse build is asked for: only once one of its actors is in sight of an eye (`seen`) */
	const askedFar = counts.map(() => false);
	const askFar = (/** @type {number} */ c) => {
		if (askedFar[c]) return;
		askedFar[c] = true;
		if (o.farShape) return void farMesh(c, o.farShape(c));
		void built(refs[c], detail).then((got) => {
			if (!got) return void (retried(refs[c], detail) && setTimeout(() => (askedFar[c] = false), AGAIN_AFTER));
			const m = meshOf(got.obj);
			if (m) farMesh(c, { geometry: m.geometry, material: m.material });
		});
	};
	// a drawn far shape costs no build: there from the start
	if (o.farShape) refs.forEach((_, c) => askFar(c));
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

	// a frame's actors, written over each frame into records kept from the one before (a crowd of thousands made a
	// record for each of them every frame, garbage the page's collections stopped frames to sweep): `n` of them this
	// frame, `lastN` the frame before (where its actors stood: what `want` measures from)
	/** @type {{ coat: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, d2: number, size: number, pose: (() => Pose) | undefined, chosen: boolean }[]} */
	const entries = [];
	let n = 0, lastN = 0;
	/** and what each frame works with, made once */
	/** @type {typeof entries} */
	const close = [];
	const used = counts.map(() => 0), slot = counts.map(() => 0), farOf = counts.map(() => false), nearOf = counts.map(() => false);
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3();
	const self = {
		object,
		/**
		 * The near builds of the coats with an actor within `near` (and a margin, they move) of any of these points,
		 * asked for when `ask` (`wantNear`); answers the builds they need.
		 * @param {{ x: number, y?: number, z: number, frustum?: any }[]} points @param {boolean} [ask]
		 */
		want(points, ask = true) {
			const r2 = (near * 1.5) ** 2, s2 = seen * seen;
			farOf.fill(false);
			nearOf.fill(false);
			for (let i = 0; i < lastN; i++) {
				const en = entries[i];
				if (!farOf[en.coat])
					for (const pt of points)
						if ((pt.x - en.x) ** 2 + ((pt.y ?? en.y) - en.y) ** 2 + (pt.z - en.z) ** 2 < s2 && (!pt.frustum || pt.frustum.containsPoint(en))) {
							farOf[en.coat] = true;
							break;
						}
				if (!nearOf[en.coat])
					for (const pt of points)
						if ((pt.x - en.x) ** 2 + (pt.z - en.z) ** 2 < r2) {
							nearOf[en.coat] = true;
							break;
						}
			}
			/** @type {string[]} */
			const labels = [];
			refs.forEach((ref, c) => {
				if (farOf[c] && !o.farShape) {
					if (ask) askFar(c);
					labels.push(labelOf(ref, detail));
				}
				if (nearOf[c]) {
					if (ask) askNear(c);
					labels.push(labelOf(ref, 1));
				}
			});
			return labels;
		},
		/** each coat's clips, by name, once its near build is here: (t, motion) → pose */
		clips,
		begin() {
			n = 0;
		},
		/**
		 * one of them: its coat, where its middle is, which way it faces (and leans, drawn from afar), how far from the
		 * eye (squared), its pose if it is near enough to be rigged (asked only of those: one further off than `near`
		 * may pass none), and its size against the build
		 * @param {number} coat @param {number} x @param {number} y @param {number} z @param {number} yaw @param {number} d2
		 * @param {(() => Pose) | undefined} pose @param {number} [pitch] @param {number} [roll] @param {number} [size]
		 */
		put(coat, x, y, z, yaw, d2, pose, pitch = 0, roll = 0, size = 1) {
			const en = entries[n] ?? (entries[n] = { coat: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, d2: 0, size: 1, pose: undefined, chosen: false });
			n++;
			en.coat = coat;
			en.x = x;
			en.y = y - lift * scale * size;
			en.z = z;
			en.yaw = yaw;
			en.pitch = pitch;
			en.roll = roll;
			en.d2 = d2;
			en.size = size;
			en.pose = pose;
			en.chosen = false;
		},
		end() {
			lastN = n;
			// a coat with an actor in sight: its coarse build asked for; near the eye: its rigged one (drawn coarse until
			// it is here); the nearest `max` of those whose rigged build is here, rigged
			const near2 = near * near, seen2 = seen * seen;
			close.length = 0;
			for (let i = 0; i < n; i++) {
				const en = entries[i];
				if (en.d2 < seen2) askFar(en.coat);
				if (en.d2 < near2) {
					askNear(en.coat);
					if (models[en.coat]) close.push(en);
				}
			}
			close.sort(nearer);
			if (close.length > max) close.length = max;
			used.fill(0);
			for (const en of close) {
				en.chosen = true;
				const r = rigged(en.coat, used[en.coat]++);
				r.copy.visible = true;
				r.copy.position.set(en.x, en.y, en.z);
				r.copy.rotation.set(0, en.yaw, 0);
				r.copy.scale.setScalar(scale * en.size);
				r.pose(en.pose?.() ?? {});
			}
			for (let c = 0; c < pools.length; c++) for (let k = 0; k < pools[c].length; k++) pools[c][k].copy.visible = k < used[c];
			slot.fill(0);
			for (let i = 0; i < n; i++) {
				const en = entries[i];
				// (its pose let go: the frame's closures are not kept for the next)
				en.pose = undefined;
				if (en.chosen) continue;
				const mesh = far[en.coat];
				if (!mesh) continue;
				q.setFromEuler(e.set(en.pitch, en.yaw, en.roll));
				mesh.setMatrixAt(slot[en.coat]++, m.compose(p.set(en.x, en.y, en.z), q, s.setScalar(scale * en.size)));
			}
			for (let c = 0; c < far.length; c++) {
				const mesh = far[c];
				if (!mesh) continue;
				mesh.count = slot[c];
				mesh.instanceMatrix.needsUpdate = true;
			}
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
