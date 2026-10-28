// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * A BUILD, READY TO BE DRAWN MANY TIMES — one level of detail of an asset (a build the box made and the page rebuilt,
 * ../load.js) turned into the few drawings the renderer (./index.js) repeats for every copy of it in a world:
 *
 * - each shape and material it draws once becomes one, its own part's place in the asset baked into its corners, and
 *   all of them of one material are welded into one shape: a chair of forty parts in three materials is three
 *   drawings, not forty;
 * - a shape it draws many times (a bolt, a leaf, a fence post, or its own instances) stays one shape drawn at each of
 *   its places (`locals`), the copies of the asset times its copies of it;
 * - a part's materials become the renderer's own (./presets.js), one for all that are the same;
 * - a pose of blend shapes (a face's smile) is baked into its shape, as an asset stands still until its motion comes
 *   to the renderer (phase 6). Lines and points are left out and counted.
 *
 * And its measure: the box round it, the ball that holds it (how big it looks from afar, ./lod.js), how tall it stands
 * and how far it reaches out from its upright axis (its picture's frame, ./impostors.js).
 */
import * as THREE from 'three';

/** a draw's places: as many matrices as it is drawn in one copy of the asset */
/** @typedef {{ geometry: THREE.BufferGeometry, material: THREE.Material, locals: Float32Array, colors: Float32Array | null, n: number, cast: boolean, tris: number }} Draw */
/**
 * @typedef {{ draws: Draw[], tris: number, box: THREE.Box3, center: THREE.Vector3, radius: number, height: number,
 *   bottom: number, reach: number, colour: THREE.Color, left: { lines: number, points: number }, same?: boolean,
 *   made?: { error: number, passes: number[] } }} Level a level made from another by simplifying it (./lower.js) keeps
 *   that one's measure, and says how far it strays (`made.error`, m) and whether nothing was taken away (`same`)
 */

const IDENTITY = new THREE.Matrix4().toArray();

/** the attributes a shape has, as they must match to be welded */
const signatureOf = (g) =>
	Object.entries(g.attributes)
		.map(([k, a]) => `${k}:${a.itemSize}:${a.array.constructor.name}:${a.normalized ? 1 : 0}`)
		.sort()
		.join(',');

/** a shape's indices, made when it has none */
const indexOf = (g) => (g.index ? g.index.array : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i));

/** each corner's new number in the group being cut out, -1 for none: kept between groups, and only as big as needed */
let renumber = new Int32Array(0);

/**
 * The part of a shape one of its groups draws, as a shape of its own with only the corners it uses: a machine built
 * as one shape of half a million corners in two hundred materials is two hundred small shapes, not two hundred copies
 * of the whole (welded again by material below, they would be a hundred million corners).
 */
function groupOf(g, group) {
	const idx = indexOf(g);
	const end = Math.min(idx.length, group.start + group.count);
	const n = g.attributes.position.count;
	if (renumber.length < n) renumber = new Int32Array(n).fill(-1);
	/** the corners it uses, in the order they first come */
	const used = [];
	const index = new Uint32Array(Math.max(0, end - group.start));
	for (let t = group.start; t < end; t++) {
		const v = idx[t];
		if (renumber[v] < 0) renumber[v] = used.push(v) - 1;
		index[t - group.start] = renumber[v];
	}
	for (const v of used) renumber[v] = -1;
	const s = new THREE.BufferGeometry();
	for (const [k, a] of Object.entries(g.attributes)) {
		const size = a.itemSize;
		const to = new THREE.BufferAttribute(new a.array.constructor(used.length * size), size, a.normalized);
		if (a.isInterleavedBufferAttribute) used.forEach((v, i) => { for (let c = 0; c < size; c++) to.setComponent(i, c, a.getComponent(v, c)); });
		else used.forEach((v, i) => to.array.set(a.array.subarray(v * size, v * size + size), i * size));
		s.setAttribute(k, to);
	}
	s.setIndex(new THREE.BufferAttribute(index, 1));
	return s;
}

/** a shape with its blend shapes' pose baked in (none left), or itself when it has no pose */
function posed(g, weights) {
	const morph = g.morphAttributes?.position;
	if (!morph?.length || !weights?.some((w) => w)) return g;
	const s = new THREE.BufferGeometry();
	for (const [k, a] of Object.entries(g.attributes)) s.setAttribute(k, k === 'position' || k === 'normal' ? a.clone() : a);
	if (g.index) s.setIndex(g.index);
	for (const name of ['position', 'normal']) {
		const list = g.morphAttributes[name];
		const out = s.attributes[name];
		if (!list?.length || !out) continue;
		const base = g.attributes[name];
		for (let i = 0; i < out.count; i++)
			for (let c = 0; c < 3; c++) {
				let v = base.getComponent(i, c);
				list.forEach((m, j) => {
					const w = weights[j] ?? 0;
					if (w) v += w * (g.morphTargetsRelative ? m.getComponent(i, c) : m.getComponent(i, c) - base.getComponent(i, c));
				});
				out.setComponent(i, c, v);
			}
	}
	if (s.attributes.normal) s.attributes.normal.needsUpdate = true;
	return s;
}

const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3();

/** many shapes of one material and the same attributes, each at its place, welded into one */
function weld(list) {
	let vertices = 0, indices = 0;
	for (const { g } of list) {
		vertices += g.attributes.position.count;
		indices += indexOf(g).length;
	}
	const out = new THREE.BufferGeometry();
	const first = list[0].g;
	for (const [k, a] of Object.entries(first.attributes)) {
		const A = a.array.constructor;
		out.setAttribute(k, new THREE.BufferAttribute(new A(vertices * a.itemSize), a.itemSize, a.normalized));
	}
	const index = new Uint32Array(indices);
	let v0 = 0, i0 = 0;
	for (const { g, m } of list) {
		_m.fromArray(m);
		_n.getNormalMatrix(_m);
		const n = g.attributes.position.count;
		for (const [k, a] of Object.entries(g.attributes)) {
			const to = out.attributes[k];
			if (k === 'position' || k === 'normal' || (k === 'tangent' && a.itemSize >= 3)) {
				for (let i = 0; i < n; i++) {
					_v.set(a.getX(i), a.getY(i), a.getZ(i));
					if (k === 'position') _v.applyMatrix4(_m);
					else if (k === 'normal') _v.applyMatrix3(_n).normalize();
					else _v.transformDirection(_m);
					to.setXYZ(v0 + i, _v.x, _v.y, _v.z);
					if (a.itemSize === 4) to.setW(v0 + i, a.getW(i));
				}
			} else if (a.isInterleavedBufferAttribute) {
				for (let i = 0; i < n; i++) for (let c = 0; c < a.itemSize; c++) to.setComponent(v0 + i, c, a.getComponent(i, c));
			} else to.array.set(a.array.subarray(0, n * a.itemSize), (v0) * a.itemSize);
		}
		const idx = indexOf(g);
		// a part mirrored by its place (a negative scale) turns its faces inside out: turned back
		const flip = _m.determinant() < 0;
		for (let t = 0; t < idx.length; t += 3) {
			index[i0 + t] = idx[t] + v0;
			index[i0 + t + 1] = (flip ? idx[t + 2] : idx[t + 1]) + v0;
			index[i0 + t + 2] = (flip ? idx[t + 1] : idx[t + 2]) + v0;
		}
		v0 += n;
		i0 += idx.length;
	}
	out.setIndex(new THREE.BufferAttribute(index, 1));
	out.computeBoundingBox();
	out.computeBoundingSphere();
	return out;
}

/**
 * One level of an asset, from its built object, its materials made the renderer's (`presets.of`).
 * @param {THREE.Object3D} root a build as ../box/rebuild.js made it, at its real size, its foot at y = 0
 * @param {{ of: (m: THREE.Material) => THREE.Material }} presets
 * @returns {Level}
 */
export function prepare(root, presets) {
	root.updateMatrixWorld(true);
	/** the shapes it draws, by shape and material: each with every place it is drawn at */
	const by = new Map();
	const left = { lines: 0, points: 0 };
	const split = new Map();
	const poses = new Map();
	const add = (g, material, m, colour, cast) => {
		const mat = presets.of(material);
		const key = `${g.uuid}|${mat.uuid}`;
		let e = by.get(key);
		if (!e) by.set(key, (e = { g, material: mat, locals: [], colors: null, cast: false }));
		e.locals.push(m);
		if (colour) (e.colors ??= []).push(colour);
		else if (e.colors) e.colors.push([1, 1, 1]);
		e.cast ||= cast;
	};
	const visit = (o) => {
		if (!o.visible) return;
		if (o.isLine || o.isLineSegments) left.lines++;
		else if (o.isPoints) left.points++;
		else if (o.isMesh && o.geometry?.attributes?.position) {
			let g = o.geometry;
			if (o.morphTargetInfluences?.length) {
				const key = `${g.uuid}|${o.morphTargetInfluences.join(',')}`;
				if (!poses.has(key)) poses.set(key, posed(g, o.morphTargetInfluences));
				g = poses.get(key);
			}
			/** the places it is drawn at, and each one's own colour if it has one */
			const places = [];
			if (o.isInstancedMesh) {
				const im = o.instanceMatrix.array, ic = o.instanceColor?.array;
				for (let k = 0; k < o.count; k++) {
					const local = new THREE.Matrix4().fromArray(im, k * 16).premultiply(o.matrixWorld);
					places.push([local.toArray(), ic ? [ic[k * 3], ic[k * 3 + 1], ic[k * 3 + 2]] : null]);
				}
			} else places.push([o.matrixWorld.toArray(), null]);
			const mats = Array.isArray(o.material) ? o.material : null;
			for (const [m, colour] of places) {
				if (mats && g.groups.length) {
					g.groups.forEach((group, j) => {
						const material = mats[group.materialIndex ?? 0];
						if (!material) return;
						const key = `${g.uuid}|${j}`;
						if (!split.has(key)) split.set(key, groupOf(g, group));
						add(split.get(key), material, m, colour, o.castShadow);
					});
				} else add(g, mats ? mats[0] : o.material, m, colour, o.castShadow);
			}
		}
		for (const c of o.children) visit(c);
	};
	visit(root);

	// what is drawn once, of one material and the same attributes, welded into one; what is drawn many times, as it is
	/** @type {Draw[]} */
	const draws = [];
	const welds = new Map();
	for (const e of by.values()) {
		if (e.locals.length === 1 && !e.colors) {
			const key = `${e.material.uuid}|${signatureOf(e.g)}`;
			let w = welds.get(key);
			if (!w) welds.set(key, (w = { material: e.material, list: [], cast: false }));
			w.list.push({ g: e.g, m: e.locals[0] });
			w.cast ||= e.cast;
		} else {
			const locals = new Float32Array(e.locals.length * 16);
			e.locals.forEach((m, k) => locals.set(m, k * 16));
			draws.push(drawOf(e.g, e.material, locals, e.colors ? Float32Array.from(e.colors.flat()) : null, e.cast));
		}
	}
	for (const w of welds.values()) draws.push(drawOf(weld(w.list), w.material, Float32Array.from(IDENTITY), null, w.cast));

	// its measure, from every drawing at every place
	const box = new THREE.Box3();
	let reach = 0;
	const corner = new THREE.Vector3(), b = new THREE.Box3();
	for (const d of draws) {
		d.geometry.boundingBox ?? d.geometry.computeBoundingBox();
		for (let k = 0; k < d.n; k++) {
			_m.fromArray(d.locals, k * 16);
			b.copy(d.geometry.boundingBox).applyMatrix4(_m);
			box.union(b);
			for (let c = 0; c < 4; c++) {
				corner.set(c & 1 ? b.max.x : b.min.x, 0, c & 2 ? b.max.z : b.min.z);
				reach = Math.max(reach, Math.hypot(corner.x, corner.z));
			}
		}
	}
	if (box.isEmpty()) box.set(new THREE.Vector3(-0.05, 0, -0.05), new THREE.Vector3(0.05, 0.1, 0.05));
	const center = box.getCenter(new THREE.Vector3());
	const radius = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
	return { draws, tris: draws.reduce((a, d) => a + d.tris * d.n, 0), box, center, radius, height: box.max.y, bottom: box.min.y, reach: Math.max(reach, 0.05), colour: colourOf(draws), left };
}

/** @returns {Draw} */
function drawOf(geometry, material, locals, colors, cast) {
	if (!geometry.boundingBox) geometry.computeBoundingBox();
	if (!geometry.boundingSphere) geometry.computeBoundingSphere();
	const tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
	return { geometry, material, locals, colors, n: locals.length / 16, cast, tris };
}

/** the colour it reads as from afar, near enough: its materials' colours weighted by how much each draws */
function colourOf(draws) {
	const sum = new THREE.Color(0, 0, 0);
	let total = 0;
	const c = new THREE.Color();
	for (const d of draws) {
		c.copy(d.material.color ?? new THREE.Color(0.6, 0.6, 0.6));
		const vc = d.material.vertexColors && d.geometry.attributes.color;
		if (vc) {
			let r = 0, g = 0, b = 0;
			const step = Math.max(1, Math.floor(vc.count / 500));
			let n = 0;
			for (let i = 0; i < vc.count; i += step, n++) {
				r += vc.getX(i);
				g += vc.getY(i);
				b += vc.getZ(i);
			}
			if (n) c.multiply(new THREE.Color(r / n, g / n, b / n));
		}
		const w = d.tris * d.n;
		sum.r += c.r * w;
		sum.g += c.g * w;
		sum.b += c.b * w;
		total += w;
	}
	return total ? new THREE.Color(sum.r / total, sum.g / total, sum.b / total) : new THREE.Color(0.6, 0.6, 0.6);
}
