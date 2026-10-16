/**
 * THE PREVIEW RENDERER — a picture of a scene, one frame on demand, small and on a low-power GPU, never on the page:
 * the purpose renderer for pictures (a thumbnail, a before and after, a review card's look at a proposed asset) on the
 * core (./core.js). One renderer for the whole page, made at the first picture and kept, so a page of thumbnails
 * holds one graphics context, not one each.
 *
 * Pictures of an asset far away drawn inside a world (../assets/render/impostors.js) are taken on that world's own
 * renderer instead: a texture belongs to the context it was made in.
 */
import * as THREE from 'three';
import { createRenderer } from './core.js';

/** @type {THREE.WebGLRenderer | null} */
let shared = null;

/**
 * One picture of `scene` from `camera`, `width` × `height` px, as a PNG.
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{ width?: number, height?: number, toneMapping?: import('./core.js').RendererOptions['toneMapping'], exposure?: number }} [o]
 * @returns {Promise<Blob>}
 */
export async function picture(scene, camera, { width = 256, height = 256, toneMapping = 'aces', exposure = 1 } = {}) {
	shared ??= createRenderer({ alpha: true, power: 'low-power', preserve: true, pixelRatio: 1 });
	const r = shared;
	r.toneMapping = toneMapping === 'none' ? THREE.NoToneMapping : toneMapping === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
	r.toneMappingExposure = exposure;
	r.setSize(width, height, false);
	if (/** @type {THREE.PerspectiveCamera} */ (camera).isPerspectiveCamera) {
		const cam = /** @type {THREE.PerspectiveCamera} */ (camera);
		cam.aspect = width / height;
		cam.updateProjectionMatrix();
	}
	await r.compileAsync(scene, camera).catch(() => {});
	r.render(scene, camera);
	return new Promise((ok, fail) => r.domElement.toBlob((b) => (b ? ok(b) : fail(new Error('no picture'))), 'image/png'));
}

/** Let go of the page's preview renderer (a page with no more pictures to take). */
export function disposePreview() {
	shared?.dispose();
	shared = null;
}
