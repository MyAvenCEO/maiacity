// @ts-nocheck — plain JS
// C10: code entries from the Maia City vault (game/code/sources/avendb.js), the repo's code/ as the seed. What the
// copy writes comes back as the same entry; what the vault hands out is checked and held to the engines the repo
// ships; the loader prefers what it loaded and keeps the seed for the rest.
// Run: bun test src/lib/code
import { afterEach, describe, expect, test } from 'bun:test';
import { avendb, copyOf, entryOf, feedOf, recordOf } from '../../../game/code/sources/avendb.js';
import { codeAt, codeIn, loadCode, viewOfEntry } from '../../../game/code/index.js';
import { ENTRIES } from '../../../code/index.js';
import { defaultViews } from '../../../game/maiacity-v1/views.js';
import { examples } from '../../../game/genui/examples.js';

const VAULT = 'a'.repeat(64);
const all = Object.values(ENTRIES);
/** the views and logic modules, which the copy writes (a game's settings the seed writes, src/lib/avendb/seed.js) */
const repo = all.filter((e) => e.type !== 'config');
/** the rows the vault would hand out after the copy: each create, as read back */
const rowsOf = (entries) => entries.map((e, i) => ({ entry: `e${String(i).padStart(11, '0')}`, vault: VAULT, heads: `${String(i).padStart(8, '0')}cafe`, ...recordOf(e), record: recordOf(e).value }));
const strip = ({ source, vault, entry, heads, ...e }) => e;

afterEach(() => avendb.use([], viewOfEntry));

describe('the copy', () => {
	test('every view, logic module and config of the repo comes back from the vault as the same entry, with the same hash', () => {
		expect(repo.length).toBeGreaterThan(3);
		for (const row of rowsOf(all)) {
			const { entry, error } = entryOf(row);
			expect(error).toBeUndefined();
			expect(strip(entry)).toEqual(ENTRIES[entry.ref]);
		}
	});
	test('is one batch acting as the vault: the Public share first, then a create per entry, tagged by path, game and the repo hash', () => {
		const b = copyOf(repo, VAULT);
		expect([b.op, b.as, b.ops.length]).toEqual(['batch', VAULT, repo.length + 1]);
		expect(b.ops[0]).toEqual({ op: 'share', over: VAULT, who: 'everyone', level: 'Public', what: { type: ['view', 'logic'] }, as: VAULT });
		const holders = b.ops.find((o) => o.tags?.includes('ref:views/view-holders'));
		expect(holders).toMatchObject({ op: 'create', vault: VAULT, type: 'view', schema: 'view' });
		expect(holders.tags).toEqual(['ref:views/view-holders', 'game:maiacity-v1', `legacy:${ENTRIES['views/view-holders'].hash}`]);
		expect(b.ops.find((o) => o.tags?.includes('ref:views/coop-chart')).tags.some((t) => t.startsWith('game:'))).toBe(false);
		expect(() => copyOf(repo, 'maia-city')).toThrow(/64 hex/);
	});
	test("with the server's vault, the first copy gives it a Backup share before anything else", () => {
		const SERVER = 'b'.repeat(64);
		const b = copyOf(repo, VAULT, { server: SERVER });
		expect(b.ops.slice(0, 2).map((o) => [o.op, o.who, o.level])).toEqual([['share', { vault: SERVER }, 'Backup'], ['share', 'everyone', 'Public']]);
		expect(b.ops).toHaveLength(repo.length + 2);
		expect(copyOf(repo, VAULT, { have: [], server: SERVER }).ops.every((o) => o.op === 'create')).toBe(true);
		expect(() => copyOf(repo, VAULT, { server: 'avenCEO server' })).toThrow(/64 hex/);
	});
	test('a rerun copies only the paths the vault does not hold, whatever they hold now, and shares nothing again', () => {
		const have = rowsOf(repo.slice(0, 4)).map((r, i) => (i ? r : { ...r, record: { ...r.record, title: 'changed in the vault' } }));
		const b = copyOf(repo, VAULT, { have });
		expect(b.ops.map((o) => o.op)).toEqual(repo.slice(4).map(() => 'create'));
		expect(b.ops.map((o) => o.tags[0])).toEqual(repo.slice(4).map((e) => `ref:${e.ref}`));
		expect(copyOf(repo, VAULT, { have: rowsOf(repo) }).ops).toEqual([]);
		expect(copyOf(repo, VAULT, { have: [] }).ops).toHaveLength(repo.length);
	});
});

describe('loaded entries', () => {
	const rows = rowsOf(all);
	const row = (ref) => rows.find((r) => r.tags.includes(`ref:${ref}`));
	const changed = (ref, record) => ({ ...row(ref), record: { ...row(ref).record, ...record } });

	test('the whole copy loads: every entry passes the checker as at the door', () => {
		const r = avendb.use(rows, viewOfEntry);
		expect([r.taken.length, r.refused]).toEqual([all.length, []]);
	});
	test('a loaded view is what codeAt, codeIn and the defaults read; the seed serves every other path', () => {
		const holders = changed('views/view-holders', { title: 'Holders, from the vault' });
		expect(avendb.use([holders], viewOfEntry)).toEqual({ taken: ['views/view-holders'], refused: [] });
		expect(codeAt('views/view-holders')).toMatchObject({ title: 'Holders, from the vault', source: 'avendb', vault: VAULT });
		expect(codeIn('views/').find((e) => e.ref === 'views/view-holders').title).toBe('Holders, from the vault');
		expect(defaultViews()[0].name).toBe('Holders, from the vault');
		expect(codeAt('views/coop-chart')).toBe(ENTRIES['views/coop-chart']);
		expect(examples().map((v) => v.id)).toEqual(['village-scene', 'coop-chart', 'dome-planner']);
		expect(codeIn('views/').length).toBe(Object.keys(ENTRIES).filter((k) => k.startsWith('views/')).length);
	});
	test('what the checker refuses, an engine the repo does not ship, a wrong kind or a path twice is left out, and the seed stays', () => {
		const r = avendb.use(
			[
				changed('views/view-holders', { source: '<img src="https://x.example/a.png">' }),
				changed('views/coop-chart', { engine: { host: 'view', version: 99, hash: 'f'.repeat(64) } }),
				{ ...row('views/village-scene'), type: 'logic' },
				{ ...row('views/coop-chart'), tags: ['game:maiacity-v1'] },
				row('views/dome-planner'),
				{ ...row('views/dome-planner'), entry: 'e99999999999' }
			],
			viewOfEntry
		);
		expect(r.taken).toEqual([]);
		expect(r.refused).toHaveLength(5);
		expect(r.refused.join('\n')).toMatch(/views\/view-holders: .*address/);
		expect(r.refused.join('\n')).toMatch(/views\/coop-chart: written for view engine 99, which the repo does not ship/);
		expect(r.refused.join('\n')).toMatch(/held twice/);
		expect(codeAt('views/view-holders')).toBe(ENTRIES['views/view-holders']);
	});
	test('a vault ref is served at the heads it names, and only then', () => {
		const r = row('views/village-scene');
		avendb.use([r], viewOfEntry);
		expect(codeAt(`vault:${VAULT}/${r.entry}@${r.heads}`).ref).toBe('views/village-scene');
		expect(() => codeAt(`vault:${VAULT}/${r.entry}@0000000000aa`)).toThrow(/other heads/);
	});
});

describe('loading', () => {
	const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
	test('takes what the feed hands out', async () => {
		const r = await loadCode({ url: 'https://feed.example/code', fetch: reply(200, { code: rowsOf([ENTRIES['views/view-holders']]).map((r) => ({ ...r, seed: 'Maia City' })) }) });
		expect(r).toEqual({ taken: ['views/view-holders'], refused: [] });
		expect(codeAt('views/view-holders').source).toBe('avendb');
	});
	test("a feed handing out code of a vault that is not the seed's Maia City is not taken", async () => {
		const r = await loadCode({ url: 'https://feed.example/code', fetch: reply(200, { code: rowsOf([ENTRIES['views/view-holders']]).map((r) => ({ ...r, seed: null })) }) });
		expect(r).toEqual({ error: "https://feed.example/code handed out code of a vault that is not the seed's Maia City" });
		expect(await loadCode({ url: 'https://feed.example/code', fetch: reply(200, { posts: [] }) })).toEqual({ error: 'https://feed.example/code answered no rows' });
		expect(codeAt('views/view-holders')).toBe(ENTRIES['views/view-holders']);
	});
	test('a feed handing out code of more than one vault is not taken', async () => {
		const other = { ...rowsOf([ENTRIES['views/coop-chart']])[0], vault: 'b'.repeat(64) };
		const r = await loadCode({ url: 'https://feed.example/code', fetch: reply(200, [...rowsOf([ENTRIES['views/view-holders']]), other]) });
		expect(r).toEqual({ error: 'https://feed.example/code handed out code of more than one vault' });
		expect(codeAt('views/view-holders')).toBe(ENTRIES['views/view-holders']);
	});
	test('no feed, or no network: the seed stays, and nothing throws', async () => {
		expect(await loadCode({ url: 'https://feed.example/code', fetch: reply(404, {}) })).toEqual({ error: 'https://feed.example/code answered 404' });
		expect(await loadCode({ url: 'https://feed.example/code', fetch: async () => { throw new Error('offline'); } })).toEqual({ error: 'offline' });
		expect(codeAt('views/view-holders')).toBe(ENTRIES['views/view-holders']);
	});
	test('an empty feed (a vault reset and not seeded yet): the seed runs', async () => {
		expect(await loadCode({ url: 'https://feed.example/code', fetch: reply(200, { code: [] }) })).toEqual({ taken: [], refused: [] });
		expect(codeAt('views/view-holders')).toBe(ENTRIES['views/view-holders']);
	});
	test("the live feed is read for the seed's views and logic modules; switched off, nothing is asked and the seed runs", async () => {
		expect(feedOf()).toBe('https://avendb.maia.city/feed/code?seed=1&type=view,logic,config');
		expect(feedOf('http://avendb:3351/feed/code')).toBe('http://avendb:3351/feed/code?seed=1&type=view,logic,config');
		expect(avendb.on).toBe(true);
		avendb.on = false;
		try {
			let asked = false;
			const fetch = async () => ((asked = true), { ok: true, status: 200, json: async () => ({ code: [] }) });
			expect(await loadCode({ url: 'https://feed.example/code', fetch })).toEqual({ error: 'code from avenDB is switched off' });
			expect(asked).toBe(false);
		} finally {
			avendb.on = true;
		}
	});
});

describe("a game's settings", () => {
	const rows = rowsOf(all);
	const row = (ref) => rows.find((r) => r.tags.includes(`ref:${ref}`));
	const withData = (ref, data) => ({ ...row(ref), record: { ...row(ref).record, data } });
	const seed = (ref) => JSON.parse(ENTRIES[ref].files['config.json']);
	test("a loaded config is what configAt reads; changed numbers are taken, the seed's shape is held", async () => {
		const { configAt } = await import('../../../game/code/index.js');
		const { defaultSettings, newGame } = await import('../../../game/maiacity-v1/engine.js');
		const set = { ...seed('configs/maiacity-v1/settings'), heartsPerDay: 30, swapFee: 7 };
		expect(avendb.use([withData('configs/maiacity-v1/settings', set)], viewOfEntry)).toEqual({ taken: ['configs/maiacity-v1/settings'], refused: [] });
		expect(configAt('configs/maiacity-v1/settings').heartsPerDay).toBe(30);
		// a value the game's limits refuse is the seed's
		expect(defaultSettings()).toMatchObject({ heartsPerDay: 30, swapFee: seed('configs/maiacity-v1/settings').swapFee });
		expect(newGame(0).settings.heartsPerDay).toBe(30);
	});
	test('a config missing a key the game reads, or of another kind there, or with no seed, is left out', () => {
		const { hexSubRent, ...short } = seed('configs/maiacity-v1/settings');
		const garden = seed('configs/sandbox-4/garden');
		const r = avendb.use(
			[
				withData('configs/maiacity-v1/settings', short),
				withData('configs/sandbox-4/garden', { ...garden, fields: [{ ...garden.fields[0], size: '4x6' }] }),
				{ ...row('configs/sandbox-4/garden'), tags: ['ref:configs/sandbox-4/elsewhere', 'game:sandbox-4'] }
			],
			viewOfEntry
		);
		expect(r.taken).toEqual([]);
		expect(r.refused.join('\n')).toMatch(/settings: the config has no hexSubRent/);
		expect(r.refused.join('\n')).toMatch(/garden: the config holds a string at fields\[0\]\.size, where the game reads a list/);
		expect(r.refused.join('\n')).toMatch(/elsewhere: a config the repo holds no seed of/);
	});
	test("a plant's weight may be left out, as the seed leaves it out of some", () => {
		const garden = seed('configs/sandbox-4/garden');
		const { weight, ...plain } = garden.outside.canopy[0];
		const r = avendb.use([withData('configs/sandbox-4/garden', { ...garden, outside: { ...garden.outside, canopy: [plain] } })], viewOfEntry);
		expect(r.refused).toEqual([]);
	});
});
