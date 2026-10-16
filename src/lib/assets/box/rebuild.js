// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * FROM DATA TO OBJECTS — the page's side of the box: the plain data a box hands back (./serialize.js) checked, every
 * bit of it, and built into three.js objects by our own code. Nothing in it is run; anything out of shape or over a
 * budget is refused with the reason, so an asset can be no more than geometry, plain materials and pictures.
 *
 * It reads every format a frozen engine still in use hands back (./serialize.js): 0 from engine 1, each texture with
 * its own picture; 1 from engine 2 on, each picture once in `images`, named by the textures that show it.
 */
import * as THREE from 'three';
import { FORMAT, MATERIALS } from './serialize.js';

/**
 * what one asset may be at most (phase 0: generous; phase 1 sets them per LOD). A texture is only its settings and the
 * picture it names, so there may be one per material map; the pictures are what weigh (`images`, each at most
 * `texturePixels` a side; in format 0 each texture its own picture, so both counts hold for engine 1 as before).
 */
export const BUDGET = { nodes: 20000, geometries: 20000, materials: 2000, textures: 2000, images: 64, texturePixels: 4096, tris: 2_000_000, vertices: 4_000_000, instances: 100_000 };

/** the formats it reads: engine 1's and the one ./serialize.js writes now */
export const FORMATS = [0, FORMAT];

const ARRAYS = [Float32Array, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array];
const fail = (why) => {
	throw new Error(`refused: ${why}`);
};
const finite = (a, what) => {
	for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) fail(`${what} has a value that is not a number`);
};
const int = (x, max, what) => (Number.isInteger(x) && x >= 0 && x < max ? x : fail(`${what} out of range`));
const num = (x, what) => (typeof x === 'number' && Number.isFinite(x) ? x : fail(`${what} is not a number`));

/** a typed array of a kind we know, and only that */
const typed = (a, what) => (ARRAYS.some((T) => a instanceof T) ? a : fail(`${what} is not a typed array`));

function attribute(x, what) {
	if (!x || typeof x !== 'object') fail(`${what} missing`);
	const array = typed(x.array, what);
	const itemSize = int(x.itemSize, 17, `${what} item size`) || fail(`${what} item size 0`);
	if (array.length % itemSize) fail(`${what} length`);
	if (array instanceof Float32Array) finite(array, what);
	return new THREE.BufferAttribute(array, itemSize, !!x.normalized);
}

function geometry(x, i) {
	const g = new THREE.BufferGeometry();
	const pos = x.attributes?.position ?? fail(`geometry ${i} has no positions`);
	for (const [name, a] of Object.entries(x.attributes)) {
		if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(name)) fail(`geometry ${i}: attribute name`);
		g.setAttribute(name, attribute(a, `geometry ${i} ${name}`));
	}
	const count = g.attributes.position.count;
	for (const [name, a] of Object.entries(g.attributes)) if (a.count !== count) fail(`geometry ${i}: ${name} has ${a.count} items, not ${count}`);
	if (x.morph) for (const [name, list] of Object.entries(x.morph)) if (Array.isArray(list) && list.length) g.morphAttributes[name] = list.slice(0, 64).map((a, k) => attribute(a, `geometry ${i} morph ${name} ${k}`));
	g.morphTargetsRelative = !!x.morphRelative;
	if (x.index) {
		const idx = typed(x.index, `geometry ${i} index`);
		if (!(idx instanceof Uint16Array || idx instanceof Uint32Array)) fail(`geometry ${i} index kind`);
		for (let k = 0; k < idx.length; k++) if (idx[k] >= count) fail(`geometry ${i} index past its vertices`);
		g.setIndex(new THREE.BufferAttribute(idx, 1));
	}
	for (const gr of x.groups ?? []) g.addGroup(int(gr.start, 1e9, 'group start'), int(gr.count, 1e9, 'group count'), int(gr.materialIndex, 1e4, 'group material'));
	void pos;
	return g;
}

/** one picture, checked, as the source of every texture that shows it (uploaded once) */
function image(x, i) {
	if (!x || typeof x !== 'object') fail(`picture ${i} missing`);
	if (x.bitmap) {
		if (!(x.bitmap instanceof ImageBitmap)) fail(`picture ${i} is not a picture`);
		if (x.bitmap.width > BUDGET.texturePixels || x.bitmap.height > BUDGET.texturePixels) fail(`picture ${i} larger than ${BUDGET.texturePixels} px`);
		return { source: new THREE.Source(x.bitmap), pixels: false };
	}
	if (x.pixels) {
		const { data, width, height } = x.pixels;
		int(width, BUDGET.texturePixels + 1, 'picture width');
		int(height, BUDGET.texturePixels + 1, 'picture height');
		if (!(data instanceof Uint8Array) || data.length !== width * height * 4) fail(`picture ${i} pixels`);
		return { source: new THREE.Source({ data, width, height }), pixels: true };
	}
	return null;
}

function texture(x, i, images) {
	const img = x.image == null ? null : images[int(x.image, images.length, `texture ${i} picture`)];
	let t;
	if (img?.pixels) {
		t = new THREE.DataTexture();
		t.source = img.source;
	} else if (img) {
		t = new THREE.Texture();
		t.source = img.source;
	} else t = new THREE.Texture();
	t.wrapS = [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping].includes(x.wrapS) ? x.wrapS : THREE.ClampToEdgeWrapping;
	t.wrapT = [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping].includes(x.wrapT) ? x.wrapT : THREE.ClampToEdgeWrapping;
	if (Array.isArray(x.repeat)) t.repeat.set(num(x.repeat[0], 'repeat'), num(x.repeat[1], 'repeat'));
	if (Array.isArray(x.offset)) t.offset.set(num(x.offset[0], 'offset'), num(x.offset[1], 'offset'));
	t.rotation = typeof x.rotation === 'number' ? num(x.rotation, 'rotation') : 0;
	t.colorSpace = x.colorSpace === THREE.SRGBColorSpace ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	t.flipY = x.flipY !== false && !img?.pixels;
	t.anisotropy = Math.min(16, Math.max(1, Number(x.anisotropy) || 1));
	t.needsUpdate = true;
	return t;
}

function material(x, i, textures) {
	if (!MATERIALS.includes(x.type)) fail(`material ${i}: no kind ${String(x.type).slice(0, 40)}`);
	const m = new THREE[x.type]();
	for (const [k, v] of Object.entries(x.params ?? {})) {
		if (!(k in m) || typeof m[k] === 'function') continue;
		if (m[k]?.isColor) m[k].setHex(int(v, 0x1000000, `material ${i} ${k}`));
		else if (m[k] === null || m[k]?.isTexture) m[k] = textures[int(v, textures.length, `material ${i} ${k}`)];
		else if (m[k]?.isVector2 && Array.isArray(v)) m[k].set(num(v[0], k), num(v[1], k));
		else if (typeof m[k] === typeof v && (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean')) m[k] = v;
	}
	m.name = String(x.name ?? '').slice(0, 80);
	// it had a shader of its own in the box, which never crosses (the kit's section caps): our renderer gives it ours
	if (x.custom === true) m.userData.custom = true;
	return m;
}

/**
 * The data a box handed back, checked and built.
 * @param {any} data
 * @returns {THREE.Object3D}
 */
export function rebuild(data) {
	if (!data || !FORMATS.includes(data.format)) fail('not box data of a format we read');
	const { nodes, geometries, materials, textures } = data;
	if (![nodes, geometries, materials, textures].every(Array.isArray)) fail('missing lists');
	// format 0: each texture its own picture, as format 1 would name it
	const listed = data.format === 0 ? textures.map((t) => (t?.bitmap || t?.pixels ? { bitmap: t.bitmap, pixels: t.pixels } : null)) : data.images;
	if (!Array.isArray(listed)) fail('missing lists');
	const counts = { nodes: nodes.length, geometries: geometries.length, materials: materials.length, textures: textures.length, images: data.format === 0 ? textures.length : listed.length };
	for (const [what, n] of Object.entries(counts)) if (n > BUDGET[what]) fail(`${n} ${what}, more than ${BUDGET[what]}`);
	const images = listed.map((x, i) => (data.format === 0 && x === null ? null : image(x, i)));
	const tex = textures.map((t, i) => texture(data.format === 0 ? { ...t, image: images[i] ? i : null } : t, i, images));
	const mats = materials.map((x, i) => material(x, i, tex));
	const geos = geometries.map(geometry);
	let vertices = 0;
	for (const g of geos) vertices += g.attributes.position.count;
	if (vertices > BUDGET.vertices) fail(`${vertices} vertices, more than ${BUDGET.vertices}`);
	let tris = 0;
	const objs = nodes.map((n, i) => {
		let o;
		if (n.mesh) {
			const g = geos[int(n.mesh.geometry, geos.length, `node ${i} geometry`)];
			const m = Array.isArray(n.mesh.material) ? n.mesh.material.map((k) => mats[int(k, mats.length, `node ${i} material`)]) : mats[int(n.mesh.material, mats.length, `node ${i} material`)];
			const k = n.mesh.kind;
			if (n.mesh.instances) {
				const count = int(n.mesh.instances.count, BUDGET.instances + 1, 'instances');
				const im = typed(n.mesh.instances.matrices, 'instance matrices');
				if (!(im instanceof Float32Array) || im.length < count * 16) fail('instance matrices');
				finite(im, 'instance matrices');
				o = new THREE.InstancedMesh(g, m, count);
				o.instanceMatrix.array.set(im.subarray(0, count * 16));
				const ic = n.mesh.instances.colors;
				if (ic && ic instanceof Float32Array && ic.length >= count * 3) o.instanceColor = new THREE.InstancedBufferAttribute(ic.subarray(0, count * 3), 3);
				tris += ((g.index?.count ?? g.attributes.position.count) / 3) * count;
			} else {
				o = k === 'points' ? new THREE.Points(g, m) : k === 'lineSegments' ? new THREE.LineSegments(g, m) : k === 'line' ? new THREE.Line(g, m) : new THREE.Mesh(g, m);
				if (o.isMesh) tris += (g.index?.count ?? g.attributes.position.count) / 3;
			}
			o.castShadow = !!n.mesh.castShadow;
			o.receiveShadow = !!n.mesh.receiveShadow;
			if (Array.isArray(n.mesh.morph) && o.isMesh) {
				o.updateMorphTargets();
				n.mesh.morph.slice(0, o.morphTargetInfluences?.length ?? 0).forEach((w, j) => (o.morphTargetInfluences[j] = num(w, 'morph weight')));
			}
		} else o = new THREE.Group();
		o.name = String(n.name ?? '').slice(0, 120);
		if (!Array.isArray(n.matrix) || n.matrix.length !== 16) fail(`node ${i} matrix`);
		n.matrix.forEach((v) => num(v, `node ${i} matrix`));
		o.matrix.fromArray(n.matrix);
		o.matrix.decompose(o.position, o.quaternion, o.scale);
		o.visible = n.visible !== false;
		return o;
	});
	if (tris > BUDGET.tris) fail(`${Math.round(tris)} triangles, more than ${BUDGET.tris}`);
	// a tree: every node but the first has exactly one parent, and nothing hangs from itself
	const parent = new Int32Array(nodes.length).fill(-1);
	nodes.forEach((n, i) => {
		if (!Array.isArray(n.children)) fail(`node ${i} children`);
		for (const c of n.children) {
			int(c, nodes.length, `node ${i} child`);
			if (c === 0 || parent[c] !== -1 || c === i) fail('nodes are not a tree');
			parent[c] = i;
			objs[i].add(objs[c]);
		}
	});
	for (let i = 1; i < nodes.length; i++) if (parent[i] === -1) fail(`node ${i} hangs from nothing`);
	const root = objs[0];
	root.userData.ref = typeof data.ref === 'string' ? data.ref.slice(0, 200) : '';
	root.userData.stats = { tris: Math.round(tris), vertices };
	return root;
}
