import { error } from '@sveltejs/kit';
import { getPost } from '$lib/server/blog';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const post = getPost(params.slug);
	if (!post) error(404, 'Post not found');
	return { post };
};
