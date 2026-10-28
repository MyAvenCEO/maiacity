// The fast local check for one task branch: only what the branch touched, in seconds to a few minutes, so a task never
// needs CI of its own (CLAUDE.md: CI runs once per goal). The goal's one CI run still runs every gate.
//   bun aven/ops/devx/check.mjs              plan + run against origin/main (committed, staged, unstaged, untracked)
//   bun aven/ops/devx/check.mjs --plan       print the commands only
//   bun aven/ops/devx/check.mjs --wide       whole suites instead of the test files next to the change
//   bun aven/ops/devx/check.mjs --base <ref> compare with another ref (a collector: the goal's base)
//   bun aven/ops/devx/check.mjs --merge      a collector's check after a merge: JS tests + types, Rust `cargo check` only.
//                                           The task thread already ran its Rust tests and Lean; the goal CI runs them all.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { impact } from '../ci/impact.mjs';
import { inventory, matches, suites } from '../ci/test.mjs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const lines = s => s.split('\n').filter(Boolean);

export function touched(base = 'origin/main') {
 const since = git('merge-base', base, 'HEAD');
 return [...new Set([...lines(git('diff', '--name-only', since)), ...lines(git('ls-files', '--others', '--exclude-standard'))])]
  .filter(f => existsSync(f)).sort();
}

// The commands for these files, cheapest first; each says why it runs.
export function plan(files, { wide = false, merge = false } = {}) {
 const steps = [], hit = impact(files);
 // a workflow file GitHub rejects never runs and shows no red job (batch 5): lint them first, it takes a second
 if (files.some(f => f.startsWith('.github/workflows/'))) steps.push({ why: 'workflow files GitHub will accept', cmd: ['bun', 'aven/ops/ci/workflows.mjs'] });
 const js = files.filter(f => /\.(m?[jt]s|svelte)$/.test(f));
 // JS tests: each owned suite the change selects, narrowed to its test files in a touched folder (or the whole suite).
 const dirs = new Set(files.map(f => dirname(f) + '/'));
 const groups = inventory();
 for (const s of suites) {
  if (s.off || !files.some(f => s.impact.some(p => matches(f, p)) || s.paths.some(p => matches(f, p)))) continue;
  const near = groups[s.name].filter(t => files.includes(t) || dirs.has(dirname(t) + '/'));
  if (wide) steps.push({ why: `suite ${s.name}`, cmd: ['bun', 'aven/ops/ci/test.mjs', '--suite', s.name] });
  else if (near.length) steps.push({ why: `${s.name} tests next to the change`, cmd: ['bun', 'test', ...near.map(t => './' + t)] });
 }
 if (js.some(f => /^(maia\/(site|content)|aven\/(kernel|db\/page))\//.test(f)) || files.some(f => /^(svelte|vite|tsconfig)/.test(f)))
  steps.push({ why: 'types (svelte-check, ~80 s)', cmd: ['bun', '--bun', 'run', 'check'] });
 // Rust: type check per touched crate first, then only the test programs the change names (aven/db/CLAUDE.md).
 const crates = new Map();
 for (const f of files) {
  const m = /^aven\/db\/crates\/([^/]+)\/(.*)$/.exec(f);
  if (!m || !m[2].endsWith('.rs')) continue;
  const c = crates.get(m[1]) ?? crates.set(m[1], { tests: new Set(), src: false }).get(m[1]);
  const t = /^tests\/([^/]+)\.rs$/.exec(m[2]);
  t ? c.tests.add(t[1]) : (c.src = c.src || m[2].startsWith('src/'));
 }
 const feat = c => c === 'avendb-testkit' ? [] : ['--features', 'test-fixtures'];
 for (const [c, { tests, src }] of crates) {
  steps.push({ why: `rust ${c}: types`, cmd: ['cargo', 'check', '--locked', '-p', c, ...feat(c), '--tests'], cwd: 'aven/db' });
  if (merge) continue;
  if (src) steps.push({ why: `rust ${c}: unit tests`, cmd: ['cargo', 'test', '--locked', '-p', c, ...feat(c), '--lib'], cwd: 'aven/db' });
  for (const t of tests) steps.push({ why: `rust ${c}: tests/${t}.rs`, cmd: ['cargo', 'test', '--locked', '-p', c, ...feat(c), '--test', t], cwd: 'aven/db' });
 }
 if (!merge && files.some(f => /^aven\/db\/spec\/.*\.lean$/.test(f)))
  steps.push({ why: 'Lean proofs', cmd: ['lake', 'build'], cwd: 'aven/db/spec', needs: 'lake' });
 return { steps, hit };
}

if (import.meta.main) {
 const args = process.argv.slice(2);
 const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
 const files = touched(base);
 const { steps, hit } = plan(files, { wide: args.includes('--wide'), merge: args.includes('--merge') });
 console.log(`${files.length} files changed against ${base}; the goal CI will run: ${Object.keys(hit).filter(k => hit[k]).join(', ') || 'nothing'}`);
 for (const s of steps) console.log(`  ${s.why}: ${s.cwd ? `(cd ${s.cwd}) ` : ''}${s.cmd.join(' ')}`);
 if (!steps.length) console.log('  nothing to run locally for these files');
 if (args.includes('--plan')) process.exit(0);
 const has = bin => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
 const results = [];
 // One at a time on purpose: a cloud box has 4 cores, and cargo queues on its build folder anyway.
 for (const s of steps) {
  if (s.needs && !has(s.needs)) { results.push(`skipped  ${s.why} (no ${s.needs} here; the goal CI runs it)`); continue; }
  const t = performance.now();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { stdio: 'inherit', cwd: s.cwd, env: process.env });
  results.push(`${r.status === 0 ? 'ok     ' : 'FAILED '} ${((performance.now() - t) / 1000).toFixed(1).padStart(6)} s  ${s.why}`);
 }
 console.log('\n' + results.join('\n'));
 process.exitCode = results.some(r => r.startsWith('FAILED')) ? 1 : 0;
}
