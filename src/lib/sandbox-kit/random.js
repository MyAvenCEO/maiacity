/**
 * SEEDED RANDOM NUMBERS — the one place the worlds get chance that is the same every time: the same seed, the same
 * numbers, in every browser, on every device and on film, so everything stands where it stood for everyone.
 *
 *   seededRandom(seed)   the worlds' own (mulberry32): small, fast and well spread; use it for anything new
 *   seededLcg(seed)      the plain linear congruential one a few worlds were first laid out with (MaiaCity V1's van,
 *                        Sandbox 6's village), kept so nothing of theirs moves
 *   seededMinStd(seed)   the minimal standard one the universe's stars are placed with, kept so no star moves
 *
 * Each hands back a function giving the next number, 0 ≤ x < 1 (seededMinStd: 0 ≤ x ≤ 1). The recipes keep their own
 * (their code is frozen into the vault by its hash), and so does the asset box's engine.
 */

/**
 * The worlds' seeded random numbers (mulberry32).
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * The linear congruential numbers a few worlds were first laid out with (Numerical Recipes' constants).
 * @param {number} seed
 * @returns {() => number}
 */
export function seededLcg(seed) {
	let s = seed >>> 0;
	return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/**
 * The minimal standard numbers (Park and Miller) the universe's stars are placed with.
 * @param {number} seed
 * @returns {() => number}
 */
export function seededMinStd(seed) {
	return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
