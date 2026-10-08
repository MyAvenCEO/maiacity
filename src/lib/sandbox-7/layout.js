/**
 * SANDBOX 6 · ONE VILLAGE · THE PLAN — where everything stands in the village's seven hexes, and what every square
 * metre of their land is used for.
 *
 * A hex is the settlers game's hex at its real size: 665.6 m across its flats (13 steps of 1.6 units, 32 m a unit),
 * 768.6 m corner to corner, 38.4 ha. Pointy at north and south, as Samuel drew it. x runs east, z south (north is
 * −z), in metres. The village (Samuel, 2026-10-08) is the tower hex in the middle and six living hexes round it, all
 * alike; each plan is laid out round its own middle and `VILLAGE` says where each hex stands.
 *
 *   living hex, layout A (Samuel's first sketch): three Dome120s in a triangle in the middle, the utilities dome at the
 *     top and the two tropical food domes below it, a ring road round them; five Dome80 homes in an arc along the
 *     south of the ring, their doors on it; eight Dome40 homes round the edge of the hex.
 *   living hex, layout B (his sketch for the light): the Dome120s and Dome80s round a green in the north half, the
 *     tall ones north; nine Dome40s over the south half. A and B take turns round the tower hex.
 *   tower hex (his second sketch): Tower180 in the middle, a ring road round it, eight Dome120 factories round that;
 *     outside, the fields, woods and pits that feed them.
 *
 * The land is painted on a raster of 2 m cells (`landOf`): domes, roads, then what the outdoor land is used for. The
 * areas the page shows come from counting the cells outdoors and from each dome's floor plan (./specs.js) indoors,
 * so the map and the numbers always agree.
 */
import { capOf, FACTORIES, KINDS, POND_BAND, POND_HALF, POND_IN, TOWER } from './specs.js';

/** the hex: across its flats, its side (centre to corner) and its area */
export const HEX_W = 13 * 1.6 * 32;
export const HEX_S = HEX_W / Math.sqrt(3);
export const HEX_AREA = (Math.sqrt(3) / 2) * HEX_W * HEX_W;

/** how far a point (relative to a hex's middle) is inside its edge, m (negative outside) */
export function edgeDistance(/** @type {number} */ x, /** @type {number} */ z) {
	const ax = Math.abs(x), az = Math.abs(z);
	return Math.min(HEX_W / 2 - ax, (HEX_S - ax / Math.sqrt(3) - az) * (Math.sqrt(3) / 2));
}
/** the six corners of a hex round (cx, cz), north first @returns {[number, number][]} */
export const corners = (cx = 0, cz = 0) =>
	Array.from({ length: 6 }, (_, k) => {
		const a = (k * Math.PI) / 3;
		return /** @type {[number, number]} */ ([cx + HEX_S * Math.sin(a), cz - HEX_S * Math.cos(a)]);
	});
/** a point at a compass bearing (degrees, 0 north, 90 east) and distance from (cx, cz) */
export const bearing = (/** @type {number} */ deg, /** @type {number} */ r, cx = 0, cz = 0) => {
	const a = (deg * Math.PI) / 180;
	return { x: cx + r * Math.sin(a), z: cz - r * Math.cos(a) };
};

/**
 * @typedef {{ id: string, kind: string, x: number, z: number, name: string, factory?: string, door: number }} Site
 *   door: the bearing its door faces (toward its road)
 * @typedef {{ pts: [number, number][], w: number, kind: 'road' | 'path', ring?: boolean }} Way
 * @typedef {{ id: 'living' | 'tower', layout?: 'A' | 'B', label: string, cx: number, cz: number, sites: Site[], ways: Way[], ring: { x: number, z: number, r: number, w: number }, tower?: import('./specs.js').Tower }} HexPlan
 */

/** a circle as a polyline @returns {[number, number][]} */
const circle = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ r, n = 96) => Array.from({ length: n + 1 }, (_, k) => /** @type {[number, number]} */ ([x + r * Math.cos((k / n) * Math.PI * 2), z + r * Math.sin((k / n) * Math.PI * 2)]));
/** the middle of a hex's edge at a bearing (30, 90, …) */
const edgeMid = (/** @type {number} */ deg, cx = 0, cz = 0) => bearing(deg, HEX_W / 2, cx, cz);
/** the bearing from one point to another */
const towards = (/** @type {{ x: number, z: number }} */ a, /** @type {{ x: number, z: number }} */ b) => ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;

/** Layout A, Samuel's first sketch: the Dome120s in the middle, the Dome80s south of them, the Dome40s round the edge
 * @returns {HexPlan} */
function livingA() {
	const O = { x: 0, z: -20 };
	const RING = 150;
	/** @type {Site[]} */
	const sites = [];
	// the three Dome120s in a triangle round the ring's middle, 12 m apart: the utilities to the north, food below
	const tri = (120 + 12) / Math.sqrt(3);
	sites.push({ id: 'util', kind: 'util120', ...bearing(0, tri, O.x, O.z), name: 'Utilities', door: 0 });
	sites.push({ id: 'foodW', kind: 'food120', ...bearing(240, tri, O.x, O.z), name: 'Food forest west', door: 240 });
	sites.push({ id: 'foodE', kind: 'food120', ...bearing(120, tri, O.x, O.z), name: 'Food forest east', door: 120 });
	// five Dome80 homes in an arc along the south of the ring, 10 m off the road, doors on it
	const big = KINDS.dome80, small = KINDS.dome40;
	[120, 150, 180, 210, 240].forEach((b, k) => sites.push({ id: `h80-${k}`, kind: 'dome80', ...bearing(b, RING + 4 + 6 + capOf(80).a, O.x, O.z), name: `Home of ${big.people} · ${k + 1}`, door: (b + 180) % 360 }));
	// eight Dome40 homes round the edge, in pairs as the sketch has them
	/** @type {[number, number][]} */
	const smalls = [[-42, -272], [42, -272], [-215, -188], [215, -188], [-292, -78], [292, -78], [-298, 52], [298, 52]];
	smalls.forEach(([x, z], k) => sites.push({ id: `h40-${k}`, kind: 'dome40', x, z, name: `Home of ${small.people} · ${k + 1}`, door: towards({ x, z }, O) }));
	/** @type {Way[]} */
	const ways = [{ pts: circle(O.x, O.z, RING), w: 8, kind: 'road', ring: true }];
	// roads out to the six neighbours, middle to middle (as in the settlers game), leaving the ring between the domes
	for (const [b, via] of /** @type {[number, number][]} */ ([[30, 30], [90, 90], [270, 270], [330, 330], [150, 135], [210, 225]])) {
		const a = bearing(via, RING, O.x, O.z), m = edgeMid(b);
		const pts = /** @type {[number, number][]} */ ([[a.x, a.z]]);
		if (via !== b) {
			const v = bearing(via, RING + 120, O.x, O.z);
			pts.push([v.x, v.z]);
		}
		pts.push([m.x, m.z]);
		ways.push({ pts, w: 6, kind: 'road' });
	}
	// a footpath from the ring to each Dome40's door
	for (const s of sites.filter((s) => s.kind === 'dome40')) {
		const b = towards(O, s);
		const a = bearing(b, RING, O.x, O.z), d = bearing(s.door, capOf(40).a, s.x, s.z);
		ways.push({ pts: [[a.x, a.z], [d.x, d.z]], w: 3, kind: 'path' });
	}
	return { id: 'living', layout: 'A', label: 'Living hex, layout A', cx: 0, cz: 0, sites, ways, ring: { ...O, r: RING, w: 8 } };
}

/**
 * Layout B, Samuel's sketch of 2026-10-08 (every second living hex, for the light): the tall domes to the north and the
 * low ones to the south, so nothing stands in the homes' winter sun. A round green with its ring road in the north half;
 * round it the three Dome120s on its north side (utilities at the top) and three Dome80s on its south, two more Dome80s
 * out to the west and east; nine Dome40s spread over the sunny south half. The roads leave the green between the domes.
 * @returns {HexPlan}
 */
function livingB() {
	const O = { x: 0, z: -120 };
	const RING = 64;
	const d120 = 132, d80 = 112;
	/** @type {Site[]} */
	const sites = [];
	sites.push({ id: 'util', kind: 'util120', ...bearing(0, d120, O.x, O.z), name: 'Utilities', door: 180 });
	sites.push({ id: 'foodW', kind: 'food120', ...bearing(300, d120, O.x, O.z), name: 'Food forest west', door: 120 });
	sites.push({ id: 'foodE', kind: 'food120', ...bearing(60, d120, O.x, O.z), name: 'Food forest east', door: 240 });
	const big = KINDS.dome80, small = KINDS.dome40;
	/** @type {{ x: number, z: number }[]} */
	const bigs = [bearing(240, d80, O.x, O.z), bearing(180, d80, O.x, O.z), bearing(120, d80, O.x, O.z), { x: -205, z: -60 }, { x: 205, z: -60 }];
	bigs.forEach((p, k) => sites.push({ id: `h80-${k}`, kind: 'dome80', ...p, name: `Home of ${big.people} · ${k + 1}`, door: towards(p, O) }));
	/** @type {[number, number][]} */
	const smalls = [[-268, 47], [-150, 80], [135, 62], [236, 66], [-30, 128], [-175, 175], [86, 176], [190, 150], [24, 252]];
	smalls.forEach(([x, z], k) => sites.push({ id: `h40-${k}`, kind: 'dome40', x, z, name: `Home of ${small.people} · ${k + 1}`, door: 180 }));
	/** @type {Way[]} */
	const ways = [{ pts: circle(O.x, O.z, RING), w: 8, kind: 'road', ring: true }];
	// roads out to the six neighbours, leaving the green between the domes, then on to the middle of each edge
	/** @type {Record<number, number>} how far out from the green each road runs before it turns for the edge */
	const OUT = { 30: 150, 90: 260, 150: 120, 210: 120, 270: 260, 330: 150 };
	for (const b of [30, 90, 150, 210, 270, 330]) {
		const a = bearing(b, RING, O.x, O.z), v = bearing(b, OUT[b], O.x, O.z), m = edgeMid(b);
		ways.push({ pts: [[a.x, a.z], [v.x, v.z], [m.x, m.z]], w: 6, kind: 'road' });
	}
	// a footpath from each Dome40's door to the nearest road
	const roads = ways.filter((w) => !w.ring);
	for (const s of sites.filter((s) => s.kind === 'dome40')) {
		let best = { d: Infinity, x: 0, z: 0 };
		for (const w of roads)
			for (let k = 1; k < w.pts.length; k++) {
				const [ax, az] = w.pts[k - 1], [bx, bz] = w.pts[k];
				const dx = bx - ax, dz = bz - az;
				const t = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / (dx * dx + dz * dz)));
				const x = ax + t * dx, z = az + t * dz, d = Math.hypot(s.x - x, s.z - z);
				if (d < best.d) best = { d, x, z };
			}
		s.door = towards(s, best);
		const d = bearing(s.door, capOf(40).a, s.x, s.z);
		ways.push({ pts: [[best.x, best.z], [d.x, d.z]], w: 3, kind: 'path' });
	}
	return { id: 'living', layout: 'B', label: 'Living hex, layout B', cx: 0, cz: 0, sites, ways, ring: { ...O, r: RING, w: 8 } };
}

/** the tower hex round the tower: its ring road 12 m off the glass, the factories 12 m outside it
 * @param {import('./specs.js').Tower} T @returns {HexPlan} */
function towerHex(T) {
	const cx = 0, cz = 0;
	const RING = T.D / 2 + 12;
	/** @type {Site[]} */
	const sites = [{ id: 'tower', kind: 'tower', x: cx, z: cz, name: T.label, door: 180 }];
	[...Array(8)].forEach((_, k) => {
		const b = 22.5 + k * 45;
		sites.push({ id: `f-${k}`, kind: 'factory120', ...bearing(b, RING + 4 + 12 + capOf(120).a, cx, cz), name: FACTORIES.find((f) => f.id === FACTORY_ORDER[k])?.label ?? '', factory: FACTORY_ORDER[k], door: (b + 180) % 360 });
	});
	/** @type {Way[]} */
	const ways = [{ pts: circle(cx, cz, RING), w: 8, kind: 'road', ring: true }];
	for (const [b, via] of /** @type {[number, number][]} */ ([[30, 45], [90, 90], [150, 135], [210, 225], [270, 270], [330, 315]])) {
		const a = bearing(via, RING, cx, cz), m = edgeMid(b, cx, cz);
		const pts = /** @type {[number, number][]} */ ([[a.x, a.z]]);
		if (via !== b) {
			const v = bearing(via, RING + 16 + 2 * capOf(120).a + 10, cx, cz);
			pts.push([v.x, v.z]);
		}
		pts.push([m.x, m.z]);
		ways.push({ pts, w: 8, kind: 'road' });
	}
	return { id: 'tower', label: 'Tower hex', cx, cz, sites, ways, ring: { x: cx, z: cz, r: RING, w: 8 }, tower: T };
}

/** the factories, round the tower clockwise from the north-north-east; the works nearest its fields */
const FACTORY_ORDER = ['timber', 'bamboo', 'hemp', 'recycling', 'glass', 'clay', 'lime', 'steel'];

export const LIVING_A = livingA();
export const LIVING_B = livingB();
/** the living layouts, by letter */
export const LIVINGS = { A: LIVING_A, B: LIVING_B };
export const TOWER_HEX = towerHex(TOWER);

/**
 * The village: the tower hex in the middle, the six living hexes round it at their neighbours' places (centre to
 * centre one hex across the flats), named by the way they lie from the tower; layouts A and B take turns (Samuel,
 * 2026-10-08), so the two can be compared side by side.
 * @type {{ key: string, label: string, plan: HexPlan, x: number, z: number }[]}
 */
export const VILLAGE = [
	{ key: 'tower', label: 'Tower hex', plan: TOWER_HEX, x: 0, z: 0 },
	...[['ne', 30, 'North-east'], ['e', 90, 'East'], ['se', 150, 'South-east'], ['sw', 210, 'South-west'], ['w', 270, 'West'], ['nw', 330, 'North-west']].map(([key, b, name], k) => {
		const plan = k % 2 ? LIVING_B : LIVING_A;
		return { key: `living-${key}`, label: `${name} hex · ${plan.layout}`, plan, ...bearing(/** @type {number} */ (b), HEX_W) };
	})
];

/** a dome's or the tower's radius on the ground @param {Site} s @param {HexPlan} [plan] */
export const footR = (s, plan) => (s.kind === 'tower' ? (plan?.tower?.D ?? TOWER.D) / 2 : capOf(KINDS[s.kind].D).a);

// ── the land, cell by cell ──────────────────────────────────────────────────────────────────────────────────────

/**
 * What the land is used for. `inside` uses are under glass (their areas come from the floor plans); the others are
 * outdoors. Colours: `map` for the land-use overlay, `ground` for the land as it looks.
 * @type {Record<string, { label: string, inside?: boolean, map: string, ground: string, group: string }>}
 */
export const USES = {
	living: { label: 'Homes', inside: true, map: '#e2a33b', ground: '#d8c8a8', group: 'Living' },
	indoorFood: { label: 'Food gardens under glass', inside: true, map: '#6fbf3f', ground: '#6e9a4a', group: 'Food under glass' },
	tropical: { label: 'Tropical food forest under glass', inside: true, map: '#1f9a5a', ground: '#3f7d3a', group: 'Food under glass' },
	pond: { label: 'Fish ponds under glass', inside: true, map: '#3b8fd0', ground: '#4f8fa8', group: 'Water' },
	commons: { label: 'Paths and commons under glass', inside: true, map: '#c9b9a0', ground: '#c9bca2', group: 'Ways' },
	utilities: { label: 'Utilities and workshops', inside: true, map: '#8a6fc0', ground: '#b9b3a8', group: 'Work' },
	factory: { label: 'Factories under glass', inside: true, map: '#b0563a', ground: '#b3aa9c', group: 'Work' },
	tower: { label: 'The tower (its floor)', inside: true, map: '#5a4fa0', ground: '#bdb6aa', group: 'Work' },
	foodForest: { label: 'Food forest outdoors', map: '#9fd36a', ground: '#6f9446', group: 'Food outdoors' },
	hemp: { label: 'Hemp fields', map: '#c8d860', ground: '#7d9a3e', group: 'Raw materials' },
	bamboo: { label: 'Bamboo groves', map: '#53b88a', ground: '#5e8c3a', group: 'Raw materials' },
	woodland: { label: 'Timber woodland (Douglas fir, larch)', map: '#2f6b3a', ground: '#3d6236', group: 'Raw materials' },
	mine: { label: 'Clay, lime and gravel pits', map: '#a07a5a', ground: '#a68a6a', group: 'Pits' },
	yard: { label: 'Yards and loading', map: '#9a948a', ground: '#a49d90', group: 'Ways' },
	nature: { label: 'Nature: hedges, meadow, wild wood', map: '#7fa86a', ground: '#9bb466', group: 'Nature' },
	road: { label: 'Roads and paths', map: '#4a4a4a', ground: '#b8ab92', group: 'Ways' }
};
export const USE_IDS = Object.keys(USES);
/** a raster cell, m */
export const CELL = 2;

/**
 * The land of a hex, cell by cell: which use each 2 m cell has (an index into USE_IDS, 255 outside the hex), and the
 * areas, ha: outdoors from the cells, indoors from the floor plans.
 * @param {HexPlan} plan
 */
export function landOf(plan) {
	const nx = Math.ceil(HEX_W / CELL), nz = Math.ceil((2 * HEX_S) / CELL);
	const x0 = plan.cx - (nx * CELL) / 2, z0 = plan.cz - (nz * CELL) / 2;
	const cells = new Uint8Array(nx * nz).fill(255);
	const id = Object.fromEntries(USE_IDS.map((u, k) => [u, k]));
	/** @type {{ seg: [number, number, number, number], w: number }[]} */
	const segs = [];
	for (const w of plan.ways) for (let k = 1; !w.ring && k < w.pts.length; k++) segs.push({ seg: [w.pts[k - 1][0], w.pts[k - 1][1], w.pts[k][0], w.pts[k][1]], w: w.w });
	const onWay = (/** @type {number} */ x, /** @type {number} */ z) =>
		Math.abs(Math.hypot(x - plan.ring.x, z - plan.ring.z) - plan.ring.r) <= plan.ring.w / 2 ||
		segs.some(({ seg: [ax, az, bx, bz], w }) => {
			const dx = bx - ax, dz = bz - az;
			const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
			return Math.hypot(x - ax - t * dx, z - az - t * dz) <= w / 2;
		});
	const homes = plan.sites.filter((s) => s.kind === 'dome40' || s.kind === 'dome80');
	for (let j = 0; j < nz; j++)
		for (let i = 0; i < nx; i++) {
			const x = x0 + (i + 0.5) * CELL, z = z0 + (j + 0.5) * CELL;
			const lx = x - plan.cx, lz = z - plan.cz;
			const edge = edgeDistance(lx, lz);
			if (edge < 0) continue;
			let use = '';
			for (const s of plan.sites) {
				const r = Math.hypot(x - s.x, z - s.z);
				if (r <= footR(s, plan)) {
					use = insideUse(s, x - s.x, z - s.z, r);
					break;
				}
			}
			if (!use && onWay(x, z)) use = 'road';
			if (!use) use = plan.id === 'living' ? livingLand(plan, x, z, edge, homes) : towerLand(plan, x, z, edge);
			cells[j * nx + i] = id[use];
		}
	// outdoors from the cells, under glass from the plans
	/** @type {Record<string, number>} */
	const m2 = Object.fromEntries(USE_IDS.map((u) => [u, 0]));
	let hex = 0;
	for (const c of cells)
		if (c !== 255) {
			hex += CELL * CELL;
			if (!USES[USE_IDS[c]].inside) m2[USE_IDS[c]] += CELL * CELL;
		}
	for (const s of plan.sites) for (const z of zonesOf(s, plan)) m2[z.use] += z.m2;
	// the cells under the domes and what the plans add up to differ by a cell's rounding: scale the outdoors to fit
	const inside = USE_IDS.filter((u) => USES[u].inside).reduce((a, u) => a + m2[u], 0);
	const outdoor = USE_IDS.filter((u) => !USES[u].inside).reduce((a, u) => a + m2[u], 0);
	const k = (HEX_AREA - inside) / outdoor;
	for (const u of USE_IDS) if (!USES[u].inside) m2[u] *= k;
	return { nx, nz, x0, z0, cells, m2, hexCells: hex };
}

/**
 * The outdoor land's areas, for the labels on the land-use map: each patch of one use (cells touching side by side),
 * its size, and the point deepest inside it (farthest from any other use), where its label goes. Roads, and patches
 * under `minM2` or thinner than `minDepth` (the hedges along the edge), get none.
 * @param {ReturnType<typeof landOf>} land
 * @returns {{ use: string, m2: number, x: number, z: number }[]}
 */
export function landPatches(land, minM2 = 4000, minDepth = 24) {
	const { nx, nz, x0, z0, cells } = land;
	const n = nx * nz;
	// how far each cell is from a cell of another use, in cells (two passes, city-block)
	const depth = new Float32Array(n);
	for (let j = 0; j < nz; j++)
		for (let i = 0; i < nx; i++) {
			const k = j * nx + i, c = cells[k];
			if (c === 255) continue;
			const up = j > 0 && cells[k - nx] === c ? depth[k - nx] : 0;
			const left = i > 0 && cells[k - 1] === c ? depth[k - 1] : 0;
			depth[k] = Math.min(up, left) + 1;
		}
	for (let j = nz - 1; j >= 0; j--)
		for (let i = nx - 1; i >= 0; i--) {
			const k = j * nx + i, c = cells[k];
			if (c === 255) continue;
			const down = j < nz - 1 && cells[k + nx] === c ? depth[k + nx] : 0;
			const right = i < nx - 1 && cells[k + 1] === c ? depth[k + 1] : 0;
			depth[k] = Math.min(depth[k], down + 1, right + 1);
		}
	// the patches, by flood fill
	const seen = new Uint8Array(n);
	const stack = new Int32Array(n);
	/** @type {{ use: string, m2: number, x: number, z: number }[]} */
	const out = [];
	for (let s = 0; s < n; s++) {
		const c = cells[s];
		if (seen[s] || c === 255) continue;
		const use = USE_IDS[c];
		let top = 0, count = 0, best = s;
		stack[top++] = s;
		seen[s] = 1;
		while (top) {
			const k = stack[--top];
			count++;
			if (depth[k] > depth[best]) best = k;
			const i = k % nx;
			for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx])
				if (q >= 0 && q < n && !seen[q] && cells[q] === c) {
					seen[q] = 1;
					stack[top++] = q;
				}
		}
		const m2 = count * CELL * CELL;
		if (USES[use].inside || use === 'road' || m2 < minM2 || depth[best] * CELL < minDepth) continue;
		out.push({ use, m2, x: x0 + ((best % nx) + 0.5) * CELL, z: z0 + (Math.floor(best / nx) + 0.5) * CELL });
	}
	return out;
}

/** what a dome or the tower's floor is used for, by zone, m² */
export function zonesOf(/** @type {Site} */ s, /** @type {HexPlan} */ plan) {
	const K = KINDS[s.kind];
	if (K.zones) return K.zones;
	const floor = Math.PI * footR(s, plan) ** 2;
	return [{ use: s.kind === 'tower' ? 'tower' : 'factory', label: K.label, m2: floor }];
}

/** under the glass: a home's crescent of galleries and its pond along the north, the food domes' pond, the rest */
function insideUse(/** @type {Site} */ s, /** @type {number} */ dx, /** @type {number} */ dz, /** @type {number} */ r) {
	const K = KINDS[s.kind];
	const north = dz < 0;
	if (s.kind === 'dome40' || s.kind === 'dome80') {
		const b = K.block;
		if (-dz >= b.front && -dz <= b.back && Math.abs(dx) <= K.levels[0].half) return 'living';
		if (-dz >= b.pondIn && r <= b.pondOut) return 'pond';
		return Math.abs(dx) < 1.5 || Math.abs(-dz - (b.front - b.balcony - 1.5)) < 0.8 ? 'commons' : 'indoorFood';
	}
	if (s.kind === 'food120' || s.kind === 'util120') {
		const a = capOf(120).a;
		// the pond: a band along the north, ~970 m²
		if (north && r < a - POND_IN && r > a - POND_IN - POND_BAND && Math.atan2(Math.abs(dx), -dz) < POND_HALF) return 'pond';
		if (s.kind === 'food120') return Math.abs(dx) < 2.5 || Math.abs(dz) < 2.5 ? 'commons' : 'tropical';
		return dz > 16 ? 'indoorFood' : 'utilities';
	}
	return s.kind === 'tower' ? 'tower' : 'factory';
}

/** the living hex's outdoor land: a hedge along the edge, wild land inside the roundabout, food forest everywhere
 * else @param {HexPlan} plan @param {Site[]} homes */
function livingLand(plan, /** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ edge, homes) {
	if (edge < 18) return 'nature';
	for (const s of homes) if (Math.hypot(x - s.x, z - s.z) < footR(s, plan) + 38) return 'foodForest';
	if (Math.hypot(x - plan.ring.x, z - plan.ring.z) < plan.ring.r) return 'nature';
	// a settlement grows no commercial crops (Samuel, 2026-10-08): the rest is all food forest
	return 'foodForest';
}

/** the tower hex's outdoor land: yards by the factories, then the fields, woods and pits by direction */
function towerLand(/** @type {HexPlan} */ plan, /** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ edge) {
	if (edge < 16) return 'nature';
	const dx = x - plan.cx, dz = z - plan.cz;
	const r = Math.hypot(dx, dz);
	if (r < plan.ring.r + 10) return 'yard';
	for (const s of plan.sites) if (s.kind === 'factory120' && Math.hypot(x - s.x, z - s.z) < capOf(120).a + 16) return 'yard';
	if (r < plan.ring.r + 130) return 'nature';
	const b = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
	if (b >= 315 || b < 40) return 'woodland';
	if (b < 100) return 'bamboo';
	if (b < 250) return 'hemp';
	return 'mine';
}
