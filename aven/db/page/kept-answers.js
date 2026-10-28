/** The last answer each mounted read took, by device and query, kept while the page is open, so that a view coming
 * back paints what it showed before at once and its fresh read lands on top (Samuel 2026-10-28: the rooms were gone
 * again the moment he switched views, and waited for every read anew while the phone caught up). Only answers that
 * hold something (`ok`), never a refusal. Kept per device object: a lock, or another account, opens another device,
 * which holds none of these. At most `most` per device, the one read longest ago going first.
 * @param {number} [most] */
export function keptAnswers(most = 512) {
	/** @type {WeakMap<object, Map<string, any>>} */
	const byDevice = new WeakMap();
	return {
		/** @param {any} device @param {string} key */
		get(device, key) {
			const held = device && typeof device === 'object' ? byDevice.get(device) : undefined;
			if (!held?.has(key)) return undefined;
			const answer = held.get(key);
			held.delete(key);
			held.set(key, answer);
			return answer;
		},
		/** @param {any} device @param {string} key @param {any} answer */
		keep(device, key, answer) {
			if (!device || typeof device !== 'object' || answer?.ok === undefined || answer.ok === null) return;
			let held = byDevice.get(device);
			if (!held) byDevice.set(device, (held = new Map()));
			held.delete(key);
			held.set(key, answer);
			for (const old of held.keys()) {
				if (held.size <= most) break;
				held.delete(old);
			}
		}
	};
}

/** The entries op `now` names where it differs from op `before` in those alone, both naming them in `entries`: the
 *  rows of these hold for it as they held for `before`. Null for any other change. @param {any} before @param {any} now */
export function stillNamed(before, now) {
	if (!Array.isArray(before?.entries) || !Array.isArray(now?.entries)) return null;
	const rest = (/** @type {any} */ op) => JSON.stringify({ ...op, entries: null });
	return rest(before) === rest(now) ? new Set(now.entries) : null;
}
