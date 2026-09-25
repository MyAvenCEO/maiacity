/**
 * THE PRIVATE ROOMS — furnished the way a Waldorf school is built: few hard
 * corners, walls and furniture of hand-smoothed plaster in soft lazure
 * colours, oiled wood with rounded edges, and plants everywhere.
 *
 * Every room, between its two partition walls, from the walkway to the glass:
 *   by the door   a curved plaster bench, a round table, stools, a niche shelf
 *   in the middle a round rug, a wide bed facing out through the glass
 *   by the glass  a natural stone bath, sunk in pebbles, looking at the forest
 *   at the end    a round bathroom pod: a pebble-floored walk-in shower, a basin
 *   everywhere    monstera, fiddle-leaf fig, snake plant, trailing pothos, olive
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { houseplant, potted, seeded } from './plants'

const polar = (r: number, a: number): [number, number] => [r * Math.sin(a), r * Math.cos(a)]
const shared = <T,>(make: () => T) => {
	let v: T | undefined
	return () => (v ??= make())
}

/** Lazure plaster: warm white, peach, rose, sage, ochre. */
const PLASTER = ['#efe4d2', '#ecd1b8', '#e3c1b4', '#cfd8bf', '#ead6a8'].map((c) => shared(() => new THREE.MeshStandardMaterial({ color: c, roughness: 0.96, side: THREE.DoubleSide })))
const M = {
	wood: shared(() => new THREE.MeshStandardMaterial({ color: '#b98a5a', roughness: 0.7 })),
	darkWood: shared(() => new THREE.MeshStandardMaterial({ color: '#8a6040', roughness: 0.7 })),
	wool: shared(() => new THREE.MeshStandardMaterial({ color: '#efe8da', roughness: 1 })),
	felt: ['#b8674a', '#7d8f5c', '#c9a15a', '#6f7fa0'].map((c) => shared(() => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }))),
	stone: shared(() => new THREE.MeshStandardMaterial({ color: '#a39d92', roughness: 0.85 })),
	pebble: shared(() => new THREE.MeshStandardMaterial({ color: '#8d877c', roughness: 0.9 })),
	basket: shared(() => new THREE.MeshStandardMaterial({ color: '#c9a978', roughness: 1, side: THREE.DoubleSide })),
	water: shared(() => new THREE.MeshStandardMaterial({ color: '#7fc9cf', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.8 })),
	brass: shared(() => new THREE.MeshStandardMaterial({ color: '#b08d57', roughness: 0.35, metalness: 0.8 })),
	book: ['#8a4b3a', '#4f6b5a', '#c9a15a', '#5b6a8a', '#a8683a'].map((c) => shared(() => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })))
}
const round = (w: number, h: number, d: number, r = 0.08) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))

export type Room = { a0: number; span: number; rIn: number; rOut: number; y: number; seed: number }
export type RoomColliders = { x: number; z: number; r: number; y: number }[]

/** Furnishes one room; returns its pieces (to be baked by the caller) and what stands in the way. */
export function furnish(room: Room): { group: THREE.Group; colliders: RoomColliders } {
	const { a0, span, rIn, rOut, y, seed } = room
	const r = seeded(seed)
	const g = new THREE.Group()
	const colliders: RoomColliders = []
	const plaster = PLASTER[seed % PLASTER.length]!()
	const accent = M.felt[seed % M.felt.length]!()
	const depth = rOut - rIn
	/** a place in the room: a fraction along it (0 by the door, 1 at the far wall), a distance out from the walkway */
	const at = (f: number, out: number): [number, number] => polar(rIn + out, a0 + f * span)
	const facing = (f: number) => a0 + f * span
	const put = (o: THREE.Object3D, f: number, out: number, rot: number, block = 0) => {
		const [x, z] = at(f, out)
		o.position.set(x, y + o.position.y, z)
		o.rotation.y = rot
		g.add(o)
		if (block) colliders.push({ x, z, r: block, y })
	}
	/** how far along the room a length of metres is, measured in the middle of the room */
	const W = span * (rIn + depth / 2)
	const along = (m: number) => m / W
	// the room, metre by metre from the door: the sitting corner, the bed, a desk if there is room, the bath, the bathroom
	const podR = Math.min(1.7, depth * 0.34)
	const fBench = along(1.6), fTable = along(3.2), fRug = along(4.9), fBed = along(6.8)
	const fPod = 1 - along(podR + 0.6)
	const fBath = 1 - along(2 * podR + 2.8)
	const deskGap = (fBath - fBed) * W

	// ── the bed: a low oak frame with rounded ends, a thick mattress, a wool blanket, an arched headboard
	{
		const b = new THREE.Group()
		b.add(new THREE.Mesh(round(2, 0.32, 2.3, 0.14), M.wood()).translateY(0.16))
		b.add(new THREE.Mesh(round(1.9, 0.24, 2.1, 0.1), M.wool()).translateY(0.44))
		b.add(new THREE.Mesh(round(1.92, 0.08, 1.2, 0.04), accent).translateY(0.58).translateZ(0.4))
		for (const x of [-0.45, 0.45]) b.add(new THREE.Mesh(round(0.7, 0.16, 0.42, 0.08), M.wool()).translateX(x).translateY(0.62).translateZ(-0.78))
		const head = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.12, 32, 1, false, 0, Math.PI), M.wood())
		head.rotation.set(Math.PI / 2, 0, Math.PI / 2)
		head.position.set(0, 0.3, -1.12)
		b.add(head)
		put(b, fBed, depth - 1.35, facing(fBed) + Math.PI, 1.3)
	}
	// ── a curved built-in bench of plaster by the door, with felt cushions, a round table and two stools
	{
		const arc = along(3.4)
		// a curved slab of plaster: its front face, its seat, its back, following the wall
		// (open-ended curves only: a closed one would fan out to the middle of the dome)
		const aS = a0 + span * fBench, aL = span * arc
		const front = new THREE.Mesh(new THREE.CylinderGeometry(rIn + 0.8, rIn + 0.8, 0.45, 24, 1, true, aS, aL), plaster)
		front.position.y = y + 0.225
		g.add(front)
		const seat = new THREE.Mesh(new THREE.RingGeometry(rIn + 0.2, rIn + 0.8, 24, 1, Math.PI / 2 - aS - aL, aL), plaster)
		seat.rotation.x = Math.PI / 2
		seat.position.y = y + 0.45
		g.add(seat)
		const back = new THREE.Mesh(new THREE.CylinderGeometry(rIn + 0.25, rIn + 0.25, 0.9, 24, 1, true, aS, aL), plaster)
		back.position.y = y + 0.45
		g.add(back)
		const backTop = new THREE.Mesh(new THREE.RingGeometry(rIn + 0.1, rIn + 0.3, 24, 1, Math.PI / 2 - aS - aL, aL), plaster)
		backTop.rotation.x = Math.PI / 2
		backTop.position.y = y + 0.9
		g.add(backTop)
		for (let i = 0; i < 3; i++) put(new THREE.Mesh(round(0.8, 0.12, 0.45, 0.06), accent).translateY(0.51), fBench + along(0.6 + i * 1.1), 0.6, facing(fBench + along(0.6 + i * 1.1)) + Math.PI)
		const table = new THREE.Group()
		table.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 32), M.wood()).translateY(0.72))
		table.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 0.72, 16), M.darkWood()).translateY(0.36))
		put(table, fTable, 1.7, 0, 0.7)
		for (const [f, out] of [[fTable - along(0.8), 2.3], [fTable + along(0.8), 2.3]] as const) {
			const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.45, 20), M.wood())
			stool.position.y = 0.225
			put(stool, f, out, 0)
		}
		// on the table, a bowl of fruit and a candle
		const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.darkWood())
		bowl.position.y = 0.92
		put(bowl, fTable, 1.7, 0)
	}
	// ── a shelf of rounded plaster niches on the first partition wall, books and pots in it
	{
		const shelf = new THREE.Group()
		shelf.add(new THREE.Mesh(round(0.4, 2, 1.6, 0.15), plaster).translateY(1))
		for (let lv = 0; lv < 3; lv++)
			for (let k = 0; k < 7; k++) {
				const book = new THREE.Mesh(round(0.26, 0.28 + ((k * 7 + lv) % 3) * 0.04, 0.06, 0.01), M.book[(k + lv) % M.book.length]!())
				book.position.set(0.12, 0.45 + lv * 0.55 + 0.14, -0.55 + k * 0.08)
				shelf.add(book)
			}
		const trail = houseplant('pothos', seed + 1, 0.7)
		trail.position.set(0.1, 2, 0.45)
		shelf.add(trail)
		put(shelf, along(0.35), depth * 0.5, facing(along(0.35)) + Math.PI / 2, 0.6)
	}
	// ── a round rug in the middle, floor cushions on it
	{
		const rug = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40), accent)
		rug.rotation.x = -Math.PI / 2
		rug.position.y = 0.012
		put(rug, fRug, depth * 0.45, 0)
		for (const [f, out] of [[fRug - along(0.6), depth * 0.4], [fRug + along(0.5), depth * 0.55]] as const) put(new THREE.Mesh(round(0.55, 0.16, 0.55, 0.08), M.wool()).translateY(0.08), f, out, r() * 3)
	}
	// ── the balcony door, at the glass, out onto the terrace
	put(balconyDoor(), fRug, depth + 0.2, facing(fRug))

	// ── the natural stone bath by the glass: an oval of rough stone, pebbles round it, the water in it
	{
		const bath = new THREE.Group()
		const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.2, 10, 32), M.stone())
		rim.rotation.x = Math.PI / 2
		rim.scale.set(1.25, 0.8, 1)
		rim.position.y = 0.52
		bath.add(rim)
		const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.stone())
		body.scale.set(1.08, 0.55, 0.9)
		body.position.y = 0.55
		bath.add(body)
		const water = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32), M.water())
		water.rotation.x = -Math.PI / 2
		water.scale.set(1.2, 0.95, 1)
		water.position.y = 0.46
		bath.add(water)
		for (let i = 0; i < 16; i++) {
			const a = (i / 16) * Math.PI * 2
			const peb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + r() * 0.08, 0), M.pebble())
			peb.position.set(Math.cos(a) * 1.35, 0.05, Math.sin(a) * 1.05)
			peb.scale.y = 0.5
			bath.add(peb)
		}
		const fern = potted('rosemary', seed + 3, 1.2)
		fern.position.set(1.4, 0, 0.5)
		bath.add(fern)
		put(bath, fBath, depth - 1.1, facing(fBath), 1.2)
	}
	// ── the bathroom: a round plaster pod, open on one side, a pebble-floored walk-in shower and a basin
	{
		const pod = new THREE.Group()
		const R = podR
		const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2.3, 32, 1, true, 0.6, Math.PI * 2 - 1.2), plaster)
		wall.position.y = 1.15
		pod.add(wall)
		const top = new THREE.Mesh(new THREE.TorusGeometry(R, 0.06, 8, 32, Math.PI * 2 - 1.2), plaster)
		top.rotation.set(Math.PI / 2, 0, 0.6 - Math.PI / 2)
		top.position.y = 2.3
		pod.add(top)
		// the shower: a pebble floor, a brass head on a curved arm, a low stone lip
		const floor = new THREE.Mesh(new THREE.CircleGeometry(R * 0.55, 24), M.pebble())
		floor.rotation.x = -Math.PI / 2
		floor.position.set(0, 0.02, -R * 0.35)
		pod.add(floor)
		for (let i = 0; i < 26; i++) {
			const peb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.05 + r() * 0.04, 0), M.stone())
			peb.position.set((r() - 0.5) * R, 0.03, -R * 0.35 + (r() - 0.5) * R * 0.9)
			peb.scale.y = 0.4
			pod.add(peb)
		}
		pod.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.1, 8), M.brass()).translateY(1.05).translateZ(-R + 0.12))
		const head = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.04, 20), M.brass())
		head.position.set(0, 2.1, -R + 0.35)
		pod.add(head)
		// the basin: a round stone bowl on a plaster pillar, a round mirror above it
		const basin = new THREE.Group()
		basin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.8, 20), plaster).translateY(0.4))
		basin.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.stone()).translateY(0.95))
		const mirror = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), M.brass())
		mirror.position.set(0, 1.6, -0.2)
		basin.add(mirror)
		basin.position.set(R * 0.55, 0, R * 0.2)
		basin.rotation.y = -Math.PI / 2
		pod.add(basin)
		const snake = houseplant('snake', seed + 5, 1)
		snake.position.set(-R * 0.5, 0, R * 0.35)
		pod.add(snake)
		put(pod, fPod, depth * 0.52, facing(fPod) + Math.PI)
		// its wall, as a ring of posts to walk round
		const [px, pz] = at(fPod, depth * 0.52)
		for (let k = 0; k < 10; k++) {
			const a = (k / 10) * Math.PI * 2
			const off = facing(fPod) + Math.PI
			if (Math.abs(Math.atan2(Math.sin(a - off), Math.cos(a - off))) < 0.7) continue
			colliders.push({ x: px + Math.sin(a) * R, z: pz + Math.cos(a) * R, r: 0.35, y })
		}
	}
	// ── plants: a monstera by the bench, a fiddle-leaf fig by the bed, an olive by the glass, a hanging pothos
	// ── a writing desk by the glass and a reading armchair, where the room is long enough
	if (deskGap > 3.2) {
		const fDesk = fBed + along(deskGap / 2)
		const desk = new THREE.Group()
		desk.add(new THREE.Mesh(round(1.5, 0.06, 0.7, 0.03), M.wood()).translateY(0.74))
		for (const x of [-0.65, 0.65]) desk.add(new THREE.Mesh(round(0.08, 0.74, 0.6, 0.03), M.wood()).translateX(x).translateY(0.37))
		desk.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), M.brass()).translateX(0.5).translateY(0.97))
		desk.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.wool()).translateX(0.5).translateY(1.12))
		const chair = new THREE.Group()
		chair.add(new THREE.Mesh(round(0.48, 0.06, 0.45, 0.03), M.wood()).translateY(0.46))
		chair.add(new THREE.Mesh(round(0.48, 0.5, 0.05, 0.03), M.wood()).translateY(0.72).translateZ(-0.22))
		for (const [x, z] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]] as const) chair.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 8), M.darkWood()).translateX(x).translateY(0.23).translateZ(z))
		chair.position.z = 0.75
		chair.rotation.y = Math.PI
		desk.add(chair)
		put(desk, fDesk, depth - 0.9, facing(fDesk) + Math.PI, 0.9)
		const arm = new THREE.Group()
		arm.add(new THREE.Mesh(round(0.9, 0.42, 0.85, 0.2), accent).translateY(0.21))
		arm.add(new THREE.Mesh(round(0.9, 0.55, 0.22, 0.1), accent).translateY(0.6).translateZ(-0.34))
		for (const x of [-0.42, 0.42]) arm.add(new THREE.Mesh(round(0.16, 0.3, 0.8, 0.07), accent).translateX(x).translateY(0.55))
		put(arm, fDesk, depth * 0.35, facing(fDesk), 0.6)
		put(houseplant('fig', seed + 17, 1.3), fDesk + along(1.4), depth * 0.3, 0)
	}
	for (const [kind, f, out, size] of [
		['monstera', fBench - along(0.8), 2.4, 1.3],
		['fig', fBed - along(1.8), depth - 0.6, 1.2],
		['monstera', fBed + along(1.5), 0.8, 1],
		['snake', fRug + along(1.4), 0.6, 1]
	] as const)
		put(houseplant(kind, seed * 7 + Math.round(f * 100), size), f, out, r() * 6)
	put(potted('olive', seed + 9, 1), fBath - along(1.8), depth - 0.7, 0)
	put(potted('lemon', seed + 11, 0.9), fTable, depth - 0.7, 0)
	const hanging = houseplant('pothos', seed + 13, 0.8)
	hanging.position.y = 2.2
	put(hanging, fRug, depth * 0.3, 0)
	return { group: g, colliders }
}

/**
 * A balcony door: a round-headed timber frame at the glass, its glazed leaf
 * standing open onto the terrace. Built facing +z (outward), standing on y 0.
 */
export function balconyDoor(): THREE.Group {
	const g = new THREE.Group()
	const w = 0.95, h = 2.1
	for (const sx of [-1, 1]) g.add(new THREE.Mesh(round(0.12, h, 0.14, 0.04), M.wood()).translateX(sx * (w / 2 + 0.06)).translateY(h / 2))
	const arch = new THREE.Mesh(new THREE.TorusGeometry(w / 2 + 0.06, 0.06, 8, 20, Math.PI), M.wood())
	arch.position.y = h
	g.add(arch)
	g.add(new THREE.Mesh(round(w + 0.3, 0.05, 0.5, 0.02), M.stone()).translateY(0.025))
	// the leaf, open against the frame
	const leaf = new THREE.Group()
	leaf.add(new THREE.Mesh(new THREE.BoxGeometry(w, h - 0.05, 0.03), new THREE.MeshStandardMaterial({ color: '#dfeef0', roughness: 0.05, transparent: true, opacity: 0.25 })).translateX(w / 2).translateY(h / 2))
	for (const x of [0, w]) leaf.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), M.wood()).translateX(x).translateY(h / 2))
	leaf.position.x = -w / 2
	leaf.rotation.y = 1.9
	g.add(leaf)
	return g
}

/**
 * The terraces' furniture: rounded, handmade, and never twice the same in a row.
 * Built in a local frame: +z points out over the balustrade, the set centred on
 * the origin; kind 0..3 picks which.
 */
export function terraceSet(kind: number, seed: number): THREE.Group {
	const r = seeded(seed)
	const g = new THREE.Group()
	const plaster = PLASTER[seed % PLASTER.length]!()
	const accent = M.felt[seed % M.felt.length]!()
	if (kind === 0) {
		// a round table for six under the vines, round stools all round
		g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 32), M.wood()).translateY(0.74))
		g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.34, 0.74, 16), M.darkWood()).translateY(0.37))
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2
			g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.45, 18), M.wood()).translateX(Math.sin(a) * 1.15).translateY(0.225).translateZ(Math.cos(a) * 1.15))
		}
		g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.darkWood()).translateY(0.94))
	} else if (kind === 1) {
		// two daybeds, rounded and cushioned, facing out over the forest, a low round table between
		for (const x of [-0.95, 0.95]) {
			const bed = new THREE.Group()
			bed.add(new THREE.Mesh(round(0.8, 0.3, 1.9, 0.14), M.wood()).translateY(0.15))
			bed.add(new THREE.Mesh(round(0.74, 0.16, 1.8, 0.08), M.wool()).translateY(0.38))
			const back = new THREE.Mesh(round(0.74, 0.14, 0.7, 0.07), accent)
			back.position.set(0, 0.6, -0.62)
			back.rotation.x = 0.7
			bed.add(back)
			bed.position.x = x
			g.add(bed)
		}
		g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 20), plaster).translateY(0.2))
	} else if (kind === 2) {
		// a curved plaster bench round a low table, felt cushions, a big round planter at each end
		const bench = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.24, 10, 28, Math.PI), plaster)
		bench.rotation.x = Math.PI / 2
		bench.scale.z = 1.4
		bench.position.set(0, 0.3, -0.2)
		g.add(bench)
		for (let i = 0; i < 4; i++) {
			const a = Math.PI * (0.15 + (i / 3) * 0.7)
			g.add(new THREE.Mesh(round(0.45, 0.1, 0.45, 0.05), accent).translateX(Math.cos(a) * 1.25).translateY(0.58).translateZ(-0.2 - Math.sin(a) * 1.25))
		}
		g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.45, 0.4, 24), M.wood()).translateY(0.2).translateZ(0.35))
		for (const x of [-1.8, 1.8]) {
			g.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 10, 0, Math.PI * 2, 0, Math.PI / 1.6), plaster).translateX(x).translateY(0.1).rotateX(Math.PI))
			const olive = potted('olive', seed + Math.round(x * 10), 0.9)
			olive.position.set(x, 0.1, 0)
			g.add(olive)
		}
	} else {
		// two hanging egg chairs from a curved timber frame, a sheepskin in each
		const frame = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.07, 8, 24, Math.PI), M.wood())
		frame.position.y = 0.05
		g.add(frame)
		for (const x of [-0.7, 0.7]) {
			g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), M.darkWood()).translateX(x).translateY(1.2))
			const egg = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14, 0, Math.PI * 2, 0.35, Math.PI - 0.35), M.basket())
			egg.scale.set(1, 1.2, 1)
			egg.position.set(x, 0.85, 0)
			egg.rotation.x = -0.25
			g.add(egg)
			g.add(new THREE.Mesh(round(0.55, 0.1, 0.5, 0.05), M.wool()).translateX(x).translateY(0.52).translateZ(0.05))
		}
		g.add(houseplant('monstera', seed + 3, 1.3).translateX(1.9))
	}
	for (let i = 0; i < 2; i++) {
		const kind = r() < 0.5 ? 'lavender' : 'rosemary'
		g.add(potted(kind, seed * 3 + i, 1.2).translateX(i ? 2.2 : -2.2).translateZ(0.6))
	}
	return g
}
