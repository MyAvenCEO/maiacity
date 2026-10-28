/**
 * Water that looks like water: clear and sandy-green in the shallows by the
 * bank, deepening to a dark teal in the middle, catching the sky; ripples
 * drifting along it; a bed under it, wet earth and sand at the edges, mud in
 * the deep; and at the shore, reeds and rushes with their brown heads, and
 * lily pads floating in the still water by the bank. Ponds are never circles.
 *
 * Every surface carries a `depth` for each vertex, 0 at the bank and 1 in
 * the deepest part, and the material colours and clears it by that.
 */
import * as THREE from 'three'
import { seeded } from './plants'

const shared = <T,>(make: () => T) => {
	let v: T | undefined
	return () => (v ??= make())
}

/** Ripples: a soft grey pattern the water's colour is shaded by, scrolled to make it flow. */
const ripples = shared(() => {
	const s = 256
	const c = document.createElement('canvas')
	c.width = c.height = s
	const x = c.getContext('2d')!
	x.fillStyle = '#e8e8e8'
	x.fillRect(0, 0, s, s)
	const r = seeded(33)
	for (let i = 0; i < 260; i++) {
		x.strokeStyle = `rgba(${r() < 0.5 ? 255 : 170},${r() < 0.5 ? 255 : 170},${r() < 0.5 ? 255 : 170},${0.25 + r() * 0.3})`
		x.lineWidth = 1 + r() * 2
		const cx = r() * s, cy = r() * s, w = 10 + r() * 40
		x.beginPath()
		x.ellipse(cx, cy, w, w * 0.25, 0, 0, Math.PI * 2)
		x.stroke()
	}
	const t = new THREE.CanvasTexture(c)
	t.wrapS = t.wrapT = THREE.RepeatWrapping
	return t
})

/** The water's surface. Call `flow(t)` each frame to keep it moving. */
export const waterMaterial = shared(() => {
	const mat = new THREE.MeshStandardMaterial({ map: ripples(), roughness: 0.06, metalness: 0, transparent: true, envMapIntensity: 1.3, side: THREE.DoubleSide, depthWrite: false })
	mat.onBeforeCompile = (sh) => {
		sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float depth;\nvarying float vDepth;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvDepth = depth;')
		sh.fragmentShader = sh.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying float vDepth;')
			.replace(
				'#include <map_fragment>',
				`vec4 sampledDiffuseColor = texture2D(map, vMapUv);
				float d = smoothstep(0.0, 1.0, vDepth);
				vec3 shallow = vec3(0.52, 0.66, 0.46);
				vec3 mid = vec3(0.12, 0.38, 0.40);
				vec3 deep = vec3(0.03, 0.15, 0.19);
				vec3 body = d < 0.5 ? mix(shallow, mid, d * 2.0) : mix(mid, deep, d * 2.0 - 1.0);
				diffuseColor.rgb = body * (0.82 + 0.32 * sampledDiffuseColor.g);
				diffuseColor.a = mix(0.45, 0.97, d);`
			)
	}
	mat.customProgramCacheKey = () => 'water-depth'
	return mat
})
export const flow = (t: number) => (ripples().offset.set(t * 0.012, -t * 0.05))

/** The bed under the water: wet earth and sand at the edge, dark mud in the deep. */
const bedMaterial = shared(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
const bedColour = (depth: number) => new THREE.Color('#8a7a58').lerp(new THREE.Color('#3a3326'), Math.min(1, depth * 1.3))

function surface(pos: number[], depth: number[], uv: number[], idx: number[], material: THREE.Material, colours?: number[]) {
	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
	geo.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1))
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
	if (colours) geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
	geo.setIndex(idx)
	geo.computeVertexNormals()
	const mesh = new THREE.Mesh(geo, material)
	mesh.receiveShadow = true
	return mesh
}

/**
 * A stream along a line of points: its surface five vertices across (shallow at
 * both banks, deepest in the middle), and a bed a little wider than it.
 */
export function stream(line: THREE.Vector3[], width: number, y: number, closed = false): THREE.Group {
	const g = new THREE.Group()
	const across = [-1, -0.55, 0, 0.55, 1]
	const depthAt = [0, 0.55, 1, 0.55, 0]
	const build = (half: number, yy: number, bed: boolean) => {
		const pos: number[] = [], dep: number[] = [], uv: number[] = [], idx: number[] = [], col: number[] = []
		let dist = 0
		const n = line.length + (closed ? 1 : 0)
		for (let i = 0; i < n; i++) {
			const p = line[i % line.length]!, p1 = line[(i + 1) % line.length]!, p0 = line[(i - 1 + line.length) % line.length]!
			const dir = (closed || (i > 0 && i < line.length - 1) ? p1.clone().sub(p0) : i === 0 ? p1.clone().sub(p) : p.clone().sub(p0)).setY(0).normalize()
			if (i > 0) dist += p.distanceTo(line[(i - 1) % line.length]!)
			across.forEach((a, k) => {
				pos.push(p.x - dir.z * a * half, yy, p.z + dir.x * a * half)
				dep.push(depthAt[k]! * (0.75 + 0.25 * Math.sin(i * 0.37)))
				uv.push((a + 1) * 0.5 * (half / 2), dist / 4)
				if (bed) col.push(...bedColour(depthAt[k]!).toArray())
			})
			if (i < n - 1) for (let k = 0; k < across.length - 1; k++) {
				const a = i * across.length + k, b = a + across.length
				idx.push(a, b, a + 1, a + 1, b, b + 1)
			}
		}
		return surface(pos, dep, uv, idx, bed ? bedMaterial() : waterMaterial(), bed ? col : undefined)
	}
	g.add(build(width / 2 + 0.5, y - 0.05, true), build(width / 2, y, false))
	return g
}

/**
 * A pond: an irregular, rounded shape, never a circle, shallow round its rim
 * and deep in its middle, with a bed under it. Returns its outline too, for
 * planting the shore.
 */
export function pond(cx: number, cz: number, radius: number, seed: number, y: number): { group: THREE.Group; outline: THREE.Vector3[] } {
	const r = seeded(seed)
	const [a2, a3, a5] = [r() * 6.28, r() * 6.28, r() * 6.28]
	const stretch = 0.75 + r() * 0.5, turn = r() * Math.PI
	const rimAt = (t: number) => radius * (1 + 0.22 * Math.sin(2 * t + a2) + 0.14 * Math.sin(3 * t + a3) + 0.07 * Math.sin(5 * t + a5))
	const at = (t: number, f: number): [number, number] => {
		const rr = rimAt(t) * f
		const x = Math.cos(t) * rr * stretch, z = Math.sin(t) * rr
		return [cx + x * Math.cos(turn) - z * Math.sin(turn), cz + x * Math.sin(turn) + z * Math.cos(turn)]
	}
	const N = 64
	const rings = [0, 0.35, 0.7, 1] // from the middle out
	const depths = [1, 0.85, 0.5, 0]
	const build = (grow: number, yy: number, bed: boolean) => {
		const pos: number[] = [], dep: number[] = [], uv: number[] = [], idx: number[] = [], col: number[] = []
		// the middle, then ring after ring
		pos.push(...at(0, 0).flatMap((v, i) => (i === 0 ? [v, yy] : [v])))
		dep.push(1)
		uv.push(cx / 4, cz / 4)
		if (bed) col.push(...bedColour(1).toArray())
		for (let k = 1; k < rings.length; k++)
			for (let i = 0; i < N; i++) {
				const t = (i / N) * Math.PI * 2
				const [x, z] = at(t, rings[k]! * grow)
				pos.push(x, yy, z)
				dep.push(depths[k]!)
				uv.push(x / 4, z / 4)
				if (bed) col.push(...bedColour(depths[k]!).toArray())
			}
		for (let i = 0; i < N; i++) idx.push(0, 1 + ((i + 1) % N), 1 + i)
		for (let k = 1; k < rings.length - 1; k++)
			for (let i = 0; i < N; i++) {
				const a = 1 + (k - 1) * N + i, b = 1 + (k - 1) * N + ((i + 1) % N)
				const c = a + N, d = b + N
				idx.push(a, b, c, b, d, c)
			}
		return surface(pos, dep, uv, idx, bed ? bedMaterial() : waterMaterial(), bed ? col : undefined)
	}
	const group = new THREE.Group()
	group.add(build(1.08, y - 0.05, true), build(1, y, false))
	const outline = Array.from({ length: N }, (_, i) => {
		const [x, z] = at((i / N) * Math.PI * 2, 1)
		return new THREE.Vector3(x, 0, z)
	})
	return { group, outline }
}

/* ── the shore: reeds, rushes with their heads, lily pads on the still water ── */

const reedMat = shared(() => new THREE.MeshStandardMaterial({ color: '#5e7a3a', roughness: 0.8, side: THREE.DoubleSide }))
const headMat = shared(() => new THREE.MeshStandardMaterial({ color: '#6b4a2a', roughness: 0.9 }))
const padMat = shared(() => new THREE.MeshStandardMaterial({ color: '#3f6f33', roughness: 0.55, side: THREE.DoubleSide }))
const bloomMat = [shared(() => new THREE.MeshStandardMaterial({ color: '#f6f1ea', roughness: 0.6 })), shared(() => new THREE.MeshStandardMaterial({ color: '#e8a0b8', roughness: 0.6 }))]
const blade = shared(() => new THREE.PlaneGeometry(0.05, 1).translate(0, 0.5, 0))
const padGeo = shared(() => new THREE.CircleGeometry(1, 14, 0.35, Math.PI * 2 - 0.35))

/** A clump of reeds and rushes, some carrying the brown head of a bulrush. */
function reeds(g: THREE.Group, x: number, z: number, r: () => number, size: number) {
	const n = 10 + Math.floor(r() * 10)
	for (let i = 0; i < n; i++) {
		const b = new THREE.Mesh(blade(), reedMat())
		const h = (0.8 + r() * 1.1) * size
		b.scale.set(1, h, 1)
		b.position.set(x + (r() - 0.5) * 0.5 * size, 0, z + (r() - 0.5) * 0.5 * size)
		b.rotation.set((r() - 0.5) * 0.35, r() * 6.28, (r() - 0.5) * 0.35)
		g.add(b)
		if (r() < 0.25) {
			const head = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), headMat())
			head.position.set(b.position.x, h * 0.9, b.position.z)
			g.add(head)
		}
	}
}

/**
 * Plants the shore of a line of water (a stream's centre, or a pond's outline):
 * reeds at the water's edge now and then, and lily pads on the water near the
 * bank, a flower among them here and there. `inside` says which side is water
 * for an outline (+1: toward the middle); for a stream both banks are planted.
 */
export function shore(line: THREE.Vector3[], halfWidth: number, seed: number, outlineCentre?: { x: number; z: number }): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	for (let i = 0; i < line.length; i += 1) {
		const p = line[i]!, q = line[(i + 1) % line.length]!
		const d = q.clone().sub(p).setY(0).normalize()
		const sides = outlineCentre ? [0] : [-1, 1]
		for (const sd of sides) {
			// where the bank is, and which way is the water
			let bx: number, bz: number, wx: number, wz: number
			if (outlineCentre) {
				const ox = outlineCentre.x - p.x, oz = outlineCentre.z - p.z, ol = Math.hypot(ox, oz)
				wx = ox / ol
				wz = oz / ol
				bx = p.x
				bz = p.z
			} else {
				wx = d.z * sd
				wz = -d.x * sd
				bx = p.x - wx * halfWidth
				bz = p.z - wz * halfWidth
			}
			if (r() < 0.22) reeds(g, bx + wx * 0.2, bz + wz * 0.2, r, 0.8 + r() * 0.6)
			if (r() < (outlineCentre ? 0.3 : 0.08)) {
				for (let k = 0; k < 3 + Math.floor(r() * 4); k++) {
					const pad = new THREE.Mesh(padGeo(), padMat())
					const s = 0.18 + r() * 0.2
					pad.scale.set(s, s, 1)
					pad.rotation.set(-Math.PI / 2, 0, r() * 6.28)
					pad.position.set(bx + wx * (0.8 + r() * 1.6) + (r() - 0.5) * 0.8, 0.095, bz + wz * (0.8 + r() * 1.6) + (r() - 0.5) * 0.8)
					g.add(pad)
					if (r() < 0.2) {
						const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bloomMat[r() < 0.6 ? 0 : 1]!())
						bloom.scale.y = 0.6
						bloom.position.set(pad.position.x, 0.13, pad.position.z)
						g.add(bloom)
					}
				}
			}
		}
	}
	return g
}
