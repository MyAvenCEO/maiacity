import { error } from '@sveltejs/kit';
import { getPost, listPosts } from '$lib/server/blog';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const post = getPost(params.slug);
	if (!post) error(404, 'Post not found');
	// the day after this one, for the door at the foot of the post
	const next = post.day != null ? (listPosts().find((p) => p.day === post.day! + 1) ?? null) : null;
	return { post, next };
};
