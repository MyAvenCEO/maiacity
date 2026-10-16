// @ts-nocheck — plain JS, kept loose on purpose
// The Maia Universe stream: every post published in avenDB, as its server's feed serves them (`FEED`, `fromFeed`): a
// post an article's content flow made as it was published, which everyone may read, with the pictures it shows that
// everyone may read too (`FILES`).
import { laidOut } from '$lib/avendb/article.js';
import { idOf, slug } from '$lib/ids.js';

export const CHANNELS = ['All', 'Devlog', 'theOS', 'Village', 'Food', 'Energy'];

// A post's page lives on the root, at /<doc>/?t=<slug of the title>, `doc` its avenDB entry as an iroh doc id reads.
// `ago` is in minutes.
export const ago = (min) =>
	min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;

// a title as it reads in an address: lower case, words joined by dashes
export { slug };

// avenDB's server: its feed, the posts it keeps that everyone may read, newest first
export const FEED = 'https://avendb.maia.city/feed/posts';

// avenDB's server: the pictures it keeps that everyone may read, each by its vault and the name an article gives it
export const FILES = 'https://avendb.maia.city/feed/files';

// where picture `name` of vault `vault` is read, which everyone may read
export const pictureUrl = (vault, name) => `${FILES}/${vault}/${name}`;

// the doc id of an avenDB post: its entry's 32 bytes as an address reads them ($lib/ids.js)
export const docOf = (entry) => idOf(entry);

// Markdown as plain text, as a post shows it: no marks, links by their words, no pictures
export const plain = (md) =>
	md
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
		.replace(/(\*\*|__|\*|_|`|~~)(\S(?:.*?\S)?)\1/g, '$2')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

const COLORS = ['#c8744f', '#2f6fbf', '#1f7a52', '#8a5fb0', '#6b8a3a', '#b0703a', '#3b7d8c'];

// the voice of avenDB vault `vault`, named `name` (by its profile, or none) and of kind `kind`: an aven's, or a device
// vault's, an agent's or a server's, is no person's but AI's
export function voiceOf(vault, name, kind) {
	const called = name || `Vault ${vault.slice(0, 4)}`;
	const words = called.split(/\s+/).filter(Boolean);
	const initials = (words.length > 1 ? words[0][0] + words[1][0] : called.slice(0, 2)).toUpperCase();
	const color = COLORS[parseInt(vault.slice(0, 2), 16) % COLORS.length];
	return { name: called, handle: slug(called), initials, color, ai: kind === 'aven' || kind === 'device', coop: kind === 'coop', avendb: true };
}

// The cover of a post's article text `md`, as avenDB lays it out, where everyone may read it, among `pictures`: its
// address and its words, or null.
function coverOf(md, vault, pictures) {
	const { coverName, coverAlt } = laidOut(md);
	return coverName && pictures.includes(coverName) ? { src: pictureUrl(vault, coverName), alt: coverAlt } : null;
}

// a post of avenDB's feed as the stream holds it, `now` in seconds since 1970: its id its entry, its author its vault,
// the pictures it shows that everyone may read, by the names it gives them, and its cover where it is one of them
export const fromFeed = (p, now, pictures = Array.isArray(p.pictures) ? p.pictures : []) => ({
	id: p.entry,
	entry: p.entry,
	doc: docOf(p.entry),
	title: p.title || 'Untitled',
	author: p.vault,
	// none for a post whose entry says no time (`created` 0, as before avenDB's devices set their clock)
	ago: p.created > 0 ? Math.max(0, Math.round((now - p.created) / 60)) : null,
	channel: p.channel || 'Devlog',
	text: plain(p.text ?? ''),
	// its Markdown as written, for its own page, which lays it out as the journal does
	md: p.text ?? '',
	vault: p.vault,
	pictures,
	cover: coverOf(p.text ?? '', p.vault, pictures),
	likes: 0,
	replies: 0,
	liked: false
});

export const postHref = (base, p) => `${base}/${p.doc}/?t=${slug(p.title)}`;
