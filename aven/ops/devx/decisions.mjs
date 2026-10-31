// avenDB's decision log is append-only (aven/DB2/CLAUDE.md, Samuel 31 Oct 2026): DECISIONS.md keeps the history trace
// immutable, and ARCHITECTURE.md is the mutable, latest truth. This check fails when a branch edits or deletes anything
// the log already held: the log at the branch's merge base must be an exact prefix of the log now. A change of mind is
// a new entry that names the one it supersedes, never an edit.
//   bun aven/ops/devx/decisions.mjs              against origin/main
//   bun aven/ops/devx/decisions.mjs --base <ref> against another ref
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const LOG = 'aven/DB2/DECISIONS.md';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The first line where `now` stops extending `before`, or null when `before` is a prefix of `now`. */
export function firstEdit(before, now) {
 if (now.startsWith(before)) return null;
 const a = before.split('\n'), b = now.split('\n');
 const i = a.findIndex((line, k) => b[k] !== line);
 return { line: i + 1, was: a[i], now: b[i] ?? '(deleted)' };
}

if (import.meta.main) {
 const args = process.argv.slice(2);
 const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
 const since = git('merge-base', base, 'HEAD').trim();
 let before = '';
 try { before = git('show', `${since}:${LOG}`); } catch { /* the log is new on this branch */ }
 const now = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '';
 const edit = firstEdit(before, now);
 if (edit) {
  console.error(`${LOG} is append-only, but line ${edit.line} changed since ${since.slice(0, 12)}:`);
  console.error(`  was: ${edit.was}\n  now: ${edit.now}`);
  console.error('Add a new entry that supersedes the old one instead (aven/DB2/CLAUDE.md).');
  process.exit(1);
 }
 console.log(`${LOG}: append-only holds (${now.length - before.length} bytes added since ${since.slice(0, 12)})`);
}
