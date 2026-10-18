// @ts-nocheck — plain JS
// Who wrote an entry, in words (./vaults.js `authorsLine`): never the coop, always its aven and the human vaults whose
// devices signed it (Samuel 2026-10-18; avendb's `world::authors`).
// Run: bun test src/lib/avendb/authors.test.js
import { describe, expect, test } from 'bun:test';
import { authorsLine } from './vaults.js';

const world = {
	vaults: [
		{ id: 'a'.repeat(64), kind: 'aven', name: 'avenMAIA' },
		{ id: 's'.repeat(64), kind: 'human', name: 'Samuel' },
		{ id: 'c'.repeat(64), kind: 'coop', name: 'Maia City' }
	]
};

describe('authors', () => {
	test('the aven first, then each human, by name, never the coop', () => {
		expect(authorsLine(world, ['a'.repeat(64), 's'.repeat(64)])).toBe('avenMAIA + Samuel');
		expect(authorsLine(world, [{ vault: 'a'.repeat(64), name: 'avenMAIA' }, { vault: 'b'.repeat(64), name: 'Alice' }])).toBe('avenMAIA + Alice');
	});
	test('a vault it can’t name by its id, and the fallback where there are none', () => {
		expect(authorsLine(world, ['b'.repeat(64)])).toBe('vault bbbb bbbb');
		expect(authorsLine(world, [], 'Maia City')).toBe('Maia City');
	});
});
