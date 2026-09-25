/**
 * The animals of the land outside: hens scratching in their runs and out
 * under the trees, goats browsing the forest, geese along the stream. Each
 * kind is one instanced mesh with its colours baked into the vertices, so a
 * hundred animals cost a handful of draw calls, and every animal wanders on
 * its own: it walks, turns, stops to peck or graze, and walks on, always
 * inside its own patch of ground.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { seeded } from './plants'

type Part = { geo: THREE.BufferGeometry; color: string; at: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] }

/** Merges an animal's parts into one geometry, each part's colour written into its vertices. */
function model(parts: Part[]): THREE.BufferGeometry {
	const geos = parts.map(({ geo, color, at, rot = [0, 0, 0], scale = [1, 1, 1] }) => {
		const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry
		g.deleteAttribute('uv')
		g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)))
		const c = new THREE.Color(color)
		const n = g.attributes.position!.count
		g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]!), 3))
		return g
	})
	return mergeGeometries(geos)!
}

const ball = new THREE.SphereGeometry(1, 10, 8)
const cone = new THREE.ConeGeometry(1, 1, 6)
const rod = new THREE.CylinderGeometry(1, 1, 1, 5)
const block = new THREE.BoxGeometry(1, 1, 1)

/** A hen, facing +z, standing on y 0. */
const hen = (coat: string) =>
	model([
		{ geo: ball, color: coat, at: [0, 0.24, 0], scale: [0.14, 0.15, 0.21] },
		{ geo: cone, color: coat, at: [0, 0.36, -0.2], rot: [-0.7, 0, 0], scale: [0.09, 0.2, 0.09] },
		{ geo: ball, color: coat, at: [0, 0.42, 0.18], scale: [0.075, 0.075, 0.075] },
		{ geo: cone, color: '#e2a93b', at: [0, 0.41, 0.27], rot: [Math.PI / 2, 0, 0], scale: [0.025, 0.07, 0.025] },
		{ geo: block, color: '#c7362c', at: [0, 0.49, 0.19], scale: [0.02, 0.06, 0.08] },
		{ geo: rod, color: '#e2a93b', at: [-0.05, 0.06, 0], scale: [0.012, 0.12, 0.012] },
		{ geo: rod, color: '#e2a93b', at: [0.05, 0.06, 0], scale: [0.012, 0.12, 0.012] }
	])

/** A goat, facing +z: a deep body on thin legs, a beard, and horns swept back. */
const goat = (coat: string) =>
	model([
		{ geo: ball, color: coat, at: [0, 0.72, 0], scale: [0.24, 0.26, 0.5] },
		...([[-0.13, 0.28], [0.13, 0.28], [-0.13, -0.3], [0.13, -0.3]] as const).map(([x, z]) => ({ geo: rod, color: coat, at: [x, 0.25, z] as [number, number, number], scale: [0.04, 0.5, 0.04] as [number, number, number] })),
		{ geo: rod, color: coat, at: [0, 0.95, 0.42], rot: [0.6, 0, 0], scale: [0.08, 0.35, 0.08] },
		{ geo: ball, color: coat, at: [0, 1.1, 0.55], rot: [0.5, 0, 0], scale: [0.1, 0.1, 0.18] },
		{ geo: cone, color: '#5a4a3a', at: [-0.05, 1.25, 0.48], rot: [-0.9, 0, 0], scale: [0.025, 0.18, 0.025] },
		{ geo: cone, color: '#5a4a3a', at: [0.05, 1.25, 0.48], rot: [-0.9, 0, 0], scale: [0.025, 0.18, 0.025] },
		{ geo: ball, color: coat, at: [-0.12, 1.12, 0.5], scale: [0.08, 0.025, 0.04] },
		{ geo: ball, color: coat, at: [0.12, 1.12, 0.5], scale: [0.08, 0.025, 0.04] },
		{ geo: cone, color: '#d8d2c4', at: [0, 0.98, 0.64], rot: [Math.PI, 0, 0], scale: [0.03, 0.1, 0.03] },
		{ geo: cone, color: coat, at: [0, 0.9, -0.5], rot: [-0.9, 0, 0], scale: [0.04, 0.14, 0.04] }
	])

/** A goose, facing +z: a white body, a long neck held up, an orange bill. */
const goose = (coat: string) =>
	model([
		{ geo: ball, color: coat, at: [0, 0.3, 0], scale: [0.17, 0.16, 0.3] },
		{ geo: cone, color: coat, at: [0, 0.36, -0.3], rot: [-1.2, 0, 0], scale: [0.1, 0.16, 0.06] },
		{ geo: rod, color: coat, at: [0, 0.52, 0.22], rot: [0.25, 0, 0], scale: [0.04, 0.36, 0.04] },
		{ geo: ball, color: coat, at: [0, 0.72, 0.28], scale: [0.06, 0.06, 0.08] },
		{ geo: cone, color: '#e8862c', at: [0, 0.71, 0.39], rot: [Math.PI / 2, 0, 0], scale: [0.025, 0.1, 0.02] },
		{ geo: rod, color: '#e8862c', at: [-0.06, 0.08, 0], scale: [0.015, 0.16, 0.015] },
		{ geo: rod, color: '#e8862c', at: [0.06, 0.08, 0], scale: [0.015, 0.16, 0.015] }
	])

export type Patch = { x: number; z: number; r: number; n: number }
type Kind = 'hen' | 'goat' | 'goose'
const KINDS: Record<Kind, { make: (coat: string) => THREE.BufferGeometry; coats: string[]; speed: number; turn: number; stop: [number, number]; walk: [number, number] }> = {
	hen: { make: hen, coats: ['#f4efe4', '#b8703a', '#3b3430', '#d9a066'], speed: 0.45, turn: 3, stop: [0.6, 3], walk: [0.5, 2] },
	goat: { make: goat, coats: ['#f1ede4', '#8a5a36', '#3b332e'], speed: 0.6, turn: 1.4, stop: [2, 7], walk: [1, 4] },
	goose: { make: goose, coats: ['#f7f5ef', '#f7f5ef', '#9aa0a0'], speed: 0.4, turn: 1.2, stop: [1, 4], walk: [1.5, 5] }
}

type Animal = { x: number; z: number; yaw: number; home: Patch; walking: boolean; until: number; coat: number; phase: number }

/**
 * A kind of animal spread over its patches of ground. `update(t)` moves every
 * one of them and writes their places into the instanced meshes.
 */
export function herd(kind: Kind, patches: Patch[], seed: number): { object: THREE.Group; update: (t: number) => void; where: () => { x: number; z: number }[] } {
	const spec = KINDS[kind]
	const r = seeded(seed)
	const animals: Animal[] = []
	for (const home of patches)
		for (let i = 0; i < home.n; i++) {
			const a = r() * Math.PI * 2, d = Math.sqrt(r()) * home.r * 0.8
			animals.push({ x: home.x + Math.cos(a) * d, z: home.z + Math.sin(a) * d, yaw: r() * Math.PI * 2, home, walking: r() < 0.5, until: r() * 3, coat: Math.floor(r() * spec.coats.length), phase: r() * 10 })
		}
	const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
	const object = new THREE.Group()
	const meshes = spec.coats.map((coat, c) => {
		const count = animals.filter((an) => an.coat === c).length
		const mesh = new THREE.InstancedMesh(spec.make(coat), material, Math.max(1, count))
		mesh.count = count
		mesh.castShadow = true
		mesh.frustumCulled = false
		object.add(mesh)
		return mesh
	})
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
	let last = 0
	const update = (t: number) => {
		const dt = Math.min(0.1, t - last)
		last = t
		const slot = spec.coats.map(() => 0)
		for (const an of animals) {
			if (t > an.until) {
				an.walking = !an.walking
				const [lo, hi] = an.walking ? spec.walk : spec.stop
				an.until = t + lo + r() * (hi - lo)
				if (an.walking) an.yaw += (r() - 0.5) * 2.4
			}
			if (an.walking) {
				// wander, and turn back toward the middle of the patch near its edge
				const dx = an.home.x - an.x, dz = an.home.z - an.z
				const off = Math.hypot(dx, dz)
				an.yaw += (Math.sin(t * 0.9 + an.phase) * 0.5) * spec.turn * dt
				if (off > an.home.r * 0.75) {
					const want = Math.atan2(dx, dz)
					const diff = Math.atan2(Math.sin(want - an.yaw), Math.cos(want - an.yaw))
					an.yaw += Math.sign(diff) * Math.min(Math.abs(diff), spec.turn * dt * 1.5)
				}
				an.x += Math.sin(an.yaw) * spec.speed * dt
				an.z += Math.cos(an.yaw) * spec.speed * dt
			}
			// a hen pecks and a goat grazes when it stops; walking, each bobs or waddles
			const pause = !an.walking
			const pitch = pause ? (kind === 'hen' ? Math.max(0, Math.sin(t * 5 + an.phase)) * 0.55 : kind === 'goat' ? 0.25 : 0) : 0
			const roll = an.walking && kind === 'goose' ? Math.sin(t * 7 + an.phase) * 0.08 : 0
			const bob = an.walking ? Math.abs(Math.sin(t * (kind === 'hen' ? 12 : 6) + an.phase)) * (kind === 'goat' ? 0.03 : 0.02) : 0
			q.setFromEuler(e.set(pitch, an.yaw, roll))
			m.compose(p.set(an.x, bob, an.z), q, one)
			meshes[an.coat]!.setMatrixAt(slot[an.coat]!++, m)
		}
		for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true
	}
	update(0)
	return { object, update, where: () => animals }
}
