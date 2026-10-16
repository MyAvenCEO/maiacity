// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE UNIVERSAL RENDERER — one way for any page (a viewer, a sandbox, a world, a film) to draw our assets and anyone's,
 * as many of them as a world holds: `use` an asset by its label or its build (`plants/apple@2?stage=9`,
 * `<recipe hash>?its=values`), `place` it as often as you like, and `update` each frame before the scene is drawn.
 *
 * - Every build comes the one way any build comes (../load.js): from this device's cache, else from the asset box,
 *   checked. Nothing of an asset runs here; what it made is only data, and our code draws it.
 * - Each kind is drawn at the level of detail its size on screen calls for (./lod.js): three shapes and, smallest, its
 *   picture (./impostors.js). A recipe that takes a `detail` (the plants) is built at a lower detail for each, its
 *   coarsest first, so a world stands as soon as it has it, and a finer one is asked for only once a copy is near
 *   enough to want it. Every other kind is built once, at its finest, and its two lower levels are made from that
 *   build's own geometry by simplifying it (./lower.js, ./simplify.js), beside the page, in a worker of their own,
 *   each within what it may cost. Its picture is taken from the coarsest shape it was built at.
 * - Every copy of a kind at one level is one more instance of the same few drawings (./prepare.js): a forest of a
 *   thousand trees of forty kinds is a few hundred draw calls, the pictures a handful.
 * - Every material is the renderer's own (./presets.js), with the shader code only we add: the dither a level fades
 *   in by, and the kit's section caps when the world is cut open (`cut`).
 * - A copy moved by its controls (a tent half pitched, a pickup's door open, a machine drawn apart: `pose`, from the
 *   numbers the box wrote down, ../controls.js) leaves the instances and is drawn as a tree of its own, its parts where
 *   its controls put them, at any distance (a picture cannot open a door); back at rest, it joins the others again.
 *
 * Several boxes build side by side while a world loads (`boxes`), each a frame and a worker of its own.
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AssetBox } from '../box/host.js';
import { labelOf, poserOf } from '../controls.js';
import { canonical, loadAsset } from '../load.js';
import { INDEX, buildOf, hashOf, parseBuild } from '../recipes.js';
import { parseRef } from '../refs.js';
import { createImpostors } from './impostors.js';
import { LEVELS, SMALLEST, budgetOf, choose, errorOf, sizeOn, smallestOf, thresholdsOf } from './lod.js';
import { createLowering } from './lower.js';
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
 *   levels?: number[], px?: number, cache?: boolean, onShadows?: () => void
 * }} o `boxes` how many build side by side; `details` and `levels` the details a recipe is built at and the sizes on
 *   screen each is drawn to (./lod.js); `px` each picture's pixels a side; `cache: false` builds everything afresh;
 *   `onShadows` told when what casts a shadow changed, for a world that draws its shadows again only every so often
 *   (else they are drawn again with the next frame)
 */
export function createAssets(o) {
	const { renderer, camera } = o;
	const details = o.details ?? DETAILS;
	const levels = o.levels ?? LEVELS;
	renderer.localClippingEnabled = true;
	// three turns a PCFSoftShadowMap (gone from it) into a PCFShadowMap at its first shadow pass; a shader made before
	// that samples its shadow plainly and is never drawn (GL_INVALID_OPERATION). Ours are made early, while a world
	// loads, so it is turned here first: the shadows three draws are the same
	if (renderer.shadowMap.type === THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFShadowMap;
	const group = new THREE.Group();
	group.name = 'assets';
	const presets = createPresets();
	const pictures = createImpostors(renderer, { px: o.px });
	const lowering = createLowering();
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
	/** something to draw changed; and what casts shadows did */
	let dirty = true, shadows = true;
	/** the renderer was disposed */
	let gone = false;

	/**
	 * A kind: an asset at its version, variant and values, at every level it is drawn at. Asked for again, the same (as
	 * it was first asked for). `shadows`: true, its shadow cast at every level; false, at none; else as below
	 * (`meshOf`). `picture: false`, none taken: a kind a world never draws so small. `receive: false`, no shadow falls
	 * on it (a world that always drew it so: its builder lays none on it).
	 * @param {string} ref a label or a build @param {{ shadows?: boolean, picture?: boolean, receive?: boolean }} [opts]
	 */
	function use(ref, opts) {
		const { hash, params } = resolve(ref);
		const at = INDEX.recipes[hash];
		if (!at) throw new Error(`no recipe ${hash.slice(0, 12)}… on this device`);
		const takes = at.params?.some((p) => p.id === 'detail');
		// each named as it is kept, its own values filled in, so two refs of one build are one kind
		const names = (takes ? details.slice(0, levels.length).map((d) => buildOf(hash, { ...params, detail: String(d) })) : [buildOf(hash, params)]).map((n) => canonical(n).name);
		const key = names[0];
		let k = kinds.get(key);
		if (k) return k;
		k = {
			key,
			label: at.label,
			names,
			// each level of its shape: built from its recipe (`name`), or made from the coarsest one built (none)
			levels: levels.map((_, L) => ({ state: 'idle', level: null, meshes: null, name: names[L] ?? null, as: -1 })),
			/** the coarsest level built: its measure is the kind's, and its picture is taken from it */
			base: names.length - 1,
			ok: false,
			error: null,
			radius: 1,
			center: new THREE.Vector3(),
			thresholds: thresholdsOf(levels.length, undefined, levels),
			/** its thresholds the world's own (`tune`), not its shape's */
			tuned: false,
			shadows: opts?.shadows,
			receive: opts?.receive !== false,
			picture: opts?.picture !== false,
			slot: null,
			n: 0,
			cap: 0,
			M: new Float32Array(0),
			T: new Float32Array(0),
			S: new Float32Array(0),
			alive: new Uint8Array(0),
			was: new Int8Array(0),
			/** the copies moved by their controls, by their number: each its values and its own tree */
			posed: new Map()
		};
		kinds.set(key, k);
		// the coarsest shape built first: its measure is the kind's, and its picture is taken from it
		k.ready = want(k, k.base, true).then(
			() => {
				const L = k.levels[k.base].level;
				k.radius = L.radius;
				k.center.copy(L.center);
				retune(k);
				k.ok = true;
				dirty = shadows = true;
				// and the levels made from it, made now, beside the frames: most of a world's copies want those first
				if (k.base < k.levels.length - 1) want(k, k.levels.length - 1);
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

	/** a kind's thresholds by its coarsest shape: as it came, or, while it is being made, by what it may cost */
	function retune(k) {
		if (k.tuned) return;
		const last = k.levels.length - 1;
		const tris = k.levels[last].level?.tris ?? budgetOf(last, k.levels[k.base].level.tris, levels);
		k.thresholds = thresholdsOf(k.levels.length, tris, levels);
	}

	/** what level L of a kind made from `from` (a level of it, or the source of several) is made to: ./lod.js */
	const planOf = (L, from) => ({ budget: budgetOf(L, from.tris, levels), most: budgetOf(L, Infinity, levels), error: errorOf(L, from.radius, levels), smallest: smallestOf(L, from.radius, levels) });

	/** a level of a kind asked for, once; its drawings made when it comes */
	function want(k, L, first = false) {
		const lv = k.levels[L];
		if (lv.state !== 'idle') return lv.promise;
		if (!lv.name) return lower(k, L);
		lv.state = 'loading';
		lv.promise = build(lv.name, first).then(
			async (got) => {
				lv.level = prepare(got.obj, presets);
				lv.from = got.from;
				// a build with controls is kept whole as well: a copy moved by them is a tree copied from it
				if (got.obj.userData.controls?.length) lv.obj = got.obj;
				await show(k, L);
				if (L > 0 && lv.level.tris > budgetOf(L, Infinity, levels)) lighten(k, L);
			},
			(err) => {
				lv.state = 'failed';
				throw err;
			}
		);
		lv.promise.catch(() => {});
		return lv.promise;
	}

	/**
	 * The levels of a kind made from its coarsest build (every one not asked for yet, together: its corners welded once
	 * for all), once that build is here.
	 */
	function lower(k, L) {
		const list = k.levels.map((_, j) => j).filter((j) => !k.levels[j].name && k.levels[j].state === 'idle');
		const made = want(k, k.base).then(() => {
			const from = k.levels[k.base].level;
			return lowering.lower(from, list.map((j) => planOf(j, from)));
		});
		list.forEach((j, n) => {
			const lv = k.levels[j];
			lv.state = 'loading';
			lv.promise = made.then(
				async (out) => {
					lv.level = out[n];
					lv.from = 'made';
					// nothing taken away (a kiosk of sixty triangles): drawn as the level it was made from
					if (lv.level.same) lv.as = k.base;
					await show(k, j);
					if (j === k.levels.length - 1) retune(k);
				},
				(err) => {
					lv.state = 'failed';
					// its build's own failure is told once, by `use`
					if (k.levels[k.base].state === 'ready') console.warn(`assets: ${k.label}: level ${j} was not made: ${err?.message ?? err}`);
					throw err;
				}
			);
			lv.promise.catch(() => {});
		});
		return k.levels[L].promise;
	}

	/**
	 * A level built from its recipe that is over its ceiling (./lod.js: a big tree's crown at detail 0.1, a walnut's
	 * 18,328 triangles) brought under it by simplifying, every piece of it kept (a crown thinned shows): beside the page,
	 * after the levels still to be made, and drawn as it came until then. Its picture, already taken, and its kind's
	 * thresholds stay as its recipe made them.
	 */
	function lighten(k, L) {
		const lv = k.levels[L], from = lv.level;
		const most = budgetOf(L, Infinity, levels);
		lowering.lower(from, [{ ...planOf(L, from), budget: most, most, every: true }], true).then(
			async ([made]) => {
				if (gone || lv.level !== from) return;
				const fresh = { level: made, meshes: made.draws.map((d) => meshOf(k, L, d)) };
				await compiled(fresh, false);
				// the new drawings take the old ones' place (unless the renderer went meanwhile: then they go)
				const away = gone || lv.level !== from ? fresh.meshes : lv.meshes;
				if (away !== fresh.meshes) Object.assign(lv, fresh);
				for (const { mesh } of away) {
					mesh.removeFromParent();
					mesh.geometry.dispose();
					mesh.dispose();
				}
				dirty = shadows = true;
			},
			(err) => gone || console.warn(`assets: ${k.label}: level ${L} was not brought under its ceiling: ${err?.message ?? err}`)
		);
	}

	/** a level that came: its drawings made, their shaders too, and, the coarsest built, its picture taken */
	async function show(k, L) {
		const lv = k.levels[L];
		lv.meshes = lv.as >= 0 ? [] : lv.level.draws.map((d) => meshOf(k, L, d));
		const base = L === k.base;
		await compiled(lv, base && k.picture);
		// its picture taken as soon as its coarsest built shape is here, while the world loads, not by a frame that
		// wants it: a copy whose picture is missing draws that whole shape in its place
		if (base && !k.slot && k.picture) k.slot = pictures.add(lv.level);
		lv.state = 'ready';
		dirty = shadows = true;
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
		// three draws a soft (PCF-soft) shadow as PCF from its first shadow pass on, and a shader made before that pass
		// would read the shadow as a plain texture: WebGL then refuses every draw of it (a world's near plants left out
		// until its lights next change). Made as it will be drawn.
		if (renderer.shadowMap.type === THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFShadowMap;
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
		// the coarsest shape of a plant casts no shadow, its picture's and its finer shapes' are enough; a kind built
		// once casts one at every level, as it did when it had only the one; a kind asked for with its shadows (`use`)
		// casts them at every level, or at none
		mesh.castShadow = k.shadows ?? (d.cast && (k.names.length === 1 || L < k.names.length - 1));
		mesh.receiveShadow = k.receive;
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
		dirty = shadows = true;
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
		dirty = shadows = true;
	};
	/** a copy taken away */
	const remove = (copy) => {
		copy.kind.alive[copy.i] = 0;
		unpose(copy.kind, copy.i);
		dirty = shadows = true;
	};

	/* ── the copies moved by their controls ── */
	/** the level nearest `L` that is ready and has its controls: coarser first, then finer; -1 for none */
	function controlledNear(k, L) {
		const ok = (j) => k.levels[j].state === 'ready' && k.levels[j].obj;
		for (let j = L; j < k.levels.length; j++) if (ok(j)) return j;
		for (let j = L - 1; j >= 0; j--) if (ok(j)) return j;
		return -1;
	}

	/**
	 * The controls a kind's copies have (a level of it must be here): each its id, its name, its ends, its rest, whether
	 * it is a choice. None for a kind without.
	 * @param {any} k a kind (`use`), a copy (`place`) or a ref
	 */
	function controlsOf(k) {
		if (typeof k === 'string') k = use(k);
		if (k?.kind) k = k.kind;
		const L = controlledNear(k, 0);
		if (L < 0) return [];
		return k.levels[L].obj.userData.controls.map((c) => ({ id: c.id, label: labelOf(c.id), from: c.from, to: c.to, rest: c.rest, choice: !!c.choice }));
	}

	/**
	 * A copy's control set to `v` (kept between its ends): the copy is drawn with its parts where that puts them; every
	 * control back at its rest, it is drawn with the others again.
	 * @param {{ kind: any, i: number }} copy
	 * @param {string} id
	 * @param {number} v
	 */
	function pose(copy, id, v) {
		const { kind: k, i } = copy;
		const c = controlsOf(k).find((x) => x.id === id);
		if (!c || !k.alive[i] || !Number.isFinite(Number(v))) return;
		const at = Math.min(Math.max(c.from, c.to), Math.max(Math.min(c.from, c.to), Number(v)));
		let p = k.posed.get(i);
		if (!p) k.posed.set(i, (p = { values: new Map(), tree: null, L: -1, poser: null, ready: false, shown: false, tris: 0, calls: 0 }));
		if (at === c.rest) p.values.delete(id);
		else p.values.set(id, at);
		if (!p.values.size) unpose(k, i);
		else if (p.poser) {
			p.poser.reset();
			p.poser.setMany(p.values);
		}
		dirty = shadows = true;
	}

	/** a copy's controls now, by id: each at its value, or at its rest */
	function poseOf(copy) {
		const p = copy.kind.posed.get(copy.i);
		return Object.fromEntries(controlsOf(copy.kind).map((c) => [c.id, p?.values.get(c.id) ?? c.rest]));
	}

	/** a copy's controls all back at rest: its tree taken away */
	function unpose(k, i) {
		const p = k.posed.get(i);
		if (!p) return;
		p.tree?.removeFromParent();
		k.posed.delete(i);
		dirty = shadows = true;
	}

	/**
	 * A copy's own tree, copied from level L's build: its materials the renderer's (those the level wears), what the
	 * instanced drawings leave out left out here too (lines, points, lights), its controls set, and its shaders made
	 * before it shows (until then the copy is drawn at rest with the others).
	 */
	function treeOf(k, i, p, L) {
		const obj = k.levels[L].obj;
		p.tree?.removeFromParent();
		// copied without the build's own notes: its controls' numbers are many, and the copy plays the build's
		const notes = obj.userData;
		obj.userData = {};
		let copy;
		try {
			copy = SkeletonUtils.clone(obj);
		} finally {
			obj.userData = notes;
		}
		let tris = 0, calls = 0;
		copy.traverse((o) => {
			if (o.isMesh) {
				const many = Array.isArray(o.material);
				o.material = many ? o.material.map((m) => presets.of(m)) : presets.of(o.material);
				o.receiveShadow = k.receive;
				// a part whose shape its controls bend or spread is never culled by a ball that holds it at rest
				if (o.isInstancedMesh || o.isSkinnedMesh || o.morphTargetInfluences?.length) o.frustumCulled = false;
				const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
				tris += n * (o.isInstancedMesh ? o.count : 1);
				calls += many ? Math.max(1, g.groups.length) : 1;
			} else if (o.isLine || o.isPoints || o.isSprite || o.isLight) o.layers.disableAll();
		});
		// held where the copy stands: the build's own root keeps its own place, as in the level's drawings, and may move
		const tree = new THREE.Group();
		tree.add(copy);
		tree.matrixAutoUpdate = false;
		tree.visible = false;
		tree.name = `${k.label} · copy ${i}, moved`;
		Object.assign(p, { tree, L, tris, calls, ready: false, shown: false, poser: poserOf(copy, obj.userData.controls) });
		p.poser.setMany(p.values);
		group.add(tree);
		const scene = worldOf();
		compiling++;
		(scene ? renderer.compileAsync(tree, camera, scene) : Promise.resolve())
			.catch(() => {})
			.finally(() => {
				compiling--;
				if (p.tree !== tree) return;
				p.ready = true;
				dirty = shadows = true;
			});
	}

	/** copy i of kind k, moved by its controls, drawn as its own tree at the shape level L asks for; false: not yet */
	function drawPosed(k, i, p, L) {
		let T = Math.min(L, k.levels.length - 1);
		if (k.levels[T].state === 'idle') want(k, T);
		T = controlledNear(k, T);
		if (T < 0) return false;
		if (p.L !== T) treeOf(k, i, p, T);
		if (!p.ready) return false;
		p.tree.matrix.fromArray(k.M, i * 16);
		p.tree.matrixWorldNeedsUpdate = true;
		p.tree.visible = true;
		counted.posed++;
		counted.tris += p.tris;
		counted.calls += p.calls;
		return true;
	}

	/* ── each frame ── */
	/** the level every copy is drawn at, whatever its size (a film's, or a check's), or -1: each by its size */
	let forced = -1;
	const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), ball = new THREE.Sphere(), eye = new THREE.Vector3();
	const last = { world: new Float32Array(16), proj: new Float32Array(16) };
	const counted = { levels: [0, 0, 0], pictures: 0, posed: 0, tris: 0, calls: 0, culled: 0 };
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

	/** the level a ready level L is drawn as: itself, or the one it was made from when nothing was taken away */
	const as = (k, L) => (L >= 0 && L < k.levels.length && k.levels[L].as >= 0 && k.levels[L].state === 'ready' ? k.levels[L].as : L);

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
		const lv = k.levels[as(k, R)];
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
		counted.culled = counted.posed = counted.tris = counted.calls = 0;
		pictures.begin();
		for (const k of kinds.values()) {
			for (const lv of k.levels) for (const d of lv.meshes ?? []) d.used = 0;
			for (const p of k.posed.values()) if (p.tree) p.tree.visible = false;
			if (!k.ok) continue;
			const c = k.center;
			for (let i = 0; i < k.n; i++) {
				if (!k.alive[i]) continue;
				const M = k.M, o = i * 16;
				ball.center.set(M[o] * c.x + M[o + 4] * c.y + M[o + 8] * c.z + M[o + 12], M[o + 1] * c.x + M[o + 5] * c.y + M[o + 9] * c.z + M[o + 13], M[o + 2] * c.x + M[o + 6] * c.y + M[o + 10] * c.z + M[o + 14]);
				// moved by its controls, it may reach further than it does at rest (a machine drawn apart): twice as far
				ball.radius = k.radius * k.S[i] * (k.posed.size && k.posed.has(i) ? 2 : 1);
				if (!frustum.intersectsSphere(ball)) {
					counted.culled++;
					if (k.was[i] !== -1) (k.was[i] = -1), (shadows = true);
					continue;
				}
				const size = sizeOn(ball.radius, ball.center.distanceTo(eye), tanHalf);
				if (size < SMALLEST) {
					if (k.was[i] !== -1) (k.was[i] = -1), (shadows = true);
					continue;
				}
				const { level, fade } = forced >= 0 ? { level: Math.min(forced, k.levels.length), fade: 0 } : choose(size, k.thresholds, k.was[i]);
				if (level !== k.was[i]) shadows = true;
				k.was[i] = level;
				// moved by its controls: its own tree, once it is ready
				const p = k.posed.size ? k.posed.get(i) : undefined;
				if (p && drawPosed(k, i, p, level)) continue;
				const drawn = draw(k, i, level, 1);
				// the coarser one fading in under it, unless it already stands in whole, or is the same drawing
				if (fade > 0 && drawn !== level + 1 && as(k, drawn) !== as(k, level + 1)) draw(k, i, level + 1, fade);
			}
		}
		pictures.end();
		for (const k of kinds.values())
			for (const p of k.posed.values())
				if (p.tree && p.tree.visible !== p.shown) {
					p.shown = p.tree.visible;
					shadows = true;
				}
		let tris = counted.tris + pictures.drawn * 2, calls = counted.calls + (pictures.pages && pictures.drawn ? 1 : 0);
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
		// what casts a shadow changed: the shadows drawn again (a world whose sky draws them only when it must)
		if (shadows) {
			if (o.onShadows) o.onShadows();
			else renderer.shadowMap.needsUpdate = true;
		}
		shadows = false;
		return true;
	}

	/**
	 * Waits for every kind used so far to have its coarsest shape (or to have failed); `onKind` hears each one come.
	 * `every`: and each of its other levels too, asked for now (for a film, whose frames must never draw a shape while
	 * a finer one is still coming).
	 * @param {(done: number, of: number) => void} [onKind] @param {boolean} [every]
	 */
	async function ready(onKind, every = false) {
		const list = [...kinds.values()];
		let done = 0;
		await Promise.all(
			list.map((k) =>
				k.ready.then(async () => {
					if (every && k.ok) await Promise.all(k.levels.map((_, L) => want(k, L).catch(() => {})));
					onKind?.(++done, list.length);
				})
			)
		);
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
			posed: counted.posed,
			culled: counted.culled,
			tris: counted.tris,
			calls: counted.calls,
			materials: presets.size,
			pages: pictures.pages,
			building: queue.length + loads + compiling + lowering.busy,
			builds: list.reduce((a, k) => a + k.levels.filter((l) => l.state === 'ready' && l.from !== 'made').length, 0),
			/** the levels made by simplifying a build, and those of them it took nothing from */
			made: list.reduce((a, k) => a + k.levels.filter((l) => l.state === 'ready' && l.from === 'made').length, 0),
			same: list.reduce((a, k) => a + k.levels.filter((l) => l.state === 'ready' && l.as >= 0).length, 0)
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
		controlsOf,
		pose,
		poseOf,
		/** a copy's controls all back at rest */
		rest: (copy) => unpose(copy.kind, copy.i),
		/** whether a copy is moved from its rest by its controls */
		posed: (copy) => copy.kind.posed.has(copy.i),
		/** every kind used, with its levels */
		kinds: () => [...kinds.values()],
		/** cuts everything open along a plane (what is on its negative side taken away), or closes it (null) */
		cut(/** @type {THREE.Plane | null} */ plane) {
			presets.cut(plane);
			pictures.cut(plane);
			dirty = shadows = true;
		},
		/** asks again, the next frame, what to draw (after something changed that the renderer cannot see) */
		touch: () => (dirty = true),
		/**
		 * A kind's levels drawn down to these sizes on screen (one for each of its shapes, finest first; smaller than the
		 * last, its picture): a world that changes a kind's detail where it always has, not where its shape would. Null:
		 * by its shape again.
		 * @param {any} k @param {number[] | null} thresholds
		 */
		tune(k, thresholds) {
			k.tuned = !!thresholds;
			if (thresholds) k.thresholds = thresholds.slice();
			else if (k.ok) retune(k);
			dirty = shadows = true;
		},
		/**
		 * Draws every copy at level L whatever its size (0 its finest shape, as a film wants; past its shapes, its
		 * picture), or each at the level its size calls for again (null).
		 * @param {number | null} L
		 */
		force(L) {
			forced = L === null || L === undefined ? -1 : Math.max(0, Math.floor(L));
			dirty = shadows = true;
		},
		dispose() {
			gone = true;
			group.removeFromParent();
			for (const k of kinds.values())
				for (const lv of k.levels)
					for (const d of lv.meshes ?? []) {
						d.mesh.geometry.dispose();
						d.mesh.dispose();
					}
			for (const k of kinds.values()) for (const lv of k.levels) for (const d of lv.level?.draws ?? []) d.geometry.dispose();
			for (const k of kinds.values()) for (const lv of k.levels) lv.obj?.traverse((o) => o.geometry?.dispose());
			lowering.dispose();
			pictures.dispose();
			presets.dispose();
			for (const p of pool) p.box.stop('the renderer was disposed');
			queue.length = 0;
			kinds.clear();
		}
	};
}
