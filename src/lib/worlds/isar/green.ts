/*
 * THE ISAR'S GREEN — the trees and the grass, and the benches among them.
 *
 * The trees: every tree OpenStreetMap knows; the woods filled; the steep west bank lined from the water up to the
 * street, willows low by the water and broadleaves and poplars above; willow shrubs in clumps at the east bank's edge;
 * a few big solitary trees on the meadow by the path, as the photos have them. One instanced mesh for each kind's wood
 * and one for its leaves, in bands along the river so what is out of view is not drawn; close to the walk the full
 * trees, further off lighter ones.
 *
 * The grass: blades in tufts, grown only round the camera (a ring of cells that follows it), on the meadows and the
 * banks — not on the paths, the gravel or under water — each tuft green or gone to straw as the ground under it is,
 * stirring in the breeze on the world's clock.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP, inRing, nOf, points, sOf, waterAt, xOf, zOf, type Ring } from './map';
import type { Ground } from './ground';
import { barkMaterial, leafDepthMaterial, leafMaterial, leafOf, parkBench, limestoneBlock, seeded, treeParts, type TreeKind } from '$lib/models/outdoor';

type Plant = { x: number; y: number; z: number; kind: TreeKind; scale: number; full: boolean };

/** where trees may not stand: the paths, the water, the gravel, the bridges' feet */
type Clear = (x: number, z: number, y: number) => boolean;

export function plantTrees(ground: Ground, clear: Clear): Plant[] {
	const r = seeded(1972);
	const plants: Plant[] = [];
	const S0 = ground.gs[0]!, S1 = ground.gs[ground.gs.length - 1]!, N0 = ground.gn[0]!, N1 = ground.gn[ground.gn.length - 1]!;
	const near = (s: number, n: number) => Math.abs(s) < 520 && n > -110 && n < 160;
	const ok = (x: number, z: number, margin = 0.3) => {
		const s = sOf(x, z), n = nOf(x, z);
		if (s < S0 + 4 || s > S1 - 4 || n < N0 + 4 || n > N1 - 4) return false;
		const y = ground.atSN(s, n);
		if (y < waterAt(s) + margin) return false;
		const [gravel, stones, asphalt] = ground.surface(s, n);
		if (gravel > 0.25 || asphalt > 0.25 || stones > 0.5) return false;
		return clear(x, z, y);
	};
	const add = (x: number, z: number, kind: TreeKind, scale = 0.85 + r() * 0.4) => {
		const s = sOf(x, z), n = nOf(x, z);
		plants.push({ x, y: ground.atSN(s, n) - 0.15, z, kind, scale, full: near(s, n) });
	};
	// every tree the map knows
	for (const [x, z] of MAP.trees) if (ok(x, z, 0.5)) add(x, z, r() < 0.8 ? 'broadleaf' : 'poplar');
	for (const row of MAP.treeRows) {
		const p = points(row);
		for (let k = 0; k + 1 < p.length; k++) {
			const [a, b] = [p[k]!, p[k + 1]!];
			const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
			for (let d = 0; d < len; d += 8) {
				const x = a[0] + ((b[0] - a[0]) * d) / len, z = a[1] + ((b[1] - a[1]) * d) / len;
				if (ok(x, z, 0.5)) add(x, z, 'broadleaf');
			}
		}
	}
	// the woods, filled: a jittered grid, closer near the river
	for (const ring of MAP.wood) {
		const p = points(ring);
		const xs = p.map((q) => q[0]), zs = p.map((q) => q[1]);
		const step = 8.5;
		for (let x = Math.min(...xs); x < Math.max(...xs); x += step)
			for (let z = Math.min(...zs); z < Math.max(...zs); z += step) {
				const px = x + (r() - 0.5) * step * 0.8, pz = z + (r() - 0.5) * step * 0.8;
				if (!inRing(ring, px, pz) || !ok(px, pz, 0.6)) continue;
				const u = r();
				add(px, pz, u < 0.62 ? 'broadleaf' : u < 0.8 ? 'poplar' : u < 0.92 ? 'willow' : 'shrub');
			}
	}
	// the west bank, from the water up to the street: willows low, broadleaves and poplars above
	for (let s = S0 + 10; s < S1 - 10; s += 6.5) {
		const [west] = ground.banks(s);
		for (const [depth, kinds] of [[3.5, ['willow', 'willow', 'shrub', 'broadleaf']], [9, ['broadleaf', 'poplar', 'broadleaf', 'willow']], [15, ['broadleaf', 'broadleaf', 'poplar']], [22, ['broadleaf', 'broadleaf', 'poplar']], [29, ['broadleaf', 'broadleaf']]] as const) {
			if (r() < (depth > 20 ? 0.35 : 0.15)) continue;
			const n = west - depth - r() * 3;
			const ss = s + (r() - 0.5) * 4;
			const x = xOf(ss, n), z = zOf(ss, n);
			// the slope's rows only on the slope; the upper rows along the park strip above it, off its paths
			const y = ground.atSN(ss, n);
			if ((depth < 20 && y > waterAt(ss) + 6.2) || !ok(x, z, 0.4)) continue;
			add(x, z, kinds[Math.floor(r() * kinds.length)]!);
		}
	}
	// the east bank's edge: clumps of willow shrubs and a few willows where the water meets the meadow
	for (let s = -330; s < 400; s += 9) {
		if (r() < 0.55) continue;
		const [, east] = ground.banks(s);
		const clump = 1 + Math.floor(r() * 4);
		for (let k = 0; k < clump; k++) {
			const ss = s + (r() - 0.5) * 7, n = east + 1.5 + r() * 4;
			const x = xOf(ss, n), z = zOf(ss, n);
			if (ok(x, z, 0.2)) add(x, z, r() < 0.8 ? 'shrub' : 'willow', 0.7 + r() * 0.5);
		}
	}
	// and close to the Wittelsbacherbrücke the tall willow bushes by the path (photo, July 2023)
	for (let k = 0; k < 14; k++) {
		const ss = 300 + r() * 26, n = 57 + r() * 9;
		const x = xOf(ss, n), z = zOf(ss, n);
		if (ok(x, z, 0.2)) add(x, z, 'shrub', 0.9 + r() * 0.5);
	}
	// big solitary trees on the meadow, beside the path
	for (const [s, n] of [[-262, 58], [-140, 33], [-30, 34], [92, 44], [214, 52], [270, 60]] as const) {
		const x = xOf(s, n), z = zOf(s, n);
		if (ok(x, z, 0.5)) add(x, z, s % 2 ? 'broadleaf' : 'willow', 1.05 + r() * 0.25);
	}
	return plants;
}

export type Trees = { group: THREE.Group; trunks: { x: number; z: number; r: number }[]; wind: { value: number }; update: (x: number, z: number) => void; dispose: () => void };

/** within this reach of the camera the full trees, beyond it the light ones (m) */
const FULL = 190;

/**
 * The trees as instanced meshes, a pair (wood, leaves) for each kind, full and light: as the camera moves, the trees
 * near it are drawn full and the rest light — the same trees wherever the camera is, so a shot renders the same.
 */
export function buildTrees(plants: Plant[]): Trees {
	const group = new THREE.Group();
	group.name = 'the trees';
	const wind = { value: 0 };
	const mats = { broad: leafMaterial('broad', wind), narrow: leafMaterial('narrow', wind) };
	const depth = { broad: leafDepthMaterial('broad'), narrow: leafDepthMaterial('narrow') };
	const bark = barkMaterial();
	const r = seeded(77);
	const owned: { dispose: () => void }[] = [mats.broad, mats.narrow, depth.broad, depth.narrow];
	const tint: Partial<Record<TreeKind, string>> = { broadleaf: '#ffffff', willow: '#f4f6ee', poplar: '#f1f6e6', shrub: '#f7f8ee' };
	const trunks: { x: number; z: number; r: number }[] = [];
	const q = new THREE.Quaternion(), sc = new THREE.Vector3(), at = new THREE.Vector3(), col = new THREE.Color();
	const kinds = [...new Set(plants.map((p) => p.kind))];
	const sets = kinds.map((kind) => {
		const list = plants.filter((p) => p.kind === kind);
		const matrices = list.map((pl) => {
			q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
			sc.setScalar(pl.scale);
			at.set(pl.x, pl.y, pl.z);
			if (kind !== 'shrub') trunks.push({ x: pl.x, z: pl.z, r: 0.45 * pl.scale });
			return new THREE.Matrix4().compose(at, q, sc);
		});
		const colors = list.map(() => col.set(tint[kind] ?? '#ffffff').offsetHSL((r() - 0.5) * 0.05, (r() - 0.5) * 0.15, (r() - 0.5) * 0.12).clone());
		const pair = (light: boolean) => {
			const p = treeParts(kind, 1, light);
			const wood = new THREE.InstancedMesh(p.wood, bark, list.length);
			const leaves = new THREE.InstancedMesh(p.leaves, mats[leafOf(kind)], list.length);
			leaves.customDepthMaterial = depth[leafOf(kind)];
			for (const im of [wood, leaves]) {
				im.castShadow = im.receiveShadow = true;
				im.count = 0;
				group.add(im);
			}
			return { wood, leaves };
		};
		return { list, matrices, colors, full: pair(false), light: pair(true) };
	});
	let lastX = Infinity, lastZ = Infinity;
	const update = (x: number, z: number) => {
		if (Math.hypot(x - lastX, z - lastZ) < 24) return;
		lastX = x;
		lastZ = z;
		for (const set of sets) {
			let f = 0, l = 0;
			set.list.forEach((pl, i) => {
				const near = Math.hypot(pl.x - x, pl.z - z) < FULL;
				const target = near ? set.full : set.light;
				const k = near ? f++ : l++;
				target.wood.setMatrixAt(k, set.matrices[i]!);
				target.leaves.setMatrixAt(k, set.matrices[i]!);
				target.leaves.setColorAt(k, set.colors[i]!);
			});
			for (const [pair, n] of [[set.full, f], [set.light, l]] as const)
				for (const im of [pair.wood, pair.leaves]) {
					im.count = n;
					im.instanceMatrix.needsUpdate = true;
					if (im.instanceColor) im.instanceColor.needsUpdate = true;
					im.computeBoundingSphere();
				}
		}
	};
	return {
		group,
		trunks,
		wind,
		update,
		dispose() {
			for (const o of owned) o.dispose();
			group.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose());
		}
	};
}

/* ── the grass ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** a tuft of six blades, each a bent, tapering strip; `tip` runs 0 at the root to 1 at the point */
function tuft() {
	const r = seeded(5);
	const pos: number[] = [], tip: number[] = [], idx: number[] = [];
	for (let b = 0; b < 7; b++) {
		const a = r() * Math.PI * 2, lean = 0.1 + r() * 0.35, h = 0.55 + r() * 0.45, w = 0.007 + r() * 0.005;
		const ox = Math.cos(a) * 0.07 * r(), oz = Math.sin(a) * 0.07 * r();
		const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
		const base = pos.length / 3;
		for (const t of [0, 0.55]) {
			const y = h * t, bend = lean * t * t * h;
			const half = w * (1 - t * 0.5);
			pos.push(ox + dx * bend + px * half, y, oz + dz * bend + pz * half, ox + dx * bend - px * half, y, oz + dz * bend - pz * half);
			tip.push(t, t);
		}
		pos.push(ox + dx * lean * h * 1.05, h * 1.05, oz + dz * lean * h * 1.05);
		tip.push(1);
		idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	// the blades lit as the ground under them is, not each on its own: no dark blades
	g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
	g.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
	g.setIndex(idx);
	return g;
}

export type Grass = { mesh: THREE.InstancedMesh; update: (x: number, z: number) => void; dispose: () => void };

/** The grass round the camera: tufts in cells of 6 m, grown within 34 m of it, the same tufts in a cell every time. */
export function buildGrass(ground: Ground, clear: Clear, time: { value: number }): Grass {
	const CELL = 6, REACH = 26, SPACING = 0.36;
	const MAX = 36000;
	const geo = tuft();
	const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, side: THREE.DoubleSide });
	mat.onBeforeCompile = (sh) => {
		sh.uniforms.time = time;
		sh.vertexShader = sh.vertexShader
			.replace('#include <common>', '#include <common>\nattribute float tip;\nvarying float vTip;\nuniform float time;')
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vTip = tip;
				// the breeze: gusts rolling over the meadow, the tips bending most
				vec3 root = vec3( instanceMatrix[3].x, 0.0, instanceMatrix[3].z );
				float gust = sin( time * 1.6 + root.x * 0.21 + root.z * 0.17 ) * 0.5 + sin( time * 2.7 + root.x * 0.6 ) * 0.25;
				transformed.x += gust * tip * tip * 0.09;
				transformed.z += gust * tip * tip * 0.05;`
			);
		sh.fragmentShader = sh.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying float vTip;')
			.replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= mix( 0.62, 1.12, vTip );');
	};
	mat.customProgramCacheKey = () => 'isar-grass';
	const mesh = new THREE.InstancedMesh(geo, mat, MAX);
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.count = 0;
	mesh.frustumCulled = false;
	mesh.receiveShadow = true;
	mesh.name = 'the grass';
	const GREEN = new THREE.Color('#6f8338'), LUSH = new THREE.Color('#5b7d30'), STRAW = new THREE.Color('#b4a462');
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), at = new THREE.Vector3(), col = new THREE.Color();
	const up = new THREE.Vector3(0, 1, 0);
	let cellS = NaN, cellN = NaN;
	const update = (x: number, z: number) => {
		const s = sOf(x, z), n = nOf(x, z);
		const cs = Math.floor(s / CELL), cn = Math.floor(n / CELL);
		if (cs === cellS && cn === cellN) return;
		cellS = cs;
		cellN = cn;
		let count = 0;
		const reach = Math.ceil(REACH / CELL);
		for (let i = cs - reach; i <= cs + reach && count < MAX; i++)
			for (let j = cn - reach; j <= cn + reach && count < MAX; j++) {
				const ds = (i + 0.5) * CELL - s, dn = (j + 0.5) * CELL - n;
				const d = Math.hypot(ds, dn);
				if (d > REACH + CELL) continue;
				// the cell's own tufts: the same every time it is grown
				const r = seeded(((i * 73856093) ^ (j * 19349663)) >>> 0);
				const per = Math.round(CELL / SPACING);
				for (let a = 0; a < per && count < MAX; a++)
					for (let b = 0; b < per && count < MAX; b++) {
						const ts = (i * CELL + (a + r()) * SPACING), tn = (j * CELL + (b + r()) * SPACING);
						const u = r(), v = r(), w = r();
						const fade = 1 - Math.min(1, Math.max(0, (Math.hypot(ts - s, tn - n) - REACH * 0.7) / (REACH * 0.3)));
						if (fade <= 0) continue;
						const y = ground.atSN(ts, tn);
						const level = waterAt(ts);
						if (y < level + 0.08) continue;
						const [gravel, stones, asphalt, soil] = ground.surface(ts, tn);
						const grassy = (1 - Math.min(1, gravel * 1.6)) * (1 - Math.min(1, stones * 1.4)) * (1 - asphalt) * (1 - soil * 0.75);
						if (u > grassy) continue;
						const wx = xOf(ts, tn), wz = zOf(ts, tn);
						if (!clear(wx, wz, y)) continue;
						// taller by the water and on the banks, shorter where the meadow is walked and mown
						const edge = Math.max(0, 1 - (y - level) / 1.6);
						const height = (0.1 + v * 0.16 + edge * (0.3 + w * 0.45)) * fade;
						q.setFromAxisAngle(up, w * Math.PI * 2);
						sc.set(0.8 + v * 0.6, height, 0.8 + v * 0.6);
						at.set(wx, y - 0.02, wz);
						m.compose(at, q, sc);
						mesh.setMatrixAt(count, m);
						// green, or gone to straw as the ground's own patches are
						const dry = Math.max(0, Math.min(1, (Math.sin(wx * 0.11 + Math.sin(wz * 0.07) * 2) * 0.5 + 0.5) * 1.2 - edge * 0.8 - 0.15));
						col.copy(edge > 0.5 ? LUSH : GREEN).lerp(STRAW, dry * (0.6 + v * 0.4));
						mesh.setColorAt(count, col);
						count++;
					}
			}
		mesh.count = count;
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	};
	return {
		mesh,
		update,
		dispose() {
			geo.dispose();
			mat.dispose();
			mesh.dispose();
		}
	};
}

/* ── benches and stones ──────────────────────────────────────────────────────────────────────────────────────── */

/** many copies of one model as instanced meshes, one for each of its materials */
export function instances(model: THREE.Object3D, places: THREE.Matrix4[]) {
	model.updateMatrixWorld(true);
	const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
	model.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh) return;
		const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
		for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
		if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position!.count) * 2), 2));
		const list = byMat.get(mesh.material as THREE.Material) ?? [];
		list.push(g.index ? g.toNonIndexed() : g);
		byMat.set(mesh.material as THREE.Material, list);
	});
	const group = new THREE.Group();
	for (const [mat, list] of byMat) {
		const im = new THREE.InstancedMesh(mergeGeometries(list)!, mat, places.length);
		places.forEach((p, i) => im.setMatrixAt(i, p));
		im.castShadow = im.receiveShadow = true;
		im.computeBoundingSphere();
		group.add(im);
	}
	return group;
}

/** The benches where the map has them, each turned to face the river; the limestone blocks by the path south of the
 *  Wittelsbacherbrücke, and the stone steps down to the water under its south face (photos, July 2023). */
export function buildFurniture(ground: Ground) {
	const group = new THREE.Group();
	group.name = 'benches and stones';
	const solid: { x: number; z: number; r: number }[] = [];
	const benchAt: THREE.Matrix4[] = [];
	for (const [x, z] of MAP.benches) {
		const s = sOf(x, z), n = nOf(x, z);
		const [w, e] = ground.banks(s);
		// its front towards the water
		const towards = n > (w + e) / 2 ? -1 : 1;
		const dir = { x: xOf(0, towards), z: zOf(0, towards) };
		const m = new THREE.Matrix4().makeRotationY(Math.atan2(dir.x, dir.z));
		m.setPosition(x, ground.at(x, z), z);
		benchAt.push(m);
		solid.push({ x, z, r: 0.75 });
	}
	if (benchAt.length) group.add(instances(parkBench(), benchAt));
	const r = seeded(13);
	const stones: [number, number, number, number, number][] = [
		[322, 61.5, 1.7, 0.8, 0.9],
		[324.2, 62.1, 1.4, 0.75, 0.85],
		[318.5, 60.8, 1.1, 0.6, 1.0]
	];
	// the steps: rows of blocks down the bank to the water, under the bridge's south face
	for (let row = 0; row < 5; row++) for (let k = 0; k < 7; k++) stones.push([303 + k * 3.6 + (row % 2) * 1.6, 49 - row * 1.15, 1.6 + r() * 1.4, 0.48, 1.1]);
	for (const [s, n, w, h, d] of stones) {
		const x = xOf(s, n), z = zOf(s, n);
		const y = ground.atSN(s, n);
		const block = limestoneBlock({ w, h, d, seed: Math.round(s * 10 + n) });
		block.position.set(x, n < 52 ? Math.max(y, waterAt(s) - 0.4) - 0.15 : y - 0.1, z);
		block.rotation.y = Math.atan2(xOf(1, 0), zOf(1, 0)) - Math.PI / 2 + (r() - 0.5) * 0.12;
		group.add(block);
		if (n > 52) solid.push({ x, z, r: Math.max(w, d) / 2 });
	}
	return { group, solid };
}

/** a point in a ring? (re-exported for the world) */
export const inside = (ring: Ring, x: number, z: number) => inRing(ring, x, z);
