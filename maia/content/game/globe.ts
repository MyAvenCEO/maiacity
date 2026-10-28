/**
 * THE GLOBE — hex cards tiling a sphere.
 *
 * A sphere cannot be tiled with hexagons alone; the closest thing is a
 * Goldberg polyhedron: the dual of a subdivided icosahedron, which is all
 * hexagons except for twelve pentagons at the icosahedron's corners. Each
 * vertex of the icosphere becomes one card, whose corners are the centroids
 * of the triangles around it.
 *
 * Every card is a prism: a top face at the sphere's surface, sides dropping
 * toward the centre, a hairline between neighbours. Sea cards sit a little
 * lower than land, so the coast has a step. Pure geometry and pure noise —
 * no three.js in here, so it can be tested.
 */

export type Vec3 = [number, number, number]
/**
 * Sea and shallows are water; the coast keeps its own kind of land;
 * the interior is sand, grass or forest by how wet it is.
 */
export type Biome = 'sea' | 'shallow' | 'ice' | 'sand' | 'earth' | 'grass' | 'forest' | 'taiga' | 'mountain' | 'snow'
export const WATER: ReadonlySet<Biome> = new Set(['sea', 'shallow', 'ice'])

/** The one globe: the client draws it and the ledger checks coops against it, so both build it from these. */
export const FREQUENCY = 72 // 10n²+2 cards: 51,842
export const LAND = 0.25 // a quarter land, three quarters sea — when no map says where it is

export type Tile = {
	/** Unit direction of the card's centre. */
	centre: Vec3
	/** Unit directions of the corners, in order around the centre. */
	corners: Vec3[]
	biome: Biome
	/** 0..1 — how deep a sea, how high a dune. */
	value: number
	/** 0..1 — how wet the land is; what grows. */
	moisture: number
	/** Indices of the cards sharing an edge. */
	neighbours: number[]
}

/* ── vectors ───────────────────────────────────────────────────────────── */

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const normalize = (a: Vec3): Vec3 => {
	const l = Math.hypot(a[0], a[1], a[2]) || 1
	return [a[0] / l, a[1] / l, a[2] / l]
}

/* ── the icosphere ─────────────────────────────────────────────────────── */

const PHI = (1 + Math.sqrt(5)) / 2
const ICO_VERTS: Vec3[] = ([
	[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
	[0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
	[PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
] as Vec3[]).map(normalize)
const ICO_FACES: [number, number, number][] = [
	[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
	[1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
	[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
	[4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
]

/**
 * Subdivide every icosahedron face into n² triangles, deduplicating the
 * vertices on shared edges. Returns unit vertices and the triangles.
 */
function icosphere(n: number): { vertices: Vec3[]; faces: [number, number, number][] } {
	const vertices: Vec3[] = []
	const index = new Map<string, number>()
	const vertex = (p: Vec3): number => {
		const u = normalize(p)
		const key = u.map((c) => c.toFixed(6)).join(',')
		let i = index.get(key)
		if (i === undefined) {
			i = vertices.length
			vertices.push(u)
			index.set(key, i)
		}
		return i
	}
	const faces: [number, number, number][] = []
	for (const [a, b, c] of ICO_FACES) {
		const A = ICO_VERTS[a]!, B = ICO_VERTS[b]!, C = ICO_VERTS[c]!
		/* Rows of points from A toward the BC edge. */
		const rows: number[][] = []
		for (let i = 0; i <= n; i++) {
			const row: number[] = []
			for (let j = 0; j <= i; j++) {
				const t = i / n
				const s = i === 0 ? 0 : j / i
				const p = add(scale(A, 1 - t), add(scale(B, t * (1 - s)), scale(C, t * s)))
				row.push(vertex(p))
			}
			rows.push(row)
		}
		for (let i = 0; i < n; i++)
			for (let j = 0; j <= i; j++) {
				faces.push([rows[i]![j]!, rows[i + 1]![j]!, rows[i + 1]![j + 1]!])
				if (j < i) faces.push([rows[i]![j]!, rows[i + 1]![j + 1]!, rows[i]![j + 1]!])
			}
	}
	return { vertices, faces }
}

/* ── 3D value noise, for continents ────────────────────────────────────── */

function hash3(x: number, y: number, z: number): number {
	const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
	return s - Math.floor(s)
}
const smooth = (t: number) => t * t * (3 - 2 * t)
function noise3(x: number, y: number, z: number): number {
	const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z)
	const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0)
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t
	const c = (dx: number, dy: number, dz: number) => hash3(x0 + dx, y0 + dy, z0 + dz)
	return lerp(
		lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
		lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
		fz
	)
}
/** Four octaves on the unit sphere, offset by a seed. */
export function continents(p: Vec3, seed = 7): number {
	let v = 0, amp = 0.55, freq = 1.7, sum = 0
	for (let o = 0; o < 4; o++) {
		v += amp * noise3(p[0] * freq + seed, p[1] * freq + seed * 1.3, p[2] * freq + seed * 0.7)
		sum += amp
		amp *= 0.5
		freq *= 2.1
	}
	return v / sum
}

/* ── the tiles ─────────────────────────────────────────────────────────── */

export type GlobeOptions = {
	/** Subdivision frequency: 10n²+2 cards. */
	frequency: number
	/** Fraction of the surface that is land — when no map says where it is. */
	land: number
	seed?: number
	/** A map: whether the point (a unit vector) is land. Given, it decides the coast; the noise still shapes heights and moisture. */
	isLand?: (p: Vec3) => boolean
	/** A map: what kind of land a point is. Given, it decides the biome; the poles are still snow. */
	kindOf?: (p: Vec3) => 'water' | 'grass' | 'earth' | 'forest' | 'taiga' | 'snow' | 'sand'
	/** A map: whether the point lies in a mountain range. Mountains stand over any inland kind but snow. */
	isMountain?: (p: Vec3) => boolean
	/** Snow past the polar circles and pack ice on the polar sea (default true). */
	poles?: boolean
	/** A map: how deep the sea is at a point, 0 (shelf) to 11 (trench). Given, a sea card's value is its depth. */
	depthOf?: (p: Vec3) => number
}

export function buildGlobe(options: GlobeOptions): Tile[] {
	const { vertices, faces } = icosphere(options.frequency)
	const around: number[][] = vertices.map(() => [])
	const centroids: Vec3[] = faces.map(([a, b, c]) => normalize(add(add(vertices[a]!, vertices[b]!), vertices[c]!)))
	faces.forEach((f, i) => {
		for (const v of f) around[v]!.push(i)
	})

	/* Land is the top `land` fraction of the noise: the threshold is a
	   quantile, so the share of land is exact whatever the seed does. */
	const values = vertices.map((v) => continents(v, options.seed))
	const sorted = [...values].sort((a, b) => a - b)
	const threshold = sorted[Math.floor(sorted.length * (1 - options.land))] ?? 0.5

	/* Who touches whom: every triangle's three corners are mutual neighbours. */
	const neighbourSets: Set<number>[] = vertices.map(() => new Set())
	for (const [a, b, c] of faces) {
		neighbourSets[a]!.add(b).add(c)
		neighbourSets[b]!.add(a).add(c)
		neighbourSets[c]!.add(a).add(b)
	}
	const isSea = options.isLand ? vertices.map((v) => !options.isLand!(v)) : values.map((v) => v < threshold)
	/* The coast: water touching land is shallow; the land keeps its kind. */
	const coastal = vertices.map((_, i) => [...neighbourSets[i]!].some((n) => isSea[n] !== isSea[i]))
	const moistures = vertices.map((v) => continents(v, (options.seed ?? 7) + 23))

	return vertices.map((centre, i): Tile => {
		/* Order the surrounding centroids by angle in the tangent plane. */
		const up = centre
		const ref = normalize(cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
		const ref2 = cross(up, ref)
		const corners = around[i]!
			.map((f) => centroids[f]!)
			.map((c) => ({ c, a: Math.atan2(dot(c, ref2), dot(c, ref)) }))
			.sort((p, q) => p.a - q.a)
			.map((p) => p.c)
		const v = values[i]!
		const sea = isSea[i]!
		/* Normalised within its biome: how deep, how high. */
		const noiseValue = sea ? (threshold - v) / Math.max(threshold - sorted[0]!, 1e-6) : (v - threshold) / Math.max(sorted[sorted.length - 1]! - threshold, 1e-6)
		/* At sea the value is the depth when a map gives it: 0 on the shelf, 1 in the deepest trench. */
		const value = sea && options.depthOf ? Math.max(0, options.depthOf(centre)) / 8 : noiseValue
		const moisture = moistures[i]!
		/* The poles. On land the climate map says where the ice caps are (EF is
		   snow); without a map, land past about 62° of latitude is snow. On the
		   sea, pack ice: the edge follows the real year-round mean rather than a
		   circle — the Atlantic side stays open to about 80° N where the warm
		   water goes, the Siberian and Canadian sides freeze from about 71° N,
		   and the Southern Ocean freezes from about 64° S — with the noise
		   fraying every line. */
		const lat = (Math.asin(Math.max(-1, Math.min(1, centre[1]))) * 180) / Math.PI
		const lon = (Math.atan2(centre[0], centre[2]) * 180) / Math.PI
		const poles = options.poles ?? true
		const polar = poles && !options.kindOf && Math.abs(lat) > 58 + 9 * moisture
		const fray = 6 * (moisture - 0.5)
		const atlantic = Math.max(0, Math.cos(((lon - 25) * Math.PI) / 110))
		/* The Southern Ocean's ice reaches furthest north in the Weddell Sea, off the Atlantic. */
		const weddell = 3.5 * Math.cos(((lon + 40) * Math.PI) / 180)
		const ice = poles && (lat > 0 ? lat > 71 + 9 * atlantic + fray : lat < -64.5 + weddell + fray * 1.4)
		const mapped = !sea && options.kindOf ? options.kindOf(centre) : undefined
		const flat: Biome = mapped && mapped !== 'water' ? mapped : moisture < 0.44 ? 'sand' : moisture < 0.56 ? 'grass' : 'forest'
		const inland: Biome = flat !== 'snow' && options.isMountain?.(centre) ? 'mountain' : flat
		const biome: Biome = sea
			? ice ? 'ice' : coastal[i] ? 'shallow' : 'sea'
			: polar || inland === 'snow' ? 'snow' : inland
		return { centre, corners, biome, value: Math.min(1, Math.max(0, value)), moisture, neighbours: [...neighbourSets[i]!] }
	})
}
