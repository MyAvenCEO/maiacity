// Every recipe's card (src/lib/assets/sources/cards.js), made into src/lib/assets/sources/cards.json: the card of one
// build of each recipe of ours at its own values, by its hash, as the box would hand it back, which the Maia City vault
// keeps beside the recipe. Run it after changing an asset; src/lib/assets/sources/cards.test.js fails while it is
// behind. A card whose recipe's hash is unchanged is kept as it is, so only what moved is built again.
//
//   bun scripts/recipe-cards.mjs           write it
//   bun scripts/recipe-cards.mjs --check   exit 1 if it is behind
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values (the group lists load here)
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;

const { bundleRecipes } = await import('../src/lib/assets/box/plugin.js');
const { CARDS, cardsOf, cardsText } = await import('../src/lib/assets/sources/cards.js');

const check = process.argv.includes('--check');
const made = await bundleRecipes();
const was = existsSync(CARDS) ? readFileSync(CARDS, 'utf8') : '';
const have = was ? JSON.parse(was) : { engine: 0, cards: {} };
const built = [];
const cards = await cardsOf(made, have.cards, (label) => built.push(label));
const text = cardsText(made.index.engine, cards);
if (check) {
	if (text !== was) {
		console.error(`src/lib/assets/sources/cards.json is behind: ${built.length} cards to make (${built.slice(0, 8).join(', ')}${built.length > 8 ? ', …' : ''}); run bun scripts/recipe-cards.mjs`);
		process.exit(1);
	}
	console.error(`cards.json holds the card of each of the ${Object.keys(cards).length} recipes`);
} else {
	writeFileSync(CARDS, text);
	console.error(`${Object.keys(cards).length} cards, ${built.length} made: ${built.slice(0, 8).join(', ')}${built.length > 8 ? ', …' : ''}`);
}
