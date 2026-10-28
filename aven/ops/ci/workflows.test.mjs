import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
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
