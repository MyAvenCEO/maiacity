/**
 * The way back, the one in the nav pill ($lib/app/NavPill.svelte): no page has a back button of its own.
 *
 * By default it goes up a place: a world to the Worlds, anything else to the dashboard. While a page has something
 * open over itself (a city on the planet, the inside of a dome, the island's sandbox), the way back closes that
 * first: the page calls `wayBack(label, go)` while it is open, and calls what it gets back once it has closed. The
 * last one opened is the first one closed.
 */
import { base } from '$app/paths';
import { untrack } from 'svelte';

/** @typedef {{ label: string, go: () => void }} Way */

/** @type {Way[]} */
let ways = $state.raw([]);

/** what is open over the page, if anything: the way back closes it */
export const back = {
	get open() {
		return ways.at(-1) ?? null;
	}
};

/**
 * Something is open over the page: until it closes, the way back closes it.
 * (untracked: called from an effect, it must not make that effect depend on the list it changes)
 * @param {string} label what the way back says, e.g. 'Back to the planet'
 * @param {() => void} go closes it
 * @returns {() => void} it has closed
 */
export function wayBack(label, go) {
	const way = { label, go };
	untrack(() => (ways = [...ways, way]));
	return () => untrack(() => (ways = ways.filter((w) => w !== way)));
}

/**
 * The place above a page, by its path (without the base): a world's is the Worlds, everything else's the dashboard,
 * and the dashboard has none.
 * @param {string} rel
 * @returns {{ href: string, label: string } | null}
 */
export function upFrom(rel) {
	if (/^\/app\/?$/.test(rel)) return null;
	if (/^\/app\/worlds\/[^/]+\/?$/.test(rel)) return { href: `${base}/app/worlds/`, label: 'Back to the worlds' };
	return { href: `${base}/app/`, label: 'Back to the dashboard' };
}
