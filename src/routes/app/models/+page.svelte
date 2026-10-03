<!--
	3D models: every reusable model the worlds are built from (src/lib/models), one at a time on a turntable — drag to
	turn round it, scroll to come closer — on a grid of 10 cm squares, with its measure. An admin's.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { MODELS, type Model } from '$lib/models';

	let canvasBox = $state<HTMLDivElement>();
	let chosen = $state<Model>(MODELS[0]!);
	let size = $state<[number, number, number] | null>(null);
	let show: ((m: Model) => void) | null = null;
	let dispose: (() => void) | null = null;

	onMount(async () => {
		const THREE = await import('three');
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		const box = canvasBox!;
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;
		box.appendChild(renderer.domElement);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#e9e6e0');
		const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.2));
		const key = new THREE.DirectionalLight('#fff4e6', 2.2);
		key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048);
		scene.add(key, key.target);
		// the floor: a soft shadow catcher, and a grid of 10 cm squares (1 m lines darker)
		const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.22 }));
		floor.rotation.x = -Math.PI / 2;
		floor.receiveShadow = true;
		scene.add(floor);
		let grid: InstanceType<typeof THREE.Group> | null = null;
		let current: InstanceType<typeof THREE.Object3D> | null = null;

		show = (m: Model) => {
			if (current) scene.remove(current);
			if (grid) scene.remove(grid);
			current = m.make();
			current.traverse((o) => {
				if ((o as InstanceType<typeof THREE.Mesh>).isMesh) o.castShadow = true;
			});
			scene.add(current);
			const b = new THREE.Box3().setFromObject(current);
			const s = b.getSize(new THREE.Vector3());
			size = [s.x, s.y, s.z];
			const reach = Math.max(s.x, s.y, s.z);
			// the grid as large as the model, in 10 cm squares
			const span = Math.ceil((Math.max(s.x, s.z) + 0.6) * 2) / 2;
			grid = new THREE.Group();
			grid.add(new THREE.GridHelper(span, Math.round(span * 10), '#cfc9bf', '#cfc9bf'));
			grid.add(new THREE.GridHelper(span, Math.max(1, Math.round(span)), '#a59e92', '#a59e92'));
			grid.position.y = 0.001;
			scene.add(grid);
			const mid = b.getCenter(new THREE.Vector3());
			controls.target.copy(mid);
			camera.position.set(mid.x + reach * 1.3, mid.y + reach * 0.8, mid.z + reach * 1.6);
			camera.near = reach / 200;
			camera.far = reach * 60;
			camera.updateProjectionMatrix();
			key.position.set(mid.x + reach * 2, reach * 3, mid.z + reach * 1.5);
			key.target.position.copy(mid);
			const sh = key.shadow.camera;
			sh.left = sh.bottom = -reach * 1.5;
			sh.right = sh.top = reach * 1.5;
			sh.near = 0.01;
			sh.far = reach * 10;
			sh.updateProjectionMatrix();
		};
		const resize = () => {
			const w = box.clientWidth, h = box.clientHeight;
			renderer.setSize(w, h);
			camera.aspect = w / Math.max(1, h);
			camera.updateProjectionMatrix();
		};
		const ro = new ResizeObserver(resize);
		ro.observe(box);
		resize();
		show(chosen);
		let frame = 0;
		const tick = () => {
			controls.update();
			renderer.render(scene, camera);
			frame = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(frame);
			ro.disconnect();
			controls.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		};
	});
	onDestroy(() => dispose?.());

	const pick = (m: Model) => {
		chosen = m;
		show?.(m);
	};
	const cm = (v: number) => Math.round(v * 100);
</script>

<svelte:head>
	<title>3D models · maiaCITY</title>
</svelte:head>

<main class="models">
	<aside>
		<h1>3D models</h1>
		<p class="lede">The things the worlds are built from, each to its real measure.</p>
		<ul>
			{#each MODELS as m (m.id)}
				<li>
					<button class:on={chosen.id === m.id} onclick={() => pick(m)}>
						<b>{m.label}</b>
						<span>{m.note}</span>
						<small>in {m.usedIn}</small>
					</button>
				</li>
			{/each}
		</ul>
	</aside>
	<section class="view">
		<div class="canvas" bind:this={canvasBox}></div>
		<div class="readout">
			<b>{chosen.label}</b>
			{#if size}<span>{cm(size[0])} × {cm(size[2])} × {cm(size[1])} cm <small>(width × depth × height)</small></span>{/if}
			<small>Drag to turn round it · scroll to come closer · the grid is 10 cm</small>
		</div>
	</section>
</main>

<style>
	.models {
		position: fixed;
		inset: 0;
		/* on a phone: clear of the notch and the home bar (the page runs edge to edge) */
		padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
		display: grid;
		grid-template-columns: minmax(15rem, 22rem) 1fr;
		background: #f4f1eb;
		color: #1f2a23;
	}

	/* the list scrolls clear of the nav pill at its foot */
	aside {
		overflow: auto;
		padding: 1.4rem 1rem calc(2rem + var(--nav-room));
		border-right: 1px solid rgb(0 0 0 / 0.08);
	}

	h1 {
		margin: 0.6rem 0 0.2rem;
		font-size: 1.5rem;
	}

	.lede {
		margin: 0 0 1rem;
		opacity: 0.7;
		font-size: 0.9rem;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li button {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		width: 100%;
		padding: 0.6rem 0.75rem;
		border: 1px solid transparent;
		border-radius: 10px;
		background: transparent;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}

	li button:hover {
		background: rgb(0 0 0 / 0.04);
	}

	li button.on {
		border-color: rgb(0 0 0 / 0.15);
		background: #fff;
	}

	li span {
		font-size: 0.8rem;
		opacity: 0.75;
	}

	li small {
		font-size: 0.72rem;
		opacity: 0.5;
	}

	.view {
		position: relative;
		min-width: 0;
	}

	.canvas {
		position: absolute;
		inset: 0;
		cursor: grab;
	}

	/* at the foot, above the app's nav pill (--nav-room, src/app.css; the page already keeps clear of the home bar) */
	.readout {
		position: absolute;
		left: 1rem;
		bottom: calc(1rem + var(--nav-room) - env(safe-area-inset-bottom, 0px));
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.9rem;
		border-radius: 12px;
		background: rgb(255 255 255 / 0.75);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		font-size: 0.85rem;
	}

	.readout small {
		opacity: 0.6;
	}

	@media (max-width: 720px) {
		.models {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}

		aside {
			max-height: 40vh;
			border-right: 0;
			border-bottom: 1px solid rgb(0 0 0 / 0.08);
		}
	}
</style>
