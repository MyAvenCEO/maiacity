/**
 * The animals of the land outside: hens scratching in their runs and out
 * under the trees, rabbits in theirs, goats and sheep browsing the forest,
 * geese along the stream, frogs by the ponds, bees round their hives, fish in
 * the ponds and the tanks. Every one is a rigged actor ($lib/actors/casts), of
 * its breed: near the eye it moves every bone as its kind does — walks with its
 * feet set down and kept there, pecks, scratches, grazes, hops, flies, swims —
 * and further off the same animal stands in for itself, a hundred of them a
 * draw call ($lib/actors/crowd). Every animal wanders on its own: it walks,
 * turns, slows, stops to peck or graze, and walks on, always inside its own
 * patch of ground; no two quite the same size.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CASTS } from '$lib/actors/casts'
import { prepare, ready } from '$lib/actors/build'
import { crowd, FAR, type Eye } from '$lib/actors/crowd'
import { blend, lowDetail, type Clip, type Motion, type Pose } from '$lib/actors/rig'
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

/** the actors of a crowd, one a coat: built from their casts, their skins meshed off the page first (far and near) */
function cast(ids: string[]) {
	for (const id of ids) {
		void prepare(id, FAR)
		void prepare(id, 1)
	}
	const clips: Record<string, Clip>[] = []
	return {
		make: (c: number) => {
			const made = CASTS[ids[c]!]!()
			clips[c] = made.clips
			return made
		},
		ready: (c: number, detail: number) => ready(ids[c]!, detail),
		clips
	}
}

type Kind = 'hen' | 'goat' | 'goose' | 'frog' | 'sheep' | 'rabbit'
/** a breed of a kind: its cast, how often it is met, its own pace (m/s), and its stride if it moves in whole ones */
type Breed = { id: string; often: number; speed?: number; stride?: number }
type Spec = {
	breeds: Breed[]
	/** which breed the i-th animal of a patch is, if not by chance (a rooster to each run, and its chicks) */
	pick?: (i: number, patch: Patch) => number | null
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
	/** how quickly it gets up to its pace and stops again (m/s²) */
	accel: number
}
const breeds = (kind: string, ids: [string, number][]): Breed[] => ids.map(([id, often]) => ({ id: `${kind}-${id}`, often }))
const KINDS: Record<Kind, Spec> = {
	// six breeds of hen, a rooster to each run and a couple of chicks at his hens' feet
	hen: {
		breeds: [...breeds('chicken', [['red', 3], ['leghorn', 2], ['australorp', 2], ['barred', 2], ['buff', 2], ['speckled', 2]]), { id: 'chicken-rooster', often: 0, speed: 0.5 }, { id: 'chicken-chick', often: 0, speed: 0.25 }],
		pick: (i, patch) => (patch.n < 5 ? null : i === 0 ? 6 : i < 3 ? 7 : null),
		speed: 0.45, turn: 3, stop: [0.6, 3], walk: [0.5, 2], moving: 'walk', still: ['peck', 'scratch', 'peck', 'idle'], near: 35, max: 20, accel: 1.5
	},
	goat: { breeds: breeds('goat', [['saanen', 3], ['alpine', 3], ['pied', 2], ['nubian', 2], ['boer', 2]]), speed: 0.6, turn: 1.4, stop: [2, 7], walk: [1, 4], moving: 'walk', still: ['graze', 'graze', 'idle', 'alert'], near: 45, max: 16, accel: 0.8 },
	goose: { breeds: breeds('goose', [['embden', 3], ['toulouse', 2], ['chinese', 1]]), speed: 0.4, turn: 1.2, stop: [1, 4], walk: [1.5, 5], moving: 'walk', still: ['graze', 'idle', 'graze'], near: 40, max: 18, accel: 0.8 },
	// a frog sits still a long while, then hops once or twice, landing before it stops
	frog: { breeds: [{ id: 'frog-bullfrog', often: 2, speed: 0.4, stride: 0.32 }, { id: 'frog-green', often: 2, speed: 0.4, stride: 0.32 }, { id: 'frog-common', often: 2, speed: 0.28, stride: 0.224 }], speed: 0.4, turn: 4, stop: [3, 10], walk: [0.5, 1.4], moving: 'hop', still: ['idle', 'idle', 'croak'], near: 15, max: 14, accel: Infinity },
	// sheep graze the forest between the domes in flocks, a black one among them, one just shorn
	sheep: { breeds: breeds('sheep', [['whiteface', 3], ['suffolk', 3], ['merino', 2], ['black', 1], ['shorn', 1]]), speed: 0.5, turn: 1.2, stop: [3, 9], walk: [1, 3], moving: 'walk', still: ['graze', 'graze', 'graze', 'idle'], near: 45, max: 16, accel: 0.6 },
	// rabbits in their runs: a few hops, then a long sit, nibbling, washing, sitting up to look
	rabbit: { breeds: breeds('rabbit', [['wild', 2], ['dutch', 2], ['lop', 2], ['white', 1], ['black', 1], ['fawn', 2]]), speed: 0.55, turn: 2.5, stop: [2.5, 9], walk: [0.5, 1.6], moving: 'hop', still: ['graze', 'idle', 'idle', 'alert'], near: 25, max: 14, accel: 2.5 }
}

type Animal = { x: number; z: number; yaw: number; home: Patch; walking: boolean; until: number; coat: number; phase: number; v: number; dist: number; turn: number; size: number }

/**
 * A kind of animal spread over its patches of ground. `update(t)` moves every
 * one of them; those near `eye` move every bone.
 */
export function herd(kind: Kind, patches: Patch[], seed: number, eye?: Eye): { object: THREE.Group; update: (t: number) => void; where: () => { x: number; z: number }[] } {
	const spec = KINDS[kind]
	const total = spec.breeds.reduce((a, b) => a + b.often, 0)
	let r = seeded(seed)
	let animals: Animal[] = []
	const chance = () => {
		let x = r() * total
		return Math.max(0, spec.breeds.findIndex((b) => (x -= b.often) < 0))
	}
	/** every animal where it starts, from the seed alone */
	const born = () => {
		r = seeded(seed)
		animals = []
		for (const home of patches)
			for (let i = 0; i < home.n; i++) {
				const a = r() * Math.PI * 2, d = Math.sqrt(r()) * home.r * 0.8
				const coat = spec.pick?.(i, home) ?? chance()
				animals.push({ x: home.x + Math.cos(a) * d, z: home.z + Math.sin(a) * d, yaw: r() * Math.PI * 2, home, walking: r() < 0.5, until: r() * 3, coat, phase: r() * 10, v: 0, dist: 0, turn: 0, size: 0.92 + r() * 0.16 })
			}
	}
	born()
	const actors = cast(spec.breeds.map((b) => b.id))
	const flock = crowd(actors.make, spec.breeds.map((_, c) => animals.filter((an) => an.coat === c).length), { near: spec.near, max: spec.max, ready: actors.ready })
	const pace = (an: Animal) => spec.breeds[an.coat]!.speed ?? spec.speed
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
			const stride = spec.breeds[an.coat]!.stride
			// one that moves in whole strides finishes the one it is in before it stops
			const midStride = an.walking && stride !== undefined && an.dist / stride - Math.floor(an.dist / stride + 1e-6) > 1e-6
			if (t > an.until && !midStride) {
				an.walking = !an.walking
				const [lo, hi] = an.walking ? spec.walk : spec.stop
				an.until = t + lo + r() * (hi - lo)
				if (an.walking) an.yaw += (r() - 0.5) * 2.4
			}
			// up to its pace and slowing again, not all at once
			const want = an.walking ? pace(an) : 0
			an.v = spec.accel === Infinity ? want : an.v + Math.max(-spec.accel * dt, Math.min(spec.accel * dt, want - an.v))
			const was = an.yaw
			if (an.walking) {
				// wander, and turn back toward the middle of the patch near its edge
				const dx = an.home.x - an.x, dz = an.home.z - an.z
				const off = Math.hypot(dx, dz)
				an.yaw += (Math.sin(t * 0.9 + an.phase) * 0.5) * spec.turn * dt
				if (off > an.home.r * 0.75) {
					const aim = Math.atan2(dx, dz)
					const diff = Math.atan2(Math.sin(aim - an.yaw), Math.cos(aim - an.yaw))
					an.yaw += Math.sign(diff) * Math.min(Math.abs(diff), spec.turn * dt * 1.5)
				}
			}
			an.turn += ((an.yaw - was) / dt - an.turn) * 0.1
			an.x += Math.sin(an.yaw) * an.v * dt
			an.z += Math.cos(an.yaw) * an.v * dt
			an.dist += an.v * dt
		}
	}
	const pose = (t: number) => {
		const at = eye?.()
		flock.begin()
		for (const an of animals) {
			const d2 = at ? (an.x - at.x) ** 2 + (an.z - at.z) ** 2 : Infinity
			const own = pace(an)
			// how much it is walking: its gait blended with what it does standing as it slows and sets off
			const k = Math.min(1, an.v / own)
			const going = k * k * (3 - 2 * k)
			const still = spec.still[Math.floor(an.phase * 3) % spec.still.length]!
			const motion: Motion = { dist: an.dist, speed: an.v, turn: an.turn }
			const posed = (): Pose => {
				const clips = actors.clips[an.coat]
				if (!clips) return {}
				const tt = t + an.phase
				if (going > 0.999) return clips[spec.moving]!(tt, motion)
				const rest = (clips[still] ?? clips.idle)!(tt)
				return going < 0.001 ? rest : blend(rest, clips[spec.moving]!(tt, motion), going)
			}
			// from afar, a hen pecks and a goat grazes as a whole when it stops; walking, each bobs or waddles
			const pause = !an.walking
			const pitch = pause ? (kind === 'hen' ? Math.max(0, Math.sin(t * 5 + an.phase)) * 0.55 : kind === 'goat' || kind === 'sheep' ? 0.25 : 0) : 0
			const roll = an.walking && kind === 'goose' ? Math.sin(t * 7 + an.phase) * 0.08 : 0
			const bob = !an.walking ? 0 : kind === 'frog' || kind === 'rabbit' ? Math.abs(Math.sin(t * 9 + an.phase)) * (kind === 'frog' ? 0.14 : 0.05) : Math.abs(Math.sin(t * (kind === 'hen' ? 12 : 6) + an.phase)) * (kind === 'goat' || kind === 'sheep' ? 0.03 : 0.02)
			flock.put(an.coat, an.x, d2 < spec.near * spec.near ? 0 : bob, an.z, an.yaw, d2, posed, pitch, roll, an.size)
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
	const bees = cast(['bee'])
	const swarm = crowd(
		bees.make,
		[paths.length],
		{ near: 6, max: 30, scale: 1.6, lift: 0.012, shadows: false, ready: bees.ready, farShape: () => ({ geometry: speck, material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) }) }
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
			swarm.put(0, x, b.h + Math.sin(t * 3 + b.wob) * 0.15, z, yaw, d2, () => bees.clips[0]?.fly?.(t + b.phase) ?? {})
		}
		swarm.end()
	}
	update(0)
	return { object, update, where: () => spots }
}

/** the fish of the ponds: koi of three colours and a plain carp; of the aquaponics tanks: tilapia */
export const POND_FISH = ['fish-koi', 'fish-kohaku', 'fish-ogon', 'fish-carp']
export const TANK_FISH = ['fish-nile', 'fish-redtilapia']

/**
 * Fish: koi and carp in the ponds, tilapia in the aquaponics tanks, circling
 * and turning, and a few working their way up and down a stream, just under
 * the surface — rigged near the eye, their bodies waving them on, a beat of the
 * tail for every length swum.
 */
export function fishes(pools: { x: number; z: number; r: number; y: number; n: number }[], streams: { line: { x: number; z: number }[]; y: number; n: number }[], seed: number, eye?: Eye, kinds = POND_FISH): { object: THREE.Group; update: (t: number) => void } {
	const r = seeded(seed)
	const COATS = kinds.length
	type F = { pool?: (typeof pools)[number]; line?: (typeof streams)[number]; rad: number; speed: number; phase: number; coat: number }
	const fish: F[] = []
	for (const pool of pools) for (let i = 0; i < pool.n; i++) fish.push({ pool, rad: pool.r * (0.3 + r() * 0.6), speed: (0.3 + r() * 0.5) * (r() < 0.5 ? -1 : 1), phase: r() * 10, coat: Math.floor(r() * COATS) })
	for (const line of streams) for (let i = 0; i < line.n; i++) fish.push({ line, rad: 0, speed: 0.02 + r() * 0.03, phase: r() * 10, coat: Math.floor(r() * COATS) })
	const swimmers = cast(kinds)
	const school = crowd(
		swimmers.make,
		Array.from({ length: COATS }, (_, c) => fish.filter((f) => f.coat === c).length),
		// a fish's middle is 0.15 m over its origin (./species/fish.ts): the pool gives where its middle swims
		{ near: 18, max: 20, lift: 0.15, ready: swimmers.ready }
	)
	const update = (t: number) => {
		const at = eye?.()
		school.begin()
		for (const f of fish) {
			let x = 0, z = 0, y = 0, yaw = 0, motion: Motion = { dist: 0, speed: 0 }
			if (f.pool) {
				// round the pool, wandering in and out
				const a = t * f.speed + f.phase
				const rr = f.rad * (0.8 + 0.2 * Math.sin(t * 0.3 + f.phase))
				x = f.pool.x + Math.sin(a) * rr
				z = f.pool.z + Math.cos(a) * rr
				y = f.pool.y
				yaw = a + (f.speed > 0 ? Math.PI / 2 : -Math.PI / 2)
				motion = { dist: Math.abs(t * f.speed) * rr, speed: Math.abs(f.speed) * rr, turn: f.speed }
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
				const along = Math.hypot(b.x - a.x, b.z - a.z) * (L.length - 2) * 0.5
				motion = { dist: along * (1 - Math.cos(t * f.speed + f.phase)), speed: along * Math.abs(f.speed * Math.cos(t * f.speed + f.phase)) }
			}
			const d2 = at ? (x - at.x) ** 2 + (z - at.z) ** 2 : Infinity
			// from afar the whole fish wags; near, its body waves
			school.put(f.coat, x, y, z, yaw + (d2 < 18 * 18 ? 0 : Math.sin(t * 8 + f.phase) * 0.15), d2, () => swimmers.clips[f.coat]?.swim?.(t + f.phase, motion) ?? {})
		}
		school.end()
	}
	update(0)
	return { object: school.object, update }
}

/**
 * Ant hills on the forest floor, the wood ants busy on them: from afar a still mound (the ants too small to see),
 * near the eye the rigged hill with its colony going round it — built the first time the eye comes near, and posed
 * only while it is near.
 */
export function antHills(spots: { x: number; z: number; rot: number; size: number }[], eye?: Eye): { object: THREE.Group; update: (t: number) => void; where: () => { x: number; z: number }[] } {
	const object = new THREE.Group()
	const NEAR = 22
	const make = CASTS['ant-hill']!
	// the mound from afar: the hill built coarse, its ants (each far smaller than the mound) left off
	const far = lowDetail(make, 0.45).rig.object
	far.castShadow = far.receiveShadow = true
	type Hill = { s: (typeof spots)[number]; far: THREE.Object3D; near?: ReturnType<typeof make> }
	const hills: Hill[] = spots.map((s) => {
		const o = far.clone()
		o.position.set(s.x, 0, s.z)
		o.rotation.y = s.rot
		o.scale.setScalar(s.size)
		object.add(o)
		return { s, far: o }
	})
	const update = (t: number) => {
		const at = eye?.()
		for (const h of hills) {
			const near = !!at && (h.s.x - at.x) ** 2 + (h.s.z - at.z) ** 2 < NEAR * NEAR
			if (near && !h.near) {
				h.near = make()
				const o = h.near.rig.object
				o.position.set(h.s.x, 0, h.s.z)
				o.rotation.y = h.s.rot
				o.scale.setScalar(h.s.size)
				object.add(o)
			}
			h.far.visible = !near
			if (h.near) {
				h.near.rig.object.visible = near
				if (near) h.near.rig.pose(h.near.clips.busy!(t + h.s.x))
			}
		}
	}
	update(0)
	return { object, update, where: () => spots }
}
