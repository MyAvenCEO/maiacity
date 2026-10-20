// @ts-nocheck — plain JS
// H2: the code our hosts run is what Maia City's own signed edits prove, checked by avenDB's own WebAssembly where it
// runs (game/code/sources/feed.js `provenRows`, `verifyProof`), never rows a server hands out on its word. Here the real
// WebAssembly is handed what a server could hand out in a proof's place, and the loader takes none of it: the seed
// runs, as offline. (The recipes' loader is held to the same in ../assets/vault.test.js; that a forged edit, a record
// the vault never signed, a write without the right or a file of other bytes proves nothing is avenDB's own test,
// avendb/crates/avendb/tests/provenance.rs.) And what a device proved is kept as rows, each once, never as the proof's
// bytes, and the anchor is the repo's own.
// Run: bun test src/lib/code/proof.test.js
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { avendb, recordOf } from '../../../game/code/sources/avendb.js';
import { codeAt, loadCode, viewOfEntry } from '../../../game/code/index.js';
import { KEPT_PROOFS, MAIA_CITY, NO_ANCHOR, proofOf, provenRows, verifyProof } from '../../../game/code/sources/feed.js';
import { ENTRIES } from '../../../code/index.js';

/** the vault the loads are anchored to */
const CITY = 'c1'.repeat(32);
/** where the test's proof is */
const AT = proofOf(['view', 'logic', 'config'], { vault: CITY, feed: 'https://feed.example/feed/code' });
const holders = ENTRIES['views/view-holders'];
/** a view as the feed's JSON lists one, of the anchor's vault and named its seed's: what a server could hand out
 *  unsigned, a script in its source */
const row = { entry: 'e'.repeat(64), vault: CITY, heads: ['f'.repeat(64)], seed: 'Maia City', ...recordOf(holders), record: { ...recordOf(holders).value, source: '<script>steal()</script>' } };
/** an avenDB reply that holds no edit (`wire::Reply`: no edits, no files, nothing more to ask for) */
const EMPTY = new Uint8Array(9);
const json = (v) => new TextEncoder().encode(JSON.stringify(v));
/** a feed that hands out `body` in the proof's place, counting what is asked of it */
const served = (body) => {
	const asked = [];
	return { asked, get: async (url) => (asked.push(url), new Response(body, { headers: { etag: '"x"' } })) };
};
/** where what was proved is kept: the test's own */
const keep = () => {
	const kept = new Map();
	return { get: (k) => kept.get(k), put: (k, v) => kept.set(k, v), kept };
};

afterEach(() => avendb.use([], viewOfEntry));

describe("avenDB's WebAssembly", () => {
	test('takes the rows a feed hands out as JSON for no proof', async () => {
		await expect(verifyProof(json({ code: [row] }), CITY, ['view'])).rejects.toThrow(/no avenDB reply/);
		await expect(verifyProof(json([row]), CITY, ['view'])).rejects.toThrow(/no avenDB reply/);
	});
	test("a reply that proves no vault of the anchor's id proves nothing, and one cut short is no reply", async () => {
		await expect(verifyProof(EMPTY, CITY, ['view'])).rejects.toThrow(/proves no vault of that id/);
		await expect(verifyProof(EMPTY.slice(1), CITY, ['view'])).rejects.toThrow(/no avenDB reply/);
		await expect(verifyProof(EMPTY, 'Maia City', ['view'])).rejects.toThrow(/a vault is its id/);
	});
});

describe('the code loader takes nothing unproven', () => {
	test('rows handed out in a proof\'s place load nothing, are kept nowhere, and the seed runs', async () => {
		const kept = keep();
		for (const body of [json({ code: [row] }), json([row]), EMPTY]) {
			const r = await loadCode({ url: AT, vault: CITY, fetch: served(body).get, timeout: 60000, keep: kept });
			expect(r.error).toStartWith(`the proof at ${AT} doesn't check out: `);
			expect(codeAt('views/view-holders')).toBe(holders);
		}
		expect(kept.kept.size).toBe(0);
	});
	test('a check that fails, however it fails, loads nothing', async () => {
		const failing = async () => {
			throw new Error('a signature that does not check out');
		};
		const r = await loadCode({ url: AT, vault: CITY, fetch: served(json([row])).get, verify: failing, keep: keep() });
		expect(r).toEqual({ error: `the proof at ${AT} doesn't check out: a signature that does not check out` });
		expect(codeAt('views/view-holders')).toBe(holders);
	});
	test('with no anchor, nothing is asked of the feed, and the seed runs', async () => {
		for (const vault of ['', 'Maia City', 'C1'.repeat(32)]) {
			const f = served(json([row]));
			const r = await loadCode({ url: AT, vault, fetch: f.get, verify: async () => [row], keep: keep() });
			expect(r).toEqual({ error: NO_ANCHOR });
			expect(f.asked).toEqual([]);
		}
		expect(codeAt('views/view-holders')).toBe(holders);
	});
	test('a check that takes too long loads nothing now, and what it proves is kept for the next load', async () => {
		let done;
		const slow = (bytes) => new Promise((ok) => (done = () => ok([{ ...row, record: recordOf(holders).value }])));
		const kept = keep();
		const r = await loadCode({ url: AT, vault: CITY, fetch: served(json([row])).get, verify: slow, keep: kept, timeout: 20 });
		expect(r).toEqual({ error: `${AT} took longer than 20 ms to prove`, passing: true });
		expect(codeAt('views/view-holders')).toBe(holders);
		done();
		await new Promise((ok) => setTimeout(ok, 5));
		expect([...kept.kept.values()].map((k) => k.tag)).toEqual(['"x"']);
	});
});

describe('the anchor and what is kept', () => {
	test("the anchor is the repo's alone: no build's nor server's setting names it", () => {
		const anchor = readFileSync(new URL('../../../game/code/sources/anchor.js', import.meta.url), 'utf8');
		expect(anchor).toMatch(/^export const MAIA_CITY = '([0-9a-f]{64})?';$/m);
		expect(MAIA_CITY).toMatch(/^([0-9a-f]{64})?$/);
		const feed = readFileSync(new URL('../../../game/code/sources/feed.js', import.meta.url), 'utf8');
		expect(feed).not.toMatch(/import\.meta\.env|process\.env/);
		for (const file of ['.github/workflows/deploy.yml', 'docker-compose.prod.yml', 'api/src/index.ts'])
			expect([file, readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8').includes('MAIA_CITY')]).toEqual([file, false]);
	});
	test("a device keeps the rows it proved, each once however many proofs hold it, and asks again by the proof's tag", async () => {
		const storage = new Map();
		const was = globalThis.localStorage;
		globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, String(v)) };
		try {
			const a = { ...row, entry: 'a'.repeat(64) };
			const b = { ...row, entry: 'b'.repeat(64) };
			let checked = 0;
			const verify = async (bytes) => (checked++, JSON.parse(new TextDecoder().decode(bytes)));
			/** a feed whose proof of some entries is their rows, tagged, and not modified for a reader holding the tag */
			const feed = (rows) => {
				const asked = [];
				const get = async (url, o) => {
					const tag = `"${rows.map((r) => r.entry.slice(0, 4)).join('')}"`;
					asked.push(o?.headers?.['if-none-match'] ?? null);
					return o?.headers?.['if-none-match'] === tag ? new Response(null, { status: 304, headers: { etag: tag } }) : new Response(JSON.stringify(rows), { headers: { etag: tag } });
				};
				return { get, asked };
			};
			const at = (entries) => proofOf(['recipe'], { vault: CITY, entries });
			const one = feed([a, b]);
			expect(await provenRows(at([a.entry, b.entry]), { vault: CITY, kinds: ['recipe'], entries: [b.entry, a.entry], fetch: one.get, verify })).toEqual({ rows: [a, b] });
			const two = feed([b]);
			expect(await provenRows(at([b.entry]), { vault: CITY, kinds: ['recipe'], entries: [b.entry], fetch: two.get, verify })).toEqual({ rows: [b] });
			// each row once, the records naming theirs; no proof's bytes
			const keys = [...storage.keys()].sort();
			expect(keys.filter((k) => k.startsWith('avendb-row:'))).toEqual([`avendb-row:${CITY}/${a.entry}`, `avendb-row:${CITY}/${b.entry}`]);
			const records = keys.filter((k) => k.startsWith('avendb-proof:')).map((k) => JSON.parse(storage.get(k)));
			expect(records.map((r) => r.entries.length).sort()).toEqual([1, 2]);
			expect(records.every((r) => !('rows' in r) && typeof r.tag === 'string')).toBe(true);
			expect(checked).toBe(2);
			// read back on a page loaded afresh (nothing in memory): asked by the tag, not modified, nothing checked
			const kept = { get: (k) => (storage.has(`avendb-proof:${k}`) ? KEPT_PROOFS.get(k) : undefined), put: KEPT_PROOFS.put };
			const again = feed([a, b]);
			expect(await provenRows(at([a.entry, b.entry]), { vault: CITY, kinds: ['recipe'], entries: [a.entry, b.entry], fetch: again.get, verify, keep: kept })).toEqual({ rows: [a, b] });
			expect([again.asked, checked]).toEqual([['"aaaabbbb"'], 2]);
		} finally {
			globalThis.localStorage = was;
		}
	});
	test('a proof of some entries hands out theirs alone, not the row of the entry that opened their audience', async () => {
		const [a, b] = [{ ...row, entry: 'a'.repeat(64) }, { ...row, entry: 'b'.repeat(64) }];
		const get = async () => new Response('a proof', { headers: { etag: '"b"' } });
		const keep = { get: () => undefined, put: () => {} };
		const o = { vault: CITY, kinds: ['recipe'], entries: [b.entry], fetch: get, verify: async () => [a, b], keep };
		expect(await provenRows(proofOf(['recipe'], { vault: CITY, entries: [b.entry] }), o)).toEqual({ rows: [b] });
	});
});
