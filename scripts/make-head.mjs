/*
 * The stand-in's head from MakeHuman (CC0 1.0: its base mesh, targets and expression units; see their LICENSE.md):
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/makehumancommunity/makehuman.git mh
 *   (cd mh && git sparse-checkout set makehuman/data/3dobjs makehuman/data/targets/macrodetails makehuman/data/targets/expression makehuman/data/targets/ears)
 *   node scripts/make-head.mjs mh/makehuman/data
 *
 * writes src/lib/actors/head.data.js: the head and neck of MakeHuman's base mesh (a young man and a young woman, each
 * the average of its three races' targets), cut under the neck and drawn down into the shirt; its teeth, tongue and
 * lash lines; its eyes' middles and sizes; and the offsets of a smile. All in the stand-in's measure (./human.ts: a
 * person of 1.80 m, metres, facing +z), the quads as MakeHuman draws them: the stand-in smooths them itself
 * (./subdivide.js).
 */
import fs from 'fs';

const D = process.argv[2] ?? 'mh/makehuman/data';
const OUT = new URL('../src/lib/actors/head.data.js', import.meta.url);

const obj = fs.readFileSync(`${D}/3dobjs/base.obj`, 'utf8').split('\n');
/** @type {number[][]} */ const V = [];
/** @type {{ g: string, v: number[] }[]} */ const faces = [];
let group = '';
for (const l of obj) {
	if (l.startsWith('v ')) V.push(l.slice(2).trim().split(/\s+/).map(Number));
	else if (l.startsWith('g ')) group = l.slice(2).trim();
	else if (l.startsWith('f ')) faces.push({ g: group, v: l.slice(2).trim().split(/\s+/).map((s) => Number(s.split('/')[0]) - 1) });
}
/** a target's offsets, by vertex @param {string} path */
const target = (path) => {
	const t = new Map();
	for (const l of fs.readFileSync(`${D}/targets/${path}`, 'utf8').split('\n')) {
		if (!l || l.startsWith('#')) continue;
		const [i, x, y, z] = l.trim().split(/\s+/).map(Number);
		t.set(i, [x, y, z]);
	}
	return t;
};
/** the base mesh with targets laid on it, each at its weight @param {[string, number][]} list */
const shaped = (list) => {
	const P = V.map((p) => p.slice());
	for (const [path, w] of list) for (const [i, d] of target(path)) for (let k = 0; k < 3; k++) P[i][k] += d[k] * w;
	return P;
};
const RACES = ['african', 'asian', 'caucasian'];
// every face at rest a little friendly: the eyes open a little wider, the mouth's corners lifted a touch
const unit = (/** @type {string} */ name) => `expression/units/caucasian/${name}.target`;
const REST = /** @type {[string, number][]} */ ([[unit('eye-left-opened-up'), 0.3], [unit('eye-right-opened-up'), 0.3], [unit('mouth-corner-puller'), 0.18]]);
const people = {
	m: shaped([...RACES.map((r) => /** @type {[string, number]} */ ([`macrodetails/${r}-male-young.target`, 1 / 3])), ...REST]),
	f: shaped([...RACES.map((r) => /** @type {[string, number]} */ ([`macrodetails/${r}-female-young.target`, 1 / 3])), ...REST])
};

// the head and neck: the body's faces over the neck's foot (in the base mesh), and the helpers in the head
const CUT = 5.86;
const body = faces.filter((f) => f.g === 'body' && f.v.every((i) => V[i][1] > CUT));
const helpers = /** @type {Record<string, string>} */ ({ 'teeth-upper': 'helper-upper-teeth', 'teeth-lower': 'helper-lower-teeth', tongue: 'helper-tongue', 'lash-upper-l': 'helper-l-eyelashes-2', 'lash-upper-r': 'helper-r-eyelashes-2', 'lash-lower-l': 'helper-l-eyelashes-1', 'lash-lower-r': 'helper-r-eyelashes-1' });
const parts = /** @type {Record<string, number[][]>} */ ({ skin: body.map((f) => f.v) });
for (const [name, g] of Object.entries(helpers)) parts[name] = faces.filter((f) => f.g === g).map((f) => f.v);
// one numbering for all of them
/** @type {number[]} */ const used = [];
const at = new Map();
for (const fs_ of Object.values(parts)) for (const f of fs_) for (const i of f) if (!at.has(i)) (at.set(i, used.length), used.push(i));

// the neck's cut: its open edges at the bottom, in order round
const count = new Map();
for (const f of parts.skin) for (let k = 0; k < 4; k++) {
	const a = f[k], b = f[(k + 1) % 4], key = a < b ? `${a},${b}` : `${b},${a}`;
	count.set(key, (count.get(key) ?? 0) + 1);
}
const next = new Map();
for (const f of parts.skin) for (let k = 0; k < 4; k++) {
	const a = f[k], b = f[(k + 1) % 4], key = a < b ? `${a},${b}` : `${b},${a}`;
	if (count.get(key) === 1 && V[a][1] < CUT + 0.4 && V[b][1] < CUT + 0.4) next.set(b, a); // walking the loop the other way round, so the new quads face out
}
const loop = [];
for (let v = next.keys().next().value; v !== undefined && !loop.includes(v); v = next.get(v)) loop.push(v);
if (loop.length !== next.size) throw new Error(`the neck's cut is not one loop (${loop.length} of ${next.size})`);

const S = 0.104; // the base mesh's decimetres to the stand-in's metres (a 1.80 m person's head: chin to crown ~23 cm)
const COLLAR = 1.532, NECK_Z = -0.016;
const RINGS = [0.022, 0.045, 0.07]; // how far the neck goes on down into the shirt (m)

/** a person's head in the stand-in's measure: the neck's cut centred on the collar */
const fit = (/** @type {number[][]} */ P) => {
	const c = [0, 0, 0];
	for (const i of loop) for (let k = 0; k < 3; k++) c[k] += P[i][k] / loop.length;
	const T = (/** @type {number[]} */ p) => [(p[0] - c[0]) * S, COLLAR + (p[1] - c[1]) * S, NECK_Z + (p[2] - c[2]) * S];
	const pos = used.map((i) => T(P[i]));
	// the neck on down: rings under the cut, a little wider each
	for (const d of RINGS) for (const i of loop) {
		const p = T(P[i]);
		pos.push([p[0] * (1 + d * 0.8), p[1] - d, NECK_Z + (p[2] - NECK_Z) * (1 + d * 0.8)]);
	}
	const eye = (/** @type {string} */ g) => {
		const ids = [...new Set(faces.filter((f) => f.g === g).flatMap((f) => f.v))];
		const lo = [0, 1, 2].map((k) => Math.min(...ids.map((i) => P[i][k]))), hi = [0, 1, 2].map((k) => Math.max(...ids.map((i) => P[i][k])));
		const mid = T(lo.map((x, k) => (x + hi[k]) / 2));
		return { at: mid.map((x) => +x.toFixed(5)), r: +(((hi[0] - lo[0] + hi[1] - lo[1]) / 4) * S).toFixed(5), front: +(hi[2] * S - lo[2] * S).toFixed(5) };
	};
	return { pos, eyes: { l: eye('helper-l-eye'), r: eye('helper-r-eye') }, crown: Math.max(...pos.map((p) => p[1])) };
};
const fitted = Object.fromEntries(Object.entries(people).map(([k, P]) => [k, fit(P)]));

// the neck's quads on down
const L = loop.length, base = used.length;
const neck = [];
for (let r = 0; r < RINGS.length; r++)
	for (let k = 0; k < L; k++) {
		const up = (j) => (r === 0 ? at.get(loop[j]) : base + (r - 1) * L + j), down = (j) => base + r * L + j;
		const j = (k + 1) % L;
		neck.push([up(k), up(j), down(j), down(k)]);
	}

// the expression units of MakeHuman 1.0, each on its own (offsets in m on the vertices it moves): a face blends them
const UNITS = ['mouth-corner-puller', 'mouth-upward-retraction', 'mouth-parling', 'mouth-elevation', 'mouth-open', 'mouth-eversion', 'mouth-depression', 'mouth-retraction', 'mouth-compression', 'eye-left-slit', 'eye-right-slit', 'eye-left-opened-up', 'eye-right-opened-up', 'eye-left-closure', 'eye-right-closure', 'eyebrows-left-up', 'eyebrows-right-up', 'eyebrows-left-inner-up', 'eyebrows-right-inner-up', 'eyebrows-left-down', 'eyebrows-right-down', 'nose-left-elevation', 'nose-right-elevation'];
const units = Object.fromEntries(UNITS.map((name) => {
	const ids = [], d = [];
	for (const [i, dd] of target(`expression/units/caucasian/${name}.target`)) {
		const j = at.get(i);
		if (j === undefined || Math.hypot(...dd) < 1e-4) continue;
		ids.push(j);
		d.push(...dd.map((x) => x * S));
	}
	return [name, { ids, d }];
}));

// what each vertex of the skin is, by MakeHuman's texture map: its islands are the face and scalp, the mouth's inside
// (from where the lips meet), the eyes' sockets behind the lids, and the neck
const vt = [];
for (const l of obj) if (l.startsWith('vt ')) vt.push(l.slice(3).trim().split(/\s+/).map(Number));
const uvOf = new Map();
for (const l of obj) if (l.startsWith('f ')) for (const s_ of l.slice(2).trim().split(/\s+/)) {
	const [vi, ti] = s_.split('/').map(Number);
	if (!uvOf.has(vi - 1)) uvOf.set(vi - 1, vt[ti - 1]);
}
const P0 = fitted.m.pos;
const region = new Uint8Array(P0.length); // 0 face and scalp, 1 the mouth's inside, 2 an eye's socket, 3 the neck, 4 an ear
for (const f of parts.skin) for (const i of f) {
	const [u, v] = uvOf.get(i) ?? [1, 1];
	region[at.get(i)] = u > 0.75 && u < 0.93 && v < 0.14 ? 1 : u < 0.16 && v > 0.54 && v < 0.64 ? 2 : u < 0.5 && v > 0.89 ? 3 : 0;
}
for (let k = used.length; k < P0.length; k++) region[k] = 3;
// the ears: of what MakeHuman's ear-scaling targets move (the ear and the scalp round it), the points with skin
// between them and the head's middle — the ear's two sides, standing off the skull
const tris = parts.skin.flatMap((f) => [[f[0], f[1], f[2]], [f[0], f[2], f[3]]].map((t) => t.map((i) => at.get(i))));
const behind = (/** @type {number} */ k) => {
	const [px, py, pz] = P0[k], dir = -Math.sign(px);
	let hits = 0;
	for (const [a, b, c] of tris) {
		if (a === k || b === k || c === k) continue;
		const A = P0[a], B = P0[b], C = P0[c];
		// where the line through (py, pz) along x crosses the triangle, if it does
		const d = (B[1] - A[1]) * (C[2] - A[2]) - (C[1] - A[1]) * (B[2] - A[2]);
		if (Math.abs(d) < 1e-12) continue;
		const u = ((py - A[1]) * (C[2] - A[2]) - (C[1] - A[1]) * (pz - A[2])) / d, t = ((B[1] - A[1]) * (pz - A[2]) - (py - A[1]) * (B[2] - A[2])) / d;
		if (u < 0 || t < 0 || u + t > 1) continue;
		const x = A[0] + u * (B[0] - A[0]) + t * (C[0] - A[0]);
		if ((x - px) * dir > 0.0005 && x * dir < 0) hits++;
	}
	return hits > 0;
};
for (const side of ['l', 'r'])
	for (const [i, d] of target(`ears/${side}-ear-scale-incr.target`))
		if (Math.hypot(...d) > 0.005 && at.has(i) && region[at.get(i)] === 0 && P0[at.get(i)][2] < 0.03 && behind(at.get(i))) region[at.get(i)] = 4;

/** Int16 values in steps of q, as base64 @param {ArrayLike<number>} a @param {number} q @param {number} [o] */
const i16 = (a, q, o = 0) => Buffer.from(new Int16Array(Array.from(a, (x) => Math.round((x - o) / q))).buffer).toString('base64');
const u16 = (/** @type {number[]} */ a) => Buffer.from(new Uint16Array(a).buffer).toString('base64');
const Q = 1e-5, MID = [0, 1.65, 0];
const flat = (/** @type {number[][]} */ P) => P.flatMap((p) => p.map((x, k) => x - MID[k]));
const quadsOf = Object.fromEntries(Object.entries(parts).map(([k, fs_]) => [k, u16(fs_.flatMap((f) => f.map((i) => at.get(i))).concat(k === 'skin' ? neck.flat() : []))]));

const out = `/*
 * The stand-in's head and neck, from MakeHuman's base mesh and targets (CC0 1.0, makehumancommunity.org): written by
 * scripts/make-head.mjs, not by hand. A young man (m) and a young woman (f), each the average of MakeHuman's three
 * races; in the stand-in's measure (a person of 1.80 m, metres, facing +z), as quads to be smoothed (./subdivide.js).
 * Positions are Int16 steps of ${Q} m from [${MID}]; quads Uint16 indices into them; base64.
 */
/** how many vertices; the quads of each part (the skin includes the neck drawn down into the shirt) */
export const HEAD_MESH = ${JSON.stringify({ n: P0.length, quads: quadsOf }, null, '\t')};
/** each person's vertices, and their eyes (middle, radius) and the top of their head */
export const HEAD_PEOPLE = ${JSON.stringify(Object.fromEntries(Object.entries(fitted).map(([k, f]) => [k, { pos: i16(flat(f.pos), Q), eyes: f.eyes, crown: +f.crown.toFixed(4) }])), null, '\t')};
/** MakeHuman's expression units: the vertices each moves (Uint16) and how far (m, Int16 steps of ${Q}) */
export const HEAD_UNITS = ${JSON.stringify(Object.fromEntries(Object.entries(units).map(([k, u]) => [k, { ids: u16(u.ids), d: i16(u.d, Q) }])), null, '\t')};
/** what each vertex of the skin is: 0 the face and scalp, 1 the mouth's inside, 2 an eye's socket, 3 the neck, 4 an ear (bytes) */
export const HEAD_REGION = '${Buffer.from(region).toString('base64')}';
export const HEAD_Q = ${Q}, HEAD_MID = ${JSON.stringify(MID)};
`;
fs.writeFileSync(OUT, out);
console.log('written', OUT.pathname, `${(out.length / 1024).toFixed(0)} kB`, 'vertices', P0.length, 'skin quads', parts.skin.length + neck.length, 'regions', [0, 1, 2, 3, 4].map((r) => region.filter((x) => x === r).length).join('/'), 'crowns', fitted.m.crown.toFixed(3), fitted.f.crown.toFixed(3), 'eyes', JSON.stringify(fitted.m.eyes));
