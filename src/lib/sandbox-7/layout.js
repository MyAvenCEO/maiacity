/**
 * SANDBOX 6 · ONE HEX · THE PLAN — where everything stands in the two hexes, and what every square metre of their
 * land is used for.
 *
 * A hex is the settlers game's hex at its real size: 665.6 m across its flats (13 steps of 1.6 units, 32 m a unit),
 * 768.6 m corner to corner, 38.4 ha. Pointy at north and south, as Samuel drew it. x runs east, z south (north is
 * −z), in metres; the living hex is centred on 0, the tower hex is its neighbour to the east.
 *
 *   living hex (Samuel's first sketch): three Dome150s in a triangle in the middle, the utilities dome at the top and
 *     the two tropical food domes below it, a ring road round them; five Dome100 homes in an arc along the south of
 *     the ring, their doors on it; eight Dome50 homes round the edge of the hex.
 *   tower hex (his second sketch): Tower250 in the middle, a ring road round it, eight Dome100 factories round that;
 *     outside, the fields, woods and pits that feed them.
 *
 * The land is painted on a raster of 2 m cells (`landOf`): domes, roads, then what the outdoor land is used for. The
 * areas the page shows come from counting the cells outdoors and from each dome's floor plan (./specs.js) indoors,
 * so the map and the numbers always agree.
 */
import { capOf, FACTORIES, KINDS, TOWERS } from './specs.js';

/** the hex: across its flats, its side (centre to corner) and its area */
export const HEX_W = 13 * 1.6 * 32;
export const HEX_S = HEX_W / Math.sqrt(3);
export const HEX_AREA = (Math.sqrt(3) / 2) * HEX_W * HEX_W;
/** the tower hex's middle: the living hex's neighbour to the east */
export const TOWER_AT = { x: HEX_W, z: 0 };

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
 * @typedef {{ id: 'living' | 'tower', label: string, cx: number, cz: number, sites: Site[], ways: Way[], ring: { x: number, z: number, r: number, w: number }, tower?: import('./specs.js').Tower }} HexPlan
 */

/** a circle as a polyline @returns {[number, number][]} */
const circle = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ r, n = 96) => Array.from({ length: n + 1 }, (_, k) => /** @type {[number, number]} */ ([x + r * Math.cos((k / n) * Math.PI * 2), z + r * Math.sin((k / n) * Math.PI * 2)]));
/** the middle of a hex's edge at a bearing (30, 90, …) */
const edgeMid = (/** @type {number} */ deg, cx = 0, cz = 0) => bearing(deg, HEX_W / 2, cx, cz);
/** the bearing from one point to another */
const towards = (/** @type {{ x: number, z: number }} */ a, /** @type {{ x: number, z: number }} */ b) => ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;

/** @returns {HexPlan} */
function livingHex() {
	const O = { x: 0, z: -20 };
	const RING = 180;
	/** @type {Site[]} */
	const sites = [];
	// the three Dome150s in a triangle round the ring's middle, 12 m apart: the utilities to the north, food below
	const tri = 162 / Math.sqrt(3);
	sites.push({ id: 'util', kind: 'util150', ...bearing(0, tri, O.x, O.z), name: 'Utilities', door: 0 });
	sites.push({ id: 'foodW', kind: 'food150', ...bearing(240, tri, O.x, O.z), name: 'Food forest west', door: 240 });
	sites.push({ id: 'foodE', kind: 'food150', ...bearing(120, tri, O.x, O.z), name: 'Food forest east', door: 120 });
	// five Dome100 homes in an arc along the south of the ring, doors on it
	[120, 150, 180, 210, 240].forEach((b, k) => sites.push({ id: `h100-${k}`, kind: 'dome100', ...bearing(b, 245, O.x, O.z), name: `Home of 36 · ${k + 1}`, door: (b + 180) % 360 }));
	// eight Dome50 homes round the edge, in pairs as the sketch has them
	/** @type {[number, number][]} */
	const smalls = [[-42, -272], [42, -272], [-215, -188], [215, -188], [-292, -78], [292, -78], [-298, 52], [298, 52]];
	smalls.forEach(([x, z], k) => sites.push({ id: `h50-${k}`, kind: 'dome50', x, z, name: `Home of 12 · ${k + 1}`, door: towards({ x, z }, O) }));
	/** @type {Way[]} */
	const ways = [{ pts: circle(O.x, O.z, RING), w: 8, kind: 'road', ring: true }];
	// roads out to the six neighbours, middle to middle (as in the settlers game), leaving the ring between the domes
	for (const [b, via] of /** @type {[number, number][]} */ ([[30, 30], [90, 90], [270, 270], [330, 330], [150, 135], [210, 225]])) {
		const a = bearing(via, RING, O.x, O.z), m = edgeMid(b);
		const pts = /** @type {[number, number][]} */ ([[a.x, a.z]]);
		if (via !== b) {
			const v = bearing(via, 312, O.x, O.z);
			pts.push([v.x, v.z]);
		}
		pts.push([m.x, m.z]);
		ways.push({ pts, w: 6, kind: 'road' });
	}
	// a footpath from the ring to each Dome50's door
	for (const s of sites.filter((s) => s.kind === 'dome50')) {
		const b = towards(O, s);
		const a = bearing(b, RING, O.x, O.z), d = bearing(s.door, capOf(50).a, s.x, s.z);
		ways.push({ pts: [[a.x, a.z], [d.x, d.z]], w: 3, kind: 'path' });
	}
	return { id: 'living', label: 'Living hex', cx: 0, cz: 0, sites, ways, ring: { ...O, r: RING, w: 8 } };
}

/** the tower hex round a tower (Tower250 or Tower200): its ring road 12 m off the glass, the factories just outside it
 * @param {import('./specs.js').Tower} T @returns {HexPlan} */
function towerHex(T) {
	const { x: cx, z: cz } = TOWER_AT;
	const RING = T.D / 2 + 12;
	/** @type {Site[]} */
	const sites = [{ id: 'tower', kind: 'tower250', x: cx, z: cz, name: T.label, door: 180 }];
	[...Array(8)].forEach((_, k) => {
		const b = 22.5 + k * 45;
		sites.push({ id: `f-${k}`, kind: 'factory100', ...bearing(b, RING + 63, cx, cz), name: FACTORIES.find((f) => f.id === FACTORY_ORDER[k])?.label ?? '', factory: FACTORY_ORDER[k], door: (b + 180) % 360 });
	});
	/** @type {Way[]} */
	const ways = [{ pts: circle(cx, cz, RING), w: 8, kind: 'road', ring: true }];
	for (const [b, via] of /** @type {[number, number][]} */ ([[30, 45], [90, 90], [150, 135], [210, 225], [270, 270], [330, 315]])) {
		const a = bearing(via, RING, cx, cz), m = edgeMid(b, cx, cz);
		const pts = /** @type {[number, number][]} */ ([[a.x, a.z]]);
		if (via !== b) {
			const v = bearing(via, RING + 131, cx, cz);
			pts.push([v.x, v.z]);
		}
		pts.push([m.x, m.z]);
		ways.push({ pts, w: 8, kind: 'road' });
	}
	return { id: 'tower', label: 'Tower hex', cx, cz, sites, ways, ring: { x: cx, z: cz, r: RING, w: 8 }, tower: T };
}

/** the factories, round the tower clockwise from the north-north-east; the works nearest its fields */
const FACTORY_ORDER = ['timber', 'bamboo', 'hemp', 'recycling', 'glass', 'clay', 'lime', 'steel'];

export const LIVING = livingHex();
/** the tower hex, for each tower */
export const TOWER_HEXES = Object.fromEntries(Object.entries(TOWERS).map(([k, T]) => [k, towerHex(T)]));

/** a dome's or the tower's radius on the ground @param {Site} s @param {HexPlan} [plan] */
export const footR = (s, plan) => (s.kind === 'tower250' ? (plan?.tower?.D ?? 250) / 2 : capOf(KINDS[s.kind].D).a);

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
	commercial: { label: 'Orchards and market gardens', map: '#d6c24a', ground: '#8aa04a', group: 'Commercial' },
	hemp: { label: 'Hemp fields', map: '#c8d860', ground: '#7d9a3e', group: 'Commercial' },
	bamboo: { label: 'Bamboo groves', map: '#53b88a', ground: '#5e8c3a', group: 'Commercial' },
	woodland: { label: 'Timber woodland (Douglas fir, larch)', map: '#2f6b3a', ground: '#3d6236', group: 'Commercial' },
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
	const homes = plan.sites.filter((s) => s.kind === 'dome50' || s.kind === 'dome100');
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

/** what a dome or the tower's floor is used for, by zone, m² */
export function zonesOf(/** @type {Site} */ s, /** @type {HexPlan} */ plan) {
	const K = KINDS[s.kind];
	if (K.zones) return K.zones;
	const floor = Math.PI * footR(s, plan) ** 2;
	return [{ use: s.kind === 'tower250' ? 'tower' : 'factory', label: K.label, m2: floor }];
}

/** under the glass: a home's crescent of galleries and its pond along the north, the food domes' pond, the rest */
function insideUse(/** @type {Site} */ s, /** @type {number} */ dx, /** @type {number} */ dz, /** @type {number} */ r) {
	const K = KINDS[s.kind];
	const north = dz < 0;
	if (s.kind === 'dome50' || s.kind === 'dome100') {
		const g = K.gallery;
		if (north && r <= g.rOut && r >= g.rIn) return 'living';
		if (north && r < g.rIn && r >= g.pondIn) return 'pond';
		return Math.abs(dx) < 2 || Math.abs(r - (g.pondIn - 3)) < 1.2 ? 'commons' : 'indoorFood';
	}
	if (s.kind === 'food150' || s.kind === 'util150') {
		const a = capOf(150).a;
		// the pond: a band along the north, 1,550 m²
		if (north && r < a - 6 && r > a - 6 - POND_BAND && Math.atan2(Math.abs(dx), -dz) < POND_HALF) return 'pond';
		if (s.kind === 'food150') return Math.abs(dx) < 2.5 || Math.abs(dz) < 2.5 ? 'commons' : 'tropical';
		return dz > 20 ? 'indoorFood' : 'utilities';
	}
	return s.kind === 'tower250' ? 'tower' : 'factory';
}
/** the 150 m domes' pond: a band 23 m wide, 6 m in from the glass, 33.5° either side of north: ~1,550 m² */
export const POND_BAND = 23, POND_HALF = 0.585;

/** the living hex's outdoor land: a hedge along the edge, food forest round the homes, wild land to the north, and
 * orchards and market gardens on the sunny rest @param {HexPlan} plan @param {Site[]} homes */
function livingLand(plan, /** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ edge, homes) {
	if (edge < 18) return 'nature';
	for (const s of homes) if (Math.hypot(x - s.x, z - s.z) < footR(s, plan) + 38) return 'foodForest';
	const inRing = Math.hypot(x - plan.ring.x, z - plan.ring.z) < plan.ring.r;
	if (inRing) return 'nature';
	if (z < plan.ring.z - 120) return 'nature';
	return 'commercial';
}

/** the tower hex's outdoor land: yards by the factories, then the fields, woods and pits by direction */
function towerLand(/** @type {HexPlan} */ plan, /** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ edge) {
	if (edge < 16) return 'nature';
	const dx = x - plan.cx, dz = z - plan.cz;
	const r = Math.hypot(dx, dz);
	if (r < plan.ring.r + 10) return 'yard';
	for (const s of plan.sites) if (s.kind === 'factory100' && Math.hypot(x - s.x, z - s.z) < 50 + 16) return 'yard';
	if (r < plan.ring.r + 130) return 'nature';
	const b = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
	if (b >= 315 || b < 40) return 'woodland';
	if (b < 100) return 'bamboo';
	if (b < 250) return 'hemp';
	return 'mine';
}
