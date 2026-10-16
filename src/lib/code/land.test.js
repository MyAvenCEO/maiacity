// @ts-nocheck — plain JS
// C4: what a decision writes into code/ (game/code/land.js) and how it is read back (game/code/files.js,
// game/code/decided.js). The landing job runs the same function on what the database says waits to land.
// Run: bun test src/lib/code
import { afterAll, describe, expect, test } from 'bun:test';
import { landing } from '../../../game/code/land.js';
import { cardsOfFiles, cardsToFiles, entriesOfFiles } from '../../../game/code/files.js';
import { configIds, configVersions, landedMip, useDecided } from '../../../game/code/decided.js';
import { codeIn, viewOfEntry } from '../../../game/code/index.js';
import { ENTRIES } from '../../../code/index.js';
import { checkCode } from '../../../game/code/check.js';
import { applyCards, defaultCards } from '../../../game/economy/params.js';
import { EXAMPLES } from '../../../game/genui/examples.js';

afterAll(() => useDecided());

const hearts = () => defaultCards().find((c) => c.id === 'hearts');
const at = '2026-10-16T12:00:00.000Z';
/** a database export's config versions: the valley at v1 and v2, a dry valley made and then deleted */
const FIRST = {
	versions: [
		{ config: 'valley', version: 1, body: { name: 'The valley', description: '', cards: defaultCards().map((c) => ({ ...c, code: '' })) }, mip: null, at },
		{ config: 'valley', version: 2, body: { name: 'The valley', description: 'more mint', cards: applyCards(defaultCards().map((c) => ({ ...c, code: '' })), [{ ...hearts(), values: { mint: 30 }, code: 'export function mint({ value }) { return value + 6; }' }]) }, mip: 3, at },
		{ config: 'dry-valley', version: 1, body: { name: 'Dry', description: '', cards: [] }, mip: 4, at }
	],
	configs: [{ id: 'valley', deleted: null }, { id: 'dry-valley', deleted: at }]
};
/** what landing wrote, as the entries the index would make of it, on top of `have` */
const land = (exported, have = {}) => {
	const r = landing(exported, have);
	return { ...r, have: { ...have, ...entriesOfFiles(r.files) } };
};

describe('files', () => {
	test('cards keep their code in files of their own and come back the same', () => {
		const cards = [...defaultCards(), { id: 'screen', kind: 'view', name: 'Screen', description: '', values: {}, data: { slot: 'board', libs: [], height: 300 }, code: '<p>{{day}}</p>' }];
		const files = cardsToFiles(cards);
		expect(files['hearts.js']).toBe(hearts().code);
		expect(files['screen.html']).toBe('<p>{{day}}</p>');
		expect(JSON.parse(files['cards.json']).find((c) => c.id === 'hearts')).toEqual(expect.objectContaining({ file: 'hearts.js' }));
		expect(JSON.parse(files['cards.json']).find((c) => c.id === 'hearts').code).toBeUndefined();
		expect(cardsOfFiles(files)).toEqual(cards);
	});
	test('the Generated UI examples land as the entries they already are: nothing to write', () => {
		const { files, landed, refused } = landing({ views: EXAMPLES }, ENTRIES);
		expect([files, landed, refused]).toEqual([{}, [], []]);
	});
});

describe('the first export', () => {
	test('every config version the database kept, and one more for a config it deleted', () => {
		const { files, landed, refused, have } = land(FIRST);
		expect(refused).toEqual([]);
		expect(landed).toEqual(['Config dry-valley: versions 1, 2 from the database', 'Config valley: versions 1, 2 from the database']);
		expect(files['configs/sandbox-7/valley/v2/hearts.js']).toContain('return value + 6');
		useDecided(have);
		expect(configIds('sandbox-7')).toEqual(['dry-valley', 'valley']);
		const [v2, v1] = configVersions('sandbox-7', 'valley');
		expect([v2.version, v2.mip, v2.description, v1.version]).toEqual([2, 3, 'more mint', 1]);
		expect(v2.cards.find((c) => c.id === 'hearts').values.mint).toBe(30);
		expect(configVersions('sandbox-7', 'dry-valley')[0]).toEqual(expect.objectContaining({ version: 2, deleted: true, mip: null }));
		// run again on what it wrote: nothing new
		expect(landing(FIRST, have).files).toEqual({});
	});
});

describe('accepted MIPs', () => {
	const base = land(FIRST).have;
	const mip = (n, more) => ({ number: n, title: `MIP ${n}`, config: 'valley', cards: [], remove: [], decided: at, ...more });

	test('an edit lands as the MIP and the config version it makes', () => {
		const card = { ...hearts(), values: { mint: 40 }, code: 'export function mint({ value }) { return value + 9; }' };
		const { files, landed, have } = land({ mips: [mip(7, { action: 'edit', cards: [card], about: 'even more' })] }, base);
		expect(landed).toEqual(['MIP 7 “MIP 7”: config valley version 3']);
		expect(files['mips/sandbox-7/7/hearts.js']).toContain('value + 9');
		useDecided(have);
		const m = landedMip('sandbox-7', 7);
		expect([m.action, m.config, m.cards[0].values.mint, m.accepted]).toEqual(['edit', 'valley', 40, at]);
		const [v3] = configVersions('sandbox-7', 'valley');
		expect([v3.version, v3.mip, v3.description, v3.cards.find((c) => c.id === 'hearts').code]).toEqual([3, 7, 'even more', card.code]);
		// a MIP already in code/ is never written again, so a second job changes nothing
		expect(landing({ mips: [mip(7, { action: 'edit', cards: [card] })] }, have).files).toEqual({});
	});

	test('MIPs land in their order: a config made, then edited, then deleted', () => {
		const { landed, refused, have } = land(
			{
				mips: [
					mip(12, { action: 'delete', config: 'wet-valley' }),
					mip(10, { action: 'create', config: 'wet-valley', from: 'valley', name: 'Wet' }),
					mip(11, { action: 'edit', config: 'wet-valley', remove: ['weather'] })
				]
			},
			base
		);
		expect(refused).toEqual([]);
		expect(landed.map((l) => l.replace(/ “.*”/, ''))).toEqual(['MIP 10: config wet-valley version 1', 'MIP 11: config wet-valley version 2', 'MIP 12: config wet-valley deleted']);
		useDecided(have);
		const [v3, v2, v1] = configVersions('sandbox-7', 'wet-valley');
		expect([v1.name, v1.cards.length, v2.cards.some((c) => c.id === 'weather'), v3.deleted]).toEqual(['Wet', 10, false, true]);
	});

	test('a world and an amend land as their MIP only: the API makes the world from it', () => {
		const card = { ...hearts(), values: { mint: 20 } };
		const { files, landed } = land(
			{
				mips: [
					mip(20, { action: 'world', cards: [card], world_id: 'w-1', world: { name: 'World 38', values: { mint: 22 }, model: 'd1', seed: 7, after: 'w-1' } }),
					mip(21, { action: 'amend', cards: [card], world_id: 'w-1' })
				]
			},
			base
		);
		expect(landed).toEqual(['MIP 20 “MIP 20”: a new world, World 38', "MIP 21 “MIP 21”: amends a world's rules"]);
		expect(Object.keys(files).filter((p) => p.startsWith('configs/'))).toEqual([]);
		expect(JSON.parse(files['mips/sandbox-7/20/entry.json']).world).toEqual({ name: 'World 38', values: { mint: 22 }, model: 'd1', seed: 7, after: 'w-1' });
	});

	test('what could never run, or never be a path, is refused and writes nothing', () => {
		const { files, refused } = landing(
			{
				mips: [
					mip(30, { action: 'edit', cards: [{ ...hearts(), code: "import x from 'https://cdn.example/x.js'; export function mint() { return 1; }" }] }),
					mip(31, { action: 'edit', config: '../../.github' }),
					mip(32, { action: 'edit', config: 'nowhere', cards: [hearts()] }),
					mip(33, { action: 'spell' }),
					{ number: 'x', action: 'edit', config: 'valley' }
				],
				versions: [{ config: '../x', version: 1, body: { cards: [] } }]
			},
			base
		);
		expect(files).toEqual({});
		expect(refused).toHaveLength(6);
		expect(refused.join('\n')).toMatch(/MIP 30: card hearts's code/);
		expect(refused.join('\n')).toMatch(/MIP 32: no config nowhere/);
	});
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
					view({ id: 'view-wants' }),
					view({ id: '../x' })
				]
			},
			ENTRIES
		);
		expect(files).toEqual({});
		expect(refused).toHaveLength(4);
		expect(refused[2]).toBe("view view-wants: that id is sandbox-7's screen");
	});

	test('only Generated UI views are written: the screens of the games stay as they are', () => {
		expect(codeIn('views/').filter((e) => e.for === 'genui').map((e) => e.ref.slice(6))).toEqual(['coop-chart', 'dome-planner', 'village-scene']);
	});
});
