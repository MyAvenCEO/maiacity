// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE AI MARKET (Samuel, 2026-10-13 07:27) — who owns the accelerators, who sells inference, who sells
 * Aven service, and how the personal Avens work for the COOPs.
 *
 * - **The hardware owners.** The inference hardware belongs to the settlement COOPs and the Village COOP: accelerators
 *   in the data centres of their utilities domes (the centre dome's for the Village COOP), run on their power. They buy
 *   accelerators through the euro border (the MaiaCity COOP's bank advances the euros, and they pay them back in their
 *   own MIND: ./border.js payEur, repayAdvances), keep them and replace them as they wear (CHIPS.life). The accelerators
 *   stand on the hall plants (`pl.chipsN`, a count), so they move with the domes when a COOP fails.
 * - **Inference.** The owners sell accelerator-hours to the AI COOPs (the avenCEO COOP, and any rival Law 3 founds), a
 *   business-to-business good: a real delivery, paid in MIND (the seller receives only its own MIND, through the pools),
 *   with Law 5 (./engine.js settle). Each owner posts its own price by the forward margin every seller uses (world
 *   model 4.4): its reference follows its full cost (electricity and cooling, its racks' Aven hours, and the wear of its
 *   accelerators at their replacement cost) and the price moves with its capacity against what is asked.
 * - **Aven service.** The avenCEO COOP runs the harness (TECH.harness): it buys the inference and sells Aven hours to
 *   the people (the COMPUTE good). An Aven hour takes 1 ÷ 16 of an accelerator-hour (CHIPS.sessions), less as the
 *   harness learns (coefficient `infer`). Its own costs are Aven hours at the rate card (the harness's upkeep, its R&D).
 * - **The personal Avens work for all COOPs.** A person's Aven runs on Aven service: help for its person (the
 *   living-standard stat, bought from what the person holds) and work for the COOPs (running items and work
 *   proposals). An Aven works at most workCapH hours a day while an hour of its work earns more than the hour's Aven
 *   service costs; the work item's pay settles that Aven service at delivery and the person gets the rest, in
 *   proportion to skill × hours delivered (./coops.js workBook, workItems), so nobody needs MIND in hand before their
 *   Aven can work. So the village's demand for inference is the people's help, all the COOPs' work and the avenCEO
 *   COOP's own hours.
 * - **The binding resource** is accelerators × hours × electricity: the owners' capacity (accelerators × 24 h × CHIPS.avail),
 *   the running class of the dispatch for their electricity, the data-centre floor that holds them, and (closed border)
 *   the accelerators that can come in at all. Where Aven service is short, work is served before help, and running
 *   items before work proposals; COOPs whose running hours are not delivered deliver less the next day.
 * - **AI exports (experiment AIX, `aiExport`).** The MaiaCity COOP buys Aven service from the avenCEO COOP in MIND (a
 *   real sale, with Law 5) and sells it abroad for euros at a GPU-hour's market price, up to a small provider's demand,
 *   while the village still owes its founders (as it exports electricity: ./border.js bankExport). Inference does not
 *   go over the 10 MW line; its electricity is in the dispatch's running class.
 */
import { CLASS, COMPUTE, ENERGY, IN_HAND, MAX_COOPS } from './consts.js';
import { payEur, reserveEur, eurR } from './border.js';
import { peopleAhead } from './ramp.js';

const M = MAX_COOPS;
const { exp, log, pow, max, min, ceil, floor } = Math;
/** days ahead the owners look when they equip their data centres, and the headroom they keep */
const AHEAD_DAYS = 30, HEADROOM = 1.25;
/** Aven hours a person a day the owners count on at least for the people ahead (help and work: a quarter of the two
 * sessions an Aven can run) — a prior for the first days, before anyone has ordered */
const PRIOR_H = 12;
/** days a work proposal takes to deliver: a treasury's posted proposals are worked off a seventh a day */
export const PROP_DAYS = 7;

/** inference (accelerator-hours) an Aven hour takes today: 1 ÷ sessions, times the harness's learned coefficient */
export const ahPerAvenH = (w) => (w.learn.harness?.coef.infer ?? 1) / w.c.chipSessions;

/** the data-centre floor a hall has standing (m²): its share of the plan's domes standing; the camp's server first */
export function dcM2(w, h) {
	if (h.def?.kind !== 'hall') return 0;
	const share = h.capFull > 0 ? max(0, h.cap) / h.capFull : h.cap > 0 ? 1 : 0;
	let m2 = w.c.dcM2 * (h.share ?? 1) * share;
	// the camp's container rack, in the first settlement's hall while its utilities dome is not yet up
	if (h.hex === 0 && w.ramp && !w.ramp.over) m2 = max(m2, w.c.campChips * w.c.chipM2);
	return m2;
}

/** the COOPs that hold data halls (the hardware owners), alive */
export function ownersOf(w) {
	const out = [];
	for (const co of w.coops) if (co.alive && co.plants.some((p) => p.def.kind === 'hall')) out.push(co);
	return out;
}
/** accelerators a COOP holds (standing, worn ones gone) */
export const chipsOf = (co) => co.plants.reduce((a, p) => a + (p.def.kind === 'hall' ? (p.chipsN ?? 0) : 0), 0);
/** every accelerator in the village (the hardware owners', and those on halls the City COOP holds idle) */
export function chipsAll(w) {
	let s = 0;
	for (const co of w.coops) for (const p of co.plants) if (p.def.kind === 'hall') s += p.chipsN ?? 0;
	for (const p of w.coops[w.cityK]?.idle ?? []) if (p.def?.kind === 'hall') s += p.chipsN ?? 0;
	return s;
}
/** the AI COOPs (Aven service sellers) alive */
export const aiCoops = (w) => w.coops.filter((c) => c.alive && c.good === COMPUTE);

function newInf(w, co) {
	return { priceR: 0, price: 0, ref: 0, fullR: 0, floorR: 0, varR: 0, capAH: 0, askedEma: 0, soldEma: 0, sold: 0, asked: 0, margin: 1, revR: 0, rackH: 0, share: 0 };
}

/**
 * Each morning, before the COOPs cost their goods: the owners' capacity, costs and posted inference prices (the forward
 * margin), the buyers' shares between them, and what inference each AI COOP's harness can count on today.
 */
export function aiMorning(w) {
	const pE = w.pbar[ENERGY], lam = w.cfg.law5, rateR = w.c.rateR, P = w.P;
	const owners = ownersOf(w);
	w.aiOwners = owners;
	// the first morning: the camp's rack is equipped before the settlers move in (part of the founding bill, advanced
	// by the bank like every accelerator), so their Avens run from the first day
	if (w.day === 0 && !w.aiEquipped) (w.aiEquipped = true), buyAccelerators(w, owners);
	const chipR = w.c.chipKwh * importFactorAi(w) * pE;
	const hrs = w.c.chipHoursDay;
	let capAll = 0;
	for (const co of owners) {
		const I = (co.inf ??= newInf(w, co));
		const n = chipsOf(co);
		I.capAH = n * hrs;
		capAll += I.capAH;
		I.varR = w.c.chipKwhH * pE + w.c.rackRunH * rateR;
		I.floorR = I.varR / (1 - lam);
		const wearR = (n * chipR) / (w.c.chipLife * 365);
		const sold = max(I.soldEma, 0.25 * max(I.capAH, I.soldEma));
		I.fullR = sold > 1e-9 ? (I.varR + wearR / sold) / (1 - lam) : (I.varR + chipR / (w.c.chipLife * 365 * hrs)) / (1 - lam);
		const need = max(I.askedEma, 1e-9);
		I.margin = I.capAH > 0 ? (I.capAH * 15) / ((15 + IN_HAND) * need) : 0;
	}
	// posted prices: the forward margin (./market.js postPrices), each in R and in its own MIND
	let sumP = 0, nP = 0;
	for (const co of owners) if (co.inf.capAH > 0 && co.inf.priceR > 0) (sumP += co.inf.priceR), nP++;
	for (const co of owners) {
		const I = co.inf;
		const Pk = P[co.k] > 0 ? P[co.k] : 1;
		if (!(I.priceR > 0)) (I.priceR = I.fullR), (I.ref = I.fullR);
		const now = I.priceR;
		const nO = nP - (I.capAH > 0 ? 1 : 0);
		const others = nO > 0 ? (sumP - (I.capAH > 0 ? now : 0)) / nO : now;
		let p = now;
		if (!(I.capAH > 0)) p = nO > 0 ? others : I.fullR;
		else {
			const m = max(1e-9, I.margin);
			if (I.fullR > 0) I.ref *= exp(log(I.fullR / I.ref) / 60);
			let target = I.ref / m;
			if (nO > 0) {
				if (m >= 1 && target > others && target > now) target = max(now, others);
				if (m < 1 && target < others && target < now) target = min(now, others);
			}
			p = now * pow(target / now, 0.5);
		}
		if (!(p > 0) || !isFinite(p)) p = now;
		I.priceR = max(p, I.floorR);
		I.price = I.priceR / Pk;
	}
	// the buyers' shares: a logit on price among the owners with accelerators, weighted by their capacity
	const beta = w.cfg.logitBeta ?? 6;
	let wsum = 0, pbar = 0;
	for (const co of owners) (pbar += co.inf.capAH * co.inf.priceR), (wsum += co.inf.capAH);
	pbar = wsum > 0 ? pbar / wsum : owners[0]?.inf.priceR ?? 0;
	let ssum = 0;
	for (const co of owners) {
		const I = co.inf;
		I.share = I.capAH > 0 && pbar > 0 ? I.capAH * exp(-beta * (I.priceR / pbar - 1)) : 0;
		ssum += I.share;
	}
	let pr = 0;
	for (const co of owners) {
		co.inf.share = ssum > 0 ? co.inf.share / ssum : 0;
		pr += co.inf.share * co.inf.priceR;
	}
	w.inferPR = pr > 0 ? pr : pbar > 0 ? pbar : owners[0]?.inf.fullR ?? 0;
	w.inferCapAH = capAll;
	// what each AI COOP's harness can serve today: its share of the inference (by what its buyers asked lately)
	const ai = aiCoops(w);
	let asked = 0;
	for (const co of ai) asked += max(co.demandEma, 1e-9);
	const perH = ahPerAvenH(w);
	for (const co of ai) {
		const s = asked > 0 ? max(co.demandEma, 1e-9) / asked : 1 / ai.length;
		for (const pl of co.plants) if (pl.def.kind === 'harness') pl.inferCapDay = perH > 0 ? (capAll * s) / perH : 0;
	}
}

/** how many times the border's accelerator price is raised by a scheduled import shock (B23) */
function importFactorAi(w) {
	let f = 1;
	for (const s of w.cfg.shocks ?? []) if (s.kind === 'importPrice' && w.day >= s.day && w.day < s.day + (s.days ?? 365)) f *= s.factor ?? 2;
	return f;
}

/**
 * After the people's orders have cleared (./engine.js basicsLoads): the inference the AI COOPs need for the Aven hours
 * they deliver (and, in AIX, the export), cleared between the owners by their shares and capacity; the owners' electricity
 * for it goes into the dispatch's running class.
 */
export function aiLoads(w) {
	const owners = w.aiOwners ?? [];
	const perH = ahPerAvenH(w);
	const ai = aiCoops(w);
	const flow = (w.aiFlow = { buyers: [], exportAH: 0, exportH: 0, exportBuyer: -1, AH: 0, askedAH: 0, got: new Float64Array(M) });
	for (const co of w.coops) co.aiKwh = 0;
	let X = 0, askedX = 0;
	let deliveredAll = 0;
	for (const co of ai) {
		const s = w.sh[COMPUTE * M + co.k];
		const x = (w.D[COMPUTE] ?? 0) * (s > 0 ? s : 0);
		deliveredAll += x;
		const ah = x * perH;
		// (the people pay this inference straight to the owners, on the AI COOP's bill: inferenceSplit)
		flow.buyers.push([co.k, ah, true]);
		X += ah;
		askedX += max(0, co.orders ?? 0) * perH;
	}
	// AIX: the MaiaCity COOP's bank exports Aven service bought from the avenCEO COOP, as it exports electricity
	// (./border.js bankExport): for what the village still owes its founders, spread over bankPaybackYears, up to a
	// small provider's demand abroad, only while a GPU-hour sold earns more euros than it costs the village in euros (the
	// electricity the line would have sold instead, and the accelerator's wear at its border price), and as far as its
	// treasury can pay the Aven service in MIND. The owners see the ask (they equip for it, ./ai.js aiEvening); the
	// village's own use is served first, the export from what is left
	if (w.cfg.aiExport && w.border && ai.length) {
		const seller = ai.find((c) => c.id === 'AVENCEO') ?? ai[0];
		const cum = reserveEur(w) - w.border.shared0;
		const priceR = seller.priceR > 0 ? seller.priceR : seller.price * w.P[seller.k];
		const costAH = perH > 0 ? priceR / perH : Infinity;
		const eurCostAH = w.c.chipKwhH * w.c.eurPerKwh + (w.c.chipEur * importFactorAi(w)) / (w.c.chipLife * 365 * w.c.chipHoursDay);
		let want = 0;
		if (cum < 0 && w.c.aiExportEurH > eurCostAH) want = min(w.c.aiExportAhDay, -cum / (max(1, w.c.bankPaybackYears) * 365) / w.c.aiExportEurH);
		// it spends on it only its surplus: what its treasury holds above its reserve for its own bills (as payout)
		const city = w.coops[w.cityK];
		const budget = max(0, payableAll(w, w.cityK) - w.cfg.reserveDays * (city?.costREma ?? 0));
		if (want * costAH > budget) want = budget / max(1e-12, costAH);
		const ah = min(want, max(0, (w.inferCapAH ?? 0) - X));
		flow.exportWant = want;
		flow.exportAH = ah;
		flow.exportH = perH > 0 ? ah / perH : 0;
		flow.exportBuyer = seller.k;
		// (the bank pays this inference straight to the owners, on the avenCEO COOP's bill, as the people do)
		flow.buyers.push([seller.k, ah, true]);
		X += ah;
		askedX += want;
	}
	flow.AH = X;
	flow.askedAH = askedX;
	// clear between the owners: by shares, capped by capacity, what one cannot give to those with room
	const got = flow.got;
	let unmet = 0;
	for (const co of owners) {
		const want = X * co.inf.share;
		got[co.k] = min(want, co.inf.capAH);
		unmet += want - got[co.k];
	}
	for (let pass = 0; pass < 3 && unmet > 1e-9; pass++) {
		let room = 0;
		for (const co of owners) room += max(0, co.inf.capAH - got[co.k]);
		if (!(room > 1e-12)) break;
		const take = min(unmet, room);
		for (const co of owners) {
			const r = max(0, co.inf.capAH - got[co.k]);
			if (r > 0) {
				const x = (take * r) / room;
				got[co.k] += x;
				unmet -= x;
			}
		}
	}
	for (const co of owners) {
		const I = co.inf;
		I.asked = askedX * I.share;
		I.rackH = got[co.k] * w.c.rackRunH;
		co.aiKwh = got[co.k] * w.c.chipKwhH;
		co.eReq[CLASS.running] += co.aiKwh;
	}
}

/** what a treasury can pay with today, in R (the MINDs it holds that have a live pool) */
function payableAll(w, k) {
	let s = 0;
	const row = k * M;
	for (let j = 0; j < M; j++) if (w.tre[row + j] > 0 && w.liquid[j]) s += w.tre[row + j] * w.P[j];
	return s;
}

/**
 * The inference bills (called from ./engine.js settle for each COOP): what this COOP owes each owner for the
 * accelerator-hours it bought today, as [owner k, count of the owner's MIND] (the dispatch's running fill applies: the
 * accelerators ran only on the electricity they got). The AIX export: the MaiaCity COOP owes the avenCEO COOP for the Aven
 * service it sells abroad.
 */
export function aiBills(w, co, fillR) {
	const f = w.aiFlow;
	if (!f || !(f.AH > 0)) return null;
	const out = [];
	let ah = 0;
	// (the inference in the Aven hours sold to people is on the people's bills, paid straight to the owners:
	// inferenceSplit; what is left here is the AIX export's)
	for (const [k, a, viaPeople] of f.buyers) if (k === co.k && !viaPeople) ah += a;
	if (ah > 0)
		for (const o of w.aiOwners ?? []) {
			const g = f.got[o.k];
			if (!(g > 0) || o.k === co.k) continue;
			out.push([o.k, ((ah * g) / f.AH) * fillR * o.inf.price]);
		}
	if (co.k === w.cityK && f.exportH > 0 && f.exportBuyer >= 0) {
		// the bank's bill for the Aven service it exports: the inference in it to the owners, the rest to the AI COOP
		const s = w.coops[f.exportBuyer];
		const split = inferenceSplit(w);
		let infR = 0;
		if (split) for (let j = 0; j < split.length; j += 3) infR += split[j + 2];
		const fr = s.priceR > 0 && infR > s.priceR ? s.priceR / infR : 1;
		if (split) for (let j = 0; j < split.length; j += 3) if (split[j] !== co.k) out.push([split[j], f.exportH * fillR * split[j + 1] * fr]);
		const own = s.priceR > 0 ? Math.max(0, 1 - (infR * fr) / s.priceR) : 1;
		out.push([s.k, f.exportH * fillR * s.price * own]);
	}
	return out;
}

/**
 * The inference an Aven hour sold to a person carries, as [owner k, count of its MIND, R] per Aven hour, by today's
 * clearing between the owners (./engine.js settle). It is on the AI COOP's bill to the person, at the owners' prices,
 * and the person's Aven pays it straight to the owners, each in its own MIND (through the pools for the rest, as every
 * payment): the AI COOP bought it (it ordered it and the owners delivered it to its harness), and its customer settles
 * that part of the invoice with the owner, so the AI COOP's own MIND is not sold into the pools for every hour of
 * inference. Its own part of the price is the rest. Without this an AI COOP, paid by its customers in its own MIND
 * (the HEARTS put it in their hands), had to sell that MIND for every accelerator-hour until its price gave way.
 */
export function inferenceSplit(w) {
	const f = w.aiFlow;
	if (!f || !(f.AH > 0)) return null;
	const perH = ahPerAvenH(w);
	const out = [];
	for (const o of w.aiOwners ?? []) {
		const g = f.got[o.k];
		if (!(g > 0)) continue;
		const fr = (g / f.AH) * perH;
		out.push(o.k, fr * o.inf.price, fr * o.inf.priceR);
	}
	return out.length ? out : null;
}

/**
 * After the dispatch: what each owner sold (its accelerators ran on the running class's electricity), its averages;
 * the AIX export's euros into the bank's own, and the Aven hours the avenCEO COOP sold for it.
 */
export function aiSettle(w, fillR) {
	const f = w.aiFlow, t = w.today;
	t.ai = { AH: 0, priceR: w.inferPR ?? 0, exportAH: 0, exportEur: 0, capAH: w.inferCapAH ?? 0, chipsIn: 0, chipsEur: 0 };
	for (const co of w.aiOwners ?? []) {
		const I = co.inf;
		const sold = (f?.got[co.k] ?? 0) * fillR;
		I.sold = sold;
		I.soldEma += (sold - I.soldEma) / 30;
		I.askedEma += ((I.asked ?? 0) - I.askedEma) / 30;
		I.revR = sold * I.priceR;
		t.ai.AH += sold;
	}
	if (f && f.exportH > 0) {
		const s = w.coops[f.exportBuyer];
		const h = f.exportH * fillR;
		const eur = f.exportAH * fillR * w.c.aiExportEurH;
		s.sold += h;
		s.made += h;
		// (the Aven hours leave the same day: no store; the euros go into the bank's own, beside what the line earns)
		const B = w.border;
		B.shared += eur;
		t.eurInAi = (t.eurInAi ?? 0) + eur;
		t.exportEurBy = t.exportEurBy ?? new Float64Array(w.D.length);
		t.exportEurBy[COMPUTE] += eur;
		t.ai.exportAH = f.exportAH * fillR;
		t.ai.exportEur = eur;
	}
}

/**
 * Each evening: the accelerators wear (1 ÷ life a year of what stands: a worn one is scrapped), and the owners buy new
 * ones through the border to keep HEADROOM over the inference they expect AHEAD_DAYS on (what was asked lately, the
 * people the plan brings, and in AIX the export demand). The new accelerators go where the data-centre floor is
 * standing and free, each owner's in proportion to its free floor; each owner pays its own (an advance from the bank,
 * paid back in its own MIND). With the border closed (chipImport false) none comes in.
 */
export function aiEvening(w) {
	const t = w.today;
	const owners = w.aiOwners ?? ownersOf(w);
	const life = w.c.chipLife * 365;
	for (const co of w.coops)
		for (const p of co.plants)
			if (p.def.kind === 'hall' && p.chipsN > 0) {
				const x = p.chipsN / life;
				p.chipsN -= x;
				t.chipsUsed = (t.chipsUsed ?? 0) + x;
			}
	for (const p of w.coops[w.cityK]?.idle ?? [])
		if (p.def?.kind === 'hall' && p.chipsN > 0) {
			const x = p.chipsN / life;
			p.chipsN -= x;
			t.chipsUsed = (t.chipsUsed ?? 0) + x;
		}
	buyAccelerators(w, owners);
}

/** the owners buy accelerators through the border for the inference they expect (aiEvening) */
function buyAccelerators(w, owners) {
	const t = w.today;
	if (w.cfg.chipImport === false || !w.border || !owners.length) return;
	const perH = ahPerAvenH(w);
	let asked = 0;
	for (const co of owners) asked += co.inf?.askedEma ?? 0;
	const ahead = w.ramp && !w.ramp.over ? peopleAhead(w, AHEAD_DAYS) : w.N;
	const growth = max(1, ahead / max(1, w.N));
	const prior = PRIOR_H * ahead * perH;
	// (in AIX the bank's export asks are in what was asked: the owners equip for them as for the village's)
	const need = max(asked * growth, prior);
	const target = (HEADROOM * need) / w.c.chipHoursDay;
	let have = 0;
	for (const co of owners) have += chipsOf(co);
	// whole accelerators: the first as soon as any is needed, then one more each time half of one is missing
	const gap = target - have;
	const want = have < 1e-9 ? (target > 1e-9 ? max(1, Math.round(gap)) : 0) : gap > 0.5 ? Math.round(gap) : 0;
	w.aiBind = w.aiBind ?? {};
	if (!(want > 0)) return;
	// free floor, owner by owner
	const free = [];
	let freeAll = 0;
	for (const co of owners) {
		let f = 0;
		for (const p of co.plants) if (p.def.kind === 'hall') f += max(0, dcM2(w, p) / w.c.chipM2 - (p.chipsN ?? 0));
		free.push([co, f]);
		freeAll += f;
	}
	if (!(freeAll >= 1)) {
		t.aiSpaceShort = 1;
		return;
	}
	let left = min(want, floor(freeAll));
	const price = w.c.chipEur * importFactorAi(w);
	// whole accelerators, the largest free floors first
	free.sort((a, b) => b[1] - a[1] || a[0].k - b[0].k);
	const alloc = free.map(([co, f]) => [co, f, floor((left * f) / freeAll)]);
	let given = alloc.reduce((a, x) => a + x[2], 0);
	for (let j = 0; given < left && j < alloc.length * 2; j++) {
		const x = alloc[j % alloc.length];
		if (x[2] + 1 <= floor(x[1])) (x[2]++, given++);
	}
	for (const [co, , n] of alloc) {
		if (!(n > 0)) continue;
		const paid = payEur(w, co, n * price);
		// (with the bank's euros bounded, F01, it may pay for less than it asked)
		const got = paid / price;
		if (!(got > 1e-9)) continue;
		// on the halls with the most free floor first
		let r = got;
		const halls = co.plants.filter((p) => p.def.kind === 'hall').sort((a, b) => dcM2(w, b) / w.c.chipM2 - (b.chipsN ?? 0) - (dcM2(w, a) / w.c.chipM2 - (a.chipsN ?? 0)));
		for (const h of halls) {
			if (!(r > 0)) break;
			const room = max(0, floor(dcM2(w, h) / w.c.chipM2 - (h.chipsN ?? 0)));
			const x = min(r, room);
			h.chipsN = (h.chipsN ?? 0) + x;
			r -= x;
		}
		if (r > 0 && halls[0]) halls[0].chipsN = (halls[0].chipsN ?? 0) + r;
		t.chipsIn = (t.chipsIn ?? 0) + got;
		if (t.imp) (t.imp.chips += got), (t.impEur.chips += paid);
		co.inf && (co.inf.boughtN = (co.inf.boughtN ?? 0) + got);
		w.events.push({ day: w.day, kind: 'chips', coop: co.id, n: got });
	}
}
