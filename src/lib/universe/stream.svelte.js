// @ts-nocheck — plain JS, kept loose on purpose
// The stream held in memory and shared by the feed and the post pages, so a post shared a moment ago opens on its
// own page too. A reload starts it over from the hardcoded posts.
import { POSTS } from './posts.js';

export const stream = $state({ posts: POSTS.map((p) => ({ ...p, liked: false })) });

export const findPost = (doc) => stream.posts.find((p) => p.doc === doc);

export function like(p) {
	p.liked = !p.liked;
	p.likes += p.liked ? 1 : -1;
}
