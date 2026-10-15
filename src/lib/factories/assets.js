/*
 * OUR ASSETS ON THE LINE — a product stage of a factory drawn as one of our own assets, by its ref ($lib/assets:
 * `stages.pack = { shape: 'asset', ref: 'machines/batterypack@9' }`). The asset is built with `objectAt`, at its real
 * size, and turned into what the world's token meshes need: one geometry in its rest pose and one material, so every
 * pack on the belts, in a tester and on the outgoing pallets is one instance of the real BatteryPack.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { objectAt } from '$lib/assets';

/** @typedef {{ ref: string, geometry: THREE.BufferGeometry, material: THREE.Material, object: THREE.Object3D }} Token */

const KEEP = new Set(['position', 'normal', 'color', 'uv']);

/**
 * An asset as a token: built by its ref, every visible mesh of it in its rest pose merged into one geometry with vertex
 * colours (a rigged machine is one skinned mesh already; its skin weights are dropped, the token never moves a part),
 * and its first material. Throws as `objectAt` does when there is no such asset or it is not built as one object.
 * @param {string} ref
 * @returns {Promise<Token>}
 */
export async function tokenOf(ref) {
	const object = await objectAt(ref);
	object.updateMatrixWorld(true);
	/** @type {THREE.BufferGeometry[]} */
	const geos = [];
	/** @type {THREE.Material | undefined} */
	let material;
	const c = new THREE.Color();
	object.traverse((o) => {
		const m = /** @type {THREE.Mesh} */ (o);
		if (!m.isMesh || !m.visible) return;
		const g = m.geometry.clone();
		for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
		g.morphAttributes = {};
		const mat = /** @type {THREE.Material} */ (Array.isArray(m.material) ? m.material[0] : m.material);
		// a mesh coloured by its material alone: that colour on every vertex, so one material draws them all
		if (!g.attributes.color) {
			c.set(/** @type {THREE.MeshStandardMaterial} */ (mat).color ?? '#ffffff');
			const n = g.attributes.position.count, a = new Float32Array(n * 3);
			for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
			g.setAttribute('color', new THREE.BufferAttribute(a, 3));
		}
		g.applyMatrix4(m.matrixWorld);
		geos.push(g);
		material ??= mat;
	});
	if (!geos.length || !material) throw new Error(`${ref}: no mesh to draw it by`);
	const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
	if (!geometry) throw new Error(`${ref}: its meshes could not be merged into one`);
	geometry.computeBoundingSphere();
	const token = /** @type {THREE.Material} */ (material.clone());
	/** @type {any} */ (token).vertexColors = true;
	return { ref, geometry, material: token, object };
}
