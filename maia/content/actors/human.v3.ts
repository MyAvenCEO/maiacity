/*
 * v3 of the stand-in, frozen 2026-10-13: the head on a real skull's proportions, a neutral face (v4 makes it friendly:
 * a soft smile, open eyes, raised brows and cheeks).
 *
 * THE STAND-IN — a person of 1.70 m, to block a shot with before its actor is in it (a film's second team): never
 * a likeness of anyone, but a person — a head with a face that shows where it looks and feels (v2, 2026-10-13: eyes
 * with whites and irises, a nose, lips, and hair: short, long, a bun or none; v3: the head one sculpted surface on a
 * real skull's proportions — cranium, brow ridge, eye sockets, cheekbones, jaw and chin), a T-shirt, jeans, trainers —
 * rigged head to toe so it takes any pose and any move: 17 bones (the hips, the spine, the chest, the neck, the head;
 * each arm's upper arm, forearm and hand; each leg's thigh, shin and foot), one skinned mesh over them, every joint
 * bending smoothly.
 *
 * Its measures are taken for 1.80 m and scaled to its height (`HEIGHT`, or any other). Built standing, facing +z, its
 * feet on y 0. Its poses are turns of its bones from there (./rig.ts); its left is +x.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { blend, egg, limb, loft, loop, rig, skin, type BoneSpec, type Cast, type Clip, type Piece, type Pose, type V3 } from './rig';

/** how tall it is (m) */
export const HEIGHT = 1.7;
/** the height its measures below are for: the top of its head, as built for a person of 1.80 m */
const MEASURED = 1.823;
/** the edge it sits on (a bed's, a chair's), m */
const SEAT = 0.5;

/** what the stand-in wears (and its skin, its brows) */
export type Hair = 'none' | 'short' | 'long' | 'bun';
export type Look = { skin: string; brows: string; shirt: string; trousers: string; belt: string; shoes: string; soles: string; hair: Hair; hairColour: string; iris: string; lips: string };
export const LOOK: Look = { skin: '#d6b094', brows: '#3a2a1f', shirt: '#3c4452', trousers: '#47566c', belt: '#2d251f', shoes: '#2a2a2d', soles: '#e9e6df', hair: 'short', hairColour: '#3a2a1f', iris: '#5a4030', lips: '#a8665a' };

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

/* ── the head: one surface on a skull's proportions ─────────────────────────────────────────────────────────────
 * Measured for 1.80 m: 22.8 cm from chin to crown, 15.4 cm across at its widest, 20 cm from brow to the back of the
 * skull; the eyes half way down, the brows, the base of the nose and the chin a third of the face apart; the eyes one
 * eye's width apart and a fifth of the head's width each; the jaw's angle 10 cm across under the ears, the cheekbones
 * 14.4 cm. Its sections, chin to crown, give its shape; a few soft bumps on its face give the sockets, the brow ridge,
 * the cheekbones and the chin. */

/** the head's sections, chin to crown: y; half its width w; z of its front, of its sides' widest point and of its back;
 *  how square it is (2: an ellipse, more: squarer, as the jaw is) */
const HEAD: [y: number, w: number, zf: number, zs: number, zb: number, n: number][] = [
	[1.594, 0.012, 0.062, 0.045, 0.03, 2],
	[1.598, 0.03, 0.074, 0.03, 0, 2.3],
	[1.606, 0.045, 0.08, 0.02, -0.015, 2.6],
	[1.618, 0.053, 0.082, 0.015, -0.025, 2.8],
	[1.632, 0.058, 0.084, 0.01, -0.035, 2.7],
	[1.645, 0.061, 0.087, 0.006, -0.045, 2.5],
	[1.66, 0.065, 0.09, 0.002, -0.058, 2.4],
	[1.675, 0.068, 0.093, 0, -0.075, 2.3],
	[1.695, 0.072, 0.096, 0, -0.09, 2.3],
	[1.715, 0.074, 0.094, 0, -0.098, 2.2],
	[1.735, 0.076, 0.098, 0, -0.101, 2.2],
	[1.755, 0.077, 0.093, -0.005, -0.102, 2.1],
	[1.78, 0.071, 0.082, -0.008, -0.096, 2.05],
	[1.8, 0.057, 0.066, -0.01, -0.082, 2],
	[1.815, 0.035, 0.042, -0.01, -0.058, 2],
	[1.823, 0.003, 0.004, -0.01, -0.016, 2]
];
const CHIN = HEAD[0]![0], CROWN = HEAD[HEAD.length - 1]![0];
/** the head's section at height y, smoothly between those given (Catmull-Rom) */
function section(y: number): { w: number; zf: number; zs: number; zb: number; n: number } {
	let i = 0;
	while (i < HEAD.length - 2 && y > HEAD[i + 1]![0]) i++;
	const at = (k: number) => HEAD[Math.max(0, Math.min(HEAD.length - 1, k))]!;
	const t = Math.max(0, Math.min(1, (y - at(i)[0]) / (at(i + 1)[0] - at(i)[0])));
	const cr = (k: number) => {
		const a = at(i - 1)[k]!, b = at(i)[k]!, c = at(i + 1)[k]!, d = at(i + 2)[k]!;
		return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
	};
	return { w: Math.max(0.0005, cr(1)), zf: cr(2), zs: cr(3), zb: cr(4), n: cr(5) };
}
/** the bumps of the face under the skin: [x, y, reach across, reach up, how far forward] (mirrored left and right) */
const BUMPS: [number, number, number, number, number][] = [
	[0.033, 1.712, 0.013, 0.009, -0.007], // the eye sockets
	[0.03, 1.737, 0.02, 0.006, 0.002], // the brow ridge
	[0.052, 1.692, 0.012, 0.012, 0.005], // the cheekbones
	[0.05, 1.655, 0.012, 0.012, -0.002], // the hollows under them
	[0, 1.606, 0.014, 0.008, 0.004], // the chin
	[0, 1.658, 0.02, 0.012, 0.002] // the mouth's curve over the teeth
];
/** the nose, part of the surface: a ridge from the root between the eyes to its tip, falling back under the tip to the
 *  lip; its wings either side of the tip */
function nose(x: number, y: number): number {
	const ROOT = 1.722, TIP = 1.68, BASE = 1.668;
	if (y <= BASE || y >= ROOT) return 0;
	const p = y >= TIP ? 0.02 * ((ROOT - y) / (ROOT - TIP)) ** 1.35 : 0.02 * ((y - BASE) / (TIP - BASE)) ** 0.55;
	const wx = 0.0048 + 0.0058 * (ROOT - Math.max(y, TIP)) / (ROOT - TIP);
	return p * Math.exp(-((x / wx) ** 2));
}
/** the lips, part of the surface: the upper, the lower and the line between them */
const LIPS: [number, number, number, number, number][] = [
	[0, 1.6588, 0.019, 0.0032, 0.0032],
	[0, 1.6508, 0.0165, 0.0038, 0.0038],
	[0, 1.6549, 0.021, 0.0011, -0.0018]
];
/** how much of the lips' colour a point of the face takes (as built for 1.80 m): 1 on them, fading out at their edge */
const onLips = (x: number, y: number) => Math.min(1, Math.max(0, (1 - Math.sqrt((x / 0.0205) ** 2 + ((y - 1.6551) / 0.0074) ** 2)) / 0.18));
/** the skin's colour, or the lips' where the lips are */
const lipsOr = (skinC: string, lipsC: string) => {
	const a = new THREE.Color(skinC), b = new THREE.Color(lipsC), c = new THREE.Color();
	return (p: THREE.Vector3) => (p.z > 0.06 ? `#${c.copy(a).lerp(b, onLips(p.x, p.y)).getHexString()}` : skinC);
};
const bump = (x: number, y: number) =>
	nose(x, y) +
	[...BUMPS, ...LIPS, [0.0125, 1.6735, 0.0068, 0.0058, 0.0062] as [number, number, number, number, number]].reduce((sum, [bx, by, rx, ry, dz]) => sum + dz * (Math.exp(-(((x - bx) / rx) ** 2) - ((y - by) / ry) ** 2) + (bx ? Math.exp(-(((x + bx) / rx) ** 2) - ((y - by) / ry) ** 2) : 0)), 0);

/** how far forward the face's skin is at (x, y), as built for 1.80 m; behind its sides, the sides' z */
export function skinAt(x: number, y: number): number {
	const { w, zf, zs, n } = section(y);
	const q = Math.min(1, Math.abs(x) / w);
	const S = (1 - q ** n) ** (1 / n);
	return zs + (zf - zs + bump(x, y)) * S;
}

/** the heights of the head's rows, `u` 0…1 chin to crown: closest round the eyes, nose and mouth, and at the two ends */
const ROW_Y = (() => {
	const n = 2000, ys: number[] = [], cum: number[] = [0];
	const dense = (y: number) => 1 + 3.2 * Math.exp(-(((y - 1.684) / 0.042) ** 2)) + 1.2 * Math.exp(-(((y - CHIN) / 0.01) ** 2)) + 1.2 * Math.exp(-(((y - CROWN) / 0.012) ** 2));
	for (let i = 0; i <= n; i++) {
		ys.push(CHIN + ((CROWN - CHIN) * i) / n);
		if (i) cum.push(cum[i - 1]! + dense(ys[i]!));
	}
	return (u: number) => {
		const target = u * cum[n]!;
		let i = 0;
		while (i < n && cum[i + 1]! < target) i++;
		const f = (target - cum[i]!) / Math.max(1e-9, cum[i + 1]! - cum[i]!);
		return ys[i]! + (ys[Math.min(n, i + 1)]! - ys[i]!) * Math.min(1, f);
	};
})();

/** a point of the head: `u` 0…1 chin to crown, `a` round it (0: its left side, π/2: its front) */
function headPoint(u: number, a: number): V3 {
	const y = ROW_Y(u);
	const { w, zf, zs, zb, n } = section(y);
	const c = Math.cos(a), sn = Math.sin(a);
	const x = w * Math.sign(c) * Math.abs(c) ** (2 / n);
	const S = Math.abs(sn) ** (2 / n);
	const z = sn >= 0 ? zs + (zf - zs + bump(x, y)) * S : zs - (zs - zb) * S;
	return [x, y, z];
}

/** a grid over the head (rows chin to crown, columns round it), kept where `keep` says, each point pushed out by `out` */
function headGrid(rows: number, cols: number, out: (p: V3) => number = () => 0, keep: (p: V3) => boolean = () => true): THREE.BufferGeometry {
	const pts: V3[][] = [];
	for (let i = 0; i <= rows; i++) {
		const row: V3[] = [];
		for (let j = 0; j < cols; j++) {
			// the columns closest at the face's middle, where the nose and lips are
			const t = (j / cols) * 2 - 1;
			const p = headPoint(i / rows, Math.PI / 2 + Math.PI * Math.sign(t) * Math.abs(t) ** 1.7);
			const d = out(p);
			if (d) {
				// out from the skull's middle
				const v = new THREE.Vector3(p[0], p[1] - 1.7, p[2] + 0.005).normalize();
				row.push([p[0] + v.x * d, p[1] + v.y * d, p[2] + v.z * d]);
			} else row.push(p);
		}
		pts.push(row);
	}
	const pos: number[] = [], idx: number[] = [];
	const id = (i: number, j: number) => i * cols + (j % cols);
	pts.forEach((r) => r.forEach((p) => pos.push(...p)));
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < cols; j++) {
			const q = [id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)];
			const p = q.map((k) => pts[Math.floor(k / cols)]![k % cols]!);
			if (!p.every(keep)) continue;
			idx.push(q[0]!, q[2]!, q[1]!, q[0]!, q[3]!, q[2]!);
		}
	// only the points its kept faces use
	const used = new Map<number, number>();
	const out2: number[] = [];
	const idx2 = idx.map((k) => {
		if (!used.has(k)) (used.set(k, used.size), out2.push(pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!));
		return used.get(k)!;
	});
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(out2, 3));
	g.setIndex(idx2);
	g.computeVertexNormals();
	return g;
}

/** the hairline's height round the head: by how far round from the front (radians), front, temples, over the ears,
 *  behind them, the nape */
const HAIRLINE: [number, number][] = [[0, 1.79], [0.7, 1.777], [1.12, 1.748], [1.42, 1.726], [1.75, 1.718], [2.2, 1.7], [Math.PI, 1.668]];
function hairline(p: V3): number {
	const th = Math.abs(Math.atan2(p[0], p[2] + 0.005));
	let i = 0;
	while (i < HAIRLINE.length - 2 && th > HAIRLINE[i + 1]![0]) i++;
	const [a0, h0] = HAIRLINE[i]!, [a1, h1] = HAIRLINE[i + 1]!;
	return h0 + ((h1 - h0) * Math.min(1, Math.max(0, th - a0))) / (a1 - a0);
}

/** its hair, on the head bone: a layer over the skull from its hairline up, thin at the line and fuller above it, and
 *  for `long` a fall down the back of the neck, for `bun` a knot at the back of the crown */
function hair(k: Look): Piece[] {
	if (k.hair === 'none') return [];
	const thick = (p: V3) => {
		const t = Math.min(1, Math.max(0, (p[1] - hairline(p)) / 0.028));
		return -0.002 + 0.0105 * t * t * (3 - 2 * t);
	};
	// grown from under the skin, so where it comes out is a smooth line, not the grid's steps
	const cap = headGrid(84, 112, thick, (p) => p[1] > hairline(p) - 0.012);
	const out: Piece[] = [{ geo: cap, color: k.hairColour, bone: 'head' }];
	if (k.hair === 'long') {
		out.push({ geo: egg([0, 1.62, -0.06], [0.09, 0.15, 0.055], [0.12, 0, 0], [28, 20]), color: k.hairColour, bone: 'head' });
		for (const x of [-1, 1]) out.push({ geo: egg([x * 0.074, 1.645, -0.012], [0.024, 0.105, 0.065], [0, 0, x * 0.08], [16, 14]), color: k.hairColour, bone: 'head' });
	}
	if (k.hair === 'bun') out.push({ geo: egg([0, 1.78, -0.1], [0.04, 0.038, 0.038], [0, 0, 0], [20, 16]), color: k.hairColour, bone: 'head' });
	return out;
}

/** the face, every feature set on the skin where it is (so none sinks into the head, none floats off it): eyes with
 *  their whites, irises, pupils and a glint, turned with the face's curve; lids with a lash line; brows; a nose with a
 *  bridge, a tip, its wings and nostrils; two lips with the line between them (from v3 the nose and lips are part of the
 *  head's surface, only the nostrils and the lips' line on it) */
function face(k: Look): Piece[] {
	const on = (x: number, y: number, out: number, s: V3, rot: V3, color: string, detail: [number, number] = [16, 12]): Piece => ({ geo: egg([x, y, skinAt(x, y) + out], s, rot, detail), color, bone: 'head' });
	const out: Piece[] = [];
	for (const [, x] of sides) {
		const ex = x * 0.033, ey = 1.712, turn: V3 = [0, x * 0.42, 0];
		out.push(
			on(ex, ey, -0.0022, [0.0125, 0.0085, 0.0045], turn, '#f3efe7'),
			on(ex - x * 0.001, ey - 0.0004, 0.0019, [0.0058, 0.0058, 0.0016], turn, k.iris, [14, 10]),
			on(ex - x * 0.001, ey - 0.0004, 0.0029, [0.0029, 0.0029, 0.001], turn, '#141110', [10, 8]),
			on(ex + 0.0016, ey + 0.002, 0.0036, [0.0012, 0.0012, 0.0005], turn, '#ffffff', [8, 6]),
			on(ex, ey + 0.0062, -0.0018, [0.0142, 0.0048, 0.0062], [0, x * 0.42, x * -0.05], k.skin),
			on(ex, ey + 0.0026, 0.0026, [0.0134, 0.0011, 0.0022], [0, x * 0.42, x * -0.05], '#2a1d17', [14, 6]),
			on(ex, ey - 0.0072, -0.0016, [0.0125, 0.0028, 0.0045], [0, x * 0.42, 0], k.skin, [14, 8]),
			on(x * 0.036, 1.737, -0.0012, [0.02, 0.0042, 0.006], [0, x * 0.4, x * -0.12], k.brows, [14, 8]),
			on(x * 0.0058, 1.6696, -0.0012, [0.003, 0.0012, 0.0034], [0.35, 0, 0], '#4a2e25', [10, 6]) // a nostril
		);
	}
	out.push(
		on(0, 1.6549, -0.0006, [0.0175, 0.0007, 0.0012], [0, 0, 0], '#6a3a34', [14, 6]) // the line between the lips
	);
	return out;
}

function parts(k: Look): Piece[] {
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
			], 44),
			color: (p) => (p.y < 0.985 ? k.trousers : p.y < 1.012 ? k.belt : k.shirt),
			chain: { bones: ['hips', 'spine', 'chest', 'neck'], soft: 0.07 }
		},
		{ geo: limb([0, 1.64, -0.012], [0, 1.47, -0.018], 0.056, 0.062), color: k.skin, chain: { bones: ['chest', 'neck', 'head'], soft: 0.04 } },
		// the head: one surface on a skull's proportions, ears from the brow to the base of the nose; the face — eyes with
		// their whites, irises and a glint, lids, brows, a nose, lips — so it shows where it looks and how it feels
		{ geo: headGrid(150, 128), color: lipsOr(k.skin, k.lips), bone: 'head' },
		...sides.map(([, x]): Piece => ({ geo: egg([x * (section(1.703).w - 0.001), 1.703, -0.012], [0.006, 0.029, 0.019], [-0.15, -x * 0.3, 0], [16, 12]), color: k.skin, bone: 'head' })),
		...face(k),
		...hair(k),
		// each arm: the sleeve over the top of it, the bare forearm, a hand with its thumb
		...sides.flatMap(([s, x]): Piece[] => [
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
function scaled(s: number, k: Look): { bones: BoneSpec[]; parts: Piece[] } {
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
