/**
 * AVENCITY SANDBOX 4 — a whole dome cell in one world you can walk.
 *
 * The master dome stands in the middle, six large domes in a ring round it,
 * six medium domes further out between them: the same glass shells, stone
 * arcades, terraces and doors as the domes in Sandbox 3, built full size.
 * Meandering paths join every door; a turquoise stream winds round the cell
 * and sends its creeks in between the domes, with a timber bridge wherever a
 * path crosses; the seven-layer food forest fills the rest of the hexagon.
 *
 * From outside you see a simple inside through the glass: the forest, the
 * galleries, the rooms, the master's stage. Walk through a door and the full
 * interior of that dome loads (interior.ts), entered at that door; walk back
 * out of a door and you are in the village again, outside it.
 */
import * as THREE from 'three'
import { DOMES, DOORS, adiff, bake, box, geodesic, glassSheen, lantern, mats, mountInterior, polar, portal, sofa, table, type DomeKind, type EmbeddedDome } from './interior'
import { cafes, coops, coopsAround, henPatches, playground, rabbitPatches, squaresAround, type Kit } from './spaces'
import { water } from './textures'
import { BIOMES, groundMaterial } from '$lib/biomes'
import { coverStream } from '$lib/biomes/stream.js'
import { songbirds } from './birds.js'
import { playDome } from '$lib/models/minidomes.js'
import { appleTree, banana, berryBush, canopyTree, climber, clover, coconutPalm, comfrey, fruitTree, ginger, herb, papaya, passionVine, seeded, smallFruitTree, squash, strawberries, tropicalShrub, forestFloor, FLOOR_KINDS, floorPick, grassTuft, type Plant } from './plants'
import { antHills, apiary, fishes, herd } from './animals'
import { settled as actorsSettled } from '$lib/actors/build'
import { flow, pond, shore, stream } from './water'
import { createStage } from '$lib/sandbox-kit/stage.js'
import { createSky } from '$lib/sandbox-kit/sky.js'
import { createWalker } from '$lib/sandbox-kit/walker.js'
import { createObstacles } from '$lib/sandbox-kit/obstacles.js'
import { connectFilm, filmDraws, filmHoldsSize, worldTime } from '$lib/sandbox-kit/film.js'
import { ambience, levelsAt } from './ambience'
import { createForest, type Forest } from './flora.js'
import { swapLegacy } from './legacy.js'
import { DRIFT, FIELDS, OUTDOOR_SPACING, pick, planting, stageOf, type Flora } from './sandbox5.js'

export type VillageDome = { kind: DomeKind; x: number; z: number; R: number; ext: number }
export type VillageHandle = {
	domes: VillageDome[]
	/** the dome being opened as you walk up to it, if any */
	opening: () => string | null
	/** stop drawing while a dome's inside is open, and start again */
	pause: () => void
	resume: () => void
	/** stand outside dome i's door, facing away from it */
	placeAtDoor: (i: number, door: number) => void
	/** walk from a touch joystick: x to the right, y ahead, each -1…1; hurry when pushed to the edge */
	move: (x: number, y: number, hurry: boolean) => void
	/** turn the view by a finger's drag, in pixels */
	look: (dx: number, dy: number) => void
	/**
	 * Sandbox 5: the plant under a point of the screen (client pixels), marked with a ring at its foot; null (and no
	 * ring) when there is none
	 */
	pickPlant: (clientX: number, clientY: number) => PickedPlant | null
	/** take the ring away again */
	unpick: () => void
	dispose: () => void
}
/** a plant picked in Sandbox 5's forest: which (its id, version, stage), where, and how far from the eye */
export type PickedPlant = { id: string; v: number; stage: number; seed: string; x: number; z: number; height: number; distance: number; inside: boolean }

const WORLD = 380

/** The cell: the master dome, six large domes round it, six medium domes further out between them. */
function layout(): VillageDome[] {
	const make = (kind: DomeKind, x: number, z: number): VillageDome => {
		const R = DOMES[kind].diameter / 2
		return { kind, x, z, R, ext: R + 6 }
	}
	const out = [make('master', 0, 0)]
	for (let k = 0; k < 6; k++) out.push(make('large', ...polar(150, (k * Math.PI) / 3)))
	for (let k = 0; k < 6; k++) out.push(make('home', ...polar(200, Math.PI / 6 + (k * Math.PI) / 3)))
	return out
}

/**
 * Which sandbox the village is: Sandbox 4 as it was built (its forest of simple stand-in plants, ./plants.ts), or
 * Sandbox 5, its forest grown from our own plants ($lib/plants, ./flora.js) as its `flora` says (./sandbox5.js).
 */
export type VillageOptions = { sandbox?: 'sandbox-4' | 'sandbox-5'; flora?: Flora }

export async function mountVillage(container: HTMLElement, onProgress: (label: string) => void, opts: VillageOptions = {}): Promise<VillageHandle> {
	const flora = opts.flora
	const pause = async (label: string) => {
		onProgress(label)
		await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
	}
	// the canvas, the camera and the sky are every sandbox's own ($lib/sandbox-kit)
	const stage = createStage(container)
	const { renderer, scene, camera } = stage
	// where the eye is (the walker's, or the film camera's): the animals near it move every bone
	const eye = () => camera.position
	const m = mats()
	const domes = layout()
	/** Sandbox 5: the cell's forest grown from our plants (./flora.js), planted below with the food forest; the stand-in
	 *  plants of Sandbox 4's squares traded for its plants too (./legacy.js) */
	// its trees in full near you, coarser to 40 m, and beyond that each a picture of itself (./impostors.js)
	const forest: Forest | null = flora ? createForest({ tree: [16, 40], shrub: [10, 26], cover: [6, 13], renderer }) : null
	const swapR = seeded(707)
	const swap = (root: THREE.Object3D) => {
		if (forest && flora) swapLegacy(root, scene, forest, { warm: false, seed: flora.seed, r: swapR })
	}
	const animated: ((t: number) => void)[] = []
	/** what can be heard: the water, and where each herd is */
	const waterPts: { x: number; z: number }[] = []
	const herds: Parameters<typeof levelsAt>[4] = {}
	const sound = ambience()
	/** the dome whose full inside is built into the village, and how dark it is */
	/** the domes whose full inside is built, kept once built; the one being built now; when each was last near */
	const built = new Map<number, EmbeddedDome>()
	const shown = new Set<number>()
	let building: { i: number; cancelled: boolean } | null = null
	/** domes the film camera keeps built however far the walker goes: the shots it is preparing need them */
	const pinned = new Set<number>()
	const lastNear = new Map<number, number>()
	let nightNow = 0

	/* ── the sky, and a sun that follows the in-game clock ($lib/sandbox-kit/sky) ── */
	// the film camera (src/lib/film, $lib/sandbox-kit/film): while a film holds the cell, every animation runs on the
	// world's clock it sets (worldTime) instead of the page's, and the film draws the canvas itself (filmDraws)
	const GLOW = '#ffc070', LAMP = '#ffc98a'
	const glowMat = new THREE.MeshStandardMaterial({ color: '#fff0d0', emissive: GLOW, emissiveIntensity: 0.1 })
	// the lanterns glow and the open domes darken with the night
	const sky = createSky(renderer, scene, {
		onHour: ({ hour, night }) => {
			glowMat.emissiveIntensity = 0.1 + 2.4 * night
			nightNow = night
			for (const dm of built.values()) dm.setHour(hour)
		}
	})
	await pause('Letting in the light')

	/* ── the ground: the hexagon of the cell, meadow beyond ── */
	// the meadow beyond the cell: a ring, so it never shows through the hole over the master's theatre
	const meadow = new THREE.Mesh(new THREE.RingGeometry(WORLD * 0.8, 3000, 64, 1), m.grass)
	meadow.rotation.x = -Math.PI / 2
	meadow.position.y = -0.05
	meadow.receiveShadow = true
	scene.add(meadow)
	// the hexagon of the cell, open under the master dome, whose theatre sinks into the ground
	const hexShape = new THREE.Shape()
	for (let k = 0; k <= 6; k++) {
		const a = (k / 6) * Math.PI * 2
		if (k === 0) hexShape.moveTo(Math.cos(a) * WORLD, Math.sin(a) * WORLD)
		else hexShape.lineTo(Math.cos(a) * WORLD, Math.sin(a) * WORLD)
	}
	hexShape.holes.push(new THREE.Path().absarc(0, 0, Math.max(4.5, domes[0]!.R * 0.22) + 0.3, 0, Math.PI * 2, true))
	// Sandbox 5: the cell is a forest garden to its edges, its soil never bare — its floor is the food forest biome's
	// ($lib/biomes): a living mat of clover and grasses in the light, leaf litter, humus and moss under the trees
	const FLOOR_BIOME = BIOMES.find((b) => b.id === 'food-forest')!
	const hex = new THREE.Mesh(new THREE.ShapeGeometry(hexShape, 48), opts.flora ? groundMaterial(FLOOR_BIOME.surface) : m.grass)
	hex.rotation.x = -Math.PI / 2
	hex.receiveShadow = true
	scene.add(hex)
	const inHex = (x: number, z: number) => {
		// a pointy-sided hexagon: corners on the x axis
		const ax = Math.abs(x), az = Math.abs(z)
		return az <= WORLD * 0.866 && az * 0.577 + ax <= WORLD
	}

	/** The café squares and hen coops round the master dome, as in Sandbox 3 (spaces.ts). */
	const SQUARE_R = domes[0]!.ext + 2.6 + 7.5
	/** three wooden playgrounds in the forest between the domes */
	const PLAYGROUNDS = [0.2, 2.3, 4.4].map((a) => {
		const [x, z] = polar(118, a + Math.PI / 6)
		return { x, z, r: 8.5 }
	})
	const AROUND_MASTER = [...PLAYGROUNDS,
		...squaresAround().map(({ a, radius }) => ({ x: Math.sin(a) * SQUARE_R, z: Math.cos(a) * SQUARE_R, r: radius })),
		...coopsAround(SQUARE_R).map(({ a, r }) => ({ x: Math.sin(a) * r, z: Math.cos(a) * r, r: 5 }))
	]
	/** A quick test for whether a point is near any of a set of lines, by 6 m cells. */
	const near = (lines: THREE.Vector3[][], cell = 6) => {
		const map = new Map<string, THREE.Vector3[]>()
		for (const ps of lines)
			for (const pt of ps) {
				const key = `${Math.floor(pt.x / cell)},${Math.floor(pt.z / cell)}`
				const list = map.get(key)
				if (list) list.push(pt)
				else map.set(key, [pt])
			}
		return (x: number, z: number, margin: number) => {
			const ix = Math.floor(x / cell), iz = Math.floor(z / cell), reach = Math.ceil(margin / cell)
			for (let dx = -reach; dx <= reach; dx++)
				for (let dz = -reach; dz <= reach; dz++)
					for (const pt of map.get(`${ix + dx},${iz + dz}`) ?? []) if (Math.hypot(pt.x - x, pt.z - z) < margin) return true
			return false
		}
	}
	/** Pushes a line of points out of every dome and its terrace, and off the squares and coops. */
	const clear = (pts: THREE.Vector3[], margin: number, keepEnds = true) => {
		const obstacles = [...domes.map((d) => ({ x: d.x, z: d.z, r: d.ext })), ...AROUND_MASTER]
		for (let it = 0; it < 4; it++)
			pts.forEach((p, i) => {
				if (keepEnds && (i === 0 || i === pts.length - 1)) return
				for (const d of obstacles) {
					const dx = p.x - d.x, dz = p.z - d.z
					const r = Math.hypot(dx, dz)
					const need = d.r + margin
					if (r < need && r > 0.01) {
						p.x = d.x + (dx / r) * need
						p.z = d.z + (dz / r) * need
					}
				}
			})
		return pts
	}
	/**
	 * A line's own curve, a point every few metres along it: pushed clear (`clear`) a point at a time, a path clears a
	 * coop or a square all along it, not only at its few bends, between which its curve would cut straight through.
	 */
	const denser = (pts: THREE.Vector3[], closed = false, every = 4) => {
		const curve = new THREE.CatmullRomCurve3(pts, closed)
		const n = Math.max(pts.length, Math.round(curve.getLength() / every))
		const out = curve.getSpacedPoints(n)
		if (closed) out.pop()
		return out
	}
	/** A smooth, gently wandering line from a to b. */
	const meander = (a: THREE.Vector3, b: THREE.Vector3, wobble: number, seed: number) => {
		const r = seeded(seed)
		const n = Math.max(4, Math.round(a.distanceTo(b) / 14))
		const side = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize()
		const pts = Array.from({ length: n + 1 }, (_, i) => {
			const t = i / n
			const w = Math.sin(t * Math.PI) * wobble * Math.sin(t * Math.PI * (1.5 + r()) + r() * 6)
			return a.clone().lerp(b, t).addScaledVector(side, w)
		})
		return pts
	}
	/** A ribbon laid along a curve: a path or a stream. */
	const ribbon = (pts: THREE.Vector3[], width: number, mat: THREE.Material, y: number, closed = false) => {
		const curve = new THREE.CatmullRomCurve3(pts, closed)
		const samples = curve.getSpacedPoints(Math.max(8, Math.round(curve.getLength() / 1.5)))
		const pos: number[] = [], uv: number[] = [], idx: number[] = []
		let dist = 0
		samples.forEach((p, i) => {
			const p1 = samples[Math.min(samples.length - 1, i + 1)]!, p0 = samples[Math.max(0, i - 1)]!
			const dir = p1.clone().sub(p0).setY(0).normalize()
			const sx = -dir.z * (width / 2), sz = dir.x * (width / 2)
			if (i > 0) dist += p.distanceTo(samples[i - 1]!)
			pos.push(p.x - sx, y, p.z - sz, p.x + sx, y, p.z + sz)
			uv.push(0, dist / width, 1, dist / width)
			if (i < samples.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
		})
		const geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
		geo.setIndex(idx)
		geo.computeVertexNormals()
		const mesh = new THREE.Mesh(geo, mat)
		mesh.receiveShadow = true
		scene.add(mesh)
		return samples
	}
	const doorPoint = (d: VillageDome, door: number, out = 0.8) => {
		const [x, z] = polar(d.ext + out, door)
		return new THREE.Vector3(d.x + x, 0, d.z + z)
	}
	const doorToward = (d: VillageDome, x: number, z: number) => {
		const a = Math.atan2(x - d.x, z - d.z)
		return DOORS.reduce((best, dd) => (Math.abs(adiff(a, dd)) < Math.abs(adiff(a, best)) ? dd : best))
	}

	/* ── the paths: a ring round every dome, a ring round the master, and meandering
	   paths from door to door, out to a loop round the cell and on to its edges ── */
	const pathMat = m.stone(1).clone()
	pathMat.side = THREE.DoubleSide
	const paths: THREE.Vector3[][] = []
	const addPath = (pts: THREE.Vector3[], width = 2.4, closed = false) => paths.push(ribbon(pts, width, pathMat, 0.03, closed))
	for (const d of domes) {
		const rr = d.ext + 2.6
		addPath(Array.from({ length: 48 }, (_, i) => new THREE.Vector3(d.x + Math.sin((i / 48) * Math.PI * 2) * rr, 0, d.z + Math.cos((i / 48) * Math.PI * 2) * rr)), 2.2, true)
	}
	const master = domes[0]!
	domes.slice(1).forEach((d, i) => {
		// from the door that faces the centre, in to the master's nearest door: through the gaps between its café
		// squares and coops, never between a square and a coop, too close together for a path
		const door = doorToward(d, 0, 0)
		const a = doorPoint(d, door, 2.6)
		const target = doorPoint(master, doorToward(master, d.x, d.z), 2.6)
		addPath(clear(denser(meander(a, target, 5, 300 + i)), 3))
	})
	// a loop round the whole cell, and a short path out to it from every outer door
	const loopR = 252
	const loop = clear(denser(Array.from({ length: 40 }, (_, i) => {
		const a = (i / 40) * Math.PI * 2
		const rr = loopR + Math.sin(a * 5) * 9
		return new THREE.Vector3(Math.sin(a) * rr, 0, Math.cos(a) * rr)
	}), true), 6, false)
	addPath(loop, 2.4, true)
	domes.slice(1).forEach((d, i) => {
		const door = doorToward(d, d.x * 2, d.z * 2)
		const a = doorPoint(d, door, 2.6)
		const aim = Math.atan2(a.x, a.z)
		const b = new THREE.Vector3(Math.sin(aim) * (loopR + Math.sin(aim * 5) * 9), 0, Math.cos(aim) * (loopR + Math.sin(aim * 5) * 9))
		addPath(clear(denser(meander(a, b, 3, 400 + i)), 3))
	})
	// and out to the edges of the cell, where the next cells would begin
	for (let k = 0; k < 3; k++) {
		const aim = (k / 3) * Math.PI * 2 + 0.4
		const a = new THREE.Vector3(Math.sin(aim) * loopR, 0, Math.cos(aim) * loopR)
		const b = new THREE.Vector3(Math.sin(aim) * (WORLD * 0.84), 0, Math.cos(aim) * (WORLD * 0.84))
		addPath(meander(a, b, 10, 500 + k))
	}
	const nearPath = near(paths)
	await pause('Laying the paths')

	/* ── the stream: a winding loop round the cell, and creeks in between the domes to ponds ── */
	const streams: THREE.Vector3[][] = []
	/** a smooth line through the points, a sample every metre and a half */
	const along = (pts: THREE.Vector3[], closed = false) => {
		const curve = new THREE.CatmullRomCurve3(pts, closed)
		return curve.getSpacedPoints(Math.max(8, Math.round(curve.getLength() / 1.5)))
	}
	const waterside = new THREE.Group()
	const ponds: { x: number; z: number; outline: THREE.Vector3[] }[] = []
	const W = 3.6
	{
		const riverR = 305
		const river = clear(Array.from({ length: 48 }, (_, i) => {
			const a = (i / 48) * Math.PI * 2
			const rr = riverR + Math.sin(a * 7) * 14 + Math.sin(a * 3 + 1) * 8
			return new THREE.Vector3(Math.sin(a) * rr, 0, Math.cos(a) * rr)
		}), 8, false)
		const riverLine = along(river, true)
		scene.add(stream(riverLine, W, 0.08, true))
		waterside.add(shore(riverLine, W / 2, 31))
		streams.push(riverLine)
		// creeks, in between the domes towards the centre, each ending in a pond
		for (let k = 0; k < 6; k++) {
			const aim = (k * Math.PI) / 3 + Math.PI / 6 + (k % 2 ? 0.14 : -0.14)
			const a = new THREE.Vector3(Math.sin(aim) * riverR, 0, Math.cos(aim) * riverR)
			const end = new THREE.Vector3(Math.sin(aim + 0.3) * 104, 0, Math.cos(aim + 0.3) * 104)
			const creek = clear(meander(a, end, 12, 600 + k), 7, false)
			const creekLine = along(creek)
			scene.add(stream(creekLine, W * 0.7, 0.08))
			waterside.add(shore(creekLine, (W * 0.7) / 2, 40 + k))
			streams.push(creekLine)
			// and where it ends, a pond: never round, deeper in its middle, reeds and lilies round it
			const last = creekLine[creekLine.length - 1]!
			const p = pond(last.x, last.z, 9 + (k % 3) * 2, 700 + k, 0.08)
			scene.add(p.group)
			waterside.add(shore(p.outline, 0, 50 + k, { x: last.x, z: last.z }))
			ponds.push({ x: last.x, z: last.z, outline: p.outline })
		}
		scene.add(bake(waterside, false))
		// stones along the banks
		const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), m.pebble, 2600)
		const rs = seeded(17)
		const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3()
		let n = 0
		for (const line of streams)
			for (let i = 0; i < line.length - 1 && n < 2600; i += 2) {
				const a = line[i]!, b = line[i + 1]!
				const dir = b.clone().sub(a).normalize()
				for (const sd of [-1, 1]) {
					if (n >= 2600) break
					const size = 0.25 + rs() * 0.35
					p.set(a.x - dir.z * sd * (W / 2 + 0.2), 0.06, a.z + dir.x * sd * (W / 2 + 0.2))
					stones.setMatrixAt(n++, m4.compose(p, q.setFromEuler(e.set(rs(), rs() * 6, rs())), s.set(size, size * 0.5, size)))
				}
			}
		stones.count = n
		scene.add(stones)
	}
	// the ponds' water, filled in point by point, so nothing is planted in them
	const pondFill = ponds.map((pd) => [0.25, 0.5, 0.75, 1].flatMap((f) => pd.outline.filter((_, i) => i % 2 === 0).map((o) => new THREE.Vector3(pd.x + (o.x - pd.x) * f, 0, pd.z + (o.z - pd.z) * f))))
	const nearWater = near([...streams, ...pondFill])
	// timber bridges wherever a path crosses water
	{
		const bridges = new THREE.Group()
		const placed: THREE.Vector3[] = []
		for (const ps of paths)
			for (let i = 1; i < ps.length - 1; i++) {
				const p = ps[i]!
				if (!nearWater(p.x, p.z, W / 2 + 0.6) || placed.some((b) => b.distanceTo(p) < 14)) continue
				// only where the path crosses the water, not where it runs along the bank
				const pd = ps[i + 1]!.clone().sub(ps[i - 1]!).setY(0).normalize()
				let wd: THREE.Vector3 | null = null, best = Infinity
				for (const line of streams)
					for (let j = 1; j < line.length - 1; j += 2) {
						const dd = Math.hypot(line[j]!.x - p.x, line[j]!.z - p.z)
						if (dd < best) (best = dd), (wd = line[j + 1]!.clone().sub(line[j - 1]!).setY(0).normalize())
					}
				if (!wd || best > W || Math.abs(pd.dot(wd)) > 0.55) continue
				placed.push(p)
				const dir = ps[i + 1]!.clone().sub(ps[i - 1]!)
				const a = Math.atan2(dir.x, dir.z)
				bridges.add(box(2.6, 0.22, W + 2.6, m.oak(1, 2), p.x, 0.12, p.z, a))
				for (const sd of [-1, 1]) {
					const ox = Math.cos(a) * 1.25 * sd, oz = -Math.sin(a) * 1.25 * sd
					bridges.add(box(0.08, 0.9, W + 2.6, m.timberFrame, p.x + ox, 0.34, p.z + oz, a))
					for (const t of [-1, 0, 1]) {
						const tx = Math.sin(a) * t * (W / 2 + 1), tz = Math.cos(a) * t * (W / 2 + 1)
						bridges.add(box(0.1, 1.2, 0.1, m.timberFrame, p.x + ox + tx, 0.1, p.z + oz + tz))
					}
				}
			}
		scene.add(bake(bridges))
	}
	await pause('Letting the stream in')

	/* ── the domes: the real shells, arcades and terraces, and a simple inside through the glass ── */
	const colliders: { x: number; z: number; r: number }[] = []
	const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6).translate(0, 0.5, 0)
	const crownGeo = new THREE.IcosahedronGeometry(1, 1)
	const treeTrunkMat = new THREE.MeshStandardMaterial({ color: '#6d5238', roughness: 0.9 })
	const treeCrownMat = new THREE.MeshStandardMaterial({ color: '#4f8a38', roughness: 0.8, flatShading: true })
	/** Sandbox 5: the warm garden's trees for the simple insides, each ripe (one kind a tree, few to grow) */
	const RIPE = flora ? flora.inside.trees.map((p) => ({ ...p, stages: [p.stages[p.stages.length - 1]!] })) : []
	/** each dome's simple version, all of it, so it can step aside for the full one */
	const simple: THREE.Object3D[][] = []
	let insideTrees: THREE.Matrix4[] = []
	let insideCrowns: THREE.Matrix4[] = []
	for (const d of domes) {
		const spec = DOMES[d.kind]
		const g = new THREE.Group()
		const own: THREE.Object3D[] = []
		simple.push(own)
		insideTrees = []
		insideCrowns = []
		const shell = geodesic(spec, m, d.kind)
		shell.group.position.set(d.x, 0, d.z)
		scene.add(shell.group)
		own.push(shell.group)
		// its doors, all four merged into a few meshes (a door is a dozen small parts: drawn one by one, the cell's
		// thirteen domes cost hundreds of draw calls for them)
		{
			const doors = new THREE.Group()
			for (const hole of shell.holes) doors.add(portal(m, hole, d.kind))
			const pr = bake(doors)
			pr.position.set(d.x, 0, d.z)
			scene.add(pr)
			own.push(pr)
		}
		const gal = spec.gallery!
		const R = d.R, H = gal.height
		const rWall = Math.sqrt(R * R - H * H)
		const rIn = rWall - gal.depth
		const Rt = d.ext
		const H2 = H + 3.6
		const twoFloors = gal.floors === 2
		// the knee wall round the base, open at the doors
		for (const dd of DOORS) {
			const gh = 1.6 / R
			const knee = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 0.9, 32, 1, true, dd + gh, Math.PI / 2 - 2 * gh), m.lime((Math.PI * R) / 8, 0.4))
			knee.position.y = 0.45
			;(knee.material as THREE.Material).side = THREE.DoubleSide
			g.add(knee)
		}
		// the terraces on their arcade, one to each floor of rooms
		const perQuarter = Math.max(3, Math.round(((Math.PI / 2) * Rt) / 5.2))
		const step = Math.PI / 2 / perQuarter
		const archR = (step * Rt) / 2 - 0.4
		const terrace = (y: number, base: number, rInner: number) => {
			const deck = new THREE.Mesh(new THREE.RingGeometry(rInner, Rt, 96), m.stone(R / 1.5))
			deck.rotation.x = -Math.PI / 2
			deck.position.y = y + 0.02
			g.add(deck)
			const under = new THREE.Mesh(new THREE.RingGeometry(rInner, Rt, 96), m.lime(R / 2))
			under.rotation.x = Math.PI / 2
			under.position.y = y - 0.35
			g.add(under)
			const edge = new THREE.Mesh(new THREE.CylinderGeometry(Rt, Rt, 0.4, 96, 1, true), m.lime((Math.PI * Rt) / 2, 0.2))
			edge.position.y = y - 0.15
			g.add(edge)
			for (let k = 0; k < perQuarter * 4; k++) {
				const [x, z] = polar(Rt - 0.45, (k + 0.5) * step)
				g.add(box(0.8, y - base - 0.3, 0.8, m.lime(0.6, (y - base) / 2), x, base, z, (k + 0.5) * step))
				if (base === 0) colliders.push({ x: d.x + x, z: d.z + z, r: 0.6 })
				const arch = new THREE.Mesh(new THREE.TorusGeometry(archR, 0.4, 6, 16, Math.PI), m.lime(2, 0.3))
				const [ax, az] = polar(Rt - 0.45, k * step)
				arch.position.set(ax, y - 0.35 - archR, az)
				arch.rotation.y = k * step
				g.add(arch)
			}
			const rail = new THREE.Mesh(new THREE.TorusGeometry(Rt - 0.2, 0.07, 6, 160), m.timberFrame)
			rail.rotation.x = -Math.PI / 2
			rail.position.y = y + 0.98
			g.add(rail)
			const posts = Math.round((Math.PI * 2 * Rt) / 2.2)
			for (let k = 0; k < posts; k++) {
				const [x, z] = polar(Rt - 0.2, (k / posts) * Math.PI * 2)
				g.add(box(0.1, 0.95, 0.1, m.timberFrame, x, y, z))
			}
		}
		terrace(H, 0, rWall - 0.4)
		if (twoFloors) terrace(H2, H, Math.sqrt(R * R - H2 * H2) - 0.4)
		// through the glass: soil, the plaza or the stage, the galleries and the rooms
		const soil = new THREE.Mesh(new THREE.CircleGeometry(R - 0.1, 48), m.soil(R / 2))
		soil.rotation.x = -Math.PI / 2
		soil.position.y = 0.02
		g.add(soil)
		const Rc = Math.max(4.5, R * 0.22)
		const plaza = new THREE.Mesh(new THREE.CircleGeometry(Rc, 32), m.stone(Rc / 1.5))
		plaza.rotation.x = -Math.PI / 2
		plaza.position.y = 0.04
		g.add(plaza)
		if (d.kind === 'master') {
			// the round theatre: tiers of stone round a wide oak stage
			for (let k = 0; k < 6; k++) {
				const tier = new THREE.Mesh(new THREE.RingGeometry(Rc * 0.55 + k * 0.9, Rc * 0.55 + (k + 1) * 0.9, 64), m.lime(Rc, 0.3))
				tier.rotation.x = -Math.PI / 2
				tier.position.y = 0.05 + k * 0.12
				g.add(tier)
			}
			const stage = new THREE.Mesh(new THREE.CylinderGeometry(Rc * 0.55, Rc * 0.55, 0.3, 48), m.oak(Rc, Rc))
			stage.position.y = 0.15
			g.add(stage)
		}
		// the kitchen garden along the ring path, and the four stairs up to the gallery
		const Rp = (Rc + rIn) / 2
		const beds = Math.min(28, Math.floor((2 * Math.PI * Rp) / 4))
		for (let k = 0; k < beds; k++) {
			const a = ((k + 0.5) / beds) * Math.PI * 2
			if ([...DOORS, ...DOORS.map((dd) => dd + Math.PI / 4)].some((dd) => Math.abs(adiff(a, dd)) * Rp < 3)) continue
			const [x, z] = polar(Rp + 2.05, a)
			g.add(box(3, 0.4, 1.1, m.oak(1.5, 0.3), x, 0, z, a + Math.PI / 2))
			g.add(box(2.9, 0.12, 1, m.grass, x, 0.4, z, a + Math.PI / 2))
		}
		for (const sa of DOORS.map((dd) => dd + Math.PI / 4)) {
			const run = H * 1.9
			const [x, z] = polar(rIn - run / 2, sa)
			const flight = box(1.8, 0.12, Math.hypot(run, H), m.oak(1, 3), x, H / 2 - 0.06, z, sa)
			flight.rotation.set(Math.atan2(H, run), sa, 0, 'YXZ')
			g.add(flight)
		}
		for (const [y, floor] of twoFloors ? [[H, 1], [H2, 2]] : [[H, 1]]) {
			const galleryFloor = new THREE.Mesh(new THREE.RingGeometry(rIn, Math.sqrt(R * R - y! * y!) - 0.2, 96), m.oak(R / 2))
			galleryFloor.rotation.x = -Math.PI / 2
			galleryFloor.position.y = y!
			;(galleryFloor.material as THREE.Material).side = THREE.DoubleSide
			g.add(galleryFloor)
			const rooms = new THREE.Mesh(new THREE.CylinderGeometry(rIn + 2.4, rIn + 2.4, 3, 64, 1, true), m.oak((Math.PI * rIn) / 2, 1))
			rooms.position.y = y! + 1.5
			;(rooms.material as THREE.Material).side = THREE.DoubleSide
			g.add(rooms)
			void floor
			const lamps = Math.round((2 * Math.PI * rIn) / 9)
			for (let k = 0; k < lamps; k++) {
				const [x, z] = polar(rIn + 1.2, (k / lamps) * Math.PI * 2)
				g.add(box(0.3, 0.3, 0.3, glowMat, x, y! + 2.4, z))
			}
		}
		// the forest inside, as simple trees: enough to see through the glass. Sandbox 5 plants its warm garden's own
		// trees there in the outside forest, drawn as it is (in full near, as pictures far off) and left out of it
		// while the dome's full inside, with its own forest, is shown (see `place`)
		const r = seeded(Math.round(d.x * 7 + d.z * 3) + 11)
		const count = Math.round(R * (flora ? 2 : 1.3))
		for (let i = 0; i < count; i++) {
			const a = r() * Math.PI * 2
			const rr = Rc + 3 + r() * (rIn - Rc - 5)
			const [x, z] = polar(rr, a)
			if (forest && flora) {
				forest.add(pick(RIPE, r, flora.seed), 'tree', d.x + x, 0, d.z + z, r() * 6.28, 0.85 + r() * 0.3)
				continue
			}
			const h = 3 + r() * (d.kind === 'home' ? 3 : 6)
			insideTrees.push(new THREE.Matrix4().compose(new THREE.Vector3(d.x + x, 0, d.z + z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)))
			const c = 1.4 + r() * 1.6
			insideCrowns.push(new THREE.Matrix4().compose(new THREE.Vector3(d.x + x, h + c * 0.6, d.z + z), new THREE.Quaternion(), new THREE.Vector3(c, c * 0.8, c)))
		}
		g.position.set(d.x, 0, d.z)
		const body = bake(g)
		scene.add(body)
		own.push(body)
		{
			const trunks = new THREE.InstancedMesh(trunkGeo, treeTrunkMat, insideTrees.length)
			const crowns = new THREE.InstancedMesh(crownGeo, treeCrownMat, insideCrowns.length)
			insideTrees.forEach((mx, i) => trunks.setMatrixAt(i, mx))
			insideCrowns.forEach((mx, i) => crowns.setMatrixAt(i, mx))
			trunks.castShadow = crowns.castShadow = true
			trunks.computeBoundingSphere()
			crowns.computeBoundingSphere()
			scene.add(trunks, crowns)
			own.push(trunks, crowns)
		}
		await pause(`Raising the ${spec.label.toLowerCase()}s`)
	}

	/* ── round the master dome, as in Sandbox 3: café squares off its ring path, hen coops among the trees ── */
	{
		const kit: Kit = {
			box, table: (len, chairs) => table(m, len, chairs), sofa: (len) => sofa(m, len), lantern: (r, y) => lantern(m, r, y),
			oak: m.oak(1), lime: m.lime(1), stone: (rep) => m.stone(rep), dark: m.dark, steel: m.steel, counter: m.counter,
			timber: m.timberFrame, linen: m.linen, cushion: m.cushion, rug: m.rug, paper: m.paper
		}
		// in Sandbox 5 the coops, hutches and playgrounds are mini domes ($lib/models/minidomes.js)
		const mini = !!flora
		for (const sq of [...cafes(kit, SQUARE_R), ...coops(kit, SQUARE_R, mini)]) {
			swap(sq.group)
			scene.add(bake(sq.group))
			colliders.push(...sq.colliders)
		}
		for (const [i, pg] of PLAYGROUNDS.entries()) {
			const p = mini ? playDome(90 + i) : playground(90 + i)
			p.group.position.set(pg.x, 0, pg.z)
			p.group.rotation.y = Math.atan2(pg.x, pg.z)
			scene.add(bake(p.group))
			const c = Math.cos(p.group.rotation.y), sn = Math.sin(p.group.rotation.y)
			for (const q of p.colliders) colliders.push({ x: pg.x + q.x * c + q.z * sn, z: pg.z - q.x * sn + q.z * c, r: q.r })
		}
		const hens = herd('hen', henPatches(SQUARE_R), 73, eye)
		herds.hens = hens.where
		// and in every other coop's place, a hutch of rabbits
		const rabbits = herd('rabbit', rabbitPatches(SQUARE_R), 78, eye)
		for (const f of [hens, rabbits]) {
			scene.add(f.object)
			animated.push(f.update)
		}
	}

	/* ── the food forest: as dense as round a single dome, planted as seven-layer guilds;
	   beyond the medium domes, out to the edges of the cell, a thick forest. It is laid
	   out in tiles: near you every plant is drawn in full, further off simple trees
	   stand in for them, and the tiles swap as you walk. ── */
	type Part = { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean }
	const lowFruit = new THREE.IcosahedronGeometry(1, 0)
	/** A plant, built once and merged per material: the shape every instance of it shares. */
	const species = (obj: THREE.Object3D, shadow: boolean): Part[] => {
		obj.traverse((o) => {
			const mesh = o as THREE.Mesh
			if (mesh.isMesh && mesh.geometry.type === 'SphereGeometry') mesh.geometry = lowFruit
		})
		const g = new THREE.Group()
		g.add(obj)
		return bake(g, shadow).children.map((c) => ({ geo: (c as THREE.Mesh).geometry, mat: (c as THREE.Mesh).material as THREE.Material, shadow }))
	}
	const MAIN: { parts: Part[]; radius: number }[] = []
	const mainPlant = (p: Plant) => MAIN.push({ parts: species(p.object, true), radius: p.radius })
	// Sandbox 5 grows its own (flora, below): none of these are made
	if (!flora) for (const seed of [1, 2]) {
		mainPlant(canopyTree(2000 + seed, 1.2))
		mainPlant(appleTree(2100 + seed, 1.1))
		mainPlant(fruitTree('mango', 2200 + seed, 1.1))
		mainPlant(fruitTree('avocado', 2300 + seed, 1.1))
		mainPlant(fruitTree('citrus', 2400 + seed, 1.15))
		mainPlant(banana(2500 + seed, 3.2))
	}
	// the edge forest has more of everything: papaya, fig, pomegranate, coconut palms
	const EDGE_ONLY = MAIN.length
	if (!flora) for (const seed of [1, 2]) {
		mainPlant(papaya(2600 + seed, 4))
		mainPlant(smallFruitTree('fig', 2700 + seed, 1.2))
		mainPlant(smallFruitTree('pomegranate', 2800 + seed, 1.1))
		mainPlant(coconutPalm(2900 + seed, 11))
	}
	const UNDER: Part[][] = flora ? [] : [
		species(berryBush(3001, 1).object, false),
		species(berryBush(3002, 0.8).object, false),
		species(comfrey(3003, 0.7), false),
		species(clover(3004), false),
		species(squash(3005), false),
		species(climber(3006, 2.6).object, false),
		// and at the edges, every layer fuller still
		species(tropicalShrub('coffee', 3007, 1.4).object, false),
		species(tropicalShrub('cacao', 3008, 1.7).object, false),
		species(ginger(3009, 1), false),
		species(strawberries(3010), false),
		species(passionVine(3011, 2.8).object, false),
		species(herb(3012, 0.4), false)
	]
	// the forest floor, one of each kind drawn once and scattered: moss, mycelium, earth, ant hills, wood, stones, rock
	const FLOOR = FLOOR_KINDS.map((k, i) => species(forestFloor(k, 4000 + i), false))
	/* ── Sandbox 5: the forest grown from our plants (./flora.js), the same guilds in the same places: a tree, and round
	   it its shrubs, its cover and its climbers, each a plant of the middle-European forest garden at its stage
	   (./sandbox5.js). Put down here, grown once the whole cell is laid out. ── */
	/** the ring at the foot of a plant picked in Sandbox 5's forest */
	const ray = new THREE.Raycaster()
	const marker = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff4c8', transparent: true, opacity: 0.85, depthWrite: false }))
	marker.visible = false
	marker.renderOrder = 2
	scene.add(marker)
	type Planted = { kind: ReturnType<typeof pick>; x: number; z: number; s: number }
	const plantedTrees: Planted[] = []
	/** Sandbox 5's forest garden, layer under layer, each at its own spacing (OUTDOOR_SPACING), over the whole cell */
	const plantGarden = async () => {
		const O = flora!.outside, seed = flora!.seed, r = seeded(505)
		/** the trunks so far, filed by 4 m cells: nothing is planted into a trunk */
		const trunks = new Map<number, { x: number; z: number; r: number }[]>()
		const trunkKey = (ix: number, iz: number) => (ix + 512) * 1024 + iz + 512
		/** the mini fields sown so far, each a turned rectangle: nothing else is planted in one */
		const sown: { x: number; z: number; c: number; s: number; hw: number; hl: number }[] = []
		const inField = (x: number, z: number, margin: number) =>
			sown.some((f) => {
				const dx = x - f.x, dz = z - f.z
				return Math.abs(dx * f.c + dz * f.s) < f.hw + margin && Math.abs(-dx * f.s + dz * f.c) < f.hl + margin
			})
		const clearOf = (x: number, z: number, gap: number) => {
			if (inField(x, z, gap)) return false
			const ix = Math.floor(x / 4), iz = Math.floor(z / 4)
			for (let dx = -2; dx <= 2; dx++)
				for (let dz = -2; dz <= 2; dz++) for (const t of trunks.get(trunkKey(ix + dx, iz + dz)) ?? []) if (Math.hypot(t.x - x, t.z - z) < t.r + gap) return false
			return true
		}
		const open = (x: number, z: number, margin: number) => inHex(x, z) && !inDome(x, z, margin + 1) && !inSquare(x, z) && !nearPath(x, z, margin + 0.6) && !nearWater(x, z, W / 2 + margin)
		/** a jittered grid, a point every `every` square metres */
		const grid = async (every: number, label: string, at: (x: number, z: number) => void) => {
			const step = Math.sqrt(every)
			let n = 0
			for (let gx = -WORLD; gx < WORLD; gx += step)
				for (let gz = -WORLD; gz < WORLD; gz += step) {
					at(gx + r() * step, gz + r() * step)
					if (++n % 6000 === 0) await pause(label)
				}
		}
		const tree = (layer: 'canopy' | 'trees', x: number, z: number, keep: number) => {
			const kind = pick(O[layer], r, seed)
			const s = 0.9 + r() * 0.25
			forest!.add(kind, 'tree', x, 0, z, r() * 6.28, s)
			plantedTrees.push({ kind, x, z, s })
			const k = trunkKey(Math.floor(x / 4), Math.floor(z / 4))
			const list = trunks.get(k) ?? []
			list.push({ x, z, r: keep })
			trunks.set(k, list)
		}
		const S = OUTDOOR_SPACING
		/** the fields' tilled soil: one mesh for all of them, ridged along their rows, the furrows darker */
		const soil = { pos: [] as number[], col: [] as number[], idx: [] as number[] }
		const ridge = new THREE.Color('#7a5a3c'), furrow = new THREE.Color('#4e3826')
		const tilled = (x: number, z: number, c: number, sn: number, hw: number, hl: number, row: number) => {
			// across the rows: a ridge under each row, a furrow between
			const steps = Math.max(2, Math.round((hw * 2) / (row / 2)))
			const first = soil.pos.length / 3
			for (let k = 0; k <= steps; k++) {
				const u = -hw + (k / steps) * hw * 2
				const up = k % 2 === 0 ? 0.035 : 0.01
				const tint = k % 2 === 0 ? ridge : furrow
				for (const v of [-hl, hl]) {
					soil.pos.push(x + u * c - v * sn, up, z + u * sn + v * c)
					soil.col.push(tint.r, tint.g, tint.b)
				}
			}
			for (let k = 0; k < steps; k++) {
				const a = first + k * 2
				soil.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
			}
		}
		// first the mini fields, in open ground between where the trees will stand: oats, lentils, chickpeas, edamame,
		// hemp in rows, bamboo in clumps, each field sown at once and so mostly at one stage
		for (const crop of FIELDS) {
			for (let f = 0, tries = 0; f < crop.fields && tries < 400; tries++) {
				const [w, l] = crop.size
				const a = r() * Math.PI * 2, d = 40 + r() * (WORLD - 60)
				const x = Math.cos(a) * d, z = Math.sin(a) * d, turn = r() * Math.PI
				const c = Math.cos(turn), sn = Math.sin(turn), hw = w / 2, hl = l / 2
				// the whole field in open ground, clear of the fields before it
				let fits = !inField(x, z, Math.hypot(hw, hl) + 3)
				for (let u = -1; fits && u <= 1; u += 0.5) for (let v = -1; fits && v <= 1; v += 0.5) {
					const px = x + u * hw * c - v * hl * sn, pz = z + u * hw * sn + v * hl * c
					if (!open(px, pz, 1)) fits = false
				}
				if (!fits) continue
				sown.push({ x, z, c, s: sn, hw, hl })
				if (crop.tilled) tilled(x, z, c, sn, hw + 0.3, hl + 0.3, crop.row)
				f++
				const stage = crop.stages[Math.floor(r() * crop.stages.length)]!
				for (let u = -hw + crop.row / 2; u < hw; u += crop.row)
					for (let v = -hl + crop.gap / 2; v < hl; v += crop.gap) {
						// a row a little crooked, a gap here and there, a plant or two behind or ahead of the rest
						if (r() < 0.04) continue
						const ju = u + (r() - 0.5) * crop.row * 0.25, jv = v + (r() - 0.5) * crop.gap * 0.5
						const px = x + ju * c - jv * sn, pz = z + ju * sn + jv * c
						const at = r() < 0.85 ? stage : crop.stages[Math.floor(r() * crop.stages.length)]!
						forest!.add({ id: crop.id, v: crop.v, stage: at, seed }, crop.reach, px, 0, pz, r() * 6.28, 0.88 + r() * 0.24)
					}
			}
		}
		{
			const g = new THREE.BufferGeometry()
			g.setAttribute('position', new THREE.Float32BufferAttribute(soil.pos, 3))
			g.setAttribute('color', new THREE.Float32BufferAttribute(soil.col, 3))
			g.setIndex(soil.idx)
			g.computeVertexNormals()
			const fields = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }))
			fields.receiveShadow = true
			scene.add(fields)
			// the forest floor's tufts, stones and wood laid before the fields were sown are cleared off them
			const off = (list: THREE.Matrix4[]) => {
				for (let k = list.length - 1; k >= 0; k--) {
					const e = list[k]!.elements
					if (inField(e[12]!, e[14]!, 0.4)) list.splice(k, 1)
				}
			}
			for (const t of tiles.values()) for (const lists of [t.floor, t.under, t.main]) for (const list of lists) off(list)
		}
		await pause('Sowing the fields')
		// for a walk to them from the console: __fields
		;(window as unknown as { __fields?: typeof sown }).__fields = sown
		// the canopy: nut trees (walnut, chestnut, pecan, tree hazel, Korean pine), the lime, the alder, big standards; close, their crowns
		// meeting and overlapping overhead (a trunk every five metres or so)
		await grid(S.canopy, 'Planting the canopy', (x, z) => open(x, z, 3) && clearOf(x, z, 2.8) && tree('canopy', x, z, 2.2))
		// the fruit trees, close under and between them
		await grid(S.trees, 'Planting the fruit trees', (x, z) => {
			if (!open(x, z, 2.4) || !clearOf(x, z, 1.4)) return
			tree('trees', x, z, 1)
			// a climber up a fruit tree now and then: the vine, the kiwi, the hop
			if (r() < 0.2) {
				const b = r() * 6.28
				forest!.add(pick(O.climbers, r, seed), 'shrub', x + Math.cos(b) * 0.8, 0, z + Math.sin(b) * 0.8, r() * 6.28, 0.9 + r() * 0.2)
			}
		})
		/** a drift of one kind round x, z: 5 to 15 of it close together, on a sunflower spiral, most at one stage */
		const drift = (layer: 'shrubs' | 'climbers' | 'herbs' | 'roots' | 'ground' | 'fungi', x: number, z: number, margin: number, keep: number) => {
			const species = planting(O[layer], r)
			const main = stageOf(species, r, seed)
			const n = DRIFT.least + Math.floor(r() * (DRIFT.most - DRIFT.least + 1))
			const gap = DRIFT.gap[layer], turn = r() * 6.28
			for (let k = 0; k < n; k++) {
				const d = gap * Math.sqrt(k + 0.3) * (0.85 + r() * 0.3), a = turn + k * 2.39996
				const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d
				if (!open(px, pz, margin) || !clearOf(px, pz, keep)) continue
				const kind = r() < 0.75 ? main : stageOf(species, r, seed)
				forest!.add(kind, layer === 'shrubs' || layer === 'climbers' ? 'shrub' : 'cover', px, 0, pz, r() * 6.28, 0.85 + r() * 0.3)
			}
		}
		/** a layer's drifts, as many as its spacing asks: a drift every so many plants' worth of ground */
		const drifts = (layer: Parameters<typeof drift>[0], every: number, label: string, margin: number, keep: number) =>
			grid(every * ((DRIFT.least + DRIFT.most) / 2), label, (x, z) => drift(layer, x, z, margin, keep))
		// the shrubs, in drifts between the trunks
		await drifts('shrubs', S.shrubs, 'Planting the shrubs', 1.4, 0.9)
		// climbers on their own canes and posts
		await drifts('climbers', S.climbers, 'Planting the climbers', 1.2, 0.8)
		// and every bit of soil covered: perennial vegetables and herbs, roots, the ground cover, the mushrooms
		for (const [layer, every] of [['herbs', S.herbs], ['roots', S.roots], ['ground', S.ground], ['fungi', S.fungi]] as const) await drifts(layer, every, 'Covering the ground', 0.5, 0.35)
		// and the floor itself under all of it, the biome's cover, may stand wherever the ground is open: not on a path,
		// in the water, a dome, a field or a trunk
		floorOpen = (x, z) => open(x, z, 0.1) && clearOf(x, z, 0.15)
	}
	/** where the floor's cover may stand (set once the garden is planted) */
	let floorOpen = (_x: number, _z: number) => true
	const floorIndex = (r: () => number) => FLOOR_KINDS.indexOf(floorPick(r))
	// and tufts of meadow grass standing up out of the lawn, drawn with the floor, near you
	FLOOR.push(species(grassTuft(0.55), false))
	const TUFT = FLOOR.length - 1
	// Sandbox 5's floor cover: the food forest biome's grasses, moss, flowers, strawberries, ferns, leaves and deadwood,
	// each in its colonies, laid out in tiles round you as you go ($lib/biomes/stream.js) — too dense for the whole cell;
	// all of it near you, thinning out further off, each plant growing out of the ground as you come (so it has no edge)
	const floorCover = flora ? coverStream({ recipe: FLOOR_BIOME, open: (x, z) => floorOpen(x, z), tile: 10, reach: 30, near: 9, thin: 0.22, density: 3.8, seed: 505 }) : null
	if (floorCover) scene.add(floorCover.object)
	const TILE = 70
	type Tile = { cx: number; cz: number; main: THREE.Matrix4[][]; under: THREE.Matrix4[][]; floor: THREE.Matrix4[][]; far: THREE.Matrix4[]; farCrowns: THREE.Matrix4[]; farColors: THREE.Color[]; dense: THREE.Matrix4[]; denseCrowns: THREE.Matrix4[]; denseColors: THREE.Color[]; near?: THREE.Group; farMesh?: THREE.Group; ground?: THREE.Group }
	const tiles = new Map<string, Tile>()
	const tileAt = (x: number, z: number) => {
		const ix = Math.floor(x / TILE), iz = Math.floor(z / TILE)
		const key = `${ix},${iz}`
		let t = tiles.get(key)
		if (!t) tiles.set(key, (t = { cx: (ix + 0.5) * TILE, cz: (iz + 0.5) * TILE, main: MAIN.map(() => []), under: UNDER.map(() => []), floor: FLOOR.map(() => []), far: [], farCrowns: [], farColors: [], dense: [], denseCrowns: [], denseColors: [] }))
		return t
	}
	const greens = ['#3f7a34', '#4f8a38', '#5b9a40', '#2f6a30', '#6aa84a', '#477f3a'].map((c) => new THREE.Color(c))
	const inDome = (x: number, z: number, margin: number) => domes.some((d) => Math.abs(x - d.x) < d.ext + margin && Math.abs(z - d.z) < d.ext + margin && Math.hypot(x - d.x, z - d.z) < d.ext + margin)
	const inSquare = (x: number, z: number) => AROUND_MASTER.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.5)
	const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sv = new THREE.Vector3()
	const mat = (x: number, y: number, z: number, rot: number, sx: number, sy = sx, sz = sx) => new THREE.Matrix4().compose(p.set(x, y, z), q.setFromEuler(e.set(0, rot, 0)), sv.set(sx, sy, sz))
	{
		const r = seeded(99)
		const INNER = 238
		// the guilds: one every 38 m², as round a single dome, on a jittered grid
		const step = Math.sqrt(38)
		let n = 0
		for (let gx = -WORLD; gx < WORLD; gx += step)
			for (let gz = -WORLD; gz < WORLD; gz += step) {
				const x = gx + r() * step, z = gz + r() * step
				if (Math.hypot(x, z) > INNER || !inHex(x, z)) continue
				if (inDome(x, z, 6) || inSquare(x, z) || nearPath(x, z, 3.2) || nearWater(x, z, W / 2 + 2.2)) continue
				if (flora) {
					// Sandbox 5 plants its layers below (plantGarden); here only the forest floor: the same wood, stones
					// and earth as Sandbox 4's, never its stand-in moss
					if (r() < 0.6) {
						const b = r() * 6.28, dd = 1.5 + r() * 2.5
						const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
						const f = floorIndex(r)
						if (FLOOR_KINDS[f] !== 'moss' && !inDome(ox, oz, 2) && !nearPath(ox, oz, 2) && !nearWater(ox, oz, W / 2 + 0.8)) tileAt(ox, oz).floor[f]!.push(mat(ox, 0, oz, r() * 6.28, 0.8 + r() * 0.5))
					}
					continue
				}
				const t = tileAt(x, z)
				const k = Math.floor(r() * EDGE_ONLY)
				const s = 0.8 + r() * 0.6
				const rot = r() * 6.28
				t.main[k]!.push(mat(x, 0, z, rot, s))
				colliders.push({ x, z, r: MAIN[k]!.radius * s + 0.25 })
				// its stand-in from afar: a trunk and a crown the size of the tree
				const h = 3 + s * 2.4
				t.far.push(mat(x, 0, z, rot, 1, h, 1))
				t.farCrowns.push(mat(x, h + s * 1.4, z, rot, s * 2.4, s * 1.9, s * 2.4))
				t.farColors.push(greens[Math.floor(r() * greens.length)]!)
				// and round it, its guild
				const around = (count: number, dist: number, kinds: number[]) => {
					for (let j = 0; j < count; j++) {
						const b = r() * 6.28, dd = dist * (0.6 + r() * 0.6)
						const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
						if (inDome(ox, oz, 2) || nearPath(ox, oz, 1.8) || nearWater(ox, oz, W / 2 + 0.6)) continue
						const kind = kinds[Math.floor(r() * kinds.length)]!
						tileAt(ox, oz).under[kind]!.push(mat(ox, 0, oz, r() * 6.28, 0.7 + r() * 0.5))
					}
				}
				// and under it all, the forest floor
				for (let j = 0; j < (r() < 0.6 ? 1 : 0); j++) {
					const b = r() * 6.28, dd = 1.5 + r() * 2.5
					const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
					if (!inDome(ox, oz, 2) && !nearPath(ox, oz, 2) && !nearWater(ox, oz, W / 2 + 0.8)) tileAt(ox, oz).floor[floorIndex(r)]!.push(mat(ox, 0, oz, r() * 6.28, 0.8 + r() * 0.5))
				}
				around(2, 2.2, [0, 1])
				around(3, 1.6, [2])
				around(4, 2.6, [3])
				if (r() < 0.55) around(1, 2.8, [4])
				if (r() < 0.4) around(1, 1.9, [5])
				if (++n % 400 === 0) await pause('Planting the food forest')
			}
		// beyond the medium domes, out to the edges: a thick food forest, a guild every 20 m²,
		// every layer full and every kind in it
		const dense = Math.sqrt(20)
		for (let gx = -WORLD; gx < WORLD; gx += dense)
			for (let gz = -WORLD; gz < WORLD; gz += dense) {
				const x = gx + r() * dense, z = gz + r() * dense
				const rr = Math.hypot(x, z)
				if (rr < INNER - 6 || !inHex(x, z)) continue
				if (inDome(x, z, 4) || nearPath(x, z, 2.8) || nearWater(x, z, W / 2 + 1.6)) continue
				if (flora) continue
				const t = tileAt(x, z)
				const k = Math.floor(r() * MAIN.length)
				const sz = 0.8 + r() * 0.7
				const rot = r() * 6.28
				t.main[k]!.push(mat(x, 0, z, rot, sz))
				colliders.push({ x, z, r: MAIN[k]!.radius * sz + 0.25 })
				const h = 3 + sz * 2.8
				t.far.push(mat(x, 0, z, rot, 1, h, 1))
				t.farCrowns.push(mat(x, h + sz * 1.3, z, rot, sz * 2.4, sz * 2, sz * 2.4))
				t.farColors.push(greens[Math.floor(r() * greens.length)]!)
				if (r() < 0.45 && !nearPath(x + 2, z, 2) && !nearWater(x + 2, z, W / 2 + 0.8)) tileAt(x + 2, z).floor[floorIndex(r)]!.push(mat(x + 2, 0, z + r(), r() * 6.28, 0.8 + r() * 0.6))
				for (let j = 0; j < 3; j++) {
					const b = r() * 6.28, dd = 1.2 + r() * 1.6
					const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
					if (nearPath(ox, oz, 1.6) || nearWater(ox, oz, W / 2 + 0.5)) continue
					tileAt(ox, oz).under[Math.floor(r() * UNDER.length)]!.push(mat(ox, 0, oz, r() * 6.28, 0.7 + r() * 0.6))
				}
				if (++n % 500 === 0) await pause('Planting the edges')
			}
	}
	// the tufts: everywhere there is open grass (Sandbox 5 has its own floor cover instead)
	if (!flora) {
		const r = seeded(123)
		for (let i = 0; i < 26000; i++) {
			const x = (r() - 0.5) * WORLD * 2, z = (r() - 0.5) * WORLD * 2
			if (!inHex(x, z) || inDome(x, z, 1) || inSquare(x, z) || nearPath(x, z, 1.6) || nearWater(x, z, W / 2 + 0.4)) continue
			tileAt(x, z).floor[TUFT]!.push(mat(x, 0, z, r() * 6.28, 0.6 + r() * 0.8))
		}
	}
	await pause('Planting the edges')
	if (forest) {
		await plantGarden()
		// every kind grown (in workers, side by side), then each tree stands in the walker's way by its trunk
		await forest.grown((done, of) => {
			if (done === of || done % 10 === 0) onProgress(`Growing the forest: ${done} of ${of} kinds`)
		})
		for (const t of plantedTrees) colliders.push({ x: t.x, z: t.z, r: Math.min(0.6, (forest.shape(t.kind)?.foot ?? 0.3) * t.s) + 0.2 })
		// songbirds: robins, blackbirds, great tits, sparrows and chaffinches, each round a few trees of its own —
		// singing up in the crowns, down to the floor to forage, and up again (./birds.js)
		const birdTrees = plantedTrees.flatMap((t) => {
			const sh = forest.shape(t.kind)
			return sh && sh.height * t.s > 2.5 ? [{ x: t.x, z: t.z, height: sh.height * t.s, reach: sh.reach * t.s }] : []
		})
		const birds = songbirds(birdTrees, 160, 81, (x, z) => inHex(x, z) && !inDome(x, z, 1) && !inSquare(x, z) && !nearPath(x, z, 1) && !nearWater(x, z, W / 2 + 0.6), eye)
		scene.add(birds.object)
		animated.push(birds.update)
		// where they are, for a look from the console: __birds.where()
		;(window as unknown as { __birds?: typeof birds }).__birds = birds
		scene.add(forest.group)
		// for a look at its weight from the console: __forest.weight()
		;(window as unknown as { __forest?: Forest }).__forest = forest
		await pause('Growing the forest')
	}
	{
		const trunkMat = new THREE.MeshStandardMaterial({ color: '#6d5238', roughness: 0.9 })
		const crownMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true })
		const crownGeo = new THREE.IcosahedronGeometry(1, 0)
		const inst = (geo: THREE.BufferGeometry, material: THREE.Material, ms: THREE.Matrix4[], shadow: boolean, colors?: THREE.Color[]) => {
			const mesh = new THREE.InstancedMesh(geo, material, ms.length)
			ms.forEach((mx, i) => mesh.setMatrixAt(i, mx))
			colors?.forEach((c, i) => mesh.setColorAt(i, c))
			mesh.castShadow = shadow
			mesh.receiveShadow = true
			mesh.computeBoundingSphere()
			return mesh
		}
		for (const t of tiles.values()) {
			const near = new THREE.Group()
			t.main.forEach((ms, k) => ms.length && MAIN[k]!.parts.forEach((pt) => near.add(inst(pt.geo, pt.mat, ms, pt.shadow))))
			t.under.forEach((ms, k) => ms.length && UNDER[k]!.forEach((pt) => near.add(inst(pt.geo, pt.mat, ms, false))))
			// the forest floor has its own, closer reach: it is only seen near your feet
			const ground = new THREE.Group()
			t.floor.forEach((ms, k) => ms.length && FLOOR[k]!.forEach((pt) => ground.add(inst(pt.geo, pt.mat, ms, false))))
			ground.visible = false
			scene.add(ground)
			t.ground = ground
			near.visible = false
			scene.add(near)
			t.near = near
			const far = new THREE.Group()
			if (t.far.length) far.add(inst(trunkGeo, trunkMat, t.far, true), inst(crownGeo, crownMat, t.farCrowns, true, t.farColors))
			scene.add(far)
			t.farMesh = far
			if (t.dense.length) scene.add(inst(trunkGeo, trunkMat, t.dense, true), inst(crownGeo, crownMat, t.denseCrowns, true, t.denseColors))
		}
	}
	/** Near you the forest in full, further off its stand-ins. */
	const NEAR = 72
	const look = new THREE.Vector3()
	/** Sandbox 5's forest: what is drawn how, for where the eye is and where it looks (cheap unless it moved) */
	const forestTick = () => {
		if (!forest) return
		camera.getWorldDirection(look)
		forest.update(camera.position.x, camera.position.z, look.x, look.z)
	}
	const levelOfDetail = (x: number, z: number, all = false) => {
		forestTick()
		if (all) floorCover?.update(x, z, 999)
		for (const t of tiles.values()) {
			const near = Math.hypot(t.cx - x, t.cz - z) < NEAR
			if (t.near) t.near.visible = near
			if (t.farMesh) t.farMesh.visible = !near
			if (t.ground) t.ground.visible = Math.hypot(t.cx - x, t.cz - z) < 50
		}
	}
	// little lights along the paths, for walking home at night
	{
		const spots: THREE.Vector3[] = []
		for (const ps of paths) for (let i = 0; i < ps.length; i += 9) spots.push(ps[i]!)
		const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 0.55, 8).translate(0, 0.275, 0), m.dark, spots.length)
		const tops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), glowMat, spots.length)
		const m4 = new THREE.Matrix4()
		spots.forEach((p, i) => {
			posts.setMatrixAt(i, m4.makeTranslation(p.x + 1.5, 0, p.z))
			tops.setMatrixAt(i, m4.makeTranslation(p.x + 1.5, 0.6, p.z))
		})
		scene.add(posts, tops)
	}
	// goats and sheep browsing between the domes, geese on the stream
	{
		// goats: browsing between every pair of domes, and out in the edge forest
		const goatPatches = [
			...Array.from({ length: 6 }, (_, k) => polar(176, (k * Math.PI) / 3 + Math.PI / 6 + 0.35)),
			...Array.from({ length: 6 }, (_, k) => polar(268, (k * Math.PI) / 3 + 0.2))
		].map(([x, z]) => ({ x, z, r: 11, n: 5 }))
		// geese: along the river and on every creek, near its pond
		const goosePatches = [
			...Array.from({ length: 6 }, (_, k) => streams[0]![Math.floor((streams[0]!.length * (k + 0.3)) / 6)]!),
			...streams.slice(1).map((ps) => ps[Math.floor(ps.length * 0.75)]!)
		].map((p) => ({ x: p.x, z: p.z, r: 7, n: 6 }))
		// frogs: at the end of every creek, by its pond, and here and there on the river bank
		// on the bank, beside the water rather than in it
		const bank = (ps: THREE.Vector3[], i: number) => {
			const p = ps[Math.max(1, Math.min(ps.length - 2, i))]!, q = ps[Math.max(1, Math.min(ps.length - 2, i)) + 1]!
			const d = q.clone().sub(p).normalize()
			return { x: p.x - d.z * (W / 2 + 1.6), z: p.z + d.x * (W / 2 + 1.6) }
		}
		const frogPatches = [
			...streams.slice(1).map((ps) => bank(ps, ps.length - 12)),
			...Array.from({ length: 4 }, (_, k) => bank(streams[0]!, Math.floor((streams[0]!.length * (k + 0.7)) / 4)))
		].map((p) => ({ x: p.x, z: p.z, r: 1.6, n: 5 }))
		// sheep: a flock beside every other home dome, on the other side of it from the goats (sheep in a food forest:
		// silvopasture), eight to a flock
		const sheepPatches = [0, 2, 4].map((k) => {
			const aim = (k * Math.PI) / 3 + Math.PI / 6 - 0.35
			let [x, z] = polar(176, aim)
			// in the open forest: never on a path, by the water, or near enough a dome to wander into it
			for (let tries = 0; tries < 80 && (nearPath(x, z, 6) || nearWater(x, z, 8) || domes.some((d) => Math.hypot(x - d.x, z - d.z) < d.ext + 16) || AROUND_MASTER.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 10)); tries++) [x, z] = polar(176 + tries * 1.2, aim - tries * 0.012)
			return { x, z, r: 10, n: 8 }
		})
		const goats = herd('goat', goatPatches, 71, eye), geese = herd('goose', goosePatches, 72, eye), frogs = herd('frog', frogPatches, 74, eye)
		const sheep = herd('sheep', sheepPatches, 77, eye)
		herds.frogs = frogs.where
		// bee hives, three or four together, in clearings of the forest round the cell
		const hiveSpots: { x: number; z: number; rot: number }[] = []
		for (let k = 0; k < 16; k++) {
			const aim = (k / 16) * Math.PI * 2 + 0.5
			let [cx, cz] = polar(k % 2 ? 232 : 118, aim)
			// never on a path, by the water, against a dome, or on a playground or café square
			for (let tries = 0; tries < 40 && (nearPath(cx, cz, 5) || nearWater(cx, cz, 6) || domes.some((d) => Math.hypot(cx - d.x, cz - d.z) < d.ext + 8) || AROUND_MASTER.some((c) => Math.hypot(cx - c.x, cz - c.z) < c.r + 5)); tries++) [cx, cz] = polar((k % 2 ? 232 : 118) + tries * 2, aim + tries * 0.02)
			for (let j = 0; j < 3 + (k % 2); j++) hiveSpots.push({ x: cx + j * 1.3, z: cz + (j % 2) * 0.6, rot: aim + Math.PI })
		}
		// fish in every pond
		const pondFish = fishes(ponds.map((pd) => ({ x: pd.x, z: pd.z, r: 6, y: 0.04, n: 10 })), [], 76, eye)
		scene.add(pondFish.object)
		animated.push(pondFish.update)
		const hives = apiary(hiveSpots, 75, eye)
		herds.bees = hives.where
		for (const hs of hiveSpots) colliders.push({ x: hs.x, z: hs.z, r: 0.5 })
		for (const f of [goats, sheep, geese, frogs, hives]) {
			scene.add(f.object)
			animated.push(f.update)
		}
		// ant hills, at random all over the food forest of the cell: never on a path, by the water, against a dome, on a
		// square, or on top of a tree or another hill; the wood ants on them busy as you come near
		{
			const ar = seeded(79)
			const spots: { x: number; z: number; rot: number; size: number }[] = []
			for (let tries = 0; spots.length < 48 && tries < 4000; tries++) {
				const [x, z] = polar(60 + Math.sqrt(ar()) * 235, ar() * Math.PI * 2)
				if (nearPath(x, z, 3) || nearWater(x, z, 4) || domes.some((d) => Math.hypot(x - d.x, z - d.z) < d.ext + 4) || AROUND_MASTER.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 3)) continue
				if (colliders.some((c) => Math.abs(c.x - x) < c.r + 1 && Math.abs(c.z - z) < c.r + 1 && Math.hypot(c.x - x, c.z - z) < c.r + 0.9)) continue
				if (spots.some((q) => Math.hypot(q.x - x, q.z - z) < 12)) continue
				spots.push({ x, z, rot: ar() * Math.PI * 2, size: 0.7 + ar() * 0.6 })
			}
			// their roads run off over the floor, never over a path, into the water or a dome
			const ants = antHills(spots, eye, (x, z) => nearPath(x, z, 0.8) || nearWater(x, z, W / 2 + 0.4) || domes.some((d) => Math.hypot(x - d.x, z - d.z) < d.ext + 1))
			scene.add(ants.object)
			animated.push(ants.update)
			for (const q of spots) colliders.push({ x: q.x, z: q.z, r: 0.75 * q.size })
		}
		// the goats' bleat is a sheep's: both flocks sound it
		herds.goats = () => [...goats.where(), ...sheep.where()]
		herds.geese = geese.where
		for (const ps of [...streams, ...pondFill]) waterPts.push(...ps.filter((_, i) => i % 3 === 0))
		animated.push(flow)
	}
	await pause('Opening the doors')

	/* ── walking: WASD or the touch joystick, drag to look; through a door, into the dome ── */
	const start = doorPoint(master, Math.PI, 10)
	// facing the master dome; where you may stand and how high (canStand, floorHere) is the cell's, below
	const walker = createWalker(camera, renderer.domElement, {
		x: start.x,
		z: start.z,
		yaw: Math.PI,
		pitch: 0.08,
		canStand: (x, z, here, ground, from) => check(x, z, here, ground, from),
		floorAt: (x, z, ground) => floorHere(x, z, ground)
	})
	const pos = walker.position
	// for a look round from the console (and the checks that photograph the cell): __walker.place(x, z, yaw, pitch)
	;(window as unknown as { __walker?: typeof walker }).__walker = walker

	// every tree, pillar and table, filed by 8 m cells for walking ($lib/sandbox-kit/obstacles)
	const blockers = createObstacles(colliders)
	/* ── the full insides: as you walk up to a dome, its whole inside is built into the
	   village a piece at a time, and the simple one steps aside. You walk in through the
	   door with nothing to wait for: its floors, stairs, galleries and terraces are the
	   dome's own (interior.ts). Walk far enough away and it is taken down again. ── */
	/** a few real lights, following you from lamp to lamp inside the dome you are in or at */
	const pool = Array.from({ length: 8 }, () => {
		const light = new THREE.PointLight(LAMP, 0, 10, 2)
		scene.add(light)
		return light
	})
	/** the shown dome nearest you, if you are in it or near it */
	const hereDome = (): number => {
		let best = -1, gap = 30
		for (const i of shown) {
			const d = domes[i]!
			const g = Math.hypot(pos.x - d.x, pos.z - d.z) - d.ext
			if (g < gap) (gap = g), (best = i)
		}
		return best
	}
	const lightNearest = () => {
		const i = hereDome()
		const d = i >= 0 ? domes[i]! : null
		const spots = d && nightNow > 0.01 ? built.get(i)!.spots : []
		const near = spots
			.map((sp, k) => ({ k, dist: (sp.x + d!.x - camera.position.x) ** 2 + (sp.y - camera.position.y) ** 2 * 4 + (sp.z + d!.z - camera.position.z) ** 2 }))
			.sort((a, b) => a.dist - b.dist)
			.slice(0, pool.length)
		pool.forEach((light, j) => {
			const n = near[j]
			if (!n) return void (light.intensity = 0)
			const sp = spots[n.k]!
			light.position.set(sp.x + d!.x, sp.y, sp.z + d!.z)
			light.distance = sp.reach
			light.intensity = sp.base * nightNow
		})
	}
	const show = (i: number, on: boolean) => simple[i]!.forEach((o) => (o.visible = on))
	const gapTo = (i: number) => Math.hypot(pos.x - domes[i]!.x, pos.z - domes[i]!.z) - domes[i]!.ext
	/* Every dome is built once, in the background, the nearest first, while you walk
	   about, and kept: a dome you walk up to is almost always ready long before you
	   reach its door. A built dome is drawn once as it arrives (so the graphics card
	   has it), then simply shown when you are near and hidden when you are not. */
	const KEEP = 6
	// the dome you are at is drawn in full, and the nearest one in full from further off,
	// so its forest is there as you walk up; the others show their simple selves
	const SHOW_WITHIN = 22
	const SHOW_NEAREST = 50
	const nearestBuilt = () => {
		let best = -1, gap = SHOW_NEAREST
		for (const i of built.keys()) if (gapTo(i) < gap) (gap = gapTo(i)), (best = i)
		return best
	}
	const build = (i: number) => {
		const d = domes[i]!
		const job = { i, cancelled: false }
		building = job
		// on film nothing is drawn while the world is readied (__filmDraw): every dome builds in long stretches
		mountInterior(container, d.kind, () => {}, { host: { scene, camera, renderer, x: d.x, z: d.z }, cancelled: () => job.cancelled, hurry: () => gapTo(i) < 12 || filmDraws(), background: () => gapTo(i) > 45 && !filmDraws(), flora: flora ? { garden: flora.inside, seed: flora.seed } : undefined })
			.then((h) => {
				if (building === job) building = null
				if (job.cancelled || !h.embedded) return h.dispose()
				built.set(i, h.embedded)
				h.embedded.setHour(sky.hour())
				lastNear.set(i, performance.now())
				place(i)
			})
			.catch(() => {
				if (building === job) building = null
			})
	}
	/** show a built dome in full when you are near it, its simple self when you are not */
	const place = (i: number) => {
		const dm = built.get(i)
		if (!dm) return
		const near = gapTo(i) < SHOW_WITHIN || i === nearestBuilt()
		if (dm.root.visible !== near) renderer.shadowMap.needsUpdate = true
		dm.root.visible = near
		show(i, !near)
		if (near) shown.add(i)
		else shown.delete(i)
		// Sandbox 5: the simple inside's trees, part of the outside forest, left out where the full inside is shown
		const key = [...shown].sort().join(',')
		if (forest && key !== maskedKey) {
			maskedKey = key
			forest.mask([...shown].map((k) => ({ x: domes[k]!.x, z: domes[k]!.z, r: domes[k]!.R })))
		}
	}
	let maskedKey = ''
	const manageDomes = () => {
		const order = domes.map((_, i) => i).sort((a, b) => gapTo(a) - gapTo(b))
		for (const i of built.keys()) {
			place(i)
			if (gapTo(i) < SHOW_WITHIN) lastNear.set(i, performance.now())
		}
		// the dome you are nearly at comes first: drop a build far away for it
		const urgent = order.find((i) => !built.has(i) && gapTo(i) < 40)
		if (building && urgent !== undefined && building.i !== urgent && gapTo(building.i) > gapTo(urgent) + 40) {
			building.cancelled = true
			building = null
		}
		if (!building) {
			const next = order.find((i) => !built.has(i))
			if (next !== undefined) {
				// room for it: let go of the dome you were near longest ago
				if (built.size >= KEEP) {
					const old = [...built.keys()].filter((i) => !shown.has(i) && !pinned.has(i)).sort((a, b) => (lastNear.get(a) ?? 0) - (lastNear.get(b) ?? 0))[0]
					if (old !== undefined && gapTo(old) > gapTo(next)) {
						built.get(old)!.dispose()
						built.delete(old)
						show(old, true)
					}
				}
				if (built.size < KEEP) build(next)
			}
		}
	}

	/** Where you may stand, and how high: the land, or inside the open dome on its own floors. */
	const DOOR_HALF = 1.1
	const floorHere = (x: number, z: number, f: number) => {
		for (const i of shown) {
			const d = domes[i]!
			if (Math.hypot(x - d.x, z - d.z) < d.ext + 0.3) return built.get(i)!.floorAt(x - d.x, z - d.z, f)
		}
		return 0
	}
	const check = (x: number, z: number, here: number, ground: number, from?: { x: number; z: number }): boolean => {
		if (!inHex(x, z)) return false
		for (let i = 0; i < domes.length; i++) {
			const d = domes[i]!
			const dx = x - d.x, dz = z - d.z
			const rr = Math.hypot(dx, dz)
			if (rr > d.ext + 0.3) continue
			// the open dome: its own floors, walls, rails and furniture
			const full = shown.has(i) ? built.get(i) : undefined
			if (full) {
				const nf = full.floorAt(dx, dz, ground)
				return full.inside(dx, dz, nf) && !full.blocked(dx, dz, here) && !full.hits(dx, dz, nf, from && { x: from.x - d.x, z: from.z - d.z })
			}
			// a dome still growing: in through a door and anywhere on its ground floor, while its
			// full inside arrives round you (the galleries and stairs come with it)
			if (here > 0.5) return false
			if (rr < d.R - 0.8) return true
			// outside the glass, under the terrace arcade, it is open ground: only the pillars stand in it
			if (rr > d.R + 0.4) break
			const a = Math.atan2(dx, dz)
			return DOORS.some((dd) => Math.abs(adiff(a, dd)) < 0.5 && Math.abs(adiff(a, dd)) * rr < DOOR_HALF)
		}
		if (here > 0.5) return false
		return !blockers.blocks(x, z, { from })
	}
	let frame = 0
	let running = true
	let last = performance.now()
	const clock0 = performance.now()
	let lodChecked = 0
	const tick = () => {
		if (!running) return
		const now = performance.now()
		// walk (or, while the film camera holds it, fly); the sun's shadows follow the camera round the cell
		walker.update(Math.min(0.1, (now - last) / 1000))
		sky.follow(camera.position.x, camera.position.z)
		last = now
		const t = worldTime() ?? (now - clock0) / 1000
		for (const a of animated) a(t)
		sky.tick(now)
		if (now - lodChecked > 400) {
			lodChecked = now
			levelOfDetail(camera.position.x, camera.position.z)
			if (!walker.flying()) manageDomes()
			lightNearest()
			// the sounds for where you stand: the forest, the water, the animals; muffled under glass
			const indoors = domes.some((d) => Math.hypot(pos.x - d.x, pos.z - d.z) < d.R - 0.3)
			sound.set(levelsAt(pos.x, pos.z, indoors, waterPts, herds), indoors)
		}
		for (const i of shown) built.get(i)!.update(t)
		forestTick()
		// the floor's cover follows the eye every frame (a tile at most built a frame; it fades in as it nears)
		floorCover?.update(camera.position.x, camera.position.z, filmDraws() ? 999 : 1)
		// the film camera draws the canvas itself while it holds it (src/lib/film)
		if (!filmDraws()) renderer.render(scene, camera)
		// keep it smooth; while a film is shot every frame is rendered at the resolution it asks for
		stage.adapt(now, filmHoldsSize())
		frame = requestAnimationFrame(tick)
	}
	walker.update(0)
	sky.follow(camera.position.x, camera.position.z)
	onProgress('ready')
	tick()

	/* ── the film camera's hold on the cell (src/lib/film, $lib/sandbox-kit/film): every frame set from the shot alone,
	   never from the frame before it. Players never reach any of this. ── */
	/** the domes of the shots a film asked for, the latest last: the latest are kept built (pinned) */
	const recent: number[][] = []
	/** the domes that would be shown in full to a walker standing at x, z once built: all of them must be built before a
	 *  shot from there is filmed, or a dome could appear between two renders of it */
	const nearDomes = (x: number, z: number) => domes.map((d, i) => ({ i, gap: Math.hypot(x - d.x, z - d.z) - d.ext })).filter((d) => d.gap < SHOW_NEAREST).map((d) => d.i)
	/** show or hide each built dome for where the walker stands now (as the world does as you walk) */
	const settle = () => {
		for (const i of built.keys()) place(i)
	}
	const world = connectFilm({
		sandbox: opts.sandbox ?? 'sandbox-4',
		renderer,
		scene,
		camera,
		hold: walker,
		sky,
		place: (x, z, yw, p, y = 0) => walker.place(x, z, yw, p, y),
		animate: (t) => {
			for (const a of animated) a(t)
		},
		// the far forest, the lamps, the open domes; then what the hour gives the lights, before the shot's own changes
		advance: (t) => {
			levelOfDetail(camera.position.x, camera.position.z, true)
			lightNearest()
			for (const i of shown) built.get(i)!.update(t)
			glowMat.emissive.set(GLOW)
			for (const p of pool) p.color.set(LAMP)
			// the glass's sun sheen: off unless the shot turns it up, always towards where the sun is now
			glassSheen.uGlassSheen.value = 0
			glassSheen.uGlassSheenColor.value.set('#ffb070')
			glassSheen.uGlassSun.value.copy(sky.sun.position).sub(sky.sun.target.position).normalize()
		},
		lights: {
			// the low sun glowing on the domes' glass: k is how strongly (0 none; about 1–4 reads as a warm sheen)
			glass: (k, color) => {
				glassSheen.uGlassSheen.value = k
				if (color) glassSheen.uGlassSheenColor.value.set(color)
			},
			glow: (k, color) => {
				glowMat.emissiveIntensity *= k
				if (color) glowMat.emissive.set(color)
			},
			lamps: (k, color) => {
				for (const p of pool) {
					p.intensity *= k
					if (color) p.color.set(color)
				}
			}
		},
		/* stand where the shot needs the cell loaded, and wait until its dome is built and shown, and every dome near
		   enough to be shown in full from there is built too (one arriving later would change the picture between two
		   renders of the shot) */
		stage: async (w) => {
			walker.place(w.stand[0], w.stand[1], 0, 0, 0)
			settle()
			const dome = w.dome
			const need = nearDomes(w.stand[0], w.stand[1])
			for (let waited = 0; ; waited += 100) {
				const now = building?.i ?? null
				const ok = (dome === undefined || (built.has(dome) && shown.has(dome))) && need.every((i) => built.has(i)) && (now === null || !need.includes(now))
				if (ok) break
				if (waited > 20 * 60000) throw new Error(`the world never got ready for this shot (dome ${dome}, near ${need.join(', ')})`)
				// a shot that keeps waiting says what for (the studio's log shows it)
				if (waited && waited % 10000 === 0)
					console.warn(`film: ${(w as { name?: string }).name ?? 'a shot'} waits ${waited / 1000} s — dome ${dome ?? '-'} built ${dome === undefined || built.has(dome)} shown ${dome === undefined || shown.has(dome)}; near ${need.join(',')} built ${need.filter((i) => built.has(i)).join(',') || 'none'}; building ${now}`)
				await new Promise((r) => setTimeout(r, 100))
			}
			// and every animal's skin, meshed off the page, there before the shot is drawn
			await actorsSettled()
			settle()
		},
		holds: (w) => w.dome === undefined || shown.has(w.dome),
		// keep the domes of the shots the film asked for last built while it needs them — never all of them: a pin
		// that only grew would fill every place (KEEP) and no other dome could ever be built
		keep: (ws) => {
			const domesOf = ws.map((w) => w.dome).filter((d): d is number => d !== undefined)
			if (domesOf.length) recent.push(domesOf)
			pinned.clear()
			for (const set of [...recent].reverse())
				for (const i of set) if (pinned.size < KEEP - 1) pinned.add(i)
			while (recent.length > KEEP) recent.shift()
		},
		extra: { herds, built, shown, domes, water: waterPts, playgrounds: PLAYGROUNDS }
	})
	// Sandbox 4's older name for it (the shot lists and the story producer's notes use it)
	;(window as unknown as { __village: unknown }).__village = world

	return {
		domes,
		opening: () => (building && gapTo(building.i) < 25 ? DOMES[domes[building.i]!.kind].label : null),
		pause: () => {
			sound.set({}, false)
			running = false
			cancelAnimationFrame(frame)
		},
		resume: () => {
			if (running) return
			running = true
			last = performance.now()
			walker.stop()
			tick()
		},
		placeAtDoor: (i, door) => {
			const p = doorPoint(domes[i]!, door, 3)
			walker.place(p.x, p.z, door + Math.PI, 0.02)
		},
		move: walker.move,
		look: walker.look,
		pickPlant: (cx, cy) => {
			if (!forest) return null
			const rect = renderer.domElement.getBoundingClientRect()
			ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera)
			const o = ray.ray.origin, d = ray.ray.direction
			let got: PickedPlant | null = null
			const hit = forest.pick(o, d)
			if (hit) got = { id: hit.kind.id, v: hit.kind.v, stage: hit.kind.stage, seed: hit.kind.seed, x: hit.x, z: hit.z, height: hit.height, distance: hit.t, inside: false }
			// and the forests inside the domes built near you, in their own ground
			for (const i of shown) {
				const dm = domes[i]!, inner = built.get(i)?.pickPlant?.(new THREE.Vector3(o.x - dm.x, o.y, o.z - dm.z), d)
				if (inner && (!got || inner.t < got.distance)) got = { id: inner.kind.id, v: inner.kind.v, stage: inner.kind.stage, seed: inner.kind.seed, x: inner.x + dm.x, z: inner.z + dm.z, height: inner.height, distance: inner.t, inside: true }
			}
			marker.visible = !!got
			if (got) {
				marker.position.set(got.x, 0.06, got.z)
				const w = Math.max(0.35, Math.min(3, (hit && !got.inside ? hit.reach : got.height * 0.4)))
				marker.scale.setScalar(w)
			}
			return got
		},
		unpick: () => {
			marker.visible = false
		},
		dispose() {
			running = false
			cancelAnimationFrame(frame)
			if (building) building.cancelled = true
			for (const dm of built.values()) dm.dispose()
			sound.dispose()
			world.disconnect()
			walker.dispose()
			sky.dispose()
			stage.dispose()
		}
	}
}
