/*
 * THE STAND-IN'S HEAD (v6, 2026-10-13) — a sculpted head and neck in place of one drawn by sums: MakeHuman's base mesh
 * (CC0, ./head.data.js) for a young man or a young woman, smoothed once (./subdivide.js), with a skin toned by where it
 * is (the lips, warm cheeks, a nose's tip and ears, every hollow a little darker, the inside of the mouth), eyes, lash
 * lines, teeth and a tongue, brows of single hairs, and hair grown over the scalp. One smile, `joy`, rides it as a morph:
 * v7 (2026-10-14) a warm one with the lips closed — the mouth's corners up and back, the cheeks lifted, the eyes
 * narrowed by them; v6's (kept: version 6) broad and open, the lips parted on the teeth. v8: the whole jaw and chin
 * ride the head bone (headWeights), the neck blending in below them. v9: a friendly gaze to wear all the time, its own
 * morph `friendly` (the lower lids and the brows lifted a little, no smile in it), and a soft catchlight in each eye
 * that shows at a medium close-up's distance in any light.
 *
 * All of it in the stand-in's measure (./human.ts: a person of 1.80 m, metres, facing +z, its left +x); the stand-in
 * scales it to its height.
 */
import * as THREE from 'three';
import { HEAD_MESH, HEAD_MID, HEAD_PEOPLE, HEAD_Q, HEAD_REGION, HEAD_UNITS } from './head.data.js';
import { applyStencil, catmullClark, triangles } from './subdivide.js';

/** @typedef {'man' | 'woman'} Face */
/** @typedef {import('./rig').Piece} Piece */

const bytes = (/** @type {string} */ s) => {
	const b = atob(s), a = new Uint8Array(b.length);
	for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
	return a;
};
const i16 = (/** @type {string} */ s) => new Int16Array(bytes(s).buffer);
const u16 = (/** @type {string} */ s) => new Uint16Array(bytes(s).buffer);
const KEY = /** @type {Record<Face, 'm' | 'f'>} */ ({ man: 'm', woman: 'f' });
/** the smile `joy` by the stand-in's version, as MakeHuman's units at their weights and a lift of the cheeks (m up and
 *  forward at the middle of each cheek's apple, fading over `r`): v7 a warm closed smile — the corners up and drawn
 *  wide, the lips kept together and turned out a little so they stay full, the cheeks lifted, the lower lids raised
 *  with them; v6 a broad open one — the upper lip lifted off the teeth, the lips parted */
export const SMILES = /** @type {Record<number, { units: Record<string, number>, cheeks?: { up: number, out: number, r: number } }>} */ ({
	6: { units: { 'mouth-corner-puller': 0.85, 'mouth-upward-retraction': 1, 'mouth-parling': 0.5, 'mouth-elevation': 0.4, 'eye-left-slit': 0.3, 'eye-right-slit': 0.3, 'eye-left-opened-up': -0.3, 'eye-right-opened-up': -0.3 } },
	7: {
		units: { 'mouth-corner-puller': 0.5, 'mouth-retraction': 0.5, 'mouth-compression': 0.45, 'mouth-eversion': 0.35, 'nose-left-elevation': 0.12, 'nose-right-elevation': 0.12, 'eye-left-slit': 0.3, 'eye-right-slit': 0.3, 'eye-left-opened-up': -0.2, 'eye-right-opened-up': -0.2 },
		cheeks: { up: 0.004, out: 0.0025, r: 0.022 }
	}
});
/** the friendly gaze `friendly` (v9), the eyes' part of a smile on its own, to wear all the time (with a little of
 *  `joy` or none): the lower lids lifted about half a millimetre and the upper ones kept where they are (the slit
 *  alone drops them 2.3 mm, opened-up lifts both), so the eyes stay open and bright; the brows raised about a
 *  millimetre, the cheeks' apples lifted a hair under the eyes; the mouth left as it is */
export const FRIENDLY = /** @type {{ units: Record<string, number>, cheeks: { up: number, out: number, r: number } }} */ ({
	units: { 'eye-left-slit': 0.25, 'eye-right-slit': 0.25, 'eye-left-opened-up': 0.4, 'eye-right-opened-up': 0.4, 'eyebrows-left-up': 0.35, 'eyebrows-right-up': 0.35 },
	cheeks: { up: 0.002, out: 0.0013, r: 0.02 }
});
/** the stand-in's version the head is built at by default (v10: every tooth coloured, the molars too; v9 the friendly
 *  gaze and a catchlight that shows; v8 the jaw on the head bone, see headWeights) */
export const HEAD_V = 10;
/** v9's catchlight in each eye: where on the eye (a direction from its middle, about 0.15 rad up and to the left of
 *  its front, on the pupil's edge, clear of the upper lid), how wide its bright core is and its soft ring (m) */
export const CATCH = { at: [-0.12, 0.09, 1], core: 0.0018, soft: 0.0028 };
/** the catchlight's material (the stand-in's index 3): white, glossy, lit from within a little so it shows in shade */
export const CATCHLIGHT = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.75 });
/** a version's smile: v7's from v7 on */
const smileOf = (/** @type {number} */ v) => (v >= 7 ? 7 : 6);
const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/**
 * One part of the mesh on its own, smoothed `levels` times: its quads, positions and the smile's offsets on its own
 * vertices, and any values per vertex carried along (`dim` a vertex).
 * @param {string} name @param {Float32Array} pos @param {Float32Array} joy @param {number} levels @param {Float32Array} [extra] @param {number} [dim]
 */
function piece(name, pos, joy, levels, extra, dim = 1) {
	const q = u16(HEAD_MESH.quads[/** @type {keyof typeof HEAD_MESH.quads} */ (name)]);
	const local = new Map();
	/** @type {number[]} */ const ids = [];
	/** @type {Uint32Array} */ let quads = Uint32Array.from(q, (i) => {
		if (!local.has(i)) (local.set(i, ids.length), ids.push(i));
		return local.get(i);
	});
	let P = Float32Array.from({ length: ids.length * 3 }, (_, k) => pos[ids[(k / 3) | 0] * 3 + (k % 3)]);
	let J = Float32Array.from({ length: ids.length * 3 }, (_, k) => joy[ids[(k / 3) | 0] * 3 + (k % 3)]);
	let X = extra ? Float32Array.from({ length: ids.length * dim }, (_, k) => extra[ids[(k / dim) | 0] * dim + (k % dim)]) : undefined;
	let n = ids.length;
	for (let l = 0; l < levels; l++) {
		const s = catmullClark(quads, n);
		P = applyStencil(s.stencil, P, 3);
		J = applyStencil(s.stencil, J, 3);
		if (X) X = applyStencil(s.stencil, X, dim);
		quads = s.quads;
		n = s.n;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
	geo.setIndex(new THREE.BufferAttribute(triangles(quads), 1));
	geo.computeVertexNormals();
	return { geo, quads, joy: J, extra: X, n, ids };
}

/** each face's head at each smile, built once */
const BUILT = /** @type {Record<string, ReturnType<typeof build>>} */ ({});

/** @param {Face} face @param {number} smile */
function build(face, smile) {
	const who = HEAD_PEOPLE[KEY[face]];
	const raw = i16(who.pos), n = HEAD_MESH.n;
	const pos = Float32Array.from(raw, (x, k) => x * HEAD_Q + HEAD_MID[k % 3]);
	const region = bytes(HEAD_REGION);
	/** a shape's offsets: its units' added up, and the cheeks lifted (up and forward round each cheek's apple, under
	 *  the eye and out from the nose's wing, on the face's front only)
	 *  @param {{ units: Record<string, number>, cheeks?: { up: number, out: number, r: number } }} recipe */
	const shape = (recipe) => {
		const d3 = new Float32Array(n * 3);
		for (const [unit, wt] of Object.entries(recipe.units)) {
			const u = HEAD_UNITS[/** @type {keyof typeof HEAD_UNITS} */ (unit)], ids = u16(u.ids), d = i16(u.d);
			ids.forEach((j, k) => {
				for (let c = 0; c < 3; c++) d3[j * 3 + c] += d[k * 3 + c] * HEAD_Q * wt;
			});
		}
		const ch = recipe.cheeks;
		if (ch) {
			const [ex, ey, ez] = who.eyes.l.at;
			for (let i = 0; i < n; i++) {
				if (region[i] !== 0) continue;
				const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
				const w = smooth(ez - 0.04, ez - 0.02, z) * [-1, 1].reduce((sum, sx) => sum + Math.exp(-((x - sx * Math.abs(ex) * 1.2) ** 2 + (y - ey + 0.03) ** 2) / (ch.r * ch.r)), 0);
				d3[i * 3 + 1] += ch.up * w;
				d3[i * 3 + 2] += ch.out * w;
			}
		}
		return d3;
	};
	// the smile and the friendly gaze
	const joy = shape(SMILES[smileOf(smile)]), kind = shape(FRIENDLY);
	// per vertex: inside the mouth, in an eye's socket, an ear; and the friendly gaze's offsets, smoothed with the skin
	const marks = new Float32Array(n * 6);
	for (let i = 0; i < n; i++) {
		((marks[i * 6] = region[i] === 1 ? 1 : 0), (marks[i * 6 + 1] = region[i] === 2 ? 1 : 0), (marks[i * 6 + 2] = region[i] === 4 ? 1 : 0));
		for (let c = 0; c < 3; c++) marks[i * 6 + 3 + c] = kind[i * 3 + c];
	}
	const skin = piece('skin', pos, joy, 1, marks, 6);
	const carried = /** @type {Float32Array} */ (skin.extra);
	const mark = (/** @type {number} */ c) => Float32Array.from({ length: skin.n }, (_, i) => carried[i * 6 + c]);
	const friendly = Float32Array.from({ length: skin.n * 3 }, (_, k) => carried[((k / 3) | 0) * 6 + 3 + (k % 3)]);
	const inside = mark(0), socket = mark(1), ears = mark(2);
	const P = skin.geo.attributes.position, N = skin.geo.attributes.normal, m = skin.n;
	const eyes = who.eyes, E = { x: eyes.l.at[0], y: eyes.l.at[1], z: eyes.l.at[2], r: eyes.l.r };

	// its neighbours, by the smoothed quads' edges
	const nb = Array.from({ length: m }, () => /** @type {Set<number>} */ (new Set()));
	for (let f = 0; f < skin.quads.length; f += 4)
		for (let k = 0; k < 4; k++) {
			const a = skin.quads[f + k], b = skin.quads[f + ((k + 1) & 3)];
			nb[a].add(b);
			nb[b].add(a);
		}
	const v = new THREE.Vector3(), w = new THREE.Vector3(), nrm = new THREE.Vector3();
	// how hollow each point is: its neighbours' middle in front of it (along its normal), against the edges' length
	const hollow = new Float32Array(m);
	for (let i = 0; i < m; i++) {
		v.fromBufferAttribute(P, i);
		w.set(0, 0, 0);
		let len = 0;
		for (const j of nb[i]) {
			const p = new THREE.Vector3().fromBufferAttribute(P, j);
			w.add(p);
			len += p.distanceTo(v);
		}
		if (!nb[i].size) continue;
		w.divideScalar(nb[i].size).sub(v);
		nrm.fromBufferAttribute(N, i);
		hollow[i] = w.dot(nrm) / Math.max(1e-6, len / nb[i].size);
	}
	// the mouth: its slit's middle, its corners; how far each point is from its inside, over the skin
	let my = 0, mz = -1, mw = 0, cnt = 0;
	for (let i = 0; i < m; i++) {
		if (inside[i] < 0.5 || ![...nb[i]].some((j) => inside[j] < 0.5)) continue;
		// where the lips meet: the inside's edge
		v.fromBufferAttribute(P, i);
		mw = Math.max(mw, Math.abs(v.x));
		if (Math.abs(v.x) < 0.008) ((my += v.y), (mz = Math.max(mz, v.z)), cnt++);
	}
	my /= cnt || 1;
	const dist = new Float32Array(m).fill(Infinity);
	/** @type {number[]} */ let front = [];
	for (let i = 0; i < m; i++) if (inside[i] > 0.5) ((dist[i] = 0), front.push(i));
	for (let round = 0; round < 40 && front.length; round++) {
		/** @type {number[]} */ const next = [];
		for (const i of front) {
			v.fromBufferAttribute(P, i);
			for (const j of nb[i]) {
				const d = dist[i] + w.fromBufferAttribute(P, j).distanceTo(v);
				if (d < dist[j] && d < 0.03) ((dist[j] = d), next.push(j));
			}
		}
		front = next;
	}
	// the nose's tip: the skin's front-most point
	let tip = 0;
	for (let i = 1; i < m; i++) if (P.getZ(i) > P.getZ(tip)) tip = i;
	const T = new THREE.Vector3().fromBufferAttribute(P, tip);
	// the head's middle (for the hairline's way round) and its crown
	let crown = -Infinity;
	for (let i = 0; i < m; i++) crown = Math.max(crown, P.getY(i));
	const C = { y: E.y, z: E.z - 0.085 };
	/** the hairline's height, by how far round from the front (radians): the forehead, the temples, the sideburns in
	 *  front of the ears, over the ears, behind them, the nape */
	const LINE = /** @type {[number, number][]} */ ([[0, 0.06], [0.5, 0.057], [0.85, 0.05], [0.98, 0.036], [1.06, 0.01], [1.12, -0.025], [1.24, -0.025], [1.32, 0], [1.75, 0], [1.9, -0.015], [2.2, -0.025], [2.6, -0.045], [Math.PI, -0.07]]);
	const lineAt = (/** @type {number} */ th) => {
		let k = 0;
		while (k < LINE.length - 2 && th > LINE[k + 1][0]) k++;
		const [a0, h0] = LINE[k], [a1, h1] = LINE[k + 1];
		return E.y + h0 + ((h1 - h0) * Math.min(1, Math.max(0, th - a0))) / (a1 - a0);
	};
	// the ears and a little round them: no hair grows there
	let near = Float32Array.from(ears);
	for (let round = 0; round < 2; round++) near = near.map((x, i) => Math.max(x, ...[...nb[i]].map((j) => near[j])));
	const hairW = new Float32Array(m), hairF = new Float32Array(m);
	for (let i = 0; i < m; i++) {
		v.fromBufferAttribute(P, i);
		const th = Math.abs(Math.atan2(v.x, v.z - C.z));
		// a line that wanders a little, as a real one does
		const wander = 0.0012 * Math.sin(th * 9 + 1.3);
		// how far over the line (m); the ears always under it
		hairF[i] = near[i] < 0.3 ? v.y - lineAt(th) - wander : -0.02;
		hairW[i] = smooth(-0.004, 0.011, hairF[i]);
	}
	// the face's front, for laying hairs on it: its triangles in 4 mm cells across (x, y)
	const cells = new Map();
	const idx = /** @type {THREE.BufferAttribute} */ (skin.geo.index);
	const cell = (/** @type {number} */ x, /** @type {number} */ y) => `${Math.floor(x / 0.004)},${Math.floor(y / 0.004)}`;
	for (let t = 0; t < idx.count; t += 3) {
		const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
		if (P.getZ(a) < E.z - 0.03) continue;
		const xs = [P.getX(a), P.getX(b), P.getX(c)], ys = [P.getY(a), P.getY(b), P.getY(c)];
		for (let cx = Math.floor(Math.min(...xs) / 0.004); cx <= Math.floor(Math.max(...xs) / 0.004); cx++)
			for (let cy = Math.floor(Math.min(...ys) / 0.004); cy <= Math.floor(Math.max(...ys) / 0.004); cy++) {
				const k = `${cx},${cy}`;
				if (!cells.has(k)) cells.set(k, []);
				cells.get(k).push(a, b, c);
			}
	}
	const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
	/** the front of the skin at (x, y): the point and its normal (smoothed), or null */
	const surface = (/** @type {number} */ x, /** @type {number} */ y) => {
		const list = cells.get(cell(x, y)) ?? [];
		let best = null, bz = -Infinity;
		for (let k = 0; k < list.length; k += 3) {
			A.fromBufferAttribute(P, list[k]);
			B.fromBufferAttribute(P, list[k + 1]);
			Cc.fromBufferAttribute(P, list[k + 2]);
			const d = (B.x - A.x) * (Cc.y - A.y) - (Cc.x - A.x) * (B.y - A.y);
			if (Math.abs(d) < 1e-14) continue;
			const u = ((x - A.x) * (Cc.y - A.y) - (Cc.x - A.x) * (y - A.y)) / d, t = ((B.x - A.x) * (y - A.y) - (x - A.x) * (B.y - A.y)) / d;
			if (u < 0 || t < 0 || u + t > 1) continue;
			const z = A.z + u * (B.z - A.z) + t * (Cc.z - A.z);
			if (z > bz) {
				bz = z;
				const nn = new THREE.Vector3().fromBufferAttribute(N, list[k]).multiplyScalar(1 - u - t);
				nn.addScaledVector(new THREE.Vector3().fromBufferAttribute(N, list[k + 1]), u).addScaledVector(new THREE.Vector3().fromBufferAttribute(N, list[k + 2]), t);
				best = { p: new THREE.Vector3(x, y, z), n: nn.normalize(), tri: /** @type {[number, number, number]} */ ([list[k], list[k + 1], list[k + 2]]), bary: /** @type {[number, number, number]} */ ([1 - u - t, u, t]) };
			}
		}
		return best;
	};
	const parts = /** @type {Record<string, ReturnType<typeof piece>>} */ ({});
	for (const name of ['teeth-upper', 'teeth-lower', 'tongue']) parts[name] = piece(name, pos, joy, name === 'tongue' ? 1 : 2);
	return { skin, friendly, hollow, dist, inside, socket, ears, mouth: { y: my, z: mz, w: mw }, tip: T, crown, eyes, E, hairW, hairF, surface, parts };
}

/** a face's head at a version (its smile), built once @param {Face} face @param {number} [v] */
export const headOf = (face = 'man', v = HEAD_V) => (BUILT[`${face}:${smileOf(v)}`] ??= build(face, smileOf(v)));

/** how high the top of a face's head is, in the stand-in's measure @param {Face} face */
export const crownOf = (face = 'man') => HEAD_PEOPLE[KEY[face]].crown;

/** where the head ends, by depth (z, y; m, in the stand-in's measure): under the chin and the jaw, up under the ear
 *  to the jaw's angle, the skull's foot behind it */
const JAW = [[-0.12, 1.565], [-0.03, 1.565], [-0.015, 1.59], [0.01, 1.595], [0.03, 1.572], [0.05, 1.553], [0.15, 1.55]];
const jawAt = (/** @type {number} */ z) => {
	if (z <= JAW[0][0]) return JAW[0][1];
	for (let k = 1; k < JAW.length; k++) if (z <= JAW[k][0]) return JAW[k - 1][1] + ((z - JAW[k - 1][0]) / (JAW[k][0] - JAW[k - 1][0])) * (JAW[k][1] - JAW[k - 1][1]);
	return JAW[JAW.length - 1][1];
};

/** its weights on the stand-in's bones by where a point is: the head wholly down to the line under the jaw and the
 *  chin (JAW), so the jaw turns with the face; below it the neck takes over within 5 cm; the chest where the neck goes
 *  into the shirt. Before v8 the line ran straight from under the chin to the skull's foot, and the jaw's underside
 *  hung on the neck, sheared from the face when the head turned. @param {THREE.Vector3} p @param {number} [v]
 *  @returns {[string, number][]} */
export function headWeights(p, v = HEAD_V) {
	const line = v >= 8 ? jawAt(p.z) : 1.606 - 0.36 * p.z;
	const head = v >= 8 ? smooth(line - 0.05, line, p.y) : smooth(line - 0.016, line + 0.018, p.y), chest = smooth(1.53, 1.49, p.y);
	const neck = Math.max(0, 1 - head - chest);
	return /** @type {[string, number][]} */ ([['head', head], ['neck', neck], ['chest', chest]]).filter(([, x]) => x > 0);
}

/** a strand's offsets in the smile: those of the skin it grows from, the same along it @param {Float32Array} joy
 *  @param {number[]} tri @param {number[]} bary @param {number} count */
const follow = (joy, tri, bary, count) => {
	const d = [0, 1, 2].map((c) => tri.reduce((sum, i, k) => sum + joy[i * 3 + c] * bary[k], 0));
	return Float32Array.from({ length: count * 3 }, (_, k) => d[k % 3]);
};

/** a hair as a thin ribbon: from `root` along `dir`, curling towards `curl`, `len` long and `wid` wide at its root,
 *  narrowing to its tip, its flat towards `face` @param {number[]} pos @param {number[]} idx
 *  @param {THREE.Vector3} root @param {THREE.Vector3} dir @param {THREE.Vector3} curl @param {THREE.Vector3} face
 *  @param {number} len @param {number} wid @param {number} [segs] */
function strand(pos, idx, root, dir, curl, face, len, wid, segs = 3) {
	const base = pos.length / 3, side = new THREE.Vector3().crossVectors(face, dir).normalize();
	const p = root.clone(), d = dir.clone();
	for (let k = 0; k <= segs; k++) {
		const t = k / segs, ww = wid * (1 - 0.85 * t);
		pos.push(p.x + side.x * ww, p.y + side.y * ww, p.z + side.z * ww, p.x - side.x * ww, p.y - side.y * ww, p.z - side.z * ww);
		if (k) idx.push(base + 2 * k - 2, base + 2 * k - 1, base + 2 * k, base + 2 * k - 1, base + 2 * k + 1, base + 2 * k);
		p.addScaledVector(d, len / segs);
		d.addScaledVector(curl, 1 / segs).normalize();
	}
	return segs * 2 + 2;
}

/**
 * The head's pieces for a look: the skin (its neck weighted onto the stand-in's neck and chest, its smile as the
 * morph `joy` and from v9 its friendly gaze as the morph `friendly`), its eyes, lashes, teeth, tongue, brows and hair.
 * Its catchlights from v9 take the material at index 3 (CATCHLIGHT).
 * @param {{ skin: string, lips: string, brows: string, iris: string, hair: string, hairColour: string, face?: Face }} k
 * @param {number} [ver] the stand-in's version it is built at (its smile, SMILES; its weights, headWeights)
 * @returns {Piece[]}
 */
export function headPieces(k, ver = HEAD_V) {
	const h = headOf(k.face ?? 'man', ver);
	const weights = (/** @type {THREE.Vector3} */ p) => headWeights(p, ver);
	const kind = ver >= 9;
	const { skin, E } = h;
	const P = skin.geo.attributes.position, m = skin.n;
	const base = new THREE.Color(k.skin), lips = new THREE.Color(k.lips), warm = base.clone().multiply(new THREE.Color(1.0, 0.82, 0.78));
	const brow = new THREE.Color(k.brows), hairC = new THREE.Color(k.hairColour), mouth = new THREE.Color('#6e2a2e'), deep = new THREE.Color('#1c0a0b');
	const socketC = base.clone().lerp(new THREE.Color('#c77f7a'), 0.55);
	const v = new THREE.Vector3();
	const spot = (/** @type {THREE.Vector3} */ p, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {number} */ r) => Math.exp(-((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2) / (r * r));
	const bald = k.hair === 'none';
	const colours = Array.from({ length: m }, (_, i) => {
		v.fromBufferAttribute(P, i);
		const c = base.clone();
		// warm: the cheeks, the nose's tip and wings, the ears
		const cheeks = spot(v, E.x * 1.5, E.y - 0.032, E.z, 0.024) + spot(v, -E.x * 1.5, E.y - 0.032, E.z, 0.024);
		const nose = spot(v, h.tip.x, h.tip.y, h.tip.z, 0.011) + 0.6 * (spot(v, 0.016, h.tip.y + 0.004, h.tip.z - 0.016, 0.008) + spot(v, -0.016, h.tip.y + 0.004, h.tip.z - 0.016, 0.008));
		c.lerp(warm, Math.min(0.6, 0.4 * cheeks + 0.45 * nose + 0.45 * h.ears[i]));
		// the lips: over and under where they meet, the upper thinner with its bow, narrowing to the corners
		const across = Math.abs(v.x) / (h.mouth.w * 1.05);
		if (across < 1 && v.z > h.mouth.z - 0.015 && h.inside[i] < 0.5) {
			const up = 0.0072 * Math.pow(1 - across * across, 0.55) - 0.001 * Math.exp(-((v.x / 0.0035) ** 2)) + 0.0006 * Math.exp(-(((Math.abs(v.x) - 0.0055) / 0.003) ** 2));
			const low = 0.0095 * Math.pow(1 - Math.pow(across, 1.8), 0.6), d = v.y - h.mouth.y;
			c.lerp(lips, 0.75 * (d >= 0 ? smooth(up + 0.0006, up - 0.0006, d) : smooth(-low - 0.0008, -low + 0.0008, d)));
		}
		// the inside of the mouth: wet and dark, darker deeper in; the eyes' sockets pink behind the lids
		if (h.inside[i] > 0.01) c.lerp(mouth.clone().lerp(deep, smooth(0.003, 0.018, h.mouth.z - v.z)), Math.min(1, h.inside[i] * 1.2));
		if (h.socket[i] > 0.01) c.lerp(socketC, Math.min(1, h.socket[i] * 1.3));
		// the scalp under the hair, so it rises out of its colour (none when bald)
		if (!bald) c.lerp(hairC, 0.45 * smooth(-0.005, 0.002, h.hairF[i]) + 0.55 * smooth(0.002, 0.004, h.hairF[i]));
		// the brows' shadow on the skin under their hairs
		for (const sx of [-1, 1]) c.lerp(brow, 0.3 * spot(v, sx * E.x * 1.12, E.y + 0.0235, v.z, 0.011) * smooth(0.007, 0.002, Math.abs(v.y - E.y - 0.0235 - 0.002 * Math.sin(Math.PI * Math.min(1, Math.abs(v.x) / (E.x * 2))))));
		// a shade under the eyes and in the lids' crease
		for (const sx of [-1, 1]) c.multiplyScalar(1 - 0.07 * spot(v, sx * E.x * 1.05, E.y - 0.016, v.z, 0.012) - 0.06 * spot(v, sx * E.x, E.y + 0.011, v.z, 0.01));
		// every hollow a little darker: the eyes' corners, the nostrils, the ears' folds, the mouth's corners
		c.multiplyScalar(1 - Math.min(0.5, Math.max(0, h.hollow[i] * 2.4)));
		return c;
	});
	/** @type {Piece[]} */
	const out = [{ geo: skin.geo.clone(), color: (_p, i = 0) => colours[i], weights, morph: kind ? { joy: skin.joy, friendly: h.friendly } : { joy: skin.joy } }];
	// the eyes: a glossy ball each — its white, an iris with a darker rim, a pupil, a catchlight — in the lids' opening
	const iris = new THREE.Color(k.iris), rim = iris.clone().multiplyScalar(0.5), inner = iris.clone().lerp(new THREE.Color('#c9a25a'), 0.25);
	const white = new THREE.Color('#f2eee8'), edge = new THREE.Color('#d9c4bc');
	for (const side of /** @type {const} */ (['l', 'r'])) {
		const e = h.eyes[side], R = e.r * 0.97, c = new THREE.Vector3(...e.at).add(new THREE.Vector3(0, 0, -0.0012));
		const front = new THREE.Vector3(0, 0, 1);
		const cap = (/** @type {number} */ r, /** @type {number} */ half, seg = 32) => {
			const g = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round((seg * half) / Math.PI)), 0, Math.PI * 2, 0, half);
			g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), front));
			return g.translate(c.x, c.y, c.z);
		};
		// by how far round from the eye's front a point of it is (radians)
		const off = (/** @type {THREE.Vector3} */ p) => Math.acos(Math.min(1, Math.max(-1, (p.z - c.z) / Math.max(1e-6, p.distanceTo(c)))));
		out.push(
			{ geo: cap(R, Math.PI), color: (p) => white.clone().lerp(edge, smooth(0.6, 1.3, off(p))), bone: 'head', mat: 1 },
			{ geo: cap(R + 0.00012, 0.5, 40), color: (p) => rim.clone().lerp(iris, smooth(0.5, 0.4, off(p))).lerp(inner, 0.6 * smooth(0.28, 0.18, off(p))), bone: 'head', mat: 1 },
			{ geo: cap(R + 0.0002, 0.175, 24), color: '#0b0908', bone: 'head', mat: 1 }
		);
		if (!kind) {
			const glint = new THREE.SphereGeometry(1, 8, 6).scale(0.0008, 0.0008, 0.0004).translate(...new THREE.Vector3(-0.3, 0.35, 0.88).normalize().multiplyScalar(R + 0.0003).add(c).toArray());
			out.push({ geo: glint, color: '#ffffff', bone: 'head', mat: 1 });
			continue;
		}
		// v9's catchlight: a disc CATCH.core across on the eye, over the iris up and to the left of the pupil (the same
		// place in both eyes, as one light's), lit from within (CATCHLIGHT) so it shows in any light; round it a ring
		// of the iris lightened towards white, lit as the eye is, softening its edge
		const at = new THREE.Vector3(...CATCH.at).normalize(), turn = new THREE.Quaternion().setFromUnitVectors(front, at);
		const disc = (/** @type {number} */ r, /** @type {number} */ lift) => new THREE.CircleGeometry(r, 24).applyQuaternion(turn).translate(...at.clone().multiplyScalar(R + lift).add(c).toArray());
		out.push(
			{ geo: disc(CATCH.soft / 2, 0.0003), color: `#${inner.clone().lerp(white, 0.55).getHexString()}`, bone: 'head', mat: 1 },
			{ geo: disc(CATCH.core / 2, 0.0004), color: '#ffffff', bone: 'head', mat: 3 }
		);
	}
	out.push(...lashes(h, kind), ...brows(h, k.brows, k.skin, kind), ...hair(h, k));
	// the teeth and the tongue, moving with the smile
	for (const upper of [true, false]) {
		const t = h.parts[upper ? 'teeth-upper' : 'teeth-lower'];
		t.geo.computeBoundingBox();
		const box = /** @type {THREE.Box3} */ (t.geo.boundingBox), front = box.max.z;
		out.push({ geo: t.geo.clone(), color: (p) => teeth(p, upper, upper ? box.min.y : box.max.y, front, ver), weights, morph: { joy: t.joy }, mat: 1 });
	}
	out.push({ geo: h.parts.tongue.geo.clone().translate(0, -0.009, -0.008), color: '#6c3036', weights, morph: { joy: h.parts.tongue.joy } });
	return out;
}

const ENAMEL = new THREE.Color('#efe9dc'), GAP = new THREE.Color('#7d7268'), GUM = new THREE.Color('#c2706e'), BACK = new THREE.Color('#5a4c48');
/** where one tooth meets the next, from the middle out, seen from the front (m): incisors, canines, premolars */
const TEETH = [0, 0.0082, 0.0142, 0.0195, 0.0238, 0.0276, 0.0312];
/** from v10 the two molars behind them too, turning back along the arch (seen from the front they are narrow): the
 *  teeth reach 35.8 mm out, and past the premolars' 31.2 mm the table had no tooth, so 350 points of the stand-in's
 *  teeth took no colour at all (NaN) */
const TEETH_V10 = [...TEETH, 0.0338, 0.0362];

/** a tooth's colour at p: enamel, a thin dark line between teeth, the gums past each crown, darker further back
 *  @param {THREE.Vector3} p @param {boolean} upper @param {number} edge the biting edge's height @param {number} front
 *  @param {number} ver the stand-in's version (before v10 the molars are left as they were built: uncoloured) */
function teeth(p, upper, edge, front, ver) {
	const x = Math.abs(p.x), T = ver >= 10 ? TEETH_V10 : TEETH;
	let k = 1;
	while (k < T.length - 1 && x > T[k]) k++;
	const a = T[k - 1], b = T[k], at = (x - a) / (b - a); // across this tooth, 0 to 1
	const u = ver >= 10 ? Math.min(1, Math.max(0, at)) : at;
	const crown = (upper ? 0.0098 : 0.0105) * (k > 2 ? 0.92 : 1) - 0.0012 * (1 - Math.sqrt(Math.sin(Math.PI * u))); // the gum's scallops
	const up = upper ? p.y - edge : edge - p.y; // from the biting edge to the root
	const c = ENAMEL.clone().lerp(GAP, 0.75 * smooth(0.1, 0.0, Math.min(u, 1 - u)));
	c.lerp(GUM, smooth(crown - 0.0005, crown + 0.0007, up));
	c.lerp(BACK, smooth(0.012, 0.04, front - p.z));
	// before v10 the molars past the table took no colour (NaN), which the screen drew black: black it stays, as a
	// number, so the asset box takes the skin
	if (ver < 10 && !(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b))) c.setRGB(0, 0, 0);
	return c;
}

/** a little random, the same each time @param {number} seed */
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** the lashes: single hairs along each upper lid's edge — where the lid, seen from the front, stops covering the
 *  eye — long in the middle, curling up; they move with the lid in the smile (and from v9, `kind`, in the friendly
 *  gaze) @param {ReturnType<typeof build>} h @param {boolean} [kind] @returns {Piece[]} */
function lashes(h, kind = false) {
	const pos = /** @type {number[]} */ ([]), idx = /** @type {number[]} */ ([]), joy = /** @type {number[]} */ ([]), gaze = /** @type {number[]} */ ([]);
	const rand = rng(5);
	for (const side of /** @type {const} */ (['l', 'r'])) {
		const e = h.eyes[side], R = e.r, [cx, cy, cz] = e.at, sx = Math.sign(cx);
		// the eye's front at (x, y), or −∞ off it
		const ball = (/** @type {number} */ x, /** @type {number} */ y) => {
			const r2 = R * R - (x - cx) ** 2 - (y - cy) ** 2;
			return r2 > 0 ? cz + Math.sqrt(r2) : -Infinity;
		};
		const many = 70;
		for (let s = 0; s < many; s++) {
			const u = (s + rand() * 0.8) / many; // inner corner (0) to outer (1)
			const x = cx + sx * R * (-0.92 + 1.95 * u);
			// down from over the eye to where the eye shows under the lid
			let edge = null, seen = false;
			for (let y = cy + R; y > cy - R * 0.4 && !seen; y -= 0.0001) {
				const at = h.surface(x, y);
				if (at && at.p.z < ball(x, y) - 0.0002) seen = true;
				else edge = at;
			}
			if (!edge || !seen) continue;
			// out of the lid's edge, forwards and a little up, curling up; longest in the middle, fanned to the sides
			const peak = Math.sin(Math.PI * Math.min(1, u * 1.05));
			const fan = (u - 0.5) * 0.9 * sx;
			const dir = new THREE.Vector3(fan, -0.2, 1).normalize();
			const curl = new THREE.Vector3(fan * 0.3, 2, -0.5);
			const len = 0.0035 + 0.0035 * peak + 0.0008 * rand();
			const face = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
			const root = edge.p.clone().add(new THREE.Vector3(0, 0.0001, 0.0001));
			const count = strand(pos, idx, root, dir, curl, face, len, 0.00011 + 0.00004 * rand(), 5);
			joy.push(...follow(h.skin.joy, edge.tri, edge.bary, count));
			gaze.push(...follow(h.friendly, edge.tri, edge.bary, count));
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setIndex(idx);
	g.computeVertexNormals();
	return [{ geo: g, color: '#1d1511', bone: 'head', mat: 2, morph: kind ? { joy: new Float32Array(joy), friendly: new Float32Array(gaze) } : { joy: new Float32Array(joy) } }];
}

/** the brows: single hairs laid on the skin along each brow's arch, rising at the inner end and combed outwards along
 *  it, thinning towards the tail; they move with the smile (and from v9, `kind`, the friendly gaze)
 *  @param {ReturnType<typeof build>} h @param {string} colour @param {string} skinTone @param {boolean} [kind]
 *  @returns {Piece[]} */
function brows(h, colour, skinTone, kind = false) {
	const { E } = h;
	const out = /** @type {Piece[]} */ ([]);
	for (const sx of [-1, 1]) {
		const rand = rng(sx > 0 ? 7 : 11);
		const pos = /** @type {number[]} */ ([]), idx = /** @type {number[]} */ ([]), joy = /** @type {number[]} */ ([]), gaze = /** @type {number[]} */ ([]);
		for (let s = 0; s < 240; s++) {
			const u = Math.pow(rand(), 0.8); // along the brow, inner (0) to tail (1)
			const x = sx * (E.x * 0.4 + E.x * 1.3 * u);
			const arch = E.y + 0.0215 + 0.005 * Math.sin(Math.PI * Math.min(1, u * 1.2)) - 0.0035 * u * u;
			const half = 0.0044 * (1 - 0.55 * u); // the band's half height, thinner to the tail
			const y = arch + (rand() * 2 - 1) * half;
			const at = h.surface(x, y);
			if (!at) continue;
			// its way: up at the inner end, turning out along the arch, the lower hairs a little up, the upper a little down
			const turn = smooth(0, 0.35, u);
			const dir = new THREE.Vector3(sx * (0.25 + 0.75 * turn), 1 - 0.8 * turn + (y > arch ? -0.18 : 0.12) * turn, 0).normalize();
			dir.addScaledVector(at.n, -dir.dot(at.n)).normalize(); // along the skin
			const len = 0.0045 + 0.003 * rand() * (1 - 0.4 * u);
			const curl = at.n.clone().multiplyScalar(-0.15);
			const count = strand(pos, idx, at.p.clone().addScaledVector(at.n, 0.00025), dir.clone().addScaledVector(at.n, 0.25).normalize(), curl, at.n, len, 0.0002);
			joy.push(...follow(h.skin.joy, at.tri, at.bary, count));
			gaze.push(...follow(h.friendly, at.tri, at.bary, count));
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		g.setIndex(idx);
		g.computeVertexNormals();
		const c = new THREE.Color(colour).lerp(new THREE.Color(skinTone), 0.06);
		out.push({ geo: g, color: `#${c.getHexString()}`, bone: 'head', mat: 2, morph: kind ? { joy: new Float32Array(joy), friendly: new Float32Array(gaze) } : { joy: new Float32Array(joy) } });
	}
	return out;
}

/** the hair: a layer grown over the scalp from its line, thin at the line and fuller on top, its colour fading into
 *  the skin's at the line; for `long` a fall down the back and sides, for `bun` a knot at the back of the crown
 *  @param {ReturnType<typeof build>} h @param {{ hair: string, hairColour: string }} k
 *  @returns {Piece[]} */
function hair(h, k) {
	if (k.hair === 'none') return [];
	const { skin, E, hairF, crown } = h;
	const P = skin.geo.attributes.position, N = skin.geo.attributes.normal, I = /** @type {THREE.BufferAttribute} */ (skin.geo.index);
	const pos = /** @type {number[]} */ ([]), nor = /** @type {number[]} */ ([]), idx = /** @type {number[]} */ ([]);
	const made = new Map();
	const p = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
	/** a point of the layer: on a vertex of the skin (i = j) or where the line crosses the edge i–j, lifted off it */
	const point = (/** @type {number} */ i, /** @type {number} */ j) => {
		const key = i < j ? `${i},${j}` : `${j},${i}`;
		if (made.has(key)) return made.get(key);
		const t = i === j ? 0 : hairF[i] / (hairF[i] - hairF[j]);
		p.fromBufferAttribute(P, i).lerp(q.fromBufferAttribute(P, j), t);
		n.fromBufferAttribute(N, i).lerp(m.fromBufferAttribute(N, j), t).normalize();
		const f = i === j ? hairF[i] : 0;
		const top = smooth(E.y + 0.02, crown - 0.01, p.y), fore = smooth(-0.12, 0.08, p.z - E.z);
		const lift = 0.0004 + (0.0016 + (0.0075 + 0.0055 * fore) * top) * smooth(0, 0.015, f);
		made.set(key, pos.length / 3);
		pos.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift);
		nor.push(n.x, n.y, n.z);
		return made.get(key);
	};
	// every triangle of the skin, cut along the hairline: what is over it is kept
	for (let t = 0; t < I.count; t += 3) {
		const tri = [I.getX(t), I.getX(t + 1), I.getX(t + 2)];
		const over = tri.map((i) => hairF[i] > 0);
		if (!over.some(Boolean)) continue;
		/** @type {number[]} */ const poly = [];
		for (let k = 0; k < 3; k++) {
			const a = tri[k], b = tri[(k + 1) % 3];
			if (over[k]) poly.push(point(a, a));
			if (over[k] !== over[(k + 1) % 3]) poly.push(point(a, b));
		}
		for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0], poly[k], poly[k + 1]);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	g.setIndex(idx);
	const out = /** @type {Piece[]} */ ([{ geo: g, color: k.hairColour, bone: 'head' }]);
	const egg = (/** @type {number[]} */ c, /** @type {number[]} */ s, /** @type {number[]} */ r = [0, 0, 0], seg = 20) => {
		const e = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7));
		e.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...c), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
		return e;
	};
	const back = E.z - 0.17; // about the back of the skull
	if (k.hair === 'long') {
		out.push({ geo: egg([0, E.y - 0.075, back + 0.035], [0.085, 0.14, 0.05], [0.12, 0, 0], 28), color: k.hairColour, bone: 'head' });
		for (const x of [-1, 1]) out.push({ geo: egg([x * 0.07, E.y - 0.045, E.z - 0.1], [0.022, 0.1, 0.06], [0, 0, x * 0.08], 16), color: k.hairColour, bone: 'head' });
	}
	if (k.hair === 'bun') out.push({ geo: egg([0, E.y + 0.07, back + 0.005], [0.038, 0.036, 0.036], [0, 0, 0], 20), color: k.hairColour, bone: 'head' });
	return out;
}
