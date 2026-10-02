/**
 * The animals of the land outside: hens scratching in their runs and out
 * under the trees, goats and sheep browsing the forest, geese along the
 * stream, frogs by the ponds, bees round their hives, fish in the ponds and
 * the tanks. Every one is a rigged actor ($lib/actors/animals): near the eye
 * it moves every bone as its kind does — walks, pecks, grazes, hops, flies,
 * swims — and further off the same animal stands in for itself, a hundred of
 * them a draw call ($lib/actors/crowd). Every animal wanders on its own: it
 * walks, turns, stops to peck or graze, and walks on, always inside its own
 * patch of ground.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { bee, frog, goat, goose, hen, pondFish, sheep } from '$lib/actors/animals'
import { crowd, type Eye } from '$lib/actors/crowd'
import type { Cast, Clip } from '$lib/actors/rig'
import { seeded } from './plants'

export type { Eye }

type Part = { geo: THREE.BufferGeometry; color: string; at: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] }

/** Merges a thing's parts into one geometry, each part's colour written into its vertices. */
function model(parts: Part[]): THREE.BufferGeometry {
	const geos = parts.map(({ geo, color, at, rot = [0, 0, 0], scale = [1, 1, 1] }) => {
		const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry
		g.deleteAttribute('uv')
		g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)))
		const c = new THREE.Color(color)
		const n = g.attributes.position!.count
		g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]!), 3))
		return g
	})
	return mergeGeometries(geos)!
}

const block = new THREE.BoxGeometry(1, 1, 1)

export type Patch = { x: number; z: number; r: number; n: number }

type Kind = 'hen' | 'goat' | 'goose' | 'frog' | 'sheep'
type Spec = {
	make: (coat: string) => Cast
	coats: string[]
	speed: number
	turn: number
	stop: [number, number]
	walk: [number, number]
	/** its clip walking, and those it plays standing (one each, by the animal) */
	moving: string
	still: string[]
	/** how near the eye it is rigged, and how many of the kind at most */
	near: number
	max: number
}
const KINDS: Record<Kind, Spec> = {
	hen: { make: hen, coats: ['#f4efe4', '#b8703a', '#3b3430', '#d9a066'], speed: 0.45, turn: 3, stop: [0.6, 3], walk: [0.5, 2], moving: 'walk', still: ['peck', 'peck', 'idle'], near: 35, max: 20 },
	goat: { make: goat, coats: ['#f1ede4', '#8a5a36', '#3b332e'], speed: 0.6, turn: 1.4, stop: [2, 7], walk: [1, 4], moving: 'walk', still: ['graze', 'graze', 'idle'], near: 45, max: 16 },
	goose: { make: goose, coats: ['#f7f5ef', '#f7f5ef', '#9aa0a0'], speed: 0.4, turn: 1.2, stop: [1, 4], walk: [1.5, 5], moving: 'walk', still: ['graze', 'idle', 'graze'], near: 40, max: 18 },
	// a frog sits still a long while, then hops once or twice
	frog: { make: frog, coats: ['#4f7a2e', '#6b8f3a', '#3d5f2a'], speed: 1.3, turn: 4, stop: [3, 10], walk: [0.25, 0.6], moving: 'hop', still: ['idle', 'idle', 'croak'], near: 15, max: 14 },
	// sheep graze the forest between the domes in flocks, a black one among them
	sheep: { make: (wool) => sheep(wool), coats: ['#ece6d8', '#e4dccb', '#3a3530'], speed: 0.5, turn: 1.2, stop: [3, 9], walk: [1, 3], moving: 'walk', still: ['graze', 'graze', 'idle'], near: 45, max: 16 }
}

type Animal = { x: number; z: number; yaw: number; home: Patch; walking: boolean; until: number; coat: number; phase: number }

/**
 * A kind of animal spread over its patches of ground. `update(t)` moves every
 * one of them; those near `eye` move every bone.
 */
export function herd(kind: Kind, patches: Patch[], seed: number, eye?: Eye): { object: THREE.Group; update: (t: number) => void; where: () => { x: number; z: number }[] } {
	const spec = KINDS[kind]
	let r = seeded(seed)
	let animals: Animal[] = []
	/** every animal where it starts, from the seed alone */
	const born = () => {
		r = seeded(seed)
		animals = []
		for (const home of patches)
			for (let i = 0; i < home.n; i++) {
				const a = r() * Math.PI * 2, d = Math.sqrt(r()) * home.r * 0.8
				animals.push({ x: home.x + Math.cos(a) * d, z: home.z + Math.sin(a) * d, yaw: r() * Math.PI * 2, home, walking: r() < 0.5, until: r() * 3, coat: Math.floor(r() * spec.coats.length), phase: r() * 10 })
			}
	}
	born()
	let clips: Record<string, Clip> = {}
	const flock = crowd(
		(c) => {
			const cast = spec.make(spec.coats[c]!)
			clips = cast.clips
			return cast
		},
		spec.coats.map((_, c) => animals.filter((an) => an.coat === c).length),
		{ near: spec.near, max: spec.max }
	)
	/* They wander in fixed steps of 1/60 s counted from the world's time 0, so where each one is at time t depends on
	   t alone — never on how often frames came — and a film shot renders the same flock every time. Asked for an
	   earlier time, they start again from the seed and walk up to it. */
	const STEP = 60
	let steps = 0
	const update = (t: number) => {
		const want = Math.max(0, Math.floor(t * STEP + 1e-6))
		if (want < steps) {
			born()
			steps = 0
		}
		while (steps < want) {
			steps++
			walk(steps / STEP, 1 / STEP)
		}
		pose(t)
	}
	const walk = (t: number, dt: number) => {
		for (const an of animals) {
			if (t > an.until) {
				an.walking = !an.walking
				const [lo, hi] = an.walking ? spec.walk : spec.stop
				an.until = t + lo + r() * (hi - lo)
				if (an.walking) an.yaw += (r() - 0.5) * 2.4
			}
			if (an.walking) {
				// wander, and turn back toward the middle of the patch near its edge
				const dx = an.home.x - an.x, dz = an.home.z - an.z
				const off = Math.hypot(dx, dz)
				an.yaw += (Math.sin(t * 0.9 + an.phase) * 0.5) * spec.turn * dt
				if (off > an.home.r * 0.75) {
					const want = Math.atan2(dx, dz)
					const diff = Math.atan2(Math.sin(want - an.yaw), Math.cos(want - an.yaw))
					an.yaw += Math.sign(diff) * Math.min(Math.abs(diff), spec.turn * dt * 1.5)
				}
				an.x += Math.sin(an.yaw) * spec.speed * dt
				an.z += Math.cos(an.yaw) * spec.speed * dt
			}
		}
	}
	const pose = (t: number) => {
		const at = eye?.()
		flock.begin()
		for (const an of animals) {
			const d2 = at ? (an.x - at.x) ** 2 + (an.z - at.z) ** 2 : Infinity
			const clip = clips[an.walking ? spec.moving : spec.still[Math.floor(an.phase * 3) % spec.still.length]!]
			// from afar, a hen pecks and a goat grazes as a whole when it stops; walking, each bobs or waddles
			const pause = !an.walking
			const pitch = pause ? (kind === 'hen' ? Math.max(0, Math.sin(t * 5 + an.phase)) * 0.55 : kind === 'goat' || kind === 'sheep' ? 0.25 : 0) : 0
			const roll = an.walking && kind === 'goose' ? Math.sin(t * 7 + an.phase) * 0.08 : 0
			const bob = !an.walking ? 0 : kind === 'frog' ? Math.abs(Math.sin(t * 9 + an.phase)) * 0.14 : Math.abs(Math.sin(t * (kind === 'hen' ? 12 : 6) + an.phase)) * (kind === 'goat' || kind === 'sheep' ? 0.03 : 0.02)
			flock.put(an.coat, an.x, bob, an.z, an.yaw, d2, () => clip?.(t + an.phase) ?? {}, pitch, roll)
		}
		flock.end()
	}
	update(0)
	return { object: flock.object, update, where: () => animals }
}

/**
 * Bee hives: painted wooden boxes stacked on a stand under a tin roof, and
 * their bees, a dozen and a half each, looping round the hive and out to the
 * flowers and back — rigged near the eye, striped specks further off.
 */
export function apiary(spots: { x: number; z: number; rot: number }[], seed: number, eye?: Eye): { object: THREE.Group; update: (t: number) => void; where: () => { x: number; z: number }[] } {
	const r = seeded(seed)
	const object = new THREE.Group()
	const paints = ['#f2e6c8', '#e8c46a', '#9fb7a0', '#d9a07a', '#b9c7d9']
	const hive = (paint: string) =>
		model([
			{ geo: block, color: '#6b4f36', at: [0, 0.2, 0], scale: [0.62, 0.06, 0.62] },
			...([-1, 1] as const).flatMap((sx) => ([-1, 1] as const).map((sz) => ({ geo: block, color: '#6b4f36', at: [sx * 0.24, 0.1, sz * 0.24] as [number, number, number], scale: [0.05, 0.2, 0.05] as [number, number, number] }))),
			{ geo: block, color: paint, at: [0, 0.4, 0], scale: [0.5, 0.34, 0.42] },
			{ geo: block, color: paint, at: [0, 0.75, 0], scale: [0.5, 0.34, 0.42] },
			{ geo: block, color: '#e8e4da', at: [0, 0.94, 0], scale: [0.5, 0.04, 0.42] },
			{ geo: block, color: '#9aa2a8', at: [0, 1.0, 0], scale: [0.58, 0.06, 0.5] },
			{ geo: block, color: '#2a2622', at: [0, 0.26, 0.215], scale: [0.3, 0.03, 0.01] }
		])
	const models = paints.map(hive)
	const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })
	spots.forEach((s, i) => {
		const m = new THREE.Mesh(models[i % models.length]!, mat)
		m.position.set(s.x, 0, s.z)
		m.rotation.y = s.rot
		m.castShadow = true
		object.add(m)
	})
	const PER = 18
	const paths = spots.flatMap((s) => Array.from({ length: PER }, () => ({ s, rad: 0.4 + r() * 2.2, h: 0.4 + r() * 1.4, speed: (0.8 + r() * 1.6) * (r() < 0.5 ? -1 : 1), phase: r() * 10, wob: r() * 3 })))
	// a bee from afar: a striped body and its wings, a few dozen vertices
	const speck = model([
		{ geo: new THREE.SphereGeometry(1, 6, 4), color: '#e8b23a', at: [0, 0.0112, -0.004], scale: [0.0026, 0.0024, 0.0048] },
		{ geo: new THREE.SphereGeometry(1, 6, 4), color: '#2a2218', at: [0, 0.012, 0.0015], scale: [0.0024, 0.0024, 0.003] },
		{ geo: block, color: '#e6ecf2', at: [0, 0.0148, -0.0012], scale: [0.013, 0.0003, 0.0035] }
	])
	let clips: Record<string, Clip> = {}
	const swarm = crowd(
		() => {
			const cast = bee()
			clips = cast.clips
			return cast
		},
		[paths.length],
		{ near: 6, max: 30, scale: 1.6, lift: 0.012, shadows: false, farShape: () => ({ geometry: speck, material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) }) }
	)
	object.add(swarm.object)
	const update = (t: number) => {
		const at = eye?.()
		swarm.begin()
		for (const b of paths) {
			const a = t * b.speed + b.phase
			const rr = b.rad * (0.6 + 0.4 * Math.sin(t * 0.7 + b.wob))
			const x = b.s.x + Math.sin(a) * rr, z = b.s.z + Math.cos(a) * rr
			// facing the way it flies round
			const sg = Math.sign(b.speed), yaw = Math.atan2(Math.cos(a) * sg, -Math.sin(a) * sg)
			const d2 = at ? (x - at.x) ** 2 + (z - at.z) ** 2 : Infinity
			swarm.put(0, x, b.h + Math.sin(t * 3 + b.wob) * 0.15, z, yaw, d2, () => clips.fly?.(t + b.phase) ?? {})
		}
		swarm.end()
	}
	update(0)
	return { object, update, where: () => spots }
}

/**
 * Fish: carp and tilapia in the ponds and the aquaponics tanks, circling and
 * turning, and a few working their way up and down a stream, just under the
 * surface — rigged near the eye, their bodies waving them on.
 */
export function fishes(pools: { x: number; z: number; r: number; y: number; n: number }[], streams: { line: { x: number; z: number }[]; y: number; n: number }[], seed: number, eye?: Eye): { object: THREE.Group; update: (t: number) => void } {
	const r = seeded(seed)
	const COATS = 4
	type F = { pool?: (typeof pools)[number]; line?: (typeof streams)[number]; rad: number; speed: number; phase: number; coat: number }
	const fish: F[] = []
	for (const pool of pools) for (let i = 0; i < pool.n; i++) fish.push({ pool, rad: pool.r * (0.3 + r() * 0.6), speed: (0.3 + r() * 0.5) * (r() < 0.5 ? -1 : 1), phase: r() * 10, coat: Math.floor(r() * COATS) })
	for (const line of streams) for (let i = 0; i < line.n; i++) fish.push({ line, rad: 0, speed: 0.02 + r() * 0.03, phase: r() * 10, coat: Math.floor(r() * COATS) })
	let clips: Record<string, Clip> = {}
	const school = crowd(
		(c) => {
			const cast = pondFish(c)
			clips = cast.clips
			return cast
		},
		Array.from({ length: COATS }, (_, c) => fish.filter((f) => f.coat === c).length),
		{ near: 18, max: 20 }
	)
	const update = (t: number) => {
		const at = eye?.()
		school.begin()
		for (const f of fish) {
			let x = 0, z = 0, y = 0, yaw = 0
			if (f.pool) {
				// round the pool, wandering in and out
				const a = t * f.speed + f.phase
				const rr = f.rad * (0.8 + 0.2 * Math.sin(t * 0.3 + f.phase))
				x = f.pool.x + Math.sin(a) * rr
				z = f.pool.z + Math.cos(a) * rr
				y = f.pool.y
				yaw = a + (f.speed > 0 ? Math.PI / 2 : -Math.PI / 2)
			} else if (f.line) {
				// up and down the stream, slowly
				const L = f.line.line
				const u = (Math.sin(t * f.speed + f.phase) * 0.5 + 0.5) * (L.length - 2)
				const i = Math.floor(u), k = u - i
				const a = L[i]!, b = L[i + 1]!
				x = a.x + (b.x - a.x) * k
				z = a.z + (b.z - a.z) * k
				y = f.line.y
				const dir = Math.cos(t * f.speed + f.phase) > 0 ? 1 : -1
				yaw = Math.atan2((b.x - a.x) * dir, (b.z - a.z) * dir)
			}
			const d2 = at ? (x - at.x) ** 2 + (z - at.z) ** 2 : Infinity
			// from afar the whole fish wags; near, its body waves
			school.put(f.coat, x, y, z, yaw + (d2 < 18 * 18 ? 0 : Math.sin(t * 8 + f.phase) * 0.15), d2, () => clips.swim?.(t + f.phase) ?? {})
		}
		school.end()
	}
	update(0)
	return { object: school.object, update }
}
