// @ts-nocheck — plain JS
// A read repeated as what it reads changes (./latest.js): one at a time, the one asked meanwhile once after it, every
// answer shown unless a newer one showed, a read that takes too long said so.
// Run: bun test src/lib/avendb/latest.test.js
import { expect, test } from 'bun:test';
import { latest } from './latest.js';

/** A read whose answers the test hands over one by one. */
function reads() {
	const waiting = [];
	const read = () => new Promise((resolve, reject) => waiting.push({ resolve, reject }));
	return { read, waiting };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('changes faster than a read still show every answer, one read at a time', async () => {
	const { read, waiting } = reads();
	const shown = [];
	const go = latest(read, (a) => shown.push(a));
	const done = go();
	await tick();
	// three changes while the first read runs: one more read, after it
	go();
	go();
	go();
	await tick();
	expect(waiting.length).toBe(1);
	waiting[0].resolve('first');
	await tick();
	expect(shown).toEqual(['first']);
	expect(waiting.length).toBe(2);
	waiting[1].resolve('second');
	await done;
	expect(shown).toEqual(['first', 'second']);
	// nothing more asked: nothing more read
	expect(waiting.length).toBe(2);
});

test('a failed read says why, and the next one shows its answer', async () => {
	const { read, waiting } = reads();
	const shown = [];
	const failed = [];
	const go = latest(read, (a) => shown.push(a), (e) => failed.push(e.message));
	const one = go();
	await tick();
	waiting[0].reject(new Error('device closed'));
	await one;
	expect(failed).toEqual(['device closed']);
	const two = go();
	await tick();
	waiting[1].resolve('again');
	await two;
	expect(shown).toEqual(['again']);
});

test('a read that takes too long lets the next start, and its late answer shows only if nothing newer did', async () => {
	const { read, waiting } = reads();
	const shown = [];
	const failed = [];
	const go = latest(read, (a) => shown.push(a), (e) => failed.push(e.message), 10);
	await go();
	expect(failed).toEqual(['no answer in 0 s']);
	const two = go();
	await tick();
	expect(waiting.length).toBe(2);
	waiting[1].resolve('newer');
	await two;
	waiting[0].resolve('older');
	await tick();
	expect(shown).toEqual(['newer']);

	// a slow read whose answer comes before any newer one still shows
	const three = go();
	await three;
	waiting[2].resolve('late but newest');
	await tick();
	expect(shown).toEqual(['newer', 'late but newest']);
});
