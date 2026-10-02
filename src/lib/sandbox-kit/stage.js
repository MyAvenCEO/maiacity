/**
 * THE STAGE OF A SANDBOX — the canvas, the scene and the camera every world is drawn with.
 *
 * Taken out of Sandbox 4: a renderer set up for the sky (./sky.js) — ACES tone mapping and
 * soft shadows — a perspective camera at a walker's field of view, both kept to the size of
 * their container, and a resolution that eases down a little when frames get slow and back
 * up when there is room, so a world stays smooth on a slow phone.
 */
import * as THREE from 'three';

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
 * @param {HTMLElement} container
 * @param {{ fov?: number, near?: number, far?: number, maxPixelRatio?: number }} [options]
 * @returns {StageHandle}
 */
export function createStage(container, options = {}) {
	const { fov = 68, near = 0.1, far = 2400, maxPixelRatio = 1.25 } = options;
	const top = () => Math.min(maxPixelRatio, window.devicePixelRatio);
	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(top());
	renderer.setSize(container.clientWidth, container.clientHeight);
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.42;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	container.appendChild(renderer.domElement);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(fov, container.clientWidth / container.clientHeight, near, far);

	const onResize = () => {
		camera.aspect = container.clientWidth / container.clientHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(container.clientWidth, container.clientHeight);
	};
	window.addEventListener('resize', onResize);

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
			window.removeEventListener('resize', onResize);
			scene.traverse((o) => /** @type {THREE.Mesh} */ (o).geometry?.dispose());
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
