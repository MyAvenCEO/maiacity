// The repo seed of the Maia City vault (Samuel 2026-10-17: everything trustless lives in the Maia City COOP vault, and
// after a reset of avenDB it all comes back from the repository): what the repository holds, written into the vault
// once, by whichever of the person's devices comes first (./Account.svelte, as it writes avenCEO GmbH's schemas). Each
// piece carries a tag that names what it was made from (`legacy:…`, or a code entry's `ref:…`), so a piece the vault
// holds already is left out, and seeding again writes only what is new. The repository stays as it is: it is the seed
// pages read offline, and what a reset brings back.
//
//   keep       a Backup share to avenCEO server's vault, where the vault gives it none yet: the server serves only what
//              it keeps, so without it the feeds have nothing of the vault's to show
//   code       each view and logic module of code/ (game/code/sources/avendb.js `recordOf`), found by its `ref:` tag,
//              and one Public share of the vault's views and logic, so the server's code feed serves them
//   post types each post type, a schema of the vault's own with its template inside (./posttypes.js): journal
//              (blog/TEMPLATE.md) and inspire (inspire-me/FORMAT.md)
//   journal    each journal day (blog/day-NN-…/post.md): a story, its source of truth, with its full text; and its
//              journal post (`post:journal`) on the Maia Universe stream, on the day it was first published
//   inspire    each inspire-me report: its source an artifact on a spark (./legacy.js), the story grown from the spark,
//              with the report's text, and its inspire post (`post:inspire`), on the day it was added
//   inspire    (after the published share) one Public share of every inspire-me piece (`INSPIRE`), so the Universe lays
//              an inspire post out as its report card; ./Account.svelte then brings each copied source up to date
//              (`touchingUp`): its author's portrait, and the tag
//   published  one Public share of the vault's published entries (`content:published`), as the content flow's
//              published stage is public: the posts and their stories go on the stream
//   pads       the journal's sources and each story's idea pad, sparks as ./legacy.js copies them
//   games      the Games area (game/games.js): the vault's own schema "Game, v1", then each game's entry, of type `game`,
//              tagged `game` and `game:<id>`; a game the repo released (places.ts, no `release: 'draft'`) also gets
//              the Public share on its tag that publishes it, written with its entry, once: a game its owner withdrew
//              later is never published again by a seed
//   retire     every entry of a game the repo let go (`RETIRED`: Sandboxes 7 and 8), deleted
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
import { EVERYONE } from './vaults.js';
import { POST_TYPES, postTag, postTypeSchema, postTypeTitle } from './posttypes.js';
import { GAME, GAMES, gameTag } from '../../../game/games.js';

/** The types of the code entries the vault holds, which everyone reads, as the repo's code/ is open to everyone. */
export const CODE_TYPES = ['view', 'logic'];

/** The tag of the content flow's published stage, which everyone reads. */
export const PUBLISHED = stageTag('content', 'published');

/** The tag every inspire-me piece carries, its story, post, spark and source, which everyone reads: the
 *  Universe lays an inspire post out as its report card from them all. */
export const INSPIRE = 'inspire-me';

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

/** The games the repository released, by id: those every founder plays today (places.ts), published at the seed. */
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
	...import.meta.glob('/inspire-me/FORMAT.md', { query: '?raw', import: 'default' })
});

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
 * @typedef {{ key: string, kind: 'keep' | 'code' | 'share' | 'post-type' | 'journal' | 'inspire' | 'pad' | 'published' |
 *   'inspire-share' | 'game-schema' | 'game', name: string, mark: string, server?: string }} Piece
 */

/**
 * Every piece of the repo seed, each with the tag its copy carries (`mark`); with `server`, the id of avenCEO server's
 * vault, first the Backup share that makes it keep the vault.
 * @param {string | null} [server] @returns {Piece[]}
 */
export function seedPieces(server = null) {
	const keep = server ? [{ key: 'server-keep', kind: /** @type {const} */ ('keep'), name: 'The server keeps it', mark: '', server }] : [];
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
	const pads = legacyPieces([])
		.filter((p) => p.kind === 'journal' || p.kind === 'pad')
		.map((p) => ({ key: p.key, kind: /** @type {const} */ ('pad'), name: p.name, mark: legacyTag(p.key) }));
	const published = [
		{ key: 'published-share', kind: /** @type {const} */ ('published'), name: 'Everyone reads what it published', mark: '' },
		{ key: 'inspire-share', kind: /** @type {const} */ ('inspire-share'), name: 'Everyone reads its inspire-me pieces', mark: '' }
	];
	const games = [
		{ key: 'game-schema', kind: /** @type {const} */ ('game-schema'), name: GAME_SCHEMA, mark: '' },
		...GAMES.map((g) => ({ key: `game/${g.id}`, kind: /** @type {const} */ ('game'), name: g.id, mark: gameTag(g.id) }))
	];
	return [...keep, ...code, ...share, ...types, ...published, ...games, ...journal, ...inspire, ...pads];
}

/**
 * Whether vault `vault` gives everyone a Public share of its code entries, as world `world` shows its shares.
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 */
export function codeShared(world, vault) {
	const types = (/** @type {any} */ c) => [...(c.slice?.where?.type ?? [])].sort().join();
	return world.shares.some((c) => c.over === vault && c.who === EVERYONE && types(c) === [...CODE_TYPES].sort().join());
}

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

/** The tags of what the vault let go (Samuel 2026-10-17: Sandboxes 7 and 8 deleted, with their proposals, worlds and
 * code): every entry carrying one is deleted (`retiring`). A tag ending in `/` names every tag it starts. */
export const RETIRED = ['game:sandbox-7', 'game:sandbox-8', 'ref:logic/sandbox-7/', 'ref:views/view-wants'];

/** The tag a deleted entry carries among its own tags: no feed reader takes it in (game/code/sources/avendb.js, game/games.js). */
export const GONE = 'avendb:deleted';

/**
 * The ops that delete what vault `vault` still holds of a game the repo let go (`RETIRED`): its game entry, its AIPs,
 * its code, each tagged `GONE`. Its edits stay in the vault's history, as every edit does.
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 */
export function retiring(world, vault) {
	const gone = (/** @type {string} */ t) => RETIRED.some((r) => (r.endsWith('/') ? t.startsWith(r) : t === r));
	return world.entries
		.filter((e) => e.vault === vault && !e.deleted && !(e.tags ?? []).includes(GONE) && (e.tags ?? []).some(gone))
		.map((e) => ({ op: 'tag', entry: e.entry, add: [GONE], as: vault }));
}

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
		p.kind === 'share' ? !codeShared(world, vault) : p.kind === 'published' ? !publishedShared(world, vault) :
		p.kind === 'inspire-share' ? !inspireShared(world, vault) :
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
	if (p.kind === 'code') {
		const { type, tags, value } = recordOf(/** @type {Record<string, any>} */ (ENTRIES)[p.key]);
		return [{ op: 'create', vault, type, tags, schema: type, value, as }];
	}
	if (p.kind === 'keep') return [{ op: 'share', over: vault, who: { vault: p.server }, level: 'Backup', as }];
	if (p.kind === 'share') return [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { type: CODE_TYPES }, as }];
	if (p.kind === 'published') return [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { tag: PUBLISHED }, as }];
	if (p.kind === 'inspire-share') return [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { tag: INSPIRE }, as }];
	if (p.kind === 'game-schema') return [{ op: 'create', vault, type: 'schema', value: GAME_V1, as }];
	if (p.kind === 'game') {
		const g = GAMES.find((x) => x.id === p.name);
		if (!g) return [];
		const value = { kind: GAME, id: g.id, title: g.label, route: g.route, note: '' };
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
		{ op: 'create', vault, type: 'story', tags: [stageTag('story', 'published'), INSPIRE], value: story, as },
		posting(vault, 'inspire', title, body, `$${at}`, str(fm.added), words, p.mark)
	];
}

/**
 * The op that posts story `story` as a post of type `type` (./posttypes.js), titled `title` with text `text` and its
 * type's own fields `own`, on the Maia Universe stream, as the content flow's Publish function does (./flows.js), on
 * day `published`: public with its stage's tag, its type's tag, and the piece's own tag `mark`, as its last op. The
 * stream's feed reads a post's story as its `about`.
 * @param {string} vault @param {string} type @param {string} title @param {string} text @param {string} story
 * @param {string} published @param {Record<string, any>} own @param {string} mark
 */
function posting(vault, type, title, text, story, published, own, mark) {
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
	return { op: 'create', vault, type: 'post', tags: [PUBLISHED, postTag(type), mark], value, as: vault };
}
