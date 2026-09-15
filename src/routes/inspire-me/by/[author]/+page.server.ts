import { error } from '@sveltejs/kit';
import { getAuthor } from '$lib/server/inspire-me';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const author = getAuthor(params.author);
	if (!author) error(404, 'Author not found');
	return { author };
};
