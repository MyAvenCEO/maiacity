// The repo seed of the Maia City vault (Samuel 2026-10-17: everything trustless lives in the Maia City COOP vault, and
// after a reset of avenDB it all comes back from the repository): what the repository holds, written into the vault
// once, by whichever of the person's devices comes first (./Account.svelte, as it writes avenCEO GmbH's schemas). Each
// piece carries a tag that names what it was made from (`legacy:…`, or a code entry's `ref:…`), so a piece the vault
// holds already is left out, and seeding again writes only what is new. The repository stays as it is: it is the seed
// pages read offline, and what a reset brings back.
//
//   keep       a Backup share to avenMAIA's vault, where the vault gives it none yet: the server serves only what
//              it keeps, so without it the feeds have nothing of the vault's to show; and avenMAIA's default rights
//              (Samuel 2026-10-18): Suggester on the whole of it, and an AIP author's share on its AIPs, so the aven,
//              and every agent that is its device, proposes and drafts and opens AIPs, and a human of it merges
//   code       each view and logic module of code/ (game/code/sources/avendb.js `recordOf`), found by its `ref:` tag,
//              and one Public share of the vault's views and logic, so the server's code feed serves them
//   post types each post type, a schema of the vault's own with its template inside (./posttypes.js): journal
//              (blog/TEMPLATE.md) and inspire (inspire-me/FORMAT.md)
//   journal    each journal day (blog/day-NN-…/post.md): a story, its source of truth, with its full text; and its
//              journal post (`post:journal`) on the Maia Universe stream, on the day it was first published
//   inspire    each inspire-me report: its source an artifact on a spark (./legacy.js), the story grown from the spark,
//              with the report's text, and its inspire post (`post:inspire`), on the day it was added, as a draft
//              (Samuel 2026-10-18: every inspire-me piece unpublished, `DRAFTED`); ./Account.svelte drafts the posts an
//              earlier seed published (`drafting`), once each, so one its owner publishes again stays published
//   inspire    (after the published share) one Public share of every inspire-me piece (`INSPIRE`), so the Universe lays
//              an inspire post out as its report card; ./Account.svelte then brings each copied source up to date
//              (`touchingUp`): its author's portrait, and the tag
//   published  one Public share of the vault's published entries (`content:published`), as the content flow's
//              published stage is public: the posts and their stories go on the stream
//   name       one Public share of the vault's profile, by type, so its posts on the stream go out under its name
//              ("Maia City"), not a stand-in from its id
//   docs       each document of ./docs.js (Samuel 2026-10-18): each skill of .claude/skills, the theOS paper and the
//              avenDB architecture, a story with its full text, and its doc post (`post:doc`), both drafts (Samuel
//              2026-10-18: docs live in avenDB alone, not on the public site), which avenDB's Docs view lists
//              (./Docs.svelte); ./Account.svelte drafts those an earlier seed published (`drafting`)
//   pads       the journal's sources and each story's idea pad, sparks as ./legacy.js copies them
//   games      the Games area (game/games.js): the vault's own schema "Game, v1", then each game's entry, of type `game`,
//              tagged `game` and `game:<id>`; MaiaCity V1 (`RELEASED`) also gets the Public share on its tag that lets
//              everyone watch it and read its proposals, written with its entry, once. Who plays a game is the vault's
//              cap groups' to say (./capgroups.js), which ./Account.svelte defines after the pieces where Maia City
//              holds none of their names yet
//   settings   each game's settings (A3, code/configs/): the vault's own schema "Config, v1", one Public share of its
//              configs by type, so the server's code feed serves them, then each config an entry of type `config`,
//              tagged `ref:configs/<game>/<id>` and `game:<id>`, which every game reads through game/code/index.js
//              `configAt` (the seed's until the vault's are loaded, held to the seed's shape)
//   recipes    last, as their files are most of the seed's bytes (V5 of the avenDB migration): one Public share of the
//              vault's recipes, by type, so the server's feed serves them and their files; then each asset of the
//              asset box (src/lib/assets/box/plugin.js) one `recipe` entry with its history (Samuel 2026-10-18): its
//              first version created with its file, the recipe byte for byte, in one write (`beside`), each later one
//              a proposal whose one write is its record and its file, merged into main, and each variant a line
//              beside main that follows it, its own record and file written after each version (`assetOps`), each
//              record src/lib/assets/sources/avendb.js `recipeEntryOf`'s, its card from
//              src/lib/assets/sources/cards.json; found by the `ref:` tag of its newest version, its last op's
//
// There are only stories and their posts (Samuel 2026-10-17): the story is the source of truth, and each post one way
// it goes out, of a post type, linking it (`story`). No articles, no notes, no templates of their own. The notebook's ideas live on maia.city's server,
// not in the repository: ./LegacyCopy.svelte still copies those by hand.

import { parse as parseYaml } from 'yaml';
import { ENTRIES } from '../../../code/index.js';
import { recordOf } from '../../../game/code/sources/avendb.js';
import { PICTURE } from './article.js';
import { stageTag } from './flows.js';
import { copying, legacyTag, pieces as legacyPieces } from './legacy.js';
import { EVERYONE, nameShare, nameShared } from './vaults.js';
import { POST_TYPES, postTag, postTypeSchema, postTypeTitle } from './posttypes.js';
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

/** The tag of the content flow's published stage, which everyone reads. */
export const PUBLISHED = stageTag('content', 'published');

/** The tag of the content flow's draft stage, which only those its vault shares it with read. */
export const DRAFT = stageTag('content', 'draft');

/** The tag of the doc post of document `key` (./docs.js `DOCS`), by which the seed finds it. @param {string} key */
export const docTag = (key) => `doc:${key}`;

/** The tag every inspire post the seed drafted carries (Samuel 2026-10-18: all inspire-me pieces unpublished), so a
 *  post drafted once is never drafted again: one its owner publishes later stays published. */
export const DRAFTED = 'seed:drafted';

/** The tag every inspire-me piece carries, its story, post, spark and source, which everyone reads: the
 *  Universe lays an inspire post out as its report card from them all. */
export const INSPIRE = 'inspire-me';

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

/** The games everyone may watch, signed out too, by id: a Public share on each one's tag, written at the seed. */
const RELEASED = new Set(['maiacity-v1']);

const POSTS = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/blog/day-*/post.md', { query: '?raw', import: 'default' })
);
const REPORTS = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/inspire-me/*/README.md', { query: '?raw', import: 'default' })
);
/** Each post type's template, by the file that holds it (./posttypes.js `POST_TYPES`). */
const TEMPLATES = /** @type {Record<string, () => Promise<string>>} */ ({
	...import.meta.glob('/blog/TEMPLATE.md', { query: '?raw', import: 'default' }),
	...import.meta.glob('/inspire-me/FORMAT.md', { query: '?raw', import: 'default' }),
	...import.meta.glob('/films/TEMPLATE.md', { query: '?raw', import: 'default' }),
	...import.meta.glob('/docs/TEMPLATE.md', { query: '?raw', import: 'default' })
});
/** Every recipe's card, by its hash (src/lib/assets/sources/cards.json, 1 MB), loaded once a recipe is written. */
const CARDS = /** @type {Record<string, () => Promise<{ cards: Record<string, any> }>>} */ (
	import.meta.glob('/src/lib/assets/sources/cards.json', { import: 'default' })
);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** A Markdown file's frontmatter and body. @param {string} raw */
function split(raw) {
	const m = FRONTMATTER.exec(raw);
	let fm = {};
	try {
		fm = (m ? parseYaml(m[1]) : null) ?? {};
	} catch {
		fm = {};
	}
	return { fm: /** @type {Record<string, any>} */ (fm), body: (m ? m[2] : raw).trim() };
}

/** A frontmatter value as one trimmed line of text. @param {unknown} v */
const str = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/** A frontmatter list of names. @param {unknown} v */
const names = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Only the fields that hold something. @param {Record<string, any>} o */
const filled = (o) =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));

/** The folder a path names. @param {string} path */
const folderOf = (path) => path.split('/').at(-2) ?? '';

/**
 * @typedef {{ key: string, kind: 'keep' | 'aven-suggests' | 'aven-aips' | 'code' | 'share' | 'post-type' | 'journal' | 'inspire' | 'pad' | 'published' |
 *   'inspire-share' | 'name-share' | 'doc' | 'game-schema' | 'game' | 'config-schema' | 'config' | 'config-share' | 'recipe-share' | 'recipe', name: string, mark: string, server?: string }} Piece
 */

/**
 * Every piece of the repo seed, each with the tag its copy carries (`mark`); with `server`, the id of avenMAIA's
 * vault, first the Backup share that makes it keep the vault.
 * @param {string | null} [server] @returns {Piece[]}
 */
export function seedPieces(server = null) {
	const keep = server
		? [
				{ key: 'server-keep', kind: /** @type {const} */ ('keep'), name: 'The server keeps it', mark: '', server },
				{ key: 'aven-suggests', kind: /** @type {const} */ ('aven-suggests'), name: 'avenMAIA suggests', mark: '', server },
				{ key: 'aven-aips', kind: /** @type {const} */ ('aven-aips'), name: 'avenMAIA opens AIPs', mark: '', server }
			]
		: [];
	const code = Object.values(ENTRIES)
		.filter((e) => CODE_TYPES.includes(e.type))
		.sort((a, b) => a.ref.localeCompare(b.ref))
		.map((e) => ({ key: e.ref, kind: /** @type {const} */ ('code'), name: e.ref, mark: `ref:${e.ref}` }));
	const share = code.length ? [{ key: 'code-share', kind: /** @type {const} */ ('share'), name: 'Everyone reads its code', mark: '' }] : [];
	const types = Object.keys(POST_TYPES).map((t) => ({ key: `post-type/${t}`, kind: /** @type {const} */ ('post-type'), name: t, mark: '' }));
	const journal = Object.keys(POSTS)
		.sort()
		.map((p) => ({ key: `blog/${folderOf(p)}`, kind: /** @type {const} */ ('journal'), name: folderOf(p), mark: legacyTag(`blog/${folderOf(p)}`) }));
	const inspire = Object.keys(REPORTS)
		.sort()
		.map((p) => ({ key: `inspire-me/${folderOf(p)}`, kind: /** @type {const} */ ('inspire'), name: folderOf(p), mark: legacyTag(`inspire-me/${folderOf(p)}`) }));
	const docs = DOCS.map((d) => ({ key: d.key, kind: /** @type {const} */ ('doc'), name: d.key, mark: docTag(d.key) }));
	const pads = legacyPieces([])
		.filter((p) => p.kind === 'journal' || p.kind === 'pad')
		.map((p) => ({ key: p.key, kind: /** @type {const} */ ('pad'), name: p.name, mark: legacyTag(p.key) }));
	const published = [
		{ key: 'published-share', kind: /** @type {const} */ ('published'), name: 'Everyone reads what it published', mark: '' },
		{ key: 'inspire-share', kind: /** @type {const} */ ('inspire-share'), name: 'Everyone reads its inspire-me pieces', mark: '' },
		{ key: 'name-share', kind: /** @type {const} */ ('name-share'), name: 'Everyone reads its name', mark: '' }
	];
	const games = [
		{ key: 'game-schema', kind: /** @type {const} */ ('game-schema'), name: GAME_SCHEMA, mark: '' },
		...GAMES.map((g) => ({ key: `game/${g.id}`, kind: /** @type {const} */ ('game'), name: g.id, mark: gameTag(g.id) }))
	];
	const configs = Object.values(ENTRIES)
		.filter((e) => CONFIG_TYPES.includes(e.type))
		.sort((a, b) => a.ref.localeCompare(b.ref))
		.map((e) => ({ key: e.ref, kind: /** @type {const} */ ('config'), name: e.ref, mark: `ref:${e.ref}` }));
	const settings = configs.length
		? [
				{ key: 'config-schema', kind: /** @type {const} */ ('config-schema'), name: CONFIG_SCHEMA, mark: '' },
				{ key: 'config-share', kind: /** @type {const} */ ('config-share'), name: 'Everyone reads the games’ settings', mark: '' },
				...configs
			]
		: [];
	const recipes = Object.entries(assetsOf())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([asset, versions]) => ({ key: asset, kind: /** @type {const} */ ('recipe'), name: asset, mark: refTag(versions[versions.length - 1][0]) }));
	const recipeShare = recipes.length ? [{ key: 'recipe-share', kind: /** @type {const} */ ('recipe-share'), name: 'Everyone reads its recipes', mark: '' }] : [];
	return [...keep, ...code, ...share, ...types, ...published, ...games, ...settings, ...journal, ...inspire, ...docs, ...pads, ...recipeShare, ...recipes];
}

/**
 * Whether vault `vault` gives everyone a Public share of its code entries (or of those of types `of`, as its recipes,
 * `RECIPE_TYPES`), as world `world` shows its shares.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string[]} [of]
 */
export function codeShared(world, vault, of = CODE_TYPES) {
	const types = (/** @type {any} */ c) => [...(c.slice?.where?.type ?? [])].sort().join();
	return world.shares.some((c) => c.over === vault && c.who === EVERYONE && types(c) === [...of].sort().join());
}

/** The level avenMAIA, the seed's aven, holds on Maia City by default (Samuel 2026-10-18): it suggests, and a human
 *  of Maia City merges, or accepts its AIP; the agents that are its devices act with that. */
export const SUGGESTER = 'Suggester';

/** The group of the share by which the aven opens AIPs over its proposal lines, on the vault's AIPs alone, beside its
 *  Suggester's (avendb-device's `agent::AIP_AUTHOR`). */
export const AIP_AUTHOR = 'AIP author';

/**
 * Whether vault `vault` gives vault `aven` a share of group `group` (`SUGGESTER`, `AIP_AUTHOR`), standing.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} aven @param {string} group
 */
export const avenHolds = (world, vault, aven, group) =>
	world.shares.some((c) => c.over === vault && c.who === aven && (/** @type {any} */ (c).group === group || /** @type {any} */ (c).slice?.name === group));

/**
 * Whether vault `vault` gives vault `server` a share on the whole of it that keeps it there (Backup, or one that reads
 * or writes it), as world `world` shows its shares.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} server
 */
export const serverKeeps = (world, vault, server) =>
	world.shares.some((c) => c.over === vault && c.who === server && c.whole && ['backup', 'read', 'write', 'owner'].includes(c.level));

/**
 * Whether vault `vault` gives everyone a Public share of what it published (`PUBLISHED`).
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 */
export const publishedShared = (world, vault) =>
	world.shares.some((c) => c.over === vault && c.who === EVERYONE && /** @type {any} */ (c).slice?.where?.tag === PUBLISHED);

/**
 * Whether vault `vault` gives everyone a Public share of its inspire-me pieces (`INSPIRE`).
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 */
export const inspireShared = (world, vault) =>
	world.shares.some((c) => c.over === vault && c.who === EVERYONE && /** @type {any} */ (c).slice?.where?.tag === INSPIRE);

/**
 * The ops that bring each inspire-me source vault `vault` copied before it carried what its report card shows (its
 * author's portrait, `by.image`) up to date, and tag it `INSPIRE`, last, so everyone reads it: one source of a report
 * at a time, each an artifact that carries its report's `legacy:` tag and not `INSPIRE` yet.
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 * @returns {Promise<object[][]>}
 */
export async function touchingUp(world, vault) {
	const out = [];
	for (const e of world.entries.filter((e) => e.vault === vault && !e.deleted && e.type === 'artifact')) {
		const tags = e.tags ?? [];
		const mark = tags.find((t) => t.startsWith('legacy:inspire-'));
		if (!mark || tags.includes(INSPIRE)) continue;
		const read = REPORTS[`/inspire-me/${mark.slice('legacy:inspire-'.length)}/README.md`];
		const fm = read ? split(await read()).fm : {};
		const by = filled({ name: str(fm.author), url: str(fm.authorUrl), image: str(fm.authorImage), platform: 'youtube' });
		out.push([
			...(Object.keys(by).length > 1 ? [{ op: 'set', entry: e.entry, path: ['by'], value: by, as: vault }] : []),
			{ op: 'tag', entry: e.entry, add: [INSPIRE], as: vault }
		]);
	}
	return out;
}

/**
 * The ops that draft each inspire post and doc post an earlier seed of vault `vault` published (Samuel 2026-10-18:
 * every inspire-me piece unpublished, and the docs kept in avenDB alone): each post of type inspire the seed made (its
 * `legacy:inspire-me/…` tag), or of type doc, not drafted yet (`DRAFTED`), moved from published to draft, and its story
 * from published to writing, each one op.
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 * @returns {object[]}
 */
export function drafting(world, vault) {
	const mine = world.entries.filter((e) => e.vault === vault && !e.deleted);
	const out = [];
	for (const e of mine.filter((x) => x.type === 'post')) {
		const tags = e.tags ?? [];
		if (tags.includes(DRAFTED)) continue;
		const inspire = tags.includes(postTag('inspire')) && tags.some((t) => t.startsWith(legacyTag('inspire-me/')));
		if (!inspire && !tags.includes(postTag('doc'))) continue;
		const remove = tags.includes(PUBLISHED) ? [PUBLISHED] : [];
		out.push({ op: 'tag', entry: e.entry, add: [DRAFT, DRAFTED], remove, as: vault });
		const s = mine.find((x) => x.entry === e.record?.story?.entry && x.type === 'story');
		if (s?.tags?.includes(stageTag('story', 'published'))) {
			out.push({ op: 'tag', entry: s.entry, add: [stageTag('story', 'writing')], remove: [stageTag('story', 'published')], as: vault });
		}
	}
	return out;
}

/** The tag a deleted entry carries among its own tags: no feed reader takes it in (game/code/sources/avendb.js, game/games.js). */
export const GONE = 'avendb:deleted';

/**
 * The pieces among `all` vault `vault` holds no copy of yet: no entry of it carries the piece's tag (an entry's last
 * op makes it, so a piece cut short is written again whole).
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {Piece[]} all
 */
export function unseeded(world, vault, all) {
	const have = new Set(world.entries.filter((e) => e.vault === vault && !e.deleted).flatMap((e) => e.tags ?? []));
	const mine = world.entries.filter((e) => e.vault === vault && !e.deleted);
	const games = new Set(mine.filter((e) => e.type === GAME).flatMap((e) => e.tags ?? []));
	return all.filter((p) =>
		p.kind === 'keep' ? !serverKeeps(world, vault, p.server ?? '') :
		p.kind === 'aven-suggests' ? !avenHolds(world, vault, p.server ?? '', SUGGESTER) :
		p.kind === 'aven-aips' ? !avenHolds(world, vault, p.server ?? '', AIP_AUTHOR) :
		p.kind === 'share' ? !codeShared(world, vault) : p.kind === 'published' ? !publishedShared(world, vault) :
		p.kind === 'recipe-share' ? !codeShared(world, vault, RECIPE_TYPES) :
		p.kind === 'config-share' ? !codeShared(world, vault, CONFIG_TYPES) :
		p.kind === 'config-schema' ? !mine.some((e) => e.kind === 'schema' && e.title === CONFIG_SCHEMA) :
		p.kind === 'inspire-share' ? !inspireShared(world, vault) :
		p.kind === 'name-share' ? !nameShared(world, vault) :
		p.kind === 'game-schema' ? !mine.some((e) => e.kind === 'schema' && e.title === GAME_SCHEMA) :
		p.kind === 'post-type' ? !mine.some((e) => e.kind === 'schema' && e.title === postTypeTitle(p.name)) :
		p.kind === 'game' ? !games.has(p.mark) : !have.has(p.mark)
	);
}

/**
 * A journal day's article text, as the journal shows it: its subtitle and cover first, then its body.
 * @param {Record<string, any>} fm @param {string} body
 */
function journalText(fm, body) {
	const [subtitle, cover, alt] = [str(fm.subtitle), str(fm.cover), str(fm.coverAlt)];
	return [subtitle && `*${subtitle}*`, PICTURE.test(cover) && `![${alt}](${cover})`, body].filter(Boolean).join('\n\n');
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
	if (p.kind === 'config-share') return [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { type: CONFIG_TYPES }, as }];
	if (p.kind === 'code') {
		const { type, tags, value } = recordOf(/** @type {Record<string, any>} */ (ENTRIES)[p.key]);
		return [{ op: 'create', vault, type, tags, schema: type, value, as }];
	}
	if (p.kind === 'keep') return [{ op: 'share', over: vault, who: { vault: p.server }, level: 'Backup', as }];
	if (p.kind === 'aven-suggests') return [{ op: 'share', over: vault, who: { vault: p.server }, level: SUGGESTER, as }];
	if (p.kind === 'aven-aips') {
		const level = { name: AIP_AUTHOR, ops: [{ op: 'read' }, { op: 'create' }, { op: 'set', path: [] }] };
		return [{ op: 'share', over: vault, who: { vault: p.server }, level, what: { type: ['aip'] }, as }];
	}
	if (p.kind === 'share') return [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { type: CODE_TYPES }, as }];
	if (p.kind === 'recipe-share') return [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { type: RECIPE_TYPES }, as }];
	if (p.kind === 'recipe') return assetOps(p.name, vault, p.mark);
	if (p.kind === 'published') return [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { tag: PUBLISHED }, as }];
	if (p.kind === 'inspire-share') return [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { tag: INSPIRE }, as }];
	if (p.kind === 'name-share') return [nameShare(vault)];
	if (p.kind === 'game-schema') return [{ op: 'create', vault, type: 'schema', value: GAME_V1, as }];
	if (p.kind === 'game') {
		const g = GAMES.find((x) => x.id === p.name);
		if (!g) return [];
		const value = { kind: GAME, id: g.id, title: g.label, route: g.route, note: g.note ?? '' };
		const publish = RELEASED.has(g.id) ? [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { tag: p.mark }, as }] : [];
		return [...publish, { op: 'create', vault, type: GAME, tags: [GAME, p.mark], value, as }];
	}
	if (p.kind === 'post-type') {
		const read = TEMPLATES[POST_TYPES[p.name]?.template];
		return read ? [{ op: 'create', vault, type: 'schema', value: postTypeSchema(p.name, (await read()).trim()), as }] : [];
	}
	if (p.kind === 'pad') {
		const legacy = legacyPieces([]).find((x) => x.key === p.key);
		return legacy ? copying(legacy, vault, vault, { spark: [], artifact: [] }) : [];
	}
	if (p.kind === 'doc') {
		const d = DOCS.find((x) => x.key === p.name);
		if (!d) return [];
		const text = await d.read();
		const fm = /** @type {Record<string, any>} */ (d.section === 'skill' ? split(text).fm : {});
		const title = str(fm.name) || d.title;
		const excerpt = str(fm.description) || d.excerpt;
		const story = filled({ kind: 'story', title, text, series: 'Docs', description: excerpt, sparks: [], tags: [] });
		const own = { excerpt, language: 'en', section: d.section, slug: d.slug, page: d.page };
		const shown = d.section === 'skill' ? readable(text) : text;
		return [
			{ op: 'create', vault, type: 'story', tags: [stageTag('story', 'writing'), 'doc'], value: story, as },
			posting(vault, 'doc', title, shown, '$0', '', own, p.mark, [DRAFT, DRAFTED])
		];
	}
	if (p.kind === 'journal') {
		const { fm, body } = split(await POSTS[`/blog/${p.name}/post.md`]());
		const title = str(fm.title) || p.name;
		const day = Number(fm.day);
		const text = journalText(fm, body);
		const story = filled({
			kind: 'story',
			title,
			text,
			series: 'Journal',
			episode: Number.isInteger(day) && day >= 0 ? day : undefined,
			description: str(fm.excerpt),
			categories: names(fm.categories),
			launch: str(fm.date),
			sparks: [],
			tags: []
		});
		const words = { excerpt: str(fm.excerpt), language: 'en' };
		return [
			{ op: 'create', vault, type: 'story', tags: [stageTag('story', 'published'), 'journal'], value: story, as },
			posting(vault, 'journal', title, text, '$0', str(fm.date), words, p.mark)
		];
	}
	// an inspire-me report: its source an artifact on a spark, as ./legacy.js copies one, then its story and its post
	const legacy = legacyPieces([]).find((x) => x.kind === 'report' && x.name === p.name);
	const spark = legacy ? await copying(legacy, vault, vault, { spark: [], artifact: [INSPIRE] }) : [];
	const { fm, body } = split(await REPORTS[`/inspire-me/${p.name}/README.md`]());
	const title = str(fm.title) || p.name;
	const at = spark.length;
	const story = filled({
		kind: 'story',
		title,
		text: body,
		sparks: spark.length ? [`$${at - 1}`] : [],
		from: str(fm.shift?.from),
		to: str(fm.shift?.to),
		description: str(fm.hook),
		categories: names(fm.categories),
		launch: str(fm.added),
		tags: []
	});
	const quote = str(fm.quote) ? filled({ text: str(fm.quote), by: str(fm.quoteBy) || str(fm.author) }) : undefined;
	const words = { excerpt: str(fm.hook), language: str(fm.language) || 'en', quote };
	return [
		...spark,
		{ op: 'create', vault, type: 'story', tags: [stageTag('story', 'writing'), INSPIRE], value: story, as },
		posting(vault, 'inspire', title, body, `$${at}`, str(fm.added), words, p.mark, [DRAFT, DRAFTED])
	];
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
 * The ops that write asset `asset` of the asset box (`group/id`, `assetsOf`) into vault `vault`, acting for it, as one
 * `recipe` entry with its history: its first version's main recipe created with its file, in one write; each later
 * version a proposal (`propose`) whose one write is its record and its file (`put_file` with its `line` and `value`),
 * merged into main (`merge`), which every variant follows; each variant a line beside main (`variant`), started from
 * the main version it first appears in, whose own write after each version is its record and file. Each file's text
 * in `file.text`, which goes beside the op, never in it (`beside`). The entry carries the tags of every recipe it holds
 * (its group, each ref), all but `mark`, its newest version's, which its last op adds: a piece cut short is written
 * again whole (`unseeded`).
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
	tags.delete(mark);
	ops[0].tags = [...tags].sort();
	ops.push({ op: 'tag', entry: '$0', add: [mark], as });
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
 * The op that posts story `story` as a post of type `type` (./posttypes.js), titled `title` with text `text` and its
 * type's own fields `own`, on the Maia Universe stream, as the content flow's Publish function does (./flows.js), on
 * day `published`: with its stage's tags `stage` (public where published, the default), its type's tag, and the
 * piece's own tag `mark`, as its last op. The stream's feed reads a post's story as its `about`.
 * @param {string} vault @param {string} type @param {string} title @param {string} text @param {string} story
 * @param {string} published @param {Record<string, any>} own @param {string} mark @param {string[]} [stage]
 */
function posting(vault, type, title, text, story, published, own, mark, stage = [PUBLISHED]) {
	const value = filled({
		kind: postTag(type),
		title,
		text,
		story: { vault, entry: story },
		channel: POST_TYPES[type].channel,
		published,
		...filled(own),
		tags: []
	});
	return { op: 'create', vault, type: 'post', tags: [...stage, postTag(type), mark], value, as: vault };
}
