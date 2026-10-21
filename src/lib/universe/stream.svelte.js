// @ts-nocheck — plain JS, kept loose on purpose
// The stream held in memory and shared by the feed and the post pages: every post published in avenDB that everyone
// may read, its author the vault that published it. A page at a time, newest first (Samuel 2026-10-21: "a Maia universe
// doesn't need all posts at the same time"): the newest `PAGE` first (`loadFeed`), the next as its person scrolls
// (`loadMore`), each off the page's own avenDB device where one is open (avendb's `posts` op), else off avenDB's server
// (`FEED?limit=…&after=…`). The device brings the posts the server shows that it lacks, those alone, so the next look
// reads them off it. A post page that names a post the pages haven't reached reads the whole feed (`loadAll`).
import { ENTRIES, FEED, authorsOf, fromFeed } from './posts.js';
import { inspireOf } from './inspire.js';
import { ANSWER, bringEntries, deviceOf } from '../../../game/code/sources/device.js';

/** How many posts the stream takes in at a time: the newest first, then as many more each time its person scrolls. */
export const PAGE = 20;

export const stream = $state({
	posts: [],
	authors: {},
	// the other entries everyone may read that a post's layout draws on (an inspire post's story, delivery and source),
	// by entry id
	entries: new Map(),
	// avenDB's feed: 'idle', 'loading', 'done' or 'failed'
	feed: 'idle',
	// whether more posts come after the last one taken in, and whether they are being taken in now
	more: false,
	loadingMore: false,
	// where the posts shown came from: 'this device' or 'the server'
	from: ''
});

export const findPost = (doc) => stream.posts.find((p) => p.doc === doc);

export const authorOf = (p) => stream.authors[p.author];

export function like(p) {
	p.liked = !p.liked;
	p.likes += p.liked ? 1 : -1;
}

/** A post of the feed as the stream holds it, one liked here staying liked; `now` in seconds since 1970. */
function held(p, now, before) {
	const { key, voice } = authorsOf(p);
	stream.authors[key] ??= voice;
	const had = before.get(p.entry);
	// when its entry was made, as the pages are cut by it
	const post = { ...fromFeed(p, now), created: p.created ?? 0, ...(had && { liked: had.liked, likes: had.likes }) };
	// an inspire post shows its source's picture, as its report card did
	const inspire = inspireOf(post, stream.entries);
	if (inspire?.thumbnails.length) post.cover = { src: inspire.thumbnails.at(-1), alt: '' };
	if (inspire?.hook) post.text = inspire.hook;
	return post;
}

/**
 * Posts `posts` of the feed (newest first) in the stream: with `top`, the newest page, in place of every post the stream
 * held as new as its oldest (one taken off since leaves), the older ones it took in before kept; else the next page,
 * after those it holds. Then the whole stream newest first.
 */
function take(posts, { top }) {
	const now = Date.now() / 1000;
	const before = new Map(stream.posts.map((p) => [p.entry, p]));
	const fed = posts.map((p) => held(p, now, before));
	const ids = new Set(fed.map((p) => p.entry));
	const oldest = top && posts.length ? Math.min(...posts.map((p) => p.created ?? 0)) : -Infinity;
	const kept = stream.posts.filter((p) => !ids.has(p.entry) && !(top && p.created >= oldest));
	stream.posts = [...fed, ...kept].sort((a, b) => (a.ago ?? Infinity) - (b.ago ?? Infinity));
}

/** `p`, or null once `ms` passed. */
function within(p, ms) {
	let t;
	const late = new Promise((done) => (t = setTimeout(() => done(null), ms)));
	return Promise.race([p.catch(() => null), late]).finally(() => clearTimeout(t));
}

const json = { headers: { accept: 'application/json' } };

/** A page of posts off the page's own device: `{ posts, more }`, or null where none is open or it can't answer. */
async function devicePage(after) {
	const d = deviceOf();
	if (!d) return null;
	const got = await within(d.run({ op: 'posts', limit: PAGE, ...(after ? { after } : {}) }), ANSWER);
	return Array.isArray(got?.ok?.posts) ? got.ok : null;
}

/** A page of posts off avenDB's server: `{ posts, more }`; throws where it can't be reached. */
async function serverPage(after) {
	const r = await fetch(`${FEED}?limit=${PAGE}${after ? `&after=${after}` : ''}`, json);
	if (!r.ok) throw new Error(`avenDB's feed answers ${r.status}`);
	const page = await r.json();
	return { posts: Array.isArray(page.posts) ? page.posts : [], more: !!page.more };
}

/** The other public entries a post's layout draws on: a nicety, a post still shows without them. */
async function loadEntries() {
	const more = await fetch(ENTRIES, json).catch(() => null);
	const { entries } = more?.ok ? await more.json().catch(() => ({})) : {};
	if (Array.isArray(entries)) stream.entries = new Map(entries.map((e) => [e.entry, e]));
}

/**
 * A page of posts, newest first after post `after` (none: the newest): off the page's device, which needs no server,
 * where it holds any; else off avenDB's server, the device bringing the posts it shows that the device lacks.
 */
async function pageOf(after) {
	const local = await devicePage(after);
	if (local?.posts.length) return { ...local, from: 'this device' };
	const page = await serverPage(after);
	if (deviceOf()) void bringEntries(page.posts.map((p) => p.entry));
	return { ...page, from: 'the server' };
}

let loading = null;

// Takes in the newest page of the feed, once at a time. Where it can't be reached, the stream keeps what it has.
export function loadFeed() {
	loading ??= (async () => {
		if (stream.feed !== 'done') stream.feed = 'loading';
		try {
			const [page] = await Promise.all([pageOf(null), stream.entries.size ? null : loadEntries()]);
			take(page.posts, { top: true });
			// a stream scrolled further than the newest page keeps what it took in after it
			if (stream.posts.length <= page.posts.length) stream.more = page.more;
			stream.from = page.from;
			stream.feed = 'done';
		} catch (e) {
			console.warn('Maia Universe:', e);
			if (stream.feed !== 'done') stream.feed = 'failed';
		} finally {
			loading = null;
		}
	})();
	return loading;
}

let more = null;

// Takes in the next page, after the last post the stream holds, once at a time: as its person scrolls to the end.
export function loadMore() {
	if (!stream.more) return Promise.resolve();
	more ??= (async () => {
		stream.loadingMore = true;
		try {
			const last = stream.posts.at(-1)?.entry ?? null;
			let page = await pageOf(last);
			// a device that holds fewer than the server: the server's next ones
			if (!page.posts.length && page.from === 'this device') page = { ...(await serverPage(last)), from: 'the server' };
			take(page.posts, { top: false });
			stream.more = page.more;
		} catch (e) {
			console.warn('Maia Universe:', e);
		} finally {
			stream.loadingMore = false;
			more = null;
		}
	})();
	return more;
}

let all = null;

// Takes in the whole feed (the newest 200 the server keeps), once at a time: for a post page or an old address that
// names a post the pages haven't reached.
export function loadAll() {
	all ??= (async () => {
		if (stream.feed !== 'done') stream.feed = 'loading';
		try {
			const [r] = await Promise.all([fetch(FEED, json), stream.entries.size ? null : loadEntries()]);
			if (!r.ok) throw new Error(`avenDB's feed answers ${r.status}`);
			const { posts } = await r.json();
			take(Array.isArray(posts) ? posts : [], { top: true });
			stream.more = false;
			stream.from = 'the server';
			stream.feed = 'done';
		} catch (e) {
			console.warn('Maia Universe:', e);
			if (stream.feed !== 'done') stream.feed = 'failed';
		} finally {
			all = null;
		}
	})();
	return all;
}
