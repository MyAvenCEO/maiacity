// @ts-nocheck
import { expect, test } from 'bun:test';
import { keptAnswers, stillNamed } from './kept-answers.js';
import { createReactiveRead } from './reactive-read.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => { let resolve; const promise = new Promise((a) => (resolve = a)); return { promise, resolve }; };

test('a view that comes back paints what it showed at once, its fresh read on top', async () => {
	const kept = keptAnswers(), device = {}, op = { op: 'query', where: { type: ['room'] } };
	const pending = [], shown = [];
	const open = () => createReactiveRead({ read: () => { const d = deferred(); pending.push(d); return d.promise; }, take: (a) => shown.push(a), kept });
	const first = open();
	first.update(op, device);
	await tick();
	expect(shown).toEqual([]);
	pending[0].resolve({ ok: ['garden'] });
	await tick();
	expect(shown).toEqual([{ ok: ['garden'] }]);
	first.close();
	// the view switched away and back: the rooms paint before the device answers again
	const again = open();
	again.update(op, device);
	expect(shown).toEqual([{ ok: ['garden'] }, { ok: ['garden'] }]);
	pending[1].resolve({ ok: ['garden', 'kitchen'] });
	await tick();
	expect(shown.at(-1)).toEqual({ ok: ['garden', 'kitchen'] });
	again.close();
});

test('nothing kept crosses devices, and refusals are never kept', async () => {
	const kept = keptAnswers();
	const [a, b] = [{}, {}];
	kept.keep(a, 'k', { ok: 1 });
	expect(kept.get(a, 'k')).toEqual({ ok: 1 });
	expect(kept.get(b, 'k')).toBeUndefined();
	kept.keep(a, 'r', { refused: 'NoEntry', why: 'not here' });
	expect(kept.get(a, 'r')).toBeUndefined();
	expect(kept.get(null, 'k')).toBeUndefined();
});

test('at most `most` per device, the one read longest ago going first', () => {
	const kept = keptAnswers(2), d = {};
	kept.keep(d, 'a', { ok: 'a' });
	kept.keep(d, 'b', { ok: 'b' });
	kept.get(d, 'a');
	kept.keep(d, 'c', { ok: 'c' });
	expect(kept.get(d, 'b')).toBeUndefined();
	expect(kept.get(d, 'a')).toEqual({ ok: 'a' });
	expect(kept.get(d, 'c')).toEqual({ ok: 'c' });
});

test('rows stay where only the entries a list names change', () => {
	const before = { op: 'entry_views', entries: ['a', 'b'], types: ['room'] };
	expect([...stillNamed(before, { ...before, entries: ['a', 'c'] })]).toEqual(['a', 'c']);
	expect(stillNamed(before, { ...before, types: ['doc'] })).toBeNull();
	expect(stillNamed({ op: 'entry_views', vault: 'v' }, { op: 'entry_views', vault: 'w' })).toBeNull();
});
