// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The actors Maia City's vault holds (game/code/sources/actors.js, "Actor, v3", evolved from "Manifest, v2"), as the
 * repo declares them for their AIP (scripts/propose-actors.mjs): the kernel, which every page holds, the dashboard, the
 * Universe, Chat, the Studio, the asset libraries, each page and each game. An app is an actor (Samuel 2026-10-27);
 * what it loads is a tree of Interests in four tiers (now, next, later, idle; Lean avendb/spec/AvenDB/Interest.lean),
 * slots bound by the route or the selection, signals ordering a tier. An actor is a vault entry like any other, so a
 * change to one goes in by AIP too, never by the seed.
 *
 * Long logs (a room's messages, an asset's versions) come whole today; their `window` says what of them is wanted
 * first, which the node honours inside one log once an entry starts from its newest snapshot plus the edits after it
 * (sync v2 step P6). For a list of entries it holds now.
 */
import { GAMES, gameTag } from '../../../game/games.js';
import { PLACES } from '../../../game/places.js';

/** An actor of `o`: its loads in `tiers`, a held actor as `{ actor }`; no interface, caps or code of its own yet. */
const actor = ({ tiers, ...o }) => ({ kind: 'actor', v: 3, note: '', routes: [], slots: [], ...o, interface: {}, needs: [], code: [], loads: tiers });

/** The kernel: what every page reads, whatever app it is: who may do what, the schemas and lenses that read records. */
export const KERNEL = actor({
	id: 'kernel',
	title: 'Kernel',
	note: "What every page reads first: the vault's cap groups, schemas and lenses.",
	routes: ['*'],
	tiers: { now: [{ want: { type: ['capgroup', 'schema', 'lens'] }, part: 'headers' }] }
});

/** A game's actor: the kernel, its code and settings (tagged `game:<id>`) on screen, the entries they name next. */
export const gameActor = (g) =>
	actor({
		id: `game-${g.id}`,
		title: g.label,
		note: `What ${g.label} reads: its views, logic and settings now, the worlds and recipes they name next.`,
		routes: [g.route, `/games/${g.id}/`],
		tiers: {
			now: [{ actor: KERNEL.id }, { want: { tags: [gameTag(g.id)] } }],
			next: [{ want: { tags: [gameTag(g.id)] }, follow: 2 }]
		}
	});

/**
 * Sandbox 4 (Samuel's example, 2026-10-26): the world's config, then the assets the camera can see, nearest first,
 * then those just outside the view in the walking direction (the camera's own distances do that), the rest of the
 * recipes in the background. The shared view-driven loader (world streaming, 2026-10-18) as an Interest: the world
 * sets the `camera` signal (game/code/sources/device.js `signalView`) as it moves into a new cell. Levels of detail stay
 * built on each device, never stored (2026-10-19).
 */
export const sandbox4Actor = (g) =>
	actor({
		id: `game-${g.id}`,
		title: g.label,
		note: "What Sandbox 4 reads: its config now, the assets its pins name ordered by the camera's distance, then the other recipes.",
		routes: [g.route, `/games/${g.id}/`],
		tiers: {
			now: [{ actor: KERNEL.id }, { want: { tags: [gameTag(g.id)] } }, { want: { tags: [gameTag(g.id)] }, follow: 2, by: 'camera' }],
			idle: [{ want: { type: ['recipe'] }, part: 'headers' }]
		}
	});

/** The dashboard: the kernel, then the games it lists. */
export const DASHBOARD = actor({
	id: 'dashboard',
	title: 'Dashboard',
	note: 'What the dashboard reads: the games it lists.',
	routes: ['/app/'],
	tiers: { now: [{ actor: KERNEL.id }, { want: { type: ['game'] }, part: 'headers' }] }
});

/** The Maia Universe: the kernel, its newest page of stories and posts, then the rest of them. */
export const UNIVERSE = actor({
	id: 'universe',
	title: 'Maia Universe',
	note: 'What the Universe shows first: its newest stories and posts, a page of them, the rest after.',
	routes: ['/universe/', '/universe/*'],
	tiers: {
		now: [{ actor: KERNEL.id }, { want: { type: ['story', 'post:inspire'] }, window: { newest: 20 }, files: ['media:still'] }],
		later: [{ want: { type: ['story', 'post:inspire'] } }]
	}
});

/**
 * Chat (Samuel's example, 2026-10-26): my rooms first, then the open room's newest messages, then the newest of the
 * other recent rooms, its pictures as they scroll into view, and older history last.
 */
export const CHAT = actor({
	id: 'chat',
	title: 'Chat',
	note: 'My room list now; the open room ($room) on open, newest messages first; the five most recent other rooms next; its pictures by the viewport later; older history idle.',
	routes: ['/app/chat/', '/app/chat/*', '/app/#chat'],
	slots: ['room'],
	tiers: {
		now: [
			{ actor: KERNEL.id },
			{ want: { type: ['room'], vault: '*' }, part: 'headers', note: 'names, members, last line, unread' },
			{ want: { entry: '$room' }, window: { newest: 50 }, note: 'the newest 50 messages and their senders' }
		],
		next: [{ want: { type: ['room'], vault: '*' }, window: { newest: 5 }, note: 'the newest messages of the five most recent rooms' }],
		later: [
			{ want: { entry: '$room' }, part: 'files', files: ['media:still', 'media:preview'], by: 'viewport' },
			{ want: { entry: '$room' }, part: 'files', files: ['media:original'], by: 'viewport' }
		],
		idle: [
			{ want: { entry: '$room' }, window: { oldest: true }, note: 'the open room back in time' },
			{ want: { type: ['room'], vault: '*' }, note: 'then every room' }
		]
	}
});

/**
 * The Studio (Samuel's example, 2026-10-26): the timeline list, then the selected timeline's sequence and a still
 * per shot, its sound from the playhead on, proxies near the playhead, originals only when opened full quality or
 * exported, the other timelines last. The player sets the `playhead` signal as the shot under it changes.
 */
export const STUDIO = actor({
	id: 'studio',
	title: 'Studio',
	note: 'Timelines now; the selected one ($timeline) with its shots and stills on open; its sound from the playhead; proxies by the playhead next; originals ($original) on demand; other timelines idle.',
	routes: ['/app/studio/', '/app/studio/*'],
	slots: ['timeline', 'original'],
	tiers: {
		now: [
			{ actor: KERNEL.id },
			{ want: { type: ['cut'] }, part: 'headers', files: ['media:still'], note: 'names and covers' },
			{ want: { entry: '$timeline' }, follow: 2, note: 'shots, clips and cut points' },
			{ want: { entry: '$timeline' }, follow: 2, part: 'files', files: ['media:still'], note: 'one still per shot' },
			{ want: { entry: '$timeline' }, follow: 2, part: 'files', files: ['audio/'], by: 'playhead', note: 'sound from the playhead' }
		],
		next: [{ want: { entry: '$timeline' }, follow: 2, part: 'files', files: ['media:proxy'], by: 'playhead' }],
		later: [{ want: { entry: '$original' }, part: 'files', files: ['media:original'], note: 'export or full quality only' }],
		idle: [{ want: { type: ['cut'] }, follow: 2, part: 'files', files: ['media:still'] }]
	}
});

/**
 * The asset libraries and their viewers (Samuel's example, 2026-10-26): the list first, the selected asset's card,
 * recipe and pins on select, its neighbours in the list next, its older versions later.
 */
export const ASSETS = actor({
	id: 'assets',
	title: 'Game Assets',
	note: 'The library list now; the selected asset ($asset) with what it pins on select; its neighbours by list position next; its older versions later.',
	routes: ['/app/models/', '/app/actors/', '/app/machines/', '/app/plants/', '/app/biomes/', '/app/buildings/', '/app/worlds/*', '/app/assets/*', '/app/#assets'],
	slots: ['asset'],
	tiers: {
		now: [
			{ actor: KERNEL.id },
			{ want: { type: ['recipe'] }, part: 'headers', files: ['media:still'], note: 'name, kind, versions, thumbnail' },
			{ want: { entry: '$asset' }, follow: 2, note: 'card, recipe and what it pins' },
			{ want: { entry: '$asset' }, part: 'files', note: 'its own files: the model the viewer shows' }
		],
		next: [{ want: { type: ['recipe'] }, by: 'list', note: 'the neighbours of the selected one first' }],
		later: [{ want: { entry: '$asset' }, window: { oldest: true }, note: 'older versions and variants' }]
	}
});

/**
 * A page of the app's own, or of a vault opened in it (`/app/#<page>`, the name `viewPath` gives it): the kernel, the
 * headers of the entries of types `types` it lists now and those entries whole later; a page that lists none (its
 * device's own numbers, settings) holds the kernel alone, which it says so. Every page the app opens has one, so the
 * first thing a device brings for it is that page's, never the bulk (Samuel 2026-10-27).
 * @param {string} id @param {string} title @param {string[]} routes @param {string[]} [types]
 */
const page = (id, title, routes, types = []) =>
	actor({
		id: `page-${id}`,
		title,
		note: types.length ? `What ${title} lists: the headers of its ${types.join(', ')} entries now, them whole later.` : `${title} reads no entries of its own: the kernel alone.`,
		routes,
		tiers: {
			now: [{ actor: KERNEL.id }, ...(types.length ? [{ want: { type: types }, part: 'headers' }] : [])],
			...(types.length ? { later: [{ want: { type: types } }] } : {})
		}
	});

/** The vault's pages the app opens by their hash (VaultApps.svelte `NAV`), each with what it lists. */
export const PAGES = [
	page('sparks', 'Sparks', ['/app/#sparks'], ['note', 'artifact']),
	page('artifacts', 'Artifacts', ['/app/#artifacts'], ['artifact']),
	page('todos', 'Todos', ['/app/#todos'], ['todo']),
	page('stories', 'Stories', ['/app/#stories'], ['story']),
	page('docs', 'Docs', ['/app/#docs'], ['story', 'post']),
	page('library', 'Library', ['/app/#library'], ['file']),
	page('worlds', 'Worlds', ['/app/#worlds'], ['game']),
	page('models', 'Models', ['/app/#models'], ['file']),
	page('code', 'Code', ['/app/#code'], ['file']),
	page('query', 'Query', ['/app/#query']),
	page('tables', 'Table editor', ['/app/#tables']),
	page('schemas', 'Schemas', ['/app/#schemas'], ['schema']),
	page('lenses', 'Lenses', ['/app/#lenses'], ['lens']),
	page('flows', 'Flows', ['/app/#flows'], ['flow']),
	page('functions', 'Functions', ['/app/#functions'], ['function']),
	page('history', 'History', ['/app/#history']),
	page('jobs', 'Jobs', ['/app/#jobs'], ['job']),
	page('performance', 'Performance', ['/app/#performance']),
	page('settings', 'Settings', ['/app/#settings'], ['capgroup']),
	page('vaults', 'Vaults', ['/app/#vaults'], ['capgroup']),
	page('activity', 'Activity', ['/app/#activity']),
	// the app's own pages beside the vault's
	page('aips', 'Proposals', ['/app/aips/', '/app/aips/*', '/app/maiacity-v2/proposals/'], ['aip']),
	page('postgres', 'Postgres', ['/app/postgres/', '/app/#postgres']),
	page('coops', 'Coops', ['/app/coops/', '/app/coops/*']),
	page('factories', 'Factories', ['/app/factories/', '/app/factories/*'], ['recipe']),
	page('ledger', 'Ledger', ['/app/ledger/', '/app/ledger/*']),
	page('network', 'Network', ['/app/network/', '/app/network/*']),
	page('avendb', 'avenDB', ['/app/avendb/', '/app/avendb/*']),
	page('probes', 'Probes', ['/app/math/probe/', '/app/views/probe/'])
];

/** The labs under /app/games/ that are no game of the list (no `gameOrder`, Sandbox 7 and 8): each reads as a game does. */
export const LABS = PLACES.filter((p) => p.route?.startsWith('/app/games/') && !GAMES.some((g) => g.id === p.id));

/** Every actor the repo declares. */
export const ACTORS = [
	KERNEL, DASHBOARD, UNIVERSE, STUDIO, CHAT, ASSETS, ...PAGES,
	...GAMES.map((g) => (g.id === 'sandbox-4' ? sandbox4Actor(g) : gameActor(g))),
	...LABS.map(gameActor)
];
