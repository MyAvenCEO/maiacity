<!--
	THE ASSET BOX'S LAB (/app/assets/box/) — phase 0 of the asset pipeline (src/lib/assets/box): our own assets built
	inside the box, a worker in a frame with no origin, and shown from the plain data it hands back, as an asset no one
	trusts would be. One button runs every check: what the box cannot reach, assets built in the box against the same
	built in the page, a builder that never stops, and data out of shape that the page must refuse.
-->
<script>
	// @ts-nocheck — plain JS
	import { onDestroy, onMount } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { AssetBox } from '$lib/assets/box/host.js';
	import { rebuild } from '$lib/assets/box/rebuild.js';
	import { FORMAT } from '$lib/assets/box/serialize.js';

	const SAMPLES = [
		['plants/apple', [9, 'maia']],
		['plants/jackfruit', [9, 'maia']],
		['things/bell-tent', []],
		['machines/powercube@3', []],
		['actors/stand-in', []]
	];

	let box = new AssetBox();
	let canvas = $state();
	let ref = $state('plants/apple');
	let args = $state('[9, "maia"]');
	let busy = $state(false);
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
	const tris = (obj) => {
		let n = 0;
		obj.traverse((o) => {
			if (o.isMesh && !o.isLine && !o.isPoints && o.geometry) n += ((o.geometry.index?.count ?? o.geometry.attributes.position?.count ?? 0) / 3) * (o.isInstancedMesh ? o.count : 1);
		});
		return Math.round(n);
	};
	const size = (obj) => new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).toArray().map((x) => Math.round(x * 1000) / 1000);

	/** one asset built in the box and shown from its data, with its times */
	async function inBox(r, a) {
		const t0 = now();
		const got = await box.build(r, a);
		const t1 = now();
		const obj = rebuild(got.data);
		const t2 = now();
		return { obj, data: got.data, ms: { build: got.ms.build, serialize: got.ms.serialize, total: Math.round(t1 - t0), rebuild: Math.round(t2 - t1) } };
	}

	async function buildOne() {
		busy = true;
		line = `Building ${ref} in the box…`;
		try {
			const r = await inBox(ref, JSON.parse(args || '[]'));
			show(r.obj);
			line = `${ref}: ${r.data.stats.tris.toLocaleString('en')} triangles, built in ${r.ms.build} ms in the box, ${r.ms.total} ms to the page, rebuilt in ${r.ms.rebuild} ms` + (r.data.stats.custom ? `, ${r.data.stats.custom} materials with their own shader drawn plain` : '');
		} catch (e) {
			line = `${ref}: ${e.message}`;
		}
		busy = false;
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
		const out = { userAgent: navigator.userAgent, assets: [], probes: null, kill: null, hostile: {} };
		try {
			let t0 = now();
			await box.start();
			out.start = Math.round(now() - t0);
			add('The box starts', true, `${out.start} ms, its code handed in whole`);

			line = 'Trying every way out of the box…';
			probes = (await box.ask('probe')).data;
			out.probes = probes;
			const open = Object.entries(probes).filter(([, v]) => v.startsWith('OPEN'));
			add('Nothing gets out of the box', open.length === 0, open.length ? `open: ${open.map(([k]) => k).join(', ')}` : `${Object.keys(probes).length} ways out, every one refused`);

			const { objectAt } = await import('$lib/assets/index.js');
			for (const [r, a] of SAMPLES) {
				line = `Building ${r} in the box and in the page…`;
				try {
					// each built once first, so both are timed warm (their code loaded and compiled)
					await inBox(r, a);
					await objectAt(r, ...a);
					const b = await inBox(r, a);
					t0 = now();
					const direct = await objectAt(r, ...a);
					const pageMs = Math.round(now() - t0);
					const same = tris(direct) === tris(b.obj) && JSON.stringify(size(direct)) === JSON.stringify(size(b.obj));
					const row = { ref: r, tris: tris(b.obj), page: pageMs, ...b.ms, size: size(b.obj), same, custom: b.data.stats.custom, skinned: b.data.stats.skinned };
					out.assets.push(row);
					add(`${r} comes out the same`, same, `${row.tris.toLocaleString('en')} triangles · box ${row.build} ms + ${row.serialize} ms out, ${row.total} ms in all · page ${pageMs} ms · rebuilt in ${row.rebuild} ms`);
					show(b.obj);
				} catch (e) {
					out.assets.push({ ref: r, error: e.message });
					add(`${r} comes out the same`, false, e.message);
				}
			}

			line = 'A builder that never stops…';
			t0 = now();
			let stopped = '';
			try {
				await box.ask('spin', {}, { timeout: 2000 });
			} catch (e) {
				stopped = e.message;
			}
			const killMs = Math.round(now() - t0);
			let after = '';
			try {
				const again = await inBox('things/bell-tent', []);
				after = `a new box built the bell tent again (${again.data.stats.tris.toLocaleString('en')} triangles)`;
			} catch (e) {
				after = `no new box: ${e.message}`;
			}
			out.kill = { stopped, ms: killMs, after };
			add('A builder that never stops is ended', !!stopped && after.startsWith('a new box'), `${stopped || 'never stopped'} after ${killMs} ms; ${after}`);

			line = 'Data out of shape…';
			const base = (await box.build('things/bell-tent', [])).data;
			for (const [name, spoil] of Object.entries(HOSTILE)) {
				const d = structuredClone(base);
				spoil(d);
				try {
					rebuild(d);
					out.hostile[name] = 'ACCEPTED';
				} catch (e) {
					out.hostile[name] = e.message;
				}
			}
			const taken = Object.entries(out.hostile).filter(([, v]) => v === 'ACCEPTED');
			add('Data out of shape is refused', taken.length === 0, taken.length ? `accepted: ${taken.map(([k]) => k).join(', ')}` : `${Object.keys(HOSTILE).length} kinds, every one refused`);
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
		<p class="kicker">Game Assets · phase 0</p>
		<h1>The asset box</h1>
		<p class="lede">Our own assets built where an untrusted one would be: a worker in a frame with no origin, no network and no storage. The page only sees the plain data it hands back, checks it, and builds its own objects from it.</p>
	</header>

	<section class="bar">
		<button onclick={runAll} disabled={busy}>Run every check</button>
		<input bind:value={ref} aria-label="Asset ref" list="refs" />
		<datalist id="refs">{#each SAMPLES as [r]}<option value={r}></option>{/each}</datalist>
		<input bind:value={args} aria-label="Builder arguments (JSON)" class="args" />
		<button onclick={buildOne} disabled={busy}>Build in the box</button>
	</section>
	<p class="line" data-line>{line}</p>

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
	.args { flex: 0 1 140px; }
	.line { min-height: 1.4em; color: #cfc8b9; }
	canvas { width: 100%; height: min(56vh, 520px); display: block; border-radius: 14px; background: #1d2420; }
	.checks { list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 6px; }
	.checks li { display: grid; gap: 2px; padding: 10px 12px; border-radius: 10px; background: #1f2a25; }
	.checks li.bad { background: #3a2222; }
	.checks span, .probes { color: #b9b3a6; font-size: 14px; }
	.probes { padding-left: 18px; }
</style>
