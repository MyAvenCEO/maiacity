// @ts-nocheck — plain JS
// The logic core: code we cannot trust decides the same on every device (seeded random, frozen clock, work counted
// in ticks), reaches nothing but the language, and is stopped when it loops, eats memory or throws. Its engine is
// frozen like every kernel engine (./engines.test.js).
// Run: bun test src/lib/sandbox/logic.test.js
import { describe, expect, test } from 'bun:test';
import { LIMITS, open, quickjs, seedOf } from './logic.js';
import { load, runOnce } from './logic-host.js';

const QJS = await quickjs();
const one = (code, json = '{}', o = {}) => {
	const u = open(QJS, { code, ...o });
	try {
		if (u.error) return { error: u.error };
		return { out: u.call('call', 'run', json) };
	} catch (e) {
		return { error: e.message };
	} finally {
		u.dispose();
	}
};

describe('the same answer on every device', () => {
	const RANDOM = 'export const run = () => [Math.random(), Math.random(), Math.random()];';
	test('Math.random is seeded: the same seed, the same numbers; another seed, others', () => {
		const a = one(RANDOM, '{}', { seed: 42 }).out;
		expect(one(RANDOM, '{}', { seed: 42 }).out).toBe(a);
		expect(one(RANDOM, '{}', { seed: 43 }).out).not.toBe(a);
		for (const x of JSON.parse(a)) expect(x >= 0 && x < 1).toBe(true);
		// the numbers are the generator's, here as on any engine (mulberry32 of 42)
		expect(JSON.parse(a)[0]).toBeCloseTo(0.6011037519201636, 12);
	});
	test('Math.random cannot be put back', () => {
		expect(one('Math.random = () => 0.5; export const run = () => Math.random();', '{}', { seed: 1 }).error ?? '').not.toBe('');
		const r = one('try { Object.defineProperty(Math, "random", { value: () => 0.5 }); } catch {} export const run = () => Math.random();', '{}', { seed: 1 });
		expect(JSON.parse(r.out)).not.toBe(0.5);
	});
	test('the clock is frozen at now', () => {
		const at = Date.UTC(2026, 9, 16, 12);
		const r = JSON.parse(one('export const run = () => [Date.now(), new Date().getTime(), new Date(0).getTime(), new Date() instanceof Date, typeof Date()];', '{}', { now: at }).out);
		expect(r).toEqual([at, at, 0, true, 'string']);
		expect(one('Date = function () {}; export const run = () => 1;').error ?? '').not.toBe('');
	});
	test('seedOf: the same text, the same seed', () => {
		expect(seedOf('a')).toBe(seedOf('a'));
		expect(seedOf('a')).not.toBe(seedOf('b'));
	});
});

describe('nothing but the language', () => {
	for (const [what, code] of [
		['no binary buffers', 'export const run = () => typeof ArrayBuffer + typeof Uint8Array + typeof SharedArrayBuffer + typeof DataView + typeof WeakRef;'],
		['no network, storage or timers', 'export const run = () => [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof setTimeout, typeof localStorage, typeof indexedDB, typeof importScripts, typeof postMessage, typeof self, typeof window, typeof require, typeof process, typeof std, typeof os].join();']
	])
		test(what, () => {
			expect(JSON.parse(one(code).out).split(',').every((t) => t === 'undefined' || t.match(/^(undefined)+$/))).toBe(true);
		});
	test('no import of anything', () => {
		expect(one('import x from "std"; export const run = () => 1;').error).toBeTruthy();
		expect(one('export const run = async () => (await import("os")).exec;').out).toBe('{}');
	});
	test('what crosses is JSON: a function or a cycle is refused, not run', () => {
		expect(one('export const run = (x) => x.a + 1;', '{"a":1}').out).toBe('2');
		expect(one('export const run = () => { const a = {}; a.a = a; return a; };').error).toMatch(/circular|cyclic/i);
	});
});

describe('stopped, and the same way everywhere', () => {
	test('a loop is stopped by its work, the same tick on every run', () => {
		const loop = 'export const run = () => { for (;;) {} };';
		const u1 = open(QJS, { code: loop });
		const u2 = open(QJS, { code: loop });
		expect(() => u1.call('call', 'run', '{}')).toThrow('ran too long');
		expect(() => u2.call('call', 'run', '{}')).toThrow('ran too long');
		expect(u1.ticks).toBe(LIMITS.call.ticks + 1);
		expect(u2.ticks).toBe(u1.ticks);
		u1.dispose();
		u2.dispose();
	});
	test('a loop at load is stopped too', () => {
		expect(one('for (;;) {} export const run = () => 1;').error).toBe('ran too long');
	});
	test('work within its share runs to the end', () => {
		expect(one('export const run = () => { let s = 0; for (let i = 0; i < 100000; i++) s += i; return s; };').out).toBe(String((100000 * 99999) / 2));
	});
	test('memory: a big string or array is stopped', () => {
		expect(one('export const run = () => { let s = "x"; for (;;) s += s; };').error).toMatch(/MB|memory|too long/);
		expect(one('export const run = () => { const a = []; for (;;) a.push({ a: [1, 2, 3] }); };').error).toMatch(/MB|memory|too long/);
	});
	test('deep recursion is stopped', () => {
		expect(one('const f = (n) => f(n + 1) + 1; export const run = () => f(0);').error).toMatch(/stack|too long/i);
	});
	test('a throw is its message', () => {
		expect(one('export const run = () => { throw new TypeError("no"); };').error).toBe('TypeError: no');
	});
	test('exports lists the functions only', () => {
		const u = open(QJS, { code: 'export const a = () => 1; export function b() {} export const c = 3;' });
		expect(u.exports.sort()).toEqual(['a', 'b']);
		u.dispose();
	});
});

describe('the host, outside a page: the core in the process', () => {
	test('runOnce and load answer as the engine does', async () => {
		expect(await runOnce({ code: 'export const run = (x) => x.n * 2;', kind: 'call', name: 'run', json: '{"n":21}' })).toEqual({ exports: ['run'], out: '42' });
		expect((await runOnce({ code: 'export const go = () => 1;', kind: 'call', name: 'run', json: '{}' })).error).toBe('it exports no run');
		const p = await load([{ code: 'export const init = (d) => ({ ...d, n: Math.random() });' }, { code: 'syntax error here' }], { seed: 7 });
		expect(p.units[0].exports).toEqual(['init']);
		expect(p.units[1].error).toBeTruthy();
		const a = JSON.parse(await p.call(0, 'view', 'init', '{"on":false,"d":{"x":1}}'));
		expect(a.x).toBe(1);
		await p.end();
	});
	test('code runs on the logic engine it names, or the floor; one naming an engine not frozen runs nowhere (H4)', async () => {
		const run = (engine) => runOnce({ code: 'export const run = (x) => x.n + 1;', kind: 'call', name: 'run', json: '{"n":1}', engine });
		for (const engine of [undefined, 1]) expect(await run(engine)).toEqual({ exports: ['run'], out: '2' });
		expect(await run(99)).toEqual({ exports: [], error: 'it is made for logic engine 99, which this page does not have' });
		await expect(load([{ code: 'export const init = (d) => d;' }], { engine: 99 })).rejects.toThrow(/logic engine 99/);
	});
});
