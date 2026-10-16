<!--
	THE LEVELS CHECK (/app/assets/render/levels/) — the gate of phase 5 of the asset pipeline: does each lower level of
	an asset read like its finest where it takes over? A sample of kinds (a machine of many parts, the biggest machine, a
	machine of many plain pieces, things, actors and two plants, or `?refs=a,b,…`), each drawn alone by the universal
	renderer (src/lib/assets/render) under the lab's sky at its afternoon hour: for each of its lower levels and its
	picture, the eye stands where that level takes over (the kind's size on screen at the threshold of the level before
	it, ./lod.js), and the kind is drawn there at its finest and at that level. The two are compared halved, each four
	pixels one, as a thing a step further off shows them: how much of their outline differs (the pixels covered by one
	and not the other, as a share of those covered by either) and how far their colours are where both cover; and again
	pooled four times coarser (`squinting`: the leaves of a crown, each a few pixels, read as the crown). Each pair is
	shown side by side; the numbers are in `#levels` and window.__levels. Drawn at the size of the window: the levels
	are made for a screen 1080 pixels high.
-->
<script>
	// @ts-nocheck — plain JS
	import { onDestroy, onMount } from 'svelte';
	import * as THREE from 'three';
	import { createSky, createStage, WorldBar } from '$lib/sandbox-kit';

	/** the kinds checked unless the address names others */
	const SAMPLE = ['machines/pickup', 'machines/lifetrac', 'machines/batterycube', 'things/bell-tent', 'things/dome-tent', 'things/chicken-coop', 'things/bistro-chair', 'actors/goat:goat-saanen', 'actors/stand-in', 'plants/walnut?stage=9', 'plants/apple@2?stage=9'];
	/**
	 * where the eye looks from: a little to the right of the front, a little above; and for a picture, also from one
	 * of the eight sides it was photographed from (between two, it shows the nearer: what eight sides cost)
	 */
	const YAW = THREE.MathUtils.degToRad(30), SIDE = THREE.MathUtils.degToRad(45), PITCH = THREE.MathUtils.degToRad(10);
	/** a pair shown no smaller than this (pixels high): a far one magnified, each pixel a square */
	const LEAST = 160;
	/** the background the outlines are told by: a colour no asset has */
	const KEY = new THREE.Color('#ff00ff');
	/** and the one the pairs are shown on */
	const GREY = new THREE.Color('#c9d1cf');

	let stage = $state();
	let line = $state('Starting the asset boxes');
	let rows = $state([]);
	let done = $state(null);
	let world, assets, destroyed = false;

	const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

	onMount(async () => {
		const q = new URLSearchParams(location.search);
		const refs = q.get('refs')?.split(',').filter(Boolean) ?? SAMPLE;
		const [{ createAssets }, lod] = await Promise.all([import('$lib/assets/render/index.js'), import('$lib/assets/render/lod.js')]);
		if (destroyed) return;
		world = createStage(stage, { maxPixelRatio: 1 });
		const { renderer, scene, camera } = world;
		const sky = createSky(renderer, scene, {});
		// the sky's dome and stars kept out of the pictures: its light stays
		for (const o of scene.children) if (o.isMesh || o.isPoints) o.visible = false;
		sky.tick(performance.now());
		// a first frame before any asset, as a world draws one: three swaps the stage's soft shadows for plain ones at
		// its first shadow pass and makes again only the shaders then in the scene, so one made before would sample
		// the shadows wrongly and draw nothing
		renderer.shadowMap.needsUpdate = true;
		renderer.render(scene, camera);
		assets = createAssets({ renderer, camera });
		scene.add(assets.group);
		window.__assets = assets;
		const W = renderer.domElement.width, H = renderer.domElement.height;
		const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
		const flat = document.createElement('canvas');
		flat.width = W;
		flat.height = H;
		const ctx = flat.getContext('2d', { willReadFrequently: true });

		/** the scene drawn with every copy at level L, on a background, read back */
		function shot(L, background) {
			assets.force(L);
			scene.background = background;
			assets.update();
			renderer.render(scene, camera);
			ctx.drawImage(renderer.domElement, 0, 0);
			return ctx.getImageData(0, 0, W, H);
		}

		/** an image halved: each 2 × 2 pixels one, with how much of it the asset covers (not the key colour) */
		function halved(img) {
			const w = W >> 1, h = H >> 1;
			const cover = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
			const kr = KEY.r * 255, kg = KEY.g * 255, kb = KEY.b * 255;
			for (let y = 0; y < h; y++)
				for (let x = 0; x < w; x++) {
					const o = y * w + x;
					for (let dy = 0; dy < 2; dy++)
						for (let dx = 0; dx < 2; dx++) {
							const p = ((y * 2 + dy) * W + x * 2 + dx) * 4, D = img.data;
							const off = Math.abs(D[p] - kr) + Math.abs(D[p + 1] - kg) + Math.abs(D[p + 2] - kb) > 60;
							cover[o] += off ? 0.25 : 0;
							rgb[o * 3] += D[p] / 4;
							rgb[o * 3 + 1] += D[p + 1] / 4;
							rgb[o * 3 + 2] += D[p + 2] / 4;
						}
				}
			return { w, h, cover, rgb };
		}

		/**
		 * a halved shot pooled again, each f × f of its pixels one: as a thing a few steps further off shows it, or as an
		 * eye squinting at it reads it (a crown's leaves, each a few pixels, become the crown)
		 */
		function pooled(img, f) {
			const w = Math.floor(img.w / f), h = Math.floor(img.h / f), n = f * f;
			const cover = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
			for (let y = 0; y < h; y++)
				for (let x = 0; x < w; x++) {
					const o = y * w + x;
					for (let dy = 0; dy < f; dy++)
						for (let dx = 0; dx < f; dx++) {
							const p = (y * f + dy) * img.w + x * f + dx;
							cover[o] += img.cover[p] / n;
							for (let c = 0; c < 3; c++) rgb[o * 3 + c] += img.rgb[p * 3 + c] / n;
						}
				}
			return { w, h, cover, rgb };
		}

		/** how alike two halved shots read: their outlines' difference, their colours' where both cover, and where */
		function compare(a, b) {
			let diff = 0, either = 0, colour = 0, both = 0;
			let x0 = a.w, y0 = a.h, x1 = -1, y1 = -1;
			for (let i = 0; i < a.cover.length; i++) {
				const ca = a.cover[i], cb = b.cover[i];
				diff += Math.abs(ca - cb);
				either += Math.max(ca, cb);
				if (Math.max(ca, cb) > 0) {
					const x = i % a.w, y = Math.floor(i / a.w);
					x0 = Math.min(x0, x);
					x1 = Math.max(x1, x);
					y0 = Math.min(y0, y);
					y1 = Math.max(y1, y);
				}
				if (Math.min(ca, cb) >= 1) {
					colour += (Math.abs(a.rgb[i * 3] - b.rgb[i * 3]) + Math.abs(a.rgb[i * 3 + 1] - b.rgb[i * 3 + 1]) + Math.abs(a.rgb[i * 3 + 2] - b.rgb[i * 3 + 2])) / 3;
					both++;
				}
			}
			// no pixel covered by both (a picture far off, pooled): no colours to compare
			return { outline: either ? diff / either : 0, colour: both ? colour / both : null, covered: either, box: [x0 * 2, y0 * 2, (x1 + 1) * 2, (y1 + 1) * 2] };
		}

		/** the two shots side by side, cropped to where either covers, halved */
		function pair(a, b, box) {
			const pad = 12, gap = 8;
			const x0 = Math.max(0, box[0] - pad), y0 = Math.max(0, box[1] - pad), x1 = Math.min(W, box[2] + pad), y1 = Math.min(H, box[3] + pad);
			const zoom = Math.max(1, Math.ceil(LEAST / ((y1 - y0) / 2)));
			const w = Math.max(1, Math.round((x1 - x0) / 2)) * zoom, h = Math.max(1, Math.round((y1 - y0) / 2)) * zoom;
			const out = document.createElement('canvas');
			out.width = w * 2 + gap;
			out.height = h;
			const o = out.getContext('2d');
			o.imageSmoothingEnabled = zoom === 1;
			o.fillStyle = '#ffffff';
			o.fillRect(0, 0, out.width, out.height);
			[a, b].forEach((img, k) => {
				ctx.putImageData(img, 0, 0);
				if (zoom === 1) o.drawImage(flat, x0, y0, x1 - x0, y1 - y0, k * (w + gap), 0, w, h);
				else {
					// halved first, as compared, then each of its pixels a square
					const half = document.createElement('canvas');
					half.width = w / zoom;
					half.height = h / zoom;
					half.getContext('2d').drawImage(flat, x0, y0, x1 - x0, y1 - y0, 0, 0, half.width, half.height);
					o.drawImage(half, 0, 0, half.width, half.height, k * (w + gap), 0, w, h);
				}
			});
			return out.toDataURL('image/png');
		}

		const out = [];
		for (const ref of refs) {
			if (destroyed) return;
			line = `Building ${ref}`;
			const k = assets.use(ref);
			const copy = assets.place(k, { x: 0, z: 0 });
			await k.ready;
			if (!k.ok) {
				out.push({ ref, error: k.error });
				assets.remove(copy);
				continue;
			}
			// every level of it asked for (the finer ones of a plant only come when a copy wants them) and come
			camera.position.set(k.center.x, k.center.y, k.center.z + k.radius * 3);
			camera.lookAt(k.center);
			for (let L = 0; L < k.levels.length; L++) {
				assets.force(L);
				assets.update();
			}
			for (let t = 0; t < 600 && (k.levels.some((l) => l.state === 'loading' || l.state === 'idle') || assets.stats().building); t++) await wait(500);
			line = `Comparing the levels of ${ref}`;
			const levels = [];
			/** level L beside level 0, the eye `d` metres off from the side `yaw` */
			const against = (L, d, yaw) => {
				camera.position.set(k.center.x + Math.sin(yaw) * Math.cos(PITCH) * d, k.center.y + Math.sin(PITCH) * d, k.center.z + Math.cos(yaw) * Math.cos(PITCH) * d);
				camera.lookAt(k.center);
				camera.updateMatrixWorld();
				// a frame or two first, for the shadows of each
				for (const j of [0, L]) shot(j, KEY);
				const a = halved(shot(0, KEY)), b = halved(shot(L, KEY));
				const c = compare(a, b), far = compare(pooled(a, 4), pooled(b, 4));
				return { outline: +c.outline.toFixed(4), colour: two(c.colour), covered: Math.round(c.covered), squinting: { outline: +far.outline.toFixed(4), colour: two(far.colour) }, image: pair(shot(0, GREY), shot(L, GREY), c.box) };
			};
			for (let L = 1; L <= k.levels.length; L++) {
				// where level L takes over: the kind as big on the screen as the threshold of the level before it
				const size = k.thresholds[L - 1];
				const d = k.radius / (size * tanHalf);
				const lv = k.levels[L];
				const picture = L === k.levels.length;
				levels.push({ L, what: picture ? 'its picture' : lv.from === 'made' ? (lv.as >= 0 ? 'as level 0' : 'simplified') : lv.level.made ? 'its recipe at a lower detail, simplified under its ceiling' : 'its recipe at a lower detail', size: +size.toFixed(4), distance: +d.toFixed(2), tris: picture ? 2 : lv.level.tris, ...against(L, d, YAW), ...(picture && { side: against(L, d, SIDE) }) });
			}
			assets.force(null);
			assets.remove(copy);
			const row = { ref, label: k.label, radius: +k.radius.toFixed(3), tris: k.levels.map((l) => l.level?.tris ?? null), thresholds: k.thresholds.map((t) => +t.toFixed(4)), made: k.levels.map((l) => l.level?.made ?? null), levels };
			out.push(row);
			rows = [...out];
		}
		done = { screen: { width: W, height: H }, made: lod.SCREEN, yaw: 30, pitch: 10, kinds: out };
		window.__levels = done;
		line = `${out.length} kinds compared`;
		document.body.dataset.ready = '1';
	});

	onDestroy(() => {
		destroyed = true;
		assets?.dispose();
		world?.dispose?.();
		delete window.__assets;
		delete window.__levels;
	});

	const pct = (x) => `${(x * 100).toFixed(1)} %`;
	const two = (x) => (x === null ? null : +x.toFixed(2));
	const one = (x) => (x === null ? '–' : x.toFixed(1));
	/** a level's numbers without its pictures */
	const bare = ({ image, side, ...l }) => ({ ...l, ...(side && { side: { outline: side.outline, colour: side.colour, covered: side.covered, squinting: side.squinting } }) });
</script>

<svelte:head>
	<title>Levels check · maiaCITY</title>
	<meta name="description" content="Each lower level of detail of an asset, and its picture, drawn where it takes over beside the asset at its finest, and how alike they read." />
</svelte:head>

<div class="check">
	<div class="stage" bind:this={stage} aria-hidden="true"></div>
	<WorldBar title="Levels check" subtitle="each level where it takes over" />
	<aside class="panel" aria-label="How alike each level reads">
		<p class="line">{line}</p>
		{#each rows as r (r.ref)}
			<section>
				<h2>{r.label ?? r.ref}</h2>
				{#if r.error}
					<p class="failed">{r.error}</p>
				{:else}
					<table>
						<thead><tr><th>Level</th><th>triangles</th><th>outline</th><th>colour</th><th>squinting</th></tr></thead>
						<tbody>
							<tr><td>0</td><td>{r.tris[0]?.toLocaleString('en')}</td><td></td><td></td><td></td></tr>
							{#each r.levels as l (l.L)}
								<tr><td>{l.L < r.tris.length ? l.L : 'picture'}</td><td>{l.tris.toLocaleString('en')}</td><td>{pct(l.outline)}</td><td>{one(l.colour)}</td><td>{pct(l.squinting.outline)}, {one(l.squinting.colour)}</td></tr>
								{#if l.side}
									<tr class="side"><td>from a side</td><td></td><td>{pct(l.side.outline)}</td><td>{one(l.side.colour)}</td><td>{pct(l.side.squinting.outline)}, {one(l.side.squinting.colour)}</td></tr>
								{/if}
							{/each}
						</tbody>
					</table>
				{/if}
			</section>
		{/each}
		{#if done}
			<pre id="levels" hidden>{JSON.stringify({ ...done, kinds: done.kinds.map((k) => ({ ...k, levels: k.levels?.map(bare) })) })}</pre>
		{/if}
	</aside>
</div>

<style>
	.check {
		position: fixed;
		inset: 0;
		background: #1f2a23;
	}
	.stage {
		position: absolute;
		inset: 0;
	}
	.panel {
		position: absolute;
		top: calc(max(0.75rem, env(safe-area-inset-top, 0px)) + 3.6rem);
		right: 0.75rem;
		z-index: 3;
		width: min(20rem, calc(100vw - 1.5rem));
		max-height: calc(100vh - 6rem);
		overflow: auto;
		box-sizing: border-box;
		padding: 0.75rem 0.85rem;
		border-radius: 14px;
		background: rgb(250 248 242 / 0.9);
		color: #1f2a23;
		font-size: 0.8rem;
	}
	.line {
		margin: 0 0 0.4rem;
		opacity: 0.75;
	}
	h2 {
		margin: 0.6rem 0 0.2rem;
		font-size: 0.8rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.1rem 0.2rem;
		text-align: right;
	}
	th:first-child,
	td:first-child {
		text-align: left;
	}
	.failed {
		color: #8a2a1a;
	}
	.side td {
		opacity: 0.6;
	}
</style>
