/*
 * CATMULL–CLARK — one step of smoothing a quad mesh: every quad becomes four, every vertex moves towards the average of
 * its neighbours, open edges (an eye's rim, a neck's cut) kept as curves. The step is linear in the vertices, so it is
 * kept as a stencil (each new vertex a weighted sum of old ones) and laid over anything carried per vertex: positions,
 * a morph's offsets, a colour's weight.
 */

/**
 * One step over `quads` (4 indices a face) on `n` vertices.
 * @param {ArrayLike<number>} quads @param {number} n
 * @returns {{ quads: Uint32Array, n: number, stencil: { at: Uint32Array, idx: Uint32Array, w: Float32Array } }}
 */
export function catmullClark(quads, n) {
	const F = quads.length / 4;
	/** @type {Map<number, number>} edge key → edge id */
	const edgeId = new Map();
	/** @type {number[]} per edge: its two ends, its first face, its second face (or -1) */
	const edges = [];
	const key = (/** @type {number} */ a, /** @type {number} */ b) => (a < b ? a * n + b : b * n + a);
	const faceEdges = new Uint32Array(F * 4);
	for (let f = 0; f < F; f++)
		for (let k = 0; k < 4; k++) {
			const a = quads[f * 4 + k], b = quads[f * 4 + ((k + 1) & 3)], kk = key(a, b);
			let e = edgeId.get(kk);
			if (e === undefined) {
				e = edges.length / 4;
				edgeId.set(kk, e);
				edges.push(a, b, f, -1);
			} else edges[e * 4 + 3] = f;
			faceEdges[f * 4 + k] = e;
		}
	const E = edges.length / 4;
	// per vertex: its faces and its edges
	const vFaces = Array.from({ length: n }, () => /** @type {number[]} */ ([]));
	const vEdges = Array.from({ length: n }, () => /** @type {number[]} */ ([]));
	for (let f = 0; f < F; f++) for (let k = 0; k < 4; k++) vFaces[quads[f * 4 + k]].push(f);
	for (let e = 0; e < E; e++) (vEdges[edges[e * 4]].push(e), vEdges[edges[e * 4 + 1]].push(e));

	// the stencil: rows of (old index, weight); new vertices are the old ones moved, then a point per face, per edge
	const rows = /** @type {Map<number, number>[]} */ ([]);
	const add = (/** @type {Map<number, number>} */ r, /** @type {number} */ i, /** @type {number} */ w) => r.set(i, (r.get(i) ?? 0) + w);
	const facePoint = (/** @type {number} */ f) => {
		const r = new Map();
		for (let k = 0; k < 4; k++) add(r, quads[f * 4 + k], 0.25);
		return r;
	};
	const facePts = Array.from({ length: F }, (_, f) => facePoint(f));
	const edgePts = Array.from({ length: E }, (_, e) => {
		const r = new Map(), a = edges[e * 4], b = edges[e * 4 + 1], f1 = edges[e * 4 + 2], f2 = edges[e * 4 + 3];
		if (f2 < 0) (add(r, a, 0.5), add(r, b, 0.5));
		else {
			add(r, a, 0.25);
			add(r, b, 0.25);
			for (const [i, w] of facePts[f1]) add(r, i, w * 0.25);
			for (const [i, w] of facePts[f2]) add(r, i, w * 0.25);
		}
		return r;
	});
	for (let v = 0; v < n; v++) {
		const r = new Map();
		const open = vEdges[v].filter((e) => edges[e * 4 + 3] < 0);
		if (open.length >= 2) {
			// on an open edge: the curve through it and its two open neighbours
			add(r, v, 0.75);
			for (const e of open.slice(0, 2)) add(r, edges[e * 4] === v ? edges[e * 4 + 1] : edges[e * 4], 0.125);
		} else if (vEdges[v].length === 0) add(r, v, 1);
		else {
			const k = vFaces[v].length;
			// (F + 2R + (k − 3)P) / k: F the faces' points' average, R the edges' middles' average
			for (const f of vFaces[v]) for (const [i, w] of facePts[f]) add(r, i, w / (k * k));
			for (const e of vEdges[v]) (add(r, edges[e * 4], 1 / (k * k)), add(r, edges[e * 4 + 1], 1 / (k * k)));
			add(r, v, (k - 3) / k);
		}
		rows.push(r);
	}
	rows.push(...facePts, ...edgePts);

	const N = n + F + E;
	const out = new Uint32Array(F * 16);
	for (let f = 0; f < F; f++) {
		const fp = n + f;
		for (let k = 0; k < 4; k++) {
			const v = quads[f * 4 + k], eNext = n + F + faceEdges[f * 4 + k], ePrev = n + F + faceEdges[f * 4 + ((k + 3) & 3)];
			out.set([v, eNext, fp, ePrev], f * 16 + k * 4);
		}
	}
	let total = 0;
	for (const r of rows) total += r.size;
	const at = new Uint32Array(N + 1), idx = new Uint32Array(total), w = new Float32Array(total);
	let p = 0;
	rows.forEach((r, i) => {
		at[i] = p;
		for (const [j, x] of r) (idx[p] = j, (w[p] = x), p++);
	});
	at[N] = p;
	return { quads: out, n: N, stencil: { at, idx, w } };
}

/**
 * Lay a stencil over values carried per vertex, `dim` a vertex.
 * @param {{ at: Uint32Array, idx: Uint32Array, w: Float32Array }} s @param {ArrayLike<number>} values @param {number} dim
 */
export function applyStencil(s, values, dim) {
	const N = s.at.length - 1, out = new Float32Array(N * dim);
	for (let i = 0; i < N; i++)
		for (let p = s.at[i]; p < s.at[i + 1]; p++) {
			const j = s.idx[p], x = s.w[p];
			for (let d = 0; d < dim; d++) out[i * dim + d] += values[j * dim + d] * x;
		}
	return out;
}

/** Quads as triangles (two a quad). @param {ArrayLike<number>} quads */
export function triangles(quads) {
	const F = quads.length / 4, out = new Uint32Array(F * 6);
	for (let f = 0; f < F; f++) out.set([quads[f * 4], quads[f * 4 + 1], quads[f * 4 + 2], quads[f * 4], quads[f * 4 + 2], quads[f * 4 + 3]], f * 6);
	return out;
}
