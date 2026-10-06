/**
 * INSIDE A DOME — a walkable, first-person interior for each dome of a village:
 *
 *   glamp   16 m   a home for four under canvas and glass, a door onto a deck
 *   home    40 m   the medium domes of the first ring
 *   large   70 m   the large domes of the second ring
 *   master 136 m   the master dome in the centre: a round theatre sunk into its floor,
 *                  and its ground ring given to the village's workshops
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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { flagstone, grass, groundCover, leaves, limestone, oak, soil, water } from './textures'
import { cafes, coops, coopsAround, henPatches, rabbitPatches, squaresAround, workshops, type Kit } from './spaces'
import { antHills, apiary, fishes, herd, TANK_FISH } from './animals'
import { settled as actorsSettled } from '$lib/actors/build'
import { buildFactory, LEVELS as FACTORY_LEVELS, NAMES as FACTORY_NAMES } from './factory'
import { buildTent } from './tent'
import { furnish, terraceSet } from './rooms'
import { ambience, levelsAt, nearness } from './ambience'
import { flow, pond as pondShape, shore, stream as streamShape } from './water'
import { createStage, type StageHandle } from '$lib/sandbox-kit/stage.js'
import { createSky, type SkyHandle } from '$lib/sandbox-kit/sky.js'
import { skyHour } from '$lib/sandbox-kit/skyTime.svelte.js'
import { createWalker } from '$lib/sandbox-kit/walker.js'
import { createObstacles } from '$lib/sandbox-kit/obstacles.js'
import { connectFilm, filmDraws, filmHoldsSize, worldTime } from '$lib/sandbox-kit/film.js'
import { createForest, type Forest } from './flora.js'
import { BIOMES, groundMaterial } from '$lib/biomes'
import { coverStream } from '$lib/biomes/stream.js'
import { swapLegacy } from './legacy.js'
import { pick as pickPlant, type Garden } from './sandbox5.js'
import { forestFloor, floorPick, grassTuft, appleTree, banana, berryBush, canopyTree, climber, clover, coconutPalm, comfrey, crop, CROPS, type Crop, fruitTree, ginger, grapePergola, herb, papaya, passionVine, potted, seeded, shrub, smallFruitTree, squash, strawberries, tropicalShrub, vineAlong, type Plant } from './plants'

export type DomeKind = 'tent' | 'glamp' | 'home' | 'large' | 'master' | 'factory'

type Spec = { diameter: number; detail: number; strut: number; gallery?: { height: number; depth: number; rooms: number; floors: 1 | 2 } }
export const DOMES: Record<DomeKind, Spec & { label: string; people: string }> = {
	tent: { label: 'Bell tent', people: 'two people', diameter: 4.2, detail: 0, strut: 0 },
	glamp: { label: 'Glamping dome', people: 'four people', diameter: 16, detail: 3, strut: 0.06 },
	home: { label: 'Medium dome', people: 'twelve people', diameter: 40, detail: 4, strut: 0.09, gallery: { height: 4.2, depth: 8, rooms: 6, floors: 1 } },
	large: { label: 'Large dome', people: 'twenty-four people', diameter: 70, detail: 5, strut: 0.12, gallery: { height: 5, depth: 10.5, rooms: 10, floors: 2 } },
	master: { label: 'Master dome', people: 'the commons', diameter: 136, detail: 7, strut: 0.16, gallery: { height: 6, depth: 12.5, rooms: 16, floors: 2 } },
	factory: { label: 'Solar factory dome', people: 'the factory coop', diameter: 136, detail: 7, strut: 0.16 }
}

/** The big domes have four doors, one to each point of the compass; the glamping dome has one. */
export const DOORS = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
export const doorsOf = (kind: DomeKind) => (kind === 'glamp' || kind === 'tent' ? [0] : DOORS)
/** A door's half-width, and its height at the top of the arch (the glamping door is square-headed). */
const doorSize = (kind: DomeKind) => (kind === 'tent' ? { dw: 0.55, dh: 1.8, top: 1.8 } : kind === 'glamp' ? { dw: 0.75, dh: 2.5, top: 2.5 } : { dw: 1.3, dh: 3, top: 3 + 1.3 * 0.4 })
/** The signed difference between two angles, in -π..π. */
/** Sandbox 5: the biome of the floor under the glass ($lib/biomes) */
const WARM_BIOME = BIOMES.find((b) => b.id === 'warm-food-forest')!
export const adiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/** A texture tiled to a world size: `metres` of surface per repeat of the image. */
function tiled(tex: THREE.Texture, repeatX: number, repeatY = repeatX): THREE.Texture {
	const t = tex.clone()
	t.repeat.set(repeatX, repeatY)
	t.wrapS = t.wrapT = THREE.RepeatWrapping
	t.needsUpdate = true
	return t
}

/**
 * The low sun on the glass: the panels that face it glow warm, most where they are seen at a grazing angle. Off (0)
 * unless a film shot turns it up (its `glass` light); the world sets where the sun is every frame. Shared by every
 * dome's glass, near or far.
 */
export const glassSheen = {
	uGlassSheen: { value: 0 },
	uGlassSheenColor: { value: new THREE.Color('#ffb070') },
	uGlassSun: { value: new THREE.Vector3(0, 1, 0) }
}
function withSheen<M extends THREE.MeshPhysicalMaterial>(m: M): M {
	m.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, glassSheen)
		sh.fragmentShader = sh.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform float uGlassSheen;\nuniform vec3 uGlassSheenColor;\nuniform vec3 uGlassSun;')
			.replace(
				'#include <emissivemap_fragment>',
				`#include <emissivemap_fragment>
				if ( uGlassSheen > 0.0 ) {
					vec3 sunV = normalize( ( viewMatrix * vec4( uGlassSun, 0.0 ) ).xyz );
					float facing = max( dot( normal, sunV ), 0.0 );
					float grazing = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 2.0 );
					totalEmissiveRadiance += uGlassSheenColor * uGlassSheen * facing * ( 0.35 + 0.65 * grazing );
				}`
			)
	}
	m.customProgramCacheKey = () => 'glass-sheen'
	return m
}

/**
 * The dome's panels are solar glass: clear glass with rows of cells laid in it,
 * lightly tinted, with gaps between the cells so the light still falls through
 * to the forest inside. One triangle of it, drawn once, on every panel.
 */
let solarCache: THREE.MeshPhysicalMaterial | null = null
function solarGlass(): THREE.MeshPhysicalMaterial {
	if (solarCache) return solarCache
	const s = 256
	const c = document.createElement('canvas')
	c.width = c.height = s
	const x = c.getContext('2d')!
	x.fillStyle = 'rgba(220,238,242,0.10)'
	x.fillRect(0, 0, s, s)
	x.save()
	x.beginPath()
	x.moveTo(s / 2, s * 0.1)
	x.lineTo(s * 0.92, s * 0.9)
	x.lineTo(s * 0.08, s * 0.9)
	x.closePath()
	x.clip()
	for (let yy = 0; yy < s; yy += 26)
		for (let xx = 0; xx < s; xx += 26) {
			x.fillStyle = 'rgba(24,40,86,0.55)'
			x.fillRect(xx + 5, yy + 5, 17, 17)
			x.fillStyle = 'rgba(210,216,226,0.5)'
			x.fillRect(xx + 5, yy + 12, 17, 1)
		}
	x.restore()
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	tex.anisotropy = 8
	solarCache = withSheen(new THREE.MeshPhysicalMaterial({ map: tex, color: '#ffffff', roughness: 0.06, metalness: 0.1, transparent: true, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false }))
	return solarCache
}

/**
 * The surfaces are shared: every call for oak at the same scale, in any dome, gets the
 * same material. A dome that asked for a new one each time had nearly two thousand, and
 * every one of them cost the graphics card its own work.
 */
const surfaces = new Map<string, THREE.Material>()
function surface<T extends THREE.Material>(key: string, make: () => T): T {
	let s = surfaces.get(key) as T | undefined
	if (!s) surfaces.set(key, (s = make()))
	return s
}
const k2 = (v: number) => Math.round(v * 20) / 20

/**
 * The lawn: the grass texture laid down in world space, about three metres to a
 * tile, so it never stretches whatever shape the ground is; and a slow drift
 * of lighter and darker patches over tens of metres, so no two stretches of
 * meadow look the same.
 */
let meadowCache: THREE.MeshStandardMaterial | null = null
function meadow(): THREE.MeshStandardMaterial {
	if (meadowCache) return meadowCache
	const mat = new THREE.MeshStandardMaterial({ map: grass(), roughness: 1 })
	mat.onBeforeCompile = (sh) => {
		sh.vertexShader = sh.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
			.replace('#include <uv_vertex>', '#include <uv_vertex>\nvec4 gp = modelMatrix * vec4(position, 1.0);\nvGround = gp.xz;\nvMapUv = gp.xz / 3.2;')
		sh.fragmentShader = sh.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
			.replace('#include <map_fragment>', '#include <map_fragment>\nfloat drift = texture2D(map, vGround / 61.0).g * 0.6 + texture2D(map, vGround / 23.0 + 0.3).r * 0.4;\ndiffuseColor.rgb *= mix(0.78, 1.18, drift);')
	}
	mat.customProgramCacheKey = () => 'meadow'
	return (meadowCache = mat)
}

export const mats = () => {
	const flag = flagstone()
	return {
		stone: (rx: number, ry = rx) => surface(`stone ${k2(rx)} ${k2(ry)}`, () => new THREE.MeshStandardMaterial({ map: tiled(flag.map, k2(rx), k2(ry)), bumpMap: tiled(flag.bump, k2(rx), k2(ry)), bumpScale: 2, roughness: 0.85 })),
		lime: (rx: number, ry = rx) => surface(`lime ${k2(rx)} ${k2(ry)}`, () => new THREE.MeshStandardMaterial({ map: tiled(limestone(), k2(rx), k2(ry)), roughness: 0.9 })),
		oak: (rx: number, ry = rx) => surface(`oak ${k2(rx)} ${k2(ry)}`, () => new THREE.MeshStandardMaterial({ map: tiled(oak(), k2(rx), k2(ry)), roughness: 0.82, envMapIntensity: 0.4 })),
		soil: (rep: number) => surface(`soil ${k2(rep)}`, () => new THREE.MeshStandardMaterial({ map: tiled(soil(), k2(rep)), roughness: 1 })),
		water: (rep: number) => surface(`water ${k2(rep)}`, () => new THREE.MeshPhysicalMaterial({ map: tiled(water(), k2(rep)), roughness: 0.08, metalness: 0, transparent: true, opacity: 0.88, envMapIntensity: 1.4 })),
		steel: new THREE.MeshStandardMaterial({ color: '#2e3236', roughness: 0.4, metalness: 0.7 }),
		timberFrame: new THREE.MeshStandardMaterial({ color: '#9c6b3f', roughness: 0.6 }),
		solar: solarGlass(),
		glass: withSheen(new THREE.MeshPhysicalMaterial({ color: '#eef6f4', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false })),
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
		grass: meadow()
	}
}
export type Mats = ReturnType<typeof mats>

/** Polar placement: angle 0 faces +z, clockwise to +x — the same sense as three's cylinders. */
export const polar = (r: number, a: number): [number, number] => [r * Math.sin(a), r * Math.cos(a)]

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, rotY = 0): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
	m.position.set(x, y + h / 2, z)
	m.rotation.y = rotY
	m.castShadow = m.receiveShadow = true
	return m
}

/**
 * bake(), a slice at a time: the same meshes, but the page gets a frame back every few
 * milliseconds while it works, and big materials are merged in chunks rather than all at once.
 */
export async function bakeSliced(group: THREE.Group, shadows: boolean, slice: () => Promise<void>): Promise<THREE.Group> {
	group.updateMatrixWorld(true)
	const meshes: THREE.Mesh[] = []
	group.traverse((o) => o instanceof THREE.Mesh && meshes.push(o))
	const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
	for (let i = 0; i < meshes.length; i++) {
		const o = meshes[i]!
		const g = o.geometry.clone().applyMatrix4(o.matrixWorld)
		for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
		const list = byMat.get(o.material as THREE.Material) ?? []
		list.push(g.index ? g.toNonIndexed() : g)
		byMat.set(o.material as THREE.Material, list)
		if (i % 32 === 0) await slice()
	}
	const out = new THREE.Group()
	for (const [mat, geos] of byMat)
		for (let i = 0; i < geos.length; i += 400) {
			const merged = mergeGeometries(geos.slice(i, i + 400))
			await slice()
			if (!merged) continue
			merged.userData.baked = true
			const m = new THREE.Mesh(merged, mat)
			m.castShadow = shadows
			m.receiveShadow = true
			out.add(m)
		}
	return out
}

/** Bakes a group into one mesh per material, so a forest costs a handful of draw calls. */
export function bake(group: THREE.Group, shadows = true): THREE.Group {
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
		merged.userData.baked = true
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
export function geodesic(spec: Spec, m: Mats, kind: DomeKind): { group: THREE.Group; holes: DoorHole[] } {
	const R = spec.diameter / 2
	const ico = new THREE.IcosahedronGeometry(R, spec.detail)
	const p = ico.attributes.position!
	const glass: number[] = []
	const clear: number[] = []
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
	// the door panels: every triangle any part of which, seen head-on, falls in the doorway —
	// so no panel and no strut is left crossing it
	const { dw, top } = doorSize(kind)
	const skip = new Set<number>()
	const holes: DoorHole[] = []
	for (const d of doorsOf(kind)) {
		const tang = (v: THREE.Vector3) => v.x * Math.cos(d) - v.z * Math.sin(d)
		const inDoorway = (v: THREE.Vector3) => Math.abs(tang(v)) < dw + 0.35 && v.y < top + 0.35
		const cand = tris.map((t, i) => ({ i, t })).filter(({ t }) => Math.abs(adiff(t.ca, d)) < Math.PI / 4)
		// the glamping dome's panels are small: its door takes the lowest ones nearest the door's line
		const nearest = Math.min(...cand.filter(({ t }) => t.c.y < R * 0.3).map(({ t }) => Math.abs(tang(t.c))))
		let halfWidth = 0, height = 0, depth = Infinity
		for (const { i, t } of cand) {
			const [a, b, c] = t.tri as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
			let hit = kind === 'glamp' && t.c.y < R * 0.3 && Math.abs(tang(t.c)) <= nearest + 0.6
			if (kind === 'glamp' && !hit) continue
			for (let u = 0; u <= 6 && !hit; u++)
				for (let w = 0; w <= 6 - u && !hit; w++) hit = inDoorway(a.clone().multiplyScalar(u / 6).addScaledVector(b, w / 6).addScaledVector(c, (6 - u - w) / 6))
			if (!hit) continue
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
		// in front of the rooms the glass is clear, no cells in it: a window onto the terrace and the land
		const gal = spec.gallery
		const byRooms = gal && [gal.height, ...(gal.floors === 2 ? [gal.height + 3.6] : [])].some((f) => c.y > f - 0.4 && c.y < f + 3.4)
		;(!isWindow ? cloth : byRooms ? clear : glass).push(...tri.flatMap((v) => [v.x, v.y, v.z]))
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
		// every panel a whole triangle of the solar pattern
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: arr.length / 9 }, () => [0.5, 0.9, 0.92, 0.1, 0.08, 0.1]).flat(), 2))
		geo.computeVertexNormals()
		const mesh = new THREE.Mesh(geo, mat)
		mesh.castShadow = shadow
		mesh.renderOrder = 2
		g.add(mesh)
	}
	shell(glass, m.solar, false)
	shell(clear, m.glass, false)
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
export function portal(m: Mats, hole: DoorHole, kind: DomeKind): THREE.Group {
	const g = new THREE.Group()
	const W = hole.halfWidth + 0.15
	const Ht = Math.max(hole.height, 3.2)
	const { dw, dh } = doorSize(kind)
	const spring = dh - dw * 0.6
	const shape = new THREE.Shape()
	shape.moveTo(-W, 0)
	shape.lineTo(W, 0)
	shape.lineTo(W, Ht)
	shape.lineTo(-W, Ht)
	shape.closePath()
	const opening = new THREE.Path()
	opening.moveTo(-dw, 0)
	opening.lineTo(dw, 0)
	// a round-headed arch over the big domes' doors
	if (kind === 'glamp') opening.lineTo(dw, dh), opening.lineTo(-dw, dh)
	else opening.lineTo(dw, spring), opening.absarc(0, spring, dw, 0, Math.PI, false)
	opening.lineTo(-dw, 0)
	shape.holes.push(opening)
	const geo = new THREE.ShapeGeometry(shape, 16)
	// a shape's uvs are its own metres: one course of blocks every 40 cm, as on the knee wall
	const wall = new THREE.Mesh(geo, kind === 'glamp' ? m.canvas : m.lime(1 / 3.2, 1 / 3.2))
	;(wall.material as THREE.Material).side = THREE.DoubleSide
	wall.castShadow = wall.receiveShadow = true
	g.add(wall)
	if (kind === 'glamp') {
		g.add(box(0.18, dh, 0.3, m.timberFrame, -dw - 0.05, 0, 0))
		g.add(box(0.18, dh, 0.3, m.timberFrame, dw + 0.05, 0, 0))
		g.add(box(dw * 2 + 0.3, 0.2, 0.32, m.timberFrame, 0, dh, 0))
	} else {
		// a dressed limestone surround: jambs to the spring of the arch, and a ring of voussoirs over it
		const trim = m.lime(0.5, 1)
		for (const side of [-1, 1]) g.add(box(0.4, spring, 0.5, trim, side * (dw + 0.2), 0, 0))
		const arch = new THREE.Mesh(new THREE.TorusGeometry(dw + 0.2, 0.22, 8, 24, Math.PI), trim)
		arch.scale.z = 1.1
		arch.position.y = spring
		arch.castShadow = true
		g.add(arch)
	}
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

export function sofa(m: Mats, len = 2.4): THREE.Group {
	const g = new THREE.Group()
	g.add(box(len, 0.42, 0.95, m.sofa))
	g.add(box(len, 0.45, 0.25, m.sofa, 0, 0.42, -0.36))
	for (let i = 0; i < 3; i++) g.add(box(0.45, 0.4, 0.14, m.cushion, (i - 1) * len * 0.3, 0.5, -0.22))
	return g
}

export function table(m: Mats, len: number, chairs: number): THREE.Group {
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

export function lantern(m: Mats, r: number, y: number): THREE.Group {
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

/* ── the scene ───────────────────────────────────────────────────────── */

export type InteriorHandle = {
	dispose: () => void
	/** in the factory's lift: the floor it stands at and its name; null anywhere else */
	lift: () => { floor: number; name: string; top: number } | null
	/** send the lift a floor up (1) or down (-1), as the arrow keys do */
	liftStep: (dir: 1 | -1) => void
	/** walk from a touch joystick: x to the right, y ahead, each -1…1; hurry when pushed to the edge */
	move: (x: number, y: number, hurry: boolean) => void
	/** turn the view by a finger's drag, in pixels */
	look: (dx: number, dy: number) => void
	/** built into a host world: its floors and lamps */
	embedded?: EmbeddedDome
}

/** Where to come in, and what to do on walking back out (Sandbox 4's village). */
export type InteriorOptions = {
	entry?: number; onLeave?: (door: number) => void; host?: DomeHost; cancelled?: () => boolean; hurry?: () => boolean; background?: () => boolean
	/** Sandbox 5: the food forest inside grown from our plants ($lib/plants, ./flora.js), from this garden (./sandbox5.js) */
	flora?: { garden: Garden; seed: string }
}
/**
 * Building a dome into someone else's world (Sandbox 4's village): its scene,
 * camera and renderer, and where the dome stands. The dome then brings no sky,
 * sun or land of its own, does not walk, and hands back its floors instead.
 */
export type DomeHost = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; x: number; z: number }
/** A dome built into a host world, in its own coordinates (centre at 0, 0). */
export type EmbeddedDome = {
	root: THREE.Object3D
	floorAt: (x: number, z: number, feet: number) => number
	blocked: (x: number, z: number, here: number) => boolean
	/** inside the glass, on a terrace, or in a doorway */
	inside: (x: number, z: number, y: number) => boolean
	/** something standing there, on that floor (a step out of what you already stand in, from `from`, is free) */
	hits: (x: number, z: number, y: number, from?: { x: number; z: number }) => boolean
	/** its lamps, for the host's lights to follow */
	spots: { x: number; y: number; z: number; base: number; reach: number }[]
	update: (t: number) => void
	setHour: (hour: number) => void
	/** Sandbox 5: the plant of its forest a ray (in the dome's own ground) meets first, if any */
	pickPlant?: Forest['pick']
	dispose: () => void
}

export async function mountInterior(container: HTMLElement, kind: DomeKind, onProgress?: (label: string) => void, opts: InteriorOptions = {}): Promise<InteriorHandle> {
	/** Let the page paint between the heavy steps, so the loading screen keeps moving. */
	let lastYield = performance.now()
	/** a build no longer wanted stops at its next breath, and leaves the page to the next one */
	const stopIfCancelled = () => {
		if (opts.cancelled?.()) throw new Error('cancelled')
	}
	const prof = { work: 0, slices: 0, t0: performance.now(), mark: performance.now() }
	;(window as unknown as { __prof?: unknown }).__prof = prof
	const pause = async (label: string) => {
		stopIfCancelled()
		const w = window as unknown as { __buildLog?: string[] }
		w.__buildLog?.push(`${kind} ${label}: work ${Math.round(prof.work + performance.now() - lastYield)}ms in ${prof.slices} slices, wall ${Math.round(performance.now() - prof.t0)}ms`)
		onProgress?.(label)
		await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
		lastYield = performance.now()
		stopIfCancelled()
	}
	const bakeIn = (group: THREE.Group, shadows = true) => {
		swap(group)
		return bakeSliced(group, shadows, slice)
	}
	/** Hand the page back for a frame whenever this build has held it for more than a few milliseconds. */
	const slice = async () => {
		// the standalone view is behind its loading screen: it can work in longer stretches
		// in a village it works in short breaths; when you are at its door waiting, in long ones
		// a dome built in the background, far from you, takes only a sliver of each frame
		if (performance.now() - lastYield < (host ? (opts.hurry?.() ? 70 : opts.background?.() ? 7 : 24) : 60)) return
		prof.work += performance.now() - lastYield
		prof.slices++
		await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
		lastYield = performance.now()
		stopIfCancelled()
	}
	const spec = DOMES[kind]
	const R = spec.diameter / 2
	const m = mats()
	const host = opts.host

	const huge = kind === 'master' || kind === 'factory'
	/** the tent and the glamping dome stand in the forest the same way: small, one door */
	const lite = kind === 'glamp' || kind === 'tent'
	// standing alone (Sandbox 3) the dome has the kit's stage, sky and walker ($lib/sandbox-kit); built into a host's
	// world (Sandbox 4) it draws with the host's
	const stage: StageHandle | null = host ? null : createStage(container, { maxPixelRatio: huge ? 1.25 : 1.5, near: 0.05, far: R * 30 + 500 })
	const renderer = host?.renderer ?? stage!.renderer

	// built into a host's world, the dome is a scene of its own standing in it
	const scene = stage?.scene ?? new THREE.Scene()
	// a hair above the host's ground, so its grass never shows through the dome's floor;
	// it joins the host's world only when it is complete (see the end)
	if (host) scene.position.set(host.x, 0.03, host.z)
	const camera = host?.camera ?? stage!.camera
	// where the eye is, in the dome's own ground (a host's dome stands off its middle): the animals near it move every bone
	const eye = () => ({ x: camera.position.x - (host?.x ?? 0), z: camera.position.z - (host?.z ?? 0) })

	/* the sun stands where the in-game clock says: it rises in the east, crosses
	   the south, sets in the west, and the sky, the light and the reflections
	   follow it through the day and into the night ($lib/sandbox-kit/sky, made
	   once the lamps are). A dev hook (window.__interiorLight = 'golden') holds it
	   at late afternoon for the journal's pictures, and window.__interiorHour (the
	   film camera's) pins any hour. */
	const dev = window as unknown as { __interiorLight?: string; __interiorHour?: number }
	const golden = dev.__interiorLight === 'golden'
	// the hour of every world: the time control's (Auto, the in-game clock, or set by hand), or the journal's golden hour
	const clockHour = () => (golden ? 17.8 : skyHour())
	let sky: SkyHandle | null = null
	const hourNow = () => (sky ? sky.hour() : (dev.__interiorHour ?? clockHour()))
	const MOON = new THREE.Color('#8ea6dc')

	/* the night: warm lamps that come on as the light goes, not bright, just enough
	   to walk by and sit under. Each is a real light, and the hanging ones let a
	   soft cone of it fall to the floor; small lights glow along the paths. */
	/** lights with a place of their own (the tent's lantern), dimmed and lit with the hour */
	const lamps: { light: THREE.PointLight; base: number }[] = []
	/** every other lamp in the dome, as a spot: its place, how bright, how far it reaches */
	const spots: { x: number; y: number; z: number; base: number; reach: number }[] = []
	/* A browser lights a scene with only so many real lights at once. So a pool of
	   them follows you: the lamps nearest you light their rooms, their stairs and
	   their stretch of path, and every lamp further off glows where it hangs. */
	const POOL = host ? 0 : 8
	const pool = Array.from({ length: POOL }, () => {
		const light = new THREE.PointLight('#ffc98a', 0, 10, 2)
		scene.add(light)
		return light
	})
	let nightNow = 0
	const lightNearest = () => {
		const cx = camera.position.x - (host?.x ?? 0), cy = camera.position.y, cz = camera.position.z - (host?.z ?? 0)
		const near = nightNow > 0.01 ? spots.map((sp, i) => ({ i, d: (sp.x - cx) ** 2 + (sp.y - cy) ** 2 * 4 + (sp.z - cz) ** 2 })).sort((a, b) => a.d - b.d).slice(0, POOL) : []
		pool.forEach((light, j) => {
			const n = near[j]
			if (!n) return void (light.intensity = 0)
			const sp = spots[n.i]!
			light.position.set(sp.x, sp.y, sp.z)
			light.distance = sp.reach
			light.intensity = sp.base * nightNow
		})
	}
	const beamMat = (() => {
		const c = document.createElement('canvas')
		c.width = 4
		c.height = 64
		const x = c.getContext('2d')!
		const grad = x.createLinearGradient(0, 0, 0, 64)
		grad.addColorStop(0, '#ffffff')
		grad.addColorStop(0.35, '#6a6a6a')
		grad.addColorStop(1, '#000000')
		x.fillStyle = grad
		x.fillRect(0, 0, 4, 64)
		return new THREE.MeshBasicMaterial({ color: '#ffcf8f', alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
	})()
	const glowMat = new THREE.MeshStandardMaterial({ color: '#fff0d0', emissive: '#ffc070', emissiveIntensity: 0.1, roughness: 0.5 })
	/** A lamp at (x, y, z): its light, reaching `reach` metres; with `floor`, a cone of light falling to it. */
	const addLamp = (x: number, y: number, z: number, base: number, reach: number, floor?: number) => {
		spots.push({ x, y, z, base, reach })
		if (floor !== undefined) {
			const h = y - floor
			const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.min(h * 0.42, 4.5), h, 28, 1, true), beamMat)
			cone.position.set(x, floor + h / 2, z)
			cone.renderOrder = 3
			scene.add(cone)
		}
	}
	/** Little lights along a path round the centre, at radius `rr`. */
	const pathLights = (rr: number, every: number, y = 0) => {
		const n = Math.max(8, Math.round((2 * Math.PI * rr) / every))
		const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 0.55, 8).translate(0, 0.275, 0), m.dark, n)
		const tops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 10, 8), glowMat, n)
		const m4 = new THREE.Matrix4()
		for (let i = 0; i < n; i++) {
			const [x, z] = polar(rr, ((i + 0.5) / n) * Math.PI * 2)
			posts.setMatrixAt(i, m4.makeTranslation(x, y, z))
			tops.setMatrixAt(i, m4.makeTranslation(x, y + 0.6, z))
			spots.push({ x, y: y + 0.7, z, base: 2.5, reach: 6 })
		}
		scene.add(posts, tops)
	}

	/** as the light goes the lamps come on: the beams, the glow, the paper; and standing alone, every lamp's light */
	const lampsFor = (night: number) => {
		nightNow = night
		if (!host) {
			for (const l of lamps) l.light.intensity = l.base * night
			lightNearest()
		}
		beamMat.opacity = 0.15 * night
		glowMat.emissiveIntensity = 0.1 + 2.4 * night
		m.paper.emissiveIntensity = 0.6 + 2.2 * night
	}
	/* one dial, the hour, sets it all: the sun's place and colour, the sky, the fill, the fog; below the horizon a pale
	   moon keeps the night walkable. In a host's world only the lamps are ours to light. */
	if (!host)
		sky = createSky(renderer, scene, {
			clock: clockHour,
			// the dome's own shadows, all round it, from a light close by
			shadowsAt: [0, 0],
			shadowReach: R * 1.2,
			shadowMap: huge ? 2048 : 3072,
			shadowNear: 1,
			shadowFar: R * 8 + 60,
			shadowBias: { bias: -0.0004, normal: 0.02 },
			lightDistance: R * 3 + 20,
			fog: { near: R * 1.2, far: R * 9 + 60 },
			onHour: ({ day, night }, { fill }) => {
				// the shadows are drawn again only when the light has moved (the factory, busy with machines and a lift,
				// keeps drawing them every frame)
				renderer.shadowMap.autoUpdate = kind === 'factory'
				renderer.shadowMap.needsUpdate = true
				// the factory works through the night under its own lights
				if (kind === 'factory') {
					fill.intensity += 1.1 * (1 - day)
					fill.color.set('#f4f0e6').lerp(MOON, (1 - day) * 0.3)
				}
				lampsFor(night)
			}
		})
	const setSun = (hour: number) => {
		if (sky) return sky.set(hour)
		lampsFor(1 - THREE.MathUtils.smoothstep(Math.sin(((hour - 5) / 15) * Math.PI), -0.02, 0.18))
	}
	setSun(hourNow())

	await pause('Letting in the light')
	const animated: ((t: number) => void)[] = []
	/** what can be heard: the water, and where each herd is */
	const waterPts: { x: number; z: number }[] = []
	const herds: Parameters<typeof levelsAt>[4] = {}
	/** the small plants of each forest sector, hidden when you are far from them */
	const detail: { group: THREE.Object3D; x: number; z: number }[] = []
	/** Sandbox 5: the forest inside grown from our plants, drawn as the eye moves and looks round (./flora.js); every
	 *  stand-in plant of Sandbox 4's (in a bed, a pot, on a pergola) traded for one of them (./legacy.js) */
	const forest: Forest | null = opts.flora ? createForest({ tree: [28, 75], shrub: [16, 40], cover: [9, 22] }) : null
	const swapR = seeded(kind.length * 97 + 13)
	const swap = (root: THREE.Object3D) => {
		if (forest && opts.flora) swapLegacy(root, scene, forest, { warm: true, seed: opts.flora.seed, r: swapR })
	}
	const looking = new THREE.Vector3()
	/** Sandbox 5's trees, to stand in the way by their trunks once grown */
	const floraTreesAll: { c: { x: number; z: number; r: number }; kind: ReturnType<typeof pickPlant>; s: number }[] = []
	/** Sandbox 5: the floor's cover, streamed round the eye (made once the forest inside is planted) */
	let floorCover: ReturnType<typeof coverStream> | null = null
	const keepDetail = (cx: number, cz: number) => {
		// on film every tile in reach is built for the frame it is first seen in
		floorCover?.update(cx, cz, filmDraws() ? 999 : 1)
		for (const d of detail) d.group.visible = Math.hypot(d.x - cx, d.z - cz) < Math.max(30, R * 0.45)
		if (forest) {
			camera.getWorldDirection(looking)
			forest.update(cx, cz, looking.x, looking.z)
		}
	}

	/* the land outside, seen through the glass */
	// a ring, not a disc, so nothing lies over the master dome's sunken theatre
	const outside = new THREE.Mesh(new THREE.RingGeometry(R * 0.5, R * 20 + 200, 96, 1), m.grass)
	outside.rotation.x = -Math.PI / 2
	outside.position.y = -0.02
	outside.receiveShadow = true
	scene.add(outside)
	/* the stone arcade that carries the terrace round a big dome, and the ring
	   where the forest starts */
	const G = spec.gallery
	// the terraces are wide: room for tables, daybeds and benches, and to walk past them
	const Rt = G ? R + 6 : R + 0.8
	const outsideColliders: { x: number; z: number; r: number }[] = []
	const outerR = lite ? R + 44 : R + Math.min(60, R * 0.9 + 25)
	const ringPath = kind === 'tent' ? R + 5 : lite ? R + 4.2 : Rt + 2.6

	/* paths: a ring round the dome, and one from each door out into the forest */
	if (!host) {
		const stoneRing = new THREE.Mesh(new THREE.RingGeometry(ringPath - 1.2, ringPath + 1.2, 160), m.stone((ringPath * 2) / 3))
		stoneRing.rotation.x = -Math.PI / 2
		stoneRing.position.y = 0.025
		stoneRing.receiveShadow = true
		scene.add(stoneRing)
		for (const d of doorsOf(kind)) {
			const len = outerR - R + 4
			const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.2, len), m.stone(2.2 / 3, Math.round(len / 3)))
			strip.rotation.set(-Math.PI / 2, 0, -d)
			const [x, z] = polar(R - 1 + len / 2, d)
			strip.position.set(x, 0.022, z)
			strip.receiveShadow = true
			scene.add(strip)
		}
	}
	// round the master dome, café squares just off the ring path, where the forest leaves room
	const squareR = ringPath + 7.5
	const squares = kind === 'master' ? [...squaresAround().map((q) => ({ ...q, r: squareR })), ...coopsAround(squareR)].map(({ a, r, radius }) => ({ at: polar(r, a), radius })) : []
	if (!host) pathLights(ringPath + 1.6, 7)
	const onOutsidePath = (x: number, z: number) => {
		const rr = Math.hypot(x, z), a = Math.atan2(x, z)
		return Math.abs(rr - ringPath) < 2.4 || squares.some(({ at: [sx, sz], radius }) => Math.hypot(x - sx, z - sz) < radius + 1.5) || doorsOf(kind).some((d) => Math.abs(adiff(a, d)) < Math.PI / 2 && Math.abs(adiff(a, d)) * rr < 2.6)
	}

	/* a turquoise stream winding round the dome, stones on its banks, a bridge where each path crosses */
	const streamOut: THREE.Vector3[] = []
	const streamW = lite ? 2.6 : 3.6
	if (!host) {
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
		waterPts.push(...streamOut)
		scene.add(streamShape(streamOut, streamW, 0.09))
		scene.add(bake(shore(streamOut, streamW / 2, 31), false))
		animated.push(flow)
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
	if (!host) {
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
			// the forest floor: moss, mycelium, earth, fallen wood, stones, an ant hill, a rock
			around(2, 3.2, (sd) => forestFloor(floorPick(r), sd))
			around(8, 4, () => grassTuft(0.4 + r() * 0.35))
		}
		scene.add(bake(trees))
		scene.add(bake(under, false))
	}
	const kit: Kit = {
		box, table: (len, chairs) => table(m, len, chairs), sofa: (len) => sofa(m, len), lantern: (r, y) => lantern(m, r, y),
		oak: m.oak(1), lime: m.lime(1), stone: (rep) => m.stone(rep), dark: m.dark, steel: m.steel, counter: m.counter,
		timber: m.timberFrame, linen: m.linen, cushion: m.cushion, rug: m.rug, paper: m.paper
	}
	if (kind === 'master' && !host)
		for (const sq of cafes(kit, squareR)) {
			scene.add(bake(sq.group))
			outsideColliders.push(...sq.colliders)
			addLamp(sq.group.position.x, 3, sq.group.position.z, 10, 12)
		}
	// and the hens, in coops among the trees beyond the squares
	if (kind === 'master' && !host)
		for (const c of coops(kit, squareR, !!opts.flora)) {
			scene.add(bake(c.group))
			outsideColliders.push(...c.colliders)
		}
	/* the animals, wandering: hens round the master dome's coops, goats browsing
	   the forest round every dome, geese along the stream */
	if (!host) {
		const beyond = ringPath + (outerR - ringPath) * 0.35
		const goatAt = (a: number) => {
			const [x, z] = polar(beyond, a)
			return { x, z, r: lite ? 7 : 10, n: lite ? 2 : 4 }
		}
		const at = (i: number) => streamOut[Math.min(i, streamOut.length - 1)]!
		const flocks = [
			herd('goat', [0.05, 1.6, 3.2, 4.7].map((a) => goatAt(a + Math.PI / 4)), 71, eye),
			herd('goose', [40, 110, 180, 240].map(at).map((p) => ({ x: p.x, z: p.z, r: 6, n: 5 })), 72, eye),
			herd('frog', [20, 75, 150, 215].map(at).map((p) => ({ x: p.x, z: p.z, r: 3.5, n: 4 })), 74, eye),
			...(kind === 'master' ? [herd('hen', henPatches(squareR), 73, eye), herd('rabbit', rabbitPatches(squareR), 78, eye)] : [])
		]
		for (const f of flocks) {
			scene.add(f.object)
			animated.push(f.update)
		}
		herds.goats = flocks[0]!.where
		herds.geese = flocks[1]!.where
		herds.frogs = flocks[2]!.where
		// two apiaries in the forest, three hives each
		const hiveSpots = [0.9, 2.4, 3.9, 5.4].flatMap((aa) => {
			const [cx, cz] = polar(ringPath + (outerR - ringPath) * 0.55, aa)
			return [0, 1, 2].map((j) => ({ x: cx + j * 1.3, z: cz + (j % 2) * 0.6, rot: aa + Math.PI }))
		})
		const hives = apiary(hiveSpots, 75, eye)
		scene.add(hives.object)
		animated.push(hives.update)
		herds.bees = hives.where
		for (const hs of hiveSpots) outsideColliders.push({ x: hs.x, z: hs.z, r: 0.5 })
		if (flocks[3]) herds.hens = flocks[3].where
		// ant hills, scattered at random over the forest floor (off the paths and the streams), the wood ants busy on them
		{
			const ar = seeded(76)
			const spots: { x: number; z: number; rot: number; size: number }[] = []
			const want = lite ? 6 : kind === 'master' ? 14 : 10
			for (let tries = 0; spots.length < want && tries < want * 30; tries++) {
				const [x, z] = polar(ringPath + 3 + Math.sqrt(ar()) * (outerR - ringPath - 4), ar() * Math.PI * 2)
				if (onOutsidePath(x, z) || nearOutStream(x, z, streamW / 2 + 1.5)) continue
				if (outsideColliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.9)) continue
				if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 6)) continue
				spots.push({ x, z, rot: ar() * Math.PI * 2, size: 0.7 + ar() * 0.6 })
			}
			const ants = antHills(spots, eye, (x, z) => onOutsidePath(x, z) || nearOutStream(x, z, streamW / 2 + 0.4) || Math.hypot(x, z) < Rt + 1)
			scene.add(ants.object)
			animated.push(ants.update)
			for (const p of spots) outsideColliders.push({ x: p.x, z: p.z, r: 0.7 * p.size })
		}
	}
	await pause('Planting the food forest outside')

	if (kind !== 'tent') {
		const shell = geodesic(spec, m, kind)
		scene.add(shell.group)
		for (const hole of shell.holes) scene.add(portal(m, hole, kind))
	}
	await pause(kind === 'tent' ? 'Pitching the tent' : 'Raising the dome')

	/* colliders and floors, for walking */
	/** things in the way, each on the floor it stands on (y, the ground if unset) */
	const colliders: { x: number; z: number; r: number; y?: number }[] = []
	let floorAt = (_x: number, _z: number, _feet: number) => 0
	let blocked = (_x: number, _z: number, _feet: number) => false
	let start = { x: 0, z: R * 0.5, look: 0 }
	let terraceAt = (_rr: number, _y: number) => false
	/** a building's own keys (the factory lift's ↑ and ↓), and where the walker is each frame */
	let onAction = (_k: string, _down: boolean) => false
	let onWalk = (_x: number, _z: number, _feet: number) => {}
	let liftFloor = () => -1
	let factorySounds: ((x: number, z: number, feet: number) => { machine: number; lift: number }) | null = null

	if (kind === 'tent') {
		const tent = buildTent({ scene, R, m, box, bake })
		colliders.push(...tent.colliders)
		lamps.push({ light: tent.lamp, base: 3 })
		start = tent.start
		animated.push(tent.update)
	} else if (kind === 'factory') {
		/* the solar factory dome: five floors of lines round the great lift (factory.ts) */
		await pause('Starting the lines')
		const works = buildFactory({ scene, R, m, box, bake })
		colliders.push(...works.colliders)
		floorAt = works.floorAt
		blocked = works.blocked
		start = works.start
		animated.push(works.update)
		onWalk = works.tick
		onAction = works.onKey
		factorySounds = works.sounds
		liftFloor = works.floor
		await pause('Waking the robots')
	} else if (kind === 'glamp') {
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
			// a patch grown straight in the soil, as the gardens outside
			const patch = crop(CROPS[Math.round(a * 10 + 20) % CROPS.length]!, 90 + Math.round(a * 10), 2.2)
			patch.position.y = 0.02
			put(patch, 7.3, a, a + Math.PI / 2, 0.9)
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
		addLamp(0, 3.1, 0, 16, 11, 0.56)
		addLamp(lx, 2.35, lz, 10, 8, 0)
		// over the kitchen counter, and a reading light in each sleeping nook
		for (const [rr, a, base] of [[6.4, 1.1, 10], [5.8, 2.65, 6], [5.8, -3.02, 6], [5.4, -1.05, 8]] as const) {
			const [x, z] = at(rr, a)
			scene.add(box(0.3, 0.06, 0.3, glowMat, x, 2.45, z))
			addLamp(x, 2.3, z, base, 7)
		}
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
		/* the medium dome is a garden before it is a house: no ring path through its forest, and
		   under its gallery only a walk along the front, the kitchen and the fish tanks are paved;
		   the rest, out to the glass, is planted */
		const lush = kind === 'home'
		const commonsW = 2.2
		const kitchenA = Math.PI * 0.25 + Math.PI, aquaA = Math.PI * 0.25 - Math.PI / 2
		const PAVED = [[kitchenA, 0.3], [aquaA, 0.4]] as const
		const paved = (a: number) => PAVED.some(([c, w]) => Math.abs(adiff(a, c)) < w)
		// the stair on a diagonal, so each spoke runs clear from the plaza to its door
		const aStair = Math.PI * 0.25
		// four stairs up to the gallery, one on each diagonal between the doors
		const STAIRS = [0, 1, 2, 3].map((k) => aStair + (k * Math.PI) / 2)
		// the medium dome's stair is steeper, so it still lands clear of the plaza
		const run = H * (kind === 'home' ? 1.6 : 1.9)
		const r0 = rIn - run
		const stairHalf = 0.9
		const walkway = 2.4

		/* ground: soil, a stone plaza, a ring path and spokes */
		// the master dome's centre is a theatre sunk into the ground, so its floor is a ring round the bowl
		const theatre = kind === 'master'
		// Sandbox 5: the floor under the glass is the warm food forest biome's ($lib/biomes): big fallen leaves, humus,
		// moss and a living mat, run into each other in patches; its cover streamed round you (below)
		const warmFloor = opts.flora ? groundMaterial(WARM_BIOME.surface) : null
		const ground = new THREE.Mesh(theatre ? new THREE.RingGeometry(Rc, R, 96, 1) : new THREE.CircleGeometry(R, 96), warmFloor ?? m.soil(R / 2))
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
		if (theatre) flat(new THREE.RingGeometry(Rc, Rc + 2.4, 96), m.stone(((Rc + 2.4) * 2) / 3))
		else flat(new THREE.CircleGeometry(Rc, 64), m.stone((Rc * 2) / 3))
		/* the theatre: a round stage at the bottom of a bowl of stone tiers, seated all the way round */
		// six tiers of seats, and the rest of the bowl a wide stage
		const aisle = 1.2
		const tier = { w: 0.9, h: 0.42 }
		const tiers = 6
		const stageR = Rc - aisle - tiers * tier.w
		const pit = tiers * tier.h
		const tierIn = (i: number) => Rc - (tiers - i) * tier.w
		/** The floor in the bowl at a radius: the stage, the aisle round it, or a tier. */
		const bowlAt = (rr: number) => {
			if (!theatre || rr >= Rc) return 0
			if (rr <= stageR) return -pit + 0.55
			if (rr < tierIn(0)) return -pit
			return -pit + (Math.floor((rr - tierIn(0)) / tier.w) + 1) * tier.h
		}
		if (theatre) {
			const bowl = new THREE.Group()
			const seat = m.lime(Rc / 2, 0.2)
			for (let i = 0; i < tiers; i++) {
				const r0t = tierIn(i), top = -pit + (i + 1) * tier.h
				const tread = new THREE.Mesh(new THREE.RingGeometry(r0t, r0t + tier.w, 128), m.stone((Rc * 2) / 3))
				tread.rotation.x = -Math.PI / 2
				tread.position.y = top
				bowl.add(tread)
				const riser = new THREE.Mesh(new THREE.CylinderGeometry(r0t, r0t, tier.h, 128, 1, true), seat)
				riser.position.y = top - tier.h / 2
				;(riser.material as THREE.Material).side = THREE.DoubleSide
				bowl.add(riser)
				// stairs down the four spokes: a half step cut into the tier below each riser
				for (const a of DOORS) {
					const [x, z] = polar(r0t - tier.w / 4, a)
					bowl.add(box(1.6, tier.h / 2, tier.w / 2, m.lime(1, 0.3), x, top - tier.h, z, a))
				}
			}
			const floor = new THREE.Mesh(new THREE.RingGeometry(stageR, tierIn(0), 96), m.stone(4))
			floor.rotation.x = -Math.PI / 2
			floor.position.y = -pit
			bowl.add(floor)
			const wall = new THREE.Mesh(new THREE.CylinderGeometry(tierIn(0), tierIn(0), 0.2, 96, 1, true), seat)
			wall.position.y = -pit + 0.1
			bowl.add(wall)
			// the stage: an oak drum with a limestone edge
			const stage = new THREE.Mesh(new THREE.CylinderGeometry(stageR, stageR, 0.55, 96), m.oak(stageR, stageR))
			stage.position.y = -pit + 0.275
			bowl.add(stage)
			const lip = new THREE.Mesh(new THREE.TorusGeometry(stageR, 0.09, 8, 128), m.lime(20, 1))
			lip.rotation.x = -Math.PI / 2
			lip.position.y = -pit + 0.55
			bowl.add(lip)
			// the bowl's sides, down to its floor, so the ground never shows through
			const sideWall = new THREE.Mesh(new THREE.CylinderGeometry(Rc, Rc, 0.3, 96, 1, true), seat)
			sideWall.position.y = -0.15
			bowl.add(sideWall)
			scene.add(await bakeIn(bowl))
		}
		if (!lush) flat(new THREE.RingGeometry(Rp - 1.1, Rp + 1.1, 128), m.stone((Rp * 2) / 3))
		// under the gallery the floor is stone too: the covered commons round the edge
		if (!lush) flat(new THREE.RingGeometry(rIn - 0.4, R, 128), m.stone((R * 2) / 3))
		else {
			flat(new THREE.RingGeometry(rIn - 0.4, rIn + commonsW, 128), m.stone((R * 2) / 3))
			for (const [a, w] of PAVED) flat(new THREE.RingGeometry(rIn + commonsW - 0.01, R, 24, 1, a - w - Math.PI / 2, 2 * w), m.stone((R * 2) / 3))
		}
		for (const a of DOORS) {
			const len = R - Rc
			const strip = flat(new THREE.PlaneGeometry(2, len), m.stone(2 / 3, Math.round(len / 3)), 0.021)
			const [x, z] = polar(Rc + len / 2, a)
			strip.position.x = x
			strip.position.z = z
			strip.rotation.z = -a
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
		waterPts.push(...samples)
		const width = Math.max(0.9, R * 0.035)
		{
			scene.add(streamShape(samples, width, 0.05))
			scene.add(await bakeIn(shore(samples, width / 2, 17), false))
			animated.push(flow)
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
			scene.add(await bakeIn(stones))
			const end = samples[samples.length - 1]!
			// the pond it runs into: an irregular shape, deeper in the middle, reeds and lilies round it
			const pd = pondShape(end.x, end.z, width * 3.6, 91, 0.05)
			scene.add(pd.group)
			scene.add(await bakeIn(shore(pd.outline, 0, 19, { x: end.x, z: end.z }), false))
			waterPts.push(...pd.outline)
			// fish in the pond, and a few in the stream
			const fish = fishes([{ x: end.x, z: end.z, r: width * 3.2, y: 0.02, n: kind === 'master' ? 22 : 12 }], [{ line: samples, y: 0.02, n: kind === 'master' ? 10 : 5 }], 61, eye)
			scene.add(fish.object)
			animated.push(fish.update)
		}
		const pondAt = samples[samples.length - 1]!
		const nearStream = (x: number, z: number, d: number) => Math.hypot(pondAt.x - x, pondAt.z - z) < width * 3.6 * 1.35 + d || samples.some((p) => Math.hypot(p.x - x, p.z - z) < d)

		await slice()
		/* the kitchen garden: patches along both sides of the ring path, for everything that wants a greenhouse —
		   in the medium dome, where the ground is narrower, eight on the diagonals. Grown straight in the soil (no
		   boxes): two strips of a crop side by side, the next patch another crop */
		const bedLen = 3
		const garden = new THREE.Group()
		const small = kind === 'home'
		{
			const perSide = small ? 8 : Math.min(28, Math.floor((2 * Math.PI * Rp) / 4))
			let n = 0
			for (const side of small ? [1] : [-1, 1])
				for (let k = 0; k < perSide; k++) {
					// both strips clear of the ring path (1.1 either side of it) with room for their leaves to spread
					const rr = Rp + side * 2.45
					const a = small ? Math.PI / 4 + Math.floor(k / 2) * (Math.PI / 2) + (k % 2 ? 0.28 : -0.28) : ((k + (side > 0 ? 0.5 : 0)) / perSide) * Math.PI * 2
					if ([...DOORS, ...STAIRS].some((d) => Math.abs(adiff(a, d)) * rr < 3.2)) continue
					const [x, z] = polar(rr, a)
					if (nearStream(x, z, width / 2 + 2)) continue
					const bed = new THREE.Group()
					const kindA = CROPS[n++ % CROPS.length]!, kindB = CROPS[(n * 5) % CROPS.length]!
					for (const [k, side] of [[kindA, -0.5], [kindB, 0.5]] as const) {
						const c = crop(k, 800 + n * 7 + (side > 0 ? 3 : 0), bedLen - 0.2)
						c.position.set(0, 0.02, side)
						bed.add(c)
					}
					bed.position.set(x, 0, z)
					bed.rotation.y = a + Math.PI / 2
					garden.add(bed)
					colliders.push({ x, z, r: 1.3 }, { x: x + Math.cos(a), z: z - Math.sin(a), r: 0.9 }, { x: x - Math.cos(a), z: z + Math.sin(a), r: 0.9 })
				}
		}
		scene.add(await bakeIn(garden, false))

		await slice()
		/* the food forest in the open ground, in seven layers: tall palms, fruit
		   trees, shrubs, herbs, ground cover, roots and climbers, planted as guilds */
		/* in sectors, so what is behind you is not drawn at all, and far away the
		   small plants under the trees are left out: the forest keeps its detail
		   where you are standing */
		type Sector = { forest: THREE.Group; understorey: THREE.Group; cover: THREE.Group; x: number; z: number }
		const sectors = new Map<string, Sector>()
		const sectorAt = (x: number, z: number) => {
			const a = Math.floor(((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * 16)
			const band = Math.hypot(x, z) < (Rc + rIn) / 2 ? 0 : 1
			const key = `${a},${band}`
			let sc = sectors.get(key)
			if (!sc) {
				const ca = ((a + 0.5) / 16) * Math.PI * 2 - Math.PI
				const [cx, cz] = polar(band ? (rIn + (Rc + rIn) / 2) / 2 : (Rc + (Rc + rIn) / 2) / 2, ca)
				sectors.set(key, (sc = { forest: new THREE.Group(), understorey: new THREE.Group(), cover: new THREE.Group(), x: cx, z: cz }))
			}
			return sc
		}
		const r = seeded(kind === 'home' ? 3 : kind === 'large' ? 5 : 9)
		const flora = opts.flora
		/** Sandbox 5's trees, to stand in the way by their trunks once grown */
		const floraTrees: { c: { x: number; z: number; r: number }; kind: ReturnType<typeof pickPlant>; s: number }[] = []
		const area = Math.PI * (rIn * rIn - Rc * Rc)
		// Sandbox 5 plants its warm forest much closer: a tree every 9 m² (11 where it is a house too)
		const trees = opts.flora ? Math.min(kind === 'master' ? 900 : 700, Math.round(area / (lush ? 9 : 11))) : Math.min(kind === 'master' ? 200 : 230, Math.round(area / (lush ? 17 : 26)))
		/** Sandbox 5: whether a plant reaching `reach` round rr, a would stand on stone: the plaza (in the master dome the
		 *  theatre's stone ring round its bowl), the ring path, the paths to the doors and the stairs, the paved corners */
		const onStone = (rr: number, a: number, reach: number) =>
			rr < Rc + (theatre ? 2.4 : 0) + reach + 0.25 ||
			(!lush && Math.abs(rr - Rp) < 1.1 + reach + 0.15) ||
			[...DOORS, ...STAIRS].some((d) => Math.abs(adiff(a, d)) < Math.PI / 2 && Math.abs(Math.sin(adiff(a, d))) * rr < 1 + reach + 0.15)
		const onPath = (rr: number, a: number) =>
			rr < Rc + 1.2 || (!lush && Math.abs(rr - Rp) < (small ? 1.8 : 3.4)) || [...DOORS, ...STAIRS].some((d) => Math.abs(adiff(a, d)) < Math.PI / 2 && Math.abs(adiff(a, d)) * rr < 1.8)
		const tall = kind === 'home' ? 7 : 10
		let placed = 0
		for (let tries = 0; placed < trees && tries < trees * 20; tries++) {
			await slice()
			const a = r() * Math.PI * 2
			const rr = Rc + 1.5 + r() * (rIn - Rc - 3)
			if (onPath(rr, a) || (opts.flora && onStone(rr, a, 1.2))) continue
			const [x, z] = polar(rr, a)
			if (nearStream(x, z, width + 1.4)) continue
			if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < (opts.flora ? 2.1 : 2.8))) continue
			if (flora) {
				// Sandbox 5: a tree of the warm garden at its stage, and round it its guild, all from our plants
				const fs = 0.85 + r() * 0.3
				const kind = pickPlant(flora.garden.trees, r, flora.seed)
				forest!.add(kind, 'tree', x, 0, z, r() * 6.28, fs)
				const c = { x, z, r: 0.5 }
				colliders.push(c)
				floraTrees.push({ c, kind, s: fs })
				placed++
				const near5 = (count: number, dist: number, layer: 'shrubs' | 'climbers' | 'cover') => {
					for (let j = 0; j < count; j++) {
						const b = r() * 6.28, dd = dist * (0.6 + r() * 0.6)
						const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
						const orr = Math.hypot(ox, oz)
						const reach = layer === 'cover' ? 0.45 : 0.9
						if (orr > rIn - 0.8 || onStone(orr, Math.atan2(ox, oz), reach) || nearStream(ox, oz, width / 2 + reach + 0.2)) continue
						forest!.add(pickPlant(flora.garden[layer], r, flora.seed), layer === 'cover' ? 'cover' : 'shrub', ox, 0, oz, r() * 6.28, 0.85 + r() * 0.3)
					}
				}
				near5(1, 2.3, 'shrubs')
				near5(2, 2.2, 'cover')
				if (r() < 0.3) near5(1, 1.1, 'climbers')
				continue
			}
			const pick5 = r()
			const s = 1 + r() * 0.7
			let plant: Plant
			if (pick5 < 0.16) plant = coconutPalm(400 + placed, tall + r() * 4)
			else if (pick5 < 0.36) plant = fruitTree('mango', 100 + placed, s)
			else if (pick5 < 0.52) plant = fruitTree('avocado', 200 + placed, s)
			else if (pick5 < 0.64) plant = fruitTree('citrus', 300 + placed, s)
			else if (pick5 < 0.73) plant = papaya(500 + placed, 3.4 + r() * 1.6)
			else if (pick5 < 0.8) plant = smallFruitTree('fig', 520 + placed, s)
			else if (pick5 < 0.86) plant = smallFruitTree('pomegranate', 540 + placed, s * 0.9)
			else plant = banana(600 + placed, 3 + r() * 1.2)
			plant.object.position.set(x, 0, z)
			plant.object.rotation.y = r() * 6.28
			sectorAt(x, z).forest.add(plant.object)
			colliders.push({ x, z, r: plant.radius + 0.2 })
			placed++
			// its guild, round it
			const around = (count: number, dist: number, make: (seed: number) => THREE.Object3D) => {
				for (let j = 0; j < count; j++) {
					const b = r() * 6.28, dd = dist * (0.6 + r() * 0.6)
					const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
					const orr = Math.hypot(ox, oz)
					if (orr > rIn - 0.8 || onPath(orr, Math.atan2(ox, oz)) || nearStream(ox, oz, width * 0.8)) continue
					const o = make(5000 + placed * 17 + j)
					o.position.set(ox, 0, oz)
					o.rotation.y = r() * 6.28
					sectorAt(ox, oz).understorey.add(o)
				}
			}
			around(1, 2.3, (sd) => (r() < 0.5 ? tropicalShrub('coffee', sd, 1.2 + r() * 0.5) : r() < 0.5 ? tropicalShrub('cacao', sd, 1.5 + r() * 0.4) : berryBush(sd, 0.8 + r() * 0.4)).object)
			around(1, 1.7, (sd) => comfrey(sd, 0.6 + r() * 0.3))
			around(2, 2.4, (sd) => (r() < 0.5 ? strawberries(sd) : clover(sd)))
			around(1, 2, (sd) => (r() < 0.5 ? ginger(sd, 0.8 + r() * 0.4) : squash(sd)))
			if (r() < 0.3) around(1, 0.9, (sd) => passionVine(sd, 2.6 + r()).object)
			around(1, 2.6, (sd) => forestFloor(r() < 0.5 ? 'moss' : r() < 0.5 ? 'mycelium' : r() < 0.6 ? 'log' : 'stones', sd))
		}
		/* the floor between the trees is a food garden too, with hardly any bare earth: patches of salad, radish,
		   kale and chard, strawberries, herbs and peppers, moss and clover between them, in sizes that alternate —
		   and here and there a tomato or a teepee of beans standing over them. Like the rest of the cover it is left
		   out far away (its sector's detail) */
		{
			// the whole food-forest floor is a living ground cover, not bare soil (the paths, the plaza, the water lie
			// over it): the earth shows only in specks
			const living = new THREE.Mesh(new THREE.RingGeometry(Rc + 0.2, rIn, 128, 2), warmFloor ?? new THREE.MeshStandardMaterial({ map: tiled(groundCover(), rIn / 2.2), roughness: 1 }))
			living.rotation.x = -Math.PI / 2
			living.position.y = 0.006
			living.receiveShadow = true
			scene.add(living)
			// under every patch a low green layer — clover, sorrel, purslane as one leafy mat — so the earth shows
			// only in the gaps; a few faces each, merged with the rest of the cover
			const mats3 = ['#55783a', '#628a41', '#4b6e33', '#6f9147'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }))
			const mat = new THREE.CircleGeometry(1, 7)
			const PATCH = 1.2
			// a planting reaches `reach` from its middle: all of it stays off the ring path (1.1 either side), the door
			// paths and the stairs (1 either side of their line), the plaza — never a leaf over a path
			const onWalk = (rr: number, a: number, reach: number) =>
				rr < Rc + reach + 0.3 ||
				(!lush && Math.abs(rr - Rp) < 1.1 + reach + 0.15) ||
				[...DOORS, ...STAIRS].some((d) => Math.abs(adiff(a, d)) < Math.PI / 2 && Math.abs(Math.sin(adiff(a, d))) * rr < 1 + reach + 0.15)
			const LOW: (Crop | 'moss' | 'clover' | 'squash')[] = ['lettuce', 'radish', 'herbs', 'kale', 'strawberry', 'moss', 'lettuce', 'chard', 'clover', 'radish', 'herbs', 'pepper', 'moss', 'squash']
			let n = 0
			for (let gx = -rIn; gx < rIn; gx += PATCH)
				for (let gz = -rIn; gz < rIn; gz += PATCH) {
					if (++n % 40 === 0) await slice()
					const x = gx + (r() - 0.5) * 0.5, z = gz + (r() - 0.5) * 0.5
					const rr = Math.hypot(x, z), a = Math.atan2(x, z)
					const tall = r() < 0.05
					const s = 0.7 + r() * 0.6
					// how far it spreads: half the patch, scaled, more for a tomato's or a bean teepee's leaves
					const reach = (PATCH * 0.95 * s) / 2 + (tall ? 0.35 : 0)
					// and never into the stream or the pond: the water's half width, the reach, a little bank
					if (rr > rIn - 0.7 || onWalk(rr, a, reach) || nearStream(x, z, width / 2 + reach + 0.25)) continue
					// up to a trunk, never through it (a tree's reach is its canopy, not its trunk)
					if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < Math.min(0.6, c.r * 0.5))) continue
					if (flora) {
						// Sandbox 5: a plant of the warm garden's cover, or now and then a climber, on the living ground
						if (!onStone(rr, a, tall ? 0.6 : 0.45)) forest!.add(pickPlant(flora.garden[tall ? 'climbers' : 'cover'], r, flora.seed), tall ? 'shrub' : 'cover', x, 0.01, z, r() * 6.28, 0.8 + r() * 0.4)
						continue
					}
					const green = new THREE.Mesh(mat, mats3[Math.floor(r() * mats3.length)]!)
					green.rotation.set(-Math.PI / 2, 0, r() * 6.28)
					green.scale.set(PATCH * (0.62 + r() * 0.14), PATCH * (0.55 + r() * 0.14), 1)
					green.position.set(x, 0.008 + r() * 0.004, z)
					green.receiveShadow = true
					sectorAt(x, z).cover.add(green)
					const pick = tall ? (r() < 0.6 ? 'tomato' : 'beans') : LOW[Math.floor(r() * LOW.length)]!
					const sd = 12000 + n
					const o = pick === 'moss' ? forestFloor('moss', sd) : pick === 'clover' ? clover(sd, 1.2 * s) : pick === 'squash' ? squash(sd) : crop(pick, sd, PATCH * 0.95)
					o.position.set(x, 0.01, z)
					o.rotation.y = r() * Math.PI * 2
					if (pick !== 'moss' && pick !== 'clover' && pick !== 'squash') o.scale.set(s, 0.85 + r() * 0.35, s)
					sectorAt(x, z)[tall ? 'understorey' : 'cover'].add(o)
				}
		}
		if (lush) {
			/* the planted band under the gallery, out to the glass: nothing taller than the
			   ceiling, everything that likes a little shade — coffee and cacao, berries, ginger,
			   comfrey, strawberries, herbs, moss on the ground */
			const r0b = rIn + commonsW + 0.6, r1b = R - 1.1
			const bandArea = Math.PI * (r1b * r1b - r0b * r0b)
			const offBand = (rr: number, a: number) => paved(a) || DOORS.some((d) => Math.abs(adiff(a, d)) * rr < 1.7)
			let n = 0
			for (let tries = 0; n < bandArea / 4.5 && tries < 2000; tries++) {
				if (tries % 20 === 0) await slice()
				const a = r() * Math.PI * 2
				const rr = r0b + r() * (r1b - r0b)
				if (offBand(rr, a)) continue
				const [x, z] = polar(rr, a)
				if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < 1.6)) continue
				if (flora) {
					// Sandbox 5: a shrub of the warm garden, and round it its cover
					forest!.add(pickPlant(flora.garden.shrubs, r, flora.seed), 'shrub', x, 0, z, r() * 6.28, 0.85 + r() * 0.3)
					colliders.push({ x, z, r: 0.5 })
					n++
					for (let j = 0; j < 3; j++) {
						const b = r() * 6.28, dd = 0.9 + r() * 1.1
						const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
						const orr = Math.hypot(ox, oz)
						if (orr < r0b - 0.3 || orr > R - 0.8 || offBand(orr, Math.atan2(ox, oz))) continue
						forest!.add(pickPlant(flora.garden.cover, r, flora.seed), 'cover', ox, 0, oz, r() * 6.28, 0.8 + r() * 0.4)
					}
					continue
				}
				const pick = r()
				const shrub = pick < 0.3 ? tropicalShrub('coffee', 7000 + n, 1.1 + r() * 0.4) : pick < 0.55 ? tropicalShrub('cacao', 7000 + n, 1.2 + r() * 0.3) : berryBush(7000 + n, 0.8 + r() * 0.4)
				shrub.object.position.set(x, 0, z)
				shrub.object.rotation.y = r() * 6.28
				sectorAt(x, z).forest.add(shrub.object)
				colliders.push({ x, z, r: shrub.radius * 0.8 })
				n++
				for (let j = 0; j < 4; j++) {
					const b = r() * 6.28, dd = 0.9 + r() * 1.1
					const ox = x + Math.cos(b) * dd, oz = z + Math.sin(b) * dd
					const orr = Math.hypot(ox, oz)
					if (orr < r0b - 0.3 || orr > R - 0.8 || offBand(orr, Math.atan2(ox, oz))) continue
					const sd = 7500 + n * 11 + j
					const o = j === 0 ? (r() < 0.5 ? ginger(sd, 0.7 + r() * 0.4) : comfrey(sd, 0.6 + r() * 0.3)) : j === 1 ? (r() < 0.5 ? strawberries(sd) : clover(sd)) : j === 2 ? herb(sd, 0.25 + r() * 0.2) : forestFloor(r() < 0.6 ? 'moss' : 'mycelium', sd)
					o.position.set(ox, 0, oz)
					o.rotation.y = r() * 6.28
					sectorAt(ox, oz)[j === 3 ? 'cover' : 'understorey'].add(o)
				}
			}
			for (let i = 0; i < bandArea * 0.5; i++) {
				if (i % 50 === 0) await slice()
				const a = r() * Math.PI * 2
				const rr = r0b - 0.3 + r() * (R - 0.8 - r0b)
				if (offBand(rr, a)) continue
				const [x, z] = polar(rr, a)
				if (flora) continue
				const hb = herb(9000 + i, 0.2 + r() * 0.25)
				hb.position.set(x, 0, z)
				sectorAt(x, z).cover.add(hb)
			}
		}
		for (const sc of sectors.values()) {
			const small = new THREE.Group()
			small.add(await bakeIn(sc.cover, false), await bakeIn(sc.understorey, false))
			scene.add(await bakeIn(sc.forest), small)
			detail.push({ group: small, x: sc.x, z: sc.z })
		}
		floraTreesAll.push(...floraTrees)
		if (flora) {
			/* Sandbox 5: the warm food forest's cover on its floor — grasses, clover and strawberries in the light, ferns,
			   wood sorrel and moss in the shade, the big leaves fallen — wherever the ground is open: off the plaza, the
			   paths and the stairs, the water, the beds and the trunks; under the gallery too in the medium dome */
			const cell = 4, near = new Map<number, { x: number; z: number; r: number }[]>()
			const cellKey = (ix: number, iz: number) => (ix + 512) * 1024 + iz + 512
			for (const c of colliders) {
				const k = cellKey(Math.floor(c.x / cell), Math.floor(c.z / cell))
				near.set(k, [...(near.get(k) ?? []), c])
			}
			const inTrunk = (x: number, z: number) => {
				const ix = Math.floor(x / cell), iz = Math.floor(z / cell)
				for (let dx = -1; dx <= 1; dx++)
					for (let dz = -1; dz <= 1; dz++) for (const c of near.get(cellKey(ix + dx, iz + dz)) ?? []) if (Math.hypot(c.x - x, c.z - z) < Math.min(0.7, c.r * 0.6) + 0.1) return true
				return false
			}
			const r0b = rIn + commonsW + 0.6
			const open = (x: number, z: number) => {
				const rr = Math.hypot(x, z), a = Math.atan2(x, z)
				if (rr > R - 0.9) return false
				// under the gallery: only the medium dome's planted band, off its paved stretches and its doors
				if (rr > rIn - 0.6) return lush && rr > r0b - 0.3 && !paved(a) && !DOORS.some((d) => Math.abs(adiff(a, d)) * rr < 1.7)
				return !onStone(rr, a, 0.1) && !nearStream(x, z, width / 2 + 0.3) && !inTrunk(x, z)
			}
			floorCover = coverStream({ recipe: WARM_BIOME, open, tile: 8, reach: 24, near: 9, thin: 0.25, density: 3.8, seed: 707 + kind.length, origin: host ? [host.x, host.z] : [0, 0] })
			scene.add(floorCover.object)
		}
		await pause('Planting the forest inside')

		await slice()
		/* the plaza: a long table, sofas, and lanterns — and in the master dome, the theatre */
		if (kind === 'master') {
			// lanterns in a ring high over the stage, and a few instruments waiting on it
			for (let k = 0; k < 12; k++) {
				const l = lantern(m, 0.7, H + 12 + (k % 3) * 1.5)
				const [x, z] = polar(Rc * 0.62, (k * Math.PI) / 6)
				l.position.set(x, 0, z)
				scene.add(l)
				if (k % 3 === 0) addLamp(x, H + 11.4, z, 220, 46, -pit + 0.55)
			}
			const props = new THREE.Group()
			const floorY = -pit + 0.55
			const rug = new THREE.Mesh(new THREE.CircleGeometry(stageR * 0.45, 48), m.rug)
			rug.rotation.x = -Math.PI / 2
			rug.position.y = floorY + 0.01
			props.add(rug)
			for (let k = 0; k < 5; k++) {
				const [x, z] = polar(stageR * 0.3, (k * Math.PI * 2) / 5)
				const st = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 14), m.oak(1))
				st.position.set(x, floorY + 0.25, z)
				props.add(st)
			}
			const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.6, 20), m.cushion)
			drum.position.set(0, floorY + 0.3, 0)
			props.add(drum)
			scene.add(await bakeIn(props))
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
				addLamp(x, H + 1.5 + (k % 3), z, 30, 20, 0)
			}
		}

		await slice()
		/* the balconies, Mediterranean: terracotta pots along the rails, and grapevines trained along their tops */
		const balconyPot = (k: number, x: number, y: number, z: number) => {
			const p = potted(k % 12 === 0 ? 'olive' : k % 12 === 6 ? 'lemon' : k % 2 ? 'rosemary' : 'lavender', 5000 + k, k % 6 === 0 ? 0.8 : 1)
			p.position.set(x, y, z)
			return p
		}
		const railVines = (group: THREE.Group, y: number, gaps: number[]) => {
			const segs = Math.round((2 * Math.PI * rIn) / 2.6)
			for (let k = 0; k < segs; k++) {
				const a = ((k + 0.5) / segs) * Math.PI * 2
				if (gaps.some((gp) => Math.abs(adiff(a, gp)) * rIn < 2.6) || k % 4 === 3) continue
				const v = vineAlong(6000 + k + Math.round(y) * 100, 2.4)
				const [x, z] = polar(rIn, a)
				v.position.set(x, y + 1.05, z)
				v.rotation.y = a + Math.PI / 2
				group.add(v)
			}
		}

		await slice()
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
		// the glass railing, open where each of the four stairs arrives
		const gap = (stairHalf * 1.3) / rIn
		for (const as of STAIRS) {
			const rail = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, 1.05, 48, 1, true, as + gap, Math.PI / 2 - 2 * gap), m.glass)
			rail.position.y = H + 0.52
			scene.add(rail)
			// a torus arc starts at +x and runs toward -z once laid flat; turn it to start past the stair
			const top = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.035, 8, 60, Math.PI / 2 - 2 * gap), m.steel)
			top.rotation.x = -Math.PI / 2
			const topRing = new THREE.Group()
			topRing.add(top)
			topRing.rotation.y = as + gap - Math.PI / 2
			topRing.position.y = H + 1.05
			scene.add(topRing)
		}
		{
			const vines = new THREE.Group()
			const vr = seeded(11)
			const drops = Math.round((2 * Math.PI * rIn) / 0.9)
			const vineMat = new THREE.MeshStandardMaterial({ map: leaves('fine'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 })
			for (let k = 0; k < drops; k++) {
				const a = (k / drops) * Math.PI * 2
				if (STAIRS.some((as) => Math.abs(adiff(a, as)) * rIn < 2)) continue
				if (vr() < 0.35) continue
				const len = 0.6 + vr() * (H * 0.55)
				const [x, z] = polar(rIn - 0.05, a)
				for (let j = 0; j < len / 0.35; j++) {
					const c = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), vineMat)
					c.position.set(x + (vr() - 0.5) * 0.3, H - 0.1 - j * 0.35, z + (vr() - 0.5) * 0.3)
					c.rotation.set(vr() * 3, vr() * 3, vr() * 3)
					vines.add(c)
				}
				// terracotta along the rail: lavender and rosemary, an olive or a lemon now and then
				if (k % 3) continue
				const [px, pz] = polar(rIn + 0.45, a)
				vines.add(balconyPot(k, px, H, pz))
			}
			railVines(vines, H, STAIRS)
			scene.add(await bakeIn(vines))
		}
		const pillars = Math.round((2 * Math.PI * rIn) / 6)
		for (let k = 0; k < pillars; k++) {
			const a = (k / pillars) * Math.PI * 2 + 0.05
			if ([...STAIRS, ...DOORS].some((d) => Math.abs(adiff(a, d)) * rIn < 2)) continue
			const [x, z] = polar(rIn + 0.4, a)
			const pl = box(0.7, H, 0.7, m.lime(0.5, H / 2), x, 0, z, a)
			scene.add(pl)
			colliders.push({ x, z, r: 0.55 })
		}

		await slice()
		/* the private rooms, facing out through the glass — one floor, or two */
		const roomH = 3
		const rFront = rIn + walkway
		const roomPlaster = new THREE.MeshStandardMaterial({ color: '#efe4d2', roughness: 0.96, side: THREE.DoubleSide })
		const roomsAt = async (Hf: number, turn: number) => {
			const rooms = g.rooms
			const topR = Math.sqrt(R * R - (Hf + roomH) ** 2)
			const group = new THREE.Group()
			for (let k = 0; k < rooms; k++) {
				const a1 = aStair + turn + ((k + 0.5) / rooms) * Math.PI * 2
				const span = (Math.PI * 2) / rooms
				// the partition: a plaster wall with a rounded end toward the walkway
				const [px, pz] = polar((rFront + topR) / 2, a1)
				group.add(box(0.24, roomH, topR - rFront, roomPlaster, px, Hf, pz, a1))
				const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, roomH, 16), roomPlaster)
				const [cx, cz] = polar(rFront, a1)
				cap.position.set(cx, Hf + roomH / 2, cz)
				group.add(cap)
				// the front, toward the walkway: plaster, with the door by the first wall
				const door = 1.4 / rFront
				const front = new THREE.Mesh(new THREE.CylinderGeometry(rFront, rFront, roomH, 32, 1, true, a1 + door, span - door), roomPlaster)
				front.position.y = Hf + roomH / 2
				group.add(front)
				const mid = a1 + span / 2
				// and inside it, the room itself (rooms.ts)
				const room = furnish({ a0: a1, span, rIn: rFront + 0.15, rOut: topR - 0.3, y: Hf, seed: Math.round(Hf * 10) + k * 17 })
				group.add(room.group)
				colliders.push(...room.colliders)
				await slice()
				const l = lantern(m, 0.3, Hf + 2.4)
				const [lx, lz] = polar((rFront + topR) / 2, mid)
				l.position.set(lx, 0, lz)
				group.add(l)
				// the room's lamp lights the room
				addLamp(lx, Hf + 2.1, lz, 8, 8, Hf)
			}
			scene.add(await bakeIn(group))
		}
		await slice()
		await roomsAt(H, 0)

		const H2 = H + roomH + 0.6
		const twoFloors = g.floors === 2
		const rMid2 = rIn + walkway / 2
		const run2 = (H2 - H) * 1.9
		const span2 = run2 / rMid2
		// each of the four stairs has a second flight, climbing round the walkway beside it
		const STAIRS2 = STAIRS.map((as) => as + (stairHalf * 2 + 1.2) / rMid2)
		await slice()
		if (twoFloors) {
			/* the second floor: an oak ring over the first floor's rooms, open where its stair comes up */
			const outerBand = new THREE.Mesh(new THREE.RingGeometry(rFront, R, 160), m.oak(R / 2))
			const innerBands = STAIRS2.map((a2) => new THREE.Mesh(new THREE.RingGeometry(rIn, rFront, 40, 1, a2 + span2 - Math.PI / 2, Math.PI / 2 - span2), m.oak(R / 2)))
			for (const band of [outerBand, ...innerBands]) {
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
			for (const a2 of STAIRS2)
				for (let i = 0; i < steps2; i++) {
					const a = a2 + ((i + 0.5) / steps2) * span2
					const [x, z] = polar(rMid2, a)
					stair2.add(box(run2 / steps2 + 0.03, 0.06, walkway - 0.3, m.oak(1), x, H + ((i + 1) / steps2) * (H2 - H) - 0.06, z, a))
				}
			scene.add(await bakeIn(stair2))
			await roomsAt(H2, Math.PI / g.rooms)
			// the second floor's rail gets the same pots and vines as the first
			const balcony2 = new THREE.Group()
			const pots2 = Math.round((2 * Math.PI * rIn) / 2.7)
			for (let k = 0; k < pots2; k++) {
				const [px, pz] = polar(rIn + 0.45, ((k + 0.5) / pots2) * Math.PI * 2)
				balcony2.add(balconyPot(k * 3 + 1, px, H2, pz))
			}
			railVines(balcony2, H2, [])
			scene.add(await bakeIn(balcony2))
		}

		await slice()
		/* the terraces outside the glass, one to each floor of rooms, carried on a two-storey stone arcade */
		const rWall2 = Math.sqrt(R * R - H2 * H2)
		const perQuarter = Math.max(3, Math.round(((Math.PI / 2) * Rt) / 5.2))
		const arcStep = Math.PI / 2 / perQuarter
		const pillarAngles = Array.from({ length: perQuarter * 4 }, (_, k) => (k + 0.5) * arcStep)
		const terraceRing = async (y: number, base: number, rInner: number, seed: number) => {
			const terrace = new THREE.Group()
			const deck = new THREE.Mesh(new THREE.RingGeometry(rInner, Rt, 160), m.stone(R / 1.5))
			deck.rotation.x = -Math.PI / 2
			deck.position.y = y + 0.02
			terrace.add(deck)
			const under = new THREE.Mesh(new THREE.RingGeometry(rInner, Rt, 160), m.lime(R / 2))
			under.rotation.x = Math.PI / 2
			under.position.y = y - 0.35
			terrace.add(under)
			const edge = new THREE.Mesh(new THREE.CylinderGeometry(Rt, Rt, 0.4, 160, 1, true), m.lime((Math.PI * Rt) / 2, 0.2))
			edge.position.y = y - 0.15
			terrace.add(edge)
			// pillars between the doors, and round arches from pillar to pillar
			const archR = (arcStep * Rt) / 2 - 0.4
			pillarAngles.forEach((a, k) => {
				const [x, z] = polar(Rt - 0.45, a)
				terrace.add(box(0.8, y - base - 0.3, 0.8, m.lime(0.6, (y - base) / 2), x, base, z, a))
				if (base === 0) outsideColliders.push({ x, z, r: 0.6 })
				const arch = new THREE.Mesh(new THREE.TorusGeometry(archR, 0.4, 8, 24, Math.PI), m.lime(2, 0.3))
				const [ax, az] = polar(Rt - 0.45, k * arcStep)
				arch.position.set(ax, y - 0.35 - archR, az)
				arch.rotation.y = k * arcStep
				terrace.add(arch)
			})
			// a timber balustrade, planters, tables
			const posts = Math.round((Math.PI * 2 * Rt) / 1.1)
			for (let k = 0; k < posts; k++) {
				const [x, z] = polar(Rt - 0.2, (k / posts) * Math.PI * 2)
				terrace.add(box(0.1, 0.95, 0.1, m.timberFrame, x, y, z))
			}
			const rail = new THREE.Mesh(new THREE.TorusGeometry(Rt - 0.2, 0.07, 6, 240), m.timberFrame)
			rail.rotation.x = -Math.PI / 2
			rail.position.y = y + 0.98
			terrace.add(rail)
			const rr = seeded(seed)
			const sets = Math.round((Math.PI * 2 * Rt) / 10)
			// clear of the pillars of the storey above
			const clear = (a: number) => pillarAngles.every((p) => Math.abs(adiff(a, p)) * Rt > 1.3)
			for (let k = 0; k < sets; k++) {
				const a = ((k + 0.5 + (seed % 2) * 0.5) / sets) * Math.PI * 2
				const [tx, tz] = polar((rInner + Rt) / 2 - 0.3, a)
				// a table under the vines, daybeds, a curved bench, hanging chairs: in turn round the ring
				const variant = (k + seed) % 4
				const set = terraceSet(variant, seed * 40 + k)
				set.position.set(tx, y, tz)
				set.rotation.y = a
				terrace.add(set)
				// a lamp hung over every set
				terrace.add(box(0.22, 0.22, 0.22, glowMat, tx, y + 2.2, tz))
				addLamp(tx, y + 2.1, tz, 6, 8)
				// the table has a pergola of grapevines over it, the Mediterranean way
				if (variant === 0) {
					const pg = grapePergola(seed * 50 + k, 3.2, 3, 2.45)
					pg.position.set(tx, y, tz)
					pg.rotation.y = a
					terrace.add(pg)
				}
				for (const off of [-1, 1]) {
					const pa = a + (off * 2.8) / Rt
					if (!clear(pa)) continue
					const [px, pz] = polar(Rt - 0.8, pa)
					const kind = rr() < 0.4 ? 'olive' : rr() < 0.5 ? 'lemon' : 'lavender'
					const pl = potted(kind, seed * 30 + k * 2 + (off > 0 ? 1 : 0), kind === 'lavender' ? 1.4 : 1)
					pl.position.set(px, y, pz)
					terrace.add(pl)
				}
			}
			scene.add(await bakeIn(terrace))
		}
		await slice()
		await terraceRing(H, 0, rWall - 0.4, 23)
		await slice()
		if (twoFloors) await terraceRing(H2, H, rWall2 - 0.4, 24)
		await pause('Making the beds')

		await slice()
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
				const tankFish = fishes([{ x, z, r: 0.55, y: 0.92, n: 5 }], [], 62 + i, eye, TANK_FISH)
				scene.add(tankFish.object)
				animated.push(tankFish.update)
				const surf = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), m.water(1))
				surf.rotation.x = -Math.PI / 2
				surf.position.set(x, 1.08, z)
				scene.add(surf)
				colliders.push({ x, z, r: 0.95 })
				const [tx, tz] = polar(kr - 1.3, a)
				// the tank's grow bed, straight in the soil beside it
				const trough = crop(CROPS[(i * 3) % CROPS.length]!, 70 + i, 2.2)
				trough.position.set(tx, 0.02, tz)
				trough.rotation.y = a + Math.PI / 2
				scene.add(trough)
				colliders.push({ x: tx, z: tz, r: 1.1 })
			}
		}

		await slice()
		/* in the master dome, the rest of the ring is the village's workshops */
		if (kind === 'master')
			for (const w of workshops(kit, (rIn + rWall) / 2 + 0.5)) {
				await slice()
				scene.add(await bakeIn(w.group))
				colliders.push(...w.colliders)
				// working lights over every workshop
				scene.add(box(1.2, 0.06, 0.4, glowMat, w.group.position.x, H - 0.52, w.group.position.z, w.group.rotation.y))
				addLamp(w.group.position.x, H - 0.7, w.group.position.z, 18, 14)
			}

		await slice()
		/* lamps for the night: pendants over the gallery walkway, lights in the ceiling of the
		   commons under it, and little lights along the ring path through the forest */
		{
			const count = kind === 'home' ? 6 : 8
			for (let k = 0; k < count; k++) {
				const a = ((k + 0.5) / count) * Math.PI * 2
				const [x, z] = polar(rIn + walkway / 2, a)
				const l = lantern(m, 0.22, H + 2.7)
				l.position.set(x, 0, z)
				scene.add(l)
				addLamp(x, H + 2.45, z, 10, 11, H)
			}
			for (let k = 0; k < 4; k++) {
				const a = DOORS[k]! + Math.PI / 4 + 0.35
				const [x, z] = polar((rIn + rWall) / 2, a)
				scene.add(box(0.6, 0.06, 0.6, glowMat, x, H - 0.52, z))
				addLamp(x, H - 0.7, z, 16, 14, 0)
			}
			pathLights(lush ? rIn + commonsW + 0.3 : Rp + 1.35, 6)
		}

		await slice()
		/* the four stairs from the commons up to the gallery, with a handrail on each side */
		for (const aStair of STAIRS) {
			const steps = Math.ceil(H / 0.18)
			const stair = new THREE.Group()
			for (let i = 0; i < steps; i++) {
				const rr = r0 + ((i + 0.5) / steps) * run
				const [x, z] = polar(rr, aStair)
				stair.add(box(stairHalf * 2, 0.06, run / steps + 0.02, m.oak(1), x, ((i + 1) / steps) * H - 0.06, z, aStair))
				// a small light in the stringer every few steps, to see the treads by at night
				if (i % 4 === 2)
					for (const sd of [-1, 1]) {
						const [ox, oz] = polar(stairHalf - 0.05, aStair + Math.PI / 2)
						stair.add(box(0.05, 0.05, 0.12, glowMat, x + ox * sd, ((i + 1) / steps) * H + 0.05, z + oz * sd, aStair))
					}
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
			// and a lamp over the middle of each flight
			const [mx, mz] = polar(r0 + run / 2, aStair)
			addLamp(mx, H / 2 + 2.3, mz, 7, 10)
		}

		const inStair = (x: number, z: number) => {
			const rr = Math.hypot(x, z)
			const a = Math.atan2(x, z)
			if (rr < r0 - 0.3 || rr > rIn + 0.4) return null
			return STAIRS.some((as) => Math.abs(adiff(a, as)) * rr < stairHalf) ? Math.max(0, Math.min(1, (rr - r0) / run)) * H : null
		}
		const inStair2 = (x: number, z: number) => {
			if (!twoFloors) return null
			const rr = Math.hypot(x, z)
			if (rr < rIn + 0.1 || rr > rFront - 0.1) return null
			for (const a2 of STAIRS2) {
				const o = adiff(Math.atan2(x, z), a2)
				if (o >= 0 && o <= span2) return H + (o / span2) * (H2 - H)
			}
			return null
		}
		floorAt = (x, z, feet) => {
			const rr = Math.hypot(x, z)
			const options = [bowlAt(rr)]
			const s = inStair(x, z)
			if (s !== null) options.push(s)
			const s2 = inStair2(x, z)
			if (s2 !== null) options.push(s2)
			if (rr >= rIn - 0.05 && rr < Rt) options.push(H)
			if (twoFloors && rr >= rIn - 0.05 && s2 === null) options.push(H2)
			return Math.max(...options.filter((h) => h <= feet + 0.55))
		}
		// out through the glass onto the terraces, at the first floor and the second
		terraceAt = (rr, y) => (Math.abs(y - H) < 0.3 || (twoFloors && Math.abs(y - H2) < 0.3)) && rr < Rt - 0.5
		blocked = (x, z, feet) => {
			const rr = Math.hypot(x, z)
			// on the galleries the railings keep you from stepping off, and on a stair its
			// handrails keep you on the treads: up off the ground, only a stair holds you
			if (feet > 0.25 && rr < rIn && inStair(x, z) === null) return true
			// and outside, the balustrade round the terrace
			if (feet > H - 0.6 && rr > Rt - 0.5) return true
			// the rooms' walls: their fronts on the walkway, open only at each room's door, and the walls between them
			for (const [Hf, turn] of twoFloors ? [[H, 0], [H2, Math.PI / g.rooms]] : [[H, 0]]) {
				if (Math.abs(feet - Hf!) > 0.5 || rr < rFront - 0.35 || rr > R) continue
				const span = (Math.PI * 2) / g.rooms
				const rel = (((Math.atan2(x, z) - (aStair + turn! + span / 2)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
				const along = (rel / span - Math.floor(rel / span)) * span
				if (Math.abs(rr - rFront) < 0.3 && along * rFront > 1.4) return true
				if (rr > rFront - 0.1 && Math.min(along, span - along) * rr < 0.3) return true
			}
			return false
		}
		start = { x: 0, z: Rc + 2, look: 0 }
	}

	if (forest) {
		// the stand-ins put straight into the scene (not baked) traded too; then every kind grown (in workers, side by
		// side), and each tree stands in the walker's way by its trunk
		swap(scene)
		await forest.grown()
		for (const t of floraTreesAll) t.c.r = Math.min(0.6, (forest.shape(t.kind)?.foot ?? 0.3) * t.s) + 0.2
		scene.add(forest.group)
	}

	// the lamps are all in place: set them for the hour
	setSun(hourNow())

	/* built into a host's world: hand back the dome's floors and lamps, and walk no further */
	if (host) {
		const wallLimit = (y: number) => Math.sqrt(Math.max(0, R * R - (y + 1.8) ** 2)) - (kind === 'glamp' ? 0.4 : 0.8)
		const doorHalf = kind === 'glamp' ? 0.6 : 1.1
		const stands = createObstacles([...colliders, ...outsideColliders] as { x: number; z: number; r: number; y?: number }[])
		const disposeAll = () => {
			host.scene.remove(scene)
			// the forest's plants are shared with the rest of the page: only its own instances go
			forest?.dispose()
			scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
		}
		const embedded: EmbeddedDome = {
			root: scene,
			floorAt: (x, z, feet) => floorAt(x, z, feet),
			blocked: (x, z, here) => blocked(x, z, here),
			inside: (x, z, y) => {
				const rr = Math.hypot(x, z)
				if (rr <= wallLimit(y) || terraceAt(rr, y)) return true
				if (y > 0.5) return false
				// outside the glass, under the terrace arcade: open ground, only its pillars stand in it
				if (rr > R + 0.4 && rr < Rt + 1.5) return true
				const a = Math.atan2(x, z)
				// through the doorway and out past the arcade, as wide as the terraces now are
				return doorsOf(kind).some((d) => Math.abs(adiff(a, d)) < 0.5 && Math.abs(adiff(a, d)) * rr < doorHalf) && rr < Rt + 1.5
			},
			hits: (x, z, y, from) => stands.blocks(x, z, { y, from }),
			spots,
			update: (t) => {
				for (const a of animated) a(t)
				keepDetail(camera.position.x - host.x, camera.position.z - host.z)
			},
			setHour: (hour) => setSun(hour),
			pickPlant: (o, d, far) => forest?.pick(o, d, far) ?? null,
			dispose: disposeAll
		}
		/* before it joins the village, ready everything the graphics card will need, a little at
		   a time: its shaders compiled in the background, its textures sent across one by one.
		   Otherwise the first frame that sees it does all of that at once, and the world freezes. */
		const log = (window as unknown as { __buildLog?: string[] }).__buildLog
		let tt = performance.now()
		scene.updateMatrixWorld(true)
		await renderer.compileAsync(scene, camera, host.scene)
		log?.push(`compile ${Math.round(performance.now() - tt)}ms`)
		tt = performance.now()
		const textures = new Set<THREE.Texture>()
		scene.traverse((o) => {
			const mt = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
			for (const mm of Array.isArray(mt) ? mt : mt ? [mt] : [])
				for (const v of Object.values(mm)) if (v instanceof THREE.Texture) textures.add(v)
		})
		for (const t of textures) {
			renderer.initTexture(t)
			await slice()
		}
		log?.push(`textures ${textures.size} ${Math.round(performance.now() - tt)}ms`)
		// then into the world a few pieces at a time, so their buffers go to the graphics card
		// over several frames instead of all in one
		const pieces: THREE.Object3D[] = []
		scene.traverse((o) => o !== scene && (o as THREE.Mesh).isMesh && o.visible && pieces.push(o))
		for (const p of pieces) p.visible = false
		const unculled: THREE.Object3D[] = []
		// once the graphics card has a piece, the page lets go of its own copy: a village keeps
		// several domes built, and their geometry would otherwise sit in memory twice. Measuring
		// the pieces is spread over frames too: done all at once it holds the world for half a second.
		for (const p of pieces) {
			const mesh = p as THREE.Mesh
			const geo = mesh.geometry
			if (!geo) continue
			geo.computeBoundingSphere()
			geo.computeBoundingBox()
			await slice()
			// drawn once even while out of view, so it reaches the graphics card now, not at the door
			if (mesh.frustumCulled) unculled.push(mesh)
			mesh.frustumCulled = false
			// only a dome's own baked geometry is let go of: a shape shared between plants (a leaf,
			// a fruit) is copied again by the next dome that bakes it, and must keep its data
			if (!geo.userData.baked) continue
			for (const attr of Object.values(geo.attributes)) (attr as THREE.BufferAttribute).onUpload(function (this: THREE.BufferAttribute) {
				;(this as unknown as { array: unknown }).array = new Float32Array(0)
			})
			geo.index?.onUpload(function (this: THREE.BufferAttribute) {
				;(this as unknown as { array: unknown }).array = new Uint32Array(0)
			})
		}
		host.scene.add(scene)
		// about a quarter of a million vertices a frame: small pieces come in dozens, a big merged forest alone
		let budget = 0
		for (const p of pieces) {
			p.visible = true
			budget += (p as THREE.Mesh).geometry?.attributes.position?.count ?? 0
			if (budget > 250_000) {
				budget = 0
				await new Promise((r) => requestAnimationFrame(() => r(null)))
			}
		}
		// every piece has now been drawn once, so the graphics card has it: out of view is out of mind again
		for (let k = 0; k < 2; k++) await new Promise((r) => requestAnimationFrame(() => r(null)))
		for (const p of unculled) p.frustumCulled = true
		;(window as unknown as { __buildLog?: string[] }).__buildLog?.push(`${kind} shown: ${pieces.length} pieces`)
		lastYield = performance.now()
		onProgress?.('ready')
		return { lift: () => null, liftStep: () => {}, move: () => {}, look: () => {}, embedded, dispose: disposeAll }
	}

	/* ── walking ($lib/sandbox-kit/walker) ─────────────────────────────── */
	// coming in from the village: just inside the door you walked through, facing in
	if (opts.entry !== undefined) {
		const [ex, ez] = polar(R - (kind === 'glamp' ? 2 : 3.5), opts.entry)
		start = { x: ex, z: ez, look: opts.entry }
	}
	let left = false

	// in the tent, only where there is headroom under the canvas
	const wallLimit = (y: number) => (kind === 'tent' ? 1.15 : Math.sqrt(Math.max(0, R * R - (y + 1.8) ** 2)) - (kind === 'glamp' ? 0.4 : 0.8))
	/** Where a walker may stand: inside the dome, through a door out on the land, or on the terrace. */
	const doorHalf = kind === 'tent' ? 0.45 : kind === 'glamp' ? 0.6 : 1.1
	const walkable = (x: number, z: number, y: number) => {
		const rr = Math.hypot(x, z)
		if (rr <= wallLimit(y)) return true
		if (terraceAt(rr, y)) return true
		if (y > 0.5) return false
		const a = Math.atan2(x, z)
		const inDoor = doorsOf(kind).some((d) => Math.abs(adiff(a, d)) < 0.5 && Math.abs(adiff(a, d)) * rr < doorHalf) && rr < R + 1.5
		return inDoor || (rr > R + 0.4 && rr < outerR)
	}

	// what stands in the way, filed in 8 m cells ($lib/sandbox-kit/obstacles)
	const stands = createObstacles([...colliders, ...outsideColliders] as { x: number; z: number; r: number; y?: number }[])
	const walker = createWalker(camera, renderer.domElement, {
		x: start.x,
		z: start.z,
		yaw: start.look,
		pitch: -0.05,
		floorAt,
		// in the dome or out on its land, clear of its walls, rails, furniture and trees, on the floor you would stand on
		canStand: (x, z, here, ground, from) => {
			const nf = floorAt(x, z, ground)
			return walkable(x, z, nf) && !blocked(x, z, here) && !stands.blocks(x, z, { y: nf, from })
		},
		// the factory's lift takes ↑ and ↓ while you stand in it
		onKey: onAction
	})
	const pos = walker.position
	/** after each step: out through a door and away from the wall, back to the village outside that door; and the
	 *  world follows where you are (the factory's floors) */
	const walked = () => {
		if (opts.onLeave && !left && walker.feet() < 0.5 && Math.hypot(pos.x, pos.z) > R + 4) {
			const a = Math.atan2(pos.x, pos.z)
			left = true
			opts.onLeave(doorsOf(kind).reduce((best, d) => (Math.abs(adiff(a, d)) < Math.abs(adiff(a, best)) ? d : best)))
		}
		onWalk(pos.x, pos.z, walker.feet())
	}

	let frame = 0
	let last = performance.now()
	const clock0 = performance.now()
	let lampsChecked = 0
	const sound = ambience()
	const tick = () => {
		const now = performance.now()
		// walk (or, while the film camera or the dev hook holds it, fly)
		walker.update(Math.min(0.1, (now - last) / 1000))
		if (!walker.flying()) walked()
		last = now
		const t = worldTime() ?? (now - clock0) / 1000
		for (const a of animated) a(t)
		// the floor's cover follows the eye every frame (it fades in and out as it goes)
		floorCover?.update(camera.position.x, camera.position.z)
		if (now - lampsChecked > 300) {
			lampsChecked = now
			lightNearest()
			keepDetail(camera.position.x, camera.position.z)
			// and the sounds, for where you stand: under the glass, everything outside is muffled
			const indoors = Math.hypot(pos.x, pos.z) < R - 0.3
			const heard: Parameters<typeof sound.set>[0] = levelsAt(pos.x, pos.z, indoors, waterPts, herds)
			// in the factory: the hall's own hum instead of the soft nature, the machines near you, the lift
			if (factorySounds && indoors) {
				const f = factorySounds(pos.x, pos.z, walker.feet())
				heard.inside = 0
				heard.forest = 0.08
				heard.factory = 1
				heard.machine = nearness(f.machine, 4, 22)
				heard.lift = nearness(f.lift, 3, 24)
			}
			sound.set(heard, indoors)
		}
		// the sun moves with the game clock: a game hour is two real minutes, so a look every second is plenty
		sky!.tick(now)
		// the film camera draws the canvas itself while it holds it
		if (!filmDraws()) renderer.render(scene, camera)
		// keep it smooth; while a film is shot every frame is rendered at the resolution it asks for
		stage!.adapt(now, filmHoldsSize())
		frame = requestAnimationFrame(tick)
	}
	walker.update(0)
	walked()
	if (!filmDraws()) renderer.render(scene, camera)
	onProgress?.('ready')
	tick()

	/* the film camera's hold on the dome (src/lib/film, $lib/sandbox-kit/film): Sandbox 3 on film, one dome a page */
	const world = connectFilm({
		sandbox: 'sandbox-3',
		area: kind,
		renderer,
		scene,
		camera,
		hold: walker,
		sky,
		place: (x, z, yw, p, y) => walker.place(x, z, yw, p, y),
		// stand where the shot is, and wait for every animal's skin, meshed off the page, to be there
		stage: async (w) => {
			walker.place(w.stand[0], w.stand[1], 0, 0)
			await actorsSettled()
		},
		animate: (t) => {
			for (const a of animated) a(t)
		},
		advance: () => {
			lightNearest()
			keepDetail(camera.position.x, camera.position.z)
			// what the hour gives the lamps, before the shot's own changes
			glowMat.emissive.set('#ffc070')
			for (const p of pool) p.color.set('#ffc98a')
		},
		lights: {
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
		}
	})
	/* a dev hook, like the planet's: move the camera from the console */
	;(window as unknown as { __interior: unknown }).__interior = {
		camera,
		scene,
		fly: walker.fly,
		land: walker.release,
		place: (x: number, z: number, y: number, yw: number, p: number) => walker.place(x, z, yw, p, y)
	}

	return {
		lift: () => {
			const f = liftFloor()
			return f < 0 ? null : { floor: f, name: FACTORY_NAMES[f]!, top: FACTORY_LEVELS.length - 1 }
		},
		liftStep: (dir) => {
			const k = dir > 0 ? 'arrowup' : 'arrowdown'
			onAction(k, true)
			setTimeout(() => onAction(k, false), 120)
		},
		move: walker.move,
		look: walker.look,
		dispose() {
			cancelAnimationFrame(frame)
			sound.dispose()
			world.disconnect()
			walker.dispose()
			sky!.dispose()
			stage!.dispose()
		}
	}
}
