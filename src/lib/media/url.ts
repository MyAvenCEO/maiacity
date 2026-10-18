// Where the site loads a media file from. Every file is known by its BLAKE3 hash (64 hex) — the legacy vault's; there
// are no paths. The manifest is the legacy vault's public files by hash, with their titles, descriptions and tags (for
// sorting, never for finding a file). The bytes come from avenDB's feed (avendb-server's `GET /feed/legacy/<hash>`,
// with Range): the public file entry of Maia City tagged `legacy:<hash>`, as the Mac app's copy out of the legacy
// vault brought it (vault/app/src/legacy_copy.rs). In maiaCITY Studio, a file that isn't public still comes through
// the app, with its key.
import published from './manifest.json';
import { APP_API, native } from '$lib/native';

export type MediaEntry = { url: string | null; mime: string; title: string; description: string; tags: string[]; stream?: string };

/** Every public file, by hash. */
const known = published as Record<string, MediaEntry>;

/** A file in the vault: its BLAKE3 hash (64 hex), alone or with its extension. */
const HASH = /^([0-9a-f]{64})(\.[a-z0-9]+)?$/;
/** Is this file in the vault (named by its hash)? */
export const inVault = (ref: string | undefined | null) => !!ref && HASH.test(ref);
/** avenDB's feed of the files the legacy vault published: each by its hash, with Range. */
export const GATEWAY = 'https://avendb.maia.city/feed/legacy';

/** The address of a file: by its hash, from avenDB's feed. A full URL, or anything else, is left as it is. */
export function asset(ref: string): string;
export function asset(ref: string | undefined | null): string | undefined;
export function asset(ref: string | undefined | null) {
	if (!ref) return undefined;
	const hash = HASH.exec(ref)?.[1];
	if (hash) return native() && !known[hash] ? `${APP_API}/vault/files/${ref}` : `${GATEWAY}/${ref}`;
	return ref;
}

/** What the vault says about a public file. */
export const media = (ref: string | undefined | null): MediaEntry | undefined => (ref ? known[HASH.exec(ref)?.[1] ?? ref] : undefined);
