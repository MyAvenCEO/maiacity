// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE RENDERER'S MATERIALS — every material a build of an asset is drawn with, as the renderer keeps it (./index.js):
 * one for all the materials that are the same (two plants' bark of the same colour, one kind's steel at every level
 * of detail), so the graphics card switches between as few as it can, and each given the shader code that only the
 * renderer adds, never an asset (its own never leaves the box, ../box/serialize.js):
 *
 * - FADE: a thing coming in at another level of detail (./lod.js) is drawn through a fine dither that fills in as it
 *   comes (`aFade`, per copy: 0 whole, between 0 and 1 that much of it), under the level it takes over from, so
 *   nothing pops. No blending, so nothing needs sorting.
 * - SECTION CAPS: a solid of the kit's (../kit.js, the materials it gave a cap shader in the box) cut open by the
 *   renderer's plane (`cut`) shows its cut face, flat and in the cap's colour with a faint hatch, the way AirSup's lab
 *   cuts a machine open (the same shader, ours now: the back faces seen through the opening drawn as the face on the
 *   plane). Everything else is only cut away.
 */
import * as THREE from 'three';

/** what a material is, for telling two the same: the settings ../box/serialize.js carries over, and its maps' */
const PLAIN = ['side', 'roughness', 'metalness', 'opacity', 'transparent', 'vertexColors', 'flatShading', 'alphaTest', 'depthWrite', 'depthTest', 'transmission', 'ior', 'thickness', 'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'envMapIntensity', 'emissiveIntensity', 'bumpScale', 'wireframe', 'shininess', 'specularIntensity', 'iridescence', 'anisotropy', 'dispersion', 'aoMapIntensity', 'lightMapIntensity', 'displacementScale', 'displacementBias', 'toneMapped', 'fog'];
const COLORS = ['color', 'emissive', 'sheenColor', 'specularColor', 'attenuationColor', 'specular'];
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'bumpMap', 'emissiveMap', 'aoMap', 'clearcoatNormalMap', 'displacementMap'];

/** a texture as the same picture shown the same way */
const textureKey = (t) => `${t.source?.uuid ?? t.uuid}:${t.wrapS},${t.wrapT}:${t.repeat.x},${t.repeat.y}:${t.offset.x},${t.offset.y}:${t.rotation}:${t.colorSpace}:${t.flipY}`;

/** @param {THREE.Material} m */
export function keyOf(m) {
	const cap = m.userData.cap;
	const out = [m.type, m.userData.custom ? 'custom' : '', cap ? `${cap.color}/${cap.rough}/${cap.metal}` : ''];
	for (const k of PLAIN) if (k in m) out.push(m[k]);
	for (const k of COLORS) if (m[k]?.isColor) out.push(m[k].getHex());
	for (const k of MAPS) out.push(m[k]?.isTexture ? textureKey(m[k]) : '');
	if (m.normalScale?.isVector2) out.push(m.normalScale.x, m.normalScale.y);
	return out.join('|');
}

/** a solid the kit gave section caps in the box: one of its materials (MeshPhysical, both sides drawn, a shader of its own) */
export const capped = (m) => !!m.userData.custom && m.isMeshPhysicalMaterial && m.side === THREE.DoubleSide;

/** the colour of a cut face: the kit's museum red */
const CAP = new THREE.Color(0.56, 0.085, 0.045);

/** the dither every drawing of ours fades in by: the same everywhere on the screen, so two levels never fight */
export const DITHER = 'fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453)';

/**
 * The renderer's materials: `of(m)` the one kept for a material (the first of its kind it was handed, given our
 * shaders), `cut(plane)` opens every one along a plane (null closes them).
 */
export function createPresets() {
	/** @type {Map<string, THREE.Material>} */
	const kept = new Map();
	/** @type {WeakSet<THREE.Material>} the materials kept */
	const ours = new WeakSet();
	// the cut, shared by every material: the plane (removed where dot(n, p) + w < 0), and a second one never used yet
	const CUT = { a: { value: new THREE.Vector4(0, 0, -1, 1e5) }, b: { value: new THREE.Vector4(0, 0, -1, 1e5) }, hatch: { value: 0.012 } };
	/** @type {THREE.Plane[]} */
	let planes = [];

	/** @param {THREE.Material} m */
	function patch(m) {
		const cap = capped(m);
		// its cut face as the kit gave it (engine 3 says), else the kit's museum red
		const given = m.userData.cap;
		const uCap = { value: given ? new THREE.Color(given.color) : CAP.clone() };
		const uCapR = { value: given ? given.rough : 0.55 };
		const uCapM = { value: given ? given.metal : 0 };
		m.onBeforeCompile = (sh) => {
			sh.vertexShader = sh.vertexShader
				.replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;' + (cap ? '\nvarying vec3 vLabW;' : ''))
				.replace(
					'#include <project_vertex>',
					`#include <project_vertex>
	vFade = aFade;` +
						(cap
							? `
	{ vec4 lw = vec4(transformed, 1.0);
		#ifdef USE_INSTANCING
		lw = instanceMatrix * lw;
		#endif
		vLabW = (modelMatrix * lw).xyz; }`
							: '')
				);
			sh.fragmentShader = sh.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying float vFade;')
				.replace(
					'#include <clipping_planes_fragment>',
					`#include <clipping_planes_fragment>
	if (vFade > 0.0 && vFade < 1.0 && ${DITHER} > vFade) discard;`
				);
			if (!cap) return;
			// AirSup's section caps (../kit.js capPatch), on our own uniforms
			Object.assign(sh.uniforms, { uCutA: CUT.a, uCutB: CUT.b, uHatch: CUT.hatch, uCapColor: uCap, uCapRough: uCapR, uCapMetal: uCapM });
			sh.fragmentShader = sh.fragmentShader
				.replace(
					'varying float vFade;',
					`varying float vFade;
varying vec3 vLabW;
uniform vec4 uCutA; uniform vec4 uCutB; uniform float uHatch;
uniform vec3 uCapColor; uniform float uCapRough; uniform float uCapMetal;
void labClip(vec4 P, vec3 ro, vec3 rd, inout float t0, inout float t1, inout int id, int k) {
	float dn = dot(P.xyz, rd), d0 = dot(P.xyz, ro) + P.w;
	if (abs(dn) < 1e-8) { if (d0 >= 0.0) { t0 = 1.0; t1 = 0.0; } return; }
	float th = -d0 / dn;
	if (dn > 0.0) { if (th < t1) { t1 = th; id = k; } } else t0 = max(t0, th);
}`
				)
				.replace(
					`if (vFade > 0.0 && vFade < 1.0 && ${DITHER} > vFade) discard;`,
					`if (vFade > 0.0 && vFade < 1.0 && ${DITHER} > vFade) discard;
	bool labCap = false; vec3 labHit = vLabW; vec3 labN = uCutA.xyz;
	if (!gl_FrontFacing && uCutA.w < 1e4) {
		labCap = true;
		vec3 ro = cameraPosition, toF = vLabW - ro; float tf = length(toF); vec3 rd = toF / max(tf, 1e-6);
		float t0 = 0.0, t1 = 1e9; int id = -1;
		labClip(uCutA, ro, rd, t0, t1, id, 0); labClip(uCutB, ro, rd, t0, t1, id, 1);
		if (id == 1) labN = uCutB.xyz;
		else if (id < 0) labN = abs(dot(uCutA.xyz, vLabW) + uCutA.w) < abs(dot(uCutB.xyz, vLabW) + uCutB.w) ? uCutA.xyz : uCutB.xyz;
		labHit = vLabW - labN * (dot(labN, vLabW) + (id == 1 ? uCutB.w : uCutA.w));
	}`
				)
				.replace(
					'#include <color_fragment>',
					`#include <color_fragment>
	if (labCap) {
		float hs = dot(labHit, vec3(0.7071, 0.7071, 0.0)) / uHatch;
		float hl = smoothstep(0.0, 0.08, abs(fract(hs) - 0.5) - 0.42);
		diffuseColor.rgb = uCapColor * (0.94 + 0.06 * hl);
	}`
				)
				.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\tif (labCap) roughnessFactor = uCapRough;')
				.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tif (labCap) metalnessFactor = uCapMetal;')
				.replace(
					'#include <normal_fragment_maps>',
					`#include <normal_fragment_maps>
	if (labCap) { vec3 nw = normalize(-labN); normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz); if (dot(normal, normalize(vViewPosition)) > 0.0) normal = -normal; }`
				);
		};
		// glass that bends the light behind it (transmission) draws the whole world once more every frame just for
		// itself: ours lets the light through as plain see-through glass
		if (m.transmission > 0) {
			m.opacity = Math.min(m.opacity, 1 - 0.7 * m.transmission);
			m.transparent = true;
			m.depthWrite = false;
			m.transmission = 0;
		}
		// and a see-through part seen from both sides is drawn in one pass, not its back and then its front
		if (m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true;
		m.customProgramCacheKey = () => (cap ? 'asset-preset-cap' : 'asset-preset');
		if (cap) m.shadowSide = THREE.FrontSide;
		clip(m);
		return m;
	}

	/** @param {THREE.Material} m */
	function clip(m) {
		m.clippingPlanes = planes.length ? planes : null;
		m.clipIntersection = false;
		m.clipShadows = true;
		m.needsUpdate = true;
	}

	return {
		/** the material kept for `m`: itself, given our shaders, the first time one like it comes; else the one kept */
		of(/** @type {THREE.Material} */ m) {
			// one of ours already (a copy of a level, moved by its controls, wears what the level wears)
			if (ours.has(m)) return m;
			const key = keyOf(m);
			let p = kept.get(key);
			if (!p) kept.set(key, (p = patch(m)));
			ours.add(p);
			return p;
		},
		/** how many there are */
		get size() {
			return kept.size;
		},
		/**
		 * Cuts every material open along `plane` (what lies on its negative side is taken away), or closes them (null).
		 * The renderer must have local clipping on (./index.js sets it).
		 * @param {THREE.Plane | null} plane
		 */
		cut(plane) {
			planes = plane ? [plane] : [];
			if (plane) CUT.a.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
			else CUT.a.value.set(0, 0, -1, 1e5);
			for (const m of kept.values()) clip(m);
		},
		/** the plane every material is cut along, if any */
		get plane() {
			return planes[0] ?? null;
		},
		dispose() {
			for (const m of kept.values()) {
				for (const k of MAPS) m[k]?.dispose?.();
				m.dispose();
			}
			kept.clear();
		}
	};
}
