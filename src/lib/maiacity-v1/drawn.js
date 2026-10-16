// @ts-nocheck — plain JS, kept loose on purpose
/*
 * WHAT MAIACITY V1 DRAWS OF THE LIBRARY — every asset by its ref (./things.js), built in the asset box (or read from
 * this device's cache) and never by calling a builder, put in the world one of two ways:
 *
 * - `follow`: drawn by the universal renderer ($lib/assets/render), one copy standing wherever an anchor of the world's
 *   stands (a plain group the story moves, parents and hides as it moved the builder's object), at its finest shape
 *   only (a world this small always drew all of it: no coarser shapes and no pictures are made), casting its shadow. A box the size of the copy in the anchor, unseen,
 *   carries the name a tap finds it by.
 * - `load`: the build itself, as the box made it (its nodes, its materials, its controls as numbers:
 *   $lib/assets/controls.js), put into an anchor, for what the story moves part by part (a door, a tailgate, a tent
 *   pitched) or touches (a flame, a canvas glowing).
 *
 * `update` before each frame is drawn; `ready` waits for everything asked for so far. The renderer and the box come in
 * with the first world made (the page's own modules, not the world's: the world's measures are read without them).
 */
import * as THREE from 'three';

/** a copy put away: drawn nowhere */
const AWAY = new THREE.Matrix4().makeScale(0, 0, 0);
/** what a tap finds a copy by: never drawn */
const PICK = new THREE.MeshBasicMaterial({ visible: false });

let mods = null;
const modules = () =>
	(mods ??= Promise.all([import('$lib/assets/render/index.js'), import('$lib/assets/load.js'), import('$lib/assets/recipes.js')]).then(([r, l, x]) => ({
		createAssets: r.createAssets,
		loadAsset: l.loadAsset,
		buildAt: x.buildAt
	})));

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
		assets = m.createAssets({ renderer, camera, levels: [1] });
		assets.force(0);
		scene.add(assets.group);
		for (const go of waiting.splice(0)) go();
		return m;
	});
	/** @type {{ copy: any, anchor: THREE.Object3D, m: THREE.Matrix4 }[]} */
	const copies = [];
	/** @type {Promise<any>[]} */
	const loads = [];
	/** whether an anchor is in the scene and shown, and everything it is in */
	const shown = (o) => {
		for (let x = o; x; x = x.parent) {
			if (!x.visible) return false;
			if (x === scene) return true;
		}
		return false;
	};
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
		 * @param {string} ref @param {THREE.Object3D} anchor @param {{ pick?: string }} [o] `pick`: the name a tap finds it by
		 */
		follow(ref, anchor, { pick } = {}) {
			const c = { copy: null, anchor, m: AWAY.clone() };
			copies.push(c);
			const go = () => {
				const kind = assets.use(ref, { shadows: true, picture: false });
				c.copy = assets.place(kind, AWAY);
				if (pick) kind.ready.then((k) => pickBox(anchor, k.ok ? k.levels[k.base].level?.box : null, pick));
			};
			if (assets) go();
			else waiting.push(go);
			return c;
		},
		/**
		 * The build of `ref` (with its values, if any) put into `anchor` as the box made it: `{ obj, card, data }`
		 * ($lib/assets/load.js), once it is there.
		 * @param {string} ref @param {THREE.Object3D} anchor @param {{ pick?: string }} [o] `pick`: every part of it named so
		 */
		load(ref, anchor, { pick } = {}) {
			const p = up
				.then((m) => m.loadAsset(m.buildAt(ref)))
				.then((got) => {
					got.obj.traverse((c) => {
						if (pick) c.name = pick;
						if (c.isMesh) c.castShadow = true;
					});
					if (!gone) anchor.add(got.obj);
					return got;
				});
			loads.push(p.catch((e) => console.warn(`maiacity-v1: ${ref} did not load: ${e?.message ?? e}`)));
			return p;
		},
		/** where each copy stands now: before every frame */
		update() {
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
		stats: () => assets?.stats() ?? null,
		dispose() {
			gone = true;
			assets?.dispose();
		}
	};
}
