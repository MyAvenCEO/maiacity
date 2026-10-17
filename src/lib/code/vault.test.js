// @ts-nocheck — plain JS
// C10: code entries from the Maia City vault (game/code/sources/avendb.js), the repo's code/ as the seed. What the
// copy writes comes back as the same entry; what the vault hands out is checked and held to the engines the repo
// ships; the loader prefers what it loaded and keeps the seed for the rest.
// Run: bun test src/lib/code
import { afterEach, describe, expect, test } from 'bun:test';
import { avendb, copyOf, entryOf, recordOf } from '../../../game/code/sources/avendb.js';
import { codeAt, codeIn, loadCode, viewOfEntry } from '../../../game/code/index.js';
import { ENTRIES } from '../../../code/index.js';
import { defaultViews } from '../../../game/economy/views.js';
import { examples } from '../../../game/genui/examples.js';
import { defaultCards } from '../../../game/economy/params.js';

const VAULT = 'a'.repeat(64);
const repo = Object.values(ENTRIES);
/** the rows the vault would hand out after the copy: each create, as read back */
const rowsOf = (entries) => entries.map((e, i) => ({ entry: `e${String(i).padStart(11, '0')}`, vault: VAULT, heads: `${String(i).padStart(8, '0')}cafe`, ...recordOf(e), record: recordOf(e).value }));
const strip = ({ source, vault, entry, heads, ...e }) => e;

afterEach(() => avendb.use([], viewOfEntry));

describe('the copy', () => {
	test('every view and logic module of the repo comes back from the vault as the same entry, with the same hash', () => {
		expect(repo.length).toBeGreaterThan(10);
		for (const row of rowsOf(repo)) {
			const { entry, error } = entryOf(row);
			expect(error).toBeUndefined();
			expect(strip(entry)).toEqual(ENTRIES[entry.ref]);
		}
	});
	test('is one batch acting as the vault: the Public share first, then a create per entry, tagged by path, game and the repo hash', () => {
		const b = copyOf(repo, VAULT);
		expect([b.op, b.as, b.ops.length]).toEqual(['batch', VAULT, repo.length + 1]);
		expect(b.ops[0]).toEqual({ op: 'share', over: VAULT, who: 'everyone', level: 'Public', what: { type: ['view', 'logic'] }, as: VAULT });
		const wants = b.ops.find((o) => o.tags?.includes('ref:views/view-wants'));
		expect(wants).toMatchObject({ op: 'create', vault: VAULT, type: 'view', schema: 'view' });
		expect(wants.tags).toEqual(['ref:views/view-wants', 'game:sandbox-7', `legacy:${ENTRIES['views/view-wants'].hash}`]);
		expect(b.ops.find((o) => o.tags?.includes('ref:views/coop-chart')).tags.some((t) => t.startsWith('game:'))).toBe(false);
		const hearts = b.ops.find((o) => o.tags?.includes('ref:logic/sandbox-7/hearts')).value;
		expect([hearts.kind, hearts.engine.host, hearts.manifest.hooks]).toEqual(['logic', 'logic', ['mint', 'decay']]);
		expect(() => copyOf(repo, 'maia-city')).toThrow(/64 hex/);
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
	const rows = rowsOf(repo);
	const row = (ref) => rows.find((r) => r.tags.includes(`ref:${ref}`));
	const changed = (ref, record) => ({ ...row(ref), record: { ...row(ref).record, ...record } });

	test('the whole copy loads: every entry passes the checker as at the door', () => {
		const r = avendb.use(rows, viewOfEntry);
		expect([r.taken.length, r.refused]).toEqual([repo.length, []]);
	});
	test('a loaded view is what codeAt, codeIn and the defaults read; the seed serves every other path', () => {
		const wants = changed('views/view-wants', { title: 'Wants, from the vault' });
		expect(avendb.use([wants], viewOfEntry)).toEqual({ taken: ['views/view-wants'], refused: [] });
		expect(codeAt('views/view-wants')).toMatchObject({ title: 'Wants, from the vault', source: 'avendb', vault: VAULT });
		expect(codeIn('views/').find((e) => e.ref === 'views/view-wants').title).toBe('Wants, from the vault');
		expect(defaultViews()[0].name).toBe('Wants, from the vault');
		expect(codeAt('views/coop-chart')).toBe(ENTRIES['views/coop-chart']);
		expect(examples().map((v) => v.id)).toEqual(['village-scene', 'coop-chart', 'dome-planner']);
		expect(codeIn('views/').length).toBe(Object.keys(ENTRIES).filter((k) => k.startsWith('views/')).length);
	});
	test("a loaded rule module is the valley's default code", () => {
		const code = 'export function mint({ value }) { return value + 1; }\nexport function decay({ value }) { return value; }\n';
		avendb.use([changed('logic/sandbox-7/hearts', { source: code })], viewOfEntry);
		expect(defaultCards().find((c) => c.id === 'hearts').code).toBe(code);
	});
	test('what the checker refuses, an engine the repo does not ship, a wrong kind or a path twice is left out, and the seed stays', () => {
		const r = avendb.use(
			[
				changed('views/view-wants', { source: '<img src="https://x.example/a.png">' }),
				changed('views/coop-chart', { engine: { host: 'view', version: 99, hash: 'f'.repeat(64) } }),
				{ ...row('logic/sandbox-7/rot'), type: 'view' },
				{ ...row('views/village-scene'), tags: ['game:sandbox-7'] },
				row('views/dome-planner'),
				{ ...row('views/dome-planner'), entry: 'e99999999999' }
			],
			viewOfEntry
		);
		expect(r.taken).toEqual([]);
		expect(r.refused).toHaveLength(5);
		expect(r.refused.join('\n')).toMatch(/views\/view-wants: .*address/);
		expect(r.refused.join('\n')).toMatch(/views\/coop-chart: written for view engine 99, which the repo does not ship/);
		expect(r.refused.join('\n')).toMatch(/held twice/);
		expect(codeAt('views/view-wants')).toBe(ENTRIES['views/view-wants']);
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
		const r = await loadCode({ url: 'https://feed.example/code', fetch: reply(200, { entries: rowsOf([ENTRIES['views/view-holders']]) }) });
		expect(r).toEqual({ taken: ['views/view-holders'], refused: [] });
		expect(codeAt('views/view-holders').source).toBe('avendb');
	});
	test('a feed handing out code of more than one vault is not taken', async () => {
		const other = { ...rowsOf([ENTRIES['views/view-wants']])[0], vault: 'b'.repeat(64) };
		const r = await loadCode({ url: 'https://feed.example/code', fetch: reply(200, [...rowsOf([ENTRIES['views/view-holders']]), other]) });
		expect(r).toEqual({ error: 'https://feed.example/code handed out code of more than one vault' });
		expect(codeAt('views/view-holders')).toBe(ENTRIES['views/view-holders']);
	});
	test('no feed, or no network: the seed stays, and nothing throws', async () => {
		expect(await loadCode({ url: 'https://feed.example/code', fetch: reply(404, {}) })).toEqual({ error: 'https://feed.example/code answered 404' });
		expect(await loadCode({ url: 'https://feed.example/code', fetch: async () => { throw new Error('offline'); } })).toEqual({ error: 'offline' });
		expect(codeAt('views/view-holders')).toBe(ENTRIES['views/view-holders']);
	});
	test('the live feed stays off until the server serves code', async () => {
		expect(avendb.on).toBe(false);
		expect(await loadCode()).toEqual({ error: 'code from avenDB is not switched on yet' });
	});
});
