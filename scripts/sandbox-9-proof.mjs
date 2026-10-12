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
 *   node scripts/sandbox-9-proof.mjs              everything, in worker threads (about three minutes on 4 cores)
 *   node scripts/sandbox-9-proof.mjs --only X1,B28 some experiments or scenarios (S00 = the five base seeds)
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
		const r = runExperiment(EXPERIMENTS[job.id], { config: job.set });
		const slim = (x) => ({ label: x.label, values: x.values, prop3: { pass: x.prop3.pass, P1: { pass: x.prop3.P1.pass, personDaysShortAny: x.prop3.P1.personDaysShortAny }, P2: { pass: x.prop3.P2.pass, strictFrom: x.prop3.P2.strict.holdsEveryDayFrom, normal: x.prop3.P2.normal.pass }, P3: { pass: x.prop3.P3.pass, failed: x.prop3.P3.failed }, abundance: { pass: x.prop3.abundance.pass, mindBindsBasics: x.prop3.abundance.mindBindsBasics } } });
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
	const oi = args.indexOf('--only');
	const only = oi >= 0 ? args[oi + 1].split(',') : null;
	const di = args.indexOf('--out');
	const OUT = di >= 0 ? args[di + 1] : '/mnt/project-files/theos/sandbox-8';
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
	const specs = scenIds.length ? runSpecs(scenIds) : [];
	const isBase = (sp) => sp.years === 30 && Object.keys(sp.config).every((k) => k === 'seed' || k === 'people') && sp.config.people === 250;
	const jobs = [
		...specs.map((spec) => ({ kind: 'run', spec, set, detail: isBase(spec), cost: spec.years * Math.pow(spec.config.people ?? 250, 0.3) * (spec.config.coopsPerGood === 4 ? 1.6 : 1) })),
		...expIds.map((id) => {
			const e = EXPERIMENTS[id];
			return { kind: 'exp', id, set, cost: 2 * e.years * Math.pow(e.people ?? 250, 0.3) };
		})
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
	const exps = expIds.map((id) => results.find((x) => x.job.kind === 'exp' && x.job.id === id));
	const scen = scenIds.map((id) => {
		const s = SCENARIOS.find((x) => x.id === id);
		const v = judge(id, R);
		const ms = s.runs.reduce((a, r) => a + (R[r.key]?.ms ?? 0), 0);
		return { id, name: s.name, paper: s.paper, stress: s.stress, claim: s.claim, runs: s.runs.map((r) => ({ label: r.label, years: r.years, people: r.config.people, ms: R[r.key]?.ms })), ms, ...v };
	});
	const bases = BASE_KEYS_SEEDS.filter((sd) => detail[sd]).map((sd) => ({ seed: sd, ...detail[sd] }));
	const now = new Date().toISOString();
	printTable(exps, scen, wall);
	const { catalogList, STARTING_CAPITAL } = await import(join(LIB, 'primitives.js'));
	const meta = { wall, set, now, only, threads: par, totalCpu: results.reduce((a, r) => a + r.ms, 0), catalog: catalogList(), start: STARTING_CAPITAL };
	const md = report(exps, scen, bases, NOT_COVERED, meta);
	mkdirSync(OUT, { recursive: true });
	const suffix = (only ? '-' + only.join('-') : '') + (Object.keys(set).length ? '-set' : '');
	writeFileSync(join(OUT, `proof${suffix}.md`), md);
	writeFileSync(join(OUT, `proof${suffix}.csv`), toCsv(exps, scen, bases, R));
	if (!only && !Object.keys(set).length) {
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
const yes = (b) => (b ? 'PASS' : 'FAIL');
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
	const fails = (list) => list.filter((x) => x && !x.pass).map((x) => x.id);
	const failE = (list) => list.map(E).filter((x) => x && !x.verdict.pass).map((x) => x.id);
	rows.push({
		part: 'P1 — no one starves',
		holds: allB((b) => b.p.P1.pass),
		base: bases.map((b) => b.p.P1.personDaysShortAny).join(', ') + ' person-days short (seeds ' + bases.map((b) => b.seed).join(', ') + ')',
		breaks: [...failE(['X5', 'X12', 'X14', 'SH']), ...fails(['B10', 'B15', 'B26', 'B29'].map(S))]
	});
	rows.push({
		part: 'P2 strict — dividends alone pay the basic bundle',
		holds: allB((b) => b.p.P2.strict.pass),
		base: 'holds every day from day ' + bases.map((b) => b.p.P2.strict.holdsEveryDayFrom).join(', ') + ' (target ≤ 120)',
		breaks: [...failE(['X2']), ...fails(['B03'].map(S))]
	});
	rows.push({
		part: 'P2 normal — no one has to work to survive',
		holds: allB((b) => b.p.P2.normal.pass),
		base: bases.map((b) => b.p.P2.normal.failures).join(', ') + ' failures',
		breaks: [...failE(['X2']), ...fails(['B05'].map(S))]
	});
	rows.push({
		part: 'P3 — living standards rise for every decile',
		holds: allB((b) => b.p.P3.pass),
		base: 'worst 5-year fall ' + bases.map((b) => pc(Math.max(...b.p.P3.deciles.map((d) => d.worstDrawdown?.fall ?? 0)), 2)).join(', ') + '; deciles failing ' + bases.map((b) => b.p.P3.failed.length).join(', '),
		breaks: [...failE(['X10', 'SH']), ...fails(['B27', 'S01'].map(S))]
	});
	rows.push({
		part: 'Abundance limited only by physics',
		holds: allB((b) => b.p.abundance.pass) && [E('X9'), E('AB1')].every((x) => !x || x.verdict.pass) && [S('B28'), S('B29')].every((x) => !x || x.pass),
		base: 'MIND bound a basic on ' + bases.map((b) => b.p.abundance.mindBindsBasics).join(', ') + ' days; X9 ' + (E('X9') ? yes(E('X9').verdict.pass) : '–') + ', AB1 ' + (E('AB1') ? yes(E('AB1').verdict.pass) : '–') + ', B28 ' + (S('B28') ? yes(S('B28').pass) : '–') + ', B29 ' + (S('B29') ? yes(S('B29').pass) : '–'),
		breaks: [...failE(['X9', 'X11', 'AB1']), ...fails(['B28', 'B29'].map(S))]
	});
	return rows;
}

/**
 * Why each known failure fails, and which mechanism inside the rules would fix it. These are notes, written by
 * reading the runs; they hold no numbers, and the report prints one only while its item fails in the run.
 */
const DIAGNOSIS = {
	X5: ['The second food seller holds only the greenhouse, a small part of the food. It cannot replace the failing forest in winter. The receiver hands the forest on, but the autumn harvest is already lost.', 'On the first day of the audit, the receiver moves the stored food with the plants. Then the harvest is not lost.'],
	X7: ['The forward-margin rule sets each price from the seller’s own costs and forecast. It does not read rival prices, so a second seller does not push the margin down.', 'A price rule that lowers the margin when buyers move to a cheaper rival (the logit share it already sees).'],
	X8: ['Primer’s adaptive price swings less and leaves the poorest decile better off than the forward margin. The claim that the forward rule is better is false here.', 'Use Primer’s adaptive baseline as the default price rule, or damp the forward margin to the same speed.'],
	X12: ['All land is on fixed leases that never return. New beds and greenhouses need land, so newcomers wait for capacity that cannot be built.', 'Leases that renew at the auction rent, or unused plots that go back to the City COOP. Then the HOME and food COOPs can bid for them.'],
	B15: ['All land is on fixed leases that never return. New beds and greenhouses need land, so newcomers and then everyone fall short.', 'Leases that renew at the auction rent, or unused plots that go back to the City COOP. Then the HOME and food COOPs can bid for them.'],
	X13: ['Private ground rent is small beside the HEARTS a person sends each day. It does not move the holdings Gini.', 'None needed for the rule itself: all land stays with the City COOP. The test needs a world where land is scarce (growth) to show the difference.'],
	B09: ['Private ground rent is small beside the HEARTS a person sends each day. It does not move the holdings Gini, but the private-land world fails P3.', 'None needed for the rule itself: all land stays with the City COOP. The claim about the Gini needs a world where land is scarce.'],
	SH: ['The well failure stops geothermal power in winter. Solar power cannot cover the gap, so energy and beds fall short. The lower deciles recover more slowly than two years.', 'A second geothermal well or a seasonal energy store, built by the GEO COOP from its own reserve.'],
	B02: ['The direction holds: payout gives people a much larger share. The gap is smaller than the paper says, because the keep world still pays the Law 5 dividend to holders.', 'None needed: the rule works. The 50-point threshold in the claim is too high for a world that keeps Law 5.'],
	B03: ['Early in the city, holdings are small and the Law 5 dividend is a fixed share of revenue. So the yield is far above the melt. It falls under 7 % only when holdings near their resting level, later for a larger share.', 'A smaller Law 5 share keeps the yield under the melt sooner. A rule that pays the share into the pools until holdings settle would also work; it is a rule change for the authors.'],
	B17: ['Avens move HEARTS by a replicator on delivered output per HEART. Its step is slow, so a failing COOP keeps most of its HEARTS for months.', 'A faster replicator step or a shorter average of delivered output in each Aven’s policy.'],
	B22: ['At melts under 7 % the lower deciles fall more than 2 % in a five-year window. The Gini does not fall with the rate, because the Aven spread sets it.', 'None: the melt stays at 7 %. The sweep shows that a lower melt breaks P3.'],
	B29: ['Take 50 people with geothermal on a hex built for 250. The material chain (timber, steel, glass, panels, goods) sells almost nothing and goes into receivership. Nobody rebuilds it, homes and plants wear out, and MIND binds water and energy at the end.', 'A Law 3 founding when a good has no seller and orders go unfilled, so a small village restarts its material chain.'],
	B30: ['The forward margin is not calmer than Primer’s adaptive price, and Mark-0 and Primer leave the poorest decile better off.', 'Use Primer’s adaptive baseline as the default price rule, or damp the forward margin.'],
	B31: ['More sellers per good do not lower the price over full cost: the forward margin does not read rival prices. With four sellers each is too small, and food falls short.', 'A price rule that reads the share it loses to rivals. Also, a Law 3 rule that does not split a good below a working plant size.'],
	B32: ['With 10 people, each decile is one person. One person’s bad year breaks P3.', 'None: P3 is a statement about deciles, so it needs at least 100 people.'],
	S01: ['With no Law 5 dividend, owner-only people have no income: P1 and P2 fail at every melt. With a 10 % share, P3 fails at every melt.', 'None: Law 5 stays at 20 %. The grid shows that the result needs a Law 5 share of 20 % or more.']
};

function report(exps, scen, bases, notCovered, meta) {
	const L = [];
	const nPass = exps.filter((e) => e.r.verdict.pass).length + scen.filter((s) => s.pass).length;
	L.push('# Sandbox 8 — the proof of Proposition 3', '');
	L.push(`Run ${meta.now.slice(0, 16).replace('T', ' ')} UTC by \`node scripts/sandbox-9-proof.mjs${meta.only ? ' --only ' + meta.only.join(',') : ''}\`. Engine: \`src/lib/sandbox-9/\`. Wall time ${(meta.wall / 1000).toFixed(0)} s on ${meta.threads} threads (${(meta.totalCpu / 1000).toFixed(0)} s of runs). Every number below comes from the run.`, '');
	if (Object.keys(meta.set).length) L.push(`**Settings changed from the defaults in every world:** \`${JSON.stringify(meta.set)}\`.`, '');
	L.push(`${exps.length} experiments and ${scen.length} scenarios ran. ${nPass} pass and ${exps.length + scen.length - nPass} fail.`, '');

	// headline
	if (bases.length) {
		L.push('## Headline: does Proposition 3 hold?', '');
		L.push(`The base world: ${bases[0].N} people, 30 years, seeds ${bases.map((b) => b.seed).join(', ')}. Each part is checked per person, every day.`, '');
		L.push('| part | base world, every seed | what it shows | where it breaks |', '|---|---|---|---|');
		for (const r of headline(exps, scen, bases)) L.push(`| ${r.part} | **${r.holds ? 'holds' : 'fails'}** | ${r.base} | ${r.breaks.length ? r.breaks.join(', ') : 'nowhere in this suite'} |`);
		L.push('');
	}

	// the verdict table
	L.push('## Every experiment and scenario', '');
	L.push('| id | question or scenario | verdict | key result | people × years | run time |', '|---|---|---|---|---|---|');
	for (const e of exps) L.push(`| ${e.r.id} | ${e.r.question} | **${yes(e.r.verdict.pass)}** | ${e.r.verdict.evidence.replace(/\|/g, '/')} | ${e.r.people.base === e.r.people.changed ? e.r.people.base : `${e.r.people.base} / ${e.r.people.changed}`} × ${e.r.years} | ${(e.ms / 1000).toFixed(1)} s |`);
	for (const s of scen) L.push(`| ${s.id} | ${s.name} | **${yes(s.pass)}** | ${s.takeaway.replace(/\|/g, '/')} | ${[...new Set(s.runs.map((r) => `${r.people ?? 250} × ${r.years}`))].join(', ')} | ${(s.ms / 1000).toFixed(0)} s |`);
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
			L.push(`**Runs.** ${s.runs.map((r) => `${r.label} (${r.people ?? 250} people, ${r.years} years)`).join('; ')}.`, '');
			L.push(`**Result.** ${s.takeaway}`, '');
			L.push(`**Verdict: ${yes(s.pass)}.** ${s.evidence}`, '');
		}
	}

	// what fails and why
	const failing = [...exps.filter((e) => !e.r.verdict.pass).map((e) => [e.r.id, e.r.verdict.evidence]), ...scen.filter((s) => !s.pass).map((s) => [s.id, s.evidence])];
	if (failing.length) {
		L.push('## What fails', '');
		L.push('Each item fails in this run. The evidence line is computed. The cause and the in-rules fix are notes written after reading the runs of 2026-10-12. They print only while the item fails. No fix below is tested yet.', '');
		for (const [id, ev] of failing) {
			L.push(`- **${id}:** ${ev}`);
			const d = DIAGNOSIS[id];
			if (d) L.push(`  - *Cause:* ${d[0]}`, `  - *In-rules fix:* ${d[1]}`);
		}
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
	L.push('Each decile’s living standard is what its people consumed, at base-year prices, as a 365-day trailing mean. **Fall** is the largest drop from any earlier point within 5 years. **Net** is the worst change over a full 5-year window. Pass: fall ≤ 2 %, and the decile rises or ends within 5 % of the physics ceiling.', '');
	for (const b of bases) {
		const P3 = b.p.P3;
		L.push(`#### Seed ${b.seed}: ${yes(P3.pass)}${P3.failed.length ? ` (failing: ${P3.failed.join(', ')})` : ''}`, '');
		L.push('| decile | first full year | last year | ceiling | rises | near ceiling | largest fall (peak day → day) | worst net 5-year change | pass |', '|---|---|---|---|---|---|---|---|---|');
		for (const d of P3.deciles) L.push(`| ${d.by} ${d.decile} | ${f(d.first)} | ${f(d.last)} | ${f(d.ceiling)} | ${d.rises ? 'yes' : 'no'} | ${d.nearCeiling ? 'yes' : 'no'} | ${pc(d.worstDrawdown?.fall, 2)} (${d.worstDrawdown?.peakDay} → ${d.worstDrawdown?.day}) | ${pc(d.worstNet?.change, 2)} | ${yes(d.pass)} |`);
		L.push('');
		const c = P3.coops;
		L.push(`COOPs: ${c.alive} alive at the end, ${c.founded} founded (Law 3), ${c.receiverships.length} receiverships. Basic shortfall around any receivership (30 days before to 90 after): ${c.receiverships.reduce((a, r) => a + r.basicShortPersonDaysAround, 0)} person-days. Insolvent at the end: ${c.insolventNow.length ? c.insolventNow.map((x) => `${x.coop} (${x.lowDays} d)`).join(', ') : 'none'}. ${yes(c.pass)}.`, '');
		if (c.receiverships.length) L.push('Receiverships: ' + c.receiverships.map((r) => `${r.coop} (${r.good}) day ${r.day} → ${r.heir ?? 'City COOP'}: ${r.why}`).join('; ') + '.', '');
	}
	L.push('### Decile series (seed 20261012, yearly mean living standard)', '');
	const yrs = b0.p.P3.deciles[0].byYear.length;
	L.push('| year | ' + Array.from({ length: 10 }, (_, x) => `H${x + 1}`).join(' | ') + ' | ' + Array.from({ length: 10 }, (_, x) => `A${x + 1}`).join(' | ') + ' | ceiling |', '|---|' + '---|'.repeat(21));
	for (let y = 0; y < yrs; y++) L.push(`| ${y + 1} | ${b0.p.P3.deciles.map((d) => f(d.byYear[y], 1)).join(' | ')} | ${f(b0.s.years[y]?.Lceil, 1)} |`);
	L.push('', 'H = by holdings, A = by Aven output; decile 1 is the lowest.', '');
	L.push('### Binding limits over time (seed 20261012)', '');
	L.push('Share of days each limit bound each good (world model 5.6). For the basics, “need met” means nobody was short. For the rest, “MIND” means some people would have bought more with more to spend, “demand” that everyone who wanted it got it, and a physical name that the sellers were sold out because of it.', '');
	const per = b0.p.limits[0].periods;
	L.push('| good | ' + per.map((p) => `days ${p.from}–${p.to}`).join(' | ') + ' | ceiling a person (last period) |', '|---|' + '---|'.repeat(per.length + 1));
	for (const l of b0.p.limits) L.push(`| ${l.good} | ${l.periods.map((p) => p.shares.slice(0, 3).map((s) => `${s.limit} ${pc(s.share, 0)}`).join(', ')).join(' | ')} | ${f(l.periods[l.periods.length - 1].ceilingPerPerson, 4)} |`);
	L.push('');
	L.push('### Energy a person against living standard, by decile (seed 20261012)', '');
	L.push('Each cell: living standard / the person’s own electricity use (kWh a day), yearly mean. Then all electricity used and the surplus (R&D, storage, curtailed), a person a day.', '');
	const E = b0.p.energy;
	L.push('| year | H1 | H3 | H5 | H7 | H10 | A1 | A5 | A10 | all kWh/p/d | surplus kWh/p/d |', '|---|---|---|---|---|---|---|---|---|---|---|');
	for (let y = 0; y < E.ePP.length; y += y < 5 ? 1 : 5) {
		const c = (row, x) => `${f(row[x].living, 1)} / ${f(row[x].kwh, 1)}`;
		L.push(`| ${y + 1} | ${c(E.holdings[y], 0)} | ${c(E.holdings[y], 2)} | ${c(E.holdings[y], 4)} | ${c(E.holdings[y], 6)} | ${c(E.holdings[y], 9)} | ${c(E.aven[y], 0)} | ${c(E.aven[y], 4)} | ${c(E.aven[y], 9)} | ${f(E.ePP[y], 1)} | ${f(E.surplusPP[y], 1)} |`);
	}
	L.push('');
	L.push('### The two ledgers', '');
	L.push('Checked every day; a leak throws (the proof runs with testMode off, so a finished run had none).', '');
	L.push('| seed | checks | MIND: largest relative error | MIND leaks | matter: largest relative error | matter leaks | energy: largest relative error | energy leaks | melt index at the end | run time |', '|---|---|---|---|---|---|---|---|---|---|');
	for (const b of bases) {
		const g = b.s.ledger;
		L.push(`| ${b.seed} | ${g.checks} | ${g.mindMaxRel.toExponential(2)} | ${g.mindLeaks.length} | ${g.matterMaxRel.toExponential(2)} | ${g.matterLeaks.length} | ${g.energyMaxRel.toExponential(2)} | ${g.energyLeaks.length} | ${f(g.meltIndex, 4)} | ${(b.ms / 1000).toFixed(1)} s |`);
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
function toJson(exps, scen, bases, notCovered, meta) {
	return {
		generated: meta.now,
		command: 'node scripts/sandbox-9-proof.mjs',
		wallSeconds: Math.round(meta.wall / 1000),
		headline: bases.length ? headline(exps, scen, bases).map((r) => ({ part: r.part, holds: r.holds, base: r.base, breaks: r.breaks })) : [],
		seeds: bases.map((b) => ({ seed: b.seed, pass: b.p.pass, P1: b.p.P1.pass, shortPD: b.p.P1.personDaysShortAny, strictFrom: b.p.P2.strict.holdsEveryDayFrom, P2normal: b.p.P2.normal.pass, P3: b.p.P3.pass, P3failed: b.p.P3.failed, mindBindsBasics: b.p.abundance.mindBindsBasics, seconds: round(b.ms / 1000) })),
		experiments: exps.map((e) => ({ id: e.r.id, question: e.r.question, ruleChanged: e.r.ruleChanged, people: e.r.people, years: e.r.years, seed: e.r.seed, pass: e.r.verdict.pass, claim: e.r.verdict.claim, evidence: e.r.verdict.evidence, takeaway: e.r.takeaway, metrics: e.r.metrics.map((m) => ({ id: m.id, label: m.label, base: round(m.base), changed: round(m.changed) })), seconds: round(e.ms / 1000) })),
		scenarios: scen.map((s) => ({ id: s.id, name: s.name, paper: s.paper, claim: s.claim, pass: s.pass, takeaway: s.takeaway, evidence: s.evidence, runs: s.runs.map((r) => ({ label: r.label, people: r.people ?? 250, years: r.years })), numbers: round(s.numbers), seconds: round(s.ms / 1000) })),
		notCovered: notCovered.map(([id, name, why]) => ({ id, name, why }))
	};
}

if (isMainThread) await main();
