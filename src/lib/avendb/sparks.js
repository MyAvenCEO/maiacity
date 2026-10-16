// A vault's sparks (./Sparks.svelte): the scratchpads where sources are combined into what might become a story, one
// small entry each, a record of avenDB's own `spark` schema (avendb's `lens::blobs::SPARK_V2`): an open canvas
// (./SparkCanvas.svelte) of artifacts (./artifacts.js), text notes and other sparks, each where it was put (`items`),
// with its title and its own words (`blocks`, a document's, so a note's page edits them). A spark of v1, written
// before the canvas, opens through the lens avenDB ships, its title and words kept. The notes written before sparks
// stay entries of type note, documents, and show among the sparks as notes: nothing is moved.

import { entryOf, isArtifact, linkTo } from './artifacts.js';
import { flowsFor, STORY, stageTag } from './flows.js';
import { kindOf, whole } from './files.js';

/** The type of a spark's entry, and the kind of its record. */
export const SPARK = 'spark';

/** Whether entry `e` shows among the sparks: a spark, or a note written before them. @param {any} e */
export const isSpark = (e) => (e.type === SPARK || e.type === 'note') && e.kind === 'note';

/** Whether spark `e` is a note written before sparks. @param {any} e */
export const isOldNote = (e) => e.type !== SPARK;

/** What sits on a spark's canvas, its items. @param {any} e @returns {any[]} */
export const itemsOf = (e) => e?.record?.items ?? [];

/** The type a piece dragged onto a canvas carries (./SparkShelf.svelte): its vault, entry and what it is, as JSON. */
export const PIECE = 'application/x-avendb-piece';

/** The size a new item takes on a canvas, and the room between items. */
export const CARD = { w: 220, h: 170, gap: 24, pad: 32 };

/** A new id for a row of `rows`, picked at random as avenDB asks, one no row has. @param {{ id: number }[]} rows */
export function newId(rows) {
	const taken = new Set(rows.map((r) => r.id));
	let id = 0;
	while (!id || taken.has(id)) id = 1 + Math.floor(Math.random() * 2 ** 30);
	return id;
}

/**
 * Where `n` new items go on a canvas that holds `items`: in a row under the lowest one, else from the top left; or
 * from point `at`, side by side, where they were dropped.
 * @param {any[]} items @param {number} n @param {{ x: number, y: number }} [at]
 * @returns {{ x: number, y: number }[]}
 */
export function placing(items, n, at) {
	const across = 4;
	const top = at ?? { x: CARD.pad, y: items.length ? Math.max(...items.map((i) => (i.y ?? 0) + (i.h ?? CARD.h))) + CARD.gap : CARD.pad };
	return Array.from({ length: n }, (_, i) => ({
		x: Math.round(top.x + (i % across) * (CARD.w + CARD.gap)),
		y: Math.round(top.y + Math.floor(i / across) * (CARD.h + CARD.gap))
	}));
}

/**
 * The rows that put the entries `refs` (each `{ vault, entry, what }`) on a canvas that holds `items`, placed as
 * `placing` places them, each with an id of its own.
 * @param {any[]} items @param {{ vault: string, entry: string, what: 'artifact' | 'spark' }[]} refs
 * @param {{ x: number, y: number }} [at]
 */
export function itemsFor(items, refs, at) {
	const at_ = placing(items, refs.length, at);
	/** @type {any[]} */
	const made = [];
	refs.forEach((r, i) => made.push({ id: newId([...items, ...made]), what: r.what, ref: linkTo(r.vault, r.entry), ...at_[i] }));
	return made;
}

/** A text note on a canvas that holds `items`, at `at` or under the rest. @param {any[]} items @param {string} text
 *  @param {{ x: number, y: number }} [at] */
export const textItem = (items, text, at) => ({ id: newId(items), what: 'text', text, ...placing(items, 1, at)[0] });

/** Line `line` as a link, where it is one, alone on its line: its URL, else `null`. @param {string} line */
export function linkIn(line) {
	const t = line.trim();
	if (!/^https?:\/\/\S+$/i.test(t)) return null;
	try {
		return new URL(t);
	} catch {
		return null;
	}
}

/** A link's host without `www.`, and its path where it has one, as a card names it. @param {string} url */
export function hostOf(url) {
	try {
		const u = new URL(url);
		return u.hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/**
 * A spark as this app writes one, of avenDB's spark schema: titled `title`, its opening heading (block 1) the title
 * too and, where it has `text`, a paragraph (block 2) that reads it, as a note's page writes a note; on its canvas the
 * items `items`.
 * @param {string} title @param {string} text @param {any[]} [items]
 */
export const sparkRecord = (title, text, items = []) => ({
	kind: SPARK,
	title,
	blocks: [
		{ id: 1, type: 'heading', level: 1, text: title },
		...(text ? [{ id: 2, type: 'paragraph', text }] : [])
	],
	items
});

/** The longest title a spark of one line takes from it, in letters. */
const TITLE = 80;

/** A line cut to a title, at a word. @param {string} t */
export const titleOf = (t) => (t.length <= TITLE ? t : `${t.slice(0, TITLE).replace(/\s+\S*$/, '')}…`);

/**
 * The spark one line of thought captures: its title the line, cut at a word, and where it is longer, the whole line
 * as a text note on its canvas.
 * @param {string} line
 */
export function fromLine(line) {
	const t = line.trim();
	const title = titleOf(t);
	return sparkRecord(title, '', title === t ? [] : [textItem([], t)]);
}

/** Whether a Library file is a picture, by its media type and name. @param {string} media @param {string} name */
const isPicture = (media, name) => ['image', 'svg'].includes(kindOf(media, name));

/** The op that adds spark `value` to vault `vault`, tagged `tags`. @param {string} vault @param {object} value
 *  @param {string[]} tags */
export const addingSpark = (vault, value, tags) => ({ op: 'create', vault, type: SPARK, tags, value });

/**
 * The op that starts story `title` in vault `vault`, grown from sparks `sparks`: an idea of the vault's story flow,
 * tagged as its cap asks (`asked`), as the Stories page starts one.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} title @param {string[]} sparks
 * @param {string[]} asked
 */
export function addingStory(world, vault, title, sparks, asked) {
	const flow = flowsFor(world, vault, 'story')[0] ?? STORY;
	const tags = [...asked, stageTag(flow.key, flow.stages[0].key)];
	return { op: 'create', vault, type: 'story', tags, value: { kind: 'story', title, sparks, tags: [] } };
}

/**
 * The stories that grow from spark `entry` and the sparks that hold it on their canvas, of those this browser reads.
 * @param {import('./vaults.js').WorldView} world @param {string} entry
 */
export const grownFrom = (world, entry) =>
	world.entries.filter(
		(e) =>
			!e.deleted &&
			(/** @type {any} */ (e.record)?.sparks?.includes?.(entry) ||
				(e.type === SPARK && itemsOf(e).some((it) => it.what === 'spark' && entryOf(it.ref) === entry)))
	);

/**
 * What a spark holds, by entry, of those this browser reads: the artifacts on its canvas, its text notes and the
 * sparks on it.
 * @param {import('./vaults.js').WorldView} world @param {any} e
 */
export function pieces(world, e) {
	const byId = new Map(world.entries.map((x) => [x.entry, x]));
	const items = itemsOf(e);
	const artifacts = items.filter((it) => it.what === 'artifact').flatMap((it) => byId.get(entryOf(it.ref)) ?? []);
	const sparks = items.filter((it) => it.what === 'spark').flatMap((it) => byId.get(entryOf(it.ref)) ?? []);
	return { artifacts: artifacts.filter(isArtifact), sparks, notes: items.filter((it) => it.what === 'text') };
}

/** Whose a spark is, in a line: its name, its platform, where they are. @param {any} by */
export function byWords(by) {
	if (!by) return '';
	const where = by.url ? hostOf(by.url) : '';
	return [by.name, by.platform, where !== by.platform ? where : ''].filter(Boolean).join(' · ');
}

/** The most of a picture a spark's card reads whole to show it. */
const PICTURE = 16 << 20;
/** each picture read, as a blob URL, by its file's root: kept while the page is open, as a browser's image cache */
const pictures = new Map();

/**
 * The picture Library file `file` holds, as a blob URL to show, read whole once (./files.js `whole`): `null` where
 * it is no picture, isn't opened here, or is larger than a card reads.
 * @param {{ readFile: import('./files.js').Read }} api @param {any} file the file's entry, as the world shows it
 * @returns {Promise<string | null>}
 */
export function pictureOf(api, file) {
	const f = file?.files?.[0];
	const media = file?.media ?? '';
	if (!f || f.len === null || f.len > PICTURE || !isPicture(media, file.title ?? '')) return Promise.resolve(null);
	if (!pictures.has(f.root)) {
		const read = (/** @type {string} */ root, /** @type {number} */ size, /** @type {number} */ from, /** @type {number} */ to) =>
			api.readFile(root, size, from, to);
		const got = whole(read, f, media).then(
			(blob) => URL.createObjectURL(blob),
			() => (pictures.delete(f.root), null)
		);
		pictures.set(f.root, got);
	}
	return pictures.get(f.root);
}
