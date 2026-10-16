// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * FROM DATA TO OBJECTS — the page's side of the box: the plain data a box hands back (./serialize.js) checked, every
 * bit of it, and built into three.js objects by our own code. Nothing in it is run; anything out of shape or over a
 * budget is refused with the reason, so an asset can be no more than geometry, plain materials and pictures.
 *
 * It reads every format a frozen engine still in use hands back (./serialize.js): 0 from engine 1, each texture with
 * its own picture; 1 from engine 2, each picture once in `images`, named by the textures that show it; 2 from engine 3
 * on, and its controls as numbers (./bake.js), kept on the root's `userData.controls` for ../controls.js to play; 3
 * from engine 4 on, and what a viewer needs of it (`viewOf`, kept on the root's `userData.view`), a skinned actor
 * bound to its own bones, and each blend shape by its name.
 */
import * as THREE from 'three';
import { dualQuaternionSkinning } from '$lib/actors/dqs.ts';
import { FORMAT, MATERIALS } from './serialize.js';
import { MOVE_SAMPLES } from './view.js';

/**
 * what one asset may be at most (phase 0: generous; phase 1 sets them per LOD). A texture is only its settings and the
 * picture it names, so there may be one per material map; the pictures are what weigh (`images`, each at most
 * `texturePixels` a side; in format 0 each texture its own picture, so both counts hold for engine 1 as before).
 */
export const BUDGET = { nodes: 20000, geometries: 20000, materials: 2000, textures: 2000, images: 64, texturePixels: 4096, tris: 2_000_000, vertices: 4_000_000, instances: 100_000, controls: 32, controlNumbers: 8_000_000, bones: 1024 };

/** the formats it reads: engine 1's, engine 2's, engine 3's and the one ./serialize.js writes now */
export const FORMATS = [0, 1, 2, FORMAT];

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
	if (x.morph)
		for (const [name, list] of Object.entries(x.morph)) {
			if (!/^(position|normal|color)$/.test(name) || !Array.isArray(list) || !list.length) continue;
			g.morphAttributes[name] = list.slice(0, 64).map((a, k) => {
				const at = attribute(a, `geometry ${i} morph ${name} ${k}`);
				if (at.count !== count) fail(`geometry ${i} morph ${name} ${k} has ${at.count} items, not ${count}`);
				if (typeof a.name === 'string') at.name = a.name.slice(0, 40);
				return at;
			});
		}
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

/**
 * A picture the box handed over, drawn on a canvas of its size. WebGL uploads an ImageBitmap as it is and ignores a
 * texture's flipY for it, so every recipe's canvas came out upside down (a plant stake's flag, a knot in its wood); a
 * canvas it turns as the texture asks, as it did the recipe's own canvas.
 * @param {ImageBitmap} bitmap
 */
function onCanvas(bitmap) {
	const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(bitmap.width, bitmap.height) : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
	/** @type {any} */ (c.getContext('2d')).drawImage(bitmap, 0, 0);
	return c;
}

/** one picture, checked, as the source of every texture that shows it (uploaded once) */
function image(x, i) {
	if (!x || typeof x !== 'object') fail(`picture ${i} missing`);
	if (x.bitmap) {
		if (!(x.bitmap instanceof ImageBitmap)) fail(`picture ${i} is not a picture`);
		if (x.bitmap.width > BUDGET.texturePixels || x.bitmap.height > BUDGET.texturePixels) fail(`picture ${i} larger than ${BUDGET.texturePixels} px`);
		return { source: new THREE.Source(onCanvas(x.bitmap)), pixels: false };
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
	// it had a shader of its own in the box, which never crosses (the kit's section caps): our renderer gives it ours,
	// with the cut face it said it has (format 2)
	if (x.custom === true) m.userData.custom = true;
	if (x.custom === true && x.cap && typeof x.cap === 'object')
		m.userData.cap = { color: int(x.cap.color, 0x1000000, `material ${i} cap`), rough: Math.min(1, Math.max(0, num(x.cap.rough, 'cap'))), metal: Math.min(1, Math.max(0, num(x.cap.metal, 'cap'))) };
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
	/** @type {[THREE.SkinnedMesh, any, number][]} */
	const skins = [];
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
			} else if (data.format >= 3 && n.mesh.skin && k === 'mesh') {
				// a skinned mesh: bound to its bones once the whole tree stands
				o = new THREE.SkinnedMesh(g, m);
				skins.push([o, n.mesh.skin, i]);
				tris += (g.index?.count ?? g.attributes.position.count) / 3;
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
		} else o = data.format >= 3 && n.bone === true ? new THREE.Bone() : new THREE.Group();
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
	root.updateMatrixWorld(true);
	for (const [mesh, skin, i] of skins) bind(mesh, skin, i, objs);
	root.userData.ref = typeof data.ref === 'string' ? data.ref.slice(0, 200) : '';
	root.userData.stats = { tris: Math.round(tris), vertices };
	root.userData.controls = data.format >= 2 ? controlsOf(data.controls, objs, root) : [];
	if (data.format >= 3 && data.view != null) root.userData.view = viewOf(data.view, objs, data.controls?.length ? root.userData.controls : []);
	return root;
}

/**
 * A skinned mesh bound to its bones: bones that are bones of this tree, as many inverses as bones, each finite, and
 * no vertex weighted to a bone it does not have. One that bends by dual quaternions in the box does here (our
 * actors, $lib/actors/dqs.ts).
 */
function bind(mesh, skin, i, objs) {
	if (!skin || typeof skin !== 'object' || !Array.isArray(skin.bones)) fail(`node ${i} skin`);
	if (!skin.bones.length || skin.bones.length > BUDGET.bones) fail(`node ${i} skin: ${skin.bones.length} bones`);
	const bones = skin.bones.map((b) => {
		const o = objs[int(b, objs.length, `node ${i} skin bone`)];
		return o.isBone ? o : fail(`node ${i} skin: node ${b} is not a bone`);
	});
	const inv = typed(skin.inverses, `node ${i} skin inverses`);
	if (!(inv instanceof Float32Array) || inv.length !== bones.length * 16) fail(`node ${i} skin inverses`);
	finite(inv, `node ${i} skin inverses`);
	if (!Array.isArray(skin.bind) || skin.bind.length !== 16) fail(`node ${i} bind matrix`);
	skin.bind.forEach((v) => num(v, `node ${i} bind matrix`));
	const idx = mesh.geometry.attributes.skinIndex, w = mesh.geometry.attributes.skinWeight;
	if (!idx || !w || idx.itemSize !== 4 || w.itemSize !== 4) fail(`node ${i} skin weights`);
	for (let k = 0; k < idx.array.length; k++) if (idx.array[k] >= bones.length) fail(`node ${i} skin: a vertex rides a bone it does not have`);
	const inverses = bones.map((_, k) => new THREE.Matrix4().fromArray(inv, k * 16));
	mesh.bindMode = skin.mode === 'detached' ? 'detached' : 'attached';
	mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4().fromArray(skin.bind));
	// a pose can carry it far from where it rests
	mesh.frustumCulled = false;
	if (skin.dq === true) {
		dualQuaternionSkinning();
		mesh.userData.dq = true;
	}
}

const isText = (x, most) => typeof x === 'string' && x.length <= most;
const text = (x, most, what) => (x === undefined ? undefined : isText(x, most) ? x : fail(`${what}: not text`));
const point = (a, what) => (Array.isArray(a) && a.length === 3 ? a.map((v) => num(v, what)) : fail(`${what}: not a point`));
const keep = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** a small piece of plain data: numbers, text, true and false, lists and records of them, nested a little */
const plainData = (x, what, depth = 0, budget = { n: 4000 }) => {
	if (--budget.n < 0 || depth > 6) fail(`${what}: too much`);
	if (x === null || typeof x === 'boolean') return x;
	if (typeof x === 'number') return num(x, what);
	if (typeof x === 'string') return x.length <= 4000 ? x : fail(`${what}: text too long`);
	if (Array.isArray(x)) return x.map((v) => plainData(v, what, depth + 1, budget));
	if (typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype) {
		const out = {};
		for (const [k, v] of Object.entries(x)) {
			if (k.length > 64 || k === '__proto__' || k === 'constructor' || k === 'prototype') fail(`${what}: key`);
			out[k] = plainData(v, what, depth + 1, budget);
		}
		return out;
	}
	fail(`${what}: not plain data`);
};

/**
 * What a viewer needs of the build (./view.js), checked: every node it names is one of the tree's, every text short,
 * every number finite, every move's table as long as its sliders and steps call for; copied, nothing else kept.
 * @param {any} v @param {THREE.Object3D[]} objs @param {object[]} _controls
 */
function viewOf(v, objs, _controls) {
	if (typeof v !== 'object' || Array.isArray(v)) fail('view');
	const node = (k, what) => int(k, objs.length, `view ${what}`);
	const out = {};
	if (v.parts !== undefined) {
		if (!Array.isArray(v.parts) || v.parts.length > 4096) fail('view parts');
		out.parts = v.parts.map((p, i) => {
			const id = isText(p?.id, 80) && p.id ? p.id : fail(`view part ${i}: its id`);
			const n = node(p.node, `part ${id}`);
			let groups;
			if (p.groups !== undefined) {
				const count = objs[n].geometry?.groups?.length ?? 0;
				if (!Array.isArray(p.groups) || p.groups.length > 1024) fail(`view part ${id}: groups`);
				groups = p.groups.map((g) => int(g, count, `view part ${id} group`));
			}
			return keep({ id, node: n, unit: p.unit === true ? true : undefined, groups });
		});
	}
	if (v.labels !== undefined) {
		if (!Array.isArray(v.labels) || v.labels.length > 256) fail('view labels');
		out.labels = v.labels.map((L, i) => keep({ node: node(L?.node, `label ${i}`), at: point(L.at, `view label ${i}`), text: text(L.text, 80, `view label ${i}`) ?? '', side: L.side === 'left' || L.side === 'right' ? L.side : undefined, live: L.live === true ? true : undefined }));
	}
	if (v.shells !== undefined) {
		if (!Array.isArray(v.shells) || v.shells.length > 4096) fail('view shells');
		out.shells = v.shells.map((k) => node(k, 'shell'));
	}
	if (v.cut !== undefined) {
		const c = v.cut ?? fail('view cut');
		out.cut = keep({ a: c.a && point(c.a, 'view cut'), b: c.b && point(c.b, 'view cut'), center: c.center && point(c.center, 'view cut'), reach: c.reach === undefined ? undefined : num(c.reach, 'view cut'), offset: c.offset === undefined ? undefined : num(c.offset, 'view cut') });
	}
	if (v.size !== undefined) out.size = num(v.size, 'view size') > 0 ? v.size : fail('view size');
	if (v.lab !== undefined) {
		const L = v.lab ?? fail('view lab');
		out.lab = keep({
			hero: L.hero === undefined ? undefined : plainData(L.hero, 'view lab hero'),
			read: L.read === undefined ? undefined : plainData(L.read, 'view lab reading'),
			how: L.how === undefined ? undefined : plainData(L.how, 'view lab how'),
			breakIt: L.breakIt === undefined ? undefined : { label: text(L.breakIt?.label, 80, 'view lab break') ?? 'Break it' },
			moves: L.moves === undefined ? undefined : movesOf(L.moves)
		});
	}
	if (v.clips !== undefined) {
		const c = v.clips ?? fail('view clips');
		const names = (list, what) => (Array.isArray(list) && list.length <= 64 ? list.map((k) => (isText(k, 40) ? k : fail(`view ${what}`))) : fail(`view ${what}`));
		out.clips = keep({
			clips: names(c.clips ?? [], 'clips'),
			poses: names(c.poses ?? [], 'poses'),
			first: text(c.first, 40, 'view first clip'),
			held: c.held === undefined ? undefined : plainData(c.held, 'view poses', 0, { n: 20000 }),
			bones: c.bones === undefined ? undefined : Array.isArray(c.bones) && c.bones.length <= 512 ? c.bones.map((k) => (isText(k, 40) ? k : fail('view bones'))) : fail('view bones')
		});
	}
	out.ticks = v.ticks === true;
	if (v.roof !== undefined) {
		if (!Array.isArray(v.roof) || v.roof.length > 256) fail('view roof');
		out.roof = v.roof.map((k) => node(k, 'roof'));
	}
	if (v.walk !== undefined) {
		const w = v.walk ?? fail('view walk');
		const lamps = w.lamps === undefined ? [] : Array.isArray(w.lamps) && w.lamps.length <= 64 ? w.lamps.map((p) => point(p, 'view walk lamp')) : fail('view walk lamps');
		out.walk = { x: num(w.x, 'view walk'), z: num(w.z, 'view walk'), yaw: w.yaw === undefined ? 0 : num(w.yaw, 'view walk'), lamps };
	}
	if (v.note !== undefined) out.note = text(v.note, 200, 'view note');
	return out;
}

/** a machine's own moves, each its sliders and the table of their values at each step */
function movesOf(moves) {
	if (typeof moves !== 'object' || moves === null || Array.isArray(moves)) fail('view moves');
	const out = {};
	for (const [id, m] of Object.entries(moves).slice(0, 16)) {
		if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(id)) fail('view move: its name');
		if (!Array.isArray(m?.ids) || m.ids.length > 16) fail(`view move ${id}: its sliders`);
		const ids = m.ids.map((k) => (isText(k, 80) ? k : fail(`view move ${id}: a slider`)));
		const table = typed(m.table, `view move ${id}`);
		if (!(table instanceof Float32Array) || table.length !== MOVE_SAMPLES * ids.length) fail(`view move ${id}: its table`);
		finite(table, `view move ${id}`);
		out[id] = keep({ label: text(m.label, 80, `view move ${id}`) ?? id, seconds: num(m.seconds, `view move ${id}`) > 0 ? m.seconds : fail(`view move ${id}: seconds`), note: text(m.note, 200, `view move ${id}`), ids, table });
	}
	return out;
}

/**
 * Its controls, checked: each moves only nodes there are, with as many finite numbers as its samples call for, and
 * names them anew by their place in the walk of the tree as built here (each node before its children), which a copy
 * of the tree (`clone`) walks the same.
 */
function controlsOf(list, objs, root) {
	if (list == null) return [];
	if (!Array.isArray(list) || list.length > BUDGET.controls) fail('controls');
	const walked = new Map();
	root.traverse((o) => walked.set(o, walked.size));
	const seen = new Set();
	let numbers = 0;
	return list.map((c, i) => {
		const id = typeof c?.id === 'string' && /^[a-z][a-zA-Z0-9]{0,23}(\.[a-zA-Z0-9]{1,24})?$/.test(c.id) && !seen.has(c.id) ? c.id : fail(`control ${i}: its name`);
		seen.add(id);
		const S = int(c.samples, 130, `control ${id} samples`);
		if (S < 2) fail(`control ${id} samples`);
		const from = num(c.from, `control ${id} from`), to = num(c.to, `control ${id} to`), rest = num(c.rest, `control ${id} rest`);
		if (from === to || rest < Math.min(from, to) || rest > Math.max(from, to)) fail(`control ${id} range`);
		const nodes = typed(c.nodes, `control ${id} nodes`);
		if (!(nodes instanceof Uint32Array)) fail(`control ${id} nodes`);
		const m = nodes.length;
		const trs = typed(c.trs, `control ${id} places`);
		if (!(trs instanceof Float32Array) || trs.length !== S * m * 10) fail(`control ${id} places`);
		finite(trs, `control ${id} places`);
		const visible = typed(c.visible, `control ${id} showing`);
		if (!(visible instanceof Uint8Array) || visible.length !== S * m) fail(`control ${id} showing`);
		numbers += trs.length + visible.length;
		const node = (k, what) => objs[int(k, objs.length, `control ${id} ${what}`)];
		const morph = (Array.isArray(c.morph) ? c.morph : []).map((x) => {
			const o = node(x?.node, 'blend shapes');
			const w = typed(x.weights, `control ${id} blend shapes`);
			const k = o.morphTargetInfluences?.length ?? 0;
			if (!(w instanceof Float32Array) || !k || w.length !== S * k) fail(`control ${id} blend shapes`);
			finite(w, `control ${id} blend shapes`);
			numbers += w.length;
			return { node: walked.get(o), weights: w };
		});
		const instances = (Array.isArray(c.instances) ? c.instances : []).map((x) => {
			const o = node(x?.node, 'instances');
			const a = typed(x.matrices, `control ${id} instances`);
			if (!o.isInstancedMesh || !(a instanceof Float32Array) || a.length !== S * o.count * 16) fail(`control ${id} instances`);
			finite(a, `control ${id} instances`);
			numbers += a.length;
			return { node: walked.get(o), matrices: a };
		});
		if (numbers > BUDGET.controlNumbers) fail(`controls hold more than ${BUDGET.controlNumbers} numbers`);
		return { id, from, to, rest, samples: S, choice: c.choice === true, nodes: Uint32Array.from(nodes, (k) => walked.get(node(k, 'node'))), trs, visible, morph, instances };
	});
}
