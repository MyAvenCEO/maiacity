/*
 * A BIOME'S COVER, STREAMED — a biome's floor is dense where it is full (six or ten plants to a square metre inside a
 * carpet of them), too dense to lay out over a whole world at once. So it is laid out in small tiles round the eye as
 * it goes: each tile worked out from its place alone (the same tile, the same plants, every time it is built), a tile
 * or two a frame so walking never stutters, and the tiles left behind let go.
 *
 * It is drawn as one instanced mesh a kind for all the tiles together (a handful of draw calls however many tiles),
 * and it fades with distance rather than ending: every plant has a rank (0…1, drawn when it is placed), near the eye
 * all of them stand, further off fewer and fewer (`thin`), and each one grows up out of the ground or sinks back into
 * it as the eye comes and goes — on the graphics card, every frame, so nothing pops and the cover has no edge. The
 * tiles are built beyond where the cover shows, so a new one is never seen arriving.
 *
 * `coverStream({ recipe, open })` → `{ object, update(x, z), rebuild(recipe, hidden) }`: add `object` to the scene,
 * call `update` with where the eye is every frame.
 *
 * `coverLaid(recipe, { eye })` is the same cover seen from an eye that stays where it is (the Biomes explorer's), as
 * places only: every plant the stream would draw there, each scaled as far as it grows there, for a page that draws
 * the kinds itself (the universal renderer, each kind built in the box: ./built.js). `coverTile` is one tile of it, as
 * both lay it out.
 */
import * as THREE from 'three';
import { coverAt, coverOf } from './index.js';
import { rng } from './noise.js';

/**
 * @param {{
 *   recipe: import('./index.js').Recipe,
 *   open?: (x: number, z: number) => boolean,
 *   tile?: number, reach?: number, near?: number, thin?: number, perFrame?: number, seed?: number, shadows?: boolean,
 *   hidden?: Set<number>, density?: number, origin?: [number, number]
 * }} o
 *   recipe: the biome; open: whether cover may stand at x, z (not on a path, in the water, in a trunk…); tile: a tile's
 *   size (m); reach: how far from the eye it is drawn (m); near: how far every plant of it stands, beyond which it
 *   thins out; thin: how much of it is left at its reach (0…1); perFrame: how many tiles may be built a frame;
 *   density: the biome's, if it should be other (fewer on a slow device); origin: where this ground's 0, 0 lies in
 *   the world (for a dome's floor laid in its own ground), so its colonies stand on the surfaces its ground is painted with
 */
export function coverStream(o) {
	const tile = o.tile ?? 12, reach = o.reach ?? 30, perFrame = o.perFrame ?? 1, seed = o.seed ?? 1, shadows = o.shadows ?? false;
	const near = o.near ?? Math.min(10, reach * 0.4), thin = o.thin ?? 0.3;
	const [ox, oz] = o.origin ?? [0, 0];
	const object = new THREE.Group();
	object.name = 'biome cover';
	let recipe = o.recipe, hidden = o.hidden ?? new Set();
	/** where the eye is, for the fading on the graphics card (in this ground's own metres) */
	const eye = { value: new THREE.Vector2(Infinity, Infinity) };
	const uniforms = { bEye: eye, bNear: { value: near }, bReach: { value: reach }, bThin: { value: thin } };
	/** how much of the cover stands at distance d: all of it near, `thin` of it at the reach (the same sum as the shader's) */
	const keep = (/** @type {number} */ d) => (d <= near ? 1 : 1 - (1 - thin) * Math.min(1, (d - near) / Math.max(1e-3, reach - near)));
	/** each kind's meshes (one InstancedMesh per part, sharing the kind's instances) */
	let kinds = kindsOf(recipe, uniforms, shadows, object);
	/** @type {Map<string, { ix: number, iz: number, kinds: TileKinds }>} */
	const tiles = new Map();
	/** @param {number} ix @param {number} iz @returns {TileKinds} */
	const build = (ix, iz) => coverTile(recipe, ix, iz, { tile, seed, density: o.density, open: o.open, origin: [ox, oz], hidden });
	/** the tiles' plants gathered into each kind's instances, as many of each tile as stand at its distance */
	let gathered = { x: Infinity, z: Infinity }, changed = true;
	const gather = (/** @type {number} */ x, /** @type {number} */ z) => {
		gathered = { x, z };
		changed = false;
		const list = [...tiles.values()].map((t) => {
			// the tile's nearest point to the eye, a little nearer still: the eye moves on before the next gathering
			const dx = Math.max(t.ix * tile - x, 0, x - (t.ix + 1) * tile), dz = Math.max(t.iz * tile - z, 0, z - (t.iz + 1) * tile);
			const d = Math.hypot(dx, dz) - 3;
			return { t, k: d > reach ? 0 : keep(Math.max(0, d)) };
		});
		kinds.forEach((kind, k) => {
			let n = 0;
			const counts = list.map(({ t, k: kk }) => {
				const tk = /** @type {TileKinds[number]} */ (t.kinds[k]);
				if (kk <= 0 || !tk) return 0;
				// the plants of a tile ranked under what is kept there: they are sorted, so the first so many
				let lo = 0, hi = tk.rank.length;
				while (lo < hi) {
					const mid = (lo + hi) >> 1;
					if (/** @type {number} */ (tk.rank[mid]) < kk + 0.02) lo = mid + 1;
					else hi = mid;
				}
				n += lo;
				return lo;
			});
			kind.fit(n);
			const M = /** @type {Float32Array} */ (kind.matrix.array), R = /** @type {Float32Array} */ (kind.rank.array);
			let at = 0;
			list.forEach(({ t }, i) => {
				const c = /** @type {number} */ (counts[i]);
				if (!c) return;
				const tk = /** @type {TileKinds[number]} */ (t.kinds[k]);
				M.set(tk.m.subarray(0, c * 16), at * 16);
				R.set(tk.rank.subarray(0, c), at);
				at += c;
			});
			kind.show(n, x, z, reach + 2);
		});
	};
	const drop = (/** @type {string} */ key) => {
		if (tiles.delete(key)) changed = true;
	};
	return {
		object,
		/** where the eye is: the tiles near it built (the nearest first, a few a frame), the far ones let go */
		update(/** @type {number} */ x, /** @type {number} */ z, budget = perFrame) {
			eye.value.set(x, z);
			// built out past where the cover shows, so a tile is ready before it is seen
			const out = reach + tile * 0.75;
			const ix = Math.floor(x / tile), iz = Math.floor(z / tile), n = Math.ceil(out / tile);
			/** @type {[number, number, number][]} */
			const want = [];
			for (let dx = -n; dx <= n; dx++)
				for (let dz = -n; dz <= n; dz++) {
					const cx = (ix + dx + 0.5) * tile, cz = (iz + dz + 0.5) * tile;
					const d = Math.hypot(cx - x, cz - z) - tile * 0.71;
					if (d < out && !tiles.has(`${ix + dx},${iz + dz}`)) want.push([d, ix + dx, iz + dz]);
				}
			want.sort((a, b) => a[0] - b[0]);
			for (const [, tx, tz] of want.slice(0, budget)) {
				tiles.set(`${tx},${tz}`, { ix: tx, iz: tz, kinds: build(tx, tz) });
				changed = true;
			}
			for (const [key, t] of tiles) if (Math.hypot((t.ix + 0.5) * tile - x, (t.iz + 0.5) * tile - z) - tile * 0.71 > out + tile) drop(key);
			// gathered again when a tile came or went, or once the eye has gone a metre and a half
			if (changed || Math.hypot(x - gathered.x, z - gathered.z) > 1.5) gather(x, z);
		},
		/** another recipe (or other kinds hidden): every tile built again as it is next wanted */
		rebuild(/** @type {import('./index.js').Recipe} */ next, /** @type {Set<number>} */ hide = new Set()) {
			tiles.clear();
			for (const k of kinds) k.dispose();
			recipe = next;
			hidden = hide;
			kinds = kindsOf(recipe, uniforms, shadows, object);
			changed = true;
		},
		/** how many plants of it stand now, for a look at its weight */
		count: () => kinds.reduce((a, k) => a + k.count(), 0)
	};
}

/** @typedef {{ m: Float32Array, rank: Float32Array }[]} TileKinds each kind's plants in a tile, by rank, least first */

/**
 * One tile of a biome's cover, worked out from its place alone (the same tile, the same plants, every time): each kind's
 * plants in it (by its index in `recipe.cover`), their places and their ranks, least first.
 * @param {import('./index.js').Recipe} recipe @param {number} ix @param {number} iz
 * @param {{ tile?: number, seed?: number, density?: number, open?: (x: number, z: number) => boolean, origin?: [number, number], hidden?: Set<number> }} [o]
 * @returns {TileKinds}
 */
export function coverTile(recipe, ix, iz, o = {}) {
	const tile = o.tile ?? 12, seed = o.seed ?? 1, hidden = o.hidden ?? new Set();
	const [ox, oz] = o.origin ?? [0, 0];
	const r = rng((ix * 73856093) ^ (iz * 19349663) ^ (seed * 83492791));
	/** @type {{ rank: number, m: THREE.Matrix4 }[][]} */
	const at = recipe.cover.map(() => []);
	const s = 1 / Math.sqrt(o.density ?? recipe.density), x0 = ix * tile, z0 = iz * tile;
	const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
	for (let x = x0; x < x0 + tile; x += s)
		for (let z = z0; z < z0 + tile; z += s) {
			const px = x + r() * s, pz = z + r() * s;
			const k = coverAt(recipe, r, px + ox, pz + oz, hidden);
			const turn = r() * Math.PI * 2, size = 0.75 + r() * 0.6, rank = r();
			if (k < 0 || (o.open && !o.open(px, pz))) continue;
			at[k]?.push({ rank, m: new THREE.Matrix4().compose(p.set(px, 0, pz), q.setFromAxisAngle(up, turn), sc.setScalar(size)) });
		}
	return at.map((list) => {
		list.sort((a, b) => a.rank - b.rank);
		const m = new Float32Array(list.length * 16), rank = new Float32Array(list.length);
		list.forEach((e, i) => {
			e.m.toArray(m, i * 16);
			rank[i] = e.rank;
		});
		return { m, rank };
	});
}

/**
 * A biome's cover as the stream draws it round an eye that stays where it is (`coverStream` with every tile in reach
 * built, `update(eye)`): each kind's plants (by its index in `recipe.cover`), as their matrices, each scaled by how far
 * it grows there (the fading shader's sum, below: the same), the ones that do not grow there left out. The same
 * options as the stream's.
 * @param {import('./index.js').Recipe} recipe
 * @param {{
 *   tile?: number, reach?: number, near?: number, thin?: number, seed?: number, density?: number, hidden?: Set<number>,
 *   open?: (x: number, z: number) => boolean, origin?: [number, number], eye?: [number, number]
 * }} [o]
 * @returns {Float32Array[]}
 */
export function coverLaid(recipe, o = {}) {
	const tile = o.tile ?? 12, reach = o.reach ?? 30;
	const near = o.near ?? Math.min(10, reach * 0.4), thin = o.thin ?? 0.3;
	const [x, z] = o.eye ?? [0, 0];
	const keep = (/** @type {number} */ d) => (d <= near ? 1 : 1 - (1 - thin) * Math.min(1, (d - near) / Math.max(1e-3, reach - near)));
	const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ v) => {
		const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
		return t * t * (3 - 2 * t);
	};
	/** @type {number[][]} */
	const laid = recipe.cover.map(() => []);
	// the tiles the stream builds round the eye: out past where the cover shows
	const out = reach + tile * 0.75;
	const ix = Math.floor(x / tile), iz = Math.floor(z / tile), n = Math.ceil(out / tile);
	for (let dx = -n; dx <= n; dx++)
		for (let dz = -n; dz <= n; dz++) {
			const tx = ix + dx, tz = iz + dz;
			if (!(Math.hypot((tx + 0.5) * tile - x, (tz + 0.5) * tile - z) - tile * 0.71 < out)) continue;
			// as many of the tile as it gathers (by the tile's nearest point, a little nearer still)…
			const ex = Math.max(tx * tile - x, 0, x - (tx + 1) * tile), ez = Math.max(tz * tile - z, 0, z - (tz + 1) * tile);
			const td = Math.hypot(ex, ez) - 3;
			const kk = td > reach ? 0 : keep(Math.max(0, td));
			if (kk <= 0) continue;
			coverTile(recipe, tx, tz, o).forEach(({ m, rank }, k) => {
				for (let i = 0; i < rank.length && /** @type {number} */ (rank[i]) < kk + 0.02; i++) {
					// …each grown as far as the shader grows it where it stands
					const d = Math.hypot(/** @type {number} */ (m[i * 16 + 12]) - x, /** @type {number} */ (m[i * 16 + 14]) - z);
					const grow = Math.min(1, Math.max(0, (keep(d) - /** @type {number} */ (rank[i])) / 0.08)) * (1 - smooth(reach - 4, reach, d));
					if (!(grow > 0)) continue;
					const list = /** @type {number[]} */ (laid[k]);
					for (let j = 0; j < 16; j++) list.push(/** @type {number} */ (m[i * 16 + j]) * (j % 4 < 3 && j < 12 ? grow : 1));
				}
			});
		}
	return laid.map((list) => Float32Array.from(list));
}

/**
 * The cover's material, fading by distance: each plant scaled by how far it is from the eye against its rank — grown
 * full where it stands, down into the ground where it does not.
 */
const FADE = {
	head: `attribute float bRank;
uniform vec2 bEye;
uniform float bNear;
uniform float bReach;
uniform float bThin;`,
	body: `{
		// in the stream's own ground, as the eye is given
		vec2 bAt = instanceMatrix[3].xz;
		float bD = distance(bAt, bEye);
		float bKeep = bD <= bNear ? 1.0 : 1.0 - (1.0 - bThin) * min(1.0, (bD - bNear) / max(1e-3, bReach - bNear));
		float bGrow = clamp((bKeep - bRank) / 0.08, 0.0, 1.0) * (1.0 - smoothstep(bReach - 4.0, bReach, bD));
		transformed *= bGrow;
	}`
};
/** @type {WeakMap<THREE.Material, Map<object, THREE.Material>>} */
const faded = new WeakMap();
/**
 * A material drawn fading so (one for each material and stream), and its shadow's
 * @param {THREE.Material} base @param {Record<string, { value: unknown }>} uniforms
 */
function fadedOf(base, uniforms) {
	let byStream = faded.get(base);
	if (!byStream) faded.set(base, (byStream = new Map()));
	let m = byStream.get(uniforms);
	if (!m) {
		m = base.clone();
		const patch = (/** @type {THREE.Material} */ mat) => {
			mat.onBeforeCompile = (shader) => {
				Object.assign(shader.uniforms, uniforms);
				shader.vertexShader = shader.vertexShader
					.replace('#include <common>', `#include <common>\n${FADE.head}`)
					.replace('#include <begin_vertex>', `#include <begin_vertex>\n${FADE.body}`);
			};
			mat.customProgramCacheKey = () => 'biome-cover-fade';
		};
		patch(m);
		m.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
		patch(m.userData.depth);
		byStream.set(uniforms, m);
	}
	return m;
}

/**
 * Each kind of a recipe's cover: its meshes, drawn as instances that share one list of places and ranks.
 * @param {import('./index.js').Recipe} recipe @param {Record<string, { value: unknown }>} uniforms @param {boolean} shadows
 * @param {THREE.Group} into
 */
function kindsOf(recipe, uniforms, shadows, into) {
	return coverOf(recipe).map((g) => {
		/** @type {{ geometry: THREE.BufferGeometry, material: THREE.Material }[]} */
		const parts = [];
		g.updateMatrixWorld(true);
		g.traverse((c) => {
			const m = /** @type {THREE.Mesh} */ (c);
			if (m.isMesh) parts.push({ geometry: m.geometry, material: /** @type {THREE.Material} */ (m.material) });
		});
		let matrix = new THREE.InstancedBufferAttribute(new Float32Array(0), 16);
		let rank = new THREE.InstancedBufferAttribute(new Float32Array(0), 1);
		/** @type {THREE.InstancedMesh[]} */
		const meshes = parts.map(({ geometry, material }) => {
			const geo = geometry.clone();
			const mat = fadedOf(material, uniforms);
			const mesh = new THREE.InstancedMesh(geo, mat, 0);
			mesh.castShadow = shadows;
			mesh.receiveShadow = true;
			mesh.customDepthMaterial = mat.userData.depth;
			mesh.visible = false;
			mesh.boundingSphere = new THREE.Sphere();
			into.add(mesh);
			return mesh;
		});
		let shown = 0;
		const kind = {
			get matrix() {
				return matrix;
			},
			get rank() {
				return rank;
			},
			/** room for n of it */
			fit(/** @type {number} */ n) {
				if (matrix.count >= n) return;
				const size = Math.max(n, Math.ceil(matrix.count * 1.5), 64);
				matrix = new THREE.InstancedBufferAttribute(new Float32Array(size * 16), 16);
				rank = new THREE.InstancedBufferAttribute(new Float32Array(size), 1);
				matrix.setUsage(THREE.DynamicDrawUsage);
				rank.setUsage(THREE.DynamicDrawUsage);
				for (const m of meshes) {
					m.instanceMatrix = matrix;
					m.geometry.setAttribute('bRank', rank);
				}
			},
			/** n of it drawn, round x, z within r */
			show(/** @type {number} */ n, /** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ r) {
				shown = n;
				matrix.needsUpdate = true;
				rank.needsUpdate = true;
				for (const m of meshes) {
					m.count = n;
					m.visible = n > 0;
					/** @type {THREE.Sphere} */ (m.boundingSphere).set(new THREE.Vector3(x, 0, z), r);
				}
			},
			count: () => shown,
			dispose() {
				for (const m of meshes) {
					m.removeFromParent();
					m.geometry.dispose();
				}
			}
		};
		kind.fit(1);
		return kind;
	});
}
