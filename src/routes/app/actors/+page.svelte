<!--
	Actors: everyone and everything rigged to move (src/lib/actors) — the stand-in a shot is blocked with and the animals
	of the worlds — kind by kind down the left (the chickens, the rabbits, the goats …), the kind's variants (its breeds,
	the rooster and the chick) to switch between on the right, one at a time on a turntable, playing its moves. The stand-in also holds its poses, and any joint of
	it can be turned by hand (the pose copied out as data). Drag to turn round it, scroll to come closer. An admin's.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { FAMILIES } from '$lib/actors';
	import Turntable from '$lib/app/Turntable.svelte';
	import { fit } from '$lib/app/turntable.js';
	import { atOrLatest } from '$lib/app/versions.js';

	/** @typedef {import('$lib/actors').Actor} Actor */
	/** @typedef {import('$lib/actors').Family} Family */
	/** @typedef {import('$lib/actors/rig').Cast} Cast */
	/** @typedef {import('$lib/actors/rig').Pose} Pose */
	/** @typedef {import('$lib/actors/rig').V3} V3 */

	/** @type {HTMLDivElement | undefined} */
	let canvasBox = $state();
	/** the kind chosen on the left, and which of its variants is on the turntable */
	/** @type {Family} */
	let chosen = $state(FAMILIES[0]);
	/** @type {Actor} */
	let variant = $state(FAMILIES[0].variants[0]);
	/** the version of the kind shown (its latest, or one picked from its history), and the variants it had */
	let version = $state(FAMILIES[0].version);
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

		show = async (a) => {
			// an animal's skin is meshed off the page first; picked away from meanwhile, it is not shown
			await a.ready?.();
			if (variant.id !== a.id) return;
			if (cast) scene.remove(cast.rig.object);
			if (grid) scene.remove(grid);
			const c = a.make();
			cast = c;
			edits = {};
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
	<title>Actors · maiaCITY</title>
</svelte:head>

<Turntable
	name="actors"
	bind:canvas={canvasBox}
	picks={{ title: 'Actors', lede: 'Everyone and everything rigged to move: the stand-in a shot is blocked with, and the animals of the worlds, kind by kind.', items: FAMILIES, chosen, where: (/** @type {Family} */ f) => `${f.variants.length > 1 ? `${f.variants.length} · ` : ''}${f.from}`, onpick: pick, version, onversion: pickVersion }}
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
		{#if cast && holding}
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
		<b>{variants.length > 1 ? `${chosen.label} · ${variant.label}` : chosen.label}</b>
		{#if variants.length > 1}<small>{variant.note}</small>{/if}
		{#if size && cast}<span>{measure(Math.max(size[0], size[2]))} long · {measure(size[1])} high · {cast.rig.names.length} bones</span>{/if}
		<small>Drag to turn round it · pinch or scroll to come closer{doing.kind === 'pose' ? ' · turn any joint by hand' : ''}</small>
	{/snippet}
</Turntable>

<style>
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
