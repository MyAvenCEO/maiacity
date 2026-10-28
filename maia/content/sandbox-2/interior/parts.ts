/**
 * What rides the belts of the solar factory dome, in 3D: the part each floor
 * makes, at every stage of it. Every station makes something of its own —
 * quartz becomes silicon becomes an ingot becomes wafers becomes cells; a coil
 * of copper gathers ribbons, cable, plugs, a box and a board; sand becomes a
 * melt, a sheet of glass, a triangle — so what rides out of a station is never
 * what rode in.
 *
 * Each stage is one merged geometry with its colours in its vertices, all on
 * a tray 1.5 m square: one instanced mesh per stage, one material for all.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

type P = { geo: THREE.BufferGeometry; c: string; at?: number[]; rot?: number[]; s?: number[] }

const BOX = new THREE.BoxGeometry(1, 1, 1)
const BALL = new THREE.IcosahedronGeometry(1, 1)
const ROD = new THREE.CylinderGeometry(1, 1, 1, 14)
const CONE = new THREE.ConeGeometry(1, 1, 16)
const TORUS = new THREE.TorusGeometry(1, 0.35, 8, 20)
const TRI = (() => {
	const s = new THREE.Shape()
	s.moveTo(0, 0.62)
	s.lineTo(0.62, -0.5)
	s.lineTo(-0.62, -0.5)
	s.closePath()
	return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).rotateX(-Math.PI / 2)
})()

function merge(parts: P[]): THREE.BufferGeometry {
	const geos = parts.map(({ geo, c, at = [0, 0, 0], rot = [0, 0, 0], s = [1, 1, 1] }) => {
		const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry
		for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
		g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(at[0], at[1], at[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), new THREE.Vector3(s[0], s[1], s[2])))
		const col = new THREE.Color(c)
		const n = g.attributes.position!.count
		const arr = new Float32Array(n * 3)
		for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3)
		g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
		return g
	})
	return mergeGeometries(geos)!
}

const tray: P = { geo: BOX, c: '#555d63', at: [0, 0.03, 0], s: [1.5, 0.06, 1.5] }
const tag = (c = '#2fbf5a'): P => ({ geo: BOX, c, at: [0.6, 0.12, -0.6], s: [0.16, 0.1, 0.16] })
const lumps = (c: string): P[] =>
	[[-0.4, -0.35, 0.2], [0.1, -0.4, 0.17], [0.45, -0.1, 0.19], [-0.3, 0.15, 0.21], [0.2, 0.3, 0.18], [-0.1, -0.05, 0.16], [0.5, 0.45, 0.15]].map(([x, z, r]) => ({ geo: BALL, c, at: [x!, 0.06 + r! * 0.8, z!] as [number, number, number], s: [r!, r! * 0.8, r!] as [number, number, number] }))
const ingot = (z: number): P => ({ geo: ROD, c: '#6b747a', at: [0, 0.26, z], rot: [0, 0, Math.PI / 2], s: [0.2, 1.2, 0.2] })
const waferStacks = (c: string, top?: string): P[] =>
	[-0.45, 0, 0.45].flatMap((x) => [
		{ geo: BOX, c, at: [x, 0.16, 0] as [number, number, number], s: [0.36, 0.2, 0.36] as [number, number, number] },
		...(top ? [0, 1, 2].map((l) => ({ geo: BOX, c: top, at: [x, 0.265, -0.12 + l * 0.12] as [number, number, number], s: [0.36, 0.01, 0.02] as [number, number, number] })) : [])
	])
const coil = (c: string, x = -0.35, z = -0.3): P => ({ geo: TORUS, c, at: [x, 0.13, z], rot: [Math.PI / 2, 0, 0], s: [0.3, 0.3, 0.3] })
const spools: P[] = [0.25, 0.55].map((x) => ({ geo: ROD, c: '#cfd4d8', at: [x, 0.16, -0.35] as [number, number, number], s: [0.12, 0.2, 0.12] as [number, number, number] }))
const drum: P[] = [
	{ geo: ROD, c: '#a8804f', at: [-0.35, 0.36, -0.3], rot: [Math.PI / 2, 0, 0], s: [0.3, 0.04, 0.3] },
	{ geo: ROD, c: '#a8804f', at: [-0.35, 0.36, 0.0], rot: [Math.PI / 2, 0, 0], s: [0.3, 0.04, 0.3] },
	{ geo: ROD, c: '#141619', at: [-0.35, 0.36, -0.15], rot: [Math.PI / 2, 0, 0], s: [0.22, 0.28, 0.22] }
]
const plugs: P[] = [0.2, 0.45].map((x) => ({ geo: BOX, c: '#2b2f33', at: [x, 0.12, 0.05] as [number, number, number], s: [0.16, 0.12, 0.3] as [number, number, number] }))
const jbox = (lid: boolean): P[] => [
	{ geo: BOX, c: '#23272b', at: [0.3, 0.16, 0.45], s: [0.5, 0.2, 0.4] },
	...(lid ? [{ geo: BOX, c: '#16181b', at: [0.3, 0.27, 0.45] as [number, number, number], s: [0.52, 0.03, 0.42] as [number, number, number] }] : [])
]
const pcb: P = { geo: BOX, c: '#2e7d4f', at: [0.3, 0.27, 0.45], s: [0.38, 0.02, 0.3] }
const chips: P[] = [[0.22, 0.4], [0.38, 0.4], [0.3, 0.52]].map(([x, z]) => ({ geo: BOX, c: '#111316', at: [x!, 0.29, z!] as [number, number, number], s: [0.08, 0.03, 0.06] as [number, number, number] }))
const joints: P[] = [[0.16, 0.35], [0.44, 0.35], [0.16, 0.55], [0.44, 0.55]].map(([x, z]) => ({ geo: BALL, c: '#e8ecef', at: [x!, 0.29, z!] as [number, number, number], s: [0.02, 0.02, 0.02] as [number, number, number] }))
const leads: P[] = [0.05, 0.15].map((dz) => ({ geo: ROD, c: '#141619', at: [0.1, 0.16, 0.2 + dz] as [number, number, number], rot: [0, 0, Math.PI / 2] as [number, number, number], s: [0.025, 0.4, 0.025] as [number, number, number] }))
const glass = (c: string, h = 0.03, y = 0.07): P => ({ geo: TRI, c, at: [0, y, 0], s: [1.15, h, 1.15] })
const cellsOn = (y: number): P[] =>
	[-0.28, -0.08, 0.12, 0.32].flatMap((z, row) =>
		Array.from({ length: 4 - row }, (_, i) => ({ geo: BOX, c: '#1b2a5c', at: [(-(3 - row) / 2 + i) * 0.2, y, z] as [number, number, number], s: [0.16, 0.012, 0.16] as [number, number, number] }))
	)
const strings = (rows: number[]): P[] => rows.map((z) => ({ geo: BOX, c: '#1b2a5c', at: [0, 0.09, z] as [number, number, number], s: [1.2, 0.02, 0.14] as [number, number, number] }))
const frame = (c: string): P[] => {
	const pts: [number, number][] = [[0, -0.62], [0.62, 0.5], [-0.62, 0.5]]
	return pts.map((p, i) => {
		const q = pts[(i + 1) % 3]!
		const mx = (p[0] + q[0]) / 2 * 1.15, mz = (p[1] + q[1]) / 2 * 1.15
		const len = Math.hypot(q[0] - p[0], q[1] - p[1]) * 1.15
		return { geo: BOX, c, at: [mx, 0.12, mz] as [number, number, number], rot: [0, -Math.atan2(q[1] - p[1], q[0] - p[0]), 0] as [number, number, number], s: [len, 0.08, 0.06] as [number, number, number] }
	})
}
const profiles = (c: string): P[] => [-0.55, -0.45, -0.35].map((z) => ({ geo: BOX, c, at: [0, 0.2, z] as [number, number, number], s: [1.4, 0.05, 0.06] as [number, number, number] }))
const struts: P[] = [0.45, 0.52, 0.59].map((z) => ({ geo: ROD, c: '#8b939a', at: [0, 0.2, z] as [number, number, number], rot: [0, 0, Math.PI / 2] as [number, number, number], s: [0.03, 1.4, 0.03] as [number, number, number] }))
const hub: P = { geo: BALL, c: '#9aa2a8', at: [-0.55, 0.22, -0.5], s: [0.12, 0.12, 0.12] }

/** Floor by floor, ground up: the part at every stage, from what the floor starts with to what it hands on. */
const FLOORS: P[][][] = [
	// 0 · frames, test & dome kits
	(() => {
		const lam: P[] = [glass('#bfe6ef', 0.04), ...cellsOn(0.115), { geo: BOX, c: '#16181b', at: [0, 0.14, -0.35], s: [0.14, 0.06, 0.1] }]
		const framed = [...lam, ...frame('#aab1b6')]
		return [
			lam,
			[...lam, ...profiles('#c4c9cc')],
			[...lam, ...profiles('#8f969b')],
			framed,
			[...framed, tag('#ffffff')],
			[...framed, tag()],
			[...framed, tag('#f2c230')],
			[...framed, tag(), { geo: BOX, c: '#ffffff', at: [0.35, 0.13, 0.3], s: [0.2, 0.01, 0.12] }],
			[...framed, ...struts],
			[...framed, ...struts, hub],
			[...framed, ...struts, hub, { ...glass('#bfe6ef', 0.04, 0.2) }, { ...glass('#bfe6ef', 0.04, 0.3) }],
			// racked: low rails either side, the kit still in plain view
			[...framed, ...struts, hub, glass('#bfe6ef', 0.04, 0.2), { geo: BOX, c: '#e8742a', at: [-0.7, 0.14, 0], s: [0.06, 0.16, 1.4] }, { geo: BOX, c: '#e8742a', at: [0.7, 0.14, 0], s: [0.06, 0.16, 1.4] }],
			// wrapped: two thin bands of film over it, nothing hidden
			[...[...framed, ...struts, hub, glass('#bfe6ef', 0.04, 0.2), { geo: BOX, c: '#e8742a', at: [-0.7, 0.14, 0], s: [0.06, 0.16, 1.4] }, { geo: BOX, c: '#e8742a', at: [0.7, 0.14, 0], s: [0.06, 0.16, 1.4] }], { geo: BOX, c: '#f4f6f7', at: [0, 0.27, -0.3], s: [1.46, 0.02, 0.12] }, { geo: BOX, c: '#f4f6f7', at: [0, 0.27, 0.3], s: [1.46, 0.02, 0.12] }],
			[...[...framed, ...struts, hub, glass('#bfe6ef', 0.04, 0.2), { geo: BOX, c: '#e8742a', at: [-0.7, 0.14, 0], s: [0.06, 0.16, 1.4] }, { geo: BOX, c: '#e8742a', at: [0.7, 0.14, 0], s: [0.06, 0.16, 1.4] }], { geo: BOX, c: '#f4f6f7', at: [0, 0.27, -0.3], s: [1.46, 0.02, 0.12] }, { geo: BOX, c: '#f4f6f7', at: [0, 0.27, 0.3], s: [1.46, 0.02, 0.12] }, tag()]
		]
	})(),
	// 1 · modules
	(() => {
		const film: P = { geo: ROD, c: '#f4f7f5', at: [-0.2, 0.2, -0.5], rot: [0, 0, Math.PI / 2], s: [0.14, 1.0, 0.14] }
		const laid = [glass('#bfe6ef'), glass('#f4f7f5', 0.01, 0.1), ...cellsOn(0.11)]
		const bussed = [...laid, { geo: BOX, c: '#d7dce0', at: [0, 0.12, 0.42], s: [1.1, 0.01, 0.04] } as P]
		const lam = [glass('#9fcad6', 0.05), ...cellsOn(0.125)]
		return [
			[],
			[film],
			[film, ...strings([0.55])],
			[film, ...strings([0.45, 0.6])],
			[glass('#bfe6ef'), glass('#f4f7f5', 0.01, 0.1), ...strings([0.6])],
			laid,
			bussed,
			[...bussed, glass('#d8f0f6', 0.02, 0.13)],
			[...bussed, glass('#d8f0f6', 0.02, 0.13), tag()],
			lam,
			[...lam, tag('#ffffff')],
			[...lam, ...frame('#e8ecef').map((f) => ({ ...f, s: [f.s![0], 0.01, 0.02] as [number, number, number] }))],
			[...lam, { geo: BOX, c: '#16181b', at: [0, 0.16, -0.35], s: [0.18, 0.08, 0.12] }, ...leads.map((l) => ({ ...l, at: [0, 0.16, -0.5 + l.at![2] - 0.2] as [number, number, number] }))]
		].map((p) => [tray, ...p])
	})(),
	// 2 · glass from sand
	(() => {
		const tri = (c: string) => [glass(c)]
		return [
			[{ geo: CONE, c: '#d8c59a', at: [0, 0.25, 0], s: [0.6, 0.4, 0.6] }],
			[{ geo: CONE, c: '#d8c59a', at: [-0.3, 0.2, -0.2], s: [0.35, 0.3, 0.35] }, { geo: CONE, c: '#f2efe8', at: [0.3, 0.2, -0.2], s: [0.3, 0.26, 0.3] }, { geo: CONE, c: '#b9b4aa', at: [0, 0.2, 0.3], s: [0.32, 0.28, 0.32] }],
			[{ geo: BALL, c: '#ff8a2a', at: [0, 0.14, 0], s: [0.55, 0.12, 0.55] }],
			[{ geo: BOX, c: '#bfe6ef', at: [0, 0.08, 0], s: [1.4, 0.03, 1.4] }],
			[{ geo: BOX, c: '#d4eef4', at: [0, 0.08, 0], s: [1.4, 0.03, 1.4] }],
			tri('#bfe6ef'),
			[glass('#bfe6ef'), ...frame('#ffffff').map((f) => ({ ...f, s: [f.s![0], 0.02, 0.03] as [number, number, number], at: [f.at![0], 0.09, f.at![2]] as [number, number, number] }))],
			tri('#d8f3f8'),
			tri('#a9cfe6'),
			tri('#b7a9e0'),
			[glass('#b7a9e0'), tag()]
		].map((p) => [tray, ...p])
	})(),
	// 3 · copper, cords & electronics
	(() => {
		const s: P[][] = []
		s.push([coil('#b8693a')])
		s.push([coil('#e0894a')])
		s.push([coil('#e0894a'), ...spools])
		s.push([coil('#141619'), ...spools])
		s.push([...drum, ...spools])
		s.push([...drum, ...spools, ...plugs])
		s.push([...drum, ...spools, ...plugs, ...jbox(false)])
		s.push([...drum, ...spools, ...plugs, ...jbox(false), pcb])
		s.push([...drum, ...spools, ...plugs, ...jbox(false), pcb, ...chips])
		s.push([...drum, ...spools, ...plugs, ...jbox(false), pcb, ...chips, ...joints])
		s.push([...drum, ...spools, ...plugs, ...jbox(false), pcb, ...chips, ...joints, tag()])
		s.push([...spools, ...plugs, ...jbox(true), ...leads, tag()])
		s.push([...spools, ...plugs, ...jbox(true), ...leads, tag()])
		return s.map((p) => [tray, ...p])
	})(),
	// 4 · silicon & cells
	[
		[...lumps('#ece9e2')],
		[...lumps('#7f878d')],
		[...lumps('#b7c0c6')],
		[ingot(-0.3)],
		[ingot(-0.3), ingot(0.3)],
		waferStacks('#8f979d'),
		waferStacks('#6b7378'),
		waferStacks('#4f5e78'),
		waferStacks('#1b2a5c'),
		waferStacks('#1b2a5c', '#dfe3e8'),
		waferStacks('#1f3068', '#f2f4f7'),
		[...waferStacks('#1f3068', '#f2f4f7'), tag()]
	].map((p) => [tray, ...p])
]

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 })

/** The part at every stage of floor k: stage 0 is what the floor starts from, stage n what station n made of it. */
export function stageParts(k: number, stations: number): { geos: THREE.BufferGeometry[]; material: THREE.Material } {
	const floor = FLOORS[k]!
	const geos = Array.from({ length: stations + 1 }, (_, i) => merge(k === 0 ? [tray, ...floor[Math.min(i, floor.length - 1)]!] : floor[Math.min(i, floor.length - 1)]!))
	return { geos, material }
}
