/**
 * THE BELL TENT — where a settler sleeps on the first nights, before any dome
 * stands: a cotton canvas bell tent four metres across, on one pole, room for
 * two to sleep and to sit up in. Two mats and sleeping bags at the back, a
 * lantern on the pole, a crate for a table; outside, the campfire and two
 * chairs.
 */
import * as THREE from 'three'
import type { Mats } from './interior'

export type TentCtx = {
	scene: THREE.Scene
	R: number
	m: Mats
	box: (w: number, h: number, d: number, mat: THREE.Material, x?: number, y?: number, z?: number, rotY?: number) => THREE.Mesh
	bake: (g: THREE.Group, shadows?: boolean) => THREE.Group
}

export const TENT = { wall: 0.75, pole: 3, doorHalf: 0.55, doorTop: 1.8 }

const adiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

export function buildTent(ctx: TentCtx): { colliders: { x: number; z: number; r: number }[]; start: { x: number; z: number; look: number }; update: (t: number) => void; lamp: THREE.PointLight } {
	const { scene, R, m, box, bake } = ctx
	const canvas = new THREE.MeshStandardMaterial({ color: '#ece3cf', emissive: '#5a4c34', emissiveIntensity: 0.35, roughness: 1, side: THREE.DoubleSide })
	const g = new THREE.Group()
	const colliders: { x: number; z: number; r: number }[] = []

	/* the canvas: a short wall, then the bell rising to the pole, a door cut into both */
	const gap = TENT.doorHalf / R
	const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, TENT.wall, 64, 1, true, gap, Math.PI * 2 - 2 * gap), canvas)
	wall.position.y = TENT.wall / 2
	wall.castShadow = true
	scene.add(wall)
	{
		const rows = 16, cols = 72
		const pos: number[] = [], idx: number[] = []
		const ring = (j: number) => {
			const v = j / rows
			// the bell's curve: steep near the pole, flaring out over the wall
			return { r: (R + 0.12) * (1 - v) ** 1.25 + 0.04, y: TENT.wall + (TENT.pole - TENT.wall) * (1 - (1 - v) ** 1.6) }
		}
		for (let j = 0; j <= rows; j++) {
			const { r, y } = ring(j)
			for (let i = 0; i <= cols; i++) {
				const a = (i / cols) * Math.PI * 2
				pos.push(r * Math.sin(a), y, r * Math.cos(a))
			}
		}
		for (let j = 0; j < rows; j++)
			for (let i = 0; i < cols; i++) {
				const a = ((i + 0.5) / cols) * Math.PI * 2
				const { r, y } = ring(j + 1)
				// the door: leave out the canvas in front of it, up to its top
				if (Math.abs(adiff(a, 0)) * r < TENT.doorHalf && y < TENT.doorTop) continue
				const p = j * (cols + 1) + i, q = p + cols + 1
				idx.push(p, q, p + 1, p + 1, q, q + 1)
			}
		const geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
		geo.setIndex(idx)
		geo.computeVertexNormals()
		const bell = new THREE.Mesh(geo, canvas)
		bell.castShadow = true
		scene.add(bell)
	}
	// the door flaps, rolled and tied back either side
	for (const side of [-1, 1]) {
		const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, TENT.doorTop - 0.1, 10), canvas)
		roll.position.set(Math.sin(side * gap) * (R + 0.02), (TENT.doorTop - 0.1) / 2, Math.cos(side * gap) * (R + 0.02))
		g.add(roll)
	}
	// the pole, and the guy ropes out to their pegs
	const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, TENT.pole + 0.15, 10), m.timberFrame)
	pole.position.y = (TENT.pole + 0.15) / 2
	g.add(pole)
	colliders.push({ x: 0, z: 0, r: 0.2 })
	const rope = new THREE.MeshStandardMaterial({ color: '#d8ccb0', roughness: 1 })
	for (let k = 0; k < 12; k++) {
		const a = ((k + 0.5) / 12) * Math.PI * 2
		if (Math.abs(adiff(a, 0)) < 0.3) continue
		const from = new THREE.Vector3(Math.sin(a) * (R + 0.08), TENT.wall + 0.05, Math.cos(a) * (R + 0.08))
		const to = new THREE.Vector3(Math.sin(a) * (R + 1.5), 0.02, Math.cos(a) * (R + 1.5))
		const d = to.clone().sub(from)
		const line = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, d.length(), 4), rope)
		line.position.copy(from).addScaledVector(d, 0.5)
		line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
		g.add(line)
		g.add(box(0.03, 0.14, 0.03, m.dark, to.x, 0, to.z))
	}

	/* inside: a sewn-in groundsheet, a jute rug, two beds at the back */
	const sheet = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshStandardMaterial({ color: '#5c6650', roughness: 0.95 }))
	sheet.rotation.x = -Math.PI / 2
	sheet.position.y = 0.012
	sheet.receiveShadow = true
	scene.add(sheet)
	const rug = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), m.rug)
	rug.rotation.x = -Math.PI / 2
	rug.position.set(0, 0.02, 0.55)
	scene.add(rug)
	const bags = ['#2f6f73', '#b5553a']
	for (const [i, x] of [-0.36, 0.36].entries()) {
		g.add(box(0.62, 0.07, 1.9, m.dark, x, 0.015, -0.72))
		g.add(box(0.56, 0.12, 1.55, new THREE.MeshStandardMaterial({ color: bags[i]!, roughness: 0.8 }), x, 0.08, -0.55))
		g.add(box(0.45, 0.1, 0.3, m.linen, x, 0.09, -1.45))
	}
	// the lantern on the pole, glowing
	const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), m.paper)
	lamp.position.set(0.09, 1.95, 0)
	g.add(lamp)
	const warm = new THREE.PointLight('#ffcf8a', 1.4, 5, 1.6)
	warm.position.set(0.09, 1.9, 0)
	scene.add(warm)
	// a crate for a table, two enamel mugs, a book; the packs against the wall
	g.add(box(0.5, 0.36, 0.36, m.oak(1), 0.95, 0, 0.45, 0.4))
	colliders.push({ x: 0.95, z: 0.45, r: 0.35 })
	const enamel = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.35 })
	for (const [x, z] of [[0.86, 0.4], [1.02, 0.52]] as const) {
		const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 12), enamel)
		mug.position.set(x, 0.4, z)
		g.add(mug)
	}
	g.add(box(0.16, 0.03, 0.22, m.cushion, 1.05, 0.36, 0.35, 0.3))
	g.add(box(0.36, 0.5, 0.24, new THREE.MeshStandardMaterial({ color: '#56643f', roughness: 0.9 }), -1.3, 0, 0.1, -1.2))
	g.add(box(0.34, 0.46, 0.22, new THREE.MeshStandardMaterial({ color: '#7a4a32', roughness: 0.9 }), -1.25, 0, 0.55, -1.4))

	/* outside: the campfire in its ring of stones, logs, two folding chairs */
	const fire = new THREE.Group()
	const fx = 1.2, fz = R + 2.1
	fire.position.set(fx, 0, fz)
	const stone = new THREE.MeshStandardMaterial({ color: '#8d8a83', roughness: 0.9 })
	for (let k = 0; k < 11; k++) {
		const a = (k / 11) * Math.PI * 2
		const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), stone)
		st.position.set(Math.sin(a) * 0.6, 0.08, Math.cos(a) * 0.6)
		st.scale.y = 0.7
		fire.add(st)
	}
	for (let k = 0; k < 4; k++) {
		const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 8), m.timberFrame)
		log.rotation.set(Math.PI / 2 - 0.5, (k / 4) * Math.PI, 0, 'YXZ')
		log.position.y = 0.2
		fire.add(log)
	}
	const flameMat = new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 2.2, transparent: true, opacity: 0.85 })
	const flames = [0, 1, 2].map((k) => {
		const f = new THREE.Mesh(new THREE.ConeGeometry(0.16 - k * 0.03, 0.55 - k * 0.1, 8), flameMat)
		f.position.set((k - 1) * 0.08, 0.35, (k % 2) * 0.06)
		fire.add(f)
		return f
	})
	const fireLight = new THREE.PointLight('#ff9a4a', 2, 7, 1.8)
	fireLight.position.set(fx, 0.6, fz)
	scene.add(fireLight)
	scene.add(fire)
	colliders.push({ x: fx, z: fz, r: 0.75 })
	const seat = new THREE.MeshStandardMaterial({ color: '#3f5f4a', roughness: 0.9 })
	for (const [cx, cz, face] of [[fx - 1.2, fz + 0.6, 2.1], [fx + 0.9, fz + 1.1, -2.6]] as const) {
		const chair = new THREE.Group()
		chair.add(box(0.5, 0.04, 0.45, seat, 0, 0.38, 0))
		const back = box(0.5, 0.5, 0.04, seat, 0, 0.42, -0.24)
		back.rotation.x = -0.25
		chair.add(back)
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) chair.add(box(0.025, 0.4, 0.025, m.dark, sx * 0.23, 0, sz * 0.2))
		chair.position.set(cx, 0, cz)
		chair.rotation.y = face
		g.add(chair)
		colliders.push({ x: cx, z: cz, r: 0.4 })
	}
	// a stack of firewood by the tent
	for (let k = 0; k < 9; k++) {
		const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), m.timberFrame)
		log.rotation.x = Math.PI / 2
		log.position.set(-R - 0.6 + (k % 3) * 0.15, 0.08 + Math.floor(k / 3) * 0.13, 0.9)
		g.add(log)
	}
	scene.add(bake(g))

	const update = (t: number) => {
		flames.forEach((f, k) => {
			const s = 0.85 + Math.sin(t * (9 + k * 3) + k) * 0.15
			f.scale.set(s, 0.8 + Math.abs(Math.sin(t * (7 + k * 2))) * 0.4, s)
		})
		fireLight.intensity = 1.7 + Math.sin(t * 13) * 0.3 + Math.sin(t * 7.3) * 0.2
	}
	return { colliders, start: { x: 0, z: R - 0.4, look: 0 }, update, lamp: warm }
}
