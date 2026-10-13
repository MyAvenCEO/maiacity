// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE PROOF AS DATA — the jobs of the proof suite (the base world on five seeds, then every experiment),
 * one job run at a time, and the results put together part by part: Proposition 3's P1, P2 (strict and normal), P3
 * and "only physics limits abundance", each pass or fail with its evidence, then every experiment's verdict and
 * computed takeaway. Plain JS with no node APIs: the page runs it in Web Workers (./proof.worker.js), and
 * scripts/sandbox-9-proof-json.mjs runs it in node's worker threads to write static/sandbox-9/proof.json.
 *
 * Nothing is decided here: every pass flag is the engine's own (./prop3.js, each experiment's `pass`), read off
 * worlds that ran; this file only folds the seeds together (a part passes when it passes on every seed) and writes
 * the evidence as plain sentences.
 */
import { createWorld, step, getLedger } from './engine.js';
import { prop3 } from './prop3.js';
import { EXPERIMENTS, runExperiment } from './experiments.js';

export const SEEDS = [20261012, 1, 2, 3, 4];

/**
 * The files whose text decides a proof's numbers. scripts/sandbox-9-proof-json.mjs stores their hash in proof.json;
 * the Proof tab hashes the same files as the page was built with and says so when the saved proof is older than the
 * engine.
 */
export const ENGINE_FILES = ['consts.js', 'coops.js', 'dmath.js', 'energy.js', 'engine.js', 'experiments.js', 'genesis.js', 'guesses.js', 'market.js', 'pools.js', 'primitives.js', 'proofRun.js', 'prop3.js', 'records.js', 'rng.js', 'scenarios.js'];
/** FNV-1a (32 bits) over each file's name and text, in ENGINE_FILES order: { name: text } → 8 hex digits */
export function engineHash(texts) {
	let h = 0x811c9dc5;
	for (const name of ENGINE_FILES) {
		const t = `${name}\n${(texts[name] ?? '').replace(/\r\n/g, '\n')}`;
		for (let i = 0; i < t.length; i++) {
			h ^= t.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
	}
	return h.toString(16).padStart(8, '0');
}
/** quick mode: 10-year base worlds and shorter experiments (the node proof's --quick years; SH keeps the well's winter) */
const QUICK_YEARS = { base: 10, X1: 6, X2: 3, X9: 4, X10: 10, AB1: 4, SH: 13 };

/** the jobs of a proof run: { kind: 'base', seed, years } and { kind: 'exp', id, years } */
export function proofJobs(quick = false, seeds = SEEDS) {
	const jobs = seeds.map((seed) => ({ kind: 'base', seed, years: quick ? QUICK_YEARS.base : 30 }));
	for (const exp of Object.values(EXPERIMENTS)) jobs.push({ kind: 'exp', id: exp.id, years: quick ? exp.quickYears ?? QUICK_YEARS[exp.id] ?? exp.years : exp.years });
	return jobs;
}

/** run one job and keep what the proof page needs (plain data) */
export function runJob(job) {
	const t0 = Date.now();
	if (job.kind === 'exp') {
		const r = runExperiment(EXPERIMENTS[job.id], { years: job.years });
		return {
			kind: 'exp',
			id: r.id,
			years: r.years,
			question: r.question,
			ruleChanged: r.ruleChanged,
			takeaway: r.takeaway,
			verdict: { pass: !!r.verdict.pass, claim: r.verdict.claim, evidence: r.verdict.evidence },
			ms: Date.now() - t0
		};
	}
	const w = createWorld({ seed: job.seed });
	for (let d = 0; d < job.years * 365; d++) step(w);
	const p = prop3(w);
	const L = getLedger(w);
	const dec = p.P3.deciles;
	// the fall P3 judges: the larger of the trailing-year drawdown and the season-against-season fall
	let worst = { fall: 0 };
	for (const d of dec) if ((d.fall ?? 0) > worst.fall) worst = { fall: d.fall, by: d.by, decile: d.decile };
	const share = p.P3.share ?? [];
	const bottom = dec.find((d) => d.by === 'holdings' && d.decile === 1);
	return {
		kind: 'base',
		seed: job.seed,
		years: job.years,
		people: w.N,
		ms: Date.now() - t0,
		pass: p.pass,
		P1: { pass: p.P1.pass, any: p.P1.personDaysShortAny, byGood: p.P1.personDaysShort, peopleEverShort: p.P1.peopleEverShort, lowest: Object.fromEntries(Object.entries(p.P1.lowestShareMet).map(([g, x]) => [g, x.share])) },
		P2: {
			cohort: p.P2.cohort,
			strict: { pass: p.P2.strict.pass, target: p.P2.strict.target, from: p.P2.strict.holdsEveryDayFrom, first: p.P2.strict.firstDay, lowestByYear: p.P2.strict.lowestRatioByYear },
			normal: { pass: p.P2.normal.pass, failures: p.P2.normal.failures, runsOutInYears: p.P2.normal.runsOutInYears, lowestHoldingDays: p.P2.normal.lowestHoldingDaysByYear }
		},
		P3: {
			pass: p.P3.pass,
			failed: p.P3.failed,
			deciles: dec.map((d) => ({ by: d.by, decile: d.decile, pass: d.pass, first: d.first, last: d.last, ceiling: d.ceiling, rises: d.rises, nearCeiling: d.nearCeiling, fall: d.fall ?? 0, windowsFailed: d.windowsFailed ?? 0, net: d.worstNet?.change ?? 0 })),
			worst,
			withoutCompute: { pass: p.P3.withoutCompute.pass, failed: p.P3.withoutCompute.failed.length },
			computeShare: { all: share.at(-1)?.all ?? NaN, poorest: share.at(-1)?.poorest ?? NaN },
			bottom: bottom ? { first: bottom.byYear?.[0], last: bottom.byYear?.[bottom.byYear.length - 1] } : null,
			coops: { pass: p.P3.coops.pass, receiverships: p.P3.coops.receiverships.map((r) => ({ coop: r.coop, day: r.day, short: r.basicShortPersonDaysAround })), insolvent: p.P3.coops.insolventNow.length, alive: p.P3.coops.alive, founded: p.P3.coops.founded, lowDays30: p.P3.coops.coopDaysUnableToPay30, unpaidShare: p.P3.coops.unpaidShare }
		},
		abundance: { pass: p.abundance.pass, mindBindsBasics: p.abundance.mindBindsBasics },
		energy: { ePP: p.energy.ePP.at(-1), surplusPP: p.energy.surplusPP.at(-1) },
		ledger: { checks: L.checks, mind: L.mindMaxRel, matter: L.matterMaxRel, energy: L.energyMaxRel, leaks: L.mindLeaks.length + L.matterLeaks.length + L.energyLeaks.length, lawChecks: L.lawChecks, lawBreaches: L.lawBreaches, unpaidR: L.unpaidR }
	};
}

const pc = (x, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)} %` : '–');
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const all = (xs, fn) => xs.length > 0 && xs.every(fn);

/**
 * Put the finished jobs together: Proposition 3 part by part, then the experiments. `meta.suite` (the proof suite's
 * summary, scripts/sandbox-9-proof.mjs) adds its verdicts where they test the same part, so the page never shows a
 * pass the full suite computes as a fail.
 */
export function assemble(results, meta = {}) {
	const suite = Object.fromEntries((meta.suite?.scenarios ?? []).map((s) => [s.id, s]));
	const fromSuite = (ids) => ids.filter((id) => suite[id]).map((id) => suite[id]);
	const bases = results.filter((r) => r.kind === 'base').sort((a, b) => SEEDS.indexOf(a.seed) - SEEDS.indexOf(b.seed));
	const order = Object.keys(EXPERIMENTS);
	const exps = results.filter((r) => r.kind === 'exp').sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
	const expById = Object.fromEntries(exps.map((e) => [e.id, e]));
	const seed = (b) => `Seed ${b.seed}`;
	// each evidence line is written with whether it passed; a part shows its failing lines first, so a FAIL card never
	// opens on two passing lines (./ProofView.svelte shows the first two)
	const lines = (xs) => [...xs.filter(([, ok]) => !ok), ...xs.filter(([, ok]) => ok)].map(([t]) => t);
	const failing = (xs) => xs.filter(([, ok]) => !ok).length;
	const parts = [
		{
			id: 'P1',
			title: 'No one starves',
			claim: 'Every person gets at least 98 % of each basic (food, water, energy, a bed) on every day after day 0.',
			pass: all(bases, (b) => b.P1.pass),
			evidence: bases.map((b) => [`${seed(b)}: ${b.P1.any} person-days short; lowest share anyone got: food ${pc(b.P1.lowest.food)}, water ${pc(b.P1.lowest.water)}, energy ${pc(b.P1.lowest.energy)}, a bed ${pc(b.P1.lowest.bed)}.`, b.P1.pass])
		},
		{
			id: 'P2s',
			title: 'No one has to work (strict)',
			claim: 'The owner-only people (5 %, no Aven output, nothing held at the start) live on their Law 5 dividends alone, every day from day 120 at the latest.',
			pass: all(bases, (b) => b.P2.strict.pass),
			evidence: bases.map((b) => [b.P2.strict.from > 0 ? `${seed(b)}: dividends alone pay every owner-only person’s basics every day from day ${b.P2.strict.from} (target ${b.P2.strict.target}); ${b.P2.cohort} people in the cohort.` : `${seed(b)}: dividends alone never paid every owner-only person’s basics every day to the end (target: from day ${b.P2.strict.target}); ${b.P2.cohort} people in the cohort.`, b.P2.strict.pass])
		},
		{
			id: 'P2n',
			title: 'No one has to work (normal)',
			claim: 'Dividends plus spending some of what they hold pay the owner-only people’s basics every day, and their holding never runs out.',
			pass: all(bases, (b) => b.P2.normal.pass),
			evidence: bases.map((b) => [`${seed(b)}: ${b.P2.normal.failures} failing person-days; lowest holding ${f(b.P2.normal.lowestHoldingDays?.[1] ?? b.P2.normal.lowestHoldingDays?.[0], 0)} → ${f(b.P2.normal.lowestHoldingDays?.at(-1), 0)} days of basics.`, b.P2.normal.pass])
		},
		{
			id: 'P3',
			title: 'Living standards rise for everyone',
			claim: 'Every tenth, by holdings and by Aven output, never falls more than 2 % in any 5 years (2 years of recovery after a scheduled shock), and in every 5 years rises or ends within 5 % of the capacity per person; COOPs stay solvent or leave through receivership with no basic short.',
			pass: all(bases, (b) => b.P3.pass),
			evidence: bases.map(
				(b) => [
					`${seed(b)}: ${20 - b.P3.failed.length}/20 tenths pass${b.P3.failed.length ? ` (failing: ${b.P3.failed.length === 20 ? 'all' : b.P3.failed.join(', ')})` : ''}; worst fall ${pc(b.P3.worst.fall, 1)}${b.P3.worst.by ? ` (${b.P3.worst.by} tenth ${b.P3.worst.decile})` : ''}; poorest tenth by holdings ${f(b.P3.bottom?.first, 1)} → ${f(b.P3.bottom?.last, 1)}; Aven services are ${pc(b.P3.computeShare?.all, 0)} of the index in the last year, and without them ${b.P3.withoutCompute?.pass ? 'every tenth passes' : `${b.P3.withoutCompute?.failed} tenths fail`}; ${b.P3.coops.receiverships.length} receiverships, ${b.P3.coops.receiverships.reduce((a, r) => a + r.short, 0)} basic person-days short around them.`,
					b.P3.pass
				]
			).concat(fromSuite(['S00', 'S03']).map((s) => [`Proof suite ${s.id}: ${s.pass ? 'pass' : 'FAIL'}. ${s.takeaway}`, s.pass]))
		},
		{
			id: 'AB',
			title: 'Abundance limited only by physics',
			claim: 'MIND (a person cannot pay) never binds a basic while physics allows enough; doubling HEARTS changes only prices; doubling a binding physical limit raises living standards.',
			// the base worlds, the experiments that test it (X9 HEARTS, AB1 a binding limit, X11 a small village on a big
			// hex) and, when the suite's summary is at hand, its scenarios that test it (B28, B29, B14)
			pass: all(bases, (b) => b.abundance.pass) && ['X9', 'AB1', 'X11'].every((id) => !expById[id] || expById[id].verdict.pass) && fromSuite(['B28', 'B29', 'B14']).every((s) => s.pass),
			evidence: [
				...bases.map((b) => [`${seed(b)}: MIND bound a basic on ${b.abundance.mindBindsBasics} day-goods (a day and a basic); electricity used ${f(b.energy.ePP, 1)} kWh a person a day in the last year, ${f(b.energy.surplusPP, 1)} of it surplus.`, b.abundance.pass]),
				...['X9', 'AB1', 'X11'].filter((id) => expById[id]).map((id) => [`${id} (${expById[id].verdict.pass ? 'pass' : 'FAIL'}): ${expById[id].verdict.evidence}`, expById[id].verdict.pass]),
				...fromSuite(['B28', 'B29', 'B14']).map((s) => [`Proof suite ${s.id} (${s.pass ? 'pass' : 'FAIL'}): ${s.takeaway}`, s.pass])
			]
		}
	];
	const ledgers = bases.map((b) => ({ seed: b.seed, ...b.ledger }));
	return {
		generated: meta.generated ?? new Date().toISOString(),
		mode: meta.quick ? 'quick' : 'full',
		where: meta.where ?? 'node',
		wallMs: meta.wallMs ?? null,
		people: bases[0]?.people ?? null,
		baseYears: bases[0]?.years ?? null,
		seeds: bases.map((b) => b.seed),
		pass: parts.every((p) => p.pass) && exps.every((e) => e.verdict.pass),
		engineHash: meta.engineHash ?? null,
		suiteUsed: Object.keys(suite).length > 0,
		parts: parts.map((p) => ({ ...p, failingLines: failing(p.evidence), evidence: lines(p.evidence) })),
		experiments: exps.map((e) => ({ id: e.id, question: e.question, ruleChanged: e.ruleChanged, years: e.years, pass: e.verdict.pass, claim: e.verdict.claim, evidence: e.verdict.evidence, takeaway: e.takeaway, ms: e.ms })),
		ledgers,
		runs: bases.map((b) => ({ seed: b.seed, years: b.years, ms: b.ms, receiverships: b.P3.coops.receiverships.length, founded: b.P3.coops.founded }))
	};
}
