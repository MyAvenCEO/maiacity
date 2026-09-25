/**
 * The food forest under the glass: mango, avocado and citrus trees with their
 * fruit hanging in them, coconut palms, bananas, an understorey of shrubs and
 * beds of herbs. Geometry and materials are shared between every plant of a
 * kind, so a dome can hold a hundred trees and stay light.
 */
import * as THREE from 'three'
import { bark, frond, leaves } from './textures'

type Rand = () => number

export function seeded(seed: number): Rand {
	let s = seed >>> 0 || 1
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

const shared = <T,>(make: () => T) => {
	let v: T | undefined
	return () => (v ??= make())
}

const barkMat = shared(() => new THREE.MeshStandardMaterial({ map: bark(), roughness: 0.95 }))
const leafMat = shared(() => new THREE.MeshStandardMaterial({ map: leaves('broad'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6 }))
const fineLeafMat = shared(() => new THREE.MeshStandardMaterial({ map: leaves('fine'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 }))
const frondMat = shared(() => new THREE.MeshStandardMaterial({ map: frond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 }))
const bananaStemMat = shared(() => new THREE.MeshStandardMaterial({ color: '#6f8a3f', roughness: 0.7 }))
const bananaLeafMat = shared(() => new THREE.MeshStandardMaterial({ color: '#5d9a3c', side: THREE.DoubleSide, roughness: 0.55 }))
const card = shared(() => new THREE.PlaneGeometry(1, 1))
const trunkGeo = shared(() => new THREE.CylinderGeometry(0.7, 1, 1, 8, 1).translate(0, 0.5, 0))
const sphere = shared(() => new THREE.SphereGeometry(1, 10, 8))

const fruit = {
	mango: shared(() => new THREE.MeshStandardMaterial({ color: '#e7a13a', roughness: 0.45 })),
	mangoRipe: shared(() => new THREE.MeshStandardMaterial({ color: '#d9622f', roughness: 0.45 })),
	avocado: shared(() => new THREE.MeshStandardMaterial({ color: '#3c5a22', roughness: 0.7 })),
	orange: shared(() => new THREE.MeshStandardMaterial({ color: '#f39c1f', roughness: 0.5 })),
	lemon: shared(() => new THREE.MeshStandardMaterial({ color: '#f2d43d', roughness: 0.5 })),
	coconut: shared(() => new THREE.MeshStandardMaterial({ color: '#6b4a2a', roughness: 0.85 })),
	banana: shared(() => new THREE.MeshStandardMaterial({ color: '#b8c34a', roughness: 0.6 }))
}

/** A canopy of crossed leaf cards filling an ellipsoid. */
function canopy(group: THREE.Group, r: Rand, cx: number, cy: number, cz: number, rx: number, ry: number, cards: number, mat: THREE.Material, cardSize: number) {
	for (let i = 0; i < cards; i++) {
		const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1), d = Math.cbrt(r())
		const m = new THREE.Mesh(card(), mat)
		m.position.set(cx + Math.sin(v) * Math.cos(u) * rx * d, cy + Math.cos(v) * ry * d, cz + Math.sin(v) * Math.sin(u) * rx * d)
		m.rotation.set(r() * Math.PI, r() * Math.PI, r() * Math.PI)
		m.scale.setScalar(cardSize * (0.8 + r() * 0.5))
		m.castShadow = true
		group.add(m)
	}
}

function hang(group: THREE.Group, r: Rand, cy: number, rx: number, ry: number, n: number, mat: THREE.Material, size: [number, number, number]) {
	for (let i = 0; i < n; i++) {
		const a = r() * Math.PI * 2, d = 0.55 + r() * 0.45
		const m = new THREE.Mesh(sphere(), mat)
		m.position.set(Math.cos(a) * rx * d, cy - ry * (0.2 + r() * 0.5), Math.sin(a) * rx * d)
		m.scale.set(...size)
		m.castShadow = true
		group.add(m)
	}
}

function trunk(group: THREE.Group, height: number, radius: number, lean = 0) {
	const t = new THREE.Mesh(trunkGeo(), barkMat())
	t.scale.set(radius, height, radius)
	t.rotation.z = lean
	t.castShadow = true
	group.add(t)
}

export type Plant = { object: THREE.Group; radius: number }

/** A broad fruit tree: mango, avocado or citrus. `scale` 1 is a mature tree of about six metres. */
export function fruitTree(kind: 'mango' | 'avocado' | 'citrus', seed: number, scale = 1): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	const h = (kind === 'citrus' ? 2.2 : 3.2) * scale
	const crown = (kind === 'citrus' ? 1.6 : kind === 'mango' ? 2.8 : 2.4) * scale
	trunk(g, h, 0.16 * scale + 0.05, (r() - 0.5) * 0.12)
	// a few limbs reaching into the crown
	for (let i = 0; i < 3; i++) {
		const limb = new THREE.Mesh(trunkGeo(), barkMat())
		limb.scale.set(0.07 * scale, crown * 0.8, 0.07 * scale)
		limb.position.y = h * 0.85
		limb.rotation.set((r() - 0.5) * 1.2, r() * Math.PI, (r() - 0.5) * 1.2)
		g.add(limb)
	}
	canopy(g, r, 0, h + crown * 0.55, 0, crown, crown * 0.75, Math.round(60 * scale + 30), kind === 'citrus' ? fineLeafMat() : leafMat(), 1.3 * scale)
	if (kind === 'mango') {
		hang(g, r, h + crown * 0.35, crown * 0.9, crown * 0.5, 14, fruit.mango(), [0.05, 0.075, 0.045])
		hang(g, r, h + crown * 0.35, crown * 0.9, crown * 0.5, 8, fruit.mangoRipe(), [0.05, 0.075, 0.045])
	} else if (kind === 'avocado') hang(g, r, h + crown * 0.35, crown * 0.9, crown * 0.5, 16, fruit.avocado(), [0.06, 0.09, 0.06])
	else {
		hang(g, r, h + crown * 0.3, crown * 0.95, crown * 0.6, 18, fruit.orange(), [0.06, 0.06, 0.06])
		hang(g, r, h + crown * 0.3, crown * 0.95, crown * 0.6, 6, fruit.lemon(), [0.05, 0.065, 0.05])
	}
	return { object: g, radius: 0.35 * scale }
}

/** A coconut palm: a curving ringed trunk, a crown of fronds, and coconuts under it. */
export function coconutPalm(seed: number, height = 8): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	const segments = 10
	const bend = (r() - 0.5) * 0.9
	let x = 0, y = 0
	for (let i = 0; i < segments; i++) {
		const seg = new THREE.Mesh(trunkGeo(), barkMat())
		const len = height / segments
		seg.scale.set(0.2 - i * 0.006, len * 1.02, 0.2 - i * 0.006)
		seg.position.set(x, y, 0)
		const tilt = bend * (i / segments) * 0.5
		seg.rotation.z = -tilt
		seg.castShadow = true
		g.add(seg)
		x += Math.sin(tilt) * len
		y += Math.cos(tilt) * len
	}
	const crown = new THREE.Group()
	crown.position.set(x, y, 0)
	const fronds = 12
	for (let i = 0; i < fronds; i++) {
		const geo = new THREE.PlaneGeometry(4.2, 1.1, 8, 1)
		// droop each frond downward along its length
		const p = geo.attributes.position!
		for (let v = 0; v < p.count; v++) {
			const fx = p.getX(v) + 2.1
			p.setX(v, fx)
			p.setY(v, p.getY(v) - (fx * fx) * 0.08)
		}
		geo.computeVertexNormals()
		const f = new THREE.Mesh(geo, frondMat())
		f.rotation.set(-Math.PI / 2 + 0.35, (i / fronds) * Math.PI * 2 + r() * 0.2, 0, 'YXZ')
		f.castShadow = true
		crown.add(f)
	}
	for (let i = 0; i < 6; i++) {
		const c = new THREE.Mesh(sphere(), fruit.coconut())
		const a = r() * Math.PI * 2
		c.position.set(Math.cos(a) * 0.25, -0.2 - r() * 0.2, Math.sin(a) * 0.25)
		c.scale.setScalar(0.14)
		crown.add(c)
	}
	g.add(crown)
	return { object: g, radius: 0.3 }
}

/** A banana plant: a green pseudostem, huge paddle leaves, and a hanging bunch. */
export function banana(seed: number, height = 3.2): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	const stem = new THREE.Mesh(trunkGeo(), bananaStemMat())
	stem.scale.set(0.16, height, 0.16)
	g.add(stem)
	const leaf = new THREE.Shape()
	leaf.moveTo(0, 0)
	leaf.quadraticCurveTo(0.35, 0.9, 0, 2.2)
	leaf.quadraticCurveTo(-0.35, 0.9, 0, 0)
	const leafGeo = new THREE.ShapeGeometry(leaf, 8)
	for (let i = 0; i < 9; i++) {
		const l = new THREE.Mesh(leafGeo, bananaLeafMat())
		l.position.y = height * (0.85 + r() * 0.15)
		l.rotation.set(-0.5 - r() * 0.8, (i / 9) * Math.PI * 2, 0, 'YXZ')
		l.scale.setScalar(0.9 + r() * 0.4)
		l.castShadow = true
		g.add(l)
	}
	const bunch = new THREE.Group()
	bunch.position.set(0.25, height * 0.7, 0)
	for (let i = 0; i < 14; i++) {
		const b = new THREE.Mesh(sphere(), fruit.banana())
		b.position.set(Math.cos(i) * 0.1, -i * 0.04, Math.sin(i) * 0.1)
		b.scale.set(0.03, 0.09, 0.03)
		bunch.add(b)
	}
	g.add(bunch)
	return { object: g, radius: 0.25 }
}

/** An understorey shrub — coffee, cacao, berries — about a metre high. */
export function shrub(seed: number, size = 1): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	canopy(g, r, 0, 0.55 * size, 0, 0.6 * size, 0.5 * size, 18, r() < 0.5 ? leafMat() : fineLeafMat(), 0.6 * size)
	if (r() < 0.5) hang(g, r, 0.6 * size, 0.5 * size, 0.3, 10, r() < 0.5 ? fruit.orange() : fruit.mangoRipe(), [0.03, 0.03, 0.03])
	return { object: g, radius: 0 }
}

/** A tuft of herbs or lettuce for the beds and the aquaponics troughs. */
export function herb(seed: number, size = 0.3): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	canopy(g, r, 0, size * 0.5, 0, size, size * 0.6, 7, fineLeafMat(), size * 0.9)
	return g
}

/* ── the seven layers of a food forest, for the land outside the domes ──
   canopy (chestnut, walnut) · low trees (apple, mango, citrus) · shrubs
   (berries) · herbaceous (comfrey, herbs) · ground cover (clover) · roots
   (squash and pumpkins sprawling over the ground) · climbers (grapes on
   poles). Everything shares materials, and the caller bakes it. */

const more = {
	apple: shared(() => new THREE.MeshStandardMaterial({ color: '#c23b2a', roughness: 0.5 })),
	nut: shared(() => new THREE.MeshStandardMaterial({ color: '#7b5a2e', roughness: 0.8 })),
	berry: shared(() => new THREE.MeshStandardMaterial({ color: '#5b1f3d', roughness: 0.5 })),
	redBerry: shared(() => new THREE.MeshStandardMaterial({ color: '#c8283a', roughness: 0.5 })),
	flower: shared(() => new THREE.MeshStandardMaterial({ color: '#9b7fd1', roughness: 0.7 })),
	clover: shared(() => new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.8 })),
	pumpkin: shared(() => new THREE.MeshStandardMaterial({ color: '#e0821f', roughness: 0.6 })),
	grape: shared(() => new THREE.MeshStandardMaterial({ color: '#4a2a5e', roughness: 0.4 })),
	pole: shared(() => new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.9 })),
	bigLeaf: shared(() => new THREE.MeshStandardMaterial({ color: '#4f8a38', roughness: 0.6, side: THREE.DoubleSide }))
}

/** Layer 1 — a tall canopy tree, twelve metres or more: chestnut or walnut. */
export function canopyTree(seed: number, scale = 1): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	const h = 5.5 * scale
	const crown = 4.2 * scale
	trunk(g, h, 0.32 * scale, (r() - 0.5) * 0.06)
	for (let i = 0; i < 5; i++) {
		const limb = new THREE.Mesh(trunkGeo(), barkMat())
		limb.scale.set(0.12 * scale, crown, 0.12 * scale)
		limb.position.y = h * 0.8
		limb.rotation.set((r() - 0.5) * 1.4, r() * Math.PI, (r() - 0.5) * 1.4)
		g.add(limb)
	}
	canopy(g, r, 0, h + crown * 0.6, 0, crown * 1.1, crown * 0.8, Math.round(120 * scale), leafMat(), 1.7 * scale)
	hang(g, r, h + crown * 0.5, crown, crown * 0.5, 10, more.nut(), [0.05, 0.05, 0.05])
	return { object: g, radius: 0.5 * scale }
}

/** Layer 2 — an apple tree among the low fruit trees. */
export function appleTree(seed: number, scale = 1): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	const h = 1.9 * scale
	const crown = 2 * scale
	trunk(g, h, 0.15 * scale, (r() - 0.5) * 0.15)
	canopy(g, r, 0, h + crown * 0.5, 0, crown, crown * 0.7, Math.round(55 * scale), fineLeafMat(), 1.1 * scale)
	hang(g, r, h + crown * 0.35, crown * 0.95, crown * 0.5, 22, more.apple(), [0.06, 0.06, 0.06])
	return { object: g, radius: 0.3 * scale }
}

/** Layer 3 — a berry bush: currants, blueberries, raspberries. */
export function berryBush(seed: number, size = 1): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	canopy(g, r, 0, 0.6 * size, 0, 0.7 * size, 0.55 * size, 22, fineLeafMat(), 0.55 * size)
	hang(g, r, 0.7 * size, 0.6 * size, 0.4, 24, r() < 0.5 ? more.berry() : more.redBerry(), [0.025, 0.025, 0.025])
	return { object: g, radius: 0 }
}

/** Layer 4 — herbaceous: comfrey and tall herbs, some in flower. */
export function comfrey(seed: number, size = 0.7): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	canopy(g, r, 0, size * 0.5, 0, size * 0.6, size * 0.5, 10, leafMat(), size * 0.8)
	for (let i = 0; i < 5; i++) {
		const f = new THREE.Mesh(sphere(), more.flower())
		f.position.set((r() - 0.5) * size, size * (0.9 + r() * 0.3), (r() - 0.5) * size)
		f.scale.setScalar(0.04)
		g.add(f)
	}
	return g
}

/** Layer 5 — ground cover: a low carpet of clover, white flowers in it. */
export function clover(seed: number, size = 1.2): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	for (let i = 0; i < 12; i++) {
		const c = new THREE.Mesh(card(), fineLeafMat())
		c.rotation.set(-Math.PI / 2 + (r() - 0.5) * 0.5, 0, r() * 6.28)
		c.position.set((r() - 0.5) * size, 0.05 + r() * 0.05, (r() - 0.5) * size)
		c.scale.setScalar(0.45)
		g.add(c)
	}
	for (let i = 0; i < 6; i++) {
		const f = new THREE.Mesh(sphere(), more.clover())
		f.position.set((r() - 0.5) * size, 0.12, (r() - 0.5) * size)
		f.scale.setScalar(0.025)
		g.add(f)
	}
	return g
}

/** Layer 6 — the root and sprawl layer: squash and pumpkins, broad leaves on the ground. */
export function squash(seed: number): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	const leaf = new THREE.CircleGeometry(0.28, 7)
	for (let i = 0; i < 9; i++) {
		const l = new THREE.Mesh(leaf, more.bigLeaf())
		const a = r() * 6.28, d = r() * 1.1
		l.position.set(Math.cos(a) * d, 0.18 + r() * 0.12, Math.sin(a) * d)
		l.rotation.set(-Math.PI / 2 + (r() - 0.5) * 0.8, 0, r() * 6)
		g.add(l)
	}
	for (let i = 0; i < 2 + Math.floor(r() * 2); i++) {
		const p = new THREE.Mesh(sphere(), more.pumpkin())
		const a = r() * 6.28, d = r() * 0.9
		p.position.set(Math.cos(a) * d, 0.14, Math.sin(a) * d)
		p.scale.set(0.2, 0.15, 0.2)
		g.add(p)
	}
	return g
}

/** Layer 7 — climbers: a grape vine up a timber pole, clusters hanging from it. */
export function climber(seed: number, height = 2.4): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	const pole = new THREE.Mesh(trunkGeo(), more.pole())
	pole.scale.set(0.05, height, 0.05)
	g.add(pole)
	for (let i = 0; i < 26; i++) {
		const t = i / 26
		const c = new THREE.Mesh(card(), leafMat())
		c.position.set(Math.cos(t * 18) * 0.18, t * height, Math.sin(t * 18) * 0.18)
		c.rotation.set(r() * 3, r() * 3, r() * 3)
		c.scale.setScalar(0.45)
		g.add(c)
	}
	for (let k = 0; k < 4; k++) {
		const cluster = new THREE.Group()
		const a = r() * 6.28
		cluster.position.set(Math.cos(a) * 0.22, height * (0.4 + r() * 0.4), Math.sin(a) * 0.22)
		for (let i = 0; i < 12; i++) {
			const b = new THREE.Mesh(sphere(), more.grape())
			b.position.set((r() - 0.5) * 0.08, -i * 0.012, (r() - 0.5) * 0.08)
			b.scale.setScalar(0.022)
			cluster.add(b)
		}
		g.add(cluster)
	}
	return { object: g, radius: 0.15 }
}

/* ── more of the forest under the glass: papaya, fig and pomegranate among the
   low trees, coffee and cacao in the shrub layer, ginger and turmeric at the
   roots, strawberries for ground cover, passion fruit climbing ─────────── */

const garden = {
	papaya: shared(() => new THREE.MeshStandardMaterial({ color: '#e9a23b', roughness: 0.5 })),
	papayaGreen: shared(() => new THREE.MeshStandardMaterial({ color: '#7fa13a', roughness: 0.5 })),
	fig: shared(() => new THREE.MeshStandardMaterial({ color: '#5a2d4a', roughness: 0.6 })),
	pomegranate: shared(() => new THREE.MeshStandardMaterial({ color: '#b3242e', roughness: 0.45 })),
	cacao: shared(() => new THREE.MeshStandardMaterial({ color: '#c7812e', roughness: 0.6 })),
	passion: shared(() => new THREE.MeshStandardMaterial({ color: '#4b2551', roughness: 0.5 })),
	strawberry: shared(() => new THREE.MeshStandardMaterial({ color: '#d8253a', roughness: 0.45 })),
	lettuce: shared(() => new THREE.MeshStandardMaterial({ color: '#9ccc5a', roughness: 0.7, side: THREE.DoubleSide })),
	lettuceRed: shared(() => new THREE.MeshStandardMaterial({ color: '#8a3f4a', roughness: 0.7, side: THREE.DoubleSide })),
	tomato: shared(() => new THREE.MeshStandardMaterial({ color: '#d93a26', roughness: 0.35 })),
	cucumber: shared(() => new THREE.MeshStandardMaterial({ color: '#3f6b2a', roughness: 0.5 })),
	pepperRed: shared(() => new THREE.MeshStandardMaterial({ color: '#c8221c', roughness: 0.3 })),
	pepperYellow: shared(() => new THREE.MeshStandardMaterial({ color: '#f0c22b', roughness: 0.3 })),
	aubergine: shared(() => new THREE.MeshStandardMaterial({ color: '#3a1d3f', roughness: 0.25 })),
	bean: shared(() => new THREE.MeshStandardMaterial({ color: '#6c9a35', roughness: 0.5 })),
	chard: [shared(() => new THREE.MeshStandardMaterial({ color: '#c8323f', roughness: 0.6 })), shared(() => new THREE.MeshStandardMaterial({ color: '#e7b830', roughness: 0.6 })), shared(() => new THREE.MeshStandardMaterial({ color: '#f1ecd9', roughness: 0.6 }))],
	chardLeaf: shared(() => new THREE.MeshStandardMaterial({ color: '#2f5a2a', roughness: 0.6, side: THREE.DoubleSide })),
	stake: shared(() => new THREE.MeshStandardMaterial({ color: '#b89a64', roughness: 0.9 })),
	net: shared(() => new THREE.MeshStandardMaterial({ color: '#e8e2d0', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })),
	olive: shared(() => new THREE.MeshStandardMaterial({ map: leaves('fine'), color: '#c9d3b4', alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 })),
	oliveFruit: shared(() => new THREE.MeshStandardMaterial({ color: '#3c3a22', roughness: 0.4 })),
	lavender: shared(() => new THREE.MeshStandardMaterial({ color: '#8f74c9', roughness: 0.8 })),
	sage: shared(() => new THREE.MeshStandardMaterial({ color: '#7d9170', roughness: 0.8 })),
	terracotta: shared(() => new THREE.MeshStandardMaterial({ color: '#c0663f', roughness: 0.9 }))
}
/** A low-poly ball for the small fruit, so a garden of them stays light once baked. */
const small = shared(() => new THREE.IcosahedronGeometry(1, 1))
const stickGeo = shared(() => new THREE.CylinderGeometry(1, 1, 1, 5).translate(0, 0.5, 0))
const stick = (mat: THREE.Material, x: number, z: number, h: number, r = 0.02) => {
	const m = new THREE.Mesh(stickGeo(), mat)
	m.scale.set(r, h, r)
	m.position.set(x, 0, z)
	return m
}

/** A small fruit tree, three or four metres: fig or pomegranate. */
export function smallFruitTree(kind: 'fig' | 'pomegranate', seed: number, scale = 1): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	const h = 1.6 * scale
	const crown = 1.8 * scale
	trunk(g, h, 0.13 * scale, (r() - 0.5) * 0.2)
	canopy(g, r, 0, h + crown * 0.5, 0, crown, crown * 0.7, Math.round(45 * scale), kind === 'fig' ? leafMat() : fineLeafMat(), 1.1 * scale)
	hang(g, r, h + crown * 0.35, crown * 0.9, crown * 0.5, 18, kind === 'fig' ? garden.fig() : garden.pomegranate(), kind === 'fig' ? [0.045, 0.055, 0.045] : [0.07, 0.07, 0.07])
	return { object: g, radius: 0.3 * scale }
}

/** A papaya: a bare stem, an umbrella of big leaves, fruit clustered under it. */
export function papaya(seed: number, height = 4): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	const stem = new THREE.Mesh(trunkGeo(), bananaStemMat())
	stem.scale.set(0.11, height, 0.11)
	g.add(stem)
	const leaf = new THREE.CircleGeometry(0.55, 7)
	for (let i = 0; i < 10; i++) {
		const l = new THREE.Mesh(leaf, more.bigLeaf())
		const a = (i / 10) * Math.PI * 2
		l.position.set(Math.cos(a) * 0.7, height + 0.15 + r() * 0.2, Math.sin(a) * 0.7)
		l.rotation.set(-Math.PI / 2 + 0.5, 0, a, 'YXZ')
		l.rotation.y = -a + Math.PI / 2
		g.add(l)
	}
	for (let i = 0; i < 9; i++) {
		const f = new THREE.Mesh(sphere(), i < 3 ? garden.papaya() : garden.papayaGreen())
		const a = r() * 6.28
		f.position.set(Math.cos(a) * 0.15, height - 0.3 - r() * 0.5, Math.sin(a) * 0.15)
		f.scale.set(0.09, 0.15, 0.09)
		g.add(f)
	}
	return { object: g, radius: 0.2 }
}

/** Coffee or cacao, the shrub layer under the fruit trees. */
export function tropicalShrub(kind: 'coffee' | 'cacao', seed: number, size = 1.4): Plant {
	const r = seeded(seed)
	const g = new THREE.Group()
	if (kind === 'cacao') trunk(g, size * 0.6, 0.06)
	canopy(g, r, 0, size * 0.75, 0, size * 0.55, size * 0.5, 22, leafMat(), 0.7 * size)
	if (kind === 'coffee') hang(g, r, size * 0.8, size * 0.45, size * 0.35, 30, more.redBerry(), [0.02, 0.02, 0.02])
	else hang(g, r, size * 0.55, size * 0.12, size * 0.25, 6, garden.cacao(), [0.06, 0.11, 0.06])
	return { object: g, radius: 0 }
}

/** Ginger or turmeric at the roots: a clump of tall, narrow leaves. */
export function ginger(seed: number, size = 0.9): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	for (let i = 0; i < 9; i++) {
		const c = new THREE.Mesh(card(), bananaLeafMat())
		c.scale.set(0.12 * size, size * (0.7 + r() * 0.4), 1)
		c.position.set((r() - 0.5) * 0.35, c.scale.y / 2, (r() - 0.5) * 0.35)
		c.rotation.set((r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.3)
		g.add(c)
	}
	return g
}

/** Strawberries for ground cover: low leaves, red berries showing. */
export function strawberries(seed: number, size = 0.9): THREE.Group {
	const g = clover(seed, size)
	const r = seeded(seed + 1)
	for (let i = 0; i < 8; i++) {
		const b = new THREE.Mesh(small(), garden.strawberry())
		b.position.set((r() - 0.5) * size, 0.07, (r() - 0.5) * size)
		b.scale.set(0.028, 0.035, 0.028)
		g.add(b)
	}
	return g
}

/** Passion fruit, climbing a tree's pole. */
export function passionVine(seed: number, height = 3): Plant {
	const p = climber(seed, height)
	const r = seeded(seed + 7)
	p.object.children.filter((c) => c instanceof THREE.Group).forEach((c) => p.object.remove(c))
	for (let i = 0; i < 10; i++) {
		const f = new THREE.Mesh(small(), garden.passion())
		const a = r() * 6.28
		f.position.set(Math.cos(a) * 0.24, height * (0.3 + r() * 0.6), Math.sin(a) * 0.24)
		f.scale.setScalar(0.05)
		p.object.add(f)
	}
	return p
}

/* ── the kitchen garden: the vegetables that want a greenhouse ──────────── */

function lettuceHead(g: THREE.Group, r: Rand, x: number, z: number, red: boolean) {
	const leaf = new THREE.CircleGeometry(0.1, 6)
	for (let i = 0; i < 8; i++) {
		const l = new THREE.Mesh(leaf, red && i % 2 ? garden.lettuceRed() : garden.lettuce())
		const a = (i / 8) * Math.PI * 2 + r()
		l.position.set(x + Math.cos(a) * 0.06, 0.08 + (i % 3) * 0.02, z + Math.sin(a) * 0.06)
		l.rotation.set(-0.6 - r() * 0.5, a, 0, 'YXZ')
		g.add(l)
	}
}

/**
 * One bed's crop, planted over `len` metres of a bed one metre wide, the soil at y 0.
 * The crops a greenhouse is for: salads, tomatoes, cucumbers, peppers and
 * aubergines, chard and kale, beans, strawberries, herbs.
 */
export type Crop = 'lettuce' | 'tomato' | 'cucumber' | 'pepper' | 'aubergine' | 'chard' | 'beans' | 'strawberry' | 'herbs'
export const CROPS: Crop[] = ['lettuce', 'tomato', 'cucumber', 'pepper', 'chard', 'beans', 'aubergine', 'strawberry', 'herbs']
export function crop(kind: Crop, seed: number, len: number): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	const along = (step: number, f: (x: number, row: number) => void, rows = [-0.25, 0.25]) => {
		for (let x = -len / 2 + step / 2; x < len / 2; x += step) rows.forEach((z, i) => f(x + (i % 2 ? step / 2 : 0) * 0.5, z))
	}
	if (kind === 'lettuce') along(0.32, (x, z) => lettuceHead(g, r, x, z, r() < 0.35), [-0.3, 0, 0.3])
	else if (kind === 'tomato')
		along(0.6, (x, z) => {
			g.add(stick(garden.stake(), x, z, 1.6))
			canopy(g, r, x, 0.85, z, 0.25, 0.7, 14, fineLeafMat(), 0.35)
			for (let i = 0; i < 9; i++) {
				const t = new THREE.Mesh(small(), i < 6 ? garden.tomato() : garden.papayaGreen())
				t.position.set(x + (r() - 0.5) * 0.4, 0.4 + r() * 1, z + (r() - 0.5) * 0.4)
				t.scale.setScalar(0.04)
				g.add(t)
			}
		})
	else if (kind === 'cucumber') {
		// an A-frame trellis the length of the bed, netted, the vines climbing it
		for (const x of [-len / 2 + 0.1, 0, len / 2 - 0.1])
			for (const side of [-1, 1]) {
				const pole = stick(garden.stake(), x, side * 0.35, 1.9)
				pole.rotation.x = side * 0.18
				g.add(pole)
			}
		for (const side of [-1, 1]) {
			const net = new THREE.Mesh(card(), garden.net())
			net.scale.set(len - 0.2, 1.8, 1)
			net.position.set(0, 0.95, side * 0.2)
			net.rotation.x = side * 0.18
			g.add(net)
			for (let i = 0; i < len * 14; i++) {
				const c = new THREE.Mesh(card(), leafMat())
				const y = 0.2 + r() * 1.6
				c.position.set(-len / 2 + 0.2 + r() * (len - 0.4), y, side * (0.36 - y * 0.18))
				c.rotation.set(r() * 3, r() * 3, r() * 3)
				c.scale.setScalar(0.3)
				g.add(c)
			}
			for (let i = 0; i < len * 3; i++) {
				const f = new THREE.Mesh(small(), garden.cucumber())
				const y = 0.3 + r() * 1.2
				f.position.set(-len / 2 + 0.3 + r() * (len - 0.6), y, side * (0.42 - y * 0.18))
				f.scale.set(0.025, 0.1, 0.025)
				g.add(f)
			}
		}
	} else if (kind === 'pepper' || kind === 'aubergine')
		along(0.5, (x, z) => {
			canopy(g, r, x, 0.35, z, 0.22, 0.2, 9, leafMat(), 0.28)
			for (let i = 0; i < 5; i++) {
				const f = new THREE.Mesh(small(), kind === 'aubergine' ? garden.aubergine() : r() < 0.5 ? garden.pepperRed() : garden.pepperYellow())
				f.position.set(x + (r() - 0.5) * 0.3, 0.2 + r() * 0.2, z + (r() - 0.5) * 0.3)
				f.scale.set(kind === 'aubergine' ? 0.05 : 0.035, kind === 'aubergine' ? 0.1 : 0.06, kind === 'aubergine' ? 0.05 : 0.035)
				g.add(f)
			}
		})
	else if (kind === 'chard')
		along(0.35, (x, z) => {
			for (let i = 0; i < 6; i++) {
				const a = r() * 6.28
				const stem = stick(garden.chard[Math.floor(r() * 3)]!(), x, z, 0.3, 0.012)
				stem.rotation.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35)
				g.add(stem)
				const l = new THREE.Mesh(card(), garden.chardLeaf())
				l.scale.set(0.16, 0.28, 1)
				l.position.set(x + Math.sin(a) * 0.1, 0.42, z + Math.cos(a) * 0.1)
				l.rotation.set(-0.3, a, 0, 'YXZ')
				g.add(l)
			}
		})
	else if (kind === 'beans')
		// teepees of canes, the vines wound up them, pods hanging
		along(1.1, (x) => {
			for (let k = 0; k < 4; k++) {
				const a = (k / 4) * Math.PI * 2
				const cane = stick(garden.stake(), x + Math.cos(a) * 0.3, Math.sin(a) * 0.3, 2.1, 0.015)
				cane.rotation.set(-Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15)
				g.add(cane)
			}
			canopy(g, r, x, 1, 0, 0.3, 0.9, 30, fineLeafMat(), 0.3)
			for (let i = 0; i < 14; i++) {
				const pod = new THREE.Mesh(small(), garden.bean())
				pod.position.set(x + (r() - 0.5) * 0.5, 0.4 + r() * 1.3, (r() - 0.5) * 0.5)
				pod.scale.set(0.012, 0.08, 0.012)
				g.add(pod)
			}
		}, [0])
	else if (kind === 'strawberry') along(0.45, (x, z) => g.add(strawberries(seed + Math.round(x * 10), 0.4).translateX(x).translateZ(z)))
	else along(0.3, (x, z) => g.add(herb(seed + Math.round(x * 100 + z * 10), 0.18 + r() * 0.1).translateX(x).translateZ(z)), [-0.3, 0, 0.3])
	g.traverse((o) => (o.castShadow = false))
	return g
}

/* ── the Mediterranean balconies: olive, lemon, lavender and rosemary in
   terracotta, and grapevines trained over pergolas and along the rails ── */

/** A terracotta pot with a plant in it. */
export function potted(kind: 'olive' | 'lemon' | 'lavender' | 'rosemary', seed: number, size = 1): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	const big = kind === 'olive' || kind === 'lemon'
	const pr = (big ? 0.38 : 0.24) * size
	const ph = (big ? 0.55 : 0.32) * size
	const pot = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr * 0.75, ph, 14), garden.terracotta())
	pot.position.y = ph / 2
	g.add(pot)
	const rim = new THREE.Mesh(new THREE.TorusGeometry(pr, 0.03 * size, 5, 16), garden.terracotta())
	rim.rotation.x = Math.PI / 2
	rim.position.y = ph
	g.add(rim)
	if (kind === 'olive') {
		const t = new THREE.Group()
		trunk(t, 1.1 * size, 0.07 * size, 0.15)
		t.position.y = ph
		g.add(t)
		canopy(g, r, 0, ph + 1.4 * size, 0, 0.75 * size, 0.55 * size, 34, garden.olive(), 0.55 * size)
		hang(g, r, ph + 1.35 * size, 0.6 * size, 0.3, 14, garden.oliveFruit(), [0.018, 0.024, 0.018])
	} else if (kind === 'lemon') {
		const t = new THREE.Group()
		trunk(t, 0.8 * size, 0.05 * size)
		t.position.y = ph
		g.add(t)
		canopy(g, r, 0, ph + 1.1 * size, 0, 0.55 * size, 0.5 * size, 28, fineLeafMat(), 0.5 * size)
		hang(g, r, ph + 1.05 * size, 0.5 * size, 0.3, 10, fruit.lemon(), [0.045, 0.055, 0.045])
	} else if (kind === 'lavender') {
		for (let i = 0; i < 22; i++) {
			const a = r() * 6.28, d = r() * pr * 0.8
			const s = stick(garden.sage(), Math.cos(a) * d, Math.sin(a) * d, 0.35 * size, 0.008)
			s.position.y = ph
			s.rotation.set((r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6)
			g.add(s)
			const f = new THREE.Mesh(small(), garden.lavender())
			f.scale.set(0.02, 0.06, 0.02)
			f.position.set(Math.cos(a) * d * 1.3, ph + 0.37 * size, Math.sin(a) * d * 1.3)
			g.add(f)
		}
	} else canopy(g, r, 0, ph + 0.28 * size, 0, pr * 1.1, 0.3 * size, 16, garden.olive(), 0.28 * size)
	return g
}

/** Grapes trained along a rail of `len` metres at height 0: leaves along it, clusters hanging below. */
export function vineAlong(seed: number, len: number): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	for (let i = 0; i < len * 7; i++) {
		const c = new THREE.Mesh(card(), leafMat())
		c.position.set(-len / 2 + r() * len, 0.05 + r() * 0.25, (r() - 0.5) * 0.3)
		c.rotation.set(r() * 3, r() * 3, r() * 3)
		c.scale.setScalar(0.32)
		g.add(c)
	}
	for (let k = 0; k < len * 0.8; k++) grapes(g, r, -len / 2 + r() * len, -0.05, (r() - 0.5) * 0.2)
	return g
}

function grapes(g: THREE.Group, r: Rand, x: number, y: number, z: number) {
	for (let i = 0; i < 12; i++) {
		const b = new THREE.Mesh(small(), more.grape())
		b.position.set(x + (r() - 0.5) * 0.08, y - i * 0.014, z + (r() - 0.5) * 0.08)
		b.scale.setScalar(0.024)
		g.add(b)
	}
}

/** A timber pergola, `w` by `d`, the vine grown over its top and its grapes hanging through. */
export function grapePergola(seed: number, w: number, d: number, h = 2.5): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(stick(more.pole(), (sx * w) / 2, (sz * d) / 2, h, 0.06))
	for (const sx of [-1, 1]) {
		const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, d + 0.3), more.pole())
		beam.position.set((sx * w) / 2, h, 0)
		g.add(beam)
	}
	for (let i = 0; i <= 5; i++) {
		const slat = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.08, 0.06), more.pole())
		slat.position.set(0, h + 0.1, -d / 2 + (i * d) / 5)
		g.add(slat)
	}
	for (let i = 0; i < w * d * 9; i++) {
		const c = new THREE.Mesh(card(), leafMat())
		c.position.set((r() - 0.5) * (w + 0.2), h + 0.12 + r() * 0.3, (r() - 0.5) * (d + 0.2))
		c.rotation.set(-Math.PI / 2 + (r() - 0.5) * 1.2, 0, r() * 6)
		c.scale.setScalar(0.42)
		g.add(c)
	}
	for (let k = 0; k < w * d * 0.8; k++) grapes(g, r, (r() - 0.5) * w * 0.9, h, (r() - 0.5) * d * 0.9)
	// the vines' trunks, twisting up two of the posts
	for (const sx of [-1, 1]) {
		for (let i = 0; i < 10; i++) {
			const c = new THREE.Mesh(card(), leafMat())
			c.position.set((sx * w) / 2 + (r() - 0.5) * 0.25, (i / 10) * h, d / 2 + (r() - 0.5) * 0.25)
			c.rotation.set(r() * 3, r() * 3, r() * 3)
			c.scale.setScalar(0.3)
			g.add(c)
		}
	}
	return g
}
