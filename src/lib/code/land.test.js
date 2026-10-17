// @ts-nocheck — plain JS
// C4: what a decision writes into code/ (game/code/land.js): an agent's Generated UI view the admin kept. The landing
// job runs the same function on what the database says waits to land.
// Run: bun test src/lib/code
import { describe, expect, test } from 'bun:test';
import { landing } from '../../../game/code/land.js';
import { entriesOfFiles } from '../../../game/code/files.js';
import { codeIn, viewOfEntry } from '../../../game/code/index.js';
import { ENTRIES } from '../../../code/index.js';
import { checkCode } from '../../../game/code/check.js';
import { examples } from '../../../game/genui/examples.js';

/** what landing wrote, as the entries the index would make of it, on top of `have` */
const land = (exported, have = {}) => {
	const r = landing(exported, have);
	return { ...r, have: { ...have, ...entriesOfFiles(r.files) } };
};

test('the Generated UI examples land as the entries they already are: nothing to write', () => {
	const { files, landed, refused } = landing({ views: examples() }, ENTRIES);
	expect([files, landed, refused]).toEqual([{}, [], []]);
});

describe('Generated UI views', () => {
	const view = (more) => ({ id: 'harvest', title: 'Harvest', note: 'per month', kind: 'html', spec: { html: '<maia-chart kind="bars" items=\'[{"label":"Jan","value":3}]\'></maia-chart>', libs: [], height: 300, data: { year: 3 } }, ...more });

	test('a kept view lands as a view entry that draws the same', () => {
		const { files, landed, have } = land({ views: [view()] }, ENTRIES);
		expect(landed).toEqual(['View harvest “Harvest” (Generated UI)']);
		expect(Object.keys(files).sort()).toEqual(['views/harvest/data.json', 'views/harvest/entry.json', 'views/harvest/view.html']);
		expect(viewOfEntry(have['views/harvest'])).toEqual(checkCode('view', view()).value);
		expect(landing({ views: [view()] }, have).files).toEqual({});
		expect(land({ views: [view({ title: 'Harvests' })] }, have).landed).toEqual(['View harvest “Harvests” (Generated UI), changed']);
	});

	test("a view the checker refuses, or one with a game screen's id, stays a draft", () => {
		const { files, refused } = landing(
			{
				views: [
					view({ spec: { html: '<img src="https://x.example/a.png">', libs: [] } }),
					view({ id: 'note-fetch', spec: { html: '<script>fetch("/x")</script>', libs: [] } }),
					view({ id: 'view-holders' }),
					view({ id: '../x' })
				]
			},
			ENTRIES
		);
		expect(files).toEqual({});
		expect(refused).toHaveLength(4);
		expect(refused[2]).toBe("view view-holders: that id is maiacity-v1's screen");
	});

	test('only Generated UI views are written: the screens of the games stay as they are', () => {
		expect(codeIn('views/').filter((e) => e.for === 'genui').map((e) => e.ref.slice(6))).toEqual(['coop-chart', 'dome-planner', 'village-scene']);
	});
});

test('a view the database hands back with its keys in another order is the same view: nothing to write', () => {
	const flip = (o) => (Array.isArray(o) ? o.map(flip) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, flip(v)])) : o);
	expect(landing({ views: examples().map(flip) }, ENTRIES).files).toEqual({});
});
