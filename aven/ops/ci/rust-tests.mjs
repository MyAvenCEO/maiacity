// avenDB's Rust tests in CI, built once (W4): one job builds every test program into one nextest archive, and each
// shard runs its share of the tests from that archive and builds nothing. Each crate's tests are one program
// (`tests/all/`, and `tests/memory/` for the tests that need the process to themselves), so the archive holds 16
// programs (7 of them test programs, the rest the crates' own unit tests and binaries) where each shard's runner built
// and linked its own share of 120. The goal's tests job calls it (the new pipeline's ci.yml); with cargo-nextest
// installed it runs the same way here.
//   bun aven/ops/ci/rust-tests.mjs shards                the shards, as JSON for the job's matrix
//   bun aven/ops/ci/rust-tests.mjs archive <file>        build every test program into the archive <file>
//   bun aven/ops/ci/rust-tests.mjs doc                   the doc tests, where the archive was built: nextest runs none
//   bun aven/ops/ci/rust-tests.mjs run <shard> <file>    run one shard's tests from the archive
//   --plan                                               print the commands only
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// the one Cargo workspace's root (D3), where nextest finds .config/nextest.toml
const ROOT = resolve(import.meta.dir, '../../..');
// the crates whose tests the archive holds, each with its fixtures (the test kit has no tests of its own)
export const crates = ['avendb', 'avendb-net', 'avendb-server', 'avendb-device', 'avendb-browser'];
const build = [...crates.flatMap(c => ['-p', c]), '--features', crates.map(c => `${c}/test-fixtures`).join(',')];

// Each shard on a runner of its own, its tests a nextest filter, sized to about three minutes of tests each (run of
// 2026-10-28): the core's (4.3 min), net's (3.4), the server's (2.6) and the device's with the browser's (2.0). The
// server's heavy tests (first_view_gate) stay apart from the browser's: on one runner a browser test's 60 s wait for
// the server's feed ran out (#1375).
// The core's property tests run under libtest in one process: .config/nextest.toml says why, and its default filter
// leaves them out of every other shard.
export const shards = {
 core: { name: 'core', filter: 'package(avendb)' },
 'core-properties': { name: 'core properties', binary: 'avendb::all', args: ['--test-threads=2', 'properties::'] },
 net: { name: 'net', filter: 'package(avendb-net)' },
 server: { name: 'server', filter: 'package(avendb-server)' },
 'device-browser': { name: 'device, browser', filter: 'package(avendb-device) | package(avendb-browser)' },
};

// what a step runs, at the workspace's root: each command as [program, ...arguments]
export function commands(step, { shard, file, extracted } = {}) {
 if (step === 'archive') return [['cargo', 'nextest', 'archive', '--locked', ...build, '--archive-file', file]];
 if (step === 'doc') return [['cargo', 'test', '--locked', '--doc', ...build]];
 const s = shards[shard];
 if (step !== 'run' || !s) throw new Error(`${step} ${shard ?? ''}: a step is archive, doc or run <${Object.keys(shards).join('|')}>`);
 const archive = ['--archive-file', file, '--workspace-remap', '.'];
 // the libtest shard's program, from the archive unpacked where it is run: the full list, whose suites name the folder
 // each program runs in (a binaries-only list names none, and keeps its programs under rust-binaries)
 if (s.binary) return [['cargo', 'nextest', 'list', ...archive, '--extract-to', extracted, '--extract-overwrite',
  '--message-format', 'json']];
 return [['cargo', 'nextest', 'run', '--profile', 'ci', ...archive, '--no-fail-fast', '--no-tests=fail', '-E', s.filter]];
}

// the program `id` in a nextest list's JSON: where it is, and the folder cargo runs its tests in (its crate's)
export function program(list, id) {
 const suite = JSON.parse(list)['rust-suites']?.[id];
 if (!suite) throw new Error(`the archive holds no ${id}`);
 return { path: suite['binary-path'], cwd: suite.cwd };
}

if (import.meta.main) {
 const plan = process.argv.includes('--plan');
 const [step, ...rest] = process.argv.slice(2).filter(a => a !== '--plan');
 if (step === 'shards') {
  console.log(JSON.stringify(Object.entries(shards).map(([shard, s]) => ({ shard, name: s.name }))));
  process.exit(0);
 }
 const [shard, file] = step === 'run' ? rest : [undefined, rest[0]];
 const s = shards[shard];
 // the tests' shared McEliece pairs where aven/db/.cargo/config.toml puts them for cargo, so that a program run here without
 // cargo finds them too; a folder CI names wins
 const env = { ...process.env, AVENDB_TEST_PAIRS: process.env.AVENDB_TEST_PAIRS ?? join(ROOT, 'target/avendb-test-pairs') };
 const extracted = s?.binary && !plan ? mkdtempSync(join(tmpdir(), 'avendb-archive-')) : '<a new folder>';
 let out = '';
 for (const cmd of commands(step, { shard, file: file && resolve(file), extracted })) {
  console.log(`$ ${cmd.join(' ')}`);
  if (plan) continue;
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 28,
   stdio: s?.binary ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  out = r.stdout;
 }
 if (s?.binary) {
  const p = plan ? { path: `<${s.binary} from the archive>`, cwd: '<its crate\'s folder>' } : program(out, s.binary);
  console.log(`$ ${p.path} ${s.args.join(' ')}   (in ${p.cwd})`);
  if (!plan) process.exitCode = spawnSync(p.path, s.args, { cwd: p.cwd, env: { ...env, CARGO_MANIFEST_DIR: p.cwd }, stdio: 'inherit' }).status ?? 1;
 }
}
