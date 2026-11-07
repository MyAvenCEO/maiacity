// @ts-nocheck — plain JS
/*
 * WHAT A CARD SAYS OF ITS LEVELS — the one level-of-detail contract every asset is drawn by (play/SPEC.md §4.5, intent
 * a2935147): L0 its build; L1 and L2 its recipe's own where it declares them (`module.exports.levels = [{ values }, …]`,
 * the same recipe built with those values, which play reads off its source onto its card as `lod.values`, since nothing
 * runs a recipe outside the box), else derived from its build by simplifying it (./render/simplify.js); L3 its picture
 * (./render/impostors.js). The renderer (./render/index.js) asks this module which builds a kind's levels are, and knows
 * no parameter of any recipe by name.
 *
 * A version from before the contract names no `lod` and is read as derived (play/api src/lod.ts `lodOf`), and is drawn
 * as it was: one that takes a `detail` (every plant until now) was drawn at the details Sandbox 4 drew its forest at,
 * and is read here as declaring them (`OLD_DETAILS`), so its look, its cost and its builds' cache keys stay as they were.
 * A world that drew such a plant at its own details (`details`, Sandbox 2's village) still does, until the worlds draw
 * by the one selector (intent 6295a650); a version that declares its levels draws them whatever a world asks.
 */

/** the details a version from before the contract that takes a `detail` is built at for its levels, L0 first */
export const OLD_DETAILS = [1, 0.25, 0.1];
/** the parameter such a version took them by (only here: the renderer never names it) */
const OLD = 'detail';

/**
 * A card's levels: its own `lod` as play wrote it, or, a version from before the contract, derived (or, one that takes
 * a `detail`, declared at OLD_DETAILS, `old: true`).
 * @param {any} card a record's card (`record.card`) @returns {{ levels: 'declared' | 'derived', values?: Record<string, string | number>[], budgets?: number[], old?: boolean }}
 */
export function lodOf(card) {
	const l = card?.lod;
	if (l?.levels === 'declared' && Array.isArray(l.values) && l.values.length) return { levels: 'declared', values: l.values, ...(l.budgets ? { budgets: l.budgets } : {}) };
	if (l?.levels === 'derived' || l?.levels === 'declared') return { levels: 'derived', ...(l.budgets ? { budgets: l.budgets } : {}) };
	if (card?.params?.some?.((p) => p?.id === OLD)) return { levels: 'declared', old: true, values: OLD_DETAILS.slice(1).map((d) => ({ [OLD]: d })) };
	return { levels: 'derived' };
}

/**
 * The values each of a kind's built levels is built with, over the values it is asked with, L0 first: one entry (its
 * build) where its L1 and L2 are derived, or one for each level its recipe declares. `details`: a world's own details
 * for a version from before the contract (`OLD_DETAILS`' place), else nothing.
 * @param {ReturnType<typeof lodOf> | undefined} lod @param {number[]} [details]
 * @returns {Record<string, string>[]}
 */
export function levelValues(lod, details) {
	if (lod?.levels !== 'declared') return [{}];
	if (lod.old) return (details ?? OLD_DETAILS).map((d) => ({ [OLD]: String(d) }));
	return [{}, ...lod.values.map((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])))];
}
