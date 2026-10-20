<!--
	ONE OF A VAULT'S ASSETS, SHOWN FROM THE VAULT ALONE — the avenDB app's Assets ($lib/avendb/Assets.svelte): a build of
	a recipe the Maia City vault keeps, its source its entry's file, read from the vault and held to its hash before
	anything else (./sources/viewer.js `vaultBuild`), then this device's cache or the box, which runs it on the frozen
	engine its entry names, checked either way, and shown on the asset stage (./stage.js, ./hero.js) as every asset
	viewer shows a build (the viewer's core, ./viewer.js, and what it draws round the stage, ./ViewerParts.svelte), in
	the same turntable ($lib/app/Turntable.svelte, in its place in the page): above the canvas, staying at the top of
	the page's column, its name and the bar (a plant's stages and its Plant | Fruit, the moves:
	Grow, Run, its own, an actor's clips, Assemble; the views: Explode, Cut away, X-ray, Labels, Slow); round the canvas
	the panel (what its recipe is built with, from the card in its entry, changed here and built anew, its solver's
	sliders, and what the page says of its entry, `about`) and the readout (its solver's reading, its note, its measure,
	a plant's above and below its soil, the scale). A plant stands in its earth and grows smoothly (./grow.js). Drag to
	turn round it, scroll to come closer; ← → a plant's stage, space to grow it.

	Its parts are the page's to list (its card's catalog, `catalog`, as built): a part picked there or tapped on the
	canvas (`picked`) is shown on its own, the rest of the asset not drawn (`solo`, else in its place, its edges bright),
	and the camera glides to it; let go of, the whole asset comes back and the camera with it.

	There is no repo fallback (Samuel 2026-10-17): nothing here reads the repo's index or its libraries (./recipes.js,
	./load.js, AssetViewer). What the vault lacks, or holds otherwise, is said on the stage, naming its ref and why
	(NotInVault), and nothing is shown in its place.
-->
<script>
	// @ts-nocheck — plain JS
	import { onDestroy, onMount, untrack } from 'svelte';
	import Turntable from '$lib/app/Turntable.svelte';
	import { AssetBox } from './box/host.js';
	import { growth, stageAt } from './grow.js';
	import { forStage, heroOf, runner } from './hero.js';
	import { valuesOf } from './params.js';
	import { soilOf } from './soil.js';
	import { buildName, vaultBuild } from './sources/viewer.js';
	import { VIEWS, asker, camerawork, letGoOf, loop, measure, movesOf, onTap, openStage, safeArea, tabbed, viewsOf } from './viewer.js';
	import { builtRows, heroReading, labRows, longNote, moveChips, paramTabs, scaleBar, tagLines, viewChips } from './ViewerParts.svelte';

	/**
	 * @type {{ source: ReturnType<typeof import('./sources/avendb.js').vaultRecipes>, hash: string, title?: string,
	 *   note?: string, about?: import('svelte').Snippet, catalog?: any, picked?: string | null, solo?: boolean,
	 *   compact?: boolean }}
	 *   `source` the vault's recipes ($lib/avendb/assets.js `vaultSource`), `hash` the recipe shown, `title` and `note`
	 *   what its entry calls it and says of it, `about` what the page says of its entry, at the foot of the panel;
	 *   `catalog` its parts as built (null where it lists none), `picked` the part picked, `solo` whether it is shown on
	 *   its own; `compact`, its name, its moves and views and a short canvas alone, in a card with its own answers
	 *   ($lib/avendb/Hitl.svelte, an AIP's)
	 */
	let { source, hash, title = '', note = '', about, catalog = $bindable(null), picked = $bindable(null), solo = true, compact = false } = $props();

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
	/** the parameter it grows by (a plant's stage), and the stage it stands at, named */
	const staged = $derived(params.find((p) => p.id === 'stage' && tabbed(p)) ?? null);
	const stageName = $derived(staged && Number.isFinite(values.stage) ? staged.names[Math.min(staged.names.length - 1, Math.round(values.stage - staged.min))] : '');

	let canvasBox = $state();
	let hero = $state.raw(null);
	let building = $state(false);
	let error = $state('');
	let lost = $state(false);
	/** where the build came from (this device's cache or the box), its measure, and a plant's above and below its soil */
	let from = $state('');
	let size = $state.raw(null);
	let rise = $state.raw(null);
	let modes = $state({ run: true, explode: false, cut: false, xray: false, labels: false, slow: false });
	let moving = $state('run');
	/** its solver's sliders and its reading */
	let sliders = $state({});
	let reading = $state.raw({ value: 0, state: '', sub: '', bad: false });
	let tags = $state.raw([]);
	let scale = $state.raw([0, '']);
	/** its note in full (a long one is cut to a few lines, so the card covers less of it) */
	let more = $state(false);
	/** a plant growing: on smoothly by the clock (./grow.js), built where it has grown to each time its last build is shown */
	let growing = $state(false);
	let grower = null;

	const clips = $derived(hero?.clips ?? null);
	const lab = $derived(hero?.lab ?? null);
	/** the pose a rig is drawn apart in, which its Explode view holds */
	const rigApart = $derived(!hero?.explodes && clips?.poses?.includes('exploded') ? 'exploded' : null);
	let drawnApart = $state(false);
	/** the moves it plays: Grow, Run, its own, an actor's clips, Assemble */
	const moves = $derived(movesOf(hero, { staged, growing, rigApart }));
	const views = $derived(viewsOf(hero, rigApart));
	const said = $derived(hero?.view.note ?? note);

	let stage = null;
	let show = null;
	let focus = null;
	let dispose = null;
	/** whether the stage is up, and the build last asked of it */
	let ready = $state(false);
	let shown = '';
	/** the boxes this viewer builds in and keeps builds running in, on the engine the vault's recipes are made for */
	let boxes = null;
	const boxesOf = () => (boxes ??= { build: new AssetBox({ engine: source.index.engine }), live: new AssetBox({ engine: source.index.engine }) });

	onMount(async () => {
		const box = canvasBox;
		if (!box) return;
		/** @type {any} */
		let up;
		try {
			// the stage renderer and the paper studio on it (./viewer.js `openStage`)
			up = await openStage(box, { onLost: () => (lost = true), hold: () => building });
		} catch (e) {
			// a browser that gives this page no 3D drawing: said on the stage, the rest of the page goes on
			error = `This browser couldn’t open the 3D stage: ${String(e?.message ?? e)}`;
			console.error(e);
			return;
		}
		const { THREE, view, renderer, camera, controls, adapt } = up;
		stage = up.stage;
		if (gone) {
			stage.dispose();
			view.dispose();
			return;
		}
		// for a test in a browser to read what is shown, as AssetViewer's `__viewer`
		window.__vaultAsset = { stage, camera, controls, get hero() { return hero; }, get picked() { return picked; } };
		// a plant's earth, as the plants page shows it: under a plant, never under its fruit on its own
		const earth = soilOf();
		earth.group.visible = false;
		stage.scene.add(earth.group);

		const letGo = letGoOf(stage);
		const asks = asker();
		let shownHash = '';
		/** the camera on what is shown, as built: framed, gliding to a new framing, following a plant as it grows */
		const cam = camerawork(THREE, camera, controls);
		/** the part the camera was last brought to, if one */
		let focused = null;
		show = async (h0, given) => {
			const ask = asks.ask();
			building = true;
			error = '';
			try {
				const { build, live } = boxesOf();
				// a plant growing is built where it has grown to, mostly between two of its stages: none of it kept
				const got = await vaultBuild(source, h0, given, { box: build, keep: !growing });
				if (!asks.is(ask)) return void letGo(heroOf(got));
				forStage(got.obj);
				const h = heroOf(got, { start: runner(live, got.recipe, got.given) });
				const was = hero;
				const bounds = new THREE.Box3().setFromObject(got.obj);
				// a plant stands in its soil; its fruit, shown on its own, on the floor
				const soiled = got.card?.group === 'plants' && !(got.values?.fruit >= 1);
				const { centre, size: s } = stage.show(got.obj, { asset: h, ground: soiled ? -earth.fit(bounds) : undefined, keep: shownHash === h0 });
				await stage.compile();
				if (!asks.is(ask)) {
					stage.clear();
					return void letGo(h);
				}
				letGo(was);
				hero = h;
				catalog = h.catalog?.parts?.length ? h.catalog : null;
				// a part picked stays picked in the same recipe built anew, where it still has it, and is looked at again
				if (shownHash !== h0 || !catalog?.parts.some((p) => p.id === picked)) picked = null;
				focused = null;
				from = got.from;
				size = [s.x, s.y, s.z];
				earth.group.visible = soiled;
				rise = soiled ? [Math.max(0, bounds.max.y), Math.max(0, -bounds.min.y)] : null;
				drawnApart = false;
				if (shownHash !== h0) more = false;
				readValues();
				readModes();
				// a new recipe is framed as built; the same one built with other values keeps the camera where it is,
				// unless it grew or shrank by much; a plant growing, the camera follows it
				cam.reframe(centre, s, { fresh: shownHash !== h0, growing });
				shownHash = h0;
			} catch (e) {
				if (!asks.is(ask)) return;
				// nothing in its place: what failed is said, naming its ref
				letGo(hero);
				hero = null;
				catalog = picked = null;
				stage.clear();
				earth.group.visible = false;
				size = rise = null;
				from = '';
				shownHash = '';
				cam.framed = null;
				growing = false;
				error = String(e?.message ?? e);
				console.error(e);
			}
			if (asks.is(ask)) building = false;
		};

		/** the camera on part `id`, smoothly, all of it in view; or, none, back on the whole asset */
		focus = (id) => {
			if (id === focused || !hero) return;
			focused = id;
			if (!id) return cam.frame(true);
			const b = hero.boxOf?.(id);
			const centre = b ? b.getCenter(new THREE.Vector3()) : stage.partCentre(id);
			if (!centre || !cam.framed) return;
			// a part found by its bone alone: aimed at, the camera as far back as for the whole
			cam.frame(true, { centre, size: b ? b.getSize(new THREE.Vector3()) : cam.framed.size });
		};
		// a tap, not a drag round it, picks the part under it (or, on nothing, lets go and shows all of it)
		onTap(renderer.domElement, (x, y) => {
			if (catalog) picked = stage.pick(x, y);
		});

		let slow = 0;
		const stop = loop((wall, dt, now) => {
			adapt(now);
			stage.update(dt);
			cam.step(wall, growing);
			controls.update();
			// growing on: built where it has grown to, each time its last build is shown
			if (growing && grower && hero) {
				grower.on(wall);
				if (!building) {
					const to = stageAt(grower.at);
					if (to !== values.stage) setParam('stage', to);
					else if (grower.done) growing = false;
				}
			}
			stage.render();
			if (stage.root && (stage.state?.labels > 0.01 || tags.length)) tags = stage.labels(box.clientWidth, box.clientHeight, safeArea(box, { inView: true }));
			else if (!stage.root && tags.length) tags = [];
			if ((slow += wall) > 0.12 && hero) {
				slow = 0;
				scale = stage.scaleBar(box.clientHeight, controls.target);
				if (lab) reading = { ...lab.read };
				// the sliders a move sets follow it
				if (stage.move !== 'run') readValues();
			}
		});
		dispose = () => {
			stop();
			asks.drop();
			letGo(hero);
			hero = null;
			earth.dispose();
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

	// another recipe picked: what grew here stops
	$effect(() => {
		void hash;
		untrack(() => (growing = false));
	});
	// a part picked, let go of, or shown otherwise: on the stage, and the camera brought to it; and again on each build
	$effect(() => {
		const [id, on, h] = [picked, solo, hero];
		if (!h) return;
		untrack(() => {
			stage?.setPick(id, false, on);
			focus?.(id);
		});
	});
	/** the part picked, as its catalog has it */
	const part = $derived(catalog && picked ? (catalog.parts.find((p) => p.id === picked) ?? null) : null);
	// a new build asked for whenever the recipe shown or what it is built with changes
	$effect(() => {
		const w = wanted;
		if (!ready || !w || w === shown) return;
		shown = w;
		untrack(() => show?.(hash, asked));
	});

	const readValues = () => (sliders = Object.fromEntries(Object.entries(lab?.controls ?? {}).map(([k, v]) => [k, v.value])));
	const readModes = () => {
		if (!stage) return;
		modes = Object.fromEntries(['run', ...VIEWS.map(([k]) => k)].map((k) => [k, stage.on(k)]));
		moving = stage.move === 'run' && hero?.doing?.kind === 'clip' ? `clip:${hero.doing.name}` : stage.move;
	};
	const playMove = (k) => {
		if (!stage) return;
		if (k === 'grow') return grow();
		if (k.startsWith('clip:')) {
			drawnApart = false;
			hero?.play(k.slice(5));
			stage.play('run');
		} else stage.play(k);
		readValues();
		readModes();
	};
	/** a slider of its solver moved: Run takes over from a move that set it */
	const slide = (k, v) => {
		if (stage?.drives(k)) playMove('run');
		if (lab) lab.controls[k].value = v;
		sliders = { ...sliders, [k]: v };
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
	/** grown from its first stage (or on from where it stands) to its last, smoothly; or stopped, at the stage nearest it */
	const grow = () => {
		if (!staged) return;
		if (growing) {
			growing = false;
			return setParam('stage', Math.round(values.stage));
		}
		grower = growth(staged, values.stage);
		growing = true;
	};
	/** a stage on or back (← →), grown (space): the keys a plant's page has always had */
	const key = (e) => {
		if (!staged || !hero || e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
		const at = Math.round(values.stage);
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			growing = false;
			setParam('stage', Math.max(staged.min, Math.min(staged.max, at + (e.key === 'ArrowRight' ? 1 : -1))));
		} else if (e.key === ' ' && !e.target?.closest?.('button, a')) grow();
		else return;
		e.preventDefault();
	};
	const freshSeed = () => setParam('seed', Math.random().toString(36).slice(2, 7));
</script>

<svelte:window onkeydown={key} />

<Turntable name="vault-asset" inline {compact} bind:canvas={canvasBox}>
	{#snippet head()}
		<h2 class="name">{title || source.nameOf?.(hash) || 'An asset'}{#if stageName}<small>{` · ${stageName}`}</small>{/if}</h2>
		{#if hero && !error}
			<div class="chips">
				{@render paramTabs(params, values, (id, v) => ((growing = false), setParam(id, v)))}
				{@render moveChips(moves, (k) => (k === 'grow' ? growing : moving === k), lab, playMove)}
				{#if hero.view.ticks || hero.buildBy}<button class="chip" class:on={!modes.run} onclick={() => setMode('run')}>{modes.run ? 'Pause' : 'Play'}</button>{/if}
				{@render viewChips(views, (k) => (k === 'explode' && rigApart ? drawnApart : modes[k]), setMode)}
			</div>
		{/if}
	{/snippet}
	{#snippet panel()}
		{#if params.some((p) => !tabbed(p))}
			<div class="built">
				<span class="label">Built with</span>
				{@render builtRows(params, values, setParam, freshSeed)}
			</div>
		{/if}
		{#if lab}
			<div class="lab">{@render labRows(lab, sliders, slide)}</div>
		{/if}
		{#if about}
			<div class="about">
				{@render about()}
				{#if from}<small>{from === 'cache' ? 'Its file checked in the vault, its build from this device’s cache' : 'Built in the box from its entry’s file'}</small>{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet readout()}
		{#if lab && hero && !error}{@render heroReading(lab, reading)}{/if}
		{@render longNote(said, more, () => (more = !more))}
		{#if error}
			<span class="missing">Not shown.</span>
		{:else if size}
			<span>{#if rise}{measure(rise[0])} above the soil · {measure(rise[1])} below · {measure(Math.max(size[0], size[2]))} across{:else}{measure(Math.max(size[0], size[2]))} long · {measure(size[1])} high{/if}</span>
		{/if}
		{#if scale[0] > 0 && hero && !error}{@render scaleBar(scale)}{/if}
		<small>Drag to turn round it · pinch or scroll to come closer{catalog ? ' · tap a part to see it on its own' : ''}</small>
	{/snippet}
	{#if part && !error}
		<div class="picked" role="status">
			<span><b>{part.label}</b>{solo ? ' on its own' : ''}</span>
			<button class="chip" onclick={() => (picked = null)}>Show all</button>
		</div>
	{/if}
	{#if tags.length}{@render tagLines(tags)}{/if}
	{#if lost}
		<button class="canvas-note lost" onclick={() => location.reload()}>This device’s graphics ran out of room. Tap to load it again.</button>
	{:else if error}
		<div class="canvas-note error" role="alert"><b>Not shown.</b> {error}</div>
	{:else if building && !growing}
		<div class="canvas-note" role="status">Building {title || at?.label || 'it'} from its entry’s file…</div>
	{/if}
</Turntable>

<style>
	.built,
	.lab,
	.about {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.built + .lab,
	.built + .about,
	.lab + .about {
		border-top: 1px solid rgb(0 0 0 / 0.08);
		margin-top: 0.6rem;
		padding-top: 0.8rem;
	}

	.about {
		gap: 0.4rem;
	}

	.missing {
		color: #b3261e;
	}

	.name {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.name small {
		font-size: inherit;
		font-weight: 500;
		opacity: 0.6;
	}

	/* the part shown on its own, and the way back to all of it, at the canvas's top left */
	.picked {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: calc(100% - 1.5rem);
		padding: 0.3rem 0.35rem 0.3rem 0.8rem;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.9);
		box-shadow: 0 4px 14px rgb(31 42 35 / 0.12);
		font-size: 0.82rem;
	}

	.picked span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* while a build is made and its shaders compiled, or when it was refused, or the graphics card gave the canvas up */
	.canvas-note {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		max-width: calc(100% - 2rem);
		padding: 9px 16px;
		border: 1px solid #d9d4ca;
		border-radius: 999px;
		background: #fbfaf7;
		box-shadow: 0 6px 20px rgb(31 42 35 / 0.12);
		color: #1f2a23;
		font: inherit;
		font-size: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		pointer-events: none;
	}

	.canvas-note.lost,
	.canvas-note.error {
		width: max-content;
		max-width: min(80%, 360px);
		white-space: normal;
		text-align: center;
		border-radius: 14px;
		overflow-wrap: anywhere;
	}

	.canvas-note.lost {
		pointer-events: auto;
		cursor: pointer;
	}

	.canvas-note.error {
		color: #b3261e;
	}</style>
