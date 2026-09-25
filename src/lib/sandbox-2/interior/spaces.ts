/**
 * The master dome's working life: the ring under its gallery holds the
 * village's workshops (co-working desks, a woodshop, an art studio, a pottery,
 * a bakery and a cooking school, a library, a repair bench) and round it, just
 * outside the arcade, a ring of café squares where people eat in the open.
 *
 * Each space is drawn in its own frame: x runs along the ring, +z points out
 * toward the glass, and the space is placed on the ring by `place`.
 */
import * as THREE from 'three'
import { berryBush, herb, seeded, shrub } from './plants'

/** What the scene lends the spaces: its furniture and its materials. */
export type Kit = {
	box: (w: number, h: number, d: number, mat: THREE.Material, x?: number, y?: number, z?: number, rotY?: number) => THREE.Mesh
	table: (len: number, chairs: number) => THREE.Group
	sofa: (len: number) => THREE.Group
	lantern: (r: number, y: number) => THREE.Group
	oak: THREE.Material
	lime: THREE.Material
	stone: (rep: number) => THREE.Material
	dark: THREE.Material
	steel: THREE.Material
	counter: THREE.Material
	timber: THREE.Material
	linen: THREE.Material
	cushion: THREE.Material
	rug: THREE.Material
	paper: THREE.Material
}

type Collider = { x: number; z: number; r: number }
type Space = { group: THREE.Group; colliders: Collider[] }

const polar = (r: number, a: number): [number, number] => [r * Math.sin(a), r * Math.cos(a)]
const col = (c: string, rough = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: rough })

const clay = col('#b86b45', 0.95)
const brick = col('#9c5a3c', 0.95)
const white = col('#f6f3ec', 0.4)
const glaze = ['#3f6f7a', '#c9a45c', '#e9e2d3', '#7c8b5a', '#a4553c'].map((c) => col(c, 0.35))
const fruit = ['#f2a33a', '#e8c547', '#7fae3f', '#e0662f', '#b8342f'].map((c) => col(c, 0.6))
const awnings = ['#c9623f', '#6f8f6a', '#e3cfa6', '#3f6f7a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide }))
const bulb = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffcf7a', emissiveIntensity: 1.2 })

/** A landscape in oils, for the easels: sky, hills, a sun, and sometimes a dome. */
function painting(seed: number): THREE.MeshStandardMaterial {
	const r = seeded(seed)
	const c = document.createElement('canvas')
	c.width = 128
	c.height = 96
	const x = c.getContext('2d')!
	const sky = x.createLinearGradient(0, 0, 0, 96)
	const skies = [['#f6c68a', '#f4e4c8'], ['#9cc6d9', '#e8f0ea'], ['#e89a7a', '#f7d7a8'], ['#b7c7e8', '#f3ead9']][Math.floor(r() * 4)]!
	sky.addColorStop(0, skies[0]!)
	sky.addColorStop(1, skies[1]!)
	x.fillStyle = sky
	x.fillRect(0, 0, 128, 96)
	x.fillStyle = '#fff1c9'
	x.beginPath()
	x.arc(20 + r() * 88, 16 + r() * 20, 6 + r() * 6, 0, Math.PI * 2)
	x.fill()
	for (let h = 0; h < 3; h++) {
		x.fillStyle = ['#6f8f6a', '#4f7050', '#3a5a3f'][h]!
		x.beginPath()
		x.moveTo(0, 96)
		for (let i = 0; i <= 8; i++) x.lineTo(i * 16, 48 + h * 12 + Math.sin(i * (0.8 + r()) + h) * 8 * (1 + r()))
		x.lineTo(128, 96)
		x.fill()
	}
	if (r() < 0.6) {
		x.strokeStyle = 'rgba(255,255,255,0.85)'
		x.fillStyle = 'rgba(230,240,238,0.5)'
		for (let d = 0; d < 1 + r() * 3; d++) {
			x.beginPath()
			x.arc(20 + r() * 88, 78, 6 + r() * 10, Math.PI, 0)
			x.fill()
			x.stroke()
		}
	}
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })
}

/** A turned pot, for the pottery shelves and the planters. */
function pot(mat: THREE.Material, h: number, seed: number): THREE.Mesh {
	const r = seeded(seed)
	const w = 0.4 + r() * 0.5
	const pts = [0, 0.15, 0.45, 0.75, 0.95, 1].map((t) => new THREE.Vector2(h * (0.25 + Math.sin(t * Math.PI * (0.8 + r() * 0.3)) * w * 0.5 + (t > 0.9 ? 0.05 : 0)), t * h))
	const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), mat)
	m.castShadow = true
	return m
}

function stool(k: Kit, x: number, z: number, h = 0.62): THREE.Group {
	const g = new THREE.Group()
	g.add(k.box(0.05, h, 0.05, k.dark, x, 0, z))
	const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14), k.oak)
	seat.position.set(x, h, z)
	g.add(seat)
	return g
}

function place(space: Space, rr: number, a: number): Space {
	space.group.position.set(...(() => {
		const [x, z] = polar(rr, a)
		return [x, 0, z] as [number, number, number]
	})())
	space.group.rotation.y = a
	const c = Math.cos(a), s = Math.sin(a)
	const [ox, oz] = polar(rr, a)
	return { group: space.group, colliders: space.colliders.map((p) => ({ x: ox + p.x * c + p.z * s, z: oz - p.x * s + p.z * c, r: p.r })) }
}

/* ── inside: the workshops under the gallery ────────────────────────────── */

function cowork(k: Kit, seed: number): Space {
	const g = new THREE.Group()
	const cs: Collider[] = []
	for (const z of [-1.6, 1.6]) {
		const t = k.table(4.2, 8)
		t.position.set(-0.6, 0, z)
		g.add(t)
		cs.push({ x: -1.6, z, r: 1.1 }, { x: 0.4, z, r: 1.1 })
		for (let i = 0; i < 4; i++) {
			const x = -2.2 + i * 1.05
			for (const side of [-1, 1]) {
				if ((i + (side > 0 ? 1 : 0) + seed) % 3 === 0) continue
				g.add(k.box(0.34, 0.015, 0.24, k.dark, x, 0.75, z + side * 0.2))
				const screen = k.box(0.34, 0.22, 0.012, k.dark, x, 0.765, z + side * 0.33)
				screen.rotation.x = side * 0.25
				g.add(screen)
			}
		}
		const l = k.lantern(0.45, 4.2)
		l.position.set(-0.6, 0, z)
		g.add(l)
	}
	// a pinboard of plans, and a sofa corner for the calls
	g.add(k.box(0.06, 1.3, 2.2, k.counter, -5, 0.9, 0, 0))
	g.add(k.box(0.08, 0.9, 0.08, k.dark, -5, 0, -0.9))
	g.add(k.box(0.08, 0.9, 0.08, k.dark, -5, 0, 0.9))
	const r = seeded(seed)
	for (let i = 0; i < 7; i++) g.add(k.box(0.02, 0.22, 0.3, glaze[i % glaze.length]!, -4.96, 1.05 + r() * 0.9, -0.9 + r() * 1.8))
	const s = k.sofa(2.4)
	s.position.set(4.3, 0, 2.6)
	s.rotation.y = Math.PI
	g.add(s)
	cs.push({ x: 4.3, z: 2.6, r: 1.3 }, { x: -5, z: 0, r: 0.6 })
	return { group: g, colliders: cs }
}

function woodshop(k: Kit): Space {
	const g = new THREE.Group()
	const cs: Collider[] = []
	for (const [x, z] of [[-3.2, -1.2], [0, -1.2], [3.2, -1.2]] as const) {
		g.add(k.box(2.2, 0.1, 0.9, k.oak, x, 0.82, z))
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(k.box(0.1, 0.82, 0.1, k.oak, x + sx * 0.95, 0, z + sz * 0.35))
		g.add(k.box(2, 0.04, 0.7, k.oak, x, 0.2, z))
		g.add(k.box(0.25, 0.14, 0.2, k.steel, x + 0.9, 0.92, z - 0.45))
		g.add(k.box(0.6, 0.05, 0.14, k.oak, x - 0.3, 0.92, z + 0.1, 0.4))
		cs.push({ x, z, r: 1.2 })
	}
	// the saw
	g.add(k.box(0.9, 0.84, 0.8, k.dark, 5, 0, 1))
	g.add(k.box(1.3, 0.04, 1.1, k.steel, 5, 0.84, 1))
	const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 20), k.steel)
	blade.rotation.z = Math.PI / 2
	blade.position.set(5, 0.88, 1)
	g.add(blade)
	cs.push({ x: 5, z: 1, r: 0.8 })
	// the timber rack along the glass, boards on its arms
	for (const x of [-4.5, -1.5, 1.5]) g.add(k.box(0.12, 2.2, 0.12, k.dark, x, 0, 3.3))
	for (let lv = 0; lv < 5; lv++)
		for (let b = 0; b < 3; b++) g.add(k.box(5.6 + b * 0.3, 0.05, 0.18, k.oak, -1.5, 0.35 + lv * 0.42 + b * 0.055, 3.15 + (b - 1) * 0.12))
	cs.push({ x: -1.5, z: 3.3, r: 0.5 }, { x: -4, z: 3.3, r: 0.5 }, { x: 1, z: 3.3, r: 0.5 })
	// sawhorses with a plank across
	for (const x of [-1.2, 1.2]) {
		g.add(k.box(0.08, 0.7, 0.8, k.oak, x, 0, 1.4))
		g.add(k.box(0.1, 0.06, 0.6, k.oak, x, 0.7, 1.4))
	}
	g.add(k.box(3.4, 0.05, 0.3, k.oak, 0, 0.76, 1.4))
	cs.push({ x: 0, z: 1.4, r: 1 })
	// the pegboard of tools
	g.add(k.box(2.6, 1.3, 0.05, k.oak, -3.5, 1, 2.2))
	const r = seeded(4)
	for (let i = 0; i < 12; i++) g.add(k.box(0.05 + r() * 0.08, 0.2 + r() * 0.3, 0.04, i % 3 ? k.steel : k.dark, -4.6 + (i % 6) * 0.42, 1.2 + Math.floor(i / 6) * 0.55, 2.16))
	return { group: g, colliders: cs }
}

function studio(k: Kit, seed: number): Space {
	const g = new THREE.Group()
	const cs: Collider[] = []
	// easels in an arc, facing the light through the glass
	for (let i = 0; i < 6; i++) {
		const x = -4.5 + i * 1.8
		const z = 0.6 + Math.abs(i - 2.5) * 0.35
		const e = new THREE.Group()
		for (const [lx, lz, rx] of [[-0.35, 0.1, 0.1], [0.35, 0.1, -0.1], [0, -0.45, 0]] as const) {
			const leg = k.box(0.05, 1.9, 0.05, k.timber, lx, 0, lz)
			leg.rotation.set(lz < 0 ? -0.22 : 0.06, 0, rx)
			e.add(leg)
		}
		const canvas = k.box(0.9, 0.68, 0.03, painting(seed + i), 0, 0.9, 0.2)
		canvas.rotation.x = -0.1
		e.add(canvas)
		e.add(k.box(0.95, 0.04, 0.12, k.timber, 0, 0.88, 0.22))
		e.position.set(x, 0, z)
		e.rotation.y = Math.PI + (i - 2.5) * 0.08
		g.add(e)
		g.add(stool(k, x, z - 1))
		cs.push({ x, z, r: 0.5 })
	}
	// the paint table, jars of colour on it
	g.add(k.box(3, 0.06, 0.9, k.oak, 0, 0.8, -2.3))
	for (const sx of [-1.4, 1.4]) g.add(k.box(0.08, 0.8, 0.8, k.oak, sx, 0, -2.3))
	for (let i = 0; i < 9; i++) {
		const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10), [...glaze, ...fruit][i % 10]!)
		jar.position.set(-1.2 + i * 0.3, 0.93, -2.3 + (i % 2) * 0.2)
		g.add(jar)
	}
	cs.push({ x: 0, z: -2.3, r: 1.5 })
	// a finished canvas on the wall, and a sculpture on its plinth
	g.add(k.box(2.4, 1.6, 0.05, painting(seed + 40), 5.2, 1.2, 3.2, Math.PI))
	g.add(k.box(0.7, 1, 0.7, k.lime, -5.4, 0, -1.8))
	const sculpt = new THREE.Mesh(new THREE.TorusKnotGeometry(0.28, 0.08, 64, 10, 2, 3), white)
	sculpt.position.set(-5.4, 1.4, -1.8)
	sculpt.castShadow = true
	g.add(sculpt)
	cs.push({ x: -5.4, z: -1.8, r: 0.6 })
	return { group: g, colliders: cs }
}

function pottery(k: Kit): Space {
	const g = new THREE.Group()
	const cs: Collider[] = []
	for (let i = 0; i < 3; i++) {
		const x = -3.5 + i * 2.3
		const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.5, 20), k.counter)
		base.position.set(x, 0.25, -0.6)
		g.add(base)
		const head = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 20), k.steel)
		head.position.set(x, 0.52, -0.6)
		g.add(head)
		const lump = pot(clay, 0.3, 90 + i)
		lump.position.set(x, 0.54, -0.6)
		g.add(lump)
		g.add(stool(k, x, -1.3, 0.45))
		cs.push({ x, z: -0.8, r: 0.7 })
	}
	// the kiln, of brick, with its flue
	g.add(k.box(1.5, 1.3, 1.5, brick, 4.4, 0, -0.6))
	g.add(k.box(0.3, 2.6, 0.3, brick, 4.9, 1.3, -1.1))
	g.add(k.box(0.9, 0.9, 0.04, k.dark, 4.4, 0.2, 0.16))
	cs.push({ x: 4.4, z: -0.6, r: 1.1 })
	// shelves of finished pots along the glass
	for (let lv = 0; lv < 4; lv++) {
		g.add(k.box(8, 0.04, 0.45, k.oak, -0.5, 0.3 + lv * 0.5, 3.2))
		for (let i = 0; i < 14; i++) {
			const p = pot(glaze[(i + lv) % glaze.length]!, 0.2 + ((i * 7 + lv) % 5) * 0.04, i * 11 + lv)
			p.position.set(-4.2 + i * 0.55, 0.32 + lv * 0.5, 3.2)
			g.add(p)
		}
	}
	for (const x of [-4.5, -0.5, 3.5]) g.add(k.box(0.06, 2, 0.45, k.oak, x, 0, 3.2))
	cs.push({ x: -2.5, z: 3.2, r: 0.5 }, { x: 1.5, z: 3.2, r: 0.5 })
	// the wedging table
	g.add(k.box(2, 0.85, 0.9, k.lime, -1.2, 0, 1.3))
	for (let i = 0; i < 4; i++) {
		const l = pot(clay, 0.16, 300 + i)
		l.position.set(-1.8 + i * 0.4, 0.85, 1.3)
		g.add(l)
	}
	cs.push({ x: -1.2, z: 1.3, r: 1.1 })
	return { group: g, colliders: cs }
}

/** The bread oven, a clay dome on a stone plinth — for the bakery inside and the pizza square outside. */
function oven(k: Kit, x: number, z: number, rot = 0): THREE.Group {
	const g = new THREE.Group()
	g.add(k.box(2.4, 0.9, 2.2, k.lime))
	const d = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), clay)
	d.position.y = 0.9
	d.scale.set(1, 0.85, 1)
	d.castShadow = true
	g.add(d)
	const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16, 0, Math.PI), k.dark)
	mouth.position.set(0, 0.92, 0.98)
	g.add(mouth)
	g.add(k.box(0.22, 1.2, 0.22, brick, 0, 1.5, -0.5))
	// firewood under the plinth's lip
	for (let i = 0; i < 8; i++) {
		const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), k.timber)
		log.rotation.z = Math.PI / 2
		log.position.set(1.6, 0.08 + Math.floor(i / 4) * 0.14, -0.5 + (i % 4) * 0.15)
		g.add(log)
	}
	g.position.set(x, 0, z)
	g.rotation.y = rot
	return g
}

function bakery(k: Kit): Space {
	const g = new THREE.Group()
	const cs: Collider[] = []
	g.add(oven(k, -3.8, 2.2, Math.PI))
	cs.push({ x: -3.8, z: 2.2, r: 1.5 })
	// two islands to cook at, pans on the hobs
	for (const x of [-0.4, 3.2]) {
		g.add(k.box(2.6, 0.9, 1.1, k.oak, x, 0, 0.6))
		g.add(k.box(2.7, 0.05, 1.2, k.counter, x, 0.9, 0.6))
		for (const hx of [-0.6, 0.6]) {
			g.add(k.box(0.55, 0.02, 0.55, k.dark, x + hx, 0.95, 0.6))
			const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.12, 16), k.steel)
			pan.position.set(x + hx, 1.03, 0.6)
			g.add(pan)
		}
		// bread and fruit set out
		for (let i = 0; i < 4; i++) {
			const loaf = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), clay)
			loaf.scale.set(1.4, 0.7, 1)
			loaf.position.set(x - 1 + i * 0.25, 0.99, 0.95)
			g.add(loaf)
		}
		cs.push({ x: x - 0.7, z: 0.6, r: 1 }, { x: x + 0.7, z: 0.6, r: 1 })
	}
	// herbs drying from a rail
	g.add(k.box(6, 0.05, 0.05, k.timber, 1.4, 2.6, 0.6))
	for (let i = 0; i < 14; i++) {
		const h = herb(700 + i, 0.2)
		h.position.set(-1.4 + i * 0.4, 2.2, 0.6)
		g.add(h)
	}
	// the long table where the class eats what it cooked
	const t = k.table(5, 10)
	t.position.set(1, 0, -2.4)
	g.add(t)
	cs.push({ x: -0.5, z: -2.4, r: 1.3 }, { x: 2.5, z: -2.4, r: 1.3 })
	return { group: g, colliders: cs }
}

function library(k: Kit, seed: number): Space {
	const g = new THREE.Group()
	const cs: Collider[] = []
	const r = seeded(seed)
	const spines = [...glaze, ...awnings, k.linen]
	for (const x of [-4, -1.3, 1.4, 4.1]) {
		g.add(k.box(2.5, 2.2, 0.4, k.oak, x, 0, 3.3))
		for (let lv = 0; lv < 5; lv++) {
			let bx = x - 1.15
			while (bx < x + 1.1) {
				const w = 0.04 + r() * 0.05
				const h = 0.26 + r() * 0.12
				g.add(k.box(w, h, 0.26, spines[Math.floor(r() * spines.length)]!, bx + w / 2, 0.08 + lv * 0.43, 3.15))
				bx += w + 0.005
			}
		}
		cs.push({ x, z: 3.3, r: 1.2 })
	}
	const rug = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), k.rug)
	rug.rotation.x = -Math.PI / 2
	rug.position.set(0, 0.03, 0)
	g.add(rug)
	for (const [x, z, rot] of [[-1.8, -0.6, 0.5], [1.8, -0.6, -0.5], [0, 1.4, Math.PI]] as const) {
		const s = k.sofa(1.9)
		s.position.set(x, 0, z)
		s.rotation.y = rot
		g.add(s)
		cs.push({ x, z, r: 1.1 })
	}
	g.add(k.box(1, 0.4, 0.6, k.oak, 0, 0, -0.1))
	const l = k.lantern(0.6, 4)
	g.add(l)
	return { group: g, colliders: cs }
}

function repair(k: Kit): Space {
	const g = new THREE.Group()
	const cs: Collider[] = []
	// a long bench along the glass, devices opened up on it
	g.add(k.box(9, 0.05, 0.9, k.oak, 0, 0.9, 2.8))
	for (const x of [-4.3, -1.5, 1.5, 4.3]) g.add(k.box(0.08, 0.9, 0.8, k.dark, x, 0, 2.8))
	const r = seeded(8)
	for (let i = 0; i < 10; i++) {
		const w = 0.2 + r() * 0.3
		g.add(k.box(w, 0.08 + r() * 0.15, 0.2 + r() * 0.2, i % 2 ? k.dark : k.counter, -4 + i * 0.85, 0.95, 2.7))
		if (i % 3 === 0) g.add(stool(k, -4 + i * 0.85, 1.9))
	}
	cs.push({ x: -3, z: 2.8, r: 1 }, { x: 0, z: 2.8, r: 1 }, { x: 3, z: 2.8, r: 1 })
	// a bicycle on its stand
	const bike = new THREE.Group()
	for (const x of [-0.55, 0.55]) {
		const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 28), k.dark)
		w.position.set(x, 0.6, 0)
		bike.add(w)
	}
	for (const [x, y, len, rot] of [[-0.25, 0.8, 0.8, 0.9], [0.2, 0.8, 0.8, -0.9], [0, 1.02, 0.9, Math.PI / 2]] as const) {
		const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 6), awnings[0]!)
		bar.position.set(x, y, 0)
		bar.rotation.z = rot
		bike.add(bar)
	}
	bike.add(k.box(0.06, 0.26, 0.06, k.steel, 0, 0, 0))
	bike.position.set(-2.6, 0.02, -0.4)
	g.add(bike)
	cs.push({ x: -2.6, z: -0.4, r: 0.9 })
	// a table of parts, sorted in trays
	g.add(k.box(2.2, 0.8, 0.9, k.oak, 2.2, 0, -0.6))
	for (let i = 0; i < 8; i++) g.add(k.box(0.24, 0.06, 0.3, glaze[i % glaze.length]!, 1.4 + (i % 4) * 0.52, 0.8, -0.8 + Math.floor(i / 4) * 0.4))
	cs.push({ x: 2.2, z: -0.6, r: 1.2 })
	return { group: g, colliders: cs }
}

/**
 * The workshops round the master dome's ground floor, between its doors, its
 * stair, its kitchen and its aquaponics.
 */
export function workshops(k: Kit, rr: number): Space[] {
	const at: [number, (k: Kit) => Space][] = [
		[0.36, (k) => cowork(k, 1)],
		[1.2, woodshop],
		[1.95, (k) => studio(k, 10)],
		[2.55, pottery],
		[2.92, (k) => library(k, 5)],
		[3.52, bakery],
		[4.36, (k) => studio(k, 30)],
		[5.1, repair],
		[5.93, (k) => cowork(k, 2)]
	]
	return at.map(([a, make]) => place(make(k), rr, a))
}

/* ── outside: the café squares round the master dome ───────────────────── */

function parasol(k: Kit, x: number, z: number, mat: THREE.Material): THREE.Group {
	const g = new THREE.Group()
	g.add(k.box(0.05, 2.4, 0.05, k.dark, x, 0, z))
	const top = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.45, 8, 1, true), mat)
	top.position.set(x, 2.45, z)
	top.castShadow = true
	g.add(top)
	return g
}

function bistro(k: Kit, x: number, z: number, seed: number): THREE.Group {
	const g = new THREE.Group()
	const r = seeded(seed)
	const topM = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20), k.lime)
	topM.position.set(x, 0.74, z)
	topM.castShadow = true
	g.add(topM)
	g.add(k.box(0.06, 0.74, 0.06, k.dark, x, 0, z))
	const n = 2 + Math.floor(r() * 2)
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2 + r()
		const cx = x + Math.sin(a) * 0.72, cz = z + Math.cos(a) * 0.72
		g.add(k.box(0.42, 0.45, 0.42, k.timber, cx, 0, cz, a))
		g.add(k.box(0.42, 0.45, 0.05, k.timber, cx + Math.sin(a) * 0.2, 0.45, cz + Math.cos(a) * 0.2, a))
		// a cup or a plate at each place
		const cup = new THREE.Mesh(i % 2 ? new THREE.CylinderGeometry(0.045, 0.035, 0.09, 10) : new THREE.CylinderGeometry(0.12, 0.1, 0.02, 14), white)
		cup.position.set(x + Math.sin(a) * 0.24, 0.8, z + Math.cos(a) * 0.24)
		g.add(cup)
	}
	return g
}

function kiosk(k: Kit, mat: THREE.Material): THREE.Group {
	const g = new THREE.Group()
	g.add(k.box(3.2, 2.7, 2.2, k.oak, 0, 0, -0.2))
	g.add(k.box(3.4, 0.08, 0.6, k.counter, 0, 1.05, 1))
	g.add(k.box(3.2, 1.05, 0.5, k.lime, 0, 0, 1))
	const awning = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.4), mat)
	awning.position.set(0, 2.55, 1.35)
	awning.rotation.x = -1.05
	awning.castShadow = true
	g.add(awning)
	g.add(k.box(0.5, 0.45, 0.4, k.steel, -0.8, 1.13, 0.95))
	g.add(k.box(1, 0.7, 0.05, k.dark, 0.9, 1.5, 0.92))
	return g
}

function pergola(k: Kit, w: number, d: number): THREE.Group {
	const g = new THREE.Group()
	for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) g.add(k.box(0.16, 2.9, 0.16, k.timber, (sx * w) / 2, 0, (sz * d) / 2))
	for (const sx of [-1, 1]) g.add(k.box(0.14, 0.2, d + 0.4, k.timber, (sx * w) / 2, 2.9, 0))
	for (let i = 0; i <= 6; i++) g.add(k.box(w + 0.4, 0.12, 0.1, k.timber, 0, 3.1, -d / 2 + (i * d) / 6))
	// strings of lights, sagging from beam to beam
	for (let i = 0; i <= 3; i++) {
		const z = -d / 2 + (i * d) / 3
		for (let j = 0; j <= 12; j++) {
			const t = j / 12
			const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), bulb)
			b.position.set(-w / 2 + t * w, 2.95 - Math.sin(t * Math.PI) * 0.35, z)
			g.add(b)
		}
	}
	return g
}

/** A square: its stone floor, its trade, its tables, and planters round the rim. */
function square(k: Kit, kind: number, seed: number, radius: number): Space {
	const g = new THREE.Group()
	const cs: Collider[] = []
	const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), k.stone(radius / 1.5))
	floor.rotation.x = -Math.PI / 2
	floor.position.y = 0.03
	floor.receiveShadow = true
	g.add(floor)
	const r = seeded(seed)
	const mat = awnings[seed % awnings.length]!
	if (kind === 0) {
		// the café: a kiosk at the back, bistro tables under parasols
		const kk = kiosk(k, mat)
		kk.position.z = radius - 2.2
		kk.rotation.y = Math.PI
		g.add(kk)
		cs.push({ x: 0, z: radius - 2.3, r: 1.9 })
		for (const [x, z] of [[-3.2, 1.2], [0, 0.4], [3.2, 1.2], [-2.4, -2.4], [1, -3], [3.6, -1.8]] as const) {
			g.add(bistro(k, x, z, seed * 7 + x * 3 + z))
			if (r() < 0.6) g.add(parasol(k, x, z, awnings[(seed + Math.round(x)) & 3]!))
			cs.push({ x, z, r: 0.9 })
		}
	} else if (kind === 1) {
		// the restaurant: long tables under a pergola strung with lights
		g.add(pergola(k, 7, 6))
		for (const z of [-2, 0, 2]) {
			const t = k.table(5, 10)
			t.position.set(0, 0, z * 1.1)
			g.add(t)
			for (let i = 0; i < 8; i++) {
				const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.02, 14), white)
				plate.position.set(-2 + i * 0.57, 0.79, z * 1.1 + (i % 2 ? 0.25 : -0.25))
				g.add(plate)
			}
			cs.push({ x: -1.5, z: z * 1.1, r: 1.2 }, { x: 1.5, z: z * 1.1, r: 1.2 })
		}
	} else if (kind === 2) {
		// the fruit bar: a counter of crates, stools along it
		g.add(k.box(4.5, 1.05, 0.8, k.oak, 0, 0, 1.6))
		g.add(k.box(4.7, 0.06, 1, k.counter, 0, 1.05, 1.6))
		for (let i = 0; i < 6; i++) {
			const x = -2.1 + i * 0.84
			g.add(k.box(0.7, 0.3, 0.5, k.timber, x, 0, 2.8))
			for (let f = 0; f < 6; f++) {
				const fr = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), fruit[i % fruit.length]!)
				fr.position.set(x - 0.2 + (f % 3) * 0.2, 0.36, 2.7 + Math.floor(f / 3) * 0.2)
				g.add(fr)
			}
			g.add(stool(k, x, 0.8, 0.75))
		}
		const aw = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.6), mat)
		aw.position.set(0, 2.5, 2.2)
		aw.rotation.x = -1.2
		g.add(aw)
		for (const x of [-2.5, 2.5]) g.add(k.box(0.1, 2.5, 0.1, k.timber, x, 0, 2.9))
		cs.push({ x: -1.4, z: 2, r: 1.3 }, { x: 1.4, z: 2, r: 1.3 })
		for (const [x, z] of [[-2.6, -2], [0.4, -2.8], [3, -1.4]] as const) {
			g.add(bistro(k, x, z, seed + x))
			g.add(parasol(k, x, z, awnings[(seed + 1) & 3]!))
			cs.push({ x, z, r: 0.9 })
		}
	} else {
		// the pizza square: a wood-fired oven, and tables round it
		g.add(oven(k, 0, radius - 2.4, Math.PI))
		cs.push({ x: 0, z: radius - 2.4, r: 1.6 })
		for (const [x, z, rot] of [[-3, 0, 0.5], [3, 0, -0.5], [0, -2.8, 0]] as const) {
			const t = k.table(2.6, 6)
			t.position.set(x, 0, z)
			t.rotation.y = Math.PI / 2 + rot
			g.add(t)
			cs.push({ x, z, r: 1.4 })
		}
	}
	// planters round the rim, leaving the side toward the dome open
	for (let i = 0; i < 7; i++) {
		const a = Math.PI * 0.35 + (i / 6) * Math.PI * 1.3
		const x = Math.sin(a) * (radius - 0.5), z = Math.cos(a) * (radius - 0.5)
		const p = pot(k.lime, 0.55, seed * 13 + i)
		p.position.set(x, 0, z)
		g.add(p)
		const pl = i % 2 ? shrub(seed * 17 + i, 1).object : berryBush(seed * 19 + i, 0.8).object
		pl.position.set(x, 0.5, z)
		g.add(pl)
	}
	return { group: g, colliders: cs }
}

/** The café squares on the ring outside the master dome. The side of each toward the dome is `-z`. */
export function squaresAround(): { a: number; radius: number }[] {
	const out: { a: number; radius: number }[] = []
	for (let q = 0; q < 4; q++) for (const off of [-0.42, 0, 0.42]) out.push({ a: Math.PI / 4 + (q * Math.PI) / 2 + off, radius: 6.5 })
	return out
}

export function cafes(k: Kit, rr: number): Space[] {
	return squaresAround().map(({ a, radius }, i) => {
		const s = square(k, i % 4, 50 + i, radius)
		return place(s, rr, a)
	})
}

/* ── outside: the hens ─────────────────────────────────────────────────── */

const feathers = ['#f4efe4', '#b8703a', '#3b3430', '#d9a066'].map((c) => col(c, 0.9))
const comb = col('#c7362c', 0.6)
const beak = col('#e2a93b', 0.6)

/** A hen, pecking or looking about. */
function hen(x: number, z: number, seed: number): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	const coat = feathers[Math.floor(r() * feathers.length)]!
	const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), coat)
	body.scale.set(0.8, 0.85, 1.25)
	body.position.y = 0.24
	g.add(body)
	const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 6), coat)
	tail.position.set(0, 0.36, -0.2)
	tail.rotation.x = -0.7
	g.add(tail)
	const peck = r() < 0.4
	const head = new THREE.Group()
	const skull = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), coat)
	head.add(skull)
	const bill = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 5), beak)
	bill.rotation.x = Math.PI / 2
	bill.position.z = 0.09
	head.add(bill)
	const c = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.08), comb)
	c.position.set(0, 0.07, 0.01)
	head.add(c)
	head.position.set(0, peck ? 0.14 : 0.42, peck ? 0.26 : 0.18)
	head.rotation.x = peck ? 0.9 : 0
	g.add(head)
	for (const side of [-1, 1]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), beak).translateX(side * 0.05).translateY(0.06))
	g.position.set(x, 0, z)
	g.rotation.y = r() * Math.PI * 2
	g.traverse((o) => (o.castShadow = true))
	return g
}

/** A coop: a timber henhouse on legs, a ramp down, a fenced run, and hens in and out of it. */
function coop(k: Kit, seed: number): Space {
	const g = new THREE.Group()
	const r = seeded(seed)
	const roofMat = awnings[seed % 2 ? 0 : 1]!
	// the house, up on legs so the hens can shelter under it
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(k.box(0.1, 0.6, 0.1, k.timber, sx * 0.85, 0, -1.2 + sz * 0.6))
	g.add(k.box(1.9, 1, 1.4, k.oak, 0, 0.6, -1.2))
	for (const side of [-1, 1]) {
		const roof = k.box(2.2, 0.06, 1, roofMat, 0, 0, 0)
		roof.position.set(0, 1.85, -1.2 + side * 0.38)
		roof.rotation.x = side * 0.6
		g.add(roof)
	}
	g.add(k.box(0.35, 0.4, 0.04, k.dark, 0.4, 0.75, -0.48))
	// nesting boxes on the side, and the ramp down to the run
	g.add(k.box(0.5, 0.45, 1.1, k.oak, 1.2, 0.8, -1.2))
	const ramp = k.box(0.35, 0.03, 1, k.timber, 0.4, 0, 0)
	ramp.position.set(0.4, 0.38, -0.05)
	ramp.rotation.x = 0.62
	g.add(ramp)
	// the run: posts, a top rail, and wire mesh you can see the hens through
	const mesh = new THREE.MeshStandardMaterial({ color: '#c9ccc4', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6 })
	const w = 5, d = 4
	for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]] as const) g.add(k.box(0.08, 1.2, 0.08, k.timber, x, 0, z))
	for (const [x, z, len, rot] of [[0, d / 2, w, 0], [-w / 2, 0, d, Math.PI / 2], [w / 2, 0, d, Math.PI / 2]] as const) {
		g.add(k.box(len, 0.06, 0.06, k.timber, x, 1.2, z, rot))
		const net = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2), mesh)
		net.position.set(x, 0.6, z)
		net.rotation.y = rot
		g.add(net)
	}
	// straw on the ground of the run, a water trough, and the hens
	const straw = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), col('#d8c38a', 1))
	straw.rotation.x = -Math.PI / 2
	straw.position.y = 0.035
	g.add(straw)
	g.add(k.box(0.8, 0.15, 0.25, k.steel, -1.6, 0, 1.4))
	for (let i = 0; i < 7; i++) g.add(hen(-2 + r() * 4, -0.2 + r() * 1.9, seed * 31 + i))
	// and a few out foraging under the trees, as hens in a food forest do
	for (let i = 0; i < 5; i++) {
		const a = r() * Math.PI * 2, dd = 3.5 + r() * 3
		g.add(hen(Math.sin(a) * dd, Math.cos(a) * dd, seed * 37 + i))
	}
	return { group: g, colliders: [{ x: 0, z: -1.2, r: 1.3 }, { x: -1.3, z: 0.8, r: 1.3 }, { x: 1.3, z: 0.8, r: 1.3 }] }
}

/** The coops, in the forest just beyond the squares, between them. */
export function coopsAround(squareR: number): { a: number; r: number; radius: number }[] {
	const out: { a: number; r: number; radius: number }[] = []
	for (let q = 0; q < 4; q++) for (const off of [-0.21, 0.21]) out.push({ a: Math.PI / 4 + (q * Math.PI) / 2 + off, r: squareR + 5, radius: 4 })
	return out
}

export function coops(k: Kit, squareR: number): Space[] {
	return coopsAround(squareR).map(({ a, r }, i) => place(coop(k, 3 + i), r, a))
}
