// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE EURO BORDER — what the village cannot make, its COOPs buy outside (paper §11.4, §12.4), as COOPs only.
 *
 * The euro reserve holds the founding euros left over (the village's buffer, `w.border.shared`) and each COOP's own
 * account (`w.border.eur[k]`). A COOP that buys at the border pays from its own account first, then from the founding
 * euros. It fills its own account by exporting electricity: it buys the kWh from the energy COOPs in MIND (a real sale,
 * with Law 5), the line sells it at the wholesale price, and the euros go into its account. No person holds euros, no
 * MIND is made from euros, HEARTS never buy anything.
 *
 * Who buys what: the food COOPs buy food (in the diet's mix, at wholesale) when their stores and harvests ahead fall
 * short of what their buyers will eat; the works buy their raw inputs (logs beyond the village's woods, steel scrap
 * beyond the village's own worn steel, float glass, solar cells); the COMPUTE COOPs buy accelerators (./coops.js plan,
 * produce). What is bought arrives the same day. A COOP that finds no euros buys less: its buyers go short.
 */
import { CLASS, ENERGY, FOOD, MAX_COOPS, WOOD, STEEL, GLASS, PANEL } from './consts.js';
import { rawOf, plantCapDay, capDayOf } from './genesis.js';
import { supplyAhead, logsGrowth, foodIn, unitEurOf } from './coops.js';

const M = MAX_COOPS;
/** the import kinds of the ledger, in order */
export const IMPORT_KINDS = ['food', 'logs', 'scrap', 'float', 'cells', 'glulam', 'steel', 'glazing', 'panels', 'chips'];
/** the finished goods a works COOP buys when its works cannot keep up (by good index: glulam, steel, glass, panels) */
const FINISHED = { [WOOD]: 'glulam', [STEEL]: 'steel', [GLASS]: 'glazing', [PANEL]: 'panels' };

/** a fresh border: the founding euros left over, and an empty account for each COOP */
export function newBorder(w, sharedEur) {
	return { eur: new Float64Array(M), shared: sharedEur, shared0: sharedEur, prev: sharedEur, inEur: 0, outEur: 0, drawShared: 0 };
}

/** euros in the reserve: the founding euros left and every COOP's account */
export function reserveEur(w) {
	const B = w.border;
	let s = B.shared;
	for (let k = 0; k < M; k++) s += B.eur[k];
	return s;
}

/** pay `eur` for a COOP's import: its own account first, then the founding euros; returns what was paid */
export function payEur(w, co, eur) {
	const B = w.border, t = w.today;
	if (!(eur > 0)) return 0;
	const own = Math.min(B.eur[co.k], eur);
	B.eur[co.k] -= own;
	const shared = Math.min(B.shared, eur - own);
	B.shared -= shared;
	B.drawShared += shared;
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
	t.imp = Object.fromEntries(IMPORT_KINDS.map((k) => [k, 0]));
	t.impEur = Object.fromEntries(IMPORT_KINDS.map((k) => [k, 0]));
	t.impShort = 0;
	for (const co of w.coops) {
		co.eurToday = 0;
		co.importToday = 0;
		if (!co.alive) continue;
		if (co.good === FOOD) {
			const ahead = supplyAhead(w, co, H);
			const need = Math.max(co.demandEma, 0);
			const gap = need * (H + 15) - co.stock - ahead[ahead.length - 1];
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
			for (const pl of co.plants) {
				const ro = rawOf(pl);
				if (!ro) continue;
				const [kind, a] = ro;
				// what its works will use a day: what its buyers ask, at least what it made lately, by this plant's share
				const share = cap > 0 ? Math.max(0, plantCapDay(w, pl, w.day)) / cap : 1;
				const useDay = Math.min(Math.max(0, plantCapDay(w, pl, w.day)), Math.max(co.demandEma ?? 0, co.madeEma ?? 0) * Math.min(1, share)) * a;
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
				const gap = Math.max(0, co.demandEma) * (H + 10) - co.stock - ahead[ahead.length - 1];
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

/**
 * The export a COOP that buys at the border plans today (in ./coops.js plan): enough to keep its own account at
 * accountDays of what it has spent lately, or at what it will have to buy at the border before its own plants catch
 * up (its deficit ahead: a food COOP saves in the autumn for the spring), whichever is more, spread over two months
 * (the line's room is shared out by shareLine). Upkeep's class (served with the running class, before any building): food and the works' inputs
 * are what the village lives on. The COMPUTE COOPs plan theirs for accelerators in ./coops.js plan.
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
