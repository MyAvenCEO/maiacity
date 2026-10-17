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
 *
 * Where a screen stands (data.slot): 'panel' gives it a tab of its own beside Activity and Prices; any other slot is
 * one of the page's panels, which the screen takes the place of (SLOTS). The page's built-in panel stays one tap
 * away, and a MIP that takes the card out brings it back. A screen never stands where a person decides (the Policies
 * and World editors, Proposals, the model picker), so no screen can dress up a choice.
 *
 * What a screen in a slot is handed besides the valley: `slot` (which), `picked` (the aven open on the page), and:
 *   board     board: [{ id, name, colour, alive, hearts, health, diedOn, grows, stock?, flow? }] (ranked, richest first),
 *             coop: { hearts, from: { fields, levels, nights }, flow? } | null
 *   activity  decisions: [{ n, day, t, kind, id?, name?, colour?, source?, changes }] (the last 200, newest first),
 *             queue: [{ id, name, colour, thinking, by, waited, age }], calls: { asked, answered, pending, failed }
 *   prices    series: { good: [{ t, price }] } (at most ~300 points a good), market: { good: { price, avg, units } }
 *   stats     stats: [the daily rows: { day, price, avg, units, deals, hearts, total, minted, decayed, rotted, harvest,
 *             stock, alive, ate, short, health, body, dry, rain }], series (as for prices)
 *   avens     days: [{ day, hearts, health, water, food, dry }] (the picked aven's), feed: [its activity, newest first]
 */

import { cardOfEntry, codeAt } from '../code/index.js';

/** the valley's own screens, each a view card (its code entry by the one loader); a config's card with the same id replaces it */
export const defaultViews = () => [cardOfEntry(codeAt('views/view-wants'))];

/** the slots a screen may take, and their names in words */
export const SLOTS = ['panel', 'board', 'activity', 'prices', 'avens', 'stats'];
export const SLOT_NAMES = { panel: 'a tab of its own', board: 'the Board', activity: 'Activity', prices: 'Prices', avens: 'the Avens page', stats: 'the Stats page' };

/** the view cards a config shows, in order: its own, and every default it does not replace */
export function viewsOf(cards) {
	const own = (cards ?? []).filter((c) => c?.kind === 'view');
	const defaults = defaultViews();
	return [...defaults.map((d) => own.find((c) => c.id === d.id) ?? d), ...own.filter((c) => !defaults.some((d) => d.id === c.id))];
}

/** the screen standing in each of the page's panels, by slot (the config's last card wins when two take one) */
export function slotsOf(cards) {
	const out = {};
	for (const v of viewsOf(cards)) if (v.data?.slot && v.data.slot !== 'panel') out[v.data.slot] = v;
	return out;
}
