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
 *
 * Every number in the report is computed by the run; nothing is typed in.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
	const results = await runAll(jobs, par);
	const wall = Date.now() - t0;
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
	const { catalogList, STARTING_CAPITAL } = await import(join(LIB, 'primitives.js'));
	const { ENGINE_FILES, engineHash } = await import(join(LIB, 'proofRun.js'));
	const hash = engineHash(Object.fromEntries(ENGINE_FILES.map((fl) => [fl, readFileSync(join(LIB, fl), 'utf8')])));
	const meta = { wall, set, now, only, quick, hash, threads: par, totalCpu: results.reduce((a, r) => a + r.ms, 0), catalog: catalogList(), start: STARTING_CAPITAL };
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
		base: bases.map((b) => b.p.P1.personDaysShortAny).join(', ') + ' person-days short (seeds ' + bases.map((b) => b.seed).join(', ') + ')',
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
		part: 'P3 — living standards rise for every decile',
		holds: allB((b) => b.p.P3.pass),
		base: 'worst 5-year fall ' + bases.map((b) => pc(Math.max(...b.p.P3.deciles.map((d) => d.fall ?? 0)), 1)).join(', ') + '; deciles failing ' + bases.map((b) => b.p.P3.failed.length).join(', ') + '; without Aven services in the index, deciles failing ' + bases.map((b) => b.p.P3.withoutCompute.failed.length).join(', ') + '; Aven services’ share of the index in the last year ' + bases.map((b) => pc(b.p.P3.share.at(-1)?.all, 0)).join(', ') + '; COOP part ' + bases.map((b) => yes(b.p.P3.coops.pass)).join(', '),
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
		foodAndLand(L, bases, scen);
		foundingAndBorder(L, bases, scen);
	}

	// headline
	if (bases.length) {
		L.push('## Headline: does Proposition 3 hold?', '');
		L.push(`The base world: ${k0(bases[0].N)} people, ${Math.round(bases[0].s.days / 365)} years, seeds ${bases.map((b) => b.seed).join(', ')}. Each part is checked per person, every day. The strict test starts from a cold start, where everyone holds nothing; A07 tests owner-only newcomers who join a settled city.`, '');
		L.push(borderLine(bases[0], scen), '');
		L.push('| part | base world, every seed | what it shows | where it breaks |', '|---|---|---|---|');
		for (const r of headline(exps, scen, bases)) L.push(`| ${r.part} | **${r.holds ? 'holds' : 'fails'}** | ${r.base} | ${r.breaks.length ? r.breaks.join(', ') : 'nowhere in this suite'} |`);
		L.push('');
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
	L.push(`${k0(b0.N)} people live in Sandbox 6’s village: six living hexes of homes, food domes and food forest round a centre hex of works, ${k0(s0.params?.settings?.beds)} beds, ${s0.params?.settings?.tower ? 'with the Tower180' : 'no tower'}. The run starts on moving-in day, with the outdoor food forest just planted. They eat ${fl.dietLabel ?? fl.diet} (${k0(fl.kcalDay)} kcal and ${k0(fl.proteinDay)} g of protein a day as planned; need 2,240 kcal and 73 g). Tenths are by MIND holdings, each a yearly mean a person a day unless it says otherwise. Seed ${b0.seed}; the five seeds side by side follow.`, '');
	L.push('| year | tenth | ' + MEASURES.map((m) => m[1]).join(' | ') + ' | people short of anything that year |', '|---|---|' + '---|'.repeat(MEASURES.length + 1));
	for (const y of ys) {
		const r = Ls[y - 1];
		for (const [k, name] of Object.entries(TENTH_NAMES)) L.push(`| ${y} | ${name} | ${MEASURES.map(([m, , fm]) => fm(r.tenths[k][m])).join(' | ')} | ${k0(r.tenths[k].shortPeople)} |`);
	}
	L.push('');
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
	if (Vs.length && (Vs.length - 1) % 5 !== 0 && Vs.length > 10) {
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
	L.push(`So a m² gives ${k0(fl.kcalM2Year.out)} kcal of this diet a year outdoors and ${k0(fl.kcalM2Year.in)} under glass at maturity. With 15 % lost after the harvest, the village’s ${k1(fl.foodHa.out)} ha outdoors and ${k1(fl.foodHa.in)} ha under glass feed **${k0(fl.peopleFed.all)} people** in an average mature year (${k0(fl.peopleFed.out)} from outdoors, ${k0(fl.peopleFed.in)} from the domes); ${k0(bases[0].N)} live there.`, '');
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
	L.push('## The founding bill and the border', '');
	L.push(`Before day 0 the village is built from imports (paper §12.4: “Euros fund the first machines, never MIND”). ${cap1(F.sources?.tower ?? '')}. Prices: ${F.sources?.prices ?? ''}.`, '');
	L.push('| item | quantity | € |', '|---|---|---|');
	for (const r of F.rows) {
		const q = typeof r.t === 'number' ? `${k0(r.t)} t` : r.kwp ? `${k0(r.kwp)} kWp` : r.n ? `${k0(r.n)}` : r.kcal ? `${k0(r.kcal / 1e6)} million kcal` : r.ha ? `${k1(r.ha)} ha` : '';
		L.push(`| ${r.label} | ${q} | ${eurM(r.eur)} |`);
	}
	L.push(`| **total** | ${k0(F.tonnes)} t of materials | **${eurM(F.totalEur)}** |`, '');
	L.push('From day 0 the COOPs buy abroad only what the village cannot yet make or grow, through the shared euro reserve: the food COOPs buy food in the diet’s mix, the works buy logs, scrap, float glass and cells (and finished glulam, steel, glazing and panels when their works cannot keep up), the COMPUTE COOPs buy accelerators. They pay with the electricity they export at €87.5 a MWh. No person holds euros, no MIND is made from euros, HEARTS never buy anything.', '');
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

/** the base world's border setting, as the run had it, and why (the other setting is B23's counter-case) */
function borderLine(b0, scen) {
	// the base run's own setting: the defaults with what --set changed, as the world ran it
	const open = b0.s.chipImport !== false;
	const b23 = scen.find((s) => s.id === 'B23');
	const rows = b23?.numbers?.rows ?? [];
	const lm = (r) => `a mean living standard of ${r.Lmean.toFixed(2)} in the last year (P3 ${yes(r.P3)})`;
	const nums = rows.length >= 3 ? ` In B23 (seed ${rows[0].seed}, ${rows[0].years} years) the ${open ? 'open base' : 'closed base'} had ${rows[0].computeRun.toFixed(2)} h of Aven services a person a day over the run (${rows[0].computeLast.toFixed(2)} in the last year) and ${lm(rows[0])}; the ${open ? 'closed' : 'open'} city ${rows[1].computeRun.toFixed(2)} h (${rows[1].computeLast.toFixed(2)}) and ${lm(rows[1])}; with accelerators three times dearer from year 10, ${rows[2].computeRun.toFixed(2)} h (${rows[2].computeLast.toFixed(2)}) and ${lm(rows[2])}. Accelerators three times dearer changed the mean living standard in the last year by ${pc(rows[2].Lmean / rows[0].Lmean - 1, 1)} and Aven services by ${pc(rows[2].computeLast / Math.max(1e-12, rows[0].computeLast) - 1, 1)}; Aven services are ${pc(b0.p.P3.share.at(-1)?.all, 0)} of the base index in the last year.` : '';
	return open
		? `**The border (base setting: open for accelerators only).** A hex cannot make accelerators: a chip fab costs billions of euros and hundreds of megawatts, and no real town has one, so the base city buys them from outside, as a real city does. It does so only as COOPs trading through the euro reserve (paper §11.4): a COMPUTE COOP buys electricity from the energy COOPs (a real sale in MIND, with Law 5), the line exports it, the euros go into that COOP’s own account in the reserve, and the reserve buys accelerators with them. What replaces worn accelerators is upkeep and is served with the running class (world model 4.3), after the city’s basics and works and before any building; what a new hall’s accelerators need is served after the city’s own building class and before R&D. Neither takes electricity from the city’s basics or works. No person redeems MIND, no MIND is made from euros, and nothing else crosses the border. The closed city is B23's counter-case.${nums}`
		: `**The border (base setting: closed).** The base city neither imports nor exports; the open border for accelerators (paper §11.4) is B23's alternative.${nums}`;
}
const p3s = (p) => `P1 ${yes(p.P1.pass)}, P2 ${yes(p.P2.pass)}, P3 ${yes(p.P3.pass)}, MIND never binds a basic ${yes(p.abundance.pass)}`;

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
	L.push(`### P2 — the owner-only cohort (${b0.owners} people: Aven output 0, nothing held at the start)`, '');
	L.push('Strict: today’s Law 5 dividends alone pay today’s basic bundle, for every member (target: from day 120 on). Normal: every member met every basic and still holds MIND, every day.', '');
	L.push('| seed | strict: first day | holds every day from | days failing after the first | worst ratio after the first (day) | lowest ratio by year (1–5, last) | normal: failures | lowest holding (days of the bundle), year 1 → last |', '|---|---|---|---|---|---|---|---|');
	for (const b of bases) {
		const s = b.p.P2.strict, n = b.p.P2.normal, lr = s.lowestRatioByYear, hd = n.lowestHoldingDaysByYear;
		L.push(`| ${b.seed} | ${s.firstDay} | ${s.holdsEveryDayFrom} | ${s.failDaysAfterFirst} | ${s.worstAfterFirst ? `${f(s.worstAfterFirst.ratio)} (d${s.worstAfterFirst.day})` : '–'} | ${lr.slice(1, 6).map((x) => f(x)).join(', ')}, … ${f(lr[lr.length - 1])} | ${n.failures} | ${f(hd[1], 0)} → ${f(hd[hd.length - 1], 0)} |`);
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
	L.push('Catalog (`STARTING_CAPITAL`, estimate): ' + Object.entries(meta.start.v).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(' + ') : v}`).join('; ') + '.', '');
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
		generated: meta.now,
		command: 'node scripts/sandbox-9-proof.mjs',
		engineHash: meta.hash,
		wallSeconds: Math.round(meta.wall / 1000),
		headline: bases.length ? headline(exps, scen, bases).map((r) => ({ part: r.part, holds: r.holds, base: r.base, breaks: r.breaks })) : [],
		seeds: bases.map((b) => ({ seed: b.seed, params: paramDiff(b.s.params, pbase), living: round(b.s.living), border: { firstFedYear: b.s.food?.firstFedYear ?? null, lastImportYear: b.s.food?.lastImportYear ?? null, exportsCoverYear: firstYear(b.s.border, (x) => x.exportsCover), reserveOutYear: firstYear(b.s.border, (x) => x.reserveOut), reserveLow: round(Math.min(...(b.s.border ?? []).map((x) => x.reserveMinEur ?? Infinity))), importShortDays: (b.s.border ?? []).reduce((a, x) => a + (x.importShortDays ?? 0), 0), shortPD: b.p.P1.personDaysShortAny }, years: Math.round(b.s.days / 365), pass: b.p.pass, P1: b.p.P1.pass, shortPD: b.p.P1.personDaysShortAny, strictFrom: b.p.P2.strict.holdsEveryDayFrom, P2normal: b.p.P2.normal.pass, P3: b.p.P3.pass, P3failed: b.p.P3.failed, P3withoutCompute: b.p.P3.withoutCompute.pass, computeShareLast: round(b.p.P3.share.at(-1)?.all), coops: b.p.P3.coops.pass, mindBindsBasics: b.p.abundance.mindBindsBasics, seconds: round(b.ms / 1000) })),
		experiments: exps.map((e) => ({ id: e.r.id, question: e.r.question, ruleChanged: e.r.ruleChanged, people: e.r.people, years: e.r.years, seed: e.r.seed, params: { base: paramDiff(e.r.base.params, pbase), changed: paramDiff(e.r.changed.params, pbase) }, food: { base: round(e.r.base.food ?? null), changed: round(e.r.changed.food ?? null) }, pass: e.r.verdict.pass, ens: e.r.ens ?? null, claim: e.r.verdict.claim, evidence: e.r.verdict.evidence, takeaway: e.r.takeaway, metrics: e.r.metrics.map((m) => ({ id: m.id, label: m.label, base: round(m.base), changed: round(m.changed) })), seconds: round(e.ms / 1000) })),
		scenarios: scen.map((s) => ({ id: s.id, name: s.name, paper: s.paper, claim: s.claim, pass: s.pass, takeaway: s.takeaway, evidence: s.evidence, runs: s.runs.map((r) => ({ label: r.label, people: r.people ?? 1500, years: r.years, params: r.params ? paramDiff(r.params, pbase) : null, food: r.food ? round(r.food) : null })), numbers: round(s.numbers), seconds: round(s.ms / 1000) })),
		notCovered: notCovered.map(([id, name, why]) => ({ id, name, why }))
	};
}

if (isMainThread) await main();
