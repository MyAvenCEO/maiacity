/*
 * IMPOSTORS — the trees of a forest far away, each drawn as a picture of itself: every kind of tree photographed once
 * (on the graphics card, when the forest has grown) from eight sides, the pictures laid side by side in one texture,
 * and each tree beyond a distance a single card standing upright at its foot, turned towards the eye, showing the
 * picture from the side the eye sees it from. Two triangles a tree, all the trees of the forest in one draw call, and
 * from afar it reads as the tree itself: its crown's shape, its gaps, its fruit, its colours — not a ball on a stick.
 *
 * The card is lit as the scene is (the sun on it, the sky, the fog), as if it were a crown facing the eye a little
 * upward; its picture is baked with only a soft light from the front, so the crown keeps its depth whatever the hour.
 * It casts its shadow too: in the shadow pass the card turns to face the sun and throws the tree's silhouette.
 *
 * Which trees show as cards is decided on the graphics card, every frame: those at least `from` metres from where the
 * forest last chose its detail (./flora.js draws the nearer ones in full), fading in over the last few metres before
 * (a dither, no blending), so a tree never pops from one to the other.
 */
import * as THREE from 'three';

/** how many sides each tree is photographed from */
const FRAMES = 8;
/** how far before `from` a card starts to fade in (m) */
const BLEND = 6;

/**
 * @typedef {{
 *   parts: { geometry: THREE.BufferGeometry, kind: 'body' | 'sheet' | 'gloss' }[],
 *   height: number, reach: number, leaf: THREE.Color,
 *   x: Float32Array, y: Float32Array, z: Float32Array, c: Float32Array, s: Float32Array, n: number
 * }} TreeKind one kind of tree: its shape (its full detail), its measure, and every tree of it
 */

/**
 * The cards of a forest's trees: drawn from `from` metres, and casting their trees' shadows from `shadowFrom` (where
 * the full trees stop casting theirs).
 * @param {THREE.WebGLRenderer} renderer @param {TreeKind[]} kinds @param {number} from @param {number} [shadowFrom]
 */
export function impostors(renderer, kinds, from, shadowFrom = from) {
	const { texture, cols, rows, dispose: freeAtlas } = bake(renderer, kinds);
	// the cards: one quad, instanced, its foot at the middle of its bottom edge
	const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
	const geo = new THREE.InstancedBufferGeometry();
	geo.index = quad.index;
	geo.setAttribute('position', quad.attributes.position);
	geo.setAttribute('normal', quad.attributes.normal);
	geo.setAttribute('uv', quad.attributes.uv);
	const total = kinds.reduce((a, k) => a + k.n, 0);
	const at = new Float32Array(total * 3), size = new Float32Array(total), turn = new Float32Array(total), slot = new Float32Array(total);
	let j = 0;
	kinds.forEach((k, s) => {
		const S = frameSize(k);
		for (let i = 0; i < k.n; i++, j++) {
			const c = /** @type {number} */ (k.c[i]), sn = /** @type {number} */ (k.s[i]);
			at[j * 3] = /** @type {number} */ (k.x[i]);
			at[j * 3 + 1] = /** @type {number} */ (k.y[i]) - S * 0.02 * Math.hypot(c, sn);
			at[j * 3 + 2] = /** @type {number} */ (k.z[i]);
			size[j] = S * Math.hypot(c, sn);
			turn[j] = Math.atan2(sn, c);
			slot[j] = s;
		}
	});
	geo.setAttribute('aAt', new THREE.InstancedBufferAttribute(at, 3));
	geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
	geo.setAttribute('aTurn', new THREE.InstancedBufferAttribute(turn, 1));
	geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 1));
	geo.instanceCount = total;

	const uniforms = {
		uEye: { value: new THREE.Vector2(Infinity, Infinity) },
		uGrid: { value: new THREE.Vector2(cols, rows) },
		uMask: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, 0, -1)) }
	};
	/** @param {THREE.Material} mat @param {number} start */
	const patch = (mat, start) => {
		mat.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, uniforms, { uFrom: { value: start } });
			shader.vertexShader = shader.vertexShader
				.replace(
					'#include <common>',
					`#include <common>
attribute vec3 aAt;
attribute float aSize;
attribute float aTurn;
attribute float aSlot;
uniform vec2 uEye;
uniform float uFrom;
uniform vec2 uGrid;
uniform vec3 uMask[8];
varying float vFade;
varying vec2 vCard;`
				)
				// the card turned to the eye (the light, in the shadow pass) about its upright axis
				.replace(
					'#include <beginnormal_vertex>',
					`vec2 te = cameraPosition.xz - aAt.xz;
	te = length(te) > 1e-4 ? normalize(te) : vec2(0.0, 1.0);
	vec3 objectNormal = normalize(vec3(te.x, 0.55, te.y));
	#ifdef USE_TANGENT
		vec3 objectTangent = vec3(te.y, 0.0, -te.x);
	#endif`
				)
				.replace(
					'#include <begin_vertex>',
					`vec2 tc = cameraPosition.xz - aAt.xz;
	tc = length(tc) > 1e-4 ? normalize(tc) : vec2(0.0, 1.0);
	float dEye = distance(aAt.xz, uEye);
	vFade = clamp((dEye - (uFrom - ${BLEND.toFixed(1)})) / ${BLEND.toFixed(1)}, 0.0, 1.0);
	vec3 right = vec3(tc.y, 0.0, -tc.x);
	vec3 transformed = aAt + right * position.x * aSize + vec3(0.0, position.y * aSize, 0.0);
	// in ground left out (a dome showing its own forest there): none
	for (int i = 0; i < 8; i++) if (distance(aAt.xz, uMask[i].xy) < uMask[i].z) vFade = 0.0;
	// nearer than where the cards begin: folded away to nothing
	if (vFade <= 0.0) transformed = aAt;
	// which of its eight pictures: the side the eye sees it from, in the tree's own turn
	float side = mod(floor((atan(tc.x, tc.y) - aTurn) / ${((Math.PI * 2) / FRAMES).toFixed(6)} + 0.5), ${FRAMES.toFixed(1)});
	float cell = aSlot * ${FRAMES.toFixed(1)} + side;
	vec2 cr = vec2(mod(cell, uGrid.x), floor(cell / uGrid.x));
	vCard = (cr + clamp(uv, 0.004, 0.996)) / uGrid;`
				);
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying float vFade;\nvarying vec2 vCard;')
				// the picture of the tree from that side (in place of the map's own coordinates)
				.replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D( map, vCard );\n\tdiffuseColor *= sampledDiffuseColor;')
				.replace(
					'#include <alphatest_fragment>',
					`#include <alphatest_fragment>
	// fading in: a fine dither, so the card comes in under the full tree without any blending
	if (vFade < 1.0 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > vFade) discard;`
				);
		};
		mat.customProgramCacheKey = () => `flora-impostor-${start}`;
	};
	const material = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.5, roughness: 0.85, side: THREE.DoubleSide });
	patch(material, from);
	const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
	patch(depth, shadowFrom);
	const mesh = new THREE.Mesh(geo, material);
	mesh.name = 'flora impostors';
	mesh.frustumCulled = false;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.customDepthMaterial = depth;
	return {
		mesh,
		/** circles of ground (x, z, r) whose trees are left out */
		mask(/** @type {{ x: number, z: number, r: number }[]} */ list) {
			uniforms.uMask.value.forEach((v, i) => {
				const m = list[i];
				v.set(m?.x ?? 0, m?.z ?? 0, m?.r ?? -1);
			});
		},
		/** the eye the forest chose its detail for: the cards stand from `from` round it */
		eye(/** @type {number} */ x, /** @type {number} */ z) {
			uniforms.uEye.value.set(x, z);
		},
		dispose() {
			mesh.removeFromParent();
			geo.dispose();
			quad.dispose();
			material.dispose();
			depth.dispose();
			freeAtlas();
		}
	};
}

/** a kind's picture, square: as wide as its crown or as tall as it stands, whichever is more @param {TreeKind} k */
const frameSize = (k) => Math.max(0.5, Math.max(k.reach * 2, k.height) * 1.08);

/**
 * Every kind photographed from its eight sides into one texture.
 * @param {THREE.WebGLRenderer} renderer @param {TreeKind[]} kinds
 */
function bake(renderer, kinds) {
	const cells = kinds.length * FRAMES;
	const most = Math.min(4096, renderer.capabilities.maxTextureSize);
	// as fine a picture as fits (at most 192 px a side, enough for a tree 40 m off on a large screen), in no more than
	// 4096 × 2048 pixels all told: a texture any phone holds
	let px = 192, cols = 1, rows = 1;
	for (;;) {
		cols = Math.floor(most / px);
		rows = Math.ceil(cells / cols);
		if ((rows * px <= most && cols * rows * px * px <= 4096 * 2048) || px <= 32) break;
		px -= 16;
	}
	// each picture drawn smooth-edged (multisampled) on its own, then copied to its place in the texture
	const shot = new THREE.WebGLRenderTarget(px, px, { samples: 4, generateMipmaps: false });
	shot.texture.colorSpace = THREE.SRGBColorSpace;
	const target = new THREE.WebGLRenderTarget(cols * px, rows * px, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
	target.texture.colorSpace = THREE.SRGBColorSpace;
	target.texture.anisotropy = 4;
	renderer.initRenderTarget(target);
	const scene = new THREE.Scene();
	// a soft light from the front and all round: the crown's leaves facing away a little darker, nothing in shadow
	scene.add(new THREE.AmbientLight('#ffffff', Math.PI * 0.6));
	const key = new THREE.DirectionalLight('#ffffff', Math.PI * 0.5);
	scene.add(key, key.target);
	const mats = {
		body: new THREE.MeshLambertMaterial({ vertexColors: true }),
		sheet: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
		gloss: new THREE.MeshLambertMaterial({ vertexColors: true })
	};
	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
	const was = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear };
	renderer.autoClear = false;
	const to = new THREE.Vector2();
	kinds.forEach((k, s) => {
		const group = new THREE.Group();
		for (const p of k.parts) group.add(new THREE.Mesh(p.geometry, mats[p.kind]));
		scene.add(group);
		const S = frameSize(k), D = k.reach + 20;
		camera.left = -S / 2;
		camera.right = S / 2;
		camera.top = S / 2;
		camera.bottom = -S / 2;
		camera.far = D * 2 + 10;
		camera.updateProjectionMatrix();
		for (let f = 0; f < FRAMES; f++) {
			const a = (f / FRAMES) * Math.PI * 2, cell = s * FRAMES + f;
			const x = (cell % cols) * px, y = Math.floor(cell / cols) * px;
			const mid = S * 0.48;
			camera.position.set(Math.sin(a) * D, mid, Math.cos(a) * D);
			camera.lookAt(0, mid, 0);
			key.position.set(Math.sin(a) * D, mid + D * 0.6, Math.cos(a) * D);
			renderer.setRenderTarget(shot);
			// cleared to the leaves' own colour, see-through: from afar, where the picture is averaged down, its edges
			// soften into its own green, never into black
			renderer.setClearColor(k.leaf, 0);
			renderer.clear();
			renderer.render(scene, camera);
			renderer.copyTextureToTexture(shot.texture, target.texture, null, to.set(x, y));
		}
		scene.remove(group);
	});
	// and its smaller copies for afar, made once now it is complete (drawing nothing into it makes them)
	renderer.setRenderTarget(target);
	renderer.render(new THREE.Scene(), camera);
	renderer.setRenderTarget(was.target);
	renderer.setClearColor(was.color, was.alpha);
	renderer.autoClear = was.autoClear;
	for (const m of Object.values(mats)) m.dispose();
	shot.dispose();
	return {
		texture: target.texture,
		cols,
		rows,
		dispose: () => target.dispose()
	};
}
