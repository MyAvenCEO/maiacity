// @ts-nocheck — plain JS, kept loose on purpose
import { localDevice } from '$lib/avendb/local.js';
// Shared Universe state. Every page reads local avenDB; manifests and background sync supply missing records.
import { authorsOf, fromFeed, pictureUrl } from './posts.js';
import { PICTURE } from '$lib/avendb/picture.js';
import { inspireOf } from './inspire.js';
import { ANSWER, deviceOf } from '../../../game/code/sources/device.js';

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
	// Local provenance for every page.
	from: ''
});

export const findPost = (doc) => stream.posts.find((p) => p.doc === doc);

export const authorOf = (p) => stream.authors[p.author];

// each vault's profile picture as avenDB's server serves it to everyone ($lib/avendb/picture.js): its address once it
// loaded, '' where it has none, asked for once per vault whatever number of cards show it
// (`asked` plain, as a card asks while it renders, where no state may change)
export const faceOf = (vault) => pictureUrl(vault, PICTURE);

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


/** A page of posts off the page's own device: `{ posts, more }`, or null where none is open or it can't answer. */
async function devicePage(after) {
	const d = deviceOf() || await localDevice();
	if (!d) return null;
	const got = await within(d.run({ op: 'posts', limit: PAGE, ...(after ? { after } : {}) }), ANSWER);
	return Array.isArray(got?.ok?.posts) ? got.ok : null;
}

/** Supplementary post records are already in the local world after manifest sync. */
async function loadEntries() {
	const d = deviceOf() || await localDevice();
	if (!d) return;
	const got = await within(d.run({ op: 'world' }), ANSWER);
	const entries = got?.ok?.entries;
	if (Array.isArray(entries)) stream.entries = new Map(entries.map(e => [e.entry ?? e.id, e]));
}

async function pageOf(after) {
	const local = await devicePage(after);
	if (!local) throw new Error('Waiting for the local avenDB instance');
	return { ...local, from: 'this device' };
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
			await loadEntries();
			let after = null;
			for (let n = 0; n < 10; n++) {
				const page = await pageOf(after);
				take(page.posts, { top: n === 0 });
				stream.more = page.more;
				const next = page.posts.at(-1)?.entry;
				if (!page.more || !next || next === after) break;
				after = next;
			}
			stream.from = 'this device';
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
