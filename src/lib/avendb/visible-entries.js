// @ts-nocheck — plain JS
/** Collect mounted rows that intersect the viewport, with the selected entry first. Separate row tokens keep
 * shared preview dependencies wanted until the last visible row releases them. Scheduling hints only. */
export function visibleEntries(changed) {
	const rows = new Map();
	let selected = [];
	const entries = () => [...new Set([...selected, ...[...rows.values()].flat()])]
		.filter((id) => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id)).slice(0, 512);
	return {
		entries,
		show(token, ids) { rows.set(token, ids); changed(entries()); },
		hide(token) { if (rows.delete(token)) changed(entries()); },
		select(ids) { selected = ids; changed(entries()); },
		clear() { selected = []; rows.clear(); changed([]); }
	};
}
