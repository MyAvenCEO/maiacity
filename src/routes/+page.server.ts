import { media } from '$lib/media/url';
import type { PageServerLoad } from './$types';

// The journal on the front page is avenDB's feed, taken in in the browser as /universe takes it in
// ($lib/universe/stream.svelte.js), so the build never waits on it. Only the banner is known as the site is built.
export const load: PageServerLoad = () => ({
	// checked at build time: a prerendered page can't catch a missing image
	// before it has already painted the gap
	banner: Boolean(media('9e442ce81d3237243f561780fa6d3aeeeb7f1d83ea8e68f3a166650739c398b2.jpg'))
});
