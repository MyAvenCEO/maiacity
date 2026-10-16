// A vault's sparks (./Sparks.svelte): anything that might become something, one small entry each, a record of
// avenDB's own `spark` schema (avendb's `lens::blobs::SPARK_V1`): a thought, a link, a picture, a mood board, someone
// else's post, a video or a podcast with its words, a quote, a longer note. Its title and blocks are a document's, so a
// note's page edits it; beside them what it is (`look`), its link (`url`), whose it is (`by`), its words (`transcript`),
// its Library files (`files`) and, for a mood board, the sparks it gathers (`sparks`). The notes written before sparks
// stay entries of type note, documents, and show among the sparks as notes: nothing is moved.

import { flowsFor, STORY, stageTag } from './flows.js';
import { kindOf, whole } from './files.js';

/** The type of a spark's entry, and the kind of its record. */
export const SPARK = 'spark';

/** What a spark can be, each its look, its name in the plural, and its icon. */
export const LOOKS = /** @type {const} */ ([
	['thought', 'Thoughts', 'thought'],
	['link', 'Links', 'link'],
	['image', 'Images', 'image'],
	['moodboard', 'Mood boards', 'board'],
	['post', 'Posts', 'post'],
	['video', 'Videos', 'film'],
	['quote', 'Quotes', 'quote'],
	['note', 'Notes', 'note']
]);
/** @typedef {(typeof LOOKS)[number][0]} Look */

/** A look in the singular, as a spark's card names it. */
export const LOOK_NAME = /** @type {Record<Look, string>} */ ({
	thought: 'Thought',
	link: 'Link',
	image: 'Image',
	moodboard: 'Mood board',
	post: 'Post',
	video: 'Video',
	quote: 'Quote',
	note: 'Note'
});

/** Whether entry `e` shows among the sparks: a spark, or a note written before them. @param {any} e */
export const isSpark = (e) => (e.type === SPARK || e.type === 'note') && e.kind === 'note';

/** What spark `e` is: its look, a note written before sparks a note. @param {any} e @returns {Look} */
export const lookOf = (e) => (e.type === SPARK ? (e.record?.look ?? 'thought') : 'note');

/** The hosts whose links are someone's post, and those whose links are a video or a podcast. */
const POSTS = /(^|\.)(x\.com|twitter\.com|instagram\.com|threads\.net|bsky\.app|linkedin\.com|facebook\.com|tiktok\.com|reddit\.com|mastodon\.social)$/;
const VIDEOS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|spotify\.com|podcasts\.apple\.com)$/;

/** The platform a link is on, by its host, where it is one we know: `youtube`, `x`, … @param {URL} u */
function platformOf(u) {
	const host = u.hostname.replace(/^www\./, '');
	if (host === 'youtu.be') return 'youtube';
	if (host === 'twitter.com') return 'x';
	return POSTS.test(host) || VIDEOS.test(host) ? host.split('.').slice(-2)[0] : '';
}

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
 * too and, where it has `text`, a paragraph (block 2) that reads it, as a note's page writes a note; the fields `more`
 * gives beside.
 * @param {string} title @param {string} text @param {Record<string, unknown>} [more]
 */
export const sparkRecord = (title, text, more = {}) => ({
	kind: SPARK,
	title,
	blocks: [
		{ id: 1, type: 'heading', level: 1, text: title },
		...(text ? [{ id: 2, type: 'paragraph', text }] : [])
	],
	...more
});

/** The longest title a spark of one line takes from it, in letters. */
const TITLE = 80;

/**
 * The spark one line captures: a link alone on its line a link (someone's post, a video, by its host), its title the
 * link's host and path; anything else a thought, its title the line, cut at a word, its text the whole line.
 * @param {string} line
 */
export function fromLine(line) {
	const t = line.trim();
	const u = linkIn(t);
	if (u) {
		const host = u.hostname.replace(/^www\./, '');
		const look = POSTS.test(host) ? 'post' : VIDEOS.test(host) ? 'video' : 'link';
		const platform = platformOf(u);
		const path = u.pathname.replace(/\/$/, '');
		const by = platform ? { by: { platform } } : {};
		return sparkRecord(`${host}${path.length > 1 ? path : ''}`.slice(0, TITLE), '', { look, url: u.href, ...by });
	}
	const title = t.length <= TITLE ? t : `${t.slice(0, TITLE).replace(/\s+\S*$/, '')}…`;
	return sparkRecord(title, title === t ? '' : t, { look: 'thought' });
}

/**
 * The look of a spark of one file, by its kind: a picture an image, a film or a sound a video, anything else a note.
 * @param {string} media @param {string} name @returns {Look}
 */
export function lookOfFile(media, name) {
	const k = kindOf(media, name);
	return k === 'image' || k === 'svg' ? 'image' : k === 'film' || k === 'audio' ? 'video' : 'note';
}

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
 * The stories and mood boards that grow from spark `entry`, of those this browser reads: each entry that names it
 * among its sparks.
 * @param {import('./vaults.js').WorldView} world @param {string} entry
 */
export const grownFrom = (world, entry) =>
	world.entries.filter((e) => !e.deleted && /** @type {any} */ (e.record)?.sparks?.includes?.(entry));

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
	if (!f || f.len === null || f.len > PICTURE || lookOfFile(media, file.title ?? '') !== 'image') return Promise.resolve(null);
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
