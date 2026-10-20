// @ts-nocheck — plain JS
// C4: the repo's code entries (code/) are the one source the pages and the API read code from: code/index.js is what
// its files make, every entry passes the one checker, refs are read strictly (a pinned hash must match; avenDB refs are
// read and refused until that source is switched on), and the games' defaults come from these entries.
// Run: bun test src/lib/code
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { moduleTexts } from '../../../scripts/code-index.mjs';
import { ENTRIES } from '../../../code/index.js';
import { cardOfEntry, codeAt, codeIn, parseCodeRef, viewOfEntry } from '../../../game/code/index.js';
import { checkCode } from '../../../game/code/check.js';
import { SLOTS } from '../../../game/maiacity-v1/views.js';
import { examples } from '../../../game/code/examples.js';

const ROOT = new URL('../../../', import.meta.url).pathname;

describe('code/', () => {
	test('code/index.js is what the files make (else: node scripts/code-index.mjs)', () => {
		for (const [file, text] of Object.entries(moduleTexts())) expect([file, readFileSync(`${ROOT}code/${file}`, 'utf8') === text]).toEqual([file, true]);
	});
	test('every entry passes the one checker, with nothing it holds left doing nothing', () => {
		for (const e of Object.values(ENTRIES)) {
			const r =
				e.type === 'config'
					? checkCode('config', JSON.parse(e.files['config.json']), { seed: JSON.parse(e.files['config.json']) })
					: e.type === 'logic'
					? checkCode('logic', { code: e.files['logic.js'], hooks: e.hooks })
					: e.for === 'genui'
						? checkCode('view', viewOfEntry(e))
						: checkCode('view-card', cardOfEntry(e), { slots: SLOTS });
			expect([e.ref, r.ok, r.ok ? r.notes : r.errors]).toEqual([e.ref, true, []]);
		}
	});
});

describe('one loader', () => {
	const e = codeAt('views/village-scene');
	test('a ref pinned to its hash, and one pinned to another', () => {
		expect(codeAt(`views/village-scene@${e.hash.slice(0, 12)}`)).toBe(e);
		expect(() => codeAt('views/village-scene@000000000000')).toThrow(/not 000000000000/);
	});
	test('no entry, no way out', () => {
		expect(() => codeAt('views/nothing-here')).toThrow(/no code entry/);
		for (const bad of ['views/../game/x', '/etc/passwd', 'views/village-scene/../../x', 'https://cdn.example/x', 'views/Village']) expect(() => codeAt(bad)).toThrow(/no code ref/);
	});
	test('avenDB refs are read, and refused while that entry is not loaded (src/lib/code/vault.test.js loads some)', () => {
		const [v, e, h1, h2] = ['ab', 'cd', 'ef', '01'].map((x) => x.repeat(32));
		const ref = `vault:${v}/${e}@${h2},${h1}`;
		expect(parseCodeRef(ref)).toEqual({ source: 'avendb', vault: v, entry: e, heads: [h2, h1] });
		expect(() => codeAt(ref)).toThrow(/is not loaded/);
	});
	test('an avenDB ref names avenDB ids alone, 64 hex digits each, and a code entry takes no values', () => {
		const [v, e, h] = ['ab', 'cd', 'ef'].map((x) => x.repeat(32));
		for (const bad of [
			'vault:ab12cd34ef56gh78/entry0001abcd@0123456789abcdef', // ids looser than avenDB's
			`vault:${v}/${e}@${h.slice(2)}`, // a head too short
			`vault:${v.toUpperCase()}/${e}@${h}`, // not as avenDB writes them
			`vault:${v}/${e}@${Array(17).fill(h).join(',')}`, // more heads than a version has
			`vault:${v}/${e}@${h}?stage=9`, // values, which no code entry takes
			`vault:${v}/../${e}@${h}`
		])
			expect(() => parseCodeRef(bad)).toThrow(/no code ref/);
	});
	test("the games' defaults come from code/", () => {
		expect(examples().map((v) => v.id)).toEqual(['village-scene', 'coop-chart', 'dome-planner']);
		expect(examples()[0].spec.html).toBe(e.files['view.html']);
	});
});
