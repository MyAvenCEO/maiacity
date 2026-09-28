import { listPosts } from '$lib/server/blog';
import type { PageServerLoad } from './$types';

// A shell, prerendered with nothing unpublished in it: the day itself comes from the content board, in an admin's
// browser. The published days are here only for the door onward and the latest rows (and to send a reader who has
// an old preview link on to the real post).
export const load: PageServerLoad = () => ({ posts: listPosts() });
