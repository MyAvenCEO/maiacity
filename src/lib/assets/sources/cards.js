// @ts-nocheck — plain JS, run by bun (scripts/recipe-cards.mjs and the tests), never by a page
/*
 * EVERY RECIPE'S CARD, MADE IN THE REPO — the card of one build of each of our recipes at its own values, as the box's
 * engine (../box/engine.js) hands it back: the recipe file run as the engine runs it, with the engine's modules and
 * nothing of a page, built, a rig's catalog put on its object, and read by ../card.js. The Maia City vault keeps each
 * card beside its recipe (Recipe, v1's `card`, ./avendb.js `recipeEntryOf`), and the seed can't build every asset on
 * the person's device, so the cards are made here, once per recipe hash, into ./cards.json:
 *
 *   bun scripts/recipe-cards.mjs           write ./cards.json
 *   bun scripts/recipe-cards.mjs --check   exit 1 while it is behind
 *
 * ./cards.test.js fails while it is behind: a recipe whose hash moved (its asset's code, or code it shares, changed)
 * has no card there until it is made again.
 */
import { cardOf } from '../card.js';
import { recipeFile } from '../engines.js';
import { buildWith, refOf } from '../refs.js';
import { MODULES } from '../box/modules.js';
import { catalogOf } from '../box/view.js';

/** where the cards are kept, beside this file */
export const CARDS = new URL('./cards.json', import.meta.url);

/** the modules a recipe may require of the engine, and nothing else, as the engine lends them */
const require = (id) => {
	if (!Object.hasOwn(MODULES, id)) throw new Error(`the engine has no module ${String(id).slice(0, 80)}`);
	return MODULES[id];
};

/**
 * A recipe file's `{ meta, build }`, run as the engine runs it, in the realm three.js was loaded in (a typed array of
 * another realm is no array to three.js): it calls `defineRecipe(f)` once, and `f(require)` gives back the recipe.
 * What a page would lend it, a canvas to draw a texture on, the caller stands in for (scripts/recipe-cards.mjs).
 * @param {string} code
 */
export function recipeOfFile(code) {
	let made;
	new Function('defineRecipe', code)((f) => (made ??= f));
	const recipe = typeof made === 'function' ? made(require) : undefined;
	if (typeof recipe?.build !== 'function' || !recipe.meta) throw new Error('not a recipe: no { meta, build }');
	return recipe;
}

/**
 * The card of a recipe file's build at its own values, as the engine reads it (../box/engine.js `made`, `buildOne`).
 * @param {string} code @param {string} hash the recipe's hash @param {number} engine the engine it is made for
 */
export async function cardOfFile(code, hash, engine) {
	const { meta, build } = recipeOfFile(code);
	let cast = null;
	const keep = async (...a) => {
		const m = await build(...a);
		cast = m && !m.isObject3D && m.rig?.object?.isObject3D ? m : null;
		return m;
	};
	const obj = await buildWith({ build: keep, params: meta.params, ref: refOf(meta.group, meta.id, meta.version, meta.variant) });
	if (cast?.catalog && !obj.userData.catalog) obj.userData.catalog = catalogOf(cast.catalog);
	return cardOf(obj, meta, { recipe: hash, engine });
}

/**
 * The card of every recipe the box plugin made (../box/plugin.js `bundleRecipes`), by its hash, sorted by its label;
 * `have`, cards made before, kept where their hash still names a recipe, so only what moved is built again.
 * @param {{ index: any, libraries: Record<string, string> }} made @param {Record<string, any>} [have]
 * @param {(label: string) => void} [told] told each label built
 */
export async function cardsOf(made, have = {}, told = () => {}) {
	const out = {};
	const recipes = Object.entries(made.index.recipes).sort(([, a], [, b]) => a.label.localeCompare(b.label));
	for (const [hash, at] of recipes) {
		if (have[hash]?.recipe === hash && have[hash]?.engine === made.index.engine) {
			out[hash] = have[hash];
			continue;
		}
		told(at.label);
		out[hash] = await cardOfFile(recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant), hash, made.index.engine);
	}
	return out;
}

/** ./cards.json's text: the engine, then each card on a line of its own, so a change shows as the cards it moved */
export const cardsText = (engine, cards) =>
	`{\n"engine": ${engine},\n"cards": {\n${Object.entries(cards)
		.map(([hash, card]) => `${JSON.stringify(hash)}: ${JSON.stringify(card)}`)
		.join(',\n')}\n}\n}\n`;
