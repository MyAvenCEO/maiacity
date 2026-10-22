// @ts-nocheck
// The site's old addresses (./redirects.js): each lands where its own page sent it before the list, its query kept,
// and no address that still has a page of its own is caught by it.
// Run: bun test src/lib/app/redirects.test.js
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { MOVED, landing, movedTo } from './redirects.js';

const ROUTES = new URL('../../routes/', import.meta.url).pathname;

describe('the old addresses', () => {
	test('each goes where its old page sent it', () => {
		expect(MOVED).toEqual({
			'/admin/': '/app/',
			'/admin/calendar/': '/app/#stories',
			'/admin/ideas/': '/app/#stories',
			'/app/data/': '/app/',
			'/app/games/': '/app/',
			'/games/': '/app/',
			'/app/board/': '/app/#stories',
			'/app/calendar/': '/app/#stories',
			'/app/stories/': '/app/#stories',
			'/app/stories/story/': '/app/#stories',
			'/app/actors/': '/app/#assets',
			'/app/assets/': '/app/#assets',
			'/app/machines/': '/app/#assets',
			'/app/models/': '/app/#assets',
			'/app/plants/': '/app/#assets',
			'/app/worlds/': '/app/#worlds',
			'/app/games/sandbox-8/': '/app/games/sandbox-7/',
			'/app/skills/': '/app/#docs',
			'/docs/avendb/': '/app/#docs',
			'/docs/avenbrain/': '/app/#docs',
			'/theos/': '/app/#docs/5c38946e391378e9bedd2021b042e7cde5990b0bd38919d81495b7ed6b51f218'
		});
	});

	test('found with or without its slashes, as the route hands it over', () => {
		expect(movedTo('app/board')).toBe('/app/#stories');
		expect(movedTo('/app/board/')).toBe('/app/#stories');
		expect(movedTo('admin')).toBe('/app/');
		expect(movedTo('app/games/sandbox-8')).toBe('/app/games/sandbox-7/');
		expect(movedTo('theos')).toBe('/app/#docs/5c38946e391378e9bedd2021b042e7cde5990b0bd38919d81495b7ed6b51f218');
	});

	test('an address with a page of its own is not caught', () => {
		for (const path of ['', '/', 'app', 'app/buildings', 'app/games/sandbox-1', 'app/games/sandbox-3', 'app/games/sandbox-7', 'app/worlds/tired-land', 'games/sandbox-3', 'app/assets/box', 'universe']) {
			expect(movedTo(path)).toBeNull();
		}
	});

	test('no old address has a page of its own any more, and each new one has', () => {
		for (const [from, to] of Object.entries(MOVED)) {
			expect(existsSync(`${ROUTES}${from}+page.svelte`)).toBe(false);
			expect(existsSync(`${ROUTES}${to.split('#')[0]}+page.svelte`)).toBe(true);
		}
	});

	test('its query is kept, its anchor unless the new place names its own', () => {
		expect(landing('/app/', '?link=abc', '#x')).toBe('/app/?link=abc#x');
		expect(landing('/app/buildings/', '', '')).toBe('/app/buildings/');
		expect(landing('/app/#stories', '?id=7', '#old')).toBe('/app/?id=7#stories');
		expect(landing('/app/#docs', '', '')).toBe('/app/#docs');
		expect(landing('/app/#docs/5c38946e391378e9bedd2021b042e7cde5990b0bd38919d81495b7ed6b51f218', '', '#sec-3')).toBe('/app/#docs/5c38946e391378e9bedd2021b042e7cde5990b0bd38919d81495b7ed6b51f218');
	});
});
