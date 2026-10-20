// @ts-nocheck — plain JS
// The Measurer's job: measuring logic on main runs on an AIP's records in the logic host, the same numbers on every
// run, and the job records them once per side and version.
// Run: bun test src/lib/proposals/measure.test.js
import { describe, expect, test } from 'bun:test';
import { MAX_READINGS, inputOf, logicOf, measureOnce, measureRound, noteOf, tagOf } from './measure.js';

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
		const a = await measureOnce(SIM, inputOf(lines(0.6, 0.8), 'proposed'));
		expect(a.error).toBeUndefined();
		expect(Object.fromEntries(a.readings).height).toBe(0.8);
		const b = await measureOnce(SIM, inputOf(lines(0.6, 0.8), 'proposed'));
		expect(b.readings).toEqual(a.readings);
		const main = await measureOnce(SIM, inputOf(lines(0.6, 0.8), 'main'));
		expect(Object.fromEntries(main.readings).height).toBe(0.6);
		expect(Object.fromEntries(main.readings).food).toBeLessThan(Object.fromEntries(a.readings).food);
	});

	test('what it may not do or hand back makes no reading', async () => {
		const input = inputOf(lines(0.6, 0.8), 'proposed');
		expect((await measureOnce('export const run = () => 1;', input)).error).toContain('measure');
		expect((await measureOnce('import x from "y"; export const measure = () => ({});', input)).error).toContain('imports');
		expect((await measureOnce('export const measure = () => [1];', input)).error).toContain('named numbers');
		expect((await measureOnce('export const measure = () => ({ a: "1" });', input)).error).toContain('finite number');
		expect((await measureOnce('export const measure = () => ({ a: 1e30 });', input)).error).toContain('10^24');
		const many = Object.fromEntries(Array.from({ length: MAX_READINGS + 1 }, (_, i) => [`n${i}`, i]));
		expect((await measureOnce(`export const measure = () => (${JSON.stringify(many)});`, input)).error).toContain('at most');
		expect((await measureOnce('export const measure = () => { throw new Error("no"); };', input)).error).toContain('no');
		expect((await measureOnce('export const measure = () => { for (;;) {} };', input)).error).toBe('ran too long');
	});

	test('it sees nothing of the host: no fetch, no clock, no buffers', async () => {
		const code = 'export const measure = () => ({ fetch: typeof fetch === "undefined" ? 1 : 0, now: Date.now(), buffers: typeof ArrayBuffer === "undefined" ? 1 : 0 });';
		const r = await measureOnce(code, { lines: [] });
		expect(Object.fromEntries(r.readings)).toEqual({ fetch: 1, now: 0, buffers: 1 });
	});
});

/** a vault as the job's agent reads it: one AIP naming `measures`, the logic on main, the AIP's lines */
function vault({ measures = ['valley-sim'], code = SIM, at = lines(0.6, 0.8), stage = 'objective', logic = 1 } = {}) {
	const aip = { entry: 'a1', stage, outcome: null, objective: { measures, readings: [] } };
	const wrote = [];
	const ask = async (op) => {
		if (op.op === 'aips') return [aip];
		if (op.op === 'query') {
			const tag = op.where.all[1].tag;
			const row = { entry: 'f00d', tags: [tag], record: { kind: 'logic', engine: { host: 'logic', version: 1 }, source: code } };
			return { rows: tag === tagOf('valley-sim') ? Array.from({ length: logic }, () => row) : [] };
		}
		if (op.op === 'aip_records') return { entry: op.entry, lines: at };
		throw new Error(`no ${op.op}`);
	};
	const run = async (op) => {
		wrote.push(op);
		aip.objective.readings.push({ id: wrote.length, name: op.name, value: op.value, note: op.note, measured: true, by: 'me' });
		return { entry: op.entry };
	};
	return { aip, wrote, ask, run, set: (x) => (at = x) };
}

describe('a round of the Measurer', () => {
	test('main once as the baseline, then the proposal; nothing again until the lines change', async () => {
		const v = vault();
		const first = await measureRound({ ...v, vault: 'v', me: 'me' });
		expect(first.map((r) => r.side)).toEqual(['main', 'proposed']);
		expect(v.wrote.map((w) => [w.name, w.value])).toEqual([...first[0].readings, ...first[1].readings]);
		expect(v.wrote[0].note).toStartWith('logic "valley-sim" ');
		expect(v.wrote[0].note).toEndWith(' on main');
		expect(v.wrote[2].note).toContain(' on the proposal ');
		expect(await measureRound({ ...v, vault: 'v', me: 'me' })).toEqual([]);
		v.set(lines(0.6, 0.9, ['e2']));
		const again = await measureRound({ ...v, vault: 'v', me: 'me' });
		expect(again.map((r) => r.side)).toEqual(['proposed']);
		expect(Object.fromEntries(again[0].readings).height).toBe(0.9);
	});

	test('another Measurer’s readings never stand for its own', async () => {
		const v = vault();
		v.aip.objective.readings.push({ id: 1, name: 'height', value: 0.8, note: noteOf('valley-sim', 'x', 'main', 'y'), measured: true, by: 'them' });
		expect((await measureRound({ ...v, vault: 'v', me: 'me' })).map((r) => r.side)).toEqual(['main', 'proposed']);
	});

	test('a dry round writes nothing; an archived AIP, or one naming no logic, is left alone', async () => {
		const v = vault();
		expect((await measureRound({ ...v, vault: 'v', me: 'me', dry: true })).length).toBe(2);
		expect(v.wrote).toEqual([]);
		for (const o of [{ stage: 'archived' }, { stage: 'idea' }, { measures: [] }]) {
			const w = vault(o);
			expect(await measureRound({ ...w, vault: 'v', me: 'me' })).toEqual([]);
		}
	});

	test('a logic missing, doubled or failing says why and records nothing', async () => {
		for (const [o, why] of [
			[{ measures: ['other'] }, 'no logic entry on main is tagged ref:logic/measures/other'],
			[{ logic: 2 }, '2 logic entries are tagged'],
			[{ code: 'export const measure = () => { for (;;) {} };' }, 'ran too long']
		]) {
			const v = vault(o);
			const got = await measureRound({ ...v, vault: 'v', me: 'me' });
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
