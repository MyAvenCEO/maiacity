// The repo seed's top-up of the Maia City vault: what the repository adds to the live architecture, written into the
// vault by whichever of the person's devices comes first (./Account.svelte, as it writes avenCEO GmbH's schemas), only
// where Maia City never held it. avenDB is never reset (Samuel 2026-10-19: "all the data we have now in avenDB Maia City
// is the one we want to keep and that has been correctly seeded"), so the vault is the truth: the seed never writes
// over an entry, never brings back one the vault deleted, and never grants or shares anything. Each piece carries a tag
// that names what it was made from (a code entry's `ref:…`, a game's `game:<id>`), and a piece any entry of the vault
// carries, deleted or not, is left out.
//
//   code       each view and logic module of code/ (game/code/sources/avendb.js `recordOf`), found by its `ref:` tag
//   games      the Games area (game/games.js): the vault's own schema "Game, v1", then each game's entry, of type `game`,
//              tagged `game` and `game:<id>`, unpublished: an admin publishes one (its Public share) on the Sandboxes list
//   settings   each game's settings (A3, code/configs/): the vault's own schema "Config, v1", then each config an entry
//              of type `config`, tagged `ref:configs/<game>/<id>` and `game:<id>`, which every game reads through
//              game/code/index.js `configAt`
//   recipes    last, as their files are most of the seed's bytes: each asset of the asset box
//              (src/lib/assets/box/plugin.js) one `recipe` entry with its history: its first version created with its
//              file, the recipe byte for byte, in one write (`beside`), each later one a proposal whose one write is its
//              record and its file, merged into main, and each variant a line beside main that follows it (`assetOps`),
//              each record src/lib/assets/sources/avendb.js `recipeEntryOf`'s, its card from
//              src/lib/assets/sources/cards.json; found by the `ref:` tag of its newest version, its last op's
//
// The legacy content (the journal days, the inspire-me reports, the idea pads), the post types and the vault's shares
// came in once and live in Maia City alone now (Samuel 2026-10-19: drop the legacy seedings).
//
// The docs of ./docs.js (the skills) are no piece of it: each goes into Maia City as an AIP its owners accept (Samuel
// 2026-10-20: a new doc goes in as a proposal), drafted by scripts/propose-doc.mjs as a story with its full text and its
// doc post (`docRecords`), and every newer text of it a proposal on both. The ones an earlier seed wrote stay as they
// are.

import { parse as parseYaml } from 'yaml';
import { ENTRIES } from '../../../code/index.js';
import { recordOf } from '../../../game/code/sources/avendb.js';
import { stageTag } from './flows.js';
import { POST_TYPES, postTag } from './posttypes.js';
import { DOCS, readable } from './docs.js';
import { brings } from './ops.js';
import { GAME, GAMES, gameTag } from '../../../game/games.js';
import { INDEX, recipeAt } from '../assets/recipes.js';
import { recipeEntryOf, refTag } from '../assets/sources/avendb.js';

/** The types of the code entries the vault holds, which everyone reads, as the repo's code/ is open to everyone. */
export const CODE_TYPES = ['view', 'logic'];

/** The type of the games' settings the vault holds (A3), which everyone reads, as the repo's code/configs/ is open. */
export const CONFIG_TYPES = ['config'];

/** The types of the asset recipes the vault holds, which everyone reads, as the repo's assets are open to everyone. */
export const RECIPE_TYPES = ['recipe'];

/** The tag of the content flow's draft stage, which only those its vault shares it with read. */
const DRAFT = stageTag('content', 'draft');

/** The tag of the doc post of document `key` (./docs.js `DOCS`), by which scripts/propose-doc.mjs finds it. @param {string} key */
export const docTag = (key) => `doc:${key}`;

/** The title of the Maia City vault's own schema of a game's settings. */
export const CONFIG_SCHEMA = 'Config, v1';

/**
 * The schema of a game's settings (A3, Samuel 2026-10-19: game settings and sandbox configs belong to the Maia City
 * COOP): its name, what it sets, and the settings themselves as JSON (`data`), which the game reads in the shape of
 * the repo's seed of them (game/code/check.js `config`). Its path is its `ref:configs/<game>/<id>` tag, its game its
 * `game:<id>` tag.
 */
export const CONFIG_V1 = JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: CONFIG_SCHEMA,
	type: 'object',
	properties: {
		kind: { const: 'config' },
		title: { type: 'string', maxLength: 160 },
		note: { type: 'string', maxLength: 2000, default: '' },
		data: { type: 'object' }
	},
	required: ['kind', 'title', 'data']
});

/** The title of the Maia City vault's own schema of a game's entry. */
export const GAME_SCHEMA = 'Game, v1';

/**
 * The schema of a game's entry in the Games area: its id (as its `game:<id>` tag names it), its name, where it is
 * played and what it is, as the dashboard lists it. Whether it is published is no field: a Public share says it.
 */
export const GAME_V1 = JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: GAME_SCHEMA,
	type: 'object',
	properties: {
		kind: { const: GAME },
		id: { type: 'string', maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]*$' },
		title: { type: 'string', maxLength: 160 },
		route: { type: 'string', maxLength: 200, default: '' },
		note: { type: 'string', maxLength: 2000, default: '' }
	},
	required: ['kind', 'id', 'title']
});

/** Every recipe's card, by its hash (src/lib/assets/sources/cards.json, 1 MB), loaded once a recipe is written. */
const CARDS = /** @type {Record<string, () => Promise<{ cards: Record<string, any> }>>} */ (
	import.meta.glob('/src/lib/assets/sources/cards.json', { import: 'default' })
);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** A Markdown file's frontmatter. @param {string} raw @returns {Record<string, any>} */
function frontmatter(raw) {
	const m = FRONTMATTER.exec(raw);
	try {
		return (m ? parseYaml(m[1]) : null) ?? {};
	} catch {
		return {};
	}
}

/** A frontmatter value as one trimmed line of text. @param {unknown} v */
const str = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Only the fields that hold something. @param {Record<string, any>} o */
const filled = (o) =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));

/**
 * @typedef {{ key: string, kind: 'code' | 'game-schema' | 'game' | 'config-schema' | 'config' | 'recipe', name: string, mark: string }} Piece
 */

/** Every piece of the repo seed's top-up, each with the tag its copy carries (`mark`). @returns {Piece[]} */
export function seedPieces() {
	const code = Object.values(ENTRIES)
		.filter((e) => CODE_TYPES.includes(e.type))
		.sort((a, b) => a.ref.localeCompare(b.ref))
		.map((e) => ({ key: e.ref, kind: /** @type {const} */ ('code'), name: e.ref, mark: `ref:${e.ref}` }));
	const games = [
		{ key: 'game-schema', kind: /** @type {const} */ ('game-schema'), name: GAME_SCHEMA, mark: '' },
		...GAMES.map((g) => ({ key: `game/${g.id}`, kind: /** @type {const} */ ('game'), name: g.id, mark: gameTag(g.id) }))
	];
	const configs = Object.values(ENTRIES)
		.filter((e) => CONFIG_TYPES.includes(e.type))
		.sort((a, b) => a.ref.localeCompare(b.ref))
		.map((e) => ({ key: e.ref, kind: /** @type {const} */ ('config'), name: e.ref, mark: `ref:${e.ref}` }));
	const settings = configs.length ? [{ key: 'config-schema', kind: /** @type {const} */ ('config-schema'), name: CONFIG_SCHEMA, mark: '' }, ...configs] : [];
	const recipes = Object.entries(assetsOf())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([asset, versions]) => ({ key: asset, kind: /** @type {const} */ ('recipe'), name: asset, mark: refTag(versions[versions.length - 1][0]) }));
	return [...code, ...games, ...settings, ...recipes];
}

/** The tag a deleted entry carries among its own tags: no feed reader takes it in (game/code/sources/avendb.js, game/games.js). */
export const GONE = 'avendb:deleted';

/**
 * The pieces among `all` vault `vault` never held: no entry of it, deleted or not, carries the piece's tag (an entry's
 * last op makes it, so a piece cut short is written again whole), and no schema of it, deleted or not, the piece's
 * title; an asset's recipes, no recipe entry of it a ref of the asset at any version (`assetOps`): a version newer
 * than the vault's goes in as a proposal (scripts/propose-version.mjs), never as a second entry of the asset. One the
 * vault deleted stays deleted (Samuel 2026-10-19: Maia City as it is is the truth).
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {Piece[]} all
 */
export function unseeded(world, vault, all) {
	const ever = world.entries.filter((e) => e.vault === vault);
	const have = new Set(ever.flatMap((e) => e.tags ?? []));
	const recipes = ever.filter((e) => RECIPE_TYPES.includes(e.type ?? '')).flatMap((e) => e.tags ?? []);
	const schema = (/** @type {string} */ title) => ever.some((e) => e.kind === 'schema' && e.title === title);
	return all.filter((p) =>
		p.kind === 'config-schema' ? !schema(CONFIG_SCHEMA) : p.kind === 'game-schema' ? !schema(GAME_SCHEMA) :
		p.kind === 'recipe' ? !recipes.some((t) => t.startsWith(refTag(`${p.name}@`))) : !have.has(p.mark)
	);
}

/**
 * The ops that write piece `p` into vault `vault`, acting for it, one after another, each `"$n"` in one the entry op
 * n of them created (./ops.js `refs`): the piece's own tag on its last.
 * @param {Piece} p @param {string} vault
 * @returns {Promise<object[]>}
 */
export async function seeding(p, vault) {
	const as = vault;
	if (p.kind === 'config') {
		const { type, tags, value } = recordOf(/** @type {Record<string, any>} */ (ENTRIES)[p.key]);
		return [{ op: 'create', vault, type, tags, value, as }];
	}
	if (p.kind === 'config-schema') return [{ op: 'create', vault, type: 'schema', value: CONFIG_V1, as }];
	if (p.kind === 'code') {
		const { type, tags, value } = recordOf(/** @type {Record<string, any>} */ (ENTRIES)[p.key]);
		return [{ op: 'create', vault, type, tags, schema: type, value, as }];
	}
	if (p.kind === 'recipe') return assetOps(p.name, vault, p.mark);
	if (p.kind === 'game-schema') return [{ op: 'create', vault, type: 'schema', value: GAME_V1, as }];
	const g = GAMES.find((x) => x.id === p.name);
	if (!g) return [];
	const value = { kind: GAME, id: g.id, title: g.label, route: g.route, note: g.note ?? '' };
	return [{ op: 'create', vault, type: GAME, tags: [GAME, p.mark], value, as }];
}

/**
 * The repo's assets, each by `group/id`, with its versions oldest first, each a list of the labels of its recipes, its
 * kind's first variant first (the one its ref names where it names no variant, src/lib/assets/recipes.js `INDEX`), then
 * the others by name: `{ 'machines/lamp': [['machines/lamp@1:brass', 'machines/lamp@1:iron'], ...] }`.
 * @returns {Record<string, string[][]>}
 */
export function assetsOf() {
	/** @type {Record<string, Map<number, any[]>>} */
	const by = {};
	for (const r of Object.values(INDEX.recipes)) {
		const at = /** @type {any} */ (r);
		const versions = (by[`${at.group}/${at.id}`] ??= new Map());
		versions.set(at.v, [...(versions.get(at.v) ?? []), at]);
	}
	/** @param {any[]} rs @param {number} v */
	const ordered = (rs, v) => {
		const first = rs[0] ? INDEX.first[`${rs[0].group}/${rs[0].id}@${v}`] : undefined;
		const rank = (/** @type {any} */ r) => (r.variant === first || !r.variant ? 0 : 1);
		return [...rs].sort((a, b) => rank(a) - rank(b) || String(a.variant ?? '').localeCompare(String(b.variant ?? ''))).map((r) => /** @type {string} */ (r.label));
	};
	return Object.fromEntries(
		Object.entries(by).map(([asset, versions]) => [asset, [...versions.entries()].sort(([a], [b]) => a - b).map(([v, rs]) => ordered(rs, v))])
	);
}

/**
 * Recipe `label` of the asset box as vault `vault`'s `recipe` entry holds one of its versions: its type, tags, record
 * and file (src/lib/assets/sources/avendb.js `recipeEntryOf`), its card from the repo's
 * (src/lib/assets/sources/cards.json) and its file the recipe byte for byte, as src/lib/assets/recipes.js hands it out
 * checked against its hash. A kind's first variant is tagged with the ref that names no variant too, as the repo's
 * index names it.
 * @param {string} label @param {Record<string, any>} cards
 */
async function recipeOf(label, cards) {
	const hash = INDEX.labels[label];
	const at = INDEX.recipes[hash];
	if (!at) throw new Error(`${label}: no recipe of the repo's`);
	const { code } = await recipeAt(hash);
	const card = cards[hash];
	if (!card) throw new Error(`${label}: src/lib/assets/sources/cards.json has no card of it (bun scripts/recipe-cards.mjs)`);
	const first = !!at.variant && INDEX.first[`${at.group}/${at.id}@${at.v}`] === at.variant;
	return recipeEntryOf({ code, card, first });
}

/**
 * Version `v` of asset `asset` (`group/id`, `assetsOf`) as the entry of an asset the vault already holds takes it from
 * a proposal (scripts/propose-version.mjs): each of its recipes, its main's first, then its other variants', as
 * `assetOps` writes them, with its label (`recipeOf`).
 * @param {string} asset @param {number} v
 */
export async function versionOf(asset, v) {
	const labels = (assetsOf()[asset] ?? []).find((ls) => INDEX.recipes[INDEX.labels[ls[0]]].v === v);
	if (!labels) throw new Error(`${asset}@${v}: no version of the repo's`);
	const { cards } = await CARDS['/src/lib/assets/sources/cards.json']();
	return Promise.all(labels.map(async (label) => ({ label, ...(await recipeOf(label, cards)) })));
}

/**
 * The ops that write asset `asset` of the asset box (`group/id`, `assetsOf`) into vault `vault`, acting for it, as one
 * `recipe` entry with its history: its first version's main recipe created with its file, in one write; each later
 * version a proposal (`propose`) whose one write is its record and its file (`put_file` with its `line` and `value`),
 * merged into main (`merge`), which every variant follows; each variant a line beside main (`variant`), started from
 * the main version it first appears in, whose own write after each version is its record and file. Each file's text
 * in `file.text`, which goes beside the op, never in it (`beside`). The entry carries the tags of every recipe it holds:
 * its group from its first op, each ref (`mark`, its newest version's, among them) from its last, so a piece cut short
 * names no recipe and is written again whole (`unseeded`).
 * @param {string} asset @param {string} vault @param {string} mark
 */
async function assetOps(asset, vault, mark) {
	const versions = assetsOf()[asset];
	if (!versions?.length) throw new Error(`${asset}: no asset of the repo's`);
	const { cards } = await CARDS['/src/lib/assets/sources/cards.json']();
	const as = vault;
	/** @type {any[]} */
	const ops = [];
	/** @param {string} label @param {any} entry */
	const fileOf = (label, entry) => ({ name: `${label}.js`, media: entry.file.media, text: entry.file.text });
	/** @param {string} line @param {string} label @param {any} entry */
	const write = (line, label, entry) =>
		ops.push({ op: 'put_file', entry: '$0', line, value: entry.value, schema: entry.type, file: fileOf(label, entry), as });
	/** each variant's line, by its name: the `"$n.line"` of the op that started it @type {Map<string, string>} */
	const lines = new Map();
	const tags = new Set();
	for (const [n, labels] of versions.entries()) {
		const entries = await Promise.all(labels.map((label) => recipeOf(label, cards)));
		for (const e of entries) for (const t of e.tags) tags.add(t);
		const [main, ...others] = labels;
		if (n === 0) {
			const { type, value, file } = entries[0];
			ops.push({ op: 'create', vault, type, tags: [], schema: type, value, file: { name: `${main}.js`, media: file.media, text: file.text }, as });
		} else {
			const proposal = `$${ops.length}.line`;
			ops.push({ op: 'propose', entry: '$0', name: `v${INDEX.recipes[INDEX.labels[main]].v}`, as });
			write(proposal, main, entries[0]);
			ops.push({ op: 'merge', entry: '$0', from: proposal, into: null, as });
		}
		for (const [i, label] of others.entries()) {
			const name = INDEX.recipes[INDEX.labels[label]].variant;
			if (!lines.has(name)) {
				lines.set(name, `$${ops.length}.line`);
				ops.push({ op: 'variant', entry: '$0', name, as });
			}
			write(/** @type {string} */ (lines.get(name)), label, entries[i + 1]);
		}
	}
	tags.add(mark);
	const refs = [...tags].filter((t) => t.startsWith(refTag(''))).sort();
	ops[0].tags = [...tags].filter((t) => !refs.includes(t)).sort();
	ops.push({ op: 'tag', entry: '$0', add: refs, as });
	return ops;
}

/**
 * Op `op` of a piece as the device takes it, and the file it brings beside it, if any: a recipe's create or put_file
 * carries its file's text in `file.text` (`seeding`), which goes beside the op as its bytes (./ops.js `brings`, the
 * session's `bring`), never in it; a put_file names the file's name and media type itself, not in a `file`.
 * @param {any} op @returns {{ op: any, file: Blob | null }}
 */
export function beside(op) {
	if (!brings(op) || typeof op.file?.text !== 'string') return { op, file: null };
	const { text, ...file } = op.file;
	const bytes = new Blob([text], { type: file.media ?? '' });
	if (op.op !== 'put_file') return { op: { ...op, file }, file: bytes };
	const { file: _, ...put } = op;
	return { op: { ...put, ...file }, file: bytes };
}

/**
 * Document `key` of ./docs.js as it goes into a vault (scripts/propose-doc.mjs drafts both): a story with its full
 * text, and its doc post, a draft of the content flow, tagged `doc:<key>`, its `story` the one the caller names once
 * the story's entry exists. Nothing when ./docs.js has no such document.
 * @param {string} key
 * @returns {Promise<{ story: { type: string, tags: string[], value: Record<string, any> }, post: { type: string, tags: string[], value: Record<string, any> } } | null>}
 */
export async function docRecords(key) {
	const d = DOCS.find((x) => x.key === key);
	if (!d) return null;
	const text = await d.read();
	const fm = d.section === 'skill' ? frontmatter(text) : {};
	const title = str(fm.name) || d.title;
	const excerpt = str(fm.description) || d.excerpt;
	const story = filled({ kind: 'story', title, text, series: 'Docs', description: excerpt, sparks: [], tags: [] });
	const value = filled({
		kind: postTag('doc'),
		title,
		text: d.section === 'skill' ? readable(text) : text,
		channel: POST_TYPES.doc.channel,
		...filled({ excerpt, language: 'en', section: d.section, slug: d.slug, page: d.page }),
		tags: []
	});
	return {
		story: { type: 'story', tags: [stageTag('story', 'writing'), 'doc'], value: story },
		post: { type: 'post', tags: [DRAFT, postTag('doc'), docTag(key)], value }
	};
}
