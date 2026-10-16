<!--
	Biomes: the floors the worlds stand on (src/lib/biomes), each a patch of ground 16 m across at standing height — its
	surfaces (leaf litter, humus, needles, moss, the living mat, bare soil) run into each other in patches, and its cover
	growing and lying on them in colonies. Every layer to show or hide; and mixed with a second biome, as far as the
	slider says. Drag to turn round it, scroll to come closer. An admin's.

	The cover is drawn by the universal renderer ($lib/assets/render): each kind built in the asset box at its seed
	(`biomes/cover:fern?seed=7139`, $lib/biomes/built.js), laid where the biome's stream lays it round an eye that stays
	in the middle ($lib/biomes/stream.js `coverLaid`), every copy at its finest shape. The biome itself, a recipe of
	numbers, and the ground its shader paints, stay the page's.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { BIOMES, COVER, SURFACE, SURFACES, coverSeed, groundMaterial, mix } from '$lib/biomes';
	import { coverRef } from '$lib/biomes/built.js';
	import { coverLaid } from '$lib/biomes/stream.js';
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
	/** the cover's kinds still being built in the box (of how many), and what went wrong */
	let coming = $state(/** @type {{ done: number, of: number } | null} */ (null));
	let failed = $state('');

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
		const { createStageRenderer } = await import('$lib/render/stage.js');
		const [{ createAssets }, { LEVELS }] = await Promise.all([import('$lib/assets/render/index.js'), import('$lib/assets/render/lod.js')]);
		const box = /** @type {HTMLDivElement} */ (canvasBox);
		// the stage renderer ($lib/render/stage.js): the canvas in the box, the camera (its field of view widened on an
		// upright canvas, $lib/app/turntable.js), the controls, kept to the box's size
		const view = createStageRenderer(box, { shadows: true, toneMapping: 'aces', fov: 50, near: 0.05, far: 200, turntable: true, fit, controls: { maxPolarAngle: Math.PI / 2 - 0.05 } });
		const { renderer, camera, controls } = view;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#cfdbe0');
		scene.fog = new THREE.Fog('#cfdbe0', 14, 34);
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
		// the cover: every kind built in the box, each copy drawn at its finest shape however small (as it always was)
		const assets = createAssets({ renderer, camera, levels: [/** @type {number} */ (LEVELS[0])] });
		assets.force(0);
		scene.add(assets.group);
		/** the copies of each kind laid so far, by its ref: moved where the floor wants them, the ones over put away */
		const laid = new Map();
		const away = new THREE.Matrix4().makeScale(0, 0, 0), at = new THREE.Matrix4();
		let asked = 0, ready = false;
		/** @param {Recipe} r @param {Set<number>} hidden */
		const lay = async (r, hidden) => {
			const mine = ++asked;
			ready = false;
			try {
				// the stream's floor round an eye in the middle, every tile in reach (its tiles, reach and fading)
				const places = coverLaid(r, { tile: 8, reach: 26, near: 22, hidden });
				/** @type {Map<string, Float32Array>} */
				const want = new Map();
				r.cover.forEach((c, i) => {
					const m = /** @type {Float32Array} */ (places[i]);
					if (m.length) want.set(coverRef(c.kind, coverSeed(i, c.kind)), m);
				});
				for (const [ref, copies] of laid) if (!want.has(ref)) for (const c of copies) assets.move(c, away);
				const kinds = [];
				for (const [ref, m] of want) {
					const kind = assets.use(ref);
					kinds.push(kind);
					const copies = laid.get(ref) ?? [];
					laid.set(ref, copies);
					const n = m.length / 16;
					for (let j = 0; j < n; j++) {
						at.fromArray(m, j * 16);
						if (j < copies.length) assets.move(copies[j], at);
						else copies.push(assets.place(kind, at));
					}
					for (let j = n; j < copies.length; j++) assets.move(copies[j], away);
				}
				// told how far the kinds still to come are
				const waiting = kinds.filter((k) => !k.ok && !k.error);
				coming = waiting.length ? { done: 0, of: waiting.length } : null;
				await Promise.all(waiting.map((k) => k.ready.then(() => mine === asked && coming && (coming = { ...coming, done: coming.done + 1 }))));
				if (mine !== asked) return;
				const bad = kinds.filter((k) => k.error);
				failed = bad.length ? `${bad.map((k) => k.label).join(', ')} could not be built` : '';
			} catch (e) {
				if (mine === asked) failed = String(/** @type {any} */ (e)?.message ?? e);
			}
			if (mine !== asked) return;
			coming = null;
			ready = true;
		};
		// for a check in a browser: whether the cover asked for last stands, and what the renderer draws
		/** @type {any} */ (window).__biome = {
			get ready() {
				return ready && !coming;
			},
			stats: () => ({ ...assets.stats(), copies: [...laid.values()].reduce((n, c) => n + c.length, 0) })
		};

		show = (r, hs, hc) => {
			// the surfaces: the hidden ones weighed nothing
			/** @type {Record<string, number>} */
			const w = {};
			for (const s of SURFACES) w[s] = hs.includes(s) ? 0 : (r.surface[s] ?? 0);
			if (SURFACES.every((s) => !w[s])) w.soil = 1;
			ground.material.userData.weigh(w);
			const shown = { ...r, surface: w };
			// the cover: laid round the middle, every tile within reach, its kinds from the box
			lay(shown, new Set(hc));
		};
		look = (top) => {
			controls.target.set(0, 0.2, 0);
			if (top) camera.position.set(0.01, 14, 0.01);
			else camera.position.set(5.5, 1.65, 7.5);
			camera.updateProjectionMatrix();
		};
		view.resize();
		look(false);
		show(recipe, $state.snapshot(hiddenSurfaces), $state.snapshot(hiddenCover));
		let raf = 0;
		const tick = () => {
			controls.update();
			assets.update();
			renderer.render(scene, camera);
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(raf);
			asked++;
			assets.dispose();
			delete (/** @type {any} */ (window).__biome);
			view.dispose();
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
	{#if failed}
		<div class="canvas-note error" role="alert">{failed}</div>
	{:else if coming}
		<div class="canvas-note" role="status">Growing the cover… {coming.done} of {coming.of}</div>
	{/if}
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
	/* while the cover's kinds are built in the box, or when one was refused */
	.canvas-note {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		padding: 9px 16px;
		border: 1px solid #d9d4ca;
		border-radius: 999px;
		background: #fbfaf7;
		box-shadow: 0 6px 20px rgb(31 42 35 / 0.12);
		color: #1f2a23;
		font-size: 14px;
		white-space: nowrap;
		pointer-events: none;
	}

	.canvas-note.error {
		white-space: normal;
		max-width: min(80%, 360px);
		text-align: center;
		border-radius: 14px;
		color: #b3261e;
	}

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
