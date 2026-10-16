// @ts-nocheck — plain JS, runs inside the box
/*
 * AN OBJECT AS PLAIN DATA — what leaves the box: a built asset (a three.js object tree) turned into numbers, typed
 * arrays and pictures that can cross into the page (structured clone, the arrays and pictures moved, not copied). No
 * function, no class, no shader code goes out: a material is its kind and its plain settings, a texture its settings
 * and the picture it shows. The page (./rebuild.js) checks every bit of it and builds its own three.js objects from it.
 *
 * Format 0 (engine 1): each texture carried its own pixels, so a picture shared by many textures (the kit's, one per
 * material for its own tiling) went out once for each. Format 1 (engine 2): each picture goes out once, in `images`,
 * and a texture names the one it shows (`image`). Format 2 (engine 3): and its controls, played and written down in
 * the box (./bake.js), each naming the parts it moves by their place in the walk of the tree (each node before its
 * children, the order `nodes` is in); and a material with the kit's section caps says how its cut face looks (`cap`:
 * its colour, roughness and metalness, as the kit gave them), where its shader code, which stays, drew it.
 * Format 3 (engine 4): what a viewer needs of it (`view`, ./view.js: its parts, labels, shells, cut, solver, clips);
 * a skinned mesh with its skin (`skin`: its bones by their nodes, their inverses, its bind matrix, whether it bends by
 * dual quaternions, as our actors do), each bone node marked (`bone`), and each blend shape's name.
 */
import { ShaderChunk } from 'three';

export const FORMAT = 3;

/** the material settings that go out as they are (numbers, booleans, colours) */
const PLAIN = ['roughness', 'metalness', 'opacity', 'transparent', 'side', 'vertexColors', 'flatShading', 'alphaTest', 'depthWrite', 'depthTest', 'transmission', 'ior', 'thickness', 'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'envMapIntensity', 'emissiveIntensity', 'bumpScale', 'wireframe', 'size', 'sizeAttenuation', 'linewidth', 'shininess', 'specularIntensity', 'iridescence', 'anisotropy', 'dispersion', 'aoMapIntensity', 'lightMapIntensity', 'displacementScale', 'displacementBias', 'toneMapped', 'fog'];
const COLORS = ['color', 'emissive', 'sheenColor', 'specularColor', 'attenuationColor', 'specular'];
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'bumpMap', 'emissiveMap', 'aoMap', 'clearcoatNormalMap', 'displacementMap'];
export const MATERIALS = ['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial', 'LineBasicMaterial', 'LineDashedMaterial', 'PointsMaterial', 'MeshMatcapMaterial', 'ShadowMaterial'];

/**
 * How a material's cut face looks, as the kit's section caps gave it (../kit.js `capPatch`: its colour on
 * `userData.capColor`, its roughness and metalness only in the shader code it adds, so that code is asked for them on a
 * shader of nothing); null for a material without.
 */
function capOf(m) {
	const sh = { uniforms: {}, vertexShader: '', fragmentShader: '', defines: {} };
	try {
		m.onBeforeCompile(sh, null);
	} catch {
		// its code wanted a real shader: its colour alone, if it has one
	}
	const color = sh.uniforms.uCapColor?.value?.isColor ? sh.uniforms.uCapColor.value : m.userData?.capColor?.isColor ? m.userData.capColor : null;
	if (!color) return null;
	const unit = (v, or) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : or);
	return { color: color.getHex(), rough: unit(sh.uniforms.uCapRough?.value, 0.55), metal: unit(sh.uniforms.uCapMetal?.value, 0) };
}

/** whether this engine's skinned meshes bend by dual quaternions ($lib/actors/dqs.ts puts its code in three's chunks) */
const dualQuaternions = () => /dqQuat/.test(ShaderChunk.skinning_pars_vertex ?? '');

/**
 * @param {import('three').Object3D} root
 * @param {{ controls?: object[], view?: object }} [o] its controls, as ./bake.js wrote them down, and its view (./view.js)
 * @returns {Promise<{ data: object, transfer: Transferable[] }>}
 */
export async function serialize(root, { controls = [], view } = {}) {
	root.updateMatrixWorld(true);
	const nodes = [];
	const geometries = [];
	const materials = [];
	const textures = [];
	const images = [];
	const geoAt = new Map();
	const matAt = new Map();
	const texAt = new Map();
	const imageAt = new Map();
	const buffers = new Set();
	const pending = [];
	const stats = { tris: 0, custom: 0, skinned: 0 };

	const array = (a) => {
		buffers.add(a.buffer);
		return a;
	};
	const attribute = (attr) => {
		if (attr.isInterleavedBufferAttribute) {
			const out = new Float32Array(attr.count * attr.itemSize);
			for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
			return { array: array(out), itemSize: attr.itemSize, normalized: attr.normalized };
		}
		return { array: array(attr.array), itemSize: attr.itemSize, normalized: attr.normalized };
	};
	const geometry = (g) => {
		if (geoAt.has(g)) return geoAt.get(g);
		const attributes = {};
		for (const [name, attr] of Object.entries(g.attributes)) attributes[name] = attribute(attr);
		const morph = {};
		for (const [name, list] of Object.entries(g.morphAttributes ?? {})) morph[name] = list.map((a) => ({ ...attribute(a), ...(a.name && { name: String(a.name).slice(0, 40) }) }));
		geometries.push({ attributes, morph, morphRelative: !!g.morphTargetsRelative, index: g.index ? array(g.index.array) : null, groups: g.groups.map((x) => ({ start: x.start, count: x.count, materialIndex: x.materialIndex ?? 0 })) });
		geoAt.set(g, geometries.length - 1);
		return geometries.length - 1;
	};
	// a picture, once however many textures show it (a clone of a texture shares its source); null for none
	const image = (t) => {
		const key = t.source ?? t.image;
		if (imageAt.has(key)) return imageAt.get(key);
		const img = t.image;
		let i = null;
		if (img?.data && img.width && img.height) {
			i = images.push({ pixels: { data: array(new Uint8Array(img.data.buffer.slice(0))), width: img.width, height: img.height } }) - 1;
		} else if (img && img.width && img.height && typeof createImageBitmap === 'function') {
			const plain = {};
			i = images.push(plain) - 1;
			pending.push(createImageBitmap(img).then((b) => (plain.bitmap = b)));
		}
		imageAt.set(key, i);
		return i;
	};
	const texture = (t) => {
		if (texAt.has(t)) return texAt.get(t);
		const i = textures.length;
		textures.push({ image: image(t), wrapS: t.wrapS, wrapT: t.wrapT, repeat: [t.repeat.x, t.repeat.y], offset: [t.offset.x, t.offset.y], rotation: t.rotation, colorSpace: t.colorSpace, flipY: t.flipY, anisotropy: t.anisotropy });
		texAt.set(t, i);
		return i;
	};
	const material = (m) => {
		if (matAt.has(m)) return matAt.get(m);
		const type = MATERIALS.includes(m.type) ? m.type : 'MeshStandardMaterial';
		const custom = !MATERIALS.includes(m.type) || (m.onBeforeCompile && m.onBeforeCompile.toString() !== m.constructor.prototype.onBeforeCompile?.toString());
		if (custom) stats.custom++;
		const params = {};
		for (const k of PLAIN) if (k in m && (typeof m[k] === 'number' || typeof m[k] === 'boolean')) params[k] = m[k];
		for (const k of COLORS) if (m[k]?.isColor) params[k] = m[k].getHex(); else if (Array.isArray(m.uniforms?.[k]?.value)) params[k] = m.uniforms[k].value;
		if (type !== 'MeshStandardMaterial' || !m.isShaderMaterial) for (const k of MAPS) if (m[k]?.isTexture) params[k] = texture(m[k]);
		if (m.normalScale?.isVector2) params.normalScale = [m.normalScale.x, m.normalScale.y];
		const cap = custom ? capOf(m) : null;
		materials.push({ type, params, name: m.name, custom: !!custom, ...(cap && { cap }) });
		matAt.set(m, materials.length - 1);
		return materials.length - 1;
	};
	const nodeAt = new Map();
	const skins = [];
	const visit = (o) => {
		const i = nodes.length;
		const n = { name: o.name, matrix: o.matrix.toArray(), visible: o.visible, children: [] };
		if (o.isBone) n.bone = true;
		nodes.push(n);
		nodeAt.set(o, i);
		if ((o.isMesh || o.isLine || o.isPoints) && o.geometry) {
			const g = geometry(o.geometry);
			const mats = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
			n.mesh = { geometry: g, material: mats, kind: o.isPoints ? 'points' : o.isLineSegments ? 'lineSegments' : o.isLine ? 'line' : 'mesh', castShadow: o.castShadow, receiveShadow: o.receiveShadow };
			if (o.morphTargetInfluences) n.mesh.morph = [...o.morphTargetInfluences];
			if (o.isSkinnedMesh) {
				stats.skinned++;
				if (o.skeleton) skins.push([n, o]);
			}
			const idx = o.geometry.index ? o.geometry.index.count : (o.geometry.attributes.position?.count ?? 0);
			const count = o.isInstancedMesh ? o.count : 1;
			if (o.isInstancedMesh) n.mesh.instances = { count: o.count, matrices: array(o.instanceMatrix.array), colors: o.instanceColor ? array(o.instanceColor.array) : null };
			if (!o.isLine && !o.isPoints) stats.tris += (idx / 3) * count;
		}
		for (const c of o.children) n.children.push(visit(c));
		return i;
	};
	visit(root);
	// a skin names its bones by their nodes, once the whole tree is walked (its bones hang under it, or anywhere)
	for (const [n, o] of skins) {
		const bones = o.skeleton.bones.map((b) => nodeAt.get(b));
		if (bones.some((b) => b === undefined)) continue;
		const inverses = new Float32Array(bones.length * 16);
		o.skeleton.boneInverses.forEach((m, k) => inverses.set(m.elements, k * 16));
		n.mesh.skin = { bones, inverses: array(inverses), bind: o.bindMatrix.toArray(), mode: o.bindMode === 'detached' ? 'detached' : 'attached', dq: dualQuaternions() };
	}
	for (const c of controls) {
		for (const a of [c.nodes, c.trs, c.visible]) array(a);
		for (const x of c.morph) array(x.weights);
		for (const x of c.instances) array(x.matrices);
	}
	await Promise.all(pending);
	stats.tris = Math.round(stats.tris);
	const transfer = [...buffers, ...images.flatMap((x) => (x.bitmap ? [x.bitmap] : []))];
	for (const m of Object.values(view?.lab?.moves ?? {})) array(m.table);
	return { data: { format: FORMAT, ref: root.userData.ref ?? '', nodes, geometries, materials, textures, images, controls, ...(view && { view }), stats }, transfer };
}
