// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · GENESIS — the settings (one knob per experiment) and the world on day 0.
 *
 * The base world is one living hex of our village design, settled ten years before day 0: its food forest is in its
 * tenth year, the great dome of 248 and a dome of 32 stand, the dome glass carries see-through cells, the hex has its
 * sixth of the village centre's geothermal plant, and every good has two competing COOPs. Money starts at zero:
 * the first MIND is made on day 0, when everyone's first HEARTS convert (the bootstrap of paper §11.4: each Aven
 * invests its first HEARTS in the COOPs it will buy from, and the tenth of every treasury half seeds the pools).
 *
 * A smaller field for the page: `people` below 250 scales every plant, plot and store by people / 250, so the hex is
 * the same world in miniature.
 */
import { exp, pow } from './dmath.js';
import { ENERGY_SOURCES, GENESIS_PRICE_R, PERSON, RESOURCES, STARTING_CAPITAL, TECH, AVEN_RATE_R, LEARNING, CHIPS, MONTHLY, STANDING_MWH_T } from './primitives.js';
import { BED, COMPUTE, CONSUMER, ENERGY, FOOD, G, GOOD_IDS, GOOD_INDEX, GOODS_, MAX_COOPS, NX, SPRING, WATER, LIMIT } from './consts.js';
import { gauss, rnd } from './rng.js';
import { indexPools, newPool } from './pools.js';

/** every setting of a world; an experiment changes one */
export const DEFAULTS = {
	seed: 20261012,
	/** people at the start (250 for the proofs; the page may use fewer on a proportionally smaller field) */
	people: 250,
	/** the people the field's starting capital (plants, plots, stores, land) is sized for; null = `people` (a smaller
	 * field for fewer people). Set it to put more or fewer people on the same hex (world model 5.5, B14, B29) */
	fieldPeople: null,
	/** the hex's land, ha */
	landHa: 45,
	/** the food forest's yield, times the catalog's (world model call 11: the riskiest number; the suite tests 0.5 and 1.5) */
	forestYield: 1,
	/** each month's sun and rain drawn from the seed around the normals (true), or the normals every year (false) */
	weather: true,
	/** the euro border (world model call 12: closed in the proofs; only scenario B23 opens it): accelerators come in
	 * through the border for exported electricity that would otherwise be curtailed (true), or the city is strictly
	 * closed and the accelerators it holds are all it has (false, default) */
	chipImport: false,
	/** this hex's share of the village geothermal plant: on or off, and its stages */
	geothermal: true,
	geoStages: 1,
	/** warm ponds at the hot spring, fixed by nature (RESOURCES.spring.sites: 2); the experiments double it */
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
	/** with two food COOPs, the share of the food forest GREEN holds beside its growing dome (0: GREEN holds only the
	 * growing dome, as world model 4.2 lists it) */
	foodSplit: 0.4,
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

/** the genesis COOPs: name, technology, and which share of the hex's plant of that technology it holds */
const GENESIS = [
	{ id: 'CITY', tech: 'well', city: true },
	{ id: 'RAIN', tech: 'rain' },
	{ id: 'AGRI', tech: 'forest' },
	{ id: 'GREEN', tech: 'greenhouse' },
	{ id: 'SOLAR', tech: 'solar' },
	{ id: 'GEO', tech: 'geo' },
	{ id: 'HOME-A', tech: 'home', beds: 0 },
	{ id: 'HOME-B', tech: 'home', beds: 1 },
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
	{ id: 'COMPUTE-A', tech: 'compute', i: 0 },
	{ id: 'COMPUTE-B', tech: 'compute', i: 1 }
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
	const s = (cfg.fieldPeople ?? cfg.people) / 250;
	const E = ENERGY_SOURCES, R = RESOURCES;
	const idx = cfg.rateIndexed === false ? 1 : cfg.heartsPerDay / 24;
	// the geothermal stage's heat balance: heat into the ORC = gross electricity + condenser heat + losses; pumps and fans
	// take a fixed part of the gross (./energy.js harvest)
	const geoQin = E.egs.kwHeatIntoOrc.v, geoGross0 = E.egs.netKwElectric.v / (1 - E.egs.pumpsShareOfGross.v);
	return {
		scale: s,
		need: [PERSON.food.v, PERSON.water.v, PERSON.energy.v, PERSON.bed.v],
		sat: { [FOOD]: PERSON.satiation.food.v, [WATER]: PERSON.satiation.water.v, [ENERGY]: PERSON.satiation.energy.v, [BED]: 1, [GOODS_]: PERSON.satiation.goods.v, [SPRING]: PERSON.satiation.spring.v, [COMPUTE]: PERSON.satiation.compute.v },
		extras: PERSON.extrasShare.v,
		// the Aven rate card: in R, indexed to the HEARTS issued a day by default (rateIndexed), so it doubles when HEARTS double
		rateR: AVEN_RATE_R.v * idx,
		rentIdx: idx,
		// the first guesses for the day-0 prices (the fixed point in ../engine.js genesisPrices finds the real ones from
		// costs, so they are not scaled with HEARTS: the dynamics find the level)
		p0: { ...GENESIS_PRICE_R.v },
		p0base: GENESIS_PRICE_R.v,
		p0g: Object.values(GENESIS_PRICE_R.v),
		domeKwhPerBed: E.domeSolar.kwhYearPerGreatDome.v / 248,
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
		cop: E.heatPumpCop.v,
		copMonth: MONTHLY.cop.v,
		battFade: E.battery.fadePerYear.v,
		rainMm: R.rain.mmYear.v,
		caught: R.rain.caught.v,
		roofPerBed: R.rain.roofPerBed.v,
		rechargeL: ((R.groundwater.rechargeMm.v / 1000) * cfg.landHa * 1e4 * s * 1000) / 365,
		forest100: R.foodForest.kgYearAt100.v * (cfg.forestYield ?? 1),
		forestRot: R.foodForest.rotPerDay.v,
		ghYield: R.greenhouse.kgM2Year.v,
		ghHeatM2: R.greenhouse.heatKwhPerM2Year.v,
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
		chipKwh: CHIPS.kwhPerChip.v,
		lineKwhDay: CHIPS.lineKw.v * 24,
		chipsSpare: CHIPS.spare.v,
		standingKwhT: (STANDING_MWH_T.v * 1000) / 365,
		K0: LEARNING.searchRef.v,
		kDecay: LEARNING.decay.v,
		replant: LEARNING.replant.v,
		learnRates: Object.fromEntries(Object.entries(LEARNING.rates).map(([k, r]) => [k, r.v]))
	};
}

/** a food forest's share of its full harvest by age in years (src/lib/sandbox-6/food.js forestShare) */
export const forestShareOf = (ageYears) => Math.min(1.5, 0.1 * (Math.floor(Math.max(0, ageYears)) + 1));

/**
 * A new plant of a technology with so much capacity. A plant keeps the recipe of the day it was built (vintage
 * capital, `vc`: its own copy of the learned coefficients); upkeep and new builds bring in today's recipe a part at a
 * time (./coops.js), and land keeps the yield of the day it was planted (each plot's `yc`).
 */
export function newPlant(w, key, cap) {
	const def = w.tech[key];
	return { tech: key, def, cap, worn: 0, landM2: 0, plots: [], raw: 0, pits: 0, domeKwp: 0, fieldKwp: 0, batt: 0, battCap: 0, battCap0: 0, rentGrace: 0, out: 0, vc: { ...(w.learn[key]?.coef ?? {}) } };
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
		related: -1, chips: 0, chipKwh: 0, exportReq: 0, primerUp: 0, salesShareR: 0, unpaidBillR: 0, payoutToday: 0, runToday: 0, heatRun: 0, priceR: p0
	};
}

/** sizes of the starting plants, from the catalog's starting state, scaled to the field */
function seedPlants(w) {
	const S = STARTING_CAPITAL.v, s = w.c.scale, cfg = w.cfg;
	const sets = [];
	for (const g of GENESIS) {
		const k = sets.length;
		const def = w.tech[g.tech];
		const pl = newPlant(w, g.tech, 0);
		switch (g.tech) {
			case 'well':
				pl.cap = S.wellM3Day * s;
				break;
			case 'rain':
				pl.cap = S.tankM3 * s;
				break;
			case 'forest':
				pl.cap = S.forestM2 * s;
				pl.plots.push({ m2: pl.cap, born: -S.forestAgeYears * 365, yc: 1 });
				pl.landM2 = pl.cap;
				break;
			case 'greenhouse':
				pl.cap = S.greenhouseM2 * s;
				pl.landM2 = pl.cap;
				break;
			case 'solar':
				pl.domeKwp = ((S.beds[0] + S.beds[1]) * s * w.c.domeKwhPerBed) / w.c.kwhPerKwp;
				pl.cap = pl.domeKwp;
				pl.battCap = pl.battCap0 = ENERGY_SOURCES.battery.kwh.v * s;
				pl.batt = pl.battCap * 0.5;
				pl.landM2 = 100 * s;
				break;
			case 'geo':
				pl.cap = cfg.geothermal ? cfg.geoStages * s : 0;
				break;
			case 'home':
				pl.cap = S.beds[g.beds] * s;
				pl.landM2 = pl.cap * def.land;
				break;
			case 'timber':
				pl.cap = S.timberWorksTYear[g.i] * s;
				pl.plots.push({ m2: S.timberHa[g.i] * 1e4 * s, born: -20 * 365, yc: 1 });
				pl.landM2 = S.timberHa[g.i] * 1e4 * s + pl.cap * def.land;
				pl.raw = S.timberHa[g.i] * 1e4 * s * w.c.timberT * 0.5;
				break;
			case 'steel':
				pl.cap = S.steelWorksTYear[g.i] * s;
				pl.pits = S.orePits[g.i] * s;
				pl.landM2 = pl.cap * def.land;
				pl.raw = (pl.pits * w.c.oreT * S.storesDays) / 365;
				break;
			case 'glass':
				pl.cap = S.glassWorksTYear[g.i] * s;
				pl.pits = S.sandPits[g.i] * s;
				pl.landM2 = pl.cap * def.land;
				pl.raw = (pl.pits * w.c.sandT * S.storesDays) / 365;
				break;
			case 'panel':
				pl.cap = S.panelWorksKwpYear[g.i] * s;
				pl.landM2 = pl.cap * def.land;
				break;
			case 'goods':
				pl.cap = S.goodsWorksKgDay[g.i] * s;
				pl.landM2 = pl.cap * def.land;
				break;
			case 'spring':
				pl.cap = S.springHours[g.i] * s * (cfg.springSites / RESOURCES.spring.sites.v);
				pl.landM2 = pl.cap * def.land;
				break;
			case 'compute':
				pl.cap = S.computeHoursDay[g.i] * s;
				pl.landM2 = pl.cap * def.land;
				break;
		}
		sets.push({ g, k, pl });
	}
	return sets;
}

/** the City COOP keeps streets, paths, parks and the mains: about 3 ha of the hex (estimate) */
const CITY_LAND_M2 = 30000;

/** build a world from settings */
export function createWorld(config = {}) {
	const cfg = { ...DEFAULTS, ...config };
	const w = { cfg, day: 0, rs: cfg.seed >>> 0 || 1, M: MAX_COOPS };
	w.c = constants(cfg);
	w.tech = Object.fromEntries(Object.keys(TECH).map((k) => [k, techDef(k)]));
	// learning state per technology: R&D energy (MWh), output while R&D was on, and each coefficient (1 = today's)
	w.learn = {};
	for (const [k, d] of Object.entries(w.tech)) w.learn[k] = { K: w.c.K0, Q: 0, Q0: 0, coef: Object.fromEntries(Object.keys(d.floors).map((c) => [c, 1])), rdMwh: 0 };

	// ── people ──
	const N0 = cfg.people;
	const Nmax = (cfg.popGrowth > 0 ? Math.ceil(N0 * exp(cfg.popGrowth * (cfg.maxYears ?? 60)) * 1.05) + 4 : N0) + (cfg.newcomers?.n ?? 0);
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
	const plan = [];
	for (let gi = 0; gi < G; gi++) {
		const list = byGood[gi];
		const per = perOf(gi);
		if (per === 1) plan.push({ ids: [list[0].g.id], plants: [list.map((x) => x.pl)], city: list.some((x) => x.g.city) });
		else if (per >= 4)
			for (const x of list)
				for (const half of [0, 1]) {
					const pl = { ...x.pl, vc: { ...x.pl.vc }, cap: x.pl.cap / 2, landM2: x.pl.landM2 / 2, raw: x.pl.raw / 2, pits: x.pl.pits / 2, domeKwp: x.pl.domeKwp / 2, battCap: x.pl.battCap / 2, batt: x.pl.batt / 2, plots: x.pl.plots.map((p) => ({ ...p, m2: p.m2 / 2 })) };
					plan.push({ ids: [x.g.id + (half ? '2' : '1')], plants: [[pl]], city: x.g.city && !half });
				}
		else if (gi === FOOD && list.length === 2 && cfg.foodSplit > 0) {
			// food: the growing dome cannot sell at the food forest's cost, so on its own it would leave food with a single
			// seller within a year or two. The forest is the hex's main food plant; GREEN holds the growing dome and a
			// share of the forest (cfg.foodSplit), AGRI the rest: two sellers with the same kind of costs
			const forest = list.find((x) => x.pl.tech === 'forest'), gh = list.find((x) => x.pl.tech === 'greenhouse');
			const f = cfg.foodSplit;
			const part = (pl, a) => ({ ...pl, vc: { ...pl.vc }, cap: pl.cap * a, landM2: pl.landM2 * a, plots: pl.plots.map((p) => ({ ...p, m2: p.m2 * a })) });
			plan.push({ ids: [forest.g.id], plants: [[part(forest.pl, 1 - f)]], city: false });
			plan.push({ ids: [gh.g.id], plants: [[gh.pl, part(forest.pl, f)]], city: false });
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
	w.land = { totalM2: cfg.landHa * 1e4 * w.c.scale, rent: 1e-4 * w.c.rentIdx, unmet: 0, cityM2: CITY_LAND_M2 * w.c.scale };
	for (const co of w.coops) for (const pl of co.plants) pl.rentRate = w.land.rent;
	// stores at genesis
	const S = STARTING_CAPITAL.v;
	for (const co of w.coops) {
		const cap = capDayOf(w, co, 0);
		// the food store: nine tenths with the forest, a tenth with the growing dome (a COOP holding both holds both)
		if (co.good === FOOD) co.stock = S.foodStoreKg * w.c.scale * co.plants.reduce((a, p) => a + (p.tech === 'forest' ? (0.9 * p.cap) / (S.forestM2 * w.c.scale) : p.tech === 'greenhouse' ? (0.1 * p.cap) / (S.greenhouseM2 * w.c.scale) : 0), 0);
		else if (co.good === WATER && co.plants.some((p) => p.tech === 'rain')) co.stock = co.plants.reduce((a, p) => a + (p.tech === 'rain' ? p.cap * 1000 * S.tankFill : 0), 0);
		else if ([4, 5, 6, 7].includes(co.good)) co.stock = cap * S.storesDays;
		else if (co.good === GOODS_) co.stock = cap * 14;
		// accelerators in store: a spare or two per COMPUTE COOP (the installed ones are part of its plant)
		co.chips = co.good === COMPUTE ? w.c.chipsSpare * (perOf(COMPUTE) >= 4 ? 0.5 : 1) * Math.max(w.c.scale, 0.2) : 0;
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
	w.matter = { prevStock: null, leaks: [], maxRel: 0 };
	w.meltIndex = 1;
	w.events = [];
	w.shockDays = [];
	w.slowUntil = 365;
	w.today = blankToday(w);
	w.lastEntry = new Float64Array(G).fill(-1e9);
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
		made: new Float64Array(G), eaten: new Float64Array(G), input: new Float64Array(G), built: new Float64Array(G), rotted: new Float64Array(G),
		raw: { grown: { logs: 0, ore: 0, sand: 0 }, used: { logs: 0, ore: 0, sand: 0 }, lost: { logs: 0, ore: 0, sand: 0 } }, unpicked: 0,
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

/** a plant's output at capacity today */
export function plantCapDay(w, pl, day) {
	const d = pl.def;
	const eff = Math.max(0, pl.cap - pl.worn);
	switch (d.kind) {
		case 'forest': {
			// the forest gives what nature gives (./coops.js nature); its capacity is the year's harvest at its age, a day;
			// each plot keeps the yield of the year it was planted
			let kgYear = 0;
			for (const p of pl.plots) kgYear += ((p.m2 * w.c.forest100) / (p.yc ?? 1)) * forestShareOf((day - p.born) / 365);
			return kgYear / 365;
		}
		case 'greenhouse':
			// light-limited: an average day of the year (./coops.js plan scales a day's output by the month's sun)
			return (eff * w.c.ghYield) / vcOf(pl, 'yield') / 365;
		case 'rain': {
			// the tanks give what rain gives: this tank's share of the roofs, an average day
			let roof = 0, tanks = 0;
			for (const co of w.coops ?? [])
				if (co.alive)
					for (const p of co.plants) {
						if (p.tech === 'home') roof += Math.max(0, p.cap) * w.c.roofPerBed;
						else if (p.tech === 'greenhouse') roof += Math.max(0, p.cap);
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
	}
	return 0;
}
