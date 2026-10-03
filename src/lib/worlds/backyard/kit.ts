/*
 * THE BACKYARD'S TOOLS — how its parts are put up: boxes and planes whose textures lie at their real size (every UV in
 * metres), walls with openings cut into them, models placed, and, once all is standing, everything that never moves
 * welded into a few meshes by material, so a courtyard of a thousand parts draws in a few hundred calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A box w × h × d, its texture at its real size: each face's u and v in metres. */
export function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
	const g = new THREE.BoxGeometry(w, h, d);
	const uv = g.attributes.uv!;
	// the faces, four corners each: +x, −x (along z, y), +y, −y (along x, z), +z, −z (along x, y)
	const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]] as const;
	for (let f = 0; f < 6; f++)
		for (let k = 0; k < 4; k++) {
			const i = f * 4 + k;
			uv.setXY(i, uv.getX(i) * dims[f]![0], uv.getY(i) * dims[f]![1]);
		}
	return g;
}

/** A plane w × h (in its own x, y), its texture at its real size. */
export function planeGeo(w: number, h: number, sx = 1, sy = 1): THREE.PlaneGeometry {
	const g = new THREE.PlaneGeometry(w, h, sx, sy);
	const uv = g.attributes.uv!;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
	return g;
}

/** A texture laid at its real size (`size` metres a repeat) on geometry whose UVs are in metres. */
export function sized<T extends THREE.Texture>(tex: T, size: number | [number, number]): T {
	const [u, v] = typeof size === 'number' ? [size, size] : size;
	const t = tex.clone() as T;
	t.repeat.set(1 / u, 1 / v);
	t.needsUpdate = true;
	return t;
}

export type Builder = ReturnType<typeof builder>;

/** The tools, building into `group`. */
export function builder(group: THREE.Group) {
	const add = <T extends THREE.Object3D>(o: T, cast = true, catches = true) => {
		o.traverse((c) => {
			if ((c as THREE.Mesh).isMesh) {
				c.castShadow = c.castShadow || cast;
				c.receiveShadow = c.receiveShadow || catches;
			}
		});
		group.add(o);
		return o;
	};
	return {
		group,
		add,
		/** a box from its middle, turned `rotY` about the vertical */
		box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rotY = 0, cast = true) {
			const b = new THREE.Mesh(boxGeo(w, h, d), m);
			b.position.set(x, y, z);
			b.rotation.y = rotY;
			b.castShadow = cast;
			b.receiveShadow = true;
			group.add(b);
			return b;
		},
		/** a box between two corners (x0…x1, y0…y1, z0…z1) */
		span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material, cast = true) {
			const b = new THREE.Mesh(boxGeo(x1 - x0, y1 - y0, z1 - z0), m);
			b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
			b.castShadow = cast;
			b.receiveShadow = true;
			group.add(b);
			return b;
		},
		/** a flat surface: on a wall facing `rotY` (0 faces +z), or lying on the ground */
		plane(w: number, h: number, m: THREE.Material, x: number, y: number, z: number, rotY = 0, lying = false) {
			const p = new THREE.Mesh(planeGeo(w, h), m);
			p.position.set(x, y, z);
			if (lying) p.rotation.x = -Math.PI / 2;
			else p.rotation.y = rotY;
			p.receiveShadow = true;
			group.add(p);
			return p;
		},
		/** a ground surface in the outline of `pts` ([x, z] corners), `y` up */
		patch(pts: [number, number][], m: THREE.Material, y: number) {
			// a shape in (x, −z), turned down flat: its UVs are its coordinates, in metres
			const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
			const g = new THREE.ShapeGeometry(shape, 12);
			g.rotateX(-Math.PI / 2);
			const p = new THREE.Mesh(g, m);
			p.position.y = y;
			p.receiveShadow = true;
			group.add(p);
			return p;
		},
		/**
		 * A prism along x from `x0` to `x1`, its cross-section the polygon `pts` ([z, y] corners): a roof, a gable.
		 * `mats`: one material, or [its ends, its sides].
		 */
		prism(pts: [number, number][], x0: number, x1: number, mats: THREE.Material | [THREE.Material, THREE.Material]) {
			const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
			const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false });
			g.rotateY(Math.PI / 2);
			g.translate(x0, 0, 0);
			const o = new THREE.Mesh(g, mats);
			o.castShadow = o.receiveShadow = true;
			group.add(o);
			return o;
		},
		/** a model at x, z (y up), turned `rotY` */
		place<T extends THREE.Object3D>(o: T, x: number, z: number, rotY = 0, y = 0) {
			o.position.set(x, y, z);
			o.rotation.y = rotY;
			group.add(o);
			return o;
		},
		/**
		 * A wall `w` wide and `h` high, `t` thick, its face towards +z at z 0 and its foot at y 0, its left end at x 0,
		 * with rectangular openings cut through it ([x0, x1, y0, y1] in the wall's own measure); `outline` for a wall that
		 * is no rectangle. Its texture at real size.
		 */
		wall(w: number, h: number, t: number, holes: [number, number, number, number][], m: THREE.Material, outline?: [number, number][]) {
			const s = new THREE.Shape((outline ?? [[0, 0], [w, 0], [w, h], [0, h]]).map(([x, y]) => new THREE.Vector2(x, y)));
			for (const [x0, x1, y0, y1] of holes) s.holes.push(new THREE.Path([new THREE.Vector2(x0, y0), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, y0)]));
			const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
			g.translate(0, 0, -t);
			const o = new THREE.Mesh(g, m);
			o.castShadow = o.receiveShadow = true;
			group.add(o);
			return o;
		}
	};
}

/**
 * Weld every mesh under `root` that will never move into one mesh per material (and per way it casts and catches
 * shadows): their places baked in. What a world drives keeps its own material, so lighting a lantern's paper still
 * lights every lantern. Skips what cannot be welded: several materials on one mesh, instanced or skinned meshes.
 */
export function freeze(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean = () => false): THREE.Group {
	root.updateMatrixWorld(true);
	const bins = new Map<string, { mat: THREE.Material; depth?: THREE.Material; cast: boolean; catches: boolean; geos: THREE.BufferGeometry[]; order: number }>();
	const welded: THREE.Mesh[] = [];
	root.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
		if (Array.isArray(mesh.material) || keep(mesh)) return;
		for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (!p.visible || keep(p)) return;
		const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
		for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
		if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
		if (!g.attributes.normal) g.computeVertexNormals();
		g.clearGroups();
		g.applyMatrix4(mesh.matrixWorld);
		const depth = mesh.customDepthMaterial;
		const key = `${mesh.material.uuid}|${depth?.uuid ?? ''}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}`;
		let bin = bins.get(key);
		if (!bin) bins.set(key, (bin = { mat: mesh.material, depth, cast: mesh.castShadow, catches: mesh.receiveShadow, geos: [], order: mesh.renderOrder }));
		bin.geos.push(g);
		welded.push(mesh);
	});
	const out = new THREE.Group();
	out.name = 'welded';
	for (const bin of bins.values()) {
		const merged = mergeGeometries(bin.geos, false);
		for (const g of bin.geos) g.dispose();
		if (!merged) continue;
		merged.computeBoundingSphere();
		const m = new THREE.Mesh(merged, bin.mat);
		if (bin.depth) m.customDepthMaterial = bin.depth;
		m.castShadow = bin.cast;
		m.receiveShadow = bin.catches;
		m.renderOrder = bin.order;
		out.add(m);
	}
	// what was welded leaves the scene (its geometry may be shared, a tree's with every tree of its kind: kept)
	for (const mesh of welded) mesh.removeFromParent();
	return out;
}
