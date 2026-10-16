/*
 * DRAWN BY THE RENDERER — what a sandbox draws of the asset library: a universal renderer ($lib/assets/render) in a
 * world's scene, every asset in it built in the asset box and drawn there as copies of its kind, and its copies kept
 * when a part of the world lets them go (a tile of floor walked away from, a dome's inside let go of), for the next
 * that wants one of that kind: a world that comes and goes as you walk adds none.
 *
 * What the world decides: where each copy stands. What the renderer decides: how each is drawn (its level, frame by
 * frame; nothing behind the eye), and that the shadows are drawn again when what casts them changed (`shadows`: or
 * the world is told, when it draws them only every so often).
 *
 * `createDrawn` for the library's Things and the biomes' cover, each copy at its finest shape however small (`force`,
 * as the sandboxes always drew what they baked); `createFlora` for a forest of our plants (./flora.js), each kind's
 * detail changing at the world's own distances.
 */
import * as THREE from 'three';
import { createAssets } from '$lib/assets/render/index.js';
import { DETAILS, VILLAGE } from './flora.js';

/** a copy put away: drawn nowhere until it is wanted again */
export const AWAY = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * A renderer of assets in `scene`, its copies kept for the next that wants one.
 * @param {{
 *   renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, scene: THREE.Object3D, boxes?: number,
 *   details?: number[], levels?: number[], force?: number, shadows?: () => void
 * }} o `boxes` how many build side by side; `details`, `levels` as the renderer's; `force`: every copy drawn at that
 *   level (0: as it was built); `shadows`: told when what casts a shadow changed, instead of the shadows drawn again
 */
export function createDrawn(o) {
	const assets = createAssets({ renderer: o.renderer, camera: o.camera, boxes: o.boxes, details: o.details, levels: o.levels, onShadows: o.shadows });
	if (o.force !== undefined) assets.force(o.force);
	o.scene.add(assets.group);
	/** @type {Map<string, any[]>} the copies put away, by kind */
	const free = new Map();
	return {
		assets,
		/**
		 * A kind: its shadows cast at every level (true), at none (false), or as the renderer casts them; and its picture
		 * taken, for far off (unless `picture` is false: a kind never drawn so small).
		 * @param {string} ref @param {boolean} [shadows] @param {boolean} [picture]
		 */
		use: (ref, shadows, picture) => assets.use(ref, { shadows, picture }),
		/**
		 * a copy of kind k standing at `at` (a place or a whole matrix): one put away if there is one
		 * @param {any} k @param {{ x: number, y: number, z: number, turn: number, scale: number } | THREE.Matrix4} at
		 */
		take(k, at) {
			const c = free.get(k.key)?.pop();
			if (!c) return assets.place(k, at);
			assets.move(c, at);
			return c;
		},
		/** a copy moved @param {{ kind: any, i: number }} c @param {{ x: number, y: number, z: number, turn: number, scale: number } | THREE.Matrix4} at */
		move: (c, at) => assets.move(c, at),
		/** a copy put away @param {{ kind: any, i: number }} c */
		give(c) {
			assets.move(c, AWAY);
			let list = free.get(c.kind.key);
			if (!list) free.set(c.kind.key, (list = []));
			list.push(c);
		},
		/** draws what the camera sees: before every frame */
		update: () => assets.update(),
		/** waits for every kind asked for so far to be ready to draw (or to have failed) */
		ready: () => assets.ready(),
		/** nothing is being built for it (its kinds, their finer shapes, their pictures) */
		settled: () => assets.stats().building === 0,
		dispose: () => assets.dispose()
	};
}
/** @typedef {ReturnType<typeof createDrawn>} Drawn */

/** tan of half the camera's view, up and down @param {THREE.PerspectiveCamera} camera */
const tanOf = (camera) => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (camera.zoom || 1);

/**
 * The renderer a world's plants are drawn by (./flora.js), at its distances (`reach`: the village's, or nearer under a
 * dome's glass). Its boxes as many as the workers Sandbox 4 always grew its forest in.
 * @param {{ renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, scene: THREE.Object3D, reach?: import('./flora.js').Reaches, boxes?: number, shadows?: () => void }} o
 * @returns {import('./flora.js').FloraDrawn & ReturnType<typeof createDrawn>}
 */
export function createFlora(o) {
	const reach = o.reach ?? VILLAGE;
	const boxes = o.boxes ?? Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency || 4) - 1));
	// what a level may cost is read off these (a tree 12 m round its middle, fine to 16 m and coarse to 40 m): no plant's
	// shape at either detail is over its ceiling, so each is drawn as its recipe made it
	const levels = VILLAGE.tree.map((d) => 6 / (d * tanOf(o.camera)));
	const drawn = createDrawn({ renderer: o.renderer, camera: o.camera, scene: o.scene, boxes, details: DETAILS, levels, shadows: o.shadows });
	return {
		...drawn,
		reach,
		/**
		 * A kind, its detail changing at the distances of its reach: its finer shape to the first, its coarser to the
		 * second, and a tree's picture beyond; a shrub or a small plant is left out past the second (`Forest.update`), so
		 * it never comes to a picture.
		 * @param {any} k a kind of the renderer's, its coarsest shape here @param {import('./flora.js').Reach} r
		 */
		tune(k, r) {
			const [fine, coarse] = reach[r], t = tanOf(o.camera);
			drawn.assets.tune(k, [k.radius / (fine * t), (k.radius / (coarse * t)) * (r === 'tree' ? 1 : 0.5)]);
		}
	};
}
