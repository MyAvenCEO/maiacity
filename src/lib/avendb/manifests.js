// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The manifests Maia City's vault holds (game/code/sources/manifests.js), as the repo declares them for its AIP
 * (scripts/propose-manifests.mjs): the kernel, which every page holds, the dashboard, each game, the Universe and the
 * Studio. A manifest is a vault entry like any other, so a change to one goes in by AIP too, never by the seed.
 */
import { GAMES, gameTag } from '../../../game/games.js';

/** The kernel: what every page reads, whatever app it is: who may do what, the schemas and lenses that read records. */
export const KERNEL = {
	kind: 'manifest',
	id: 'kernel',
	title: 'Kernel',
	note: "What every page reads first: the vault's cap groups, schemas and lenses.",
	routes: ['*'],
	priority: 'high',
	parts: [{ query: { type: ['capgroup', 'schema', 'lens'] } }]
};

/** A game's manifest: the kernel, then its code and settings (tagged `game:<id>`), followed to the entries they name. */
export const gameManifest = (g) => ({
	kind: 'manifest',
	id: `game-${g.id}`,
	title: g.label,
	note: `What ${g.label} reads: its views, logic and settings, and the worlds and recipes they name.`,
	routes: [g.route, `/games/${g.id}/`],
	priority: 'medium',
	parts: [{ manifest: KERNEL.id }, { query: { tags: [gameTag(g.id)] }, follow: 2 }]
});

/** The dashboard: the kernel, then the games it lists. */
export const DASHBOARD = {
	kind: 'manifest',
	id: 'dashboard',
	title: 'Dashboard',
	note: 'What the dashboard reads: the games it lists.',
	routes: ['/app/'],
	priority: 'medium',
	parts: [{ manifest: KERNEL.id }, { query: { type: ['game'] } }, { query: { type: ['file'], tags: ['dashboard:cover'] } }]
};

/** The Maia Universe: the kernel, then its newest page of stories and posts. */
export const UNIVERSE = {
	kind: 'manifest',
	id: 'universe',
	title: 'Maia Universe',
	note: 'What the Universe shows first: its newest stories and posts, a page of them.',
	routes: ['/universe/', '/universe/*'],
	priority: 'medium',
	parts: [{ manifest: KERNEL.id }, { query: { type: ['story', 'post:inspire'] }, limit: 20 }]
};

/** The Studio: the kernel, then its newest timelines (cuts), followed to the clips and shots their records name. */
export const STUDIO = {
	kind: 'manifest',
	id: 'studio',
	title: 'Studio',
	note: 'What the Studio opens first: its newest timelines, each followed to the shots and clips it names.',
	routes: ['/app/studio/', '/app/studio/*'],
	priority: 'medium',
	parts: [{ manifest: KERNEL.id }, { query: { type: ['cut'] }, limit: 8, follow: 2 }]
};

/** Every manifest the repo declares. */
export const MANIFESTS = [KERNEL, DASHBOARD, UNIVERSE, STUDIO, ...GAMES.map(gameManifest)];
