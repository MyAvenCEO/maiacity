// One shard of avenDB's performance gates (the `bench` job of avendb-checks.yml), built and run the same way for this
// branch and for main (Samuel 2026-10-28, Goal 6 D3): a shared runner's speed swings from run to run (phone_bulk's
// catch-up used 0.42 and then 0.25 of its link on the same code), so a speed gate also holds the branch against main's
// build timed on the same runner, in the same job, the two taking turns.
//
//   bun scripts/ci/avendb-bench-shard.mjs build <shard> <avendb dir> <bin dir>   build the shard's bench programs (cargo
//                                                                               test --no-run) and copy them to <bin dir>
//   bun scripts/ci/avendb-bench-shard.mjs run <shard> <avendb dir> <bin dir> <log>  run them once, appending to <log>
//
// The programs run from <avendb dir>'s crate folders, as cargo test runs them; a bin dir can come from another
// checkout's build (main's, from the cache), as the benches read no file of their own tree.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync } from 'node:fs';

// Each shard: how its programs are built, and each run: the program, its test, and its environment.
export const shards = {
 core: {
  build: ['--release'], features: [],
  runs: [
   ...[10000, 100000, 1000000].map(n => ({ pkg: 'avendb', test: 'bench_gates', exact: 'bench_scale', env: { AVENDB_BENCH_N: String(n) } })),
   { pkg: 'avendb', test: 'bench_gates', exact: 'bench_first_sync', env: { AVENDB_BENCH_FIRST: '10000:2000,50000:3000' } },
   // a first sync's pages with moves cost the same however much is held (no whole replays): ~2 min at 30,000
   { pkg: 'avendb', test: 'first_sync_moves', exact: 'a_page_with_moves_costs_the_same_however_much_is_held', env: { AVENDB_MOVES_HELD: '30000' } },
  ],
 },
 carriers: {
  build: [], features: ['--features', 'test-fixtures'],
  runs: [{ pkg: 'avendb-server', test: 'relay_bench', exact: 'bench_carrier', env: { AVENDB_CARRIER: 'direct,relay,relay_link' } }],
 },
 // optimised (--profile live) and without the debug checks that replay a whole log on each write (lab.rs): the gates
 // time what a release does. RUSTFLAGS comes from the job, before rust-cache. calm and phone: a live edit's delay
 // during a catch-up of 600 edits (G4); phone_bulk and its control calm_bulk: the catch-up's use of the link (G3);
 // writes: a person's write behind a catch-up slice and 32 queued reads (G5)
 live: {
  build: ['--profile', 'live'], features: ['--features', 'test-fixtures'],
  runs: [
   { pkg: 'avendb-net', test: 'sync_bench', exact: 'bench_live', env: { AVENDB_LIVE_LINK: 'calm,phone,phone_bulk,calm_bulk' } },
   { pkg: 'avendb-net', test: 'lib', exact: 'lab_schedule::bench::bench_writes_first', env: {} },
  ],
 },
};

const shardOf = name => shards[name] ?? (() => { throw new Error(`${name}: none of ${Object.keys(shards).join(', ')}`); })();
const binName = r => `${r.pkg}--${r.test}`;

// The shard's programs, built in one cargo call (side by side, not one after the other), copied to `bin`.
export function build(name, dir, bin) {
 const s = shardOf(name);
 const pkgs = [...new Set(s.runs.map(r => r.pkg))];
 if (pkgs.length !== 1) throw new Error(`${name}: one package a shard (--test names apply to every -p)`);
 const tests = [...new Set(s.runs.map(r => r.test))];
 const args = ['test', '--locked', ...s.build, ...s.features, '--no-run', '--message-format=json-render-diagnostics',
  '-p', pkgs[0], ...tests.flatMap(t => t === 'lib' ? ['--lib'] : ['--test', t])];
 const out = execFileSync('cargo', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
 mkdirSync(bin, { recursive: true });
 const built = out.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l))
  .filter(m => m.reason === 'compiler-artifact' && m.executable && m.profile?.test);
 for (const test of tests) {
  const [kind, target] = test === 'lib' ? ['lib', pkgs[0].replace(/-/g, '_')] : ['test', test];
  const m = built.find(m => m.target.name === target && m.target.kind.includes(kind) && m.target.src_path.includes(`/crates/${pkgs[0]}/`));
  if (!m) throw new Error(`no program built for ${pkgs[0]} ${test}`);
  const to = `${bin}/${binName({ pkg: pkgs[0], test })}`;
  copyFileSync(m.executable, to);
  // without its debug info a program is a fraction of the size, which the cache of main's programs keeps small
  spawnSync('strip', ['--strip-debug', to]);
 }
}

// Each run once, from its crate's folder, its output appended to `log` (the BENCH lines avendb-bench.mjs reads).
export function run(name, dir, bin, log) {
 for (const r of shardOf(name).runs) {
  const p = spawnSync(`${bin}/${binName(r)}`, ['--ignored', '--nocapture', '--exact', r.exact], {
   cwd: `${dir}/crates/${r.pkg}`, env: { ...process.env, ...r.env }, encoding: 'utf8', maxBuffer: 1 << 28,
   stdio: ['ignore', 'pipe', 'inherit'],
  });
  process.stdout.write(p.stdout);
  appendFileSync(log, p.stdout);
  if (p.status !== 0) throw new Error(`${r.pkg} ${r.test} ${r.exact} failed (${p.status ?? p.signal})`);
 }
}

if (import.meta.main) {
 const [mode, name, dir, bin, log] = process.argv.slice(2);
 if (mode === 'build') build(name, dir, bin);
 else if (mode === 'run') run(name, dir, bin, log);
 else { console.error('build|run <shard> <avendb dir> <bin dir> [log]'); process.exit(2); }
}
