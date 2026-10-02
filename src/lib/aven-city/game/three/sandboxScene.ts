/**
 * The biome sandbox: one specimen tile on a display pedestal.
 * Used to iterate on per-biome clay styling in isolation — and, later, to
 * preview per-biome upgrade-level styling variants.
 */
import * as THREE from 'three'
import type { BiomeId } from '../hexmap'
import { buildBiomeTile, type PlacedKind } from './buildWorld'
import { createOrbitRig } from '$lib/sandbox-kit/orbit.js'
import { createSky } from '$lib/sandbox-kit/sky.js'

export interface SandboxApi {
	show(biome: BiomeId, seed: number, options?: { building?: PlacedKind }): void
	dispose(): void
}

export function createSandbox(canvas: HTMLCanvasElement): SandboxApi {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1.05

	const scene = new THREE.Scene()

	const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
	camera.position.set(2.1, 1.9, 2.8)

	// the sandbox is a turntable: the specimen stays centered and you look at
	// it from any angle — no walking away from the thing you are styling
	const rig = createOrbitRig(camera, canvas, {
		minDistance: 1.2,
		maxDistance: 9,
		target: new THREE.Vector3(0, 0.35, 0),
		freeMove: false,
		floorY: -0.05
	})

	// the one sky of every world, over one tile ($lib/sandbox-kit/sky): its shadows round the pedestal, no fog,
	// the islands' lens
	const sky = createSky(renderer, scene, { shadowsAt: [0, 0], shadowReach: 3, shadowNear: 0.5, shadowFar: 20, shadowMap: 2048, shadowBias: { bias: -0.0004, normal: 0 }, lightDistance: 8, fog: null, exposure: { day: 0.36, night: 0.8 } })

	// soft display pedestal catching the tile's shadow
	const pedestal = new THREE.Mesh(
		new THREE.CylinderGeometry(2.4, 2.6, 0.18, 48),
		new THREE.MeshStandardMaterial({ color: '#bcdfe3', roughness: 0.95, metalness: 0 })
	)
	pedestal.position.y = -0.1
	pedestal.receiveShadow = true
	scene.add(pedestal)

	let specimen: THREE.Object3D | null = null

	function disposeSpecimen(): void {
		if (!specimen) return
		scene.remove(specimen)
		specimen.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				o.geometry.dispose()
				const mats = Array.isArray(o.material) ? o.material : [o.material]
				for (const m of mats) m.dispose()
			}
		})
		specimen = null
	}

	function show(biome: BiomeId, seed: number, options: { building?: PlacedKind } = {}): void {
		disposeSpecimen()
		specimen = buildBiomeTile(biome, seed, options)
		scene.add(specimen)
	}

	function resize(): void {
		const w = canvas.clientWidth
		const h = canvas.clientHeight
		if (
			canvas.width !== w * renderer.getPixelRatio() ||
			canvas.height !== h * renderer.getPixelRatio()
		) {
			renderer.setSize(w, h, false)
			camera.aspect = w / h
			camera.updateProjectionMatrix()
		}
	}

	const clock = new THREE.Clock()
	let raf = 0
	function animate(): void {
		raf = requestAnimationFrame(animate)
		resize()
		rig.update(clock.getDelta())
		sky.tick()
		renderer.render(scene, camera)
	}
	animate()

	return {
		show,
		dispose(): void {
			cancelAnimationFrame(raf)
			rig.dispose()
			sky.dispose()
			disposeSpecimen()
			pedestal.geometry.dispose()
			;(pedestal.material as THREE.Material).dispose()
			renderer.dispose()
		}
	}
}
