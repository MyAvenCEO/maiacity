import { localMedia } from './local-resolver.js';
import { MAIA_CITY } from '../../../game/code/sources/anchor.js';
// Published media references resolve through the shared local avenDB reader.
import published from './manifest.json';
import { parseMediaRef } from './ref.js';

export type MediaEntry = { url: string | null; mime: string; title: string; description: string; tags: string[]; stream?: string };

/** Every public file, by hash. */
const known = published as Record<string, MediaEntry>;

/** Is this file in the vault (named by its hash)? */
export const inVault = (ref: string | undefined | null) => parseMediaRef(ref)?.kind === 'public';
// Media bytes are served by the local avenDB instance, never a gateway.

/** Local media by hash or imported URL; bundled paths and local object URLs remain usable. */
export function asset(ref: string): string;
export function asset(ref: string | undefined | null): string | undefined;
export function asset(ref: string | undefined | null) {
	if (!ref) return undefined;
	const parsed = parseMediaRef(ref);
	if (parsed?.kind === 'public') return localMedia(MAIA_CITY, parsed.hash);
	if (/^https?:\/\//i.test(ref)) {
		const legacy = /\/vault\/files\/([a-f0-9]{64})(?:\.[a-z0-9]+)?(?:[?#]|$)/i.exec(ref);
		return localMedia(MAIA_CITY, legacy?.[1] || ref);
	}
	return ref;
}

/** What the vault says about a public file. */
export const media = (ref: string | undefined | null): MediaEntry | undefined => {
	if (!ref) return undefined;
	const parsed = parseMediaRef(ref);
	return known[parsed?.kind === 'public' ? parsed.hash : ref];
};
