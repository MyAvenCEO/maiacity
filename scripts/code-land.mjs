// @ts-nocheck — plain JS, run by node only
// Land what was decided: write into code/ what the database says waits to land (a Generated UI view the admin kept),
// then rebuild code/index.js. game/code/land.js decides what to write; the landing job
// (.github/workflows/code-land.yml) runs this and merges the result by PR.
//
//   node scripts/code-land.mjs export.json [summary.md]
//
// export.json is what deploy/code-export.sh prints. summary.md, when named, gets the PR's text: what landed and what
// was refused, one line each.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { landing } from '../game/code/land.js';
import { entries, moduleTexts } from './code-index.mjs';

const ROOT = fileURLToPath(new URL('../code/', import.meta.url));
const SAFE = /^views\/[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\/[a-z0-9][a-z0-9_.-]*$/;

const [input, summary] = process.argv.slice(2);
if (!input) {
	console.error('usage: node scripts/code-land.mjs export.json [summary.md]');
	process.exit(2);
}
const exported = JSON.parse(readFileSync(input, 'utf8'));
const have = entries(ROOT, ['views', 'logic']);
const { files, landed, refused } = landing(exported, have);

for (const [path, text] of Object.entries(files)) {
	// every path is made from ids that passed their patterns; this is the second look
	if (!SAFE.test(path) || path.includes('..')) throw new Error(`refusing to write ${path}`);
	mkdirSync(dirname(`${ROOT}${path}`), { recursive: true });
	writeFileSync(`${ROOT}${path}`, text);
}
for (const [file, text] of Object.entries(moduleTexts())) writeFileSync(`${ROOT}${file}`, text);

const lines = [...landed.map((l) => `- ${l}`), ...(refused.length ? ['', 'Not landed:', ...refused.map((l) => `- ${l}`)] : [])];
if (summary) writeFileSync(summary, `${lines.join('\n')}\n`);
console.log(landed.length ? `landed:\n${landed.join('\n')}` : 'nothing new to land');
if (refused.length) console.log(`not landed:\n${refused.join('\n')}`);
