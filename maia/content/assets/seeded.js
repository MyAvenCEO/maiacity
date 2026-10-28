/** @param {number} seed */
export function seeded(seed) {
	let state = seed >>> 0 || 1;
	return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}
