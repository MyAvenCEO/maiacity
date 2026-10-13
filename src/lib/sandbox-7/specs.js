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

// ── the design package: the one switch ──────────────────────────────────────────────────────────────────────────

/**
 * The design packages from the cost audit (theos/sandbox-8/cost-audit.md, 2026-10-13). Each adds to the one before.
 * Samuel chose 'insides' on 2026-10-13: every dome stays, the insides get cheaper. Every number that differs between them reads `PACKAGE` (or `INSIDES` and `HALLS`) below.
 *   prices       the audit's price corrections only: larch/Douglas struts, cast hubs, a fuel cell and an electrolyser
 *                in each utilities dome, 100 MWh of batteries, the eight works in Dome120s
 *   insides      cheaper insides: spruce glulam struts, hubs welded from plate, no fuel cells or electrolysers, 30 MWh
 *                of batteries (2 MWh in each utilities dome, 18 at the centre)
 *   halls        cheaper insides, and the eight works in plain portal-frame halls with solar on their south roofs
 *   glasshouses  halls, and the twelve food domes as Venlo glasshouses: NOT BUILT YET
 * @type {Record<string, { n: number, label: string, note: string, insides: boolean, halls: boolean, built: boolean }>}
 */
export const PACKAGES = {
	prices: { n: 1, label: 'Prices only', note: 'the audit’s price corrections; the design as it was', insides: false, halls: false, built: true },
	insides: { n: 2, label: 'Cheaper insides', note: 'spruce glulam struts, hubs welded from plate, no fuel cells or electrolysers, 30 MWh of batteries', insides: true, halls: false, built: true },
	halls: { n: 3, label: 'Cheaper insides, the works in plain halls', note: 'cheaper insides, and the eight works in plain portal-frame halls with solar on their south roofs instead of Dome120s', insides: true, halls: true, built: true },
	glasshouses: { n: 4, label: 'Halls, and the food in Venlo glasshouses', note: 'not built yet: the twelve food domes as Venlo glasshouses', insides: true, halls: true, built: false }
};
/**
 * THE SWITCH: 'prices' | 'insides' | 'halls'. Change this line to flip the whole village to another package. A script
 * can print another package without editing it: S7_DESIGN=prices node script.mjs (the page always uses this line).
 */
const DESIGN_DEFAULT = 'insides';
/** the design package in use @type {string} */
export const DESIGN = (() => {
	const env = typeof process !== 'undefined' ? process.env?.S7_DESIGN : undefined;
	const d = env || DESIGN_DEFAULT;
	if (!PACKAGES[d]) throw new Error(`sandbox-7 DESIGN '${d}': no such package (${Object.keys(PACKAGES).join(', ')})`);
	if (!PACKAGES[d].built) throw new Error(`sandbox-7 DESIGN '${d}' (package ${PACKAGES[d].n}: ${PACKAGES[d].note}) is not built yet. Use 'prices', 'insides' or 'halls'.`);
	return d;
})();
export const PACKAGE = PACKAGES[DESIGN];
/** cheaper insides (packages 2–4) */
export const INSIDES = PACKAGE.insides;
/** the works in plain halls (packages 3–4) */
export const HALLS = PACKAGE.halls;
/**
 * The village's batteries, kWh: each utilities dome's and the centre's (the centre dome's, or the tower's). Package 1:
 * 100 MWh, ~67 kWh a person; packages 2–4: 30 MWh (the cost audit's menu: less night storage, the geothermal plant
 * carries the base load). The engine (sandbox-9 village.js and ramp.js) should read these instead of its own 10,000 and 40,000.
 */
export const BATTERY_KWH = INSIDES ? { util: 2000, centre: 18000 } : { util: 10000, centre: 40000 };

// ── what things cost and weigh ──────────────────────────────────────────────────────────────────────────────────

/**
 * Hubs welded from plate (packages 2–4), what a tonne of finished hubs takes from outside the village, € (estimates
 * from the sources in SOURCES.steel and SOURCES.hubs; the welders are villagers, so no wage is in `village`):
 *   plate      S355 heavy plate 750–850 €/t (eurometal 2025); ~22 % is cut away and goes back as scrap at ~300 €/t
 *   galvanising  hot-dip galvanising 200–500 €/t (feuerverzinken.com), done by a galvaniser near by, and the haul there
 *   bolts      the bolt sets and pins, ~12 % of the mass, galvanised high-strength sets at ~5 €/kg
 *   consumables  welding wire (~40 kg a t at ~2 €/kg), shielding gas, plasma tips and abrasives
 *   power      ~250 kWh a t to cut and weld at 0.18 €/kWh (BDEW 2025 industry price)
 *   upkeep     the line's wear and spares, and the welding tests and the EN 1090 (EXC3) certificate a year
 * `bought`: the same hubs from a steel fabricator: its ~40 shop hours a t (a hub is all cuts and welds; steelconstruction.info:
 * 20 hours of fabrication cost about as much as a tonne of raw steel, ~800 €) and ~15 % for its overheads and margin.
 */
export const HUBS_WELDED = (() => {
	const parts = { plate: 800 * 1.22 - 300 * 0.22, galvanising: 350 + 80, bolts: 0.12 * 5000, consumables: 200, power: 250 * 0.18, upkeep: 250 };
	const village = Object.values(parts).reduce((a, b) => a + b, 0);
	const shop = 40 * (800 / 20);
	return { parts, village, shopHours: 40, bought: (village - parts.power - parts.upkeep + shop) * 1.15, range: { village: '1,800–3,000', bought: '3,500–6,000' }, est: true };
})();

/**
 * Prices, € a unit, net of VAT, the material only: the villagers build it themselves, so no trade's labour, erection or
 * CNC service is in a price (the cost audit, theos/sandbox-8/cost-audit.md, 2026-10-13). `src` names the source
 * (./SOURCES), `range` what the sources span, `est` marks a price worked out from the sources rather than read off one.
 * `insteadOf` is the package-1 price a design choice replaces (DESIGN).
 * @type {Record<string, { label: string, unit: string, eur: number, range: string, src: string, est?: boolean, was?: number, insteadOf?: number }>}
 */
export const PRICES = {
	// the struts' blanks; the village cuts the struts on its own used beam centre (buildout.js KIT 'joinery'), so no CNC
	// service is bought. Package 1: larch/Douglas, spruce glulam 555–575 €/m³ wholesale (Holzkurier 11/2025) and larch logs
	// ~1.7× spruce's. Packages 2–4: spruce glulam itself, ~600 €/m³ delivered in lots (it resists damp less: the struts at
	// the glazing see condensation, so they need their coating kept up)
	glulam: INSIDES
		? { label: 'Spruce glulam blanks (GL24h) for the struts (the village cuts them)', unit: 'm³', eur: 600, range: '555–650', src: 'glulam', est: true, was: 1600, insteadOf: 950 }
		: { label: 'Larch/Douglas glulam blanks for the struts (the village cuts them)', unit: 'm³', eur: 950, range: '800–1,200', src: 'glulam', est: true, was: 1600 },
	// the north shell's cassettes are plain spruce structural timber (KVH 410–430 €/m³ wholesale, Holzkurier 11/2025)
	cassette: { label: 'Spruce structural timber (KVH) for the north cassettes', unit: 'm³', eur: 500, range: '420–650', src: 'glulam', est: true },
	clt: { label: 'CLT and glulam for floors and galleries', unit: 'm³', eur: 550, range: '500–700', src: 'glulam', est: true, was: 900 },
	// package 1 casts the hubs; packages 2–4 weld them from plate: bought welded until the village's steel works welds
	// them (buildout.js OWN.steelT, then HUBS_WELDED.village)
	hubs: INSIDES
		? { label: 'Steel hubs, ring and connectors welded from plate, galvanised, bought from a steel fabricator (until the village welds them)', unit: 't', eur: Math.round(HUBS_WELDED.bought / 100) * 100, range: '3,500–6,000', src: 'steel', est: true, was: 9000, insteadOf: 6000 }
		: { label: 'Cast-steel hubs, ring and connectors (galvanised, machined, not erected)', unit: 't', eur: 6000, range: '4,500–9,000', src: 'steel', est: true, was: 9000 },
	steel: { label: 'Structural steel, fabricated, not erected', unit: 't', eur: 2300, range: '1,800–3,000', src: 'steel', est: true, was: 3000 },
	glass: { label: 'Laminated low-iron double glazing, low-E, with its gaskets and caps', unit: 'm²', eur: 190, range: '140–250', src: 'glass', est: true, was: 200 },
	pv: { label: 'Solar cells laid in the glass (on top of the glazing’s price)', unit: 'm²', eur: 100, range: '50–150', src: 'pv', est: true, was: 150 },
	hemp: { label: 'Hemp-fibre insulation', unit: 'm³', eur: 115, range: '90–140', src: 'hemp', est: true, was: 140 },
	lime: { label: 'Lime-pozzolan concrete (footings)', unit: 'm³', eur: 180, range: '140–250', src: 'lime', est: true, was: 220 },
	concrete: { label: 'Screed and slabs (lime/LC3 concrete)', unit: 'm³', eur: 150, range: '120–200', src: 'lime', est: true, was: 180 },
	land: { label: 'Farmland in Bavaria', unit: 'ha', eur: 78000, range: '77,700 (Bavaria 2024)–150,000 (Upper Bavaria)', src: 'land' }
};

/** densities, t a m³ (glass: t a m² of laminated double glazing) */
export const DENSITY = {
	glulam: INSIDES ? 0.47 : 0.55, // larch ~590, Douglas ~530 kg/m³ at 12% moisture; spruce glulam ~470 (packages 2–4)
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
			// the struts in glulam, the cassettes in plain structural timber
			timber: z.timber * PRICES.glulam.eur + north * CASSETTE_M * PRICES.cassette.eur,
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
/** fitting out homes inside a dome, € a m², trades and materials as a builder would charge: timber multi-family homes
 * cost 1,635–2,580 €/m² (BKI 2025, KG 300+400, gross floor, mean 2,190), with 19 % VAT, roof and façade in it; net of
 * VAT that is ~1,840, and inside a dome there is no roof and no weather façade, so about 1,600 (range 1,300–1,900,
 * estimate; was 1,800). The build-out (./buildout.js) buys half of it: the materials, not the trades. */
export const FITOUT_HOME = 1600;

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
			// packages 2–4: 2 MWh in one 20 ft container (today's hold 3–5 MWh) with its clearances; no hydrogen
			INSIDES
				? { use: 'utilities', label: `Batteries, ${BATTERY_KWH.util / 1000} MWh LFP in one container`, m2: 80, block: 'battery' }
				: { use: 'utilities', label: 'Batteries, 10 MWh LFP in 3 containers', m2: 250, block: 'battery' },
			...(INSIDES ? [] : [{ use: 'utilities', label: 'Hydrogen: electrolyser, tanks and a 500 kW fuel cell', m2: 450, block: 'hydrogen' }]),
			{ use: 'utilities', label: 'Water: membrane bioreactor and a planted wetland that cleans it', m2: 1200, block: 'water' },
			{ use: 'utilities', label: 'Prototyping workshops: fab lab, CNC, 3D printers', m2: 1600, block: 'workshop' },
			{ use: 'utilities', label: 'Workspaces and co-working (a 2-storey crescent, 120 desks)', m2: 800, block: 'office' },
			{ use: 'utilities', label: 'Stores and the parcel hub', m2: 600, block: 'store' },
			{ use: 'pond', label: 'Fish pond, the heat store', m2: POND_120 },
			{ use: 'indoorFood', label: 'Gardens between them', m2: 0 },
			{ use: 'commons', label: 'Paths, plaza and loading', m2: 1400 }
		]
	},
	// packages 3–4: the works stand in plain halls (hallOf); `D` stays 120 only for readers that still take a works for a
	// Dome120 (sandbox-9 village.js siteParts calls shellOf(K.D)); sandbox-7 reads the hall when `hall` is set
	factory120: HALLS
		? { label: 'Works hall', D: 120, hall: true, role: 'factory', note: 'A plain portal-frame hall with solar on its south roof: turns the hex’s raw materials into building materials', people: 0 }
		: { label: 'Dome120 · Factory', D: 120, role: 'factory', note: 'Turns the hex’s raw materials into building materials', people: 0 },
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
	INSIDES
		? { id: 'steel', label: 'Steelworks', makes: 'Cuts bought plate on a CNC plasma table and welds the domes’ hubs, ring pieces and connectors (a galvaniser near by galvanises them)', from: 'plate' }
		: { id: 'steel', label: 'Steelworks', makes: 'Electric arc furnace on scrap: cast hubs, ring pieces, screws', from: 'scrap' },
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
			timber: T.timber * PRICES.glulam.eur + north * CASSETTE_M * PRICES.cassette.eur,
			steel: m.steel * PRICES.steel.eur,
			glass: glazed * PRICES.glass.eur,
			pv: m.pv * PRICES.pv.eur,
			hemp: m.hemp * PRICES.hemp.eur,
			lime: m.lime * PRICES.lime.eur
		}
	};
}
/** fitting out a m² of the tower's floors, € (assumed, inside a shell already glazed): structure in timber and
 * screed, services and finishes; the factory floor and the deck carry more (the deck a metre of soil). `utilities`:
 * workshops, halls and co-working inside a dome, net of VAT and with no roof or façade: BKI offices 3,300–5,800 €/m²
 * gross with VAT and envelope less ~45 %, workshops less, so ~2,000 (range 1,400–2,800, estimate; was 3,000). */
export const FITOUT = { utilities: 2000, factory: 1500, park: 900, community: 2800, offices: 2800, hotel: 3000, apartments: 3200, sky: 3500 };
/** timber (m³) and screed (m³) a m² of floor: mass-timber floors ~0.25 m³ (the deck and factory long spans 0.4), 6 cm of screed */
export const FLOOR_MATERIALS = { timber: 0.25, longSpan: 0.4, screed: 0.06 };

// ── food, energy and people ─────────────────────────────────────────────────────────────────────────────────────

/**
 * What a person eats (Samuel, 2026-10-09): only legumes, nuts and seeds, vegetables (roots and tubers among them),
 * fruit, chicken and eggs, in healthy amounts. Modelled on the EAT-Lancet planetary health diet (75 g dry legumes,
 * 50 g nuts, 300 g vegetables, 200 g fruit, 29 g poultry and 13 g eggs a day, 2,500 kcal for a reference adult), with
 * its grains and dairy swapped for chestnuts, roots and more legumes, fruit and nuts; about 2,250 kcal and 73 g of
 * protein a day, a mixed population's average; chicken ~210 g a week (the DGE's limit for meat is 300 g).
 * g: fresh grams a day (legumes dry, nuts as kernels); kcal and protein (g) a kg.
 * @type {Record<string, { label: string, g: number, kcal: number, protein: number }>}
 */
export const DIET = {
	legumes: { label: 'Legumes (beans, peas, lentils, lupins), dry', g: 110, kcal: 3400, protein: 220 },
	nuts: { label: 'Nuts and seeds (hazel, walnut, sunflower, pumpkin, hemp), kernels', g: 75, kcal: 6000, protein: 180 },
	chestnuts: { label: 'Sweet chestnuts', g: 220, kcal: 1900, protein: 24 },
	roots: { label: 'Roots and tubers (potato, sweet potato, Jerusalem artichoke)', g: 550, kcal: 800, protein: 20 },
	vegetables: { label: 'Vegetables and greens', g: 400, kcal: 300, protein: 15 },
	fruit: { label: 'Fruit and berries', g: 550, kcal: 650, protein: 7 },
	eggs: { label: 'Eggs (about 3 a week)', g: 25, kcal: 1430, protein: 125 },
	chicken: { label: 'Chicken (about 210 g a week)', g: 30, kcal: 1500, protein: 200 }
};
/** a person's day, kcal and g of protein */
export const DAY = Object.values(DIET).reduce((a, d) => ({ kcal: a.kcal + (d.g / 1000) * d.kcal, protein: a.protein + (d.g / 1000) * d.protein }), { kcal: 0, protein: 0 });
/**
 * The hens, free under the trees: dual-purpose birds lay ~250 eggs a year on ~2.3 kg of feed a kg of eggs; their
 * cockerels, grown slowly, eat ~5 kg a kg of meat on the plate; three tenths of it they find themselves (grass,
 * insects, windfalls, scraps), the rest is grown for them: beans, seeds and cooked roots.
 */
export const HENS = { eggsFeed: 2.3, meatFeed: 5, forage: 0.3, mix: { legumes: 0.35, nuts: 0.15, roots: 0.5 } };
/** what is grown for a person in a year, kg: what they eat of the plants, and what the hens eat for their eggs and meat */
export const GROWN = (() => {
	const year = (/** @type {string} */ k) => (DIET[k].g * 365) / 1000;
	const feed = (year('eggs') * HENS.eggsFeed + year('chicken') * HENS.meatFeed) * (1 - HENS.forage);
	/** @type {Record<string, number>} */
	const g = {};
	for (const k of ['legumes', 'nuts', 'chestnuts', 'roots', 'vegetables', 'fruit']) g[k] = year(k) + feed * (/** @type {Record<string, number>} */ (HENS.mix)[k] ?? 0);
	return { kg: g, feed };
})();

/**
 * The 7-layer food forests, grown and planted for this diet (canopy, low trees, shrubs, herbs, ground cover, roots and
 * climbers): what each crop gives a hectare a year where it grows, organic, t (legumes dry, nuts as kernels, the rest
 * fresh), and how much more the layers give together on the same ground (`stack`). Outdoors, Munich: chestnuts 1–3 t/ha
 * in European orchards; hazel and walnut 2–4 t in shell (~45% kernel); dry beans 1.5–3 (organic ~2); organic potatoes
 * ~25 (conventional 40+); vegetables 20–40; apples 26–35 commercially, less under a canopy. Under the glass at 24 °C all
 * year, with half the light (glass and solar panels): bananas 30–72 t/ha, papaya 30–80, sweet potato and cassava 15–30
 * a crop, pigeon pea 1–2.5 t dry, greens three crops or more a year; no chestnuts (their calories come from roots).
 */
export const FOREST = {
	outdoor: { label: 'Food forest outdoors', stack: 1.3, t: { legumes: 2.2, nuts: 1.2, chestnuts: 2.5, roots: 25, vegetables: 25, fruit: 15 } },
	indoor: { label: 'Food forest under glass', stack: 1.3, t: { legumes: 3, nuts: 1.5, chestnuts: 0, roots: 30, vegetables: 45, fruit: 35 } }
};
/**
 * The food forest it takes to feed one person, m², planted in the diet's proportions (under the glass the chestnuts'
 * calories as roots), with what each crop takes
 * @param {'outdoor' | 'indoor'} where
 */
export function landFor(where) {
	const f = FOREST[where];
	/** @type {Record<string, number>} */
	const m2 = {};
	for (const [k, kg] of Object.entries(GROWN.kg)) {
		let need = kg;
		if (k === 'chestnuts' && !f.t.chestnuts) continue;
		if (k === 'roots' && !f.t.chestnuts) need += (GROWN.kg.chestnuts * DIET.chestnuts.kcal) / DIET.roots.kcal;
		m2[k] = (need / (/** @type {Record<string, number>} */ (f.t)[k] * 1000)) * 1e4 / f.stack;
	}
	return { m2, total: Object.values(m2).reduce((a, b) => a + b, 0) };
}
export const LAND_PERSON = { outdoor: landFor('outdoor'), indoor: landFor('indoor') };

/** raw materials the tower hex grows, a hectare a year */
export const RAW = {
	hemp: { label: 'Hemp', unit: 't straw', per: 10, note: 'Fibre hemp gives 5–12 t/ha of dry straw a year (TFZ Bavaria trial: 11.2 t); ~30% of it is fibre, the rest hurds, plus ~0.7 t seed', src: 'yields' },
	bamboo: { label: 'Bamboo', unit: 't culms', per: 7, note: 'Cold-hardy Phyllostachys in central Europe, grown in (year 6–8 on): about 4–12 t/ha dry a year (no measured European yields: estimate); Moso in Italy 8–20', src: 'yields' },
	woodland: { label: 'Douglas fir and larch', unit: 'm³ wood', per: 15, note: 'Douglas fir grows 18.9 m³/ha a year in Germany (national forest inventory), larch 8–13: a mix about 15', src: 'yields' },
	mine: { label: 'Clay, lime and gravel pits', unit: 't dug', per: 0, note: 'Open pits, no dome over them: only the works that fire and burn what they dig are under glass', src: 'numbers' }
};
/** the utilities' machines, € (sources in SOURCES.equipment). `range` low–high €, `est` an estimate, `was` the price
 * before the cost audit (2026-10-13). The data center is the room's power, cooling and racks, not its accelerators
 * (those are bought one by one: sandbox-9 CHIPS); the shell is the dome's, so a modular fit-out, not a Frankfurt building. */
export const EQUIPMENT = [
	{ label: 'AI data center, 300 kW of IT', eur: 0.3 * 4.0e6, range: [0.3 * 3.0e6, 0.3 * 6.5e6], est: true, was: 0.3 * 10.5e6, note: 'Modular/containerised data centers 4.4–4.6 M$ a MW of IT (AM Compute 2025) ≈ 4 M€ in a shell already built; a hyperscale building in Frankfurt costs 11.6 $/W (Turner & Townsend 2025)' },
	{ label: `Batteries, ${BATTERY_KWH.util / 1000} MWh LFP`, eur: BATTERY_KWH.util * 155, range: [BATTERY_KWH.util * 110, BATTERY_KWH.util * 200], est: true, was: 10000 * 250, insteadOf: INSIDES ? 10000 * 155 : undefined, note: `Turnkey storage systems averaged 177 $/kWh in Europe in 2025 (BNEF), ≈ 155 €/kWh at 1.13 $/€${INSIDES ? '; 2 MWh a dome in packages 2–4 (10 in package 1)' : ''}` },
	// packages 2–4 have no hydrogen: the firm power comes from the geothermal plant and the batteries
	...(INSIDES ? [] : [{ label: 'Fuel cell 500 kW and electrolyser', eur: 2.4e6, range: [1.8e6, 3.2e6], est: true, was: 500 * 3000 * 2, note: 'Electrolysers outside China 1,900–2,500 $/kW installed (IEA 2025 via Argus), PEM ~2,365 €/kW (ACER 2025); a 500 kW electrolyser ~1.1 M€ and a 500 kW stationary fuel cell 1,000–2,000 $/kW ≈ 0.7 M€, tanks and controls ~0.6 M€' }]),
	{ label: 'Water works for 400 people', eur: 400 * 1500, range: [400 * 750, 400 * 2250], note: 'Small membrane bioreactors 800–3,000 €/person, planted wetlands 150–1,000' }
];
/**
 * The machines of each works, € (estimates from used and new listings, cost audit 2026-10-13): the line, its power
 * hook-ups and the moving kit; the building is the Dome120 (packages 1–2) or the hall (hallOf, packages 3–4). `range`
 * low–high €. Before the audit the build-out bought each works at 60 % of a factory's 1,500 €/m² fit-out: 10.2 M€
 * each, 81.4 M€ for eight.
 * @type {Record<string, { eur: number, range: [number, number], est: boolean, note: string }>}
 */
export const WORKS_MACHINES = {
	// packages 2–4 weld the hubs: no furnace or moulds, so the steel works needs no geothermal power (buildout.js NEEDS_GEO)
	steel: INSIDES
		? { eur: 1.5e6, range: [0.8e6, 3.0e6], est: true, note: 'a CNC plasma table for plate to 60 mm, six to eight welding stations with positioners, a CNC drilling and machining centre, a press brake and a 10 t hall crane, used where it can be; certified welders (ISO 9606-1), a welding coordinator and the EN 1090 EXC3 certificate; galvanising bought' }
		: { eur: 1.5e6, range: [0.8e6, 3.0e6], est: true, note: 'a 1–2 t induction furnace (30–80 k$ FOB), sand moulding, a CNC machining centre, a galvanising bath and a press brake, used where it can be' },
	glass: { eur: 2.5e6, range: [1.2e6, 4.0e6], est: true, note: 'a used insulating-glass line 315–325 k€ (machineseeker), a laminating oven (~60 k$) or autoclave (to 3 M$), cutting tables and a cell stringer' },
	timber: { eur: 3.0e6, range: [1.5e6, 5.0e6], est: true, note: 'a sawmill line, a drying kiln on the geothermal heat, a finger-jointing line and a glulam press' },
	hemp: { eur: 2.0e6, range: [1.0e6, 3.5e6], est: true, note: 'a 1 t/h decortication line 1.5–2 M€ (Messe Frankfurt exhibitor, 2024), a 2 t/h decorticator ~330 k$ (HempToday), and a batt line' },
	lime: { eur: 2.0e6, range: [1.0e6, 4.0e6], est: true, note: 'a small electric shaft kiln for ~2,000 t a year, a crusher, a slaker and a mixing plant' },
	clay: { eur: 2.5e6, range: [1.5e6, 5.0e6], est: true, note: 'a block press and extruder, dryers and an electric tunnel kiln for ~3,000 t a year' },
	bamboo: { eur: 1.5e6, range: [0.8e6, 3.0e6], est: true, note: 'crushers, a dryer, resin dosing and a hot press for ~500 t of scrimber a year' },
	recycling: { eur: 1.5e6, range: [0.8e6, 3.0e6], est: true, note: 'a sorting line, a shredder, a composting hall and a small biogas digester' }
};
// ── the works in plain halls (packages 3–4) ─────────────────────────────────────────────────────────────────────

/**
 * The floor each works needs, m², by what stands in it: worked out from its machines (WORKS_MACHINES) and its yearly
 * output (stats.js FACTORY_RUN). Estimates: a works for 500–3,000 t a year is one line, and a small line needs more floor a
 * tonne than a big plant (Mayr-Melnhof's glulam works in Wismar makes 130,000 m³ a year in 43,000 m² of halls, ~3 m³ a
 * m²; ours makes ~2,100 m³). Yards, log and stone stocks and the biogas digester stand outside. `span` is the hall's
 * width north to south (its frames' span), `eaves` its height at the eaves (more where a hall crane runs or a kiln stands).
 * @type {Record<string, { span: number, eaves: number, parts: { label: string, m2: number }[] }>}
 */
export const WORKS_FLOOR = {
	timber: { span: 30, eaves: 8, parts: [
		{ label: 'Sawmill line and its log infeed (the logs wait in the yard)', m2: 600 },
		{ label: 'Two drying kilns on the geothermal heat', m2: 250 },
		{ label: 'Grading, finger-jointing and a glulam press for 12 m beams', m2: 650 },
		{ label: 'Planer and the beam joinery centre that cuts the struts', m2: 350 },
		{ label: 'Lamella, CLT and finished-strut stores', m2: 550 }
	] },
	hemp: { span: 30, eaves: 8, parts: [
		{ label: 'Decortication line, 1 t an hour (its maker’s hall: 50 × 10 m)', m2: 500 },
		{ label: 'Batt line: opener, air-lay and bonding oven', m2: 400 },
		{ label: 'Fibre, hurd and batt stores', m2: 300 },
		{ label: 'Straw bales for half a year: ~1,000 t in 6 m stacks at ~150 kg/m³, with aisles', m2: 1450 }
	] },
	bamboo: { span: 24, eaves: 8, parts: [
		{ label: 'Splitting and crushing the culms', m2: 250 },
		{ label: 'Dryer', m2: 200 },
		{ label: 'Resin dosing and the hot press', m2: 300 },
		{ label: 'Trimming, sanding and the board store', m2: 350 },
		{ label: 'Culm store', m2: 300 }
	] },
	steel: { span: 24, eaves: 9, parts: [
		{ label: 'Plate store under the hall crane', m2: 300 },
		{ label: 'CNC plasma table and its fume extraction', m2: 200 },
		{ label: 'Eight welding bays with positioners', m2: 480 },
		{ label: 'Drilling and machining centre, press brake', m2: 250 },
		{ label: 'Testing, packing and the store of finished hubs', m2: 350 }
	] },
	lime: { span: 24, eaves: 10, parts: [
		{ label: 'Stone store and crusher', m2: 400 },
		{ label: 'Electric shaft kiln (its shaft rises through the roof)', m2: 150 },
		{ label: 'Slaker and hydrate silo', m2: 200 },
		{ label: 'Mortar mixing plant', m2: 250 },
		{ label: 'Bagged lime and mortar store', m2: 400 }
	] },
	clay: { span: 30, eaves: 8, parts: [
		{ label: 'Clay preparation: box feeder, pan mill, mixer', m2: 400 },
		{ label: 'Block press and extruder', m2: 300 },
		{ label: 'Dryers', m2: 500 },
		{ label: 'Electric tunnel kiln, ~45 m, with its cars and tracks', m2: 500 },
		{ label: 'Setting, sorting and the block store', m2: 500 }
	] },
	glass: { span: 30, eaves: 9, parts: [
		{ label: 'Float jumbo sheets (6.0 × 3.21 m) in racks', m2: 400 },
		{ label: 'Cutting table and edge grinding', m2: 350 },
		{ label: 'Laminating line with its oven or autoclave', m2: 450 },
		{ label: 'Cell stringer and the lay-up of the solar panes', m2: 400 },
		{ label: 'Insulating-glass line: washer, spacer, press (~45 m)', m2: 450 },
		{ label: 'Finished panes in racks', m2: 500 }
	] },
	recycling: { span: 24, eaves: 8, parts: [
		{ label: 'Tipping floor and sorting line', m2: 600 },
		{ label: 'Shredder, metal and glass bays', m2: 300 },
		{ label: 'In-vessel composting', m2: 600 },
		{ label: 'Compost and bale store (the biogas digester stands outside)', m2: 300 }
	] }
};
/**
 * How a works hall is built (estimates; SOURCES.halls): spruce glulam portal frames every 6 m, a 10° roof with its ridge
 * east to west so one slope faces south, insulated sandwich panels on the roof and walls, a concrete slab on gravel,
 * solar panels on the south slope.
 *   beam      a duo-pitch glulam beam 0.2 m wide, its mean depth a twentieth of its span (1.5 m over 30 m), under
 *             Munich's snow and the panels; columns 0.2 × 0.6 m; gable posts 0.2 × 0.3 m; bracing +5 %
 *   purlins   m³ of spruce timber (KVH) a m² of roof: 12 × 24 cm every 3 m
 *   connectors  t of steel a m² of floor: column shoes, dowels, bracing rods, the PV rails' hooks
 *   slab      m³ of concrete a m² (20 cm), `mesh` t of welded mesh a m², `gravel` m of gravel under it; `footing` m³
 *             of lime-pozzolan concrete under each column
 *   panelT    t a m² of sandwich panel (two 0.5 mm steel skins and 80–100 mm of PIR)
 *   pv        `fill` of the south slope covered (edges, walkways, fire gaps), glass-glass modules of ~440 W on
 *             ~2 m² (`kwpM2`), `kwhKwp` a year on a 10° south slope in Munich (~994 kWh/kWp on Munich's roofs,
 *             reduco.ai; ~1,150 at the best tilt), `tM2` t a m² of module
 *   heat      kWh a m² a year from the geothermal heat loop at 15 °C inside: ~90 before the machines' and people's
 *             heat (U ~0.22 W/m²K, 0.3 air changes, ~67,000 K·h a year in Munich), about half after; less in the
 *             kiln halls
 *   climate   kWh of power a m² a year for the fans (0.3 air changes of a 10 m high hall, ~1 kW a m³/s, ~3,000 hours):
 *             the halls need no dome climate
 */
export const HALL = {
	bay: 6,
	pitch: 10,
	beam: { b: 0.2, depth: 1 / 20 },
	column: { b: 0.2, d: 0.6 },
	post: { b: 0.2, d: 0.3 },
	bracing: 0.05,
	purlins: 0.0096,
	connectors: 0.003,
	slab: 0.2,
	mesh: 0.015,
	gravel: 0.3,
	footing: 2.25,
	panelT: 0.012,
	pv: { fill: 0.85, kwpM2: 0.22, kwhKwp: 1000, tM2: 0.0125 },
	heat: 50,
	climate: 3,
	est: true
};
/**
 * What a hall's own parts cost, € a unit, net, materials only (the village builds the halls itself): see SOURCES.halls.
 * The frames' purlins are spruce structural timber (PRICES.cassette), the connectors structural steel (PRICES.steel),
 * the slab concrete (PRICES.concrete), the footings lime-pozzolan (PRICES.lime).
 * @type {Record<string, { label: string, unit: string, eur: number, range: string, src: string, est?: boolean }>}
 */
export const HALL_PRICES = {
	glulam: { label: 'Spruce glulam (GL24h) for the halls’ frames', unit: 'm³', eur: 600, range: '555–650', src: 'glulam', est: true },
	roof: { label: 'Sandwich panels for the roofs, 100 mm PIR in steel skins', unit: 'm²', eur: 45, range: '35–60', src: 'halls', est: true },
	wall: { label: 'Sandwich panels for the walls, 80 mm PIR in steel skins', unit: 'm²', eur: 40, range: '30–55', src: 'halls', est: true },
	mesh: { label: 'Welded steel mesh for the slabs', unit: 't', eur: 1000, range: '850–1,300', src: 'halls', est: true },
	gravel: { label: 'Gravel under the slabs', unit: 't', eur: 16, range: '10–22', src: 'lime', est: true },
	edge: { label: 'The membrane under a slab and its edge insulation', unit: 'm² of floor', eur: 8, range: '5–15', src: 'halls', est: true },
	doors: { label: 'Doors, rooflights, gutters and downpipes', unit: 'm² of floor', eur: 20, range: '12–35', src: 'halls', est: true },
	services: { label: 'Services: lighting, power, heating on the heat loop, fans, fire alarm', unit: 'm² of floor', eur: 60, range: '40–100', src: 'halls', est: true },
	pv: { label: 'Solar on the halls’ south roofs: glass-glass modules, inverters, rails, cables', unit: 'kWp', eur: 320, range: '250–450', src: 'halls', est: true }
};

/** @type {Map<string, any>} */
const hallCache = new Map();
/**
 * A works hall (packages 3–4): its size from what the works needs (WORKS_FLOOR), its parts, tonnes and euros, and the
 * solar its south roof makes, the heat and power it uses a year. The hall's long side runs east to west.
 * @param {string} id a works (FACTORIES id)
 */
export function hallOf(id) {
	let h = hallCache.get(id);
	if (h) return h;
	const w = WORKS_FLOOR[id];
	const need = w.parts.reduce((a, p) => a + p.m2, 0);
	const bays = Math.ceil(need / (w.span * HALL.bay));
	const L = bays * HALL.bay, W = w.span, floor = L * W;
	const rise = (W / 2) * Math.tan(HALL.pitch * DEG);
	const slope = W / 2 / Math.cos(HALL.pitch * DEG);
	const roof = 2 * slope * L, south = slope * L;
	const walls = 2 * (L + W) * w.eaves + W * rise;
	const frames = bays + 1, posts = 2 * Math.max(0, Math.round(W / HALL.bay) - 1), columns = 2 * frames + posts;
	const glulam = (frames * (HALL.beam.b * HALL.beam.depth * W * W + 2 * w.eaves * HALL.column.b * HALL.column.d) + posts * (w.eaves + rise / 2) * HALL.post.b * HALL.post.d) * (1 + HALL.bracing);
	const purlins = roof * HALL.purlins;
	const modules = south * HALL.pv.fill, kwp = modules * HALL.pv.kwpM2;
	const m = { glulam, purlins, steel: floor * HALL.connectors, mesh: floor * HALL.mesh, slab: floor * HALL.slab, footing: columns * HALL.footing, gravel: floor * HALL.gravel * 1.8, roof, walls, modules, kwp };
	const P = HALL_PRICES;
	const eur = {
		frame: glulam * P.glulam.eur + purlins * PRICES.cassette.eur + m.steel * PRICES.steel.eur,
		cladding: roof * P.roof.eur + walls * P.wall.eur,
		slab: m.slab * PRICES.concrete.eur + m.mesh * P.mesh.eur + m.gravel * P.gravel.eur + floor * P.edge.eur + m.footing * PRICES.lime.eur,
		kit: floor * (P.doors.eur + P.services.eur),
		pv: kwp * P.pv.eur
	};
	h = {
		id,
		need,
		parts: w.parts,
		span: W,
		length: L,
		bays,
		floor,
		eaves: w.eaves,
		ridge: w.eaves + rise,
		pitch: HALL.pitch,
		south,
		roof,
		walls,
		frames,
		columns,
		m,
		t: { glulam: (glulam + purlins) * DENSITY.clt, steel: m.steel + m.mesh, concrete: m.slab * DENSITY.concrete + m.footing * DENSITY.lime, panels: (roof + walls) * HALL.panelT, modules: modules * HALL.pv.tM2, gravel: m.gravel },
		eur,
		total: Object.values(eur).reduce((a, b) => a + b, 0),
		solar: kwp * HALL.pv.kwhKwp,
		heat: floor * HALL.heat,
		climate: floor * HALL.climate
	};
	hallCache.set(id, h);
	return h;
}
/** a site's hall when the works stand in halls (packages 3–4), else null @param {{ kind: string, factory?: string }} s */
export const siteHall = (s) => (HALLS && s.kind === 'factory120' && s.factory ? hallOf(s.factory) : null);

/**
 * The eight works in Dome120s (packages 1–2) against the eight halls (packages 3–4): the solar they make, the heat and
 * the climate power they need a year, kWh, and their buildings' materials at the prices in use, €.
 */
export function worksCompare() {
	const sh = shellOf(120);
	const n = FACTORIES.length;
	const halls = FACTORIES.map((f) => hallOf(f.id));
	const sum = (/** @type {string} */ k) => halls.reduce((a, h) => a + h[k], 0);
	return {
		domes: { n, floor: n * sh.cap.floor, solar: n * sh.solar, heat: n * sh.heat, climate: n * sh.climate, eur: n * Object.values(sh.eur).reduce((a, b) => a + b, 0) },
		halls: { n, floor: sum('floor'), solar: sum('solar'), heat: sum('heat'), climate: sum('climate'), eur: sum('total'), kwp: halls.reduce((a, h) => a + h.m.kwp, 0) }
	};
}

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
	glulam: { label: 'Glulam and timber', url: 'https://www.holzkurier.com/content/dam/holz/holzkurier/de/web/2025/49/Holzkurier-Preisbilder_11-2025.pdf', note: 'Spruce glulam (BSH) 555–575 €/m³ and KVH 410–430 €/m³ wholesale (Holzkurier price board, Nov 2025); visible-grade glulam ~600+ (timber-online.net 2025/03). CLT ~500 €/m³ and up 50 € in 2025 (timber-online.net 2025/04). Larch value logs fetched 336 €/fm against spruce 200 at a BaySF auction (baysf.de 2019), Douglas 266 €/fm (Niedersachsen 2025): larch/Douglas glulam blanks ~800–1,200 €/m³, 950 used (estimate). Before the cost audit (2026-10-13) the struts were 1,600 €/m³ CNC-cut and supplied; the village now cuts them on a used beam centre (Hundegger K2 listings 55–255 k€, maschinensucher.de). Packages 2–4 take spruce glulam for the struts and the halls’ frames at ~600 €/m³ delivered in lots (555–650, estimate from the price board); its own timber works then saws spruce logs at 84–120 €/m³ (LWK Niedersachsen, May 2025).' },
	steel: { label: 'Steel', url: 'https://www.thetradehub.eu/en/customs/trade/84879051', note: 'EU import unit values for cast-steel parts 4.2–6.0 €/kg (thetradehub.eu, CN 8487); S355 plate 750–850 €/t (eurometal.net 2025); hot-dip galvanising 200–500 €/t (feuerverzinken.com 2021). A steel frame’s cost is 30–40 % material, 30–40 % fabrication, 10–15 % erection (steelconstruction.info): erection taken out. Hubs 6,000 €/t (4,500–9,000, estimate; was 9,000); structural steel fabricated, not erected, 2,300 €/t (estimate; was 3,000 erected). Scrap 292–319 €/t (produktion.de 2026).' },
	glass: { label: 'Glazing', url: 'https://www.aroundhome.de/fenster/preislisten-isolierglas/', note: 'Insulating glass 100–150 €/m² (aroundhome 2025); laminated safety glass adds 35–80 €/m² (clean-invoice.com Glaser price template). Laminated low-iron low-E double ~145 €/m², gaskets, caps and the extra cuts ~45: 190 €/m² (140–250, estimate; was 200). Float comes in jumbo sheets 6.0 × 3.21 m (DIN EN 572-2, baunetzwissen.de): the Dome80 and Dome120 triangles, 3.9–6.1 m high, are each cut into two panes or more.' },
	pv: { label: 'Solar cells in the glass', url: 'https://www.pv-magazine.com/2025/05/09/solar-cell-prices-decline-production-regions-continue-to-diversify/', note: 'TOPCon cells 0.036–0.040 $/W (pv magazine, May 2025); modules ~0.10 €/W (OPIS via pv magazine, March 2025), glass-glass 0.16–0.22 €/Wp (ema-energiewelt.de 2026); glazed BIPV 295–315 €/m² to the end user in 2017 (pvsites.eu). The cells, encapsulant and wiring laid into glazing already paid for: ~100 €/m² from a BIPV maker (50–150, estimate; was 150). The 227 kWh/m² a year the model counts takes ~210 Wp/m² at 1,000–1,150 kWh/kWp in Munich (reduco.ai; PVGIS): full-cover cells, not see-through ones.' },
	hemp: { label: 'Hemp', url: 'https://www.baustoffshop.de/thermo-hanf-combi-jute-dammplatte-1200x625-mm-trockenbau-universaldammplatte.html', note: 'Thermo Hanf batts 13.44 €/m² for 100 mm with VAT (134 €/m³), 166 €/m³ at 40 mm (baustoffshop.de, retail); net of VAT and by the truck ~115 €/m³ (90–140, estimate; was 140). Straw at the farm 100–180 €/t, fibre ~500–1,000 €/t, hurds ~250–450 €/t (older European figures).' },
	lime: { label: 'Lime and concrete', url: 'https://kies-krieger.de/wp-content/uploads/2025/03/TBS-Preisliste-Beton_Stand-01.02.2025.pdf', note: 'Ready-mix C25/30 117–172 €/m³ net delivered (Kies Krieger 02/2025; Heidelberg Materials Pinzl 2026 list). Lime-pozzolan footings 180 €/m³ (140–250, estimate; was 220), LC3 screed 150 €/m³ (120–200, estimate; was 180). Quicklime 120–220 €/t; gravel 10–22 €/t ex works (quarry lists).' },
	land: { label: 'Farmland', url: 'https://statistik.bayern.de/mam/statistik/preise_verdienste/preise/sg35_ab_2021_kaufwerte_für_landwirtschaftliche_grundstücke_langfristige_entwicklung.pdf', note: 'Bavaria: 77,721 €/ha in 2024 (Bavarian statistics office), ~79,000 in 2023; Upper Bavaria ~150,000 €/ha (reduco.ai 2025).' },
	buildings: { label: 'Building costs', url: 'https://www.aksachsen.org/fileadmin/Image_Archive/Berufspolitik/BKI/BKI_Flyer_2025.pdf', note: 'Timber multi-family homes 1,635–2,580 €/m² gross floor, mean 2,190 (BKI 2025, KG 300+400, with 19 % VAT); offices 3,300–5,800. A self-builder’s finishing materials 400–700 €/m² (fertighaus.de, Ausbauhaus). Living space in Germany 49.2 m² a person (Destatis 2024). Offices 14 m² a desk, co-working 12–14.' },
	equipment: { label: 'Machines', url: 'https://www.energy-storage.news/battery-storage-system-prices-continue-to-fall-sharply-bnef-and-ember-reports-find/', note: 'LFP storage turnkey 177 $/kWh in Europe (BNEF 2025) ≈ 155 €/kWh. Modular data centers 4.4–4.6 M$ a MW of IT (amcompute.com 2025); a hyperscale building in Frankfurt 11.6 $/W (Turner & Townsend 2025). Electrolysers outside China 1,900–2,500 $/kW (IEA via Argus 2025), PEM ~2,365 €/kW (ACER); fuel cells 1,000–2,000 $/kW. Small water works 150–3,000 € a person. Works machines: used IG lines 315–325 k€ (machineseeker.com), 1 t/h hemp lines 1.5–2 M€ (Messe Frankfurt 2024), 1–2 t induction furnaces 30–80 k$ (made-in-china.com). EUR/USD 1.13 (2025 average, Bank of Finland).' },
	hubs: { label: 'Hubs welded from plate (packages 2–4)', url: 'https://www.steelconstruction.info/Cost_planning_through_design_stages', note: 'A steelwork contractor’s cost is driven as much by fabrication time as by tonnage: about 20 hours of fabrication cost as much as a tonne of raw steel (SteelConstruction.info, Steel Insight); a frame is 30–40 % material, 30–40 % fabrication, 10–15 % erection. A welded hub is all cuts and welds: ~40 shop hours a t (estimate). S355 heavy plate 750–850 €/t (eurometal.net 2025); hot-dip galvanising 200–500 €/t (feuerverzinken.com). Hubs welded in the village ~2,400 €/t of bought content (plate, galvanising, bolts, wire and gas, power, upkeep: 1,800–3,000, estimate); bought from a fabricator ~4,300 €/t (3,500–6,000, estimate), against cast hubs at 6,000. Welding to EN 1090 execution class 3 needs welders certified to ISO 9606-1, a welding coordinator (ISO 14731) and a certified factory production control.' },
	halls: { label: 'Works halls (packages 3–4)', url: 'https://www.hornbach.at/c/baustoffe/bedachung/sandwichpaneele/S31913/', note: 'Sandwich panels, 100 mm PIR, ~69 € a running metre of 1 m width with VAT in a DIY shop (Hornbach); by the truck net of VAT ~35–60 €/m² for roofs, 30–55 for walls (estimate). Simple system halls cost 80–200 €/m² without foundations and fit-out (hausjournal.net); an insulated production hall with offices over 1,000 €/m² built by a contractor (industrie-fachwissen.de 2026). Ready-mix C25/30 117–172 €/m³ (Kies Krieger 2025). Glulam halls of 20–40 m span are timber engineering’s main use, duo-pitch beams the commonest (KIT). Floor a works needs: a 1 t/h hemp line stands in a 50 × 10 m hall (its maker, Messe Frankfurt 2024); Mayr-Melnhof’s glulam works in Wismar makes 130,000 m³ a year in 43,000 m² of halls (mm-holz.com). Solar: Munich’s roofs give ~994 kWh a kWp a year (reduco.ai); glass-glass modules 0.16–0.22 €/Wp (ema-energiewelt.de 2026); with inverters, rails and cables ~320 €/kWp (estimate; Fraunhofer ISE: 700–2,000 €/kWp built). A hall built of these parts, with its slab, doors and services, costs ~280 €/m² in materials and ~30 more for its solar (estimate; the cost audit took 200–350).' },
	yields: { label: 'Yields', url: 'https://www.tfz.bayern.de', note: 'Hemp straw 5–12 t/ha (TFZ trial 11.2); Douglas fir 18.9 m³/ha a year (BWI); poplar coppice 8–15 t/ha; apples 26–35 t/ha (Destatis); bananas under cover 35–72 t/ha, papaya 30–80; food forests: see FOREST in specs.js (crop yields from orchards and fields, the layers stacked 1.3×: an estimate); bamboo in central Europe is an estimate. Diet: EAT-Lancet Commission 2019, DGE 2024.' },
	power: { label: 'Power price', url: 'https://euenergy.live', note: 'German day-ahead wholesale averaged ~90 €/MWh in 2025; small and mid industry paid ~183 €/MWh (BDEW 2025).' }
};

/** € a person a year of food, at the settlers game's price (10 € a kg) */
export const FOOD_EUR_KG = 10;
