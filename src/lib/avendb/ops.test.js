// @ts-nocheck — plain JS
// Which ops bring a file, its bytes handed over beside them (./ops.js `brings`, avendb's `engine::brings`): the page's
// device and the Mac app's read them only for those.
// Run: bun test src/lib/avendb/ops.test.js
import { expect, test } from 'bun:test';
import { brings, readLocalFile } from './ops.js';

test('a put_file brings a file, into a new entry or one it names, and a create brings one only with its file', () => {
	expect(brings({ op: 'put_file', vault: 'v', len: 3 })).toBe(true);
	expect(brings({ op: 'put_file', entry: 'e', len: 3 })).toBe(true);
	expect(brings({ op: 'create', vault: 'v', type: 'recipe', value: {}, file: { len: 3, name: 'lamp.js' } })).toBe(true);
	expect(brings({ op: 'create', vault: 'v', type: 'recipe', value: {} })).toBe(false);
	expect(brings({ op: 'set', entry: 'e', path: [], value: {}, file: { len: 3 } })).toBe(false);
	expect(brings({ op: 'read_file', root: 'r' })).toBe(false);
	expect(brings(null)).toBe(false);
});

test('a file not on this device yet fails in passing, one refused or never there for good', async () => {
	const root = 'ab'.repeat(32);
	const failing = async (/** @type {any} */ run) => {
		try {
			await readLocalFile(run, root, 10, 0, 10);
		} catch (e) {
			return e;
		}
		throw new Error('it read');
	};
	const bytes = new Uint8Array([1, 2]);
	expect(await readLocalFile(async (/** @type {any} */ op) => (expect(op.local).toBe(true), { ok: {}, bytes }), root, 10, 0, 2)).toBe(bytes);
	const shelf = await failing(async () => { throw new Error(`Error::Io: Error::Io: no blob ${'d7'.repeat(32)} on the shelf`); });
	expect(shelf.passing).toBe(true);
	expect((await failing(async () => { throw new Error('a blob lacks 0..1024'); })).passing).toBe(true);
	expect((await failing(async () => ({ error: 'no file this device opens' }))).passing).toBeUndefined();
	expect((await failing(async () => { throw new Error('sealed bytes that don\'t open'); })).passing).toBeUndefined();
});
