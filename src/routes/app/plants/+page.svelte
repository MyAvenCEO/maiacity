<!--
	Plants: every plant grown from code (src/lib/plants), from its seed to the plant in fruit, in ten stages to tab
	through across the top — the last four the fruit's own, set to ripe (or ← → and 1 – 0 on the keyboard; Grow plays it on
	from where it is). The soil is cut away
	so the roots grow as plainly as the shoot — or laid bare, or shut. Each plant grows from a seed id: the same id the
	same plant every time, another id a sister plant. Drag to turn round it, scroll to come closer. An admin's.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { LAYERS, PLANTS, SEEDS, freshSeed } from '$lib/plants';
	import PickList from '$lib/app/PickList.svelte';

	/** @typedef {import('$lib/plants').Plant} Plant */
	/** @typedef {'cutaway' | 'bare' | 'solid'} Soil */
	/** @typedef {'plant' | 'whole'} Frame */

	const asked = page.url.searchParams;
	/** @type {HTMLDivElement | undefined} */
	let canvasBox = $state();
	const opened = PLANTS.find((p) => p.id === asked.get('plant')) ?? PLANTS[0];
	/** @type {Plant} */
	let chosen = $state(opened);
	/** where it has grown to: 0 … the last stage, the stages its whole numbers */
	let g = $state(Math.min(opened.stages.length - 1, Math.max(0, Number(asked.get('stage') ?? 1) - 1 || 0)));
	let seed = $state(asked.get('seed') || SEEDS[0]);
	/** @type {Soil} */
	let soil = $state('cutaway');
	/** @type {Frame} */
	let frame = $state('plant');
	let playing = $state(false);
	/** @type {{ above: number, below: number, across: number } | null} */
	let size = $state(null);

	const last = $derived(chosen.stages.length - 1);
	const stage = $derived(Math.round(g));
	const day = $derived.by(() => {
		const s = chosen.stages, k = Math.min(s.length - 2, Math.floor(g));
		return Math.round(s[k].day + (s[k + 1].day - s[k].day) * (g - k));
	});

	/** @type {((plant: Plant, g: number, seed: string) => void) | null} */
	let show = null;
	/** @type {((soil: Soil) => void) | null} */
	let showSoil = null;
	/** @type {((frame: Frame) => void) | null} */
	let reframe = null;
	/** @type {(() => void) | null} */
	let dispose = null;

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
		const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
		camera.position.set(0.3, 0.2, 0.4);
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.25));
		const key = new THREE.DirectionalLight('#fff4e6', 2.3);
		key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048);
		key.shadow.bias = -0.0004;
		scene.add(key, key.target);

		// the earth: the round floor everything stands on is the soil itself, a disc of earth as deep as the grown
		// plant's roots. Its near side and its top are see-through (we look in through them), its far wall and its
		// floor solid, so the roots show against the earth behind them from whichever side we look.
		const grain = soilTexture(THREE);
		const surfaceGrain = grain.clone();
		const walls = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, false), new THREE.MeshStandardMaterial({ color: '#c09a74', map: grain, roughness: 1, side: THREE.BackSide }));
		walls.receiveShadow = true;
		const sides = new THREE.Mesh(
			new THREE.CylinderGeometry(1, 1, 1, 96, 1, true),
			new THREE.MeshStandardMaterial({ color: '#a07a56', map: grain, roughness: 1, transparent: true, opacity: 0.1, depthWrite: false })
		);
		const top = new THREE.Mesh(
			new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2).translate(0, 0.5, 0),
			new THREE.MeshStandardMaterial({ color: '#b08860', map: surfaceGrain, roughness: 1, transparent: true, opacity: 0.32, depthWrite: false })
		);
		top.receiveShadow = true;
		const ring = (/** @type {number} */ y) => {
			const pts = [];
			for (let k = 0; k <= 96; k++) pts.push(new THREE.Vector3(Math.cos((k / 96) * Math.PI * 2), y, Math.sin((k / 96) * Math.PI * 2)));
			return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#4a3424', transparent: true, opacity: 0.4 }));
		};
		const earth = new THREE.Group();
		earth.add(walls, sides, top, ring(0.5), ring(-0.5));
		scene.add(earth);
		showSoil = (/** @type {Soil} */ mode) => {
			walls.visible = mode === 'cutaway';
			sides.visible = mode !== 'bare';
			for (const [mesh, see] of /** @type {const} */ ([[sides, 0.1], [top, mode === 'bare' ? 0.12 : 0.32]])) {
				const m = /** @type {import('three').MeshStandardMaterial} */ (mesh.material);
				m.opacity = mode === 'solid' ? 1 : see;
				m.transparent = mode !== 'solid';
				m.depthWrite = mode === 'solid';
				m.needsUpdate = true;
			}
		};
		showSoil(soil);

		/** @type {import('three').Group | null} */
		let current = null;
		/** where the camera is easing to: the plant's middle and how far back to stand */
		const goal = { mid: new THREE.Vector3(), reach: 0.1 };
		let easing = 0;
		let first = true;
		/** the earth for this plant and seed (its radius and depth): sized once, to the plant fully grown */
		let soilFor = '';
		const ground = { r: 0.1, d: 0.1 };
		/** @type {import('three').Box3 | null} */
		let plantBox = null;

		/** a plant's bounds, its stake left out */
		const bounds = (/** @type {import('three').Group} */ group) => {
			const b = new THREE.Box3();
			group.traverse((o) => {
				if (/** @type {import('three').Mesh} */ (o).isMesh && !o.userData.prop) b.expandByObject(o);
			});
			return b;
		};
		const toss = (/** @type {import('three').Group} */ group) => group.traverse((o) => /** @type {import('three').Mesh} */ (o).geometry?.dispose());

		/** the earth the grown plant needs, with room round its roots: the same from seed to fruit */
		const sizeSoil = (/** @type {Plant} */ plant, /** @type {string} */ id) => {
			const grown = plant.grow(plant.stages.length - 1, id);
			const b = bounds(grown);
			toss(grown);
			const below = Math.max(0, -b.min.y);
			const half = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
			// a round floor, wide round the plant and its roots
			ground.r = Math.max(below * 1.1, half * 1.6 + Math.max(below, half) * 0.15) + 0.02;
			ground.d = below * 1.12 + 0.02;
			earth.scale.set(ground.r, ground.d, ground.r);
			earth.position.y = -ground.d / 2;
			grain.repeat.set(Math.max(1, (ground.r * Math.PI * 2) / 0.06), Math.max(1, ground.d / 0.06));
			surfaceGrain.repeat.set(Math.max(1, (ground.r * 2) / 0.06), Math.max(1, (ground.r * 2) / 0.06));
		};

		/** frame the plant as it is now (close in), or the whole earth and the plant over it */
		reframe = (/** @type {Frame} */ mode) => {
			if (!plantBox) return;
			const all = plantBox.clone();
			if (mode === 'whole') all.union(new THREE.Box3(new THREE.Vector3(-ground.r, -ground.d, -ground.r), new THREE.Vector3(ground.r, 0, ground.r)));
			else all.expandByScalar(0.004);
			goal.mid.copy(all.getCenter(new THREE.Vector3()));
			const s = all.getSize(new THREE.Vector3());
			goal.reach = Math.max(0.012, s.x, s.y, s.z);
			easing = 1;
			if (first) {
				first = false;
				controls.target.copy(goal.mid);
				camera.position.copy(goal.mid).add(new THREE.Vector3(0.9, 0.45, 1.25).normalize().multiplyScalar(goal.reach * 2.1));
			}
			// the sun's shadows over what is framed
			key.position.copy(goal.mid).add(new THREE.Vector3(1.2, 2.2, 0.9).multiplyScalar(goal.reach));
			key.target.position.copy(goal.mid);
			const sh = key.shadow.camera;
			sh.left = sh.bottom = -goal.reach * 1.2;
			sh.right = sh.top = goal.reach * 1.2;
			sh.near = goal.reach * 0.1;
			sh.far = goal.reach * 6;
			sh.updateProjectionMatrix();
		};

		show = (plant, at, id) => {
			if (current) {
				scene.remove(current);
				toss(current);
			}
			if (soilFor !== `${plant.id}|${id}`) {
				soilFor = `${plant.id}|${id}`;
				sizeSoil(plant, id || ' ');
			}
			current = plant.grow(at, id || ' ');
			scene.add(current);
			const b = bounds(current);
			plantBox = b;
			size = { above: Math.max(0, b.max.y), below: Math.max(0, -b.min.y), across: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) };
			reframe?.(frame);
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
		show(chosen, g, seed);

		let raf = 0;
		let then = performance.now();
		let built = 0;
		const tick = () => {
			const now = performance.now();
			const dt = Math.min(0.1, (now - then) / 1000);
			then = now;
			// growing on: a little further each frame, the plant regrown a dozen times a second
			if (playing) {
				g = Math.min(last, g + dt * 0.5);
				if (now - built > 80 || g >= last) {
					built = now;
					show?.(chosen, g, seed);
				}
				if (g >= last) playing = false;
			}
			// the camera eases to the new framing, keeping the way it looks from
			if (easing > 0.001) {
				const k = 1 - Math.exp(-dt * 5);
				const look = camera.position.clone().sub(controls.target);
				const dist = look.length();
				controls.target.lerp(goal.mid, k);
				const want = goal.reach * 2.1;
				look.setLength(dist + (want - dist) * k);
				camera.position.copy(controls.target).add(look);
				easing = Math.abs(want - dist) / want + controls.target.distanceTo(goal.mid) / want;
			}
			camera.near = Math.max(0.0005, goal.reach / 200);
			camera.far = goal.reach * 80;
			camera.updateProjectionMatrix();
			controls.update();
			renderer.render(scene, camera);
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			if (current) current.traverse((o) => /** @type {import('three').Mesh} */ (o).geometry?.dispose());
			renderer.dispose();
			renderer.domElement.remove();
		};
	});
	onDestroy(() => dispose?.());

	/**
	 * Earth: dark crumbs and pale grit on brown, drawn once.
	 * @param {typeof import('three')} THREE
	 */
	function soilTexture(THREE) {
		const c = document.createElement('canvas');
		c.width = c.height = 256;
		const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
		x.fillStyle = '#9c7a58';
		x.fillRect(0, 0, 256, 256);
		let s = 7;
		const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
		for (let i = 0; i < 2600; i++) {
			const r = rnd() * 2.6 + 0.4;
			const tone = rnd();
			x.fillStyle = tone < 0.55 ? `rgba(40,26,16,${0.25 + rnd() * 0.4})` : tone < 0.9 ? `rgba(120,92,62,${0.3 + rnd() * 0.4})` : `rgba(214,200,170,${0.35 + rnd() * 0.4})`;
			x.beginPath();
			x.arc(rnd() * 256, rnd() * 256, r, 0, Math.PI * 2);
			x.fill();
		}
		const t = new THREE.CanvasTexture(c);
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.colorSpace = THREE.SRGBColorSpace;
		return t;
	}

	/** keep where we are in the address, to share or come back to */
	const remember = () => {
		const url = new URL(page.url);
		url.searchParams.set('plant', chosen.id);
		url.searchParams.set('stage', String(stage + 1));
		url.searchParams.set('seed', seed);
		try {
			replaceState(url, {});
		} catch {
			// before the router is up: nothing to keep yet
		}
	};
	const regrow = () => {
		show?.(chosen, g, seed);
		remember();
	};

	const pick = (/** @type {Plant} */ p) => {
		chosen = p;
		playing = false;
		g = Math.min(g, p.stages.length - 1);
		regrow();
	};
	const goTo = (/** @type {number} */ k) => {
		playing = false;
		g = Math.min(last, Math.max(0, k));
		regrow();
	};
	const grow = () => {
		if (playing) {
			playing = false;
			g = Math.round(g);
			return regrow();
		}
		if (g >= last) g = 0;
		playing = true;
	};
	const reseed = (/** @type {string} */ id) => {
		seed = id;
		regrow();
	};
	const toSoil = (/** @type {Soil} */ mode) => {
		soil = mode;
		showSoil?.(mode);
	};

	const toFrame = (/** @type {Frame} */ mode) => {
		frame = mode;
		reframe?.(mode);
	};

	/** ← → step a stage, 1 – 9 and 0 (the tenth) jump to one, space grows — unless typing a seed id */
	const onKey = (/** @type {KeyboardEvent} */ e) => {
		const t = /** @type {HTMLElement | null} */ (e.target);
		if (t?.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === 'ArrowRight') goTo(Math.floor(g) + 1);
		else if (e.key === 'ArrowLeft') goTo(Math.ceil(g) - 1);
		else if (/^[0-9]$/.test(e.key)) goTo(e.key === '0' ? 9 : Number(e.key) - 1);
		else if (e.key === ' ' && t?.tagName !== 'BUTTON') grow();
		else return;
		e.preventDefault();
	};

	const measure = (/** @type {number} */ v) => (v < 0.01 ? `${(v * 1000).toFixed(1)} mm` : v < 1 ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} cm` : `${v.toFixed(2)} m`);
	const SOILS = /** @type {const} */ ([
		['cutaway', 'Cut away'],
		['bare', 'Roots bare'],
		['solid', 'Soil shut']
	]);
</script>

<svelte:head>
	<title>Plants · maiaCITY</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<main class="plants">
	<PickList title="Plants" lede="Grown from code, seed to fruit, roots and all, in the seven layers of a food forest: tab through the ten stages, change the seed id for a sister plant." items={PLANTS} {chosen} where={(p) => p.from} onpick={pick} group={(p) => LAYERS.find((l) => l.id === p.layer)?.label ?? ''} />
	<section class="view">
		<div class="canvas" bind:this={canvasBox}></div>

		<div class="stages" role="tablist" aria-label="{chosen.label}: stages">
			{#each chosen.stages as s, k (s.name)}
				{#if k === 6}<span class="fruit-mark" aria-hidden="true">Fruit</span>{/if}
				<button role="tab" class:fruit={k >= 6} class:on={!playing && stage === k} class:past={k < g} aria-selected={stage === k} onclick={() => goTo(k)}>
					<small>{k + 1}</small>{s.name}
				</button>
			{/each}
			<button class="grow" class:on={playing} onclick={grow} title="Grow on from here (space)">{playing ? 'Pause' : 'Grow ▸'}</button>
		</div>

		<div class="panel">
			<label class="seed">
				<span class="label">Seed id</span>
				<input value={seed} spellcheck="false" autocomplete="off" onchange={(e) => reseed(e.currentTarget.value.trim() || SEEDS[0])} onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
			</label>
			<button class="dice" onclick={() => reseed(freshSeed())}>New seed</button>
			<div class="chips">
				{#each SEEDS as id (id)}
					<button class:on={seed === id} onclick={() => reseed(id)}>{id}</button>
				{/each}
			</div>
			<span class="label">Frame</span>
			<div class="chips">
				<button class:on={frame === 'plant'} onclick={() => toFrame('plant')}>The plant</button>
				<button class:on={frame === 'whole'} onclick={() => toFrame('whole')}>Whole earth</button>
			</div>
			<span class="label">Soil</span>
			<div class="chips">
				{#each SOILS as [mode, label] (mode)}
					<button class:on={soil === mode} onclick={() => toSoil(mode)}>{label}</button>
				{/each}
			</div>
		</div>

		<div class="readout">
			<b>{chosen.label} · {chosen.stages[stage].name} <em>{chosen.latin}</em></b>
			<span class="what">{chosen.stages[stage].note}</span>
			<span>
				Day {day}
				{#if size} · {measure(size.above)} above the soil · {measure(size.below)} below · {measure(size.across)} across{/if}
			</span>
			<small>← → or 1 – 0 for the stages · space grows · drag to turn round it · scroll to come closer</small>
		</div>
	</section>
</main>

<style>
	.plants {
		position: fixed;
		inset: 0;
		padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
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

	.stages,
	.panel,
	.readout {
		position: absolute;
		padding: 0.6rem 0.8rem;
		border-radius: 12px;
		background: rgb(255 255 255 / 0.78);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		font-size: 0.85rem;
	}

	button {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	/* the ten stages, in a row across the top, the fruit's four marked off */
	.stages {
		top: 1rem;
		left: 1rem;
		right: 1rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.stages button {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		flex: none;
		padding: 0.32rem 0.6rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.fruit-mark {
		margin: 0 0.1rem 0 0.4rem;
		padding-left: 0.6rem;
		border-left: 1px solid rgb(0 0 0 / 0.15);
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #a3312a;
	}

	.stages button.fruit:not(.on) {
		border-color: rgb(163 49 42 / 0.3);
	}

	.stages button small {
		font-size: 0.7rem;
		opacity: 0.5;
	}

	.stages button.past:not(.on) {
		background: #e3ead9;
	}

	.stages button.on {
		background: #1f2a23;
		border-color: #1f2a23;
		color: #fff;
	}

	.stages .grow {
		margin-left: auto;
		background: #3d6b2e;
		border-color: #3d6b2e;
		color: #fff;
	}

	.stages .grow.on {
		background: #8a5a2b;
		border-color: #8a5a2b;
	}

	.panel {
		top: 6.6rem;
		right: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		width: 14rem;
	}

	.label {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.seed {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.seed input {
		padding: 0.4rem 0.6rem;
		border: 1px solid rgb(0 0 0 / 0.15);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: inherit;
	}

	.dice {
		padding: 0.35rem 0.6rem;
		border: 1px solid #3d6b2e;
		border-radius: 8px;
		background: #3d6b2e;
		color: #fff;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.chips button {
		padding: 0.2rem 0.55rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		font-size: 0.78rem;
	}

	.chips button.on {
		background: #1f2a23;
		border-color: #1f2a23;
		color: #fff;
	}

	/* at the foot, above the app's nav pill (--nav-room, src/app.css) */
	.readout {
		left: 1rem;
		bottom: calc(1rem + var(--nav-room) - env(safe-area-inset-bottom, 0px));
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		max-width: 30rem;
	}

	.readout em {
		margin-left: 0.3rem;
		font-weight: 400;
		opacity: 0.55;
	}

	.readout small,
	.readout .what {
		opacity: 0.65;
	}

	@media (max-width: 720px) {
		.plants {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}

		.panel {
			top: auto;
			right: 1rem;
			left: 1rem;
			width: auto;
			bottom: calc(8.5rem + var(--nav-room));
		}

		.panel .chips:first-of-type {
			display: none;
		}

		.readout small {
			display: none;
		}
	}
</style>
