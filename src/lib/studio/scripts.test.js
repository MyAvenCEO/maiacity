// @ts-nocheck — plain JS
// Scripts in avenDB (./scripts.js): drawn from the story's beats, adapted from its article, behind once either moves
// on, brought up to them, and made into a first cut.
// Run: bun test src/lib/studio/scripts.test.js
import { expect, test } from 'bun:test';
import {
	adaptOps,
	articleBehindOf,
	articleTakingOps,
	beatsPin,
	cutFrom,
	cutsOf,
	draftFrom,
	likeness,
	partsOf,
	pinOf,
	SCRIPT_V2,
	spokenSeconds,
	storyBehindOf,
	storyTakingOps
} from './scripts.js';

const BEATS = [
	{ id: 7, title: 'Hook', type: 'hook', text: 'Two jerrycans, one van.' },
	{ id: 8, title: '', type: 'turn', text: 'The seedlings come up.' }
];
const story = { entry: 's1', vault: 'V', title: 'Trailer', record: { title: 'Trailer', beats: BEATS } };
const label = (t) => ({ hook: 'Hook', turn: 'The turn' })[t] ?? t;
const ARTICLE = `*Can one village feed itself?*

Intro words before any heading.

## Hook

We arrived with two jerrycans and a van.

![the van at dawn](${'a'.repeat(64)}.jpg)

## The turn

The first seedlings came up in the rain.

The village counted them twice.
`;
const article = { entry: 'a1', vault: 'V', title: 'Day 1', text: ARTICLE, record: { language: 'en' } };

/** Script record `s` with ops `ops` applied, as the engine would (enough of it for these tests). */
function apply(s, ops) {
	const r = structuredClone(s);
	const at = (path) => {
		let node = r;
		for (const p of path) node = typeof p === 'object' ? node.find((x) => x.id === p.id) : node[p];
		return node;
	};
	for (const o of ops) {
		const parent = at(o.path.slice(0, -1));
		const last = o.path.at(-1);
		if (o.op === 'set') parent[last] = o.value;
		else if (o.op === 'unset') delete parent[last];
		else if (o.op === 'insert') at(o.path).push(o.value);
		else if (o.op === 'move') {
			const list = parent;
			const k = list.findIndex((x) => x.id === last.id);
			const [row] = list.splice(k, 1);
			list.splice(o.to, 0, row);
		}
	}
	return r;
}

test('the schema parses as JSON, links its story and names its enums', () => {
	const s = JSON.parse(SCRIPT_V2);
	expect(s.title).toBe('Script, v2');
	expect(s.properties.story).toEqual({ 'x-link': 'newest' });
	expect(s.required).toContain('story');
	expect(s.properties.scenes.items.properties.shots.items.properties.size.enum).toContain('cu');
});

test('the first script is drawn from the story: a scene per beat, saying what happens, pinned at the beats', () => {
	const d = draftFrom(story, 100, label);
	expect(d.scenes.map((s) => [s.name, s.beat, s.action, s.told])).toEqual([
		['Hook', 7, 'Two jerrycans, one van.', 'Two jerrycans, one van.'],
		['The turn', 8, 'The seedlings come up.', 'The seedlings come up.']
	]);
	expect([d.story, d.pinned, d.from]).toEqual([{ vault: 'V', entry: 's1' }, beatsPin(BEATS), undefined]);
	expect(storyBehindOf(d, BEATS).behind).toBe(false);
	expect(draftFrom({ ...story, record: {} }, 1).scenes.map((s) => s.name)).toEqual(['Opening']);
});

test('the story moved on: changed words where unedited, a new beat in place, a gone beat unlinked', () => {
	const d = draftFrom(story, 100, label);
	d.scenes[1].action = 'The seedlings come up, slowly.';
	const moved = [
		{ id: 7, title: 'Hook', type: 'hook', text: 'Two jerrycans, one old van.' },
		{ id: 9, title: 'Low', type: 'low', text: 'Frost.' },
		{ id: 10, title: 'Still low', type: 'low', text: 'More frost.' }
	];
	const b = storyBehindOf(d, moved);
	expect(b.changed.map((c) => c.now)).toEqual(['Two jerrycans, one old van.']);
	expect(b.added.map((a) => [a.beat.id, a.after])).toEqual([[9, 1], [10, 1]]);
	expect(b.gone.map((g) => g.scene.id)).toEqual([2]);
	const after = apply(d, storyTakingOps('e1', d, moved, label));
	expect(after.scenes.map((s) => [s.id, s.beat, s.name])).toEqual([[1, 7, 'Hook'], [3, 9, 'Low'], [4, 10, 'Still low'], [2, undefined, 'The turn']]);
	expect(after.scenes[0].action).toBe('Two jerrycans, one old van.');
	expect(after.scenes[3].action).toBe('The seedlings come up, slowly.');
	expect(storyBehindOf(after, moved).behind).toBe(false);
});

test('an article parts into headings, pictures and words, past its subtitle', () => {
	expect(partsOf(ARTICLE).map((p) => p.kind)).toEqual(['words', 'heading', 'words', 'picture', 'heading', 'words', 'words']);
});

test('adapted from the article: its paragraphs as lines in the scene its heading names, pictures as shots', () => {
	const d = draftFrom(story, 100, label);
	const s = apply(d, adaptOps('e1', d, article, BEATS));
	expect(s.scenes.map((x) => x.name)).toEqual(['Hook', 'The turn']);
	// the words before any heading open the first scene
	expect(s.scenes[0].lines.map((l) => l.text)).toEqual(['Intro words before any heading.', 'We arrived with two jerrycans and a van.']);
	expect(s.scenes[0].shots[0]).toMatchObject({ shows: 'the van at dawn', line: 2, size: 'ws' });
	expect(s.scenes[1].lines.map((l) => l.quote)).toEqual(['The first seedlings came up in the rain.', 'The village counted them twice.']);
	expect([s.from, s.fromPinned]).toEqual([{ vault: 'V', entry: 'a1' }, pinOf(ARTICLE)]);
	expect(articleBehindOf(s, ARTICLE).behind).toBe(false);
	expect(articleBehindOf(d, 'anything').behind).toBe(false);
	expect(spokenSeconds(s)).toBeGreaterThan(0);
	// a heading no scene answers opens one at the end
	const odd = apply(d, adaptOps('e1', d, { ...article, text: '## Elsewhere\n\nWords.' }, BEATS));
	expect(odd.scenes.map((x) => [x.id, x.name])).toEqual([[1, 'Hook'], [2, 'The turn'], [3, 'Elsewhere']]);
});

test('the article moved on: the adapted lines take its change, a new paragraph comes in place', () => {
	const d = draftFrom(story, 100, label);
	const s = apply(d, adaptOps('e1', d, article, BEATS));
	s.scenes[1].lines[1].text = 'They counted twice.';
	const moved = ARTICLE.replace('came up in the rain', 'came up in the cold rain')
		.replace('The village counted them twice.', 'The whole village counted them twice.')
		.replace('## The turn', 'A new paragraph after the van.\n\n## The turn');
	const b = articleBehindOf(s, moved);
	expect(b.changed.map((c) => c.now)).toEqual(['The first seedlings came up in the cold rain.', 'The whole village counted them twice.']);
	const ops = articleTakingOps('e1', s, moved);
	const t = apply(s, ops);
	expect(t.scenes[1].lines.map((l) => l.text)).toEqual(['The first seedlings came up in the cold rain.', 'They counted twice.']);
	expect(t.scenes[0].lines.at(-1).text).toBe('A new paragraph after the van.');
	expect(ops.at(-1)).toEqual({ op: 'set', entry: 'e1', path: ['fromPinned'], value: pinOf(moved) });
	expect(likeness('a b c', 'a b d')).toBeCloseTo(0.5);
});

test('a cut from the script: a slate per shot, its lines under it, timed to be said; the cut names script and story', () => {
	const d = draftFrom(story, 100, label);
	const s = apply(d, adaptOps('e1', d, article, BEATS));
	s.scenes[0].shots.push({ id: 2, size: 'cu', angle: 'low', move: 'push', shows: 'hands on the jerrycan' });
	const c = cutFrom(s, 'V', 'e1');
	expect([c.name, c.script, c.story]).toEqual(['Trailer · cut', { vault: 'V', entry: 'e1' }, { vault: 'V', entry: 's1' }]);
	const slates = c.clips.filter((x) => x.kind === 'slate');
	expect(slates.map((x) => [x.script.scene, x.script.label, x.script.description, x.script.size ?? null, x.script.notes ?? null])).toEqual([
		['Hook', '1.1', 'the van at dawn', 'WS', null],
		['Hook', '1.2', 'hands on the jerrycan', 'CU', 'Low angle, Push in'],
		['The turn', '2', 'The seedlings come up.', null, null]
	]);
	// both lines of the first scene are said under its first shot (the second covers none); slates end to end
	const lines = c.clips.filter((x) => x.kind === 'line');
	expect(lines.length).toBe(4);
	expect(lines[1].start + lines[1].dur).toBeLessThanOrEqual(slates[0].start + slates[0].dur);
	expect(slates[1].start).toBe(slates[0].start + slates[0].dur);
	expect(slates[1].dur).toBe(3);
	for (const l of lines) expect(l.dur).toBeGreaterThanOrEqual(1.5);
	const world = { entries: [{ entry: 'c1', type: 'cut', created: 5, record: { name: c.name, timeline: JSON.stringify({ clips: c.clips, script: c.script, story: c.story }) } }, { entry: 'c2', type: 'cut', record: { timeline: '{}' } }] };
	expect(cutsOf(world, 's1')).toEqual([{ entry: 'c1', name: 'Trailer · cut', script: 'e1', clips: c.clips.length }]);
});
