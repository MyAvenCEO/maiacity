// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · WAS YOUR GUESS RIGHT? — Primer asks "What do you expect?" before every run; after it, the page says
 * whether the guess the viewer picked came true. Each answer is computed from the two finished worlds, never written
 * down beforehand: a world that behaves differently gives a different answer.
 *
 * Where the answer comes from, first that applies:
 *   1. the experiment's own: a guess written as { text, check(rb, rc, wb, wc) } (./experiments.js), returning true,
 *      false, or null (the run cannot tell);
 *   2. the checks below, matched by the experiment's id and the guess's words: the check written for the most similar
 *      guess, if at least 70 % of the words are the same (so "the owner-only cohort's dividends" and "the owner-only
 *      blobs' dividends" match, while a guess that says something else gets no check); a check that reads a metric
 *      this run does not have answers "cannot tell";
 *   3. none: the page shows the takeaway and leaves the judging to the viewer.
 *
 * rb, rc: the base and changed results (`values` holds each metric); wb, wc: the two worlds, for what a metric does
 * not hold.
 */
import { ENERGY } from './consts.js';
import { PERSON } from './primitives.js';

const rel = (a, b) => (b !== 0 ? a / b - 1 : NaN);

/** the lowest share of the energy basic anyone got on the days of the given shocks (from the daily records) */
function energyMetInShocks(w, kinds) {
	const rec = w.rec;
	let m = Infinity;
	for (const s of w.cfg.shocks ?? []) {
		if (!kinds.includes(s.kind)) continue;
		for (let d = s.day; d < Math.min(rec.n, s.day + (s.days ?? 90)); d++) m = Math.min(m, rec.minMet[d * 4 + ENERGY]);
	}
	return m;
}

/** id → { guess text → check(rb, rc, wb, wc) → true | false | null } */
const CHECKS = {
	X1: {
		'With 20 %, the owner-only cohort’s dividends keep paying their basic bundle through the drought; with 0 % they get no dividends at all.': (rb, rc) => rb.values.strictInDrought >= 1 && !(rc.values.strictInDrought > 0.001),
		'Water gets dearer in both worlds, but nobody goes short of water in either, because every person’s HEARTS half pays the basic bundle many times over.': (rb, rc) => rb.values.waterPeak > 1 && rc.values.waterPeak > 1 && rb.values.shortPD === 0 && rc.values.shortPD === 0,
		'With 0 % the sellers’ treasuries keep the fifth of every sale, so they build more and water stays cheaper.': (rb, rc) => rc.values.waterPeak < rb.values.waterPeak
	},
	X2: {
		'Dividends alone pay the basic bundle after about four months; before that the dividends-only cohort goes short.': (rb, rc) => rb.values.strictFrom >= 60 && rb.values.strictFrom <= 180 && rc.values.ownerShort > 0,
		'Spending some of what it holds, the cohort is never short, from day 1.': (rb) => rb.values.ownerShort === 0,
		'Living on dividends only, the cohort’s holding grows faster, and its dividends with it.': (rb, rc) => rc.values.ownerHoldDays > rb.values.ownerHoldDays
	},
	X9: {
		'Prices in R double; what people get stays the same within 1 %.': (rb, rc, wb, wc, verdict) => {
			const ratios = ['food', 'water', 'energy'].map((g) => rc.values['price_' + g] / rb.values['price_' + g]);
			return ratios.every((x) => x > 1.8 && x < 2.2) && !!verdict?.pass;
		},
		'People get a little more, because more MIND flows into the COOPs and they build sooner.': (rb, rc) => rel(rc.values.Lmean, rb.values.Lmean) > 0.01
	},
	X10: {
		'With surplus energy, decile living standards keep rising; without, they stall.': (rb, rc) => rb.values.Lpoor > rb.values.Lpoor2 * 1.02 && !(rc.values.Lpoor > rc.values.Lpoor2 * 1.02),
		'Without the geothermal stage the winter is short of energy for the basics.': (rb, rc) => rc.values.shortPD > 0
	},
	AB1: {
		'Spring time a person doubles toward its satiation and the mean living standard rises.': (rb, rc) => rc.values.spring >= 0.95 * Math.min(2 * rb.values.spring, PERSON.satiation.spring.v) && rc.values.Lmean > rb.values.Lmean,
		'The poorest decile gains little: it is bound by MIND, not by the spring.': (rb, rc) => rel(rc.values.Lpoor, rb.values.Lpoor) < rel(rc.values.Lmean, rb.values.Lmean)
	},
	SH: {
		'Nobody goes short in any shock; prices rise and fall back.': (rb, rc) => rc.values.shortPD === 0,
		'The dark winter and the failed well cut energy for R&D and extras first; the basics are served first.': (rb, rc, wb, wc) => (wc ? energyMetInShocks(wc, ['darkWinter', 'wellFail']) >= 0.98 : null),
		'Living standards dip in each shock and recover within two years.': (rb, rc) => rc.values.p3 === 1
	}
};

/** a guess's words, lower case, for matching */
const words = (t) => new Set(String(t).toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9%]+/).filter(Boolean));
/** the check written for the guess most like this one (Jaccard similarity of the words ≥ 0.7), or null */
function checkFor(id, text) {
	const w = words(text);
	let best = null, bs = 0.7;
	for (const [t, fn] of Object.entries(CHECKS[id] ?? {})) {
		const v = words(t);
		let both = 0;
		for (const x of w) if (v.has(x)) both++;
		const sim = both / (w.size + v.size - both || 1);
		if (sim >= bs) (bs = sim), (best = fn);
	}
	return best;
}

/** the text of a guess, whether it is written as a sentence or as { text, check } */
export const guessText = (g) => (typeof g === 'string' ? g : g?.text ?? String(g));

/**
 * Judge every guess of an experiment against its finished run: [{ text, right: true | false | null, how }] where
 * `how` says where the answer came from ('experiment', 'page', or 'none').
 */
export function judgeGuesses(exp, rb, rc, wb, wc, verdict) {
	// a metric a check reads that this run does not have makes the answer "cannot tell", never a false "no"
	const strict = (r) => ({ ...r, values: new Proxy(r.values ?? {}, { get: (o, k) => { if (!(k in o) || o[k] === undefined || Number.isNaN(o[k])) throw new Error(`no metric ${String(k)}`); return o[k]; } }) });
	rb = strict(rb);
	rc = strict(rc);
	return (exp.guesses ?? []).map((g) => {
		const text = guessText(g);
		let right = null, how = 'none';
		try {
			if (g && typeof g === 'object' && typeof g.check === 'function') {
				right = g.check(rb, rc, wb, wc);
				how = 'experiment';
			} else if (checkFor(exp.id, text)) {
				how = 'page';
				right = checkFor(exp.id, text)(rb, rc, wb, wc, verdict);
			}
		} catch {
			right = null;
		}
		if (right !== null && right !== undefined) right = !!right;
		else right = null;
		return { text, right, how };
	});
}
