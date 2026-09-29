// Where the site loads a media file from. Every file is known by its CID — the media library (Postgres, seeded from
// the repo's library/ folder); there are no paths. The manifest is the database's public files by CID, with their
// titles, descriptions and tags (for sorting, never for finding a file): where each one's copy is on the CDN
// (https://maia.city/media/<cid>.<ext>). Everything names its files by CID. A file without a copy yet is loaded from the API —
// in development always from the local one, whose manifest (manifest.local.json) comes from the local database.
import { dev } from '$app/environment';
import published from './manifest.json';
import { APP_API, native } from '$lib/native';

export type MediaEntry = { url: string | null; mime: string; title: string; description: string; tags: string[]; stream?: string };

const locals = import.meta.glob('./manifest.local.json', { eager: true, import: 'default' }) as Record<string, Record<string, MediaEntry>>;
/** Every public file, by CID: production's, and in development the local database's too (a CDN copy still wins). */
const local = dev ? (Object.values(locals)[0] ?? {}) : {};
const known: Record<string, MediaEntry> = { ...local };
for (const [cid, e] of Object.entries(published as Record<string, MediaEntry>)) known[cid] = { ...local[cid], ...e, url: e.url ?? local[cid]?.url ?? null };

export const CDN = 'https://maia.city';
const API = dev ? ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3100') : 'https://api.maia.city';

/** A CID, alone or with its file's extension ("bafy….jpg"). */
const CID = /^(baf[a-z2-7]{20,})(\.[a-z0-9]+)?$/;
/** A file in the vault: its BLAKE3 hash (64 hex), alone or with its extension. */
const HASH = /^([0-9a-f]{64})(\.[a-z0-9]+)?$/;
/** Is this file in the vault (named by its hash)? */
export const inVault = (ref: string | undefined | null) => !!ref && HASH.test(ref);
/** The vault's gateway (vault-server behind api.maia.city): every file by its hash, with Range. */
export const GATEWAY = 'https://api.maia.city/vault/files';

/** The address of a file: a vault file (by its hash) from the gateway; a file still named by its CID from its copy on
 *  the CDN, else the API. A full URL is left as it is. */
export function asset(ref: string): string;
export function asset(ref: string | undefined | null): string | undefined;
export function asset(ref: string | undefined | null) {
	if (!ref) return undefined;
	if (/^https?:\/\//.test(ref)) return ref;
	if (HASH.test(ref)) return native() ? `${APP_API}/vault/files/${ref}` : `${GATEWAY}/${ref}`;
	const cid = CID.exec(ref)?.[1];
	if (!cid) return ref;
	const url = known[cid]?.url;
	return url ? `${CDN}${url}` : `${native() ? APP_API : API}/api/media/${cid}`;
}

/** What the library says about a public file. */
export const media = (ref: string | undefined | null): MediaEntry | undefined =>
	ref ? known[HASH.exec(ref)?.[1] ?? CID.exec(ref)?.[1] ?? ref] : undefined;
