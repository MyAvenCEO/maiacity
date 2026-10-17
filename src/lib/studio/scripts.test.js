// @ts-nocheck — plain JS
// Scripts in avenDB (./scripts.js): made from an article, behind once it moves on, and brought up to it.
// Run: bun test src/lib/studio/scripts.test.js
import { expect, test } from 'bun:test';
import { behindOf, draftFrom, likeness, partsOf, pinOf, SCRIPT_V1, spokenSeconds, takingOps } from './scripts.js';

const story = /** @type {any} */ ({ entry: 's1', vault: 'V', record: { title: 'Trailer', beats: [{ id: 7, title: 'Hook' }, { id: 8, title: 'The turn' }] } });
const ARTICLE = `*Can one village feed itself?*

Intro words before any heading.

## Hook

We arrived with two jerrycans and a van.

![the van at dawn](${'a'.repeat(64)}.jpg)

## The turn

The first seedlings came up in the rain.

The village counted them twice.
`;
const article = /** @type {any} */ ({ entry: 'a1', vault: 'V', title: 'Day 1', text: ARTICLE, record: { language: 'en' } });

test('the schema parses as JSON and names its enums', () => {
	const s = JSON.parse(SCRIPT_V1);
	expect(s.title).toBe('Script, v1');
	expect(s.properties.scenes.items.properties.shots.items.properties.size.enum).toContain('cu');
});

test('an article parts into headings, pictures and words, past its subtitle', () => {
	const kinds = partsOf(ARTICLE).map((p) => p.kind);
	expect(kinds).toEqual(['words', 'heading', 'words', 'picture', 'heading', 'words', 'words']);
});

test('the first script has a scene per heading, each on its beat, lines quoting and shots for pictures', () => {
	const d = draftFrom(story, article, 100);
	expect(d.scenes.map((s) => s.name)).toEqual(['Opening', 'Hook', 'The turn']);
	expect(d.scenes.map((s) => s.beat)).toEqual([undefined, 7, 8]);
	expect(d.scenes[1].lines?.[0]).toEqual({ id: 1, who: 'voice', text: 'We arrived with two jerrycans and a van.', quote: 'We arrived with two jerrycans and a van.' });
	expect(d.scenes[1].shots?.[0]).toMatchObject({ shows: 'the van at dawn', line: 1, size: 'ws' });
	expect([d.article, d.pinned, d.story]).toEqual(['a1', pinOf(ARTICLE), { vault: 'V', entry: 's1' }]);
	expect(behindOf(d, ARTICLE).behind).toBe(false);
	expect(spokenSeconds(d)).toBeGreaterThan(0);
});

test('a changed article: the script is behind, takes the new words where unedited, and adds new paragraphs in place', () => {
	const d = /** @type {any} */ (draftFrom(story, article, 100));
	// the person rewrote one line for the screen
	d.scenes[2].lines[1].text = 'They counted twice.';
	const moved = ARTICLE.replace('came up in the rain', 'came up in the cold rain')
		.replace('The village counted them twice.', 'The whole village counted them twice.')
		.replace('## The turn', 'A new paragraph after the van.\n\n## The turn');
	const b = behindOf(d, moved);
	expect(b.behind).toBe(true);
	expect(b.changed.map((c) => c.now)).toEqual(['The first seedlings came up in the cold rain.', 'The whole village counted them twice.']);
	expect(b.added).toEqual([{ text: 'A new paragraph after the van.', after: { scene: 2, line: 1 } }]);
	const ops = takingOps('e1', d, moved);
	const paths = ops.map((o) => [o.op, JSON.stringify(o.path).replaceAll('"', ''), o.value]);
	// the unedited line takes the words; the rewritten one keeps its own and quotes the new
	expect(paths).toContainEqual(['set', '[scenes,{id:3},lines,{id:1},text]', 'The first seedlings came up in the cold rain.']);
	expect(paths.filter((p) => p[1] === '[scenes,{id:3},lines,{id:2},text]')).toEqual([]);
	expect(paths).toContainEqual(['set', '[scenes,{id:3},lines,{id:2},quote]', 'The whole village counted them twice.']);
	expect(ops.find((o) => o.op === 'insert')).toMatchObject({ path: ['scenes', { id: 2 }, 'lines'], value: { id: 2, text: 'A new paragraph after the van.' } });
	expect(ops.at(-1)).toEqual({ op: 'set', entry: 'e1', path: ['pinned'], value: pinOf(moved) });
});

test('a paragraph taken out leaves its line, quoting nothing; a line in the middle is moved into place', () => {
	const d = /** @type {any} */ (draftFrom(story, article, 100));
	const gone = ARTICLE.replace('\nThe first seedlings came up in the rain.\n', '\nSomething else entirely, about weather and goats and soil.\n');
	const ops = takingOps('e1', d, gone);
	expect(ops).toContainEqual({ op: 'unset', entry: 'e1', path: ['scenes', { id: 3 }, 'lines', { id: 1 }, 'quote'] });
	const ins = ops.find((o) => o.op === 'insert');
	expect(ins.path).toEqual(['scenes', { id: 2 }, 'lines']);
	expect(likeness('a b c', 'a b d')).toBeCloseTo(0.5);
	const mid = ARTICLE.replace('The village counted', 'A middle line.\n\nThe village counted');
	const mops = takingOps('e1', d, mid);
	expect(mops.find((o) => o.op === 'move')).toEqual({ op: 'move', entry: 'e1', path: ['scenes', { id: 3 }, 'lines', { id: 3 }], to: 1 });
});
