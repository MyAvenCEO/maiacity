/*
 * How the studio names an avenDB file where the legacy studio names a vault file by its hash (./aven.js): a reference
 * that carries what reading it takes, and its address for the page. Kept apart, with no imports, so that the site's
 * shared client ($lib/auth/client.ts) can tell one from a hash without pulling the studio in.
 */

/** Whether `h` names an avenDB file (`avenRef`), not a legacy vault hash. @param {unknown} h */
export const isAven = (h) => typeof h === 'string' && h.startsWith('aven:');

/**
 * The reference an avenDB file goes by in the studio.
 * @param {{ root: string, size: number, len: number | null }} f @param {string | null | undefined} media
 */
export const avenRef = (f, media) => `aven:${f.root}:${f.size}:${f.len ?? 0}:${encodeURIComponent(media ?? '')}`;

/** Its bytes for `<img>`, `<video>` and `<audio>`, with Range, from avenDB's device in the Mac app. @param {string} ref */
export function avenUrl(ref) {
	const [, root, size, len, media = ''] = ref.split(':');
	return `aven://localhost/${root}?size=${size}&len=${len}${media ? `&media=${media}` : ''}`;
}
