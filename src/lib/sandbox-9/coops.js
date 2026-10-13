// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE COOPs — what each plant makes from what, how it wears and is kept up, how a COOP builds, pays its
 * Avens, keeps its reserve, pays out, funds R&D, pays ground rent, and how COOPs are founded and fail.
 *
 * Nothing grows by decree here. A plant makes what its capacity, its inputs, its land, its deposit and the energy it
 * was dispatched allow. Capacity wears at 1 ÷ life a year and comes back only when the plant's own materials are
 * bought and built in again. New capacity is built from tonnes and MWh bought from other COOPs, on land leased from
 * the City COOP, when the COOP is short and the build pays back within 40 % of its life. Innovation moves a
 * technology's coefficients down its two-factor learning curve only with R&D energy, and R&D only gets the energy
 * left after basics, running and building (./energy.js).
 *
 * No human labour is paid: COOPs pay Aven work items. Running items keep a plant going (a rate card in R per Aven
 * hour, in R indexed to the HEARTS issued a day by default: ./genesis.js rateIndexed), work proposals are paid from the treasury's surplus above its reserve, and both go
 * to people in proportion to what their Aven delivers.
 */
import { log2, pow } from './dmath.js';
import { DAYS_IN_MONTH, GOODS, MONTHLY, YEAR_DAYS } from './primitives.js';
import { BASICS, BED, CLASS, COMPUTE, ENERGY, FOOD, G, GLASS, GOOD_INDEX, GOODS_, IN_HAND, LIMIT, LIMIT_OF_GOOD, MATERIALS, MAX_COOPS, PANEL, SPRING, STEEL, WATER, WOOD } from './consts.js';
import { monthOf, shockFactor } from './energy.js';
import { capDayOf, newCoop, newPlant, plantCapDay, solarGain, vcOf, rawOf } from './genesis.js';
import { outdoorShare, indoorShare, INDOOR_INDEX, skillOf } from './food.js';
import { exportPlan, bankExport, exportEurKwh } from './border.js';
import { newPool, indexPools, buildCycles } from './pools.js';
import { rnd } from './rng.js';
import { rampOn } from './ramp.js';
import { PROP_DAYS, ahPerAvenH } from './ai.js';

const M = MAX_COOPS;

/** how far ahead each technology's seller looks when it prices (its growing or building time, in days) */
export const HORIZON = { forest: 365, greenhouse: 60, rain: 120, well: 30, solar: 30, geo: 30, home: 180, timber: 90, steel: 120, glass: 120, panel: 120, goods: 90, spring: 30, compute: 60 };
export const horizonOf = (co) => co.plants.reduce((h, p) => Math.max(h, HORIZON[p.tech] ?? 30), 7);

/** food into a COOP's store, `u` units with `d` g of protein a unit: the store's protein a unit is the mix's */
export function foodIn(co, u, d) {
	if (!(u > 0)) return;
	const s0 = Math.max(0, co.stock);
	co.protD = (s0 * (co.protD ?? d) + u * d) / (s0 + u);
	co.stock += u;
}

/** a forest's share of its mature harvest by age (./food.js) */
export const forestShare = (w, age) => outdoorShare(age, w.c.forestRamp);

/**
 * what a forest plant gives on a day, in units of 1,000 kcal that reach the store (after the harvest's losses): the
 * year's harvest at its age, by the month's share (most from July to October), times the season's weather (April to
 * September sun and rain, ./food.js foodSeason) and the year's tree crop (late frost, alternate bearing). `wx` false:
 * the normals, for a seller's forecast; a seller does see this year's tree crop on the trees.
 */
function forestHarvest(w, pl, day, wx = true) {
	const m = monthOf(day);
	const share = MONTHLY.harvest.v[m] / DAYS_IN_MONTH[m];
	// each plot keeps the yield of the year it was planted (a perennial forest is not replanted)
	let uYear = 0;
	for (const p of pl.plots) uYear += ((p.m2 * w.c.forest100) / (p.yc ?? 1)) * outdoorShare((day - p.born) / 365, w.c.forestRamp);
	uYear *= skillOf(w, 'out', day);
	const t = w.today;
	const f = wx && t && day === w.day ? (t.outWx ?? 1) : 1;
	const tree = t && Math.floor(day / 365) === Math.floor(w.day / 365) ? (t.treeF ?? 1) : 1;
	return uYear * share * f * tree;
}

/** a food plant's share of its mature yield today (the forest's plots by their m², the domes since planting) */
export function rampOf(w, pl) {
	if (pl.tech === 'forest') {
		let a = 0, m = 0;
		for (const p of pl.plots) (a += p.m2 * outdoorShare((w.day - p.born) / 365, w.c.forestRamp)), (m += p.m2);
		return m > 0 ? a / m : 1;
	}
	if (pl.tech === 'greenhouse') return indoorShare(w.day - (pl.born ?? 0));
	return 1;
}

/** rain into a tank plant on a day, L: its share of the home domes' roofs (the food domes' rain waters their own
 * forest: it needs ~600 L a m² a year, its roof catches ~720, food-research.md §5) */
function rainInflow(w, pl, day, rainF) {
	const m = monthOf(day);
	let roof = 0, tanks = 0;
	for (const co of w.coops) {
		if (!co.alive) continue;
		for (const p of co.plants) {
			if (p.tech === 'home') roof += Math.max(0, p.cap) * w.c.roofPerBed;
			if (p.tech === 'rain') tanks += Math.max(1e-9, p.cap);
		}
	}
	const mmDay = (w.c.rainMm / YEAR_DAYS) * (rainF ?? MONTHLY.rain.v[m]);
	return (roof * mmDay * w.c.caught * Math.max(0, pl.cap)) / tanks;
}

/** t of logs a timber works takes for a t of glulam */
const logsPerT = (pl) => pl.def.inputs.find((x) => x[0] === 'logs')?.[1] ?? 1;

/** logs a timber plant's land grows a day, t */
export function logsGrowth(w, pl, day) {
	// each plot grows at the yield it was last replanted with (./coops.js nature replants a share a year)
	let t = 0;
	for (const p of pl.plots) {
		const age = Math.floor((day - p.born) / 365);
		const ramp = w.c.timberRamp[Math.min(w.c.timberRamp.length - 1, Math.max(0, age))];
		t += (p.m2 * (w.c.timberT / (p.yc ?? 1)) * ramp) / 365;
	}
	return t;
}

// ── nature ───────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * What nature gives today, before anyone trades: the forest's harvest (into its store; the energy to process it is
 * asked for in the basics class, and what cannot be processed rots), rain into the tanks (what overflows is spilled),
 * logs on the timber land, ore and sand from the pits, and the food store's slow rot.
 */
export function nature(w) {
	const t = w.today;
	for (const co of w.coops) {
		co.harvestToday = 0;
		if (!co.alive) continue;
		const f = shockFactor(w, co);
		for (const pl of co.plants) {
			if (pl.tech === 'forest') {
				// the Avens pick what the store will need (co.pickShare, set by the forward margin); the rest falls and
				// feeds the soil (it never enters a store, so it is not counted as made)
				const pot = forestHarvest(w, pl, w.day) * f;
				const h = pot * (co.pickShare ?? 1);
				co.harvestToday += h;
				t.unpicked += pot - h;
				foodIn(co, h, w.c.protOut);
				// what was picked and lost in storage, processing and the kitchen (15 %): made and rotted the same day
				const lost = (h * w.c.forestLoss) / (1 - w.c.forestLoss);
				t.made[FOOD] += h + lost;
				t.rotted[FOOD] += lost;
				t.foodLost = (t.foodLost ?? 0) + lost;
				t.foodOut = (t.foodOut ?? 0) + h;
			} else if (pl.tech === 'rain') {
				const inflow = rainInflow(w, pl, w.day, t.rain) * f;
				const room = Math.max(0, pl.cap * 1000 - co.stock);
				const kept = Math.min(room, inflow);
				co.stock += kept;
				t.made[WATER] += inflow;
				t.rotted[WATER] += inflow - kept;
			} else if (pl.tech === 'timber') {
				// a share of the timber land is cut and replanted each year: that share takes today's yield
				const cur = w.learn.timber.coef.yield ?? 1;
				for (const p of pl.plots) p.yc = (p.yc ?? 1) + (cur - (p.yc ?? 1)) * (w.c.replant / YEAR_DAYS);
				const g = logsGrowth(w, pl, w.day);
				// the stand holds standYears of growth uncut; logs bought for the works lie beside it
				const cap = w.c.standYears * 365 * g + (pl.rawTarget ?? 0);
				const kept = Math.max(0, Math.min(g, cap - pl.raw));
				pl.raw += kept;
				t.raw.grown.logs += g;
				t.raw.lost.logs += g - kept;
			} else if (pl.def.deposit) {
				// a deposit is finite: a pit gives its rate until what it holds is dug out
				const ore = pl.def.deposit === 'ore';
				const left = Math.max(0, pl.pits * (ore ? w.c.oreTPit : w.c.sandTPit) - (pl.mined ?? 0));
				const rate = Math.min(left, (pl.pits * (ore ? w.c.oreT : w.c.sandT)) / 365);
				const yard = rate * 60;
				const x = Math.max(0, Math.min(rate, yard - pl.raw));
				pl.raw += x;
				pl.mined = (pl.mined ?? 0) + x;
				t.raw.grown[pl.def.deposit] += x;
			}
		}
		if (co.good === FOOD && co.stock > 0) {
			const r = co.stock * w.c.forestRot;
			co.stock -= r;
			t.rotted[FOOD] += r;
		}
	}
}

// ── forward margin ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * What a COOP expects to make over the next H days, besides its store: cumulative, in 5-day steps (out[j] is the
 * supply of the first 5·(j+1) days), so a seasonal seller can see the tightest point of its pipeline.
 */
export function supplyAhead(w, co, H, only = null) {
	const steps = Math.max(1, Math.ceil(H / 5));
	const out = new Float64Array(steps);
	for (const pl of co.plants) {
		if (only && pl.tech !== only) continue;
		const d = pl.def;
		let acc = 0;
		const f = shockFactor(w, co);
		let flat = -1;
		switch (d.kind) {
			case 'forest':
			case 'rain':
			case 'solar':
				break;
			case 'geo':
				flat = pl.out;
				break;
			case 'timber':
			case 'works': {
				let day = plantCapDay(w, pl, w.day);
				if (pl.tech === 'timber') day = Math.min(day, (pl.raw / Math.max(1, H) + logsGrowth(w, pl, w.day)) / logsPerT(pl));
				else if (d.deposit) {
					const ratio = d.inputs.find((x) => x[0] === d.deposit)?.[1] ?? 1;
					day = Math.min(day, (pl.pits * (d.deposit === 'ore' ? w.c.oreT : w.c.sandT)) / 365 / ratio + pl.raw / ratio / H);
				}
				flat = day * f;
				break;
			}
			default:
				flat = plantCapDay(w, pl, w.day) * f;
		}
		const live = Math.max(0, pl.cap - pl.worn);
		const gh = d.kind === 'greenhouse' ? flat : -1;
		if (gh >= 0) flat = -1;
		for (let j = 0; j < steps; j++) {
			const x = j * 5;
			let v;
			// the food domes follow the month's inside light (with the LED top-up when it is on), and the sun lately
			if (gh >= 0) {
				const m = monthOf(w.day + x);
				v = 5 * gh * (w.c.led ? INDOOR_INDEX.led[m] : INDOOR_INDEX.base[m]) * pow(w.sunSeen ?? 1, 0.85);
			} else if (flat >= 0) v = 5 * flat;
			else if (d.kind === 'forest') v = 5 * forestHarvest(w, pl, w.day + x, x === 0) * f;
			else if (d.kind === 'rain') v = 5 * rainInflow(w, pl, w.day + x) * f * (w.rainSeen ?? 1);
			else {
				const m = monthOf(w.day + x);
				v = ((5 * live * w.c.kwhPerKwp * MONTHLY.sun.v[m]) / DAYS_IN_MONTH[m]) * solarGain(pl) * (w.sunSeen ?? 1);
			}
			acc += v;
			out[j] += acc;
		}
	}
	return out;
}

/**
 * Each seller's forward margin: what it holds plus what it will make, against need plus 5 days in hand, at the
 * tightest point of its horizon (a food forest in April sees the months before the harvest, not the harvest
 * itself); and each good's margin over all its sellers.
 */
export function margins(w) {
	const haveG = new Float64Array(G), needG = new Float64Array(G), defG = new Float64Array(G);
	for (const co of w.coops) {
		if (!co.alive) continue;
		const H = horizonOf(co);
		const need = Math.max(co.demandEma, 1e-9);
		const held = co.good === ENERGY ? batteryKwh(co) : co.stock;
		const ahead = supplyAhead(w, co, H);
		// a seller that buys at the border (food, materials) counts what it will buy there: what its own plants will not
		// give of what its buyers ask, a day (./border.js importsDay buys it), as far as it can pay for it (its account
		// and its share of the founding euros over its horizon, and what its exports earn lately): when the euros run
		// short its margin falls and its price rises like any scarce seller's
		const imp = importsOpen(w, co) ? Math.min(importsPayable(w, co, H), Math.max(0, need - ahead[ahead.length - 1] / (5 * ahead.length))) : 0;
		// what it will have to buy at the border to hold its need (and 5 days in hand) at the tightest point ahead: what
		// its exports save for (./border.js exportPlan)
		if (importsOpen(w, co)) {
			let def = 0;
			for (let j = 0; j < ahead.length; j++) def = Math.max(def, (5 * (j + 1) + IN_HAND) * need - held - ahead[j]);
			co.deficitAhead = def;
			defG[co.good] += def;
		} else co.deficitAhead = 0;
		// a good that keeps (food, water, materials, goods) is judged at its tightest point; one that does not (energy,
		// a bed-day, spring time) over its whole horizon
		let m = Infinity;
		const from = GOODS[co.good].store ? 0 : ahead.length - 1;
		for (let j = from; j < ahead.length; j++) m = Math.min(m, (held + ahead[j] + imp * 5 * (j + 1)) / ((5 * (j + 1) + IN_HAND) * need));
		// an AI COOP makes Aven hours to order from inference it buys by the hour: the accelerators standing idle are
		// the hardware owners', whose own margin already lowers the inference price (./ai.js aiMorning). It has no idle
		// plant of its own to clear, so its margin goes no higher than 1: it prices at its reference while inference is
		// to be had, and above it when inference binds
		if (co.good === COMPUTE) m = Math.min(1, m);
		co.margin = m;
		// a seller of a basic that keeps (food, water) sells no faster than the rate its store and what it will make
		// (and buy) can hold to the tightest point ahead, with 5 days in hand: what it offers above the basic orders is
		// rationed
		if (co.good === FOOD || co.good === WATER) {
			let r = Infinity;
			for (let j = 0; j < ahead.length; j++) r = Math.min(r, (held + ahead[j] + imp * 5 * (j + 1)) / (5 * (j + 1) + IN_HAND));
			// while the bank can advance euros without bound, what the store lacks at its tightest point can be bought then:
			// no rationing (the price still carries the scarcity)
			co.sustain = w.border?.open && importsOpen(w, co) ? Infinity : r;
		}
		co.marginEma += (co.margin - co.marginEma) / 14;
		// how often it has been short lately (a 90-day average of short days): building answers a lasting shortage
		co.shortEma = (co.shortEma ?? 0) + ((m < 1 ? 1 : 0) - (co.shortEma ?? 0)) / 90;
		// a food forest picks only what keeps its store PICK_HEAD above need at the tightest point ahead
		if (co.plants.some((p) => p.tech === 'forest')) {
			const aF = supplyAhead(w, co, H, 'forest');
			let s = PICK_MIN;
			for (let j = 0; j < ahead.length; j++) {
				if (!(aF[j] > 0)) continue;
				const want = PICK_HEAD * (5 * (j + 1) + IN_HAND) * need - held - (ahead[j] - aF[j]);
				s = Math.max(s, want / aF[j]);
			}
			co.pickShare = Math.min(1, s);
		}
		haveG[co.good] += m * need;
		needG[co.good] += need;
	}
	w.goodMargin = Float64Array.from(haveG, (h, g) => (needG[g] > 0 ? h / needG[g] : Infinity));
	// what all the sellers of a good will have to buy at the border at their tightest points ahead, in days of their need
	w.goodDeficit = Float64Array.from(defG, (x, g) => (needG[g] > 0 ? x / needG[g] : 0));
}
/** a seller of food or a material buys what it lacks at the border while euros can be had (its account, the founding
 * reserve, or electricity to export) */
export function importsOpen(w, co) {
	if (!(co.good === FOOD || MATERIALS.includes(co.good)) || w.cfg.border === false) return false;
	return true;
}
/** units a day of its good a seller can pay for at the border: its deposit and its share of the bank's founding euros
 * spread over `H` days, and what its exports earned a day lately (without bound while the bank draws on its founders) */
export function importsPayable(w, co, H) {
	const B = w.border, unit = unitEurOf(w, co);
	if (!B || !(unit > 0)) return 0;
	// the bank advances what its deposit does not cover, as far as its founders allow (unbounded by default)
	if (B.open) return Infinity;
	let n = 0;
	for (const c of w.coops) if (c.alive && importsOpen(w, c)) n++;
	return ((B.eur[co.k] + B.shared / Math.max(1, n)) / Math.max(1, H) + (co.exportEurEma ?? 0)) / unit;
}
/** € a unit of a seller's good costs at the border (food a unit, glulam, steel, glazing a t, panels a kWp) */
export function unitEurOf(w, co) {
	const E = w.c.eur;
	if (co.good === FOOD) return E.food;
	return co.good === WOOD ? E.glulam : co.good === STEEL ? E.steel : co.good === GLASS ? E.glazing : co.good === PANEL ? E.panels : 0;
}
/** a food forest keeps its store this far above need at the tightest point ahead, and always picks this share */
const PICK_HEAD = 1.3, PICK_MIN = 0.15;
const batteryKwh = (co) => co.plants.reduce((a, p) => a + (p.batt ?? 0), 0);

// ── costs ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** a plant's inputs per unit of output, with its own recipe (the coefficients of its vintage) */
export function inputsOf(w, pl) {
	const d = pl.def;
	const scrap = vcOf(pl, 'scrap'), glassC = vcOf(pl, 'glass');
	return d.inputs.map(([g, a]) => [g, a * (pl.tech === 'goods' ? scrap : 1) * (pl.tech === 'panel' && g === GLASS ? glassC : 1)]);
}
/** a plant's electricity per unit of output (kWh), with its own recipe */
export function kwhOf(w, pl) {
	return pl.def.kwh * vcOf(pl, 'kwh');
}
/**
 * Bring today's recipe into a plant for `units` of its capacity rebuilt or added (upkeep, a finished project): its
 * coefficients become the capacity-weighted mix of its old recipe and today's.
 */
export function refit(w, pl, units, capBefore) {
	const cur = w.learn[pl.tech]?.coef;
	if (!cur || !(units > 0)) return;
	const tot = Math.max(1e-12, capBefore + units);
	const a = Math.max(0, capBefore) / tot;
	pl.vc = pl.vc ?? {};
	for (const c of Object.keys(cur)) pl.vc[c] = (pl.vc[c] ?? 1) * a + cur[c] * (1 - a);
}
/** tonnes a plant is built of (for its standing energy) */
function tonnesOf(w, pl) {
	const b = pl.def.build;
	return Math.max(0, pl.cap) * ((b.wood ?? 0) + (b.steel ?? 0) + (b.glass ?? 0));
}
/** a plant's standing electricity a day (light, ventilation, controls of the hall it stands in), kWh */
export function standingKwh(w, pl) {
	const k = pl.def.kind;
	// the food domes' climate (fans, pumps, vents) a m² of food forest under glass (Sandbox 6's Dome120)
	if (k === 'greenhouse') return Math.max(0, pl.cap - pl.worn) * w.c.ghClimateM2;
	return k === 'works' || k === 'service' || k === 'timber' ? tonnesOf(w, pl) * w.c.standingKwhT : 0;
}
/** a plant's build materials per capacity unit today: { wood, steel, glass, panel } t (or kWp), and kWh */
export function buildOf(w, pl) {
	// a hall plant carries its own domes' recipe
	if (pl.def.kind === 'hall') return (pl.recipe ??= buildOfNow(w, pl));
	// the same for every plant of a technology until the next learning step (./coops.js learn clears the cache)
	const cache = (w.buildCache ??= {});
	const hit = cache[pl.tech];
	if (hit) return hit;
	return (cache[pl.tech] = buildOfNow(w, pl));
}
function buildOfNow(w, pl) {
	const b = pl.def.build, L = w.learn[pl.tech].coef;
	const mat = pl.tech === 'home' ? L.wood ?? 1 : 1;
	const out = { [WOOD]: (b.wood ?? 0) * mat, [STEEL]: (b.steel ?? 0) * mat, [GLASS]: (b.glass ?? 0) * mat, [PANEL]: b.panel ?? 0 };
	// field solar: better cells need less glass and steel a kWp (the panel's own glass is in the panel works' recipe)
	if (pl.tech === 'solar') for (const g of [STEEL, GLASS]) out[g] *= L.cells ?? 1;
	let t = 0;
	for (const g of MATERIALS) if (g !== PANEL) t += out[g];
	out.kwh = ((b.mwh ?? 0) + (b.mwhPerT ?? 0) * t) * 1000;
	// accelerators: made outside, brought in through the border (./coops.js chipImports)
	out.chips = b.chips ?? 0;
	return out;
}

/** the share of a plant whose building is its own (a tenant's plant in a landlord's dome: the part outside it) */
export const ownShare = (pl) => (pl.hostedCap > 0 ? Math.max(0, 1 - pl.hostedCap / Math.max(1e-12, pl.cap)) : 1);

/**
 * The settlement COOPs' dome rents (Samuel, 2026-10-13), worked out on the slow days: a hall's rent a m² of floor a day
 * covers what its shells wear at replacement cost (the year's traded prices, as every plant's wear) and the ground rent
 * of the land under them, over 1 − λ: the landlord sells the space, Law 5 pays its holders λ of each rent, and what it
 * keeps pays for the domes. Every m² is rented at the same rate (a dome stands where it stands: the settlement COOPs
 * compete for residents, not for tenants). The part of a dome nobody rents (paths, ponds, offices, stores) stays in the
 * landlord's own price.
 */
export function hallRents(w) {
	const lam = w.cfg.law5;
	for (const h of w.halls) h.ownerK = -1;
	for (const co of w.coops) if (co.alive) for (const pl of co.plants) if (pl.def.kind === 'hall') pl.ownerK = co.k;
	for (const h of w.halls) {
		const live = Math.max(0, h.cap - h.worn);
		const capR = h.def.life > 0 ? (live * unitSlowR(w, h)) / (h.def.life * 365) : 0;
		h.fixR = capR + h.landM2 * (h.rentRate ?? w.land.rent);
		h.rateR = h.cap > 0 ? h.fixR / (1 - lam) / h.cap : 0;
		h.rentedM2 = h.hosted.reduce((a, x) => a + x.m2, 0);
	}
}

/**
 * Each COOP's costs in R: variable cost a unit (inputs and energy at expected prices), its floor (variable cost ÷
 * (1 − Law 5 share): the seller's own reservation price), and full cost (adding running items, ground rent and the
 * wear of its capital at replacement cost, over what it sells).
 */
export function costs(w, full) {
	const pb = w.pbar, pE = pb[ENERGY], lam = w.cfg.law5;
	// heat is paid at the electricity a heat pump would need for it, this month: a dome's heat follows the month's
	// heating need, a warm pond's the month's heat loss a bather-hour (on day 0, before the calendar, a year's average)
	const t = w.today ?? {};
	const cop = t.cop ?? w.c.cop;
	const heatF = t.heatShare != null ? t.heatShare * YEAR_DAYS : 1;
	const springH = t.springHeat ?? w.c.springHeat.reduce((a, x) => a + x, 0) / 12;
	if (full && w.halls) hallRents(w);
	for (const co of w.coops) {
		if (!co.alive) continue;
		let varR = 0, n = 0, runR = 0, capR = 0, landM2 = 0, domeR = 0, keptR = 0;
		for (const pl of co.plants) {
			let v = 0;
			for (const [g, a] of inputsOf(w, pl)) {
				if (typeof g === 'number') v += a * pb[g];
				// a raw input bought at the border costs the electricity exported for it (its share bought: a 90-day average)
				else if (w.c.eur[g] != null) v += a * (pl.rawImpShare ?? 1) * (w.c.eur[g] / w.c.eurPerKwh) * pE;
			}
			v += kwhOf(w, pl) * pE;
			// the harness's inference, at the hardware owners' prices (./ai.js)
			if (pl.tech === 'harness') v += ahPerAvenH(w) * (w.inferPR ?? 0);
			if (pl.tech === 'spring') v += (springH * pE) / cop;
			else if (pl.def.heat) v += (pl.def.heat * heatF * vcOf(pl, 'heat') * pE) / cop;
			// the growing dome's heat this month, spread over what the planted dome grows today (the part left unplanted
			// is not heated: ./coops.js plan)
			if (pl.tech === 'greenhouse') {
				const [gi, gl] = t.ghIdx ?? [1, 1];
				const kg = plantCapDay(w, pl, w.day) * gl;
				if (kg > 0) v += (Math.max(0, pl.cap - pl.worn) * w.c.ghHeatM2 * (heatF / YEAR_DAYS) * (w.learn.greenhouse.coef.heat ?? 1) * pE) / cop / kg;
				// the LED light's electricity, over all it grows this month
				if (gl > gi && w.c.ledKwh != null) v += ((gl - gi) / gl) * w.c.ledKwh * pE;
			}
			v += runHPerUnit(w, pl) * w.c.rateR;
			// the COOP's variable cost is its plants' unit costs weighted by what each can make today (a plant worn to
			// almost nothing, with its fixed hours spread over a few units, weighs almost nothing)
			const wt = Math.max(0, plantCapDay(w, pl, w.day));
			varR += v * wt;
			n += wt;
			if (full) {
				runR += standbyHours(w, pl) * w.c.rateR; // the running hours in step with use are in varR
				runR += standingKwh(w, pl) * pE;
				if (pl.def.life > 0) {
					// the wear of capital is priced at what rebuilding it costs: its replacement cost at the prices its
					// materials and energy traded at over the last year (pbarSlow: weighted by what was sold, so a few
					// kilograms traded at a spiking price move it little). Valued at its book value instead (what it cost
					// when it was built), a dome of homes built of glulam at its genesis price earned a twentieth of what
					// its upkeep cost once glulam was scarce, and its COOP could not pay for the upkeep: the homes wore away
					// while the price of a bed stayed below what keeping a bed standing costs
					if (pl.bookR == null) pl.bookR = unitNowR(w, pl);
					// what wears is what still stands (./coops.js wear)
					const live = Math.max(0, pl.cap - pl.worn);
					capR += (ownShare(pl) * live * unitSlowR(w, pl)) / (pl.def.life * 365);
				}
				landM2 += pl.landM2 * (pl.rentRate ?? w.land.rent);
				// dome rent: the m² it rents in a settlement COOP's domes, at the landlord's rate
				if (pl.hosts) for (const x of pl.hosts) if (x.hall.ownerK >= 0 && x.hall.ownerK !== co.k) domeR += x.m2 * x.hall.rateR;
			}
		}
		// food (or a finished material) bought at the border: what it costs in exported electricity, with what its packing
		// takes, weighed by what the COOP has bought a day lately; never less than its own plants' unit cost (the village's
		// own food first: an import bought with scarce euros does not undercut the forests and domes, or a seller that
		// imports more would sell cheaper, take the other sellers' buyers and leave their food on the trees)
		// The floor is the own plants' unit cost over the year (a 365-day average), not today's: a dark month's unit
		// cost (the domes' heat over that month's small harvest) is that month's, and valuing every kilogram bought
		// abroad at it priced the imports at it too, when most of the food was bought (in the build-out's winters food
		// then cost several times its yearly cost, and newcomers who held nothing yet could not pay for their basics)
		const fin = co.good === FOOD ? 'food' : co.good === WOOD ? 'glulam' : co.good === STEEL ? 'steel' : co.good === GLASS ? 'glazing' : co.good === PANEL ? 'panels' : null;
		if (fin) {
			const own = n > 0 ? varR / n : 0;
			if (w.day === 0 || co.ownVarEma == null) co.ownVarEma = own;
			else if (co.ownVarDay !== w.day) co.ownVarEma += (own - co.ownVarEma) / 365;
			co.ownVarDay = w.day;
		}
		if (fin && co.importEma > 1e-9) {
			const v = Math.max(co.ownVarEma, (w.c.eur[fin] / w.c.eurPerKwh) * pE + (co.good === FOOD ? 0.1 * pE : 0));
			varR += v * co.importEma;
			n += co.importEma;
		}
		co.varR = n > 0 ? varR / n : 0;
		co.floorR = co.varR / (1 - lam);
		if (full) {
			// what it sells a day, at least a quarter of what its plants can make today (a plant finished this morning
			// counts already)
			// (a food seller's forest and domes give their harvest whether it sells it or not: its fixed bills are spread
			// over what they can grow, so a seller that loses buyers for a while does not price itself out of the market
			// while its store fills and its food rots, and one that sells imported food does not spread its bills thinner)
			const capNow = capDayOf(w, co, w.day);
			const sold = co.good === FOOD && capNow > 1e-9 ? capNow : Math.max(co.soldEma, 0.25 * Math.max(capNow, co.soldEma));
			const rentR = co.city ? 0 : landM2;
			// the price at which the treasury breaks even: it keeps only 1 − λ of each sale. The ground rent counted here is
			// the COOP's own lease, locked at the rate of the day each plot was leased (./coops.js signLease): a fixed bill
			// like the plant's wear, so it belongs in the price a COOP must earn. Today's going rent is not in it (Ricardo:
			// the price of a good sets the rent of new land, not the other way round), so rent and prices cannot chase each
			// other up through old leases. Without the lease, a seller in a glut prices below what it owes and fails.
			// the plant's wear is paid either way: at its replacement cost at the year's prices, or at what its upkeep has
			// actually cost (rebuilding worn units with materials bought at today's prices), whichever is more
			capR = Math.max(capR, co.upkeepREma ?? 0);
			// a landlord: what it keeps of its dome rents after Law 5 pays for the rented part of its domes, so its own
			// price (the beds, the geothermal electricity) carries only the part of its domes nobody rents
			if (co.plants.some((p) => p.def.kind === 'hall')) {
				if (co.rentInEma == null) co.rentInEma = co.plants.reduce((a, p) => a + (p.def.kind === 'hall' ? (p.rentedM2 ?? 0) * (p.rateR ?? 0) : 0), 0);
				keptR = (1 - lam) * co.rentInEma;
			}
			co.domeRentR = domeR;
			co.rentKeptR = keptR;
			// a COOP that can make nothing yet (a founding still building) has no unit cost: its fixed bills are not
			// spread over zero units (it quotes the others' price meanwhile: ./market.js postPrices)
			co.fullR = sold > 1e-9 ? (co.varR + Math.max(0, runR + capR + rentR + domeR - keptR) / sold) / (1 - lam) : co.floorR;
		}
	}
}

/**
 * A plant on standby needs this share of its running hours; the rest are delivered in step with what it makes or
 * sells (a works that stands still, a forest left unpicked, a curtailed solar field, an empty bed need little Aven
 * work). Estimate.
 */
export const STANDBY = 0.2;

/** Aven running hours a plant needs a day at full use */
export function fullHours(w, pl) {
	const d = pl.def;
	if (!(pl.cap > 0) && !pl.plots.length) return 0;
	// an Aven service learns to need fewer Aven hours for an hour it delivers (coefficient 'aven')
	// a worn-out part of a plant needs no running (only what still stands is run)
	// (the harness is software: what it learns reaches every Aven at once)
	const av = pl.tech === 'harness' ? (w.learn.harness?.coef.aven ?? 1) : vcOf(pl, 'aven');
	let up = Math.max(0, pl.cap - pl.worn);
	// a harness runs only as far as inference stands behind it: the part no accelerator can serve today is not run
	// (it is software, kept ready at no cost until the hardware owners' capacity reaches it)
	if (pl.tech === 'harness') up = Math.min(up, Math.max(0, pl.inferCapDay ?? 0));
	let h = d.runH * up * av + (d.runFixH ?? 0);
	if (pl.tech === 'timber') for (const p of pl.plots) h += d.runLandH * p.m2;
	// a young food forest is tended in full but picked by its harvest: three tenths of the hours are care, the rest
	// picking and the store (estimate)
	if (pl.tech === 'forest' || pl.tech === 'greenhouse') h *= 0.3 + 0.7 * rampOf(w, pl);
	return h;
}

/** Aven hours a plant needs per unit it makes, beyond standby */
function runHPerUnit(w, pl) {
	const capD = plantCapDay(w, pl, w.day);
	return capD > 0 ? ((1 - STANDBY) * fullHours(w, pl)) / capD : 0;
}

/**
 * Aven running hours a plant needs today: the rest in step with its use (utilEma, 0 to 1), and standby for the part
 * of the plant kept ready (half again what is in use, at least a twentieth); the rest is mothballed and needs none.
 */
export function runHours(w, pl) {
	const u = Math.min(1, Math.max(0, pl.utilEma ?? 0.8));
	return standbyHours(w, pl) + fullHours(w, pl) * (1 - STANDBY) * u;
}
/** the standby part of a plant's running hours today */
export function standbyHours(w, pl) {
	const u = Math.min(1, Math.max(0, pl.utilEma ?? 0.8));
	return fullHours(w, pl) * STANDBY * Math.min(1, 0.05 + 1.5 * u);
}

/**
 * does a COOP keep its plant up? Only while it will need the capacity, and only while rebuilding pays: a COOP in a
 * glut (its store above target) that sells below its full cost lets its plant wear down instead of rebuilding it at a
 * loss. That is how a glut ends without anyone failing: the dearest capacity wears out first, and upkeep starts again
 * as soon as the store runs below 1.2 times its target or the price covers the full cost again. Electricity is left
 * out: its glut is the summer sun, and the same plants are what the winter needs
 */
const keepUp = (co) => co.good === ENERGY || (co.marginEma < (co.good <= BED ? 3 : 2) && !(co.marginEma > 1.2 && co.priceR < co.fullR));
/**
 * whatever the margin says, a COOP keeps up enough of its plant to make 1.5 times what it sells: a works whose buyers
 * are few (a panel works that only the solar COOPs' upkeep buys from) would otherwise let its whole plant wear away
 * while its store still looked full, and then ask a price nobody can pay for the next unit
 */
const keepFloor = (co) => (co.capDay ?? 0) < 1.5 * (co.demandEma ?? 0);
/**
 * a plant's materials are in a price spike: rebuilding a unit at today's prices costs more than SPIKE times what it
 * cost at the year's traded prices. Its COOP then waits the spike out instead of rebuilding worn units (no one
 * replaces a solar panel at a thousand times its price because the only panel works stood down and asks a fortune for
 * its next unit); its plant wears a little meanwhile, and upkeep starts again when the price comes back
 */
const SPIKE = 3;
const spiked = (w, pl) => unitNowR(w, pl) > SPIKE * unitSlowR(w, pl);
/**
 * what upkeep rebuilds a worn unit of a plant with: its build materials, with the glazing replaced glassX times as often
 * as the frame (glazing lasts ~30 years, a dome's frame 50: TECH glassLife)
 */
export function upkeepOf(w, pl) {
	const b = buildOf(w, pl), x = pl.def.glassX ?? 1;
	if (x === 1) return b;
	return { ...b, [GLASS]: b[GLASS] * x };
}
/** what a unit of a plant's capacity costs to build (or rebuild) at today's prices, in R */
export function unitNowR(w, pl) {
	const b = buildOf(w, pl), pb = w.pbar;
	// an accelerator costs the electricity exported for it, at today's import price
	let r = (b.kwh + (b.chips ?? 0) * chipKwhNow(w)) * pb[ENERGY];
	for (const g of MATERIALS) r += b[g] * pb[g];
	return r;
}
/** what a unit of a plant's capacity costs to rebuild at the year's traded prices (pbarSlow), in R */
export function unitSlowR(w, pl) {
	const b = buildOf(w, pl), pb = w.pbarSlow ?? w.pbar;
	let r = (b.kwh + (b.chips ?? 0) * chipKwhNow(w)) * pb[ENERGY];
	for (const g of MATERIALS) r += b[g] * pb[g];
	return r;
}
/** the electricity exported for one accelerator at today's import price, in kWh (B23's shock raises it) */
export const chipKwhNow = (w) => w.c.chipKwh * importFactor(w);
/** days of wear the upkeep store holds at most */
const UPKEEP_STORE_DAYS = 30;

// ── production plans and orders ──────────────────────────────────────────────────────────────────────────────────
/**
 * Each COOP plans today's output and asks for what it needs: electricity and heat for the dispatch, and materials
 * from the other COOPs (for its works, its upkeep and its building project).
 */
export function plan(w, req, heatReq) {
	const t = w.today;
	if (!w.b2b || w.b2b.length !== G * M) w.b2b = new Float64Array(G * M);
	w.b2b.fill(0);
	if (!w.b2bProd || w.b2bProd.length !== G * M) w.b2bProd = new Float64Array(G * M);
	w.b2bProd.fill(0);
	if (!w.b2bRun || w.b2bRun.length !== G * M) w.b2bRun = new Float64Array(G * M);
	w.b2bRun.fill(0);
	if (!w.b2bProj || w.b2bProj.length !== G * M) w.b2bProj = new Float64Array(G * M);
	w.b2bProj.fill(0);
	for (const co of w.coops) {
		co.planned = 0;
		co.eReq = [0, 0, 0, 0];
		co.heatReq = 0;
		co.upkeepPlan = 0;
		if (!co.alive) continue;
		const f = shockFactor(w, co);
		// what its plants are rated for (the auditors' figure) and what it can make today
		co.ratedDay = capDayOf(w, co, w.day);
		co.capDay = co.ratedDay * f;
		// the forest's harvest needs processing energy; the store, rain, beds, wells and springs are cleared later
		if (co.harvestToday > 0) co.eReq[CLASS.basics] += co.harvestToday * kwhOf(w, co.plants.find((p) => p.tech === 'forest'));
		// the irrigation pumps (./food.js foodSeason: today's rain shortfall), by the COOP's share of the outdoor food land
		if (t.irrigM3 > 0) {
			const fm = co.plants.reduce((a, p) => a + (p.tech === 'forest' ? p.cap : 0), 0);
			if (fm > 0) co.eReq[CLASS.basics] += (t.irrigM3 * w.c.irrigKwhM3 * fm) / Math.max(1, w.c.village.outdoorFoodM2 * w.c.vf);
		}
		const H = horizonOf(co);
		const target = (H > 180 ? 30 : Math.min(H, 60) + 5) * co.demandEma;
		const want = Math.max(0, co.demandEma + (target - co.stock) / 10);
		const matUse = new Float64Array(G), flowUse = new Float64Array(G);
		let chipsLeft = co.chips ?? 0;
		// the input store is shared by every plant's production and upkeep: what one plans takes it from the next, so
		// together they never draw more than the store holds
		const avail = Float64Array.from(co.inStock);
		for (const pl of co.plants) {
			const d = pl.def;
			pl.plan = 0;
			// the halls' standing electricity (light, air, controls), in the running class; the food domes' climate with the
			// basics (they grow food)
			co.eReq[d.kind === 'greenhouse' ? CLASS.basics : CLASS.running] += standingKwh(w, pl);
			if (d.kind === 'works' || d.kind === 'timber' || d.kind === 'greenhouse') {
				// the food domes grow by the month's light (an average day of the year = 1); with LED light (setting led)
				// a dark month is topped up to the year's average day, at the light's kWh a unit
				let cap = plantCapDay(w, pl, w.day) * f;
				pl.ledPlan = 0;
				if (d.kind === 'greenhouse') {
					// the month's inside light against an average day of the year (./food.js indoorIndex, set by the calendar)
					const [gi, gl] = t.ghIdx ?? [1, 1];
					const lit = cap * gi;
					if (w.c.ledKwh != null && gl > gi) pl.ledPlan = cap * (gl - gi);
					cap = lit + pl.ledPlan;
				}
				// the food domes grow all their light gives while the village's food sellers see a shortfall ahead that
				// they would have to buy at the border (the dark months): what they grow in the bright months keeps in the
				// store for winter (a fuller store lowers the price: ./market.js)
				const growAll = d.kind === 'greenhouse' && (w.goodDeficit?.[co.good] ?? 0) > IN_HAND;
				let p = growAll ? cap : Math.min(cap, want * (cap / Math.max(1e-12, co.capDay)));
				// raw stock and input stores bound the plan
				for (const [g, a] of inputsOf(w, pl)) {
					if (typeof g === 'number') p = Math.min(p, Math.max(0, avail[g]) / a);
					else p = Math.min(p, pl.raw / a);
				}
				pl.plan = Math.max(0, p);
				for (const [g, a] of inputsOf(w, pl)) if (typeof g === 'number') avail[g] -= a * pl.plan;
				co.planned += pl.plan;
				const cls = d.kind === 'greenhouse' ? CLASS.basics : CLASS.running;
				co.eReq[cls] += pl.plan * kwhOf(w, pl);
				// the LED light for what the dark month's sun does not grow (the plan's part above the light's)
				if (pl.ledPlan > 0) {
					const lit = Math.max(0, cap - pl.ledPlan);
					pl.ledPlan = Math.max(0, pl.plan - lit);
					co.eReq[cls] += pl.ledPlan * w.c.ledKwh;
				}
				// the dome is heated only where it grows: the part it does not plant (no buyer for it) is left cold
				// (in a month too dark to grow, the planted part is kept warm all the same: the share planted last)
				if (d.kind === 'greenhouse') {
					if (cap > 1e-12) pl.planted = Math.min(1, pl.plan / cap);
					co.heatReq += Math.max(0, pl.cap - pl.worn) * w.c.ghHeatM2 * t.heatShare * (w.learn.greenhouse.coef.heat ?? 1) * (pl.planted ?? 1);
				}
				for (const [g, a] of inputsOf(w, pl)) if (typeof g === 'number') (matUse[g] += a * cap * 0.8), (flowUse[g] += a * pl.plan);
			}
			// upkeep: rebuild what wore, from the plant's own materials, while the COOP will need the capacity (a COOP
			// with more than twice what it can sell lets its plant wear down; a basic, more than three times)
			const keep = keepUp(co);
			const floorOnly = !keep && keepFloor(co);
			if (pl.worn > 1e-12 && d.life > 0 && (keep || floorOnly) && !spiked(w, pl)) {
				const b = buildOf(w, pl);
				let r = pl.worn;
				// kept up only to the floor: the units that bring its output back to 1.5 times what it sells
				if (floorOnly && d.kind !== 'hall') {
					const perUnit = plantCapDay(w, { ...pl, worn: 0 }, w.day) / Math.max(1e-12, pl.cap);
					r = Math.min(r, perUnit > 0 ? (1.5 * co.demandEma - co.capDay) / perUnit : 0);
				}
				const bu = upkeepOf(w, pl);
				for (const g of MATERIALS) if (bu[g] > 0) r = Math.min(r, Math.max(0, avail[g]) / bu[g]);
				if (b.chips > 0) {
					r = Math.min(r, Math.max(0, chipsLeft) / b.chips);
					chipsLeft -= r * b.chips;
				}
				pl.upkeepPlan = Math.max(0, r);
				for (const g of MATERIALS) if (bu[g] > 0) avail[g] -= bu[g] * pl.upkeepPlan;
				co.eReq[CLASS.running] += pl.upkeepPlan * b.kwh;
			} else pl.upkeepPlan = 0;
		}
		// materials to order: two weeks of the works' use and what upkeep needs (a quarter of the gap a day); the
		// project's materials spread over its building time, and a project only takes what the works do not need
		co.matDaily = matUse;
		co.exportUp = co.exportBuild = 0;
		const wantMat = new Float64Array(G);
		for (const g of MATERIALS) wantMat[g] = matUse[g] * 14;
		// upkeep's store holds at most a month of wear: a plant let wear down for years catches up at a few times its
		// wear a day, not with one order for all of it (which would empty every seller's store at once)
		for (const pl of co.plants)
			if (pl.worn > 0 && pl.def.life > 0 && (keepUp(co) || keepFloor(co)) && !spiked(w, pl)) {
				const b = upkeepOf(w, pl);
				const gap = Math.min(pl.worn, (UPKEEP_STORE_DAYS * pl.cap) / (pl.def.life * 365));
				for (const g of MATERIALS) wantMat[g] += b[g] * gap;
			}
		const pr = co.project;
		if (pr) {
			// a project draws its energy at its planned pace (at most twice it when behind), not all that is left at once
			const daysLeft = Math.max(1, pr.minDays - (w.day - pr.start));
			const pace = (pr.kwh0 ?? pr.kwh) / Math.max(1, pr.minDays);
			co.eReq[CLASS.building] += Math.min(pr.kwh, Math.max(Math.min(pr.kwh / daysLeft, 2 * pace), pace));
		}
		// a COOP that buys at the border (food, the works' raw inputs, a hardware owner's accelerators) exports electricity
		// to fill its deposit at the bank (./border.js exportPlan)
		if (co.eurSpentEma > 0 || co.eurToday > 0 || co.deficitAhead > 0) exportPlan(w, co);
		// the MaiaCity COOP's bank exports for what it advanced and to pay its founders back (./border.js bankExport)
		if (co.city && w.border) bankExport(w, co);
		for (const g of MATERIALS) {
			// today's use, and a seventh of what the store lacks
			const o = (flowUse[g] ?? 0) + Math.max(0, wantMat[g] - co.inStock[g]) / 7;
			if (o > 0) w.b2bProd[g * M + co.k] = o;
			if (pr && pr.mat[g] > 1e-12) {
				const daysLeft = Math.max(1, pr.minDays - (w.day - pr.start) - 7);
				const spare = Math.max(0, co.inStock[g] - wantMat[g]);
				w.b2bProj[g * M + co.k] = Math.max(0, Math.max(pr.mat[g] / daysLeft, 0.05 * pr.mat[g]) - spare);
			}
			w.b2b[g * M + co.k] = w.b2bProd[g * M + co.k] + w.b2bProj[g * M + co.k];
		}
		// R&D: buy surplus energy with this week's R&D budget, at today's price
		if (co.rdBudgetR > 0 && w.cfg.rd) co.eReq[CLASS.rd] += co.rdBudgetR / 7 / Math.max(1e-9, w.pbar[ENERGY]);
		for (let cl = 0; cl < 4; cl++) req[cl] += co.eReq[cl];
		heatReq.basics += co.heatReq;
	}
}

/** how many times the border's price of an accelerator (in exported kWh) is raised by a scheduled import shock (B23) */
export function importFactor(w) {
	let f = 1;
	for (const s of w.cfg.shocks) if (s.kind === 'importPrice' && w.day >= s.day && w.day < s.day + (s.days ?? 365)) f *= s.factor ?? 2;
	return f;
}

/** worn steel back to the steelworks' scrap yards (by their size): the village's own scrap, before any is bought */
function scrapBack(w, t) {
	if (!(t > 0)) return;
	let cap = 0;
	const yards = [];
	for (const co of w.coops) if (co.alive) for (const pl of co.plants) if (rawOf(pl)?.[0] === 'scrap') (yards.push(pl), (cap += Math.max(1e-9, pl.cap)));
	if (!yards.length) return;
	for (const pl of yards) pl.raw += (t * Math.max(1e-9, pl.cap)) / cap;
	w.today.raw.grown.scrap = (w.today.raw.grown.scrap ?? 0) + t;
}

/**
 * After the dispatch: the works make what their energy allows (into tomorrow's store), the forest's unprocessed
 * harvest rots, upkeep rebuilds worn capacity, and building projects take their materials and energy.
 */
export function produce(w, fill) {
	const t = w.today;
	const fa = t.fillA ?? fill[CLASS.basics];
	w.exportToday = 0;
	for (const co of w.coops) {
		co.made = 0;
		co.limiter = LIMIT.none;
		co.rdKwhToday = 0;
		if (!co.alive) continue;
		// accelerators: the electricity exported today (after the city's building class) earns euros at the wholesale
		// price into this COOP's account in the euro reserve; the reserve buys whole accelerators at their list price. The
		// euros never become MIND and no person holds them
		const exKwh = co.exportUp * (t.fillExportUp ?? 1) + co.exportBuild * (t.fillExportBuild ?? 1);
		// the export that replaces worn accelerators cut by the dispatch (the city's own needs took the electricity):
		// energy binds the halls that stand worn (./engine.js physicalLimit reads it)
		if (co.exportUp > 0) co.exUpFillEma = (co.exUpFillEma ?? 1) + ((t.fillExportUp ?? 1) - (co.exUpFillEma ?? 1)) / 30;
		const pEx = exportEurKwh(w);
		co.exportEurEma = (co.exportEurEma ?? 0) + (exKwh * pEx - (co.exportEurEma ?? 0)) / 30;
		if (exKwh > 0) {
			const B = w.border, eur = exKwh * pEx;
			t.exportEurBy = t.exportEurBy ?? new Float64Array(G);
			t.exportEurBy[co.good] += eur;
			// a COOP's export into its deposit at the bank; the bank's own export into its own euros
			if (co.city) B.shared += eur;
			else B.eur[co.k] += eur;
			t.eurIn = (t.eurIn ?? 0) + eur;
			t.exportBy = t.exportBy ?? new Float64Array(G);
			t.exportBy[co.good] += exKwh;
		}
		// forest: what the first part of the basics class could not process is lost
		// (a COOP that could not pay for all of its basics energy today, co.own < 1, processes and grows that much less)
		const fo = fa * (co.own ?? 1);
		if (co.harvestToday > 0) {
			const lost = fo < 1 ? Math.min(co.stock, co.harvestToday * (1 - fo)) : 0;
			co.stock -= lost;
			t.rotted[FOOD] += lost;
			co.made += co.harvestToday - lost;
		}
		for (const pl of co.plants) {
			const d = pl.def;
			if (pl.plan > 0) {
				const fe = d.kind === 'greenhouse' ? fo : fill[CLASS.running];
				const x = pl.plan * fe;
				for (const [g, a] of inputsOf(w, pl)) {
					if (typeof g === 'number') {
						co.inStock[g] -= a * x;
						t.input[g] += a * x;
					} else {
						pl.raw -= a * x;
						t.raw.used[g] += a * x;
					}
				}
				if (co.good === FOOD) {
					foodIn(co, x, w.c.protIn);
					t.foodIn = (t.foodIn ?? 0) + x;
					// what the domes grew and was lost in storage, processing and the kitchen: made and rotted today
					const lost = (x * w.c.ghLoss) / (1 - w.c.ghLoss);
					t.made[FOOD] += lost;
					t.rotted[FOOD] += lost;
					t.foodLost = (t.foodLost ?? 0) + lost;
					// the LED light's share of what the food domes grew today
					if (pl.ledPlan > 0 && pl.plan > 0) t.ledUnits = (t.ledUnits ?? 0) + x * (pl.ledPlan / pl.plan);
				} else co.stock += x;
				co.made += x;
				t.made[co.good] += x;
				pl.out = x;
				if (w.learn[pl.tech].rdOn) w.learn[pl.tech].Q += x;
				if (fe < 0.999) co.limiter = LIMIT.energy;
			}
			if (pl.upkeepPlan > 0) {
				const b = buildOf(w, pl), bu = upkeepOf(w, pl);
				const r = pl.upkeepPlan * fill[CLASS.running];
				for (const g of MATERIALS)
					if (bu[g] > 0) {
						co.inStock[g] -= bu[g] * r;
						t.built[g] += bu[g] * r;
						co.upkeepRToday = (co.upkeepRToday ?? 0) + bu[g] * r * (co.inCostR?.[g] ?? w.pbar[g]);
					}
				// the worn steel it takes out goes back to the steelworks as scrap (nine tenths of it)
				if (bu[STEEL] > 0) scrapBack(w, bu[STEEL] * r * w.c.scrapBack);
				if (b.chips > 0) {
					co.chips -= b.chips * r;
					t.chipsUsed = (t.chipsUsed ?? 0) + b.chips * r;
				}
				pl.worn -= r;
				// what is rebuilt is rebuilt to today's recipe
				refit(w, pl, r, pl.cap - r);
			}
		}
		// the building project: materials from the input store, energy from the building class
		const pr = co.project;
		if (pr) {
			for (const g of MATERIALS) {
				const x = Math.min(pr.mat[g], Math.max(0, co.inStock[g] - 7 * (co.matDaily?.[g] ?? 0)));
				if (x > 0) {
					pr.mat[g] -= x;
					co.inStock[g] -= x;
					t.built[g] += x;
				}
			}
			pr.kwh -= co.eReq[CLASS.building] * fill[CLASS.building];
			if (pr.kwh < 1e-6) pr.kwh = 0;
			// a project that waits on the building class's electricity (under nine tenths of what it asked, over the last
			// 30 days): energy binds the build (./engine.js physicalLimit reads it)
			if (co.eReq[CLASS.building] > 0) co.bldFillEma = (co.bldFillEma ?? 1) + (fill[CLASS.building] - (co.bldFillEma ?? 1)) / 30;
			if (pr.kwh > 0 && (co.bldFillEma ?? 1) < 0.9) co.buildLimit = LIMIT.energy;
			else if (co.buildLimit === LIMIT.energy) co.buildLimit = LIMIT.none;
			if (pr.kwh === 0 && MATERIALS.every((g) => pr.mat[g] <= 1e-9) && !(pr.chips > 1e-9) && w.day - pr.start >= pr.minDays) finishProject(w, co);
		}
		// R&D energy delivered goes into the technology's knowledge
		const rd = co.eReq[CLASS.rd] * fill[CLASS.rd];
		if (rd > 0) {
			co.rdKwhToday = rd;
			co.rdKwhWeek += rd;
			const tech = co.plants.find((p) => w.learn[p.tech] && Object.keys(w.learn[p.tech].coef).length)?.tech;
			if (tech) w.learn[tech].K += rd / 1000;
		}
	}
}

// ── running items, wear ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * Pay `R` (in R) of Aven work items to people, in proportion to what their Aven delivers: in the paying COOP's own
 * MIND first, then in the other MINDs its treasury holds (largest first). Returns what was paid, in R.
 */
export function payAvens(w, k, R) {
	if (!(R > 0)) return 0;
	const N = w.N, P = w.P, row = k * M;
	// each person's weight: its Aven's skill × the work hours it delivered today (./coops.js workItems sets w.workW)
	const wt = w.workW ?? w.aven;
	let tot = 0;
	for (let i = 0; i < N; i++) tot += wt[i];
	if (!(tot > 0)) return 0;
	const order = [k];
	const others = [];
	for (let j = 0; j < M; j++) if (j !== k && w.tre[row + j] > 0 && w.liquid[j] && P[j] > 0) others.push(j);
	others.sort((a, b) => w.tre[row + b] * P[b] - w.tre[row + a] * P[a] || a - b);
	order.push(...others);
	let paid = 0;
	for (const j of order) {
		const left = R - paid;
		if (!(left > R * 1e-12)) break;
		const h = w.tre[row + j];
		if (!(h > 0) || !(P[j] > 0)) continue;
		const x = Math.min(h, left / P[j]);
		w.tre[row + j] -= x;
		const f = x / tot;
		let given = 0;
		for (let i = 0; i < N; i++) {
			const a = wt[i];
			if (a > 0) {
				const y = a * f;
				w.hold[i * M + j] += y;
				given += y;
			}
		}
		w.tre[row + j] += x - given; // rounding stays home
		paid += given * P[j];
	}
	if (paid > 0) for (let i = 0; i < N; i++) if (wt[i] > 0) w.income[i] += (wt[i] * paid) / tot;
	return paid;
}

/** the Aven hours the COOPs need today: every plant's running hours (and the racks'), and a seventh of the work
 * proposals posted and not yet delivered (./engine.js calls it before the people's orders) */
export function workNeed(w) {
	let run = 0, prop = 0;
	for (const co of w.coops) {
		if (!co.alive) continue;
		run += co.inf?.rackH ?? 0;
		for (const pl of co.plants) run += runHours(w, pl);
		prop += (co.propBacklogR ?? 0) / PROP_DAYS / w.c.rateR;
	}
	return (w.workNeed = { run, prop });
}

/**
 * The work items of the day (round 4, Samuel 07:27: the personal Avens work for all COOPs). The COOPs need Aven hours:
 * every plant's running hours (and the hardware owners' racks), and the work proposals their treasuries posted
 * (./coops.js payout), worked off a seventh a day. The personal Avens deliver them with the Aven service their persons
 * bought for work (./market.js peopleOrders, ./engine.js clearPeople): running items first, proposals with the rest.
 * Each COOP pays the rate card for the hours delivered, in its own MIND first, to the people in proportion to their
 * Avens' skill × the work hours they delivered (payAvens). Hours not delivered are not paid; a COOP whose running
 * hours fell short runs that much less tomorrow (./engine.js affordCoops).
 */
export function workItems(w) {
	const N = w.N, t = w.today, rateR = w.c.rateR;
	const need = w.workNeed ?? { run: 0, prop: 0 };
	if (!w.workW || w.workW.length !== w.Nmax) w.workW = new Float64Array(w.Nmax);
	let WH = 0, Wsum = 0;
	for (let i = 0; i < N; i++) {
		const h = w.workH ? w.workH[i] : 0;
		WH += h;
		w.workW[i] = h > 0 ? w.aven[i] * h : 0;
		Wsum += w.workW[i];
	}
	const runFill = need.run > 0 ? Math.min(1, WH / need.run) : 1;
	const propFill = need.prop > 0 ? Math.min(1, Math.max(0, WH - need.run) / need.prop) : 1;
	let paidAll = 0, runH = 0;
	for (const co of w.coops) {
		if (!co.alive) continue;
		let h = co.inf?.rackH ?? 0;
		for (const pl of co.plants) h += runHours(w, pl);
		runH += h;
		const R = h * rateR * runFill;
		const paid = Wsum > 0 ? payAvens(w, co.k, R) : 0;
		co.runToday = paid;
		// (hours the Avens did not deliver are not the treasury's failure: only what it could not pay counts)
		co.unpaidH = R > 0 ? Math.max(0, 1 - paid / R) * h * runFill : 0;
		co.costR += paid;
		t.runningR += paid;
		paidAll += paid;
		// the work proposals it posted: a seventh a day, as far as the Avens deliver them
		const bl = co.propBacklogR ?? 0;
		if (bl > 0) {
			const due = (bl / PROP_DAYS) * propFill;
			const p = Wsum > 0 && due > 0 ? payAvens(w, co.k, due) : 0;
			co.propBacklogR = Math.max(0, bl - bl / PROP_DAYS);
			co.payoutToday = (co.payoutToday ?? 0) + p;
			t.proposalsR += p;
			paidAll += p;
		}
	}
	w.runFillY = runFill;
	t.work = { WH, needRun: need.run, needProp: need.prop, runFill, propFill, paidR: paidAll, runH };
	// what a skill-weighted work hour paid today (the Avens judge from it whether a work hour is worth buying)
	if (Wsum > 0) w.workPayEma = (w.workPayEma ?? rateR) + (paidAll / Wsum - (w.workPayEma ?? rateR)) / 30;
}

/** capital wears at 1 ÷ life a year; upkeep (in produce) rebuilds it */
export function wear(w) {
	const wearOne = (pl) => {
		// what still stands wears (a share of it, 1 ÷ life a year): a plant kept up loses its capacity ÷ life a year, as
		// before; one left alone fades (to a third in a life) rather than vanishing on a fixed day, so a works nobody
		// keeps up still has something to restart from
		// (the part of a tenant's plant that is the landlord's dome does not wear here: the landlord's hall plant does)
		if (pl.def.life > 0 && pl.cap > 0) pl.worn = Math.min(pl.cap, pl.worn + (ownShare(pl) * Math.max(0, pl.cap - pl.worn)) / (pl.def.life * 365));
	};
	for (const co of w.coops) {
		if (!co.alive) continue;
		for (const pl of co.plants) {
			wearOne(pl);
			// the battery fades a share of its first capacity a year (cells cannot be made in the city)
			if (pl.battCap0 > 0) {
				pl.battCap = Math.max(0, pl.battCap - (pl.battCap0 * w.c.battFade) / YEAR_DAYS);
				if (pl.batt > pl.battCap) pl.batt = pl.battCap;
			}
		}
	}
	// plants the City COOP holds idle wear too (nobody keeps them up)
	for (const pl of w.coops[w.cityK].idle ?? []) wearOne(pl);
}

// ── building ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** land the City COOP has not leased */
export function freeLand(w) {
	let used = w.land.cityM2;
	for (const co of w.coops) if (co.alive || co.plants.length) for (const pl of co.plants) used += pl.landM2;
	// the plants the City COOP holds idle keep their plots (they stand on them, ready to be leased on)
	for (const pl of w.coops[w.cityK]?.idle ?? []) used += pl.landM2;
	return w.land.totalM2 - used;
}

/** plant kinds a COOP can stand down a part of (a hall, a works, a row of homes); not land, nature or a power plant */
const MOTHBALL_KINDS = ['home', 'works', 'service'];
/**
 * A COOP that has much more plant than it sells, and sells below its full cost, hands the part it does not use to the
 * City COOP to stand idle (weekly): the units above 1.5 times what it sells, at most a tenth of the plant a week (all
 * of it at once on day 0, or on a day it could not pay for the energy of the basics it delivers).
 * An idle unit needs no running hours, no standing electricity and no ground rent, so what the COOP still runs can
 * earn its keep at the price the glut allows; while it carried the empty units it sold at its floor, covered only
 * its variable cost, ran its treasury dry and could no longer pay for the energy of the basics it delivers. The City
 * COOP leases the idle units on as soon as the good is short (./coops.js foundings).
 */
function mothball(w) {
	if (rampOn(w)) return;
	const city = w.coops[w.cityK];
	for (const co of w.coops) {
		if (!co.alive || co.city || co.project || co.good === ENERGY || w.day < (co.mothballFrom ?? 0)) continue;
		// on day 0 (a field built for more people than live on it) and when it cannot pay for the energy of the basics it
		// delivers, a COOP stands down all it does not use at once; otherwise only in a glut it sells into at a loss
		const now = w.day === 0 || (co.own ?? 1) < 1;
		if (!now && !(co.marginEma > 1.5 && co.priceR < co.fullR)) continue;
		const capNow = capDayOf(w, co, w.day), want = 1.5 * (co.demandEma ?? 0);
		if (!(capNow > want) || !(want > 0)) continue;
		let excess = capNow - want;
		for (const pl of co.plants) {
			if (!MOTHBALL_KINDS.includes(pl.def.kind) || !(pl.cap > 0) || excess <= 0) continue;
			const live = Math.max(0, pl.cap - pl.worn);
			const perUnit = live > 0 ? plantCapDay(w, pl, w.day) / live : 0;
			if (!(perUnit > 0)) continue;
			let x = Math.min(excess / perUnit, now ? live : 0.1 * live);
			if (pl.def.kind === 'home') x = Math.floor(x);
			if (!(x > 0) || x >= live) continue;
			// the idle part takes standing units, their share of the land, cells and battery, at the plant's book value
			const f = x / live;
			const part = { cap: x, landM2: pl.landM2 * (x / pl.cap), domeKwp: pl.domeKwp * f, fieldKwp: pl.fieldKwp * f, batt: pl.batt * f, battCap: pl.battCap * f, battCap0: pl.battCap0 * f, hostedCap: (pl.hostedCap ?? 0) * (x / pl.cap) };
			for (const key of Object.keys(part)) pl[key] -= part[key];
			// units of the same technology stood down earlier make one idle plant (book value: the average of both)
			city.idle = city.idle ?? [];
			const same = city.idle.find((q) => q.mothballed && q.tech === pl.tech);
			if (same) {
				same.bookR = ((same.bookR ?? pl.bookR ?? 0) * same.cap + (pl.bookR ?? same.bookR ?? 0) * x) / (same.cap + x);
				for (const key of Object.keys(part)) same[key] += part[key];
			// (the tenant keeps renting its dome space: the idle part pays no rent of its own)
			} else city.idle.push({ ...pl, vc: { ...pl.vc }, plots: [], worn: 0, raw: 0, pits: 0, out: 0, plan: 0, upkeepPlan: 0, mothballed: true, hosts: [], ...part });
			excess -= x * perUnit;
			w.events.push({ day: w.day, kind: 'mothball', coop: co.id, what: pl.tech, units: x });
		}
	}
}

/** what limits building more of this COOP's good: the plan it can make, or the physical reason it cannot */
function buildPlan(w, co) {
	const gap = Math.max(0, co.demandEma * 1.15 - co.capDay);
	const pl = co.plants[0];
	if (!pl) return null;
	const d = pl.def;
	const s = w.c.scale;
	let tech = pl.tech, units = 0, land = 0, pits = 0, why = LIMIT.capacity;
	switch (d.kind) {
		case 'spring':
			return { why: LIMIT.nature };
		case 'service':
			units = Math.max(100 * s, gap * 1.25);
			land = units * d.land;
			break;
		case 'harness':
			// more harness does not help while the inference binds: the hardware owners' accelerators are the limit
			if ((pl.inferCapDay ?? 0) < Math.max(0, pl.cap - pl.worn) * 0.999 && pl.cap > 0) return { why: LIMIT.inference };
			units = Math.max(24 * 25 * s, gap * 1.25);
			break;
		case 'forest': {
			// plant more forest: it gives 10 % in its first year, all of it in its tenth (ramp)
			const uM2 = w.c.forest100 / (w.learn.forest.coef.yield ?? 1);
			units = Math.max(2000 * s, (gap * 365) / uM2);
			land = units;
			why = LIMIT.ramp;
			break;
		}
		case 'greenhouse':
			units = Math.max(500 * s, (gap * 365 * (w.learn.greenhouse.coef.yield ?? 1)) / w.c.ghYield);
			land = units;
			break;
		case 'rain':
			units = Math.max(50 * s, 0.25 * pl.cap);
			break;
		case 'well': {
			const room = w.c.rechargeL / 1000 - pl.cap;
			if (room <= 0.5) return { why: LIMIT.water };
			units = Math.min(room, Math.max(5 * s, gap / 1000));
			break;
		}
		case 'solar':
			units = Math.max(50 * s, (co.demandEma * 1.15 * 365) / w.c.kwhPerKwp - pl.cap * 0.25);
			land = units * d.land * (w.learn.solar.coef.cells ?? 1);
			break;
		case 'geo':
			// a stage is the village's pad: at most geoMax stages (the physics audit: the last stage is clipped to what is
			// left, so the plant never passes geoMax)
			if (pl.cap >= w.c.geoMax * s - 1e-9) return { why: LIMIT.energy };
			units = Math.min(s, w.c.geoMax * s - pl.cap);
			break;
		case 'home':
			units = Math.max(8 * s, Math.ceil(Math.max(gap, w.N * 1.05 - totalBeds(w)))); // the city's bed gap, not this COOP's
			land = units * d.land;
			break;
		case 'timber': {
			// wood: if the logs pile up the works binds; if not, the land does
			// (in t of glulam the logs make: a tonne of glulam takes logsPerT tonnes of logs)
			const logsDay = logsGrowth(w, pl, w.day) / logsPerT(pl);
			// the works binds when the land grows more logs than it can saw (or there is no works yet)
			if (pl.cap / 365 < 0.9 * logsDay || pl.cap <= 0) {
				units = Math.max(20 * s, gap * 365 * 1.25);
				land = units * d.land;
			} else {
				tech = 'timberLand';
				const tHa = (w.c.timberT * 1e4) / (w.learn.timber.coef.yield ?? 1);
				land = Math.max(5000 * s, ((Math.max(gap, co.capDay - logsDay) * logsPerT(pl) * 365) / tHa) * 1e4);
				units = land;
				why = LIMIT.land;
			}
			break;
		}
		case 'works': {
			if (d.deposit) {
				const ratio = d.inputs.find((x) => x[0] === d.deposit)[1];
				const perPit = (d.deposit === 'ore' ? w.c.oreT : w.c.sandT) / ratio;
				const pitCapYear = pl.pits * perPit;
				if (pl.cap >= pitCapYear * 0.98) {
					const used = w.coops.reduce((a, c) => a + (c.alive || c.plants.length ? c.plants.reduce((b, p) => b + (p.def.deposit === d.deposit ? p.pits : 0), 0) : 0), 0);
					const max = d.deposit === 'ore' ? w.c.oreMax : w.c.sandMax;
					if (used >= max - 1e-9) return { why: d.deposit === 'ore' ? LIMIT.ore : LIMIT.sand };
					tech = 'pit';
					pits = Math.min(max - used, s);
					units = 0;
					break;
				}
				units = Math.min(pitCapYear - pl.cap, Math.max(20 * s, gap * 365 * 1.25));
			} else units = Math.max(d.key === 'goods' ? 25 * s : 20 * s, (d.key === 'goods' ? gap : gap * 365) * 1.25);
			land = units * d.land;
			break;
		}
	}
	return { tech, units, land, pits, why };
}

/**
 * The weekly build rule (world model 4.3 step 13): a COOP that has been short (forward margin under 1) or sells
 * near its capacity orders capital, if the build pays back within 40 % of its life at today's prices, if land (or a
 * deposit) is free, and if its treasury can carry it. Basics also build ahead of people who will need a bed.
 */
export function buildDecisions(w) {
	const pb = w.pbar, pE = pb[ENERGY];
	w.land.unmetWeek = 0;
	if (w.day % 7 === 0) {
		w.land.bestBid = 0;
		mothball(w);
	}
	// during the build-out the plan decides what is built (./ramp.js)
	if (rampOn(w)) return;
	// the basics' COOPs decide first, so a short basic gets free land before a build for extras
	const order = w.coops.filter((c) => c.alive).sort((a, b) => (a.good <= BED ? 0 : 1) - (b.good <= BED ? 0 : 1) || a.k - b.k);
	for (const co of order) {
		if (!co.alive || co.project || !co.plants.length) continue;
		const isBed = co.good === BED;
		// a basic people have gone short of (on more than a tenth of the last 30 days): its builds skip the payback test
		// (a COOP that sells a basic builds to serve the need; the treasury still has to carry the build)
		const basicShort = BASICS.includes(co.good) && (w.peopleShortEma?.[co.good] ?? 0) > 0.1;
		// a COOP founded under Law 3 has no capacity yet: it builds its first plant. Others build when they are short and
		// the good as a whole is short too (no COOP builds into a glut its competitors can serve)
		const founding = co.plants.every((p) => p.cap <= 0 && !p.plots.length);
		const short = founding || ((co.shortEma ?? 0) > 0.5 && (co.marginEma < 0.97 || co.demandEma > 0.92 * co.capDay) && (w.goodMargin?.[co.good] ?? 0) < 1.05);
		const bedsNeeded = isBed && w.N * 1.05 > totalBeds(w);
		if (!short && !bedsNeeded) {
			co.buildLimit = LIMIT.none; // it does not need to build
			continue;
		}
		const bp = buildPlan(w, co);
		if (!bp || bp.why === LIMIT.nature || (!bp.units && !bp.pits)) {
			if (bp) co.buildLimit = bp.why;
			continue;
		}
		const pl = co.plants[0];
		// more works do not help while one of their inputs is short: that input is the limit
		const shortIn = inputShort(w, pl);
		if (shortIn >= 0 && !founding && bp.tech !== 'timberLand' && bp.tech !== 'pit') {
			co.buildLimit = LIMIT_OF_GOOD[shortIn];
			continue;
		}
		// without enough free land for the whole build, a COOP builds in steps: half of the free land at a time, while a
		// step is still a useful part of the build (the basics' COOPs decide first, so they step first)
		if (bp.land > 0) {
			const free = freeLand(w), step = 0.5 * free;
			if (bp.land > free + 1e-6 && step >= 0.1 * bp.land && step > firstPlotM2(w, pl.tech) * 0.5) {
				const f = step / bp.land;
				bp.units *= f;
				bp.land = step;
			}
		}
		const b = bp.tech === 'timberLand' || bp.tech === 'pit' ? { [WOOD]: 0, [STEEL]: 0, [GLASS]: 0, [PANEL]: 0, kwh: 0, chips: 0 } : buildOf(w, pl);
		// accelerators: without the border (chipImport false) the city has only the ones it holds
		let chipsNeed = (b.chips ?? 0) * bp.units;
		if (chipsNeed > 0 && w.cfg.chipImport === false && (co.chips ?? 0) < chipsNeed) {
			co.buildLimit = LIMIT.chips;
			continue;
		}
		const mat = new Float64Array(G);
		for (const g of MATERIALS) mat[g] = b[g] * bp.units;
		let kwh = b.kwh * bp.units;
		if (pl.tech === 'forest') kwh = (bp.units / 1e4) * 500; // planting energy: 0.5 MWh a ha
		let costR = kwh * pE;
		for (const g of MATERIALS) costR += mat[g] * pb[g];
		// pays back within 40 % of its life? (what one unit more sells for above its variable cost, a year, at the
		// price buyers pay for the good today)
		const marginR = Math.min(co.priceR, w.pbar[co.good] > 0 ? w.pbar[co.good] : co.priceR) - co.varR;
		const unitsDay = bp.tech === 'timberLand' ? (bp.units * w.c.timberT) / 365 / logsPerT(pl) : bp.tech === 'pit' ? 0 : unitsToDay(w, pl, bp.units);
		const life = pl.def.life > 0 ? pl.def.life : 40;
		// a year's earnings of the new capacity, after the ground rent of its plot
		const netYear = unitsDay * 365 * marginR - bp.land * w.land.rent * 365;
		costR += chipsNeed * chipKwhNow(w) * pE;
		if ((costR > 0 || bp.land > 0) && !(isBed && bedsNeeded) && !basicShort) {
			// a build that would pay without the ground rent of its plot, and does not with it, is held back by land: the
			// rent is what the other uses of a scarce m² bid for it (Ricardo), not a want of buyers
			const grossYear = unitsDay * 365 * marginR;
			const paysWithout = grossYear > 0 && (costR <= 0 || costR / grossYear <= 0.4 * life);
			const why = paysWithout && bp.land > 0 ? LIMIT.land : LIMIT.demand;
			if (!(netYear > 0)) {
				co.buildLimit = why;
				continue;
			}
			const payback = costR / netYear;
			if (payback > 0.4 * life) {
				co.buildLimit = why;
				continue;
			}
		}
		// land from the City COOP; a request that finds none is a bid: what the plot would earn a m² a day
		if (bp.land > 0 && bp.land > freeLand(w) + 1e-6) {
			w.land.unmetWeek += bp.land;
			const bid = (unitsDay * marginR - costR / (0.4 * life * 365)) / bp.land;
			w.land.bestBid = Math.max(w.land.bestBid ?? 0, bid);
			co.buildLimit = LIMIT.land;
			continue;
		}
		// the treasury must be able to carry the build's first two months (a build is paid as it goes: its materials and
		// energy are bought day by day from what the treasury can pay, and the reserve holds the rest of its cost back
		// from payouts); a lumpy plant built over a year, like a geothermal stage, starts on a sixth of its cost
		const treR = treasuryR(w, co.k);
		const minDays = bp.tech === 'pit' || bp.tech === 'timberLand' ? 14 : pl.def.buildDays;
		const carry = Math.min(1, 60 / Math.max(1, minDays));
		if (costR > 0 && treR < costR * carry) {
			// a treasury that cannot carry the whole build starts the part it can carry (at least a tenth of it, or one
			// bed), the way the land is taken in steps above; the rest waits for the next decision
			const f = treR / (costR * carry);
			const okStep = pl.def.kind === 'home' ? bp.units * f >= 1 : f >= 0.1;
			if (!(f > 0) || !okStep || bp.tech === 'pit') {
				co.buildLimit = LIMIT.treasury;
				continue;
			}
			const u0 = bp.units;
			bp.units = pl.def.kind === 'home' ? Math.floor(u0 * f) : u0 * f;
			const fu = bp.units / u0;
			bp.land *= fu;
			for (const g of MATERIALS) mat[g] *= fu;
			kwh *= fu;
			chipsNeed *= fu;
			costR *= fu;
		}
		co.project = { tech: bp.tech, units: bp.units, land: bp.land, pits: bp.pits, mat, kwh, kwh0: kwh, chips: chipsNeed, costR, start: w.day, minDays: bp.tech === 'pit' || bp.tech === 'timberLand' ? 14 : pl.def.buildDays };
		co.plannedR = costR;
		co.bldFillEma = 1;
		// the plot is leased at once, at today's ground rent
		if (bp.land > 0) signLease(w, pl, bp.land);
		w.events.push({ day: w.day, kind: 'build', coop: co.id, what: bp.tech, units: bp.units });
	}
}
/** an input good of a plant that is short across all its sellers (-1: none) */
function inputShort(w, pl) {
	for (const [g] of pl.def.inputs) if (typeof g === 'number' && (w.goodMargin?.[g] ?? Infinity) < 1) return g;
	return -1;
}
const totalBeds = (w) => w.coops.reduce((a, c) => a + (c.alive && c.good === BED ? capDayOf(w, c, w.day) : 0), 0);

/** capacity units to output a day */
function unitsToDay(w, pl, units) {
	const d = pl.def;
	switch (d.kind) {
		case 'greenhouse':
			return (units * w.c.ghYield) / 365;
		case 'well':
			return units * 1000;
		case 'home':
		case 'spring':
		case 'service':
		case 'harness':
			return units;
		case 'solar':
			return (units * w.c.kwhPerKwp) / 365;
		case 'geo':
			return units * w.c.geoKw * 24 * w.c.geoUptime;
		case 'forest':
			return (units * w.c.forest100) / 365;
		case 'rain':
			return 0;
		default:
			return d.key === 'goods' ? units : units / 365;
	}
}

/** a project is done: the capacity joins the plant (a new forest or timber plot ages from today) */
function finishProject(w, co) {
	const pr = co.project, pl = co.plants[0];
	// new land is planted with today's yield; new capacity is built to today's recipe (field solar's cells change only
	// its land and steel, which the build already used, so the dome cells keep theirs)
	if (pr.tech === 'timberLand') pl.plots.push({ m2: pr.units, born: w.day, yc: w.learn.timber.coef.yield ?? 1 });
	else if (pr.tech === 'pit') pl.pits += pr.pits;
	else if (pl.tech === 'forest') {
		pl.plots.push({ m2: pr.units, born: w.day, yc: w.learn.forest.coef.yield ?? 1 });
		pl.cap += pr.units;
	} else if (pl.tech === 'solar') {
		pl.fieldKwp += pr.units;
		pl.cap += pr.units;
	} else {
		refit(w, pl, pr.units, pl.cap);
		pl.cap += pr.units;
	}
	// the plant's book value a unit: the old units at their book value and the new ones at what this build cost
	if (pr.tech !== 'timberLand' && pr.tech !== 'pit' && pl.def.life > 0 && pr.units > 0) {
		const old = Math.max(0, pl.cap - pr.units);
		pl.bookR = ((pl.bookR ?? unitNowR(w, pl)) * old + pr.costR) / Math.max(1e-12, old + pr.units);
	}
	w.events.push({ day: w.day, kind: 'built', coop: co.id, what: pr.tech, units: pr.units });
	co.project = null;
	co.plannedR = 0;
}

// ── treasury: reserve, payout, R&D ───────────────────────────────────────────────────────────────────────────────
/** what a treasury holds, in R */
export function treasuryR(w, k) {
	let s = 0;
	for (let j = 0; j < M; j++) s += w.tre[k * M + j] * w.P[j];
	return s;
}

/**
 * The payout rule (weekly): a treasury keeps a reserve of `reserveDays` of its running costs plus its planned
 * building; of what it holds above that, it pays a share each week for accepted work proposals, which go to people in
 * proportion to what their Aven delivers. A share of every payout funds R&D proposals: half Aven work, half a budget
 * for surplus energy over the next week.
 */
export function payout(w, rate) {
	const cfg = w.cfg;
	rate = rate ?? cfg.payoutRate;
	for (const co of w.coops) {
		if (!co.alive) continue;
		const reserve = cfg.reserveDays * co.costREma + co.plannedR + co.rdBudgetR;
		// (the proposals it has posted and not yet paid are spoken for)
		const surplus = treasuryR(w, co.k) - reserve - (co.propBacklogR ?? 0);
		co.reserveR = reserve;
		// a COOP still without a plant (founded under Law 3) keeps what its founders put in for its first build
		const founding = co.plants.every((p) => p.cap <= 0 && !p.plots.length);
		if (!cfg.payout || !(surplus > 0) || founding) continue;
		const pay = surplus * rate;
		const learnable = cfg.rd && co.plants.some((p) => Object.keys(w.learn[p.tech].coef).length);
		const rd = learnable ? pay * cfg.rdShare : 0;
		// posted as work proposals (R&D's Aven half with them): the personal Avens work them off and are paid as they
		// deliver (./coops.js workItems)
		co.propBacklogR = (co.propBacklogR ?? 0) + pay - rd / 2;
		co.postedR = (co.postedR ?? 0) + pay - rd / 2;
		co.payoutToday = (co.payoutToday ?? 0) + rd / 2;
		w.today.postedR = (w.today.postedR ?? 0) + pay - rd / 2;
		co.rdBudgetR += rd / 2;
		w.today.rdR += rd / 2;
	}
}

/** R&D energy budgets are spent over a week; the learning curves move with the energy that arrived */
export function learn(w) {
	const rates = w.c.learnRates;
	w.buildCache = {};
	// is R&D running on a technology this week?
	for (const k of Object.keys(w.learn)) w.learn[k].rdOn = false;
	for (const co of w.coops) {
		if (!co.alive) continue;
		if (co.rdKwhWeek > 0) for (const pl of co.plants) w.learn[pl.tech].rdOn = true;
		// half of an unspent R&D budget goes back to the treasury's free money each week (the budget is only an
		// earmark: what was spent left with the energy bought)
		co.rdBudgetR *= 0.5;
		co.rdKwhWeek = 0;
	}
	for (const [key, L] of Object.entries(w.learn)) {
		const def = w.tech[key];
		if (!def.learnGroup) continue;
		const r = rates[def.learnGroup];
		const d = -log2(1 - r.search), b = -log2(1 - r.doing);
		if (!L.Q0) {
			let q = 0;
			for (const co of w.coops) if (co.alive) for (const pl of co.plants) if (pl.tech === key) q += Math.max(1e-9, unitsToDay(w, pl, pl.cap)) * 365;
			L.Q0 = Math.max(1e-9, q);
			L.Q = L.Q0;
		}
		// knowledge added by R&D is slowly forgotten (world model 5.4): a share of it a year
		L.K = w.c.K0 + (L.K - w.c.K0) * pow(1 - w.c.kDecay, 7 / YEAR_DAYS);
		const e = pow(L.K / w.c.K0, -d) * pow(Math.max(1, L.Q / L.Q0), -b);
		for (const c of Object.keys(L.coef)) L.coef[c] = def.floors[c] + (1 - def.floors[c]) * Math.min(1, e);
	}
}

// ── ground rent ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Ground rent (weekly): every COOP pays the City COOP for its plots, in MIND that the pools turn into CITYmind
 * (under the private-land rule, to the landowners instead). The rent rises when land is asked for and none is free,
 * and falls when land lies empty. Land is never sold.
 */
export function rentDue(w) {
	const out = [];
	for (const co of w.coops) {
		if (!co.alive || co.city) continue;
		let R = 0;
		for (const pl of co.plants) if (!(pl.rentGrace > w.day)) R += pl.landM2 * (pl.rentRate ?? w.land.rent);
		if (R > 0) out.push([co, R * 7]);
	}
	return out;
}
/**
 * A lease is signed at the day's ground rent and keeps it (an Erbbaurecht: long leases at a fixed ground rent);
 * a plant that leases more plots pays the average of its leases.
 */
export function signLease(w, pl, m2) {
	const old = Math.max(0, pl.landM2);
	pl.rentRate = old + m2 > 0 ? ((pl.rentRate ?? w.land.rent) * old + w.land.rent * m2) / (old + m2) : w.land.rent;
	pl.landM2 = old + m2;
}
export function adjustRent(w) {
	// an auction in small steps: the rent rises while someone bids more than it for land that is not there, up to
	// the best bid, and falls while land lies empty
	const free = freeLand(w) / w.land.totalM2;
	const bid = w.land.bestBid ?? 0;
	if (w.land.unmetWeek > 0 && bid > w.land.rent) w.land.rent = Math.min(bid, w.land.rent * 1.03);
	else if (free > 0.05) w.land.rent *= 0.99;
	w.land.bestBid = 0;
}

// ── founding and receivership ────────────────────────────────────────────────────────────────────────────────────
/**
 * Open a new COOP in the next free MIND slot (a failed COOP's slot is never reused: its MIND still exists, held by its
 * holders, and melts away). Its basket is itself, the CITYmind and the two MINDs that receive the most HEARTS; three
 * founders whose Avens deliver put all their HEARTS into it for its first 90 days.
 */
export function openCoop(w, g, idBase, plants, priceR) {
	const slot = w.coops.length;
	if (slot >= M) return null;
	// the next letter not yet taken by a COOP of that name (A, B … Z, then AA, AB …)
	let n = w.coops.filter((c) => c.good === g).length, id;
	do id = idBase + '-' + (n < 26 ? String.fromCharCode(65 + n) : String.fromCharCode(64 + Math.floor(n / 26)) + String.fromCharCode(65 + (n % 26)));
	while (w.coops.some((c) => c.id === id) && ++n);
	const co = newCoop(w, slot, id, g, w.day);
	co.priceR = priceR;
	co.ref = priceR;
	co.price = priceR / (w.P[slot] > 0 ? w.P[slot] : 1);
	co.plants = plants;
	co.demandEma = 0;
	w.coops.push(co);
	// partners: the two MINDs that HEARTS flow into most (a month's average), so that every side of the new pool fills
	// from the first week (a MIND nobody puts HEARTS into any more would leave the pool dead and the new COOP unpaid)
	const inflow = new Float64Array(M);
	for (const c of w.coops) if (c.alive && !c.city && c.k !== slot) inflow[c.k] = c.heartsEma;
	const partners = [...inflow.keys()].filter((j) => j !== w.cityK && j !== slot && w.coops[j]?.alive && inflow[j] > 0).sort((a, b) => inflow[b] - inflow[a]).slice(0, 2);
	w.pools.push(newPool([slot, w.cityK, ...partners]));
	indexPools(w);
	buildCycles(w);
	w.founders = w.founders ?? [];
	for (let x = 0; x < 3; x++) {
		const i = Math.floor(rnd(w) * w.N);
		if (!w.owner[i]) w.founders.push({ i, k: slot, until: w.day + 90 });
	}
	return co;
}

/**
 * Law 3 (monthly). First the plants the City COOP holds idle (a failed COOP's, with no heir): when their good is
 * wanted, a basic with fewer than two sellers or a good with none gets a new COOP founded on them (so the good keeps
 * two competing sellers), and any other good's strongest seller leases them, with 180 days' grace on rent. Then the
 * foundings: where a good has been short for two months running (every seller's forward margin under 0.9), or its
 * price sits above 1.5 × full cost, or a basic has had a single seller for 90 days, an Aven founds a COOP. It takes
 * the City COOP's idle plants of that good if there are any; otherwise it copies a technology the good's sellers use
 * and builds its first plant. No founding starts while an earlier founding of the good is still unbuilt, while a
 * physical limit (land, a deposit, accelerators, energy, nature) stops the incumbents' own builds (it would stop the
 * founder too), or within a year of the last one.
 */
export function foundings(w) {
	// during the build-out the plan decides what is built (./ramp.js)
	if (rampOn(w)) return;
	const city = w.coops[w.cityK];
	w.oneSellerDays = w.oneSellerDays ?? new Float64Array(G);
	const sellersOfGood = (g) => w.coops.filter((c) => c.alive && c.good === g && c.plants.some((p) => p.cap - p.worn > 1e-9 || p.plots.length));
	if (city.idle && city.idle.length) {
		const byGood = new Map();
		for (const pl of city.idle) byGood.set(pl.good ?? pl.def.good, [...(byGood.get(pl.good ?? pl.def.good) ?? []), pl]);
		city.idle = [];
		for (const [g, plants] of byGood) {
			const standing = plants.some((pl) => pl.cap - pl.worn > 1e-9 || pl.plots.length);
			const sellers = sellersOfGood(g);
			let capIdle = 0;
			for (const pl of plants) capIdle += plantCapDay(w, pl, w.day);
			// wanted: a basic always; another good when its sellers have been short for two months, or when it has no
			// seller and buyers ask for a real part of what the plants could make
			// (units a COOP stood down in a glut come back only when the good is short again, or a basic is down to one seller)
			const stoodDown = plants.every((pl) => pl.mothballed);
			const shortNow = sellers.length && sellers.every((c) => c.marginEma < 1);
			const askedFor = (w.orderEma?.[g] ?? 0) > 0.05 * capIdle;
			const wanted = stoodDown
				? sellers.length
					? shortNow || (BASICS.includes(g) && (sellers.length < 2 || (w.peopleShortEma?.[g] ?? 0) > 0))
					: BASICS.includes(g) || askedFor
				: BASICS.includes(g) || (sellers.length ? (w.shortDaysGood[g] ?? 0) >= 60 : askedFor);
			if (!wanted || !standing) {
				city.idle.push(...plants);
				continue;
			}
			const enough = sellers.length >= (BASICS.includes(g) ? 2 : 1);
			// (a COOP founded on these plants failed within a year: none is founded on them again before refoundAt; the
			// good's strongest seller leases them instead, unless it has no seller at all)
			const wait = w.day < (w.refoundAt[g] ?? -Infinity) && sellers.length > 0;
			let to = enough || wait ? null : openCoop(w, g, nameBase(g, plants[0].tech), plants, w.pbar[g]);
			if (to) (to.onPlants = true), w.events.push({ day: w.day, kind: 'found', coop: to.id, good: g, from: 'idle plants' });
			else if (sellers.length) {
				to = sellers.sort((a, b) => capDayOf(w, b, w.day) - capDayOf(w, a, w.day))[0];
				for (const pl of plants) {
					// units it stood down come back into its own plant of the same technology
					const own = pl.mothballed && to.plants.find((q) => q.tech === pl.tech && !q.plots.length);
					if (own) {
						own.bookR = ((own.bookR ?? pl.bookR ?? 0) * own.cap + (pl.bookR ?? own.bookR ?? 0) * pl.cap) / Math.max(1e-12, own.cap + pl.cap);
						for (const key of ['cap', 'worn', 'landM2', 'domeKwp', 'fieldKwp', 'batt', 'battCap', 'battCap0']) own[key] += pl[key];
					} else to.plants.push(pl);
				}
				to.mothballFrom = w.day + 180;
				w.events.push({ day: w.day, kind: 'lease', coop: to.id, good: g, from: 'idle plants' });
			} else {
				city.idle.push(...plants);
				continue;
			}
			to.stock += w.cityStore[g];
			w.cityStore[g] = 0;
			for (const pl of plants) (pl.rentGrace = w.day + 180), (pl.mothballed = false);
		}
	}
	for (let g = 0; g < G; g++) {
		const sellers = w.coops.filter((c) => c.alive && c.good === g);
		const live = sellersOfGood(g);
		w.oneSellerDays[g] = BASICS.includes(g) && live.length < 2 ? w.oneSellerDays[g] + 30 : 0;
	}
	if (w.day < 180) return;
	for (let g = 0; g < G; g++) {
		if (g === SPRING) continue; // its warm ponds are fixed by nature: no founder can make another
		const sellers = w.coops.filter((c) => c.alive && c.good === g);
		if (!sellers.length) continue;
		const short = sellers.every((c) => c.marginEma < 0.9);
		const dear = sellers.every((c) => c.priceR > 1.5 * c.fullR && c.fullR > 0);
		w.shortDaysGood[g] = short || dear ? w.shortDaysGood[g] + 30 : 0;
		const alone = BASICS.includes(g) && w.oneSellerDays[g] >= 90;
		if ((w.shortDaysGood[g] < 60 && !alone) || w.day - w.lastEntry[g] < 365) continue;
		// an earlier founding of the good is still building its first plant
		if (sellers.some((c) => c.plants.every((p) => p.cap <= 0 && !p.plots.length))) continue;
		// the City COOP's idle plants of the good come first (the idle pass above leaves them only when no slot is free)
		const idle = (city.idle ?? []).filter((pl) => pl.def.good === g && (pl.cap - pl.worn > 1e-9 || pl.plots.length));
		if (idle.length) continue;
		// a technology a founder can start: not a food forest (ten years to bear), a geothermal stage (a village's plant),
		// a warm pond (nature) or the wells (the aquifer is the City COOP's)
		const techs = [...new Set(sellers.flatMap((c) => c.plants.map((p) => p.tech)))].filter((t) => !NO_FOUNDING.includes(t));
		if (!techs.length) continue;
		const tech = techs[Math.floor(rnd(w) * techs.length)];
		// a physical limit that stops the incumbents' builds stops a founder too, and so does a plant that would not pay
		// back at today's prices (the founder's first plant would face the same prices: it would never be built)
		if (sellers.length && sellers.every((c) => PHYSICAL_BUILD_LIMITS.includes(c.buildLimit) || c.buildLimit === LIMIT.demand || c.buildLimit === LIMIT.importDear)) continue;
		const model = sellers.find((c) => c.plants.some((p) => p.tech === tech));
		const mpl = model.plants.find((p) => p.tech === tech);
		if (inputShort(w, mpl) >= 0) continue; // a new works would wait for the same short input
		if (freeLand(w) < firstPlotM2(w, tech)) continue; // nor can it start without a plot
		const co = openCoop(w, g, nameBase(g, tech), [newPlant(w, tech, 0)], model.priceR);
		if (!co) continue;
		w.lastEntry[g] = w.day;
		w.events.push({ day: w.day, kind: 'found', coop: co.id, good: g, why: alone ? 'a single seller for 90 days' : short ? 'short for two months' : 'dear for two months' });
	}
}
/** days no COOP is founded on plants whose last COOP, itself founded on them, failed within a year */
const REFOUND_WAIT = 365;
/** technologies no founder can start on its own */
const NO_FOUNDING = ['forest', 'geo', 'spring', 'well'];
/** build limits that are physics (or the closed border), not a choice */
const PHYSICAL_BUILD_LIMITS = [LIMIT.land, LIMIT.ore, LIMIT.sand, LIMIT.chips, LIMIT.energy, LIMIT.nature, LIMIT.water, LIMIT.inference, LIMIT.dcSpace];
/** the land a first plant of a technology needs (a timber COOP also needs land for its logs) */
export function firstPlotM2(w, tech) {
	const d = w.tech[tech], s = w.c.scale;
	if (tech === 'timber') return 5000 * s + 20 * s * d.land;
	if (tech === 'goods') return 25 * s * d.land;
	if (tech === 'solar') return 50 * s * d.land;
	if (tech === 'home') return 8 * s * d.land;
	if (tech === 'greenhouse') return 500 * s;
	return 20 * s * (d.land ?? 0);
}
/** a new COOP is named by its good (FOOD-C, WATER-C, ENERGY-C …), never after the City COOP */
const GOOD_NAME = ['FOOD', 'WATER', 'ENERGY', 'HOME', 'TIMBER', 'STEEL', 'GLASS', 'PANEL', 'GOODS', 'SPRING', 'AI'];
function nameBase(g) {
	return GOOD_NAME[g];
}

/** is a failing COOP's good still wanted: its other sellers are short, or it has none and buyers still ask for it */
function stillWanted(w, co) {
	const others = w.coops.filter((c) => c.alive && c !== co && c.good === co.good);
	if (others.length) return others.every((c) => c.marginEma < 1);
	return co.demandEma > 0.2 * Math.max(1e-12, co.capDay);
}

/**
 * Receivership, checked every day: a COOP fails when on 30 days in a row it could not pay its running items, its bills
 * or the energy and materials it needed (on such a day it made and delivered only what it paid for), or has had neither sales nor
 * HEARTS for 60 days, or (setting auditExit) has failed its audit (for 30 days its output stayed under a quarter of
 * what its plants are rated for), or never built its first plant within a year. A trustee freezes its treasury (it
 * melts away; its MIND stays with its holders, who can still swap it) and hands its plants and stores to the City
 * COOP, which leases them on: to the strongest healthy COOP of the same good with 180 days' grace on rent; to a new
 * COOP founded on them at once when that heir would be a basic's only seller, or when there is no heir and the good
 * is still wanted; otherwise the City COOP keeps them idle until the good is wanted (./coops.js foundings).
 */
export function receiverships(w) {
	for (const co of [...w.coops]) {
		if (!co.alive || co.city) continue;
		// on the ramp, a COOP is not judged before it is founded, nor in its first 90 days
		if (w.ramp && !(w.day >= (co.foundDay ?? 0) + 90)) continue;
		const founding = co.plants.every((p) => p.cap <= 0 && !p.plots.length);
		// (on the ramp a genesis COOP's plants come from the build-out plan, not from its own first build)
		const stillborn = founding && !co.project && w.day - co.born >= 365 && !(w.ramp && co.foundDay != null && !(w.ramp.over && w.day >= w.ramp.overDay + 365));
		// a failed audit (world model 4.5): its output has stayed under a quarter of what its plants are rated for
		const audit = !!w.cfg.auditExit && (co.auditLow ?? 0) >= 30;
		const fail = co.lowDays >= 30 || co.idleDays >= 60 || stillborn || audit;
		if (!fail) continue;
		const heir = w.coops.filter((c) => c.alive && c !== co && c.good === co.good && c.lowDays < 7 && !c.billFail && c.plants.some((p) => p.cap - p.worn > 1e-9 || p.plots.length)).sort((a, b) => capDayOf(w, b, w.day) - capDayOf(w, a, w.day))[0];
		const othersSelling = w.coops.filter((c) => c.alive && c !== co && c.good === co.good && c.plants.some((p) => p.cap - p.worn > 1e-9 || p.plots.length)).length;
		co.alive = false;
		co.died = w.day;
		// a founding that never built, or a young entrant that failed: the next founder of this good waits (what stopped
		// it, land, a short input, costs it cannot cover, rarely clears in a year)
		co.why = stillborn ? 'never built its first plant' : co.lowDays >= 30 ? 'could not pay its running items, bills or inputs for 30 days' : audit ? 'failed audit: output under a quarter of its rated plants for 30 days' : 'no sales and no HEARTS for 60 days';
		co.diag = { treR: treasuryR(w, co.k), own: co.own, liquid: w.liquid[co.k], ownR: w.tre[co.k * M + co.k] * w.P[co.k], unpaidH: co.unpaidH, unpaidBillR: co.unpaidBillR, lowDays: co.lowDays, idle: co.idleDays, costREma: co.costREma, salesREma: co.salesREma, priceR: co.priceR, fullR: co.fullR, margin: co.marginEma, goodMargin: w.goodMargin?.[co.good], heartsEma: co.heartsEma, P: w.P[co.k], soldEma: co.soldEma, capDay: co.capDay };
		for (let i = 0; i < w.N; i++) w.alloc[i * M + co.k] = 0;
		let to = heir;
		const standing = co.plants.some((p) => p.cap - p.worn > 1e-9 || p.plots.length);
		// a basic keeps two sellers: when the heir would be its only one, a new COOP is founded on the plants instead
		// (while a MIND slot is free)
		// (not when a young entrant of the good just failed: its plants then go to the heir, see lastEntry below)
		const keepTwo = BASICS.includes(co.good) && othersSelling < 2 && standing && !stillborn && w.day - (w.lastEntry[co.good] ?? -Infinity) >= 365;
		if (stillborn || (co.born > 0 && w.day - co.born < 3 * 365)) w.lastEntry[co.good] = Math.max(w.lastEntry[co.good] ?? -Infinity, w.day + 4 * 365);
		// a COOP founded on a failed COOP's plants that fails within a year shows the plants cannot pay on those terms:
		// no third COOP is founded on them at once (each new one starts with an empty treasury and failed 30 days later,
		// until every MIND slot was used). They go to the healthy heir, which can stand them down, or the City COOP keeps
		// them idle, and no COOP is founded on them for REFOUND_WAIT days (./coops.js foundings)
		const again = co.onPlants && w.day - co.born < 365;
		if (again) w.refoundAt[co.good] = Math.max(w.refoundAt[co.good] ?? -Infinity, w.day + REFOUND_WAIT);
		if ((keepTwo || !heir) && !again && !stillborn && standing && (BASICS.includes(co.good) || stillWanted(w, co))) {
			to = openCoop(w, co.good, nameBase(co.good), [], co.priceR) ?? heir;
			if (to && to !== heir) to.onPlants = true;
		}
		if (to) {
			for (const pl of co.plants) {
				pl.rentGrace = w.day + 180;
				to.plants.push(pl);
			}
			to.stock += co.stock;
			for (let g = 0; g < G; g++) {
				// the heir's input store keeps the average price of both stores
				const a = Math.max(0, to.inStock[g]), b = Math.max(0, co.inStock[g]);
				if (a + b > 0 && (to.inCostR || co.inCostR)) {
					to.inCostR = to.inCostR ?? Float64Array.from(w.pbar);
					to.inCostR[g] = (to.inCostR[g] * a + (co.inCostR?.[g] ?? w.pbar[g]) * b) / (a + b);
				}
				to.inStock[g] += co.inStock[g];
			}
			to.chips = (to.chips ?? 0) + (co.chips ?? 0);
			// its account in the euro reserve goes to the heir
			if (w.border) (w.border.eur[to.k] += w.border.eur[co.k]), (w.border.eur[co.k] = 0);
			if (to !== heir) w.events.push({ day: w.day, kind: 'found', coop: to.id, good: co.good, from: 'receivership of ' + co.id });
		} else {
			// no heir, and the good is not wanted (or no MIND slot is free): the City COOP keeps the plants idle, and holds
			// the stores, until ./coops.js foundings leases them on
			w.coops[w.cityK].idle = (w.coops[w.cityK].idle ?? []).concat(co.plants);
			w.cityStore[co.good] += co.stock;
			for (let g = 0; g < G; g++) w.cityStore[g] += co.inStock[g];
			w.cityChips = (w.cityChips ?? 0) + (co.chips ?? 0);
			// and its account at the bank (its domes' accelerators stay on the halls the City COOP holds)
			if (w.border) (w.border.eur[w.cityK] += w.border.eur[co.k]), (w.border.eur[co.k] = 0);
		}
		// a reference MIND of R hands its place to the COOP that took its plants
		const ri = w.refMinds.indexOf(co.k);
		if (ri >= 0) {
			const alt = to ?? w.coops.filter((c) => c.alive && c.good === co.good).sort((a, b) => capDayOf(w, b, w.day) - capDayOf(w, a, w.day))[0];
			if (alt) w.refMinds[ri] = alt.k;
			w.refMinds = [...new Set(w.refMinds)];
		}
		co.plants = [];
		co.stock = 0;
		co.chips = 0;
		co.inStock = new Float64Array(G);
		co.project = null;
		// the work proposals it posted and had not paid lapse with its frozen treasury
		co.propBacklogR = 0;
		w.events.push({ day: w.day, kind: 'receivership', coop: co.id, heir: to?.id ?? null, why: co.why, diag: co.diag });
	}
}
