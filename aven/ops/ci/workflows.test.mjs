import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lint } from './workflows.mjs';

test('every workflow uses each context only where GitHub allows it', () => {
 const dir = '.github/workflows';
 const problems = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).flatMap(f => lint(readFileSync(`${dir}/${f}`, 'utf8'), f));
 expect(problems).toEqual([]);
});

test('the slip that kept batch 5 from running its avenDB checks is caught', () => {
 const yml = `on: push
jobs:
  a:
    runs-on: ubuntu-latest
    env:
      PAIRS: \${{ runner.temp }}/pairs
    steps:
      - run: echo
  b:
    needs: a
    if: matrix.x == 'y' && needs.c.outputs.z
    runs-on: ubuntu-latest
    steps:
      - env:
          OK: \${{ runner.temp }}
        run: echo \${{ steps.s.outputs.v }}
`;
 const p = lint(yml, 'w.yml');
 expect(p.some(x => x.includes('`runner` can\'t be used in jobs.a.env'))).toBe(true);
 expect(p.some(x => x.includes('`matrix` can\'t be used in jobs.b.if'))).toBe(true);
 expect(p.some(x => x.includes('reads needs.c'))).toBe(true);
 expect(p.some(x => x.includes('steps'))).toBe(false);
});

test('strings and function names are not read as contexts', () => {
 const yml = `on: push
jobs:
  a:
    runs-on: \${{ format('{0}', 'env.x') }}
    if: \${{ !cancelled() && github.event_name == 'push' }}
    steps:
      - run: echo
`;
 expect(lint(yml, 'w.yml')).toEqual([]);
});

// the first release's peer and API were denied their images (2026-10-28): a job that logs the server into ghcr.io
// with its token must be granted packages, as the workflow's own token reads contents alone
test('every job that logs the server into ghcr.io may read packages', () => {
 const dir = '.github/workflows';
 const logins = [];
 for (const f of readdirSync(dir).filter(f => f.endsWith('.yml'))) {
  const wf = Bun.YAML.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
   if (!JSON.stringify(job.steps ?? []).includes('docker login ghcr.io')) continue;
   logins.push(`${f}:${id}`);
   const packages = (job.permissions ?? wf.permissions ?? {}).packages;
   expect([`${f}:${id}`, packages === 'read' || packages === 'write']).toEqual([`${f}:${id}`, true]);
  }
 }
 expect(logins.sort()).toEqual(['ops.yml:rollback', 'release.yml:api', 'release.yml:peer']);
});

// "CI required" checks out aven/ops/ci alone: plan.mjs's imports reached past it once, and the verdict could not start
// (#1378, impact.mjs importing aven/ops/devx/wasm.mjs)
test('a job with a sparse checkout has every module its bun scripts import', () => {
 const dir = '.github/workflows';
 const imports = file => [...readFileSync(file, 'utf8').matchAll(/^import .* from '(\.{1,2}\/[^']+)';$/gm)].map(m => join(dirname(file), m[1]));
 for (const f of readdirSync(dir).filter(f => f.endsWith('.yml'))) {
  for (const [id, job] of Object.entries(Bun.YAML.parse(readFileSync(`${dir}/${f}`, 'utf8')).jobs ?? {})) {
   const sparse = (job.steps ?? []).find(s => s.with?.['sparse-checkout'])?.with['sparse-checkout'].split('\n').filter(Boolean);
   if (!sparse) continue;
   const has = path => sparse.some(p => path === p || path.startsWith(`${p}/`));
   const todo = (job.steps ?? []).flatMap(s => [...(s.run ?? '').matchAll(/\bbun ((?:aven|maia|theos)\/[^\s"']+\.mjs)/g)].map(m => m[1]));
   for (const seen = new Set(); todo.length;) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    expect([`${f}:${id}`, file, has(file)]).toEqual([`${f}:${id}`, file, true]);
    todo.push(...imports(file));
   }
  }
 }
});
