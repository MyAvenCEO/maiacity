/**
 * SANDBOX 6 · ONE HEX · THE GEODESIC — a dome's real panels, struts and hubs.
 *
 * A Class I geodesic sphere: the icosahedron stood on a vertex (the crown hub, as a geodesic dome's is), each of its
 * 20 faces cut into f × f small triangles (f, the frequency, is how many struts run along an icosahedron edge) and
 * every point pushed out onto the sphere. A cap a third as high as it is wide keeps the triangles that reach above
 * the ground; their corners below it are brought down onto the foot ring, so the bottom row is trimmed panels.
 *
 * Every panel is one of three: hemp (a white, solid, insulated triangle) when it lies on the cold north side of the
 * cut, otherwise glass or solar glass, the two alternating like a chessboard so each glass panel's neighbours are
 * solar and the other way round. A geodesic has hubs where five struts meet (the icosahedron's twelve corners), and
 * around those no chessboard closes perfectly: there two panels of a kind meet, and the split is not exactly 50/50.
 *
 * Plain maths, no three.js: specs.js counts the panels and scene.js draws them.
 */

const DEG = Math.PI / 180;

/** the icosahedron stood on a vertex: its 12 corners on the unit sphere (north is −z, east +x) and its 20 faces */
function icosahedron() {
	const lat = Math.atan(0.5);
	/** @type {number[][]} */
	const v = [[0, 1, 0]];
	for (let i = 0; i < 5; i++) {
		const a = i * 72 * DEG;
		v.push([Math.cos(lat) * Math.sin(a), Math.sin(lat), -Math.cos(lat) * Math.cos(a)]);
	}
	for (let i = 0; i < 5; i++) {
		const a = (i * 72 + 36) * DEG;
		v.push([Math.cos(lat) * Math.sin(a), -Math.sin(lat), -Math.cos(lat) * Math.cos(a)]);
	}
	v.push([0, -1, 0]);
	/** @type {number[][]} */
	const f = [];
	for (let i = 0; i < 5; i++) {
		const n = (i + 1) % 5;
		f.push([0, 1 + i, 1 + n], [1 + i, 6 + i, 1 + n], [1 + n, 6 + i, 6 + n], [6 + i, 11, 6 + n]);
	}
	return { v, f };
}

/**
 * @typedef {{ v: [number, number, number], kind: 'hemp' | 'glass' | 'solar', area: number, tilt: number }} Panel
 * @typedef {{ R: number, h: number, a: number, freq: number, panels: (Panel & { p: number[] })[],
 *   struts: number, hubs: number, ringHubs: number, lengths: { m: number, n: number }[], trimmed: number,
 *   count: { hemp: number, glass: number, solar: number }, m2: { hemp: number, glass: number, solar: number } }} Geodesic
 */

/**
 * A geodesic cap: sphere radius R, height h over the ground, frequency f, the hemp's cut standing k north of the
 * middle at the ground and leaning north at `tilt` degrees (see specs.js northArc).
 * @param {{ R: number, h: number, freq: number, k: number, tilt: number }} o
 * @returns {Geodesic}
 */
export function geodesicCap({ R, h, freq, k, tilt }) {
	const ico = icosahedron();
	const drop = R - h;
	const a = Math.sqrt(R * R - drop * drop);
	/** @type {number[][]} */
	const points = [];
	/** @type {Map<string, number>} */
	const seen = new Map();
	const at = (/** @type {number[]} */ q) => {
		const l = Math.hypot(q[0], q[1], q[2]);
		const p = [(q[0] / l) * R, (q[1] / l) * R - drop, (q[2] / l) * R];
		const key = p.map((x) => Math.round(x * 1e4)).join(',');
		let i = seen.get(key);
		if (i === undefined) {
			i = points.length;
			points.push(p);
			seen.set(key, i);
		}
		return i;
	};
	// every small triangle of every face; `up` ones point the same way as their face, `down` ones the other
	/** @type {{ v: number[], up: boolean }[]} */
	const tris = [];
	for (const [A, B, C] of ico.f) {
		const [pa, pb, pc] = [ico.v[A], ico.v[B], ico.v[C]];
		const P = (/** @type {number} */ i, /** @type {number} */ j) => at([0, 1, 2].map((d) => pa[d] + ((pb[d] - pa[d]) * i) / freq + ((pc[d] - pa[d]) * j) / freq));
		for (let i = 0; i < freq; i++)
			for (let j = 0; i + j < freq; j++) {
				tris.push({ v: [P(i, j), P(i + 1, j), P(i, j + 1)], up: true });
				if (i + j < freq - 1) tris.push({ v: [P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], up: false });
			}
	}
	// the cap: every triangle that reaches above the ground, its corners below brought down onto the foot ring
	const kept = tris.filter((t) => t.v.some((i) => points[i][1] > 0.01));
	/** @type {Map<number, number[]>} */
	const foot = new Map();
	const pos = (/** @type {number} */ i) => {
		const p = points[i];
		if (p[1] > 0.01) return p;
		let q = foot.get(i);
		if (!q) {
			const r = Math.hypot(p[0], p[2]) || 1;
			foot.set(i, (q = [(p[0] / r) * a, 0, (p[2] / r) * a]));
		}
		return q;
	};

	// glass and solar alternate: walk the panels from the crown outwards, each taking the kind most of its
	// already-placed neighbours are not
	/** @type {Map<string, number[]>} */
	const byEdge = new Map();
	const ek = (/** @type {number} */ x, /** @type {number} */ y) => (x < y ? `${x}-${y}` : `${y}-${x}`);
	kept.forEach((t, n) => {
		for (let e = 0; e < 3; e++) {
			const key = ek(t.v[e], t.v[(e + 1) % 3]);
			const l = byEdge.get(key);
			if (l) l.push(n);
			else byEdge.set(key, [n]);
		}
	});
	const centre = kept.map((t) => {
		const ps = t.v.map(pos);
		return [0, 1, 2].map((d) => (ps[0][d] + ps[1][d] + ps[2][d]) / 3);
	});
	const isHemp = kept.map((_, n) => {
		const [x, y, z] = centre[n];
		const r = Math.hypot(x, z);
		const q = (k + y * Math.tan(tilt * DEG)) / Math.max(r, 1e-6);
		const arc = q >= 1 ? 0 : q <= -1 ? Math.PI : Math.acos(q);
		return Math.abs(Math.atan2(x, -z)) <= arc;
	});
	/** @type {(boolean | null)[]} */
	const solar = kept.map(() => null);
	const order = kept.map((_, n) => n).sort((p, q) => centre[q][1] - centre[p][1]);
	const queue = [order[0]];
	solar[order[0]] = true;
	for (let qi = 0; qi < queue.length || queue.length < kept.length; qi++) {
		if (qi >= queue.length) {
			const next = order.find((n) => solar[n] === null);
			if (next === undefined) break;
			solar[next] = true;
			queue.push(next);
		}
		const n = queue[qi];
		for (let e = 0; e < 3; e++)
			for (const m of byEdge.get(ek(kept[n].v[e], kept[n].v[(e + 1) % 3])) ?? []) {
				if (solar[m] !== null) continue;
				let yes = 0, no = 0;
				for (let f = 0; f < 3; f++)
					for (const o of byEdge.get(ek(kept[m].v[f], kept[m].v[(f + 1) % 3])) ?? []) {
						if (o === m || solar[o] === null) continue;
						if (solar[o]) yes++;
						else no++;
					}
				solar[m] = yes < no || (yes === no && !kept[m].up);
				queue.push(m);
			}
	}

	const count = { hemp: 0, glass: 0, solar: 0 }, m2 = { hemp: 0, glass: 0, solar: 0 };
	const panels = kept.map((t, n) => {
		const [p, q, r] = t.v.map(pos);
		const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
		const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
		const area = Math.hypot(c[0], c[1], c[2]) / 2;
		const tilt = area > 0 ? Math.acos(Math.min(1, Math.abs(c[1]) / (2 * area))) / DEG : 90;
		/** @type {'hemp' | 'glass' | 'solar'} */
		const kind = isHemp[n] ? 'hemp' : solar[n] ? 'solar' : 'glass';
		count[kind]++;
		m2[kind] += area;
		return { v: /** @type {[number, number, number]} */ (t.v), p: [...p, ...q, ...r], kind, area, tilt };
	});

	// the struts: every edge but the foot ring's; their lengths, the pure geodesic ones sorted into kinds
	let struts = 0, trimmed = 0;
	/** @type {Map<number, number>} */
	const kinds = new Map();
	for (const key of byEdge.keys()) {
		const [x, y] = key.split('-').map(Number);
		const lowX = points[x][1] <= 0.01, lowY = points[y][1] <= 0.01;
		if (lowX && lowY) continue;
		struts++;
		if (lowX || lowY) {
			trimmed++;
			continue;
		}
		const L = Math.round(Math.hypot(points[x][0] - points[y][0], points[x][1] - points[y][1], points[x][2] - points[y][2]) * 100) / 100;
		kinds.set(L, (kinds.get(L) ?? 0) + 1);
	}
	const used = new Set(kept.flatMap((t) => t.v));
	const ringHubs = [...used].filter((i) => points[i][1] <= 0.01).length;
	return {
		R, h, a, freq,
		panels,
		struts,
		hubs: used.size,
		ringHubs,
		lengths: [...kinds.entries()].sort((p, q) => p[0] - q[0]).map(([m, n]) => ({ m, n })),
		trimmed,
		count,
		m2
	};
}

/** how many neighbouring panels share a kind (glass beside glass, solar beside solar): the chessboard's flaws */
export function sameNeighbours(/** @type {Geodesic} */ g) {
	/** @type {Map<string, string[]>} */
	const byEdge = new Map();
	for (const p of g.panels)
		for (let e = 0; e < 3; e++) {
			const x = p.v[e], y = p.v[(e + 1) % 3];
			const key = x < y ? `${x}-${y}` : `${y}-${x}`;
			const l = byEdge.get(key);
			if (l) l.push(p.kind);
			else byEdge.set(key, [p.kind]);
		}
	let same = 0, pairs = 0;
	for (const l of byEdge.values())
		if (l.length === 2 && l[0] !== 'hemp' && l[1] !== 'hemp') {
			pairs++;
			if (l[0] === l[1]) same++;
		}
	return { same, pairs };
}

/**
 * A tower's shell as panels: the profile's rows ([radius, height], foot to top), each ring cut into `bays` hubs set
 * half a bay round from the ring below, so the struts run as a diagrid and every bay between two rings is two
 * triangles, one standing on its base and one hanging from it. That lattice has no five-way hubs, so glass and solar
 * alternate perfectly: the standing triangles are solar, the hanging ones glass. The hemp's cut is the domes'.
 * @param {{ rows: number[][], bays: number, k: number, tilt: number }} o
 */
export function towerGrid({ rows, bays, k, tilt }) {
	const pt = (/** @type {number} */ i, /** @type {number} */ b) => {
		const [r, y] = rows[i];
		const t = ((b + (i % 2) / 2) / bays) * 2 * Math.PI;
		return [r * Math.sin(t), y, -r * Math.cos(t)];
	};
	const count = { hemp: 0, glass: 0, solar: 0 }, m2 = { hemp: 0, glass: 0, solar: 0 };
	/** @type {{ p: number[], kind: 'hemp' | 'glass' | 'solar', area: number, tilt: number }[]} */
	const panels = [];
	const add = (/** @type {number[][]} */ [p, q, r], /** @type {boolean} */ standing) => {
		const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
		const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
		const area = Math.hypot(c[0], c[1], c[2]) / 2;
		const x = (p[0] + q[0] + r[0]) / 3, y = (p[1] + q[1] + r[1]) / 3, z = (p[2] + q[2] + r[2]) / 3;
		const qq = (k + y * Math.tan(tilt * DEG)) / Math.max(Math.hypot(x, z), 1e-6);
		const arc = qq >= 1 ? 0 : qq <= -1 ? Math.PI : Math.acos(qq);
		/** @type {'hemp' | 'glass' | 'solar'} */
		const kind = Math.abs(Math.atan2(x, -z)) <= arc ? 'hemp' : standing ? 'solar' : 'glass';
		count[kind]++;
		m2[kind] += area;
		panels.push({ p: [...p, ...q, ...r], kind, area, tilt: area > 0 ? Math.acos(Math.min(1, Math.abs(c[1]) / (2 * area))) / DEG : 90 });
	};
	for (let i = 0; i < rows.length - 1; i++)
		for (let b = 0; b < bays; b++) {
			const n = (b + 1) % bays;
			// the ring above sits half a bay on: on even rings its hub b lies between hubs b and b+1 below, on odd ones b+1
			const above = i % 2 === 0 ? b : n, below = i % 2 === 0 ? n : b;
			add([pt(i, b), pt(i, n), pt(i + 1, above)], true);
			add(i % 2 === 0 ? [pt(i + 1, b), pt(i + 1, n), pt(i, n)] : [pt(i + 1, b), pt(i + 1, n), pt(i, below)], false);
		}
	// struts: every ring's bays and the two diagonals of each bay; hubs: every ring's
	const struts = rows.length * bays + (rows.length - 1) * bays * 2 - bays;
	return { panels, count, m2, struts, hubs: rows.length * bays };
}
