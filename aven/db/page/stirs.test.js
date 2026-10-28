// @ts-nocheck — Bun tests, as the other JS suites
import { expect, test } from 'bun:test';
import { watchStirs } from './stirs.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('an unchanged device waits without rereading; stop abandons an outstanding wait', async () => {
	let reads = 0;
	const waiting = deferred();
	const revisions = [];
	const stop = watchStirs({ stirred: (n) => { revisions.push(n); return waiting.promise; } }, () => reads++, { settle: 0 });
	await tick();
	expect(reads).toBe(1);
	expect(revisions).toEqual([0]);
	stop();
	waiting.resolve(4);
	await tick();
	expect(reads).toBe(1);
});

test('long-poll timeouts renew the wait without data reads; a revision reads again', async () => {
	let reads = 0, calls = 0;
	const waiting = deferred(), idle = deferred();
	const revisions = [];
	const stop = watchStirs({ stirred: (n) => { revisions.push(n); return ++calls === 1 ? Promise.resolve(null) : calls === 2 ? waiting.promise : idle.promise; } }, () => reads++, { settle: 0 });
	try {
		await tick();
		expect(reads).toBe(1);
		expect(revisions).toEqual([0, 0]);
		waiting.resolve(7);
		await tick();
		expect(reads).toBe(2);
		expect(revisions).toEqual([0, 0, 7]);
	} finally { stop(); idle.resolve(-1); }
});

test('a disposed slow read receives cancellation and never starts a wait', async () => {
	const pending = deferred();
	let signal, waited = false;
	const stop = watchStirs({ stirred: () => { waited = true; return Promise.resolve(1); } }, async (s) => { signal = s; await pending.promise; });
	await tick();
	stop();
	expect(signal.aborted).toBe(true);
	pending.resolve();
	await tick();
	expect(waited).toBe(false);
});

test('replacing a device starts from its own revision even if the old device never answers', async () => {
	const pending = deferred();
	const stopOld = watchStirs({ stirred: () => pending.promise }, () => {});
	await tick();
	stopOld();
	const revisions = [];
	let reads = 0;
	const stopNew = watchStirs({ stirred: (n) => { revisions.push(n); return Promise.resolve(-1); } }, () => reads++);
	await tick();
	expect([reads, revisions]).toEqual([1, [0]]);
	stopNew();
	pending.resolve(-1);
});

test('an older app uses paced reads, and closing a capable device stops them', async () => {
	let oldReads = 0, closedReads = 0;
	const old = watchStirs({}, () => oldReads++, { every: 1 });
	const closed = watchStirs({ stirred: () => Promise.resolve(-1) }, () => closedReads++);
	await tick();
	old(); closed();
	expect(oldReads).toBeGreaterThan(1);
	expect(closedReads).toBe(1);
	const before = oldReads;
	await tick();
	expect(oldReads).toBe(before);
});
