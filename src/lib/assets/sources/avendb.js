/*
 * avenDB AS A SOURCE OF ASSETS — written, and switched off, as it is for code entries (game/code/sources/avendb.js).
 * A ref with a vault in front names an asset kept in that vault, at a version:
 *
 *   vault:<vault id>/<group>/<id>@<v>[:<variant>][?its=values]       vault:3f2a…/plants/fern@2?seed=maia
 *
 * Its vault id is read as a code ref's is; what follows it is a repo ref (../refs.js), with its version always named,
 * since an asset in a vault is its entry's history and a ref is anchored to one point of it. Every loader (../index.js
 * `assetAt` and `objectAt`, ../recipes.js `hashOf`, `buildAt` and `parseBuild`, so ../load.js and the renderer too)
 * reads such a ref today, and this source refuses it with one error: avenDB storage is not switched on.
 *
 * Switching it on (C10 of the code architecture plan, the Maia City COOP's vault) is the one change here: `recipeAt`
 * reads the vault's `recipe` entry (`recipeEntryOf` below) for that group and id at that version, holds its file, the
 * recipe's source, to the hash its card names and its engine to ../engines.json, and hands back what ../recipes.js
 * `recipeAt` hands back for a repo recipe, `{ hash, code }`. The box, the checks after it and the device's cache stay
 * as they are.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import ASSET from '../schemas/asset.v1.json';
import { engineAt } from '../engines.js';
import { paramsIn } from '../params.js';
import { refOf } from '../refs.js';

/** the BLAKE3 hash of a text, in hex, as ../recipes.js names a recipe by it @param {string} text */
const hashText = (text) => bytesToHex(blake3(utf8ToBytes(text)));

/** what a vault ref starts with */
export const VAULT = 'vault:';

/** how long a vault ref may be */
export const MAX_REF = 512;

/**
 * A vault ref: the vault (read as a code ref's vault is, game/code/sources/avendb.js), the group, the id, the version
 * (1 to 100,000, as a card's), a variant, the values. Ids and variants as a card's (../schemas/card.v1.json).
 */
export const VAULT_REF = /^vault:([A-Za-z0-9_-]{8,128})\/([a-z]+)\/([a-z0-9][a-z0-9-]{0,79})@([1-9][0-9]{0,5})(?::([a-z0-9][a-z0-9-]{0,79}))?(?:\?([^#\s]*))?$/;

/** the groups an asset in a vault may be of: those of the asset entry's schema */
const GROUPS = new Set(ASSET.properties.group.enum);

/** what is refused because avenDB storage is not switched on */
export class StorageOff extends Error {
	name = 'StorageOff';
}

/**
 * @typedef {{
 *   source: 'vault', vault: string, group: string, id: string, v: number, variant?: string,
 *   params?: Record<string, string>
 * }} VaultRef a vault ref as its parts, `params` as text
 */

/**
 * A vault ref as its parts. Throws for anything else, as ../refs.js `parseRef` throws for what is no repo ref.
 * @param {unknown} ref @returns {VaultRef}
 */
export function parseVaultRef(ref) {
	const s = typeof ref === 'string' ? ref : '';
	const m = s.length <= MAX_REF ? VAULT_REF.exec(s) : null;
	const no = () => new Error(`not an asset ref: ${String(ref).slice(0, 80)} (vault:<vault id>/group/id@v)`);
	if (!m || !GROUPS.has(m[2]) || Number(m[4]) > 100000) throw no();
	const params = paramsIn(m[6]);
	return { source: 'vault', vault: m[1], group: m[2], id: m[3], v: Number(m[4]), ...(m[5] ? { variant: m[5] } : {}), ...(params ? { params } : {}) };
}

/** the asset a vault ref names, in words, as the repo would name it @param {VaultRef} r */
const named = (r) => `${r.group}/${r.id}@${r.v}${r.variant ? `:${r.variant}` : ''}`;

/** the one error every loader refuses a vault ref with while avenDB storage is off @param {VaultRef} r */
export const refusal = (r) =>
	new StorageOff(`avenDB storage is not switched on: ${named(r)} of vault ${r.vault.slice(0, 12)}… can't be loaded from it; until then every asset comes from the repo (${named(r)})`);

export const avendb = {
	on: false,
	/**
	 * The recipe a vault ref names, `{ hash, code }`, once avenDB storage is switched on; refused until then.
	 * @param {VaultRef} r @returns {{ hash: string, code: string }}
	 */
	recipeAt(r) {
		throw refusal(r);
	}
};

/** the modules a recipe's code requires of its engine, as ../box/plugin.js reads them @param {string} code */
export const libsOf = (code) => [...new Set([...code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))];

/** the media type of a recipe's file: a script, which a page never runs but the box does */
export const RECIPE_MEDIA = 'text/javascript';

/** the tags a recipe entry is found by: its asset's group, and the ref it is named by @param {string} group */
export const groupTag = (group) => `group:${group}`;
/** @param {string} ref a ref without values, `group/id@v[:variant]` */
export const refTag = (ref) => `ref:${ref}`;

/** a card's ref without the values it was built with: what its recipe is named by @param {any} card */
export const labelOf = (card) => refOf(card.group, card.id, card.version, card.variant);

/**
 * One of our recipes as the Maia City vault keeps it (V5 of the avenDB migration): a `recipe` entry of avenDB's
 * `Recipe, v1` (a code entry, avendb/docs/ARCHITECTURE.md section 9, with the asset's card beside it), and its source,
 * the recipe file byte for byte, as the entry's file: a code entry's `source` holds at most 200,000 characters, which
 * the stand-in's head outgrows, and a file any size (Samuel 2026-10-17). Nothing here writes it. The file's BLAKE3 hash
 * is the recipe's name, the one its card gives (`recipe`) and every build is named by, which a reader holds it to; the
 * record's own `source` stays empty. Its engine is the frozen box engine the card names; its manifest the modules the
 * recipe requires of that engine; its params the declared ones a row can hold (a number or a whole number: a row's
 * default is a number, so a text parameter, a seed or a name, stays in the card and the recipe alone); its contract
 * the box's time limit and the checks a build passes before the page uses it: `hash` (the source hashes to the name
 * its card gives it), `card` (the card fits ../schemas/card.v1.json and names that recipe, ../load.js) and `budget`
 * (what the box hands back stays within ../box/rebuild.js BUDGET); its card the card of a build at its own values
 * (./cards.json). Tagged with its group and its ref (`group:plants`, `ref:plants/apple@2`); a kind's first variant
 * also with the ref that names no variant (`ref:machines/pickup@1`), which names it where no variant is asked for, as
 * the repo's index does (../recipes.js `hashOf`).
 * @param {{ code: string, card: any, ms?: number, first?: boolean }} recipe its file, the card of a build of it
 *   (./cards.json), the box's time limit for it (src/lib/sandbox/frame.js TIMEOUT), and whether it is its kind's first
 *   variant
 * @returns {{ type: 'recipe', tags: string[], value: any, file: { media: string, text: string } }}
 */
export function recipeEntryOf({ code, card, ms = 20000, first = false }) {
	const engine = engineAt(card.engine);
	if (!engine) throw new Error(`${card.ref}: no engine ${card.engine}`);
	if (hashText(code) !== card.recipe) throw new Error(`${card.ref}: its card names another recipe than this file`);
	/** @type {import('../params.js').Param[]} */
	const declared = card.params ?? [];
	const params = declared
		.filter((p) => p.type !== 'string')
		.map((p, i) => {
			const range = Object.fromEntries(Object.entries({ min: p.min, max: p.max, step: p.step }).filter(([, x]) => x !== undefined));
			return { id: i + 1, name: p.id, kind: p.type, ...(Object.keys(range).length ? { range } : {}), default: Number(p.value) };
		});
	const label = labelOf(card);
	const tags = [groupTag(card.group), refTag(label), ...(first && card.variant ? [refTag(refOf(card.group, card.id, card.version))] : [])];
	const value = {
		kind: 'recipe',
		title: card.label,
		note: card.note ?? '',
		source: '',
		engine: { host: 'box', version: engine.v, hash: engine.blake3 },
		manifest: { libs: libsOf(code) },
		params,
		contract: { budgets: { ms }, invariants: ['hash', 'card', 'budget'] },
		card
	};
	return { type: 'recipe', tags, value, file: { media: RECIPE_MEDIA, text: code } };
}
