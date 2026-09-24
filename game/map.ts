/**
 * THE MAP — where the land is, from Natural Earth.
 *
 * The coastline comes as a ready mask (`public/map/land.json`, from Natural
 * Earth's 110m land polygons by scripts/map-land.ts) that the server reads
 * too, so the globe the browser draws and the one the ledger checks a coop
 * against agree on every card. A tile asks with its centre, a unit vector;
 * latitude from y, longitude around it. The globe builder uses the answer
 * for the coast and keeps its own noise for heights and moisture. The
 * mountain ranges (`public/map/mountains.geojson`, Natural Earth's 50m
 * geography regions, the Range/mtn polygons) are drawn once onto an
 * equirectangular canvas here in the browser and read back the same way.
 */
export type LandMask = (p: readonly [number, number, number] | number[]) => boolean

type Ring = [number, number][]
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
type FeatureCollection = { features: { geometry: Geometry }[] }

const W = 2048
const H = 1024

export const loadMountainMask = (url = '/map/mountains.geojson') => loadMask(url)

type LandFile = { width: number; height: number; rows: string[] }

/** `public/map/land.json`: the coastline as a quarter-degree mask (scripts/map-land.ts) — the same file the server reads, so both agree on what is land. */
export async function loadLandMask(url = '/map/land.json'): Promise<LandMask> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`No land mask at ${url}: ${res.status}`)
	return decodeLand((await res.json()) as LandFile)
}

export function decodeLand(file: LandFile): LandMask {
	const { width: w, height: h } = file
	const grid = new Uint8Array(w * h)
	file.rows.forEach((row, y) => {
		let x = 0
		for (const m of row.matchAll(/([LW])(\d+)/g)) {
			const n = Number(m[2])
			if (m[1] === 'L') grid.fill(1, y * w + x, y * w + x + n)
			x += n
		}
	})
	return (p) => {
		const lat = (Math.asin(Math.max(-1, Math.min(1, p[1]!))) * 180) / Math.PI
		const lon = (Math.atan2(p[0]!, p[2]!) * 180) / Math.PI
		const cx = ((Math.floor(((lon + 180) / 360) * w) % w) + w) % w
		const cy = Math.max(0, Math.min(h - 1, Math.floor(((90 - lat) / 180) * h)))
		return grid[cy * w + cx] === 1
	}
}

export async function loadMask(url: string): Promise<LandMask> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`No map at ${url}: ${res.status}`)
	return rasterise((await res.json()) as FeatureCollection)
}

/** Draw every polygon, holes and all, then keep one bit per cell. */
export function rasterise(fc: FeatureCollection): LandMask {
	const canvas = document.createElement('canvas')
	canvas.width = W
	canvas.height = H
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) throw new Error('No 2d canvas for the map.')
	ctx.fillStyle = '#000'
	ctx.fillRect(0, 0, W, H)
	ctx.fillStyle = '#fff'
	const x = (lon: number) => ((lon + 180) / 360) * W
	const y = (lat: number) => ((90 - lat) / 180) * H
	const polygon = (rings: Ring[]) => {
		ctx.beginPath()
		for (const ring of rings) {
			ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(x(lon), y(lat)) : ctx.moveTo(x(lon), y(lat))))
			ctx.closePath()
		}
		ctx.fill('evenodd')
	}
	for (const { geometry } of fc.features) {
		if (geometry.type === 'Polygon') polygon(geometry.coordinates)
		else for (const poly of geometry.coordinates) polygon(poly)
	}
	const data = ctx.getImageData(0, 0, W, H).data
	const mask = new Uint8Array(W * H)
	for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4]! > 127 ? 1 : 0
	return (p) => {
		const lat = (Math.asin(Math.max(-1, Math.min(1, p[1]!))) * 180) / Math.PI
		const lon = (Math.atan2(p[0]!, p[2]!) * 180) / Math.PI
		const cx = ((Math.floor(x(lon)) % W) + W) % W
		const cy = Math.max(0, Math.min(H - 1, Math.floor(y(lat))))
		return mask[cy * W + cx] === 1
	}
}

/* ── the biomes ────────────────────────────────────────────────────────── */

/** The kind of land a map says a point is — what grows there before the coast has its say. */
export type LandKind = 'water' | 'grass' | 'earth' | 'forest' | 'taiga' | 'snow' | 'sand'
export type BiomeMap = (p: readonly [number, number, number] | number[]) => LandKind

type BiomeFile = { width: number; height: number; codes: Record<LandKind, string>; rows: string[] }

/** `public/map/biomes.json`: the Köppen-Geiger 0.5° grid folded into the game's kinds, run-length encoded (see scripts/map-biomes.ts). */
export async function loadBiomeMap(url = '/map/biomes.json'): Promise<BiomeMap> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`No biome map at ${url}: ${res.status}`)
	return decodeBiomes((await res.json()) as BiomeFile)
}

export function decodeBiomes(file: BiomeFile): BiomeMap {
	const { width: w, height: h } = file
	const kinds = Object.entries(file.codes) as [LandKind, string][]
	const byCode = new Map(kinds.map(([k, c]) => [c, k]))
	const grid = new Uint8Array(w * h)
	const index = new Map(kinds.map(([k], i) => [k, i]))
	const list = kinds.map(([k]) => k)
	file.rows.forEach((row, y) => {
		let x = 0
		for (const m of row.matchAll(/([A-Z])(\d+)/g)) {
			const k = index.get(byCode.get(m[1]!)!) ?? 0
			const n = Number(m[2])
			grid.fill(k, y * w + x, y * w + x + n)
			x += n
		}
	})
	const at = (x: number, y: number) => list[grid[((y + h) % h) * w + ((x % w) + w) % w]!]!
	return (p) => {
		const lat = (Math.asin(Math.max(-1, Math.min(1, p[1]!))) * 180) / Math.PI
		const lon = (Math.atan2(p[0]!, p[2]!) * 180) / Math.PI
		const x = Math.floor(((lon + 180) / 360) * w)
		const y = Math.max(0, Math.min(h - 1, Math.floor(((90 - lat) / 180) * h)))
		const here = at(x, y)
		if (here !== 'water') return here
		/* A coast the two maps draw differently: take the nearest land the climate grid knows. */
		for (let r = 1; r <= 3; r++)
			for (let dy = -r; dy <= r; dy++)
				for (let dx = -r; dx <= r; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
					const k = at(x + dx, y + dy)
					if (k !== 'water') return k
				}
		return 'water'
	}
}

/* ── the depth ─────────────────────────────────────────────────────────── */

/** How deep the sea is at a point: 0 for the shelf, up to 11 for the deepest trenches, −1 where the map has no sea. */
export type DepthMap = (p: readonly [number, number, number] | number[]) => number

type DepthFile = { width: number; height: number; layers: number[]; rows: string[] }

/** `public/map/depth.json`: Natural Earth's bathymetry as a quarter-degree grid of depth layers (see scripts/map-depth.ts). */
export async function loadDepthMap(url = '/map/depth.json'): Promise<DepthMap> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`No depth map at ${url}: ${res.status}`)
	return decodeDepth((await res.json()) as DepthFile)
}

export function decodeDepth(file: DepthFile): DepthMap {
	const { width: w, height: h } = file
	const grid = new Int8Array(w * h).fill(-1)
	file.rows.forEach((row, y) => {
		let x = 0
		for (const m of row.matchAll(/([A-L.])(\d+)/g)) {
			const n = Number(m[2])
			if (m[1] !== '.') grid.fill(m[1]!.charCodeAt(0) - 65, y * w + x, y * w + x + n)
			x += n
		}
	})
	const at = (x: number, y: number) => grid[((y + h) % h) * w + ((x % w) + w) % w]!
	return (p) => {
		const lat = (Math.asin(Math.max(-1, Math.min(1, p[1]!))) * 180) / Math.PI
		const lon = (Math.atan2(p[0]!, p[2]!) * 180) / Math.PI
		const x = Math.floor(((lon + 180) / 360) * w)
		const y = Math.max(0, Math.min(h - 1, Math.floor(((90 - lat) / 180) * h)))
		const here = at(x, y)
		if (here >= 0) return here
		/* A coast the maps draw differently: the nearest sea the depth grid knows, else the shelf. */
		for (let r = 1; r <= 2; r++)
			for (let dy = -r; dy <= r; dy++)
				for (let dx = -r; dx <= r; dx++) {
					const k = at(x + dx, y + dy)
					if (k >= 0) return k
				}
		return 0
	}
}
