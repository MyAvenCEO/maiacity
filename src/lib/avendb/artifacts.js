// A vault's artifacts (./Artifacts.svelte): one source fact each, standing on its own, a record of avenDB's own
// `artifact` schema (avendb's `lens::blobs::ARTIFACT_V1`): a bookmarked link, a picture, a clip, a YouTube video with
// its chapters and words. It says what the thing is (`look`), where it is from (`url`, `site`), who made it where it
// isn't ours (`by`) and when (`taken`); it may show Library files (`files`, links to their entries). A Library file is
// only bytes; an artifact is what they are. Sparks place artifacts on their canvas (./sparks.js), stories grow from
// sparks, and every artifact a spark holds carries the tag `sparks`, once a story grows from one of those sparks also
// `stories`, and so do the Library files it shows (`retagging`).

import { kindOf } from './files.js';

/** The type of an artifact's entry, and the kind of its record. */
export const ARTIFACT = 'artifact';

/** The tags avenDB's pages keep on what a spark holds, and on what a story grows from. */
export const IN_SPARKS = 'sparks';
export const IN_STORIES = 'stories';

/** What an artifact can be, each its look, its name in the plural, and its icon. */
export const LOOKS = /** @type {const} */ ([
	['link', 'Links', 'link'],
	['image', 'Images', 'image'],
	['video', 'Videos', 'film'],
	['youtube', 'YouTube', 'play']
]);
/** @typedef {(typeof LOOKS)[number][0]} Look */

/** A look in the singular, as an artifact's card names it. */
export const LOOK_NAME = /** @type {Record<Look, string>} */ ({
	link: 'Link',
	image: 'Image',
	video: 'Video',
	youtube: 'YouTube'
});

/** Whether entry `e` is an artifact. @param {any} e */
export const isArtifact = (e) => e?.type === ARTIFACT;

/** What artifact `e` is. @param {any} e @returns {Look} */
export const lookOf = (e) => e?.record?.look ?? 'link';

/** A link to entry `entry` of vault `vault`, as a record holds one (avendb's `ops::Link`). @param {string} vault
 *  @param {string} entry */
export const linkTo = (vault, entry) => ({ vault, entry });

/** The entry a link names: a link's, or a plain entry id. @param {any} link @returns {string} */
export const entryOf = (link) => (typeof link === 'string' ? link : (link?.entry ?? ''));

/** The hosts whose links are a video or a podcast. */
const VIDEOS = /(^|\.)(vimeo\.com|twitch\.tv|spotify\.com|podcasts\.apple\.com|tiktok\.com)$/;
/** The hosts whose links are YouTube's. */
const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be)$/;
/** The platforms we know by their host: the name a link's `by` gives. */
const PLATFORMS = /** @type {Record<string, string>} */ ({
	'youtu.be': 'youtube',
	'youtube.com': 'youtube',
	'twitter.com': 'x',
	'x.com': 'x',
	'instagram.com': 'instagram',
	'threads.net': 'threads',
	'bsky.app': 'bluesky',
	'linkedin.com': 'linkedin',
	'facebook.com': 'facebook',
	'tiktok.com': 'tiktok',
	'reddit.com': 'reddit',
	'vimeo.com': 'vimeo'
});

/** A link's host without `www.` or `m.`. @param {URL} u */
const hostIn = (u) => u.hostname.replace(/^(www|m)\./, '');

/** The YouTube video a link is, by its id: `null` for any other link. @param {string} url */
export function youtubeId(url) {
	try {
		const u = new URL(url);
		const host = hostIn(u);
		if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
		if (!YOUTUBE.test(host)) return null;
		if (u.pathname === '/watch') return u.searchParams.get('v');
		const [, kind, id] = u.pathname.split('/');
		return ['shorts', 'embed', 'live', 'v'].includes(kind) && id ? id : null;
	} catch {
		return null;
	}
}

/** The longest title an artifact takes from its link, in letters. */
const TITLE = 80;

/**
 * The artifact a link is: a YouTube video, another video or podcast by its host, else a bookmark; titled by its host
 * and path (a YouTube video by its id) until someone names it, on the site its host is, by the platform we know it as.
 * @param {URL} u
 */
export function fromLink(u) {
	const site = hostIn(u);
	const video = youtubeId(u.href);
	const look = video ? 'youtube' : VIDEOS.test(site) ? 'video' : 'link';
	const path = u.pathname.replace(/\/$/, '');
	const platform = PLATFORMS[site] ?? '';
	return {
		kind: ARTIFACT,
		look,
		title: video ? `YouTube · ${video}` : `${site}${path.length > 1 ? path : ''}`.slice(0, TITLE),
		url: u.href,
		site,
		...(platform ? { by: { platform } } : {})
	};
}

/**
 * The artifact a Library file is: a picture an image, a film or a sound a video, anything else a link to it alone;
 * titled `title`, its file linked.
 * @param {string} vault the file's vault @param {string} file its entry @param {string} media @param {string} name
 * @param {string} [title]
 */
export function fromFile(vault, file, media, name, title) {
	const k = kindOf(media, name);
	const look = k === 'image' || k === 'svg' ? 'image' : k === 'film' || k === 'audio' ? 'video' : 'link';
	return { kind: ARTIFACT, look, title: title || name, files: [linkTo(vault, file)] };
}

/** The op that adds artifact `value` to vault `vault`, tagged `tags`. @param {string} vault @param {object} value
 *  @param {string[]} tags */
export const addingArtifact = (vault, value, tags) => ({ op: 'create', vault, type: ARTIFACT, tags, value });

/** Seconds as a clock reads them: `9:05`, `1:02:03`. @param {number} s */
export function clock(s) {
	const t = Math.max(0, Math.floor(s));
	const [h, m, x] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
	const two = (/** @type {number} */ n) => String(n).padStart(2, '0');
	return h ? `${h}:${two(m)}:${two(x)}` : `${m}:${two(x)}`;
}

/** Where an artifact is from, in a line: whose it is, its platform, its site. @param {any} record */
export function fromWords(record) {
	const by = record?.by ?? {};
	return [by.name, by.platform && by.platform !== record?.site?.split('.')[0] ? by.platform : '', record?.site]
		.filter(Boolean)
		.join(' · ');
}

/**
 * What each spark and story of the world holds, as the auto tags read it: for each artifact entry, the sparks whose
 * canvas holds it, and whether a story grows from one of them, through sparks a spark holds too.
 * @param {import('./vaults.js').WorldView} world
 * @returns {Map<string, { sparks: Set<string>, story: boolean }>}
 */
export function holders(world) {
	const live = world.entries.filter((e) => !e.deleted);
	const sparks = live.filter((e) => e.type === 'spark' && e.kind === 'note');
	/** each spark's items, by its entry */
	const items = new Map(sparks.map((s) => [s.entry, /** @type {any[]} */ (/** @type {any} */ (s.record)?.items ?? [])]));
	/** the sparks a story grows from, and every spark they hold, in turn */
	const inStory = new Set();
	const stack = live.filter((e) => e.type === 'story').flatMap((e) => /** @type {any} */ (e.record)?.sparks ?? []);
	while (stack.length) {
		const s = entryOf(stack.pop());
		if (inStory.has(s)) continue;
		inStory.add(s);
		for (const it of items.get(s) ?? []) if (it.what === 'spark') stack.push(it.ref);
	}
	/** @type {Map<string, { sparks: Set<string>, story: boolean }>} */
	const out = new Map();
	for (const [spark, its] of items) {
		for (const it of its) {
			if (it.what !== 'artifact') continue;
			const a = entryOf(it.ref);
			const h = out.get(a) ?? { sparks: new Set(), story: false };
			h.sparks.add(spark);
			h.story ||= inStory.has(spark);
			out.set(a, h);
		}
	}
	return out;
}

/**
 * The tag ops that bring the auto tags of vault `vault`'s artifacts and Library files up to what the world's sparks
 * and stories hold: `sparks` on each artifact a spark holds and each file such an artifact shows, `stories` on those a
 * story grows from, and either taken off where nothing holds it any more. Only entries the acting vault writes, each
 * op for it to make (`as`).
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} actor
 */
export function retagging(world, vault, actor) {
	const held = holders(world);
	/** @type {Map<string, Set<string>>} the auto tags each entry should carry */
	const want = new Map();
	const add = (/** @type {string} */ e, /** @type {string} */ t) => want.set(e, (want.get(e) ?? new Set()).add(t));
	const artifacts = world.entries.filter((e) => isArtifact(e) && !e.deleted);
	for (const a of artifacts) {
		const h = held.get(a.entry);
		if (!h) continue;
		const tags = [IN_SPARKS, ...(h.story ? [IN_STORIES] : [])];
		for (const t of tags) {
			add(a.entry, t);
			for (const f of /** @type {any} */ (a.record)?.files ?? []) add(entryOf(f), t);
		}
	}
	const ops = [];
	for (const e of world.entries) {
		if (e.vault !== vault || e.deleted || !e.writers.includes(actor)) continue;
		if (!isArtifact(e) && e.kind !== 'file') continue;
		const has = new Set(e.tags ?? []);
		const should = want.get(e.entry) ?? new Set();
		const plus = [...should].filter((t) => !has.has(t));
		const minus = [IN_SPARKS, IN_STORIES].filter((t) => has.has(t) && !should.has(t));
		if (plus.length || minus.length) ops.push({ op: 'tag', entry: e.entry, add: plus, remove: minus });
	}
	return ops;
}

/**
 * The sparks whose canvas holds artifact `entry`, of those this browser reads.
 * @param {import('./vaults.js').WorldView} world @param {string} entry
 */
export const sparksHolding = (world, entry) =>
	world.entries.filter(
		(e) =>
			e.type === 'spark' &&
			!e.deleted &&
			/** @type {any[]} */ (/** @type {any} */ (e.record)?.items ?? []).some((it) => it.what === 'artifact' && entryOf(it.ref) === entry)
	);
