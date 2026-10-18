// @ts-nocheck — plain JS, kept loose on purpose
// The stream held in memory and shared by the feed and the post pages: avenDB's feed (`loadFeed`), every post
// published in avenDB that everyone may read, its author the vault that published it.
import { ENTRIES, FEED, authorsOf, fromFeed } from './posts.js';
import { inspireOf } from './inspire.js';

export const stream = $state({
	posts: [],
	authors: {},
	// the other entries everyone may read that a post's layout draws on (an inspire post's story, delivery and source),
	// by entry id
	entries: new Map(),
	// avenDB's feed: 'idle', 'loading', 'done' or 'failed'
	feed: 'idle'
});

export const findPost = (doc) => stream.posts.find((p) => p.doc === doc);

export const authorOf = (p) => stream.authors[p.author];

export function like(p) {
	p.liked = !p.liked;
	p.likes += p.liked ? 1 : -1;
}

// The posts of avenDB's feed in the stream, in place of those it served before: one taken off since leaves, one liked
// here stays liked; then the whole stream newest first.
function take(posts, entries) {
	stream.entries = new Map(entries.map((e) => [e.entry, e]));
	const now = Date.now() / 1000;
	const before = new Map(stream.posts.map((p) => [p.entry, p]));
	for (const p of posts) {
		const { key, voice } = authorsOf(p);
		stream.authors[key] ??= voice;
	}
	const fed = posts.map((p) => {
		const had = before.get(p.entry);
		const post = { ...fromFeed(p, now), ...(had && { liked: had.liked, likes: had.likes }) };
		// an inspire post shows its source's picture, as its report card did
		const inspire = inspireOf(post, stream.entries);
		if (inspire?.thumbnails.length) post.cover = { src: inspire.thumbnails.at(-1), alt: '' };
		if (inspire?.hook) post.text = inspire.hook;
		return post;
	});
	stream.posts = fed.sort((a, b) => (a.ago ?? Infinity) - (b.ago ?? Infinity));
}

let loading = null;

// Takes in avenDB's feed, once at a time: what its server keeps that everyone may read. Where it can't be reached,
// the stream keeps what it has.
export function loadFeed() {
	loading ??= (async () => {
		if (stream.feed !== 'done') stream.feed = 'loading';
		try {
			const json = { headers: { accept: 'application/json' } };
			// the other public entries are a nicety: a post still shows without them
			const [r, more] = await Promise.all([fetch(FEED, json), fetch(ENTRIES, json).catch(() => null)]);
			if (!r.ok) throw new Error(`avenDB's feed answers ${r.status}`);
			const { posts } = await r.json();
			const { entries } = more?.ok ? await more.json().catch(() => ({})) : {};
			take(Array.isArray(posts) ? posts : [], Array.isArray(entries) ? entries : []);
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
