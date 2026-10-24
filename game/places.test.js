// @ts-nocheck
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { PLACES } from './places.js';
import { GAMES, gameOfRoute } from './games.js';
import { WORLDS, filmPath, worldOfPath } from './film/worlds.js';

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
	? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

test('game and film metadata preserve the a0ee4d25 registry contracts byte for byte', () => {
	expect(digest(GAMES)).toBe('9556bafe2253ed33e0d129b713ecc91c1e8d7d539e73566ea2cfcc9026a736dd');
	expect(digest(WORLDS)).toBe('3ffb4ef3a74014cd271d29d8a138975e20156f2fbbc74084b8631f9a3108276f');
});

test('navigation preserves labels, order, covers, notes and routes from a0ee4d25', () => {
	const lists = {};
	for (const group of ['PLAY', 'WORLDS', 'CITY']) {
		lists[group] = PLACES.filter((place) => place.navigation?.group === group)
			.sort((left, right) => left.navigation.order - right.navigation.order)
			.map(({ route, label, note, navigation }) => ({
				href: route, label, icon: navigation.icon, note: navigation.note ?? note,
				...(navigation.cover ? { cover: navigation.cover } : {}),
				...(navigation.anchors ? { anchors: navigation.anchors } : {})
			}));
	}
	expect(digest(lists)).toBe('41083cd1913c80d75aa78b10fc61563110c148d11d600ce17c328f48bbbf6b63');
});

test('stable descriptor IDs, routes and optional film IDs are unique', () => {
	const history = PLACES.filter((place) => place.history).map((place) => [place.route, place.history]).sort();
	expect(createHash('sha256').update(JSON.stringify(history)).digest('hex')).toBe('df76ab7c5353f064af04243748ae638291b05bea53a9dbc25908f79b1ba3b85e');
	expect(new Set(PLACES.map((place) => place.id)).size).toBe(PLACES.length);
	expect(new Set(PLACES.map((place) => place.route)).size).toBe(PLACES.length);
	const films = PLACES.filter((place) => place.film);
	expect(new Set(films.map((place) => place.film.id)).size).toBe(films.length);
	for (const place of PLACES) {
		expect(place.version).toBe(place.history?.at(-1).v ?? 1);
		place.history?.forEach((version, index) => expect(version.v).toBe(index + 1));
		expect(gameOfRoute(place.route)).toBe(place.gameOrder === undefined ? null : place.id);
	}
});

test('stored film IDs are not game IDs and old film addresses still round trip', () => {
	expect(Object.keys(WORLDS)).toEqual(['sandbox-1', 'sandbox-2', 'sandbox-3', 'sandbox-4', 'sandbox-5', 'sandbox-6', 'tired-land', 'maiacity-v1', 'maiacity-v2']);
	expect(WORLDS['sandbox-3'].route).toBe('/app/buildings/');
	expect(WORLDS['sandbox-4'].route).toBe('/app/games/sandbox-3/');
	expect(WORLDS['sandbox-5'].route).toBe('/app/games/sandbox-4/');
	expect(WORLDS['sandbox-6'].route).toBe('/app/games/sandbox-5/');
	for (const [id, world] of Object.entries(WORLDS)) {
		for (const area of world.areas ?? [undefined]) {
			const shot = { sandbox: id, ...(area ? { area } : {}) };
			expect(worldOfPath(filmPath(shot))).toEqual(shot);
		}
	}
	expect(PLACES.find((place) => place.id === 'sandbox-6').film).toBeUndefined();
	expect(gameOfRoute('/app/games/sandbox-7/')).toBeNull();
});
