// Where the site loads a media file from. Every file is known by its BLAKE3 hash (64 hex), the one the old media vault
// named it by; there are no paths. The manifest is the site's files by hash, with their titles, descriptions and tags
// (for sorting, never for finding a file). The bytes come from avenDB's feed of Maia City's public files, behind
// api.maia.city/vault/files (with Range; deploy/Caddyfile), in theOS too.
import published from './manifest.json';
import { parseMediaRef } from './ref.js';

export type MediaEntry = { url: string | null; mime: string; title: string; description: string; tags: string[]; stream?: string };

/** Every public file, by hash. */
const known = published as Record<string, MediaEntry>;

/** Is this file in the vault (named by its hash)? */
export const inVault = (ref: string | undefined | null) => parseMediaRef(ref)?.kind === 'public';
/** Maia City's public files from avenDB's feed, behind api.maia.city: every file by its hash, with Range. */
export const GATEWAY = 'https://api.maia.city/vault/files';

/** The address of a file: by its hash, from the gateway. A full URL, or anything else, is left as it is. */
export function asset(ref: string): string;
export function asset(ref: string | undefined | null): string | undefined;
export function asset(ref: string | undefined | null) {
	if (!ref) return undefined;
	if (parseMediaRef(ref)?.kind === 'public') return `${GATEWAY}/${ref}`;
	return ref;
}

/** What the vault says about a public file. */
export const media = (ref: string | undefined | null): MediaEntry | undefined => {
	if (!ref) return undefined;
	const parsed = parseMediaRef(ref);
	return known[parsed?.kind === 'public' ? parsed.hash : ref];
};
