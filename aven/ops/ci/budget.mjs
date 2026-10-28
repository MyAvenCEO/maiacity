// The time budget of CI and release (Samuel 2026-10-27: under 10 minutes, and kept there). .github/workflows/ci-budget.yml
// runs this when one of the budgeted workflows finishes: it names the run's slowest jobs and their slowest steps, and
// fails (a red "CI budget" run, the flag) when the run took longer than its budget. Read-only.
//   RUN_ID=<id> bun aven/ops/ci/budget.mjs      (GITHUB_TOKEN optional locally; GITHUB_STEP_SUMMARY gets the table)
import { appendFileSync } from 'node:fs';

// minutes from the run's start to its last job's end; a run of these workflows past it is flagged
export const budgets = { 'Validate and release': 10, 'avenDB checks': 10, 'Kernel': 6, 'avenDB WebAssembly': 6, 'theOS on macOS': 10 };

const repo = process.env.GITHUB_REPOSITORY || 'MyAvenCEO/maiacity';
const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) };
const get = async path => { const r = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers }); if (!r.ok) throw new Error(`${r.status} ${path}`); return r.json(); };
const min = (a, b) => a && b ? (new Date(b) - new Date(a)) / 60000 : 0;
const f = x => x.toFixed(1);

export function judge(run, jobs) {
 const ran = jobs.filter(j => j.started_at && j.completed_at && j.conclusion !== 'skipped');
 const start = run.run_started_at || run.created_at;
 const end = ran.reduce((e, j) => j.completed_at > e ? j.completed_at : e, start);
 const took = min(start, end), budget = budgets[run.name];
 const slow = ran.map(j => ({ name: j.name, took: min(j.started_at, j.completed_at), queued: min(j.created_at, j.started_at),
  steps: (j.steps || []).map(s => ({ name: s.name, took: min(s.started_at, s.completed_at) })).sort((a, b) => b.took - a.took).slice(0, 2) }))
  .sort((a, b) => b.took - a.took).slice(0, 6);
 return { took, budget, over: budget != null && took > budget, slow };
}

if (import.meta.main) {
 const run = await get(`/actions/runs/${process.env.RUN_ID}`);
 if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') { console.log(`${run.name}: ${run.conclusion}, not judged`); process.exit(0); }
 const { jobs } = await get(`/actions/runs/${run.id}/jobs?per_page=100&filter=latest`);
 const j = judge(run, jobs);
 const lines = [
  `### ${run.name} (${run.event}, ${run.head_branch}): ${f(j.took)} min of a ${j.budget ?? '–'} min budget${j.over ? ' — OVER BUDGET' : ''}`,
  run.html_url, '', '| job | min | queued | slowest steps |', '|---|---|---|---|',
  ...j.slow.map(s => `| ${s.name} | ${f(s.took)} | ${f(s.queued)} | ${s.steps.map(x => `${x.name} ${f(x.took)}`).join('; ')} |`),
 ];
 console.log(lines.join('\n'));
 if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
 if (j.over) { console.log(`::error title=CI over budget::${run.name} took ${f(j.took)} min (budget ${j.budget}); slowest: ${j.slow[0]?.name} ${f(j.slow[0]?.took ?? 0)} min`); process.exitCode = 1; }
}
