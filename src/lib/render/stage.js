/**
 * THE STAGE RENDERER — the canvas an asset is looked at on (every asset viewer, an asset's own page, the Biomes, the
 * box's lab, a plant's card): the purpose renderer for viewers on the core (./core.js). A renderer in the viewer's
 * box (or on its canvas), a camera, the orbit controls that turn round the asset, the canvas kept to the box's size,
 * and on a viewer that asks for it a resolution that follows the frame rate. What the asset stands in (the paper
 * studio and its post stack, ../assets/stage.js; a viewer's own lights) is the viewer's.
 */
import * as THREE from 'three';
import { adaptiveResolution, createControls, createRenderer, disposeRenderer, fitTo } from './core.js';

/**
 * @typedef {object} StageRenderer
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.PerspectiveCamera} camera
 * @property {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
 * @property {() => void} resize fit the canvas to its box now (the viewer calls it once it is set up; the box's
 *   changes of size call it after)
 * @property {() => void} dispose let go of the controls, the renderer and its canvas
 */

/**
 * @param {HTMLElement} box what the canvas fills
 * @param {import('./core.js').RendererOptions & {
 *   fov?: number, near?: number, far?: number, turntable?: boolean,
 *   controls?: Parameters<typeof createControls>[2],
 *   fit?: (camera: THREE.PerspectiveCamera, w: number, h: number) => void, style?: boolean, onResize?: (w: number, h: number) => void
 * }} [o]
 *   canvas: the viewer's own canvas (else one is made in `box`); turntable: the camera's field of view kept as the
 *   viewer's (`camera.userData.fov`, widened on an upright canvas by `fit`); style: the canvas's CSS size set too
 * @returns {StageRenderer}
 */
export function createStageRenderer(box, o = {}) {
	const { fov = 40, near = 0.01, far = 200, turntable = false, controls: set, fit, style = true, onResize, ...gl } = o;
	const renderer = createRenderer({ ...gl, container: gl.canvas ? undefined : box });
	const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
	if (turntable) camera.userData.fov = fov;
	const controls = createControls(camera, renderer.domElement, set);
	const size = fitTo(renderer, box, { camera, fit, style, onResize, now: false });
	return {
		renderer,
		camera,
		controls,
		resize: size.fit,
		dispose() {
			size.dispose();
			controls.dispose();
			// a canvas of the viewer's own stays its own
			if (gl.canvas) renderer.dispose();
			else disposeRenderer(renderer);
		}
	};
}

export { adaptiveResolution };
