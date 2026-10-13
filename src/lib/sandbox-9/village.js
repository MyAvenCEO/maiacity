// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE VILLAGE — the world's buildings, land and founding bill, read from Sandbox 6's village design
 * (src/lib/sandbox-7: specs.js, layout.js, stats.js), never copied: six living hexes round a centre hex.
 *
 * A living hex: 5 Dome80 homes of 40 and 9 Dome40 homes of 10 (290 beds), two Dome120 food domes (the food forest
 * under glass), one Dome120 utilities dome (data centre, batteries, water works, workshops, workspaces), its outdoor
 * food forest, nature and roads. The centre hex: eight Dome120 factories (timber, bamboo, hemp, recycling, glass,
 * clay, lime, steel), the fields, woods and pits, and the village's geothermal plant. Without the tower (the default,
 * Samuel 2026-10-13: the tower is too expensive to take for granted) the middle of the centre hex holds one more
 * Dome120 of utilities and community halls; with it, the Tower180 stands there at its real cost.
 *
 * The engine models the village as plants (./genesis.js seedPlants): the home domes are the HOME COOPs' beds, the
 * food domes the GREEN COOP's growing dome, the dome cells the SOLAR COOP's, the factory domes the works'. The halls
 * that make nothing the engine sells (the utilities domes, the hemp, recycling, clay and lime factories, the centre
 * dome or the tower) are kept up with the homes: their glulam, steel and glass and their climate are counted a bed.
 * Hemp insulation and lime footings are in the founding bill only (the engine has no hemp or lime good).
 *
 * Pure functions, cached: the same settings give the same numbers in the browser and in node.
 */
import { LIVING, TOWER_HEX, HEX_AREA } from '../sandbox-7/layout.js';
import { hexStats, FACTORY_RUN, GEOTHERMAL, TOWER_EQUIPMENT } from '../sandbox-7/stats.js';
import { KINDS, shellOf, towerShell, towerFloors, DENSITY, PRICES, EQUIPMENT, ENERGY as E7, DAY, LAND_PERSON, SOURCES, FLOOR_MATERIALS, ASSEMBLY } from '../sandbox-7/specs.js';

const cache = new Map();

/** the centre hex's plan: the tower's site holds a Dome120 of utilities and halls instead (no tower) */
function centrePlan(tower) {
	if (tower) return TOWER_HEX;
	return { ...TOWER_HEX, sites: TOWER_HEX.sites.map((s) => (s.kind === 'tower' ? { ...s, kind: 'util120', id: 'centre', name: 'Centre: utilities and community halls' } : s)), tower: undefined };
}

/** a building's materials, t (glulam, steel, glass, hemp, lime; the CLT floors inside counted with the glulam), its
 * solar cells (m²) and its yearly climate electricity, heat and solar harvest, kWh */
function siteParts(site, plan) {
	if (site.kind === 'tower' && plan.tower) {
		const sh = towerShell(plan.tower);
		const out = { n: 1, wood: sh.t.timber, steel: sh.t.steel, glass: sh.t.glass, hemp: sh.t.hemp ?? 0, lime: sh.t.lime ?? 0, concrete: 0, pvM2: sh.m.pv ?? 0, climate: sh.climate, heat: sh.heat, solar: sh.solar, gfa: 0 };
		for (const f of towerFloors(plan.tower)) {
			const long = f.id === 'factory' || f.id === 'deck' || f.id === 'base';
			out.wood += f.m2 * (long ? FLOOR_MATERIALS.longSpan : FLOOR_MATERIALS.timber) * DENSITY.clt;
			out.concrete += f.m2 * FLOOR_MATERIALS.screed * DENSITY.concrete;
			out.climate += f.m2 * (E7.tower[f.use] ?? 100);
		}
		return out;
	}
	const K = KINDS[site.kind];
	const sh = shellOf(K.D);
	const out = { n: 1, wood: sh.t.timber, steel: sh.t.steel, glass: sh.t.glass, hemp: sh.t.hemp, lime: sh.t.lime, concrete: 0, pvM2: sh.m.pv, climate: sh.climate, heat: sh.heat, solar: sh.solar, gfa: K.gfa ?? 0 };
	if (K.gfa) out.wood += K.gfa * 0.28 * DENSITY.clt;
	if (site.kind === 'util120') out.wood += K.zones.filter((z) => z.block && z.block !== 'water').reduce((a, z) => a + z.m2, 0) * 0.25 * DENSITY.clt;
	return out;
}
const PARTS = ['n', 'wood', 'steel', 'glass', 'hemp', 'lime', 'concrete', 'pvM2', 'climate', 'heat', 'solar', 'gfa'];
const addParts = (a, b, k = 1) => {
	for (const p of PARTS) a[p] = (a[p] ?? 0) + (b[p] ?? 0) * k;
	return a;
};
const zero = () => Object.fromEntries(PARTS.map((p) => [p, 0]));

/**
 * The village's facts for `livingHexes` living hexes round a centre hex, with or without the tower: absolute numbers
 * (beds, m², t, kWh a year, €).
 */
export function villageFacts(livingHexes = 6, tower = false) {
	const key = `${livingHexes}|${tower ? 1 : 0}`;
	if (cache.has(key)) return cache.get(key);
	const nL = livingHexes;
	const liv = hexStats(LIVING);
	const cPlan = centrePlan(tower);
	const cen = hexStats(cPlan);
	const landL = Object.fromEntries(liv.uses.map((u) => [u.id, u.ha * 1e4]));
	const landC = Object.fromEntries(cen.uses.map((u) => [u.id, u.ha * 1e4]));
	const m2 = (id) => nL * (landL[id] ?? 0) + (landC[id] ?? 0);

	// ── buildings by what the engine makes of them ──
	// util: the living hexes' utilities domes; centre: the centre hex's buildings no works COOP rents (the centre dome or
	// the tower, the hemp, lime, clay and recycling works); halls = util + centre (what was kept up with the homes)
	const homes80 = zero(), homes40 = zero(), food = zero(), halls = zero(), util = zero(), centre = zero(), works = {};
	for (const s of LIVING.sites) {
		const p = siteParts(s, LIVING);
		if (s.kind === 'dome80') addParts(homes80, p, nL);
		else if (s.kind === 'dome40') addParts(homes40, p, nL);
		else if (s.kind === 'food120') addParts(food, p, nL);
		else addParts(halls, p, nL), addParts(util, p, nL);
	}
	for (const s of cPlan.sites) {
		const p = siteParts(s, cPlan);
		if (s.kind === 'factory120' && ['timber', 'bamboo', 'steel', 'glass'].includes(s.factory)) works[s.factory] = addParts(zero(), p);
		else addParts(halls, p), addParts(centre, p);
	}
	// floor m² of the domes the settlement COOPs rent out: a Dome120's floor is its footprint (sandbox-7 capOf); the
	// tower's, its floors
	const floor120 = Math.PI * 60 * 60;
	const centreFloor = tower && cPlan.tower ? towerFloors(cPlan.tower).reduce((a, f) => a + f.m2, 0) + floor120 * (cPlan.sites.filter((s) => s.kind !== 'tower' && s.kind !== 'factory120').length + cPlan.sites.filter((s) => s.kind === 'factory120' && !['timber', 'bamboo', 'steel', 'glass'].includes(s.factory)).length) : floor120 * cPlan.sites.filter((s) => !(s.kind === 'factory120' && ['timber', 'bamboo', 'steel', 'glass'].includes(s.factory))).length;
	const utilZones = Object.fromEntries(KINDS.util120.zones.filter((z) => z.block).map((z) => [z.block, z.m2]));
	const utilGardenM2 = KINDS.util120.zones.find((z) => z.use === 'indoorFood')?.m2 ?? 0;
	const foodPerHex = LIVING.sites.filter((s) => s.kind === 'food120').length;
	const utilPerHex = LIVING.sites.filter((s) => s.kind === 'util120').length;
	const homes = addParts(addParts(zero(), homes80), homes40);
	const beds80 = nL * LIVING.sites.filter((s) => s.kind === 'dome80').length * KINDS.dome80.people;
	const beds40 = nL * LIVING.sites.filter((s) => s.kind === 'dome40').length * KINDS.dome40.people;
	// the tower's premium apartments (~2.2 people each) are beds too
	const towerBeds = tower ? Math.round((cen.people[0]?.n ?? 0) * 2.2) : 0;
	const beds = beds80 + beds40 + towerBeds;
	const footprint = (D) => Math.PI * (D / 2) ** 2;
	const homeFoot = nL * (LIVING.sites.filter((s) => s.kind === 'dome80').length * footprint(KINDS.dome80.D) + LIVING.sites.filter((s) => s.kind === 'dome40').length * footprint(KINDS.dome40.D));

	// ── land ──
	const landM2 = (nL + 1) * HEX_AREA;
	const indoorFoodM2 = m2('indoorFood') + (tower ? (towerFloors(cPlan.tower).find((f) => f.id === 'deck')?.m2 ?? 0) * 0.4 : 0);
	const outdoorFoodM2 = m2('foodForest');
	const woodlandM2 = m2('woodland'), bambooM2 = m2('bamboo'), hempM2 = m2('hemp'), mineM2 = m2('mine'), natureM2 = m2('nature');

	// ── energy ──
	let solarKwh = 0;
	for (const b of [homes, food, halls, ...Object.values(works)]) solarKwh += b.solar;
	const batteryKwh = nL * 10000 + 40000;
	const geoKw = 3400;

	// ── the founding bill: what Sandbox 6 prices the village at (its five rows), without the tower's own machines ──
	const costRows = (s, n) => s.cost.map((c) => ({ label: c.label, eur: c.eur * n }));
	const rows = costRows(liv, nL);
	const centreRows = costRows(cen, 1);
	// Sandbox 6 gives the centre hex the tower's machines; without the tower, its 1 MW data centre and its water works
	// for 2,500 guests go (the village keeps its 40 MWh of batteries and the geothermal plant)
	let dropped = 0;
	if (!tower) dropped = TOWER_EQUIPMENT.filter((e) => /data center|Water works/i.test(e.label)).reduce((a, e) => a + e.eur, 0);
	centreRows[3].eur -= dropped;
	const cost = rows.map((r, k) => ({ label: r.label.replace(/data center,/, 'data centers,') + (k === 3 ? ', geothermal' : ''), eur: r.eur + centreRows[k].eur }));
	cost[4].label = `The land, ${((landM2 / 1e4)).toFixed(1)} ha of farmland`;
	const totalEur = cost.reduce((a, c) => a + c.eur, 0);
	const matT = {};
	for (const [s, n] of [[liv, nL], [cen, 1]]) for (const m of s.materials) {
		const r = (matT[m.id] ??= { id: m.id, label: m.label, unit: m.unit, qty: 0, t: 0, eur: 0 });
		r.qty += m.qty * n;
		r.t += m.t * n;
		r.eur += m.eur * n;
	}

	const f = {
		livingHexes: nL,
		tower: !!tower,
		landM2,
		hexHa: HEX_AREA / 1e4,
		beds: { dome80: beds80, dome40: beds40, tower: towerBeds, total: beds },
		homes: { ...homes, footM2: homeFoot },
		homes80,
		homes40,
		foodDomes: food,
		halls,
		util,
		centre,
		domes: {
			floor120,
			foodPerHex,
			utilPerHex,
			utilZones,
			utilGardenM2,
			centreFloor,
			centreFootM2: cPlan.sites.filter((s) => !(s.kind === 'factory120' && ['timber', 'bamboo', 'steel', 'glass'].includes(s.factory))).reduce((a, s) => a + (s.kind === 'tower' && cPlan.tower ? Math.PI * (cPlan.tower.D / 2) ** 2 : floor120), 0),
			works: Object.fromEntries(['timber', 'bamboo', 'steel', 'glass'].map((k) => [k, cPlan.sites.filter((s) => s.kind === 'factory120' && s.factory === k).length]))
		},
		works,
		indoorFoodM2,
		outdoorFoodM2,
		woodlandM2,
		bambooM2,
		hempM2,
		mineM2,
		natureM2,
		uses: { living: nL, landL, landC },
		solarKwh,
		pvM2: homes.pvM2 + food.pvM2 + halls.pvM2 + Object.values(works).reduce((a, w) => a + w.pvM2, 0),
		geoKw,
		geoKwh: GEOTHERMAL,
		geoHeatKw: 12600,
		batteryKwh,
		factoryRun: FACTORY_RUN,
		cost,
		totalEur,
		droppedEur: dropped,
		materials: Object.values(matT),
		day: DAY,
		landPerson: { outdoor: LAND_PERSON.outdoor.total, indoor: LAND_PERSON.indoor.total },
		equipment: [...EQUIPMENT.map((e) => ({ ...e, n: nL })), ...TOWER_EQUIPMENT.filter((e) => tower || !/data center|Water works/i.test(e.label)).map((e) => ({ ...e, n: 1 }))],
		prices: PRICES,
		sources: SOURCES,
		assembly: ASSEMBLY
	};
	cache.set(key, f);
	return f;
}

const r = (v, u, src, est = false) => ({ v, u, src, est });
const S7 = 'src/lib/sandbox-7 (Sandbox 6’s village design)';
/**
 * The village's facts as catalog records ({ v, u, src, est }), for the World tab and the proof's parameter set.
 */
export function villageRecords(f) {
	const ha = (m2) => Math.round(m2 / 100) / 100;
	return {
		layout: {
			livingHexes: r(f.livingHexes, 'living hexes', `${S7}: six alike round the centre hex`),
			tower: r(f.tower, '', f.tower ? 'Tower180 in the centre hex at its real cost (experiment)' : 'no tower: the centre hex holds one more Dome120 of utilities and community halls (Samuel 2026-10-13)'),
			landHa: r(ha(f.landM2), 'ha', `${S7} layout.js: ${f.livingHexes + 1} hexes of ${f.hexHa.toFixed(1)} ha`)
		},
		beds: {
			dome80: r(f.beds.dome80, 'beds', `${S7}: 5 Dome80 homes of 40 a living hex`),
			dome40: r(f.beds.dome40, 'beds', `${S7}: 9 Dome40 homes of 10 a living hex`),
			tower: r(f.beds.tower, 'beds', 'the tower’s premium apartments, ~2.2 people each (sandbox-7 stats.js)'),
			total: r(f.beds.total, 'beds', `${S7}: 290 a living hex`),
			homeM2PerBed: r(f.homes.gfa / Math.max(1, f.beds.dome80 + f.beds.dome40), 'm² of home (gross floor) a bed', `${S7} KINDS: Dome80 ${Math.round(KINDS.dome80.gfa)} m² for 40, Dome40 ${Math.round(KINDS.dome40.gfa)} m² for 10`)
		},
		land: {
			outdoorFoodHa: r(ha(f.outdoorFoodM2), 'ha', `${S7}: the food forest outdoors`),
			indoorFoodHa: r(ha(f.indoorFoodM2), 'ha', `${S7}: the food forest under glass (two Dome120 a living hex, gardens in the utilities domes)`),
			woodlandHa: r(ha(f.woodlandM2), 'ha', `${S7}: timber woodland (Douglas fir, larch)`),
			bambooHa: r(ha(f.bambooM2), 'ha', `${S7}: bamboo groves`),
			hempHa: r(ha(f.hempM2), 'ha', `${S7}: hemp fields (fibre and hurds; no hemp good in the engine)`),
			pitsHa: r(ha(f.mineM2), 'ha', `${S7}: clay, lime and gravel pits`),
			natureHa: r(ha(f.natureM2), 'ha', `${S7}: hedges, meadow, wild wood (the land the City COOP can lease for more building)`)
		},
		buildings: {
			homesT: r({ glulam: Math.round(f.homes.wood), steel: Math.round(f.homes.steel), glass: Math.round(f.homes.glass) }, 't', `${S7} shellOf: the home domes’ shells and their CLT floors`),
			foodDomesT: r({ glulam: Math.round(f.foodDomes.wood), steel: Math.round(f.foodDomes.steel), glass: Math.round(f.foodDomes.glass) }, 't', `${S7} shellOf(120) × ${f.foodDomes.n}`),
			hallsT: r({ glulam: Math.round(f.halls.wood), steel: Math.round(f.halls.steel), glass: Math.round(f.halls.glass) }, 't', `${S7}: utilities domes, the hemp, recycling, clay and lime factories, ${f.tower ? 'the tower' : 'the centre’s Dome120'}: kept up with the homes`),
			worksT: r(Object.fromEntries(Object.entries(f.works).map(([k, w]) => [k, { glulam: Math.round(w.wood), steel: Math.round(w.steel), glass: Math.round(w.glass) }])), 't', `${S7}: one Dome120 factory each`)
		},
		energy: {
			solarGWh: r(f.solarKwh / 1e6, 'GWh a year', `${S7} shellOf: see-through cells in every second glass panel, 227 kWh a m² a year`),
			geothermalMW: r(f.geoKw / 1000, 'MW net electric', `${S7} stats.js: the village’s geothermal plant, 3.4 MW net, 94 % of the year`),
			geothermalHeatMW: r(f.geoHeatKw / 1000, 'MW heat at 90→60 °C', `${S7} stats.js: the geothermal heat loop`),
			batteryMWh: r(f.batteryKwh / 1000, 'MWh', `${S7}: 10 MWh LFP in each utilities dome, 40 MWh in the centre`),
			climateGWh: r((f.homes.climate + f.foodDomes.climate + f.halls.climate) / 1e6, 'GWh a year', `${S7}: the domes’ climate (fans, pumps, vents)`),
			heatGWh: r((f.homes.heat + f.foodDomes.heat + f.halls.heat) / 1e6, 'GWh heat a year', `${S7}: the domes’ heat beyond their ponds`)
		},
		founding: {
			totalEur: r(Math.round(f.totalEur), '€', `${S7} stats.js: shells, putting them up, fit-out, machines and land${f.droppedEur ? `; without the tower’s 1 MW data centre and water works (−€${(f.droppedEur / 1e6).toFixed(1)}M)` : ''}`),
			...Object.fromEntries(f.cost.map((c, k) => [`row${k + 1}`, r(Math.round(c.eur), '€', c.label)]))
		},
		works: {
			timber: r(FACTORY_RUN.timber.t + FACTORY_RUN.bamboo.t, 't glulam, CLT and scrimber a year', `${S7} FACTORY_RUN: timber ${FACTORY_RUN.timber.t} + bamboo ${FACTORY_RUN.bamboo.t}`),
			steel: r(FACTORY_RUN.steel.t, 't steel a year', `${S7} FACTORY_RUN: ${FACTORY_RUN.steel.note}`),
			glass: r(FACTORY_RUN.glass.t, 't glazing a year', `${S7} FACTORY_RUN: ${FACTORY_RUN.glass.note}`)
		}
	};
}
