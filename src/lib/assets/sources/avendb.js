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
 * recipe's source, to the hash its card names and its engine to the frozen box engines (src/lib/sandbox/engines.json), and hands back what ../recipes.js
 * `recipeAt` hands back for a repo recipe, `{ hash, code }`. The box, the checks after it and the device's cache stay
 * as they are.
 *
 * THE MAIA CITY VAULT'S RECIPES (`vaultRecipes`, V5 of the avenDB migration): a page will resolve a repo ref
 * (`plants/apple@2`) from the vault's `recipe` entries alone, one per asset, each version and variant a record of it
 * (`recipeEntryOf`) written with its file (`versionsOf`), and a recipe's source from that file, held to the hash its
 * ref names. There is no repo fallback (Samuel 2026-10-17):
 * what the vault doesn't hold, or holds otherwise, fails, naming the ref (`NotInVault`). Where the rows and their files
 * come from is the caller's, the server's feed or the person's device; nothing reads them yet, until avenDB's feed
 * serves a recipe entry's file and the seed has written them.
 */
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { hashBytes, hashText } from '../../../../game/hash.js';
import { ENTRY_REF, entryRef, parseEntryRef } from '../../../../game/code/ref.js';
import ASSET from '../schemas/asset.v1.json';
import { checkCard } from '../schemas/index.js';
import { LATEST, engineAt, recipeTail } from '../engines.js';
import { paramsIn } from '../params.js';
import { parseRef, refOf } from '../refs.js';

/** what a vault ref starts with */
export const VAULT = 'vault:';

/** how long a vault ref may be */
export const MAX_REF = 512;

/**
 * A vault ref: the vault (an avenDB id, 64 hex digits, as the one entry ref reads it, game/code/ref.js), the group, the
 * id, the version (1 to 100,000, as a card's), a variant, the values. Ids and variants as a card's
 * (../schemas/card.v1.json).
 */
export const VAULT_REF = /^vault:([0-9a-f]{64})\/([a-z]+)\/([a-z0-9][a-z0-9-]{0,79})@([1-9][0-9]{0,5})(?::([a-z0-9][a-z0-9-]{0,79}))?(?:\?([^#\s]*))?$/;

/**
 * A pin (N6 of the avenDB versions plan, Samuel 2026-10-18 and 10-20: "why does it still reference by the old ref keys
 * instead of its avenDB internal ids?"): an asset named by avenDB's ids alone, its entry and the heads of the version
 * it names, every part a hash, read as a code ref is (the one entry ref, game/code/ref.js `ENTRY_REF`), and the values
 * it is built with:
 *
 *   vault:<vault id>/<entry>@<head>[,<head>…][?its=values]       vault:3f2a…/9be0…@5e6f…?stage=9
 *
 * Stored as `{ entry, at }` where code keeps it as data; shown as avenDB names it ("Oats v1 · 1a2b3c4d…", `nameOf`).
 * A row lists the heads a pin of each version names (`at`, avenDB's `engine::version_heads`).
 */
export const PIN_REF = ENTRY_REF;

/**
 * A pin as its parts, `{ vault, entry, at, params? }` (`params` as text), from its string (`PIN_REF`) or as stored
 * (`{ entry, at, vault?, params? }`); null for anything else, a repo ref or a vault's group ref among them.
 * @param {unknown} ref @returns {{ vault: string | null, entry: string, at: string[], params?: Record<string, string> } | null}
 */
export function parsePin(ref) {
	const r = parseEntryRef(ref);
	if (!r) return null;
	const given = ref && typeof ref === 'object' ? /** @type {any} */ (ref).params : undefined;
	const params = typeof ref === 'string' ? paramsIn(r.query) : given && typeof given === 'object' ? given : undefined;
	return { vault: r.vault, entry: r.entry, at: r.heads, ...(params ? { params } : {}) };
}

/**
 * A pin written as a string (`PIN_REF`), its heads sorted, so one version is one string.
 * @param {{ vault: string, entry: string, at: string[] }} pin @param {string} [query] its values, as a ref's (`stage=9`)
 */
export const pinRef = (pin, query = '') => entryRef(pin, query);

/** the key a pin is found by: its entry and its heads, sorted @param {{ entry: string, at: string[] }} p */
const pinKey = (p) => `${p.entry}@${[...p.at].sort().join(',')}`;

/** an entry's short id, its first 8 hex digits, as avenDB names it @param {string} entry */
export const shortId = (entry) => `${String(entry).slice(0, 8)}…`;

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

/**
 * What a page is refused for a recipe the vault lists whose file neither the page's device nor the feed handed over,
 * however long the page waited for it ($lib/assets/vault.js `PATIENCE`): it may well be in the vault, so the page tells
 * it apart from one that isn't.
 */
export class Unread extends NotInVault {
	name = 'Unread';
}

/** a value an object holds of its own, never one it inherits (`constructor`, `__proto__`) @param {Record<string, any>} o @param {string} k */
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

/** where a row is in the vault, in words @param {any} row */
const whereOf = (row) => `entry ${String(row?.entry ?? '?').slice(0, 12)}…`;

/** a file's bytes as text, refused unless they are UTF-8 as they stand (a byte order mark kept, as it was hashed) */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * One row the vault hands out as a recipe of the index, or why not: a `recipe` entry whose card fits its schema and
 * names its recipe, made for one of the frozen box engines (kind `box` of src/lib/sandbox/engines.json, by its hash), the one it then builds on
 * (../load.js `engineOf`): code runs on the engine it names (H4). Its file is not read here: only when a build needs
 * it. An asset is its entry, and its versions are the entry's own (Samuel 2026-10-18 and 10-19: avenDB's ids, not
 * refs): its tags are not read, so a version accepted onto its main line, or proposed on a line of it, counts with no
 * tag of its own; `vaultRecipes` holds every version of an entry to one asset.
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
	const e = r.engine ?? {};
	const at = e.host === 'box' && card.engine === e.version ? engineAt(e.version) : undefined;
	if (!at || e.hash !== at.blake3)
		return no(`made for ${e.host ?? '?'} engine ${e.version ?? '?'} (${String(e.hash ?? '?').slice(0, 12)}…), its card for ${card.engine}: pages run only the frozen box engines 1 to ${LATEST.v}, each by its hash`);
	// a kind's first variant, the one a legacy ref names where it names no variant: on its entry's main line, as a
	// variant's own line is beside it (`versionsOf`); a row that is its entry's only version, as the seed wrote one
	// entry for each variant before generation 15, is its kind's first where its tags say so
	const onMain = row.line === null || row.line === undefined;
	const tags = Array.isArray(row.tags) ? row.tags : [];
	const first = card.variant && onMain && (Object.hasOwn(row, 'main') || tags.includes(refTag(refOf(card.group, card.id, card.version)))) ? card.variant : undefined;
	return { hash: card.recipe, label, card, ...(first ? { first } : {}) };
}

/**
 * A recipe's name as avenDB names a version (`pin` op, $lib/avendb/versions.js `pinLabel`), as the avenDB app's Assets
 * lists it (./shelf.js `nameOf`): its title there, a variant's own name after the asset's ("Goat · Boer" of "Goat:
 * Boer", "Truck" of "Truck: Truck"), the number of the version of its entry's main line it is (`main`, else its
 * card's) and its entry's short id: "Oats v1 · 1a2b3c4d…".
 * @param {any} row @param {any} card
 */
function nameOfRow(row, card) {
	const v = Number.isInteger(row?.main) && row.main > 0 ? row.main : card.version;
	const title = String(row?.record?.title || card.label || `${card.group}/${card.id}`);
	const cut = card.variant ? title.indexOf(': ') : -1;
	const [asset, own] = cut > 0 ? [title.slice(0, cut), title.slice(cut + 2)] : [title, ''];
	return `${asset}${own && own !== asset ? ` · ${own}` : ''} v${v} · ${shortId(row?.entry ?? '')}`;
}

/**
 * The rows one row of the vault stands for: itself, or, where its entry brought files more than once, as an asset's
 * versions and variants each do (one entry for the asset, each version a record and its file in one write on main or
 * on a variant's line, avenDB's `Lab::brought`), one row for each: the row with that version's record, its files, its
 * write (`edit`, its `heads` too), the line whose history holds it (`line`, null for main's), the version of main
 * it belongs to (`main`) and the heads a pin of it names (`at`), as the feed (`world::public_row`) and the device
 * (`data::database`) list them (`brought`).
 * @param {any} row @returns {any[]}
 */
export function versionsOf(row) {
	const brought = Array.isArray(row?.brought) ? row.brought : [];
	if (!brought.length) return [row];
	const { brought: _, ...own } = row;
	return brought.map((/** @type {any} */ b) => ({
		...own,
		record: b?.record ?? null,
		files: Array.isArray(b?.files) ? b.files : [],
		heads: typeof b?.edit === 'string' ? [b.edit] : [],
		edit: b?.edit,
		line: b?.line ?? null,
		main: b?.version ?? null,
		at: Array.isArray(b?.at) ? b.at : []
	}));
}

/**
 * The Maia City vault's recipes as a page will read them, with no repo fallback (V5; Samuel 2026-10-17: what isn't
 * ported fails hard). `rows` are the vault's `recipe` entries as it hands them out, each `{ vault, entry, type, tags,
 * heads, record }` (a row of avenDB's feed, `world::public_row`, or one the person's device reads), an asset's entry
 * read as one row for each of its versions and variants (`versionsOf`); `read(row)` hands out a row's file, as bytes
 * or text, from whoever handed out the rows, and is asked only when a build needs that recipe. A row that doesn't check is left out, and why is said (`refused`); a ref two entries claim as two recipes, or
 * a recipe two refs claim, names nothing.
 *
 * It reads as ../recipes.js reads the repo's index: `index`, the shape of `virtual:asset-recipes`; `hashOf(ref)`, the
 * hash a ref names: a pin by its entry and version's heads (`PIN_REF`), or an old ref through the cards (its latest
 * version where it names none, its kind's first variant where it names none, and never another variant than the one
 * it names); `recipeAt(hash)`, `{ hash, code }`, the entry's file once read, held to the hash (the BLAKE3 of its
 * bytes) and to the version and variant its card says; `nameOf(hash)`, its name as avenDB gives it, which every error
 * about a recipe it holds says, and `pinOf(hash)`, the pin that names it. Each throws NotInVault, naming the ref, or
 * the recipe by its name, for what the vault doesn't hold or holds otherwise.
 * An entry is one asset: the one its first version names (its main line's oldest, as `versionsOf` lists them), and a
 * version of it whose card names another is refused, so no entry speaks for an asset another entry holds. `assets`
 * says which asset an entry already is (`group/id`, by its entry) where the rows don't hold its first version: a
 * proposal's line, read alone ($lib/avendb/assets.js `proposedSource`).
 * `stale` are rows older than the newest version this device proved of their entries (game/code/fresh.js `fresh`,
 * each `{ row, error }`), among `rows` too: what they hold is read as ever, so a pin by heads, or a ref that names its
 * version, still finds that exact version, but a ref that names no version, which means the newest, is refused with
 * that error rather than read off an entry held back at an older version, and the error is told (`refused`).
 * @param {any[]} rows
 * @param {{ read: (row: any) => Promise<Uint8Array | ArrayBuffer | string | undefined>, assets?: Iterable<[string, string]>, stale?: { row: any, error: string }[] }} o
 */
export function vaultRecipes(rows, { read, assets = [], stale = [] }) {
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
	/** the asset each entry is, by its first version that checks (`group/id`) @type {Map<string, string>} */
	const assetOf = new Map(assets);
	/** why an entry's newest version can't be read, where it was handed out older than this device proved it @type {Map<string, string>} */
	const older = new Map(stale.map((s) => [String(s.row?.entry), s.error]));
	refused.push(...older.values());
	for (const row of (Array.isArray(rows) ? rows : []).flatMap(versionsOf)) {
		const m = recipeOfRow(row);
		if ('error' in m) {
			if (m.label) refuse(m.label, m.error);
			else refused.push(m.error);
			continue;
		}
		const asset = `${m.card.group}/${m.card.id}`;
		const is = assetOf.get(row.entry) ?? asset;
		assetOf.set(row.entry, is);
		if (is !== asset) {
			refuse(m.label, `${m.label} (${whereOf(row)}): its entry is ${is}’s, and an entry is one asset`);
			continue;
		}
		claims.set(m.label, [...(claims.get(m.label) ?? []), { ...m, row }]);
		labelsOf.set(m.hash, new Set([...(labelsOf.get(m.hash) ?? []), m.label]));
	}
	/** each recipe's row, by its hash @type {Map<string, any>} */
	const rowOf = new Map();
	/** each recipe's name, as avenDB names it, by its hash @type {Map<string, string>} */
	const names = new Map();
	/** the recipe each pin names, by its entry and heads (`pinKey`) @type {Map<string, string>} */
	const pins = new Map();
	/** each entry's vault and the versions it holds, as its rows say @type {Map<string, { vault: unknown, held: string[] }>} */
	const entries = new Map();
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
		names.set(hash, nameOfRow(row, card));
		for (const x of held) {
			if (typeof x.row.entry !== 'string') continue;
			const e = entries.get(x.row.entry) ?? { vault: x.row.vault, held: /** @type {string[]} */ ([]) };
			entries.set(x.row.entry, e);
			e.held.push(names.get(hash) ?? label);
			if (Array.isArray(x.row.at) && x.row.at.length) pins.set(pinKey({ entry: x.row.entry, at: x.row.at }), hash);
		}
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
	/**
	 * The recipe a pin names, or NotInVault saying what the vault holds of its entry instead.
	 * @param {NonNullable<ReturnType<typeof parsePin>>} pin
	 */
	const pinned = (pin) => {
		const e = entries.get(pin.entry);
		const hash = e && (!pin.vault || typeof e.vault !== 'string' || e.vault === pin.vault) ? pins.get(pinKey(pin)) : undefined;
		if (hash) return hash;
		const at = pin.at.map((h) => h.slice(0, 8)).join(', ');
		if (!e) throw new NotInVault(`entry ${shortId(pin.entry)} is not in the Maia City vault`);
		if (pin.vault && typeof e.vault === 'string' && e.vault !== pin.vault) throw new NotInVault(`entry ${shortId(pin.entry)} is in vault ${shortId(e.vault)}, not in vault ${shortId(pin.vault)}`);
		throw new NotInVault(`${[...new Set(e.held)].join(', ')}: no version of entry ${shortId(pin.entry)} at ${at}… is in the Maia City vault`);
	};
	/** a recipe's file, read from the vault and held to its hash and to its card @param {any} at @param {string} hash */
	async function fileOf(at, hash) {
		const named = names.get(hash) ?? at.label;
		let got;
		try {
			got = await read(rowOf.get(hash));
		} catch (e) {
			// a file asked for in vain only in passing (the network, a server restarting) may well be there: told apart
			const Failed = /** @type {any} */ (e)?.passing ? Unread : NotInVault;
			throw new Failed(`${named}: its file could not be read from the Maia City vault (${e instanceof Error ? e.message : String(e)})`);
		}
		const bytes = typeof got === 'string' ? utf8ToBytes(got) : got instanceof ArrayBuffer ? new Uint8Array(got) : got;
		if (!(bytes instanceof Uint8Array)) throw new NotInVault(`${named}: the Maia City vault handed out no file for it`);
		const hashed = hashBytes(bytes);
		if (hashed !== hash) throw new NotInVault(`${named}: refused, its file in the Maia City vault hashes to ${hashed.slice(0, 12)}…, not to ${hash.slice(0, 12)}…, the recipe it names`);
		let code;
		try {
			code = typeof got === 'string' ? got : UTF8.decode(bytes);
		} catch {
			throw new NotInVault(`${named}: refused, its file in the Maia City vault is not UTF-8 text`);
		}
		// the file's last line says which version and variant it builds (../engines.js recipeTail): the one its card says
		if (!code.endsWith(recipeTail(at.id, at.v, at.variant)))
			throw new NotInVault(`${named}: refused, its file in the Maia City vault is the recipe of another version or variant than its card says`);
		return { hash, code };
	}
	/** @type {Map<string, Promise<{ hash: string, code: string }>>} */
	const files = new Map();
	return {
		index,
		refused,
		/**
		 * The hash a ref names in the vault: a pin, by its entry and the heads of its version (`PIN_REF`, or `{ entry,
		 * at }`), or an old ref read through what the entries' cards say (`group/id[@v][:variant][?values]`); a vault's
		 * group ref is still refused.
		 * @param {string | { entry: string, at: string[] }} ref @returns {string}
		 */
		hashOf(ref) {
			const pin = parsePin(ref);
			if (pin) return pinned(pin);
			if (typeof ref !== 'string') throw new NotInVault(`not an asset ref: ${JSON.stringify(ref)?.slice(0, 80)}`);
			if (ref.startsWith(VAULT)) throw refusal(parseVaultRef(ref));
			const { group, id, v, variant } = parseRef(ref);
			const latest = v ?? own(index.latest, `${group}/${id}`);
			if (!latest) throw missing(ref);
			const named = refOf(group, id, latest, variant);
			const first = variant ? undefined : own(index.first, named);
			const hash = own(index.labels, named) ?? (first ? own(index.labels, refOf(group, id, latest, first)) : undefined);
			if (!hash) throw missing(ref, named, why.get(named));
			// the newest it names, off an entry handed out older than this device proved it: refused, saying both versions
			const held = v == null ? older.get(String(rowOf.get(hash)?.entry)) : undefined;
			if (held) throw new NotInVault(`${ref}: its newest version can't be read: ${held}`);
			return hash;
		},
		/**
		 * The row a recipe of the index was read from, by its hash: its entry, its tags and its record (its card, title
		 * and note), as a viewer of the vault shows it ($lib/avendb/Assets.svelte); undefined for a hash it doesn't hold.
		 * Its file is read only by `recipeAt`.
		 * @param {string} hash @returns {any}
		 */
		rowOf: (hash) => (typeof hash === 'string' && own(index.recipes, hash) ? rowOf.get(hash) : undefined),
		/**
		 * A recipe's name, avenDB's alone: its title, its version's number and its entry's short id ("Oats v1 ·
		 * 1a2b3c4d…"); undefined for a hash it doesn't hold.
		 * @param {string} hash @returns {string | undefined}
		 */
		nameOf: (hash) => (typeof hash === 'string' && own(index.recipes, hash) ? names.get(hash) : undefined),
		/**
		 * The pin that names a recipe, `{ vault, entry, at }`, where its row lists the heads of its version; undefined
		 * otherwise.
		 * @param {string} hash @returns {{ vault: string, entry: string, at: string[] } | undefined}
		 */
		pinOf(hash) {
			const row = typeof hash === 'string' && own(index.recipes, hash) ? rowOf.get(hash) : undefined;
			return row && Array.isArray(row.at) && row.at.length ? { vault: row.vault, entry: row.entry, at: [...row.at].sort() } : undefined;
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
