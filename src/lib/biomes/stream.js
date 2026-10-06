/*
 * A BIOME'S COVER, STREAMED — a biome's floor is dense where it is full (six or ten plants to a square metre inside a
 * carpet of them), too dense to lay out over a whole world at once. So it is laid out in small tiles round the eye as
 * it goes: each tile worked out from its place alone (the same tile, the same plants, every time it is built), a few
 * tiles a frame so walking never stutters, and the tiles left behind let go.
 *
 * `coverStream({ recipe, open })` → `{ object, update(x, z), rebuild(recipe, hidden) }`: add `object` to the scene,
 * call `update` with where the eye is every frame.
 */
import * as THREE from 'three';
import { coverAt, coverOf } from './index.js';
import { rng } from './noise.js';

/**
 * @param {{
 *   recipe: import('./index.js').Recipe,
 *   open?: (x: number, z: number) => boolean,
 *   tile?: number, reach?: number, perFrame?: number, seed?: number, shadows?: boolean, hidden?: Set<number>, density?: number
 * }} o
 *   recipe: the biome; open: whether cover may stand at x, z (not on a path, in the water, in a trunk…); tile: a tile's
 *   size (m); reach: how far from the eye it is drawn (m); perFrame: how many tiles may be built a frame; density: the
 *   biome's, if it should be other (fewer on a slow device)
 */
export function coverStream(o) {
	const tile = o.tile ?? 12, reach = o.reach ?? 30, perFrame = o.perFrame ?? 2, seed = o.seed ?? 1, shadows = o.shadows ?? false;
	const object = new THREE.Group();
	object.name = 'biome cover';
	let recipe = o.recipe, hidden = o.hidden ?? new Set();
	/** each kind's shape and material, built once for the recipe */
	let shapes = shapesOf(recipe);
	/** @type {Map<string, THREE.Group>} */
	const tiles = new Map();
	const step = () => 1 / Math.sqrt(o.density ?? recipe.density);
	/** @param {number} ix @param {number} iz */
	const build = (ix, iz) => {
		const g = new THREE.Group();
		const r = rng((ix * 73856093) ^ (iz * 19349663) ^ (seed * 83492791));
		/** @type {THREE.Matrix4[][]} */
		const at = shapes.map(() => []);
		const s = step(), x0 = ix * tile, z0 = iz * tile;
		const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
		for (let x = x0; x < x0 + tile; x += s)
			for (let z = z0; z < z0 + tile; z += s) {
				const px = x + r() * s, pz = z + r() * s;
				const k = coverAt(recipe, r, px, pz, hidden);
				const turn = r() * Math.PI * 2, size = 0.75 + r() * 0.6;
				if (k < 0 || (o.open && !o.open(px, pz))) continue;
				at[k]?.push(new THREE.Matrix4().compose(p.set(px, 0, pz), q.setFromAxisAngle(up, turn), sc.setScalar(size)));
			}
		shapes.forEach((shape, k) => {
			const list = at[k] ?? [];
			if (!list.length) return;
			for (const { geometry, material } of shape) {
				const inst = new THREE.InstancedMesh(geometry, material, list.length);
				list.forEach((m, i) => inst.setMatrixAt(i, m));
				inst.castShadow = shadows;
				inst.receiveShadow = true;
				inst.computeBoundingSphere();
				g.add(inst);
			}
		});
		return g;
	};
	const drop = (/** @type {string} */ key) => {
		const g = tiles.get(key);
		if (!g) return;
		object.remove(g);
		// the shapes are shared: only the instances' own buffers go
		g.traverse((c) => /** @type {THREE.InstancedMesh} */ (c).isInstancedMesh && /** @type {THREE.InstancedMesh} */ (c).dispose());
		tiles.delete(key);
	};
	return {
		object,
		/** where the eye is: the tiles near it built (the nearest first, a few a frame), the far ones let go */
		update(/** @type {number} */ x, /** @type {number} */ z, budget = perFrame) {
			const ix = Math.floor(x / tile), iz = Math.floor(z / tile), n = Math.ceil(reach / tile);
			/** @type {[number, number, number][]} */
			const want = [];
			for (let dx = -n; dx <= n; dx++)
				for (let dz = -n; dz <= n; dz++) {
					const cx = (ix + dx + 0.5) * tile, cz = (iz + dz + 0.5) * tile;
					const d = Math.hypot(cx - x, cz - z) - tile * 0.71;
					if (d < reach && !tiles.has(`${ix + dx},${iz + dz}`)) want.push([d, ix + dx, iz + dz]);
				}
			want.sort((a, b) => a[0] - b[0]);
			for (const [, tx, tz] of want.slice(0, budget)) {
				const g = build(tx, tz);
				tiles.set(`${tx},${tz}`, g);
				object.add(g);
			}
			for (const key of [...tiles.keys()]) {
				const [tx, tz] = key.split(',').map(Number);
				if (Math.hypot(((tx ?? 0) + 0.5) * tile - x, ((tz ?? 0) + 0.5) * tile - z) - tile * 0.71 > reach + tile) drop(key);
			}
		},
		/** another recipe (or other kinds hidden): every tile built again as it is next wanted */
		rebuild(/** @type {import('./index.js').Recipe} */ next, /** @type {Set<number>} */ hide = new Set()) {
			for (const key of [...tiles.keys()]) drop(key);
			recipe = next;
			hidden = hide;
			shapes = shapesOf(recipe);
		}
	};
}

/** each kind of a recipe's cover, as the meshes it is drawn with @param {import('./index.js').Recipe} recipe */
function shapesOf(recipe) {
	return coverOf(recipe).map((g) => {
		/** @type {{ geometry: THREE.BufferGeometry, material: THREE.Material }[]} */
		const out = [];
		g.updateMatrixWorld(true);
		g.traverse((c) => {
			const m = /** @type {THREE.Mesh} */ (c);
			if (m.isMesh) out.push({ geometry: m.geometry, material: /** @type {THREE.Material} */ (m.material) });
		});
		return out;
	});
}
