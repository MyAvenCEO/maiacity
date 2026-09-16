import { existsSync } from 'node:fs';
import { listPosts } from '$lib/server/blog';
import type { PageServerLoad } from './$types';

// Day 01 is the front door: the intro video stays pinned to the root page.
export const load: PageServerLoad = () => {
	const posts = listPosts();
	const pinned = posts.find((post) => post.day === 1) ?? posts[0] ?? null;
	return {
		pinned,
		// the day after the front door: the first real step in
		next: posts.find((post) => post.day === (pinned?.day ?? 0) + 1) ?? null,
		// the newest days, so the front door also shows where the journal is now
		latest: posts.filter((post) => post.slug !== pinned?.slug).slice(0, 3),
		// checked at build time: a prerendered page can't catch a missing image
		// before it has already painted the gap
		banner: existsSync('static/manifesto-banner.jpg')
	};
};
