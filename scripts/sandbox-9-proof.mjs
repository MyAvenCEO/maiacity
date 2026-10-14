// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE PROOF SUITE — runs every Primer experiment (X1–X14, AB1, SH; ./src/lib/sandbox-9/experiments.js)
 * and every section 6 scenario the engine supports (./src/lib/sandbox-9/scenarios.js), judges Proposition 3 and
 * "abundance limited only by physics" on them, and writes:
 *
 *   /mnt/project-files/theos/sandbox-8/proof.md   the headline (does Proposition 3 hold, part by part), one Primer
 *                                                  block per experiment, the scenarios, what is not covered, then the
 *                                                  base world's evidence (P1–P3 tables, binding limits, energy against
 *                                                  living standard, the ledgers, the starting capital, the catalog)
 *   /mnt/project-files/theos/sandbox-8/proof.csv  the series behind it (part, id, run, series, index, value)
 *   static/sandbox-9/proof.json                    under the key "suite", a small summary for the page: per experiment
 *                                                  and scenario, the verdict, key numbers, the takeaway, and the run
 *                                                  date (the file's other keys belong to scripts/sandbox-9-proof-json.mjs
 *                                                  and stay as they are)
 *
 *   node scripts/sandbox-9-proof.mjs              everything, in worker threads (about eight minutes on 4 cores)
 *   node scripts/sandbox-9-proof.mjs --only X1,B28 some experiments or scenarios (S00 = the five base seeds, 60 years)
 *   --quick                                       a smoke test: every scenario world cut to at most 10 years (verdicts
 *                                                  that need longer runs then read short ones); prints the table and
 *                                                  writes nothing unless --out is given
 *   --set key=value                               change a setting in every world (exploring; the report says so)
 *   --out <dir>                                   write proof.md and proof.csv elsewhere (proof.json only on a full run)
 *   --save <file>, --load <file>                  keep the runs' results; report from them again without running
 *                                                  (refused when the engine's files changed since). Part 3's verdict
 *                                                  is judged here, from each run's falls, by the yardstick named in
 *                                                  src/lib/sandbox-9/yardstick.js (P3_VERDICT, not an engine file), so
 *                                                  --load rejudges saved runs after the verdict changes
 *   --only S00 --page                              the five base worlds only, and their summary written to proof.json's
 *                                                  "suite" as a partial suite (`partial`: no other scenario and no
 *                                                  experiment), so the page shows this engine's base world while the
 *                                                  whole suite still runs
 *
 * Every number in the report is computed by the run; nothing is typed in.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import v8 from 'node:v8';
import { dirname, join, basename } from 'node:path';
// part 3's verdict and its side yardsticks (Samuel 2026-10-14 17:31: taste-adjusted): judged here from each run's falls,
// so a change of verdict is one edit there and `--load` rejudges the saved runs
import { P3_VERDICT, YARDSTICKS, SIDE, EXTRAS, nameOf, ordersFilled, judgeP3, rejudgeSlim } from '../src/lib/sandbox-9/yardstick.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LIB = join(ROOT, 'src', 'lib', 'sandbox-9');
const BASE_KEYS_SEEDS = [20261012, 1, 2, 3, 4];
/** experiments judged on every base seed (the seeds fixed above, before any verdict) */
const ENSEMBLE = ['X9'];

// ── a worker runs one job ────────────────────────────────────────────────────────────────────────────────────────
if (!isMainThread) {
	const { job } = workerData;
	const { createWorld, step, DEFAULTS } = await import(join(LIB, 'engine.js'));
	const { prop3 } = await import(join(LIB, 'prop3.js'));
	const { runExperiment, EXPERIMENTS, hooks, track, summarize } = await import(join(LIB, 'experiments.js'));
	if (job.kind === 'run') {
		const t0 = Date.now();
		const w = createWorld({ ...job.spec.config, ...(job.set ?? {}), label: job.spec.label });
		const day0 = job.detail ? startOf(w) : null;
		const days = Math.round(job.spec.years * 365);
		for (let d = 0; d < days; d++) {
			step(w);
			hooks(w);
			track(w);
		}
		const ms = Date.now() - t0;
		const out = { job, ms, s: summarize(w) };
		if (job.detail) out.detail = { p: prop3(w), day0, defaults: DEFAULTS, N: w.N, owners: w.ownerIds.length };
		parentPort.postMessage(out);
	} else {
		const r = runExperiment(EXPERIMENTS[job.id], { config: job.set, seed: job.set?.seed });
		const slim = (x) => ({ label: x.label, values: x.values, params: x.params, food: x.food, prop3: { pass: x.prop3.pass, P1: { pass: x.prop3.P1.pass, personDaysShortAny: x.prop3.P1.personDaysShortAny }, P2: { pass: x.prop3.P2.pass, strictFrom: x.prop3.P2.strict.holdsEveryDayFrom, normal: x.prop3.P2.normal.pass }, P3: { pass: x.prop3.P3.pass, failed: x.prop3.P3.failed }, abundance: { pass: x.prop3.abundance.pass, mindBindsBasics: x.prop3.abundance.mindBindsBasics } } });
		parentPort.postMessage({ job, ms: r.ms, r: { ...r, base: slim(r.base), changed: slim(r.changed) } });
	}

	/** what the world holds on day 0, before it runs: the starting capital */
	function startOf(w) {
		const plants = [];
		for (const co of w.coops) for (const pl of co.plants) plants.push({ coop: co.id, tech: pl.tech, cap: pl.cap, landM2: pl.landM2 ?? 0 });
		let people = 0;
		for (let i = 0; i < w.N * w.M; i++) people += w.hold[i];
		return { plants, peopleMind: people, landHa: w.cfg.landHa, people: w.N };
	}
}

// ── the main thread: schedule, collect, judge, write ─────────────────────────────────────────────────────────────
async function main() {
	const args = process.argv.slice(2);
	const quick = args.includes('--quick');
	const page = args.includes('--page');
	const oi = args.indexOf('--only');
	const only = oi >= 0 ? args[oi + 1].split(',') : null;
	const di = args.indexOf('--out');
	const OUT = di >= 0 ? args[di + 1] : quick ? null : '/mnt/project-files/theos/sandbox-8';
	const set = {};
	args.forEach((a, i) => {
		if (a !== '--set') return;
		const [k, v] = args[i + 1].split('=');
		set[k] = JSON.parse(v);
	});
	const { EXPERIMENTS } = await import(join(LIB, 'experiments.js'));
	const { SCENARIOS, NOT_COVERED, runSpecs, judge } = await import(join(LIB, 'scenarios.js'));
	const expIds = Object.keys(EXPERIMENTS).filter((id) => !only || only.includes(id));
	const scenIds = SCENARIOS.map((s) => s.id).filter((id) => !only || only.includes(id));
	const specs = (scenIds.length ? runSpecs(scenIds) : []).map((sp) => (quick ? { ...sp, years: Math.min(sp.years, 10) } : sp));
	// the base worlds whose evidence the appendix prints: S00's (every seed, the world model's 60 years)
	const s00 = SCENARIOS.find((x) => x.id === 'S00');
	const isBase = (sp) => s00.runs.some((r) => r.key === sp.key);
	const jobs = [
		...specs.map((spec) => ({ kind: 'run', spec, set, detail: isBase(spec), cost: spec.years * ((spec.config.people ?? 1500) / 1500 + 0.15) * (spec.config.coopsPerGood === 4 ? 1.6 : 1) })),
		...expIds.map((id) => {
			const e = EXPERIMENTS[id];
			return { kind: 'exp', id, set, cost: 2 * e.years * ((e.people ?? 1500) / 1500 + 0.15) };
		}),
		// X9 (doubling HEARTS) is judged on the five base seeds, chosen before any verdict: its goods market is thin, and
		// one seed's change can land on either side of the 1 % mark by chance
		...expIds
			.filter((id) => ENSEMBLE.includes(id))
			.flatMap((id) => BASE_KEYS_SEEDS.filter((sd) => sd !== (set.seed ?? BASE_KEYS_SEEDS[0])).map((sd) => ({ kind: 'exp', id, set: { ...set, seed: sd }, ens: sd, cost: 2 * EXPERIMENTS[id].years * ((EXPERIMENTS[id].people ?? 1500) / 1500 + 0.15) })))
	].sort((a, b) => b.cost - a.cost);
	const par = Math.max(1, Math.min(jobs.length, cpus().length));
	process.stderr.write(`${jobs.length} jobs (${specs.length} scenario worlds, ${expIds.length} experiments) on ${par} threads\n`);
	const t0 = Date.now();
	// --save <file> keeps the runs' results (v8 serialized, with the engine's hash), --load <file> reports from them
	// without running again (only when the engine's files are unchanged)
	const si = args.indexOf('--save'), li = args.indexOf('--load');
	const { ENGINE_FILES: EF, engineHash: eh } = await import(join(LIB, 'proofRun.js'));
	const hashNow = eh(Object.fromEntries(EF.map((fl) => [fl, readFileSync(join(LIB, fl), 'utf8')])));
	let results, wall;
	if (li >= 0) {
		const saved = v8.deserialize(readFileSync(args[li + 1]));
		if (saved.hash !== hashNow) throw new Error(`--load: the saved runs are of engine ${saved.hash}, the files are ${hashNow}`);
		(results = saved.results), (wall = saved.wall);
		process.stderr.write(`loaded ${results.length} results (engine ${saved.hash})\n`);
	} else {
		results = await runAll(jobs, par);
		wall = Date.now() - t0;
		if (si >= 0) writeFileSync(args[si + 1], v8.serialize({ hash: hashNow, wall, results }));
	}
	const R = {}, detail = {};
	for (const m of results.filter((x) => x.job.kind === 'run')) {
		R[m.job.spec.key] = { ...m.s, ms: m.ms };
		if (m.detail) detail[m.s.seed] = { ...m.detail, s: m.s, ms: m.ms };
	}
	const exps = expIds.map((id) => results.find((x) => x.job.kind === 'exp' && x.job.id === id && !x.job.ens));
	// an experiment judged on an ensemble of seeds passes only when it passes on every seed (the mark of each run is
	// unchanged)
	for (const e of exps) {
		if (!ENSEMBLE.includes(e.r.id)) continue;
		const more = results.filter((x) => x.job.kind === 'exp' && x.job.id === e.r.id && x.job.ens).sort((a, b) => BASE_KEYS_SEEDS.indexOf(a.job.ens) - BASE_KEYS_SEEDS.indexOf(b.job.ens));
		e.r.ens = [{ seed: e.r.seed, pass: !!e.r.verdict.pass, evidence: e.r.verdict.evidence }, ...more.map((x) => ({ seed: x.job.ens, pass: !!x.r.verdict.pass, evidence: x.r.verdict.evidence }))];
		const k = e.r.ens.filter((x) => x.pass).length;
		e.r.verdict = { ...e.r.verdict, pass: k === e.r.ens.length, evidence: `on ${k} of ${e.r.ens.length} seeds (${e.r.ens.map((x) => `seed ${x.seed} ${x.pass ? 'pass' : 'FAIL'}: ${x.evidence.split(';')[0]}`).join('; ')}). Seed ${e.r.seed} in full: ${e.r.verdict.evidence}` };
	}
	const scen = scenIds.map((id) => {
		const s = SCENARIOS.find((x) => x.id === id);
		const v = judge(id, R);
		const ms = s.runs.reduce((a, r) => a + (R[r.key]?.ms ?? 0), 0);
		return { id, name: s.name, paper: s.paper, stress: s.stress, claim: s.claim, runs: s.runs.map((r) => ({ label: R[r.key] ? r.label.replace('seed 20261012', `seed ${R[r.key].seed}`) : r.label, years: r.years, people: r.config.people, ms: R[r.key]?.ms, params: R[r.key]?.params, food: R[r.key]?.food })), ms, ...v };
	});
	const bases = BASE_KEYS_SEEDS.filter((sd) => detail[sd]).map((sd) => ({ seed: sd, ...detail[sd] }));
	const now = new Date().toISOString();
	printTable(exps, scen, wall);
	const { catalogList, STARTING_CAPITAL, BORDER, CHIPS, DF_ENGINE } = await import(join(LIB, 'primitives.js'));
	const { ENGINE_FILES, engineHash } = await import(join(LIB, 'proofRun.js'));
	const hash = engineHash(Object.fromEntries(ENGINE_FILES.map((fl) => [fl, readFileSync(join(LIB, fl), 'utf8')])));
	const prices = { foodEur: BORDER.foodEur.v, glulamEur: BORDER.glulamEur.v, steelEur: BORDER.steelEur.v, glazingEur: BORDER.glazingEur.v, floatEur: BORDER.floatEur.v, logsEur: BORDER.logsEur.v, cellsEur: BORDER.cellsEur.v, panelsEur: BORDER.panelsEur.v, gridEurKwh: BORDER.gridEurKwh.v, chipEur: CHIPS.eurPerChip.v, spotEurMwh: CHIPS.spotEurMwh.v, solarEurMwh: CHIPS.solarEurMwh.v, lineKw: CHIPS.lineKw.v };
	// (round 5) every border price by its key, and the dome factory's lines (their units and kits, ./primitives.js DF_ENGINE)
	prices.all = Object.fromEntries(Object.entries(BORDER).map(([k, x]) => [k, x.v]));
	prices.df = DF_ENGINE ? { rho: DF_ENGINE.rho, gs: DF_ENGINE.gs, plateT: DF_ENGINE.plateT, glazM2T: DF_ENGINE.glazM2T, cellsM2: DF_ENGINE.cellsM2, pvM2Kwp: DF_ENGINE.pvM2Kwp, cap: DF_ENGINE.cap, floor: DF_ENGINE.floor, unit: DF_ENGINE.unit } : null;
	prices.src = { ...Object.fromEntries(Object.keys(BORDER).map((k) => [k, BORDER[k].src])), chipEur: CHIPS.eurPerChip.src, spotEurMwh: CHIPS.spotEurMwh.src, solarEurMwh: CHIPS.solarEurMwh.src, lineKw: CHIPS.lineKw.src };
	const meta = { wall, set, now, only, quick, hash, threads: par, totalCpu: results.reduce((a, r) => a + r.ms, 0), catalog: catalogList(), start: STARTING_CAPITAL, prices, loaded: li >= 0 ? basename(args[li + 1]) : null };
	// (round 6) the extras' prices on day 1 of each base world, for part 3's one-basket yardstick (the world is the same
	// on day 1 as the run's: seeded, the same settings)
	if (bases.length) {
		const { createWorld: cw, step: st } = await import(join(LIB, 'engine.js'));
		const C = await import(join(LIB, 'consts.js'));
		meta.day1Prices = {};
		for (const b of bases) {
			const w1 = cw({ seed: b.seed, people: 1500, ...set });
			st(w1);
			meta.day1Prices[b.seed] = { goods: w1.pbar[C.GOODS_], spring: w1.pbar[C.SPRING], compute: w1.pbar[C.COMPUTE], bed: w1.pbar[C.BED], m2PerBed: w1.c.homeM2PerBed };
		}
		// part 3 under every yardstick, the verdict's (P3_VERDICT) first: from each run's falls and excuses (./prop3.js)
		for (const b of bases) b.v3 = judgeP3(b.p, b.s.living, meta.day1Prices[b.seed]);
	}
	// every other world of the suite rejudged by the verdict's yardstick from its saved falls (scenario verdicts read
	// part 3 as the run judged it, each extra)
	meta.rejudged = Object.values(R).map((s) => ({ label: s.label, seed: s.seed, asRun: !!s.prop3?.P3?.pass, v: rejudgeSlim(s.prop3?.P3) }));
	if (!OUT) {
		console.log('--quick without --out: nothing written');
		return;
	}
	const md = report(exps, scen, bases, NOT_COVERED, meta);
	mkdirSync(OUT, { recursive: true });
	const suffix = (only ? '-' + only.join('-') : '') + (Object.keys(set).length ? '-set' : '') + (quick ? '-quick' : '');
	writeFileSync(join(OUT, `proof${suffix}.md`), md);
	writeFileSync(join(OUT, `proof${suffix}.csv`), toCsv(exps, scen, bases, R));
	const partial = page && only?.length === 1 && only[0] === 'S00';
	if ((!only || partial) && !Object.keys(set).length && !quick) {
		const dir = join(ROOT, 'static', 'sandbox-9');
		mkdirSync(dir, { recursive: true });
		// The page's Proof view reads the top-level keys of this file (scripts/sandbox-9-proof-json.mjs writes them).
		// This suite adds its own summary under "suite" and leaves every other key as it is.
		const file = join(dir, 'proof.json');
		let prev = {};
		try {
			prev = JSON.parse(readFileSync(file, 'utf8'));
		} catch {
			prev = {};
		}
		const suite = toJson(exps, scen, bases, NOT_COVERED, meta);
		// a partial suite (--only S00 --page) says so: the page reads its base world, and no other scenario's verdict
		if (partial) suite.partial = { only, note: 'the five base worlds only (S00); the other scenarios and the experiments are not in this summary' };
		writeFileSync(file, JSON.stringify({ ...prev, suite }, null, '\t'));
		console.log(`wrote ${file} (key "suite")`);
	}
	console.log(`wrote ${join(OUT, `proof${suffix}.md`)} and .csv (${(wall / 1000).toFixed(1)} s)`);
}

function runAll(jobs, par) {
	return new Promise((resolve, reject) => {
		const out = [];
		let next = 0, running = 0;
		const launch = () => {
			if (next >= jobs.length && running === 0) return resolve(out);
			while (running < par && next < jobs.length) {
				const job = jobs[next++];
				running++;
				const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { job } });
				wk.once('message', (m) => {
					out.push(m);
					process.stderr.write(`  done ${job.kind === 'exp' ? job.id : job.spec.label + ` (${job.spec.years} y)`} in ${(m.ms / 1000).toFixed(1)} s\n`);
				});
				wk.once('error', reject);
				wk.once('exit', () => {
					running--;
					launch();
				});
			}
		};
		launch();
	});
}

// ── formatting ───────────────────────────────────────────────────────────────────────────────────────────────────
const f = (x, d = 2) => (x == null ? '–' : typeof x === 'number' ? (Number.isFinite(x) ? x.toFixed(d) : String(x)) : String(x));
const pc = (x, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)} %` : String(x));
// (a scenario that only compares two rules has no verdict: pass is null)
const yes = (b) => (b == null ? 'comparison' : b ? 'PASS' : 'FAIL');
const cellOf = (x) => (typeof x === 'number' ? (Number.isInteger(x) ? x.toLocaleString('en-US') : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 0.01 || x === 0 ? x.toFixed(3) : x.toExponential(2)) : x == null ? '–' : String(x));

function printTable(exps, scen, wall) {
	console.log('\nid    | verdict | takeaway');
	for (const e of exps) console.log(`${e.r.id.padEnd(5)} | ${yes(e.r.verdict.pass).padEnd(7)} | ${e.r.takeaway}`);
	for (const s of scen) console.log(`${s.id.padEnd(5)} | ${yes(s.pass).padEnd(7)} | ${s.takeaway}`);
	console.log(`\nwall time ${(wall / 1000).toFixed(1)} s`);
}

/** the headline, part by part, computed from the base seeds and the experiments and scenarios that test each part */
function headline(exps, scen, bases) {
	const E = (id) => exps.find((e) => e?.r.id === id)?.r;
	const S = (id) => scen.find((s) => s.id === id);
	const allB = (fn) => bases.length > 0 && bases.every(fn);
	const rows = [];
	const fails = (list) => list.filter((x) => x && x.pass === false).map((x) => x.id);
	const failE = (list) => list.map(E).filter((x) => x && x.verdict.pass === false).map((x) => x.id);
	// the seed ensemble (S04) breaks a part when that part fails on any of its worlds
	const ens = (key) => (S('S04')?.numbers?.rows ?? []).some((r) => r[key] === false) ? ['S04'] : [];
	rows.push({
		part: 'P1 — no one starves',
		holds: allB((b) => b.p.P1.pass),
		base: bases.map((b) => b.p.P1.personDaysShortAny).join(', ') + ' person-days short after the founding (seeds ' + bases.map((b) => b.seed).join(', ') + ')',
		founding: bases.map((b) => b.p.P1.founding?.personDaysShortAny ?? '–').join(', ') + ' person-days short' + (bases.every((b) => b.s.rampShort) ? '; of them, while the two settlers were the whole village: ' + bases.map((b) => b.s.rampShort.settlersPD).join(', ') + ' (the appendix says why)' : ''),
		breaks: [...failE(['X5', 'X12', 'X14', 'SH']), ...fails(['B10', 'B15', 'B26', 'B29', 'S02', 'S03'].map(S)), ...ens('P1')]
	});
	rows.push({
		part: 'P2 strict — dividends alone pay the basic bundle',
		holds: allB((b) => b.p.P2.strict.pass),
		// -1: dividends alone never paid every member's bundle on every day to the end of the run
		base: 'holds every day from ' + bases.map((b) => (b.p.P2.strict.holdsEveryDayFrom >= 0 ? 'day ' + b.p.P2.strict.holdsEveryDayFrom : 'never')).join(', ') + ' (target: from the founding’s end, day ' + bases.map((b) => b.p.P2.strict.target).join(', ') + '); lowest dividends ÷ bundle after the founding ' + bases.map((b) => f(b.p.P2.strict.lowestAfterFounding)).join(', ') + ', in the last year ' + bases.map((b) => f(b.p.P2.strict.lowestRatioByYear?.at(-1))).join(', '),
		founding: 'lowest dividends ÷ bundle ' + bases.map((b) => f(b.p.P2.strict.lowestInFounding)).join(', '),
		breaks: [...failE(['X2']), ...fails(['B03', 'A07', 'S03'].map(S)), ...ens('strict')]
	});
	rows.push({
		part: 'P2 normal — no one has to work to survive',
		holds: allB((b) => b.p.P2.normal.pass),
		founding: bases.map((b) => b.p.P2.normal.failuresInFounding ?? '–').join(', ') + ' person-days failing',
		base: bases.map((b) => b.p.P2.normal.failures).join(', ') + ' person-days failing after the founding; the lowest holding runs out in ' + bases.map((b) => (Number.isFinite(b.p.P2.normal.runsOutInYears) ? Math.round(b.p.P2.normal.runsOutInYears) + ' years' : 'never')).join(', ') + ' at its last-10-year trend (pass: over 100)',
		breaks: [...failE(['X2']), ...fails(['B05'].map(S)), ...ens('normal')]
	});
	rows.push({
		part: `P3 — living standards rise for every tenth (real units, judged ${YARDSTICKS[P3_VERDICT].label})`,
		// the verdict by P3_VERDICT (./src/lib/sandbox-9/yardstick.js), from the founding's end; the side yardsticks beside it
		holds: allB((b) => (b.v3 ? b.v3.pass : b.p.P3.pass)),
		founding: `tenths failing ${YARDSTICKS[P3_VERDICT].label} ` + tenthsFailing(bases, 'founding', P3_VERDICT) + ` (beside it: ${SIDE.map((k) => `${nameOf(k)} ${tenthsFailing(bases, 'founding', k)}`).join('; ')}); extras’ falls that count ` + fallsCounted(bases, 'founding', P3_VERDICT) + ' (each extra: ' + bases.map((b) => b.p.P3.founding?.failures?.length ?? '–').join(', ') + '); COOP-days unable to pay (30 days or more) over the whole run ' + bases.map((b) => b.p.P3.coops.coopDaysUnableToPay30All ?? '–').join(', ') + ', receiverships in the founding ' + bases.map((b) => b.p.P3.coops.receivershipsInFounding ?? '–').join(', '),
		base: `tenths failing ${YARDSTICKS[P3_VERDICT].label} (of 20: ten by holdings, ten by Aven output) ` + tenthsFailing(bases, 'after', P3_VERDICT) + ` (beside it: ${SIDE.map((k) => `${nameOf(k)} ${tenthsFailing(bases, 'after', k)}`).join('; ')}); items failing: basics ` + bases.map((b) => b.p.P3.real?.basicsFail.length ?? '–').join(', ') + ', extras’ falls that count ' + fallsCounted(bases, 'after', P3_VERDICT) + ' (each extra: ' + bases.map((b) => b.p.P3.real?.failures.length ?? '–').join(', ') + '), baskets not rising ' + bases.map((b) => b.p.P3.real?.riseFail.length ?? '–').join(', ') + '. Old money index (comparison): ' + 'worst 5-year fall ' + bases.map((b) => pc(Math.max(...b.p.P3.deciles.map((d) => d.fall ?? 0)), 1)).join(', ') + '; deciles failing ' + bases.map((b) => b.p.P3.failed.length).join(', ') + '; without Aven services in the index, deciles failing ' + bases.map((b) => b.p.P3.withoutCompute.failed.length).join(', ') + '; Aven services’ share of the index in the last year ' + bases.map((b) => pc(b.p.P3.share.at(-1)?.all, 0)).join(', ') + '; COOP part ' + bases.map((b) => yes(b.p.P3.coops.pass)).join(', '),
		breaks: [...failE(['X10', 'SH']), ...fails(['B22', 'B27', 'S01', 'S03'].map(S))]
	});
	rows.push({
		part: 'Abundance limited only by physics',
		holds: allB((b) => b.p.abundance.pass) && [E('X9'), E('AB1'), E('X11')].every((x) => !x || x.verdict.pass) && [S('B14'), S('B28'), S('B29')].every((x) => !x || x.pass),
		founding: 'MIND bound a basic on ' + bases.map((b) => b.p.abundance.mindBindsBasicsInFounding ?? '–').join(', ') + ' day-goods',
		base: 'MIND bound a basic after the founding on ' + bases.map((b) => b.p.abundance.mindBindsBasics).join(', ') + ' day-goods (a day and a basic); ' + [['X9' + (E('X9')?.ens ? ` (${E('X9').ens.filter((x) => x.pass).length} of ${E('X9').ens.length} seeds)` : ''), E('X9')?.verdict], ['AB1', E('AB1')?.verdict], ['X11', E('X11')?.verdict], ['B14', S('B14')], ['B28', S('B28')], ['B29', S('B29')]].map(([id, v]) => `${id} ${v ? yes(v.pass) : '–'}`).join(', '),
		breaks: [...failE(['X9', 'X11', 'AB1']), ...fails(['B14', 'B28', 'B29'].map(S))]
	});
	return rows;
}

function report(exps, scen, bases, notCovered, meta) {
	const L = [];
	const nPass = exps.filter((e) => e.r.verdict.pass === true).length + scen.filter((s) => s.pass === true).length;
	const nCmp = scen.filter((s) => s.pass == null).length + exps.filter((e) => e.r.verdict.pass == null).length;
	L.push('# Sandbox 8 — the proof of Proposition 3', '');
	L.push(
		meta.loaded
			? `Rendered ${meta.now.slice(0, 16).replace('T', ' ')} UTC by \`node scripts/sandbox-9-proof.mjs --load ${meta.loaded}${meta.only ? ' --only ' + meta.only.join(',') : ''}\` from the saved runs (nothing ran again). Engine: \`src/lib/sandbox-9/\` (hash ${meta.hash}, the runs’ own). The runs took ${(meta.wall / 1000).toFixed(0)} s of wall time (${(meta.totalCpu / 1000).toFixed(0)} s of runs). Every number below comes from the runs; part 3’s verdict is judged from them by \`src/lib/sandbox-9/yardstick.js\` (${YARDSTICKS[P3_VERDICT].label}).`
			: `Run ${meta.now.slice(0, 16).replace('T', ' ')} UTC by \`node scripts/sandbox-9-proof.mjs${meta.quick ? ' --quick' : ''}${meta.only ? ' --only ' + meta.only.join(',') : ''}\`. Engine: \`src/lib/sandbox-9/\` (hash ${meta.hash}). Wall time ${(meta.wall / 1000).toFixed(0)} s on ${meta.threads} threads (${(meta.totalCpu / 1000).toFixed(0)} s of runs). Every number below comes from the run.`,
		''
	);
	if (meta.quick) L.push('**Quick run:** every scenario world was cut to at most 10 years. Verdicts below that need longer worlds read short ones; this is a smoke test, not the proof.', '');
	if (Object.keys(meta.set).length) L.push(`**Settings changed from the defaults in every world:** \`${JSON.stringify(meta.set)}\`.`, '');
	L.push(`${exps.length} experiments and ${scen.length} scenarios ran. ${nPass} pass and ${exps.length + scen.length - nPass - nCmp} fail${nCmp ? `; ${nCmp} only compare and have no verdict (${[...exps.filter((e) => e.r.verdict.pass == null).map((e) => e.r.id), ...scen.filter((s) => s.pass == null).map((s) => s.id)].join(', ')})` : ''}.`, '');

	// the simple numbers first: what people get, the village's food and energy, the diet and its land, the founding bill
	// and the border (round 3 brief: before the verdicts)
	if (bases.length) {
		simpleStats(L, bases, scen);
		aiMarket(L, bases, exps);
		foodAndLand(L, bases, scen);
		foundingAndBorder(L, bases, scen);
		priceTable(L, meta, bases);
	}

	// headline
	if (bases.length) {
		L.push('## Headline: does Proposition 3 hold?', '');
		L.push(`The base world: ${k0(bases[0].N)} people, ${Math.round(bases[0].s.days / 365)} years, seeds ${bases.map((b) => b.seed).join(', ')}. Each part is checked per person, every day. The strict test starts from a cold start, where everyone holds nothing; A07 tests owner-only newcomers who join a settled city.`, '');
		// (round 6) the claim's span: from the end of the founding
		const fd = bases.map((b) => b.p.founding ?? {});
		L.push(`**Proposition 3 is claimed from the end of the founding.** The founding is the build-out, from the two settlers until all ${k0(bases[0].N)} people are in. It ended on day ${fd.map((F) => F.endDay ?? '–').join(', ')} (year ${fd.map((F) => F.endYear ?? '–').join(', ')}) on seeds ${bases.map((b) => b.seed).join(', ')}. Every verdict below counts from that day; the founding's own numbers are in their own column, and the P3 rule reads full years from year ${fd.map((F) => F.firstFullYear ?? '–').join(', ')}.`, '');
		L.push(moneyLine(bases), '');
		L.push(borderLine(bases[0], scen), '');
		L.push('| part | base world, every seed (from the founding’s end) | what it shows | in the founding | where it breaks |', '|---|---|---|---|---|');
		for (const r of headline(exps, scen, bases)) L.push(`| ${r.part} | **${r.holds ? 'holds' : 'fails'}** | ${r.base} | ${r.founding ?? '–'} | ${r.breaks.length ? r.breaks.join(', ') : 'nowhere in this suite'} |`);
		L.push('');
		round6Section(L, bases, scen);
		p3Real(L, bases);
		yardsticksSection(L, bases, meta);
	}

	// the verdict table
	L.push('## Every experiment and scenario', '');
	L.push('| id | question or scenario | verdict | key result | people × years | run time |', '|---|---|---|---|---|---|');
	for (const e of exps) L.push(`| ${e.r.id} | ${e.r.question} | **${yes(e.r.verdict.pass)}** | ${e.r.verdict.evidence.replace(/\|/g, '/')} | ${e.r.people.base === e.r.people.changed ? e.r.people.base : `${e.r.people.base} / ${e.r.people.changed}`} × ${e.r.years} | ${(e.ms / 1000).toFixed(1)} s |`);
	for (const s of scen) L.push(`| ${s.id} | ${s.name} | **${yes(s.pass)}** | ${s.takeaway.replace(/\|/g, '/')} | ${[...new Set(s.runs.map((r) => `${r.people ?? 1500} × ${r.years}`))].join(', ')} | ${(s.ms / 1000).toFixed(0)} s |`);
	L.push('');

	// experiments, Primer style
	if (exps.length) {
		L.push('## The experiments (Primer style)', '');
		L.push('Each experiment runs two worlds on the same seed. Only one rule differs. The page runs the same experiment at the same size, so it shows these numbers live.', '');
		for (const e of exps) {
			const r = e.r;
			L.push(`### ${r.id}: ${r.question}`, '');
			L.push(`**Rule changed.** ${r.ruleChanged}`, '');
			L.push(`**Size.** ${r.people.base === r.people.changed ? r.people.base + ' people' : `${r.people.base} people (base), ${r.people.changed} (changed)`}, ${r.years} year${r.years === 1 ? "" : "s"}, seed ${r.seed}. Both worlds ran in ${(e.ms / 1000).toFixed(1)} s in node.`, '');
			L.push('**Guesses (before the run).**', '', ...r.guesses.map((g) => `- ${g}`), '');
			if (r.charts?.length) L.push(`**Charts.** ${r.charts.join('; ')}.`, '');
			L.push('| metric | base | changed |', '|---|---|---|');
			for (const m of r.metrics) L.push(`| ${m.label} | ${cellOf(m.base)} | ${cellOf(m.changed)} |`);
			L.push('');
			L.push(`**Takeaway (computed).** ${r.takeaway}`, '');
			L.push(`**Claim.** ${r.verdict.claim} **${yes(r.verdict.pass)}.** ${r.verdict.evidence}`, '');
			L.push(`Proposition 3 in each world: base ${p3s(r.base.prop3)}; changed ${p3s(r.changed.prop3)}.`, '');
		}
	}

	// scenarios
	if (scen.length) {
		L.push('## The scenarios (world model section 6)', '');
		L.push('Each scenario runs the worlds listed, from day 0. Runs that scenarios share ran once.', '');
		for (const s of scen) {
			L.push(`### ${s.id} ${s.name} (${s.paper})`, '');
			L.push(`**Stress.** ${s.stress}.`, '');
			L.push(`**Claim.** ${s.claim}`, '');
			L.push(`**Runs.** ${s.runs.map((r) => `${r.label} (${k0(r.people ?? 1500)} people, ${r.years} years)`).join('; ')}.`, '');
			L.push(`**Result.** ${s.takeaway}`, '');
			L.push(`**Verdict: ${yes(s.pass)}.** ${s.evidence}`, '');
		}
	}

	// what fails and why
	const failing = [...exps.filter((e) => e.r.verdict.pass === false).map((e) => [e.r.id, e.r.verdict.evidence]), ...scen.filter((s) => s.pass === false).map((s) => [s.id, s.evidence])];
	if (failing.length) {
		L.push('## What fails', '');
		L.push('Each item fails in this run; the line under it is the run’s own evidence (scenario evidence names the short good, its binding limit and the parts that fail, computed from the worlds). No cause or fix is typed in here: a note written by hand can outlive the run it was true of.', '');
		for (const [id, ev] of failing) L.push(`- **${id}:** ${ev}`);
		L.push('');
	}

	// not covered
	L.push('## Not covered yet', '');
	L.push('These section 6 scenarios do not run in this suite. Nothing else is left out.', '');
	L.push('| id | scenario | why not |', '|---|---|---|');
	for (const [id, name, why] of notCovered) L.push(`| ${id} | ${name} | ${why} |`);
	L.push('');

	if (bases.length) baseEvidence(L, bases, exps, meta);
	return L.join('\n');
}
// ── round 6: how money leaves, P2 strict's bound, the bank's turning years, the pools' LVR ───────────────────────────
/** the money rule in one paragraph, checked on the base worlds' ledgers */
function moneyLine(bases) {
	const led = bases.map((b) => b.s.ledger);
	const ly = bases.map((b) => b.s.years.at(-1) ?? {});
	return (
		`**Where money goes.** Payments only move MIND. MIND leaves existence only by the melt (7 % a year) and by a failed COOP’s MIND retired from the pools. ` +
		`This engine has no retirement: a failed COOP’s MIND stays with its holders and in the pools and melts away like any other, so in these runs the melt is the only exit (retired from the pools: 0 MIND on every seed). ` +
		`The money ledger (each MIND’s count today = yesterday’s + what HEARTS made − what melted) closed every day on every seed: largest relative gap ${led.map((l) => (l.mindMaxRel ?? 0).toExponential(1)).join(', ')}, leaks ${led.map((l) => l.mindLeaks.length).join(', ')}; the laws’ checks (Law 4’s 0.5 / 0.4 / 0.1, Law 5’s fifth) largest gap ${led.map((l) => (l.lawMaxRel ?? 0).toExponential(1)).join(', ')}; the pools’ invariant (a swap never lowers a basket’s product of reserves) checked ${led.map((l) => k0(l.poolChecks ?? 0)).join(', ')} times, broken ${led.map((l) => l.poolBreaches?.length ?? 0).join(', ')} times. In the last year HEARTS made ${ly.map((y) => f(y.issuedPP)).join(', ')} R of MIND a person a day and the melt took ${ly.map((y) => f(y.meltPP)).join(', ')}. ` +
		`**The pools’ LP tokens** belong to the ${led[0]?.lpOwner === 'CITY' ? 'MaiaCity COOP (the City COOP)' : led[0]?.lpOwner}; it may redeem them only by a passed MIP, and no redemption ran in the base worlds (redeemed: ${led.map((l) => f(l.lpRedeemedR ?? 0)).join(', ')} R).`
	);
}

/** (round 6) P2 strict's bound, the bank's turning years and each basket's loss to arbitrage against its fees */
function round6Section(L, bases, scen) {
	const R6 = bases.map((b) => ({ seed: b.seed, r: b.s.r6 })).filter((x) => x.r);
	if (!R6.length) return;
	const lam = bases[0].s.params?.law5 ?? 0.2;
	// the fixes round 6 tested: each a switch, on by default only if it helped its target and made no other check worse
	const st = bases[0].s.params?.settings ?? {};
	const FIX = [
		['ownerDefer', 'an owner-only Aven treats what a rationed extra left unspent as income deferred (B1)'],
		['holdingFloor', 'a holding floor in the basic sellers’ MIND, in days of the bundle (B1)'],
		['foundingSignal', 'a founding signal on unmet need in the build-out (B13 rule 1)'],
		['newcomerStart', 'a newcomer’s first HEARTS go to the basic sellers, in days (B3, B15)'],
		['basicsWork', 'the basics’ Aven hours first, their inference with the basics (B5; scenario SHW)'],
		['lineMw', 'a larger line to the grid, MW (B12)']
	];
	L.push('### Round 6’s fixes', '');
	L.push(`Each fix is a switch (engine.md beside this file has each one’s traced cause and its same-seed runs). A fix is on in the base only if, on the same seeds, it helped its target and made no other check worse. In these base worlds: ${FIX.map(([k, what]) => `${what}: **${st[k] == null || st[k] === false || st[k] === 0 ? 'off' : String(st[k])}**`).join('; ')}.`, '');
	L.push('### P2 strict: the bound Law 5 sets', '');
	L.push(`Law 5 pays an owner-only person λ × (its share of all holdings) × (all sales). Divided by its bundle: **dividends ÷ bundle = λ × (N × its share of holdings) × (all sales ÷ everyone’s basic bundle)**, with λ = ${pc(0.2, 0)} (never changed). N × share is 1 for a person who holds an equal share; the identity is exact when a person’s holding is spread over the MINDs as the city’s is. All holdings: people, the COOPs’ treasuries (but each its own MIND, which Law 5 skips) and the city’s pools. All sales: every sale Law 5 paid on (to people, between COOPs, rent), the B2B part apart. For dividends alone to pay the bundle, all sales ÷ basics must reach 1 ÷ (λ × N × share).`, '');
	const b0 = R6[0];
	const YS = [1, 2, 3, 5, 6, 10, 20, 30, 40, 50, 60];
	L.push(`Seed ${b0.seed}, year by year (yearly means):`, '');
	L.push('| year | all sales ÷ basics | to people | between COOPs (B2B) | rent and other | pools’ share of all holdings | owner-only N × share (median / lowest) | the bound, λ × N × share × sales ÷ basics (median / lowest) | dividends ÷ bundle, as run (median / lowest) | sales ÷ basics it would need (median / lowest) |', '|---|---|---|---|---|---|---|---|---|---|');
	for (const y of b0.r.years.filter((y) => YS.includes(y.year))) L.push(`| ${y.year} | ${f(y.salesOverBasics)} | ${f(y.peopleOverBasics)} | ${f(y.b2bOverBasics)} | ${f(y.otherOverBasics)} | ${pc(y.poolsShareOfHoldings)} | ${f(y.ownerRelShareMed)} / ${f(y.ownerRelShareMin)} | ${f(y.boundMed)} / ${f(y.boundMin)} | ${f(y.actualMed)} / ${f(y.actualMin)} | ${f(y.neededSalesOverBasicsMed, 1)} / ${f(y.neededSalesOverBasicsMin, 1)} |`);
	L.push('');
	const last = R6.map((x) => ({ seed: x.seed, y: x.r.years.at(-1) }));
	const holds = last.every((x) => x.y && x.y.boundMin >= 1);
	L.push(`In the last year, on seeds ${last.map((x) => x.seed).join(', ')}: all sales ÷ basics ${last.map((x) => f(x.y?.salesOverBasics)).join(', ')} (B2B ${last.map((x) => f(x.y?.b2bOverBasics)).join(', ')}); the lowest owner-only N × share ${last.map((x) => f(x.y?.ownerRelShareMin)).join(', ')}; the bound for that person ${last.map((x) => f(x.y?.boundMin)).join(', ')}. ${holds ? 'The bound reaches 1 on every seed.' : `**The strict test cannot hold under these sales:** at 20 % it would need all sales ÷ basics of ${last.map((x) => f(x.y?.neededSalesOverBasicsMin, 1)).join(', ')} for the lowest owner-only holding (${last.map((x) => f(x.y?.neededSalesOverBasicsMed, 1)).join(', ')} for the median), against ${last.map((x) => f(x.y?.salesOverBasics)).join(', ')} as run.`}`, '');
	L.push('### The bank’s turning years', '');
	L.push('| seed | first year from which each year’s exports cover its imports, to the end | first year the cumulative balance is positive | the best year (exports less imports) |', '|---|---|---|---|');
	for (const x of R6) L.push(`| ${x.seed} | ${x.r.bank.runningPositiveYear ?? 'never'} | ${x.r.bank.cumulativePositiveYear ?? 'never'} | ${x.r.bank.bestYear ? `year ${x.r.bank.bestYear.year}: ${x.r.bank.bestYear.bal < 0 ? '−' : '+'}€${Math.abs(x.r.bank.bestYear.bal / 1e6).toFixed(2)} M` : '–'} |`);
	L.push('');
	L.push('### The pools: each basket’s loss to arbitrage (LVR) against its fees', '');
	L.push(`LVR is what the Avens’ arbitrage takes out of a basket less what it puts in after the fee, valued at the consensus prices of the moment (the pools’ own: the engine has no outside price, so this is the loss between baskets, not against an outside market); fees are the 0.3 % on every swap through the basket, payments and arbitrage alike. Seed ${b0.seed}, over the run and over its last ten years:`, '');
	L.push('| basket | fee income, run (R) | LVR, run (R) | fees, last 10 years | LVR, last 10 years | LVR below fees | reserve at the end (R) |', '|---|---|---|---|---|---|---|');
	for (const p of b0.r.lvr) L.push(`| ${p.members.join(', ')} | ${cellOf(p.feeR)} | ${cellOf(p.lvrR)} | ${cellOf(p.fee10R)} | ${cellOf(p.lvr10R)} | ${p.below ? 'yes' : '**no**'} | ${cellOf(p.reserveR)} |`);
	L.push('');
	const below = R6.map((x) => `${x.r.lvr.filter((p) => p.below).length} of ${x.r.lvr.length}`);
	L.push(`Baskets whose LVR stayed below their fee income over the run: ${below.join(', ')} (seeds ${R6.map((x) => x.seed).join(', ')}).`, '');
	// round 6 against round 5 on the same seeds and shocks (scenario R56), Law 5 with and without the pools (L5P), SH
	// with and without the basics' work first (SHW)
	const r56 = scen.find((x) => x.id === 'R56');
	if (r56?.numbers?.rows) {
		L.push('### Round 6 against round 5, same seeds and shocks (R56)', '');
		L.push(`Each of the seeds ${r56.numbers.seeds.join(', ')} ran 60 years under round 6’s rules and under round 5’s (Law 4’s pools’ part 0.05, Law 5 without the pools), with the same weather and draws, judged from the founding’s end. A win is a seed where round 6 is better on that check; a tie, where both are equal. The p-value is a two-sided sign test on the wins and losses.`, '');
		L.push('| check | better under round 6 | worse | tied | sign test p | round 6, by seed | round 5, by seed |', '|---|---|---|---|---|---|---|');
		const cell = (a) => a.map((x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? k0(x) : f(x)) : '–')).join(', ');
		for (const r of r56.numbers.rows) L.push(`| ${r.label} | ${r.win} | ${r.loss} | ${r.tie} | ${r.p.toFixed(3)} | ${cell(r.r6)} | ${cell(r.r5)} |`);
		L.push('', r56.takeaway, '');
	}
	for (const id of ['L5P', 'SHW']) {
		const x = scen.find((y) => y.id === id);
		if (x) L.push(`**${id}, ${x.name}.** ${x.takeaway} ${x.evidence ?? ''}`, '');
	}
}

// ── the simple numbers (round 3): what people get, the village's food and energy, the diet, the border ───────────
const k0 = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '–');
const k1 = (x) => (Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '–');
const eurM = (x) => (Number.isFinite(x) ? `€${(x / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} M` : '–');
const YEARS_SHOWN = [1, 2, 3, 5, 10, 15, 20, 30, 40, 50, 60];
const TENTH_NAMES = { poorest: 'poorest tenth', middle: 'middle (5th) tenth', richest: 'richest tenth' };
const MEASURES = [
	['kcal', 'kcal eaten (need 2,240)', k0],
	['protein', 'protein g (need 73)', k0],
	['homeM2', 'm² of home', k1],
	['waterL', 'litres of water', k0],
	['homeKwh', 'kWh at home', k1],
	['avenH', 'hours of Aven help', k1],
	['goodsKgYear', 'kg of goods a year', k0],
	['pondHWeek', 'hours at the warm ponds a week', k1]
];

function simpleStats(L, bases, scen) {
	const b0 = bases[0], s0 = b0.s, Ls = s0.living ?? [], Vs = s0.village ?? [], fl = s0.food ?? {};
	const ys = YEARS_SHOWN.filter((y) => y <= Ls.length);
	L.push('## The village of 1,500: what people get, year by year', '');
	const ramp = !!s0.founding?.ramp;
	L.push(`${k0(b0.N)} people live in Sandbox 6’s village: six living hexes of homes, food domes and food forest round a centre hex of works, ${k0(s0.params?.settings?.beds)} beds, ${s0.params?.settings?.tower ? 'with the Tower180' : 'no tower'}. ${ramp ? `The run starts with two settlers on day 0, and the village is built around them, settlement by settlement; people move in as beds are finished (1,500 from month ${s0.founding.peopleMonth}), so the first years below are the build-out years and their tenths are of fewer people (the people column).` : 'The run starts on moving-in day, with the outdoor food forest just planted.'} They eat ${fl.dietLabel ?? fl.diet} (${k0(fl.kcalDay)} kcal and ${k0(fl.proteinDay)} g of protein a day as planned; need 2,240 kcal and 73 g). Tenths are by MIND holdings, each a yearly mean a person a day unless it says otherwise. Seed ${b0.seed}; the five seeds side by side follow.`, '');
	L.push('| year | people (mean) | tenth | ' + MEASURES.map((m) => m[1]).join(' | ') + ' | people short of anything that year |', '|---|---|---|' + '---|'.repeat(MEASURES.length + 1));
	for (const y of ys) {
		const r = Ls[y - 1];
		for (const [k, name] of Object.entries(TENTH_NAMES)) L.push(`| ${y} | ${k0(r.peopleMean ?? r.people)} | ${name} | ${MEASURES.map(([m, , fm]) => fm(r.tenths[k][m])).join(' | ')} | ${k0(r.tenths[k].shortPeople)} |`);
	}
	L.push('');
	const av = Ls.filter((r) => r.days >= 365).map((r) => r.tenths.poorest.avenH);
	if (av.length) L.push(`Aven help for the poorest tenth runs from ${k1(Math.min(...av))} to ${k1(Math.max(...av))} hours a day over the run: Aven service comes from the AI market (the next section): the Tribe COOPs and the Village COOP sell inference, avenCEO sells the hours, and each person’s Aven splits what its person buys between help and work.`, '');
	// the five seeds: mean (lowest–highest)
	L.push('**All five seeds** (mean over the seeds, lowest–highest in brackets):', '');
	const span = (xs, fm) => (xs.length ? `${fm(xs.reduce((a, x) => a + x, 0) / xs.length)} (${fm(Math.min(...xs))}–${fm(Math.max(...xs))})` : '–');
	L.push('| year | tenth | kcal | protein g | hours of Aven help | kg of goods a year | hours at the ponds a week | people short (all seeds) |', '|---|---|---|---|---|---|---|---|');
	for (const y of [1, 5, 10, 30, 60].filter((y) => bases.every((b) => (b.s.living ?? []).length >= y))) {
		for (const [k, name] of Object.entries(TENTH_NAMES)) {
			const rs = bases.map((b) => b.s.living[y - 1].tenths[k]);
			L.push(`| ${y} | ${name} | ${span(rs.map((r) => r.kcal), k0)} | ${span(rs.map((r) => r.protein), k0)} | ${span(rs.map((r) => r.avenH), k1)} | ${span(rs.map((r) => r.goodsKgYear), k0)} | ${span(rs.map((r) => r.pondHWeek), k1)} | ${k0(rs.reduce((a, r) => a + r.shortPeople, 0))} |`);
		}
	}
	L.push('');
	// the village a year
	L.push('### The whole village, a person a day', '');
	L.push('Food in kcal: what the forest outdoors and the food domes put in the stores (after the harvest’s losses), what the food COOPs bought abroad, what people ate, and what was lost in storage, processing and the kitchen. Electricity in kWh: made by the solar cells in the glass and the geothermal plant, and where it went (basics first, then running the works and homes, building, R&D, the line’s exports, storage; curtailed is what nobody could use).', '');
	L.push('| year | food outdoors | food domes | bought abroad | eaten | lost | solar | geothermal | basics | running | building | R&D | exported | storage | curtailed |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
	for (let y = 1; y <= Vs.length; y += y < 10 ? 1 : 5) {
		const v = Vs[y - 1], m = v.energy.made, g = v.energy.went;
		L.push(`| ${y} | ${k0(v.food.outdoors)} | ${k0(v.food.indoors)} | ${k0(v.food.imported)} | ${k0(v.food.eaten)} | ${k0(v.food.lost)} | ${k1(m.solar)} | ${k1(m.geothermal)} | ${k1(g.basics)} | ${k1(g.running)} | ${k1(g.building)} | ${k1(g.rd)} | ${k1(g.export)} | ${k1(g.storage)} | ${k1(g.curtailed)} |`);
	}
	if (Vs.length && Vs.length % 5 !== 0 && Vs.length > 10) {
		const v = Vs[Vs.length - 1], m = v.energy.made, g = v.energy.went;
		L.push(`| ${Vs.length} | ${k0(v.food.outdoors)} | ${k0(v.food.indoors)} | ${k0(v.food.imported)} | ${k0(v.food.eaten)} | ${k0(v.food.lost)} | ${k1(m.solar)} | ${k1(m.geothermal)} | ${k1(g.basics)} | ${k1(g.running)} | ${k1(g.building)} | ${k1(g.rd)} | ${k1(g.export)} | ${k1(g.storage)} | ${k1(g.curtailed)} |`);
	}
	L.push('');
	L.push('### What binds each good (the limit on most days of the year)', '');
	const yb = [1, 5, 10, 30, 60].filter((y) => y <= Vs.length);
	const goods = Object.keys(Vs[0]?.binds ?? {});
	L.push('| good | ' + yb.map((y) => `year ${y}`).join(' | ') + ' |', '|---|' + '---|'.repeat(yb.length));
	for (const g of goods) L.push(`| ${g} | ${yb.map((y) => `${Vs[y - 1].binds[g]} (${pc(Vs[y - 1].bindShare?.[g], 0)})`).join(' | ')} |`);
	L.push('');
	// the food domes by month
	const im = s0.indoorMonths;
	if (im) {
		const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		L.push('### The food domes by month (kcal a person a day)', '');
		L.push(`At maturity, after losses, for the domes as they stand at the end of the run: without lamps, and with an LED top-up raising November to February to 12 mol a m² a day (about ${k0(im.ledKwhM2Year)} kWh a m² a year at ${k0(im.ledKwhPer1000)} kWh a 1,000 kcal; scenario F04 runs it). Then what the domes gave in year 10 of the run.`, '');
		L.push('| | ' + MN.join(' | ') + ' |', '|---|' + '---|'.repeat(12));
		L.push('| without light | ' + im.withoutLight.map(k0).join(' | ') + ' |');
		L.push('| with LED light | ' + im.withLight.map(k0).join(' | ') + ' |');
		const v10 = Vs[Math.min(10, Vs.length) - 1];
		if (v10) L.push(`| the run, year ${v10.year} | ` + v10.indoorByMonth.map(k0).join(' | ') + ' |');
		L.push('');
	}
	// what goes up, what goes down, and why: computed from the tables
	L.push('### What goes up, what goes down, and why', '');
	L.push(trendParagraph(s0), '');
}

/**
 * The AI market (round 4): who owns the accelerators, the inference sold to the AI COOPs and its price, the Aven hours
 * a person by tenth of holdings (help and work), each tenth's MIND income by source, the accelerators imported, what
 * bound the Aven service; the trap (does the poorest tenth earn?); and the bank with and without AI exports (AIX).
 */
function aiMarket(L, bases, exps) {
	const b0 = bases[0], A = b0.s.ai ?? [];
	if (!A.length) return;
	const k2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
	const k3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '–');
	L.push('## The AI market (avenCEO)', '');
	L.push('The Tribe COOPs and the Village COOP own the accelerators, in the data halls of their utility domes, and run them on their own power. They buy them through the euro border with euros the MaiaCity COOP’s bank advances, repaid in their own MIND, and replace them as they wear. They sell inference by the accelerator-hour to the AI COOPs: the avenCEO COOP, founded at the founding, and any rival Law 3 founds. avenCEO pays the owners in its own MIND (Law 5 on every sale), runs the harnesses and sells Aven service to the people. A person’s Aven spends Aven hours on help for its person, bought from what the person holds, and on work proposals for the COOPs (their running proposals and new work proposals). Each COOP pays those items by skill × hours delivered; the pay settles the hours’ Aven service first and the person gets the rest, so nobody needs MIND in hand before their Aven can work. The owner-only cohort does no work. An Aven hour takes a sixteenth of an accelerator-hour (sixteen sessions an accelerator, less as the harness learns); the people pay the inference in each hour straight to the owners, on avenCEO’s bill.', '');
	const ys = [1, 2, 3, 5, 10, 20, 30, 40, 50, 60].filter((y) => A.some((r) => r.year === y && r.days >= 365));
	L.push(`Seed ${b0.seed}, a person a day unless it says otherwise:`, '');
	L.push('| year | people | accelerators (owners) | imported (€) | capacity, accelerator-h a day | inference sold, accelerator-h a day (use) | price, R an accelerator-h | Aven help h | Aven work h | COOP work asked · done, h a day | what bound the Aven service (share of days) |', '|---|---|---|---|---|---|---|---|---|---|---|');
	for (const y of ys) {
		const r = A.find((x) => x.year === y);
		const own = (r.owners ?? []).filter((o) => o.chips > 0.5);
		L.push(`| ${y} | ${k0(r.people)} | ${k0(r.chips)} (${own.map((o) => `${o.label ?? o.id} ${k0(o.chips)}`).join(', ') || '–'}) | ${k0(r.imported?.n)} (€${k0(r.imported?.eur)}) | ${k0(r.capAHDay)} | ${k0(r.AHDay)} (${pc(r.utilization, 0)}) | ${k3(r.inferPriceR)} | ${k1(r.all?.helpH)} | ${k1(r.all?.workH)} | ${k0((r.work?.runNeedDay ?? 0) + (r.work?.propNeedDay ?? 0))} · ${k0(r.work?.hoursDay)} | ${r.bind?.words ?? '–'} (${pc(r.bind?.share, 0)}) |`);
	}
	L.push('');
	L.push('**By tenth of MIND holdings** (seed ' + b0.seed + '): Aven hours a person a day (help · work) and MIND income in R a day by source: the HEARTS half (what the person’s own 24 HEARTS make), work proposals, Law 5 dividends.', '');
	L.push('| year | tenth | help h | work h | HEARTS half | work proposals | dividends | all | share from work |', '|---|---|---|---|---|---|---|---|---|');
	for (const y of [1, 5, 10, 30, 60].filter((y) => A.some((r) => r.year === y))) {
		const r = A.find((x) => x.year === y);
		for (const k of [1, 2, 5, 10]) {
			const t = r.tenths?.[k];
			if (!t) continue;
			const all = (t.hearts ?? 0) + (t.work ?? 0) + (t.div ?? 0);
			L.push(`| ${y} | ${k === 1 ? '1 (poorest)' : k === 10 ? '10 (richest)' : k} | ${k1(t.helpH)} | ${k1(t.workH)} | ${k2(t.hearts)} | ${k2(t.work)} | ${k2(t.div)} | ${k2(all)} | ${pc(all > 0 ? t.work / all : NaN, 0)} |`);
		}
	}
	L.push('');
	// where it binds: accelerators × hours × electricity, or the people's MIND, or what people want
	const binds = {};
	for (const r of A.filter((x) => x.days >= 365)) binds[r.bind?.words ?? '–'] = [...(binds[r.bind?.words ?? '–'] ?? []), r.year];
	const span = (yy) => (yy.length > 1 ? `years ${yy[0]}–${yy.at(-1)}` : `year ${yy[0]}`);
	L.push(`**Where it binds.** ${Object.entries(binds).map(([why, yy]) => `${cap1(why)}: ${span(yy)} (${yy.length} year${yy.length > 1 ? 's' : ''})`).join('; ')}. The physical limit is accelerators × hours × electricity: the owners keep ${pc(1 / 1.25, 0)} of their capacity in use and buy another accelerator when they run short, so the accelerators bind only for the days before a new one arrives; while the village is built, what binds is what people can pay (their MIND), and once it is built, what people want at the day’s prices. ${A.some((r) => r.spaceShortDays > 0) ? `The data halls ran out of floor on ${k0(A.reduce((a, r) => a + (r.spaceShortDays ?? 0), 0))} days.` : 'The data halls never ran out of floor.'}`, '');
	// the trap
	const last = A.filter((r) => r.days >= 365).at(-1), first = A.find((r) => r.days >= 365 && r.year >= 2) ?? A[0];
	const t1 = last?.tenths?.[1], t5 = last?.tenths?.[5], f1 = first?.tenths?.[1];
	if (t1 && t5) {
		const inc = (t) => (t.hearts ?? 0) + (t.work ?? 0) + (t.div ?? 0);
		const nc = b0.s.newcomers ?? {};
		L.push(`**The trap: does the poorest tenth get out?** In year ${last.year} the poorest tenth’s Avens by holdings worked ${k1(t1.workH)} hours a person a day for the COOPs (the middle tenth ${k1(t5.workH)}), earned ${k2(t1.work)} R a day from work proposals (the middle tenth ${k2(t5.work)}), and had ${k2(inc(t1))} R a day of MIND income in all, ${pc(inc(t1) / Math.max(1e-12, inc(t5)), 0)} of the middle tenth’s; ${pc(t1.hearts / Math.max(1e-12, inc(t1)), 0)} of it is the HEARTS half (in year ${first.year}: ${k1(f1?.workH)} work hours and ${k2(f1?.work)} R from work). An Aven works for the COOPs only while an hour of its work earns at least what the Aven hour costs; the work proposal’s pay settles the hour’s Aven service first and the person gets the rest (the work income here is that rest), so nobody needs MIND in hand before their Aven can work. Work proposals pay by skill × hours, so a low-skill Aven earns little, and the owner-only cohort does no work at all. The poorest tenth is mostly these people and newcomers who arrive holding nothing: a newcomer’s Aven works from its first day and is paid that evening; on its first day the HEARTS half alone did not pay for all its basics in the build-out’s dear quarters (P1, the arrival day).`, '');
	}
	// the bank with and without AI exports
	const aix = exps.find((e) => e.r.id === 'AIX');
	if (aix) {
		const b = aix.r.base.values, c = aix.r.changed.values;
		const when = (v) => (v.repayYear > 0 ? `in year ${k0(v.repayYear)}` : v.netLast10M > 0 ? `not within the ${aix.r.years} years (about ${k0(-v.cumEndM / v.netLast10M)} more years at the last decade’s pace)` : 'never at the last decade’s pace: exports did not cover imports');
		L.push(`**The bank with and without AI exports (AIX, seed ${aix.r.seed}, ${aix.r.years} years).** Electricity only (the base): bootstrap number €${k2(b.bootstrapM)} M, cumulative balance €${k2(b.cumEndM)} M at the end, repaid ${when(b)}. With Aven service sold abroad at €2 a GPU-hour (a small provider’s demand, 1,024 accelerators at 55 % use, estimated): bootstrap number €${k2(c.bootstrapM)} M, cumulative balance €${k2(c.cumEndM)} M at the end, repaid ${when(c)}. AI exports earned €${k0(c.aiEurY)} a year on average, while the accelerators bought for the village and the export cost €${k0(c.chipEurY)} a year (electricity only: €${k0(b.chipEurY)}); ${k0(c.chipsEnd)} accelerators stood at the end against ${k0(b.chipsEnd)}. The accelerators an exported hour runs on are bought abroad too, so only the margin over their price and electricity comes home.`, '');
	}
}

/** the text with its first letter capitalized */
const cap1 = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** one plain paragraph from the run's own tables: each measure's change for the poorest and richest tenths from the first full year to the last, and what bound the good behind it in the last year */
function trendParagraph(s) {
	const Ls = s.living ?? [], Vs = s.village ?? [];
	if (Ls.length < 2) return 'The run is too short to say.';
	const a = Ls[0], z = Ls[Ls.length - 1], vz = Vs[Vs.length - 1], va = Vs[0];
	const goodOf = { kcal: 'food', homeM2: 'bed', waterL: 'water', homeKwh: 'energy', avenH: 'compute', goodsKgYear: 'goods', pondHWeek: 'spring' };
	const names = { kcal: 'Food eaten', homeM2: 'Home space', waterL: 'Water', homeKwh: 'Electricity at home', avenH: 'Aven help', goodsKgYear: 'The weight of goods a year', pondHWeek: 'Time at the warm ponds' };
	const fm = { kcal: k0, homeM2: k1, waterL: k0, homeKwh: k1, avenH: k1, goodsKgYear: k0, pondHWeek: k1 };
	const way = (x0, x1) => (!(x0 > 0) ? (x1 > 0 ? 'rises from nothing' : 'stays at nothing') : x1 / x0 > 1.05 ? 'goes up' : x1 / x0 < 0.95 ? 'goes down' : 'stays about level');
	const parts = [];
	for (const m of Object.keys(names)) {
		const p0 = a.tenths.poorest[m], p1 = z.tenths.poorest[m], r0 = a.tenths.richest[m], r1 = z.tenths.richest[m];
		const g = goodOf[m];
		parts.push(`${names[m]} ${way(p0, p1)} for the poorest tenth (${fm[m](p0)} → ${fm[m](p1)}) and ${way(r0, r1)} for the richest (${fm[m](r0)} → ${fm[m](r1)}); in the last year it was bound by ${vz?.binds?.[g] ?? '–'}.`);
	}
	const imp0 = va?.food.eaten > 0 ? va.food.imported / va.food.eaten : NaN, imp1 = vz?.food.eaten > 0 ? vz.food.imported / vz.food.eaten : NaN;
	const e0 = va ? va.energy.made.solar + va.energy.made.geothermal : NaN, e1 = vz ? vz.energy.made.solar + vz.energy.made.geothermal : NaN;
	parts.push(`Behind them: the food bought abroad went from ${pc(imp0, 0)} of what was eaten in year 1 to ${pc(imp1, 0)} in year ${Ls.length}, as the forest outdoors grew from ${k0(va?.food.outdoors)} to ${k0(vz?.food.outdoors)} kcal a person a day; electricity made went from ${k1(e0)} to ${k1(e1)} kWh a person a day (solar ${k1(va?.energy.made.solar)} → ${k1(vz?.energy.made.solar)}, geothermal ${k1(va?.energy.made.geothermal)} → ${k1(vz?.energy.made.geothermal)}), and the line exported ${k1(va?.energy.went.export)} → ${k1(vz?.energy.went.export)} of it to pay for what the village buys abroad.`);
	return `Year 1 against year ${Ls.length}, seed ${s.seed}. ` + parts.join(' ');
}

function foodAndLand(L, bases, scen) {
	const s0 = bases[0].s, fl = s0.food;
	if (!fl) return;
	L.push('## The diet and the land it takes', '');
	L.push(`${fl.dietLabel}. Yields: ${fl.yieldsLabel}. A person’s day as planned, and the land it takes at maturity (no losses; the layers’ land equivalent ratio 1.1), outdoors and under glass; the hens’ feed is grown too (its land is in the legume, seed and root rows).`, '');
	const groups = Object.entries(fl.groups);
	L.push('| group | g a day | kcal | protein g | m² outdoors | m² under glass |', '|---|---|---|---|---|---|');
	for (const [k, g] of groups) L.push(`| ${g.label} | ${k0(g.g)} | ${k0(g.kcal)} | ${k1(g.protein)} | ${k0(fl.landM2.outByGroup[k])} | ${k0(fl.landM2.inByGroup[k])} |`);
	L.push(`| **a person’s day** | | **${k0(fl.kcalDay)}** | **${k1(fl.proteinDay)}** | **${k0(fl.landM2.out)}** | **${k0(fl.landM2.in)}** |`, '');
	const kv = fl.kcalM2Village ?? {};
	L.push(`Grown all outdoors, a m² gives ${k0(fl.kcalM2Year.out)} kcal of this diet a year at maturity; under glass, ${k0(fl.kcalM2Year.in)} kcal of the part of it the glass can grow (sweet potato, vegetables, fruit). The village splits its land by the diet’s groups, as food-best.md does: the glass grows sweet potato, vegetables and fruit, the outdoor land grows the beans, nuts, seeds and the hens’ feed for the same people, and the whole diet on what is left. So the village grows ${k0(kv.out)} kcal and ${k0(kv.proteinOut)} g of protein a net m² a year outdoors and ${k0(kv.in)} kcal and ${k0(kv.proteinIn)} g under glass (before the harvest’s losses), and the engine grows its food at exactly these yields. With 15 % lost after the harvest, the village’s ${k1(fl.foodHa.out)} net ha outdoors (${k1(fl.foodHa.outGross)} ha less tracks, sheds, hedges and the compost ley) and ${k1(fl.foodHa.in)} ha under glass feed **${k0(fl.peopleFed.all)} people** in an average mature year (${k0(fl.peopleFed.out)} from outdoors, ${k0(fl.peopleFed.in)} from the domes; ${fl.peopleFedByGroup?.bind ?? 'the glass'} binds the split); ${k0(bases[0].N)} live there. The village’s own food share (\`borderYears\` ownFoodShare, on the page) is what its land grew and kept after the harvest’s losses, over what everyone needs: it never counts stores or imports. People eat above need when they can pay, so a share over 100 % can stand beside food still bought abroad.`, '');
	// people fed per yield setting (food-best.md: ~1,100 at measured averages, ~1,660 at top yields, fully counted)
	const fb = fl.peopleFedBy;
	if (fb) {
		const f03 = scen.find((x) => x.id === 'F03');
		const runOf = (key) => (f03?.numbers?.rows ?? []).find((r) => r.yields === key);
		L.push('**People fed at each yield setting** (at maturity, an average year, after losses; food-best.md counts ~1,100 at measured averages and ~1,660 at top yields with paths and the ley counted). The run columns are scenario F03 (30 years each, seed 20261012):', '');
		L.push('| yields | m² a person outdoors (all outdoors) | m² a person under glass | kcal a net m² a year outdoors, as the village grows it | protein g | kcal a m² under glass | protein g | people the land feeds | last year food was bought (over 1 % of what was eaten) | first year it grew all it needs | person-days short |', '|---|---|---|---|---|---|---|---|---|---|---|');
		for (const [key, label] of [['average', 'measured averages'], ['best', 'top practice (best)'], ['ramp', 'the base: averages to year 5, best by year 10']]) {
			const x = key === 'ramp' ? fb.best : fb[key];
			const r = runOf(key);
			L.push(`| ${label} | ${k0(x.landM2.out)} | ${k0(x.landM2.in)} | ${k0(x.village?.kcalM2Year.out)} | ${k0(x.village?.proteinM2Year.out)} | ${k0(x.village?.kcalM2Year.in)} | ${k0(x.village?.proteinM2Year.in)} | ${key === 'ramp' ? `${k0(fb.average.all)} → ${k0(fb.best.all)}` : k0(x.all)} | ${r ? (r.lastImport ?? 'none') : '–'} | ${r ? (r.firstFed ?? 'never') : '–'} | ${r ? k0(r.shortPD) : '–'} |`);
		}
		L.push('');
	}
	const cmp = scen.find((x) => x.id === 'F02');
	const best = scen.find((x) => x.id === 'F03');
	const rows = [];
	for (const sc of [cmp, best].filter(Boolean)) for (const r of sc.numbers?.rows ?? []) if (!rows.some((x) => x.label === r.label)) rows.push(r);
	if (rows.length) {
		L.push('**The diets and yields side by side** (each a 30- or 60-year run of the same village, seed 20261012):', '');
		L.push('| run | m² a person outdoors | under glass | people the 177 ha feed at maturity | food bought, year 1 | year 10 | last year | first year it grew all it needs | person-days short |', '|---|---|---|---|---|---|---|---|---|');
		for (const r of rows) L.push(`| ${r.label} | ${k0(r.landOut)} | ${k0(r.landIn)} | ${k0(r.fed)} | ${pc(r.impShare1, 0)} | ${pc(r.impShare10, 0)} | ${pc(r.impShareLast, 0)} | ${r.firstFed ?? 'never'} | ${k0(r.shortPD)} |`);
		L.push('');
	}
}

function foundingAndBorder(L, bases, scen) {
	const s0 = bases[0].s, F = s0.founding, B = s0.border ?? [];
	if (!F) return;
	if (F.ramp) return buildoutAndBank(L, bases, scen);
	L.push('## The founding bill and the border', '');
	L.push(`Before day 0 the village is built from imports (paper §12.4: “Euros fund the first machines, never MIND”). ${cap1(F.sources?.tower ?? '')}. Prices: ${F.sources?.prices ?? ''}.`, '');
	L.push('| item | quantity | € |', '|---|---|---|');
	for (const r of F.rows) {
		const q = typeof r.t === 'number' ? `${k0(r.t)} t` : r.kwp ? `${k0(r.kwp)} kWp` : r.n ? `${k0(r.n)}` : r.kcal ? `${k0(r.kcal / 1e6)} million kcal` : r.ha ? `${k1(r.ha)} ha` : '';
		L.push(`| ${r.label} | ${q} | ${eurM(r.eur)} |`);
	}
	L.push(`| **total** | ${k0(F.tonnes)} t of materials | **${eurM(F.totalEur)}** |`, '');
	L.push('From day 0 the COOPs buy abroad only what the village cannot yet make or grow, through the shared euro reserve: the food COOPs buy food in the diet’s mix, the works buy logs, scrap, float glass and cells (and finished glulam, steel, glazing and panels when their works cannot keep up), the hardware owners (the Tribe COOPs and the Village COOP) buy accelerators for the data halls of their utility domes. They pay with the electricity they export at €87.5 a MWh, and the MaiaCity COOP’s bank advances the rest, repaid in their own MIND. No person holds euros, no MIND is made from euros, HEARTS never buy anything.', '');
	L.push('| year | food bought (kcal a person a day) | food € | logs t | scrap t | float glass t | cells kWp | glulam t | steel t | glazing t | panels kWp | accelerators | all imports € | exports earned € | reserve at the year’s end € | days a COOP could not pay |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
	const V = s0.village ?? [];
	for (let y = 1; y <= B.length; y += y < 10 ? 1 : 5) {
		const b = B[y - 1], i = b.imports;
		L.push(`| ${y} | ${k0(V[y - 1]?.food.imported)} | ${eurM(i.food.eur)} | ${k0(i.logs.t)} | ${k0(i.scrap.t)} | ${k0(i.float.t)} | ${k0(i.cells.kwp)} | ${k0(i.glulam.t)} | ${k0(i.steel.t)} | ${k0(i.glazing.t)} | ${k0(i.panels.kwp)} | ${k0(i.accelerators.n)} | ${eurM(b.importEur)} | ${eurM(b.exportEur)} | ${eurM(b.reserveEur)} | ${k0(b.importShortDays)} |`);
	}
	L.push('');
	const fy = (b) => (b.border ?? []).filter((x) => x.days >= 365);
	L.push('| seed | first year the village fed itself (grew at least 2,240 kcal a person a day) | last year it bought food (over 1 % of what it ate) | first year exports paid all imports | lowest reserve € | days a COOP could not pay for its imports | person-days short of a basic |', '|---|---|---|---|---|---|---|');
	for (const b of bases) {
		const bb = fy(b.s);
		L.push(`| ${b.seed} | ${b.s.food?.firstFedYear ?? 'never'} | ${b.s.food?.lastImportYear ?? '–'} | ${bb.find((x) => x.exportsCover)?.year ?? 'never'} | ${eurM(Math.min(...bb.map((x) => x.reserveMinEur ?? Infinity)))} | ${k0(bb.reduce((a, x) => a + (x.importShortDays ?? 0), 0))} | ${k0(b.p.P1.personDaysShortAny)} |`);
	}
	L.push('');
	const f01 = scen.find((x) => x.id === 'F01');
	if (f01) L.push(`**If the founding euros run out (F01).** ${f01.takeaway}`, '');
}

/**
 * (round 5) the border section opens with the bank: the bootstrap number, whether exports beat imports and from when,
 * and whether the bank is ever repaid (in euros, and in MIND)
 */
function bankLead(L, bases, B, full) {
	if (!B.length) return;
	const low = Math.min(...B.map((x) => x.bank?.lowestEur ?? 0));
	const lowYear = B.find((x) => (x.bank?.lowestEur ?? 0) <= low + 1e-6)?.year;
	const beat = (x) => x.exportEur >= x.importEur;
	const cross = full.find(beat)?.year ?? null;
	let from = null;
	for (let j = full.length - 1; j >= 0 && beat(full[j]); j--) from = full[j].year;
	const after = cross ? full.filter((x) => x.year >= cross) : [];
	const last = full.slice(-10);
	const mean = (a, fn) => a.reduce((s, x) => s + fn(x), 0) / Math.max(1, a.length);
	const expL = mean(last, (x) => x.exportEur), impL = mean(last, (x) => x.importEur), net = expL - impL;
	const runOnly = last.every((x) => !(x.buildEur > 0)) ? ' (all of them running imports: the build-out was done)' : '';
	const cumEnd = B.at(-1)?.bank?.cumulativeEur ?? NaN, cumYear = full.find((x) => (x.bank?.cumulativeEur ?? -1) >= 0)?.year ?? null;
	const adv = B.reduce((a, x) => a + (x.bank?.advancedEur ?? 0), 0), owed = B.at(-1)?.bank?.owedEur ?? NaN;
	const n = full.length;
	const exp =
		cross == null
			? `Exports never earned more than the year’s imports in ${n} years: over the last ten they earned ${eurM(expL)} a year against ${eurM(impL)} of imports${runOnly}.`
			: from != null && from === cross
				? `Exports earned more than the year’s imports in year **${cross}** for the first time, and every year from then on: over the last ten years ${eurM(expL)} a year against ${eurM(impL)} of imports.`
				: `Exports first earned more than the year’s imports in year **${cross}**, ${from != null ? `and every year from year **${from}**` : `but not every year after: in ${after.filter(beat).length} of the ${after.length} years from then, and not in the last year`}; over the last ten years they earned ${eurM(expL)} a year against ${eurM(impL)} of imports.`;
	const rep = cumYear
		? `The bank is repaid in euros: the cumulative balance (all exports less all imports since day 0) turned positive in year **${cumYear}**.`
		: `**The bank is never repaid in euros within the ${n} years:** the cumulative balance (all exports less all imports since day 0) stood at ${eurM(cumEnd)} at the end, ${net > 0 ? `and closed by ${eurM(net)} a year over the last ten years, so at that pace it would take about ${k0(-cumEnd / net)} more years` : `and ${net < 0 ? `went on falling by ${eurM(-net)} a year over the last ten years` : 'stood still over the last ten years'}: at that pace it is never repaid`}.`;
	const seeds = bases.map((b) => -Math.min(...(b.s.border ?? []).map((x) => x.bank?.lowestEur ?? 0)));
	L.push(`**The bank first.** The bootstrap number, the most the village owed the outside in euros at any moment (the MaiaCity COOP’s lowest cumulative balance), is **${eurM(-low)}**, reached in year ${lowYear ?? '–'}${bases.length > 1 ? ` (${eurM(Math.min(...seeds))} to ${eurM(Math.max(...seeds))} over the ${bases.length} base seeds)` : ''}. ${exp} ${rep} In MIND, the COOPs drew ${eurM(adv)} of advances and had paid back ${eurM(adv - owed)} of it in their own MIND by the end (${eurM(owed)} still owed); that MIND never turns back into euros.`, '');
}

/**
 * (round 5) the dome factory: what it made for the plan's domes over the build-out (sandbox-7 buildout.js, its parts in
 * their own units) and what its lines made in the engine, for upkeep and building, year by year
 */
function domeFactorySection(L, bases) {
	const s0 = bases[0].s, T = s0.domeFactory, Ms = s0.materials ?? [];
	if (!T || !Ms.length) return;
	const parts = ['strut', 'hub', 'glazing', 'solar', 'cassette'], units = { strut: 'm³', hub: 't', glazing: 'm²', solar: 'm²', cassette: 'm²' };
	const names = { strut: 'glulam struts', hub: 'hubs', glazing: 'glazing', solar: 'solar panes', cassette: 'cassettes' };
	L.push('### The dome factory: what it made', '');
	L.push(`The build-out plan’s dome factory stands from month ${T.stands ?? '–'} and runs from month ${T.runsFrom ?? '–'}. Over the build-out its lines made ${parts.map((k) => `${k0(T.made?.[k])} ${units[k]} of ${names[k]}`).join(', ')}; the domes used ${parts.map((k) => `${k0(T.used?.[k])} ${units[k]}`).join(', ')} of it, and the plan still bought ${parts.map((k) => `${k0(T.bought?.[k])} ${units[k]}`).join(', ')} finished (before the factory ran, or beyond its lines). Its raw inputs cost ${eurM(T.imports)}, the parts bought finished ${eurM(T.boughtFinished)}; ${k0(T.domesFromDF)} of the ${k0(T.domes)} domes got most of their parts from it.`, '');
	L.push('In the engine the lines make glulam (struts and cassette frames) and hubs in t, glazing in t (20 m² a t) and solar panes in kWp. While the build-out runs they get only what the plan’s domes leave of each line; the plan’s own output is in the first columns.', '');
	L.push(`| year | plan: ${parts.map((k) => `${names[k]} ${units[k]}`).join(' | plan: ')} | lines: struts and frames t | lines: hubs t | lines: glazing t | lines: solar kWp | bought finished: glulam t | hubs t | glazing t | panels kWp |`, '|---|' + '---|'.repeat(parts.length + 8));
	for (const m of Ms.filter((x) => x.year <= 6)) {
		const p = m.plan?.made ?? {};
		L.push(`| ${m.year} | ${parts.map((k) => k0(p[k] ?? 0)).join(' | ')} | ${k0(m.df.struts)} | ${k0(m.df.steel)} | ${k0(m.df.glass)} | ${k0(m.df.panel)} | ${k0(m.imported.wood)} | ${k0(m.imported.steel)} | ${k0(m.imported.glass)} | ${k0(m.imported.panel)} |`);
	}
	L.push('');
	const ys = [];
	for (let y = 7; y <= Ms.length; y += y < 10 ? 1 : 5) ys.push(y);
	if (Ms.length > 10 && Ms.length % 5 !== 0) ys.push(Ms.length);
	if (!ys.length) return;
	L.push('After the build-out the lines make what the village keeps up and builds. Upkeep is what the worn domes, halls and works took; all building includes it; the works’ inputs are the glulam, steel and glass the works themselves use.', '');
	L.push('| year | lines: struts and frames t | lines: hubs t | lines: glazing t | lines: solar kWp | made in all: glulam t (with the timber works) | upkeep: glulam t | steel t | glass t | panels kWp | all building: glulam t | steel t | glass t | panels kWp | works’ inputs: glulam t | steel t | glass t | bought finished: glulam t | hubs t | glazing t | panels kWp |', '|---|' + '---|'.repeat(20));
	for (const y of ys) {
		const m = Ms[y - 1];
		if (!m) continue;
		L.push(`| ${y} | ${k0(m.df.struts)} | ${k0(m.df.steel)} | ${k0(m.df.glass)} | ${k0(m.df.panel)} | ${k0(m.made.wood)} | ${k0(m.upkeep.wood)} | ${k0(m.upkeep.steel)} | ${k0(m.upkeep.glass)} | ${k0(m.upkeep.panel)} | ${k0(m.built.wood)} | ${k0(m.built.steel)} | ${k0(m.built.glass)} | ${k0(m.built.panel)} | ${k0(m.input.wood)} | ${k0(m.input.steel)} | ${k0(m.input.glass)} | ${k0(m.imported.wood)} | ${k0(m.imported.steel)} | ${k0(m.imported.glass)} | ${k0(m.imported.panel)} |`);
	}
	L.push('');
}

/** the build-out (the ramp), the MaiaCity COOP's bank, rents and the border, for a world that starts with two settlers */
function buildoutAndBank(L, bases, scen) {
	const b0 = bases[0], s0 = b0.s, F = s0.founding, B = s0.border ?? [], Ls = s0.living ?? [], Vs = s0.village ?? [];
	const full = B.filter((x) => x.days >= 365);
	L.push('## The build-out, the bank and the border', '');
	bankLead(L, bases, B, full);
	L.push(`Day 0 is the first settlers’ first day. Two settlers arrive with the starter kit and launch the East settlement; the village is built settlement by settlement by the build-out plan (\`src/lib/sandbox-7/buildout.js\`, launched in January), and people move in as beds are finished. The villagers build it themselves (no wages); what the village cannot yet make is bought at the euro border. ${F.feasibility ?? ''} In this run 1,500 people live there from month ${F.peopleMonth} and every dome stands from month ${F.doneMonth}.`, '');
	// people, year by year
	const yp = Ls.slice(0, Math.min(Ls.length, 8));
	L.push('**People living in the village** (at the year’s end, and the year’s mean):', '');
	L.push('| ' + ['year', ...yp.map((r) => String(r.year))].join(' | ') + ' |', '|---|' + '---|'.repeat(yp.length));
	L.push('| at the year’s end | ' + yp.map((r) => k0(r.people)).join(' | ') + ' |');
	L.push('| the year’s mean | ' + yp.map((r) => k0(r.peopleMean)).join(' | ') + ' |', '');
	// who owns what
	L.push(`**Who owns what.** Each living hex has one Tribe COOP (East, South-east, South-west, West, North-west, North-east). It builds and owns every dome in its hex with euro advances from the bank: the homes, the two food domes and the utilities dome. It rents beds to the people (the bed good, priced in its own MIND, so Law 5 pays its holders a fifth of every bed-day) and dome floor to the business COOPs that work in its domes (the food COOPs under glass, the data centres, workshops and stores), in its own MIND, so Law 5 applies to the rent too. The centre hex’s Tribe COOP is the **Village COOP**: it owns the factory domes, the centre dome and the geothermal plant, rents the factory domes to the works, and sells electricity and heat; its advances paid for the drilling.${s0.domeFactory ? ` One factory dome is the **dome factory** (sandbox-7 DF): the Village COOP builds it in month ${s0.domeFactory.stands ?? '–'} and rents its floor to four lines, which make the domes’ parts from bought raw inputs: the timber COOPs run its struts line (glulam struts and cassette frames, beside their timber works), the steel COOPs its hub line, the glass COOPs its glazing line, the panel COOPs its solar line. While the build-out runs, the plan’s domes take what the lines make first and the COOPs get what is left; from then on the lines make what the village keeps up and builds, and the COOPs buy the parts finished only when the lines cannot keep up. The steelworks no longer melts scrap: its dome is one of the centre’s halls.` : ''} The **MaiaCity COOP** (the City COOP) is separate: it owns the land, leases it, and runs the bank. Ground rent: each landlord pays the MaiaCity COOP the ground rent for the land under its domes and passes it on in its rate a m², so a tenant pays no ground rent for floor under a dome.`, '');
	// the bill
	L.push('### The build-out bill', '');
	L.push('| item | € |', '|---|---|');
	for (const r of F.rows) L.push(`| ${r.label}${typeof r.t === 'number' && r.t > 0 ? ` (${k0(r.t)} t)` : ''} | ${eurM(r.eur)} |`);
	L.push(`| **total** | **${eurM(F.totalEur)}** |`, '');
	if (F.geothermal) L.push(`Of it, ${F.geothermal.label.toLowerCase()}: ${eurM(F.geothermal.eur)}, months ${F.geothermal.start}–${F.geothermal.end}, the Village COOP’s.`, '');
	L.push('| Tribe COOP | founded (month) | done (month) | beds | domes | € |', '|---|---|---|---|---|---|');
	for (const x of F.bySettlement ?? []) L.push(`| ${x.coop} | ${x.founded} | ${x.done} | ${k0(x.beds)} | ${k0(x.domes)} | ${eurM(x.eur?.total)} |`);
	L.push('');
	if (F.byYear?.length) {
		L.push('| year | kit | running the kit | materials | machines | services | land | total |', '|---|---|---|---|---|---|---|---|');
		for (const y of F.byYear) L.push(`| ${y.year} | ${eurM(y.kit)} | ${eurM(y.running)} | ${eurM(y.materials)} | ${eurM(y.machines)} | ${eurM(y.services)} | ${eurM(y.land)} | ${eurM(y.total)} |`);
		L.push('');
	}
	// the bank
	const lows = full.map((x) => x.bank?.lowestEur ?? 0);
	const low = B.length ? Math.min(...B.map((x) => x.bank?.lowestEur ?? 0)) : NaN;
	const lowYear = B.find((x) => (x.bank?.lowestEur ?? 0) <= low + 1e-6)?.year;
	const crossYear = full.find((x) => x.exportEur >= x.importEur)?.year ?? null;
	const cumYear = full.find((x) => (x.bank?.cumulativeEur ?? -1) >= 0)?.year ?? null;
	const advTot = B.reduce((a, x) => a + (x.bank?.advancedEur ?? 0), 0);
	const owedEnd = B.at(-1)?.bank?.owedEur ?? NaN;
	const impTot = B.reduce((a, x) => a + x.importEur, 0), expTot = B.reduce((a, x) => a + x.exportEur, 0);
	L.push('### The bank (the MaiaCity COOP)', '');
	L.push(`The MaiaCity COOP is the village’s bank. Every euro the village spends abroad goes through it: the founding euros from outside are its starting balance, and here it is open (its founders lend whatever the village draws), so its lowest cumulative balance is the **bootstrap number**: the euros the village needs from outside to be built. A COOP that builds or buys abroad draws an advance and pays it back in its own MIND to the MaiaCity COOP, with no interest: each week a 26th of what it owes (at least €1), but never more than 5 % of its own MIND in its treasury that week, at the bank’s rate (a euro is worth the kWh it takes to earn it, at today’s electricity price). The MIND it pays back earns the MaiaCity COOP Law 5 dividends; it does not turn back into euros. Only exports bring euros in.`, '');
	const bestNet = Math.max(...full.map((x) => x.exportEur - x.importEur));
	L.push(`**Bootstrap number: ${eurM(-low)}** (the lowest cumulative balance, reached in year ${lowYear ?? '–'}). Exports first earned more than the year’s imports in year **${crossYear ?? 'never'}**; the cumulative balance (all exports less all imports since day 0) ${cumYear ? `turned positive in year ${cumYear}` : `never turned positive in ${B.length} years: it stood at ${eurM(B.at(-1)?.bank?.cumulativeEur)} at the end`}. Over the run the village bought ${eurM(impTot)} abroad and sold ${eurM(expTot)}.`, '');
	if (!cumYear) L.push(`**Exports never repay the bootstrap in euros.** The line sells at most what a 10 MW connection carries, hour by hour, at German market prices; ${bestNet > 0 ? `in its best year exports beat imports by ${eurM(bestNet)}, so paying back ${eurM(-low)} would take about ${k0(-low / bestNet)} years` : `exports never beat the year’s imports (the closest year fell ${eurM(-bestNet)} short)`}. The euros the village needs to be built come from outside and stay owed to the founders in euros. **The COOPs repay the bank in MIND, not euros:** they drew ${eurM(advTot)} in advances, paid back the equivalent of ${eurM(advTot - owedEnd)} in their own MIND to the MaiaCity COOP by the end, and still owed ${eurM(owedEnd)}. That MIND earns the MaiaCity COOP its Law 5 dividends inside the village; it never turns back into euros.`, '');
	else L.push(`The COOPs drew ${eurM(advTot)} in advances and still owed ${eurM(owedEnd)} at the end; they repay the bank in their own MIND (paid back: ${eurM(advTot - owedEnd)}), never in euros.`, '');
	L.push('| year | people | build-out € | running imports € | all imports € | exports € | the year’s balance € | cumulative € | lowest so far € | advanced € | owed at the year’s end € |', '|---|---|---|---|---|---|---|---|---|---|---|');
	for (let y = 1; y <= B.length; y += y < 10 ? 1 : 5) {
		const b = B[y - 1];
		L.push(`| ${y} | ${k0(b.people)} | ${eurM(b.buildEur)} | ${eurM(b.runEur)} | ${eurM(b.importEur)} | ${eurM(b.exportEur)} | ${eurM(b.exportEur - b.importEur)} | ${eurM(b.bank?.cumulativeEur)} | ${eurM(b.bank?.lowestEur)} | ${eurM(b.bank?.advancedEur)} | ${eurM(b.bank?.owedEur)} |`);
	}
	if (B.length > 10 && B.length % 5 !== 0) {
		const b = B[B.length - 1];
		L.push(`| ${B.length} | ${k0(b.people)} | ${eurM(b.buildEur)} | ${eurM(b.runEur)} | ${eurM(b.importEur)} | ${eurM(b.exportEur)} | ${eurM(b.exportEur - b.importEur)} | ${eurM(b.bank?.cumulativeEur)} | ${eurM(b.bank?.lowestEur)} | ${eurM(b.bank?.advancedEur)} | ${eurM(b.bank?.owedEur)} |`);
	}
	L.push('');
	L.push('| seed | bootstrap number | first year exports > imports | cumulative balance at the end | owed at the end | person-days short of a basic |', '|---|---|---|---|---|---|');
	for (const b of bases) {
		const bb = b.s.border ?? [], fb = bb.filter((x) => x.days >= 365);
		L.push(`| ${b.seed} | ${eurM(-Math.min(...bb.map((x) => x.bank?.lowestEur ?? 0)))} | ${fb.find((x) => x.exportEur >= x.importEur)?.year ?? 'never'} | ${eurM(bb.at(-1)?.bank?.cumulativeEur)} | ${eurM(bb.at(-1)?.bank?.owedEur)} | ${k0(b.p.P1.personDaysShortAny)} |`);
	}
	L.push('');
	// the running imports, year by year
	L.push('### What the village buys abroad to run, year by year', '');
	L.push(`From day 0 the COOPs buy abroad only what the village cannot yet make or grow: the food COOPs buy food in the diet’s mix, ${s0.domeFactory ? 'the timber works buy logs, the dome factory’s lines their raw inputs (lamellas, glue and C24 for the struts and frames; S355 plate, galvanising and bolts for the hubs; float glass with its coatings, PVB, edge seals and gaskets for the glazing; cells and their stringing for the solar panes) and the finished parts only when the lines cannot keep up' : 'the works buy logs, scrap, float glass and cells (and finished glulam, steel, glazing and panels when their works cannot keep up)'}, the hardware owners (the Tribe COOPs and the Village COOP) buy accelerators, and while the village is being built its first solar COOP buys grid electricity when the village’s own falls short. The line sells electricity (the geothermal plant’s and the battery’s at the German day-ahead average, the sun’s at the month’s solar market value). No person holds euros, no MIND is made from euros, HEARTS never buy anything.`, '');
	const yrs = [];
	for (let y = 1; y <= B.length; y += y < 10 ? 1 : 5) yrs.push(y);
	if (B.length > 10 && B.length % 5 !== 0) yrs.push(B.length);
	L.push('| year | food bought (kcal a person a day) | food € | logs t | lamellas and C24 m³ | plate t | float glass t | cells kWp | glulam t | hubs (steel) t | glazing t | panels kWp | accelerators | grid MWh | grid € | running imports € | exports € | exported € a MWh |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
	for (const y of yrs) {
		const b = B[y - 1], i = b.imports;
		L.push(`| ${y} | ${k0(Vs[y - 1]?.food.imported)} | ${eurM(i.food.eur)} | ${k0(i.logs.t)} | ${k0(i.lamellas?.m3)} | ${k0(i.plate?.t)} | ${k0(i.float.t)} | ${k0(i.cells.kwp)} | ${k0(i.glulam.t)} | ${k0(i.steel.t)} | ${k0(i.glazing.t)} | ${k0(i.panels.kwp)} | ${k0(i.accelerators.n)} | ${k0((i.grid?.kwh ?? 0) / 1000)} | ${eurM(i.grid?.eur)} | ${eurM(b.runEur)} | ${eurM(b.exportEur)} | ${k1(b.exportEurMwh)} |`);
	}
	L.push('');
	// what the running imports are, in €
	L.push('The running imports in €, by what they buy: the works’ raw inputs (logs, lamellas and C24, plate and the hub kit, float glass and the glazing kit, cells and their stringing), the finished parts bought when the works and the lines could not keep up, food, accelerators and grid electricity.', '');
	L.push('| year | raw inputs for the works € | of it: the dome factory’s lines € | finished parts € | food € | accelerators € | grid € | running imports € | exports € |', '|---|---|---|---|---|---|---|---|---|');
	for (const y of yrs) {
		const b = B[y - 1], i = b.imports, e = (k) => i[k]?.eur ?? 0;
		const dfRaw = e('lamellas') + e('plate') + (s0.domeFactory ? e('float') + e('cells') : 0);
		const raw = e('logs') + e('scrap') + e('lamellas') + e('plate') + e('float') + e('cells');
		const fin = e('glulam') + e('steel') + e('glazing') + e('panels');
		L.push(`| ${y} | ${eurM(raw)} | ${eurM(dfRaw)} | ${eurM(fin)} | ${eurM(e('food'))} | ${eurM(e('accelerators'))} | ${eurM(e('grid'))} | ${eurM(b.runEur)} | ${eurM(b.exportEur)} |`);
	}
	L.push('');
	domeFactorySection(L, bases);
	L.push('| seed | first year the village grew all it needs (2,240 kcal a person a day) | last year it bought food (over 1 % of what it ate) | days a COOP could not pay for its imports |', '|---|---|---|---|');
	for (const b of bases) L.push(`| ${b.seed} | ${b.s.food?.firstFedYear ?? 'never'} | ${b.s.food?.lastImportYear ?? '–'} | ${k0((b.s.border ?? []).reduce((a, x) => a + (x.importShortDays ?? 0), 0))} |`);
	L.push('');
	// rents
	const ry = [1, 2, 3, 5, 6, 10, 30, 60].filter((y) => y <= Vs.length && Vs[y - 1]?.rent);
	if (ry.length) {
		L.push('### Rents (the Tribe COOPs and the Village COOP)', '');
		L.push('A bed a day is what the bed COOPs’ price came to on average that year (R, and as a share of a person’s 24 HEARTS a day, which make about 12 R of MIND for the person). Dome floor is the landlords’ rate a m² (R a month): what keeps the dome up at replacement cost and pays its ground rent, grossed up for Law 5. Euros at the bank’s rate.', '');
		L.push('| year | a bed a day (R) | share of 24 HEARTS | a bed a month (€ at the bank’s rate) | dome floor R a m² a month | € a m² a month | m² of dome rented |', '|---|---|---|---|---|---|---|');
		for (const y of ry) {
			const r = Vs[y - 1].rent;
			L.push(`| ${y} | ${k1(r.bedRDay)} | ${pc(r.bedShareOfHearts, 0)} | ${eurM(r.bedEurMonth != null ? r.bedEurMonth * 1e6 : NaN).replace(' M', '').replace('€', '€')} | ${k1(r.domeRM2Month)} | ${k1(r.domeEurM2Month)} | ${k0(r.domeM2Rented)} |`);
		}
		L.push('');
	}
	const f01 = scen.find((x) => x.id === 'F01');
	if (f01) L.push(`**If the founding euros are fixed (F01).** ${f01.takeaway}`, '');
	const r01 = scen.find((x) => x.id === 'R01');
	if (r01) L.push(`**The build-out against a village built before day 0 (R01).** ${r01.takeaway}`, '');
}

/** every euro price the border uses, with its source and a sanity line (Samuel, 2026-10-13 06:42) */
function priceTable(L, meta, bases) {
	const P = meta.prices;
	if (!P) return;
	const fl = bases[0]?.s?.food ?? {}, F = bases[0]?.s?.founding ?? {};
	const kcalDay = fl.kcalDay ?? 2240;
	const foodDay = (P.foodEur * kcalDay) / 1000;
	const solarYear = P.solarEurMwh.reduce((a, x) => a + x, 0) / 12;
	const lineMwhDay = (P.lineKw * 6 * 24) / 1000;
	// (round 5) with the dome factory its four lines buy their kits (sandbox-7 DF_IMPORTS) and the finished parts are the
	// overflow; without it, the old works' raw inputs
	const A = P.all ?? {}, D = P.df, U = D?.unit;
	const e2 = (x) => (Number.isFinite(x) ? `€${x.toFixed(2)}` : '–');
	const materials = D
		? [
				['Glulam blanks, finished (when the struts line and the timber works cannot keep up)', `€${k0(P.glulamEur)} a t`, P.src.glulamEur, `= €${k0(P.glulamEur * D.rho)} a m³ at ${D.rho} t a m³ (the engine’s glulam is struts and cassette frames, ${pc(D.gs, 0)} glulam by volume). Glulam beams cost €700–1,000 a m³ at a builders’ merchant (estimate): wholesale below retail.`],
				['Lamellas, glue and C24 (the struts line’s raw input)', `lamellas €${k0(A.lamellaEur)} a m³, glue €${k0(A.adhesiveEur)} a m³ of glulam, C24 €${k0(A.kvhEur)} a m³: €${k0(A.lamellasKitEur)} a m³ of raw timber as bought`, `${P.src.lamellaEur}; ${P.src.adhesiveEur}; ${P.src.kvhEur}`, `${k1(U.struts.raw)} m³ of raw timber make a t of struts and frames for €${k0(U.struts.eur)}, against €${k0(U.struts.bought)} bought finished. Spruce sawlogs cost €84–120 a m³; graded, kiln-dried lamellas three times that.`],
				['Hubs, ring and connectors, finished (when the hub line cannot keep up)', `€${k0(P.steelEur)} a t`, P.src.steelEur, `Five times the plate they are cut from: the cutting, welding, galvanising and bolts are most of a hub’s price.`],
				['S355 plate and the hub kit (the hub line’s raw input)', `plate €${k0(A.plateEur)} a t; galvanising €${k0(A.galvanisingEur)}, bolts €${k0(A.boltsEur)}, wire and gas €${k0(A.weldEur)} a t of hubs: €${k0(A.plateKitEur)} a t of plate as bought`, `${P.src.plateEur}; ${P.src.galvanisingEur}`, `${f(D.plateT)} t of plate make a t of hubs for €${k0(U.steel.eur)} (the offcuts sold back as scrap), against €${k0(U.steel.bought)} bought finished. EU hot-rolled coil traded around €600–700 a t in 2025; plate a little more.`],
				['Laminated double glazing, finished (when the glazing line cannot keep up)', `€${k0(P.glazingEur)} a t`, P.src.glazingEur, `At ${k0(1000 / D.glazM2T)} kg a m², €${k0(P.glazingEur / D.glazM2T)} a m² for low-iron, low-E laminated double glazing with its gaskets and caps.`],
				['Float glass and the glazing kit (the glazing line’s raw input)', `float €${k0(A.floatEur)} a t; low-iron €${f(A.lowIronEur, 1)}, low-E €${f(A.lowEEur, 1)}, PVB €${f(A.pvbEur, 1)}, edge seal €${f(A.edgeEur, 1)}, gaskets and caps €${k0(A.gasketsEur)} a m² of glazing: €${k0(A.floatKitEur)} a t of float as bought`, `${P.src.floatEur}; ${P.src.pvbEur}; ${P.src.edgeEur}; ${P.src.gasketsEur}`, `A 4 mm pane weighs 10 kg a m², so €${f(A.floatEur / 100)} a m² of raw float; a m² of glazing takes ${f(U.glass.raw / D.glazM2T, 3)} t of float and its kit costs ${e2(U.glass.eur / D.glazM2T)} a m², against €${k0(P.glazingEur / D.glazM2T)} bought finished.`],
				['Logs (the timber works’ raw input)', `€${k0(P.logsEur)} a dry t`, P.src.logsEur, `€105 a solid m³ at 0.45 dry t a m³.`],
				['Solar cells and their stringing (the solar line’s raw input)', `cells €${k0(P.cellsEur)} a kWp; ribbons, busbars and junction boxes €${k0(A.stringingEur)} a m² of pane: €${k0(A.cellsKitEur)} a kWp of cells as bought`, `${P.src.cellsEur}; ${P.src.stringingEur}`, `TOPCon cells at 4–5 US cents a W FOB. A m² of solar pane holds ${f(D.cellsM2, 3)} kWp of cells and its kit costs ${e2(U.panel.eur / D.pvM2Kwp)} a m² (the pane’s glass is the glazing line’s), against €${k0(P.panelsEur / D.pvM2Kwp)} a m² bought finished. A kWp gives about 980 kWh a year in Munich.`],
				['See-through solar glass, finished (when the solar line cannot keep up)', `€${k0(P.panelsEur)} a kWp`, P.src.panelsEur, `Glass-glass modules €0.16–0.22 a Wp; cells laid into a pane cost more.`]
			]
		: [
				['Glulam (when the timber works cannot keep up)', `€${k0(P.glulamEur)} a t`, P.src.glulamEur, `Glulam beams cost more at a builders’ merchant (estimate €700–1,000 a m³): wholesale below retail, as it should be.`],
				['Steel (when the steelworks cannot keep up)', `€${k0(P.steelEur)} a t`, P.src.steelEur, `EU hot-rolled coil traded around €600–700 a t in 2025 (estimate); plate costs a little more.`],
				['Laminated double glazing (when the glassworks cannot keep up)', `€${k0(P.glazingEur)} a t`, P.src.glazingEur, `At 50 kg a m², €${k0(P.glazingEur / 20)} a m².`],
				['Float glass (the glassworks’ raw input)', `€${k0(P.floatEur)} a t`, P.src.floatEur, `A 4 mm pane weighs 10 kg a m², so €${f(P.floatEur / 100)} a m² of raw glass, far below finished glazing.`],
				['Logs (the timber works’ raw input)', `€${k0(P.logsEur)} a dry t`, P.src.logsEur, `€105 a solid m³ at 0.45 dry t a m³.`],
				['Solar cells for the glass', `€${k0(P.cellsEur)} a kWp`, P.src.cellsEur, `A kWp gives about 980 kWh a year in Munich.`],
				['See-through solar glass (when the panel works cannot keep up)', `€${k0(P.panelsEur)} a kWp`, P.src.panelsEur, `Glass-glass modules €0.16–0.22 a Wp; cells laid into a pane cost more.`]
			];
	const rows = [
		['Food, wholesale, the diet’s mix', `€${P.foodEur.toFixed(2)} a 1,000 kcal`, P.src.foodEur, `€${foodDay.toFixed(2)} a person a day, €${k0(foodDay * 365 / 12)} a month. A German spends about €200 a month on food and soft drinks at retail (Destatis household budget survey, estimate): wholesale at about half of retail is the usual gap.`],
		...materials,
		['Accelerators (Aven services)', `€${k0(P.chipEur)} each`, P.src.chipEur, `H100-class list prices €30,000–40,000. One accelerator costs ${k0(P.chipEur / P.spotEurMwh)} MWh of exports at the day-ahead average.`],
		['Geothermal drilling and plant (the Village COOP)', F.geothermal ? eurM(F.geothermal.eur) : '–', 'src/lib/sandbox-7/buildout.js (BUILD_SOURCES.geothermal): three wells about 7 km deep and the ORC plant, 30–45 M€ by the village energy research; a Bavarian deep well “quickly costs over 10 M€” (BUND Naturschutz 2023)', `Three wells at more than €10M each plus the plant: about €38M is at the low end of the range.`],
		['Grid electricity bought during the build-out', `€${P.gridEurKwh.toFixed(2)} a kWh`, P.src.gridEurKwh, `German industrial customers pay 17–18 ct a kWh with charges and taxes, households about 40 ct.`],
		['Electricity sold: baseload (geothermal, battery)', `€${P.spotEurMwh.toFixed(2)} a MWh`, P.src.spotEurMwh, `The German day-ahead average for 2025.`],
		['Electricity sold: what the sun makes', `€${k1(Math.min(...P.solarEurMwh))}–${k1(Math.max(...P.solarEurMwh))} a MWh by month (year ${k1(solarYear)})`, P.src.solarEurMwh, `About half the baseload price over a year, and a fifth of it in June: sunny noons flood the market, so solar sold at noon fetches far less.`],
		['The line to the grid', `${k0(P.lineKw * 6 / 1000)} MW`, P.src.lineKw, `At most ${k0(lineMwhDay)} MWh a day and ${k1(lineMwhDay * 365 / 1000)} GWh a year: at the baseload price that caps exports at about ${eurM(lineMwhDay * 365 * P.spotEurMwh)} a year.`],
		['Goods sold abroad', 'none', 'the base world sells only electricity across the border (Aven hours sold abroad are tested in AIX)', 'The works make for the village; nothing else is exported.'],
		['Land', F.rows ? eurM(F.rows.find((r) => r.id === 'land')?.eur) : '–', 'src/lib/sandbox-7 specs.js PRICES (farmland at Sandbox 6’s price), in the build-out plan', 'The MaiaCity COOP’s, leased to the COOPs.']
	];
	L.push('### Every euro price, with its source', '');
	L.push('| item | price | source | sanity check |', '|---|---|---|---|');
	for (const [a, b, c, d] of rows) L.push(`| ${a} | ${b} | ${String(c ?? '').replace(/\|/g, '/')} | ${d} |`);
	L.push('');
}

/** Proposition 3 in real units, per tenth: the verdict (yardstick.js P3_VERDICT), every fall that counts under it, and
 *  beside it the side yardsticks and the old money index */
function p3Real(L, bases) {
	L.push('## Proposition 3 in real units, per tenth', '');
	const r0 = bases[0].p.P3.real;
	if (!r0) return;
	const V = YARDSTICKS[P3_VERDICT];
	L.push(`**Rule (the verdict, judged ${V.label}: Samuel, 2026-10-14 17:31).** Basics (kcal, protein, water, home kWh, a bed) at or above need every year (within 1 %). No extra (home m², goods kg a year, Aven hours, pond hours a week) falls more than 2 % over any 5-year window, judged ${V.label}: ${V.rule}. Each tenth’s basket rises over the run (one extra up 5 % or more, none down beyond 2 %). Tenths by MIND holdings and by Aven output, yearly means a person, full years. The next section sets the yardsticks side by side. **Newcomers.** ${cap1(r0.newcomers)}.`, '');
	for (const b of bases) {
		const R = b.p.P3.real, O = b.p.P3.oldIndex, A = b.v3?.after;
		if (!A) continue;
		L.push(`#### Seed ${b.seed}: ${yes(b.v3.pass)} judged ${V.label} (${A.failed[P3_VERDICT].length} of 20 tenths fail over ${A.years.length} full years); the COOP part ${yes(b.p.P3.coops.pass)}`, '');
		L.push(`Beside it: ${SIDE.map((k) => `${nameOf(k)} ${A.judged.basket || k !== 'basket' ? `${yes(A.pass[k])} (${A.failed[k].length} of 20 tenths fail)` : '–'}`).join('; ')}. Old money index (comparison): ${O ? `${yes(O.pass)}, ${O.failed.length} of 20 deciles fail${O.failed.length ? ` (${O.failed.join(', ')})` : ''}` : '–'}.`, '');
		if (R.basicsFail.length) {
			const g = new Map();
			for (const x of R.basicsFail) {
				const k = `${x.by} tenth ${x.tenth}: ${x.item}`;
				if (!g.has(k)) g.set(k, []);
				g.get(k).push(`year ${x.year} ${k1(x.value)} of ${k1(x.need)} ${x.unit}`);
			}
			L.push('Basics below need: ' + [...g].map(([k, v]) => `${k} (${v.join('; ')})`).join('. ') + '.', '');
		}
		// every fall that counts under the verdict, grouped by tenth and item
		const counted = P3_VERDICT === 'basket' ? [] : A.rows.flatMap((r) => r.falls[P3_VERDICT].map((e) => ({ ...e, by: r.by, tenth: r.tenth })));
		if (counted.length) {
			L.push(`Falls that count (${V.label}):`, '');
			L.push('| tenth | item | windows with a fall over 2 % (years) | worst fall (got before → after) | binding limit that year | orders filled? |', '|---|---|---|---|---|---|');
			const g = new Map();
			for (const x of counted) {
				const k = `${x.by} ${x.tenth}|${x.item} (${x.unit})`;
				const e = g.get(k) ?? { w: [], worst: null };
				e.w.push(`${x.from}→${x.to}`);
				if (!e.worst || x.fall > e.worst.fall) e.worst = x;
				g.set(k, e);
			}
			for (const [k, e] of g) {
				const [t, item] = k.split('|');
				L.push(`| ${t} | ${item} | ${e.w.join(', ')} | ${pc(-e.worst.fall, 0)} (${k1(e.worst.before)} → ${k1(e.worst.after)}, years ${e.worst.from}→${e.worst.to}) | ${e.worst.bind}${shareOf(b, e.worst)} | ${e.worst.filled ? 'yes' : e.worst.bind === 'MIND' ? 'counted as not: budgets bound' : 'no: sold out'} |`);
			}
			L.push('');
		}
		if (R.riseFail.length) L.push('Baskets that did not rise over the run: ' + R.riseFail.map((x) => `${x.by} tenth ${x.tenth} (up: ${x.up.join(', ') || 'nothing'}; down: ${x.down.join(', ') || 'nothing'})`).join('; ') + '.', '');
		// what the verdict excused, and why (the satiation and cap excuses as ./prop3.js gave them; filled orders here)
		const ex = Array.isArray(R.excused) ? R.excused : [];
		const capEx = P3_VERDICT === 'each' || P3_VERDICT === 'taste' ? ex.filter((e) => String(e.why).startsWith('physical limit')) : [];
		const satEx = ex.filter((e) => e.why === 'at satiation');
		const filledEx = P3_VERDICT === 'taste' || P3_VERDICT === 'tasteNoCap' ? R.failures.filter((e) => ordersFilled(e.bind)) : [];
		if (P3_VERDICT !== 'basket' && capEx.length + satEx.length + filledEx.length) {
			const by = (list, f) => {
				const m = new Map();
				for (const e of list) m.set(f(e), (m.get(f(e)) ?? 0) + 1);
				return [...m].map(([k, n]) => `${k} ${k0(n)}`).join(', ');
			};
			L.push(`Falls over 2 % the verdict excuses: ${k0(capEx.length)} at a natural or physical limit${capEx.length ? ` (${by(capEx, (e) => `${e.item} at ${String(e.why).replace('physical limit: ', '')}`)})` : ''}; ${k0(satEx.length)} at satiation${satEx.length ? ` (${by(satEx, (e) => e.item)})` : ''}${P3_VERDICT === 'taste' || P3_VERDICT === 'tasteNoCap' ? `; ${k0(filledEx.length)} with the tenth’s orders filled${filledEx.length ? ` (${by(filledEx, (e) => e.item)})` : ''}` : ''}.`, '');
		}
	}
}

// ── part 3: the verdict and three yardsticks beside it ────────────────────────────────────────────────────────────
// The verdict is yardstick.js P3_VERDICT (Samuel 2026-10-14 17:31: taste-adjusted); (a) each extra, (b) taste-adjusted
// with no cap excuse and (c) one basket are side columns. All on the same full years and windows, from the saved runs.
/** a good's id in the village's yearly binds (./records.js villageYears), by the item's name */
const GOOD_OF_ITEM = Object.fromEntries(EXTRAS.map(([, name, id]) => [name, id]));
/** the share of the days of the year a fall ends in that its binding limit held, in words */
const shareOf = (b, e) => {
	const v = (b.s.village ?? []).find((y) => y.year === e.to)?.bindShare?.[GOOD_OF_ITEM[e.item]];
	return Number.isFinite(v) ? `, ${pc(v, 0)} of year ${e.to}’s days` : '';
};
/** whether a tenth's orders were filled in the year a fall ends in, in words, by the binding limit that year */
const ordersWords = (b, e) => (e.filled ? `orders filled (${e.bind}${shareOf(b, e)})` : e.bind === 'MIND' ? `not sold out, but budgets bound (MIND${shareOf(b, e)}): counted as not filled` : `orders not filled: sold out, ${e.bind}${shareOf(b, e)}`);
/** tenths failing part 3 by yardstick k in a span, per base seed */
const tenthsFailing = (bases, span, k) => bases.map((b) => (b.v3?.[span] && (k !== 'basket' || b.v3[span].judged.basket) ? `${b.v3[span].failed[k].length}${k === 'tasteNoCap' && !b.v3[span].complete ? ' (floor)' : ''}` : '–')).join(', ');
/** extras' falls that count under yardstick k in a span (for the basket: tenths whose basket fell), per base seed */
const fallsCounted = (bases, span, k) => bases.map((b) => (b.v3?.[span] ? (k === 'basket' ? b.v3[span].rows.filter((r) => r.basket).length : b.v3[span].rows.reduce((a, r) => a + r.falls[k].length, 0)) : '–')).join(', ');
function yardsticksSection(L, bases, meta) {
	if (!bases.some((b) => b.v3)) return;
	const P = meta.day1Prices ?? {};
	const V = YARDSTICKS[P3_VERDICT];
	L.push('### Part 3: the verdict and three yardsticks beside it', '');
	L.push(`Part 3’s verdict is **${V.label}** (Samuel, 2026-10-14 17:31); the other three are side columns. They differ only in which falls of an extra count. Each is judged on the same full years and five-year windows, and each keeps the basics test, the rise test and the satiation excuse. A tenth fails a yardstick when a basic is below need, its basket did not rise over the run, or one of its falls counts.`, '');
	for (const k of [P3_VERDICT, ...SIDE]) L.push(`- **${nameOf(k)}${k === P3_VERDICT ? ' (the verdict)' : ''}:** ${YARDSTICKS[k].rule}.`);
	L.push('');
	L.push('**Orders filled or not.** The saved runs keep what each tenth got, not what it ordered. Whether its orders were filled is read from the good’s binding limit in the year a fall ends in (its most frequent one; the share of the year’s days it held is given). The engine rations a sold-out extra in proportion to everyone’s orders, so under a supply limit (nature, "not built", built capacity …) every tenth that ordered it got less than it ordered. "Demand" means nothing was sold out and no budget bound: every order was filled. "MIND" means the extra was not sold out, but some people’s budgets left them nothing for extras; it counts as not filled (they wanted it and could not pay), as round 6’s (b) read it. Tastes are fixed for a person’s life.', '');
	if (P[bases[0].seed]) L.push(`Day-1 prices for (c) on seed ${bases[0].seed}: goods ${f(P[bases[0].seed].goods, 3)} R a kg, ponds ${f(P[bases[0].seed].spring, 3)} R an hour, Aven service ${f(P[bases[0].seed].compute, 3)} R an hour, a bed-day ${f(P[bases[0].seed].bed, 3)} R.`, '');
	L.push('In the founding, (b) sees only the falls (a) counts: the founding’s falls excused at a physical limit are not kept in the saved runs, so (b) there is a floor. The verdict, (a) and (c) are exact there.', '');
	const cols = [P3_VERDICT, ...SIDE];
	const head = (k) => (k === P3_VERDICT ? `verdict: ${YARDSTICKS[k].label}` : nameOf(k));
	for (const span of ['after', 'founding']) {
		L.push(span === 'after' ? '**After the founding (the claim): tenths failing, of 20**' : '**In the founding (its own column): tenths failing, of 20**', '');
		L.push(`| seed | years | ${cols.map(head).join(' | ')} | of them, a basic below need | of them, a basket that did not rise |`, `|---|---|${cols.map(() => '---|').join('')}---|---|`);
		for (const b of bases) {
			const S = b.v3?.[span];
			if (!S) {
				L.push(`| ${b.seed} | – | ${cols.map(() => '–').join(' | ')} | – | – |`);
				continue;
			}
			L.push(`| ${b.seed} | ${S.years[0] ?? '–'}–${S.years.at(-1) ?? '–'} | ${cols.map((k) => tenthsFailing([b], span, k)).join(' | ')} | ${S.rows.filter((r) => r.basics.length).length} | ${S.rows.filter((r) => r.rise).length} |`);
		}
		L.push('');
		for (const b of bases) {
			const S = b.v3?.[span];
			if (!S) continue;
			const bad = S.rows.filter((r) => cols.some((k) => r.fail[k]));
			if (!bad.length) continue;
			L.push(`Seed ${b.seed}, ${span === 'after' ? 'after the founding' : 'in the founding'} (years ${S.years[0] ?? '–'}–${S.years.at(-1) ?? '–'}), every tenth that fails a yardstick, with its worst window per extra:`, '');
			L.push(`| tenth | ${cols.map(head).join(' | ')} |`, `|---|${cols.map(() => '---|').join('')}`);
			const worstOf = worstPerItem;
			const fallCell = (list) => (list.length ? worstOf(list).map((e) => `${e.item} ${pc(-e.fall, 0)} (years ${e.from}→${e.to}, ${k1(e.before)} → ${k1(e.after)} ${e.unit}; ${ordersWords(b, e)}${e.atCap ? '; at its limit' : ''})`).join('; ') : 'none');
			// a side column whose falls are the verdict's says so, rather than repeat them
			const same = (r, k) => k !== P3_VERDICT && k !== 'basket' && P3_VERDICT !== 'basket' && r.falls[k].length > 0 && JSON.stringify(worstOf(r.falls[k])) === JSON.stringify(worstOf(r.falls[P3_VERDICT]));
			const basketCell = (r) => (r.basket ? `${pc(-r.basket.fall, 1)} (years ${r.basket.from}→${r.basket.to}, ${r.basket.windows} window${r.basket.windows === 1 ? '' : 's'} over 2 %); fell: ${r.basket.fell.map((x) => `${x.item} ${pc(x.change, 0)}`).join(', ') || 'none over 2 % alone'}` : 'none');
			const extra = (r) => [r.basics.length ? `basics below need: ${[...new Set(r.basics.map((x) => x.item))].join(', ')}` : '', r.rise ? 'basket did not rise' : ''].filter(Boolean).join('; ');
			for (const r of bad) L.push(`| ${r.by} ${r.tenth} | ${cols.map((k) => (same(r, k) ? 'the same falls' : (k === 'basket' ? basketCell(r) : fallCell(r.falls[k])) + (extra(r) ? `; ${extra(r)}` : ''))).join(' | ')} |`);
			L.push('');
		}
	}
	// the tenths that still fail under the verdict: the extra, the years, what the tenth got, whether its orders were
	// filled and whether the good was at its limit
	if (P3_VERDICT !== 'basket') {
		const still = [];
		for (const b of bases)
			for (const span of ['after', 'founding'])
				for (const r of b.v3?.[span]?.rows ?? [])
					if (r.fail[P3_VERDICT])
						still.push(`- Seed ${b.seed}, ${span === 'after' ? 'after the founding' : 'in the founding'}, ${r.by} tenth ${r.tenth}: ` + [...r.falls[P3_VERDICT].map((e) => `${e.item}, years ${e.from}→${e.to}, got ${k1(e.before)} → ${k1(e.after)} ${e.unit} (${pc(-e.fall, 1)}); ${ordersWords(b, e)}; at its natural or physical limit: ${e.atCap ? 'yes' : 'no'}`), ...r.basics.map((x) => `${x.item} below need in year ${x.year}`), ...(r.rise ? ['its basket did not rise over the run'] : [])].join('; ') + '.');
		L.push(`**Every tenth that fails ${V.label}** (the saved runs keep what a tenth got, not what it ordered):`, '');
		L.push(...(still.length ? still : ['- none']), '');
	}
	// every scenario world of the suite, rejudged by the verdict from its saved falls
	const rj = (meta.rejudged ?? []).filter((x) => x.v);
	if (rj.length) {
		const flip = rj.filter((x) => x.v.pass !== x.asRun);
		L.push(`**The suite’s other worlds.** The scenarios read part 3 as each run judged it (each extra). Rejudged ${V.label} from their saved falls, part 3 changes on ${flip.length ? flip.map((x) => `${x.label} (seed ${x.seed}: ${x.asRun ? 'pass' : 'fail'} → ${x.v.pass ? 'pass' : 'fail'})`).join('; ') : 'none'} of the ${rj.length} scenario worlds. The experiments keep only part 3’s pass flag in the saved runs, so their “Proposition 3 in each world” lines stay as each run judged it (each extra).`, '');
	}
}

/** the base world's border setting, as the run had it, and why (the other setting is B23's counter-case) */
function borderLine(b0, scen) {
	// the base run's own setting: the defaults with what --set changed, as the world ran it
	const open = b0.s.chipImport !== false;
	const b23 = scen.find((s) => s.id === 'B23');
	const rows = b23?.numbers?.rows ?? [];
	const lm = (r) => `a mean living standard of ${r.Lmean.toFixed(2)} in the last year (P3 ${yes(r.P3)})`;
	const nums = rows.length >= 3 ? ` In B23 (seed ${rows[0].seed}, ${rows[0].years} years) the ${open ? 'open base' : 'closed base'} had ${rows[0].computeRun.toFixed(2)} h of Aven services a person a day over the run (${rows[0].computeLast.toFixed(2)} in the last year) and ${lm(rows[0])}; the ${open ? 'closed' : 'open'} city ${rows[1].computeRun.toFixed(2)} h (${rows[1].computeLast.toFixed(2)}) and ${lm(rows[1])}; with accelerators three times dearer from year 10, ${rows[2].computeRun.toFixed(2)} h (${rows[2].computeLast.toFixed(2)}) and ${lm(rows[2])}. Accelerators three times dearer changed the mean living standard in the last year by ${pc(rows[2].Lmean / rows[0].Lmean - 1, 1)} and Aven services by ${pc(rows[2].computeLast / Math.max(1e-12, rows[0].computeLast) - 1, 1)}; Aven services are ${pc(b0.p.P3.share.at(-1)?.all, 0)} of the base index in the last year.` : '';
	return open
		? `**The border (base setting: open for accelerators only).** A hex cannot make accelerators: a chip fab costs billions of euros and hundreds of megawatts, and no real town has one, so the base city buys them from outside, as a real city does. It does so only as COOPs trading through the euro reserve (paper §11.4): the hardware owners (the Tribe COOPs and the Village COOP, round 4) buy accelerators for their data halls with euros the MaiaCity COOP’s bank advances, and pay the advances back in their own MIND; the bank’s own exports of electricity bought from the energy COOPs (a real sale in MIND, with Law 5) bring euros back. What replaces worn accelerators is upkeep and is served with the running class (world model 4.3), after the city’s basics and works and before any building; what a new hall’s accelerators need is served after the city’s own building class and before R&D. Neither takes electricity from the city’s basics or works. No person redeems MIND, no MIND is made from euros, and nothing else crosses the border. The closed city is B23's counter-case.${nums}`
		: `**The border (base setting: closed).** The base city neither imports nor exports; the open border for accelerators (paper §11.4) is B23's alternative.${nums}`;
}
// an experiment's saved result keeps only part 3's pass flag, as the run judged it (each extra): it cannot be rejudged
const p3s = (p) => `P1 ${yes(p.P1.pass)}, P2 ${yes(p.P2.pass)}, P3 (each extra) ${yes(p.P3.pass)}, MIND never binds a basic ${yes(p.abundance.pass)}`;

/** on the build-out: who went short (the settlers' months, newcomers' first 90 days, anyone else), seed by seed */
function p1Why(L, bases) {
	L.push('**Who went short, and why.** Each short person-day is counted in one of three groups: the two settlers while they were the whole village, newcomers in their first 90 days, and everyone else.', '');
	L.push('| seed | person-days short | the settlers’ months: person-days (days, last day) | newcomers’ first 90 days: person-days (days) | of them on the arrival day | everyone else: person-days (days) | owner-only people (any age) | by year (1, 2, 3, …) |', '|---|---|---|---|---|---|---|---|');
	for (const b of bases) {
		const r = b.s.rampShort;
		if (!r) continue;
		const by = r.byYear.slice();
		while (by.length && !by[by.length - 1]) by.pop();
		L.push(`| ${b.seed} | ${k0(b.p.P1.personDaysShortAny)} | ${k0(r.settlersPD)} (${r.settlersDays}${r.settlersLastDay >= 0 ? `, d${r.settlersLastDay}` : ''}) | ${k0(r.newPD)} (${r.newDays}) | ${k0(r.arrivalPD ?? 0)} | ${k0(r.otherPD)} (${r.otherDays}) | ${k0(r.ownerPD ?? 0)} | ${by.length ? by.map((x) => k0(x)).join(', ') : 'none'} |`);
	}
	L.push('');
	const r0 = bases[0].s.rampShort;
	const k2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
	if (r0 && r0.arrivals > 0) {
		const all = (k) => bases.reduce((a, b) => a + (b.s.rampShort?.[k] ?? 0), 0);
		const arrPD = all('arrivalPD'), arrN = all('arrivals');
		L.push(`**The arrival day.** On the five seeds ${k0(arrPD)} of ${k0(arrN)} arrivals were short on their first day. On its first day a newcomer holds only its first HEARTS half: over all arrivals it was worth ${k2(all('arrivalHeartsR') / arrN)} R at the day’s pool prices against ${k2(all('arrivalBasicR') / arrN)} R of basics; for those who went short, ${arrPD ? k2(all('arrivalShortHeartsR') / arrPD) : '–'} R against ${arrPD ? k2(all('arrivalShortBasicR') / arrPD) : '–'} R. They arrive in the build-out’s dear quarters, when the food bought abroad and the beds’ upkeep at replacement prices make a day’s basics cost more than that half. From its second day a newcomer’s Aven’s work pays it (the work proposal’s pay settles the hours’ Aven service and the person gets the rest the same evening), so the shortfall is the first day. The basics are bought in the morning, before the day’s work is paid: the day’s electricity, the inference for the Avens’ work among it, is dispatched once, after everyone’s orders, so paying the work first would pay for hours whose power is not yet dispatched. Nothing is lent and nothing given: these short days are real, and P1 counts them.`, '');
		L.push(`**Owner-only people** (their Aven delivers nothing, so no work pay) were short on ${k0(all('ownerPD'))} person-days on the five seeds: their HEARTS half is their income, and while a day’s basics cost more than it, they live on what they hold. Since round 4 an owner-only Aven spends its income above the basics on extras as far as its holding keeps up with the melt (\`ownerRule\` 'income'), so it holds little when the dear quarters come; until round 4 it kept the whole HEARTS half (scenario B34 compares the two).`, '');
	}
	L.push('In the settlers’ months the whole economy is two people. Each MIND’s pools hold only a few MIND, so one day’s payments can move a MIND’s price tenfold. On some days the East Tribe COOP’s treasury, which holds almost nothing but its own MIND, is worth too little to pay the heat of the two settlers’ beds, so the COOP delivers less of them (`engine.js affordCoops`: a COOP delivers only the basics whose energy it can pay for). This is a real result of the rules for a village of two: a MIND economy needs enough people trading for its prices to mean something. It ends when the first newcomers arrive.', '');
	L.push('Two causes of short days later in the build-out were found and fixed in round 3:', '');
	L.push('- **The weekly slow loop.** From the second year the slow loop ran weekly, and its week-sized lumps emptied the first Tribe COOP’s treasury in early January. Now it runs every day while the village is being built.', '');
	L.push('- **Winter food prices.** A food COOP valued the food it bought abroad at no less than its own plants’ unit cost on the day. In a dark month that cost is the domes’ heat over the month’s small harvest, so in the build-out’s winters, when most of the food was bought, every imported kilogram was priced at it. Food then cost far more than over the year, and newcomers who held nothing yet could not pay for their basics. Imports are now valued at no less than the own plants’ unit cost over the year.', '');
	L.push('Two more were found and fixed in round 4. **The trap**: from the AI market’s first version a person bought its Aven’s work hours as Aven service from what it held, so a newcomer who held only its HEARTS half could not both work and eat; now the work proposal’s pay settles the hours’ Aven service at delivery and nobody needs MIND in hand before their Aven can work. **The border’s material prices**: the materials the works buy abroad when they cannot keep up are now read from Sandbox 6’s design package (spruce glulam, hubs welded from plate), not from the cast-hub and larch prices of package 1.', '');
}

/** the base world's evidence, seed by seed (the appendix) */
function baseEvidence(L, bases, exps, meta) {
	const b0 = bases[0];
	L.push('## Appendix: the base world in detail', '');
	L.push('All settings are the defaults (`DEFAULTS` in `src/lib/sandbox-9/genesis.js`); only the seed changes:', '');
	L.push('```', JSON.stringify(b0.defaults), '```', '');
	L.push('### P1 — every person, every basic, every day after the founding, at least 98 %', '');
	L.push('| seed | person-days short: food | water | energy | bed | people ever short | lowest share met (food / water / energy / bed, day) | worst person-day |', '|---|---|---|---|---|---|---|---|');
	for (const b of bases) {
		const p = b.p.P1, s = p.personDaysShort, lo = p.lowestShareMet;
		L.push(`| ${b.seed} | ${s.food} | ${s.water} | ${s.energy} | ${s.bed} | ${p.peopleEverShort} | ${['food', 'water', 'energy', 'bed'].map((g) => `${f(lo[g].share, 3)} (d${lo[g].day})`).join(' / ')} | ${p.worst ? `person ${p.worst.person}, day ${p.worst.day}, ${p.worst.good} ${f(p.worst.met, 3)}` : '–'} |`);
	}
	L.push('');
	if (bases.some((b) => b.s.rampShort)) p1Why(L, bases);
	L.push(`### P2 — the owner-only cohort (${b0.owners} people: Aven output 0, nothing held at the start)`, '');
	L.push('Strict: today’s Law 5 dividends alone pay today’s basic bundle, for every member (target: from the end of the founding on). Normal: every member met every basic and still holds MIND, every day after the founding.', '');
	L.push('| seed | strict: first day | holds every day from | days failing after the first | worst ratio after the first (day) | lowest ratio by year (1–5, last) | normal: failures | lowest holding (days of the bundle), year 1 → last |', '|---|---|---|---|---|---|---|---|');
	for (const b of bases) {
		const s = b.p.P2.strict, n = b.p.P2.normal, lr = s.lowestRatioByYear, hd = n.lowestHoldingDaysByYear;
		L.push(`| ${b.seed} | ${s.firstDay} | ${s.holdsEveryDayFrom >= 0 ? s.holdsEveryDayFrom : 'never'} | ${s.failDaysAfterFirst} | ${s.worstAfterFirst ? `${f(s.worstAfterFirst.ratio)} (d${s.worstAfterFirst.day})` : '–'} | ${lr.slice(1, 6).map((x) => f(x)).join(', ')}, … ${f(lr[lr.length - 1])} | ${n.failures} | ${f(hd[1], 0)} → ${f(hd[hd.length - 1], 0)} |`);
	}
	L.push('');
	L.push('### P3 — every decile, by holdings and by Aven output', '');
	L.push('Each decile’s living standard is what its people consumed, at base-year prices. **Fall** is the larger of two readings: the largest drop of the 365-day trailing mean from any earlier point within 5 years, and the largest drop of a 30-day block against the same block of the year in any of the 5 years before (season against season). **Windows failing** counts the days on which the 5 years just ended neither rose nor ended within 5 % of the capacity per person (mean: what the built plants, the City COOP’s idle ones included, could give each person at satiation). Pass: fall ≤ 2 % and no window failing. The same test runs on the index without Aven services, which are reported apart because the accelerators that make them come from outside the city.', '');
	for (const b of bases) {
		const P3 = b.p.P3;
		// the heading carries part 3's verdict (judged by yardstick.js P3_VERDICT); the table is the old money index
		const v = b.v3 ? { pass: b.v3.pass, failed: b.v3.failedTenths, how: `judged ${YARDSTICKS[P3_VERDICT].label}` } : { pass: P3.pass, failed: P3.failed, how: `judged ${YARDSTICKS.each.label}` };
		L.push(`#### Seed ${b.seed}: part 3 ${yes(v.pass)}, ${v.how}${v.failed.length ? ` (failing: ${v.failed.join(', ')})` : ''}`, '');
		L.push('| decile | first full year | last year | capacity per person | trailing fall (peak day → day) | season-against-season fall (from → day) | windows failing | worst net 5-year change | pass | without Aven services: last year, fall, pass |', '|---|---|---|---|---|---|---|---|---|---|');
		P3.deciles.forEach((d, x) => {
			const dx = P3.withoutCompute.deciles[x];
			L.push(`| ${d.by} ${d.decile} | ${f(d.first)} | ${f(d.last)} | ${f(d.ceiling)} | ${pc(d.worstDrawdown?.fall, 1)} (${d.worstDrawdown?.peakDay} → ${d.worstDrawdown?.day}) | ${pc(d.seasonalFall?.fall, 1)} (${d.seasonalFall?.from} → ${d.seasonalFall?.day}) | ${d.windowsFailed ?? '–'} | ${pc(d.worstNet?.change, 1)} | ${yes(d.pass)} | ${f(dx.last)}, ${pc(dx.fall, 1)}, ${yes(dx.pass)} |`);
		});
		L.push('');
		L.push(`Aven services’ share of the living-standard index, by year (all / poorest tenth by holdings): ${P3.share.filter((_, y) => y % 5 === 4 || y === 0).map((r) => `year ${r.year} ${pc(r.all, 0)} / ${pc(r.poorest, 0)}`).join(', ')}.`, '');
		const c = P3.coops;
		L.push(`COOPs: ${c.alive} alive at the end, ${c.founded} founded (Law 3), ${c.receiverships.length} receiverships. Basic shortfall around any receivership (30 days before to 90 after): ${c.receiverships.reduce((a, r) => a + r.basicShortPersonDaysAround, 0)} person-days. COOP-days unable to pay for 30 days or more: ${c.coopDaysUnableToPay30}. Delivered but not paid for: ${f(c.unpaidR, 0)} R (${pc(c.unpaidShare, 4)} of what the basic bundles cost). Insolvent at the end: ${c.insolventNow.length ? c.insolventNow.map((x) => `${x.coop} (${x.lowDays} d)`).join(', ') : 'none'}. ${yes(c.pass)}.`, '');
		if (c.receiverships.length) L.push('Receiverships: ' + c.receiverships.map((r) => `${r.coop} (${r.good}) day ${r.day} → ${r.heir ?? 'City COOP'}: ${r.why}`).join('; ') + '.', '');
	}
	L.push('### Decile series (seed 20261012, yearly mean living standard)', '');
	const yrs = b0.p.P3.deciles[0].byYear.length;
	L.push('| year | ' + Array.from({ length: 10 }, (_, x) => `H${x + 1}`).join(' | ') + ' | ' + Array.from({ length: 10 }, (_, x) => `A${x + 1}`).join(' | ') + ' | capacity per person (mean) |', '|---|' + '---|'.repeat(21));
	for (let y = 0; y < yrs; y++) L.push(`| ${y + 1} | ${b0.p.P3.deciles.map((d) => f(d.byYear[y], 1)).join(' | ')} | ${f(b0.s.years[y]?.Lceil, 1)} |`);
	L.push('', 'H = by holdings, A = by Aven output; decile 1 is the lowest.', '');
	L.push('### Binding limits over time (seed 20261012)', '');
	L.push('Share of days each limit bound each good (world model 5.6). For the basics, “need met” means nobody was short. For the rest, “MIND” means some people would have bought more with more to spend, “demand” that everyone who wanted it got it, and a physical name that the sellers were sold out because of it.', '');
	const per = b0.p.limits[0].periods;
	L.push('| good | ' + per.map((p) => `days ${p.from}–${p.to}`).join(' | ') + ' | ceiling a person (last period) |', '|---|' + '---|'.repeat(per.length + 1));
	for (const l of b0.p.limits) L.push(`| ${l.good} | ${l.periods.map((p) => p.shares.slice(0, 3).map((s) => `${s.limit} ${pc(s.share, 0)}`).join(', ')).join(' | ')} | ${f(l.periods[l.periods.length - 1].ceilingPerPerson, 4)} |`);
	L.push('');
	L.push('### Energy a person against living standard, by decile (seed 20261012)', '');
	L.push('Each cell: living standard / the person’s own electricity use (kWh a day), yearly mean. Then all electricity the city used (basics, running, building, R&D), what the line exported for accelerators (not the city’s use; upkeep’s part is served with running, a project’s after building and before R&D), and the surplus (R&D, storage, curtailed), a person a day.', '');
	const E = b0.p.energy;
	L.push('| year | H1 | H3 | H5 | H7 | H10 | A1 | A5 | A10 | used kWh/p/d | exported kWh/p/d | surplus kWh/p/d |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
	for (let y = 0; y < E.ePP.length; y += y < 5 ? 1 : 5) {
		const c = (row, x) => `${f(row[x].living, 1)} / ${f(row[x].kwh, 1)}`;
		L.push(`| ${y + 1} | ${c(E.holdings[y], 0)} | ${c(E.holdings[y], 2)} | ${c(E.holdings[y], 4)} | ${c(E.holdings[y], 6)} | ${c(E.holdings[y], 9)} | ${c(E.aven[y], 0)} | ${c(E.aven[y], 4)} | ${c(E.aven[y], 9)} | ${f(E.ePP[y], 1)} | ${f(E.exportPP?.[y], 1)} | ${f(E.surplusPP[y], 1)} |`);
	}
	L.push('');
	L.push('### The two ledgers', '');
	L.push('Checked every day; a leak throws (the proof runs with testMode off, so a finished run had none). The laws are checked every day too: Law 4 (each HEART invested makes 1 MIND: 0.5 to the investor, 0.4 to the treasury, 0.1 to the pools), Law 5’s fifth against what was paid, and the pools’ gain from Law 5 against their share (round 6: Law 5 pays the pools by their reserves; with the old rule, the pools untouched). The pools’ invariant is checked every day: no swap lowers a basket’s product of reserves.', '');
	L.push('| seed | checks | MIND: largest relative error | MIND leaks | matter: largest relative error | matter leaks | energy: largest relative error | energy leaks | law checks | law: largest relative error | law breaches | delivered unpaid (R) | COOP-days unable to pay ≥ 30 days | melt index at the end | run time |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
	for (const b of bases) {
		const g = b.s.ledger;
		L.push(`| ${b.seed} | ${g.checks} | ${g.mindMaxRel.toExponential(2)} | ${g.mindLeaks.length} | ${g.matterMaxRel.toExponential(2)} | ${g.matterLeaks.length} | ${g.energyMaxRel.toExponential(2)} | ${g.energyLeaks.length} | ${g.lawChecks} | ${Number(g.lawMaxRel).toExponential(2)} | ${g.lawBreaches?.length ?? g.lawBreaches} | ${f(g.unpaidR, 1)} | ${g.coopLowDays} | ${f(g.meltIndex, 4)} | ${(b.ms / 1000).toFixed(1)} s |`);
	}
	L.push('');
	L.push('### Starting capital (day 0)', '');
	L.push(`A village settled ten years before day 0. Nobody holds any MIND before day 0 (people’s holdings on day 0 before the first HEARTS: ${f(b0.day0.peopleMind, 0)}). The first MIND is made when everyone’s first HEARTS convert on day 0 (the bootstrap of §11.4). Land: ${b0.day0.landHa} ha, all the City COOP’s.`, '');
	L.push('Catalog (`STARTING_CAPITAL`, estimate): ' + Object.entries(meta.start.v).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(' + ') : v && typeof v === 'object' ? '(' + Object.entries(v).map(([a, b]) => `${a}: ${b}`).join(', ') + ')' : v}`).join('; ') + '.', '');
	L.push('| COOP | plant | capacity (its unit) | land m² |', '|---|---|---|---|');
	for (const p of b0.day0.plants) L.push(`| ${p.coop} | ${p.tech} | ${f(p.cap, 1)} | ${f(p.landM2, 0)} |`);
	L.push('');
	if (meta.catalog) {
		L.push('### Catalog numbers', '');
		const est = meta.catalog.filter(([, r]) => r.est);
		L.push(`${meta.catalog.length} numbers in \`src/lib/sandbox-9/primitives.js\`; ${est.length} are marked **estimate** (nobody has checked them yet).`, '');
		L.push('| number | value | unit | source | estimate |', '|---|---|---|---|---|');
		for (const [path, r] of meta.catalog) L.push(`| ${path} | ${fmtV(r.v)} | ${r.u ?? ''} | ${String(r.src ?? '').replace(/\|/g, '/')} | ${r.est ? '**estimate**' : ''} |`);
		L.push('');
	}
}
const fmtV = (v) => (Array.isArray(v) ? v.map((x) => fmtV(x)).join(', ') : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${fmtV(x)}`).join('; ') : String(v));

function toCsv(exps, scen, bases, R) {
	const rows = ['part,id,run,series,index,value'];
	for (const b of bases) {
		const s = b.seed;
		for (const d of b.p.P3.deciles) d.byYear.forEach((v, y) => rows.push(`base,S00,${s},living_${d.by}_decile${d.decile},${y + 1},${num(v)}`));
		// part 3 by every yardstick (./src/lib/sandbox-9/yardstick.js): the verdict's pass, and tenths failing in each span
		if (b.v3) {
			rows.push(`base,S00,${s},p3_verdict_${P3_VERDICT}_pass,,${b.v3.pass ? 1 : 0}`);
			for (const span of ['after', 'founding']) if (b.v3[span]) for (const k of Object.keys(YARDSTICKS)) rows.push(`base,S00,${s},p3_tenths_failing_${k}_${span},,${b.v3[span].failed[k].length}`);
		}
		b.s.years.forEach((r) => {
			for (const k of ['Lmean', 'Lceil', 'poorA', 'poorH', 'ePP', 'surplusPP', 'yield', 'markup', 'sellerShare', 'gini', 'issuedPP', 'meltPP', 'rent']) rows.push(`base,S00,${s},${k},${r.y},${num(r[k])}`);
		});
		b.p.P2.strict.lowestRatioByYear.forEach((v, y) => rows.push(`base,S00,${s},strict_lowest_ratio,${y + 1},${num(v)}`));
		b.p.P2.normal.lowestHoldingDaysByYear.forEach((v, y) => rows.push(`base,S00,${s},owner_lowest_holding_days,${y + 1},${num(v)}`));
		b.p.energy.holdings.forEach((row, y) => row.forEach((c, x) => rows.push(`base,S00,${s},kwh_holdings_decile${x + 1},${y + 1},${num(c.kwh)}`)));
		for (const l of b.p.limits) for (const p of l.periods) for (const sh of p.shares) rows.push(`base,S00,${s},binding_${l.good}_${csvq(sh.limit)},${p.from}-${p.to},${num(sh.share)}`);
	}
	for (const e of exps) for (const m of e.r.metrics) rows.push(`experiment,${e.r.id},base,${csvq(m.id)},,${csvv(m.base)}`, `experiment,${e.r.id},changed,${csvq(m.id)},,${csvv(m.changed)}`);
	for (const sc of scen) for (const [k, v] of flatten(sc.numbers)) rows.push(`scenario,${sc.id},,${csvq(k)},,${csvv(v)}`);
	// every scenario world's yearly series
	for (const [key, s] of Object.entries(R)) for (const r of s.years) for (const k of ['Lmean', 'poorA', 'poorH', 'short', 'gini', 'yield', 'ePP']) rows.push(`world,${csvq(s.label)},${s.seed},${k},${r.y},${num(r[k])}`);
	return rows.join('\n') + '\n';
}
function flatten(o, pre = '') {
	const out = [];
	if (o == null || typeof o !== 'object') return [[pre, o]];
	for (const [k, v] of Object.entries(o)) {
		const p = pre ? `${pre}.${k}` : k;
		if (v && typeof v === 'object') out.push(...flatten(v, p));
		else out.push([p, v]);
	}
	return out;
}
const num = (v) => (Number.isFinite(v) ? +v.toPrecision(6) : '');
const csvv = (v) => (typeof v === 'number' ? num(v) : v == null ? '' : csvq(v));
const csvq = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** numbers rounded to 4 significant digits, for the page's JSON */
const round = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? +v.toPrecision(4) : null) : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);
/** a run's parameter set against the base's: the settings it changed and the catalog numbers that differ */
function paramDiff(p, base) {
	if (!p) return null;
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	const overrides = {};
	for (const [k, v] of Object.entries(p.settings ?? {})) if (!same(v, base?.defaults?.[k]) && k !== 'label') overrides[k] = v;
	const catalog = {};
	for (const [k, v] of Object.entries(p.catalog ?? {})) if (!same(v, base?.catalog?.[k])) catalog[k] = v;
	return round({ overrides, catalog });
}
const pbaseOf = (bases) => {
	const p = bases[0]?.s?.params;
	return p ? { defaults: p.defaults, catalog: p.catalog, village: p.village } : null;
};
/** each item's worst fall (the largest over 2 % in any window) */
const worstPerItem = (list) => {
	const m = new Map();
	for (const e of list) if (!m.has(e.item) || e.fall > m.get(e.item).fall) m.set(e.item, e);
	return [...m.values()];
};
/** a base seed's part 3 under every yardstick, for the page's JSON: tenths failing per span, and each failing tenth with
 *  its worst fall per item under each yardstick */
function v3Json(b) {
	const span = (S) =>
		S
			? {
					years: [S.years[0] ?? null, S.years.at(-1) ?? null],
					complete: S.complete,
					failing: Object.fromEntries(Object.keys(YARDSTICKS).map((k) => [k, S.failed[k].length])),
					tenths: S.rows
						.filter((r) => Object.values(r.fail).some(Boolean))
						.map((r) => ({ tenth: `${r.by} ${r.tenth}`, fails: Object.keys(YARDSTICKS).filter((k) => r.fail[k]), falls: Object.fromEntries(['each', 'taste', 'tasteNoCap'].map((k) => [k, worstPerItem(r.falls[k]).map((e) => round({ item: e.item, from: e.from, to: e.to, fall: e.fall, before: e.before, after: e.after, bind: e.bind, filled: e.filled, atCap: e.atCap }))])), basket: r.basket ? round({ from: r.basket.from, to: r.basket.to, fall: r.basket.fall, fell: r.basket.fell }) : null, basics: r.basics.length, rise: !!r.rise }))
				}
			: null;
	return { verdict: P3_VERDICT, after: span(b.v3.after), founding: span(b.v3.founding) };
}
/** part 3 as the page's Proof tab shows it: the verdict's yardstick named plainly, its claim and per-seed evidence */
function p3Page(bases, meta) {
	const V = YARDSTICKS[P3_VERDICT];
	const vb = bases.filter((b) => b.v3);
	const yrs = (S) => (S?.years.length ? `years ${S.years[0]}–${S.years.at(-1)}` : 'no full year');
	// the tenths that fail a span, and what counts against them: each extra with its windows and whether its orders were
	// filled (sold out, or budgets bound), a basic below need, a basket that did not rise
	const failing = (S) => {
		const bad = S.rows.filter((r) => r.fail[P3_VERDICT]);
		if (!bad.length) return '';
		const tenths = ['holdings', 'aven']
			.map((by) => {
				const xs = bad.filter((r) => r.by === by).map((r) => r.tenth);
				return xs.length ? `${by} ${xs.length > 1 ? 'tenths' : 'tenth'} ${xs.join(', ')}` : '';
			})
			.filter(Boolean)
			.join(' and ');
		const what = new Map();
		for (const r of bad)
			for (const e of r.falls[P3_VERDICT] ?? []) {
				const x = what.get(e.item) ?? { w: new Set(), how: new Set() };
				x.w.add(`${e.from}→${e.to}`);
				x.how.add(e.filled ? 'orders filled' : e.bind === 'MIND' ? 'not sold out, budgets bound' : `sold out (${e.bind}), orders not filled`);
				what.set(e.item, x);
			}
		const counts = [...[...what].map(([item, x]) => `${item} in years ${[...x.w].join(', ')}: ${[...x.how].join('; ')}`), ...(bad.some((r) => r.basics.length) ? ['a basic below need'] : []), ...(bad.some((r) => r.rise) ? ['a basket that did not rise'] : [])];
		return ` (failing: ${tenths}; what counts: ${counts.join('; ')})`;
	};
	const lines = vb.map((b) => {
		const A = b.v3.after, F = b.v3.founding;
		const t =
			`Seed ${b.seed}: ${20 - A.failed[P3_VERDICT].length}/20 tenths pass after the founding (${yrs(A)}), judged ${V.label}; the COOP part ${b.p.P3.coops.pass ? 'passes' : 'fails'}` +
			failing(A) +
			(F ? `. In the founding (${yrs(F)}), ${20 - F.failed[P3_VERDICT].length}/20 pass${failing(F)}` : '') +
			`. Beside it, tenths failing after the founding: ${SIDE.map((k) => `${nameOf(k)} ${A.failed[k].length}`).join(', ')}.`;
		return [t, b.v3.pass];
	});
	return {
		verdict: P3_VERDICT,
		label: V.label,
		decided: 'Samuel, 2026-10-14 17:31',
		rule: V.rule,
		claim: `In real units, every tenth by holdings and by Aven output, from the end of the founding: the basics (kcal, protein, water, home kWh, a bed) at or above need every year; no extra (home m², goods, Aven hours, warm-pond hours) falls more than 2 % in any 5 years, judged ${V.label}: ${V.rule}; each tenth’s basket rises over the run; COOPs stay solvent or leave through receivership with no basic short.`,
		pass: vb.length > 0 && vb.every((b) => b.v3.pass),
		source: `the proof suite’s ${vb.length} base worlds, ${Math.round((vb[0]?.s.days ?? 0) / 365)} years, engine ${meta.hash}`,
		side: SIDE.map((k) => ({ key: k, mark: YARDSTICKS[k].mark, label: YARDSTICKS[k].label, rule: YARDSTICKS[k].rule })),
		// failing lines first (the page shows the first two)
		evidence: [...lines.filter(([, ok]) => !ok), ...lines.filter(([, ok]) => ok)].map(([t]) => t),
		seeds: vb.map((b) => ({ seed: b.seed, pass: b.v3.pass, after: b.v3.after ? Object.fromEntries(Object.keys(YARDSTICKS).map((k) => [k, b.v3.after.failed[k].length])) : null, founding: b.v3.founding ? Object.fromEntries(Object.keys(YARDSTICKS).map((k) => [k, b.v3.founding.failed[k].length])) : null }))
	};
}
let pbase = null;
function toJson(exps, scen, bases, notCovered, meta) {
	pbase = pbaseOf(bases);
	const b0 = bases[0]?.s;
	const firstYear = (B, f) => B?.find((b) => b.days >= 365 && f(b))?.year ?? null;
	return {
		// the base world's parameters once, and per run only what differs (contract.md §1)
		paramsBase: pbase ? round(pbase) : null,
		// the base world (seed 20261012): living standards by tenth, the village's food and energy, the border, the diet
		// and its land (contract.md §2–4)
		living: b0 ? { seed: b0.seed, years: round(b0.living) } : null,
		village: b0 ? { seed: b0.seed, years: round(b0.village), indoorMonths: round(b0.indoorMonths ?? null) } : null,
		border: b0 ? { seed: b0.seed, years: round(b0.border), founding: round(b0.founding), firstFedYear: b0.food?.firstFedYear ?? null, lastImportYear: b0.food?.lastImportYear ?? null, exportsCoverYear: firstYear(b0.border, (b) => b.exportsCover), reserveOutYear: firstYear(b0.border, (b) => b.reserveOut) } : null,
		food: b0 ? round(b0.food) : null,
		// the base world's AI market by year (the page's AI tab, contract.md)
		ai: b0?.ai ? { seed: b0.seed, years: round(b0.ai) } : null,
		generated: meta.now,
		command: 'node scripts/sandbox-9-proof.mjs',
		engineHash: meta.hash,
		wallSeconds: Math.round(meta.wall / 1000),
		headline: bases.length ? headline(exps, scen, bases).map((r) => ({ part: r.part, holds: r.holds, base: r.base, founding: r.founding ?? null, breaks: r.breaks })) : [],
		seeds: bases.map((b) => ({ seed: b.seed, params: paramDiff(b.s.params, pbase), living: round(b.s.living), border: { firstFedYear: b.s.food?.firstFedYear ?? null, lastImportYear: b.s.food?.lastImportYear ?? null, exportsCoverYear: firstYear(b.s.border, (x) => x.exportsCover), reserveOutYear: firstYear(b.s.border, (x) => x.reserveOut), reserveLow: round(Math.min(...(b.s.border ?? []).map((x) => x.reserveMinEur ?? Infinity))), importShortDays: (b.s.border ?? []).reduce((a, x) => a + (x.importShortDays ?? 0), 0), shortPD: b.p.P1.personDaysShortAny }, years: Math.round(b.s.days / 365), pass: b.p.P1.pass && b.p.P2.pass && (b.v3 ? b.v3.pass : b.p.P3.pass) && b.p.abundance.pass, P1: b.p.P1.pass, shortPD: b.p.P1.personDaysShortAny, rampShort: b.s.rampShort ?? null, strictFrom: b.p.P2.strict.holdsEveryDayFrom, P2normal: b.p.P2.normal.pass, P3: b.v3 ? b.v3.pass : b.p.P3.pass, P3failed: b.v3 ? b.v3.failedTenths : b.p.P3.failed, P3yardstick: b.v3 ? YARDSTICKS[P3_VERDICT].label : YARDSTICKS.each.label, P3real: b.p.P3.real?.pass ?? null, P3realFailed: b.p.P3.real?.failedTenths ?? [], P3oldIndex: b.p.P3.oldIndex?.pass ?? null, bootstrapEur: round(-Math.min(...(b.s.border ?? []).map((x) => x.bank?.lowestEur ?? 0))), exportsOverImportsYear: firstYear(b.s.border, (x) => x.exportEur >= x.importEur), P3withoutCompute: b.p.P3.withoutCompute.pass, computeShareLast: round(b.p.P3.share.at(-1)?.all), coops: b.p.P3.coops.pass, mindBindsBasics: b.p.abundance.mindBindsBasics, seconds: round(b.ms / 1000),
			// (round 6) the claim from the end of the founding, and the founding's own numbers
			founding: b.p.founding ?? null, shortInFounding: b.p.P1.founding?.personDaysShortAny ?? null, shortAll: b.p.P1.all?.personDaysShortAny ?? null, strictLowestAfterFounding: round(b.p.P2.strict.lowestAfterFounding), strictLowestInFounding: round(b.p.P2.strict.lowestInFounding), strictLowestLastYear: round(b.p.P2.strict.lowestRatioByYear?.at(-1)), normalFailuresInFounding: b.p.P2.normal.failuresInFounding ?? null, P3realFounding: b.p.P3.founding ? { pass: b.p.P3.founding.pass, failedTenths: b.p.P3.founding.failedTenths } : null, P3realFailures: b.p.P3.real?.failures?.length ?? null, P3riseFail: b.p.P3.real?.riseFail?.length ?? null, mindBindsBasicsInFounding: b.p.abundance.mindBindsBasicsInFounding ?? null, gini: round(b.s.gini), yardsticks: b.v3 ? v3Json(b) : null, r6: b.s.r6 ? { bank: b.s.r6.bank, last: round(b.s.r6.years.at(-1)), lvr: round(b.s.r6.lvr) } : null })),
		// part 3 judged by the verdict's yardstick (./src/lib/sandbox-9/yardstick.js), for the page's Proof tab
		p3: bases.some((b) => b.v3) ? p3Page(bases, meta) : null,
		experiments: exps.map((e) => ({ id: e.r.id, question: e.r.question, ruleChanged: e.r.ruleChanged, people: e.r.people, years: e.r.years, seed: e.r.seed, params: { base: paramDiff(e.r.base.params, pbase), changed: paramDiff(e.r.changed.params, pbase) }, food: { base: round(e.r.base.food ?? null), changed: round(e.r.changed.food ?? null) }, pass: e.r.verdict.pass, ens: e.r.ens ?? null, claim: e.r.verdict.claim, evidence: e.r.verdict.evidence, takeaway: e.r.takeaway, metrics: e.r.metrics.map((m) => ({ id: m.id, label: m.label, base: round(m.base), changed: round(m.changed) })), seconds: round(e.ms / 1000) })),
		scenarios: scen.map((s) => ({ id: s.id, name: s.name, paper: s.paper, claim: s.claim, pass: s.pass, takeaway: s.takeaway, evidence: s.evidence, runs: s.runs.map((r) => ({ label: r.label, people: r.people ?? 1500, years: r.years, params: r.params ? paramDiff(r.params, pbase) : null, food: r.food ? round(r.food) : null })), numbers: round(s.numbers), seconds: round(s.ms / 1000) })),
		notCovered: notCovered.map(([id, name, why]) => ({ id, name, why }))
	};
}

if (isMainThread) await main();
