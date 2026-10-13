// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE PROOF SUITE'S SCENARIOS — the world model's section 6 scenarios that test Proposition 3 and
 * "abundance limited only by physics" most directly, as far as the engine supports them.
 *
 * A scenario is a few worlds (`runs`, each a setting change from the defaults and a length in years) and a `judge`
 * that reads their summaries (./experiments.js summarize) and returns { pass, numbers, takeaway, evidence }. The pass
 * condition is the world model's, written before the run; the takeaway is computed from the run. Runs that several
 * scenarios share (the base world of seed 20261012, for one) run once: a run is known by its settings and length.
 *
 *   for (const spec of runSpecs()) results[spec.key] = runWorld(spec);   // in worker threads in the proof script
 *   const v = judge('B28', results);                                     // { pass, numbers, takeaway, evidence }
 *
 * NOT_COVERED lists every section 6 scenario this suite does not run yet, and why. Nothing is skipped silently.
 */
import { exp, log, pow } from './dmath.js';
import { createWorld, step } from './engine.js';
import { hooks, track, summarize } from './experiments.js';

const Y = 365;
const SEEDS = [20261012, 1, 2, 3, 4];
/** every run has the village's 1,500 people; a scenario that tests another number changes this one knob and says so */
const B = { seed: 20261012, people: 1500 };
const RULE_PRICES = ['forward', 'mark0', 'primer'];

/** a run: settings (over the defaults) and years; its key is its identity, so shared runs run once */
const run = (config, years, label) => {
	const c = { ...B, ...config };
	const key = JSON.stringify(Object.keys(c).sort().reduce((o, k) => ((o[k] = c[k]), o), {})) + `@${years}`;
	return { key, config: c, years, label: label ?? describe(config) };
};
const describe = (c) => {
	const ks = Object.keys(c).filter((k) => k !== 'seed' && k !== 'people');
	const s = ks.map((k) => `${k} ${typeof c[k] === 'object' ? JSON.stringify(c[k]) : c[k]}`).join(', ');
	return (c.people && c.people !== 1500 ? `${c.people.toLocaleString('en-US')} people` + (s ? ', ' : '') : '') + (s || (c.seed && c.seed !== B.seed ? `seed ${c.seed}` : 'base'));
};
const base30 = run({}, 30, 'base (seed 20261012)');

const pct = (x, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)} %` : String(x));
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const f0 = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : String(x));
const rel = (a, b) => (b !== 0 ? a / b - 1 : NaN);
const yearOf = (s, y) => s.years[Math.min(s.years.length, y) - 1];
const giniAt = (s, day) => {
	let best = s.monthly[0];
	for (const m of s.monthly) if (Math.abs(m.day - day) < Math.abs(best.day - day)) best = m;
	return best?.gini ?? NaN;
};
/** melt factor a day, and the MIND count a person after n days of 24 HEARTS (melt first, then the HEARTS) */
const fDay = (r) => exp(-r / Y);
const mindExact = (r, n, H = 24) => (H * (1 - pow(fDay(r), n))) / (1 - fDay(r));

/**
 * Why a world failed, computed from its summary: for P1 the basic short on most person-days, its most frequent limit
 * badge and the lowest share of it met; for P2 the strict day and the owner-only cohort's lowest holding; for P3 the
 * deciles that fail and the worst fall.
 */
function causeOf(s) {
	const p = s.prop3, out = [];
	if (!p.P1.pass) {
		const [g, pd] = Object.entries(s.shortBy).sort((a, b) => b[1] - a[1])[0];
		const low = p.P1.lowestShareMet?.[g];
		out.push(`P1 fails: ${f0(pd)} person-days short of ${g}, its most frequent limit ${s.badges[g]?.limit} (${pct(s.badges[g]?.share ?? NaN, 0)} of days), lowest share met ${pct(low?.share ?? NaN)} on day ${low?.day}`);
	}
	if (!p.P2.pass) {
		const hold = p.P2.normal.lowestHoldingDaysByYear ?? [];
		out.push(`P2 fails: strict ${p.P2.strict.holdsEveryDayFrom > 0 ? `from day ${p.P2.strict.holdsEveryDayFrom}` : 'never held to the end'}, normal ${p.P2.normal.pass ? 'pass' : `fail (${p.P2.normal.failures} person-days)`}, the owner-only cohort’s lowest holding ${f2(Math.min(...hold))} days of the bundle`);
	}
	if (!p.P3.pass) out.push(`P3 fails: ${p.P3.failed.length} deciles (worst fall ${pct(Math.max(...p.P3.deciles.map((d) => d.fall ?? 0)))}), without Aven services ${p.P3.withoutCompute.pass ? 'pass' : `${p.P3.withoutCompute.failed.length} fail`}${p.P3.coops.pass ? '' : ', COOP part fails'}`);
	if (!p.abundance.pass) out.push(`MIND bound a basic on ${p.abundance.mindBindsBasics} day-goods (a day and a basic)`);
	return out.join('; ') || 'passes';
}

/** a world's food and border in a row: the diet's land, the people it feeds, food bought, the euros (./records.js) */
function foodRow(s) {
	const fl = s.food ?? {}, B = s.border ?? [], V = s.village ?? [];
	const share = (y) => {
		const v = V[Math.min(V.length, y) - 1];
		return v && v.food.eaten > 0 ? v.food.imported / v.food.eaten : NaN;
	};
	const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
	const full = B.filter((b) => b.days >= 365);
	return {
		diet: fl.diet,
		yields: fl.yields,
		kcalDay: fl.kcalDay,
		proteinDay: fl.proteinDay,
		landOut: fl.landM2?.out,
		landIn: fl.landM2?.in,
		fed: fl.peopleFed?.all,
		firstFed: fl.firstFedYear,
		lastImport: fl.lastImportYear,
		impShare1: share(1),
		impShare10: share(10),
		impShareLast: share(V.length),
		indoorKcal10: V[Math.min(V.length, 10) - 1]?.food.indoors,
		ledKcal10: V[Math.min(V.length, 10) - 1]?.food.led,
		importEurMean: mean(full.map((b) => b.importEur)),
		exportEurMean: mean(full.map((b) => b.exportEur)),
		coverYear: full.find((b) => b.exportsCover)?.year ?? null,
		impShortDays: B.reduce((a, b) => a + (b.importShortDays ?? 0), 0),
		reserve0: s.founding?.reserveEur,
		shortPD: s.shortPD,
		Lmean: s.Lmean,
		poorH: s.poorH
	};
}

// ── the scenarios ────────────────────────────────────────────────────────────────────────────────────────────────
const DROUGHT = { kind: 'drought', day: 3 * Y + 152, days: 92, factor: 0.5 };
const FAIL10 = { kind: 'coopFail', coop: 'AGRI', day: 9 * Y + 300, days: 365, factor: 0.1 };
const GERMANY10 = { kind: 'germany', day: 10 * Y, days: 1 };
const RING = { kind: 'ring', day: Y, days: 300, size: 4 };
const MELTS = [0.03, 0.05, 0.07, 0.1, 0.12];
const PHASE = { melt: [0.03, 0.07, 0.12], law5: [0, 0.1, 0.2, 0.4] };

export const SCENARIOS = [
	{
		id: 'S00',
		name: 'prop3-headline',
		paper: 'abstract, §9.3, Samuel 16:47',
		stress: 'P1, P2, P3 with no shock: the base line',
		claim: 'On every seed, over the world model’s 60 years: nobody below 98 % of a basic after day 0; the owner-only cohort passes the strict test by day 120 and the normal test every day; every decile (by holdings and by Aven output) never falls more than 2 % in a 5-year window and, in every 5-year window, rises or ends within 5 % of the capacity per person; COOPs stay solvent; MIND never binds a basic.',
		runs: SEEDS.map((seed) => run({ seed }, 60, `base, seed ${seed}, 60 years`)),
		judge(R, runs) {
			const rows = runs.map((r) => R[r.key]);
			const share = (s, y, k) => s.prop3.P3.computeShare?.[y - 1]?.[k] ?? NaN;
			const seeds = rows.map((s) => ({ seed: s.seed, P1: s.prop3.P1.pass, shortPD: s.shortPD, strictFrom: s.prop3.P2.strict.holdsEveryDayFrom, P2: s.prop3.P2.pass, P2n: s.prop3.P2.normal.pass, P3: s.prop3.P3.pass, P3failed: s.prop3.P3.failed.length, P3noCompute: s.prop3.P3.withoutCompute.pass, P3noComputeFailed: s.prop3.P3.withoutCompute.failed.length, coops: s.prop3.P3.coops.pass, unpaidShare: s.prop3.P3.coops.unpaidShare, worstFall: Math.max(...s.prop3.P3.deciles.map((d) => d.fall ?? 0)), windowsFailed: s.prop3.P3.deciles.reduce((a, d) => a + (d.windowsFailed ?? 0), 0), computeShare30: share(s, 30, 'all'), computeShareEnd: share(s, s.years.length, 'all'), computeSharePoorEnd: share(s, s.years.length, 'poorest'), mindBinds: s.prop3.abundance.mindBindsBasics, receiverships: s.receiverships.length, poor1: yearOf(s, 1).poorH, poor30: yearOf(s, 30).poorH, poorEnd: s.poorH }));
			const pass = rows.every((s) => s.prop3.pass);
			const n = (f) => seeds.filter(f).length;
			return {
				pass,
				numbers: { seeds },
				takeaway: `Over ${Math.round(rows[0].days / Y)} years Proposition 3 holds on ${n((x) => x.P1 && x.P2 && x.P3)} of ${seeds.length} seeds: P1 on ${n((x) => x.P1)}, P2 on ${n((x) => x.P2)}, P3 on ${n((x) => x.P3)}; without Aven services in the index, P3 holds on ${n((x) => x.P3noCompute)}.`,
				evidence:
					seeds.map((x) => `seed ${x.seed}: P1 ${f0(x.shortPD)} person-days short, strict ${x.strictFrom >= 0 ? `from day ${x.strictFrom}` : 'never held to the end'}, normal ${x.P2n ? 'pass' : 'fail'}, P3 ${x.P3 ? 'pass' : `fail (${x.P3failed} deciles, ${f0(x.windowsFailed)} decile-days in falling windows)`}, P3 without Aven services ${x.P3noCompute ? 'pass' : `fail (${x.P3noComputeFailed})`}, COOPs ${x.coops ? 'pass' : 'fail'}, worst fall ${pct(x.worstFall, 1)}, Aven services ${pct(x.computeShare30, 0)} of the index in year 30 and ${pct(x.computeShareEnd, 0)} in year 60 (${pct(x.computeSharePoorEnd, 0)} for the poorest tenth), MIND binds a basic on ${x.mindBinds} day-goods`).join('; ') +
					'. The strict test is measured from a cold start, where everyone begins with nothing; A07 tests owner-only newcomers joining a settled city.'
			};
		}
	},
	{
		id: 'F01',
		name: 'founding-reserve',
		paper: 'round 3 brief: the founding euros left over',
		stress: 'P1 when the euros run out before exports pay for the imports',
		claim: 'A comparison, not a test: the village founded with no euros left over, with a year of its food at wholesale (the base), and with three years. If the founding euros run out before exports pay for all imports, people go short: this shows whether they do.',
		runs: [run({}, 10, 'base (a year of food in euros), 10 years'), run({ reserveYears: 0 }, 10, 'no founding euros left over'), run({ reserveYears: 3 }, 10, 'three years of food in euros')],
		judge(R, runs) {
			const rows = runs.map((r) => ({ label: r.label, ...foodRow(R[r.key]) }));
			return {
				pass: null,
				comparison: true,
				numbers: { rows },
				takeaway: rows.map((r) => `${r.label}: reserve €${f0(r.reserve0)} at day 0, ${f0(r.impShortDays)} days a COOP could not pay for all its imports, ${f0(r.shortPD)} person-days short of a basic`).join('; ') + '.',
				evidence: rows.map((r) => `${r.label}: exports first paid all imports in year ${r.coverYear ?? 'never'}; food bought ${pct(r.impShare1, 0)} of what was eaten in year 1`).join('; ')
			};
		}
	},
	{
		id: 'F02',
		name: 'old-diet',
		paper: 'Samuel 2026-10-13 06:20',
		stress: 'P1 and the border on another diet',
		claim: 'A comparison, not a test: Samuel’s diet (the base: legumes first, sweet potato and yam, no potatoes or grains, a few chestnuts) against Sandbox 6’s old diet with potatoes and chestnuts, on the same land and yields. The land a person needs follows from the grams of each group and each group’s yield.',
		runs: [base30, run({ diet: 'sandbox6' }, 30, 'Old diet with potatoes and chestnuts')],
		judge(R, runs) {
			const rows = runs.map((r) => ({ label: r.label, ...foodRow(R[r.key]) }));
			return {
				pass: null,
				comparison: true,
				numbers: { rows },
				takeaway: rows.map((r) => `${r.label}: ${f0(r.landOut)} m² a person outdoors and ${f0(r.landIn)} under glass; the 177 ha feed ${f0(r.fed)} people at maturity; food bought ${pct(r.impShare1, 0)} of what was eaten in year 1, ${pct(r.impShare10, 0)} in year 10 and ${pct(r.impShareLast, 0)} in the last year; first grew all it needs (2,240 kcal a person a day) in year ${r.firstFed ?? 'never'}`).join('. ') + '.',
				evidence: rows.map((r) => `${r.label}: ${f0(r.kcalDay)} kcal and ${f2(r.proteinDay)} g protein a day as planned; ${f0(r.shortPD)} person-days short; imports €${f0(r.importEurMean)} a year on average; mean living standard ${f2(r.Lmean)} in the last year`).join('; ')
			};
		}
	},
	{
		id: 'F04',
		name: 'winter-light',
		paper: 'round 3 brief: LED light turns electricity into winter food',
		stress: 'energy as the master resource for food',
		claim: 'A comparison, not a test: the food domes with an LED top-up November to February (12 mol a m² a day, ~400 kWh a 1,000 kcal) against without (the base).',
		runs: [base30, run({ led: true }, 30, 'LED top-up in winter')],
		judge(R, runs) {
			const rows = runs.map((r) => ({ label: r.label, ...foodRow(R[r.key]) }));
			return {
				pass: null,
				comparison: true,
				numbers: { rows },
				takeaway: rows.map((r) => `${r.label}: the domes gave ${f0(r.indoorKcal10)} kcal a person a day in year 10 (LED ${f0(r.ledKcal10)}), food bought ${pct(r.impShare10, 0)} of what was eaten; exports earned €${f0(r.exportEurMean)} a year`).join('; ') + '.',
				evidence: rows.map((r) => `${r.label}: ${f0(r.shortPD)} person-days short; mean living standard ${f2(r.Lmean)}`).join('; ')
			};
		}
	},
	{
		id: 'V01',
		name: 'bed-ladder',
		paper: 'round 3 brief: 250 to 290 people a living hex',
		stress: 'P1–P3 as the village fills its beds',
		claim: 'A comparison, not a test (this scenario changes the population): 250, 260, 270, 280 and 290 people a living hex (1,500 to 1,740, every bed full), on the same village and land.',
		runs: [250, 260, 270, 280, 290].map((n) => (n === 250 ? base30 : run({ people: n * 6 }, 30, `${n} a hex (${(n * 6).toLocaleString('en-US')} people)`))),
		judge(R, runs) {
			const rows = runs.map((r) => {
				const s = R[r.key];
				return { label: r.label, people: s.N0, P1: s.prop3.P1.pass, P3: s.prop3.P3.pass, ...foodRow(s) };
			});
			return {
				pass: null,
				comparison: true,
				numbers: { rows },
				takeaway: rows.map((r) => `${f0(r.people)} people: ${f0(r.shortPD)} person-days short, food bought ${pct(r.impShareLast, 0)} of what was eaten in the last year, imports €${f0(r.importEurMean)} a year, mean living standard ${f2(r.Lmean)}, the poorest tenth ${f2(r.poorH)}`).join('; ') + '.',
				evidence: rows.map((r) => `${f0(r.people)}: P1 ${r.P1 ? 'holds' : 'fails'}, P3 ${r.P3 ? 'holds' : 'fails'}, first fed itself in year ${r.firstFed ?? 'never'}, exports first paid all imports in year ${r.coverYear ?? 'never'}`).join('; ')
			};
		}
	},
	{
		id: 'A04',
		name: 'melt-idle',
		paper: 'Eq. 1–2, Fig. 4, 9',
		stress: '— (mechanics)',
		claim: 'One global melt index: 100 idle MIND keep 49.66 after 10 years; the half-life is 9.90 years; the engine’s index matches e^(−0.07 t) to within 1e-9.',
		runs: [base30],
		judge(R, runs) {
			const s = R[runs[0].key];
			const t = s.days / Y, expect = pow(fDay(0.07), s.days);
			const err = Math.abs(s.meltIndex / expect - 1);
			const ten = 100 * pow(fDay(0.07), 10 * Y);
			return {
				pass: err < 1e-9 && Math.abs(ten - 49.66) < 0.01,
				numbers: { meltIndex: s.meltIndex, expected: expect, relError: err, after10y: ten, halfLifeYears: log(2) / 0.07 },
				takeaway: `After ${f0(t)} years the melt index is ${s.meltIndex.toFixed(6)}, as e^(−0.07 t) says. 100 idle MIND keep ${f2(ten)} after 10 years. The half-life is ${f2(log(2) / 0.07)} years.`,
				evidence: `relative error ${err.toExponential(1)}`
			};
		}
	},
	{
		id: 'A05',
		name: 'steady-state',
		paper: 'Eq. 3, Fig. 6',
		stress: 'P1 and P2 from a start of 0 (cold)',
		claim: 'Money a person follows u/r · (1 − e^(−r t)) exactly (every HEART makes one MIND, everything melts), toward m* = u/r ≈ 125,143.',
		runs: [base30],
		judge(R, runs) {
			const s = R[runs[0].key];
			const exact = mindExact(0.07, s.days), mStar = 24 / (1 - fDay(0.07));
			const err = Math.abs(s.mindPP / exact - 1);
			return {
				pass: err < 1e-9 && Math.abs(mStar / 125143 - 1) < 0.005,
				numbers: { mindPerPerson: s.mindPP, formula: exact, relError: err, mStar, shareOfRest: s.mindPP / mStar, year1: s.monthly.find((m) => m.day >= Y - 30)?.mindPP, year10: s.monthly.find((m) => m.day >= 10 * Y - 30)?.mindPP },
				takeaway: `After 30 years a person’s share of all MIND is ${f0(s.mindPP)}, ${pct(s.mindPP / mStar)} of the resting level ${f0(mStar)}. It matches the closed form to ${err.toExponential(1)}.`,
				evidence: `count ${f0(s.mindPP)} vs formula ${f0(exact)}; m* ${f0(mStar)} vs the paper’s 125,143`
			};
		}
	},
	{
		id: 'A07',
		name: 'newcomers (laborde)',
		paper: '§9.3; P2 for people who arrive later',
		stress: 'P2 strict for an owner-only newcomer',
		claim: 'Thirty owner-only people (no Aven output, nothing held) join the settled village of 1,500 in year 11: they are never short, and their dividends alone pay their basic bundle within 120 days of joining, as the genesis cohort’s do.',
		runs: [run({ newcomers: { day: 10 * Y, n: 30 } }, 20, '1,500 people, 30 owner-only newcomers in year 11')],
		judge(R, runs) {
			const s = R[runs[0].key], nc = s.newcomers;
			if (!nc.ratioByYear) return { pass: false, numbers: { newcomers: nc }, takeaway: 'The run ended before the newcomers joined.', evidence: `the run is ${f0(s.days)} days long; the newcomers join on day ${10 * Y}` };
			const pass = nc.short === 0 && nc.strictFrom >= 0 && nc.strictFrom <= 120;
			return {
				pass,
				numbers: { newcomers: nc, cohortStrictFrom: s.prop3.P2.strict.holdsEveryDayFrom },
				takeaway: nc.strictFrom >= 0 ? `Owner-only newcomers to a settled city lived on dividends alone from day ${f0(nc.strictFrom)} after joining, and were short on ${f0(nc.short)} person-days.` : `Owner-only newcomers to a settled city never lived on dividends alone in their ${nc.ratioByYear.length} years here; they were short on ${f0(nc.short)} person-days.`,
				evidence: `the newcomers’ lowest dividends ÷ basic bundle, by year after joining: ${nc.ratioByYear.map((r) => f2(r)).join(', ')}; the genesis cohort (a cold start) held the strict test from day ${s.prop3.P2.strict.holdsEveryDayFrom}. A newcomer’s dividends grow only as its own HEARTS half builds a holding; the laws give it nothing else, so the strict test is a test of a cold start, not of a newcomer.`
			};
		}
	},
	{
		id: 'B01',
		name: 'main-round-trip (30-year part)',
		paper: '§9.3, Table 3',
		stress: 'P1, P2, P3 at rest',
		claim: 'People own at least 90 % of all MIND (the paper: 94 %). Issued and melted R a person a day are reported (at rest they meet; 30 years is not yet rest).',
		runs: [base30],
		judge(R, runs) {
			const s = R[runs[0].key], ly = s.years[s.years.length - 1];
			return {
				pass: s.own.people >= 0.9,
				numbers: { peopleShare: s.own.people, treasuryShare: s.own.treasuries, poolShare: s.own.pools, issuedPP: ly.issuedPP, meltedPP: ly.meltPP, gini: s.gini },
				takeaway: `People own ${pct(s.own.people)} of all MIND after 30 years; treasuries ${pct(s.own.treasuries)}, pools ${pct(s.own.pools)}. In year 30, ${f2(ly.issuedPP)} R a person a day was issued and ${f2(ly.meltPP)} R melted.`,
				evidence: `holdings Gini ${f2(s.gini)}`
			};
		}
	},
	{
		id: 'B02',
		name: 'hoard vs payout',
		paper: '§9.2, §11.5; plan World 2',
		stress: 'P2s with a smaller ownership; P3',
		claim: 'With treasuries keeping their surplus, people hold far less of all MIND: a gap of at least 50 points (the paper: 94 % vs 30 %).',
		runs: [base30, run({ payout: false }, 30)],
		judge(R, runs) {
			const a = R[runs[0].key], b = R[runs[1].key];
			const gap = a.own.people - b.own.people;
			return {
				pass: gap >= 0.5,
				numbers: { payout: a.own.people, keep: b.own.people, gap, P3keep: b.prop3.P3.pass, strictKeep: b.prop3.P2.strict.holdsEveryDayFrom, poorKeep: b.poorH, poorPayout: a.poorH },
				takeaway: `With payout, people hold ${pct(a.own.people)} of all MIND; when treasuries keep their surplus, ${pct(b.own.people)}. The poorest decile lives at ${f2(a.poorH)} vs ${f2(b.poorH)}.`,
				evidence: `gap ${pct(gap)}; keep world: P1 ${b.prop3.P1.pass ? 'pass' : 'fail'}, P2 ${b.prop3.P2.pass ? 'pass' : 'fail'}, P3 ${b.prop3.P3.pass ? 'pass' : 'fail'}`
			};
		}
	},
	{
		id: 'B03',
		name: 'law5-ladder',
		paper: '§9.2',
		stress: 'P2s: how the strict test moves with the share',
		claim: 'Law 5 shares of 20, 35 and 50 %: the dividend yield on people’s holdings (μ) stays below the 7 % melt in every year after year 2, and Proposition 3 holds at each share.',
		runs: [base30, run({ law5: 0.35 }, 30), run({ law5: 0.5 }, 30)],
		judge(R, runs) {
			const rows = runs.map((r, i) => {
				const s = R[r.key];
				const ys = s.years.slice(2).map((y) => y.yield);
				// the first year from which the yield stays under the melt
				let below = s.years.length + 1;
				for (let y = s.years.length - 1; y >= 0 && s.years[y].yield < 0.07; y--) below = y + 1;
				return { share: [0.2, 0.35, 0.5][i], maxYieldAfter2: Math.max(...ys), belowMeltFromYear: below, yield1: s.years[0].yield, yield5: s.years[4]?.yield, yieldLast: s.years[s.years.length - 1].yield, strictFrom: s.prop3.P2.strict.holdsEveryDayFrom, prop3: s.prop3.pass, poorH: s.poorH, Lmean: s.Lmean };
			});
			const pass = rows.every((r) => r.maxYieldAfter2 < 0.07 && r.prop3);
			return {
				pass,
				numbers: { rows },
				takeaway: rows.map((r) => `At ${pct(r.share, 0)}, the yield was ${pct(r.yield1)} in year 1 and ${pct(r.yieldLast)} in year 30. It stayed under 7 % from year ${r.belowMeltFromYear}.`).join(' ') + ` The strict test held from day ${rows.map((r) => r.strictFrom).join(', ')}.`,
				evidence: rows.map((r) => `${pct(r.share, 0)}: max yield after year 2 ${pct(r.maxYieldAfter2, 2)}, Prop 3 ${r.prop3 ? 'pass' : 'fail'}, poorest holdings decile ${f2(r.poorH)}`).join('; ')
			};
		}
	},
	{
		id: 'B04',
		name: 'aven-spread',
		paper: '§9.2, sim ladder',
		stress: 'P1 for the weakest Avens; P3 per decile',
		claim: 'Ownership inequality rises with the spread of Aven output (the paper: Gini 0.04, 0.33, 0.56 for spreads 0, 0.6, 1.2), and no one is short at any spread.',
		runs: [run({ avenSpread: 0 }, 30), base30, run({ avenSpread: 1.2 }, 30)],
		judge(R, runs) {
			const rows = runs.map((r, i) => ({ spread: [0, 0.6, 1.2][i], gini: R[r.key].gini, P1: R[r.key].prop3.P1.pass, P2: R[r.key].prop3.P2.pass, P3: R[r.key].prop3.P3.pass, poorA: R[r.key].poorA }));
			return {
				pass: rows[0].gini < rows[1].gini && rows[1].gini < rows[2].gini && rows.every((r) => r.P1 && r.P2),
				numbers: { rows },
				takeaway: `The holdings Gini after 30 years is ${rows.map((r) => f2(r.gini)).join(', ')} for spreads ${rows.map((r) => r.spread).join(', ')}. The poorest Aven decile lives at ${rows.map((r) => f2(r.poorA)).join(', ')}.`,
				evidence: rows.map((r) => `spread ${r.spread}: P1 ${r.P1 ? 'pass' : 'fail'}, P2 ${r.P2 ? 'pass' : 'fail'}, P3 ${r.P3 ? 'pass' : 'fail'}`).join('; ')
			};
		}
	},
	{
		id: 'B05',
		name: 'germany-shock',
		paper: '§9.2 Eq. 9, Fig. 12, sim §6.5',
		stress: 'P1 and P2 for the newly poor',
		claim: 'After holdings are made as unequal as Germany’s (Gini 0.72) in year 10, the melt and the equal HEARTS take at least half of the extra inequality away within 10 years (the paper: 0.73 → 0.44), and nobody is short.',
		runs: [run({ shocks: [GERMANY10] }, 20)],
		judge(R, runs) {
			const s = R[runs[0].key], d = GERMANY10.day;
			const before = giniAt(s, d - 30), after = giniAt(s, d + 30), g1 = giniAt(s, d + Y), g5 = giniAt(s, d + 5 * Y), g10 = giniAt(s, d + 10 * Y - 30);
			return {
				pass: after - g10 >= (after - before) / 2 && s.prop3.P1.pass && s.prop3.P2.normal.pass,
				numbers: { before, after, plus1: g1, plus5: g5, plus10: g10, shortPD: s.shortPD },
				takeaway: `The Gini of holdings went from ${f2(before)} to ${f2(after)} with the shock, then ${f2(g1)} after a year, ${f2(g5)} after 5 and ${f2(g10)} after 10. ${f0(s.shortPD)} person-days were short.`,
				evidence: `extra inequality ${f2(after - before)}, gone after 10 years ${f2(after - g10)}; P2 normal ${s.prop3.P2.normal.pass ? 'pass' : 'fail'}`
			};
		}
	},
	{
		id: 'B09',
		name: 'land-rent',
		paper: '§8.1, §11.5 sixth',
		stress: 'P3 for renters',
		claim: 'With all land the City COOP’s, holdings are more equal than with private land paying rent to owners (the paper: Gini 0.29 vs about 0.5).',
		runs: [base30, run({ landRule: 'private' }, 30)],
		judge(R, runs) {
			const a = R[runs[0].key], b = R[runs[1].key];
			const rentPP = a.years[a.years.length - 1].rentR / a.N;
			return {
				pass: a.gini < b.gini && a.prop3.P1.pass,
				numbers: { giniCity: a.gini, giniPrivate: b.gini, rentRPerPersonDay: rentPP, P3private: b.prop3.P3.pass },
				takeaway: `After 30 years the holdings Gini is ${f2(a.gini)} with City land and ${f2(b.gini)} with private land. Ground rent is ${f3(rentPP)} R a person a day, small beside the ${24} HEARTS a day.`,
				evidence: `private-land world: P1 ${b.prop3.P1.pass ? 'pass' : 'fail'}, P3 ${b.prop3.P3.pass ? 'pass' : 'fail'}`
			};
		}
	},
	{
		id: 'B10',
		name: 'food-coop-fails',
		paper: '§9, §11.2, sim §6.2',
		stress: 'P1: the main failure test',
		claim: 'The food forest’s COOP fails (output to 10 % for a year) in the autumn of year 10. With receivership after a failed audit and two food COOPs from genesis, nobody is short (the paper: 0 person-days).',
		runs: [
			run({ shocks: [FAIL10] }, 12, 'two food COOPs, audit exit'),
			run({ shocks: [FAIL10], auditExit: false }, 12, 'two food COOPs, no audit exit'),
			run({ shocks: [FAIL10], coopsOf: { food: 1 } }, 12, 'one food COOP, audit exit'),
			run({ shocks: [FAIL10], coopsOf: { food: 1 }, auditExit: false }, 12, 'one food COOP, no audit exit'),
			run({ shocks: [{ ...FAIL10, coop: 'AGRI1' }], coopsOf: { food: 4 } }, 12, 'four food COOPs (the forest split in two), audit exit')
		],
		judge(R, runs) {
			const rows = runs.map((r) => {
				const s = R[r.key];
				const exit = s.receiverships.find((e) => /^AGRI1?$/.test(e.coop) && e.day >= FAIL10.day);
				return { label: r.label, food: s.shortBy.food, any: s.shortPD, exitAfter: exit ? exit.day - FAIL10.day : -1, P1: s.prop3.P1.pass };
			});
			return {
				pass: rows[0].food === 0,
				numbers: { rows },
				takeaway: rows.map((r) => `${r.label}: ${f0(r.food)} person-days short of food${r.exitAfter >= 0 ? `, receivership after ${r.exitAfter} days` : ''}.`).join(' '),
				evidence: 'the failure starts on day ' + FAIL10.day + ' (late October, the end of the harvest)'
			};
		}
	},
	{
		id: 'B11',
		name: 'founder-ring',
		paper: '§11.2, App. E',
		stress: 'P3: others unaffected',
		claim: 'A ring of four founders whose COOP makes nothing draws HEARTS when Avens follow pool prices; when Avens follow delivered output, it gets no more than its share of the people (the paper: 3.84 % vs 1.60 %).',
		runs: [run({ allocBy: 'output', shocks: [RING] }, 2, 'output rule, ring'), run({ allocBy: 'price', shocks: [RING] }, 2, 'price rule, ring')],
		judge(R, runs) {
			const a = R[runs[0].key].ring, b = R[runs[1].key].ring;
			return {
				pass: a.share < b.share && a.share <= a.people,
				numbers: { outputShare: a.share, priceShare: b.share, ringPeople: a.people, wealthOutput: a.wealth1, wealthPrice: b.wealth1, diedOutput: a.died, diedPrice: b.died },
				takeaway: `The ring is ${pct(a.people)} of the people. Following delivered output, Avens sent it ${pct(a.share, 2)} of others’ HEARTS; following pool prices, ${pct(b.share, 2)}.`,
				evidence: `ring members’ holding ÷ others’: ${f2(a.wealth1)} (output) vs ${f2(b.wealth1)} (price)`
			};
		}
	},
	{
		id: 'B14',
		name: 'cold-start',
		paper: '§9.3, §11.4, sim §6.1',
		stress: 'P1 and P2 on day 1',
		claim: 'Bootstrap: 0 person-days short from day 0. Without it (empty pools on day 0), most people are short at first (the paper: 94 %). An empty city at 25 % of capacity: the badge shows a physical limit, never MIND.',
		runs: [base30, run({ bootstrap: false }, 2, 'no bootstrap'), run({ fieldPeople: 375 }, 10, 'empty village: capital for 375 people, 1,500 people')],
		judge(R, runs) {
			const a = R[runs[0].key], b = R[runs[1].key], c = R[runs[2].key];
			return {
				pass: a.short0 === 0 && a.prop3.P1.pass && c.prop3.abundance.pass,
				numbers: { bootstrapDay0: a.short0, noBootstrapDay0: b.short0, noBootstrapDay1: b.short1, noBootstrapYear1: b.years[0].short, emptyCityShortPD: c.shortPD, emptyCityMindBinds: c.prop3.abundance.mindBindsBasics, emptyCityLimits: c.shortByLimit },
				takeaway: `With the bootstrap, ${pct(a.short0)} of people are short on day 0. Without it, ${pct(b.short0)} on day 0 and ${pct(b.short1)} on day 1. In an empty city, MIND bound a basic on ${c.prop3.abundance.mindBindsBasics} day-goods (a day and a basic); ${f0(c.shortPD)} person-days were short, all for physical limits.`,
				evidence: `empty city short days by limit: ${JSON.stringify(c.shortByLimit)}`
			};
		}
	},
	{
		id: 'B15',
		name: 'pop-growth',
		paper: '§5.2, sim §6.4, §9.3',
		stress: 'P1 and P2 for newcomers; P3 on fixed land',
		claim: '1,500 people growing 2 % a year on the village’s fixed land (this scenario changes the population): newcomers (first 3 years) are never short, and ground rent rises.',
		runs: [base30, run({ popGrowth: 0.02, maxYears: 30 }, 30)],
		judge(R, runs) {
			const a = R[runs[0].key], s = R[runs[1].key];
			const r0 = s.years[0].rent, r1 = s.years[s.years.length - 1].rent, ra = a.years[a.years.length - 1].rent;
			return {
				pass: s.newcomers.short === 0 && r1 > ra,
				numbers: { N: s.N, newcomerPD: s.newcomers.pd, newcomerShort: s.newcomers.short, shortPD: s.shortPD, shortBy: s.shortBy, shortByLimit: s.shortByLimit, rentYear1: r0, rentEnd: r1, rentBase: ra, mindPP: s.mindPP, gini: s.gini },
				takeaway: `The village grew from 1,500 to ${f0(s.N)}. Newcomers were short on ${f0(s.newcomers.short)} of ${f0(s.newcomers.pd)} person-days in their first three years; everyone, ${f0(s.shortPD)}. Ground rent went from ${r0.toExponential(2)} to ${r1.toExponential(2)} R a m² a day.`,
				evidence: `short days by limit: ${JSON.stringify(s.shortByLimit)}; constant population rent ${ra.toExponential(2)}`
			};
		}
	},
	{
		id: 'B17',
		name: 'bad-coop-exit',
		paper: '§7, Fig. 11, Hirschman',
		stress: 'P1 if it sold basics',
		claim: 'A COOP that delivers 50 % less per HEART (GOODS-A, from year 3) loses at least half its HEARTS inflow within 60 days, without any vote.',
		runs: [run({ shocks: [{ kind: 'coopFail', coop: 'GOODS-A', day: 2 * Y, days: 365, factor: 0.5 }] }, 4)],
		judge(R, runs) {
			const s = R[runs[0].key], d = 2 * Y;
			const at = (day) => {
				let best = s.coopHearts[0];
				for (const m of s.coopHearts) if (Math.abs(m.day - day) < Math.abs(best.day - day)) best = m;
				return best.share['GOODS-A'] ?? 0;
			};
			const before = at(d - 1), after60 = at(d + 60), after180 = at(d + 180);
			return {
				pass: after60 <= 0.5 * before,
				numbers: { before, after60, after180, shortPD: s.shortPD },
				takeaway: `GOODS-A drew ${pct(before, 2)} of all HEARTS before it slipped, ${pct(after60, 2)} 60 days later and ${pct(after180, 2)} after 180 days.`,
				evidence: `${f0(s.shortPD)} person-days short`
			};
		}
	},
	{
		id: 'B22',
		name: 'rate-sweep',
		paper: '§11.5, §5.3',
		stress: 'where P2 and P3 break',
		claim: 'For melts of 3 to 12 %, money a person follows u/r · (1 − e^(−r t)) exactly, the holdings Gini falls as the rate rises, and Proposition 3 holds at each rate (15 years).',
		runs: MELTS.map((m) => run({ melt: m }, 15)),
		judge(R, runs) {
			const rows = runs.map((r, i) => {
				const s = R[r.key], m = MELTS[i];
				return { melt: m, mindErr: Math.abs(s.mindPP / mindExact(m, s.days) - 1), mStar: 24 / (1 - fDay(m)), mindPP: s.mindPP, gini: s.gini, P1: s.prop3.P1.pass, P2: s.prop3.P2.pass, P3: s.prop3.P3.pass, poorH: s.poorH };
			});
			const falling = rows.every((r, i) => i === 0 || r.gini <= rows[i - 1].gini + 0.005);
			return {
				pass: rows.every((r) => r.mindErr < 1e-9 && r.P1 && r.P2 && r.P3) && falling,
				numbers: { rows },
				takeaway: rows.map((r) => `At ${pct(r.melt, 0)}: Gini ${f2(r.gini)}, poorest decile ${f2(r.poorH)}, Prop 3 ${r.P1 && r.P2 && r.P3 ? 'holds' : 'fails'}.`).join(' '),
				evidence: rows.map((r) => `${pct(r.melt, 0)}: money a person ${f0(r.mindPP)} (formula error ${r.mindErr.toExponential(1)}), P1 ${r.P1 ? 'pass' : 'fail'}, P2 ${r.P2 ? 'pass' : 'fail'}, P3 ${r.P3 ? 'pass' : 'fail'}`).join('; ') + `; Gini ${falling ? 'falls' : 'does not fall'} with the rate`
			};
		}
	},
	{
		id: 'B26',
		name: 'demand-pricing-basics',
		paper: 'Samuel; Primer article',
		stress: 'P1, P2n under scarcity prices',
		claim: 'In a drought (rain −50 % for a summer, year 4) with fully dynamic prices: 0 person-days short while physical supply covers need, the poorest limit bar stays above the water price, and the badge never reads MIND for water. Run with each price rule.',
		runs: RULE_PRICES.map((p) => run({ priceRule: p, shocks: [DROUGHT] }, 6, `${p} price, drought`)),
		judge(R, runs) {
			const rows = runs.map((r, i) => {
				const s = R[r.key];
				return { rule: RULE_PRICES[i], shortPD: s.shortPD, water: s.shortBy.water, bar: s.limitMinWater, mindBinds: s.prop3.abundance.mindBindsBasics, swingWater: s.swing.water };
			});
			const f = rows[0];
			return {
				pass: f.shortPD === 0 && f.bar > 1 && f.mindBinds === 0,
				numbers: { rows },
				takeaway: rows.map((r) => `${r.rule}: ${f0(r.shortPD)} person-days short, lowest water bar ${f2(r.bar)}× the price, MIND bound a basic on ${r.mindBinds} day-goods.`).join(' '),
				evidence: rows.map((r) => `${r.rule}: water price swing ${pct(r.swingWater, 2)} a day`).join('; ')
			};
		}
	},
	{
		id: 'B27',
		name: 'innovation-energy',
		paper: 'Samuel 16:59',
		stress: 'P3: the growth test',
		claim: 'With surplus energy and R&D, every decile’s living standard rises and recipes improve; without R&D they stall; without geothermal, winter energy binds. No recipe ever passes its physical floor.',
		runs: [base30, run({ rd: false }, 30), run({ geothermal: false }, 30), run({ rd: false, geothermal: false }, 30)],
		judge(R, runs) {
			const lab = ['R&D and geothermal', 'no R&D', 'no geothermal', 'neither'];
			const rows = runs.map((r, i) => {
				const s = R[r.key];
				return { label: lab[i], learn: s.learn, floorMargin: s.floorMargin, Lmean: s.Lmean, poorH: s.poorH, poorA1: s.years[1]?.poorA, poorA: s.poorA, P3: s.prop3.P3.pass, shortPD: s.shortPD, ePP: s.years[s.years.length - 1].ePP, surplusPP: s.years[s.years.length - 1].surplusPP };
			});
			return {
				pass: rows[0].P3 && rows[0].learn > 0 && rows[1].learn === 0 && rows[0].Lmean > rows[1].Lmean && rows[0].Lmean > rows[3].Lmean && rows.every((r) => r.floorMargin >= 0),
				numbers: { rows },
				takeaway: rows.map((r) => `${r.label}: mean living standard ${f2(r.Lmean)}, poorest decile ${f2(r.poorA)}, innovation ${pct(r.learn)} of the way to the floors, ${f2(r.ePP)} kWh a person a day.`).join(' '),
				evidence: rows.map((r) => `${r.label}: P3 ${r.P3 ? 'pass' : 'fail'}, ${f0(r.shortPD)} person-days short, smallest margin above a floor ${f3(r.floorMargin)}`).join('; ')
			};
		}
	},
	{
		id: 'B28',
		name: 'physics-only',
		paper: 'Samuel 16:52',
		stress: 'P3: only physics raises it',
		claim: 'Doubling HEARTS changes only prices (real consumption of every good within ±1 %), with the Aven rate card in R indexed to the HEARTS issued a day (the default: the card doubles with HEARTS a day, as every nominal anchor indexed to them does; the run with the card fixed in R is reported beside it). Doubling a binding physical limit raises living standards; doubling a limit that does not bind changes little.',
		runs: [base30, run({ heartsPerDay: 48 }, 30), run({ springSites: 4 }, 30), run({ geoStages: 2 }, 30), run({ landHa: 90 }, 30), run({ heartsPerDay: 48, rateIndexed: false }, 30, '48 HEARTS, rate card fixed in R')],
		judge(R, runs) {
			const b = R[runs[0].key], h = R[runs[1].key];
			const cons = Object.keys(b.consRun).map((g) => [g, rel(h.consRun[g], b.consRun[g])]);
			const worst = cons.reduce((m, r) => (Math.abs(r[1]) > Math.abs(m[1]) ? r : m), ['', 0]);
			const prices = Object.keys(b.priceRun).map((g) => [g, h.priceRun[g] / b.priceRun[g]]);
			const heartsOk = cons.every((r) => Math.abs(r[1]) <= 0.01);
			// which limits bound in the base world (share of days, all goods)
			// a limit binds when it is a good's badge on at least a tenth of the days
			// a limit is read as binding only on the goods it can lift: the spring sites lift spring time (nature),
			// geothermal stages lift whatever energy binds, land lifts whatever land or timber land (logs) binds. Rain
			// reads 'nature' too, but more ponds bring no rain
			const lim = (names, goods) => Object.entries(b.badgeShares).filter(([g]) => !goods || goods.includes(g)).flatMap(([g, sh]) => Object.entries(sh).filter(([l, x]) => names.some((n) => l.startsWith(n)) && x >= 0.1).map(([l, x]) => `${g} (${l}) ${pct(x, 0)}`));
			const dbl = [
				{ what: 'hot-spring sites ×2', s: R[runs[2].key], where: lim(['nature'], ['spring']) },
				{ what: 'geothermal stages ×2', s: R[runs[3].key], where: lim(['energy']) },
				{ what: 'land ×2', s: R[runs[4].key], where: lim(['land', 'material: logs']) }
			].map((d) => ({ ...d, binding: d.where.length > 0, bindsWhere: d.where })).map((d) => ({ what: d.what, binding: d.binding, bindsWhere: d.bindsWhere, Lmean: d.s.Lmean, change: rel(d.s.Lmean, b.Lmean), poorChange: rel(d.s.poorA, b.poorA), P1: d.s.prop3.P1.pass }));
			const physOk = dbl.filter((d) => d.binding).every((d) => d.change > 0);
			// sensitivity: the rate card not doubled with HEARTS
			const fx = R[runs[5].key];
			const consFx = Object.keys(b.consRun).map((g) => [g, rel(fx.consRun[g], b.consRun[g])]);
			const worstFx = consFx.reduce((m, r) => (Math.abs(r[1]) > Math.abs(m[1]) ? r : m), ['', 0]);
			return {
				pass: heartsOk && physOk && dbl.some((d) => d.binding),
				numbers: { worstConsChange: worst, prices, doublings: dbl, fixedCard: { worstConsChange: worstFx, LmeanChange: rel(fx.Lmean, b.Lmean), P1: fx.prop3.P1.pass } },
				takeaway: `With 48 HEARTS a day, prices in R rose about ×${f2(prices.find((p) => p[0] === 'water')[1])} and real consumption changed by at most ${pct(worst[1], 2)} (${worst[0]}). ` + dbl.map((d) => `${d.what} (${d.binding ? 'binding' : 'not binding'}): mean living standard ${pct(d.change, 2)}.`).join(' '),
				evidence: `base badges: ${dbl.map((d) => `${d.what}: ${d.bindsWhere.join(', ') || 'none'}`).join('; ')}; consumption changes with 48 HEARTS: ${cons.map((r) => `${r[0]} ${pct(r[1], 2)}`).join(', ')}. With the rate card fixed in R instead, 48 HEARTS change real consumption by up to ${pct(worstFx[1], 1)} (${worstFx[0]}) and the mean living standard by ${pct(rel(fx.Lmean, b.Lmean), 1)}: neutrality holds because every nominal anchor is indexed to the HEARTS issued a day.`
			};
		}
	},
	{
		id: 'B23',
		name: 'euro-border',
		paper: 'world model 9 (the border); paper §11.4 (the euro reserve)',
		stress: 'P3: Aven services without a chip fab',
		claim: 'The base city trades across the border as COOPs only (paper §11.4): a COMPUTE COOP buys electricity from the energy COOPs, the line exports it, the euros go into that COOP’s own account in the euro reserve, and the reserve buys accelerators with them; no person redeems MIND and no MIND is made from euros. The closed city (the counter-case) cannot make or import accelerators, so its Aven services wear away with them. The open city keeps more Aven services than the closed one, nobody is short of a basic in any of the three worlds, when accelerators cost three times as much from year 10 the reserve buys fewer, and Proposition 3 (P1–P3) holds through that import price shock (the world model’s target for B23).',
		runs: [base30, run({ chipImport: false }, 30, 'closed city (no border)'), run({ shocks: [{ kind: 'importPrice', day: 3650, days: 7300, factor: 3 }] }, 30, 'border open, accelerators 3× dearer from year 10')],
		judge(R, runs) {
			const [o, c, d] = runs.map((r) => R[r.key]);
			const rows = [o, c, d].map((s, i) => ({ label: runs[i].label, seed: s.seed, years: runs[i].years, computeRun: s.consRun.compute, computeLast: s.consLast.compute, exportMwh: s.exportMwh ?? 0, chipsIn: s.chipsIn ?? 0, shortPD: s.shortPD, Lmean: s.Lmean, P3: s.prop3.P3.pass, P3failed: s.prop3.P3.failed.length }));
			const more = o.consRun.compute > c.consRun.compute;
			const fewer = (d.chipsIn ?? 0) < (o.chipsIn ?? 0);
			const noShort = [o, c, d].every((s) => s.shortPD === 0);
			// the world model's target (its scenario table, B23): Proposition 3 holds through the import price shock
			const shockP3 = d.prop3.P1.pass && d.prop3.P2.pass && d.prop3.P3.pass;
			return {
				pass: more && fewer && noShort && shockP3,
				numbers: { rows },
				takeaway:
					rows.map((r) => `${r.label}: Aven services ${f2(r.computeRun)} h a person a day over the run (${f2(r.computeLast)} in the last year), ${f0(r.exportMwh)} MWh exported for ${f0(r.chipsIn)} accelerators, ${f0(r.shortPD)} person-days short of a basic; mean living standard ${f2(r.Lmean)} in the last year, P3 ${r.P3 ? 'holds' : `fails (${r.P3failed} of 20 deciles)`}.`).join(' ') +
					` Accelerators three times dearer cut the mean living standard by ${pct(1 - rows[2].Lmean / rows[0].Lmean)} and Aven services in the last year by ${pct(1 - rows[2].computeLast / Math.max(1e-12, rows[0].computeLast))}.`,
				evidence: `${more ? 'the open border kept more Aven services than the closed city' : 'the open border did not keep more Aven services than the closed city'}; ${fewer ? 'dearer accelerators: the reserve bought fewer' : 'dearer accelerators: the reserve did not buy fewer'}; ${noShort ? 'no basic short in any world' : 'a basic was short'}; through the import price shock Proposition 3 ${shockP3 ? 'holds' : `fails (P1 ${d.prop3.P1.pass ? 'pass' : 'fail'}, P2 ${d.prop3.P2.pass ? 'pass' : 'fail'}, P3 ${d.prop3.P3.pass ? 'pass' : 'fail'})`}.`
			};
		}
	},
	{
		id: 'B29',
		name: 'binding-limit',
		paper: 'world model 5.5',
		stress: 'P1 in winter; P3 for growth',
		claim: '300, 600 and 1,500 people in the village built for 1,500 (this scenario changes the population), without and with the geothermal stages: every short basic day is bound by a physical limit (never MIND), and fewer people are short less.',
		runs: [300, 600, 1500].flatMap((n) => [run({ people: n, geothermal: false }, 30, `${n.toLocaleString('en-US')} people, no geothermal`), n === 1500 ? base30 : run({ people: n }, 30, `${n} people, geothermal`)]),
		judge(R, runs) {
			const rows = runs.map((r) => {
				const s = R[r.key];
				const top = Object.fromEntries(Object.entries(s.badges).map(([g, x]) => [g, `${x.limit} ${pct(x.share, 0)}`]));
				return { label: r.label, shortPD: s.shortPD, shortPP: s.shortPD / s.N, mindBinds: s.prop3.abundance.mindBindsBasics, byLimit: s.shortByLimit, top, Lmean: s.Lmean };
			});
			const noPad = rows.filter((_, i) => i % 2 === 0);
			return {
				pass: rows.every((r) => r.mindBinds === 0) && noPad[0].shortPP <= noPad[1].shortPP && noPad[1].shortPP <= noPad[2].shortPP,
				numbers: { rows },
				takeaway: rows.map((r) => `${r.label}: ${f0(r.shortPD)} person-days short (${JSON.stringify(r.byLimit)}), MIND bound a basic on ${r.mindBinds} day-goods.`).join(' '),
				evidence: rows.map((r) => `${r.label}: most frequent limits ${Object.entries(r.top).filter(([g]) => !['food', 'water', 'energy', 'bed'].includes(g)).map(([g, x]) => `${g} ${x}`).join(', ')}`).join('; ')
			};
		}
	},
	{
		id: 'B30',
		name: 'price-rule-baseline',
		paper: 'Primer article',
		stress: 'P1 under each price rule',
		claim: 'The forward-margin price beats Primer’s adaptive baseline and Mark-0 per person: no more person-days short and smaller price swings. Where it does not, the report says so.',
		runs: RULE_PRICES.map((p) => (p === 'forward' ? base30 : run({ priceRule: p }, 30, `${p} price`))),
		judge(R, runs) {
			const rows = runs.map((r, i) => {
				const s = R[r.key];
				const sw = Object.values(s.swing).reduce((a, x) => a + x, 0) / 4;
				return { rule: RULE_PRICES[i], shortPD: s.shortPD, swing: sw, poorA: s.poorA, Lmean: s.Lmean, P3: s.prop3.P3.pass, receiverships: s.receiverships.length };
			});
			const f = rows[0];
			const beats = rows.slice(1).map((r) => ({ rule: r.rule, shorter: f.shortPD <= r.shortPD, calmer: f.swing <= r.swing, poorer: f.poorA < r.poorA }));
			return {
				pass: beats.every((x) => x.shorter && x.calmer),
				numbers: { rows, beats },
				takeaway: rows.map((r) => `${r.rule}: ${f0(r.shortPD)} person-days short, basics swing ${pct(r.swing, 2)} a day, poorest decile ${f2(r.poorA)}.`).join(' '),
				evidence: beats.map((x) => `vs ${x.rule}: ${x.shorter ? 'no more' : 'more'} shortage, ${x.calmer ? 'smaller' : 'larger'} swings${x.poorer ? ', but a poorer bottom decile' : ''}`).join('; ')
			};
		}
	},
	{
		id: 'B31',
		name: 'competition-surplus',
		paper: 'Primer article, §9',
		stress: 'P1 with one seller',
		claim: 'With more sellers per good, buyers keep more of the surplus: basics sell closer to cost and sellers keep less of the revenue (1, 2, 4 COOPs per good). With one seller the four market conditions fail.',
		runs: [run({ coopsPerGood: 1 }, 30, 'one COOP per good'), base30, run({ coopsPerGood: 4 }, 30, 'four COOPs per good')],
		judge(R, runs) {
			const mk = (s) => {
				let rev = 0, n = 0;
				for (const y of s.years) if (Number.isFinite(y.markup)) (rev += y.markup), n++;
				let sh = 0, m = 0;
				for (const y of s.years) if (Number.isFinite(y.sellerShare)) (sh += y.sellerShare), m++;
				return { markup: rev / n, sellerShare: sh / m };
			};
			const rows = runs.map((r, i) => ({ per: [1, 2, 4][i], ...mk(R[r.key]), shortPD: R[r.key].shortPD, poorA: R[r.key].poorA, P3: R[r.key].prop3.P3.pass }));
			return {
				pass: rows[0].markup > rows[1].markup && rows[1].markup >= rows[2].markup && rows[0].sellerShare > rows[1].sellerShare && rows[1].shortPD === 0,
				numbers: { rows },
				takeaway: rows.map((r) => `${r.per} per good: basics at ${f2(r.markup)}× full cost, sellers keep ${pct(r.sellerShare)} above variable cost, poorest decile ${f2(r.poorA)}.`).join(' '),
				evidence: rows.map((r) => `${r.per}: ${f0(r.shortPD)} person-days short, P3 ${r.P3 ? 'pass' : 'fail'}`).join('; ')
			};
		}
	},
	{
		id: 'B32',
		name: 'world-1',
		paper: 'plan: World 1',
		stress: 'P1–P3 at game size',
		claim: 'Ten citizens in a village sized for them (this scenario changes the population and the village), 3 years: Proposition 3 holds and both ledgers close.',
		runs: [run({ people: 10, fieldPeople: 10 }, 3, '10 people, a village for 10')],
		judge(R, runs) {
			const s = R[runs[0].key];
			const leaks = s.ledger.mindLeaks.length + s.ledger.matterLeaks.length + s.ledger.energyLeaks.length;
			return {
				pass: s.prop3.pass && leaks === 0,
				numbers: { P1: s.prop3.P1.pass, P2: s.prop3.P2.pass, P3: s.prop3.P3.pass, failed: s.prop3.P3.failed, leaks, owners: s.owners },
				takeaway: `With 10 people, P1 ${s.prop3.P1.pass ? 'holds' : 'fails'}, P2 ${s.prop3.P2.pass ? 'holds' : 'fails'} (${s.owners} owner-only), P3 ${s.prop3.P3.pass ? 'holds' : 'fails'}. The ledgers had ${leaks} leaks.`,
				evidence: `P3 failing: ${s.prop3.P3.failed.join(', ') || 'none'}`
			};
		}
	},
	{
		id: 'S01',
		name: 'prop3-phase',
		paper: 'Mark-0’s method',
		stress: 'where each part breaks',
		claim: 'A grid of melt (3, 7, 12 %) and Law 5 share (0, 10, 20, 40 %), 1,500 people, 10 years: the paper’s point (7 %, 20 %) and its four neighbours (3 % and 12 % melt; 10 % and 40 % share) keep Proposition 3. A share of 0 pays no dividends, so it cannot pass the strict test; it marks the edge.',
		runs: PHASE.melt.flatMap((m) => PHASE.law5.map((l) => run({ melt: m, law5: l }, 10, `melt ${pct(m, 0)}, Law 5 ${pct(l, 0)}`))),
		judge(R, runs) {
			const grid = runs.map((r) => ({ melt: r.config.melt, law5: r.config.law5, pass: R[r.key].prop3.pass, P1: R[r.key].prop3.P1.pass, P2: R[r.key].prop3.P2.pass, P3: R[r.key].prop3.P3.pass, strictFrom: R[r.key].prop3.P2.strict.holdsEveryDayFrom, cause: causeOf(R[r.key]) }));
			const at = (m, l) => grid.find((g) => g.melt === m && g.law5 === l);
			const centre = at(0.07, 0.2), nb = [at(0.03, 0.2), at(0.12, 0.2), at(0.07, 0.1), at(0.07, 0.4)];
			const cell = (g) => `${g.P1 ? '1' : '·'}${g.P2 ? '2' : '·'}${g.P3 ? '3' : '·'}`;
			return {
				pass: centre.pass && nb.every((g) => g.pass),
				numbers: { grid },
				takeaway: `Parts that hold at each point (1, 2, 3; · fails), melt down, Law 5 across: ` + PHASE.melt.map((m) => `${pct(m, 0)}: ${PHASE.law5.map((l) => cell(at(m, l))).join(' ')}`).join('; ') + '.',
				evidence: grid.filter((g) => !g.pass).map((g) => `melt ${pct(g.melt, 0)}, Law 5 ${pct(g.law5, 0)}: ${g.cause}`).join('; ') || 'every point passes'
			};
		}
	},
	{
		id: 'S02',
		name: 'forest-yield',
		paper: 'catalog: the food forest’s yield (the riskiest estimate)',
		stress: 'P1 for food when the forest gives half or one and a half times the catalog’s figure',
		claim: 'With the food forest’s yield at half and at one and a half times the catalog’s figure, nobody is ever below 98 % of a basic after day 0 (30 years).',
		runs: [run({ forestYield: 0.5 }, 30, 'forest yield ×0.5'), base30, run({ forestYield: 1.5 }, 30, 'forest yield ×1.5')],
		judge(R, runs) {
			const rows = runs.map((r, i) => {
				const s = R[r.key];
				return { yield: [0.5, 1, 1.5][i], byLimit: s.shortByLimit, P1: s.prop3.P1.pass, shortPD: s.shortPD, shortPP: s.shortPD / s.N, food: s.shortBy.food, foodBadge: s.badges.food, lowestFood: s.prop3.P1.lowestShareMet?.food, P3: s.prop3.P3.pass, P3noCompute: s.prop3.P3.withoutCompute.pass, Lmean: s.Lmean };
			});
			return {
				pass: rows.every((r) => r.P1),
				numbers: { rows },
				takeaway: rows.map((r) => `At ×${r.yield}, ${f0(r.shortPD)} person-days short (${f0(r.food)} of food).`).join(' '),
				evidence: rows.map((r) => `×${r.yield}: P1 ${r.P1 ? 'pass' : 'fail'}, ${f2(r.shortPP)} short days a person, short days by limit ${JSON.stringify(r.byLimit)}, food’s most frequent limit ${r.foodBadge.limit} (${pct(r.foodBadge.share, 0)} of days), lowest share of food met ${pct(r.lowestFood?.share ?? NaN)} on day ${r.lowestFood?.day}, P3 ${r.P3 ? 'pass' : 'fail'} (without Aven services ${r.P3noCompute ? 'pass' : 'fail'})`).join('; ')
			};
		}
	},
	{
		id: 'S03',
		name: 'small-cities',
		paper: 'Proposition 3 at the page’s size',
		stress: 'P1–P3 with 300 and 600 people in a village sized for them, and 1,500 people through a year 30 % drier',
		claim: 'Proposition 3 holds for 300 and 600 people in a village sized for them (this scenario changes the population and the village), and for the 1,500 through a year with 30 % less rain (year 4), over 30 years.',
		runs: [run({ people: 300, fieldPeople: 300 }, 30, '300 people, a village for 300'), run({ people: 600, fieldPeople: 600 }, 30, '600 people, a village for 600'), run({ shocks: [{ kind: 'drought', day: 3 * Y, days: Y, factor: 0.7 }] }, 30, '1,500 people, a year 30 % drier')],
		judge(R, runs) {
			const rows = runs.map((r) => {
				const s = R[r.key], p = s.prop3;
				return { label: r.label, P1: p.P1.pass, shortPD: s.shortPD, strictFrom: p.P2.strict.holdsEveryDayFrom, P2: p.P2.pass, P3: p.P3.pass, P3failed: p.P3.failed.length, P3noCompute: p.P3.withoutCompute.pass, coops: p.P3.coops.pass, worstFall: Math.max(...p.P3.deciles.map((d) => d.fall ?? 0)), pass: p.pass };
			});
			return {
				pass: rows.every((r) => r.pass),
				numbers: { rows },
				takeaway: rows.map((r) => `${r.label}: Proposition 3 ${r.pass ? 'holds' : 'fails'} (P1 ${r.P1 ? 'pass' : 'fail'}, P2 ${r.P2 ? 'pass' : 'fail'}, P3 ${r.P3 ? 'pass' : 'fail'}).`).join(' '),
				evidence: rows.map((r) => `${r.label}: ${f0(r.shortPD)} person-days short, strict ${r.strictFrom >= 0 ? `from day ${r.strictFrom}` : 'never held to the end'}, ${r.P3failed} deciles fail P3, P3 without Aven services ${r.P3noCompute ? 'pass' : 'fail'}, COOPs ${r.coops ? 'pass' : 'fail'}, worst fall ${pct(r.worstFall, 1)}`).join('; ')
			};
		}
	},
	{
		id: 'S04',
		name: 'seed-ensemble',
		paper: 'Proposition 3, P1 and P2, beyond the five base seeds',
		stress: 'P1 and P2 on seeds chosen before the run, at the page’s size and the base size',
		claim: 'P1 and P2 (strict and normal) hold on every world of an ensemble fixed before the run: seeds 5 to 9 with the 1,500 people (seeds 1 to 4 are in S00), each over 60 years. P3 is reported for each world, not judged here (S00 judges it).',
		runs: [5, 6, 7, 8, 9].map((seed) => run({ seed }, 60, `1,500 people, seed ${seed}`)),
		judge(R, runs) {
			const rows = runs.map((r) => {
				const s = R[r.key], p = s.prop3;
				return { label: r.label, P1: p.P1.pass, shortPD: s.shortPD, strictFrom: p.P2.strict.holdsEveryDayFrom, strict: p.P2.strict.pass, normal: p.P2.normal.pass, runsOut: p.P2.normal.runsOutInYears, P3: p.P3.pass, P3failed: p.P3.failed.length, worstFall: Math.max(...p.P3.deciles.map((d) => d.fall ?? 0)), mindBinds: p.abundance.mindBindsBasics, receiverships: s.receiverships.length, pass: p.P1.pass && p.P2.pass };
			});
			const n = (f) => rows.filter(f).length;
			const failing = rows.filter((r) => !r.pass).map((r) => r.label);
			return {
				pass: failing.length === 0,
				numbers: { rows },
				takeaway: `Of ${rows.length} worlds, P1 holds on ${n((r) => r.P1)}, P2 strict on ${n((r) => r.strict)}, P2 normal on ${n((r) => r.normal)}, P3 on ${n((r) => r.P3)}${failing.length ? `; P1 or P2 fails on ${failing.join(', ')}` : ''}.`,
				evidence: rows.map((r) => `${r.label}: ${f0(r.shortPD)} person-days short, strict ${r.strictFrom >= 0 ? `from day ${f0(r.strictFrom)}` : 'never held to the end'}${r.strict ? '' : ' (fail)'}, normal ${r.normal ? 'pass' : 'fail'} (lowest holding runs out in ${Number.isFinite(r.runsOut) ? `${f0(r.runsOut)} years` : 'never'}), P3 ${r.P3 ? 'pass' : `fail (${r.P3failed} deciles, worst fall ${pct(r.worstFall, 1)})`}, MIND binds a basic on ${r.mindBinds} day-goods, ${r.receiverships} receiverships`).join('; ')
			};
		}
	},
	{
		id: 'B33',
		name: 'rationing',
		paper: 'world model 4.3 step 7',
		stress: 'P1 when a basic is short',
		claim: 'When a basic is physically short (the food forest at half its yield), the engine’s rationing (each person gets at most an equal cap, filled up from the smallest order) leaves no more person-days short than the world model’s rule (each order cut in proportion).',
		runs: [run({ forestYield: 0.5 }, 30, 'forest yield ×0.5, equal caps'), run({ forestYield: 0.5, basicRation: 'proportion' }, 30, 'forest yield ×0.5, proportional')],
		judge(R, runs) {
			const [a, b] = runs.map((r) => R[r.key]);
			const row = (s) => ({ shortPD: s.shortPD, food: s.shortBy.food, lowestFood: s.prop3.P1.lowestShareMet?.food?.share, poorA: s.poorA, Lmean: s.Lmean });
			const e = row(a), p = row(b);
			return {
				pass: e.shortPD <= p.shortPD,
				numbers: { equal: e, proportion: p },
				takeaway: `With the forest at half its yield, ${f0(e.shortPD)} person-days were short under equal caps and ${f0(p.shortPD)} under proportional cuts.`,
				evidence: `lowest share of food met: ${pct(e.lowestFood)} (equal) vs ${pct(p.lowestFood)} (proportional); poorest Aven decile ${f2(e.poorA)} vs ${f2(p.poorA)}. The engine keeps equal caps: a proportional cut gives the largest orders (the richest) the most of a short basic.`
			};
		}
	},
	{
		id: 'B34',
		name: 'owner-keep',
		paper: 'Proposition 3, P2 (the owner-only cohort)',
		stress: 'P2 against P3: what the owner-only cohort keeps',
		claim: 'A comparison, not a test of the Proposition (it has no verdict): an Aven whose person delivers nothing keeps the whole HEARTS half as ownership (the base), against keeping half of it, as every other Aven does. It shows what the saving rule buys the owner-only cohort (dividends that pay its bundle every day) and what it costs (a lower living standard in its first years), and what it does to P3.',
		runs: [base30, run({ ownerKeep: 0.5 }, 30, 'owner-only Avens keep half the HEARTS half')],
		judge(R, runs) {
			const [a, b] = runs.map((r) => R[r.key]);
			const row = (s, i) => ({ label: runs[i].label, strictFrom: s.prop3.P2.strict.holdsEveryDayFrom, strict: s.prop3.P2.strict.pass, normal: s.prop3.P2.normal.pass, ownerL5: s.ownerL5, ownerLLast: s.ownerLLast, poorH: s.poorH, poorA: s.poorA, P3failed: s.prop3.P3.failed.length });
			const rows = [row(a, 0), row(b, 1)];
			return {
				// a comparison of two rules: no pass or fail (the base's own P2 is judged in S00)
				pass: null,
				comparison: true,
				numbers: { rows },
				takeaway: rows.map((r) => `${r.label}: dividends alone pay the bundle ${r.strictFrom > 0 ? `every day from day ${f0(r.strictFrom)}` : 'on some days only'}; the cohort lives at ${f2(r.ownerL5)} over its first five years and ${f2(r.ownerLLast)} in the last year; ${r.P3failed} deciles fail P3.`).join(' ') + ` (One seed, ${a.seed}; P3 is not judged here, and how many deciles fail under each rule can change with the seed.)`,
				evidence: rows.map((r) => `${r.label}: P2 strict ${r.strict ? 'pass' : 'fail'}, normal ${r.normal ? 'pass' : 'fail'}; poorest holdings decile ${f2(r.poorH)}, poorest Aven decile ${f2(r.poorA)} in the last year`).join('; ')
			};
		}
	}
];

/** section 6 scenarios this suite does not run, and why (none is skipped silently) */
export const NOT_COVERED = [
	['A01', 'anna-lamp', 'a 3-person, 4-COOP unit world with named people is not built. Every world checks the laws themselves every day instead (each HEART’s halves and the pools’ tenth, Law 5’s fifth against what was paid, pools untouched by Law 5: ./engine.js lawCheck), and the money ledger closes every day'],
	['A02', 'mia-proposal', 'needs named work items and proposals for one person; the engine pays running items and proposals to Avens in bulk'],
	['A03', 'panel-via-pools', 'circular sales between related COOPs are not modelled (no related-party flag in use)'],
	['A06', 'own-level and growth', 'the closed-form own level needs a person who keeps everything; the engine’s Avens spend'],
	['A08', 'young-city prices', 'prices are kept in R anchored to HEARTS (rIndex "hearts"), not in MIND counts; the 13-fold rise is not measured'],
	['A09', 'pool-g3m-lvr', 'random-walk paths with an arbitrageur are a pool unit test, not an economy run'],
	['A10', 'routing', 'route costs and hop counts are recorded (getFlows) but not judged against the paper’s 0.38 %'],
	['A11', 'dying-mind', 'no breaker that stops pools buying a failing MIND'],
	['A12', 'holder-rule', 'votes are not modelled'],
	['B06', 'prop2-dial', 'the analytic process of 1,500 holders over 300 years is not part of the engine'],
	['B07', 'levelling', 'no births of children or one-fortune start'],
	['B08', 'geo-plant', 'a new geothermal plant built from pledged HEARTS is not modelled (geothermal stages are set at genesis)'],
	['B12', 'circular-sales', 'related-party sales are not modelled'],
	['B13', 'empty-work', 'no audit of undelivered work items (the ring of B11 shows what happens without it)'],
	['B16', 'selection', 'three COOPs with the paper’s efficiency paths are not set up'],
	['B18', 'front-running', 'no sandwich bot or batch clearing'],
	['B19', 'price-pump', 'an attacker on one pool is not modelled (the B11 ring pushes its own price)'],
	['B20', 'sybil-farm', 'no fake identities'],
	['B21', 'estates', 'no deaths or heirs'],
	['B23 (part)', 'euro-border', 'B23 runs the border for accelerators only: the euro reserve (paper §11.4) holds each COMPUTE COOP’s own account, filled by the electricity it exports and spent on its accelerators; a reserve pooled across COOPs (energy COOPs earning euros, other imports such as panels) and any other trade across the border are not modelled'],
	['B24', 'care-underfunding', 'care is not a good in the engine'],
	['B25', 'two-choices and faithful Avens', 'no random human choices or Aven mistakes']
];

/** every distinct run of the suite (shared runs once), longest first */
export function runSpecs(ids) {
	const seen = new Map();
	for (const s of SCENARIOS) {
		if (ids && !ids.includes(s.id)) continue;
		for (const r of s.runs) if (!seen.has(r.key)) seen.set(r.key, r);
	}
	return [...seen.values()].sort((a, b) => b.years * (b.config.people ?? 1500) ** 0.3 - a.years * (a.config.people ?? 1500) ** 0.3);
}

/** run one world of the suite to its end and summarize it */
export function runWorld(spec) {
	const t0 = Date.now();
	const w = createWorld({ ...spec.config, label: spec.label });
	const days = Math.round(spec.years * Y);
	for (let d = 0; d < days; d++) {
		step(w);
		hooks(w);
		track(w);
	}
	return { ...summarize(w), ms: Date.now() - t0 };
}

/** judge one scenario on the summaries of its runs (by key) */
export function judge(id, R) {
	const s = SCENARIOS.find((x) => x.id === id);
	const missing = s.runs.filter((r) => !R[r.key]);
	if (missing.length) return { pass: false, numbers: {}, takeaway: 'not run', evidence: `missing runs: ${missing.map((r) => r.label).join(', ')}` };
	// a run's label names the seed it ran with (a run with every world's seed changed, --set seed=…, is not the base seed)
	const runs = s.runs.map((r) => ({ ...r, label: r.label.replace(`seed ${B.seed}`, `seed ${R[r.key].seed}`) }));
	return s.judge(R, runs);
}
