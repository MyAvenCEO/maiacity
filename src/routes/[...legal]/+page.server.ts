import { error } from '@sveltejs/kit';
import { LEGAL_DOCUMENTS, legalByPath } from '$lib/legal';
import type { EntryGenerator, PageServerLoad } from './$types';

export const prerender = true;

export const entries: EntryGenerator = () =>
	LEGAL_DOCUMENTS.map((d) => ({ legal: d.path.replace(/^\/|\/$/g, '') }));

export const load: PageServerLoad = ({ params }) => {
	const doc = legalByPath(`/${params.legal}`);
	if (!doc) error(404, 'Not found');
	return { doc };
};
