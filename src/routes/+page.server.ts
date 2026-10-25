import type { PageServerLoad } from './$types';

// The public banner is bundled with Manifesto, so it is present before any local device opens.
export const load: PageServerLoad = () => ({ banner: true });
