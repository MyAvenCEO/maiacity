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
const B = { seed: 20261012, people: 250 };
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
	return (c.people && c.people !== 250 ? `${c.people} people` + (s ? ', ' : '') : '') + (s || (c.seed && c.seed !== B.seed ? `seed ${c.seed}` : 'base'));
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
		claim: 'On every seed: nobody below 98 % of a basic after day 0; the owner-only cohort passes the strict test by day 120 and the normal test every day; every decile (by holdings and by Aven output) never falls more than 2 % in a 5-year window and rises or sits near the physics ceiling; MIND never binds a basic.',
		runs: SEEDS.map((seed) => run({ seed }, 30, `base, seed ${seed}`)),
		judge(R, runs) {
			const rows = runs.map((r) => R[r.key]);
			const seeds = rows.map((s) => ({ seed: s.seed, P1: s.prop3.P1.pass, shortPD: s.shortPD, strictFrom: s.prop3.P2.strict.holdsEveryDayFrom, P2n: s.prop3.P2.normal.pass, P3: s.prop3.P3.pass, P3failed: s.prop3.P3.failed.length, worstFall: Math.max(...s.prop3.P3.deciles.map((d) => d.fall ?? 0)), mindBinds: s.prop3.abundance.mindBindsBasics, receiverships: s.receiverships.length, poor1: yearOf(s, 1).poorH, poor30: s.poorH }));
			const pass = rows.every((s) => s.prop3.pass);
			return {
				pass,
				numbers: { seeds },
				takeaway: `Proposition 3 ${pass ? 'holds' : 'does not hold'} on ${rows.filter((s) => s.prop3.pass).length} of ${rows.length} seeds over 30 years. The strict test holds from day ${Math.max(...seeds.map((x) => x.strictFrom))} at the latest. The worst 5-year fall of any decile is ${pct(Math.max(...seeds.map((x) => x.worstFall)), 2)}.`,
				evidence: seeds.map((x) => `seed ${x.seed}: P1 ${x.shortPD} person-days short, strict from day ${x.strictFrom}, normal ${x.P2n ? 'pass' : 'fail'}, P3 ${x.P3 ? 'pass' : `fail (${x.P3failed} deciles)`}, worst fall ${pct(x.worstFall, 2)}, MIND binds a basic on ${x.mindBinds} days`).join('; ') + '. The world model asks for 60 years; this suite runs 30.'
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
		runs: [base30, run({ bootstrap: false }, 2, 'no bootstrap'), run({ fieldPeople: 62.5 }, 10, 'empty city: capital for 62.5 people, 250 people')],
		judge(R, runs) {
			const a = R[runs[0].key], b = R[runs[1].key], c = R[runs[2].key];
			return {
				pass: a.short0 === 0 && a.prop3.P1.pass && c.prop3.abundance.pass,
				numbers: { bootstrapDay0: a.short0, noBootstrapDay0: b.short0, noBootstrapDay1: b.short1, noBootstrapYear1: b.years[0].short, emptyCityShortPD: c.shortPD, emptyCityMindBinds: c.prop3.abundance.mindBindsBasics, emptyCityLimits: c.shortByLimit },
				takeaway: `With the bootstrap, ${pct(a.short0)} of people are short on day 0. Without it, ${pct(b.short0)} on day 0 and ${pct(b.short1)} on day 1. In an empty city, MIND bound a basic on ${c.prop3.abundance.mindBindsBasics} days; ${f0(c.shortPD)} person-days were short, all for physical limits.`,
				evidence: `empty city short days by limit: ${JSON.stringify(c.shortByLimit)}`
			};
		}
	},
	{
		id: 'B15',
		name: 'pop-growth',
		paper: '§5.2, sim §6.4, §9.3',
		stress: 'P1 and P2 for newcomers; P3 on fixed land',
		claim: '250 people growing 2 % a year on fixed land: newcomers (first 3 years) are never short, and ground rent rises.',
		runs: [base30, run({ popGrowth: 0.02, maxYears: 30 }, 30)],
		judge(R, runs) {
			const a = R[runs[0].key], s = R[runs[1].key];
			const r0 = s.years[0].rent, r1 = s.years[s.years.length - 1].rent, ra = a.years[a.years.length - 1].rent;
			return {
				pass: s.newcomers.short === 0 && r1 > ra,
				numbers: { N: s.N, newcomerPD: s.newcomers.pd, newcomerShort: s.newcomers.short, shortPD: s.shortPD, shortBy: s.shortBy, shortByLimit: s.shortByLimit, rentYear1: r0, rentEnd: r1, rentBase: ra, mindPP: s.mindPP, gini: s.gini },
				takeaway: `The village grew from 250 to ${s.N}. Newcomers were short on ${f0(s.newcomers.short)} of ${f0(s.newcomers.pd)} person-days in their first three years; everyone, ${f0(s.shortPD)}. Ground rent went from ${r0.toExponential(2)} to ${r1.toExponential(2)} R a m² a day.`,
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
				takeaway: rows.map((r) => `${r.rule}: ${f0(r.shortPD)} person-days short, lowest water bar ${f2(r.bar)}× the price, MIND bound a basic on ${r.mindBinds} days.`).join(' '),
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
		claim: 'Doubling HEARTS changes only prices (real consumption of every good within ±1 %). Doubling a binding physical limit raises living standards; doubling a limit that does not bind changes little.',
		runs: [base30, run({ heartsPerDay: 48 }, 30), run({ springSites: 4 }, 30), run({ geoStages: 2 }, 30), run({ landHa: 90 }, 30)],
		judge(R, runs) {
			const b = R[runs[0].key], h = R[runs[1].key];
			const cons = Object.keys(b.consRun).map((g) => [g, rel(h.consRun[g], b.consRun[g])]);
			const worst = cons.reduce((m, r) => (Math.abs(r[1]) > Math.abs(m[1]) ? r : m), ['', 0]);
			const prices = Object.keys(b.priceRun).map((g) => [g, h.priceRun[g] / b.priceRun[g]]);
			const heartsOk = cons.every((r) => Math.abs(r[1]) <= 0.01);
			// which limits bound in the base world (share of days, all goods)
			// a limit binds when it is a good's badge on at least a tenth of the days
			const lim = (name) => Object.entries(b.badgeShares).flatMap(([g, sh]) => Object.entries(sh).filter(([l, x]) => l.startsWith(name) && x >= 0.1).map(([, x]) => `${g} ${pct(x, 0)}`));
			const dbl = [
				{ what: 'hot-spring sites ×2', s: R[runs[2].key], binding: lim('nature').length > 0, bindsWhere: lim('nature') },
				{ what: 'geothermal stages ×2', s: R[runs[3].key], binding: lim('energy').length > 0, bindsWhere: lim('energy') },
				{ what: 'land ×2', s: R[runs[4].key], binding: lim('land').length > 0, bindsWhere: lim('land') }
			].map((d) => ({ what: d.what, binding: d.binding, bindsWhere: d.bindsWhere, Lmean: d.s.Lmean, change: rel(d.s.Lmean, b.Lmean), poorChange: rel(d.s.poorA, b.poorA), P1: d.s.prop3.P1.pass }));
			const physOk = dbl.filter((d) => d.binding).every((d) => d.change > 0);
			return {
				pass: heartsOk && physOk && dbl.some((d) => d.binding),
				numbers: { worstConsChange: worst, prices, doublings: dbl },
				takeaway: `With 48 HEARTS a day, prices in R rose about ×${f2(prices.find((p) => p[0] === 'water')[1])} and real consumption changed by at most ${pct(worst[1], 2)} (${worst[0]}). ` + dbl.map((d) => `${d.what} (${d.binding ? 'binding' : 'not binding'}): mean living standard ${pct(d.change, 2)}.`).join(' '),
				evidence: `base badges: ${dbl.map((d) => `${d.what}: ${d.bindsWhere.join(', ') || 'none'}`).join('; ')}; consumption changes with 48 HEARTS: ${cons.map((r) => `${r[0]} ${pct(r[1], 2)}`).join(', ')}`
			};
		}
	},
	{
		id: 'B29',
		name: 'binding-limit',
		paper: 'world model 5.5',
		stress: 'P1 in winter; P3 for growth',
		claim: '50, 100 and 250 people on one hex built for 250, without and with the geothermal stage: every short basic day is bound by a physical limit (never MIND), and fewer people are short less.',
		runs: [50, 100, 250].flatMap((n) => [run({ people: n, fieldPeople: 250, geothermal: false }, 30, `${n} people, no geothermal`), n === 250 ? base30 : run({ people: n, fieldPeople: 250 }, 30, `${n} people, geothermal`)]),
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
				takeaway: rows.map((r) => `${r.label}: ${f0(r.shortPD)} person-days short (${JSON.stringify(r.byLimit)}), MIND bound a basic on ${r.mindBinds} days.`).join(' '),
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
		claim: 'Ten citizens on a hex sized for them, 3 years: Proposition 3 holds and both ledgers close.',
		runs: [run({ people: 10 }, 3, '10 people')],
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
		claim: 'A grid of melt (3, 7, 12 %) and Law 5 share (0, 10, 20, 40 %), 100 people, 10 years: the paper’s point (7 %, 20 %) and its four neighbours (3 % and 12 % melt; 10 % and 40 % share) keep Proposition 3. A share of 0 pays no dividends, so it cannot pass the strict test; it marks the edge.',
		runs: PHASE.melt.flatMap((m) => PHASE.law5.map((l) => run({ people: 100, melt: m, law5: l }, 10, `melt ${pct(m, 0)}, Law 5 ${pct(l, 0)}`))),
		judge(R, runs) {
			const grid = runs.map((r) => ({ melt: r.config.melt, law5: r.config.law5, pass: R[r.key].prop3.pass, P1: R[r.key].prop3.P1.pass, P2: R[r.key].prop3.P2.pass, P3: R[r.key].prop3.P3.pass, strictFrom: R[r.key].prop3.P2.strict.holdsEveryDayFrom }));
			const at = (m, l) => grid.find((g) => g.melt === m && g.law5 === l);
			const centre = at(0.07, 0.2), nb = [at(0.03, 0.2), at(0.12, 0.2), at(0.07, 0.1), at(0.07, 0.4)];
			const cell = (g) => `${g.P1 ? '1' : '·'}${g.P2 ? '2' : '·'}${g.P3 ? '3' : '·'}`;
			return {
				pass: centre.pass && nb.every((g) => g.pass),
				numbers: { grid },
				takeaway: `Parts that hold at each point (1, 2, 3; · fails), melt down, Law 5 across: ` + PHASE.melt.map((m) => `${pct(m, 0)}: ${PHASE.law5.map((l) => cell(at(m, l))).join(' ')}`).join('; ') + '.',
				evidence: grid.filter((g) => !g.pass).map((g) => `melt ${pct(g.melt, 0)}, Law 5 ${pct(g.law5, 0)}: P1 ${g.P1 ? 'pass' : 'fail'}, P2 ${g.P2 ? 'pass' : `fail (strict from day ${g.strictFrom})`}, P3 ${g.P3 ? 'pass' : 'fail'}`).join('; ') || 'every point passes'
			};
		}
	}
];

/** section 6 scenarios this suite does not run, and why (none is skipped silently) */
export const NOT_COVERED = [
	['A01', 'anna-lamp', 'a 3-person, 4-COOP unit world with named people is not built; the same laws run in every world and the money ledger checks them every day'],
	['A02', 'mia-proposal', 'needs named work items and proposals for one person; the engine pays running items and proposals to Avens in bulk'],
	['A03', 'panel-via-pools', 'circular sales between related COOPs are not modelled (no related-party flag in use)'],
	['A06', 'own-level and growth', 'the closed-form own level needs a person who keeps everything; the engine’s Avens spend'],
	['A07', 'laborde', 'needs a settled city of 100 and one newcomer with relative-position tracking'],
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
	['B23', 'euro-border', 'the city is closed: no imports, exports or euro reserve'],
	['B24', 'care-underfunding', 'care is not a good in the engine'],
	['B25', 'two-choices and faithful Avens', 'no random human choices or Aven mistakes'],
	['S00 (60 years)', 'prop3-headline', 'run for 30 years, not 60, to keep the suite near two minutes']
];

/** every distinct run of the suite (shared runs once), longest first */
export function runSpecs(ids) {
	const seen = new Map();
	for (const s of SCENARIOS) {
		if (ids && !ids.includes(s.id)) continue;
		for (const r of s.runs) if (!seen.has(r.key)) seen.set(r.key, r);
	}
	return [...seen.values()].sort((a, b) => b.years * (b.config.people ?? 250) ** 0.3 - a.years * (a.config.people ?? 250) ** 0.3);
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
	return s.judge(R, s.runs);
}
