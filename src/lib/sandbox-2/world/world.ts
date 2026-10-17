/**
 * THE WORLD — a globe of hex cards, full screen, behind the HUD.
 *
 * The geometry comes from `globe.ts`: a Goldberg polyhedron whose every
 * cell is a card — a prism with a top face on the sphere and sides dropping
 * toward the centre. Sea sits a step below the land, shallows and coasts
 * ring every coast, and the interior is sand, grass or forest by moisture.
 * Forest cards grow trees. The look is `biomes.ts`, after Soundfall.
 *
 * The seams: cards touch, and a dark core sphere sits just under the tops,
 * so nothing shows through between them from any angle.
 */
import * as THREE from 'three'
import { connectFilm, createCameraHold, filmDraws } from '$lib/sandbox-kit/film.js'
import { createSky } from '$lib/sandbox-kit/sky.js'
import { createAirShell } from '$lib/sandbox-kit/universe.js'
import { disposeRenderer } from '$lib/render/core.js'
import { worldRenderer } from '$lib/render/world.js'
import { CameraRig } from './camera'
import { BIOMES, TREE } from './biomes'
import { buildGlobe, FREQUENCY, LAND, type Tile, type Vec3 } from '../../../../game/globe'
import type { BiomeMap, DepthMap, LandMask } from '../../../../game/map'

export type WorldOptions = { /** The map: where the land is. Without it, the noise invents continents. */ isLand?: LandMask; /** The map: what kind of land is where. */ kindOf?: BiomeMap; /** The map: where the mountain ranges are. */ isMountain?: LandMask; /** The map: how deep the sea is. */ depthOf?: DepthMap }
export type WorldHandle = { /** Walk from a touch joystick: x to the right, y ahead, each -1…1. */ move: (x: number, y: number, hurry: boolean) => void; dispose: () => void }

const RADIUS = 120 // the globe — twice the old one, the cards the same size
const DEPTH = 1.8 // how far a card's sides drop

function hash(x: number, y: number): number {
	const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
	return s - Math.floor(s)
}

/* The sea floor falls away with depth: the deepest cards sit a step lower than the shelf. */
const cardTop = (t: Tile) => RADIUS + BIOMES[t.biome].lift - (t.biome === 'sea' ? t.value * 0.25 : 0)

/** Every card as triangles with flat colour — one draw call for the land and sea. */
function globeGeometry(tiles: Tile[]): { geometry: THREE.BufferGeometry; faceToTile: Uint16Array } {
	const positions: number[] = []
	const colors: number[] = []
	const faceTiles: number[] = []
	const c = new THREE.Color()
	const push = (p: Vec3, r: number, col: THREE.Color) => {
		positions.push(p[0] * r, p[1] * r, p[2] * r)
		colors.push(col.r, col.g, col.b)
	}
	tiles.forEach((t, i) => {
		const paint = BIOMES[t.biome]
		if (t.biome === 'sea') {
			/* Darker the deeper: a continuous ramp through the three shades. */
			const d = Math.min(1, t.value) * 2
			c.set(paint.shades[d < 1 ? 0 : 1]).lerp(new THREE.Color(paint.shades[d < 1 ? 1 : 2]), d < 1 ? d : d - 1)
		} else {
			const band = t.value < 0.3 ? 0 : t.value < 0.65 ? 1 : 2
			c.set(paint.shades[band])
		}
		c.offsetHSL(0, 0, (hash(i, t.corners.length) - 0.5) * 0.03)
		const side = c.clone().multiplyScalar(0.8)
		const top = cardTop(t)
		const bottom = top - DEPTH
		const n = t.corners.length
		for (let k = 0; k < n; k++) {
			const a = t.corners[k]!, b = t.corners[(k + 1) % n]!
			/* Three triangles per corner: the fan and the two of the side. */
			faceTiles.push(i, i, i)
			/* The top face, as a fan from the centre (corners run anticlockwise
			   seen from outside, so this faces out). */
			push(t.centre, top, c); push(a, top, c); push(b, top, c)
			/* The side, as a quad of two triangles, facing out likewise. */
			push(a, bottom, side); push(b, bottom, side); push(b, top, side)
			push(a, bottom, side); push(b, top, side); push(a, top, side)
		}
	})
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
	geometry.computeVertexNormals()
	return { geometry, faceToTile: Uint16Array.from(faceTiles) }
}

/**
 * The trees: one instanced trunk, one instanced canopy, one instanced fruit,
 * placed on land cards by their biome's rate, standing along the card's normal.
 */
function forests(tiles: Tile[]): THREE.Object3D {
	type Spot = { p: THREE.Vector3; up: THREE.Vector3; size: number; shade: number; fruit: boolean }
	const spots: Spot[] = []
	tiles.forEach((t, i) => {
		const rate = BIOMES[t.biome].trees
		if (!rate) return
		/* Poisson-ish: the rate is the mean, the hash decides. */
		const count = Math.floor(rate) + (hash(i, 3) < rate - Math.floor(rate) ? 1 : 0)
		const up = new THREE.Vector3(...t.centre)
		const ref = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
		const ex = new THREE.Vector3().crossVectors(up, ref).normalize()
		const ez = new THREE.Vector3().crossVectors(up, ex).normalize()
		for (let k = 0; k < count; k++) {
			/* Inside the card: a radius of 0.55 of a card's reach keeps a tree off the edge. */
			const ang = hash(i, 10 + k) * Math.PI * 2
			const rad = Math.sqrt(hash(i, 20 + k)) * 0.55
			const p = up.clone().multiplyScalar(cardTop(t)).addScaledVector(ex, Math.cos(ang) * rad).addScaledVector(ez, Math.sin(ang) * rad)
			spots.push({ p, up, size: 0.75 + hash(i, 30 + k) * 0.5, shade: Math.floor(hash(i, 40 + k) * 3), fruit: hash(i, 50 + k) < TREE.fruited })
		}
	})

	const group = new THREE.Group()
	const trunkGeo = new THREE.CylinderGeometry(0.07, 0.1, TREE.trunkHeight, 5)
	trunkGeo.translate(0, TREE.trunkHeight / 2, 0)
	const canopyGeo = new THREE.IcosahedronGeometry(TREE.canopyRadius, 1)
	canopyGeo.translate(0, TREE.trunkHeight + TREE.canopyRadius * 0.7, 0)
	const fruitGeo = new THREE.IcosahedronGeometry(0.09, 0)
	fruitGeo.translate(TREE.canopyRadius * 0.6, TREE.trunkHeight + TREE.canopyRadius * 0.9, TREE.canopyRadius * 0.5)

	const flat = (color: string | number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
		new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...extra })
	const trunks = new THREE.InstancedMesh(trunkGeo, flat(TREE.trunk), spots.length)
	const canopies = new THREE.InstancedMesh(canopyGeo, flat(0xffffff, { vertexColors: false }), spots.length)
	const fruits = new THREE.InstancedMesh(fruitGeo, flat(TREE.fruit), spots.filter((s) => s.fruit).length)

	const m = new THREE.Matrix4()
	const q = new THREE.Quaternion()
	const Y = new THREE.Vector3(0, 1, 0)
	const scale = new THREE.Vector3()
	const col = new THREE.Color()
	let f = 0
	spots.forEach((s, i) => {
		q.setFromUnitVectors(Y, s.up)
		scale.setScalar(s.size)
		m.compose(s.p, q, scale)
		trunks.setMatrixAt(i, m)
		canopies.setMatrixAt(i, m)
		canopies.setColorAt(i, col.set(TREE.canopy[s.shade]!))
		if (s.fruit) fruits.setMatrixAt(f++, m)
	})
	for (const mesh of [trunks, canopies, fruits]) {
		mesh.instanceMatrix.needsUpdate = true
		group.add(mesh)
	}
	if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true
	return group
}

export function mountWorld(container: HTMLElement, options: WorldOptions = {}): WorldHandle {

	// the world renderer ($lib/render/world.js), with the same lens as every world ($lib/sandbox-kit/sky): the
	// universe's light and the planet's in one picture; no shadows on a planet seen from space
	const renderer = worldRenderer({ maxPixelRatio: 2, shadows: false, colorSpace: THREE.SRGBColorSpace })
	renderer.setSize(container.clientWidth, container.clientHeight)
	container.appendChild(renderer.domElement)

	const scene = new THREE.Scene()

	const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.5, 1000)
	/* Open on the whole globe, a little above the equator; the walker's ground is the tallest card. */
	const SURFACE = RADIUS + Math.max(...Object.values(BIOMES).map((b) => b.lift))
	const reticle = document.createElement('div')
	reticle.className = 'hud-reticle'
	reticle.hidden = true
	container.appendChild(reticle)
	const rig = new CameraRig(camera, renderer.domElement, { surface: SURFACE, eye: 0.9, ceiling: RADIUS * 5, start: new THREE.Vector3(-0.6, 1.1, 3.2), altitude: RADIUS * 2.4, reticle })

	const tiles = buildGlobe({ frequency: FREQUENCY, land: LAND, isLand: options.isLand, kindOf: options.kindOf, isMountain: options.isMountain, depthOf: options.depthOf })
	const { geometry } = globeGeometry(tiles)
	const globe = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }))
	scene.add(globe)

	/* The core: a dark sphere just under the lowest tops, so a seam between
	   two cards shows the deep instead of the sky. */
	const core = new THREE.Mesh(new THREE.SphereGeometry(RADIUS - 0.9, 48, 32), new THREE.MeshStandardMaterial({ color: new THREE.Color(BIOMES.sea.shades[2]).multiplyScalar(0.6), roughness: 1 }))
	scene.add(core)

	scene.add(forests(tiles))

	/* The planet in the universe ($lib/sandbox-kit/sky, seen from space): a dark blue universe and its stars, the sun
	   a star, its light from where it really stands at the hour — day on one side of the planet, night on the other,
	   the hour of every world (the time control, Auto or by hand). The closer you come, the deeper you are in its air:
	   the sky turns blue and light round you, as it is on the islands and in the domes, the same sky zoomed in. */
	const sky = createSky(renderer, scene, { view: 'planet' })
	const air = createAirShell(SURFACE)
	scene.add(air.mesh)
	const toUp = new THREE.Vector3()
	/** how deep in the air the camera is: 0 out in space, 1 walking on the planet */
	const airAt = (height: number) => 1 - THREE.MathUtils.smoothstep(Math.log(Math.max(0.1, height)), Math.log(1.5), Math.log(70))
	const placeSky = () => {
		toUp.copy(camera.position).normalize()
		const r = camera.position.length()
		const depth = airAt(r - SURFACE)
		// from up here the horizon is the planet's limb, below level by as much as you are high
		sky.view(toUp, depth, Math.sqrt(Math.max(0, 1 - (SURFACE / r) ** 2)))
		// the rim of air seen from outside; gone as you come down into it (the sky round you takes over)
		air.set(toUp.copy(sky.sun.position).normalize(), (1 - depth) ** 3)
	}

	/* The film camera's hold on the planet (src/lib/film, $lib/sandbox-kit/film): it flies the camera free of the rig,
	   and may scale and colour the sun and the fill. It is also the dev hook: the camera and the globe from the console. */
	const hold = createCameraHold(camera)
	const film = connectFilm({
		sandbox: 'sandbox-2',
		area: 'planet',
		renderer,
		scene,
		camera,
		hold,
		sky,
		// the universe for where the camera is (the film pins the hour; the sky sets the sun and the fill)
		advance: () => placeSky(),
		extra: { rig, globe, tiles }
	})

	let frame = 0
	let last = performance.now()
	const tick = () => {
		const now = performance.now()
		// the rig, or where the film camera holds the camera
		if (!hold.apply()) rig.update(Math.min(0.1, (now - last) / 1000))
		last = now
		sky.tick(now)
		placeSky()
		if (!filmDraws()) renderer.render(scene, camera)
		frame = requestAnimationFrame(tick)
	}
	tick()

	const onResize = () => {
		const w = container.clientWidth
		const h = container.clientHeight
		camera.aspect = w / h
		camera.updateProjectionMatrix()
		renderer.setSize(w, h)
	}
	window.addEventListener('resize', onResize)

	return {
		move: (x, y, hurry) => rig.move(x, y, hurry),
		dispose: () => {
			cancelAnimationFrame(frame)
			window.removeEventListener('resize', onResize)
			film.disconnect()
			sky.dispose()
			air.dispose()
			scene.remove(air.mesh)
			rig.dispose()
			reticle.remove()
			geometry.dispose()
			disposeRenderer(renderer)
		}
	}
}
