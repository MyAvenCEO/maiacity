<!--
	Actors: everyone and everything rigged to move (src/lib/actors) — the stand-in a shot is blocked with and the animals
	of the worlds — one at a time on a turntable, playing its moves. The stand-in also holds its poses, and any joint of
	it can be turned by hand (the pose copied out as data). Drag to turn round it, scroll to come closer. An admin's.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { ACTORS, type Actor } from '$lib/actors';
	import PickList from '$lib/app/PickList.svelte';
	import type { Cast, Pose, V3 } from '$lib/actors/rig';

	let canvasBox = $state<HTMLDivElement>();
	let chosen = $state<Actor>(ACTORS[0]!);
	let cast = $state.raw<Cast | null>(null);
	/** what it does: a move it plays, or a pose it holds */
	let doing = $state<{ kind: 'clip' | 'pose'; name: string }>({ kind: 'clip', name: '' });
	/** the joints turned by hand, over the pose it holds */
	let edits = $state<Record<string, V3>>({});
	let joint = $state('head');
	let size = $state<[number, number, number] | null>(null);
	let copied = $state(false);
	let show: ((a: Actor) => void) | null = null;
	let dispose: (() => void) | null = null;

	const holding = $derived(doing.kind === 'pose' && cast?.poses ? { ...cast.poses[doing.name], ...edits } : null);

	onMount(async () => {
		const THREE = await import('three');
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		const box = canvasBox!;
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		box.appendChild(renderer.domElement);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#e9e6e0');
		const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
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
		let grid: InstanceType<typeof THREE.Group> | null = null;

		show = async (a: Actor) => {
			// an animal's skin is meshed off the page first; picked away from meanwhile, it is not shown
			await a.ready?.();
			if (chosen.id !== a.id) return;
			if (cast) scene.remove(cast.rig.object);
			if (grid) scene.remove(grid);
			const c = a.make();
			cast = c;
			edits = {};
			doing = { kind: 'clip', name: c.first in c.clips ? c.first : Object.keys(c.clips)[0]! };
			if (c.poses && c.first in c.poses) doing = { kind: 'pose', name: c.first };
			joint = c.rig.names.includes('head') ? 'head' : c.rig.names[0]!;
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
			camera.aspect = w / Math.max(1, h);
			camera.updateProjectionMatrix();
		};
		const ro = new ResizeObserver(resize);
		ro.observe(box);
		resize();
		show(chosen);
		let frame = 0;
		const start = performance.now();
		const tick = () => {
			const t = (performance.now() - start) / 1000;
			if (cast) {
				if (doing.kind === 'clip') cast.rig.pose(cast.clips[doing.name]?.(t) ?? {});
				else if (holding) cast.rig.pose(holding as Pose);
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

	const pick = (a: Actor) => {
		chosen = a;
		show?.(a);
	};
	const play = (name: string) => (doing = { kind: 'clip', name });
	const hold = (name: string) => {
		doing = { kind: 'pose', name };
		edits = {};
	};
	/** a joint's turn now: what the hand gave it, else the pose's */
	const turnOf = (bone: string): V3 => edits[bone] ?? ((holding?.[bone] as V3 | undefined)?.slice(0, 3) as V3 | undefined) ?? [0, 0, 0];
	const turn = (axis: 0 | 1 | 2, value: number) => {
		const t = [...turnOf(joint)] as V3;
		t[axis] = value;
		edits = { ...edits, [joint]: t };
	};
	const copy = async () => {
		if (!holding) return;
		const rounded = Object.fromEntries(Object.entries(holding).map(([k, v]) => [k, (v as number[]).map((x) => Math.round(x * 1000) / 1000)]));
		await navigator.clipboard.writeText(JSON.stringify(rounded));
		copied = true;
		setTimeout(() => (copied = false), 1500);
	};
	const measure = (v: number) => (v < 0.1 ? `${Math.round(v * 1000)} mm` : `${Math.round(v * 100)} cm`);
</script>

<svelte:head>
	<title>Actors · maiaCITY</title>
</svelte:head>

<main class="actors">
	<PickList title="Actors" lede="Everyone and everything rigged to move: the stand-in a shot is blocked with, and the animals of the worlds." items={ACTORS} {chosen} where={(a) => a.from} onpick={pick} />
	<section class="view">
		<div class="canvas" bind:this={canvasBox}></div>
		{#if cast}
			<div class="moves">
				<span class="label">Moves</span>
				{#each Object.keys(cast.clips) as name (name)}
					<button class:on={doing.kind === 'clip' && doing.name === name} onclick={() => play(name)}>{name}</button>
				{/each}
				{#if cast.poses}
					<span class="label">Poses</span>
					{#each Object.keys(cast.poses) as name (name)}
						<button class:on={doing.kind === 'pose' && doing.name === name} onclick={() => hold(name)}>{name}</button>
					{/each}
				{/if}
			</div>
			{#if holding}
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
							<input type="range" min={-Math.PI} max={Math.PI} step="0.01" value={turnOf(joint)[i]} oninput={(e) => turn(i as 0 | 1 | 2, +(e.currentTarget as HTMLInputElement).value)} />
							<output>{Math.round((turnOf(joint)[i]! * 180) / Math.PI)}°</output>
						</label>
					{/each}
					<div class="row">
						<button onclick={() => (edits = {})}>Reset</button>
						<button onclick={copy}>{copied ? 'Copied' : 'Copy pose'}</button>
					</div>
				</div>
			{/if}
		{/if}
		<div class="readout">
			<b>{chosen.label}</b>
			{#if size && cast}<span>{measure(Math.max(size[0], size[2]))} long · {measure(size[1])} high · {cast.rig.names.length} bones</span>{/if}
			<small>Drag to turn round it · scroll to come closer{doing.kind === 'pose' ? ' · turn any joint by hand' : ''}</small>
		</div>
	</section>
</main>

<style>
	.actors {
		position: fixed;
		inset: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		background: #f4f1eb;
		color: #1f2a23;
	}

	.view {
		position: relative;
		min-width: 0;
	}

	.canvas {
		position: absolute;
		inset: 0;
		cursor: grab;
	}

	.moves,
	.joints,
	.readout {
		position: absolute;
		padding: 0.6rem 0.8rem;
		border-radius: 12px;
		background: rgb(255 255 255 / 0.78);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		font-size: 0.85rem;
	}

	.moves {
		top: 1rem;
		left: 1rem;
		right: 1rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.label {
		margin: 0 0.2rem 0 0.4rem;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.label:first-child {
		margin-left: 0;
	}

	button {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.moves button,
	.row button {
		padding: 0.3rem 0.65rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
	}

	.moves button.on {
		background: #1f2a23;
		border-color: #1f2a23;
		color: #fff;
	}

	.joints {
		top: 5.2rem;
		right: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		width: 15rem;
	}

	.joints label {
		display: grid;
		grid-template-columns: 2.6rem 1fr 2.6rem;
		align-items: center;
		gap: 0.4rem;
	}

	.joints label:first-child {
		grid-template-columns: 2.6rem 1fr;
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

	/* at the foot, above the app's nav pill (--nav-room, src/app.css) */
	.readout {
		left: 1rem;
		bottom: calc(1rem + var(--nav-room));
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.readout small {
		opacity: 0.6;
	}

	@media (max-width: 720px) {
		.actors {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}

		.joints {
			top: auto;
			bottom: calc(5.5rem + var(--nav-room));
		}
	}
</style>
