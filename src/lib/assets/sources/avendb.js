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
 *
 * THE MAIA CITY VAULT'S RECIPES (`vaultRecipes`, V5 of the avenDB migration): a page will resolve a repo ref
 * (`plants/apple@2`) from the vault's `recipe` entries alone, one per version or variant (`recipeEntryOf`), and a
 * recipe's source from its entry's file, held to the hash its ref names. There is no repo fallback (Samuel 2026-10-17):
 * what the vault doesn't hold, or holds otherwise, fails, naming the ref (`NotInVault`). Where the rows and their files
 * come from is the caller's, the server's feed or the person's device; nothing reads them yet, until avenDB's feed
 * serves a recipe entry's file and the seed has written them.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import ASSET from '../schemas/asset.v1.json';
import { checkCard } from '../schemas/index.js';
import { LATEST, engineAt, recipeTail } from '../engines.js';
import { paramsIn } from '../params.js';
import { parseRef, refOf } from '../refs.js';

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

/** what a page is refused when the Maia City vault holds no recipe a ref names, or one that is not the recipe it names */
export class NotInVault extends Error {
	name = 'NotInVault';
}

/** a value an object holds of its own, never one it inherits (`constructor`, `__proto__`) @param {Record<string, any>} o @param {string} k */
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

/** where a row is in the vault, in words @param {any} row */
const whereOf = (row) => `entry ${String(row?.entry ?? '?').slice(0, 12)}…`;

/** a file's bytes as text, refused unless they are UTF-8 as they stand (a byte order mark kept, as it was hashed) */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * One row the vault hands out as a recipe of the index, or why not: a `recipe` entry whose card fits its schema and
 * names its recipe, tagged with its group and the ref its card names, made for the box engine pages run (the latest of
 * ../engines.json, by its hash). Its file is not read here: only when a build needs it.
 * @param {any} row @returns {{ hash: string, label: string, card: any, first?: string } | { error: string, label?: string }}
 */
function recipeOfRow(row) {
	const where = whereOf(row);
	const r = row?.record ?? {};
	if (row?.type !== 'recipe' || r.kind !== 'recipe') return { error: `${where}: not a recipe entry` };
	const verdict = checkCard(r.card);
	if (!verdict.ok) return { error: `${where}: its card does not fit: ${verdict.errors.slice(0, 3).join('; ')}` };
	const card = r.card;
	const label = labelOf(card);
	/** @param {string} why */
	const no = (why) => ({ error: `${label} (${where}): ${why}`, label });
	if (!card.recipe) return no('its card names no recipe');
	const tags = Array.isArray(row.tags) ? row.tags : [];
	if (!tags.includes(refTag(label))) return no(`it is not tagged ${refTag(label)}, the ref its card names`);
	if (!tags.includes(groupTag(card.group))) return no(`it is not tagged ${groupTag(card.group)}`);
	const e = r.engine ?? {};
	if (card.engine !== LATEST.v || e.host !== 'box' || e.version !== LATEST.v || e.hash !== LATEST.blake3)
		return no(`made for ${e.host ?? '?'} engine ${e.version ?? '?'} (${String(e.hash ?? '?').slice(0, 12)}…), its card for ${card.engine}: pages run box engine ${LATEST.v} (${LATEST.blake3.slice(0, 12)}…)`);
	// a kind's first variant: the one its ref names where it names no variant
	const first = card.variant && tags.includes(refTag(refOf(card.group, card.id, card.version))) ? card.variant : undefined;
	return { hash: card.recipe, label, card, ...(first ? { first } : {}) };
}

/**
 * The Maia City vault's recipes as a page will read them, with no repo fallback (V5; Samuel 2026-10-17: what isn't
 * ported fails hard). `rows` are the vault's `recipe` entries as it hands them out, each `{ vault, entry, type, tags,
 * heads, record }` (a row of avenDB's feed, `world::public_row`, or one the person's device reads); `read(row)` hands
 * out a row's file, as bytes or text, from whoever handed out the rows, and is asked only when a build needs that
 * recipe. A row that doesn't check is left out, and why is said (`refused`); a ref two entries claim as two recipes, or
 * a recipe two refs claim, names nothing.
 *
 * It reads as ../recipes.js reads the repo's index: `index`, the shape of `virtual:asset-recipes`; `hashOf(ref)`, the
 * hash a ref names (its latest version where it names none, its kind's first variant where it names none, and never
 * another variant than the one it names); `recipeAt(hash)`, `{ hash, code }`, the entry's file once read, held to the
 * hash (the BLAKE3 of its bytes) and to the version and variant its card says. Each throws NotInVault, naming the ref,
 * for what the vault doesn't hold or holds otherwise.
 * @param {any[]} rows @param {{ read: (row: any) => Promise<Uint8Array | ArrayBuffer | string | undefined> }} o
 */
export function vaultRecipes(rows, { read }) {
	/** @type {{ engine: number, recipes: Record<string, any>, labels: Record<string, string>, latest: Record<string, number>, first: Record<string, string> }} */
	const index = { engine: LATEST.v, recipes: {}, labels: {}, latest: {}, first: {} };
	/** @type {string[]} */
	const refused = [];
	/** why a ref names nothing, where its entry was refused or claimed twice @type {Map<string, string>} */
	const why = new Map();
	/** @param {string} label @param {string} said */
	const refuse = (label, said) => {
		refused.push(said);
		why.set(label, said);
	};
	/** the rows that check, by the ref their card names, and the refs each recipe is claimed for @type {Map<string, any[]>} */
	const claims = new Map();
	/** @type {Map<string, Set<string>>} */
	const labelsOf = new Map();
	for (const row of Array.isArray(rows) ? rows : []) {
		const m = recipeOfRow(row);
		if ('error' in m) {
			if (m.label) refuse(m.label, m.error);
			else refused.push(m.error);
			continue;
		}
		claims.set(m.label, [...(claims.get(m.label) ?? []), { ...m, row }]);
		labelsOf.set(m.hash, new Set([...(labelsOf.get(m.hash) ?? []), m.label]));
	}
	/** each recipe's row, by its hash @type {Map<string, any>} */
	const rowOf = new Map();
	/** the variants that say they are their kind's first, by the ref that names no variant @type {Map<string, Set<string>>} */
	const firsts = new Map();
	for (const [label, held] of claims) {
		// two entries of one recipe are one; of two recipes, no page could say which the ref means
		if (new Set(held.map((x) => x.hash)).size > 1) {
			refuse(label, `${label}: held twice in the Maia City vault, as two recipes (${held.map((x) => whereOf(x.row)).join(', ')}), so by neither`);
			continue;
		}
		const { hash, card, row, first } = held[0];
		const named = /** @type {Set<string>} */ (labelsOf.get(hash));
		if (named.size > 1) {
			refuse(label, `${label}: its card names recipe ${hash.slice(0, 12)}…, which ${[...named].filter((l) => l !== label).join(', ')} names too, so it names neither`);
			continue;
		}
		const name = `${card.group}/${card.id}`;
		index.recipes[hash] = { group: card.group, id: card.id, v: card.version, variant: card.variant ?? null, label, ...(card.params?.length ? { params: card.params } : {}) };
		index.labels[label] = hash;
		index.latest[name] = Math.max(own(index.latest, name) ?? 0, card.version);
		rowOf.set(hash, row);
		if (first) {
			const at = refOf(card.group, card.id, card.version);
			firsts.set(at, new Set([...(firsts.get(at) ?? []), first]));
		}
	}
	for (const [at, variants] of firsts) {
		if (variants.size > 1) refuse(at, `${at}: ${variants.size} of its variants say they are its first (${[...variants].join(', ')}), so none is`);
		else index.first[at] = [...variants][0];
	}
	/** the error for a ref the vault doesn't hold @param {string} ref @param {string} [named] @param {string} [also] */
	const missing = (ref, named, also) => new NotInVault(`${ref}${named && named !== ref ? ` (${named})` : ''} is not in the Maia City vault${also ? `: ${also}` : ''}`);
	/** a recipe's file, read from the vault and held to its hash and to its card @param {any} at @param {string} hash */
	async function fileOf(at, hash) {
		let got;
		try {
			got = await read(rowOf.get(hash));
		} catch (e) {
			throw new NotInVault(`${at.label}: its file could not be read from the Maia City vault (${e instanceof Error ? e.message : String(e)})`);
		}
		const bytes = typeof got === 'string' ? utf8ToBytes(got) : got instanceof ArrayBuffer ? new Uint8Array(got) : got;
		if (!(bytes instanceof Uint8Array)) throw new NotInVault(`${at.label}: the Maia City vault handed out no file for it`);
		const named = bytesToHex(blake3(bytes));
		if (named !== hash) throw new NotInVault(`${at.label}: refused, its file in the Maia City vault hashes to ${named.slice(0, 12)}…, not to ${hash.slice(0, 12)}…, the recipe its ref names`);
		let code;
		try {
			code = typeof got === 'string' ? got : UTF8.decode(bytes);
		} catch {
			throw new NotInVault(`${at.label}: refused, its file in the Maia City vault is not UTF-8 text`);
		}
		// the file's last line says which version and variant it builds (../engines.js recipeTail): the one its card says
		if (!code.endsWith(recipeTail(at.id, at.v, at.variant)))
			throw new NotInVault(`${at.label}: refused, its file in the Maia City vault is the recipe of another version or variant than its card says`);
		return { hash, code };
	}
	/** @type {Map<string, Promise<{ hash: string, code: string }>>} */
	const files = new Map();
	return {
		index,
		refused,
		/**
		 * The hash a ref names in the vault (`group/id[@v][:variant][?values]`; a vault's ref is still refused).
		 * @param {string} ref @returns {string}
		 */
		hashOf(ref) {
			if (typeof ref === 'string' && ref.startsWith(VAULT)) throw refusal(parseVaultRef(ref));
			const { group, id, v, variant } = parseRef(ref);
			const latest = v ?? own(index.latest, `${group}/${id}`);
			if (!latest) throw missing(ref);
			const named = refOf(group, id, latest, variant);
			const first = variant ? undefined : own(index.first, named);
			const hash = own(index.labels, named) ?? (first ? own(index.labels, refOf(group, id, latest, first)) : undefined);
			if (!hash) throw missing(ref, named, why.get(named));
			return hash;
		},
		/**
		 * A recipe of the vault by its hash, `{ hash, code }`: its file, read once and checked.
		 * @param {string} hash @returns {Promise<{ hash: string, code: string }>}
		 */
		recipeAt(hash) {
			const at = typeof hash === 'string' ? own(index.recipes, hash) : undefined;
			if (!at) return Promise.reject(new NotInVault(`no recipe ${String(hash).slice(0, 12)}… is in the Maia City vault`));
			if (!files.has(hash)) {
				const reading = fileOf(at, hash);
				files.set(hash, reading);
				reading.catch(() => files.delete(hash));
			}
			return /** @type {Promise<{ hash: string, code: string }>} */ (files.get(hash));
		}
	};
}
