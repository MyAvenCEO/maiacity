/**
 * SANDBOX 6 · ONE HEX · THE NUMBERS — every dome and the tower at their real size, what they are built of in tonnes,
 * what that costs at real prices, and what goes on inside them. One source of truth: the 3D world (./scene.js), the
 * land-use map (./layout.js) and every panel on the page (./HexPlan.svelte) read their numbers from here.
 *
 * Units: metres, m², m³, tonnes, € (2025/26 prices, Germany where we could find them), kWh. Every constant says
 * where it comes from: our own research (the project files: sandbox-6/numbers.md, energy/village-energy.md, the dome
 * engineering thread) or a market source, or "assumed" with the reasoning. ./SOURCES lists them for the page.
 *
 * The domes are glazed geodesic caps, all of one shape: a cap a third as high as it is wide, as the 150 m dome the
 * dome engineering research settled on (50 m high, sphere radius 81.25 m, frequency 16, ~6 m glulam struts, steel
 * hubs, laminated glass, a hemp-fibre north shell, a 3 m fish pond at ground level along the north). The smaller
 * domes are the same cap scaled down, their struts kept about 6 m long.
 */

/** @typedef {{ D: number, a: number, h: number, R: number, floor: number, shell: number, volume: number, perimeter: number, freq: number }} Cap */

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
		// struts about 6 m long: the 150 m cap is frequency 16 (2,390 struts, 826 hubs)
		freq: Math.max(4, Math.round((16 * D) / 150))
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
 * on a stone plinth instead of glass and solar, holding the heat in. It runs north-west to north-east (120°) from the
 * ground up to a level line at three quarters of a dome's height, so the crown, the east, the south and the west stay
 * glass and take the sun all day; on the tower it stops where the apartments start, at about a third of its height.
 */
export const NORTH_HALF = 60;
/** how high the hemp reaches: a dome's level line, as a share of its height */
export const NORTH_UP = 0.75;
/** and the tower's */
export const TOWER_NORTH_UP = 0.35;
/**
 * The share of a shell of revolution (profile [radius, height] from the foot up or the crown down) that the north
 * band covers, up to height Y.
 * @param {[number, number][]} p
 * @param {number} Y
 */
export function northShare(p, Y) {
	let all = 0, north = 0;
	for (let k = 1; k < p.length; k++) {
		const [r0, y0] = p[k - 1], [r1, y1] = p[k];
		const a = (r0 + r1) * Math.hypot(r1 - r0, y1 - y0);
		all += a;
		if ((y0 + y1) / 2 <= Y) north += (a * NORTH_HALF) / 180;
	}
	return north / all;
}
/** a dome's cap as a profile from its crown to its foot */
export function capProfile(/** @type {number} */ D, n = 400) {
	const c = capOf(D);
	const theta = Math.acos((c.R - c.h) / c.R);
	/** @type {[number, number][]} */
	const p = [];
	for (let k = 0; k <= n; k++) p.push([c.R * Math.sin((theta * k) / n), c.R * Math.cos((theta * k) / n) - (c.R - c.h)]);
	return p;
}
/** the share of every dome's shell in hemp: the caps are all alike, so one number (a quarter) */
export const NORTH = northShare(capProfile(150), NORTH_UP * capOf(150).h);
/**
 * Each dome as the engineering thread sized it (/mnt/project-files/dome-research/dome-sizes.json, 2026-10-08), mid
 * values: the glulam frame, the cast-steel hubs plus the steel ring at the foot, and the heat the dome needs beyond its
 * fish pond (from the groundwater loop) and its climate power (pumps, fans), kWh a year, both for the north third
 * closed to the crown.
 */
const SIZED = {
	50: { timber: 80, steel: 19 + 2.2, heat: 0.02e6, climate: 0.013e6 },
	100: { timber: 565, steel: 128 + 17.5, heat: 0.11e6, climate: 0.057e6 },
	150: { timber: 2300, steel: 405 + 60, heat: 0.38e6, climate: 0.149e6 }
};
/** a size the thread did not size scales from the nearest: the frame with the 2.5th power, heat and climate by shell */
function sized(/** @type {number} */ D) {
	const near = /** @type {50 | 100 | 150} */ ([50, 100, 150].reduce((a, b) => (Math.abs(b - D) < Math.abs(a - D) ? b : a)));
	const r = SIZED[near], k = Math.pow(D / near, 2.5), s = capOf(D).shell / capOf(near).shell;
	return { timber: r.timber * k, steel: r.steel * k, heat: r.heat * s, climate: r.climate * s };
}
/**
 * Ours close less than the thread's third (a quarter, low on the north): its Dome150 run of that case needs 1.8 GWh of
 * heat instead of 1.65 and 0.165 GWh of climate power instead of 0.149
 */
const BAND = { heat: 1.8 / 1.65, climate: 0.165 / 0.149 };
/** hemp fibre 30–35 cm thick (U 0.15), in timber cassettes of ~6 cm of timber a m² (the thread: 511 m³ in 8,509 m²) */
const HEMP_M = 0.325;
const CASSETTE_M = 0.06;
/**
 * Solar cells sit in every second pane of the flatter glass, tilted under 45° (on the towers in every second pane
 * everywhere): the plants need the rest of the daylight. A m² of cells makes 227 kWh a year on a cap and 194 on a
 * tower's steeper glass (the thread's hourly Munich year: 0.92 GWh from 4,036 m², 6.63 GWh from 34,133 m²).
 */
export const CELLS = { share: 0.5, steepest: 45, capKwh: 227, towerKwh: 194 };
/** a dome's glass tilted under 45°, m²: the glass crown above the hemp's line, and the south two thirds down to 45° */
function flatGlass(/** @type {number} */ D) {
	const c = capOf(D);
	const zone = (/** @type {number} */ a, /** @type {number} */ b) => 2 * Math.PI * c.R * c.R * (Math.cos(a) - Math.cos(b));
	const line = Math.acos((NORTH_UP * c.h + c.R - c.h) / c.R), steep = (CELLS.steepest * Math.PI) / 180;
	return line >= steep ? zone(0, steep) : zone(0, line) + zone(line, steep) * (1 - NORTH_HALF / 180);
}

/**
 * What a dome's shell is built of: the frame as the engineering thread sized it, glass and hemp by the m², the
 * footing by its rim; and what it makes and needs a year.
 * @param {number} D
 */
export function shellOf(D) {
	const c = capOf(D);
	const z = sized(D);
	const glazed = c.shell * (1 - NORTH);
	const north = c.shell * NORTH;
	// a ring footing of lime-pozzolan concrete under the plinth, 0.8 m² (50 m) to 1.2 m² (150 m) in section
	const footing = c.perimeter * (0.6 + 0.004 * D);
	const m = {
		timber: z.timber + north * CASSETTE_M, // the struts, and the north shell's timber cassettes
		steel: z.steel,
		glass: glazed,
		pv: flatGlass(D) * CELLS.share,
		hemp: north * HEMP_M,
		lime: footing
	};
	return {
		cap: c,
		glazed,
		north,
		m,
		solar: m.pv * CELLS.capKwh,
		heat: z.heat * BAND.heat,
		climate: z.climate * BAND.climate,
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
 * A home dome: the homes in a crescent of galleries along the north, under the hemp shell (two storeys, their windows
 * looking south into the garden); in front of them the fish pond (the heat store), and the rest of the floor a food
 * garden under the glass, with its paths.
 * @param {number} D @param {number} people @param {{ depth: number, edge: number, pond: number }} o
 *   depth: how deep the galleries are; edge: how far in from the glass they stand (so the upper storey has headroom);
 *   pond: how wide the pond is
 */
function homeDome(D, people, o) {
	const c = capOf(D);
	const rOut = c.a - o.edge, rIn = rOut - o.depth;
	const living = (Math.PI * (rOut * rOut - rIn * rIn)) / 2;
	const pondIn = rIn - o.pond;
	const pond = (Math.PI * (rIn * rIn - pondIn * pondIn)) / 2;
	const paths = c.floor * 0.1;
	const storeys = 2;
	return {
		people,
		storeys,
		gallery: { rOut, rIn, pondIn, headroom: capHeight(c, rOut) },
		gfa: living * storeys,
		zones: [
			{ use: 'living', label: 'Homes (a crescent of galleries, 2 storeys)', m2: living },
			{ use: 'pond', label: 'Fish pond, the heat store', m2: pond },
			{ use: 'indoorFood', label: 'Food garden under the glass', m2: c.floor - living - pond - paths },
			{ use: 'commons', label: 'Paths, terraces and commons', m2: paths }
		]
	};
}

/** the 150 m dome's pond, from the climate model: 105 m long, up to 21 m in, ~1,550 m², 4,700 m³ */
const POND_150 = 1550;

/**
 * The domes and the tower, by kind. `role` says what the land-use map paints them as; `zones` split their floor.
 * @type {Record<string, any>}
 */
export const KINDS = {
	dome50: { label: 'Dome50', D: 50, role: 'home', note: 'Home of 12, with its own food garden', ...homeDome(50, 12, { depth: 7, edge: 4, pond: 4 }) },
	dome100: { label: 'Dome100', D: 100, role: 'home', note: 'Home of 36, with its own food garden', ...homeDome(100, 36, { depth: 9, edge: 6, pond: 6 }) },
	food150: {
		label: 'Dome150 · Food',
		D: 150,
		role: 'food',
		note: 'A tropical food forest at 24 °C, no one lives here',
		people: 0,
		zones: [
			{ use: 'tropical', label: 'Tropical food forest (banana, papaya, jackfruit, citrus, cacao, coffee below)', m2: capOf(150).floor - POND_150 - 1400 - 450 },
			{ use: 'pond', label: 'Fish pond, the heat store', m2: POND_150 },
			{ use: 'commons', label: 'Paths and the visitors’ walk', m2: 1400 },
			{ use: 'utilities', label: 'Packing, cold store and nursery (under the north shell)', m2: 450 }
		]
	},
	util150: {
		label: 'Dome150 · Utilities',
		D: 150,
		role: 'utilities',
		note: 'The settlement’s utilities, workshops and workspaces',
		people: 0,
		zones: [
			{ use: 'utilities', label: 'AI data center, 300 kW of computers (its heat warms the domes)', m2: 700, block: 'datacenter' },
			{ use: 'utilities', label: 'Batteries, 10 MWh LFP in 3 containers', m2: 250, block: 'battery' },
			{ use: 'utilities', label: 'Hydrogen: electrolyser, tanks and a 500 kW fuel cell', m2: 450, block: 'hydrogen' },
			{ use: 'utilities', label: 'Water: membrane bioreactor and a planted wetland that cleans it', m2: 1800, block: 'water' },
			{ use: 'utilities', label: 'Prototyping workshops: fab lab, CNC, 3D printers', m2: 2400, block: 'workshop' },
			{ use: 'utilities', label: 'Workspaces and co-working (a 2-storey crescent, 150 desks)', m2: 1100, block: 'office' },
			{ use: 'utilities', label: 'Stores and the parcel hub', m2: 900, block: 'store' },
			{ use: 'pond', label: 'Fish pond, the heat store', m2: POND_150 },
			{ use: 'indoorFood', label: 'Gardens between them', m2: 0 },
			{ use: 'commons', label: 'Paths, plaza and loading', m2: 2200 }
		]
	},
	factory100: { label: 'Dome100 · Factory', D: 100, role: 'factory', note: 'Turns the hex’s raw materials into building materials', people: 0 },
	tower250: { label: 'Tower250', D: 250, role: 'tower', note: 'The village’s one factory building, its utilities, offices, homes and halls', people: 0 }
};
// the utilities dome's gardens: what is left of its floor
{
	const z = KINDS.util150.zones;
	z.find((/** @type {any} */ q) => q.use === 'indoorFood').m2 = capOf(150).floor - z.reduce((/** @type {number} */ s, /** @type {any} */ q) => s + q.m2, 0);
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
 * that sweeps in to a slender tower, rounded at the top). Tower250 is 250 m across and 275 m tall; the dome tower
 * research (2026-10-08) found it buildable in principle from the same glulam, steel joints and glass: a 20 m drum, a
 * steel tension ring at the knee, a 3 m deep double-layer glulam lattice up to 125 m, then a single-layer diagrid
 * tube. Tower200 (Samuel, 2026-10-08) is the same shape at four fifths: 200 m across, 220 m tall.
 * @typedef {{ id: string, label: string, D: number, H: number, top: number, stack: number, timber: number, steel: number, heat: number, climate: number }} Tower
 */
/** @type {Record<string, Tower>} */
export const TOWERS = {
	// the engineering thread's mid values (dome-sizes.json): glulam frame, hubs plus ring steel, heat beyond the pond and
	// climate power a year
	t250: { id: 't250', label: 'Tower250', D: 250, H: 275, top: (125 * 0.3) / 1.6, stack: 30, timber: 11900, steel: 2950 + 425, heat: 5.19e6, climate: 1.116e6 },
	t200: { id: 't200', label: 'Tower200', D: 200, H: 220, top: (100 * 0.3) / 1.6, stack: 26, timber: 6350, steel: 1485 + 215, heat: 2.81e6, climate: 0.622e6 }
};

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
 * A tower's shell, as the engineering thread sized it (Tower250: glulam 10,200–13,600 m³, hubs 1,570–4,330 t, ring
 * 350–500 t; mid values), its cold north side closed in hemp: the glass and the hemp by the m².
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
	const north = shell * northShare(p, TOWER_NORTH_UP * T.H);
	const glazed = shell - north;
	const m = { timber: T.timber + north * CASSETTE_M, steel: T.steel, glass: glazed, pv: glazed * CELLS.share, hemp: north * HEMP_M, lime: Math.PI * T.D * 4 };
	return {
		shell,
		volume,
		floor: Math.PI * R * R,
		glazed,
		north,
		m,
		solar: m.pv * CELLS.towerKwh,
		heat: T.heat * BAND.heat,
		climate: T.climate * BAND.climate,
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
	indoorFood: { t: 40, label: 'Food garden under glass at 24 °C: vegetables, greens, herbs and dwarf fruit all year (soil-grown greenhouse vegetables give 50–150 t/ha, tomatoes 120–300); a garden with trees in it, so about 40', src: 'yields' },
	tropical: { t: 25, label: 'Tropical food forest under glass: mixed tropical food forests give 10–40 t/ha, bananas under cover 35–72, papaya 30–80', src: 'yields' },
	foodForest: { t: 8, label: 'Temperate food forest outdoors, grown: 1–15 t/ha (young Dutch food forests ~1 t/ha; the settlers game’s year 15 is 7.3)', src: 'yields' },
	commercial: { t: 30, label: 'Commercial orchards and market gardens outdoors: German apples averaged 26–35 t/ha in 2024–25, intensive 40–60', src: 'yields' }
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
	climate: { label: 'The engineering thread’s per-size model (dome-research/dome-sizes.md, 2026-10-08)', note: 'Hourly Munich year at 24 °C. Frame, hubs and ring for Dome50/100/150 and Tower200/250; heat beyond the pond 0.02/0.11/0.38 GWh and 2.81/5.19 GWh, climate power 0.013/0.057/0.149 and 0.62/1.12 GWh, for the north third closed to the crown; a quarter closed low on the north needs ~9% more heat and makes ~34% more solar. Cells in every second pane of glass tilted under 45° (towers: all glass), 227 kWh/m² a year on caps, 194 on towers. People, factories and offices are not counted as heat sources.' },
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
