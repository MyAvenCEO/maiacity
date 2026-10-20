// The old addresses of the site and where each lives now: one list, in place of a page of its own for each. The site
// is prerendered (adapter-static), so there is no server to answer a redirect: ../../routes/[...moved=moved] writes a
// small page at each old address from this list when the site is built, and in the browser it passes on to the new one
// ($lib/app/Moved.svelte), its query kept. The same page answers a link followed inside the app (the client router
// asks the same matcher, ../../params/moved.js).
//
// A sandbox's old /games/<sandbox>/ address is not here: it still has a page of its own, the film camera's
// ($lib/film/FilmRoute.svelte), which passes on only without ?film.

/** Each old address (with its trailing slash, as every route has one) and where it goes now. */
export const MOVED = /** @type {const} */ ({
	// the admin's old pages: the dashboard and avenDB's Stories have them now
	'/admin/': '/app/',
	'/admin/calendar/': '/app/#stories',
	'/admin/ideas/': '/app/#stories',
	// the old lists of the dashboard: everything in them is on the dashboard now (Samuel 2026-10-18)
	'/app/data/': '/app/',
	'/app/games/': '/app/',
	'/games/': '/app/',
	// the old content board and calendar: the stories live in avenDB now, each a story entry with its steps as tabs
	'/app/board/': '/app/#stories',
	'/app/calendar/': '/app/#stories',
	'/app/stories/': '/app/#stories',
	'/app/stories/story/': '/app/#stories',
	// the old viewers and lists of the assets: the assets are avenDB's now, each shown in its Assets app (2026-10-18)
	'/app/actors/': '/app/#assets',
	'/app/assets/': '/app/#assets',
	'/app/machines/': '/app/#assets',
	'/app/models/': '/app/#assets',
	'/app/plants/': '/app/#assets',
	// the old list of the worlds: Maia City's `game` entries, in avenDB's Worlds app (2026-10-19); each world's own
	// page stays where it was
	'/app/worlds/': '/app/#worlds',
	// Sandbox 3 inside the domes: its tent and domes are the Buildings' now, and the sandboxes after it moved down one
	'/app/games/sandbox-3/': '/app/buildings/',
	// the skills' own wiki: avenDB's Docs view shows every skill (2026-10-20)
	'/app/skills/': '/app/#docs'
});

/** An address as the list keys it: a leading and a trailing slash. @param {string} path */
const keyOf = (path) => `/${path.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');

/** Where old address `path` (without the site's base) lives now, or `null` where it has not moved. @param {string} path */
export const movedTo = (path) => /** @type {Record<string, string>} */ (MOVED)[keyOf(path)] ?? null;

/**
 * The address to go on to from an old one, as `to` names the new place: the old query always kept (an invite link, a
 * device code), and its anchor too unless `to` names one of its own (a page of avenDB's, `/app/#stories`), which then
 * stands.
 * @param {string} to @param {string} [search] the old `location.search` @param {string} [hash] the old `location.hash`
 */
export function landing(to, search = '', hash = '') {
	const at = to.indexOf('#');
	const [path, anchor] = at < 0 ? [to, hash] : [to.slice(0, at), to.slice(at)];
	return `${path}${search}${anchor}`;
}
