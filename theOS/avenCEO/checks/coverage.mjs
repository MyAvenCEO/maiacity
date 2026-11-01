#!/usr/bin/env node
// c2's count (aip-31df): of the routes theOS's docs list, which did a run of the check reach? The slides of every chapter
// (docs/stories.json), every OLD-AIP page and how many show their Learn tab (docs/intents.json, docs/theINTENTS.json on
// older commits), and every doc by its id (brain/ids.json, where it exists).
// Usage: node theOS/avenCEO/checks/coverage.mjs [--root <theOS dir>] [<report.json>]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const at = argv.indexOf('--root');
const root = at >= 0 ? resolve(argv.splice(at, 2)[1]) : resolve(HERE, '../..');
const report = JSON.parse(readFileSync(argv[0] ?? join(HERE, 'out/report.json'), 'utf8'));
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const slides = [];
for (const s of read('docs/stories.json').stories.filter((x) => !x.kind)) {
  read(`docs/${s.file}`).slides.forEach((_, i) => slides.push(`${s.id}-${i + 1}`));
}
const intentsFile = ['docs/intents.json', 'docs/theINTENTS.json'].find((p) => existsSync(join(root, p)));
const intents = intentsFile ? read(intentsFile).intents : [];
const withLearn = intents.filter((x) => x.learn).map((x) => x.n);
const ids = existsSync(join(root, 'brain/ids.json')) ? Object.keys(read('brain/ids.json').ids) : [];

for (const size of [...new Set(report.results.map((x) => x.size))]) {
  const mine = report.results.filter((x) => x.size === size);
  const hashes = new Set(mine.map((x) => decodeURIComponent(x.url.split('#')[1] ?? '')));
  const count = (want) => { const miss = want.filter((h) => !hashes.has(h)); return `${want.length - miss.length} of ${want.length}${miss.length ? ` (missing ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? ', …' : ''})` : ''}`; };
  const learn = new Set(mine.filter((x) => x.clicks.some((c) => c.includes('data-itab="learn"'))).map((x) => Number(/#intents-(\d+)/.exec(x.url)?.[1])));
  console.log(`${size}: slides ${count(slides)}; OLD-AIP pages ${count(intents.map((x) => `intents-${x.n}`))}; Learn tabs ${withLearn.filter((n) => learn.has(n)).length} of ${withLearn.length}${ids.length ? `; docs by id ${count(ids)}` : ''}`);
}
