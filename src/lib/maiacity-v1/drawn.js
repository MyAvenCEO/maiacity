// @ts-nocheck — plain JS, kept loose on purpose
/*
 * WHAT MAIACITY V1 DRAWS OF THE LIBRARY — every asset by its ref (./things.js), built in the asset box (or read from
 * this device's cache) and never by calling a builder, put in the world one of two ways:
 *
 * - `follow`: drawn by the universal renderer ($lib/assets/render), one copy standing wherever an anchor of the world's
 *   stands (a plain group the story moves, parents and hides as it moved the builder's object), at its finest shape
 *   only (a world this small always drew all of it: no coarser shapes and no pictures are made), casting its shadow. A box the size of the copy in the anchor, unseen,
 *   carries the name a tap finds it by.
 *   What the story moves part by part (a tailgate let down, a door opened) is moved by its controls (`pose`): the
 *   renderer draws that copy as its own tree, its parts where the numbers the box wrote down put them
 *   ($lib/assets/controls.js), and with the others again once every control is back at rest.
 * - `load`: the build itself, as the box made it (its nodes, its materials, its controls as numbers), put into an
 *   anchor; `cast`: that, kept running in the box ($lib/assets/hero.js, $lib/assets/box/live.js) for what moves by
 *   itself (a machine's clip: the ElectroCube humming), each frame's step asked of the box and followed here.
 *
 * Every build goes through the renderer's few boxes, in one line (the people, the tent and the pickup alike), the most
 * wanted first: what stands in the camera's view, then what is shown elsewhere, then what is hidden; asked again each
 * time a box is free, so a cut to another place moves its builds up. The same build asked for twice (each player's
 * backpack) is built once.
 *
 * `update` before each frame is drawn; `ready` waits for everything asked for so far, `inView` for what stands in the
 * camera's view as it is drawn next. The renderer and the box come in with the first world made (the page's own
 * modules, not the world's: the world's measures are read without them).
 */
import * as THREE from 'three';

/** a copy put away: drawn nowhere */
const AWAY = new THREE.Matrix4().makeScale(0, 0, 0);
/** what a tap finds a copy by: never drawn */
const PICK = new THREE.MeshBasicMaterial({ visible: false });
/** how far round where an anchor stands what goes into it may reach (m): it is in view if that ball is, and as large
 *  on screen as that ball; and how large it must be to be seen there (px, its radius) */
const REACH = 8;
const SEEN = 6;
/** how many boxes build side by side: one for each core the page leaves, two to four */
const boxes = () => Math.max(2, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1));

let mods = null;
const modules = () =>
	(mods ??= Promise.all([import('$lib/assets/render/index.js'), import('$lib/assets/load.js'), import('$lib/assets/recipes.js'), import('$lib/assets/hero.js'), import('$lib/assets/controls.js'), import('$lib/assets/clips.js')]).then(([r, l, x, h, c, k]) => ({
		createAssets: r.createAssets,
		loadAsset: l.loadAsset,
		canonical: l.canonical,
		liveBoxOf: l.liveBoxOf,
		buildAt: x.buildAt,
		recipeAt: x.recipeAt,
		heroOf: h.heroOf,
		runner: h.runner,
		poserOf: c.poserOf,
		playerOf: k.playerOf,
		bonePoser: k.poser
	})));
// in a page, fetched as soon as the world's code is: the box is asked for the first builds before the world's first
// frame (its shaders compiled, seconds on a slow machine) holds the page up
if (typeof window !== 'undefined' && window.document?.createElement) modules().catch(() => {});

/**
 * @param {{ renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, scene: THREE.Scene }} o
 */
export function createDrawn({ renderer, camera, scene }) {
	let assets = null;
	let gone = false;
	/** what was asked for before the renderer was there */
	const waiting = [];
	const up = modules().then((m) => {
		if (gone) return m;
		// one shape a kind, its finest, and no picture: nothing made smaller for far off
		assets = m.createAssets({ renderer, camera, levels: [1], boxes: boxes() });
		assets.force(0);
		scene.add(assets.group);
		for (const go of waiting.splice(0)) go();
		return m;
	});
	/** @type {{ copy: any, anchor: THREE.Object3D, m: THREE.Matrix4 }[]} */
	const copies = [];
	/** @type {Promise<any>[]} */
	const loads = [];
	/** the builds kept running in the box (`cast`) */
	const heroes = [];
	/** everything asked for: where it goes, and when it is there (or failed) */
	/** @type {{ anchor: THREE.Object3D, done: Promise<unknown> }[]} */
	const asks = [];
	/** whether an anchor is in the scene and shown, and everything it is in */
	const shown = (o) => {
		for (let x = o; x; x = x.parent) {
			if (!x.visible) return false;
			if (x === scene) return true;
		}
		return false;
	};
	/** the camera's view as the last frame was drawn: where it is, what it takes in, and how many pixels a metre at a
	 *  metre's distance covers */
	const frustum = new THREE.Frustum(), _vp = new THREE.Matrix4(), _ball = new THREE.Sphere(), _eye = new THREE.Vector3();
	let perMetre = 1;
	const look = () => {
		camera.updateMatrixWorld();
		frustum.setFromProjectionMatrix(_vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
		_eye.setFromMatrixPosition(camera.matrixWorld);
		perMetre = (renderer.domElement.clientHeight || 720) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
	};
	/** how large what goes into an anchor stands on screen (px, its radius), 0 where it is hidden or out of the view
	 *  (past the fog's end too) */
	const onScreen = (o) => {
		if (!shown(o)) return 0;
		o.getWorldPosition(_ball.center);
		_ball.radius = REACH;
		if (!frustum.intersectsSphere(_ball)) return 0;
		const d = _ball.center.distanceTo(_eye);
		if (scene.fog?.far && d - REACH > scene.fog.far) return 0;
		return (REACH * perMetre) / Math.max(d, REACH);
	};
	/** whether an anchor is shown and stands in the camera's view, large enough to be seen */
	const inView = (o) => onScreen(o) >= SEEN;
	/** how much what goes into an anchor is wanted: in view 2 and more the larger it stands there, shown elsewhere 1,
	 *  hidden 0 */
	const rankOf = (o) => {
		const px = onScreen(o);
		return px >= SEEN ? 2 + Math.min(1, px / 400) : shown(o) ? 1 : 0;
	};
	/** the frames waited for (`inView`): told when the next one is drawn */
	const frames = [];
	/** an unseen box over what was built, named for a tap, in the anchor */
	const pickBox = (anchor, box, name) => {
		if (!box || box.isEmpty()) return;
		const m = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray()), PICK);
		box.getCenter(m.position);
		m.name = name;
		m.castShadow = m.receiveShadow = false;
		anchor.add(m);
	};
	return {
		/**
		 * A copy of `ref` drawn by the renderer wherever `anchor` is, hidden with it.
		 * @param {string} ref @param {THREE.Object3D} anchor @param {{ pick?: string, receive?: boolean }} [o] `pick`: the
		 *   name a tap finds it by; `receive`: whether a shadow falls on it (as its builder has it: none by default)
		 * @returns {{ ready: Promise<THREE.Box3 | null> }} `ready`: the box round it as built, once it is there (null if it
		 *   did not come)
		 */
		follow(ref, anchor, { pick, receive = false } = {}) {
			let built;
			const c = { copy: null, anchor, m: AWAY.clone(), gone: false, on: false, values: new Map(), ready: new Promise((ok) => (built = ok)) };
			copies.push(c);
			const go = () => {
				if (c.gone) return built(null);
				const kind = assets.use(ref, { shadows: true, picture: false, receive });
				// wanted as much as the most wanted of the copies it is asked for by
				(kind.anchors ??= new Set()).add(anchor);
				kind.rank ??= () => Math.max(0, ...[...kind.anchors].map(rankOf));
				c.copy = assets.place(kind, AWAY);
				kind.ready.then((k) => {
					const box = k.ok ? (k.levels[k.base].level?.box ?? null) : null;
					if (pick && !c.gone) pickBox(anchor, box, pick);
					// its controls as the story set them before it was here
					c.on = k.ok && !c.gone;
					if (c.on) for (const [id, v] of c.values) assets.pose(c.copy, id, v);
					built(box);
				});
			};
			if (assets) go();
			else waiting.push(go);
			c.ask = { anchor, done: c.ready };
			asks.push(c.ask);
			return c;
		},
		/**
		 * A control of a copy `follow` put down set to `v` (a tailgate's `tailgate`, a door's `door.<name>`: 0 … 1), kept
		 * until its kind is here if it is not yet.
		 * @param {any} c @param {string} id @param {number} v
		 */
		pose(c, id, v) {
			if (c.values.get(id) === v) return;
			c.values.set(id, v);
			if (c.on && !c.gone) assets.pose(c.copy, id, v);
		},
		/** a copy `follow` put down, taken away again @param {any} c */
		drop(c) {
			c.gone = true;
			const i = copies.indexOf(c);
			if (i >= 0) copies.splice(i, 1);
			const j = asks.indexOf(c.ask);
			if (j >= 0) asks.splice(j, 1);
			if (c.copy) assets.remove(c.copy);
		},
		/**
		 * The build of `ref` (with its values, if any) put into `anchor` as the box made it: `{ obj, card, data, named,
		 * poser }` ($lib/assets/load.js; `named`: its first node of each name, as its builder named them; `poser`: its
		 * controls, played from the numbers the box wrote down: $lib/assets/controls.js), once it is there.
		 * @param {string} ref @param {THREE.Object3D} anchor @param {{ pick?: string, cast?: boolean }} [o]
		 *   `pick`: every part of it named so (its bones keep their names); `cast`: every part casting a shadow (false: as
		 *   built)
		 */
		load(ref, anchor, { pick, cast = true } = {}) {
			let mods;
			const p = up
				.then((m) => {
					mods = m;
					if (gone) throw new Error('the world is gone');
					return assets.load(m.buildAt(ref), { rank: () => rankOf(anchor) });
				})
				.then((got) => {
					// its controls played on it (./controls.js), its nodes walked before the world adds any of its own
					got.poser = mods.poserOf(got.obj);
					got.named = new Map();
					got.obj.traverse((c) => {
						if (c.name && !got.named.has(c.name)) got.named.set(c.name, c);
						if (pick && !c.isBone) c.name = pick; // (its bones keep theirs: a pose names them)
						if (cast && c.isMesh) c.castShadow = true;
					});
					if (!gone) anchor.add(got.obj);
					return got;
				});
			const done = p.catch((e) => console.warn(`maiacity-v1: ${ref} did not load: ${e?.message ?? e}`));
			loads.push(done);
			asks.push({ anchor, done });
			return p;
		},
		/**
		 * The build of `ref` put into `anchor` (as `load`) and kept running in the box: what the stage calls a hero
		 * ($lib/assets/hero.js `heroOf`): `play(clip)`, `hold(pose)`, and `tick(dt)` each frame it moves. Until the box
		 * has it running, it stands as built.
		 * @param {string} ref @param {THREE.Object3D} anchor @param {{ pick?: string, cast?: boolean }} [o]
		 * @param {(got: any) => void} [then] what is done with the build once it is ready to run (its parts found by
		 *   name; anything the world hangs on it is added only now, so its nodes stay the box's, one for one)
		 */
		cast(ref, anchor, o, then) {
			return this.load(ref, anchor, o).then(async (got) => {
				const m = await up;
				const c = m.canonical(m.buildAt(ref));
				const values = c.values && Object.fromEntries(Object.entries(c.values).map(([k, v]) => [k, String(v)]));
				const code = await m.recipeAt(c.hash).catch(() => null);
				// its nodes walked here, each the box's of the same place in its tree: before anything is added to it
				const hero = m.heroOf(got, { start: code && !gone ? m.runner(m.liveBoxOf(), code, values) : undefined });
				then?.(got);
				if (gone) hero.dispose();
				else heroes.push(hero);
				return hero;
			});
		},
		/**
		 * A rigged actor of `ref` (a person: the stand-in, with their height and look) put into `anchor` as the box built
		 * it, moved as its builder's cast was, by our own code: `rig.bones` by name and `rig.pose(p)` its bones set to a
		 * pose ($lib/assets/clips.js `poser`); `clips` by name, (t) → pose, played from the tables the box wrote down
		 * (`playerOf`), each named in `cycles` played within one round of it (s); `poses` its poses as data (its view's
		 * held ones); `face` the skinned mesh its blend shapes are on (`joy`, `friendly`). `ready` once it is here (a pose
		 * asked for before is set then); `loaded` settles then.
		 * @param {string} ref @param {THREE.Object3D} anchor
		 * @param {{ pick?: string, shadow?: boolean, receive?: boolean, cycles?: Record<string, number> }} [o] `pick`: the
		 *   name a tap finds it by; `shadow`: whether it casts one; `receive`: whether one falls on it
		 * @param {(cast: any) => void} [then] what is done once it is here, its bones still as built (anything hung on one)
		 */
		actor(ref, anchor, { pick, shadow = true, receive = false, cycles = {} } = {}, then) {
			let asked = null;
			const cast = { ready: false, rig: { object: anchor, bones: {}, pose: (p) => void (asked = p) }, clips: {}, poses: {}, mesh: null, face: null, loaded: null };
			cast.loaded = this.load(ref, anchor, { pick, cast: shadow }).then(async (got) => {
				const m = await up;
				const view = got.obj.userData.view?.clips;
				let mesh = null;
				got.obj.traverse((o) => (mesh ??= o.isSkinnedMesh ? o : null));
				if (!mesh || !view?.motion) throw new Error(`${ref}: no rig or no clips`);
				mesh.castShadow = shadow;
				mesh.receiveShadow = receive;
				mesh.frustumCulled = false;
				const bones = mesh.skeleton.bones;
				for (const [name, clip] of Object.entries(m.playerOf(view.motion, view.bones ?? []))) {
					const c = cycles[name];
					cast.clips[name] = c > 0 ? (t, mo) => clip(((t % c) + c) % c, mo) : clip;
				}
				Object.assign(cast.poses, view.held ?? {});
				Object.assign(cast.rig.bones, Object.fromEntries(bones.map((b) => [b.name, b])));
				cast.mesh = mesh;
				cast.face = mesh.morphTargetDictionary ? mesh : null;
				const pose = m.bonePoser(bones);
				then?.(cast);
				cast.rig.pose = pose;
				cast.ready = true;
				if (asked) pose(asked);
				return cast;
			});
			// (one that did not come stands as nothing)
			loads.push(cast.loaded.catch((e) => console.warn(`maiacity-v1: ${ref} is not moved: ${e?.message ?? e}`)));
			return cast;
		},
		/** where each copy stands now: before every frame */
		update() {
			look();
			if (frames.length) for (const ok of frames.splice(0)) ok();
			if (!assets) return;
			for (const c of copies) {
				if (!c.copy) continue;
				const on = shown(c.anchor);
				if (on) c.anchor.updateWorldMatrix(true, false);
				const m = on ? c.anchor.matrixWorld : AWAY;
				if (c.m.equals(m)) continue;
				c.m.copy(m);
				assets.move(c.copy, m);
			}
			assets.update();
		},
		/** everything asked for so far, there to draw (or failed) */
		ready: () => up.then(() => Promise.all([assets?.ready(), ...loads])).then(() => true),
		/** everything asked for that stands in the camera's view as the next frame is drawn, there to draw (or failed):
		 *  what the shot on screen shows, while the rest may still be coming */
		inView: () =>
			up
				.then(() => new Promise((ok) => frames.push(ok)))
				.then(() => Promise.all(asks.filter((a) => inView(a.anchor)).map((a) => a.done)))
				.then(() => true),
		stats: () => assets?.stats() ?? null,
		dispose() {
			gone = true;
			for (const h of heroes.splice(0)) h.dispose();
			assets?.dispose();
			for (const ok of frames.splice(0)) ok();
		}
	};
}
