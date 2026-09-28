// Where the site loads a media file from. Every file is known by its CID — the media library (Postgres, seeded from
// the repo's library/ folder); there are no paths. The manifest is the database's public files by CID, with their
// titles, descriptions and tags (for sorting, never for finding a file): where each one's copy is on the CDN
// (https://maia.city/media/<cid>.<ext>). Everything names its files by CID. A file without a copy yet is loaded from the API —
// in development always from the local one, whose manifest (manifest.local.json) comes from the local database.
import { dev } from '$app/environment';
import published from './manifest.json';

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

/** The address of a file by its CID: its copy on the CDN when it has one, else the API. A full URL is left as it is. */
export function asset(ref: string): string;
export function asset(ref: string | undefined | null): string | undefined;
export function asset(ref: string | undefined | null) {
	if (!ref) return undefined;
	if (/^https?:\/\//.test(ref)) return ref;
	const cid = CID.exec(ref)?.[1];
	if (!cid) return ref;
	const url = known[cid]?.url;
	return url ? `${CDN}${url}` : `${API}/api/media/${cid}`;
}

/** What the library says about a public file. */
export const media = (cid: string | undefined | null): MediaEntry | undefined => (cid ? known[CID.exec(cid)?.[1] ?? cid] : undefined);
