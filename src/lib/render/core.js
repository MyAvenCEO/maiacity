/*
 * THE RENDER CORE — the plumbing under every three.js canvas of the app, written once (plan C5, section 4.4 of
 * code-architecture/plan.md). The purpose renderers beside it (./world.js, ./stage.js, ./preview.js, ./film.js) add
 * only what their job needs; a page mounts one of them and never makes a WebGLRenderer itself (a lint test,
 * ./lint.test.js, holds every `new WebGLRenderer`, `new OrbitControls` and `new EffectComposer` to this folder).
 *
 *   createRenderer   the one way to make a renderer: its canvas, pixels, colour space, tone mapping, shadows, clipping
 *   lowPower, topPixelRatio, adaptiveResolution, precompile   how much a device draws, and keeping it smooth
 *   fitTo            a canvas kept to its element's size (and the camera's aspect)
 *   disposeObject    the one way to let go of what a model holds on the graphics card
 *   createControls   the one OrbitControls setup (damped)
 *   materialCache    the one page-side material cache (recipe code keeps its own: it is hashed with its recipe)
 *
 * The post stack (render target, ambient occlusion, bloom, output, a page's own passes) is ./post.js.
 *
 * Why the device rules (Samuel, 2026-10-15: "loading takes quite some time and on mobile almost never loads"): each
 * model shown stayed on the graphics card after the next was picked, so a phone ran out of memory after a few and lost
 * its canvas; and a phone drew at twice its pixels with the desktop's shadows, occlusion and multisampling.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** tone mappings by name */
export const TONE = /** @type {const} */ ({ none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping });
/** shadow map kinds by name (`true` keeps three's default, PCF) */
export const SHADOWS = /** @type {const} */ ({ pcf: THREE.PCFShadowMap, soft: THREE.PCFSoftShadowMap, basic: THREE.BasicShadowMap, vsm: THREE.VSMShadowMap });

/**
 * @typedef {object} RendererOptions
 * @property {HTMLCanvasElement} [canvas] draw on this canvas (else the renderer makes one)
 * @property {HTMLElement} [container] put the renderer's canvas in this element
 * @property {boolean} [antialias] multisampling (default true)
 * @property {boolean} [alpha] a see-through canvas
 * @property {WebGLPowerPreference} [power] the GPU asked for
 * @property {boolean} [preserve] keep the drawing buffer (to read it back)
 * @property {number} [pixelRatio] pixels per CSS pixel, as given
 * @property {number} [maxPixelRatio] else the device's, at most this (default 2)
 * @property {THREE.ColorSpace} [colorSpace] the output's (three's default: sRGB)
 * @property {keyof typeof TONE} [toneMapping] none (default), aces or neutral
 * @property {number} [exposure] the tone mapping's exposure (default 1)
 * @property {boolean | keyof typeof SHADOWS} [shadows] shadow maps on (true: three's default kind) and of which kind
 * @property {boolean} [clipping] clipping planes per material
 * @property {() => void} [onLost] the graphics card took the canvas back (the default reaction prevented)
 */

/**
 * The one way to make a renderer: every `new THREE.WebGLRenderer` of the app is this one.
 * @param {RendererOptions} [o]
 * @returns {THREE.WebGLRenderer}
 */
export function createRenderer(o = {}) {
	const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: o.antialias ?? true, alpha: o.alpha, powerPreference: o.power, preserveDrawingBuffer: o.preserve });
	renderer.setPixelRatio(o.pixelRatio ?? Math.min(o.maxPixelRatio ?? 2, window.devicePixelRatio || 1));
	if (o.colorSpace) renderer.outputColorSpace = o.colorSpace;
	if (o.toneMapping) renderer.toneMapping = TONE[o.toneMapping];
	if (o.exposure !== undefined) renderer.toneMappingExposure = o.exposure;
	if (o.shadows) {
		renderer.shadowMap.enabled = true;
		if (o.shadows !== true) renderer.shadowMap.type = SHADOWS[o.shadows];
	}
	if (o.clipping) renderer.localClippingEnabled = true;
	if (o.onLost) {
		const lost = o.onLost;
		renderer.domElement.addEventListener('webglcontextlost', (e) => {
			e.preventDefault();
			lost();
		});
	}
	o.container?.appendChild(renderer.domElement);
	return renderer;
}

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

/**
 * A renderer's canvas kept to an element's size: at once, whenever the element changes size (and the window, for a
 * phone's bars that settle the element only after it), the drawing buffer, the camera's aspect (or `fit`), then
 * `onResize`.
 * @param {THREE.WebGLRenderer} renderer
 * @param {HTMLElement} el
 * @param {{ camera?: THREE.PerspectiveCamera, fit?: (camera: THREE.PerspectiveCamera, w: number, h: number) => void, style?: boolean, window?: boolean, now?: boolean, onResize?: (w: number, h: number) => void }} [o]
 *   style: set the canvas's CSS size too (default true); now: fit at once (default true)
 * @returns {{ fit: () => void, dispose: () => void }}
 */
export function fitTo(renderer, el, { camera, fit, style = true, window: win = false, now = true, onResize } = {}) {
	// the size it was fitted to (as made, when it is not fitted at once): the observer's first call changes nothing
	let size = `${el.clientWidth}x${el.clientHeight}`;
	const resize = () => {
		const w = el.clientWidth, h = el.clientHeight;
		size = `${w}x${h}`;
		renderer.setSize(w, h, style);
		if (camera && fit) fit(camera, w, h);
		else if (camera) {
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		}
		onResize?.(w, h);
	};
	const watch = new ResizeObserver(() => size !== `${el.clientWidth}x${el.clientHeight}` && resize());
	watch.observe(el);
	if (win) window.addEventListener('resize', resize);
	if (now) resize();
	return {
		fit: resize,
		dispose() {
			watch.disconnect();
			if (win) window.removeEventListener('resize', resize);
		}
	};
}

const MAPS = /** @type {const} */ (['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'clearcoatNormalMap', 'transmissionMap', 'thicknessMap']);

/**
 * Each frame only what is seen is placed: three.js works out every object's place in the world before each render,
 * hidden or not — 17,489 objects in Sandbox 3's cell, 3,001 of them seen. This makes the render work out the places of
 * the visible ones only (and of everything under them); a hidden one is marked to be placed again once it is shown, so
 * none is ever drawn where it was. Called once on a world's scene; every render of it then does this.
 * @param {THREE.Scene} scene
 */
export function placeSeenOnly(scene) {
	scene.matrixWorldAutoUpdate = false;
	const before = scene.onBeforeRender;
	scene.onBeforeRender = function (...a) {
		place(scene, false);
		before.apply(this, a);
	};
}
/** three.js's updateMatrixWorld, going no further into what is hidden @param {THREE.Object3D} o @param {boolean} force */
export function place(o, force) {
	if (o.matrixAutoUpdate) o.updateMatrix();
	if (o.matrixWorldNeedsUpdate || force) {
		if (o.parent === null) o.matrixWorld.copy(o.matrix);
		else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
		o.matrixWorldNeedsUpdate = false;
		force = true;
		// and what three.js's own updateMatrixWorld does past the matrix for these two: a skinned mesh's bind (the
		// village's hens and goats were skinned against where they stood when built, and drawn there, out of sight) and a
		// camera's view
		if (/** @type {any} */ (o).isSkinnedMesh) {
			const m = /** @type {THREE.SkinnedMesh} */ (o);
			m.bindMatrixInverse.copy(m.bindMode === THREE.AttachedBindMode ? m.matrixWorld : m.bindMatrix).invert();
		} else if (/** @type {any} */ (o).isCamera) /** @type {THREE.Camera} */ (o).matrixWorldInverse.copy(o.matrixWorld).invert();
	}
	const kids = o.children;
	for (let i = 0; i < kids.length; i++) {
		const c = kids[i];
		if (c.visible) place(c, force);
		// hidden: placed again once shown, wherever what it hangs on has gone meanwhile
		else if (force) c.matrixWorldNeedsUpdate = true;
	}
}

/**
 * Let go of everything under `root` on the graphics card: its geometries and skeletons, and (unless told not to) its
 * materials and their textures. They can still be drawn again (three uploads them anew), so a material shared with
 * the next model is safe; `keep` names materials not to touch (a viewer's own highlight and ghost). `materials: false`
 * frees the shapes only, for a scene whose materials are shared with what stays; `textures: false` keeps the pictures.
 * @param {THREE.Object3D | null | undefined} root
 * @param {{ materials?: boolean, textures?: boolean, keep?: Set<THREE.Material> }} [o]
 */
export function disposeObject(root, { materials = true, textures = true, keep } = {}) {
	if (!root) return;
	/** @type {Set<THREE.Material>} */
	const mats = new Set();
	root.traverse((o) => {
		const m = /** @type {THREE.Mesh & { skeleton?: THREE.Skeleton }} */ (o);
		m.geometry?.dispose?.();
		m.skeleton?.dispose();
		if (materials) for (const mat of [m.material ?? []].flat()) if (mat && !keep?.has(mat)) mats.add(mat);
	});
	for (const mat of mats) {
		if (textures) {
			const any = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (mat));
			for (const k of MAPS) /** @type {THREE.Texture | undefined} */ (any[k])?.dispose?.();
		}
		mat.dispose();
	}
}

/**
 * The renderer let go of, and its canvas taken off the page.
 * @param {THREE.WebGLRenderer} renderer
 */
export function disposeRenderer(renderer) {
	renderer.dispose();
	renderer.domElement.remove();
}

/**
 * The one OrbitControls setup: damped, then any of its settings (`target` copied).
 * @param {THREE.Camera} camera
 * @param {HTMLElement} dom
 * @param {Partial<Omit<OrbitControls, 'target'>> & { target?: THREE.Vector3 }} [o]
 * @returns {OrbitControls}
 */
export function createControls(camera, dom, { target, ...set } = {}) {
	const controls = new OrbitControls(camera, dom);
	controls.enableDamping = true;
	Object.assign(controls, set);
	if (target) controls.target.copy(target);
	return controls;
}

/**
 * @typedef {(<M extends THREE.Material>(key: string, make: () => M) => M) & { dispose: () => void, readonly size: number }} MaterialCache
 */

/**
 * A material cache: one material per key (a world's colours), made by `make` the first time it is asked for and shared
 * by every mesh that asks again, so the graphics card compiles and holds each once. A module's cache lives as long as
 * the page (its worlds' disposeObject keeps shared materials, `materials: false`); `dispose()` lets one go with what
 * used it.
 * @returns {MaterialCache}
 */
export function materialCache() {
	/** @type {Map<string, THREE.Material>} */
	const kept = new Map();
	const get = /** @type {MaterialCache} */ (
		/** @type {unknown} */ (
			(/** @type {string} */ key, /** @type {() => THREE.Material} */ make) => {
				let m = kept.get(key);
				if (!m) kept.set(key, (m = make()));
				return m;
			}
		)
	);
	Object.defineProperty(get, 'size', { get: () => kept.size });
	get.dispose = () => {
		for (const m of kept.values()) m.dispose();
		kept.clear();
	};
	return get;
}
