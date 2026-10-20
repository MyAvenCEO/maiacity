// Where the site loads a media file from. Every file is known by its BLAKE3 hash (64 hex), the one the old media vault
// named it by; there are no paths. The manifest is the site's files by hash, with their titles, descriptions and tags
// (for sorting, never for finding a file). The bytes come from avenDB's feed of Maia City's public files, behind
// api.maia.city/vault/files (with Range; deploy/Caddyfile); in The OS through the app.
import published from './manifest.json';
import { APP_API, native } from '$lib/native';

export type MediaEntry = { url: string | null; mime: string; title: string; description: string; tags: string[]; stream?: string };

/** Every public file, by hash. */
const known = published as Record<string, MediaEntry>;

/** A file in the vault: its BLAKE3 hash (64 hex), alone or with its extension. */
const HASH = /^([0-9a-f]{64})(\.[a-z0-9]+)?$/;
/** Is this file in the vault (named by its hash)? */
export const inVault = (ref: string | undefined | null) => !!ref && HASH.test(ref);
/** Maia City's public files from avenDB's feed, behind api.maia.city: every file by its hash, with Range. */
export const GATEWAY = 'https://api.maia.city/vault/files';

/** The address of a file: by its hash, from the gateway. A full URL, or anything else, is left as it is. */
export function asset(ref: string): string;
export function asset(ref: string | undefined | null): string | undefined;
export function asset(ref: string | undefined | null) {
	if (!ref) return undefined;
	if (HASH.test(ref)) return native() ? `${APP_API}/vault/files/${ref}` : `${GATEWAY}/${ref}`;
	return ref;
}

/** What the vault says about a public file. */
export const media = (ref: string | undefined | null): MediaEntry | undefined => (ref ? known[HASH.exec(ref)?.[1] ?? ref] : undefined);
