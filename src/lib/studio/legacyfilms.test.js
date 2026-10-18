// @ts-nocheck
import { expect, test } from 'bun:test';
import { FILMS, cityOf, filmTag, heldOf, legacyOf } from './legacyfilms.js';

const legacy = [
	{ id: 'a', name: 'Day 01 · Opening', project: 'The 1 million decision', variant: 'opening' },
	{ id: 'b', name: 'Day 01 · Rough', project: 'The 1 million decision', variant: 'rough' },
	{ id: 'c', name: 'World', project: '233 settlers, how it starts', variant: 'W' },
	{ id: 'd', name: 'Trailer', project: 'Trailer', variant: null }
];

test('each film finds its one legacy timeline, by its story and its name', () => {
	expect(legacyOf(FILMS[0], legacy)?.id).toBe('a');
	expect(legacyOf(FILMS[1], legacy)?.id).toBe('c');
	expect(legacyOf(FILMS[1], [{ id: 'x', name: 'World v2', project: '233 Settlers, how it starts' }])?.id).toBe('x');
	expect(legacyOf(FILMS[0], [{ id: 'y', name: 'Other', project: 'The 1 million decision' }, { id: 'z', name: 'More', project: 'The 1 million decision' }])).toBe(null);
});

test('only the Maia City vault takes them, and a film there is found by its tag', () => {
	const world = {
		vaults: [
			{ id: 'me', name: 'Samuel', kind: 'human', acting: { reaches: true, as: 'me' } },
			{ id: 'city', name: 'Maia City', kind: 'coop', acting: { reaches: true, as: 'city' } }
		],
		entries: [
			{ entry: 's', vault: 'city', type: 'story', tags: [filmTag(FILMS[0])] },
			{ entry: 'k', vault: 'me', type: 'cut', tags: [filmTag(FILMS[0])] }
		]
	};
	expect(cityOf(world)).toEqual({ vault: 'city', as: 'city' });
	expect(cityOf({ vaults: [world.vaults[0]], entries: [] })).toBe(null);
	const held = heldOf(world, 'city', FILMS[0]);
	expect(held.story?.entry).toBe('s');
	expect(held.cut).toBe(null);
});
