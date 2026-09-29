// The places of the signed-in app (/app/): what the dashboard shows as tiles and the nav pill links to. A place
// with a capability is only for whoever holds it (the admin's tools). A game has a release: "published" is open to
// every founder; a "draft" only to the admins (marked Draft), and anyone else who has its link is told it is not
// released yet. Flip it here to publish or withdraw a sandbox.
import { base } from '$app/paths';
import type { Founder } from '$lib/auth/client';

export type Release = 'draft' | 'published';
export type Place = { href: string; label: string; icon: IconName; cap?: string; note?: string; /** a picture, by CID */ cover?: string; release?: Release };
export type IconName = 'home' | 'play' | 'board' | 'calendar' | 'media' | 'studio' | 'journal' | 'spark' | 'user' | 'key' | 'ledger' | 'coops';

// a founder's own apps: their money, and the communities — cities and settlements, founded, joined and backed here,
// with no map. Every sandbox draws the same ones.
export const APPS: Place[] = [
	{ href: `${base}/app/ledger/`, label: 'Ledger', icon: 'ledger', note: 'Your hearts, what you hold, what happened' },
	{ href: `${base}/app/coops/`, label: 'Coops', icon: 'coops', note: 'Found, join and back cities and settlements' }
];

export const PLAY: Place[] = [
	{ href: `${base}/app/games/sandbox-1/`, label: 'Sandbox 1', icon: 'play', release: 'draft', note: 'A hex island to settle', cover: 'bafkreidb6dx5ija5yeewxvlliz7nvhqurcrxwk4uozka476of6b26zocxa.jpg' },
	{ href: `${base}/app/games/sandbox-2/`, label: 'Sandbox 2', icon: 'play', release: 'draft', note: 'The planet and its first cities', cover: 'bafkreihvabwjkwgkv3v7lr5726p346iovu4zrekaaf2w7qerxbvicwg5mm.jpg' },
	{ href: `${base}/app/games/sandbox-3/`, label: 'Sandbox 3', icon: 'play', release: 'draft', note: 'Inside the domes', cover: 'bafybeigx5mtrbdzh3idwbfrkureiwnfyhw3jtyclg55vuyc67sxdo6w5fa.jpg' },
	{ href: `${base}/app/games/sandbox-4/`, label: 'Sandbox 4', icon: 'play', release: 'draft', note: 'A whole dome cell', cover: 'bafybeiatftbwtb5x7b2bd7zh5dtefhytka27q36djxsn2hmwwtcdd7gxgm.jpg' }
];

export const READ: Place[] = [
	{ href: `${base}/blog/`, label: 'Journal', icon: 'journal', note: 'Day by day' },
	{ href: `${base}/blog/inspire-me/`, label: 'Inspire me', icon: 'spark', note: 'Ideas we learn from' }
];

export const ADMIN: Place[] = [
	{ href: `${base}/app/board/`, label: 'Board', icon: 'board', cap: 'content:admin', note: 'Every day, idea to published' },
	{ href: `${base}/app/calendar/`, label: 'Calendar', icon: 'calendar', cap: 'content:admin', note: 'What goes out when' },
	{ href: `${base}/app/media/`, label: 'Media', icon: 'media', cap: 'media:admin', note: 'The library' },
	{ href: `${base}/app/studio/`, label: 'Studio', icon: 'studio', cap: 'media:admin', note: 'Films and sound' },
	{ href: `${base}/app/device/`, label: 'Terminal', icon: 'key', cap: 'media:admin', note: 'Sign a terminal in' }
];

export const holds = (founder: Founder | null, p: Place) => !p.cap || !!founder?.caps?.includes(p.cap);

/** An admin: holds any of the admin's capabilities. */
export const isAdmin = (founder: Founder | null) => !!founder?.caps?.some((c) => c.endsWith(':admin'));

/** Whether this founder may open a place: a draft only an admin. */
export const released = (founder: Founder | null, p: Place) => p.release !== 'draft' || isAdmin(founder);

/** The game a path is in, if any. */
export const gameAt = (path: string) => PLAY.find((p) => path.startsWith(p.href));

/** Where a path is, in words: the top bar's title. */
export function placeOf(path: string): string {
	const rel = path.slice(base.length).replace(/\/+$/, '/');
	if (rel === '/app/') return 'Dashboard';
	if (rel.startsWith('/app/games/')) return PLAY.find((p) => path.startsWith(p.href))?.label ?? 'Games';
	const app = APPS.find((p) => path.startsWith(p.href));
	if (app) return app.label;
	return ADMIN.find((p) => path.startsWith(p.href))?.label ?? '';
}
