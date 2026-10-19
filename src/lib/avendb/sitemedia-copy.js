/**
 * The site's media copy as this site runs it (./sitemedia.js): what Maia City lacks of the media manifest
 * ($lib/media/manifest.json), each file's addresses in the old media vault (its public gateway, then in the Mac app
 * the same through the app, with its key, for what the vault keeps private), and the copy itself, as the Library's
 * card (./SiteMedia.svelte) runs it.
 */
import published from '$lib/media/manifest.json';
import { GATEWAY } from '$lib/media/url';
import { APP_API, native } from '$lib/native';
import { publicShare } from './flows.js';
import { creatable } from './ops.js';
import { copyAll, SITE, uncopied } from './sitemedia.js';

/** The pieces of the site's media vault `vault` doesn't hold yet, in world `world`. @param {import('./vaults.js').WorldView}
 *  world @param {string} vault */
export const siteLeft = (world, vault) => uncopied(world, vault, /** @type {any} */ (published));

/** Where file `hash` is read from in the old media vault, in order. @param {string} hash */
export const addressesOf = (hash) => [`${GATEWAY}/${hash}`, ...(native() ? [`${APP_API}/vault/files/${hash}`] : [])];

/** @typedef {Awaited<ReturnType<typeof copyAll>>} Copied */
/** the copy under way in this tab, if one is: one at a time, so that pressing the card again never writes a file
 *  twice */
let running = /** @type {Promise<Copied> | null} */ (null);

/**
 * Copies what vault `vault` lacks of the site's media into it, acting for `actor`, through the vault screens' `api`,
 * telling `progress` how far it is (./sitemedia.js `copyAll`), a file the world as it is `now` holds by then left be:
 * what it copied, or it throws where nothing lets `actor` add a file there, or the vault refuses the share or the tags.
 * While one runs in the tab, another waits for it.
 * @param {any} api @param {() => import('./vaults.js').WorldView} now @param {string} vault @param {string} actor
 * @param {(at: { done: number, of: number, now: string, bytes: number }) => void} [progress]
 * @returns {Promise<Copied>}
 */
export function copySiteMedia(api, now, vault, actor, progress) {
	running ??= (async () => {
		const asked = await creatable(api, actor, vault, 'file', [SITE]);
		if (!asked) throw new Error('nothing lets it add a file to Maia City');
		const world = now();
		const left = siteLeft(world, vault);
		const held = (/** @type {import('./sitemedia.js').Piece} */ p) => !siteLeft(now(), vault).some((q) => q.hash === p.hash);
		const shared = !!publicShare(world, vault, SITE);
		return copyAll({ api, left, vault, actor, shared, asked, urlsOf: addressesOf, progress, held });
	})().finally(() => (running = null));
	return running;
}

/** What copy `out` left out, in words: '' where it left nothing out. @param {Copied} out */
export function leftOut(out) {
	if (!out.failed.length) return '';
	const why = [...new Set(out.failed.map((f) => f.why.replace(/ for [0-9a-f]{12}…/, '')))].slice(0, 2).join('; ');
	return `${out.failed.length} of the site’s ${out.of} files didn’t come over (${why}); the next copy tries them again`;
}
