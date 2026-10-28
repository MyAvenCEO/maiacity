// The plan of one CI run (.github/workflows/ci.yml, stage 7 of the CI refactor): which of its jobs this change needs,
// each keyed on the files it really reads, and, at the end, whether every job it needed passed. One workflow, one plan
// job, one job per suite, one last job that needs them all ("CI required", the check main requires).
//
//   bun aven/ops/ci/plan.mjs                 the plan of this checkout's change (CI_BASE..CI_HEAD; CI_MODE)
//   bun aven/ops/ci/plan.mjs --verdict       "CI required": every job the plan named passed (NEEDS = toJSON(needs))
//
// CI_MODE: changed (a pull request, a merge group, a release's commit: what CI_BASE..CI_HEAD can break), full (every job,
// no verdict reused: the weekly run, a dispatch with full) or audit (the daily run: the dependency audits alone).
//
// A verdict: a job (or one entry of a matrix) that passed saves an empty cache entry named by its key, the hash of the
// files it reads (passes.mjs). The plan asks GitHub for those entries, on this ref and on main, and leaves out each job
// whose key already passed: a new push to a pull request runs only what its new files can change. A full run reads none.
import { appendFileSync } from 'node:fs';
import { changed, impact } from './impact.mjs';
import { hash } from './passes.mjs';
import { keyed, matrix, selected } from './test.mjs';
import { shards } from './rust-tests.mjs';

const SELF = '.github/workflows/ci.yml';
// What each keyed job reads beyond passes.mjs's `shared` (the toolchains, these scripts, the shared actions); a path
// with a leading ! is left out. The Rust tests read files beside avenDB's crates too: a test's fixtures under maia/
// (include_str!, CARGO_MANIFEST_DIR) and theOS's shutdown module, which avendb-device's tests compile (#[path]).
const RUST = ['Cargo.toml', 'Cargo.lock', '.config/nextest.toml', 'aven/db', '!aven/db/page', '!aven/db/docs',
 'theos/app/src/avendb_shutdown.rs', 'maia/content/assets/schemas', 'maia/content/code'];
export const reads = {
 rust: RUST,
 spec: ['aven/db/spec'],
 browser: [...RUST, 'aven/db/page', 'aven/db/scripts/avendb-browser-transports.mjs'],
 protocol: ['aven/db/spec/protocol', 'aven/db/crates'],
 // theOS and what its crates read from outside theos/ (include_str!)
 mac: ['Cargo.toml', 'Cargo.lock', 'theos', 'aven/db/crates', 'aven/db/vendor', 'aven/db/spec/AvenDB/ViewRules.lean',
  'aven/db/spec/AvenDB/ShowRules.lean', 'maia/content/models/models.json', 'maia/content/game/film/grade-tools.json',
  'maia/site/lib/media/media-refs.tsv'],
 lean: ['Cargo.toml', 'Cargo.lock', 'aven/db/crates/avendb-device', 'aven/kernel/code/packages.json', 'aven/db/spec/AvenDB/Objective.lean',
  'aven/db/spec/lean-toolchain'],
 'site-same': ['package.json', 'bun.lock', '.bun-version', 'vite.config.ts', 'svelte.config.js', 'maia', 'aven/kernel', 'aven/db/page',
  'aven/ops/release.mjs', 'aven/ops/paths.json'],
};

// the files that start a job beyond what impact.mjs's parts say
const hits = (files, re) => files === null || files.some(f => re.test(f));
const LEAN = /^(aven\/db\/crates\/avendb-device\/src\/lean\.rs|aven\/kernel\/code\/packages\.json|aven\/db\/spec\/AvenDB\/Objective\.lean|aven\/db\/spec\/lean-toolchain|\.github\/workflows\/ci\.yml)$/;
const SITE_SAME = /^(package\.json|bun\.lock|\.bun-version|vite\.config\.ts|svelte\.config\.js|maia\/site\/patches\/|aven\/ops\/release\.mjs|\.github\/workflows\/ci\.yml$)/;
const DELIVERY = /^(aven\/ops\/deploy\/(stop-avendb\.py|test_stop_avendb[^/]*\.py)|docker-compose[^/]*\.yml|\.github\/workflows\/(ci|release)\.yml)$/;
const PUBLISH = /^(aven\/ops\/deploy\/(publish-site\.py|test_publish_site\.py|Caddyfile)|\.github\/workflows\/(ci|release)\.yml)$/;
const AUDIT = /^((aven\/api\/|aven\/ops\/infra\/)?(bun\.lock|package\.json)|\.github\/workflows\/ci\.yml)$/;
const DENY = /^(Cargo\.lock|deny\.toml|(.*\/)?Cargo\.toml|\.github\/workflows\/ci\.yml)$/;

// the plan of a change: `files` changed (null: unknown, so everything), each job's flag, the matrices, the keys
export function plan(files, { mode = 'changed', key = paths => hash([...paths, SELF]) } = {}) {
 if (mode === 'full') files = null;
 const parts = impact(files);
 const audit = mode === 'audit';
 const on = (flag) => !audit && flag;
 const jobs = {
  // the page's avenDB device, which the site's checks and build load: fetched for its tree, or built
  wasm: !audit,
  // the kernel's gate (its tests and the security suite) and every way out tried in both browsers: every run
  gate: !audit,
  probes: !audit,
  rust: on(parts.native),
  spec: on(parts.avendb),
  browser: on(parts.browser),
  protocol: on(parts.protocol),
  mac: on(parts.mac),
  lean: on(hits(files, LEAN)),
  'site-same': on(hits(files, SITE_SAME)),
  delivery: on(hits(files, DELIVERY) || parts.api || parts.server),
  publish: on(hits(files, PUBLISH)),
  infra: on(parts.infra),
  audit: audit || hits(files, AUDIT),
  deny: audit || hits(files, DENY),
 };
 // the images a release would ship from this change: built here, pushed by digest from this repository's branches
 const images = audit ? [] : [...(parts.server ? ['avendb'] : []), ...(parts.api ? ['api'] : [])];
 const js = audit ? [] : keyed(matrix(selected(files, mode === 'full' ? 'all' : 'changed')));
 const rustKey = key(RUST);
 const rust = jobs.rust ? Object.entries(shards).map(([shard, s]) => ({ shard, name: s.name, key: `pass-rust-${shard}-${rustKey}` })) : [];
 const keys = Object.fromEntries(Object.entries(reads).filter(([j]) => j !== 'rust').map(([j, paths]) => [j, `pass-${j}-${key(paths)}`]));
 return { mode, files, parts, jobs, images, js, rust, keys };
}

// leaves out what already passed with the same files: `passed` is the set of keys GitHub holds a verdict for
export function unpassed(p, passed) {
 if (p.mode === 'full' || !passed.size) return p;
 const jobs = { ...p.jobs };
 for (const [j, k] of Object.entries(p.keys)) if (jobs[j] && passed.has(k)) jobs[j] = false;
 const rust = p.rust.filter(s => !passed.has(s.key));
 jobs.rust = jobs.rust && rust.length > 0;
 return { ...p, jobs, rust, js: p.js.filter(e => !passed.has(e.key)) };
}

// the plan's outputs, as GitHub's job outputs read them: run_<job>, key_<job>, and the matrices as JSON
export function outputs(p) {
 const out = {};
 for (const [j, v] of Object.entries(p.jobs)) out[`run_${j.replace(/-/g, '_')}`] = String(v);
 for (const [j, k] of Object.entries(p.keys)) out[`key_${j.replace(/-/g, '_')}`] = k;
 out.run_small = String(['delivery', 'publish', 'infra', 'audit', 'deny'].some(j => p.jobs[j]));
 out.run_js = String(p.js.length > 0);
 out.js = JSON.stringify(p.js);
 out.rust = JSON.stringify(p.rust);
 out.images = JSON.stringify(p.images);
 out.run_images = String(p.images.length > 0);
 return out;
}

// "CI required": every job the plan named ran and passed; a job the plan left out may only have been skipped
// (`needs` is the workflow's needs context; each job id maps to the plan's run_<id> output)
export function verdict(needs) {
 const problems = [];
 const plan = needs.plan;
 if (plan?.result !== 'success') return [`plan: ${plan?.result ?? 'missing'}`];
 const out = plan.outputs ?? {};
 const wanted = id => {
  if (id === 'rust-archive') return out.run_rust === 'true';
  if (id === 'site-same-check') return out.run_site_same === 'true';
  return out[`run_${id.replace(/-/g, '_')}`] === 'true';
 };
 for (const [id, job] of Object.entries(needs)) {
  if (id === 'plan') continue;
  if (job.result === 'success') continue;
  if (job.result === 'skipped' && !wanted(id)) continue;
  problems.push(`${id}: ${job.result}${job.result === 'skipped' ? ', though the plan needed it' : ''}`);
 }
 return problems;
}

// the keys GitHub holds a passed verdict for, on this ref or main's (actions/caches; a ref sees main's caches too)
async function verdicts(keys, { repo, token, refs }) {
 const passed = new Set();
 const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` };
 for (const k of keys) for (const ref of refs) {
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/caches?key=${encodeURIComponent(k)}&ref=${encodeURIComponent(ref)}&per_page=5`, { headers });
  if (!r.ok) throw new Error(`actions/caches answered ${r.status}`);
  if ((await r.json()).actions_caches?.some(c => c.key === k)) { passed.add(k); break; }
 }
 return passed;
}

if (import.meta.main) {
 if (process.argv.includes('--verdict')) {
  const problems = verdict(JSON.parse(process.env.NEEDS));
  for (const p of problems) console.log(`::error title=CI required::${p}`);
  console.log(problems.length ? `${problems.length} job(s) the plan needed did not pass` : 'every job the plan needed passed');
  process.exit(problems.length ? 1 : 0);
 }
 const mode = process.env.CI_MODE || 'changed';
 let p = plan(mode === 'changed' ? changed(process.env.CI_BASE, process.env.CI_HEAD || 'HEAD') : null, { mode });
 const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token, GITHUB_REF: ref } = process.env;
 if (mode === 'changed' && repo && token) {
  const keys = [...Object.entries(p.keys).filter(([j]) => p.jobs[j]).map(([, k]) => k), ...p.rust.map(s => s.key), ...p.js.map(e => e.key)];
  try {
   const passed = await verdicts(keys, { repo, token, refs: [...new Set([ref, 'refs/heads/main'].filter(Boolean))] });
   for (const k of passed) console.log(`passed before with these files: ${k}`);
   p = unpassed(p, passed);
  } catch (e) { console.log(`no verdicts read (${e.message}): every selected job runs`); }
 }
 const out = outputs(p);
 console.log(JSON.stringify({ mode, files: p.files?.length ?? 'all', parts: p.parts, ...out }, null, 1));
 if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}
