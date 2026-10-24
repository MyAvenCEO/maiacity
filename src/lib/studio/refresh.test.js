// @ts-nocheck — Bun test runtime, outside the browser type environment
import { expect, test } from 'bun:test';
import { refreshQueue } from './refresh.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

test('bursts coalesce, reads never overlap and a concurrent change gets one trailing read', async () => {
	let reads = 0;
	let release = () => {};
	const queue = refreshQueue(async () => { reads++; await new Promise((resolve) => { release = () => resolve(undefined); }); }, { delay: 1 });
	for (let index = 0; index < 100; index++) queue.invalidate();
	await tick();
	expect(reads).toBe(1);
	for (let index = 0; index < 100; index++) queue.invalidate();
	await tick();
	expect(reads).toBe(1);
	release();
	await tick();
	expect(reads).toBe(2);
	queue.close();
	release();
	await tick();
	expect(reads).toBe(2);
});

test('hidden or playing retains dirty state; resuming an idle queue does not poll', async () => {
	let allowed = false;
	let reads = 0;
	const queue = refreshQueue(async () => { reads++; }, { allowed: () => allowed, delay: 1 });
	queue.invalidate();
	await tick();
	expect(reads).toBe(0);
	allowed = true;
	queue.resume();
	await tick();
	expect(reads).toBe(1);
	queue.resume();
	await tick();
	expect(reads).toBe(1);
	queue.close();
});

test('unmount cancels pending work and failed reads can be retried by another event', async () => {
	let reads = 0;
	const errors = [];
	const queue = refreshQueue(async () => { reads++; throw new Error('offline'); }, { delay: 1, failed: (error) => errors.push(error) });
	queue.invalidate();
	await tick();
	queue.invalidate();
	await tick();
	expect(reads).toBe(2);
	expect(errors).toHaveLength(2);
	queue.invalidate();
	queue.close();
	queue.invalidate();
	await tick();
	expect(reads).toBe(2);
});
