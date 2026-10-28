// How fast we ship, from GitHub alone, for the improvement cycle (.claude/skills/devx-speed): measure, change one
// thing, measure again over the same kind of window. Read-only.
//   bun aven/ops/devx/measure.mjs                      the last 24 hours
//   bun aven/ops/devx/measure.mjs --since 2026-10-13 --until 2026-10-22 [--by-day] [--json]
// A task is one piece of work that reached main: a goal PR into main counts its "Task: <branch>" lines (the body
// `bun aven/ops/devx/collect.mjs --tasks` writes), any other PR into main one, and a lane PR merged into another
// branch one more.
const repo = 'MyAvenCEO/maiacity', api = 'https://api.github.com';
const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) };
const get = async path => { const r = await fetch(api + path, { headers }); if (!r.ok) throw new Error(`${r.status} ${path}`); return r.json(); };
const t = s => new Date(s).getTime(), min = ms => ms / 60000;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const round = x => x == null ? null : Math.round(x * 10) / 10;

async function pulls(since, until) {
 const out = [];
 for (let page = 1; page <= 30; page++) {
  const list = await get(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
  out.push(...list.filter(p => p.merged_at && t(p.merged_at) >= since && t(p.merged_at) < until));
  if (list.length < 100 || t(list.at(-1).updated_at) < since) return out;
 }
 return out;
}

async function runs(since, until) {
 const out = [], day = 864e5;
 // the API caps one listing at 1000 runs, so one day at a time
 for (let d = since; d < until; d += day) {
  const range = `${new Date(d).toISOString()}..${new Date(Math.min(d + day, until)).toISOString()}`;
  for (let page = 1; page <= 10; page++) {
   const { workflow_runs: list } = await get(`/repos/${repo}/actions/runs?per_page=100&page=${page}&created=${encodeURIComponent(range)}`);
   out.push(...list);
   if (list.length < 100) break;
  }
 }
 return out;
}

export async function measure(since, until) {
 const prs = await pulls(since, until), main = prs.filter(p => p.base.ref === 'main');
 const tasks = main.reduce((n, p) => n + Math.max(1, (p.body || '').match(/^Task: /gm)?.length ?? 0), 0) + prs.length - main.length;
 const R = await runs(since, until), wall = r => min(t(r.updated_at) - t(r.run_started_at || r.created_at));
 const onPR = R.filter(r => r.event.startsWith('pull_request'));
 const release = R.filter(r => r.name === 'Validate and release' && r.conclusion === 'success').map(wall);
 const hours = (until - since) / 36e5;
 return {
  from: new Date(since).toISOString(), to: new Date(until).toISOString(), hours: round(hours),
  tasks_to_main: tasks, tasks_per_day: round(tasks / hours * 24), prs_to_main: main.length, lane_prs: prs.length - main.length,
  pr_open_to_merge_min: round(median(main.map(p => min(t(p.merged_at) - t(p.created_at))))),
  ci_runs: R.length, ci_pr_run_min: Math.round(onPR.reduce((s, r) => s + wall(r), 0)),
  ci_cancelled_share: round(100 * onPR.filter(r => r.conclusion === 'cancelled').length / (onPR.length || 1)),
  ci_pr_run_min_per_task: round(onPR.reduce((s, r) => s + wall(r), 0) / (tasks || 1)),
  release_min: round(median(release)),
 };
}

if (import.meta.main) {
 const args = process.argv.slice(2), arg = f => args.includes(f) ? args[args.indexOf(f) + 1] : undefined;
 const until = arg('--until') ? t(arg('--until')) : Date.now(), since = arg('--since') ? t(arg('--since')) : until - 864e5;
 const windows = [];
 if (args.includes('--by-day')) for (let d = since; d < until; d += 864e5) windows.push([d, Math.min(d + 864e5, until)]);
 else windows.push([since, until]);
 for (const [a, b] of windows) {
  const m = await measure(a, b);
  console.log(args.includes('--json') ? JSON.stringify(m) : Object.entries(m).map(([k, v]) => `${k.padEnd(26)} ${v}`).join('\n') + '\n');
 }
}
