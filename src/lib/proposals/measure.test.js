// @ts-nocheck — plain JS
// Measuring an AIP on the device of whoever accepts it: measuring logic on main runs on an AIP's records in the logic
// host, the same numbers on every run, on a measurement's budget, and is recorded once per side and version.
// Run: bun test src/lib/proposals/measure.test.js
import { describe, expect, test } from 'bun:test';
import { FIRST, MAX_READINGS, inputOf, logicOf, measureAip, measureOnce, noteOf, readingsOf, tagOf } from './measure.js';
import { runOnce } from '../sandbox/logic-host.js';

// a measuring logic: the corn's height in the proposal, and a little sim of how much the valley harvests at it
const SIM = `export function measure(input) {
	const corn = input.lines.find((l) => l.type === 'logic' || l.type === 'config');
	const h = corn?.record?.params?.find((p) => p.id === 1)?.default ?? 0;
	let food = 0;
	for (let day = 0; day < 1000; day++) food += h * (1 + Math.sin(day / 50)) + Math.random() * 0.001;
	return { height: h, food: Math.round(food) };
}`;

const record = (h) => ({ params: [{ id: 1, name: 'height', default: h }] });
const lines = (h0, h1, heads = ['e1']) => [{ entry: 'c0ffee', line: 'l1', type: 'config', tags: ['game:sandbox-5'], heads, main: record(h0), proposed: record(h1) }];

describe('one run of a measuring logic', () => {
	test('it reads one side of the lines and hands back named numbers, the same every run', async () => {
		const a = await measureOnce(SIM, inputOf(lines(0.6, 0.8), 'proposed'), FIRST);
		expect(a.error).toBeUndefined();
		expect(Object.fromEntries(a.readings).height).toBe(0.8);
		const b = await measureOnce(SIM, inputOf(lines(0.6, 0.8), 'proposed'), FIRST);
		expect(b.readings).toEqual(a.readings);
		const main = await measureOnce(SIM, inputOf(lines(0.6, 0.8), 'main'), FIRST);
		expect(Object.fromEntries(main.readings).height).toBe(0.6);
		expect(Object.fromEntries(main.readings).food).toBeLessThan(Object.fromEntries(a.readings).food);
	});

	test('what it may not do or hand back makes no reading', async () => {
		const input = inputOf(lines(0.6, 0.8), 'proposed');
		expect((await measureOnce('export const run = () => 1;', input, FIRST)).error).toContain('measure');
		expect((await measureOnce('import x from "y"; export const measure = () => ({});', input, FIRST)).error).toContain('imports');
		expect((await measureOnce('export const measure = () => [1];', input, FIRST)).error).toContain('named numbers');
		expect((await measureOnce('export const measure = () => ({ a: "1" });', input, FIRST)).error).toContain('finite number');
		expect((await measureOnce('export const measure = () => ({ a: 1e30 });', input, FIRST)).error).toContain('10^24');
		const many = Object.fromEntries(Array.from({ length: MAX_READINGS + 1 }, (_, i) => [`n${i}`, i]));
		expect((await measureOnce(`export const measure = () => (${JSON.stringify(many)});`, input, FIRST)).error).toContain('at most');
		expect((await measureOnce('export const measure = () => { throw new Error("no"); };', input, FIRST)).error).toContain('no');
		expect((await measureOnce('export const measure = () => { for (;;) {} };', input, FIRST)).error).toBe('ran too long');
	});

	test('it runs on a measurement’s budget, past a game rule’s, from logic engine 2 on alone', async () => {
		const code = 'export function measure() { let n = 0; for (let i = 0; i < 3e6; i++) n += i % 7; return { n }; }';
		expect((await measureOnce(code, { lines: [] }, FIRST)).readings).toEqual([['n', 8999994]]);
		// the same work on a game rule's budget runs too long
		expect((await runOnce({ code, kind: 'call', name: 'measure', json: '{}', engine: 1, limits: { call: { ticks: 20000 } } })).error).toBe('ran too long');
		expect((await measureOnce(code, { lines: [] }, 1)).error).toContain('logic engine 2 or later');
		expect((await measureOnce(code, { lines: [] })).error).toContain('logic engine 2 or later');
	});

	test('it sees nothing of the host: no fetch, no clock, no buffers', async () => {
		const code = 'export const measure = () => ({ fetch: typeof fetch === "undefined" ? 1 : 0, now: Date.now(), buffers: typeof ArrayBuffer === "undefined" ? 1 : 0 });';
		const r = await measureOnce(code, { lines: [] }, FIRST);
		expect(Object.fromEntries(r.readings)).toEqual({ fetch: 1, now: 0, buffers: 1 });
	});
});

/** a vault as the device reads it: one AIP naming `measures`, the logic on main, the AIP's lines; `write` records */
function vault({ measures = ['valley-sim'], code = SIM, at = lines(0.6, 0.8), stage = 'objective', logic = 1, engine = FIRST } = {}) {
	const a = { entry: 'a1', stage, outcome: null, objective: { measures, readings: [] } };
	const wrote = [];
	const ask = async (op) => {
		if (op.op === 'query') {
			const tag = op.where.all[1].tag;
			const row = { entry: 'f00d', tags: [tag], record: { kind: 'logic', engine: { host: 'logic', version: engine }, source: code } };
			return { rows: tag === tagOf('valley-sim') ? Array.from({ length: logic }, () => row) : [] };
		}
		if (op.op === 'aip_records') return { entry: op.entry, lines: at };
		throw new Error(`no ${op.op}`);
	};
	const write = (ops) => {
		for (const op of ops) {
			wrote.push(op);
			a.objective.readings.push({ id: wrote.length, name: op.name, value: op.value, note: op.note, measured: true, by: op.as });
		}
	};
	return { a, wrote, ask, write, set: (x) => (at = x) };
}

/** `v`'s AIP measured as `me`, and what it measured recorded: the rows */
async function measured(v, me = 'me') {
	const rows = await measureAip({ ask: v.ask, a: v.a, vault: 'v', me });
	v.write(readingsOf(v.a.entry, rows, me));
	return rows;
}

describe('measuring an AIP on the device of whoever accepts it', () => {
	test('main once as the baseline, then the proposal; nothing again until the lines change', async () => {
		const v = vault();
		const first = await measured(v);
		expect(first.map((r) => r.side)).toEqual(['main', 'proposed']);
		expect(v.wrote.map((w) => [w.name, w.value])).toEqual([...first[0].readings, ...first[1].readings]);
		expect(v.wrote.every((w) => w.op === 'aip_measure' && w.entry === 'a1' && w.as === 'me')).toBe(true);
		expect(v.wrote[0].note).toStartWith('logic "valley-sim" ');
		expect(v.wrote[0].note).toEndWith(' on main');
		expect(v.wrote[2].note).toContain(' on the proposal ');
		expect(await measured(v)).toEqual([]);
		v.set(lines(0.6, 0.9, ['e2']));
		const again = await measured(v);
		expect(again.map((r) => r.side)).toEqual(['proposed']);
		expect(Object.fromEntries(again[0].readings).height).toBe(0.9);
	});

	test('another’s readings never stand for its own', async () => {
		const v = vault();
		v.a.objective.readings.push({ id: 1, name: 'height', value: 0.8, note: noteOf('valley-sim', 'x', 'main', 'y'), measured: true, by: 'them' });
		expect((await measured(v)).map((r) => r.side)).toEqual(['main', 'proposed']);
	});

	test('measuring alone writes nothing; an archived AIP, or one naming no logic, is left alone', async () => {
		const v = vault();
		expect((await measureAip({ ask: v.ask, a: v.a, vault: 'v', me: 'me' })).length).toBe(2);
		expect(v.wrote).toEqual([]);
		for (const o of [{ stage: 'archived' }, { stage: 'idea' }, { measures: [] }]) {
			const w = vault(o);
			expect(await measured(w)).toEqual([]);
		}
	});

	test('a logic missing, doubled, failing or made for engine 1 says why and records nothing', async () => {
		for (const [o, why] of [
			[{ measures: ['other'] }, 'no logic entry on main is tagged ref:logic/measures/other'],
			[{ logic: 2 }, '2 logic entries are tagged'],
			[{ code: 'export const measure = () => { for (;;) {} };' }, 'ran too long'],
			[{ engine: 1 }, 'logic engine 2 or later']
		]) {
			const v = vault(o);
			const got = await measured(v);
			expect(got[0].error).toContain(why);
			expect(v.wrote).toEqual([]);
		}
	});

	test('the logic as main holds it, keyed by its code', async () => {
		const v = vault();
		const a = await logicOf(v.ask, 'v', 'valley-sim');
		expect(a.entry).toBe('f00d');
		expect(a.key).toMatch(/^[0-9a-f]{8}$/);
		expect((await logicOf(vault({ code: SIM + ' ' }).ask, 'v', 'valley-sim')).key).not.toBe(a.key);
	});
});
