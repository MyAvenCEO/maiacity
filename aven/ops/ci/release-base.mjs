// A superseded pending main run may contain changes absent from event.before..HEAD.
// Narrow release selection only when that exact predecessor completed the entire release graph.
import { execFileSync } from 'node:child_process';
export function releasedBase(base, runs) {
 if (!base || !/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base)) return '';
 return runs.some(run => run.head_sha === base && run.conclusion === 'success' && run.status === 'completed') ? base : '';
}
if (import.meta.main) {
 let base='';
 try {
  const before=process.env.CI_BASE;
  if (before && /^[a-f0-9]{40}$/.test(before)) {
   const response=JSON.parse(execFileSync('gh',['api',`repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/main.yml/runs?branch=main&event=push&status=success&per_page=100`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
   base=releasedBase(before,response.workflow_runs);
  }
 } catch { /* Unavailable history or a new workflow: rebuild and validate every component. */ }
 console.log(base);
}
