// @ts-nocheck — Bun tests
import { expect, mock, test } from 'bun:test';
mock.module('$app/paths', () => ({ base: '' }));
const { whole } = await import('./files.js');

test('a viewport cancellation stops whole-file reads after the currently outstanding chunk', async () => {
	const controller = new AbortController();
	let calls = 0, finish;
	const pending = whole(async () => {
		calls++;
		return new Promise((resolve) => { finish = resolve; });
	}, { root: 'file', size: 8 << 20, len: 8 << 20 }, 'image/png', undefined, controller.signal);
	controller.abort(); finish(new Uint8Array(4 << 20));
	await expect(pending).rejects.toThrow();
	expect(calls).toBe(1);
	await expect(whole(async () => { calls++; return new Uint8Array(1); },
		{ root: 'file', size: 1, len: 1 }, '', undefined, controller.signal)).rejects.toThrow();
	expect(calls).toBe(1);
});

test('ordinary whole-file reads preserve bytes and progress', async () => {
	const progress = [], asks = [];
	const blob = await whole(async (root, size, from, to) => {
		asks.push([root, size, from, to]); return new Uint8Array([1, 2, 3]);
	}, { root: 'file', size: 10, len: 3 }, 'image/png', (p) => progress.push(p));
	expect(asks).toEqual([['file', 10, 0, 3]]);
	expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
	expect(blob.type).toBe('image/png'); expect(progress).toEqual([1]);
});
