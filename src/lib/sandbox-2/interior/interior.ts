/**
 * INSIDE A DOME — a walkable, first-person interior for each dome of a village:
 *
 *   glamp   16 m   a home for four under canvas and glass, a door onto a deck
 *   home    40 m   the dome homes of the first ring
 *   large   70 m   the large domes of the second ring
 *   master 136 m   the master dome in the centre, with a waterfall from its crown
 *
 * The big domes have four doors, one to each point of the compass (the
 * glamping dome one), and every dome stands in a
 * seven-layer food forest with streams and paths. The big domes follow one
 * plan. The private rooms are on galleries round the edge — two floors of them
 * in the large and master domes — facing out through the glass onto terraces
 * carried on a stone arcade. The ground floor is shared:
 * a stone plaza in the middle, paths winding through a food forest of mango,
 * avocado, citrus, banana and coconut, a stream running to a pond, raised
 * beds, and under the gallery the kitchen and the aquaponics.
 *
 * Noon sun, a physical sky for the light and reflections, real-world surfaces
 * painted at runtime (textures.ts), plants from plants.ts.
 */
import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { flagstone, leaves, limestone, oak, soil, water } from './textures'
import { appleTree, banana, berryBush, canopyTree, climber, clover, coconutPalm, comfrey, fruitTree, herb, seeded, shrub, squash, type Plant } from './plants'

export type DomeKind = 'glamp' | 'home' | 'large' | 'master'

type Spec = { diameter: number; detail: number; strut: number; gallery?: { height: number; depth: number; rooms: number; floors: 1 | 2 } }
export const DOMES: Record<DomeKind, Spec & { label: string; people: string }> = {
	glamp: { label: 'Glamping dome', people: 'four people', diameter: 16, detail: 3, strut: 0.06 },
	home: { label: 'Dome home', people: 'twelve people', diameter: 40, detail: 4, strut: 0.09, gallery: { height: 4.2, depth: 6.5, rooms: 6, floors: 1 } },
	large: { label: 'Large dome', people: 'twenty-four people', diameter: 70, detail: 5, strut: 0.12, gallery: { height: 5, depth: 8, rooms: 8, floors: 2 } },
	master: { label: 'Master dome', people: 'the commons, and whoever the rings cannot house yet', diameter: 136, detail: 7, strut: 0.16, gallery: { height: 6, depth: 10, rooms: 12, floors: 2 } }
}

const EYE = 1.65
/** The big domes have four doors, one to each point of the compass; the glamping dome has one. */
const DOORS = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
const doorsOf = (kind: DomeKind) => (kind === 'glamp' ? [0] : DOORS)
/** The signed difference between two angles, in -π..π. */
const adiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/** A texture tiled to a world size: `metres` of surface per repeat of the image. */
function tiled(tex: THREE.Texture, repeatX: number, repeatY = repeatX): THREE.Texture {
	const t = tex.clone()
	t.repeat.set(repeatX, repeatY)
	t.wrapS = t.wrapT = THREE.RepeatWrapping
	t.needsUpdate = true
	return t
}

const mats = () => {
	const flag = flagstone()
	return {
		stone: (rep: number) => new THREE.MeshStandardMaterial({ map: tiled(flag.map, rep), bumpMap: tiled(flag.bump, rep), bumpScale: 2, roughness: 0.85 }),
		lime: (rx: number, ry = rx) => new THREE.MeshStandardMaterial({ map: tiled(limestone(), rx, ry), roughness: 0.9 }),
		oak: (rx: number, ry = rx) => new THREE.MeshStandardMaterial({ map: tiled(oak(), rx, ry), roughness: 0.82, envMapIntensity: 0.4 }),
		soil: (rep: number) => new THREE.MeshStandardMaterial({ map: tiled(soil(), rep), roughness: 1 }),
		water: (rep: number) => new THREE.MeshPhysicalMaterial({ map: tiled(water(), rep), roughness: 0.08, metalness: 0, transparent: true, opacity: 0.88, envMapIntensity: 1.4 }),
		steel: new THREE.MeshStandardMaterial({ color: '#2e3236', roughness: 0.4, metalness: 0.7 }),
		timberFrame: new THREE.MeshStandardMaterial({ color: '#9c6b3f', roughness: 0.6 }),
		glass: new THREE.MeshPhysicalMaterial({ color: '#eef6f4', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false }),
		canvas: new THREE.MeshStandardMaterial({ color: '#efe8da', roughness: 0.95, side: THREE.DoubleSide }),
		linen: new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.95 }),
		cushion: new THREE.MeshStandardMaterial({ color: '#c47a4a', roughness: 0.9 }),
		sofa: new THREE.MeshStandardMaterial({ color: '#c9b596', roughness: 0.95 }),
		counter: new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.3 }),
		dark: new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.5, metalness: 0.4 }),
		paper: new THREE.MeshStandardMaterial({ color: '#fff4e2', emissive: '#ffd9a0', emissiveIntensity: 0.6, roughness: 0.9 }),
		rug: new THREE.MeshStandardMaterial({ color: '#b9a589', roughness: 1 }),
		pebble: new THREE.MeshStandardMaterial({ color: '#8d8a83', roughness: 0.9 }),
		tank: new THREE.MeshStandardMaterial({ color: '#56666b', roughness: 0.5, metalness: 0.3 }),
		grass: new THREE.MeshStandardMaterial({ color: '#7fa35a', roughness: 1 })
	}
}
type Mats = ReturnType<typeof mats>

/** Polar placement: angle 0 faces +z, clockwise to +x — the same sense as three's cylinders. */
const polar = (r: number, a: number): [number, number] => [r * Math.sin(a), r * Math.cos(a)]

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, rotY = 0): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
	m.position.set(x, y + h / 2, z)
	m.rotation.y = rotY
	m.castShadow = m.receiveShadow = true
	return m
}

/** Bakes a group into one mesh per material, so a forest costs a handful of draw calls. */
function bake(group: THREE.Group, shadows = true): THREE.Group {
	group.updateMatrixWorld(true)
	const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
	group.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return
		const g = o.geometry.clone().applyMatrix4(o.matrixWorld)
		for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
		const list = byMat.get(o.material as THREE.Material) ?? []
		list.push(g.index ? g.toNonIndexed() : g)
		byMat.set(o.material as THREE.Material, list)
	})
	const out = new THREE.Group()
	for (const [mat, geos] of byMat) {
		const merged = mergeGeometries(geos)
		if (!merged) continue
		const m = new THREE.Mesh(merged, mat)
		m.castShadow = shadows
		m.receiveShadow = true
		out.add(m)
	}
	return out
}

export type DoorHole = { a: number; halfWidth: number; height: number; depth: number }

/**
 * The geodesic shell: triangles of an icosphere above the ground, and a strut
 * on every edge. At each of the four doors the lowest panels are left out; the
 * hole is measured and returned, so a portal wall can close it round the door.
 */
function geodesic(spec: Spec, m: Mats, kind: DomeKind): { group: THREE.Group; holes: DoorHole[] } {
	const R = spec.diameter / 2
	const ico = new THREE.IcosahedronGeometry(R, spec.detail)
	const p = ico.attributes.position!
	const glass: number[] = []
	const cloth: number[] = []
	const edges = new Map<string, [THREE.Vector3, THREE.Vector3]>()
	const key = (v: THREE.Vector3) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`
	const tris: { tri: THREE.Vector3[]; c: THREE.Vector3; ca: number }[] = []
	for (let i = 0; i < p.count; i += 3) {
		const tri = [0, 1, 2].map((k) => new THREE.Vector3(p.getX(i + k), p.getY(i + k), p.getZ(i + k)))
		if ((tri[0]!.y + tri[1]!.y + tri[2]!.y) / 3 < -R * 0.02) continue
		for (const v of tri) v.y = Math.max(0, v.y)
		const c = tri.reduce((s, v) => s.clone().add(v), new THREE.Vector3()).divideScalar(3)
		tris.push({ tri, c, ca: Math.atan2(c.x, c.z) })
	}
	// the door panels: the low triangles nearest each door's line, and their neighbours across it
	const low = kind === 'glamp' ? R * 0.3 : (spec.gallery!.height) * 0.62
	const skip = new Set<number>()
	const holes: DoorHole[] = []
	for (const d of doorsOf(kind)) {
		const tang = (v: THREE.Vector3) => v.x * Math.cos(d) - v.z * Math.sin(d)
		const cand = tris.map((t, i) => ({ i, t })).filter(({ t }) => t.c.y < low && Math.abs(adiff(t.ca, d)) < Math.PI / 4)
		if (!cand.length) continue
		const nearest = Math.min(...cand.map(({ t }) => Math.abs(tang(t.c))))
		let halfWidth = 0, height = 0, depth = Infinity
		for (const { i, t } of cand) {
			if (Math.abs(tang(t.c)) > nearest + (kind === 'glamp' ? 0.6 : 1.8)) continue
			skip.add(i)
			for (const v of t.tri) {
				halfWidth = Math.max(halfWidth, Math.abs(tang(v)))
				height = Math.max(height, v.y)
				depth = Math.min(depth, v.x * Math.sin(d) + v.z * Math.cos(d))
			}
		}
		holes.push({ a: d, halfWidth, height, depth })
	}
	tris.forEach(({ tri, c, ca }, i) => {
		if (skip.has(i)) return
		// the glamping dome is canvas behind the sleeping nooks, glass toward the living spaces and the sky
		const isWindow = kind !== 'glamp' || c.y > R * 0.78 || (Math.abs(ca) < 1.8 && c.y > R * 0.08 && c.y < R * 0.62)
		;(isWindow ? glass : cloth).push(...tri.flatMap((v) => [v.x, v.y, v.z]))
		for (let k = 0; k < 3; k++) {
			const a = tri[k]!, b = tri[(k + 1) % 3]!
			const id = [key(a), key(b)].sort().join('|')
			if (!edges.has(id)) edges.set(id, [a.clone(), b.clone()])
		}
	})
	const g = new THREE.Group()
	const shell = (arr: number[], mat: THREE.Material, shadow: boolean) => {
		if (!arr.length) return
		const geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
		geo.computeVertexNormals()
		const mesh = new THREE.Mesh(geo, mat)
		mesh.castShadow = shadow
		mesh.renderOrder = 2
		g.add(mesh)
	}
	shell(glass, m.glass, false)
	shell(cloth, m.canvas, true)

	const strut = new THREE.CylinderGeometry(spec.strut, spec.strut, 1, 6)
	const inst = new THREE.InstancedMesh(strut, kind === 'glamp' ? m.timberFrame : m.steel, edges.size)
	const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
	let i = 0
	for (const [a, b] of edges.values()) {
		const d = b.clone().sub(a)
		q.setFromUnitVectors(up, d.clone().normalize())
		mtx.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, d.length(), 1))
		inst.setMatrixAt(i++, mtx)
	}
	inst.castShadow = true
	g.add(inst)
	return { group: g, holes }
}

/**
 * A portal: the wall that closes a door hole in the shell — canvas on the
 * glamping dome, limestone on the big ones — with an opening, a timber frame,
 * and the glazed door standing open.
 */
function portal(m: Mats, hole: DoorHole, kind: DomeKind): THREE.Group {
	const g = new THREE.Group()
	const W = hole.halfWidth + 0.15
	const Ht = Math.max(hole.height, 3.2)
	const dw = kind === 'glamp' ? 0.75 : 1.3
	const dh = kind === 'glamp' ? 2.5 : 3
	const shape = new THREE.Shape()
	shape.moveTo(-W, 0)
	shape.lineTo(W, 0)
	shape.lineTo(W, Ht)
	shape.lineTo(-W, Ht)
	shape.closePath()
	const opening = new THREE.Path()
	opening.moveTo(-dw, 0)
	opening.lineTo(dw, 0)
	opening.lineTo(dw, dh - dw * 0.6)
	// a round-headed arch over the big domes' doors
	if (kind === 'glamp') opening.lineTo(dw, dh), opening.lineTo(-dw, dh)
	else opening.absarc(0, dh - dw * 0.6, dw, 0, Math.PI, false)
	opening.lineTo(-dw, 0)
	shape.holes.push(opening)
	const geo = new THREE.ShapeGeometry(shape, 16)
	const wall = new THREE.Mesh(geo, kind === 'glamp' ? m.canvas : m.lime(W / 1.5, Ht / 1.5))
	;(wall.material as THREE.Material).side = THREE.DoubleSide
	wall.castShadow = wall.receiveShadow = true
	g.add(wall)
	g.add(box(0.18, dh, 0.3, m.timberFrame, -dw - 0.05, 0, 0))
	g.add(box(0.18, dh, 0.3, m.timberFrame, dw + 0.05, 0, 0))
	g.add(box(dw * 2 + 0.3, 0.2, 0.32, m.timberFrame, 0, dh, 0))
	const leaf = new THREE.Group()
	leaf.add(box(dw, dh - 0.15, 0.05, m.glass, dw / 2, 0, 0))
	leaf.add(box(0.07, dh - 0.15, 0.07, m.timberFrame, 0, 0, 0))
	leaf.add(box(0.07, dh - 0.15, 0.07, m.timberFrame, dw, 0, 0))
	leaf.position.set(dw, 0, 0.1)
	leaf.rotation.y = -1.9
	g.add(leaf)
	const [x, z] = polar(hole.depth - 0.08, hole.a)
	g.position.set(x, 0, z)
	g.rotation.y = hole.a
	return g
}

/* ── furniture ───────────────────────────────────────────────────────── */

function bed(m: Mats, w = 1.6): THREE.Group {
	const g = new THREE.Group()
	g.add(box(w + 0.1, 0.35, 2.1, m.oak(1)))
	g.add(box(w, 0.2, 2, m.linen, 0, 0.35))
	g.add(box(w * 0.4, 0.14, 0.4, m.linen, -w * 0.22, 0.55, -0.75))
	g.add(box(w * 0.4, 0.14, 0.4, m.linen, w * 0.22, 0.55, -0.75))
	g.add(box(w, 0.06, 0.9, m.cushion, 0, 0.55, 0.45))
	g.add(box(w + 0.1, 0.9, 0.08, m.oak(1), 0, 0, -1.05))
	return g
}

function sofa(m: Mats, len = 2.4): THREE.Group {
	const g = new THREE.Group()
	g.add(box(len, 0.42, 0.95, m.sofa))
	g.add(box(len, 0.45, 0.25, m.sofa, 0, 0.42, -0.36))
	for (let i = 0; i < 3; i++) g.add(box(0.45, 0.4, 0.14, m.cushion, (i - 1) * len * 0.3, 0.5, -0.22))
	return g
}

function table(m: Mats, len: number, chairs: number): THREE.Group {
	const g = new THREE.Group()
	g.add(box(len, 0.06, 0.95, m.oak(1), 0, 0.72))
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.07, 0.72, 0.07, m.dark, sx * (len / 2 - 0.15), 0, sz * 0.38))
	for (let i = 0; i < chairs; i++) {
		const x = (i % Math.ceil(chairs / 2)) * (len / Math.ceil(chairs / 2)) - len / 2 + len / chairs
		const z = i < chairs / 2 ? -0.75 : 0.75
		g.add(box(0.45, 0.45, 0.45, m.oak(1), x, 0, z))
		g.add(box(0.45, 0.5, 0.05, m.oak(1), x, 0.45, z + (z < 0 ? -0.2 : 0.2)))
	}
	return g
}

function lantern(m: Mats, r: number, y: number): THREE.Group {
	const g = new THREE.Group()
	const s = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), m.paper)
	s.scale.y = 0.72
	s.position.y = y
	g.add(s)
	const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 3, 4), m.dark)
	cable.position.y = y + 1.5
	g.add(cable)
	return g
}

function raisedBed(m: Mats, len: number, seed: number): THREE.Group {
	const g = new THREE.Group()
	g.add(box(len, 0.55, 1.1, m.oak(len / 2, 0.3)))
	const top = box(len - 0.1, 0.02, 1, m.soil(len / 2), 0, 0.55)
	g.add(top)
	const r = seeded(seed)
	for (let i = 0; i < len * 3; i++) {
		const h = herb(seed + i, 0.18 + r() * 0.12)
		h.position.set(-len / 2 + 0.2 + r() * (len - 0.4), 0.56, -0.35 + r() * 0.7)
		g.add(h)
	}
	return g
}

/* ── the scene ───────────────────────────────────────────────────────── */

export type InteriorHandle = { dispose: () => void }

export async function mountInterior(container: HTMLElement, kind: DomeKind, onProgress?: (label: string) => void): Promise<InteriorHandle> {
	/** Let the page paint between the heavy steps, so the loading screen keeps moving. */
	const pause = async (label: string) => {
		onProgress?.(label)
		await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
	}
	const spec = DOMES[kind]
	const R = spec.diameter / 2
	const m = mats()

	const renderer = new THREE.WebGLRenderer({ antialias: true })
	renderer.setPixelRatio(Math.min(kind === 'master' ? 1.25 : 1.5, window.devicePixelRatio))
	renderer.setSize(container.clientWidth, container.clientHeight)
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 0.42
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	container.appendChild(renderer.domElement)

	const scene = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(68, container.clientWidth / container.clientHeight, 0.05, R * 30 + 500)

	/* noon: a physical sky for the light, the reflections and the view out. A dev
	   hook (window.__interiorLight = 'golden') lowers the sun to late afternoon,
	   for the journal's pictures. */
	const golden = (window as unknown as { __interiorLight?: string }).__interiorLight === 'golden'
	const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(golden ? 62 : 22), THREE.MathUtils.degToRad(golden ? 200 : 160))
	const sky = new Sky()
	sky.scale.setScalar(R * 40 + 2000)
	const u = sky.material.uniforms
	u['turbidity']!.value = 3
	u['rayleigh']!.value = 1.2
	u['mieCoefficient']!.value = 0.004
	u['mieDirectionalG']!.value = 0.8
	u['sunPosition']!.value.copy(sun)
	scene.add(sky)
	const pmrem = new THREE.PMREMGenerator(renderer)
	const envScene = new THREE.Scene()
	const envSky = new Sky()
	envSky.scale.setScalar(1000)
	Object.assign(envSky.material.uniforms, THREE.UniformsUtils.clone(sky.material.uniforms))
	envSky.material.uniforms['sunPosition']!.value.copy(sun)
	envScene.add(envSky)
	scene.environment = pmrem.fromScene(envScene).texture
	scene.environmentIntensity = 0.3

	const sunLight = new THREE.DirectionalLight(golden ? '#ffd29a' : '#fff1d8', golden ? 3 : 2.4)
	sunLight.position.copy(sun).multiplyScalar(R * 3 + 20)
	sunLight.castShadow = true
	sunLight.shadow.mapSize.set(kind === 'master' ? 2048 : 3072, kind === 'master' ? 2048 : 3072)
	const sc = sunLight.shadow.camera
	sc.left = sc.bottom = -R * 1.2
	sc.right = sc.top = R * 1.2
	sc.near = 1
	sc.far = R * 8 + 60
	sunLight.shadow.bias = -0.0004
	sunLight.shadow.normalBias = 0.02
	scene.add(sunLight)
	scene.add(new THREE.HemisphereLight(golden ? '#ffe2c0' : '#f4f0e6', '#6d5a3c', 0.4))
	scene.fog = new THREE.Fog(golden ? '#e9d6bd' : '#e3e9e6', R * 1.2, R * 9 + 60)

	await pause('Letting in the light')
	const animated: ((t: number) => void)[] = []

	/* the land outside, seen through the glass */
	const outside = new THREE.Mesh(new THREE.CircleGeometry(R * 20 + 200, 64), m.grass)
	outside.rotation.x = -Math.PI / 2
	outside.position.y = -0.02
	outside.receiveShadow = true
	scene.add(outside)
	/* the stone arcade that carries the terrace round a big dome, and the ring
	   where the forest starts */
	const G = spec.gallery
	const Rt = G ? R + 3.5 : R + 0.8
	const outsideColliders: { x: number; z: number; r: number }[] = []
	const outerR = kind === 'glamp' ? R + 44 : R + Math.min(60, R * 0.9 + 25)
	const ringPath = kind === 'glamp' ? R + 4.2 : Rt + 2.6

	/* paths: a ring round the dome, and one from each door out into the forest */
	{
		const stoneRing = new THREE.Mesh(new THREE.RingGeometry(ringPath - 1.2, ringPath + 1.2, 160), m.stone((ringPath * 2) / 3))
		stoneRing.rotation.x = -Math.PI / 2
		stoneRing.position.y = 0.025
		stoneRing.receiveShadow = true
		scene.add(stoneRing)
		for (const d of doorsOf(kind)) {
			const len = outerR - R + 4
			const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.2, len), m.stone(1))
			const mat = strip.material as THREE.MeshStandardMaterial
			mat.map!.repeat.set(2.2 / 3, len / 3)
			mat.bumpMap!.repeat.set(2.2 / 3, len / 3)
			strip.rotation.set(-Math.PI / 2, 0, -d)
			const [x, z] = polar(R - 1 + len / 2, d)
			strip.position.set(x, 0.022, z)
			strip.receiveShadow = true
			scene.add(strip)
		}
	}
	const onOutsidePath = (x: number, z: number) => {
		const rr = Math.hypot(x, z), a = Math.atan2(x, z)
		return Math.abs(rr - ringPath) < 2.4 || doorsOf(kind).some((d) => Math.abs(adiff(a, d)) < Math.PI / 2 && Math.abs(adiff(a, d)) * rr < 2.6)
	}

	/* a turquoise stream winding round the dome, stones on its banks, a bridge where each path crosses */
	const streamOut: THREE.Vector3[] = []
	const streamW = kind === 'glamp' ? 2.6 : 3.6
	{
		const mid = (ringPath + 6 + outerR) / 2
		const band = (outerR - ringPath - 10) / 2
		const pts: THREE.Vector3[] = []
		for (let i = 0; i <= 60; i++) {
			const t = i / 60
			const a = 0.35 + t * Math.PI * 1.7
			const rr = mid + Math.sin(t * Math.PI * 7) * band * 0.45
			const [x, z] = polar(rr, a)
			pts.push(new THREE.Vector3(x, 0, z))
		}
		streamOut.push(...new THREE.CatmullRomCurve3(pts).getSpacedPoints(260))
		const pos: number[] = [], uv: number[] = [], idx: number[] = []
		streamOut.forEach((p0, i) => {
			const p1 = streamOut[Math.min(streamOut.length - 1, i + 1)]!, pm = streamOut[Math.max(0, i - 1)]!
			const dir = p1.clone().sub(pm).normalize()
			const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(streamW / 2)
			pos.push(p0.x - side.x, 0.09, p0.z - side.z, p0.x + side.x, 0.09, p0.z + side.z)
			uv.push(0, i / 6, 1, i / 6)
			if (i < streamOut.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
		})
		const geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
		geo.setIndex(idx)
		geo.computeVertexNormals()
		const wtex = tiled(water(), 1, 1)
		const wm = new THREE.MeshStandardMaterial({ map: wtex, color: '#7fe8ef', emissive: '#1f9aa3', emissiveIntensity: 0.5, roughness: 0.12, metalness: 0.1, side: THREE.DoubleSide })
		scene.add(new THREE.Mesh(geo, wm))
		animated.push((t) => (wtex.offset.y = -t * 0.3))
		const banks = new THREE.Group()
		const rs = seeded(17)
		for (let i = 0; i < streamOut.length; i += 2) {
			const p0 = streamOut[i]!, p1 = streamOut[Math.min(streamOut.length - 1, i + 1)]!
			const dir = p1.clone().sub(p0).normalize()
			for (const sd of [-1, 1]) {
				const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rs() * 0.35, 0), m.pebble)
				st.position.set(p0.x - dir.z * sd * (streamW / 2 + 0.2), 0.08, p0.z + dir.x * sd * (streamW / 2 + 0.2))
				st.scale.y = 0.5
				st.rotation.set(rs(), rs() * 6, rs())
				banks.add(st)
			}
		}
		for (const d of doorsOf(kind)) {
			// the sample of the stream nearest the path's line
			let best = -1, bestOff = Infinity
			streamOut.forEach((p, i) => {
				const a = Math.atan2(p.x, p.z)
				const off = Math.abs(adiff(a, d)) * Math.hypot(p.x, p.z)
				if (Math.abs(adiff(a, d)) < 0.6 && off < bestOff) (best = i), (bestOff = off)
			})
			if (best < 0 || bestOff > 3) continue
			const [x, z] = polar(Math.hypot(streamOut[best]!.x, streamOut[best]!.z), d)
			banks.add(box(2.6, 0.2, streamW + 2.4, m.oak(1, 2), x, 0.12, z, d))
			for (const sd of [-1, 1]) {
				const [ox, oz] = polar(1.25, d + Math.PI / 2)
				banks.add(box(0.08, 0.9, streamW + 2.4, m.timberFrame, x + ox * sd, 0.32, z + oz * sd, d))
			}
		}
		scene.add(bake(banks))
	}
	const nearOutStream = (x: number, z: number, dist: number) => streamOut.some((p) => Math.abs(p.x - x) < dist && Math.abs(p.z - z) < dist && Math.hypot(p.x - x, p.z - z) < dist)

	/* the food forest outside, in all seven layers, planted as guilds: a canopy
	   tree or a fruit tree, and round it shrubs, herbs, clover, squash and a vine */
	{
		const r = seeded(99)
		const inner = ringPath + 2.5
		const guilds = Math.min(kind === 'master' ? 240 : 320, Math.round((Math.PI * (outerR * outerR - inner * inner)) / 38))
		const trees = new THREE.Group()
		const under = new THREE.Group()
		let placed = 0
		for (let tries = 0; placed < guilds && tries < guilds * 6; tries++) {
			const a = r() * Math.PI * 2
			const d = inner + Math.sqrt(r()) * (outerR - inner)
			const [x, z] = polar(d, a)
			if (onOutsidePath(x, z) || nearOutStream(x, z, streamW / 2 + 2.2)) continue
			placed++
			const k = r()
			const main: Plant =
				k < 0.22 ? canopyTree(2000 + placed, 0.9 + r() * 0.6)
				: k < 0.45 ? appleTree(2100 + placed, 0.9 + r() * 0.5)
				: k < 0.62 ? fruitTree('mango', 2200 + placed, 0.9 + r() * 0.4)
				: k < 0.76 ? fruitTree('avocado', 2300 + placed, 0.9 + r() * 0.4)
				: k < 0.88 ? fruitTree('citrus', 2400 + placed, 1 + r() * 0.4)
				: banana(2500 + placed, 2.6 + r())
			main.object.position.set(x, 0, z)
			main.object.rotation.y = r() * 6.28
			trees.add(main.object)
			outsideColliders.push({ x, z, r: main.radius + 0.25 })
			const around = (n: number, dist: number, make: (seed: number) => THREE.Object3D) => {
				for (let jj = 0; jj < n; jj++) {
					const b = r() * 6.28, dd = dist * (0.6 + r() * 0.6)
					const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
					if (onOutsidePath(ox, oz) || nearOutStream(ox, oz, streamW / 2 + 0.6)) continue
					const o = make(3000 + placed * 13 + jj)
					o.position.set(ox, 0, oz)
					o.rotation.y = r() * 6.28
					under.add(o)
				}
			}
			around(2, 2.2, (sd) => berryBush(sd, 0.7 + r() * 0.5).object)
			around(3, 1.6, (sd) => comfrey(sd, 0.5 + r() * 0.4))
			around(4, 2.6, (sd) => clover(sd))
			if (r() < 0.55) around(1, 2.8, (sd) => squash(sd))
			if (r() < 0.4) around(1, 1.9, (sd) => climber(sd, 2 + r()).object)
		}
		scene.add(bake(trees))
		scene.add(bake(under, false))
	}
	await pause('Planting the food forest outside')

	const shell = geodesic(spec, m, kind)
	scene.add(shell.group)
	for (const hole of shell.holes) scene.add(portal(m, hole, kind))
	await pause('Raising the dome')

	/* colliders and floors, for walking */
	const colliders: { x: number; z: number; r: number }[] = []
	let floorAt = (_x: number, _z: number, _feet: number) => 0
	let blocked = (_x: number, _z: number, _feet: number) => false
	let start = { x: 0, z: R * 0.5, look: 0 }
	let terraceAt = (_rr: number, _y: number) => false

	if (kind === 'glamp') {
		/* a home for four, in zones round the room: the door at +z (angle 0), the
		   living room to its left, the kitchen and table to its right, and at the
		   back, behind timber screens, two sleeping nooks and the bathroom. The
		   middle is a garden under the skylight. */
		const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 64), m.oak(R / 1.5))
		floor.rotation.x = -Math.PI / 2
		floor.position.y = 0.01
		floor.receiveShadow = true
		scene.add(floor)
		const at = (rr: number, a: number) => polar(rr, a)
		const put = (o: THREE.Object3D, rr: number, a: number, face = a + Math.PI, collide = 0) => {
			const [x, z] = at(rr, a)
			o.position.set(x, o.position.y, z)
			o.rotation.y = face
			scene.add(o)
			if (collide) colliders.push({ x, z, r: collide })
		}
		// the living room: sofa, rug, a low table, the wood stove
		const rug = new THREE.Mesh(new THREE.CircleGeometry(1.8, 40), m.rug)
		rug.rotation.x = -Math.PI / 2
		rug.position.y = 0.02
		put(rug, 4.4, -1.05)
		rug.rotation.set(-Math.PI / 2, 0, 0)
		put(sofa(m, 2.8), 5.6, -1.05, -1.05 + Math.PI, 1.4)
		put(box(1.1, 0.4, 0.6, m.oak(1)), 4.2, -1.05, -1.05, 0.6)
		const stove = box(0.6, 0.75, 0.55, m.dark)
		put(stove, 6.6, -1.75, -1.75 + Math.PI, 0.5)
		const [fx, fz] = at(6.6, -1.75)
		const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, R * 0.9, 10), m.dark)
		flue.position.set(fx * 0.9, 0.75 + (R * 0.9) / 2, fz * 0.9)
		scene.add(flue)
		put(box(1.2, 2, 0.4, m.oak(1)), 6.9, -0.55, -0.55 + Math.PI)
		// the kitchen along the glass, and a table for four
		for (let k = 0; k < 4; k++) {
			const a = 0.85 + k * 0.17
			put(box(1.05, 0.9, 0.62, m.oak(1)), 7, a, a + Math.PI, 0.55)
			put(box(1.08, 0.05, 0.66, m.counter), 7, a, a + Math.PI)
			const c = scene.children[scene.children.length - 1]!
			c.position.y = 0.9
		}
		put(box(1, 0.9, 0.5, m.dark), 7.1, 1.55, 1.55 + Math.PI)
		put(table(m, 1.6, 4), 4.6, 1.2, 1.2 + Math.PI / 2, 1.2)
		// behind the screens: a sleeping nook for two, one with two single beds, and the bathroom
		const screen = (rr0: number, rr1: number, a: number) => {
			const [x, z] = at((rr0 + rr1) / 2, a)
			scene.add(box(0.1, 2.2, rr1 - rr0, m.oak(0.5, 1), x, 0, z, a))
		}
		for (const a of [2.35, 2.95, -2.95, -2.35]) screen(3.4, 7.2, a)
		put(bed(m, 1.7), 6.2, 2.65, 2.65 + Math.PI, 1.1)
		const b1 = bed(m, 0.95)
		put(b1, 6.2, 3.14 - 0.12, 3.14, 0.7)
		const b2 = bed(m, 0.95)
		put(b2, 6.2, -3.14 + 0.12, 3.14, 0.7)
		const pod = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.3, 24, 1, true, 0.5, Math.PI * 2 - 1), m.oak(3, 1))
		;(pod.material as THREE.Material).side = THREE.DoubleSide
		const [px, pz] = at(5.9, -2.65)
		pod.position.set(px, 1.15, pz)
		pod.rotation.y = -2.65 + Math.PI
		scene.add(pod)
		colliders.push({ x: px, z: pz, r: 1.25 })
		// the garden inside: raised beds under the glass, a lemon tree under the skylight, herbs everywhere
		const planter = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.55, 32), m.lime(3, 0.3))
		planter.position.y = 0.275
		scene.add(planter)
		const planterSoil = new THREE.Mesh(new THREE.CircleGeometry(1.25, 32), m.soil(1))
		planterSoil.rotation.x = -Math.PI / 2
		planterSoil.position.y = 0.56
		scene.add(planterSoil)
		const lemon = fruitTree('citrus', 77, 0.75)
		lemon.object.position.y = 0.55
		scene.add(lemon.object)
		colliders.push({ x: 0, z: 0, r: 1.5 })
		for (let k = 0; k < 6; k++) {
			const h = herb(80 + k, 0.25)
			const [hx, hz] = at(0.9, k)
			h.position.set(hx, 0.56, hz)
			scene.add(h)
		}
		for (const a of [-0.55, 0.55, 1.95]) {
			const bedG = raisedBed(m, 2.2, 90 + Math.round(a * 10))
			put(bedG, 7.3, a, a + Math.PI / 2, 0.9)
		}
		for (let k = 0; k < 5; k++) {
			const potA = -1.9 + k * 0.28
			const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.45, 16), m.dark)
			const [x, z] = at(7.4, potA)
			pot.position.set(x, 0.22, z)
			scene.add(pot)
			const plant = k % 2 ? shrub(120 + k, 1.1) : banana(130 + k, 1.6)
			plant.object.position.set(x, 0.4, z)
			scene.add(plant.object)
		}
		scene.add(lantern(m, 0.4, 3.4))
		const l2 = lantern(m, 0.3, 2.6)
		const [lx, lz] = at(4.6, 1.2)
		l2.position.set(lx, 0, lz)
		scene.add(l2)
		// the stone foundation ring the dome stands on, open at the door
		const gh = 1.1 / R
		const plinth = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.45, 0.45, 96, 1, true, gh, Math.PI * 2 - 2 * gh), m.lime((Math.PI * R) / 1.5, 0.3))
		;(plinth.material as THREE.Material).side = THREE.DoubleSide
		plinth.position.y = 0.2
		scene.add(plinth)
		// a deck outside the door, and a table on it
		const deck = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48), m.oak(4))
		deck.rotation.x = -Math.PI / 2
		deck.position.set(0, 0.04, R + 2.2)
		deck.receiveShadow = true
		scene.add(deck)
		const outTable = table(m, 1.2, 4)
		outTable.position.set(1.8, 0.06, R + 2.4)
		scene.add(outTable)
		colliders.push({ x: 1.8, z: R + 2.4, r: 1.1 })
		start = { x: 0, z: R - 2.2, look: 0 }
	} else {
		const g = spec.gallery!
		const H = g.height
		const rWall = Math.sqrt(R * R - H * H)
		const rIn = rWall - g.depth
		const Rc = Math.max(4.5, R * 0.22)
		const Rp = (Rc + rIn) / 2
		// the stair on a diagonal, so each spoke runs clear from the plaza to its door
		const aStair = Math.PI * 0.25
		const run = H * 1.9
		const r0 = rIn - run
		const stairHalf = 0.9
		const walkway = 2.4

		/* ground: soil, a stone plaza, a ring path and spokes */
		const ground = new THREE.Mesh(new THREE.CircleGeometry(R, 96), m.soil(R / 2))
		ground.rotation.x = -Math.PI / 2
		ground.receiveShadow = true
		scene.add(ground)
		const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0.02) => {
			const mesh = new THREE.Mesh(geo, mat)
			mesh.rotation.x = -Math.PI / 2
			mesh.position.y = y
			mesh.receiveShadow = true
			scene.add(mesh)
			return mesh
		}
		flat(new THREE.CircleGeometry(Rc, 64), m.stone((Rc * 2) / 3))
		flat(new THREE.RingGeometry(Rp - 1.1, Rp + 1.1, 128), m.stone((Rp * 2) / 3))
		// under the gallery the floor is stone too: the covered commons round the edge
		flat(new THREE.RingGeometry(rIn - 0.4, R, 128), m.stone((R * 2) / 3))
		for (const a of DOORS) {
			const len = R - Rc
			const strip = flat(new THREE.PlaneGeometry(2, len), m.stone(1), 0.021)
			const [x, z] = polar(Rc + len / 2, a)
			strip.position.x = x
			strip.position.z = z
			strip.rotation.z = -a
			const mat = strip.material as THREE.MeshStandardMaterial
			mat.map!.repeat.set(2 / 3, len / 3)
			mat.bumpMap!.repeat.set(2 / 3, len / 3)
		}

		/* limestone knee wall round the base, open at the four doors */
		for (const d of DOORS) {
			const gh = 1.6 / R
			const knee = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 0.9, 48, 1, true, d + gh, Math.PI / 2 - 2 * gh), m.lime((Math.PI * R) / 8, 0.4))
			knee.position.y = 0.45
			;(knee.material as THREE.Material).side = THREE.DoubleSide
			scene.add(knee)
		}

		/* the stream: from a spring by the plaza, winding through the forest to a pond */
		const streamPts: THREE.Vector3[] = []
		const a0 = aStair + Math.PI * 0.75
		for (let i = 0; i <= 40; i++) {
			const t = i / 40
			const a = a0 + t * Math.PI * 0.9
			const rr = Rp + (rIn - Rp) * 0.5 + Math.sin(t * Math.PI * 5) * (rIn - Rp) * 0.18 - (1 - t) * (Rp - Rc) * 0.9 * (t < 0.2 ? 1 - t / 0.2 : 0)
			const [x, z] = polar(rr, a)
			streamPts.push(new THREE.Vector3(x, 0.03, z))
		}
		const curve = new THREE.CatmullRomCurve3(streamPts)
		const samples = curve.getSpacedPoints(160)
		const width = Math.max(0.9, R * 0.035)
		{
			const pos: number[] = [], uv: number[] = []
			for (let i = 0; i < samples.length; i++) {
				const p0 = samples[i]!, p1 = samples[Math.min(samples.length - 1, i + 1)]!, pm = samples[Math.max(0, i - 1)]!
				const dir = p1.clone().sub(pm).setY(0).normalize()
				const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2)
				pos.push(p0.x - side.x, 0.04, p0.z - side.z, p0.x + side.x, 0.04, p0.z + side.z)
				uv.push(0, i / 8, 1, i / 8)
			}
			const idx: number[] = []
			for (let i = 0; i < samples.length - 1; i++) {
				const a = i * 2
				idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
			}
			const geo = new THREE.BufferGeometry()
			geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
			geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
			geo.setIndex(idx)
			geo.computeVertexNormals()
			const wm = m.water(1)
			const stream = new THREE.Mesh(geo, wm)
			stream.receiveShadow = true
			scene.add(stream)
			animated.push((t) => (wm.map!.offset.y = -t * 0.35))
			// stones along both banks
			const stones = new THREE.Group()
			const r = seeded(7)
			for (let i = 0; i < samples.length; i += 2) {
				const p0 = samples[i]!, p1 = samples[Math.min(samples.length - 1, i + 1)]!
				const dir = p1.clone().sub(p0).setY(0).normalize()
				for (const s of [-1, 1]) {
					const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + r() * 0.2, 0), m.pebble)
					st.position.set(p0.x + -dir.z * s * (width / 2 + 0.1), 0.05, p0.z + dir.x * s * (width / 2 + 0.1))
					st.scale.y = 0.45
					st.rotation.set(r(), r() * 6, r())
					stones.add(st)
				}
			}
			scene.add(bake(stones))
			const end = samples[samples.length - 1]!
			const pond = new THREE.Mesh(new THREE.CircleGeometry(width * 2.8, 40), m.water(2))
			pond.rotation.x = -Math.PI / 2
			pond.position.set(end.x, 0.045, end.z)
			scene.add(pond)
		}
		const nearStream = (x: number, z: number, d: number) => samples.some((p) => Math.hypot(p.x - x, p.z - z) < d)

		/* the food forest in the open ground */
		const forest = new THREE.Group()
		const understorey = new THREE.Group()
		const r = seeded(kind === 'home' ? 3 : kind === 'large' ? 5 : 9)
		const area = Math.PI * (rIn * rIn - Rc * Rc)
		const trees = Math.min(kind === 'master' ? 230 : 260, Math.round(area / 24))
		const onPath = (rr: number, a: number) =>
			rr < Rc + 1.2 || Math.abs(rr - Rp) < 1.8 || [...DOORS, aStair].some((d) => Math.abs(adiff(a, d)) < Math.PI / 2 && Math.abs(adiff(a, d)) * rr < 1.8)
		let placed = 0
		for (let tries = 0; placed < trees && tries < trees * 20; tries++) {
			const a = r() * Math.PI * 2
			const rr = Rc + 1.5 + r() * (rIn - Rc - 3)
			if (onPath(rr, a)) continue
			const [x, z] = polar(rr, a)
			if (nearStream(x, z, width + 1.4)) continue
			if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < 2.6)) continue
			const pick = r()
			const s = 0.8 + r() * 0.6
			let plant: Plant
			if (pick < 0.24) plant = fruitTree('mango', 100 + placed, s)
			else if (pick < 0.44) plant = fruitTree('avocado', 200 + placed, s)
			else if (pick < 0.6) plant = fruitTree('citrus', 300 + placed, s)
			else if (pick < 0.8) plant = coconutPalm(400 + placed, (kind === 'home' ? 6 : 9) + r() * 4)
			else plant = banana(600 + placed, 2.6 + r())
			plant.object.position.set(x, 0, z)
			plant.object.rotation.y = r() * 6.28
			forest.add(plant.object)
			colliders.push({ x, z, r: plant.radius + 0.2 })
			placed++
		}
		const cover = new THREE.Group()
		for (let i = 0; i < Math.min(area * 1.4, kind === 'master' ? 3200 : 4000); i++) {
			const a = r() * Math.PI * 2
			const rr = Rc + 1.2 + r() * (rIn - Rc - 1.6)
			if (onPath(rr, a)) continue
			const [x, z] = polar(rr, a)
			if (nearStream(x, z, width * 0.7)) continue
			const hb = herb(3000 + i, 0.2 + r() * 0.25)
			hb.position.set(x, 0, z)
			cover.add(hb)
		}
		scene.add(bake(cover, false))
		for (let i = 0; i < Math.min(trees * 4, 700); i++) {
			const a = r() * Math.PI * 2
			const rr = Rc + 1.3 + r() * (rIn - Rc - 2)
			if (onPath(rr, a)) continue
			const [x, z] = polar(rr, a)
			if (nearStream(x, z, width)) continue
			const sh = shrub(900 + i, 0.6 + r() * 0.8)
			sh.object.position.set(x, 0, z)
			understorey.add(sh.object)
		}
		scene.add(bake(forest))
		scene.add(bake(understorey, false))
		await pause('Planting the forest inside')

		/* raised beds along the ring path */
		for (let k = 0; k < 8; k++) {
			// on the diagonals, either side, clear of the spokes and the stair
			const a = Math.PI / 4 + Math.floor(k / 2) * (Math.PI / 2) + (k % 2 ? 0.28 : -0.28)
			const [x, z] = polar(Rp + 2.2, a)
			const bedGroup = raisedBed(m, 3, 40 + k)
			bedGroup.position.set(x, 0, z)
			bedGroup.rotation.y = a + Math.PI / 2
			scene.add(bedGroup)
			colliders.push({ x, z, r: 1.4 })
		}

		/* the plaza: a long table, sofas, and lanterns — and in the master dome, the waterfall */
		if (kind === 'master') {
			const poolR = Rc * 0.45
			const rim = new THREE.Mesh(new THREE.TorusGeometry(poolR, 0.35, 12, 96), m.lime(20, 1))
			rim.rotation.x = -Math.PI / 2
			rim.position.y = 0.35
			scene.add(rim)
			const pool = new THREE.Mesh(new THREE.CircleGeometry(poolR, 64), m.water(4))
			pool.rotation.x = -Math.PI / 2
			pool.position.y = 0.25
			scene.add(pool)
			const fallTex = water().clone()
			fallTex.repeat.set(3, 1)
			fallTex.needsUpdate = true
			const fallMat = new THREE.MeshStandardMaterial({ map: fallTex, color: '#ffffff', emissive: '#dff3f6', emissiveIntensity: 0.35, transparent: true, opacity: 0.38, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false })
			const fall = new THREE.Mesh(new THREE.CylinderGeometry(poolR * 0.35, poolR * 0.6, R * 0.92, 48, 1, true), fallMat)
			fall.position.y = (R * 0.92) / 2
			scene.add(fall)
			animated.push((t) => (fallTex.offset.y = t * 1.2))
			colliders.push({ x: 0, z: 0, r: poolR + 0.5 })
			for (let k = 0; k < 6; k++) {
				const a = (k * Math.PI) / 3
				const t = table(m, 3, 8)
				const [x, z] = polar(Rc * 0.78, a)
				t.position.set(x, 0, z)
				t.rotation.y = a
				scene.add(t)
				colliders.push({ x, z, r: 1.7 })
			}
		} else {
			const t = table(m, 4.2, 10)
			t.position.set(0, 0, -Rc * 0.3)
			scene.add(t)
			colliders.push({ x: 0, z: -Rc * 0.3, r: 2.2 })
			for (const [x, z, rot] of [[-Rc * 0.55, Rc * 0.35, 0.6], [Rc * 0.55, Rc * 0.35, -0.6]] as const) {
				const s = sofa(m, 2.6)
				s.position.set(x, 0, z)
				s.rotation.y = Math.PI + rot
				scene.add(s)
				colliders.push({ x, z, r: 1.3 })
			}
			scene.add(box(1.4, 0.4, 0.8, m.lime(1), 0, 0, Rc * 0.45))
			for (let k = 0; k < 5; k++) {
				const l = lantern(m, 0.55 + (k % 2) * 0.2, H + 2 + (k % 3))
				const [x, z] = polar(Rc * 0.5, (k * Math.PI * 2) / 5)
				l.position.set(x, 0, z)
				scene.add(l)
			}
		}

		/* the gallery: an oak ring on limestone pillars, with a glass railing */
		const galleryFloor = new THREE.Mesh(new THREE.RingGeometry(rIn, R, 160), m.oak(R / 2))
		galleryFloor.rotation.x = -Math.PI / 2
		galleryFloor.position.y = H
		galleryFloor.castShadow = galleryFloor.receiveShadow = true
		;(galleryFloor.material as THREE.Material).side = THREE.DoubleSide
		scene.add(galleryFloor)
		const fascia = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, 0.45, 160, 1, true), m.oak((Math.PI * rIn) / 2, 0.2))
		fascia.position.y = H - 0.22
		fascia.castShadow = true
		scene.add(fascia)
		const gap = (stairHalf * 1.3) / rIn
		const rail = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, 1.05, 160, 1, true, aStair + gap, Math.PI * 2 - 2 * gap), m.glass)
		rail.position.y = H + 0.52
		scene.add(rail)
		// a torus arc starts at +x and runs toward -z once laid flat; turn it to start past the stair
		const top = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.035, 8, 200, Math.PI * 2 - 2 * gap), m.steel)
		top.rotation.x = -Math.PI / 2
		const topRing = new THREE.Group()
		topRing.add(top)
		topRing.rotation.y = aStair + gap - Math.PI / 2
		topRing.position.y = H + 1.05
		scene.add(topRing)
		{
			const vines = new THREE.Group()
			const vr = seeded(11)
			const drops = Math.round((2 * Math.PI * rIn) / 0.9)
			const vineMat = new THREE.MeshStandardMaterial({ map: leaves('fine'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 })
			for (let k = 0; k < drops; k++) {
				const a = (k / drops) * Math.PI * 2
				if (Math.abs(Math.atan2(Math.sin(a - aStair), Math.cos(a - aStair))) * rIn < 2) continue
				if (vr() < 0.35) continue
				const len = 0.6 + vr() * (H * 0.55)
				const [x, z] = polar(rIn - 0.05, a)
				for (let j = 0; j < len / 0.35; j++) {
					const c = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), vineMat)
					c.position.set(x + (vr() - 0.5) * 0.3, H - 0.1 - j * 0.35, z + (vr() - 0.5) * 0.3)
					c.rotation.set(vr() * 3, vr() * 3, vr() * 3)
					vines.add(c)
				}
				// a planter on the rail, spilling over
				const [px, pz] = polar(rIn + 0.35, a)
				const pl = herb(5000 + k, 0.35)
				pl.position.set(px, H + 0.05, pz)
				vines.add(pl)
			}
			scene.add(bake(vines))
		}
		const pillars = Math.round((2 * Math.PI * rIn) / 6)
		for (let k = 0; k < pillars; k++) {
			const a = (k / pillars) * Math.PI * 2 + 0.05
			if ([aStair, ...DOORS].some((d) => Math.abs(adiff(a, d)) * rIn < 2)) continue
			const [x, z] = polar(rIn + 0.4, a)
			const pl = box(0.7, H, 0.7, m.lime(0.5, H / 2), x, 0, z, a)
			scene.add(pl)
			colliders.push({ x, z, r: 0.55 })
		}

		/* the private rooms, facing out through the glass — one floor, or two */
		const roomH = 3
		const rFront = rIn + walkway
		const roomsAt = (Hf: number, turn: number) => {
			const rooms = g.rooms
			const topR = Math.sqrt(R * R - (Hf + roomH) ** 2)
			const group = new THREE.Group()
			for (let k = 0; k < rooms; k++) {
				const a1 = aStair + turn + ((k + 0.5) / rooms) * Math.PI * 2
				const span = (Math.PI * 2) / rooms
				const [px, pz] = polar((rFront + topR) / 2, a1)
				group.add(box(0.2, roomH, topR - rFront, m.lime(1, 1), px, Hf, pz, a1))
				const door = 1.3 / rFront
				const front = new THREE.Mesh(new THREE.CylinderGeometry(rFront, rFront, roomH, 24, 1, true, a1 + door, span - door), m.oak((span * rFront) / 2.5, 1.2))
				;(front.material as THREE.Material).side = THREE.DoubleSide
				front.position.y = Hf + roomH / 2
				group.add(front)
				const mid = a1 + span / 2
				const b = bed(m, 1.6)
				const [bx, bz] = polar(topR - 1.4, mid - span * 0.2)
				b.position.set(bx, Hf, bz)
				b.rotation.y = mid + Math.PI
				group.add(b)
				const so = sofa(m, 2)
				const [sx, sz] = polar(rFront + 1.4, mid + span * 0.15)
				so.position.set(sx, Hf, sz)
				so.rotation.y = mid
				group.add(so)
				const t = table(m, 0.9, 2)
				const [tx, tz] = polar((rFront + topR) / 2, mid + span * 0.2)
				t.position.set(tx, Hf, tz)
				t.rotation.y = mid
				group.add(t)
				const l = lantern(m, 0.3, Hf + 2.4)
				const [lx, lz] = polar((rFront + topR) / 2, mid)
				l.position.set(lx, 0, lz)
				group.add(l)
			}
			scene.add(bake(group))
		}
		roomsAt(H, 0)

		const H2 = H + roomH + 0.6
		const twoFloors = g.floors === 2
		const rMid2 = rIn + walkway / 2
		const run2 = (H2 - H) * 1.9
		const span2 = run2 / rMid2
		const aS2 = aStair + (stairHalf * 2 + 1.2) / rMid2
		if (twoFloors) {
			/* the second floor: an oak ring over the first floor's rooms, open where its stair comes up */
			const outerBand = new THREE.Mesh(new THREE.RingGeometry(rFront, R, 160), m.oak(R / 2))
			const innerBand = new THREE.Mesh(new THREE.RingGeometry(rIn, rFront, 160, 1, aS2 + span2 - Math.PI / 2, Math.PI * 2 - span2), m.oak(R / 2))
			for (const band of [outerBand, innerBand]) {
				band.rotation.x = -Math.PI / 2
				band.position.y = H2
				band.castShadow = band.receiveShadow = true
				;(band.material as THREE.Material).side = THREE.DoubleSide
				scene.add(band)
			}
			const fascia2 = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, 0.45, 160, 1, true), m.oak((Math.PI * rIn) / 2, 0.2))
			fascia2.position.y = H2 - 0.22
			scene.add(fascia2)
			const rail2 = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, 1.05, 160, 1, true), m.glass)
			rail2.position.y = H2 + 0.52
			scene.add(rail2)
			const top2 = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.035, 8, 200), m.steel)
			top2.rotation.x = -Math.PI / 2
			top2.position.y = H2 + 1.05
			scene.add(top2)
			/* its stair climbs round the first-floor walkway */
			const steps2 = Math.ceil((H2 - H) / 0.18)
			const stair2 = new THREE.Group()
			for (let i = 0; i < steps2; i++) {
				const a = aS2 + ((i + 0.5) / steps2) * span2
				const [x, z] = polar(rMid2, a)
				stair2.add(box(run2 / steps2 + 0.03, 0.06, walkway - 0.3, m.oak(1), x, H + ((i + 1) / steps2) * (H2 - H) - 0.06, z, a))
			}
			scene.add(bake(stair2))
			roomsAt(H2, Math.PI / g.rooms)
		}

		/* the terrace outside the glass, carried on a stone arcade — the dome's foundation ring */
		{
			const terrace = new THREE.Group()
			const deck = new THREE.Mesh(new THREE.RingGeometry(rWall - 0.4, Rt, 160), m.stone(R / 1.5))
			deck.rotation.x = -Math.PI / 2
			deck.position.y = H + 0.02
			terrace.add(deck)
			const under = new THREE.Mesh(new THREE.RingGeometry(rWall - 0.4, Rt, 160), m.lime(R / 2))
			under.rotation.x = Math.PI / 2
			under.position.y = H - 0.35
			terrace.add(under)
			const edge = new THREE.Mesh(new THREE.CylinderGeometry(Rt, Rt, 0.4, 160, 1, true), m.lime((Math.PI * Rt) / 2, 0.2))
			edge.position.y = H - 0.15
			terrace.add(edge)
			// pillars between the doors, and round arches from pillar to pillar
			const perQuarter = Math.max(3, Math.round(((Math.PI / 2) * Rt) / 5.2))
			const step = Math.PI / 2 / perQuarter
			const archR = (step * Rt) / 2 - 0.4
			for (let k = 0; k < perQuarter * 4; k++) {
				const a = (k + 0.5) * step
				const [x, z] = polar(Rt - 0.45, a)
				terrace.add(box(0.8, H - 0.3, 0.8, m.lime(0.6, H / 2), x, 0, z, a))
				outsideColliders.push({ x, z, r: 0.6 })
				const arch = new THREE.Mesh(new THREE.TorusGeometry(archR, 0.4, 8, 24, Math.PI), m.lime(2, 0.3))
				const [ax, az] = polar(Rt - 0.45, k * step)
				arch.position.set(ax, H - 0.35 - archR, az)
				arch.rotation.y = k * step
				terrace.add(arch)
			}
			// a timber balustrade, planters, tables
			const posts = Math.round((Math.PI * 2 * Rt) / 1.1)
			for (let k = 0; k < posts; k++) {
				const [x, z] = polar(Rt - 0.2, (k / posts) * Math.PI * 2)
				terrace.add(box(0.1, 0.95, 0.1, m.timberFrame, x, H, z))
			}
			const rail = new THREE.Mesh(new THREE.TorusGeometry(Rt - 0.2, 0.07, 6, 240), m.timberFrame)
			rail.rotation.x = -Math.PI / 2
			rail.position.y = H + 0.98
			terrace.add(rail)
			const rr = seeded(23)
			const sets = Math.round((Math.PI * 2 * Rt) / 14)
			for (let k = 0; k < sets; k++) {
				const a = ((k + 0.5) / sets) * Math.PI * 2
				const [tx, tz] = polar((rWall + Rt) / 2 + 0.3, a)
				const t = table(m, 1.4, 4)
				t.position.set(tx, H, tz)
				t.rotation.y = a + Math.PI / 2
				terrace.add(t)
				for (const off of [-1, 1]) {
					const [px, pz] = polar(Rt - 0.8, a + (off * 2.8) / Rt)
					const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.55, 14), m.lime(1, 0.4))
					pot.position.set(px, H + 0.27, pz)
					terrace.add(pot)
					const pl = rr() < 0.5 ? shrub(700 + k * 2 + (off > 0 ? 1 : 0), 1.1).object : berryBush(760 + k * 2 + (off > 0 ? 1 : 0), 0.9).object
					pl.position.set(px, H + 0.5, pz)
					terrace.add(pl)
				}
			}
			scene.add(bake(terrace))
		}
		await pause('Making the beds')

		/* under the gallery: the kitchen, and the aquaponics */
		{
			const ak = aStair + Math.PI
			const kr = (rIn + rWall) / 2 + 0.5
			for (let i = -3; i <= 3; i++) {
				const a = ak + (i * 1.1) / kr
				const [x, z] = polar(kr + 1.2, a)
				scene.add(box(1.05, 0.9, 0.65, m.oak(1), x, 0, z, a))
				scene.add(box(1.08, 0.05, 0.7, m.counter, x, 0.9, z, a))
				colliders.push({ x, z, r: 0.6 })
			}
			const [hx, hz] = polar(kr + 1.35, ak)
			scene.add(box(1.2, 0.8, 0.5, m.dark, hx, 2.1, hz, ak))
			const [ix, iz] = polar(kr - 1.2, ak)
			scene.add(box(3.2, 0.92, 1.1, m.lime(1), ix, 0, iz, ak))
			scene.add(box(3.3, 0.05, 1.2, m.counter, ix, 0.92, iz, ak))
			colliders.push({ x: ix, z: iz, r: 1.7 })
			const aq = aStair - Math.PI / 2
			for (let i = -2; i <= 2; i++) {
				const a = aq + (i * 2.4) / kr
				const [x, z] = polar(kr + 0.6, a)
				const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.1, 24), m.tank)
				tank.position.set(x, 0.55, z)
				tank.castShadow = true
				scene.add(tank)
				const surf = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), m.water(1))
				surf.rotation.x = -Math.PI / 2
				surf.position.set(x, 1.08, z)
				scene.add(surf)
				colliders.push({ x, z, r: 0.95 })
				const [tx, tz] = polar(kr - 1.3, a)
				const trough = raisedBed(m, 2.2, 70 + i)
				trough.position.set(tx, 0.25, tz)
				trough.rotation.y = a + Math.PI / 2
				scene.add(trough)
				colliders.push({ x: tx, z: tz, r: 1.1 })
			}
		}

		/* the stair from the commons up to the gallery */
		{
			const steps = Math.ceil(H / 0.18)
			const stair = new THREE.Group()
			for (let i = 0; i < steps; i++) {
				const rr = r0 + ((i + 0.5) / steps) * run
				const [x, z] = polar(rr, aStair)
				stair.add(box(stairHalf * 2, 0.06, run / steps + 0.02, m.oak(1), x, ((i + 1) / steps) * H - 0.06, z, aStair))
			}
			for (const side of [-1, 1]) {
				const [ox, oz] = polar(stairHalf, aStair + Math.PI / 2)
				const [cx, cz] = polar(r0 + run / 2, aStair)
				const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, Math.hypot(run, H)), m.steel)
				stringer.position.set(cx + ox * side, H / 2, cz + oz * side)
				stringer.rotation.set(-Math.atan2(H, run), aStair, 0, 'YXZ')
				stair.add(stringer)
				const handrail = stringer.clone()
				handrail.scale.set(0.5, 0.15, 1)
				handrail.position.y += 0.95
				stair.add(handrail)
			}
			scene.add(stair)
		}

		const inStair = (x: number, z: number) => {
			const rr = Math.hypot(x, z)
			const a = Math.atan2(x, z)
			const off = Math.abs(Math.atan2(Math.sin(a - aStair), Math.cos(a - aStair))) * rr
			return off < stairHalf && rr >= r0 - 0.3 && rr <= rIn + 0.4 ? Math.max(0, Math.min(1, (rr - r0) / run)) * H : null
		}
		const inStair2 = (x: number, z: number) => {
			if (!twoFloors) return null
			const rr = Math.hypot(x, z)
			if (rr < rIn + 0.1 || rr > rFront - 0.1) return null
			const o = adiff(Math.atan2(x, z), aS2)
			return o >= 0 && o <= span2 ? H + (o / span2) * (H2 - H) : null
		}
		floorAt = (x, z, feet) => {
			const rr = Math.hypot(x, z)
			const options = [0]
			const s = inStair(x, z)
			if (s !== null) options.push(s)
			const s2 = inStair2(x, z)
			if (s2 !== null) options.push(s2)
			if (rr >= rIn - 0.05 && rr < Rt) options.push(H)
			if (twoFloors && rr >= rIn - 0.05 && s2 === null) options.push(H2)
			return Math.max(...options.filter((h) => h <= feet + 0.55))
		}
		// out through the glass onto the terrace, at the first floor
		terraceAt = (rr, y) => Math.abs(y - H) < 0.3 && rr < Rt - 0.5
		blocked = (x, z, feet) => {
			const rr = Math.hypot(x, z)
			// on the galleries, the railings keep you from stepping off
			if (feet > H - 0.6 && rr < rIn && inStair(x, z) === null) return true
			// and outside, the balustrade round the terrace
			if (feet > H - 0.6 && rr > Rt - 0.5) return true
			// on the stair, the stringers keep you on the treads
			return false
		}
		start = { x: 0, z: Rc + 2, look: 0 }
	}

	/* ── walking ─────────────────────────────────────────────────────── */
	const pos = new THREE.Vector3(start.x, 0, start.z)
	let yaw = start.look
	let pitch = -0.05
	let feet = 0
	const keys = new Set<string>()
	const dom = renderer.domElement
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
	let dragging = false
	const look = (dx: number, dy: number) => {
		yaw -= dx * 0.0025
		pitch = Math.max(-1.4, Math.min(1.4, pitch - dy * 0.0025))
	}
	const onDown = () => {
		dragging = true
		dom.requestPointerLock?.()
	}
	const onMove = (e: MouseEvent) => {
		if (document.pointerLockElement === dom || dragging) look(e.movementX, e.movementY)
	}
	const onUp = () => (dragging = false)
	dom.addEventListener('mousedown', onDown)
	window.addEventListener('mousemove', onMove)
	window.addEventListener('mouseup', onUp)

	const wallLimit = (y: number) => Math.sqrt(Math.max(0, R * R - (y + 1.8) ** 2)) - (kind === 'glamp' ? 0.4 : 0.8)
	/** Where a walker may stand: inside the dome, through a door out on the land, or on the terrace. */
	const doorHalf = kind === 'glamp' ? 0.6 : 1.1
	const walkable = (x: number, z: number, y: number) => {
		const rr = Math.hypot(x, z)
		if (rr <= wallLimit(y)) return true
		if (terraceAt(rr, y)) return true
		if (y > 0.5) return false
		const a = Math.atan2(x, z)
		const inDoor = doorsOf(kind).some((d) => Math.abs(adiff(a, d)) < 0.5 && Math.abs(adiff(a, d)) * rr < doorHalf) && rr < R + 1.5
		return inDoor || (rr > R + 0.4 && rr < outerR)
	}

	const step = (dt: number) => {
		const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0)
		const s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0)
		const turn = (keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0)
		yaw += turn * 1.8 * dt
		if (f || s) {
			const speed = (keys.has('shift') ? 7.5 : 3.3) * dt
			const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed
			const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed
			for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz]] as const) {
				const nx = pos.x + mx, nz = pos.z + mz
				const nf = floorAt(nx, nz, feet)
				if (!walkable(nx, nz, nf)) continue
				if (blocked(nx, nz, feet)) continue
				if (nf < 0.3 && [...colliders, ...outsideColliders].some((c) => Math.hypot(c.x - nx, c.z - nz) < c.r + 0.25)) continue
				pos.x = nx
				pos.z = nz
				break
			}
		}
		const target = floorAt(pos.x, pos.z, feet)
		feet += (target - feet) * Math.min(1, dt * 12)
		camera.position.set(pos.x, feet + EYE, pos.z)
		camera.rotation.set(pitch, yaw, 0, 'YXZ')
	}

	const onResize = () => {
		camera.aspect = container.clientWidth / container.clientHeight
		camera.updateProjectionMatrix()
		renderer.setSize(container.clientWidth, container.clientHeight)
	}
	window.addEventListener('resize', onResize)

	let frame = 0
	let last = performance.now()
	const clock0 = performance.now()
	const tick = () => {
		const now = performance.now()
		step(Math.min(0.1, (now - last) / 1000))
		last = now
		const t = (now - clock0) / 1000
		for (const a of animated) a(t)
		renderer.render(scene, camera)
		frame = requestAnimationFrame(tick)
	}
	step(0)
	renderer.render(scene, camera)
	onProgress?.('ready')
	tick()

	/* a dev hook, like the planet's __world: move the camera from the console */
	;(window as unknown as { __interior: unknown }).__interior = {
		camera,
		place: (x: number, z: number, y: number, yw: number, p: number) => {
			pos.set(x, 0, z)
			feet = y
			yaw = yw
			pitch = p
		}
	}

	return {
		dispose() {
			cancelAnimationFrame(frame)
			window.removeEventListener('keydown', kd)
			window.removeEventListener('keyup', ku)
			window.removeEventListener('mousemove', onMove)
			window.removeEventListener('mouseup', onUp)
			window.removeEventListener('resize', onResize)
			dom.removeEventListener('mousedown', onDown)
			if (document.pointerLockElement === dom) document.exitPointerLock()
			scene.traverse((o) => {
				if (o instanceof THREE.Mesh) o.geometry.dispose()
			})
			pmrem.dispose()
			renderer.dispose()
			dom.remove()
		}
	}
}
