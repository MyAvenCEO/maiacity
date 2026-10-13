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
 *                                                  (refused when the engine's files changed since)
 *
 * Every number in the report is computed by the run; nothing is typed in.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import v8 from 'node:v8';
import { dirname, join } from 'node:path';

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
	const meta = { wall, set, now, only, quick, hash, threads: par, totalCpu: results.reduce((a, r) => a + r.ms, 0), catalog: catalogList(), start: STARTING_CAPITAL, prices };
	if (!OUT) {
		console.log('--quick without --out: nothing written');
		return;
	}
	const md = report(exps, scen, bases, NOT_COVERED, meta);
	mkdirSync(OUT, { recursive: true });
	const suffix = (only ? '-' + only.join('-') : '') + (Object.keys(set).length ? '-set' : '') + (quick ? '-quick' : '');
	writeFileSync(join(OUT, `proof${suffix}.md`), md);
	writeFileSync(join(OUT, `proof${suffix}.csv`), toCsv(exps, scen, bases, R));
	if (!only && !Object.keys(set).length && !quick) {
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
		writeFileSync(file, JSON.stringify({ ...prev, suite: toJson(exps, scen, bases, NOT_COVERED, meta) }, null, '\t'));
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
		base: bases.map((b) => b.p.P1.personDaysShortAny).join(', ') + ' person-days short (seeds ' + bases.map((b) => b.seed).join(', ') + ')' + (bases.every((b) => b.s.rampShort) ? '; of them, while the two settlers were the whole village: ' + bases.map((b) => b.s.rampShort.settlersPD).join(', ') + ' (the appendix says why)' : ''),
		breaks: [...failE(['X5', 'X12', 'X14', 'SH']), ...fails(['B10', 'B15', 'B26', 'B29', 'S02', 'S03'].map(S)), ...ens('P1')]
	});
	rows.push({
		part: 'P2 strict — dividends alone pay the basic bundle',
		holds: allB((b) => b.p.P2.strict.pass),
		// -1: dividends alone never paid every member's bundle on every day to the end of the run
		base: 'holds every day from ' + bases.map((b) => (b.p.P2.strict.holdsEveryDayFrom >= 0 ? 'day ' + b.p.P2.strict.holdsEveryDayFrom : 'never')).join(', ') + ' (target: from day 120 at the latest); lowest dividends ÷ bundle in the last year ' + bases.map((b) => f(b.p.P2.strict.lowestRatioByYear?.at(-1))).join(', '),
		breaks: [...failE(['X2']), ...fails(['B03', 'A07', 'S03'].map(S)), ...ens('strict')]
	});
	rows.push({
		part: 'P2 normal — no one has to work to survive',
		holds: allB((b) => b.p.P2.normal.pass),
		base: bases.map((b) => b.p.P2.normal.failures).join(', ') + ' person-days failing; the lowest holding runs out in ' + bases.map((b) => (Number.isFinite(b.p.P2.normal.runsOutInYears) ? Math.round(b.p.P2.normal.runsOutInYears) + ' years' : 'never')).join(', ') + ' at its last-10-year trend (pass: over 100)',
		breaks: [...failE(['X2']), ...fails(['B05'].map(S)), ...ens('normal')]
	});
	rows.push({
		part: 'P3 — living standards rise for every tenth (real units)',
		holds: allB((b) => b.p.P3.pass),
		base: 'tenths failing in real units (of 20: ten by holdings, ten by Aven output) ' + bases.map((b) => b.p.P3.real?.failedTenths.length ?? '–').join(', ') + '; items failing: basics ' + bases.map((b) => b.p.P3.real?.basicsFail.length ?? '–').join(', ') + ', extras’ falls ' + bases.map((b) => b.p.P3.real?.failures.length ?? '–').join(', ') + ', baskets not rising ' + bases.map((b) => b.p.P3.real?.riseFail.length ?? '–').join(', ') + '. Old money index (comparison): ' + 'worst 5-year fall ' + bases.map((b) => pc(Math.max(...b.p.P3.deciles.map((d) => d.fall ?? 0)), 1)).join(', ') + '; deciles failing ' + bases.map((b) => b.p.P3.failed.length).join(', ') + '; without Aven services in the index, deciles failing ' + bases.map((b) => b.p.P3.withoutCompute.failed.length).join(', ') + '; Aven services’ share of the index in the last year ' + bases.map((b) => pc(b.p.P3.share.at(-1)?.all, 0)).join(', ') + '; COOP part ' + bases.map((b) => yes(b.p.P3.coops.pass)).join(', '),
		breaks: [...failE(['X10', 'SH']), ...fails(['B22', 'B27', 'S01', 'S03'].map(S))]
	});
	rows.push({
		part: 'Abundance limited only by physics',
		holds: allB((b) => b.p.abundance.pass) && [E('X9'), E('AB1'), E('X11')].every((x) => !x || x.verdict.pass) && [S('B14'), S('B28'), S('B29')].every((x) => !x || x.pass),
		base: 'MIND bound a basic on ' + bases.map((b) => b.p.abundance.mindBindsBasics).join(', ') + ' day-goods (a day and a basic); ' + [['X9' + (E('X9')?.ens ? ` (${E('X9').ens.filter((x) => x.pass).length} of ${E('X9').ens.length} seeds)` : ''), E('X9')?.verdict], ['AB1', E('AB1')?.verdict], ['X11', E('X11')?.verdict], ['B14', S('B14')], ['B28', S('B28')], ['B29', S('B29')]].map(([id, v]) => `${id} ${v ? yes(v.pass) : '–'}`).join(', '),
		breaks: [...failE(['X9', 'X11', 'AB1']), ...fails(['B14', 'B28', 'B29'].map(S))]
	});
	return rows;
}

function report(exps, scen, bases, notCovered, meta) {
	const L = [];
	const nPass = exps.filter((e) => e.r.verdict.pass === true).length + scen.filter((s) => s.pass === true).length;
	const nCmp = scen.filter((s) => s.pass == null).length + exps.filter((e) => e.r.verdict.pass == null).length;
	L.push('# Sandbox 8 — the proof of Proposition 3', '');
	L.push(`Run ${meta.now.slice(0, 16).replace('T', ' ')} UTC by \`node scripts/sandbox-9-proof.mjs${meta.quick ? ' --quick' : ''}${meta.only ? ' --only ' + meta.only.join(',') : ''}\`. Engine: \`src/lib/sandbox-9/\` (hash ${meta.hash}). Wall time ${(meta.wall / 1000).toFixed(0)} s on ${meta.threads} threads (${(meta.totalCpu / 1000).toFixed(0)} s of runs). Every number below comes from the run.`, '');
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
		L.push(borderLine(bases[0], scen), '');
		L.push('| part | base world, every seed | what it shows | where it breaks |', '|---|---|---|---|');
		for (const r of headline(exps, scen, bases)) L.push(`| ${r.part} | **${r.holds ? 'holds' : 'fails'}** | ${r.base} | ${r.breaks.length ? r.breaks.join(', ') : 'nowhere in this suite'} |`);
		L.push('');
		p3Real(L, bases);
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
	if (av.length) L.push(`Aven help for the poorest tenth runs from ${k1(Math.min(...av))} to ${k1(Math.max(...av))} hours a day over the run: Aven service comes from the AI market (the next section): the settlement COOPs and the Village COOP sell inference, avenCEO sells the hours, and each person’s Aven splits what its person buys between help and work.`, '');
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
	L.push('The settlement COOPs and the Village COOP own the accelerators, in the data halls of their utility domes, and run them on their own power. They buy them through the euro border with euros the MaiaCity COOP’s bank advances, repaid in their own MIND, and replace them as they wear. They sell inference by the accelerator-hour to the AI COOPs: the avenCEO COOP, founded at the founding, and any rival Law 3 founds. avenCEO pays the owners in its own MIND (Law 5 on every sale), runs the harnesses and sells Aven service to the people. A person’s Aven spends Aven hours on help for its person, bought from what the person holds, and on work items for the COOPs (their running items and work proposals). Each COOP pays those items by skill × hours delivered; the pay settles the hours’ Aven service first and the person gets the rest, so nobody needs MIND in hand before their Aven can work. The owner-only cohort does no work. An Aven hour takes a sixteenth of an accelerator-hour (sixteen sessions an accelerator, less as the harness learns); the people pay the inference in each hour straight to the owners, on avenCEO’s bill.', '');
	const ys = [1, 2, 3, 5, 10, 20, 30, 40, 50, 60].filter((y) => A.some((r) => r.year === y && r.days >= 365));
	L.push(`Seed ${b0.seed}, a person a day unless it says otherwise:`, '');
	L.push('| year | people | accelerators (owners) | imported (€) | capacity, accelerator-h a day | inference sold, accelerator-h a day (use) | price, R an accelerator-h | Aven help h | Aven work h | COOP work asked · done, h a day | what bound the Aven service (share of days) |', '|---|---|---|---|---|---|---|---|---|---|---|');
	for (const y of ys) {
		const r = A.find((x) => x.year === y);
		const own = (r.owners ?? []).filter((o) => o.chips > 0.5);
		L.push(`| ${y} | ${k0(r.people)} | ${k0(r.chips)} (${own.map((o) => `${o.label ?? o.id} ${k0(o.chips)}`).join(', ') || '–'}) | ${k0(r.imported?.n)} (€${k0(r.imported?.eur)}) | ${k0(r.capAHDay)} | ${k0(r.AHDay)} (${pc(r.utilization, 0)}) | ${k3(r.inferPriceR)} | ${k1(r.all?.helpH)} | ${k1(r.all?.workH)} | ${k0((r.work?.runNeedDay ?? 0) + (r.work?.propNeedDay ?? 0))} · ${k0(r.work?.hoursDay)} | ${r.bind?.words ?? '–'} (${pc(r.bind?.share, 0)}) |`);
	}
	L.push('');
	L.push('**By tenth of MIND holdings** (seed ' + b0.seed + '): Aven hours a person a day (help · work) and MIND income in R a day by source: the HEARTS half (what the person’s own 24 HEARTS make), Aven work items, Law 5 dividends.', '');
	L.push('| year | tenth | help h | work h | HEARTS half | work items | dividends | all | share from work |', '|---|---|---|---|---|---|---|---|---|');
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
		L.push(`**The trap: does the poorest tenth get out?** In year ${last.year} the poorest tenth’s Avens by holdings worked ${k1(t1.workH)} hours a person a day for the COOPs (the middle tenth ${k1(t5.workH)}), earned ${k2(t1.work)} R a day from work items (the middle tenth ${k2(t5.work)}), and had ${k2(inc(t1))} R a day of MIND income in all, ${pc(inc(t1) / Math.max(1e-12, inc(t5)), 0)} of the middle tenth’s; ${pc(t1.hearts / Math.max(1e-12, inc(t1)), 0)} of it is the HEARTS half (in year ${first.year}: ${k1(f1?.workH)} work hours and ${k2(f1?.work)} R from work). An Aven works for the COOPs only while an hour of its work earns at least what the Aven hour costs; the work item’s pay settles the hour’s Aven service first and the person gets the rest (the work income here is that rest), so nobody needs MIND in hand before their Aven can work. Work items pay by skill × hours, so a low-skill Aven earns little, and the owner-only cohort does no work at all. The poorest tenth is mostly these people and newcomers who arrive holding nothing: a newcomer’s Aven works from its first day and is paid that evening; on its first day the HEARTS half alone did not pay for all its basics in the build-out’s dear quarters (P1, the arrival day).`, '');
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
	L.push('From day 0 the COOPs buy abroad only what the village cannot yet make or grow, through the shared euro reserve: the food COOPs buy food in the diet’s mix, the works buy logs, scrap, float glass and cells (and finished glulam, steel, glazing and panels when their works cannot keep up), the hardware owners (the settlement COOPs and the Village COOP) buy accelerators for the data halls of their utility domes. They pay with the electricity they export at €87.5 a MWh, and the MaiaCity COOP’s bank advances the rest, repaid in their own MIND. No person holds euros, no MIND is made from euros, HEARTS never buy anything.', '');
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
	L.push(`**Who owns what.** Each living hex has one settlement COOP (East, South-east, South-west, West, North-west, North-east). It builds and owns every dome in its hex with euro advances from the bank: the homes, the two food domes and the utilities dome. It rents beds to the people (the bed good, priced in its own MIND, so Law 5 pays its holders a fifth of every bed-day) and dome floor to the business COOPs that work in its domes (the food COOPs under glass, the data centres, workshops and stores), in its own MIND, so Law 5 applies to the rent too. The centre hex’s settlement COOP is the **Village COOP**: it owns the factory domes, the centre dome and the geothermal plant, rents the factory domes to the works, and sells electricity and heat; its advances paid for the drilling.${s0.domeFactory ? ` One factory dome is the **dome factory** (sandbox-7 DF): the Village COOP builds it in month ${s0.domeFactory.stands ?? '–'} and rents its floor to four lines, which make the domes’ parts from bought raw inputs: the timber COOPs run its struts line (glulam struts and cassette frames, beside their timber works), the steel COOPs its hub line, the glass COOPs its glazing line, the panel COOPs its solar line. While the build-out runs, the plan’s domes take what the lines make first and the COOPs get what is left; from then on the lines make what the village keeps up and builds, and the COOPs buy the parts finished only when the lines cannot keep up. The steelworks no longer melts scrap: its dome is one of the centre’s halls.` : ''} The **MaiaCity COOP** (the City COOP) is separate: it owns the land, leases it, and runs the bank. Ground rent: each landlord pays the MaiaCity COOP the ground rent for the land under its domes and passes it on in its rate a m², so a tenant pays no ground rent for floor under a dome.`, '');
	// the bill
	L.push('### The build-out bill', '');
	L.push('| item | € |', '|---|---|');
	for (const r of F.rows) L.push(`| ${r.label}${typeof r.t === 'number' && r.t > 0 ? ` (${k0(r.t)} t)` : ''} | ${eurM(r.eur)} |`);
	L.push(`| **total** | **${eurM(F.totalEur)}** |`, '');
	if (F.geothermal) L.push(`Of it, ${F.geothermal.label.toLowerCase()}: ${eurM(F.geothermal.eur)}, months ${F.geothermal.start}–${F.geothermal.end}, the Village COOP’s.`, '');
	L.push('| settlement COOP | founded (month) | done (month) | beds | domes | € |', '|---|---|---|---|---|---|');
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
	L.push(`From day 0 the COOPs buy abroad only what the village cannot yet make or grow: the food COOPs buy food in the diet’s mix, ${s0.domeFactory ? 'the timber works buy logs, the dome factory’s lines their raw inputs (lamellas, glue and C24 for the struts and frames; S355 plate, galvanising and bolts for the hubs; float glass with its coatings, PVB, edge seals and gaskets for the glazing; cells and their stringing for the solar panes) and the finished parts only when the lines cannot keep up' : 'the works buy logs, scrap, float glass and cells (and finished glulam, steel, glazing and panels when their works cannot keep up)'}, the hardware owners (the settlement COOPs and the Village COOP) buy accelerators, and while the village is being built its first solar COOP buys grid electricity when the village’s own falls short. The line sells electricity (the geothermal plant’s and the battery’s at the German day-ahead average, the sun’s at the month’s solar market value). No person holds euros, no MIND is made from euros, HEARTS never buy anything.`, '');
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
		L.push('### Rents (the settlement COOPs and the Village COOP)', '');
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

/** Proposition 3 in real units, every failing item, tenth and window, and the old money index beside it */
function p3Real(L, bases) {
	L.push('## Proposition 3 in real units, per tenth', '');
	const r0 = bases[0].p.P3.real;
	if (!r0) return;
	L.push(`**Rule.** ${r0.rule}. **Newcomers.** ${cap1(r0.newcomers)}.`, '');
	for (const b of bases) {
		const R = b.p.P3.real, O = b.p.P3.oldIndex;
		L.push(`#### Seed ${b.seed}: ${yes(R.pass)} in real units (${R.failedTenths.length} of 20 tenths fail over ${R.years} full years); the COOP part ${yes(b.p.P3.coops.pass)}`, '');
		L.push(`Old money index (comparison): ${O ? `${yes(O.pass)}, ${O.failed.length} of 20 deciles fail${O.failed.length ? ` (${O.failed.join(', ')})` : ''}` : '–'}.`, '');
		if (R.basicsFail.length) {
			const g = new Map();
			for (const x of R.basicsFail) {
				const k = `${x.by} tenth ${x.tenth}: ${x.item}`;
				if (!g.has(k)) g.set(k, []);
				g.get(k).push(`year ${x.year} ${k1(x.value)} of ${k1(x.need)} ${x.unit}`);
			}
			L.push('Basics below need: ' + [...g].map(([k, v]) => `${k} (${v.join('; ')})`).join('. ') + '.', '');
		}
		if (R.failures.length) {
			L.push('| tenth | item | windows with a fall over 2 % (years) | worst fall | binding limit |', '|---|---|---|---|---|');
			const g = new Map();
			for (const x of R.failures) {
				const k = `${x.by} ${x.tenth}|${x.item} (${x.unit})`;
				const e = g.get(k) ?? { w: [], worst: null };
				e.w.push(`${x.from}→${x.to}`);
				if (!e.worst || x.fall > e.worst.fall) e.worst = x;
				g.set(k, e);
			}
			for (const [k, e] of g) {
				const [t, item] = k.split('|');
				L.push(`| ${t} | ${item} | ${e.w.join(', ')} | ${pc(-e.worst.fall, 0)} (${k1(e.worst.before)} → ${k1(e.worst.after)}, years ${e.worst.from}→${e.worst.to}) | ${e.worst.bind} |`);
			}
			L.push('');
		}
		if (R.riseFail.length) L.push('Baskets that did not rise over the run: ' + R.riseFail.map((x) => `${x.by} tenth ${x.tenth} (up: ${x.up.join(', ') || 'nothing'}; down: ${x.down.join(', ') || 'nothing'})`).join('; ') + '.', '');
		const nEx = Array.isArray(R.excused) ? R.excused.length : R.excused;
		if (nEx) L.push(`${k0(nEx)} falls were excused (at satiation, or a physical limit bound that year).`, '');
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
		? `**The border (base setting: open for accelerators only).** A hex cannot make accelerators: a chip fab costs billions of euros and hundreds of megawatts, and no real town has one, so the base city buys them from outside, as a real city does. It does so only as COOPs trading through the euro reserve (paper §11.4): the hardware owners (the settlement COOPs and the Village COOP, round 4) buy accelerators for their data halls with euros the MaiaCity COOP’s bank advances, and pay the advances back in their own MIND; the bank’s own exports of electricity bought from the energy COOPs (a real sale in MIND, with Law 5) bring euros back. What replaces worn accelerators is upkeep and is served with the running class (world model 4.3), after the city’s basics and works and before any building; what a new hall’s accelerators need is served after the city’s own building class and before R&D. Neither takes electricity from the city’s basics or works. No person redeems MIND, no MIND is made from euros, and nothing else crosses the border. The closed city is B23's counter-case.${nums}`
		: `**The border (base setting: closed).** The base city neither imports nor exports; the open border for accelerators (paper §11.4) is B23's alternative.${nums}`;
}
const p3s = (p) => `P1 ${yes(p.P1.pass)}, P2 ${yes(p.P2.pass)}, P3 ${yes(p.P3.pass)}, MIND never binds a basic ${yes(p.abundance.pass)}`;

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
		L.push(`**The arrival day.** On the five seeds ${k0(arrPD)} of ${k0(arrN)} arrivals were short on their first day. On its first day a newcomer holds only its first HEARTS half: over all arrivals it was worth ${k2(all('arrivalHeartsR') / arrN)} R at the day’s pool prices against ${k2(all('arrivalBasicR') / arrN)} R of basics; for those who went short, ${arrPD ? k2(all('arrivalShortHeartsR') / arrPD) : '–'} R against ${arrPD ? k2(all('arrivalShortBasicR') / arrPD) : '–'} R. They arrive in the build-out’s dear quarters, when the food bought abroad and the beds’ upkeep at replacement prices make a day’s basics cost more than that half. From its second day a newcomer’s Aven’s work pays it (the work item’s pay settles the hours’ Aven service and the person gets the rest the same evening), so the shortfall is the first day. The basics are bought in the morning, before the day’s work is paid: the day’s electricity, the inference for the Avens’ work among it, is dispatched once, after everyone’s orders, so paying the work first would pay for hours whose power is not yet dispatched. Nothing is lent and nothing given: these short days are real, and P1 counts them.`, '');
		L.push(`**Owner-only people** (their Aven delivers nothing, so no work pay) were short on ${k0(all('ownerPD'))} person-days on the five seeds: their HEARTS half is their income, and while a day’s basics cost more than it, they live on what they hold. Since round 4 an owner-only Aven spends its income above the basics on extras as far as its holding keeps up with the melt (\`ownerRule\` 'income'), so it holds little when the dear quarters come; until round 4 it kept the whole HEARTS half (scenario B34 compares the two).`, '');
	}
	L.push('In the settlers’ months the whole economy is two people. Each MIND’s pools hold only a few MIND, so one day’s payments can move a MIND’s price tenfold. On some days the East settlement COOP’s treasury, which holds almost nothing but its own MIND, is worth too little to pay the heat of the two settlers’ beds, so the COOP delivers less of them (`engine.js affordCoops`: a COOP delivers only the basics whose energy it can pay for). This is a real result of the rules for a village of two: a MIND economy needs enough people trading for its prices to mean something. It ends when the first newcomers arrive.', '');
	L.push('Two causes of short days later in the build-out were found and fixed in round 3:', '');
	L.push('- **The weekly slow loop.** From the second year the slow loop ran weekly, and its week-sized lumps emptied the first settlement COOP’s treasury in early January. Now it runs every day while the village is being built.', '');
	L.push('- **Winter food prices.** A food COOP valued the food it bought abroad at no less than its own plants’ unit cost on the day. In a dark month that cost is the domes’ heat over the month’s small harvest, so in the build-out’s winters, when most of the food was bought, every imported kilogram was priced at it. Food then cost far more than over the year, and newcomers who held nothing yet could not pay for their basics. Imports are now valued at no less than the own plants’ unit cost over the year.', '');
	L.push('Two more were found and fixed in round 4. **The trap**: from the AI market’s first version a person bought its Aven’s work hours as Aven service from what it held, so a newcomer who held only its HEARTS half could not both work and eat; now the work item’s pay settles the hours’ Aven service at delivery and nobody needs MIND in hand before their Aven can work. **The border’s material prices**: the materials the works buy abroad when they cannot keep up are now read from Sandbox 6’s design package (spruce glulam, hubs welded from plate), not from the cast-hub and larch prices of package 1.', '');
}

/** the base world's evidence, seed by seed (the appendix) */
function baseEvidence(L, bases, exps, meta) {
	const b0 = bases[0];
	L.push('## Appendix: the base world in detail', '');
	L.push('All settings are the defaults (`DEFAULTS` in `src/lib/sandbox-9/genesis.js`); only the seed changes:', '');
	L.push('```', JSON.stringify(b0.defaults), '```', '');
	L.push('### P1 — every person, every basic, every day after day 0, at least 98 %', '');
	L.push('| seed | person-days short: food | water | energy | bed | people ever short | lowest share met (food / water / energy / bed, day) | worst person-day |', '|---|---|---|---|---|---|---|---|');
	for (const b of bases) {
		const p = b.p.P1, s = p.personDaysShort, lo = p.lowestShareMet;
		L.push(`| ${b.seed} | ${s.food} | ${s.water} | ${s.energy} | ${s.bed} | ${p.peopleEverShort} | ${['food', 'water', 'energy', 'bed'].map((g) => `${f(lo[g].share, 3)} (d${lo[g].day})`).join(' / ')} | ${p.worst ? `person ${p.worst.person}, day ${p.worst.day}, ${p.worst.good} ${f(p.worst.met, 3)}` : '–'} |`);
	}
	L.push('');
	if (bases.some((b) => b.s.rampShort)) p1Why(L, bases);
	L.push(`### P2 — the owner-only cohort (${b0.owners} people: Aven output 0, nothing held at the start)`, '');
	L.push('Strict: today’s Law 5 dividends alone pay today’s basic bundle, for every member (target: from day 120 on). Normal: every member met every basic and still holds MIND, every day.', '');
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
		L.push(`#### Seed ${b.seed}: ${yes(P3.pass)}${P3.failed.length ? ` (failing: ${P3.failed.join(', ')})` : ''}`, '');
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
	L.push('Checked every day; a leak throws (the proof runs with testMode off, so a finished run had none). The laws are checked every day too: each HEART’s two halves and the pools’ tenth, Law 5’s fifth against what was paid, and the pools untouched by Law 5.', '');
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
		headline: bases.length ? headline(exps, scen, bases).map((r) => ({ part: r.part, holds: r.holds, base: r.base, breaks: r.breaks })) : [],
		seeds: bases.map((b) => ({ seed: b.seed, params: paramDiff(b.s.params, pbase), living: round(b.s.living), border: { firstFedYear: b.s.food?.firstFedYear ?? null, lastImportYear: b.s.food?.lastImportYear ?? null, exportsCoverYear: firstYear(b.s.border, (x) => x.exportsCover), reserveOutYear: firstYear(b.s.border, (x) => x.reserveOut), reserveLow: round(Math.min(...(b.s.border ?? []).map((x) => x.reserveMinEur ?? Infinity))), importShortDays: (b.s.border ?? []).reduce((a, x) => a + (x.importShortDays ?? 0), 0), shortPD: b.p.P1.personDaysShortAny }, years: Math.round(b.s.days / 365), pass: b.p.pass, P1: b.p.P1.pass, shortPD: b.p.P1.personDaysShortAny, rampShort: b.s.rampShort ?? null, strictFrom: b.p.P2.strict.holdsEveryDayFrom, P2normal: b.p.P2.normal.pass, P3: b.p.P3.pass, P3failed: b.p.P3.failed, P3real: b.p.P3.real?.pass ?? null, P3realFailed: b.p.P3.real?.failedTenths ?? [], P3oldIndex: b.p.P3.oldIndex?.pass ?? null, bootstrapEur: round(-Math.min(...(b.s.border ?? []).map((x) => x.bank?.lowestEur ?? 0))), exportsOverImportsYear: firstYear(b.s.border, (x) => x.exportEur >= x.importEur), P3withoutCompute: b.p.P3.withoutCompute.pass, computeShareLast: round(b.p.P3.share.at(-1)?.all), coops: b.p.P3.coops.pass, mindBindsBasics: b.p.abundance.mindBindsBasics, seconds: round(b.ms / 1000) })),
		experiments: exps.map((e) => ({ id: e.r.id, question: e.r.question, ruleChanged: e.r.ruleChanged, people: e.r.people, years: e.r.years, seed: e.r.seed, params: { base: paramDiff(e.r.base.params, pbase), changed: paramDiff(e.r.changed.params, pbase) }, food: { base: round(e.r.base.food ?? null), changed: round(e.r.changed.food ?? null) }, pass: e.r.verdict.pass, ens: e.r.ens ?? null, claim: e.r.verdict.claim, evidence: e.r.verdict.evidence, takeaway: e.r.takeaway, metrics: e.r.metrics.map((m) => ({ id: m.id, label: m.label, base: round(m.base), changed: round(m.changed) })), seconds: round(e.ms / 1000) })),
		scenarios: scen.map((s) => ({ id: s.id, name: s.name, paper: s.paper, claim: s.claim, pass: s.pass, takeaway: s.takeaway, evidence: s.evidence, runs: s.runs.map((r) => ({ label: r.label, people: r.people ?? 1500, years: r.years, params: r.params ? paramDiff(r.params, pbase) : null, food: r.food ? round(r.food) : null })), numbers: round(s.numbers), seconds: round(s.ms / 1000) })),
		notCovered: notCovered.map(([id, name, why]) => ({ id, name, why }))
	};
}

if (isMainThread) await main();
