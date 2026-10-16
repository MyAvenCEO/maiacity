// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * A WORLD'S ASSETS — how a world (the tired land; src/lib/worlds) puts the library's assets in: by their ref
 * (`machines/truck@1?box=%23e0ddd6&cab=%23a33a2a`), built in the asset box (or read from this device's cache) and drawn
 * by the universal renderer ($lib/assets/render), never by calling a builder. The world's own geometry (its ground,
 * its fields, its road) stays the world's.
 *
 * Each frame `update` before the scene is drawn; while a film draws, every copy at its finest (`force(0)`), so a shot
 * renders the same every time.
 */
import { createAssets } from '$lib/assets/render/index.js';
import { queryOf } from '$lib/assets/params.js';
import { filmDraws } from '$lib/sandbox-kit';

/**
 * A ref with the values it is built with, written as every ref writes them (sorted, a colour's # escaped):
 * `withValues('machines/truck@1', { cab: '#a33a2a', box: '#e0ddd6' })`. Each value exactly as given, so the build is the
 * one its builder called with them made.
 * @param {string} ref @param {Record<string, number | string>} values
 */
export const withValues = (ref, values) => {
	const q = queryOf(values);
	return q ? `${ref}?${q}` : ref;
};

/**
 * A world's renderer of assets, in its scene.
 * @param {{ renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, scene: THREE.Scene }} o
 */
export function worldAssets({ renderer, camera, scene }) {
	const assets = createAssets({ renderer, camera });
	scene.add(assets.group);
	let forced = false;

	return {
		assets,
		group: assets.group,
		/** a kind: an asset at its version and values */
		use: (ref) => assets.use(ref),
		/** a copy put down at x, z (on a floor y high), turned about the upright */
		put: (ref, x, z, turn = 0, y = 0) => assets.place(ref, { x, y, z, turn }),
		/** a copy put down by a whole matrix: anywhere, turned any way, sized any way */
		at: (ref, matrix) => assets.place(ref, matrix),
		/** a copy moved: { x, y, z, turn } or a matrix */
		move: (copy, at) => assets.move(copy, at),
		/** waits for every kind used so far; `onKind` hears each come */
		ready: (onKind) => assets.ready(onKind),
		/** before each frame is drawn */
		update() {
			const film = filmDraws();
			if (film !== forced) {
				forced = film;
				assets.force(film ? 0 : null);
			}
			assets.update();
		},
		stats: () => assets.stats(),
		dispose: () => assets.dispose()
	};
}
