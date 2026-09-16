import { listPosts } from '$lib/server/blog';
import type { PageServerLoad } from './$types';

// Day 01 is the front door: the intro video stays pinned to the root page.
export const load: PageServerLoad = () => {
	const posts = listPosts();
	return { pinned: posts.find((post) => post.day === 1) ?? posts[0] ?? null };
};
