// The collector's one step: merge many finished task branches into the current branch at once (CLAUDE.md: CI runs once
// per batch). Every merge is made in git's object store first (merge-tree), so a conflict never leaves a half-merged
// working tree: conflicting branches are left out and named, with their files, and the rest land as ordinary --no-ff
// merge commits, in the order given, with one fast-forward at the end.
//   bun scripts/devx/collect.mjs <branch>...      fetch, merge, report (origin/ is added when missing)
//   bun scripts/devx/collect.mjs --drafts         every open draft PR into main (but this branch's own)
//   bun scripts/devx/collect.mjs --plan ...       report only; nothing changes
//   bun scripts/devx/collect.mjs --check ...      then scripts/devx/check.mjs --merge for what merged (types + JS tests, ~1-2 min)
//   bun scripts/devx/collect.mjs --late ...       merge even though this branch's PR is ready (refused otherwise: it restarts CI)
//   bun scripts/devx/collect.mjs --tasks          the "Task: <branch>" lines of everything collected so far, for the
//                                                 final PR's body and merge commit message (scripts/devx/measure.mjs counts them)
import { execFileSync, spawnSync } from 'node:child_process';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...a) => { const r = spawnSync('git', a, { encoding: 'utf8' }); return { ok: r.status === 0, out: (r.stdout || '').trim(), code: r.status }; };

async function drafts(repo = 'MyAvenCEO/maiacity') {
 const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) };
 const out = [];
 for (let page = 1; ; page++) {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&base=main&per_page=100&page=${page}`, { headers });
  if (!res.ok) throw new Error(`GitHub said ${res.status} listing pull requests`);
  const list = await res.json();
  out.push(...list.filter(p => p.draft && p.head.repo?.full_name === repo).map(p => ({ branch: p.head.ref, pr: p.number, title: p.title })));
  if (list.length < 100) return out;
 }
}

// This branch's own open PR into main, if any
async function ownPr(branch, repo = 'MyAvenCEO/maiacity') {
 const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) };
 const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&base=main&head=${repo.split('/')[0]}:${branch}`, { headers }).catch(() => null);
 return res?.ok ? (await res.json())[0] : undefined;
}

// Files CI builds and commits itself (avendb-wasm.yml): two branches that both rebuilt them always conflict, and either
// copy is stale for the merged sources anyway. The batch keeps its own and the final PR's CI commits the right one.
export const generated = /^src\/lib\/avendb\/device\/avendb_browser(_bg\.wasm|\.js)$/;

// One merge in memory: the merged tree and a merge commit on top of `head`, or the conflicting files.
export function mergeInMemory(head, theirs, message) {
 const r = tryGit('merge-tree', '--write-tree', '--name-only', '--no-messages', head, theirs);
 let [tree, ...files] = r.out.split('\n');
 files = files.filter(Boolean);
 if (r.code !== 0 && r.code !== 1) throw new Error(`git merge-tree failed for ${theirs}`);
 const kept = r.code === 1 ? files : [];
 if (kept.length && kept.every(f => generated.test(f))) tree = withFiles(tree, head, kept);
 else if (kept.length) return { conflict: kept };
 return { commit: git('commit-tree', tree, '-p', head, '-p', theirs, '-m', message), kept };
}

// `tree` with these paths as they are in `from`, written through a throwaway index.
function withFiles(tree, from, paths) {
 const env = { ...process.env, GIT_INDEX_FILE: git('rev-parse', '--git-path', 'devx-collect.index') };
 const run = (...a) => execFileSync('git', a, { encoding: 'utf8', env }).trim();
 run('read-tree', tree);
 for (const p of paths) {
  const [mode, , oid] = git('ls-tree', from, '--', p).split(/\s+/);
  oid ? run('update-index', '--cacheinfo', `${mode},${oid},${p}`) : run('update-index', '--force-remove', p);
 }
 return run('write-tree');
}

if (import.meta.main) {
 const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--')));
 const here = git('rev-parse', '--abbrev-ref', 'HEAD');
 if (flags.has('--tasks')) {
  const re = new RegExp(`^Merge (\\S+) into ${here.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const names = git('log', '--merges', '--reverse', '--format=%s', 'origin/main..HEAD').split('\n').map(s => re.exec(s)?.[1]).filter(Boolean);
  for (const b of new Set(names)) console.log(`Task: ${b}  ${tryGit('log', '-1', '--format=%s', `origin/${b}`, '--no-merges').out}`);
  process.exit(0);
 }
 let wanted = args.filter(a => !a.startsWith('--')).map(b => ({ branch: b.replace(/^origin\//, '') }));
 if (flags.has('--drafts')) wanted.push(...(await drafts()).filter(d => d.branch !== here));
 if (!wanted.length) { console.error(flags.has('--drafts') ? 'No open draft PRs into main.' : 'Name branches, or pass --drafts.'); process.exit(flags.has('--drafts') ? 0 : 2); }
 // Once the batch PR is ready its one CI run is going: every merge pushed into it restarts that run (batch 3: 5 pushes in
 // 13 min, 35 min of CI). Late branches go into the next batch; --late adds them anyway (a fix the run needs).
 if (!flags.has('--plan') && !flags.has('--late')) {
  const pr = await ownPr(here);
  if (pr && !pr.draft) { console.error(`#${pr.number} is ready, so its CI is running: put these branches in the next batch (or pass --late for a fix this run needs).`); process.exit(2); }
 }
 // CI commits the batch's WebAssembly to its draft PR (avendb-wasm.yml): take that commit before merging more, so the
 // push stays a fast-forward
 if (!flags.has('--plan')) {
  tryGit('fetch', '-q', 'origin', here);
  if (tryGit('merge-base', '--is-ancestor', 'HEAD', `origin/${here}`).ok && git('rev-parse', 'HEAD') !== tryGit('rev-parse', `origin/${here}`).out) {
   const ff = tryGit('merge', '--ff-only', '-q', `origin/${here}`);
   console.log(ff.ok ? `Took CI's commits on origin/${here} first.` : `origin/${here} has commits this branch can't fast-forward to: pull first.`);
   if (!ff.ok) process.exit(2);
  }
 }
 if (!flags.has('--plan') && git('status', '--porcelain', '--untracked-files=no')) { console.error('Commit or stash first: the batch lands as a fast-forward of this branch.'); process.exit(2); }
 const t0 = performance.now();
 tryGit('fetch', '-q', 'origin', ...wanted.map(w => `+refs/heads/${w.branch}:refs/remotes/origin/${w.branch}`));
 const start = git('rev-parse', 'HEAD');
 let head = start;
 const rows = [];
 for (const w of wanted) {
  const ref = `origin/${w.branch}`, label = w.pr ? `#${w.pr} ${w.branch}` : w.branch;
  if (!tryGit('rev-parse', '--verify', '-q', ref).ok) { rows.push(['missing', label]); continue; }
  if (tryGit('merge-base', '--is-ancestor', ref, head).ok) { rows.push(['already in', label]); continue; }
  const m = mergeInMemory(head, ref, `Merge ${w.branch} into ${here}${w.pr ? ` (#${w.pr})` : ''}`);
  if (m.conflict) { rows.push(['CONFLICT', label, m.conflict.join(' ')]); continue; }
  head = m.commit;
  rows.push(['merged', label, (git('diff', '--shortstat', `${head}^1`, head) || 'nothing new') + (m.kept.length ? `; kept the batch's ${m.kept.join(', ')} for CI to rebuild` : '')]);
 }
 for (const r of rows) console.log(`${r[0].padEnd(10)} ${r[1]}${r[2] ? `  (${r[2]})` : ''}`);
 const n = k => rows.filter(r => r[0] === k).length;
 console.log(`\n${n('merged')} merged, ${n('already in')} already in, ${n('CONFLICT')} conflicting, ${n('missing')} missing, in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
 if (n('CONFLICT')) console.log('A conflicting branch stays out: its own thread merges this branch (or main) into it and says when, or merge it here by hand.');
 if (flags.has('--plan') || head === start) process.exit(n('CONFLICT') ? 1 : 0);
 git('merge', '--ff-only', '-q', head);
 console.log(`${here} is now ${head.slice(0, 10)}. Push it: git push -u origin ${here}`);
 if (flags.has('--check')) {
  const base = git('merge-base', 'origin/main', 'HEAD');
  process.exitCode = spawnSync('bun', ['scripts/devx/check.mjs', '--base', base, '--merge'], { stdio: 'inherit' }).status;
 } else process.exitCode = n('CONFLICT') ? 1 : 0;
}
