// @ts-nocheck — plain JS
// Real Lean's verdict on an AIP's objective, as the page records and reads it (./lean.js).

import { expect, test } from 'bun:test';
import { leanDue, mb, verdictLine, verdictName, verdictOf } from './lean.js';

test('a verdict is a reading named for the objective, one or zero, the Lean in its note', () => {
	const engine = 'lean-4.35.0 c0c6f34f objective 0123456789abcdef';
	expect(verdictName('fedcba9876543210')).toBe('lean:fedcba9876543210');
	expect(verdictOf('e1', { ok: true, key: 'k1', engine, error: null }, 'v1')).toEqual({
		op: 'aip_measure',
		entry: 'e1',
		name: 'lean:k1',
		value: 1,
		note: engine,
		as: 'v1'
	});
	const bad = verdictOf('e1', { ok: false, key: 'k1', engine, error: { line: 1, column: 5, message: 'unknown namespace' } }, 'v1');
	expect(bad.value).toBe(0);
	expect(bad.note).toBe(`${engine}: 1:5 unknown namespace`);
	expect(verdictLine({ ok: false, note: bad.note })).toBe('Lean rejects it at 1:5 unknown namespace');
	expect(verdictLine({ ok: true, note: engine })).toBe('Lean accepts it');
	expect(verdictLine({ ok: false, note: null })).toBe('Lean rejects it');
});

test('a Measurer checks an objective that reads, once for its verdict', () => {
	expect(leanDue(null, 'v1')).toBe(false);
	expect(leanDue({ error: 'line 1' }, 'v1')).toBe(false);
	expect(leanDue({ verdict: null }, 'v1')).toBe(true);
	expect(leanDue({ verdict: { by: 'v2' } }, 'v1')).toBe(true);
	expect(leanDue({ verdict: { by: 'v1' } }, 'v1')).toBe(false);
});

test('sizes read in megabytes', () => {
	expect(mb(570_422_530)).toBe('570 MB');
	expect(mb(543_661_464)).toBe('544 MB');
});
