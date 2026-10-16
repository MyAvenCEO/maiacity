// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The valley's screens as view cards (Samuel, 2026-10-13): each one an html view (game/genui/views.js) the view host
 * shows (src/lib/sandbox/ViewHost.svelte: no origin, no network, no reach into the page, its script in a worker) and
 * hands the valley as its data and its MCP Apps tool result, again as the valley moves on. A config may carry its own view cards (kind 'view'); a card with a
 * default's id replaces that default, so a MIP changes a screen the way it changes a rule, in the same proposal.
 *
 * What a view is handed (structuredContent), every few seconds while it is open:
 *   { day, time, goods: [{ id, label, colour, need }],
 *     avens: [{ id, name, colour, alive, hearts, health, grows: [good], last: { good: units short last night },
 *               goods: { good: { has, need, buy } } }],
 *     market: { good: { price } }, values: { key: number } }
 * What it may tell the page: ui/update-model-context with structuredContent { select: avenId } opens that aven.
 */

import { cardOfEntry, codeAt } from '../code/index.js';

/** the valley's own screens, each a view card (its code in code/views/); a config's card with the same id replaces it */
export const DEFAULT_VIEWS = [cardOfEntry(codeAt('views/view-wants'))];

/** the view cards a config shows, in order: its own, and every default it does not replace */
export function viewsOf(cards) {
	const own = (cards ?? []).filter((c) => c?.kind === 'view');
	return [...DEFAULT_VIEWS.map((d) => own.find((c) => c.id === d.id) ?? d), ...own.filter((c) => !DEFAULT_VIEWS.some((d) => d.id === c.id))];
}
