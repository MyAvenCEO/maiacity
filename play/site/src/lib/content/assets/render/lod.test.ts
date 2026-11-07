// The one selector (./lod.js): a level chosen by size on screen, never by distance, held HOLD past each threshold
// (play/SPEC.md §4.5, intent a2935147 c2).
import { describe, expect, it } from 'vitest'
import { HOLD, LEVELS, choose, sizeOn, thresholdsOf } from './lod.js'

/** the levels a thing is drawn at as its size on screen walks through `sizes`, each step remembering the last */
function walk(sizes: number[], thresholds: number[]) {
	let was = -1
	return sizes.map((size) => (was = choose(size, thresholds, was).level))
}

describe('the selector', () => {
	// a kind heavy enough that its picture takes over at its last threshold (./lod.js HEAVY)
	const T = thresholdsOf(3, 1e6)

	it('has the thresholds of lod.js, finest first', () => {
		expect(T).toEqual(LEVELS)
	})

	it('picks L0, L1, L2 and L3 in turn as a thing looks smaller, and back again as it looks bigger', () => {
		const down = Array.from({ length: 80 }, (_, i) => 2 * 0.92 ** i)
		const seen = walk(down, T)
		expect([...new Set(seen)]).toEqual([0, 1, 2, 3])
		// never back up while it shrinks
		for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
		const up = down.slice().reverse()
		const back = walk(up, T)
		expect([...new Set(back)]).toEqual([3, 2, 1, 0])
	})

	it('switches only HOLD past a threshold, either way', () => {
		for (const [L, t] of T.entries()) {
			// shrinking past threshold t (from level L to L + 1): held just under it, switched only HOLD under
			expect(choose(t * (1 - HOLD / 2), T, L).level).toBe(L)
			expect(choose(t * (1 - HOLD * 1.5), T, L).level).toBe(L + 1)
			// growing past it (from L + 1 to L): held just over it, switched only HOLD over
			expect(choose(t * (1 + HOLD / 2), T, L + 1).level).toBe(L + 1)
			expect(choose(t * (1 + HOLD * 1.5), T, L + 1).level).toBe(L)
			// with nothing to hold to, the line itself
			expect(choose(t * 1.001, T).level).toBe(L)
			expect(choose(t * 0.999, T).level).toBe(L + 1)
		}
	})

	it('picks the same for a cup and a tree of the same size on screen, however far each is', () => {
		const tanHalf = Math.tan((50 / 2) * (Math.PI / 180))
		const cup = 0.05, tree = 6
		for (const d of [0.1, 0.3, 1, 3, 10, 30]) {
			const sCup = sizeOn(cup, d, tanHalf)
			// the tree as far off as makes it look as big
			const sTree = sizeOn(tree, (d * tree) / cup, tanHalf)
			expect(sTree).toBeCloseTo(sCup, 9)
			expect(choose(sTree, T).level).toBe(choose(sCup, T).level)
		}
		// and walked through the same sizes, the same levels at every step
		const dCup = Array.from({ length: 60 }, (_, i) => 0.02 * 1.12 ** i)
		expect(walk(dCup.map((d) => sizeOn(tree, (d * tree) / cup, tanHalf)), T)).toEqual(walk(dCup.map((d) => sizeOn(cup, d, tanHalf)), T))
	})
})
