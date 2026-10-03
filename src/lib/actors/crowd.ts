/*
 * A CROWD — many of one kind of actor in a world (a flock of hens, a herd of goats, a hive's bees, a pond's fish), each
 * drawn from the kind's rigged model: the ones near the eye (the walker, or the film camera) as rigged actors, every
 * bone moving as their clips have them; the rest, too far to see a leg move, as instances of the same model at rest in
 * coarser shapes — a hundred of them a draw call. Which is which is asked again every frame, so the same frame of a
 * shot always draws the same.
 *
 * A model's skin is meshed off the page (./build.ts): until a coat's far shape is ready its animals are not drawn, and
 * until its rigged model is ready they are drawn as from afar. A film waits for both.
 *
 * Each frame: `begin()`, `put()` every one of them, `end()`.
 */
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { lowDetail, poser, type Cast, type Pose } from './rig';

/** where the eye stands (in the crowd's own frame) */
export type Eye = () => { x: number; z: number };

/** how coarse an actor is drawn from afar */
export const FAR = 0.2;

export type CrowdOptions = {
	/** up to how far (m) from the eye they are rigged */
	near: number;
	/** how many at most are rigged at once */
	max: number;
	/** how big they are against the model (a bee drawn larger than life, to be seen) */
	scale?: number;
	/** how high the model's middle stands over its origin (a bee's, a fish's): `put` gives the middle's height */
	lift?: number;
	/** whether they cast shadows (a bee's would be a speck) */
	shadows?: boolean;
	/** what stands in for them from afar, if not the model at rest in coarser shapes (a bee: a striped speck) */
	farShape?: (coat: number) => { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] };
	/** whether a coat's model is ready to build at a level of detail (1, or `FAR`) without stalling the page */
	ready?: (coat: number, detail: number) => boolean;
};

type Entry = { coat: number; x: number; y: number; z: number; yaw: number; pitch: number; roll: number; d2: number; size: number; pose: () => Pose };

/**
 * A crowd of `counts[c]` actors in each coat `c`, the rigged model of each coat made by `make(c)`.
 */
export function crowd(make: (coat: number) => Cast, counts: number[], o: CrowdOptions) {
	const { near, max, scale = 1, lift = 0, shadows = true } = o;
	const ready = o.ready ?? (() => true);
	const object = new THREE.Group();
	// far: the model at rest, coarse, one instanced mesh a coat — made once it can be
	const far: (THREE.InstancedMesh | null)[] = counts.map(() => null);
	const farOf = (c: number) => {
		if (far[c] || !(o.farShape || ready(c, FAR))) return far[c];
		const shape = o.farShape?.(c) ?? lowDetail(() => make(c), FAR).rig.object;
		const mesh = new THREE.InstancedMesh(shape.geometry, shape.material, Math.max(1, counts[c]!));
		mesh.count = 0;
		mesh.castShadow = shadows;
		mesh.frustumCulled = false;
		object.add(mesh);
		return (far[c] = mesh);
	};
	// near: the rigged models, a pool a coat, each made the first time one is wanted
	const models: (Cast | null)[] = counts.map(() => null);
	const pools: { mesh: THREE.SkinnedMesh; pose: (p: Pose) => void }[][] = counts.map(() => []);
	const rigged = (c: number, k: number) => {
		const pool = pools[c]!;
		while (pool.length <= k) {
			const model = (models[c] ??= make(c));
			model.rig.pose({});
			const mesh = clone(model.rig.object) as THREE.SkinnedMesh;
			mesh.frustumCulled = false;
			mesh.castShadow = shadows;
			mesh.receiveShadow = true;
			object.add(mesh);
			pool.push({ mesh, pose: poser(mesh.skeleton.bones) });
		}
		return pool[k]!;
	};

	let entries: Entry[] = [];
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3();
	return {
		object,
		begin() {
			entries = [];
		},
		/** one of them: its coat, where its middle is, which way it faces (and leans, drawn from afar), how far from the
		 *  eye (squared), its pose if it is near enough to be rigged, and its size against the model */
		put(coat: number, x: number, y: number, z: number, yaw: number, d2: number, pose: () => Pose, pitch = 0, roll = 0, size = 1) {
			entries.push({ coat, x, y: y - lift * scale * size, z, yaw, pitch, roll, d2, size, pose });
		},
		end() {
			const close = entries.filter((en) => en.d2 < near * near && ready(en.coat, 1)).sort((a, b) => a.d2 - b.d2).slice(0, max);
			const chosen = new Set(close);
			const used = counts.map(() => 0);
			for (const en of close) {
				const r = rigged(en.coat, used[en.coat]!++);
				r.mesh.visible = true;
				r.mesh.position.set(en.x, en.y, en.z);
				r.mesh.rotation.set(0, en.yaw, 0);
				r.mesh.scale.setScalar(scale * en.size);
				r.pose(en.pose());
			}
			pools.forEach((pool, c) => pool.forEach((r, k) => (r.mesh.visible = k < used[c]!)));
			const slot = counts.map(() => 0);
			for (const en of entries) {
				if (chosen.has(en)) continue;
				const mesh = farOf(en.coat);
				if (!mesh) continue;
				q.setFromEuler(e.set(en.pitch, en.yaw, en.roll));
				mesh.setMatrixAt(slot[en.coat]!++, m.compose(p.set(en.x, en.y, en.z), q, s.setScalar(scale * en.size)));
			}
			far.forEach((mesh, c) => {
				if (!mesh) return;
				mesh.count = slot[c]!;
				mesh.instanceMatrix.needsUpdate = true;
			});
		}
	};
}
