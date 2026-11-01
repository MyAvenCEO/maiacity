#!/usr/bin/env node
// avenSANDBOX (aip-6fb1, c3): do two runs of theOS's check give the same pass or fail per check? Takes two out folders of
// theOS/sandbox/check.sh (report.json, fixtures/<page>/report.json, commit.txt). Exits 2 when one is not such a folder,
// and 1 when:
//   - they ran on different commits (commit.txt), or on a tree with uncommitted changes;
//   - the verdicts differ (red or green);
//   - a state both runs reached fails different rules in each;
//   - a fixture (a planted page, red or green by design) differs in its verdict or its failing rules.
// The crawl samples (aip-31df: buttons are pressed in the first state of each view type, and which state comes first
// varies), so a state reached by one run only is listed, not counted as a difference.
//   node theOS/sandbox/same.mjs <out-a> <out-b>
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: same.mjs <out-a> <out-b>'); process.exit(2); }
const bad = (m) => { console.error(m); process.exit(2); };
function report(path) {
  let r;
  try { r = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { bad(`${path}: ${e.message}`); }
  if (!Array.isArray(r.results) || typeof r.failed !== 'number' || r.results.length !== (r.reached ?? r.states)) bad(`${path}: not a report of theOS's check`);
  const m = new Map(); // key: the state; value: the sorted failing rules of each state with that key
  for (const s of r.results) {
    const k = `${s.size} ${s.url} ${JSON.stringify(s.clicks ?? [])}`;
    m.set(k, [...(m.get(k) ?? []), (s.fails ?? []).map((f) => `${f.rule} ${f.where}`).sort().join('; ')]);
  }
  for (const [k, v] of m) m.set(k, v.sort().join(' | '));
  return { m, n: r.results.length, failed: r.failed };
}
function folder(dir) {
  const c = join(dir, 'commit.txt');
  if (!existsSync(c)) bad(`${dir}: no commit.txt (run theOS/sandbox/check.sh)`);
  const [commit, where] = readFileSync(c, 'utf8').trim().split(' ');
  const fx = join(dir, 'fixtures');
  const fixtures = existsSync(fx) ? readdirSync(fx).sort() : [];
  return { commit, where, main: report(join(dir, 'report.json')), fixtures: new Map(fixtures.map((f) => [f, report(join(fx, f, 'report.json'))])) };
}
const A = folder(a), B = folder(b);
let diff = 0;
const say = (m) => { if (diff++ < 20) console.log(m); };
if (A.commit !== B.commit || A.commit.endsWith('-dirty')) say(`commits: ${A.commit} (${A.where}) and ${B.commit} (${B.where})`);
const verdict = (r) => (r.failed ? 'red' : 'green');
if (verdict(A.main) !== verdict(B.main)) say(`verdict: ${verdict(A.main)} (${A.where}) and ${verdict(B.main)} (${B.where})`);
let only = 0, both = 0;
for (const [k, v] of A.main.m) {
  if (!B.main.m.has(k)) { only++; continue; }
  both++;
  if (B.main.m.get(k) !== v) say(`${k}: fails [${v}] (${A.where}) and [${B.main.m.get(k)}] (${B.where})`);
}
for (const k of B.main.m.keys()) if (!A.main.m.has(k)) only++;
const names = new Set([...A.fixtures.keys(), ...B.fixtures.keys()]);
if (!names.size) say('no fixtures: run theOS/sandbox/check.sh, which runs the check\'s own test');
for (const f of names) {
  const x = A.fixtures.get(f), y = B.fixtures.get(f);
  if (!x || !y) { say(`fixture ${f}: in one run only`); continue; }
  if (verdict(x) !== verdict(y)) say(`fixture ${f}: ${verdict(x)} and ${verdict(y)}`);
  const fails = (r) => [...r.m.values()].filter(Boolean).sort().join(' | ');
  if (fails(x) !== fails(y)) say(`fixture ${f}: fails [${fails(x)}] and [${fails(y)}]`);
}
console.log(`${A.where} and ${B.where} on ${A.commit}: ${verdict(A.main)} and ${verdict(B.main)}; ${both} states reached by both, ${only} by one only (the crawl samples); ${names.size} fixtures: ${diff ? `${diff} differ` : 'the same'}`);
process.exit(diff ? 1 : 0);
