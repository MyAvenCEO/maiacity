// @ts-nocheck — plain JS, kept loose on purpose
// AIPs, Aven Improvement Proposals (Samuel 2026-10-17; /mnt/project-files/game-caps/plan.md): one proposal flow for
// every game, idea → propose → archive (applied | rejected), each a readable text plus the configs it changes. Until
// they live in avenDB, the Proposals app reads today's MIPs where they are kept and shows each the AIP way: Sandbox 7's
// from the economy API, MaiaCity V1's from its one game. Each source turns its MIPs into the same shape here.
import { describe, signaturesOf } from '../../../game/maiacity-v1/engine.js';

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
		game: 'sandbox-8',
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
		game: 'maiacity-v1',
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

/** every AIP of the sources, the newest first */
export const allOf = (s7, view) =>
	[...(s7 ?? []).map(fromSandbox7), ...(view?.mips ?? []).map((m) => fromV1(view, m))].sort((a, b) => (b.decided || b.created) - (a.decided || a.created));

export const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
