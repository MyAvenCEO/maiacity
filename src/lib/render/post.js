// @ts-nocheck — three's post-processing passes are typed loosely
/*
 * THE POST STACK — the one way a page draws through post-processing: the scene into a half-float, multisampled target,
 * then ambient occlusion (GTAO), bloom, the output pass (tone mapping and colour space) and a page's own passes (a
 * grade, a tilt shift), each only where it is asked for. The asset stage (../assets/stage.js) and the Factories' look
 * (../factories/look.js) draw through it; the film camera's darkroom (../film/pipeline.js) is the film's own.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export { ShaderPass };

/**
 * @typedef {object} PostOptions
 * @property {[number, number]} [target] the render target's size at first, px (default 1 × 1: sized by `setSize`)
 * @property {number} [samples] its multisampling (default 4)
 * @property {{ pixelRatio: number, width: number, height: number }} [size] the composer sized at once, before its passes
 * @property {false | ((ao: GTAOPass) => void)} [ao] ambient occlusion, set up by the page
 * @property {{ size?: [number, number], strength: number, radius: number, threshold: number, on?: boolean }} [bloom]
 *   bloom (made either way when given; drawn unless `on` is false)
 * @property {any[]} [after] the page's own passes, after the output pass, in order
 */

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {PostOptions} [o]
 */
export function createPost(renderer, scene, camera, o = {}) {
	const [w, h] = o.target ?? [1, 1];
	const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: o.samples ?? 4 }));
	if (o.size) {
		// at the canvas's own pixels (a composer given its target counts them 1:1 until told the ratio)
		composer.setPixelRatio(o.size.pixelRatio);
		composer.setSize(o.size.width, o.size.height);
	}
	composer.addPass(new RenderPass(scene, camera));
	let ao = null;
	if (o.ao) {
		ao = new GTAOPass(scene, camera, w, h);
		o.ao(ao);
		composer.addPass(ao);
	}
	let bloom = null;
	if (o.bloom) {
		bloom = new UnrealBloomPass(new THREE.Vector2(...(o.bloom.size ?? [w / 2, h / 2])), o.bloom.strength, o.bloom.radius, o.bloom.threshold);
		if (o.bloom.on !== false) composer.addPass(bloom);
	}
	composer.addPass(new OutputPass());
	for (const p of o.after ?? []) composer.addPass(p);
	return {
		composer,
		ao,
		bloom,
		/** the canvas's size changed (CSS px, at the renderer's pixel ratio) @param {number} width @param {number} height @param {number} pixelRatio */
		setSize(width, height, pixelRatio) {
			composer.setPixelRatio(pixelRatio);
			composer.setSize(width, height);
		},
		/** @param {number} [dt] */
		render: (dt) => composer.render(dt),
		dispose: () => composer.dispose()
	};
}
