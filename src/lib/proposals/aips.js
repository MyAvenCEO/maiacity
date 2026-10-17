// @ts-nocheck — plain JS, kept loose on purpose
// AIPs, Aven Improvement Proposals (Samuel 2026-10-17; /mnt/project-files/game-caps/plan.md): one proposal flow for
// every vault and every game, idea → propose → archive (applied | rejected), each a readable text plus the changes it
// makes. The Proposals app reads them from three sources and each turns its own into the same shape here: avenDB's
// AIPs (the `aips` read, every vault this tab's device holds), and, until games keep their configs in avenDB, today's
// MIPs where they are kept: Sandbox 7's from the economy API, MaiaCity V1's from its one game.
import { describe, signaturesOf } from '../../../game/maiacity-v1/engine.js';
import { nameOf } from '$lib/avendb/vaults.js';

/** the games that have proposals, by their route's id: the game filter's names */
export const GAMES = {
	'sandbox-8': { label: 'Sandbox 7', href: '/app/games/sandbox-8/' },
	'maiacity-v1': { label: 'MaiaCity V1', href: '/app/maiacity-v1/' }
};

/** the stages, in the app's tab order */
export const STAGES = [
	{ id: 'idea', label: 'Ideas' },
	{ id: 'proposed', label: 'Proposed' },
	{ id: 'archived', label: 'Archive' }
];

/** a MIP's status as an AIP's stage and outcome */
function staged(status) {
	if (status === 'open') return { stage: 'proposed', outcome: null, why: null };
	if (status === 'accepted') return { stage: 'archived', outcome: 'applied', why: null };
	return { stage: 'archived', outcome: 'rejected', why: status === 'withdrawn' ? 'withdrawn' : 'declined' };
}

/** a Sandbox 7 MIP (api/src/economy.js) as an AIP */
export function fromSandbox7(m) {
	const changes = m.world?.diff?.length
		? m.world.diff
		: [...(m.cards ?? []).map((c) => `card ${c.name || c.id}`), ...(m.remove ?? []).map((id) => `card ${id} taken out`)];
	return {
		key: `s7-${m.number}`,
		source: 'sandbox-8',
		game: 'sandbox-8',
		where: 'Sandbox 7',
		label: `MIP-${m.number}`,
		was: `MIP-${m.number}`,
		title: m.title,
		text: m.description ?? '',
		changes,
		...staged(m.status),
		author: m.author_name ?? m.author ?? 'someone',
		via: m.via,
		created: m.created ? Date.parse(m.created) : 0,
		decided: m.decided ? Date.parse(m.decided) : 0,
		signed: m.status === 'accepted' ? 1 : 0,
		needs: 1,
		policy: 'the admin accepts',
		prs: m.prs ?? [],
		mip: m
	};
}

/** a MaiaCity V1 MIP (game/maiacity-v1/engine.js, inside the game) as an AIP */
export function fromV1(view, m) {
	const said = describe(view, m);
	return {
		key: `v1-${m.number}`,
		source: 'maiacity-v1',
		game: 'maiacity-v1',
		where: 'MaiaCity V1',
		label: `MIP #${m.number}`,
		was: `MIP #${m.number}`,
		title: m.title,
		text: m.description ?? '',
		changes: said ? said.split('; ') : [],
		...staged(m.status),
		author: view.players[m.by]?.name ?? `seat ${m.by}`,
		via: m.via,
		created: m.at ?? 0,
		decided: m.decided ?? 0,
		signed: m.signatures.length,
		needs: signaturesOf(view),
		policy: `${signaturesOf(view)} of the 2 players sign`,
		prs: [],
		mip: m
	};
}

/** the game an avenDB AIP is for, by its `game:<id>` tag, if it names one */
const gameTag = (tags) => (tags ?? []).find((t) => t.startsWith('game:'))?.slice(5) ?? null;

/**
 * An avenDB AIP, as the `aips` read lists it ($lib/avendb/hitl.js `Aip`), in the app's shape. A bare proposal (a line
 * no AIP names yet) is an idea of its own, keyed by its line. `world` is the device's, for the vaults' names.
 */
export function fromAvendb(a, world) {
	const vault = world?.vaults.find((v) => v.id === a.vault);
	const author = a.author && world?.vaults.find((v) => v.id === a.author);
	const game = gameTag(a.tags);
	const at = ms(Math.max(0, ...a.reviews.map((r) => r.at ?? 0)));
	return {
		key: a.entry ?? `line:${a.lines[0]?.entry}:${a.lines[0]?.line}`,
		source: 'avendb',
		game,
		vault: a.vault,
		where: GAMES[game]?.label ?? nameOf(vault),
		label: a.label ?? (a.bare ? 'Proposal' : `Idea ${a.key}`),
		was: a.was,
		title: a.title || (a.bare ? `A change to ${a.lines[0]?.title ?? a.lines[0]?.name ?? 'an entry'}` : 'Untitled'),
		text: a.note ?? '',
		changes: a.summary ?? [],
		stage: a.stage,
		outcome: a.outcome,
		why: a.why,
		author: author ? nameOf(author) : 'someone',
		via: null,
		created: 0,
		decided: at,
		signed: a.signatures?.have ?? 0,
		needs: a.signatures?.need ?? 1,
		policy: a.signatures?.of === 'owners' ? `${a.signatures.need} of ${nameOf(vault)}'s owners accept` : 'its vault accepts',
		prs: [],
		aip: a
	};
}

/** every AIP of the sources, the newest first (avenDB's in the order the device lists them, after) */
export const allOf = (s7, view, avendb = [], world = null) => [
	...avendb.map((a) => fromAvendb(a, world)),
	...[...(s7 ?? []).map(fromSandbox7), ...(view?.mips ?? []).map((m) => fromV1(view, m))].sort((a, b) => (b.decided || b.created) - (a.decided || a.created))
];

/** a time in ms (an avenDB time in seconds is taken as such) */
export const ms = (t) => (t && t < 1e12 ? t * 1000 : t);
export const when = (t) => (t ? new Date(ms(t)).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
