<!--
	PLANT LOOK — the picked plant alone, small, at the top of its card in Sandbox 5: the same plant (its id, version,
	stage and seed) as it stands in the forest, built a little finer in the asset box ($lib/assets/load.js, at the
	`look` tier's detail of ./sandbox5.js `TIERS`), what is under the soil cut away, turning slowly on a patch of soil.
	Drag to turn it round yourself.
-->
<script>
	import { onDestroy, onMount } from 'svelte';

	/** @type {{ kind: import('./sandbox5.js').Kind }} */
	let { kind } = $props();

	/** @type {HTMLDivElement} */
	let box;
	let growing = $state(true);
	/** @type {((kind: import('./sandbox5.js').Kind) => void) | null} */
	let show = null;
	/** @type {(() => void) | null} */
	let stop = null;

	onMount(() => {
		let gone = false;
		(async () => {
			const THREE = await import('three');
			const [{ createStageRenderer }, { disposeObject }] = await Promise.all([import('$lib/render/stage.js'), import('$lib/render/core.js')]);
			const [{ loadAsset }, { buildAt, loadRecipes }, { refOf }, { TIERS }] = await Promise.all([import('$lib/assets/load.js'), import('$lib/assets/vault.js'), import('./flora.js'), import('./sandbox5.js')]);
			// the plant's recipe is the Maia City vault's ($lib/assets/vault.js)
			await loadRecipes();
			if (gone) return;
			// the stage renderer ($lib/render/stage.js), see-through over the card; what is under the soil cut away, as it
			// is in the forest, where no one sees it
			const view = createStageRenderer(box, { alpha: true, clipping: true, toneMapping: 'aces', fov: 32, near: 0.01, far: 400, style: false, controls: { enablePan: false, autoRotate: true, autoRotateSpeed: 1.6, maxPolarAngle: Math.PI * 0.55 } });
			const { renderer, camera, controls } = view;
			const soilLine = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.01)];
			const scene = new THREE.Scene();
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
			/** @type {import('three').Object3D | null} */
			let plant = null;
			/** a plant built and its parts' meshes, let go @param {import('three').Object3D} o */
			const letGo = (o) => disposeObject(o, { textures: false });
			/** how tall it stands and how far it reaches out over the soil @param {import('three').Object3D} o */
			const measure = (o) => {
				let height = 0, reach = 0;
				const v = new THREE.Vector3();
				o.updateMatrixWorld(true);
				o.traverse((c) => {
					const mesh = /** @type {import('three').Mesh} */ (c);
					const P = mesh.isMesh ? mesh.geometry.attributes.position : null;
					if (!P) return;
					for (let i = 0; i < P.count; i++) {
						v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
						if (v.y > height) height = v.y;
						if (v.y > 0) reach = Math.max(reach, Math.hypot(v.x, v.z));
					}
				});
				return { height, reach };
			};

			let job = 0;
			show = async (k) => {
				growing = true;
				const mine = ++job;
				let got;
				try {
					got = await loadAsset(buildAt(`${refOf(k)}&detail=${TIERS.look.level}`));
				} catch (err) {
					console.warn('plant look: not built', err);
					return;
				}
				if (mine !== job || gone) return letGo(got.obj);
				if (plant) {
					letGo(plant);
					scene.remove(plant);
				}
				plant = got.obj;
				plant.traverse((c) => {
					const mesh = /** @type {import('three').Mesh} */ (c);
					if (mesh.isMesh) for (const mt of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mt.clippingPlanes = soilLine;
				});
				scene.add(plant);
				const shape = measure(plant);
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
			show($state.snapshot(kind));

			view.resize();
			let frame = 0;
			const tick = () => {
				frame = requestAnimationFrame(tick);
				controls.update();
				renderer.render(scene, camera);
			};
			tick();
			stop = () => {
				cancelAnimationFrame(frame);
				job++;
				if (plant) letGo(plant);
				soil.geometry.dispose();
				soil.material.dispose();
				view.dispose();
			};
		})();
		return () => (gone = true);
	});
	onDestroy(() => stop?.());

	// another plant picked while the card is open: grow that one
	$effect(() => {
		const k = { id: kind.id, v: kind.v, ...(kind.pin ? { pin: kind.pin } : {}), stage: kind.stage, seed: kind.seed };
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
