/**
 * SANDBOX 6 · ONE HEX · THE NUMBERS — every dome and the tower at their real size, what they are built of in tonnes,
 * what that costs at real prices, and what goes on inside them. One source of truth: the 3D world (./scene.js), the
 * land-use map (./layout.js) and every panel on the page (./HexPlan.svelte) read their numbers from here.
 *
 * Units: metres, m², m³, tonnes, € (2025/26 prices, Germany where we could find them), kWh. Every constant says
 * where it comes from: our own research (the project files: sandbox-6/numbers.md, energy/village-energy.md, the dome
 * engineering thread) or a market source, or "assumed" with the reasoning. ./SOURCES lists them for the page.
 *
 * The domes are glazed geodesic caps, all of one shape: a cap a third as high as it is wide, as the dome engineering
 * research settled on (glulam struts, steel hubs, laminated glass, a hemp-fibre north shell, a 3 m fish pond at ground
 * level along the north). Since Samuel's change of 2026-10-08 the village has three sizes: Dome40 and Dome80 homes, and
 * Dome120 for the food forests, the utilities and the factories, round one Tower180 (src/lib/sandbox-7/geodesic.js
 * builds every panel). The engineering thread sized Dome50/100/150 and Tower200/250; the sizes between and below scale
 * from those along the curve they make (`between`).
 */
import { geodesicCap, towerGrid } from './geodesic.js';

/** @typedef {{ D: number, a: number, h: number, R: number, floor: number, shell: number, volume: number, perimeter: number, freq: number }} Cap */

/**
 * The geodesic's frequency (struts along an icosahedron edge) of each dome. The engineering thread sized the 150 m cap at
 * frequency 16 (~5–6 m struts), Dome100 at 13 and Dome50 at 8; ours keep their struts in the same 3–6 m range: Dome120
 * 14 (4.4–6.2 m), Dome80 11 (3.7–5.3 m), Dome40 7 (2.9–4.1 m)
 */
const GEO_FREQ = { 40: 7, 80: 11, 120: 14, 50: 8, 100: 13, 150: 16 };
/** A glazed cap `D` across, a third as high (the 150 m dome's 50 m): its sphere, floor, shell and air. @returns {Cap} */
export function capOf(/** @type {number} */ D) {
	const a = D / 2, h = D / 3;
	const R = (a * a + h * h) / (2 * h);
	return {
		D, a, h, R,
		floor: Math.PI * a * a,
		shell: 2 * Math.PI * R * h,
		volume: (Math.PI * h * h * (3 * R - h)) / 3,
		perimeter: Math.PI * D,
		freq: GEO_FREQ[/** @type {40 | 80 | 120} */ (D)] ?? Math.max(4, Math.round((16 * D) / 150))
	};
}
/** the height of a cap's shell over the floor, `r` from its middle */
export const capHeight = (/** @type {Cap} */ c, /** @type {number} */ r) => Math.max(0, Math.sqrt(Math.max(0, c.R * c.R - r * r)) - (c.R - c.h));

// ── what things cost and weigh ──────────────────────────────────────────────────────────────────────────────────

/**
 * Prices, € a unit. `src` names the source (./SOURCES), `range` what the sources span.
 * @type {Record<string, { label: string, unit: string, eur: number, range: string, src: string }>}
 */
export const PRICES = {
	glulam: { label: 'Larch/Douglas glulam struts, CNC-cut, supplied', unit: 'm³', eur: 1600, range: '1,100–2,200', src: 'glulam' },
	clt: { label: 'CLT and glulam for floors and galleries', unit: 'm³', eur: 900, range: '700–1,200', src: 'glulam' },
	hubs: { label: 'Cast-steel hubs, ring and connectors (galvanised)', unit: 't', eur: 9000, range: '5,000–15,000', src: 'steel' },
	steel: { label: 'Structural steel, fabricated and erected', unit: 't', eur: 3000, range: '2,500–4,500', src: 'steel' },
	glass: { label: 'Laminated low-iron double glazing, low-E', unit: 'm²', eur: 200, range: '150–300', src: 'glass' },
	pv: { label: 'See-through solar cells laid in the glass', unit: 'm²', eur: 150, range: '100–250', src: 'pv' },
	hemp: { label: 'Hemp-fibre insulation', unit: 'm³', eur: 140, range: '113–166', src: 'hemp' },
	lime: { label: 'Lime-pozzolan concrete (footings)', unit: 'm³', eur: 220, range: '150–300', src: 'lime' },
	concrete: { label: 'Screed and slabs (lime/LC3 concrete)', unit: 'm³', eur: 180, range: '130–250', src: 'lime' },
	land: { label: 'Farmland in Bavaria', unit: 'ha', eur: 78000, range: '77,700 (2024)–79,000', src: 'land' }
};

/** densities, t a m³ (glass: t a m² of laminated double glazing) */
export const DENSITY = {
	glulam: 0.55, // larch ~590, Douglas ~530 kg/m³ at 12% moisture
	clt: 0.47, // spruce CLT
	glass: 0.05, // 8 mm toughened + 12.76 mm laminated ≈ 21 mm × 2.5 t/m³
	hemp: 0.035, // hemp fibre batts, 35–45 kg/m³ (the engineering thread: 97.8 t in the 150 m dome's 8,509 m² at 30–35 cm)
	lime: 2.2,
	concrete: 2.3
};

/**
 * Putting it up: the shell's parts are prefabricated, so assembling, cranes, engineering and site work add about as
 * much again as half the materials (assumed: a timber gridshell's assembly is ~30–50% of its cost; glazing is fitted
 * by the panel, ~40–60 €/m²).
 */
export const ASSEMBLY = 0.5;

// ── a dome's shell ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The cold north side of every shell is closed (Samuel, 2026-10-08): solid triangles of hemp fibre in timber cassettes
 * on a stone plinth instead of glass and solar, holding the heat in. Its edge is one smooth line, as a flat cut
 * through the shell makes it: from the foot 70° west of north up over the north side and down to the foot 70° east
 * of north, the cut leaning north 20° from upright on a dome (so it stops below the crown) and 10° on a tower (where
 * it stops about where the apartments start). The crown, the east, the south and the west are glass.
 */
export const NORTH_FOOT = 70;
export const NORTH_TILT = 20;
export const TOWER_NORTH_TILT = 10;
const DEG = Math.PI / 180;
/**
 * How far either side of north the hemp reaches on a ring of radius r at height y, radians: the cut stands k north of
 * the middle at the ground and leans north at `tilt` degrees.
 */
export function northArc(/** @type {number} */ r, /** @type {number} */ y, /** @type {number} */ k, tilt = NORTH_TILT) {
	const q = (k + y * Math.tan(tilt * DEG)) / Math.max(r, 1e-6);
	return q >= 1 ? 0 : q <= -1 ? Math.PI : Math.acos(q);
}
/** where the cut stands at the ground for a shell `foot` m in radius */
export const northCut = (/** @type {number} */ foot) => foot * Math.cos(NORTH_FOOT * DEG);
/** the share of every dome's shell in hemp: the caps are all alike, so one number (about a quarter), counted on the 120 m dome's panels */
export const NORTH = (() => {
	const c = capOf(120);
	const g = geodesicCap({ R: c.R, h: c.h, freq: c.freq, k: northCut(c.a), tilt: NORTH_TILT });
	return g.m2.hemp / (g.m2.hemp + g.m2.glass + g.m2.solar);
})();
/**
 * Each dome as the engineering thread sized it (/mnt/project-files/dome-research/dome-sizes.json, 2026-10-08), mid
 * values: the glulam frame, the cast-steel hubs plus the steel ring at the foot, and the heat the dome needs beyond its
 * fish pond (from the groundwater loop) and its climate power (pumps, fans), kWh a year. Heat and climate are its
 * version 2 runs, made for our north band (a quarter of the shell, low on the north), so they are read as they are.
 */
const SIZED = {
	50: { timber: 80, steel: 19 + 2.2, heat: 0.02e6, climate: 0.014e6 },
	100: { timber: 565, steel: 128 + 17.5, heat: 0.12e6, climate: 0.062e6 },
	150: { timber: 2300, steel: 405 + 60, heat: 0.41e6, climate: 0.16e6 }
};
/**
 * A size the thread did not size, from the two it did on either side (or the nearest two): each figure follows the
 * power law the two make (frame timber grows with about the 2.8th–3.5th power of the size, heat with the 2.5th–3rd),
 * so Dome120 sits between Dome100 and Dome150 and Dome40 carries on the curve below Dome50.
 * @template {Record<string, number>} T @param {Record<number, T>} table @param {number} D @returns {T}
 */
export function between(table, D) {
	const sizes = Object.keys(table).map(Number).sort((a, b) => a - b);
	let i = sizes.findIndex((x) => x >= D);
	if (i <= 0) i = 1;
	const lo = sizes[i - 1], hi = sizes[Math.min(i, sizes.length - 1)];
	const t = Math.log(D / lo) / Math.log(hi / lo);
	return /** @type {T} */ (Object.fromEntries(Object.keys(table[lo]).map((k) => [k, table[lo][k] * Math.pow(table[hi][k] / table[lo][k], t)])));
}
const sized = (/** @type {number} */ D) => between(SIZED, D);
/** hemp fibre 30–35 cm thick (U 0.15), in timber cassettes of ~6 cm of timber a m² (the thread: 511 m³ in 8,509 m²) */
const HEMP_M = 0.325;
const CASSETTE_M = 0.06;
/**
 * Every panel is hemp, glass or solar (Samuel, 2026-10-08): glass and solar alternate, so half the glazing is solar
 * panels (see-through cells) and half clear glass for the plants' light. A m² of solar panel makes 227 kWh a year
 * where it tilts under 45° and 194 where it is steeper (the engineering thread's hourly Munich year: 0.92 GWh from
 * 4,036 m² on the 150 m cap's flatter glass, 6.63 GWh from 34,133 m² on Tower250's steep glass).
 */
export const CELLS = { steepest: 45, flatKwh: 227, steepKwh: 194 };
/** what a set of solar panels makes a year, kWh */
const solarOf = (/** @type {{ kind: string, area: number, tilt: number }[]} */ panels) =>
	panels.reduce((s, p) => s + (p.kind === 'solar' ? p.area * (p.tilt < CELLS.steepest ? CELLS.flatKwh : CELLS.steepKwh) : 0), 0);
/** @type {Map<number, import('./geodesic.js').Geodesic>} */
const domes = new Map();
/** a dome's geodesic: its panels (hemp, glass, solar), struts and hubs */
export function geodesicOf(/** @type {number} */ D) {
	let g = domes.get(D);
	if (!g) {
		const c = capOf(D);
		domes.set(D, (g = geodesicCap({ R: c.R, h: c.h, freq: c.freq, k: northCut(c.a), tilt: NORTH_TILT })));
	}
	return g;
}
/**
 * The rings of a tower's grid: every second point of its profile (a ring every ~5 m), 96 bays round, so the panels are
 * ~6 m wide at the foot of Tower180 and narrow up the shaft (the engineering thread put Tower200 at 2,350–4,250 hubs)
 */
export const towerRows = (/** @type {Tower} */ T) => towerProfile(T, 96).filter((_, k, all) => k % 2 === 0 || k === all.length - 1);
export const TOWER_BAYS = 96;
/** @type {Map<string, ReturnType<typeof towerGrid>>} */
const towerGrids = new Map();
/** a tower's panels (hemp, glass, solar), struts and hubs */
export function towerGridOf(/** @type {Tower} */ T) {
	let g = towerGrids.get(T.id);
	if (!g) towerGrids.set(T.id, (g = towerGrid({ rows: towerRows(T), bays: TOWER_BAYS, k: northCut(T.D / 2), tilt: TOWER_NORTH_TILT })));
	return g;
}

/**
 * What a dome's shell is built of: the frame as the engineering thread sized it, its panels counted one by one
 * (hemp, glass, solar), the footing by its rim; and what it makes and needs a year.
 * @param {number} D
 */
export function shellOf(D) {
	const c = capOf(D);
	const z = sized(D);
	const g = geodesicOf(D);
	const glazed = g.m2.glass + g.m2.solar;
	const north = g.m2.hemp;
	// a ring footing of lime-pozzolan concrete under the plinth, 0.8 m² (50 m) to 1.2 m² (150 m) in section
	const footing = c.perimeter * (0.6 + 0.004 * D);
	const m = {
		timber: z.timber + north * CASSETTE_M, // the struts, and the north shell's timber cassettes
		steel: z.steel,
		glass: glazed,
		pv: g.m2.solar,
		hemp: north * HEMP_M,
		lime: footing
	};
	return {
		cap: c,
		geodesic: g,
		glazed,
		north,
		m,
		solar: solarOf(g.panels),
		heat: z.heat,
		climate: z.climate,
		t: { timber: m.timber * DENSITY.glulam, steel: m.steel, glass: glazed * DENSITY.glass, hemp: m.hemp * DENSITY.hemp, lime: footing * DENSITY.lime },
		eur: {
			timber: m.timber * PRICES.glulam.eur,
			steel: m.steel * PRICES.hubs.eur,
			glass: glazed * PRICES.glass.eur,
			pv: m.pv * PRICES.pv.eur,
			hemp: m.hemp * PRICES.hemp.eur,
			lime: footing * PRICES.lime.eur
		}
	};
}

// ── what goes on inside ─────────────────────────────────────────────────────────────────────────────────────────

/** floor area a resident, m² gross (rooms, baths, shared kitchens and living, stairs): ~50 m² net, the German average */
export const GFA_PERSON = 62;
/** timber in a gallery of homes, m³ a m² of floor (CLT floors and walls, glulam posts; mass timber runs 0.2–0.4) */
const TIMBER_GFA = 0.28;
/** fitting out homes inside a dome, € a m²: timber multi-family homes cost 1,635–2,580 €/m² (BKI 2025, KG 300+400, gross
 * floor), their roof and façade a good share of it; inside a dome there is neither, so about 1,800 */
export const FITOUT_HOME = 1800;

/**
 * A home dome (Samuel, 2026-10-08): the homes are one straight block across the north of the dome, east to west, its
 * long face to the south with small balconies, looking over the dome's own food garden; it saves far more floor than a
 * ring of terraces. Its front stands `front` north of the middle and it is `depth` deep (daylight from the south face;
 * the north face looks onto the pond and the hemp). Each storey runs as far east and west as the shell lets it at its
 * back corners (with `clear` over its ceiling), so the block narrows storey by storey up under the shell; a storey under
 * 6 m long is left out. The fish pond (the heat store) fills the low ground between the block and the north rim.
 * @param {number} D @param {{ front: number, depth: number, storey?: number, clear?: number, balcony?: number }} o
 */
function homeDome(D, o) {
	const c = capOf(D);
	const storey = o.storey ?? 3.2, clear = o.clear ?? 0.8, balcony = o.balcony ?? 1.5;
	const back = o.front + o.depth;
	/** @type {{ k: number, y: number, h: number, half: number, m2: number }[]} */
	const levels = [];
	for (let k = 0; k < 20; k++) {
		const y = k * storey;
		// how far out the shell is still `clear` over this storey's ceiling, and so how far east and west its back corners go
		const r2 = c.R * c.R - (y + storey + clear + c.R - c.h) ** 2;
		const half = Math.sqrt(Math.max(0, r2 - back * back));
		if (2 * half < 6) break;
		levels.push({ k, y, h: storey, half, m2: 2 * half * o.depth });
	}
	const top = levels[levels.length - 1];
	const gfa = levels.reduce((a, l) => a + l.m2, 0);
	// the pond: the segment of the floor north of the block, a metre off it and a metre and a half in from the glass
	const pr = c.a - 1.5, ph = back + 1;
	const pond = pr * pr * Math.acos(ph / pr) - ph * Math.sqrt(pr * pr - ph * ph);
	const footprint = 2 * levels[0].half * o.depth, paths = c.floor * 0.08;
	return {
		people: Math.floor(gfa / GFA_PERSON),
		storeys: levels.length,
		levels,
		block: { front: o.front, back, depth: o.depth, balcony, pondIn: ph, pondOut: pr, height: top.y + top.h },
		gfa,
		/** small balconies on the south face of every storey above the ground, two thirds of its length */
		balconies: levels.slice(1).reduce((a, l) => a + 2 * l.half * (2 / 3) * balcony, 0),
		zones: [
			{ use: 'living', label: `Homes: a straight block of ${levels.length} storeys across the north (its footprint)`, m2: footprint },
			{ use: 'pond', label: 'Fish pond between the block and the north rim, the heat store', m2: pond },
			{ use: 'indoorFood', label: 'Food garden under the glass, south of the block', m2: c.floor - footprint - pond - paths },
			{ use: 'commons', label: 'Paths and the garden’s commons', m2: paths }
		]
	};
}

/**
 * The 120 m domes' pond: a band along the north, 6 m in from the glass, 18.4 m wide, 33.5° either side of north
 * (the 150 m dome's 23 m band of ~1,550 m² and 4,700 m³ from the climate model, at four fifths): ~970 m²
 */
export const POND_BAND = 18.4, POND_HALF = 0.585, POND_IN = 6;
const POND_120 = POND_HALF * ((60 - POND_IN) ** 2 - (60 - POND_IN - POND_BAND) ** 2);

/** a home kind: as many people as its block holds at 62 m² each */
const home = (/** @type {number} */ D, /** @type {Parameters<typeof homeDome>[1]} */ o) => {
	const h = homeDome(D, o);
	return { label: `Dome${D}`, D, role: 'home', note: `Home of ${h.people} in a straight block of ${h.storeys} storeys, with its own food garden`, ...h };
};

/**
 * The domes and the tower, by kind. `role` says what the land-use map paints them as; `zones` split their floor.
 * @type {Record<string, any>}
 */
export const KINDS = {
	// Dome40: storeys of 3 m (the cap is only 13.3 m high), the block's front on the east-west middle line; Dome80: 3.2 m
	dome40: home(40, { front: 0, depth: 10, storey: 3, clear: 0.6 }),
	dome80: home(80, { front: 12, depth: 9 }),
	food120: {
		label: 'Dome120 · Food',
		D: 120,
		role: 'food',
		note: 'A food forest under glass at 24 °C, tropical trees, no one lives here',
		people: 0,
		zones: [
			{ use: 'indoorFood', label: 'Food forest under glass, tropical (banana, papaya, jackfruit, citrus, cacao, coffee below)', m2: capOf(120).floor - POND_120 - 900 - 300 },
			{ use: 'pond', label: 'Fish pond, the heat store', m2: POND_120 },
			{ use: 'commons', label: 'Paths and the visitors’ walk', m2: 900 },
			{ use: 'utilities', label: 'Packing, cold store and nursery (under the north shell)', m2: 300 }
		]
	},
	util120: {
		label: 'Dome120 · Utilities',
		D: 120,
		role: 'utilities',
		note: 'The hex’s utilities, workshops and workspaces',
		people: 0,
		zones: [
			{ use: 'utilities', label: 'AI data center, 300 kW of computers (its heat warms the domes)', m2: 700, block: 'datacenter' },
			{ use: 'utilities', label: 'Batteries, 10 MWh LFP in 3 containers', m2: 250, block: 'battery' },
			{ use: 'utilities', label: 'Hydrogen: electrolyser, tanks and a 500 kW fuel cell', m2: 450, block: 'hydrogen' },
			{ use: 'utilities', label: 'Water: membrane bioreactor and a planted wetland that cleans it', m2: 1200, block: 'water' },
			{ use: 'utilities', label: 'Prototyping workshops: fab lab, CNC, 3D printers', m2: 1600, block: 'workshop' },
			{ use: 'utilities', label: 'Workspaces and co-working (a 2-storey crescent, 120 desks)', m2: 800, block: 'office' },
			{ use: 'utilities', label: 'Stores and the parcel hub', m2: 600, block: 'store' },
			{ use: 'pond', label: 'Fish pond, the heat store', m2: POND_120 },
			{ use: 'indoorFood', label: 'Gardens between them', m2: 0 },
			{ use: 'commons', label: 'Paths, plaza and loading', m2: 1400 }
		]
	},
	factory120: { label: 'Dome120 · Factory', D: 120, role: 'factory', note: 'Turns the hex’s raw materials into building materials', people: 0 },
	tower: { label: 'Tower180', D: 180, role: 'tower', note: 'The village’s one factory building, its utilities, offices, homes and halls', people: 0 }
};
// the utilities dome's gardens: what is left of its floor
{
	const z = KINDS.util120.zones;
	z.find((/** @type {any} */ q) => q.use === 'indoorFood').m2 = capOf(120).floor - z.reduce((/** @type {number} */ s, /** @type {any} */ q) => s + q.m2, 0);
}

/**
 * The eight factory domes round the tower (Samuel's second sketch): each turns what the hex grows or digs into a
 * building material. The mines and quarries stay outdoors, open pits with no dome over them; only the processing is
 * under glass.
 */
export const FACTORIES = [
	{ id: 'timber', label: 'Timber works', makes: 'Sawmill, kiln, glulam press and CNC: the domes’ struts and the CLT for floors', from: 'woodland' },
	{ id: 'hemp', label: 'Hemp works', makes: 'Decorticator: fibre for insulation batts, hurds for hempcrete, seed oil', from: 'hemp' },
	{ id: 'bamboo', label: 'Bamboo works', makes: 'Strand-woven bamboo (scrimber) beams and boards', from: 'bamboo' },
	{ id: 'steel', label: 'Steelworks', makes: 'Electric arc furnace on scrap: cast hubs, ring pieces, screws', from: 'scrap' },
	{ id: 'lime', label: 'Lime works', makes: 'Electric kiln: quicklime and lime-pozzolan mortars for footings', from: 'quarry' },
	{ id: 'clay', label: 'Clay works', makes: 'Electric tunnel kiln: fired clay voussoirs for the trade routes', from: 'clay' },
	{ id: 'glass', label: 'Glass & solar works', makes: 'Laminates the glazing and lays the see-through solar cells in it', from: 'imported glass' },
	{ id: 'recycling', label: 'Recycling works', makes: 'Sorts the village’s waste: compost, biogas, metals and glass back to the works', from: 'waste' }
];

// ── the tower ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The tower: the shell of the settlers game's village center at its real size (models.js spire(): a dome's shoulder
 * that sweeps in to a slender tower, rounded at the top). The dome tower research (2026-10-08) found it buildable in
 * principle from the same glulam, steel joints and glass: a 20 m drum, a steel tension ring at the knee, a 3 m deep
 * double-layer glulam lattice up the shoulder, then a single-layer diagrid tube. Since Samuel's change of 2026-10-08
 * every plan has one tower, Tower180: 180 m across and 198 m tall (the shape of Tower200 at nine tenths).
 * @typedef {{ id: string, label: string, D: number, H: number, top: number, stack: number, timber: number, steel: number, heat: number, climate: number }} Tower
 */
/**
 * The two towers the engineering thread sized (dome-sizes.json, mid values): glulam frame m³, hubs plus ring steel t,
 * heat beyond the pond and climate power, kWh a year
 */
const TOWER_SIZED = {
	200: { timber: 6350, steel: 1485 + 215, heat: 3.01e6, climate: 0.671e6 },
	250: { timber: 11900, steel: 2950 + 425, heat: 5.51e6, climate: 1.195e6 }
};
/** @type {Tower} */
export const TOWER = { id: 't180', label: 'Tower180', D: 180, H: 198, top: (90 * 0.3) / 1.6, stack: 24, ...between(TOWER_SIZED, 180) };

/** the radius of a tower's shell at a height (the settlers game's profile, at full size) */
export function towerRadius(/** @type {Tower} */ T, /** @type {number} */ y) {
	const { D, H, top } = T, R = D / 2;
	if (y >= H - top) return Math.sqrt(Math.max(0, top * top - (y - (H - top)) ** 2));
	const t = Math.min(1, Math.max(0, y / (H - top)));
	return Math.min(R, top + (R - top) * Math.pow(1 - t, 2.2) * (1 + 0.35 * Math.sin(Math.PI * Math.min(1, t * 2.2))));
}
/** the profile from foot to top, for a lathe @returns {[number, number][]} */
export function towerProfile(/** @type {Tower} */ T, n = 64) {
	const { H, top } = T;
	/** @type {[number, number][]} */
	const pts = [];
	for (let k = 0; k <= n; k++) pts.push([towerRadius(T, (k / n) * (H - top)), (k / n) * (H - top)]);
	for (let k = 1; k <= 8; k++) {
		const a = (k / 8) * (Math.PI / 2);
		pts.push([Math.max(0.01, top * Math.cos(a)), H - top + top * Math.sin(a)]);
	}
	return pts;
}

/** the lift and stair core, and how far the glass stands off the floors */
export const CORE_R = 9, FACADE = 2;

/**
 * @typedef {{ id: string, use: string, label: string, y: number, n: number, h: number, full?: boolean, r?: number, note: string }} Level
 */
/**
 * A tower's floors, foot to top. A floor of the stack runs from the core to its rim (the stack's radius, or the glass
 * less 2 m where the tower is narrower); the factory floor and the deck over it fill the whole foot. Between the deck
 * and the glass the shoulder is one great winter garden. The apartments run up to where the sky floors start: four
 * floors of 5 m that end where the shell has narrowed to the spire.
 * @param {Tower} T @returns {Level[]}
 */
export function towerLevels(T) {
	// where the shell has come in to within a tenth of the spire's radius: the top of the sky floors
	let skyTop = 0;
	for (let y = 0; y < T.H; y += 0.5) if (towerRadius(T, y) > T.top * 1.1) skyTop = y;
	skyTop = Math.floor(skyTop);
	const skyY = skyTop - 20;
	const aptY = 95.5;
	const aptN = Math.floor((skyY - aptY) / 3.5);
	return [
		{ id: 'base', use: 'utilities', label: 'Utilities and the rail hall', y: -8, n: 1, h: 8, r: 0.56 * (T.D / 2), note: 'Data center, batteries, hydrogen, water works, heat exchangers to the geothermal loop, and the platform where container trains come in from the trade routes' },
		{ id: 'factory', use: 'factory', label: 'Factory floor', y: 0, n: 1, h: 12, full: true, note: 'The village’s one factory hall: dome kits, solar glass, furniture and machines assembled; prototyping labs; the goods hub' },
		{ id: 'deck', use: 'park', label: 'Garden deck', y: 12, n: 1, h: 0, full: true, note: 'The factory’s roof under the glass: a park and food forest, a football pitch and courts, an amphitheatre, pavilions' },
		{ id: 'halls', use: 'community', label: 'Halls, theatre and sport', y: 12, n: 3, h: 6, note: 'A 1,000-seat theatre over two floors, a sports hall, community halls, a library, the clinic' },
		{ id: 'offices', use: 'offices', label: 'Offices and co-working', y: 30, n: 10, h: 3.75, note: 'Medium height: co-working floors, studios and company offices round a sky garden' },
		{ id: 'hotel', use: 'hotel', label: 'Hotel and short stays', y: 67.5, n: 8, h: 3.5, note: 'Rooms and serviced flats for tourists and visitors' },
		{ id: 'apartments', use: 'apartments', label: 'Premium apartments', y: aptY, n: aptN, h: 3.5, note: 'Apartments of ~250 m² for long rentals, buyers and visitors, the views over the valley' },
		{ id: 'sky', use: 'sky', label: 'Sky lobby, restaurant, lookout', y: skyY, n: 4, h: 5, note: 'Public at the top: the restaurant, a bar and the lookout' }
	];
}

/** gross floor area of a storey at height y: the stack's (core to rim), or the whole foot @param {Tower} T @param {Level} L */
export function storeyArea(T, L, /** @type {number} */ y) {
	if (L.r) return Math.PI * (L.r * L.r - CORE_R * CORE_R);
	const rim = Math.min(towerRadius(T, Math.max(0, y)), towerRadius(T, Math.max(0, y + L.h))) - FACADE;
	if (L.full) return Math.PI * (rim * rim - (L.id === 'deck' ? T.stack * T.stack : CORE_R * CORE_R));
	const r = Math.min(T.stack, rim);
	return Math.PI * (r * r - CORE_R * CORE_R);
}

/** a tower's floors with their areas @param {Tower} T */
export const towerFloors = (T) =>
	towerLevels(T).map((L) => {
		let m2 = 0;
		for (let k = 0; k < Math.max(1, L.n); k++) m2 += storeyArea(T, L, L.y + k * L.h);
		return { ...L, m2, top: L.y + L.n * L.h };
	});

/**
 * A tower's shell, its frame as the engineering thread's Tower200 and Tower250 put it for Tower180 (mid values), its
 * cold north side closed in hemp: the glass and the hemp by the m².
 * @param {Tower} T
 */
export function towerShell(T) {
	const p = towerProfile(T, 128);
	let shell = 0, volume = 0;
	for (let k = 1; k < p.length; k++) {
		const [r0, y0] = p[k - 1], [r1, y1] = p[k];
		shell += Math.PI * (r0 + r1) * Math.hypot(r1 - r0, y1 - y0);
		volume += (Math.PI * (y1 - y0) * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
	}
	const R = T.D / 2;
	const g = towerGridOf(T);
	const north = g.m2.hemp;
	const glazed = g.m2.glass + g.m2.solar;
	const m = { timber: T.timber + north * CASSETTE_M, steel: T.steel, glass: glazed, pv: g.m2.solar, hemp: north * HEMP_M, lime: Math.PI * T.D * 4 };
	return {
		shell,
		volume,
		floor: Math.PI * R * R,
		glazed,
		north,
		m,
		grid: g,
		solar: solarOf(g.panels),
		heat: T.heat,
		climate: T.climate,
		t: { timber: m.timber * DENSITY.glulam, steel: m.steel, glass: glazed * DENSITY.glass, hemp: m.hemp * DENSITY.hemp, lime: m.lime * DENSITY.lime },
		eur: {
			timber: m.timber * PRICES.glulam.eur,
			steel: m.steel * PRICES.steel.eur,
			glass: glazed * PRICES.glass.eur,
			pv: m.pv * PRICES.pv.eur,
			hemp: m.hemp * PRICES.hemp.eur,
			lime: m.lime * PRICES.lime.eur
		}
	};
}
/** fitting out a m² of the tower's floors, € (assumed, inside a shell already glazed): structure in timber and
 * screed, services and finishes; the factory floor and the deck carry more (the deck a metre of soil) */
export const FITOUT = { utilities: 3000, factory: 1500, park: 900, community: 2800, offices: 2800, hotel: 3000, apartments: 3200, sky: 3500 };
/** timber (m³) and screed (m³) a m² of floor: mass-timber floors ~0.25 m³ (the deck and factory long spans 0.4), 6 cm of screed */
export const FLOOR_MATERIALS = { timber: 0.25, longSpan: 0.4, screed: 0.06 };

// ── food, energy and people ─────────────────────────────────────────────────────────────────────────────────────

/** what a person eats in a year, t (the settlers game's European diet: 9.87 kg a week) */
export const DIET_T = 0.508;
/**
 * Food yields, t of fresh food a hectare a year: a value inside the ranges the sources give, on the careful side.
 * @type {Record<string, { t: number, label: string, src: string }>}
 */
export const YIELD = {
	indoorFood: { t: 35, label: 'Food forest under glass at 24 °C, tropical and temperate, trees with vegetables, greens and herbs between them all year: mixed tropical food forests give 10–40 t/ha, soil-grown greenhouse vegetables 50–150; about 35', src: 'yields' },
	foodForest: { t: 8, label: 'Temperate food forest outdoors, grown: 1–15 t/ha (young Dutch food forests ~1 t/ha; the settlers game’s year 15 is 7.3)', src: 'yields' }
};
/** raw materials the tower hex grows, a hectare a year */
export const RAW = {
	hemp: { label: 'Hemp', unit: 't straw', per: 10, note: 'Fibre hemp gives 5–12 t/ha of dry straw a year (TFZ Bavaria trial: 11.2 t); ~30% of it is fibre, the rest hurds, plus ~0.7 t seed', src: 'yields' },
	bamboo: { label: 'Bamboo', unit: 't culms', per: 7, note: 'Cold-hardy Phyllostachys in central Europe, grown in (year 6–8 on): about 4–12 t/ha dry a year (no measured European yields: estimate); Moso in Italy 8–20', src: 'yields' },
	woodland: { label: 'Douglas fir and larch', unit: 'm³ wood', per: 15, note: 'Douglas fir grows 18.9 m³/ha a year in Germany (national forest inventory), larch 8–13: a mix about 15', src: 'yields' },
	mine: { label: 'Clay, lime and gravel pits', unit: 't dug', per: 0, note: 'Open pits, no dome over them: only the works that fire and burn what they dig are under glass', src: 'numbers' }
};
/** the utilities' machines, € (sources in SOURCES.equipment) */
export const EQUIPMENT = [
	{ label: 'AI data center, 300 kW of IT', eur: 0.3 * 10.5e6, note: 'Frankfurt data centers cost ~10.5 M€ a MW of IT (Turner & Townsend 2025–26)' },
	{ label: 'Batteries, 10 MWh LFP', eur: 10000 * 250, note: '160 €/kWh utility-scale, 250–400 commercial (BNEF 2025)' },
	{ label: 'Fuel cell 500 kW and electrolyser', eur: 500 * 3000 * 2, note: 'PEM fuel cells 1,500–5,500 €/kW; an electrolyser of the same size about as much (estimate)' },
	{ label: 'Water works for 400 people', eur: 400 * 1500, note: 'Small membrane bioreactors 800–3,000 €/person, planted wetlands 150–1,000' }
];
/** energy, kWh a year (our research unless noted) */
export const ENERGY = {
	/** a person at home in a shared dome */
	person: 900,
	/** the AI data center: 300 kW of IT running all year, PUE 1.2 (liquid-cooled); ~85% of it comes back as 45 °C heat */
	datacenter: 300 * 8760 * 1.2,
	datacenterHeat: 300 * 8760 * 0.85,
	/** workshops and workspaces, a m² a year (assumed) */
	workshop: 120,
	/** cleaning a m³ of water (membrane bioreactor ~0.6–1 kWh/m³), a person's 36 m³ a year */
	water: 0.8 * 36,
	/** the tower's floors, kWh a m² a year (assumed, German benchmarks for efficient buildings) */
	tower: { utilities: 200, factory: 220, park: 20, community: 60, offices: 70, hotel: 110, apartments: 35, sky: 150 },
	/** what a MWh of power is worth, €: Germany's 2025 wholesale average (the settlers game uses 80) */
	eurMWh: 90
};

/**
 * Sources and how much to trust them, for the page.
 * @type {Record<string, { label: string, url?: string, note: string }>}
 */
export const SOURCES = {
	research: { label: 'Our dome engineering research (2026-10-07/08)', note: '150 m cap: 50 m high, frequency 16, 2,390 glulam struts 240×600–700 mm (2,100–2,500 m³), 826 cast-steel hubs, a steel ring at the foot, laminated glass, a hemp north shell, a 3 m fish pond. Tower: timber 10,200–13,600 m³, steel 2,000–4,800 t, glass ~6,000 t, shell 150–340 M€.' },
	climate: { label: 'The engineering thread’s per-size model (dome-research/dome-sizes.md, 2026-10-08)', note: 'Hourly Munich year at 24 °C. Frame, hubs and ring for Dome50/100/150 and Tower200/250; version 2 (the north band, 2026-10-08 evening): heat beyond the pond 0.02/0.12/0.41 GWh and 3.01/5.51 GWh, climate power 0.014/0.062/0.16 and 0.67/1.2 GWh. Cells in every second pane of glass tilted under 45° (towers: all glass), 227 kWh/m² a year on caps, 194 on towers. People, factories and offices are not counted as heat sources. Our Dome40, Dome80, Dome120 and Tower180 take each figure along the power law between the two sizes either side (or the nearest two).' },
	energy: { label: 'Our village energy research (energy/village-energy.md)', note: 'Geothermal 3.4 MW net a village center.' },
	numbers: { label: 'The settlers game’s numbers (sandbox-6/numbers.md)', note: 'Diet 508 kg a person a year (Germany eats ~450–650 kg); 900 kWh a person at home.' },
	glulam: { label: 'Glulam', url: 'https://www.holzkurier.com', note: 'Spruce glulam 555–575 €/m³ wholesale, 700–900 from a merchant (Holzkurier, Nov 2025). Larch and Douglas glulam only on request: ~750–1,200 (their logs cost about twice spruce’s). CNC-cut struts with their steel parts ~1,100–2,200 supplied, ~1,800–4,500 put up (estimate).' },
	steel: { label: 'Steel', url: 'https://gmk.center', note: 'Fabricated and erected structural steel 2,500–4,500 €/t (estimate; plate itself ~770 €/t). Cast nodes 10–25 €/kg, galvanised machined hubs 5–12 (no public lists: estimate). Scrap ~300 €/t (EU 2025).' },
	glass: { label: 'Glazing', url: 'https://www.aroundhome.de', note: 'Double glazing 95–140 €/m², laminated safety glass 55–320; laminated low-iron low-E double ~150–300 (estimate from these).' },
	pv: { label: 'See-through solar glass', url: 'https://www.42watt.de/magazin/transparente-solarmodule', note: 'Semi-transparent BIPV glass 170–280 €/m² as a module (1.0–1.6 €/Wp); counted here as ~150 €/m² on top of the glazing.' },
	hemp: { label: 'Hemp', url: 'https://www.baustoffshop.de', note: 'Hemp fibre mats 113–166 €/m³. Straw at the farm 100–180 €/t, fibre ~500–1,000 €/t, hurds ~250–450 €/t (older European figures).' },
	lime: { label: 'Lime and concrete', note: 'Lime-pozzolan and LC3 concretes ~150–300 €/m³ placed; quicklime 120–220 €/t; gravel 10–22 €/t ex works (estimates and quarry price lists).' },
	land: { label: 'Farmland', url: 'https://www.statistik.bayern.de', note: 'Bavaria: 79,000 €/ha in 2023, 78,170 in 2025.' },
	buildings: { label: 'Building costs', url: 'https://www.bki.de', note: 'Timber multi-family homes 1,635–2,580 €/m² gross floor (BKI 2025, KG 300+400); offices 3,300–5,800. Living space in Germany 49.2 m² a person (Destatis 2024). Offices 14 m² a desk, co-working 12–14.' },
	equipment: { label: 'Machines', note: 'Data centers ~10.5 M€ a MW of IT (Frankfurt, Turner & Townsend 2025–26); LFP storage 160 €/kWh utility, 250–400 commercial (BNEF 2025); PEM fuel cells 1,500–5,500 €/kW; small water works 150–3,000 € a person.' },
	yields: { label: 'Yields', url: 'https://www.tfz.bayern.de', note: 'Hemp straw 5–12 t/ha (TFZ trial 11.2); Douglas fir 18.9 m³/ha a year (BWI); poplar coppice 8–15 t/ha; apples 26–35 t/ha (Destatis); bananas under cover 35–72 t/ha, papaya 30–80; bamboo in central Europe and tropical food forests are estimates.' },
	power: { label: 'Power price', url: 'https://euenergy.live', note: 'German day-ahead wholesale averaged ~90 €/MWh in 2025; small and mid industry paid ~183 €/MWh (BDEW 2025).' }
};

/** € a person a year of food, at the settlers game's price (10 € a kg) */
export const FOOD_EUR_KG = 10;
