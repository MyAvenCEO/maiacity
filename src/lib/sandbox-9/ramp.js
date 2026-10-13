// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE RAMP — the village is built from day 0, settlement by settlement, by the build-out plan
 * (src/lib/sandbox-7/buildout.js; Samuel, 2026-10-13 06:42). Day 0: two settlers launch the first settlement with the
 * starter kit; people arrive as beds are finished; the villagers build everything themselves (no wages); what the
 * village cannot make is bought at the euro border through the MaiaCity COOP's bank.
 *
 * This module does not schedule anything itself: it reads the build-out plan's months and turns them into the
 * engine's world, a month at a time:
 *   - people: the plan's people that month arrive (each with an Aven and nothing held, as a newcomer);
 *   - plants: every genesis plant is built at its full size (./genesis.js seedPlants) and stands at the share of it the
 *     plan has finished: the beds and the halls by hex, the food domes, the outdoor food forest (planted plot by plot:
 *     it bears by its own age), the dome cells and batteries, the geothermal plant, the works once running, the water
 *     works, data centres and workshops with the utilities domes;
 *   - COOPs: a genesis COOP is founded the month its first plant stands (a settlement COOP when its settlement
 *     launches); the MaiaCity COOP (water from the kit's well), the first food COOP (it buys the camp's food), the
 *     first solar COOP (the kit's solar containers) and the East settlement COOP (the camp) on day 0;
 *   - euros: each month's build-out bill goes through the bank as an advance to the COOP that builds and owns it (the
 *     settlement COOP of its hex, the Village COOP for the centre and the geothermal plant), repaid in its own MIND
 *     (./border.js); the land is the MaiaCity COOP's.
 * Plan month m is the engine's days [m·365/12, (m+1)·365/12). The engine's year starts in January, so the plan is asked
 * for a January launch (startMonth 1). A dome finished in month m stands from month m + 1. During the build-out the
 * plan decides what is built: the COOPs do not build more plants, Law 3 founds no new COOPs and nothing is mothballed
 * until the plan is done (their usual rules apply from then on).
 */
import { buildPlan } from '../sandbox-7/buildout.js';
import { KINDS } from '../sandbox-7/specs.js';
import { FACTORY_RUN } from '../sandbox-7/stats.js';
import { initPerson, firstAlloc, SETTLEMENTS } from './genesis.js';
import { payEur } from './border.js';

export const MONTH_DAYS = 365 / 12;
/** the plan's kinds of euros, as the ledger names them */
export const BUILD_KINDS = { kit: 'buildKit', running: 'buildRunning', materials: 'buildMaterials', machines: 'buildMachines', services: 'buildServices', land: 'land' };

const FOOD_DOME_M2 = KINDS.food120.zones.find((z) => z.use === 'indoorFood').m2;
const UTIL_GARDEN_M2 = KINDS.util120.zones.find((z) => z.use === 'indoorFood').m2;
const FLOOR120 = Math.PI * 60 * 60;

/** the plan the engine runs, for a world's settings (cached by buildPlan) */
export function planOf(cfg) {
	return buildPlan({ tower: !!cfg.tower, targetPeople: cfg.people, startMonth: 1, ladder: false, ...(cfg.buildout ?? {}) });
}

/**
 * The plan's months as the engine reads them: for each month, what stands (from the steps finished by the end of the
 * month before) and the euros spent that month by owner.
 */
export function rampSchedule(cfg) {
	const plan = planOf(cfg);
	const hexes = SETTLEMENTS.map((s) => s.hex);
	const n = plan.months.length;
	const last = plan.months[n - 1];
	const kitKwp = plan.kit.items.filter((k) => k.kwp).reduce((a, k) => a + k.n * k.kwp, 0);
	const kitKwh = plan.kit.items.filter((k) => k.kwh && k.group === 'power').reduce((a, k) => a + k.n * k.kwh, 0);
	const finalSolar = Math.max(1, last.solarKwhYear);
	const finalForest = Math.max(1e-9, last.forestHa);
	const indoorTotal = 2 * 6 * FOOD_DOME_M2 + 6 * UTIL_GARDEN_M2;
	const finalBatt = 6 * 10000 + 40000;
	const worksT = { timber: FACTORY_RUN.timber.t, bamboo: FACTORY_RUN.bamboo.t };
	const months = [];
	// one month more than the plan's: the month after its last, when everything it finished stands
	for (let m = 0; m <= n; m++) {
		const s = m - 1; // what stands in month m: finished by the end of month m − 1
		const done = s < 0 ? [] : plan.steps.filter((x) => x.end != null && x.end <= s);
		const mo = plan.months[Math.max(0, Math.min(n - 1, s))];
		const bedsHex = hexes.map((h) => done.filter((x) => x.hex === h).reduce((a, x) => a + (x.beds ?? 0), 0));
		// the camp's containers stand where the camp is; the two settlers of day 0 sleep in the first of them
		const camp = s < 0 ? 'living-e' : mo.camp;
		const campBeds = s < 0 ? 0 : mo.campBeds;
		if (camp && hexes.includes(camp)) bedsHex[hexes.indexOf(camp)] += campBeds;
		const people = Math.max(plan.months[0].people, s < 0 ? plan.months[0].people : mo.people);
		const bedsAll = bedsHex.reduce((a, b) => a + b, 0);
		if (bedsAll < people) bedsHex[hexes.indexOf(camp ?? 'living-e')] += people - bedsAll;
		const of = (h, kinds) => done.filter((x) => x.hex === h && kinds.includes(x.kind)).length;
		const hallHex = hexes.map((h) => (of(h, ['food120']) + of(h, ['util120'])) * FLOOR120);
		const centreDone = done.filter((x) => x.hex === 'tower' && (x.kind === 'centre' || x.kind === 'tower' || (x.kind === 'factory120' && !['timber', 'bamboo', 'steel', 'glass'].includes(x.factory)))).length;
		const worksDomes = done.filter((x) => x.hex === 'tower' && x.kind === 'factory120' && ['timber', 'bamboo', 'steel', 'glass'].includes(x.factory)).length;
		const utilDone = done.filter((x) => x.kind === 'util120').length;
		const foodDone = done.filter((x) => x.kind === 'food120').length;
		const works = new Set(s < 0 ? [] : mo.works ?? []);
		const domesAll = plan.steps.filter((x) => x.phases?.some((p) => p.id === 'shell')).length;
		const domesDone = done.filter((x) => x.phases?.some((p) => p.id === 'shell')).length;
		months.push({
			m,
			people,
			bedsHex,
			hallHex,
			hallVillageDomes: centreDone + worksDomes,
			centreDone,
			worksDomes,
			indoor: (foodDone * FOOD_DOME_M2 + utilDone * UTIL_GARDEN_M2) / indoorTotal,
			forest: (s < 0 ? 0 : mo.forestHa) / finalForest,
			// the kit's solar containers stand from day 0
			solar: Math.min(1, Math.max(kitKwp * 980, s < 0 ? 0 : mo.solarKwhYear) / finalSolar),
			batt: Math.min(1, (kitKwh + 10000 * utilDone + 40000 * Math.min(1, done.filter((x) => x.kind === 'centre' || x.kind === 'tower').length)) / finalBatt),
			geo: s >= 0 && !!mo.geothermal,
			works,
			timber: ((works.has('timber') ? worksT.timber : 0) + (works.has('bamboo') ? worksT.bamboo : 0)) / (worksT.timber + worksT.bamboo),
			fields: done.some((x) => x.kind === 'fields'),
			util: utilDone / 6,
			domes: domesDone / Math.max(1, domesAll)
		});
	}
	// the euros of each month by owner: each hex's settlement COOP (the Village COOP for the centre), the land to the
	// MaiaCity COOP; split by kind in the month's own shares
	const eur = [];
	const landAt = new Map();
	for (const x of plan.steps) if (x.kind === 'land' && x.start != null) landAt.set(`${x.hex}@${x.start}`, (landAt.get(`${x.hex}@${x.start}`) ?? 0) + (x.eur.land ?? 0));
	for (let m = 0; m < n; m++) {
		const mo = plan.months[m], prev = plan.months[m - 1];
		const byHex = {};
		let land = 0;
		for (const h of [...hexes, 'tower']) {
			let e = (mo.hexCum[h] ?? 0) - (prev?.hexCum[h] ?? 0);
			const l = landAt.get(`${h}@${m}`) ?? 0;
			land += l;
			e -= l;
			if (e > 1e-6) byHex[h] = e;
		}
		const k = { ...mo.eur };
		const nonLand = Object.entries(k).filter(([kk]) => kk !== 'land').reduce((a, [, v]) => a + v, 0);
		const share = Object.fromEntries(Object.entries(k).filter(([kk]) => kk !== 'land').map(([kk, v]) => [kk, nonLand > 0 ? v / nonLand : 0]));
		eur.push({ m, byHex, land, share, total: Object.values(k).reduce((a, b) => a + b, 0) });
	}
	// the month each settlement launches (its COOP is founded)
	const founded = Object.fromEntries(plan.settlements.map((s) => [s.key, s.founded]));
	return { plan, months, eur, founded, doneMonth: n, people: last.people, hexes };
}

/** which schedule share drives a plant (the tech's, or its hex's) */
function shareOf(w, pl, mo) {
	const S = w.ramp;
	switch (pl.tech) {
		case 'home':
			return pl.hex != null ? mo.bedsHex[pl.hex] / Math.max(1e-9, S.bedsHexFull[pl.hex]) : 1;
		case 'hall':
			return pl.hex === 'centre' ? mo.hallVillageDomes / Math.max(1, S.villageDomesFull) : mo.hallHex[pl.hex] / Math.max(1e-9, S.hallHexFull[pl.hex]);
		case 'greenhouse':
			return mo.indoor;
		case 'forest':
			return mo.forest;
		case 'solar':
			return mo.solar;
		case 'geo':
			return mo.geo ? 1 : 0;
		case 'timber':
			return mo.timber;
		case 'steel':
			return mo.works.has('steel') ? 1 : 0;
		case 'glass':
		case 'panel':
			return mo.works.has('glass') ? 1 : 0;
		case 'goods':
		case 'compute':
			return mo.util;
		case 'spring':
			return mo.domes;
		case 'well':
			return Math.max(mo.util, mo.people / Math.max(1, S.people));
		case 'rain':
			return mo.bedsHex.reduce((a, b) => a + b, 0) / Math.max(1, S.bedsFull);
		default:
			return 1;
	}
}

/**
 * Set up the ramp on a new world (./genesis.js createWorld calls it after the plants and COOPs exist): every plant
 * remembers its full size and starts at month 0's share; every COOP its founding day.
 */
export function initRamp(w, S) {
	w.ramp = S;
	S.bedsHexFull = S.hexes.map((_, h) => w.coops.reduce((a, co) => a + co.plants.reduce((b, p) => b + (p.tech === 'home' && p.hex === h ? p.cap : 0), 0), 0));
	S.bedsFull = S.bedsHexFull.reduce((a, b) => a + b, 0);
	S.hallHexFull = S.months[S.months.length - 1].hallHex.map((x, h) => x || 1);
	S.villageDomesFull = S.months[S.months.length - 1].hallVillageDomes || 1;
	S.monthNow = -1;
	S.plants = [];
	for (const co of w.coops)
		for (const pl of co.plants) {
			pl.capFull = pl.cap;
			pl.landFull = pl.landM2;
			pl.hostedFull = pl.hostedCap ?? 0;
			pl.domeKwpFull = pl.domeKwp ?? 0;
			pl.battFull = pl.battCap0 ?? 0;
			pl.plotsFull = pl.plots.map((p) => p.m2);
			pl.rawFull = pl.raw ?? 0;
			pl.applied = 0;
			// nothing stands yet: the month-0 share is applied below
			pl.cap = 0;
			pl.landM2 = 0;
			pl.hostedCap = 0;
			pl.domeKwp = 0;
			pl.battCap = pl.battCap0 = pl.batt = 0;
			pl.plots = [];
			pl.raw = 0;
			S.plants.push(pl);
		}
	for (const h of w.halls ?? []) for (const x of h.hosted) (x.m2Full = x.m2), (x.m2 = 0);
	for (const pl of S.plants) if (pl.hosts) for (const x of pl.hosts) if (x.m2Full == null) (x.m2Full = x.m2), (x.m2 = 0);
	// the founding month of each genesis COOP: the first month one of its plants stands (a settlement COOP: the month its
	// settlement launches); the camp's COOPs on day 0
	const firstFood = w.coops.find((c) => c.plants.some((p) => p.tech === 'forest'));
	for (const co of w.coops) {
		let first = Infinity;
		for (let m = 0; m < S.months.length && first === Infinity; m++) if (co.plants.some((pl) => shareOf(w, pl, S.months[m]) > 0)) first = m;
		const day0 = co.city || co === firstFood || co.plants.some((p) => p.tech === 'rain') || (co.plants.some((p) => p.tech === 'solar') && S.months[0].solar > 0);
		const hex = co.plants.find((p) => p.tech === 'home')?.hex;
		const launch = hex != null ? S.founded[S.hexes[hex]] : co.plants.some((p) => p.village) ? S.founded.tower : null;
		const m = day0 ? 0 : Math.min(first, launch ?? Infinity);
		co.foundDay = Number.isFinite(m) ? Math.round(m * MONTH_DAYS) : Infinity;
	}
	applyMonth(w, 0);
	// month 0's euros are paid on day 0 (./ramp.js rampDay)
	S.monthNow = -1;
}

/** each day: on the first day of a plan month, what the plan finished stands; the month's people arrive */
export function rampDay(w) {
	const S = w.ramp;
	if (!S || S.over) return;
	const m = Math.floor(w.day / MONTH_DAYS);
	if (m !== S.monthNow) {
		if (m >= S.months.length - 1) {
			applyMonth(w, S.months.length - 1);
			S.over = true;
			S.overDay = w.day;
			w.events.push({ day: w.day, kind: 'buildout', what: 'the plan is done: every dome stands' });
			return;
		}
		applyMonth(w, m);
		buildoutEuros(w, m);
	}
	// the month's newcomers, a few each day through the month
	const mo = S.months[Math.min(m, S.months.length - 1)];
	const prev = S.months[Math.max(0, m - 1)];
	const into = Math.min(1, (w.day - m * MONTH_DAYS + 1) / MONTH_DAYS);
	const target = Math.min(w.Nmax, Math.round(prev.people + (mo.people - prev.people) * into));
	while (w.N < target) arrive(w);
	// a COOP founded today starts with clean counters
	for (const co of w.coops) if (co.alive && co.foundDay === w.day) (co.lowDays = 0), (co.idleDays = 0), (co.auditLow = 0), w.events.push({ day: w.day, kind: 'found', coop: co.id, from: 'the build-out' });
}

/** a newcomer: an Aven and nothing held; every twentieth (the owner-only share) has an Aven that delivers nothing */
function arrive(w) {
	const i = w.N++;
	initPerson(w, i, w.day);
	const share = w.cfg.ownerOnlyShare ?? 0;
	if (share > 0 && Math.floor((i + 1) * share) > Math.floor(i * share)) {
		w.owner[i] = 1;
		w.aven[i] = 0;
		w.ownerIds.push(i);
	}
	firstAlloc(w, i);
	w.decH[i] = 0;
	w.decA[i] = 0;
	w.arrived = (w.arrived ?? 0) + 1;
}

/** what the plan has finished by month m stands */
function applyMonth(w, m) {
	const S = w.ramp, mo = S.months[m];
	S.monthNow = m;
	for (const pl of S.plants) {
		const sh = Math.max(0, Math.min(1, shareOf(w, pl, mo)));
		const d = sh - pl.applied;
		if (Math.abs(d) < 1e-12) continue;
		const dCap = pl.capFull * d;
		if (pl.tech === 'greenhouse' && dCap > 0) {
			// the domes are planted as they are finished: the plant's age is the average of its parts'
			const old = Math.max(0, pl.cap);
			pl.born = old > 0 ? (pl.born * old + w.day * dCap) / (old + dCap) : w.day;
		}
		if ((pl.tech === 'forest' || pl.tech === 'timber') && pl.plotsFull.length) {
			// the forest and the woods are planted plot by plot, each bearing by its own age
			const plantShare = pl.tech === 'forest' ? sh : mo.fields ? 1 : 0;
			const dp = plantShare - (pl.plotShare ?? 0);
			if (dp > 0) {
				const m2 = pl.plotsFull.reduce((a, x) => a + x, 0) * dp;
				pl.plots.push({ m2, born: w.day, yc: 1 });
				pl.plotShare = plantShare;
				if (pl.tech === 'timber') pl.landM2 += m2;
			}
		}
		pl.cap += dCap;
		if (pl.tech === 'forest') pl.landM2 += pl.landFull * d;
		else if (pl.tech !== 'timber') pl.landM2 += pl.landFull * d;
		else pl.landM2 += (pl.landFull - pl.plotsFull.reduce((a, x) => a + x, 0)) * d;
		pl.hostedCap = (pl.hostedCap ?? 0) + pl.hostedFull * d;
		if (pl.tech === 'solar') {
			pl.domeKwp += pl.domeKwpFull * d;
		}
		pl.applied = sh;
	}
	// batteries with the utilities domes
	for (const pl of S.plants)
		if (pl.tech === 'solar' && pl.battFull > 0) {
			const want = pl.battFull * mo.batt;
			if (want > pl.battCap0) {
				const add = want - pl.battCap0;
				pl.battCap0 += add;
				pl.battCap += add;
			}
		}
	// the m² a tenant rents grows with the halls that stand
	for (const h of w.halls ?? []) {
		const f = h.capFull > 0 ? Math.max(0, h.cap) / h.capFull : 0;
		for (const x of h.hosted) x.m2 = x.m2Full * f;
	}
	w.buildCache = {};
}

/** the month's build-out bill, through the bank: an advance to each owner, the land the MaiaCity COOP's */
function buildoutEuros(w, m) {
	const S = w.ramp, E = S.eur[m], t = w.today;
	if (!E || !w.border) return;
	t.imp = t.imp ?? {};
	t.impEur = t.impEur ?? {};
	const add = (kind, eur) => {
		t.impEur[kind] = (t.impEur[kind] ?? 0) + eur;
		t.buildEur = (t.buildEur ?? 0) + eur;
	};
	for (const [hex, eur] of Object.entries(E.byHex)) {
		const co = ownerOf(w, hex);
		if (!co) continue;
		const paid = payEur(w, co, eur);
		co.buildEur = (co.buildEur ?? 0) + paid;
		for (const [k, f] of Object.entries(E.share)) add(BUILD_KINDS[k], paid * f);
	}
	if (E.land > 0) {
		const city = w.coops[w.cityK];
		const paid = payEur(w, city, E.land);
		city.buildEur = (city.buildEur ?? 0) + paid;
		add('land', paid);
	}
}

/** the COOP that builds and owns a hex's buildings: its settlement COOP, the Village COOP for the centre */
function ownerOf(w, hex) {
	const S = w.ramp;
	if (hex === 'tower') return w.coops.find((c) => c.alive && c.plants.some((p) => p.tech === 'hall' && p.hex === 'centre')) ?? w.coops.find((c) => c.alive && c.plants.some((p) => p.village)) ?? w.coops[w.cityK];
	const h = S.hexes.indexOf(hex);
	return w.coops.find((c) => c.alive && c.plants.some((p) => p.tech === 'home' && p.hex === h)) ?? w.coops.find((c) => c.alive && c.plants.some((p) => p.tech === 'home')) ?? w.coops[w.cityK];
}

/** is the build-out still under way (the plan decides what is built) */
export const rampOn = (w) => !!w.ramp && !w.ramp.over;
/** is a COOP still waiting for its founding (its settlement not launched, its first plant not standing) */
export const notFounded = (w, co) => !!w.ramp && !(w.day >= (co.foundDay ?? 0));
