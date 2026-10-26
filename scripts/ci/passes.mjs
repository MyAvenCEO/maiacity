// Pass markers (pull requests only): a job that passed on this PR saves an empty cache entry named by the hash of the
// files it reads; a later run of the same PR whose files hash the same skips that job. CI's own WebAssembly commit
// changes only src/lib/avendb/device, so the Rust tests, the spec and theOS's build pass on it without running again.
// main never reads a marker: "Validate and release" runs every suite on the merged commit itself.
//
//   bun scripts/ci/passes.mjs tests=avendb,.github/workflows/avendb-checks.yml browser=avendb,src/lib/avendb,!src/lib/avendb/device
//
// writes <name>_key=pass-<name>-<hash> to $GITHUB_OUTPUT; the workflow looks the key up (actions/cache/restore,
// lookup-only: through the runner's own cache token, so no job needs more permissions) and saves it once the job passed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

// Files every check reads: the toolchains, the CI scripts and the shared actions.
export const shared = ['package.json', 'bun.lock', '.bun-version', 'scripts/ci', '.github/actions'];

// The hash of the committed files under the paths (a leading ! leaves a path out): blob ids, so it reads no file.
export function hash(paths, head = 'HEAD') {
 const keep = paths.filter(p => !p.startsWith('!')), drop = paths.filter(p => p.startsWith('!')).map(p => p.slice(1).replace(/\/?$/, '/'));
 const tree = execFileSync('git', ['ls-tree', '-r', '--full-tree', head, '--', ...keep, ...shared], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter(line => line && !drop.some(d => line.split('\t')[1].startsWith(d)));
 return createHash('sha256').update([...new Set(tree)].sort().join('\n')).digest('hex').slice(0, 40);
}

if (import.meta.main) {
 const lines = [];
 for (const arg of process.argv.slice(2)) {
  const [name, list] = arg.split('=');
  const key = `pass-${name}-${hash(list.split(','))}`;
  console.log(`${name}: ${key}`);
  lines.push(`${name}_key=${key}`);
 }
 if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}
