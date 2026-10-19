// @ts-nocheck — plain JS
// Every kernel engine (./engines.json: logic, view, view-worker and the libraries a draw script may use) is frozen:
// each version's file is the bytes its BLAKE3 hash names, and the source as it is now is the latest version, so a
// change to what runs untrusted code never ships without a new, reviewed version. A page refuses an engine whose
// bytes are not the ones named, and no source anywhere loads code from a CDN. Code runs on the engine it names, never
// below its kind's floor, and every frozen version stays loadable.
// Run: bun test src/lib/sandbox/engines.test.js
import { describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { FLOOR, WORKERS, engineFor, enginesOf, latestOf, workerFor } from './engines.js';
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

describe('code runs on the engine it names (H4)', () => {
	test('the version it names, never one below the floor; none, the floor; one not frozen, nothing', () => {
		// a kind with five frozen versions and its floor at 3, as a view's might be once a later engine changes what
		// views do: each names its own, an older or none runs on the floor
		const list = [1, 2, 3, 4, 5].map((v) => ({ v, blake3: `${v}`.repeat(64), bytes: 1, date: '', note: '' }));
		const at = (named) => engineFor('view', named, list, 3)?.v;
		expect([at(5), at(4), at(3)]).toEqual([5, 4, 3]);
		expect([at(2), at(1), at(undefined), at(null), at(0), at(-4), at(3.5), at('5')]).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
		expect([at(6), at(99)]).toEqual([undefined, undefined]);
	});
	test("each kind's floor is a frozen version, and a view engine starts its script in a worker frozen for it", () => {
		for (const [kind, v] of Object.entries(FLOOR)) expect(enginesOf(kind).some((e) => e.v === v)).toBe(true);
		expect(engineFor('view', undefined).v).toBe(FLOOR.view);
		expect(engineFor('logic', undefined).v).toBe(FLOOR.logic);
		// the views the vault holds name view engine 2: they run on the floor, with its walls (G7, G8)
		expect(engineFor('view', 2).v).toBe(FLOOR.view);
		for (const e of enginesOf('view')) {
			expect(enginesOf('view-worker').some((w) => w.v === WORKERS[e.v])).toBe(true);
			expect(workerFor(e.v).v).toBeGreaterThanOrEqual(FLOOR['view-worker']);
		}
		expect(workerFor(FLOOR.view).v).toBe(WORKERS[FLOOR.view]);
	});
	test('every frozen version stays loadable: served from our site, its bytes the ones its hash names', async () => {
		mock.module('$app/paths', () => ({ base: '' }));
		const { frozen } = await import('./frame.js');
		const real = globalThis.fetch;
		try {
			for (const kind of ['view', 'view-worker', 'logic'])
				for (const e of enginesOf(kind)) {
					globalThis.fetch = async (url) => new Response(readFileSync(`${ROOT}static${url}`));
					expect(hashText(await frozen(`/engines/${kind}-v${e.v}.js`, e.blake3, `${kind} engine ${e.v}`))).toBe(e.blake3);
				}
		} finally {
			globalThis.fetch = real;
		}
	});
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
	test('no source names a CDN (the box probe and the checker\'s hostile views only prove one is refused)', () => {
		const CDN = /\b(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|cdnjs\.cloudflare\.com|cdn\.skypack\.dev|ga\.jspm\.io)\b/;
		const PROBES = new Set(['src/lib/assets/box/probe.js', 'src/lib/code/check.test.js']);
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
