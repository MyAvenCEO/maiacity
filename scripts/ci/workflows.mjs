// GitHub rejects a workflow file whose expressions use a context where it isn't available, and says so only as a
// failed run named by the file's path, with no jobs: on 2026-10-28 `runner.temp` in a job's `env` kept avenDB's checks
// from running on batch 5's PR for four hours, unnoticed. This checks every workflow for that and for `needs` that
// point nowhere, locally (scripts/devx/check.mjs runs it when a workflow changed) and in CI (workflows.test.mjs).
//   bun scripts/ci/workflows.mjs [files...]        (default: every .github/workflows/*.yml)
import { readdirSync, readFileSync } from 'node:fs';

// Which contexts each key may use (docs.github.com, "Contexts reference: context availability"), for the keys where a
// slip is easy; step-level keys allow nearly everything and aren't checked.
const base = ['github', 'needs', 'vars', 'inputs'];
const allowed = {
 'if': base,
 'env': [...base, 'strategy', 'matrix', 'secrets'],
 'name': [...base, 'strategy', 'matrix'],
 'runs-on': [...base, 'strategy', 'matrix'],
 'timeout-minutes': [...base, 'strategy', 'matrix'],
 'services': [...base, 'strategy', 'matrix', 'secrets'],
 'container': [...base, 'strategy', 'matrix', 'secrets'],
 'strategy': [...base],
 'concurrency': [...base, 'strategy', 'matrix'],
 'outputs': [...base, 'strategy', 'matrix', 'secrets', 'steps', 'job', 'runner', 'env'],
};
const contexts = ['github', 'needs', 'vars', 'inputs', 'strategy', 'matrix', 'secrets', 'steps', 'job', 'runner', 'env', 'jobs'];
const functions = /^(success|failure|always|cancelled|contains|startsWith|endsWith|format|join|toJSON|fromJSON|hashFiles)$/;

// the contexts an expression names (a word before a dot or bracket, outside string literals)
function used(expr) {
 const bare = expr.replace(/'(?:[^']|'')*'/g, "''");
 return [...bare.matchAll(/(?<![\w.-])([a-zA-Z_][\w-]*)\s*(?=[.[])/g)].map(m => m[1]).filter(w => contexts.includes(w) && !functions.test(w));
}
function expressions(value, out = []) {
 if (typeof value === 'string') for (const m of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) out.push(m[1]);
 else if (Array.isArray(value)) value.forEach(v => expressions(v, out));
 else if (value && typeof value === 'object') Object.values(value).forEach(v => expressions(v, out));
 return out;
}

export function lint(text, file = 'workflow') {
 const problems = [], y = Bun.YAML.parse(text);
 const jobs = y?.jobs ?? {};
 for (const [id, job] of Object.entries(jobs)) {
  const needs = [job.needs ?? []].flat();
  for (const n of needs) if (!jobs[n]) problems.push(`${file}: job ${id} needs ${n}, which is no job here`);
  for (const [key, ok] of Object.entries(allowed)) {
   if (job[key] == null) continue;
   // a job's `if` is an expression even without ${{ }}
   const exprs = key === 'if' && typeof job.if === 'string' && !job.if.includes('${{') ? [job.if] : expressions(job[key]);
   for (const e of exprs) for (const c of used(e)) {
    if (!ok.includes(c)) problems.push(`${file}: job ${id}: \`${c}\` can't be used in jobs.${id}.${key} (\${{${e.trim().slice(0, 60)}}})`);
   }
  }
  const all = [...expressions(job), ...(typeof job.if === 'string' && !job.if.includes('${{') ? [job.if] : [])];
  for (const e of all) for (const m of e.matchAll(/needs\.([\w-]+)/g))
   if (!needs.includes(m[1])) problems.push(`${file}: job ${id} reads needs.${m[1]} but doesn't need ${m[1]}`);
 }
 return problems;
}

if (import.meta.main) {
 const dir = '.github/workflows';
 const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).map(f => `${dir}/${f}`);
 const problems = files.flatMap(f => { try { return lint(readFileSync(f, 'utf8'), f); } catch (e) { return [`${f}: ${e.message}`]; } });
 problems.forEach(p => console.log(p));
 console.log(problems.length ? `${problems.length} problem(s): GitHub would reject these files` : `${files.length} workflow files: no context or needs problem`);
 process.exitCode = problems.length ? 1 : 0;
}
