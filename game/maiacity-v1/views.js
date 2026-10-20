// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1's screens as view cards (Samuel, 2026-10-13): html views (game/code/views.js) the view host shows
 * (src/lib/sandbox/ViewHost.svelte: no origin, no network, no reach into the page, its script in a worker) and hands
 * the game as its data and its MCP Apps tool result.
 * A MIP puts a screen in (`views`, a card with an id already there replaces it) or takes it out (`removeViews`),
 * beside the settings it changes, and both apply when it has its signatures. A screen only shows: every move stays a
 * button of the page, so the game plays exactly as before.
 *
 * Where a screen stands (data.slot): 'panel' gives it a tool of its own; any other slot is one of the page's panels.
 * In a panel that only shows (COOPs, Ledger, Rules) the screen takes the panel's place; in a panel with moves (You,
 * Mint, Invest, Swap) it stands on top and the panel's own buttons stay below it. Either way the page's built-in
 * screen is one tap away, and a MIP that takes the card out brings it back.
 *
 * What a screen is handed (structuredContent), every few seconds while it is open:
 *   { date, month, seat, minds: [{ id, label, colour }], hearts: { token: worth of 1 in HEARTS, shown as ❤︎ },
 *     players: [{ seat, name, wallet: { HEARTS, MAIA, TRIBE, VILLAGE }, worth, arrears }],
 *     coops: [{ id, name, mind, treasury: {...}, worth, assets: [{ id, name, kind }] }],
 *     pool: { MAIA, TRIBE, VILLAGE }, poolWorth, settings: { key: number },
 *     rents: [{ what, from, to, token, monthly, weekly, owed }], names: { who: name },
 *     ledger: [{ id, vm, kind, from, to, token, amount, note }] (the last 80, newest first) }
 */

import { cardOfEntry, codeAt } from '../code/index.js';

/** the slots a screen may take, and their names in words */
export const SLOTS = ['panel', 'you', 'mint', 'invest', 'swap', 'coops', 'ledger', 'rules'];
export const SLOT_NAMES = { panel: 'a tool of its own', you: 'the player card', mint: 'Mint', invest: 'Invest', swap: 'Swap', coops: 'COOPs', ledger: 'the Ledger', rules: 'Rules' };
/** the panels that only show, which a screen replaces; in the others it stands over the moves */
export const REPLACES = ['coops', 'ledger', 'rules'];

/** the game's own screens (their code entries by the one loader); a MIP's view card with the same id replaces one */
export const defaultViews = () => [cardOfEntry(codeAt('views/view-holders'))];

/** the screens a game shows, in order: the defaults (or the MIPs' versions of them), then the MIPs' own */
export function viewsOf(s) {
	const own = s?.views ?? [];
	const defaults = defaultViews();
	return [...defaults.map((d) => own.find((v) => v.id === d.id) ?? d), ...own.filter((v) => !defaults.some((d) => d.id === v.id))];
}

/** the screen standing in each panel, by slot (the last MIP's wins when two take one) */
export function slotsOf(s) {
	const out = {};
	for (const v of viewsOf(s)) if (v.data?.slot && v.data.slot !== 'panel') out[v.data.slot] = v;
	return out;
}
