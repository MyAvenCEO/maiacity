// @ts-nocheck — plain JS, kept loose on purpose
// A name of 32 bytes on the root ($lib/ids.js), one way to link anything: a post's own page, /<doc>/?t=<slug of the
// title>, its doc id its avenDB entry, which finds the post in avenDB's feed; or a build of an asset, /<its recipe's
// hash>/?t=<its label>&its=values ($lib/assets/AssetPage.svelte). The title in ?t= only makes the address readable.
// Nothing here is known as the site is built, so each opens through the app.
import { hexOf } from '$lib/ids.js';

export const prerender = false;

export const load = async ({ params }) => {
	const hash = hexOf(params.doc);
	// a recipe of the Maia City vault, by its BLAKE3 hash ($lib/assets/vault.js, its recipes loaded first); only then the
	// asset's page and three.js load. A vault whose recipes can't be loaded says so on the page, where no post is found
	const { INDEX, loadRecipes } = await import('$lib/assets/vault.js');
	// read off the person's own avenDB first: in the Mac app the app's device, which a page outside /app/ finds once it asks
	if (hash) await import('$lib/avendb/local.js').then(({ localDevice }) => localDevice());
	const recipes = hash ? await loadRecipes() : null;
	if (!hash || !INDEX.recipes[hash]) return { doc: params.doc, ...(recipes?.phase === 'failed' ? { recipes: recipes.error } : {}) };
	const { default: AssetPage } = await import('$lib/assets/AssetPage.svelte');
	return { doc: params.doc, asset: hash, AssetPage };
};
