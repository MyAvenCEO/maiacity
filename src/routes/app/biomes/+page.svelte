<!--
	Biomes: the floors the worlds stand on (src/lib/biomes), each a patch of ground 16 m across at standing height — its
	surfaces (leaf litter, humus, needles, moss, the living mat, bare soil) run into each other in patches, and its cover
	growing and lying on them in colonies. Every layer to show or hide; and mixed with a second biome, as far as the
	slider says. Drag to turn round it, scroll to come closer. An admin's.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { BIOMES, COVER, SURFACE, SURFACES, groundMaterial, mix } from '$lib/biomes';
	import { coverStream } from '$lib/biomes/stream.js';
	import Turntable from '$lib/app/Turntable.svelte';
	import { fit } from '$lib/app/turntable.js';

	/** @typedef {(typeof BIOMES)[number]} Biome */
	/** @typedef {import('$lib/biomes').Recipe} Recipe */

	const SIZE = 16;
	/** @type {HTMLDivElement | undefined} */
	let canvasBox = $state();
	/** @type {Biome} */
	let chosen = $state(BIOMES[0]);
	/** the biome mixed in, and how far */
	let other = $state(BIOMES[1]?.id ?? BIOMES[0].id);
	let amount = $state(0);
	/** the layers hidden: surfaces by name, cover by its index in the recipe shown */
	let hiddenSurfaces = $state(/** @type {string[]} */ ([]));
	let hiddenCover = $state(/** @type {number[]} */ ([]));
	let above = $state(false);

	/** the recipe on the ground: the chosen biome, mixed with the other as far as asked */
	const recipe = $derived(mix(chosen, BIOMES.find((b) => b.id === other) ?? chosen, amount));
	const surfaceShare = $derived.by(() => {
		const sum = SURFACES.reduce((n, s) => n + (recipe.surface[s] ?? 0), 0) || 1;
		return SURFACES.filter((s) => (recipe.surface[s] ?? 0) > 0).map((s) => ({ s, share: (recipe.surface[s] ?? 0) / sum }));
	});
	const coverShare = $derived.by(() => {
		const sum = recipe.cover.reduce((n, c) => n + c.share, 0) || 1;
		return recipe.cover.map((c, i) => ({ i, kind: c.kind, share: c.share / sum })).filter((c) => c.share > 0.001);
	});

	/** @type {((r: Recipe, hs: string[], hc: number[]) => void) | null} */
	let show = null;
	/** @type {((top: boolean) => void) | null} */
	let look = null;
	/** @type {(() => void) | null} */
	let dispose = null;

	onMount(async () => {
		const THREE = await import('three');
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		const box = /** @type {HTMLDivElement} */ (canvasBox);
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
		renderer.shadowMap.enabled = true;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		box.appendChild(renderer.domElement);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#cfdbe0');
		scene.fog = new THREE.Fog('#cfdbe0', 14, 34);
		const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
		camera.userData.fov = 50; // widened on an upright canvas ($lib/app/turntable.js)
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.maxPolarAngle = Math.PI / 2 - 0.05;
		scene.add(new THREE.HemisphereLight('#e8f0ff', '#5a4a34', 1.1));
		const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
		sun.position.set(6, 12, 4);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		const sh = sun.shadow.camera;
		sh.left = sh.bottom = -12;
		sh.right = sh.top = 12;
		scene.add(sun);
		// the patch of ground, and a ring of it beyond fading into the fog
		const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 4, SIZE * 4, 1, 1).rotateX(-Math.PI / 2), groundMaterial(chosen.surface));
		ground.receiveShadow = true;
		scene.add(ground);
		const stream = coverStream({ recipe: chosen, tile: 8, reach: 26, near: 22, shadows: true });
		scene.add(stream.object);

		show = (r, hs, hc) => {
			// the surfaces: the hidden ones weighed nothing
			/** @type {Record<string, number>} */
			const w = {};
			for (const s of SURFACES) w[s] = hs.includes(s) ? 0 : (r.surface[s] ?? 0);
			if (SURFACES.every((s) => !w[s])) w.soil = 1;
			ground.material.userData.weigh(w);
			const shown = { ...r, surface: w };
			// the cover: streamed round the middle, every tile within reach built at once
			stream.rebuild(shown, new Set(hc));
			stream.update(0, 0, 999);
		};
		look = (top) => {
			controls.target.set(0, 0.2, 0);
			if (top) camera.position.set(0.01, 14, 0.01);
			else camera.position.set(5.5, 1.65, 7.5);
			camera.updateProjectionMatrix();
		};
		const resize = () => {
			const w = box.clientWidth, h = box.clientHeight;
			renderer.setSize(w, h);
			fit(camera, w, h);
		};
		const ro = new ResizeObserver(resize);
		ro.observe(box);
		resize();
		look(false);
		show(recipe, $state.snapshot(hiddenSurfaces), $state.snapshot(hiddenCover));
		let raf = 0;
		const tick = () => {
			controls.update();
			renderer.render(scene, camera);
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		};
	});
	onDestroy(() => dispose?.());

	const redraw = () => show?.($state.snapshot(recipe), $state.snapshot(hiddenSurfaces), $state.snapshot(hiddenCover));
	/** @param {Biome} b */
	const pick = (b) => {
		chosen = b;
		hiddenSurfaces = [];
		hiddenCover = [];
		redraw();
	};
	/** @param {string} s */
	const toggleSurface = (s) => {
		hiddenSurfaces = hiddenSurfaces.includes(s) ? hiddenSurfaces.filter((x) => x !== s) : [...hiddenSurfaces, s];
		redraw();
	};
	/** @param {number} i */
	const toggleCover = (i) => {
		hiddenCover = hiddenCover.includes(i) ? hiddenCover.filter((x) => x !== i) : [...hiddenCover, i];
		redraw();
	};
	const pct = (/** @type {number} */ v) => `${Math.round(v * 100)} %`;
</script>

<svelte:head>
	<title>Biomes · maiaCITY</title>
</svelte:head>

<Turntable
	name="biomes"
	bind:canvas={canvasBox}
	picks={{ title: 'Biomes', lede: 'The floors the worlds stand on: their surfaces and what grows on them, in layers that mix.', items: BIOMES, chosen, where: (/** @type {Biome} */ b) => b.from, onpick: pick }}
>
	{#snippet bar()}
		<div class="chips">
			<button type="button" class="chip" class:on={!above} onclick={() => { above = false; look?.(false); }}>Standing</button>
			<button type="button" class="chip" class:on={above} onclick={() => { above = true; look?.(true); }}>From above</button>
		</div>
	{/snippet}
	{#snippet panel()}
		<div class="layers">
			<span class="label">Surfaces</span>
			{#each surfaceShare as { s, share } (s)}
				<label><input type="checkbox" checked={!hiddenSurfaces.includes(s)} onchange={() => toggleSurface(s)} /> {SURFACE[/** @type {import('$lib/biomes').Surface} */ (s)].label}<small>{pct(share)}</small></label>
			{/each}
			<span class="label">Cover</span>
			{#each coverShare as { i, kind, share } (i)}
				<label><input type="checkbox" checked={!hiddenCover.includes(i)} onchange={() => toggleCover(i)} /> {COVER[kind].label}<small>{pct(share)}</small></label>
			{/each}
			<span class="label">Mix with</span>
			<select bind:value={other} onchange={redraw}>
				{#each BIOMES as b (b.id)}<option value={b.id}>{b.label}</option>{/each}
			</select>
			<input type="range" min="0" max="1" step="0.05" bind:value={amount} onchange={redraw} aria-label="How much of it" />
			<small>{pct(1 - amount)} {chosen.label} · {pct(amount)} {BIOMES.find((b) => b.id === other)?.label}</small>
		</div>
	{/snippet}
	{#snippet readout()}
		<b>{chosen.label}</b>
		<small>{chosen.note}</small>
		<small>Drag to turn round it · pinch or scroll to come closer · 16 m across</small>
	{/snippet}
</Turntable>

<style>
	.layers {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.82rem;
	}

	.layers .label {
		margin-top: 0.4rem;
	}

	.layers .label:first-child {
		margin-top: 0;
	}

	.layers label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 1.6rem;
	}

	.layers label small,
	.layers > small {
		opacity: 0.6;
		font-variant-numeric: tabular-nums;
	}

	.layers label small {
		margin-left: auto;
	}

	.layers select {
		margin-top: 0.3rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid rgb(0 0 0 / 0.15);
		border-radius: 999px;
		background: #fff;
		font: inherit;
	}
</style>
