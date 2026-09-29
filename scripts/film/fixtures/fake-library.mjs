// A stand-in library/ for testing without the real one: fake word timings for every voice take a shot list cues on,
// so scripts/film/day-19-d.mjs (and anything built on it) can be loaded anywhere. Never used for a real film.
//
//   node scripts/film/fixtures/fake-library.mjs <dir> [scripts/film/day-19-d.mjs]
//   LIBRARY=<dir> node …   — then day-19-d.mjs times its shots on these words
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dir, list = 'scripts/film/day-19-d.mjs'] = process.argv.slice(2);
if (!dir) throw new Error('usage: node scripts/film/fixtures/fake-library.mjs <dir> [shot list]');
const src = readFileSync(resolve(list), 'utf8');
// the takes, in order, and every phrase a shot cues on, by line
const cids = [...src.matchAll(/\{ take: '[^']+', cid: '([a-z0-9]+)'/g)].map((m) => m[1]);
/** @type {string[][]} */
const phrases = cids.map(() => []);
for (const m of src.matchAll(/cue: \[(\d+), '([^']+)'\]/g)) phrases[Number(m[1])].push(m[2]);
mkdirSync(dir, { recursive: true });
for (const [i, cid] of cids.entries()) {
	// the line: a few words, then each cued phrase, a word every 0.35 s
	const text = ['so', 'it', 'begins', ...phrases[i].flatMap((p) => [...p.split(/\s+/), 'and', 'then']), 'the', 'end'];
	const words = text.map((word, k) => ({ word, start: 0.2 + k * 0.35, end: 0.2 + k * 0.35 + 0.3 }));
	writeFileSync(join(dir, `${cid}.json`), JSON.stringify({ cid, title: `fake take ${i}`, meta: { words } }));
}
console.log(`${cids.length} fake takes in ${dir}`);
