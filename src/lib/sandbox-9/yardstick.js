// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · PROPOSITION 3, PART 3: THE YARDSTICK OF THE VERDICT (Samuel, card of 2026-10-14 17:31: "Taste-adjusted").
 *
 * Part 3 is judged per tenth in real units, as canon #19 says (./prop3.js realUnits): the basics at need every year,
 * and no single extra falls more than 2 % in any five years; each tenth's basket rises over the run; the COOP part
 * apart. Which falls of an extra count is the yardstick. `P3_VERDICT` names the one that gives the verdict; the others
 * are side columns beside it. Changing the verdict is this one edit: the proof report (scripts/sandbox-9-proof.mjs)
 * judges every yardstick from what ./prop3.js keeps of each run (every fall over 2 %, with the year's binding limit of
 * the good, and every fall it excused, with why), so `--load` rejudges saved runs without running them again.
 *
 *   taste       taste-adjusted (the verdict): a fall counts only when the tenth got less of that extra than it
 *               ordered (orders not filled): a fall in what people ask for is not a fall in living standards. And a
 *               fall never counts while the good is at its natural or physical limit that year (the cap excuse, as
 *               in (a)): the warm ponds are the case in point, rationed by nature with orders about 60 % filled.
 *   each        (a) each extra (canon #19 as round 6 ran it): every fall counts unless the extra is at satiation or a
 *               natural or physical limit binds that year.
 *   tasteNoCap  (b) taste-adjusted, no cap excuse: a fall counts when the tenth's orders were not filled, at a limit or
 *               not.
 *   basket      (c) one basket: the four extras together, at fixed day-1 prices, never fall more than 2 % in five years.
 *
 * Every yardstick keeps the satiation excuse: a tenth at satiation got what it wanted.
 *
 * Orders filled. The saved runs keep what each tenth got, not what it ordered. They keep each good's binding limit,
 * day by day (./engine.js badges), and that says whether orders were filled: an extra short of supply is rationed in
 * proportion to everyone's orders (./engine.js clearPeople), so on a day it is sold out every tenth that ordered it gets
 * less than it ordered, and its limit is the supply's (a physical one such as nature, or not, such as "not built"). On a
 * day it is not sold out every order is filled: its limit reads "demand" (nobody's budget bound either) or, for a bed,
 * "need met". "MIND" means it was not sold out, but some people's budgets left them nothing for extras that day: they
 * wanted it and got none, so it counts as not filled, as round 6's (b) read it. A fall is read on the year it ends in,
 * by that year's most frequent limit.
 *
 * This file is not one of ./proofRun.js ENGINE_FILES: it judges runs and does not run them, so a change here keeps the
 * saved runs loadable. ./prop3.js still writes (a) as each run's own P3 flag; the proof report and the page's Proof tab
 * give the verdict by `P3_VERDICT`.
 */

/** the yardstick of part 3's verdict: one of the keys of YARDSTICKS */
export const P3_VERDICT = 'taste';

/** each yardstick: its mark in the side columns, its name, and its rule in plain words */
export const YARDSTICKS = {
	taste: {
		mark: '',
		label: 'taste-adjusted',
		rule: 'an extra’s fall counts only when the tenth got less of it than it ordered (a fall in what people ask for is not a fall in living standards), and never while the good is at its natural or physical limit that year (the warm ponds, which nature rations) or the tenth is at satiation'
	},
	each: {
		mark: '(a)',
		label: 'each extra',
		rule: 'every fall of an extra counts unless the extra is at satiation or a natural or physical limit binds that year (canon #19 as round 6 ran it)'
	},
	tasteNoCap: {
		mark: '(b)',
		label: 'taste-adjusted, no cap excuse',
		rule: 'a fall counts when the tenth got less of the extra than it ordered, at a natural or physical limit or not'
	},
	basket: {
		mark: '(c)',
		label: 'one basket',
		rule: 'the four extras together (home m², goods, Aven help, warm ponds), valued at fixed day-1 prices, never fall more than 2 % in any five years'
	}
};
/** the side columns: every yardstick but the verdict's, in the order (a), (b), (c) */
export const SIDE = Object.keys(YARDSTICKS).filter((k) => k !== P3_VERDICT);
/** a yardstick's name with its mark, as the report prints it */
export const nameOf = (k) => (YARDSTICKS[k].mark ? `${YARDSTICKS[k].mark} ${YARDSTICKS[k].label}` : YARDSTICKS[k].label);

/**
 * The binding limits (./consts.js LIMIT_NAMES) under which a tenth's orders count as filled. "MIND" is not among
 * them: the extra was not sold out, but budgets bound, so the tenth wanted more than it could pay for (round 6's (b)
 * reading, which Samuel chose from). Adding 'MIND' here would read "orders not filled" literally: only a sold-out extra
 * leaves an order unfilled.
 */
const FILLED = ['demand', 'need met'];
/** were the tenth's orders filled in the year a fall ends in, by that year's binding limit of the good */
export const ordersFilled = (bind) => FILLED.includes(String(bind));
/** a fall ./prop3.js excused because a natural or physical limit bound that year */
const atCap = (e) => String(e.why ?? '').startsWith('physical limit');

/** the extras of the test (./prop3.js EXTRA_ITEMS): the living rows' key, the item's name in ./prop3.js, its good */
export const EXTRAS = [
	['homeM2', 'home', 'bed'],
	['goodsKgYear', 'goods', 'goods'],
	['avenH', 'Aven help', 'compute'],
	['pondHWeek', 'warm ponds', 'spring']
];
/** the basket of extras a person a day in R at fixed prices P (day 1's): { goods, spring, compute, bed, m2PerBed } */
const basketR = (r, P) => (r.goodsKgYear / 365) * P.goods + (r.pondHWeek / 7) * P.spring + r.avenH * P.compute + (r.homeM2 / P.m2PerBed) * P.bed;

/**
 * Part 3 under every yardstick, per tenth, after the founding (the claim) and in the founding (its own column), from
 * one run's ./prop3.js result `p` and its yearly living rows (./records.js livingYears). `prices` are day 1's (for the
 * basket; without them (c) is not judged). Each tenth fails a yardstick when a basic is below need, its basket did not
 * rise over the run, or a fall counts under it. In the founding, (b) sees only (a)'s falls: the founding's falls excused
 * for a physical limit are not kept in a run's result, so (b) there is a floor; the verdict and (a) are exact.
 */
export function judgeP3(p, living, prices) {
	const F = p.founding ?? { firstFullYear: 1 };
	const L = (living ?? []).filter((y) => y.days >= 365);
	const spans = [
		['after', (y) => y.year >= (F.foundingOnly ? 1 : F.firstFullYear), p.P3.real, true],
		['founding', (y) => !F.foundingOnly && y.year < F.firstFullYear, p.P3.founding, false]
	];
	const out = { verdict: P3_VERDICT, label: YARDSTICKS[P3_VERDICT].label, coops: !!p.P3.coops?.pass };
	for (const [span, inSpan, R, full] of spans) {
		if (!R) {
			out[span] = null;
			continue;
		}
		const Y = L.filter(inSpan);
		const rows = [];
		for (const [by, key] of [['holdings', 'byHoldings'], ['aven', 'byAven']])
			for (let x = 0; x < 10; x++) {
				const mine = (e) => e.by === by && e.tenth === x + 1;
				const fails = (R.failures ?? []).filter(mine);
				const excused = Array.isArray(R.excused) ? R.excused.filter(mine) : [];
				const fall = (e, why) => ({ item: e.item, unit: e.unit, from: e.from, to: e.to, fall: e.fall, before: e.before, after: e.after, bind: e.bind ?? String(e.why).replace('physical limit: ', ''), filled: e.bind != null ? ordersFilled(e.bind) : false, atCap: why === 'cap' });
				const falls = {
					each: fails.map((e) => fall(e)),
					taste: fails.filter((e) => !ordersFilled(e.bind)).map((e) => fall(e)),
					tasteNoCap: [...fails.filter((e) => !ordersFilled(e.bind)).map((e) => fall(e)), ...excused.filter(atCap).map((e) => fall(e, 'cap'))]
				};
				// (c) the basket at day-1 prices, every window of up to five years
				let basket = null, windows = 0;
				if (prices) {
					const v = Y.map((y) => (y[key]?.[x] ? basketR(y[key][x], prices) : NaN));
					for (let j = 1; j < v.length; j++)
						for (let i = Math.max(0, j - 5); i < j; i++) {
							if (!(v[i] > 0) || !Number.isFinite(v[j])) continue;
							const f = 1 - v[j] / v[i];
							if (!(f > 0.02)) continue;
							windows++;
							if (!basket || f > basket.fall) basket = { from: Y[i].year, to: Y[j].year, fall: f, before: v[i], after: v[j] };
						}
					// the extras that fell more than 2 % inside the basket's worst window
					if (basket) {
						const ya = Y.find((y) => y.year === basket.from)?.[key]?.[x], yb = Y.find((y) => y.year === basket.to)?.[key]?.[x];
						basket.windows = windows;
						basket.fell = EXTRAS.filter(([k]) => ya && yb && ya[k] > 0 && yb[k] < ya[k] * 0.98).map(([k, name]) => ({ item: name, change: yb[k] / ya[k] - 1 }));
					}
				}
				const basics = (R.basicsFail ?? []).filter(mine);
				const rise = (R.riseFail ?? []).find(mine) ?? null;
				const noRows = !Y.some((y) => y[key]?.[x]);
				const fail = {};
				for (const k of Object.keys(YARDSTICKS)) fail[k] = noRows || basics.length > 0 || !!rise || (k === 'basket' ? !!basket : falls[k].length > 0);
				rows.push({ by, tenth: x + 1, falls, basket, basics, rise, noRows, fail });
			}
		const failed = Object.fromEntries(Object.keys(YARDSTICKS).map((k) => [k, rows.filter((r) => r.fail[k]).map((r) => `${r.by} tenth ${r.tenth}`)]));
		// the span passes a yardstick when no tenth fails it; after the founding the COOP part counts too
		const pass = Object.fromEntries(Object.keys(YARDSTICKS).map((k) => [k, failed[k].length === 0 && (span === 'founding' || out.coops) && (k !== 'basket' || !!prices)]));
		out[span] = { years: Y.map((y) => y.year), complete: full, judged: { basket: !!prices }, rows, failed, pass };
	}
	// the verdict: after the founding, by P3_VERDICT
	out.pass = !!out.after?.pass[P3_VERDICT];
	out.failedTenths = out.after?.failed[P3_VERDICT] ?? [];
	return out;
}

/**
 * Part 3 of any other world of the suite rejudged by yardstick `k` from its slim result (./experiments.js slimProp3:
 * every fall, the tenths' basics and rise, the COOP part), after the founding: { pass, failedTenths }. The basket needs
 * the run's prices and (b) the full list of excused falls, which a slim result does not keep: both give null.
 */
export function rejudgeSlim(P3, k = P3_VERDICT) {
	const R = P3?.real;
	if (!R || !Array.isArray(R.tenths) || (k !== 'each' && k !== 'taste')) return null;
	const counted = (R.failures ?? []).filter((e) => k === 'each' || !ordersFilled(e.bind));
	const bad = new Set(counted.map((e) => `${e.by} ${e.tenth}`));
	// a tenth ./prop3.js failed with every test passing had no rows in the span (no people)
	const failedTenths = R.tenths.filter((t) => !t.basics || !t.rise || bad.has(`${t.by} ${t.tenth}`) || (!t.pass && t.basics && t.extras && t.rise)).map((t) => `${t.by} tenth ${t.tenth}`);
	return { pass: failedTenths.length === 0 && !!P3.coops?.pass, failedTenths };
}
