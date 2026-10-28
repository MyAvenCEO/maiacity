// How long one change took from its last push to deployed (Samuel 2026-10-28: devX speed first, a pushed fix deployed
// in 5 minutes), in segments, so each change to CI or release shows where its minutes went:
//   push → CI started → CI green (the PR's last head) → merged → "Validate and release" done on main's merge commit
//   bun scripts/devx/leadtime.mjs <pr-number> [--json]
// The rows go into docs/devx/cycles.md's lead-time table. Read-only; GITHUB_TOKEN optional (60 requests an hour without).
const repo = process.env.GITHUB_REPOSITORY || 'MyAvenCEO/maiacity';
const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) };
const api = async path => {
 const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers });
 if (!r.ok) throw new Error(`GitHub said ${r.status} for ${path}`);
 return r.json();
};
const runsOf = async (sha, event) => (await api(`actions/runs?head_sha=${sha}&event=${event}&per_page=100`)).workflow_runs;
const t = s => s ? new Date(s).getTime() : null;
const min = (a, b) => a != null && b != null ? Math.round((b - a) / 6e3) / 10 : null;

export async function leadtime(n) {
 const pr = await api(`pulls/${n}`);
 const head = pr.head.sha;
 const commit = await api(`commits/${head}`);
 // the pull request's checks on its last head; a workflow's newest attempt only
 const newest = runs => Object.values(Object.groupBy(runs, r => r.path)).map(rs => rs.sort((a, b) => b.run_attempt - a.run_attempt || b.id - a.id)[0]);
 const prRuns = newest(await runsOf(head, 'pull_request'));
 const started = Math.min(...prRuns.map(r => t(r.run_started_at ?? r.created_at)));
 const green = prRuns.every(r => r.status === 'completed') ? Math.max(...prRuns.map(r => t(r.updated_at))) : null;
 const red = prRuns.filter(r => r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion)).map(r => r.name);
 const release = pr.merge_commit_sha && pr.merged_at
  ? (await runsOf(pr.merge_commit_sha, 'push')).find(r => r.name === 'Validate and release') : null;
 const pushed = t(commit.commit.committer.date);
 const row = {
  pr: n, title: pr.title, head: head.slice(0, 8),
  push_to_ci_min: min(pushed, started),
  ci_min: min(started, green),
  ci_red: red,
  green_to_merge_min: min(green, t(pr.merged_at)),
  merge_to_release_start_min: min(t(pr.merged_at), t(release?.run_started_at)),
  release_min: release?.status === 'completed' ? min(t(release.run_started_at), t(release.updated_at)) : null,
  release: release ? `${release.status}${release.conclusion ? ` ${release.conclusion}` : ''}` : pr.merged_at ? 'no run' : 'not merged',
  push_to_deployed_min: release?.conclusion === 'success' ? min(pushed, t(release.updated_at)) : null,
 };
 // the slowest workflow on the PR's last head, the one to cut next
 const slow = prRuns.filter(r => r.status === 'completed').sort((a, b) => (t(b.updated_at) - t(b.run_started_at)) - (t(a.updated_at) - t(a.run_started_at)))[0];
 if (slow) row.slowest_pr_workflow = `${slow.name} ${min(t(slow.run_started_at), t(slow.updated_at))} min`;
 return row;
}

if (import.meta.main) {
 const n = process.argv[2];
 if (!/^\d+$/.test(n ?? '')) { console.error('bun scripts/devx/leadtime.mjs <pr-number> [--json]'); process.exit(2); }
 const row = await leadtime(n);
 if (process.argv.includes('--json')) console.log(JSON.stringify(row, null, 1));
 else {
  const f = x => x == null ? '–' : `${x} min`;
  console.log(`#${row.pr} ${row.title} (head ${row.head})`);
  console.log(`  push → CI started    ${f(row.push_to_ci_min)}`);
  console.log(`  CI                   ${f(row.ci_min)}${row.ci_red.length ? `, red: ${row.ci_red.join(', ')}` : ''}${row.slowest_pr_workflow ? ` (slowest: ${row.slowest_pr_workflow})` : ''}`);
  console.log(`  green → merged       ${f(row.green_to_merge_min)}`);
  console.log(`  merged → release     ${f(row.merge_to_release_start_min)}`);
  console.log(`  release              ${f(row.release_min)} (${row.release})`);
  console.log(`  push → deployed      ${f(row.push_to_deployed_min)}`);
  console.log(`| #${row.pr} | ${row.head} | ${f(row.push_to_ci_min)} | ${f(row.ci_min)} | ${f(row.green_to_merge_min)} | ${f(row.merge_to_release_start_min)} | ${f(row.release_min)} | ${f(row.push_to_deployed_min)} |`);
 }
}
