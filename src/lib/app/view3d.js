/*
 * What every asset viewer (Machines, Actors, Things) shares to stay quick and light on any device: how much the device
 * can draw, a resolution that follows the frame rate, and letting go of what a model held on the graphics card when the
 * next one comes on.
 *
 * Why (Samuel, 2026-10-15: "loading takes quite some time and on mobile almost never loads"): each model shown stayed
 * on the graphics card after the next was picked, so a phone ran out of memory after a few and lost its canvas; and a
 * phone drew at twice its pixels with the desktop's shadows, occlusion and multisampling, a few frames a second.
 */
import * as THREE from 'three';

/** A phone or a small tablet, or a device with little memory or few cores: draw less. */
export function lowPower() {
	if (typeof window === 'undefined') return false;
	const nav = /** @type {Navigator & { deviceMemory?: number }} */ (navigator);
	const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
	const small = Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0) < 1100;
	return (touch && small) || (nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency ?? 8) <= 4;
}

/** the most pixels per CSS pixel worth drawing on this device */
export const topPixelRatio = (low = lowPower()) => Math.min(low ? 1.5 : 2, window.devicePixelRatio || 1);

/**
 * A resolution that follows the frame rate: call it once a frame. Slow frames lower the pixel ratio a step (never under
 * `floor`), quick ones raise it again (never over the device's top); `onChange` is told, to resize what depends on it.
 * While `hold()` says so (a model being built) frames are not counted: a long build is not a slow device.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ top?: number, floor?: number, hold?: () => boolean, onChange?: () => void }} [o]
 */
export function adaptiveResolution(renderer, { top = topPixelRatio(), floor = 1, hold, onChange } = {}) {
	let frames = 0, since = performance.now();
	return (now = performance.now()) => {
		if (hold?.()) {
			frames = 0;
			since = now;
			return;
		}
		frames++;
		if (now - since < 1500) return;
		const fps = (frames * 1000) / (now - since);
		const pr = renderer.getPixelRatio();
		let next = pr;
		if (fps < 30 && pr > floor) next = Math.max(floor, pr - 0.25);
		else if (fps > 55 && pr < top) next = Math.min(top, pr + 0.125);
		if (next !== pr) {
			renderer.setPixelRatio(next);
			onChange?.();
		}
		frames = 0;
		since = now;
	};
}

const MAPS = /** @type {const} */ (['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'clearcoatNormalMap', 'transmissionMap', 'thicknessMap']);

/**
 * Let go of everything under `root` on the graphics card: its geometries, materials, their textures and skeletons.
 * They can still be drawn again (three uploads them anew), so a material shared with the next model is safe; `keep`
 * names materials not to touch (the viewer's own highlight and ghost).
 * @param {THREE.Object3D | null | undefined} root
 * @param {Set<THREE.Material>} [keep]
 */
export function disposeObject(root, keep = new Set()) {
	if (!root) return;
	/** @type {Set<THREE.Material>} */
	const mats = new Set();
	root.traverse((o) => {
		const m = /** @type {THREE.Mesh & { skeleton?: THREE.Skeleton }} */ (o);
		m.geometry?.dispose?.();
		m.skeleton?.dispose();
		for (const mat of [m.material ?? []].flat()) if (mat && !keep.has(mat)) mats.add(mat);
	});
	for (const mat of mats) {
		const any = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (mat));
		for (const k of MAPS) /** @type {THREE.Texture | undefined} */ (any[k])?.dispose?.();
		mat.dispose();
	}
}

/**
 * Compile a model's shaders before it is first drawn, off the page's thread where the browser can
 * (KHR_parallel_shader_compile), so the page never stalls on the first frame; a browser that cannot simply compiles
 * them now. Never throws: a model that fails here is still drawn the usual way.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Object3D} object
 * @param {THREE.Camera} camera
 * @param {THREE.Scene} [scene]
 */
export async function precompile(renderer, object, camera, scene) {
	try {
		await renderer.compileAsync(object, camera, scene);
	} catch {
		/* drawn as usual */
	}
}
