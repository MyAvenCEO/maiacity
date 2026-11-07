// Every asset has its levels (play/SPEC.md §4.5, intent a2935147 c3): an asset with no levels of its own gets L1 and L2
// derived within lod.js's budgets and an L3 picture; one declaring `levels` gets its own; a second load of the same
// build makes no level again, each read from the device's cache by its key (./levels.js, ../cache.js `levelKeyOf`).
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createKept, levelKey, pictureKey } from './levels.js'
import { createLowering } from './lower.js'
import { prepare } from './prepare.js'
import { LEVELS, budgetOf, errorOf, smallestOf } from './lod.js'
import { levelValues, lodOf } from '../lodcard.js'
import { FRAMES } from './impostors.js'

const HASH = 'a'.repeat(64)

/** the device's cache, in memory: what was kept, and how often it was asked and written */
function memoryStore() {
	const kept = new Map<string, unknown>()
	const asked = { get: 0, put: 0 }
	return {
		kept,
		asked,
		getLevel: async (key: string) => (asked.get++, kept.get(key)),
		putLevel: async (key: string, value: unknown) => (asked.put++, kept.set(key, value), true)
	}
}

/** the renderer's pictures, standing in for the graphics card: what was photographed and what laid from kept frames */
function fakePictures(px = 8) {
	const done = { taken: 0, laid: 0 }
	return {
		done,
		px,
		add: () => (done.taken++, { page: 0, cell: 0, size: 1, foot: 0 }),
		put: (_level: unknown, frames: Uint8Array[]) => {
			if (frames.length !== FRAMES) throw new Error('refused')
			done.laid++
			return { page: 0, cell: 0, size: 1, foot: 0 }
		},
		read: async () => Array.from({ length: FRAMES }, (_, f) => new Uint8Array(px * px * 4).fill(f))
	}
}

/** a lowering that counts how often it simplifies */
function counting() {
	const real = createLowering({ worker: false })
	const n = { calls: 0, levels: 0 }
	return {
		n,
		lowering: {
			...real,
			lower: (source: any, plans: any[], later?: boolean, raw?: boolean) => (n.calls++, (n.levels += plans.length), real.lower(source, plans, later, raw))
		}
	}
}

/** a build's level as the renderer prepares it: a dense ball on a stem, its foot at y = 0 */
function built() {
	const root = new THREE.Group()
	const mat = new THREE.MeshStandardMaterial({ color: 0x6a8f3a })
	const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 96, 64), mat)
	ball.position.y = 1.2
	const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1, 24, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }))
	stem.position.y = 0.5
	root.add(ball, stem)
	return prepare(root, { of: (m: THREE.Material) => m })
}

/** the renderer's plans for a kind's derived levels (./index.js `planOf`) */
const plansOf = (from: any) =>
	[1, 2].map((L) => ({ L, plan: { budget: budgetOf(L, from.tris), most: budgetOf(L, Infinity), error: errorOf(L, from.radius), smallest: smallestOf(L, from.radius) } }))

describe('every asset has its levels', () => {
	it('an asset with no levels of its own: built once, its L1 and L2 derived within the budgets, its L3 a picture', async () => {
		const lod = lodOf({ params: [{ id: 'size', type: 'number', value: 1 }] })
		expect(lod).toEqual({ levels: 'derived' })
		// one build: its L0
		expect(levelValues(lod)).toEqual([{}])
		const source = built()
		expect(source.tris).toBeGreaterThan(10000)
		const store = memoryStore()
		const { n, lowering } = counting()
		const kept = createKept({ lowering, store })
		const [l1, l2] = await kept.lower(`${HASH}?size=1`, source, plansOf(source))
		expect(n.levels).toBe(2)
		expect(l1.tris).toBeLessThanOrEqual(budgetOf(1, source.tris, LEVELS))
		expect(l2.tris).toBeLessThanOrEqual(budgetOf(2, source.tris, LEVELS))
		expect(l2.tris).toBeLessThan(l1.tris)
		expect(l1.tris).toBeGreaterThan(0)
		const pictures = fakePictures()
		await kept.picture(`${HASH}?size=1`, source, pictures as any)
		expect(pictures.done.taken).toBe(1)
		expect(kept.counted).toMatchObject({ derived: 2, keptLevels: 0, taken: 1, keptPictures: 0 })
	})

	it('one declaring `levels` gets its own: each its recipe built with its values, nothing derived', () => {
		// as play writes it on the card from the recipe's module.exports.levels (play/api src/lod.ts)
		const lod = lodOf({ params: [{ id: 'detail', type: 'number', value: 1 }, { id: 'stage', type: 'number', value: 9 }], lod: { levels: 'declared', values: [{ detail: 0.25 }, { detail: 0.1, stage: 9 }] } })
		expect(lod.levels).toBe('declared')
		expect(levelValues(lod)).toEqual([{}, { detail: '0.25' }, { detail: '0.1', stage: '9' }])
		// a world's own details are for versions from before the contract only
		expect(levelValues(lod, [0.25, 0.1])).toEqual([{}, { detail: '0.25' }, { detail: '0.1', stage: '9' }])
		// one that names derived levels is built once
		expect(levelValues(lodOf({ lod: { levels: 'derived' } }))).toEqual([{}])
		// a version from before the contract that took a detail is read as it drew: declared at Sandbox 4's details
		const old = lodOf({ params: [{ id: 'detail', type: 'number', value: 1 }] })
		expect(old).toMatchObject({ levels: 'declared', old: true })
		expect(levelValues(old)).toEqual([{ detail: '1' }, { detail: '0.25' }, { detail: '0.1' }])
		expect(levelValues(old, [0.25, 0.1])).toEqual([{ detail: '0.25' }, { detail: '0.1' }])
	})

	it('a second load of the same build makes no level again: each comes from the device cache by its key', async () => {
		const store = memoryStore()
		const name = `${HASH}?size=1`
		// the first load: two levels made and a picture taken, each kept
		const first = counting()
		const a = createKept({ lowering: first.lowering, store })
		const source = built()
		const made = await a.lower(name, source, plansOf(source))
		const pa = fakePictures()
		await a.picture(name, source, pa as any)
		await new Promise((ok) => setTimeout(ok, 0))
		expect(store.kept.size).toBe(3)
		for (const { L, plan } of plansOf(source)) expect(store.kept.has(levelKey(name, L, plan))).toBe(true)
		expect(store.kept.has(pictureKey(name, pa.px))).toBe(true)

		// the second (another visit, another world on this device): the same build again, nothing simplified, nothing photographed
		const second = counting()
		const b = createKept({ lowering: second.lowering, store })
		const again = built()
		const read = await b.lower(name, again, plansOf(again))
		const pb = fakePictures()
		await b.picture(name, again, pb as any)
		expect(second.n.calls).toBe(0)
		expect(pb.done).toEqual({ taken: 0, laid: 1 })
		expect(b.counted).toMatchObject({ derived: 0, keptLevels: 2, taken: 0, keptPictures: 1 })
		expect(read.map((l: any) => l.tris)).toEqual(made.map((l: any) => l.tris))
		expect(read.every((l: any) => l.kept)).toBe(true)

		// another build, another key: made anew
		const third = counting()
		await createKept({ lowering: third.lowering, store }).lower(`${HASH}?size=2`, again, plansOf(again))
		expect(third.n.levels).toBe(2)
		// a level that doesn't fit its build (spoiled) is made again, not drawn
		const spoiled = memoryStore()
		for (const { L, plan } of plansOf(source)) spoiled.kept.set(levelKey(name, L, plan), { draws: [] })
		const fourth = counting()
		const c = createKept({ lowering: fourth.lowering, store: spoiled })
		await c.lower(name, source, plansOf(source))
		expect(fourth.n.levels).toBe(2)
		// a renderer that keeps nothing reads nothing
		const fifth = counting()
		await createKept({ lowering: fifth.lowering, store, keep: false }).lower(name, source, plansOf(source))
		expect(fifth.n.levels).toBe(2)
	})

	it('a level is keyed by its build, its level, its plan and its maker', () => {
		const plan = { budget: 100, most: 200, error: 0.01, smallest: 0.001 }
		const k = levelKey(`${HASH}?size=1`, 1, plan)
		expect(k).toMatch(/^[0-9a-f]{64}$/)
		expect(levelKey(`${HASH}?size=1`, 1, plan)).toBe(k)
		expect(levelKey(`${HASH}?size=2`, 1, plan)).not.toBe(k)
		expect(levelKey(`${HASH}?size=1`, 2, plan)).not.toBe(k)
		expect(levelKey(`${HASH}?size=1`, 1, { ...plan, budget: 99 })).not.toBe(k)
		expect(levelKey(`${HASH}?size=1`, 1, plan, 999)).not.toBe(k)
		expect(pictureKey(`${HASH}?size=1`, 128)).not.toBe(pictureKey(`${HASH}?size=1`, 80))
	})
})
