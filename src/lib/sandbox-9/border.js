// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE EURO BORDER — what the village cannot make, its COOPs buy outside (paper §11.4, §12.4), as COOPs only,
 * through the MaiaCity COOP's bank.
 *
 * The MaiaCity COOP (the City COOP) is the bank at the border: every euro in or out goes through it. It holds the
 * founding euros, which come from outside (`w.border.shared`: the bank's own euros), and each COOP's deposit
 * (`w.border.eur[k]`). A COOP that buys at the border pays from its deposit first; beyond it the bank advances the
 * euros from its own (`co.advEur` records what the COOP owes). A COOP pays an advance back in its own MIND, moved from
 * its treasury to the City COOP's (./border.js repayAdvances), at the euro's price in electricity: the R value at
 * today's energy price of the kWh the village would export to earn that euro. The City COOP then holds that MIND as an
 * owner and gets its Law 5 dividends. No interest; no MIND is made from euros; no person changes MIND into euros.
 *
 * A COOP fills its deposit by exporting electricity: it buys the kWh from the energy COOPs in MIND (a real sale, with
 * Law 5), the line sells it at the wholesale price, and the euros go into the bank as its deposit.
 *
 * The founding euros: with `foundingEur` null (the default) the bank draws on its founders outside as far as the
 * village needs, and the most it ever needs at once (the lowest cumulative balance, `w.border.low`) is the bootstrap
 * number; with a number (or `reserveYears`), that is all it has, and a COOP that finds no euros buys less.
 *
 * Who buys what: the food COOPs buy food (in the diet's mix, at wholesale) when their stores and harvests ahead fall
 * short of what their buyers will eat; the works buy their raw inputs (logs beyond the village's woods, steel scrap
 * beyond the village's own worn steel, float glass, solar cells); the hardware owners (the settlement COOPs and the
 * Village COOP) buy accelerators for their data halls (./ai.js aiEvening). What is bought arrives the same day. A COOP that finds no euros buys less: its buyers go short.
 */
import { CLASS, ENERGY, FOOD, MAX_COOPS, WOOD, STEEL, GLASS, PANEL } from './consts.js';
import { rawOf, plantCapDay, capDayOf } from './genesis.js';
import { supplyAhead, logsGrowth, foodIn, unitEurOf, TOP_UP } from './coops.js';
import { peopleAhead } from './ramp.js';

const M = MAX_COOPS;
/** the import kinds of the ledger, in order */
export const IMPORT_KINDS = ['food', 'logs', 'scrap', 'float', 'cells', 'lamellas', 'plate', 'glulam', 'steel', 'glazing', 'panels', 'chips', 'grid', 'buildKit', 'buildRunning', 'buildMaterials', 'buildMachines', 'buildServices', 'land'];
/** the finished goods a works COOP buys when its works cannot keep up (by good index: glulam, steel, glass, panels) */
const FINISHED = { [WOOD]: 'glulam', [STEEL]: 'steel', [GLASS]: 'glazing', [PANEL]: 'panels' };

/** a fresh border: the bank's founding euros (Infinity: drawn from its founders as needed), an empty deposit for each
 * COOP */
export function newBorder(w, sharedEur) {
	const open = !Number.isFinite(sharedEur);
	const s0 = open ? 0 : sharedEur;
	return { eur: new Float64Array(M), open, shared: s0, shared0: s0, prev: s0, inEur: 0, outEur: 0, drawShared: 0, low: 0, lowDay: 0, advanced: 0, repaidEur: 0, repaidR: 0 };
}

/**
 * € a kWh the line earns today: the share of today's electricity the sun made at the month's market value of solar
 * power, the rest (geothermal, the battery) at the German day-ahead average (./primitives.js CHIPS); the setting
 * exportEurMwh gives one flat price. (Optimistic for the sun's part: the line sells what the village does not use,
 * most of it at noon.)
 */
export function exportEurKwh(w) {
	const t = w.today, c = w.c;
	if (t.eurPerKwh != null) return t.eurPerKwh;
	if (c.exportFlat || !c.solarEurKwh) return (t.eurPerKwh = c.eurPerKwh);
	const h = t.harvest ?? {}, sun = Math.max(0, h.solar ?? 0), base = Math.max(0, (h.geo ?? 0) + (h.battery ?? 0));
	const sh = sun + base > 0 ? sun / (sun + base) : 0;
	return (t.eurPerKwh = sh * c.solarEurKwh[t.month ?? 0] + (1 - sh) * c.spotEurKwh);
}

/** euros in the reserve: the founding euros left and every COOP's account */
export function reserveEur(w) {
	const B = w.border;
	let s = B.shared;
	for (let k = 0; k < M; k++) s += B.eur[k];
	return s;
}

/** pay `eur` for a COOP's import: its own deposit first, then an advance from the bank's own euros (the COOP owes it,
 * to be paid back in its MIND); returns what was paid */
export function payEur(w, co, eur) {
	const B = w.border, t = w.today;
	if (!(eur > 0)) return 0;
	const own = Math.min(B.eur[co.k], eur);
	B.eur[co.k] -= own;
	const shared = B.open ? eur - own : Math.min(Math.max(0, B.shared), eur - own);
	B.shared -= shared;
	B.drawShared += shared;
	if (shared > 0 && !co.city) (co.advEur = (co.advEur ?? 0) + shared), (B.advanced += shared), (t.advEur = (t.advEur ?? 0) + shared);
	const paid = own + shared;
	t.eurOut = (t.eurOut ?? 0) + paid;
	co.eurToday = (co.eurToday ?? 0) + paid;
	return paid;
}

/** what a euro of imports costs a COOP in R: the electricity it exports for it, at today's energy price */
export const eurR = (w, eur) => (eur / w.c.eurPerKwh) * w.pbar[ENERGY];

/**
 * Today's imports, after nature and before the COOPs price: each food COOP buys food when its store and its harvest
 * over the next month fall short of what its buyers will eat in that month and two weeks more; each works buys the raw
 * input its works will use over the same span, less what its own land grows.
 */
export function importsDay(w) {
	const t = w.today, H = w.c.importAhead, E = w.c.eur;
	// (the ramp's build-out euros of the day may already be in, ./ramp.js)
	t.imp = { ...Object.fromEntries(IMPORT_KINDS.map((k) => [k, 0])), ...(t.imp ?? {}) };
	t.impEur = { ...Object.fromEntries(IMPORT_KINDS.map((k) => [k, 0])), ...(t.impEur ?? {}) };
	t.impShort = 0;
	// (round 4) the border fills what the village cannot grow: each food COOP's gap (its buyers' need over the weeks
	// ahead, less its store and harvest ahead) counts only as far as the village's own food falls short, all its
	// growers' stores and harvests ahead together. A COOP with a small dome and many buyers used to buy its buyers'
	// whole need abroad while the village's growers held months of food in store; the imported food undercut them in
	// winter, they could not pay their domes' heat, and one failed after the other (round 3: years 7 and 15)
	const foodGap = new Map();
	let gapAll = 0, gapVillage = 0;
	for (const co of w.coops) {
		if (!co.alive || co.good !== FOOD) continue;
		const ahead = supplyAhead(w, co, H);
		// on the ramp, the people the build-out plan brings over the weeks ahead will eat too (./ramp.js)
		const need = Math.max(co.demandEma, 0) * (w.ramp && !w.ramp.over ? Math.max(1, peopleAhead(w, H + 15) / Math.max(1, w.N)) : 1);
		const gap = need * (H + 15) - co.stock - ahead[ahead.length - 1];
		foodGap.set(co, gap);
		gapVillage += gap;
		if (gap > 0) gapAll += gap;
	}
	const foodScale = gapAll > 0 ? Math.max(0, Math.min(1, gapVillage / gapAll)) : 0;
	for (const co of w.coops) {
		co.eurToday = 0;
		co.importToday = 0;
		if (!co.alive) continue;
		if (co.good === FOOD) {
			const gap = (foodGap.get(co) ?? 0) * foodScale;
			if (gap > 1e-9) {
				const want = gap / 5;
				const paid = payEur(w, co, want * E.food);
				const u = paid / E.food;
				if (u < want * (1 - 1e-9)) t.impShort += want - u;
				if (u > 0) {
					foodIn(co, u, w.c.protImp);
					t.imported[FOOD] += u;
					t.imp.food += u;
					t.impEur.food += paid;
					co.importToday = u;
				}
			}
			co.importEma = (co.importEma ?? 0) + ((co.importToday ?? 0) - (co.importEma ?? 0)) / 30;
		} else {
			// first the raw inputs its works will use (cheaper than the finished good), then the finished good for what
			// its works still cannot make
			const cap = capDayOf(w, co, w.day);
			// a timber COOP with its half of the dome factory's struts line runs its timber works first: the works buy
			// logs for their share of what its buyers ask, the line its lamellas for the rest (./coops.js plan)
			let capBase = 0, hasTop = false;
			for (const pl of co.plants) if (TOP_UP.has(pl.tech)) hasTop = true;
			else if (rawOf(pl)) capBase += Math.max(0, plantCapDay(w, pl, w.day));
			const need = Math.max(co.demandEma ?? 0, co.madeEma ?? 0);
			for (const pl of co.plants) {
				const ro = rawOf(pl);
				if (!ro) continue;
				const [kind, a] = ro;
				// what its works will use a day: what its buyers ask, at least what it made lately, by this plant's share
				const capPl = Math.max(0, plantCapDay(w, pl, w.day));
				const top = hasTop && TOP_UP.has(pl.tech);
				const share = hasTop && !top ? (capBase > 0 ? capPl / capBase : 1) : cap > 0 ? capPl / cap : 1;
				const useDay = (top ? Math.min(capPl, Math.max(0, need - (co.baseOutEma ?? 0))) : Math.min(capPl, need * Math.min(1, share))) * a;
				const local = kind === 'logs' ? logsGrowth(w, pl, w.day) : 0;
				pl.rawTarget = useDay * (H + 15);
				const gap = pl.rawTarget - pl.raw - local * H;
				pl.rawImpToday = 0;
				if (gap > 1e-9) {
					const want = gap / 5;
					const paid = payEur(w, co, want * E[kind]);
					const u = paid / E[kind];
					if (u > 0) {
						pl.raw += u;
						t.raw.imported[kind] = (t.raw.imported[kind] ?? 0) + u;
						t.imp[kind] += u;
						t.impEur[kind] += paid;
						pl.rawImpToday = u;
					}
				}
				// the share of its raw input it bought (a 90-day average): the price of what it makes carries it
				const used = Math.max(1e-12, (pl.rawImpToday ?? 0) + local);
				pl.rawImpShare = (pl.rawImpShare ?? 1) + ((pl.rawImpToday ?? 0) / used - (pl.rawImpShare ?? 1)) / 90;
			}
			// the works' finished good, when its works cannot make what its buyers ask over the month ahead (glulam,
			// steel, glazing, panels)
			const fin = FINISHED[co.good];
			if (fin && w.cfg.border !== false) {
				const ahead = supplyAhead(w, co, H);
				let gap = Math.max(0, co.demandEma) * (H + 10) - co.stock - ahead[ahead.length - 1];
				// (round 5) the village's own works first: what the good's other sellers can make over the month ahead and
				// hold beyond what their own buyers ask covers this COOP's buyers when it runs out (./engine.js
				// clearMaterials passes their orders on to the sellers with stock), so it buys the finished good abroad only
				// for what the village's works together cannot make. A steel COOP that had stood its half of the hub line
				// down, and leased it to the other, bought hubs at twice the line's cost for its tenth of the buyers while
				// the line stood three-quarters idle
				if (gap > 1e-9) gap -= spareOf(w, co, H);
				if (gap > 1e-9) {
					const want = gap / 5;
					const paid = payEur(w, co, want * E[fin]);
					const u = paid / E[fin];
					if (u > 0) {
						co.stock += u;
						t.imported[co.good] += u;
						t.imp[fin] = (t.imp[fin] ?? 0) + u;
						t.impEur[fin] = (t.impEur[fin] ?? 0) + paid;
						co.importToday = u;
					}
				}
				co.importEma = (co.importEma ?? 0) + ((co.importToday ?? 0) - (co.importEma ?? 0)) / 30;
			}
		}
	}
}

/** what the other village sellers of a COOP's good can make over the next H days and hold, beyond their own buyers' ask */
function spareOf(w, co, H) {
	let spare = 0;
	for (const o of w.sellers[co.good] ?? []) {
		if (o === co || !o.alive) continue;
		const a = supplyAhead(w, o, H);
		spare += Math.max(0, a[a.length - 1] + Math.max(0, o.stock) - Math.max(0, o.demandEma ?? 0) * (H + 10));
	}
	return spare;
}

/**
 * The export a COOP that buys at the border plans today (in ./coops.js plan): enough to keep its own account at
 * accountDays of what it has spent lately, or at what it will have to buy at the border before its own plants catch
 * up (its deficit ahead: a food COOP saves in the autumn for the spring), whichever is more, spread over two months
 * (the line's room is shared out by shareLine). Upkeep's class (served with the running class, before any building): food and the works' inputs
 * are what the village lives on. The hardware owners' accelerators are advanced by the bank (./ai.js aiEvening).
 */
export function exportPlan(w, co) {
	const B = w.border;
	co.eurSpentEma = (co.eurSpentEma ?? 0) + ((co.eurToday ?? 0) - (co.eurSpentEma ?? 0)) / 30;
	const target = Math.max(w.c.accountDays * co.eurSpentEma, (co.deficitAhead ?? 0) * unitEurOf(w, co));
	const needEur = Math.max(0, target - B.eur[co.k]);
	if (!(needEur > 0)) return;
	// spread over two months; the line's room is shared out among all the COOPs that export today in proportion to
	// what they ask (./engine.js shareLine), so no seller takes the whole line first
	const kwh = Math.min(needEur / w.c.eurPerKwh / 60, w.c.lineKwhDay);
	co.exportUp += kwh;
	w.exportToday = (w.exportToday ?? 0) + kwh;
}

/**
 * The MaiaCity COOP's own export (in ./coops.js plan): the bank sells electricity at the border, bought from the
 * energy COOPs with its treasury (it holds the COOPs' MIND they paid their advances back with, and its ground rent),
 * for what it advanced lately (a 60-day average, in the running class with the village's upkeep) and to pay its
 * founders back the euros the village drew from them over bankPaybackYears (after the city's building class, before
 * R&D). Its euros go into the bank's own.
 */
export function bankExport(w, co) {
	const B = w.border, t = w.today;
	if (!B) return;
	B.advEma = (B.advEma ?? 0) + ((t.advEur ?? 0) - (B.advEma ?? 0)) / 60;
	const cum = reserveEur(w) - B.shared0;
	const payback = Math.max(0, -cum) / (Math.max(1, w.c.bankPaybackYears) * 365);
	const up = Math.min(B.advEma / w.c.eurPerKwh, w.c.lineKwhDay);
	co.exportUp += up;
	co.exportBuild += Math.min(payback / w.c.eurPerKwh, Math.max(0, w.c.lineKwhDay - up));
	w.exportToday = (w.exportToday ?? 0) + co.exportUp + co.exportBuild;
}

/**
 * The line's room shared out (./engine.js, before the dispatch): when the COOPs together ask the line for more than it
 * carries, every upkeep export (food, the works' inputs, worn accelerators) is cut in the same proportion, and the
 * building exports (new accelerators) share what is left.
 */
export function shareLine(w) {
	let up = 0, build = 0;
	for (const co of w.coops) if (co.alive) (up += co.exportUp), (build += co.exportBuild);
	const line = w.c.lineKwhDay;
	const fu = up > line ? line / up : 1;
	const fb = build > 0 ? Math.min(1, Math.max(0, line - up * fu) / build) : 1;
	if (fu < 1 || fb < 1) for (const co of w.coops) if (co.alive) (co.exportUp *= fu), (co.exportBuild *= fb);
}

/** the export class a COOP's border trade is served in (for the page) */
export const EXPORT_CLASS = CLASS.running;

/**
 * The COOPs pay their advances back to the City COOP in their own MIND (weekly, in the slow loop): a 26th of what each
 * owes, at least €1, at most a twentieth a week of the MIND its treasury holds of its own. A euro is priced at the electricity
 * that earns it: eurR (its kWh at today's energy price, in R), turned into the COOP's MIND at its pool price. The MIND
 * moves from the COOP's treasury to the City COOP's (an exact transfer: no MIND is made or melted), where it earns Law 5
 * dividends. No interest. Returns the R repaid.
 */
export function repayAdvances(w, dt = 7) {
	const B = w.border, city = w.cityK, P = w.P;
	if (!B) return 0;
	let paidR = 0;
	for (const co of w.coops) {
		if (!co.alive || co.city || !(co.advEur > 1e-9)) continue;
		const k = co.k;
		const eur = Math.min(co.advEur, Math.max(1, (co.advEur * dt) / 182));
		const perEur = eurR(w, 1) / (P[k] > 0 ? P[k] : 1);
		// at most 5 % of its own MIND in its treasury a week
		const have = Math.max(0, w.tre[k * M + k]) * (1 - Math.pow(0.95, dt / 7));
		const count = Math.min(eur * perEur, have);
		if (!(count > 0) || !(perEur > 0)) continue;
		w.tre[k * M + k] -= count;
		w.tre[city * M + k] += count;
		const e = count / perEur;
		co.advEur = Math.max(0, co.advEur - e);
		co.repaidR = (co.repaidR ?? 0) + count * P[k];
		B.repaidEur += e;
		B.repaidR += count * P[k];
		paidR += count * P[k];
	}
	return paidR;
}

/** euros the COOPs owe the bank (advances not yet paid back in MIND) */
export function advancesOwed(w) {
	let s = 0;
	for (const co of w.coops) s += co.advEur ?? 0;
	return s;
}
