import { listEntries } from '$lib/server/inspire-me';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ entries: listEntries() });
