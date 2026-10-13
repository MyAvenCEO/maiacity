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
 * The field is one living hex of our village design (`sandbox-6/numbers.md`, `energy/village-energy.md`,
 * `dome-research/dome-sizes.md`): a great dome of 248 beds and a dome of 32, the food forest round them, 10 ha of
 * hemp, bamboo and woods, see-through solar cells on the dome glass, and this hex's sixth of the village centre's
 * geothermal plant. The hex's share of the village's iron and sand ground gives its ore and sand.
 *
 * Units, everywhere in Sandbox 8: food in kg, water in L, energy in kWh (electricity; heat is kWh_th), a bed in
 * bed-days, building materials in tonnes, solar panels in kWp, household goods in kg, hot-spring time in hours.
 * Money is never in here: prices are found by the COOPs each day.
 */

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
	food: n(9.87 / 7, 'kg a day', 'src/lib/sandbox-6/food.js DIET: 9.87 kg a week (European land-use table)'),
	water: n(100, 'L a day', 'src/lib/sandbox-6/food.js: 150 L used, 50 L of it greywater for crops, so 100 L fresh'),
	energy: n(900 / 365, 'kWh a day', 'sandbox-6/numbers.md: 900 kWh a year at home in a shared dome'),
	bed: n(1, 'bed', 'one bed a person'),
	satiation: {
		food: n((9.87 / 7) * 1.25, 'kg a day', 'a quarter more than need: better and more varied food (estimate)', true),
		water: n(150, 'L a day', 'src/lib/sandbox-6/food.js WATER_L: everything a person uses (estimate as a ceiling)', true),
		energy: n((900 / 365) * 3, 'kWh a day', 'three times home use: devices, cooking, e-bikes (estimate)', true),
		goods: n(3, 'kg a day', 'household goods, tools, clothes, devices: about 1.1 t a year (estimate)', true),
		spring: n(2, 'h a day', 'two hours at the hot spring (estimate)', true),
		compute: n(24, 'h a day', 'Aven services (learning, games, design, care, errands): at most one Aven working for a person around the clock (estimate)', true)
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
		kgYearAt100: n(126000 / 260000, 'kg per m² a year at year 10 (100 % of 248 people)', 'sandbox-6/numbers.md: 26 ha give 126 t at year 10, 189 t from year 15'),
		ramp: n('10 % a year of age, 150 % from year 15', '', 'src/lib/sandbox-6/food.js forestShare'),
		kwhPerKg: n(0.3, 'kWh per kg (cold store, processing, pumping)', 'world model 5.3: ~0.3–1 kWh/kg (estimate, low end)', true),
		rotPerDay: n(0.0005, 'share of the store a day', 'preserved food: nuts, grain, roots, dried and bottled fruit (estimate)', true),
		maxKgM2Year: n(3, 'kg per m² a year (physical floor of land per kg)', 'photosynthesis: ≤ 4.6 % of sunlight for C3, field peaks ~3.5 % (Zhu, Long, Ort 2008); intensive mixed systems 2–5 kg/m² (estimate)', true),
		peters2016: n('0.13–1.08 ha a person a year for ten US diets', '', 'Peters et al. 2016, Elementa: our 0.07–0.105 ha is below the lowest; the riskiest number (test ±50 %)')
	},
	greenhouse: {
		kgM2Year: n(4.5, 'kg per m² a year under glass', 'src/lib/sandbox-7/specs.js FOREST indoor: vegetables 45 t/ha, fruit 35, roots 30, layers stacked 1.3× (estimate)', true),
		maxKgM2Year: n(15, 'kg per m² a year (light-limited)', 'estimate', true),
		kwhPerKg: n(0.5, 'kWh per kg (fans, pumps, processing)', 'estimate', true),
		heatKwhPerM2Year: n(430000 / 17671, 'kWh heat per m² of floor a year', 'energy/village-energy.md: 0.43 GWh a year for a great dome of 17,671 m² floor'),
		lifeYears: n(50, 'years', 'as a dome: 2 % a year upkeep (sandbox-6/numbers.md)')
	},
	timberLand: {
		tHaYear: n(15, 't of logs per ha a year', 'src/lib/sandbox-6/rules.js FIELD_T: 10 ha of hemp, bamboo, woods give 150 t; German forests grow 9.4 m³/ha (Thünen BWI 2022): needs fast hemp and bamboo (flag)'),
		maxTHaYear: n(40, 't per ha a year (physical ceiling)', 'record biomass of bamboo and miscanthus, a part of photosynthesis limits (estimate)', true),
		ramp: n([0.2, 0.5, 0.8, 1], 'share of yield in years 1–4 of new land', 'hemp is annual, bamboo takes 3–5 years (estimate)', true),
		standingYears: n(2, 'years of growth that can stand uncut', 'beyond it the stand stops adding wood (estimate)', true)
	},
	ore: {
		tYearPerPit: n(250, 't of iron ore a year per pit', 'src/lib/sandbox-6/rules.js ironmine: 10 rounds of 25 t a year'),
		pitsMax: n(2, 'pits', "the hex's share of the village's iron ground (estimate)", true),
		tPerPit: n(20000, 't of ore in a pit', 'a small bog-iron or ironstone working: about 80 years at 250 t a year (estimate); a pit worked out gives nothing more', true)
	},
	sand: {
		tYearPerPit: n(600, 't of glass sand a year per pit', 'src/lib/sandbox-6/rules.js glassworks: 100 rounds of 12 t a sand hex, halved for a pit (estimate)', true),
		pitsMax: n(2, 'pits', "the hex's share of the village's sand ground (estimate)", true),
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
		kwh: n(0.3, 'kWh per kg', 'RESOURCES.foodForest.kwhPerKg', true),
		runH: n(0.8 / 1e4, 'Aven hours a day per m² (0.8 h a ha)', 'care, picking robots, cold store (estimate)', true),
		build: { mwh: n(0.5 / 1e4, 'MWh per m² planted', 'planting and irrigation (estimate)', true) },
		buildDays: n(60, 'days to plant', 'estimate', true),
		land: n(1, 'm² per m²', ''),
		life: n(0, 'years', 'perennial: no wear modelled'),
		learn: { group: 'food', coef: { yield: n(0.243, 'land per kg, share of today at the floor', '0.727 → 3 kg/m² a year (RESOURCES.foodForest.maxKgM2Year)', true) } }
	},
	greenhouse: {
		label: 'Growing dome (indoor food forest under glass)',
		good: 'food',
		kind: 'greenhouse',
		capUnit: 'm² of floor under glass',
		kwh: n(0.5, 'kWh per kg', 'RESOURCES.greenhouse.kwhPerKg', true),
		runH: n(5 / 3000, 'Aven hours a day per m²', 'estimate', true),
		build: {
			wood: n(1500 / 17671, 't glulam per m² of floor', 'great dome: 1,500 t of glulam over 17,671 m² (sandbox-6/numbers.md, dome-sizes.md)'),
			steel: n(200 / 17671, 't steel per m²', 'great dome: 200 t of joints'),
			glass: n(1000 / 17671, 't glass per m²', 'great dome: 1,000 t of glazing'),
			mwhPerT: n(0.1, 'MWh per t built', 'src/lib/sandbox-6/rules.js BUILD_MWH_T')
		},
		buildDays: n(120, 'days', 'estimate', true),
		land: n(1, 'm² per m²', ''),
		life: n(50, 'years', 'RESOURCES.greenhouse.lifeYears'),
		learn: { group: 'food', coef: { yield: n(0.3, 'land per kg at the floor', '4.5 → 15 kg/m² a year (estimate)', true), kwh: n(0.4, 'kWh per kg at the floor', '0.5 → 0.2 (estimate)', true) } }
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
	home: {
		label: 'Dome homes',
		good: 'bed',
		kind: 'home',
		capUnit: 'bed',
		kwh: n(160000 / 248 / 365, 'kWh per bed-day (climate: fans, pumps, vents)', 'dome-research/dome-sizes.md v2, Dome150: climate power 0.16 GWh a year'),
		heat: n(410000 / 248 / 365, 'kWh heat per bed-day on average (by month)', 'dome-research/dome-sizes.md v2, Dome150: 1.75 GWh heat need, 1.34 of it from the pond, 0.41 GWh from outside'),
		runH: n(0.08, 'Aven hours a day per bed', 'estimate', true),
		build: {
			wood: n(1500 / 248, 't glulam per bed', 'sandbox-6/numbers.md: great dome 1,500 t of glulam struts'),
			steel: n(465 / 248, 't steel per bed', 'dome-research/dome-sizes.md v2, Dome150: hub steel 220–590 t and ring steel 60 t, so 280–650 t; the middle, 465 t (estimate)', true),
			glass: n(1036 / 248, 't glass per bed', 'dome-research/dome-sizes.md v2, Dome150: 1,036 t of glass'),
			mwhPerT: n(0.1, 'MWh per t built', 'rules.js BUILD_MWH_T')
		},
		buildDays: n(180, 'days', 'estimate', true),
		land: n((Math.PI * 75 * 75) / 248, 'm² of dome floor a bed', 'dome-sizes.md: Dome150 floor 17,671 m² over 248 beds'),
		life: n(50, 'years', 'sandbox-6/numbers.md: upkeep 2 % a year'),
		learn: { group: 'homes', coef: { wood: n(0.5, 'materials per bed at the floor', 'lighter frames (estimate)', true), heat: n(0.3, 'heat per bed at the floor', 'better glazing (estimate)', true) } }
	},
	timber: {
		label: 'Timber works on hemp, bamboo and woods',
		good: 'wood',
		kind: 'timber',
		capUnit: 't of glulam a year (works)',
		inputs: { logs: n(2, 't of logs per t of glulam', 'sawmill and glulam recovery is about 30–60 % of the log (bark, slabs, kerf, drying shrinkage, planing): 50 % (estimate). The residue goes to heat or compost. rules.js (15 t of logs → 15 t of planks, 100 %) is generous', true) },
		kwh: n(500, 'kWh per t', 'rules.js timber works: 7.5 MWh per 15 t (0.5 MWh/t)'),
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
		label: 'Steelworks (electric furnace on the pit ore)',
		good: 'steel',
		kind: 'works',
		deposit: 'ore',
		capUnit: 't of steel a year',
		inputs: { ore: n(25 / 15, 't of ore per t of steel', 'rules.js steelworks: 25 t of ore → 15 t of steel') },
		kwh: n(3600, 'kWh per t', 'rules.js steelworks: 54 MWh per 15 t (3.6 MWh/t)'),
		runH: n(7.5 / 150, 'Aven hours a day per t/yr', 'estimate', true),
		build: { wood: n(70 / 150, 't glulam per t/yr', 'sandbox-6/numbers.md: steelworks 70 t planks + 25 t steel'), steel: n(25 / 150, 't steel per t/yr', 'sandbox-6/numbers.md'), mwhPerT: n(0.1, 'MWh per t built', 'rules.js') },
		buildDays: n(120, 'days', 'estimate', true),
		land: n(1000 / 150, 'm² per t/yr', 'a factory dome of 0.1 ha (estimate)', true),
		life: n(30, 'years', 'estimate', true),
		learn: { group: 'materials', coef: { kwh: n(2.9 / 3.6, 'kWh per t at the floor', 'LIMITS.steelMinMwhT') } }
	},
	glass: {
		label: 'Glassworks (electric furnace on the pit sand)',
		good: 'glass',
		kind: 'works',
		deposit: 'sand',
		capUnit: 't of glass a year',
		inputs: { sand: n(1.2, 't of sand per t of glass', 'rules.js glassworks: 12 t of sand, soda and lime → 10 t') },
		kwh: n(1300, 'kWh per t', 'rules.js glassworks: 13 MWh per 10 t (1.3 MWh/t)'),
		runH: n(6 / 500, 'Aven hours a day per t/yr', 'estimate', true),
		build: { wood: n(50 / 1000, 't glulam per t/yr', 'sandbox-6/numbers.md: glassworks 50 t planks + 15 t steel for 1,000 t a year'), steel: n(15 / 1000, 't steel per t/yr', 'sandbox-6/numbers.md'), mwhPerT: n(0.1, 'MWh per t built', 'rules.js') },
		buildDays: n(120, 'days', 'estimate', true),
		land: n(1000 / 500, 'm² per t/yr', 'a factory dome of 0.1 ha (estimate)', true),
		life: n(30, 'years', 'estimate', true),
		learn: { group: 'materials', coef: { kwh: n(0.69 / 1.3, 'kWh per t at the floor', 'LIMITS.glassMinMwhT') } }
	},
	panel: {
		label: 'Panel works (cells laid into glass)',
		good: 'panel',
		kind: 'works',
		capUnit: 'kWp a year',
		inputs: { glass: n(0.06, 't of glass per kWp', 'scripts/theos-e2e-sim.mjs SPECS PANEL: 70 kg of materials a kWp'), steel: n(0.01, 't of steel per kWp (frames, boxes)', 'same, split (estimate)', true) },
		kwh: n(1200, 'kWh per kWp', 'scripts/theos-e2e-sim.mjs SPECS PANEL: 1,200 kWh a kWp; Fraunhofer ISE payback ~1.1 years'),
		runH: n(5 / 500, 'Aven hours a day per kWp/yr', 'estimate', true),
		build: { wood: n(30 / 500, 't glulam per kWp/yr', 'a works of 500 kWp a year: 30 t planks + 15 t steel (estimate; sandbox-6: 65 t + 40 t for 1,500 t a year)', true), steel: n(15 / 500, 't steel per kWp/yr', 'estimate', true), mwhPerT: n(0.1, 'MWh per t built', 'rules.js') },
		buildDays: n(120, 'days', 'estimate', true),
		land: n(1000 / 500, 'm² per kWp/yr', 'a factory dome of 0.1 ha (estimate)', true),
		life: n(25, 'years', 'estimate', true),
		learn: { group: 'solar', coef: { kwh: n(0.33, 'kWh per kWp at the floor', '1.2 → 0.4 MWh/kWp: thin film, tandems (estimate)', true), glass: n(0.67, 'glass per kWp at the floor', 'higher efficiency, less glass a kWp (estimate)', true) } }
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
	compute: {
		label: 'Aven services: hours of Aven work bought as a service, run on accelerators',
		good: 'compute',
		kind: 'service',
		capUnit: 'service-hours a day',
		kwh: n(0.2, 'kWh per service-hour', 'a 700 W accelerator (NVIDIA H100 SXM datasheet) serving ~4 sessions, with cooling (PUE ~1.2) (estimate)', true),
		runH: n(1, 'Aven hours a day per service-hour a day', 'the service is an Aven at work: one Aven hour per hour delivered, at the rate card'),
		build: {
			chips: n(1 / 96, 'accelerators per service-hour a day', 'one accelerator serves ~4 sessions around the clock: 96 service-hours a day (estimate)', true),
			steel: n(0.03 / 96, 't of steel per service-hour a day', 'a ~30 kg server slot per accelerator, 96 service-hours a day each (estimate)', true),
			mwh: n(0.2 / 96, 'MWh per service-hour a day', 'racks, cooling and installation in the hall (estimate); the accelerator itself is made outside', true)
		},
		buildDays: n(60, 'days', 'estimate', true),
		land: n(2 / 96, 'm² per service-hour a day', 'a compute hall: ~2 m² per accelerator with cooling (estimate)', true),
		life: n(5, 'years', 'accelerators are replaced after ~5 years (estimate)', true),
		learn: {
			group: 'compute',
			coef: {
				kwh: n(0.1, 'kWh per service-hour at the floor', 'Koomey: ~10× less energy per computation in a decade; Landauer is far below (estimate)', true),
				aven: n(0.25, 'Aven hours per service-hour at the floor', 'an Aven learns to serve about four people at once (estimate)', true)
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
	}
};

/**
 * Accelerators (the chips Aven services run on) cannot be made in the city: world model 5.3 says "GPUs come from
 * outside (euro border)". The only way in is the border: a COMPUTE COOP buys electricity from the energy COOPs (a
 * real sale, paid in MIND, with Law 5) and the border line carries it out; each accelerator costs the electricity its
 * price buys at a wholesale power price. Nobody in the city holds euros: the border is a barter of exported
 * electricity for accelerators at a fixed rate, and the export line caps how much can leave a day. Without it (setting
 * chipImport false) the city is strictly closed, and its accelerators wear out after five years.
 */
export const CHIPS = {
	kwhPerChip: n(400000, 'kWh of exported electricity per accelerator', 'an H100-class accelerator ~€30,000–40,000 (2024–25 list prices) ÷ EU wholesale power ~€80–100 per MWh ≈ 300–500 MWh; the middle (estimate)', true),
	lineKw: n(1000, 'kW export line', 'a medium-voltage line from the hex to the grid (estimate)', true),
	spare: n(2, 'accelerators in each COMPUTE COOP’s store at genesis', 'a spare or two per hall (estimate)', true)
};

/** the goods of the world, in order; basics first */
export const GOODS = [
	{ id: 'food', label: 'Food', unit: 'kg', basic: true, store: true, horizon: 30 },
	{ id: 'water', label: 'Water', unit: 'L', basic: true, store: true, horizon: 28 },
	{ id: 'energy', label: 'Energy', unit: 'kWh', basic: true, store: false, horizon: 7 },
	{ id: 'bed', label: 'A bed', unit: 'bed-day', basic: true, store: false, horizon: 60 },
	{ id: 'wood', label: 'Glulam', unit: 't', basic: false, store: true, horizon: 30 },
	{ id: 'steel', label: 'Steel', unit: 't', basic: false, store: true, horizon: 30 },
	{ id: 'glass', label: 'Glass', unit: 't', basic: false, store: true, horizon: 30 },
	{ id: 'panel', label: 'Solar panels', unit: 'kWp', basic: false, store: true, horizon: 30 },
	{ id: 'goods', label: 'Goods', unit: 'kg', basic: false, store: true, horizon: 14 },
	{ id: 'spring', label: 'Hot spring', unit: 'h', basic: false, store: false, horizon: 14 },
	{ id: 'compute', label: 'Aven services', unit: 'h', basic: false, store: false, horizon: 14 }
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
	{ food: 0.3, water: 0.002, energy: 0.05, bed: 0.5, wood: 400, steel: 800, glass: 300, panel: 100, goods: 1, spring: 1, compute: 2.5 },
	'R a unit',
	'calibration guesses for day 0 (estimate): the world moves them from there',
	true
);

/** the Aven rate card: R per Aven work hour, scaled with the HEARTS a day setting so that money stays a veil */
export const AVEN_RATE_R = n(2, 'R per Aven hour at 24 HEARTS a day', 'the Aven rate anchor of scripts/theos-e2e-sim.mjs (2 R an Aven hour). It is a rate card, not a wage: it prices Aven work items, and no human is paid. By default it is indexed to the HEARTS issued a day (scaled by HEARTS a day ÷ 24, setting rateIndexed), so doubling HEARTS doubles it: X9 and B28 show neutrality under that rule, and B28 reports the world with the card fixed in R (estimate)', true);

/** the starting state of the base world: a village settled ten years before day 0 (see genesis.js) */
export const STARTING_CAPITAL = n(
	{
		forestAgeYears: 10,
		forestM2: 260000,
		greenhouseM2: 3000,
		beds: [248, 32],
		tankM3: 2.8 * 280,
		tankFill: 0.6,
		wellM3Day: 20,
		domeCells: 'both domes (1.3 GWh a year for 248 beds, in step for 32)',
		battery: 2000,
		geoStages: 1,
		timberHa: [5, 5],
		timberWorksTYear: [110, 110],
		steelWorksTYear: [150, 150],
		orePits: [1, 1],
		glassWorksTYear: [500, 500],
		sandPits: [1, 1],
		panelWorksKwpYear: [500, 500],
		goodsWorksKgDay: [250, 250],
		springHours: [150, 150],
		computeHoursDay: [1000, 1000],
		foodStoreKg: 45000,
		storesDays: 30,
		computeChips: 'one accelerator per 96 service-hours a day of capacity, plus CHIPS.spare in store'
	},
	'',
	'a village founded ten years before day 0 (forest at year 10, sandbox-6/numbers.md); stores after a normal autumn (estimate)',
	true
);

/** every catalog record as a flat list, for the report: [path, record] */
export function catalogList() {
	const out = [];
	const walk = (o, path) => {
		if (o && typeof o === 'object' && 'v' in o && 'src' in o) return void out.push([path, o]);
		if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path ? path + '.' + k : k);
	};
	walk({ MONTHLY, WEATHER, PERSON, ENERGY_SOURCES, RESOURCES, LIMITS, LEARNING, STANDING_MWH_T, TECH, CHIPS, GENESIS_PRICE_R, AVEN_RATE_R, STARTING_CAPITAL }, '');
	return out;
}
