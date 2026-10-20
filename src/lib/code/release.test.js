// @ts-nocheck — plain JS, kept loose on purpose
// The signed release (scripts/release.mjs): a list signed by the release key holds; one signed by any other key, or
// changed after signing, does not; and the live check names every file whose bytes are not the ones signed.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { LIST, check, sign, signed, toCheck } from '../../../scripts/release.mjs';

const SEED = new Uint8Array(32).fill(7);
const PUB = bytesToHex(ml_dsa65.keygen(SEED).publicKey);
const OTHER = new Uint8Array(32).fill(9);

function site() {
	const dir = mkdtempSync(join(tmpdir(), 'release-'));
	mkdirSync(join(dir, 'docs'));
	mkdirSync(join(dir, '_app/immutable'), { recursive: true });
	writeFileSync(join(dir, 'index.html'), '<h1>maia</h1>');
	writeFileSync(join(dir, 'docs/index.html'), '<h1>docs</h1>');
	writeFileSync(join(dir, '_app/immutable/a.js'), 'export const a = 1;');
	writeFileSync(join(dir, LIST), 'an old list, never in the new one');
	return dir;
}

/** a fetch that serves `files` (by path) as the server holds them */
const served = (files) => async (url) => {
	const path = new URL(url).pathname.slice(1);
	const body = files[path] ?? files[`${path}index.html`];
	return body == null ? new Response('', { status: 404 }) : new Response(body);
};

describe('the signed release', () => {
	test('signs every file but the list, and holds only to the release key', () => {
		const list = sign(site(), SEED, 'abc', '2026-10-20T00:00:00Z');
		expect(Object.keys(list.files)).toEqual(['_app/immutable/a.js', 'docs/index.html', 'index.html']);
		expect(signed(list, PUB)).toBe(true);
		expect(signed(sign(site(), OTHER, 'abc'), PUB)).toBe(false);
		expect(signed({ ...list, commit: 'def' }, PUB)).toBe(false);
		expect(signed({ ...list, files: { ...list.files, 'index.html': '0'.repeat(64) } }, PUB)).toBe(false);
		expect(signed(list, '')).toBe(false);
	});

	test('the live check names a swapped file, and passes the site as built', async () => {
		const list = sign(site(), SEED, 'abc');
		const files = { [LIST]: JSON.stringify(list), 'index.html': '<h1>maia</h1>', 'docs/index.html': '<h1>docs</h1>', '_app/immutable/a.js': 'export const a = 1;' };
		expect((await check('https://x.test', { pub: PUB, get: served(files) })).failed).toEqual([]);
		const swapped = { ...files, '_app/immutable/a.js': 'steal()' };
		expect((await check('https://x.test', { pub: PUB, get: served(swapped) })).failed).toEqual(['_app/immutable/a.js: not the bytes the release signed']);
		const forged = { ...files, [LIST]: JSON.stringify(sign(site(), OTHER, 'abc')) };
		expect((await check('https://x.test', { pub: PUB, get: served(forged) })).failed).toEqual([`${LIST}: not signed by the release key`]);
	});

	test('a sample keeps every page and takes some of the hashed chunks', () => {
		const files = { 'index.html': 'h', 'a/index.html': 'h', '_app/immutable/1.js': 'h', '_app/immutable/2.js': 'h', '_app/immutable/3.js': 'h' };
		const picked = toCheck(files, 1);
		expect(picked.filter((f) => !f.startsWith('_app/'))).toEqual(['a/index.html', 'index.html']);
		expect(picked.filter((f) => f.startsWith('_app/'))).toHaveLength(1);
		expect(toCheck(files)).toHaveLength(5);
	});
});
