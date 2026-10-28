// One goal PR's CI timeline, to keep each goal inside the time budget (Samuel 2026-10-27: CI and release under 10
// minutes) and to see at once why a goal took longer than the last: every push (whose, CI's WebAssembly commit or a
// person's), each budgeted workflow's run on it with its time and its slowest job, then the merge and main's release.
//   bun scripts/devx/goal.mjs <pr-number> [--json]
// The rows go into docs/devx/cycles.md's goal table. Read-only.
import { budgets } from '../ci/budget.mjs';

const repo = 'MyAvenCEO/maiacity';
const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) };
const get = async path => { const r = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers }); if (!r.ok) throw new Error(`${r.status} ${path}`); return r.json(); };
const min = (a, b) => (new Date(b) - new Date(a)) / 60000, f = x => x.toFixed(1), hm = t => t.slice(11, 16);
const names = Object.keys(budgets);

async function runs(filter) {
 const out = [];
 for (let page = 1; page <= 5; page++) {
  const { workflow_runs: list } = await get(`/actions/runs?per_page=100&page=${page}&${filter}`);
  out.push(...list.filter(r => names.includes(r.name)));
  if (list.length < 100) return out;
 }
 return out;
}

async function slowest(run) {
 const { jobs } = await get(`/actions/runs/${run.id}/jobs?per_page=100&filter=latest`);
 const j = jobs.filter(j => j.started_at && j.completed_at && j.conclusion !== 'skipped').sort((a, b) => min(b.started_at, b.completed_at) - min(a.started_at, a.completed_at))[0];
 return j ? `${j.name} ${f(min(j.started_at, j.completed_at))}` : '';
}

if (import.meta.main) {
 const n = process.argv[2];
 const pr = await get(`/pulls/${n}`);
 const commits = await get(`/pulls/${n}/commits?per_page=250`);
 const since = pr.created_at;
 // a collector's branch carries goal after goal: only this PR's lifetime
 const until = pr.merged_at || pr.closed_at || new Date().toISOString();
 const prRuns = (await runs(`branch=${encodeURIComponent(pr.head.ref)}&created=${since}..${until}`)).filter(r => r.event === 'pull_request');
 const heads = [...new Set(prRuns.map(r => r.head_sha))].reverse();
 const rows = [];
 for (const sha of heads) {
  const rs = prRuns.filter(r => r.head_sha === sha);
  const start = rs.reduce((s, r) => r.created_at < s ? r.created_at : s, rs[0].created_at);
  const c = commits.find(c => c.sha === sha);
  const who = rs[0].actor.login === 'github-actions[bot]' ? 'CI (WebAssembly commit)' : rs[0].actor.login;
  rows.push(`push ${hm(start)} ${sha.slice(0, 7)} by ${who}: ${(c?.commit.message.split('\n')[0] || '').slice(0, 60)}`);
  for (const r of rs.sort((a, b) => a.name.localeCompare(b.name))) {
   const took = r.status === 'completed' ? min(r.run_started_at, r.updated_at) : null;
   const over = took != null && took > budgets[r.name];
   rows.push(`   ${r.name.padEnd(22)} ${(r.conclusion || r.status).padEnd(10)} ${took == null ? '  …' : f(took).padStart(5)} min${over ? ' OVER' : ''}  ${r.conclusion === 'cancelled' || r.conclusion === 'skipped' ? '' : await slowest(r)}`);
  }
 }
 const first = prRuns.reduce((s, r) => r.created_at < s ? r.created_at : s, until);
 const last = prRuns.filter(r => r.status === 'completed').reduce((e, r) => r.updated_at > e ? r.updated_at : e, first);
 rows.unshift(`#${n} ${pr.title.slice(0, 70)}`, `opened ${hm(pr.created_at)} UTC, ${heads.length} heads with CI (${heads.filter(h => prRuns.find(r => r.head_sha === h).actor.login === 'github-actions[bot]').length} of them CI's WebAssembly), ${prRuns.filter(r => r.conclusion === 'cancelled').length} runs cancelled, ${f(min(first, last))} min from the first push's CI to the last result${pr.merged_at ? `, merged ${f(min(first, pr.merged_at))} min after the first push` : ''}`);
 if (pr.merged_at) {
  const rel = (await runs(`branch=main&event=push&created=>=${pr.merged_at}`)).filter(r => r.name === 'Validate and release' && r.head_sha === pr.merge_commit_sha)[0];
  rows.push(`merged ${hm(pr.merged_at)}; release ${rel ? `${rel.conclusion || rel.status} ${rel.status === 'completed' ? f(min(rel.run_started_at, rel.updated_at)) + ' min' : ''} (${await slowest(rel)})` : 'not found'}`);
 }
 console.log(rows.join('\n'));
}
