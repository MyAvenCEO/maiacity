// @ts-nocheck — Bun test
import { expect, test } from 'bun:test';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROUTES, appPages, coverage } from './actor-coverage.js';
import { ACTORS, QUERIES } from './actors.js';
import { GAMES } from '../../../game/games.js';

/** each folder under src/routes/app holding a `+page.svelte`, as its path */
function routes(dir = join(import.meta.dir, '../../routes/app'), at = '/app/') {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (name === '+page.svelte') out.push(at);
		else if (statSync(full).isDirectory() && !name.startsWith('[')) out.push(...routes(full, `${at}${name}/`));
	}
	return out;
}

test("the app's routes are the folders that hold a page, the games' aside", () => {
	const games = new Set(GAMES.map((g) => g.route));
	expect(APP_ROUTES).toEqual(routes().filter((r) => !games.has(r)).sort());
});

test("a page's actors are those whose routes cover it, the kernel's aside, and each tier's parts are counted", () => {
	const pages = appPages({ nav: [['', [['assets', 'Assets'], ['studio', 'Studio']]]], out: { studio: '/app/studio/' }, games: GAMES });
	expect(pages.find((p) => p.path === '/app/#studio')).toBeUndefined();
	const by = Object.fromEntries(coverage([...ACTORS, ...QUERIES], pages).map((c) => [c.path, c]));
	expect(by['/app/chat/'].actors).toEqual(['chat']);
	expect(by['/app/chat/'].tiers.now).toBeGreaterThanOrEqual(3);
	expect(by['/app/studio/'].actors).toEqual(['studio']);
	expect(by['/app/'].actors).toEqual(['dashboard']);
	expect(by['/app/#assets'].actors).toEqual(['assets']);
	expect(by['/app/#assets'].tiers.now).toBeGreaterThanOrEqual(3);
	for (const g of GAMES) expect(by[g.route].actors).toContain(`game-${g.id}`);
	expect(by['/app/games/sandbox-7/'].actors).toEqual(['game-sandbox-7']);
});
