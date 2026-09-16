import { error } from '@sveltejs/kit';
import { getPost, listPosts } from '$lib/server/blog';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const post = getPost(params.slug);
	if (!post) error(404, 'Post not found');
	// the day after this one, for the door at the foot of the post
	const posts = listPosts();
	const next = post.day != null ? (posts.find((p) => p.day === post.day! + 1) ?? null) : null;
	// and the newest days besides those two, for the reader who wants to browse
	const latest = posts.filter((p) => p.slug !== post.slug && p.slug !== next?.slug).slice(0, 3);
	return { post, next, latest };
};
