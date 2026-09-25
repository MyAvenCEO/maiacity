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
	const stemMat = new THREE.MeshStandardMaterial({ color: '#6f8a3f', roughness: 0.7 })
	const stem = new THREE.Mesh(trunkGeo(), stemMat)
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
