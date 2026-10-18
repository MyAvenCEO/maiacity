// A story's cards (./StoryThumbnail.svelte): each an entry of avenDB's own `artwork` schema (avendb's
// `lens::blobs::ARTWORK_V1`), one title card or thumbnail of one shape, in layers as the old board's thumbnail had
// them (src/lib/stories/Card.svelte draws them, card.js renders them): a picture, a cut-out laid over it, the words
// (empty: the hook it carries), a badge; each place a percent of the shape's canvas, a text's size a percent of its
// width. Its pictures are Library files by link; the card rendered from them is one too (`render`), tagged with its
// role and shape. An A/B card is a variant of another, carrying another of the story's hooks.

import { entryOf } from './artifacts.js';
import { kindOf } from './files.js';
import { pieces } from './sparks.js';

/** The type of a card's entry, and the kind of its record. */
export const ARTWORK = 'artwork';

/** Each shape a card can have: its key, its name, and its width and height. */
export const SHAPES = /** @type {const} */ ([
	['16x9', '16:9', [16, 9]],
	['9x16', '9:16', [9, 16]],
	['1x1', '1:1', [1, 1]],
	['4x5', '4:5', [4, 5]],
	['5x2', '5:2', [5, 2]]
]);
/** @typedef {(typeof SHAPES)[number][0]} Shape */

/** Where each shape goes out, as its chip says. */
export const SHAPE_USE = /** @type {Record<Shape, string>} */ ({
	'16x9': 'YouTube, the blog',
	'9x16': 'Shorts, Reels, TikTok, Stories',
	'1x1': 'Instagram, LinkedIn, X',
	'4x5': 'Instagram feed',
	'5x2': 'The site’s banner, newsletters'
});

/** The shapes a story of each format starts with. */
const FOR_FORMAT = /** @type {Record<string, Shape[]>} */ ({
	film: ['16x9', '9x16', '1x1'],
	reel: ['9x16', '1x1'],
	article: ['16x9', '1x1', '5x2'],
	post: ['1x1', '4x5'],
	thread: ['16x9', '1x1'],
	inspire: ['16x9', '1x1'],
	newsletter: ['5x2', '16x9'],
	podcast: ['1x1', '16x9']
});

/** The shapes a story of format `format` starts with. @param {string | undefined} format @returns {Shape[]} */
export const shapesFor = (format) => FOR_FORMAT[format ?? ''] ?? ['16x9', '9x16', '1x1'];

/** Shape `shape`'s name, and its width and height. @param {string} shape */
export function shapeOf(shape) {
	const s = SHAPES.find(([k]) => k === shape) ?? SHAPES[0];
	return { key: s[0], name: s[1], ratio: /** @type {[number, number]} */ ([...s[2]]) };
}

/** The pixels a card of shape `shape` renders at: 3240 along its long side, sharp in every crop. @param {string} shape */
export function pixelsOf(shape) {
	const [w, h] = shapeOf(shape).ratio;
	return w >= h ? { width: 3240, height: Math.round((3240 * h) / w) } : { width: Math.round((3240 * w) / h), height: 3240 };
}

/** A layer's kinds, each its name and what it is for. */
export const LAYER_KINDS = /** @type {const} */ ([
	['image', 'Picture', 'a picture from the Library, the background usually'],
	['cutout', 'Cut-out', 'a transparent picture laid over it: a face out of a frame'],
	['text', 'Text', 'the words, big (empty: the hook it carries)'],
	['badge', 'Badge', 'a small label: the day, a warning']
]);

/** Where each kind of layer starts on each shape, and how big. */
const PLACES = /** @type {Record<string, Record<Shape, object>>} */ ({
	image: {
		'16x9': { x: 0, y: 0, w: 100 },
		'9x16': { x: 0, y: 0, w: 100 },
		'1x1': { x: 0, y: 0, w: 100 },
		'4x5': { x: 0, y: 0, w: 100 },
		'5x2': { x: 0, y: 0, w: 100 }
	},
	cutout: {
		'16x9': { x: -2, y: 8, w: 46 },
		'9x16': { x: 10, y: 8, w: 80 },
		'1x1': { x: 4, y: 8, w: 60 },
		'4x5': { x: 8, y: 8, w: 74 },
		'5x2': { x: 0, y: 4, w: 34 }
	},
	text: {
		'16x9': { x: 48, y: 14, w: 48, size: 6.2 },
		'9x16': { x: 7, y: 56, w: 86, size: 11 },
		'1x1': { x: 7, y: 52, w: 86, size: 8.4 },
		'4x5': { x: 7, y: 56, w: 86, size: 9 },
		'5x2': { x: 52, y: 16, w: 44, size: 4.6 }
	},
	badge: {
		'16x9': { x: 82, y: 85, size: 2.6 },
		'9x16': { x: 7, y: 48, size: 5 },
		'1x1': { x: 72, y: 88, size: 3.6 },
		'4x5': { x: 72, y: 90, size: 3.8 },
		'5x2': { x: 86, y: 80, size: 2 }
	}
});

/**
 * A new layer of kind `kind` on a card of shape `shape`, with id `id`, where that kind starts there.
 * @param {string} kind @param {string} shape @param {number} id @param {object} [more]
 */
export function layerOf(kind, shape, id, more = {}) {
	const at = PLACES[kind]?.[/** @type {Shape} */ (shapeOf(shape).key)] ?? {};
	const looks =
		kind === 'image'
			? { fit: 'cover' }
			: kind === 'text'
				? { color: 'white', align: 'left' }
				: kind === 'badge'
					? { color: 'gold', text: 'DAY 1' }
					: {};
	return { id, kind, on: true, ...at, ...looks, ...more };
}

/** Whether Library file entry `f` is a picture a card can show. @param {any} f */
export const isPictureFile = (f) => f?.kind === 'file' && ['image', 'svg'].includes(kindOf(f.media ?? null, f.title ?? ''));

/**
 * The pictures story `story` grows from: those its sparks' artifacts show, in their order, as Library file entries.
 * @param {import('./vaults.js').WorldView} world @param {any} story
 */
export function storyPictures(world, story) {
	const byId = new Map(world.entries.map((e) => [e.entry, e]));
	const sparks = /** @type {any[]} */ (story?.record?.sparks ?? []).flatMap((s) => byId.get(entryOf(s)) ?? []);
	const files = sparks.flatMap((s) => pieces(world, s).artifacts.flatMap((a) => /** @type {any[]} */ (a.record?.files ?? [])));
	return [...new Set(files.map(entryOf))].flatMap((id) => byId.get(id) ?? []).filter(isPictureFile);
}

/**
 * The cards of story entry `story`, as this browser reads them, by shape in the shapes' order, each shape's first
 * card before its copies (A/B cards).
 * @param {import('./vaults.js').WorldView} world @param {string} story
 */
export function artworksOf(world, story) {
	const order = (/** @type {any} */ e) => SHAPES.findIndex(([k]) => k === e.record?.shape);
	return world.entries
		.filter((e) => e.type === ARTWORK && !e.deleted && entryOf(/** @type {any} */ (e.record)?.story) === story)
		.sort((a, b) => order(a) - order(b) || (a.forkOf ? 1 : 0) - (b.forkOf ? 1 : 0) || (a.created ?? 0) - (b.created ?? 0));
}

/**
 * The card a story starts with in shape `shape`: its picture (the first its sparks show, if any) and its words, which
 * read the hook it carries until someone writes others.
 * @param {any} story the story's entry @param {string} shape @param {any} [picture] a Library file's entry
 */
export function cardRecord(story, shape, picture) {
	const s = shapeOf(shape);
	const link = (/** @type {any} */ e) => ({ vault: e.vault, entry: e.entry });
	const layers = [
		layerOf('image', s.key, 1, { name: 'Picture', ...(picture ? { file: link(picture) } : {}) }),
		layerOf('text', s.key, 2, { name: 'Hook' })
	];
	return { kind: ARTWORK, title: `${story.title || 'Untitled'} · ${s.name}`, shape: s.key, story: link(story), layers, tags: [] };
}

/** The op that adds card `value` to vault `vault`, tagged `tags`. @param {string} vault @param {object} value
 *  @param {string[]} tags */
export const addingArtwork = (vault, value, tags) => ({ op: 'create', vault, type: ARTWORK, tags, value });

/** About how many letters a line of a card's words takes in each shape, before it breaks. */
const LINE = /** @type {Record<Shape, number>} */ ({ '16x9': 18, '9x16': 12, '1x1': 14, '4x5': 13, '5x2': 20 });

/**
 * Words `text` broken into lines a card of shape `shape` shows, at its words: an image title's lines as they are, a
 * hook's one line broken where it would run past the card (a card breaks its words only at a line's end).
 * @param {string} text @param {string} shape
 */
export function linesFor(text, shape) {
	if (text.includes('\n')) return text;
	const most = LINE[/** @type {Shape} */ (shapeOf(shape).key)];
	/** @type {string[]} */
	const lines = [];
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const last = lines.at(-1);
		if (last !== undefined && last.length + 1 + word.length <= most) lines[lines.length - 1] = `${last} ${word}`;
		else lines.push(word);
	}
	return lines.join('\n');
}

/**
 * What a card's empty words say: the hook it carries, by its image title where it has one, else its line; with none
 * named, the story's image title, else its chosen hook, else its working name; broken into the card's lines.
 * @param {any} story the story's record @param {any} card the card's record
 */
export function cardWords(story, card) {
	const hooks = /** @type {any[]} */ (story?.hooks ?? []);
	const carried = card?.hook !== undefined && card?.hook !== null ? hooks.find((h) => h.id === card.hook) : null;
	const words = carried
		? carried.image_title?.length
			? carried.image_title.join('\n')
			: (carried.text ?? '')
		: story?.image_title?.length
			? story.image_title.join('\n')
			: hooks.find((h) => h.id === story?.hook)?.text?.trim() || story?.title || '';
	return linesFor(words, card?.shape ?? '16x9');
}
