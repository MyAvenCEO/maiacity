<!--
	AN ASSET'S BUILD ON ITS OWN PAGE — /<its recipe's hash>/?t=<its name>&its=values, on the root as a Universe post is
	(src/routes/[doc=doc], $lib/ids.js). The address names the build and nothing else: the recipe by the BLAKE3 hash of
	its bytes, read in base32, and the values it is built with; `?t=` is only its name as avenDB gives it (Apple v2 ·
	1a2b3c4d…) in words, so the address reads, and is never one of its values. The build loads as every build does (./load.js): from this
	device's cache when it was built here before, else in the box, checked either way, its recipe the Maia City vault's
	(./vault.js, loaded before this page is: src/routes/[doc=doc]/+page.js). Each value the recipe declares
	can be changed here, and the address follows, written the one way that build is named: every value, sorted. Its
	controls (a tent's pitch, a pickup's doors, a machine drawn apart or built up) move the build in the view, played
	from the numbers the box wrote down when it played its builder's own (./controls.js); they change no address. It
	is shown in its own light on a grid of metres, not on the asset stage, with the viewers' frame loop and their way
	of keeping only the build last asked for (./viewer.js).
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { disposeObject } from '$lib/render/core.js';
	import { createStageRenderer } from '$lib/render/stage.js';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { poserOf } from './controls.js';
	import { engineAt } from './engines.js';
	import { OBJECT_GROUPS } from './groups.js';
	import { boxOf, canonical, loadAsset } from './load.js';
	import { valuesOf } from './params.js';
	import { INDEX, nameOf, pageOf } from './vault.js';
	import { asker, loop } from './viewer.js';

	let { hash } = $props();

	const at = $derived(INDEX.recipes[hash]);
	const engine = engineAt(INDEX.engine);

	const hrefOf = (h, values) => pageOf(base, h, values);

	// the values the address gives, as text: every one but its words (`t`)
	const given = $derived(Object.fromEntries([...page.url.searchParams].filter(([k]) => k !== 't')));
	const asked = $derived.by(() => {
		const q = new URLSearchParams([...page.url.searchParams].filter(([k]) => k !== 't')).toString();
		return q ? `${hash}?${q}` : hash;
	});
	// the build the address names, with each value its recipe takes, or why it names none
	const named = $derived.by(() => {
		try {
			return canonical(asked);
		} catch (e) {
			return { error: e.message };
		}
	});
	const name = $derived(named.error ? null : named.name);
	const refused = $derived(named.error ?? '');

	// the address written the one way: a value left out, out of order or spelt another way is put right
	$effect(() => {
		if (named.error) return;
		const want = hrefOf(hash, named.values);
		if (page.url.pathname + page.url.search !== want) goto(want, { replaceState: true, noScroll: true, keepFocus: true });
	});

	// the other versions and variants of the same asset, each with the values it takes of these
	const kin = $derived(
		Object.entries(INDEX.recipes)
			.filter(([, r]) => r.group === at.group && r.id === at.id)
			.sort(([, a], [, b]) => a.v - b.v || String(a.variant ?? '').localeCompare(String(b.variant ?? '')))
			.map(([h, r]) => {
				let values;
				try {
					values = r.params?.length ? valuesOf(r.params, Object.fromEntries(Object.entries(given).filter(([k]) => r.params.some((p) => p.id === k)))) : undefined;
				} catch {
					values = undefined;
				}
				return { hash: h, at: r, href: hrefOf(h, values), here: h === hash };
			})
	);

	let canvas = $state();
	let ready = $state(false);
	let busy = $state(false);
	let error = $state('');
	let built = $state(null);
	// what a slider reads while it is moved, before the build it names is asked for
	let draft = $state({});
	// the build's controls, and each one's value now
	let poser = $state.raw(null);
	let pose = $state({});
	let view, renderer, scene, camera, controls, grid, shown;
	const asks = asker();

	onMount(() => {
		// the stage renderer ($lib/render/stage.js) on the page's canvas, fitted to it as it is drawn (below)
		view = createStageRenderer(canvas, { canvas, fov: 40, near: 0.01, far: 500, style: false });
		({ renderer, camera, controls } = view);
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0xefeadf);
		scene.add(new THREE.HemisphereLight(0xf4f1ff, 0x6b5a40, 1.7));
		const sun = new THREE.DirectionalLight(0xffffff, 2.2);
		sun.position.set(4, 8, 5);
		scene.add(sun);
		camera.position.set(4, 3, 6);
		const stop = loop(() => {
			const w = canvas.clientWidth, h = canvas.clientHeight;
			if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
				renderer.setSize(w, h, false);
				camera.aspect = w / Math.max(1, h);
				camera.updateProjectionMatrix();
			}
			controls.update();
			renderer.render(scene, camera);
		});
		ready = true;
		// in the browser only: on the server the page is drawn without its view
		return () => {
			stop();
			asks.drop();
			if (shown) dispose(shown);
			grid?.geometry.dispose();
			view.dispose();
			boxOf().stop('the page was left');
		};
	});

	$effect(() => {
		if (!ready) return;
		error = refused;
		if (name) void load(name);
	});

	async function load(n) {
		const mine = asks.ask();
		busy = true;
		error = '';
		try {
			const r = await loadAsset(n);
			if (!asks.is(mine)) return;
			show(r.obj);
			built = r;
			draft = {};
			poser = poserOf(r.obj);
			pose = Object.fromEntries(poser.list.map((c) => [c.id, c.rest]));
		} catch (e) {
			if (asks.is(mine)) error = e.message;
		}
		if (asks.is(mine)) busy = false;
	}

	const dispose = (obj) => disposeObject(obj);

	function show(obj) {
		const first = !shown;
		if (shown) {
			scene.remove(shown);
			dispose(shown);
		}
		shown = obj;
		scene.add(obj);
		const b = new THREE.Box3().setFromObject(obj);
		const size = b.getSize(new THREE.Vector3());
		const mid = b.getCenter(new THREE.Vector3());
		// a grid of metres under it, every asset being in metres
		const across = Math.max(2, Math.ceil(Math.max(size.x, size.z) * 1.6));
		if (grid?.userData.across !== across) {
			if (grid) {
				scene.remove(grid);
				grid.geometry.dispose();
			}
			grid = new THREE.GridHelper(across, across, 0xb9b09c, 0xd6cfbe);
			grid.userData.across = across;
			scene.add(grid);
		}
		grid.position.set(mid.x, b.isEmpty() ? 0 : b.min.y, mid.z);
		// the whole build in view, seen from where it was looked at from (a sapling and its tree differ tenfold in size)
		const reach = size.length() || 1;
		const from = first ? new THREE.Vector3(0.6, 0.45, 1).normalize() : camera.position.clone().sub(controls.target).normalize();
		controls.target.copy(mid);
		camera.position.copy(mid).addScaledVector(from, reach * 1.25);
		camera.near = reach / 500;
		camera.far = reach * 50;
		camera.updateProjectionMatrix();
	}

	/** a value changed: the address names the new build, and the page loads it */
	function set(id, raw) {
		const next = { ...(named.values ?? {}), [id]: raw };
		goto(hrefOf(hash, next), { replaceState: true, noScroll: true, keepFocus: true });
	}

	/** a control moved: the build in the view with it */
	function move(id, v) {
		poser.set(id, v);
		pose = { ...pose, [id]: poser.get(id) };
	}

	function rest() {
		poser.reset();
		pose = Object.fromEntries(poser.list.map((c) => [c.id, c.rest]));
	}

	const valueAt = (p) => draft[p.id] ?? named.values?.[p.id] ?? p.value;
	const said = (p, v) => (p.names?.[Number(v)] ? `${p.names[Number(v)]} (${v})` : String(v));
	const metres = (s) => s.map((x) => (x >= 10 ? x.toFixed(1) : x.toFixed(2))).join(' × ') + ' m';
	const whereFrom = (r) =>
		r.from === 'cache' ? `Kept on this device: read in ${r.ms.read} ms, built into the view in ${r.ms.rebuild} ms` : `Built in the box in ${r.ms.build} ms, ${r.ms.total} ms in all, and kept on this device`;
</script>

<svelte:head>
	<title>{built?.card.label ?? nameOf(hash)} · Game Assets · maiaCITY</title>
	<meta name="description" content="{nameOf(hash)}: a build of its recipe, named by its BLAKE3 hash." />
</svelte:head>

<main class="wrap asset">
	<a class="back" href="{base}/app/#assets">← Assets</a>

	<header>
		<p class="eyebrow">{OBJECT_GROUPS[at.group]?.label ?? at.group}</p>
		<h1>{built?.card.label ?? nameOf(hash)}</h1>
		{#if built?.card.note}<p class="note">{built.card.note}</p>{/if}
	</header>

	<div class="grid">
		<div class="view">
			<canvas bind:this={canvas} aria-label="The asset, built"></canvas>
			{#if busy}<p class="badge">Building…</p>{/if}
		</div>

		<aside>
			{#if error}<p class="error" role="alert">{error}</p>{/if}

			{#if at.params?.length}
				<section>
					<h2>Built with</h2>
					{#each at.params as p (p.id)}
						<label class="param">
							<span>{p.label ?? p.id}{#if p.type !== 'string'}<b>{said(p, valueAt(p))}</b>{/if}</span>
							{#if p.type !== 'string' && p.min !== undefined && p.max !== undefined}
								<input
									type="range"
									min={p.min}
									max={p.max}
									step={p.step ?? (p.type === 'integer' || p.names ? 1 : (p.max - p.min) / 100)}
									value={valueAt(p)}
									oninput={(e) => (draft = { ...draft, [p.id]: e.currentTarget.value })}
									onchange={(e) => set(p.id, e.currentTarget.value)}
								/>
							{:else}
								<input
									type={p.type === 'string' ? 'text' : 'number'}
									maxlength={p.type === 'string' ? (p.maxLength ?? 80) : undefined}
									value={valueAt(p)}
									onchange={(e) => set(p.id, e.currentTarget.value)}
								/>
							{/if}
						</label>
					{/each}
				</section>
			{/if}

			{#if poser?.list.length}
				<section>
					<h2>Controls</h2>
					{#each poser.list as c (c.id)}
						<label class="param">
							<span>{c.label}<b>{c.choice ? (pose[c.id] >= 0.5 ? 'on' : 'off') : `${Math.round(((pose[c.id] - c.from) / (c.to - c.from)) * 100)} %`}</b></span>
							{#if c.choice}
								<input type="checkbox" checked={pose[c.id] >= 0.5} onchange={(e) => move(c.id, e.currentTarget.checked ? c.to : c.from)} />
							{:else}
								<input type="range" min={Math.min(c.from, c.to)} max={Math.max(c.from, c.to)} step="0.01" value={pose[c.id]} oninput={(e) => move(c.id, Number(e.currentTarget.value))} />
							{/if}
						</label>
					{/each}
					{#if Object.entries(pose).some(([id, v]) => v !== poser.list.find((c) => c.id === id)?.rest)}
						<button class="rest" onclick={rest}>Back as built</button>
					{/if}
				</section>
			{/if}

			<section>
				<h2>This build</h2>
				<dl>
					<dt>Name</dt>
					<dd>{nameOf(hash)}</dd>
					<dt>Recipe</dt>
					<dd><code class="hash">{hash}</code><small>the BLAKE3 hash of its bytes</small></dd>
					{#if built}
						<dt>Size</dt>
						<dd>{metres(built.card.size)}</dd>
						<dt>Triangles</dt>
						<dd>{built.card.triangles.toLocaleString('en')}</dd>
						<dt>From</dt>
						<dd>{whereFrom(built)}</dd>
					{/if}
					<dt>Engine</dt>
					<dd>Engine {engine.v}, three.js {engine.three}<small><code class="hash">{engine.blake3}</code></small></dd>
				</dl>
			</section>

			{#if kin.length > 1}
				<section>
					<h2>Other builds of it</h2>
					<ul class="kin">
						{#each kin as k (k.hash)}
							<li><a href={k.href} aria-current={k.here ? 'page' : undefined}>{nameOf(k.hash)}</a></li>
						{/each}
					</ul>
				</section>
			{/if}
		</aside>
	</div>
</main>

<style>
	.asset {
		padding-block: 2.5rem 6rem;
	}

	.back {
		display: inline-block;
		font-size: 0.9rem;
		text-decoration: none;
		color: var(--ink-soft);
	}

	header {
		margin: 1.4rem 0 1.2rem;
	}

	h1 {
		margin: 0.3rem 0 0;
		font-family: var(--font-display);
		font-weight: 500;
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1.05;
	}

	.note {
		margin: 0.6rem 0 0;
		max-width: 60ch;
		color: var(--ink-soft);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 1.5rem;
		align-items: start;
	}

	.view {
		position: relative;
	}

	canvas {
		display: block;
		width: 100%;
		height: min(70vh, 620px);
		border-radius: var(--radius);
		background: #efeadf;
		touch-action: none;
	}

	.badge {
		position: absolute;
		top: 0.8rem;
		left: 0.8rem;
		margin: 0;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		background: var(--paper);
		color: var(--ink-soft);
		font-size: 0.8rem;
	}

	aside {
		display: grid;
		gap: 1.4rem;
		min-width: 0;
	}

	h2 {
		margin: 0 0 0.6rem;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.param {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 0.8rem;
		font-size: 0.9rem;
	}

	.param span {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.param b {
		font-weight: 500;
	}

	.param input[type='range'] {
		width: 100%;
		accent-color: var(--brand-green);
	}

	.param input[type='checkbox'] {
		justify-self: start;
		accent-color: var(--brand-green);
	}

	.rest {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		color: inherit;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.param input:not([type='range']):not([type='checkbox']) {
		font: inherit;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		color: inherit;
	}

	dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.45rem 0.9rem;
		margin: 0;
		font-size: 0.9rem;
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}

	dd small {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.hash {
		overflow-wrap: anywhere;
		font-size: 0.75rem;
	}

	.kin {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.kin a {
		display: inline-block;
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.85rem;
		text-decoration: none;
	}

	.kin a[aria-current='page'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
	}

	.error {
		margin: 0;
		padding: 0.7rem 0.9rem;
		border-radius: 12px;
		background: #f6e1d8;
		color: #7a2f17;
		font-size: 0.9rem;
	}

	@media (max-width: 860px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}

		canvas {
			height: min(56vh, 460px);
		}
	}

	@media (max-width: 640px) {
		.asset {
			padding-inline: 16px;
			padding-block: 1.5rem 5rem;
		}
	}
</style>
