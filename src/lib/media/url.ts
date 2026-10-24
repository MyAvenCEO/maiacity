import { localMedia } from './local-resolver.js';
import { MAIA_CITY } from '../../../game/code/sources/anchor.js';
// Published media references resolve through the shared local avenDB reader.
import published from './manifest.json';

export type MediaEntry = { url: string | null; mime: string; title: string; description: string; tags: string[]; stream?: string };

/** Every public file, by hash. */
const known = published as Record<string, MediaEntry>;

/** A file in the vault: its BLAKE3 hash (64 hex), alone or with its extension. */
const HASH = /^([0-9a-f]{64})(\.[a-z0-9]+)?$/;
/** Is this file in the vault (named by its hash)? */
export const inVault = (ref: string | undefined | null) => !!ref && HASH.test(ref);
// Media bytes are served by the local avenDB instance, never a gateway.

/** Local media by hash or imported URL; bundled paths and local object URLs remain usable. */
export function asset(ref: string): string;
export function asset(ref: string | undefined | null): string | undefined;
export function asset(ref: string | undefined | null) {
	if (!ref) return undefined;
	if (HASH.test(ref)) return localMedia(MAIA_CITY, HASH.exec(ref)![1]);
	if (/^https?:\/\//i.test(ref)) {
		const legacy = /\/vault\/files\/([a-f0-9]{64})(?:\.[a-z0-9]+)?(?:[?#]|$)/i.exec(ref);
		return localMedia(MAIA_CITY, legacy?.[1] || ref);
	}
	return ref;
}

/** What the vault says about a public file. */
export const media = (ref: string | undefined | null): MediaEntry | undefined => (ref ? known[HASH.exec(ref)?.[1] ?? ref] : undefined);
