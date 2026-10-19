<!--
	ONE OF A VAULT'S ASSETS, SHOWN FROM THE VAULT ALONE — the avenDB app's Assets ($lib/avendb/Assets.svelte): a build of
	a recipe the Maia City vault keeps, its source its entry's file, read from the vault and held to its hash before
	anything else (./sources/viewer.js `vaultBuild`), then this device's cache or the box, which runs it on the frozen
	engine its entry names, checked either way, and shown on the asset stage (./stage.js, ./hero.js) as every asset
	viewer shows a build, in the same turntable ($lib/app/Turntable.svelte, in its place in the page): above the canvas,
	staying at the top of the page's column, its name and the bar (a plant's stages and its Plant | Fruit, the moves:
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
	import { fit } from '$lib/app/turntable.js';
	import { adaptiveResolution, disposeObject, lowPower, topPixelRatio } from '$lib/render/core.js';
	import { AssetBox } from './box/host.js';
	import { growth, stageAt } from './grow.js';
	import { forStage, heroOf, runner } from './hero.js';
	import { valuesOf } from './params.js';
	import { soilOf } from './soil.js';
	import { buildName, vaultBuild } from './sources/viewer.js';

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

	/** the stage's views, as the bar names them */
	const VIEWS = /** @type {const} */ ([
		['explode', 'Explode'],
		['cut', 'Cut away'],
		['xray', 'X-ray'],
		['labels', 'Labels'],
		['slow', 'Slow']
	]);
	/** a parameter shown as tabs in the bar rather than in the panel: one with named steps (a plant's stages) */
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
	const moves = $derived.by(() => {
		if (!hero) return [];
		const out = [];
		if (staged) out.push(['grow', growing ? 'Growing…' : 'Grow']);
		if (lab) out.push(['run', 'Run'], ...Object.entries(lab.moves ?? {}).map(([k, m]) => [k, m.label]));
		for (const c of clips?.clips ?? []) if (!(rigApart && c === 'explode')) out.push([`clip:${c}`, c === 'assemble' ? 'Assemble' : c]);
		if (hero.buildBy) out.push(['assemble', hero.buildBy.id === 'pitch' ? 'Pitch it' : 'Assemble']);
		if (!lab && hero.buildBy && !clips?.clips?.length) out.unshift(['run', 'Still']);
		return out;
	});
	const views = $derived(hero ? VIEWS.filter(([k]) => (k === 'explode' ? hero.explodes || !!rigApart : k === 'xray' ? hero.shells.length > 0 : k === 'labels' ? hero.labels.length > 0 : k === 'slow' ? !!hero.view.ticks : true)) : []);
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
		// for a test in a browser to read what is shown, as AssetViewer's `__viewer`
		window.__vaultAsset = { stage, camera, controls, get hero() { return hero; }, get picked() { return picked; } };
		// a plant's earth, as the plants page shows it: under a plant, never under its fruit on its own
		const earth = soilOf();
		earth.group.visible = false;
		stage.scene.add(earth.group);

		/** the build shown: let go of, on the stage and on the graphics card */
		const letGo = (h) => {
			if (!h) return;
			h.dispose();
			if (stage.root === h.root) stage.clear();
			disposeObject(h.root, { textures: false });
		};
		let mine = 0;
		let shownHash = '';
		/** what is shown, as built: its middle and its measure */
		let framed = null;
		/** the camera gliding to a new framing (a plant a stage on), from where it was; or following a plant as it grows */
		let glide = null;
		let follow = null;
		/** the part the camera was last brought to, if one */
		let focused = null;
		/** where the camera stands from what it aims at, for each metre of an asset's reach */
		const BACK = new THREE.Vector3(1.5, 0.7, 1.9);
		/** a framing's aim: a little under its middle; its reach, and how far back the camera stands */
		const aimOf = ({ centre, size: s }) => {
			const reach = Math.max(s.x, s.y, s.z, 0.01) * 1.15;
			return { at: centre.clone().add(new THREE.Vector3(0, -0.12 * s.y, 0)), reach, back: reach * BACK.length() };
		};
		/** the camera on the asset shown, as built (or on `on`, a part of it): there at once, or `smooth`ly from where it is */
		const frame = (smooth = false, on = framed) => {
			if (!on) return;
			const { at, reach } = aimOf(on);
			const to = at.clone().addScaledVector(BACK, reach);
			follow = null;
			glide = smooth ? { t: 0, from: [camera.position.clone(), controls.target.clone()], to: [to, at] } : null;
			if (!smooth) {
				controls.target.copy(at);
				camera.position.copy(to);
			}
			// while it glides, near and far hold both framings
			camera.near = smooth ? Math.min(camera.near, reach / 300) : reach / 300;
			camera.far = smooth ? Math.max(camera.far, reach * 80) : reach * 80;
			camera.updateProjectionMatrix();
		};
		show = async (h0, given) => {
			const ask = ++mine;
			building = true;
			error = '';
			try {
				const { build, live } = boxesOf();
				// a plant growing is built where it has grown to, mostly between two of its stages: none of it kept
				const got = await vaultBuild(source, h0, given, { box: build, keep: !growing });
				if (ask !== mine) return void letGo(heroOf(got));
				forStage(got.obj);
				const h = heroOf(got, { start: runner(live, got.recipe, got.given) });
				const was = hero;
				const bounds = new THREE.Box3().setFromObject(got.obj);
				// a plant stands in its soil; its fruit, shown on its own, on the floor
				const soiled = got.card?.group === 'plants' && !(got.values?.fruit >= 1);
				const { centre, size: s } = stage.show(got.obj, { asset: h, ground: soiled ? -earth.fit(bounds) : undefined, keep: shownHash === h0 });
				await stage.compile();
				if (ask !== mine) {
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
				// unless it grew or shrank by much (a plant a stage on, its fruit alone): then the camera glides there;
				// a plant growing, the camera follows it as it grows, looking from where it looks
				const before = framed?.size, big = (v) => Math.max(v.x, v.y, v.z, 1e-6);
				const grew = before ? big(s) / big(before) : 1;
				framed = { centre, size: s };
				if (shownHash !== h0) frame();
				else if (growing) follow = aimOf(framed);
				else if (grew > 1.25 || grew < 0.8) frame(true);
				shownHash = h0;
			} catch (e) {
				if (ask !== mine) return;
				// nothing in its place: what failed is said, naming its ref
				letGo(hero);
				hero = null;
				catalog = picked = null;
				stage.clear();
				earth.group.visible = false;
				size = rise = null;
				from = '';
				shownHash = '';
				framed = null;
				growing = false;
				error = String(e?.message ?? e);
				console.error(e);
			}
			if (ask === mine) building = false;
		};

		/** the camera on part `id`, smoothly, all of it in view; or, none, back on the whole asset */
		focus = (id) => {
			if (id === focused || !hero) return;
			focused = id;
			if (!id) return frame(true);
			const b = hero.boxOf?.(id);
			const centre = b ? b.getCenter(new THREE.Vector3()) : stage.partCentre(id);
			if (!centre || !framed) return;
			// a part found by its bone alone: aimed at, the camera as far back as for the whole
			frame(true, { centre, size: b ? b.getSize(new THREE.Vector3()) : framed.size });
		};
		/** @type {{ x: number, y: number } | null} */
		let down = null;
		renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
		renderer.domElement.addEventListener('pointerup', (e) => {
			// a tap, not a drag round it, picks the part under it (or, on nothing, lets go and shows all of it)
			if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || !catalog) return void (down = null);
			down = null;
			const r = renderer.domElement.getBoundingClientRect();
			picked = stage.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
		});

		const resize = view.resize;
		resize();
		const adapt = adaptiveResolution(renderer, { top: topPixelRatio(low), hold: () => building, onChange: resize });
		const look = new THREE.Vector3();
		let raf = 0, last = performance.now(), slow = 0;
		const tick = () => {
			const now = performance.now(), wall = Math.min(1, (now - last) / 1000), dt = Math.min(0.05, wall);
			last = now;
			adapt(now);
			stage.update(dt);
			if (glide) {
				const k = Math.min(1, (glide.t += wall) / 0.9), e = k * k * (3 - 2 * k);
				camera.position.lerpVectors(glide.from[0], glide.to[0], e);
				controls.target.lerpVectors(glide.from[1], glide.to[1], e);
				if (k >= 1) glide = null;
			}
			if (follow) {
				const k = 1 - Math.exp(-wall * 4);
				look.copy(camera.position).sub(controls.target);
				controls.target.lerp(follow.at, k);
				const d = look.length();
				look.setLength(d + (follow.back - d) * k);
				camera.position.copy(controls.target).add(look);
				camera.near = Math.min(camera.near, follow.reach / 300);
				camera.far = Math.max(camera.far, follow.reach * 80);
				camera.updateProjectionMatrix();
				if (!growing && Math.abs(follow.back - d) < follow.back * 0.01 && controls.target.distanceTo(follow.at) < follow.reach * 0.01) follow = null;
			}
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
			if (stage.root && (stage.state?.labels > 0.01 || tags.length)) tags = stage.labels(box.clientWidth, box.clientHeight, safeArea(box));
			else if (!stage.root && tags.length) tags = [];
			if ((slow += wall) > 0.12 && hero) {
				slow = 0;
				scale = stage.scaleBar(box.clientHeight, controls.target);
				if (lab) reading = { ...lab.read };
				// the sliders a move sets follow it
				if (stage.move !== 'run') readValues();
			}
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(raf);
			mine++;
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

	/** the part of the canvas no card covers, so the labels' text stays in view */
	function safeArea(box) {
		const b = box.getBoundingClientRect();
		const safe = { left: 0, right: b.width, top: 0, bottom: b.height };
		for (const el of box.closest('.view')?.querySelectorAll('.card') ?? []) {
			const r = el.getBoundingClientRect();
			if (!r.width || !r.height || r.top >= b.bottom || r.bottom <= b.top) continue;
			const l = r.left - b.left, t = r.top - b.top;
			if (r.width > b.width * 0.6) safe.top = Math.max(safe.top, t + r.height);
			else if (l > b.width / 2) safe.right = Math.min(safe.right, l);
			else if (t > b.height / 2) safe.bottom = Math.min(safe.bottom, t);
		}
		return safe;
	}

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
	const num = (v, digits = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
	const measure = (v) => (v < 0.01 ? `${Math.round(v * 10000) / 10} mm` : v < 1 ? `${Math.round(v * 1000) / 10} cm` : `${Math.round(v * 100) / 100} m`);
</script>

<svelte:window onkeydown={key} />

<Turntable name="vault-asset" inline {compact} bind:canvas={canvasBox}>
	{#snippet head()}
		<h2 class="name">{title || at?.label || 'An asset'}{#if stageName}<small>{` · ${stageName}`}</small>{/if}</h2>
		{#if hero && !error}
			<div class="chips">
				{#each params.filter(tabbed) as p (p.id)}
					<span class="label">{p.label}</span>
					{#each p.names as n, k (k)}
						<button class="chip" class:on={Math.round(values[p.id]) === p.min + k} onclick={() => ((growing = false), setParam(p.id, p.min + k))}>{n}</button>
					{/each}
				{/each}
				{#if moves.length}
					<span class="label">Moves</span>
					{#each moves as [k, label] (k)}
						<button class="chip" class:on={k === 'grow' ? growing : moving === k} title={lab?.moves?.[k]?.note} onclick={() => playMove(k)}>{label}</button>
					{/each}
				{/if}
				{#if hero.view.ticks || hero.buildBy}<button class="chip" class:on={!modes.run} onclick={() => setMode('run')}>{modes.run ? 'Pause' : 'Play'}</button>{/if}
				{#if views.length}
					<span class="label">Views</span>
					{#each views as [k, label] (k)}
						<button class="chip" class:on={k === 'explode' && rigApart ? drawnApart : modes[k]} onclick={() => setMode(k)}>{label}</button>
					{/each}
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet panel()}
		{#if params.some((p) => !tabbed(p))}
			<div class="built">
				<span class="label">Built with</span>
				{#each params.filter((p) => !tabbed(p)) as p (p.id)}
					{#if p.type === 'string'}
						<label class="param">
							<span>{p.label}</span>
							<input value={values[p.id] ?? p.value} maxlength={p.maxLength ?? 80} onchange={(e) => setParam(p.id, e.currentTarget.value.trim() || p.value)} />
							{#if p.id === 'seed'}<button class="chip" onclick={freshSeed}>New seed</button>{/if}
						</label>
					{:else}
						<label class="slider">
							<span>{p.label}</span>
							<output>{values[p.id] ?? p.value}</output>
							<input type="range" min={p.min} max={p.max} step={p.step ?? (p.type === 'integer' ? 1 : 'any')} value={values[p.id] ?? p.value} onchange={(e) => setParam(p.id, e.currentTarget.value)} />
						</label>
					{/if}
				{/each}
			</div>
		{/if}
		{#if lab}
			<div class="lab">
				{#each Object.entries(lab.controls) as [k, c] (k)}
					<label class="slider">
						<span>{c.label}</span>
						<output>{num(sliders[k] ?? c.value, c.digits ?? 0)} {c.unit ?? ''}</output>
						<input type="range" min={c.min} max={c.max} step={c.step ?? 'any'} value={sliders[k] ?? c.value} oninput={(e) => slide(k, +e.currentTarget.value)} />
						{#if c.ends}<small><span>{c.ends[0]}</span><span>{c.ends[1]}</span></small>{/if}
					</label>
				{/each}
				{#if lab.how}
					<details class="how">
						<summary><b>How it is computed</b></summary>
						<p>{lab.how.text}</p>
						{#each lab.how.eqs ?? [] as q (q)}<code>{q}</code>{/each}
					</details>
				{/if}
			</div>
		{/if}
		{#if about}
			<div class="about">
				{@render about()}
				{#if from}<small>{from === 'cache' ? 'Its file checked in the vault, its build from this device’s cache' : 'Built in the box from its entry’s file'}</small>{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet readout()}
		{#if lab && hero && !error}
			<div class="hero" class:bad={reading.bad}>
				<span class="label">{lab.hero.label}</span>
				<b>{num(reading.value, lab.hero.digits ?? 0)}<small> {lab.hero.unit}</small></b>
				<i class="meter"><i style:width="{Math.min(100, (Math.max(0, reading.value) / (lab.hero.max || 1)) * 100)}%"></i></i>
				<span class="state">{reading.state}</span>
				<small>{reading.sub}</small>
			</div>
		{/if}
		{#if said.length > 160}
			<button class="note" class:more title={more ? 'Show less' : 'Show all of it'} onclick={() => (more = !more)}>{said}</button>
		{:else if said}
			<small>{said}</small>
		{/if}
		{#if error}
			<span class="missing">Not shown.</span>
		{:else if size}
			<span>{#if rise}{measure(rise[0])} above the soil · {measure(rise[1])} below · {measure(Math.max(size[0], size[2]))} across{:else}{measure(Math.max(size[0], size[2]))} long · {measure(size[1])} high{/if}</span>
		{/if}
		{#if scale[0] > 0 && hero && !error}<span class="scale"><i style:width="{scale[0]}px"></i>{scale[1]}</span>{/if}
		<small>Drag to turn round it · pinch or scroll to come closer{catalog ? ' · tap a part to see it on its own' : ''}</small>
	{/snippet}
	{#if part && !error}
		<div class="picked" role="status">
			<span><b>{part.label}</b>{solo ? ' on its own' : ''}</span>
			<button class="chip" onclick={() => (picked = null)}>Show all</button>
		</div>
	{/if}
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

	.param {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.4rem;
		align-items: center;
	}

	.param input {
		min-width: 0;
		font: inherit;
		padding: 0.2rem 0.4rem;
	}

	.slider {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.15rem 0.5rem;
		align-items: baseline;
	}

	.slider input {
		grid-column: 1 / -1;
		width: 100%;
		accent-color: #ff7a1a;
	}

	.slider output {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.slider small {
		grid-column: 1 / -1;
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		opacity: 0.55;
	}

	.how summary {
		cursor: pointer;
	}

	.how p {
		margin: 0.35rem 0;
		font-size: 0.78rem;
		line-height: 1.45;
		opacity: 0.8;
	}

	.how code {
		display: block;
		font-size: 0.72rem;
		padding: 0.12rem 0;
		white-space: pre-wrap;
		opacity: 0.85;
	}

	.hero {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding-bottom: 0.5rem;
		margin-bottom: 0.3rem;
		border-bottom: 1px solid rgb(0 0 0 / 0.08);
	}

	.hero b {
		font-size: 2rem;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
	}

	.hero b small {
		font-size: 0.9rem;
		font-weight: 500;
		opacity: 0.6;
	}

	.hero .meter {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: rgb(0 0 0 / 0.08);
		overflow: hidden;
	}

	.hero .meter i {
		display: block;
		height: 100%;
		background: #ff7a1a;
		transition: width 0.12s linear;
	}

	.hero .state {
		font-weight: 600;
	}

	.hero.bad .state,
	.hero.bad b {
		color: #b3261e;
	}

	.hero.bad .meter i {
		background: #b3261e;
	}

	.hero small {
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}

	button.note {
		all: unset;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
		font-size: 0.78rem;
		line-height: 1.45;
		opacity: 0.7;
		cursor: pointer;
	}

	button.note.more {
		display: block;
	}

	.scale {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		opacity: 0.7;
	}

	.scale i {
		display: block;
		height: 6px;
		border: 1.5px solid currentColor;
		border-top: 0;
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
	}

	.tags {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}

	.tags polyline {
		fill: none;
		stroke: #1f2a23;
		stroke-width: 1;
		opacity: 0.7;
	}

	.tags circle {
		fill: #ff7a1a;
		stroke: #fff;
		stroke-width: 1.2;
	}

	.tags text {
		font-size: 12px;
		fill: #1f2a23;
		paint-order: stroke;
		stroke: rgb(243 242 238 / 0.9);
		stroke-width: 3px;
	}

	.tags .name {
		font-weight: 600;
	}

	.tags .value {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}
</style>
