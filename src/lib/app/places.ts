// The places of the signed-in app (/app/): what the dashboard shows as tiles and the nav pill links to. Every game,
// sandbox, world, game asset and admin's tool opens by a cap group of the Maia City COOP vault the person holds in
// avenDB (Samuel 2026-10-19: "purely behind avenDB native caps", no draft stage, no Postgres role): the sandboxes, the
// Traveler game and the game assets to every Traveler, other worlds to every Citizen, the admins'
// own pages to every Admin, all of it to whoever acts for Maia City ($lib/app/access.svelte.js); anyone else who has
// a link to one is told what opens it.
import { base } from '$app/paths';
import { latestOf, versionsOf, type Version } from '$lib/app/versions.js';
import { holdsGroup } from '$lib/app/access.svelte.js';
import { ADMIN, CITIZEN, TRAVELER, TRAVELER_GAME } from '$lib/avendb/capgroups.js';
import { PLACES } from '../../../game/places.js';

export type Place = {
	href: string; label: string; icon: IconName; note?: string; /** a picture, by hash */ cover?: string
	/** the cap group of the Maia City vault that opens it ($lib/avendb/capgroups.js): Admin for the admins' own tools */
	needs?: string
	/** a world's or sandbox's versions and history ($lib/app/versions.js), the latest its own; and what it is anchored to */
	versions?: Version<string>[]; version?: number; anchors?: string
	/** a game's id in the Maia City COOP vault (game/games.js), from its address */
	game?: string
};
export type IconName = 'back' | 'home' | 'play' | 'board' | 'calendar' | 'media' | 'studio' | 'journal' | 'spark' | 'user' | 'key' | 'ledger' | 'coops' | 'proposals' | 'leaf' | 'database' | 'universe' | 'gear' | 'chat';

// a founder's own apps: their money and the COOPs, read from MaiaCity V1's one game, the proposals of every game
// (AIPs), which live only here, never on a game's own screens (Samuel 2026-10-17), the chat, and the Universe.
// Every sandbox draws the same ones.
export const APPS: Place[] = [
	{ href: `${base}/app/ledger/`, needs: CITIZEN, label: 'Ledger', icon: 'ledger', note: 'Your HEARTS and MINDs, every rent and pay day, every transaction' },
	{ href: `${base}/app/coops/`, needs: CITIZEN, label: 'Coops', icon: 'coops', note: 'The three COOPs: treasuries, holders, assets, rents' },
	// chat rooms on avenDB: notes to self, DMs, groups and a coop's channels, every signed-in person's
	{ href: `${base}/app/chat/`, needs: CITIZEN, label: 'Chat', icon: 'chat', note: 'Notes to self, direct messages, groups and channels, end to end encrypted' },
	{ href: `${base}/app/aips/`, needs: CITIZEN, label: 'Proposals', icon: 'proposals', note: 'Every game’s proposals: ideas, proposed, applied or rejected' },
	// the Universe stream, on the public site (the navbar's Universe tab): the journal and Inspire me are its channels
	{ href: `${base}/universe/`, label: 'Universe', icon: 'universe', note: 'What happens in maiaCITY, as it happens' }
];

const navigation = (group: string): Place[] => PLACES
	.filter((place) => place.navigation?.group === group)
	.sort((left, right) => left.navigation!.order - right.navigation!.order)
	.map((place) => {
		const nav = place.navigation!;
		const href = `${base}${place.route}`;
		const versions = versionsOf(href, place.history);
		return {
			href, label: place.label, icon: nav.icon, note: nav.note ?? place.note,
			...(nav.cover ? { cover: nav.cover.startsWith('/') ? `${base}${nav.cover}` : nav.cover } : {}),
			...(nav.anchors ? { anchors: nav.anchors } : {}),
			...(group === 'CITY' ? {} : { versions, version: latestOf(versions) }),
			needs: place.id === TRAVELER_GAME ? TRAVELER : CITIZEN,
			...(place.gameOrder !== undefined ? { game: place.id } : {})
		};
	});

export const PLAY = navigation('PLAY');
export const WORLDS = navigation('WORLDS');
export const CITY = navigation('CITY');

/** every game, on the dashboard's Game Worlds: MaiaCity V1 first, then the sandboxes */
export const GAME_WORLDS: Place[] = [...CITY, ...PLAY];

/** An admin: holds Maia City's Admin cap group, or acts for Maia City. */
export const isAdmin = () => holdsGroup(ADMIN);

/** Whether the person opens a place: by the cap group of Maia City it needs, if any. */
export const opens = (p: Place) => !p.needs || holdsGroup(p.needs);

/** The game, world, game asset or admin's page a path is in, if any: closed to whoever doesn't hold what opens it. */
export const gameAt = (path: string) =>
	[...CITY, ...PLAY, ...WORLDS, ...APPS].find((p) => path.startsWith(p.href)) ?? PAGES.find((p) => path.startsWith(p.href));
/** the Worlds grid and the game assets' own pages (the Buildings, the Factories, the Biomes): every Traveler's; the
 *  The studio, the Postgres window and avenDB's own page: the admins'. One gate for every page, this one: no
 *  page asks the API's Postgres roles any more. The studio works on avenDB alone (its cuts, the vaults' Library, its
 *  jobs), by the person's own shares; the Postgres window's rows open by the same Admin group, as avenDB's server
 *  tells the API of the pass the page's device signs (api/src/standing.ts) */
const PAGES: Place[] = [
	{ href: `${base}/app/worlds/`, label: 'Worlds', icon: 'play', needs: CITIZEN },
	{ href: `${base}/app/factories/`, label: 'Factories', icon: 'gear', needs: TRAVELER },
	{ href: `${base}/app/buildings/`, label: 'Buildings', icon: 'home', needs: TRAVELER },
	{ href: `${base}/app/biomes/`, label: 'Biomes', icon: 'leaf', needs: TRAVELER },
	{ href: `${base}/app/studio/`, label: 'Studio', icon: 'studio', needs: ADMIN },
	{ href: `${base}/app/postgres/`, label: 'Postgres', icon: 'database', needs: ADMIN },
	{ href: `${base}/app/avendb/`, label: 'avenDB', icon: 'database', needs: ADMIN }
];
