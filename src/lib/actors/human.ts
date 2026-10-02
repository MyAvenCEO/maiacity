/*
 * THE STAND-IN — a person of 1.70 m, bald, to block a shot with before its actor is in it (a film's second team): never
 * a likeness of anyone, but a person — a head with a face that shows where it looks, a T-shirt, jeans, trainers —
 * rigged head to toe so it takes any pose and any move: 17 bones (the hips, the spine, the chest, the neck, the head;
 * each arm's upper arm, forearm and hand; each leg's thigh, shin and foot), one skinned mesh over them, every joint
 * bending smoothly.
 *
 * Its measures are taken for 1.80 m and scaled to its height (`HEIGHT`, or any other). Built standing, facing +z, its
 * feet on y 0. Its poses are turns of its bones from there (./rig.ts); its left is +x.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { blend, egg, limb, loft, loop, rig, skin, spike, type BoneSpec, type Cast, type Clip, type PartSpec, type Pose, type V3 } from './rig';

/** how tall it is (m) */
export const HEIGHT = 1.7;
/** the height its measures below are for: the top of its head, as built for a person of 1.80 m */
const MEASURED = 1.823;
/** the edge it sits on (a bed's, a chair's), m */
const SEAT = 0.5;

/** what the stand-in wears (and its skin, its brows) */
export type Look = { skin: string; brows: string; shirt: string; trousers: string; belt: string; shoes: string; soles: string };
export const LOOK: Look = { skin: '#d6b094', brows: '#3a2a1f', shirt: '#3c4452', trousers: '#47566c', belt: '#2d251f', shoes: '#2a2a2d', soles: '#e9e6df' };

const sides = [
	['L', 1],
	['R', -1]
] as const;

const BONES: BoneSpec[] = [
	{ name: 'hips', at: [0, 0.98, 0] },
	{ name: 'spine', parent: 'hips', at: [0, 1.1, -0.01] },
	{ name: 'chest', parent: 'spine', at: [0, 1.27, -0.01] },
	{ name: 'neck', parent: 'chest', at: [0, 1.52, -0.015] },
	{ name: 'head', parent: 'neck', at: [0, 1.62, 0] },
	...sides.flatMap(([s, x]): BoneSpec[] => [
		{ name: `upperArm${s}`, parent: 'chest', at: [x * 0.19, 1.45, -0.01] },
		{ name: `forearm${s}`, parent: `upperArm${s}`, at: [x * 0.2, 1.17, -0.02] },
		{ name: `hand${s}`, parent: `forearm${s}`, at: [x * 0.205, 0.915, 0] },
		{ name: `thigh${s}`, parent: 'hips', at: [x * 0.095, 0.93, 0] },
		{ name: `shin${s}`, parent: `thigh${s}`, at: [x * 0.1, 0.5, 0.01] },
		{ name: `foot${s}`, parent: `shin${s}`, at: [x * 0.1, 0.085, -0.005] }
	])
];

function parts(k: Look): PartSpec[] {
	const box = (w: number, h: number, d: number, r: number, at: V3) => {
		const g = new RoundedBoxGeometry(w, h, d, 3, r);
		g.translate(...at);
		return g;
	};
	return [
		// the body: hips to shoulders, the jeans up to the belt, the T-shirt above it
		{
			geo: loft([
				{ y: 0.83, w: 0.02, d: 0.02 },
				{ y: 0.845, w: 0.2, d: 0.14 },
				{ y: 0.875, w: 0.31, d: 0.2 },
				{ y: 0.94, w: 0.355, d: 0.23, z: -0.005 },
				{ y: 1.0, w: 0.33, d: 0.21 },
				{ y: 1.07, w: 0.305, d: 0.2, z: 0.005 },
				{ y: 1.17, w: 0.32, d: 0.215, z: 0.01 },
				{ y: 1.28, w: 0.36, d: 0.235, z: 0.015 },
				{ y: 1.37, w: 0.39, d: 0.225, z: 0.005 },
				{ y: 1.43, w: 0.42, d: 0.2, z: -0.008 },
				{ y: 1.465, w: 0.36, d: 0.17, z: -0.012 },
				{ y: 1.495, w: 0.26, d: 0.14, z: -0.015 },
				{ y: 1.53, w: 0.14, d: 0.12, z: -0.015 },
				{ y: 1.545, w: 0.02, d: 0.02, z: -0.015 }
			]),
			color: (p) => (p.y < 0.985 ? k.trousers : p.y < 1.012 ? k.belt : k.shirt),
			chain: { bones: ['hips', 'spine', 'chest', 'neck'], soft: 0.07 }
		},
		{ geo: limb([0, 1.64, 0], [0, 1.47, -0.015], 0.05, 0.058), color: k.skin, chain: { bones: ['chest', 'neck', 'head'], soft: 0.04 } },
		// the head, bald: a skull, a jaw, ears; the face — eyes, brows, a nose, a mouth — so it shows where it looks
		{ geo: egg([0, 1.705, 0.012], [0.093, 0.118, 0.105], [0, 0, 0], [28, 20]), color: k.skin, bone: 'head' },
		{ geo: egg([0, 1.648, 0.045], [0.07, 0.05, 0.07]), color: k.skin, bone: 'head' },
		...sides.flatMap(([, x]): PartSpec[] => [
			{ geo: egg([x * 0.093, 1.695, 0.0], [0.016, 0.03, 0.022]), color: k.skin, bone: 'head' },
			{ geo: egg([x * 0.034, 1.712, 0.098], [0.012, 0.009, 0.006]), color: '#2b2622', bone: 'head' },
			{ geo: egg([x * 0.035, 1.736, 0.101], [0.022, 0.005, 0.008], [0, 0, x * -0.12]), color: k.brows, bone: 'head' }
		]),
		{ geo: spike([0, 1.692, 0.108], [0, -0.35, 1], 0.016, 0.035, { seg: 12 }), color: k.skin, bone: 'head' },
		{ geo: egg([0, 1.655, 0.1], [0.022, 0.004, 0.006]), color: '#9a6a5a', bone: 'head' },
		// each arm: the sleeve over the top of it, the bare forearm, a hand with its thumb
		...sides.flatMap(([s, x]): PartSpec[] => [
			{ geo: limb([x * 0.185, 1.43, -0.01], [x * 0.2, 1.17, -0.02], 0.047, 0.04), color: (p) => (p.y > 1.32 ? k.shirt : k.skin), chain: { bones: [`upperArm${s}`, `forearm${s}`], soft: 0.06 } },
			{ geo: limb([x * 0.2, 1.17, -0.02], [x * 0.205, 0.915, 0], 0.041, 0.031), color: k.skin, chain: { bones: [`forearm${s}`, `hand${s}`], soft: 0.05 } },
			{ geo: limb([x * 0.205, 0.915, 0], [x * 0.207, 0.74, 0.012], 0.034, 0.028, { flat: 0.48 }), color: k.skin, chain: { bones: [`hand${s}`], soft: 0.03, tip: [x * 0.207, 0.72, 0.012] } },
			{ geo: limb([x * 0.2, 0.9, 0.028], [x * 0.19, 0.83, 0.055], 0.014, 0.012), color: k.skin, bone: `hand${s}` },
			// each leg: the jeans down to the ankle, a trainer on a white sole
			{ geo: limb([x * 0.095, 0.96, 0], [x * 0.1, 0.5, 0.01], 0.088, 0.058), color: k.trousers, chain: { bones: [`thigh${s}`, `shin${s}`], soft: 0.08 } },
			{ geo: limb([x * 0.1, 0.5, 0.01], [x * 0.1, 0.09, -0.005], 0.056, 0.045), color: k.trousers, chain: { bones: [`shin${s}`, `foot${s}`], soft: 0.06 } },
			{ geo: box(0.1, 0.085, 0.27, 0.035, [x * 0.1, 0.05, 0.065]), color: k.shoes, chain: { bones: [`foot${s}`], soft: 0.04, tip: [x * 0.1, 0.03, 0.2] } },
			{ geo: box(0.104, 0.018, 0.274, 0.008, [x * 0.1, 0.009, 0.065]), color: k.soles, bone: `foot${s}` }
		])
	];
}

/** the bones and the parts, measured for 1.80 m, scaled by s */
function scaled(s: number, k: Look): { bones: BoneSpec[]; parts: PartSpec[] } {
	const m = (v: V3): V3 => [v[0] * s, v[1] * s, v[2] * s];
	return {
		bones: BONES.map((b) => ({ ...b, at: m(b.at) })),
		parts: parts(k).map((p) => ({
			...p,
			geo: p.geo.scale(s, s, s),
			// a colour by where a vertex is: asked where it would be at 1.80 m
			color: typeof p.color === 'string' ? p.color : ((f) => (v: THREE.Vector3) => f(v.clone().divideScalar(s)))(p.color),
			...(p.chain ? { chain: { ...p.chain, soft: (p.chain.soft ?? 0.05) * s, ...(p.chain.tip ? { tip: m(p.chain.tip) } : {}) } } : {})
		}))
	};
}

/* ── its poses: turns of its bones from standing (radians; +x forward is −, the left arm out is +z) ────────────── */

const relaxed: Pose = { upperArmL: [0.02, 0, 0.07], upperArmR: [0.02, 0, -0.07], forearmL: [-0.1, 0, 0], forearmR: [-0.1, 0, 0] };

/** Its poses at a height `s` of 1.80 m: those that sit or lie are worked out from its measure, so it sits on a 0.5 m
 *  edge with its feet on the floor at any height. */
export function posesFor(s: number): Record<string, Pose> {
	const thigh = 0.43 * s, knee = 0.5 * s; // a thigh's length; a knee's height with its shin upright
	const slope = (hip: number) => Math.asin(THREE.MathUtils.clamp((hip - knee) / thigh, -0.9, 0.9)); // the thighs down to that knee
	// sitting: the hip joints 7 cm over the edge (at 1.80 m), the thighs sloping down to knees over the feet
	const sitHip = SEAT + 0.07 * s, a = slope(sitHip);
	const seated: Pose = { root: [0, sitHip + 0.05 * s - 0.98 * s, 0], thighL: [a - Math.PI / 2, 0, 0.04], thighR: [a - Math.PI / 2, 0, -0.04], shinL: [Math.PI / 2 - a, 0, 0], shinR: [Math.PI / 2 - a, 0, 0] };
	// fallen back: the hips on the edge, turned back 1.52 rad, the thighs (and the shins) kept as they sat
	const fallHips = SEAT + 0.08 * s, b = slope(fallHips), back = -1.52;
	return {
		stand: relaxed,
		// sitting on the edge, hands on the thighs
		sit: { ...seated, spine: [0.05, 0, 0], chest: [0.03, 0, 0], head: [0.08, 0, 0], upperArmL: [-0.45, 0, -0.05], upperArmR: [-0.45, 0, 0.05], forearmL: [-0.25, -1.2, 0], forearmR: [-0.25, 1.2, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0] },
		// sitting on the edge, bent forward, elbows on the knees, looking down at its hands
		'sit, elbows on knees': { ...seated, spine: [0.45, 0, 0], chest: [0.4, 0, 0], neck: [0.1, 0, 0], head: [0.2, 0, 0], upperArmL: [-0.85, 0, -0.03], upperArmR: [-0.85, 0, 0.03], forearmL: [-1.3, 0, -0.45], forearmR: [-1.3, 0, 0.45], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0] },
		// fallen back from that edge: the legs still over it, the back on the bed, arms out, the face to the ceiling
		fallen: { root: [0, fallHips - 0.98 * s, 0], hips: [back, 0, 0], thighL: [b - Math.PI / 2 - back, 0, 0.05], thighR: [b - Math.PI / 2 - back, 0, -0.05], shinL: [Math.PI / 2 - b, 0, 0], shinR: [Math.PI / 2 - b, 0, 0], chest: [0.03, 0, 0], head: [-0.12, 0.18, 0], upperArmL: [0, 0, 1.25], upperArmR: [0, 0, -1.25], forearmL: [0, 0, 0.35], forearmR: [0, 0, -0.35] },
		// lying on its back on the floor
		lie: { root: [0, (0.12 - 0.98) * s, 0], hips: [-Math.PI / 2, 0, 0], upperArmL: [0, 0, 0.18], upperArmR: [0, 0, -0.18], footL: [-0.1, 0, 0], footR: [-0.1, 0, 0] },
		kneel: { root: [0, (0.535 - 0.98) * s, 0], shinL: [Math.PI / 2, 0, 0], shinR: [Math.PI / 2, 0, 0], footL: [1.4, 0, 0], footR: [1.4, 0, 0], upperArmL: [-0.2, 0, 0.08], upperArmR: [-0.2, 0, -0.08], forearmL: [-0.4, 0, 0], forearmR: [-0.4, 0, 0] },
		'look up': { ...relaxed, neck: [-0.22, 0, 0], head: [-0.5, 0, 0] },
		wave: { ...relaxed, upperArmR: [0, 0, -1.75], forearmR: [0, 0, -1.4], head: [0, -0.15, 0] },
		// a hand at its chin, the other arm across under that elbow
		think: { ...relaxed, upperArmR: [-0.6, 0.9, 0.3], forearmR: [-2.44, 0, 0], handR: [0.15, 0, 0], upperArmL: [-0.45, 0, 0], forearmL: [0, 0, -1.55], head: [0.15, 0.1, 0] },
		// the forearms across the chest, the left over the right
		'arms crossed': { ...relaxed, upperArmL: [-0.65, 0, 0.05], forearmL: [0, 0, -1.65], upperArmR: [-0.4, 0, -0.05], forearmR: [0, 0, 1.55] },
		point: { ...relaxed, upperArmR: [-1.45, 0.15, 0], forearmR: [-0.05, 0, 0], head: [0, -0.12, 0] }
	};
}

/** its poses at its height */
export const POSES = posesFor(HEIGHT / MEASURED);

/* ── its moves ────────────────────────────────────────────────────────────── */

function clipsFor(s: number, poses: Record<string, Pose>): Record<string, Clip> {
	const idle: Clip = (t) => ({
		...relaxed,
		root: [0, 0.004 * s * Math.sin(t * 1.7), 0],
		hips: [0, 0.03 * Math.sin(t * 0.4), 0.015 * Math.sin(t * 0.4)],
		spine: [0.015 * Math.sin(t * 1.7 + 0.6), 0, 0],
		chest: [0.02 * Math.sin(t * 1.7), 0, -0.012 * Math.sin(t * 0.4)],
		head: [0.04 * Math.sin(t * 0.31), 0.28 * Math.sin(t * 0.23), 0]
	});
	// walking on the spot, about two steps a second
	const walk: Clip = (t) => {
		const f = loop(t, 1.05) * Math.PI * 2, sn = Math.sin(f), c = Math.cos(f);
		const lift = (x: number) => 0.08 + 0.7 * Math.max(0, x) ** 2;
		return {
			root: [0, (0.018 * Math.cos(2 * f) - 0.012) * s, 0],
			hips: [0, 0.1 * sn, 0.035 * sn],
			chest: [0.05, -0.14 * sn, 0],
			head: [0.03, 0.05 * sn, 0],
			thighL: [-0.42 * sn, 0, 0.03],
			thighR: [0.42 * sn, 0, -0.03],
			shinL: [lift(c), 0, 0],
			shinR: [lift(-c), 0, 0],
			footL: [0.18 * sn - 0.1 * Math.max(0, c), 0, 0],
			footR: [-0.18 * sn - 0.1 * Math.max(0, -c), 0, 0],
			upperArmL: [0.36 * sn, 0, 0.08],
			upperArmR: [-0.36 * sn, 0, -0.08],
			forearmL: [-0.3 - 0.15 * Math.max(0, -sn), 0, 0],
			forearmR: [-0.3 - 0.15 * Math.max(0, sn), 0, 0]
		};
	};
	const wave: Clip = (t) => {
		const w = Math.sin(t * 7);
		return { ...idle(t), ...poses.wave, forearmR: [0, 0, -1.4 + 0.35 * w], handR: [0, 0, 0.2 * w] };
	};
	// sitting down onto an edge and standing up again, slowly
	const sitDown: Clip = (t) => {
		const u = loop(t, 5);
		const k = u < 0.4 ? u / 0.4 : u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
		return blend(relaxed, poses.sit!, k * k * (3 - 2 * k));
	};
	return { idle, walk, wave, 'sit down': sitDown };
}

/** A stand-in, rigged: its moves, its poses. `look`: what it wears; `height`: how tall it is (m). */
export function human(look: Partial<Look> = {}, height = HEIGHT): Cast {
	const s = height / MEASURED;
	const { bones, parts: body } = scaled(s, { ...LOOK, ...look });
	const r = rig(bones, body, [skin(0.78)]);
	r.object.name = 'stand-in';
	r.pose(relaxed);
	const poses = s === HEIGHT / MEASURED ? POSES : posesFor(s);
	return { rig: r, clips: clipsFor(s, poses), poses, first: 'idle' };
}

/** A stand-in held in one of its poses: what a world places (a set a shot names). */
export function standIn(pose: string = 'stand', look: Partial<Look> = {}): THREE.Object3D {
	const a = human(look);
	a.rig.pose(POSES[pose] ?? POSES.stand!);
	a.rig.object.name = `stand-in, ${pose}`;
	return a.rig.object;
}
