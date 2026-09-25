// Copied from Sandbox 1 (src/lib/aven-city/game) for Sandbox 2's city islands; Sandbox 1 keeps its own.
/**
 * Scene shell: renderer, camera, lights, sea, world mounting and picking.
 *
 * Client-only — import dynamically from onMount. The sky color here must
 * match --color-sky in tokens.css so canvas and page blend seamlessly.
 */
import * as THREE from 'three'
import { AXIAL_DIRS, generateMap, type HexTile, key, MAP_SIZE } from '../../../../game/island/hexmap'
import { makeRng } from '../../../../game/island/rng'
import {
	VILLAGE_KINDS,
	buildWorld,
	canBuildOnTile,
	EMPTY_STATS,
	FACTORY_KINDS,
	type PlacedKind,
	type WorldApi,
	type WorldStats
} from './buildWorld'
import { createCameraRig } from './cameraRig'
import { createDaylight } from './daylight'

const SKY = '#cde9ec'
const HEX_HEIGHT = 0.5 // keep in sync with buildWorld
const WATER_LEVEL = 0.3 // sea surface laps against the island walls

/**
 * Super-simple faceted low-poly sea: a static displaced plane with flat
 * shading — zero shader cost, zero per-frame work, instant load. Vertices
 * displace by a position-hash (coincident verts move together) so the
 * surface stays watertight while the triangles catch the light.
 */
function buildSimpleSea(size: number): THREE.Mesh {
	const geo = new THREE.PlaneGeometry(size, size, 110, 110).toNonIndexed()
	geo.rotateX(-Math.PI / 2)
	const pos = geo.getAttribute('position')
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i)
		const z = pos.getZ(i)
		const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
		pos.setY(i, (h - Math.floor(h)) * 0.09)
	}
	geo.computeVertexNormals()
	const mesh = new THREE.Mesh(
		geo,
		new THREE.MeshStandardMaterial({
			color: '#5fa9bc',
			roughness: 0.65,
			metalness: 0,
			flatShading: true
		})
	)
	mesh.position.y = WATER_LEVEL - 0.09
	mesh.receiveShadow = true
	return mesh
}

export interface SceneApi {
	setWorld(seed: number): void
	/** Founds a settlement level or a works on a hex, replacing what stood. */
	placeBuilding(tile: HexTile, kind: PlacedKind): void
	removeBuilding(tile: HexTile): void
	buildingAt(tile: HexTile): PlacedKind | null
	/** Everyone housed across the island. */
	population(): number
	/** What has been built across the island, in people and hectares. */
	stats(): WorldStats
	/** Designates hexes for a use, and shows or hides the colour wash that
	 * makes the designation readable on the island. */
	/** Moves the sun to the given hour of the day (0..24). */
	setHour(hour: number): void
	/** Replaces everything standing with exactly these, by "q,r" — the server owns them. */
	setBuildings(buildings: Record<string, PlacedKind>): void
	/** Brings a hex to the middle of the view, keeping the camera's angle. */
	frame(cell: string): void
	dispose(): void
}

export interface SceneOptions {
	/** Fires with everything currently selected — empty when nothing is. */
	onSelect?(tiles: HexTile[]): void
	/** What stands on the island, by "q,r" — from the server; nothing is seeded or saved in the browser. */
	buildings?: Record<string, PlacedKind>
	/** The hex the opening shot frames, "q,r". */
	focus?: string
}

function disposeObject(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (obj instanceof THREE.Mesh) {
			obj.geometry.dispose()
			const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
			for (const m of mats) m.dispose()
		}
	})
}

/** Slim, semi-transparent ring around a selected hex — present, not loud. */
function makeSelectionRingGeometry(): THREE.BufferGeometry {
	const shape = new THREE.Shape()
	const hole = new THREE.Path()
	for (let i = 0; i < 6; i++) {
		const a = (Math.PI / 3) * i
		const target = i === 0 ? 'moveTo' : 'lineTo'
		shape[target](Math.cos(a) * 0.99, Math.sin(a) * 0.99)
		hole[target](Math.cos(a) * 0.93, Math.sin(a) * 0.93)
	}
	shape.closePath()
	hole.closePath()
	shape.holes.push(hole)
	const geo = new THREE.ExtrudeGeometry(shape, {
		depth: 0.012,
		bevelEnabled: true,
		bevelThickness: 0.008,
		bevelSize: 0.008,
		bevelSegments: 2
	})
	geo.rotateX(-Math.PI / 2)
	return geo
}

/**
 * The box you drag to select a span of hexes. It lives in the DOM rather
 * than the scene: a selection marquee belongs to the screen, not the world,
 * so it should not tilt with the camera.
 */
function makeMarquee(parent: HTMLElement): HTMLDivElement {
	const box = document.createElement('div')
	box.style.cssText = [
		'position:absolute',
		'pointer-events:none',
		'display:none',
		'border:1.5px solid rgba(255,253,246,0.95)',
		'background:rgba(255,253,246,0.16)',
		'border-radius:4px',
		'box-shadow:0 2px 10px rgba(58,74,80,0.25)',
		'z-index:5'
	].join(';')
	parent.appendChild(box)
	return box
}

export function createScene(canvas: HTMLCanvasElement, options: SceneOptions = {}): SceneApi {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
	// 1.25 is where the extra pixels stop showing and keep costing
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))
	if (import.meta.env.DEV) {
		// a dev-only handle for reading draw counts from the console
		;(globalThis as { __avencity?: unknown }).__avencity = {
			renderer,
			get scene() { return scene },
			get camera() { return camera },
			get rig() { return rig },
			get world() { return world }
		}
	}
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFShadowMap
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1.05

	const scene = new THREE.Scene()
	scene.background = new THREE.Color(SKY)
	scene.fog = new THREE.Fog(SKY, 130, 320)

	const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 900)
	// placeholder until the world exists — frameOpening() sets the real shot
	camera.position.set(7, 2.8, 15)

	const rig = createCameraRig(camera, canvas, {
		// close enough to stand among the domes of a single hex
		minDistance: 0.35,
		maxDistance: 200,
		// eye height stays above the board, so you can walk the island but
		// never end up under it looking at the sea from below
		floorY: HEX_HEIGHT + 0.12,
		moveSpeed: 30
	})
	const controls = rig.controls

	// the shadow box only has to cover the island; a tight box spends its
	// texels on the domes instead of the sea, so a smaller map looks the same
	const daylight = createDaylight(scene, {
		shadowExtent: 30,
		shadowFar: 200,
		shadowMapSize: 1024
	})

	// the sea — simple faceted low-poly, static
	// only as far as the fog lets you see
	const sea = buildSimpleSea(800)
	scene.add(sea)

	// selection rings: one instanced mesh, so selecting a hundred hexes costs
	// the same draw as selecting one
	const ringGeometry = makeSelectionRingGeometry()
	const ringMaterial = new THREE.MeshStandardMaterial({
		color: '#fffdf6',
		roughness: 0.6,
		metalness: 0,
		transparent: true,
		opacity: 0.75
	})
	let rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, 1024)
	rings.frustumCulled = false
	rings.count = 0
	scene.add(rings)

	/**
	 * Grows the ring mesh to hold a selection.
	 *
	 * An instanced mesh is allocated once at a fixed size, so a fixed size is a
	 * silent cap: a span across the whole island drew its first few hundred
	 * hexes and simply left the rest unmarked, while the count in the HUD said
	 * otherwise. It now doubles until it fits.
	 */
	function ensureRings(needed: number): void {
		if (needed <= rings.instanceMatrix.count) return
		let size = rings.instanceMatrix.count
		while (size < needed) size *= 2
		scene.remove(rings)
		rings.dispose()
		rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, size)
		rings.frustumCulled = false
		rings.count = 0
		scene.add(rings)
	}

	const marquee = makeMarquee(canvas.parentElement ?? document.body)
	let selection: HexTile[] = []

	function showSelection(): void {
		const m = new THREE.Matrix4()
		const offset = world?.group.position ?? new THREE.Vector3()
		ensureRings(selection.length)
		for (let i = 0; i < selection.length; i++) {
			const t = selection[i]
			m.makeTranslation(t.x + offset.x, HEX_HEIGHT + 0.01, t.z + offset.z)
			rings.setMatrixAt(i, m)
		}
		rings.count = selection.length
		rings.instanceMatrix.needsUpdate = true
		options.onSelect?.(selection)
	}

	let world: WorldApi | null = null

	// --- settlements survive a reload -----------------------------------
	// every dome is written to localStorage per island, so a city you
	// founded is still standing when you come back. Keyed by seed AND size:
	// a resized island has different hexes, and old saves must not land on it.
	interface Saved {
		buildings: Record<string, PlacedKind>
	}
	let saved: Saved = { buildings: {} }
	let saveKey = ''

	/* In Sandbox 2 the server owns what stands: nothing is seeded, nothing saved here. */
	const managed = options.buildings !== undefined

	function persist(): void {
		if (managed) return
		try {
			localStorage.setItem(saveKey, JSON.stringify(saved))
		} catch {
			// private mode or a full quota: the city just won't survive a reload
		}
	}

	/**
	 * A new island never opens empty: 100 domes stand on it already, placed
	 * from the seed so every visitor starts from the same one. Eighty dome
	 * cells at every level, and twenty works — four of each trade.
	 */
	function seedSettlements(seed: number, tiles: readonly HexTile[]): Record<string, PlacedKind> {
		const rng = makeRng((seed ^ 0x5eed5) >>> 0)
		const byKey = new Map(tiles.map((t) => [key(t.q, t.r), t]))
		const buildable = (q: number, r: number) => {
			const t = byKey.get(key(q, r))
			return t && canBuildOnTile(t) ? t : undefined
		}
		const open = tiles.filter(canBuildOnTile)
		// Fisher–Yates, so the random domes spread across the whole island
		for (let i = open.length - 1; i > 0; i--) {
			const j = rng.int(0, i)
			;[open[i], open[j]] = [open[j], open[i]]
		}
		const out: Record<string, PlacedKind> = {}

		// The hero: a level 5 dome cell with a neighbourhood around it — the
		// opening shot frames it, so the hexes behind it can't be empty. It is
		// written first, so the camera finds it first.
		const hero = open.find(
			(t) => AXIAL_DIRS.filter(([dq, dr]) => buildable(t.q + dq, t.r + dr)).length === 6
		)
		if (hero) {
			out[key(hero.q, hero.r)] = 'V12'
			const ring1: PlacedKind[] = ['V11', 'SOLAR', 'V9', 'HEMP', 'V6', 'LIFETRAC']
			for (const [i, [dq, dr]] of AXIAL_DIRS.entries()) {
				const t = buildable(hero.q + dq, hero.r + dr)
				if (t) out[key(t.q, t.r)] = ring1[i]
			}
			// the second ring, walked hex by hex: a mix of levels and factories,
			// with a few hexes left open so it reads as a neighbourhood, not a grid
			const ring2: Array<PlacedKind | null> = [
				'POWER_CUBE', 'V9', null, 'BAMBOO', 'V11', 'V5',
				null, 'V12', 'V6', 'SOLAR', null, 'V9'
			]
			let q = hero.q + AXIAL_DIRS[4][0] * 2
			let r = hero.r + AXIAL_DIRS[4][1] * 2
			let n = 0
			for (let side = 0; side < 6; side++) {
				for (let step = 0; step < 2; step++) {
					const kind = ring2[n++]
					const t = buildable(q, r)
					if (t && kind) out[key(t.q, t.r)] = kind
					q += AXIAL_DIRS[side][0]
					r += AXIAL_DIRS[side][1]
				}
			}
		}

		// then the rest of the island: dome cells at every level and five
		// factories of each trade, wherever the shuffle lands them
		const kinds: PlacedKind[] = [
			...Array.from({ length: 100 }, () => rng.pick(VILLAGE_KINDS)),
			...FACTORY_KINDS.flatMap((k) => [k, k, k, k, k])
		]
		let i = 0
		for (const tile of open) {
			if (i >= kinds.length) break
			const k = key(tile.q, tile.r)
			if (k in out) continue
			out[k] = kinds[i++]
		}
		return out
	}

	/** the hour last set, so the opening shot can face the sun */
	let hourNow = 12

	/**
	 * The opening shot: close on a level 5 dome cell, low, looking straight
	 * into the low sun — so it sits in the middle of the frame, far away,
	 * behind the domes. Runs once per world; after that the camera is yours.
	 */
	function frameOpening(tiles: readonly HexTile[]): void {
		if (!world) return
		const byKey = new Map(tiles.map((t) => [key(t.q, t.r), t]))
		const pick =
			(options.focus && byKey.has(options.focus) ? [options.focus] : undefined) ??
			Object.entries(saved.buildings).find(([, kind]) => kind === 'V12') ??
			Object.entries(saved.buildings).find(([, kind]) => kind === 'V11') ??
			Object.entries(saved.buildings).find(([, kind]) => kind === 'V10')
		const tile = pick ? byKey.get(pick[0]) : undefined
		const gx = world.group.position.x
		const gz = world.group.position.z
		const target = new THREE.Vector3(tile ? tile.x + gx : 0, 0.75, tile ? tile.z + gz : 0)
		// the same azimuth the daylight uses, so "toward the sun" is exact
		const az = ((hourNow - 5) / 15) * Math.PI * 0.9 + 0.35
		const toSun = new THREE.Vector3(Math.cos(az), 0, Math.sin(az))
		controls.target.copy(target)
		camera.position.copy(target).addScaledVector(toSun, -2.3)
		camera.position.y = 1.05
		controls.update()
	}

	function restore(seed: number, tiles: readonly HexTile[]): void {
		saveKey = `avencity.world.${seed}.${MAP_SIZE}.v6`
		saved = { buildings: {} }
		if (managed) {
			saved.buildings = { ...options.buildings }
			placeAll(tiles)
			return
		}
		let fresh = true
		try {
			const raw = localStorage.getItem(saveKey)
			if (raw) {
				saved = { buildings: JSON.parse(raw).buildings ?? {} }
				fresh = false
			}
		} catch {
			// storage unavailable: still seed the island, it just won't be kept
		}
		if (!world) return
		if (fresh) {
			saved.buildings = seedSettlements(seed, tiles)
			persist()
		}
		placeAll(tiles)
	}

	let tilesNow: readonly HexTile[] = []
	function placeAll(tiles: readonly HexTile[]): void {
		if (!world) return
		const byKey = new Map(tiles.map((t) => [key(t.q, t.r), t]))
		for (const [k, kind] of Object.entries(saved.buildings)) {
			const tile = byKey.get(k)
			if (!tile) continue
			try {
				world.placeBuilding(tile, kind)
			} catch {
				delete saved.buildings[k]
			}
		}
	}

	function setWorld(seed: number): void {
		if (world) {
			scene.remove(world.group)
			world.dispose()
		}
		const t0 = performance.now()
		const map = generateMap(seed)
		const t1 = performance.now()
		world = buildWorld(map)
		if (import.meta.env.DEV) {
			console.log(
				`[perf] map ${(t1 - t0) | 0} ms · build ${(performance.now() - t1) | 0} ms · ${map.tiles.length} tiles`
			)
		}
		// centre on the land itself, not the group's bounding box — the box can
		// hold more than the island, which left the opening view on open water
		let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
		for (const t of map.tiles) {
			if (t.kind !== 'LAND') continue
			minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x)
			minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z)
		}
		world.group.position.x = -(minX + maxX) / 2
		world.group.position.z = -(minZ + maxZ) / 2
		scene.add(world.group)
		tilesNow = map.tiles
		restore(seed, map.tiles)
		frameOpening(map.tiles)
		selection = []
		showSelection()
	}

	// --- picking: click selects, shift-click adds, shift-drag spans --------
	const raycaster = new THREE.Raycaster()
	const pointer = new THREE.Vector2()
	const projected = new THREE.Vector3()
	let downX = 0
	let downY = 0
	let boxing = false

	/** The hex under a screen point, via the ground it lands on. */
	function tileAtScreen(clientX: number, clientY: number): HexTile | null {
		if (!world) return null
		const rect = canvas.getBoundingClientRect()
		pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
		pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
		raycaster.setFromCamera(pointer, camera)
		for (const hit of raycaster.intersectObjects(world.group.children, true)) {
			const owner = hit.object.userData.tile as HexTile | undefined
			const tile = owner ?? world.tileAt(hit.point)
			if (tile) return tile
		}
		return null
	}

	function onPointerDown(e: PointerEvent): void {
		downX = e.clientX
		downY = e.clientY
		// shift takes the drag away from the camera and gives it to selection
		if (e.shiftKey && e.button === 0) {
			boxing = true
			controls.enabled = false
			marquee.style.display = 'block'
			updateMarquee(e.clientX, e.clientY)
			canvas.setPointerCapture?.(e.pointerId)
		}
	}

	function updateMarquee(x: number, y: number): void {
		const rect = canvas.getBoundingClientRect()
		const left = Math.min(downX, x) - rect.left
		const top = Math.min(downY, y) - rect.top
		marquee.style.left = `${left}px`
		marquee.style.top = `${top}px`
		marquee.style.width = `${Math.abs(x - downX)}px`
		marquee.style.height = `${Math.abs(y - downY)}px`
	}

	function onPointerMove(e: PointerEvent): void {
		if (boxing) updateMarquee(e.clientX, e.clientY)
	}

	/**
	 * Every land hex whose centre falls inside the dragged box.
	 *
	 * Projecting the tiles OUT to the screen beats casting rays back in: one
	 * pass over the map answers any box, at any size, without a ray per pixel.
	 */
	function tilesInBox(x0: number, y0: number, x1: number, y1: number): HexTile[] {
		if (!world) return []
		const rect = canvas.getBoundingClientRect()
		const left = Math.min(x0, x1) - rect.left
		const right = Math.max(x0, x1) - rect.left
		const top = Math.min(y0, y1) - rect.top
		const bottom = Math.max(y0, y1) - rect.top
		const offset = world.group.position
		const found: HexTile[] = []
		for (const tile of world.landTiles()) {
			projected.set(tile.x + offset.x, HEX_HEIGHT, tile.z + offset.z).project(camera)
			if (projected.z > 1) continue // behind the camera
			const sx = ((projected.x + 1) / 2) * rect.width
			const sy = ((1 - projected.y) / 2) * rect.height
			if (sx >= left && sx <= right && sy >= top && sy <= bottom) found.push(tile)
		}
		return found
	}

	function onPointerUp(e: PointerEvent): void {
		const moved = Math.hypot(e.clientX - downX, e.clientY - downY)

		if (boxing) {
			boxing = false
			controls.enabled = true
			marquee.style.display = 'none'
			canvas.releasePointerCapture?.(e.pointerId)
			const span = moved > 6 ? tilesInBox(downX, downY, e.clientX, e.clientY) : []
			if (span.length > 0) {
				// shift-drag ADDS to what is already held
				const held = new Set(selection.map((t) => `${t.q},${t.r}`))
				selection = [...selection, ...span.filter((t) => !held.has(`${t.q},${t.r}`))]
				showSelection()
				return
			}
		}

		if (moved > 6) return // a camera drag, not a click

		const tile = tileAtScreen(e.clientX, e.clientY)
		if (e.shiftKey) {
			// shift-click toggles one hex in or out of the span
			if (tile) {
				const k = `${tile.q},${tile.r}`
				const at = selection.findIndex((t) => `${t.q},${t.r}` === k)
				selection = at >= 0 ? selection.filter((_, i) => i !== at) : [...selection, tile]
			}
		} else if (!tile) {
			selection = []
		} else {
			// Tapping the hex that is already the whole selection lets go of it, so
			// the tap that picked a hex also drops it. Without this the only way to
			// clear was to find open water — on a fully settled island there is none.
			// A tap on ONE hex of a span still collapses the span onto it; that is a
			// narrowing, not an undo.
			const isOnlySelection =
				selection.length === 1 && `${selection[0].q},${selection[0].r}` === `${tile.q},${tile.r}`
			selection = isOnlySelection ? [] : [tile]
		}
		showSelection()
	}

	/** Escape clears the selection — the same way it dismisses anything else. */
	function onKeyDown(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || selection.length === 0) return
		selection = []
		showSelection()
	}

	canvas.addEventListener('pointerdown', onPointerDown)
	canvas.addEventListener('pointermove', onPointerMove)
	canvas.addEventListener('pointerup', onPointerUp)
	// on window, not the canvas: the canvas never holds focus, so a keydown on it
	// would only ever arrive if the user had clicked it AND nothing else took focus
	window.addEventListener('keydown', onKeyDown)

	function resize(): void {
		const w = canvas.clientWidth
		const h = canvas.clientHeight
		if (
			canvas.width !== w * renderer.getPixelRatio() ||
			canvas.height !== h * renderer.getPixelRatio()
		) {
			renderer.setSize(w, h, false)
			camera.aspect = w / h
			camera.updateProjectionMatrix()
		}
	}
	// dev diagnostics handle (harmless in prod; enables live inspection)
	;(window as unknown as Record<string, unknown>).__scene = {
		renderer,
		scene,
		camera,
		controls,
		sea,
		daylight,
		world: () => world
	}

	const clock = new THREE.Clock()
	let raf = 0
	function animate(): void {
		raf = requestAnimationFrame(animate)
		resize()
		rig.update(clock.getDelta())
		// detail follows the eye: blocks of the island rise and fall between
		// full build, distant stand-in and bare ground as you travel
		world?.updateLod(camera.position)
		renderer.render(scene, camera)
	}
	animate()

	return {
		setWorld,
		placeBuilding(tile, kind) {
			world?.placeBuilding(tile, kind)
			saved.buildings[key(tile.q, tile.r)] = kind
			persist()
		},
		removeBuilding(tile) {
			world?.removeBuilding(tile)
			delete saved.buildings[key(tile.q, tile.r)]
			persist()
		},
		buildingAt(tile) {
			return world?.buildingAt(tile) ?? null
		},
		population() {
			return world?.population() ?? 0
		},
		stats() {
			return world?.stats() ?? EMPTY_STATS
		},
		setHour(hour) {
			hourNow = hour
			daylight.setHour(hour)
		},
		setBuildings(buildings) {
			if (!world) return
			const byKey = new Map(tilesNow.map((t) => [key(t.q, t.r), t]))
			for (const [k, kind] of Object.entries(saved.buildings)) {
				const tile = byKey.get(k)
				if (tile && buildings[k] !== kind) world.removeBuilding(tile)
			}
			for (const [k, kind] of Object.entries(buildings)) {
				const tile = byKey.get(k)
				if (tile && saved.buildings[k] !== kind) world.placeBuilding(tile, kind)
			}
			saved.buildings = { ...buildings }
		},
		frame(cell) {
			const tile = tilesNow.find((t) => key(t.q, t.r) === cell)
			if (!tile || !world) return
			const target = new THREE.Vector3(tile.x + world.group.position.x, 0.75, tile.z + world.group.position.z)
			const offset = camera.position.clone().sub(controls.target)
			controls.target.copy(target)
			camera.position.copy(target).add(offset)
			controls.update()
		},
		dispose(): void {
			cancelAnimationFrame(raf)
			canvas.removeEventListener('pointerdown', onPointerDown)
			canvas.removeEventListener('pointermove', onPointerMove)
			canvas.removeEventListener('pointerup', onPointerUp)
			window.removeEventListener('keydown', onKeyDown)
			marquee.remove()
			rig.dispose()
			daylight.dispose()
			if (world) world.dispose()
			disposeObject(scene)
			renderer.dispose()
		}
	}
}
