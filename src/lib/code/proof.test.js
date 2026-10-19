// @ts-nocheck — plain JS
// H2: the code our hosts run is what Maia City's own signed edits prove, checked by avenDB's own WebAssembly where it
// runs (game/code/sources/feed.js `provenRows`, `verifyProof`), never rows a server hands out on its word. Here the real
// WebAssembly is handed what a server could hand out in a proof's place, and the loader takes none of it: the seed
// runs, as offline. (The recipes' loader is held to the same in ../assets/vault.test.js; that a forged edit, a record
// the vault never signed, a write without the right or a file of other bytes proves nothing is avenDB's own test,
// avendb/crates/avendb/tests/provenance.rs.)
// Run: bun test src/lib/code/proof.test.js
import { afterEach, describe, expect, test } from 'bun:test';
import { avendb, recordOf } from '../../../game/code/sources/avendb.js';
import { codeAt, loadCode, viewOfEntry } from '../../../game/code/index.js';
import { proofOf, verifyProof } from '../../../game/code/sources/feed.js';
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
			expect(r).toEqual({ error: "Maia City's vault id is not set (MAIA_CITY, 64 hex digits), so no code is taken from avenDB's feed" });
			expect(f.asked).toEqual([]);
		}
		expect(codeAt('views/view-holders')).toBe(holders);
	});
	test('a check that takes too long loads nothing now, and what it proves is kept for the next load', async () => {
		let done;
		const slow = (bytes) => new Promise((ok) => (done = () => ok([{ ...row, record: recordOf(holders).value }])));
		const kept = keep();
		const r = await loadCode({ url: AT, vault: CITY, fetch: served(json([row])).get, verify: slow, keep: kept, timeout: 20 });
		expect(r).toEqual({ error: `${AT} took longer than 20 ms to prove` });
		expect(codeAt('views/view-holders')).toBe(holders);
		done();
		await new Promise((ok) => setTimeout(ok, 5));
		expect([...kept.kept.values()].map((k) => k.tag)).toEqual(['"x"']);
	});
});
