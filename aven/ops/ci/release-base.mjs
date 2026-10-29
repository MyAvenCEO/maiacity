// The last commit release.yml shipped: the newest of main's first parents (before this commit) whose release run
// completed green. A release that failed, was cancelled or still runs shipped nothing for sure, so its changes are not
// out yet: the next release compares with the last commit that did ship and ships (and checks) all of them. Nothing in
// reach, or no history: an empty base, which rebuilds and validates every component.
const REACH = 30;
// the fields read here: a commit's full answer carries every file's patch (a goal's merge outgrew the shell's buffer)
const RUNS = '{workflow_runs: [.workflow_runs[] | {head_sha, status, conclusion}]}';

export async function releasedBase({ api, repo, head, reach = REACH }) {
 if (!/^[a-f0-9]{40}$/.test(head ?? '')) return '';
 const runs = (await api(`repos/${repo}/actions/workflows/release.yml/runs?branch=main&event=push&status=success&per_page=100`, RUNS)).workflow_runs ?? [];
 const shipped = new Set(runs.filter(run => run.status === 'completed' && run.conclusion === 'success').map(run => run.head_sha));
 let sha = head;
 for (let step = 0; step < reach; step++) {
  sha = (await api(`repos/${repo}/git/commits/${sha}`)).parents?.[0]?.sha;
  if (!sha) return '';
  if (shipped.has(sha)) return sha;
 }
 return '';
}

if (import.meta.main) {
 const { execFileSync } = await import('node:child_process');
 const api = async (path, jq) => JSON.parse(execFileSync('gh', ['api', path, ...(jq ? ['--jq', jq] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
 let base = '';
 try { base = await releasedBase({ api, repo: process.env.GITHUB_REPOSITORY, head: process.env.CI_HEAD }); }
 catch { /* Unavailable history or a new workflow: rebuild and validate every component. */ }
 console.error(base ? `last commit shipped: ${base}` : `no shipped commit among ${REACH} first parents: validate everything`);
 console.log(base);
}
