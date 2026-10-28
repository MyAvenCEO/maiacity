// The page's avenDB device (aven/db/page/device/: avendb-browser as WebAssembly, its JS glue and modules) is a build
// output, not in git (B1). It is built from avenDB's sources once per source tree: the key is a hash of every file the
// build reads (`inputs`), as git holds them. CI builds it for each tree it checks and puts it on the release
// "avendb-page-device" as page-device-<key>.tgz; anyone else fills the folder with `ensure`, from this machine's cache,
// then that release, then a build of their own where Rust is installed (aven/db/scripts/build-web.sh, 4-5 min).
//   bun aven/ops/devx/wasm.mjs key                the key of this checkout's sources, committed or not
//   bun aven/ops/devx/wasm.mjs ensure [--fetch]   fill aven/db/page/device for this checkout; --fetch never builds
//   bun aven/ops/devx/wasm.mjs build              build it here (needs Rust and wasm-bindgen) and keep it in the cache
//   bun aven/ops/devx/wasm.mjs pack <file.tgz>    the folder as the release's asset (CI, after build)
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');
export const DEVICE = join(ROOT, 'aven/db/page/device');
export const RELEASE = process.env.AVENDB_PAGE_DEVICE_URL ?? 'https://github.com/MyAvenCEO/maiacity/releases/download/avendb-page-device';
const STAMP = '.build.json';
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'avendb-page-device');

// What the build reads: the three crates it compiles (their tests aside), the patched iroh, the workspace's manifest
// and lockfile, the WebAssembly's flags, the build script, and the two Lean numbers avendb's build.rs takes in.
export const inputs = [
 'Cargo.toml', 'Cargo.lock', 'aven/db/.cargo/config.toml', 'aven/db/scripts/build-web.sh',
 'aven/db/crates/avendb/', 'aven/db/crates/avendb-net/', 'aven/db/crates/avendb-browser/', 'aven/db/vendor/iroh/',
 'aven/db/spec/AvenDB/ViewRules.lean', 'aven/db/spec/AvenDB/ShowRules.lean',
];
export const read = path => inputs.some(i => i.endsWith('/') ? path.startsWith(i) : path === i) && !/^aven\/db\/crates\/[^/]+\/tests\//.test(path);

// the key of a tree, from `git ls-tree -r <tree>` lines ("<mode> blob <hash>\t<path>"): each input's path and content
export function keyOf(lines) {
 const h = createHash('sha256');
 for (const line of lines.split('\n').filter(Boolean).sort()) {
  const [meta, path] = line.split('\t');
  if (read(path)) h.update(`${meta}\t${path}\n`);
 }
 return h.digest('hex').slice(0, 32);
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
// this checkout's key, of the files as they are now: git's index, and each file changed since or new as it is on disk.
// So a build of changes not yet committed has the key their commit will have, and CI's build of it is the same.
export function key() {
 const at = new Map();
 for (const l of git('ls-files', '-s', '--', ...inputs).split('\n').filter(Boolean)) {
  const [meta, path] = l.split('\t');
  const [mode, hash] = meta.split(' ');
  at.set(path, `${mode} blob ${hash}`);
 }
 for (const l of git('status', '--porcelain', '--untracked-files=all', '--no-renames', '--', ...inputs).split('\n').filter(Boolean)) {
  const path = l.slice(3);
  if (!existsSync(join(ROOT, path))) { at.delete(path); continue; }
  const mode = statSync(join(ROOT, path)).mode & 0o111 ? '100755' : '100644';
  at.set(path, `${mode} blob ${git('hash-object', '--', path).trim()}`);
 }
 return keyOf([...at].map(([path, meta]) => `${meta}\t${path}`).join('\n'));
}

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const files = dir => readdirSync(dir, { recursive: true }).map(String).filter(f => f !== STAMP && statSync(join(dir, f)).isFile()).sort();
// the folder's stamp, when every file it names is there as it was built
export function stamped(dir) {
 if (!existsSync(join(dir, STAMP))) return null;
 const stamp = JSON.parse(readFileSync(join(dir, STAMP), 'utf8'));
 const now = files(dir);
 const whole = now.length === Object.keys(stamp.files).length && now.every(f => stamp.files[f] === sha256(join(dir, f)));
 return whole ? stamp : null;
}
function stamp(dir, k) {
 const tool = (cmd, ...a) => spawnSync(cmd, a, { encoding: 'utf8' }).stdout?.trim() ?? '';
 const s = { key: k, rustc: tool('rustc', '--version'), wasmBindgen: tool('wasm-bindgen', '--version'),
  files: Object.fromEntries(files(dir).map(f => [f, sha256(join(dir, f))])) };
 writeFileSync(join(dir, STAMP), JSON.stringify(s, null, 1) + '\n');
}
// a whole folder put in place of the device's in one rename, so a reader never sees half of one
function place(from) {
 const next = `${DEVICE}.next`;
 rmSync(next, { recursive: true, force: true });
 cpSync(from, next, { recursive: true });
 rmSync(DEVICE, { recursive: true, force: true });
 renameSync(next, DEVICE);
}

export function build() {
 const k = key();
 const r = spawnSync(join(ROOT, 'aven/db/scripts/build-web.sh'), { stdio: 'inherit' });
 if (r.status !== 0) throw new Error('aven/db/scripts/build-web.sh failed');
 stamp(DEVICE, k);
 rmSync(join(CACHE, k), { recursive: true, force: true });
 mkdirSync(CACHE, { recursive: true });
 cpSync(DEVICE, join(CACHE, k), { recursive: true });
 return k;
}

function fetchRelease(k) {
 const work = mkdtempSync(join(tmpdir(), 'avendb-page-device-'));
 try {
  const tgz = join(work, 'device.tgz');
  const got = spawnSync('curl', ['-fsSL', '--max-time', '300', '-o', tgz, `${RELEASE}/page-device-${k}.tgz`]);
  if (got.status !== 0) return false;
  mkdirSync(join(work, 'device'));
  if (spawnSync('tar', ['-xzf', tgz, '-C', join(work, 'device')]).status !== 0) return false;
  const s = stamped(join(work, 'device'));
  if (s?.key !== k) throw new Error(`page-device-${k}.tgz is not the build it names: not used`);
  mkdirSync(CACHE, { recursive: true });
  rmSync(join(CACHE, k), { recursive: true, force: true });
  cpSync(join(work, 'device'), join(CACHE, k), { recursive: true });
  return true;
 } finally { rmSync(work, { recursive: true, force: true }); }
}

// fills the device's folder for this checkout; says where it came from
export function ensure({ fetchOnly = false } = {}) {
 const k = key();
 if (stamped(DEVICE)?.key === k) return 'in place';
 if (stamped(join(CACHE, k))?.key === k) { place(join(CACHE, k)); return 'from this machine\'s cache'; }
 if (fetchRelease(k)) { place(join(CACHE, k)); return `from the release (page-device-${k}.tgz)`; }
 const why = `no build of ${k} yet: CI builds each tree it checks, so uncommitted Rust changes are built here`;
 const rust = ['cargo', 'wasm-bindgen'].every(b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0);
 if (fetchOnly || !rust) throw new Error(`${why}. Build it here: bun aven/ops/devx/wasm.mjs build (Rust, the wasm32 target, wasm-bindgen 0.2.129)`);
 build();
 return `built here (${why})`;
}

if (import.meta.main) {
 const [step, arg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
 try {
  if (step === 'key') console.log(key());
  else if (step === 'ensure') console.log(`aven/db/page/device: ${ensure({ fetchOnly: process.argv.includes('--fetch') })}`);
  else if (step === 'build') console.log(`built ${build()}`);
  else if (step === 'pack' && arg) {
   const s = stamped(DEVICE);
   if (!s || s.key !== key()) throw new Error('pack takes a whole build of this checkout\'s sources: run build first');
   if (spawnSync('tar', ['-czf', resolve(arg), '-C', DEVICE, '.'], { stdio: 'inherit' }).status !== 0) throw new Error('tar failed');
   console.log(`${relative(process.cwd(), resolve(arg))}: upload as page-device-${s.key}.tgz to the release avendb-page-device`);
  } else throw new Error('a step is key, ensure [--fetch], build or pack <file.tgz>');
 } catch (e) {
  console.error(`wasm: ${e.message}`);
  process.exit(1);
 }
}
