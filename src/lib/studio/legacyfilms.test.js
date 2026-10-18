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

test('a frozen film holds every world shot its timeline plays, and its files by BLAKE3 hash', async () => {
	const { badFrozen } = await import('./filmlist.js');
	const h = 'a'.repeat(64);
	const film = { key: 'x', timeline: { id: 't', clips: [{ kind: 'world', shot: 's1', shotVersion: 2 }, { kind: 'video', hash: h }] }, shots: { 's1@2': { name: 'S', project: null, spec: {} } }, files: [h] };
	expect(badFrozen(film)).toBeNull();
	expect(badFrozen({ ...film, shots: {} })).toBe('the shot s1@2 is missing');
	expect(badFrozen({ ...film, files: ['nope'] })).toBe('files are BLAKE3 hashes');
	expect(badFrozen({ ...film, proxies: { 's1@2': h } })).toBeNull();
	expect(badFrozen({ ...film, proxies: { 's1@2': 'nope' } })).toBe('proxies are BLAKE3 hashes');
});

test("only a shot whose world the camera has gets its proxy rendered; the room's comes from the film seed", async () => {
	const { shootable } = await import('./cuts.js');
	expect(shootable({ world: { sandbox: 'sandbox-4' } })).toBe(true);
	expect(shootable({ world: { sandbox: 'maiacity-v1', area: 'A' } })).toBe(true);
	expect(shootable({ world: {} })).toBe(true);
	expect(shootable({ world: { sandbox: 'room' } })).toBe(false);
});
