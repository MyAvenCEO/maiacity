// Whether main's release need not run CI again: the merged pull request's CI run passed on byte-for-byte the files main
// now holds. Then the release also promotes what that run built (the page's device, the images by digest): it was built
// by the very ci.yml main now holds, from the very files main holds. The pull request's head must hold the commit main merged onto (so its runs, which check out the PR
// merged into main, tested exactly this tree, selected from the same changed files), the trees must be equal, and that
// head's latest run of ci.yml must have completed green. Anything else, an unknown or missing run, a red one, a different
// tree, a release base that is not main's (first) parent, runs CI on main's commit (release.yml).
import { appendFileSync } from 'node:fs';
export const suites = { ci: '.github/workflows/ci.yml' };

// a run still going on the same tree (a PR merged before its last checks finished) is waited for, up to this long
const WAIT_MS = 15 * 60 * 1000, POLL_MS = 20 * 1000;

export async function reusable({ api, repo, sha, base, wait = WAIT_MS, poll = POLL_MS, sleep = ms => new Promise(r => setTimeout(r, ms)), log = () => {} }) {
 const commit = await api(`repos/${repo}/commits/${sha}`);
 const pulls = (await api(`repos/${repo}/commits/${sha}/pulls`)).filter(p => p.merged_at && p.merge_commit_sha === sha && p.head?.repo?.full_name === repo);
 // the merged pull request's ref: when its run cannot stand for main's, the verdicts its jobs saved there still count
 // for the jobs main's run would key on the very same files (plan.mjs)
 const ref = pulls.length === 1 ? `refs/pull/${pulls[0].number}/merge` : '';
 const none = { ...Object.fromEntries(Object.keys(suites).map(k => [k, false])), run: '', ref };
 // a squash has one parent; a batch PR lands as a merge commit (CLAUDE.md) whose second parent must be the PR's head
 const [first, second, ...more] = commit.parents ?? [];
 const parent = first && !more.length ? first.sha : '';
 if (!parent || base !== parent) { log(`release base ${base || 'none'} is not main's parent ${parent || '(several)'}: validate`); return none; }
 const tree = commit.commit.tree.sha;
 if (pulls.length !== 1) { log(`no single pull request merged as ${sha}: validate`); return none; }
 const head = pulls[0].head.sha;
 if (second && second.sha !== head) { log(`#${pulls[0].number} merged as ${sha} onto another commit than its head ${head}: validate`); return none; }
 const headCommit = await api(`repos/${repo}/commits/${head}`);
 if (headCommit.commit.tree.sha !== tree) { log(`#${pulls[0].number}'s head ${head} holds other files than main: validate`); return none; }
 const compare = await api(`repos/${repo}/compare/${parent}...${head}`);
 if (!['ahead', 'identical'].includes(compare.status)) { log(`#${pulls[0].number}'s head does not hold ${parent}: validate`); return none; }
 const out = { ...none };
 const deadline = Date.now() + wait;
 for (const [suite, path] of Object.entries(suites)) {
  for (;;) {
   const runs = (await api(`repos/${repo}/actions/runs?head_sha=${head}&event=pull_request&per_page=100`)).workflow_runs
    .filter(r => r.path === path && r.head_sha === head && r.head_repository?.full_name === repo)
    .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt);
   const run = runs[0];
   if (run && run.status !== 'completed' && Date.now() < deadline) { log(`${suite}: run ${run.id} on the same files still going, waiting`); await sleep(poll); continue; }
   out[suite] = !!run && run.status === 'completed' && run.conclusion === 'success';
   if (out[suite]) out.run = String(run.id);
   log(`${suite}: ${out[suite] ? `passed in run ${run.id} on #${pulls[0].number}'s head ${head}, same files: not run again` : `no green run on the same files (${run ? `${run.id} ${run.status} ${run.conclusion}` : 'none'}): validate`}`);
   break;
  }
 }
 return out;
}

if (import.meta.main) {
 const { execFileSync } = await import('node:child_process');
 const repo = process.env.GITHUB_REPOSITORY;
 const api = async path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
 let out = { ...Object.fromEntries(Object.keys(suites).map(k => [k, false])), run: '', ref: '' };
 try { out = await reusable({ api, repo, sha: process.env.CI_HEAD, base: process.env.CI_BASE, log: m => console.log(m) }); }
 catch (e) { console.log(`reuse unavailable (${e.message.split('\n')[0]}): run CI on main's commit`); }
 if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => k === 'run' ? `reuse_run=${v}` : k === 'ref' ? `verdicts_ref=${v}` : `reuse_${k}=${v}`).join('\n') + '\n');
}
