// @ts-nocheck — plain JS
// Import from the legacy studio (./importer.js): exactly the files a timeline plays, renamed as avenDB names them.
// Run: bun test src/lib/studio/importer.test.js
import { expect, test } from 'bun:test';
import { filesOf, moved } from './importer.js';
import { legacyValue } from './jobs/executors.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

test('a timeline brings each file it plays once; world clips and avenDB files stay', () => {
	const t = {
		clips: [
			{ id: 'c1', track: 'V1', kind: 'media', hash: A },
			{ id: 'c2', track: 'A1', kind: 'media', hash: A },
			{ id: 'c3', track: 'A2', kind: 'media', hash: B },
			{ id: 'w1', track: 'V1', kind: 'world', shot: 'uuid-1', shotVersion: 3 },
			{ id: 'c4', track: 'V1', kind: 'media', hash: 'aven:r:1:1:' }
		]
	};
	expect(filesOf(t)).toEqual([A, B]);
	const out = moved(t, new Map([[A, 'aven:x:2:1:video%2Fmp4']]), new Map([['uuid-1@3', { shot: 'shot:e1', version: 1 }]]));
	expect(out.clips.map((c) => c.hash ?? `${c.shot}@${c.shotVersion}`)).toEqual(['aven:x:2:1:video%2Fmp4', 'aven:x:2:1:video%2Fmp4', B, 'shot:e1@1', 'aven:r:1:1:']);
});

test("a brought file's legacy words are found beside it, in its own vault only", () => {
	const o = { entry: 'o', vault: 'V', type: 'file', tags: ['media:original', `legacy:${A}`] };
	const w = { entry: 'w', vault: 'V', type: 'file', tags: ['media:transcript', `legacy:${A}`] };
	const other = { entry: 'x', vault: 'W', type: 'file', tags: ['media:analysis', `legacy:${A}`] };
	const world = { entries: [o, w, other] };
	expect(legacyValue('transcript', o, world)?.entry).toBe('w');
	expect(legacyValue('analysis', o, world)).toBeUndefined();
	expect(legacyValue('transcript', { ...o, tags: ['media:original'] }, world)).toBeUndefined();
});

test("a brought film's legacy proxy is taken by the proxy rule while its journey is the one found", async () => {
	const { NATIVE } = await import('./jobs/executors.js');
	const o = { entry: 'o', vault: 'V', type: 'file', tags: ['media:original', `legacy:${A}`] };
	const p = { entry: 'p', vault: 'V', type: 'file', tags: ['media:proxy', `legacy:${A}`, `legacy:${B}`] };
	const world = { entries: [o, p] };
	expect(legacyValue('proxy', o, world)?.entry).toBe('p');
	const task = { rule: 'proxy', inputs: [{ entry: 'o' }], params: JSON.stringify({ 'probe.journey': { profile: 'apple-log' } }) };
	const ctx = { world, entry: (/** @type {string} */ id) => world.entries.find((e) => e.entry === id) };
	expect(await NATIVE.proxy(task, ctx)).toEqual({ outputs: ['p'], result: { profile: 'apple-log', legacy: true } });
});

test("a world shot's proxy brought before its render ran is taken by the world-proxy rule", async () => {
	const { NATIVE } = await import('./jobs/executors.js');
	const v = { entry: 'v2', vault: 'V', type: 'shot', record: { shot: 's1', version: 2 } };
	const p = { entry: 'p', vault: 'V', type: 'file', tags: ['media:proxy', 'proxy:shot:s1:2'] };
	const older = { entry: 'q', vault: 'V', type: 'file', tags: ['media:proxy', 'proxy:shot:s1:1'] };
	const world = { entries: [v, older, p] };
	const task = { rule: 'world-proxy', inputs: [{ entry: 'v2' }], params: '{}' };
	const ctx = { world, entry: (/** @type {string} */ id) => world.entries.find((e) => e.entry === id) };
	expect(await NATIVE['world-proxy'](task, ctx)).toEqual({ outputs: ['p'], result: { shot: 'shot:s1', shotVersion: 2, legacy: true } });
});
