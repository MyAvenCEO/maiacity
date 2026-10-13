// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE PROOF FOR THE PAGE — runs the proof suite (the base world on five seeds, then every experiment;
 * src/lib/sandbox-9/proofRun.js) in node's worker threads and writes what the page's Proof view reads:
 *
 *   static/sandbox-9/proof.json
 *
 *   node scripts/sandbox-9-proof-json.mjs            30-year base worlds and full experiments (a few minutes)
 *   node scripts/sandbox-9-proof-json.mjs --quick    10-year base worlds and shorter experiments
 *   --out <file>                                     write it elsewhere
 *
 * The detailed report (proof.md, proof.csv) stays scripts/sandbox-9-proof.mjs's; this one writes the same verdicts as
 * data, every pass flag computed by the engine from the runs. The proof suite's summary (the `suite` key that
 * scripts/sandbox-9-proof.mjs adds) is kept from the file already there, and its verdicts join the parts they test;
 * the hash of the engine's files is stored so the page can tell a proof older than its engine.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'lib', 'sandbox-9', 'proofRun.js');

if (!isMainThread) {
	const { runJob } = await import(LIB);
	parentPort.postMessage(runJob(workerData.job));
} else {
	const args = process.argv.slice(2);
	const quick = args.includes('--quick');
	const oi = args.indexOf('--out');
	const OUT = oi >= 0 ? args[oi + 1] : join(HERE, '..', 'static', 'sandbox-9', 'proof.json');
	const { proofJobs, assemble, engineHash, ENGINE_FILES } = await import(LIB);
	const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
	const hash = engineHash(Object.fromEntries(ENGINE_FILES.map((f) => [f, readFileSync(join(dirname(LIB), f), 'utf8')])));
	// a suite summary made with another engine is not this engine's verdict: it is kept in the file but not used
	const suite = prev.suite && prev.suite.engineHash === hash ? prev.suite : null;
	const jobs = proofJobs(quick);
	// the longest jobs first, so the last worker does not start a 30-year world alone
	jobs.sort((a, b) => b.years * (a.kind === 'exp' ? 2 : 1) - a.years * (b.kind === 'exp' ? 2 : 1));
	const par = Math.max(1, Math.min(jobs.length, (cpus().length || 2) - 1));
	const t0 = Date.now();
	const results = await new Promise((resolve, reject) => {
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
					process.stderr.write(`  ${job.kind === 'base' ? 'seed ' + job.seed : job.id}: ${m.kind === 'base' ? (m.pass ? 'pass' : 'FAIL') : m.verdict.pass ? 'pass' : 'FAIL'} in ${(m.ms / 1000).toFixed(1)} s\n`);
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
	const proof = assemble(results, { quick, where: 'node', wallMs: Date.now() - t0, engineHash: hash, suite });
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, JSON.stringify({ ...(prev.suite ? { suite: prev.suite } : {}), ...proof }, null, '\t') + '\n');
	if (!suite) console.log(prev.suite ? 'the saved suite summary is from another engine: run scripts/sandbox-9-proof.mjs, then this again' : 'no suite summary yet: run scripts/sandbox-9-proof.mjs, then this again');
	console.log(`${proof.pass ? 'PASS' : 'FAIL'}: ${proof.parts.map((p) => `${p.id} ${p.pass ? 'pass' : 'FAIL'}`).join(', ')}; ${proof.experiments.map((e) => `${e.id} ${e.pass == null ? 'comparison' : e.pass ? 'pass' : 'FAIL'}`).join(', ')}`);
	console.log(`wrote ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
