// @ts-nocheck — plain JS
// Which manifest each app and page of the app reads by, for the Performance page's Views (Samuel 2026-10-27: "each app
// and its sub pages have their own interest manifests correctly defined, and measure if they are"). A page is its
// path, and a page of the vault's own (./VaultApps.svelte `NAV`) its path with its `#page`, as the view names it
// (./diagnostics-send.js `view`). Its manifests are those whose routes cover it (game/code/sources/manifests.js
// `covers`), the kernel's `*` aside, which every page holds: a page none covers asks for the kernel alone.
import { covers, leavesFor } from '../../../game/code/sources/manifests.js';

/** The app's own pages (src/routes/app, each `+page.svelte`), the games' (game/games.js) aside, as a test holds them
 *  to the folder. */
export const APP_ROUTES = [
	'/app/', '/app/aips/', '/app/assets/box/', '/app/assets/render/', '/app/assets/render/levels/', '/app/avendb/',
	'/app/biomes/', '/app/buildings/', '/app/chat/', '/app/coops/', '/app/factories/', '/app/games/sandbox-7/',
	'/app/games/sandbox-8/', '/app/ledger/', '/app/maiacity-v2/proposals/', '/app/math/probe/', '/app/network/',
	'/app/postgres/', '/app/studio/', '/app/views/probe/'
];

/** Every page to measure: the app's routes, each game's, and the vault's own pages under `/app/#<page>` from `nav`
 *  (`NAV`), those that open a page of the app's own (`out`, `OUT`) by that page.
 *  @param {{nav?: readonly (readonly [string, readonly (readonly string[])[]])[], out?: Record<string, string>, games?: readonly {route: string, label: string}[]}} [o]
 *  @returns {{path: string, title: string}[]} */
export function appPages({ nav = [], out = {}, games = [] } = {}) {
	const pages = new Map();
	for (const [, items] of nav) for (const [id, title] of items) if (!out[id]) pages.set(`/app/#${id}`, title);
	for (const path of APP_ROUTES) if (!pages.has(path)) pages.set(path, path.replace(/^\/app\//, '/') || '/');
	for (const g of games) pages.set(g.route, g.label);
	return [...pages].map(([path, title]) => ({ path, title }));
}

/** For each page of `pages`: the manifests of `manifests` whose routes cover it (the kernel's aside), and how many
 *  parts each tier asks for there, a slot's part counted though unbound (it binds on select).
 *  @param {any[]} manifests @param {{path: string, title: string}[]} pages
 *  @returns {{path: string, title: string, manifests: string[], tiers: {now: number, next: number, later: number, idle: number}}[]} */
export function coverage(manifests, pages) {
	const own = (manifests ?? []).filter((m) => m?.kind === 'manifest' && typeof m.id === 'string');
	return pages.map(({ path, title }) => {
		const ids = own.filter((m) => (m.routes ?? []).some((r) => r !== '*' && typeof r === 'string' && covers(r, path))).map((m) => m.id);
		const bound = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? '0'.repeat(64) : undefined) });
		const tiers = { now: 0, next: 0, later: 0, idle: 0 };
		for (const leaf of ids.length ? leavesFor(own, path, bound) : []) if (leaf.tier in tiers) tiers[leaf.tier]++;
		return { path, title, manifests: ids, tiers };
	});
}
