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
import { DOMES, DOORS, adiff, bake, box, geodesic, mats, polar, portal, type DomeKind } from './interior'
import { water } from './textures'
import { appleTree, banana, berryBush, canopyTree, climber, clover, comfrey, fruitTree, seeded, squash, type Plant } from './plants'
import { herd } from './animals'
import { gameHour } from '../../../../game/time'

export type VillageDome = { kind: DomeKind; x: number; z: number; R: number; ext: number }
export type VillageHandle = {
	domes: VillageDome[]
	/** stop drawing while a dome's inside is open, and start again */
	pause: () => void
	resume: () => void
	/** stand outside dome i's door, facing away from it */
	placeAtDoor: (i: number, door: number) => void
	dispose: () => void
}

const EYE = 1.65
const WORLD = 380

/** The cell: the master dome, six large domes round it, six medium domes further out between them. */
function layout(): VillageDome[] {
	const make = (kind: DomeKind, x: number, z: number): VillageDome => {
		const R = DOMES[kind].diameter / 2
		return { kind, x, z, R, ext: R + 3.5 }
	}
	const out = [make('master', 0, 0)]
	for (let k = 0; k < 6; k++) out.push(make('large', ...polar(150, (k * Math.PI) / 3)))
	for (let k = 0; k < 6; k++) out.push(make('home', ...polar(200, Math.PI / 6 + (k * Math.PI) / 3)))
	return out
}

export async function mountVillage(container: HTMLElement, onProgress: (label: string) => void, onEnter: (i: number, kind: DomeKind, door: number) => void): Promise<VillageHandle> {
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

	/* ── the sky, and a sun that follows the in-game clock ── */
	const dev = window as unknown as { __interiorHour?: number }
	const hourNow = () => dev.__interiorHour ?? gameHour()
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
	const aimLight = (x: number, z: number) => {
		// snapped to a grid, so the shadows do not shimmer as you walk
		const gx = Math.round(x / 8) * 8, gz = Math.round(z / 8) * 8
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
	const meadow = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: '#c9d9a8', roughness: 1 }))
	meadow.rotation.x = -Math.PI / 2
	meadow.position.y = -0.05
	meadow.receiveShadow = true
	scene.add(meadow)
	const hex = new THREE.Mesh(new THREE.CircleGeometry(WORLD, 6), m.grass)
	hex.rotation.x = -Math.PI / 2
	hex.receiveShadow = true
	scene.add(hex)
	const inHex = (x: number, z: number) => {
		// a pointy-sided hexagon: corners on the x axis
		const ax = Math.abs(x), az = Math.abs(z)
		return az <= WORLD * 0.866 && az * 0.577 + ax <= WORLD
	}

	/** Pushes a line of points out of every dome and its terrace. */
	const clear = (pts: THREE.Vector3[], margin: number, keepEnds = true) => {
		for (let it = 0; it < 4; it++)
			pts.forEach((p, i) => {
				if (keepEnds && (i === 0 || i === pts.length - 1)) return
				for (const d of domes) {
					const dx = p.x - d.x, dz = p.z - d.z
					const r = Math.hypot(dx, dz)
					const need = d.ext + margin
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
	const pathMat = m.stone(1)
	pathMat.side = THREE.DoubleSide
	;(pathMat.map as THREE.Texture).repeat.set(1, 1)
	;(pathMat.bumpMap as THREE.Texture).repeat.set(1, 1)
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
	const onPath = (x: number, z: number, margin: number) => paths.some((ps) => ps.some((p) => Math.abs(p.x - x) < margin && Math.abs(p.z - z) < margin && Math.hypot(p.x - x, p.z - z) < margin))
	await pause('Laying the paths')

	/* ── the stream: a winding loop round the cell, and creeks in between the domes to ponds ── */
	const wtex = water().clone()
	wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping
	wtex.needsUpdate = true
	const wmat = new THREE.MeshStandardMaterial({ map: wtex, color: '#7fe8ef', emissive: '#1f9aa3', emissiveIntensity: 0.5, roughness: 0.12, metalness: 0.1, side: THREE.DoubleSide })
	const streams: THREE.Vector3[][] = []
	const W = 3.6
	{
		const riverR = 305
		const river = clear(Array.from({ length: 48 }, (_, i) => {
			const a = (i / 48) * Math.PI * 2
			const rr = riverR + Math.sin(a * 7) * 14 + Math.sin(a * 3 + 1) * 8
			return new THREE.Vector3(Math.sin(a) * rr, 0, Math.cos(a) * rr)
		}), 8, false)
		streams.push(ribbon(river, W, wmat, 0.08, true))
		// creeks, in between the domes towards the centre, each ending in a pond
		for (let k = 0; k < 6; k++) {
			const aim = (k * Math.PI) / 3 + Math.PI / 6 + (k % 2 ? 0.14 : -0.14)
			const a = new THREE.Vector3(Math.sin(aim) * riverR, 0, Math.cos(aim) * riverR)
			const end = new THREE.Vector3(Math.sin(aim + 0.3) * 104, 0, Math.cos(aim + 0.3) * 104)
			const creek = clear(meander(a, end, 12, 600 + k), 7, false)
			streams.push(ribbon(creek, W * 0.7, wmat, 0.08))
			const last = creek[creek.length - 1]!
			const pond = new THREE.Mesh(new THREE.CircleGeometry(6 + (k % 3), 32), wmat)
			pond.rotation.x = -Math.PI / 2
			pond.position.set(last.x, 0.085, last.z)
			scene.add(pond)
		}
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
	const nearStream = (x: number, z: number, margin: number) => streams.some((ps) => ps.some((p) => Math.abs(p.x - x) < margin && Math.abs(p.z - z) < margin && Math.hypot(p.x - x, p.z - z) < margin))
	// timber bridges wherever a path crosses water
	{
		const bridges = new THREE.Group()
		const placed: THREE.Vector3[] = []
		for (const ps of paths)
			for (let i = 1; i < ps.length - 1; i++) {
				const p = ps[i]!
				if (!nearStream(p.x, p.z, W / 2 + 0.6) || placed.some((b) => b.distanceTo(p) < 8)) continue
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
	const insideTrees: THREE.Matrix4[] = []
	const insideCrowns: THREE.Matrix4[] = []
	for (const d of domes) {
		const spec = DOMES[d.kind]
		const g = new THREE.Group()
		const shell = geodesic(spec, m, d.kind)
		shell.group.position.set(d.x, 0, d.z)
		scene.add(shell.group)
		for (const hole of shell.holes) {
			const pr = portal(m, hole, d.kind)
			pr.position.x += d.x
			pr.position.z += d.z
			scene.add(pr)
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
			const stage = new THREE.Mesh(new THREE.CylinderGeometry(Rc * 0.55, Rc * 0.55, 0.3, 48), m.oak(Rc, Rc))
			stage.position.y = 0.15
			g.add(stage)
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
		scene.add(bake(g))
		await pause(`Raising the ${spec.label.toLowerCase()}s`)
	}
	{
		const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6d5238', roughness: 0.9 }), insideTrees.length)
		const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#4f8a38', roughness: 0.8, flatShading: true }), insideCrowns.length)
		insideTrees.forEach((mx, i) => trunks.setMatrixAt(i, mx))
		insideCrowns.forEach((mx, i) => crowns.setMatrixAt(i, mx))
		trunks.castShadow = crowns.castShadow = true
		scene.add(trunks, crowns)
	}

	/* ── the food forest outside, in seven layers, planted as guilds between it all ── */
	{
		const r = seeded(99)
		// planted in tiles of 100 m, each baked on its own, so what is off screen is skipped
		const tiles = new Map<string, { trees: THREE.Group; under: THREE.Group }>()
		const tile = (x: number, z: number) => {
			const key = `${Math.floor(x / 100)},${Math.floor(z / 100)}`
			let t = tiles.get(key)
			if (!t) tiles.set(key, (t = { trees: new THREE.Group(), under: new THREE.Group() }))
			return t
		}
		const inDome = (x: number, z: number, margin: number) => domes.some((d) => Math.hypot(x - d.x, z - d.z) < d.ext + margin)
		let placed = 0
		for (let tries = 0; placed < 600 && tries < 8000; tries++) {
			const x = (r() - 0.5) * WORLD * 2, z = (r() - 0.5) * WORLD * 2
			if (!inHex(x, z) || Math.hypot(x, z) > WORLD * 0.95) continue
			if (inDome(x, z, 6) || onPath(x, z, 3.2) || nearStream(x, z, W / 2 + 2.4)) continue
			placed++
			const k = r()
			const main: Plant =
				k < 0.24 ? canopyTree(2000 + placed, 0.9 + r() * 0.6)
				: k < 0.48 ? appleTree(2100 + placed, 0.9 + r() * 0.5)
				: k < 0.64 ? fruitTree('mango', 2200 + placed, 0.9 + r() * 0.4)
				: k < 0.78 ? fruitTree('avocado', 2300 + placed, 0.9 + r() * 0.4)
				: k < 0.9 ? fruitTree('citrus', 2400 + placed, 1 + r() * 0.4)
				: banana(2500 + placed, 2.6 + r())
			main.object.position.set(x, 0, z)
			main.object.rotation.y = r() * 6.28
			const { trees, under } = tile(x, z)
			trees.add(main.object)
			colliders.push({ x, z, r: main.radius + 0.25 })
			const around = (n: number, dist: number, make: (seed: number) => THREE.Object3D) => {
				for (let j = 0; j < n; j++) {
					const b = r() * 6.28, dd = dist * (0.6 + r() * 0.6)
					const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
					if (onPath(ox, oz, 1.8) || nearStream(ox, oz, W / 2 + 0.6) || inDome(ox, oz, 2)) continue
					const o = make(3000 + placed * 13 + j)
					o.position.set(ox, 0, oz)
					o.rotation.y = r() * 6.28
					under.add(o)
				}
			}
			around(1, 2.2, (sd) => berryBush(sd, 0.7 + r() * 0.5).object)
			around(1, 1.6, (sd) => comfrey(sd, 0.5 + r() * 0.4))
			around(2, 2.6, (sd) => clover(sd))
			if (r() < 0.4) around(1, 2.8, (sd) => squash(sd))
			if (r() < 0.25) around(1, 1.9, (sd) => climber(sd, 2 + r()).object)
			if (placed % 130 === 0) await pause('Planting the food forest')
		}
		for (const { trees, under } of tiles.values()) {
			scene.add(bake(trees))
			scene.add(bake(under, false))
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
	const animated: ((t: number) => void)[] = []
	{
		const goatPatches = [0.5, 2.6, 4.7].map((a) => ({ x: Math.sin(a) * 275, z: Math.cos(a) * 275, r: 12, n: 4 }))
		const goosePatches = streams.slice(0, 4).map((ps, i) => {
			const p = ps[Math.floor(ps.length * (0.2 + i * 0.2))]!
			return { x: p.x, z: p.z, r: 6, n: 5 }
		})
		for (const f of [herd('goat', goatPatches, 71), herd('goose', goosePatches, 72)]) {
			scene.add(f.object)
			animated.push(f.update)
		}
		animated.push((t) => (wtex.offset.y = -t * 0.3))
	}
	await pause('Opening the doors')

	/* ── walking: WASD, drag to look; through a door, into the dome ── */
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
			yaw -= e.movementX * 0.0025
			pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.0025))
		}
	}
	const onUp = () => (dragging = false)
	dom.addEventListener('mousedown', onDown)
	window.addEventListener('mousemove', onMove)
	window.addEventListener('mouseup', onUp)

	/** Where you may stand: in the hexagon, off the domes except in a doorway. Entering: the dome's index and door. */
	const doorHalf = 1.1
	const check = (x: number, z: number): { ok: boolean; enter?: [number, number] } => {
		if (!inHex(x, z)) return { ok: false }
		for (let i = 0; i < domes.length; i++) {
			const d = domes[i]!
			const dx = x - d.x, dz = z - d.z
			const rr = Math.hypot(dx, dz)
			if (rr > d.ext + 0.3) continue
			const a = Math.atan2(dx, dz)
			const door = DOORS.find((dd) => Math.abs(adiff(a, dd)) < 0.5 && Math.abs(adiff(a, dd)) * rr < doorHalf)
			if (door === undefined) return { ok: false }
			if (rr < d.R - 0.5) return { ok: true, enter: [i, door] }
			return { ok: true }
		}
		if (colliders.some((c) => Math.abs(c.x - x) < 2 && Math.abs(c.z - z) < 2 && Math.hypot(c.x - x, c.z - z) < c.r + 0.25)) return { ok: false }
		return { ok: true }
	}
	let entered = false
	const step = (dt: number) => {
		const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0)
		const s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0)
		yaw += ((keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0)) * 1.8 * dt
		if (f || s) {
			const speed = (keys.has('shift') ? 14.6 : 6.45) * dt
			const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed
			const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed
			for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz]] as const) {
				const c = check(pos.x + mx, pos.z + mz)
				if (!c.ok) continue
				pos.x += mx
				pos.z += mz
				if (c.enter && !entered) {
					entered = true
					keys.clear()
					onEnter(c.enter[0], domes[c.enter[0]]!.kind, c.enter[1])
				}
				break
			}
		}
		camera.position.set(pos.x, EYE, pos.z)
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
		renderer.render(scene, camera)
		frame = requestAnimationFrame(tick)
	}
	step(0)
	onProgress('ready')
	tick()

	;(window as unknown as { __village: unknown }).__village = {
		camera,
		domes,
		fly: (x: number, y: number, z: number, yw: number, p: number) => (flying = [x, y, z, yw, p]),
		place: (x: number, z: number, yw: number, p: number) => {
			flying = null
			pos.set(x, 0, z)
			yaw = yw
			pitch = p
		}
	}

	return {
		domes,
		pause: () => {
			running = false
			cancelAnimationFrame(frame)
		},
		resume: () => {
			if (running) return
			running = true
			last = performance.now()
			keys.clear()
			tick()
		},
		placeAtDoor: (i, door) => {
			const p = doorPoint(domes[i]!, door, 3)
			pos.set(p.x, 0, p.z)
			yaw = door + Math.PI
			pitch = 0.02
			entered = false
		},
		dispose() {
			running = false
			cancelAnimationFrame(frame)
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
