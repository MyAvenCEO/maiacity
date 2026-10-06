/*
 * THE RIG — how an actor is built and moved: a skeleton of bones (three.js `Bone`s, each turning about its joint) and
 * one skinned mesh over it, every vertex carried by its bone — and, near a joint, blended with the bone on the other
 * side of it, so an elbow, a knee or a neck bends smoothly instead of breaking. A pose turns the bones; a clip is a
 * pose that moves with time.
 *
 * An actor is built in its rest pose, facing +z, standing on y 0, in metres. Its parts are plain geometries placed in
 * that pose, each riding a bone: rigidly, or along a chain of bones (a limb, a spine, a neck, a fish's body) — each
 * vertex carried by the bone whose stretch of the chain it lies on, blended with the next near their joint.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dualQuaternionSkinning } from './dqs';
import type { Skin } from './sculpt';

export type V3 = [number, number, number];

/** a bone: its name, its parent's, where its joint is in the rest pose */
export type BoneSpec = { name: string; parent?: string; at: V3 };

export type PartSpec = Piece | { skin: Skin; mat?: number };

/** a plain geometry riding its bone (or chain); a body sculpted as one skin (./sculpt.ts) brings its own weights */
export type Piece = {
	geo: THREE.BufferGeometry;
	/** its colour, or a colour by where each vertex is in the rest pose (a sleeve, a belt, a stripe) */
	color: string | ((p: THREE.Vector3) => string);
	/** the bone that carries it whole */
	bone?: string;
	/** or the bones it lies along, from the first joint outwards, and how far either side of a joint they blend (m);
	 *  `tip`: where the last bone's stretch ends (else it reaches as far as its parent's did) */
	chain?: { bones: string[]; soft?: number; tip?: V3 };
	/** which of the actor's materials: 0 its skin, then as it has them (an eye's gloss, the glass of a bee's wings) */
	mat?: number;
};

/** a turn of one bone from its rest (radians about x, then y, then z), and its size (1: as built) */
export type Turn = [number, number, number] | [number, number, number, number];
/** a pose: per bone its turn; `root` moves the first bone from where it rests (m) */
export type Pose = { root?: V3 } & { [bone: string]: Turn | V3 | undefined };
/**
 * How an actor is moving, for the clips that walk it: how far it has come (m) — a stride's phase is the distance, not
 * the time, so a foot set down stays where it was set down — how fast it goes now (m/s), and how fast it turns (rad/s).
 */
export type Motion = { dist: number; speed: number; turn?: number };
/** a clip: the pose at time t (seconds), looping as it likes; a gait also by how the actor moves (without: at its own
 *  pace, on the spot) */
export type Clip = (t: number, m?: Motion) => Pose;

export type Rig = {
	/** what to put in a world: the skinned mesh, its skeleton inside it */
	object: THREE.SkinnedMesh;
	bones: Record<string, THREE.Bone>;
	/** the bones' names, root first */
	names: string[];
	/** turn the bones to a pose (from the rest pose: a bone it does not name rests) */
	pose: (p: Pose) => void;
};

/** An actor with its moves: the clips it plays, the poses it holds (named), and which to show first; for a gait, the
 *  pace it is made for (m/s) */
export type Cast = {
	rig: Rig;
	clips: Record<string, Clip>;
	poses?: Record<string, Pose>;
	first: string;
	gears?: Record<string, number>;
	/** the bones whose joints are set down on the ground walking: kept where they are put (./motion.ts), and measured
	 *  so (scripts/actors.ts) */
	feet?: string[];
};

export function rig(bones: BoneSpec[], parts: PartSpec[], materials: THREE.Material[]): Rig {
	dualQuaternionSkinning();
	const byName: Record<string, THREE.Bone> = {};
	const at: Record<string, THREE.Vector3> = {};
	const parent: Record<string, string | undefined> = {};
	const list: THREE.Bone[] = [];
	for (const b of bones) {
		const bone = new THREE.Bone();
		bone.name = b.name;
		at[b.name] = new THREE.Vector3(...b.at);
		parent[b.name] = b.parent;
		if (b.parent) {
			bone.position.copy(at[b.name]!).sub(at[b.parent]!);
			byName[b.parent]!.add(bone);
		} else bone.position.copy(at[b.name]!);
		byName[b.name] = bone;
		list.push(bone);
	}
	const index = new Map(list.map((b, i) => [b.name, i]));

	// the weights of a vertex: the bone it rides, or its place along a chain (with the joints either side blended)
	const v = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Vector3();
	const weigh = (p: Piece, out: Map<string, number>) => {
		out.clear();
		if (!p.chain) return void out.set(p.bone!, 1);
		const { bones: names, soft = 0.05, tip } = p.chain;
		// the chain's stretches: joint i to joint i+1; the last to its tip (or as long again as the one before)
		const ends = names.map((n, i) => {
			if (i < names.length - 1) return at[names[i + 1]!]!;
			if (tip) return new THREE.Vector3(...tip);
			const prev = i > 0 ? at[names[i - 1]!]! : at[parent[n]!] ?? at[n]!.clone().add(new THREE.Vector3(0, -0.1, 0));
			return at[n]!.clone().multiplyScalar(2).sub(prev);
		});
		// the nearest stretch, and how far along it the vertex lies
		let best = 0, bestD = Infinity, bestS = 0, bestLen = 1;
		names.forEach((n, i) => {
			const a = at[n]!, b = ends[i]!;
			d.subVectors(b, a);
			const len = Math.max(1e-6, d.length());
			const s = THREE.MathUtils.clamp(q.subVectors(v, a).dot(d) / len, 0, len);
			const dist = q.copy(a).addScaledVector(d, s / len).distanceTo(v);
			if (dist < bestD - 1e-9) [best, bestD, bestS, bestLen] = [i, dist, s, len];
		});
		const own = names[best]!;
		const k = Math.min(soft, bestLen / 2);
		const back = best > 0 ? names[best - 1] : parent[own];
		const next = names[best + 1];
		const wBack = back && bestS < k ? 0.5 - (0.5 * bestS) / k : 0;
		const wNext = next && bestLen - bestS < k ? 0.5 - (0.5 * (bestLen - bestS)) / k : 0;
		out.set(own, 1 - wBack - wNext);
		if (wBack) out.set(back!, (out.get(back!) ?? 0) + wBack);
		if (wNext) out.set(next!, (out.get(next!) ?? 0) + wNext);
	};

	const w = new Map<string, number>(), c = new THREE.Color();
	// seen from afar (coarser shapes), the smallest parts are left off: an eye, a toe, a comb's bead
	const geoOf = (p: PartSpec) => ('skin' in p ? p.skin.geo : p.geo);
	if (DETAIL < 1) {
		const size = (p: PartSpec) => {
			const g = geoOf(p);
			return (g.boundingSphere ?? (g.computeBoundingSphere(), g.boundingSphere!)).radius;
		};
		const largest = Math.max(...parts.map(size));
		parts = parts.filter((p) => size(p) >= largest * 0.12);
	}
	const geos = parts.map((p) => {
		if ('skin' in p) {
			// a sculpted skin: its colours and its weights its own, its bones' names turned into this skeleton's
			const g = p.skin.geo.clone(), n = g.attributes.position!.count;
			const si = new Uint16Array(n * 4);
			const ids = p.skin.bones.map((name) => {
				if (!index.has(name)) throw new Error(`skin: no bone ${name}`);
				return index.get(name)!;
			});
			for (let i = 0; i < n * 4; i++) si[i] = ids[p.skin.index[i]!] ?? 0;
			g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
			g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(p.skin.weight.slice(), 4));
			return g;
		}
		const g = p.geo.clone();
		if (!g.index) g.setIndex(Array.from({ length: g.attributes.position!.count }, (_, i) => i));
		for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
		if (!g.attributes.normal) g.computeVertexNormals();
		const pos = g.attributes.position!, n = pos.count;
		const color = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
		for (let i = 0; i < n; i++) {
			v.fromBufferAttribute(pos, i);
			c.set(typeof p.color === 'string' ? p.color : p.color(v));
			color[i * 3] = c.r;
			color[i * 3 + 1] = c.g;
			color[i * 3 + 2] = c.b;
			weigh(p, w);
			const top = [...w].sort((x, y) => y[1] - x[1]).slice(0, 4);
			const sum = top.reduce((s, [, x]) => s + x, 0) || 1;
			top.forEach(([name, x], k) => {
				si[i * 4 + k] = index.get(name) ?? 0;
				sw[i * 4 + k] = x / sum;
			});
		}
		g.setAttribute('color', new THREE.BufferAttribute(color, 3));
		g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
		g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
		return g;
	});
	const geometry = mergeGeometries(geos, true)!;
	geometry.groups.forEach((grp, i) => (grp.materialIndex = parts[i]!.mat ?? 0));

	const mesh = new THREE.SkinnedMesh(geometry, materials);
	mesh.add(list[0]!);
	mesh.updateMatrixWorld(true);
	mesh.bind(new THREE.Skeleton(list));
	mesh.castShadow = mesh.receiveShadow = true;
	mesh.frustumCulled = false; // a pose can carry it far from where it rests

	return { object: mesh, bones: byName, names: list.map((b) => b.name), pose: poser(list) };
}

/** How to pose these bones (a rig's, or a clone's): from where they rest now, each turned as a pose says. */
export function poser(list: THREE.Bone[]): (p: Pose) => void {
	const byName = Object.fromEntries(list.map((b) => [b.name, b]));
	const rest = list.map((b) => b.position.clone());
	const move = new THREE.Vector3();
	return (p: Pose) => {
		list.forEach((b, i) => {
			b.position.copy(rest[i]!);
			b.rotation.set(0, 0, 0);
			b.scale.setScalar(1);
		});
		for (const name in p) {
			const t = p[name];
			if (!t) continue;
			if (name === 'root') list[0]!.position.add(move.set(t[0], t[1], t[2]));
			else {
				const b = byName[name];
				if (!b) continue;
				b.rotation.set(t[0], t[1], t[2]);
				if (t.length === 4) b.scale.setScalar(t[3]!);
			}
		}
	};
}

/** How finely shapes are made: 1 as built; lower for actors seen from afar (`lowDetail`). */
let DETAIL = 1;
export const detail = () => DETAIL;
const fine = (n: number, least: number) => Math.max(least, Math.round(n * DETAIL));
/** Build with coarser shapes — the same actor, a fraction of its vertices, for drawing far off. */
export function lowDetail<T>(build: () => T, detail = 0.45): T {
	const was = DETAIL;
	DETAIL = detail;
	try {
		return build();
	} finally {
		DETAIL = was;
	}
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), eb = new THREE.Euler();
/**
 * Between two poses: the root's place, and each bone turned t of the way from a to b along the shortest arc (its turns
 * as rotations, not three angles each run on its own: a neck going from grazing to walking swings up the way a neck
 * does, not through the odd tilts the angles pass on their own way), its size between.
 */
export function blend(a: Pose, b: Pose, t: number): Pose {
	const out: Pose = {};
	for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const x = (a[name] ?? [0, 0, 0, 1]) as number[], y = (b[name] ?? [0, 0, 0, 1]) as number[];
		if (name === 'root') {
			out[name] = [0, 1, 2].map((k) => (x[k] ?? 0) + ((y[k] ?? 0) - (x[k] ?? 0)) * t) as V3;
			continue;
		}
		qa.setFromEuler(eb.set(x[0] ?? 0, x[1] ?? 0, x[2] ?? 0));
		qb.setFromEuler(eb.set(y[0] ?? 0, y[1] ?? 0, y[2] ?? 0));
		eb.setFromQuaternion(qa.slerp(qb, t));
		out[name] = [eb.x, eb.y, eb.z, (x[3] ?? 1) + ((y[3] ?? 1) - (x[3] ?? 1)) * t] as Turn;
	}
	return out;
}

/* ── the shapes actors are made of ─────────────────────────────────────────── */

/**
 * A limb from a to b: rounded at both ends, `r0` thick at a and `r1` at b, in rings enough to bend; `flat` squashes
 * it across (a hand: 0.5), `turn` turns that squash about the limb's axis.
 */
export function limb(a: V3, b: V3, r0: number, r1: number, { flat = 1, turn = 0, seg = 12 }: { flat?: number; turn?: number; seg?: number } = {}): THREE.BufferGeometry {
	const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
	const len = A.distanceTo(B);
	// the profile from b's end up to a's, so the lathe's faces look outwards
	const pts: THREE.Vector2[] = [];
	const cap = fine(5, 2), body = fine(Math.max(4, Math.round(len / 0.03)), 2);
	for (let i = 0; i <= cap; i++) {
		const t = (i / cap) * (Math.PI / 2);
		pts.push(new THREE.Vector2(Math.max(1e-4, Math.sin(t) * r1), -Math.cos(t) * r1));
	}
	for (let i = 1; i < body; i++) {
		const t = i / body;
		pts.push(new THREE.Vector2(r1 + (r0 - r1) * t, len * t));
	}
	for (let i = 0; i <= cap; i++) {
		const t = (i / cap) * (Math.PI / 2);
		pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(t) * r0), len + Math.sin(t) * r0));
	}
	const g = new THREE.LatheGeometry(pts, fine(seg, 5));
	g.applyMatrix4(new THREE.Matrix4().makeRotationY(turn));
	g.applyMatrix4(new THREE.Matrix4().makeScale(flat, 1, 1));
	g.applyMatrix4(new THREE.Matrix4().makeRotationY(-turn));
	// stand it from b to a
	g.applyMatrix4(new THREE.Matrix4().compose(B, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), A.clone().sub(B).normalize()), new THREE.Vector3(1, 1, 1)));
	return g;
}

/** An egg: a sphere `r` across, scaled by `s`, turned by `rot`, at `at`. */
export function egg(at: V3, s: V3, rot: V3 = [0, 0, 0], detail: [number, number] = [20, 14]): THREE.BufferGeometry {
	const g = new THREE.SphereGeometry(1, fine(detail[0], 6), fine(detail[1], 4));
	g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...s)));
	return g;
}

/** A cone (a beak, a horn, a fin): `r` at its base, `h` long, pointing along `dir` from its base at `at`. */
export function spike(at: V3, dir: V3, r: number, h: number, { flat = 1, seg = 10 }: { flat?: number; seg?: number } = {}): THREE.BufferGeometry {
	const g = new THREE.ConeGeometry(r, h, fine(seg, 4));
	g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, h / 2, 0));
	g.applyMatrix4(new THREE.Matrix4().makeScale(flat, 1, 1));
	g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()), new THREE.Vector3(1, 1, 1)));
	return g;
}

/**
 * A body lofted through rings up y: each ring an ellipse `w` wide and `d` deep at height `y`, its middle moved by `z`
 * (a chest forward, a back behind) — closed at both ends.
 */
export function loft(rings: { y: number; w: number; d: number; z?: number }[], seg = 28): THREE.BufferGeometry {
	seg = fine(seg, 8);
	const pos: number[] = [];
	const ring = (r: (typeof rings)[number]) => Array.from({ length: seg }, (_, j) => {
		const a = (j / seg) * Math.PI * 2;
		return [(Math.cos(a) * r.w) / 2, r.y, (r.z ?? 0) + (Math.sin(a) * r.d) / 2] as V3;
	});
	const all = rings.map(ring);
	const idx: number[] = [];
	all.forEach((r) => r.forEach((p) => pos.push(...p)));
	for (let i = 0; i < all.length - 1; i++)
		for (let j = 0; j < seg; j++) {
			const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + ((j + 1) % seg), dd = (i + 1) * seg + j;
			idx.push(a, c, b, a, dd, c);
		}
	// the ends: a point at each, the rings' middle
	const bottom = pos.length / 3, top = bottom + 1;
	const f = rings[0]!, l = rings[rings.length - 1]!;
	pos.push(0, f.y, f.z ?? 0, 0, l.y, l.z ?? 0);
	for (let j = 0; j < seg; j++) {
		idx.push(bottom, j, (j + 1) % seg);
		const last = (all.length - 1) * seg;
		idx.push(top, last + ((j + 1) % seg), last + j);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

/** A material for an actor: its colours in its vertices. */
export const skin = (roughness = 0.8, more: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, ...more });
/** A loop over `period` seconds: 0…1. */
export const loop = (t: number, period: number) => (((t / period) % 1) + 1) % 1;
