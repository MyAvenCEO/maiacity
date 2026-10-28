// Verdicts by key (C1): a job of ci.yml that passed saves an empty cache entry named by the hash of the files it reads;
// plan.mjs asks GitHub for those entries, on the run's ref and on main, and leaves out each job whose key passed, so a
// new push runs only what its new files can change. A full run (weekly, or by hand) reads none.
//
//   bun aven/ops/ci/passes.mjs tests=aven/db,!aven/db/page,.github/workflows/ci.yml browser=aven/db,aven/db/page
//
// prints each key, and writes <name>_key=pass-<name>-<hash> to $GITHUB_OUTPUT when it is set.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

// Files every check reads: the toolchains, the CI scripts and the shared actions.
export const shared = ['package.json', 'bun.lock', '.bun-version', 'aven/ops/ci', '.github/actions'];

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
