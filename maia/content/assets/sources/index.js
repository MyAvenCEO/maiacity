/*
 * WHERE AN ASSET IS KEPT — the sources a ref may name, and the one door every loader reads a ref through:
 *
 *   repo    plants/fern@2                     ../refs.js: every asset today (and the only grammar the box's engine reads)
 *   vault   vault:<vault id>/plants/fern@2    ./avendb.js: written, and switched off
 *
 * `readRef` reads either. `repoRef` is what the loaders read refs with (../index.js `assetAt` and `objectAt`,
 * ../recipes.js `hashOf` and `buildAt`, and through them ../load.js and the renderer): a repo ref as its parts, a
 * vault's refused with the one error while avenDB storage is not switched on.
 */
import { parseRef } from '../refs.js';
import { VAULT, parseVaultRef, refusal } from './avendb.js';

/**
 * Any ref, as its parts and where it is kept: the repo's (`plants/fern@2`, as ../refs.js `parseRef` reads it) or a
 * vault's (`vault:<vault id>/plants/fern@2`, ./avendb.js). Throws for what is neither.
 * @param {string} ref
 * @returns {({ source: 'repo' } & ReturnType<typeof parseRef>) | import('./avendb.js').VaultRef}
 */
export function readRef(ref) {
	if (typeof ref === 'string' && ref.startsWith(VAULT)) return parseVaultRef(ref);
	return { source: 'repo', ...parseRef(ref) };
}

/**
 * A ref as every loader reads it: a repo's, as its parts (../refs.js `parseRef`). A vault's is refused here, so by
 * every loader alike, with one error (./avendb.js `refusal`: avenDB storage is not switched on); what is no ref at all,
 * as `parseRef` refuses it. Once storage is switched on, a loader hands a vault's ref to ./avendb.js instead.
 * @param {string} ref
 */
export function repoRef(ref) {
	const r = readRef(ref);
	if (r.source === 'vault') throw refusal(r);
	return parseRef(ref);
}
