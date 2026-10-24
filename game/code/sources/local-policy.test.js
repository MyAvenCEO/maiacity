import { expect, test } from 'bun:test';
import { localOperation } from './local-policy.js';

test('frontend reads cannot request peer fetching, even explicitly', () => {
	for (const local of [undefined, false, true]) {
		const request = { op: 'read_file', root: 'a', from: 0, to: 42, local };
		expect(localOperation(request)).toEqual({ ...request, local: true });
		expect(request.local).toBe(local);
	}
});

test('background sync operations retain their authority', () => {
	const sync = { op: 'bring', entries: ['a'] };
	expect(localOperation(sync)).toBe(sync);
	const query = { op: 'query', vault: 'a' };
	expect(localOperation(query)).toBe(query);
});
