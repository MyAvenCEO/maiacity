#!/usr/bin/env node
// avenSANDBOX (theOS/aip/AIP-2.json, c3): do two runs of theOS's check give the same pass or fail per check? Compares
// two report.json files (theOS/avenCEO/checks/out/report.json, or the image workflow's theos-check-report artifact) state
// by state, keyed by size, url and clicks. Exits 1 on any difference (a state in one run only, or passing in one and
// failing in the other), 2 when a report can't be read.
//   node theOS/sandbox/same.mjs <a/report.json> <b/report.json>
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: same.mjs <a/report.json> <b/report.json>'); process.exit(2); }
function states(path) {
  let r;
  try { r = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`${path}: ${e.message}`); process.exit(2); }
  // A key can repeat (two states reached by the same clicks): each key holds its verdicts, sorted.
  const m = new Map();
  for (const s of r.results ?? []) {
    const k = `${s.size} ${s.url} ${JSON.stringify(s.clicks ?? [])}`;
    m.set(k, [...(m.get(k) ?? []), (s.fails ?? []).length ? 'fail' : 'pass']);
  }
  for (const [k, v] of m) m.set(k, v.sort().join(','));
  return { m, n: (r.results ?? []).length, playwright: r.playwright, failed: r.failed };
}
const A = states(a), B = states(b);
let diff = 0;
for (const [k, v] of A.m) {
  if (!B.m.has(k)) { if (diff++ < 20) console.log(`only in ${a}: ${k}`); }
  else if (B.m.get(k) !== v) { if (diff++ < 20) console.log(`${k}: ${v} in ${a}, ${B.m.get(k)} in ${b}`); }
}
for (const k of B.m.keys()) if (!A.m.has(k) && diff++ < 20) console.log(`only in ${b}: ${k}`);
console.log(`${A.n} and ${B.n} states (Playwright ${A.playwright} and ${B.playwright}; ${A.failed} and ${B.failed} failed): ${diff ? `${diff} differ` : 'the same'}`);
process.exit(diff ? 1 : 0);
