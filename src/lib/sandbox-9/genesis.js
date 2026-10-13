// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · GENESIS — the settings (one knob per experiment) and the world on day 0.
 *
 * The base world is Sandbox 6's village of 1,500 (round 3): six living hexes round a centre hex, no tower (./village.js
 * reads it from src/lib/sandbox-7). Day 0 is move-in: the village was built before it from imports paid in euros (the
 * founding bill, ./records.js foundingBill), its outdoor food forest and woodland are planted that day, its food
 * domes too, its stores hold food and materials bought outside, and the euros left over sit in the euro reserve. Every
 * good has two competing COOPs. Money starts at zero: the first MIND is made on day 0, when everyone's first HEARTS
 * convert (the bootstrap of paper §11.4).
 *
 * `fieldPeople` sizes the village for another number of people (every plant, plot and store scaled by fieldPeople ÷
 * 1,500); `people` below it leaves beds empty.
 */
import { exp, pow } from './dmath.js';
import { ENERGY_SOURCES, GENESIS_PRICE_R, PERSON, RESOURCES, STARTING_CAPITAL, TECH, AVEN_RATE_R, LEARNING, CHIPS, MONTHLY, STANDING_MWH_T, BORDER, DAYS_IN_MONTH, FOOD as FOODCAT } from './primitives.js';
import { OUTDOOR, INDOOR, outdoorShare, indoorShare, dietFacts, rampFor, skillRamp, skillOf, splitYields } from './food.js';
import { villageFacts } from './village.js';
import { rampSchedule, initRamp } from './ramp.js';
import { BED, COMPUTE, CONSUMER, ENERGY, FOOD, G, GOOD_IDS, GOOD_INDEX, GOODS_, MAX_COOPS, NX, SPRING, WATER, LIMIT } from './consts.js';
import { gauss, rnd } from './rng.js';
import { indexPools, newPool } from './pools.js';

/** every setting of a world; an experiment changes one */
export const DEFAULTS = {
	seed: 20261012,
	/** people living in the village (1,500 in every run, Samuel 2026-10-13; a scenario that tests another number changes
	 * this one knob and says so) */
	people: 1500,
	/** the people the village is built for; null = 250 a living hex. Set it to build the village for more or fewer
	 * people than live in it (every plant, plot and store scaled by fieldPeople ÷ (250 × livingHexes)) */
	fieldPeople: null,
	/** the ramp (Samuel, 2026-10-13 06:42): true (default) builds the village from day 0 by the build-out plan
	 * (src/lib/sandbox-7/buildout.js, through ./ramp.js): two settlers and the starter kit on day 0, people arriving as
	 * beds are finished, each settlement COOP founded when its settlement launches, the build-out's euros advanced by the
	 * MaiaCity COOP's bank. false: round 2's start, the whole village standing on day 0 and bought before it (a
	 * comparison). Only for the default village (six living hexes, built for the people who live in it) */
	ramp: true,
	/** options passed to the build-out plan (buildPlan), e.g. { kit: 'starter' } (null: the plan's own choice) */
	buildout: null,
	/** living hexes round the centre hex (Sandbox 6's village: six alike) */
	livingHexes: 6,
	/** the Tower180 in the centre hex (false, default: one more Dome120 of utilities and community halls instead) */
	tower: false,
	/** what people eat: 'samuel' (Samuel's diet, the default: legumes first, sweet potato and yam, vegetables, fruit,
	 * nuts and seeds, eggs and chicken; no potatoes or grains) or 'sandbox6' (Sandbox 6's diet with potatoes and
	 * chestnuts). The land a person needs follows from the grams of each group and each group's yield (./food.js) */
	diet: 'samuel',
	/** the food yields: 'ramp' (the default: measured averages in years 1–5, rising to the best practice by year 10 as
	 * the growers learn, food-best.md's own recommendation), 'average' (organic statistics and trials,
	 * food-research.md) or 'best' (the top quarter of measured farms and gardens, food-best.md) */
	foodYields: 'ramp',
	/** irrigation of the outdoor food land in dry summers from the gravel aquifer (true: a dry year costs × 0.95 instead
	 * of × 0.8; its pumps' electricity is in the basics class) */
	irrigation: true,
	/** the village's land, ha (null: Sandbox 6's seven hexes, 268.6 ha) */
	landHa: null,
	/** the food forests' yields, times the catalog's (./food.js; the suite tests 0.5 and 1.5) */
	forestYield: 1,
	/** LED light in the food domes in the dark months (needs food-research.md's kWh per 1,000 kcal) */
	led: false,
	/** the founding euros the MaiaCity COOP's bank holds on day 0, from outside (null: it draws on its founders as far as
	 * the village needs; the most it needs at once is the bootstrap number) */
	foundingEur: null,
	/** or the founding euros as years of the village's food at wholesale (null: see foundingEur; scenario F01 tests 0,
	 * 1 and 3: a bank that runs dry rations the imports) */
	reserveYears: null,
	/** the price the line sells electricity at, € a MWh (null: CHIPS.eurPerMwh, 87.5) */
	exportEurMwh: null,
	/** the border's prices of what the village buys, times the catalog's (BORDER, CHIPS) */
	importPrice: 1,
	/** each month's sun and rain drawn from the seed around the normals (true), or the normals every year (false) */
	weather: true,
	/** accelerators come in through the euro border (true, default: no hex can make chips, as no real town can, so the
	 * hardware owners, the settlement COOPs and the Village COOP, buy them with the bank's advances, ./ai.js); or none
	 * comes in (false: scenario B23's closed city) */
	chipImport: true,
	/** the AI-exports experiment (AIX, round 4): the MaiaCity COOP buys Aven service from the avenCEO COOP in MIND and
	 * sells it abroad for euros, at a GPU-hour's market price, up to a small provider's demand (false: the base, where
	 * electricity is the only export) */
	aiExport: false,
	/** AIX's price and demand, times the catalog's (CHIPS.exportEurGpuH, exportGpus × 24 × exportUtil) */
	aiExportPrice: 1,
	aiExportScale: 1,
	/** this hex's share of the village geothermal plant: on or off, and its stages */
	geothermal: true,
	geoStages: 1,
	/** warm ponds a living hex, fixed by nature (RESOURCES.spring.sites: 2); the experiments double it */
	springSites: 2,
	/** Law 5: the share of every sale paid at once to the seller's holders */
	law5: 0.2,
	/** the melt of HEARTS and MINDs, a year */
	melt: 0.07,
	/** HEARTS each person gets a day */
	heartsPerDay: 24,
	/** the Aven rate card and the starting ground rent are numbers in R indexed to the HEARTS issued a day (true: they
	 * scale with HEARTS a day ÷ 24), or fixed in R (false: B28's sensitivity run). HEARTS never pay for anything */
	rateIndexed: true,
	/** a basic in short supply is shared by 'equal' caps (everyone's need before anyone's extras; the default) or in
	 * 'proportion' to the orders (world model 4.3 step 7; B33 compares them) */
	basicRation: 'equal',
	/** with two food COOPs, the share of the food forest GREEN holds (0: GREEN holds only food domes, as world model
	 * 4.2 lists it) */
	foodSplit: 0.5,
	/** with two food COOPs, the share of the food domes GREEN holds (AGRI the rest): half each by default, so the two
	 * sellers have the same costs (the domes grow food at several times the forest's cost a unit) */
	domeSplit: 0.5,
	/** competing COOPs per good at genesis: 1, 2 or 4 */
	coopsPerGood: 2,
	/** per-good exceptions to coopsPerGood, by good id, e.g. { food: 1 } (null: none) */
	coopsOf: null,
	/** how COOPs price: 'forward' (forward margin, default), 'mark0', 'primer' (Primer's adaptive price) */
	priceRule: 'forward',
	/** the unit R: 'hearts' (the MIND a HEART makes is worth 1 R on average, default) or 'basket' (the paper's SOLAR-,
	 * HABITAT- and CITYmind geometric mean) */
	rIndex: 'hearts',
	/** treasuries pay their surplus above the reserve out for work proposals (false: they keep it) */
	payout: true,
	/** the reserve each treasury keeps: days of running costs, plus its planned building (Samuel 16:44: 270) */
	reserveDays: 270,
	/** share of a week's surplus paid out each week */
	payoutRate: 0.25,
	/** the owner-only cohort: share of people whose Aven delivers nothing */
	ownerOnlyShare: 0.05,
	/** spread of Aven output (lognormal σ) */
	avenSpread: 0.6,
	/** innovation from surplus energy (R&D work proposals) on or off */
	rd: true,
	/** count what R&D asked of the energy sellers as demand (true), or only what it took (false, default: R&D buys
	 * only the surplus, so what it would have liked more is no shortage) */
	rdAsks: false,
	/** share of a payout that goes to R&D proposals (half Aven work, half surplus energy) */
	rdShare: 0.3,
	/** land: 'city' (all land the City COOP's, leased for ground rent) or 'private' (owned by people, rent to them) */
	landRule: 'city',
	/** the bootstrap of §11.4 on or off */
	bootstrap: true,
	/** receivership also after a failed audit: a COOP whose output stays under a quarter of what its plants are rated
	 * for (audited meters) for 30 days fails, and its plants are leased on (world model 4.5) */
	auditExit: true,
	/** where Avens send HEARTS between the sellers of a good: 'output' (delivered output per HEART on audited meters,
	 * the default, world model call 9) or 'price' (the MIND's pool price, as the paper says today) */
	allocBy: 'output',
	/** scheduled shocks: { kind: 'drought'|'darkWinter'|'coopFail'|'wellFail', day, days, factor, coop } */
	shocks: [],
	/** population growth, a year (0: constant) */
	popGrowth: 0,
	/** Aven spending: share of the holding above its resting level spent a day */
	spendRate: 1 / 365,
	/** the share of its person's HEARTS half an Aven keeps as ownership (it spends the rest of what flows in) */
	keep: 0.5,
	/** the share of its person's HEARTS half an owner-only person's Aven keeps (its person delivers nothing, so the
	 * dividends are the only income it can grow: it keeps the whole HEARTS half and spends three quarters of the
	 * dividends, as every Aven spends of its other inflow). With the share every other Aven keeps (0.5) the holding
	 * stays too small for the dividends alone to pay the basic bundle (Proposition 3, P2 strict); the cost is a lower
	 * living standard for the cohort in its first decades (./scenarios.js B34 compares the two) */
	ownerKeep: 1,
	/** how an owner-only person's Aven spends on extras: 'income' (round 4, the default: on extras, what its income, the HEARTS
	 * half and the dividends, brings in above its basics, as far as its holding still grows at least as fast as the
	 * melt takes; it spends income, never capital) or 'keep' (until round 4: it keeps the share ownerKeep of the HEARTS
	 * half and spends three quarters of its dividends above the basics) */
	ownerRule: 'income',
	/** the share of its person's other inflow (dividends, Aven pay) it also keeps */
	keepOther: 0.25,
	/** the Aven budgets on the average of what flowed in over this many days (a year: the seasons and the first
	 * year's early dividends do not swing its person's life) */
	inflowDays: 365,
	/** buyers' intensity of choice between sellers (logit on price, as an elasticity) */
	logitBeta: 6,
	/** the Avens' elasticity of substitution between extras (CES); a dear extra loses budget to cheaper ones */
	extrasSigma: 3,
	/** the owner-only cohort spends 'normal' (dividends and some of its holding) or 'dividends' (strict test: only dividends) */
	ownerSpend: 'normal',
	/** run the slow loop every day (true) or weekly after the first year (false) */
	dailySlow: false,
	/** record ledger leaks instead of throwing */
	testMode: false,
	/** a name for the world (experiments label their two worlds) */
	label: 'base'
};

/**
 * The settlement COOPs (Samuel, 2026-10-13 06:50): one a hex, each founded when its settlement launches. A living hex's
 * settlement COOP owns every dome in its hex: it rents the beds to its residents (the bed good, paid in its own MIND:
 * the six compete for residents) and the dome space to the business COOPs (a running cost for them, a sale for it, so
 * Law 5 applies). The centre hex's is the Village COOP (07:00): it owns the centre dome, the eight factory domes and the
 * geothermal plant, rents the factory domes to the works COOPs and sells the plant's electricity and heat (it replaces
 * round 2's GEO COOP; the solar COOPs compete with it). The MaiaCity COOP (CITY) stays apart: it owns the land and runs
 * the euro bank. In the order the build-out launches the settlements (src/lib/sandbox-7/buildout.js LIVING_ORDER).
 */
export const SETTLEMENTS = [
	{ id: 'EAST', hex: 'living-e', label: 'East settlement COOP' },
	{ id: 'SOUTH-EAST', hex: 'living-se', label: 'South-east settlement COOP' },
	{ id: 'SOUTH-WEST', hex: 'living-sw', label: 'South-west settlement COOP' },
	{ id: 'WEST', hex: 'living-w', label: 'West settlement COOP' },
	{ id: 'NORTH-WEST', hex: 'living-nw', label: 'North-west settlement COOP' },
	{ id: 'NORTH-EAST', hex: 'living-ne', label: 'North-east settlement COOP' }
];
export const VILLAGE_COOP = { id: 'VILLAGE', hex: 'tower', label: 'Village COOP' };
/** plain names of the genesis COOPs that have one (the page and the proof show them) */
export const COOP_LABELS = { CITY: 'MaiaCity COOP', VILLAGE: 'Village COOP', AVENCEO: 'avenCEO COOP', ...Object.fromEntries(SETTLEMENTS.map((s) => [s.id, s.label])) };
/** a COOP's plain name: its label, or its id (a split genesis COOP keeps its parent's name and its number) */
export const coopLabel = (co) => co.label ?? COOP_LABELS[co.id] ?? co.id;

/** the genesis COOPs: name, technology, and which share of the hex's plant of that technology it holds */
const GENESIS = [
	{ id: 'CITY', tech: 'well', city: true },
	{ id: 'RAIN', tech: 'rain' },
	{ id: 'AGRI', tech: 'forest' },
	{ id: 'GREEN', tech: 'greenhouse' },
	{ id: 'SOLAR', tech: 'solar' },
	{ id: VILLAGE_COOP.id, tech: 'geo', village: true },
	...SETTLEMENTS.map((x, h) => ({ id: x.id, tech: 'home', hex: h })),
	{ id: 'TIMBER-A', tech: 'timber', i: 0 },
	{ id: 'TIMBER-B', tech: 'timber', i: 1 },
	{ id: 'STEEL-A', tech: 'steel', i: 0 },
	{ id: 'STEEL-B', tech: 'steel', i: 1 },
	{ id: 'GLASS-A', tech: 'glass', i: 0 },
	{ id: 'GLASS-B', tech: 'glass', i: 1 },
	{ id: 'PANEL-A', tech: 'panel', i: 0 },
	{ id: 'PANEL-B', tech: 'panel', i: 1 },
	{ id: 'GOODS-A', tech: 'goods', i: 0 },
	{ id: 'GOODS-B', tech: 'goods', i: 1 },
	{ id: 'SPRING-A', tech: 'spring', i: 0 },
	{ id: 'SPRING-B', tech: 'spring', i: 1 },
	// the avenCEO COOP (Samuel, 2026-10-13 07:27): the city's AI COOP, founded at the founding; it owns no hardware
	{ id: 'AVENCEO', tech: 'harness', ai: true }
];

/** a technology's numbers, read out of the catalog once */
export function techDef(key) {
	const t = TECH[key];
	const v = (r, d = 0) => (r ? r.v : d);
	const inputs = [];
	for (const [g, r] of Object.entries(t.inputs ?? {})) inputs.push([g in GOOD_INDEX ? GOOD_INDEX[g] : g, r.v]);
	const build = {};
	for (const [g, r] of Object.entries(t.build ?? {})) build[g] = r.v;
	const floors = {};
	for (const [c, r] of Object.entries(t.learn?.coef ?? {})) floors[c] = r.v;
	return {
		key,
		label: t.label,
		good: GOOD_INDEX[t.good],
		kind: t.kind,
		deposit: t.deposit ?? null,
		kwh: v(t.kwh),
		heat: v(t.heat),
		inputs,
		runH: v(t.runH),
		runFixH: v(t.runFixH),
		runLandH: v(t.runLandH),
		build,
		buildDays: v(t.buildDays),
		land: v(t.land),
		life: v(t.life),
		learnGroup: t.learn?.group ?? null,
		floors
	};
}

/** the plain numbers the engine uses every day */
function constants(cfg) {
	const E = ENERGY_SOURCES, R = RESOURCES;
	const V = villageFacts(cfg.livingHexes ?? 6, !!cfg.tower);
	// hex shares of the village as built (the catalog's per-hex numbers, smallest builds, geothermal stages, the line):
	// it follows the village, not the people who live in it
	const s = (cfg.fieldPeople ?? 250 * V.livingHexes) / 250;
	// the village is built for fieldPeople (null: 250 a living hex); vf scales Sandbox 6's numbers to it
	const vf = (cfg.fieldPeople ?? 250 * V.livingHexes) / (250 * V.livingHexes);
	const idx = cfg.rateIndexed === false ? 1 : cfg.heartsPerDay / 24;
	// the geothermal stage's heat balance: heat into the ORC = gross electricity + condenser heat + losses; pumps and fans
	// take a fixed part of the gross (./energy.js harvest)
	const geoQin = E.egs.kwHeatIntoOrc.v, geoGross0 = E.egs.netKwElectric.v / (1 - E.egs.pumpsShareOfGross.v);
	const landM2 = (cfg.landHa != null ? cfg.landHa * 1e4 : V.landM2) * vf;
	const bedsHome = V.beds.dome80 + V.beds.dome40;
	const beds = V.beds.total;
	const ip = cfg.importPrice ?? 1;
	const diet = dietFacts(cfg.diet ?? 'samuel', cfg.foodYields ?? 'ramp');
	// the outdoor food land that grows food: less tracks, sheds and hedges, and the compost ley (food-best.md §3)
	const outNet = OUTDOOR.netShare.v - OUTDOOR.leyShare.v;
	// the land split by the diet's groups: the glass grows sweet potato, vegetables and fruit, the outdoor land the rest
	// for the same people and the whole diet on what is left (./food.js splitYields, food-best.md §3)
	const outFoodM2 = V.outdoorFoodM2 * vf * outNet, inFoodM2 = V.indoorFoodM2 * vf;
	const split = splitYields(diet, outFoodM2, inFoodM2);
	// the line's price for planning: the German day-ahead price for what the geothermal plant makes and the market value of
	// solar power for what the sun makes, weighted by the village's solar and geothermal electricity a year (the day's
	// own price follows the day's sun: ./energy.js; the setting exportEurMwh gives one flat price)
	const solarYear = V.solarKwh * vf, geoYear = (cfg.geothermal ? cfg.geoStages * s : 0) * ENERGY_SOURCES.egs.netKwElectric.v * 8760;
	const sunW = MONTHLY.sun.v.map((x, i) => x * DAYS_IN_MONTH[i]);
	const solarAvg = CHIPS.solarEurMwh.v.reduce((a, x, i) => a + x * sunW[i], 0) / sunW.reduce((a, b) => a + b, 0);
	const sShare = solarYear + geoYear > 0 ? solarYear / (solarYear + geoYear) : 1;
	const eurMwh = cfg.exportEurMwh ?? sShare * solarAvg + (1 - sShare) * CHIPS.spotEurMwh.v;
	return {
		scale: s,
		vf,
		village: V,
		need: [PERSON.food.v, PERSON.water.v, PERSON.energy.v, PERSON.bed.v],
		sat: { [FOOD]: PERSON.satiation.food.v, [WATER]: PERSON.satiation.water.v, [ENERGY]: PERSON.satiation.energy.v, [BED]: 1, [GOODS_]: PERSON.satiation.goods.v, [SPRING]: PERSON.satiation.spring.v, [COMPUTE]: PERSON.satiation.compute.v },
		extras: PERSON.extrasShare.v,
		// food: a unit is 1,000 kcal of the diet; what a person needs, in kcal and g of protein
		foodKcalUnit: FOODCAT.unitKcal.v,
		kcalNeed: FOODCAT.kcalNeed.v,
		proteinNeed: FOODCAT.proteinNeed.v,
		waterNeedL: PERSON.water.v,
		homeKwhNeed: PERSON.energy.v,
		// m² of home (gross floor) a bed in the home domes (Sandbox 6: Dome80 2,484 m² for 40, Dome40 682 m² for 10)
		homeM2PerBed: V.homes.gfa / bedsHome,
		// the Aven rate card: in R, indexed to the HEARTS issued a day by default (rateIndexed), so it doubles when HEARTS double
		rateR: AVEN_RATE_R.v * idx,
		rentIdx: idx,
		// the first guesses for the day-0 prices (the fixed point in ../engine.js genesisPrices finds the real ones from
		// costs, so they are not scaled with HEARTS: the dynamics find the level)
		p0: { ...GENESIS_PRICE_R.v },
		p0base: GENESIS_PRICE_R.v,
		p0g: Object.values(GENESIS_PRICE_R.v),
		domeKwhYear: V.solarKwh * vf,
		kwhPerKwp: E.fieldSolar.kwhPerKwpYear.v,
		geoKw: E.egs.netKwElectric.v,
		geoQin,
		geoGross0,
		geoPumps: geoGross0 * E.egs.pumpsShareOfGross.v,
		geoLoss: geoQin - geoGross0 - E.egs.kwLowHeat.v,
		exergyLimit: E.egs.exergyLimit.v,
		geoHeatKw: E.egs.kwHeat.v,
		geoLowKw: E.egs.kwLowHeat.v,
		geoUptime: E.egs.uptime.v,
		geoMax: E.egs.maxStages.v,
		battRT: E.battery.roundTrip.v,
		battKwh: V.batteryKwh * vf,
		cop: E.heatPumpCop.v,
		copMonth: MONTHLY.cop.v,
		battFade: E.battery.fadePerYear.v,
		rainMm: R.rain.mmYear.v,
		caught: R.rain.caught.v,
		// rain off the home domes' footprint a bed (the food domes' roofs count by their m²)
		roofPerBed: V.homes.footM2 / bedsHome,
		landM2,
		rechargeL: ((R.groundwater.rechargeMm.v / 1000) * landM2 * 1000) / 365,
		// the diet and its yields (./food.js dietFacts): the land a person's diet takes outdoors and under glass, from the
		// grams of each group and each group's yield; a unit of food is 1,000 kcal of the diet as eaten
		diet: diet.diet,
		foodYields: diet.yields,
		dietKcal: diet.kcalDay,
		dietProtein: diet.proteinDay,
		landOutPerson: diet.out.total,
		landInPerson: diet.in.total,
		// the food forests, in units of 1,000 kcal that reach a store (after the harvest's losses in storage, processing
		// and the kitchen): outdoors a m² a year at maturity, under glass at maturity
		// (a m² of the outdoor food land, of which outNet grows food)
		forest100: ((split.out * (1 - OUTDOOR.loss.v)) / 1000) * (cfg.forestYield ?? 1) * outNet,
		forestGrown: (split.out / 1000) * (cfg.forestYield ?? 1) * outNet,
		// kcal a year a m² (before losses) the village grows when its land is split by the diet's groups, outdoors (a net
		// m²) and under glass; and the diet grown all outdoors or all under glass (dietFacts)
		kcalM2Village: { out: split.out, in: split.in },
		outNet,
		outNetM2: V.outdoorFoodM2 * vf * outNet,
		// the growers' skill by year as a share of the mature yields (foodYields 'ramp'), outdoors and under glass
		skill: skillRamp(diet.diet, diet.yields, outFoodM2, inFoodM2),
		irrigation: cfg.irrigation !== false,
		irrigKwhM3: OUTDOOR.irrigKwhM3.v,
		forestLoss: OUTDOOR.loss.v,
		// the forest's maturity ramp for this diet (its annual layers bear from year 1, its trees over 15 years) and the
		// share of its calories a late frost (trees) and alternate bearing (nuts) touch
		forestRamp: rampFor(diet.out.treeShare),
		treeShare: diet.out.treeShare,
		nutShare: diet.out.nutShare,
		forestRot: R.foodForest.rotPerDay.v,
		ghYield: ((split.in * (1 - INDOOR.loss.v)) / 1000) * (cfg.forestYield ?? 1),
		ghGrown: (split.in / 1000) * (cfg.forestYield ?? 1),
		ghLoss: INDOOR.loss.v,
		ghLight: INDOOR.light.v,
		// LED light (setting led): kWh a unit that reaches the store (400 kWh a unit grown)
		led: !!cfg.led,
		ledKwh: cfg.led ? INDOOR.ledKwhPer1000.v / (1 - INDOOR.loss.v) : null,
		protOut: split.protOut,
		protIn: split.protIn,
		// food bought at the border comes in the diet's own mix
		protImp: (diet.proteinDay / diet.kcalDay) * 1000,
		// the food domes' heat a m² a year at 24 °C with a planted canopy (food-research.md §4; our dome model gives
		// V.foodDomes.heat / V.indoorFoodM2, the low end) and climate a m² a day (Sandbox 6's food domes)
		ghHeatM2: INDOOR.heatKwhM2Year.v,
		ghHeatModelM2: V.foodDomes.heat / V.indoorFoodM2,
		ghClimateM2: V.foodDomes.climate / V.indoorFoodM2 / 365,
		timberT: R.timberLand.tHaYear.v / 1e4,
		timberRamp: R.timberLand.ramp.v,
		standYears: R.timberLand.standingYears.v,
		oreT: R.ore.tYearPerPit.v,
		oreMax: R.ore.pitsMax.v * s,
		sandT: R.sand.tYearPerPit.v,
		oreTPit: R.ore.tPerPit.v,
		sandTPit: R.sand.tPerPit.v,
		sandMax: R.sand.pitsMax.v * s,
		springHeat: R.spring.heatKwhPerHour.v,
		chipKwh: ((CHIPS.eurPerChip.v * ip) / eurMwh) * 1000,
		chipEur: CHIPS.eurPerChip.v * ip,
		eurPerKwh: eurMwh / 1000,
		exportFlat: cfg.exportEurMwh != null,
		spotEurKwh: CHIPS.spotEurMwh.v / 1000,
		solarEurKwh: CHIPS.solarEurMwh.v.map((x) => x / 1000),
		eurMwh,
		lineKwhDay: CHIPS.lineKw.v * s * 24,
		gridEurKwh: BORDER.gridEurKwh.v,
		// the accelerators (./ai.js): kWh an accelerator-hour (at the wall, with cooling), sessions, life, hours a day
		chipKwhH: CHIPS.kwAtWall.v * CHIPS.pue.v,
		chipSessions: CHIPS.sessions.v,
		chipLife: CHIPS.life.v,
		chipHoursDay: 24 * CHIPS.avail.v,
		chipM2: CHIPS.m2.v,
		dcM2: CHIPS.hallM2.v * vf,
		campChips: CHIPS.campChips.v,
		rackRunH: CHIPS.rackRunH.v,
		workCapH: PERSON.satiation.work.v,
		aiExportEurH: CHIPS.exportEurGpuH.v * (cfg.aiExportPrice ?? 1),
		aiExportAhDay: CHIPS.exportGpus.v * 24 * CHIPS.exportUtil.v * (cfg.aiExportScale ?? 1),
		// the border's prices, € (BORDER): food a unit, logs, scrap and float glass a t, cells a kWp
		eur: { food: diet.eurPer1000 * ip, logs: BORDER.logsEur.v * ip, scrap: BORDER.scrapEur.v * ip, float: BORDER.floatEur.v * ip, cells: BORDER.cellsEur.v * ip, glulam: BORDER.glulamEur.v * ip, steel: BORDER.steelEur.v * ip, glazing: BORDER.glazingEur.v * ip, panels: BORDER.panelsEur.v * ip },
		accountDays: BORDER.accountDays.v,
		importAhead: BORDER.importAhead.v,
		foodStoreDays: BORDER.foodStoreDays.v,
		storesDays: BORDER.storesDays.v,
		reserveYears: cfg.reserveYears ?? BORDER.reserveYears.v,
		bankPaybackYears: cfg.bankPaybackYears ?? BORDER.bankPaybackYears.v,
		scrapBack: 0.9,
		standingKwhT: (STANDING_MWH_T.v * 1000) / 365,
		K0: LEARNING.searchRef.v,
		kDecay: LEARNING.decay.v,
		replant: LEARNING.replant.v,
		learnRates: Object.fromEntries(Object.entries(LEARNING.rates).map(([k, r]) => [k, r.v])),
		beds,
		bedsHome
	};
}

/**
 * The village's own buildings in the recipes (./village.js): a bed carries its home dome and its share of the halls
 * kept up with the homes, a m² of the food forest under glass its share of the food domes, a t a year of the timber,
 * steel and glass works its factory dome. Climate and heat a bed from the same domes.
 */
function villageTech(w) {
	const V = w.c.village, T = w.tech;
	const bedsHome = V.beds.dome80 + V.beds.dome40;
	const per = (parts, units) => ({ wood: parts.wood / units, steel: parts.steel / units, glass: parts.glass / units });
	// the homes' own shells and floors a bed; the halls (utilities, food, factory and centre domes) are the settlement
	// COOPs' hall plants (attachHalls), rented out by the m²
	const homeParts = { wood: V.homes.wood, steel: V.homes.steel, glass: V.homes.glass };
	Object.assign(T.home.build, per(homeParts, V.beds.total));
	T.home.kwh = (V.homes.climate + V.halls.climate) / V.beds.total / 365;
	T.home.heat = (V.homes.heat + V.halls.heat) / V.beds.total / 365;
	T.home.land = V.homes.footM2 / bedsHome;
	Object.assign(T.greenhouse.build, per(V.foodDomes, V.indoorFoodM2));
	const fr = V.factoryRun;
	const tw = { wood: V.works.timber.wood + V.works.bamboo.wood, steel: V.works.timber.steel + V.works.bamboo.steel, glass: V.works.timber.glass + V.works.bamboo.glass };
	Object.assign(T.timber.build, per(tw, fr.timber.t + fr.bamboo.t));
	Object.assign(T.steel.build, per(V.works.steel, fr.steel.t));
	Object.assign(T.glass.build, per(V.works.glass, fr.glass.t));
	// the glazing wears faster than the frame: upkeep replaces glass at life ÷ glassLife times the frame's rate
	for (const k of ['home', 'hall', 'greenhouse', 'timber', 'steel', 'glass']) T[k].glassX = T[k].life > 0 ? T[k].life / (TECH[k].glassLife?.v ?? 30) : 1;
}

/** a food forest's share of its mature harvest by age in years (./food.js) */
export const forestShareOf = (w, age) => outdoorShare(age, w.c.forestRamp);

/**
 * A new plant of a technology with so much capacity. A plant keeps the recipe of the day it was built (vintage
 * capital, `vc`: its own copy of the learned coefficients); upkeep and new builds bring in today's recipe a part at a
 * time (./coops.js), and land keeps the yield of the day it was planted (each plot's `yc`).
 */
export function newPlant(w, key, cap) {
	const def = w.tech[key];
	return { tech: key, def, cap, worn: 0, landM2: 0, plots: [], raw: 0, pits: 0, domeKwp: 0, fieldKwp: 0, batt: 0, battCap: 0, battCap0: 0, rentGrace: 0, out: 0, born: w.day ?? 0, vc: { ...(w.learn[key]?.coef ?? {}) } };
}
/** a plant's own coefficient c (its vintage), 1 where the technology has none */
export const vcOf = (pl, c) => pl.vc?.[c] ?? 1;

/** a new COOP in slot k */
export function newCoop(w, k, id, good, day) {
	const p0 = w.c.p0[Object.keys(w.c.p0)[good]];
	return {
		k, id, good, city: false, alive: true, born: day, died: -1, why: '',
		plants: [],
		stock: 0, inStock: new Float64Array(G),
		price: p0, ref: p0, lastPrice: p0,
		floorR: 0, fullR: p0, varR: 0, marginEma: 1, margin: 1,
		demandEma: 0, orders: 0, sold: 0, soldEma: 0, made: 0, madeEma: 0, capDay: 0, supplyToday: 0,
		heartsEma: 0, heartsToday: 0, outBaseEma: 0, salesR: 0, salesREma: 0, costR: 0, costREma: 0, divR: 0,
		project: null, plannedR: 0, rdBudgetR: 0, rdKwhToday: 0, rdKwhWeek: 0,
		lowDays: 0, idleDays: 0, auditLow: 0, ratedDay: 0, unpaidH: 0, limiter: LIMIT.none, landWant: 0,
		related: -1, chips: 0, exportUp: 0, exportBuild: 0, primerUp: 0, salesShareR: 0, unpaidBillR: 0, payoutToday: 0, runToday: 0, heatRun: 0, priceR: p0,
		importEma: 0, eurSpentEma: 0, importR: 0, protD: 0
	};
}

/** the raw input a works plant runs on (logs, scrap, float glass, cells), and t (or kWp) of it per unit it makes */
export function rawOf(pl) {
	for (const [g, a] of pl.def.inputs) if (typeof g === 'string') return [g, a];
	return null;
}

/** sizes of the plants at founding: Sandbox 6's village (./village.js), scaled to the people it is built for */
function seedPlants(w) {
	const S = STARTING_CAPITAL.v, s = w.c.scale, cfg = w.cfg, V = w.c.village, vf = w.c.vf;
	const fr = V.factoryRun;
	const sets = [];
	for (const g of GENESIS) {
		const k = sets.length;
		if (g.hex != null && g.hex >= V.livingHexes) continue;
		const def = w.tech[g.tech];
		const pl = newPlant(w, g.tech, 0);
		pl.born = 0;
		switch (g.tech) {
			case 'well':
				pl.cap = S.wellM3Day * s;
				break;
			case 'rain':
				pl.cap = S.tankPerBed * V.beds.total * vf;
				break;
			case 'forest':
				// the outdoor food forest is planted on day 0
				pl.cap = V.outdoorFoodM2 * vf;
				pl.plots.push({ m2: pl.cap, born: -S.forestAgeYears * 365, yc: 1 });
				pl.landM2 = pl.cap;
				break;
			case 'greenhouse':
				// the food domes are planted on day 0: greens and roots bear in months, trees in years (./food.js)
				pl.cap = V.indoorFoodM2 * vf;
				pl.born = -S.indoorAgeDays;
				pl.landM2 = pl.cap;
				break;
			case 'solar':
				// every second pane of the domes' glass carries see-through cells (Sandbox 6): a rating in kWp at 980 kWh a kWp
				pl.domeKwp = w.c.domeKwhYear / w.c.kwhPerKwp;
				pl.cap = pl.domeKwp;
				pl.battCap = pl.battCap0 = w.c.battKwh;
				pl.batt = pl.battCap * 0.5;
				pl.landM2 = 100 * s;
				break;
			case 'geo':
				pl.cap = cfg.geothermal ? cfg.geoStages * s : 0;
				pl.village = true;
				break;
			case 'home':
				// a living hex's settlement COOP: its 290 beds (5 Dome80 homes of 40, 9 Dome40 homes of 10); with the tower,
				// its apartments are let by the six settlement COOPs, a sixth each
				pl.cap = (V.beds.total / V.livingHexes) * vf;
				pl.hex = g.hex;
				pl.landM2 = pl.cap * def.land;
				break;
			case 'timber': {
				const share = S.timberSplit[g.i];
				pl.cap = (fr.timber.t + fr.bamboo.t) * share * vf;
				// the woodland and the bamboo are planted on day 0 (the hemp is fibre, not timber)
				const m2 = (V.woodlandM2 + V.bambooM2) * share * vf;
				pl.plots.push({ m2, born: -S.woodlandAgeYears * 365, yc: 1 });
				pl.landM2 = m2 + pl.cap * def.land;
				// logs bought for the first month (the founding bill)
				pl.raw = (pl.cap / 365) * w.c.storesDays * rawOf(pl)[1];
				break;
			}
			case 'steel':
				pl.cap = fr.steel.t * S.steelSplit[g.i] * vf;
				pl.landM2 = pl.cap * def.land;
				pl.raw = (pl.cap / 365) * w.c.storesDays * rawOf(pl)[1];
				break;
			case 'glass':
				pl.cap = fr.glass.t * S.glassSplit[g.i] * vf;
				pl.landM2 = pl.cap * def.land;
				pl.raw = (pl.cap / 365) * w.c.storesDays * rawOf(pl)[1];
				break;
			case 'panel':
				pl.cap = S.panelWorksKwpYear[g.i] * s;
				pl.landM2 = pl.cap * def.land;
				pl.raw = (pl.cap / 365) * w.c.storesDays * rawOf(pl)[1];
				break;
			case 'goods':
				pl.cap = S.goodsWorksKgDay[g.i] * s;
				pl.landM2 = pl.cap * def.land;
				break;
			case 'spring':
				pl.cap = S.springHours[g.i] * s * (cfg.springSites / RESOURCES.spring.sites.v);
				pl.landM2 = pl.cap * def.land;
				break;
			case 'harness':
				// the harness serves up to two Aven sessions a person around the clock (help and work); it ramps with the
				// people the plan brings (./ramp.js)
				pl.cap = 2 * 24 * cfg.people;
				pl.landM2 = 0;
				break;
		}
		sets.push({ g, k, pl });
	}
	return sets;
}

/**
 * The settlement COOPs' domes (Samuel, 2026-10-13): each living hex's settlement COOP gets a hall plant holding its two
 * food domes and its utilities dome; the Village COOP one holding the centre dome (or the tower), the eight factory
 * domes. A hall plant makes nothing; it wears and is kept up like any plant, and its owner rents its floor out by the m²
 * (./coops.js costs: the rent a m² covers the shells' wear at replacement cost and their ground rent, over 1 − λ so that
 * what the landlord keeps after Law 5 pays for them). The business COOPs in them get `hosts` (the m² they rent in each
 * hall) and `hostedCap` (the part of their capacity whose building is the landlord's: all of it for the food domes and
 * the works in the factory domes, none for the water works, batteries, data centres and workshops, whose own recipes
 * are their machines). The land under a hall is on its owner's lease; the tenants lease only the outdoor land they use.
 */
function attachHalls(w) {
	const V = w.c.village, D = V.domes, vf = w.c.vf, nL = V.livingHexes, T = w.tech;
	const f120 = D.floor120;
	const livingFloor = (D.foodPerHex + D.utilPerHex) * f120;
	// the four works the engine trades stand in Dome120s or, in Sandbox 6's design packages 3–4, in plain halls
	// (./village.js domes.worksFloor: each one's own floor)
	const WF = D.worksFloor ?? Object.fromEntries(Object.entries(D.works).map(([k, n]) => [k, n * f120]));
	const worksFloor = Object.values(WF).reduce((a, m2) => a + m2, 0);
	const villageFloor = D.centreFloor + worksFloor;
	const recipe = (parts, m2) => ({ ...T.hall.build, wood: parts.wood / m2, steel: parts.steel / m2, glass: parts.glass / m2 });
	const livingParts = { wood: V.foodDomes.wood + V.util.wood, steel: V.foodDomes.steel + V.util.steel, glass: V.foodDomes.glass + V.util.glass };
	const villageParts = { wood: V.centre.wood, steel: V.centre.steel, glass: V.centre.glass };
	for (const x of Object.values(V.works)) (villageParts.wood += x.wood), (villageParts.steel += x.steel), (villageParts.glass += x.glass);
	const livingDef = { ...T.hall, build: recipe(livingParts, nL * livingFloor) };
	const villageDef = { ...T.hall, build: recipe(villageParts, villageFloor) };
	const hallOf = (def, m2, foot, hex, good) => {
		const pl = newPlant(w, 'hall', m2);
		pl.def = def;
		pl.born = 0;
		pl.landM2 = foot;
		pl.hex = hex;
		pl.good = good;
		pl.hosted = [];
		return pl;
	};
	// the living halls, one per settlement COOP and hex (split as the beds are when a hex's homes are split)
	const hexBeds = new Float64Array(nL);
	for (const co of w.coops) for (const pl of co.plants) if (pl.tech === 'home' && pl.hex != null) hexBeds[pl.hex] += pl.cap;
	const halls = [], byHex = Array.from({ length: nL }, () => []);
	for (const co of w.coops)
		for (const pl of [...co.plants])
			if (pl.tech === 'home' && pl.hex != null && hexBeds[pl.hex] > 0) {
				const a = pl.cap / hexBeds[pl.hex];
				const h = hallOf(livingDef, livingFloor * vf * a, livingFloor * vf * a, pl.hex, BED);
				co.plants.push(h);
				halls.push(h);
				byHex[pl.hex].push(h);
			}
	// the Village COOP's hall (split as its geothermal plant is when the COOPs of a good are split)
	let vh = null;
	const vPlants = [];
	for (const co of w.coops) for (const pl of co.plants) if (pl.village) vPlants.push([co, pl]);
	for (const [co] of vPlants) {
		const a = 1 / vPlants.length;
		const h = hallOf(villageDef, villageFloor * vf * a, (D.centreFootM2 + worksFloor) * vf * a, 'centre', co.good);
		co.plants.push(h);
		halls.push(h);
		vh = vh ?? h;
		if (vPlants.length > 1) h.share = a;
		if (co.good === ENERGY && co.plants.every((p) => p.tech !== 'solar')) co.label = co.label ?? VILLAGE_COOP.label + (vPlants.length > 1 ? ` (${co.id})` : '');
	}
	// with the Village COOP split in two, its tenants rent from both halls by their floor
	const vHosts = (m2) => vPlants.length > 1 ? halls.filter((h) => h.hex === 'centre').map((h) => [h, m2 * h.share]) : vh ? [[vh, m2]] : [];
	w.halls = halls;
	// the tenants: what each technology rents, in which halls (a technology's m² split over its plants by capacity)
	const Z = D.utilZones;
	const living = (m2) => byHex.flatMap((hs) => {
		const tot = hs.reduce((a, h) => a + h.cap, 0);
		return hs.map((h) => [h, (m2 * vf * h.cap) / Math.max(1e-12, tot)]);
	});
	const rent = {
		greenhouse: { hosts: living(D.foodPerHex * f120 + D.utilPerHex * D.utilGardenM2), hosted: 1 },
		well: { hosts: living(D.utilPerHex * Z.water), hosted: 0 },
		solar: { hosts: living(D.utilPerHex * (Z.battery + Z.hydrogen)), hosted: 0 },
		goods: { hosts: living(D.utilPerHex * Z.workshop), hosted: 0 },
		timber: { hosts: vHosts((WF.timber + WF.bamboo) * vf), hosted: 1 },
		steel: { hosts: vHosts(WF.steel * vf), hosted: 1 },
		glass: { hosts: vHosts(0.7 * WF.glass * vf), hosted: 1 },
		panel: { hosts: vHosts(0.3 * WF.glass * vf), hosted: 1 },
		// the settlement COOPs rent the centre's halls (and the four works domes the engine does not trade) for their
		// residents, by their beds
		home: { hosts: vHosts(D.centreFloor * vf), hosted: 0 }
	};
	const capOf = {};
	for (const co of w.coops) for (const pl of co.plants) if (rent[pl.tech]) capOf[pl.tech] = (capOf[pl.tech] ?? 0) + Math.max(0, pl.cap);
	for (const co of w.coops)
		for (const pl of co.plants) {
			const r = rent[pl.tech];
			if (!r || !(capOf[pl.tech] > 0)) continue;
			const a = Math.max(0, pl.cap) / capOf[pl.tech];
			pl.hosts = r.hosts.map(([h, m2]) => ({ hall: h, m2: m2 * a })).filter((x) => x.m2 > 0);
			for (const x of pl.hosts) x.hall.hosted.push(x);
			pl.hostedCap = r.hosted * Math.max(0, pl.cap);
			// the land under the landlord's dome is on the landlord's lease
			if (r.hosted) pl.landM2 = Math.max(0, pl.landM2 - (pl.tech === 'greenhouse' ? pl.cap : pl.cap * pl.def.land));
		}
	for (const co of w.coops) {
		const hexes = new Set(co.plants.filter((p) => p.tech === 'home').map((p) => p.hex));
		if (hexes.size > 1) co.label = 'Settlement COOP of all the living hexes';
		else if (!co.label && COOP_LABELS[co.id]) co.label = COOP_LABELS[co.id];
		else if (!co.label && COOP_LABELS[co.id.replace(/[12]$/, '')]) co.label = `${COOP_LABELS[co.id.replace(/[12]$/, '')]} ${co.id.slice(-1)}`;
	}
}

/** the City COOP keeps streets, paths, parks and the mains: about 3 ha of the hex (estimate) */
const CITY_LAND_M2 = 30000;

/** build a world from settings */
export function createWorld(config = {}) {
	const cfg = { ...DEFAULTS, ...config };
	const w = { cfg, day: 0, rs: cfg.seed >>> 0 || 1, M: MAX_COOPS };
	w.c = constants(cfg);
	w.tech = Object.fromEntries(Object.keys(TECH).map((k) => [k, techDef(k)]));
	villageTech(w);
	// learning state per technology: R&D energy (MWh), output while R&D was on, and each coefficient (1 = today's)
	w.learn = {};
	for (const [k, d] of Object.entries(w.tech)) w.learn[k] = { K: w.c.K0, Q: 0, Q0: 0, coef: Object.fromEntries(Object.keys(d.floors).map((c) => [c, 1])), rdMwh: 0 };

	// ── the ramp: the build-out plan's months (./ramp.js) ──
	const rampS = cfg.ramp && (cfg.livingHexes ?? 6) === 6 && cfg.fieldPeople == null ? rampSchedule(cfg) : null;
	// ── people ──
	const N0 = rampS ? rampS.months[0].people : cfg.people;
	const Nfull = rampS ? cfg.people : N0;
	const Nmax = (cfg.popGrowth > 0 ? Math.ceil(Nfull * exp(cfg.popGrowth * (cfg.maxYears ?? 60)) * 1.05) + 4 : Nfull) + (cfg.newcomers?.n ?? 0);
	w.N = N0;
	w.Nmax = Nmax;
	const M = MAX_COOPS;
	w.hold = new Float64Array(Nmax * M);
	w.alloc = new Float64Array(Nmax * M);
	w.spendMix = new Float64Array(Nmax * M);
	w.aven = new Float64Array(Nmax);
	w.owner = new Uint8Array(Nmax);
	w.born = new Int32Array(Nmax);
	w.taste = new Float64Array(Nmax * NX);
	w.landOwn = new Float64Array(Nmax); // private-land rule only
	w.met = new Float64Array(Nmax);
	w.L = new Float64Array(Nmax);
	w.div = new Float64Array(Nmax);
	w.divEma = new Float64Array(Nmax);
	w.wealth = new Float64Array(Nmax);
	w.wealthSlow = new Float64Array(Nmax); // the holding at slow prices (./market.js peopleOrders)
	w.heartsR = new Float64Array(Nmax); // the R value of the person's half of today's HEARTS
	w.inflowEma = new Float64Array(Nmax).fill(cfg.heartsPerDay / 2); // what flows into the holding a day (cfg.inflowDays average)
	w.heartsEma = new Float64Array(Nmax).fill(cfg.heartsPerDay / 2); // the HEARTS half in R (90-day average)
	w.spent = new Float64Array(Nmax);
	w.income = new Float64Array(Nmax);
	w.heartsR = new Float64Array(Nmax); // the R value of the person's half of today's HEARTS
	w.pb = new Float64Array(Nmax);
	w.limit = new Float64Array(Nmax * 4);
	w.q = new Float64Array(Nmax * G);
	w.order = new Float64Array(Nmax * G);
	w.decH = new Uint8Array(Nmax);
	w.decA = new Uint8Array(Nmax);
	w.saleR = new Float64Array(Nmax * M);
	w.investR = new Float64Array(Nmax * M);
	for (let i = 0; i < N0; i++) initPerson(w, i, 0);
	// the owner-only cohort, evenly spread through the ids: Aven output 0, holdings 0
	const nOwner = Math.round(N0 * cfg.ownerOnlyShare);
	w.ownerIds = [];
	for (let j = 0; j < nOwner; j++) {
		const i = Math.min(N0 - 1, Math.floor(((j + 0.5) * N0) / nOwner));
		w.owner[i] = 1;
		w.aven[i] = 0;
		w.ownerIds.push(i);
	}
	if (cfg.landRule === 'private') {
		// private land: plots owned by people, unequal (a Pareto draw), rent paid to them
		let sum = 0;
		for (let i = 0; i < N0; i++) (w.landOwn[i] = pow(1 - rnd(w), -1 / 1.5)), (sum += w.landOwn[i]);
		for (let i = 0; i < N0; i++) w.landOwn[i] /= sum;
	}

	// ── COOPs, plants, land ──
	w.coops = [];
	const sets = seedPlants(w);
	const perOf = (gi) => Math.max(1, Math.round(cfg.coopsOf?.[GOOD_IDS[gi]] ?? cfg.coopsPerGood));
	const byGood = Array.from({ length: G }, () => []);
	for (const { g, pl } of sets) byGood[pl.def.good].push({ g, pl });
	// coopsPerGood: 2 keeps the two genesis COOPs of each good; 1 gives both plants to the first; 4 splits each in two
	// (but the settlement COOPs and the Village COOP)
	const plan = [];
	for (let gi = 0; gi < G; gi++) {
		const list = byGood[gi];
		const per = perOf(gi);
		if (per === 1) plan.push({ ids: [list[0].g.id], plants: [list.map((x) => x.pl)], city: list.some((x) => x.g.city) });
		else if (per >= 4)
			for (const x of list) {
				// a settlement COOP and the Village COOP own their hex's domes: they are not split (six settlements already
				// sell beds, and the MIND slots would not hold every COOP twice)
				if (x.g.village || x.g.hex != null || x.g.ai) {
					plan.push({ ids: [x.g.id], plants: [[x.pl]], city: !!x.g.city });
					continue;
				}
				for (const half of [0, 1]) {
					const pl = { ...x.pl, vc: { ...x.pl.vc }, cap: x.pl.cap / 2, landM2: x.pl.landM2 / 2, raw: x.pl.raw / 2, pits: x.pl.pits / 2, domeKwp: x.pl.domeKwp / 2, battCap: x.pl.battCap / 2, batt: x.pl.batt / 2, plots: x.pl.plots.map((p) => ({ ...p, m2: p.m2 / 2 })) };
					plan.push({ ids: [x.g.id + (half ? '2' : '1')], plants: [[pl]], city: x.g.city && !half });
				}
			}
		else if (gi === FOOD && list.length === 2 && cfg.foodSplit > 0) {
			// food: the food domes cannot sell at the food forest's cost, so on their own they would leave food with a
			// single seller within a year or two. GREEN holds a share of the forest (cfg.foodSplit) and of the domes
			// (cfg.domeSplit), AGRI the rest: two sellers with the same kind of costs
			const forest = list.find((x) => x.pl.tech === 'forest'), gh = list.find((x) => x.pl.tech === 'greenhouse');
			const f = cfg.foodSplit, dg = cfg.domeSplit ?? 1;
			const part = (pl, a) => ({ ...pl, vc: { ...pl.vc }, cap: pl.cap * a, landM2: pl.landM2 * a, plots: pl.plots.map((p) => ({ ...p, m2: p.m2 * a })) });
			plan.push({ ids: [forest.g.id], plants: [dg < 1 ? [part(forest.pl, 1 - f), part(gh.pl, 1 - dg)] : [part(forest.pl, 1 - f)]], city: false });
			plan.push({ ids: [gh.g.id], plants: [[part(gh.pl, dg), part(forest.pl, f)]], city: false });
		} else for (const x of list) plan.push({ ids: [x.g.id], plants: [[x.pl]], city: !!x.g.city });
	}
	// the City COOP first (its MIND is the hub of every basket)
	plan.sort((a, b) => (b.city ? 1 : 0) - (a.city ? 1 : 0));
	for (const p of plan) {
		const k = w.coops.length;
		const co = newCoop(w, k, p.ids[0], w.tech[p.plants[0][0].tech].good, 0);
		co.city = p.city;
		co.plants = p.plants[0];
		w.coops.push(co);
	}
	w.cityK = w.coops.findIndex((c) => c.city);
	if (w.cityK < 0) {
		// with one COOP per good the City COOP is the water seller; make sure one is marked
		w.cityK = w.coops.findIndex((c) => c.good === WATER);
		w.coops[w.cityK].city = true;
	}
	if (w.cityK !== 0) {
		const c0 = w.coops[0];
		w.coops[0] = w.coops[w.cityK];
		w.coops[w.cityK] = c0;
		w.coops.forEach((c, k) => (c.k = k));
		w.cityK = 0;
	}
	w.tre = new Float64Array(M * M);
	attachHalls(w);
	// the land: the City COOP keeps roads, yards, utilities, the halls and the pits; the plants stand on their plots;
	// what Sandbox 6 leaves as nature (hedges, meadow, wild wood) is free land the City COOP can lease for more building
	{
		let plantsM2 = 0;
		for (const co of w.coops) for (const pl of co.plants) plantsM2 += pl.landM2;
		const free = w.c.village.natureM2 * w.c.vf + Math.max(0, w.c.landM2 - w.c.village.landM2 * w.c.vf);
		w.land = { totalM2: w.c.landM2, rent: 1e-4 * w.c.rentIdx, unmet: 0, cityM2: Math.max(0, w.c.landM2 - plantsM2 - free) };
	}
	for (const co of w.coops) for (const pl of co.plants) pl.rentRate = w.land.rent;
	// the ramp: every plant at the share the plan has finished on day 0, every COOP its founding day
	if (rampS) initRamp(w, rampS);
	// stores at founding, bought outside before day 0 (the founding bill): food for foodStoreDays, split between the food
	// COOPs by the land they grow on; materials for storesDays of their works; goods for two weeks
	const S = STARTING_CAPITAL.v;
	let foodM2 = 0;
	for (const co of w.coops) if (co.good === FOOD) for (const p of co.plants) foodM2 += p.cap;
	const foodStore = w.c.foodStoreDays * w.c.need[0] * N0;
	const food0 = w.coops.find((c) => c.good === FOOD);
	for (const co of w.coops) {
		const cap = capDayOf(w, co, 0);
		if (co.good === FOOD) {
			// (on the ramp nothing grows on day 0: the settlers' store is the first food COOP's)
			co.stock = foodM2 > 1e-9 ? (foodStore * co.plants.reduce((a, p) => a + p.cap, 0)) / foodM2 : co === food0 ? foodStore : 0;
			co.protD = w.c.protImp;
		} else if (co.good === WATER && co.plants.some((p) => p.tech === 'rain')) co.stock = co.plants.reduce((a, p) => a + (p.tech === 'rain' ? p.cap * 1000 * S.tankFill : 0), 0);
		else if ([4, 5, 6, 7].includes(co.good)) co.stock = cap * w.c.storesDays;
		else if (co.good === GOODS_) co.stock = cap * 14;
		co.chips = 0;
		co.demandEma = cap * 0.8;
		co.soldEma = co.demandEma;
		co.madeEma = cap * 0.8;
	}
	// input stores: two weeks of each input at capacity
	for (const co of w.coops)
		for (const pl of co.plants) for (const [g, a] of pl.def.inputs) if (typeof g === 'number') co.inStock[g] += a * capDayOf(w, co, 0) * 14;

	// ── pools: the CITYmind in every basket, the rest in baskets of 4–8 ──
	const others = w.coops.filter((c) => !c.city).map((c) => c.k);
	const nb = Math.max(1, Math.ceil(others.length / 6));
	const baskets = Array.from({ length: nb }, () => [w.cityK]);
	others.forEach((k, i) => baskets[Math.floor((i * nb) / others.length)].push(k));
	for (const b of baskets) while (b.length < 4 && others.length >= 3) b.push(others[(b.length * 7) % others.length]);
	w.pools = baskets.map((b) => newPool([...new Set(b)]));
	indexPools(w);
	w.P = new Float64Array(M).fill(1);
	w.Ptw = new Float64Array(M).fill(1);
	const solar = w.coops.find((c) => c.good === ENERGY && c.plants.some((p) => p.tech === 'solar'));
	const home = w.coops.find((c) => c.good === BED);
	w.refMinds = [...new Set([solar?.k ?? 1, home?.k ?? 2, w.cityK])];

	// ── allocation of HEARTS on day 0: the bootstrap, or each Aven's own taste ──
	for (let i = 0; i < N0; i++) firstAlloc(w, i);

	// ── ledgers, records, today ──
	w.ledger = { created: new Float64Array(M), melted: new Float64Array(M), prev: new Float64Array(M), leaks: [], checks: 0, maxRel: 0 };
	w.matter = { prevStock: null, leaks: [], maxRel: 0, prevChips: 0 };
	w.meltIndex = 1;
	w.events = [];
	w.shockDays = [];
	w.slowUntil = 365;
	w.today = blankToday(w);
	w.lastEntry = new Float64Array(G).fill(-1e9);
	w.refoundAt = new Float64Array(G).fill(-1e9); // no COOP is founded on failed plants before this day (./coops.js receiverships)
	w.cityStore = new Float64Array(G); // stores of a failed COOP with no heir, held by the City COOP until a founding
	w.heatAvail = new Float64Array(M);
	w.shortDaysGood = new Float64Array(G);
	return w;
}

/** what is measured during a day: flows for the page and the ledgers */
export function blankToday(w) {
	return {
		routeFeeR: 0, routedR: 0, hopsR: 0, arbR: 0, swapSold: new Float64Array(MAX_COOPS), swapBought: new Float64Array(MAX_COOPS),
		harvest: { solar: 0, geo: 0, battery: 0, geoHeat: 0, lowHeat: 0 },
		use: new Float64Array(5), heatUse: 0, heatPumpKwh: 0, curtailed: 0, battIn: 0, battLoss: 0, unserved: new Float64Array(5),
		made: new Float64Array(G), eaten: new Float64Array(G), input: new Float64Array(G), built: new Float64Array(G), rotted: new Float64Array(G), imported: new Float64Array(G),
		raw: { grown: { logs: 0, ore: 0, sand: 0, scrap: 0 }, used: { logs: 0, ore: 0, sand: 0, scrap: 0, float: 0, cells: 0 }, lost: { logs: 0, ore: 0, sand: 0 }, imported: { logs: 0, scrap: 0, float: 0, cells: 0 } }, unpicked: 0,
		salesPeopleR: 0, salesB2BR: 0, divR: 0, divPeopleR: 0, divTreR: 0, investR: 0, runningR: 0, proposalsR: 0, rdR: 0, rentR: 0, meltR: 0,
		energyPriceR: 0, sun: 0, rain: 0, heatF: 0, month: 0, season: '', shocks: []
	};
}

/** a person's Aven: its output, its tastes, and its holdings (none) */
export function initPerson(w, i, day) {
	const cfg = w.cfg, M = MAX_COOPS, sg = cfg.avenSpread;
	w.aven[i] = exp(sg * gauss(w) - (sg * sg) / 2);
	w.born[i] = day;
	const keys = ['food', 'water', 'energy', 'goods', 'spring', 'compute'];
	let sum = 0;
	for (let x = 0; x < NX; x++) {
		const v = w.c.extras[keys[x]] * exp(0.3 * gauss(w));
		w.taste[i * NX + x] = v;
		sum += v;
	}
	for (let x = 0; x < NX; x++) w.taste[i * NX + x] /= sum;
	for (let k = 0; k < M; k++) (w.hold[i * M + k] = 0), (w.alloc[i * M + k] = 0), (w.spendMix[i * M + k] = 0);
	if (w.inflowEma) (w.inflowEma[i] = cfg.heartsPerDay / 2), (w.heartsEma[i] = cfg.heartsPerDay / 2);
}

/**
 * Where a person's first HEARTS go. Bootstrap (§11.4): into the COOPs the person will buy from, in the shares of what
 * they will buy (each good's sellers by their capacity), with a little in every COOP so every MIND reaches the pools on
 * day 0. Without the bootstrap: into three COOPs of the Aven's own taste.
 */
export function firstAlloc(w, i) {
	const M = MAX_COOPS, b = i * M;
	if (w.cfg.bootstrap) {
		const p0 = w.c.p0;
		const spendG = { [FOOD]: w.c.need[0] * p0.food, [WATER]: w.c.need[1] * p0.water, [ENERGY]: w.c.need[2] * p0.energy, [BED]: p0.bed, [GOODS_]: 1.5 * p0.goods, [SPRING]: 0.5 * p0.spring, [COMPUTE]: 2 * p0.compute };
		let sum = 0;
		for (const co of w.coops) {
			if (!co.alive) continue;
			let v = 0.01;
			if (spendG[co.good] !== undefined) {
				let capAll = 0;
				for (const c2 of w.coops) if (c2.alive && c2.good === co.good) capAll += Math.max(1e-9, capDayOf(w, c2, w.day));
				v += (spendG[co.good] * Math.max(1e-9, capDayOf(w, co, w.day))) / capAll;
			}
			w.alloc[b + co.k] = v;
			sum += v;
		}
		for (let k = 0; k < M; k++) w.alloc[b + k] /= sum;
	} else {
		const alive = w.coops.filter((c) => c.alive);
		for (let x = 0; x < 3; x++) w.alloc[b + alive[Math.floor(rnd(w) * alive.length)].k] += 1 / 3;
	}
}

/** a COOP's output at capacity today, in its good's unit a day (no inputs or energy limits) */
export function capDayOf(w, co, day) {
	let s = 0;
	for (const pl of co.plants) s += plantCapDay(w, pl, day);
	return s;
}

/**
 * kWh a kWp of a solar plant gives against the catalog's 980: the dome cells sit on a fixed area of glass, so better
 * cells (fitted or replaced after a gain: the plant's own coefficient) give more kWh from it; a field kWp gives what
 * the sun gives (980 kWh a year in Munich), and better cells only need less land and glass for it (./coops.js).
 */
export function solarGain(pl) {
	const cap = Math.max(1e-12, pl.domeKwp + pl.fieldKwp);
	const dome = pl.domeKwp / cap;
	return dome / vcOf(pl, 'cells') + (1 - dome);
}
/**
 * Net electric kW of a geothermal stage: gross = heat into the ORC × its efficiency (12 % ÷ the plant's own ORC
 * coefficient), less the fixed pumps and fans. The condenser takes the rest of the heat (./energy.js harvest).
 */
export function geoGrossKw(w, pl) {
	return w.c.geoGross0 / vcOf(pl, 'orc');
}
export function geoNetKw(w, pl) {
	return geoGrossKw(w, pl) - w.c.geoPumps;
}

/** what still stands of the landlords' domes a tenant plant rents (1: all of it), worked out once a day */
export function hostCond(w, pl) {
	if (pl.condDay === w.day) return pl.cond;
	let a = 0, m = 0;
	for (const x of pl.hosts ?? []) {
		const h = x.hall;
		a += x.m2 * (h.cap > 0 ? Math.max(0, h.cap - h.worn) / h.cap : 1);
		m += x.m2;
	}
	pl.condDay = w.day;
	return (pl.cond = m > 0 ? a / m : 1);
}

/** a plant's output at capacity today */
export function plantCapDay(w, pl, day) {
	const d = pl.def;
	// the part of a tenant's capacity that stands in a landlord's dome works only as far as the dome stands
	const eff = pl.hostedCap > 0 ? Math.max(0, pl.cap - pl.worn - pl.hostedCap * (1 - hostCond(w, pl))) : Math.max(0, pl.cap - pl.worn);
	switch (d.kind) {
		case 'hall':
			return 0;
		case 'forest': {
			// the forest gives what nature gives (./coops.js nature); its capacity is the year's harvest at its age, a day;
			// each plot keeps the yield of the year it was planted
			let uYear = 0;
			for (const p of pl.plots) uYear += ((p.m2 * w.c.forest100) / (p.yc ?? 1)) * outdoorShare((day - p.born) / 365, w.c.forestRamp);
			return (uYear / 365) * skillOf(w, 'out', day);
		}
		case 'greenhouse':
			// light-limited: an average day of the year at its age since planting (./coops.js plan scales a day's output
			// by the month's light)
			return ((eff * w.c.ghYield) / vcOf(pl, 'yield') / 365) * indoorShare(day - (pl.born ?? 0)) * skillOf(w, 'in', day);
		case 'rain': {
			// the tanks give what rain gives: this tank's share of the roofs, an average day
			let roof = 0, tanks = 0;
			for (const co of w.coops ?? [])
				if (co.alive)
					for (const p of co.plants) {
						if (p.tech === 'home') roof += Math.max(0, p.cap) * w.c.roofPerBed;
						if (p.tech === 'rain') tanks += Math.max(1e-9, p.cap);
					}
			return tanks > 0 ? (roof * (w.c.rainMm / 365) * w.c.caught * Math.max(0, pl.cap)) / tanks : 0;
		}
		case 'well':
			return Math.min(eff * 1000, w.c.rechargeL);
		case 'solar':
			// harvested by the month's sun (./energy.js); capacity is an average day
			return (eff * w.c.kwhPerKwp * solarGain(pl)) / 365;
		case 'geo':
			return eff * geoNetKw(w, pl) * 24 * w.c.geoUptime;
		case 'home':
			return eff;
		case 'timber':
		case 'works':
			return d.key === 'goods' ? eff : eff / 365;
		case 'spring':
		case 'service':
			return eff;
		case 'harness':
			// the harness serves what the inference it can buy carries today (./ai.js aiMorning sets inferCapDay: the
			// hardware owners' accelerators × hours × the sessions an accelerator serves)
			return Math.min(eff, pl.inferCapDay ?? 0);
	}
	return 0;
}
