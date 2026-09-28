import { error } from '@sveltejs/kit';
import { getEntry } from '$lib/server/inspire-me';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const entry = getEntry(params.slug);
	if (!entry) error(404, 'Source not found');
	return { entry };
};
