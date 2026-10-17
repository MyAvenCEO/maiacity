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
//   templates  each delivery type's writing guide, a note tagged `template:<type>` (article: blog/TEMPLATE.md,
//              inspire: inspire-me/FORMAT.md)
//   journal    each journal day (blog/day-NN-…/post.md): a story, its source of truth; its article, the story's
//              delivery as the journal writes it (`delivery:article`); and the post that publishes it on the Maia
//              Universe stream (channel Journal), on the day it was first published
//   inspire    each inspire-me report: its source an artifact on a spark (./legacy.js), the story grown from the spark,
//              the report as its delivery (`delivery:inspire`), and its post (channel Inspire me), on the day it was
//              added
//   published  one Public share of the vault's published entries (`content:published`), as the content flow's
//              published stage is public: the posts and their articles go on the stream
//   pads       the journal's sources and each story's idea pad, sparks as ./legacy.js copies them
//
// The story is the source of truth; an article, a script or an inspire piece is a delivery of it, an entry of its own
// that links it (`story`) and says which delivery it is by its tag. The notebook's ideas live on maia.city's server,
// not in the repository: ./LegacyCopy.svelte still copies those by hand.

import { parse as parseYaml } from 'yaml';
import { ENTRIES } from '../../../code/index.js';
import { recordOf } from '../../../game/code/sources/avendb.js';
import { ARTICLE, PICTURE } from './article.js';
import { stageTag } from './flows.js';
import { copying, legacyTag, pieces as legacyPieces } from './legacy.js';
import { EVERYONE } from './vaults.js';

/** The types of the code entries the vault holds, which everyone reads, as the repo's code/ is open to everyone. */
export const CODE_TYPES = ['view', 'logic'];

/** The tag that says which delivery of its story an entry is. @param {string} type */
export const deliveryTag = (type) => `delivery:${type}`;

/** The tag of the content flow's published stage, which everyone reads. */
export const PUBLISHED = stageTag('content', 'published');

/** The channel of the Maia Universe stream each delivery type's posts go out on. */
export const CHANNEL = /** @type {Record<string, string>} */ ({ article: 'Journal', inspire: 'Inspire me' });

/** The tag of a delivery type's template. @param {string} type */
export const templateTag = (type) => `template:${type}`;

const POSTS = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/blog/day-*/post.md', { query: '?raw', import: 'default' })
);
const REPORTS = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/inspire-me/*/README.md', { query: '?raw', import: 'default' })
);
const TEMPLATES = /** @type {Record<string, () => Promise<string>>} */ ({
	...import.meta.glob('/blog/TEMPLATE.md', { query: '?raw', import: 'default' }),
	...import.meta.glob('/inspire-me/FORMAT.md', { query: '?raw', import: 'default' })
});

/** Each delivery type's template, by the file that holds it. */
const TEMPLATE_OF = /** @type {Record<string, { type: string, title: string }>} */ ({
	'/blog/TEMPLATE.md': { type: 'article', title: 'Template: a journal article' },
	'/inspire-me/FORMAT.md': { type: 'inspire', title: 'Template: an inspire-me report' }
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
 * @typedef {{ key: string, kind: 'keep' | 'code' | 'share' | 'template' | 'journal' | 'inspire' | 'pad' | 'published',
 *   name: string, mark: string, server?: string }} Piece
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
	const templates = Object.keys(TEMPLATES)
		.sort()
		.map((p) => ({ key: `template-${TEMPLATE_OF[p].type}`, kind: /** @type {const} */ ('template'), name: p, mark: legacyTag(`template-${TEMPLATE_OF[p].type}`) }));
	const journal = Object.keys(POSTS)
		.sort()
		.map((p) => ({ key: `blog/${folderOf(p)}`, kind: /** @type {const} */ ('journal'), name: folderOf(p), mark: legacyTag(`blog/${folderOf(p)}`) }));
	const inspire = Object.keys(REPORTS)
		.sort()
		.map((p) => ({ key: `inspire-me/${folderOf(p)}`, kind: /** @type {const} */ ('inspire'), name: folderOf(p), mark: legacyTag(`inspire-me/${folderOf(p)}`) }));
	const pads = legacyPieces([])
		.filter((p) => p.kind === 'journal' || p.kind === 'pad')
		.map((p) => ({ key: p.key, kind: /** @type {const} */ ('pad'), name: p.name, mark: legacyTag(p.key) }));
	const published = [{ key: 'published-share', kind: /** @type {const} */ ('published'), name: 'Everyone reads what it published', mark: '' }];
	return [...keep, ...code, ...share, ...templates, ...published, ...journal, ...inspire, ...pads];
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
 * The pieces among `all` vault `vault` holds no copy of yet: no entry of it carries the piece's tag (an entry's last
 * op makes it, so a piece cut short is written again whole).
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {Piece[]} all
 */
export function unseeded(world, vault, all) {
	const have = new Set(world.entries.filter((e) => e.vault === vault && !e.deleted).flatMap((e) => e.tags ?? []));
	return all.filter((p) =>
		p.kind === 'keep' ? !serverKeeps(world, vault, p.server ?? '') :
		p.kind === 'share' ? !codeShared(world, vault) : p.kind === 'published' ? !publishedShared(world, vault) : !have.has(p.mark)
	);
}

/** The record of a note that holds Markdown `md`, titled `title`. @param {string} title @param {string} md */
const noteRecord = (title, md) => ({
	kind: 'document',
	title,
	blocks: [
		{ id: 1, type: 'heading', level: 1, text: title },
		{ id: 2, type: 'paragraph', text: md }
	]
});

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
	if (p.kind === 'template') {
		const { type, title } = TEMPLATE_OF[p.name];
		const md = (await TEMPLATES[p.name]()).trim();
		return [{ op: 'create', vault, type: 'note', tags: [templateTag(type), p.mark], value: noteRecord(title, md), as }];
	}
	if (p.kind === 'pad') {
		const legacy = legacyPieces([]).find((x) => x.key === p.key);
		return legacy ? copying(legacy, vault, vault, { spark: [], artifact: [] }) : [];
	}
	if (p.kind === 'journal') {
		const { fm, body } = split(await POSTS[`/blog/${p.name}/post.md`]());
		const title = str(fm.title) || p.name;
		const day = Number(fm.day);
		const story = filled({
			kind: 'story',
			title,
			format: 'article',
			series: 'Journal',
			episode: Number.isInteger(day) && day >= 0 ? day : undefined,
			description: str(fm.excerpt),
			categories: names(fm.categories),
			launch: str(fm.date),
			sparks: [],
			tags: []
		});
		const text = journalText(fm, body);
		const article = filled({
			kind: ARTICLE,
			title,
			text,
			story: { vault, entry: '$0' },
			excerpt: str(fm.excerpt),
			language: 'en',
			tags: []
		});
		return [
			{ op: 'create', vault, type: 'story', tags: [stageTag('story', 'published'), 'journal'], value: story, as },
			{ op: 'create', vault, type: ARTICLE, tags: [PUBLISHED, deliveryTag('article'), 'journal'], value: article, as },
			posting(vault, title, text, 'article', '$1', str(fm.date), p.mark)
		];
	}
	// an inspire-me report: its source an artifact on a spark, as ./legacy.js copies one, then its story and delivery
	const legacy = legacyPieces([]).find((x) => x.kind === 'report' && x.name === p.name);
	const spark = legacy ? await copying(legacy, vault, vault, { spark: [], artifact: [] }) : [];
	const { fm, body } = split(await REPORTS[`/inspire-me/${p.name}/README.md`]());
	const title = str(fm.title) || p.name;
	const at = spark.length;
	const story = filled({
		kind: 'story',
		title,
		format: 'inspire',
		sparks: spark.length ? [`$${at - 1}`] : [],
		from: str(fm.shift?.from),
		to: str(fm.shift?.to),
		description: str(fm.hook),
		categories: names(fm.categories),
		launch: str(fm.added),
		tags: []
	});
	const quote = str(fm.quote) ? filled({ text: str(fm.quote), by: str(fm.quoteBy) || str(fm.author) }) : undefined;
	const article = filled({
		kind: ARTICLE,
		title,
		text: body,
		story: { vault, entry: `$${at}` },
		excerpt: str(fm.hook),
		language: str(fm.language) || 'en',
		quote,
		tags: []
	});
	return [
		...spark,
		{ op: 'create', vault, type: 'story', tags: [stageTag('story', 'published'), 'inspire-me'], value: story, as },
		{ op: 'create', vault, type: ARTICLE, tags: [PUBLISHED, deliveryTag('inspire'), 'inspire-me'], value: article, as },
		posting(vault, title, body, 'inspire', `$${at + 1}`, str(fm.added), p.mark)
	];
}

/**
 * The op that posts a delivery of type `type`, article `about`, titled `title` with text `text`, on the Maia Universe
 * stream, as the content flow's Publish function does (./flows.js), on day `published`: public with its stage's tag,
 * and the piece's own tag `mark`, as its last op.
 * @param {string} vault @param {string} title @param {string} text @param {string} type @param {string} about
 * @param {string} published @param {string} mark
 */
function posting(vault, title, text, type, about, published, mark) {
	const value = filled({ kind: 'post', title, text, channel: CHANNEL[type], about, published, tags: [] });
	return { op: 'create', vault, type: 'post', tags: [PUBLISHED, deliveryTag(type), mark], value, as: vault };
}
