<!--
	PLANT LOOK — the picked plant alone, small, at the top of its card in Sandbox 5: the same plant (its id, version,
	stage and seed) as it stands in the forest, grown a little finer off the page (./flora.worker.js, the `look` tier of
	./flora.grow.js) and turning slowly on a patch of soil. Drag to turn it round yourself.
-->
<script>
	import { onDestroy, onMount } from 'svelte';

	/** @type {{ kind: import('./flora.grow.js').Kind }} */
	let { kind } = $props();

	/** @type {HTMLDivElement} */
	let box;
	let growing = $state(true);
	/** @type {((kind: import('./flora.grow.js').Kind) => void) | null} */
	let show = null;
	/** @type {(() => void) | null} */
	let stop = null;

	onMount(() => {
		let gone = false;
		(async () => {
			const THREE = await import('three');
			const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
			if (gone) return;
			const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
			renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			box.appendChild(renderer.domElement);
			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 400);
			const controls = new OrbitControls(camera, renderer.domElement);
			controls.enableDamping = true;
			controls.enablePan = false;
			controls.autoRotate = true;
			controls.autoRotateSpeed = 1.6;
			controls.maxPolarAngle = Math.PI * 0.55;
			scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.3));
			const key = new THREE.DirectionalLight('#fff4e6', 2.2);
			key.position.set(1.2, 2.2, 0.9);
			scene.add(key);
			// a patch of soil under it, fading out at its rim
			const soil = new THREE.Mesh(
				new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
				new THREE.ShaderMaterial({
					transparent: true,
					depthWrite: false,
					vertexShader: 'varying vec2 p; void main() { p = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
					fragmentShader: 'varying vec2 p; void main() { float r = length(p); gl_FragColor = vec4(0.48, 0.38, 0.27, 0.55 * (1.0 - smoothstep(0.35, 1.0, r))); }'
				})
			);
			scene.add(soil);
			const materials = {
				body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
				sheet: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }),
				gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 })
			};
			/** @type {import('three').Group | null} */
			let plant = null;

			const worker = new Worker(new URL('./flora.worker.js', import.meta.url), { type: 'module' });
			let job = 0;
			worker.onmessage = (/** @type {MessageEvent<{ job: number, shape?: import('./flora.grow.js').Shape }>} */ e) => {
				if (e.data.job !== job || !e.data.shape) return;
				const shape = e.data.shape;
				if (plant) {
					plant.traverse((o) => /** @type {import('three').Mesh} */ (o).geometry?.dispose());
					scene.remove(plant);
				}
				plant = new THREE.Group();
				for (const part of shape.parts) {
					const g = new THREE.BufferGeometry();
					g.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
					g.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3));
					g.setAttribute('color', new THREE.BufferAttribute(part.color, 3));
					g.setIndex(new THREE.BufferAttribute(part.index, 1));
					plant.add(new THREE.Mesh(g, materials[part.kind]));
				}
				scene.add(plant);
				// framed whole: its height and its reach, from a little above
				const size = Math.max(0.05, shape.height, shape.reach * 2);
				soil.scale.setScalar(Math.max(0.1, shape.reach * 1.5, shape.height * 0.35));
				controls.target.set(0, shape.height * 0.48, 0);
				const away = (size / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.25;
				camera.position.copy(controls.target).add(new THREE.Vector3(0.75, 0.32, 1).normalize().multiplyScalar(away));
				camera.near = away / 100;
				camera.far = away * 10;
				camera.updateProjectionMatrix();
				controls.update();
				growing = false;
			};
			show = (k) => {
				growing = true;
				worker.postMessage({ job: ++job, kind: $state.snapshot(k), tier: 'look' });
			};
			show(kind);

			const fit = () => {
				const w = box.clientWidth, h = box.clientHeight;
				renderer.setSize(w, h, false);
				camera.aspect = w / Math.max(1, h);
				camera.updateProjectionMatrix();
			};
			const watch = new ResizeObserver(fit);
			watch.observe(box);
			fit();
			let frame = 0;
			const tick = () => {
				frame = requestAnimationFrame(tick);
				controls.update();
				renderer.render(scene, camera);
			};
			tick();
			stop = () => {
				cancelAnimationFrame(frame);
				watch.disconnect();
				worker.terminate();
				controls.dispose();
				plant?.traverse((o) => /** @type {import('three').Mesh} */ (o).geometry?.dispose());
				soil.geometry.dispose();
				soil.material.dispose();
				for (const m of Object.values(materials)) m.dispose();
				renderer.dispose();
				renderer.domElement.remove();
			};
		})();
		return () => (gone = true);
	});
	onDestroy(() => stop?.());

	// another plant picked while the card is open: grow that one
	$effect(() => {
		const k = { id: kind.id, v: kind.v, stage: kind.stage, seed: kind.seed };
		show?.(k);
	});
</script>

<div class="look" bind:this={box}>
	{#if growing}<p>Growing it…</p>{/if}
</div>

<style>
	.look {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 12px;
		overflow: hidden;
		background: radial-gradient(120% 90% at 50% 20%, #f4f1ea 0%, #e3ddd1 100%);
		touch-action: none;
	}

	.look :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
		cursor: grab;
	}

	p {
		position: absolute;
		inset: auto 0 0.6rem;
		margin: 0;
		text-align: center;
		font-size: 0.72rem;
		opacity: 0.55;
		pointer-events: none;
	}
</style>
