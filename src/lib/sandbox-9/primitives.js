// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE WORLD PRIMITIVES — which resource, in which quantity, can be made how (Samuel, 16:52).
 *
 * Plain data, no code that runs a world. Every number is a record { v, u, src, est }: its value, its unit, where it
 * comes from, and est: true when nobody has checked it yet ("estimate"). The engine reads the values once when it
 * builds a world (./genesis.js), the proof writes every record into its report, and the page can show any of them.
 *
 * Energy is the master primitive (Samuel, 16:59): every recipe below carries its kWh or MWh, so the engine can say
 * where every unit of energy went, and only energy left over after basics, running and building pays for innovation.
 *
 * The world is Sandbox 6's village of 1,500 (round 3, Samuel 2026-10-13): six living hexes round a centre hex, read
 * from src/lib/sandbox-7 by ./village.js (beds, domes, land, solar cells, geothermal, works, the founding bill). Many
 * records below are still a living hex's share ("a hex", "per hex"): the engine scales them by `w.c.scale` (people
 * the village is built for ÷ 250, so 6 for the village of 1,500).
 *
 * Units, everywhere in Sandbox 8: food in units of 1,000 kcal of the village diet (with its protein), water in L,
 * energy in kWh (electricity; heat is kWh_th), a bed in bed-days, building materials in tonnes, solar panels in kWp,
 * household goods in kg, hot-spring time in hours. Money inside the village is never in here: prices are found by
 * the COOPs each day. Euro prices appear only at the border (BORDER), where COOPs buy what the village cannot make.
 */
import { DAY, DIET, PRICES, DENSITY, DESIGN, KINDS, CELLS, DOME_FACTORY, DF, DF_PARTS, DF_IMPORTS, DF_LINES, DF_GLAZING, DF_LAMELLAS, domeImports } from '../sandbox-7/specs.js';

/** a number with its unit and source; est marks an estimate nobody has checked yet */
const n = (v, u, src, est = false) => ({ v, u, src, est });

// ── the calendar ─────────────────────────────────────────────────────────────────────────────────────────────────
/** days in each month, January first; a year has 365 days, so the melt is e^(−r/365) a day */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const YEAR_DAYS = 365;
/** the season each month belongs to, for the page */
export const SEASON_OF_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

/**
 * How the year's sun, rain, heating need and food-forest harvest fall over the months (each list sums to 1 or, for
 * rain, averages 1). Sun: the hourly model of a great dome in Munich; rain: Munich's dry winters and wet summers.
 */
export const MONTHLY = {
	sun: n([0.029, 0.046, 0.08, 0.112, 0.131, 0.139, 0.142, 0.123, 0.089, 0.057, 0.03, 0.021], 'share of a year', 'energy/village-energy.md: hourly dome solar model, monthly shares (Jan 2.9 % … Dec 2.1 %)'),
	rain: n([0.6, 0.575, 0.75, 0.85, 1.35, 1.5625, 1.5625, 1.475, 1.025, 0.8, 0.7625, 0.6875], 'times the average month', 'src/lib/sandbox-6/food.js RAIN_MONTH (Munich)'),
	heat: n([0.18, 0.15, 0.12, 0.07, 0.03, 0.005, 0, 0, 0.02, 0.08, 0.145, 0.2], 'share of a year', 'Munich heating degree-days by month, rounded (estimate)', true),
	harvest: n([0.02, 0.02, 0.03, 0.05, 0.07, 0.1, 0.13, 0.15, 0.17, 0.14, 0.08, 0.04], 'share of a year', 'an outdoor food forest: little in winter, most from July to October (estimate)', true),
	/** a heat pump's coefficient of performance by month: worse in the cold months */
	cop: n([2.6, 2.7, 3.0, 3.3, 3.6, 3.8, 3.9, 3.9, 3.6, 3.3, 2.9, 2.6], 'kWh heat per kWh electricity', 'air/water heat pump in a Munich climate: COP falls toward ~2.5 near 0 °C and rises to ~4 in summer (seasonal performance factor ~3; estimate)', true)
};

/**
 * Weather: each month's sun and rain are drawn from the seed around the monthly normals above (a lognormal factor
 * with these spreads), so two seeds are two different runs of years, not the same weather with other people.
 */
export const WEATHER = {
	sunSpread: n(0.12, 'lognormal σ of a month’s sun', 'Munich monthly sunshine hours vary about ±10–15 % from year to year (DWD climate normals; estimate)', true),
	rainSpread: n(0.35, 'lognormal σ of a month’s rain', 'monthly rain in Munich varies by about a third from year to year (DWD; estimate)', true)
};

// ── people ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** what a person needs a day (the basic bundle) and the most they will use (satiation); Stone–Geary extras shares */
export const PERSON = {
	food: n(DAY.kcal / 1000, 'units of 1,000 kcal a day', 'src/lib/sandbox-7/specs.js DAY: the village diet, 2,240 kcal a day (EAT-Lancet with chestnuts, roots and legumes for grains and dairy)'),
	protein: n(DAY.protein, 'g of protein a day', 'src/lib/sandbox-7/specs.js DAY: 73 g a day'),
	water: n(100, 'L a day', 'src/lib/sandbox-6/food.js: 150 L used, 50 L of it greywater for crops, so 100 L fresh'),
	energy: n(900 / 365, 'kWh a day', 'sandbox-6/numbers.md: 900 kWh a year at home in a shared dome'),
	bed: n(1, 'bed', 'one bed a person'),
	satiation: {
		food: n((DAY.kcal / 1000) * 1.25, 'units of 1,000 kcal a day', 'a quarter more than need: better and more varied food (estimate)', true),
		water: n(150, 'L a day', 'src/lib/sandbox-6/food.js WATER_L: everything a person uses (estimate as a ceiling)', true),
		energy: n((900 / 365) * 3, 'kWh a day', 'three times home use: devices, cooking, e-bikes (estimate)', true),
		goods: n(3, 'kg a day', 'household goods, tools, clothes, devices: about 1.1 t a year (estimate)', true),
		spring: n(2, 'h a day', 'two hours at the hot spring (estimate)', true),
		compute: n(24, 'h a day', 'Aven help (learning, games, design, care, errands): at most one Aven helping a person around the clock (estimate)', true),
		work: n(24, 'h a day', 'Aven work for the COOPs: at most one Aven working around the clock beside its help (round 4: help and work run as separate sessions on the Aven service its person buys; estimate)', true)
	},
	/** how a person's Aven splits spending above the basic bundle (Stone–Geary marginal shares) */
	extrasShare: n({ food: 0.06, water: 0.02, energy: 0.06, goods: 0.3, spring: 0.16, compute: 0.4 }, 'share', 'Aven taste, spread by person ±30 % (estimate)', true)
};

// ── energy sources ───────────────────────────────────────────────────────────────────────────────────────────────
export const ENERGY_SOURCES = {
	domeSolar: {
		label: 'Dome solar: see-through cells on the dome glass, 70 % of the light kept for the plants',
		kwhYearPerGreatDome: n(1.13e6, 'kWh a year per great dome of 248', 'dome-research/dome-sizes.md v2 (2026-10-08), Dome150: 1.13 GWh from the cells; the older village-energy.md (2026-10-07) said 1.3 GWh for a fuller cover of cells'),
		kwhPerM2Cells: n(228, 'kWh per m² of cells a year', 'world model 5.2 (~26 W/m² average)'),
		capacityFactor: n(0.11, 'share', 'world model 5.2'),
		lifeYears: n(27, 'years', 'Fraunhofer ISE Photovoltaics Report: 25–30 years'),
		energyPaybackYears: n(1.1, 'years', 'Fraunhofer ISE (Northern Europe)'),
		eroi: n(20, 'times', 'Fraunhofer ISE payback over 25 years ~20–25; Bhandari et al. 2015 mean ~11.6 for older poly-Si (use 10–25)', true),
		cellEfficiency: n(0.21, 'share of sunlight', 'module efficiency today, Fraunhofer ISE'),
		hardLimit: n(0.337, 'share of sunlight', 'Shockley–Queisser limit for one junction (Shockley and Queisser 1961, J. Appl. Phys. 32: 510); and the plants need 70 % of the light')
	},
	fieldSolar: {
		label: 'Field solar on leased land',
		kwhPerKwpYear: n(980, 'kWh per kWp a year', 'Messe München PV: 1 MW gives ~1 GWh a year'),
		landPerKwp: n(12, 'm² of land per kWp', '210 Wp per m² of module at a ground cover of 0.4 (estimate)', true),
		steelPerKwp: n(0.03, 't of steel per kWp (mounting)', 'ground-mount racks, 25–40 kg per kWp (estimate)', true),
		installMwhPerKwp: n(0.02, 'MWh per kWp to install', 'estimate', true),
		lifeYears: n(27, 'years', 'Fraunhofer ISE: 25–30 years')
	},
	egs: {
		label: "This hex's sixth of the village centre's EGS plant (one injector, two producers, 5.5 km)",
		netKwElectric: n(3400 / 6, 'kW net electric', 'energy/village-energy.md: 3.4 MW net per village pad; a hex takes a sixth'),
		kwHeatIntoOrc: n(35600 / 6, 'kW of brine heat into the ORC (175 → 90 °C)', 'energy/village-energy.md: 100 kg/s × 85 K = 35.6 MW per pad; a hex takes a sixth'),
		pumpsShareOfGross: n(0.2, 'share of gross electric', 'world model 5.2: pumps and fans ~20 % of gross (already out of the net figure)'),
		kwHeat: n(12600 / 6, 'kW heat at 90→60 °C', 'energy/village-energy.md: 12.6 MW direct heat per pad'),
		kwLowHeat: n(31000 / 6, 'kW heat at 30–40 °C', 'energy/village-energy.md: ~31 MW condenser heat per pad'),
		uptime: n(0.94, 'share of hours', 'energy/village-energy.md'),
		steelPerStage: n(400, 't of steel per hex share of a stage (casing and plant)', "casing for ~7 km of drilled length a well and the ORC, a sixth (estimate; the research's gap)", true),
		mwhPerStage: n(14000, 'MWh per hex share of a stage (drilling, stimulation, steel)', 'set so electricity-only EROI is ~10 over 30 years (estimate)', true),
		maxStages: n(3, 'stages per pad', 'Fervo grows Cape in blocks of two producers; three per pad (estimate)', true),
		lifeYears: n(30, 'years (ORC; wells ~80)', 'energy/village-energy.md, e2e sim'),
		orcEfficiency: n(0.12, 'share of heat (gross electric ÷ heat in)', 'energy/village-energy.md: ORC ~12 % at 175 °C'),
		exergyLimit: n(0.238, 'share of heat', 'brine cooled 175 → 90 °C against a 35 °C condenser: 1 − T₀·ln(T₁/T₂)/(T₁ − T₂) = 1 − 308·ln(448/363)/85'),
		eroiElectric: n(10, 'times', 'Atlason and Unnthorsson 2013: Nesjavellir 9.5 electricity only, 32.4 with heat; EGS drills deeper: 5–15 (estimate)', true),
		hardLimit: n(0.36, 'Carnot efficiency at 175 °C / 15 °C', 'Carnot; flow × ΔT: 100 kg/s × 85 K = 35.6 MW heat per pad')
	},
	battery: {
		label: 'Battery (Li-ion), owned by the solar COOP',
		kwh: n(2000, 'kWh', 'a small battery for the hex (estimate)', true),
		roundTrip: n(0.9, 'share', 'Li-ion ~90 % (estimate)', true),
		esoi: n(10, 'energy stored on investment', 'Barnhart and Benson 2013'),
		lifeYears: n(12, 'years', 'Li-ion 10–15 years (estimate)', true),
		fadePerYear: n(0.02, 'share of its first capacity lost a year', 'Li-ion calendar and cycle fade: ~80 % left after 10–12 years (estimate). The closed city cannot make or import cells, so the battery fades and is not replaced', true),
		hardLimit: n(0, 'seasonal storage', 'no cheap seasonal electricity store: winter binds without geothermal (world model 5.2)')
	},
	heatPumpCop: n(3, 'kWh heat per kWh electricity (year average; MONTHLY.cop by month)', 'air/ground heat pump, used when no geothermal heat is there (estimate)', true)
};

// ── land, water, matter ──────────────────────────────────────────────────────────────────────────────────────────
export const RESOURCES = {
	land: {
		hexHa: n(45, 'ha', 'sandbox-6/numbers.md hex ~45 ha (village-energy.md: ~40 ha)'),
		germanyM2PerPerson: n(4200, 'm² a person', 'Germany: area over population (world model 5.3)'),
		hardLimit: n(45, 'ha', 'fixed: only how hard land is used can change')
	},
	rain: {
		mmYear: n(800, 'mm a year', 'src/lib/sandbox-6/food.js RAIN_MM (round Munich)'),
		caught: n(0.9, 'share', 'src/lib/sandbox-6/food.js CATCH'),
		roofPerBed: n((Math.PI * 75 * 75) / 248, 'm² of roof a bed', 'src/lib/sandbox-6/food.js ROOF_BED: a 150 m dome over 248 beds'),
		tankPerBed: n(2.8, 'm³ a bed (4 weeks)', 'sandbox-6/numbers.md: tanks hold 4 weeks of fresh water a bed'),
		pumpKwhPerM3: n(0.45, 'kWh per m³', 'German utilities 0.41–0.51 kWh/m³ (world model 5.3)'),
		tankSteelPerM3: n(0.03, 't of steel per m³ of tank', 'large steel tanks 25–40 kg per m³ (estimate)', true),
		hardLimit: n(51, 'm³ a bed a year', 'rain × catchment: 51 m³ a bed a year against a need of 36.5 (ratio 1.4)')
	},
	groundwater: {
		rechargeMm: n(200, 'mm a year over the hex', 'Munich gravel plain recharge 200–300 mm (estimate)', true),
		pumpKwhPerM3: n(0.5, 'kWh per m³', 'German utilities 0.41–0.51 kWh/m³'),
		steelPerM3Day: n(0.05, 't of steel per m³ a day of pumps and mains', 'estimate', true),
		hardLimit: n('recharge', '', 'pumping above the recharge empties the aquifer: the well is capped at the recharge')
	},
	foodForest: {
		// the food forest's yields, ramp and weather are in FOOD below (food-research.md); these are its other numbers
		kwhPerUnit: n(0.5, 'kWh per 1,000 kcal (cold store, processing, pumping)', 'physics audit (2026-10-13): processing takes 0.5–1.5 kWh a kg of food, ~0.3–0.95 a 1,000 kcal of this diet; the low end (estimate)', true),
		rotPerDay: n(0.0005, 'share of the store a day', 'preserved food: nuts, grain, roots, dried and bottled fruit (estimate)', true),
		maxKgM2Year: n(3, 'kg per m² a year (physical floor of land per kg)', 'photosynthesis: ≤ 4.6 % of sunlight for C3, field peaks ~3.5 % (Zhu, Long, Ort 2008); intensive mixed systems 2–5 kg/m² (estimate)', true),
		peters2016: n('0.13–1.08 ha a person a year for ten US diets', '', 'Peters et al. 2016, Elementa')
	},
	greenhouse: {
		lifeYears: n(50, 'years (the frame; the glazing 30, TECH)', 'as a dome: 2 % a year upkeep (sandbox-6/numbers.md)')
	},
	timberLand: {
		tHaYear: n(10.4 * 0.45, 't of logs per ha a year (dry)', 'physics audit (2026-10-13): Bavarian forests grow 10.4 m³ a ha a year (BWI 2022), ~0.45 t a m³ dry: 4.7 t of logs, 2.3 t of glulam at 2 t of logs a t (1–2.5 t of glulam a ha). Was 15 t, three times too much'),
		maxTHaYear: n(40, 't per ha a year (physical ceiling)', 'record biomass of bamboo and miscanthus, a part of photosynthesis limits (estimate)', true),
		ramp: n([0, 0, 0, 0, 0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1], 'share of yield by year of new land (year 1 first)', 'planted at founding: bamboo gives from year 6–8 (sandbox-7 RAW), Douglas fir and larch first thinnings after ~10–15 years (estimate)', true),
		standingYears: n(2, 'years of growth that can stand uncut', 'beyond it the stand stops adding wood (estimate)', true)
	},
	ore: {
		tYearPerPit: n(250, 't of iron ore a year per pit (not used: the village’s steelworks melts scrap)', 'src/lib/sandbox-6/rules.js ironmine: 10 rounds of 25 t a year. The physics audit: bog iron at 30–50 % Fe needs 2.1–3.5 t of ore a t of steel, not 1.67; Sandbox 6’s village (sandbox-7 FACTORY_RUN) runs an electric arc furnace on scrap instead'),
		pitsMax: n(0, 'pits', 'none: the village digs clay, lime and gravel, not ore (sandbox-7 layout)'),
		tPerPit: n(20000, 't of ore in a pit', 'a small bog-iron or ironstone working: about 80 years at 250 t a year (estimate); a pit worked out gives nothing more', true)
	},
	sand: {
		tYearPerPit: n(600, 't of glass sand a year per pit (not used: the glassworks laminates bought float glass)', 'src/lib/sandbox-6/rules.js glassworks; the physics audit: glass from pit sand alone made soda ash from nothing. Sandbox 6’s village buys float glass (sandbox-7 FACTORY_RUN)', true),
		pitsMax: n(0, 'pits', 'none: the village buys float glass'),
		tPerPit: n(50000, 't of glass sand in a pit', 'about 80 years at 600 t a year (estimate); a pit worked out gives nothing more', true)
	},
	spring: {
		hoursPerSite: n(150, 'bather-hours a day per site', 'a warm pond of ~300 m² at 10 m² a bather over 5 h of a crowded day (estimate)', true),
		sites: n(2, 'sites', 'two warm ponds on the hex, fixed by nature (estimate)', true),
		heatKwhPerHour: n([38, 35, 28, 20, 14, 10, 9, 9, 13, 20, 28, 36], 'kWh heat per bather-hour, by month', 'an open 35 °C pond of ~300 m² loses ~0.8 kW/m² near 0 °C (evaporation and convection) and ~0.2 kW/m² in July, over 150 bather-hours a day; from the geothermal condenser heat (30–40 °C) or heat pumps (estimate)', true)
	}
};

/** a building's standing electricity (light, ventilation, controls) a year per tonne it is built of */
export const STANDING_MWH_T = n(0.2, 'MWh a year per tonne built', 'src/lib/sandbox-6/rules.js KEEP_MWH_T');

/** physical floors that innovation can approach and never pass (world model 5.4) */
export const LIMITS = {
	carnot: n(0.36, 'share', 'Carnot at 175 °C / 15 °C'),
	shockleyQueisser: n(0.337, 'share', 'Shockley and Queisser 1961'),
	photosynthesisC3: n(0.046, 'share of sunlight', 'Zhu, Long, Ort 2008'),
	steelMinMwhT: n(2.9, 'MWh per t', 'practical minimum for hot metal ~10.4 GJ/t (Fruehan 2000, US DOE bandwidth); H2-DRI + EAF 3.48 (Vogl et al. 2018) to 3.72 (Bhaskar et al. 2020)'),
	glassMinMwhT: n(0.69, 'MWh per t', 'theoretical melting minimum ~2.5 GJ/t; electric melters < 0.75 (British Glass), 2.07 with annealing (PyPSA-Eur)'),
	goodsMassFloor: n(1.0, 't of materials per t of goods', 'mass balance: a kg of goods needs a kg of matter'),
	smilPlateauKw: n([1.6, 2.2], 'kW a person', 'Smil 2017: quality of life flattens above 50–70 GJ a person a year')
};

/** two-factor learning (world model 5.4): rates per doubling, by doing and by searching (R&D energy) */
export const LEARNING = {
	searchRef: n(5000, 'MWh of R&D energy (K₀): the knowledge a recipe already embodies', 'about a year of the whole hex’s electricity (≈ 6 GWh): a village has to put a year of its energy into one technology to double what is known of it. The first draft used 50 MWh, which let a year of R&D move recipes as far as decades of an industry do (reviewers, round 1; estimate)', true),
	decay: n(0.05, 'share of the knowledge added by R&D lost a year', 'world model 5.4: knowledge is forgotten slowly (estimate)', true),
	replant: n(0.25, 'share of timber land replanted a year', 'hemp is annual, bamboo is cut and regrows in 3–5 years: land yields move only as fast as land is replanted (estimate)', true),
	doingRef: n(1, 'years of output (Q₀)', 'cumulative output of the first year', true),
	rates: {
		solar: n({ doing: 0.2, search: 0.126 }, 'per doubling', 'Our World in Data (solar 20 % by doing); Klaassen et al. 2005 (12.6 % by searching, as the template)'),
		materials: n({ doing: 0.05, search: 0.126 }, 'per doubling', 'world model 5.4: 5 % for mature materials (estimate); search: Klaassen et al. 2005', true),
		food: n({ doing: 0.02, search: 0.05 }, 'per doubling', 'world model 5.4: 2 % for food (estimate)', true),
		energy: n({ doing: 0.054, search: 0.126 }, 'per doubling', 'Klaassen et al. 2005 (wind: 5.4 % doing, 12.6 % search)'),
		homes: n({ doing: 0.05, search: 0.1 }, 'per doubling', 'estimate', true),
		compute: n({ doing: 0.2, search: 0.126 }, 'per doubling', 'energy per computation halves every ~1.6 years (Koomey et al. 2011, IEEE Annals 33: 46); search: Klaassen et al. 2005 (estimate)', true)
	}
};

/**
 * THE DOME FACTORY (Samuel, 2026-10-13 10:55; Sandbox 6's switch sandbox-7 specs.js DOME_FACTORY, on by default under
 * its 'insides' package, off with S7_DOME_FACTORY=0). The glass & solar works' Dome120 at the centre is the dome factory,
 * the Village COOP's: it makes every dome part from raw inputs bought at the border. The engine reads its lines, parts
 * and imports (DF_LINES, DF_PARTS, DF_IMPORTS) and turns them into four technologies in its own units (TECH below):
 *   - struts: glulam struts from lamellas and the north cassettes' frames from C24, in t of WOOD (the timber COOPs run
 *     it beside their timber works, which keeps making the CLT from the village's logs and runs first);
 *   - steel: the hubs, ring pieces and connectors, welded from plate and galvanised by a galvaniser near by, t of STEEL;
 *   - glass: the laminated double glazing from float glass, t of GLASS (20 m² a t);
 *   - panel: the solar panes, cells laid into the glazing's outer laminate, kWp of PANEL (a rating: kWh a year ÷ 980).
 * Each line's raw input is bought at the border at the price of its whole kit (DF_PARTS `eur`: the lamellas with the
 * glue, the plate with the galvanising, bolts and weld consumables less the offcuts sold back as scrap, the float with
 * the low-iron and low-E sheets, PVB, edge and gaskets, the cells with their PVB and ribbons). The steelworks no longer
 * makes the domes' steel: it recycles and makes what is not a dome part, which the engine does not trade (its dome is
 * one of the centre's halls). The dome's base load and hours (DF.baseKwh, DF.baseH) are spread over each line's full
 * output by its floor. `null` with the switch off.
 */
export const DF_ON = DOME_FACTORY;
export const DF_ENGINE = (() => {
	if (!DOME_FACTORY) return null;
	const line = (id) => DF_LINES.find((l) => l.id === id);
	const m2Of = (ids) => ids.reduce((a, id) => a + line(id).floor.reduce((b, x) => b + x.m2, 0), 0);
	// a Dome120's parts made in the dome factory (sandbox-7 domeImports): the plate a t of hubs takes, the cells a m² of
	// solar pane
	const g = domeImports(120);
	const plateT = g.goods.plateT / g.goods.galvanisedT;
	const cellsM2 = g.goods.cellsKwp / g.q.solar;
	const cassM = DF_PARTS.cassette.eur / DF_IMPORTS.kvh.eur; // m³ of C24 a m² of cassette (its kit is the C24 alone)
	const glazM2T = 1000 / DF_GLAZING.kg; // m² of glazing a t
	const pvM2Kwp = ENERGY_SOURCES.fieldSolar.kwhPerKwpYear.v / CELLS.flatKwh; // m² of solar pane a kWp of rating
	const rho = DENSITY.glulam;
	const strutM3 = line('glulam').cap, cassM3 = line('cassettes').cap * cassM;
	// the struts line's mix: glulam and the cassettes' C24 by volume, as the two lines' capacities
	const gs = strutM3 / (strutM3 + cassM3), cs = 1 - gs;
	const lines = { struts: ['glulam', 'cassettes'], steel: ['hubs'], glass: ['glazing', 'small'], panel: ['solar'] };
	const floor = Object.fromEntries(Object.entries(lines).map(([k, ids]) => [k, m2Of(ids)]));
	const cap = { struts: (strutM3 + cassM3) * rho, steel: line('hubs').cap, glass: line('glazing').cap / glazM2T, panel: line('solar').cap / pvM2Kwp };
	const P = DF_PARTS;
	// a unit (t or kWp): its raw input, its kit € (from the border), kWh and crew-hours
	const unit = {
		struts: { raw: (gs * DF_LAMELLAS + cs) / rho, eur: (gs * P.strut.eur + cs * (P.cassette.eur / cassM)) / rho, kwh: (gs * P.strut.kwh + (cs * P.cassette.kwh) / cassM) / rho, h: (gs * P.strut.h + (cs * P.cassette.h) / cassM) / rho, bought: (gs * P.strut.bought + (cs * P.cassette.bought) / cassM) / rho },
		steel: { raw: plateT, eur: P.hub.eur, kwh: P.hub.kwh, h: P.hub.h, bought: P.hub.bought },
		glass: { raw: 1 + DF_GLAZING.waste, eur: P.glazing.eur * glazM2T, kwh: P.glazing.kwh * glazM2T, h: P.glazing.h * glazM2T, bought: P.glazing.bought * glazM2T },
		panel: { raw: cellsM2 * pvM2Kwp, eur: P.solar.eur * pvM2Kwp, kwh: P.solar.kwh * pvM2Kwp, h: P.solar.h * pvM2Kwp, bought: P.solar.bought * pvM2Kwp }
	};
	for (const k of Object.keys(unit)) {
		const f = floor[k] / DF.floor;
		unit[k].baseKwh = (DF.baseKwh * 12 * f) / cap[k];
		unit[k].baseH = (DF.baseH * 12 * f) / cap[k];
		unit[k].kitEur = unit[k].eur / unit[k].raw;
	}
	const domeM2 = Math.PI * (KINDS.factory120.D / 2) ** 2;
	return { lines, floor, cap, unit, gs, cassM, plateT, cellsM2, glazM2T, pvM2Kwp, rho, floorAll: DF.floor, domeM2, machines: DF.machines };
})();

/** a dome-factory technology's record set (DF_ENGINE): the same shape as every TECH entry */
function dfTech(k, label, good, capUnit, rawKind, rawUnit, rawSrc, learn) {
	const X = DF_ENGINE, u = X.unit[k], P = DF_PARTS;
	const lineIds = X.lines[k].join(' + ');
	const parts = { struts: `struts ${P.strut.kwh} kWh and ${P.strut.h} crew-hours a m³, cassette frames ${P.cassette.kwh} kWh a m² (their hours are the site's, sandbox-7 RATES.hemp); ${Math.round(100 * X.gs)} % glulam by volume`, steel: `${P.hub.kwh} kWh and ${P.hub.h} crew-hours a t of hubs`, glass: `${P.glazing.kwh} kWh and ${P.glazing.h} crew-hours a m², ${X.glazM2T} m² a t`, panel: `${P.solar.kwh} kWh and ${P.solar.h} crew-hours a m² of solar pane, ${X.pvM2Kwp.toFixed(2)} m² a kWp (${CELLS.flatKwh} kWh a m² a year)` }[k];
	const base = `the dome's base ${DF.baseKwh / 1000} MWh and ${DF.baseH} crew-hours a month (light, air, extraction; stores, testing, upkeep), ${Math.round((100 * X.floor[k]) / X.floorAll)} % of it by the line's floor, over its full output`;
	return {
		label,
		good,
		kind: 'works',
		capUnit,
		capYear: n(X.cap[k], `${capUnit} on two shifts`, `sandbox-7 DF_LINES ${lineIds}: ${X.lines[k].map((id) => { const l = DF_LINES.find((x) => x.id === id); return l.cap ? `${l.cap.toLocaleString('en-US')} ${l.unit}` : `${l.label.toLowerCase()} (no capacity of its own)`; }).join(', ')} a year`, true),
		floorM2: n(X.floor[k], 'm² of the dome factory’s floor', `sandbox-7 DF_LINES ${lineIds} (of ${X.floorAll.toLocaleString('en-US')} m²; the aisles and loading stay the Village COOP’s)`),
		inputs: { [rawKind]: n(u.raw, rawUnit, rawSrc, true) },
		kwh: n(u.kwh + u.baseKwh, 'kWh per unit', `sandbox-7 DF_PARTS: ${parts}; and ${base}`, true),
		runH: n((u.h + u.baseH) / 365, 'Aven hours a day per unit a year of capacity', `sandbox-7 DF_PARTS crew-hours (villagers and their Avens, no wages): ${(u.h + u.baseH).toFixed(2)} a unit at full use, with ${base}`, true),
		build: {
			wood: n(0, 't glulam per unit a year (the dome factory’s Dome120 by the line’s floor: ./genesis.js villageTech)', 'sandbox-7 shellOf(120)'),
			steel: n(0, 't steel per unit a year (the same)', 'sandbox-7 shellOf(120)'),
			glass: n(0, 't glass per unit a year (the same)', 'sandbox-7 shellOf(120)'),
			mwhPerT: n(0.1, 'MWh per t built', 'rules.js BUILD_MWH_T')
		},
		buildDays: n(120, 'days', 'estimate', true),
		land: n((X.domeM2 * X.floor[k]) / X.floorAll / X.cap[k], 'm² per unit a year', `the dome factory’s Dome120 (${Math.round(X.domeM2).toLocaleString('en-US')} m²) by the line’s floor`),
		life: n(30, 'years (the machines)', 'estimate; the machines are kept up at 6 % a year in the build-out (sandbox-7 DF.upkeep)', true),
		learn
	};
}
/** the dome factory's four lines as technologies (replacing the steel, glass and panel works; struts is new) */
const DF_TECH = DF_ENGINE
	? {
			steel: dfTech('steel', 'Dome factory: hubs, ring pieces and connectors, welded from bought plate (galvanised by a galvaniser near by)', 'steel', 't of hubs a year', 'plate', 't of S355 plate per t of hubs', `sandbox-7 domeImports: ${DF_ENGINE.plateT.toFixed(2)} t of plate a t (${(DF_ENGINE.plateT - 1).toFixed(2)} cut away and sold back as scrap)`, { group: 'materials', coef: { kwh: n(0.6, 'kWh per t at the floor', 'cutting and welding with less power (estimate)', true) } }),
			glass: dfTech('glass', 'Dome factory: laminated double glazing, from bought float glass', 'glass', 't of glazing a year', 'float', 't of float glass per t of glazing', `sandbox-7 DF_GLAZING: ${DF_GLAZING.kg} kg of glass a m², ${Math.round(100 * DF_GLAZING.waste)} % of the float cut away`, { group: 'materials', coef: { kwh: n(0.5, 'kWh per t at the floor', 'lamination at half today’s energy (estimate)', true) } }),
			panel: dfTech('panel', 'Dome factory: solar panes, bought cells laid into the glazing’s outer laminate', 'panel', 'kWp of solar panes a year', 'cells', 'kWp of solar cells per kWp of pane', `sandbox-7 DF_PARTS.solar: ${(DF_ENGINE.cellsM2 * 1000).toFixed(0)} Wp of cells a m² (210 Wp and 3 % breakage) at ${DF_ENGINE.pvM2Kwp.toFixed(2)} m² a kWp; the pane’s glass is its glazing's (on top of it)`, { group: 'solar', coef: { kwh: n(0.5, 'kWh per kWp at the floor', 'estimate', true) } }),
			struts: dfTech('struts', 'Dome factory: glulam struts and the north cassettes’ frames, from bought lamellas and C24', 'wood', 't of struts and cassette frames a year', 'lamellas', 'm³ of lamellas and C24 per t', `sandbox-7 DF_LAMELLAS: ${DF_LAMELLAS} m³ of lamellas a m³ of glulam, a m³ of C24 a m³ of cassette frame (${DF_ENGINE.cassM} m³ a m²), ${Math.round(100 * DF_ENGINE.gs)} % glulam by volume as the lines' capacities, at ${DENSITY.glulam} t a m³`, { group: 'materials', coef: { kwh: n(0.5, 'kWh per t at the floor', 'estimate', true) } })
		}
	: {};

/**
 * The technologies: what each kind of COOP makes, from what, with how much energy, on how much land, what a unit of
 * its capacity is built of, how long it lasts, and which of its coefficients innovation can improve, down to which
 * physical floor. A coefficient `c` starts at 1 and falls toward `floor` (as a share of today's value).
 *
 * capUnit: what one unit of capacity is. make: output per capacity unit a day when the kind runs at capacity (or the
 * rule in `kind`). inputs: other goods per unit of output. kwh / heat: electricity and heat per unit of output.
 * runH: Aven running hours a day per capacity unit (keeping the plant going); build: tonnes and MWh per capacity unit;
 * land: m² per capacity unit; life: years (wear is 1/life a year, replaced by upkeep from the same materials).
 */
export const TECH = {
	forest: {
		label: 'Food forest',
		good: 'food',
		kind: 'forest',
		capUnit: 'm² of food forest',
		kwh: n(0.5, 'kWh per 1,000 kcal', 'RESOURCES.foodForest.kwhPerUnit', true),
		runH: n(0.8 / 1e4, 'Aven hours a day per m² (0.8 h a ha)', 'care, picking robots, cold store (estimate)', true),
		build: { mwh: n(0.5 / 1e4, 'MWh per m² planted', 'planting and irrigation (estimate)', true) },
		buildDays: n(60, 'days to plant', 'estimate', true),
		land: n(1, 'm² per m²', ''),
		life: n(0, 'years', 'perennial: no wear modelled'),
		learn: { group: 'food', coef: { yield: n(0.5, 'land per 1,000 kcal, share of today at the floor', 'better varieties and layers: at most twice the mature yield (estimate)', true) } }
	},
	greenhouse: {
		label: 'Food domes (the food forest under glass, two Dome120 a living hex)',
		good: 'food',
		kind: 'greenhouse',
		capUnit: 'm² of food forest under glass',
		kwh: n(0.5, 'kWh per 1,000 kcal (packing, cold store)', 'as the forest outdoors (estimate)', true),
		runH: n(5 / 3000, 'Aven hours a day per m²', 'estimate', true),
		build: {
			wood: n(1500 / 17671, 't glulam per m² (replaced by the village’s food domes: ./village.js)', 'sandbox-7 shellOf(120): two food domes a living hex over its food forest under glass'),
			steel: n(200 / 17671, 't steel per m² (replaced by the village’s food domes)', 'sandbox-7 shellOf(120)'),
			glass: n(1000 / 17671, 't glass per m² (replaced by the village’s food domes)', 'sandbox-7 shellOf(120)'),
			mwhPerT: n(0.1, 'MWh per t built', 'src/lib/sandbox-6/rules.js BUILD_MWH_T')
		},
		buildDays: n(120, 'days', 'estimate', true),
		land: n(1, 'm² per m²', ''),
		life: n(50, 'years (the frame)', 'RESOURCES.greenhouse.lifeYears'),
		glassLife: n(30, 'years (the glazing)', 'physics audit (2026-10-13): laminated glazing and its seals last 25–35 years, not 50: upkeep replaces the glass of a dome every 30 years'),
		learn: { group: 'food', coef: { yield: n(0.5, 'land per 1,000 kcal at the floor', 'at most twice the mature yield (estimate)', true), kwh: n(0.4, 'kWh per 1,000 kcal at the floor', '0.5 → 0.2 (estimate)', true) } }
	},
	rain: {
		label: 'Roof tanks: rain off the dome roofs',
		good: 'water',
		kind: 'rain',
		capUnit: 'm³ of tank',
		kwh: n(0.45 / 1000, 'kWh per L', 'RESOURCES.rain.pumpKwhPerM3'),
		runH: n(3 / 784, 'Aven hours a day per m³ of tank', 'estimate', true),
		build: { steel: n(0.03, 't per m³', 'RESOURCES.rain.tankSteelPerM3', true), mwhPerT: n(0.1, 'MWh per t built', 'rules.js BUILD_MWH_T') },
		buildDays: n(60, 'days', 'estimate', true),
		land: n(0, 'm²', 'tanks stand under the domes'),
		life: n(40, 'years', 'estimate', true),
		learn: { group: 'energy', coef: { kwh: n(0.33, 'kWh per L at the floor', '0.45 → 0.15 kWh/m³ (estimate)', true) } }
	},
	well: {
		label: 'Well and water mains (the City COOP)',
		good: 'water',
		kind: 'well',
		capUnit: 'm³ a day of pumping',
		kwh: n(0.5 / 1000, 'kWh per L', 'RESOURCES.groundwater.pumpKwhPerM3'),
		runH: n(2 / 20, 'Aven hours a day per m³/day', 'estimate', true),
		build: { steel: n(0.05, 't per m³/day', 'RESOURCES.groundwater.steelPerM3Day', true), mwhPerT: n(0.1, 'MWh per t built', 'rules.js BUILD_MWH_T') },
		buildDays: n(60, 'days', 'estimate', true),
		land: n(0, 'm²', 'in the City COOP land'),
		life: n(40, 'years', 'estimate', true),
		learn: { group: 'energy', coef: { kwh: n(0.3, 'kWh per L at the floor', '0.5 → 0.15 kWh/m³ (estimate)', true) } }
	},
	solar: {
		label: 'Solar: cells on the dome glass, and fields',
		good: 'energy',
		kind: 'solar',
		capUnit: 'kWp of field panels (dome cells as a rating in kWh a year)',
		kwh: n(0, 'kWh per kWh', ''),
		runH: n(0.002, 'Aven hours a day per kWp', 'cleaning, inverters (estimate)', true),
		runFixH: n(3, 'Aven hours a day', 'dome cells and battery (estimate)', true),
		build: {
			panel: n(1, 'kWp of panels per kWp', ''),
			steel: n(0.03, 't per kWp', 'ENERGY_SOURCES.fieldSolar.steelPerKwp', true),
			mwh: n(0.02, 'MWh per kWp', 'ENERGY_SOURCES.fieldSolar.installMwhPerKwp', true)
		},
		buildDays: n(30, 'days', 'estimate', true),
		land: n(12, 'm² per kWp', 'ENERGY_SOURCES.fieldSolar.landPerKwp', true),
		life: n(27, 'years', 'ENERGY_SOURCES.fieldSolar.lifeYears'),
		learn: { group: 'solar', coef: { cells: n(0.623, 'area per kWh at the floor', '21 % → 33.7 % efficiency (Shockley–Queisser)') } }
	},
	geo: {
		label: 'Geothermal (EGS) share',
		good: 'energy',
		kind: 'geo',
		capUnit: 'stage (0.567 MW electric, 2.1 MW heat)',
		kwh: n(0, 'kWh per kWh', ''),
		runH: n(8, 'Aven hours a day per stage', 'pumps, ORC, wells (estimate)', true),
		build: { steel: n(400, 't per stage', 'ENERGY_SOURCES.egs.steelPerStage', true), mwh: n(14000, 'MWh per stage', 'ENERGY_SOURCES.egs.mwhPerStage', true) },
		buildDays: n(365, 'days per stage', 'Cape wells drilled in ~21 days each, plant and stimulation a year (estimate)', true),
		land: n(0, 'm²', 'the pad stands on the village centre hex'),
		life: n(30, 'years', 'ENERGY_SOURCES.egs.lifeYears'),
		learn: { group: 'energy', coef: { orc: n(0.8, 'heat per kWh at the floor', 'ORC 12 % → 15 % gross: about 60 % of the exergy limit of 23.8 % at these temperatures, which good ORCs reach (estimate)', true) } }
	},
	hall: {
		label: 'Dome shells a Tribe COOP owns and rents out: the food, utilities, factory and centre domes (Samuel, 2026-10-13)',
		good: 'bed',
		kind: 'hall',
		capUnit: 'm² of dome floor',
		kwh: n(0, 'kWh per m²-day', 'the tenants pay their own climate and light'),
		runH: n(0, 'Aven hours a day per m²', 'the tenants run what stands in it'),
		build: {
			wood: n(0, 't glulam a m² of floor (set from the village: ./genesis.js villageTech)', 'sandbox-7 shellOf(120)'),
			steel: n(0, 't steel a m² of floor (set from the village)', 'sandbox-7 shellOf(120)'),
			glass: n(0, 't glass a m² of floor (set from the village)', 'sandbox-7 shellOf(120)'),
			mwhPerT: n(0.1, 'MWh per t built', 'rules.js BUILD_MWH_T')
		},
		buildDays: n(365, 'days', 'estimate', true),
		land: n(1, 'm² of land a m² of floor (the dome’s footprint)', 'sandbox-7 capOf(120): the floor is the footprint'),
		life: n(50, 'years (the frame)', 'sandbox-6/numbers.md: upkeep 2 % a year'),
		glassLife: n(30, 'years (the glazing)', 'physics audit (2026-10-13)')
	},
	home: {
		label: 'Dome homes (Dome80 of 40 and Dome40 of 10) of a Tribe COOP',
		good: 'bed',
		kind: 'home',
		capUnit: 'bed',
		kwh: n(160000 / 248 / 365, 'kWh per bed-day (climate: fans, pumps, vents; replaced by the village’s: ./village.js)', 'sandbox-7 shellOf: the home domes’ and the halls’ climate power a bed'),
		heat: n(410000 / 248 / 365, 'kWh heat per bed-day on average (by month; replaced by the village’s)', 'sandbox-7 shellOf: the home domes’ and the halls’ heat beyond their ponds, a bed'),
		runH: n(0.08, 'Aven hours a day per bed', 'estimate', true),
		build: {
			wood: n(1500 / 248, 't glulam and CLT per bed (replaced by the village’s: ./village.js)', 'sandbox-7: the home domes’ struts and CLT floors, and the halls’, a bed'),
			steel: n(465 / 248, 't steel per bed (replaced by the village’s)', 'sandbox-7 shellOf: hubs, ring and connectors', true),
			glass: n(1036 / 248, 't glass per bed (replaced by the village’s)', 'sandbox-7 shellOf: laminated double glazing'),
			mwhPerT: n(0.1, 'MWh per t built', 'rules.js BUILD_MWH_T')
		},
		buildDays: n(180, 'days', 'estimate', true),
		land: n((Math.PI * 75 * 75) / 248, 'm² of land a bed (replaced by the home domes’ footprint a bed)', 'sandbox-7: Dome80 and Dome40 footprints over their beds'),
		life: n(50, 'years (the frame)', 'sandbox-6/numbers.md: upkeep 2 % a year'),
		glassLife: n(30, 'years (the glazing)', 'physics audit (2026-10-13): laminated glazing and its seals last 25–35 years, not 50'),
		learn: { group: 'homes', coef: { wood: n(0.5, 'materials per bed at the floor', 'lighter frames (estimate)', true), heat: n(0.3, 'heat per bed at the floor', 'better glazing (estimate)', true) } }
	},
	timber: {
		label: 'Timber works on hemp, bamboo and woods',
		good: 'wood',
		kind: 'timber',
		capUnit: 't of glulam a year (works)',
		inputs: { logs: n(2, 't of logs per t of glulam', 'sawmill and glulam recovery is about 30–60 % of the log (bark, slabs, kerf, drying shrinkage, planing): 50 % (estimate; physics audit: 45 % of roundwood ends as glulam). The residue goes to heat or compost', true) },
		kwh: n((1000 * 350 + 500 * 600) / 1500, 'kWh per t', 'sandbox-7 FACTORY_RUN: timber 1,000 t at 350 kWh/t (sawing, pressing, CNC; drying on geothermal heat), bamboo scrimber 500 t at 600'),
		runH: n(4 / 100, 'Aven hours a day per t/yr of works', 'estimate', true),
		runLandH: n(0.5 / 1e4, 'Aven hours a day per m² of timber land', 'estimate', true),
		build: {
			wood: n(80 / 150, 't glulam per t/yr', 'sandbox-6/numbers.md: timber works 80 t of planks + 40 t of steel for 150 t a year'),
			steel: n(40 / 150, 't steel per t/yr', 'sandbox-6/numbers.md'),
			mwhPerT: n(0.1, 'MWh per t built', 'rules.js BUILD_MWH_T')
		},
		buildDays: n(90, 'days', 'estimate', true),
		land: n(1000 / 150, 'm² per t/yr of works', 'a factory dome of 0.1 ha (estimate)', true),
		life: n(40, 'years', 'estimate', true),
		learn: { group: 'materials', coef: { yield: n(0.375, 'land per t at the floor', '15 → 40 t/ha a year (RESOURCES.timberLand.maxTHaYear)', true), kwh: n(0.3, 'kWh per t at the floor', '0.5 → 0.15 MWh/t (estimate)', true) } }
	},
	steel: {
		label: 'Steelworks (electric arc furnace on scrap)',
		good: 'steel',
		kind: 'works',
		capUnit: 't of steel a year',
		inputs: { scrap: n(1.1, 't of scrap per t of steel', 'EAF yield ~90 % of the scrap charged (estimate); the scrap is the village’s worn steel (90 % recovered) and scrap bought at the border') },
		kwh: n(650, 'kWh per t', 'sandbox-7 FACTORY_RUN: electric arc furnace on scrap ~400–600 kWh/t and casting the hubs: 650'),
		runH: n(7.5 / 150, 'Aven hours a day per t/yr', 'estimate', true),
		build: { wood: n(70 / 150, 't glulam per t/yr', 'sandbox-6/numbers.md: steelworks 70 t planks + 25 t steel'), steel: n(25 / 150, 't steel per t/yr', 'sandbox-6/numbers.md'), mwhPerT: n(0.1, 'MWh per t built', 'rules.js') },
		buildDays: n(120, 'days', 'estimate', true),
		land: n(1000 / 150, 'm² per t/yr', 'a factory dome of 0.1 ha (estimate)', true),
		life: n(30, 'years', 'estimate', true),
		learn: { group: 'materials', coef: { kwh: n(0.4 / 0.65, 'kWh per t at the floor', 'melting scrap takes ~0.4 MWh/t in theory (estimate)', true) } }
	},
	glass: {
		label: 'Glassworks (laminating and tempering bought float glass)',
		good: 'glass',
		kind: 'works',
		capUnit: 't of glazing a year',
		inputs: { float: n(1.02, 't of float glass per t of glazing', 'cutting loss ~2 % (estimate)', true) },
		kwh: n(300, 'kWh per t', 'sandbox-7 FACTORY_RUN: laminating and laying the cells, 300 kWh a t; float glass is bought (melting it from sand would need soda ash the village cannot make)'),
		runH: n(6 / 500, 'Aven hours a day per t/yr', 'estimate', true),
		build: { wood: n(50 / 1000, 't glulam per t/yr', 'sandbox-6/numbers.md: glassworks 50 t planks + 15 t steel for 1,000 t a year'), steel: n(15 / 1000, 't steel per t/yr', 'sandbox-6/numbers.md'), mwhPerT: n(0.1, 'MWh per t built', 'rules.js') },
		buildDays: n(120, 'days', 'estimate', true),
		land: n(1000 / 500, 'm² per t/yr', 'a factory dome of 0.1 ha (estimate)', true),
		life: n(30, 'years', 'estimate', true),
		learn: { group: 'materials', coef: { kwh: n(0.5, 'kWh per t at the floor', 'lamination at half today’s energy (estimate)', true) } }
	},
	panel: {
		label: 'Panel works (bought cells laid into glass)',
		good: 'panel',
		kind: 'works',
		capUnit: 'kWp a year',
		inputs: { glass: n(0.06, 't of glass per kWp', 'scripts/theos-e2e-sim.mjs SPECS PANEL: 70 kg of materials a kWp'), steel: n(0.01, 't of steel per kWp (frames, boxes)', 'same, split (estimate)', true), cells: n(1, 'kWp of solar cells per kWp', 'the physics audit: a panel needs silicon and silver the village cannot make, so the cells are bought at the border') },
		kwh: n(100, 'kWh per kWp', 'laminating cells into glass (the 1,200 kWh a kWp of making the cells is spent where they are made) (estimate)', true),
		runH: n(5 / 500, 'Aven hours a day per kWp/yr', 'estimate', true),
		build: { wood: n(30 / 500, 't glulam per kWp/yr', 'a works of 500 kWp a year: 30 t planks + 15 t steel (estimate; sandbox-6: 65 t + 40 t for 1,500 t a year)', true), steel: n(15 / 500, 't steel per kWp/yr', 'estimate', true), mwhPerT: n(0.1, 'MWh per t built', 'rules.js') },
		buildDays: n(120, 'days', 'estimate', true),
		land: n(1000 / 500, 'm² per kWp/yr', 'a factory dome of 0.1 ha (estimate)', true),
		life: n(25, 'years', 'estimate', true),
		learn: { group: 'solar', coef: { kwh: n(0.5, 'kWh per kWp at the floor', 'estimate', true), glass: n(0.67, 'glass per kWp at the floor', 'higher efficiency, less glass a kWp (estimate)', true) } }
	},
	goods: {
		label: 'Goods works (household goods, tools, devices)',
		good: 'goods',
		kind: 'works',
		capUnit: 'kg a day',
		inputs: {
			wood: n(0.45 / 1000, 't glulam and hemp fibre per kg', 'a mix by mass, 10 % scrap (estimate)', true),
			steel: n(0.2 / 1000, 't steel per kg', 'estimate', true),
			glass: n(0.45 / 1000, 't glass per kg', 'estimate', true)
		},
		kwh: n(3, 'kWh per kg', 'scripts/theos-e2e-sim.mjs GOODS: 5 kWh a unit (estimate, lower)', true),
		runH: n(5 / 250, 'Aven hours a day per kg/day', 'estimate', true),
		build: { wood: n(30 / 250, 't glulam per kg/day', 'a works of 250 kg a day: 30 t planks, 10 t steel, 10 t glass (estimate)', true), steel: n(10 / 250, 't steel per kg/day', 'estimate', true), glass: n(10 / 250, 't glass per kg/day', 'estimate', true), mwhPerT: n(0.1, 'MWh per t built', 'rules.js') },
		buildDays: n(90, 'days', 'estimate', true),
		land: n(1000 / 250, 'm² per kg/day', 'a factory dome of 0.1 ha (estimate)', true),
		life: n(25, 'years', 'estimate', true),
		learn: { group: 'materials', coef: { scrap: n(1 / 1.1, 'materials per kg at the floor', 'LIMITS.goodsMassFloor: 1.1 → 1.0 t per t'), kwh: n(0.27, 'kWh per kg at the floor', '3 → 0.8 kWh/kg (estimate)', true) } }
	},
	/**
	 * The avenCEO COOP's agent harness (Samuel, 2026-10-13 07:27): the software that runs the village's Avens. It owns no
	 * hardware: it buys inference (accelerator-hours) from the Tribe COOPs and the Village COOP, which own the
	 * accelerators in their utilities domes' data centres (./ai.js), and sells Aven service (Aven hours) to the people.
	 * Its own costs are Aven hours, at the rate card: the harness's upkeep (in step with the hours it serves) and its R&D
	 * (work proposals, ./coops.js payout).
	 */
	harness: {
		label: 'Agent harness: Avens run on inference bought from the hardware owners',
		good: 'compute',
		kind: 'harness',
		capUnit: 'Aven hours a day',
		kwh: n(0, 'kWh per Aven hour', 'the accelerators’ electricity is the hardware owners’ (in the price of inference, ./ai.js)'),
		runH: n(0.02, 'Aven hours a day per Aven hour a day', 'the harness’s upkeep: one Aven hour watches, updates and evaluates 50 Aven hours served (estimate)', true),
		build: { mwh: n(0.0002, 'MWh per Aven hour a day', 'servers for the harness itself (orchestration, memory, logs) in the hardware owners’ halls (estimate)', true) },
		buildDays: n(60, 'days', 'estimate', true),
		land: n(0, 'm² per Aven hour a day', 'software: it stands in the hardware owners’ data centres'),
		life: n(0, 'years', 'software does not wear: its upkeep is Aven hours (runH)'),
		learn: {
			group: 'compute',
			coef: {
				infer: n(0.25, 'inference per Aven hour at the floor (1 = 1/16 accelerator-hour)', 'smaller models, caching and batching: the inference an agent hour needs falls about fourfold (estimate)', true),
				aven: n(0.25, 'harness Aven hours per Aven hour at the floor', 'an Aven learns to keep four times as many Avens running (estimate)', true)
			}
		}
	},
	spring: {
		label: 'Hot spring (fixed by nature)',
		good: 'spring',
		kind: 'spring',
		capUnit: 'bather-hours a day',
		heat: n(2, 'kWh heat per hour', 'RESOURCES.spring.heatKwhPerHour', true),
		runH: n(3 / 150, 'Aven hours a day per bather-hour/day', 'estimate', true),
		build: {},
		buildDays: n(0, 'days', 'cannot be built: fixed by nature'),
		land: n(500 / 150, 'm² per bather-hour/day', 'a pond site of 0.05 ha (estimate)', true),
		life: n(0, 'years', 'no wear')
	},
	// with the dome factory, its lines replace the steel, glass and panel works above (same keys, same place) and add the
	// struts line (DF_TECH)
	...DF_TECH
};

/**
 * Accelerators (the chips the Avens run on) cannot be made in the city: world model 5.3 says "GPUs come from outside
 * (euro border)". A chip fab is a plant of billions of euros and hundreds of megawatts, so no hex has one, as no real
 * town has one: a city buys its chips. Round 4 (Samuel, 2026-10-13 07:27): the hardware belongs to the Tribe COOPs
 * and the Village COOP. They buy accelerators through the euro border (advanced by the MaiaCity COOP's bank and paid
 * back in their own MIND, ./border.js payEur), install them in the data centres of their utilities domes, run them on
 * their power and replace them as they wear; they sell inference (accelerator-hours) to the avenCEO COOP (./ai.js).
 * With the setting chipImport false the city is strictly closed (scenario B23): no accelerator comes in.
 */
const CHIP_EUR = 30000, MWH_EUR = 87.5;
export const CHIPS = {
	eurPerChip: n(CHIP_EUR, '€ per accelerator with its share of the server (an H100-class GPU in an 8-GPU server)', 'an H100-class GPU costs $25,000–40,000 (intuitionlabs.ai GPU price guide, 2025–26), and an 8-GPU HGX H100 server $250,000–320,000 ($31,000–40,000 a GPU with its share of the server); at $1.13 a € (Bank of Finland, 2025 average) €30,000 is used (range 20,000–40,000; cost audit 2026-10-13, was 35,000) (estimate)', true),
	kwAtWall: n(1.3, 'kW per accelerator at the wall, with its share of the server', 'NVIDIA DGX H100 user guide: 10.2 kW maximum for the 8-GPU system, 1.275 kW a GPU'),
	pue: n(1.2, 'power usage effectiveness of a village data hall (cooling and power losses)', 'Uptime Institute Global Data Center Survey 2025: the weighted average stays about 1.54 for the sixth year; hyperscale halls 1.10–1.15. A small hall with free cooling in a central European climate: 1.2 (estimate)', true),
	sessions: n(16, 'Aven sessions an accelerator serves at once', 'the physics audit (2026-10-13): an H100-class accelerator serves 16 agent sessions around the clock (realistic 17–130; the audit’s cautious 16–50)', true),
	life: n(5, 'years an accelerator serves before it is replaced', 'Amazon cut some servers’ useful life from six years to five from January 2025, citing the pace of AI; Meta moved most servers to 5.5 years (company filings, Feb 2025)', true),
	avail: n(0.97, 'share of the year an accelerator can serve', 'Meta’s Llama 3 report: 148 faulty-GPU and 72 HBM3 interruptions in 54 days on 16,384 H100s, about 9 % of the GPUs a year; with repairs and maintenance about 3 % of the hours lost (estimate)', true),
	m2: n(2, 'm² of data hall per accelerator, with its cooling', 'air-cooled racks of one 8-GPU server (about 10 kW) each, aisles and coolers (estimate)', true),
	hallM2: n(700, 'm² of data hall in each utilities dome (and in the centre dome)', 'src/lib/sandbox-7 utilities dome zones: the data centre, 700 m² of each utilities dome'),
	campChips: n(64, 'accelerators the camp’s container data hall holds before the first utilities dome stands', 'a 20-ft container data hall of eight 8-GPU servers, about 85 kW with its cooling, beside the camp’s 200 beds (estimate)', true),
	rackRunH: n(0.01, 'Aven hours per accelerator-hour', 'racks watched and repaired: one Aven hour for 100 accelerator-hours (estimate)', true),
	eurPerMwh: n(MWH_EUR, '€ per MWh of exported electricity (the old flat price; kept for the accelerators’ kWh and the setting exportEurMwh)', 'EU wholesale power ~€80–100 per MWh (2024–25 day-ahead averages); the middle (estimate)', true),
	// what the line really earns: the German day-ahead price, and far less for what the sun makes at noon
	spotEurMwh: n(89.32, '€ per MWh, the German day-ahead average (baseload: what the geothermal plant and the battery sell)', 'Netztransparenz (the transmission operators) via Rödl & Partner, Feb 2026: spot average 8.932 ct/kWh in 2025 (7.946 in 2024)'),
	solarEurMwh: n([115.1, 91.8, 59.4, 37.8, 27.0, 18.4, 32.4, 37.8, 48.6, 75.6, 91.0, 93.7], '€ per MWh of solar electricity by month (Jan first): the market value of solar power, what a MWh sold when the sun shines fetches', 'Netztransparenz Marktwert Solar 2025: January 11.511 and June 1.843 ct/kWh (logicenergy.de), November 9.102 and December 9.373 (pv-magazine.de, 2026-01-08), the year 4.508 (Rödl & Partner, Feb 2026); the other months shaped like 2024 (April 3.795, May 3.161, August 4.263, September 4.512: solarserver.de) and scaled so the year comes to 4.508 (estimate)', true),
	// derived from the two above, never typed in (./genesis.js computes the engine's chipKwh the same way)
	kwhPerChip: n((CHIP_EUR / MWH_EUR) * 1000, 'kWh of exported electricity per accelerator (derived: eurPerChip ÷ eurPerMwh)', 'eurPerChip ÷ eurPerMwh (derived)', true),
	lineKw: n(10000 / 6, 'kW export line, a living hex’s share (the village: 10 MW)', 'the village’s connection: a 20 kV medium-voltage line, the usual connection for a village and for plants up to about 10–20 MW (VDE-AR-N 4110, the German technical rules for medium-voltage connections); larger parks connect at 110 kV (VDE-AR-N 4120), which needs a substation. One 20 kV feeder carries about 10 MVA (estimate). The engine holds it at the quarter hour: the line carries at most 10 MW at any moment (./energy.js lineRoom)', true),
	// the AI-exports experiment (AIX): what a GPU-hour of inference sells for abroad, and how much a small provider sells
	exportEurGpuH: n(2, '€ a GPU-hour of inference sold abroad (an H100-class GPU, on demand)', 'H100 on demand: specialist clouds $2.00–2.40 (GMI Cloud), $2.59–4.29 (RunPod, Lambda), median about $3.37 across tracked providers; one-year contracts rose from $1.70 to $2.35 between Oct 2025 and Mar 2026 (intuitionlabs.ai and akash.network price trackers, 2026). A village provider without a name sells at the low end: about €2 (estimate)', true),
	exportGpus: n(1024, 'GPUs a small provider rents out abroad', 'a small GPU cloud: the 1,024-GPU H100 cluster that GPU-cloud business models use (hosted.ai, 2025); no measured fleet size of small providers was found (estimate)', true),
	exportUtil: n(0.55, 'share of those GPU-hours that find a buyer', 'GPU clouds model 55 % against 85 % utilisation and break even near 70 % on debt (hosted.ai, 2025); non-optimised deployments 20–40 % (estimate)', true)
};

/**
 * Food, in units of 1,000 kcal of the village diet (src/lib/sandbox-7/specs.js DIET: legumes, nuts, chestnuts, roots,
 * vegetables, fruit, eggs and chicken). Yields, the maturity ramp, the weather factor, the indoor yields and the
 * energy for light come from /mnt/project-files/theos/sandbox-8/food-research.md (./food.js reads FOOD).
 */
export const FOOD = {
	unitKcal: n(1000, 'kcal a unit', 'round 3 brief: 1 unit = 1,000 kcal of the village diet mix'),
	kcalNeed: n(DAY.kcal, 'kcal a person a day', 'src/lib/sandbox-7/specs.js DAY'),
	proteinNeed: n(DAY.protein, 'g of protein a person a day', 'src/lib/sandbox-7/specs.js DAY'),
	dietProtein: n((DAY.protein / DAY.kcal) * 1000, 'g of protein per 1,000 kcal of the diet', 'src/lib/sandbox-7/specs.js DAY')
};

/**
 * The euro border (paper §11.4, §12.4): what the village cannot make, its COOPs buy outside with euros from the shared
 * euro reserve, filled by the founding euros left over and by exports (electricity a COOP buys in MIND and sells across
 * the line). Food COOPs buy food, the works buy their raw inputs, the Tribe COOPs and the Village COOP accelerators. No person holds euros,
 * no MIND is made from euros, HEARTS never buy anything.
 */
const DIET_EUR_KG = { legumes: 1.5, nuts: 7, chestnuts: 3, roots: 0.4, vegetables: 1.2, fruit: 1.25, eggs: 3, chicken: 4.5 };
const dietEurDay = Object.entries(DIET).reduce((a, [k, d]) => a + (d.g / 1000) * DIET_EUR_KG[k], 0);
/** a dome-factory import as a BORDER record (sandbox-7 specs.js DF_IMPORTS: its price, source and how it was worked out) */
const dfImport = (k, u) => {
	const x = DF_IMPORTS[k];
	return n(x.eur, u, `sandbox-7 DF_IMPORTS.${k}: ${x.label}${x.range ? ` (${x.range})` : ''}: ${x.why}${x.url ? ` (${x.url})` : ''}`, !!x.est);
};
export const BORDER = {
	foodEur: n((dietEurDay / DAY.kcal) * 1000, '€ per 1,000 kcal of the diet, wholesale, delivered', `the diet's day at wholesale, €${dietEurDay.toFixed(2)} for ${Math.round(DAY.kcal)} kcal: € a kg ${Object.entries(DIET_EUR_KG).map(([k, v]) => k + ' ' + v).join(', ')}. Apples wholesale €1.22–1.29 a kg (AgrarMarkt Austria, June and October 2025); the rest estimates from German wholesale and producer prices`, true),
	foodProtein: n((DAY.protein / DAY.kcal) * 1000, 'g of protein per 1,000 kcal of food bought', 'bought in the diet’s own mix (src/lib/sandbox-7/specs.js DAY)'),
	logsEur: n(105 / 0.45, '€ a t of logs (dry)', 'spruce sawlogs B/C 2b €84–120 a solid m³ (LWK Niedersachsen, May 2025), ~€98 in Bavaria; €105 a m³ at ~0.45 dry t a m³', true),
	scrapEur: n(300, '€ a t of steel scrap', 'sandbox-7 SOURCES.steel: scrap ~300 €/t (EU 2025)'),
	floatEur: n(650, '€ a t of float glass', 'float glass ~USD 680 a t in Germany (IMARC price trend, 2026 edition); EU import unit values ~€2,000 a t include worked glass (estimate)', true),
	cellsEur: DF_ENGINE
		? n(DF_IMPORTS.cells.eur * 1000, '€ per kWp of solar cells', `sandbox-7 DF_IMPORTS.cells: ${DF_IMPORTS.cells.label}, ${DF_IMPORTS.cells.range} (${DF_IMPORTS.cells.url}): ${DF_IMPORTS.cells.why} (was €60 a kWp with a see-through premium before the dome factory)`, true)
		: n(60, '€ per kWp of solar cells', 'TOPCon cells $0.036–0.040 a W (pv magazine, 9 May 2025) at $1.13 a € (Bank of Finland, 2025 average): ~€0.035 a W, €60 a kWp with the see-through cells’ premium (range 40–100; cost audit 2026-10-13, was 300)', true),
	// the dome factory's raw inputs (sandbox-7 specs.js DF_IMPORTS, 2025/26 prices, read from there), and what a raw unit
	// costs with the rest of its line's kit: the price the engine's dome-factory COOPs pay at the border
	...(DF_ENGINE
		? {
				lamellaEur: dfImport('lamella', '€ a m³ of spruce lamellas'),
				adhesiveEur: dfImport('adhesive', '€ of MUF glue a m³ of glulam'),
				kvhEur: dfImport('kvh', '€ a m³ of C24 structural timber (the cassettes’ frames)'),
				plateEur: dfImport('plate', '€ a t of S355 plate'),
				galvanisingEur: dfImport('galvanising', '€ a t of hubs galvanised, with the haul'),
				boltsEur: dfImport('bolts', '€ of bolt sets and pins a t of hubs'),
				weldEur: dfImport('weld', '€ of wire, gas, tips and abrasives a t of hubs'),
				lowIronEur: dfImport('lowIron', '€ a m² of sheet, low-iron over clear float'),
				lowEEur: dfImport('lowE', '€ a m² of sheet, low-E over clear float'),
				pvbEur: dfImport('pvb', '€ a m² of PVB interlayer'),
				edgeEur: dfImport('edge', '€ of insulating-glass edge a m² of glazing'),
				gasketsEur: dfImport('gaskets', '€ of gaskets and cover caps a m² of glazing'),
				stringingEur: dfImport('stringing', '€ of ribbons, busbars and junction boxes a m² of solar pane'),
				lamellasKitEur: n(DF_ENGINE.unit.struts.kitEur, '€ a m³ of lamellas and C24 with their glue (the struts line’s kit)', `sandbox-7 DF_PARTS: struts €${DF_PARTS.strut.eur} a m³ (${DF_LAMELLAS} m³ of lamellas and the glue), cassette frames €${DF_PARTS.cassette.eur} a m² (C24), mixed ${Math.round(100 * DF_ENGINE.gs)} % glulam by volume: €${Math.round(DF_ENGINE.unit.struts.eur)} a t of struts and frames at ${DF_ENGINE.unit.struts.raw.toFixed(2)} m³ a t (bought finished €${Math.round(DF_ENGINE.unit.struts.bought)})`, true),
				plateKitEur: n(DF_ENGINE.unit.steel.kitEur, '€ a t of plate with its galvanising, bolts and weld consumables, less the offcuts', `sandbox-7 DF_PARTS.hub: €${Math.round(DF_PARTS.hub.eur)} a t of hubs (plate, galvanising, bolts, wire and gas, the offcuts back at €300 a t) over ${DF_ENGINE.plateT.toFixed(2)} t of plate (bought finished €${DF_PARTS.hub.bought})`, true),
				floatKitEur: n(DF_ENGINE.unit.glass.kitEur, '€ a t of float glass with its low-iron and low-E sheets, PVB, edge and gaskets', `sandbox-7 DF_PARTS.glazing: €${DF_PARTS.glazing.eur.toFixed(2)} a m² of glazing over ${((DF_GLAZING.kg * (1 + DF_GLAZING.waste)) / 1000).toFixed(4)} t of float a m² (bought finished €${DF_PARTS.glazing.bought} a m²)`, true),
				cellsKitEur: n(DF_ENGINE.unit.panel.kitEur, '€ a kWp of cells with their PVB layer, ribbons and junction box', `sandbox-7 DF_PARTS.solar: €${DF_PARTS.solar.eur.toFixed(2)} a m² of solar pane over ${(DF_ENGINE.cellsM2).toFixed(4)} kWp of cells a m² (bought finished €${DF_PARTS.solar.bought} a m²)`, true)
			}
		: {}),
	// the materials bought when the village's works cannot keep up are Sandbox 6's own, at its design package's prices
	// (sandbox-7 specs.js DESIGN, PRICES, DENSITY): read from there, never copied
	glulamEur: n(PRICES.glulam.eur / DENSITY.glulam, DF_ENGINE ? '€ a t of glulam, bought finished when the timber works and the dome factory’s struts line cannot keep up' : '€ a t of glulam, bought when the timber works cannot keep up', `sandbox-7 PRICES.glulam (design package ${DESIGN}): ${PRICES.glulam.label}, €${PRICES.glulam.eur} a m³ (range ${PRICES.glulam.range}) at ${DENSITY.glulam} t a m³ (cost audit 2026-10-13)`, true),
	steelEur: n(PRICES.hubs.eur, DF_ENGINE ? '€ a t of hubs, bought finished when the dome factory’s hub line cannot keep up' : '€ a t of steel, bought when the steelworks cannot keep up', `what the village’s ${DF_ENGINE ? 'dome factory' : 'steelworks'} makes is the domes’ hubs, ring and connectors, so what it buys stands for finished hubs: sandbox-7 PRICES.hubs (design package ${DESIGN}): ${PRICES.hubs.label}, €${PRICES.hubs.eur} a t (range ${PRICES.hubs.range}; cost audit 2026-10-13)`, true),
	glazingEur: n(PRICES.glass.eur / DENSITY.glass, DF_ENGINE ? '€ a t of laminated glazing, bought finished when the dome factory’s glazing line cannot keep up' : '€ a t of laminated glazing, bought when the glassworks cannot keep up', `sandbox-7 PRICES.glass: ${PRICES.glass.label}, €${PRICES.glass.eur} a m² (range ${PRICES.glass.range}) at ~${DENSITY.glass} t a m² (cost audit 2026-10-13)`, true),
	panelsEur: n(440, DF_ENGINE ? '€ per kWp of solar panes, bought finished when the dome factory’s solar line cannot keep up' : '€ per kWp of see-through solar glass, bought when the panel works cannot keep up', 'glass-glass modules €0.16–0.22 a Wp (ema-energiewelt.de, 2026); cells laid into a pane at ~€100 a m² and ~1,000 kWh a kWp: €440 a kWp (range 200–700; cost audit 2026-10-13, was 1,000)', true),
	accountDays: n(60, 'days of its imports a COOP keeps in its euro account', 'what a COOP exports ahead, so a dark week does not stop its imports (estimate)', true),
	importAhead: n(30, 'days of supply a COOP looks ahead when it buys at the border', 'estimate', true),
	foodStoreDays: n(90, 'days of food in the stores at founding (bought before day 0)', 'round 3 brief: "a few months of imported food" (estimate)', true),
	storesDays: n(30, 'days of materials and goods in the stores at founding', 'estimate', true),
	gridEurKwh: n(0.18, '€ a kWh of grid electricity bought through the line during the build-out', 'BDEW Strompreisanalyse 2025: German industrial customers pay about 17–18 ct a kWh with network charges, levies and taxes (no VAT); the village buys only while its own solar, batteries and (later) geothermal fall short of its basics and its works, and only until the build-out is done (estimate)', true),
	bankPaybackYears: n(30, 'years over which the MaiaCity COOP’s bank exports to pay its founders back the euros the village drew', 'a policy, not physics (estimate): the line and the bank’s treasury bound it', true),
	reserveYears: n(1, 'years of the village’s food at wholesale left in the euro reserve at founding', 'round 3 brief: the founding euros left over (estimate; scenario F01 tests none and three years)', true)
};

/** the goods of the world, in order; basics first */
export const GOODS = [
	{ id: 'food', label: 'Food', unit: '1,000 kcal', basic: true, store: true, horizon: 30 },
	{ id: 'water', label: 'Water', unit: 'L', basic: true, store: true, horizon: 28 },
	{ id: 'energy', label: 'Energy', unit: 'kWh', basic: true, store: false, horizon: 7 },
	{ id: 'bed', label: 'A bed', unit: 'bed-day', basic: true, store: false, horizon: 60 },
	{ id: 'wood', label: 'Glulam', unit: 't', basic: false, store: true, horizon: 30 },
	{ id: 'steel', label: 'Steel', unit: 't', basic: false, store: true, horizon: 30 },
	{ id: 'glass', label: 'Glass', unit: 't', basic: false, store: true, horizon: 30 },
	{ id: 'panel', label: 'Solar panels', unit: 'kWp', basic: false, store: true, horizon: 30 },
	{ id: 'goods', label: 'Goods', unit: 'kg', basic: false, store: true, horizon: 14 },
	{ id: 'spring', label: 'Hot spring', unit: 'h', basic: false, store: false, horizon: 14 },
	{ id: 'compute', label: 'Aven service', unit: 'h', basic: false, store: false, horizon: 14 }
];

/**
 * Genesis prices in R. By default (rIndex 'hearts') R is anchored to HEARTS: the MIND a HEART makes is worth 1 R on
 * average (./pools.js updatePrices); the setting rIndex 'basket' uses the paper's unit instead (the geometric mean of
 * the SOLAR-, HABITAT- and CITYmind prices). These are the first guesses for the day-0 full costs and the base-year
 * prices of the living-standard index; from day 1 every price is found by its seller (no cap, no floor but the
 * seller's own reservation price). Chosen so a basic bundle costs about a tenth of the 12 MIND a person's own HEARTS
 * make a day.
 */
export const GENESIS_PRICE_R = n(
	{ food: 0.2, water: 0.002, energy: 0.05, bed: 0.5, wood: 400, steel: 800, glass: 300, panel: 100, goods: 1, spring: 1, compute: 0.1 },
	'R a unit',
	'calibration guesses for day 0 (estimate): the world moves them from there',
	true
);

/** the Aven rate card: R per Aven work hour, scaled with the HEARTS a day setting so that money stays a veil */
export const AVEN_RATE_R = n(2, 'R per Aven hour at 24 HEARTS a day', 'the Aven rate anchor of scripts/theos-e2e-sim.mjs (2 R an Aven hour). It is a rate card, not a wage: it prices work proposals, and no human is paid. By default it is indexed to the HEARTS issued a day (scaled by HEARTS a day ÷ 24, setting rateIndexed), so doubling HEARTS doubles it: X9 and B28 show neutrality under that rule, and B28 reports the world with the card fixed in R (estimate)', true);

/**
 * The village at founding (day 0 = move-in): built from imports before day 0 (./village.js gives the domes, land,
 * cells, batteries and geothermal from Sandbox 6's design). The numbers here are what the design leaves open, a living
 * hex's share (scaled by people ÷ 250, ./genesis.js seedPlants).
 */
/** the utilities dome's floor the solar COOPs rent (sandbox-7 KINDS.util120: batteries, and a hydrogen store where the design package has one) */
const UTIL_SOLAR_M2 = Object.fromEntries(['battery', 'hydrogen'].map((b) => [b, KINDS.util120.zones.filter((z) => z.block === b).reduce((a, z) => a + z.m2, 0)]));
export const STARTING_CAPITAL = n(
	{
		forestAgeYears: 0,
		indoorAgeDays: 0,
		tankPerBed: 2.8,
		tankFill: 0.6,
		wellM3Day: 20,
		geoStages: 1,
		woodlandAgeYears: 0,
		timberSplit: [0.5, 0.5],
		steelSplit: [0.5, 0.5],
		glassSplit: [0.5, 0.5],
		panelWorksKwpYear: [500, 500],
		// the dome factory's lines (DF_ENGINE), each shared by two COOPs, half each
		dfSplit: [0.5, 0.5],
		goodsWorksKgDay: [250, 250],
		springHours: [150, 150],
		homesSplit: 'one Tribe COOP a hex (Samuel, 2026-10-13 06:50): each living hex’s owns its 290 beds and its food and utilities domes; the centre hex’s, the Village COOP (07:00), owns the centre dome, the eight factory domes and the geothermal plant',
		rentedM2: {
			food: 'the whole of each food dome (11,310 m² of floor) and the gardens in the utilities dome: the food COOPs',
			water: '1,200 m² of each utilities dome (membrane bioreactor and wetland): the City COOP’s water works',
			solar: `${UTIL_SOLAR_M2.battery + UTIL_SOLAR_M2.hydrogen} m² of each utilities dome (${UTIL_SOLAR_M2.hydrogen ? `batteries ${UTIL_SOLAR_M2.battery} m², hydrogen ${UTIL_SOLAR_M2.hydrogen} m²` : 'the batteries; no hydrogen store in this design package'}): the solar COOPs`,
			compute: '700 m² of each utilities dome (the data centre): the Tribe COOP’s own accelerators (and the Village COOP’s in the centre dome), not rented',
			goods: '1,600 m² of each utilities dome (the workshops): the goods works',
			works: DF_ENGINE
				? `the timber and bamboo domes (timber works); the dome factory (the glass & solar works' site) by its lines' floor: the struts line ${DF_ENGINE.floor.struts.toLocaleString('en-US')} m² (the timber COOPs), hubs ${DF_ENGINE.floor.steel.toLocaleString('en-US')} m² (the steel COOPs), glazing ${DF_ENGINE.floor.glass.toLocaleString('en-US')} m² (the glass COOPs), solar ${DF_ENGINE.floor.panel.toLocaleString('en-US')} m² (the panel COOPs); its aisles and loading (${(Math.round(DF_ENGINE.domeM2) - DF_ENGINE.floorAll).toLocaleString('en-US')} m²) the Village COOP's own`
				: 'the timber and bamboo domes (timber works), the steelworks dome, the glass & solar dome (glass works 70 %, panel works 30 %, estimate)',
			halls: `the centre dome (community halls) and the hemp, lime, clay${DF_ENGINE ? ', steel' : ''} and recycling domes, whose works the engine does not trade${DF_ENGINE ? ' (the steelworks recycles and makes the steel that is not a dome part)' : ''}: rented by the six living Tribe COOPs for their residents, a sixth each`
		},
		accelerators: 'none at founding: the hardware owners buy them as the avenCEO COOP’s inference demand grows (./ai.js), the camp’s first server on day 0'
	},
	'',
	'round 3: the village is founded on day 0 (outdoor food forest and woodland planted, food domes planted, stores bought). Works sizes from sandbox-7 FACTORY_RUN; the panel and goods works, the warm ponds and the Aven-service halls a living hex’s share as in round 2 (estimate)',
	true
);

/** every catalog record as a flat list, for the report: [path, record] */
export function catalogList() {
	const out = [];
	const walk = (o, path) => {
		if (o && typeof o === 'object' && 'v' in o && 'src' in o) return void out.push([path, o]);
		if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path ? path + '.' + k : k);
	};
	walk({ MONTHLY, WEATHER, PERSON, ENERGY_SOURCES, RESOURCES, LIMITS, LEARNING, STANDING_MWH_T, TECH, CHIPS, FOOD, BORDER, GENESIS_PRICE_R, AVEN_RATE_R, STARTING_CAPITAL }, '');
	return out;
}
