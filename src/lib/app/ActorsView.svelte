<!--
	A turntable of rigged kinds (src/lib/actors): the Actors (/app/actors/: the stand-in a shot is blocked with and the
	animals of the worlds) and the Machines (/app/machines/: the excavators, the pod, the LifeTrac, the cubes …) both
	show theirs with it — kind by kind down the left (the chickens, the rabbits, the goats …), the kind's variants (its
	breeds, the rooster and the chick) to switch between on the right, one at a time on a turntable, playing its moves.
	The stand-in also holds its poses, and any joint of it can be turned by hand (the pose copied out as data). A machine
	taken apart (one with a catalog of its parts: the LifeTrac) has every part to pick, on it or from its list, each with
	its card: what it is, what moves it, its numbers — shown alone if asked, the rest of the machine a ghost round it.
	Drag to turn round it, scroll to come closer. An admin's.
-->
<script>
	import { onDestroy, onMount, untrack } from 'svelte';
	import Turntable from '$lib/app/Turntable.svelte';
	import { fit } from '$lib/app/turntable.js';
	import { atOrLatest } from '$lib/app/versions.js';

	/** @typedef {import('$lib/actors').Actor} Actor */
	/** @typedef {import('$lib/actors').Family} Family */
	/** @typedef {import('$lib/actors/rig').Cast} Cast */
	/** @typedef {import('$lib/actors/rig').Pose} Pose */
	/** @typedef {import('$lib/actors/rig').V3} V3 */

	/** @type {{ name: string, title: string, lede: string, families: Family[] }} */
	let { name, title, lede, families } = $props();
	/** the first kind, shown first (a page hands its list once) */
	const first = untrack(() => families[0]);

	/** @type {HTMLDivElement | undefined} */
	let canvasBox = $state();
	/** the kind chosen on the left, and which of its variants is on the turntable */
	/** @type {Family} */
	let chosen = $state(first);
	/** @type {Actor} */
	let variant = $state(first.variants[0]);
	/** the version of the kind shown (its latest, or one picked from its history), and the variants it had */
	let version = $state(first.version);
	const variants = $derived(atOrLatest(chosen.versions, version).build);
	let cast = $state.raw(/** @type {Cast | null} */ (null));
	/** what it does: a move it plays, or a pose it holds */
	/** @type {{ kind: 'clip' | 'pose', name: string }} */
	let doing = $state({ kind: 'clip', name: '' });
	/** the joints turned by hand, over the pose it holds */
	/** @type {Record<string, V3>} */
	let edits = $state({});
	let joint = $state('head');
	/** @type {[number, number, number] | null} */
	let size = $state(null);
	let copied = $state(false);
	/** a machine's part picked (by its id), and whether it is shown alone, the rest a ghost */
	/** @type {string | null} */
	let picked = $state(null);
	let alone = $state(false);
	/** @type {((id: string) => void) | null} */
	let lookAt = null;
	const catalog = $derived(cast?.catalog ?? null);
	const card = $derived(catalog && picked ? catalog.parts.find((p) => p.id === picked) ?? null : null);
	/** @type {((a: Actor) => void) | null} */
	let show = null;
	/** @type {(() => void) | null} */
	let dispose = null;

	const holding = $derived(doing.kind === 'pose' && cast?.poses ? { ...cast.poses[doing.name], ...edits } : null);

	onMount(async () => {
		const THREE = await import('three');
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		const box = /** @type {HTMLDivElement} */ (canvasBox);
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		box.appendChild(renderer.domElement);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#e9e6e0');
		const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
		camera.userData.fov = 40; // widened on an upright canvas ($lib/app/turntable.js)
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.2));
		const key = new THREE.DirectionalLight('#fff4e6', 2.2);
		key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048);
		scene.add(key, key.target);
		const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.22 }));
		floor.rotation.x = -Math.PI / 2;
		floor.receiveShadow = true;
		scene.add(floor);
		/** @type {InstanceType<typeof THREE.Group> | null} */
		let grid = null;
		// a machine's parts: lit up when picked, and the rest a ghost when it is shown alone (the materials the mesh's
		// groups take then, after its own)
		const lit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: '#ff7a1a', emissiveIntensity: 0.55, side: THREE.DoubleSide });
		const ghost = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
		/** @type {number[]} */
		let own = [];
		paint = () => {
			const c = cast;
			if (!c?.rig.parts) return;
			const mesh = c.rig.object, mats = /** @type {import('three').Material[]} */ (mesh.material);
			const at = mats.indexOf(lit);
			mesh.geometry.groups.forEach((g, i) => {
				const part = c.rig.parts?.[i];
				g.materialIndex = picked && part === picked ? at : picked && alone ? at + 1 : own[i];
			});
		};
		const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
		/** the part under a point of the canvas, if any @param {PointerEvent} e */
		const partAt = (e) => {
			const c = cast;
			if (!c?.rig.parts) return null;
			const r = renderer.domElement.getBoundingClientRect();
			ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
			ray.setFromCamera(ndc, camera);
			c.rig.object.computeBoundingSphere(); // as it is posed now
			const groups = c.rig.object.geometry.groups;
			for (const hit of ray.intersectObject(c.rig.object, false)) {
				const at = (hit.faceIndex ?? 0) * 3;
				const i = groups.findIndex((g) => at >= g.start && at < g.start + g.count);
				const part = c.rig.parts[i];
				// shown alone, the ghosts are looked through
				if (part && (!alone || !picked || part === picked)) return part;
			}
			return null;
		};
		/** @type {{ x: number, y: number } | null} */
		let down = null;
		renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
		renderer.domElement.addEventListener('pointerup', (e) => {
			// a tap, not a drag round it, picks the part under it (or, on nothing, lets go)
			if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || !cast?.catalog) return;
			down = null;
			const part = partAt(e);
			picked = part;
			if (part) lookAt?.(part);
			else alone = false;
		});
		/** @type {import('three').Vector3 | null} */
		let aim = null;
		lookAt = (id) => {
			const bone = cast?.rig.bones[`p.${id}`];
			if (bone) aim = bone.getWorldPosition(new THREE.Vector3());
		};

		show = async (a) => {
			// an animal's skin is meshed off the page first; picked away from meanwhile, it is not shown
			await a.ready?.();
			if (variant.id !== a.id) return;
			if (cast) scene.remove(cast.rig.object);
			if (grid) scene.remove(grid);
			const c = a.make();
			cast = c;
			edits = {};
			picked = null;
			alone = false;
			if (c.catalog) {
				const mesh = c.rig.object;
				own = mesh.geometry.groups.map((g) => g.materialIndex ?? 0);
				mesh.material = [.../** @type {import('three').Material[]} */ (mesh.material), lit, ghost];
			}
			doing = { kind: 'clip', name: c.first in c.clips ? c.first : Object.keys(c.clips)[0] };
			if (c.poses && c.first in c.poses) doing = { kind: 'pose', name: c.first };
			joint = c.rig.names.includes('head') ? 'head' : c.rig.names[0];
			scene.add(c.rig.object);
			// framed on its rest pose, with room round it to move
			const b = new THREE.Box3().setFromObject(c.rig.object);
			const s = b.getSize(new THREE.Vector3());
			size = [s.x, s.y, s.z];
			const reach = Math.max(s.x, s.y, s.z) * 1.15;
			const span = Math.max(0.2, Math.ceil((Math.max(s.x, s.z) + reach) * 20) / 10);
			grid = new THREE.Group();
			grid.add(new THREE.GridHelper(span, Math.max(2, Math.round(span * (reach < 0.1 ? 100 : 10))), '#cfc9bf', '#cfc9bf'));
			grid.position.y = 0.0005;
			scene.add(grid);
			const mid = b.getCenter(new THREE.Vector3());
			controls.target.copy(mid);
			camera.position.set(mid.x + reach * 1.5, mid.y + reach * 0.6, mid.z + reach * 1.9);
			camera.near = reach / 300;
			camera.far = reach * 80;
			camera.updateProjectionMatrix();
			key.position.set(mid.x + reach * 2, mid.y + reach * 3, mid.z + reach * 1.5);
			key.target.position.copy(mid);
			const sh = key.shadow.camera;
			sh.left = sh.bottom = -reach * 1.6;
			sh.right = sh.top = reach * 1.6;
			sh.near = reach * 0.05;
			sh.far = reach * 10;
			sh.updateProjectionMatrix();
			key.shadow.normalBias = reach * 0.004; // a texel or two: no shadow acne on big flat faces (a machine's plates)
		};
		const resize = () => {
			const w = box.clientWidth, h = box.clientHeight;
			renderer.setSize(w, h);
			fit(camera, w, h);
		};
		const ro = new ResizeObserver(resize);
		ro.observe(box);
		resize();
		show(variant);
		let frame = 0;
		const start = performance.now();
		const tick = () => {
			const t = (performance.now() - start) / 1000;
			if (cast) {
				if (doing.kind === 'clip') cast.rig.pose(cast.clips[doing.name]?.(t) ?? {});
				else if (holding) cast.rig.pose(/** @type {Pose} */ (holding));
			}
			// on to a part looked at, the camera's aim moving over to it
			if (aim) {
				controls.target.lerp(aim, 0.12);
				if (controls.target.distanceTo(aim) < 0.002) aim = null;
			}
			controls.update();
			renderer.render(scene, camera);
			frame = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(frame);
			ro.disconnect();
			controls.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		};
	});
	onDestroy(() => dispose?.());

	/** @type {() => void} */
	let paint = () => {};
	$effect(() => {
		void [picked, alone, cast];
		paint();
	});
	/** @param {string} id */
	const choose = (id) => {
		picked = picked === id ? null : id;
		if (picked) lookAt?.(picked);
	};

	/** @param {Family} f */
	const pick = (f) => {
		chosen = f;
		version = f.version;
		vary(f.variants[0]);
	};
	/** @param {number} v */
	const pickVersion = (v) => {
		version = v;
		vary(atOrLatest(chosen.versions, v).build[0]);
	};
	/** @param {Actor} a */
	const vary = (a) => {
		variant = a;
		show?.(a);
	};
	/** @param {string} name */
	const play = (name) => (doing = { kind: 'clip', name });
	/** @param {string} name */
	const hold = (name) => {
		doing = { kind: 'pose', name };
		edits = {};
	};
	/** a joint's turn now: what the hand gave it, else the pose's */
	/** @param {string} bone @returns {V3} */
	const turnOf = (bone) => edits[bone] ?? /** @type {V3 | undefined} */ (/** @type {number[] | undefined} */ (holding?.[bone])?.slice(0, 3)) ?? [0, 0, 0];
	/** @param {0 | 1 | 2} axis @param {number} value */
	const turn = (axis, value) => {
		const t = /** @type {V3} */ ([...turnOf(joint)]);
		t[axis] = value;
		edits = { ...edits, [joint]: t };
	};
	const copy = async () => {
		if (!holding) return;
		const rounded = Object.fromEntries(Object.entries(holding).map(([k, v]) => [k, /** @type {number[]} */ (v).map((x) => Math.round(x * 1000) / 1000)]));
		await navigator.clipboard.writeText(JSON.stringify(rounded));
		copied = true;
		setTimeout(() => (copied = false), 1500);
	};
	/** @param {number} v */
	const measure = (v) => (v < 0.1 ? `${Math.round(v * 1000)} mm` : `${Math.round(v * 100)} cm`);
</script>

<svelte:head>
	<title>{title} · maiaCITY</title>
</svelte:head>

<Turntable
	{name}
	bind:canvas={canvasBox}
	picks={{ title, lede, items: families, chosen, where: (/** @type {Family} */ f) => `${f.variants.length > 1 ? `${f.variants.length} · ` : ''}${f.from}`, onpick: pick, version, onversion: pickVersion }}
>
	{#snippet bar()}
		{#if cast}
			<div class="chips">
				<span class="label">Moves</span>
				{#each Object.keys(cast.clips) as name (name)}
					<button class="chip" class:on={doing.kind === 'clip' && doing.name === name} onclick={() => play(name)}>{name}</button>
				{/each}
				{#if cast.poses}
					<span class="label">Poses</span>
					{#each Object.keys(cast.poses) as name (name)}
						<button class="chip" class:on={doing.kind === 'pose' && doing.name === name} onclick={() => hold(name)}>{name}</button>
					{/each}
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet panel()}
		{#if variants.length > 1}
			<nav class="chips variants" aria-label="{chosen.label}: variants">
				<span class="label">{chosen.label}</span>
				{#each variants as v (v.id)}
					<button class="chip" class:on={variant.id === v.id} aria-current={variant.id === v.id ? 'true' : undefined} onclick={() => vary(v)}>{v.label}</button>
				{/each}
			</nav>
		{/if}
		{#if catalog}
			<div class="parts">
				<div class="row head">
					<span class="label">{catalog.parts.length} parts</span>
					<button class="chip" class:on={alone} disabled={!picked} onclick={() => (alone = !alone)}>Alone</button>
				</div>
				{#each catalog.assemblies as a (a.id)}
					{@const list = catalog.parts.filter((p) => p.assembly === a.id)}
					<details open={!!picked && list.some((p) => p.id === picked)}>
						<summary><b>{a.label}</b> <small>{list.length}</small></summary>
						<p class="note">{a.note}</p>
						<ul>
							{#each list as p (p.id)}
								<li><button class:on={picked === p.id} onclick={() => choose(p.id)}>{p.label}{#if p.count && p.count > 1}<small> ×{p.count}</small>{/if}{#if p.moves}<i title="moves">↻</i>{/if}</button></li>
							{/each}
						</ul>
					</details>
				{/each}
				<details>
					<summary><b>Sources</b> <small>{catalog.sources.length}</small></summary>
					<ul class="sources">
						{#each catalog.sources as s (s.url)}<li><a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a></li>{/each}
					</ul>
				</details>
			</div>
		{/if}
		{#if cast && holding && !catalog}
			<div class="joints">
				<label>
					<span>Joint</span>
					<select bind:value={joint}>
						{#each cast.rig.names as name (name)}<option value={name}>{name}</option>{/each}
					</select>
				</label>
				{#each ['x', 'y', 'z'] as axis, i (axis)}
					<label>
						<span>{axis}</span>
						<input type="range" min={-Math.PI} max={Math.PI} step="0.01" value={turnOf(joint)[i]} oninput={(e) => turn(/** @type {0 | 1 | 2} */ (i), +e.currentTarget.value)} />
						<output>{Math.round((turnOf(joint)[i] * 180) / Math.PI)}°</output>
					</label>
				{/each}
				<div class="row">
					<button class="chip" onclick={() => (edits = {})}>Reset</button>
					<button class="chip" onclick={copy}>{copied ? 'Copied' : 'Copy pose'}</button>
				</div>
			</div>
		{/if}
	{/snippet}
	{#snippet readout()}
		{#if card && catalog}
			{@const a = catalog.assemblies.find((x) => x.id === card.assembly)}
			<div class="part-card">
				<span class="label">{a?.label} · step {card.step} of {catalog.steps.length}</span>
				<b>{card.label}{#if card.count && card.count > 1}<small> ×{card.count}</small>{/if}</b>
				<p>{card.what}</p>
				{#if card.moves}<p><span class="tag">Moves</span> {card.moves}</p>{/if}
				{#if card.drive}<p><span class="tag">Driven by</span> {card.drive}</p>{/if}
				{#if card.specs?.length}
					<dl>
						{#each card.specs as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
					</dl>
				{/if}
				<small>Build step {card.step}: {catalog.steps[card.step - 1]}{#if card.source} · source: {#each catalog.sources.filter((s) => s.label === card.source) as s (s.url)}<a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>{:else}{card.source}{/each}{/if}</small>
				<div class="row">
					<button class="chip" onclick={() => lookAt?.(card.id)}>Look at it</button>
					<button class="chip" class:on={alone} onclick={() => (alone = !alone)}>Alone</button>
					<button class="chip" onclick={() => ((picked = null), (alone = false))}>Close</button>
				</div>
			</div>
		{:else}
		<b>{variants.length > 1 ? `${chosen.label} · ${variant.label}` : chosen.label}</b>
		{#if variants.length > 1}<small>{variant.note}</small>{/if}
		{#if size && cast}<span>{measure(Math.max(size[0], size[2]))} long · {measure(size[1])} high · {cast.rig.names.length} bones</span>{/if}
		<small>Drag to turn round it · pinch or scroll to come closer{catalog ? ' · tap any part for its card' : doing.kind === 'pose' ? ' · turn any joint by hand' : ''}</small>
		{/if}
	{/snippet}
</Turntable>

<style>
	.variants + .joints,
	.variants + .parts {
		margin-top: 0.8rem;
	}

	.parts details {
		border-top: 1px solid rgb(0 0 0 / 0.08);
		padding: 0.3rem 0;
	}

	.parts summary {
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.parts summary small,
	.parts li small {
		opacity: 0.55;
	}

	.parts .note {
		margin: 0.25rem 0 0.35rem;
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.parts ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.parts li button {
		display: flex;
		width: 100%;
		gap: 0.3rem;
		align-items: baseline;
		text-align: left;
		padding: 0.18rem 0.4rem;
		border: 0;
		border-radius: 6px;
		background: none;
	}

	.parts li button:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.parts li button.on {
		background: #ff7a1a;
		color: #fff;
	}

	.parts .sources a {
		display: block;
		padding: 0.3rem 0.4rem;
		font-size: 0.8rem;
		color: inherit;
	}
	.parts li i {
		margin-left: auto;
		font-style: normal;
		opacity: 0.45;
	}

	.parts .head {
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.3rem;
	}

	.parts .chip:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.part-card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.part-card p {
		margin: 0;
		line-height: 1.4;
	}

	.part-card .tag {
		font-size: 0.68rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.part-card dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.1rem 0.8rem;
		margin: 0.15rem 0;
		font-size: 0.8rem;
	}

	.part-card dt {
		opacity: 0.6;
	}

	.part-card dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	.part-card a {
		color: inherit;
	}

	.part-card .row {
		justify-content: flex-start;
		flex-wrap: wrap;
	}

	.variants + .joints {
		margin-top: 0.8rem;
	}

	.joints {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.joints label {
		display: grid;
		grid-template-columns: 2.6rem minmax(0, 1fr) 2.6rem;
		align-items: center;
		gap: 0.4rem;
	}

	.joints label:first-child {
		grid-template-columns: 2.6rem minmax(0, 1fr);
	}

	.joints select,
	.joints input {
		width: 100%;
		min-width: 0;
	}

	.joints output {
		text-align: right;
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}

	.row {
		display: flex;
		gap: 0.4rem;
		justify-content: flex-end;
	}
</style>
