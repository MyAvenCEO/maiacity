// @ts-nocheck — plain JS, kept loose on purpose
// A name of 32 bytes on the root ($lib/ids.js), one way to link anything: a post's own page, /<doc>/?t=<slug of the
// title>, its doc id its avenDB entry, which finds the post in avenDB's feed; or a build of an asset, /<its recipe's
// hash>/?t=<its label>&its=values ($lib/assets/AssetPage.svelte). The title in ?t= only makes the address readable.
// Nothing here is known as the site is built, so each opens through the app.
import { hexOf } from '$lib/ids.js';

export const prerender = false;

export const load = async ({ params }) => {
	const hash = hexOf(params.doc);
	// a recipe of ours, by its BLAKE3 hash; only then the asset's page and three.js load
	const { default: INDEX } = await import('virtual:asset-recipes');
	if (!hash || !INDEX.recipes[hash]) return { doc: params.doc };
	const { default: AssetPage } = await import('$lib/assets/AssetPage.svelte');
	return { doc: params.doc, asset: hash, AssetPage };
};
