// @ts-nocheck — plain JS
// The jobs' executors (./executors.js) and what the legacy studio brought into avenDB: its words beside a file, its
// proxies, read by tags, never from the old vault.
// Run: bun test src/lib/studio/jobs/executors.test.js
import { expect, test } from 'bun:test';
import { legacyValue, NATIVE } from './executors.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

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
	const o = { entry: 'o', vault: 'V', type: 'file', tags: ['media:original', `legacy:${A}`] };
	const p = { entry: 'p', vault: 'V', type: 'file', tags: ['media:proxy', `legacy:${A}`, `legacy:${B}`] };
	const world = { entries: [o, p] };
	expect(legacyValue('proxy', o, world)?.entry).toBe('p');
	const task = { rule: 'proxy', inputs: [{ entry: 'o' }], params: JSON.stringify({ 'probe.journey': { profile: 'apple-log' } }) };
	const ctx = { world, entry: (/** @type {string} */ id) => world.entries.find((e) => e.entry === id) };
	expect(await NATIVE.proxy(task, ctx)).toEqual({ outputs: ['p'], result: { profile: 'apple-log', legacy: true } });
});

test("a world shot's proxy brought before its render ran is taken by the world-proxy rule", async () => {
	const v = { entry: 'v2', vault: 'V', type: 'shot', record: { shot: 's1', version: 2 } };
	const p = { entry: 'p', vault: 'V', type: 'file', tags: ['media:proxy', 'proxy:shot:s1:2'] };
	const older = { entry: 'q', vault: 'V', type: 'file', tags: ['media:proxy', 'proxy:shot:s1:1'] };
	const world = { entries: [v, older, p] };
	const task = { rule: 'world-proxy', inputs: [{ entry: 'v2' }], params: '{}' };
	const ctx = { world, entry: (/** @type {string} */ id) => world.entries.find((e) => e.entry === id) };
	expect(await NATIVE['world-proxy'](task, ctx)).toEqual({ outputs: ['p'], result: { shot: 'shot:s1', shotVersion: 2, legacy: true } });
});
