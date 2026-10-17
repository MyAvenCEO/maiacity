<!--
	ONE OF A VAULT'S ASSETS, SHOWN FROM THE VAULT ALONE — the avenDB app's Assets ($lib/avendb/Assets.svelte): a build of
	a recipe the Maia City vault keeps, its source its entry's file, read from the vault and held to its hash before
	anything else (./sources/viewer.js `vaultBuild`), then this device's cache or the box, which runs it on the frozen
	engine its entry names, checked either way, and shown on the asset stage (./stage.js, ./hero.js) as every asset
	viewer shows a build: on the paper studio, its moves (Run, its own, an actor's clips, Assemble) and its views
	(Explode, Cut away, X-ray, Labels) where it has them, and what its recipe is built with, from the card in its entry,
	changed here and built anew. Drag to turn round it, scroll to come closer.

	There is no repo fallback (Samuel 2026-10-17): nothing here reads the repo's index or its libraries (./recipes.js,
	./load.js, AssetViewer). What the vault lacks, or holds otherwise, is said on the stage, naming its ref and why
	(NotInVault), and nothing is shown in its place.
-->
<script>
	// @ts-nocheck — plain JS
	import { onDestroy, onMount, untrack } from 'svelte';
	import { fit } from '$lib/app/turntable.js';
	import { adaptiveResolution, disposeObject, lowPower, topPixelRatio } from '$lib/render/core.js';
	import { AssetBox } from './box/host.js';
	import { forStage, heroOf, runner } from './hero.js';
	import { valuesOf } from './params.js';
	import { buildName, vaultBuild } from './sources/viewer.js';

	/**
	 * @type {{ source: ReturnType<typeof import('./sources/avendb.js').vaultRecipes>, hash: string }}
	 *   `source` the vault's recipes ($lib/avendb/assets.js `vaultSource`), `hash` the recipe shown
	 */
	let { source, hash } = $props();

	/** the stage's views, as the bar names them */
	const VIEWS = /** @type {const} */ ([
		['explode', 'Explode'],
		['cut', 'Cut away'],
		['xray', 'X-ray'],
		['labels', 'Labels']
	]);
	/** a parameter shown as tabs rather than a slider: one with named steps (a plant's stages) */
	const tabbed = (p) => Array.isArray(p.names) && p.names.length > 1 && p.names.length <= 12;

	const at = $derived(Object.hasOwn(source.index.recipes, hash) ? source.index.recipes[hash] : null);
	/** what its recipe is built with, as its card declares it; detail is the renderer's */
	const params = $derived((at?.params ?? []).filter((p) => p.id !== 'detail'));
	/** the values changed here, as text, of the recipe shown */
	let given = $state(/** @type {Record<string, string>} */ ({}));
	/** the recipe they were changed for: another one starts at its own */
	let givenFor = $state('');
	const asked = $derived(givenFor === hash ? Object.fromEntries(Object.entries(given).filter(([k]) => params.some((p) => p.id === k))) : {});
	const values = $derived.by(() => {
		try {
			return at?.params?.length ? valuesOf(at.params, asked) : {};
		} catch {
			return {};
		}
	});
	/** the build asked for: its recipe and the values changed here (one the vault doesn't hold is refused as it is asked) */
	const wanted = $derived(hash ? buildName(hash, asked) : '');

	let canvasBox = $state();
	let hero = $state.raw(null);
	let building = $state(false);
	let error = $state('');
	let lost = $state(false);
	/** where the build came from (this device's cache or the box), and its measure */
	let from = $state('');
	let size = $state.raw(null);
	let modes = $state({ run: true, explode: false, cut: false, xray: false, labels: false });
	let moving = $state('run');
	let tags = $state.raw([]);
	let scale = $state.raw([0, '']);

	const clips = $derived(hero?.clips ?? null);
	const lab = $derived(hero?.lab ?? null);
	/** the pose a rig is drawn apart in, which its Explode view holds */
	const rigApart = $derived(!hero?.explodes && clips?.poses?.includes('exploded') ? 'exploded' : null);
	let drawnApart = $state(false);
	/** the moves it plays: Run, its own, an actor's clips, Assemble */
	const moves = $derived.by(() => {
		if (!hero) return [];
		const out = [];
		if (lab) out.push(['run', 'Run'], ...Object.entries(lab.moves ?? {}).map(([k, m]) => [k, m.label]));
		for (const c of clips?.clips ?? []) if (!(rigApart && c === 'explode')) out.push([`clip:${c}`, c === 'assemble' ? 'Assemble' : c]);
		if (hero.buildBy) out.push(['assemble', hero.buildBy.id === 'pitch' ? 'Pitch it' : 'Assemble']);
		if (!lab && hero.buildBy && !clips?.clips?.length) out.unshift(['run', 'Still']);
		return out;
	});
	const views = $derived(hero ? VIEWS.filter(([k]) => (k === 'explode' ? hero.explodes || !!rigApart : k === 'xray' ? hero.shells.length > 0 : k === 'labels' ? hero.labels.length > 0 : true)) : []);

	let stage = null;
	let show = null;
	let dispose = null;
	/** whether the stage is up, and the build last asked of it */
	let ready = $state(false);
	let shown = '';
	/** the boxes this viewer builds in and keeps builds running in, on the engine the vault's recipes are made for */
	let boxes = null;
	const boxesOf = () => (boxes ??= { build: new AssetBox({ engine: source.index.engine }), live: new AssetBox({ engine: source.index.engine }) });

	onMount(async () => {
		const THREE = await import('three');
		const { createStageRenderer } = await import('$lib/render/stage.js');
		const { Stage } = await import('./stage.js');
		const box = canvasBox;
		if (!box || gone) return;
		const low = lowPower();
		/** @type {any} */
		let view;
		try {
			view = createStageRenderer(box, { pixelRatio: topPixelRatio(low), shadows: 'soft', onLost: () => (lost = true), fov: 40, turntable: true, fit, onResize: (w, h) => stage?.resize(w, h) });
			stage = new Stage(view.renderer, view.camera, { low });
		} catch (e) {
			// a browser that gives this page no 3D drawing: said on the stage, the rest of the page goes on
			view?.dispose?.();
			error = `This browser couldn’t open the 3D stage: ${String(e?.message ?? e)}`;
			console.error(e);
			return;
		}
		const { renderer, camera, controls } = view;

		/** the build shown: let go of, on the stage and on the graphics card */
		const letGo = (h) => {
			if (!h) return;
			h.dispose();
			if (stage.root === h.root) stage.clear();
			disposeObject(h.root, { textures: false });
		};
		let mine = 0;
		let shownHash = '';
		/** the camera on the asset as built: aimed a little under its middle */
		const frame = (centre, s) => {
			const reach = Math.max(s.x, s.y, s.z, 0.01) * 1.15;
			const aim = centre.clone().add(new THREE.Vector3(0, -0.12 * s.y, 0));
			controls.target.copy(aim);
			camera.position.set(aim.x + reach * 1.5, aim.y + reach * 0.7, aim.z + reach * 1.9);
			camera.near = reach / 300;
			camera.far = reach * 80;
			camera.updateProjectionMatrix();
		};
		show = async (h0, given) => {
			const ask = ++mine;
			building = true;
			error = '';
			try {
				const { build, live } = boxesOf();
				const got = await vaultBuild(source, h0, given, { box: build });
				if (ask !== mine) return void letGo(heroOf(got));
				forStage(got.obj);
				const h = heroOf(got, { start: runner(live, got.recipe, got.given) });
				const was = hero;
				const { centre, size: s } = stage.show(got.obj, { asset: h });
				await stage.compile();
				if (ask !== mine) {
					stage.clear();
					return void letGo(h);
				}
				letGo(was);
				hero = h;
				from = got.from;
				size = [s.x, s.y, s.z];
				drawnApart = false;
				readModes();
				// a new recipe is framed as built; the same one built with other values keeps the camera where it is
				if (shownHash !== h0) frame(centre, s);
				shownHash = h0;
			} catch (e) {
				if (ask !== mine) return;
				// nothing in its place: what failed is said, naming its ref
				letGo(hero);
				hero = null;
				stage.clear();
				size = null;
				from = '';
				shownHash = '';
				error = String(e?.message ?? e);
				console.error(e);
			}
			if (ask === mine) building = false;
		};

		const resize = view.resize;
		resize();
		const adapt = adaptiveResolution(renderer, { top: topPixelRatio(low), hold: () => building, onChange: resize });
		let raf = 0, last = performance.now(), slow = 0;
		const tick = () => {
			const now = performance.now(), wall = Math.min(1, (now - last) / 1000), dt = Math.min(0.05, wall);
			last = now;
			adapt(now);
			stage.update(dt);
			controls.update();
			stage.render();
			if (stage.root && (stage.state?.labels > 0.01 || tags.length)) tags = stage.labels(box.clientWidth, box.clientHeight);
			else if (!stage.root && tags.length) tags = [];
			if ((slow += wall) > 0.12 && hero) {
				slow = 0;
				scale = stage.scaleBar(box.clientHeight, controls.target);
			}
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(raf);
			mine++;
			letGo(hero);
			hero = null;
			stage.dispose();
			view.dispose();
			boxes?.build.stop('the viewer was left');
			boxes?.live.stop('the viewer was left');
		};
		shown = '';
		ready = true;
	});
	/** whether the viewer was left (perhaps before its stage was up) */
	let gone = false;
	onDestroy(() => {
		gone = true;
		dispose?.();
	});

	// a new build asked for whenever the recipe shown or what it is built with changes
	$effect(() => {
		const w = wanted;
		if (!ready || !w || w === shown) return;
		shown = w;
		untrack(() => show?.(hash, asked));
	});

	const readModes = () => {
		if (!stage) return;
		modes = Object.fromEntries(['run', ...VIEWS.map(([k]) => k)].map((k) => [k, stage.on(k)]));
		moving = stage.move === 'run' && hero?.doing?.kind === 'clip' ? `clip:${hero.doing.name}` : stage.move;
	};
	const playMove = (k) => {
		if (!stage) return;
		if (k.startsWith('clip:')) {
			drawnApart = false;
			hero?.play(k.slice(5));
			stage.play('run');
		} else stage.play(k);
		readModes();
	};
	const setMode = (k) => {
		if (k === 'explode' && rigApart) {
			drawnApart = !drawnApart;
			if (drawnApart) hero.hold(rigApart, {});
			else hero.play(clips?.first ?? clips?.clips?.[0]);
			return void readModes();
		}
		stage?.toggle(k);
		readModes();
	};
	/** a value of what its recipe is built with, changed: built anew */
	const setParam = (id, v) => {
		given = { ...(givenFor === hash ? given : {}), [id]: String(v) };
		givenFor = hash;
	};
	const measure = (v) => (v < 0.01 ? `${Math.round(v * 10000) / 10} mm` : v < 1 ? `${Math.round(v * 1000) / 10} cm` : `${Math.round(v * 100) / 100} m`);
</script>

<div class="vault-asset">
	<div class="stage">
		<div class="canvas" bind:this={canvasBox}></div>
		{#if tags.length}
			<svg class="tags" aria-hidden="true">
				{#each tags as t, i (i)}
					{@const left = t.side === 'left'}
					<g opacity={t.on}>
						<polyline points="{t.x},{t.y} {t.lx + (left ? 16 : -16)},{t.ly} {t.lx},{t.ly}" />
						<circle cx={t.x} cy={t.y} r="2.6" />
						<text x={t.lx + (left ? -5 : 5)} y={t.ly - 2} text-anchor={left ? 'end' : 'start'} class="name">{t.text}</text>
						{#if t.value}<text x={t.lx + (left ? -5 : 5)} y={t.ly + 12} text-anchor={left ? 'end' : 'start'} class="value">{t.value}</text>{/if}
					</g>
				{/each}
			</svg>
		{/if}
		{#if lost}
			<button class="note lost" onclick={() => location.reload()}>This device’s graphics ran out of room. Tap to load it again.</button>
		{:else if error}
			<div class="note fail" role="alert"><b>Not shown.</b> {error}</div>
		{:else if building}
			<div class="note" role="status">Building {at?.label ?? 'it'} from its entry’s file…</div>
		{/if}
		{#if hero && !error}
			<p class="foot">
				{#if size}<span>{measure(Math.max(size[0], size[2]))} long · {measure(size[1])} high</span>{/if}
				{#if scale[0] > 0}<span class="scale"><i style:width="{scale[0]}px"></i>{scale[1]}</span>{/if}
				<small>{from === 'cache' ? 'Its file checked in the vault, its build from this device’s cache' : 'Built in the box from its entry’s file'} · drag to turn round it, scroll to come closer</small>
			</p>
		{/if}
	</div>
	{#if hero && !error}
		<div class="chips">
			{#if moves.length}
				<span class="label">Moves</span>
				{#each moves as [k, label] (k)}
					<button class="pick" class:on={moving === k} title={lab?.moves?.[k]?.note} onclick={() => playMove(k)}>{label}</button>
				{/each}
			{/if}
			{#if hero.view.ticks || hero.buildBy}<button class="pick" class:on={!modes.run} onclick={() => setMode('run')}>{modes.run ? 'Pause' : 'Play'}</button>{/if}
			{#if views.length}
				<span class="label">Views</span>
				{#each views as [k, label] (k)}
					<button class="pick" class:on={k === 'explode' && rigApart ? drawnApart : modes[k]} onclick={() => setMode(k)}>{label}</button>
				{/each}
			{/if}
		</div>
	{/if}
	{#if params.length}
		<div class="built">
			<span class="label">Built with</span>
			{#each params as p (p.id)}
				{#if tabbed(p)}
					<div class="param tabs">
						<span>{p.label}</span>
						{#each p.names as n, k (k)}
							<button class="pick" class:on={Math.round(values[p.id]) === p.min + k} disabled={building} onclick={() => setParam(p.id, p.min + k)}>{n}</button>
						{/each}
					</div>
				{:else if p.type === 'string'}
					<label class="param">
						<span>{p.label}</span>
						<input value={values[p.id] ?? p.value} maxlength={p.maxLength ?? 80} disabled={building} onchange={(e) => setParam(p.id, e.currentTarget.value.trim() || p.value)} />
					</label>
				{:else}
					<label class="param slider">
						<span>{p.label}</span>
						<output>{values[p.id] ?? p.value}</output>
						<input type="range" min={p.min} max={p.max} step={p.step ?? (p.type === 'integer' ? 1 : 'any')} value={values[p.id] ?? p.value} disabled={building} onchange={(e) => setParam(p.id, e.currentTarget.value)} />
					</label>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.vault-asset {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		min-width: 0;
	}

	.stage {
		position: relative;
		height: clamp(18rem, 58vh, 40rem);
		border: 1px solid var(--edge, rgb(0 0 0 / 0.1));
		border-radius: 12px;
		overflow: hidden;
		background: #f0efea;
		touch-action: none;
	}

	.canvas {
		position: absolute;
		inset: 0;
	}

	.canvas :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.note {
		position: absolute;
		inset: auto 0.8rem 0.8rem 0.8rem;
		padding: 0.6rem 0.8rem;
		border-radius: 9px;
		background: rgb(255 255 255 / 0.92);
		font-size: 0.84rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.note.fail {
		inset: 0.8rem;
		bottom: auto;
		border: 1px solid #b5523a;
		color: #7a2e1d;
	}

	.note.lost {
		border: 0;
		font: inherit;
		cursor: pointer;
	}

	.foot {
		position: absolute;
		left: 0.8rem;
		right: 0.8rem;
		bottom: 0.6rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.9rem;
		margin: 0;
		font-size: 0.78rem;
		pointer-events: none;
	}

	.foot small {
		flex-basis: 100%;
		color: rgb(0 0 0 / 0.5);
	}

	.scale {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.scale i {
		display: inline-block;
		height: 0.3rem;
		border: 1.5px solid currentColor;
		border-top: 0;
	}

	.tags {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.tags polyline {
		fill: none;
		stroke: #1f2a23;
		stroke-width: 1;
	}

	.tags circle {
		fill: #1f2a23;
	}

	.tags text {
		font-size: 11px;
		fill: #1f2a23;
	}

	.tags .value {
		fill: #2f6d62;
	}

	.chips,
	.built,
	.param.tabs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.built {
		gap: 0.6rem 1rem;
	}

	.label {
		color: rgb(0 0 0 / 0.55);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.pick {
		padding: 0.25rem 0.65rem;
		border: 1px solid rgb(0 0 0 / 0.14);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		cursor: pointer;
	}

	.pick.on {
		border-color: var(--accent, #2f6d62);
		background: var(--accent, #2f6d62);
		color: #fff;
	}

	.pick:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.param {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.82rem;
	}

	.param input:not([type='range']) {
		width: 8rem;
		padding: 0.25rem 0.45rem;
		border: 1px solid rgb(0 0 0 / 0.14);
		border-radius: 6px;
		font: inherit;
	}

	.param output {
		min-width: 2.5rem;
		font-variant-numeric: tabular-nums;
	}
</style>
