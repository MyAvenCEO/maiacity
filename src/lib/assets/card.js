/*
 * AN ASSET'S CARD — what a world, a viewer or a film needs to know of an asset without building it: its name and
 * version, its real size and weight in triangles, its parts (the catalog its kit sealed), the sliders its solver reads.
 * Read off a built object, by the same code in the page and in the asset box, and always checked against the card's
 * schema (./schemas/card.v1.json) before it is used; the card a pack carries is this, plus its levels of detail and its
 * impostor once those are baked (phase 5).
 */
import * as THREE from 'three';
import { parseRef, refOf } from './refs.js';

/** @typedef {import('./groups.js').Item} Item @typedef {import('./groups.js').AnyVersion} AnyVersion */

const mm = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
/** the keys of `o` that are set, as a fresh plain object (a card holds no `undefined`) */
const set = (/** @type {Record<string, any>} */ o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** triangles drawn, each instance of an instanced mesh counted @param {THREE.Object3D} obj */
export function trianglesOf(obj) {
	let n = 0;
	obj.traverse((o) => {
		const m = /** @type {THREE.Mesh} */ (o);
		if (!m.isMesh || !m.geometry) return;
		const g = m.geometry;
		const count = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
		n += (count / 3) * (/** @type {THREE.InstancedMesh} */ (m).isInstancedMesh ? /** @type {THREE.InstancedMesh} */ (m).count : 1);
	});
	return Math.round(n);
}

/**
 * The card of a built asset.
 * @param {string} ref the ref it was built from (`machines/powercube@3`, `plants/apple`)
 * @param {THREE.Object3D} obj what its builder made
 * @param {{ item: Item, version: AnyVersion }} at its item and version as its group lists them
 */
export function cardOf(ref, obj, { item, version }) {
	const { group, id, variant } = parseRef(ref);
	const v = Array.isArray(version.build) ? version.build.find((x) => x.id === (variant ?? version.build[0]?.id)) : null;
	const box = new THREE.Box3().setFromObject(obj);
	const size = box.isEmpty() ? [0, 0, 0] : box.getSize(new THREE.Vector3()).toArray().map(mm);
	let skinned = false;
	obj.traverse((o) => (skinned ||= !!(/** @type {THREE.SkinnedMesh} */ (o).isSkinnedMesh)));
	const sealed = obj.userData.asset;
	const catalog = obj.userData.catalog ?? sealed?.catalog;
	const sliders = sealed?.lab?.controls;
	return set({
		format: 'asset-card',
		v: 1,
		ref: refOf(group, id, version.v, variant ?? (v ? v.id : undefined)),
		group,
		id,
		version: version.v,
		variant: variant ?? v?.id,
		label: v?.label ? `${item.label}: ${v.label}` : item.label,
		note: v?.note ?? version.note,
		size,
		triangles: trianglesOf(obj),
		skinned,
		catalog: catalog && plain(catalog),
		controls: sliders && Object.entries(sliders).map(([cid, c]) => set({ id: cid, label: c.label, min: c.min, max: c.max, value: c.value, step: c.step, unit: c.unit, digits: c.digits, ends: c.ends }))
	});
}

/** a catalog as data: its own fields, copied, so nothing of the object it came from rides along */
const plain = (/** @type {any} */ c) => JSON.parse(JSON.stringify(c));
