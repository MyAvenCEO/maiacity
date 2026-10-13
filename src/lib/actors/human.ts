/*
 * THE STAND-IN — a person of 1.70 m, to block a shot with before its actor is in it (a film's second team): never
 * a likeness of anyone, but a person — a head with a face that shows where it looks and feels (v2, 2026-10-13: eyes
 * with whites and irises, a nose, lips, and hair: short, long, a bun or none; v3: the head one sculpted surface on a
 * real skull's proportions — cranium, brow ridge, eye sockets, cheekbones, jaw and chin; v4: friendly — a soft smile,
 * open eyes, brows raised a little, the cheeks lifted; v5: real eyes — glossy eyeballs under curved lids with a lash
 * line, a catchlight in each — a toned skin (warm cheeks, lips, the nose's tip), a warm smile, a shorter chin, fuller
 * hair), a T-shirt, jeans, trainers —
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
	[1.606, 0.044, 0.08, 0.02, -0.015, 2.4],
	[1.618, 0.051, 0.082, 0.015, -0.025, 2.5],
	[1.632, 0.0565, 0.084, 0.01, -0.035, 2.5],
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
/** the lower face (under the nose's base) shorter than its first measure (v5): the chin less long */
// eased in from the nose's base down, so no crease shows where it starts
for (const r of HEAD) if (r[0] < 1.668) {
	const d = 1.668 - r[0];
	r[0] = 1.668 - d + (0.13 * d * d) / (d + 0.02);
}
const CHIN = HEAD[0]![0], CROWN = HEAD[HEAD.length - 1]![0];
/** the head's section at height y, smoothly between those given (Catmull-Rom) */
function sectionAt(y: number): { w: number; zf: number; zs: number; zb: number; n: number } {
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
/** the same, softened over a few millimetres up and down (from v5), so no row of the table shows as a crease */
function section(y: number): { w: number; zf: number; zs: number; zb: number; n: number } {
	const o = { w: 0, zf: 0, zs: 0, zb: 0, n: 0 };
	for (const [dy, f] of [[-0.006, 1], [-0.003, 4], [0, 6], [0.003, 4], [0.006, 1]] as const) {
		const t = sectionAt(Math.min(CROWN, Math.max(CHIN, y + dy)));
		o.w += (t.w * f) / 16;
		o.zf += (t.zf * f) / 16;
		o.zs += (t.zs * f) / 16;
		o.zb += (t.zb * f) / 16;
		o.n += (t.n * f) / 16;
	}
	if (y < CHIN + 0.006 || y > CROWN - 0.006) o.w = Math.min(o.w, sectionAt(y).w); // the ends stay closed
	return o;
}
/** where the lips meet (as built for 1.80 m) and half the mouth's width */
export const MOUTH = { y: 1.6505, w: 0.024 };
/** the eyes' middles (as built for 1.80 m), left and right of the face's middle by x */
export const EYE = { x: 0.0325, y: 1.712, r: 0.0124 };
/** the bumps of the face under the skin: [x, y, reach across, reach up, how far forward] (mirrored left and right) */
const BUMPS: [number, number, number, number, number][] = [
	[0.034, 1.712, 0.015, 0.0095, -0.0085], // the eye sockets
	[0.03, 1.737, 0.02, 0.006, 0.002], // the brow ridge
	[0.052, 1.692, 0.012, 0.012, 0.005], // the cheekbones
	[0.05, 1.655, 0.012, 0.012, -0.0015], // the hollows under them
	[0, 1.613, 0.015, 0.009, 0.0045], // the chin
	[0, MOUTH.y + 0.002, 0.026, 0.016, 0.004], // the mouth's curve over the teeth
	[0, MOUTH.y + 0.0135, 0.017, 0.0075, 0.0042], // the upper lip's roll up to the nose
	[0.035, 1.68, 0.015, 0.011, 0.0055], // the cheeks, lifted by the smile
	[0.0275, MOUTH.y + 0.0068, 0.004, 0.005, -0.0016] // the smile's dimples at the mouth's corners
];
/** how far up the mouth turns at x (as built for 1.80 m): flat in its middle, its corners lifted into a smile */
const SMILE = (x: number) => {
	const q = (x / 0.022) ** 2;
	return 0.0062 * Math.min(1.15, 0.4 * q + 0.6 * q * q);
};
/** the nose, part of the surface: a ridge from the root between the eyes to its tip, rounding under the tip to the
 *  lip; its wings either side of the tip */
function nose(x: number, y: number): number {
	const ROOT = 1.722, TIP = 1.679;
	// its base lowest under the tip and curving up to where the wings meet the cheeks (v5): a round nose, not a ledge
	const BASE = 1.6675 + 0.0045 * Math.min(1, (x / 0.013) ** 2);
	if (y <= BASE || y >= ROOT) return 0;
	const p = y >= TIP ? 0.0195 * ((ROOT - y) / (ROOT - TIP)) ** 1.35 : 0.0195 * ((y - BASE) / (TIP - BASE)) ** 0.9;
	const wx = 0.0052 + 0.0055 * (ROOT - Math.max(y, TIP)) / (ROOT - TIP);
	return p * Math.exp(-((x / wx) ** 2));
}
/** the lips, part of the surface: the upper, the lower and the line between them */
const LIPS: [number, number, number, number, number][] = [
	[0, MOUTH.y + 0.0042, 0.022, 0.0036, 0.0034],
	[0, MOUTH.y - 0.0048, 0.019, 0.0048, 0.0045],
	[0, MOUTH.y, 0.024, 0.0011, -0.0019]
];
/** how much of the lips' colour a point of the face takes (as built for 1.80 m): 1 on them, fading out at their edge */
const onLips = (x: number, y: number) => Math.min(1, Math.max(0, (1 - Math.sqrt((x / (MOUTH.w - 0.0005)) ** 2 + ((y - SMILE(x) - MOUTH.y) / 0.0088) ** 2)) / 0.18));
/** a soft spot of the face, 0…1: 1 at (x, y) (mirrored when x is not 0), fading over rx, ry */
const spot = (p: THREE.Vector3, x: number, y: number, rx: number, ry: number) =>
	Math.exp(-(((Math.abs(p.x) - x) / rx) ** 2) - ((p.y - y) / ry) ** 2);
/** the skin's colour over the face: warmer on the cheeks and the nose's tip, a little shadow in the lids' crease, the
 *  lips' colour on the lips */
const skinTone = (k: Look) => {
	const base = new THREE.Color(k.skin), lips = new THREE.Color(k.lips), warm = new THREE.Color(k.skin).lerp(new THREE.Color('#d4655a'), 0.55);
	const shade = new THREE.Color(k.skin).multiplyScalar(0.8), light = new THREE.Color(k.skin).lerp(new THREE.Color('#ffffff'), 0.25), c = new THREE.Color();
	return (p: THREE.Vector3) => {
		if (p.z < 0.03) return k.skin;
		c.copy(base);
		c.lerp(warm, 0.32 * spot(p, 0.043, 1.68, 0.015, 0.012) + 0.22 * spot(p, 0, 1.676, 0.008, 0.007));
		c.lerp(shade, 0.35 * spot(p, 0.034, 1.7235, 0.012, 0.0035) + 0.18 * spot(p, 0.017, 1.715, 0.004, 0.006));
		// light bounced up under the nose and onto the upper lip, as a face's own skin gives it
		c.lerp(light, 0.4 * spot(p, 0, MOUTH.y + 0.0135, 0.014, 0.0045) + 0.45 * spot(p, 0, 1.6685, 0.015, 0.0028));
		c.lerp(lips, 0.85 * onLips(p.x, p.y));
		return `#${c.getHexString()}`;
	};
};
const bump = (x: number, y: number) =>
	nose(x, y) +
	LIPS.reduce((sum, [, by, rx, ry, dz]) => sum + dz * Math.exp(-((x / rx) ** 2) - ((y - SMILE(x) - by) / ry) ** 2), 0) +
	[...BUMPS, [0.0112, 1.6745, 0.0062, 0.0046, 0.0048] as [number, number, number, number, number], [0, 1.677, 0.0068, 0.0058, 0.0026] as [number, number, number, number, number]].reduce((sum, [bx, by, rx, ry, dz]) => sum + dz * (Math.exp(-(((x - bx) / rx) ** 2) - ((y - by) / ry) ** 2) + (bx ? Math.exp(-(((x + bx) / rx) ** 2) - ((y - by) / ry) ** 2) : 0)), 0);

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
	const dense = (y: number) => 1 + 3.2 * Math.exp(-(((y - 1.684) / 0.042) ** 2)) + 2 * Math.exp(-(((y - MOUTH.y) / 0.008) ** 2)) + 1.2 * Math.exp(-(((y - CHIN) / 0.01) ** 2)) + 1.2 * Math.exp(-(((y - CROWN) / 0.012) ** 2));
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
const HAIRLINE: [number, number][] = [[0, 1.784], [0.7, 1.773], [1.12, 1.746], [1.42, 1.726], [1.75, 1.718], [2.2, 1.7], [Math.PI, 1.668]];
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
		// fuller on top and towards the front (v5), short at the back and sides
		const top = Math.min(1, Math.max(0, (p[1] - 1.75) / 0.05)), fore = Math.min(1, Math.max(0, 0.5 + p[2] / 0.12));
		return -0.002 + (0.0105 + 0.008 * top * (0.4 + 0.6 * fore)) * t * t * (3 - 2 * t);
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

/** a cap of a sphere of radius r round c, its middle towards `pole`, reaching `half` (radians) from it, turned by q */
function cap(c: V3, r: number, pole: THREE.Vector3, half: number, q: THREE.Quaternion, seg = 36): THREE.BufferGeometry {
	const g = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round((seg * half) / Math.PI)), 0, Math.PI * 2, 0, half);
	g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pole.clone().normalize()));
	g.applyQuaternion(q);
	g.translate(...c);
	return g;
}
/** the front of a cap's edge (as `cap` lays it), as a line of points */
function capEdge(c: V3, r: number, pole: THREE.Vector3, half: number, q: THREE.Quaternion): THREE.Vector3[] {
	const u = pole.clone().normalize(), e1 = new THREE.Vector3(1, 0, 0), e2 = new THREE.Vector3().crossVectors(u, e1).normalize();
	const pts: THREE.Vector3[] = [];
	for (let i = 0; i <= 48; i++) {
		const f = -Math.PI + (Math.PI * i) / 48;
		const v = u.clone().multiplyScalar(Math.cos(half)).add(e1.clone().multiplyScalar(Math.cos(f) * Math.sin(half))).add(e2.clone().multiplyScalar(Math.sin(f) * Math.sin(half))).multiplyScalar(r);
		if (v.z > 0.3 * r) pts.push(v.applyQuaternion(q).add(new THREE.Vector3(...c)));
	}
	return pts;
}
/** a lid: the direction of its cap's middle (up or down, leaning back by `lean`) and how far the cap reaches, so its
 *  edge crosses the eye's front `front` (a share of its radius) above or below its middle */
function lid(front: number, lean: number, up: boolean): { pole: THREE.Vector3; half: number } {
	const sy = up ? 1 : -1;
	return { pole: new THREE.Vector3(0, sy * Math.cos(lean), -Math.sin(lean)), half: Math.acos(Math.abs(front) * Math.cos(lean) - Math.sqrt(1 - front * front) * Math.sin(lean)) };
}

/** the face, every feature set on the skin where it is (so none sinks into the head, none floats off it): from v5 each
 *  eye a glossy ball in its socket — its white, an iris with a darker rim, a pupil, a catchlight — under two lids, curved
 *  caps of skin round it, the upper one with its lash line; brows; nostrils; the line between the lips (the nose and
 *  lips are part of the head's surface) */
function face(k: Look): Piece[] {
	const on = (x: number, y: number, out: number, s: V3, rot: V3, color: string, detail: [number, number] = [16, 12]): Piece => ({ geo: egg([x, y, skinAt(x, y) + out], s, rot, detail), color, bone: 'head' });
	const out: Piece[] = [];
	const R = EYE.r, front = new THREE.Vector3(0, 0, 1), still = new THREE.Quaternion();
	const lidC = new THREE.Color(k.skin).multiplyScalar(0.94).getHexString(), rim = new THREE.Color(k.iris).multiplyScalar(0.45).getHexString();
	const upper = lid(0.47, 0.78, true), lower = lid(-0.34, 1.08, false);
	for (const [, x] of sides) {
		const ex = x * EYE.x, ey = EYE.y;
		const c: V3 = [ex, ey, skinAt(ex, ey) + 0.005 - R];
		// the lids follow the face's curve: their outer corners back and a little up
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, x * 0.18, x * 0.07));
		out.push(
			{ geo: cap(c, R, front, Math.PI, still, 32), color: '#f4f0ea', bone: 'head', mat: 1 },
			{ geo: cap(c, R + 0.00008, front, 0.56, still), color: `#${rim}`, bone: 'head', mat: 1 },
			{ geo: cap(c, R + 0.00016, front, 0.5, still), color: k.iris, bone: 'head', mat: 1 },
			{ geo: cap(c, R + 0.00024, front, 0.2, still, 24), color: '#0d0b0a', bone: 'head', mat: 1 },
			{ geo: egg(new THREE.Vector3(-0.3, 0.36, 0.88).normalize().multiplyScalar(R + 0.0004).add(new THREE.Vector3(...c)).toArray() as V3, [0.0009, 0.0009, 0.0004], [0, 0, 0], [8, 6]), color: '#ffffff', bone: 'head', mat: 1 },
			{ geo: cap(c, R + 0.0009, upper.pole, upper.half, q), color: `#${lidC}`, bone: 'head' },
			{ geo: cap(c, R + 0.0004, lower.pole, lower.half, q), color: k.skin, bone: 'head' },
			{ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(capEdge(c, R + 0.0011, upper.pole, upper.half, q)), 28, 0.00065, 6, false), color: '#231915', bone: 'head' },
			{ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(capEdge(c, R + 0.0005, lower.pole, lower.half, q)), 28, 0.0003, 5, false), color: '#9a6a5e', bone: 'head' },
			on(x * 0.0062, 1.6686, -0.0012, [0.0027, 0.0011, 0.003], [0.45, 0, x * 0.3], `#${new THREE.Color(k.skin).multiplyScalar(0.42).getHexString()}`, [10, 6]) // a nostril
		);
	}
	// the brows: relaxed, each a soft low arch lying on the skin, full at the inner end and thinning out
	for (const [, sx] of sides) {
		const pts = Array.from({ length: 9 }, (_, i) => {
			const u = i / 8, x = sx * (0.015 + 0.036 * u), y = 1.7355 + 0.0038 * Math.sin(Math.PI * (0.1 + 0.85 * u)) - 0.001 * u;
			return new THREE.Vector3(x, y, skinAt(x, y) + 0.0002);
		});
		const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 1, 8, false);
		// thinner towards the outer end: each ring scaled about its own point on the curve, flat on the skin
		const pos = g.attributes.position!, cv = new THREE.CatmullRomCurve3(pts), v3 = new THREE.Vector3(), m = new THREE.Vector3();
		for (let v = 0; v < pos.count; v++) {
			const t = Math.floor(v / 9) / 20;
			cv.getPointAt(Math.min(1, t), m);
			v3.fromBufferAttribute(pos, v).sub(m).multiplyScalar(0.0025 * (1 - 0.5 * t) * Math.min(1, 0.55 + 4 * t));
			v3.z *= 0.4;
			pos.setXYZ(v, m.x + v3.x, m.y + v3.y, m.z + v3.z);
		}
		g.computeVertexNormals();
		out.push({ geo: g, color: `#${new THREE.Color(k.brows).lerp(new THREE.Color(k.skin), 0.08).getHexString()}`, bone: 'head' });
	}
	// the line between the lips, curved up at its corners with the smile
	const line = new THREE.CatmullRomCurve3(Array.from({ length: 15 }, (_, i) => {
		const x = -(MOUTH.w - 0.0008) + (i * 2 * (MOUTH.w - 0.0008)) / 14, y = MOUTH.y + SMILE(x);
		return new THREE.Vector3(x, y, skinAt(x, y) - 0.0002);
	}));
	out.push({ geo: new THREE.TubeGeometry(line, 28, 0.00075, 6, false), color: `#${new THREE.Color(k.lips).multiplyScalar(0.5).getHexString()}`, bone: 'head' });
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
				{ y: 1.465, w: 0.375, d: 0.175, z: -0.012 },
				{ y: 1.495, w: 0.3, d: 0.15, z: -0.015 },
				{ y: 1.53, w: 0.165, d: 0.13, z: -0.016 },
				{ y: 1.545, w: 0.02, d: 0.02, z: -0.015 }
			], 44),
			color: (p) => (p.y < 0.985 ? k.trousers : p.y < 1.012 ? k.belt : k.shirt),
			chain: { bones: ['hips', 'spine', 'chest', 'neck'], soft: 0.07 }
		},
		{ geo: limb([0, 1.64, -0.012], [0, 1.47, -0.018], 0.061, 0.072), color: k.skin, chain: { bones: ['chest', 'neck', 'head'], soft: 0.04 } },
		// the head: one surface on a skull's proportions, ears from the brow to the base of the nose; the face — eyes with
		// their whites, irises and a glint, lids, brows, a nose, lips — so it shows where it looks and how it feels
		{ geo: headGrid(160, 136), color: skinTone(k), bone: 'head' },
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
	const r = rig(bones, body, [skin(0.74), skin(0.12)]);
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
