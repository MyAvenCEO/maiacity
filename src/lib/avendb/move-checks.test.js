// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { createMoveChecks } from './move-checks.js';

const deferred = () => {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
};
function fixture(answer = async () => null) {
	const device = {};
	let current = device;
	let now = 0, next = 0;
	const timers = new Map();
	const calls = [], shown = [], errors = [];
	let moves = 0;
	const checks = createMoveChecks({
		current: () => current,
		ask: async (d) => { calls.push(d); return answer(d); },
		show: (m) => shown.push(m), move: async () => { moves++; }, warn: (e) => errors.push(e),
		later: (run, delay) => { timers.set(++next, { run, at: now + delay }); return next; },
		cancel: (id) => timers.delete(id)
	});
	const advance = async (ms) => {
		now += ms;
		for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.run(); }
		for (let i = 0; i < 5; i++) await Promise.resolve();
	};
	return { device, checks, calls, shown, errors, timers, advance, moves: () => moves, switch: (d) => { current = d; } };
}

test('no-work rechecks even without a known old aven and discovers later work', async () => {
	let available = false;
	const pending = { passkey: true, touch: false, avens: 1 };
	const f = fixture(async () => available ? pending : null);
	await f.checks.check(f.device);
	expect(f.calls).toHaveLength(1);
	await f.advance(179999);
	expect(f.calls).toHaveLength(1);
	available = true;
	await f.advance(1);
	expect(f.calls).toHaveLength(2);
	expect(f.shown.at(-1)).toEqual(pending);
	expect(f.timers.size).toBe(0); // A ceremony waits for the person, never repeated automatically.
});

test('pending retirement and unavailable freshness retry after thirty seconds', async () => {
	const pending = { behind: true, passkey: true, retire: ['old key'] };
	let fail = false;
	const f = fixture(async () => { if (fail) throw new Error('not caught up'); return pending; });
	await f.checks.check(f.device);
	await f.advance(29999);
	expect(f.calls).toHaveLength(1);
	fail = true;
	await f.advance(1);
	expect(f.calls).toHaveLength(2);
	expect(f.errors).toHaveLength(1);
	await f.advance(30000);
	expect(f.calls).toHaveLength(3);
	expect(f.moves()).toBe(0);
});

test('a newer check cancels its old timer and ignores stale responses and failures', async () => {
	const first = deferred();
	let n = 0;
	const f = fixture(() => ++n === 1 ? first.promise : Promise.resolve(null));
	const old = f.checks.check(f.device);
	await f.checks.check(f.device);
	first.resolve({ passkey: false, touch: false, device: true });
	await old;
	expect(f.moves()).toBe(0);
	expect(f.shown.at(-1)).toBeNull();
	expect(f.timers.size).toBe(1);
	await f.checks.check(f.device);
	expect(f.timers.size).toBe(1);
});

test('device replacement and cancellation cannot act on or rearm the previous device', async () => {
	const first = deferred();
	const f = fixture(() => first.promise);
	const old = f.checks.check(f.device);
	f.switch({});
	first.reject(new Error('old device ended'));
	await old;
	expect(f.errors).toHaveLength(0);
	expect(f.timers.size).toBe(0);
	const g = fixture();
	await g.checks.check(g.device);
	g.checks.stop();
	await g.advance(180000);
	expect(g.calls).toHaveLength(1);
	const pending = deferred();
	const h = fixture(() => pending.promise);
	const checking = h.checks.check(h.device);
	h.checks.stop();
	pending.resolve({ device: true });
	await checking;
	expect(h.moves()).toBe(0);
	expect(h.timers.size).toBe(0);
});


test('a late check for a replaced device cannot cancel its successor timer', async () => {
	const f = fixture();
	const next = {};
	f.switch(next);
	await f.checks.check(next);
	await f.checks.check(f.device);
	expect(f.timers.size).toBe(1);
	await f.advance(180000);
	expect(f.calls).toEqual([next, next]);
});
