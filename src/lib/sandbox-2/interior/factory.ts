/**
 * THE SOLAR FACTORY DOME — the village's factory coop, a dome the size of the
 * master dome, making the glass triangles every dome is built from.
 *
 * It follows the real recipe of a solar module line, top to bottom:
 *
 *   4  Solar glass       float glass in, triangles cut, edges ground, washed,
 *                        tempered at 700 °C, quenched, anti-reflective coated
 *   3  Cells & strings   cells sorted by EL and IV, laser half-cut, soldered
 *                        into strings on the tabber-stringers, inspected
 *   2  Layup             glass in, encapsulant film, strings laid up, bussed,
 *                        second film, back glass, EL before lamination
 *   1  Lamination        vacuum laminators at 145 °C, cooling press, edge
 *                        trimming, triangle frame and gasket, junction box
 *   0  Testing & ship    sun simulator flash test, final EL, insulation test,
 *                        grading, packing onto racks; round it the warehouse,
 *                        high-bay racks, docks at the doors, AGVs to the yard
 *
 * Every floor is a ring round a central tower: one great round lift that
 * carries people, robots and racks between the floors (↑ and ↓ inside it),
 * and overhead conveyors from the tower out over the lines. On every floor
 * two circular lines carry the triangles from station to station, climbing
 * over the paths where they cross. Robot arms load the machines behind their
 * fences, gantries lay up the strings, humanoid robots and people walk the
 * aisles, AGVs carry racks.
 */
import * as THREE from 'three'
import type { Mats } from './interior'
import { stageParts } from './parts'

type Collider = { x: number; z: number; r: number; y?: number }
export type FactoryCtx = {
	scene: THREE.Scene
	R: number
	m: Mats
	box: (w: number, h: number, d: number, mat: THREE.Material, x?: number, y?: number, z?: number, rotY?: number) => THREE.Mesh
	bake: (g: THREE.Group, shadows?: boolean) => THREE.Group
}
export type FactoryWalk = {
	colliders: Collider[]
	floorAt: (x: number, z: number, feet: number) => number
	blocked: (x: number, z: number, here: number) => boolean
	start: { x: number; z: number; look: number }
	update: (t: number) => void
	/** where the walker is, each frame */
	tick: (x: number, z: number, feet: number) => void
	/** a key pressed or released; true if the factory used it (the lift's ↑ and ↓) */
	onKey: (k: string, down: boolean) => boolean
	/** the floor the lift stands at, while you are in it; -1 outside */
	floor: () => number
}

/** The five floors, ground up. */
export const LEVELS = [0, 7, 14, 21, 28]
export const NAMES = ['Frames, test & dome kits', 'Modules', 'Glass from sand', 'Copper, cords & electronics', 'Silicon & cells']
const CORE = 6.5
const LANDING = 11
const FLOOR_IN = 17
/** the main line: one loop on every floor, near the outside of the hall */
const MAIN = 48
const BELT = 0.9
const DOORS = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
const SPURS = DOORS.map((d) => d + Math.PI / 4)

const polar = (r: number, a: number): [number, number] => [r * Math.sin(a), r * Math.cos(a)]
const adiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))
const smooth = (x: number) => x * x * (3 - 2 * x)
const col = (c: string, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal })
const glow = (c: string, i = 1.4) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 })

/* ── materials ────────────────────────────────────────────────────────── */

const M = {
	white: col('#eceff1', 0.45),
	grey: col('#9aa2a8', 0.5, 0.2),
	graphite: col('#3a4046', 0.45, 0.3),
	orange: col('#e8742a', 0.4, 0.1),
	yellow: col('#f2c230', 0.5),
	blue: col('#2f5d8a', 0.45),
	belt: col('#2a2d30', 0.85),
	steel: col('#b8c0c6', 0.3, 0.8),
	slab: new THREE.MeshStandardMaterial({ color: '#7f8a84', roughness: 0.9, envMapIntensity: 0.35 }),
	under: col('#6f777a', 0.9),
	duct: col('#a9b0b4', 0.35, 0.7),
	fence: new THREE.MeshStandardMaterial({ color: '#e0b020', roughness: 0.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
	glassWall: new THREE.MeshPhysicalMaterial({ color: '#dfeef0', roughness: 0.05, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
	light: glow('#ffffff', 1.1),
	furnace: glow('#ff7a1f', 2.2),
	ir: glow('#ff3b2a', 1.6),
	wash: glow('#5ec8ff', 1.2),
	laser: glow('#ff2020', 2.5),
	screen: glow('#58a8ff', 0.9),
	green: glow('#39d353', 1.6),
	amber: glow('#ffb020', 0.4),
	red: glow('#ff3b30', 0.3),
	flash: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.2 }),
	cellBlue: col('#1c2c5a', 0.3, 0.3),
	film: new THREE.MeshStandardMaterial({ color: '#f4f7f5', roughness: 0.3, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
	alu: col('#c4c9cc', 0.35, 0.85),
	cassette: col('#2c6f9e', 0.5),
	pallet: col('#b08a58', 0.8),
	cardboard: col('#b8925e', 0.9),
	rubber: col('#1f2123', 0.9)
}

/* ── textures: a triangle at each stage, and the signs ───────────────── */

/** A sign: the step's number, its name, and a line of what happens there. */
function sign(step: string, name: string, note = ''): THREE.MeshStandardMaterial {
	const c = document.createElement('canvas')
	c.width = 768
	c.height = 176
	const x = c.getContext('2d')!
	x.fillStyle = '#23292e'
	x.fillRect(0, 0, 768, 176)
	x.fillStyle = '#e8742a'
	x.fillRect(0, 0, 12, 176)
	x.fillStyle = '#e8742a'
	x.font = '600 44px system-ui, sans-serif'
	x.fillText(step, 36, 70)
	x.fillStyle = '#ffffff'
	x.font = '600 52px system-ui, sans-serif'
	x.fillText(name, 36 + x.measureText(step).width + 34, 70)
	x.fillStyle = '#b9c2c9'
	x.font = '400 34px system-ui, sans-serif'
	x.fillText(note, 36, 130)
	const t = new THREE.CanvasTexture(c)
	t.colorSpace = THREE.SRGBColorSpace
	return new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.35, side: THREE.DoubleSide })
}

/* ── building blocks ──────────────────────────────────────────────────── */

type Part = { group: THREE.Group; colliders: Collider[]; update?: (t: number) => void }

/** A stack light: red, amber, green, the green one blinking while the machine runs. */
function stackLight(ctx: FactoryCtx, g: THREE.Group, x: number, y: number, z: number, blink: THREE.Mesh[]) {
	g.add(ctx.box(0.06, 0.6, 0.06, M.graphite, x, y, z))
	const mats = [M.green, M.amber, M.red]
	mats.forEach((mat, i) => {
		const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 12), i === 0 ? mat.clone() : mat)
		b.position.set(x, y + 0.66 + i * 0.13, z)
		g.add(b)
		if (i === 0) blink.push(b)
	})
}

/** A control desk on the aisle side: a cabinet and a glowing screen. */
function console_(ctx: FactoryCtx, g: THREE.Group, x: number, z: number, face = 0) {
	g.add(ctx.box(0.9, 1.1, 0.5, M.grey, x, 0, z, face))
	const s = ctx.box(0.7, 0.45, 0.04, M.screen, x, 1.15, z, face)
	s.rotation.x = -0.35
	g.add(s)
}

/**
 * A machine the line runs through: a housing straddling the belt, windows
 * glowing with what goes on inside, a desk, a stack light.
 */
function tunnel(ctx: FactoryCtx, len: number, h: number, body: THREE.Material, inside: THREE.Material | null, blink: THREE.Mesh[]): Part {
	const g = new THREE.Group()
	g.add(ctx.box(len, h, 3.2, body, 0, 0, 0))
	g.add(ctx.box(len + 0.02, 0.18, 3.22, M.orange, 0, h - 0.5, 0))
	// the mouths where the belt goes in and out
	for (const sx of [-1, 1]) g.add(ctx.box(0.05, 0.7, 1.9, M.graphite, (sx * (len + 0.02)) / 2, BELT - 0.2, 0))
	if (inside)
		for (const sz of [-1, 1]) {
			const w = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.7, h * 0.28), inside)
			w.position.set(0, h * 0.55, sz * 1.62)
			w.rotation.y = sz > 0 ? 0 : Math.PI
			g.add(w)
		}
	console_(ctx, g, len / 2 - 0.8, -2.2)
	stackLight(ctx, g, -len / 2 + 0.3, h, -1.4, blink)
	return { group: g, colliders: Array.from({ length: Math.ceil(len / 2.6) }, (_, i) => ({ x: -len / 2 + 1.3 + i * 2.6, z: 0, r: 1.8 })) }
}

/**
 * A six-axis robot arm: base, turret, shoulder, elbow, wrist, and a vacuum
 * gripper. It swings between the belt and its machine on a cycle of its own.
 */
function robotArm(ctx: FactoryCtx, paint: THREE.Material, from: number, to: number, period: number, phase: number): Part {
	const g = new THREE.Group()
	g.add(ctx.box(0.9, 0.12, 0.9, M.graphite))
	const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.45, 20), paint)
	base.position.y = 0.34
	g.add(base)
	const turret = new THREE.Group()
	turret.position.y = 0.56
	g.add(turret)
	const tMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.36, 20), paint)
	tMesh.position.y = 0.18
	turret.add(tMesh)
	const shoulder = new THREE.Group()
	shoulder.position.y = 0.42
	turret.add(shoulder)
	const upper = ctx.box(0.26, 1.3, 0.3, paint, 0, 0, 0)
	shoulder.add(upper)
	const elbow = new THREE.Group()
	elbow.position.y = 1.3
	shoulder.add(elbow)
	const elbowJ = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.36, 16), M.graphite)
	elbowJ.rotation.z = Math.PI / 2
	elbow.add(elbowJ)
	const fore = ctx.box(0.2, 1.1, 0.22, paint, 0, 0, 0)
	elbow.add(fore)
	const wrist = new THREE.Group()
	wrist.position.y = 1.1
	elbow.add(wrist)
	wrist.add(ctx.box(0.14, 0.2, 0.14, M.graphite))
	const tool = ctx.box(0.9, 0.05, 0.6, M.steel, 0, 0.2, 0)
	wrist.add(tool)
	for (const [cx, cz] of [[-0.35, -0.22], [0.35, -0.22], [-0.35, 0.22], [0.35, 0.22]] as const) {
		const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), M.rubber)
		cup.position.set(cx, 0.28, cz)
		wrist.add(cup)
	}
	g.traverse((o) => (o.castShadow = true))
	const update = (t: number) => {
		// reach down to the belt, lift, swing across, reach down into the machine, swing back
		const u = ((t / period + phase) % 1 + 1) % 1
		const swing = u < 0.5 ? smooth(Math.min(1, Math.max(0, (u - 0.1) / 0.3))) : 1 - smooth(Math.min(1, Math.max(0, (u - 0.6) / 0.3)))
		const dip = Math.abs(Math.sin(u * Math.PI * 2)) < 0.25 ? 1 : 0.4
		turret.rotation.y = from + (to - from) * swing
		shoulder.rotation.x = 0.35 + 0.35 * dip
		elbow.rotation.x = 1.35 + 0.3 * dip
		wrist.rotation.x = Math.PI - shoulder.rotation.x - elbow.rotation.x
	}
	update(0)
	return { group: g, colliders: [{ x: 0, z: 0, r: 0.8 }], update }
}

/** A gantry over the belt: a portal frame, a carriage running along it, a head that dips to lay a string. */
function gantry(ctx: FactoryCtx, len: number, period: number, carry: THREE.Material): Part {
	const g = new THREE.Group()
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(ctx.box(0.22, 3.2, 0.22, M.yellow, (sx * len) / 2, 0, sz * 1.9))
	for (const sz of [-1, 1]) g.add(ctx.box(len + 0.3, 0.3, 0.26, M.yellow, 0, 3.2, sz * 1.9))
	const carriage = new THREE.Group()
	carriage.position.y = 3.2
	g.add(carriage)
	carriage.add(ctx.box(0.6, 0.35, 4.1, M.graphite, 0, -0.1, 0))
	const head = new THREE.Group()
	carriage.add(head)
	head.add(ctx.box(0.12, 1.4, 0.12, M.steel, 0, -1.4, 0))
	head.add(ctx.box(1.3, 0.06, 0.4, carry, 0, -1.5, 0))
	const update = (t: number) => {
		const u = ((t / period) % 1 + 1) % 1
		carriage.position.x = Math.sin(u * Math.PI * 2) * (len / 2 - 0.6)
		head.position.y = -Math.max(0, Math.cos(u * Math.PI * 4)) * 0.6
	}
	return { group: g, colliders: [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: (sx * len) / 2, z: sz * 1.9, r: 0.35 }))), update }
}

/** A glowing stack of three vacuum laminators, their lids lifting in turn. */
function laminators(ctx: FactoryCtx, blink: THREE.Mesh[]): Part {
	const g = new THREE.Group()
	const lids: THREE.Mesh[] = []
	for (let i = 0; i < 3; i++) {
		const y = 0.4 + i * 1.25
		g.add(ctx.box(5, 0.55, 3.6, M.white, 0, y, 0))
		const heat = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.12), M.furnace)
		heat.position.set(0, y + 0.6, 1.81)
		g.add(heat)
		const lid = ctx.box(5, 0.35, 3.6, M.grey, 0, y + 0.62, 0)
		g.add(lid)
		lids.push(lid)
	}
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(ctx.box(0.2, 4.2, 0.2, M.graphite, sx * 2.6, 0, sz * 1.9))
	console_(ctx, g, 3.4, -1.2, Math.PI / 2)
	stackLight(ctx, g, -2.4, 4.2, -1.9, blink)
	const update = (t: number) =>
		lids.forEach((lid, i) => {
			const u = ((t / 18 + i / 3) % 1 + 1) % 1
			lid.position.y = 0.4 + i * 1.25 + 0.62 + (u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) * 0.45 : 0)
		})
	return { group: g, colliders: [{ x: -1.5, z: 0, r: 2.2 }, { x: 1.5, z: 0, r: 2.2 }], update }
}

/** The sun simulator: a dark booth where every panel meets a flash of a thousand watts a square metre. */
function flashBooth(ctx: FactoryCtx): Part {
	const g = new THREE.Group()
	g.add(ctx.box(5, 3, 0.2, M.graphite, 0, 0, 1.7))
	g.add(ctx.box(5, 0.2, 3.6, M.graphite, 0, 3, 0))
	for (const sx of [-1, 1]) g.add(ctx.box(0.2, 3, 3.6, M.graphite, sx * 2.5, 0, 0))
	const lamp = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), M.flash)
	lamp.rotation.x = Math.PI / 2
	lamp.position.set(0, 2.88, 0)
	g.add(lamp)
	console_(ctx, g, 3.2, -1.8)
	const update = (t: number) => {
		const u = (t % 2.4) / 2.4
		M.flash.emissiveIntensity = u < 0.06 ? 6 : 0.15
	}
	return { group: g, colliders: [{ x: -1.5, z: 0.6, r: 1.6 }, { x: 1.5, z: 0.6, r: 1.6 }], update }
}

/* ── the people and the robots ────────────────────────────────────────── */

type Walker = { level: number; r: number; a: number; speed: number; working: boolean; phase: number; kind: 'robot' | 'person' }

/**
 * Humanoid robots and people, instanced: one mesh per body part for all of
 * them, their legs and arms swinging as they walk the aisles, or standing
 * at a station with their hands busy.
 */
function crowd(walkers: Walker[]): { object: THREE.Group; update: (t: number, dt: number) => void } {
	const n = walkers.length
	const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 })
	const parts = {
		torso: new THREE.BoxGeometry(0.4, 0.58, 0.24),
		head: new THREE.SphereGeometry(0.13, 14, 10),
		leg: new THREE.BoxGeometry(0.14, 0.86, 0.16).translate(0, -0.43, 0),
		arm: new THREE.BoxGeometry(0.1, 0.66, 0.12).translate(0, -0.33, 0)
	}
	const meshes = {
		torso: new THREE.InstancedMesh(parts.torso, mat, n),
		head: new THREE.InstancedMesh(parts.head, mat, n),
		legL: new THREE.InstancedMesh(parts.leg, mat, n),
		legR: new THREE.InstancedMesh(parts.leg, mat, n),
		armL: new THREE.InstancedMesh(parts.arm, mat, n),
		armR: new THREE.InstancedMesh(parts.arm, mat, n)
	}
	const object = new THREE.Group()
	const c = new THREE.Color()
	walkers.forEach((w, i) => {
		const robot = w.kind === 'robot'
		const suit = robot ? '#e9edf0' : i % 3 ? '#2f4f7a' : '#f28c28'
		meshes.torso.setColorAt(i, c.set(suit))
		meshes.head.setColorAt(i, c.set(robot ? '#2a3036' : ['#e0b48f', '#8d5a3b', '#c68c62', '#f1caa7'][i % 4]!))
		for (const k of ['legL', 'legR'] as const) meshes[k].setColorAt(i, c.set(robot ? '#b9c1c7' : '#26303a'))
		for (const k of ['armL', 'armR'] as const) meshes[k].setColorAt(i, c.set(robot ? '#b9c1c7' : suit))
	})
	for (const mesh of Object.values(meshes)) {
		mesh.castShadow = true
		mesh.frustumCulled = false
		object.add(mesh)
	}
	const base = new THREE.Matrix4(), local = new THREE.Matrix4(), rot = new THREE.Matrix4(), out = new THREE.Matrix4()
	const set = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx = 0) => {
		local.makeTranslation(x, y, z)
		rot.makeRotationX(rx)
		out.copy(base).multiply(local).multiply(rot)
		mesh.setMatrixAt(i, out)
	}
	const update = (t: number, dt: number) => {
		walkers.forEach((w, i) => {
			if (!w.working) w.a += (w.speed / w.r) * dt
			const [x, z] = polar(w.r, w.a)
			// facing along the aisle, or into the station it works at
			const yaw = w.working ? w.a : w.a + (w.speed > 0 ? Math.PI / 2 : -Math.PI / 2)
			const y = LEVELS[w.level]!
			const step = w.working ? 0 : Math.sin(t * (w.kind === 'robot' ? 6 : 7) + w.phase) * 0.5
			const bob = w.working ? 0 : Math.abs(Math.cos(t * 7 + w.phase)) * 0.04
			base.makeRotationY(yaw).setPosition(x, y + bob, z)
			set(meshes.torso, i, 0, 1.2, 0)
			set(meshes.head, i, 0, 1.64, 0)
			set(meshes.legL, i, -0.1, 0.9, 0, step)
			set(meshes.legR, i, 0.1, 0.9, 0, -step)
			// at a desk, both hands reach forward to the controls
			const busy = -0.85 + Math.sin(t * 3 + w.phase) * 0.2
			set(meshes.armL, i, -0.27, 1.46, 0, w.working ? busy : -step * 0.8)
			set(meshes.armR, i, 0.27, 1.46, 0, w.working ? -0.85 - Math.sin(t * 3.4 + w.phase) * 0.2 : step * 0.8)
		})
		for (const mesh of Object.values(meshes)) mesh.instanceMatrix.needsUpdate = true
	}
	return { object, update }
}

/** A Czochralski puller: a tall steel chamber, a glowing window, the pull column above. */
function puller(ctx: FactoryCtx, blink: THREE.Mesh[]): Part {
	const g = new THREE.Group()
	for (const x of [-1.3, 1.3]) {
		const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.4, 24), M.white)
		body.position.set(x, 1.2, 0)
		g.add(body)
		const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.white)
		dome.position.set(x, 2.4, 0)
		g.add(dome)
		g.add(ctx.box(0.25, 2.4, 0.25, M.steel, x, 3.1, 0))
		g.add(ctx.box(0.6, 0.4, 0.6, M.graphite, x, 5.3, 0))
		const win = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), M.furnace)
		win.position.set(x, 1.4, -0.86)
		win.rotation.y = Math.PI
		g.add(win)
	}
	console_(ctx, g, 0, -1.6)
	stackLight(ctx, g, 2.4, 2.2, -0.6, blink)
	return { group: g, colliders: [{ x: -1.3, z: 0, r: 1 }, { x: 1.3, z: 0, r: 1 }] }
}

/** A submerged arc furnace: quartz and carbon in, three electrodes down into the glow. */
function arcFurnace(ctx: FactoryCtx, blink: THREE.Mesh[]): Part {
	const g = new THREE.Group()
	const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 2.2, 28), M.graphite)
	shell.position.y = 1.1
	g.add(shell)
	const melt = new THREE.Mesh(new THREE.CircleGeometry(1.55, 28), M.furnace)
	melt.rotation.x = -Math.PI / 2
	melt.position.y = 2.21
	g.add(melt)
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2
		const e = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3, 12), M.graphite)
		e.position.set(Math.sin(a) * 0.7, 3.2, Math.cos(a) * 0.7)
		g.add(e)
	}
	g.add(ctx.box(2.6, 0.3, 2.6, M.orange, 0, 4.6, 0))
	console_(ctx, g, 2.2, -1.8)
	stackLight(ctx, g, -2, 2, -1.4, blink)
	return { group: g, colliders: [{ x: 0, z: 0, r: 2.1 }] }
}

/** The batch house: silos of sand, soda ash, limestone and dolomite over a weighing mixer. */
function silos(ctx: FactoryCtx, blink: THREE.Mesh[]): Part {
	const g = new THREE.Group()
	for (const [i, x] of [-2.1, -0.7, 0.7, 2.1].entries()) {
		const s = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 3, 18), i % 2 ? M.white : M.grey)
		s.position.set(x, 3, 1.2)
		g.add(s)
		const cone = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.9, 18), M.grey)
		cone.rotation.x = Math.PI
		cone.position.set(x, 1.05, 1.2)
		g.add(cone)
		g.add(ctx.box(0.08, 1.5, 0.08, M.steel, x - 0.45, 0, 1.6), ctx.box(0.08, 1.5, 0.08, M.steel, x + 0.45, 0, 1.6))
	}
	g.add(ctx.box(3.2, 1.4, 1.6, M.white, 0, 0, -0.4))
	g.add(ctx.box(3.22, 0.16, 1.62, M.orange, 0, 1.1, -0.4))
	stackLight(ctx, g, 1.6, 1.4, -1.2, blink)
	return { group: g, colliders: [{ x: -1.4, z: 0.4, r: 1.5 }, { x: 1.4, z: 0.4, r: 1.5 }] }
}

/** The float bath: a long, low enclosure over a pool of molten tin, glowing through its ports. */
function floatBath(ctx: FactoryCtx, blink: THREE.Mesh[]): Part {
	const g = new THREE.Group()
	g.add(ctx.box(12, 1.6, 3.4, M.graphite))
	g.add(ctx.box(12.02, 0.14, 3.42, M.orange, 0, 1.3, 0))
	for (let i = 0; i < 8; i++) {
		const port = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), M.furnace)
		port.position.set(-5.2 + i * 1.5, 0.8, -1.71)
		port.rotation.y = Math.PI
		g.add(port)
	}
	for (let i = 0; i < 6; i++) g.add(ctx.box(0.3, 1.2, 0.3, M.steel, -5 + i * 2, 1.6, 0))
	console_(ctx, g, 5, -2.4)
	stackLight(ctx, g, -5.7, 1.6, -1.5, blink)
	return { group: g, colliders: Array.from({ length: 5 }, (_, i) => ({ x: -4.8 + i * 2.4, z: 0, r: 1.9 })) }
}

/** Cable drums: the finished solar cable wound onto wooden reels, turning as they fill. */
function drums(ctx: FactoryCtx, blink: THREE.Mesh[]): Part {
	const g = new THREE.Group()
	const wood = col('#a8804f', 0.9)
	const cable = col('#1d1f22', 0.6)
	const reels: THREE.Group[] = []
	for (const x of [-1.6, 0, 1.6]) {
		const reel = new THREE.Group()
		for (const sd of [-1, 1]) {
			const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 24), wood)
			flange.rotation.x = Math.PI / 2
			flange.position.z = sd * 0.35
			reel.add(flange)
		}
		const core = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.62, 24), cable)
		core.rotation.x = Math.PI / 2
		reel.add(core)
		reel.position.set(x, 0.9, 1)
		g.add(reel)
		reels.push(reel)
	}
	g.add(ctx.box(4.8, 0.2, 1.2, M.graphite, 0, 0, 1))
	g.add(ctx.box(2.4, 1.4, 1.1, M.white, 0, 0, -0.9))
	stackLight(ctx, g, 1, 1.4, -1.3, blink)
	return { group: g, colliders: [{ x: -1.5, z: 0.4, r: 1.5 }, { x: 1.5, z: 0.4, r: 1.5 }], update: (t) => reels.forEach((r, i) => (r.rotation.z = t * (0.6 + i * 0.15))) }
}

/* ── the works ────────────────────────────────────────────────────────── */

type Station = { name: string; note: string; make: (ctx: FactoryCtx, blink: THREE.Mesh[]) => Part; arm?: boolean }

const t = (len: number, h: number, body: THREE.Material, inside: THREE.Material | null) => (ctx: FactoryCtx, blink: THREE.Mesh[]) => tunnel(ctx, len, h, body, inside, blink)

/**
 * The recipe, floor by floor, from the smallest parts at the top to the
 * largest assembly at the bottom — everything from raw material, in one dome:
 * silicon from quartz, copper wire and cable, the electronics, glass from
 * sand, then the modules, their frames, and the dome kits they leave in.
 */
const RECIPE: Station[][] = [
	[
		{ name: 'Aluminium extrusion', note: 'billets pressed into frame profiles', make: t(9, 2.6, M.graphite, M.furnace) },
		{ name: 'Anodising', note: 'the frames sealed against the weather', make: t(6, 2.4, M.white, M.wash) },
		{ name: 'Framing', note: 'triangle frame and gasket pressed on', make: t(4.2, 2.6, M.white, M.amber), arm: true },
		{ name: 'Sun simulator', note: 'IV curve under a 1000 W/m² flash', make: (ctx) => flashBooth(ctx), arm: true },
		{ name: 'EL final', note: 'electroluminescence: every crack shows', make: t(4, 2.4, M.white, M.screen) },
		{ name: 'Hi-pot', note: 'insulation test at 3 kV', make: t(3.4, 2.2, M.white, M.amber) },
		{ name: 'Grading & labels', note: 'power class, serial, the dome it is for', make: t(3, 2, M.grey, M.screen), arm: true },
		{ name: 'Strut welding', note: 'steel struts for the dome frame', make: t(5, 2.4, M.graphite, M.ir), arm: true },
		{ name: 'Hub machining', note: 'every hub milled to its angles', make: t(3.4, 2.4, M.grey, M.screen), arm: true },
		{ name: 'Dome kits', note: 'triangles, struts and hubs, sorted by dome', make: (ctx) => gantry(ctx, 7, 8, M.cellBlue), arm: true },
		{ name: 'Packing', note: 'onto A-frame racks', make: t(3.6, 2.6, M.white, null), arm: true },
		{ name: 'Stretch wrap', note: 'each rack wrapped for the road', make: t(3, 2.8, M.graphite, M.film) },
		{ name: 'Dispatch', note: 'out to the domes of the village', make: t(3, 2.6, M.white, M.light) }
	],
	[
		{ name: 'Encapsulant', note: 'POE film extruded from pellets', make: t(6, 2.4, M.white, M.film) },
		{ name: 'Stringer 1', note: 'cells and ribbons soldered into strings', make: t(8, 1.9, M.white, M.ir) },
		{ name: 'Stringer 2', note: 'cells and ribbons soldered into strings', make: t(8, 1.9, M.white, M.ir) },
		{ name: 'Glass & film', note: 'front glass in from below, film laid on', make: t(3.4, 2.4, M.white, M.film), arm: true },
		{ name: 'String layup', note: 'strings placed by gantry', make: (ctx) => gantry(ctx, 6, 7, M.cellBlue) },
		{ name: 'Bussing', note: 'busbars soldered across', make: t(3.6, 2.2, M.white, M.ir), arm: true },
		{ name: 'Back glass', note: 'glass both sides: light between the cells', make: (ctx) => gantry(ctx, 5, 9, M.glassWall), arm: true },
		{ name: 'EL check', note: 'before lamination, while it can be fixed', make: t(3.6, 2.4, M.white, M.screen) },
		{ name: 'Laminators', note: 'vacuum, 145 °C, fifteen minutes', make: (ctx, b) => laminators(ctx, b), arm: true },
		{ name: 'Laminators', note: 'three presses, stacked', make: (ctx, b) => laminators(ctx, b), arm: true },
		{ name: 'Trimming', note: 'excess film cut from the edges', make: t(3.4, 2.2, M.grey, M.laser), arm: true },
		{ name: 'Junction box', note: 'glued on, cables soldered, potted', make: t(3.4, 2.2, M.grey, M.screen), arm: true }
	],
	[
		{ name: 'Batch house', note: 'sand, soda ash, limestone, dolomite, weighed and mixed', make: (ctx, b) => silos(ctx, b) },
		{ name: 'Melting furnace', note: '1550 °C: the batch becomes glass', make: t(10, 3, M.graphite, M.furnace) },
		{ name: 'Float bath', note: 'molten glass floats on liquid tin, dead flat', make: (ctx, b) => floatBath(ctx, b) },
		{ name: 'Annealing lehr', note: 'cooled slowly, free of stress', make: t(10, 2.2, M.white, M.amber) },
		{ name: 'Cutting', note: 'triangles scored and broken', make: (ctx) => gantry(ctx, 6, 6, M.glassWall), arm: true },
		{ name: 'Edge grinding', note: 'every edge seamed', make: t(4, 2.2, M.white, M.wash) },
		{ name: 'Washing', note: 'deionised water, dried by air knives', make: t(5, 2.4, M.white, M.wash) },
		{ name: 'Tempering', note: '700 °C, then quenched by air', make: t(12, 2.6, M.graphite, M.furnace) },
		{ name: 'AR coating', note: 'anti-reflective: more light through', make: t(5, 2.4, M.white, M.amber) },
		{ name: 'Inspection', note: 'scanned for flaws', make: t(3, 2.2, M.grey, M.screen), arm: true }
	],
	[
		{ name: 'Wire drawing', note: 'copper rod drawn down to wire', make: t(6, 2, M.grey, M.amber) },
		{ name: 'Annealing', note: 'the drawn wire softened again', make: t(4, 2.2, M.graphite, M.furnace) },
		{ name: 'Ribbon line', note: 'flattened, tin-plated: the ribbons that join the cells', make: t(5, 2.2, M.white, M.amber) },
		{ name: 'Cable extrusion', note: 'insulation round the copper: solar cable', make: t(8, 2.2, M.white, M.ir) },
		{ name: 'Cable drums', note: 'the cable wound onto reels', make: (ctx, b) => drums(ctx, b) },
		{ name: 'Connectors', note: 'plug housings, injection-moulded', make: t(3.4, 2.6, M.grey, M.screen), arm: true },
		{ name: 'Box moulding', note: 'junction box and lid', make: t(3.4, 2.6, M.grey, M.screen), arm: true },
		{ name: 'Paste printer', note: 'solder paste on the circuit boards', make: t(2.6, 2, M.white, M.light) },
		{ name: 'Pick and place', note: 'diodes and chips, twenty thousand an hour', make: (ctx) => gantry(ctx, 4, 3, M.screen) },
		{ name: 'Reflow oven', note: 'the boards soldered at 245 °C', make: t(6, 2, M.white, M.furnace) },
		{ name: 'Optical inspection', note: 'every joint checked by camera', make: t(2.8, 2.2, M.grey, M.screen) },
		{ name: 'Box assembly', note: 'board, diodes and cables into the box', make: t(3.4, 2.2, M.white, M.amber), arm: true }
	],
	[
		{ name: 'Arc furnace', note: 'quartz and carbon become silicon, 1900 °C', make: (ctx, b) => arcFurnace(ctx, b) },
		{ name: 'Purification', note: 'silicon refined to 99.9999 %', make: t(5, 2.8, M.graphite, M.amber) },
		{ name: 'Ingot puller', note: 'one crystal pulled from the melt, 1420 °C', make: (ctx, b) => puller(ctx, b) },
		{ name: 'Ingot puller', note: 'a crystal a day from each', make: (ctx, b) => puller(ctx, b) },
		{ name: 'Wire saw', note: 'wafers sliced 150 µm thin', make: t(4, 2.4, M.white, M.wash), arm: true },
		{ name: 'Texturing', note: 'etched to trap the light', make: t(5, 2.2, M.white, M.wash) },
		{ name: 'Diffusion', note: 'the p–n junction, 850 °C', make: t(7, 2.4, M.graphite, M.furnace) },
		{ name: 'PECVD', note: 'the blue anti-reflective layer', make: t(5, 2.4, M.white, M.screen) },
		{ name: 'Screen printing', note: 'silver fingers and busbars', make: t(3.6, 2.2, M.grey, M.light), arm: true },
		{ name: 'Firing', note: 'contacts fired in at 800 °C', make: t(6, 2.2, M.white, M.furnace) },
		{ name: 'Cell tester', note: 'every cell sorted by IV and EL', make: t(3, 2.2, M.grey, M.screen), arm: true }
	]
]

export function buildFactory(ctx: FactoryCtx): FactoryWalk {
	const { scene, R, box, bake } = ctx
	const colliders: Collider[] = []
	const updates: ((t: number, dt: number) => void)[] = []
	const blink: THREE.Mesh[] = []
	const slabOuter = (y: number) => Math.sqrt(R * R - (y + 2.5) ** 2) - 1.2
	const stationAngles: { a: number; r: number }[][] = []

	/* the belt runs flat all the way round; where the paths from the doors meet it,
	   people climb a footbridge over it instead */
	const beltY = (_a: number, _ring: number) => BELT
	const BR = { a: MAIN - 4.9, b: MAIN - 1.6, c: MAIN + 1.6, d: MAIN + 4.9, h: 1.95, half: 1.15 }
	/** The height of a footbridge's deck or steps above its floor at (x, z), or null off every bridge. */
	const bridgeY = (x: number, z: number) => {
		const rr = Math.hypot(x, z)
		if (rr < BR.a || rr > BR.d) return null
		const a = Math.atan2(x, z)
		if (!DOORS.some((d) => Math.abs(adiff(a, d)) * rr < BR.half)) return null
		if (rr < BR.b) return (BR.h * (rr - BR.a)) / (BR.b - BR.a)
		if (rr > BR.c) return (BR.h * (BR.d - rr)) / (BR.d - BR.c)
		return BR.h
	}
	const onBridge = (x: number, z: number) => {
		const rr = Math.hypot(x, z), a = Math.atan2(x, z)
		return rr >= LANDING - 0.2 && rr <= FLOOR_IN + 0.2 && SPURS.some((s) => Math.abs(adiff(a, s)) * rr < 1.9)
	}
	/* ── the lift: one great round cabin in the tower, carrying people, robots
	   and racks between the five floors. Inside it, ↑ and ↓ send it a floor up
	   or down; walk up to the shaft on any floor and it comes to fetch you. ── */
	const CABIN = CORE - 0.35
	const DOOR_HALF = 1.5
	const inCabin = (x: number, z: number) => Math.hypot(x, z) < CORE
	let cabY = 0
	let target = 0
	let lastT = 0
	let held = 0
	let arrived = 0
	let px = 0, pz = R - 8, pf = 0
	const idle = () => Math.abs(cabY - LEVELS[target]!) < 0.01
	const nearestLevel = (y: number) => LEVELS.reduce((best, ly, k) => (Math.abs(ly - y) < Math.abs(LEVELS[best]! - y) ? k : best), 0)

	const levelFloor = (k: number, x: number, z: number) => {
		const rr = Math.hypot(x, z)
		if (rr < CORE) return false
		if (k === 0) return true
		if (rr >= FLOOR_IN && rr <= slabOuter(LEVELS[k]!)) return true
		if (rr <= LANDING) return true
		return onBridge(x, z)
	}
	const hasFloorAt = (x: number, z: number, y: number) => {
		if (inCabin(x, z)) return Math.abs(cabY - y) < 0.35
		const by = bridgeY(x, z)
		if (by !== null && LEVELS.some((ly) => Math.abs(ly + by - y) < 0.45)) return true
		return LEVELS.some((ly, k) => Math.abs(ly - y) < 0.35 && levelFloor(k, x, z))
	}
	/** Into or out of the cabin only through one of its four doors, and only when it stands at your floor. */
	const throughDoor = (x: number, z: number) => SPURS.some((s) => Math.abs(adiff(Math.atan2(x, z), s)) * CORE < DOOR_HALF - 0.3)

	const top = LEVELS[LEVELS.length - 1]! + 6
	{
		const tower = new THREE.Group()
		// the shaft: glass between steel columns, open at the four doors on every floor
		const gap = DOOR_HALF / CORE
		for (const s of SPURS) {
			const wall = new THREE.Mesh(new THREE.CylinderGeometry(CORE, CORE, top, 32, 1, true, s + gap, Math.PI / 2 - 2 * gap), M.glassWall)
			wall.position.y = top / 2
			scene.add(wall)
			for (const sd of [-1, 1]) {
				const [x, z] = polar(CORE, s + sd * gap)
				tower.add(box(0.28, top, 0.28, M.graphite, x, 0, z))
			}
		}
		for (const d of DOORS) {
			const [x, z] = polar(CORE, d)
			tower.add(box(0.36, top, 0.36, M.graphite, x, 0, z))
		}
		for (const y of LEVELS) {
			const band = new THREE.Mesh(new THREE.TorusGeometry(CORE, 0.14, 6, 64), M.graphite)
			band.rotation.x = Math.PI / 2
			band.position.y = y + 3.1
			tower.add(band)
		}
		// the machine room on top: the hoist, its sheave, its motor
		const room = new THREE.Mesh(new THREE.CylinderGeometry(CORE + 0.4, CORE + 0.4, 2.4, 32), M.white)
		room.position.y = top + 1.2
		tower.add(room)
		tower.add(box(CORE * 2 + 1, 0.3, 1.2, M.orange, 0, top + 2.4, 0))
		const sheave = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.12, 8, 24), M.graphite)
		sheave.position.set(0, top + 3.3, 0)
		tower.add(sheave)
		tower.add(box(1.4, 1.1, 1.1, M.blue, 1.6, top + 2.7, 0))
		scene.add(bake(tower))
	}
	const cabin = new THREE.Group()
	{
		cabin.add(box(0.1, 0.1, 0.1, M.graphite))
		const floor = new THREE.Mesh(new THREE.CylinderGeometry(CABIN, CABIN, 0.25, 48), M.graphite)
		floor.position.y = -0.125
		cabin.add(floor)
		const tread = new THREE.Mesh(new THREE.CircleGeometry(CABIN - 0.1, 48), M.slab)
		tread.rotation.x = -Math.PI / 2
		tread.position.y = 0.01
		cabin.add(tread)
		const roof = new THREE.Mesh(new THREE.CylinderGeometry(CABIN, CABIN, 0.3, 48), M.white)
		roof.position.y = 3
		cabin.add(roof)
		const light = new THREE.Mesh(new THREE.CircleGeometry(CABIN - 0.8, 40), M.light)
		light.rotation.x = Math.PI / 2
		light.position.y = 2.84
		cabin.add(light)
		// its glass walls and handrail, open at the four doors
		const gap = DOOR_HALF / CABIN
		for (const s of SPURS) {
			const wall = new THREE.Mesh(new THREE.CylinderGeometry(CABIN, CABIN, 2.85, 24, 1, true, s + gap, Math.PI / 2 - 2 * gap), M.glassWall)
			wall.position.y = 1.43
			cabin.add(wall)
			const rail = new THREE.Mesh(new THREE.TorusGeometry(CABIN - 0.12, 0.035, 6, 24, Math.PI / 2 - 2 * gap), M.steel)
			rail.rotation.x = -Math.PI / 2
			const holder = new THREE.Group()
			holder.add(rail)
			holder.rotation.y = s + gap - Math.PI / 2
			holder.position.y = 1
			cabin.add(holder)
			for (const sd of [-1, 1]) {
				const [x, z] = polar(CABIN, s + sd * gap)
				cabin.add(box(0.14, 2.85, 0.14, M.steel, x, 0, z))
			}
		}
		// the control post: a screen with the floor on it
		cabin.add(box(0.3, 1.2, 0.3, M.graphite, 0, 0, 0))
		const panel = box(0.5, 0.35, 0.05, M.screen, 0, 1.15, 0.16)
		panel.rotation.x = -0.4
		cabin.add(panel)
		// a rack of finished triangles riding down with you
		cabin.add(box(1.8, 0.15, 1.2, M.graphite, -2.8, 0, 0))
		for (const sd of [-1, 1]) {
			const leaf = box(1.7, 1.7, 0.06, M.cellBlue, -2.8, 0.15, sd * 0.25)
			leaf.rotation.x = sd * 0.12
			cabin.add(leaf)
		}
		cabin.traverse((o) => (o.castShadow = true))
		scene.add(cabin)
	}
	colliders.push({ x: 0, z: 0, r: 0.35, y: 0 })
	colliders.push({ x: -2.8, z: 0, r: 1.1, y: 0 })
	// the hoist ropes, from the cabin roof to the machine room
	const ropes = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => {
		const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), M.steel)
		r.position.set(sx * 0.5, 0, sz * 0.5)
		scene.add(r)
		return r
	}))
	updates.push((time) => {
		const dt = Math.min(0.1, time - lastT)
		lastT = time
		// the cabin runs at two and a half metres a second, easing into each floor
		const goal = LEVELS[target]!
		const dist = goal - cabY
		const v = Math.sign(dist) * Math.min(2.5, Math.max(0.35, Math.abs(dist) * 1.6))
		const was = cabY
		cabY = Math.abs(dist) < Math.abs(v * dt) ? goal : cabY + v * dt
		if (was !== goal && cabY === goal) arrived = time
		// held down, it pauses at each floor for a moment, then goes on
		if (held && idle() && time - arrived > 1.2 && inCabin(px, pz)) {
			const next = Math.max(0, Math.min(LEVELS.length - 1, target + held))
			if (next !== target) target = next
		}
		cabin.position.y = cabY
		for (const c of cabinColliders) c.y = cabY
		for (const r of ropes) {
			const len = top + 2.4 - (cabY + 3.15)
			r.scale.y = Math.max(0.01, len)
			r.position.y = cabY + 3.15 + len / 2
		}
		// the landing call: someone at the shaft on another floor, and the lift comes
		const rr = Math.hypot(px, pz)
		if (idle() && rr >= CORE && rr < CORE + 3.2 && Math.abs(pf - cabY) > 0.5) target = nearestLevel(pf)
	})
	// the colliders in the cabin ride with it
	const cabinColliders = colliders.filter((c) => c.x === -2.8 || (c.x === 0 && c.z === 0 && c.r === 0.35))

	/* ── the floors ── */
	for (let k = 0; k < LEVELS.length; k++) {
		const y = LEVELS[k]!
		const outer = k === 0 ? R - 1 : slabOuter(y)
		const g = new THREE.Group()
		if (k > 0) {
			// the slab: a ring round the tower, the landing, four bridges; lights under it for the floor below
			const slab = new THREE.Mesh(new THREE.RingGeometry(FLOOR_IN, outer, 160, 1), M.slab)
			slab.rotation.x = -Math.PI / 2
			slab.position.y = y
			slab.receiveShadow = true
			scene.add(slab)
			const land = new THREE.Mesh(new THREE.RingGeometry(CORE, LANDING, 64, 1), M.slab)
			land.rotation.x = -Math.PI / 2
			land.position.y = y
			scene.add(land)
			for (const ring of [[FLOOR_IN, outer], [CORE, LANDING]] as const) {
				const under = new THREE.Mesh(new THREE.RingGeometry(ring[0], ring[1], 96, 1), M.under)
				under.rotation.x = Math.PI / 2
				under.position.y = y - 0.45
				scene.add(under)
				for (const rr of ring) {
					const edge = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 0.45, 96, 1, true), M.under)
					edge.position.y = y - 0.22
					;(edge.material as THREE.Material).side = THREE.DoubleSide
					scene.add(edge)
				}
			}
			// light fittings in rows under the slab, and the ducts that feed the machines below
			for (const rr of [19, 31, 49]) {
				if (rr > outer - 1) continue
				const count = Math.round((2 * Math.PI * rr) / 5)
				const fittings = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.08, 0.35), M.light, count)
				const m4 = new THREE.Matrix4()
				for (let i = 0; i < count; i++) {
					const a = (i / count) * Math.PI * 2
					const [x, z] = polar(rr, a)
					fittings.setMatrixAt(i, m4.makeRotationY(a + Math.PI / 2).setPosition(x, y - 0.55, z))
				}
				scene.add(fittings)
			}
			for (const rr of [31.8, 46]) {
				if (rr > outer - 2) continue
				const duct = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.32, 8, 160), M.duct)
				duct.rotation.x = Math.PI / 2
				duct.position.y = y - 1.05
				scene.add(duct)
			}
			for (const s of SPURS) {
				const [x, z] = polar((LANDING + FLOOR_IN) / 2, s)
				g.add(box(3.8, 0.45, FLOOR_IN - LANDING + 0.4, M.slab, x, y - 0.45, z, s))
				// railings along the bridge
				for (const side of [-1, 1]) {
					const [ox, oz] = polar(1.85, s + Math.PI / 2)
					g.add(box(0.06, 1.05, FLOOR_IN - LANDING, M.steel, x + ox * side, y, z + oz * side, s))
				}
			}
			// railings at the inner edge of the ring and the outer edge of the landing, open at the bridges
			for (const rr of [FLOOR_IN, LANDING]) {
				const gap = 1.95 / rr
				for (const s of SPURS) {
					const arc = Math.PI / 2 - 2 * gap
					const glass = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 1.05, 32, 1, true, s + gap, arc), M.glassWall)
					glass.position.y = y + 0.52
					scene.add(glass)
					const topRail = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.04, 6, 40, arc), M.steel)
					topRail.rotation.x = -Math.PI / 2
					const holder = new THREE.Group()
					holder.add(topRail)
					holder.rotation.y = s + gap - Math.PI / 2
					holder.position.y = y + 1.05
					scene.add(holder)
				}
			}
			// columns carrying this floor, standing on the one below
			const h = y - LEVELS[k - 1]! - 0.45
			for (const rr of [FLOOR_IN + 0.5, outer - 2.5])
				for (let c = 0; c < 16; c++) {
					const a = ((c + 0.5) / 16) * Math.PI * 2
					const [x, z] = polar(rr, a)
					g.add(box(0.6, h, 0.6, M.grey, x, LEVELS[k - 1]!, z))
					colliders.push({ x, z, r: 0.5, y: LEVELS[k - 1]! })
				}
		} else {
			const floor = new THREE.Mesh(new THREE.CircleGeometry(R - 0.3, 128), M.slab)
			floor.rotation.x = -Math.PI / 2
			floor.position.y = 0.012
			floor.receiveShadow = true
			scene.add(floor)
		}
		/* One main line per floor, a loop near the outside of the hall, and the
		   stations on spokes pointing inward, like the lines of a star. The work
		   leaves the loop on an in-lane, rides in to its machine, and comes back
		   out on the out-lane to rejoin the loop one station further on, carrying
		   whatever that station added. */
		const stations = RECIPE[k]!
		const parts = stageParts(k, stations.length)
		const placedAt: { a: number; r: number }[] = []
		stationAngles.push(placedAt)
		// the raw material drops onto the loop from the lift's overhead conveyor, and the finished part rides back up there
		const aStart = SPURS[0]!
		const clearOf = (a: number) => DOORS.every((d) => Math.abs(adiff(a, d)) * MAIN > 9) && SPURS.every((sp) => Math.abs(adiff(a, sp)) * MAIN > 4.5)
		// the free stretches of the loop, walked round from where the work comes in
		const free: number[] = []
		for (let t = 0.01; t < Math.PI * 2 - 0.01; t += 0.004) if (clearOf(aStart + t)) free.push(aStart + t)
		// spokes evenly spaced along them, every station once and the slowest ones twice, side by side,
		// so there is never a wide gap on the loop
		const count = Math.min(stations.length * 2, Math.max(stations.length, Math.floor((free.length * 0.004 * MAIN) / 11)))
		const extra = count - stations.length
		const doubled = new Set(Array.from({ length: extra }, (_, j) => Math.floor(((j + 0.5) * stations.length) / extra)))
		const which = stations.flatMap((_, i) => (doubled.has(i) ? [i, i] : [i]))
		const spokes: { a: number; inner: number; outer: number; si: number }[] = []
		which.forEach((i, j) => {
			const st = stations[i]!
			const twin = j > 0 && which[j - 1] === i
			const a = free[Math.floor(((j + 0.5) * free.length) / which.length)]!
			// the machine at the inner end of its spoke, its length along the spoke
			const part = st.make(ctx, blink)
			const bb = new THREE.Box3().setFromObject(part.group)
			const half = Math.max(-bb.min.x, bb.max.x)
			const scale = Math.min(1.15, 5 / half)
			const inner = 23
			const rs = inner + half * scale
			const outerEnd = rs + half * scale
			spokes.push({ a, inner, outer: outerEnd, si: i })
			placedAt.push({ a, r: inner - 1.3 })
			// a dev hook for the journal's camera: where every station stands
			;((window as unknown as { __factoryStations?: object[] }).__factoryStations ??= []).push({ k, a, name: st.name, inner, outer: outerEnd })
			const [x, z] = polar(rs, a)
			const th = a + Math.PI / 2
			part.group.position.set(x, y, z)
			part.group.rotation.y = th
			part.group.scale.setScalar(scale)
			scene.add(part.group)
			const c = Math.cos(th), sn = Math.sin(th)
			for (const p of part.colliders) colliders.push({ x: x + scale * (p.x * c + p.z * sn), z: z + scale * (-p.x * sn + p.z * c), r: p.r * scale, y })
			if (part.update) updates.push(part.update)
			// its two lanes, in and out, from the loop right into the machine's mouth
			const from = outerEnd - 0.7
			const len = MAIN - 1.15 - from
			const tx = Math.cos(a), tz = -Math.sin(a)
			for (const side of [-1, 1]) {
				const [lx, lz] = polar(from + len / 2, a)
				const ox = lx + tx * side * 1.05, oz = lz + tz * side * 1.05
				g.add(box(1.25, 0.1, len, M.belt, ox, y + BELT - 0.1, oz, a))
				for (const rail of [-0.66, 0.66]) g.add(box(0.06, 0.14, len, M.graphite, ox + tx * rail, y + BELT - 0.05, oz + tz * rail, a))
				for (let l = 1; l < len; l += 2.6) {
					const [px, pz] = polar(from + l, a)
					g.add(box(0.08, BELT - 0.1, 0.08, M.steel, px + tx * side * 1.05, y, pz + tz * side * 1.05))
				}
			}
			for (let l = 1.2; l < len; l += 2.4) {
				const [cx, cz] = polar(from + l, a)
				colliders.push({ x: cx, z: cz, r: 1.5, y })
			}
			// halfway out, a camera gate over both lanes
			{
				const [hx, hz] = polar(from + len * 0.55, a)
				for (const side of [-1, 1]) g.add(box(0.12, 2.3, 0.12, M.graphite, hx + tx * side * 1.85, y, hz + tz * side * 1.85))
				g.add(box(3.9, 0.26, 0.26, M.graphite, hx, y + 2.3, hz, a + Math.PI / 2))
				g.add(box(3.2, 0.04, 0.16, M.wash, hx, y + 2.27, hz, a + Math.PI / 2))
			}
			// the merge onto the loop, a transfer table either side
			for (const side of [-1, 1]) {
				const [mx, mz] = polar(MAIN - 1.6, a)
				g.add(box(1.3, 1.05, 1.2, M.grey, mx + tx * side * 1.05, y, mz + tz * side * 1.05, a))
			}
			// its sign over the inner end, facing the aisle round the tower (a twin line shares it)
			if (!twin) {
				const [bx, bz] = polar(inner - 1.4, a)
				const board = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.78), sign(`${k}.${i + 1}`, st.name, st.note))
				board.position.set(bx, y + 4.3, bz)
				board.rotation.y = a + Math.PI
				scene.add(board)
				g.add(box(0.04, 1.4, 0.04, M.steel, bx, y + 4.7, bz))
			}
			// its robot beside the lanes where they meet the machine, behind a fence
			if (st.arm && !twin) {
				const [ax, az] = polar(outerEnd + 1.6, a)
				const px = ax + tx * 3.1, pz = az + tz * 3.1
				const arm = robotArm(ctx, i % 2 ? M.orange : M.white, 0, Math.PI * 0.75, 5 + (i % 3), i * 0.37)
				arm.group.position.set(px, y, pz)
				arm.group.rotation.y = a - Math.PI / 2
				arm.group.scale.setScalar(0.8)
				scene.add(arm.group)
				colliders.push({ x: px, z: pz, r: 1.3, y })
				updates.push(arm.update!)
				const fence = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.3, 18, 1, true, a - Math.PI / 2 + 0.6, Math.PI * 2 - 1.2), M.fence)
				fence.position.set(px, y + 0.65, pz)
				scene.add(fence)
			}
		})

		/* the loop itself, climbing over the four crossing paths */
		{
			const pos: number[] = [], idx: number[] = []
			const steps = 560
			for (let i = 0; i <= steps; i++) {
				const a = (i / steps) * Math.PI * 2
				const by = y + beltY(a, MAIN)
				const [x0, z0] = polar(MAIN - 1.1, a)
				const [x1, z1] = polar(MAIN + 1.1, a)
				pos.push(x0, by, z0, x1, by, z1)
				if (i < steps) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
			}
			const geo = new THREE.BufferGeometry()
			geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
			geo.setIndex(idx)
			geo.computeVertexNormals()
			const belt = new THREE.Mesh(geo, M.belt)
			;(belt.material as THREE.Material).side = THREE.DoubleSide
			scene.add(belt)
			const legs = Math.round((2 * Math.PI * MAIN) / 2.6)
			for (let i = 0; i < legs; i++) {
				const a = (i / legs) * Math.PI * 2
				const by = beltY(a, MAIN)
				for (const side of [-1, 1]) {
					const [lx, lz] = polar(MAIN + side * 1.2, a)
					g.add(box(0.1, by, 0.1, M.steel, lx, y, lz))
					const [fx, fz] = polar(MAIN + side * 1.25, a)
					g.add(box(2.7, 0.18, 0.08, M.graphite, fx, y + by - 0.05, fz, a + Math.PI / 2))
				}
				if (by < BELT + 0.4) {
					const [cx, cz] = polar(MAIN, a)
					colliders.push({ x: cx, z: cz, r: 1.4, y })
				}
			}
			for (const rr of [MAIN - 2.2, MAIN + 2.2, 18.8]) {
				const lane = new THREE.Mesh(new THREE.RingGeometry(rr - 0.06, rr + 0.06, 240, 1), M.yellow)
				lane.rotation.x = -Math.PI / 2
				lane.position.y = y + 0.02
				scene.add(lane)
			}
		}

		/* the footbridges: steps up, a deck over the belt, steps down, rails either side */
		for (const d of DOORS) {
			const tx = Math.cos(d), tz = -Math.sin(d)
			const steps = 8
			for (const [r0, r1] of [[BR.a, BR.b], [BR.d, BR.c]] as const)
				for (let i = 0; i < steps; i++) {
					const rr = r0 + ((i + 0.5) / steps) * (r1 - r0)
					const [x, z] = polar(rr, d)
					g.add(box(BR.half * 2, 0.08, Math.abs(r1 - r0) / steps + 0.04, M.grey, x, y + ((i + 1) / steps) * BR.h - 0.08, z, d))
					g.add(box(BR.half * 2 + 0.02, 0.02, 0.06, M.yellow, x, y + ((i + 1) / steps) * BR.h, z, d))
				}
			const [dx, dz] = polar(MAIN, d)
			g.add(box(BR.half * 2, 0.14, BR.c - BR.b + 0.1, M.grey, dx, y + BR.h - 0.14, dz, d))
			for (const side of [-1, 1]) {
				const ox = tx * side * BR.half, oz = tz * side * BR.half
				for (const [rr, hh] of [[BR.a + 0.3, 0.2], [BR.b, BR.h], [MAIN, BR.h], [BR.c, BR.h], [BR.d - 0.3, 0.2]] as const) {
					const [px, pz] = polar(rr, d)
					g.add(box(0.06, hh + 1, 0.06, M.yellow, px + ox, y, pz + oz))
				}
				// the hand rail, up the steps, across, and down
				for (const [r0, r1, h0, h1] of [[BR.a + 0.3, BR.b, 0.2, BR.h], [BR.b, BR.c, BR.h, BR.h], [BR.c, BR.d - 0.3, BR.h, 0.2]] as const) {
					const a = new THREE.Vector3(...polar(r0, d).flatMap((v, i) => (i === 0 ? [v + ox, y + h0 + 1] : [v + oz])) as [number, number, number])
					const b = new THREE.Vector3(...polar(r1, d).flatMap((v, i) => (i === 0 ? [v + ox, y + h1 + 1] : [v + oz])) as [number, number, number])
					const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, a.distanceTo(b), 6), M.yellow)
					rail.position.copy(a).add(b).multiplyScalar(0.5)
					rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
					g.add(rail)
				}
			}
		}

		/* the overhead conveyors from the lift out to the loop */
		for (const sp of SPURS) {
			const len = MAIN - LANDING
			const [x, z] = polar((MAIN + LANDING) / 2, sp)
			g.add(box(1.3, 0.2, len, M.belt, x, y + 3.6, z, sp))
			for (const side of [-1, 1]) {
				const [ox, oz] = polar(0.7, sp + Math.PI / 2)
				g.add(box(0.08, 0.3, len, M.steel, x + ox * side, y + 3.55, z + oz * side, sp))
			}
			const [dx, dz] = polar(MAIN, sp)
			g.add(box(1.5, 2.6, 1.5, M.grey, dx, y + 1.2, dz, sp))
			g.add(box(0.1, 0.8, 0.1, M.steel, dx, y + 3.8, dz))
		}

		/* the work: every tray looks like what the stations before it have made of it */
		{
			const n = Math.round((2 * Math.PI * MAIN) / 3.6)
			const perLane = 3
			const cap = n + spokes.length * perLane * 2 + 4
			const meshes = parts.geos.map((geo) => {
				const mesh = new THREE.InstancedMesh(geo, parts.material, cap)
				mesh.frustumCulled = false
				mesh.castShadow = true
				mesh.count = 0
				scene.add(mesh)
				return mesh
			})
			const order = spokes.map((s) => ({ o: ((s.a - aStart) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), si: s.si }))
			// on the loop, a tray is what the last station it passed made of it
			const stageAt = (a: number) => {
				const d = ((a - aStart) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
				let stage = 0
				for (const s of order) if (s.o < d) stage = Math.max(stage, s.si + 1)
				return stage
			}
			const counts = meshes.map(() => 0)
			const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zAxis = new THREE.Vector3(0, 0, 1)
			const put = (stage: number, mat: THREE.Matrix4) => {
				const mesh = meshes[Math.min(stage, meshes.length - 1)]!
				const i = counts[Math.min(stage, meshes.length - 1)]!++
				if (i < cap) mesh.setMatrixAt(i, mat)
			}
			updates.push((time) => {
				counts.fill(0)
				for (let i = 0; i < n; i++) {
					const ang = (i / n) * Math.PI * 2 + (time * 0.6) / MAIN
					const [x, z] = polar(MAIN, ang)
					const slope = (beltY(ang + 0.02, MAIN) - beltY(ang - 0.02, MAIN)) / (0.04 * MAIN)
					p.set(x, y + beltY(ang, MAIN) + 0.04, z)
					q.setFromEuler(e.set(0, ang + Math.PI / 2, 0)).multiply(tilt.setFromAxisAngle(zAxis, Math.atan(slope)))
					put(stageAt(ang), m4.compose(p, q, one))
				}
				spokes.forEach((s, si) => {
					const tx = Math.cos(s.a), tz = -Math.sin(s.a)
					// the trays ride right into the machine's mouth and out of it
					const from = s.outer - 1.2
					const len = MAIN - 1.15 - from
					for (const side of [-1, 1])
						for (let j = 0; j < perLane; j++) {
							const u = ((j / perLane + time * 0.05 + si * 0.13) % 1 + 1) % 1
							// in on one lane, before the station's work; out on the other, after it
							const rr = side < 0 ? MAIN - 1.15 - u * len : from + u * len
							const [x, z] = polar(rr, s.a)
							p.set(x + tx * side * 1.05, y + BELT + 0.02, z + tz * side * 1.05)
							q.setFromEuler(e.set(0, s.a, 0))
							put(side < 0 ? s.si : s.si + 1, m4.compose(p, q, one))
						}
				})
				meshes.forEach((mesh, i) => {
					mesh.count = Math.min(cap, counts[i]!)
					mesh.instanceMatrix.needsUpdate = true
				})
			})
		}

		/* between the spokes the loop is never bare: guarded runs, camera gates, buffer towers */
		{
			const n = Math.floor((2 * Math.PI * MAIN) / 4.6)
			for (let i = 0; i < n; i++) {
				const a = (i / n) * Math.PI * 2
				if (beltY(a, MAIN) > BELT + 0.05 || DOORS.some((d) => Math.abs(adiff(a, d)) * MAIN < 7)) continue
				if (spokes.some((s) => Math.abs(adiff(a, s.a)) * MAIN < 3.6) || SPURS.some((sp) => Math.abs(adiff(a, sp)) * MAIN < 1.8)) continue
				const kind = i % 3
				const mod = new THREE.Group()
				if (kind === 0 || kind === 1) {
					for (const sd of [-1, 1]) {
						mod.add(box(3.6, 0.7, 0.04, M.glassWall, 0, BELT + 0.1, sd * 1.32))
						mod.add(box(0.06, BELT + 0.8, 0.06, M.steel, -1.8, 0, sd * 1.32), box(0.06, BELT + 0.8, 0.06, M.steel, 1.8, 0, sd * 1.32))
					}
					if (kind === 1) {
						mod.add(box(0.14, 2.3, 0.14, M.graphite, 0, 0, -1.45), box(0.14, 2.3, 0.14, M.graphite, 0, 0, 1.45))
						mod.add(box(0.3, 0.3, 3.1, M.graphite, 0, 2.3, 0))
						mod.add(box(0.18, 0.04, 2.6, M.wash, 0, 2.26, 0))
					}
				} else {
					// a buffer tower on the outside of the loop
					mod.add(box(1.6, 2.8, 1.3, M.graphite, 0, 0, 2.2))
					const stock = [M.alu, M.cellBlue, M.glassWall, col('#b8693a', 0.35, 0.8), M.graphite][k]!
					for (let sh = 0; sh < 6; sh++) mod.add(box(1.4, 0.03, 1.1, M.graphite, 0, 0.35 + sh * 0.42, 2.2), box(1.1, 0.14, 0.8, stock, 0, 0.38 + sh * 0.42, 2.2))
					const [bx, bz] = polar(MAIN + 2.2, a)
					colliders.push({ x: bx, z: bz, r: 1, y })
				}
				const [mx, mz] = polar(MAIN, a)
				mod.position.set(mx, y, mz)
				mod.rotation.y = a
				g.add(mod)
			}
		}

		/* stock along the outer aisle: what this floor works from */
		{
			const stock = new THREE.Group()
			const outerAisle = Math.min(outer - 4, 56)
			const count = k === 0 ? 0 : 26
			for (let i = 0; i < count; i++) {
				const sa = ((i + 0.5) / count) * Math.PI * 2
				if (DOORS.some((d) => Math.abs(adiff(sa, d)) * outerAisle < 5)) continue
				const [x, z] = polar(outerAisle, sa)
				const holder = new THREE.Group()
				if (k === 4 || (k === 2 && i % 2)) {
					// bulk bags: quartz sand and carbon for the silicon, sand and soda ash for the glass
					holder.add(box(2.6, 0.15, 1.2, M.pallet))
					for (const bx of [-0.65, 0.65]) holder.add(box(1.1, 1.2, 1.05, k === 4 && bx > 0 ? M.graphite : M.white, bx, 0.15, 0))
				} else if (k === 2) {
					// A-frames of finished glass, waiting to go down
					holder.add(box(2.6, 0.15, 1.4, M.graphite))
					for (const sd of [-1, 1]) {
						const leaf = box(2.5, 2, 0.08, M.glassWall, 0, 0.15, sd * 0.25)
						leaf.rotation.x = sd * 0.12
						holder.add(leaf)
					}
					holder.add(box(0.1, 2.1, 0.1, M.orange, -1.2, 0.15, 0), box(0.1, 2.1, 0.1, M.orange, 1.2, 0.15, 0))
				} else if (k === 3) {
					// coils of copper rod, sacks of polymer pellets
					holder.add(box(2.6, 0.15, 1.2, M.pallet))
					const copper = col('#b8693a', 0.35, 0.8)
					for (const bx of [-0.65, 0.65]) {
						const coil = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.16, 8, 20), i % 2 ? copper : M.white)
						coil.rotation.x = Math.PI / 2
						coil.position.set(bx, 0.33, 0)
						holder.add(coil)
					}
				} else if (k === 1 && i % 2) {
					// shelving of cell cassettes, down from the top floor
					holder.add(box(2.6, 2.2, 0.9, M.grey))
					for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) holder.add(box(0.42, 0.34, 0.6, M.cassette, -1 + c * 0.5, 0.2 + r * 0.5, 0.2))
				} else if (k === 1) {
					// pallets of encapsulant pellets and film rolls
					holder.add(box(1.8, 0.15, 1.2, M.pallet))
					for (let r = 0; r < 3; r++) {
						const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.1, 18), M.film)
						roll.rotation.x = Math.PI / 2
						roll.position.set(-0.55 + r * 0.55, 0.47, 0)
						holder.add(roll)
					}
				} else {
					// aluminium frame profiles, and boxes of junction boxes
					holder.add(box(2.8, 0.15, 1.1, M.pallet))
					for (let r = 0; r < 5; r++) holder.add(box(2.7, 0.1, 1, M.alu, 0, 0.18 + r * 0.12, 0))
					holder.add(box(0.6, 0.4, 0.5, M.cardboard, 0.9, 0.8, 0))
				}
				holder.position.set(x, y, z)
				holder.rotation.y = sa + Math.PI / 2
				stock.add(holder)
				colliders.push({ x, z, r: 1.4, y })
			}
			scene.add(bake(stock))
		}

		/* the floor's name on the shaft, between its doors */
		for (const sp of DOORS) {
			const [x, z] = polar(CORE + 0.25, sp)
			const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.96), sign(`Floor ${k}`, NAMES[k]!, ''))
			board.position.set(x, y + 4.6, z)
			board.rotation.y = sp
			scene.add(board)
		}
		scene.add(bake(g))
	}

	/* ── the warehouse on the ground floor: high-bay racking in three rows round
	   the outer hall, every pallet place filled with what the lines eat and what
	   they make: glass crates, cell boxes, film, frames, finished triangles;
	   and at each door a loading dock with its forklift ── */
	{
		const ROWS = [55.8, 60.9, 65.2]
		const LEVEL_Y = [0.15, 1.5, 2.85, 4.2]
		type Bay = { a: number; r: number }
		const bays: Bay[] = []
		for (const r of ROWS) {
			const n = Math.floor((2 * Math.PI * r) / 2.85)
			for (let i = 0; i < n; i++) {
				const a = (i / n) * Math.PI * 2
				if (DOORS.some((d) => Math.abs(adiff(a, d)) * r < 7.5)) continue
				bays.push({ a, r })
				const [x, z] = polar(r, a)
				colliders.push({ x, z, r: 1.45, y: 0 })
			}
		}
		const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
			const m = new THREE.InstancedMesh(geo, mat, count)
			m.castShadow = true
			m.receiveShadow = true
			scene.add(m)
			return m
		}
		const uprights = inst(new THREE.BoxGeometry(0.1, 5.4, 1.1).translate(0, 2.7, 0), M.blue, bays.length * 2)
		const beams = inst(new THREE.BoxGeometry(2.75, 0.12, 0.08), M.orange, bays.length * LEVEL_Y.length * 2)
		const pallets = inst(new THREE.BoxGeometry(1.2, 0.14, 1), M.pallet, bays.length * LEVEL_Y.length * 2)
		const goods = inst(new THREE.BoxGeometry(1.1, 1, 0.95).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), bays.length * LEVEL_Y.length * 2)
		const palette = ['#b8925e', '#b8925e', '#c9a46e', '#2c6f9e', '#d7ecf2', '#eef1f2', '#1c2c5a', '#a58158']
		const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color()
		let iu = 0, ib = 0, ip = 0
		let seed = 3
		const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
		for (const { a, r } of bays) {
			q.setFromEuler(e.set(0, a, 0))
			const along = (off: number, rad: number, y: number) => {
				const [x, z] = polar(r + rad, a)
				return p.set(x + Math.cos(a) * off, y, z - Math.sin(a) * off)
			}
			for (const sd of [-1, 1]) uprights.setMatrixAt(iu++, m4.compose(along(sd * 1.4, 0, 0), q, sc.set(1, 1, 1)))
			for (const ly of LEVEL_Y) {
				for (const sd of [-1, 1]) beams.setMatrixAt(ib++, m4.compose(along(0, sd * 0.5, ly + 0.9), q, sc.set(1, 1, 1)))
				for (const sd of [-1, 1]) {
					pallets.setMatrixAt(ip, m4.compose(along(sd * 0.68, 0, ly + 0.07), q, sc.set(1, 1, 1)))
					const empty = rnd() < 0.12
					const h = empty ? 0.001 : 0.55 + rnd() * 0.6
					goods.setMatrixAt(ip, m4.compose(along(sd * 0.68, 0, ly + 0.14), q, sc.set(1, h, 1)))
					goods.setColorAt(ip, c.set(palette[Math.floor(rnd() * palette.length)]!))
					ip++
				}
			}
		}
		// aisle markings between the rows
		for (const rr of [53.2, 58.35, 63.05]) {
			const lane = new THREE.Mesh(new THREE.RingGeometry(rr - 1.1, rr + 1.1, 200, 1), new THREE.MeshStandardMaterial({ color: '#7a8580', roughness: 0.95 }))
			lane.rotation.x = -Math.PI / 2
			lane.position.y = 0.018
			scene.add(lane)
		}
		// the docks: crates of float glass waiting to go up, racks of triangles waiting to go out, a forklift
		const dock = new THREE.Group()
		for (const d of DOORS) {
			for (const sd of [-1, 1]) {
				for (let i = 0; i < 4; i++) {
					const rr = 52 + i * 3.6
					const [x, z] = polar(rr, d)
					const off = sd * 4.3
					const cx = x + Math.cos(d) * off, cz = z - Math.sin(d) * off
					const crate = new THREE.Group()
					if (sd < 0) {
						// a wooden crate of glass sheets, and another on top
						crate.add(box(2.4, 1.3, 1.2, M.pallet), box(2.4, 1.3, 1.2, M.pallet, 0, 1.35, 0))
						crate.add(box(2.2, 1.1, 0.02, M.glassWall, 0, 0.1, 0.61))
					} else {
						crate.add(box(2.6, 0.15, 1.4, M.graphite))
						for (const lf of [-1, 1]) {
							const leaf = box(2.5, 2, 0.08, M.cellBlue, 0, 0.15, lf * 0.25)
							leaf.rotation.x = lf * 0.12
							crate.add(leaf)
						}
					}
					crate.position.set(cx, 0, cz)
					crate.rotation.y = d + Math.PI / 2
					dock.add(crate)
					colliders.push({ x: cx, z: cz, r: 1.3, y: 0 })
				}
			}
			// the forklift, waiting by the door
			const [fx, fz] = polar(61, d)
			const fl = new THREE.Group()
			fl.add(box(1.2, 1.1, 2, M.orange, 0, 0.3, 0))
			for (const [wx, wz] of [[-0.6, 0.6], [0.6, 0.6], [-0.6, -0.6], [0.6, -0.6]] as const) {
				const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 14), M.rubber)
				wheel.rotation.z = Math.PI / 2
				wheel.position.set(wx, 0.3, wz)
				fl.add(wheel)
			}
			for (const [gx, gz] of [[-0.55, -0.1], [0.55, -0.1], [-0.55, 0.8], [0.55, 0.8]] as const) fl.add(box(0.07, 1.1, 0.07, M.graphite, gx, 1.4, gz))
			fl.add(box(1.2, 0.06, 1, M.graphite, 0, 2.5, 0.35))
			fl.add(box(1, 2.8, 0.15, M.graphite, 0, 0.1, 1.15))
			fl.add(box(0.14, 0.06, 1.1, M.steel, -0.3, 0.25, 1.75), box(0.14, 0.06, 1.1, M.steel, 0.3, 0.25, 1.75))
			fl.add(box(0.5, 0.1, 0.5, M.graphite, 0, 1.4, -0.3))
			const off = 7.5
			fl.position.set(fx + Math.cos(d) * off, 0, fz - Math.sin(d) * off)
			fl.rotation.y = d + Math.PI
			dock.add(fl)
			colliders.push({ x: fl.position.x, z: fl.position.z, r: 1.4, y: 0 })
		}
		scene.add(bake(dock))

		/* the forklifts: driverless, a lidar on the mast, running the rack aisles,
		   stopping to turn to the racks and lift a pallet into its place */
		const lifts = [58.35, 63.05].flatMap((aisle, ai) =>
			DOORS.map((d, q) => {
				const g = new THREE.Group()
				g.add(box(1.2, 0.9, 2, M.white, 0, 0.25, 0))
				g.add(box(1.22, 0.12, 2.02, M.orange, 0, 0.95, 0))
				g.add(box(1.24, 0.06, 0.1, M.wash, 0, 0.7, -1.01))
				for (const [wx, wz] of [[-0.6, 0.6], [0.6, 0.6], [-0.6, -0.6], [0.6, -0.6]] as const) {
					const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 14), M.rubber)
					wheel.rotation.z = Math.PI / 2
					wheel.position.set(wx, 0.28, wz)
					g.add(wheel)
				}
				for (const sx of [-0.4, 0.4]) g.add(box(0.1, 3.2, 0.12, M.graphite, sx, 0.1, 1.08))
				const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12), M.graphite)
				lidar.position.set(0, 3.4, 1.08)
				g.add(lidar)
				const carriage = new THREE.Group()
				carriage.add(box(1, 0.5, 0.08, M.graphite, 0, 0, 1.2))
				carriage.add(box(0.14, 0.06, 1.1, M.steel, -0.3, 0, 1.75), box(0.14, 0.06, 1.1, M.steel, 0.3, 0, 1.75))
				carriage.add(box(1.2, 0.14, 1, M.pallet, 0, 0.07, 1.75))
				carriage.add(box(1.1, 0.8, 0.95, (ai + q) % 2 ? M.cardboard : M.cassette, 0, 0.21, 1.75))
				carriage.position.y = 0.15
				g.add(carriage)
				g.traverse((o) => (o.castShadow = true))
				scene.add(g)
				return { g, carriage, aisle, a0: d + 0.2, a1: d + Math.PI / 2 - 0.2, phase: ai * 7 + q * 3 }
			})
		)
		updates.push((time) =>
			lifts.forEach(({ g, carriage, aisle, a0, a1, phase }) => {
				const T = time + phase
				const cycle = Math.floor(T / 20), tau = T % 20
				const forward = cycle % 2 === 0
				const p = Math.min(1, tau / 10)
				const a = forward ? a0 + (a1 - a0) * smooth(p) : a1 - (a1 - a0) * smooth(p)
				const [x, z] = polar(aisle, a)
				g.position.set(x, 0, z)
				// driving along the aisle; stopped, it turns its forks to the rack on the outside and lifts
				const turn = tau < 10 ? 0 : smooth(Math.min(1, (tau - 10) / 1.2)) * (tau > 18.8 ? smooth(Math.max(0, (20 - tau) / 1.2)) : 1)
				g.rotation.y = a + (forward ? Math.PI / 2 : -Math.PI / 2) + turn * (forward ? -Math.PI / 2 : Math.PI / 2)
				const up = tau < 11.2 ? 0 : Math.sin(Math.min(1, (tau - 11.2) / 7.6) * Math.PI)
				carriage.position.y = 0.15 + up * (1.5 + (cycle % 3) * 1.35)
			})
		)
	}

	/* ── the AGVs: carrying racks between the lifts, the line and the doors ── */
	{
		const agvs = Array.from({ length: 6 + (LEVELS.length - 1) * 2 }, (_, i) => {
			const g = new THREE.Group()
			g.add(box(1.7, 0.32, 1.1, M.white, 0, 0.08, 0))
			g.add(box(1.72, 0.06, 1.12, M.orange, 0, 0.26, 0))
			const lamp = box(0.2, 0.06, 0.08, M.wash, 0.86, 0.2, 0)
			g.add(lamp)
			// on the ground floor they carry racks of finished triangles, upstairs crates of parts
			const loaded = i < 6 && i % 2 === 0
			if (i >= 6) g.add(box(1.2, 0.7, 0.9, M.cardboard, 0, 0.38, 0))
			g.add(box(0.1, 1.5, 0.1, M.orange, -0.6, 0.38, 0), box(0.1, 1.5, 0.1, M.orange, 0.6, 0.38, 0))
			if (loaded) for (const sd of [-1, 1]) {
				const leaf = box(1.3, 1.3, 0.05, M.cellBlue, 0, 0.4, sd * 0.2)
				leaf.rotation.x = sd * 0.12
				g.add(leaf)
			}
			g.traverse((o) => (o.castShadow = true))
			scene.add(g)
			return { g, phase: i / 6 }
		})
		// one loop: round the outer aisle of the ground floor, out through a door to the yard, and back
		const loop = (u: number, d: number): [number, number, number] => {
			const aisle = 53.2
			if (u < 0.7) {
				const a = d + (u / 0.7) * Math.PI * 2
				const [x, z] = polar(aisle, a)
				return [x, z, a + Math.PI / 2]
			}
			const v = (u - 0.7) / 0.3
			const rr = v < 0.5 ? aisle + (v / 0.5) * (R + 10 - aisle) : R + 10 - ((v - 0.5) / 0.5) * (R + 10 - aisle)
			const [x, z] = polar(rr, d)
			return [x, z, v < 0.5 ? d : d + Math.PI]
		}
		updates.push((time) =>
			agvs.forEach(({ g, phase }, i) => {
				if (i < 6) {
					const u = ((time / 90 + phase) % 1 + 1) % 1
					const [x, z, yaw] = loop(u, DOORS[i % 4]!)
					g.position.set(x, 0, z)
					g.rotation.y = yaw - Math.PI / 2
					return
				}
				// upstairs they run the aisle outside the lines
				const level = 1 + Math.floor((i - 6) / 2)
				const dir = i % 2 ? 1 : -1
				const a = phase * 7 + (dir * time * 1.1) / 52.2
				const [x, z] = polar(52.2, a)
				g.position.set(x, LEVELS[level]!, z)
				g.rotation.y = a + (dir > 0 ? 0 : Math.PI)
			})
		)
	}

	/* ── the people and the humanoids: walking the aisles, working the stations ── */
	{
		const walkers: Walker[] = []
		let seed = 7
		const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
		for (let k = 0; k < LEVELS.length; k++) {
			const at = stationAngles[k]!
			for (let i = 0; i < 11; i++) {
				// four stand at the desks of their stations; the rest walk the aisles
				const working = i < 4
				const post = at[(i * 2) % at.length]!
				const aisles = k === 0 ? [18.8, MAIN + 2.6, 58.35] : [18.8, MAIN + 2.6]
				// the operator stands in front of the machine, facing it across the aisle
				const aisle = working ? post.r : aisles[i % aisles.length]!
				const a = working ? post.a : rnd() * Math.PI * 2
				walkers.push({ level: k, r: aisle, a, speed: (rnd() < 0.5 ? -1 : 1) * (1 + rnd() * 0.4), working, phase: rnd() * 10, kind: i % 2 ? 'robot' : 'person' })
			}
		}
		const c = crowd(walkers)
		scene.add(c.object)
		let last = 0
		updates.push((time) => {
			c.update(time, Math.min(0.1, time - last))
			last = time
		})
	}

	/* the machines' green lights, blinking as they run */
	updates.push((time) => blink.forEach((b, i) => (((b.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(time * 3 + i) > -0.3 ? 1.8 : 0.2))))

	return {
		colliders,
		floorAt: (x, z, feet) => {
			if (inCabin(x, z)) return cabY
			let best = 0
			const by = bridgeY(x, z)
			LEVELS.forEach((ly, k) => {
				if (ly <= feet + 0.55 && ly > best && levelFloor(k, x, z)) best = ly
				if (by !== null && ly + by <= feet + 0.55 && ly + by > best && levelFloor(k, x, z)) best = ly + by
			})
			return best
		},
		// nothing holds you but a floor: the railings, the bridges' edges, a lift that is not there;
		// and the cabin is entered only through its doors
		blocked: (x, z, here) => (inCabin(x, z) !== inCabin(px, pz) && !throughDoor(x, z)) || !hasFloorAt(x, z, here),
		tick: (x, z, feet) => {
			px = x
			pz = z
			pf = feet
		},
		// ↑ and ↓ inside the cabin send it a floor up or down
		// the lift stops at every floor; press again, or keep the key held, and it goes on
		onKey: (k, down) => {
			if (!inCabin(px, pz) || (k !== 'arrowup' && k !== 'arrowdown')) return false
			const dir = k === 'arrowup' ? 1 : -1
			if (!down) held = 0
			else if (held !== dir) {
				held = dir
				if (idle()) target = Math.max(0, Math.min(LEVELS.length - 1, target + dir))
			}
			return true
		},
		floor: () => (inCabin(px, pz) ? nearestLevel(cabY) : -1),
		start: { x: 0, z: R - 8, look: 0 },
		update: (time) => {
			for (const u of updates) u(time, 0)
		}
	}
}
