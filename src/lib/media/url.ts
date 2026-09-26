// Where the site loads a media file from. Postgres holds every file under its CID (the media library); once a
// file's public copy is on the CDN, the manifest (written by api/scripts/media-manifest.ts, in CI) names it, and the
// site loads it from https://maia.city/media/<cid>.<ext> — the same bytes, cached for good, the same address from
// the CDN, from GitHub Pages and from local development. A path the manifest does not know is served from static/.
import { base } from '$app/paths';
import manifest from './manifest.json';

const known = manifest as Record<string, { cid: string; url: string | null }>;
export const CDN = 'https://maia.city';

/** The address of a site path like "/day-18-…/room.jpg": its CID on the CDN when it has one, else under base. */
export function asset(path: string): string;
export function asset(path: string | undefined | null): string | undefined;
export function asset(path: string | undefined | null) {
	if (!path) return undefined;
	if (/^https?:\/\//.test(path)) return path;
	const url = known[path]?.url;
	return url ? `${CDN}${url}` : `${base}${path}`;
}
