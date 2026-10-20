/*
 * A BIOME FROM THE MAIA CITY VAULT — the floor a world lays (its surfaces, its density, its cover, each kind the asset
 * it is), read off the card the vault keeps beside the biome's recipe ($lib/biomes/card.js `biomeOfCard`), never off
 * the repo's list of them: a biome changed in the vault (a new version its owners accepted) is the floor every world
 * lays from then on. Only once the vault's recipes are in (../vault.js `loadRecipes`, which every world's page waits
 * for).
 */
import { biomeOfCard } from '$lib/biomes/card.js';
import { cardOf, hashOf } from '../vault.js';

/**
 * The biome a ref names in the vault (`biomes/food-forest`, its newest version; `biomes/food-forest@2`, that one; or a
 * pin): its numbers as its card says them. Throws NotInVault naming it where the vault holds none (told as every
 * missing asset is, ../vault.js `recipes.missed`), or BiomeCardError where its card is no floor's.
 * @param {string | { entry: string, at: string[] }} ref
 */
export function biomeAt(ref) {
	const hash = hashOf(ref);
	return biomeOfCard(cardOf(hash) ?? { ref: typeof ref === 'string' ? ref : JSON.stringify(ref) });
}

/**
 * The biome a ref names in the vault, or null where the vault holds none or its card is no floor's (said on the
 * console; the page's banner names a missing one): a world then lays its ground bare, never a floor of the repo's.
 * @param {string | { entry: string, at: string[] }} ref
 */
export function biomeOr(ref) {
	try {
		return biomeAt(ref);
	} catch (e) {
		console.warn(`biome ${typeof ref === 'string' ? ref : JSON.stringify(ref)}: ${/** @type {Error} */ (e).message}`);
		return null;
	}
}
