// avenDB's Rust tests in CI, a shard a runner: each shard builds its own crates' test programs and runs them, side by
// side with the others. Each crate's tests are one program (`tests/all/`, and `tests/memory/` for the tests that need
// the process to themselves, W4), so a shard links a few programs, not the 120 they once were. One archive built once
// for every shard (W4's first form) made the shards wait on one runner's 11-15 minute build (#1374: 15 + 4.5 min); a
// shard's own build, warm, takes a few minutes and runs beside the others'. ci.yml's rust job calls it; with
// cargo-nextest installed it runs the same way here.
//   bun aven/ops/ci/rust-tests.mjs shards             the shards, as JSON for the job's matrix
//   bun aven/ops/ci/rust-tests.mjs run <shard>        build one shard's tests and run them, then its crates' doc tests
//   --plan                                            print the commands only
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// the one Cargo workspace's root (D3), where nextest finds .config/nextest.toml
const ROOT = resolve(import.meta.dir, '../../..');
// the crates with tests (the test kit has none of its own); a shard builds its crates with their fixtures
export const crates = ['avendb', 'avendb-net', 'avendb-server', 'avendb-device', 'avendb-browser'];
const build = cs => [...cs.flatMap(c => ['-p', c]), '--features', cs.map(c => `${c}/test-fixtures`).join(',')];

// Each shard on a runner of its own, its tests its crates', sized to about three minutes of tests each (run of
// 2026-10-28): the core's (4.3 min), net's (3.4), the server's (2.6) and the device's with the browser's (2.0). The
// server's heavy tests (first_view_gate) stay apart from the browser's: on one runner a browser test's 60 s wait for
// the server's feed ran out (#1375).
// The core's property tests run under libtest in one process: .config/nextest.toml says why, and its default filter
// leaves them out of every other shard.
export const shards = {
 core: { name: 'core', crates: ['avendb'] },
 'core-properties': { name: 'core properties', crates: ['avendb'], libtest: ['--test', 'all', '--', '--test-threads=2', 'properties::'] },
 net: { name: 'net', crates: ['avendb-net'] },
 server: { name: 'server', crates: ['avendb-server'] },
 'device-browser': { name: 'device, browser', crates: ['avendb-device', 'avendb-browser'] },
};

// what a shard runs, at the workspace's root: each command as [program, ...arguments]. The property shard runs under
// libtest alone; every other shard runs its crates' tests under nextest, then their doc tests (nextest runs none)
export function commands(shard) {
 const s = shards[shard];
 if (!s) throw new Error(`${shard ?? ''}: a shard is one of ${Object.keys(shards).join(', ')}`);
 if (s.libtest) return [['cargo', 'test', '--locked', ...build(s.crates), ...s.libtest]];
 return [['cargo', 'nextest', 'run', '--locked', '--profile', 'ci', ...build(s.crates), '--no-fail-fast', '--no-tests=fail'],
  ['cargo', 'test', '--locked', '--doc', ...build(s.crates)]];
}

if (import.meta.main) {
 const plan = process.argv.includes('--plan');
 const [step, shard] = process.argv.slice(2).filter(a => a !== '--plan');
 if (step === 'shards') {
  console.log(JSON.stringify(Object.entries(shards).map(([shard, s]) => ({ shard, name: s.name }))));
  process.exit(0);
 }
 if (step !== 'run') throw new Error(`${step ?? ''}: a step is shards or run <shard>`);
 // the tests' shared McEliece pairs where aven/db/.cargo/config.toml puts them for cargo run there; a folder CI names wins
 const env = { ...process.env, AVENDB_TEST_PAIRS: process.env.AVENDB_TEST_PAIRS ?? join(ROOT, 'target/avendb-test-pairs') };
 for (const cmd of commands(shard)) {
  console.log(`$ ${cmd.join(' ')}`);
  if (plan) continue;
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
 }
}
