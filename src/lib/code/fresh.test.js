// @ts-nocheck — plain JS
// The freshness frontier (game/code/fresh.js): a device never takes code for an entry older than the newest version of
// it it has already proven. A server may leave an entry's newest writes out and hand out an older version, every
// write of it validly signed; avenDB's count of a version's writes (`version` on each row) tells it, and the loader
// refuses it, naming the entry and both versions, rather than run it, or the seed, in silence.
// Run: bun test src/lib/code
import { afterEach, describe, expect, test } from 'bun:test';
import { fresh, isOlder, newestKeeper, versionOf, versionWords } from '../../../game/code/fresh.js';
import { avendb, recordOf } from '../../../game/code/sources/avendb.js';
import { codeAt, codeIn, loadCode, viewOfEntry } from '../../../game/code/index.js';
import { ENTRIES } from '../../../code/index.js';

const VAULT = 'c'.repeat(64);
const ENTRY = '1'.repeat(64);
const head = (n) => String(n).padStart(64, '0');

/** a row of the vault's code at a version: `writes` its writes, `heads` its head, as avenDB's row says them */
const rowAt = (writes, { version = 1, edits = 0, title = `at ${writes}`, ref = 'views/view-holders' } = {}) => {
	const r = recordOf(ENTRIES[ref]);
	return { entry: ENTRY, vault: VAULT, heads: [head(writes)], version: { version, edits, writes }, type: r.type, tags: r.tags, record: { ...r.value, title } };
};

describe('which version is newer', () => {
	test("a row's version as avenDB counts it, and in words", () => {
		const v = versionOf(rowAt(7, { version: 3, edits: 2 }));
		expect(v).toEqual({ heads: [head(7)], writes: 7, version: 3, edits: 2 });
		expect(versionWords(v)).toBe('v3 + 2 edits, 7 writes, at 00000000…');
		expect(versionWords(versionOf({ heads: ['ab'.repeat(32)] }))).toBe('draft, at abababab…');
	});
	test('older is fewer writes; without both counts no reader can say, so it is not', () => {
		expect(isOlder(versionOf(rowAt(4)), versionOf(rowAt(5)))).toBe(true);
		expect(isOlder(versionOf(rowAt(5)), versionOf(rowAt(5)))).toBe(false);
		expect(isOlder(versionOf(rowAt(6)), versionOf(rowAt(5)))).toBe(false);
		expect(isOlder(versionOf({ heads: [head(1)] }), versionOf(rowAt(5)))).toBe(false);
		expect(isOlder(versionOf(rowAt(1)), undefined)).toBe(false);
	});
});

describe('fresh', () => {
	test('keeps the newest proven, refuses an older one naming the entry and both versions, and takes a newer one', () => {
		const keep = newestKeeper({ storage: false });
		expect(fresh([rowAt(5, { version: 2 })], { proven: true, keep }).stale).toEqual([]);
		const older = fresh([rowAt(3)], { proven: true, keep });
		expect(older.rows).toEqual([]);
		expect(older.stale[0].error).toBe(
			`views/view-holders (entry 11111111…) of vault cccccccc…: refused, the version handed out (v1, 3 writes, at ${head(3).slice(0, 8)}…) is older than the newest this device already proved (v2, 5 writes, at ${head(5).slice(0, 8)}…); whoever served it may be holding the newer one back`
		);
		// the same version again is taken, and a newer one becomes the newest
		expect(fresh([rowAt(5, { version: 2 })], { proven: true, keep }).rows).toHaveLength(1);
		expect(fresh([rowAt(9, { version: 3 })], { proven: true, keep }).rows).toHaveLength(1);
		expect(keep.get(`${VAULT}/${ENTRY}`).writes).toBe(9);
		expect(fresh([rowAt(5, { version: 2 })], { keep }).stale).toHaveLength(1);
	});
	test("a listing on the server's word is held to the newest proven but never kept as it, so it can't make one up", () => {
		const keep = newestKeeper({ storage: false });
		expect(fresh([rowAt(1000)], { keep }).rows).toHaveLength(1);
		expect(keep.get(`${VAULT}/${ENTRY}`)).toBeUndefined();
		expect(fresh([rowAt(2)], { proven: true, keep }).rows).toHaveLength(1);
	});
	test("each entry of each vault on its own, and rows that say no count are taken as before", () => {
		const keep = newestKeeper({ storage: false });
		fresh([rowAt(5)], { proven: true, keep });
		expect(fresh([{ ...rowAt(2), entry: '2'.repeat(64) }, { ...rowAt(2), vault: 'd'.repeat(64) }], { proven: true, keep }).stale).toEqual([]);
		const { version, ...uncounted } = rowAt(2);
		expect(fresh([uncounted], { proven: true, keep }).rows).toEqual([uncounted]);
		expect(keep.get(`${VAULT}/${ENTRY}`).writes).toBe(5);
	});
	test("kept in the page's storage, so a page loaded again still knows; without one, or a full one, in memory", () => {
		const items = new Map();
		const was = globalThis.localStorage;
		globalThis.localStorage = { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) };
		try {
			fresh([rowAt(5)], { proven: true, keep: newestKeeper() });
			expect(JSON.parse(items.get(`avendb-newest:${VAULT}/${ENTRY}`)).writes).toBe(5);
			expect(fresh([rowAt(4)], { keep: newestKeeper() }).stale).toHaveLength(1);
			globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('full'); } };
			const keep = newestKeeper();
			fresh([rowAt(5)], { proven: true, keep });
			expect(fresh([rowAt(4)], { keep }).stale).toHaveLength(1);
		} finally {
			globalThis.localStorage = was;
		}
	});
});

describe('the code loader', () => {
	const AT = 'https://feed.example/feed/proof';
	/** a feed whose proof proves `rows`, each time with a tag of its own, so each is checked afresh */
	let tag = 0;
	const served = (rows) => ({ get: async () => new Response(JSON.stringify(rows), { headers: { etag: `"${++tag}"` } }) });
	const trusting = async (bytes) => JSON.parse(new TextDecoder().decode(bytes));
	const proofs = () => {
		const kept = new Map();
		return { get: (k) => kept.get(k), put: (k, v) => kept.set(k, v) };
	};
	const load = async (rows, newest) => {
 const { useDevice } = await import('../../../game/code/sources/device.js');
 useDevice({ run: async op => op.op === 'code' ? { ok: rows } : { ok: { new: 0 } } });
 try { return await loadCode({ vault: VAULT, newest }); } finally { useDevice(null); }
 };

	afterEach(() => avendb.reset());

	test('an older version after a newer one is refused: the newer one loaded stays', async () => {
		const newest = newestKeeper({ storage: false });
		expect(await load([rowAt(5, { version: 2 })], newest)).toEqual({ taken: ['views/view-holders'], refused: [] });
		expect(codeAt('views/view-holders').title).toBe('at 5');
		const r = await load([rowAt(3)], newest);
		expect(r.taken).toEqual(['views/view-holders']);
		expect(r.refused[0]).toMatch(/^views\/view-holders \(entry 11111111…\) of vault cccccccc…: refused, the version handed out \(v1, 3 writes.*older than the newest this device already proved \(v2, 5 writes/);
		expect(codeAt('views/view-holders').title).toBe('at 5');
		// and a newer one is taken
		expect((await load([rowAt(8, { version: 3 })], newest)).refused).toEqual([]);
		expect(codeAt('views/view-holders').title).toBe('at 8');
	});
	test('where nothing of it is loaded (a page loaded again), the path is refused, saying both versions, never the seed', async () => {
		const newest = newestKeeper({ storage: false });
		await load([rowAt(5, { version: 2 })], newest);
		avendb.reset();
		expect(codeAt('views/view-holders')).toMatchObject(ENTRIES['views/view-holders']);
		await load([rowAt(3)], newest);
		expect(() => codeAt('views/view-holders')).toThrow(/views\/view-holders .*refused, the version handed out \(v1, 3 writes.*\(v2, 5 writes/);
		expect(() => codeIn('views/view-')).toThrow(/refused/);
		// the other paths read as ever
		expect(codeAt('views/coop-chart')).toMatchObject(ENTRIES['views/coop-chart']);
	});
	test("an exact pin by heads is never this rule's: it names the version loaded, whatever is newer", async () => {
		const newest = newestKeeper({ storage: false });
		await load([rowAt(5)], newest);
		expect(codeAt(`vault:${VAULT}/${ENTRY}@${head(5)}`).title).toBe('at 5');
	});
});
