/**
 * SANDBOX 6 · ONE VILLAGE · THE STATS — everything the page shows about a hex, worked out from its plan (./layout.js)
 * and the numbers (./specs.js): its land in hectares and percent, its buildings, the people it houses and employs,
 * what it is built of in tonnes and what that costs at real prices, the food it grows against what its people eat,
 * and the energy it makes and uses; and the whole village's, its seven hexes added up (`villageStats`). Pure
 * functions: the same plan gives the same numbers, in the browser or in node.
 */
import { capHeight, capOf, northCut, NORTH_TILT, ENERGY, EQUIPMENT, FACTORIES, FITOUT, FITOUT_HOME, FLOOR_MATERIALS, DENSITY, DIET_T, KINDS, PRICES, RAW, YIELD, ASSEMBLY, shellOf, towerFloors, towerShell } from './specs.js';
import { HEX_AREA, USES, USE_IDS, landOf, zonesOf } from './layout.js';

/** what each factory makes in a year and the power it takes (estimates: sized to build out a village of ~2,000
 * people over a decade; kWh a t from the settlers game's research where it has them) */
export const FACTORY_RUN = {
	timber: { t: 1000, unit: 't glulam and CLT', kwh: 350, note: 'sawing, pressing, CNC; drying on the geothermal heat' },
	hemp: { t: 2000, unit: 't hemp straw', kwh: 100, note: 'decorticating and pressing batts; the hex grows a part, the rest comes from farms around' },
	bamboo: { t: 500, unit: 't scrimber', kwh: 600, note: 'crushing, drying, resin and hot pressing' },
	steel: { t: 1000, unit: 't steel', kwh: 650, note: 'electric arc furnace on scrap (~400–600 kWh/t) and casting the hubs' },
	lime: { t: 2000, unit: 't quicklime', kwh: 1100, note: 'electric kiln (estimate; burning lime takes ~880 kWh of heat a t in theory)' },
	clay: { t: 3000, unit: 't fired clay', kwh: 500, note: 'the settlers game’s block works: voussoirs for the trade routes' },
	glass: { t: 1000, unit: 't glazing (20,000 m²)', kwh: 300, note: 'laminating and laying the cells; float glass is bought' },
	recycling: { t: 1000, unit: 't waste', kwh: 50, note: 'sorting and composting; biogas makes some of it back' }
};
/** the village center's geothermal plant stands in the tower hex: 3.4 MW net, running 94% of the year */
export const GEOTHERMAL = 3.4e3 * 8760 * 0.94;
/** the tower's own utilities, for the whole village (estimates in the same terms as the utilities dome's) */
export const TOWER_EQUIPMENT = [
	{ label: 'AI data center, 1 MW of IT', eur: 10.5e6, note: '~10.5 M€ a MW of IT (Frankfurt, Turner & Townsend 2025–26)' },
	{ label: 'Batteries, 40 MWh LFP', eur: 40000 * 160, note: 'utility-scale 160 €/kWh (BNEF 2025)' },
	{ label: 'Water works for the tower’s 2,500 guests, workers and residents', eur: 2500 * 1000, note: 'membrane bioreactor and planted wetland, 150–3,000 € a person' },
	{ label: 'Geothermal plant: a well triplet and a 4 MW ORC', eur: 37.5e6, note: '30–45 M€ today (our village energy research)' }
];

/**
 * Everything about a hex.
 * @param {import('./layout.js').HexPlan} plan
 * @param {ReturnType<typeof landOf>} [land]
 */
export function hexStats(plan, land = landOf(plan)) {
	const tower = plan.tower;
	// ── land ──
	const uses = USE_IDS.filter((u) => land.m2[u] > 1).map((u) => ({ id: u, ...USES[u], ha: land.m2[u] / 1e4, pct: (100 * land.m2[u]) / HEX_AREA }));
	const glassHa = uses.filter((u) => u.inside).reduce((a, u) => a + u.ha, 0);

	// ── buildings ──
	/** @type {Map<string, any>} */
	const byKind = new Map();
	for (const s of plan.sites) {
		const K = KINDS[s.kind];
		const row = byKind.get(s.kind) ?? { kind: s.kind, label: K.label, count: 0, note: K.note };
		row.count++;
		byKind.set(s.kind, row);
	}
	const buildings = [...byKind.values()].map((b) => {
		if (b.kind === 'tower' && tower) {
			const sh = towerShell(tower);
			return { ...b, label: tower.label, D: tower.D, h: tower.H, floor: sh.floor, shell: sh.shell, glazed: sh.glazed, north: sh.north, volume: sh.volume, people: 0, solar: sh.solar, heat: sh.heat, climate: sh.climate };
		}
		const K = KINDS[b.kind];
		const sh = shellOf(K.D);
		return { ...b, D: K.D, h: sh.cap.h, floor: sh.cap.floor, shell: sh.cap.shell, glazed: sh.glazed, north: sh.north, volume: sh.cap.volume, people: K.people ?? 0, gfa: K.gfa ?? 0, freq: sh.cap.freq, solar: sh.solar, heat: sh.heat, climate: sh.climate };
	});

	// ── materials and money ──
	/** @type {Record<string, { qty: number, unit: string, t: number, eur: number }>} */
	const mat = {};
	const add = (/** @type {string} */ k, /** @type {string} */ unit, /** @type {number} */ qty, /** @type {number} */ t, /** @type {number} */ eur) => {
		const m = (mat[k] ??= { qty: 0, unit, t: 0, eur: 0 });
		m.qty += qty;
		m.t += t;
		m.eur += eur;
	};
	let fitout = 0, gfaHomes = 0;
	for (const s of plan.sites) {
		const sh = s.kind === 'tower' && tower ? towerShell(tower) : shellOf(KINDS[s.kind].D);
		add('timber', 'm³', sh.m.timber, sh.t.timber, sh.eur.timber);
		add('steel', 't', sh.m.steel, sh.t.steel, sh.eur.steel);
		add('glass', 'm²', sh.m.glass, sh.t.glass, sh.eur.glass);
		add('pv', 'm²', sh.m.pv, 0, sh.eur.pv);
		add('hemp', 'm³', sh.m.hemp, sh.t.hemp, sh.eur.hemp);
		add('lime', 'm³', sh.m.lime, sh.t.lime, sh.eur.lime);
		const K = KINDS[s.kind];
		if (K.gfa) {
			gfaHomes += K.gfa;
			const v = K.gfa * 0.28;
			add('clt', 'm³', v, v * DENSITY.clt, v * PRICES.clt.eur);
			fitout += K.gfa * FITOUT_HOME;
		}
		if (s.kind === 'util120') {
			const built = K.zones.filter((/** @type {any} */ z) => z.block && z.block !== 'water').reduce((/** @type {number} */ a, /** @type {any} */ z) => a + z.m2, 0);
			const v = built * 0.25;
			add('clt', 'm³', v, v * DENSITY.clt, v * PRICES.clt.eur);
			fitout += built * FITOUT.utilities;
		}
		if (s.kind === 'factory120') fitout += capOf(120).floor * FITOUT.factory;
	}
	const floors = tower ? towerFloors(tower) : [];
	for (const f of floors) {
		const long = f.id === 'factory' || f.id === 'deck' || f.id === 'base';
		const v = f.m2 * (long ? FLOOR_MATERIALS.longSpan : FLOOR_MATERIALS.timber);
		add('clt', 'm³', v, v * DENSITY.clt, v * PRICES.clt.eur);
		const sc = f.m2 * FLOOR_MATERIALS.screed;
		add('concrete', 'm³', sc, sc * DENSITY.concrete, sc * PRICES.concrete.eur);
		fitout += f.m2 * (/** @type {Record<string, number>} */ (FITOUT)[f.use] ?? 2500);
	}
	const LABEL = { timber: 'Glulam struts and north cassettes', steel: 'Steel hubs, ring and connectors', glass: 'Laminated double glazing', pv: 'See-through solar cells in it', hemp: 'Hemp-fibre insulation (north side)', lime: 'Lime-pozzolan footings', clt: 'CLT and glulam floors inside', concrete: 'Screed on the floors' };
	const PRICE_OF = { timber: PRICES.glulam, steel: tower && plan.id === 'tower' ? PRICES.hubs : PRICES.hubs, glass: PRICES.glass, pv: PRICES.pv, hemp: PRICES.hemp, lime: PRICES.lime, clt: PRICES.clt, concrete: PRICES.concrete };
	const materials = Object.entries(mat).map(([k, m]) => ({ id: k, label: /** @type {any} */ (LABEL)[k], ...m, price: /** @type {any} */ (PRICE_OF)[k] }));
	const shellEur = materials.filter((m) => m.id !== 'clt' && m.id !== 'concrete').reduce((a, m) => a + m.eur, 0);
	const insideEur = materials.filter((m) => m.id === 'clt' || m.id === 'concrete').reduce((a, m) => a + m.eur, 0);
	const equipment = plan.id === 'living' ? EQUIPMENT : TOWER_EQUIPMENT;
	const equipmentEur = equipment.reduce((a, e) => a + e.eur, 0);
	const landEur = (HEX_AREA / 1e4) * PRICES.land.eur;
	const cost = [
		{ label: 'Shell materials (glulam, steel, glass, solar cells, hemp, footings)', eur: shellEur },
		{ label: `Putting the shells up (+${Math.round(ASSEMBLY * 100)}% of their materials)`, eur: shellEur * ASSEMBLY },
		{ label: 'Building inside: floors, homes, halls, workshops (fit-out, its timber included)', eur: fitout },
		{ label: 'Machines: data center, batteries, hydrogen, water' + (plan.id === 'tower' ? ', geothermal' : ''), eur: equipmentEur },
		{ label: `The land, ${(HEX_AREA / 1e4).toFixed(1)} ha of farmland`, eur: landEur }
	];
	const total = cost.reduce((a, c) => a + c.eur, 0);

	// ── people ──
	const residents = plan.sites.reduce((a, s) => a + (KINDS[s.kind].people ?? 0), 0);
	/** @type {{ label: string, n: number, note: string }[]} */
	const people = [];
	if (plan.id === 'living') {
		const homes = (/** @type {string} */ k) => plan.sites.filter((s) => s.kind === k).length;
		const d40 = KINDS.dome40, d80 = KINDS.dome80;
		people.push({ label: 'Residents', n: residents, note: `${homes('dome40')} × ${d40.people} in Dome40s (a block of ${d40.storeys} storeys), ${homes('dome80')} × ${d80.people} in Dome80s (${d80.storeys}); ${Math.round(gfaHomes / residents)} m² of home each (gross; Germany lives on 49 m² net a head)` });
		people.push({ label: 'Desks in the utilities dome', n: 120, note: 'co-working at ~13 m² a desk, on two storeys' });
	} else {
		const f = Object.fromEntries(floors.map((x) => [x.id, x]));
		// a premium apartment ~250 m² gross (with its share of the core and halls): six to eight a floor low down, fewer
		// as the tower narrows
		const apts = Math.round((f.apartments?.m2 ?? 0) / 250);
		people.push({ label: 'Premium apartments', n: apts, note: `~250 m² gross each over ${f.apartments?.n ?? 0} floors; ~${Math.round(apts * 2.2)} people` });
		people.push({ label: 'Hotel rooms and short stays', n: Math.round((f.hotel?.m2 ?? 0) / 60), note: '60 m² gross a key; ~70% full, ~1.6 guests a room' });
		people.push({ label: 'Desks in offices and co-working', n: Math.round((f.offices?.m2 ?? 0) / 15), note: '15 m² gross a desk (14 m² a desk in DACH offices)' });
		people.push({ label: 'Jobs on the factory floor', n: Math.round((f.factory?.m2 ?? 0) / 150), note: 'one job for ~150 m² of hall' });
		people.push({ label: 'Jobs in the 8 factory domes', n: 8 * 35, note: 'about 35 each, in shifts' });
	}
	const eaters = plan.id === 'living' ? residents : (people[0].n * 2.2 + people[1].n * 0.7 * 1.6);

	// ── food ──
	const t = (/** @type {string} */ u) => ((land.m2[u] ?? 0) / 1e4) * (YIELD[u]?.t ?? 0);
	const deckFood = tower ? (floors.find((f) => f.id === 'deck')?.m2 ?? 0) * 0.4 : 0;
	const food = {
		need: eaters * DIET_T,
		eaters,
		rows: [
			{ label: YIELD.indoorFood.label, ha: (land.m2.indoorFood ?? 0) / 1e4, t: t('indoorFood'), inside: true },
			{ label: YIELD.tropical.label, ha: (land.m2.tropical ?? 0) / 1e4, t: t('tropical'), inside: true },
			...(deckFood ? [{ label: 'Food forest on the tower’s garden deck (40% of it), under the glass', ha: deckFood / 1e4, t: (deckFood / 1e4) * YIELD.tropical.t, inside: true }] : []),
			{ label: YIELD.foodForest.label, ha: (land.m2.foodForest ?? 0) / 1e4, t: t('foodForest'), inside: false }
		].filter((r) => r.ha > 0)
	};
	const grown = food.rows.reduce((a, r) => a + r.t, 0);

	// ── raw materials (the tower hex) ──
	const raw = Object.entries(RAW)
		.filter(([k]) => (land.m2[k] ?? 0) > 0)
		.map(([k, r]) => ({ id: k, ...r, ha: land.m2[k] / 1e4, yearly: (land.m2[k] / 1e4) * r.per }));

	// ── energy, kWh a year ──
	let solar = 0, climate = 0, heat = 0;
	for (const b of buildings) {
		solar += b.count * b.solar;
		climate += b.count * b.climate;
		heat += b.count * b.heat;
	}
	/** @type {{ label: string, kwh: number }[]} */
	const makes = [{ label: 'Solar panels, every second glass panel (see-through cells)', kwh: solar }];
	/** @type {{ label: string, kwh: number }[]} */
	const uses2 = [{ label: 'The domes’ climate: fans, pumps, vents', kwh: climate }];
	if (plan.id === 'living') {
		uses2.push({ label: `${residents} people at home (900 kWh each, sharing a dome)`, kwh: residents * ENERGY.person });
		uses2.push({ label: 'AI data center, 300 kW of IT (PUE 1.2)', kwh: ENERGY.datacenter });
		const blocks = KINDS.util120.zones.filter((/** @type {any} */ z) => z.block === 'workshop' || z.block === 'office' || z.block === 'store').reduce((/** @type {number} */ a, /** @type {any} */ z) => a + z.m2, 0);
		uses2.push({ label: 'Workshops, workspaces, stores', kwh: blocks * ENERGY.workshop });
		uses2.push({ label: 'Cleaning the water', kwh: residents * ENERGY.water });
	} else {
		makes.push({ label: 'The village’s geothermal plant: 3.4 MW net, 94% of the year', kwh: GEOTHERMAL });
		for (const f of floors) uses2.push({ label: `Tower: ${f.label.toLowerCase()}`, kwh: f.m2 * (/** @type {Record<string, number>} */ (ENERGY.tower)[f.use] ?? 100) });
		for (const fa of FACTORIES) {
			const r = /** @type {Record<string, any>} */ (FACTORY_RUN)[fa.id];
			uses2.push({ label: `${fa.label}: ${r.t.toLocaleString('en-US')} ${r.unit} a year × ${r.kwh} kWh`, kwh: r.t * r.kwh });
		}
	}
	const made = makes.reduce((a, m) => a + m.kwh, 0), used = uses2.reduce((a, m) => a + m.kwh, 0);
	const energy = {
		makes,
		uses: uses2,
		made,
		used,
		net: made - used,
		heat,
		heatFrom: plan.id === 'living' ? [{ label: 'The data center’s waste heat (~85% of its power, at ~45 °C)', kwh: ENERGY.datacenterHeat }] : [{ label: 'The geothermal heat loop: 12.6 MW at 90→60 °C (~104 GWh a year)', kwh: 104e6 }]
	};

	return { hexHa: HEX_AREA / 1e4, uses, glassHa, buildings, materials, cost, total, equipment, people, residents, food: { ...food, grown }, raw, energy, floors, tower, factoryRun: FACTORY_RUN };
}

/**
 * The whole village: its hexes' numbers added up, each hex counted as often as it stands (the six living hexes are
 * alike). Rows with the same label add up; the hexes' own rows (`hexes`) say what each brings.
 * @param {{ key: string, label: string, n: number, stats: ReturnType<typeof hexStats> }[]} parts
 */
export function villageStats(parts) {
	const n1 = (/** @type {number} */ x) => (Math.round(x * 10) / 10).toLocaleString('en-US');
	/** add up rows of a list by a key, summing the number fields @template {Record<string, any>} R @param {(s: ReturnType<typeof hexStats>) => R[]} rows @param {string} key @param {string[]} fields @returns {R[]} */
	const merge = (rows, key, fields) => {
		/** @type {Map<string, any>} */
		const m = new Map();
		for (const p of parts)
			for (const r of rows(p.stats)) {
				const row = m.get(r[key]) ?? { ...r, ...Object.fromEntries(fields.map((f) => [f, 0])) };
				for (const f of fields) row[f] += (r[f] ?? 0) * p.n;
				m.set(r[key], row);
			}
		return [...m.values()];
	};
	const hexHa = parts.reduce((a, p) => a + p.n * p.stats.hexHa, 0);
	const uses = merge((s) => s.uses, 'id', ['ha']).map((u) => ({ ...u, pct: (100 * u.ha) / hexHa }));
	const order = Object.keys(USES);
	uses.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
	// the hexes' costs come in the same five rows
	const cost = ['Shell materials (glulam, steel, glass, solar cells, hemp, footings)', parts[0].stats.cost[1].label, 'Building inside: floors, homes, halls, workshops (fit-out, its timber included)', 'Machines: data centers, batteries, hydrogen, water, geothermal', `The land, ${n1(hexHa)} ha of farmland`].map((label, k) => ({ label, eur: parts.reduce((a, p) => a + p.n * p.stats.cost[k].eur, 0) }));
	const total = cost.reduce((a, c) => a + c.eur, 0);
	const tower = parts.find((p) => p.stats.tower)?.stats;
	const living = parts.filter((p) => !p.stats.tower);
	const residents = parts.reduce((a, p) => a + p.n * p.stats.residents, 0);
	const towerPeople = tower ? tower.people : [];
	const aptPeople = tower ? Math.round(tower.people[0].n * 2.2) : 0;
	/** @type {{ label: string, n: number, note: string }[]} */
	const people = [
		{ label: 'Residents in the living hexes’ domes', n: residents, note: living.map((p) => `${p.n} hexes × ${p.stats.residents}`).join(', ') + ', in the blocks of Dome40 and Dome80 homes' },
		{ label: 'Residents in the tower’s apartments', n: aptPeople, note: `${tower?.people[0].n ?? 0} premium apartments, ~2.2 people each` },
		{ label: 'Everyone living in the village', n: residents + aptPeople, note: 'plus the hotel’s guests' },
		{ label: 'Desks in the living hexes’ utilities domes', n: living.reduce((a, p) => a + p.n * (p.stats.people[1]?.n ?? 0), 0), note: `${living.reduce((a, p) => a + p.n, 0)} utilities domes, co-working` },
		...towerPeople.slice(1)
	];
	const foodRows = merge((s) => s.food.rows, 'label', ['ha', 't']);
	const need = parts.reduce((a, p) => a + p.n * p.stats.food.need, 0);
	const food = { rows: foodRows, need, eaters: parts.reduce((a, p) => a + p.n * p.stats.food.eaters, 0), grown: foodRows.reduce((a, r) => a + r.t, 0) };
	const makes = merge((s) => s.energy.makes, 'label', ['kwh']), used = merge((s) => s.energy.uses, 'label', ['kwh']);
	const made = makes.reduce((a, m) => a + m.kwh, 0), usedKwh = used.reduce((a, m) => a + m.kwh, 0);
	return {
		hexHa,
		uses,
		glassHa: uses.filter((u) => u.inside).reduce((a, u) => a + u.ha, 0),
		buildings: merge((s) => s.buildings, 'kind', ['count']),
		materials: merge((s) => s.materials, 'id', ['qty', 't', 'eur']),
		cost,
		total,
		equipment: merge((s) => s.equipment.map((e) => ({ ...e, n: 1 })), 'label', ['eur', 'n']).map((e) => ({ ...e, label: e.n > 1 ? `${e.n} × ${e.label}` : e.label })),
		people,
		residents: residents + aptPeople,
		food,
		raw: tower?.raw ?? [],
		energy: { makes, uses: used, made, used: usedKwh, net: made - usedKwh, heat: parts.reduce((a, p) => a + p.n * p.stats.energy.heat, 0), heatFrom: merge((s) => s.energy.heatFrom, 'label', ['kwh']) },
		floors: tower?.floors ?? [],
		tower: tower?.tower,
		factoryRun: FACTORY_RUN,
		hexes: parts.map((p) => ({ key: p.key, label: p.label, n: p.n, residents: p.stats.residents, total: p.stats.total, grown: p.stats.food.grown, need: p.stats.food.need, net: p.stats.energy.net }))
	};
}

/** where the hemp starts on the shell due north of a dome's middle (the flat cut, leaning north, meets the shell), m */
function hempFoot(/** @type {import('./specs.js').Cap} */ c) {
	const k = northCut(c.a), tan = Math.tan((NORTH_TILT * Math.PI) / 180);
	let lo = 0, hi = c.a;
	for (let i = 0; i < 40; i++) {
		const x = (lo + hi) / 2;
		if (x < k + capHeight(c, x) * tan) lo = x;
		else hi = x;
	}
	return lo;
}

/**
 * One building's card: its size, its geodesic grid, what its floor is used for, what it is built of and costs.
 * @param {import('./layout.js').HexPlan} plan @param {string} id
 */
export function siteCard(plan, id) {
	const site = plan.sites.find((s) => s.id === id);
	if (!site) return null;
	const K = KINDS[site.kind];
	if (site.kind === 'tower' && plan.tower) {
		const T = plan.tower;
		const sh = towerShell(T);
		const floors = towerFloors(T);
		const eur = Object.values(sh.eur).reduce((a, b) => a + b, 0);
		return {
			kind: site.kind,
			title: T.label,
			note: K.note,
			facts: [
				['Across the foot', `${T.D} m`],
				['Height', `${T.H} m`],
				['Floor at the foot', `${(sh.floor / 1e4).toFixed(2)} ha`],
				['Shell', `${Math.round(sh.shell).toLocaleString('en-US')} m²`],
				['Panels', `${sh.grid.panels.length.toLocaleString('en-US')} on a diagrid of ${sh.grid.struts.toLocaleString('en-US')} struts and ${sh.grid.hubs.toLocaleString('en-US')} hubs: ${sh.grid.count.solar.toLocaleString('en-US')} solar (${Math.round(sh.grid.m2.solar).toLocaleString('en-US')} m²), ${sh.grid.count.glass.toLocaleString('en-US')} glass (${Math.round(sh.grid.m2.glass).toLocaleString('en-US')} m²), ${sh.grid.count.hemp} white hemp to the north (${Math.round(sh.grid.m2.hemp).toLocaleString('en-US')} m²)`],
				['Air inside', `${(sh.volume / 1e6).toFixed(2)} million m³`],
				['Floors', `${floors.reduce((a, f) => a + (f.id === 'deck' ? 0 : f.n), 0)} storeys, ${Math.round(floors.reduce((a, f) => a + f.m2, 0)).toLocaleString('en-US')} m² with the deck`]
			],
			zones: floors.map((f) => ({ use: f.use, label: f.label, m2: f.m2, note: `${f.n > 1 ? `${f.n} floors, ` : ''}${f.y < 0 ? 'below ground' : f.h ? `${f.y}–${f.top} m` : `at ${f.y} m`} · ${f.note}` })),
			shell: sh,
			eur,
			floors
		};
	}
	const sh = shellOf(K.D);
	const c = sh.cap;
	const geo = sh.geodesic;
	const n = (/** @type {number} */ x) => Math.round(x).toLocaleString('en-US');
	const fa = FACTORIES.find((f) => f.id === site.factory);
	const run = fa ? /** @type {Record<string, any>} */ (FACTORY_RUN)[fa.id] : null;
	return {
		kind: site.kind,
		title: fa ? fa.label : K.label,
		note: fa ? fa.makes : K.note,
		facts: [
			['Across', `${K.D} m`],
			['Height', `${c.h.toFixed(1)} m (a cap of a ${c.R.toFixed(1)} m sphere)`],
			['Floor', `${Math.round(c.floor).toLocaleString('en-US')} m²`],
			['Shell', `${n(c.shell)} m²`],
			['Panels', `${n(geo.panels.length)}: ${n(geo.count.solar)} solar (${n(geo.m2.solar)} m²), ${n(geo.count.glass)} glass (${n(geo.m2.glass)} m²), ${n(geo.count.hemp)} white hemp to the north (${n(geo.m2.hemp)} m²); a panel ~${(geo.m2.glass / geo.count.glass).toFixed(1)} m²`],
			['Geodesic grid', `frequency ${c.freq}: ${n(geo.struts)} struts, ${geo.lengths.length} lengths from ${geo.lengths[0].m.toFixed(2)} to ${geo.lengths[geo.lengths.length - 1].m.toFixed(2)} m (${geo.trimmed} trimmed at the foot), ${n(geo.hubs)} steel hubs (${geo.ringHubs} on the foot ring)`],
			['Air inside', `${Math.round(c.volume).toLocaleString('en-US')} m³`],
			...(K.people ? [['People', `${K.people}, ${Math.round(K.gfa / K.people)} m² of home each (${n(K.gfa)} m² on ${K.storeys} storeys)`], ['The block', `${K.block.depth} m deep, its front ${K.block.front} m north of the middle; ${K.levels.map((/** @type {any} */ l) => `${Math.round(2 * l.half)} m`).join(', ')} long from the ground up; ${n(K.balconies)} m² of small balconies on the south face; ${K.block.height} m to the top roof`]] : []),
			...(run ? [['Makes', `${run.t.toLocaleString('en-US')} ${run.unit} a year, ${run.kwh} kWh a t (${run.note})`]] : [])
		],
		zones: zonesOf(site, plan).map((/** @type {any} */ z) => ({ use: z.use, label: z.label, m2: z.m2 })),
		block: K.block ? { ...K.block, levels: K.levels } : null,
		cap: c,
		cut: hempFoot(c),
		shell: sh,
		eur: Object.values(sh.eur).reduce((a, b) => a + b, 0)
	};
}
