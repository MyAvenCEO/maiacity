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
import { Sky } from 'three/addons/objects/Sky.js'
import { DOMES, DOORS, adiff, bake, box, geodesic, lantern, mats, mountInterior, polar, portal, sofa, table, type DomeKind, type EmbeddedDome } from './interior'
import { cafes, coops, coopsAround, henPatches, playground, squaresAround, type Kit } from './spaces'
import { water } from './textures'
import { appleTree, banana, berryBush, canopyTree, climber, clover, coconutPalm, comfrey, fruitTree, ginger, herb, papaya, passionVine, seeded, smallFruitTree, squash, strawberries, tropicalShrub, forestFloor, FLOOR_KINDS, floorPick, grassTuft, type Plant } from './plants'
import { apiary, fishes, herd } from './animals'
import { flow, pond, shore, stream } from './water'
import { gameHour } from '../../../../game/time'
import { ambience, levelsAt } from './ambience'

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
	/** keep the sky at day whatever the hour (the clock runs on), or follow the clock again */
	alwaysDay: (on: boolean) => void
	dispose: () => void
}

const EYE = 1.65
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

export async function mountVillage(container: HTMLElement, onProgress: (label: string) => void): Promise<VillageHandle> {
	const pause = async (label: string) => {
		onProgress(label)
		await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
	}
	const renderer = new THREE.WebGLRenderer({ antialias: true })
	renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio))
	renderer.setSize(container.clientWidth, container.clientHeight)
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 0.42
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	container.appendChild(renderer.domElement)
	const scene = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(68, container.clientWidth / container.clientHeight, 0.1, 2400)
	const m = mats()
	const domes = layout()
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
	const lastNear = new Map<number, number>()
	let nightNow = 0

	/* ── the sky, and a sun that follows the in-game clock ── */
	const dev = window as unknown as { __interiorHour?: number }
	/** the hour the sky shows when it is kept at day: late morning, the shadows still long enough to read */
	const DAY_HOUR = 11
	let keepDay = false
	const hourNow = () => dev.__interiorHour ?? (keepDay ? DAY_HOUR : gameHour())
	const sunAt = (hour: number) => {
		const e = Math.sin(((hour - 5) / 15) * Math.PI)
		const alt = e * THREE.MathUtils.degToRad(68)
		const az = THREE.MathUtils.degToRad(90 + ((hour - 5) / 15) * 180)
		return { dir: new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - alt, az), e }
	}
	const sky = new Sky()
	sky.scale.setScalar(4000)
	const u = sky.material.uniforms
	u['turbidity']!.value = 3
	u['rayleigh']!.value = 1.2
	u['mieCoefficient']!.value = 0.004
	u['mieDirectionalG']!.value = 0.8
	scene.add(sky)
	const pmrem = new THREE.PMREMGenerator(renderer)
	const envScene = new THREE.Scene()
	const envSky = new Sky()
	envSky.scale.setScalar(1000)
	Object.assign(envSky.material.uniforms, THREE.UniformsUtils.clone(sky.material.uniforms))
	envScene.add(envSky)
	const sunLight = new THREE.DirectionalLight('#fff1d8', 2.4)
	sunLight.castShadow = true
	sunLight.shadow.mapSize.set(4096, 4096)
	const sc = sunLight.shadow.camera
	sc.left = sc.bottom = -170
	sc.right = sc.top = 170
	sc.near = 10
	sc.far = 1400
	sunLight.shadow.bias = -0.0005
	sunLight.shadow.normalBias = 0.05
	scene.add(sunLight, sunLight.target)
	const fill = new THREE.HemisphereLight('#f4f0e6', '#6d5a3c', 0.4)
	scene.add(fill)
	scene.fog = new THREE.Fog('#e3e9e6', 180, 1400)
	const glowMat = new THREE.MeshStandardMaterial({ color: '#fff0d0', emissive: '#ffc070', emissiveIntensity: 0.1 })
	const warm = new THREE.Color('#ffb070'), white = new THREE.Color('#fff1d8'), moon = new THREE.Color('#8ea6dc')
	let envAt: THREE.Vector3 | null = null
	/** where the light comes from, sun or moon: the shadows follow you, the direction stays the sky's */
	const lightDir = new THREE.Vector3(0, 1, 0)
	const lastDir = new THREE.Vector3()
	renderer.shadowMap.autoUpdate = false
	const aimLight = (x: number, z: number) => {
		// snapped to a grid, so the shadows do not shimmer as you walk; and drawn again only
		// when that changes or the sun has moved, not every frame
		const gx = Math.round(x / 8) * 8, gz = Math.round(z / 8) * 8
		if (gx !== sunLight.target.position.x || gz !== sunLight.target.position.z || !lightDir.equals(lastDir)) {
			renderer.shadowMap.needsUpdate = true
			lastDir.copy(lightDir)
		}
		sunLight.target.position.set(gx, 0, gz)
		sunLight.position.copy(lightDir).multiplyScalar(700).add(sunLight.target.position)
	}
	const setSun = (hour: number) => {
		const { dir, e } = sunAt(hour)
		const day = THREE.MathUtils.smoothstep(e, -0.05, 0.35)
		const low = 1 - THREE.MathUtils.smoothstep(e, 0, 0.6)
		u['sunPosition']!.value.copy(dir)
		lightDir.copy(e > -0.02 ? dir : dir.clone().negate().setY(Math.abs(dir.y) + 0.4).normalize())
		aimLight(sunLight.target.position.x, sunLight.target.position.z)
		sunLight.color.copy(e > -0.02 ? white.clone().lerp(warm, low) : moon)
		sunLight.intensity = e > -0.02 ? 0.5 + 2.5 * day : 1.1
		fill.intensity = 0.34 + 0.08 * day
		fill.color.set('#f4f0e6').lerp(moon, 1 - day)
		;(scene.fog as THREE.Fog).color.set('#e3e9e6').lerp(new THREE.Color('#1c2438'), 1 - day)
		scene.environmentIntensity = 0.12 + 0.18 * day
		renderer.toneMappingExposure = 0.42 + 0.5 * (1 - day)
		glowMat.emissiveIntensity = 0.1 + 2.4 * (1 - THREE.MathUtils.smoothstep(e, -0.02, 0.18))
		nightNow = 1 - THREE.MathUtils.smoothstep(e, -0.02, 0.18)
		for (const dm of built.values()) dm.setHour(hour)
		if (!envAt || envAt.angleTo(dir) > 0.04) {
			envAt = dir.clone()
			envSky.material.uniforms['sunPosition']!.value.copy(dir)
			const old = scene.environment
			scene.environment = pmrem.fromScene(envScene).texture
			old?.dispose()
		}
	}
	setSun(hourNow())
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
	const hex = new THREE.Mesh(new THREE.ShapeGeometry(hexShape, 48), m.grass)
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
		// from the door that faces the centre, in to the master's ring
		const door = doorToward(d, 0, 0)
		const a = doorPoint(d, door, 2.6)
		const target = doorPoint(master, doorToward(master, d.x, d.z), 2.6)
		const aim = Math.atan2(a.x, a.z)
		const [bx, bz] = polar(master.ext + 2.6, aim)
		const b = new THREE.Vector3(bx, 0, bz)
		addPath(clear(meander(a, d.kind === 'large' ? target : b, 5, 300 + i), 3))
	})
	// a loop round the whole cell, and a short path out to it from every outer door
	const loopR = 252
	const loop = clear(Array.from({ length: 40 }, (_, i) => {
		const a = (i / 40) * Math.PI * 2
		const rr = loopR + Math.sin(a * 5) * 9
		return new THREE.Vector3(Math.sin(a) * rr, 0, Math.cos(a) * rr)
	}), 6, false)
	addPath(loop, 2.4, true)
	domes.slice(1).forEach((d, i) => {
		const door = doorToward(d, d.x * 2, d.z * 2)
		const a = doorPoint(d, door, 2.6)
		const aim = Math.atan2(a.x, a.z)
		const b = new THREE.Vector3(Math.sin(aim) * (loopR + Math.sin(aim * 5) * 9), 0, Math.cos(aim) * (loopR + Math.sin(aim * 5) * 9))
		addPath(clear(meander(a, b, 3, 400 + i), 3))
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
		for (const hole of shell.holes) {
			const pr = portal(m, hole, d.kind)
			pr.position.x += d.x
			pr.position.z += d.z
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
		// the forest inside, as simple trees: enough to see through the glass
		const r = seeded(Math.round(d.x * 7 + d.z * 3) + 11)
		const count = Math.round(R * 1.3)
		for (let i = 0; i < count; i++) {
			const a = r() * Math.PI * 2
			const rr = Rc + 3 + r() * (rIn - Rc - 5)
			const [x, z] = polar(rr, a)
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
		for (const sq of [...cafes(kit, SQUARE_R), ...coops(kit, SQUARE_R)]) {
			scene.add(bake(sq.group))
			colliders.push(...sq.colliders)
		}
		for (const [i, pg] of PLAYGROUNDS.entries()) {
			const p = playground(90 + i)
			p.group.position.set(pg.x, 0, pg.z)
			p.group.rotation.y = Math.atan2(pg.x, pg.z)
			scene.add(bake(p.group))
			const c = Math.cos(p.group.rotation.y), sn = Math.sin(p.group.rotation.y)
			for (const q of p.colliders) colliders.push({ x: pg.x + q.x * c + q.z * sn, z: pg.z - q.x * sn + q.z * c, r: q.r })
		}
		const hens = herd('hen', henPatches(SQUARE_R), 73)
		herds.hens = hens.where
		scene.add(hens.object)
		animated.push(hens.update)
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
	for (const seed of [1, 2]) {
		mainPlant(canopyTree(2000 + seed, 1.2))
		mainPlant(appleTree(2100 + seed, 1.1))
		mainPlant(fruitTree('mango', 2200 + seed, 1.1))
		mainPlant(fruitTree('avocado', 2300 + seed, 1.1))
		mainPlant(fruitTree('citrus', 2400 + seed, 1.15))
		mainPlant(banana(2500 + seed, 3.2))
	}
	// the edge forest has more of everything: papaya, fig, pomegranate, coconut palms
	const EDGE_ONLY = MAIN.length
	for (const seed of [1, 2]) {
		mainPlant(papaya(2600 + seed, 4))
		mainPlant(smallFruitTree('fig', 2700 + seed, 1.2))
		mainPlant(smallFruitTree('pomegranate', 2800 + seed, 1.1))
		mainPlant(coconutPalm(2900 + seed, 11))
	}
	const UNDER: Part[][] = [
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
	const floorIndex = (r: () => number) => FLOOR_KINDS.indexOf(floorPick(r))
	// and tufts of meadow grass standing up out of the lawn, drawn with the floor, near you
	FLOOR.push(species(grassTuft(0.55), false))
	const TUFT = FLOOR.length - 1
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
	// the tufts: everywhere there is open grass
	{
		const r = seeded(123)
		for (let i = 0; i < 26000; i++) {
			const x = (r() - 0.5) * WORLD * 2, z = (r() - 0.5) * WORLD * 2
			if (!inHex(x, z) || inDome(x, z, 1) || inSquare(x, z) || nearPath(x, z, 1.6) || nearWater(x, z, W / 2 + 0.4)) continue
			tileAt(x, z).floor[TUFT]!.push(mat(x, 0, z, r() * 6.28, 0.6 + r() * 0.8))
		}
	}
	await pause('Planting the edges')
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
	const levelOfDetail = (x: number, z: number) => {
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
		const tops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 10, 8), glowMat, spots.length)
		const m4 = new THREE.Matrix4()
		spots.forEach((p, i) => {
			posts.setMatrixAt(i, m4.makeTranslation(p.x + 1.5, 0, p.z))
			tops.setMatrixAt(i, m4.makeTranslation(p.x + 1.5, 0.6, p.z))
		})
		scene.add(posts, tops)
	}
	// goats browsing between the domes, geese on the stream
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
		const goats = herd('goat', goatPatches, 71), geese = herd('goose', goosePatches, 72), frogs = herd('frog', frogPatches, 74)
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
		const pondFish = fishes(ponds.map((pd) => ({ x: pd.x, z: pd.z, r: 6, y: 0.04, n: 10 })), [], 76)
		scene.add(pondFish.object)
		animated.push(pondFish.update)
		const hives = apiary(hiveSpots, 75)
		herds.bees = hives.where
		for (const hs of hiveSpots) colliders.push({ x: hs.x, z: hs.z, r: 0.5 })
		for (const f of [goats, geese, frogs, hives]) {
			scene.add(f.object)
			animated.push(f.update)
		}
		herds.goats = goats.where
		herds.geese = geese.where
		for (const ps of [...streams, ...pondFill]) waterPts.push(...ps.filter((_, i) => i % 3 === 0))
		animated.push(flow)
	}
	await pause('Opening the doors')

	/* ── walking: WASD or the touch joystick, drag to look; through a door, into the dome ── */
	const start = doorPoint(master, Math.PI, 10)
	const pos = new THREE.Vector3(start.x, 0, start.z)
	// facing the master dome
	let yaw = Math.PI
	let pitch = 0.08
	const keys = new Set<string>()
	const onKey = (e: KeyboardEvent, down: boolean) => {
		const k = e.key.toLowerCase()
		if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
			if (down) keys.add(k)
			else keys.delete(k)
			e.preventDefault()
		}
	}
	const kd = (e: KeyboardEvent) => onKey(e, true)
	const ku = (e: KeyboardEvent) => onKey(e, false)
	window.addEventListener('keydown', kd)
	window.addEventListener('keyup', ku)
	const dom = renderer.domElement
	let dragging = false
	const onDown = () => {
		dragging = true
		dom.requestPointerLock?.()
	}
	const onMove = (e: MouseEvent) => {
		if (document.pointerLockElement === dom || dragging) {
			yaw -= e.movementX * 0.0042
			pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.0042))
		}
	}
	const onUp = () => (dragging = false)
	dom.addEventListener('mousedown', onDown)
	window.addEventListener('mousemove', onMove)
	window.addEventListener('mouseup', onUp)
	// on a phone the page's fingers walk (move) and look round (look)
	dom.style.touchAction = 'none'
	const stick = { x: 0, y: 0, hurry: false }

	// every tree, pillar and table, filed by 8 m cells for walking
	const blockers = new Map<string, { x: number; z: number; r: number }[]>()
	for (const c of colliders) {
		const key = `${Math.floor(c.x / 8)},${Math.floor(c.z / 8)}`
		const list = blockers.get(key)
		if (list) list.push(c)
		else blockers.set(key, [c])
	}
	/* ── the full insides: as you walk up to a dome, its whole inside is built into the
	   village a piece at a time, and the simple one steps aside. You walk in through the
	   door with nothing to wait for: its floors, stairs, galleries and terraces are the
	   dome's own (interior.ts). Walk far enough away and it is taken down again. ── */
	/** a few real lights, following you from lamp to lamp inside the dome you are in or at */
	const pool = Array.from({ length: 8 }, () => {
		const light = new THREE.PointLight('#ffc98a', 0, 10, 2)
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
		mountInterior(container, d.kind, () => {}, { host: { scene, camera, renderer, x: d.x, z: d.z }, cancelled: () => job.cancelled, hurry: () => gapTo(i) < 12, background: () => gapTo(i) > 45 })
			.then((h) => {
				if (building === job) building = null
				if (job.cancelled || !h.embedded) return h.dispose()
				built.set(i, h.embedded)
				h.embedded.setHour(hourNow())
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
	}
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
					const old = [...built.keys()].filter((i) => !shown.has(i)).sort((a, b) => (lastNear.get(a) ?? 0) - (lastNear.get(b) ?? 0))[0]
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
	/** the floor you truly stand on, and your feet easing after it (for a smooth eye) */
	let ground = 0
	let feet = 0
	const floorHere = (x: number, z: number, f: number) => {
		for (const i of shown) {
			const d = domes[i]!
			if (Math.hypot(x - d.x, z - d.z) < d.ext + 0.3) return built.get(i)!.floorAt(x - d.x, z - d.z, f)
		}
		return 0
	}
	const check = (x: number, z: number, here: number): boolean => {
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
				return full.inside(dx, dz, nf) && !full.blocked(dx, dz, here) && !full.hits(dx, dz, nf)
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
		const ix = Math.floor(x / 8), iz = Math.floor(z / 8)
		for (let dx = -1; dx <= 1; dx++)
			for (let dz = -1; dz <= 1; dz++)
				for (const c of blockers.get(`${ix + dx},${iz + dz}`) ?? []) if (Math.hypot(c.x - x, c.z - z) < c.r + 0.25) return false
		return true
	}
	/* round a tree, a pillar or a wall rather than stopping at it: the stride is turned a little
	   at a time, either way, until it is free, and slowed the further it must turn. The side
	   last taken is tried first, so you keep going round the same way and do not waver. */
	const TURNS = [25, 50, 75, 90].map((d) => (d * Math.PI) / 180)
	let side = 1
	const round = (go: (mx: number, mz: number) => boolean, sx: number, sz: number) => {
		for (const a of TURNS) {
			const len = Math.max(0.4, Math.cos(a))
			for (const sg of [side, -side]) {
				const c = Math.cos(a * sg), sn = Math.sin(a * sg)
				if (go((sx * c - sz * sn) * len, (sx * sn + sz * c) * len)) {
					side = sg
					return true
				}
			}
		}
		return false
	}
	const step = (dt: number) => {
		const clamp = (v: number) => Math.max(-1, Math.min(1, v))
		const f = clamp((keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) + stick.y)
		const s = clamp((keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) + stick.x)
		yaw += ((keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0)) * 1.8 * dt
		if (f || s) {
			const speed = (keys.has('shift') || stick.hurry ? 14.6 : 6.45) * dt
			const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed
			const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed
			// in short strides, each reaching up from the floor you stand on, so a stair climbs
			// as well at a hurry, and on a slow phone, as at a stroll
			const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.25))
			const sx = dx / n, sz = dz / n
			for (let k = 0; k < n; k++) {
				const here = floorHere(pos.x, pos.z, ground)
				const go = (mx: number, mz: number) => {
					if (!check(pos.x + mx, pos.z + mz, here)) return false
					pos.x += mx
					pos.z += mz
					return true
				}
				if (!go(sx, sz) && !round(go, sx, sz)) {
					// nothing to step round to: slide along the ground's own axes, as before
					if (!go(sx, 0)) go(0, sz)
				}
				ground = floorHere(pos.x, pos.z, ground)
			}
		}
		ground = floorHere(pos.x, pos.z, ground)
		feet += (ground - feet) * Math.min(1, dt * 12)
		camera.position.set(pos.x, feet + EYE, pos.z)
		camera.rotation.set(pitch, yaw, 0, 'YXZ')
		// the sun's shadows follow you round the cell
		aimLight(pos.x, pos.z)
	}

	const onResize = () => {
		camera.aspect = container.clientWidth / container.clientHeight
		camera.updateProjectionMatrix()
		renderer.setSize(container.clientWidth, container.clientHeight)
	}
	window.addEventListener('resize', onResize)
	let frame = 0
	let running = true
	let last = performance.now()
	const clock0 = performance.now()
	let sunChecked = 0
	let lodChecked = 0
	let frames = 0, fpsSince = performance.now()
	let flying: number[] | null = null
	const tick = () => {
		if (!running) return
		const now = performance.now()
		if (flying) {
			camera.position.set(flying[0]!, flying[1]!, flying[2]!)
			camera.rotation.set(flying[4]!, flying[3]!, 0, 'YXZ')
		} else step(Math.min(0.1, (now - last) / 1000))
		last = now
		const t = (now - clock0) / 1000
		for (const a of animated) a(t)
		if (now - sunChecked > 1000) {
			sunChecked = now
			setSun(hourNow())
		}
		if (now - lodChecked > 400) {
			lodChecked = now
			levelOfDetail(camera.position.x, camera.position.z)
			if (!flying) manageDomes()
			lightNearest()
			// the sounds for where you stand: the forest, the water, the animals; muffled under glass
			const indoors = domes.some((d) => Math.hypot(pos.x - d.x, pos.z - d.z) < d.R - 0.3)
			sound.set(levelsAt(pos.x, pos.z, indoors, waterPts, herds), indoors)
		}
		for (const i of shown) built.get(i)!.update(t)
		renderer.render(scene, camera)
		// keep it smooth: lower the resolution a little when frames get slow, raise it when there is room
		frames++
		if (now - fpsSince > 1500) {
			const fps = (frames * 1000) / (now - fpsSince)
			const pr = renderer.getPixelRatio()
			const top = Math.min(1.25, window.devicePixelRatio)
			if (fps < 40 && pr > 1) renderer.setPixelRatio(Math.max(1, pr - 0.1))
			else if (fps > 56 && pr < top) renderer.setPixelRatio(Math.min(top, pr + 0.1))
			frames = 0
			fpsSince = now
		}
		frame = requestAnimationFrame(tick)
	}
	step(0)
	onProgress('ready')
	tick()

	;(window as unknown as { __village: unknown }).__village = {
		camera,
		scene,
		THREE,
		herds,
		renderer,
		built,
		shown,
		domes,
		fly: (x: number, y: number, z: number, yw: number, p: number) => (flying = [x, y, z, yw, p]),
		place: (x: number, z: number, yw: number, p: number, y = 0) => {
			flying = null
			ground = feet = y
			pos.set(x, 0, z)
			yaw = yw
			pitch = p
		}
	}

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
			keys.clear()
			Object.assign(stick, { x: 0, y: 0, hurry: false })
			tick()
		},
		placeAtDoor: (i, door) => {
			const p = doorPoint(domes[i]!, door, 3)
			pos.set(p.x, 0, p.z)
			yaw = door + Math.PI
			pitch = 0.02
		},
		move: (x, y, hurry) => Object.assign(stick, { x, y, hurry }),
		look: (dx, dy) => {
			yaw -= dx * 0.0065
			pitch = Math.max(-1.4, Math.min(1.4, pitch - dy * 0.0065))
		},
		alwaysDay: (on) => {
			keepDay = on
			setSun(hourNow())
		},
		dispose() {
			running = false
			cancelAnimationFrame(frame)
			if (building) building.cancelled = true
			for (const dm of built.values()) dm.dispose()
			sound.dispose()
			window.removeEventListener('keydown', kd)
			window.removeEventListener('keyup', ku)
			window.removeEventListener('mousemove', onMove)
			window.removeEventListener('mouseup', onUp)
			window.removeEventListener('resize', onResize)
			if (document.pointerLockElement === dom) document.exitPointerLock()
			scene.traverse((o) => {
				const mesh = o as THREE.Mesh
				mesh.geometry?.dispose()
			})
			pmrem.dispose()
			renderer.dispose()
			dom.remove()
		}
	}
}
