<!--
	THE RENDERER'S LAB (/app/assets/render/) — phase 4 of the asset pipeline (src/lib/assets/render): a thousand of our
	assets of every group (plants, things, machines, actors; ../../../lib/assets/render/testScene.js), each built the
	one way any asset is (from this device's cache, else in the asset box) and drawn by the universal renderer: every
	copy at the level of detail its size on screen calls for, the far ones as pictures of themselves, every copy of a
	kind one more instance of the same few drawings, and every kind at three levels of its shape before its picture (a
	plant's recipe at a lower detail, every other kind's build simplified beside the page: phase 5; each level read
	beside the finest where it takes over at ./levels/). Walked as Sandbox 4 is (the sandbox kit's stage, sky and
	walker), so the two can be measured alike: "Measure" stands at the scene's three places in turn and times ten
	seconds of frames at each. "Cut open" cuts the whole scene along a plane through the green, the kit's solids
	showing their section caps. "Controls near you" moves the copies within reach by the controls their builds offer (a
	tent pitched, a pickup's doors, a machine drawn apart or built up), played from the numbers the box wrote down;
	"Rest" puts every copy back. `?fresh` builds every asset afresh, keeping nothing; `?boxes=n` builds n at a time.
-->
<script>
	import { foot, FOOT } from '$lib/app/foot.js';
	// @ts-nocheck — plain JS
	import { onDestroy, onMount } from 'svelte';
	import * as THREE from 'three';
	import { createSky, createStage, createWalker, WalkHint, WorldBar } from '$lib/sandbox-kit';
	import TouchStick from '$lib/touch/TouchStick.svelte';

	let stage = $state();
	let loading = $state(true);
	let line = $state('Starting the asset boxes');
	let done = $state(0);
	let of = $state(1);
	let stats = $state(null);
	let measuring = $state(false);
	let measured = $state(null);
	let cut = $state(false);
	/** the controls of the copies within reach: each its id, its name, how many copies, the nearest one's value */
	let near = $state([]);
	let moved = $state(0);
	let walker, assets, world, frame, timer;
	/** every copy placed, where it stands */
	let copies = [];
	/** how far the controls near you reach (m) */
	const REACH = 25;
	let destroyed = false;
	/** the frame times of the last second, for the readout */
	const times = [];
	/** when measuring: every frame's time */
	let tape = null;

	onMount(async () => {
		const q = new URLSearchParams(location.search);
		const [{ createAssets }, { testScene, SPOTS }] = await Promise.all([import('$lib/assets/render/index.js'), import('$lib/assets/render/testScene.js')]);
		if (destroyed) return;
		world = createStage(stage);
		const { renderer, scene, camera } = world;
		const sky = createSky(renderer, scene, {});
		const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: '#6f8f4e', roughness: 0.95 }));
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);
		walker = createWalker(camera, renderer.domElement, { x: SPOTS[0].x, z: SPOTS[0].z, yaw: SPOTS[0].yaw, pitch: SPOTS[0].pitch });
		assets = createAssets({ renderer, camera, cache: !q.has('fresh'), boxes: Number(q.get('boxes')) || undefined });
		scene.add(assets.group);
		// for a look from the console, and the checks that measure it: __assets.stats(), __walker.place(x, z, yaw, pitch)
		window.__assets = assets;
		window.__walker = walker;
		window.__world = { renderer, scene, camera };

		const t0 = performance.now();
		const placed = testScene();
		copies = placed.map((p) => ({ x: p.x, z: p.z, copy: assets.place(p.ref, { x: p.x, z: p.z, turn: p.turn, scale: p.scale }) }));
		window.__copies = copies;
		of = assets.kinds().length;
		line = `Building ${of} kinds of asset in the box`;

		let last = performance.now();
		const tick = () => {
			const now = performance.now();
			const dt = now - last;
			last = now;
			times.push(dt);
			if (times.length > 240) times.shift();
			tape?.push(dt);
			walker.update(Math.min(0.1, dt / 1000));
			sky.follow(camera.position.x, camera.position.z);
			sky.tick(now);
			assets.update();
			renderer.render(scene, camera);
			world.adapt(now);
			frame = requestAnimationFrame(tick);
		};
		tick();
		timer = setInterval(() => {
			stats = readout(renderer);
			if (!loading) near = nearby();
		}, 500);

		await assets.ready((n, total) => {
			done = n;
			line = `Built ${n} of ${total} kinds`;
		});
		if (destroyed) return;
		const s = assets.stats();
		line = `${s.loaded} of ${s.kinds} kinds in ${((performance.now() - t0) / 1000).toFixed(1)} s${s.failed.length ? `, ${s.failed.length} failed` : ''}`;
		document.body.dataset.ready = String(Math.round(performance.now() - t0));
		loading = false;
	});

	/** what the renderer draws now, and how fast */
	function readout(renderer) {
		const s = assets.stats();
		const recent = times.slice(-60);
		const mean = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
		return { ...s, fps: mean ? 1000 / mean : 0, ms: mean, calls: renderer.info.render.calls, drawn: renderer.info.render.triangles };
	}

	/** the copies within reach that have controls, nearest first */
	function reachable() {
		const { x, z } = world.camera.position;
		return copies
			.map((c) => ({ ...c, d: Math.hypot(c.x - x, c.z - z) }))
			.filter((c) => c.d < REACH && assets.controlsOf(c.copy).length)
			.sort((a, b) => a.d - b.d);
	}

	/** the controls near you, as rows: one for each control any of them has */
	function nearby() {
		const rows = new Map();
		for (const c of reachable()) {
			const values = assets.poseOf(c.copy);
			for (const k of assets.controlsOf(c.copy)) {
				const row = rows.get(k.id);
				if (row) row.copies++;
				else rows.set(k.id, { ...k, copies: 1, value: values[k.id] });
			}
		}
		moved = copies.filter((c) => assets.posed(c.copy)).length;
		return [...rows.values()];
	}

	/** a control set on every copy within reach that has it */
	function setNear(id, v) {
		for (const c of reachable()) assets.pose(c.copy, id, v);
		near = nearby();
	}

	/** every copy back at rest */
	function restAll() {
		for (const c of copies) assets.rest(c.copy);
		near = nearby();
	}

	const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
	const pct = (list, p) => {
		const s = [...list].sort((a, b) => a - b);
		return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
	};

	/** stands at each of the scene's places, lets the finer levels come, then times ten seconds of frames */
	async function measure() {
		const { SPOTS } = await import('$lib/assets/render/testScene.js');
		measuring = true;
		measured = null;
		const out = [];
		for (const spot of SPOTS) {
			walker.place(spot.x, spot.z, spot.yaw, spot.pitch);
			// the finer shapes a nearer copy wants come in the meantime
			for (let k = 0; k < 40 && assets.stats().building; k++) await wait(250);
			await wait(3000);
			tape = [];
			const t = performance.now();
			await wait(10000);
			const span = performance.now() - t;
			const frames = tape;
			tape = null;
			const r = readout(world.renderer);
			out.push({ spot: spot.name, fps: +(frames.length / (span / 1000)).toFixed(2), p50: +pct(frames, 0.5).toFixed(1), p95: +pct(frames, 0.95).toFixed(1), calls: r.calls, triangles: r.drawn, levels: r.levels, pictures: r.pictures, culled: r.culled, copies: r.copies });
		}
		measured = { ready: Number(document.body.dataset.ready), spots: out, kinds: assets.stats().kinds, materials: assets.stats().materials, pages: assets.stats().pages };
		measuring = false;
	}

	function toggleCut() {
		cut = !cut;
		// a plane across the green and the yard, keeping the half towards the pasture: the cut faces turned to the walker
		assets.cut(cut ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) : null);
	}

	onDestroy(() => {
		destroyed = true;
		cancelAnimationFrame(frame);
		clearInterval(timer);
		assets?.dispose();
		walker?.dispose();
		world?.dispose?.();
		delete window.__assets;
		delete window.__walker;
		delete window.__world;
		delete window.__copies;
	});

	const n = (x) => Math.round(x).toLocaleString('en');
</script>

<svelte:head>
	<title>Renderer lab · maiaCITY</title>
	<meta name="description" content="A thousand of our assets, built in the asset box and drawn by one renderer: levels of detail by size on screen, pictures far away, every kind instanced." />
</svelte:head>

<div class="lab">
	<div class="stage" bind:this={stage} role="application" aria-label="The renderer's test scene: drag to look, WASD to walk"></div>
	<WorldBar title="Renderer lab" subtitle="1,000 assets · one renderer" />
	<WalkHint keys="Drag to look · WASD to walk · Shift to hurry" />
	<TouchStick move={(x, y, hurry) => walker?.move(x, y, hurry)} look={(dx, dy) => walker?.look(dx, dy)} {stage} taps=".panel button" />

	<aside class="panel" use:foot={FOOT.waiting} aria-label="What the renderer draws">
		<div class="actions">
			<button onclick={measure} disabled={loading || measuring}>{measuring ? 'Measuring…' : 'Measure'}</button>
			<button onclick={toggleCut} disabled={loading} aria-pressed={cut}>{cut ? 'Close the cut' : 'Cut open'}</button>
		</div>
		<p class="line" data-line>{line}</p>
		{#if stats}
			<dl>
				<dt>Frame rate</dt>
				<dd>{stats.fps.toFixed(1)} fps · {stats.ms.toFixed(1)} ms</dd>
				<dt>Draw calls</dt>
				<dd>{n(stats.calls)}</dd>
				<dt>Triangles</dt>
				<dd>{n(stats.drawn)} <span>(assets {n(stats.tris)})</span></dd>
				<dt>Copies</dt>
				<dd>{n(stats.copies)} of {stats.loaded} kinds</dd>
				<dt>By level</dt>
				<dd>{stats.levels.map((x) => n(x)).join(' · ')} · pictures {n(stats.pictures)}</dd>
				<dt>Out of view</dt>
				<dd>{n(stats.culled)}</dd>
				<dt>Materials</dt>
				<dd>{stats.materials} · {stats.pages} picture page{stats.pages === 1 ? '' : 's'}</dd>
				<dt>Building</dt>
				<dd>{stats.building ? `${stats.building} in the box` : 'nothing'} · {stats.builds} builds kept, {stats.made} levels made from them</dd>
			</dl>
			{#if stats.failed.length}
				<p class="failed">Did not load: {stats.failed.map((f) => f.label).join(', ')}</p>
			{/if}
		{/if}
		{#if !loading}
			<section class="controls" aria-label="Controls near you">
				<h2>Controls near you <span>{REACH} m</span></h2>
				{#each near as c (c.id)}
					<label class="control">
						<span>{c.label} <i>{c.copies} {c.copies === 1 ? 'copy' : 'copies'}</i></span>
						{#if c.choice}
							<input type="checkbox" checked={c.value >= 0.5} onchange={(e) => setNear(c.id, e.currentTarget.checked ? c.to : c.from)} />
						{:else}
							<input type="range" min={Math.min(c.from, c.to)} max={Math.max(c.from, c.to)} step="0.01" value={c.value} oninput={(e) => setNear(c.id, Number(e.currentTarget.value))} />
						{/if}
					</label>
				{:else}
					<p class="none">Walk up to a tent, a fire place or a machine.</p>
				{/each}
				{#if moved}
					<button class="rest" onclick={restAll}>Rest {moved} moved {moved === 1 ? 'copy' : 'copies'}</button>
				{/if}
			</section>
		{/if}
		{#if measured}
			<table class="measured">
				<thead><tr><th>Place</th><th>fps</th><th>p50</th><th>p95</th><th>calls</th><th>triangles</th></tr></thead>
				<tbody>
					{#each measured.spots as s (s.spot)}
						<tr><td>{s.spot}</td><td>{s.fps}</td><td>{s.p50}</td><td>{s.p95}</td><td>{n(s.calls)}</td><td>{n(s.triangles)}</td></tr>
					{/each}
				</tbody>
			</table>
			<pre id="measure" hidden>{JSON.stringify(measured)}</pre>
		{/if}
	</aside>

	{#if loading}
		<div class="loading" use:foot={FOOT.waiting} role="status" aria-live="polite">
			<p class="eyebrow">Renderer lab</p>
			<strong>A thousand assets, built in the box</strong>
			<div class="progress"><span style:width="{Math.min(100, (done / of) * 100)}%"></span></div>
			<span class="step">{line}…</span>
		</div>
	{/if}
</div>

<style>
	.lab {
		position: fixed;
		inset: 0;
		background: #1f2a23;
	}
	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}
	.panel {
		position: relative;
		z-index: 3;
		width: min(20rem, calc(100vw - 1.5rem));
		box-sizing: border-box;
		padding: 0.75rem 0.85rem;
		border: 1px solid rgb(255 255 255 / 0.45);
		border-radius: 14px;
		background: rgb(250 248 242 / 0.86);
		-webkit-backdrop-filter: blur(16px) saturate(1.2);
		backdrop-filter: blur(16px) saturate(1.2);
		color: #1f2a23;
		font-size: 0.8rem;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.14);
	}
	.actions {
		display: flex;
		gap: 0.4rem;
	}
	.actions button {
		flex: 1;
		padding: 0.45rem 0.6rem;
		border: 1px solid rgb(31 42 35 / 0.18);
		border-radius: 999px;
		background: #fff;
		color: inherit;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.actions button[aria-pressed='true'] {
		background: #2f5f2a;
		color: #fff;
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.line {
		margin: 0.6rem 0 0.4rem;
		opacity: 0.75;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.2rem 0.7rem;
		margin: 0;
	}
	dt {
		opacity: 0.55;
	}
	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	dd span {
		opacity: 0.6;
	}
	.failed {
		margin: 0.5rem 0 0;
		color: #8a2a1a;
	}
	.controls {
		margin-top: 0.7rem;
		padding-top: 0.6rem;
		border-top: 1px solid rgb(31 42 35 / 0.12);
	}
	.controls h2 {
		display: flex;
		justify-content: space-between;
		margin: 0 0 0.4rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.7;
	}
	.controls h2 span {
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
	}
	.control {
		display: grid;
		gap: 0.15rem;
		margin-bottom: 0.4rem;
	}
	.control span {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.control i {
		font-style: normal;
		opacity: 0.55;
	}
	.control input[type='range'] {
		width: 100%;
		accent-color: #2f5f2a;
	}
	.control input[type='checkbox'] {
		justify-self: start;
		accent-color: #2f5f2a;
	}
	.none {
		margin: 0;
		opacity: 0.6;
	}
	.rest {
		width: 100%;
		margin-top: 0.2rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid rgb(31 42 35 / 0.18);
		border-radius: 999px;
		background: #fff;
		color: inherit;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.measured {
		width: 100%;
		margin-top: 0.6rem;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	.measured th,
	.measured td {
		padding: 0.15rem 0.2rem;
		text-align: right;
	}
	.measured th:first-child,
	.measured td:first-child {
		text-align: left;
	}
	.loading {
		position: relative;
		z-index: 4;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: min(22rem, calc(100vw - 2rem));
		padding: 0.9rem 1rem;
		border-radius: 14px;
		background: rgb(250 248 242 / 0.9);
		color: #1f2a23;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
	}
	.loading .eyebrow {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	.progress {
		height: 6px;
		border-radius: 3px;
		background: rgb(31 42 35 / 0.12);
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		background: #2f5f2a;
		transition: width 0.3s;
	}
	.step {
		font-size: 0.78rem;
		opacity: 0.7;
	}
	/* on a phone: the readout at the foot, short, above the nav pill */
	@media (max-width: 640px) {
		.panel {

			width: auto;
			max-height: 40vh;
			overflow: auto;
		}
	}
</style>
