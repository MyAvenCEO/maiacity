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
import { CameraRig } from './camera'
import { BIOMES, TREE } from './biomes'
import { buildGlobe, FREQUENCY, LAND, WATER, type Tile, type Vec3 } from '../../../../game/globe'
import type { BiomeMap, DepthMap, LandMask } from '../../../../game/map'

/** A coop as the world places it. */
/** A city on its card, and the coops standing inside it. */
export type CityMarker = { slug: string; tile: number; citizens: number; milestone: number; coops: { slug: string; slot: number; milestone: number }[] }
export type TilePick = { tile: number; biome: 'land' | 'water'; coop: string | null }
export type WorldOptions = { cities: CityMarker[]; onTile?: (pick: TilePick) => void; /** The map: where the land is. Without it, the noise invents continents. */ isLand?: LandMask; /** The map: what kind of land is where. */ kindOf?: BiomeMap; /** The map: where the mountain ranges are. */ isMountain?: LandMask; /** The map: how deep the sea is. */ depthOf?: DepthMap }
export type WorldHandle = { setCities: (cities: CityMarker[]) => void; /** Hold the camera and give the mouse back, while a sheet is open. */ setFrozen: (on: boolean) => void; /** Mark a card as chosen (-1 clears it). */ setChosen: (tile: number) => void; /** Fly the camera to a card and mark it; `at` is where on the screen it should land (-1..1, 0 is the middle); `zoom` how close. */ focus: (tile: number, at?: { x: number; y: number }, zoom?: number) => void; /** Stop drawing while another view has the screen. */ setPaused: (on: boolean) => void; dispose: () => void }

/** Resolve a token that may be `var(--x)` to a colour three.js can parse. */
function colour(name: string, fallback: string): THREE.Color {
	const probe = document.createElement('span')
	probe.style.color = `var(${name}, ${fallback})`
	document.body.appendChild(probe)
	const rgb = getComputedStyle(probe).color
	probe.remove()
	return new THREE.Color(rgb || fallback)
}

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

export function mountWorld(container: HTMLElement, options: WorldOptions = { cities: [] }): WorldHandle {
	const sky = colour('--color-surface-page', '#f2efe7')

	const renderer = new THREE.WebGLRenderer({ antialias: true })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
	renderer.setSize(container.clientWidth, container.clientHeight)
	renderer.outputColorSpace = THREE.SRGBColorSpace
	container.appendChild(renderer.domElement)

	const scene = new THREE.Scene()
	scene.background = sky

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

	/* ── cities: from afar a tower, close up a cluster of domes ─────────────
	   Seen from high up, every city is one hex tower whose height counts its
	   citizens: a band per step, alternating light and dark. Come down low
	   enough and the tower gives way to what stands inside the card: the city
	   itself as the centre dome, and every coop as a smaller dome on its slot
	   around it, growing with its milestone. A card is about two units across. */
	const cityGroups = new THREE.Group()
	scene.add(cityGroups)
	const storeyGeo = new THREE.CylinderGeometry(1, 1, 1, 6)
	storeyGeo.rotateY(Math.PI / 6)
	storeyGeo.translate(0, 0.5, 0)
	const domeGeo = new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2)
	const STOREY = 0.16
	/** Below this zoom the towers give way to the domes. */
	const DOMES_BELOW = 0.55
	/** Where a coop stands inside its city's card: six around the centre, twelve further out. */
	const SLOTS: [number, number][] = [
		...Array.from({ length: 6 }, (_, i) => [0.44, ((i * 60 + 30) * Math.PI) / 180] as [number, number]),
		...Array.from({ length: 12 }, (_, i) => [0.74, ((i * 30) * Math.PI) / 180] as [number, number])
	].map(([r, a]) => [Math.cos(a) * r, Math.sin(a) * r])
	const hue = (slug: string) => {
		let h = 0
		for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) % 360
		return h
	}
	/* Warm, bright bands, so a city never melts into the forest or the grass around it. */
	const material = (slug: string, step: number, light = 0.62) =>
		new THREE.MeshStandardMaterial({
			color: new THREE.Color().setHSL(((20 + (hue(slug) % 40) + step * 3) % 360) / 360, 0.72, step % 2 ? light - 0.1 : light + 0.12),
			roughness: 0.55,
			metalness: 0.05,
			flatShading: true
		})
	/** Storeys for a head count: quick at first, slower as the city grows — 1 citizen is 3, 7 are 9, 1,000 are 30. */
	const storeysFor = (citizens: number) => Math.max(1, Math.ceil(Math.log2(citizens + 1) * 3))
	const clear = (group: THREE.Group) => {
		for (const child of [...group.children]) {
			group.remove(child)
			;((child as THREE.Mesh).material as THREE.Material).dispose()
		}
	}
	const buildCity = (group: THREE.Group, c: CityMarker) => {
		const tower = group.userData.tower as THREE.Group
		const domes = group.userData.domes as THREE.Group
		clear(tower)
		clear(domes)
		const storeys = storeysFor(c.citizens)
		for (let level = 1; level <= storeys; level++) {
			const storey = new THREE.Mesh(storeyGeo, material(c.slug, level))
			storey.userData.slug = c.slug
			const radius = Math.min(0.75, 0.42 + level * 0.006)
			storey.position.y = (level - 1) * STOREY
			storey.scale.set(radius, STOREY, radius)
			tower.add(storey)
		}
		const centre = new THREE.Mesh(domeGeo, material(c.slug, 0, 0.6))
		centre.userData.slug = c.slug
		const r = Math.min(0.42, 0.3 + c.milestone * 0.004)
		centre.scale.set(r, r * 0.9, r)
		domes.add(centre)
		for (const coop of c.coops) {
			const at = SLOTS[coop.slot]
			if (!at) continue
			const dome = new THREE.Mesh(domeGeo, material(coop.slug, 1, 0.55))
			dome.userData.slug = coop.slug
			const d = Math.min(0.22, 0.12 + coop.milestone * 0.005)
			dome.scale.set(d, d * 0.9, d)
			dome.position.set(at[0], 0, at[1])
			domes.add(dome)
		}
		group.userData.signature = JSON.stringify([c.citizens, c.milestone, c.coops])
	}
	const groupByCity = new Map<string, THREE.Group>()
	const setCityMarkers = (cities: CityMarker[]) => {
		const seen = new Set<string>()
		for (const c of cities) {
			seen.add(c.slug)
			const t = tiles[c.tile]
			if (!t) continue
			let group = groupByCity.get(c.slug)
			if (!group) {
				group = new THREE.Group()
				const tower = new THREE.Group()
				const domes = new THREE.Group()
				group.add(tower, domes)
				group.userData = { slug: c.slug, tower, domes }
				cityGroups.add(group)
				groupByCity.set(c.slug, group)
				const up = new THREE.Vector3(...t.centre)
				group.position.copy(up).multiplyScalar(cardTop(t))
				group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
			}
			if (group.userData.signature !== JSON.stringify([c.citizens, c.milestone, c.coops])) buildCity(group, c)
		}
		for (const [slug, group] of groupByCity) if (!seen.has(slug)) {
			clear(group.userData.tower)
			clear(group.userData.domes)
			cityGroups.remove(group)
			groupByCity.delete(slug)
		}
	}
	/** Tower or domes, by how close the camera is. From high up the tower grows
	    with the altitude, so a city stays readable from orbit. */
	const showDetail = () => {
		const near = rig.zoom < DOMES_BELOW
		const grow = Math.min(9, Math.max(1, rig.altitude / 14))
		for (const group of groupByCity.values()) {
			const tower = group.userData.tower as THREE.Group
			tower.visible = !near
			tower.scale.set(grow * 0.55, grow, grow * 0.55)
			;(group.userData.domes as THREE.Group).visible = near
		}
	}
	setCityMarkers(options.cities)

	/* ── picking: a click (not a drag) on a card ─────────────────────────── */
	/* ── finding the card under a point ──────────────────────────────────
	   The globe is 933k triangles; a ray through them all is too slow for
	   every frame. The cards are the cells around their centres, so the card
	   under a point on the sphere is the nearest centre — found through a
	   grid of latitude and longitude buckets, two degrees a side. */
	const BUCKET = 2
	const buckets = new Map<number, number[]>()
	const latLon = (p: Vec3 | THREE.Vector3) => {
		const [x, y, z] = p instanceof THREE.Vector3 ? [p.x, p.y, p.z] : p
		return [(Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI, (Math.atan2(x, z) * 180) / Math.PI] as const
	}
	const bucketKey = (latB: number, lonB: number) => latB * 1000 + ((lonB % (360 / BUCKET)) + 360 / BUCKET) % (360 / BUCKET)
	tiles.forEach((t, i) => {
		const [lat, lon] = latLon(t.centre)
		const k = bucketKey(Math.floor((lat + 90) / BUCKET), Math.floor((lon + 180) / BUCKET))
		const list = buckets.get(k)
		if (list) list.push(i)
		else buckets.set(k, [i])
	})
	const tileAt = (p: THREE.Vector3): number => {
		const [lat, lon] = latLon(p)
		const latB = Math.floor((lat + 90) / BUCKET), lonB = Math.floor((lon + 180) / BUCKET)
		/* Near the poles the longitude buckets pinch together: search the whole ring. */
		const span = Math.abs(lat) > 80 ? 360 / BUCKET / 2 : 1
		let best = -1, bestDot = -2
		for (let dl = -1; dl <= 1; dl++)
			for (let dn = -span; dn <= span; dn++) {
				const list = buckets.get(bucketKey(latB + dl, lonB + dn))
				if (!list) continue
				for (const i of list) {
					const c = tiles[i]!.centre
					const d = p.x * c[0] + p.y * c[1] + p.z * c[2]
					if (d > bestDot) { bestDot = d; best = i }
				}
			}
		return best
	}
	const raycaster = new THREE.Raycaster()
	const pointer = new THREE.Vector2()
	const sphere = new THREE.Sphere(new THREE.Vector3(), RADIUS)
	const hitPoint = new THREE.Vector3()
	/** The card under a point of the view, in normalised device coordinates. */
	const pick = (ndc: THREE.Vector2): { tile: number; coop: string | null } | null => {
		raycaster.setFromCamera(ndc, camera)
		/* Only what is drawn can be hit: the tower from afar, the domes up close. */
		const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent))
		const hit = raycaster.intersectObjects(cityGroups.children, true).find((h) => shown(h.object))
		if (hit) {
			const slug = (hit.object as THREE.Mesh).userData.slug as string
			const c = currentCities.find((x) => x.slug === slug || x.coops.some((k) => k.slug === slug))
			if (c) return { tile: c.tile, coop: slug }
		}
		if (!raycaster.ray.intersectSphere(sphere, hitPoint)) return null
		let tile = tileAt(hitPoint.normalize())
		if (tile < 0) return null
		/* Cards stand above the sphere; seen from low and at a slant, the ray meets
		   the card's top before the sphere. Once more, at that card's height. */
		sphere.radius = cardTop(tiles[tile]!)
		if (raycaster.ray.intersectSphere(sphere, hitPoint)) tile = tileAt(hitPoint.normalize())
		sphere.radius = RADIUS
		if (tile < 0) return null
		return { tile, coop: currentCities.find((c) => c.tile === tile)?.slug ?? null }
	}

	/* ── the rings: a light band around the card under the pointer, a warm
	   one around the card that is chosen — it stays while its sheet is open ── */
	const ring = (color: number, width: number, lift: number) => {
		const geo = new THREE.BufferGeometry()
		const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false }))
		mesh.visible = false
		mesh.renderOrder = 2
		scene.add(mesh)
		let current = -1
		return (tile: number) => {
			if (tile === current) return
			current = tile
			if (tile < 0) {
				mesh.visible = false
				return
			}
			const t = tiles[tile]!
			const r = cardTop(t) + lift
			const n = t.corners.length
			const pos: number[] = []
			const at = (p: Vec3, inset: number) => [p[0] + (t.centre[0] - p[0]) * inset, p[1] + (t.centre[1] - p[1]) * inset, p[2] + (t.centre[2] - p[2]) * inset].map((v) => v * r)
			for (let k = 0; k < n; k++) {
				const a = t.corners[k]!, b = t.corners[(k + 1) % n]!
				const oa = at(a, 0), ob = at(b, 0), ia = at(a, width), ib = at(b, width)
				pos.push(...oa, ...ob, ...ib, ...oa, ...ib, ...ia)
			}
			geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
			geo.computeBoundingSphere()
			mesh.visible = true
		}
	}
	const setHover = ring(0xfff6dc, 0.14, 0.06)
	const setChosen = ring(0xe8743b, 0.26, 0.08)
	let mouse: { x: number; y: number } | null = null
	renderer.domElement.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY } })
	renderer.domElement.addEventListener('pointerleave', () => { mouse = null })
	/** Where the pointer points: the reticle while the pointer is locked, else the mouse (a visible crosshair when it steers the gaze unlocked). */
	const aim = (): THREE.Vector2 | null => {
		if (rig.lockedGaze) return pointer.set(0, 0)
		if (!mouse) return null
		const rect = renderer.domElement.getBoundingClientRect()
		return pointer.set(((mouse.x - rect.left) / rect.width) * 2 - 1, -((mouse.y - rect.top) / rect.height) * 2 + 1)
	}
	const updateHover = () => {
		const ndc = rig.frozen ? null : aim()
		setHover(ndc ? (pick(ndc)?.tile ?? -1) : -1)
	}

	/* ── a click: the card, or the coop standing on it ─────────────────── */
	let downAt: { x: number; y: number } | null = null
	renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY } })
	renderer.domElement.addEventListener('pointerup', (e) => {
		if (!downAt) return
		const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
		downAt = null
		if (moved > 6 || rig.frozen) return
		/* The click that handed the gaze to the mouse picks nothing; with the lock, the reticle picks. */
		if (rig.consumeLockClick()) return
		mouse = { x: e.clientX, y: e.clientY }
		const ndc = aim()
		const hit = ndc && pick(ndc)
		if (!hit) return
		const t = tiles[hit.tile]!
		lastPick = { tile: hit.tile, biome: hit.coop ? 'land' : WATER.has(t.biome) ? 'water' : 'land', coop: hit.coop }
		setChosen(lastPick.biome === 'land' ? hit.tile : -1)
		/* The sheet that opens wants the mouse back: a locked gaze lets go. */
		if (rig.lockedGaze) document.exitPointerLock()
		options.onTile?.(lastPick)
	})
	let lastPick: TilePick | null = null
	let currentCities: CityMarker[] = options.cities
	const updateCities = (cities: CityMarker[]) => { currentCities = cities; setCityMarkers(cities) }

	/* The core: a dark sphere just under the lowest tops, so a seam between
	   two cards shows the deep instead of the sky. */
	const core = new THREE.Mesh(new THREE.SphereGeometry(RADIUS - 0.9, 48, 32), new THREE.MeshStandardMaterial({ color: new THREE.Color(BIOMES.sea.shades[2]).multiplyScalar(0.6), roughness: 1 }))
	scene.add(core)

	scene.add(forests(tiles))

	/* Light: a bright fill from the sky, and a sun that rides with the camera
	   — above and to the right of wherever you look — so the side of the
	   globe you are looking at is always the lit one. */
	scene.add(new THREE.HemisphereLight(0xfff8ee, 0x6fb7c0, 1.25))
	const sun = new THREE.DirectionalLight(0xffffff, 1.7)
	scene.add(sun)
	const sunOffset = new THREE.Vector3()
	const placeSun = () => {
		sunOffset.copy(camera.position).normalize()
		const right = new THREE.Vector3().crossVectors(sunOffset, camera.up).normalize()
		sun.position.copy(sunOffset).multiplyScalar(RADIUS * 3).addScaledVector(right, RADIUS * 1.5).addScaledVector(camera.up, RADIUS * 1.5)
	}

	/* A dev hook: inspect the camera and the globe from the console. */
	;(window as unknown as { __world: unknown }).__world = { camera, rig, globe, tiles, setCities: updateCities, pick, lastPick: () => lastPick }

	let frame = 0
	let last = performance.now()
	let paused = false
	const tick = () => {
		if (paused) {
			frame = requestAnimationFrame(tick)
			return
		}
		const now = performance.now()
		rig.update(Math.min(0.1, (now - last) / 1000))
		last = now
		updateHover()
		showDetail()
		placeSun()
		renderer.render(scene, camera)
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
		setCities: updateCities,
		setFrozen: (on) => {
			rig.freeze(on)
			if (on) setHover(-1)
		},
		setChosen,
		focus: (tile, at, zoom = 0.5) => {
			const t = tiles[tile]
			if (!t) return
			setChosen(tile)
			rig.flyTo(new THREE.Vector3(...t.centre), zoom, new THREE.Vector2(at?.x ?? 0, at?.y ?? 0))
		},
		setPaused: (on) => {
			paused = on
			if (!on) last = performance.now()
		},
		dispose: () => {
			cancelAnimationFrame(frame)
			window.removeEventListener('resize', onResize)
			rig.dispose()
			reticle.remove()
			geometry.dispose()
			renderer.dispose()
			renderer.domElement.remove()
		}
	}
}
