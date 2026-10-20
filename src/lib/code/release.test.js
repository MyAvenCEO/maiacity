// @ts-nocheck — plain JS, kept loose on purpose
// The release Maia City accepts (scripts/release.mjs): the list names every file built but itself; the live site holds
// only when it serves exactly the files of a list we trust; and the witness builds a new commit of main, holds the
// accepted one, and raises the rest.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIST, isList, listOf, plan, served, unlike } from '../../../scripts/release.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

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
const server = (files) => async (url) => {
	const path = new URL(url).pathname.slice(1);
	const body = files[path] ?? files[`${path}index.html`];
	return body == null ? new Response('', { status: 404 }) : new Response(body);
};
const FILES = { 'index.html': '<h1>maia</h1>', 'docs/index.html': '<h1>docs</h1>', '_app/immutable/a.js': 'export const a = 1;' };

describe('the release list', () => {
	test('names every file built but the list itself, by its hash', () => {
		const list = listOf(site(), A);
		expect(Object.keys(list.files).sort()).toEqual(['_app/immutable/a.js', 'docs/index.html', 'index.html']);
		expect(isList(list)).toBe(true);
		expect(isList({ ...list, commit: 'main' })).toBe(false);
		expect(isList({ ...list, files: { 'index.html': 'x' } })).toBe(false);
	});

	test('the live site holds only with the very bytes of the list', async () => {
		const list = listOf(site(), A);
		expect(await served('https://x.test', list, { get: server(FILES) })).toEqual([]);
		expect(await served('https://x.test', list, { get: server({ ...FILES, '_app/immutable/a.js': 'steal()' }) })).toEqual(['_app/immutable/a.js: not the bytes of the release']);
		expect(unlike({ ...list, files: { ...list.files, 'evil.js': '0'.repeat(64) } }, list)).toEqual(['evil.js: on the site, not in the release']);
	});
});

describe('what the witness does', () => {
	const live = (commit) => ({ ...listOf(site(), commit) });
	const main = { onMain: (c) => [A, B].includes(c), before: (a, b) => a === A && b === B };

	test('holds the release Maia City accepted', () => {
		expect(plan(live(B), live(B), main).do).toBe('hold');
	});
	test('builds a newer commit of main, and the first one before any accept', () => {
		expect(plan(live(B), live(A), main).do).toBe('build');
		expect(plan(live(A), null, main).do).toBe('build');
	});
	test('raises a commit main does not hold, an older release served again, and no list at all', () => {
		expect(plan(live('c'.repeat(40)), live(B), main)).toMatchObject({ do: 'alert' });
		expect(plan(live(A), live(B), main)).toMatchObject({ do: 'alert' });
		expect(plan({ commit: B }, live(B), main)).toMatchObject({ do: 'alert' });
	});
});
