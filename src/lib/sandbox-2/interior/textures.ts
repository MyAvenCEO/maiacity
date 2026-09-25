/**
 * Real-world surfaces, painted at runtime: flagstone, limestone blocks, oak
 * boards, garden soil, bark, water and leaves. Nothing is downloaded — every
 * texture is drawn once into a canvas and cached, so the dome interiors look
 * like stone and timber without shipping a megabyte of photographs.
 */
import * as THREE from 'three'

const cache = new Map<string, THREE.CanvasTexture>()

/** A small seeded random, so every texture is the same on every visit. */
function rng(seed: number) {
	let s = seed >>> 0 || 1
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/** Smooth value noise in 0..1, tileable over `period`. */
function noise(period: number, seed: number) {
	const r = rng(seed)
	const g = Array.from({ length: period * period }, () => r())
	const at = (x: number, y: number) => g[(((y % period) + period) % period) * period + (((x % period) + period) % period)]!
	return (x: number, y: number) => {
		const xi = Math.floor(x), yi = Math.floor(y)
		const fx = x - xi, fy = y - yi
		const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
		const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1)
		return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
	}
}

/** Several octaves of noise, tileable over the canvas. */
function fbm(size: number, seed: number, base = 4, octaves = 4) {
	const layers = Array.from({ length: octaves }, (_, i) => ({ n: noise(base << i, seed + i * 97), f: (base << i) / size, w: 1 / (1 << i) }))
	const total = layers.reduce((s, l) => s + l.w, 0)
	return (x: number, y: number) => layers.reduce((s, l) => s + l.n(x * l.f, y * l.f) * l.w, 0) / total
}

function paint(key: string, size: number, draw: (img: ImageData) => void, repeat = 1, colour = true): THREE.CanvasTexture {
	const hit = cache.get(key)
	if (hit) return hit
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d')!
	const img = ctx.createImageData(size, size)
	draw(img)
	ctx.putImageData(img, 0, 0)
	const tex = new THREE.CanvasTexture(canvas)
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping
	tex.repeat.set(repeat, repeat)
	tex.anisotropy = 8
	if (colour) tex.colorSpace = THREE.SRGBColorSpace
	cache.set(key, tex)
	return tex
}

const set = (img: ImageData, i: number, r: number, g: number, b: number, a = 255) => {
	img.data[i] = r
	img.data[i + 1] = g
	img.data[i + 2] = b
	img.data[i + 3] = a
}

/** Irregular flagstones with sunken joints: a Voronoi of stones, each its own shade. */
let flagCache: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null = null
export function flagstone(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
	// the Voronoi of stones is the slow part: work it out once, for every dome
	if (flagCache) return flagCache
	const size = 512
	const r = rng(11)
	const pts = Array.from({ length: 42 }, () => [r() * size, r() * size, 0.85 + r() * 0.3] as const)
	const grain = fbm(size, 5, 8, 4)
	const edge = new Float32Array(size * size)
	const shade = new Float32Array(size * size)
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			let d1 = 1e9, d2 = 1e9, s = 1
			for (const [px, py, k] of pts)
				for (const ox of [-size, 0, size])
					for (const oy of [-size, 0, size]) {
						const d = Math.hypot(x - px - ox, y - py - oy)
						if (d < d1) [d2, d1, s] = [d1, d, k]
						else if (d < d2) d2 = d
					}
			edge[y * size + x] = d2 - d1
			shade[y * size + x] = s
		}
	const map = paint('flagstone', size, (img) => {
		for (let i = 0; i < size * size; i++) {
			const x = i % size, y = (i / size) | 0
			const g = grain(x, y)
			const joint = edge[i]! < 3.2
			const v = joint ? 0.42 + g * 0.1 : (0.7 + g * 0.22) * shade[i]!
			set(img, i * 4, 205 * v, 196 * v, 178 * v)
		}
	}, 1)
	const bump = paint('flagstone-bump', size, (img) => {
		for (let i = 0; i < size * size; i++) {
			const v = Math.min(1, edge[i]! / 6) * 200 + grain(i % size, (i / size) | 0) * 55
			set(img, i * 4, v, v, v)
		}
	}, 1, false)
	return (flagCache = { map, bump })
}

/** Pale limestone blocks in courses, for the pillars and knee walls. */
export function limestone(): THREE.CanvasTexture {
	const size = 512
	const grain = fbm(size, 21, 8, 5)
	const r = rng(3)
	const rows = 8
	const offsets = Array.from({ length: rows }, () => r() * 256)
	const tints = Array.from({ length: rows * 8 }, () => 0.9 + r() * 0.12)
	return paint('limestone', size, (img) => {
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const row = Math.floor(y / (size / rows))
				const bx = (x + offsets[row]!) % size
				const col = Math.floor(bx / (size / 4))
				const joint = y % (size / rows) < 3 || bx % (size / 4) < 3
				const v = joint ? 0.66 : (0.84 + grain(x, y) * 0.16) * tints[row * 8 + col]!
				set(img, (y * size + x) * 4, 236 * v, 229 * v, 214 * v)
			}
	})
}

/** Oiled oak boards with grain running along them. */
export function oak(): THREE.CanvasTexture {
	const size = 512
	const grain = fbm(size, 31, 4, 4)
	const r = rng(8)
	const planks = 6
	const tints = Array.from({ length: planks }, () => 0.85 + r() * 0.2)
	return paint('oak', size, (img) => {
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const p = Math.floor(y / (size / planks))
				const lines = Math.sin((y + grain(x * 0.2, y) * 60) * 0.35 + p * 7) * 0.5 + 0.5
				const gap = y % (size / planks) < 2
				const v = gap ? 0.45 : (0.72 + lines * 0.14 + grain(x, y) * 0.14) * tints[p]!
				set(img, (y * size + x) * 4, 181 * v, 128 * v, 78 * v)
			}
	})
}

/** Dark garden soil with mulch. */
export function soil(): THREE.CanvasTexture {
	const size = 256
	const grain = fbm(size, 41, 16, 4)
	const r = rng(9)
	return paint('soil', size, (img) => {
		for (let i = 0; i < size * size; i++) {
			const g = grain(i % size, (i / size) | 0)
			const speck = r() < 0.06 ? 0.25 : 0
			const v = 0.5 + g * 0.35 + speck
			set(img, i * 4, 96 * v, 70 * v, 48 * v)
		}
	})
}

/** Grey-brown bark in vertical fissures. */
export function bark(): THREE.CanvasTexture {
	const size = 256
	const grain = fbm(size, 51, 6, 4)
	return paint('bark', size, (img) => {
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const fis = Math.abs(Math.sin((x + grain(x, y * 0.3) * 40) * 0.2))
				const v = 0.45 + fis * 0.3 + grain(x, y) * 0.25
				set(img, (y * size + x) * 4, 118 * v, 98 * v, 80 * v)
			}
	})
}

/** A stream bed's water: cool green-blue with soft ripples. */
export function water(): THREE.CanvasTexture {
	const size = 256
	const grain = fbm(size, 61, 6, 4)
	return paint('water', size, (img) => {
		for (let i = 0; i < size * size; i++) {
			const g = grain(i % size, (i / size) | 0)
			set(img, i * 4, 58 + g * 40, 108 + g * 50, 112 + g * 45)
		}
	})
}

/**
 * A card of leaves on transparent ground: broad glossy leaves for the fruit
 * trees and the understorey. Drawn as tapered ellipses around a stem.
 */
export function leaves(kind: 'broad' | 'fine' = 'broad'): THREE.CanvasTexture {
	const key = `leaves-${kind}`
	const hit = cache.get(key)
	if (hit) return hit
	const size = 256
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d')!
	const r = rng(kind === 'broad' ? 71 : 73)
	const n = kind === 'broad' ? 26 : 60
	for (let i = 0; i < n; i++) {
		const x = 30 + r() * (size - 60), y = 30 + r() * (size - 60)
		const len = kind === 'broad' ? 34 + r() * 30 : 14 + r() * 12
		const a = r() * Math.PI * 2
		const g = 90 + r() * 70
		ctx.save()
		ctx.translate(x, y)
		ctx.rotate(a)
		const grad = ctx.createLinearGradient(-len / 2, 0, len / 2, 0)
		grad.addColorStop(0, `rgb(${40 + r() * 20},${g},${40 + r() * 20})`)
		grad.addColorStop(1, `rgb(${70 + r() * 30},${g + 40},${50 + r() * 25})`)
		ctx.fillStyle = grad
		ctx.beginPath()
		ctx.ellipse(0, 0, len / 2, len * (kind === 'broad' ? 0.22 : 0.3), 0, 0, Math.PI * 2)
		ctx.fill()
		ctx.strokeStyle = 'rgba(210,235,170,0.5)'
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(-len / 2, 0)
		ctx.lineTo(len / 2, 0)
		ctx.stroke()
		ctx.restore()
	}
	const tex = new THREE.CanvasTexture(canvas)
	tex.colorSpace = THREE.SRGBColorSpace
	tex.anisotropy = 8
	cache.set(key, tex)
	return tex
}

/** A palm frond: a rib with leaflets fanned along it, on transparent ground. */
export function frond(): THREE.CanvasTexture {
	const key = 'frond'
	const hit = cache.get(key)
	if (hit) return hit
	const w = 512, h = 128
	const canvas = document.createElement('canvas')
	canvas.width = w
	canvas.height = h
	const ctx = canvas.getContext('2d')!
	ctx.strokeStyle = 'rgb(120,130,60)'
	ctx.lineWidth = 3
	ctx.beginPath()
	ctx.moveTo(0, h / 2)
	ctx.lineTo(w, h / 2)
	ctx.stroke()
	for (let x = 8; x < w - 8; x += 7) {
		const len = (1 - x / w) * 50 + 10
		for (const side of [-1, 1]) {
			ctx.strokeStyle = `rgb(${50 + (x % 30)},${120 + (x % 50)},${45})`
			ctx.lineWidth = 3
			ctx.beginPath()
			ctx.moveTo(x, h / 2)
			ctx.lineTo(x + 14, h / 2 + side * len)
			ctx.stroke()
		}
	}
	const tex = new THREE.CanvasTexture(canvas)
	tex.colorSpace = THREE.SRGBColorSpace
	cache.set(key, tex)
	return tex
}
