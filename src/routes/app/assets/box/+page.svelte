<!--
	THE ASSET BOX'S LAB (/app/assets/box/) — phases 0 to 2b of the asset pipeline (src/lib/assets): our own assets built
	inside the box, a worker in a frame with no origin running a frozen engine, and shown from the plain data it hands
	back, as an asset no one trusts would be. Every build is named by its recipe's BLAKE3 hash and the values it takes
	(`<hash>?seed=maia&stage=9`); a label such as plants/apple@2 only points at a hash. One button runs every check: the
	engine checked against its hash, what the box cannot reach (tried by a recipe), assets built in the box against the
	same built in the page, a recipe that never stops, a recipe whose bytes are not its name, data and cards out of shape,
	each recipe's parameters, and each asset loaded again from this device's cache the same, with no box started.
-->
<script>
	// @ts-nocheck — plain JS
	import { onDestroy, onMount } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import TRIALS from 'virtual:asset-recipes/trials';
	import { AssetBox, engineCode } from '$lib/assets/box/host.js';
	import { rebuild } from '$lib/assets/box/rebuild.js';
	import { FORMAT } from '$lib/assets/box/serialize.js';
	import * as cache from '$lib/assets/cache.js';
	import { trianglesOf as tris } from '$lib/assets/card.js';
	import { LATEST } from '$lib/assets/engines.js';
	import { boxOf, keyOf, loadAsset } from '$lib/assets/load.js';
	import { INDEX, buildAt, checked, hashText, recipeAt } from '$lib/assets/recipes.js';
	import { valuesOf } from '$lib/assets/params.js';
	import { checkCard } from '$lib/assets/schemas/index.js';
	import { hostileCards } from '$lib/assets/schemas/hostile.js';

	// each named by its label and the values it takes (a plant's stage and seed; the others take none), then by hash
	const LABELS = ['plants/apple?seed=maia&stage=9', 'plants/jackfruit?seed=maia&stage=9', 'things/bell-tent', 'machines/powercube@3', 'actors/stand-in'];
	const SAMPLES = LABELS.map((label) => ({ label, name: buildAt(label) }));
	const short = (name) => `${name.slice(0, 10)}…${name.slice(64)}`;

	let box = boxOf();
	let canvas = $state();
	let name = $state(SAMPLES[0].name);
	let busy = $state(false);
	let held = $state(null);
	let line = $state('');
	let checks = $state([]);
	let probes = $state(null);
	let results = $state(null);
	let renderer, scene, camera, controls, shown, frame;
	// the checks time builds: the view holds still meanwhile, so drawing it takes no time from them
	let still = false;

	onMount(() => {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setPixelRatio(Math.min(2, devicePixelRatio));
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0x1d2420);
		scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3326, 1.6));
		const sun = new THREE.DirectionalLight(0xffffff, 2.2);
		sun.position.set(4, 8, 5);
		scene.add(sun);
		camera = new THREE.PerspectiveCamera(40, 1, 0.01, 500);
		camera.position.set(4, 3, 6);
		controls = new OrbitControls(camera, canvas);
		const loop = () => {
			frame = requestAnimationFrame(loop);
			const w = canvas.clientWidth, h = canvas.clientHeight;
			if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
				renderer.setSize(w, h, false);
				camera.aspect = w / Math.max(1, h);
				camera.updateProjectionMatrix();
			}
			if (still) return;
			controls.update();
			renderer.render(scene, camera);
		};
		loop();
	});
	onMount(() => void count());
	onDestroy(() => {
		cancelAnimationFrame(frame);
		box.stop();
		renderer?.dispose();
	});

	function show(obj) {
		if (shown) scene.remove(shown);
		shown = obj;
		scene.add(obj);
		const b = new THREE.Box3().setFromObject(obj);
		const size = b.getSize(new THREE.Vector3()).length() || 1;
		const mid = b.getCenter(new THREE.Vector3());
		controls.target.copy(mid);
		camera.position.copy(mid).add(new THREE.Vector3(0.6, 0.45, 1).multiplyScalar(size));
		camera.near = size / 500;
		camera.far = size * 50;
		camera.updateProjectionMatrix();
	}

	const now = () => performance.now();
	const size = (obj) => new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).toArray().map((x) => Math.round(x * 1000) / 1000);

	/** one build in the box (never from the cache), shown from its data, with its times */
	const inBox = (n) => loadAsset(n, { box, cache: false });

	/** what this device's cache holds */
	async function count() {
		const u = await cache.usage();
		held = u.kept ? `${u.count} ${u.count === 1 ? 'build' : 'builds'}, ${(u.bytes / 1048576).toFixed(1)} MB` : 'none in this browser';
	}

	async function loadOne() {
		busy = true;
		line = `Loading ${short(name)}…`;
		try {
			const r = await loadAsset(name.trim(), { box });
			show(r.obj);
			const where = r.from === 'cache' ? `from this device's cache in ${r.ms.total} ms (read ${r.ms.read} ms, rebuilt ${r.ms.rebuild} ms)` : `built in the box in ${r.ms.build} ms, ${r.ms.total} ms to the page, rebuilt in ${r.ms.rebuild} ms`;
			line = `${r.card.label} (${r.card.ref}): ${r.data.stats.tris.toLocaleString('en')} triangles, ${where}` + (r.data.stats.custom ? `, ${r.data.stats.custom} materials with their own shader drawn plain` : '');
			await r.stored;
			await count();
		} catch (e) {
			line = `${short(name)}: ${e.message}`;
		}
		busy = false;
	}

	async function empty() {
		await cache.clear();
		await count();
		line = 'The cache is empty: every asset builds in the box again.';
	}

	/** data out of shape: every one must be refused */
	const HOSTILE = {
		'a position that is not a number': (d) => (d.geometries[0].attributes.position.array[0] = NaN),
		'an index past its vertices': (d) => (d.geometries[0].index = new Uint32Array([0, 1, 1e6])),
		'nodes in a loop': (d) => d.nodes[d.nodes.length - 1].children.push(0),
		'a node with two parents': (d) => d.nodes[0].children.push(d.nodes[0].children[0]),
		'a material kind we do not know': (d) => (d.materials[0].type = 'ShaderMaterial'),
		'a material that is code': (d) => (d.materials[0].type = 'constructor'),
		'a picture too large': (d) => d.textures.push({ pixels: { data: new Uint8Array(4), width: 9000, height: 1 } }),
		'a string where an array should be': (d) => (d.geometries[0].attributes.position.array = 'x'.repeat(30)),
		'too many triangles': (d) => {
			const g = d.geometries[0];
			g.index = new Uint32Array(3 * 2_100_000);
			d.nodes.push({ name: 'x', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [], mesh: { geometry: 0, material: 0, kind: 'mesh' } });
			d.nodes[0].children.push(d.nodes.length - 1);
		},
		'a matrix that is not numbers': (d) => (d.nodes[0].matrix = Array(16).fill('1')),
		'another format': (d) => (d.format = FORMAT + 1)
	};

	async function runAll() {
		busy = true;
		still = true;
		checks = [];
		const add = (name, ok, note) => (checks = [...checks, { name, ok, note }]);
		const out = { userAgent: navigator.userAgent, engine: null, assets: [], probes: null, kill: null, hostile: {} };
		try {
			let t0 = now();
			const code = await engineCode(LATEST.v);
			out.engine = { v: LATEST.v, blake3: LATEST.blake3, bytes: code.length, hashed: hashText(code) };
			add(`Engine ${LATEST.v} is the one frozen`, out.engine.hashed === LATEST.blake3, `its ${(code.length / 1024).toFixed(0)} KB file hashes to ${LATEST.blake3.slice(0, 16)}…, the BLAKE3 hash engines.json froze it under on ${LATEST.date}; three.js ${LATEST.three}, ${LATEST.modules.length} modules lent to recipes`);

			t0 = now();
			await box.start();
			out.start = Math.round(now() - t0);
			add('The box starts', true, `${out.start} ms, engine ${LATEST.v} handed in whole`);

			line = 'A recipe tries every way out of the box…';
			const probed = await box.build(checked(TRIALS.probe));
			probes = Object.fromEntries(probed.data.nodes.slice(1).map((n) => [n.name.split('=')[0], n.name.slice(n.name.indexOf('=') + 1)]));
			out.probes = probes;
			const open = Object.entries(probes).filter(([, v]) => v.startsWith('OPEN'));
			add('Nothing gets out of the box', open.length === 0 && Object.keys(probes).length > 10, open.length ? `open: ${open.map(([k]) => k).join(', ')}` : `${Object.keys(probes).length} ways out, every one refused`);

			const { objectAt } = await import('$lib/assets/index.js');
			for (const { label, name: n } of SAMPLES) {
				line = `Building ${label} in the box and in the page…`;
				try {
					// each built once first, so both are timed warm (their code loaded and compiled)
					await inBox(n);
					await objectAt(label);
					const b = await inBox(n);
					t0 = now();
					const direct = await objectAt(label);
					const pageMs = Math.round(now() - t0);
					// a skinned actor comes out in its rest pose (its bones come with phase 6), so only its triangles compare
					const skinned = b.data.stats.skinned > 0;
					const same = tris(direct) === tris(b.obj) && b.card.triangles === tris(direct) && (skinned || JSON.stringify(size(direct)) === JSON.stringify(size(b.obj)));
					const row = { label, name: n, tris: tris(b.obj), page: pageMs, ...b.ms, size: size(b.obj), same, custom: b.data.stats.custom, skinned: b.data.stats.skinned };
					out.assets.push(row);
					add(`${label} comes out the same`, same, `${short(n)} · ${row.tris.toLocaleString('en')} triangles, its card fits${skinned ? ' (skinned: in its rest pose until phase 6)' : ''} · box ${row.build} ms + ${row.serialize} ms out, ${row.box} ms in all · page ${pageMs} ms · rebuilt in ${row.rebuild} ms`);
					show(b.obj);
				} catch (e) {
					out.assets.push({ label, name: n, error: e.message });
					add(`${label} comes out the same`, false, e.message);
				}
			}

			line = 'A recipe that never stops…';
			t0 = now();
			let stopped = '';
			try {
				await box.build(checked(TRIALS.spin), undefined, { timeout: 2000 });
			} catch (e) {
				stopped = e.message;
			}
			const killMs = Math.round(now() - t0);
			let after = '';
			try {
				const again = await inBox(buildAt('things/bell-tent'));
				after = `a new box built the bell tent again (${again.data.stats.tris.toLocaleString('en')} triangles)`;
			} catch (e) {
				after = `no new box: ${e.message}`;
			}
			out.kill = { stopped, ms: killMs, after };
			add('A recipe that never stops is ended', !!stopped && after.startsWith('a new box'), `${stopped || 'never stopped'} after ${killMs} ms; ${after}`);

			line = 'A recipe whose bytes are not its name…';
			const real = await recipeAt(SAMPLES[2].name);
			const forged = { hash: real.hash, code: real.code.replace('module.exports.recipe(', 'module.exports.recipe(/* one byte more */ ') };
			let forgedSaid = '';
			try {
				checked(forged);
				forgedSaid = 'ACCEPTED';
			} catch (e) {
				forgedSaid = e.message;
			}
			out.forged = forgedSaid;
			const named = hashText(real.code) === real.hash;
			add('A recipe is only what its hash names', named && forgedSaid.startsWith('refused'), named && forgedSaid.startsWith('refused') ? `${Object.keys(INDEX.recipes).length} recipes of ours, each named by the BLAKE3 hash of its bytes; one changed by a comment is refused before the box sees it` : forgedSaid);

			line = 'Data out of shape…';
			const base = (await box.build(await recipeAt(SAMPLES[2].name))).data;
			for (const [what, spoil] of Object.entries(HOSTILE)) {
				const d = structuredClone(base);
				spoil(d);
				try {
					rebuild(d);
					out.hostile[what] = 'ACCEPTED';
				} catch (e) {
					out.hostile[what] = e.message;
				}
			}
			const taken = Object.entries(out.hostile).filter(([, v]) => v === 'ACCEPTED');
			add('Data out of shape is refused', taken.length === 0, taken.length ? `accepted: ${taken.map(([k]) => k).join(', ')}` : `${Object.keys(HOSTILE).length} kinds, every one refused`);

			line = 'Cards made to do harm…';
			const evil = hostileCards((await box.build(await recipeAt(SAMPLES[3].name))).card);
			out.cards = Object.fromEntries(Object.entries(evil).map(([what, card]) => [what, checkCard(card).ok ? 'ACCEPTED' : 'refused']));
			const let_in = Object.entries(out.cards).filter(([, v]) => v === 'ACCEPTED');
			add('A card made to do harm is refused', let_in.length === 0, let_in.length ? `accepted: ${let_in.map(([k]) => k).join(', ')}` : `${Object.keys(evil).length} kinds, every one refused`);

			// phase 2: what a recipe takes is its own, and what it made is kept on this device by its hash
			const apple = INDEX.recipes[SAMPLES[0].name.slice(0, 64)];
			const tries = { 'a stage past ripe': { stage: '12' }, 'a stage that is no number': { stage: 'x' }, 'a parameter it does not take': { colour: 'red' }, 'a seed too long': { seed: 'x'.repeat(200) } };
			const wrong = Object.entries(tries).filter(([, given]) => {
				try {
					valuesOf(apple.params, given);
					return true;
				} catch {
					return false;
				}
			});
			const ah = SAMPLES[0].name.slice(0, 64);
			const sorted = keyOf(`${ah}?stage=9&seed=maia`) === keyOf(`${ah}?seed=maia&stage=9`) && keyOf(ah) === keyOf(`${ah}?seed=maia&stage=9`) && keyOf(`${ah}?seed=isar&stage=9`) !== keyOf(`${ah}?seed=maia&stage=9`);
			add('A recipe’s parameters are its own', wrong.length === 0 && sorted, wrong.length ? `taken: ${wrong.map(([k]) => k).join(', ')}` : `the apple takes ${apple.params.map((x) => x.id).join(' and ')}; ${Object.keys(tries).length} wrong ones refused; the same values name the same build in any order or left at its own, another seed another`);

			out.cache = [];
			for (const { label, name: n } of SAMPLES) {
				line = `${label}: built cold, then from the cache…`;
				try {
					await cache.drop(keyOf(n));
					const cold = await loadAsset(n, { box });
					const kept = await cold.stored;
					// a page that never started a box: what it finds in the cache needs none
					const fresh = new AssetBox();
					const warm = await loadAsset(n, { box: fresh });
					const noBox = !fresh.frame && !fresh.ready;
					fresh.stop();
					const a = cache.fingerprint(await cache.pixelsOf(cold.data));
					const b = cache.fingerprint(await cache.pixelsOf(warm.data));
					const same = kept && warm.from === 'cache' && noBox && a === b && JSON.stringify(cold.card) === JSON.stringify(warm.card);
					const row = { label, name: n, cold: cold.ms.total, cached: warm.ms.total, read: warm.ms.read, rebuild: warm.ms.rebuild, kept, from: warm.from, noBox, same, bytes: cache.bytesOf(await cache.storable(cold.data)), raw: cache.bytesOf(cold.data) };
					out.cache.push(row);
					const x = row.cached ? (row.cold / row.cached).toFixed(1) : '∞';
					add(`${label} loads from the cache the same`, same, same ? `cold ${row.cold} ms in the box · cached ${row.cached} ms (read ${row.read} ms, rebuilt ${row.rebuild} ms), ${x}× faster, no box started · ${(row.bytes / 1048576).toFixed(1)} MB kept (${(row.raw / 1048576).toFixed(1)} MB in memory), bit for bit the same` : `kept ${kept}, from ${warm.from}, box started ${!noBox}, same data ${a === b}`);
					show(warm.obj);
				} catch (e) {
					out.cache.push({ label, name: n, error: e.message });
					add(`${label} loads from the cache the same`, false, e.message);
				}
			}

			line = 'A spoiled cache entry…';
			const tentName = SAMPLES[2].name;
			const tent = keyOf(tentName);
			const good = await loadAsset(tentName, { box });
			await good.stored;
			const spoilt = await cache.storable(good.data);
			const d = structuredClone(spoilt);
			d.geometries[0].attributes.position.array[0] = NaN;
			await cache.putRaw(tent, { data: d, card: good.card });
			const after1 = await loadAsset(tentName, { box });
			await after1.stored;
			await cache.putRaw(tent, { data: spoilt, card: { ...good.card, ref: 'javascript:alert(1)' } });
			const after2 = await loadAsset(tentName, { box });
			await after2.stored;
			const again = await loadAsset(tentName, { box });
			const refused = after1.from === 'box' && after2.from === 'box' && again.from === 'cache';
			out.spoiled = { data: after1.from, card: after2.from, after: again.from };
			add('A spoiled cache entry is refused and built again', refused, refused ? 'a position that is no number, then a card naming a script: each dropped, built in the box again, and kept right' : `loaded from ${after1.from} and ${after2.from}, then ${again.from}`);
			await count();
		} catch (e) {
			add('The checks ran', false, e.message);
		}
		results = out;
		still = false;
		line = checks.every((c) => c.ok) ? 'Every check passed.' : 'Some checks failed.';
		busy = false;
	}
</script>

<svelte:head><title>Asset box · maiaCITY</title></svelte:head>

<main class="lab">
	<header>
		<p class="kicker">Game Assets · phases 0 to 2b</p>
		<h1>The asset box</h1>
		<p class="lede">Our own assets built where an untrusted one would be: a worker in a frame with no origin, no network and no storage. The box runs a frozen engine, checked against its hash, and each recipe it is handed is named by the BLAKE3 hash of its bytes. The page only sees the plain data it hands back, checks it, and builds its own objects from it. Only the recipe is kept anywhere for good; what it built stays on this device, named by its hash, and is checked again each time it is read.</p>
	</header>

	<section class="bar">
		<button onclick={runAll} disabled={busy}>Run every check</button>
		<input bind:value={name} aria-label="A build: its recipe's hash, then ?its=values" list="builds" />
		<datalist id="builds">{#each SAMPLES as s}<option value={s.name}>{s.label}</option>{/each}</datalist>
		<button onclick={loadOne} disabled={busy}>Load</button>
		<button class="quiet" onclick={empty} disabled={busy}>Empty the cache</button>
	</section>
	<p class="line" data-line>{line}</p>
	{#if held}<p class="held">This device’s cache: {held}</p>{/if}

	<canvas bind:this={canvas}></canvas>

	{#if checks.length}
		<ul class="checks">
			{#each checks as c}
				<li class:bad={!c.ok}><b>{c.ok ? '✓' : '✗'} {c.name}</b><span>{c.note}</span></li>
			{/each}
		</ul>
	{/if}
	{#if probes}
		<details>
			<summary>Every way out, tried from inside the box</summary>
			<ul class="probes">{#each Object.entries(probes) as [k, v]}<li><b>{k}</b> {v}</li>{/each}</ul>
		</details>
	{/if}
	{#if results}<pre id="results" hidden>{JSON.stringify(results)}</pre>{/if}
</main>

<style>
	.lab { min-height: 100dvh; padding: 24px 16px 120px; max-width: 980px; margin: 0 auto; color: #ece6d8; background: #18201c; }
	.kicker { color: #e8a964; letter-spacing: 0.12em; text-transform: uppercase; font-size: 12px; margin: 0; }
	h1 { font-size: 34px; margin: 6px 0 8px; }
	.lede { color: #b9b3a6; margin: 0 0 18px; max-width: 70ch; }
	.bar { display: flex; flex-wrap: wrap; gap: 8px; }
	button, input { font: inherit; border-radius: 10px; border: 1px solid #3c4a42; background: #22302a; color: inherit; padding: 8px 12px; }
	button { background: #e8a964; color: #1b1712; border: 0; font-weight: 600; cursor: pointer; }
	button:disabled { opacity: 0.5; cursor: default; }
	input { flex: 1 1 200px; min-width: 0; }
	.quiet { background: #22302a; color: inherit; border: 1px solid #3c4a42; }
	.held { color: #8f9a91; font-size: 14px; margin: -6px 0 10px; }
	.line { min-height: 1.4em; color: #cfc8b9; }
	canvas { width: 100%; height: min(56vh, 520px); display: block; border-radius: 14px; background: #1d2420; }
	.checks { list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 6px; }
	.checks li { display: grid; gap: 2px; padding: 10px 12px; border-radius: 10px; background: #1f2a25; }
	.checks li.bad { background: #3a2222; }
	.checks span, .probes { color: #b9b3a6; font-size: 14px; }
	.probes { padding-left: 18px; }
</style>
