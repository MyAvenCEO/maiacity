// @ts-nocheck
import { expect, test } from 'bun:test';
import { beforeLocalWrite } from './local-write.js';

const entry = 'a'.repeat(64);
const never = () => new Promise(() => {});

test('ordinary local write reaches execution with catch-up unfinished and peers unavailable', async () => {
	const calls = [];
	const started = performance.now();
	await beforeLocalWrite({ op: 'insert', entry }, {
		behind: true,
		bring: () => { calls.push('network'); return never(); },
		refresh: async () => { calls.push('refresh'); },
		waiting: () => calls.push('waiting'),
		timeoutMs: 2000
	});
	calls.push('local engine');
	expect(calls).toEqual(['local engine']);
	expect(performance.now() - started).toBeLessThan(100);
});

test('conditional review waits and rejects newly changed heads after refreshing', async () => {
	const calls = [];
	let arrive;
	const pending = new Promise((resolve) => { arrive = resolve; });
	const check = beforeLocalWrite({ op: 'aip_review', entry, heads: ['shown'] }, {
		behind: true,
		bring: () => { calls.push('network'); return pending; },
		refresh: async () => { calls.push('refresh'); },
		waiting: (on) => calls.push(on)
	});
	expect(calls).toEqual([true, 'network']);
	arrive({ ok: { new: 1 } });
	await expect(check).rejects.toThrow('look at it again');
	expect(calls).toEqual([true, 'network', false, 'refresh']);
});

test('unchanged conditional review proceeds, including empty explicitly supplied heads', async () => {
	let calls = 0;
	await beforeLocalWrite({ entry, heads: [] }, {
		behind: true, bring: async () => { calls++; return { ok: { new: 0 } }; }, refresh: async () => {}
	});
	expect(calls).toBe(1);
});

test('conditional catch-up remains bounded and clears waiting state', async () => {
	const waiting = [];
	await beforeLocalWrite({ entry, heads: ['shown'] }, {
		behind: true, bring: never, refresh: async () => {}, waiting: (on) => waiting.push(on), timeoutMs: 1
	});
	expect(waiting).toEqual([true, false]);
});

test('new entries and caught-up operations do not request peers', async () => {
	for (const [op, behind] of [[{ op: 'create' }, true], [{ entry, heads: [] }, false]]) {
		await beforeLocalWrite(op, { behind, bring: async () => { throw Error('unexpected network'); }, refresh: async () => {} });
	}
});
