/*
 * THREE FOR THE FACTORIES — the app's own three.js (package.json: three ^0.186) with the addons AirSup's factory
 * runtime uses, gathered behind one name `T`, as their vendored bundle (three.js r185 plus the same addons on
 * `globalThis.THREE`) gave them. The ported runtime (des.js, kit.js, world.js, look.js, app.js) reads `T.…` exactly as
 * AirSup wrote it, so a newer AirSup version can be diffed against ours line by line.
 *
 * Its renderer, its orbit controls and its composer are the render core's ($lib/render, plan C5): `new
 * T.WebGLRenderer(params)`, `new T.OrbitControls(camera, dom)` and `new T.EffectComposer(renderer, target)` give back
 * what createRenderer, createControls and createComposer make, set the way three.js's own constructors leave them (one
 * pixel per CSS pixel, no damping), so the runtime sets the rest itself, as it always did.
 */
import * as THREE from 'three';
import { createControls, createRenderer } from '$lib/render/core.js';
import { createComposer } from '$lib/render/post.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * three.js's WebGLRenderer, as the core makes it
 * @param {THREE.WebGLRendererParameters} [p]
 */
function WebGLRenderer(p = {}) {
	return createRenderer({ canvas: /** @type {HTMLCanvasElement | undefined} */ (p.canvas), antialias: p.antialias ?? false, alpha: p.alpha, power: p.powerPreference, preserve: p.preserveDrawingBuffer, pixelRatio: 1 });
}
/**
 * OrbitControls, as the core makes them
 * @param {THREE.Camera} camera
 * @param {HTMLElement} dom
 */
function Controls(camera, dom) {
	return createControls(camera, dom, { enableDamping: false });
}
/**
 * EffectComposer, as the core makes it
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.WebGLRenderTarget} [target]
 */
function Composer(renderer, target) {
	return createComposer(renderer, target);
}

/** three.js and the addons the factory runtime uses, under one name */
export const T = /** @type {typeof THREE & { EffectComposer: typeof EffectComposer, RenderPass: typeof RenderPass, ShaderPass: typeof ShaderPass, UnrealBloomPass: typeof UnrealBloomPass, GTAOPass: typeof GTAOPass, OutputPass: typeof OutputPass, RoomEnvironment: typeof RoomEnvironment, OrbitControls: typeof OrbitControls, RoundedBoxGeometry: typeof RoundedBoxGeometry, BufferGeometryUtils: typeof BufferGeometryUtils }} */ ({
	...THREE,
	WebGLRenderer: /** @type {typeof THREE.WebGLRenderer} */ (/** @type {unknown} */ (WebGLRenderer)),
	EffectComposer: /** @type {typeof EffectComposer} */ (/** @type {unknown} */ (Composer)),
	RenderPass,
	ShaderPass,
	UnrealBloomPass,
	GTAOPass,
	OutputPass,
	RoomEnvironment,
	OrbitControls: /** @type {typeof OrbitControls} */ (/** @type {unknown} */ (Controls)),
	RoundedBoxGeometry,
	BufferGeometryUtils
});
