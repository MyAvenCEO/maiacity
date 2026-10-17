// @ts-nocheck — plain JS
// C4: the repo's code entries (code/) are the one source the pages and the API read code from: code/index.js is what
// its files make, every entry passes the one checker, refs are read strictly (a pinned hash must match; avenDB refs are
// read and refused until that source is switched on), and the games' defaults come from these entries.
// Run: bun test src/lib/code
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { moduleTexts } from '../../../scripts/code-index.mjs';
import { ENTRIES } from '../../../code/index.js';
import { DECIDED } from '../../../code/decided.js';
import { cardsOfFiles } from '../../../game/code/files.js';
import { cardOfEntry, codeAt, codeIn, parseCodeRef, viewOfEntry } from '../../../game/code/index.js';
import { checkCode } from '../../../game/code/check.js';
import { SLOTS } from '../../../game/maiacity-v1/views.js';
import { SLOTS as VALLEY_SLOTS } from '../../../game/economy/views.js';
import { HOOKS, SECTIONS, defaultCards } from '../../../game/economy/params.js';
import { EXAMPLES } from '../../../game/genui/examples.js';

const ROOT = new URL('../../../', import.meta.url).pathname;

describe('code/', () => {
	test('code/index.js and code/decided.js are what the files make (else: node scripts/code-index.mjs)', () => {
		for (const [file, text] of Object.entries(moduleTexts())) expect([file, readFileSync(`${ROOT}code/${file}`, 'utf8') === text]).toEqual([file, true]);
	});
	test('every decided config version and landed MIP holds cards the one checker reads', () => {
		for (const e of Object.values(DECIDED)) {
			expect([e.ref, e.type, e.for]).toEqual([e.ref, expect.stringMatching(/^(config|mip)$/), 'sandbox-7']);
			for (const c of cardsOfFiles(e.files)) {
				const r = checkCode('rule-card', c, { mode: 'read' });
				expect([e.ref, c.id, r.ok]).toEqual([e.ref, c.id, true]);
			}
		}
	});
	test('every entry passes the one checker, with nothing it holds left doing nothing', () => {
		for (const e of Object.values(ENTRIES)) {
			const r =
				e.type === 'logic'
					? checkCode('logic', { code: e.files['logic.js'], hooks: e.hooks })
					: e.for === 'genui'
						? checkCode('view', viewOfEntry(e))
						: checkCode('view-card', cardOfEntry(e), { slots: e.for === 'maiacity-v1' ? SLOTS : VALLEY_SLOTS });
			expect([e.ref, r.ok, r.ok ? r.notes : r.errors]).toEqual([e.ref, true, []]);
		}
	});
	test("each Sandbox 7 rule entry names its card's hooks", () => {
		for (const e of codeIn('logic/sandbox-7/')) expect(e.hooks).toEqual(HOOKS.filter((h) => h.card === e.card).map((h) => h.name));
		expect(codeIn('logic/sandbox-7/').map((e) => e.card).sort()).toEqual(SECTIONS.map((s) => s.id).filter((id) => ENTRIES[`logic/sandbox-7/${id}`]).sort());
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
	test('avenDB refs are read, and refused until that source is switched on', () => {
		const ref = 'vault:ab12cd34ef56gh78/entry0001abcd@0123456789abcdef';
		expect(parseCodeRef(ref)).toEqual({ source: 'avendb', vault: 'ab12cd34ef56gh78', entry: 'entry0001abcd', heads: '0123456789abcdef' });
		expect(() => codeAt(ref)).toThrow(/not switched on yet/);
	});
	test("the games' defaults come from code/", () => {
		expect(EXAMPLES.map((v) => v.id)).toEqual(['village-scene', 'coop-chart', 'dome-planner']);
		expect(EXAMPLES[0].spec.html).toBe(e.files['view.html']);
		for (const c of defaultCards()) if (ENTRIES[`logic/sandbox-7/${c.id}`]) expect(c.code).toBe(codeAt(`logic/sandbox-7/${c.id}`).files['logic.js']);
	});
});
