import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { avenRef, avenUrl, isAven, parseMediaRef, requireAvenRef } from './ref.js';
import { asset, GATEWAY, inVault, media } from './url.ts';
import manifest from './manifest.json';

const vectors = readFileSync(new URL('../../../tests/fixtures/media-refs.tsv', import.meta.url), 'utf8');

for (const line of vectors.trim().split('\n')) {
	const [kind, value, mime = ''] = line.split('\t');
	test(`media reference: ${value}`, () => {
		const parsed = parseMediaRef(value);
		expect(parsed?.kind ?? 'invalid').toBe(kind);
		if (parsed?.kind === 'aven') {
			expect(parsed.media).toBe(mime);
			expect(parseMediaRef(avenRef(parsed, parsed.media))).toEqual(parsed);
			const url = new URL(avenUrl(value));
			expect(url.protocol).toBe('aven:');
			expect(url.host).toBe('localhost');
			expect(url.pathname).toBe(`/${parsed.root}`);
			expect(url.searchParams.get('size')).toBe(String(parsed.size));
			expect(url.searchParams.get('len')).toBe(String(parsed.len));
			expect(url.searchParams.get('media') ?? '').toBe(parsed.media);
		} else {
			expect(() => requireAvenRef(value)).toThrow('import legacy media');
			expect(() => avenUrl(value)).toThrow();
		}
	});
}

test('unknown lengths never become readable empty files', () => {
	const file = { root: 'a'.repeat(64), size: 16, len: null };
	expect(() => avenRef(file, 'video/mp4')).toThrow();
	expect(avenRef({ ...file, len: 0 }, '')).toEndWith(':16:0:');
	for (const value of [null, undefined, {}, 42, '', 'aven:broken']) expect(isAven(value)).toBe(false);
});

test('public aliases retain their URLs and never become private device references', () => {
	const hash = 'a'.repeat(64);
	for (const value of [hash, `${hash}.mp4`]) {
		expect(asset(value)).toBe(`${GATEWAY}/${value}`);
		expect(inVault(value)).toBe(true);
		expect(isAven(value)).toBe(false);
	}
	for (const value of ['https://example.com/file.mp4', '/static/file.mp4', '']) {
		expect(asset(value)).toBe(value || undefined);
		expect(inVault(value)).toBe(false);
	}
	expect(asset(undefined)).toBeUndefined();
	expect(asset(null)).toBeUndefined();
	const privateRef = avenRef({ root: hash, size: 116, len: 100 }, 'video/mp4');
	expect(inVault(privateRef)).toBe(false);
	expect(asset(privateRef)).not.toStartWith(GATEWAY);
});

test('every published manifest hash retains metadata lookup and the gateway alias', () => {
	for (const [hash, entry] of Object.entries(manifest)) {
		expect(asset(hash)).toBe(`${GATEWAY}/${hash}`);
		expect(media(hash)).toEqual(entry);
		expect(media(`${hash}.mp4`)).toEqual(entry);
	}
});
