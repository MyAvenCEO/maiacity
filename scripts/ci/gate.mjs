// The goal gate: the one check main's branch protection needs to require (Samuel 2026-10-28: a goal must not merge
// unless every suite it needs ran and passed). From the PR's changed files and each workflow's own `pull_request`
// trigger it works out which workflows GitHub must start on the head commit, waits for their runs, and fails when one
// is red, cancelled for good, or missing. Missing is what a rejected workflow file looks like (batch 5, 2026-10-28:
// avenDB checks never ran and nothing stopped the merge). Drafts run no CI and so no gate either (GitHub won't merge a
// draft); the gate starts with the goal's one CI run, and adds none.
//   GITHUB_TOKEN=… HEAD_SHA=… BASE_SHA=… bun scripts/ci/gate.mjs           (in .github/workflows/gate.yml)
//   bun scripts/ci/gate.mjs --plan <base> <head>                           which workflows a diff must start
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

// GitHub's filter patterns: ** any path, * anything but /, ? one character; a leading ! takes files back out
const glob = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*')
 .replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?') .replace(/\(\?:\.\*\/\)\?$/, '.*') + '$');

// does a pull_request trigger fire for these files (paths / paths-ignore, the last matching pattern wins)
export function fires(trigger, files) {
 if (trigger === undefined) return false;
 if (trigger === null || typeof trigger !== 'object') return true;
 if (trigger.branches && ![trigger.branches].flat().some(b => glob(b).test('main'))) return false;
 if (trigger.paths) {
  const pats = [trigger.paths].flat();
  return files.some(f => pats.reduce((hit, p) => p.startsWith('!') ? (glob(p.slice(1)).test(f) ? false : hit) : (glob(p).test(f) ? true : hit), false));
 }
 if (trigger['paths-ignore']) return files.some(f => ![trigger['paths-ignore']].flat().some(p => glob(p).test(f)));
 return true;
}

export function expected(files, dir = '.github/workflows', self = 'gate.yml') {
 const out = [];
 for (const f of readdirSync(dir).filter(f => /\.ya?ml$/.test(f) && f !== self)) {
  const y = Bun.YAML.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const on = y?.on ?? y?.[true];
  const trigger = typeof on === 'string' ? (on === 'pull_request' ? null : undefined)
   : Array.isArray(on) ? (on.includes('pull_request') ? null : undefined) : on?.pull_request;
  if (fires(trigger, files)) out.push({ path: `${dir}/${f}`, name: y.name ?? f });
 }
 return out;
}

const changed = (base, head) => execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' }).split('\n').filter(Boolean);

if (import.meta.main) {
 const args = process.argv.slice(2);
 if (args[0] === '--plan') { for (const w of expected(changed(args[1], args[2] || 'HEAD'))) console.log(w.name, `(${w.path})`); process.exit(0); }
 const { GITHUB_REPOSITORY: repo, HEAD_SHA: head, BASE_SHA: base } = process.env;
 const want = expected(changed(base, head));
 console.log(`This PR's files must start: ${want.map(w => w.name).join(', ') || 'no workflow'}`);
 const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${process.env.GITHUB_TOKEN}` };
 const started = Date.now(), limit = 45 * 60e3, grace = 4 * 60e3;
 for (;;) {
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${head}&event=pull_request&per_page=100`, { headers });
  const runs = (await r.json()).workflow_runs ?? [];
  const state = want.map(w => {
   // the newest attempt of that workflow on this commit; a rejected file shows as a run named by its path, with no jobs
   const run = runs.filter(x => x.path === w.path).sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
   return { ...w, run };
  });
  const waiting = state.filter(s => !s.run || s.run.status !== 'completed');
  const bad = state.filter(s => s.run?.status === 'completed' && s.run.conclusion !== 'success' && s.run.conclusion !== 'skipped');
  const missing = state.filter(s => !s.run);
  const late = Date.now() - started > grace;
  if (bad.length || (late && missing.length) || Date.now() - started > limit) {
   for (const s of bad) console.log(`::error title=${s.name}::${s.run.conclusion}${s.run.name === s.path ? ' (GitHub rejected the workflow file: bun scripts/ci/workflows.mjs)' : ''} ${s.run.html_url}`);
   for (const s of missing) console.log(`::error title=${s.name}::never started on ${head.slice(0, 7)} (a rejected workflow file? bun scripts/ci/workflows.mjs)`);
   for (const s of waiting.filter(s => s.run)) console.log(`::error title=${s.name}::still ${s.run.status} after ${Math.round(limit / 60e3)} min`);
   process.exit(1);
  }
  if (!waiting.length) { console.log(`All ${state.length} passed: ${state.map(s => s.name).join(', ')}`); process.exit(0); }
  console.log(`waiting for ${waiting.map(s => s.name).join(', ')}`);
  await Bun.sleep(30e3);
 }
}
