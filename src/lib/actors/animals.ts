/*
 * THE ANIMALS, RIGGED — every creature of Sandbox 4's land (src/lib/sandbox-2/interior/animals.ts: the hens, the
 * goats, the geese, the frogs, the bees, the carp and the tilapia) and the island's sheep, each built again as an
 * actor: a skeleton of bones under one skinned mesh (./rig.ts), so it walks, pecks, grazes, hops, flies or swims as
 * its kind does. Each to its real size, facing +z, on y 0. The worlds' own flocks stay what they are (instanced, a
 * hundred for a handful of draw calls); these are the ones a shot can come close to.
 */
import * as THREE from 'three';
import { egg, limb, loop, rig, skin, spike, type BoneSpec, type Cast, type Clip, type PartSpec, type V3 } from './rig';

const sides = [
	['L', 1],
	['R', -1]
] as const;
const max0 = (x: number) => Math.max(0, x);

/* ── the hen ──────────────────────────────────────────────────────────────── */

export function hen(coat = '#f1ece1'): Cast {
	const shade = new THREE.Color(coat).multiplyScalar(0.82).getStyle();
	const bones: BoneSpec[] = [
		{ name: 'body', at: [0, 0.25, 0] },
		{ name: 'neck', parent: 'body', at: [0, 0.31, 0.12] },
		{ name: 'head', parent: 'neck', at: [0, 0.42, 0.17] },
		{ name: 'tail', parent: 'body', at: [0, 0.3, -0.13] },
		...sides.flatMap(([s, x]): BoneSpec[] => [
			{ name: `wing${s}`, parent: 'body', at: [x * 0.11, 0.3, 0.06] },
			{ name: `leg${s}`, parent: 'body', at: [x * 0.05, 0.17, 0] },
			{ name: `shank${s}`, parent: `leg${s}`, at: [x * 0.05, 0.12, 0.01] },
			{ name: `toes${s}`, parent: `shank${s}`, at: [x * 0.05, 0.015, 0.02] }
		])
	];
	const parts: PartSpec[] = [
		{ geo: egg([0, 0.25, 0], [0.13, 0.135, 0.2]), color: coat, bone: 'body' },
		{ geo: egg([0, 0.235, 0.1], [0.1, 0.1, 0.09]), color: coat, bone: 'body' },
		{ geo: spike([0, 0.29, -0.11], [0, 0.85, -0.55], 0.075, 0.19, { flat: 0.45 }), color: shade, bone: 'tail' },
		{ geo: limb([0, 0.45, 0.18], [0, 0.29, 0.1], 0.045, 0.066), color: coat, chain: { bones: ['neck', 'head'], soft: 0.04 } },
		{ geo: egg([0, 0.445, 0.185], [0.052, 0.058, 0.066]), color: coat, bone: 'head' },
		{ geo: spike([0, 0.44, 0.235], [0, -0.25, 1], 0.017, 0.045), color: '#e2a93b', bone: 'head' },
		...[0.155, 0.185, 0.215].map((z, i): PartSpec => ({ geo: egg([0, 0.5 + (i === 1 ? 0.012 : 0), z], [0.01, 0.026, 0.018]), color: '#c7362c', bone: 'head' })),
		{ geo: egg([0, 0.402, 0.222], [0.012, 0.022, 0.012]), color: '#c7362c', bone: 'head' },
		...sides.flatMap(([s, x]): PartSpec[] => [
			{ geo: egg([x * 0.045, 0.456, 0.214], [0.009, 0.009, 0.006]), color: '#1a1a1a', bone: 'head' },
			{ geo: egg([x * 0.118, 0.27, 0.0], [0.03, 0.085, 0.15], [0.15, 0, 0]), color: shade, bone: `wing${s}` },
			{ geo: egg([x * 0.05, 0.165, 0.0], [0.042, 0.05, 0.046]), color: coat, bone: `leg${s}` },
			{ geo: limb([x * 0.05, 0.13, 0.01], [x * 0.05, 0.02, 0.02], 0.011, 0.01), color: '#e0a53a', chain: { bones: [`shank${s}`, `toes${s}`], soft: 0.015 } },
			...([[0, 1, 0.06], [0.55, 1, 0.055], [-0.55, 1, 0.055], [0, -1, 0.035]] as const).map(([dx, dz, h]): PartSpec => ({ geo: spike([x * 0.05, 0.01, 0.02], [dx, -0.05, dz], 0.006, h, { seg: 5 }), color: '#e0a53a', bone: `toes${s}` }))
		])
	];
	const r = rig(bones, parts, [skin(0.85)]);
	r.object.name = 'hen';
	const idle: Clip = (t) => {
		const k = Math.floor(t * 1.4);
		return { neck: [0.1 * Math.sin(t * 0.7), 0, 0], head: [0.12 * Math.sin(k * 1.7), 0.75 * Math.sin(k * 2.3), 0], tail: [0.05 * Math.sin(t * 2), 0, 0] };
	};
	const walk: Clip = (t) => {
		const f = loop(t, 0.5) * Math.PI * 2, s = Math.sin(f), c = Math.cos(f);
		return {
			root: [0, 0.01 * Math.abs(s), 0],
			body: [0, 0, 0.06 * s],
			legL: [-0.5 * s, 0, 0], legR: [0.5 * s, 0, 0],
			shankL: [0.2 + 0.5 * max0(c), 0, 0], shankR: [0.2 + 0.5 * max0(-c), 0, 0],
			toesL: [-0.2 - 0.5 * max0(c), 0, 0], toesR: [-0.2 - 0.5 * max0(-c), 0, 0],
			// the hen's head holds still in the air while the body walks under it, then jerks forward
			neck: [0.32 * Math.sin(2 * f + 1), 0, 0], head: [-0.32 * Math.sin(2 * f + 1), 0, 0]
		};
	};
	const peck: Clip = (t) => {
		const p = max0(Math.sin(t * 6)) ** 3;
		return { body: [0.5 + 0.1 * p, 0, 0], legL: [-0.5 - 0.1 * p, 0, 0], legR: [-0.5 - 0.1 * p, 0, 0], neck: [0.35 + 0.6 * p, 0, 0], head: [0.3 * p, 0, 0], tail: [-0.2, 0, 0] };
	};
	const flap: Clip = (t) => {
		const w = 0.5 + 0.5 * Math.sin(t * 16);
		return { root: [0, 0.015 * Math.sin(t * 16), 0], body: [-0.25, 0, 0], legL: [0.25, 0, 0], legR: [0.25, 0, 0], neck: [-0.2, 0, 0], wingL: [0, 0, 0.3 + 1.1 * w], wingR: [0, 0, -0.3 - 1.1 * w] };
	};
	return { rig: r, clips: { idle, walk, peck, flap }, first: 'peck' };
}

/* ── the goose ────────────────────────────────────────────────────────────── */

export function goose(coat = '#f4f2ec'): Cast {
	const wing = new THREE.Color(coat).multiplyScalar(0.9).getStyle(), orange = '#e8862c';
	const bones: BoneSpec[] = [
		{ name: 'body', at: [0, 0.34, 0] },
		{ name: 'neck1', parent: 'body', at: [0, 0.42, 0.2] },
		{ name: 'neck2', parent: 'neck1', at: [0, 0.56, 0.25] },
		{ name: 'head', parent: 'neck2', at: [0, 0.71, 0.27] },
		{ name: 'tail', parent: 'body', at: [0, 0.38, -0.25] },
		...sides.flatMap(([s, x]): BoneSpec[] => [
			{ name: `wing${s}`, parent: 'body', at: [x * 0.14, 0.4, 0.06] },
			{ name: `leg${s}`, parent: 'body', at: [x * 0.065, 0.22, 0] },
			{ name: `shank${s}`, parent: `leg${s}`, at: [x * 0.065, 0.17, 0.01] },
			{ name: `foot${s}`, parent: `shank${s}`, at: [x * 0.065, 0.015, 0.03] }
		])
	];
	const parts: PartSpec[] = [
		{ geo: egg([0, 0.34, 0], [0.16, 0.15, 0.3], [0.08, 0, 0]), color: coat, bone: 'body' },
		{ geo: egg([0, 0.3, 0.03], [0.14, 0.12, 0.24]), color: coat, bone: 'body' },
		{ geo: spike([0, 0.37, -0.24], [0, 0.35, -1], 0.09, 0.14, { flat: 0.6 }), color: coat, bone: 'tail' },
		{ geo: limb([0, 0.74, 0.28], [0, 0.38, 0.17], 0.033, 0.06), color: coat, chain: { bones: ['neck1', 'neck2', 'head'], soft: 0.05 } },
		{ geo: egg([0, 0.74, 0.29], [0.045, 0.048, 0.07]), color: coat, bone: 'head' },
		{ geo: spike([0, 0.73, 0.345], [0, -0.15, 1], 0.022, 0.085, { flat: 1.15 }), color: orange, bone: 'head' },
		...sides.flatMap(([s, x]): PartSpec[] => [
			{ geo: egg([x * 0.035, 0.755, 0.31], [0.008, 0.008, 0.008]), color: '#1b1b1b', bone: 'head' },
			{ geo: egg([x * 0.145, 0.37, -0.03], [0.035, 0.1, 0.24], [0.12, 0, 0]), color: wing, bone: `wing${s}` },
			{ geo: egg([x * 0.065, 0.22, 0], [0.05, 0.05, 0.05]), color: coat, bone: `leg${s}` },
			{ geo: limb([x * 0.065, 0.17, 0.01], [x * 0.065, 0.02, 0.03], 0.012, 0.011), color: orange, chain: { bones: [`shank${s}`, `foot${s}`], soft: 0.02 } },
			{ geo: egg([x * 0.065, 0.008, 0.07], [0.04, 0.006, 0.06]), color: orange, bone: `foot${s}` }
		])
	];
	const r = rig(bones, parts, [skin(0.8)]);
	r.object.name = 'goose';
	const idle: Clip = (t) => ({ neck1: [0.1 * Math.sin(t * 0.8), 0, 0], neck2: [-0.08 * Math.sin(t * 0.8), 0, 0], head: [0, 0.4 * Math.sin(t * 0.5), 0], tail: [0, 0.15 * Math.sin(t * 3), 0] });
	const walk: Clip = (t) => {
		const f = loop(t, 0.7) * Math.PI * 2, s = Math.sin(f), c = Math.cos(f);
		return {
			root: [0, 0.012 * Math.abs(s), 0],
			body: [0, 0, 0.12 * s],
			legL: [-0.45 * s, 0, -0.12 * s], legR: [0.45 * s, 0, -0.12 * s],
			shankL: [0.15 + 0.4 * max0(c), 0, 0], shankR: [0.15 + 0.4 * max0(-c), 0, 0],
			footL: [-0.15 - 0.4 * max0(c), 0, 0], footR: [-0.15 - 0.4 * max0(-c), 0, 0],
			neck1: [0.12 * Math.sin(2 * f), 0, 0], tail: [0, 0.2 * s, 0]
		};
	};
	const graze: Clip = (t) => ({ body: [0.25, 0, 0], legL: [-0.25, 0, 0], legR: [-0.25, 0, 0], neck1: [1.0 + 0.05 * Math.sin(t * 5), 0, 0], neck2: [0.75, 0, 0], head: [0.25 + 0.25 * max0(Math.sin(t * 6)), 0, 0] });
	const hiss: Clip = (t) => ({ neck1: [0.55, 0, 0], neck2: [-0.45 + 0.08 * Math.sin(t * 9), 0, 0], head: [-0.2, 0.15 * Math.sin(t * 9), 0], wingL: [0, 0, 0.5 + 0.3 * Math.sin(t * 6)], wingR: [0, 0, -0.5 - 0.3 * Math.sin(t * 6)] });
	return { rig: r, clips: { idle, walk, graze, hiss }, first: 'walk' };
}

/* ── the goat and the sheep: four legs, a neck, a head ───────────────────── */

type Quad = { body: V3; size: V3; neckTo: V3; head: V3; headSize: V3; hip: number; legX: number; front: number; back: number; legR: [number, number] };

function quadBones(q: Quad): BoneSpec[] {
	const legs = [
		['FL', q.legX, q.front], ['FR', -q.legX, q.front], ['BL', q.legX, q.back], ['BR', -q.legX, q.back]
	] as const;
	return [
		{ name: 'body', at: q.body },
		{ name: 'neck', parent: 'body', at: [0, q.body[1] + 0.12, q.front + 0.06] },
		{ name: 'head', parent: 'neck', at: q.neckTo },
		{ name: 'tail', parent: 'body', at: [0, q.body[1] + 0.12, q.back - 0.16] },
		...legs.flatMap(([s, x, z]): BoneSpec[] => [
			{ name: `upper${s}`, parent: 'body', at: [x, q.hip, z] },
			{ name: `lower${s}`, parent: `upper${s}`, at: [x, q.hip * 0.52, z + (s[0] === 'B' ? -0.03 : 0.01)] },
			{ name: `hoof${s}`, parent: `lower${s}`, at: [x, 0.05, z] }
		])
	];
}

function quadLegs(q: Quad, leg: string, hoof: string): PartSpec[] {
	const legs = [
		['FL', q.legX, q.front], ['FR', -q.legX, q.front], ['BL', q.legX, q.back], ['BR', -q.legX, q.back]
	] as const;
	return legs.flatMap(([s, x, z]): PartSpec[] => {
		const knee: V3 = [x, q.hip * 0.52, z + (s[0] === 'B' ? -0.03 : 0.01)];
		return [
			{ geo: limb([x, q.hip + 0.05, z], knee, q.legR[0], q.legR[1]), color: leg, chain: { bones: [`upper${s}`, `lower${s}`], soft: 0.05 } },
			{ geo: limb(knee, [x, 0.07, z], q.legR[1], q.legR[1] * 0.78), color: leg, chain: { bones: [`lower${s}`, `hoof${s}`], soft: 0.04 } },
			{ geo: egg([x, 0.03, z + 0.01], [q.legR[1] * 0.85, 0.035, q.legR[1]]), color: hoof, bone: `hoof${s}` }
		];
	});
}

/** a four-legged walk: the diagonal pairs together (a near fore with its far hind) */
const quadWalk = (period: number, swing: number): Clip => (t) => {
	const f = loop(t, period) * Math.PI * 2, s = Math.sin(f), c = Math.cos(f);
	const leg = (dir: number, cc: number) => ({ u: [-swing * dir * s, 0, 0] as V3, l: [0.45 * max0(cc * dir) ** 2, 0, 0] as V3 });
	const a = leg(1, c), b = leg(-1, c);
	return {
		root: [0, 0.012 * Math.cos(2 * f), 0],
		body: [0, 0, 0.025 * s],
		upperFL: a.u, lowerFL: a.l, upperBR: a.u, lowerBR: a.l,
		upperFR: b.u, lowerFR: b.l, upperBL: b.u, lowerBL: b.l,
		neck: [0.08 * Math.sin(2 * f), 0, 0],
		tail: [0, 0.2 * s, 0]
	};
};
const quadGraze = (down: number): Clip => (t) => ({
	neck: [down + 0.03 * Math.sin(t * 3), 0.08 * Math.sin(t * 0.5), 0],
	head: [0.3 + 0.1 * max0(Math.sin(t * 5)), 0, 0],
	upperFL: [-0.08, 0, 0], upperFR: [-0.08, 0, 0],
	tail: [0, 0.25 * Math.sin(t * 4), 0]
});
const quadIdle: Clip = (t) => {
	const k = Math.floor(t * 0.6);
	return { neck: [0.05 * Math.sin(t * 0.6), 0, 0], head: [0.1 * Math.sin(k * 1.3), 0.45 * Math.sin(k * 2.1), 0], tail: [0, 0.35 * max0(Math.sin(t * 2.5)) ** 4, 0], root: [0, 0.003 * Math.sin(t * 1.5), 0] };
};

export function goat(coat = '#f1ede4'): Cast {
	const q: Quad = { body: [0, 0.72, 0], size: [0.23, 0.25, 0.48], neckTo: [0, 1.06, 0.5], head: [0, 1.08, 0.58], headSize: [0.075, 0.085, 0.16], hip: 0.64, legX: 0.12, front: 0.3, back: -0.32, legR: [0.06, 0.038] };
	const horn = '#5a4a3a', light = new THREE.Color(coat).lerp(new THREE.Color('#ffffff'), 0.4).getStyle();
	const parts: PartSpec[] = [
		{ geo: egg([0, 0.74, 0], q.size), color: coat, bone: 'body' },
		{ geo: egg([0, 0.72, 0.25], [0.18, 0.21, 0.2]), color: coat, bone: 'body' },
		{ geo: egg([0, 0.76, -0.28], [0.19, 0.2, 0.2]), color: coat, bone: 'body' },
		{ geo: limb([0, 1.05, 0.5], [0, 0.8, 0.3], 0.065, 0.1), color: coat, chain: { bones: ['neck', 'head'], soft: 0.06 } },
		{ geo: egg(q.head, q.headSize, [0.55, 0, 0]), color: coat, bone: 'head' },
		{ geo: egg([0, 1.0, 0.68], [0.055, 0.055, 0.07]), color: coat, bone: 'head' },
		{ geo: spike([0, 0.98, 0.66], [0, -1, 0.15], 0.025, 0.1), color: light, bone: 'head' },
		...sides.flatMap(([, x]): PartSpec[] => [
			{ geo: egg([x * 0.1, 1.12, 0.52], [0.07, 0.022, 0.035], [0, 0, x * 0.3]), color: coat, bone: 'head' },
			{ geo: spike([x * 0.04, 1.16, 0.52], [x * 0.15, 0.6, -0.8], 0.022, 0.2), color: horn, bone: 'head' },
			{ geo: egg([x * 0.06, 1.12, 0.6], [0.012, 0.012, 0.012]), color: '#1d1a16', bone: 'head' }
		]),
		{ geo: spike([0, 0.84, -0.46], [0, 0.7, -0.6], 0.035, 0.12), color: coat, bone: 'tail' },
		...quadLegs(q, coat, '#2e2620')
	];
	const r = rig(quadBones(q), parts, [skin(0.85)]);
	r.object.name = 'goat';
	return { rig: r, clips: { idle: quadIdle, walk: quadWalk(1.0, 0.35), graze: quadGraze(1.05) }, first: 'graze' };
}

export function sheep(wool = '#ece6d8', face = '#2f2a26'): Cast {
	const q: Quad = { body: [0, 0.66, 0], size: [0.28, 0.27, 0.5], neckTo: [0, 0.86, 0.46], head: [0, 0.88, 0.53], headSize: [0.07, 0.08, 0.13], hip: 0.55, legX: 0.12, front: 0.28, back: -0.3, legR: [0.055, 0.04] };
	// the fleece: a core, and tufts all over it (the same every time)
	let seed = 11;
	const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	const tufts: PartSpec[] = Array.from({ length: 22 }, () => {
		const a = rand() * Math.PI * 2, b = (rand() - 0.35) * Math.PI * 0.75;
		const p: V3 = [Math.cos(a) * Math.cos(b) * 0.25, 0.66 + Math.sin(b) * 0.23, Math.sin(a) * Math.cos(b) * 0.46];
		const r = 0.08 + rand() * 0.05;
		const tone = new THREE.Color(wool).multiplyScalar(0.94 + rand() * 0.08).getStyle();
		return { geo: egg(p, [r, r * 0.9, r], [0, 0, 0], [12, 9]), color: tone, bone: 'body' };
	});
	const parts: PartSpec[] = [
		{ geo: egg([0, 0.66, 0], q.size), color: wool, bone: 'body' },
		...tufts,
		{ geo: limb([0, 0.86, 0.46], [0, 0.72, 0.3], 0.07, 0.11), color: wool, chain: { bones: ['neck', 'head'], soft: 0.06 } },
		{ geo: egg(q.head, q.headSize, [0.6, 0, 0]), color: face, bone: 'head' },
		{ geo: egg([0, 0.95, 0.48], [0.075, 0.055, 0.07]), color: wool, bone: 'head' },
		...sides.flatMap(([, x]): PartSpec[] => [
			{ geo: egg([x * 0.095, 0.93, 0.48], [0.065, 0.02, 0.03], [0, 0, x * -0.15]), color: face, bone: 'head' },
			{ geo: egg([x * 0.052, 0.92, 0.58], [0.011, 0.011, 0.011]), color: '#111', bone: 'head' }
		]),
		{ geo: egg([0, 0.7, -0.47], [0.05, 0.08, 0.05]), color: wool, bone: 'tail' },
		...quadLegs(q, face, '#1f1b18')
	];
	const r = rig(quadBones(q), parts, [skin(0.95)]);
	r.object.name = 'sheep';
	return { rig: r, clips: { idle: quadIdle, walk: quadWalk(1.1, 0.3), graze: quadGraze(0.95) }, first: 'graze' };
}

/* ── the frog ─────────────────────────────────────────────────────────────── */

export function frog(coat = '#5a8a35'): Cast {
	const belly = '#e2d382';
	const bones: BoneSpec[] = [
		{ name: 'body', at: [0, 0.04, 0] },
		{ name: 'head', parent: 'body', at: [0, 0.05, 0.035] },
		{ name: 'throat', parent: 'head', at: [0, 0.03, 0.05] },
		...sides.flatMap(([s, x]): BoneSpec[] => [
			{ name: `arm${s}`, parent: 'body', at: [x * 0.035, 0.035, 0.035] },
			{ name: `hand${s}`, parent: `arm${s}`, at: [x * 0.045, 0.008, 0.055] },
			{ name: `thigh${s}`, parent: 'body', at: [x * 0.035, 0.035, -0.035] },
			{ name: `shin${s}`, parent: `thigh${s}`, at: [x * 0.075, 0.03, 0.01] },
			{ name: `foot${s}`, parent: `shin${s}`, at: [x * 0.06, 0.01, -0.045] }
		])
	];
	const parts: PartSpec[] = [
		{ geo: egg([0, 0.042, -0.005], [0.048, 0.03, 0.06], [-0.15, 0, 0]), color: coat, bone: 'body' },
		{ geo: egg([0, 0.03, 0.0], [0.04, 0.02, 0.05]), color: belly, bone: 'body' },
		{ geo: egg([0, 0.055, 0.045], [0.04, 0.024, 0.035]), color: coat, bone: 'head' },
		{ geo: egg([0, 0.03, 0.055], [0.022, 0.012, 0.018]), color: belly, bone: 'throat' },
		...sides.flatMap(([s, x]): PartSpec[] => [
			{ geo: egg([x * 0.022, 0.075, 0.05], [0.012, 0.012, 0.012]), color: '#c9b24a', bone: 'head' },
			{ geo: egg([x * 0.026, 0.077, 0.058], [0.006, 0.006, 0.005]), color: '#111', bone: 'head' },
			{ geo: limb([x * 0.035, 0.035, 0.035], [x * 0.045, 0.008, 0.055], 0.009, 0.007), color: coat, chain: { bones: [`arm${s}`, `hand${s}`], soft: 0.01 } },
			{ geo: egg([x * 0.047, 0.004, 0.062], [0.012, 0.003, 0.011]), color: coat, bone: `hand${s}` },
			{ geo: limb([x * 0.035, 0.035, -0.035], [x * 0.075, 0.03, 0.01], 0.016, 0.012), color: coat, chain: { bones: [`thigh${s}`, `shin${s}`], soft: 0.012 } },
			{ geo: limb([x * 0.075, 0.03, 0.01], [x * 0.06, 0.01, -0.045], 0.011, 0.008), color: coat, chain: { bones: [`shin${s}`, `foot${s}`], soft: 0.01 } },
			{ geo: egg([x * 0.065, 0.004, -0.02], [0.016, 0.003, 0.03], [0, x * -0.3, 0]), color: coat, bone: `foot${s}` }
		])
	];
	const r = rig(bones, parts, [skin(0.45)]);
	r.object.name = 'frog';
	const idle: Clip = (t) => ({ throat: [0, 0, 0, 1 + 0.25 * max0(Math.sin(t * 5))], root: [0, 0.001 * Math.sin(t * 5), 0] });
	const croak: Clip = (t) => ({ throat: [0, 0, 0, 1 + 0.9 * max0(Math.sin(t * 4)) ** 2], head: [-0.12 * max0(Math.sin(t * 4)), 0, 0] });
	// a hop: crouch, the long legs thrown back straight, an arc through the air, landing on the hands
	const hop: Clip = (t) => {
		const u = loop(t, 1.4);
		const air = u > 0.25 && u < 0.6 ? (u - 0.25) / 0.35 : -1;
		const kick = air >= 0 ? Math.sin(Math.PI * Math.min(1, air * 1.6)) : u <= 0.25 ? -0.3 * Math.sin((Math.PI * u) / 0.25) : 0;
		const e = Math.max(0, kick);
		return {
			root: [0, air >= 0 ? 0.09 * Math.sin(Math.PI * air) : 0, 0],
			body: [air >= 0 ? -0.35 * Math.sin(Math.PI * air) : 0, 0, 0],
			thighL: [0.9 * e, -0.6 * e, 0], thighR: [0.9 * e, 0.6 * e, 0],
			shinL: [-1.1 * e, 0.5 * e, 0], shinR: [-1.1 * e, -0.5 * e, 0],
			footL: [0.6 * e, 0, 0], footR: [0.6 * e, 0, 0],
			armL: [-0.5 * e, 0, 0], armR: [-0.5 * e, 0, 0]
		};
	};
	return { rig: r, clips: { idle, hop, croak }, first: 'hop' };
}

/* ── the bee ─────────────────────────────────────────────────────────────── */

export function bee(): Cast {
	const bones: BoneSpec[] = [
		{ name: 'thorax', at: [0, 0.012, 0] },
		{ name: 'head', parent: 'thorax', at: [0, 0.0125, 0.0035] },
		{ name: 'abdomen', parent: 'thorax', at: [0, 0.0115, -0.0025] },
		{ name: 'wingL', parent: 'thorax', at: [0.0015, 0.0145, 0.0005] },
		{ name: 'wingR', parent: 'thorax', at: [-0.0015, 0.0145, 0.0005] }
	];
	const stripe = (p: THREE.Vector3) => (Math.floor((-p.z - 0.0032) / 0.0011) % 2 === 0 ? '#e8b23a' : '#2a2218');
	const parts: PartSpec[] = [
		{ geo: egg([0, 0.012, 0], [0.0026, 0.0026, 0.003]), color: '#8a6a2e', bone: 'thorax' },
		{ geo: egg([0, 0.0122, 0.0042], [0.0018, 0.0019, 0.0014]), color: '#2a2218', bone: 'head' },
		{ geo: egg([0, 0.0112, -0.0058], [0.0027, 0.0025, 0.0045], [0.15, 0, 0]), color: (p) => (p.z > -0.0032 ? '#2a2218' : stripe(p)), bone: 'abdomen' },
		{ geo: spike([0, 0.0108, -0.0101], [0, -0.2, -1], 0.0004, 0.0012, { seg: 6 }), color: '#2a2218', bone: 'abdomen' },
		...sides.flatMap(([s, x]): PartSpec[] => [
			{ geo: egg([x * 0.0013, 0.0127, 0.0046], [0.0007, 0.0011, 0.0006]), color: '#151210', bone: 'head' },
			{ geo: limb([x * 0.0012, 0.0158, 0.0072], [x * 0.0006, 0.0138, 0.0052], 0.00016, 0.00016, { seg: 5 }), color: '#2a2218', bone: 'head' },
			// the wings: a big pair and a small, glass
			{ geo: egg([x * 0.0036, 0.0148, -0.0012], [0.0034, 0.0003, 0.0016], [0, x * 0.35, 0]), color: '#ffffff', bone: `wing${s}`, mat: 1 },
			{ geo: egg([x * 0.003, 0.0145, -0.0028], [0.0022, 0.0002, 0.0011], [0, x * 0.6, 0]), color: '#ffffff', bone: `wing${s}`, mat: 1 },
			// six legs hanging under it
			...[0.0012, 0, -0.0013].map((z, i): PartSpec => ({ geo: limb([x * 0.0012, 0.0103, z], [x * (0.0028 + i * 0.0004), 0.0072 - i * 0.0004, z - 0.0006 - i * 0.0004], 0.00022, 0.00016, { seg: 5 }), color: '#2a2218', bone: 'thorax' }))
		])
	];
	const glass = new THREE.MeshPhysicalMaterial({ color: '#f4f8ff', roughness: 0.15, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
	const r = rig(bones, parts, [skin(0.7), glass]);
	r.object.name = 'bee';
	const flutter = (t: number) => 0.5 + 0.5 * Math.sin(t * 90);
	const hover: Clip = (t) => ({ root: [0.0008 * Math.sin(t * 1.3), 0.0015 * Math.sin(t * 5), 0], thorax: [0.1 + 0.05 * Math.sin(t * 2), 0.2 * Math.sin(t * 0.7), 0], abdomen: [0.12 * Math.sin(t * 4), 0, 0], wingL: [0, 0, 0.2 + 0.9 * flutter(t)], wingR: [0, 0, -0.2 - 0.9 * flutter(t)] });
	const fly: Clip = (t) => ({ ...hover(t), thorax: [0.45, 0, 0.15 * Math.sin(t * 1.5)], abdomen: [-0.2, 0, 0] });
	return { rig: r, clips: { hover, fly }, first: 'hover' };
}

/* ── the fish: a carp and a tilapia ──────────────────────────────────────── */

function fish(name: string, len: number, back: string, belly: string, bars: string | null, barbels: boolean): Cast {
	const L = len, y = 0.15, z = (k: number) => L * k;
	const bones: BoneSpec[] = [
		{ name: 'head', at: [0, y, z(0.25)] },
		{ name: 'body1', parent: 'head', at: [0, y, z(0.08)] },
		{ name: 'body2', parent: 'body1', at: [0, y, z(-0.12)] },
		{ name: 'tail', parent: 'body2', at: [0, y, z(-0.32)] },
		{ name: 'fin', parent: 'tail', at: [0, y, z(-0.45)] }
	];
	const colour = (p: THREE.Vector3) => {
		const top = p.y > y + L * 0.03;
		if (bars && top && Math.floor((p.z / L + 1) * 9) % 2 === 0) return bars;
		return top ? back : belly;
	};
	const parts: PartSpec[] = [
		{ geo: egg([0, y, 0], [L * 0.12, L * 0.18, L * 0.5], [0, 0, 0], [24, 16]), color: colour, chain: { bones: ['head', 'body1', 'body2', 'tail'], soft: L * 0.06 } },
		{ geo: spike([0, y, z(-0.42)], [0, 0, -1], L * 0.16, L * 0.22, { flat: 0.12, seg: 16 }), color: back, bone: 'fin' },
		{ geo: spike([0, y + L * 0.15, z(0.02)], [0, 1, -0.7], L * 0.1, L * 0.14, { flat: 0.15 }), color: back, bone: 'body1' },
		{ geo: spike([0, y - L * 0.13, z(-0.18)], [0, -1, -0.5], L * 0.05, L * 0.07, { flat: 0.15 }), color: belly, bone: 'body2' },
		...sides.flatMap(([, x]): PartSpec[] => [
			{ geo: egg([x * L * 0.11, y - L * 0.06, z(0.18)], [L * 0.01, L * 0.03, L * 0.07], [0.5, x * 0.4, 0]), color: belly, bone: 'head' },
			{ geo: egg([x * L * 0.085, y + L * 0.04, z(0.36)], [L * 0.022, L * 0.022, L * 0.016]), color: '#d9b45a', bone: 'head' },
			{ geo: egg([x * L * 0.092, y + L * 0.04, z(0.37)], [L * 0.012, L * 0.012, L * 0.01]), color: '#111', bone: 'head' },
			...(barbels ? [{ geo: limb([x * L * 0.03, y - L * 0.02, z(0.47)], [x * L * 0.06, y - L * 0.07, z(0.5)], L * 0.004, L * 0.003, { seg: 5 }), color: belly, bone: 'head' } as PartSpec] : [])
		]),
		{ geo: egg([0, y - L * 0.015, z(0.49)], [L * 0.03, L * 0.02, L * 0.015]), color: '#3a2a22', bone: 'head' }
	];
	const r = rig(bones, parts, [skin(0.35, { metalness: 0.15 })]);
	r.object.name = name;
	const wave = (t: number, bias: number) => {
		const w = loop(t, 0.65) * Math.PI * 2;
		return { head: [0, 0.05 * Math.sin(w) + bias, 0], body1: [0, 0.1 * Math.sin(w - 0.9) + bias, 0], body2: [0, 0.18 * Math.sin(w - 1.8) + bias, 0], tail: [0, 0.28 * Math.sin(w - 2.7) + bias, 0], fin: [0, 0.32 * Math.sin(w - 3.6), 0], root: [0, 0.01 * Math.sin(t * 1.3), 0] } as ReturnType<Clip>;
	};
	return { rig: r, clips: { swim: (t) => wave(t, 0), turn: (t) => wave(t, 0.12 * Math.sin(t * 0.8)) }, first: 'swim' };
}

export const carp = () => fish('carp', 0.42, '#7a5a2a', '#d0a24e', null, true);
export const tilapia = () => fish('tilapia', 0.28, '#6c7470', '#c9ccc4', '#545b58', false);
