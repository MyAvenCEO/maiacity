// avenDB's decision log is append-only (aven/DB2/CLAUDE.md, Samuel 31 Oct 2026): avenBRAIN's DECISIONS.md keeps the
// history trace immutable, and its ARCHITECTURE.md and package pages are the mutable, latest truth. The log is one
// table, the newest decision first. This check fails when a branch changes anything the log already held: the text above
// the table's rows is unchanged, every row it held is still there, unchanged and in order, at the bottom, and whatever is
// new is table rows between the two. A change of mind is a new row that names the one it supersedes, never an edit.
//   bun aven/ops/devx/decisions.mjs              against origin/main
//   bun aven/ops/devx/decisions.mjs --base <ref> against another ref
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const LOG = 'aven/DB2/brain/DECISIONS.md';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The first line where `now` stops keeping `before`, or null when it keeps it: the head (everything through the
 * table's `|---|` line) unchanged, `before`'s rows the last rows of `now`, and only table rows added between them. */
export function firstEdit(before, now) {
 if (!before) return null;
 const a = before.split('\n'), b = now.split('\n');
 const sep = a.findIndex(line => /^\|\s*:?-/.test(line));
 const head = sep < 0 ? a.length : sep + 1;
 for (let i = 0; i < head; i++) if (b[i] !== a[i]) return { line: i + 1, was: a[i], now: b[i] ?? '(deleted)' };
 const added = b.length - a.length;
 if (added < 0) return { line: head + 1, was: a[head], now: '(deleted)' };
 for (let i = head; i < head + added; i++) if (!b[i].startsWith('| ')) return { line: i + 1, was: '(a new row)', now: b[i] };
 for (let i = head; i < a.length; i++) if (b[i + added] !== a[i]) return { line: i + added + 1, was: a[i], now: b[i + added] };
 return null;
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
