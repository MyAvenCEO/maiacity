import { listPosts } from '$lib/server/blog';
import type { PageServerLoad } from './$types';

// Day 00 is the front door: the intro video stays pinned to the root page.
export const load: PageServerLoad = () => {
	const posts = listPosts();
	return { pinned: posts.find((post) => post.day === 0) ?? posts[0] ?? null };
};
