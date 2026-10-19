// @ts-nocheck — plain JS
// The watch (./watch.js) holds a view's script to its budget of work: it asks the view's worker at moments no script
// can foresee, and an answer waits as long as the worker was at work. Here it watches stand-ins of a view's worker, each
// a real worker answering on its port as ./worker.js does, on a small budget so each test is short: one at rest is
// never stopped, one that works in bursts with a break between each (and so answers every ask, late) is, and so is one
// that never answers, or answers with numbers of its own; one past its share for a while only has its animation frames
// spaced out, and back once its hand fills. The view probe (/app/views/probe/) tries the same in a real
// browser, with the real engines and the budget they are frozen with.
// Run: bun test src/lib/sandbox/view/watch.test.js
import { afterEach, expect, test } from 'bun:test';
import { WATCH } from './watch.js';

const BUDGET = { hand: 300, share: 0.5, free: 4, gap: 5 };
const workers = [];
const start = (code) => {
	const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
	workers.push(w);
	return w;
};
afterEach(() => workers.splice(0).forEach((w) => w.terminate()));

/** a stand-in of a view's worker: `answer` is how it answers on the watch's port, `work` what it does besides */
const viewWorker = ({ answer = 'beat.postMessage(a.data)', work = '' } = {}) => `
self.onmessage = (e) => {
	const beat = e.data.beat;
	beat.onmessage = (a) => { ${answer}; };
	${work}
};`;

/**
 * the watch on a stand-in for `ms`: whether it said the budget was spent, and when (ms from the start), and the paces
 * it asked for on the way
 */
function watched(view, ms) {
	return new Promise((ok) => {
		const t0 = performance.now();
		const ch = new MessageChannel();
		const watch = start(WATCH);
		const paces = [];
		const timer = setTimeout(() => ok({ spent: false, paces }), ms);
		watch.onmessage = (e) => {
			if (e.data?.op === 'pace') paces.push(e.data.ms);
			if (e.data?.op !== 'spent') return;
			clearTimeout(timer);
			ok({ spent: true, at: Math.round(performance.now() - t0), paces });
		};
		watch.postMessage({ op: 'watch', port: ch.port1, budget: BUDGET }, [ch.port1]);
		start(view).postMessage({ beat: ch.port2 }, [ch.port2]);
	});
}

/** work, as a script does it: `ms` of it, then a break */
const BURST = (ms) => `const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms); }; setInterval(() => busy(${ms}), 0);`;

test('a worker at rest, or at work now and then, is never stopped', async () => {
	expect(await watched(viewWorker(), 1500)).toEqual({ spent: false, paces: [] });
	// a tenth of the time at work, in slices of 20 ms
	expect(await watched(viewWorker({ work: 'const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms); }; setInterval(() => busy(20), 200);' }), 1500)).toEqual({ spent: false, paces: [] });
}, 10000);

test('a worker at work in bursts, answering every ask between them, is stopped once its hand is spent', async () => {
	const got = await watched(viewWorker({ work: BURST(150) }), 5000);
	expect(got.spent).toBe(true);
	// at work all the time, it spends half a ms a ms: its 300 ms in hand last about 600 ms
	expect(got.at).toBeGreaterThan(300);
	expect(got.at).toBeLessThan(2500);
	// its animation frames spaced out on the way: work that is no animation frame slows for nothing
	// (the last, 2 s, only if a count came between a tenth of its hand left and none)
	expect(got.paces.slice(0, 2)).toEqual([100, 500]);
	expect([[100, 500], [100, 500, 2000]]).toContainEqual(got.paces);
}, 10000);

test('a worker past its share for a while is slowed, and comes back to its pace as its hand fills', async () => {
	// at work all the time for 500 ms (less than its 300 ms in hand last), then at rest: spaced out, never stopped,
	// and back to full pace
	const got = await watched(viewWorker({ work: 'const t = performance.now(); const i = setInterval(() => { const s = performance.now(); while (performance.now() - s < 50); if (performance.now() - t > 500) clearInterval(i); }, 0);' }), 2500);
	expect(got.spent).toBe(false);
	expect(got.paces.length).toBeGreaterThan(1);
	expect(got.paces[0]).toBe(100);
	expect(got.paces.at(-1)).toBe(0);
}, 10000);

test('a worker that never answers is stopped as the time goes by', async () => {
	const got = await watched(viewWorker({ answer: '' }), 5000);
	expect(got.spent).toBe(true);
}, 10000);

test('numbers of its own are no answer: a worker that guesses, and works, is stopped all the same', async () => {
	const guess = `for (let i = 0; i < 50; i++) beat.postMessage(String(Math.random()) + '.' + i); beat.postMessage(1); beat.postMessage('0.0')`;
	const got = await watched(viewWorker({ answer: guess, work: `setInterval(() => ${JSON.stringify('x')}, 1); ${BURST(150)}` }), 5000);
	expect(got.spent).toBe(true);
	// and one that only guesses, never sending an ask back, is stopped as one that never answers
	expect((await watched(viewWorker({ answer: guess }), 5000)).spent).toBe(true);
}, 15000);
