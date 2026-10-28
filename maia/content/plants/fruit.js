/*
 * ONE FRUIT — a fruit of a plant on its own, as the plants viewer shows it beside the whole plant: the plant grown with
 * its fruit gathered (`pickFruit`, each fruit as the plant drew it with `Bag.fruit`), one of them chosen by the seed id,
 * and hung by its stalk with its body straight down, the stalk at the origin.
 *
 * No two fruit are alike, so the seed also gives it its own small differences beyond those the plant drew: a little
 * bigger or smaller, longer or rounder, a little flattened, lopsided or bent, a lump or a dent; its colour a shade
 * lighter or darker, warmer or cooler, its sunny side a touch brighter. They grow from nothing at the stalk to their
 * full at the body, so the stalk stays a stalk; and they are the same at every stage, so a fruit tabbed from set to
 * ripe swells and colours as one fruit.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { about, between, chance, clamp, lite, material, pickFruit, smoothNormals } from './grow.js';

/** @typedef {import('./grow.js').Fruit} Fruit */

/** a fruit's size: the longest side of its bounds */
function sizeOf(/** @type {Fruit} */ f) {
	const b = new THREE.Box3();
	for (const p of f.parts) {
		p.geometry.computeBoundingBox();
		b.union(/** @type {THREE.Box3} */ (p.geometry.boundingBox));
	}
	const s = b.getSize(new THREE.Vector3());
	return Math.max(s.x, s.y, s.z);
}

/**
 * A plant grown from `seed` to its last stage, ripe, once for all the viewer needs of it then: the plant itself, the
 * fruit it bears and which of them the seed picks — one of the well-grown ones, not a straggler (`fruit` undefined if
 * it bears none).
 * @param {(g: number, seed: string) => THREE.Group} grow @param {number} last @param {string} seed
 * @returns {{ plant: THREE.Group, fruit: { keys: string[], pick: string } | undefined }}
 */
export function ripeOf(grow, last, seed) {
	const { plant, fruits } = pickFruit(() => grow(last, seed));
	return { plant, fruit: fruits.length ? pick(fruits, seed) : undefined };
}

/** of a plant's fruit, the well-grown ones, and the one the seed picks @param {Fruit[]} fruits @param {string} seed */
function pick(fruits, seed) {
	const sized = fruits.map((f) => ({ key: f.key, size: sizeOf(f) }));
	for (const f of fruits) for (const p of f.parts) p.geometry.dispose();
	const most = Math.max(...sized.map((f) => f.size));
	const good = sized.filter((f) => f.size >= most * 0.7);
	const r = chance(seed, 'one-fruit');
	return { keys: good.map((f) => f.key), pick: good[Math.floor(r() * good.length)].key };
}

/**
 * The fruit named `key` of the plant grown from `seed` at `g`, on its own: hanging from its stalk at the origin, its
 * own small differences given it by the seed. Undefined if it has not set yet at g.
 * @param {(g: number, seed: string) => THREE.Group} grow @param {number} g @param {string} seed @param {string} key
 * @returns {THREE.Group | undefined}
 */
export function oneFruit(grow, g, seed, key) {
	const { plant, fruits } = lite({ fruit: key }, () => pickFruit(() => grow(g, seed)));
	dispose(plant);
	const f = fruits.find((x) => x.key === key);
	for (const x of fruits) if (x !== f) for (const p of x.parts) p.geometry.dispose();
	if (!f) return undefined;
	// hung by its stalk: where it leaves the plant at the origin, its body straight down
	const hang = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(f.dir, new THREE.Vector3(0, -1, 0))).multiply(new THREE.Matrix4().makeTranslation(-f.at.x, -f.at.y, -f.at.z));
	for (const p of f.parts) p.geometry.applyMatrix4(hang);
	vary(f, chance(seed, 'one-fruit-shape', key));
	const group = new THREE.Group();
	/** @type {Record<string, THREE.BufferGeometry[]>} */
	const kinds = {};
	for (const p of f.parts) {
		(kinds[p.kind === 'prop' ? 'body' : p.kind] ??= []).push(p.geometry);
	}
	for (const [kind, list] of Object.entries(kinds)) {
		const merged = list.length === 1 ? list[0] : mergeGeometries(list);
		if (list.length > 1) for (const g of list) g.dispose();
		if (!merged) continue;
		const mesh = new THREE.Mesh(merged, material(/** @type {'body' | 'sheet' | 'gloss'} */ (kind)));
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		group.add(mesh);
	}
	return group;
}

/**
 * A fruit's own small differences, worked into its pieces where they hang (stalk at the origin, body down -y).
 * @param {Fruit} f @param {() => number} r
 */
function vary(f, r) {
	const box = new THREE.Box3();
	for (const p of f.parts) box.union(new THREE.Box3().setFromBufferAttribute(/** @type {THREE.BufferAttribute} */ (p.geometry.attributes.position)));
	const L = Math.max(1e-4, -box.min.y);
	const mid = box.getCenter(new THREE.Vector3());
	// its size, its length to its breadth, a little flattened one way
	const size = about(r, 1, 0.1);
	const long = about(r, 1, 0.08);
	const flat = about(r, 0, 0.06);
	// lopsided toward one side, bent, a lump or a dent
	const lop = between(r, 0, 0.07), lopAt = r() * Math.PI * 2;
	const bend = about(r, 0, 0.05), bendAt = r() * Math.PI * 2;
	const lump = about(r, 0, 0.05), lumpAt = r() * Math.PI * 2, lumpU = between(r, 0.3, 0.8);
	// its colour a shade off, its sunny side brighter
	const hue = about(r, 0, 0.012), sat = about(r, 0, 0.07), light = about(r, 0, 0.045), sunAt = r() * Math.PI * 2, sun = between(r, 0.02, 0.07);
	const p = new THREE.Vector3(), c = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
	for (const part of f.parts) {
		const pos = /** @type {THREE.BufferAttribute} */ (part.geometry.attributes.position);
		const col = /** @type {THREE.BufferAttribute | undefined} */ (part.geometry.attributes.color);
		for (let i = 0; i < pos.count; i++) {
			p.fromBufferAttribute(pos, i);
			const u = clamp(-p.y / L);
			// the stalk keeps its shape: the differences come in over the top of the fruit
			const w = clamp((u - 0.04) / 0.25);
			const x = p.x - mid.x, z = p.z - mid.z;
			const a = Math.atan2(z, x);
			const body = Math.sin(Math.PI * u);
			const k = 1 + w * (lop * Math.cos(a - lopAt) * body + lump * Math.exp(-Math.pow((u - lumpU) / 0.18, 2)) * Math.max(0, Math.cos(a - lumpAt)));
			const sx = (1 + w * flat) / Math.sqrt(lerp1(long, w));
			const sz = (1 - w * flat) / Math.sqrt(lerp1(long, w));
			const nx = mid.x + x * k * sx + w * bend * L * body * Math.cos(bendAt);
			const nz = mid.z + z * k * sz + w * bend * L * body * Math.sin(bendAt);
			const ny = p.y * lerp1(long, w);
			pos.setXYZ(i, nx * size, ny * size, nz * size);
			if (col && w > 0) {
				c.fromBufferAttribute(col, i);
				c.getHSL(hsl);
				const lit = sun * Math.max(0, Math.cos(a - sunAt)) * body;
				c.setHSL((hsl.h + hue * w + 1) % 1, clamp(hsl.s * (1 + sat * w)), clamp(hsl.l * (1 + light * w) + lit * w));
				col.setXYZ(i, c.r, c.g, c.b);
			}
		}
		pos.needsUpdate = true;
		if (col) col.needsUpdate = true;
		// its normals anew for its new shape, smooth across a tube's seam — but a leaf (a sheet) keeps its own
		if (part.kind !== 'sheet') smoothNormals(part.geometry);
		else part.geometry.computeVertexNormals();
	}
}
/** a factor that comes in from 1 as w goes 0 … 1 */
const lerp1 = (/** @type {number} */ x, /** @type {number} */ w) => 1 + (x - 1) * w;

const dispose = (/** @type {THREE.Object3D} */ o) => o.traverse((m) => /** @type {THREE.Mesh} */ (m).geometry?.dispose());
