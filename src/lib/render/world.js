/**
 * THE WORLD RENDERER — the canvas, the scene and the camera every world is drawn with (the sandboxes, Sandbox 1 and 2's
 * islands, MaiaCity V1, the Factories, the tired land): the purpose renderer for worlds on the core (./core.js).
 *
 * Taken out of Sandbox 4 as the sandbox kit's stage: a renderer set up for the sky ($lib/sandbox-kit/sky.js) — ACES
 * tone mapping and soft shadows — a perspective camera at a walker's field of view, both kept to the size of their
 * container, and a resolution that eases down a little when frames get slow and back up when there is room, so a
 * world stays smooth on a slow phone. A world that sizes its own canvas (an island's) takes only the renderer
 * (`createWorldRenderer`'s `renderer` alone, ./core.js `createRenderer` with the world's settings).
 */
import * as THREE from 'three';
import { createRenderer, disposeObject, disposeRenderer, fitTo, placeSeenOnly } from './core.js';

/**
 * @typedef {object} StageHandle
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {(now?: number, hold?: boolean) => void} adapt call once a frame: the resolution follows the frame rate
 *   (`hold` keeps it as it is, as while a film is shot at the resolution it asks for)
 * @property {() => void} dispose let go of the canvas and everything in the scene
 */

/**
 * A world's renderer alone, on its own canvas, with the world's settings unless told otherwise: antialiased, ACES,
 * shadows, at most 1.25 pixels per CSS pixel. For a world that sizes and draws its canvas itself.
 * @param {import('./core.js').RendererOptions} [o]
 */
export function worldRenderer(o = {}) {
	return createRenderer({ maxPixelRatio: 1.25, toneMapping: 'aces', shadows: 'soft', ...o });
}

/**
 * The kit's stage: a world's renderer, scene and camera in a container, kept to its size, its resolution following
 * the frame rate.
 * @param {HTMLElement} container
 * @param {{ fov?: number, near?: number, far?: number, maxPixelRatio?: number }} [options]
 * @returns {StageHandle}
 */
export function createWorldRenderer(container, options = {}) {
	const { fov = 68, near = 0.1, far = 2400, maxPixelRatio = 1.25 } = options;
	const top = () => Math.min(maxPixelRatio, window.devicePixelRatio);
	const renderer = createRenderer({ pixelRatio: top(), toneMapping: 'aces', exposure: 0.42, shadows: 'soft' });
	renderer.setSize(container.clientWidth, container.clientHeight);
	container.appendChild(renderer.domElement);
	const scene = new THREE.Scene();
	// each frame only what is seen is placed (most of a world is hidden: domes away, the plants' far tiles)
	placeSeenOnly(scene);
	const camera = new THREE.PerspectiveCamera(fov, container.clientWidth / container.clientHeight, near, far);
	// a phone turned on its side, or its browser's bars coming and going, can settle the container's size only after
	// the window's resize: follow the container too, so the world always fills the screen
	const size = fitTo(renderer, container, { camera, window: true, now: false });

	let frames = 0, since = performance.now();
	return {
		renderer,
		scene,
		camera,
		adapt(now = performance.now(), hold = false) {
			// keep it smooth: lower the resolution a little when frames get slow, raise it when there is room
			frames++;
			if (hold) return void ((frames = 0), (since = now));
			if (now - since <= 1500) return;
			const fps = (frames * 1000) / (now - since);
			const pr = renderer.getPixelRatio();
			if (fps < 40 && pr > 1) renderer.setPixelRatio(Math.max(1, pr - 0.1));
			else if (fps > 56 && pr < top()) renderer.setPixelRatio(Math.min(top(), pr + 0.1));
			frames = 0;
			since = now;
		},
		dispose() {
			size.dispose();
			// the scene's shapes; its materials are shared by what may stay (the kit's, a library's)
			disposeObject(scene, { materials: false });
			disposeRenderer(renderer);
		}
	};
}
