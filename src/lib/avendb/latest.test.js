// @ts-nocheck — plain JS
// A read repeated as what it reads changes (./latest.js): one at a time, the one asked meanwhile once after it and a
// rest, every answer shown unless a newer one showed, a slow read said so and waited for, a lost one let go of.
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
	const go = latest(read, (a) => shown.push(a), undefined, undefined, () => 0);
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
	const go = latest(read, (a) => shown.push(a), (e) => failed.push(e.message), undefined, () => 0);
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

test('a slow read says so and is still waited for; one taken for lost lets the next start', async () => {
	const { read, waiting } = reads();
	const shown = [];
	const failed = [];
	const go = latest(read, (a) => shown.push(a), (e) => failed.push(e.message), 10, () => 0);
	const one = go();
	await new Promise((r) => setTimeout(r, 20));
	expect(failed).toEqual(['no answer yet after 0 s']);
	// still waited for: a change meanwhile reads once it ends, nothing piles up
	go();
	go();
	expect(waiting.length).toBe(1);
	waiting[0].resolve('slow');
	await new Promise((r) => setTimeout(r, 5));
	expect(shown).toEqual(['slow']);
	expect(waiting.length).toBe(2);
	waiting[1].resolve('next');
	await one;
	expect(shown).toEqual(['slow', 'next']);

	// a read whose answer never comes is let go of four times its patience later
	const lostOne = go();
	await lostOne;
	expect(waiting.length).toBe(3);
	const after = go();
	await new Promise((r) => setTimeout(r, 5));
	expect(waiting.length).toBe(4);
	waiting[3].resolve('newer');
	await after;
	waiting[2].resolve('older');
	await tick();
	expect(shown).toEqual(['slow', 'next', 'newer']);
});

test('a read asked meanwhile rests after the one that ran, unless the person asked it at once', async () => {
	const { read, waiting } = reads();
	const shown = [];
	const go = latest(read, (a) => shown.push(a), undefined, undefined, () => 60);
	const done = go();
	await tick();
	go();
	waiting[0].resolve('first');
	await tick();
	// resting: the second read waits
	expect(waiting.length).toBe(1);
	await new Promise((r) => setTimeout(r, 80));
	expect(waiting.length).toBe(2);
	go();
	waiting[1].resolve('second');
	await tick();
	expect(waiting.length).toBe(2);
	// the person asks: the rest ends at once
	go(true);
	await tick();
	expect(waiting.length).toBe(3);
	waiting[2].resolve('third');
	await done;
	expect(shown).toEqual(['first', 'second', 'third']);
});
