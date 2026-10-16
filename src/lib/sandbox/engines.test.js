// @ts-nocheck — plain JS
// Every kernel engine (./engines.json: logic, view, view-worker and the libraries a draw script may use) is frozen:
// each version's file is the bytes its BLAKE3 hash names, and the source as it is now is the latest version, so a
// change to what runs untrusted code never ships without a new, reviewed version. A page refuses an engine whose
// bytes are not the ones named, and no source anywhere loads code from a CDN.
// Run: bun test src/lib/sandbox/engines.test.js
import { describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { enginesOf, latestOf } from './engines.js';
import { SOURCES, bundleKernel, hashText, versionOf } from './bundle.js';

const ROOT = new URL('../../../', import.meta.url).pathname;

for (const kind of Object.keys(SOURCES))
	describe(`the ${kind} engine is frozen`, () => {
		test('every version: its file is the bytes its hash names, versions in order', () => {
			const list = enginesOf(kind);
			expect(list.length).toBeGreaterThan(0);
			list.forEach((e, i) => {
				expect(e.v).toBe(i + 1);
				const bytes = readFileSync(`${ROOT}static/engines/${kind}-v${e.v}.js`);
				expect(bytes.length).toBe(e.bytes);
				expect(hashText(bytes.toString('utf8'))).toBe(e.blake3);
				expect(e.note.length).toBeGreaterThan(10);
			});
		});
		test(`the source as it is now is the latest version (else: node scripts/freeze-engine.mjs --${kind} "…")`, async () => {
			const latest = latestOf(kind);
			const now = hashText(await bundleKernel(kind));
			if (now !== latest.blake3) throw new Error(`the ${kind} engine's source changed since v${latest.v} was frozen: freeze v${latest.v + 1}, or undo the change`);
			const version = versionOf(kind);
			if (version && kind !== 'logic') expect(latest.version).toBe(version);
		}, 120000);
	});

describe('engines come only from us', () => {
	test('a changed byte is refused', async () => {
		mock.module('$app/paths', () => ({ base: '' }));
		const { frozen } = await import('./frame.js');
		const e = latestOf('view');
		const bytes = readFileSync(`${ROOT}static/engines/view-v${e.v}.js`);
		const real = globalThis.fetch;
		try {
			globalThis.fetch = async () => new Response(bytes);
			expect((await frozen(`/engines/view-v${e.v}.js`, e.blake3, 'view engine')).length).toBe(e.bytes);
			const bent = Uint8Array.from(bytes);
			bent[bent.length >> 1] ^= 1;
			globalThis.fetch = async () => new Response(bent);
			await expect(frozen(`/engines/view-v${e.v}.js`, e.blake3, 'view engine')).rejects.toThrow(/refused/);
		} finally {
			globalThis.fetch = real;
		}
	});
	test('no source names a CDN (the box probe only proves one is refused)', () => {
		const CDN = /\b(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|cdnjs\.cloudflare\.com|cdn\.skypack\.dev|ga\.jspm\.io)\b/;
		const PROBES = new Set(['src/lib/assets/box/probe.js']);
		const hits = [];
		const walk = (dir) => {
			for (const d of readdirSync(`${ROOT}${dir}`, { withFileTypes: true })) {
				const p = `${dir}/${d.name}`;
				if (d.isDirectory()) walk(p);
				else if (/\.(js|mjs|ts|svelte|html|json)$/.test(d.name) && !PROBES.has(p) && CDN.test(readFileSync(`${ROOT}${p}`, 'utf8'))) hits.push(p);
			}
		};
		for (const dir of ['src', 'game']) walk(dir);
		expect(hits).toEqual([]);
	});
});
